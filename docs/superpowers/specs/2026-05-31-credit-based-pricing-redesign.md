# 한줄로 요금제 종량제(AI 크레딧) 전면 재설계 — 설계도

> D227+ 2026-05-31 작성. **이번 세션 = 설계만. 구현은 다음 세션부터.**
> Harold 확정: 요금제 = 기능 등급이 아니라 "AI 크레딧 양 + 관리 DB 규모"로 차등. 낮은 요금제도 AI 오퍼레이션 맛보기(PLG). 기능 막기 ❌ → 크레딧으로 당기기 ⭕.

---

## 0. 배경 / 문제

- 자동발송·AI 마케팅분석·모바일 DM이 전부 **AI 오퍼레이션으로 통합**됨 → "자동발송 5회/무제한" 같은 옛 기능 차등 축이 죽음.
- AI Operator가 Opus를 쓰므로 호출마다 실제 원가 발생 → 무제한이면 헤비 유저 한 곳이 마진을 다 먹음.
- **현재 치명적 결함**: `recordAiCall`(= ai_call_log 기록 + quota)이 `ai.ts` 2곳에서만 호출됨. `callAIWithFallback`은 25개 파일 40곳+에서 호출 → **AI 작업 대부분이 quota에 집계조차 안 됨**. orchestrate(풀 분석)·journey·DM·inapp·performance 전부 누락. 종량제의 선결 과제.

## 1. 목표

전환율·기능 잠금이 아니라 **AI 크레딧 종량제**로 전환:
1. 요금제별 월 크레딧 차등 지급 (기본 제공분, 매월 리셋)
2. 소진 시 prepaid 잔액에서 자동 차감(월 상한 설정 가능) — 마케팅 흐름 안 끊김
3. 추가 구매 크레딧은 이월(돈 낸 것이므로). 차감 순서 = 기본분 먼저 → 구매분 나중
4. 후불 업체 = 크레딧 충전 요청 → 슈퍼관리자 승인 → 이력 → 월말 후불 청구
5. 기능 잠금 대부분 해제 → 낮은 요금제도 AI 오퍼레이션 맛보기

## 2. 가격 체계 (확정 — 다음 세션 시작 시 미세조정만 가능)

### 2-1. 요금제

| 요금제 | 월 요금 | 관리 DB | 월 AI 크레딧 | AI 오퍼레이션 |
|---|---|---|---|---|
| 스타터 | 15만 | 10만 | **50** (맛보기) | ✓ |
| 베이직 | 35만 | 30만 | **200** | ✓ |
| 프로 | 100만 | 100만 | **800** | ✓ |
| 비즈니스 | 300만 | 300만 | **2,500** | ✓ |
| 엔터프라이즈 | 550만 | 무제한 | **5,500** | ✓ |

- 모든 유료 요금제가 AI 오퍼레이션 사용 가능. 차이 = 크레딧 양 + 관리 DB.
- FREE(미가입) = 크레딧 0, 기본 발송만 (기존 유지).

### 2-2. 작업당 크레딧 (고정 단가)

| 작업 | 크레딧 | source 예 |
|---|---|---|
| AI 오퍼레이션 풀 분석 (orchestrate 1회 = sub-agent 묶음) | **10** | orchestrate/orchestrateWithAI |
| 모바일 DM·인앱·여정 생성 | **3** | dm-ai, inapp-ai-generator, journey-ai-generate |
| 문안 다듬기·생성, 성과/추천 분석 | **2** | generate-messages, refine, performance-explainer, next-action-advisor, variant-generator, multi-goal |
| AI 메모리·사용량 질문, 세그먼트, 매핑, 매칭 | **1** | ai-memory-search, ai-usage-search, ai-segment-generator, ai-column-mapper, alimtalk-matcher |
| 자동발송 스팸 재생성 (부가, 자동) | **0 (무료)** | continuous-operator autoSpamTest |

- 내부는 실제 토큰을 ai_call_log에 계속 기록(원가 검증). 차감은 위 고정 크레딧.
- orchestrate는 sub-agent를 여러 번 부르지만 **사용자에겐 1회 = 10크레딧** (내부 호출은 차감 0, 묶음 단위로 1번만 차감).

### 2-3. 추가 충전 (기본보다 비싸게 + 볼륨 할인)

| 구매 단위 | 크레딧당 단가 |
|---|---|
| 소량 (~100) | 1,200원 |
| 묶음 (500+) | 1,000원 |
| 대량 (2,000+) | 900원 |

- 추가 소량(1,200원) > 기본 환산(1,000원) = "기본보다 비싸야" 원칙 충족.
- 원가(크레딧당 ~100원) 대비 9~12배 마진.

### 2-4. 경쟁사 대비 합리성 (근거)

