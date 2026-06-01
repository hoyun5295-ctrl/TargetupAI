# 종량제(AI 크레딧) Phase 2 잔여 + Phase 3 설계도

> D228+ 2026-06-01 작성. 직전 세션(D228) = Phase 1 + Phase 2 코어 + 가격 확정 완료.
> 이 문서 = **다음 세션이 그대로 구현**하도록 Phase 2 잔여 + Phase 3을 완전 기술.
> 확정 사실(가격·등급·차감 엔진)은 변경 금지. 구현만 이어가면 됨.
>
> **[진행 현황 2026-06-01 갱신]** Phase 2 전체 완료(①②③④ + 후불 overage 코어). ③ 스팸은 정책 변경으로 크레딧 비대상 환원(§1-3 취소). 다음 세션 = Phase 3 plan-guard + Phase 2~3 통합 배포. 핸드오프 = handoffs/2026-06-02-credit-pricing-phase3-deploy-handoff.md.

---

## 0. 확정 사실 (변경 금지)

### 작업당 크레딧 (CREDIT_COST_MAP — 이미 코드 반영 완료)
| 크레딧 | 작업 | source |
|---|---|---|
| 20 | 풀분석 | orchestrate, orchestrateWithAI |
| 10 | 여정(다단계 설계) | journey-ai-generate, journey-builder-custom |
| 5 | 모바일 DM 묶음 | dm-builder |
| 3 | inapp·CDP 생성 | inapp-ai-generator, inapp-quick-action |
| 2 | 문안 생성·분석·추천 | generate-messages, generate-custom-messages, recommend-target, recommend-next-campaign, variant-generator, performance-explainer, performance-quick-action, next-action-advisor, multi-goal-decisioning, cdp-fusion-explainer, voice-inbound, dm-event-recommender |
| 1 | 다듬기·진단·질문·매핑 | journey-ai-refine, journey-step-diagnosis, dm-quick-action-refine, dm-self-diagnosis, inapp-explainer, alimtalk-matcher, ai-memory-search, ai-usage-search, ai-segment-generator, ai-column-mapper, brand-voice-extract, parse-briefing |

- 크레딧 1개 ≈ 80원 (가격 기준점 — 스팸필터 1회 원가 75~80원 참조). 단 스팸필터 자체는 크레딧 비대상(§1-3 취소).
- 미등록 source = 0 차감 (getCreditCost).

### 요금제 크레딧 (plans.ai_credits_per_month — 운영 DB UPDATE 필요)
| 요금제 | 월 | 관리 DB | 크레딧 | 성격 |
|---|---|---|---|---|
| FREE | - | - | 0 | 미가입 |
| STARTER | 15만 | 10만 | 70 | 스팸필터 주 + AI 맛보기 |
| BASIC | 35만 | 30만 | 200 | AI 활용 시작 |
| PRO | 100만 | 100만 | 1,000 | 자동마케팅 본격(주력) |
| BUSINESS | 300만 | 300만 | 3,500 | 자동 다수 |
| ENTERPRISE | 550만 | 무제한 | 7,000 | 대량 |
| TRIAL | 무료체험 | - | 1,000 | PRO 동일 |

운영 UPDATE SQL (배포 직전 실행):
```sql
UPDATE plans SET ai_credits_per_month = CASE plan_code
  WHEN 'STARTER' THEN 70 WHEN 'BASIC' THEN 200 WHEN 'PRO' THEN 1000
  WHEN 'TRIAL' THEN 1000 WHEN 'BUSINESS' THEN 3500 WHEN 'ENTERPRISE' THEN 7000
  WHEN 'FREE' THEN 0 ELSE ai_credits_per_month END;
```

### 가격 철학 (Harold 확정)
- 저가 요금제 크레딧 단가는 비싸도 됨(스타터=맛보기, AI 쓰려면 업글). "기본<충전" 원칙 폐기.
- 차별 축 = 크레딧 절대량 + 자동마케팅 + 기능 제공. DB는 보조(30만이면 대부분 커버).
- 비싼 요금제 = 만원당 크레딧↑ + 자동마케팅 상시 가능.
- **싱크에이전트·자사몰 연동·DB 관리·발송·스팸필터 테스트 = 크레딧 비대상. AI 호출만 크레딧.** (스팸필터는 기존 현금/후불 청구 유지)
- AI 크레딧 원가율 = 매출의 1.6~10%(전소진) → AI 마진 90%+.

