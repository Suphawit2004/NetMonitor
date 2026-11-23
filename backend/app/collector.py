import asyncio
import os
import subprocess
import re
import math
import logging
from typing import Optional, Dict, Any, Tuple, List
from datetime import datetime, timezone, timedelta
from .config import settings
from .snmp import sanitize_snmp_community

logger = logging.getLogger("netmonitor.collector")

def calculate_bandwidth_mbps(
    curr_octets: int,
    prev_octets: int,
    dt_seconds: float,
    is_64bit: bool = True,
    max_speed_bps: Optional[int] = None,
) -> float:
    """
    Calculates bandwidth throughput in Megabits per second (Mbps).
    Formula: ((curr - prev) * 8) / (dt_seconds * 1,000,000)
    Handles counter wrap-around for both 32-bit and 64-bit SNMP counters.
    """
    if dt_seconds < 0.5 or curr_octets is None or prev_octets is None:
        return 0.0

    delta = curr_octets - prev_octets
    if delta < 0:
        if is_64bit:
            # 64-bit counter rollover only occurs if prev_octets was genuinely near 2^64
            if prev_octets > (2**64 - 100_000_000_000):
                delta += 2**64
            else:
                # Counter reset or restart
                delta = 0
        else:
            # 32-bit counter rollover occurs at 4.29 GB
            delta += 2**32

    bps = (delta * 8) / dt_seconds
    mbps = round(bps / 1_000_000, 2)

    # Sanity guard against anomaly spike beyond 120% of interface speed (default max 10 Gbps)
    speed_limit = max_speed_bps if (max_speed_bps and max_speed_bps > 0) else 10_000_000_000
    max_mbps = round((speed_limit / 1_000_000) * 1.2, 2)
    if mbps > max_mbps:
        return max_mbps

    return max(0.0, mbps)

def format_uptime(val: Optional[str]) -> Optional[str]:
    """Formats SNMP sysUpTime string or timeticks into clean readable format (e.g. 24d 1h 30m)."""
    if not val:
        return None
    val = val.strip().strip('"')
    if not val or val == "0":
        return None
    if "day" in val.lower():
        return val
    parts = val.split(":")
    if len(parts) >= 3:
        try:
            if len(parts) == 4:
                days, hours, mins = int(parts[0]), int(parts[1]), int(parts[2])
                return f"{days}d {hours}h {mins}m"
            elif len(parts) == 3:
                hours, mins = int(parts[0]), int(parts[1])
                return f"{hours}h {mins}m"
        except ValueError:
            pass
    if val.isdigit():
        total_sec = int(val) // 100
        days = total_sec // 86400
        hours = (total_sec % 86400) // 3600
        mins = (total_sec % 3600) // 60
        if days > 0:
            return f"{days}d {hours}h {mins}m"
        elif hours > 0:
            return f"{hours}h {mins}m"
        else:
            return f"{mins}m"
    return val

def parse_snmpwalk_output(text: str) -> Dict[int, str]:
    """
    Parses standard Net-SNMP snmpwalk output lines like:
    IF-MIB::ifDescr.1 = STRING: 1
    RFC1213-MIB::ifOperStatus.1 = INTEGER: up(1)
    .1.3.6.1.2.1.31.1.1.1.6.1 = Counter64: 19237346090
    RFC1213-MIB::ifPhysAddress.1 = Hex-STRING: 8C 85 C1 83 92 FF
    Returns a dictionary mapping interface index (int) to clean string value.
    """
    results: Dict[int, str] = {}
    pattern = re.compile(r"\.(\d+)\s*=\s*(?:[A-Za-z0-9\-]+:\s*)?\"?([^\"\r\n]+)\"?")
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = pattern.search(line)
        if m:
            idx = int(m.group(1))
            val = m.group(2).strip()
            # Clean enum format like "up(1)" -> "up"
            if "(" in val and val.endswith(")"):
                val = val.split("(")[0].strip()
            # If Hex-STRING MAC address e.g. "8C 85 C1 83 92 FF" -> format as "8C:85:C1:83:92:FF"
            parts = val.split()
            if len(parts) == 6 and all(len(p) <= 2 and all(c in "0123456789abcdefABCDEF" for c in p) for p in parts):
                val = ":".join(p.zfill(2).upper() for p in parts)
            results[idx] = val
    return results

