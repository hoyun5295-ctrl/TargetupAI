# 여정 Phase 1 — 공통 안전필터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans(인라인, 한 번에 한 task) 또는 superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.
> **상위 설계서:** `docs/superpowers/specs/2026-06-04-journey-engine-redesign-design.md` (전체 9단계 중 Phase 1).
> **배포는 Harold.** 각 task 종료 = 검증 통과 후 Harold 커밋(코드는 AI, git/배포는 Harold).

**Goal:** 모든 여정 trigger 추출(extractor)과 시뮬레이터가 **수신거부·무효번호 고객을 무조건 제외**하도록, 단일 공통 안전필터를 만들어 전 분기에 적용한다.

**Architecture:** 순수 SQL 조각 빌더 컨트롤타워 `buildJourneySafetyFilter(alias)` 1개를 만들고(`applyCustomerConditions`와 동일 패턴, 파라미터 0개·문자열만 반환), `journey-target-extractor.ts`의 5개 trigger 분기와 `journey-simulator.ts`에 일괄 적용한다. cdp 계열(구매·예약·장바구니)은 지금 `customer_conditions`가 있을 때만 customers를 JOIN하고 is_active/sms_opt_in을 안 거는데, **항상 INNER JOIN + 안전필터**로 바꾼다.

**Tech Stack:** TypeScript · node-postgres(pg) · 검증 = node:assert + ts-node(러너 없음).

**검증된 컬럼(information_schema 2026-06-04):** `customers.is_active`(bool), `sms_opt_in`(bool), `is_opt_out`(bool), `is_invalid`(bool), `company_id`(uuid), `phone`(varchar). `unsubscribes.company_id`,`phone`,`user_id`. — 전부 존재 확인.

---

## File Structure

| 파일 | 책임 | 변경 |
|---|---|---|
| `packages/backend/src/utils/journey-safety-filter.ts` | 공통 안전필터 SQL 조각 빌더(순수) | **신규** |
| `packages/backend/src/utils/__tests__/journey-safety-filter.verify.ts` | 위 함수 순수 단위 검증 | **신규** |
| `packages/backend/src/utils/journey-target-extractor.ts` | 5개 trigger 분기에 안전필터 적용 + cdp 항상 JOIN | 수정 |
| `packages/backend/src/utils/journey-simulator.ts` | matchTriggerCustomers baseWhere 안전필터로 통일 | 수정 |

**필터 정의(확정):**
```
{alias}.company_id = $companyParam            (호출부가 이미 가진 회사 파라미터 재사용 — 아래 주: 빌더는 company_id 절을 넣지 않고 호출부 WHERE가 유지)
{alias}.is_active = true
AND {alias}.sms_opt_in = true
AND {alias}.is_opt_out IS NOT TRUE
AND {alias}.is_invalid IS NOT TRUE
AND NOT EXISTS (SELECT 1 FROM unsubscribes u
                WHERE u.company_id = {alias}.company_id AND u.phone = {alias}.phone)
```
- `is_opt_out`/`is_invalid`는 nullable → `IS NOT TRUE`(NULL=발송 가능). `sms_opt_in`은 기존 동작 보존 위해 `= true`(NULL 제외).
- 파라미터 0개(순수 문자열) → 호출부의 `$N` 인덱스·`applyCustomerConditions` 파라미터 순서 안 건드림.
- 회사 격리 `company_id = $1`은 각 호출부 WHERE에 이미 있어 그대로 두고, 빌더는 안전 4종 + unsubscribes만 반환.

---

## Task 1: 공통 안전필터 빌더(순수 함수) + 단위 검증

