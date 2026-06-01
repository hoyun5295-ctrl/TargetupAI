# AI 크레딧 — 사용 이력 + 선불 잔액 모달 현대화 + 크레딧 충전 설계 (D229+)

> 2026-06-01. Harold 명시 3건. 돈·잔액 직접 차감/청구 포함 → 설계 컨펌 + DB ALTER 후 구현.
> 빌드 순서: Phase A(스키마 변경 없음 — 즉시 구현) → Phase B(돈·스키마 — ALTER 후 + adversarial review).

## 확정 결정 (Harold)
- 크레딧 단가 = **2,000원/크레딧 (VAT 별도)**, VAT 10% 합산. **보너스 없음.** (충전은 일부러 비싸게 둬 구독 유도 — 5,000 크레딧 11,000,000원 > 엔터 7,000 크레딧 5,500,000원)
- 단가는 화면에 단가로 노출 X — 사용자에겐 "작업 가능 횟수 + VAT 포함 총액"만.
- 선불사: 발송 잔액(`companies.balance`)에서 **즉시 차감 + 크레딧 즉시 지급**.
- 후불사: 사용자 **충전 요청 → 슈퍼관리자 승인** → 승인 시 크레딧 지급 + 그 금액을 월말 문자요금 정산서에 합산.

## 기존 자산 (재사용)
- `companies`: `balance`(선불 원), `ai_credits_base_remaining`/`ai_credits_purchased`, `billing_type`.
- `ai_credit_transactions`: 크레딧 이력 (type=deduct/grant/purchase/reset/postpaid_grant, source, balance_*_after, reason).
- `balance_transactions`: 선불 원 이력 (deduct/refund/charge).
- CT `utils/ai-credit.ts`: `getCreditState`, `adjustCredit`/`adjustCreditWithClient`(구매분 지급, 트랜잭션), `getCreditTransactions`.
- CT `utils/prepaid.ts`: 선불 차감 패턴(SELECT FOR UPDATE + balance_transactions INSERT).
- 요청·승인 패턴: `plan_requests`(companies POST + admin approve/reject), `deposit_requests`(잔액 충전 요청).
- 정산: `billings`(POST /billing/generate — 발송 집계 자동) / `billing_invoices`(POST /billing/invoices — 수동). subtotal=수량×단가, vat=round(×0.1).

---

## Phase A — 스키마 변경 없음 (즉시 구현)

### A-1. 크레딧 사용 이력 모달 (Feature 1)
- 신규 endpoint `GET /api/companies/my-credit/transactions?page=N` → `getCreditTransactions(companyId, page, 20)` 재사용(슈퍼관리자 것의 사용자 버전).
- 신규 컴포넌트 `CreditHistoryModal.tsx`(다크/모던): 행별 시각·작업명(source 한글)·구분(차감 rose / 충전·지급 emerald)·크레딧·차감 후 잔여. 페이지네이션.
- source→한글 라벨 맵을 `constants/credit.ts`에 추가(orchestrate=풀분석, dm-builder=모바일 DM, journey-*=여정, generate=생성, refine=다듬기, reset=월 리셋, grant=지급, purchase=충전…).
- Dashboard 발송현황 크레딧 클릭 → `/pricing` 이동 대신 이 모달 open. (요금제로 가는 링크는 모달 안 "요금제 보기"로 유지)
- PricingPage·AI Operator 칩에서도 동일 모달 재사용 가능.

### A-2. 선불 잔액 모달 현대화 (Feature 2)
- 현재 모달(돈자루 이모지 + 라이트 톤) → 다크/모던(슬레이트 + emerald 액센트). 충전 잔액 큰 숫자 + 발송 가능 건수(SMS/LMS/MMS/카카오) 칩 + 충전 버튼. 기능 그대로 톤만.
- 위치: frontend BalanceModal 컴포넌트(빌드 시 grep 확정).

---

## Phase B — 돈·스키마 (DB ALTER + adversarial review 후)

