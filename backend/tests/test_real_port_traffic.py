import asyncio
import pytest
from app.collector import (
    collect_device_interfaces,
    poll_and_calculate_device_traffic,
    get_device_traffic_series,
)
from app.database import init_db, close_db, get_db_pool
from app.discovery import ping_ip

SWITCH_IP = "192.168.22.254"

async def check_switch_reachable() -> bool:
    try:
        return await ping_ip(SWITCH_IP, timeout=1.0)
    except Exception:
        return False

@pytest.mark.asyncio
async def test_live_aruba_switch_interfaces():
    if not await check_switch_reachable():
        pytest.skip(f"Live Aruba switch at {SWITCH_IP} is not reachable in current environment")

    ifaces = await collect_device_interfaces(SWITCH_IP, community="public")
    print(f"\nDiscovered {len(ifaces)} interfaces from live Aruba switch {SWITCH_IP}")
    assert len(ifaces) >= 24, f"Expected >= 24 interfaces, got {len(ifaces)}"

    # Show first few ports
    for iface in ifaces[:5]:
        print(f"  Port: {iface['name']}, Oper: {iface['oper_status']}, Speed: {iface['speed_bps']} bps, In: {iface['in_octets']}, Out: {iface['out_octets']}")

    assert any(i["oper_status"] == "up" for i in ifaces), "Expected at least one active port"

@pytest.mark.asyncio
async def test_live_aruba_traffic_delta():
    if not await check_switch_reachable():
        pytest.skip(f"Live Aruba switch at {SWITCH_IP} is not reachable in current environment")

    await init_db()
    pool = await get_db_pool()
    async with pool.acquire() as conn:
        dev_id = await conn.fetchval("SELECT id FROM devices WHERE management_ip = $1", SWITCH_IP)
        if not dev_id:
            dev_id = await conn.fetchval("SELECT id FROM devices ORDER BY id LIMIT 1")
    assert dev_id is not None

    # Poll 1
    res1 = await poll_and_calculate_device_traffic(pool, device_id=dev_id, ip=SWITCH_IP, community="public")
    assert res1["success"] is True
    assert res1["has_snmp"] is True
    print(f"\nPoll 1: {res1['interfaces_polled']} interfaces, In: {res1['total_in_mbps']} Mbps, Out: {res1['total_out_mbps']} Mbps")

    # Sleep 2 seconds
    await asyncio.sleep(2)

    # Poll 2
    res2 = await poll_and_calculate_device_traffic(pool, device_id=dev_id, ip=SWITCH_IP, community="public")
    assert res2["success"] is True
    assert res2["has_snmp"] is True
    print(f"Poll 2: {res2['interfaces_polled']} interfaces, In: {res2['total_in_mbps']} Mbps, Out: {res2['total_out_mbps']} Mbps")

    # Query series
    series = await get_device_traffic_series(pool, device_id=dev_id, interface_id="all", time_range="15m")
    assert series["has_snmp"] is True
    print(f"Series Peak: {series['peak']} Mbps, Avg: {series['avg']} Mbps, Data Points: {len(series['inbound'])}")
    await close_db()
