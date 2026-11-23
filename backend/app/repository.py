"""
Repository layer providing clean, decoupled data access operations.
Enforces Single Responsibility Principle and encapsulates raw SQL logic.
"""
from datetime import datetime, timezone
import json
from typing import Optional, List, Dict, Any
import asyncpg
import logging

logger = logging.getLogger("netmonitor.repository")


def compute_device_status(row: Any) -> str:
    """Derives 'online', 'warning', or 'offline' from enabled flag, unack alerts, and latest poll status."""
    getter = row.get if hasattr(row, "get") else lambda k, default=None: row[k] if k in row else default
    if not row["enabled"]:
        return "offline"
    alert_sev = getter("alert_severity")
    if alert_sev == "crit":
        return "offline"
    poll_status = getter("latest_poll_status")
    if not poll_status or poll_status == "failed":
        return "offline"
    if alert_sev == "warn" or poll_status == "warning":
        return "warning"
    if poll_status == "succeeded":
        return "online"
    return "offline"


async def check_db_health(pool: asyncpg.Pool) -> bool:
    """Verifies PostgreSQL connectivity."""
    val = await pool.fetchval("SELECT 1")
    return val == 1


async def purge_expired_telemetry(pool: asyncpg.Pool, retention_days: int = 7) -> Dict[str, int]:
    """Deletes time-series rows older than retention_days, keeping the latest poll_run per device."""
    days = max(1, int(retention_days))
    async with pool.acquire() as conn:
        iface_res = await conn.execute(
            "DELETE FROM interface_samples WHERE sampled_at < now() - ($1 * interval '1 day')",
            days,
        )
        metric_res = await conn.execute(
            "DELETE FROM device_metric_samples WHERE sampled_at < now() - ($1 * interval '1 day')",
            days,
        )
        poll_res = await conn.execute(
            """
            DELETE FROM poll_runs pr
            WHERE pr.started_at < now() - ($1 * interval '1 day')
              AND pr.id NOT IN (
                  SELECT DISTINCT ON (device_id) id
                  FROM poll_runs
                  ORDER BY device_id, started_at DESC
              )
            """,
            days,
        )
    def _deleted_count(status_str: str) -> int:
        parts = status_str.split()
        return int(parts[-1]) if parts and parts[-1].isdigit() else 0

    return {
        "interface_samples": _deleted_count(iface_res),
        "device_metric_samples": _deleted_count(metric_res),
        "poll_runs": _deleted_count(poll_res),
    }

async def record_poll_run(
    pool: asyncpg.Pool,
    device_id: int,
    started_at: datetime,
    status: str,
    error_message: Optional[str] = None
) -> None:
    """Records the outcome of an SNMP poll attempt into poll_runs table."""
    try:
        await pool.execute(
            """
            INSERT INTO poll_runs (device_id, started_at, finished_at, status, error_message)
            VALUES ($1, $2, now(), $3, $4)
            """,
            device_id, started_at, status, error_message
        )
    except Exception as e:
        logger.error(f"Failed to record poll_run for device {device_id}: {e}")

async def fetch_pollable_devices(conn: asyncpg.Connection) -> List[asyncpg.Record]:
    """Retrieves all enabled live devices with management IP and latest poll status, excluding simulated ones."""
    return await conn.fetch(
        """
        SELECT d.id, host(d.management_ip) as ip, d.credential_ref, d.snmp_port, d.snmp_version,
               p.status as latest_poll_status
        FROM devices d
        LEFT JOIN LATERAL (
            SELECT status FROM poll_runs pr
            WHERE pr.device_id = d.id
            ORDER BY started_at DESC
            LIMIT 1
        ) p ON TRUE
        WHERE d.enabled = true
          AND d.management_ip IS NOT NULL
          AND d.is_simulated = FALSE
        """
    )

async def clear_database_records(pool: asyncpg.Pool) -> None:
    """Truncates all runtime tables and restarts identity sequences."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                TRUNCATE TABLE alerts, poll_runs, interface_samples, device_metric_samples, interfaces, devices 
                RESTART IDENTITY CASCADE;
                """
            )

