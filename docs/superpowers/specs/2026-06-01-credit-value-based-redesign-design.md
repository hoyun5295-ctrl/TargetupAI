# 한줄로 AI 크레딧 가치 기반 전면 재설계 — 설계도

> 2026-06-01 작성 (brainstorming 합의 종결). Harold 확정. 이전 종량제 설계(2026-05-31)를 가치 기반으로 갱신.

## 0. 배경 / 문제

운영 중인 현재 값:
- 1크레딧 ≈ 2,000원 (충전 단가) / 요금제 포함 단가는 스타터 2,143원 ~ 엔터 786원으로 들쭉날쭉
- 작업당: 풀분석 20 / 여정 10 / DM 5 / 인앱 3 / 문안 2 / 다듬기 1
- 요금제 크레딧: 스타터 70 / 베이직 200 / 프로 1,000 / 비즈 3,500 / 엔터 7,000

진단:
1. 가장 가벼운 다듬기가 최소 단위 1크레딧인데 절대 단가가 1,000~2,143원 → 가벼운 작업이 비싸 보임.
2. 같은 작업이 요금제마다 2.7배 차이 → 낮은 요금제일수록 AI가 비싸지는 역설.
3. 풀분석·여정의 가치가 크레딧에 안 담김 → 저평가.
4. 무거운 작업이 싸서 베이직(35만)이 천장 → 상위 요금제 업셀 동력 부재.
5. 자동 마케팅(continuous-operator)이 CREDIT_COST_MAP에 없음 → 사이클 단위 무과금.

## 1. 핵심 결정 (Harold 확정)

- 가격은 **가치 기반** — 우리 원가가 아니라 솔루션이 대신 해 주는 일의 가치로 매긴다. 원가는 마진 하한 확인용으로만 쓴다.
- 차별화 근거(범용 LLM과 다른 점): 회사 고객 DB·세그먼트 연결 / 설계→발송→성과측정 일원화 / 한국 마케팅 규제 자동 준수 / 자동 운영. "마케터 고용"에 가깝다.
- 1크레딧 = **500원** (기본·충전 동일, 충전 보너스 없음).
- **전부 고급 모델** — 경량으로 돌던 작업을 모두 고급 모델로 교체. 마진 확인 결과 전 작업 흑자(가벼운 작업도 4배 이상, 무거운 작업 수백 배).
- 무거운 작업을 가치만큼 크게 차감해 업셀 사다리를 만든다.

## 2. 확정 가격 체계

### 2-1. 1크레딧 = 500원
- 원가 근거: 다듬기 1회 실제 원가 약 25~130원(고급 모델 기준). 500원 = 마진 4배 이상.
- 충전 단가도 500원 동일. 충전 단위: **50 / 100 / 300 / 500 크레딧** (25,000 / 50,000 / 150,000 / 250,000원, VAT 별도).

### 2-2. 요금제별 월 크레딧 + 보너스
| 요금제 | plan_code | 월정액 | 기본(÷500) | 보너스 | 지급 크레딧 |
|---|---|---|---|---|---|
| 스타터 | STARTER | 15만 | 300 | +0% | 300 |
| 베이직 | BASIC | 35만 | 700 | +7% | 750 |
| 프로 | PRO | 100만 | 2,000 | +20% | 2,400 |
| 비즈니스 | BUSINESS | 300만 | 6,000 | +30% | 7,800 |
| 엔터프라이즈 | ENTERPRISE | 550만 | 11,000 | +50% | 16,500 |

- 보너스% = `지급크레딧 / (월정액 ÷ 500) − 1`. 카드에 "+XX%" 배지로 노출(구독형 서비스 관행).
- TRIAL / FREE: 기존 정책 유지(별도 확인 후 결정 — TRIAL 체험 크레딧, FREE 0).

