import asyncio
import ipaddress
import logging
import re
import socket
import subprocess
import time
from typing import List, Dict, Any, Optional, Tuple, Set
import asyncpg

from .snmp import snmp_get_oid, OID_SYS_DESCR, OID_SYS_NAME
from .config import settings
from .database import get_db_pool
from .placement import (
    pick_smart_spot,
    resolve_room_from_coords,
    extract_device_geodata,
    parse_gps_from_location,
    project_gps_to_canvas,
    canvas_to_gps,
    infer_floor_from_altitude,
)
from .classifier import (
    classify_device,
    infer_floor,
    lookup_mac_vendor,
    generate_smart_device_name,
)

logger = logging.getLogger("netmonitor.discovery")

OID_SYS_OBJECT_ID = ".1.3.6.1.2.1.1.2.0"
OID_SYS_LOCATION  = ".1.3.6.1.2.1.1.6.0"
OID_SYS_SERVICES  = ".1.3.6.1.2.1.1.7.0"
OID_IP_FORWARDING = ".1.3.6.1.2.1.4.1.0"

def detect_local_network_info() -> Dict[str, Any]:
    """
    Robustly detects the active physical LAN interface, its /24 subnet, dynamic ARP neighbors with MAC,
    and Wi-Fi signal/BSSID context.
    """
    interfaces_arp: Dict[str, List[str]] = {}
    ip_to_mac: Dict[str, str] = {}
    current_iface = None

    try:
        out = subprocess.check_output(["arp", "-a"], text=True, stderr=subprocess.DEVNULL)
        for line in out.splitlines():
            iface_match = re.search(r"Interface:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", line)
            if iface_match:
                current_iface = iface_match.group(1)
                interfaces_arp[current_iface] = []
                continue
            
            if current_iface:
                m = re.search(r"(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F-]+)\s+dynamic", line)
                if m:
                    ip = m.group(1)
                    mac = m.group(2).lower()
                    if not ip.startswith(("224.", "239.", "255.", "127.")):
                        interfaces_arp[current_iface].append(ip)
                        ip_to_mac[ip] = mac
    except Exception as e:
        logger.warning(f"Failed to read arp table: {e}")

    # Detect Wi-Fi Signal context (SSID, AP BSSID, Signal %, RSSI)
    wifi_ssid = None
    wifi_bssid = None
    wifi_signal = None
    try:
        wlan_out = subprocess.check_output(["netsh", "wlan", "show", "interfaces"], text=True, stderr=subprocess.DEVNULL)
        m_ssid = re.search(r"SSID\s*:\s*(.+)", wlan_out)
        m_bssid = re.search(r"AP BSSID\s*:\s*(.+)", wlan_out)
        m_sig = re.search(r"Signal\s*:\s*(.+)", wlan_out)
        if m_ssid: wifi_ssid = m_ssid.group(1).strip()
        if m_bssid: wifi_bssid = m_bssid.group(1).strip()
        if m_sig: wifi_signal = m_sig.group(1).strip()
    except Exception:
        pass

    # Fallback probe via UDP socket
    socket_ip = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            socket_ip = s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        pass

    # Pick the interface with the most active dynamic entries, preferring the socket IP if valid
    best_iface = socket_ip or "127.0.0.1"
    max_entries = -1
    for iface, ips in interfaces_arp.items():
        if not iface.startswith(("127.", "169.254.", "172.21.")) and len(ips) > max_entries:
            max_entries = len(ips)
            best_iface = iface

    if socket_ip and socket_ip in interfaces_arp and len(interfaces_arp[socket_ip]) > 0:
        best_iface = socket_ip

    # Dynamic active default gateway route lookup (Windows route print 0.0.0.0)
    detected_gw = None
    try:
        route_out = subprocess.check_output(["route", "print", "0.0.0.0"], text=True, stderr=subprocess.DEVNULL)
        for r_line in route_out.splitlines():
            m_gw = re.search(r"0\.0\.0\.0\s+0\.0\.0\.0\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})", r_line.strip())
            if m_gw:
                cand_gw = m_gw.group(1)
                if not cand_gw.startswith(("127.", "0.")):
                    detected_gw = cand_gw
                    break
    except Exception:
        pass

    parts = best_iface.split(".")
    if len(parts) == 4 and best_iface != "127.0.0.1":
        subnet = f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
        gateway = detected_gw or f"{parts[0]}.{parts[1]}.{parts[2]}.1"
    else:
        best_iface = "192.168.22.60"
        subnet = "192.168.22.0/24"
        gateway = detected_gw or "192.168.22.254"

    arp_ips = interfaces_arp.get(best_iface, [])

    return {
        "local_ip": best_iface,
        "detected_subnet": subnet,
        "gateway": gateway,
        "arp_ips": arp_ips,
        "ip_to_mac": ip_to_mac,
        "wifi_ssid": wifi_ssid,
        "wifi_bssid": wifi_bssid,
        "wifi_signal": wifi_signal,
    }

