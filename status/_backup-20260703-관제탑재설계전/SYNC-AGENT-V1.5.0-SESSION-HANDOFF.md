# Sync Agent v1.5.0 — 세션 핸드오프 (2026-04-18 → 다음 세션)

> **작성:** 2026-04-18 단일 세션 종료 시점
> **용도:** 다음 세션이 즉시 이어받아 QA + 배포를 진행하도록
> **참조 문서:**
> - 설계서: [`SYNC-AGENT-V1.5.0-DESIGN.md`](SYNC-AGENT-V1.5.0-DESIGN.md)
> - QA 가이드: [`SYNC-AGENT-V1.5.0-QA-GUIDE.md`](SYNC-AGENT-V1.5.0-QA-GUIDE.md)
> - 릴리스 노트: [`SYNC-AGENT-V1.5.0-RELEASE-NOTES.md`](SYNC-AGENT-V1.5.0-RELEASE-NOTES.md)
> - 고객 매뉴얼: [`../sync-agent/SyncAgent_설치매뉴얼_v1_5.docx`](../sync-agent/SyncAgent_설치매뉴얼_v1_5.docx)

---

## 🎯 현재 상태 (2026-04-18 야간 종료)

### ✅ 완료된 것

| 영역 | 상태 | 세부 |
|------|------|------|
| 백엔드 구현 (Day 1) | ✅ | 7파일 — utils/ai-mapping.ts + routes/sync.ts 확장 + auth/customers/upload/companies 수정 + middlewares/sync-active-check.ts 신규 |
| Agent 구현 (Day 2) | ✅ | 14파일 — types/normalize/scheduler/api/mapping/setup 전반 |
| 프론트엔드 (Day 3) | ✅ | 2파일 — SyncActiveBlockModal + Dashboard 연결 |
| DB 마이그레이션 | ✅ | is_system / customer_code / customer_code_sequences / ai_mapping_* 컬럼. 9개 회사 시스템 user 자동 생성 |
| tsc 0 에러 | ✅ | backend + sync-agent + frontend |
| Git push | ✅ | commit `c5f2393` |
| tp-deploy-full | ✅ | 배포 완료 |
| 고객용 매뉴얼 docx | ✅ | `SyncAgent_설치매뉴얼_v1_5.docx` (내부 스키마/AI 모델명 전부 배제) |

### 🚧 남은 작업 (다음 세션 진행)

1. **sync-agent 바이너리 빌드** (Windows exe + Linux)
2. **GitHub Releases v1.5.0 등록** (빌드 산출물 공개 배포)
3. **서팀장 QA** (8개 시나리오 E2E)
4. **QA 이슈 반영**
5. **첫 고객사 배포** (인스톨러 + 매뉴얼 전달)

---

## 🚀 다음 세션 즉시 실행 순서

### 1단계: sync-agent 빌드 (Harold님 직접 실행)

PowerShell에서:

```powershell
cd C:\Users\ceo\projects\targetup\sync-agent

# Windows exe
npm run build:exe
# → release/sync-agent.exe 생성

# Linux 바이너리
npm run build:linux
# → release/sync-agent 생성

# Linux 패키지 (tar.gz)
bash installer/build-linux-package.sh 1.5.0
# → installer/SyncAgent-1.5.0-linux-x64.tar.gz

# Windows 인스톨러 (NSIS 필요)
installer\build-installer.bat 1.5.0
# → installer/SyncAgent-Setup-1.5.0.exe + .zip
```

빌드 완료 산출물:
- `sync-agent/installer/SyncAgent-Setup-1.5.0.exe` (~108MB)
- `sync-agent/installer/SyncAgent-Setup-1.5.0.zip`
- `sync-agent/installer/SyncAgent-1.5.0-linux-x64.tar.gz`

### 2단계: GitHub Releases 등록

```powershell
cd C:\Users\ceo\projects\targetup

gh release create v1.5.0 `
  sync-agent/installer/SyncAgent-Setup-1.5.0.exe `
  sync-agent/installer/SyncAgent-Setup-1.5.0.zip `
  sync-agent/installer/SyncAgent-1.5.0-linux-x64.tar.gz `
  --title "Sync Agent v1.5.0" `
  --notes-file status/SYNC-AGENT-V1.5.0-RELEASE-NOTES.md
```

⚠️ **빌드 산출물은 git 커밋 금지** — `.gitignore`로 이미 제외됨 (`sync-agent/release/`, `installer/release/`, `*.exe`, `*.zip`). GitHub Releases로만 배포.

### 3단계: sync_releases 테이블에 v1.5.0 등록 (자동 업데이트 활성화)

서버에서 실행:

```bash
ssh administrator@58.227.193.62
cd /home/administrator/targetup-app

docker exec -i targetup-postgres psql -U targetup targetup << 'EOF'
-- 기존 활성 릴리스 비활성화
UPDATE sync_releases SET is_active = false WHERE is_active = true;

-- v1.5.0 등록
INSERT INTO sync_releases (version, download_url, checksum, release_notes, force_update, is_active, released_at)
VALUES (
  '1.5.0',
  'https://github.com/hoyun5295-ctrl/TargetupAI/releases/download/v1.5.0/SyncAgent-Setup-1.5.0.exe',
  'SHA256_체크섬_여기_붙여넣기',  -- sha256sum 명령으로 생성
  'v1.5.0 - AI 자동 매핑, 동기화 주기 표준화, 매장전화번호 정규화 개선',
  false,
  true,
  NOW()
);