async def reset_database_to_seed(pool: asyncpg.Pool, seed_sql: str) -> None:
    """Truncates tables and applies initial seed SQL script."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                TRUNCATE TABLE alerts, poll_runs, interface_samples, device_metric_samples, interfaces, devices 
                RESTART IDENTITY CASCADE;
                """
            )
            await conn.execute(seed_sql)

async def update_device_location(
    pool: asyncpg.Pool,
    device_id: int,
    floor: int,
    x: float,
    y: float,
    locked: bool = True
) -> Optional[asyncpg.Record]:
    """Updates coordinate placement and lock status for a device."""
    return await pool.fetchrow(
        """
        UPDATE devices
        SET floor = $1, x = $2, y = $3, locked = $4, updated_at = now()
        WHERE id = $5
        RETURNING id, name, floor, x, y, locked
        """,
        floor, x, y, locked, device_id
    )

async def fetch_devices_with_telemetry(pool: asyncpg.Pool) -> List[asyncpg.Record]:
    """Retrieves all devices along with their latest poll run and highest active alert severity."""
    query = """
        SELECT 
            d.id, d.name, d.hostname, host(d.management_ip) AS ip, 
            d.snmp_port, d.snmp_version, d.credential_ref, d.poll_interval_s, 
            d.location, d.enabled, d.is_simulated, d.dtype, d.floor, d.x, d.y, 
            d.locked, d.model, d.latitude, d.longitude, d.altitude, d.services,
            p.status AS latest_poll_status,
            a.highest_severity AS alert_severity
        FROM devices d
        LEFT JOIN LATERAL (
            SELECT status 
            FROM poll_runs 
            WHERE device_id = d.id 
            ORDER BY started_at DESC 
            LIMIT 1
        ) p ON TRUE
        LEFT JOIN LATERAL (
            SELECT severity AS highest_severity
            FROM alerts
            WHERE device_id = d.id AND acknowledged = false
            ORDER BY CASE severity WHEN 'crit' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END ASC
            LIMIT 1
        ) a ON TRUE
        ORDER BY d.id ASC;
    """
    return await pool.fetch(query)

async def update_device_placement(
    pool: asyncpg.Pool,
    device_id: int,
    x: float,
    y: float,
    location_str: str
) -> None:
    """Updates auto-placed coordinates and resolved room location string."""
    await pool.execute(
        "UPDATE devices SET x = $1, y = $2, location = $3 WHERE id = $4",
        x, y, location_str, device_id
    )

async def check_device_name_exists(pool: asyncpg.Pool, name: str) -> Optional[int]:
    """Checks whether a device name exists case-insensitively."""
    return await pool.fetchval("SELECT id FROM devices WHERE LOWER(name) = LOWER($1)", name)

async def fetch_placed_device_coords(pool: asyncpg.Pool) -> List[dict]:
    """Fetches coordinates of all already-placed devices for smart spot picking."""
    rows = await pool.fetch("SELECT floor, x, y FROM devices WHERE x IS NOT NULL AND y IS NOT NULL")
    return [dict(r) for r in rows]

async def insert_device(
    pool: asyncpg.Pool,
    name: str,
    hostname: str,
    ip: str,
    snmp_port: int,
    snmp_version: str,
    credential_ref: Optional[str],
    poll_interval_s: int,
    location_str: str,
    enabled: bool,
    dtype: str,
    floor: int,
    x: float,
    y: float,
    locked: bool,
    model: Optional[str],
    latitude: Optional[float],
    longitude: Optional[float],
    altitude: Optional[float],
    services: Optional[List[str]] = None,
) -> asyncpg.Record:
    """Inserts a new device and returns its newly created row."""
    services_json = json.dumps(services or [])
    insert_query = """
        INSERT INTO devices (
            name, hostname, management_ip, snmp_port, snmp_version, 
            credential_ref, poll_interval_s, location, enabled,
            dtype, floor, x, y, locked, model, latitude, longitude, altitude, services
        )
        VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)
        RETURNING id, name, dtype, floor, x, y, locked, host(management_ip) AS ip, model, latitude, longitude, altitude, services, is_simulated;
    """
    return await pool.fetchrow(
        insert_query,
        name, hostname, ip, snmp_port, snmp_version,
        credential_ref, poll_interval_s, location_str, enabled,
        dtype, floor, x, y, locked, model, latitude, longitude, altitude, services_json
    )

