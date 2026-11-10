import sys
import pytest

sys.path.insert(0, r"c:\work\snmp_font_end\backend")

from app.classifier import classify_device, generate_smart_device_name, lookup_mac_vendor

def test_router_default_gateway_ip_ttl64():
    dtype, conf, reason = classify_device(ip="192.168.1.1", ttl=64)
    assert dtype == "router"
    assert conf >= 70
    assert "Default Gateway" in reason or "Gateway" in reason

def test_router_default_gateway_ip_ttl255():
    dtype, conf, reason = classify_device(ip="192.168.1.1", ttl=255)
    assert dtype == "router"
    assert conf >= 70

def test_router_mikrotik():
    dtype, conf, reason = classify_device(
        ip="192.168.1.1",
        mac="00:0c:42:11:22:33",
        sys_descr="RouterOS RB750Gr3",
        sys_name="MikroTik-Main",
        sys_services=6,
        ttl=64,
    )
    assert dtype == "router"
    assert conf >= 90
    assert "Router" in reason

def test_router_cisco_2900():
    dtype, conf, reason = classify_device(
        ip="192.168.1.1",
        mac="00:26:98:aa:bb:cc",
        sys_descr="Cisco IOS Software, C2900 Software (C2900-UNIVERSALK9-M), Version 15.2(4)M5",
        sys_name="Router-Core",
        sys_services=6,
        ttl=255,
    )
    assert dtype == "router"
    assert conf >= 90

def test_router_cisco_2800():
    dtype, conf, reason = classify_device(
        ip="192.168.1.1",
        mac="00:10:74:11:22:33",
        sys_descr="Cisco IOS Software, 2800 Software (C2800NM-ADVIPSERVICESK9-M), Version 12.4",
        sys_name="Router",
        sys_services=6,
        ttl=255,
    )
    assert dtype == "router"
    assert conf >= 90

def test_router_cisco_isr4000():
    dtype, conf, reason = classify_device(
        ip="10.0.0.1",
        mac="00:00:0c:12:34:56",
        sys_descr="Cisco IOS Software, ISR4321/K9, Version 16.9.4",
        sys_name="ISR4321-Edge",
        sys_services=6,
        ttl=255,
    )
    assert dtype == "router"
    assert conf >= 90

def test_router_openwrt_linux():
    # Crucial: Linux in sysDescr must NOT turn an OpenWrt router into a server!
    dtype, conf, reason = classify_device(
        ip="192.168.1.1",
        mac="e4:8d:8c:12:34:56",
        sys_descr="Linux OpenWrt 5.15.137 #0 SMP Wed Jan 10 2024",
        hostname="OpenWrt.lan",
        sys_services=76,
        ttl=64,
    )
    assert dtype == "router"
    assert conf >= 85

def test_router_fortigate():
    dtype, conf, reason = classify_device(
        ip="192.168.1.1",
        mac="08:5b:0e:11:22:33",
        sys_descr="FortiGate-60F v7.2.4",
        sys_name="FG-Branch",
        sys_services=6,
        ttl=255,
    )
    assert dtype == "router"
    assert conf >= 90

def test_router_ubiquiti_edgerouter():
    dtype, conf, reason = classify_device(
        ip="192.168.1.1",
        mac="04:18:d6:aa:bb:cc",
        sys_descr="Linux EdgeRouter-X 4.14.54-UBNT",
        hostname="ubnt-erx",
        ttl=64,
    )
    assert dtype == "router"
    assert conf >= 85

def test_router_tplink_archer():
    dtype, conf, reason = classify_device(
        ip="192.168.1.1",
        mac="50:d4:f7:11:22:33",
        hostname="Archer-AX50",
        ttl=64,
    )
    assert dtype == "router"
    assert conf >= 80

def test_router_draytek_vigor():
    dtype, conf, reason = classify_device(
        ip="192.168.1.1",
        mac="00:1d:ae:11:22:33",
        hostname="Vigor2926",
        ttl=64,
    )
    assert dtype == "router"
    assert conf >= 80

def test_router_ip_forwarding():
    dtype, conf, reason = classify_device(
        ip="192.168.10.1",
        sys_descr="Custom Gateway",
        ip_forwarding=1,
        is_gateway=True,
    )
    assert dtype == "router"
    assert "IP Forwarding Enabled" in reason

def test_switch_aruba_core_preserved():
    dtype, conf, reason = classify_device(
        ip="192.168.22.254",
        mac="8c:85:c1:aa:bb:cc",
        sys_descr="Aruba JL261A 2930F-24G-PoE+-4SFP Switch",
        sys_name="Switch-Core",
        sys_services=3,
        ttl=255,
    )
    assert dtype == "switch"
    assert conf >= 90

def test_switch_catalyst_preserved():
    dtype, conf, reason = classify_device(
        ip="192.168.22.10",
        mac="00:10:74:aa:bb:cc",
        sys_descr="Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M)",
        sys_name="C2960-Access-1",
        sys_services=2,
        ttl=255,
    )
    assert dtype == "switch"
    assert conf >= 90

def test_ap_ubiquiti_preserved():
    dtype, conf, reason = classify_device(
        ip="192.168.22.239",
        mac="e8:fd:f8:11:22:33",
        sys_descr="U6-Pro 6.5.64",
        hostname="U6-Pro-Lab",
        ttl=64,
    )
    assert dtype == "ap"
    assert conf >= 80

def test_server_dell_poweredge_preserved():
    dtype, conf, reason = classify_device(
        ip="192.168.22.83",
        mac="d0:94:66:11:22:33",
        sys_descr="Linux ubuntu 5.15.0-89-generic Dell PowerEdge R640",
        hostname="srv-database",
        ttl=64,
    )
    assert dtype == "server"
    assert conf >= 90

def test_smart_device_naming_router():
    name1 = generate_smart_device_name(ip="192.168.1.1", dtype="router", vendor="MikroTik")
    assert name1 == "MikroTik-RTR-01"

    name2 = generate_smart_device_name(ip="192.168.22.254", dtype="router", vendor="Cisco")
    assert name2 == "Cisco-RTR-254"

    name3 = generate_smart_device_name(ip="192.168.22.254", dtype="switch", vendor="Aruba")
    assert name3 == "Aruba-SW-254"
