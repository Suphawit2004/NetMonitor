@echo off
title NetMonitor - Docker & Backend Launcher
cd /d "%~dp0"
echo ========================================================
echo  NetMonitor - Starting Docker Database and Backend
echo ========================================================
echo.

echo [1/3] Starting PostgreSQL Container via Docker...
docker compose up -d
if %errorlevel% neq 0 (
    echo.
    echo [!] Docker engine is not running yet.
    echo [!] Please open 'Docker Desktop' application from your Start Menu or Desktop.
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] Waiting for PostgreSQL (5432) to be ready...
timeout /t 3 /nobreak >nul

echo.
echo [3/3] Starting FastAPI Backend on http://127.0.0.1:8000...
cd /d "%~dp0backend"
call .\venv\Scripts\activate.bat
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

