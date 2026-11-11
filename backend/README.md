# NetMonitor Backend API

High-performance asynchronous network monitoring and discovery service powered by **FastAPI**, **asyncpg**, and **Net-SNMP**.

## 🚀 Getting Started

### Prerequisites
- Python 3.10+
- PostgreSQL 17 (Docker or local instance)
- Net-SNMP CLI Suite (for real hardware SNMP polling)

### Installation & Run
```bash
# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\activate       # Windows
source venv/bin/activate       # Linux/macOS

# Install dependencies
pip install -r requirements.txt

# Run FastAPI server (Port 8000)
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Interactive API Documentation (Swagger UI) is available at `http://127.0.0.1:8000/docs`.

---

## 🏗️ Architecture & Modules

Following Clean Architecture and Decoupled Repository Pattern:
* `app/main.py`: Thin API Controllers, route definitions, request validation, and lifespan management.
* `app/repository.py`: Data Access Layer (DAL) encapsulating raw SQL queries, database transactions, and alert-aware device status logic.
* `app/database.py`: Asynchronous PostgreSQL connection pool (`asyncpg`) and automatic table migration.
* `app/collector.py`: Background SNMP poller with PostgreSQL advisory lock, interface sync, and bandwidth calculation.
* `app/discovery.py`: Network discovery engine using dynamic ARP cache, reverse DNS, and ICMP Ping-first.
* `app/classifier.py`: Smart device classifier (Router, Switch, AP, Server) evaluating sysServices, RFC 1213 IP Forwarding OID, MAC OUI, and hostname keywords.
* `app/placement.py`: Smart room placement and bilinear affine coordinate transformation.
* `app/config.py`: Centralized configuration, environment variables, and telemetry constants.

---

## 🧪 Testing

```bash
# Run all unit and integration tests (24 passed, 2 skipped)
pytest -v

# Run fault simulation script (interfaces, metrics, 15m traffic samples)
python simulate_faults.py
```
