# 여정 미리보기 타겟 연동 수정 계획

> **For agentic workers:** 이 계획은 비토가 본 세션에서 직접 inline 구현한다 (no_parallel_tasks 영구 룰 — subagent 병렬 금지). 각 Task 종료 시 tsc + grep 자가 검증.

**Goal:** 여정 미리보기가 항상 회사 LTV 1위 고객(남다은)을 보여주는 문제를, 여정 trigger 조건으로 실제 추출된 고객을 보여주도록 고친다.

**Architecture:** trigger-watcher의 6개 매칭 함수에서 후보 추출 SQL을 공유 함수 1개로 분리한다. 발송 경로(trigger-watcher)는 그 함수를 호출만 하도록 바꿔 동작을 그대로 보존하고, 미리보기 경로(sample-customer / preview-samples)가 같은 함수로 동일 기준 고객을 뽑는다.

**Tech Stack:** Node.js/Express + PostgreSQL. 검증 = `npm run build:safe`(tsc 0) + 자가 grep. 발송 로직은 SQL 1:1 이전으로 동작 보존.

---

## 근본 원인 (소스 확인 완료)

- review 미리보기: `JourneysPage.tsx:701`가 `/operator/sample-customer`를 `filters:{}` 빈값으로 호출 → `ai.ts:1021` `ORDER BY ltv_score DESC LIMIT 1` = 항상 회사 LTV 1위(남다은, 등급 VIP).
- 저장 후 미리보기: `ai.ts:2579` `preview-samples`가 trigger 무시하고 등급별 고정 6그룹만 추출.
- 실제 발송 대상: `journey-trigger-watcher.ts:132` `matchCustomerCreated`가 `created_at >= NOW()-24h ORDER BY created_at DESC`로 신규가입자 추출.
- 즉 미리보기와 발송 대상이 완전히 다른 경로 → 신규가입 여정인데 VIP가 뜸.

## 파일 구조

- 신규 `packages/backend/src/utils/journey-target-extractor.ts` — 공유 추출 함수 `selectJourneyTargetCustomerIds()`. trigger_event별 후보 customer_id 추출. trigger-watcher와 동일 SQL.
- 수정 `packages/backend/src/utils/journey-trigger-watcher.ts` — 6 match 함수가 공유 함수 호출 (동작 보존).
- 수정 `packages/backend/src/routes/ai.ts` — `sample-customer`(review) + `preview-samples`(저장 후)를 trigger 기준 추출로 교체.
- 수정 `packages/frontend/src/pages/JourneysPage.tsx` — review에서 trigger 정보 전달 + 0명 "현재 대상 없음" 표시.

추출 조건은 인라인 중복 없이 공유 함수 1개에만 둔다 (no_inline_duplication 정합).

---

## Task 1: 공유 추출 함수 생성

**Files:**
- Create: `packages/backend/src/utils/journey-target-extractor.ts`

추출 함수는 trigger-watcher의 6개 match SQL을 1:1로 옮긴다. `j: ActiveJourney` 대신 `(companyId, triggerEvent, triggerFilters, limit)`를 받아 review(미저장) 단계에서도 호출 가능하게 한다. default 값(recent_hours 24 / dormant_days 30 / abandon_hours 24 / days_before 7 / cdp 5분)도 trigger-watcher와 동일하게 유지.