def _run_ping_sync(cmd: list[str], timeout_s: float) -> tuple[int, str]:
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_s,
        )
        return res.returncode, res.stdout.decode("utf-8", errors="replace").lower()
    except Exception:
        return 1, ""

async def ping_ip(ip: str, timeout_ms: int = 250) -> tuple[bool, float, Optional[int]]:
    """
    Executes a fast ICMP ping on Windows with 250ms timeout.
    Returns: (is_alive: bool, rtt_ms: float, ttl: Optional[int])
    """
    cmd = ["ping", "-n", "1", "-w", str(timeout_ms), ip]
    t0 = time.perf_counter()
    try:
        returncode, output = await asyncio.to_thread(
            _run_ping_sync, cmd, (timeout_ms / 1000.0) + 0.5
        )
        rtt_ms = (time.perf_counter() - t0) * 1000.0
        if returncode == 0 and ("reply from" in output or "bytes=" in output or "ไบต์=" in output or "ttl=" in output):
            ttl_match = re.search(r"ttl=(\d+)", output)
            ttl = int(ttl_match.group(1)) if ttl_match else None
            return True, round(rtt_ms, 1), ttl
    except Exception:
        pass
    return False, 0.0, None

async def async_get_rdns(ip: str, timeout_s: float = 0.25) -> Optional[str]:
    """
    Non-blocking Reverse DNS lookup with strict 250ms timeout.
    """
    try:
        loop = asyncio.get_running_loop()
        res = await asyncio.wait_for(
            loop.run_in_executor(None, socket.gethostbyaddr, ip),
            timeout=timeout_s,
        )
        return res[0]
    except Exception:
        return None

def parse_candidate_communities(community: Optional[str]) -> List[str]:
    """
    Parses candidate community strings for Net-SNMP discovery.
    Supports single community, comma/semicolon/space-separated list,
    or automatic multi-probe fallback when empty.
    """
    if community and community.strip():
        parts = [c.strip() for c in re.split(r"[,;\s]+", community) if c.strip()]
        candidates = []
        for c in parts:
            if c not in candidates:
                candidates.append(c)
        return candidates

    candidates = []
    if getattr(settings, "SNMP_COMMUNITY", None) and settings.SNMP_COMMUNITY.strip():
        candidates.append(settings.SNMP_COMMUNITY.strip())

    for default_c in ["public", "private", "read", "monitor", "cisco", "internal", "snmp"]:
        if default_c not in candidates:
            candidates.append(default_c)
    return candidates

