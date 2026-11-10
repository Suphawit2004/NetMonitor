import subprocess
import time
import urllib.request
import urllib.error
import json
import sys

def probe(url, method="GET", data=None, timeout=30):
    req = urllib.request.Request(url, method=method)
    if data:
        req.add_header('Content-Type', 'application/json')
        body = json.dumps(data).encode('utf-8')
    else:
        body = None
    
    with urllib.request.urlopen(req, data=body, timeout=timeout) as res:
        return res.status, res.read().decode('utf-8')

def main():
    print("[E2E] 1. Starting FastAPI backend on port 8000...")
    backend_proc = subprocess.Popen(
        [
            r"c:\work\snmp_font_end\backend\venv\Scripts\python.exe",
            "-m", "uvicorn",
            "app.main:app",
            "--host", "127.0.0.1",
            "--port", "8000",
        ],
        cwd=r"c:\work\snmp_font_end\backend",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    print("[E2E] 2. Starting Vite frontend on port 5173...")
    frontend_proc = subprocess.Popen(
        ["cmd.exe", "/c", "npm run dev -- --host 127.0.0.1 --port 5173"],
        cwd=r"c:\work\snmp_font_end\netmonitor",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        # Wait for backend to be ready
        print("[E2E] Waiting for servers to initialize...")
        ready = False
        for _ in range(15):
            time.sleep(1)
            try:
                st, body = probe("http://127.0.0.1:8000/health")
                if st == 200 and json.loads(body).get("status") == "ok":
                    print("     -> Backend is healthy!")
                    ready = True
                    break
            except Exception:
                pass
        
        if not ready:
            print("ERROR: Backend did not start in time.")
            return False

        # Wait for Vite frontend
        fe_ready = False
        for _ in range(15):
            time.sleep(1)
            try:
                st, body = probe("http://127.0.0.1:5173/")
                if st == 200 and "<div id=\"root\">" in body:
                    print("     -> Frontend Vite server is serving index.html!")
                    fe_ready = True
                    break
            except Exception:
                pass

        if not fe_ready:
            print("ERROR: Frontend Vite server did not start in time.")
            return False

        # 3. Test Vite Proxy -> Backend API (List devices)
        print("\n[E2E] 3. Testing Frontend Proxy: GET http://127.0.0.1:5173/api/v1/devices")
        st, body = probe("http://127.0.0.1:5173/api/v1/devices")
        devices = json.loads(body)
        print(f"     -> HTTP Status: {st}")
        print(f"     -> Successfully received {len(devices)} devices via Vite Proxy from PostgreSQL!")

        # 4. Test Creating a Device via Frontend Proxy (MUST BE OFFLINE)
        print("\n[E2E] 4. Testing Device Creation via Frontend Proxy: POST /api/v1/devices")
        unique_name = f"E2E-OFFLINE-{int(time.time())}"
        test_payload = {
            "name": unique_name,
            "dtype": "switch",
            "floor": 1,
            "ip": "127.0.0.1",
            "model": "Cisco Catalyst 9300",
            "enabled": True
        }
        st, body = probe("http://127.0.0.1:5173/api/v1/devices", method="POST", data=test_payload)
        created = json.loads(body)
        dev_id = created["id"]
        print(f"     -> Created Device ID: {dev_id}, Name: {created['name']}")
        print(f"     -> Initial Status: {created['status']}")
        assert created["status"] == "offline", f"Expected offline status, got {created['status']}"
        print("     -> [PASS] Verified device starts as OFFLINE!")

        # 5. Test Connect & Verify on the Device (Transition to Online)
        print(f"\n[E2E] 5. Testing Connect & Verify via Frontend Proxy: POST /api/v1/devices/{dev_id}/connect")
        st, body = probe(f"http://127.0.0.1:5173/api/v1/devices/{dev_id}/connect", method="POST")
        conn_res = json.loads(body)
        print(f"     -> Connect Result: {conn_res}")
        assert conn_res["success"] is True
        assert conn_res["status"] == "online"
        print("     -> [PASS] Verified device transitioned to ONLINE after connection test!")

        # 6. Test Local Info & Zero-Config Auto Scan via Frontend Proxy
        print("\n[E2E] 6. Testing Local Info: GET http://127.0.0.1:5173/api/v1/discovery/local-info")
        st, body = probe("http://127.0.0.1:5173/api/v1/discovery/local-info")
        info = json.loads(body)
        print(f"     -> Local Info: {info}")
        assert "detected_subnet" in info
        print("     -> [PASS] Verified Local Network Info auto-detected!")

        print("\n[E2E] 7. Testing Zero-Config Auto Scan: POST http://127.0.0.1:5173/api/v1/discovery/scan (cidr='auto')")
        scan_payload = {"cidr": "auto", "community": "public", "snmp_port": 161}
        st, body = probe("http://127.0.0.1:5173/api/v1/discovery/scan", method="POST", data=scan_payload)
        discovered = json.loads(body)
        print(f"     -> Zero-Config Scan HTTP Status: {st}, found {len(discovered)} device(s)")
        assert len(discovered) >= 1
        print("     -> [PASS] Verified Zero-Config Auto Scan works via Frontend Proxy without entering subnet!")

        # 8. Test Deleting Device via Frontend Proxy
        print(f"\n[E2E] 8. Testing Device Deletion via Frontend Proxy: DELETE /api/v1/devices/{dev_id}")
        st, body = probe(f"http://127.0.0.1:5173/api/v1/devices/{dev_id}", method="DELETE")
        print(f"     -> Deleted successfully, HTTP {st}")

        print("\n[E2E] === ALL OFFLINE-FIRST & NETWORK DISCOVERY CHECKS PASSED 100%! ===")
        return True

    finally:
        print("[E2E] Cleaning up test processes...")
        backend_proc.terminate()
        frontend_proc.terminate()
        backend_proc.kill()
        frontend_proc.kill()

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