- Klaviyo 10만 컨택 ≈ 월 189만원(AI 별도, 한국 SMS 약함) vs 우리 프로 100만(AI 포함) = 절반.
- Braze 연 5천만~70억 vs 우리 엔터 550만 = 비교 불가하게 저렴.
- 국내(SOLAPI/타스온) = 발송만, AI 오퍼레이터 없음.
- 포지션: "국내 발송 + AI 마케터를 한 곳에서, Klaviyo급 가격에 합리적이지만 강력".

## 3. 크레딧 차감 엔진 (돈 영역 — 최우선 안전 설계)

### 3-1. 데이터 모델 (DB ALTER)

`information_schema` 검증 후 작성 의무 (db_column_verify). 예상:
- `plans.ai_credits_per_month` integer — 요금제별 월 기본 크레딧 (NULL=0 취급)
- `companies.ai_credits_base_remaining` integer DEFAULT 0 — 이번 달 남은 기본분 (매월 리셋)
- `companies.ai_credits_purchased` integer DEFAULT 0 — 구매분 잔액 (이월)
- `companies.ai_credits_reset_at` timestamptz — 마지막 월 리셋 시각
- `companies.ai_credits_monthly_cap` integer NULL — 자동차감 월 상한 (NULL=무제한, 0=자동차감 끔)
- `ai_credit_transactions` (신규 테이블) — 차감/충전/리셋 이력 (idempotent key 포함)
  - id, company_id, type('deduct'|'grant'|'purchase'|'reset'|'postpaid_grant'), amount, bucket('base'|'purchased'), source, ai_call_log_id(FK nullable), idempotency_key UNIQUE, created_at
- ※ prepaid balance와 통합 여부: 크레딧은 별도 컬럼으로 관리하되, 추가 구매 결제는 기존 prepaid/balance_transactions 차감과 연동(돈 흐름은 한 곳). 표시상 "AI 크레딧"과 "발송 잔액"은 분리 노출.

### 3-2. 차감 로직 (CT 신규: utils/ai-credit.ts)

```
checkAndReserveCredit(companyId, cost): 호출 전
  - 월 리셋 필요 시 먼저 리셋 (ai_credits_reset_at < 이번달 → base = plan.ai_credits_per_month)
  - 사용가능 = base_remaining + purchased + (자동차감 가능분: prepaid에서 살 수 있는 크레딧, 월상한 내)
  - 부족하면 throw InsufficientCreditError (호출 측 catch → "크레딧 충전" 안내, 발송/AI 차단)
  - 충분하면 통과 (실제 차감은 호출 성공 후)

deductCredit(companyId, cost, source, aiCallLogId): 호출 성공 후 (트랜잭션)
  - BEGIN
  - base_remaining에서 먼저 차감 (기본분 우선 소진)
  - 모자라면 purchased에서 차감
  - 그래도 모자라면 prepaid 자동 구매 후 차감 (월상한 체크 + balance_transactions 기록)
  - ai_credit_transactions INSERT (idempotency_key = aiCallLogId 기반 → 중복 차감 방지)
  - COMMIT (음수 방지 = 행 잠금 SELECT ... FOR UPDATE)
```

### 3-3. 통합 지점 — callAIWithFallback 단일 진입점

- `callAIWithFallback` 안에서: ① 호출 전 `checkAndReserveCredit` ② recordAiCall(토큰 기록) ③ 성공 후 `deductCredit`.
- 작업당 크레딧은 `source` → 크레딧 매핑 테이블(CREDIT_COST_MAP)로 결정.
- orchestrate sub-agent 내부 호출은 `creditCost: 0`(묶음 차감 회피) + orchestrate 진입점에서 1회 10크레딧 차감.
  - 구현: callAIWithFallback에 `creditCost?` 파라미터. 미지정 시 source 맵 기준. orchestrate sub-agent는 0 전달.
- **현재 결함 동시 해결**: recordAiCall도 여기로 흡수 → 40곳 전수 집계 자동.

### 3-4. 안전 원칙 (LESSONS_DB 환불 교훈 정합)

- 호출 실패 시 차감 안 함 (성공 후 차감 = 환불 불필요).
- 트랜잭션 원자성 (동시 호출 음수 방지 = SELECT FOR UPDATE).
- idempotent (ai_call_log_id 기반 unique key → 재시도 중복 차감 차단).
- 자동차감 월상한 도달 시 = AI 차단 + "충전" 안내 (발송 차단과 동일 결).
- DB ALTER 새 컬럼 endpoint catch = `column does not exist` 503 분기 (db_alter_safety_net).

## 4. plan-guard 재편

- `ai_messaging`, `ai_premium`, `mobile_dm`, `auto_campaign`, `auto_spam_test`, `ai_cdp` 6개 FeatureKey 잠금 → **"크레딧 보유 + AI 오퍼레이션 가능"** 단일 게이트로 전환.
- `spam_filter` = STARTER+ 유지 (Harold 명시).
- `basic_send`, `customer_db`, `target_send`, `ai_mapping` = 기존 유지.
- `max_customers`, `max_auto_campaigns` = 규모 제약 유지.
- `isAiOperatorAllowed` = "유료 플랜(크레딧>0 가능) OR 크레딧 잔액 보유"로 단순화. ENTERPRISE 전용 게이팅 폐지(전 플랜 개방).
- canUseFeature의 6개 잠금 메시지 → "크레딧이 부족합니다 / 충전" 메시지로 전환.

