# 종량제 Phase 4(슈퍼관리자 크레딧) + Phase 5(고객 잔여·요금제 페이지) 설계도

> 2026-06-01 작성. Phase 1-3(크레딧 엔진 + 차감 통합 + plan-guard 개방) 완료·배포 단계 위에 올리는 "크레딧 가시성·관리" 층.
> 핵심 결정(Harold 확정): **충전 = 슈퍼관리자 수동 지급 우선**(현금 잔액과 동일 흐름). 셀프 결제·충전 단가표·자동 월말청구·자동 충전은 이번 범위 제외.

---

## 0. 토대 검증 결과 (2026-06-01 — 이 설계 진입 전 확인)

기능별 차감(Phase 2)이 실제로 배선됐는지 전수 확인함:
- `callAIWithFallback`은 `companyId`+`source`가 있으면 사전 `checkCredit`(부족 시 호출 차단) + 성공 후 `deductCredit`(Claude·GPT 양쪽). `orchestrate`(20)·`dm-builder`(5)는 묶음으로 진입점 1회 차감.
- `CREDIT_COST_MAP` 30개 source 전부 실제 호출에 연결됨(누락 매핑 0). companyId도 함께 전달(D209+ Phase D 기반, 표본 3곳 직접 확인).
- 의도적 0: dm 내부(parse/copy/tone/improve)·compliance-check·performance-insight(묶음 sub) / continuous-operator-policy(스팸=현금 면제).
- 단서: `deductCredit`은 try/catch 안 실패 시 조용히 skip = 진짜 게이트는 사전 `checkCredit`, 차감은 best-effort. 회계 100% 무결성은 Phase 6에서 보강. 잔여 표시 기준으로는 충분히 정확.

→ Phase 4/5(잔여 표시·관리)를 올릴 토대는 완성.

---

## 1. 확정 사실 (변경 금지)

- 잔여 조회는 `utils/ai-credit.ts getCreditState(companyId)`가 이미 반환: `{ baseRemaining, purchased, total, monthlyCap, planCredits, creditEnabled, resetAt, billingType, overageLimit }`. 재작성 X.
- 슈퍼관리자 현금 잔액 패턴을 그대로 따른다(일관성): `admin.ts /companies/:id/balance-adjust`(수동 충전·차감) + `balance_transactions`(이력). 크레딧은 `ai_credit_transactions`에 기록.
- 요금제 월 크레딧 = `plans.ai_credits_per_month`(이미 값 주입: STARTER 70 / BASIC 200 / PRO 1000 / TRIAL 1000 / BUSINESS 3500 / ENTERPRISE 7000 / FREE 0).
- 후불 한도 = `companies.postpaid_overage_limit`(이미 ALTER, default 0).
- 크레딧 버킷: base(월 기본분, 매월 리셋) → purchased(구매·지급분, 누적). 수동 지급 = purchased 증가.

---

## 2. 백엔드 — CT 확장 + endpoint

### 2-1. CT 함수 (utils/ai-credit.ts / ai-credit-tx.ts — admin.ts 인라인 금지)
- `getMonthlyUsage(companyId): Promise<number>` — 이번 달(KST) `ai_credit_transactions` 차감 합계. "이번달 사용량" 표시용. 순수 조회.
- `adjustCredit({ companyId, amount, type: 'grant' | 'admin_deduct', reason, adminId }): Promise<{ purchasedAfter; txId }>` — 트랜잭션:
  - grant: `companies.ai_credits_purchased += amount`
  - admin_deduct: `ai_credits_purchased -= amount` (0 미만 clamp 차단 → 부족 시 에러)
  - `ai_credit_transactions` INSERT (type, amount, bucket='purchased', source='admin_'+type, created_by=adminId, reason). `balance_transactions`의 before/after 패턴 따름.
- `getCreditTransactions(companyId, page, pageSize): Promise<{ rows; total }>` — 이력 페이지네이션.

### 2-2. endpoint
- 고객: `GET /api/companies/my-credit` → `getCreditState` + `getMonthlyUsage` + resetAt. (인증 미들웨어 companyId)
- 슈퍼관리자(requireSuperAdmin):
  - `GET /api/admin/companies/:id/credit` → getCreditState + monthlyUsage + 최근 이력 N건.
  - `POST /api/admin/companies/:id/credit-adjust` → adjustCredit (사유 필수). `column does not exist` 분기(db_alter_safety_net) + 503.
  - `GET /api/admin/companies/:id/credit-transactions?page=` → getCreditTransactions.
  - `PUT /api/admin/companies/:id/postpaid-overage-limit` → companies.postpaid_overage_limit UPDATE.
  - 기존 `PUT /api/admin/plans/:id`에 `ai_credits_per_month` 필드 처리 추가(요금제별 월 크레딧 설정).

