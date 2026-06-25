# CDP(자사몰 연동) 갭 보강 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CDP 전 경로 감사에서 발견한 8갭 + 문서 드리프트를 5 phase(A→B→C→D→E)로 순서대로 보강한다 — 발송 정확도, provider 단일 출처화, 데이터 하드닝, 여정 변수 한계 명시, 문서 정합.

**Architecture:** 모든 판정 로직은 DB import 0 순수 함수로 분리해 `*.verify.ts`(ts-node) TDD로 먼저 고정한 뒤, 컨트롤타워(`utils/`) 내부에서 호출 배선한다. 라우트 인라인 헬퍼 금지. 돈/발송에 닿는 A1·D는 실측 1건 시나리오를 보고에 포함하고, phase 종료마다 backend tsc 0 + `npm run test`(vitest 회귀)를 통과시킨다.

**Tech Stack:** Node.js/Express + TypeScript(ts-node 런타임), PostgreSQL, vitest(`src/**/*.test.ts`) + ts-node 순수 검증 스크립트(`__tests__/*.verify.ts`), React(frontend B6).

---

## 테스트 관행 (프로젝트 확정 — 최신 패턴)

- **순수 함수 검증** = `packages/backend/src/utils/__tests__/<name>.verify.ts` — `import assert from 'node:assert'` + `console.log` + `passed/N` 카운트. 실행 `npx ts-node packages/backend/src/utils/__tests__/<name>.verify.ts`. (refund-calc / qtmsg-type / system-alert-cooldown 2026-06-25 동일 패턴.)
- **회귀** = `cd packages/backend && npm run test` (vitest, `src/**/*.test.ts` 스위트). 새 순수 함수는 `.verify.ts`로 검증하고, vitest 스위트는 회귀 baseline 확인용.
- **tsc** = `cd packages/backend && npx tsc --noEmit` (build:safe는 배포 단계 — 개발 검증은 tsc --noEmit).
- 각 verify 스크립트 헤더 주석에 실행 명령 + 목적 1줄 명시 (기존 관행).

---

## File Structure

**신규 (순수 함수 + 검증):**
- `packages/backend/src/utils/cdp-phone-sync.ts` — A1 전화번호 갱신 판정 순수
- `packages/backend/src/utils/__tests__/cdp-phone-sync.verify.ts`
- `packages/backend/src/utils/cdp-identity-conflict.ts` — A4 identity 충돌 감지 순수
- `packages/backend/src/utils/__tests__/cdp-identity-conflict.verify.ts`
- `packages/backend/src/utils/cdp-identity-review.ts` — A4 검수 플래그 DB recorder (충돌 안전망)
- `packages/backend/src/utils/cdp-occurred-at.ts` — C5 occurred_at 클램프 순수
- `packages/backend/src/utils/__tests__/cdp-occurred-at.verify.ts`
- `packages/backend/src/utils/cdp-burst-limit.ts` — C6 슬라이딩 윈도우 카운터 순수 + 미들웨어
- `packages/backend/src/utils/__tests__/cdp-burst-limit.verify.ts`
- `packages/backend/src/utils/__tests__/provider-registry-ui.verify.ts` — B1 buildProvidersForUI 분류 검증
- `packages/backend/src/utils/__tests__/journey-trigger-class.verify.ts` — D 트리거 분류 검증

**수정 (컨트롤타워 내부):**
- `utils/provider-registry.ts` — B1 connectMethod/available 필드 + buildProvidersForUI 순수 추출
- `utils/cafe24-client.ts` / `utils/naver-commerce-client.ts` / `utils/custom-self-hosted-adapter.ts` — B1 connectMethod/available 추가
- `utils/godo-adapter.ts` (신규) — B2 고도몰 polling 어댑터
- `utils/gabia-adapter.ts` (신규) — B3 가비아 webhook 어댑터(custom 위임)
- `utils/register-providers.ts` (신규) — B4 등록 단일 출처
- `utils/cdp-identity.ts` — A1·A4 배선
- `utils/cdp-events.ts` — C5 배선 (trackEvent + ingestBrowserEvents)
- `utils/cdp-orders.ts` — C8 truncation 플래그
- `utils/journey-cdp-cursor.ts` — D classifyJourneyTrigger 추가
- `routes/cdp.ts` — B4 side-effect import 제거 + C6 burst 미들웨어 + C8 응답 노출
- `app.ts` — B4 register-providers import
- `packages/frontend/src/pages/CdpSettingsPage.tsx` — B6 동적 로드

**DB:** `cdp_identity_review` CREATE (A4 — information_schema 확인 후)

**문서(E):** `docs/AI_OPERATOR_기능정의서.md` §8-2, `utils/provider-registry.ts` 상단 주석, `status/SCHEMA.md`

---

# Phase A — 발송 정확도 (사용자 직결)

## Task A1: 전화번호 갱신 판정 순수 함수 (`decidePhoneUpdate`)

**Files:**
- Create: `packages/backend/src/utils/cdp-phone-sync.ts`
- Test: `packages/backend/src/utils/__tests__/cdp-phone-sync.verify.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/backend/src/utils/__tests__/cdp-phone-sync.verify.ts
/**
 * cdp-phone-sync.verify.ts — 자사몰 회원 phone 자동 갱신 판정 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/cdp-phone-sync.verify.ts
 * (DB import 0 — decidePhoneUpdate 순수 함수만. 입력 phone은 호출부에서 normalizePhone 경유 가정.)
 */
import assert from 'node:assert';
import { decidePhoneUpdate } from '../cdp-phone-sync';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[cdp-phone-sync] decidePhoneUpdate — 자동 갱신/충돌 skip/noop 판정');

ok('incoming 없음 → noop', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: null, conflictHolderId: null, selfId: 'A' }), 'noop'));

ok('현재값과 동일 → noop', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '01011112222', conflictHolderId: null, selfId: 'A' }), 'noop'));

ok('자유번호(점유자 없음) + 변경 → update', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '01033334444', conflictHolderId: null, selfId: 'A' }), 'update'));

ok('현재 phone NULL이고 incoming 있음 + 점유자 없음 → update', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: null, incomingPhone: '01033334444', conflictHolderId: null, selfId: 'A' }), 'update'));

ok('타 고객(B)이 그 번호 점유 → skip_conflict(자동변경 금지)', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '01033334444', conflictHolderId: 'B', selfId: 'A' }), 'skip_conflict'));

ok('점유자가 자기 자신(A) → update (충돌 아님)', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '01033334444', conflictHolderId: 'A', selfId: 'A' }), 'update'));

ok('incoming 빈 문자열 → noop (falsy 안전)', () =>
  assert.strictEqual(decidePhoneUpdate({ currentPhone: '01011112222', incomingPhone: '', conflictHolderId: null, selfId: 'A' }), 'noop'));

console.log(`\n[cdp-phone-sync] ${passed}/7 passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ts-node packages/backend/src/utils/__tests__/cdp-phone-sync.verify.ts`
Expected: FAIL — `Cannot find module '../cdp-phone-sync'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/backend/src/utils/cdp-phone-sync.ts
/**
 * ★ CDP 회원 전화번호 자동 갱신 판정 — 순수(DB import 0). 2026-06-25 (gap 2 보강)
 *
 * 문제: identifyCustomer가 phone 변경을 skip해(UNIQUE 충돌 우려) 번호 바뀐 회원이 옛 번호로 남아 발송 실패.
 * 설계: 충돌(같은 회사 다른 활성 고객이 그 번호 점유)만 자동변경 금지(skip_conflict→검수 플래그), 그 외 자동 갱신.
 *   - incomingPhone은 호출부에서 normalizePhone() 경유한 정규화 값을 넘긴다(D162 정합).
 */
export type PhoneUpdateDecision = 'update' | 'skip_conflict' | 'noop';

