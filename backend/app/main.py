import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
import asyncpg

from .config import settings
from .database import init_db, close_db, get_db_pool
from .models import (
    DeviceCreate,
    DeviceUpdate,
    DeviceOut,
    DeviceDetailOut,
    InterfaceOut,
    InterfaceTrafficOut,
    TrafficSeriesOut,
    PollTrafficResult,
    DeviceStatus,
    ScanRequest,
    DiscoveredDevice,
    ImportRequest,
    ConnectResult,
    LocalNetworkInfo,
    AlertOut,
    AlertCreate,
)
from .placement import pick_free_spot, pick_smart_spot, resolve_room_from_coords, project_gps_to_canvas
from .snmp import snmp_get_oid, OID_SYS_DESCR, OID_SYS_UPTIME
from .discovery import scan_network_cidr, ping_ip, detect_local_network_info
from .collector import (
    collect_device_interfaces,
    sync_device_interfaces,
    poll_and_calculate_device_traffic,
    get_device_traffic_series,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("netmonitor.api")

async def background_snmp_poller():
    """
    Background worker that runs every 30 seconds to archive
    genuine historical SNMP samples in PostgreSQL for all enabled devices.
    Uses PostgreSQL advisory lock to prevent duplicate polling across multiple Uvicorn worker processes.
    """
    logger.info("Background SNMP archive poller started.")
    sem = asyncio.Semaphore(5)
    ADVISORY_LOCK_ID = 0x534E4D50  # 'SNMP'

    async def poll_dev(pool, dev):
        async with sem:
            comm = dev["credential_ref"] or settings.SNMP_COMMUNITY
            ver = "2c" if dev["snmp_version"] == "v2c" else "1"
            started_at = datetime.now(timezone.utc)
            try:
                res = await poll_and_calculate_device_traffic(pool, dev["id"], dev["ip"], comm, dev["snmp_port"], ver)
                status = "succeeded" if res.get("success") else "failed"
                err_msg = None if res.get("success") else "SNMP poll failed or device unreachable"
                await pool.execute(
                    """
                    INSERT INTO poll_runs (device_id, started_at, finished_at, status, error_message)
                    VALUES ($1, $2, now(), $3, $4)
                    """,
                    dev["id"], started_at, status, err_msg
                )
            except Exception as e:
                logger.debug(f"Background poll failed for {dev['ip']}: {e}")
                try:
                    await pool.execute(
                        """
                        INSERT INTO poll_runs (device_id, started_at, finished_at, status, error_message)
                        VALUES ($1, $2, now(), 'failed', $3)
                        """,
                        dev["id"], started_at, str(e)
                    )
                except Exception as db_err:
                    logger.error(f"Failed to record poll_run for {dev['ip']}: {db_err}")

    while True:
        try:
            await asyncio.sleep(30)
            pool = await get_db_pool()
            # Enforce single-poller execution across multiple Uvicorn workers
            has_lock = await pool.fetchval("SELECT pg_try_advisory_lock($1)", ADVISORY_LOCK_ID)
            if not has_lock:
                logger.debug("Another worker is running SNMP poller. Skipping.")
                continue

            try:
                dev_rows = await pool.fetch(
                    "SELECT id, host(management_ip) as ip, credential_ref, snmp_port, snmp_version FROM devices WHERE enabled = true AND management_ip IS NOT NULL"
                )
                tasks = [poll_dev(pool, dev) for dev in dev_rows if dev["ip"]]
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)
            finally:
                await pool.execute("SELECT pg_advisory_unlock($1)", ADVISORY_LOCK_ID)
        except asyncio.CancelledError:
            logger.info("Background SNMP archive poller stopped.")
            break
        except Exception as e:
            logger.error(f"Error in background_snmp_poller: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Connecting to database...")
    await init_db()
    bg_task = asyncio.create_task(background_snmp_poller())
    yield
    bg_task.cancel()
    try:
        await bg_task
    except asyncio.CancelledError:
        pass
    logger.info("Closing database connection...")
    await close_db()

app = FastAPI(
    title="NetMonitor API",
    version="1.0.0",
    description="Backend REST API for NetMonitor Network Topology & SNMP Monitoring System",
    lifespan=lifespan,
)

