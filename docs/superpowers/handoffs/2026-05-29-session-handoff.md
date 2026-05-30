# 2026-05-29 세션 핸드오프 — SDK v0.3.5-a + 긴급 운영 fix + DB 컬럼 3중 안전망

> 본 세션 = SDK v0.3.5-a 코드 작성으로 시작 → 운영 긴급 사고 4건(이니시스/알림톡/발송결과/예약조회) 끼어들기 → DB 컬럼 다운 사고 + 3중 안전망 신설로 종결.
> 컨텍스트 과다로 SDK 본작업(v0.3.5-b) 미착수. 다음 세션 본 핸드오프 정독 후 진입.

---

## 1. 이번 세션 완료 (commit + push 종결 영역)

### 1.1. SDK v0.3.5-a 코드 (commit `46ef104`에 묶여 push 종결)

- `packages/sdk-js/src/auto-capture/` 9 모듈 + 8 테스트:
  - storage.ts (anonymous_id 영구 + session_id 30분 TTL)
  - pii-masking.ts (7 분류: email/휴대폰/카드/주민/URL token/계좌/JWT)
  - identify.ts (body data-hjl-user-id 자동 감지 + MutationObserver)
  - consent.ts (4 분리: analytics/marketing/ad/kakao)
  - pageview.ts (history.pushState patching + SPA)
  - click.ts (보수 수집 — innerText opt-in 한정)
  - heartbeat.ts (5 단계 진단)
  - transport.ts (batch + retry + schema_version v1)
  - index.ts (5 모듈 + Heartbeat + Transport 통합 IIFE)
- rollup.config.js + vitest.config.ts + package.json (Rollup/vitest/tslib devDeps)
- backend: `utils/pii-masking.ts` 신설 + `routes/cdp.ts` POST /ingest endpoint
- vitest 45 test PASS + IIFE 빌드(dist/iife/hanjul.min.js 6KB) 확인 종결 (주인님 로컬 실행)

### 1.2. D226+ 이니시스 결제 취소 fix (commit `46ef104`)

- `routes/payments.ts` GET /inicis/close + GET /inicis/return endpoint 신설 (closeUrl GET redirect 사고 차단)

### 1.3. D227+ 발송결과/예약조회 fix (commit `d138dbe` ~ `3ee2606`)

- **발송결과 전체 다운 사고 + 복구**: campaigns 테이블에 없는 `alimtalk_template_code` 컬럼 SELECT 추가 → SQL 500 → 전체 고객사 다운 → 컬럼 제거로 복구
- messages endpoint: `LEFT JOIN kakao_templates kt ON c.kakao_template_id = kt.id` 안전 조회
- 발송결과 default 7일 (backend + frontend ResultsModal)
- 예약조회 성능: cleanupScheduledCampaigns 동기 호출 제거 → 1분 cron worker(`utils/scheduled-cleanup-worker.ts`) 분리 + manage-scheduled LIMIT/OFFSET 페이지네이션
- PG 인덱스 2건 적용 확인 (idx_campaigns_company_period + idx_campaigns_status_scheduled_at)

### 1.4. D227+ 결제 취소 후 멈춤 fix (commit `4d7a37a`)

- root cause = helmet 전역 CSP(script-src 'self')가 renderResultHtml inline script(자동 close/postMessage/redirect) 차단 → 결제 취소 후 멈춤 + 복귀 X (curl 응답 헤더로 확정)
- `routes/payments.ts` setResultPageCsp helper 신설 + 4개 inicis callback endpoint(POST/GET close + return) CSP override
- 배포 완료. **다음 세션 확인 의무**: 결제 취소 시 자동 닫힘 + 복귀 실제 동작 → "잔액충전 모달 복귀"까지 안 되면 payViewType(overlay→popup) 또는 BalanceModals handleMessage cancelled 보강 2차 진단.

### 1.5. DB 컬럼 다운 3중 안전망 (commit `4d7a37a`)

- `CLAUDE.md` db_column_verify_before_code 영구 룰 + MANDATORY_CHECKLIST 항목
- `.claude/settings.json` PostToolUse hook (backend route/utils Edit 시 DB 컬럼 검증 reminder, 2회 fire 실증)
- `packages/backend/scripts/post-deploy-smoke.sh` 배포 후 스모크 (SMOKE_TOKEN 기반)
- 메모리 `feedback_db_column_verify_before_code.md` + MEMORY.md 인덱스
- 전부 commit + 배포 완료
- **hook 알려진 한계 (다음 세션 개선 권장)**: command가 stdin 전체를 grep → file_path뿐 아니라 Edit old/new 내용에 "backend routes/.ts" 텍스트가 있으면 STATUS.md 등 문서 Edit에도 over-trigger. 무해(차단 X, reminder만)이나 정확도 위해 file_path만 추출(`python -c`로 tool_input.file_path)하도록 개선 가능. jq 미설치라 python 활용.

