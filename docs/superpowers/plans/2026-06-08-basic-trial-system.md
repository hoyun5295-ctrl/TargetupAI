# BASIC 1개월 무료체험 시스템 — 구현 계획 (2026-06-08)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, 순차). no_parallel_tasks 룰 — 병렬 에이전트 금지.

**Goal:** AI Operator 오픈 기념 BASIC 1개월 무료체험을 팝업 신청 → 슈퍼관리자 승인 → BASIC 30일 부여 → 자동 FREE 강등으로 구현. PRO 체험 제거, AI op overlay 체험을 BASIC 체험으로 대체. 요금제 변경 알림 모달 추가.

**Architecture:** 기존 plan_requests/approve 흐름 + trial-downgrade-worker 재사용·확장. DB ALTER 0건(무료체험 마커 = message `[무료체험]` 센티넬). 크레딧 불변식(base 월 초기화·purchased 보존) 준수 — 모든 UPDATE는 base/reset_at만, purchased 컬럼 미포함.

**Tech Stack:** Express+TS(backend, ts-node), React+TS+Tailwind(frontend). 백엔드 테스트 = manual-test+ts-node. 프론트 테스트 인프라 없음 → tsc+grep+스모크.

**스펙:** `docs/superpowers/specs/2026-06-08-basic-trial-system-design.md` (전체 상세).

**검증된 사실:** BASIC `plan_code='BASIC'` `ai_credits_per_month=750`. 크레딧 컬럼 `ai_credits_base_remaining`·`ai_credits_reset_at`(purchased 불가침). plan_requests 컬럼 = id·company_id·user_id·requested_plan_id·message·status·admin_note·processed_by·processed_at·created_at·user_confirmed. 매뉴얼 = `window.open('/manual/manual.html','_blank','noopener')`.

**영구 룰:** backend/frontend tsc 0 · 모델명 0 · native dialog 0 · 박-단어 0 · 다크 톤 · 크레딧 purchased 보존.

---

## 파일 구조
- 수정: `backend/src/routes/companies.ts` — `grantBasicTrial` 헬퍼 + `POST /:id/grant-basic-trial` + `POST /:id/revoke-basic-trial` + `POST /trial-request`.
- 수정: `backend/src/routes/admin.ts` — `plan-requests/:id/approve` 무료체험 분기.
- 수정: `backend/src/utils/trial-downgrade-worker.ts` — where 조건 확장.
- 신규: `frontend/src/components/OpenTrialPopup.tsx` · `frontend/src/components/PlanChangeModal.tsx`.
- 수정: `frontend/src/pages/Dashboard.tsx` — 팝업 교체+게이팅 + 요금제 변경 감지. `frontend/src/pages/AdminDashboard.tsx` — PRO 카드 제거·AI op→BASIC·무료체험 배지.
- 보존: `OpenPromoPopup.tsx`(미마운트), `ai-credit.ts`.

---

## Phase A — 백엔드

### Task A1: grantBasicTrial 헬퍼 + grant/revoke-basic-trial 엔드포인트
**Files:** Modify `backend/src/routes/companies.ts` (기존 grant-ai-operator-trial ~1551 근처)

- [ ] **Step 1: grantBasicTrial 헬퍼 추가** (파일 내 export function, query 사용)

```ts
/** BASIC 1개월 무료체험 부여 — plan=BASIC + status=trial + 30일 + base 크레딧(BASIC). purchased 불가침. */
export async function grantBasicTrial(companyId: string, days = 30): Promise<any> {
  const basic = await query(
    `SELECT id, COALESCE(ai_credits_per_month, 0) AS credits FROM plans WHERE plan_code = 'BASIC' AND is_active = true LIMIT 1`,
  );
  if (basic.rows.length === 0) throw new Error('BASIC 요금제가 존재하지 않습니다.');
  const basicPlanId = basic.rows[0].id;
  const basicCredits = Number(basic.rows[0].credits) || 0;
  const updated = await query(
    `UPDATE companies
        SET plan_id                   = $1,
            subscription_status       = 'trial',
            trial_expires_at          = NOW() + ($2::int || ' days')::interval,
            ai_credits_base_remaining = $3,
            ai_credits_reset_at       = NOW(),
            updated_at                = NOW()
      WHERE id = $4
    RETURNING id, plan_id, subscription_status, trial_expires_at,
              (SELECT plan_code FROM plans WHERE id = $1) AS plan_code`,
    [basicPlanId, days, basicCredits, companyId],
  );
  return updated.rows[0];
}
```