### 2-3. DB 컬럼 검증 의무 (구현 직전 information_schema)
- `ai_credit_transactions`: 차감 기록 시 쓰는 컬럼(company_id, type, amount, bucket, source, created_by, created_at, idempotency_key, reason 또는 description) 실제 존재를 information_schema로 확인 후 SQL 작성.
- `companies.ai_credits_purchased`, `companies.postpaid_overage_limit` 존재 확인.

---

## 3. 슈퍼관리자 UI (Phase 4) — AdminDashboard.tsx

- 회사 상세에 **크레딧 섹션** 신설:
  - 현재 잔여(기본분 + 구매분 + 총) + 이번달 사용량 + 다음 리셋일 + 요금제/billing_type.
  - 지급/조정 모달(금액 + 사유 필수, grant/deduct 선택) → credit-adjust.
  - 후불 한도 입력(postpaid 회사만 노출) → overage-limit.
  - 최근 이력 표(type/금액/잔여후/사유/일시) + 더보기.
- 요금제 편집 폼에 "월 크레딧" 입력(plans.ai_credits_per_month).
- 전부 ConfirmModal/useToast — 네이티브 다이얼로그 0. 다크+violet 톤.

---

## 4. 고객사 UI (Phase 5)

### 4-1. CreditGauge 공용 컴포넌트
- 입력: my-credit 응답. 표시: 총 잔여(크게) + 기본분/구매분 분리 + 이번달 사용량 + 리셋일 D-N + 저잔여 경고(임계 < 작업 2~3건치).
- 다크+violet, AI 여정 동급 퀄리티. Source caption.

### 4-2. 대시보드 크레딧 카드 (상시 노출)
- Dashboard.tsx에 CreditGauge 컴팩트 카드 + "충전 문의" CTA(기존 문의 모달 재사용 — 셀프 결제 X).
- creditEnabled=false(요금제 크레딧 미설정)면 카드 숨김(레거시 안전).

### 4-3. 요금제 안내 페이지 재디자인 (PricingPage.tsx)
- 상단: 내 크레딧 게이지(CreditGauge) + 현재 요금제.
- 요금제 카드: "월 크레딧 + 관리 DB" 중심 + 만원당 크레딧 비교(비싼 요금제 이득 투명) + 작업당 크레딧 안내(풀분석 20/여정 10/DM 5/생성 3/문안·분석 2/다듬기·질문 1).
- "충전 문의" CTA = 기존 plan-request/inquiry 흐름 재사용.
- 다크+violet, AI 여정 동급. native dialog 제거(ConfirmModal/useToast).

---

## 5. 후불 / 순서 / 범위 경계

- 후불(postpaid): 슈퍼관리자가 회사별 `postpaid_overage_limit` 설정 + 이력에 overage 사용분 표시까지. **자동 월말 청구는 보류**(관리자가 사용분 보고 수동 청구). 월말 청구 자동화 = 별도 Phase.
- 빌드 순서: **Phase 4(슈퍼관리자) 먼저** → 크레딧을 지급/조정하며 Phase 5를 테스트 → Phase 5(고객 화면).
- 범위 제외(YAGNI): 셀프 결제·충전 단가표·결제 연동·자동 월말청구·자동 충전.

---

## 6. 검증 / 영구 룰

- TDD: getMonthlyUsage(KST 경계)·adjustCredit(grant/deduct/부족 차단/트랜잭션) 순수·트랜잭션 단위검증(.verify.ts). 기존 calc/tx 회귀 GREEN 유지.
- db_column_verify: §2-3 information_schema 먼저. tsc 통과 ≠ SQL 유효.
- no_inline_duplication: 크레딧 지급/조회 = ai-credit CT 단일. admin.ts/routes 인라인 금지.
- 디자인 품질: AI 여정(Journey Builder) 동급 + 다크+violet + native dialog 0 + 모바일 반응형 + Source caption.
- 자가 grep: 박-단어/모델명/native dialog 0건. 자연 한국어.
- 배포: 백엔드 + frontend(company) build:safe. 후속 — 화면 준비 후 plans 크레딧 값으로 차감 활성(현재 값 주입 상태면 그대로, NULL로 꺼둔 상태면 재주입).
