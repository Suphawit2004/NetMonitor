import re
from typing import Optional, Tuple, Dict, Any, List

# Common Enterprise & Network MAC OUI prefixes (normalized lowercase, without delimiters)
MAC_OUI_DATABASE: Dict[str, Dict[str, Any]] = {
    # Aruba / HPE
    "8c85c1": {"vendor": "Aruba/HPE", "default_type": "switch", "category": "enterprise_network"},
    "a8407d": {"vendor": "Aruba/HPE", "default_type": "ap", "category": "wireless_ap"},
    "b43ae2": {"vendor": "Aruba/HPE", "default_type": "ap", "category": "wireless_ap"},
    "d06726": {"vendor": "Aruba/HPE", "default_type": "ap", "category": "wireless_ap"},
    "9457a5": {"vendor": "Aruba/HPE", "default_type": "switch", "category": "enterprise_network"},
    "204e71": {"vendor": "Aruba/HPE", "default_type": "switch", "category": "enterprise_network"},
    "382185": {"vendor": "HPE/ProCurve", "default_type": "switch", "category": "enterprise_network"},

    # Cisco Systems
    "001074": {"vendor": "Cisco", "default_type": "switch", "category": "enterprise_network"},
    "00226c": {"vendor": "Cisco", "default_type": "switch", "category": "enterprise_network"},
    "54ef44": {"vendor": "Cisco", "default_type": "switch", "category": "enterprise_network"},
    "70d823": {"vendor": "Cisco", "default_type": "switch", "category": "enterprise_network"},
    "002698": {"vendor": "Cisco", "default_type": "router", "category": "enterprise_network"},
    "f40f1b": {"vendor": "Cisco Aironet", "default_type": "ap", "category": "wireless_ap"},
    "28940f": {"vendor": "Cisco Meraki", "default_type": "ap", "category": "wireless_ap"},

    # Ubiquiti Networks
    "e8fdf8": {"vendor": "Ubiquiti", "default_type": "ap", "category": "wireless_ap"},
    "dc6279": {"vendor": "Ubiquiti", "default_type": "ap", "category": "wireless_ap"},
    "7483c2": {"vendor": "Ubiquiti", "default_type": "ap", "category": "wireless_ap"},
    "b4fbe4": {"vendor": "Ubiquiti", "default_type": "switch", "category": "enterprise_network"},

    # Servers / Virtualization
    "00155d": {"vendor": "Microsoft Hyper-V", "default_type": "server", "category": "virtual_server"},
    "005056": {"vendor": "VMware ESXi", "default_type": "server", "category": "virtual_server"},
    "000c29": {"vendor": "VMware ESXi", "default_type": "server", "category": "virtual_server"},
    "525400": {"vendor": "QEMU/KVM", "default_type": "server", "category": "virtual_server"},
    "d09466": {"vendor": "Dell PowerEdge", "default_type": "server", "category": "physical_server"},
    "ecf4bb": {"vendor": "Dell Server", "default_type": "server", "category": "physical_server"},
    "f04da2": {"vendor": "Dell Server", "default_type": "server", "category": "physical_server"},
    "b083fe": {"vendor": "HP ProLiant", "default_type": "server", "category": "physical_server"},
    "ac1f6b": {"vendor": "Supermicro", "default_type": "server", "category": "physical_server"},

    # Routers & Firewalls
    "000c42": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "488ad2": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "6c3b6b": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "744d28": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "b869f4": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "cc2de0": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "d4ca6d": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "e48d8c": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "085531": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "18fd74": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "2cc81b": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "789a18": {"vendor": "MikroTik", "default_type": "router", "category": "router"},
    "085b0e": {"vendor": "Fortinet", "default_type": "router", "category": "security_gateway"},
    "00090f": {"vendor": "Fortinet", "default_type": "router", "category": "security_gateway"},
    "704ca5": {"vendor": "Fortinet", "default_type": "router", "category": "security_gateway"},
    "906cba": {"vendor": "Fortinet", "default_type": "router", "category": "security_gateway"},
    "00000c": {"vendor": "Cisco Router", "default_type": "router", "category": "enterprise_network"},
    "000142": {"vendor": "Cisco Router", "default_type": "router", "category": "enterprise_network"},
    "000196": {"vendor": "Cisco Router", "default_type": "router", "category": "enterprise_network"},
    "001c57": {"vendor": "Cisco Router", "default_type": "router", "category": "enterprise_network"},
    "001d70": {"vendor": "Cisco Router", "default_type": "router", "category": "enterprise_network"},
    "002497": {"vendor": "Cisco Router", "default_type": "router", "category": "enterprise_network"},
    "0418d6": {"vendor": "Ubiquiti EdgeRouter", "default_type": "router", "category": "router"},
    "24a43c": {"vendor": "Ubiquiti Gateway", "default_type": "router", "category": "router"},
    "68d79a": {"vendor": "Ubiquiti Gateway", "default_type": "router", "category": "router"},
    "788a20": {"vendor": "Ubiquiti EdgeRouter", "default_type": "router", "category": "router"},
    "50d4f7": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "003192": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "0c8063": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "14ebb6": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "30b5c2": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "3460f9": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "50c7bf": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "54af97": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "704f57": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "7405a5": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "8416f9": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "984827": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "ac84c6": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "b04e26": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "c006c3": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "e4f042": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "e848b8": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "ec086b": {"vendor": "TP-Link", "default_type": "router", "category": "soho_router"},
    "0018e7": {"vendor": "D-Link", "default_type": "router", "category": "soho_router"},
    "14d64d": {"vendor": "D-Link", "default_type": "router", "category": "soho_router"},
    "28107b": {"vendor": "D-Link", "default_type": "router", "category": "soho_router"},
    "bc9680": {"vendor": "D-Link", "default_type": "router", "category": "soho_router"},
    "c0a0bb": {"vendor": "D-Link", "default_type": "router", "category": "soho_router"},
    "20e52a": {"vendor": "Netgear", "default_type": "router", "category": "soho_router"},
    "28c68e": {"vendor": "Netgear", "default_type": "router", "category": "soho_router"},
    "841b5e": {"vendor": "Netgear", "default_type": "router", "category": "soho_router"},
    "9c3dcf": {"vendor": "Netgear", "default_type": "router", "category": "soho_router"},
    "a00460": {"vendor": "Netgear", "default_type": "router", "category": "soho_router"},
    "c40415": {"vendor": "Netgear", "default_type": "router", "category": "soho_router"},
    "e0469a": {"vendor": "Netgear", "default_type": "router", "category": "soho_router"},
    "001a92": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "049226": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "08606e": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "107b44": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "14dda9": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "2c4d54": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "382c4a": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "704d7b": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "ac220b": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "d017c2": {"vendor": "ASUS", "default_type": "router", "category": "soho_router"},
    "00e0fc": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "200bc7": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "7054f5": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "f45c89": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "88cf98": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "d46e5c": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "0425c5": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "047970": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "0819a6": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "0c96bf": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "101b54": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "14b968": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "286ed4": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "4846fb": {"vendor": "Huawei", "default_type": "router", "category": "router"},
    "001e73": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "002293": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "0026ed": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "047e7b": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "0c1262": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "146080": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "288023": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "48282f": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "687251": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "74a78e": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "84742a": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "dc028e": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "e47723": {"vendor": "ZTE", "default_type": "router", "category": "router"},
    "001dae": {"vendor": "DrayTek Vigor", "default_type": "router", "category": "router"},
    "00507f": {"vendor": "DrayTek Vigor", "default_type": "router", "category": "router"},
    "1449bc": {"vendor": "DrayTek Vigor", "default_type": "router", "category": "router"},
    "001f12": {"vendor": "Juniper", "default_type": "router", "category": "router"},
    "002688": {"vendor": "Juniper", "default_type": "router", "category": "router"},
    "382056": {"vendor": "Juniper", "default_type": "router", "category": "router"},
    "5c5eab": {"vendor": "Juniper", "default_type": "router", "category": "router"},
    "841888": {"vendor": "Juniper", "default_type": "router", "category": "router"},
    "001a8c": {"vendor": "Sophos", "default_type": "router", "category": "security_gateway"},
    "0026b9": {"vendor": "Sophos", "default_type": "router", "category": "security_gateway"},
    "00016c": {"vendor": "Sophos", "default_type": "router", "category": "security_gateway"},
    "0012bf": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "001a2a": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "1883bf": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "24767d": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "84a423": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "d878e5": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "000e8f": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "0016e3": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "1868cb": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "60e327": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "789682": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},
    "c02567": {"vendor": "ISP Gateway", "default_type": "router", "category": "broadband_gateway"},

    # IoT & Embedded Microcontrollers
    "80646f": {"vendor": "Espressif", "default_type": "server", "category": "iot_embedded"},
    "244bfe": {"vendor": "Espressif", "default_type": "server", "category": "iot_embedded"},
    "ac67b2": {"vendor": "Espressif", "default_type": "server", "category": "iot_embedded"},
    "18fe34": {"vendor": "Espressif", "default_type": "server", "category": "iot_embedded"},
    "30aea4": {"vendor": "Espressif", "default_type": "server", "category": "iot_embedded"},
    "b827eb": {"vendor": "Raspberry Pi", "default_type": "server", "category": "single_board_computer"},
    "dca632": {"vendor": "Raspberry Pi", "default_type": "server", "category": "single_board_computer"},

    # Workstations & Endpoints
    "001b21": {"vendor": "Intel", "default_type": "server", "category": "workstation"},
    "a44cc8": {"vendor": "Intel", "default_type": "server", "category": "workstation"},
    "3c22fb": {"vendor": "Apple", "default_type": "server", "category": "mobile_client"},
    "f01898": {"vendor": "Apple", "default_type": "server", "category": "mobile_client"},
    "bc5436": {"vendor": "Apple", "default_type": "server", "category": "mobile_client"},

    # Storage & CCTV
    "001132": {"vendor": "Synology", "default_type": "server", "category": "nas_storage"},
    "00089b": {"vendor": "QNAP", "default_type": "server", "category": "nas_storage"},
    "4419b6": {"vendor": "Hikvision", "default_type": "server", "category": "cctv_camera"},
    "bcad28": {"vendor": "Hikvision", "default_type": "server", "category": "cctv_camera"},
}

