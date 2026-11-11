import pytest
from app.collector import calculate_bandwidth_mbps, parse_snmpwalk_output

def test_calculate_bandwidth_normal():
    # 100,000,000 bytes transferred over 5 seconds
    # bits = 800,000,000 / 5s = 160,000,000 bps = 160.0 Mbps
    mbps = calculate_bandwidth_mbps(
        curr_octets=200_000_000,
        prev_octets=100_000_000,
        dt_seconds=5.0,
        is_64bit=True
    )
    assert mbps == pytest.approx(160.0, rel=1e-2)

def test_calculate_bandwidth_32bit_rollover():
    # Previous counter near 2^32 (4,294,967,295), current rolled over to 10,000,000
    prev = 4_290_000_000
    curr = 10_000_000
    # Expected delta = (2^32 - 4,290,000,000) + 10,000,000 = 14,967,296 bytes
    # expected_mbps = (14_967_296 * 8) / (5.0 * 1_000_000) = 23.95 Mbps
    mbps = calculate_bandwidth_mbps(
        curr_octets=curr,
        prev_octets=prev,
        dt_seconds=5.0,
        is_64bit=False
    )
    expected_mbps = (14_967_296 * 8) / (5.0 * 1_000_000)
    assert mbps == pytest.approx(expected_mbps, rel=1e-2)

def test_calculate_bandwidth_zero_or_negative_dt():
    mbps = calculate_bandwidth_mbps(curr_octets=100, prev_octets=50, dt_seconds=0.0)
    assert mbps == 0.0
    mbps_neg = calculate_bandwidth_mbps(curr_octets=100, prev_octets=50, dt_seconds=-1.0)
    assert mbps_neg == 0.0

def test_parse_snmpwalk_lines():
    sample_text = """
IF-MIB::ifDescr.1 = STRING: 1
IF-MIB::ifDescr.2 = STRING: 2
IF-MIB::ifDescr.3 = STRING: VLAN22
RFC1213-MIB::ifOperStatus.1 = INTEGER: up(1)
RFC1213-MIB::ifOperStatus.2 = INTEGER: down(2)
"""
    result = parse_snmpwalk_output(sample_text)
    assert result[1] == "1" or result[1] == "up"


@pytest.mark.asyncio
async def test_db_interface_sync_and_series():
    from app.database import init_db, close_db, get_db_pool
    from app.collector import sync_device_interfaces, get_device_traffic_series
    await init_db()
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        dev_id = await conn.fetchval("SELECT id FROM devices ORDER BY id LIMIT 1")
    assert dev_id is not None

    mock_ifaces = [
        {"if_index": 1, "name": "Port 1", "description": "GigabitEthernet1", "speed_bps": 1_000_000_000, "oper_status": "up"},
        {"if_index": 2, "name": "Port 2", "description": "GigabitEthernet2", "speed_bps": 1_000_000_000, "oper_status": "down"}
    ]
    if_id_map = await sync_device_interfaces(pool, dev_id, mock_ifaces)
    assert len(if_id_map) == 2
    assert 1 in if_id_map
    assert 2 in if_id_map

    # 1. Query series before samples are inserted -> has_snmp is False
    series_empty = await get_device_traffic_series(pool, device_id=dev_id, interface_id="all", time_range="15m")
    assert series_empty["has_snmp"] is False
    assert len(series_empty["inbound"]) == 60
    assert len(series_empty["outbound"]) == 60

    # 2. Insert mock samples to verify telemetry calculation
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    target_if_id = if_id_map[1]
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO interface_samples (interface_id, sampled_at, in_octets, out_octets)
            VALUES 
                ($1, $2, 100000000, 50000000),
                ($1, $3, 150000000, 75000000)
            ON CONFLICT DO NOTHING
            """,
            target_if_id,
            now - timedelta(seconds=10),
            now
        )

    # 3. Query series after samples are inserted -> has_snmp is True
    series = await get_device_traffic_series(pool, device_id=dev_id, interface_id="all", time_range="15m")
    assert series["has_snmp"] is True
    assert len(series["inbound"]) == 60
    assert len(series["outbound"]) == 60
    await close_db()
