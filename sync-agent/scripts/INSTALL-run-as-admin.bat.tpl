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

REM -- 2026-10-14 Oracle zip only: the bundled Oracle Client 11.2 (oracle-client\) needs the VC++ 2005 SP1 x64
REM    runtime (Microsoft.VC80.CRT 8.0.50727.762). Server 2016 does not ship it, so oci.dll would fail to load.
REM    The redistributable, when bundled, is ALWAYS run (/q is idempotent and also repairs an older/broken VC80 -
REM    checking WinSxS folder names cannot tell 8.0.50727.42 from the required .762). Exit code decides:
REM    0 = ok, 3010 = installed but Windows must restart (stop here, user reruns after reboot), other = stop + report.
set "VCR=0"
if exist "%~dp0oracle-client\vcredist_x64.exe" (
  echo [vc80] running bundled VC++ 2005 SP1 x64 runtime installer ^(vcredist_x64.exe /q^) >> "%LOG%"
  "%~dp0oracle-client\vcredist_x64.exe" /q >> "%LOG%" 2>&1
  set "VCR=!errorlevel!"
  echo VCREDIST_EXIT=!VCR! >> "%LOG%"
  echo.>> "%LOG%"
)
if "!VCR!"=="3010" goto :vcr_reboot
if not "!VCR!"=="0" goto :vcr_fail
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
set "SVC=1"
if "!EC!"=="0" (
  echo [OK] runtime works - registering scheduled task >> "%LOG%"
  sync-agent.exe --install-service >> "%LOG%" 2>&1
  set "SVC=!errorlevel!"
  echo INSTALL_SERVICE_EXIT=!SVC! >> "%LOG%"
  echo [verify] schtasks /Query /TN SyncAgent >> "%LOG%"
  schtasks /Query /TN SyncAgent >> "%LOG%" 2>&1
  echo.
  if "!SVC!"=="0" (
    echo  [DONE] exe runs + scheduled task registered.  ^(see diagnose.txt^)
  ) else (
    echo  [FAIL] scheduled task registration FAILED  EXIT=!SVC!
    echo  ^>^>^>  SEND this file:  diagnose.txt
  )
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

REM -- 2026-07-27 Server 2016 VM: installer finished with nothing on screen, so the user
REM    could not tell what to do next. Launch the setup wizard right here.
REM    Only when the scheduled task registered AND no config exists yet.
REM    Config presence is decided by --config-status exit code, NOT by looking at a file:
REM    .env / config.json setups are already running, and launching the wizard again
REM    would leave two agent instances fighting each other.
REM    This file stays ASCII only - Korean text in a .bat breaks depending on code page.
if "!EC!"=="0" if "!SVC!"=="0" (
  sync-agent.exe --config-status >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo  No configuration found - starting the setup wizard...
    echo.
    REM chcp inside the child console too: `start` opens a NEW console that does NOT
    REM inherit this script's code page, so Korean text was garbled there (2026-08-13 Ananti).
    REM The exe also sets it by itself now - this line is the belt to that suspender.
    start "Sync Agent Setup" cmd /c "chcp 65001 >nul & "%~dp0sync-agent.exe" --setup & pause"
    goto :done
  )
)
pause
goto :done

:vcr_reboot
echo.
echo  [REBOOT REQUIRED] VC++ 2005 runtime was installed but Windows must restart first.
echo  Restart this server, then run this file again. Nothing else was installed yet.
echo  ^(diagnose.txt: VCREDIST_EXIT=3010^)
echo.
pause
goto :done

:vcr_fail
echo.
echo  [FAIL] VC++ 2005 runtime install FAILED  EXIT=!VCR!  - the bundled Oracle client cannot load.
echo  Nothing else was installed. ^>^>^>  SEND this file:  diagnose.txt
echo.
pause
:done
