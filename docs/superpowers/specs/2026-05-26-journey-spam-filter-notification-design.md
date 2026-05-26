# D218+ AI Operator 여정 자동화 안전 강화 — 설계 문서

> **작성일**: 2026-05-26
> **세션**: D218+ brainstorming 종결 → writing-plans → executing-plans
> **목적**: 여정 자동화에 스팸필터테스트 + 발송 전 담당자 알림 + 즉시 정지 + 결과 알림 통합. Braze Canvas 압도 차별화 본질.
> **Harold 명시**: "가장 완벽 + 쉬운 + 편리 AI 오퍼레이션" + "발송 전 알림 + 스팸필터테스트 = 신뢰 + 결과 가장 중요"

---

## 1. 배경 + 목적

### 옛 사고 영역

- 옛 자동발송 = 단발성 1회 발송 + 발송 2시간 전 담당자 알림 + 발송 직후 결과 알림 패턴 존재
- 옛 여정 자동화 = 자연어 1줄 → step 6 자동 생성 → 활성화 → 자동 발송 흐름
- **사고**: 여정 자동화에 스팸필터테스트 자체 X + 담당자 사전 알림 X + 즉시 정지 X + 결과 알림 X
- Harold 명시 사고: 문안 생성 시점 동시 스팸필터 = 5분+ = 사용자 피로

### 본 작업 목적

옛 자동발송 안전 패턴을 여정 자동화에 통합 + Braze Canvas 압도 차별화:

1. 활성화 시점 자동 스팸필터테스트 + 통과 시만 활성화
2. 발송 2시간 전 담당자 LMS 자동 발송 + 즉시 정지 단축 URL
3. 발송 실패 사유별 분기 + 자동 재시도 1회
4. 발송 직후 결과 알림 + 7일 검증 + AI 학습
5. 정지 이력 기록 보존 + Harold/admin 직접 분석 UI

---

## 2. 의문 11건 + Harold 확정 default

### 옛 의문 3건 (default 인정)

| # | 의문 | default |
|---|------|---------|
| 1 | 비용 차감 | step별 차감 + ConfirmModal 명시 동의 (옛 D212+ 정합) |
| 2 | 담당자 phone 매핑 | `kakao_alarm_users` 활용 (신규 테이블 X) |
| 3 | 담당자 피로도 안전망 | 첫/마지막 step default ON / 중간 OFF + step별 토글 |

### 신규 의문 8건 (Harold 동의)

| # | 의문 | 확정 |
|---|------|------|
| 4 | 스팸필터 통과 X step | AI 자동 재생성 1 클릭 (placeholder 유지) |
| 5 | 활성화 후 step 변경 | lock + 일시 정지 → 편집 → 재활성화 (재검증 자동) |
| 6 | 단축 URL 즉시 정지 | 페이지 진입 + 확인 버튼 1 클릭 + 정지 이력 기록 보존 |
| 7 | 발송 직후 결과 알림 | step별 default (첫/마지막 ON / 중간 OFF) + 7일 검증 누적 |
| 8 | 발송 실패 분기 | 잔액 X = 정지 / 통신사 일시 fail = 5분 후 1회 재시도 / phone 무효 = fail |
| 9 | variant 검증 | 모든 variant 별도 스팸필터 검증 (안전 우선) |
| 10 | 비용 표시 기간 | 7일 누적 예상 비용 (과거 7일 트리거 패턴 기반) |
| 11 | 카카오 채널 검증 | 카카오 = 변수 + placeholder 검증만 / SMS·LMS·MMS = 스팸필터 + 변수 + placeholder |

---

## 3. 아키텍처 (Architecture)

### 4 핵심 분류

**1) 활성화 시점 자동 검증** (`journey-pretest-validator.ts` 신설)
- CT-64 `continuous-operator-policy.ts` 통합 강화
- 모든 step + variant 본문 일제 자동 검증 (5~10초)
- 채널별 분기 — 카카오 = placeholder + 변수 / SMS/LMS/MMS = + 스팸필터 (3 단)
- 통과 X step = 활성화 차단 + AI 자동 재생성 1 클릭 진입
- 비용 합산 + 7일 누적 예상 + 회사 잔액 확인 + ConfirmModal

