# 여정 Phase 2 — 진입 원장(Entry Ledger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (인라인, 한 task씩). Steps use `- [ ]`.
> **상위 설계서:** `docs/superpowers/specs/2026-06-04-journey-engine-redesign-design.md` (Phase 2).
> **배포는 마지막에 한 번** (Harold 명시). DDL은 한 마이그레이션 파일에 누적.

**Goal:** 신규가입 여정이 **시스템의 고객 식별자(회사+매장코드+전화번호)** 기준으로 "전에 본 적 없는 고객"만 진입시키도록, 진입 원장 테이블을 신설하고 created_at 의존을 완전히 제거한다. created_at·id가 어디서 바뀌든·전체삭제 후 재업로드든 무관하게 오발송·재발송 0.

**Architecture:** `journey_entry_ledger`(journey_id + company_id + store_code + phone + kind) 신설. 활성화 시 그 시점 전체 고객 식별자를 `baseline`으로 1회 적재. 신규가입 추출 = 안전필터 + **원장에 없는 식별자**(NOT EXISTS 안티조인). 진입 시 `entered` 행을 같은 트랜잭션으로 기록. 대량 진입은 2차 차단기로 정지+안내. 원장은 journeys에 FK CASCADE(여정 삭제 시 정리), customers에는 FK 안 검(고객 삭제돼도 기억 보존).

**Tech Stack:** TypeScript · pg · node:assert + ts-node 검증. **신규 컬럼/테이블은 전부 이 plan의 마이그레이션으로 생성**(information_schema 덤프로 부재 확인 완료 — journey_entry_ledger·journeys.entry_baseline_at 둘 다 없음).

**검증된 사실(2026-06-04):**
- 업로드(`upload.ts:581·726`)·동기화 = `customer-upsert.ts` upsert, 충돌 키 `(company_id, COALESCE(store_code,'__NONE__'), phone)`, id·created_at 보존.
- `customers`: company_id(uuid)·store_code(varchar,null)·phone(varchar,NOT NULL) 존재.
- `journeys.approved_at`은 재활성화 때 리셋 → baseline 전용 컬럼 `entry_baseline_at`을 따로 둠(1회 설정·불변).

---

## 원장이 닿는 7곳 (전수 — 하나도 안 빠뜨림)

| # | 닿는 곳 | 파일 | 무엇 |
|---|---|---|---|
| T1 | 스키마 | 마이그레이션 .sql | journey_entry_ledger + journeys.entry_baseline_at |
| T2 | 원장 CT | `utils/journey-entry-ledger.ts`(신규) | 안티조인 빌더(순수) + seedBaseline + recordEntered + hasBaseline |
| T3 | 활성화 | `utils/journey-builder.ts` activateJourney | customer.created 첫 활성화 시 baseline 적재 |
| T4 | 추출 | `utils/journey-target-extractor.ts` customer.created | created_at 폐기 → 원장 안티조인(활성)/created_at 창(초안 미리보기) |
| T5 | 진입 기록 | `utils/journey-trigger-watcher.ts` enqueueCandidates | execution INSERT와 같은 txn에 entered 기록 |
| T6 | 대량 차단기 | `utils/journey-trigger-watcher.ts` processJourneyTrigger | 후보 > threshold_recipients_per_step 시 정지+안내, 진입 0 |
| T7 | 호출부 전수 | extractor 호출 전부 | journeyId 인자 추가(preview·simulator·ai sample) |

---

## Task 1: 스키마 (마이그레이션 누적)

**Files:** Create: `docs/superpowers/plans/2026-06-04-journey-redesign.sql` (전 Phase DDL 누적, Harold가 배포 시 1회 실행)

- [ ] **Step 1: 마이그레이션 파일 생성 + Phase 2 DDL 추가**

```sql
-- ════════════════════════════════════════════════════════════
-- 여정 엔진 재설계 마이그레이션 (2026-06-04) — 배포 시 1회 실행
-- ════════════════════════════════════════════════════════════

-- Phase 2: 진입 원장
CREATE TABLE IF NOT EXISTS journey_entry_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id  uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL,
  store_code  varchar,                    -- nullable, customers.store_code와 동일
  phone       varchar NOT NULL,
  kind        varchar NOT NULL,           -- 'baseline' | 'entered'
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
-- 시스템 고객 식별자(upsert 충돌 키와 동일) — 한 식별자는 여정당 한 번만
CREATE UNIQUE INDEX IF NOT EXISTS uq_journey_entry_ledger_identity
  ON journey_entry_ledger (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone);
CREATE INDEX IF NOT EXISTS idx_journey_entry_ledger_journey
  ON journey_entry_ledger (journey_id);

-- 신규가입 baseline 설정 시각(첫 활성화 때 1회, 이후 불변)
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS entry_baseline_at timestamptz;
```