export function decidePhoneUpdate(p: {
  currentPhone: string | null;
  incomingPhone: string | null;
  conflictHolderId: string | null;  // 그 번호를 보유한 같은 회사 활성 고객 id(없으면 null)
  selfId: string;                    // 갱신 대상 고객 본인 id
}): PhoneUpdateDecision {
  const incoming = p.incomingPhone;
  if (!incoming) return 'noop';
  if (incoming === p.currentPhone) return 'noop';
  if (p.conflictHolderId && p.conflictHolderId !== p.selfId) return 'skip_conflict';
  return 'update';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ts-node packages/backend/src/utils/__tests__/cdp-phone-sync.verify.ts`
Expected: PASS — `[cdp-phone-sync] 7/7 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/cdp-phone-sync.ts packages/backend/src/utils/__tests__/cdp-phone-sync.verify.ts
git commit -m "feat(cdp): A1 전화번호 자동 갱신 판정 순수 함수 + verify"
```

---

## Task A4-table: `cdp_identity_review` 신규 테이블 (information_schema 확인 후 CREATE)

**Files:**
- DB: `cdp_identity_review` (PostgreSQL CREATE)
- Doc: `status/SCHEMA.md` (생성 후 기록 — Phase E와 별개로 생성 직후 즉시)

- [ ] **Step 1: 존재 확인 검증 SQL을 Harold님께 제공 (0번 원칙 — 순수 존재 덤프)**

Harold님 실행:

```sql
-- 1) 테이블이 이미 있는지 (0 rows면 신규 CREATE 안전)
SELECT table_name FROM information_schema.tables WHERE table_name = 'cdp_identity_review';
-- 2) 혹시 존재 시 컬럼 덤프 (있을 때만 — 0 rows면 무시)
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'cdp_identity_review';
```

Expected: 1) 0 rows (미존재 확정) → CREATE 진행. 1 row 이상이면 컬럼 덤프 결과 받아 설계 재대조.

- [ ] **Step 2: CREATE SQL을 Harold님께 제공 (존재 0 rows 확인 후에만)**

```sql
CREATE TABLE IF NOT EXISTS cdp_identity_review (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  customer_id uuid        NOT NULL,
  kind        varchar(40) NOT NULL,                  -- 'phone_conflict' | 'merge_candidate'
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  resolved    boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cdp_identity_review_company_unresolved
  ON cdp_identity_review (company_id, resolved, created_at DESC);
```

설계 근거: 경량 검수 큐(읽기+로그+플래그). company_id/customer_id는 코드 전역 uuid 정합(cdp_identity_links·cdp_events $1::uuid). FK는 미부여(경량 + 다른 테이블 컬럼 검증 의존 0 — lightweight 설계). 자동 병합 도구는 후일(범위 밖).

- [ ] **Step 3: `status/SCHEMA.md`에 실측 기록 (생성 일자 명시)**

`status/SCHEMA.md` PostgreSQL 섹션에 `cdp_identity_review` 7컬럼 + 인덱스 1건을 2026-06-25 생성으로 추가.

- [ ] **Step 4: Commit (문서)**

```bash
git add status/SCHEMA.md
git commit -m "docs(schema): cdp_identity_review 신규 테이블 기록 (A4)"
```

> ⚠️ 이 Task는 Harold님 SQL 실행에 의존. Step 1 결과 수령 전에는 Step 2 진행 금지(db_column_verify_before_code / 0번 원칙).

---

## Task A4-recorder: 검수 플래그 DB recorder (`recordIdentityReview`)

**Files:**
- Create: `packages/backend/src/utils/cdp-identity-review.ts`

- [ ] **Step 1: recorder 작성 (테이블 미생성 시 안전 skip — db_alter_safety_net 정합)**

```ts
// packages/backend/src/utils/cdp-identity-review.ts
/**
 * ★ CDP identity 검수 플래그 recorder — 2026-06-25 (A1 skip_conflict + A4 phone_conflict 공용 저장소)
 *
 * 자동 병합/자동 phone 변경은 위험 → 충돌 시 변경 안 하고 본 테이블에 플래그만 적재(운영 검수 후 수동 병합).
 * 테이블 미생성(마이그레이션 미실행) 시 = warn 후 skip (식별/발송 흐름 절대 차단 X). db_alter_safety_net 정합.
 */
import { query } from '../config/database';

export type IdentityReviewKind = 'phone_conflict' | 'merge_candidate';

export async function recordIdentityReview(p: {
  companyId: string;
  customerId: string;
  kind: IdentityReviewKind;
  detail: Record<string, any>;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO cdp_identity_review (id, company_id, customer_id, kind, detail, resolved, created_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::jsonb, false, NOW())`,
      [p.companyId, p.customerId, p.kind, JSON.stringify(p.detail || {})],
    );
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('cdp_identity_review') && msg.includes('does not exist')) {
      console.warn('[CDP Identity Review] cdp_identity_review 테이블 미생성 — 마이그레이션 필요(검수 플래그 skip, 식별 흐름 유지)');
      return;
    }
    console.warn('[CDP Identity Review] 플래그 기록 실패(식별 흐름 유지):', err);
  }
}
```

- [ ] **Step 2: tsc 확인**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors (DB import만, 신규 컬럼 SQL은 catch 안전망 보유)

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/utils/cdp-identity-review.ts
git commit -m "feat(cdp): A4 identity 검수 플래그 recorder (테이블 미생성 안전 skip)"
```

---

## Task A4-detect: identity 충돌 감지 순수 함수 (`detectIdentityConflict`)

**Files:**
- Create: `packages/backend/src/utils/cdp-identity-conflict.ts`
- Test: `packages/backend/src/utils/__tests__/cdp-identity-conflict.verify.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/backend/src/utils/__tests__/cdp-identity-conflict.verify.ts
/**
 * cdp-identity-conflict.verify.ts — email 매칭 고객 ≠ phone 보유 고객 충돌 감지 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/cdp-identity-conflict.verify.ts
 * (DB import 0 — detectIdentityConflict 순수 함수만. 자동 병합 금지, 충돌이면 플래그만.)
 */
import assert from 'node:assert';
import { detectIdentityConflict } from '../cdp-identity-conflict';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[cdp-identity-conflict] detectIdentityConflict — email/phone 다른 고객 충돌 감지');

ok('email=A, phone 보유자=A 동일 → 충돌 없음', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: 'A', phoneHolderId: 'A' }), { conflict: false }));

ok('email=A, phone 보유자=B 다름 → phone_conflict', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: 'A', phoneHolderId: 'B' }), { conflict: true, kind: 'phone_conflict' }));

ok('phone 보유자 없음(null) → 충돌 없음', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: 'A', phoneHolderId: null }), { conflict: false }));

ok('chosen 없음(신규 생성 경로) → 충돌 없음', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: null, phoneHolderId: 'B' }), { conflict: false }));

ok('둘 다 없음 → 충돌 없음', () =>
  assert.deepStrictEqual(detectIdentityConflict({ chosenCustomerId: null, phoneHolderId: null }), { conflict: false }));