### 차감 엔진 (Phase 1 완료 — utils/ai-credit*.ts)
- `ai-credit-calc.ts` — 순수 계산(splitDeduction 2버킷, needsMonthlyReset KST, getCreditCost, CREDIT_COST_MAP).
- `ai-credit-tx.ts` — 트랜잭션(loadCreditRow FOR UPDATE, _deductWithClient: BEGIN→LOCK→idempotent재확인→reset→차감→COMMIT, plan_credits NULL이면 skip 게이트).
- `ai-credit.ts` — CT 진입점(getCreditState/checkCredit/deductCredit/resetMonthlyCreditsIfNeeded, pool).
- `ai-credit-context.ts` — 묶음(runInCreditBundle/isInCreditBundle, AsyncLocalStorage).
- 단위검증: `__tests__/ai-credit-calc.verify.ts`(26), `ai-credit-tx.verify.ts`(8), `ai-credit-context.verify.ts`(6).

### Phase 2 코어 완료분 (callAIWithFallback 통합)
- `services/ai.ts callAIWithFallback` — creditCost = isInCreditBundle() ? 0 : (params.creditCost ?? getCreditCost(source)). cache miss 후 checkCredit, 성공 후 recordAiCall(id) → deductCredit.
- recordAiCall(`ai-rate-limit.ts`) = RETURNING id 반환.
- orchestrate/orchestrateWithAI(`ai-orchestrator.ts`) = checkCredit(20) + runInCreditBundle + deductCredit(20), fallback은 _orchestrateImpl 직접(이중차감 방지). ORCHESTRATE_CREDIT=20.
- C 배선(가) 6곳 완료: generateMessages, recommendTarget, parseBriefing, generateCustomMessages, recommendNextCampaign(ai.ts) + inapp-ai-generator. (companyId 보유 → source/companyId 연결)

---

## 1. Phase 2 잔여 (다음 세션 우선 — 이걸 끝내야 Phase 2 완결)

### 1-1. dm-ai route 배선 + dm-builder 묶음
- **문제**: `utils/dm/dm-ai.ts` 5함수(parsePrompt 142, generateCopy 324, transformTone 359, improveMessage 414, oneShotGenerate 508)가 callAIWithFallback에 companyId·source **둘 다 미전달** → 집계·차감 0(ai_call_log 미기록).
- **원인**: dm-ai 함수들이 companyId를 파라미터로 안 받음(시그니처에 없음).
- **구현**:
  1. dm-ai route(빌더 진입점 — `routes/` 중 dm-ai 함수 호출처 grep으로 확정) 파악.
  2. DM 1작업은 여러 함수 호출이니 **route 진입점에서 묶음**: `checkCredit(companyId, 5)` → `runInCreditBundle(async () => { ...dm 작업... })` → `deductCredit({companyId, cost:5, source:'dm-builder'})`.
  3. dm-ai 함수에 companyId 파라미터 추가 + 내부 callAIWithFallback에 companyId 전달(집계용 — 묶음이라 차감은 0). source는 함수별(dm-parse 등) 또는 묶음이라 생략 가능.
  - 주의: route 진입점이 단일(oneShotGenerate 1회)이면 그 함수에 companyId+source:'dm-builder' + creditCost 처리. 여러 함수 순차 호출이면 route handler에서 묶음.

