import asyncio
import os
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, r"c:\work\snmp_font_end\backend")

from httpx import AsyncClient, ASGITransport
from app.main import app

async def run_discovery_tests():
    print("--- Testing Offline Device Creation & Network Discovery ---")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Pre-cleanup in case of previous interrupted run
        devs_res = await ac.get("/api/v1/devices")
        for d in devs_res.json():
            if d.get("name") == "TEST-OFFLINE-01":
                await ac.delete(f"/api/v1/devices/{d['id']}")

        # 1. Create Device -> MUST BE OFFLINE
        payload = {
            "name": "TEST-OFFLINE-01",
            "dtype": "switch",
            "floor": 1,
            "ip": "10.99.99.1",
            "model": "Cisco 2960",
            "enabled": True,
        }
        res = await ac.post("/api/v1/devices", json=payload)
        print("[1] Create device response:", res.status_code, res.json())
        assert res.status_code == 201
        dev = res.json()
        dev_id = dev["id"]
        assert dev["status"] == "offline", f"Expected offline, got {dev['status']}"
        print("    -> VERIFIED: New device is OFFLINE initially!")

        # 2. Test Connect on unreachable IP -> remains offline
        res = await ac.post(f"/api/v1/devices/{dev_id}/connect")
        print("[2] Connect test on unreachable device:", res.status_code, res.json())
        assert res.status_code == 200
        con_res = res.json()
        assert con_res["success"] is False
        assert con_res["status"] == "offline"
        print("    -> VERIFIED: Unreachable device stays OFFLINE!")

        # 3. Test Connect on localhost (127.0.0.1) -> update device IP to 127.0.0.1 and test connect
        await ac.patch(f"/api/v1/devices/{dev_id}", json={"ip": "127.0.0.1"})
        res = await ac.post(f"/api/v1/devices/{dev_id}/connect")
        print("[3] Connect test on 127.0.0.1 (Ping should succeed):", res.status_code, res.json())
        assert res.status_code == 200
        con_res2 = res.json()
        assert con_res2["success"] is True
        assert con_res2["status"] == "online"
        print("    -> VERIFIED: Connect transitions status to ONLINE!")

        # 4. Test Network Discovery Scan on 127.0.0.1/32
        scan_payload = {
            "cidr": "127.0.0.1/32",
            "community": "public",
            "snmp_port": 161
        }
        res = await ac.post("/api/v1/discovery/scan", json=scan_payload)
        print("[4] Discovery Scan response:", res.status_code, res.json())
        assert res.status_code == 200
        discovered = res.json()
        assert len(discovered) >= 1
        assert discovered[0]["ip"] == "127.0.0.1"
        print(f"    -> VERIFIED: Found host {discovered[0]['ip']} (Hostname: {discovered[0]['hostname']})")

        # 5. Test Import Discovered Device
        import_payload = {
            "devices": [
                {
                    "name": "DISCOVERED-SW-01",
                    "ip": "10.88.88.1",
                    "dtype": "switch",
                    "floor": 2,
                    "model": "Discovered Switch"
                }
            ]
        }
        res = await ac.post("/api/v1/discovery/import", json=import_payload)
        print("[5] Import discovered devices response:", res.status_code, res.json())
        assert res.status_code == 200
        imported = res.json()
        assert len(imported) == 1
        assert imported[0]["status"] == "online"
        imp_id = imported[0]["id"]
        print("    -> VERIFIED: Discovered device imported as ONLINE!")

        # Clean up test devices
        await ac.delete(f"/api/v1/devices/{dev_id}")
        await ac.delete(f"/api/v1/devices/{imp_id}")
        print("    -> Cleaned up test devices.")

    print("\n--- ALL BACKEND OFFLINE & DISCOVERY TESTS PASSED! ---")

if __name__ == "__main__":
    asyncio.run(run_discovery_tests())