- [ ] **Step 2: tsc 영향 없음(.sql) — 다음 task로**

---

## Task 2: 원장 컨트롤타워 (`utils/journey-entry-ledger.ts`)

**Files:** Create: `utils/journey-entry-ledger.ts` · Test: `utils/__tests__/journey-entry-ledger.verify.ts`

- [ ] **Step 1: 실패 테스트(순수 안티조인 빌더)**

```ts
import assert from 'node:assert';
import { buildLedgerAntiJoin } from '../journey-entry-ledger';
let passed = 0; const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const frag = buildLedgerAntiJoin('c', 9);  // alias=c, journeyId 파라미터 = $9
ok('NOT EXISTS + 원장 테이블', () => assert.ok(/NOT\s+EXISTS\s*\([\s\S]*journey_entry_ledger\s+l/.test(frag)));
ok('journey_id 파라미터 $9', () => assert.ok(/l\.journey_id\s*=\s*\$9/.test(frag)));
ok('company_id 매칭', () => assert.ok(/l\.company_id\s*=\s*c\.company_id/.test(frag)));
ok('store_code COALESCE 매칭(upsert 키와 동일)', () =>
  assert.ok(/COALESCE\(l\.store_code,\s*'__NONE__'\)\s*=\s*COALESCE\(c\.store_code,\s*'__NONE__'\)/.test(frag)));
ok('phone 매칭', () => assert.ok(/l\.phone\s*=\s*c\.phone/.test(frag)));
ok('alias 치환', () => assert.ok(/u?l\.phone = x\.phone/.test(buildLedgerAntiJoin('x', 3))));
console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 실행 → RED** — `npx ts-node ...journey-entry-ledger.verify.ts` → 모듈 없음 실패.

- [ ] **Step 3: 구현**

```ts
import { query } from '../config/database';

/** 신규가입 추출용 안티조인 — 원장에 없는 고객 식별자만 통과(시스템 upsert 키와 동일 기준). 파라미터 0개 외 journeyId는 호출부 $N 재사용. */
export function buildLedgerAntiJoin(custAlias: string, journeyParamIndex: number): string {
  const a = custAlias;
  return (
    `NOT EXISTS (SELECT 1 FROM journey_entry_ledger l ` +
    `WHERE l.journey_id = $${journeyParamIndex} ` +
    `AND l.company_id = ${a}.company_id ` +
    `AND COALESCE(l.store_code, '__NONE__') = COALESCE(${a}.store_code, '__NONE__') ` +
    `AND l.phone = ${a}.phone)`
  );
}

/** 활성화 시점 baseline 적재 — 그 시점 회사 전체 고객 식별자를 'baseline'으로 1회. 멱등(ON CONFLICT). entry_baseline_at 설정. */
export async function seedBaselineForJourney(journeyId: string, companyId: string): Promise<{ seeded: number }> {
  const r = await query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind)
     SELECT $1::uuid, c.company_id, c.store_code, c.phone, 'baseline'
       FROM customers c
      WHERE c.company_id = $2::uuid AND c.phone IS NOT NULL AND c.phone <> ''
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone) DO NOTHING`,
    [journeyId, companyId],
  );
  await query(`UPDATE journeys SET entry_baseline_at = NOW() WHERE id = $1::uuid AND entry_baseline_at IS NULL`, [journeyId]);
  return { seeded: r.rowCount || 0 };
}

/** 진입 기록 — 호출부 트랜잭션 client로 execution INSERT와 원자 처리. */
export async function recordEnteredWithClient(
  client: { query: (sql: string, params?: any[]) => Promise<any> },
  journeyId: string, companyId: string, storeCode: string | null, phone: string,
): Promise<void> {
  await client.query(
    `INSERT INTO journey_entry_ledger (journey_id, company_id, store_code, phone, kind)
     VALUES ($1::uuid, $2::uuid, $3, $4, 'entered')
     ON CONFLICT (journey_id, company_id, COALESCE(store_code, '__NONE__'), phone) DO NOTHING`,
    [journeyId, companyId, storeCode, phone],
  );
}

/** baseline 적재 여부(추출이 원장 모드인지 created_at 추정 모드인지 가름). */
export async function hasBaseline(journeyId: string): Promise<boolean> {
  const r = await query(`SELECT entry_baseline_at FROM journeys WHERE id = $1::uuid`, [journeyId]);
  return !!r.rows[0]?.entry_baseline_at;
}
```

- [ ] **Step 4: 실행 → GREEN** + **Step 5: tsc 0** + **Step 6: 박-단어/모델명 grep 0**.