**2) 발송 2시간 전 담당자 자동 알림** (`journey-pretest-notifier.ts` 신설)
- 옛 `auto-campaign-worker.ts` D-1 알림 패턴
- 5분 cron worker = step 발송 시점 2시간 전 도달 시 자동 발송
- 담당자 phone 매핑 = `kakao_alarm_users` 첫 활성 수신자
- LMS = 치환된 본문 + 발송 예정시각 + 타겟 수 + 즉시 정지 단축 URL
- step별 default (첫/마지막 ON / 중간 OFF)

**3) 즉시 정지 페이지 + 기록 보존** (`/journey-pause/:token`)
- 단축 URL = 정지 페이지 진입 (인증 X)
- 페이지 = 여정명 + step 명 + 발송 예정시각 + 타겟 수 + 본문 미리보기 (치환됨)
- "이 발송 정지" 확인 1 클릭 → 정지 API 호출 + 기록 보존
- 신규 테이블 `journey_step_pause_logs` — 누가 / 언제 / 어느 step / 사유 / 본문 + 타겟 수
- `JourneysPage` 안 "정지 이력" 탭 — Harold + admin 직접 분석

**4) 발송 실패 사유별 분기 + 자동 재시도** (`journey-executor.ts` 강화)
- 잔액 X = 정지 + `kakao_alarm_users` 담당자 충전 안내 SMS + 기록 보존
- 통신사 일시 fail = 5분 후 자동 재시도 1회 → 또 fail = 정지
- phone 무효 = fail 처리 (재시도 X) + 통계 누적

### 신뢰 + 결과 보장 5 영역

**A. 본문 snapshot 보존** (`journey_step_snapshots` 신규 테이블)
- 활성화 시점 = 모든 step + variant 본문 + 변수 치환 매핑 snapshot 저장
- 담당자 사전 알림 본문 = snapshot 사용 → 사전 본문과 실 발송 본문 100% 동일
- 실 발송 시점 = `processExecution`이 snapshot 우선 조회

**B. 스팸필터테스트 결과 정밀 분리** (`spam-test-queue.ts` CT-09 강화)
- 결과 = 통신사 4종 분리 (SKT / KT / LG U+ / MVNO)
- 통신사별 통과율 + 매칭된 stop word + 사유 표시
- 전체 통신사 통과 시만 활성화 OK
- 신뢰도 점수 0~100 표시 + 80 이하 = "재생성 권장" 경고

**C. 타겟 수 실시간** (`customer-filter.ts` CT-01 활용)
- 활성화 / 사전 알림 / 실 발송 3 시점 실시간 재조회
- 차이 표시 (수신거부 + 신규 가입 반영)

**D. 즉시 정지 race condition 안전망**
- 정지 클릭 → `journey_executions.status='paused'` UPDATE 트랜잭션
- `processExecution` 진입 직전 + 발송 직전 = status 재확인 (DB row lock)
- 정지 직후 → MySQL SMSQ_SEND 큐 INSERT cancel fallback
- 정지 후 발송 잠재 시 = `execution_status_at_pause` 기록

**E. 결과 알림 정밀** (옛 D135+ msg_result_YYYYMM 활용)
- 발송 직후 30분 ~ 1시간 = `campaign-sync-worker.ts` 통신사 reply 수집
- 결과 = 성공/실패/대기 + 통신사 사유 명시 (불특정 다수 / 광고 차단 / 수신 거부 / 단말기 X / 통신망 일시 X)
- 7일 검증 = 누적 KPI + `ai_company_memory` 자동 학습 (옛 D181)

---

## 4. 컴포넌트 (Components)

### Backend (`packages/backend/src`)