def _run_snmpwalk_sync(cmd: List[str], timeout_s: float) -> Tuple[int, bytes, bytes]:
    env = os.environ.copy()
    env["MIBS"] = ""
    if os.name == "nt" and r"C:\usr\bin" not in env.get("PATH", ""):
        env["PATH"] = r"C:\usr\bin;" + env.get("PATH", "")
    try:
        res = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_s,
            env=env,
        )
        return res.returncode, res.stdout, res.stderr
    except subprocess.TimeoutExpired:
        return 1, b"", b"SNMP walk timed out"
    except Exception as e:
        return 1, b"", str(e).encode("utf-8")

async def execute_snmpwalk(
    ip: str,
    oid: str,
    community: str = "public",
    port: int = 161,
    version: str = "2c",
    timeout_s: int = 2,
    extra_flags: Optional[List[str]] = None,
) -> Dict[int, str]:
    """
    Executes Net-SNMP CLI snmpwalk asynchronously using a worker thread
    to ensure full compatibility with Windows event loop policies (avoiding NotImplementedError).
    """
    safe_community = sanitize_snmp_community(community)
    safe_version = "1" if str(version).lstrip("v") == "1" else "2c"
    cmd = [
        "snmpwalk",
        f"-v{safe_version}",
        f"-c{safe_community}",
        f"-t{timeout_s}",
        "-r1",
    ]
    if extra_flags:
        cmd.extend(extra_flags)
    cmd.extend([
        f"{ip}:{port}",
        oid,
    ])
    try:
        returncode, stdout, stderr = await asyncio.to_thread(
            _run_snmpwalk_sync, cmd, timeout_s * 2 + 1.0
        )
        if returncode == 0:
            return parse_snmpwalk_output(stdout.decode("utf-8", errors="replace"))
        else:
            err_msg = stderr.decode('utf-8', errors='replace').strip()
            if "timeout" in err_msg.lower() or "no response" in err_msg.lower():
                logger.debug(f"snmpwalk timeout for {ip} {oid}: {err_msg}")
            else:
                logger.warning(f"snmpwalk returncode {returncode} for {ip} {oid}: {err_msg}")
    except Exception as e:
        logger.debug(f"snmpwalk failed for {ip} {oid}: {e}")
    return {}

