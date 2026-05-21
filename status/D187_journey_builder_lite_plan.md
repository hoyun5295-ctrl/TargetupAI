# D187 Journey Builder Lite Step 1 — 진행 계획

> **작성일**: 2026-05-20
> **본 .md 파일은 작업 완료 후 삭제합니다** (Harold 명시 정합)
> **목적**: AI Operator 핵심 고도화 — 7 표준 여정 + 트리거 기반 자동 step 진행 + Continuous Operator 안전망 통합

---

## 0. Harold 명시 확정 사항 (2026-05-20)

| # | 항목 | 확정 |
|---|---|---|
| 1 | 시작 템플릿 범위 | **7건 전부 한 번에** (가입/재구매/휴면/장바구니/생일/예약/Custom) |
| 2 | 사용자 동의 임계값 | **회사 자유 설정 + 무제한 default + 광고/비광고 둘 다 자동 (4 광고 검증 통과 시)** — Harold 사용 사례 영역 정합 (일 300만건 / 월 1억건 발송) |
| 3 | journey 월 예산 | **강제 X, 회사 자유** (`budget_monthly` NULL = 무제한) |
| 4 | 재진입 정책 | **여정별 default 매트릭스** (Braze 비교 결과 비토 추천 정합) |
| 5 | CDP events 트리거 | **한줄로 표준 매핑 컬럼** (cdp_events + customers, 자사몰 매핑은 어댑터 책임) |
| 6 | AI_OPERATOR_ALLOWED_USERS | **hoyun만 유지** (개발 완료 후 직원 공개) |
| 7 | 분량 | **9~13h 추정** — Step 1-A/B/C 분할 + 한 세션 종결 가능 |
| 8 | trigger-watcher 주기 | **5분** (부하 정합 + Continuous Operator 동일) |

---

## 1. 7 표준 여정 매트릭스

| # | 템플릿 | 트리거 | step 시계열 | 재진입 default | cooldown |
|---|---|---|---|---|---|
| 1 | 신규 가입 온보딩 | `customers.created_at` (24h 안 신규) | Day0 환영 → Day1 사용법 → Day3 첫 혜택 → Day7 첫 구매 유도 | OFF | — |
| 2 | 재구매 | `cdp_events.event='purchase'` OR `customers.recent_purchase_date` 변경 | Day7 후기 → Day14 관련 상품 → Day30 재구매 쿠폰 | ON | 0 (매 구매) |
| 3 | 휴면 회수 | `customers.recent_purchase_date < NOW() - 30d` AND `is_active=true` | Day0 안부 → Day7 특별 혜택 → Day14 마지막 제안 | ON | 90일 |
| 4 | 장바구니 포기 | `cdp_events.event='cart_add'` + 24h 안 'checkout_start' 없음 | Day0 알림 → Day1 리마인더 → Day3 할인 쿠폰 | ON | 7일 |
| 5 | 생일 | `customers.birth_month_day` D-7 OR `birth_date` | D-7 사전 안내 → D-Day 축하 + 쿠폰 | ON | 365일 |
| 6 | 예약 | `cdp_events.event='reservation_created'` (custom) | D-3 사전 → D-Day 당일 → D+1 후기 요청 | ON | 0 (매 예약) |
| 7 | Custom | 자연어 진입 (Opus 4.7 자동 step 생성) | AI 자동 | UI 설정 | UI 설정 |

---

## 2. DB schema 4 신규 테이블 (Step 1-A)