async def fetch_device_detail_by_id(pool: asyncpg.Pool, device_id: int) -> Optional[asyncpg.Record]:
    """Retrieves device detail with latest poll status and alert severity by ID."""
    return await pool.fetchrow(
        """
        SELECT 
            d.id, d.name, d.hostname, host(d.management_ip) AS ip, 
            d.snmp_port, d.snmp_version, d.credential_ref, d.poll_interval_s, 
            d.location, d.enabled, d.is_simulated, d.dtype, d.floor, d.x, d.y, 
            d.locked, d.model, d.latitude, d.longitude, d.altitude, d.services,
            p.status AS latest_poll_status,
            a.highest_severity AS alert_severity
        FROM devices d
        LEFT JOIN LATERAL (
            SELECT status FROM poll_runs 
            WHERE device_id = d.id 
            ORDER BY started_at DESC LIMIT 1
        ) p ON TRUE
        LEFT JOIN LATERAL (
            SELECT severity AS highest_severity
            FROM alerts
            WHERE device_id = d.id AND acknowledged = false
            ORDER BY CASE severity WHEN 'crit' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END ASC
            LIMIT 1
        ) a ON TRUE
        WHERE d.id = $1
        """,
        device_id,
    )


async def fetch_device_by_id(pool: asyncpg.Pool, device_id: int) -> Optional[asyncpg.Record]:
    """Retrieves basic device row including host(management_ip) and simulation status."""
    return await pool.fetchrow(
        """
        SELECT id, name, hostname, host(management_ip) AS ip, snmp_port, snmp_version,
               credential_ref, poll_interval_s, location, enabled, is_simulated,
               dtype, floor, x, y, locked, model, latitude, longitude, altitude, services
        FROM devices
        WHERE id = $1
        """,
        device_id,
    )


_ALLOWED_DEVICE_UPDATE_COLUMNS = frozenset({
    "name",
    "dtype",
    "floor",
    "x",
    "y",
    "locked",
    "model",
    "location",
    "enabled",
    "latitude",
    "longitude",
    "altitude",
    "management_ip",
    "services",
})


async def update_device(pool: asyncpg.Pool, device_id: int, field_values: Dict[str, Any]) -> Optional[asyncpg.Record]:
    """Applies partial field updates to devices and returns refreshed row with telemetry."""
    if field_values:
        invalid_cols = [col for col in field_values if col not in _ALLOWED_DEVICE_UPDATE_COLUMNS]
        if invalid_cols:
            raise ValueError(f"Unsupported device update column(s): {', '.join(invalid_cols)}")
        updates = []
        params: List[Any] = []
        idx = 1
        for col, val in field_values.items():
            if col == "management_ip":
                updates.append(f"management_ip = ${idx}::inet")
                params.append(val)
            elif col == "services":
                updates.append(f"services = ${idx}::jsonb")
                params.append(json.dumps(val))
            else:
                updates.append(f"{col} = ${idx}")
                params.append(val)
            idx += 1
        updates.append("updated_at = now()")
        params.append(device_id)
        sql = f"UPDATE devices SET {', '.join(updates)} WHERE id = ${idx} RETURNING id;"
        await pool.execute(sql, *params)

    return await fetch_device_detail_by_id(pool, device_id)


async def update_device_model(pool: asyncpg.Pool, device_id: int, model: str) -> None:
    """Updates device hardware/firmware model label."""
    await pool.execute("UPDATE devices SET model = $1, updated_at = now() WHERE id = $2", model, device_id)


