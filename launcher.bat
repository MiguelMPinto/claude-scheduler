@echo off
set "APP_DIR=%~dp0"
if "%APP_DIR:~-1%"=="\" set "APP_DIR=%APP_DIR:~0,-1%"
set "APP_URL=http://127.0.0.1:3000"

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%/api/config' -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto :open_browser

start "Claude Scheduler Server" /min cmd /c "cd /d ""%APP_DIR%"" && node app.js"

for /l %%I in (1,1,20) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri '%APP_URL%/api/config' -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>nul
  if not errorlevel 1 goto :open_browser
  timeout /t 1 /nobreak >nul
)

:open_browser
start "" "%APP_URL%"
