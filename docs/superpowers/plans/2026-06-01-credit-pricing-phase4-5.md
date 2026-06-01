# 종량제 Phase 4(슈퍼관리자 크레딧) + Phase 5(고객 잔여·요금제 페이지) 구현 Plan

> **For agentic workers:** 본 세션 인라인 실행(executing-plans). CLAUDE.md 룰 우선: worktree 금지(packages 직접), git 직접 X(Harold 배포), 컨트롤타워 단일 진입점, db_column_verify, 자가 grep, 자연 한국어, 디자인 = AI 여정 동급.

**Goal:** 크레딧 차감(Phase 1-3 완료) 위에 "잔여 가시성 + 슈퍼관리자 관리" 층을 올려 업체 혼동 0 + 운영 테스트 가능.

**Architecture:** 새 패턴 X — 기존 현금 잔액(`balance-adjust` + `balance_transactions`) 구조를 크레딧(`ai_credit_transactions`)으로 미러. 잔여 조회는 `getCreditState` 재사용. 충전 = 슈퍼관리자 수동 지급(셀프 결제·자동 월말청구 제외).

**Tech Stack:** Express + PG(트랜잭션) + React + TS. 단위검증 = node:assert + ts-node(.verify.ts). 디자인 = 다크+violet, ConfirmModal/useToast.

---

## 파일 구조

- `utils/ai-credit-tx.ts` (수정) — `getMonthlyUsageWithClient`, `adjustCreditWithClient`(트랜잭션·client 주입, mock 단위검증).
- `utils/ai-credit.ts` (수정) — `getMonthlyUsage`, `adjustCredit`, `getCreditTransactions`(pool 진입점).
- `utils/__tests__/ai-credit-adjust.verify.ts` (신규) — adjust/usage 단위검증.
- `routes/companies.ts` (수정) — `GET /my-credit`.
- `routes/admin.ts` (수정) — credit 5 endpoint.
- `components/credit/CreditGauge.tsx` (신규) — 공용 잔여 게이지.
- `pages/Dashboard.tsx` (수정) — 크레딧 카드.
- `pages/PricingPage.tsx` (수정) — 크레딧 중심 재디자인.
- `pages/AdminDashboard.tsx` (수정) — 회사 크레딧 섹션 + 요금제 월 크레딧 필드.

---

## Task 1: DB 컬럼 검증 (information_schema 게이트 — 코드 작성 전 필수)

**목적:** `ai_credit_transactions`에 관리자 사유(`reason`) 컬럼 유무 확인 + companies 크레딧 컬럼 재확인. tsc 통과 ≠ SQL 유효.

- [ ] **Step 1: Harold께 검증 SQL 제공 + 결과 확인**

```sql
-- ai_credit_transactions 전체 컬럼
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'ai_credit_transactions' ORDER BY ordinal_position;

-- companies 크레딧/후불 컬럼 존재
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'companies'
   AND column_name IN ('ai_credits_base_remaining','ai_credits_purchased',
                       'ai_credits_monthly_cap','ai_credits_reset_at',
                       'billing_type','postpaid_overage_limit');
```

- [ ] **Step 2: reason 컬럼 분기**
  - `reason`/`description` 컬럼이 **있으면** → adjustCredit이 그 컬럼에 사유 기록.
  - **없으면** → 배포 SQL에 포함: `ALTER TABLE ai_credit_transactions ADD COLUMN IF NOT EXISTS reason TEXT;` (deduct는 NULL, 관리자 지급만 채움).
  - 결정 결과를 Task 3 INSERT에 반영.

---

## Task 2: getMonthlyUsage (이번달 사용량 — TDD)

**Files:** Modify `utils/ai-credit-tx.ts`, `utils/ai-credit.ts` / Test `utils/__tests__/ai-credit-adjust.verify.ts`

- [ ] **Step 1: 실패 테스트** (`ai-credit-adjust.verify.ts`)

