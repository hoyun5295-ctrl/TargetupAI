# 여정 일반화 구현 Plan — start_kind + SP-A(알림톡 템플릿 우선) + SP-B(날짜축)

> **For agentic workers:** TDD(RED→GREEN→REFACTOR). 순수 함수 먼저 verify, 그 다음 엔진 배선. ALTER 추가만(Harold 실행). 발송 6원칙·정보통신망법·회사 격리·no_target_auto_relax 불변.

**Goal:** 여정 진입을 `start_kind`(event/standing/date_anchor/one_shot) 1급 축으로 일반화 + 알림톡 템플릿 우선 빌더 + 지정일 D-N 날짜축 여정.

**Architecture:** 기존 여정 엔진(트리거 추출·묶음발송·멱등차감·안전필터·executor) 그대로 재사용. start_kind는 journeys 신규 컬럼(default 'event' = 회귀 0). date_anchor/one_shot은 별도 진입 경로(anchor-scheduler / one-shot dispatch)가 단발 execution을 만들고 기존 executor가 발송. executor에 단발 분기 1개만 추가(event/standing 경로 byte 불변).

**실측 확정(2026-06-30):** journey_steps 21컬럼(알림톡 컬럼 전부 실재). 운영 여정 row 0(backfill 불요). points_expiring 여정 0건(흡수 마이그레이션 불요·코드 일반화만).

---

## ALTER (Harold 실행 — 추가만)

```sql
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS start_kind varchar(20) NOT NULL DEFAULT 'event';
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS anchor_date date;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS anchor_recurrence varchar(20) NOT NULL DEFAULT 'none';
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS anchor_recurrence_day integer;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS anchor_hour_kst integer;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS one_shot_scheduled_at timestamptz;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS anchor_offset_days integer;
CREATE TABLE IF NOT EXISTS journey_anchor_dispatch (
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES journey_steps(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  send_date date NOT NULL,
  campaign_id uuid,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (journey_id, step_id, customer_id, send_date)
);
CREATE INDEX IF NOT EXISTS idx_journeys_start_kind_status ON journeys(start_kind, status);
```

---

## Phase 0 — 기반 순수 CT (TDD 먼저)

### Task 0-1: journey-start-kind.ts (신규 순수 CT)
- `START_KINDS = ['event','standing','date_anchor','one_shot']`
- `isValidStartKind(x): boolean`
- `classifyStartKind(triggerEvent, opts?): StartKind` — 마이그레이션/default: custom→standing, customer.points_expiring(annual_date)→date_anchor, 그 외→event
- `isWatcherDriven(startKind): boolean` — event/standing만 true(watcher 처리), date_anchor/one_shot false
- `isSingleStepKind(startKind): boolean` — date_anchor/one_shot true(executor 단발 완료)
- verify: `__tests__/journey-start-kind.verify.ts`

### Task 0-2: send-time-util.ts 앵커 순수 함수 추가
- `computeAnchorStepRunAt(anchorDate: Date, offsetDays, hourKst, now)` — (anchor − offset일) HH시 KST + shiftToSendableHour. 과거면 그대로 반환(스케줄러가 날짜 일치로 거름).
- `computeNextAnchor(recurrence, recurrenceDay, current: Date): Date|null` — none→null, monthly_day→다음 달 N일, monthly_last→다음 달 말일, yearly→내년 같은 날
- `isAnchorCycleComplete(steps offsets, anchorDate, now): boolean` — 최소 offset(D-0) 발송일이 오늘 지났는가
- verify: `__tests__/journey-anchor-time.verify.ts`

---

## Phase A — SP-A 알림톡 템플릿 우선

