# NetMonitor Backend API

Asynchronous network monitoring, discovery, and topology impact service built with **FastAPI**, **asyncpg**, and **Net-SNMP CLI**.

## Getting Started

### Prerequisites
- Python 3.10+
- PostgreSQL 17 (via root `docker-compose.yml` or local instance)
- Net-SNMP CLI suite (`snmpget`, `snmpwalk`) available on `PATH` (or `C:\usr\bin` on Windows)
- `.env` configured from [`.env.example`](./.env.example) (`DB_*`, `SNMP_COMMUNITY`, `API_KEY`, `ALLOWED_ORIGINS`, `METRICS_RETENTION_DAYS`)

### Installation & Run
```bash
# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\activate       # Windows
source venv/bin/activate       # Linux/macOS

# Install dependencies
pip install -r requirements.txt

# Run FastAPI server (Port 8000, development reload)
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
For production deployment, run a single Uvicorn worker without `--reload` so the in-process background SNMP poller and `asyncpg` pool avoid multi-worker lock contention:
```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Interactive API Documentation (Swagger UI) is available at `http://127.0.0.1:8000/docs`.

---

## Architecture & Modules

- `app/main.py`: FastAPI lifecycle, route handlers, `require_api_key` (`X-API-Key` header enforcement when `API_KEY` is set), and `ALLOWED_ORIGINS` CORS middleware.
- `app/repository.py`: Data Access Layer (DAL) encapsulating SQL queries, transactions, `compute_device_status()`, floor layout persistence (`floor_layouts`), simulated fault state (`is_simulated`), and telemetry retention cleanup (`purge_expired_telemetry()`).
- `app/database.py`: Idempotent DDL startup protected by a PostgreSQL advisory lock (`init_db()`) and `asyncpg` pool (`min_size=2`, `max_size=10`).
- `app/snmp.py`: `snmpget` wrapper and `sanitize_snmp_community()` input guardrail against CLI option injection.
- `app/collector.py`: Concurrent Net-SNMP `snmpwalk`/`snmpget` collection, batched DB upserts/inserts (`UNNEST` / `executemany`), aggregate interface rate summation, and historical traffic shaping.
- `app/discovery.py`: Cross-platform (`Windows` and `POSIX/Linux`) ARP/neighbor lookup, gateway detection, ICMP ping, reverse DNS, and subnet CIDR scanning.
- `app/classifier.py`: Rule-based device classifier (`router`, `switch`, `ap`, `server`) evaluating gateway suffix, MAC OUI, `sysServices`, `ipForwarding` OID, and hostname/description patterns.
- `app/placement.py`: Smart room placement and bilinear affine coordinate mapping between 2D canvas and WGS84 GPS coordinates.
- `app/topology.py`: Network link inference (`infer_topology_links`) and graph-based blast-radius / SPOF propagation (`compute_blast_radius`) aware of custom floor room boxes.
- `app/models.py`: Pydantic DTOs with `ipaddress` IP/CIDR validation and SNMP community validation.
- `app/config.py`: Centralized environment settings (`SNMP_POLL_INTERVAL_S = 30`, `SNMP_MAX_CONCURRENT_POLLS = 5`, `TELEMETRY_DEFAULT_POINTS = 60`, `METRICS_RETENTION_DAYS = 7`, `ADVISORY_LOCK_SNMP_POLLER = 0x534E4D50`).

---

## Testing

```bash
# Run Pytest unit and integration tests (41 tests across classifier, collector, security, topology, and traffic APIs)
# Hardware tests in tests/test_real_port_traffic.py call pytest.skip() when 192.168.22.254 is unreachable.
.\venv\Scripts\python.exe -m pytest test_classifier.py tests/ -v

# Standalone script tests (require PostgreSQL running; mutate/clean test device records)
.\venv\Scripts\python.exe test_api.py
.\venv\Scripts\python.exe test_discovery.py
.\venv\Scripts\python.exe test_smart_placement.py

# Apply 6 fault simulation scenarios (updates PostgreSQL with is_simulated = true; use POST /api/v1/reset to restore seed state)
.\venv\Scripts\python.exe simulate_faults.py
```