```ts
import assert from 'node:assert';
import { sumDeductRows } from '../ai-credit-calc';
let passed = 0; const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[ai-credit] sumDeductRows (이번달 사용량 합)');
ok('deduct만 합산', () => assert.strictEqual(sumDeductRows([{type:'deduct',amount:20},{type:'grant',amount:50},{type:'deduct',amount:2}]), 22));
ok('빈 배열 = 0', () => assert.strictEqual(sumDeductRows([]), 0));
ok('reset/grant 제외', () => assert.strictEqual(sumDeductRows([{type:'reset',amount:1000},{type:'grant',amount:200}]), 0));
console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 실패 확인** — Run: `Push-Location packages\backend; npx ts-node src\utils\__tests__\ai-credit-adjust.verify.ts; Pop-Location` → FAIL(sumDeductRows 미정의)

- [ ] **Step 3: 순수 함수 구현** (`ai-credit-calc.ts` 끝에 추가)

```ts
/** 이번달 사용량 = type 'deduct' 행 amount 합 (순수). */
export function sumDeductRows(rows: Array<{ type: string; amount: number | string }>): number {
  return rows.reduce((s, r) => s + (r.type === 'deduct' ? (Number(r.amount) || 0) : 0), 0);
}
```

- [ ] **Step 4: 통과 확인** — Run 동일 → PASS

- [ ] **Step 5: pool 진입점** (`ai-credit.ts`에 추가) — KST 월 경계는 cdp.ts 검증 패턴 사용

```ts
/** 이번 달(KST) 차감 합. */
export async function getMonthlyUsage(companyId: string): Promise<number> {
  if (!companyId) return 0;
  try {
    const r = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS used FROM ai_credit_transactions
        WHERE company_id = $1::uuid AND type = 'deduct'
          AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'`,
      [companyId]
    );
    return Number(r.rows[0]?.used) || 0;
  } catch (err: any) { console.warn('[ai-credit] getMonthlyUsage 오류:', err?.message); return 0; }
}
```

- [ ] **Step 6: 회귀** — calc 26 + tx + plan-guard 31 GREEN 유지.

---

## Task 3: adjustCredit (수동 지급/조정 — TDD, 트랜잭션)

**Files:** Modify `utils/ai-credit-tx.ts`, `utils/ai-credit.ts` / Test 동일 verify

- [ ] **Step 1: 실패 테스트 추가** (mock client — _deductWithClient 검증 패턴 따름)

```ts
import { adjustCreditWithClient } from '../ai-credit-tx';
function mockClient(row: any) {
  const q: any[] = [];
  return { q, async query(sql: string, params?: any[]) {
    q.push(sql.trim().split('\n')[0]);
    if (sql.includes('SELECT') && sql.includes('ai_credits_purchased')) return { rows: [row] };
    return { rows: [] };
  } };
}
console.log('[ai-credit] adjustCreditWithClient');
ok('grant +200 → purchasedAfter 200', async () => {
  const c = mockClient({ purchased: 0 });
  const r = await adjustCreditWithClient(c as any, { companyId: 'c1', amount: 200, type: 'grant', adminId: 'a1', reason: '입금' }, new Date());
  assert.strictEqual(r.purchasedAfter, 200);
});
ok('admin_deduct 50 (보유 200) → 150', async () => {
  const c = mockClient({ purchased: 200 });
  const r = await adjustCreditWithClient(c as any, { companyId: 'c1', amount: 50, type: 'admin_deduct', adminId: 'a1', reason: '회수' }, new Date());
  assert.strictEqual(r.purchasedAfter, 150);
});
ok('admin_deduct 부족 → throw', async () => {
  const c = mockClient({ purchased: 10 });
  await assert.rejects(() => adjustCreditWithClient(c as any, { companyId: 'c1', amount: 50, type: 'admin_deduct', adminId: 'a1', reason: 'x' }, new Date()));
});
```
(verify 러너를 async ok 지원으로 보강: `const ok = async (n, f) => { await f(); passed++; ... }` + 최상위 `await`.)

- [ ] **Step 2: 실패 확인** → FAIL(adjustCreditWithClient 미정의)

- [ ] **Step 3: 구현** (`ai-credit-tx.ts`) — reason 컬럼 유무는 Task 1 결과 반영(아래는 reason 컬럼 존재 가정; 없으면 INSERT에서 reason 제거 + source에 인코딩)

```ts
export interface AdjustOpts { companyId: string; amount: number; type: 'grant' | 'admin_deduct'; reason: string; adminId: string; }