SELECT version, released_at FROM sync_releases WHERE is_active = true;
EOF
```

체크섬 생성 (PowerShell):
```powershell
Get-FileHash sync-agent\installer\SyncAgent-Setup-1.5.0.exe -Algorithm SHA256
```

### 4단계: 서팀장 QA 전달

서팀장에게 전달할 파일:
- `status/SYNC-AGENT-V1.5.0-QA-GUIDE.md` (8개 시나리오 A~H)
- `sync-agent/SyncAgent_설치매뉴얼_v1_5.docx`
- GitHub Releases v1.5.0 URL

QA 시나리오:
- **A** 신규 설치 + AI 매핑
- **B** 증분 동기화
- **C** 수신거부 3단 배정
- **D** 엑셀 업로드 차단 모달
- **E** Linux 설치
- **F** 설정 변경 (주기 자동 반영)
- **G** AI 매핑 쿼터 초과
- **H** 시스템 user 로그인 차단

### 5단계: QA 이슈 반영

서팀장 리포트 수신 후:
- `status/BUGS.md`에 새 버그 항목 등록
- 하나씩 수정 → tsc 0 에러 → tp-deploy-full
- 재QA → 통과 시 첫 고객사 배포 준비

### 6단계: 첫 고객사 배포

- 고객사에 다음 파일 전달:
  - `SyncAgent-Setup-1.5.0.exe` (GitHub Releases URL)
  - `SyncAgent_설치매뉴얼_v1_5.docx`
- API Key / API Secret 발급 (sys.hanjullo.com 슈퍼관리자 UI)
- 고객사 설치 진행 (매뉴얼 5단계 위저드)
- Step 4 "AI 자동 매핑 실행" 버튼 클릭 → 결과 확인
- 최초 풀싱크 완료 확인

---

## 🔒 코드 변경 시 주의사항

### 이번 세션에서 추가된 CT (컨트롤타워)

1. **`utils/ai-mapping.ts`** — AI 매핑 단일 진입점
   - `callAiMapping(companyId, input)` 호출 외 경로 금지
   - 쿼터 체크(월 10회) + Opus→Sonnet 폴백 + 프롬프트 캐싱

2. **`middlewares/sync-active-check.ts`** — 싱크 차단 미들웨어
   - `blockIfSyncActive` 적용 라우트: upload/save, customers POST/DELETE 5개
   - 신규 고객 DB 변경 라우트 추가 시 반드시 이 미들웨어 적용

3. **`routes/sync.ts` 공통 헬퍼**:
   - `getSyncConfigForAgent(companyId)` — 응답 config 조회
   - `registerSyncUnsubscribes(companyId, companyName)` — 3단 수신거부 배정

### 수정 시 건드리면 안 되는 것

- **DB 마이그레이션 이미 적용됨** — `is_system`, `customer_code`, `customer_code_sequences`, `ai_mapping_*` 컬럼/테이블. 추가 DDL 시 SCHEMA.md 먼저 업데이트
- **프론트 UI에서 `id`/`customer_code` 노출 금지** (내부 식별자)
- **Agent types/customer.ts 레거시 9개 필드 복원 금지** (M-1 — 서버에서 무시됨)

---

## 📋 Harold님 정책 확인사항

| 정책 | 확정 |
|------|------|
| SSH 키 인증 | ❌ 보류 (노트북 해킹 시 동일 리스크) |
| fail2ban 완화 | ❌ 안 함 (핫스팟 대응 충분) |
| iptables 영구 차단 | 🔮 다음 보안강화 세션 |
| 고객 매뉴얼 내부 정보 | ❌ AI 모델명/DB 스키마/API 엔드포인트 전부 배제 |
| Git push | 🚫 AI 금지. Harold님 직접 |
| SSH 서버 접속 | 🚫 AI 금지. Harold님 직접 |

---

## 🐛 발견된 이슈 (미해결)

현재 없음. 모든 tsc 에러 해결 + 배포 완료 상태.

### 주의할 장기 이슈

1. **기존 레포에 102MB pos-agent/build/hanjul-pos-agent.exe가 이미 커밋되어 있음** — 나중에 git history cleanup 필요 (git filter-repo 또는 BFG Repo-Cleaner)
2. **node_modules/prisma 엔진 파일들이 트래킹되고 있음** (19MB 3개) — `.gitignore` 재확인 필요

이 두 가지는 **다음 보안강화/정리 세션**에 별도 작업.

---

## 💬 다음 세션 첫 메시지 추천 프롬프트

```
Sync Agent v1.5.0 다음 단계 진행.

핸드오프 문서 먼저 읽고 시작해:
status/SYNC-AGENT-V1.5.0-SESSION-HANDOFF.md

오늘 할 일 (우선순위 순):
1. sync-agent 빌드 (exe + linux) — 명령어만 알려주고 내가 실행
2. GitHub Releases v1.5.0 등록
3. sync_releases 테이블 INSERT (heredoc 안내)
4. 서팀장 QA 가이드 전달 준비

[절대 금지 — CLAUDE.md 원칙]
- git push / SSH 접속 AI 금지
- 고객 매뉴얼에 내부 스키마/AI 모델명 노출 금지
- 설계서(SYNC-AGENT-V1.5.0-DESIGN.md) 범위 밖 임의 추가 금지
```

---

**세션 핸드오프 끝.**