### 2-3. 작업당 크레딧 (전부 고급 모델)
| 작업 | 크레딧 | 명목가 | source |
|---|---|---|---|
| 풀분석 | 300 | 150,000원 | orchestrate, orchestrateWithAI |
| 여정 설계 | 150 | 75,000원 | journey-ai-generate, journey-builder-custom |
| 자동 마케팅(1사이클) | 50 | 25,000원 | (신규) continuous-operator |
| 모바일 DM | 30 | 15,000원 | dm-builder |
| 인앱 생성 | 15 | 7,500원 | inapp-ai-generator, inapp-quick-action |
| 문안·분석 | 5 | 2,500원 | generate-messages, generate-custom-messages, variant-generator, recommend-target, recommend-next-campaign, performance-explainer, performance-quick-action, next-action-advisor, multi-goal-decisioning, cdp-fusion-explainer, voice-inbound, dm-event-recommender |
| 다듬기·질문·매핑 | 1 | 500원 | journey-ai-refine, journey-step-diagnosis, dm-quick-action-refine, dm-self-diagnosis, inapp-explainer, alimtalk-matcher, ai-memory-search, ai-usage-search, ai-segment-generator, ai-column-mapper, brand-voice-extract, parse-briefing |

- 계단: 1 / 5 / 15 / 30 / 50 / 150 / 300.
- 분석·추천(recommend-target 등)을 5에 둔 근거: 이들은 풀분석(300)을 구성하는 조각이라 단독 호출 시 그만큼만 받는다. orchestrate 내부 호출은 0(묶음 차감 회피).

### 2-4. 업셀 검증
| 작업 | 스타터 300 | 베이직 750 | 프로 2,400 | 비즈 7,800 | 엔터 16,500 |
|---|---|---|---|---|---|
| 풀분석 300 | 1 | 2 | 8 | 26 | 55 |
| 여정 150 | 2 | 5 | 16 | 52 | 110 |
| 자동마케팅 50 | 6 | 15 | 48 | 156 | 330 |
| DM 30 | 10 | 25 | 80 | 260 | 550 |
| 문안 5 | 60 | 150 | 480 | 1,560 | 3,300 |

베이직은 풀분석 2·여정 5로 소규모, 활발하면 프로로 상승 → 35만 천장 해소.

## 3. 변경 대상

1. **backend `utils/ai-credit-calc.ts`**: CREDIT_COST_MAP 전면 교체 + `CREDIT_UNIT_PRICE` 2000→500 + 자동마케팅 source 추가.
2. **frontend `constants/credit.ts`**: CREDIT_TASK_COSTS(7항목) + creditConversions(÷300/÷30/÷5 등) + CREDIT_UNIT_PRICE 500 + CREDIT_SOURCE_LABELS(자동마케팅 추가) + 보너스 표시 상수/함수. 백엔드와 1:1 일치.
3. **frontend PricingPage.tsx**: 요금제 카드 크레딧 값 + "+XX%" 보너스 배지 + 작업당 안내 갱신.
4. **충전 모달(CreditRechargeModal)**: 충전 단위 50/100/300/500.
5. **backend `utils/continuous-operator.ts`**: 자동 마케팅 1사이클당 50크레딧 차감(orchestrate 패턴 — 내부 문안 생성 등은 creditCost 0). 차감 지점·idempotency key 정의.
6. **모델 교체**: 경량으로 호출되던 작업 전부 고급 모델(callAIWithFallback model 파라미터). 대상 source 전수 grep 후 일괄.
7. **SQL**: `plans.ai_credits_per_month` UPDATE (STARTER 300 / BASIC 750 / PRO 2400 / BUSINESS 7800 / ENTERPRISE 16500). TRIAL/FREE 확인 후 결정.

## 4. 안전 원칙 (준수)

- backend ↔ frontend CREDIT_COST_MAP 1:1 일치 (한쪽만 바꾸지 않음).
- db_column_verify: plans UPDATE 전 `information_schema`로 컬럼·plan_code 실제 값 확인.
- 돈 영역: 기존 차감 엔진(deductCreditSafe / 2버킷 / idempotent / 트랜잭션) 구조는 그대로, 값만 교체.
- 자동마케팅 과금 = 사이클 1회만 차감, 내부 sub-호출 0 (orchestrate와 동일한 묶음 원칙) → 이중 차감 방지.
- 모델명 UI 노출 0 / native dialog 0.
- 코드 변경 종료 직전 codex review (돈·요금제 = adversarial-review 대상).

## 5. 미해결 — 구현 계획 단계에서 확정

- 자동마케팅의 정확한 차감 지점(사이클 정의: 1건 발송 캠페인 = 1차감) — continuous-operator.ts 코드 확인 필요.
- 경량→고급 교체 대상 파일·라인 전수 — 호출부 grep 필요.
- 충전 모달 위치·현재 단위 코드 — 확인 필요.
- TRIAL/FREE 크레딧 정책.