- [ ] **Step 2: grant-basic-trial / revoke-basic-trial 라우트 추가**

```ts
router.post('/:id/grant-basic-trial', requireUuidId, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const days = Math.max(1, Math.min(Number((req.body as any)?.days) || 30, 365));
    const exists = await query(`SELECT id FROM companies WHERE id = $1`, [id]);
    if (exists.rows.length === 0) return res.status(404).json({ error: '고객사를 찾을 수 없습니다.' });
    const company = await grantBasicTrial(id, days);
    return res.json({ success: true, message: `${days}일 BASIC 무료체험이 부여되었습니다.`, company });
  } catch (err: any) {
    console.error('grant-basic-trial 실패:', err);
    return res.status(500).json({ error: err?.message || 'BASIC 무료체험 부여 실패' });
  }
});

router.post('/:id/revoke-basic-trial', requireUuidId, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const freeRes = await query(`SELECT id, COALESCE(ai_credits_per_month,0) AS credits FROM plans WHERE plan_code='FREE' LIMIT 1`);
    if (freeRes.rows.length === 0) return res.status(500).json({ error: 'FREE 요금제가 존재하지 않습니다.' });
    const updated = await query(
      `UPDATE companies
          SET plan_id = $1, subscription_status = 'trial_expired',
              ai_credits_base_remaining = $2, ai_credits_reset_at = NOW(), updated_at = NOW()
        WHERE id = $3 AND subscription_status = 'trial'
      RETURNING id, plan_id, subscription_status`,
      [freeRes.rows[0].id, Number(freeRes.rows[0].credits) || 0, id],
    );
    if (updated.rows.length === 0) return res.status(400).json({ error: '취소할 활성 무료체험이 없습니다.' });
    return res.json({ success: true, message: '무료체험이 취소되고 미가입(FREE)으로 전환되었습니다.', company: updated.rows[0] });
  } catch (err: any) {
    console.error('revoke-basic-trial 실패:', err);
    return res.status(500).json({ error: 'BASIC 무료체험 취소 실패' });
  }
});
```

- [ ] **Step 3: tsc** — `cd packages/backend && npx tsc --noEmit` → 0

### Task A2: trial-request 신청 엔드포인트
**Files:** Modify `backend/src/routes/companies.ts` (plan-request ~288 근처)

- [ ] **Step 1: 라우트 추가**

