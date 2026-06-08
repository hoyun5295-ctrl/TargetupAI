# BASIC 1개월 무료체험 신청·부여 시스템 — 설계 문서 (2026-06-08)

> 목적: AI Operator 오픈 기념 무료체험을 BASIC(베이직) 1개월로 제공. 팝업 신청 → 슈퍼관리자 플랜신청 목록 대기 → 승인 시 BASIC 30일 부여 → 자동 FREE 강등. 기존 PRO 무료체험 제거, AI 오퍼레이션 overlay 체험을 BASIC 체험으로 대체.

## 0. 확정 결정 (Harold 2026-06-08)
- 팝업의 "12개월 약정 2개월 무료"는 일단 제외(OpenPromoPopup은 보존, 추후 재활용). 지금은 무료체험 팝업(OpenTrialPopup) 사용.
- 부여 시점 = **슈퍼관리자 승인 시** (팝업 신청 → 목록 '대기' → 승인 클릭 시 부여).
- 부여 방식 = **plan을 BASIC으로 30일 + BASIC 크레딧 + 30일 후 자동 FREE 강등** (overlay 방식 폐기).
- 무료체험은 BASIC 하나로 통합 — "30일 PRO 무료체험" 제거, "AI 오퍼레이션 무료체험" → "BASIC 1개월 무료체험".

## 1. 검증된 사실 (SQL/코드 실측 — no_guess)
- **BASIC 플랜**: `plan_code='BASIC'`, `ai_credits_per_month=750`, `ai_messaging_enabled=true`. (TRIAL=600 PRO급, FREE=0.) 코드에서는 UUID 하드코딩 X — `SELECT id, ai_credits_per_month FROM plans WHERE plan_code='BASIC'` 조회.
- **companies 크레딧 컬럼** (trial-downgrade-worker.ts 실측): `ai_credits_base_remaining`(base 버킷), `ai_credits_reset_at`(월 리셋 시각). purchased(구매) 버킷은 별도 컬럼 — 본 작업에서 **읽지도 쓰지도 않음**(보존).
- **크레딧 모델 (ai-credit.ts getCreditState:48 실측)**: `total = base + purchased`. base는 reset 시점이면 `plan.ai_credits_per_month`로 초기화(이월 X), purchased는 항상 보존. → **Harold 강조사항(base 월 초기화·purchased 보존)은 이미 구현됨**. 본 작업은 이 불변식을 깨지 않고 따른다.
- **plan_requests 컬럼** (information_schema 실측): id·company_id·user_id·requested_plan_id·message·status·admin_note·processed_by·processed_at·created_at·user_confirmed. **무료체험 전용 컬럼 없음** → `message` 센티넬로 구분(ALTER 없이).
- **플랜 신청 흐름**: 사용자 `POST /api/companies/plan-request`(companies.ts:288) → `plan_requests` INSERT(한 번에 pending 1건 제약 companies.ts:305) → 슈퍼관리자 `GET /api/admin/plan-requests`(admin.ts:1135) 목록 → `PUT /api/admin/plan-requests/:id/approve`(admin.ts:1165, 회사 plan_id 변경 + status paid/trial).
- **기존 무료체험 2종**: ① `grant-trial`(companies.ts:1439, plan=TRIAL PRO급 30일+trial_expires_at) — 제거 대상. ② `grant-ai-operator-trial`(companies.ts:1551, overlay ai_operator_trial_until) — BASIC 체험으로 대체 대상.
- **자동 강등 워커**(trial-downgrade-worker.ts): 현재 `plan_code='TRIAL'` + 만료만 잡음 → plan=BASIC 체험은 안 잡힘 → **확장 필요**.
- **팝업 마운트**: Dashboard.tsx:10 import, :3905 `<OpenPromoPopup />`. 셀프 게이팅 `shouldShowOpenPromo()`(24h dismiss).

## 2. 크레딧 불변식 (★ Harold 강조 — 매우 중요, 모든 변경이 준수)
- **base(기본 부여) 크레딧**: 매월 `plan.ai_credits_per_month`로 초기화. 이월/누적 X.
- **purchased(구매) 크레딧**: 절대 초기화 X. 월 넘어가도 그대로 보존.
- 본 작업의 모든 UPDATE는 `ai_credits_base_remaining` + `ai_credits_reset_at`만 건드리고 purchased 컬럼은 SQL에 포함하지 않는다(=보존). 부여 시 base=BASIC(750), 강등 시 base=FREE(0).

## 3. 설계

