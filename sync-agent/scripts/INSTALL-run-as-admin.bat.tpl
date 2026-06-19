@echo off
chcp 65001 >nul

REM -- auto-elevate to administrator (UAC relaunch) so install never fails on missing rights --
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [INFO] Relaunching as administrator... ^(click Yes on the UAC prompt^)
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

setlocal enabledelayedexpansion
cd /d "%~dp0"
set "LOG=%~dp0diagnose.txt"
echo === Sync Agent self-contained === > "%LOG%"
ver >> "%LOG%"
echo.>> "%LOG%"
echo [0] sync-agent.exe --version >> "%LOG%"
sync-agent.exe --version >> "%LOG%" 2>&1
set "EC=!errorlevel!"
echo EXIT_CODE=!EC! >> "%LOG%"
echo.>> "%LOG%"
echo [files] >> "%LOG%"
(for %%F in (sync-agent.exe sql-wasm.wasm ucrtbase.dll vcruntime140.dll vcruntime140_1.dll msvcp140.dll api-ms-win-crt-runtime-l1-1-0.dll) do if exist "%%F" (echo  OK %%F) else (echo  MISSING %%F)) >> "%LOG%"
echo.>> "%LOG%"
echo ============================================================
echo  Sync Agent self-contained  (RUN AS ADMINISTRATOR)
echo ============================================================
if "!EC!"=="0" (
  echo [OK] runtime works - registering scheduled task >> "%LOG%"
  sync-agent.exe --install-service >> "%LOG%" 2>&1
  echo [verify] schtasks /Query /TN SyncAgent >> "%LOG%"
  schtasks /Query /TN SyncAgent >> "%LOG%" 2>&1
  echo.
  echo  [DONE] exe runs + scheduled task registered.  ^(see diagnose.txt^)
  echo  If not configured yet:  sync-agent.exe --setup
) else (
  echo.
  echo  [exe did NOT start]  EXIT_CODE=!EC!
  echo  No error popup is NORMAL on 2008 R2 - the exit code tells why.
  echo  ^>^>^>  SEND this file:  diagnose.txt
)
echo.
echo ---------- diagnose.txt ----------
type "%LOG%"
echo ----------------------------------
echo.
pause
