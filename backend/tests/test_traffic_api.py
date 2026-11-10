import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database import init_db, close_db

@pytest.mark.asyncio
async def test_traffic_endpoints():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 1. Test get interfaces for device 1
        res = await ac.get("/api/v1/devices/1/interfaces")
        assert res.status_code == 200
        ifaces = res.json()
        assert isinstance(ifaces, list)
        print("GET /interfaces count:", len(ifaces))

        # 2. Test get traffic series
        res = await ac.get("/api/v1/devices/1/traffic?interface_id=all&range=15m")
        assert res.status_code == 200
        data = res.json()
        assert "has_snmp" in data
        assert "inbound" in data
        assert "outbound" in data
        assert len(data["inbound"]) == 60
        assert len(data["outbound"]) == 60

        # 3. Test non-existent device returns 404
        res = await ac.get("/api/v1/devices/999999/interfaces")
        assert res.status_code == 404
    await close_db()