def normalize_mac(mac: Optional[str]) -> Optional[str]:
    if not mac:
        return None
    cleaned = re.sub(r"[^0-9a-fA-F]", "", mac).lower()
    if len(cleaned) >= 6:
        return cleaned[:6]
    return None

def lookup_mac_vendor(mac: Optional[str]) -> Optional[Dict[str, Any]]:
    prefix = normalize_mac(mac)
    if prefix and prefix in MAC_OUI_DATABASE:
        return MAC_OUI_DATABASE[prefix]
    return None

def generate_smart_device_name(
    ip: str,
    dtype: str,
    vendor: Optional[str] = None,
    mac: Optional[str] = None,
    sys_name: Optional[str] = None,
    rdns_name: Optional[str] = None,
) -> str:
    """
    Multi-tiered smart naming engine:
    1. Valid SNMP sysName (e.g. Switch-Core)
    2. Local Reverse DNS hostname (e.g. Suphawit, android-9129)
    3. Core Network Infrastructure Role (e.g. Core-SW-254, Gateway-RTR-01)
    4. Hardware Vendor + Role + IP (e.g. Aruba-AP-21, ESP32-IoT-22, Cisco-SW-44)
    5. Clean Structured Fallback (e.g. SW-44-A1B2)
    """
    # 1. Valid SNMP sysName
    if sys_name:
        clean_sys = sys_name.strip()
        lower = clean_sys.lower()
        if clean_sys and not lower.startswith("no such") and not lower.startswith("host-") and not lower.startswith("dev-"):
            return clean_sys

    # 2. Reverse DNS hostname (strip corporate domain suffix)
    if rdns_name:
        clean_rdns = rdns_name.split(".")[0].strip()
        lower_rdns = clean_rdns.lower()
        if clean_rdns and not lower_rdns.startswith("host-") and not lower_rdns.startswith("unknown"):
            # Capitalize nicely if all lowercase
            if clean_rdns.islower() and len(clean_rdns) > 2:
                return clean_rdns[0].upper() + clean_rdns[1:]
            return clean_rdns

    last_octet = ip.split(".")[-1]

    # 3. Core Network Infrastructure Roles
    if ip.endswith(".254"):
        if dtype == "router":
            return f"{vendor or 'Gateway'}-RTR-254"
        return f"{vendor or 'Core'}-SW-254"
    if ip.endswith(".1"):
        if dtype == "switch":
            return f"{vendor or 'Core'}-SW-01"
        return f"{vendor or 'Gateway'}-RTR-01"
    if ip.endswith(".2"):
        if dtype == "router":
            return f"{vendor or 'Secondary'}-RTR-02"
        return f"{vendor or 'Dist'}-SW-02"
    if ip.endswith(".253"):
        if dtype == "router":
            return f"{vendor or 'Backup'}-RTR-253"
        return f"{vendor or 'Backup'}-SW-253"

    # 4. Hardware Vendor & Role
    prefix_map = {
        "switch": "SW",
        "router": "RTR",
        "ap": "AP",
        "server": "SRV",
    }
    type_code = prefix_map.get(dtype.lower(), "DEV")

    if vendor:
        v_clean = vendor.split("/")[0].replace(" Systems", "").replace(" Networks", "").strip()
        if "espressif" in v_clean.lower():
            return f"ESP32-IoT-{last_octet}"
        if "hikvision" in v_clean.lower() or "dahua" in v_clean.lower():
            return f"CCTV-{v_clean}-{last_octet}"
        if "raspberry" in v_clean.lower():
            return f"RPi-{last_octet}"
        if "synology" in v_clean.lower() or "qnap" in v_clean.lower():
            return f"NAS-{v_clean}-{last_octet}"
        return f"{v_clean}-{type_code}-{last_octet}"

    # 5. Clean Structured Fallback with MAC suffix if available
    if mac:
        mac_suffix = mac.replace(":", "").replace("-", "")[-4:].upper()
        return f"{type_code}-{last_octet}-{mac_suffix}"

    return f"{type_code}-{last_octet}"

