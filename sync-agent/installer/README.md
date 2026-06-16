# Sync Agent Installer 빌드 가이드

## OS별 티어 빌드 + 배포 (2026-06-16~)

> 단일 빌드로는 구형 OS에서 안 돈다(node 버전이 OS 최소사양에 묶임 — 예: node16은 Server 2008 R2에서 로드 실패). OS 범위별로 5종을 나눠 빌드하고, 슈퍼관리자에서 OS만 고르면 내보낼 버전을 알려준다.

### 지원 범위 (이 미만은 미지원)
| 플랫폼 | 지원 바닥 |
|---|---|
| Windows | Server 2008 R2 SP1 / Windows 7 SP1 이상 |
| Linux | CentOS 7 / RHEL 7 / Ubuntu 14.04 (glibc 2.17) 이상 |

미만(Server 2008 non-R2 · 2003 / CentOS 6 이하)은 모던 DB 드라이버가 도는 node가 없어 미지원. 가능하면 같은 네트워크의 최신 PC에 설치해 그 DB를 LAN으로 읽어온다.

### 빌드 (5종 한 번에)
```bash
npm run build:tiers          # 5종 + 런타임 동봉 + release/build-manifest.json
# 개별: npm run build:win-legacy / build:win-mid / build:win-modern / build:linux-legacy / build:linux-modern
```

| 티어 | 대상 OS | node | 산출물 |
|---|---|---|---|
| win-modern | Win10/11 · 2016+ | 20 | `release/sync-agent-win-modern.exe` |
| win-mid | Win8.1 · 2012 R2 | 16 | `dist-tiers/win-mid/SyncAgent/` (런타임 동봉) |
| win-legacy | Win7 · 2008 R2 | 14 | `dist-tiers/win-legacy/SyncAgent/` (런타임 동봉) |
| linux-modern | Ubuntu20.04+ · RHEL8+ | 20 | `release/sync-agent-linux-modern` |
| linux-legacy | CentOS7 · Ubuntu16~18 | 16 | `release/sync-agent-linux-legacy` |

> 아래 `build-installer.bat`(NSIS Setup.exe)는 node20(win-modern)만 담는다 — 구형 OS엔 위 티어 폴더를 쓴다.

### 배포 — 슈퍼관리자 "싱크에이전트 배포" 위저드
슈퍼관리자 → 시스템 → **싱크에이전트 배포**에서 플랫폼 → OS → DB를 고르면 내보낼 버전·설치 절차·DB 주의사항이 나온다. 서수란 팀장은 OS만 고르면 되고 node 버전은 시스템이 판단한다.

### Windows 구형(win-mid · win-legacy) 설치
런타임 DLL이 폴더에 동봉돼 vc_redist 설치 · 인터넷 · 재부팅 불필요.
1. `SyncAgent` 폴더를 대상 PC `C:\SyncAgent`에 통째로 복사
2. `INSTALL-run-as-admin.bat`을 관리자 권한으로 실행
3. `sync-agent v…`가 뜨면 정상 → 서비스 자동 등록·시작
4. 안 뜨면 같은 폴더의 `diagnose.txt`(EXIT_CODE)를 회신 — 에러창이 없어도 원인이 분류된다

### DB 접근
에이전트는 고객사 DB를 **읽기전용**으로만 읽는다 — 읽기전용 계정 권장. 구형 SQL Server(2008/2012)는 `encrypt=false` + TLS 1.0/1.1 허용 여부를 점검한다.

---

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
