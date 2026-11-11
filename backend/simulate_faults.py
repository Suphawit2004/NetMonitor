"""
Script to simulate realistic network device faults across multiple device types (Router, Switch, AP, Server).
Scenarios:
1. Router Warning: RTR-CORE-01 (192.168.22.1) - BGP Route Flapping & High CPU load (88.5%)
2. Router Offline: RTR-BRANCH-02 (192.168.22.2) - WAN Fiber Cut / Gateway Unreachable
3. Switch Warning: SW-42-B73C (192.168.22.42) - Trunk Port Saturation > 90% & High Temperature
4. Switch Offline: SW-112-B3C3 (192.168.22.112) - PSU Power Failure / 24 Ports Down
5. AP Warning:     Ubiquiti-AP-239 (192.168.22.239) - High Channel Interference & Packet Loss (8.7%)
6. Server Offline: SRV-44-F9FF (192.168.22.44) - Host Kernel Panic / Database Unresponsive
"""

import sys
sys.path.insert(0, "backend")

import asyncio
from datetime import datetime, timezone
from app.database import get_db_pool, close_db
from app.placement import project_gps_to_canvas, pick_smart_spot

async def simulate():
    pool = await get_db_pool()
    print("--- Applying Simulated Network Faults ---")

    # 1. Ensure Router 1 exists (RTR-CORE-01, Floor 1)
    rtr1 = await pool.fetchrow("SELECT id FROM devices WHERE name = 'RTR-CORE-01' OR management_ip = '192.168.22.1'")
    if not rtr1:
        rtr1_id = await pool.fetchval("""
            INSERT INTO devices (name, hostname, dtype, floor, x, y, locked, management_ip, snmp_version, model, location, enabled)
            VALUES ('RTR-CORE-01', 'rtr-core-01.netmon.lan', 'router', 1, 164.0, 124.0, true, '192.168.22.1'::inet, 'v2c', 'Cisco ISR 4451-X/K9 Gateway', 'Floor 1 – Server Room', true)
            RETURNING id
        """)
        print(f"[+] Created RTR-CORE-01 (ID: {rtr1_id}) on Floor 1")
    else:
        rtr1_id = rtr1["id"]
        await pool.execute("""
            UPDATE devices 
            SET name = 'RTR-CORE-01', hostname = 'rtr-core-01.netmon.lan', dtype = 'router', floor = 1, x = 164.0, y = 124.0, 
                snmp_version = 'v2c', model = 'Cisco ISR 4451-X/K9 Gateway', location = 'Floor 1 – Server Room', enabled = true
            WHERE id = $1
        """, rtr1_id)
        print(f"[*] Updated RTR-CORE-01 (ID: {rtr1_id})")

    # 2. Ensure Router 2 exists (RTR-BRANCH-02, Floor 2)
    rtr2 = await pool.fetchrow("SELECT id FROM devices WHERE name = 'RTR-BRANCH-02' OR management_ip = '192.168.22.2'")
    if not rtr2:
        rtr2_id = await pool.fetchval("""
            INSERT INTO devices (name, hostname, dtype, floor, x, y, locked, management_ip, snmp_version, model, location, enabled)
            VALUES ('RTR-BRANCH-02', 'rtr-branch-02.netmon.lan', 'router', 2, 44.0, 44.0, true, '192.168.22.2'::inet, 'v2c', 'MikroTik CCR2004-16G-2S+ Cloud Router', 'Floor 2 – Zone E – Office', true)
            RETURNING id
        """)
        print(f"[+] Created RTR-BRANCH-02 (ID: {rtr2_id}) on Floor 2")
    else:
        rtr2_id = rtr2["id"]
        await pool.execute("""
            UPDATE devices 
            SET name = 'RTR-BRANCH-02', hostname = 'rtr-branch-02.netmon.lan', dtype = 'router', floor = 2, x = 44.0, y = 44.0,
                snmp_version = 'v2c', model = 'MikroTik CCR2004-16G-2S+ Cloud Router', location = 'Floor 2 – Zone E – Office', enabled = true
            WHERE id = $1
        """, rtr2_id)
        print(f"[*] Updated RTR-BRANCH-02 (ID: {rtr2_id})")

    # 3. Dynamically resolve existing Switch, AP, Server devices without hardcoded nonexistent IDs
    async def get_or_fallback_device(preferred_name, dtype, default_name):
        row = await pool.fetchrow("SELECT id, name FROM devices WHERE name = $1", preferred_name)
        if row:
            return row
        row = await pool.fetchrow("SELECT id, name FROM devices WHERE name = $1", default_name)
        if row:
            return row
        row = await pool.fetchrow("SELECT id, name FROM devices WHERE dtype = $1 ORDER BY id ASC LIMIT 1", dtype)
        if row:
            return row
        return await pool.fetchrow("SELECT id, name FROM devices ORDER BY id ASC LIMIT 1")

    sw_warn = await get_or_fallback_device('SW-42-B73C', 'switch', 'SW-CORE-01')
    sw_off  = await get_or_fallback_device('SW-112-B3C3', 'switch', 'SW-DIST-01')
    ap_warn = await get_or_fallback_device('Ubiquiti-AP-239', 'ap', 'AP-A1')
    srv_off = await get_or_fallback_device('SRV-44-F9FF', 'server', 'SRV-01')

    # Move SW-112-B3C3 to Floor 2 if present
    if sw_off and sw_off.get("name") == 'SW-112-B3C3':
        await pool.execute("""
            UPDATE devices 
            SET floor = 2, x = 460.0, y = 90.0, location = 'Floor 2 – Zone F – Lab' 
            WHERE id = $1
        """, sw_off["id"])
        print(f"[*] Positioned SW-112-B3C3 (ID: {sw_off['id']}) on Floor 2")

    # Move Ubiquiti-AP-239 to clean spot on Floor 2 if present
    if ap_warn and ap_warn.get("name") == 'Ubiquiti-AP-239':
        await pool.execute("""
            UPDATE devices 
            SET floor = 2, x = 240.0, y = 260.0, location = 'Floor 2 – Zone G – Meeting' 
            WHERE id = $1
        """, ap_warn["id"])
        print(f"[*] Positioned Ubiquiti-AP-239 (ID: {ap_warn['id']}) on Floor 2")

    # Target device mapping for faults:
    fault_scenarios = [
        {
            "device_id": rtr1_id,
            "name": "RTR-CORE-01",
            "poll_status": "warning",
            "poll_error": "BGP Peer Flapping (ISP-1) & High CPU load at 88.5%",
            "severity": "warn",
            "title": "BGP Session Flapping & High CPU Utilization",
            "description": "BGP Session to ISP-1 (203.0.113.1) flapped 3 times in 10 minutes. Router CPU utilization at 88.5%."
        },
        {
            "device_id": rtr2_id,
            "name": "RTR-BRANCH-02",
            "poll_status": "failed",
            "poll_error": "Timeout: No Response from 192.168.22.2:161 (WAN Link Down)",
            "severity": "crit",
            "title": "WAN Link Down & Router Unreachable",
            "description": "Zero response from 192.168.22.2 (ICMP timeout & SNMP poller failed). Branch gateway unreachable."
        },
    ]

    if sw_warn:
        fault_scenarios.append({
            "device_id": sw_warn["id"],
            "name": sw_warn["name"],
            "poll_status": "warning",
            "poll_error": "High port saturation: Trunk Gi1/0/1 at 92.4%",
            "severity": "warn",
            "title": "Trunk Port Gi1/0/1 Utilization > 90%",
            "description": "Bandwidth saturation detected on 10G uplink trunk. Switch internal temperature reached 68°C."
        })

    if sw_off:
        fault_scenarios.append({
            "device_id": sw_off["id"],
            "name": sw_off["name"],
            "poll_status": "failed",
            "poll_error": "Hardware failure: Power Supply Unit offline",
            "severity": "crit",
            "title": "Switch Offline - Power Supply Failure",
            "description": "Hardware PSU fault detected. Switch powered down unexpectedly. 24 edge ports offline."
        })

    if ap_warn:
        fault_scenarios.append({
            "device_id": ap_warn["id"],
            "name": ap_warn["name"],
            "poll_status": "warning",
            "poll_error": "Excessive channel contention & packet loss 8.7%",
            "severity": "warn",
            "title": "AP Overloaded & High Packet Loss",
            "description": "65 active wireless clients connected. Channel utilization 82%, packet drop rate at 8.7%."
        })

    if srv_off:
        fault_scenarios.append({
            "device_id": srv_off["id"],
            "name": srv_off["name"],
            "poll_status": "failed",
            "poll_error": "Host unreachable / kernel panic",
            "severity": "crit",
            "title": "Database Server Unresponsive (Critical Outage)",
            "description": "Zero response from host. Kernel panic or network interface down. Service unreachable."
        })

    print("\n--- Inserting Poll Runs & Alerts ---")
    for s in fault_scenarios:
        dev_id = s["device_id"]
        # Delete old non-info alerts for this device to prevent clutter
        await pool.execute("DELETE FROM alerts WHERE device_id = $1 AND severity IN ('warn', 'crit')", dev_id)

        # Insert fresh alert
        await pool.execute("""
            INSERT INTO alerts (device_id, severity, icon, title, description, created_at, acknowledged)
            VALUES ($1, $2, '', $3, $4, now(), false)
        """, dev_id, s["severity"], s["title"], s["description"])

        # Insert latest poll run with recent started_at so it takes precedence
        await pool.execute("""
            INSERT INTO poll_runs (device_id, status, error_message, started_at, finished_at)
            VALUES ($1, $2, $3, now(), now())
        """, dev_id, s["poll_status"], s["poll_error"])

        status_text = "WARNING (เหลือง)" if s["poll_status"] == "warning" else "OFFLINE (แดง)"
        print(f"[✓] {s['name']} (ID {dev_id}) -> {status_text} | Alert: {s['title']}")

    print("\n--- Simulation Configured Successfully! ---")
    await close_db()

if __name__ == "__main__":
    asyncio.run(simulate())
