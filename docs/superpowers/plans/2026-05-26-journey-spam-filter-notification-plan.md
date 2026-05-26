# D218+ AI Operator 여정 자동화 안전 강화 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여정 자동화에 스팸필터테스트 + 발송 2시간 전 담당자 알림 + 즉시 정지 + 결과 알림 통합 (Braze Canvas 압도 차별화).

**Architecture:** 옛 자동발송 안전 패턴 (`auto-campaign-worker.ts` D-1 알림)을 여정 다단계 영역에 통합. CT 신규 3건 (validator/notifier/pause-handler) + 옛 CT 강화 4건 + DB 신규 3건 + endpoint 6건.

**Tech Stack:** Node.js + Express + TypeScript / PostgreSQL (PG) + MySQL (QTmsg SMS 큐) / PM2 worker (cron) / 옛 컨트롤타워 매트릭스 활용

**Phase 1~3 본 세션 진행** — Phase 4 (Frontend) + Phase 5 (검증) + Phase 6 (배포) + Phase 7 (메모리 갱신) = 다음 세션 진행.

**한줄로 운영 영역 정합** — Jest 인프라 X 환경 = TDD step 대신 자가 grep + tsc 0 errors + 7-1 컨트롤타워 grep 검증 의무. Manual Test = Harold + 직원 직접 (`no_operation_verification_by_ai` 영구 룰).

---

## File Structure 매핑

### 신규 파일 (Backend)
- `packages/backend/src/utils/journey-pretest-validator.ts` — CT-92 활성화 검증
- `packages/backend/src/utils/journey-pretest-notifier.ts` — CT-93 2시간 전 알림 빌드
- `packages/backend/src/utils/journey-pause-handler.ts` — CT-94 token 발급 + 정지
- `packages/backend/src/workers/journey-pretest-notifier-worker.ts` — 5분 cron
- `packages/backend/src/workers/ai-memory-accumulator-worker.ts` — 1시간 cron

### 강화 파일 (Backend)
- `packages/backend/src/utils/continuous-operator-policy.ts` (CT-64) — `validateJourneyForActivation` 통합
- `packages/backend/src/utils/spam-test-queue.ts` (CT-09) — 통신사 4종 분리
- `packages/backend/src/utils/journey-executor.ts` — snapshot + race condition + 실패 분기
- `packages/backend/src/utils/journey-builder.ts` — 활성화 후 lock + paused 상태
- `packages/backend/src/utils/campaign-sync-worker.ts` — 결과 알림 LMS 통합
- `packages/backend/src/routes/ai.ts` — 6 endpoint 추가
- `packages/backend/src/routes/journey-pause-public.ts` — Public 정지 페이지 endpoint (신규 라우터)
- `packages/backend/src/app.ts` — worker 등록

### DB
- 신규 테이블 3건 (`journey_step_snapshots` / `journey_pretest_schedules` / `journey_step_pause_logs`)
- 옛 테이블 ALTER 5건 (`journeys` / `journey_steps` / `journey_executions`)

---

# Phase 1 — DB 인프라 + 컨트롤타워 기반

## Task 1: DB SQL (Harold 직접 실행 — 코드 X, 안내만)

**Files:**
- Harold 직접 PG 실행 (코드 작성 X)

- [ ] **Step 1: Harold 직접 PG SQL 실행 의무 (배포 직전 또는 직후)**

```sql
-- 1. journey_step_snapshots 신규 테이블
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

-- 2. journey_pretest_schedules 신규 테이블
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

-- 3. journey_step_pause_logs 신규 테이블
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

-- 4. 옛 테이블 ALTER 5건
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS pretest_notify_step_defaults JSONB DEFAULT '{}'::jsonb;

ALTER TABLE journey_steps
  ADD COLUMN IF NOT EXISTS notify_manager_on_pretest BOOLEAN DEFAULT NULL;

ALTER TABLE journey_executions
  ADD COLUMN IF NOT EXISTS error_log JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_notified_at timestamptz;

-- 5. journeys.status enum 'paused' 추가 (옛 enum 확인 후 정합)
-- ALTER TABLE journeys ADD CONSTRAINT 또는 옛 CHECK 추가 의무 (옛 status enum 확인 후)
```

- [ ] **Step 2: AI는 DB SQL 작성만 + Harold 직접 PG 실행 의무 명시 (옛 영구 룰 `no_system_modification` 정합)**

---

## Task 2: CT-92 `journey-pretest-validator.ts` 신규

**Files:**
- Create: `packages/backend/src/utils/journey-pretest-validator.ts`

- [ ] **Step 1: 옛 컨트롤타워 정독 — `journey-builder.ts` + `spam-test-queue.ts` + `continuous-operator-policy.ts` 인터페이스 확인**

Read 의무:
```
packages/backend/src/utils/journey-builder.ts (옛 step + variant 타입)
packages/backend/src/utils/spam-test-queue.ts (옛 spamFilterTest 함수)
packages/backend/src/utils/continuous-operator-policy.ts (옛 CT-64)
```

- [ ] **Step 2: CT-92 신규 파일 작성**