---

## Task 3: 활성화 시 baseline 적재 (`journey-builder.ts` activateJourney)

**Files:** Modify: `utils/journey-builder.ts` (activateJourney, 활성화 성공 직후 블록 — 현 createJourneyStepSnapshots/scheduleNotifications 옆)

- [ ] **Step 1: import** — `import { seedBaselineForJourney } from './journey-entry-ledger';`
- [ ] **Step 2: 활성화 성공(`r.rows.length > 0`) 블록에 추가**

```ts
// ★ Phase 2: 신규가입 여정 첫 활성화 시 baseline 적재(그 시점 기존 고객 = 신규 아님).
try {
  const jrow = await query(`SELECT trigger_event, entry_baseline_at FROM journeys WHERE id = $1::uuid`, [journeyId]);
  if (jrow.rows[0]?.trigger_event === 'customer.created' && !jrow.rows[0]?.entry_baseline_at) {
    const { seeded } = await seedBaselineForJourney(journeyId, companyId);
    console.log(`[activateJourney] 진입 원장 baseline 적재 journey=${journeyId} seeded=${seeded}`);
  }
} catch (e: any) {
  // baseline 실패 = 활성화 자체는 진행하되 경고(다음 trigger 폴에서 hasBaseline=false면 추정 모드 — 오발송 위험이므로 아래 T4에서 baseline 없으면 진입 보류)
  console.warn('[activateJourney] baseline 적재 실패:', e?.message);
}
```
- [ ] **Step 3: tsc 0.**

---

## Task 4: 추출 — customer.created 원장 안티조인 (`journey-target-extractor.ts`)

**Files:** Modify: `journey-target-extractor.ts`

- [ ] **Step 1: 시그니처에 journeyId 추가**

```ts
export async function selectJourneyTargetCustomerIds(
  companyId: string, triggerEvent: string, triggerFilters: Record<string, any>,
  limit: number, journeyId?: string,
): Promise<string[]> {
```

- [ ] **Step 2: import** — `import { buildLedgerAntiJoin, hasBaseline } from './journey-entry-ledger';`

- [ ] **Step 3: customer.created 분기 재작성**

```ts
case 'customer.created': {
  const params: any[] = [companyId];
  const useLedger = !!journeyId && (await hasBaseline(journeyId));
  let entryClause: string;
  if (useLedger) {
    params.push(journeyId);                      // $2 = journeyId
    entryClause = buildLedgerAntiJoin('c', params.length);
  } else {
    // 초안/미리보기(baseline 없음) = created_at 최근 창으로 "추정"만 (실발송 아님)
    params.push(String(Number(filters.recent_hours || 24)));   // $2 = hours
    entryClause = `c.created_at > NOW() - ($${params.length} || ' hours')::interval`;
  }
  const cond = applyCustomerConditions(filters.customer_conditions || [], filters.logic || 'AND', params);
  params.push(String(limit));
  const r = await query(
    `SELECT id AS customer_id FROM customers c
     WHERE c.company_id = $1::uuid
       AND ${buildJourneySafetyFilter('c')}
       AND ${entryClause}
       ${cond ? ` AND ${cond}` : ''}
     ORDER BY c.created_at DESC
     LIMIT $${params.length}::int`,
    params,
  );
  return r.rows.map((x: any) => x.customer_id);
}
```
(주: 라이브 추출은 항상 journeyId 전달 + baseline 있음 → 원장 모드. created_at 의존 완전 제거.)

- [ ] **Step 4: tsc 0** + **Step 5: grep — customer.created 분기에 buildLedgerAntiJoin 사용 + created_at recency가 추정 분기에만 남았는지 확인.**

---

## Task 5: 진입 기록 — execution과 원자 트랜잭션 (`journey-trigger-watcher.ts` enqueueCandidates)

**Files:** Modify: `journey-trigger-watcher.ts`

- [ ] **Step 1: import** — `import { recordEnteredWithClient } from './journey-entry-ledger';` + `import { pool } from '../config/database';`(트랜잭션 client용 — 실제 export 이름은 구현 시 config/database 확인)

- [ ] **Step 2: extractor 호출에 journeyId 전달** (113행) — `selectJourneyTargetCustomerIds(j.company_id, j.trigger_event, j.trigger_filters || {}, 500, j.id)`

- [ ] **Step 3: enqueue를 customer.created일 때 원장 기록 포함 트랜잭션으로**