### 1-2. source 있는 호출부 companyId 전수 점검
- 대부분 companyId 전달됨(ai_call_log 집계 패턴) but 확정 필요. 각 파일 callAIWithFallback 호출에 companyId 있는지 grep -A 8로 점검 → 누락만 추가:
  - variant-generator, performance-explainer, performance-quick-action, next-action-advisor, multi-goal-decisioning, cdp-fusion-explainer, voice-inbound, dm-event-recommender, dm-quick-action, dm-self-diagnosis, journey-step-diagnosis, inapp-explainer, inapp-quick-action, journey-ai-generator(generate+refine), journey-builder, alimtalk-ai-matcher, ai-segment-generator, ai-column-mapper, ai-memory(search/brand-voice), ai-usage.
  - SQL 30일 집계에 나온 것(journey-ai-generate, next-action-advisor, ai-segment-generator, performance-explainer, brand-voice-extract, ai-column-mapper, ai-memory-search, cdp-fusion-explainer, journey-ai-refine)은 companyId 확정 O.

### 1-3. 스팸필터 — 크레딧 비대상 (취소 — Harold 확정 2026-06-01)
- 당초 "현금 → 크레딧 1" 전환을 구현했으나 **철회**. 크레딧은 AI 기능에만 적용하고, 스팸필터 테스트는 기존 현금(선불 잔액)/후불 청구를 그대로 유지한다.
- 근거: 크레딧은 AI 호출 한정. 스팸필터는 별도 외부 SMS 실비용이라 기존 과금 체계(`prepaidDeduct` + `billing_type` 후불 패스)로 둔다.
- 코드: spam-filter.ts / spam-test-queue.ts 원복(prepaidDeduct 복원), CREDIT_COST_MAP에서 `spam-filter-test` 제거.

### 1-4. 크레딧 운영 안전망 (자동마케팅)
- `utils/continuous-operator.ts`(orchestrate 호출 361) — 자동마케팅 사이클.
- **구현**:
  1. 사이클 시작 전 `checkCredit(companyId, 20)` → 부족하면 사이클 멈추고 `continuous_operators` 상태 `paused_no_credit`(컬럼 확인/추가) + 충전 시 다음 주기 자동 재개.
  2. **2단계 알림**: 잔여가 다음 1~2 사이클치 미만 → "임박 경고" / 실제 부족 멈춤 → "멈춤 안내". 담당자(companies.manager_phone/contact_phone) **알림톡 우선 → 실패 시 문자 자동 전환**(+이메일). 기존 알림톡/문자 발송 함수 재사용.
  3. 스팸 재생성 = 0(무료) + **재생성 횟수 상한 3회**. 3회 안에 통과 못 하면 "수동 확인" 알림.

---

## 2. Phase 3 — plan-guard 재편 (기능 잠금 → 크레딧 게이트)

- **현재**: `utils/plan-guard.ts` 11 FeatureKey 게이팅. 6개 AI 잠금(ai_messaging, ai_premium, mobile_dm, auto_campaign, auto_spam_test, ai_cdp)이 요금제별 차단.
- **전환**: 스타터부터 **전 기능 개방** + 크레딧으로만 통제.
  - 6개 AI 잠금 → "크레딧 게이트"(잔액 있으면 가능, 없으면 충전 안내). 실제 차단은 callAIWithFallback의 checkCredit이 이미 담당 → plan-guard는 잠금 해제만.
  - `isAiOperatorAllowed` → 전 유료 플랜 개방(ENTERPRISE 전용 게이팅 폐지). 단 현재 ENTERPRISE+AI_OPERATOR_ALLOWED_USERS 운영 중이니, 종량제 전환 시점에 함께 개방.
  - `canUseFeature`의 6개 잠금 메시지 → 제거(또는 "크레딧 충전" 안내).
  - `spam_filter` STARTER+ 잠금 → 스팸필터가 1크레딧이므로 잠금 불필요(크레딧만). 스타터부터 개방.
  - `basic_send`, `customer_db`, `target_send`, `ai_mapping` = 유지. `max_customers`, `max_auto_campaigns` = 규모 제약 유지.
- **주의**: 운영 중 6,000사 영향 — plan-guard 변경은 grep 전수(소비처) 후 신중. plans 값 UPDATE + ENV 개방과 배포 동기화.

---

## 3. Phase 4~6 개요 (Phase 3 이후)

