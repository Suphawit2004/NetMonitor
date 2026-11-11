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
    """Retrieves all enabled devices configured with a management IP."""
    return await conn.fetch(
        """
        SELECT id, host(management_ip) as ip, credential_ref, snmp_port, snmp_version 
        FROM devices 
        WHERE enabled = true AND management_ip IS NOT NULL
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
