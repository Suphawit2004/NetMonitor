"""
Repository layer providing clean, decoupled data access operations.
Enforces Single Responsibility Principle and encapsulates raw SQL logic.
"""
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import asyncpg
import logging

logger = logging.getLogger("netmonitor.repository")

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
    """Retrieves all enabled devices configured with a management IP, excluding simulated ones."""
    return await conn.fetch(
        """
        SELECT id, host(management_ip) as ip, credential_ref, snmp_port, snmp_version 
        FROM devices 
        WHERE enabled = true 
          AND management_ip IS NOT NULL
          AND (credential_ref IS NULL OR credential_ref NOT IN ('simulated', 'mock', 'demo'))
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
            d.snmp_port, d.snmp_version, d.poll_interval_s, 
            d.location, d.enabled, d.dtype, d.floor, d.x, d.y, 
            d.locked, d.model, d.latitude, d.longitude, d.altitude,
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
    altitude: Optional[float]
) -> asyncpg.Record:
    """Inserts a new device and returns its newly created row."""
    insert_query = """
        INSERT INTO devices (
            name, hostname, management_ip, snmp_port, snmp_version, 
            credential_ref, poll_interval_s, location, enabled,
            dtype, floor, x, y, locked, model, latitude, longitude, altitude
        )
        VALUES ($1, $2, $3::inet, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING id, name, dtype, floor, x, y, locked, host(management_ip) AS ip, model, latitude, longitude, altitude;
    """
    return await pool.fetchrow(
        insert_query,
        name, hostname, ip, snmp_port, snmp_version,
        credential_ref, poll_interval_s, location_str, enabled,
        dtype, floor, x, y, locked, model, latitude, longitude, altitude
    )

async def fetch_device_detail_by_id(pool: asyncpg.Pool, device_id: int) -> Optional[asyncpg.Record]:
    """Retrieves device detail with latest poll status and alert severity by ID."""
    return await pool.fetchrow(
        """
        SELECT 
            d.id, d.name, d.hostname, host(d.management_ip) AS ip, 
            d.snmp_port, d.snmp_version, d.poll_interval_s, 
            d.location, d.enabled, d.dtype, d.floor, d.x, d.y, 
            d.locked, d.model, d.latitude, d.longitude, d.altitude,
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