```ts
// POST /api/companies/trial-request — BASIC 1개월 무료체험 신청 (FREE만, [무료체험] 센티넬)
router.post('/trial-request', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const comp = await query(`SELECT p.plan_code FROM companies c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`, [companyId]);
    const planCode = comp.rows[0]?.plan_code;
    if (planCode && planCode !== 'FREE') return res.status(400).json({ error: '무료체험은 미가입(FREE) 상태에서만 신청할 수 있습니다.' });
    const dup = await query(`SELECT id FROM plan_requests WHERE company_id = $1 AND status = 'pending' LIMIT 1`, [companyId]);
    if (dup.rows.length > 0) return res.status(400).json({ error: '이미 처리 대기 중인 신청이 있습니다.' });
    const basic = await query(`SELECT id FROM plans WHERE plan_code = 'BASIC' AND is_active = true LIMIT 1`);
    if (basic.rows.length === 0) return res.status(500).json({ error: 'BASIC 요금제가 존재하지 않습니다.' });
    await query(
      `INSERT INTO plan_requests (company_id, user_id, requested_plan_id, message, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [companyId, userId, basic.rows[0].id, '[무료체험] AI Operator 베이직 1개월 무료체험 신청'],
    );
    return res.json({ success: true, message: '무료체험 신청이 접수되었습니다.' });
  } catch (err: any) {
    console.error('trial-request 실패:', err);
    return res.status(500).json({ error: '무료체험 신청 실패' });
  }
});
```

- [ ] **Step 2: tsc** → 0

### Task A3: approve 무료체험 분기
**Files:** Modify `backend/src/routes/admin.ts` (`plan-requests/:id/approve` ~1165)

- [ ] **Step 1: 현재 approve 코드 read** (정확 편집 위해).
- [ ] **Step 2: SELECT에 message 추가 + 분기**: 요청 row를 `SELECT company_id, requested_plan_id, status, message`로 조회. `message`가 `'[무료체험]'`로 시작하면 `await grantBasicTrial(company_id)` 호출(companies.ts에서 import) 후 plan_requests status='approved' 마킹. 아니면 기존 동작(plan_id 변경 + paid/trial).

```ts
import { grantBasicTrial } from './companies';
// ...
const isTrialReq = typeof request.message === 'string' && request.message.startsWith('[무료체험]');
if (isTrialReq) {
  await grantBasicTrial(request.company_id);
} else {
  // 기존: approvedIsTrial(plan_code==='TRIAL') → status, UPDATE companies plan_id+status
}
// 공통: UPDATE plan_requests SET status='approved', processed_by, processed_at, admin_note
```

- [ ] **Step 3: tsc** → 0

### Task A4: trial-downgrade-worker where 확장
**Files:** Modify `backend/src/utils/trial-downgrade-worker.ts` (runTrialDowngradeJob UPDATE ~52-66)

- [ ] **Step 1: UPDATE where 교체** — `plan_code='TRIAL'` 한정 → `subscription_status='trial'` 기준(BASIC 체험 포함):

```ts
const res = await query(
  `UPDATE companies c
      SET plan_id                   = $1,
          subscription_status       = 'trial_expired',
          ai_credits_base_remaining = $2,
          ai_credits_reset_at       = NOW(),
          updated_at                = NOW()
    WHERE c.subscription_status = 'trial'
      AND c.trial_expires_at IS NOT NULL
      AND c.trial_expires_at < NOW()
  RETURNING c.id, c.company_name`,
  [freePlanId, freeBaseCredits],
);
```
(FROM plans p 제거 — plan_code 무관하게 status='trial' 만료분을 FREE로. base=FREE(0), purchased 미포함=보존.) 주석도 "status='trial' 기준" 으로 갱신.

- [ ] **Step 2: tsc** → 0

---

## Phase B — 프론트

### Task B1: OpenTrialPopup 컴포넌트
**Files:** Create `frontend/src/components/OpenTrialPopup.tsx`

- [ ] **Step 1:** Downloads 제공 tsx 기반 작성. 변경점:
  - `"use client"` 제거. `TRIAL_HREF`/onNavigate 네비 폐기.
  - `shouldShowOpenTrial()` export(24h dismiss, key `targetup_trialpromo_dismiss`) — OpenPromoPopup 패턴.
  - 상태 `submitting`/`submitted`/`errorMsg` 추가. CTA `handleCta` → `fetch('/api/companies/trial-request', {method:'POST', headers:{Authorization:Bearer token}})`. 성공 → `submitted=true`(카드 본문을 성공 뷰로 스왑: "무료체험 신청이 접수되었습니다 — 승인되면 베이직 기능이 1개월간 열립니다" + 닫기). 실패 → `errorMsg` 카드 내 표시(native dialog X).
  - 다크 톤·애니메이션 유지. 약정 문구 없음(이미 trial 버전).
- [ ] **Step 2: tsc** → 0

### Task B2: Dashboard 팝업 교체 + 게이팅
**Files:** Modify `frontend/src/pages/Dashboard.tsx` (import ~10, mount ~3905)

- [ ] **Step 1:** `import OpenPromoPopup` → `import OpenTrialPopup, { shouldShowOpenTrial }`. mount `<OpenPromoPopup />` → `{planInfo?.plan_code === 'FREE' && <OpenTrialPopup />}` (FREE/미가입만). OpenPromoPopup 파일 보존.
- [ ] **Step 2: tsc** → 0

### Task B3: PlanChangeModal + PLAN_FEATURES
**Files:** Create `frontend/src/components/PlanChangeModal.tsx`

- [ ] **Step 1:** 다크 모달(bg-slate-900+violet, ESC/backdrop). props `{ fromPlan, toPlan, isTrial, onClose }`.
  - 상향/활성화: 제목 isTrial?"무료체험이 활성화되었습니다":"[toPlanName] 요금제로 변경되었습니다" + 활성 기능 목록(`PLAN_FEATURES[toPlan]`) + "사용법이 어려우시면 클릭하세요" 버튼 → `window.open('/manual/manual.html','_blank','noopener')`.
  - 하향/종료: 제목 "무료체험이 종료되었습니다" + "다음 기능 이용이 제한됩니다" + 제한 목록(fromPlan 기능 − toPlan 기능).
  - 정적 맵 `PLAN_FEATURES: Record<string,string[]>` + 랭크 `PLAN_RANK`(FREE0·STARTER1·BASIC2·TRIAL2·PRO3·BUSINESS4·ENTERPRISE5). 방향 = rank 비교.
- [ ] **Step 2: tsc** → 0

### Task B4: Dashboard 요금제 변경 감지
**Files:** Modify `frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1:** planInfo 로드 후 useEffect: localStorage `targetup_last_seen_plan` 읽기. 현재 `planInfo.plan_code`와 다르고 옛 값 존재 → `setPlanChange({from, to, isTrial: subscription_status==='trial'})`. 옛 값 없으면 localStorage만 설정(모달 X). PlanChangeModal 렌더, onClose 시 localStorage=현재 plan_code.
- [ ] **Step 2: tsc** → 0