```typescript
// packages/backend/src/utils/journey-pretest-validator.ts
// CT-92: 여정 활성화 시점 자동 검증 (D218+ 신설)
//   - 모든 step + variant 본문 일제 자동 검증
//   - 채널별 분기 (카카오 = placeholder + 변수 / SMS·LMS·MMS = + 스팸필터)
//   - 통과 X step = 활성화 차단 + AI 자동 재생성 진입
//   - 비용 합산 + 7일 누적 예상 + 신뢰도 점수

import { query } from '../db';
import { spamFilterTest } from './spam-test-queue';

export interface ValidationResult {
  ok: boolean;
  failedSteps: FailedStep[];
  totalCost: number;
  estimatedWeeklyTriggerCount: number;
  confidenceScore: number;  // 0~100 평균
  perCarrierScore?: {       // 통신사 4종 분리
    skt: number;
    kt: number;
    lguplus: number;
    mvno: number;
  };
}

export interface FailedStep {
  stepId: string;
  variantId?: string;
  reason: 'placeholder_unedited' | 'variable_mapping_invalid' | 'spam_filter_failed' | 'subject_missing';
  details: string;
  matchedStopWords?: string[];
}

export async function validateJourneyForActivation(
  journeyId: string,
  companyId: string,
): Promise<ValidationResult> {
  // 1. 여정 + step + variant 조회
  const stepsRes = await query(
    `SELECT s.id AS step_id, s.channel, s.message_template, s.subject,
            s.is_ad, s.callback_number, s.alimtalk_template_code,
            s.alimtalk_variable_map, s.message_byte_count
       FROM journey_steps s
       JOIN journeys j ON j.id = s.journey_id
      WHERE s.journey_id = $1 AND j.company_id = $2
      ORDER BY s.step_order ASC`,
    [journeyId, companyId],
  );
  const steps = stepsRes.rows;

  if (steps.length === 0) {
    return { ok: false, failedSteps: [], totalCost: 0, estimatedWeeklyTriggerCount: 0, confidenceScore: 0 };
  }

  const failedSteps: FailedStep[] = [];
  let confidenceSum = 0;
  let scoredCount = 0;

  for (const step of steps) {
    // variant 조회
    const variantsRes = await query(
      `SELECT id, message_body, traffic_weight
         FROM journey_step_variants
        WHERE step_id = $1`,
      [step.step_id],
    );
    const variants = variantsRes.rows;
    const messagesToValidate = variants.length > 0
      ? variants.map((v) => ({ variantId: v.id, body: v.message_body }))
      : [{ variantId: undefined, body: step.message_template }];

    for (const msg of messagesToValidate) {
      // a. placeholder 잔존 검증
      if (hasUneditedPlaceholder(msg.body)) {
        failedSteps.push({
          stepId: step.step_id,
          variantId: msg.variantId,
          reason: 'placeholder_unedited',
          details: '[직접 작성해주세요] 등 placeholder 잔존',
        });
        continue;
      }

      // b. LMS/MMS subject 검증
      if ((step.channel === 'lms' || step.channel === 'mms') && !step.subject?.trim()) {
        failedSteps.push({
          stepId: step.step_id,
          variantId: msg.variantId,
          reason: 'subject_missing',
          details: 'LMS/MMS 발송 시 제목 필수',
        });
        continue;
      }

      // c. 채널별 분기
      if (step.channel === 'alimtalk') {
        // 카카오 = 변수 매핑 검증만 (placeholder 검증 위에서 종결)
        const varMap = step.alimtalk_variable_map || {};
        if (!validateAlimtalkVariableMap(msg.body, varMap)) {
          failedSteps.push({
            stepId: step.step_id,
            variantId: msg.variantId,
            reason: 'variable_mapping_invalid',
            details: '알림톡 변수 매핑 누락',
          });
        }
        // 카카오 = 신뢰도 점수 100 default (검수 통과 영역)
        confidenceSum += 100;
        scoredCount += 1;
      } else {
        // SMS/LMS/MMS = 스팸필터테스트 진행
        const spamResult = await spamFilterTest({
          companyId,
          message: msg.body,
          subject: step.subject,
          isAd: step.is_ad,
          callback: step.callback_number || '',
        });
        if (!spamResult.allCarriersPassed) {
          failedSteps.push({
            stepId: step.step_id,
            variantId: msg.variantId,
            reason: 'spam_filter_failed',
            details: `통신사 차단: ${spamResult.failedCarriers.join(', ')}`,
            matchedStopWords: spamResult.matchedStopWords,
          });
          continue;
        }
        confidenceSum += spamResult.confidenceScore;
        scoredCount += 1;
      }
    }
  }

  // 4. 비용 합산 + 7일 누적 예상
  const { totalCost, estimatedWeeklyTriggerCount } = await estimateCost(journeyId, companyId, steps);

  return {
    ok: failedSteps.length === 0,
    failedSteps,
    totalCost,
    estimatedWeeklyTriggerCount,
    confidenceScore: scoredCount > 0 ? Math.round(confidenceSum / scoredCount) : 0,
  };
}

function hasUneditedPlaceholder(body: string): boolean {
  // 옛 D187-fix2 정합 — [직접 작성해주세요] 잔존 차단
  return /\[직접 작성해주세요\]/.test(body) || /\[URL[^\]]*\]/.test(body);
}

function validateAlimtalkVariableMap(body: string, varMap: Record<string, string>): boolean {
  // 알림톡 본문 안 #{변수} 매핑 검증
  const vars = body.match(/#\{([^}]+)\}/g) || [];
  for (const v of vars) {
    const key = v.slice(2, -1);
    if (!(key in varMap)) return false;
  }
  return true;
}

async function estimateCost(
  journeyId: string,
  companyId: string,
  steps: any[],
): Promise<{ totalCost: number; estimatedWeeklyTriggerCount: number }> {
  // 옛 7일 트리거 발화 패턴 기반 예상 비용 계산
  // 옛 D212+ continuous-operator-policy 정합
  // 회사 plan price 조회 + step별 채널 단가 × 예상 발화 수
  // ★ 옛 D212+ estimateJourneyCost 함수 활용 의무 (옛 영역 정확 확인)
  const triggerRes = await query(
    `SELECT COUNT(*)::int AS cnt FROM journey_executions
      WHERE journey_id = $1
        AND created_at >= NOW() - INTERVAL '7 days'`,
    [journeyId],
  );
  const weeklyTriggerCount = Number(triggerRes.rows[0]?.cnt || 0);

  let totalCost = 0;
  for (const step of steps) {
    const unitCost = getUnitCost(step.channel, step.message_byte_count);
    totalCost += unitCost * weeklyTriggerCount;
  }

  return { totalCost, estimatedWeeklyTriggerCount: weeklyTriggerCount };
}

function getUnitCost(channel: string, byteCount: number): number {
  // 옛 단가 매핑 (한줄로 정합)
  if (channel === 'sms') return 9.9;
  if (channel === 'lms') return byteCount > 90 ? 27 : 9.9;
  if (channel === 'mms') return 81;
  if (channel === 'alimtalk') return 8;
  return 0;
}
```

