# 2026-06-03 세션 핸드오프 — 요금제 종량제(AI 크레딧) 전면 재설계 구현

> 직전 세션(D227+ 2026-05-31) = AI Operator 5개 작업 배포 완료 + 요금제 종량제 설계도 작성. 이번 세션 = 설계도대로 구현.

---

## 1. 최우선 작업 — 요금제 종량제 구현 (큰 작업, 종일+)

**설계도(정독 필수, 구현 완료 후 삭제)**: `docs/superpowers/specs/2026-05-31-credit-based-pricing-redesign.md`

**왜**: 자동발송·마케팅분석·모바일DM이 AI 오퍼레이션으로 통합되며 옛 기능 차등 축("자동발송 5회/무제한")이 죽음. 요금제 = AI 크레딧 양 + 관리 DB 규모로 전환. 낮은 요금제도 AI 맛보기(PLG) = 100만원 부담스러운 고객도 베이직에서 AI 오퍼레이션 사용 → 가치 체감 → 업그레이드/충전.

**Harold 확정 가격 (설계도 §2 = 그대로, 시작 시 미세조정만)**:
- 요금제 크레딧: 스타터 50 / 베이직 200 / 프로 800 / 비즈 2,500 / 엔터 5,500
- 작업당: 풀분석(orchestrate) 10 / DM·인앱·여정 생성 3 / 문안 다듬기·성과분석 2 / 메모리·세그먼트·매핑 1 / 자동발송 스팸재생성 0
- 추가 충전(기본보다 비싸게+볼륨할인): 소량 1,200 / 묶음 1,000 / 대량 900 원/크레딧
- 이월: 기본분 리셋(X) / 구매분 이월(O). 차감 = 기본 먼저 → 구매 나중
- 후불 업체 = 크레딧 충전 요청 → 슈퍼관리자 승인 → 이력 → 월말 후불 청구

**구현 순서 (설계도 §7 = 6 Phase)**:
1. Phase 1 — 크레딧 토대 (DB ALTER information_schema 검증 → `utils/ai-credit.ts` CT + ai_credit_transactions + 월 리셋 워커)
2. Phase 2 — callAIWithFallback 단일 진입점에 recordAiCall 흡수 + checkAndReserveCredit + deductCredit + CREDIT_COST_MAP + orchestrate 묶음 차감(sub-agent 0)
3. Phase 3 — plan-guard 재편 (6개 AI 잠금 → 크레딧 게이트, spam_filter STARTER+ 유지, isAiOperatorAllowed 단순화)
4. Phase 4 — 슈퍼관리자 (요금제 크레딧 설정 + 회사별 잔여 확인 + 충전/후불 승인 + 이력)
5. Phase 5 — 요금제 페이지 전면 리빌딩 (모던 디자인 A/B/C 재확인 + 크레딧 게이지 + 추가충전 모달 + native dialog 제거)
6. Phase 6 — 크레딧 차감 TDD (선차감 체크/후차감/2버킷 순서/idempotent/동시성/실패시 미차감/월상한) + 통합 검증

## 2. 차감 = 문자보다 단순 (Harold 통찰)

AI 응답은 즉시 성공/실패 판가름 → 문자처럼 통신사 지연 응답 없음 → **"실패 시 환불"이 아니라 "실패 시 처음부터 미차감"**. 환불(reverse) 워커 불필요. 단 idempotent(중복차감 차단) + 트랜잭션 원자성(음수 방지)만 유지 (설계도 §3-4).

## 3. 현재 코드 토대 (이미 있는 것 — 재사용)

- `callAIWithFallback` (services/ai.ts) = AI 호출 단일 진입점. companyId/source/model 받음 + 응답 토큰(usage) 뽑음. **단 recordAiCall은 ai.ts 2곳만 호출 = 대부분 집계 누락 → Phase 2에서 여기로 흡수하며 동시 해결.**
- `recordAiCall`/`getMonthlyUsage`/`checkAiRateLimit` (utils/ai-rate-limit.ts) = ai_call_log 기반. 크레딧으로 확장.
- `plan-guard.ts` = 기능 게이팅 단일 진입점 (11 FeatureKey). 6개 AI 잠금 재편 대상.
- balance/balance_transactions/prepaid = 잔액 인프라 (문자 발송비). 크레딧 추가 구매 결제 연동.
- AdminDashboard = plans 탭 + balance 조정 + deposits 탭 존재 → 크레딧 슈퍼관리자 UI 얹음.
- admin.ts plans UPDATE 엔드포인트 = ai_credits_per_month 추가 지점.
- PricingPage.tsx = 전면 리빌딩 대상 (현재 흰 톤 단순 카드 + alert 잔존).

## 4. AI 작업 source 지도 (CREDIT_COST_MAP 근거 — grep 전수 확인됨)

- 풀분석(10): orchestrate, orchestrateWithAI (sub-agent recommendTarget/generateMessages/compliance/performance-insight 내부 = 0)
- 생성(3): dm-ai, dm-event-recommender, dm-quick-action, inapp-ai-generator, inapp-quick-action, journey-ai-generate, journey-builder-custom
- 다듬기·분석(2): generate-messages, journey-ai-refine, variant-generator, performance-explainer, performance-quick-action, next-action-advisor, multi-goal-decisioning, cdp-fusion-explainer, inapp-explainer, dm-self-diagnosis, journey-step-diagnosis, voice-inbound, alimtalk-matcher
- 질문·매핑(1): ai-memory-search, ai-usage-search, ai-segment-generator, ai-column-mapper, brand-voice-extract
- 무료(0): continuous-operator autoSpamTest 재생성

## 5. 배포 완료된 것 (건드리지 말 것)

- 성과추정 3계층 + AI 분석가 + 스팸 안전망 + 안전정책 문구 + /ai-memory fix = 배포 완료 (D227+ 2026-05-31).

## 6. 영구 룰 (이번 작업 의무)

- db_column_verify_before_code: 모든 신규 컬럼/테이블 information_schema 검증 SQL 먼저 → 결과 확인 후 코드 (tsc 통과 ≠ SQL 유효).
- 돈 영역 = 트랜잭션 + idempotent + 음수 방지 (LESSONS_DB 환불 교훈).
- 3원칙(자가진단 + 클로드 원칙 + 슈퍼파워즈) + 자연 한국어 default + Grep 자가검증.

## 7. 다음 세션 진입 명령어 (Harold 복붙)

```
docs/superpowers/specs/2026-05-31-credit-based-pricing-redesign.md 정독 + docs/superpowers/handoffs/2026-06-03-credit-pricing-handoff.md 정독 + status/lessons/LESSONS_DB.md 정독 + memory/feedback_db_column_verify_before_code.md 정독 → 요금제 종량제(AI 크레딧) 전면 재설계 Phase 1부터 구현: Task 0 DB 컬럼 검증 SQL(plans.ai_credits_per_month / companies 크레딧 컬럼 / ai_credit_transactions 테이블 존재) 제시 → utils/ai-credit.ts CT(check/deduct/reset 2버킷) + callAIWithFallback 단일 진입점 집계·차감 통합 + CREDIT_COST_MAP + plan-guard 6개 AI잠금→크레딧게이트 + 슈퍼관리자 크레딧 설정·잔여·후불승인 + 요금제 페이지 전면 리빌딩 + TDD(차감 idempotent/동시성/실패시미차감/월상한) → 단계별 Harold 컨펌 → tp-push 배포
```