**신규 컨트롤타워 3건**
1. **CT-92 `journey-pretest-validator.ts`** — 활성화 시점 자동 검증
   - `validateJourneyForActivation(journeyId, companyId)` — 모든 step + variant 일제 검증
   - 채널별 분기 (카카오 = placeholder + 변수 / SMS·LMS·MMS = + 스팸필터)
   - 반환 = `{ ok, failedSteps[], totalCost, estimatedWeeklyTriggerCount, confidenceScore }`

2. **CT-93 `journey-pretest-notifier.ts`** — 2시간 전 알림
   - `scheduleNotificationsForActivation(journeyId)` — 다음 7일 트리거 예측 + 알림 스케줄
   - `sendPretestNotification(stepId, executionId)` — 실제 발송 (담당자 phone + 본문 + 단축 URL)
   - 5분 cron worker (`journey_pretest_schedules` polling)

3. **CT-94 `journey-pause-handler.ts`** — 즉시 정지
   - `generatePauseToken(stepId, executionId, companyId, reason)` — 단축 URL token 발급 (24h TTL)
   - `verifyPauseToken(token)` — token 검증 + step 정보 반환
   - `executePause(token, pauseReason)` — 정지 API + `journey_step_pause_logs` 기록
   - `getPauseLogs(companyId, journeyId?)` — 이력 조회 (admin UI 활용)

**옛 영역 강화**
- CT-64 `continuous-operator-policy.ts` — `validateJourneyForActivation` 통합
- CT-09 `spam-test-queue.ts` — 통신사 4종 분리 + 신뢰도 점수
- `journey-executor.ts` — snapshot 사용 + status 3 시점 재확인 + 실패 분기 + 자동 재시도 1회
- `journey-builder.ts` — 활성화 후 lock 검증 + `journeys.status='paused'` 추가

**신규 endpoint 6건**
- POST `/api/ai/operator/journeys/:id/pretest-validate`
- POST `/api/ai/operator/journeys/:id/activate`
- POST `/api/ai/operator/journeys/:id/pause` / `/:id/resume`
- GET `/api/ai/operator/journeys/:id/pause-logs`
- GET / POST `/journey-pause/:token` (Public, 인증 X)

### Frontend (`packages/frontend/src`)

**신규 컴포넌트 4건** (옛 D215+ design_quality 표준)

1. **`components/journey/JourneyActivationConfirmModal.tsx`**
   - 검증 진행 시각 효과 (6 sub-agent 진행 카드)
   - 통과 X step = "AI 자동 재생성" 1 클릭
   - 통과 시 = 비용 합산 + 7일 누적 + 회사 잔액 + ConfirmModal

2. **`components/journey/JourneyPauseLogsModal.tsx`**
   - 여정별 정지 이력 표시 (담당자 phone / 시각 / 사유 / 본문 + 타겟 수)
   - 검색 + 필터 (사유별) + 정렬 (시각 desc)
   - 다크 톤 + Source caption

3. **`components/journey/JourneyStepNotifyToggle.tsx`**
   - step별 담당자 알림 ON/OFF 토글 (default 첫/마지막 ON)

4. **`pages/JourneyPausePage.tsx`** (Public — `/journey-pause/:token`)
   - 인증 X 진입
   - 여정명 + step 명 + 발송 예정시각 + 타겟 수 + 본문 미리보기 (치환)
   - "이 발송 정지" 확인 1 클릭 → 정지 + Toast 안내

**옛 강화**
- `JourneysPage.tsx` — 활성화 버튼 = `JourneyActivationConfirmModal` 진입 + "정지 이력" 탭 신규
- `JourneyStepEditor` — 1-click "스팸필터테스트" 버튼 (수동 재검증)

### DB 신규

**신규 테이블 3건**