**Files:**
- Create: `packages/backend/src/utils/journey-safety-filter.ts`
- Test: `packages/backend/src/utils/__tests__/journey-safety-filter.verify.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/backend/src/utils/__tests__/journey-safety-filter.verify.ts`:
```ts
/**
 * journey-safety-filter.verify.ts — 공통 안전필터 SQL 조각 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-safety-filter.verify.ts
 * (DB import 0 — 연결 불필요. 문자열만 검증.)
 */
import assert from 'node:assert';
import { buildJourneySafetyFilter } from '../journey-safety-filter';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[journey-safety-filter] alias=c');
const f = buildJourneySafetyFilter('c');
ok('is_active=true 포함', () => assert.ok(/\bc\.is_active\s*=\s*true\b/.test(f)));
ok('sms_opt_in=true 포함', () => assert.ok(/\bc\.sms_opt_in\s*=\s*true\b/.test(f)));
ok('is_opt_out IS NOT TRUE 포함', () => assert.ok(/\bc\.is_opt_out\s+IS\s+NOT\s+TRUE\b/.test(f)));
ok('is_invalid IS NOT TRUE 포함', () => assert.ok(/\bc\.is_invalid\s+IS\s+NOT\s+TRUE\b/.test(f)));
ok('unsubscribes 안티조인(company_id+phone)', () =>
  assert.ok(/NOT\s+EXISTS\s*\([\s\S]*unsubscribes\s+u[\s\S]*u\.company_id\s*=\s*c\.company_id[\s\S]*u\.phone\s*=\s*c\.phone/.test(f)));
ok('파라미터 placeholder($n) 없음(순수 문자열)', () => assert.ok(!/\$\d/.test(f)));

console.log('[journey-safety-filter] alias 치환');
const fx = buildJourneySafetyFilter('x');
ok('다른 alias=x 반영', () => assert.ok(/\bx\.is_active\s*=\s*true\b/.test(fx) && /u\.phone\s*=\s*x\.phone/.test(fx)));
ok('AND로 시작 안 함(호출부가 앞에 AND 붙임)', () => assert.ok(!/^\s*AND\b/.test(f.trim())));

console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 테스트 실행 → 실패 확인**

Run: `npx ts-node packages/backend/src/utils/__tests__/journey-safety-filter.verify.ts`
Expected: FAIL — `Cannot find module '../journey-safety-filter'`.

- [ ] **Step 3: 최소 구현 작성**

`packages/backend/src/utils/journey-safety-filter.ts`:
```ts
/**
 * 여정 공통 안전필터 — 모든 trigger 추출이 무조건 적용하는 단일 컨트롤타워.
 *
 * 반환 = customers(또는 customers를 join한 alias)에 대한 SQL 조각(파라미터 0개).
 * 호출부는 ` AND ${buildJourneySafetyFilter('c')}` 형태로 WHERE에 이어 붙인다.
 *
 * 영구 원칙:
 *   - 전 trigger 무조건 적용(customer_conditions 유무와 독립). JOIN 조건부 금지.
 *   - 회사 격리 company_id = $N 절은 각 호출부 WHERE에 이미 있어 그대로 둔다.
 *   - is_opt_out / is_invalid 는 nullable → IS NOT TRUE(NULL=발송 가능).
 *   - 수신거부(unsubscribes)는 회사+전화번호 기준 안티조인(executor의 user_id 기준보다 넓게 차단).
 */
export function buildJourneySafetyFilter(alias: string): string {
  const a = alias;
  return (
    `${a}.is_active = true ` +
    `AND ${a}.sms_opt_in = true ` +
    `AND ${a}.is_opt_out IS NOT TRUE ` +
    `AND ${a}.is_invalid IS NOT TRUE ` +
    `AND NOT EXISTS (SELECT 1 FROM unsubscribes u ` +
    `WHERE u.company_id = ${a}.company_id AND u.phone = ${a}.phone)`
  );
}
```

- [ ] **Step 4: 테스트 실행 → 통과 확인**

Run: `npx ts-node packages/backend/src/utils/__tests__/journey-safety-filter.verify.ts`
Expected: PASS — `8 assertions passed`.

- [ ] **Step 5: 타입 체크**

Run(packages/backend 기준): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: 작업 단위 종료 — Harold 커밋** (AI는 git 미실행)

---

## Task 2: extractor 5개 분기 + simulator에 안전필터 적용

**Files:**
- Modify: `packages/backend/src/utils/journey-target-extractor.ts`
- Modify: `packages/backend/src/utils/journey-simulator.ts`

- [ ] **Step 1: import 추가** (extractor 상단)

`journey-target-extractor.ts` 기존:
```ts
import { applyCustomerConditions } from './journey-simulator';
```
추가:
```ts
import { applyCustomerConditions } from './journey-simulator';
import { buildJourneySafetyFilter } from './journey-safety-filter';
```

- [ ] **Step 2: `customer.created` 분기 — 인라인 is_active/sms_opt_in 제거 + 안전필터**

기존 WHERE:
```sql
WHERE c.company_id = $1::uuid
  AND c.is_active = true
  AND c.sms_opt_in = true
  AND c.created_at >= NOW() - ($2 || ' hours')::interval
  ${cond ? ` AND ${cond}` : ''}
