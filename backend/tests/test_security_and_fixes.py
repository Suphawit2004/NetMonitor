"""Tests for TODO Section 1: security guardrails, validation, simulation isolation, and aggregate math."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.collector import get_device_traffic_series
from app.config import settings
from app.main import app, _serialize_device
from app.models import DeviceCreate, DeviceUpdate, ScanRequest
from app.snmp import sanitize_snmp_community


class _MockConn:
    def __init__(self, dev_row, if_rows, sample_rows):
        self._dev_row = dev_row
        self._if_rows = if_rows
        self._sample_rows = sample_rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def fetchrow(self, query, *args):
        return self._dev_row

    async def fetch(self, query, *args):
        if "FROM interfaces" in query:
            return self._if_rows
        return self._sample_rows


class _MockPool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return self._conn


def test_community_sanitization_rejects_flags_and_control_chars():
    assert sanitize_snmp_community("public") == "public"
    assert sanitize_snmp_community("  corp_ro  ") == "corp_ro"
    assert sanitize_snmp_community(None, "public") == "public"

    for bad in ["-v3", "-Ox", "pub lic", "pub\nlic", "x" * 65]:
        with pytest.raises(ValueError):
            sanitize_snmp_community(bad)


def test_models_validate_ip_cidr_and_communities():
    dev = DeviceCreate(name="SW-01", ip="192.168.10.5", credential_ref="netmon_ro")
    assert dev.ip == "192.168.10.5"
    assert dev.credential_ref == "netmon_ro"

    with pytest.raises(ValidationError):
        DeviceCreate(name="SW-BAD", ip="not-an-ip")

    with pytest.raises(ValidationError):
        DeviceCreate(name="SW-FLAG", ip="192.168.10.5", credential_ref="-v3")

    with pytest.raises(ValidationError):
        DeviceUpdate(ip="999.999.1.1")

    with pytest.raises(ValidationError):
        ScanRequest(cidr="not_a_cidr")

    with pytest.raises(ValidationError):
        ScanRequest(cidr="192.168.1.0/24", community="public, -Ox")

    scan_ok = ScanRequest(cidr="192.168.1.0/24", community="public, read_only")
    assert scan_ok.cidr == "192.168.1.0/24"


@pytest.mark.asyncio
async def test_api_key_enforced_on_mutating_and_scan_routes():
    with (
        patch.object(settings, "API_KEY", "test-secret-key"),
        patch("app.main.get_db_pool", return_value=AsyncMock()),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            res_unauth = await ac.post("/api/v1/clear")
            assert res_unauth.status_code == 401

            res_wrong = await ac.post(
                "/api/v1/discovery/scan",
                json={"cidr": "127.0.0.1/32"},
                headers={"X-API-Key": "wrong-key"},
            )
            assert res_wrong.status_code == 401

        mock_pool = AsyncMock()
        mock_pool.acquire = MagicMock(return_value=AsyncMock(__aenter__=AsyncMock(return_value=AsyncMock()), __aexit__=AsyncMock(return_value=False)))
        with patch("app.main.repository.clear_database_records", new=AsyncMock()):
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"X-API-Key": "test-secret-key"},
            ) as ac_auth:
                res_ok = await ac_auth.post("/api/v1/clear")
                assert res_ok.status_code == 200


@pytest.mark.asyncio
async def test_aggregate_traffic_series_sums_across_interfaces():
    now = datetime.now(timezone.utc)
    t_prev = now - timedelta(seconds=10)
    t_curr = now - timedelta(seconds=1)
    dt = (t_curr - t_prev).total_seconds()

    # Interface 1: +9 MB over dt -> (9_000_000 * 8) / (dt * 1e6) = 8.0 Mbps
    # Interface 2: +18 MB over dt -> (18_000_000 * 8) / (dt * 1e6) = 16.0 Mbps
    # Aggregate ("all") must equal sum (~24.0 Mbps), NOT mean (~12.0 Mbps).
    expected_if1 = round((9_000_000 * 8) / (dt * 1_000_000), 2)
    expected_if2 = round((18_000_000 * 8) / (dt * 1_000_000), 2)
    expected_sum = round(expected_if1 + expected_if2, 2)

    dev_row = {"id": 1, "dtype": "switch", "enabled": True}
    if_rows = [
        {"id": 101, "speed_bps": 1_000_000_000},
        {"id": 102, "speed_bps": 1_000_000_000},
    ]
    sample_rows = [
        {"interface_id": 101, "sampled_at": t_prev, "in_octets": 1_000_000, "out_octets": 500_000},
        {"interface_id": 101, "sampled_at": t_curr, "in_octets": 10_000_000, "out_octets": 5_000_000},
        {"interface_id": 102, "sampled_at": t_prev, "in_octets": 2_000_000, "out_octets": 1_000_000},
        {"interface_id": 102, "sampled_at": t_curr, "in_octets": 20_000_000, "out_octets": 10_000_000},
    ]
    pool = _MockPool(_MockConn(dev_row, if_rows, sample_rows))

    series = await get_device_traffic_series(pool, device_id=1, interface_id="all", time_range="15m")
    assert series["has_snmp"] is True
    assert max(series["inbound"]) == pytest.approx(expected_sum, abs=0.05)


@pytest.mark.asyncio
async def test_device_detail_does_not_call_live_snmp():
    fake_dev = {
        "id": 1,
        "name": "SW-01",
        "hostname": "sw-01.corp.local",
        "ip": "192.168.22.254",
        "snmp_port": 161,
        "snmp_version": "v2c",
        "credential_ref": "public",
        "poll_interval_s": 30,
        "location": "Floor 1 – Network Core",
        "enabled": True,
        "is_simulated": False,
        "dtype": "switch",
        "floor": 1,
        "x": 272.0,
        "y": 52.0,
        "locked": True,
        "model": "Aruba 2930F",
        "latitude": None,
        "longitude": None,
        "altitude": None,
        "services": [],
        "latest_poll_status": "succeeded",
        "alert_severity": None,
    }
    with (
        patch("app.main.get_db_pool", return_value=AsyncMock()),
        patch("app.main.repository.fetch_device_detail_by_id", return_value=fake_dev),
        patch("app.main.repository.fetch_device_interfaces", return_value=[]),
        patch("app.main.repository.fetch_device_latest_metrics", return_value=[]),
        patch("app.main.repository.fetch_latest_sys_uptime", return_value="12d 4h 15m"),
        patch("app.main.snmp_get_oid", side_effect=AssertionError("snmp_get_oid must not be called on GET /devices/{id}")),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            res = await ac.get("/api/v1/devices/1")
            assert res.status_code == 200
            assert res.json()["uptime"] == "12d 4h 15m"


@pytest.mark.asyncio
async def test_reachability_retry_and_tcp_fallback():
    from app.discovery import probe_device_reachability, probe_single_ip
    from app.main import resolve_poll_failure_outcome
    import asyncio

    # 1. Ping retry recovers transient packet drop without falling back to TCP
    with (
        patch("app.discovery.ping_ip", new=AsyncMock(side_effect=[(False, 0.0, None), (True, 24.5, 64)])),
        patch("app.discovery.tcp_probe_ip", new=AsyncMock(return_value=(False, None))),
    ):
        ok, rtt, ttl, proto = await probe_device_reachability("192.168.22.64")
        assert (ok, rtt, ttl, proto) == (True, 24.5, 64, "icmp")

    # 2. ICMP-blocking host with open/active TCP port remains alive via TCP fallback
    with (
        patch("app.discovery.ping_ip", new=AsyncMock(return_value=(False, 0.0, None))),
        patch("app.discovery.tcp_probe_ip", new=AsyncMock(return_value=(True, 11.2))),
    ):
        ok, rtt, ttl, proto = await probe_device_reachability("192.168.22.111")
        assert (ok, rtt, ttl, proto) == (True, 11.2, None, "tcp")

    # 3. Unreachable stale ARP entry (no ICMP, no SNMP, no TCP) is excluded from scan results
    with (
        patch("app.discovery.ping_ip", new=AsyncMock(return_value=(False, 0.0, None))),
        patch("app.discovery.snmp_get_oid", new=AsyncMock(return_value=(False, None, "timeout"))),
        patch("app.discovery.tcp_probe_ip", new=AsyncMock(return_value=(False, None))),
    ):
        res = await probe_single_ip(
            ip="192.168.22.78",
            candidate_communities=["public"],
            snmp_port=161,
            existing_ips=set(),
            mac_dict={"192.168.22.78": "68-3e-26-f8-f0-7a"},
            wifi_context={},
            floor_split_threshold=120,
            semaphore=asyncio.Semaphore(4),
        )
        assert res is None

    # 4. Background poller requires two consecutive misses before marking offline
    assert resolve_poll_failure_outcome("succeeded")[0] == "warning"
    assert resolve_poll_failure_outcome("warning")[0] == "failed"
    assert resolve_poll_failure_outcome("failed")[0] == "failed"
    assert resolve_poll_failure_outcome(None)[0] == "failed"


@pytest.mark.asyncio
async def test_traffic_series_rejects_foreign_or_invalid_interface_id():
    now = datetime.now(timezone.utc)
    t_prev = now - timedelta(seconds=10)
    t_curr = now - timedelta(seconds=1)

    dev_row = {"id": 1, "dtype": "switch", "enabled": True}
    if_rows = [{"id": 1, "speed_bps": 1_000_000_000}]
    foreign_samples = [
        {"interface_id": 999, "sampled_at": t_prev, "in_octets": 1_000_000, "out_octets": 500_000},
        {"interface_id": 999, "sampled_at": t_curr, "in_octets": 10_000_000, "out_octets": 5_000_000},
    ]
    pool = _MockPool(_MockConn(dev_row, if_rows, foreign_samples))

    foreign_res = await get_device_traffic_series(pool, device_id=1, interface_id="999", time_range="15m")
    assert foreign_res["has_snmp"] is False
    assert all(v == 0.0 for v in foreign_res["inbound"])
    assert all(v == 0.0 for v in foreign_res["outbound"])

    invalid_res = await get_device_traffic_series(pool, device_id=1, interface_id="not-a-number", time_range="15m")
    assert invalid_res["has_snmp"] is False
    assert all(v == 0.0 for v in invalid_res["inbound"])
    assert all(v == 0.0 for v in invalid_res["outbound"])


def test_serialize_device_exposes_is_simulated():
    base = {
        "id": 42,
        "name": "SIM-SW-01",
        "dtype": "switch",
        "floor": 1,
        "x": 120.0,
        "y": 140.0,
        "locked": True,
        "ip": "10.0.0.42",
        "model": "SimSwitch",
        "enabled": True,
        "latest_poll_status": "succeeded",
        "alert_severity": None,
        "services": [],
    }
    sim_out = _serialize_device({**base, "is_simulated": True})
    assert sim_out.is_simulated is True

    default_out = _serialize_device(base)
    assert default_out.is_simulated is False


@pytest.mark.asyncio
async def test_get_device_interfaces_returns_mac_and_latest_rates():
    fake_dev = {
        "id": 1,
        "ip": "192.168.22.254",
        "is_simulated": False,
        "credential_ref": "public",
        "snmp_version": "v2c",
        "snmp_port": 161,
    }
    fake_snapshot = {
        "success": True,
        "has_snmp": True,
        "interfaces_polled": 1,
        "total_in_mbps": 12.5,
        "total_out_mbps": 4.2,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "interfaces": [
            {
                "id": 10,
                "if_index": 1,
                "name": "Gi1/0/1",
                "description": "Port Gi1/0/1",
                "mac_address": "8C:85:C1:83:92:FF",
                "speed_bps": 1_000_000_000,
                "oper_status": "up",
                "in_mbps": 12.5,
                "out_mbps": 4.2,
            }
        ],
    }
    with (
        patch("app.main.get_db_pool", return_value=AsyncMock()),
        patch("app.main.repository.fetch_device_by_id", new=AsyncMock(return_value=fake_dev)),
        patch("app.main.get_latest_interface_traffic_snapshot", new=AsyncMock(return_value=fake_snapshot)),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            res = await ac.get("/api/v1/devices/1/interfaces")
            assert res.status_code == 200
            body = res.json()
            assert len(body) == 1
            assert body[0]["id"] == 10
            assert body[0]["mac_address"] == "8C:85:C1:83:92:FF"
            assert body[0]["in_mbps"] == 12.5
            assert body[0]["out_mbps"] == 4.2


@pytest.mark.asyncio
async def test_create_device_alert_error_codes():
    with (
        patch.object(settings, "API_KEY", ""),
        patch("app.main.get_db_pool", return_value=AsyncMock()),
        patch(
            "app.main.repository.create_alert",
            new=AsyncMock(side_effect=asyncpg.ForeignKeyViolationError("fk")),
        ),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            res_bad = await ac.post(
                "/api/v1/devices/not-an-int/alerts",
                json={"severity": "warn", "title": "Test"},
            )
            assert res_bad.status_code == 400

            res_missing = await ac.post(
                "/api/v1/devices/999999/alerts",
                json={"severity": "warn", "title": "Test"},
            )
            assert res_missing.status_code == 404


@pytest.mark.asyncio
async def test_repository_update_device_rejects_disallowed_columns():
    from app import repository

    mock_pool = AsyncMock()
    with pytest.raises(ValueError):
        await repository.update_device(mock_pool, 1, {"id": 999})
    with pytest.raises(ValueError):
        await repository.update_device(mock_pool, 1, {"name; DROP TABLE devices": "x"})
    mock_pool.execute.assert_not_called()