### Part 1 — 팝업 (OpenTrialPopup)
- **신규** `packages/frontend/src/components/OpenTrialPopup.tsx`: Downloads 제공 tsx 기반 적응.
  - `"use client"` 제거(Vite). `shouldShowOpenTrial()`(24h dismiss, key `targetup_trialpromo_dismiss`).
  - CTA "지금 무료체험 신청하기" → `/trial` 네비게이션 폐기 → `POST /api/companies/trial-request`(Authorization 토큰) 호출.
  - 성공 시 카드 내용을 **"신청되었습니다" 성공 뷰**로 스왑(다크 톤 유지): "무료체험 신청이 접수되었습니다. 승인되면 베이직 기능이 1개월간 열립니다." + 닫기.
  - 이미 신청 존재(400) 등 응답은 토스트 대신 카드 내 안내 문구로 표시(native dialog 0).
- **Dashboard.tsx**: import/mount를 OpenTrialPopup으로 교체. 노출 게이팅 = `planInfo?.plan_code === 'FREE'`(미가입/trial_expired)일 때만 렌더(유료·체험중 회사 비노출). OpenPromoPopup 파일은 보존(미마운트).

### Part 2 — 무료체험 신청 생성 + 목록 표시
- **신규** `POST /api/companies/trial-request`(companies.ts, authenticate):
  - 회사 plan_code 확인 — FREE/미가입만 신청 가능(유료/체험중 400).
  - 기존 pending 1건 제약 재사용(중복 400).
  - BASIC plan id 조회 → `INSERT INTO plan_requests (company_id, user_id, requested_plan_id, message, status) VALUES ($1,$2,$BASIC,'[무료체험] AI Operator 베이직 1개월 무료체험 신청','pending')`.
  - 응답 `{ success: true }`.
- **슈퍼관리자 목록**: 기존 `GET /admin/plan-requests`가 plan_requests를 그대로 반환 → 자동 표시. 프론트(AdminDashboard 플랜신청 목록)에서 `message`가 `[무료체험]`로 시작하면 신청 플랜 옆 "무료체험" 배지 표시(시인성). 메시지 본문은 그대로 노출.

### Part 3 — 승인 시 BASIC 체험 부여 (approve 분기)
- **수정** `PUT /api/admin/plan-requests/:id/approve`(admin.ts:1165):
  - 요청 row의 `message`가 `[무료체험]`로 시작 = 무료체험 승인 → BASIC 체험 부여:
    - BASIC plan id + ai_credits_per_month 조회.
    - `UPDATE companies SET plan_id=$BASIC, subscription_status='trial', trial_expires_at=NOW()+'30 days', ai_credits_base_remaining=$basicCredits, ai_credits_reset_at=NOW(), updated_at=NOW() WHERE id=$company` (purchased 미포함=보존).
    - plan_requests status='approved' + processed_at/processed_by.
  - 그 외(일반 플랜 변경) = 기존 동작(plan_id 변경 + status paid/trial) 유지.
- 공통 부여 로직은 헬퍼 `grantBasicTrial(companyId)`로 추출(approve + 고객사 상세 버튼 + 향후 재사용 단일 진입점, no_inline_duplication).

### Part 4 — 슈퍼관리자 고객사 상세 (부여 카드)
- **AdminDashboard.tsx**:
  - "30일 PRO 무료체험" 카드 + grantTrial/revokeTrial 핸들러 **제거**.
  - "AI 오퍼레이션 30일 무료체험" 카드 → **"BASIC 1개월 무료체험"** 카드로 문구/동작 변경. 부여 = `POST /api/companies/:id/grant-basic-trial`, 취소 = `POST /api/companies/:id/revoke-basic-trial`.
  - 안내 문구: "부여 시 베이직 플랜 + 베이직 크레딧(750) 1개월 개방, 30일 후 자동 미가입(FREE) 강등."
- **백엔드** companies.ts:
  - **신규** `POST /:id/grant-basic-trial`(requireSuperAdmin) = 위 `grantBasicTrial(companyId)` 호출(approve와 동일 로직 공유).
  - **신규** `POST /:id/revoke-basic-trial`(requireSuperAdmin) = plan=FREE + subscription_status='trial_expired' + base=0 + reset_at=NOW() (purchased 보존). trial_expires_at 무관.
  - 기존 `grant-ai-operator-trial`/`revoke-ai-operator-trial`(overlay) = 프론트 소비처 제거 후 미사용(잔존 무해). `grant-trial`/`revoke-trial`(PRO) = 프론트 카드 제거 후 미사용.

