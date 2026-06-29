# 크레딧 모델 v2 — 엔진 구현 계획 (P1~P4)

> **실행:** 비토가 이 세션에서 인라인으로 직접, 하나씩(병렬 금지). 배포는 Harold님 1회(P5 UI까지 끝낸 뒤).
> **스펙:** [2026-06-30-credit-model-v2-design.md](../specs/2026-06-30-credit-model-v2-design.md)

**Goal:** 크레딧 단가 재조정 + DB 규모 일일 분석 공식 + 여정·자동마케팅 운영 과금 + 음수 허용/리셋 상계 — 백엔드 엔진 일괄.

**Architecture:** 모든 신규 규칙은 컨트롤타워 2파일에 집중 — 순수계산 `ai-credit-calc.ts`, 트랜잭션 `ai-credit-tx.ts`. 차감 부착점(worker/executor/operator)은 cost·source·멱등키만 교체. 프론트는 `credit.ts` 단일 상수 1:1.

**Tech:** Node/Express + TS, `node:assert` 단위검증(`__tests__/*.verify.ts`, ts-node), PostgreSQL. 빌드 = 영역별 `npm run build:safe`.

**검증 실행:** `cd packages/backend && npx ts-node src/utils/__tests__/ai-credit-calc.verify.ts` (PIPESTATUS·절대경로 주의 — [[project_2026_0627_copy_brain_rag]] cwd tsc 함정).

---

## P1 — 크레딧 단가 재조정 (순수 상수)

### Task P1-1: CREDIT_COST_MAP 단가 교체 + 신규 source

**Files:** Modify `packages/backend/src/utils/ai-credit-calc.ts:84-151` · Test `packages/backend/src/utils/__tests__/ai-credit-calc.verify.ts`

- [ ] **Step 1 — verify 테스트 먼저(교체/추가):**
```ts
ok('꾸미기 ai-operator-decorate = 3', () => assert.strictEqual(getCreditCost('ai-operator-decorate'), 3));
ok('DM 발행 dm-builder = 100', () => assert.strictEqual(getCreditCost('dm-builder'), 100));
ok('인앱 게시 inapp-publish = 100', () => assert.strictEqual(getCreditCost('inapp-publish'), 100));
ok('이메일 발행 email-ai-publish = 50', () => assert.strictEqual(getCreditCost('email-ai-publish'), 50));
ok('인터랙션 발행 dm-interaction-publish = 120', () => assert.strictEqual(getCreditCost('dm-interaction-publish'), 120));
ok('여정 활성화 journey-activate = 200', () => assert.strictEqual(getCreditCost('journey-activate'), 200));
ok('여정 운영 journey-operation = 10', () => assert.strictEqual(getCreditCost('journey-operation'), 10));
ok('자동마케팅 발송 continuous-operator-send = 10', () => assert.strictEqual(getCreditCost('continuous-operator-send'), 10));
```
  기존 `continuous-operator-send = 3` assert(81줄)는 10으로 교체.
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — CREDIT_COST_MAP 교체(정확한 키):**
  - `'journey-activate': 150` → `200`
  - `'continuous-operator-send': 3` → `10`
  - `'dm-builder': 30` → `100`
  - `'dm-interaction-publish': 50` → `120`
  - `'inapp-publish': 15` → `100`
  - `'email-ai-publish': 30` → `50`
  - 신규 추가: `'ai-operator-decorate': 3,` (꾸미기 — 주석 "데이터 컬럼 적용, 다듬기 위")
  - 신규 추가: `'journey-operation': 10,` (여정·자동마케팅 실행 운영 과금. 동일 여정 하루 1회 멱등)
- [ ] **Step 4 — run → PASS.**

### Task P1-2: 꾸미기 인라인 creditCost 제거 (map 단일 진실)

**Files:** Modify `packages/backend/src/utils/operator-message-decorator.ts:73`

- [ ] `creditCost: 1,` 라인 **제거**. `source: 'ai-operator-decorate'`가 map(=3)으로 자동 해석(`callAIWithFallback`: `params.creditCost ?? getCreditCost(source)`). 인라인 제거 = 컨트롤타워 단일 진실.
- [ ] grep 확인: `creditCost: 1` 잔존 0 (decorator).

### Task P1-3: frontend credit.ts 1:1 동기화

**Files:** Modify `packages/frontend/src/constants/credit.ts`