async def collect_device_interfaces(
    ip: str,
    community: str = "public",
    port: int = 161,
    version: str = "2c",
) -> List[Dict[str, Any]]:
    """
    Collects interfaces and their latest octet counters from a network device via SNMP.
    Runs independent OID walks concurrently to avoid sequential waterfall latency.
    """
    # 1. Query Descr first; bail early if SNMP does not respond
    descr_map = await execute_snmpwalk(ip, ".1.3.6.1.2.1.2.2.1.2", community, port, version)
    if not descr_map:
        return []

    # 2. Query status, speed, MAC, and 64-bit HC counters concurrently
    oper_map, speed_map, mac_map, hc_in, hc_out = await asyncio.gather(
        execute_snmpwalk(ip, ".1.3.6.1.2.1.2.2.1.8", community, port, version),
        execute_snmpwalk(ip, ".1.3.6.1.2.1.31.1.1.1.15", community, port, version),
        execute_snmpwalk(ip, ".1.3.6.1.2.1.2.2.1.6", community, port, version, extra_flags=["-Ox"]),
        execute_snmpwalk(ip, ".1.3.6.1.2.1.31.1.1.1.6", community, port, version),
        execute_snmpwalk(ip, ".1.3.6.1.2.1.31.1.1.1.10", community, port, version),
    )

    # 3. Fallback concurrently to 32-bit counters when HC counters are unavailable
    fallback_tasks = []
    if not hc_in:
        fallback_tasks.append(("in", execute_snmpwalk(ip, ".1.3.6.1.2.1.2.2.1.10", community, port, version)))
    if not hc_out:
        fallback_tasks.append(("out", execute_snmpwalk(ip, ".1.3.6.1.2.1.2.2.1.16", community, port, version)))
    if fallback_tasks:
        results_32 = await asyncio.gather(*(t for _, t in fallback_tasks))
        for (direction, _), res_map in zip(fallback_tasks, results_32):
            if direction == "in":
                hc_in = res_map
            else:
                hc_out = res_map

    interfaces = []
    for idx, name in descr_map.items():
        oper = oper_map.get(idx, "unknown").lower()
        if oper in ["1", "up"]:
            oper = "up"
        elif oper in ["2", "down"]:
            oper = "down"

        high_speed = int(speed_map.get(idx, 0)) if speed_map.get(idx, "").isdigit() else 0
        speed_bps = high_speed * 1_000_000 if high_speed > 0 else None

        in_oct_str = hc_in.get(idx, "")
        out_oct_str = hc_out.get(idx, "")
        in_oct = int(in_oct_str) if in_oct_str.isdigit() else None
        out_oct = int(out_oct_str) if out_oct_str.isdigit() else None

        raw_mac = mac_map.get(idx, "")
        mac_addr = raw_mac if (raw_mac and ":" in raw_mac and len(raw_mac) == 17) else None

        interfaces.append({
            "if_index": idx,
            "name": name,
            "description": f"Port {name}",
            "mac_address": mac_addr,
            "speed_bps": speed_bps,
            "oper_status": oper,
            "in_octets": in_oct,
            "out_octets": out_oct,
        })

    return interfaces

