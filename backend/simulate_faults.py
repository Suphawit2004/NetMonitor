"""
Script to simulate realistic network device statuses (Online, Warning, Offline) 
across multiple device types (Router, Switch, AP, Server) on Floor 1 and Floor 2.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import asyncio
import json
from datetime import datetime, timezone
import asyncpg
from app.database import get_db_pool, close_db


async def ensure_simulated_interfaces_and_metrics(pool: asyncpg.Pool, dev_id: int, dtype: str, name: str, status: str):
    """Ensures realistic interfaces, telemetry metrics, and traffic samples exist for simulated devices."""
    has_if = await pool.fetchval("SELECT count(*) FROM interfaces WHERE device_id = $1", dev_id)
    if has_if == 0:
        if dtype == "router":
            ifs = [
                (1, "GigabitEthernet0/0/0", "WAN Fiber Internet (ISP-1)", "00:50:56:A1:B2:01", 1000000000, "up", "up" if status != "offline" else "down"),
                (2, "GigabitEthernet0/0/1", "WAN Backup 5G (ISP-2)", "00:50:56:A1:B2:02", 1000000000, "up", "up" if status != "offline" else "down"),
                (3, "TenGigabitEthernet0/1/0", "LAN Downlink to Core Switch", "00:50:56:A1:B2:03", 10000000000, "up", "up" if status != "offline" else "down"),
            ]
        elif dtype == "ap":
            ifs = [
                (1, "eth0", "PoE Gigabit Uplink", "00:50:56:B2:C3:01", 1000000000, "up", "up" if status != "offline" else "down"),
                (2, "wifi0", "Radio 5GHz 802.11ax", "00:50:56:B2:C3:02", 2400000000, "up", "up" if status != "offline" else "down"),
                (3, "wifi1", "Radio 2.4GHz 802.11ax", "00:50:56:B2:C3:03", 574000000, "up", "up" if status != "offline" else "down"),
            ]
        elif dtype == "server":
            ifs = [
                (1, "eth0", "Primary NIC 10GbE", "00:50:56:C3:D4:01", 10000000000, "up", "up" if status != "offline" else "down"),
                (2, "eth1", "Management iDRAC", "00:50:56:C3:D4:02", 1000000000, "up", "up" if status != "offline" else "down"),
            ]
        else: # switch
            ifs = [
                (1, "GigabitEthernet1/0/1", "Trunk Uplink to Core", "00:50:56:D4:E5:01", 10000000000, "up", "up" if status != "offline" else "down"),
                (2, "GigabitEthernet1/0/2", "Access Port - Workstations", "00:50:56:D4:E5:02", 1000000000, "up", "up" if status != "offline" else "down"),
                (3, "GigabitEthernet1/0/3", "Access Port - Printers", "00:50:56:D4:E5:03", 1000000000, "up", "up" if status != "offline" else "down"),
            ]
        for if_idx, if_name, if_desc, mac, speed, adm, oper in ifs:
            await pool.execute("""
                INSERT INTO interfaces (device_id, if_index, name, description, mac_address, speed_bps, admin_status, oper_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (device_id, if_index) DO NOTHING
            """, dev_id, if_idx, if_name, if_desc, mac, speed, adm, oper)

    # 2. Insert metrics (CPU, Memory, Temp)
    cpu_val = 88.5 if status == "warning" and dtype == "router" else (78.0 if status == "warning" else (22.5 if status == "online" else 0.0))
    mem_val = 74.2 if status == "warning" else (48.0 if status == "online" else 0.0)
    temp_val = 68.0 if status == "warning" and dtype == "switch" else (46.0 if status == "online" else 25.0)

    for metric_name, val, oid, unit in [
        ("cpu_usage_percent", cpu_val, ".1.3.6.1.4.1.9.9.109.1.1.1.1.5.1", "%"),
        ("memory_usage_percent", mem_val, ".1.3.6.1.4.1.9.9.48.1.1.1.5.1", "%"),
        ("chassis_temperature_c", temp_val, ".1.3.6.1.4.1.9.9.13.1.3.1.3.1", "Celsius"),
    ]:
        await pool.execute("""
            INSERT INTO device_metric_samples (device_id, sampled_at, oid, metric_name, numeric_value, text_value, labels)
            VALUES ($1, now(), $2, $3, $4, NULL, $5::jsonb)
            ON CONFLICT (device_id, sampled_at, oid, labels) DO NOTHING
        """, dev_id, oid, metric_name, val, json.dumps({"unit": unit}))

    # 3. Insert historical interface samples for traffic charts
    if status != "offline":
        if_id = await pool.fetchval("SELECT id FROM interfaces WHERE device_id = $1 ORDER BY if_index ASC LIMIT 1", dev_id)
        if if_id:
            await pool.execute("""
                INSERT INTO interface_samples (interface_id, sampled_at, in_octets, out_octets, in_errors, out_errors, in_discards, out_discards)
                SELECT 
                    $1, 
                    now() - (s.n * INTERVAL '30 second'), 
                    (50000000000 + (s.n * 125000000))::numeric(20, 0),
                    (25000000000 + (s.n * 85000000))::numeric(20, 0),
                    0, 0, 0, 0
                FROM generate_series(0, 10) AS s(n)
                ON CONFLICT (interface_id, sampled_at) DO NOTHING;
            """, if_id)


async def apply_sample_statuses(pool: asyncpg.Pool) -> dict:
    print("--- Applying Simulated Network Sample Statuses ---")

    # 1. Ensure Router 1 exists (RTR-CORE-01, Floor 1)
    rtr1 = await pool.fetchrow("SELECT id FROM devices WHERE name = 'RTR-CORE-01' OR management_ip = '192.168.22.1'")
    if not rtr1:
        rtr1_id = await pool.fetchval("""
            INSERT INTO devices (name, hostname, dtype, floor, x, y, locked, management_ip, snmp_version, credential_ref, model, location, enabled)
            VALUES ('RTR-CORE-01', 'rtr-core-01.netmon.lan', 'router', 1, 164.0, 124.0, true, '192.168.22.1'::inet, 'v2c', 'simulated', 'Cisco ISR 4451-X/K9 Gateway', 'Floor 1 – Server Room', true)
            RETURNING id
        """)
        print(f"[+] Created RTR-CORE-01 (ID: {rtr1_id}) on Floor 1")
    else:
        rtr1_id = rtr1["id"]
        await pool.execute("""
            UPDATE devices 
            SET name = 'RTR-CORE-01', hostname = 'rtr-core-01.netmon.lan', dtype = 'router', floor = 1, x = 164.0, y = 124.0, 
                snmp_version = 'v2c', credential_ref = 'simulated', model = 'Cisco ISR 4451-X/K9 Gateway', location = 'Floor 1 – Server Room', enabled = true
            WHERE id = $1
        """, rtr1_id)
        print(f"[*] Updated RTR-CORE-01 (ID: {rtr1_id})")

    # 2. Ensure Router 2 exists (RTR-BRANCH-02, Floor 2)
    rtr2 = await pool.fetchrow("SELECT id FROM devices WHERE name = 'RTR-BRANCH-02' OR management_ip = '192.168.22.2'")
    if not rtr2:
        rtr2_id = await pool.fetchval("""
            INSERT INTO devices (name, hostname, dtype, floor, x, y, locked, management_ip, snmp_version, credential_ref, model, location, enabled)
            VALUES ('RTR-BRANCH-02', 'rtr-branch-02.netmon.lan', 'router', 2, 44.0, 44.0, true, '192.168.22.2'::inet, 'v2c', 'simulated', 'MikroTik CCR2004-16G-2S+ Cloud Router', 'Floor 2 – Zone E – Office', true)
            RETURNING id
        """)
        print(f"[+] Created RTR-BRANCH-02 (ID: {rtr2_id}) on Floor 2")
    else:
        rtr2_id = rtr2["id"]
        await pool.execute("""
            UPDATE devices 
            SET name = 'RTR-BRANCH-02', hostname = 'rtr-branch-02.netmon.lan', dtype = 'router', floor = 2, x = 44.0, y = 44.0,
                snmp_version = 'v2c', credential_ref = 'simulated', model = 'MikroTik CCR2004-16G-2S+ Cloud Router', location = 'Floor 2 – Zone E – Office', enabled = true
            WHERE id = $1
        """, rtr2_id)
        print(f"[*] Updated RTR-BRANCH-02 (ID: {rtr2_id})")

    # Helper to resolve device by name or type
    async def get_device_by_name_or_type(preferred_name, dtype, default_name=None):
        row = await pool.fetchrow("SELECT id, name FROM devices WHERE name = $1", preferred_name)
        if row:
            return row
        if default_name:
            row = await pool.fetchrow("SELECT id, name FROM devices WHERE name = $1", default_name)
            if row:
                return row
        return await pool.fetchrow("SELECT id, name FROM devices WHERE dtype = $1 ORDER BY id ASC LIMIT 1", dtype)

    # 3. Locate target devices
    sw_core = await pool.fetchrow("SELECT id, name FROM devices WHERE id = 1 OR management_ip = '192.168.22.254'")
    sw_warn = await get_device_by_name_or_type('Cisco-SW-46', 'switch')
    sw_off  = await get_device_by_name_or_type('SW-112-B3C3', 'switch')
    sw_on1  = await get_device_by_name_or_type('Cisco-SW-45', 'switch')
    sw_on2  = await get_device_by_name_or_type('SW-68-B73C', 'switch')

    ap_warn = await get_device_by_name_or_type('Ubiquiti-AP-239', 'ap')
    ap_off  = await get_device_by_name_or_type('AP-65-6188', 'ap')
    ap_on1  = await get_device_by_name_or_type('AP-42-2C1E', 'ap')
    ap_on2  = await get_device_by_name_or_type('AP-48-B2F2', 'ap')

    srv_off = await get_device_by_name_or_type('SRV-44-F9FF', 'server')
    srv_on1 = await get_device_by_name_or_type('SRV-81-2975', 'server')
    srv_on2 = await get_device_by_name_or_type('Suphawit', 'server')

    # Ensure Floor positions for key devices
    if sw_off:
        await pool.execute("UPDATE devices SET floor = 2, x = 460.0, y = 90.0, credential_ref = 'simulated', location = 'Floor 2 – Zone F – Lab' WHERE id = $1", sw_off["id"])
    if ap_warn:
        await pool.execute("UPDATE devices SET floor = 2, x = 240.0, y = 260.0, credential_ref = 'simulated', location = 'Floor 2 – Zone G – Meeting' WHERE id = $1", ap_warn["id"])
    if ap_on2:
        await pool.execute("UPDATE devices SET floor = 2, x = 620.0, y = 260.0, credential_ref = 'simulated', location = 'Floor 2 – Zone H – Hall' WHERE id = $1", ap_on2["id"])

    # Define all status scenarios:
    # Status Scenarios: (Online, Warning, Offline)
    scenarios = [
        # --- WARNINGS ---
        {
            "device_id": rtr1_id,
            "name": "RTR-CORE-01",
            "status": "warning",
            "poll_status": "warning",
            "poll_error": "BGP Peer Flapping (ISP-1) & High CPU load at 88.5%",
            "severity": "warn",
            "title": "BGP Session Flapping & High CPU Utilization",
            "description": "BGP Session to ISP-1 (203.0.113.1) flapped 3 times in 10 minutes. Router CPU utilization at 88.5%."
        },
        {
            "device_id": ap_warn["id"] if ap_warn else None,
            "name": ap_warn["name"] if ap_warn else "Ubiquiti-AP-239",
            "status": "warning",
            "poll_status": "warning",
            "poll_error": "Excessive channel contention & packet loss 8.7%",
            "severity": "warn",
            "title": "AP Overloaded & High Packet Loss",
            "description": "65 active wireless clients connected. Channel utilization 82%, packet drop rate at 8.7%."
        },
    ]

    if sw_warn and sw_warn["id"] != (sw_core["id"] if sw_core else None):
        scenarios.append({
            "device_id": sw_warn["id"],
            "name": sw_warn["name"],
            "status": "warning",
            "poll_status": "warning",
            "poll_error": "High port saturation: Trunk Gi1/0/1 at 92.4%",
            "severity": "warn",
            "title": "Trunk Port Gi1/0/1 Utilization > 90%",
            "description": "Bandwidth saturation detected on 10G uplink trunk. Switch internal temperature reached 68°C."
        })

    # --- OFFLINE ---
    scenarios.extend([
        {
            "device_id": rtr2_id,
            "name": "RTR-BRANCH-02",
            "status": "offline",
            "poll_status": "failed",
            "poll_error": "Timeout: No Response from 192.168.22.2:161 (WAN Link Down)",
            "severity": "crit",
            "title": "WAN Link Down & Router Unreachable",
            "description": "Zero response from 192.168.22.2 (ICMP timeout & SNMP poller failed). Branch gateway unreachable."
        },
    ])

    if sw_off and sw_off["id"] != (sw_core["id"] if sw_core else None):
        scenarios.append({
            "device_id": sw_off["id"],
            "name": sw_off["name"],
            "status": "offline",
            "poll_status": "failed",
            "poll_error": "Hardware failure: Power Supply Unit offline",
            "severity": "crit",
            "title": "Switch Offline - Power Supply Failure",
            "description": "Hardware PSU fault detected. Switch powered down unexpectedly. 24 edge ports offline."
        })

    if ap_off:
        scenarios.append({
            "device_id": ap_off["id"],
            "name": ap_off["name"],
            "status": "offline",
            "poll_status": "failed",
            "poll_error": "AP PoE Power lost",
            "severity": "crit",
            "title": "AP PoE Power Lost - Switch Port Down",
            "description": "Access point lost 802.3at PoE power from upstream switch. Device offline."
        })

    if srv_off:
        scenarios.append({
            "device_id": srv_off["id"],
            "name": srv_off["name"],
            "status": "offline",
            "poll_status": "failed",
            "poll_error": "Host unreachable / kernel panic",
            "severity": "crit",
            "title": "Database Server Unresponsive (Critical Outage)",
            "description": "Zero response from host. Kernel panic or network interface down. Service unreachable."
        })

    # --- ONLINE DEVICES ---
    online_devs = [sw_on1, sw_on2, ap_on1, ap_on2, srv_on1, srv_on2]
    for d in online_devs:
        if d and d["id"] != (sw_core["id"] if sw_core else None):
            scenarios.append({
                "device_id": d["id"],
                "name": d["name"],
                "status": "online",
                "poll_status": "succeeded",
                "poll_error": None,
                "severity": None,
                "title": None,
                "description": None
            })

    print("\n--- Applying Statuses to Database ---")
    applied_counts = {"online": 0, "warning": 0, "offline": 0}

    for s in scenarios:
        dev_id = s.get("device_id")
        if not dev_id:
            continue

        # Tag device as simulated so background poller won't overwrite it
        if dev_id != (sw_core["id"] if sw_core else None):
            await pool.execute("UPDATE devices SET credential_ref = 'simulated', enabled = true WHERE id = $1", dev_id)

        # Ensure realistic interfaces and metrics for simulated device
        dtype_val = await pool.fetchval("SELECT dtype FROM devices WHERE id = $1", dev_id)
        if dtype_val:
            await ensure_simulated_interfaces_and_metrics(pool, dev_id, dtype_val, s["name"], s["status"])

        # Clear old warn/crit alerts for this device
        await pool.execute("DELETE FROM alerts WHERE device_id = $1 AND severity IN ('warn', 'crit')", dev_id)

        # Insert alert if Warning or Offline
        if s["severity"] and s["title"]:
            await pool.execute("""
                INSERT INTO alerts (device_id, severity, icon, title, description, created_at, acknowledged)
                VALUES ($1, $2, '', $3, $4, now(), false)
            """, dev_id, s["severity"], s["title"], s["description"])

        # Insert latest poll_run
        await pool.execute("""
            INSERT INTO poll_runs (device_id, status, error_message, started_at, finished_at)
            VALUES ($1, $2, $3, now(), now())
        """, dev_id, s["poll_status"], s["poll_error"])

        applied_counts[s["status"]] += 1
        label = "ONLINE (เขียว)" if s["status"] == "online" else ("WARNING (เหลือง)" if s["status"] == "warning" else "OFFLINE (แดง)")
        alert_suffix = f" | Alert: {s['title']}" if s.get("title") else ""
        print(f"[✓] {s['name']} (ID {dev_id}) -> {label}{alert_suffix}")

    print("\n--- Summary of Applied Sample Statuses ---")
    print(f"Online: {applied_counts['online']} | Warning: {applied_counts['warning']} | Offline: {applied_counts['offline']}")
    return applied_counts


async def simulate():
    pool = await get_db_pool()
    try:
        await apply_sample_statuses(pool)
    finally:
        await close_db()


if __name__ == "__main__":
    asyncio.run(simulate())