### Task B5: AdminDashboard 카드 변경
**Files:** Modify `frontend/src/pages/AdminDashboard.tsx`

- [ ] **Step 1: read** 30일 PRO 무료체험 카드(~1958-2024)+AI op 카드(~2025-2095) 및 JSX.
- [ ] **Step 2:** "30일 PRO 무료체험" 카드+grantTrial/revokeTrial 핸들러 제거. "AI 오퍼레이션 30일 무료체험" 카드 → "BASIC 1개월 무료체험"(문구: "부여 시 베이직 + 베이직 크레딧 750, 30일 후 자동 FREE") + 핸들러를 `/companies/:id/grant-basic-trial`·`/revoke-basic-trial` 호출로 변경. ai_operator_trial 상태 표시는 subscription_status==='trial'+trial_expires_at 기준으로.
- [ ] **Step 3:** 플랜신청 목록에서 `message.startsWith('[무료체험]')`이면 "무료체험" 배지 표시.
- [ ] **Step 4: tsc** → 0

---

## Phase C — 검증
- [ ] backend tsc 0 + frontend tsc 0.
- [ ] grep: 신규 OpenTrialPopup/PlanChangeModal 모델명·alert/confirm/prompt·박-단어 0.
- [ ] grep: 크레딧 purchased 컬럼이 신규/수정 UPDATE에 포함 안 됨 확인.
- [ ] 스모크(Harold): 팝업 신청 → 목록 표시 → 승인 → companies(plan=BASIC·status=trial·base=750) 실측.

---

## Self-Review (스펙 대조)
- Part1 팝업 → B1·B2. Part2 신청→목록 → A2·B5(배지). Part3 승인 부여 → A1(헬퍼)·A3(분기). Part4 고객사상세 → A1(엔드포인트)·B5. Part5 워커 → A4. Part6 요금제 변경 모달 → B3·B4. ✓
- 크레딧 불변식: A1·A4·revoke 모두 base/reset_at만, purchased 미포함. ✓
- ALTER 0: 마커=message 센티넬. ✓
- 타입 일관: `grantBasicTrial(companyId, days)` A1 정의 → A3 import 사용 동일 시그니처. plan_code 센티넬 `[무료체험]` A2 INSERT ↔ A3 detect 동일.