async def sync_device_interfaces(pool, device_id: int, interfaces: List[Dict[str, Any]]) -> Dict[int, int]:
    """
    Batch-upserts interfaces into PostgreSQL and returns mapping {if_index: db_interface_id}.
    """
    if not interfaces:
        return {}
    if_indices = [iface["if_index"] for iface in interfaces]
    names = [iface["name"] for iface in interfaces]
    descriptions = [iface.get("description") for iface in interfaces]
    macs = [iface.get("mac_address") for iface in interfaces]
    speeds = [iface.get("speed_bps") for iface in interfaces]
    opers = [iface.get("oper_status") for iface in interfaces]

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            INSERT INTO interfaces (device_id, if_index, name, description, mac_address, speed_bps, oper_status)
            SELECT $1, u.if_index, u.name, u.description, u.mac_address, u.speed_bps, u.oper_status
            FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::text[])
                 AS u(if_index, name, description, mac_address, speed_bps, oper_status)
            ON CONFLICT (device_id, if_index) DO UPDATE
            SET name = EXCLUDED.name,
                description = EXCLUDED.description,
                mac_address = COALESCE(EXCLUDED.mac_address, interfaces.mac_address),
                speed_bps = EXCLUDED.speed_bps,
                oper_status = EXCLUDED.oper_status
            RETURNING id, if_index;
            """,
            device_id, if_indices, names, descriptions, macs, speeds, opers,
        )
    return {row["if_index"]: row["id"] for row in rows}

async def collect_device_real_telemetry(
    ip: str,
    community: str = "public",
    port: int = 161,
    version: str = "2c",
) -> Dict[str, Any]:
    from .discovery import probe_device_reachability
    from .snmp import snmp_get_oid, OID_SYS_UPTIME

    # 1. Reachability test (ICMP Ping with single retry + TCP liveness fallback for ICMP-blocking hosts)
    is_alive, ping_ms, _, _ = await probe_device_reachability(
        ip,
        ping_timeout_ms=600,
        retry_timeout_ms=1000,
        tcp_timeout_s=0.35,
    )
    packet_loss = 0.0 if is_alive else 100.0

    # 2. Query uptime + vendor CPU OIDs concurrently when reachable
    uptime_raw = None
    formatted_uptime = None
    cpu_pct = None
    mem_pct = None
    temp_c = None

    if is_alive:
        (
            (ok_up, val_up, _),
            (ok_hp_cpu, val_hp_cpu, _),
            (ok_cisco_cpu, val_cisco_cpu, _),
            (ok_hr_cpu, val_hr_cpu, _),
        ) = await asyncio.gather(
            snmp_get_oid(ip, OID_SYS_UPTIME, community=community, version=version, port=port),
            snmp_get_oid(ip, ".1.3.6.1.4.1.11.2.14.11.5.1.9.6.1.0", community, version, port),
            snmp_get_oid(ip, ".1.3.6.1.4.1.9.9.109.1.1.1.1.5.1", community, version, port),
            snmp_get_oid(ip, ".1.3.6.1.2.1.25.3.3.1.2.1", community, version, port),
        )
        if ok_up and val_up:
            uptime_raw = val_up
            formatted_uptime = format_uptime(val_up)

        if ok_hp_cpu and val_hp_cpu and val_hp_cpu.isdigit():
            cpu_pct = float(val_hp_cpu)
            (_, tot_mem, _), (_, used_mem, _) = await asyncio.gather(
                snmp_get_oid(ip, ".1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.5.1", community, version, port),
                snmp_get_oid(ip, ".1.3.6.1.4.1.11.2.14.11.5.1.1.2.1.1.1.7.1", community, version, port),
            )
            if tot_mem and used_mem and tot_mem.isdigit() and used_mem.isdigit() and int(tot_mem) > 0:
                mem_pct = round((int(used_mem) / int(tot_mem)) * 100, 1)
        elif ok_cisco_cpu and val_cisco_cpu and val_cisco_cpu.isdigit():
            cpu_pct = float(val_cisco_cpu)
            (_, used_m, _), (_, free_m, _), (_, temp_val, _) = await asyncio.gather(
                snmp_get_oid(ip, ".1.3.6.1.4.1.9.9.48.1.1.1.5.1", community, version, port),
                snmp_get_oid(ip, ".1.3.6.1.4.1.9.9.48.1.1.1.6.1", community, version, port),
                snmp_get_oid(ip, ".1.3.6.1.4.1.9.9.13.1.3.1.3.1", community, version, port),
            )
            if used_m and free_m and used_m.isdigit() and free_m.isdigit() and (int(used_m) + int(free_m)) > 0:
                u, f = int(used_m), int(free_m)
                mem_pct = round((u / (u + f)) * 100, 1)
            if temp_val and temp_val.isdigit():
                temp_c = float(temp_val)
        elif ok_hr_cpu and val_hr_cpu and val_hr_cpu.isdigit():
            cpu_pct = float(val_hr_cpu)

    return {
        "is_alive": is_alive,
        "ping_ms": ping_ms if is_alive else None,
        "packet_loss": packet_loss,
        "uptime": formatted_uptime,
        "uptime_raw": uptime_raw,
        "cpu_percent": cpu_pct,
        "memory_percent": mem_pct,
        "temperature_c": temp_c,
    }

async def poll_and_calculate_device_traffic(
    pool,
    device_id: int,
    ip: str,
    community: str = "public",
    port: int = 161,
    version: str = "2c"
) -> Dict[str, Any]:
    """
    Polls device interfaces via SNMP, stores sample, and calculates latest delta Mbps per interface and total.
    """
    interfaces, telemetry = await asyncio.gather(
        collect_device_interfaces(ip, community, port, version),
        collect_device_real_telemetry(ip, community, port, version),
    )
    now = datetime.now(timezone.utc)

    # Batch-insert real telemetry metrics (including sys_uptime) into database
    metric_rows = []
    if telemetry.get("cpu_percent") is not None:
        metric_rows.append((device_id, now, "cpu", "cpu_usage_percent", telemetry["cpu_percent"], None))
    if telemetry.get("memory_percent") is not None:
        metric_rows.append((device_id, now, "memory", "memory_usage_percent", telemetry["memory_percent"], None))
    if telemetry.get("temperature_c") is not None:
        metric_rows.append((device_id, now, "temperature", "chassis_temperature_c", telemetry["temperature_c"], None))
    if telemetry.get("is_alive") and telemetry.get("ping_ms") is not None:
        metric_rows.append((device_id, now, "ping", "ping_rtt_ms", telemetry["ping_ms"], None))
    if telemetry.get("uptime"):
        metric_rows.append((device_id, now, "uptime", "sys_uptime", None, telemetry["uptime"]))

    if metric_rows:
        async with pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO device_metric_samples (device_id, sampled_at, oid, metric_name, numeric_value, text_value)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (device_id, sampled_at, oid, labels) DO NOTHING
                """,
                metric_rows,
            )

    if not interfaces:
        return {
            "success": telemetry.get("is_alive", False),
            "has_snmp": False,
            "interfaces_polled": 0,
            "total_in_mbps": 0.0,
            "total_out_mbps": 0.0,
            "timestamp": now.isoformat(),
            "interfaces": [],
            "uptime": telemetry.get("uptime"),
            "mac_address": None,
            "ping_ms": telemetry.get("ping_ms"),
            "cpu_percent": telemetry.get("cpu_percent"),
            "memory_percent": telemetry.get("memory_percent"),
            "temperature_c": telemetry.get("temperature_c"),
        }

    # Upsert interfaces and obtain IDs
    if_id_map = await sync_device_interfaces(pool, device_id, interfaces)

    total_in_mbps = 0.0
    total_out_mbps = 0.0
    interface_results = []
    primary_mac = next((iface["mac_address"] for iface in interfaces if iface.get("mac_address")), None)

    # Batch-fetch previous latest sample and batch-insert current samples
    db_if_ids = [if_id_map[iface["if_index"]] for iface in interfaces if iface["if_index"] in if_id_map]
    prev_by_if: Dict[int, Any] = {}
    samples_to_insert: List[Tuple[int, datetime, int, int]] = []

    async with pool.acquire() as conn:
        if db_if_ids:
            prev_rows = await conn.fetch(
                """
                SELECT DISTINCT ON (interface_id) interface_id, sampled_at, in_octets, out_octets
                FROM interface_samples
                WHERE interface_id = ANY($1::bigint[])
                ORDER BY interface_id, sampled_at DESC
                """,
                db_if_ids,
            )
            prev_by_if = {r["interface_id"]: r for r in prev_rows}

        for iface in interfaces:
            if_idx = iface["if_index"]
            db_if_id = if_id_map.get(if_idx)
            if not db_if_id:
                continue

            in_oct = iface.get("in_octets")
            out_oct = iface.get("out_octets")
            in_mbps = 0.0
            out_mbps = 0.0

            if in_oct is not None and out_oct is not None:
                prev_row = prev_by_if.get(db_if_id)
                if prev_row:
                    dt = (now - prev_row["sampled_at"]).total_seconds()
                    if 0.5 <= dt <= 300:
                        in_mbps = calculate_bandwidth_mbps(
                            curr_octets=in_oct,
                            prev_octets=int(prev_row["in_octets"]),
                            dt_seconds=dt,
                            is_64bit=True,
                            max_speed_bps=iface["speed_bps"],
                        )
                        out_mbps = calculate_bandwidth_mbps(
                            curr_octets=out_oct,
                            prev_octets=int(prev_row["out_octets"]),
                            dt_seconds=dt,
                            is_64bit=True,
                            max_speed_bps=iface["speed_bps"],
                        )
                samples_to_insert.append((db_if_id, now, in_oct, out_oct))

            total_in_mbps += in_mbps
            total_out_mbps += out_mbps

            interface_results.append({
                "id": db_if_id,
                "if_index": if_idx,
                "name": iface["name"],
                "description": iface["description"],
                "mac_address": iface.get("mac_address"),
                "speed_bps": iface["speed_bps"],
                "oper_status": iface["oper_status"],
                "in_mbps": in_mbps,
                "out_mbps": out_mbps,
            })

        if samples_to_insert:
            await conn.executemany(
                """
                INSERT INTO interface_samples (interface_id, sampled_at, in_octets, out_octets)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (interface_id, sampled_at) DO NOTHING
                """,
                samples_to_insert,
            )

    return {
        "success": True,
        "has_snmp": True,
        "interfaces_polled": len(interfaces),
        "total_in_mbps": round(total_in_mbps, 2),
        "total_out_mbps": round(total_out_mbps, 2),
        "timestamp": now.isoformat(),
        "interfaces": interface_results,
        "uptime": telemetry.get("uptime"),
        "mac_address": primary_mac,
        "ping_ms": telemetry.get("ping_ms"),
        "cpu_percent": telemetry.get("cpu_percent"),
        "memory_percent": telemetry.get("memory_percent"),
        "temperature_c": telemetry.get("temperature_c"),
    }