async def fetch_device_interface_traffic(pool: asyncpg.Pool, device_id: int) -> List[asyncpg.Record]:
    """Retrieves cached interfaces for a device with zeroed default rate placeholders."""
    return await pool.fetch(
        """
        SELECT id, if_index, name, description, mac_address, speed_bps, oper_status,
               0.0 AS in_mbps, 0.0 AS out_mbps
        FROM interfaces
        WHERE device_id = $1
        ORDER BY if_index ASC
        """,
        device_id,
    )


async def fetch_unacknowledged_critical_alert(pool: asyncpg.Pool, device_id: int) -> Optional[str]:
    """Returns the title of an active unacknowledged critical alert for a device if present."""
    return await pool.fetchval(
        "SELECT title FROM alerts WHERE device_id = $1 AND severity = 'crit' AND acknowledged = false LIMIT 1",
        device_id,
    )


async def fetch_latest_sys_uptime(pool: asyncpg.Pool, device_id: int) -> Optional[str]:
    """Returns the most recent stored sys_uptime string for a device without network I/O."""
    return await pool.fetchval(
        """
        SELECT text_value
        FROM device_metric_samples
        WHERE device_id = $1 AND metric_name = 'sys_uptime' AND text_value IS NOT NULL
        ORDER BY sampled_at DESC
        LIMIT 1
        """,
        device_id,
    )


async def check_device_exists_by_ip_or_name(pool: asyncpg.Pool, ip: str, name: str) -> Optional[int]:
    """Checks whether any existing device matches IP or case-insensitive name."""
    return await pool.fetchval(
        "SELECT id FROM devices WHERE host(management_ip) = $1 OR LOWER(name) = LOWER($2)",
        ip, name,
    )


async def create_alert(
    pool: asyncpg.Pool,
    device_id: int,
    severity: str,
    icon: str,
    title: str,
    description: Optional[str],
) -> asyncpg.Record:
    """Inserts a new alert record and returns serialized columns."""
    return await pool.fetchrow(
        """
        INSERT INTO alerts (device_id, severity, icon, title, description)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, device_id, severity, icon, title, description,
                  to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at,
                  acknowledged, acknowledged_by
        """,
        device_id, severity, icon, title, description,
    )


async def fetch_floor_layouts(pool: asyncpg.Pool) -> Dict[int, List[Dict[str, Any]]]:
    """Fetches persisted room layouts per floor."""
    rows = await pool.fetch("SELECT floor, rooms FROM floor_layouts ORDER BY floor ASC")
    layouts: Dict[int, List[Dict[str, Any]]] = {}
    for r in rows:
        raw = r["rooms"]
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = []
        if isinstance(raw, list):
            layouts[int(r["floor"])] = raw
    return layouts