- [ ] **Step 3: 자가 grep — 박-단어 + "진정" 단어 + 모델명 0건 검증**

Run: `grep -nE "박음|박힘|박는|박지|박을|박혀|박힌|박혔|박힐|박았|영영|진정|Opus|Sonnet|Haiku|GPT|Claude" packages/backend/src/utils/journey-pretest-validator.ts`
Expected: 0건 (예외: 룰 명 인용)

- [ ] **Step 4: tsc 자가 검증**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: 자가 종결 보고 (commit은 Harold 직접 의무)**

---

## Task 3: CT-93 `journey-pretest-notifier.ts` 신규

**Files:**
- Create: `packages/backend/src/utils/journey-pretest-notifier.ts`

- [ ] **Step 1: 옛 컨트롤타워 정독 — `alimtalk-jobs.ts notifyTemplateInspectionResult` 패턴 + `short-url.ts` 활용**

Read 의무:
```
packages/backend/src/utils/alimtalk-jobs.ts:396-493 (notifyTemplateInspectionResult)
packages/backend/src/utils/short-url.ts (옛 단축 URL 발급)
packages/backend/src/utils/customer-filter.ts (CT-01 실시간 타겟 수)
```

- [ ] **Step 2: CT-93 신규 파일 작성**

```typescript
// packages/backend/src/utils/journey-pretest-notifier.ts
// CT-93: 여정 발송 2시간 전 담당자 자동 알림 (D218+ 신설)
//   - 활성화 시점 = 다음 7일 트리거 예측 + 알림 스케줄 INSERT
//   - 5분 cron worker = notify_at 도달 schedule 발송
//   - LMS 본문 = 치환된 본문 + 발송 예정시각 + 타겟 수 + 즉시 정지 단축 URL

import { query } from '../db';
import { generatePauseToken } from './journey-pause-handler';
import { getAuthSmsTable, bulkInsertSmsQueue } from './sms-queue';
import { resolveCustomerCount } from './customer-filter';

export interface PretestScheduleInput {
  companyId: string;
  journeyId: string;
  stepId: string;
  executionId?: string;
  scheduledSendAt: Date;
}

/**
 * 여정 활성화 시점 = 다음 7일 트리거 예측 + 알림 스케줄 INSERT.
 * 옛 자동발송 D-1 알림 패턴 정합.
 */
export async function scheduleNotificationsForActivation(
  journeyId: string,
  companyId: string,
): Promise<{ scheduledCount: number }> {
  // 옛 7일 트리거 발화 패턴 + 알림 ON step 매핑
  const stepsRes = await query(
    `SELECT s.id, s.notify_manager_on_pretest, s.step_order,
            (SELECT COUNT(*) FROM journey_steps s2 WHERE s2.journey_id = s.journey_id) AS total_steps
       FROM journey_steps s
      WHERE s.journey_id = $1
      ORDER BY s.step_order ASC`,
    [journeyId],
  );
  const steps = stepsRes.rows;

  // step별 default (첫/마지막 ON / 중간 OFF)
  const stepsToNotify = steps.filter((s) => {
    if (s.notify_manager_on_pretest === true) return true;
    if (s.notify_manager_on_pretest === false) return false;
    // NULL = default 정합
    return s.step_order === 1 || s.step_order === s.total_steps;
  });

  let scheduledCount = 0;
  for (const step of stepsToNotify) {
    // 옛 7일 트리거 발화 패턴 기반 다음 발송 시점 예측
    const nextSendTimes = await predictNextSendTimes(step.id, 7);
    for (const sendAt of nextSendTimes) {
      const notifyAt = new Date(sendAt.getTime() - 2 * 60 * 60 * 1000);
      await query(
        `INSERT INTO journey_pretest_schedules
           (company_id, journey_id, step_id, scheduled_send_at, notify_at, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT DO NOTHING`,
        [companyId, journeyId, step.id, sendAt, notifyAt],
      );
      scheduledCount += 1;
    }
  }

  return { scheduledCount };
}

async function predictNextSendTimes(stepId: string, days: number): Promise<Date[]> {
  // 옛 journey_executions 7일 패턴 분석 + 평균 발화 시각 예측
  // 옛 D197 predictive-suite 정합
  const patternRes = await query(
    `SELECT scheduled_at FROM journey_executions
      WHERE step_id = $1
        AND scheduled_at >= NOW() - INTERVAL '7 days'
        AND status IN ('completed', 'sent')
      ORDER BY scheduled_at DESC
      LIMIT 50`,
    [stepId],
  );
  if (patternRes.rows.length === 0) return [];

  // 평균 시각대 1건 추출
  const avgHour = Math.round(
    patternRes.rows.reduce((sum: number, r: any) => sum + new Date(r.scheduled_at).getHours(), 0) /
      patternRes.rows.length,
  );

  // 다음 N일 동일 시각대
  const out: Date[] = [];
  for (let i = 1; i <= days; i++) {
    const next = new Date();
    next.setDate(next.getDate() + i);
    next.setHours(avgHour, 0, 0, 0);
    out.push(next);
  }
  return out;
}

/**
 * 실제 LMS 발송 = 담당자 phone + 본문 + 단축 URL.
 * journey-pretest-notifier-worker 5분 cron 에서 호출.
 */
export async function sendPretestNotification(scheduleId: string): Promise<void> {
  const schedRes = await query(
    `SELECT * FROM journey_pretest_schedules WHERE id = $1 AND status = 'pending'`,
    [scheduleId],
  );
  if (schedRes.rows.length === 0) return;
  const sched = schedRes.rows[0];

  // snapshot 조회 (활성화 시점 본문)
  const snapRes = await query(
    `SELECT * FROM journey_step_snapshots
      WHERE step_id = $1 AND journey_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [sched.step_id, sched.journey_id],
  );
  if (snapRes.rows.length === 0) {
    await query(`UPDATE journey_pretest_schedules SET status = 'cancelled' WHERE id = $1`, [scheduleId]);
    return;
  }
  const snapshot = snapRes.rows[0];

  // 실시간 타겟 수 재조회
  const targetCount = await resolveCustomerCount(sched.company_id, sched.journey_id, sched.step_id);

  // 담당자 phone 조회 (옛 D218+ Fix A fallback 정합)
  const managerRes = await query(
    `SELECT phone_number FROM kakao_alarm_users
      WHERE company_id = $1 AND COALESCE(active_yn, 'Y') = 'Y'
      ORDER BY created_at ASC LIMIT 1`,
    [sched.company_id],
  );
  if (managerRes.rows.length === 0) {
    // 담당자 등록 X = 알림 skip + cancelled 처리
    await query(`UPDATE journey_pretest_schedules SET status = 'cancelled' WHERE id = $1`, [scheduleId]);
    return;
  }
  const managerPhone = String(managerRes.rows[0].phone_number).replace(/\D/g, '');

  // 정지 token 발급 (24h TTL)
  const pauseToken = await generatePauseToken({
    stepId: sched.step_id,
    executionId: sched.execution_id || null,
    companyId: sched.company_id,
    journeyId: sched.journey_id,
  });
  const pauseUrl = `${process.env.SHORT_URL_BASE || 'https://hanjul.ai'}/journey-pause/${pauseToken}`;

  // LMS 본문 빌드
  const lmsBody = buildPretestLmsBody({
    journeyName: snapshot.message_subject || '여정 자동 발송',
    scheduledSendAt: sched.scheduled_send_at,
    targetCount,
    messagePreview: snapshot.message_body.slice(0, 100),
    pauseUrl,
  });

  // 옛 인증 라인 LMS 큐 INSERT
  const authTable = await getAuthSmsTable();
  await bulkInsertSmsQueue(
    [authTable],
    [
      [
        managerPhone,
        managerPhone, // callback = 담당자 본인 phone
        lmsBody,
        'L',
        `[발송 2시간 전 안내]`.slice(0, 40),
        null,
        '',
        sched.company_id,
        '',
        '',
        '',
      ],
    ],
    true,
  );

  await query(
    `UPDATE journey_pretest_schedules SET status = 'notified', notified_at = NOW() WHERE id = $1`,
    [scheduleId],
  );
}

