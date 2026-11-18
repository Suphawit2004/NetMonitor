import asyncio
import hmac
import json
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
import asyncpg

from .config import settings
from .database import init_db, close_db, get_db_pool
from . import repository
from .repository import compute_device_status
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
    TopologyLinkCreate,
    TopologyLinkOut,
    SimulationImpactRequest,
    SimulationImpactResponse,
    ApplyFaultsRequest,
    FloorLayoutUpdate,
    FloorLayoutOut,
)
from .placement import ROOMS, pick_free_spot, pick_smart_spot, resolve_room_from_coords, project_gps_to_canvas
from .snmp import snmp_get_oid, OID_SYS_DESCR, OID_SYS_UPTIME
from .discovery import scan_network_cidr, probe_device_reachability, detect_local_network_info
from .topology import infer_topology_links, compute_blast_radius
from .collector import (
    collect_device_interfaces,
    sync_device_interfaces,
    poll_and_calculate_device_traffic,
    get_device_traffic_series,
    get_latest_interface_traffic_snapshot,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("netmonitor.api")


async def require_api_key(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    """Enforces X-API-Key header on mutating and network-scanning endpoints when API_KEY is set."""
    expected = settings.API_KEY.strip()
    if not expected:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-API-Key",
        )


async def _resolve_effective_rooms(
    pool: asyncpg.Pool,
    override_rooms: Optional[Dict[int, List[Any]]] = None,
) -> Dict[int, List[Any]]:
    """Resolves per-floor room definitions from request override, DB floor_layouts, or ROOMS defaults."""
    if override_rooms:
        return {int(k): v for k, v in override_rooms.items()}
    stored = await repository.fetch_floor_layouts(pool)
    return {
        1: stored.get(1, ROOMS[1]),
        2: stored.get(2, ROOMS[2]),
    }

def resolve_poll_failure_outcome(prev_status: Optional[str], detail: Optional[str] = None) -> tuple[str, str]:
    """Requires two consecutive failed background poll cycles before marking an active device offline."""
    if prev_status == "succeeded":
        return "warning", detail or "Transient poll miss (1/2) — retrying next cycle"
    return "failed", detail or "SNMP poll failed or device unreachable"


async def background_snmp_poller():
    """
    Background worker that runs every SNMP_POLL_INTERVAL_S seconds to archive
    genuine historical SNMP samples in PostgreSQL for all enabled devices.
    Uses PostgreSQL advisory lock to prevent duplicate polling across multiple Uvicorn worker processes.
    """
    logger.info("Background SNMP archive poller started.")
    sem = asyncio.Semaphore(settings.SNMP_MAX_CONCURRENT_POLLS)

    async def poll_dev(pool, dev):
        async with sem:
            comm = dev["credential_ref"] or settings.SNMP_COMMUNITY
            ver = "2c" if dev["snmp_version"] == "v2c" else "1"
            prev_status = dev["latest_poll_status"] if "latest_poll_status" in dev else None
            started_at = datetime.now(timezone.utc)
            try:
                res = await poll_and_calculate_device_traffic(pool, dev["id"], dev["ip"], comm, dev["snmp_port"], ver)
                if res.get("success"):
                    status, err_msg = "succeeded", None
                else:
                    status, err_msg = resolve_poll_failure_outcome(prev_status)
                await repository.record_poll_run(pool, dev["id"], started_at, status, err_msg)
            except Exception as e:
                logger.debug(f"Background poll failed for {dev['ip']}: {e}")
                status, err_msg = resolve_poll_failure_outcome(prev_status, str(e))
                await repository.record_poll_run(pool, dev["id"], started_at, status, err_msg)

    cycle_count = 0
    while True:
        try:
            await asyncio.sleep(settings.SNMP_POLL_INTERVAL_S)
            cycle_count += 1
            pool = await get_db_pool()
            # Enforce single-poller execution across multiple Uvicorn workers
            async with pool.acquire() as lock_conn:
                has_lock = await lock_conn.fetchval(
                    "SELECT pg_try_advisory_lock($1)", settings.ADVISORY_LOCK_SNMP_POLLER
                )
                if not has_lock:
                    logger.debug("Another worker is running SNMP poller. Skipping.")
                    continue

                try:
                    dev_rows = await repository.fetch_pollable_devices(lock_conn)
                    tasks = [poll_dev(pool, dev) for dev in dev_rows if dev["ip"]]
                    if tasks:
                        await asyncio.gather(*tasks, return_exceptions=True)
                    if cycle_count % 120 == 0:
                        await repository.purge_expired_telemetry(pool, settings.METRICS_RETENTION_DAYS)
                finally:
                    await lock_conn.execute(
                        "SELECT pg_advisory_unlock($1)", settings.ADVISORY_LOCK_SNMP_POLLER
                    )
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
    version="1.3.5",
    description="Backend REST API for NetMonitor Network Topology & SNMP Monitoring System",
    lifespan=lifespan,
)