```ts
import { query } from '../config/database';
import { applyCustomerConditions } from './journey-simulator';

/**
 * 여정 trigger 조건으로 후보 customer_id 추출 (공유 컨트롤타워).
 * trigger-watcher(발송)와 미리보기(sample-customer / preview-samples)가 동일 기준을 쓰도록 단일 진실로 둔다.
 * SQL은 journey-trigger-watcher.ts의 6 match 함수에서 1:1 이전 — 발송 동작 보존.
 */
export async function selectJourneyTargetCustomerIds(
  companyId: string,
  triggerEvent: string,
  triggerFilters: Record<string, any>,
  limit: number,
): Promise<string[]> {
  const filters = triggerFilters || {};

  switch (triggerEvent) {
    case 'customer.created': {
      const params: any[] = [companyId, String(Number(filters.recent_hours || 24)), String(limit)];
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid AND c.is_active = true AND c.sms_opt_in = true
           AND c.created_at >= NOW() - ($2 || ' hours')::interval
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.created_at DESC LIMIT $3::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }
    case 'cdp.purchase':
      return selectCdpEvent(companyId, 'purchase', 5, filters, limit);
    case 'cdp.reservation_created':
      return selectCdpEvent(companyId, 'reservation_created', 5, filters, limit);
    case 'customer.dormant': {
      const d = Number(filters.dormant_days || 30);
      const params: any[] = [companyId, String(d), String(d + 7), String(limit)];
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid AND c.is_active = true AND c.sms_opt_in = true
           AND c.recent_purchase_date IS NOT NULL
           AND c.recent_purchase_date < (CURRENT_DATE - ($2 || ' days')::interval)
           AND c.recent_purchase_date > (CURRENT_DATE - ($3 || ' days')::interval)
           ${cond ? ` AND ${cond}` : ''}
         ORDER BY c.recent_purchase_date DESC LIMIT $4::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }
    case 'cdp.cart_abandon': {
      const h = Number(filters.abandon_hours || 24);
      const params: any[] = [companyId, String(h), String(limit)];
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      const r = await query(
        `WITH abandoned AS (
           SELECT DISTINCT ON (customer_id) customer_id, occurred_at AS cart_add_at
           FROM cdp_events
           WHERE company_id = $1::uuid AND event_name = 'cart_add' AND customer_id IS NOT NULL
             AND occurred_at >= NOW() - (($2::int + 1) || ' hours')::interval
             AND occurred_at <= NOW() - ($2 || ' hours')::interval
           ORDER BY customer_id, occurred_at DESC
         )
         SELECT a.customer_id FROM abandoned a
         ${cond ? `INNER JOIN customers c ON c.id = a.customer_id` : ''}
         WHERE NOT EXISTS (
           SELECT 1 FROM cdp_events e2
           WHERE e2.company_id = $1::uuid AND e2.customer_id = a.customer_id
             AND e2.event_name IN ('checkout_start', 'purchase') AND e2.occurred_at > a.cart_add_at
         )
         ${cond ? ` AND ${cond}` : ''}
         LIMIT $3::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }
    case 'customer.birthday_approaching': {
      const days = Number(filters.days_before || 7);
      const params: any[] = [companyId, String(days), String(limit)];
      const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
      const r = await query(
        `SELECT id AS customer_id FROM customers c
         WHERE c.company_id = $1::uuid AND c.is_active = true AND c.sms_opt_in = true
           AND (
             (c.birth_month_day IS NOT NULL AND c.birth_month_day = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
             OR (c.birth_date IS NOT NULL AND TO_CHAR(c.birth_date, 'MM-DD') = TO_CHAR((CURRENT_DATE + ($2 || ' days')::interval), 'MM-DD'))
           )
           ${cond ? ` AND ${cond}` : ''}
         LIMIT $3::int`,
        params,
      );
      return r.rows.map((x: any) => x.customer_id);
    }
    default:
      return [];
  }
}

async function selectCdpEvent(
  companyId: string, eventName: string, recentMinutes: number,
  filters: Record<string, any>, limit: number,
): Promise<string[]> {
  const params: any[] = [companyId, eventName, String(recentMinutes), String(limit)];
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  const r = await query(
    `SELECT DISTINCT e.customer_id FROM cdp_events e
     ${cond ? `INNER JOIN customers c ON c.id = e.customer_id` : ''}
     WHERE e.company_id = $1::uuid AND e.event_name = $2 AND e.customer_id IS NOT NULL
       AND e.occurred_at >= NOW() - ($3 || ' minutes')::interval
       ${cond ? ` AND ${cond}` : ''}
     LIMIT $4::int`,
    params,
  );
  return r.rows.map((x: any) => x.customer_id);
}
```

- [ ] Step 1: 위 파일 생성.
- [ ] Step 2: `npm run build:safe`로 tsc 0 확인.

검증 메모: 발송 SQL과의 동일성 — cart_abandon 원본은 `LIMIT 500` 고정이었으나 공유 함수는 `LIMIT $3`. Task 2에서 trigger-watcher가 limit=500을 넘기므로 동작 동일. birthday/cart_abandon 원본은 ORDER BY 없음 → 공유 함수도 없음(동일).

---

## Task 2: trigger-watcher가 공유 함수 사용 (동작 보존)

**Files:**
- Modify: `packages/backend/src/utils/journey-trigger-watcher.ts:110-266`

`processJourneyTrigger`를 공유 함수 호출로 교체하고, 6개 match 함수(matchCustomerCreated/matchCdpEvent/matchCustomerDormant/matchCartAbandon/matchBirthdayApproaching)를 삭제한다. enqueueCandidates/checkCooldown은 그대로 둔다.

```ts
import { selectJourneyTargetCustomerIds } from './journey-target-extractor';