async def upsert_floor_layout(pool: asyncpg.Pool, floor: int, rooms: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Persists canonical room rectangles for a floor."""
    rooms_json = json.dumps(rooms)
    await pool.execute(
        """
        INSERT INTO floor_layouts (floor, rooms, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (floor) DO UPDATE
        SET rooms = EXCLUDED.rooms,
            updated_at = now()
        """,
        floor, rooms_json,
    )
    return rooms

async def fetch_device_interfaces(pool: asyncpg.Pool, device_id: int) -> List[asyncpg.Record]:
    """Retrieves all interfaces belonging to a device."""
    return await pool.fetch(
        "SELECT id, device_id, if_index, name, description, mac_address, speed_bps, admin_status, oper_status FROM interfaces WHERE device_id = $1 ORDER BY if_index ASC",
        device_id,
    )

async def fetch_device_latest_metrics(pool: asyncpg.Pool, device_id: int) -> List[asyncpg.Record]:
    """Retrieves the latest metric values recorded for a device."""
    return await pool.fetch(
        """
        SELECT DISTINCT ON (metric_name) metric_name, numeric_value, sampled_at
        FROM device_metric_samples
        WHERE device_id = $1
        ORDER BY metric_name, sampled_at DESC
        """,
        device_id,
    )

async def delete_device(pool: asyncpg.Pool, device_id: int) -> str:
    """Deletes a device and cascading relations by ID."""
    return await pool.execute("DELETE FROM devices WHERE id = $1", device_id)

async def fetch_alerts(
    pool: asyncpg.Pool,
    device_id: Optional[int] = None,
    severity: Optional[str] = None,
    unack_only: bool = False,
    limit: int = 50
) -> List[asyncpg.Record]:
    """Queries alerts from database with optional filters."""
    query = """
        SELECT id, device_id, severity, icon, title, description,
               to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at,
               acknowledged, acknowledged_by
        FROM alerts
        WHERE 1=1
    """
    params = []
    if device_id:
        params.append(device_id)
        query += f" AND device_id = ${len(params)}"
    if severity:
        params.append(severity)
        query += f" AND severity = ${len(params)}"
    if unack_only:
        query += " AND acknowledged = false"

    query += " ORDER BY created_at DESC"
    params.append(limit)
    query += f" LIMIT ${len(params)}"

    return await pool.fetch(query, *params)

async def acknowledge_alert(pool: asyncpg.Pool, alert_id: int, acknowledged_by: str = "admin") -> str:
    """Marks an alert as acknowledged and records the acknowledger."""
    return await pool.execute(
        "UPDATE alerts SET acknowledged = true, acknowledged_by = $1 WHERE id = $2",
        acknowledged_by, alert_id
    )


async def fetch_topology_links(pool: asyncpg.Pool) -> List[asyncpg.Record]:
    """Retrieves all topology links ordered by ID."""
    return await pool.fetch(
        """
        SELECT id, source_device_id, target_device_id, source_port, target_port,
               link_type, bandwidth_mbps, is_redundant, auto_inferred
        FROM topology_links
        ORDER BY id ASC
        """
    )


async def fetch_all_interfaces(pool: asyncpg.Pool) -> List[asyncpg.Record]:
    """Retrieves all interfaces across devices for topology inference."""
    return await pool.fetch(
        """
        SELECT id, device_id, if_index, name, description, speed_bps, admin_status, oper_status
        FROM interfaces
        ORDER BY device_id ASC, if_index ASC
        """
    )


async def find_existing_topology_link(
    pool: asyncpg.Pool,
    source_device_id: int,
    target_device_id: int,
    source_port: Optional[str],
    target_port: Optional[str],
) -> Optional[asyncpg.Record]:
    """Finds an existing undirected topology link between two devices on the same ports (treating NULL ports as equal)."""
    sp = (source_port or "").strip()
    tp = (target_port or "").strip()
    return await pool.fetchrow(
        """
        SELECT id FROM topology_links
        WHERE (
            (source_device_id = $1 AND target_device_id = $2
             AND COALESCE(source_port, '') = $3 AND COALESCE(target_port, '') = $4)
            OR
            (source_device_id = $2 AND target_device_id = $1
             AND COALESCE(source_port, '') = $4 AND COALESCE(target_port, '') = $3)
        )
        LIMIT 1
        """,
        source_device_id,
        target_device_id,
        sp,
        tp,
    )


async def insert_topology_link(
    pool: asyncpg.Pool,
    source_device_id: int,
    target_device_id: int,
    source_port: Optional[str],
    target_port: Optional[str],
    link_type: str,
    bandwidth_mbps: int,
    is_redundant: bool,
    auto_inferred: bool = False,
) -> asyncpg.Record:
    """Inserts a topology link between two devices."""
    return await pool.fetchrow(
        """
        INSERT INTO topology_links (
            source_device_id, target_device_id, source_port, target_port,
            link_type, bandwidth_mbps, is_redundant, auto_inferred
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, source_device_id, target_device_id, source_port, target_port,
                  link_type, bandwidth_mbps, is_redundant, auto_inferred
        """,
        source_device_id,
        target_device_id,
        source_port,
        target_port,
        link_type,
        bandwidth_mbps,
        is_redundant,
        auto_inferred,
    )


async def delete_topology_link(pool: asyncpg.Pool, link_id: int) -> str:
    """Deletes a topology link by ID."""
    return await pool.execute("DELETE FROM topology_links WHERE id = $1", link_id)


async def replace_auto_inferred_links(
    pool: asyncpg.Pool,
    inferred_links: List[Dict[str, Any]],
) -> List[asyncpg.Record]:
    """Replaces previously auto-inferred links while preserving user-created manual links."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM topology_links WHERE auto_inferred = true")
            existing = await conn.fetch(
                "SELECT source_device_id, target_device_id FROM topology_links"
            )
            manual_pairs = {
                (min(r["source_device_id"], r["target_device_id"]), max(r["source_device_id"], r["target_device_id"]))
                for r in existing
            }
            for item in inferred_links:
                sid = int(item["source_device_id"])
                tid = int(item["target_device_id"])
                pair = (min(sid, tid), max(sid, tid))
                if pair in manual_pairs:
                    continue
                await conn.execute(
                    """
                    INSERT INTO topology_links (
                        source_device_id, target_device_id, source_port, target_port,
                        link_type, bandwidth_mbps, is_redundant, auto_inferred
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, true)
                    ON CONFLICT (source_device_id, target_device_id, source_port) DO NOTHING
                    """,
                    sid,
                    tid,
                    item.get("source_port"),
                    item.get("target_port"),
                    item.get("link_type", "uplink"),
                    int(item.get("bandwidth_mbps", 1000)),
                    bool(item.get("is_redundant", False)),
                )
    return await fetch_topology_links(pool)


async def apply_simulated_faults(
    pool: asyncpg.Pool,
    root_down_ids: List[int],
    unreachable_ids: List[int],
    degraded_ids: List[int],
    clear_existing_simulated: bool = True,
) -> Dict[str, int]:
    """
    Persists simulated outage & cascading impact into poll_runs and alerts.
    Marks impacted devices via is_simulated = true so background SNMP poller does not overwrite,
    without modifying devices.credential_ref.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            if clear_existing_simulated:
                await conn.execute(
                    """
                    DELETE FROM alerts
                    WHERE device_id IN (SELECT id FROM devices WHERE is_simulated = true)
                      AND severity IN ('warn', 'crit')
                    """
                )
                await conn.execute(
                    "UPDATE devices SET is_simulated = false WHERE is_simulated = true"
                )

            specs = [
                (
                    root_down_ids,
                    "Simulated Device Outage (Root Cause)",
                    "Device simulated as DOWN in Topology Blast-Radius Simulator.",
                    "crit",
                    "failed",
                    "Simulated fault injection: device down",
                ),
                (
                    unreachable_ids,
                    "Cascading Outage: Unreachable from Gateway",
                    "Upstream device or link down caused connectivity interruption.",
                    "warn",
                    "warning",
                    "Cascading unreachable from simulated upstream outage",
                ),
                (
                    degraded_ids,
                    "Redundancy Lost (Degraded Path)",
                    "Primary path disrupted; operating on backup uplink with reduced redundancy.",
                    "warn",
                    "warning",
                    "Simulated failover to redundant path",
                ),
            ]
            for ids, title, desc, sev, poll_status, poll_err in specs:
                if not ids:
                    continue
                await conn.execute(
                    "UPDATE devices SET is_simulated = true, enabled = true WHERE id = ANY($1::bigint[])",
                    ids,
                )
                await conn.execute(
                    "DELETE FROM alerts WHERE device_id = ANY($1::bigint[]) AND severity IN ('warn', 'crit')",
                    ids,
                )
                await conn.executemany(
                    """
                    INSERT INTO alerts (device_id, severity, icon, title, description, created_at, acknowledged)
                    VALUES ($1, $2, '', $3, $4, now(), false)
                    """,
                    [(dev_id, sev, title, desc) for dev_id in ids],
                )
                await conn.executemany(
                    """
                    INSERT INTO poll_runs (device_id, status, error_message, started_at, finished_at)
                    VALUES ($1, $2, $3, now(), now())
                    """,
                    [(dev_id, poll_status, poll_err) for dev_id in ids],
                )

    return {
        "root_down": len(root_down_ids),
        "unreachable": len(unreachable_ids),
        "degraded": len(degraded_ids),
    }
