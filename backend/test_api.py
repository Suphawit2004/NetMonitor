import asyncio
import os
import sys

# Ensure backend directory is in sys.path
sys.path.insert(0, r"c:\work\snmp_font_end\backend")

from httpx import AsyncClient, ASGITransport
from app.main import app

async def run_tests():
    print("--- Starting FastAPI Endpoint Tests ---")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Health check
        res = await ac.get("/health")
        print("[1] GET /health:", res.status_code, res.json())
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

        # 2. List devices
        res = await ac.get("/api/v1/devices")
        print(f"[2] GET /api/v1/devices: {res.status_code}, total devices = {len(res.json())}")
        assert res.status_code == 200
        assert len(res.json()) >= 1
        first_dev = res.json()[0]
        print("    Sample device:", first_dev)

        # 3. Create a test device
        new_dev_payload = {
            "name": "TEST-SW-01",
            "dtype": "switch",
            "floor": 2,
            "ip": "10.2.0.1",
            "model": "Cisco Catalyst 2960",
            "enabled": True
        }
        res = await ac.post("/api/v1/devices", json=new_dev_payload)
        print("[3] POST /api/v1/devices:", res.status_code, res.json())
        assert res.status_code == 201
        created_dev = res.json()
        dev_id = created_dev["id"]
        assert created_dev["name"] == "TEST-SW-01"
        assert created_dev["floor"] == 2
        assert created_dev["x"] is not None and created_dev["y"] is not None
        print(f"    Auto-placed at: ({created_dev['x']}, {created_dev['y']})")

        # 4. Get device detail
        res = await ac.get(f"/api/v1/devices/{dev_id}")
        print(f"[4] GET /api/v1/devices/{dev_id}:", res.status_code)
        assert res.status_code == 200

        # 5. Patch / move device
        patch_payload = {"x": 350.0, "y": 280.0, "locked": False}
        res = await ac.patch(f"/api/v1/devices/{dev_id}", json=patch_payload)
        print(f"[5] PATCH /api/v1/devices/{dev_id}:", res.status_code, res.json())
        assert res.status_code == 200
        assert res.json()["x"] == 350.0
        assert res.json()["locked"] is False

        # 6. Test SNMP poll trigger
        res = await ac.post(f"/api/v1/devices/{dev_id}/poll")
        print(f"[6] POST /api/v1/devices/{dev_id}/poll:", res.status_code, res.json())
        assert res.status_code == 200

        # 7. Delete test device
        res = await ac.delete(f"/api/v1/devices/{dev_id}")
        print(f"[7] DELETE /api/v1/devices/{dev_id}:", res.status_code, res.json())
        assert res.status_code == 200

        # 8. Verify deletion
        res = await ac.get(f"/api/v1/devices/{dev_id}")
        print(f"[8] GET /api/v1/devices/{dev_id} (post-delete):", res.status_code)
        assert res.status_code == 404

    print("\n--- ALL BACKEND TESTS PASSED SUCCESSFULLY! ---")

if __name__ == "__main__":
    asyncio.run(run_tests())