- [ ] **CREDIT_TASK_COSTS(21-31줄) 갱신** — 작업당 박스 표시값. 신규 표 반영:
  - `journey` 여정 설계 150 → **여정 활성화 200**
  - `dm` DM 발행 30 → **100**
  - `inapp` 인앱 게시 15 → **100**
  - `send` 자동 발송 3 → **여정·운영 발송 10**
  - 신규: `{ key: 'decorate', label: '꾸미기', cost: 3, icon: Wand2 }`, `{ key: 'email', label: '이메일 발행', cost: 50, icon: ... }`
- [ ] **CONFIRM_CREDIT_COSTS(101-109줄):** `dm-builder` 100, `email-ai-publish` 50, `inapp-publish` 100, `journey-activate` 200, 신규 `'dm-interaction-publish': 120`. (`continuous-operator` 200 유지, `orchestrate` 300 유지.)
- [ ] **CREDIT_SOURCE_LABELS(74-98줄):** 신규 `'ai-operator-decorate': '꾸미기'`, `'journey-operation': '여정 운영'`.
- [ ] grep 자가검증: 모델명 0 · 백엔드 map과 단가 1:1.

---

## P2 — DB 일일 분석 규모 공식

### Task P2-1: dailyDbAnalysisCredits 순수함수 + 테스트

**Files:** Modify `ai-credit-calc.ts` · Test `ai-credit-calc.verify.ts`

- [ ] **Step 1 — 테스트 먼저(반올림 정수):**
```ts
ok('DB분석 10만=3', () => assert.strictEqual(dailyDbAnalysisCredits(100000), 3));
ok('DB분석 ≤10만=3', () => assert.strictEqual(dailyDbAnalysisCredits(20000), 3));
ok('DB분석 20만=5(4.5 반올림)', () => assert.strictEqual(dailyDbAnalysisCredits(200000), 5));
ok('DB분석 30만=6', () => assert.strictEqual(dailyDbAnalysisCredits(300000), 6));
ok('DB분석 80만=14(13.5 반올림)', () => assert.strictEqual(dailyDbAnalysisCredits(800000), 14));
ok('DB분석 100만=17(16.5 반올림)', () => assert.strictEqual(dailyDbAnalysisCredits(1000000), 17));
ok('DB분석 300만=47(46.5 반올림)', () => assert.strictEqual(dailyDbAnalysisCredits(3000000), 47));
ok('DB분석 0명=0', () => assert.strictEqual(dailyDbAnalysisCredits(0), 0));
```
- [ ] **Step 2 — run → FAIL.**
- [ ] **Step 3 — 구현(ai-credit-calc.ts, getCreditCost 근처):**
```ts
/**
 * DB 규모 일일 분석 차감 (연동 회사 매일 1회). 1크레딧=500원.
 *  - 10만블록 = ceil(고객수/10만). 매일 = 3 + (블록−1)×1.5, 정수 반올림.
 *  - 0명 = 0(차감 없음). 예: 10만 3 / 20만 5 / 30만 6 / 100만 17 / 300만 47.
 */
export function dailyDbAnalysisCredits(customerCount: number): number {
  const n = Math.max(0, Math.floor(Number(customerCount) || 0));
  if (n === 0) return 0;
  const blocks = Math.ceil(n / 100000);
  return Math.round(3 + (blocks - 1) * 1.5);
}
```
- [ ] **Step 4 — run → PASS.**

### Task P2-2: predictive-worker 차감을 회사별 고객수 공식으로

**Files:** Modify `packages/backend/src/utils/predictive-worker.ts:79,97-127`

- [ ] import에 `dailyDbAnalysisCredits` 추가(`from './ai-credit-calc'`).
- [ ] 루프 밖 `const cost = getCreditCost('predictive-daily'); // 3`(79줄) **제거** — cost를 회사별로 루프 안에서 계산.
- [ ] 루프 안(97줄~), 각 회사 `row.id`에 대해 고객수 카운트 후 cost 산정:
```ts
const cntRes = await query(`SELECT COUNT(*)::int AS n FROM customers WHERE company_id = $1::uuid`, [row.id]);
const cost = dailyDbAnalysisCredits(Number(cntRes.rows[0]?.n) || 0);
if (cost <= 0) continue; // 고객 0 = 분석 차감 없음
```
  이 `cost`를 기존 `checkCredit(row.id, cost)`·`deductCreditSafe({cost,...})`에 그대로 사용(멱등키 `predictive-daily:${row.id}:${todayKst}` 유지). source `predictive-daily` 유지.
