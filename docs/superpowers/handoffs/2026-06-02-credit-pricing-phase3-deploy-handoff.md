# 2026-06-02 세션 핸드오프 — 요금제 종량제 Phase 3 + 통합 배포

> 직전 세션(D228+ 2026-06-01) = 종량제 Phase 1 + Phase 2 전체 완료 + 후불 overage 코어 + 스팸 정책 변경.
> 이번 세션 = Phase 3(plan-guard) + Phase 2~3 통합 검증 + 한 번에 배포.

---

## 1. 직전 세션 완료 (건드리지 말 것 — 검증만)

### Phase 1 + Phase 2 (코드 완료, backend tsc 0 / 단위검증 calc 26·tx 14 GREEN)
- Phase 1 크레딧 엔진: `utils/ai-credit-calc/tx/credit/context.ts`.
- Phase 2:
  - ① 호출부 companyId 전수 — inapp-quick-action / inapp-explainer / ai-orchestrator compliance 3곳 배선.
  - ② dm-builder 묶음 — dm-ai 5함수 companyId + dm.ts route 5곳 + oneShot 진입점 5크레딧 묶음(runInCreditBundle).
  - ③ 스팸 정책 변경(아래 ★).
  - ④ 운영 안전망 — continuous-operator 크레딧 게이트 + `paused_no_credit` + 무과금 담당자 알림.
- 후불 overage 코어: `companies.postpaid_overage_limit`(ALTER 완료, default 0). `checkCredit`/`_deductWithClient` 후불 분기 — 후불은 한도까지 음수 허용(월말 청구), 선불은 0 차단.

### 확정 모델 (Harold 2026-06-01)
- 선불 + 후불 **둘 다 유지** (선불 폐지 안 함).
- 크레딧 = **AI 기능에만**. 스팸필터 테스트는 크레딧 무관.
- 후불 = 한도(overage_limit)까지 음수 → 월말 후불 청구. 한도 설정 = 슈퍼관리자 회사별(Phase 4), 기본 0.

### ★ 스팸필터 테스트 정책 변경 (중요 — 기록)
- 당초 "스팸 1크레딧" 전환을 구현했다가 **철회**. 스팸은 크레딧 비대상 — 기존 현금(선불 잔액 `prepaidDeduct`)/후불 청구 그대로.
- 코드: `spam-filter.ts` / `spam-test-queue.ts` 원복. `CREDIT_COST_MAP`에서 `spam-filter-test` 제거. 설계도 §1-3 취소 명시.
- 근거: 크레딧은 AI 호출 한정. PRO+도 크레딧을 넉넉히 받으니 스팸만 별도/공짜는 일관성에 어긋남(Harold).

### 담당자 알림 (④-B)
- `continuous-operator.ts notifyOperatorAdmins` = **무과금**(인증 라인 `getAuthSmsTable` + `bulkInsertSmsQueue`, 회사 발송비 차감 X = 우리 서비스 부담).
- 현재 = 문자(LMS). 알림톡 템플릿 등록(Harold 내일 지시) 후 = **1순위 알림톡 → 2순위 문자** 교체(코드에 TODO seam 표시).

---

## 2. 이번 세션 작업 — Phase 3 + 배포

### Phase 3 — plan-guard 재편 (설계도 §2)
- `utils/plan-guard.ts` 6개 AI 잠금(ai_messaging, ai_premium, mobile_dm, auto_campaign, auto_spam_test, ai_cdp) → 크레딧 게이트로 전환. 실제 차단은 `callAIWithFallback`의 `checkCredit`이 담당(이미 작동) → plan-guard는 잠금 해제만.
- `isAiOperatorAllowed` → 전 유료 플랜 개방(ENTERPRISE 전용 게이팅 폐지). 현재 ENTERPRISE + `AI_OPERATOR_ALLOWED_USERS` 운영 → 종량제 전환 시점에 개방.
- `spam_filter` 잠금 = 크레딧 무관(스팸은 현금/후불)이라 **기존 유지**. (설계도 원안의 "스팸 잠금 해제"는 정책 변경으로 무효.)
- `basic_send` / `customer_db` / `target_send` / `ai_mapping` + `max_customers` / `max_auto_campaigns` = 유지.
- 주의: 운영 중 plan-guard 변경 = 소비처 `grep -rn` 전수 후 신중.

### 통합 검증 + 배포 (Phase 2~3 한 번에)
- backend tsc 0 + 단위검증(calc/tx) GREEN + 자가 grep.
- 운영 DB `plans` UPDATE (설계도 §0 SQL — `ai_credits_per_month`: STARTER 70 / BASIC 200 / PRO 1000 / TRIAL 1000 / BUSINESS 3500 / ENTERPRISE 7000 / FREE 0).
  - 주의: `plan_credits` 값이 들어가는 순간 크레딧 차감 활성(현재 NULL이면 skip). 그래서 배포 + plans UPDATE를 함께.
- tp-push 배포.

---

## 3. 이미 실행된 DB ALTER (재실행 불필요)
- `plans.ai_credits_per_month` (컬럼만 — VALUES는 §0 UPDATE 필요).
- `companies`: `ai_credits_base_remaining` / `_purchased` / `_reset_at` / `_monthly_cap` + `postpaid_overage_limit`.
- `ai_credit_transactions` 테이블.

## 4. 보류 (다음 우선순위)
- 2단계 임박 경고(잔여 < 2사이클): 매 사이클 반복 알림을 막을 cooldown 컬럼(`continuous_operators.last_credit_alert_at` 등) 필요 → 별도. 멈춤 알림(핵심)은 구현됨.
- Phase 4(슈퍼관리자 크레딧 설정/충전/후불 승인) + Phase 5(요금제 페이지 크레딧 게이지) + Phase 6(차감 통합 TDD).

## 5. 영구 룰
- db_column_verify: 신규 컬럼 `information_schema` 검증 먼저.
- 돈 영역 트랜잭션 + idempotent + 음수 한도(ai-credit-tx 적용).
- 3원칙(자가진단 + 클로드 원칙 + 슈퍼파워즈) + 자연 한국어 + Grep 자가검증.

## 6. 다음 세션 진입 명령어 (Harold 복붙)
```
docs/superpowers/handoffs/2026-06-02-credit-pricing-phase3-deploy-handoff.md 정독 + docs/superpowers/specs/2026-06-01-credit-pricing-phase3-design.md 정독 + status/lessons/LESSONS_BACKEND.md 정독 → 종량제 Phase 3 진입: utils/plan-guard.ts 6 AI 잠금 → 크레딧 게이트(실차단은 checkCredit, plan-guard는 잠금 해제) + isAiOperatorAllowed 전 유료 플랜 개방 + spam_filter 잠금 기존 유지(스팸=크레딧 무관) → 소비처 grep 전수 → tsc + 자가 grep → Phase 2~3 통합 검증 → 운영 plans UPDATE(설계도 §0 ai_credits_per_month) + tp-push 한번에 배포. 3원칙 준수.
```