```
변경 후(TS 템플릿):
```ts
`SELECT id AS customer_id FROM customers c
 WHERE c.company_id = $1::uuid
   AND c.created_at >= NOW() - ($2 || ' hours')::interval
   AND ${buildJourneySafetyFilter('c')}
   ${cond ? ` AND ${cond}` : ''}
 ORDER BY c.created_at DESC
 LIMIT $${params.length}::int`
```
(주: created_at recency는 Phase 1에서 유지 — Phase 2에서 진입 원장으로 교체.)

- [ ] **Step 3: `customer.dormant` 분기 — 동일 적용**

기존 `AND c.is_active = true AND c.sms_opt_in = true` 줄을 제거하고, `recent_purchase_date` 조건 뒤에 `AND ${buildJourneySafetyFilter('c')}` 추가. ORDER BY/LIMIT 그대로.

- [ ] **Step 4: `customer.birthday_approaching` 분기 — 동일 적용**

기존 `AND c.is_active = true AND c.sms_opt_in = true` 제거, 생일 매칭 괄호 뒤에 `AND ${buildJourneySafetyFilter('c')}` 추가.

- [ ] **Step 5: `cdp.cart_abandon` 분기 — customers 항상 JOIN + 안전필터**

기존:
```ts
`...SELECT a.customer_id
  FROM abandoned a
  ${cond ? `INNER JOIN customers c ON c.id = a.customer_id` : ''}
  WHERE NOT EXISTS ( ...checkout/purchase... )
  ${cond ? ` AND ${cond}` : ''}
  LIMIT $${params.length}::int`
```
변경 후:
```ts
`...SELECT a.customer_id
  FROM abandoned a
  INNER JOIN customers c ON c.id = a.customer_id AND c.company_id = $1::uuid
  WHERE NOT EXISTS ( ...checkout/purchase... )
    AND ${buildJourneySafetyFilter('c')}
    ${cond ? ` AND ${cond}` : ''}
  LIMIT $${params.length}::int`
```
(JOIN을 항상 하므로 `${cond ? 'INNER JOIN...' : ''}` 조건부 제거. cond는 c.field 참조 — 항상 join이라 유효.)

- [ ] **Step 6: `selectCdpEvent`(purchase/reservation) — customers 항상 JOIN + 안전필터**

기존:
```ts
`SELECT DISTINCT e.customer_id FROM cdp_events e
 ${cond ? `INNER JOIN customers c ON c.id = e.customer_id` : ''}
 WHERE e.company_id = $1::uuid
   AND e.event_name = $2
   AND e.customer_id IS NOT NULL
   AND e.occurred_at >= NOW() - ($3 || ' minutes')::interval
   ${cond ? ` AND ${cond}` : ''}
 LIMIT $${params.length}::int`
```
변경 후:
```ts
`SELECT DISTINCT e.customer_id FROM cdp_events e
 INNER JOIN customers c ON c.id = e.customer_id AND c.company_id = $1::uuid
 WHERE e.company_id = $1::uuid
   AND e.event_name = $2
   AND e.customer_id IS NOT NULL
   AND e.occurred_at >= NOW() - ($3 || ' minutes')::interval
   AND ${buildJourneySafetyFilter('c')}
   ${cond ? ` AND ${cond}` : ''}
 LIMIT $${params.length}::int`