# Enable CORS restricted to configured origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization"],
)

def _parse_services(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not isinstance(raw, (list, tuple)):
        return []
    return [str(s).strip() for s in raw if str(s).strip()]


def _serialize_device(d: Any, status_override: Optional[DeviceStatus] = None) -> DeviceOut:
    getter = d.get if hasattr(d, "get") else lambda k, default=None: d[k] if k in d else default
    computed = status_override or getter("status") or compute_device_status(d)
    x_val = getter("x")
    y_val = getter("y")
    return DeviceOut(
        id=str(d["id"]),
        name=d["name"],
        dtype=d["dtype"],
        status=computed,
        floor=d["floor"],
        x=100.0 if x_val is None else x_val,
        y=100.0 if y_val is None else y_val,
        locked=d["locked"],
        ip=d["ip"],
        model=d["model"],
        latitude=getter("latitude"),
        longitude=getter("longitude"),
        altitude=getter("altitude"),
        services=_parse_services(getter("services")),
    )


@app.get("/health")
async def health_check():
    pool = await get_db_pool()
    db_ok = await repository.check_db_health(pool)
    return {"status": "ok", "db": db_ok}

@app.get("/api/v1/health")
async def api_health_check():
    pool = await get_db_pool()
    db_ok = await repository.check_db_health(pool)
    return {"status": "ok", "service": "netmonitor-backend", "db": db_ok}

@app.get("/api/v1/layout")
async def get_floor_layouts():
    pool = await get_db_pool()
    stored = await repository.fetch_floor_layouts(pool)
    return {
        "1": stored.get(1, ROOMS[1]),
        "2": stored.get(2, ROOMS[2]),
    }

@app.put("/api/v1/layout/{floor}", response_model=FloorLayoutOut, dependencies=[Depends(require_api_key)])
async def update_floor_layout(floor: int, payload: FloorLayoutUpdate):
    if floor not in (1, 2):
        raise HTTPException(status_code=400, detail="Floor must be 1 or 2")
    pool = await get_db_pool()
    rooms_dicts = [r.model_dump() for r in payload.rooms]
    await repository.upsert_floor_layout(pool, floor, rooms_dicts)
    return FloorLayoutOut(floor=floor, rooms=payload.rooms)

@app.get("/api/v1/devices", response_model=List[DeviceOut])
async def list_devices():
    pool = await get_db_pool()
    rows = await repository.fetch_devices_with_telemetry(pool)

    devices_data = []
    need_placement = []

    for r in rows:
        d_dict = dict(r)
        d_dict["status"] = compute_device_status(r)
        if d_dict["x"] is None or d_dict["y"] is None:
            need_placement.append(d_dict)
        else:
            devices_data.append(d_dict)

    # Auto-place any devices missing coordinates using persisted floor layouts
    if need_placement:
        rooms_dict = await _resolve_effective_rooms(pool)
        for d in need_placement:
            if d.get("latitude") is not None and d.get("longitude") is not None:
                gx, gy, room_label = project_gps_to_canvas(
                    d["latitude"], d["longitude"], d["floor"], custom_rooms=rooms_dict
                )
            else:
                gx, gy, room_label = pick_smart_spot(
                    devices_data, d["floor"], d["dtype"], custom_rooms=rooms_dict
                )
            d["x"] = gx
            d["y"] = gy
            devices_data.append(d)
            location_str = f"Floor {d['floor']} – {room_label}"
            await repository.update_device_placement(pool, d["id"], gx, gy, location_str)

    return [_serialize_device(d) for d in devices_data]

@app.post("/api/v1/devices", response_model=DeviceOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def create_device(payload: DeviceCreate):
    pool = await get_db_pool()

    existing_name = await repository.check_device_name_exists(pool, payload.name)
    if existing_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device with name '{payload.name}' already exists",
        )

    rooms_dict = await _resolve_effective_rooms(pool, payload.floor_rooms)

    # Auto-placement if coordinates not provided
    x = payload.x
    y = payload.y
    room_label = None
    if x is None or y is None:
        if payload.latitude is not None and payload.longitude is not None:
            gx, gy, room_label = project_gps_to_canvas(
                payload.latitude, payload.longitude, payload.floor, custom_rooms=rooms_dict
            )
            x = gx
            y = gy
        else:
            placed_list = await repository.fetch_placed_device_coords(pool)
            gx, gy, room_label = pick_smart_spot(
                placed_list, payload.floor, payload.dtype, custom_rooms=rooms_dict
            )
            x = x if x is not None else gx
            y = y if y is not None else gy
    else:
        room_label = resolve_room_from_coords(payload.floor, float(x), float(y), custom_rooms=rooms_dict)

    location_str = payload.location or f"Floor {payload.floor} – {room_label}"
    ip = payload.ip or "192.168.1.100"
    hostname = f"{payload.name.lower().replace(' ', '-')}.corp.local"

    try:
        row = await repository.insert_device(
            pool=pool,
            name=payload.name,
            hostname=hostname,
            ip=ip,
            snmp_port=payload.snmp_port,
            snmp_version=payload.snmp_version,
            credential_ref=payload.credential_ref,
            poll_interval_s=payload.poll_interval_s,
            location_str=location_str,
            enabled=payload.enabled,
            dtype=payload.dtype,
            floor=payload.floor,
            x=x,
            y=y,
            locked=payload.locked if payload.locked is not None else True,
            model=payload.model,
            latitude=payload.latitude,
            longitude=payload.longitude,
            altitude=payload.altitude,
            services=payload.services,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device with IP {ip} and port {payload.snmp_port} already exists",
        )

    await repository.record_poll_run(
        pool,
        row["id"],
        datetime.now(timezone.utc),
        "failed",
        "Awaiting connection verification"
    )

    return _serialize_device(row, status_override="offline")

@app.get("/api/v1/devices/{device_id}", response_model=DeviceDetailOut)
async def get_device_detail(device_id: int):
    pool = await get_db_pool()
    dev_row = await repository.fetch_device_detail_by_id(pool, device_id)
    if not dev_row:
        raise HTTPException(status_code=404, detail="Device not found")

    dev_out = _serialize_device(dev_row)
    if_rows = await repository.fetch_device_interfaces(pool, device_id)
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

    metric_rows = await repository.fetch_device_latest_metrics(pool, device_id)
    metrics = {r["metric_name"]: r["numeric_value"] for r in metric_rows if r["numeric_value"] is not None}

    primary_mac = next((r["mac_address"] for r in if_rows if r.get("mac_address")), None)
    cpu_val = metrics.get("cpu_usage_percent")
    mem_val = metrics.get("memory_usage_percent")
    temp_val = metrics.get("chassis_temperature_c")
    ping_val = metrics.get("ping_rtt_ms")
    uptime_str = await repository.fetch_latest_sys_uptime(pool, device_id)

    return DeviceDetailOut(
        device=dev_out,
        interfaces=interfaces,
        latest_metrics=metrics,
        uptime=uptime_str,
        mac_address=primary_mac,
        ping_ms=ping_val,
        cpu_percent=cpu_val,
        memory_percent=mem_val,
        temperature_c=temp_val,
    )

@app.patch("/api/v1/devices/{device_id}", response_model=DeviceOut, dependencies=[Depends(require_api_key)])
async def update_device(device_id: int, payload: DeviceUpdate):
    pool = await get_db_pool()
    current = await repository.fetch_device_by_id(pool, device_id)
    if not current:
        raise HTTPException(status_code=404, detail="Device not found")

    field_map: Dict[str, Any] = {
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
    rooms_dict = await _resolve_effective_rooms(pool, payload.floor_rooms)

    if payload.latitude is not None and payload.longitude is not None and payload.x is None and payload.y is None:
        gx, gy, room_name = project_gps_to_canvas(
            payload.latitude, payload.longitude, target_floor, custom_rooms=rooms_dict
        )
        field_map["x"] = gx
        field_map["y"] = gy
        if payload.location is None:
            field_map["location"] = f"Floor {target_floor} – {room_name}"
    elif payload.x is not None and payload.y is not None and payload.location is None:
        room_name = resolve_room_from_coords(target_floor, float(payload.x), float(payload.y), custom_rooms=rooms_dict)
        field_map["location"] = f"Floor {target_floor} – {room_name}"

    update_values: Dict[str, Any] = {k: v for k, v in field_map.items() if v is not None}
    if payload.ip:
        update_values["management_ip"] = payload.ip
    if payload.services is not None:
        update_values["services"] = payload.services

    try:
        updated_row = await repository.update_device(pool, device_id, update_values)
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Device with IP {payload.ip} already exists",
        )

    return _serialize_device(updated_row)

@app.delete("/api/v1/devices/{device_id}", status_code=status.HTTP_200_OK, dependencies=[Depends(require_api_key)])
async def delete_device(device_id: int):
    pool = await get_db_pool()
    result = await repository.delete_device(pool, device_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Device not found")
    return {"success": True, "deleted_id": device_id}

@app.post("/api/v1/devices/{device_id}/poll", dependencies=[Depends(require_api_key)])
async def trigger_poll(device_id: int):
    pool = await get_db_pool()
    dev = await repository.fetch_device_by_id(pool, device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    if dev["is_simulated"]:
        crit_alert = await repository.fetch_unacknowledged_critical_alert(pool, device_id)
        sim_status = "failed" if crit_alert else "succeeded"
        sim_err = f"Simulated fault: {crit_alert}" if crit_alert else None
        await repository.record_poll_run(
            pool, device_id, datetime.now(timezone.utc), sim_status, sim_err
        )
        return {
            "device_id": device_id,
            "success": sim_status == "succeeded",
            "uptime_raw": 0 if sim_status == "failed" else 4523000,
            "error": sim_err,
            "status": sim_status,
        }

    community = dev["credential_ref"] or settings.SNMP_COMMUNITY
    version = "2c" if dev["snmp_version"] == "v2c" else ("1" if dev["snmp_version"] == "v1" else "2c")

    success, val, err = await snmp_get_oid(
        ip=dev["ip"],
        oid=OID_SYS_UPTIME,
        community=community,
        version=version,
        port=dev["snmp_port"],
    )

    poll_status = "succeeded" if success else "failed"
    await repository.record_poll_run(
        pool, device_id, datetime.now(timezone.utc), poll_status, err
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
    dev = await repository.fetch_device_by_id(pool, device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    rows = await repository.fetch_device_interface_traffic(pool, device_id)

    if not rows and dev["ip"] and not dev["is_simulated"]:
        community = dev["credential_ref"] or settings.SNMP_COMMUNITY
        version = "2c" if dev["snmp_version"] == "v2c" else "1"
        ifaces = await collect_device_interfaces(dev["ip"], community, dev["snmp_port"], version)
        if ifaces:
            await sync_device_interfaces(pool, device_id, ifaces)
            rows = await repository.fetch_device_interface_traffic(pool, device_id)

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

@app.post("/api/v1/devices/{device_id}/poll-traffic", response_model=PollTrafficResult, dependencies=[Depends(require_api_key)])
async def poll_device_traffic(device_id: int):
    pool = await get_db_pool()
    dev = await repository.fetch_device_by_id(pool, device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    if dev["is_simulated"]:
        res = await get_latest_interface_traffic_snapshot(pool, device_id)
        return PollTrafficResult(
            success=res["success"],
            has_snmp=res["has_snmp"],
            interfaces_polled=res["interfaces_polled"],
            total_in_mbps=res["total_in_mbps"],
            total_out_mbps=res["total_out_mbps"],
            timestamp=res["timestamp"],
            interfaces=[InterfaceTrafficOut(**i) for i in res["interfaces"]],
        )

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
                mac_address=i.get("mac_address"),
                speed_bps=i["speed_bps"],
                oper_status=i["oper_status"],
                in_mbps=i["in_mbps"],
                out_mbps=i["out_mbps"],
            )
            for i in res.get("interfaces", [])
        ],
        uptime=res.get("uptime"),
        mac_address=res.get("mac_address"),
        ping_ms=res.get("ping_ms"),
        cpu_percent=res.get("cpu_percent"),
        memory_percent=res.get("memory_percent"),
        temperature_c=res.get("temperature_c"),
    )

@app.get("/api/v1/devices/{device_id}/traffic", response_model=TrafficSeriesOut)
async def get_device_traffic(device_id: int, interface_id: str = "all", range: str = "15m"):
    pool = await get_db_pool()
    dev = await repository.fetch_device_by_id(pool, device_id)
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

@app.post("/api/v1/devices/{device_id}/connect", response_model=ConnectResult, dependencies=[Depends(require_api_key)])
async def connect_device(device_id: int):
    pool = await get_db_pool()
    dev = await repository.fetch_device_by_id(pool, device_id)
    if not dev:
        raise HTTPException(status_code=404, detail="Device not found")

    community = dev["credential_ref"] or settings.SNMP_COMMUNITY
    version = "2c" if dev["snmp_version"] == "v2c" else ("1" if dev["snmp_version"] == "v1" else "2c")

    reach_ok, rtt_ms, _, reach_proto = await probe_device_reachability(
        dev["ip"], ping_timeout_ms=800, retry_timeout_ms=1000, tcp_timeout_s=0.35
    )
    snmp_ok, uptime_val, snmp_err = await snmp_get_oid(
        ip=dev["ip"],
        oid=OID_SYS_UPTIME,
        community=community,
        version=version,
        port=dev["snmp_port"],
        timeout_s=2,
    )

    if snmp_ok or reach_ok:
        if snmp_ok:
            _, descr, _ = await snmp_get_oid(
                ip=dev["ip"], oid=OID_SYS_DESCR, community=community, version=version, port=dev["snmp_port"]
            )
            if descr:
                await repository.update_device_model(pool, device_id, descr.split(',')[0].strip())

        await repository.record_poll_run(pool, device_id, datetime.now(timezone.utc), "succeeded", None)
        proto = "SNMP" if snmp_ok else ("TCP" if reach_proto == "tcp" else "Ping")
        try:
            await repository.create_alert(
                pool,
                device_id,
                "info",
                "",
                f"เชื่อมต่ออุปกรณ์สำเร็จ ({proto})",
                f"สถานะออนไลน์ ตอบสนองปกติ (RTT: {rtt_ms}ms, Uptime: {uptime_val or 'N/A'})",
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
        await repository.record_poll_run(pool, device_id, datetime.now(timezone.utc), "failed", err_msg)
        try:
            await repository.create_alert(
                pool,
                device_id,
                "crit",
                "",
                "อุปกรณ์ไม่ตอบสนองการเชื่อมต่อ",
                err_msg,
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

@app.post("/api/v1/discovery/scan", response_model=List[DiscoveredDevice], dependencies=[Depends(require_api_key)])
async def scan_network(payload: ScanRequest):
    pool = await get_db_pool()
    try:
        rooms_dict = await _resolve_effective_rooms(pool, payload.floor_rooms)

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

@app.post("/api/v1/discovery/import", response_model=List[DeviceOut], dependencies=[Depends(require_api_key)])
async def import_discovered_devices(payload: ImportRequest):
    pool = await get_db_pool()
    placed_list = await repository.fetch_placed_device_coords(pool)
    rooms_dict = await _resolve_effective_rooms(pool, payload.floor_rooms)

    imported = []
    for item in payload.devices:
        exists = await repository.check_device_exists_by_ip_or_name(pool, item.ip, item.name)
        if exists:
            logger.info(f"Skipping duplicate device during import: {item.name} ({item.ip})")
            continue

        if item.x is not None and item.y is not None:
            gx, gy = float(item.x), float(item.y)
            room_label = resolve_room_from_coords(item.floor, gx, gy, custom_rooms=rooms_dict)
        elif item.latitude is not None and item.longitude is not None:
            gx, gy, room_label = project_gps_to_canvas(
                item.latitude, item.longitude, item.floor, custom_rooms=rooms_dict
            )
        else:
            gx, gy, room_label = pick_smart_spot(
                placed_list, item.floor, item.dtype, custom_rooms=rooms_dict
            )
        placed_list.append({"floor": item.floor, "x": gx, "y": gy})

        hostname = f"{item.name.lower().replace(' ', '-')}.corp.local"
        chosen_room = item.target_room.strip() if item.target_room and item.target_room.strip() else room_label
        location_str = f"Floor {item.floor} – {chosen_room}" if chosen_room else f"Floor {item.floor}"
        device_community = item.community or settings.SNMP_COMMUNITY or "public"
        row = await repository.insert_device(
            pool=pool,
            name=item.name,
            hostname=hostname,
            ip=item.ip,
            snmp_port=161,
            snmp_version="v2c",
            credential_ref=device_community,
            poll_interval_s=60,
            location_str=location_str,
            enabled=True,
            dtype=item.dtype,
            floor=item.floor,
            x=gx,
            y=gy,
            locked=True,
            model=item.model or f"Discovered {item.dtype.title()}",
            latitude=item.latitude,
            longitude=item.longitude,
            altitude=item.altitude,
            services=[],
        )

        await repository.record_poll_run(pool, row["id"], datetime.now(timezone.utc), "succeeded", None)

        try:
            await repository.create_alert(
                pool,
                row["id"],
                "info",
                "",
                "นำเข้าอุปกรณ์เข้าสู่ระบบสำเร็จ",
                f"อุปกรณ์ {item.name} ({item.ip}) ได้รับการจัดวางและเชื่อมโยงกับระบบเครือข่ายเรียบร้อยแล้ว",
            )
        except Exception as alert_err:
            logger.warning(f"Failed to record import alert: {alert_err}")

        imported.append(_serialize_device(row, status_override="online"))
    return imported

@app.post("/api/v1/clear", dependencies=[Depends(require_api_key)])
async def clear_database():
    """
    Clears all devices, interfaces, metrics, and poll runs from DB completely (0 records).
    """
    pool = await get_db_pool()
    try:
        await repository.clear_database_records(pool)
        return {"success": True, "message": "All devices and related data have been cleared completely from database"}
    except Exception as e:
        logger.error(f"Clear failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/reset", dependencies=[Depends(require_api_key)])
async def reset_database():
    """
    Resets devices and related tables back to default seed state
    """
    pool = await get_db_pool()
    try:
        base_dir = Path(__file__).resolve().parents[2]
        with open(base_dir / "seed_mock_data.sql", "r", encoding="utf-8") as f:
            seed_sql = f.read()

        await repository.reset_database_to_seed(pool, seed_sql)
        return {"success": True, "message": "Database successfully reset to initial seed data"}
    except Exception as e:
        logger.error(f"Reset failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/v1/simulate/sample-statuses", dependencies=[Depends(require_api_key)])
async def simulate_sample_statuses():
    """
    Populates diverse sample statuses (Online, Warning, Offline) across all device types
    (Router, Switch, AP, Server) on Floor 1 and Floor 2 with corresponding alerts.
    """
    pool = await get_db_pool()
    try:
        from simulate_faults import apply_sample_statuses
        summary = await apply_sample_statuses(pool)
        return {
            "success": True,
            "message": "Sample device statuses and alerts applied successfully",
            "summary": summary
        }
    except Exception as e:
        logger.error(f"Simulate statuses failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Topology Links & Blast-Radius Simulation Endpoints ──────

def _serialize_link(row: asyncpg.Record) -> TopologyLinkOut:
    return TopologyLinkOut(
        id=str(row["id"]),
        source_device_id=str(row["source_device_id"]),
        target_device_id=str(row["target_device_id"]),
        source_port=row["source_port"],
        target_port=row["target_port"],
        link_type=row["link_type"],
        bandwidth_mbps=row["bandwidth_mbps"],
        is_redundant=row["is_redundant"],
        auto_inferred=row["auto_inferred"],
    )

async def _ensure_links_or_infer(pool: asyncpg.Pool) -> List[dict]:
    rows = await repository.fetch_topology_links(pool)
    if not rows:
        devs = [dict(r) for r in await repository.fetch_devices_with_telemetry(pool)]
        if len(devs) >= 2:
            ifaces = [dict(r) for r in await repository.fetch_all_interfaces(pool)]
            inferred = infer_topology_links(devs, ifaces)
            if inferred:
                rows = await repository.replace_auto_inferred_links(pool, inferred)
    return [
        {
            "id": str(r["id"]),
            "source_device_id": str(r["source_device_id"]),
            "target_device_id": str(r["target_device_id"]),
            "source_port": r["source_port"],
            "target_port": r["target_port"],
            "link_type": r["link_type"],
            "bandwidth_mbps": r["bandwidth_mbps"],
            "is_redundant": r["is_redundant"],
            "auto_inferred": r["auto_inferred"],
        }
        for r in rows
    ]

@app.get("/api/v1/topology/links", response_model=List[TopologyLinkOut])
async def list_topology_links():
    pool = await get_db_pool()
    links = await _ensure_links_or_infer(pool)
    return [TopologyLinkOut(**l) for l in links]

@app.post("/api/v1/topology/links", response_model=TopologyLinkOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def create_topology_link(payload: TopologyLinkCreate):
    pool = await get_db_pool()
    try:
        src_id = int(payload.source_device_id)
        dst_id = int(payload.target_device_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid device ID")

    if src_id == dst_id:
        raise HTTPException(status_code=400, detail="Source and target devices must be different")

    existing = await repository.find_existing_topology_link(
        pool=pool,
        source_device_id=src_id,
        target_device_id=dst_id,
        source_port=payload.source_port,
        target_port=payload.target_port,
    )
    if existing:
        raise HTTPException(status_code=400, detail="Topology link between these devices already exists")

    try:
        row = await repository.insert_topology_link(
            pool=pool,
            source_device_id=src_id,
            target_device_id=dst_id,
            source_port=payload.source_port,
            target_port=payload.target_port,
            link_type=payload.link_type,
            bandwidth_mbps=payload.bandwidth_mbps,
            is_redundant=payload.is_redundant,
            auto_inferred=False,
        )
        return _serialize_link(row)
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=400, detail="Topology link between these ports already exists")
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status_code=404, detail="One or both devices not found")

@app.delete("/api/v1/topology/links/{link_id}", dependencies=[Depends(require_api_key)])
async def remove_topology_link(link_id: int):
    pool = await get_db_pool()
    res = await repository.delete_topology_link(pool, link_id)
    if res == "DELETE 0":
        raise HTTPException(status_code=404, detail="Topology link not found")
    return {"success": True, "deleted_id": str(link_id)}

@app.post("/api/v1/topology/infer", response_model=List[TopologyLinkOut], dependencies=[Depends(require_api_key)])
async def infer_topology():
    pool = await get_db_pool()
    devs = [dict(r) for r in await repository.fetch_devices_with_telemetry(pool)]
    ifaces = [dict(r) for r in await repository.fetch_all_interfaces(pool)]
    inferred = infer_topology_links(devs, ifaces)
    rows = await repository.replace_auto_inferred_links(pool, inferred)
    return [_serialize_link(r) for r in rows]

def _dev_with_status(row: Any) -> dict:
    d = dict(row)
    if "status" not in d:
        d["status"] = compute_device_status(row) if "enabled" in d else "online"
    d["services"] = _parse_services(d.get("services"))
    return d


@app.post("/api/v1/simulate/impact", response_model=SimulationImpactResponse)
async def simulate_impact(payload: SimulationImpactRequest):
    pool = await get_db_pool()
    rows = await repository.fetch_devices_with_telemetry(pool)
    devs = [_dev_with_status(r) for r in rows]
    links = await _ensure_links_or_infer(pool)
    rooms_dict = await _resolve_effective_rooms(pool)
    report = compute_blast_radius(
        devices=devs,
        links=links,
        down_device_ids=payload.down_device_ids,
        down_link_ids=payload.down_link_ids,
        include_spof=payload.include_spof,
        floor_rooms=rooms_dict,
    )
    return SimulationImpactResponse(**report)

@app.post("/api/v1/simulate/apply-faults", dependencies=[Depends(require_api_key)])
async def apply_faults_to_live_db(payload: ApplyFaultsRequest):
    pool = await get_db_pool()
    rows = await repository.fetch_devices_with_telemetry(pool)
    devs = [_dev_with_status(r) for r in rows]
    links = await _ensure_links_or_infer(pool)
    rooms_dict = await _resolve_effective_rooms(pool)
    report = compute_blast_radius(
        devices=devs,
        links=links,
        down_device_ids=payload.down_device_ids,
        down_link_ids=payload.down_link_ids,
        include_spof=False,
        floor_rooms=rooms_dict,
    )
    root_down_ids = [
        int(item["device_id"])
        for item in report["device_impacts"]
        if item["impact_state"] == "root_down" and str(item["device_id"]).isdigit()
    ]
    unreachable_ids = [
        int(item["device_id"])
        for item in report["device_impacts"]
        if item["impact_state"] == "unreachable" and str(item["device_id"]).isdigit()
    ]
    degraded_ids = [
        int(item["device_id"])
        for item in report["device_impacts"]
        if item["impact_state"] == "degraded" and str(item["device_id"]).isdigit()
    ]
    applied = await repository.apply_simulated_faults(
        pool=pool,
        root_down_ids=root_down_ids,
        unreachable_ids=unreachable_ids,
        degraded_ids=degraded_ids,
        clear_existing_simulated=payload.clear_existing_simulated,
    )
    return {
        "success": True,
        "message": "Simulated outage and cascading impacts applied to database",
        "applied": applied,
    }

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
    dev_id_int: Optional[int] = None
    if device_id:
        try:
            dev_id_int = int(device_id)
        except ValueError:
            return []

    try:
        rows = await repository.fetch_alerts(
            pool=pool,
            device_id=dev_id_int,
            severity=severity,
            unack_only=unack_only,
            limit=limit,
        )
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

@app.post("/api/v1/devices/{device_id}/alerts", response_model=AlertOut, dependencies=[Depends(require_api_key)])
async def create_device_alert(device_id: str, payload: AlertCreate):
    pool = await get_db_pool()
    try:
        dev_id_int = int(device_id)
        row = await repository.create_alert(
            pool=pool,
            device_id=dev_id_int,
            severity=payload.severity,
            icon=payload.icon or "",
            title=payload.title,
            description=payload.description,
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

@app.post("/api/v1/alerts/{alert_id}/ack", dependencies=[Depends(require_api_key)])
async def acknowledge_alert(alert_id: int):
    pool = await get_db_pool()
    try:
        res = await repository.acknowledge_alert(pool, alert_id)
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