# Enable CORS for local Vite development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def compute_device_status(row: asyncpg.Record) -> DeviceStatus:
    if not row["enabled"]:
        return "offline"
    poll_status = row.get("latest_poll_status")
    # If unverified (no poll runs) or failed -> always offline
    if not poll_status or poll_status == "failed":
        return "offline"
    if poll_status == "warning":
        return "warning"
    return "online"

@app.get("/health")
async def health_check():
    pool = await get_db_pool()
    val = await pool.fetchval("SELECT 1")
    return {"status": "ok", "db": val == 1}

@app.get("/api/v1/health")
async def api_health_check():
    pool = await get_db_pool()
    val = await pool.fetchval("SELECT 1")
    return {"status": "ok", "service": "netmonitor-backend", "db": val == 1}

@app.get("/api/v1/devices", response_model=List[DeviceOut])
async def list_devices():
    pool = await get_db_pool()
    query = """
        SELECT 
            d.id, d.name, d.hostname, host(d.management_ip) AS ip, 
            d.snmp_port, d.snmp_version, d.poll_interval_s, 
            d.location, d.enabled, d.dtype, d.floor, d.x, d.y, 
            d.locked, d.model, d.latitude, d.longitude, d.altitude,
            p.status AS latest_poll_status
        FROM devices d
        LEFT JOIN LATERAL (
            SELECT status 
            FROM poll_runs 
            WHERE device_id = d.id 
            ORDER BY started_at DESC 
            LIMIT 1
        ) p ON TRUE
        ORDER BY d.id ASC;
    """
    rows = await pool.fetch(query)
    
    devices_data = []
    need_placement = []
    
    for r in rows:
        d_dict = dict(r)
        d_dict["status"] = compute_device_status(r)
        if d_dict["x"] is None or d_dict["y"] is None:
            need_placement.append(d_dict)
        else:
            devices_data.append(d_dict)

    # Auto-place any devices missing coordinates
    if need_placement:
        for d in need_placement:
            if d.get("latitude") is not None and d.get("longitude") is not None:
                gx, gy, room_label = project_gps_to_canvas(d["latitude"], d["longitude"], d["floor"])
            else:
                gx, gy, room_label = pick_smart_spot(devices_data, d["floor"], d["dtype"])
            d["x"] = gx
            d["y"] = gy
            devices_data.append(d)
            # Update coordinate and room location back to DB
            location_str = f"Floor {d['floor']} – {room_label}"
            await pool.execute(
                "UPDATE devices SET x = $1, y = $2, location = $3 WHERE id = $4",
                gx, gy, location_str, d["id"]
            )

    return [
        DeviceOut(
            id=str(d["id"]),
            name=d["name"],
            dtype=d["dtype"],
            status=d["status"],
            floor=d["floor"],
            x=d["x"],
            y=d["y"],
            locked=d["locked"],
            ip=d["ip"],
            model=d["model"],
            latitude=d.get("latitude"),
            longitude=d.get("longitude"),
            altitude=d.get("altitude"),
        )
        for d in devices_data
    ]