```sql
-- 1. 활성화 시점 본문 + 변수 매핑 보존
CREATE TABLE journey_step_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  step_id uuid NOT NULL,
  variant_id uuid,
  message_body text NOT NULL,
  message_subject varchar(40),
  variable_map JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel varchar(20) NOT NULL,
  is_ad BOOLEAN NOT NULL DEFAULT false,
  callback_number varchar(20),
  alimtalk_template_code varchar(30),
  spam_test_result JSONB,
  confidence_score smallint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jss_journey_step ON journey_step_snapshots(journey_id, step_id);
CREATE INDEX idx_jss_company ON journey_step_snapshots(company_id);

-- 2. 2시간 전 알림 스케줄
CREATE TABLE journey_pretest_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  step_id uuid NOT NULL,
  execution_id uuid,
  scheduled_send_at timestamptz NOT NULL,
  notify_at timestamptz NOT NULL,
  notified_at timestamptz,
  status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jps_notify_pending ON journey_pretest_schedules(notify_at, status) WHERE status = 'pending';

-- 3. 정지 이력 기록 보존
CREATE TABLE journey_step_pause_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  step_id uuid NOT NULL,
  execution_id uuid,
  snapshot_id uuid REFERENCES journey_step_snapshots(id),
  pause_reason varchar(40) NOT NULL,
  pause_trigger_source varchar(30),
  paused_at timestamptz NOT NULL DEFAULT now(),
  paused_phone varchar(20),
  message_body_snapshot text,
  target_count_snapshot int,
  execution_status_at_pause varchar(20),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_jspl_company_journey ON journey_step_pause_logs(company_id, journey_id);
CREATE INDEX idx_jspl_paused_at ON journey_step_pause_logs(paused_at DESC);
```

**옛 테이블 ALTER**

```sql
ALTER TABLE journeys
  ADD COLUMN pretest_notify_step_defaults JSONB DEFAULT '{}'::jsonb;

ALTER TABLE journey_steps
  ADD COLUMN notify_manager_on_pretest BOOLEAN DEFAULT NULL;

ALTER TABLE journey_executions
  ADD COLUMN error_log JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN error_count int DEFAULT 0;

-- journeys.status enum 'paused' 추가 (옛 enum 정합)
```

---

## 5. 데이터 흐름 (Data Flow)

### 7 단계 요약

| # | 단계 | 트리거 | 안전망 |
|---|------|--------|--------|
| 1 | 활성화 검증 | 사용자 클릭 | 채널별 분기 + 신뢰도 점수 |
| 2 | 2시간 전 알림 | 5분 cron | snapshot + 실시간 타겟 수 |
| 3 | 즉시 정지 | 담당자 클릭 | DB row lock + 기록 보존 |
| 4 | 실 발송 | 1분 cron | status 3 시점 재확인 + snapshot |
| 5 | 실패 분기 | 발송 catch | 사유별 분기 + 자동 재시도 1회 |
| 6 | 결과 알림 | 30초 cron | 통신사 사유 명시 |
| 7 | AI 학습 | 1시간 cron | ai_company_memory 누적 |

(상세 흐름은 brainstorming 세션 본문 참조)

---

## 6. 에러 처리 (Error Handling)

### 카테고리 6종

1. 활성화 검증 (AI timeout / 스팸필터 fail / 잔액 부족 / kakao_alarm_users 0건)
2. 2시간 전 알림 worker (snapshot 조회 실패 / phone fallback fail / LMS 큐 fail / token 발급 실패)
3. 즉시 정지 페이지 (token 검증 실패 / row lock 충돌 / cancel 실패)
4. 실 발송 worker (snapshot 손상 / CT-01 일시 X / race condition / MySQL 큐 실패)
5. 결과 알림 worker (msg_result 조회 실패 / LMS 발송 실패 / reply 누락)
6. 7일 학습 worker (ai_company_memory 실패 / AI timeout / Bandit reward 실패)

### 자동 재시도 정책

| 에러 | 재시도 |
|------|--------|
| 통신사 일시 fail | 5분 후 1회 |
| DB 일시 X | 30초 후 1회 |
| AI 호출 timeout | 60초 backoff 후 1회 |
| MySQL deadlock | 즉시 1회 |

### Graceful Degradation