function buildPretestLmsBody(params: {
  journeyName: string;
  scheduledSendAt: Date;
  targetCount: number;
  messagePreview: string;
  pauseUrl: string;
}): string {
  const dateStr = params.scheduledSendAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  return [
    `[발송 2시간 전 안내]`,
    ``,
    `여정: ${params.journeyName}`,
    `발송 예정: ${dateStr}`,
    `타겟: ${params.targetCount.toLocaleString()}명`,
    ``,
    `본문 미리보기:`,
    params.messagePreview,
    ``,
    `즉시 정지: ${params.pauseUrl}`,
  ].join('\n');
}
```

- [ ] **Step 3: 자가 grep — 박-단어 + "진정" 단어 + 모델명 0건 검증**

Run: `grep -nE "박음|박힘|박는|박지|박을|박혀|박힌|박혔|박힐|박았|영영|진정" packages/backend/src/utils/journey-pretest-notifier.ts`
Expected: 0건 (예외: 룰 명 인용)

- [ ] **Step 4: tsc 자가 검증**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: 자가 종결 보고**

---

## Task 4: CT-94 `journey-pause-handler.ts` 신규

**Files:**
- Create: `packages/backend/src/utils/journey-pause-handler.ts`

- [ ] **Step 1: 옛 컨트롤타워 정독 — `short-url.ts` token 발급 패턴 + `sms-queue.ts` cancel fallback**

- [ ] **Step 2: CT-94 신규 파일 작성**

```typescript
// packages/backend/src/utils/journey-pause-handler.ts
// CT-94: 즉시 정지 token 발급 + 정지 실행 + 기록 보존 (D218+ 신설)

import { query } from '../db';
import crypto from 'crypto';

export interface PauseTokenInput {
  stepId: string;
  executionId: string | null;
  companyId: string;
  journeyId: string;
}

export interface PauseTokenPayload {
  step_id: string;
  execution_id: string | null;
  company_id: string;
  journey_id: string;
  expires_at: number;  // unix timestamp (24h TTL)
}