async def get_device_traffic_series(
    pool,
    device_id: int,
    interface_id: str = "all",
    time_range: str = "15m",
) -> Dict[str, Any]:
    """
    Fetches real historical bandwidth samples from PostgreSQL interface_samples
    and shapes them into a TrafficSeries suitable for TrafficChart.tsx.
    Includes historical prior data and seamless gap interpolation.
    """
    range_seconds = {
        "15m": 15 * 60,
        "1h": 60 * 60,
        "6h": 6 * 3600,
        "24h": 24 * 3600,
        "7d": 7 * 86400,
    }.get(time_range, 15 * 60)

    point_count = {
        "15m": settings.TELEMETRY_DEFAULT_POINTS,
        "1h": settings.TELEMETRY_DEFAULT_POINTS,
        "6h": 36,
        "24h": 48,
        "7d": 56,
    }.get(time_range, settings.TELEMETRY_DEFAULT_POINTS)

    labels_map = {
        "15m": ["-15m", "-10m", "-5m", "now"],
        "1h": ["-60m", "-40m", "-20m", "now"],
        "6h": ["-6h", "-4h", "-2h", "now"],
        "24h": ["-24h", "-16h", "-8h", "now"],
        "7d": ["-7d", "-5d", "-3d", "now"],
    }
    labels = labels_map.get(time_range, ["-15m", "-10m", "-5m", "now"])

    now = datetime.now(timezone.utc)
    since = now - timedelta(seconds=range_seconds)

    def _empty_series() -> Dict[str, Any]:
        return {
            "has_snmp": False,
            "interface_id": interface_id,
            "inbound": [0.0] * point_count,
            "outbound": [0.0] * point_count,
            "labels": labels,
            "peak": 0.0,
            "avg": 0.0,
            "timestamp": now.isoformat(),
        }

    async with pool.acquire() as conn:
        dev_row = await conn.fetchrow("SELECT id, dtype, enabled FROM devices WHERE id = $1", device_id)
        if not dev_row:
            return _empty_series()

        if_rows = await conn.fetch("SELECT id, speed_bps FROM interfaces WHERE device_id = $1", device_id)
        if not if_rows:
            return _empty_series()

        speed_map = {r["id"]: r["speed_bps"] for r in if_rows}

        # Query real samples within the time window
        if interface_id == "all":
            sample_rows = await conn.fetch("""
                SELECT s.interface_id, s.sampled_at, s.in_octets, s.out_octets
                FROM interface_samples s
                JOIN interfaces i ON i.id = s.interface_id
                WHERE i.device_id = $1 AND s.sampled_at >= $2
                ORDER BY s.sampled_at ASC
            """, device_id, since)
        else:
            try:
                target_if_id = int(interface_id)
            except ValueError:
                return _empty_series()

            if target_if_id not in speed_map:
                return _empty_series()

            sample_rows = await conn.fetch("""
                SELECT s.interface_id, s.sampled_at, s.in_octets, s.out_octets
                FROM interface_samples s
                JOIN interfaces i ON i.id = s.interface_id
                WHERE i.device_id = $1 AND s.interface_id = $2 AND s.sampled_at >= $3
                ORDER BY s.sampled_at ASC
            """, device_id, target_if_id, since)

    bucket_sec = max(1, range_seconds // point_count)
    inbound = [0.0] * point_count
    outbound = [0.0] * point_count

    # Bucket rates per interface: {bucket_idx: {if_id: [rates...]}}
    bucket_in: List[Dict[int, List[float]]] = [{} for _ in range(point_count)]
    bucket_out: List[Dict[int, List[float]]] = [{} for _ in range(point_count)]

    if sample_rows:
        by_iface: Dict[int, List[Any]] = {}
        for r in sample_rows:
            by_iface.setdefault(r["interface_id"], []).append(r)

        for if_id, rows in by_iface.items():
            if_speed = speed_map.get(if_id) or 1_000_000_000
            for i in range(1, len(rows)):
                p = rows[i - 1]
                c = rows[i]
                dt = (c["sampled_at"] - p["sampled_at"]).total_seconds()
                if dt < 0.5:
                    continue

                mbps_in = calculate_bandwidth_mbps(int(c["in_octets"]), int(p["in_octets"]), dt, is_64bit=True, max_speed_bps=if_speed)
                mbps_out = calculate_bandwidth_mbps(int(c["out_octets"]), int(p["out_octets"]), dt, is_64bit=True, max_speed_bps=if_speed)

                age_sec = (now - c["sampled_at"]).total_seconds()
                b_idx = int(point_count - 1 - (age_sec // bucket_sec))
                if 0 <= b_idx < point_count:
                    bucket_in[b_idx].setdefault(if_id, []).append(mbps_in)
                    bucket_out[b_idx].setdefault(if_id, []).append(mbps_out)

        measured_buckets = set()
        for b in range(point_count):
            if interface_id == "all":
                # Average multiple samples within each interface bucket, then sum across interfaces
                in_per_if = [sum(if_rates) / len(if_rates) for if_rates in bucket_in[b].values() if if_rates]
                out_per_if = [sum(if_rates) / len(if_rates) for if_rates in bucket_out[b].values() if if_rates]
                if in_per_if or out_per_if:
                    measured_buckets.add(b)
                inbound[b] = round(sum(in_per_if), 2) if in_per_if else 0.0
                outbound[b] = round(sum(out_per_if), 2) if out_per_if else 0.0
            else:
                in_rates = bucket_in[b].get(target_if_id, [])
                out_rates = bucket_out[b].get(target_if_id, [])
                if in_rates or out_rates:
                    measured_buckets.add(b)
                inbound[b] = (sum(in_rates) / len(in_rates)) if in_rates else 0.0
                outbound[b] = (sum(out_rates) / len(out_rates)) if out_rates else 0.0

    # Fill gaps between measured buckets (Linear Interpolation)
    measured_indices = sorted(measured_buckets) if sample_rows else []
    if len(measured_indices) > 1:
        for k in range(len(measured_indices) - 1):
            idx1 = measured_indices[k]
            idx2 = measured_indices[k + 1]
            gap = idx2 - idx1
            if gap > 1:
                for step in range(1, gap):
                    frac = step / gap
                    inbound[idx1 + step] = round(inbound[idx1] + frac * (inbound[idx2] - inbound[idx1]), 2)
                    outbound[idx1 + step] = round(outbound[idx1] + frac * (outbound[idx2] - outbound[idx1]), 2)

    has_snmp = False
    if dev_row["enabled"] and measured_indices:
        has_snmp = True
        # Forward-fill latest measured rate up to current moment (now)
        last_idx = measured_indices[-1]
        if last_idx < point_count - 1:
            for b in range(last_idx + 1, point_count):
                inbound[b] = inbound[last_idx]
                outbound[b] = outbound[last_idx]
    else:
        has_snmp = False
        inbound = [0.0] * point_count
        outbound = [0.0] * point_count

    # Final rounding and stats
    inbound = [round(v, 2) for v in inbound]
    outbound = [round(v, 2) for v in outbound]
    peak = round(max(max(inbound, default=0.0), max(outbound, default=0.0)), 2)
    avg = round((sum(inbound) + sum(outbound)) / max(len(inbound) * 2, 1), 2)

    return {
        "has_snmp": has_snmp,
        "interface_id": interface_id,
        "inbound": inbound,
        "outbound": outbound,
        "labels": labels,
        "peak": peak,
        "avg": avg,
        "timestamp": now.isoformat(),
    }


async def get_latest_interface_traffic_snapshot(pool, device_id: int) -> Dict[str, Any]:
    """Computes latest per-interface Mbps snapshot from stored interface_samples for simulated devices."""
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        if_rows = await conn.fetch(
            """
            SELECT id, if_index, name, description, mac_address, speed_bps, oper_status
            FROM interfaces
            WHERE device_id = $1
            ORDER BY if_index ASC
            """,
            device_id,
        )
        if not if_rows:
            return {
                "success": True,
                "has_snmp": False,
                "interfaces_polled": 0,
                "total_in_mbps": 0.0,
                "total_out_mbps": 0.0,
                "timestamp": now.isoformat(),
                "interfaces": [],
            }

        if_ids = [r["id"] for r in if_rows]
        sample_rows = await conn.fetch(
            """
            SELECT interface_id, sampled_at, in_octets, out_octets
            FROM (
                SELECT interface_id, sampled_at, in_octets, out_octets,
                       ROW_NUMBER() OVER (PARTITION BY interface_id ORDER BY sampled_at DESC) AS rn
                FROM interface_samples
                WHERE interface_id = ANY($1::bigint[])
            ) ranked
            WHERE rn <= 2
            ORDER BY interface_id, sampled_at ASC
            """,
            if_ids,
        )

    samples_by_if: Dict[int, List[Any]] = {}
    for row in sample_rows:
        samples_by_if.setdefault(row["interface_id"], []).append(row)

    interfaces_out = []
    total_in = 0.0
    total_out = 0.0
    for r in if_rows:
        pair = samples_by_if.get(r["id"], [])
        in_mbps = 0.0
        out_mbps = 0.0
        if len(pair) >= 2:
            prev_row, curr_row = pair[-2], pair[-1]
            dt = (curr_row["sampled_at"] - prev_row["sampled_at"]).total_seconds()
            if dt >= 0.5:
                in_mbps = calculate_bandwidth_mbps(
                    int(curr_row["in_octets"]),
                    int(prev_row["in_octets"]),
                    dt,
                    is_64bit=True,
                    max_speed_bps=r["speed_bps"],
                )
                out_mbps = calculate_bandwidth_mbps(
                    int(curr_row["out_octets"]),
                    int(prev_row["out_octets"]),
                    dt,
                    is_64bit=True,
                    max_speed_bps=r["speed_bps"],
                )
        total_in += in_mbps
        total_out += out_mbps
        interfaces_out.append({
            "id": int(r["id"]),
            "if_index": r["if_index"],
            "name": r["name"],
            "description": r["description"],
            "mac_address": r["mac_address"],
            "speed_bps": r["speed_bps"],
            "oper_status": r["oper_status"],
            "in_mbps": in_mbps,
            "out_mbps": out_mbps,
        })

    return {
        "success": True,
        "has_snmp": bool(sample_rows),
        "interfaces_polled": len(interfaces_out),
        "total_in_mbps": round(total_in, 2),
        "total_out_mbps": round(total_out, 2),
        "timestamp": now.isoformat(),
        "interfaces": interfaces_out,
    }