- AI 학습 worker 실패 = 발송 영향 X (학습 skip + 다음 cron 재시도)
- 정지 token 발급 실패 = LMS 발송 진행 (단축 URL 없는 본문 + 슈퍼관리자 알람)
- snapshot 손상 (rare) = step 본문 fallback + 슈퍼관리자 즉시 알람

---

## 7. 테스트 (Testing)

### 6 분류

1. Unit Test — 각 CT 단위 (CT-92 / CT-93 / CT-94 / 옛 CT-64/CT-09/CT-01 강화)
2. Integration Test — 5 핵심 흐름 (활성화 / 알림 / 정지 / 발송 / 결과 + 학습)
3. E2E Test — 자연어 → 활성화 → 정지 → 재활성화 + 자연어 → 결과 알림 → AI 학습
4. Stress Test — 동시 활성화 100건 / 정지 race / schedule 1000건+ / MySQL 큐 부하
5. Edge Case Test — snapshot 손상 / token 만료 / 잔액 직전 충전 / race condition / reply 누락 / kakao_alarm_users 0건 / 카카오 + LMS 부달 동시
6. Manual Test — Harold + 직원 직접 (옛 `no_operation_verification_by_ai` 영구 룰)

---

## 8. 개발 순서 (Phase 매핑)

| Phase | 분류 | 분량 | 본 세션 |
|-------|------|------|---------|
| 1 | DB 인프라 + CT 신규 3건 | 3~4h | ✓ 진행 |
| 2 | Backend 흐름 통합 + endpoint 6건 | 3~4h | ✓ 진행 |
| 3 | Worker 3건 신규 + 강화 | 2~3h | ✓ 진행 |
| 4 | Frontend 컴포넌트 4건 신규 + 강화 | 4~5h | 다음 세션 |
| 5 | 자가 검증 (tsc + grep + Unit Test) | 1~2h | 본 세션 Phase 3 종결 후 |
| 6 | Harold 직접 배포 + 운영 검증 | 별도 | Harold 진행 |
| 7 | 룰 추가 + 메모리 갱신 | 종결 직후 | 배포 종결 후 |

**본 세션 총 분량**: Phase 1+2+3+5 = 9~13h

---

## 9. Braze Canvas 압도 차별화 표

| 영역 | Braze Canvas | 한줄로 D218+ |
|------|--------------|---------------|
| 활성화 검증 | step 활성화 직전 1 step 검증 | 모든 step + variant 일제 자동 검증 |
| 담당자 사전 알림 | X (직접 발송) | 발송 2시간 전 자동 LMS + 본문 미리보기 + 1-click 정지 |
| 발송 실패 분기 | 단일 fail 처리 | 사유별 분기 (잔액/통신사/phone 무효) |
| 정지 이력 기록 | 기본 로그 | 기록 보존 + admin 직접 분석 UI |
| placeholder 안전망 | X | AI 임의 혜택 X 영구 룰 + placeholder 잔존 차단 |

---

## 10. 영구 룰 정합 매트릭스

- `cto_mandate_for_vito` — CTO 사명감 + 영구 원칙 정합 + 정합성 100%
- `marketing_user_ux_priority` — 사용자 클릭 수 2회 (활성화 + 확인)
- `ai_no_arbitrary_benefit` — AI 임의 혜택 생성 X + placeholder 잔존 차단
- `no_target_auto_relax` — 0건 타겟 자동완화 X
- `no_native_browser_dialog` — ConfirmModal + Toast 활용
- `design_quality_minimum_journey_level` — 다크 톤 + Source caption + 모바일 반응형
- `no_operation_verification_by_ai` — Manual Test = Harold + 직원 직접
- `no_bakkeum_usage § D218+` — "진정" 단어 자기 강화 루프 사고 차단
- `feedback_no_preview_verification` — preview MCP 도구 X
- `feedback_default_superpowers_workflow` — brainstorming → writing-plans → executing-plans 흐름

---

## 11. 변경 이력

- 2026-05-26: brainstorming 종결 + 설계 문서 작성 (의문 11건 + 5 섹션 + Phase 매핑 7 Phase)