@app.post("/api/v1/devices", response_model=DeviceOut, status_code=status.HTTP_201_CREATED)
async def create_device(payload: DeviceCreate):
    pool = await get_db_pool()
    
    # Check duplicate name
    existing_name = await pool.fetchval("SELECT id FROM devices WHERE LOWER(name) = LOWER($1)", payload.name)
    if existing_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device with name '{payload.name}' already exists",
        )

    # Auto-placement if coordinates not provided
    x = payload.x
    y = payload.y
    room_label = None
    if x is None or y is None:
        if payload.latitude is not None and payload.longitude is not None:
            gx, gy, room_label = project_gps_to_canvas(payload.latitude, payload.longitude, payload.floor)
            x = gx
            y = gy
        else:
            all_devs = await pool.fetch("SELECT floor, x, y FROM devices WHERE x IS NOT NULL AND y IS NOT NULL")
            placed_list = [dict(r) for r in all_devs]
            gx, gy, room_label = pick_smart_spot(placed_list, payload.floor, payload.dtype)
            x = x if x is not None else gx
            y = y if y is not None else gy
    else:
        room_label = resolve_room_from_coords(payload.floor, float(x), float(y))

    location_str = payload.location or f"Floor {payload.floor} – {room_label}"
    ip = payload.ip or "192.168.1.100"
    hostname = f"{payload.name.lower().replace(' ', '-')}.corp.local"

    insert_query = """
        INSERT INTO devices (
            name, hostname, management_ip, snmp_port, snmp_version, 
            credential_ref, poll_interval_s, location, enabled,
            dtype, floor, x, y, locked, model, latitude, longitude, altitude
        )
        VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id, name, dtype, floor, x, y, locked, host(management_ip) AS ip, model, latitude, longitude, altitude;
    """
    try:
        row = await pool.fetchrow(
            insert_query,
            payload.name,
            hostname,
            ip,
            payload.snmp_port,
            payload.snmp_version,
            payload.credential_ref,
            payload.poll_interval_s,
            location_str,
            payload.enabled,
            payload.dtype,
            payload.floor,
            x,
            y,
            payload.locked if payload.locked is not None else True,
            payload.model,
            payload.latitude,
            payload.longitude,
            payload.altitude,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device with IP {ip} and port {payload.snmp_port} already exists",
        )

    # Insert initial unverified poll run (starts as offline)
    await pool.execute(
        "INSERT INTO poll_runs (device_id, status, error_message) VALUES ($1, 'failed', 'Awaiting connection verification')",
        row["id"],
    )

    return DeviceOut(
        id=str(row["id"]),
        name=row["name"],
        dtype=row["dtype"],
        status="offline",
        floor=row["floor"],
        x=row["x"],
        y=row["y"],
        locked=row["locked"],
        ip=row["ip"],
        model=row["model"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        altitude=row["altitude"],
    )

@app.get("/api/v1/devices/{device_id}", response_model=DeviceDetailOut)
async def get_device_detail(device_id: int):
    pool = await get_db_pool()
    dev_row = await pool.fetchrow(
        """
        SELECT 
            d.id, d.name, d.hostname, host(d.management_ip) AS ip, 
            d.snmp_port, d.snmp_version, d.poll_interval_s, 
            d.location, d.enabled, d.dtype, d.floor, d.x, d.y, 
            d.locked, d.model, d.latitude, d.longitude, d.altitude,
            p.status AS latest_poll_status
        FROM devices d
        LEFT JOIN LATERAL (
            SELECT status FROM poll_runs 
            WHERE device_id = d.id 
            ORDER BY started_at DESC LIMIT 1
        ) p ON TRUE
        WHERE d.id = $1
        """,
        device_id,
    )
    if not dev_row:
        raise HTTPException(status_code=404, detail="Device not found")

    dev_out = DeviceOut(
        id=str(dev_row["id"]),
        name=dev_row["name"],
        dtype=dev_row["dtype"],
        status=compute_device_status(dev_row),
        floor=dev_row["floor"],
        x=dev_row["x"] or 100.0,
        y=dev_row["y"] or 100.0,
        locked=dev_row["locked"],
        ip=dev_row["ip"],
        model=dev_row["model"],
        latitude=dev_row["latitude"],
        longitude=dev_row["longitude"],
        altitude=dev_row["altitude"],
    )

    if_rows = await pool.fetch(
        "SELECT id, device_id, if_index, name, description, mac_address, speed_bps, admin_status, oper_status FROM interfaces WHERE device_id = $1 ORDER BY if_index ASC",
        device_id,
    )
    interfaces = [
        InterfaceOut(
            id=str(r["id"]),
            device_id=str(r["device_id"]),
            if_index=r["if_index"],
            name=r["name"],
            description=r["description"],
            mac_address=r["mac_address"],
            speed_bps=r["speed_bps"],
            admin_status=r["admin_status"],
            oper_status=r["oper_status"],
        )
        for r in if_rows
    ]

    metric_rows = await pool.fetch(
        """
        SELECT DISTINCT ON (metric_name) metric_name, numeric_value, sampled_at
        FROM device_metric_samples
        WHERE device_id = $1
        ORDER BY metric_name, sampled_at DESC
        """,
        device_id,
    )
    metrics = {r["metric_name"]: r["numeric_value"] for r in metric_rows}

    return DeviceDetailOut(
        device=dev_out,
        interfaces=interfaces,
        latest_metrics=metrics,
    )

@app.patch("/api/v1/devices/{device_id}", response_model=DeviceOut)
async def update_device(device_id: int, payload: DeviceUpdate):
    pool = await get_db_pool()
    current = await pool.fetchrow("SELECT * FROM devices WHERE id = $1", device_id)
    if not current:
        raise HTTPException(status_code=404, detail="Device not found")

    updates = []
    params = []
    idx = 1

    field_map = {
        "name": payload.name,
        "dtype": payload.dtype,
        "floor": payload.floor,
        "x": payload.x,
        "y": payload.y,
        "locked": payload.locked,
        "model": payload.model,
        "location": payload.location,
        "enabled": payload.enabled,
        "latitude": payload.latitude,
        "longitude": payload.longitude,
        "altitude": payload.altitude,
    }

    target_floor = payload.floor if payload.floor is not None else int(current["floor"])

    # If GPS coordinates provided without explicit x/y, project GPS to canvas
    if payload.latitude is not None and payload.longitude is not None and payload.x is None and payload.y is None:
        gx, gy, room_name = project_gps_to_canvas(payload.latitude, payload.longitude, target_floor)
        field_map["x"] = gx
        field_map["y"] = gy
        if payload.location is None:
            field_map["location"] = f"Floor {target_floor} – {room_name}"
    # Automatically re-classify room/zone from coordinates if x/y changed and location not overridden
    elif payload.x is not None and payload.y is not None and payload.location is None:
        room_name = resolve_room_from_coords(target_floor, float(payload.x), float(payload.y))
        field_map["location"] = f"Floor {target_floor} – {room_name}"

    if payload.ip:
        updates.append(f"management_ip = ${idx}::inet")
        params.append(payload.ip)
        idx += 1

    for col, val in field_map.items():
        if val is not None:
            updates.append(f"{col} = ${idx}")
            params.append(val)
            idx += 1

    if not updates:
        # No updates supplied
        pass
    else:
        updates.append(f"updated_at = now()")
        params.append(device_id)
        sql = f"UPDATE devices SET {', '.join(updates)} WHERE id = ${idx} RETURNING id;"
        try:
            await pool.execute(sql, *params)
        except asyncpg.UniqueViolationError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Device with IP {payload.ip} already exists",
            )

    # Return refreshed device
    updated_row = await pool.fetchrow(
        """
        SELECT 
            d.id, d.name, d.dtype, d.floor, d.x, d.y, d.locked, 
            host(d.management_ip) AS ip, d.model, d.enabled,
            d.latitude, d.longitude, d.altitude,
            p.status AS latest_poll_status
        FROM devices d
        LEFT JOIN LATERAL (
            SELECT status FROM poll_runs 
            WHERE device_id = d.id 
            ORDER BY started_at DESC LIMIT 1
        ) p ON TRUE
        WHERE d.id = $1
        """,
        device_id,
    )

    return DeviceOut(
        id=str(updated_row["id"]),
        name=updated_row["name"],
        dtype=updated_row["dtype"],
        status=compute_device_status(updated_row),
        floor=updated_row["floor"],
        x=updated_row["x"] or 100.0,
        y=updated_row["y"] or 100.0,
        locked=updated_row["locked"],
        ip=updated_row["ip"],
        model=updated_row["model"],
        latitude=updated_row["latitude"],
        longitude=updated_row["longitude"],
        altitude=updated_row["altitude"],
    )

