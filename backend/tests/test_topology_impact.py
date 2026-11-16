"""
Unit and API tests for Device-to-Device Blast-Radius Propagation, Dependency Chains, and SPOF analysis.
"""

from unittest.mock import AsyncMock, patch
import pytest
from httpx import ASGITransport, AsyncClient

from app.topology import infer_topology_links, compute_blast_radius
from app.main import app


SAMPLE_DEVICES = [
    {"id": "1", "name": "RTR-01", "dtype": "router", "floor": 1, "x": 335.0, "y": 98.0},
    {"id": "2", "name": "SW-CORE-01", "dtype": "switch", "floor": 1, "x": 96.0, "y": 98.0},
    {"id": "3", "name": "SW-DIST-01", "dtype": "switch", "floor": 1, "x": 280.0, "y": 98.0},
    {"id": "4", "name": "SW-B1", "dtype": "switch", "floor": 1, "x": 100.0, "y": 250.0},
    {"id": "5", "name": "SW-F2", "dtype": "switch", "floor": 2, "x": 150.0, "y": 150.0},
    {"id": "6", "name": "AP-B1", "dtype": "ap", "floor": 1, "x": 110.0, "y": 270.0},
    {"id": "7", "name": "AP-F2", "dtype": "ap", "floor": 2, "x": 180.0, "y": 180.0},
    {"id": "8", "name": "SRV-01", "dtype": "server", "floor": 1, "x": 80.0, "y": 80.0},
]

SAMPLE_LINKS = [
    {"id": "10", "source_device_id": "1", "target_device_id": "2", "link_type": "wan", "bandwidth_mbps": 10000, "is_redundant": False},
    {"id": "11", "source_device_id": "2", "target_device_id": "3", "link_type": "trunk", "bandwidth_mbps": 10000, "is_redundant": False},
    {"id": "12", "source_device_id": "3", "target_device_id": "4", "link_type": "trunk", "bandwidth_mbps": 1000, "is_redundant": False},
    {"id": "13", "source_device_id": "2", "target_device_id": "4", "link_type": "redundancy", "bandwidth_mbps": 1000, "is_redundant": True},
    {"id": "14", "source_device_id": "2", "target_device_id": "5", "link_type": "trunk", "bandwidth_mbps": 10000, "is_redundant": False},
    {"id": "15", "source_device_id": "4", "target_device_id": "6", "link_type": "access", "bandwidth_mbps": 1000, "is_redundant": False},
    {"id": "16", "source_device_id": "5", "target_device_id": "7", "link_type": "access", "bandwidth_mbps": 1000, "is_redundant": False},
    {"id": "17", "source_device_id": "2", "target_device_id": "8", "link_type": "access", "bandwidth_mbps": 10000, "is_redundant": False},
]


def test_infer_topology_links_creates_cross_floor_hierarchy():
    links = infer_topology_links(SAMPLE_DEVICES)
    pairs = {(min(l["source_device_id"], l["target_device_id"]), max(l["source_device_id"], l["target_device_id"])) for l in links}
    assert ("1", "2") in pairs
    assert ("2", "5") in pairs
    assert ("5", "7") in pairs
    assert ("2", "8") in pairs


def test_core_switch_down_records_exact_device_dependency_chains():
    report = compute_blast_radius(SAMPLE_DEVICES, SAMPLE_LINKS, down_device_ids=["2"], down_link_ids=[])
    by_id = {item["device_id"]: item for item in report["device_impacts"]}

    assert by_id["1"]["impact_state"] == "healthy"
    assert by_id["2"]["impact_state"] == "root_down"
    for did in ["3", "4", "5", "6", "7", "8"]:
        assert by_id[did]["impact_state"] == "unreachable"
        assert by_id[did]["caused_by_device_id"] == "2"
        assert by_id[did]["caused_by_name"] == "SW-CORE-01"

    # Multi-hop chain: SW-CORE-01 -> SW-F2 -> AP-F2
    assert by_id["7"]["dependency_path"] == ["SW-CORE-01", "SW-F2", "AP-F2"]
    # Multi-hop chain: SW-CORE-01 -> SW-DIST-01 -> SW-B1 -> AP-B1
    assert by_id["6"]["dependency_path"] == ["SW-CORE-01", "SW-DIST-01", "SW-B1", "AP-B1"]


def test_redundant_path_failover_marks_degraded_with_causal_chain():
    report = compute_blast_radius(SAMPLE_DEVICES, SAMPLE_LINKS, down_device_ids=["3"], down_link_ids=[])
    by_id = {item["device_id"]: item for item in report["device_impacts"]}

    assert by_id["3"]["impact_state"] == "root_down"
    assert by_id["4"]["impact_state"] == "degraded"
    assert by_id["4"]["caused_by_name"] == "SW-DIST-01"
    assert by_id["4"]["dependency_path"] == ["SW-DIST-01", "SW-B1"]

    assert by_id["6"]["impact_state"] == "degraded"
    assert by_id["6"]["dependency_path"] == ["SW-DIST-01", "SW-B1", "AP-B1"]
    assert by_id["2"]["impact_state"] == "healthy"


def test_leaf_ap_down_does_not_degrade_upstream_switch():
    report = compute_blast_radius(SAMPLE_DEVICES, SAMPLE_LINKS, down_device_ids=["7"], down_link_ids=[])
    impacts = {item["device_id"]: item["impact_state"] for item in report["device_impacts"]}

    assert impacts["7"] == "root_down"
    assert impacts["5"] == "healthy"
    assert impacts["2"] == "healthy"


def test_severing_both_redundant_paths_makes_downstream_unreachable():
    report = compute_blast_radius(SAMPLE_DEVICES, SAMPLE_LINKS, down_device_ids=[], down_link_ids=["12", "13"])
    impacts = {item["device_id"]: item["impact_state"] for item in report["device_impacts"]}

    assert impacts["4"] == "unreachable"
    assert impacts["6"] == "unreachable"


def test_spof_ranking_lists_affected_device_names():
    report = compute_blast_radius(SAMPLE_DEVICES, SAMPLE_LINKS, down_device_ids=[], down_link_ids=[], include_spof=True)
    ranking = report["spof_ranking"]
    assert len(ranking) >= 2
    assert ranking[0]["device_id"] == "1"
    assert "SW-CORE-01" in ranking[0]["affected_device_names"]
    assert ranking[1]["device_id"] == "2"
    assert "AP-F2" in ranking[1]["affected_device_names"]


@pytest.mark.asyncio
async def test_simulate_impact_endpoint_with_mocked_db():
    mock_pool = AsyncMock()
    with (
        patch("app.main.get_db_pool", return_value=mock_pool),
        patch("app.repository.fetch_devices_with_telemetry", return_value=SAMPLE_DEVICES),
        patch("app.main._ensure_links_or_infer", return_value=SAMPLE_LINKS),
    ):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            res = await ac.post(
                "/api/v1/simulate/impact",
                json={"down_device_ids": ["2"], "down_link_ids": [], "include_spof": True},
            )
            assert res.status_code == 200
            data = res.json()
            assert data["summary"]["root_down_count"] == 1
            assert data["summary"]["unreachable_count"] == 6
            assert "affected_rooms" not in data
            assert "affected_vlans" not in data
