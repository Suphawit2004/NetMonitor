@echo off
title NetMonitor - Start All Services
cd /d "%~dp0"

echo =========================================================
echo       NetMonitor - Network Monitoring System
echo =========================================================
echo.

echo [1/3] Checking Docker PostgreSQL Database...
docker compose -f "%LOCALAPPDATA%\Docker\docker-compose.yml" up -d >nul 2>&1
if %errorlevel% neq 0 docker start docker-db-1 >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/3] Starting FastAPI Backend on http://127.0.0.1:8000...
start "NetMonitor Backend (:8000)" cmd /k "%~dp0backend\run_backend.bat"

timeout /t 3 /nobreak >nul

echo [3/3] Starting Frontend on http://localhost:5173...
cd /d "%~dp0netmonitor"
start "NetMonitor Frontend (:5173)" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul
echo.
echo =========================================================
echo    Both Backend (:8000) and Frontend (:5173) started!
echo    Opening http://localhost:5173 in your browser...
echo =========================================================
start http://localhost:5173