@app.delete("/api/v1/devices/{device_id}", status_code=status.HTTP_200_OK)
async def delete_device(device_id: int):
    pool = await get_db_pool()
    result = await pool.execute("DELETE FROM devices WHERE id = $1", device_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Device not found")
    return {"success": True, "deleted_id": device_id}

@app.post("/api/v1/devices/{device_id}/poll")
async def trigger_poll(device_id: int):
    pool = await get_db_pool()
    dev = await pool.fetchrow("SELECT id, name, host(management_ip) AS ip, snmp_port, snmp_version, credential_ref FROM devices WHERE id = $1", device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    community = dev["credential_ref"] or settings.SNMP_COMMUNITY
    version = dev["snmp_version"]
    if version == "v2c":
        version = "2c"
    elif version == "v1":
        version = "1"

    success, val, err = await snmp_get_oid(
        ip=dev["ip"],
        oid=OID_SYS_UPTIME,
        community=community,
        version=version,
        port=dev["snmp_port"],
    )

    poll_status = "succeeded" if success else "failed"
    await pool.execute(
        "INSERT INTO poll_runs (device_id, status, error_message, finished_at) VALUES ($1, $2, $3, now())",
        device_id, poll_status, err
    )

    return {
        "device_id": device_id,
        "success": success,
        "uptime_raw": val,
        "error": err,
        "status": poll_status,
    }

@app.get("/api/v1/devices/{device_id}/interfaces", response_model=List[InterfaceTrafficOut])
async def get_device_interfaces(device_id: int):
    pool = await get_db_pool()
    dev = await pool.fetchrow("SELECT id, host(management_ip) AS ip, credential_ref, snmp_port, snmp_version FROM devices WHERE id = $1", device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    rows = await pool.fetch("""
        SELECT i.id, i.if_index, i.name, i.description, i.speed_bps, i.oper_status,
               0.0 AS in_mbps, 0.0 AS out_mbps
        FROM interfaces i
        WHERE i.device_id = $1
        ORDER BY i.if_index ASC
    """, device_id)

    # If no interfaces cached yet in DB, try an initial discovery poll if device has an IP
    if not rows and dev["ip"]:
        community = dev["credential_ref"] or settings.SNMP_COMMUNITY
        version = "2c" if dev["snmp_version"] == "v2c" else "1"
        ifaces = await collect_device_interfaces(dev["ip"], community, dev["snmp_port"], version)
        if ifaces:
            await sync_device_interfaces(pool, device_id, ifaces)
            rows = await pool.fetch("""
                SELECT id, if_index, name, description, speed_bps, oper_status, 0.0 AS in_mbps, 0.0 AS out_mbps
                FROM interfaces
                WHERE device_id = $1
                ORDER BY if_index ASC
            """, device_id)

    return [
        InterfaceTrafficOut(
            id=r["id"],
            if_index=r["if_index"],
            name=r["name"],
            description=r["description"],
            speed_bps=r["speed_bps"],
            oper_status=r["oper_status"],
            in_mbps=float(r["in_mbps"]),
            out_mbps=float(r["out_mbps"]),
        )
        for r in rows
    ]

@app.post("/api/v1/devices/{device_id}/poll-traffic", response_model=PollTrafficResult)
async def poll_device_traffic(device_id: int):
    pool = await get_db_pool()
    dev = await pool.fetchrow("SELECT id, host(management_ip) AS ip, credential_ref, snmp_port, snmp_version FROM devices WHERE id = $1", device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    community = dev["credential_ref"] or settings.SNMP_COMMUNITY
    version = "2c" if dev["snmp_version"] == "v2c" else "1"
    res = await poll_and_calculate_device_traffic(pool, device_id, dev["ip"], community, dev["snmp_port"], version)

    return PollTrafficResult(
        success=res["success"],
        has_snmp=res["has_snmp"],
        interfaces_polled=res["interfaces_polled"],
        total_in_mbps=res["total_in_mbps"],
        total_out_mbps=res["total_out_mbps"],
        timestamp=res["timestamp"],
        interfaces=[
            InterfaceTrafficOut(
                id=i["id"],
                if_index=i["if_index"],
                name=i["name"],
                description=i["description"],
                speed_bps=i["speed_bps"],
                oper_status=i["oper_status"],
                in_mbps=i["in_mbps"],
                out_mbps=i["out_mbps"],
            )
            for i in res.get("interfaces", [])
        ]
    )

@app.get("/api/v1/devices/{device_id}/traffic", response_model=TrafficSeriesOut)
async def get_device_traffic(device_id: int, interface_id: str = "all", range: str = "15m"):
    pool = await get_db_pool()
    dev = await pool.fetchrow("SELECT id FROM devices WHERE id = $1", device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    series = await get_device_traffic_series(pool, device_id, interface_id, range)
    return TrafficSeriesOut(
        has_snmp=series["has_snmp"],
        interface_id=series["interface_id"],
        inbound=series["inbound"],
        outbound=series["outbound"],
        labels=series["labels"],
        peak=series["peak"],
        avg=series["avg"],
        timestamp=series["timestamp"],
    )

@app.post("/api/v1/devices/{device_id}/connect", response_model=ConnectResult)
async def connect_device(device_id: int):
    pool = await get_db_pool()
    dev = await pool.fetchrow(
        "SELECT id, name, host(management_ip) AS ip, snmp_port, snmp_version, credential_ref FROM devices WHERE id = $1", 
        device_id
    )
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    community = dev["credential_ref"] or settings.SNMP_COMMUNITY
    version = dev["snmp_version"]
    if version == "v2c":
        version = "2c"
    elif version == "v1":
        version = "1"

    # Ping check
    ping_ok, rtt_ms, _ = await ping_ip(dev["ip"], timeout_ms=800)

    # SNMP check
    snmp_ok, uptime_val, snmp_err = await snmp_get_oid(
        ip=dev["ip"],
        oid=OID_SYS_UPTIME,
        community=community,
        version=version,
        port=dev["snmp_port"],
        timeout_s=2,
    )

    if snmp_ok or ping_ok:
        if snmp_ok:
            _, descr, _ = await snmp_get_oid(
                ip=dev["ip"], oid=OID_SYS_DESCR, community=community, version=version, port=dev["snmp_port"]
            )
            if descr:
                clean_model = descr.split(',')[0].strip()
                await pool.execute("UPDATE devices SET model = $1 WHERE id = $2", clean_model, device_id)

        await pool.execute(
            "INSERT INTO poll_runs (device_id, status, error_message, finished_at) VALUES ($1, 'succeeded', NULL, now())",
            device_id,
        )
        proto = "SNMP" if snmp_ok else "Ping"
        try:
            await pool.execute(
                "INSERT INTO alerts (device_id, severity, icon, title, description) VALUES ($1, 'info', '', $2, $3)",
                device_id,
                f"เชื่อมต่ออุปกรณ์สำเร็จ ({proto})",
                f"สถานะออนไลน์ ตอบสนองปกติ (RTT: {rtt_ms}ms, Uptime: {uptime_val or 'N/A'})"
            )
        except Exception as alert_err:
            logger.warning(f"Failed to record connect alert: {alert_err}")

        return ConnectResult(
            device_id=str(device_id),
            success=True,
            status="online",
            message=f"Connected successfully via {proto} (RTT: {rtt_ms}ms)",
            sys_uptime=uptime_val,
        )
    else:
        err_msg = snmp_err or "Host unreachable (Ping and SNMP failed)"
        await pool.execute(
            "INSERT INTO poll_runs (device_id, status, error_message, finished_at) VALUES ($1, 'failed', $2, now())",
            device_id, err_msg,
        )
        try:
            await pool.execute(
                "INSERT INTO alerts (device_id, severity, icon, title, description) VALUES ($1, 'crit', '', $2, $3)",
                device_id,
                "อุปกรณ์ไม่ตอบสนองการเชื่อมต่อ",
                err_msg
            )
        except Exception as alert_err:
            logger.warning(f"Failed to record disconnect alert: {alert_err}")

        return ConnectResult(
            device_id=str(device_id),
            success=False,
            status="offline",
            message=err_msg,
            sys_uptime=None,
        )

@app.get("/api/v1/discovery/local-info", response_model=LocalNetworkInfo)
async def get_local_info():
    info = detect_local_network_info()
    return LocalNetworkInfo(
        local_ip=info["local_ip"],
        detected_subnet=info["detected_subnet"],
        gateway=info["gateway"],
        wifi_ssid=info.get("wifi_ssid"),
        wifi_bssid=info.get("wifi_bssid"),
        wifi_signal=info.get("wifi_signal"),
    )

@app.post("/api/v1/discovery/scan", response_model=List[DiscoveredDevice])
async def scan_network(payload: ScanRequest):
    try:
        rooms_dict = None
        if payload.floor_rooms:
            rooms_dict = {int(k): v for k, v in payload.floor_rooms.items()}

        results = await scan_network_cidr(
            cidr=payload.cidr,
            community=payload.community,
            snmp_port=payload.snmp_port,
            scan_mode=payload.scan_mode or "quick",
            floor_split_threshold=payload.floor_split_ip or 120,
            building_bounds=payload.building_bounds,
            auto_assign_gps=payload.auto_assign_gps if payload.auto_assign_gps is not None else True,
            floor_rooms=rooms_dict,
        )
        return [DiscoveredDevice(**r) for r in results]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Discovery scan failed: {e}")
        raise HTTPException(status_code=500, detail=f"Discovery scan failed: {e}")

@app.post("/api/v1/discovery/import", response_model=List[DeviceOut])
async def import_discovered_devices(payload: ImportRequest):
    pool = await get_db_pool()
    all_devs = await pool.fetch("SELECT floor, x, y FROM devices WHERE x IS NOT NULL AND y IS NOT NULL")
    placed_list = [dict(r) for r in all_devs]

    imported = []
    for item in payload.devices:
        exists = await pool.fetchval(
            "SELECT id FROM devices WHERE host(management_ip) = $1 OR LOWER(name) = LOWER($2)",
            item.ip, item.name
        )
        if exists:
            # Strict Deduplication: Do not import duplicate devices
            logger.info(f"Skipping duplicate device during import: {item.name} ({item.ip})")
            continue

        if item.x is not None and item.y is not None:
            gx, gy = float(item.x), float(item.y)
            room_label = resolve_room_from_coords(item.floor, gx, gy)
        elif item.latitude is not None and item.longitude is not None:
            gx, gy, room_label = project_gps_to_canvas(item.latitude, item.longitude, item.floor)
        else:
            gx, gy, room_label = pick_smart_spot(placed_list, item.floor, item.dtype)
        placed_list.append({"floor": item.floor, "x": gx, "y": gy})

        hostname = f"{item.name.lower().replace(' ', '-')}.corp.local"
        chosen_room = item.target_room.strip() if item.target_room and item.target_room.strip() else room_label
        location_str = f"Floor {item.floor} – {chosen_room}" if chosen_room else f"Floor {item.floor}"
        device_community = item.community or settings.SNMP_COMMUNITY or "public"
        insert_query = """
            INSERT INTO devices (
                name, hostname, management_ip, snmp_port, snmp_version, 
                credential_ref, poll_interval_s, location, enabled,
                dtype, floor, x, y, locked, model, latitude, longitude, altitude
            )
            VALUES ($1, $2, $3::inet, 161, 'v2c', $13, 60, $4, true, $5, $6, $7, $8, true, $9, $10, $11, $12)
            RETURNING id, name, dtype, floor, x, y, locked, host(management_ip) AS ip, model, latitude, longitude, altitude;
        """
        row = await pool.fetchrow(
            insert_query,
            item.name,
            hostname,
            item.ip,
            location_str,
            item.dtype,
            item.floor,
            gx, gy,
            item.model or f"Discovered {item.dtype.title()}",
            item.latitude,
            item.longitude,
            item.altitude,
            device_community,
        )

        # Mark succeeded since it was discovered live -> remains online until failure
        await pool.execute(
            "INSERT INTO poll_runs (device_id, status, finished_at) VALUES ($1, 'succeeded', now())",
            row["id"]
        )

        try:
            await pool.execute(
                "INSERT INTO alerts (device_id, severity, icon, title, description) VALUES ($1, 'info', '', 'นำเข้าอุปกรณ์เข้าสู่ระบบสำเร็จ', $2)",
                row["id"],
                f"อุปกรณ์ {item.name} ({item.ip}) ได้รับการจัดวางและเชื่อมโยงกับระบบเครือข่ายเรียบร้อยแล้ว"
            )
        except Exception as alert_err:
            logger.warning(f"Failed to record import alert: {alert_err}")

        imported.append(
            DeviceOut(
                id=str(row["id"]),
                name=row["name"],
                dtype=row["dtype"],
                status="online",
                floor=row["floor"],
                x=row["x"],
                y=row["y"],
                locked=row["locked"],
                ip=row["ip"],
                model=row["model"],
                latitude=row["latitude"],
                longitude=row["longitude"],
                altitude=row["altitude"],
            )
        )
    return imported

@app.post("/api/v1/clear")
async def clear_database():
    """
    Clears all devices, interfaces, metrics, and poll runs from DB completely (0 records).
    """
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("TRUNCATE TABLE alerts, poll_runs, interface_samples, device_metric_samples, interfaces, devices CASCADE;")
                await conn.execute("ALTER SEQUENCE IF EXISTS devices_id_seq RESTART WITH 1;")
                await conn.execute("ALTER SEQUENCE IF EXISTS alerts_id_seq RESTART WITH 1;")
        return {"success": True, "message": "All devices and related data have been cleared completely from database"}
    except Exception as e:
        logger.error(f"Clear failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/reset")
async def reset_database():
    """
    Resets devices and related tables back to default seed state
    """
    pool = await get_db_pool()
    # Read seed sql and execute
    try:
        base_dir = Path(__file__).resolve().parents[2]
        with open(base_dir / "seed_mock_data.sql", "r", encoding="utf-8") as f:
            seed_sql = f.read()

        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("TRUNCATE TABLE alerts, poll_runs, interface_samples, device_metric_samples, interfaces, devices CASCADE;")
                await conn.execute("ALTER SEQUENCE IF EXISTS devices_id_seq RESTART WITH 1;")
                await conn.execute("ALTER SEQUENCE IF EXISTS alerts_id_seq RESTART WITH 1;")
                await conn.execute(seed_sql)
        return {"success": True, "message": "Database successfully reset to initial seed data"}
    except Exception as e:
        logger.error(f"Reset failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Alert API Endpoints ─────────────────────────────────────

@app.get("/api/v1/alerts", response_model=List[AlertOut])
async def list_alerts(
    device_id: Optional[str] = None,
    severity: Optional[str] = None,
    unack_only: bool = False,
    limit: int = 50,
):
    """
    Returns alerts from database, optionally filtered by device_id, severity, or unacknowledged status.
    """
    pool = await get_db_pool()
    query = """
        SELECT id, device_id, severity, icon, title, description,
               to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at,
               acknowledged, acknowledged_by
        FROM alerts
        WHERE 1=1
    """
    params = []
    if device_id:
        try:
            params.append(int(device_id))
            query += f" AND device_id = ${len(params)}"
        except ValueError:
            return []
    if severity:
        params.append(severity)
        query += f" AND severity = ${len(params)}"
    if unack_only:
        query += " AND acknowledged = false"

    query += " ORDER BY created_at DESC"
    params.append(limit)
    query += f" LIMIT ${len(params)}"

    try:
        rows = await pool.fetch(query, *params)
        return [
            AlertOut(
                id=r["id"],
                device_id=str(r["device_id"]),
                severity=r["severity"],
                icon=r["icon"] or "",
                title=r["title"],
                description=r["description"],
                created_at=r["created_at"],
                acknowledged=r["acknowledged"],
                acknowledged_by=r["acknowledged_by"],
            )
            for r in rows
        ]
    except Exception as e:
        logger.error(f"Error listing alerts: {e}")
        return []

@app.get("/api/v1/devices/{device_id}/alerts", response_model=List[AlertOut])
async def list_device_alerts(device_id: str, limit: int = 20):
    return await list_alerts(device_id=device_id, limit=limit)

@app.post("/api/v1/devices/{device_id}/alerts", response_model=AlertOut)
async def create_device_alert(device_id: str, payload: AlertCreate):
    pool = await get_db_pool()
    try:
        dev_id_int = int(device_id)
        row = await pool.fetchrow(
            """
            INSERT INTO alerts (device_id, severity, icon, title, description)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, device_id, severity, icon, title, description,
                      to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at,
                      acknowledged, acknowledged_by
            """,
            dev_id_int, payload.severity, payload.icon, payload.title, payload.description
        )
        return AlertOut(
            id=row["id"],
            device_id=str(row["device_id"]),
            severity=row["severity"],
            icon=row["icon"] or "",
            title=row["title"],
            description=row["description"],
            created_at=row["created_at"],
            acknowledged=row["acknowledged"],
            acknowledged_by=row["acknowledged_by"],
        )
    except Exception as e:
        logger.error(f"Error creating alert: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/alerts/{alert_id}/ack")
async def acknowledge_alert(alert_id: int):
    pool = await get_db_pool()
    try:
        res = await pool.execute(
            "UPDATE alerts SET acknowledged = true, acknowledged_by = 'admin' WHERE id = $1",
            alert_id,
        )
        if res == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Alert not found")
        return {"success": True, "alert_id": alert_id, "acknowledged": True}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error acknowledging alert: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/v1/models")
async def list_models():
    """Fallback for local AI tools/extensions probing port 8000"""
    return {"object": "list", "data": []}