### Part 5 — 자동 강등 워커 확장
- **수정** `trial-downgrade-worker.ts runTrialDowngradeJob`:
  - 대상 조건을 `subscription_status='trial' AND trial_expires_at IS NOT NULL AND trial_expires_at < NOW()`로 확장(plan_code='TRIAL'에 한정하던 것 → BASIC 체험 포함). 정식 구독(status='paid')은 제외.
  - UPDATE = plan=FREE + status='trial_expired' + `ai_credits_base_remaining`=FREE(0) + `ai_credits_reset_at`=NOW() (purchased 미포함=보존, 기존과 동일).
  - 순수 판정(대상 SQL where절) 단순하므로 워커 통합 테스트는 기존 패턴, 변경 핵심은 where 조건.

### Part 6 — 요금제 변경 알림 모달 (최초 접속 1회) ★ Harold 2026-06-08 추가
- **신규** `frontend/src/components/PlanChangeModal.tsx`(다크 톤 `bg-slate-900`+violet, ESC/backdrop 닫기). 두 모드:
  - **활성화/상향**: 제목 "무료체험이 활성화되었습니다"(status='trial') 또는 "[플랜명] 요금제로 변경되었습니다"(유료) + **활성화된 기능 목록** + "사용법이 어려우시면 클릭하세요" 버튼 → `window.open('/manual/manual.html','_blank','noopener')`(헤더 매뉴얼과 동일).
  - **종료/하향**: 제목 "무료체험이 종료되었습니다" + "다음 기능 이용이 제한됩니다" + **제한되는 기능 목록**.
- **기능 목록**: 정적 맵 `PLAN_FEATURES[plan_code] = string[]`(마케팅 카피 직접 관리, no_inline_duplication 차원 단일 정의). 활성화=새 플랜 기능, 종료=잃은 기능(옛 플랜 − 새 플랜 차집합).
- **트리거 + 1회**: Dashboard 로드 시 localStorage `targetup_last_seen_plan` ↔ 현재 `planInfo.plan_code` 비교. 다르고 옛 값 존재 → 모달 표시 → 닫을 때 localStorage=현재. 옛 값 없음(최초 로그인/배포 직후) = 조용히 설정(스푸리어스 모달 X).
- **방향 판정**: 정적 플랜 랭크(monthly_price 순: FREE<STARTER<BASIC<PRO<BUSINESS<ENTERPRISE, TRIAL은 BASIC 취급) → 상향=활성화 모달, 하향=제한 모달. `subscription_status='trial'`이면 "무료체험" 문구.
- **once 저장 = localStorage(브라우저 1회, ALTER 0)**. Harold anti-DB-risk 우선 — 교차 기기 1회는 향후 컬럼으로 확장 가능.
- 모든 요금제 변경(체험 활성/종료 + 일반 유료 변경)에 공통 동작.

## 4. 컴포넌트/파일
- 신규: `frontend/src/components/OpenTrialPopup.tsx`, `frontend/src/components/PlanChangeModal.tsx`(+ 정적 `PLAN_FEATURES` 맵).
- 수정: `frontend/src/pages/Dashboard.tsx`(팝업 마운트 교체+게이팅 + 요금제 변경 localStorage 비교·PlanChangeModal 렌더), `frontend/src/pages/AdminDashboard.tsx`(PRO 카드 제거·AI op 카드→BASIC·무료체험 배지).
- 수정: `backend/src/routes/companies.ts`(trial-request 신규 + grant/revoke-basic-trial 신규 + grantBasicTrial 헬퍼), `backend/src/routes/admin.ts`(approve 무료체험 분기), `backend/src/utils/trial-downgrade-worker.ts`(where 확장).
- 보존(미변경): `OpenPromoPopup.tsx`, ai-credit.ts(크레딧 불변식 그대로 활용).

## 5. 엣지/안전
- 팝업 신청 = FREE/미가입만(유료·체험중 비노출+서버 400). 한 번에 pending 1건(기존 제약).
- 재체험 방지(이미 trial_expired였던 회사 재신청)는 v1에서 슈퍼관리자 승인 재량으로 통제(자동 차단은 향후).
- 크레딧 purchased 보존 = 모든 UPDATE에서 purchased 컬럼 제외(불변식 §2).
- DB ALTER 0건(plan_requests 마커=message 센티넬). 신규 SQL 컬럼 참조 = 전부 검증된 컬럼.

## 6. 검증
- backend tsc 0 + frontend tsc 0.
- 자가 grep: 모델명 0 · native dialog(alert/confirm/prompt) 0 · 박-단어 0 (신규 팝업/모달).
- 순수 헬퍼(grantBasicTrial의 SQL 파라미터 산출 또는 워커 where 판정) 가능 시 백엔드 manual-test.
- 배포 후 스모크: 팝업 신청 → 목록 표시 → 승인 → companies(plan=BASIC·status=trial·base=750·trial_expires_at) 1건 실측 + 30일 후 강등 where 점검.
