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

---

## 2. 미commit 영역 (다음 세션 우선 commit + 배포 의무)

현재 working tree 미commit:
- `CLAUDE.md` (M) — db_column_verify_before_code 영구 룰 + MANDATORY_CHECKLIST 항목
- `.claude/settings.json` (신규) — PostToolUse hook (backend route/utils Edit 시 DB 컬럼 검증 reminder, 2회 fire 실증 종결)
- `packages/backend/scripts/post-deploy-smoke.sh` (신규) — 배포 후 핵심 endpoint 스모크 체크
- 메모리: `feedback_db_column_verify_before_code.md` + MEMORY.md 인덱스 (git 영역 X — 로컬 메모리)

**다음 세션 시작 시 통합 commit + 배포 의무**:
```
tp-push "D227+ DB 컬럼 다운 3중 안전망 — db_column_verify_before_code 영구 룰 + Edit hook + 배포 후 스모크 스크립트"
```
서버 SSH → git pull → backend build:safe → frontend build:safe → pm2 restart all.

---

## 3. D227+ 배포 전 미검증 영역 (운영 재다운 차단 — 최우선)

messages endpoint JOIN(`c.kakao_template_id` + `kakao_templates.template_code`)이 SCHEMA.md 근거로만 작성됨. **db_column_verify_before_code 룰 첫 적용 — 배포 전 PG 직접 검증 의무**:

```sql
SELECT
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='campaigns' AND column_name='kakao_template_id') AS campaigns_fk,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name='kakao_templates' AND column_name='template_code') AS kt_code,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name='kakao_templates') AS kt_table;
```
3개 모두 = 1 이면 JOIN 안전 배포. 0 있으면 즉시 정정.

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

1. 본 핸드오프 정독
2. **§3 messages JOIN 컬럼 검증 SQL → 결과 확인** (운영 재다운 차단 최우선)
3. **§2 3중 안전망 + 현재 results.ts/frontend 변경 통합 commit + 배포**
4. §4-1 cdp_events ALTER 실행 여부 확인 (미실행 시 실행)
5. §4-3 POPPON 검증 또는 §4-5 v0.3.5-b 진입 (주인님 우선순위 결정)
6. v0.3.5-a 완전 종결 후 §4-6 spec archive 이동

---

## 6. 본 세션 비토 사고 기록 (재발 차단)

- **DB 컬럼 미검증 → 운영 기간계 전체 다운** (campaigns.alimtalk_template_code) = no_guess_strict 0번 원칙 위반. → 3중 안전망 신설로 영구 차단.
- 주간 운영 중 빌드 안내 + build:safe 누락 안내 = 영구 룰 위반.
- 7일 default 시도 시 사용자 0건 표시 사고 (이번 달 default와 혼동).
- Edit tool 환각(backend default 복구 안 했는데 했다고 보고).
- 본 사고 상세 = `memory/feedback_db_column_verify_before_code.md`.
