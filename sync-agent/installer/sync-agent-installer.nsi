; ============================================================================
; Sync Agent NSIS Installer
; ============================================================================

Unicode true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "WinVer.nsh"

; ----------------------------------------------------------------------------
; 기본 설정
; ----------------------------------------------------------------------------
!define PRODUCT_NAME "Sync Agent"
!define PRODUCT_PUBLISHER "INVITO"
!define PRODUCT_WEB_SITE "https://hanjul.ai"
!define PRODUCT_DIR_REGKEY "Software\INVITO\SyncAgent"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

; 버전 정보 — 빌드 시 /D 옵션으로 오버라이드 가능
; 예: makensis /DPRODUCT_VERSION=1.0.1 sync-agent-installer.nsi
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "1.0.0"
!endif

!define EXE_NAME "sync-agent.exe"
!define WASM_NAME "sql-wasm.wasm"
!define SERVICE_NAME "SyncAgent"

; ----------------------------------------------------------------------------
; 빌드 설정
; ----------------------------------------------------------------------------
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "SyncAgent-Setup-${PRODUCT_VERSION}.exe"
InstallDir "$PROGRAMFILES\INVITO\SyncAgent"
InstallDirRegKey HKLM "${PRODUCT_DIR_REGKEY}" ""
RequestExecutionLevel admin    ; 관리자 권한 필요 (서비스 등록)
ShowInstDetails show
ShowUnInstDetails show
SetCompressor /SOLID lzma      ; 최대 압축

; ----------------------------------------------------------------------------
; 버전 정보 (파일 속성에 표시)
; ----------------------------------------------------------------------------
VIProductVersion "${PRODUCT_VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Installer"
VIAddVersionKey "FileVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "ProductVersion" "${PRODUCT_VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright (c) ${PRODUCT_PUBLISHER}"

; ----------------------------------------------------------------------------
; 변수
; ----------------------------------------------------------------------------
Var CheckboxService
Var CheckboxServiceState
Var CheckboxStartup
Var CheckboxStartupState

; ----------------------------------------------------------------------------
; MUI 설정
; ----------------------------------------------------------------------------
!define MUI_ABORTWARNING

; 아이콘 — icon.ico가 없으면 아래 두 줄을 주석 처리
; 또는 빌드 시 /DHAS_ICON 옵션 사용
!ifdef HAS_ICON
  !define MUI_ICON "icon.ico"
  !define MUI_UNICON "icon.ico"
!endif

; 환영 페이지 상단 텍스트
!define MUI_WELCOMEPAGE_TITLE "Sync Agent ${PRODUCT_VERSION} 설치"
!define MUI_WELCOMEPAGE_TEXT "이 마법사는 Sync Agent를 설치합니다.$\r$\n$\r$\nSync Agent는 고객사 POS/ERP 데이터를 한줄로(Target-UP) 서버에 자동으로 동기화하는 프로그램입니다.$\r$\n$\r$\n설치를 계속하려면 [다음]을 클릭하세요."

; 완료 페이지
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE_NAME}"
!define MUI_FINISHPAGE_RUN_PARAMETERS "--setup"
!define MUI_FINISHPAGE_RUN_TEXT "설치 마법사 실행 (초기 설정)"
!define MUI_FINISHPAGE_TITLE "설치 완료"
!define MUI_FINISHPAGE_TEXT "Sync Agent가 설치되었습니다.$\r$\n$\r$\n[설치 마법사 실행]을 체크하면 브라우저에서 초기 설정을 진행할 수 있습니다.$\r$\n$\r$\n이미 설정을 완료한 경우 체크를 해제하세요."

; ----------------------------------------------------------------------------
; 페이지 구성
; ----------------------------------------------------------------------------
; 설치 페이지
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom ServiceOptionsPage ServiceOptionsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

; 제거 페이지
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ----------------------------------------------------------------------------
; 언어
; ----------------------------------------------------------------------------
!insertmacro MUI_LANGUAGE "Korean"

; ----------------------------------------------------------------------------
; 서비스 옵션 페이지 (커스텀)
; ----------------------------------------------------------------------------
Function ServiceOptionsPage
  !insertmacro MUI_HEADER_TEXT "서비스 옵션" "Windows 서비스 등록 및 시작 옵션을 선택하세요."
  
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateGroupBox} 0 0 100% 120u "서비스 설정"
  Pop $0

  ${NSD_CreateCheckbox} 12u 20u 90% 12u "Windows 서비스로 등록 (부팅 시 자동 시작, 권장)"
  Pop $CheckboxService
  ${NSD_SetState} $CheckboxService ${BST_CHECKED}

  ${NSD_CreateLabel} 24u 38u 88% 24u "서비스로 등록하면 PC가 켜질 때 자동으로 Sync Agent가 실행됩니다.$\r$\n장애 발생 시 60초 후 자동 재시작됩니다 (최대 3회)."
  Pop $0

  ${NSD_CreateCheckbox} 12u 72u 90% 12u "설치 완료 후 바로 서비스 시작"
  Pop $CheckboxStartup
  ${NSD_SetState} $CheckboxStartup ${BST_CHECKED}

  ${NSD_CreateLabel} 24u 90u 88% 12u "초기 설정(설치 마법사)을 먼저 완료한 후 시작하는 것을 권장합니다."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function ServiceOptionsPageLeave
  ${NSD_GetState} $CheckboxService $CheckboxServiceState
  ${NSD_GetState} $CheckboxStartup $CheckboxStartupState
FunctionEnd

