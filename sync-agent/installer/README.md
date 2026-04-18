# Sync Agent Installer 빌드 가이드

## 사전 준비

### 1. NSIS 설치
- 다운로드: https://nsis.sourceforge.io/Download
- 설치 시 모든 구성요소 포함 (Plugins 필수)
- 기본 경로: `C:\Program Files (x86)\NSIS`

### 2. Agent exe 빌드
```bash
# 프로젝트 루트에서
npm run build        # esbuild 번들링
npm run build:exe    # pkg로 Windows exe 생성
```

빌드 결과물:
- `release/sync-agent.exe` (약 95MB)
- `release/sql-wasm.wasm`

### 3. 아이콘 준비 (선택)
- `installer/icon.ico` 파일을 준비
- 16x16, 32x32, 48x48, 256x256 해상도 포함 권장
- 없으면 NSIS 기본 아이콘 사용 (MUI_ICON/MUI_UNICON 라인 주석 처리 필요)

## 빌드

```bash
# 기본 (버전 1.0.0)
cd installer
build-installer.bat

# 버전 지정
build-installer.bat 1.2.0
```

## 출력
- `installer/SyncAgent-Setup-{VERSION}.exe`

## 설치 프로그램 동작

### 설치 과정
1. 환영 화면
2. 설치 경로 선택 (기본: `C:\Program Files\INVITO\SyncAgent`)
3. 서비스 옵션 선택
   - Windows 서비스 등록 (자동 시작, 장애 시 60초 후 재시작)
   - 설치 후 바로 서비스 시작
4. 파일 설치
5. 완료 — [설치 마법사 실행] 체크 시 `--setup` 모드로 브라우저 열림

### 설치되는 파일
```
C:\Program Files\INVITO\SyncAgent\
├── sync-agent.exe      # 메인 실행 파일
├── sql-wasm.wasm       # SQLite WASM
├── uninstall.exe       # 제거 프로그램
├── data/               # 런타임 데이터 (config.enc, agent.key, sync_state.json)
└── logs/               # 일별 로그
```

### 시작 메뉴
- `Sync Agent 설치 마법사` → `sync-agent.exe --setup`
- `Sync Agent 제거` → `uninstall.exe`

### 제거 시
- 서비스 자동 중지 및 삭제
- 설정/로그 보존 여부 선택 가능 (재설치 시 설정 유지 가능)
- 레지스트리 정리

## 업그레이드
- 이전 버전 설치 감지 시 자동으로 기존 서비스 중지 → 삭제 → 재설치
- `data/` 폴더 (설정 파일)는 업그레이드 시 유지됨

## 주의사항
- 관리자 권한 필요 (서비스 등록, Program Files 쓰기)
- 아이콘이 없으면 .nsi 파일에서 `MUI_ICON` / `MUI_UNICON` 라인 주석 처리
- NSIS 경로가 다르면 `build-installer.bat`에서 `NSIS_DIR` 수정