async def probe_single_ip(
    ip: str,
    candidate_communities: List[str],
    snmp_port: int,
    existing_ips: set[str],
    mac_dict: Dict[str, str],
    wifi_context: Dict[str, Any],
    floor_split_threshold: int,
    semaphore: asyncio.Semaphore,
    building_bounds: Optional[Any] = None,
    ground_altitude: Optional[float] = None,
    floor_rooms: Optional[Dict[int, List[Any]]] = None,
    detected_gateway: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    async with semaphore:
        mac = mac_dict.get(ip)
        is_in_arp = ip in mac_dict
        is_core = ip.endswith(".254") or ip.endswith(".1")

        # Step 1: Fast ICMP Ping check (200ms timeout)
        ping_alive, rtt_ms, ttl = await ping_ip(ip, timeout_ms=200)

        # If not responding to ping and not in ARP and not core gateway, drop immediately
        if not ping_alive and not is_in_arp and not is_core:
            return None

        # Step 2: Query SNMP across candidate communities (without forcing 'public')
        snmp_success = False
        sys_descr = None
        matched_community = None
        snmp_timeout = 1.5 if is_core else 0.8
        
        if ping_alive or is_in_arp or is_core:
            for candidate_comm in candidate_communities:
                ok, descr_val, _ = await snmp_get_oid(
                    ip=ip, oid=OID_SYS_DESCR, community=candidate_comm, port=snmp_port, timeout_s=snmp_timeout, retries=0
                )
                if ok:
                    snmp_success = True
                    sys_descr = descr_val
                    matched_community = candidate_comm
                    break

        if not snmp_success and not ping_alive and not is_in_arp:
            return None

        sys_name = None
        sys_object_id = None
        sys_location = None
        sys_services_int = None
        sys_fwd_int = None
        rdns_val = None

        if snmp_success and matched_community:
            # Query rich SNMP metadata in parallel using the confirmed working community
            name_task = snmp_get_oid(ip=ip, oid=OID_SYS_NAME, community=matched_community, port=snmp_port, timeout_s=snmp_timeout, retries=0)
            obj_task  = snmp_get_oid(ip=ip, oid=OID_SYS_OBJECT_ID, community=matched_community, port=snmp_port, timeout_s=snmp_timeout, retries=0)
            loc_task  = snmp_get_oid(ip=ip, oid=OID_SYS_LOCATION, community=matched_community, port=snmp_port, timeout_s=snmp_timeout, retries=0)
            srv_task  = snmp_get_oid(ip=ip, oid=OID_SYS_SERVICES, community=matched_community, port=snmp_port, timeout_s=snmp_timeout, retries=0)
            fwd_task  = snmp_get_oid(ip=ip, oid=OID_IP_FORWARDING, community=matched_community, port=snmp_port, timeout_s=snmp_timeout, retries=0)
            rdns_task = async_get_rdns(ip, timeout_s=0.25)
            
            (_, s_name, _), (_, obj_id, _), (_, loc_val, _), (_, srv_val, _), (_, fwd_val, _), rdns_res = await asyncio.gather(
                name_task, obj_task, loc_task, srv_task, fwd_task, rdns_task
            )
            sys_name = s_name
            sys_object_id = obj_id
            sys_location = loc_val
            rdns_val = rdns_res
            try:
                sys_services_int = int(srv_val) if srv_val else None
            except ValueError:
                sys_services_int = None
            try:
                sys_fwd_int = int(fwd_val) if fwd_val else None
            except ValueError:
                sys_fwd_int = None
        else:
            rdns_val = await async_get_rdns(ip, timeout_s=0.25)

        mac = mac_dict.get(ip)
        vendor_info = lookup_mac_vendor(mac)
        vendor_name = vendor_info["vendor"] if vendor_info else None

        # High-Precision Multi-Factor Classification
        is_gw = bool((detected_gateway and ip == detected_gateway) or (ip.endswith(".1") and not ip.endswith(".254")))
        dtype, confidence, reason = classify_device(
            ip=ip,
            mac=mac,
            sys_descr=sys_descr,
            sys_name=sys_name,
            sys_object_id=sys_object_id,
            sys_services=sys_services_int,
            ttl=ttl,
            hostname=rdns_val or sys_name,
            is_gateway=is_gw,
            ip_forwarding=sys_fwd_int,
        )

        # Smart Multi-Tier Device Naming (SNMP sysName -> Reverse DNS -> Core Role -> Vendor/Role -> Clean Identifier)
        smart_hostname = generate_smart_device_name(
            ip=ip,
            dtype=dtype,
            vendor=vendor_name,
            mac=mac,
            sys_name=sys_name,
            rdns_name=rdns_val,
        )

        # Multi-Source GPS & Geotag Extraction (sys_location, sys_descr, sys_name)
        lat, lon, alt, explicit_fl = extract_device_geodata(sys_location)
        gps_source = "sys_location" if lat is not None else None

        if (lat is None or alt is None or explicit_fl is None) and sys_descr:
            d_lat, d_lon, d_alt, d_fl = extract_device_geodata(sys_descr)
            if lat is None and d_lat is not None:
                lat, lon = d_lat, d_lon
                gps_source = "sys_descr"
            if alt is None and d_alt is not None:
                alt = d_alt
            if explicit_fl is None and d_fl is not None:
                explicit_fl = d_fl

        if (lat is None or alt is None or explicit_fl is None) and sys_name:
            n_lat, n_lon, n_alt, n_fl = extract_device_geodata(sys_name)
            if lat is None and n_lat is not None:
                lat, lon = n_lat, n_lon
                gps_source = "sys_name"
            if alt is None and n_alt is not None:
                alt = n_alt
            if explicit_fl is None and n_fl is not None:
                explicit_fl = n_fl

        # Check preliminary room placement if GPS is present
        preview_room = None
        if lat is not None and lon is not None:
            _, _, preview_room = project_gps_to_canvas(lat, lon, 1, building_bounds, custom_rooms=floor_rooms)

        # Altitude Z-axis inference
        gps_floor = None
        gps_floor_reason = None
        if alt is not None:
            gps_floor, gps_floor_reason = infer_floor_from_altitude(alt, ground_altitude)

        # High-Precision Multi-Factor Floor Inference
        detected_floor, floor_reason = infer_floor(
            ip=ip,
            hostname=smart_hostname,
            sys_location=sys_location,
            sys_descr=sys_descr,
            wifi_bssid=wifi_context.get("wifi_bssid"),
            floor_split_threshold=floor_split_threshold,
            explicit_floor=explicit_fl,
            gps_floor=gps_floor,
            gps_floor_reason=gps_floor_reason,
            room_label=preview_room,
        )

        return {
            "ip": ip,
            "hostname": smart_hostname,
            "sys_descr": sys_descr,
            "dtype": dtype,
            "snmp_ok": snmp_success,
            "community": matched_community or (candidate_communities[0] if candidate_communities else "public"),
            "response_time_ms": rtt_ms if rtt_ms > 0 else 4.0,
            "already_exists": ip in existing_ips,
            "confidence": confidence,
            "reason": reason,
            "detected_floor": detected_floor,
            "floor_reason": floor_reason,
            "mac": mac,
            "latitude": lat,
            "longitude": lon,
            "altitude": alt,
            "gps_source": gps_source,
        }

async def scan_network_cidr(
    cidr: Optional[str] = "auto",
    community: Optional[str] = None,
    snmp_port: int = 161,
    scan_mode: Optional[str] = None, # Kept for backward compatibility
    floor_split_threshold: int = 120,
    max_hosts: int = 256,
    building_bounds: Optional[Any] = None,
    auto_assign_gps: bool = True,
    floor_rooms: Optional[Dict[int, List[Any]]] = None,
) -> List[Dict[str, Any]]:
    net_info = detect_local_network_info()
    candidate_communities = parse_candidate_communities(community)
    
    # If cidr is auto or empty, use detected subnet
    target_cidr = cidr.strip() if cidr and cidr.strip() and cidr.strip().lower() != "auto" else net_info["detected_subnet"]

    try:
        network = ipaddress.ip_network(target_cidr, strict=False)
    except ValueError as e:
        raise ValueError(f"Invalid CIDR notation: {e}")

    arp_set = set(net_info.get("arp_ips", []))
    mac_dict = net_info.get("ip_to_mac", {})
    wifi_context = {
        "wifi_ssid": net_info.get("wifi_ssid"),
        "wifi_bssid": net_info.get("wifi_bssid"),
        "wifi_signal": net_info.get("wifi_signal"),
    }

    hosts_list = [str(ip) for ip in network.hosts()]
    if not hosts_list:
        hosts_list = [str(network.network_address)]

    # Fetch existing devices in database to flag already_exists
    pool = await get_db_pool()
    rows = await pool.fetch("SELECT host(management_ip) as ip, name, floor, x, y FROM devices")
    existing_ips = {r["ip"] for r in rows if r["ip"]}
    existing_names = {r["name"].lower() for r in rows if r["name"]}
    placed_list = [dict(r) for r in rows if r["x"] is not None and r["y"] is not None]

    # Ultra-Fast, Non-Blocking Target Selection:
    # 1. ARP active neighbors detected on physical LAN
    # 2. Key network infrastructure (.1, .254, .2, .253, and host IP)
    core_suffixes = [".1", ".254", ".2", ".253", f".{net_info['local_ip'].split('.')[-1]}"]
    core_ips = [ip for ip in hosts_list if any(ip.endswith(s) for s in core_suffixes)]
    arp_in_network = [ip for ip in hosts_list if ip in arp_set]

    is_local_subnet = (target_cidr == net_info.get("detected_subnet"))

    seen = set()
    all_hosts = []
    for ip in (arp_in_network + core_ips):
        if ip not in seen:
            seen.add(ip)
            all_hosts.append(ip)

    # If user explicitly scanned a non-local custom subnet, include remaining hosts
    if not is_local_subnet:
        for ip in hosts_list:
            if ip not in seen:
                seen.add(ip)
                all_hosts.append(ip)

    all_hosts = all_hosts[:max_hosts]

    ground_alt = None
    if building_bounds:
        ground_alt = getattr(building_bounds, "ground_altitude", None) if not isinstance(building_bounds, dict) else building_bounds.get("ground_altitude")

    # Safe concurrency limit: 20 workers prevents OS process exhaustion & Uvicorn starvation
    semaphore = asyncio.Semaphore(20)
    tasks = [
        probe_single_ip(
            ip=ip,
            candidate_communities=candidate_communities,
            snmp_port=snmp_port,
            existing_ips=existing_ips,
            mac_dict=mac_dict,
            wifi_context=wifi_context,
            floor_split_threshold=floor_split_threshold,
            semaphore=semaphore,
            building_bounds=building_bounds,
            ground_altitude=ground_alt,
            floor_rooms=floor_rooms,
            detected_gateway=net_info.get("gateway"),
        )
        for ip in all_hosts
    ]

    results = await asyncio.gather(*tasks)
    discovered = [r for r in results if r is not None]

    # Dynamic Ground Altitude Calibration if building_bounds had none
    if ground_alt is None:
        all_altitudes = [d["altitude"] for d in discovered if d.get("altitude") is not None]
        if all_altitudes:
            ground_alt = min(all_altitudes)
            # Re-calibrate altitude floor inference using minimum observed altitude
            for d in discovered:
                if d.get("altitude") is not None and "Geotag" not in (d.get("floor_reason") or ""):
                    alt_fl, alt_reason = infer_floor_from_altitude(d["altitude"], ground_alt)
                    if alt_fl is not None:
                        d["detected_floor"] = alt_fl
                        d["floor_reason"] = alt_reason

    # Sort priority: SNMP-enabled core devices first, then unimported, then by IP
    discovered.sort(
        key=lambda d: (
            not d["snmp_ok"],
            not (d["ip"].endswith(".254") or d["ip"].endswith(".1")),
            d["already_exists"],
            socket.inet_aton(d["ip"])
        )
    )
    
    # Calculate preview positions and target room classification per detected floor
    simulated_placed = list(placed_list)
    for d in discovered:
        # Check name deduplication as well
        if d["hostname"] and d["hostname"].lower() in existing_names:
            d["already_exists"] = True
            
        target_fl = d["detected_floor"]
        if d.get("latitude") is not None and d.get("longitude") is not None:
            # High-precision GPS Georeferencing
            px, py, room_name = project_gps_to_canvas(d["latitude"], d["longitude"], target_fl, building_bounds, custom_rooms=floor_rooms)
            d["preview_x"] = px
            d["preview_y"] = py
            d["target_room"] = room_name
            if not d.get("floor_reason") or "ช่วง IP" in d.get("floor_reason", ""):
                d["floor_reason"] = f"GPS ({d['latitude']:.4f}, {d['longitude']:.4f}) -> {room_name or f'ชั้น {target_fl}'}"
        else:
            px, py, room_name = pick_smart_spot(simulated_placed, target_fl, d["dtype"], custom_rooms=floor_rooms)
            d["preview_x"] = px
            d["preview_y"] = py
            d["target_room"] = room_name
            simulated_placed.append({"floor": target_fl, "x": px, "y": py})

            # Auto-assign GPS coordinates to devices without native GPS
            if auto_assign_gps and building_bounds:
                auto_lat, auto_lon = canvas_to_gps(px, py, building_bounds)
                d["latitude"] = auto_lat
                d["longitude"] = auto_lon
                d["gps_source"] = "auto_inherited"

    return discovered
