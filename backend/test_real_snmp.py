import asyncio
import os
import sys

sys.path.insert(0, r"c:\work\snmp_font_end\backend")

from httpx import AsyncClient, ASGITransport
from app.main import app

async def run_real_snmp_tests():
    print("--- Testing Real SNMP & Zero-Config Auto Scan ---")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Test local-info endpoint
        res = await ac.get("/api/v1/discovery/local-info")
        print("[1] GET /api/v1/discovery/local-info:", res.status_code, res.json())
        assert res.status_code == 200
        info = res.json()
        assert "detected_subnet" in info
        print(f"    -> Local IP: {info['local_ip']}, Auto-detected Subnet: {info['detected_subnet']}")

        # 2. Test Zero-Config Scan (cidr='auto')
        print("[2] POST /api/v1/discovery/scan with cidr='auto'...")
        res = await ac.post("/api/v1/discovery/scan", json={"cidr": "auto", "community": "public"})
        print(f"    -> Status: {res.status_code}, Found {len(res.json())} devices")
        assert res.status_code == 200
        discovered = res.json()
        assert len(discovered) > 0, "Expected to discover at least 1 device on local network"
        
        # Check if Aruba switch or gateway was discovered
        aruba_dev = next((d for d in discovered if d["ip"] == "192.168.22.254"), None)
        if aruba_dev:
            print(f"    -> [SUCCESS] Discovered Real Switch: {aruba_dev['hostname']} ({aruba_dev['ip']})")
            print(f"       SNMP OK: {aruba_dev['snmp_ok']}, Type: {aruba_dev['dtype']}, Descr: {aruba_dev['sys_descr']}")
            assert aruba_dev["snmp_ok"] is True
            assert aruba_dev["dtype"] == "switch"

        # 3. Test Real SNMP Connect on Switch-Core
        print("[3] Adding Switch-Core and testing real connect...")
        dev_payload = {
            "name": "REAL-ARUBA-SW-01",
            "dtype": "switch",
            "floor": 1,
            "ip": "192.168.22.254",
            "model": "Aruba 2930F",
            "enabled": True,
        }
        res = await ac.post("/api/v1/devices", json=dev_payload)
        is_new = False
        if res.status_code == 400:
            devs = (await ac.get("/api/v1/devices")).json()
            existing = next((d for d in devs if d["ip"] == "192.168.22.254"), None)
            assert existing is not None
            dev_id = existing["id"]
            print(f"    -> Found existing registered device {dev_id} ({existing['name']})")
        else:
            created = res.json()
            dev_id = created["id"]
            is_new = True
            assert created["status"] == "offline"
            print(f"    -> Created device {dev_id} as OFFLINE")

        # 4. Trigger Real Connect
        res = await ac.post(f"/api/v1/devices/{dev_id}/connect")
        print("[4] Connect result for real device:", res.status_code, res.json())
        assert res.status_code == 200
        con_res = res.json()
        assert con_res["success"] is True
        assert con_res["status"] == "online"
        print(f"    -> [SUCCESS] Real device connected! Uptime: {con_res['sys_uptime']}, Message: {con_res['message']}")

        # 5. Verify detail has real model and status
        res = await ac.get(f"/api/v1/devices/{dev_id}")
        det = res.json()
        print(f"    -> Device detail updated: Model = '{det['device']['model']}', Status = '{det['device']['status']}'")
        assert det["device"]["status"] == "online"

        # Cleanup if it was newly created
        if is_new:
            await ac.delete(f"/api/v1/devices/{dev_id}")
            print("    -> Cleaned up test device.")
        else:
            print("    -> Preserved existing device in DB.")

    print("\n--- ALL REAL SNMP & ZERO-CONFIG TESTS PASSED! ---")

if __name__ == "__main__":
    asyncio.run(run_real_snmp_tests())