---

## 2. 배포 완료 — 미commit 영역 없음

본 세션 모든 변경 = commit `4d7a37a`까지 push + 서버 배포 종결. working tree clean (worktrees 제외).

---

## 3. D227+ messages JOIN — 배포됨, information_schema 검증 권장

messages endpoint(/campaigns/:id/messages) = `LEFT JOIN kakao_templates kt ON c.kakao_template_id = kt.id` 배포 완료(commit `3ee2606`). SCHEMA.md 근거(campaigns.kakao_template_id + kakao_templates.template_code 둘 다 존재 확인)이나 information_schema 직접 미검증 = 잔여 리스크.

**다음 세션 검증 권장** (db_column_verify_before_code 룰):
```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='campaigns' AND column_name='kakao_template_id') AS campaigns_fk,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='kakao_templates' AND column_name='template_code') AS kt_code;
```
2개 모두 1 = 안전. 또는 알림톡 캠페인 상세 클릭 시 500 미발생 확인.

---

## 4. SDK v0.3.5-a 미완료 (다음 세션 — 본 작업)

| # | 작업 | 상태 |
|---|------|------|
| 1 | cdp_events ALTER 6 컬럼 + 2 인덱스 (anonymous_id/session_id/trust_level/schema_version/sent_at/received_at) | **실행 여부 미확인** — 주인님 직접 PG 확인 의무 |
| 2 | CDN 배포 (cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js) | 미완료 (인프라 영역) |
| 3 | POPPON 검증 (15분 first event + PII 0 + heartbeat 5단계) | 미완료 |
| 4 | Codex 이중 검증 (/codex:review auto-capture + pii-masking + cdp.ts) | 미완료 |
| 5 | **v0.3.5-b** (백오피스 1-click 발급 UI + first event 검증 화면 + 5/10/30분 진단) | **미착수 — 별 plan 의무** |
| 6 | spec → archive 이동 (`docs/superpowers/specs/2026-05-29-sdk-v035-launch-design.md` → `docs/superpowers/archive/`) | v0.3.5-a 완전 종결 + POPPON 검증 후 이동 |

### cdp_events ALTER SQL (미실행 시 실행 의무)
```sql
ALTER TABLE cdp_events
  ADD COLUMN IF NOT EXISTS anonymous_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS trust_level VARCHAR(16) DEFAULT 'observed' CHECK (trust_level IN ('observed','inferred','declared','verified')),
  ADD COLUMN IF NOT EXISTS schema_version VARCHAR(8) DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMP DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_cdp_events_anon_session ON cdp_events(anonymous_id, session_id) WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cdp_events_trust_level ON cdp_events(trust_level, received_at);
```
> 주의: POST /api/cdp/ingest는 db_alter_safety_net 분기(503 + DB_MIGRATION_PENDING) 포함 — ALTER 미실행 시 500 X, 503 안내. 단 정상 작동 위해 ALTER 의무.

### v0.3.5-a plan 위치
`docs/superpowers/plans/2026-05-29-sdk-v035-a-implementation.md` (Task A~E + Self-review 포함)

---

## 5. 다음 세션 진입 순서 (권장)

본 세션 운영 긴급 fix(이니시스/알림톡/발송결과/예약조회/CSP) + 3중 안전망 = commit `4d7a37a`까지 전부 배포 종결. 다음 세션 = SDK 본작업 복귀 + 잔여 확인.

1. 본 핸드오프 정독
2. **§1.4 결제 취소 자동 닫힘/복귀 실제 동작 확인** — 안 되면 payViewType/handleMessage 2차 진단 (운영 결제 영역)
3. **§3 messages JOIN information_schema 검증** (또는 알림톡 캠페인 상세 클릭 500 미발생 확인)
4. §4-1 cdp_events ALTER 실행 여부 확인 (미실행 시 실행)
5. §4-3 POPPON 검증 또는 §4-5 **v0.3.5-b 진입** (주인님 우선순위 결정 — SDK 본작업)
6. v0.3.5-a 완전 종결 후 §4-6 spec archive 이동

---

## 6. 본 세션 비토 사고 기록 (재발 차단)

- **DB 컬럼 미검증 → 운영 기간계 전체 다운** (campaigns.alimtalk_template_code) = no_guess_strict 0번 원칙 위반. → 3중 안전망 신설로 영구 차단.
- 주간 운영 중 빌드 안내 + build:safe 누락 안내 = 영구 룰 위반.
- 7일 default 시도 시 사용자 0건 표시 사고 (이번 달 default와 혼동).
- Edit tool 환각(backend default 복구 안 했는데 했다고 보고).
- 본 사고 상세 = `memory/feedback_db_column_verify_before_code.md`.