각 enrolled 고객에 대해(현 `for` 루프 내), execution INSERT + (customer.created면) entered 기록을 한 client 트랜잭션으로 묶는다. 고객 식별자(store_code, phone)는 INSERT 직전 `SELECT store_code, phone FROM customers WHERE id=$1`로 조회(또는 extractor가 id와 함께 반환하도록 확장 — 구현 시 결정, 후자 선호로 추가 쿼리 0).

```ts
// 트랜잭션 client 획득 (config/database pool)
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, created_at)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 0, 'active', NOW(), $3, NOW())`,
    [j.id, customerId, nextRunAt],
  );
  if (j.trigger_event === 'customer.created') {
    await recordEnteredWithClient(client, j.id, j.company_id, storeCode, phone);
  }
  await client.query('COMMIT');
} catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
```
(주: extractor가 id만 반환하므로 store_code·phone을 같이 받도록 `selectJourneyTargetCustomerRows`(id+store_code+phone) 보조 함수를 T5에서 추가 — 추가 SELECT 0. 구현 시 customer.created 경로만 rows 버전 사용.)

- [ ] **Step 4: tsc 0 + 단위검증(mock client로 BEGIN→INSERT exec→INSERT ledger→COMMIT 순서 — ai-credit-tx.verify 패턴 차용).**

---

## Task 6: 대량 차단기 (`journey-trigger-watcher.ts` processJourneyTrigger)

**Files:** Modify: `journey-trigger-watcher.ts`

- [ ] **Step 1: 후보 수 임계 검사**

processJourneyTrigger에서 ids 추출 직후, 회사가 설정한 `threshold_recipients_per_step`(NULL=무제한)보다 후보가 많으면 **진입 0 + 여정 정지 + 담당자 안내**.

```ts
const ids = await selectJourneyTargetCustomerIds(j.company_id, j.trigger_event, j.trigger_filters || {}, 500, j.id);
if (ids.length === 0) return { matched: 0, enqueued: 0, skipped: 0 };

// ★ Phase 2 대량 차단기: 한 번 진입 후보가 회사 설정 상한 초과 → 정지+안내(자동발송 X). 임의 상수 X(회사 설정값).
const cap = j.threshold_recipients_per_step;  // ActiveJourney에 SELECT 추가 필요
if (cap != null && ids.length > Number(cap)) {
  await query(`UPDATE journeys SET status='paused', paused_at=NOW(), pause_reason=$2, updated_at=NOW() WHERE id=$1::uuid AND status='active'`,
    [j.id, `대량 진입 감지(${ids.length}건 > 상한 ${cap}) — 자동 정지, 담당자 확인 필요`]);
  // 담당자 안내 = 기존 pretest-notifier/pause 알림 경로 재사용(구현 시 연결)
  console.warn(`[JourneyTrigger] 대량 차단 journey=${j.id} 후보=${ids.length} 상한=${cap}`);
  return { matched: ids.length, enqueued: 0, skipped: ids.length };
}
```

- [ ] **Step 2: ActiveJourney 쿼리에 `threshold_recipients_per_step` SELECT 추가** (67행 SELECT + 인터페이스).
- [ ] **Step 3: tsc 0.**

---

## Task 7: 호출부 전수 — journeyId 인자 (full_pattern_grep)

**Files:** grep으로 `selectJourneyTargetCustomerIds(` 전수 → 전부 journeyId 전달.

- [ ] **Step 1:** `rg -n "selectJourneyTargetCustomerIds\(" packages/backend/src` 전수 리스트.
- [ ] **Step 2:** 각 호출부에 journeyId 전달 (buildJourneyPreviewSamples는 이미 journeyId 받음 → 내려주기 / 미리보기·simulator는 draft라 baseline 없음 → 추정 모드 자동).
- [ ] **Step 3: tsc 0 + grep 잔존(journeyId 없는 호출) 0 확인.**

---

## Self-Review (spec 대조)
- 결함 #2(created_at 재업로드 취약) → T1~T7 원장으로 created_at 의존 제거. ✓
- 설계 3절(진입 원장 + baseline) → T1·T2·T3. ✓ 키 = 시스템 upsert 식별자(회사+매장+전화). ✓
- 설계 3.5절(대량 차단기) → T6, 회사 설정값 재사용(임의 상수 X). ✓
- created_at 어디서 바뀌든·id 바뀌든·전체삭제 후 재업로드든 무관 → 원장이 식별자로 기억(고객 FK 안 검). ✓
- Placeholder 0 — 각 step 실제 코드. (T5의 보조 rows 함수·pool export 이름은 구현 시 config/database 확인 후 확정 — 추측 금지.)

## 비범위(Phase 2)
- LIMIT 500 제거(→Phase 5 묶음 발송 동반), cdp 이벤트 커서(→Phase 3). Phase 2는 신규가입 진입 정확성만.