- **Phase 4 슈퍼관리자(AdminDashboard)**: 요금제 크레딧 설정(admin.ts plans UPDATE에 ai_credits_per_month), 회사별 잔여(base_remaining+purchased+이번달 사용량) 확인, 크레딧 충전/조정(balance 패턴), 후불 충전 요청 승인(ai_credit_transactions postpaid_grant) + 월말 청구, 크레딧 사용 이력 조회.
- **Phase 5 요금제 페이지(PricingPage.tsx)**: 모던 재디자인 + AI 크레딧 게이지(이번달 사용량/기본분/구매분 + 충전 CTA) + "월 크레딧 + 관리 DB" 중심 카드 + 작업당 크레딧 안내 + "만원당 크레딧" 비교(비싼 요금제 이익 투명) + 추가 충전 모달 + native dialog 제거(ConfirmModal/useToast).
- **Phase 6 검증**: 차감 TDD(선차감/후차감/2버킷/idempotent/동시성/실패시미차감/월상한) + 통합 검증.
- **충전 단가**: spec 소량 1,200/묶음 1,000/대량 900원. 저원가 작업(스팸) 대비 과한 문제 → Phase 4/5에서 "기본 크레딧으로 쓰고 충전은 긴급" 포지셔닝 or 단가 재검토(미확정, Phase 4 진입 시 Harold 확정).

---

## 4. 다음 세션 작업 순서

1. Phase 2 잔여 1-2(source 호출부 companyId 전수 점검 — grep -A 8로 누락 식별 후 배선) — 빠름.
2. Phase 2 잔여 1-1(dm route 파악 → dm-builder 묶음 배선).
3. Phase 2 잔여 1-3(스팸필터 1크레딧 통합 — 현금 과금 위치 grep 후 전환).
4. Phase 2 잔여 1-4(크레딧 운영 안전망 — continuous-operator + 알림톡→문자).
5. 각 단계 tsc + 단위검증 + 자가 grep(박-단어/모델명/native dialog).
6. Phase 2 전체 완결 후 → Phase 3(plan-guard 재편).
7. 운영 plans UPDATE(§0 SQL) + tp-push 배포는 Phase 2~3 통합 검증 후 Harold 진행.

## 5. 영구 룰 준수
- db_column_verify: continuous_operators.paused 상태 등 신규 컬럼 시 information_schema 검증 먼저.
- 돈 영역: 트랜잭션+idempotent+음수 방지(이미 ai-credit-tx 적용).
- no_inline_duplication: 차감은 ai-credit CT + callAIWithFallback 단일.
- 3원칙(자가진단+클로드 원칙+슈퍼파워즈) + 자연 한국어 + Grep 자가검증.

---

## 6. 후불 추가 사용 한도 (D228+ 추가 — Harold 확정 2026-06-01)

선불/후불(`companies.billing_type` 'prepaid'|'postpaid')에 따라 크레딧 0 처리를 다르게 한다.

- **선불**: 크레딧 0이면 차단(구매신청 → 입금 확인 → 승인 → 충전 후 사용). 종전과 동일.
- **후불**: `companies.postpaid_overage_limit`(INT default 0)까지 0 아래로 음수 허용 → 월말 후불 청구. 한도 0이면 0에서 멈춤(토글 OFF 효과).
- 코어: `loadCreditRow`에 `billing_type` + `postpaid_overage_limit` 추가, `checkCredit`/`_deductWithClient` 후불 분기 — (보유 + 한도) ≥ 비용이면 통과, `baseAfter = base - fromBase - shortfall`로 base가 음수 누적, transaction bucket 'overage'.
- 음수 사용분은 `ai_credit_transactions`('deduct', bucket 'overage') 이력에 남아 Phase 4 월말 청구가 합산(월 reset이 base를 planCredits로 되돌려도 손실 없음).
- 한도 설정 주체 = 슈퍼관리자 회사별(Phase 4). 기본 0(보수적).
- DB ALTER 완료(`postpaid_overage_limit INTEGER NOT NULL DEFAULT 0`). 단위검증 = `ai-credit-tx.verify.ts` 후불 6 케이스 GREEN.
