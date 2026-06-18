@echo off
chcp 65001 >nul

REM -- 관리자 권한 자동 승격 (UAC 재실행) : 권한 없이 실행해도 설치가 실패하지 않도록 --
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [INFO] 관리자 권한으로 다시 실행합니다... ^(UAC 창이 뜨면 "예"를 눌러주세요^)
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
echo  Sync Agent self-contained  (관리자 권한)
echo ============================================================
if "!EC!"=="0" (
  echo [OK] runtime works - 작업 스케줄러 등록 중 >> "%LOG%"
  sync-agent.exe --install-service >> "%LOG%" 2>&1
  echo [verify] schtasks /Query /TN SyncAgent >> "%LOG%"
  schtasks /Query /TN SyncAgent >> "%LOG%" 2>&1
  echo.
  echo  [DONE] exe 실행 + 작업 등록 완료. ^(자세한 내용은 diagnose.txt^)
  echo  설정이 아직 없으면:  sync-agent.exe --setup
) else (
  echo.
  echo  [exe가 실행되지 않음]  EXIT_CODE=!EC!
  echo  2008 R2에서 오류 팝업이 없는 것은 정상입니다 - 종료 코드가 원인을 알려줍니다.
  echo  ^>^>^>  이 파일을 보내주세요:  diagnose.txt
)
echo.
echo ---------- diagnose.txt ----------
type "%LOG%"
echo ----------------------------------
echo.
pause