### Task A-1: 타입·빌더 start_kind 수용 (journey-builder.ts)
- CreateJourneyInput에 `startKind?`, `anchorDate?`, `anchorRecurrence?`, `anchorRecurrenceDay?`, `anchorHourKst?`, `oneShotScheduledAt?`, step에 `anchorOffsetDays?`
- journeys INSERT에 start_kind + anchor 컬럼 추가. step INSERT에 anchor_offset_days 추가.
- activateJourney: date_anchor면 anchor_date 필수·step마다 anchor_offset_days 검증. one_shot면 단발(step 1개) 검증.

### Task A-2: 라우트 (ai.ts POST /operator/journeys)
- body에서 startKind·anchor·oneShotScheduledAt·steps[].anchorOffsetDays 받아 createJourneyFromTemplate에 전달.
- one_shot 활성 시 dispatchOneShotJourney 호출(단발 execution enqueue).

### Task A-3: watcher 필터 (journey-trigger-watcher.ts)
- active 조회에 `AND COALESCE(start_kind,'event') IN ('event','standing')` — date_anchor/one_shot 제외.

### Task A-4: InfoAlertJourneyBuilder.tsx 재작성 (템플릿 우선 → 시작 방식 → 대상)
- 1단 어떤 알림톡(AlimtalkChannelPanel) → 2단 시작 방식(event/one_shot/standing) → 3단 대상(이벤트일 때 거래이벤트+조건 / segment일 때 조건). 변수 가용 범위 화면 명시.
- onBuild 결과에 startKind + (event) triggerEvent + (one_shot) 즉시/예약 + 조건.
- 다크 톤·모바일·native dialog 0·모델명 0.

### Task A-5: JourneysPage.tsx 결과 조립 (handleInfoAlertBuild)
- startKind·anchor·schedule를 AIJourneyPackage→저장 payload에 반영.

---

## Phase B — SP-B 날짜축 date_anchor

### Task B-1: journey-anchor-scheduler.ts (신규 워커, 일 1회+매시 점검)
- 활성 date_anchor 여정 전수. 각 step: send_date = anchor_date − offset. 오늘(KST)==send_date && target hour 도래 시:
  - 대상 추출 = selectJourneyTargetCustomerIds(audience) + 안전필터. 0건 침묵.
  - journey_anchor_dispatch ON CONFLICT DO NOTHING RETURNING → 신규분만 단발 execution INSERT(current_step_order=step_order−1, next_run_at=computeAnchorStepRunAt).
- 라이프사이클: D-0 dispatch 후 none→pause(재지정 재가동) / recurrence→anchor_date=computeNextAnchor.
- 대량 차단(threshold) 적용.

### Task B-2: executor 단발 분기 (journey-executor.ts)
- dueRes에 j.start_kind 추가. advanceOrComplete: start_kind in (date_anchor,one_shot)면 다음 step 진입 X = markCompleted. one_shot 완료 시 잔여 active execution 0이면 journey ended.

### Task B-3: one_shot dispatch (journey-builder.ts 또는 신규)
- dispatchOneShotJourney: audience 추출 + 단발 execution enqueue(즉시=shiftToSendableHour(now) / 예약=one_shot_scheduled_at).

### Task B-4: points annual_date 흡수 표기 (journey-points-trigger.ts 주석 + 빌더 매핑)
- annual_date를 date_anchor 빌더로 유도(코드 일반화). inactivity는 event/standing 유지.

### Task B-5: 날짜축 빌더 UI (DateAnchorJourneyBuilder.tsx 신규 + JourneysPage 진입)
- ① anchor_date+반복 → ② D-N step(offset 7/3/1/0 + 채널/알림톡 + 시각) → ③ 대상 → ④ 검토. 정지→재지정→재가동 상태 표시.

### Task B-6: app.ts 워커 기동
- startJourneyAnchorScheduler() 추가(378 옆).

---

## 검증
- pure: journey-start-kind / journey-anchor-time verify
- backend tsc 0 / frontend tsc 0 / vitest 통과
- 자가 grep: 모델명 0 · native dialog 0 · 박-단어 0
- 회귀: 기존 event/standing 경로 executor·watcher byte 불변(start_kind default 'event')
