@echo off
chcp 65001 >nul
setlocal

echo ============================================
echo  Sync Agent Installer 빌드
echo ============================================
echo.

:: --- 설정 ---
set VERSION=1.0.0
set NSIS_DIR=C:\Program Files (x86)\NSIS
set PROJECT_DIR=%~dp0..
set INSTALLER_DIR=%~dp0
set RELEASE_DIR=%PROJECT_DIR%\release

:: --- 버전 파라미터 ---
if not "%1"=="" set VERSION=%1

echo [1/4] 빌드 환경 확인...

:: NSIS 설치 확인
if not exist "%NSIS_DIR%\makensis.exe" (
    echo [오류] NSIS가 설치되어 있지 않습니다.
    echo        https://nsis.sourceforge.io/Download 에서 설치하세요.
    echo        설치 시 "NSIS Menu", "Plugins" 모두 포함 선택
    exit /b 1
)

:: 빌드 산출물 확인
if not exist "%RELEASE_DIR%\sync-agent.exe" (
    echo [오류] release\sync-agent.exe 가 없습니다.
    echo        먼저 npm run build:exe 를 실행하세요.
    exit /b 1
)
if not exist "%RELEASE_DIR%\sql-wasm.wasm" (
    echo [오류] release\sql-wasm.wasm 이 없습니다.
    exit /b 1
)

:: 아이콘 확인 (없으면 기본 아이콘 사용 안내)
if not exist "%INSTALLER_DIR%\icon.ico" (
    echo [경고] installer\icon.ico 가 없습니다. 기본 아이콘으로 빌드합니다.
    echo        커스텀 아이콘을 사용하려면 installer\icon.ico 파일을 준비하세요.
    echo.
)

echo        NSIS: %NSIS_DIR%
echo        버전: %VERSION%
echo.

:: --- Agent exe 빌드 (선택) ---
echo [2/4] Agent exe 빌드 확인...
echo        release\sync-agent.exe 존재 확인 완료
echo.

:: --- release 폴더를 installer에서 참조할 수 있도록 복사 ---
echo [3/4] 파일 준비...
if not exist "%INSTALLER_DIR%\release" mkdir "%INSTALLER_DIR%\release"
copy /Y "%RELEASE_DIR%\sync-agent.exe" "%INSTALLER_DIR%\release\" >nul
copy /Y "%RELEASE_DIR%\sql-wasm.wasm" "%INSTALLER_DIR%\release\" >nul
echo        release 파일 복사 완료
echo.

:: --- NSIS 컴파일 ---
echo [4/4] NSIS 컴파일 중... (시간이 걸릴 수 있습니다)
echo.

set ICON_FLAG=
if exist "%INSTALLER_DIR%\icon.ico" (
    set ICON_FLAG=/DHAS_ICON
    echo        아이콘: icon.ico 사용
) else (
    echo        아이콘: 기본 (icon.ico 없음)
)

"%NSIS_DIR%\makensis.exe" /V3 /INPUTCHARSET UTF8 /DPRODUCT_VERSION=%VERSION% %ICON_FLAG% "%INSTALLER_DIR%\sync-agent-installer.nsi"

if %ERRORLEVEL% neq 0 (
    echo.
    echo [오류] NSIS 컴파일 실패
    exit /b 1
)

echo.
echo ============================================
echo  빌드 완료!
echo  출력: installer\SyncAgent-Setup-%VERSION%.exe
echo ============================================

:: --- 정리 ---
rmdir /s /q "%INSTALLER_DIR%\release" 2>nul

endlocal