### B-0. DB (Harold 직접 실행 — information_schema 검증 SQL 먼저)
신규 테이블 `ai_credit_requests` (충전 요청·이력 통합):
```
CREATE TABLE ai_credit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid,
  credits integer NOT NULL,                  -- 구매 크레딧
  unit_price integer NOT NULL DEFAULT 2000,  -- 단가(기록용)
  supply_amount numeric(12,2) NOT NULL,      -- 공급가 = credits×unit_price
  vat numeric(12,2) NOT NULL,                -- 부가세
  total_amount numeric(12,2) NOT NULL,       -- VAT 포함 합계
  billing_type varchar(20) NOT NULL,         -- prepaid / postpaid (요청 시점)
  payment_method varchar(30) NOT NULL,       -- prepaid_balance / postpaid_invoice
  status varchar(20) NOT NULL DEFAULT 'pending', -- pending / approved / rejected / completed
  processed_by uuid, processed_at timestamptz, admin_note text,
  billed boolean NOT NULL DEFAULT false,     -- 후불: 정산서 반영 여부
  billed_invoice_id uuid,                    -- 반영된 정산서 id
  credit_tx_id uuid,                         -- 지급된 ai_credit_transactions id
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_credit_requests_company ON ai_credit_requests(company_id, created_at DESC);
CREATE INDEX idx_ai_credit_requests_pending ON ai_credit_requests(status) WHERE status = 'pending';
```
정산서 크레딧 합산 컬럼(빌드 시 billings vs billing_invoices 중 후불 실제 청구 테이블 확정 후 ALTER):
```
ALTER TABLE <billing_table> ADD COLUMN ai_credit_count integer DEFAULT 0;
ALTER TABLE <billing_table> ADD COLUMN ai_credit_amount numeric(12,2) DEFAULT 0;  -- 공급가, subtotal에 합산
```

### B-1. 단가 상수 (백엔드 = 진실의 원천)
- `utils/ai-credit-calc.ts` (또는 신규): `CREDIT_UNIT_PRICE = 2000`, `VAT_RATE = 0.1`. 금액 계산은 백엔드에서만 — 프론트는 미리보기용 동일 상수(주석으로 백엔드 일치 명시).

### B-2. 선불 충전 (즉시) — `POST /api/companies/my-credit/recharge`
- body `{ credits }`. 백엔드에서 supply=credits×2000, vat, total 계산.
- 트랜잭션(pool.connect + BEGIN):
  1. companies SELECT FOR UPDATE — billing_type='prepaid' 확인.
  2. `UPDATE companies SET balance = balance - total WHERE id=$ AND balance >= total` (부족 시 롤백 → 409 "잔액 부족, 먼저 충전").
  3. `adjustCreditWithClient`로 구매분 +credits (ai_credit_transactions type='purchase').
  4. balance_transactions INSERT (type='deduct', reference_type='credit_recharge', description "AI 크레딧 N 충전(VAT 포함 X원)").
  5. ai_credit_requests INSERT status='completed'.
  6. COMMIT.
- 응답: 새 balance + 새 크레딧.

### B-3. 후불 충전 (요청→승인)
- `POST /api/companies/my-credit/recharge-request` { credits } → ai_credit_requests status='pending'(중복 pending 차단). billing_type='postpaid' 확인.
- `GET /api/companies/my-credit/recharge-request/status` → pending 표시.
- 슈퍼관리자 `PUT /api/admin/credit-requests/:id/approve` → adjustCredit 구매분 +credits + status='approved' + credit_tx_id. (mirror plan-requests approve)
- `PUT /api/admin/credit-requests/:id/reject` { adminNote }.
- `GET /api/admin/credit-requests?status=pending` → 승인 큐.
- 월말 정산: billing /generate(또는 /invoices) 시 해당 기간 approved + billed=false 인 요청을 합산 → 정산서 ai_credit_amount + subtotal 포함 → billed=true + billed_invoice_id. (billing.ts 집계부 확장)

### B-4. 크레딧 충전 모달 (프론트, 충전 문의 대체)
- 프리셋(100·500·1,000·5,000) + 직접 입력. 보너스 없음.
- 실시간: 작업 가능 횟수(creditConversions) + VAT 포함 총액(백엔드 동일 상수).
- 선불사: "발송 잔액 N원에서 차감 → 충전 후 잔액" + "충전하기"(즉시). 부족 시 차단 + 잔액 충전 안내.
- 후불사: "월말 문자요금과 함께 청구(VAT 포함 X원)" + "충전 요청"(승인 대기). pending 상태 표시.
- CreditSummaryBar·AI Operator 칩·대시보드의 충전 진입 모두 이 모달로.

### B-5. 슈퍼관리자 충전 요청 큐 (AdminDashboard)
- 후불 충전 요청 목록 + 승인/거절. plan-requests 큐와 동일 패턴.

---

## 검증 / 원칙
- db_column_verify: 모든 신규 컬럼/테이블 = information_schema 검증 SQL Harold 확인 후 코드.
- 돈 트랜잭션(B-2/B-3) = pool.connect + BEGIN + SELECT FOR UPDATE + 멱등 + 음수 차단. 구현 후 `/codex:adversarial-review` 의무.
- frontend tsc 0 + 자가 grep(모델명·박-단어·native dialog) 0. 백엔드 tsc 0 + 단위검증.
- 화면 검증 = Harold 시크릿창. preview 금지.
- 빌드: Phase A 먼저(스키마 무관) → ALTER 후 Phase B.
