import asyncio
import asyncpg
from typing import Optional
from .config import settings

pool: Optional[asyncpg.Pool] = None
_pool_lock = asyncio.Lock()

async def init_db():
    global pool
    pool = await asyncpg.create_pool(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME,
        min_size=2,
        max_size=10,
    )
    # Ensure base schema and migrations are automatically applied on startup
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                name            TEXT NOT NULL,
                hostname        TEXT NOT NULL,
                management_ip   INET NOT NULL,
                snmp_port       INTEGER NOT NULL DEFAULT 161 CHECK (snmp_port BETWEEN 1 AND 65535),
                snmp_version    TEXT NOT NULL CHECK (snmp_version IN ('v1', 'v2c', 'v3')),
                credential_ref  TEXT,
                poll_interval_s INTEGER NOT NULL DEFAULT 60 CHECK (poll_interval_s > 0),
                location        TEXT,
                enabled         BOOLEAN NOT NULL DEFAULT TRUE,
                dtype           TEXT NOT NULL DEFAULT 'switch',
                floor           INTEGER NOT NULL DEFAULT 1,
                x               DOUBLE PRECISION,
                y               DOUBLE PRECISION,
                locked          BOOLEAN NOT NULL DEFAULT true,
                model           TEXT,
                latitude        DOUBLE PRECISION,
                longitude       DOUBLE PRECISION,
                altitude        DOUBLE PRECISION,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (management_ip, snmp_port)
            );

            CREATE TABLE IF NOT EXISTS interfaces (
                id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                device_id       BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                if_index        INTEGER NOT NULL CHECK (if_index >= 0),
                name            TEXT NOT NULL,
                description     TEXT,
                mac_address     TEXT,
                speed_bps       BIGINT CHECK (speed_bps >= 0),
                admin_status    TEXT,
                oper_status     TEXT,
                discovered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (device_id, if_index)
            );

            CREATE TABLE IF NOT EXISTS poll_runs (
                id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                device_id       BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                finished_at     TIMESTAMPTZ,
                status          TEXT NOT NULL DEFAULT 'running',
                error_message   TEXT
            );

            CREATE TABLE IF NOT EXISTS interface_samples (
                interface_id    BIGINT NOT NULL REFERENCES interfaces(id) ON DELETE CASCADE,
                sampled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                in_octets       NUMERIC(20, 0),
                out_octets      NUMERIC(20, 0),
                in_errors       BIGINT,
                out_errors      BIGINT,
                in_discards     BIGINT,
                out_discards    BIGINT,
                PRIMARY KEY (interface_id, sampled_at)
            );

            CREATE TABLE IF NOT EXISTS device_metric_samples (
                device_id       BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                sampled_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                oid             TEXT NOT NULL,
                metric_name     TEXT NOT NULL,
                numeric_value   DOUBLE PRECISION,
                text_value      TEXT,
                labels          JSONB NOT NULL DEFAULT '{}'::jsonb,
                PRIMARY KEY (device_id, sampled_at, oid, labels)
            );

            ALTER TABLE devices
            ADD COLUMN IF NOT EXISTS dtype TEXT NOT NULL DEFAULT 'switch',
            ADD COLUMN IF NOT EXISTS floor INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS x DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS y DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN IF NOT EXISTS model TEXT,
            ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS altitude DOUBLE PRECISION;

            CREATE TABLE IF NOT EXISTS alerts (
                id SERIAL PRIMARY KEY,
                device_id BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
                severity VARCHAR(10) NOT NULL CHECK (severity IN ('info', 'warn', 'crit')),
                icon VARCHAR(50) DEFAULT '',
                title VARCHAR(255) NOT NULL,
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
                acknowledged_by VARCHAR(100)
            );
            CREATE INDEX IF NOT EXISTS idx_alerts_device_id ON alerts(device_id);
            CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_poll_runs_device_started ON poll_runs(device_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_devices_floor ON devices(floor);
            CREATE INDEX IF NOT EXISTS idx_devices_enabled ON devices(enabled);

            ALTER TABLE poll_runs DROP CONSTRAINT IF EXISTS poll_runs_status_check;
            ALTER TABLE poll_runs ADD CONSTRAINT poll_runs_status_check CHECK (status = ANY (ARRAY['running'::text, 'succeeded'::text, 'warning'::text, 'failed'::text]));
        """)

async def close_db():
    global pool
    if pool:
        try:
            await pool.close()
        finally:
            pool = None

async def get_db_pool() -> asyncpg.Pool:
    global pool
    if pool is None or getattr(pool, '_closed', False):
        async with _pool_lock:
            if pool is None or getattr(pool, '_closed', False):
                await init_db()
    return pool

