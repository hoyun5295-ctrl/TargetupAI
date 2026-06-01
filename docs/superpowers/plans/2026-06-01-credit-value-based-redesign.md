# 크레딧 가치 기반 재설계 구현 계획

> **For agentic workers:** 본 계획은 inline 순차 실행(executing-plans). 에이전트 병렬 금지(CLAUDE.md no_parallel_tasks).
> spec: [2026-06-01-credit-value-based-redesign-design.md](../specs/2026-06-01-credit-value-based-redesign-design.md)

**Goal:** 작업당 크레딧·1크레딧 단가·요금제 보너스·자동마케팅 과금을 가치 기반으로 교체한다.

**Architecture:** 단일 진실인 backend `CREDIT_COST_MAP`을 먼저 바꾸고 frontend 상수를 1:1로 맞춘다. UI(요금제 카드·충전 모달)와 plans SQL을 잇는다. 자동마케팅 과금은 orchestrate와 같은 묶음 차감 패턴. 모델 교체는 운영 속도 영향으로 분리.

**원칙:** 안전한 값·UI 먼저 → 돈 로직(자동마케팅) 정밀 → 모델 교체는 별도. 돈 영역 = 기존 차감 엔진(deductCreditSafe/2버킷/idempotent) 구조 그대로, 값만 교체.

---

## Phase 1 — backend 크레딧 매핑·단가 (`utils/ai-credit-calc.ts`)

- [ ] CREDIT_COST_MAP 전면 교체
  - 풀분석 300: `orchestrate`, `orchestrateWithAI`
  - 여정 150: `journey-ai-generate`, `journey-builder-custom`
  - 자동마케팅 50 (신규): `continuous-operator`
  - 모바일 DM 30: `dm-builder`
  - 인앱 15: `inapp-ai-generator`, `inapp-quick-action`
  - 문안·분석 5: `generate-messages`, `generate-custom-messages`, `variant-generator`, `recommend-target`, `recommend-next-campaign`, `performance-explainer`, `performance-quick-action`, `next-action-advisor`, `multi-goal-decisioning`, `cdp-fusion-explainer`, `voice-inbound`, `dm-event-recommender`
  - 다듬기·질문·매핑 1: `journey-ai-refine`, `journey-step-diagnosis`, `dm-quick-action-refine`, `dm-self-diagnosis`, `inapp-explainer`, `alimtalk-matcher`, `ai-memory-search`, `ai-usage-search`, `ai-segment-generator`, `ai-column-mapper`, `brand-voice-extract`, `parse-briefing`
- [ ] `CREDIT_UNIT_PRICE` 2000 → 500
- [ ] 검증: 기존 단위 verify 스크립트 재실행 + `npx tsc --noEmit` 0

## Phase 2 — frontend 상수 1:1 (`constants/credit.ts`)

- [ ] `CREDIT_TASK_COSTS` 7항목으로 교체: 풀분석300 / 여정150 / 자동마케팅50 / 모바일DM30 / 인앱15 / 문안5 / 다듬기1 (자동마케팅 lucide 아이콘 추가)
- [ ] `creditConversions` 제수 갱신: fullAnalysis ÷300, dm ÷30, copy ÷5
- [ ] `CREDIT_UNIT_PRICE` 500
- [ ] `CREDIT_SOURCE_LABELS`에 `'continuous-operator': '자동 마케팅'` 추가
- [ ] 보너스 표시 함수 추가: `planBonusPct(monthlyPrice, credits) = Math.round((credits/(monthlyPrice/CREDIT_UNIT_PRICE) - 1) * 100)`
- [ ] 검증: `npx tsc --noEmit` 0 + backend CREDIT_COST_MAP과 값 1:1 대조

## Phase 3 — 요금제 페이지 (`pages/PricingPage.tsx`)

- [ ] 카드 "월 AI 크레딧" 옆에 "+XX%" 보너스 배지 (planBonusPct, 0%면 미표시)
- [ ] 작업당 안내가 CREDIT_TASK_COSTS를 쓰면 자동 반영 — 하드코딩 잔존 시 갱신
- [ ] 검증: `npx tsc --noEmit` 0 + 시크릿창 화면

## Phase 4 — 충전 모달 (`components/credit/CreditRechargeModal.tsx`)

- [ ] 충전 단위 프리셋 → `[50, 100, 300, 500]` (현재 값 read 후 교체)
- [ ] 금액 미리보기가 CREDIT_UNIT_PRICE(500) 반영 확인
- [ ] 검증: `npx tsc --noEmit` 0 + 화면

## Phase 5 — 자동마케팅 사이클 과금 (`utils/continuous-operator.ts`)

- [ ] 흐름 read — 사이클 1건(operator 실행) 경계 + 내부 generateMessages 호출 지점 확정
- [ ] 사이클 진입점에서 `deductCreditSafe(companyId, 50, 'continuous-operator', idempotencyKey)` 1회
- [ ] 내부 generateMessages 호출은 creditCost 0 전달(이중 차감 방지 — orchestrate와 동일 묶음 원칙). generateMessages가 creditCost 파라미터를 받는지 확인 후 연결
- [ ] idempotency key = 사이클/제안 id 기반 (재시도 이중 차감 차단)
- [ ] 크레딧 부족 시 기존 InsufficientCreditError 흐름(담당자 무과금 알림) 유지
- [ ] 검증: `npx tsc --noEmit` 0 + 차감 흐름 검토

## Phase 6 — plans SQL (Harold 실행)

- [ ] db_column_verify 먼저: `SELECT column_name FROM information_schema.columns WHERE table_name='plans' AND column_name='ai_credits_per_month';` + `SELECT DISTINCT plan_code FROM plans;`
- [ ] UPDATE: STARTER 300 / BASIC 750 / PRO 2400 / BUSINESS 7800 / ENTERPRISE 16500
- [ ] TRIAL / FREE 정책 확인 후 결정 (TRIAL 체험분, FREE 0)

## 별도 진행 — 모델 전부 고급 교체 (운영 위험, 분리)

현재: `AI_MODELS.claude='claude-sonnet-4-6'`(기존 한줄로AI, 주석에 "절대 유지"), `opus='claude-opus-4-7'`(AI Operator). callAIWithFallback이 `model` 파라미터로 분기.

- "전부 고급" = 경량으로 돌던 작업의 model을 opus로. 호출부 전수 또는 source→model 중앙 매핑.
- 위험: opus가 경량보다 느림 → 다듬기·문안 같은 즉답 작업 사용자 대기↑ + 검증된 흐름 회귀.
- 권고: 가격 재설계 적용·안정 후 별도 plan으로 진행 (호출부 전수 grep + 속도 확인). 여정처럼 가치가 큰 작업부터 단계 교체도 가능.

---

## 배포·검증

- backend + frontend `npx tsc --noEmit` 0
- codex adversarial-review (돈·요금제 영역)
- Harold 통합 배포: tp-push + backend build:safe + pm2 restart all + frontend build:safe + plans SQL