- [ ] 로그 메시지의 "매일 3크레딧" 문구 → "DB 규모별 매일 차감"으로 정정(41줄·console).

### Task P2-3: 수동 재계산 차감도 공식으로

**Files:** Modify `packages/backend/src/routes/ai.ts:3719-3725`

- [ ] `const cost = getCreditCost('predictive-daily');`(3719줄) → 해당 `companyId` 고객수 카운트 후 `dailyDbAnalysisCredits(n)`로 교체. 멱등키 `predictive-daily:${companyId}:${kstDateTag(new Date())}` 유지(= 워커와 같은 키 → 그날 이미 차감됐으면 멱등 no-op).

### Task P2-4: "매일 자동 예측" 토글 폐지 — 연동=항상

**Files:** Modify `predictive-worker.ts:85-95`

- [ ] 타깃 SELECT에서 `predictive_enabled` 게이트 제거 → **연동 회사(sync_agents OR cdp_events.source='custom_sdk') 항상 포함**. (비연동 수동 ON 분기 제거.) 주석 정정.
```sql
SELECT DISTINCT c.id FROM companies c
 WHERE EXISTS (SELECT 1 FROM sync_agents sa WHERE sa.company_id = c.id)
    OR EXISTS (SELECT 1 FROM cdp_events ce WHERE ce.company_id = c.id AND ce.source = 'custom_sdk')
 ORDER BY c.id
```
- [ ] `predictive_enabled` 컬럼은 남겨두되 미사용(프론트 토글은 P5에서 제거). DROP 안 함(안전).

---

## P3 — 여정·자동마케팅 운영 과금 (10/실행 · 하루 1회)

### Task P3-1: journey-executor 발송 성공 시점 운영 차감

**Files:** Modify `packages/backend/src/utils/journey-executor.ts` (큐 INSERT 성공 직후 = step_log 'sent' 마커·발송비 차감 구간, ~827-843)

- [ ] **company_id 출처 주의** — `journey_executions`에 `company_id` 없음(2026-06-29 실측 확인). `journeys.company_id`에서 가져온다. `processExecution`이 이미 journey row(company_id 포함)를 로드하면 그 값 재사용; 아니면 1 SELECT:
```ts
import { kstDateTag } from './ai-credit-calc';
// 발송 확정(큐 INSERT 성공) 직후:
const jc = await query(`SELECT company_id FROM journeys WHERE id = $1::uuid`, [exec.journey_id]);
const opCompanyId = jc.rows[0]?.company_id || null;
await deductCreditSafe({
  companyId: opCompanyId,
  cost: getCreditCost('journey-operation'),          // 10
  source: 'journey-operation',
  idempotencyKey: `journey-operation:${exec.journey_id}:${kstDateTag(new Date())}`,
  createdBy: null,
});
```
  멱등키 = `여정:날짜` → 그날 그 여정 첫 발송 1건만 10 차감, 나머지 실행은 멱등 no-op = **동일 여정 하루 1회 상한**. (마이너스 허용은 P4가 source `journey-operation`을 음수 허용군에 넣어 처리.)
- [ ] 발송비(기존 balance 차감)와 **별개**임을 확인 — 이건 ai_credit_transactions(크레딧), 발송비는 별 시스템. 이중과금 아님.

### Task P3-2: 자동마케팅 발송 멱등을 일 단위 캡으로

**Files:** Modify `packages/backend/src/utils/continuous-operator.ts:1028-1031,1265-1266`

- [ ] `continuous-operator-send` 차감(이미 P1로 10) 멱등키를 **`continuous-operator-send:${operatorId}:${kstDateTag(new Date())}`** 로 통일(operator 하루 1회 캡). 현재 `:${row.id}` / `:${proposalId}`는 발송 건마다 → 일 단위로 묶어 "운영 하루 1회 10" 정합. source `continuous-operator-send`를 P4 음수 허용군에 포함.
- [ ] 1265줄·1028줄 두 곳 일관 적용. (※ 구현 시 operatorId 변수명·범위 코드 확인 후 정확 주입.)

---

## P4 — 음수 허용(source 한정) + 리셋 상계 (가장 위험 · TDD 최우선)