console.log(`\n[cdp-identity-conflict] ${passed}/5 passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ts-node packages/backend/src/utils/__tests__/cdp-identity-conflict.verify.ts`
Expected: FAIL — `Cannot find module '../cdp-identity-conflict'`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/backend/src/utils/cdp-identity-conflict.ts
/**
 * ★ CDP identity 충돌 감지 — 순수(DB import 0). 2026-06-25 (gap 4 보강)
 *
 * identifyCustomer가 email 매칭(2단계)으로 고객 A를 골랐는데, 들어온 phone은 다른 고객 B가 보유하면
 * 자동 병합은 위험(데이터 파괴) → 충돌만 감지해 검수 플래그 기록 + warn. A로 진행은 유지(기존 흐름 불변).
 */
export type IdentityConflictKind = 'phone_conflict';

export function detectIdentityConflict(p: {
  chosenCustomerId: string | null;   // email/phone 매칭으로 최종 선택된 고객 id
  phoneHolderId: string | null;      // 들어온 phone을 보유한 활성 고객 id(없으면 null)
}): { conflict: boolean; kind?: IdentityConflictKind } {
  if (!p.chosenCustomerId || !p.phoneHolderId) return { conflict: false };
  if (p.chosenCustomerId !== p.phoneHolderId) return { conflict: true, kind: 'phone_conflict' };
  return { conflict: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ts-node packages/backend/src/utils/__tests__/cdp-identity-conflict.verify.ts`
Expected: PASS — `[cdp-identity-conflict] 5/5 passed`

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/cdp-identity-conflict.ts packages/backend/src/utils/__tests__/cdp-identity-conflict.verify.ts
git commit -m "feat(cdp): A4 identity 충돌 감지 순수 함수 + verify"
```

---

## Task A-wire: `cdp-identity.ts` 배선 (A1 phone 자동 갱신 + A4 충돌 플래그)

**Files:**
- Modify: `packages/backend/src/utils/cdp-identity.ts`

배선 지점: ① `syncCustomerFields`가 phone 인자를 받아 자동 갱신(현재 끝에서 skip 중, `:343`) ② `identifyCustomer` 2·3단계에서 phone 보유자 조회 후 충돌 감지(`:130~161`).

- [ ] **Step 1: import 추가 (파일 상단 `:24~26` 근처)**

```ts
import { decidePhoneUpdate } from './cdp-phone-sync';
import { detectIdentityConflict } from './cdp-identity-conflict';
import { recordIdentityReview } from './cdp-identity-review';
```

- [ ] **Step 2: phone 보유자 조회 헬퍼 추가 (파일 하단, syncCustomerFields 위)**

```ts
/** 같은 회사에서 normalizedPhone을 보유한 활성 고객 id 1건(없으면 null). A1/A4 충돌 판정 공용. */
async function findPhoneHolderId(companyId: string, normalizedPhone: string | null): Promise<string | null> {
  if (!normalizedPhone) return null;
  const r = await query(
    `SELECT id FROM customers
     WHERE company_id = $1::uuid AND phone = $2 AND is_active = true
     ORDER BY created_at ASC LIMIT 1`,
    [companyId, normalizedPhone],
  );
  return r.rows.length > 0 ? r.rows[0].id : null;
}
```

- [ ] **Step 3: `syncCustomerFields` 시그니처에 companyId 추가 + phone 자동 갱신 (현재 `:311~345` 교체)**

```ts
async function syncCustomerFields(
  companyId: string,
  customerId: string,
  input: IdentifyInput,
  normalizedPhone: string | null,
  email: string | null,
): Promise<void> {
  // 자사몰이 제공한 필드만 COALESCE 덮어쓰기 (NULL은 기존 값 유지)
  await query(
    `UPDATE customers SET
      name = COALESCE($2, name),
      email = COALESCE($3, email),
      gender = COALESCE($4, gender),
      birth_date = COALESCE($5, birth_date),
      grade = COALESCE($6, grade),
      address = COALESCE($7, address),
      custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $8::jsonb,
      sms_opt_in = COALESCE($9::boolean, sms_opt_in),
      updated_at = NOW()
    WHERE id = $1::uuid`,
    [
      customerId,
      input.name || null,
      email,
      input.gender || null,
      input.birthDate || null,
      input.grade || null,
      input.address || null,
      JSON.stringify(input.customFields || {}),
      input.smsOptIn ?? null,
    ],
  );

  // ★ A1 (2026-06-25): phone 자동 갱신 — 충돌(타 고객 점유)만 skip + 검수 플래그.
  if (normalizedPhone) {
    const cur = await query(`SELECT phone FROM customers WHERE id = $1::uuid`, [customerId]);
    const currentPhone: string | null = cur.rows[0]?.phone ?? null;
    if (normalizedPhone !== currentPhone) {
      const holderId = await findPhoneHolderId(companyId, normalizedPhone);
      const decision = decidePhoneUpdate({ currentPhone, incomingPhone: normalizedPhone, conflictHolderId: holderId, selfId: customerId });
      if (decision === 'update') {
        await query(`UPDATE customers SET phone = $2, updated_at = NOW() WHERE id = $1::uuid`, [customerId, normalizedPhone]);
      } else if (decision === 'skip_conflict') {
        console.warn(`[CDP Identity] phone 자동변경 충돌 skip — customer=${customerId} 점유자=${holderId} (검수 플래그 기록)`);
        await recordIdentityReview({
          companyId, customerId, kind: 'phone_conflict',
          detail: { reason: 'phone_update_conflict', incomingPhone: normalizedPhone, currentPhone, conflictHolderId: holderId },
        });
      }
    }
  }
}
```

- [ ] **Step 4: `syncCustomerFields` 호출부 2곳에 companyId 전달 (`:109`, `:213`)**

`:109` (기존 link 경로):
```ts
await syncCustomerFields(companyId, linkRow.customer_id, input, normalizedPhone, email);
```
`:213` (매칭된 기존 customer):
```ts
await syncCustomerFields(companyId, customerId, input, normalizedPhone, email);
```

- [ ] **Step 5: A4 충돌 감지 배선 — 3단계 phone 매칭을 "항상 보유자 조회 후 비교"로 (`:148~161` 교체)**

```ts
  // ★ 3단계: phone 보유자 조회 (email 매칭 여부와 무관하게 1회 — A4 충돌 감지 겸용)
  const phoneHolderId = await findPhoneHolderId(companyId, normalizedPhone);

  if (!customerId && phoneHolderId) {
    // email 미매칭 → phone 보유자를 그대로 사용
    customerId = phoneHolderId;
    wasMerged = true;
  } else if (customerId && phoneHolderId) {
    // ★ A4 (2026-06-25): email로 고른 고객 ≠ phone 보유 고객 → 충돌 플래그(자동 병합 금지, email 진행 유지)
    const conflict = detectIdentityConflict({ chosenCustomerId: customerId, phoneHolderId });
    if (conflict.conflict) {
      console.warn(`[CDP Identity] identity 충돌 — email고객=${customerId} ≠ phone보유자=${phoneHolderId} (검수 플래그, email 고객으로 진행)`);
      await recordIdentityReview({
        companyId, customerId, kind: 'phone_conflict',
        detail: { reason: 'identify_email_phone_mismatch', emailCustomerId: customerId, phoneHolderId, email, phone: normalizedPhone },
      });
    }
  }
```

> 주의: 기존 `:148~161` 블록(`if (!customerId && normalizedPhone) { byPhone 조회 }`)을 위 블록으로 통째 교체. 신규 INSERT 경로(`:163~`)와 변수(`customerId`, `wasMerged`)는 그대로 유지.

- [ ] **Step 6: tsc + 회귀 + 기존 verify**

Run:
```bash
cd packages/backend && npx tsc --noEmit
npm run test
npx ts-node src/utils/__tests__/cdp-phone-sync.verify.ts
npx ts-node src/utils/__tests__/cdp-identity-conflict.verify.ts
npx ts-node src/utils/__tests__/cdp-idempotency.verify.ts
```
Expected: tsc 0 errors / vitest 회귀 통과 / verify 전부 passed

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/utils/cdp-identity.ts
git commit -m "feat(cdp): A1 phone 자동 갱신 + A4 identity 충돌 플래그 배선"
```

---

## Phase A 실측 1건 시나리오 (돈/발송 — 보고 의무)

> Harold님 운영 검증용. 구현 보고에 포함만, AI 직접 실행 X(feedback_no_operation_verification_by_ai).

1. **A1 정상 갱신**: 자사몰에서 기존 회원(externalId 고정)의 phone을 새 번호로 바꿔 `POST /api/cdp/identify` 전송 → `SELECT phone FROM customers WHERE id=<해당 고객>` 신 번호 확인.
2. **A1 충돌 skip**: 새 번호를 이미 다른 활성 고객이 보유한 상태로 동일 전송 → 대상 고객 phone **미변경** + `SELECT * FROM cdp_identity_review WHERE kind='phone_conflict' ORDER BY created_at DESC LIMIT 1` 1건.
3. **A4 충돌**: email=고객A인데 phone은 고객B 번호로 `identify` → 응답은 A로 진행(customerId=A) + `cdp_identity_review` phone_conflict 1건.

검증 SQL:
```sql
SELECT id, company_id, customer_id, kind, detail, resolved, created_at
FROM cdp_identity_review ORDER BY created_at DESC LIMIT 5;
```

---

## Phase A 종료 게이트

- [ ] backend tsc 0 + `npm run test` 회귀 통과 + A 신규 verify 3종 + cdp-idempotency.verify 통과
- [ ] (DB/돈) `/codex:adversarial-review` 권장 — A4 신규 테이블 + phone 쓰기 경로

---

# Phase B — provider 백엔드 단일 출처화 (gap 3 + gap 7)

> 사실 정정: `GET /api/cdp/providers`는 **이미 존재**(`routes/cdp.ts:1548`). `customSelfHostedAdapter`도 이미 `routes/cdp.ts:46`에서 import 등록됨. 본 Phase는 (1) 응답에 connectMethod/available 추가 (2) godo/gabia 어댑터 추가 (3) 등록을 register-providers 단일 출처로 이전 (4) 프론트 동적화.

## Task B1: IProviderAdapter에 connectMethod/available + buildProvidersForUI 순수 추출

**Files:**
- Modify: `packages/backend/src/utils/provider-registry.ts`
- Modify: `packages/backend/src/utils/cafe24-client.ts` / `naver-commerce-client.ts` / `custom-self-hosted-adapter.ts`
- Test: `packages/backend/src/utils/__tests__/provider-registry-ui.verify.ts`

- [ ] **Step 1: Write the failing test (buildProvidersForUI 순수 분류)**

```ts
// packages/backend/src/utils/__tests__/provider-registry-ui.verify.ts
/**
 * provider-registry-ui.verify.ts — listProvidersForUI 분류(available/coming_soon) 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/provider-registry-ui.verify.ts
 * (provider-registry.ts는 DB import 0 — buildProvidersForUI에 fake 어댑터 배열을 직접 주입해 검증.)
 */
import assert from 'node:assert';
import { buildProvidersForUI } from '../provider-registry';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const fake = (provider: string, connectMethod: any, available: boolean) => ({
  provider, displayName: provider,
  capabilities: { oauth: false, webhook: false, webhookSignatureVerification: false, adminApi: false },
  connectMethod, available,
});

console.log('[provider-registry-ui] buildProvidersForUI — available 직접 사용(추론 폐기)');

const out = buildProvidersForUI([
  fake('cafe24', 'oauth', true),
  fake('godo', 'polling', true),     // 폴링형도 available true면 available
  fake('gabia', 'webhook', true),
  fake('shopify', 'none', false),    // 스켈레톤 → coming_soon
]);

ok('cafe24(oauth, available) → available', () =>
  assert.strictEqual(out.find(p => p.provider === 'cafe24')!.status, 'available'));
ok('godo(polling, available) → available (추론이면 oauth/webhook 없어 coming_soon 됐을 케이스)', () =>
  assert.strictEqual(out.find(p => p.provider === 'godo')!.status, 'available'));
ok('godo connectMethod 보존', () =>
  assert.strictEqual(out.find(p => p.provider === 'godo')!.connectMethod, 'polling'));
ok('gabia(webhook, available) → available', () =>
  assert.strictEqual(out.find(p => p.provider === 'gabia')!.status, 'available'));
ok('shopify(none, available=false) → coming_soon', () =>
  assert.strictEqual(out.find(p => p.provider === 'shopify')!.status, 'coming_soon'));

console.log(`\n[provider-registry-ui] ${passed}/5 passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ts-node packages/backend/src/utils/__tests__/provider-registry-ui.verify.ts`
Expected: FAIL — `buildProvidersForUI` export 없음

- [ ] **Step 3: provider-registry.ts 수정 — 인터페이스 필드 + buildProvidersForUI 추출**

`IProviderAdapter`에 필드 추가 (`:69` capabilities 아래):
```ts
  /** UI 연결 방식 — 카드 클릭 모달 분기에 사용 */
  readonly connectMethod: 'oauth' | 'webhook' | 'polling' | 'none';
  /** 실제 연동 가능 여부(추론 폐기 — 어댑터가 직접 선언). false면 'coming_soon' */
  readonly available: boolean;
```

`listProvidersForUI` 교체 (`:137~154`):
```ts
type ProviderUIEntry = {
  provider: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  connectMethod: 'oauth' | 'webhook' | 'polling' | 'none';
  available: boolean;
  status: 'available' | 'coming_soon';
};

/** 순수 — 어댑터 배열 → UI 엔트리. available 직접 사용(D189 추론 폐기). 테스트 가능. */
export function buildProvidersForUI(
  adapters: Array<Pick<IProviderAdapter, 'provider' | 'displayName' | 'capabilities' | 'connectMethod' | 'available'>>,
): ProviderUIEntry[] {
  return adapters.map((p) => ({
    provider: p.provider,
    displayName: p.displayName,
    capabilities: p.capabilities,
    connectMethod: p.connectMethod,
    available: p.available,
    status: p.available ? 'available' : 'coming_soon',
  }));
}

export function listProvidersForUI(): ProviderUIEntry[] {
  return buildProvidersForUI(listProviders());
}
```

`SkeletonProviderAdapter`에 필드 추가 (`:167` capabilities 위 또는 아래):
```ts
  readonly connectMethod = 'none' as const;
  readonly available = false;
```

- [ ] **Step 4: 기존 어댑터 3종에 필드 추가**

`cafe24-client.ts` cafe24Adapter 객체(`:495 capabilities: cafe24Capabilities` 근처):
```ts
  connectMethod: 'oauth',
  available: true,
```
`naver-commerce-client.ts` naverSmartStoreAdapter(`:431` 근처):
```ts
  connectMethod: 'oauth',
  available: true,
```
`custom-self-hosted-adapter.ts` customSelfHostedAdapter(`:53` 근처):
```ts
  connectMethod: 'webhook',
  available: true,
```

- [ ] **Step 5: Run test + tsc**

Run:
```bash
npx ts-node packages/backend/src/utils/__tests__/provider-registry-ui.verify.ts
cd packages/backend && npx tsc --noEmit
```
Expected: verify `5/5 passed` / tsc 0 (인터페이스 필수 필드 추가로 3 어댑터 모두 갱신돼 통과)

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/utils/provider-registry.ts packages/backend/src/utils/cafe24-client.ts packages/backend/src/utils/naver-commerce-client.ts packages/backend/src/utils/custom-self-hosted-adapter.ts packages/backend/src/utils/__tests__/provider-registry-ui.verify.ts
git commit -m "feat(cdp): B1 provider connectMethod/available 필드 + buildProvidersForUI 순수 추출"
```

---

## Task B2: 고도몰 polling 어댑터 (`godo-adapter.ts`)

**Files:**
- Create: `packages/backend/src/utils/godo-adapter.ts`

> 실제 연동 로직은 기존 `routes/godo.ts`/`godo-client.ts` 폴링 유지. 어댑터는 UI 노출·메타 + 등록용. OAuth/webhook 메서드는 안내 throw.

- [ ] **Step 1: 어댑터 작성**

```ts
// packages/backend/src/utils/godo-adapter.ts
/**
 * ★ 고도몰(NHN커머스) Provider 어댑터 — 2026-06-25 (gap 3)
 *   고도몰은 쇼핑몰 인증키 기반 폴링 연동(/api/godo). 본 어댑터는 UI 노출·메타·registry 등록용.
 *   OAuth/webhook 경로는 없으므로 안내 throw. 실제 연동은 routes/godo.ts + godo-client.ts.
 */
import {
  IProviderAdapter, ProviderCapabilities, ProviderTokenResponse, ProviderIntegration,
} from './provider-registry';

const godoCapabilities: ProviderCapabilities = {
  oauth: false, webhook: false, webhookSignatureVerification: false, adminApi: true,
};

export const godoAdapter: IProviderAdapter = {
  provider: 'godo',
  displayName: '고도몰',
  capabilities: godoCapabilities,
  connectMethod: 'polling',
  available: true,

  buildAuthorizeUrl(): string {
    throw new Error('고도몰은 폴링 연동입니다. 한줄로 관리자 → 자사몰 연동(CDP)에서 쇼핑몰 인증키를 입력해주세요. (/api/godo)');
  },
  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error('고도몰은 OAuth code 교환이 없습니다. 쇼핑몰 인증키 폴링 방식입니다.');
  },
  async refreshToken(_i: ProviderIntegration): Promise<ProviderTokenResponse> {
    throw new Error('고도몰은 token refresh가 없습니다. 쇼핑몰 인증키 폴링 방식입니다.');
  },
  verifyWebhookSignature(): boolean { return false; },
  async processWebhookEvent(): Promise<void> {
    throw new Error('고도몰은 webhook을 사용하지 않습니다(폴링). /api/godo 사용.');
  },
  extractMallIdFromWebhook(): string | null { return null; },
  extractEventFromWebhook(): string | null { return null; },
  buildIdempotencyKey(event: string): string { return `${event}:godo:polling`; },
};
```

- [ ] **Step 2: tsc**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/utils/godo-adapter.ts
git commit -m "feat(cdp): B2 고도몰 polling 어댑터(UI 메타·registry)"
```

---

## Task B3: 가비아 webhook 어댑터 (`gabia-adapter.ts` — custom 위임)

**Files:**
- Create: `packages/backend/src/utils/gabia-adapter.ts`

> 가비아는 전용 백엔드 없이 custom-self-hosted webhook로 동작. verifyWebhookSignature/processWebhookEvent를 customSelfHostedAdapter에 위임.

- [ ] **Step 1: 어댑터 작성 (custom 위임)**

```ts
// packages/backend/src/utils/gabia-adapter.ts
/**
 * ★ 가비아 Provider 어댑터 — 2026-06-25 (gap 3)
 *   가비아 쇼핑몰은 전용 백엔드 없이 자체 호스팅 webhook 방식과 동일하게 동작.
 *   서명검증/이벤트처리를 customSelfHostedAdapter에 위임(중복 구현 금지 — no_inline_duplication).
 */
import { IProviderAdapter, ProviderCapabilities, ProviderTokenResponse } from './provider-registry';
import { customSelfHostedAdapter } from './custom-self-hosted-adapter';

const gabiaCapabilities: ProviderCapabilities = {
  oauth: false, webhook: true, webhookSignatureVerification: true, adminApi: false,
};

export const gabiaAdapter: IProviderAdapter = {
  provider: 'gabia',
  displayName: '가비아',
  capabilities: gabiaCapabilities,
  connectMethod: 'webhook',
  available: true,

  buildAuthorizeUrl(): string {
    throw new Error('가비아는 OAuth가 없습니다. 한줄로 관리자 → 자사몰 연동(CDP)에서 webhook_secret을 발급받아 설정해주세요.');
  },
  async exchangeCode(): Promise<ProviderTokenResponse> {
    throw new Error('가비아는 OAuth code 교환이 없습니다(webhook 방식).');
  },
  async refreshToken(): Promise<ProviderTokenResponse> {
    throw new Error('가비아는 token refresh가 없습니다(webhook 방식).');
  },
  verifyWebhookSignature(rawBody, signature, secret): boolean {
    return customSelfHostedAdapter.verifyWebhookSignature(rawBody, signature, secret);
  },
  async processWebhookEvent(companyId, event, resource): Promise<void> {
    // 가비아 source로 식별되도록 위임 처리(내부에서 source='custom'으로 적재되나 webhook 흐름 동일)
    return customSelfHostedAdapter.processWebhookEvent(companyId, event, resource);
  },
  extractMallIdFromWebhook(headers, body) {
    return customSelfHostedAdapter.extractMallIdFromWebhook(headers, body);
  },
  extractEventFromWebhook(headers, body) {
    return customSelfHostedAdapter.extractEventFromWebhook(headers, body);
  },
  buildIdempotencyKey(event, resource, body) {
    return customSelfHostedAdapter.buildIdempotencyKey(event, resource, body);
  },
};
```

- [ ] **Step 2: tsc**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/utils/gabia-adapter.ts
git commit -m "feat(cdp): B3 가비아 webhook 어댑터(custom 위임)"
```

---

## Task B4: register-providers 단일 출처 + app.ts 부팅 등록 (gap 7)

**Files:**
- Create: `packages/backend/src/utils/register-providers.ts`
- Modify: `packages/backend/src/app.ts`
- Modify: `packages/backend/src/routes/cdp.ts` (side-effect import 제거)

- [ ] **Step 1: register-providers.ts 작성 (모든 어댑터 한 곳 등록)**

```ts
// packages/backend/src/utils/register-providers.ts
/**
 * ★ CDP Provider 등록 단일 출처 — 2026-06-25 (gap 7: routes/cdp.ts import 부수효과 의존 제거)
 *   app.ts 부팅 시 1회 import로 모든 어댑터를 registry에 등록. 로드 순서 취약성 차단.
 */
import { registerProvider } from './provider-registry';
import { cafe24Adapter } from './cafe24-client';
import { naverSmartStoreAdapter } from './naver-commerce-client';
import { customSelfHostedAdapter } from './custom-self-hosted-adapter';
import { godoAdapter } from './godo-adapter';
import { gabiaAdapter } from './gabia-adapter';

let registered = false;

/** 멱등 — 부팅 1회. 스켈레톤 5종은 provider-registry.ts 모듈 로드 시 자동 등록. */
export function registerAllProviders(): void {
  if (registered) return;
  registerProvider(cafe24Adapter);
  registerProvider(naverSmartStoreAdapter);
  registerProvider(customSelfHostedAdapter);
  registerProvider(godoAdapter);
  registerProvider(gabiaAdapter);
  registered = true;
}
```

> 주의: cafe24-client.ts / naver-commerce-client.ts / custom-self-hosted-adapter.ts는 현재 파일 하단에서 `registerProvider(...)`를 **자체 호출**한다(`cafe24-client:615` 등). register-providers가 멱등(중복 register는 Map이라 덮어쓰기, 무해)이므로 안전. 자체 호출은 잔존 가능하나, gap 7 해결을 위해 어댑터를 named export로 노출만 확인(이미 export됨).

- [ ] **Step 2: cafe24/naver/custom 어댑터가 named export인지 확인 (이미 됨)**

`grep`로 확인: `export const cafe24Adapter` / `export const naverSmartStoreAdapter` / `export const customSelfHostedAdapter`. 누락 시 `export` 추가만.

Run: `grep -n "export const cafe24Adapter\|export const naverSmartStoreAdapter\|export const customSelfHostedAdapter" packages/backend/src/utils/*.ts`

- [ ] **Step 3: app.ts에 부팅 등록 추가**

`app.ts` godoRoutes import(`:53`) 아래에 추가:
```ts
import { registerAllProviders } from './utils/register-providers';
```
앱 초기화 구간(라우터 mount 전, 적절한 부팅 지점)에 1줄:
```ts
registerAllProviders();
```

- [ ] **Step 4: routes/cdp.ts side-effect import 제거 (`:42`, `:44`)**

```ts
// 제거: import '../utils/cafe24-client';
// 제거: import '../utils/naver-commerce-client';
```
> `custom-self-hosted-adapter`는 named import(`:46~52`)로 다른 함수(issueCustomWebhookSecret 등)도 쓰므로 import 유지. cafe24/naver는 부수효과 전용이라 제거 가능(등록은 register-providers가 담당).

- [ ] **Step 5: tsc + 회귀 + providers verify**

Run:
```bash
cd packages/backend && npx tsc --noEmit
npm run test
npx ts-node src/utils/__tests__/provider-registry-ui.verify.ts
```
Expected: tsc 0 / 회귀 통과 / verify 통과

- [ ] **Step 6: 등록 결과 수동 확인 (선택 — 라우트 응답 형태)**

`GET /api/cdp/providers` 응답에 cafe24/naver/custom/godo/gabia available + 스켈레톤 5종 coming_soon, 각 connectMethod 포함되는지 보고에 기재.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/utils/register-providers.ts packages/backend/src/app.ts packages/backend/src/routes/cdp.ts
git commit -m "feat(cdp): B4 register-providers 단일 출처 + app.ts 부팅 등록(gap 7) + cdp.ts side-effect import 제거"
```

---

## Task B6: 프론트 CdpSettingsPage 동적 provider 로드

**Files:**
- Modify: `packages/frontend/src/pages/CdpSettingsPage.tsx`

> 현재 PROVIDER_CARDS 하드코딩(`:269`). `GET /api/cdp/providers` 로드해 카드 렌더. 로드 실패 시 기존 하드코딩 5종 폴백(빈 화면 방지 — feedback_ui_simplify_not_empty). connectMethod로 모달 분기. 기존 모달 컴포넌트/상태 보존.

- [ ] **Step 1: provider 응답 타입 + state 추가**

PROVIDER_CARDS 하드코딩은 **폴백 상수**로 유지(이름 변경 `PROVIDER_CARDS_FALLBACK`). 신규 state:
```ts
type ProviderApiEntry = { provider: ProviderKey | string; displayName: string; connectMethod: 'oauth' | 'webhook' | 'polling' | 'none'; available: boolean; status: 'available' | 'coming_soon'; };
const [providerCards, setProviderCards] = useState<ProviderApiEntry[] | null>(null);
```

- [ ] **Step 2: 마운트 시 로드 (기존 fetch 패턴 정합)**

```ts
useEffect(() => {
  let alive = true;
  (async () => {
    try {
      const res = await api.get('/api/cdp/providers'); // 기존 api 클라이언트 패턴 사용
      if (alive && res.data?.success && Array.isArray(res.data.providers)) {
        setProviderCards(res.data.providers);
      }
    } catch {
      if (alive) setProviderCards(null); // 폴백
    }
  })();
  return () => { alive = false; };
}, []);
```
> `api` import 및 호출 방식은 파일 내 기존 fetch 헬퍼(usage/install-status 로드 부분)와 동일 패턴 사용 — 새 클라이언트 도입 금지.

- [ ] **Step 3: 렌더를 동적 소스로 — 카드 맵핑 (`:911` 영역)**

available 카드만 클릭 활성, coming_soon은 "곧 출시" 비활성. 클릭 시 connectMethod로 모달 분기:
```tsx
const cardsSource: ProviderApiEntry[] = providerCards
  ? providerCards.filter(p => ['cafe24','naver','godo','gabia','custom'].includes(String(p.provider)) ? true : p.status === 'coming_soon')
  : PROVIDER_CARDS_FALLBACK.map(p => ({ provider: p.key, displayName: p.name, connectMethod: p.key === 'cafe24' || p.key === 'naver' ? 'oauth' : p.key === 'godo' ? 'polling' : 'webhook', available: true, status: 'available' as const }));
```
> 기존 5종(cafe24/naver/godo/gabia/custom)은 전용 모달이 있으므로 그대로 표시. 스켈레톤(shopify 등)은 coming_soon 비활성 카드로 노출(또는 hide — Harold 확정 필요, 기본은 노출). 각 카드 `desc`는 PROVIDER_META note 재사용. 모달 오픈은 기존 `setOpenProvider(p.provider)` 상태(ProviderKey)로 분기 — connectMethod는 안내 문구·아이콘 선택에만 사용, 실제 모달 컴포넌트는 기존 분기 유지.

- [ ] **Step 4: 자가 grep — 모델명/native dialog 0건**

Run:
```bash
grep -nE "Opus|Sonnet|Haiku|GPT|Claude|Anthropic" packages/frontend/src/pages/CdpSettingsPage.tsx
grep -nE "alert\(|confirm\(|prompt\(" packages/frontend/src/pages/CdpSettingsPage.tsx
```
Expected: 0건 (둘 다)

- [ ] **Step 5: frontend tsc**

Run: `cd packages/frontend && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/pages/CdpSettingsPage.tsx
git commit -m "feat(cdp): B6 CdpSettingsPage provider 동적 로드(폴백 보존·connectMethod 분기)"
```

---

## Phase B 종료 게이트

- [ ] backend tsc 0 + `npm run test` 회귀 + provider-registry-ui.verify 통과
- [ ] frontend tsc 0 + 모델명/native dialog 자가 grep 0건
- [ ] `GET /api/cdp/providers` 응답에 5 available + 스켈레톤 coming_soon + connectMethod 노출 확인(보고)

---

# Phase C — 데이터 정합 / 하드닝

## Task C8: bulk-import truncation 경고 (gap 8)

**Files:**
- Modify: `packages/backend/src/utils/cdp-orders.ts` (`:221`, `:237~274`)
- Modify: `packages/backend/src/routes/cdp.ts` (`:705~707`)

- [ ] **Step 1: BulkImportResult에 truncation 필드 추가 (`:221~227`)**

```ts
export interface BulkImportResult {
  customersImported: number;
  customersFailed: number;
  ordersImported: number;
  ordersFailed: number;
  customersTruncated: boolean;
  ordersTruncated: boolean;
  droppedCustomers: number;
  droppedOrders: number;
  warning?: string;
  failures: Array<{ type: 'customer' | 'order'; externalId?: string; orderId?: string; error: string }>;
}
```

- [ ] **Step 2: bulkImport 본문에서 truncation 계산 (`:242~251`, `:272~273`)**

`:242~243` 아래(slice 직후)에:
```ts
  const customersInput = input.customers || [];
  const ordersInput = input.orders || [];
  const customerList = customersInput.slice(0, BULK_IMPORT_MAX_ROWS);
  const orderList = ordersInput.slice(0, BULK_IMPORT_MAX_ROWS);
  const droppedCustomers = Math.max(0, customersInput.length - customerList.length);
  const droppedOrders = Math.max(0, ordersInput.length - orderList.length);
```
result 초기화(`:245~251`)에 추가:
```ts
    customersTruncated: droppedCustomers > 0,
    ordersTruncated: droppedOrders > 0,
    droppedCustomers,
    droppedOrders,
```
return 직전(`:272`)에:
```ts
  if (droppedCustomers > 0 || droppedOrders > 0) {
    result.warning = `요청 1건당 최대 ${BULK_IMPORT_MAX_ROWS}건까지만 처리됩니다. 초과분(고객 ${droppedCustomers}건 / 주문 ${droppedOrders}건)은 처리되지 않았습니다. 페이지네이션으로 나눠 호출해주세요.`;
    console.log(`[CDP bulkImport] truncation — droppedCustomers=${droppedCustomers} droppedOrders=${droppedOrders} (company=${companyId})`);
  }
```

- [ ] **Step 3: 라우트 응답에 그대로 노출 (`routes/cdp.ts:707` — 이미 `...result`라 자동 노출)**

`:707`은 `return res.json({ success: true, ...result });` — truncation/warning 필드 자동 포함. 추가 변경 불필요(확인만).

- [ ] **Step 4: tsc**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors

> 검증: bulkImport는 DB(identifyCustomer/syncOrder) 의존이라 순수 verify 부적합. truncation 계산만 순수지만 인라인이 단순(slice 길이 비교)이라 별도 함수 추출 없이 tsc + 실측 1건(1001건 전송→droppedCustomers=1)으로 확인. 보고에 1건 시나리오 기재.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/utils/cdp-orders.ts
git commit -m "feat(cdp): C8 bulk-import truncation 경고(silent drop 폐기)"
```

---

## Task C5: occurred_at 클램프 (gap 5)

**Files:**
- Create: `packages/backend/src/utils/cdp-occurred-at.ts`
- Test: `packages/backend/src/utils/__tests__/cdp-occurred-at.verify.ts`
- Modify: `packages/backend/src/utils/cdp-events.ts` (`:178~181` trackEvent, `:413~414` ingestBrowserEvents)

- [ ] **Step 1: Write the failing test**

```ts
// packages/backend/src/utils/__tests__/cdp-occurred-at.verify.ts
/**
 * cdp-occurred-at.verify.ts — 자사몰 전송 occurred_at 클램프 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/cdp-occurred-at.verify.ts
 * (DB import 0 — clampOccurredAt 순수. 미래만 클램프(시계 오차 5분 허용), 과거는 마이그레이션 정상이라 통과.)
 */
import assert from 'node:assert';
import { clampOccurredAt } from '../cdp-occurred-at';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const NOW = new Date('2026-06-25T00:00:00.000Z');
const MIN = 60 * 1000;

console.log('[cdp-occurred-at] clampOccurredAt — 미래 클램프 / 파싱실패 now / 과거 통과');

ok('정상 과거 시각 → 그대로', () =>
  assert.strictEqual(clampOccurredAt('2026-06-24T12:00:00.000Z', NOW).toISOString(), '2026-06-24T12:00:00.000Z'));

ok('미래 10분 → now로 클램프', () =>
  assert.strictEqual(clampOccurredAt(new Date(NOW.getTime() + 10 * MIN), NOW).getTime(), NOW.getTime()));

ok('미래 3분(5분 이내 시계오차) → 그대로 통과', () =>
  assert.strictEqual(clampOccurredAt(new Date(NOW.getTime() + 3 * MIN), NOW).getTime(), NOW.getTime() + 3 * MIN));

ok('정확히 now+5분 경계 → 그대로(> 비교)', () =>
  assert.strictEqual(clampOccurredAt(new Date(NOW.getTime() + 5 * MIN), NOW).getTime(), NOW.getTime() + 5 * MIN));

ok('파싱 실패 문자열 → now', () =>
  assert.strictEqual(clampOccurredAt('not-a-date', NOW).getTime(), NOW.getTime()));

ok('undefined → now', () =>
  assert.strictEqual(clampOccurredAt(undefined, NOW).getTime(), NOW.getTime()));

ok('null → now', () =>
  assert.strictEqual(clampOccurredAt(null, NOW).getTime(), NOW.getTime()));

ok('먼 과거(2년 전) → 그대로(마이그레이션 정상)', () =>
  assert.strictEqual(clampOccurredAt('2024-06-25T00:00:00.000Z', NOW).toISOString(), '2024-06-25T00:00:00.000Z'));

console.log(`\n[cdp-occurred-at] ${passed}/8 passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ts-node packages/backend/src/utils/__tests__/cdp-occurred-at.verify.ts`
Expected: FAIL — module 없음

- [ ] **Step 3: Write implementation**

```ts
// packages/backend/src/utils/cdp-occurred-at.ts
/**
 * ★ CDP 이벤트 occurred_at 클램프 — 순수(DB import 0). 2026-06-25 (gap 5)
 *   자사몰 전송 시각을 그대로 신뢰하면 미래/이상치가 커서·통계를 왜곡. 미래만 보정(과거는 마이그레이션 정상).
 *   - 파싱 실패/미전달 → now
 *   - now + 5분 초과(미래) → now (시계 오차 5분 허용)
 *   - 그 외(과거·근접) → 그대로
 */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export function clampOccurredAt(raw: string | Date | undefined | null, now: Date): Date {
  let d: Date;
  if (raw === undefined || raw === null) {
    d = now;
  } else if (raw instanceof Date) {
    d = raw;
  } else {
    d = new Date(raw);
  }
  if (isNaN(d.getTime())) return now;
  if (d.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) return now;
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ts-node packages/backend/src/utils/__tests__/cdp-occurred-at.verify.ts`
Expected: PASS — `8/8 passed`

- [ ] **Step 5: trackEvent 배선 (`cdp-events.ts:178~181`)**

```ts
import { clampOccurredAt } from './cdp-occurred-at';
```
`:178~181` 교체:
```ts
  const occurredAt = clampOccurredAt(input.occurredAt, new Date());
```
> 기존 `isNaN` throw 제거 — 파싱 실패는 now로 흡수(차단 X). 단, 명백한 형식 오류 거부가 필요하면 호출부 입력 검증은 유지하되 occurred_at만 클램프.

- [ ] **Step 6: ingestBrowserEvents 배선 (`cdp-events.ts:413~414`)**

`:413~414` 교체:
```ts
  const occurred = clampOccurredAt(batch.sentAt, new Date());
```

- [ ] **Step 7: tsc + 회귀**

Run:
```bash
cd packages/backend && npx tsc --noEmit
npm run test
npx ts-node src/utils/__tests__/cdp-occurred-at.verify.ts
```
Expected: tsc 0 / 회귀 통과 / verify 8/8

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/utils/cdp-occurred-at.ts packages/backend/src/utils/__tests__/cdp-occurred-at.verify.ts packages/backend/src/utils/cdp-events.ts
git commit -m "feat(cdp): C5 occurred_at 미래 클램프(트랙/인제스트) + verify"
```

---

## Task C6: 버스트 rate limit (gap 6)

**Files:**
- Create: `packages/backend/src/utils/cdp-burst-limit.ts`
- Test: `packages/backend/src/utils/__tests__/cdp-burst-limit.verify.ts`
- Modify: `packages/backend/src/routes/cdp.ts` (write endpoints `:195` identify, `:235` event, `:269` order, `:107` ingest)

- [ ] **Step 1: Write the failing test (순수 슬라이딩 윈도우)**

```ts
// packages/backend/src/utils/__tests__/cdp-burst-limit.verify.ts
/**
 * cdp-burst-limit.verify.ts — 회사별 슬라이딩 윈도우 버스트 카운터 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/cdp-burst-limit.verify.ts
 * (DB import 0 — evaluateBurst 순수. 시간/타임스탬프는 인자 주입.)
 */
import assert from 'node:assert';
import { evaluateBurst } from '../cdp-burst-limit';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const WIN = 10_000; // 10s
const MAX = 3;

console.log('[cdp-burst-limit] evaluateBurst — windowMs 내 maxPerWindow 초과 차단');

ok('빈 상태 첫 호출 → 허용 + retained 1건', () => {
  const r = evaluateBurst({ timestamps: [] }, 1000, WIN, MAX);
  assert.strictEqual(r.allowed, true);
  assert.deepStrictEqual(r.retained, [1000]);
});

ok('윈도우 내 3건째까지 허용(max=3)', () => {
  let state = { timestamps: [] as number[] };
  let r = evaluateBurst(state, 1000, WIN, MAX); state = { timestamps: r.retained };
  r = evaluateBurst(state, 1100, WIN, MAX); state = { timestamps: r.retained };
  r = evaluateBurst(state, 1200, WIN, MAX);
  assert.strictEqual(r.allowed, true);
});

ok('윈도우 내 4건째 → 차단(allowed=false), retained는 push 안 함', () => {
  const r = evaluateBurst({ timestamps: [1000, 1100, 1200] }, 1300, WIN, MAX);
  assert.strictEqual(r.allowed, false);
  assert.deepStrictEqual(r.retained, [1000, 1100, 1200]);
});

ok('오래된 타임스탬프(윈도우 밖)는 만료 → 다시 허용', () => {
  // 1000,1100,1200 은 now=12000 기준 cutoff=2000보다 작아 전부 만료
  const r = evaluateBurst({ timestamps: [1000, 1100, 1200] }, 12000, WIN, MAX);
  assert.strictEqual(r.allowed, true);
  assert.deepStrictEqual(r.retained, [12000]);
});

ok('경계: cutoff와 정확히 같은 시각은 만료(> cutoff만 유지)', () => {
  // now=11000, cutoff=1000 → t=1000은 만료, t=1001 유지
  const r = evaluateBurst({ timestamps: [1000, 1001, 1002] }, 11000, WIN, MAX);
  assert.deepStrictEqual(r.retained.includes(1000), false);
});

console.log(`\n[cdp-burst-limit] ${passed}/5 passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ts-node packages/backend/src/utils/__tests__/cdp-burst-limit.verify.ts`
Expected: FAIL — module 없음

- [ ] **Step 3: Write implementation (순수 + 미들웨어 팩토리)**

```ts
// packages/backend/src/utils/cdp-burst-limit.ts
/**
 * ★ CDP 버스트 rate limit — 2026-06-25 (gap 6)
 *   월 한도(cdp-auth)만으론 초당/분당 폭주 방어 불가. 회사별 슬라이딩 윈도우(프로세스 메모리) 1차 방어.
 *   evaluateBurst는 순수(시간 주입). 미들웨어는 회사별 Map으로 상태 보관.
 *   - 메모리 기반이라 pm2 인스턴스별 — 분산 공유는 범위 밖(1차 방어로 충분).
 *   - bulk-import는 제외(이미 월 한도 + 1000건 캡).
 */
import { Request, Response, NextFunction } from 'express';

export interface BurstWindowState { timestamps: number[]; }

/** 순수 — 윈도우 밖 만료 후 max 미만이면 now push & 허용. 초과면 차단(retained 그대로). */
export function evaluateBurst(
  state: BurstWindowState, now: number, windowMs: number, maxPerWindow: number,
): { allowed: boolean; retained: number[] } {
  const cutoff = now - windowMs;
  const retained = state.timestamps.filter((t) => t > cutoff);
  if (retained.length >= maxPerWindow) {
    return { allowed: false, retained };
  }
  retained.push(now);
  return { allowed: true, retained };
}

/**
 * 회사별 버스트 미들웨어 팩토리. req.cdpAuth.companyId 기준.
 * 초과 시 429 RATE_LIMITED. companyId 없으면 통과(인증 미들웨어가 앞단에서 차단).
 */
const companyWindows = new Map<string, number[]>();

export function cdpBurstLimit(maxPerWindow: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const companyId = (req as any).cdpAuth?.companyId as string | undefined;
    if (!companyId) { next(); return; }
    const now = Date.now();
    const state: BurstWindowState = { timestamps: companyWindows.get(companyId) || [] };
    const { allowed, retained } = evaluateBurst(state, now, windowMs, maxPerWindow);
    companyWindows.set(companyId, retained);
    if (!allowed) {
      res.status(429).json({ success: false, error: '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ts-node packages/backend/src/utils/__tests__/cdp-burst-limit.verify.ts`
Expected: PASS — `5/5 passed`

- [ ] **Step 5: write endpoint 4곳에 미들웨어 적용 (보수적 한도)**

`routes/cdp.ts` import 추가:
```ts
import { cdpBurstLimit } from '../utils/cdp-burst-limit';
```
한도 상수(보수적 시작 — 회사당 50req/10초):
```ts
const cdpWrite Burst = cdpBurstLimit(50, 10_000);
```
> (변수명 공백 없이 `cdpWriteBurst`로.) 적용 — `requireCdpApiKey` 뒤(companyId 확정 후), 핸들러 앞:
- `:195` `router.post('/identify', requireCdpApiKey, cdpWriteBurst, async ...)`
- `:235` `router.post('/event', requireCdpApiKey, cdpWriteBurst, async ...)`
- `:269` `router.post('/order', requireCdpApiKey, cdpWriteBurst, async ...)`
- `:107` `router.post('/ingest', requireCdpBrowserOrigin, cdpWriteBurst, async ...)` — ingest는 cdpAuth.companyId 세팅 위치 확인 후 적용(없으면 통과 설계라 안전). **bulk-import(`:665`)는 적용 제외.**

> ingest는 `requireCdpBrowserOrigin`이 companyId를 cdpAuth에 넣는지 확인 — 안 넣으면 미들웨어가 통과시키므로 무해. 넣으면 정상 동작.

- [ ] **Step 6: tsc + 회귀**

Run:
```bash
cd packages/backend && npx tsc --noEmit
npm run test
npx ts-node src/utils/__tests__/cdp-burst-limit.verify.ts
```
Expected: tsc 0 / 회귀 통과 / verify 5/5

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/utils/cdp-burst-limit.ts packages/backend/src/utils/__tests__/cdp-burst-limit.verify.ts packages/backend/src/routes/cdp.ts
git commit -m "feat(cdp): C6 회사별 버스트 rate limit(50req/10s, write 4경로·bulk 제외) + verify"
```

---

## Phase C 종료 게이트

- [ ] backend tsc 0 + `npm run test` 회귀 + C5/C6 verify 통과
- [ ] C8 실측 1건(1001건 전송 → droppedCustomers=1 + warning) 보고

---

# Phase D — 여정 트리거 변수 한계 분류 (gap 1)

> 전수 분류 결과(코드 정독): 이벤트성 트리거 = purchase / reservation_created / custom_order_shipped(커서 경로 3종) + cart_abandon(별도 properties 동봉, `trigger-watcher:155`). **커서 경로 밖 이벤트성 트리거 = 0건.** 상태성(customer.created/dormant/birthday_approaching/points_expiring/custom)은 진입 이벤트가 없어 properties 원천 부재(설계상 정상). → 라우팅 변경 0, 분류 함수(회귀 가드) + 문서 명시로 종결.

## Task D: classifyJourneyTrigger 분류 함수 (회귀 가드) + 문서

**Files:**
- Modify: `packages/backend/src/utils/journey-cdp-cursor.ts` (resolveCdpCursorEventName 옆)
- Test: `packages/backend/src/utils/__tests__/journey-trigger-class.verify.ts`

- [ ] **Step 1: Write the failing test (전 트리거 분류 + 커서 정합 가드)**

```ts
// packages/backend/src/utils/__tests__/journey-trigger-class.verify.ts
/**
 * journey-trigger-class.verify.ts — 여정 트리거 이벤트성/상태성 분류 + 커서 경로 정합 가드
 * 실행: npx ts-node packages/backend/src/utils/__tests__/journey-trigger-class.verify.ts
 * (DB import 0. 새 이벤트성 트리거가 커서 경로 밖에 추가되면 이 테스트가 깨져 누락을 알린다 — 회귀 가드.)
 */
import assert from 'node:assert';
import { classifyJourneyTrigger, resolveCdpCursorEventName } from '../journey-cdp-cursor';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[journey-trigger-class] classifyJourneyTrigger — 9 트리거 전수 분류');

ok('cdp.purchase → event_cursor', () => assert.strictEqual(classifyJourneyTrigger('cdp.purchase'), 'event_cursor'));
ok('cdp.reservation_created → event_cursor', () => assert.strictEqual(classifyJourneyTrigger('cdp.reservation_created'), 'event_cursor'));
ok('custom_order_shipped → event_cursor', () => assert.strictEqual(classifyJourneyTrigger('custom_order_shipped'), 'event_cursor'));
ok('cdp.cart_abandon → event_special(별도 properties 동봉)', () => assert.strictEqual(classifyJourneyTrigger('cdp.cart_abandon'), 'event_special'));
ok('customer.created → state', () => assert.strictEqual(classifyJourneyTrigger('customer.created'), 'state'));
ok('customer.dormant → state', () => assert.strictEqual(classifyJourneyTrigger('customer.dormant'), 'state'));
ok('customer.birthday_approaching → state', () => assert.strictEqual(classifyJourneyTrigger('customer.birthday_approaching'), 'state'));
ok('customer.points_expiring → state', () => assert.strictEqual(classifyJourneyTrigger('customer.points_expiring'), 'state'));
ok('custom → state', () => assert.strictEqual(classifyJourneyTrigger('custom'), 'state'));

// ★ 회귀 가드: event_cursor로 분류된 트리거는 반드시 resolveCdpCursorEventName이 non-null이어야 한다.
const EVENT_CURSOR = ['cdp.purchase', 'cdp.reservation_created', 'custom_order_shipped'];
ok('event_cursor 트리거 ↔ resolveCdpCursorEventName non-null 정합', () => {
  for (const t of EVENT_CURSOR) {
    assert.strictEqual(classifyJourneyTrigger(t), 'event_cursor');
    assert.notStrictEqual(resolveCdpCursorEventName(t), null);
  }
});
ok('state 트리거는 resolveCdpCursorEventName null', () =>
  assert.strictEqual(resolveCdpCursorEventName('customer.dormant'), null));

console.log(`\n[journey-trigger-class] ${passed}/11 passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx ts-node packages/backend/src/utils/__tests__/journey-trigger-class.verify.ts`
Expected: FAIL — `classifyJourneyTrigger` export 없음

- [ ] **Step 3: journey-cdp-cursor.ts에 분류 함수 추가 (resolveCdpCursorEventName 아래 `:76`)**

```ts
export type JourneyTriggerClass = 'event_cursor' | 'event_special' | 'state';

/**
 * 여정 트리거 이벤트성/상태성 분류 — 단일 출처.
 *   - event_cursor: 진입 cdp_event + 치환 가치 properties 보유 → 커서 경로(누락 0·정확히 1회·properties 동봉).
 *   - event_special: cart_abandon — 이벤트 기반이나 "이후 결제 없음" 파생 상태라 별도 properties 동봉(trigger-watcher).
 *   - state: 휴면/생일/포인트/신규/자유 세그먼트 — 진입 이벤트 없음(properties 원천 부재, 설계상 정상).
 * 새 이벤트성 트리거 추가 시 event_cursor면 resolveCdpCursorEventName도 함께 추가(테스트 가드가 강제).
 */
export function classifyJourneyTrigger(triggerEvent: string): JourneyTriggerClass {
  switch (triggerEvent) {
    case 'cdp.purchase':
    case 'cdp.reservation_created':
    case 'custom_order_shipped':
      return 'event_cursor';
    case 'cdp.cart_abandon':
      return 'event_special';
    default:
      return 'state';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx ts-node packages/backend/src/utils/__tests__/journey-trigger-class.verify.ts`
Expected: PASS — `11/11 passed`

- [ ] **Step 5: 회귀 (기존 journey-cdp-cursor.test.ts vitest)**

Run: `cd packages/backend && npm run test`
Expected: 회귀 통과 (journey-cdp-cursor.test.ts 포함)

- [ ] **Step 6: 문서에 한계 명시 (Phase E와 함께 또는 여기서)**

`docs/AI_OPERATOR_기능정의서.md` 여정 섹션에 "여정 진입 이벤트 변수 동봉 가능 트리거 = 구매·예약·배송(커서) + 장바구니(별도). 상태성 트리거(휴면·생일·포인트·신규·자유)는 진입 이벤트가 없어 이벤트 변수 동봉 불가(고객 컬럼 변수만 사용)" 1단락 추가.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/utils/journey-cdp-cursor.ts packages/backend/src/utils/__tests__/journey-trigger-class.verify.ts docs/AI_OPERATOR_기능정의서.md
git commit -m "feat(journey): D 트리거 이벤트성/상태성 분류 함수 + 회귀 가드 + 한계 문서화"
```

## Phase D 실측 1건 (발송 — 회귀 확인)

> D는 라우팅 변경 0(분류·문서만)이라 신규 발송 동작 없음. 실측 = 기존 동작 회귀 확인:
> 구매(cdp.purchase) 여정 1건을 활성화하고 테스트 구매 이벤트 1건을 발생시켜, 알림톡/문자 변수에 진입 이벤트 properties(상품명 등)가 **여전히** 채워지는지 확인(D232 "정확히 1회 + properties 동봉" 보존). 새 코드가 기존 커서 경로를 건드리지 않았음을 입증.

---

# Phase E — 문서 정합 (gap 9)

## Task E: 문서 3종 갱신

**Files:**
- Modify: `docs/AI_OPERATOR_기능정의서.md` §8-2
- Modify: `packages/backend/src/utils/provider-registry.ts` (상단 주석 `:11~16`)
- Modify: `status/SCHEMA.md` (A4 테이블 — A4-table Step 3에서 선반영, 여기서 누락 시 보완)

- [ ] **Step 1: 기능정의서 §8-2 자사몰 통합 매트릭스 갱신**

실제로 갱신:
- cafe24 — OAuth (available)
- naver 스마트스토어 — OAuth (available)
- 고도몰 — 폴링(쇼핑몰 인증키) (available)
- 자체 호스팅 — webhook + 서명검증 (available)
- 가비아 — webhook(자체 호스팅 위임) (available)
- shopify / 메이크샵 / imweb / 식스샵 / WooCommerce — 스켈레톤(coming_soon)

- [ ] **Step 2: provider-registry.ts 상단 주석 실제와 일치 (`:11~16`)**

"📋 등록된 Provider" 목록을 cafe24(oauth)·naver(oauth)·custom(webhook)·godo(polling)·gabia(webhook) + 스켈레톤 5종으로 갱신. 등록 출처 = register-providers.ts 명시.

- [ ] **Step 3: SCHEMA.md 확인 (A4-table에서 기록됐는지)**

`cdp_identity_review` 7컬럼 + 인덱스가 status/SCHEMA.md에 있는지 확인. 누락 시 추가.

- [ ] **Step 4: 자가 grep — 문서 박-단어/모델명 0건**

Run:
```bash
grep -nE "옛|박[음힘는을힌지혀힙히혔힐았]|진정|정합|매트릭스|Opus|Sonnet|Haiku|GPT|Claude" docs/AI_OPERATOR_기능정의서.md packages/backend/src/utils/provider-registry.ts
```
> 코드 주석 내 모델명은 예외(no_model_name_ui_exposure)지만 문서는 추상 명칭. 검출 시 자연 한국어로 재작성.

- [ ] **Step 5: Commit**

```bash
git add docs/AI_OPERATOR_기능정의서.md packages/backend/src/utils/provider-registry.ts status/SCHEMA.md
git commit -m "docs(cdp): E 자사몰 통합 매트릭스·provider 주석·SCHEMA 정합(gap 9)"
```

---

# 전체 종료 게이트

- [ ] 모든 phase tsc 0 + `npm run test` 회귀 + 신규 verify 6종(cdp-phone-sync / cdp-identity-conflict / provider-registry-ui / cdp-occurred-at / cdp-burst-limit / journey-trigger-class) 전부 passed
- [ ] frontend(B6) tsc 0 + 모델명/native dialog 자가 grep 0건
- [ ] A1·D 실측 1건 시나리오 보고
- [ ] (권장) provider 추가(B)·DB 변경(A4) `/codex:adversarial-review`
- [ ] 표준 종료 멘트 — Harold님 직접 git add/commit/push 및 배포

---

# 범위 밖 (이번 X)

- Shopify/메이크샵/imweb/식스샵/WooCommerce 실제 어댑터 구현(Phase 2 — 실 도입 고객 생기면 별도)
- identity 자동 병합 도구(충돌은 플래그만, 병합 UI는 후일)
- CDP 분산(다중 PM2) 공유 rate limit(메모리 1차 방어로 시작)

---

# Self-Review (작성 후 점검)

**Spec coverage:** A1(Task A1+A-wire)·A4(A4-table/recorder/detect+A-wire)·B(B1~B6, gap3+gap7)·C8·C5·C6·D(분류+문서)·E(문서3종) — 8갭+문서 전부 매핑됨. ✔
**사실 정정 반영:** GET /providers 기존 존재 / customSelfHostedAdapter 기존 등록 / godo·gabia 어댑터 부재 → B에서 정확히 처리. ✔
**Type 일관성:** `decidePhoneUpdate`/`detectIdentityConflict`/`recordIdentityReview`/`clampOccurredAt`/`evaluateBurst`/`classifyJourneyTrigger` 시그니처가 verify ↔ 구현 ↔ 배선에서 동일. `buildProvidersForUI`/`listProvidersForUI` 반환 타입 일관. ✔
**Placeholder:** 모든 코드 step에 실제 코드 포함, TBD 없음. (B6 프론트는 기존 api 헬퍼 패턴 의존 — 파일 내 동일 패턴 사용 명시.) ✔
**의존 순서:** A4-table(Harold SQL) → A4-recorder/detect → A-wire / B1 인터페이스 → B2/B3 → B4 → B6 / C5·C6·C8 독립 / D 독립 / E 마지막. ✔