```sql
-- 1. journeys (회사별 활성 여정)
CREATE TABLE IF NOT EXISTS journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  template_code varchar(30) NOT NULL,           -- 'onboarding'|'repeat'|'dormant'|'cart'|'birthday'|'reservation'|'custom'
  trigger_event varchar(50) NOT NULL,
  trigger_filters jsonb DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'draft',  -- 'draft'|'active'|'paused'|'ended'
  budget_monthly numeric(15,2),                  -- NULL = 무제한 (Harold 명시 정합)
  allow_reentry boolean DEFAULT false,
  reentry_cooldown_days integer,
  -- ★ 회사 자유 임계값 (Harold 사용 사례 영역 정합 — 일 300만건 영역에서 1,000건 X)
  threshold_recipients_per_step integer,         -- NULL = 무제한, 회사 UI 자유 설정
  threshold_cost_per_step numeric(15,2),         -- NULL = 무제한, 회사 UI 자유 설정
  threshold_risk_level varchar(10) DEFAULT 'low', -- 'low'|'medium'|'high'
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  paused_at timestamptz,
  pause_reason text,
  stats_total_entered integer DEFAULT 0,
  stats_total_completed integer DEFAULT 0,
  stats_total_cost numeric(15,2) DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- 2. journey_steps (여정 step 정의)
CREATE TABLE IF NOT EXISTS journey_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  step_type varchar(20) NOT NULL,                -- 'message'|'wait'|'condition'
  delay_hours integer DEFAULT 0,
  channel varchar(20),                            -- 'sms'|'lms'|'mms'|'kakao'|'email'
  message_template text,
  condition_jsonb jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (journey_id, step_order)
);

-- 3. journey_executions (고객별 여정 실행 상태) — UNIQUE 제거 (재진입 정합)
CREATE TABLE IF NOT EXISTS journey_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  current_step_order integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'active',
  entered_at timestamptz NOT NULL DEFAULT NOW(),
  next_run_at timestamptz,
  completed_at timestamptz,
  total_cost numeric(15,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT NOW()
  -- 재진입 정합 = UNIQUE 제거. trigger watcher에서 cooldown 검증
);

-- 4. journey_step_logs (각 step 실행 이력)
CREATE TABLE IF NOT EXISTS journey_step_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES journey_executions(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT NOW(),
  status varchar(20) NOT NULL,                    -- 'sent'|'failed'|'skipped'
  cost numeric(15,2) DEFAULT 0,
  error_reason text
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_journeys_company_status ON journeys(company_id, status);
CREATE INDEX IF NOT EXISTS idx_journey_steps_journey_order ON journey_steps(journey_id, step_order);
CREATE INDEX IF NOT EXISTS idx_journey_executions_due ON journey_executions(next_run_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_journey_executions_customer ON journey_executions(customer_id);
CREATE INDEX IF NOT EXISTS idx_journey_executions_journey_status ON journey_executions(journey_id, status, entered_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_step_logs_execution ON journey_step_logs(execution_id, sent_at DESC);
```

---

## 3. Step 1-A: DB + utils 컨트롤타워 (예상 4~5h)

### 3-1. DB SQL (Harold 직접 실행)
- 위 4 테이블 + 6 인덱스 CREATE

### 3-2. utils/journey-builder.ts (CT-43)
- `generateJourneyFromTemplate(templateCode, companyContext)` — 7 표준 템플릿 자동 생성
- `generateCustomJourney(naturalLanguageObjective, companyMemory)` — Opus 4.7 호출 (model:'opus' 명시) + ai_company_memory 활용
- `validateJourneySafety(journey)` — 4 임계값 + 예산 + 영구 원칙 정합 검증
- 영구 룰 정합: `ai_operator_model_isolation` + `no_target_auto_relax`

### 3-3. utils/journey-executor.ts (CT-44)
- `startJourneyExecutor()` — 5분 cron worker (app.ts 등록)
- 영구 흐름:
  1. `next_run_at <= NOW()` + status='active' execution 조회
  2. 4 임계값 검증 (1,000건 / 5만원 / low risk / 비광고)
  3. 임계 초과 시 → journey status='paused' + 알람
  4. 정합 시 → step 발송 (campaigns INSERT + sms-queue 영역 호출)
  5. journey_step_logs INSERT + next_run_at + current_step_order 갱신
  6. 모든 step 완료 시 → execution status='completed'

### 3-4. utils/journey-trigger-watcher.ts
- `startJourneyTriggerWatcher()` — 5분 cron worker (app.ts 등록)
- 영역: 활성 journeys의 trigger_event 영역 polling
  - customers 테이블 polling: 가입 / 재구매 / 휴면 / 생일
  - cdp_events 테이블 polling: 장바구니 포기 / 예약
- 매칭 시 → cooldown 검증 → journey_executions INSERT + next_run_at = NOW() + step[0].delay_hours

---

## 4. Step 1-B: routes (예상 3~4h)

`routes/ai.ts` 영역 8 endpoint 추가:

| Method | Path | 영역 |
|---|---|---|
| GET | `/api/ai/operator/journeys` | 회사 활성/대기 여정 목록 + 통계 |
| POST | `/api/ai/operator/journeys` | 신규 여정 생성 (template_code or 자연어) |
| GET | `/api/ai/operator/journeys/:id` | 상세 (steps + 통계) |
| POST | `/api/ai/operator/journeys/:id/activate` | 활성화 (confirm) |
| POST | `/api/ai/operator/journeys/:id/pause` | 일시정지 |
| POST | `/api/ai/operator/journeys/:id/end` | 종료 |
| GET | `/api/ai/operator/journeys/:id/executions` | 고객별 실행 상태 페이지네이션 |
| GET | `/api/ai/operator/journeys/:id/stats` | 통계 (진입/완료/비용/step별 전환율) |

