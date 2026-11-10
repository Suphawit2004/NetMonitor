import asyncio
import pytest
from app.collector import (
    collect_device_interfaces,
    poll_and_calculate_device_traffic,
    get_device_traffic_series,
)
from app.database import init_db, close_db, get_db_pool

@pytest.mark.asyncio
async def test_live_aruba_switch_interfaces():
    ip = "192.168.22.254"
    ifaces = await collect_device_interfaces(ip, community="public")
    print(f"\nDiscovered {len(ifaces)} interfaces from live Aruba switch {ip}")
    assert len(ifaces) >= 24, f"Expected >= 24 interfaces, got {len(ifaces)}"

    # Show first few ports
    for iface in ifaces[:5]:
        print(f"  Port: {iface['name']}, Oper: {iface['oper_status']}, Speed: {iface['speed_bps']} bps, In: {iface['in_octets']}, Out: {iface['out_octets']}")

    assert any(i["oper_status"] == "up" for i in ifaces), "Expected at least one active port"

@pytest.mark.asyncio
async def test_live_aruba_traffic_delta():
    await init_db()
    pool = await get_db_pool()
    dev_id = 1
    ip = "192.168.22.254"

    # Poll 1
    res1 = await poll_and_calculate_device_traffic(pool, device_id=dev_id, ip=ip, community="public")
    assert res1["success"] is True
    assert res1["has_snmp"] is True
    print(f"\nPoll 1: {res1['interfaces_polled']} interfaces, In: {res1['total_in_mbps']} Mbps, Out: {res1['total_out_mbps']} Mbps")

    # Sleep 2 seconds
    await asyncio.sleep(2)

    # Poll 2
    res2 = await poll_and_calculate_device_traffic(pool, device_id=dev_id, ip=ip, community="public")
    assert res2["success"] is True
    assert res2["has_snmp"] is True
    print(f"Poll 2: {res2['interfaces_polled']} interfaces, In: {res2['total_in_mbps']} Mbps, Out: {res2['total_out_mbps']} Mbps")

    # Query series
    series = await get_device_traffic_series(pool, device_id=dev_id, interface_id="all", time_range="15m")
    assert series["has_snmp"] is True
    print(f"Series Peak: {series['peak']} Mbps, Avg: {series['avg']} Mbps, Data Points: {len(series['inbound'])}")
    await close_db()
