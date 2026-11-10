import asyncio
import os
import sys
import time

sys.path.insert(0, r"c:\work\snmp_font_end\backend")

from httpx import AsyncClient, ASGITransport
from app.main import app
from app.placement import resolve_room_from_coords, pick_smart_spot

def test_placement_math():
    print("Testing placement coordinate to room classification...")
    # Floor 1 tests
    assert resolve_room_from_coords(1, 96, 98) == "Server Room"
    assert resolve_room_from_coords(1, 280, 98) == "Network Core"
    assert resolve_room_from_coords(1, 500, 98) == "Zone A – Office"
    assert resolve_room_from_coords(1, 100, 250) == "Zone B – Meeting"
    assert resolve_room_from_coords(1, 450, 250) == "Zone C – Lab"
    assert resolve_room_from_coords(1, 100, 420) == "IT Office"
    assert resolve_room_from_coords(1, 350, 420) == "Zone D – Lounge"
    
    # Smart spot selection
    placed = []
    sx, sy, sroom = pick_smart_spot(placed, 1, "switch")
    print(f" -> Switch assigned to: {sroom} at ({sx}, {sy})")
    assert sroom in ("Network Core", "Server Room")

    srv_x, srv_y, srv_room = pick_smart_spot([{"floor": 1, "x": sx, "y": sy}], 1, "server")
    print(f" -> Server assigned to: {srv_room} at ({srv_x}, {srv_y})")
    assert srv_room in ("Server Room", "Network Core")

    ap_x, ap_y, ap_room = pick_smart_spot([{"floor": 1, "x": sx, "y": sy}], 1, "ap")
    print(f" -> AP assigned to: {ap_room} at ({ap_x}, {ap_y})")
    assert "Zone" in ap_room

async def run_api_tests():
    print("\n--- Testing API Smart Placement, Deduplication & Online Status ---")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Health check
        res = await ac.get("/api/v1/health")
        assert res.status_code == 200
        print("[1] Health check OK:", res.json())

        # 2. Local info check
        res = await ac.get("/api/v1/discovery/local-info")
        assert res.status_code == 200
        info = res.json()
        print(f"[2] Local network info: IP={info['local_ip']}, Subnet={info['detected_subnet']}")

        # 3. Test Import with Smart Placement & Online Status
        test_ip = f"192.168.22.{int(time.time() % 200 + 50)}"
        test_name = f"TEST-CORE-SW-{int(time.time())}"
        import_payload = {
            "devices": [
                {
                    "name": test_name,
                    "ip": test_ip,
                    "dtype": "switch",
                    "floor": 1,
                    "model": "Aruba 2930F-24G",
                }
            ]
        }
        res = await ac.post("/api/v1/discovery/import", json=import_payload)
        assert res.status_code == 200
        imported = res.json()
        assert len(imported) == 1, "Expected 1 device imported"
        dev = imported[0]
        dev_id = dev["id"]
        print(f"[3] Imported device {dev_id}: name={dev['name']}, status={dev['status']}, pos=({dev['x']}, {dev['y']})")
        assert dev["status"] == "online", "Discovered device MUST be online upon import"
        
        # Verify room classification
        room = resolve_room_from_coords(1, dev["x"], dev["y"])
        print(f"    -> Resolved Room: {room}")
        assert room in ("Network Core", "Server Room")

        # 4. Strict Deduplication: Try to import the SAME device again
        print("[4] Testing strict deduplication (re-importing same device)...")
        res2 = await ac.post("/api/v1/discovery/import", json=import_payload)
        assert res2.status_code == 200
        imported2 = res2.json()
        assert len(imported2) == 0, "Duplicate device MUST NOT be imported"
        print("    -> [SUCCESS] Duplicate import successfully prevented (0 devices imported)")

        # 5. Clean up test device
        await ac.delete(f"/api/v1/devices/{dev_id}")
        print("[5] Cleaned up test device.")

    print("\n--- ALL SMART PLACEMENT & DEDUPLICATION TESTS PASSED! ---")

if __name__ == "__main__":
    test_placement_math()
    asyncio.run(run_api_tests())