export async function adjustCreditWithClient(client: any, opts: AdjustOpts, now: Date): Promise<{ purchasedAfter: number }> {
  if (!opts.amount || opts.amount <= 0) throw new Error('금액은 1 이상이어야 합니다.');
  await client.query('BEGIN');
  const locked = await loadCreditRow(client, opts.companyId, true);
  if (!locked) { await client.query('ROLLBACK'); throw new Error('회사를 찾을 수 없습니다.'); }
  const purchased = Number(locked.purchased) || 0;
  const delta = opts.type === 'grant' ? opts.amount : -opts.amount;
  const purchasedAfter = purchased + delta;
  if (purchasedAfter < 0) { await client.query('ROLLBACK'); throw new Error(`구매 크레딧이 부족합니다 (보유 ${purchased}).`); }
  await client.query(`UPDATE companies SET ai_credits_purchased = $2 WHERE id = $1::uuid`, [opts.companyId, purchasedAfter]);
  const base = Number(locked.base) || 0;
  await client.query(
    `INSERT INTO ai_credit_transactions
       (company_id, type, amount, bucket, source, idempotency_key, balance_base_after, balance_purchased_after, created_by, reason)
     VALUES ($1::uuid, $2, $3, 'purchased', $4, $5, $6, $7, $8, $9)`,
    [opts.companyId, opts.type, opts.amount, `admin-${opts.type}`,
     `${opts.type}:${opts.companyId}:${now.getTime()}`, base, purchasedAfter, opts.adminId, opts.reason.slice(0, 500)]
  );
  await client.query('COMMIT');
  return { purchasedAfter };
}
```

- [ ] **Step 4: 통과 확인** → PASS

- [ ] **Step 5: pool 진입점** (`ai-credit.ts`)

```ts
export async function adjustCredit(opts: { companyId: string; amount: number; type: 'grant' | 'admin_deduct'; reason: string; adminId: string }): Promise<{ purchasedAfter: number }> {
  const client = await pool.connect();
  try { return await adjustCreditWithClient(client, opts, new Date()); }
  catch (e) { try { await client.query('ROLLBACK'); } catch {} throw e; }
  finally { client.release(); }
}
export async function getCreditTransactions(companyId: string, page = 1, pageSize = 20): Promise<{ rows: any[]; total: number }> {
  const off = (Math.max(1, page) - 1) * pageSize;
  const [list, cnt] = await Promise.all([
    pool.query(`SELECT id, type, amount, bucket, source, balance_purchased_after, balance_base_after, created_by, created_at, reason
                  FROM ai_credit_transactions WHERE company_id = $1::uuid ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [companyId, pageSize, off]),
    pool.query(`SELECT COUNT(*) FROM ai_credit_transactions WHERE company_id = $1::uuid`, [companyId]),
  ]);
  return { rows: list.rows, total: Number(cnt.rows[0].count) };
}
```

- [ ] **Step 6: tsc 0 + verify GREEN.**

---

## Task 4: 고객 endpoint `GET /api/companies/my-credit`

**Files:** Modify `routes/companies.ts`

- [ ] **Step 1: 구현** (인증 미들웨어 companyId. db_alter_safety_net catch)

```ts
router.get('/my-credit', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });
    const { getCreditState, getMonthlyUsage } = await import('../utils/ai-credit');
    const [state, used] = await Promise.all([getCreditState(companyId), getMonthlyUsage(companyId)]);
    return res.json({ success: true, ...state, monthlyUsed: used });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist'))
      return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요', code: 'DB_MIGRATION_PENDING' });
    return res.status(500).json({ success: false, error: '크레딧 조회 실패' });
  }
});
```

- [ ] **Step 2: tsc 0.**

---

## Task 5: 슈퍼관리자 endpoint 5종

**Files:** Modify `routes/admin.ts` (balance-adjust 패턴 인접에 추가)

- [ ] **Step 1:** `GET /companies/:id/credit` → getCreditState + getMonthlyUsage + getCreditTransactions(page1, 5).
- [ ] **Step 2:** `POST /companies/:id/credit-adjust` → body {amount, type:'grant'|'admin_deduct', reason}. reason 필수. adjustCredit. db_alter_safety_net catch.
- [ ] **Step 3:** `GET /companies/:id/credit-transactions?page=` → getCreditTransactions.
- [ ] **Step 4:** `PUT /companies/:id/postpaid-overage-limit` → companies.postpaid_overage_limit = $1 (정수 ≥ 0).
- [ ] **Step 5:** 기존 `PUT /admin/plans/:id` 핸들러에 `ai_credits_per_month` 필드 UPDATE 추가(이미 plans 편집 존재 → SELECT/UPDATE에 컬럼 1개 추가).
- [ ] **Step 6:** 전부 requireSuperAdmin. tsc 0. console.log로 지급/조정 1줄 기록(balance 패턴).

---

## Task 6: CreditGauge 공용 컴포넌트

**Files:** Create `packages/frontend/src/components/credit/CreditGauge.tsx`

- [ ] **Step 1: 구현** — props `{ total, baseRemaining, purchased, planCredits, monthlyUsed, resetAt, billingType, overageLimit, compact? }`. 다크+violet. 총 잔여 크게 + 기본분/구매분 분리 바 + 이번달 사용 + 리셋 D-N + 저잔여(총 < 5) 경고. Source caption `text-[10px] text-white/30 italic`. 네이티브 다이얼로그 0.

- [ ] **Step 2: tsc 0 + 자가 grep(박-단어/모델명/native dialog 0).**

---

## Task 7: 대시보드 크레딧 카드

**Files:** Modify `pages/Dashboard.tsx`

- [ ] **Step 1:** mount 시 `/api/companies/my-credit` fetch. `creditEnabled === false`면 카드 숨김.
- [ ] **Step 2:** CreditGauge(compact) 카드 + "충전 문의" 버튼 → 기존 문의 흐름(`/pricing?openContactModal=true`)으로 navigate. native dialog 0.
- [ ] **Step 3: tsc 0 + 자가 grep.**

---

## Task 8: 요금제 안내 페이지 재디자인

**Files:** Modify `pages/PricingPage.tsx`

- [ ] **Step 1:** Plan 인터페이스에 `ai_credits_per_month` 추가. `/api/plans`가 이미 반환하는지 확인(아니면 admin plans 응답에 포함 — Task 5와 정렬). my-credit fetch 추가.
- [ ] **Step 2:** 상단 내 크레딧 게이지(CreditGauge) + 현재 요금제.
- [ ] **Step 3:** 요금제 카드 = "월 크레딧 + 관리 DB" 중심 + 만원당 크레딧(`Math.round(ai_credits_per_month / (monthly_price/10000))`) 비교 + 작업당 크레딧 안내(풀분석 20/여정 10/DM 5/생성 3/문안·분석 2/다듬기·질문 1).
- [ ] **Step 4:** "충전 문의" CTA = 기존 inquiry 모달 재사용. native dialog → ConfirmModal/useToast 확인.
- [ ] **Step 5:** 다크+violet, AI 여정 동급. tsc 0 + 자가 grep.

---

## Task 9: 슈퍼관리자 크레딧 섹션 (AdminDashboard)

**Files:** Modify `pages/AdminDashboard.tsx`

- [ ] **Step 1:** 회사 상세에 크레딧 섹션 — `/admin/companies/:id/credit` fetch → 잔여(기본+구매+총) + 이번달 사용 + 리셋일 + billing_type.
- [ ] **Step 2:** 지급/조정 모달(금액 + grant/deduct 토글 + 사유 필수) → `POST credit-adjust`. ConfirmModal/useToast. 성공 시 재조회.
- [ ] **Step 3:** 후불 한도 입력(postpaid만) → `PUT postpaid-overage-limit`.
- [ ] **Step 4:** 최근 이력 표 + 더보기(`credit-transactions`).
- [ ] **Step 5:** 요금제 편집 폼에 "월 크레딧"(ai_credits_per_month) 입력 추가.
- [ ] **Step 6:** 다크+violet. native dialog 0. tsc 0 + 자가 grep.

---

## Task 10: 통합 검증

- [ ] backend tsc 0 + frontend tsc 0.
- [ ] 단위검증 — adjust/usage verify GREEN + 기존 calc 26/tx/plan-guard 31 회귀 GREEN.
- [ ] 자가 grep 전 변경 파일 — `옛|박[음힘는을힌지혀힙히혔힐았혀]|진정|정합|매트릭스|영영|본격` 0건 + 모델명 0 + native dialog 0.
- [ ] Codex 이중 검증(codex_review_after_code_change — 돈/balance 영역 = `/codex:adversarial-review`).
- [ ] Harold 배포: 배포 SQL(reason ALTER 필요 시) + tp-push + backend·frontend build:safe. 크레딧 차감 활성은 plans 값 유지 시 그대로.

---

## Self-Review

- **Spec 커버리지:** §2 백엔드(Task 2-5) / §3 슈퍼관리자(Task 5,9) / §4 고객(Task 4,6,7,8) / §5 후불·순서(Task 5,9 한도 + Task 1 우선) / §6 검증(Task 10). 누락 없음.
- **타입 일관:** getMonthlyUsage / adjustCredit{companyId,amount,type,reason,adminId} / getCreditTransactions{rows,total} — Task 2-5,9 동일.
- **placeholder:** reason 컬럼만 Task 1 결과 의존(명시 분기) — 그 외 실제 코드. UI Task는 구조+핵심 코드+디자인 요건 명시(기존 패턴 따름).