## 5. 슈퍼관리자 (AdminDashboard)

기존 인프라 재사용 (plans 탭 + balance 조정 + balance_transactions + deposits):
- **요금제별 크레딧 설정**: admin.ts plans UPDATE에 `ai_credits_per_month` 추가 + plans 탭 UI 입력.
- **회사별 잔여 크레딧 확인**: companies 목록/상세에 base_remaining + purchased + 이번달 사용량 표시.
- **크레딧 충전/조정**: 기존 balance 조정 UI 패턴 그대로 크레딧 charge/deduct.
- **후불 승인 흐름**: 크레딧 충전 요청 목록 → 승인 → ai_credit_transactions(postpaid_grant) + 월말 후불 청구 집계.
- **크레딧 사용 이력**: ai_credit_transactions 조회 (회사별).

## 6. 요금제 페이지 전면 리빌딩 (PricingPage.tsx)

- 현재 흰 톤 단순 카드 → 모던 재디자인 (디자인 방향 = 다음 세션 목업 재확인, A 다크 모던 / B 라이트 클린 / C 비교표 중 택1).
- **AI 크레딧 게이지** 신규: 이번 달 사용량 + 기본분/구매분 구분 + "충전" CTA.
- 카드 = 기능 나열 대신 "월 AI 크레딧 + 관리 DB" 중심. 작업당 크레딧 안내("AI 풀 분석 1회 = 10크레딧").
- 추가 충전 모달 + 후불 안내.
- native dialog(alert/confirm) 제거 → ConfirmModal + useToast (현재 PricingPage에 alert 잔존 — 정정).

## 7. 구현 순서 (다음 세션 — Phase별)

1. **Phase 1 — 크레딧 토대**: DB ALTER (information_schema 검증) + `utils/ai-credit.ts` CT (check/deduct/reset) + ai_credit_transactions + 월 리셋 워커.
2. **Phase 2 — 단일 진입점 집계/차감**: callAIWithFallback에 recordAiCall 흡수 + checkAndReserveCredit + deductCredit + CREDIT_COST_MAP + orchestrate 묶음 차감(sub-agent 0).
3. **Phase 3 — plan-guard 재편**: 6개 AI 잠금 → 크레딧 게이트. isAiOperatorAllowed 단순화. 메시지 전환.
4. **Phase 4 — 슈퍼관리자**: 요금제 크레딧 설정 + 회사별 잔여 확인 + 충전/후불 승인 + 이력.
5. **Phase 5 — 요금제 페이지 리빌딩**: 모던 디자인 + 크레딧 게이지 + 추가충전 모달 + 후불.
6. **Phase 6 — 검증**: 크레딧 차감 TDD (선차감 체크/후차감/2버킷 순서/idempotent/동시성/실패시 미차감/월상한) + 통합 검증.

## 8. 영구 원칙 준수

- db_column_verify_before_code: 모든 신규 컬럼/테이블 information_schema 검증 후 코드.
- 돈 영역 = 트랜잭션 + idempotent + 음수 방지 (LESSONS_DB 환불 교훈).
- no_inline_duplication: 차감은 ai-credit.ts CT 단일 진입점, callAIWithFallback 1곳 통합.
- 회사 격리: 전 쿼리 company_id.
- 모델명 UI 노출 0 + native dialog 0 + 마케팅 담당자 UX (크레딧 = 직관 표시).

## 9. 핵심 결정 기록 (이번 세션 Harold 확정)

- 과금 단위 = 토큰 내부 집계 + "AI 크레딧" 추상 표시.
- 요금제 = 기능 등급 ❌ → 크레딧 + DB 규모. 낮은 요금제도 AI 맛보기(PLG).
- 작업당 고정 크레딧 (풀분석 10 / 생성 3 / 다듬기·분석 2 / 질문·매핑 1 / 스팸재생성 0).
- 크레딧 양: 스타터 50 / 베이직 200 / 프로 800 / 비즈 2,500 / 엔터 5,500.
- 추가 충전 = 기본보다 비싸게(소량 1,200) + 볼륨 할인. 후불 = 슈퍼관리자 승인 + 월말 청구.
- 이월 = 기본분 리셋(X) / 구매분 이월(O). 차감 = 기본 먼저 → 구매 나중.
- spam_filter STARTER+ 유지. 차감 = 호출 성공 후 (실패 시 미차감).
- 마진 = 원가 9~12배, 경쟁사(Klaviyo 절반/Braze 비교불가) 대비 합리적.