```

- [ ] **Step 7: `journey-simulator.ts` matchTriggerCustomers — baseWhere 통일**

기존:
```ts
let baseWhere = `c.company_id = $1::uuid AND c.is_active = true AND c.sms_opt_in = true`;
```
변경 후(상단에 `import { buildJourneySafetyFilter } from './journey-safety-filter';` 추가):
```ts
let baseWhere = `c.company_id = $1::uuid AND ${buildJourneySafetyFilter('c')}`;
```
(미리보기·시뮬레이터가 실발송 추출과 동일한 안전 기준을 쓰게 됨.)

- [ ] **Step 8: 타입 체크**

Run(packages/backend): `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 9: 전수 grep 자가검증 — 빠진 분기 0건**

Run: `rg -n "is_active = true|INNER JOIN customers" packages/backend/src/utils/journey-target-extractor.ts`
확인:
- `c.is_active = true` 인라인 잔존 0건(전부 buildJourneySafetyFilter로 이동).
- cdp 두 분기의 `INNER JOIN customers` 가 조건부(`${cond ? ...}`)가 아니라 항상 JOIN인지.
Run: `rg -n "buildJourneySafetyFilter" packages/backend/src/utils/journey-target-extractor.ts`
확인: 5개 분기(created/dormant/birthday/cart_abandon/selectCdpEvent) 전부 = 5건 이상.

- [ ] **Step 10: Harold 실행 — read-only 검증 SQL(발송 0, 단순 SELECT)**

opt-out/무효 고객이 실제로 제외되는지 실데이터로 확인(회사 1곳 id로). 신규가입 분기 기준:
```sql
-- 안전필터 적용 전(전체) vs 후(필터) 카운트 비교 — 차이 = 제외된 수신거부/무효
WITH base AS (
  SELECT id, is_active, sms_opt_in, is_opt_out, is_invalid, phone, company_id
  FROM customers
  WHERE company_id = '<회사_uuid>'
    AND created_at >= NOW() - INTERVAL '24 hours'
)
SELECT
  COUNT(*) AS 전체_최근24h,
  COUNT(*) FILTER (
    WHERE is_active = true AND sms_opt_in = true
      AND is_opt_out IS NOT TRUE AND is_invalid IS NOT TRUE
      AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = base.company_id AND u.phone = base.phone)
  ) AS 안전필터_통과
FROM base;
```
기대: `안전필터_통과 <= 전체`. 차이가 그 회사의 수신거부·무효번호 수와 맞으면 정상.

- [ ] **Step 11: 작업 단위 종료 — Harold 커밋·배포**

---

## Self-Review (spec 대조)

- **결함 #3(cdp opt-out/is_active 누락)** → Task 2 Step 5·6(cdp 항상 JOIN + 안전필터). ✓
- **결함 #8(is_invalid 누락)** → 필터에 `is_invalid IS NOT TRUE` 포함, 전 분기. ✓
- **설계 5절(공통 안전필터 단일 CT)** → Task 1 `buildJourneySafetyFilter`. ✓
- **미리보기≠실발송(결함 #9) 일부** → Task 2 Step 7(simulator 통일). 추출 SQL 자체 통일은 Phase 9에서 마저. ✓(부분)
- Placeholder/TODO 0건 — 모든 step에 실제 코드/명령. ✓
- 타입 일관성 — `buildJourneySafetyFilter(alias: string): string` 한 시그니처를 Task 1 정의·Task 2 사용 동일. ✓

## 비범위(Phase 1)
- created_at recency 교체(→Phase 2 진입 원장), LIMIT 제거(→Phase 5/6 묶음 발송 동반), 이벤트 커서(→Phase 3). Phase 1은 **안전필터만**.
