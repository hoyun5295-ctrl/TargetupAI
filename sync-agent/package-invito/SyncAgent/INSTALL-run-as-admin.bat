@echo off
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
  echo [OK] runtime works - installing service >> "%LOG%"
  sc stop SyncAgent >nul 2>&1
  sc delete SyncAgent >nul 2>&1
  sync-agent.exe --install-service >> "%LOG%" 2>&1
  sc start SyncAgent >> "%LOG%" 2>&1
  sc query SyncAgent >> "%LOG%" 2>&1
  echo.
  echo  [DONE] exe runs. service installed/started. ^(see diagnose.txt^)
  echo  If not configured yet:  sync-agent.exe --setup
) else (
  echo.
  echo  [exe did NOT start]  EXIT_CODE=!EC!
  echo  No error popup is NORMAL on 2008 R2 - the exit code tells why.
  echo  ^>^>^>  SEND me this file:  diagnose.txt
)
echo.
echo ---------- diagnose.txt ----------
type "%LOG%"
echo ----------------------------------
echo.
pause