### Task P4-1: isOperationSource 순수 헬퍼 + 테스트

**Files:** Modify `ai-credit-calc.ts` · Test `ai-credit-calc.verify.ts`

- [ ] 테스트:
```ts
ok('운영 source journey-operation = true', () => assert.strictEqual(isOperationSource('journey-operation'), true));
ok('운영 source continuous-operator-send = true', () => assert.strictEqual(isOperationSource('continuous-operator-send'), true));
ok('분석 predictive-daily = false', () => assert.strictEqual(isOperationSource('predictive-daily'), false));
ok('발행 dm-builder = false', () => assert.strictEqual(isOperationSource('dm-builder'), false));
```
- [ ] 구현:
```ts
/** 운영(반복) 발송 source — 마이너스 허용 대상(활성 여정·자동마케팅 실행). 그 외는 0에서 차단. */
const OPERATION_SOURCES = new Set(['journey-operation', 'continuous-operator-send']);
export function isOperationSource(source: string | undefined | null): boolean {
  return !!source && OPERATION_SOURCES.has(source);
}
```

### Task P4-2: _deductWithClient — 운영 source만 음수 허용(−1개월 grant 상한)

**Files:** Modify `packages/backend/src/utils/ai-credit-tx.ts:139-145` · Test `ai-credit-tx.verify.ts`(mock client)

- [ ] 테스트(mock client): ① journey-operation은 base=0이어도 −planCredits까지 차감 성공(base 음수) ② −planCredits 초과 시 InsufficientCreditError ③ dm-builder는 base=0에서 즉시 InsufficientCreditError(음수 불가).
- [ ] import에 `isOperationSource` 추가.
- [ ] `overageAllowed` 산정 교체(140줄):
```ts
const planCredits = Number(row.plan_credits) || 0;
const overageAllowed = isOperationSource(opts.source)
  ? planCredits                                                   // 운영 = −1개월 grant 상한까지 음수 허용
  : (String(row.billing_type) === 'postpaid' ? Math.max(0, Number(row.overage_limit) || 0) : 0);
```
  가드(142줄 `if ((base+purchased) - cost < -overageAllowed) throw`)·`baseAfter` 누적 로직은 그대로(이미 음수 누적 구조). 운영 source는 이 경로로 base 음수 누적 → P4-3이 다음달 상계.

### Task P4-3: applyResetIfNeeded — 음수 상계(덮어쓰기 금지)

**Files:** Modify `packages/backend/src/utils/ai-credit-tx.ts:81-89` · Test `ai-credit-tx.verify.ts`

- [ ] 테스트: base=−150, planCredits=300 → 리셋 후 base=150(=300−150). base=200(양수) → 리셋 후 300(상계 없음, 양수 잔액은 이월 안 함=기존동작).
- [ ] 구현(81-89줄):
```ts
const planCredits = Number(row.plan_credits) || 0;
const prevBase = Number(row.base) || 0;
const carriedBase = planCredits + Math.min(0, prevBase);  // 음수만 다음달 grant에서 상계(양수는 이월 안 함)
await client.query(
  `UPDATE companies SET ai_credits_base_remaining = $2, ai_credits_reset_at = NOW() WHERE id = $1::uuid`,
  [companyId, carriedBase]
);
```
  reset 이력 INSERT의 `amount`/`balance_base_after`도 `carriedBase` 기준으로 정정.

---

## 마무리 (P4 후, P5 UI 전)

- [ ] 백엔드 build:safe + 전 verify 통과(ai-credit-calc·ai-credit-tx).
- [ ] grep 자가검증: 인라인 creditCost 잔존 0 · 모델명 0 · 박-단어 0 · native dialog 0.
- [ ] 실측 1건 시나리오 보고(발송·돈): journey-operation 1회 차감·재실행 멱등 0 / 음수→다음달 상계 / DB 공식 1개 회사.
- [ ] **P5(UI) 별도 계획 → 두 계획 다 끝난 뒤 Harold님 1회 배포 + Codex `adversarial-review`(돈·DB).**

## 미확정(구현 중 코드로 확정)
- `journey-executor` ExecutionRow에 `company_id`·`journey_id` 컬럼 포함 여부(없으면 SELECT 추가).
- `continuous-operator` operatorId 변수 범위(1028·1265 주입점).
- `predictive_enabled` 제거가 다른 소비처(라우트·프론트) 영향 — grep 전수.