영구 룰 정합:
- `ai_operator_user_gating` (AI_OPERATOR_ALLOWED_USERS=hoyun)
- BUSINESS+ plan-guard 정합

---

## 5. Step 1-C: frontend (예상 4~6h)

### 5-1. /ai-journeys 페이지
- 7 템플릿 카드 그리드 (가입/재구매/휴면/장바구니/생일/예약/Custom)
- 신규 여정 생성 모달:
  - 템플릿 선택 → 자연어 보정 (선택) → step 미리보기 → 활성화 confirm
  - 4 임계값 + 예산 안내
- 활성 여정 목록 (상태 뱃지 / step 진행률 / 통계)
- 일시정지 / 종료 / 재개 버튼
- 상세 페이지 (step 흐름 시각화 + 고객별 실행 상태 + 전환율 차트)
- 모바일 정합 (D186 패턴 동일)

### 5-2. AiOperatorPage SUB_MODULE_CARDS 추가
- 기존 8건 → "Journey 여정" 카드 1건 추가 = 9건 + Custom 자연어

### 5-3. App.tsx 라우트 등록
- `/ai-journeys` 라우트 + PrivateRoute + JourneyPage import

---

## 6. 영구 룰 정합 매트릭스

| 룰 | 정합 매트릭스 |
|---|---|
| `ai_operator_model_isolation` | journey-builder.ts model:'opus' 명시 (Sonnet 4.6 흐름 영향 0) |
| `no_target_auto_relax` | step 발송 0건 = 차단 (자동 완화 X) |
| `no_future_roadmap_user_exposure` | UI에 D-시리즈 / Coming Soon X |
| `ai_operator_user_gating` | AI_OPERATOR_ALLOWED_USERS=hoyun 게이팅 |
| 사용자 동의 흐름 | 활성화 시 명시 동의 + 회사 자유 임계값 (NULL=무제한 default) + 광고 검증 4건 통과 시 자동 실행 (광고/비광고 둘 다 정합). 1건이라도 초과/실패 = 자동 일시정지 + 사용자 알람 |
| 광고 자동 검증 4건 | ① (광고) prefix 자동 부착 (messageUtils) ② 무료거부 080 자동 부착 ③ 발송 시간 08:00~21:00 KST ④ KISA 제목 영역 |
| 예산 한도 | journeys.budget_monthly + 누적 cost 추적 (NULL = 무제한) |
| `no_pm2_delete_before_git_push` | pm2 reload 영역 (atomic) |
| `no_humuson_keyword_exposure` | UI/주석 휴머스온 단어 0건 |
| `no_bakkeum_usage` | 코드/주석 박음/박힘 단어 0건 (작업 직후 자가 grep 검증) |

---

## 7. 작업 완료 본질

- backend tsc 0 errors
- frontend tsc 0 errors
- 영구 룰 정합 매트릭스 검증
- Harold 동의 → tp-push (통합 명령어 본 .md 종결 시 안내)
- **본 D187_journey_builder_lite_plan.md 파일 삭제** (Harold 명시 정합)

---

## 8. 통합 push 명령어 (작업 완료 후)

```
tp-push "D187 Journey Builder Lite Step 1 종결 — 7 표준 여정 (가입/재구매/휴면/장바구니/생일/예약/Custom) + DB 4 테이블 (journeys/steps/executions/step_logs) + utils CT-43 journey-builder + CT-44 journey-executor + journey-trigger-watcher (5분 cron) + routes 8 endpoint + /ai-journeys 페이지 + AiOperatorPage SUB_MODULE_CARDS 추가 + AI_OPERATOR_ALLOWED_USERS=hoyun 게이팅 + 4 임계값 안전망 + 회사 자유 예산 + 여정별 재진입 default + 영구 룰 정합 매트릭스 검증"
```

운영 빌드 명령어 = 동일 (이전 답변 참조).

---

> **본 .md 파일은 작업 완료 후 삭제** — 진행 계획 임시 문서. 최종 매트릭스는 `status/ai_operator_progress.md` + `docs/AI_OPERATOR_기능정의서.md` v1.1.x에 기록합니다.