def classify_device(
    ip: str,
    mac: Optional[str] = None,
    sys_descr: Optional[str] = None,
    sys_name: Optional[str] = None,
    sys_object_id: Optional[str] = None,
    sys_services: Optional[int] = None,
    ttl: Optional[int] = None,
    hostname: Optional[str] = None,
    is_gateway: Optional[bool] = None,
    ip_forwarding: Optional[int] = None,
) -> Tuple[str, int, str]:
    """
    High-precision multi-factor device classifier with first-class Router detection.
    Returns: (device_type: str, confidence_percent: int, reason_explanation: str)
    """
    reasons: List[str] = []
    scores = {"switch": 0, "router": 0, "ap": 0, "server": 0}

    combined_text = f"{sys_descr or ''} {sys_name or ''} {sys_object_id or ''}".lower()
    is_default_gw = is_gateway if is_gateway is not None else (ip.endswith(".1") and not ip.endswith(".254"))

    # Factor 1: SNMP sysServices (OSI layer bitmask)
    # Bit 1 (2): L2 Bridge (Switch)
    # Bit 2 (4): L3 Router (Gateway)
    # Bit 6 (64): L7 Applications (Host/Server)
    if sys_services is not None and sys_services > 0:
        is_l2 = bool(sys_services & 2)
        is_l3 = bool(sys_services & 4)
        is_l7 = bool(sys_services & 64)
        
        if is_l2 and is_l3:
            # Dual L2/L3 capability (common in routers with built-in switchports and L3 switches)
            if (is_default_gw and not ip.endswith(".254")) or any(k in combined_text for k in ["router", "rtr", "gateway", "routeros", "mikrotik", "c290", "c291", "c292", "c295", "c28", "c19", "c39", "isr"]):
                scores["router"] += 50
                scores["switch"] += 30
                reasons.append("SNMP L2/L3 Router (sysServices)")
            else:
                scores["switch"] += 45
                scores["router"] += 30
                reasons.append("SNMP L2/L3 Bridge (sysServices)")
        elif is_l3:
            scores["router"] += 55
            reasons.append("SNMP L3 Gateway (sysServices)")
        elif is_l2:
            scores["switch"] += 50
            reasons.append("SNMP L2 Bridge (sysServices)")
        elif is_l7:
            scores["server"] += 45
            reasons.append("SNMP L7 Host (sysServices)")

    # Factor 1.5: IP Forwarding (RFC 1213 OID .1.3.6.1.2.1.4.1.0)
    if ip_forwarding == 1:
        scores["router"] += 45
        reasons.append("IP Forwarding Enabled (Routing)")
    elif ip_forwarding == 2:
        scores["router"] -= 20

    # Factor 2: SNMP sysObjectID & sysDescr
    router_keywords = [
        "router", "routeros", "routerboard", "mikrotik", "rb750", "rb951", "rb1100", "rb2011", "rb3011", "rb4011", "rb5009", "ccr10", "ccr20", "hex ", "hap ",
        "fortigate", "fortinet", "fortios",
        "edgerouter", "edgeos", "er-x", "er-4", "er-8", "er-6", "udm", "usg",
        "openwrt", "dd-wrt", "tomato", "pfsense", "opnsense", "vyos", "vyatta", "ipfire",
        "draytek", "vigor",
        "cisco ios-xe router", "cisco ios software, c", "cisco ios software, 28", "cisco ios software, 19", "cisco ios software, 29", "cisco ios software, 39", "cisco ios software, 38", "cisco ios software, 8", "cisco ios software, 18", "cisco ios software, 72",
        "c881", "c891", "c111", "c1100", "c1921", "c1941", "c2901", "c2911", "c2921", "c2951", "c3925", "c3945", "isr4", "isr1", "isr 4", "asr1", "asr9", "catalyst 8200", "catalyst 8300", "csr1000v", "c8000v",
        "tp-link", "archer", "deco", "er605", "er7206",
        "dir-", "dsr-", "dwr-",
        "nighthawk", "orbi", "pr60x",
        "rt-ax", "rt-ac", "rt-n", "gt-ax", "zenwifi",
        "junos", "srx", "mx10", "mx40", "mx80", "mx104", "mx204",
        "netengine", "ar12", "ar1200", "ar2200", "ar3200", "ar6000",
        "sophos", "xg firewall", "xgs", "sonicwall", "watchguard", "firebox", "checkpoint",
        "border-rtr", "default gateway", "nat router", "gateway"
    ]
    matched_router = any(k in combined_text for k in router_keywords)
    if matched_router:
        scores["router"] += 55
        reasons.append("Enterprise Router keywords/MIB")

    switch_keywords = ["catalyst 2", "catalyst 3", "catalyst 9", "c9300", "c9500", "c2960", "procurve", "2930f", "jl261a", "nexus", "aruba"]
    if any(k in combined_text for k in switch_keywords) or ("switch" in combined_text and not matched_router):
        scores["switch"] += 50
        reasons.append("Enterprise Switch keywords/MIB")

    if any(k in combined_text for k in ["aironet", "catalyst 91", "access point", "unifi", "wireless ap", "wifi"]):
        scores["ap"] += 50
        reasons.append("Wireless AP keywords/MIB")

    if any(k in combined_text for k in ["windows server", "poweredge", "proliant", "esxi", "supermicro", "net-snmp"]):
        scores["server"] += 50
        reasons.append("Server OS / MIB")
    elif "linux" in combined_text and not matched_router:
        scores["server"] += 45
        reasons.append("Linux OS / MIB")

    # Factor 2.5: Hostname & DNS Clues (for non-SNMP hosts/IoT/mobile)
    if hostname:
        h_lower = hostname.lower()
        if any(k in h_lower for k in ["airpurifier", "purifier", "phone", "android", "iphone", "huawei-phone", "mate", "mediapad", "amazon", "kindle", "echo", "desktop", "laptop", "rog", "ufo", "tv", "esp32", "iot", "smart"]):
            scores["server"] += 50
            reasons.append(f"Host/IoT name clue ({hostname.split('.')[0]})")
        elif any(k in h_lower for k in [
            "-rtr", "router", "gateway", "-gw", "gw-", "core-gw", "inet-gw", "wan-gw",
            "-rt", "rt-", "mikrotik", "routeros", "edgerouter", "openwrt", "pfsense", "opnsense", "firewall", "-fw", "fw-", "archer", "vigor"
        ]):
            scores["router"] += 50
            reasons.append(f"Router name clue ({hostname})")
        elif any(k in h_lower for k in ["-ap", "accesspoint", "unifi", "uap"]):
            scores["ap"] += 45
            reasons.append(f"AP name clue ({hostname})")
        elif any(k in h_lower for k in ["-sw", "switch"]):
            scores["switch"] += 45
            reasons.append(f"Switch name clue ({hostname})")

    # Factor 3: MAC OUI Hardware Database
    vendor_info = lookup_mac_vendor(mac)
    if vendor_info:
        v_name = vendor_info["vendor"]
        v_type = vendor_info["default_type"]
        scores[v_type] += 45
        reasons.append(f"MAC OUI: {v_name}")

    # Factor 4: ICMP TTL Fingerprinting
    if ttl is not None and ttl > 0:
        if ttl >= 240: # Typically 255: Cisco IOS, ArubaOS, HP ProCurve
            scores["switch"] += 25
            scores["router"] += 25  # Cisco routers also have TTL 255
            reasons.append(f"TTL {ttl} (Network OS)")
        elif 100 <= ttl <= 135: # Typically 128: Windows Server / Host
            scores["server"] += 25
            reasons.append(f"TTL {ttl} (Windows OS)")
        elif 50 <= ttl <= 70: # Typically 64: Linux / Embedded APs / Appliances
            if is_default_gw:
                scores["router"] += 25
                reasons.append(f"TTL {ttl} (Gateway Appliance)")
            else:
                scores["ap"] += 15
                scores["server"] += 10
                reasons.append(f"TTL {ttl} (Linux/Embedded)")

    # Factor 5: IP Topology & Gateway Clues
    if is_default_gw:
        scores["router"] += 45
        reasons.append(f"Default Gateway IP ({ip})")
    elif ip.endswith(".254"):
        if scores["router"] > scores["switch"]:
            scores["router"] += 25
            reasons.append("Core Gateway IP (.254)")
        else:
            scores["switch"] += 35
            reasons.append("Core Switch IP (.254)")
    elif ip.endswith(".2") or ip.endswith(".253"):
        if scores["router"] > scores["switch"]:
            scores["router"] += 15
            reasons.append("Secondary Gateway IP")
        else:
            scores["switch"] += 20
            reasons.append("Distribution Switch IP")

    # Pick the highest scoring device type
    best_type = max(scores, key=scores.get)
    max_score = scores[best_type]

    # Calculate confidence percentage (capped between 60% and 99%)
    if max_score >= 80:
        confidence = min(99, 85 + (max_score // 10))
    elif max_score >= 40:
        confidence = min(84, 70 + (max_score // 5))
    elif max_score > 0:
        confidence = 70
    else:
        if is_default_gw:
            best_type = "router"
            confidence = 70
            reasons.append("Gateway IP default (.1)")
        else:
            best_type = "switch"
            confidence = 60
            reasons.append("Standard LAN default")

    reason_str = " + ".join(reasons[:3]) if reasons else "LAN probe default"
    return best_type, confidence, reason_str

def infer_floor(
    ip: str,
    hostname: Optional[str] = None,
    sys_location: Optional[str] = None,
    sys_descr: Optional[str] = None,
    wifi_bssid: Optional[str] = None,
    floor_split_threshold: int = 120,
    explicit_floor: Optional[int] = None,
    gps_floor: Optional[int] = None,
    gps_floor_reason: Optional[str] = None,
    room_label: Optional[str] = None,
) -> Tuple[int, str]:
    """
    High-Precision 3D Spatial Floor Classifier:
    1. Explicit floor tag from Geotag / sysLocation / sysDescr / Hostname (99% confidence)
    2. Altitude Z-axis relative height (98% confidence)
    3. 2D Spatial room geofencing exclusivity (95% confidence)
    4. Core Network infrastructure role (90% confidence)
    5. Subnet / IP range split fallback (80% confidence)
    """
    # Priority 1: Explicit Floor Geotag parameter or metadata
    if explicit_floor in (1, 2):
        return explicit_floor, f"Geotag ระบุชั้น {explicit_floor}"

    text = f"{sys_location or ''} {sys_descr or ''} {hostname or ''}".lower()
    if any(k in text for k in ["fl1", "fl-1", "floor 1", "floor-1", "1f", "f1-", "bld a - f1", "ชั้น 1", "ชั้น1"]):
        return 1, "ระบุ Floor 1 ใน Tag / Hostname"
    if any(k in text for k in ["fl2", "fl-2", "floor 2", "floor-2", "2f", "f2-", "bld a - f2", "ชั้น 2", "ชั้น2"]):
        return 2, "ระบุ Floor 2 ใน Tag / Hostname"

    # Priority 2: GPS Altitude Z-axis
    if gps_floor in (1, 2):
        return gps_floor, f"{gps_floor_reason or f'GPS Altitude -> ชั้น {gps_floor}'}"

    # Priority 3: 2D Spatial Geofencing (rooms exclusive to floor 1 or floor 2)
    if room_label:
        fl1_only_rooms = ["Server Room", "Network Core", "IT Office", "Zone D – Lounge"]
        fl2_only_rooms = ["Zone E – Office", "Zone F – Lab", "Zone G – Meeting", "Zone H – Lounge"]
        if room_label in fl1_only_rooms:
            return 1, f"พิกัดตกในห้อง {room_label} (เฉพาะชั้น 1)"
        if room_label in fl2_only_rooms:
            return 2, f"พิกัดตกในห้อง {room_label} (เฉพาะชั้น 2)"

    # Priority 4: Core Switch / Gateway is stationed on Floor 1
    if ip.endswith(".254") or ip.endswith(".1"):
        return 1, "Core Network Infrastructure -> ชั้น 1 (Network Core)"

    # Priority 5: Subnet / IP Range Rule
    try:
        last_octet = int(ip.split(".")[-1])
        if last_octet <= floor_split_threshold:
            return 1, f"ช่วง IP .1 - .{floor_split_threshold} -> ชั้น 1"
        else:
            return 2, f"ช่วง IP .{floor_split_threshold + 1} - .254 -> ชั้น 2"
    except Exception:
        pass

    return 1, "ตำแหน่งสัญญาณเริ่มต้น ชั้น 1"