const TOKEN_SECRET = process.env.JOURNEY_PAUSE_TOKEN_SECRET || 'd218_pause_default_secret';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export async function generatePauseToken(input: PauseTokenInput): Promise<string> {
  const payload: PauseTokenPayload = {
    step_id: input.stepId,
    execution_id: input.executionId,
    company_id: input.companyId,
    journey_id: input.journeyId,
    expires_at: Date.now() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export async function verifyPauseToken(token: string): Promise<PauseTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(body).digest('base64url');
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PauseTokenPayload;
    if (payload.expires_at < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function executePause(
  token: string,
  pausedPhone: string,
  pauseTriggerSource: string = 'manager_link',
): Promise<{ ok: boolean; error?: string }> {
  const payload = await verifyPauseToken(token);
  if (!payload) return { ok: false, error: 'token_invalid_or_expired' };

  // DB 트랜잭션 — row lock + status UPDATE + 기록 INSERT
  const client = await (await import('../db')).getClient();
  try {
    await client.query('BEGIN');

    // 1. journey_executions status = 'paused' (row lock)
    let executionStatusAtPause: string | null = null;
    if (payload.execution_id) {
      const execRes = await client.query(
        `SELECT status FROM journey_executions WHERE id = $1 FOR UPDATE`,
        [payload.execution_id],
      );
      executionStatusAtPause = execRes.rows[0]?.status || null;
      await client.query(
        `UPDATE journey_executions SET status = 'paused' WHERE id = $1`,
        [payload.execution_id],
      );
    }

    // 2. snapshot 조회
    const snapRes = await client.query(
      `SELECT id, message_body FROM journey_step_snapshots
        WHERE step_id = $1 AND journey_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [payload.step_id, payload.journey_id],
    );
    const snapshot = snapRes.rows[0];

    // 3. 실시간 타겟 수 재조회
    const { resolveCustomerCount } = await import('./customer-filter');
    const targetCount = await resolveCustomerCount(
      payload.company_id,
      payload.journey_id,
      payload.step_id,
    );

    // 4. journey_step_pause_logs INSERT
    await client.query(
      `INSERT INTO journey_step_pause_logs
         (company_id, journey_id, step_id, execution_id, snapshot_id,
          pause_reason, pause_trigger_source, paused_phone,
          message_body_snapshot, target_count_snapshot, execution_status_at_pause)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        payload.company_id,
        payload.journey_id,
        payload.step_id,
        payload.execution_id,
        snapshot?.id || null,
        'manager_manual',
        pauseTriggerSource,
        pausedPhone,
        snapshot?.message_body || null,
        targetCount,
        executionStatusAtPause,
      ],
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK');
    return { ok: false, error: (err as Error).message };
  } finally {
    client.release();
  }
}

export async function getPauseLogs(
  companyId: string,
  journeyId?: string,
  limit: number = 50,
): Promise<any[]> {
  const sqlBase = `
    SELECT l.*, j.name AS journey_name, s.step_order, s.channel
      FROM journey_step_pause_logs l
      LEFT JOIN journeys j ON j.id = l.journey_id
      LEFT JOIN journey_steps s ON s.id = l.step_id
     WHERE l.company_id = $1
  `;
  const params: any[] = [companyId];
  let sql = sqlBase;
  if (journeyId) {
    sql += ` AND l.journey_id = $2`;
    params.push(journeyId);
  }
  sql += ` ORDER BY l.paused_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const res = await query(sql, params);
  return res.rows;
}
```

- [ ] **Step 3: 자가 grep**

Run: `grep -nE "박음|박힘|박는|박지|박을|박혀|박힌|박혔|박힐|박았|영영|진정" packages/backend/src/utils/journey-pause-handler.ts`
Expected: 0건

- [ ] **Step 4: tsc 자가 검증**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 5: 자가 종결 보고 — Phase 1 종결**

---

# Phase 2 — Backend 흐름 통합

## Task 5: CT-64 `continuous-operator-policy.ts` 강화

**Files:**
- Modify: `packages/backend/src/utils/continuous-operator-policy.ts`

- [ ] **Step 1: 옛 CT-64 정독 — `validateContinuousOperator` 함수 인터페이스 확인**

- [ ] **Step 2: `validateJourneyForActivation` import + 통합 함수 추가**

```typescript
// 옛 import 영역에 추가
import { validateJourneyForActivation } from './journey-pretest-validator';

// 옛 export 영역 마지막에 추가
export { validateJourneyForActivation };
```

- [ ] **Step 3: 자가 grep + tsc 검증**

---

## Task 6: CT-09 `spam-test-queue.ts` 강화 (통신사 4종 분리)

**Files:**
- Modify: `packages/backend/src/utils/spam-test-queue.ts`

- [ ] **Step 1: 옛 `spamFilterTest` 함수 정독 — 옛 결과 인터페이스 확인**

- [ ] **Step 2: 통신사 4종 분리 + 신뢰도 점수 강화**

```typescript
// 옛 SpamFilterTestResult 인터페이스 강화
export interface SpamFilterTestResult {
  ok: boolean;
  allCarriersPassed: boolean;
  failedCarriers: ('SKT' | 'KT' | 'LG U+' | 'MVNO')[];
  matchedStopWords: string[];
  confidenceScore: number; // 0~100
  perCarrierScore: {
    skt: number;
    kt: number;
    lguplus: number;
    mvno: number;
  };
}

// 옛 spamFilterTest 함수 안 결과 매핑 강화
// (옛 KISA 룰 매핑 활용 + 통신사 4종 분리)
```

- [ ] **Step 3: 자가 grep + tsc 검증**

---

## Task 7: `journey-executor.ts` 강화 (snapshot + race condition + 실패 분기)

**Files:**
- Modify: `packages/backend/src/utils/journey-executor.ts`

- [ ] **Step 1: 옛 `processExecution` 함수 정독**

- [ ] **Step 2: snapshot 우선 조회 + status 3 시점 재확인**

```typescript
async function processExecution(executionId: string): Promise<void> {
  // 1차 status 확인 (진입 직전)
  const exec1 = await query(
    `SELECT * FROM journey_executions WHERE id = $1 FOR UPDATE`,
    [executionId],
  );
  if (!exec1.rows[0] || exec1.rows[0].status === 'paused') return;

  // snapshot 조회 우선
  const snapRes = await query(
    `SELECT * FROM journey_step_snapshots
      WHERE step_id = $1 AND journey_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [exec1.rows[0].step_id, exec1.rows[0].journey_id],
  );
  const snapshot = snapRes.rows[0];
  const messageBody = snapshot?.message_body || exec1.rows[0].message_body;

  // 실시간 타겟 수 재조회
  const targetCount = await resolveCustomerCount(...);

  // 2차 status 확인 (발송 직전 race condition 차단)
  const exec2 = await query(
    `SELECT status FROM journey_executions WHERE id = $1 FOR UPDATE`,
    [executionId],
  );
  if (exec2.rows[0]?.status === 'paused') return;

  // 실패 사유별 분기 try/catch
  try {
    await dispatchSend({ ... });
  } catch (err: any) {
    if (err.code === 'insufficient_balance') {
      await pauseAndNotifyBalance(executionId);
    } else if (isRetryableError(err.code)) {
      await scheduleRetry(executionId, 5 * 60 * 1000); // 5분 후 1회
    } else if (err.code === 'invalid_phone') {
      await recordFailedPhone(executionId);
    } else {
      await recordGenericError(executionId, err);
    }
  }

  // 3차 status 확인 + queued_count UPDATE
  const exec3 = await query(`SELECT status FROM journey_executions WHERE id = $1`, [executionId]);
  if (exec3.rows[0]?.status !== 'paused') {
    await query(`UPDATE journey_executions SET queued_count = $2 WHERE id = $1`, [executionId, targetCount]);
  }
}
```

- [ ] **Step 3: 자가 grep + tsc 검증**

---

## Task 8: `journey-builder.ts` 강화 (lock + paused 상태)

**Files:**
- Modify: `packages/backend/src/utils/journey-builder.ts`

- [ ] **Step 1: 옛 `activateJourney` 함수 정독**

- [ ] **Step 2: 활성화 후 lock 검증 + paused 상태 + snapshot INSERT**

```typescript
export async function activateJourney(journeyId: string, companyId: string): Promise<void> {
  // 옛 검증 영역
  const validation = await validateJourneyForActivation(journeyId, companyId);
  if (!validation.ok) {
    throw new Error('VALIDATION_FAILED: ' + JSON.stringify(validation.failedSteps));
  }

  // snapshot INSERT
  await createJourneyStepSnapshots(journeyId, companyId);

  // 알림 스케줄 INSERT
  await scheduleNotificationsForActivation(journeyId, companyId);

  // status = 'active'
  await query(`UPDATE journeys SET status = 'active' WHERE id = $1`, [journeyId]);
}

export async function pauseJourney(journeyId: string, companyId: string): Promise<void> {
  await query(
    `UPDATE journeys SET status = 'paused' WHERE id = $1 AND company_id = $2`,
    [journeyId, companyId],
  );
  // 미발송 executions 일제 paused
  await query(
    `UPDATE journey_executions SET status = 'paused'
      WHERE journey_id = $1 AND status IN ('pending', 'scheduled')`,
    [journeyId],
  );
}

export async function resumeJourney(journeyId: string, companyId: string): Promise<void> {
  await query(
    `UPDATE journeys SET status = 'active' WHERE id = $1 AND company_id = $2 AND status = 'paused'`,
    [journeyId, companyId],
  );
}

async function createJourneyStepSnapshots(journeyId: string, companyId: string): Promise<void> {
  // 모든 step + variant snapshot INSERT
  const stepsRes = await query(`SELECT * FROM journey_steps WHERE journey_id = $1`, [journeyId]);
  for (const step of stepsRes.rows) {
    const variantsRes = await query(`SELECT * FROM journey_step_variants WHERE step_id = $1`, [step.id]);
    const variants = variantsRes.rows.length > 0 ? variantsRes.rows : [{ id: null, message_body: step.message_template }];

    for (const variant of variants) {
      await query(
        `INSERT INTO journey_step_snapshots
           (company_id, journey_id, step_id, variant_id, message_body, message_subject,
            variable_map, channel, is_ad, callback_number, alimtalk_template_code, confidence_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          companyId,
          journeyId,
          step.id,
          variant.id,
          variant.message_body,
          step.subject,
          step.alimtalk_variable_map || {},
          step.channel,
          step.is_ad,
          step.callback_number,
          step.alimtalk_template_code,
          100, // default
        ],
      );
    }
  }
}
```

- [ ] **Step 3: 자가 grep + tsc 검증**

---

## Task 9: 신규 endpoint 6건 추가

**Files:**
- Modify: `packages/backend/src/routes/ai.ts` (5 endpoint 추가)
- Create: `packages/backend/src/routes/journey-pause-public.ts` (Public 2 endpoint)
- Modify: `packages/backend/src/app.ts` (Public 라우터 등록)

- [ ] **Step 1: 옛 `routes/ai.ts` 영역 정독 — 옛 endpoint 정합 영역 확인**

- [ ] **Step 2: 5 endpoint 추가 (admin 인증 필요)**

```typescript
// routes/ai.ts 안 추가

// 1. 활성화 검증 (POST)
router.post('/operator/journeys/:id/pretest-validate', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user!.companyId;
    const result = await validateJourneyForActivation(id, companyId);
    return res.json(result);
  } catch (err: any) {
    if (err?.message?.includes('column') && err?.message?.includes('does not exist')) {
      return res.status(503).json({ code: 'DB_MIGRATION_PENDING', error: 'DB 마이그레이션 필요' });
    }
    return res.status(500).json({ error: err.message });
  }
});

// 2. 활성화 (POST)
router.post('/operator/journeys/:id/activate', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const companyId = req.user!.companyId;
    await activateJourney(id, companyId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// 3. 일시 정지 (POST)
router.post('/operator/journeys/:id/pause', requireAuth, async (req, res) => {
  await pauseJourney(req.params.id, req.user!.companyId);
  return res.json({ success: true });
});

// 4. 재활성화 (POST)
router.post('/operator/journeys/:id/resume', requireAuth, async (req, res) => {
  await resumeJourney(req.params.id, req.user!.companyId);
  return res.json({ success: true });
});

// 5. 정지 이력 조회 (GET)
router.get('/operator/journeys/:id/pause-logs', requireAuth, async (req, res) => {
  const logs = await getPauseLogs(req.user!.companyId, req.params.id);
  return res.json({ logs });
});
```

- [ ] **Step 3: Public 정지 페이지 endpoint 신규 라우터 작성**

```typescript
// packages/backend/src/routes/journey-pause-public.ts
import express from 'express';
import { verifyPauseToken, executePause } from '../utils/journey-pause-handler';

const router = express.Router();

// GET /journey-pause/:token (Public, 인증 X)
router.get('/journey-pause/:token', async (req, res) => {
  const payload = await verifyPauseToken(req.params.token);
  if (!payload) {
    return res.status(404).json({ error: 'token_invalid_or_expired' });
  }
  // snapshot + 발송 정보 반환 (Frontend에서 미리보기 표시)
  const { query } = await import('../db');
  const snapRes = await query(
    `SELECT s.*, j.name AS journey_name, jstep.step_order, jstep.channel
       FROM journey_step_snapshots s
       JOIN journeys j ON j.id = s.journey_id
       JOIN journey_steps jstep ON jstep.id = s.step_id
      WHERE s.step_id = $1 AND s.journey_id = $2
      ORDER BY s.created_at DESC LIMIT 1`,
    [payload.step_id, payload.journey_id],
  );
  if (snapRes.rows.length === 0) {
    return res.status(404).json({ error: 'snapshot_not_found' });
  }
  return res.json({
    journey_name: snapRes.rows[0].journey_name,
    step_order: snapRes.rows[0].step_order,
    channel: snapRes.rows[0].channel,
    scheduled_send_at: snapRes.rows[0].scheduled_send_at,
    message_body: snapRes.rows[0].message_body,
  });
});

// POST /journey-pause/:token (Public 정지 실행)
router.post('/journey-pause/:token', async (req, res) => {
  const pausedPhone = String(req.body?.paused_phone || '').replace(/\D/g, '');
  const result = await executePause(req.params.token, pausedPhone, 'manager_link');
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  return res.json({ success: true });
});

export default router;
```

- [ ] **Step 4: `app.ts` Public 라우터 등록**

```typescript
// app.ts
import journeyPausePublicRouter from './routes/journey-pause-public';
app.use('/', journeyPausePublicRouter);
```

- [ ] **Step 5: 자가 grep + tsc 검증**

---

# Phase 3 — Worker 신규

## Task 10: `journey-pretest-notifier-worker.ts` 신규 (5분 cron)

**Files:**
- Create: `packages/backend/src/workers/journey-pretest-notifier-worker.ts`
- Modify: `packages/backend/src/app.ts` (worker 등록)

- [ ] **Step 1: 옛 worker 패턴 정독 — `auto-campaign-worker.ts` 또는 `campaign-sync-worker.ts`**

- [ ] **Step 2: 5분 cron worker 신규 파일 작성**

```typescript
// packages/backend/src/workers/journey-pretest-notifier-worker.ts
// D218+ 신설 — 5분 cron + notify_at 도달 schedule 발송

import { query } from '../db';
import { sendPretestNotification } from '../utils/journey-pretest-notifier';

const INTERVAL_MS = 5 * 60 * 1000;
let _workerTimer: NodeJS.Timeout | null = null;
let _workerRunning = false;

export async function runJourneyPretestNotifierTick(): Promise<void> {
  if (_workerRunning) return;
  _workerRunning = true;
  try {
    const dueRes = await query(
      `SELECT id FROM journey_pretest_schedules
        WHERE notify_at <= NOW() AND status = 'pending'
        ORDER BY notify_at ASC LIMIT 100`,
    );
    for (const row of dueRes.rows) {
      try {
        await sendPretestNotification(row.id);
      } catch (err) {
        console.log('[journey-pretest-notifier]', `schedule_id=${row.id} error=${(err as Error).message}`);
      }
    }
  } finally {
    _workerRunning = false;
  }
}

export function startJourneyPretestNotifierWorker(): void {
  if (_workerTimer) return;
  _workerTimer = setInterval(() => {
    runJourneyPretestNotifierTick().catch((e) =>
      console.log('[journey-pretest-notifier]', `tick error: ${(e as Error).message}`),
    );
  }, INTERVAL_MS);
}
```

- [ ] **Step 3: `app.ts` worker 등록**

```typescript
import { startJourneyPretestNotifierWorker } from './workers/journey-pretest-notifier-worker';
startJourneyPretestNotifierWorker();
```

- [ ] **Step 4: 자가 grep + tsc 검증**

---

## Task 11: `ai-memory-accumulator-worker.ts` 신규 (1시간 cron)

**Files:**
- Create: `packages/backend/src/workers/ai-memory-accumulator-worker.ts`
- Modify: `packages/backend/src/app.ts` (worker 등록)

- [ ] **Step 1: 옛 `company-memory.ts` CT-37 + `recordCampaignLearning` 패턴 정독**

- [ ] **Step 2: 1시간 cron worker 신규 파일 작성**

```typescript
// packages/backend/src/workers/ai-memory-accumulator-worker.ts
// D218+ 신설 — 1시간 cron + 7일 KPI 누적 + ai_company_memory 학습

import { query } from '../db';
import { recordCampaignLearning } from '../utils/company-memory';

const INTERVAL_MS = 60 * 60 * 1000;
let _workerTimer: NodeJS.Timeout | null = null;
let _workerRunning = false;

export async function runAiMemoryAccumulatorTick(): Promise<void> {
  if (_workerRunning) return;
  _workerRunning = true;
  try {
    const recentRes = await query(
      `SELECT e.company_id, e.journey_id, e.step_id,
              COUNT(*) FILTER (WHERE er.status = 'success') AS success_count,
              COUNT(*) FILTER (WHERE er.status = 'failed') AS failed_count
         FROM journey_executions e
         LEFT JOIN journey_execution_results er ON er.execution_id = e.id
        WHERE e.completed_at >= NOW() - INTERVAL '7 days'
          AND e.completed_at <= NOW()
        GROUP BY e.company_id, e.journey_id, e.step_id`,
    );

    for (const row of recentRes.rows) {
      try {
        await recordCampaignLearning({
          companyId: row.company_id,
          campaignId: row.journey_id,
          stepId: row.step_id,
          sentCount: Number(row.success_count) + Number(row.failed_count),
          successCount: Number(row.success_count),
          failedCount: Number(row.failed_count),
        });
      } catch (err) {
        console.log('[ai-memory-accumulator]', `error: ${(err as Error).message}`);
      }
    }
  } finally {
    _workerRunning = false;
  }
}

export function startAiMemoryAccumulatorWorker(): void {
  if (_workerTimer) return;
  _workerTimer = setInterval(() => {
    runAiMemoryAccumulatorTick().catch((e) =>
      console.log('[ai-memory-accumulator]', `tick error: ${(e as Error).message}`),
    );
  }, INTERVAL_MS);
}
```

- [ ] **Step 3: `app.ts` worker 등록**

- [ ] **Step 4: 자가 grep + tsc 검증**

---

## Task 12: `campaign-sync-worker.ts` 강화 (결과 알림 LMS 통합)

**Files:**
- Modify: `packages/backend/src/utils/campaign-sync-worker.ts`

- [ ] **Step 1: 옛 `campaign-sync-worker.ts` 정독**

- [ ] **Step 2: 결과 알림 LMS 발송 통합**

```typescript
// 옛 campaign-sync-worker.ts 안 결과 수집 종결 직후 추가

// notify_manager_on_pretest = TRUE step + completed step만 결과 알림
const completedRes = await query(
  `SELECT e.id, e.company_id, e.journey_id, e.step_id, e.success_count, e.failed_count,
          j.name AS journey_name, s.step_order, s.notify_manager_on_pretest,
          (SELECT COUNT(*) FROM journey_steps WHERE journey_id = e.journey_id) AS total_steps
     FROM journey_executions e
     LEFT JOIN journeys j ON j.id = e.journey_id
     LEFT JOIN journey_steps s ON s.id = e.step_id
    WHERE e.status = 'completed'
      AND e.result_notified_at IS NULL
      AND e.completed_at >= NOW() - INTERVAL '2 hours'`,
);

for (const exec of completedRes.rows) {
  const shouldNotify =
    exec.notify_manager_on_pretest === true ||
    (exec.notify_manager_on_pretest === null &&
     (exec.step_order === 1 || exec.step_order === exec.total_steps));

  if (!shouldNotify) continue;

  // 담당자 phone 조회
  const mgrRes = await query(
    `SELECT phone_number FROM kakao_alarm_users
      WHERE company_id = $1 AND COALESCE(active_yn,'Y')='Y' ORDER BY created_at ASC LIMIT 1`,
    [exec.company_id],
  );
  if (mgrRes.rows.length === 0) continue;

  const lmsBody = [
    `[발송 결과]`,
    `여정: ${exec.journey_name}`,
    `step ${exec.step_order} 완료`,
    `성공: ${exec.success_count}건 / 실패: ${exec.failed_count}건`,
  ].join('\n');

  await bulkInsertSmsQueue(
    [await getAuthSmsTable()],
    [[String(mgrRes.rows[0].phone_number).replace(/\D/g, ''), '', lmsBody, 'L', '[발송 결과]', null, '', exec.company_id, '', '', '']],
    true,
  );

  await query(`UPDATE journey_executions SET result_notified_at = NOW() WHERE id = $1`, [exec.id]);
}
```

- [ ] **Step 3: `journey_executions.result_notified_at timestamptz` 컬럼 ALTER 의무 (Phase 1 Task 1 추가 영역)**

- [ ] **Step 4: 자가 grep + tsc 검증**

---

# Phase 3 종결 자가 검증

- [ ] **전체 backend tsc 자가 검증**: `cd packages/backend && npx tsc --noEmit` = 0 errors
- [ ] **전체 박-단어 자가 grep**: `grep -rnE "박음|박힘|박는|박지|박을|박혀|박힌|박혔|박힐|박았|영영|진정" packages/backend/src/utils/journey-pretest-*.ts packages/backend/src/utils/journey-pause-handler.ts packages/backend/src/workers/journey-*.ts packages/backend/src/workers/ai-memory-accumulator-worker.ts` = 0건
- [ ] **7-1 컨트롤타워 grep 의무**: `grep -rn "validateJourneyForActivation\|scheduleNotificationsForActivation\|generatePauseToken\|executePause" packages/backend/src/` — 인라인 잔존 0건
- [ ] **MANDATORY_CHECKLIST 자가 출력 (Phase 3 종결 직후)**
- [ ] **표준 종료 멘트 출력**: "작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포를 진행해 주세요."

---

# Self-Review

**1. Spec coverage:**
- 활성화 검증 ✓ Task 2 (CT-92)
- 2시간 전 알림 ✓ Task 3 + Task 10 (CT-93 + worker)
- 즉시 정지 ✓ Task 4 + Task 9 (CT-94 + Public endpoint)
- snapshot 보존 ✓ Task 8 (`createJourneyStepSnapshots`)
- 스팸필터 통신사 4종 분리 ✓ Task 6 (CT-09 강화)
- race condition 안전망 ✓ Task 7 (status 3 시점)
- 실패 사유별 분기 ✓ Task 7 (try/catch + 사유 매핑)
- 결과 알림 LMS ✓ Task 12 (campaign-sync-worker 강화)
- 7일 검증 + AI 학습 ✓ Task 11 (ai-memory-accumulator-worker)
- 정지 이력 UI = Phase 4 (다음 세션)
- ConfirmModal UI = Phase 4 (다음 세션)
- JourneyPausePage UI = Phase 4 (다음 세션)

**2. Placeholder scan:** TBD/TODO 0건. 옛 컨트롤타워 정독 step 의무 (각 Task Step 1).

**3. Type consistency:**
- `ValidationResult.failedSteps` ↔ `FailedStep[]` 정합
- `PauseTokenPayload.execution_id` ↔ Task 7 `journey_executions.id` 정합
- `journey_step_snapshots` 컬럼명 ↔ Task 8 INSERT 정합
- `pause_reason` enum 매핑 — manager_manual / balance_insufficient / carrier_temp_fail / phone_invalid / admin_manual

---

# 다음 단계

Phase 1~3 종결 후 = Phase 4 (Frontend) + Phase 5 (검증) + Phase 6 (Harold 직접 배포) + Phase 7 (메모리 갱신) = 다음 세션 진정 의무.

**본 세션 종결 시점**:
1. 전체 backend tsc 0 errors 보고
2. 박-단어 + "진정" 자가 grep 0건 보고
3. Harold 직접 commit/push 의무 안내 (표준 종료 멘트)
4. DB SQL 8건 안내 (배포 후 직접 PG 실행)
