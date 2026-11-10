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
    # Ensure migrations are automatically applied on startup
    async with pool.acquire() as conn:
        await conn.execute("""
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
        await pool.close()

async def get_db_pool() -> asyncpg.Pool:
    global pool
    if pool is None or getattr(pool, '_closed', False):
        async with _pool_lock:
            if pool is None or getattr(pool, '_closed', False):
                await init_db()
    return pool