; ----------------------------------------------------------------------------
; 설치 전 체크
; ----------------------------------------------------------------------------
Function .onInit
  ; Windows 7 이상 확인
  ${IfNot} ${AtLeastWin7}
    MessageBox MB_ICONSTOP "Sync Agent는 Windows 7 이상이 필요합니다."
    Abort
  ${EndIf}

  ; 이전 버전 설치 확인
  ReadRegStr $0 HKLM "${PRODUCT_UNINST_KEY}" "UninstallString"
  ${If} $0 != ""
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION \
      "Sync Agent가 이미 설치되어 있습니다.$\r$\n$\r$\n기존 버전을 제거하고 새로 설치하시겠습니까?$\r$\n(설정 파일은 유지됩니다)" \
      IDOK uninst_prev
      Abort
    uninst_prev:
      ; 기존 서비스 중지
      nsExec::ExecToStack 'sc stop ${SERVICE_NAME}'
      Pop $0
      Pop $1
      Sleep 2000
      nsExec::ExecToStack 'sc delete ${SERVICE_NAME}'
      Pop $0
      Pop $1
      Sleep 1000
      ; 기존 uninstaller 실행 (quiet)
      ExecWait '"$0" /S _?=$INSTDIR'
  ${EndIf}
FunctionEnd

; ----------------------------------------------------------------------------
; 설치 섹션
; ----------------------------------------------------------------------------
Section "Sync Agent (필수)" SEC_MAIN
  SectionIn RO  ; 필수 — 해제 불가
  
  SetOutPath "$INSTDIR"
  
  ; --- 핵심 파일 복사 ---
  File "release\${EXE_NAME}"
  File "release\${WASM_NAME}"

  ; --- 디렉터리 생성 ---
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\logs"

  ; --- 시작 메뉴 ---
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Sync Agent 설치 마법사.lnk" \
    "$INSTDIR\${EXE_NAME}" "--setup" "$INSTDIR\${EXE_NAME}" 0
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Sync Agent 제거.lnk" \
    "$INSTDIR\uninstall.exe" "" "$INSTDIR\uninstall.exe" 0

  ; --- 레지스트리 (Add/Remove Programs) ---
  WriteRegStr HKLM "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\${EXE_NAME}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE_NAME}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKLM "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegDWORD HKLM "${PRODUCT_UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${PRODUCT_UNINST_KEY}" "NoRepair" 1

  ; 설치 크기 계산
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${PRODUCT_UNINST_KEY}" "EstimatedSize" "$0"

  ; --- Uninstaller 생성 ---
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; --- Windows 서비스 등록 ---
  ; 주의: nsExec::ExecToLog는 exe의 UTF-8 한글 출력을 제대로 표시하지 못함
  ;       nsExec::ExecToStack으로 실행하고 DetailPrint로 한글 메시지를 직접 출력
  ${If} $CheckboxServiceState == ${BST_CHECKED}
    DetailPrint "Windows 서비스 등록 중..."
    nsExec::ExecToStack '"$INSTDIR\${EXE_NAME}" --install-service'
    Pop $0
    Pop $1  ; stdout (사용하지 않음 — UTF-8 깨짐 방지)
    ${If} $0 == 0
      DetailPrint "서비스 등록 완료"

      ; 바로 시작 옵션
      ${If} $CheckboxStartupState == ${BST_CHECKED}
        DetailPrint "서비스 시작 중..."
        nsExec::ExecToStack 'sc start ${SERVICE_NAME}'
        Pop $0
        Pop $1
        ${If} $0 == 0
          DetailPrint "서비스 시작 완료"
        ${Else}
          DetailPrint "서비스 시작 실패 (초기 설정을 먼저 완료하세요)"
        ${EndIf}
      ${EndIf}
    ${Else}
      DetailPrint "서비스 등록 실패 — 관리자 권한으로 다시 시도하세요"
      MessageBox MB_OK|MB_ICONEXCLAMATION \
        "서비스 등록에 실패했습니다.$\r$\n$\r$\n나중에 관리자 권한 명령 프롬프트에서 다음을 실행하세요:$\r$\n$INSTDIR\${EXE_NAME} --install-service"
    ${EndIf}
  ${EndIf}

SectionEnd

; ----------------------------------------------------------------------------
; 제거 섹션
; ----------------------------------------------------------------------------
Section "Uninstall"
  
  ; --- 서비스 중지 & 제거 ---
  DetailPrint "서비스 중지 중..."
  nsExec::ExecToStack 'sc stop ${SERVICE_NAME}'
  Pop $0
  Pop $1
  Sleep 2000
  DetailPrint "서비스 제거 중..."
  nsExec::ExecToStack 'sc delete ${SERVICE_NAME}'
  Pop $0
  Pop $1
  Sleep 1000

  ; --- 파일 삭제 ---
  Delete "$INSTDIR\${EXE_NAME}"
  Delete "$INSTDIR\${WASM_NAME}"
  Delete "$INSTDIR\uninstall.exe"

  ; --- 시작 메뉴 삭제 ---
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Sync Agent 설치 마법사.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Sync Agent 제거.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; --- 레지스트리 삭제 ---
  DeleteRegKey HKLM "${PRODUCT_UNINST_KEY}"
  DeleteRegKey HKLM "${PRODUCT_DIR_REGKEY}"

  ; --- 설정/로그 보존 여부 확인 ---
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "설정 파일과 로그를 삭제하시겠습니까?$\r$\n$\r$\n[아니오]를 선택하면 재설치 시 기존 설정을 유지합니다." \
    IDYES delete_data
    Goto skip_data

  delete_data:
    RMDir /r "$INSTDIR\data"
    RMDir /r "$INSTDIR\logs"
  
  skip_data:
  RMDir "$INSTDIR"   ; 빈 디렉터리만 삭제 (파일 남아있으면 유지)

SectionEnd