async function processJourneyTrigger(j: ActiveJourney): Promise<{ matched: number; enqueued: number; skipped: number }> {
  const ids = await selectJourneyTargetCustomerIds(j.company_id, j.trigger_event, j.trigger_filters || {}, 500);
  if (ids.length === 0) return { matched: 0, enqueued: 0, skipped: 0 };
  return enqueueCandidates(j, ids);
}
```

- [ ] Step 1: import 추가 + processJourneyTrigger 교체 + 6 match 함수 삭제.
- [ ] Step 2: 사용 안 하게 된 import(applyCustomerConditions)가 trigger-watcher에 남으면 제거.
- [ ] Step 3: `npm run build:safe` tsc 0.
- [ ] Step 4: grep으로 trigger-watcher 내 `matchCustomer`/`matchCdp`/`matchCart`/`matchBirthday` 잔존 0건 확인.

---

## Task 3: review 미리보기 타겟 연동 + 0명 처리 (스크린샷 증상 직접 해결)

**Files:**
- Modify: `packages/backend/src/routes/ai.ts:976-1085` (`/operator/sample-customer`)
- Modify: `packages/frontend/src/pages/JourneysPage.tsx:701-705` (호출부)

백엔드: `filters` 대신 `{ triggerEvent, triggerFilters }`를 받아 공유 함수로 상위 1명 추출 → 그 customer_id로 기존 상세 SELECT(1010-1023) 실행. trigger 정보 없으면 sampleCustomer: null. store-scope 격리는 추출된 id에 대해 유지.

frontend: `body: JSON.stringify({ triggerEvent: aiPkg.triggerEvent, triggerFilters: aiPkg.triggerFilters })`로 변경.

0명 표시: 미리보기 렌더(2384-2386)에서 `sampleCustomer`가 null이면 본문 위에 "현재 이 조건에 맞는 고객이 아직 없습니다. 여정을 켜두면 조건 충족 고객이 생기는 즉시 발송됩니다." 안내 1줄 추가.

- [ ] Step 1: sample-customer 백엔드 교체 (공유 함수 → id → 상세 SELECT WHERE id 추가).
- [ ] Step 2: frontend 호출 body 교체.
- [ ] Step 3: 0명 안내 UI 추가.
- [ ] Step 4: `npm run build:safe`(backend+frontend) tsc 0 + native dialog/모델명 grep 0건.

---

## Task 4: preview-samples 타겟 연동

**Files:**
- Modify: `packages/backend/src/routes/ai.ts:2564-2663`

등급별 고정 6그룹 UNION ALL을 폐기하고, journey의 trigger_event/trigger_filters를 조회해 공유 함수로 상위 N명(예: 6) 추출 → 각 고객 상세를 sampleCustomer/sampleCustomerFields로 가공. label은 등급 대신 "대상 N" 또는 고객명. 0명이면 samples: [].

- [ ] Step 1: journeys 테이블에서 trigger_event/trigger_filters SELECT (컬럼 존재는 trigger-watcher가 이미 사용 — 검증됨).
- [ ] Step 2: 공유 함수 호출 → 상위 N id → 상세 가공.
- [ ] Step 3: `npm run build:safe` tsc 0.

---

## Task 5: 10명 미리보기(LiquidPreviewModal) 타겟 연동

**Files:**
- Modify: `packages/frontend/src/pages/JourneysPage.tsx` (LiquidPreviewModal 호출부)
- 필요 시 백엔드 추출 N=10 경로 재사용

LiquidPreviewModal이 쓰는 10명 샘플도 Task 4 경로(공유 함수, limit=10)로 통일. 상세는 구현 시 모달 데이터 흐름 확인 후 확정.

- [ ] Step 1: 모달 데이터 소스 확인 후 공유 경로로 교체.
- [ ] Step 2: `npm run build:safe` tsc 0.

---

## 범위 밖 (별도 작업)

- 증상 C (Liquid `{{ }}` 치환값 하이라이트 누락) — `highlightVars.tsx` `mergeAndHighlightVars` 수정. 2번 작업.
- 증상 D (변수 문법 2종 혼재) — `journey-ai-generator.ts` 프롬프트 정비. 3번 작업.

## Self-Review

- 스펙 커버리지: 미리보기 타겟 연동(증상 A·B) = Task 1~5. 0명 처리 = Task 3. 발송 동작 보존 = Task 1·2 SQL 1:1 이전. 증상 C·D는 범위 밖 명시.
- 동작 보존 위험: cart_abandon LIMIT 500→$3, birthday LIMIT 500→$3. Task 2가 500을 넘기므로 발송 동일. 미리보기는 작은 limit.
- Task 3까지 완료 시 스크린샷 증상(항상 남다은) 해소.
