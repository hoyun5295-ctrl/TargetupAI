# DM AI 캠페인 자동화 설계서 (G) — 2026-06-13

> 모바일 DM 재설계 7개 서브 중 **G**. 선행: B(인터랙션)·A(editor)·D(빠른시작). Harold: "AI를 이용해 제대로 편리하게 — 그게 가장 큰 목적."

## 배경 (검색 실측)

현재 DM AI(`dm-ai.ts`)는 자연어→섹션 생성(`oneShotGenerate`, 돌려보기 3크레딧)이 전부. 룰렛·추첨 같은 인터랙션 캠페인을 만들려면 사용자가 세그먼트·확률·경품·인원·마감·동의·통보 문안을 **전부 손으로** 설정해야 한다(A로 editor가 생겨도 입력량 큼). "DM = 캠페인 자동화"의 가치는 AI가 이 설정을 편하게 해줄 때 나온다.

## 목표

마케팅 담당자가 자연어 한 줄로 **인터랙션 캠페인 전체**(섹션·경품·확률·폼·마감·통보 문안)를 AI로 구성하고, 결과까지 AI가 요약한다. (feedback_marketing_user_ux_priority: 1클릭 = AI 자동 흐름.)

## 1. AI 기능 4종

### 1-A. 캠페인 생성 AI
- 입력: "다음 주말 룰렛 이벤트, 1등 에어팟 1명·2등 스벅 10명·꽝" 같은 자연어.
- 출력: roulette 섹션 + dm_prizes(등급·인원·확률 자동 배분) + 폼·동의·마감 + 헤더/CTA/푸터 chain + 카피.
- `oneShotGenerate` 확장 — 인터랙션 시나리오 인식 → 섹션+경품 동시 생성.

### 1-B. 경품 설정 AI
- "100명 추첨, 1~3등 차등" → `dm_prizes` 등급/인원/(룰렛이면)확률 자동 제안. 사용자는 검토·수정만.
- 확률 합계 100% 자동 보정.

### 1-C. 당첨 통보 문안 AI
- 당첨자에게 보낼 SMS/알림톡 문안 자동 생성(등급별: "1등 당첨!"). 
- **구체 혜택(%/원/쿠폰/무료) 임의 생성 금지**(feedback_ai_no_arbitrary_benefit) — 경품명·수령안내 골격 + `[직접 작성해주세요]`. (광고)·무료거부·080은 발송 CT(prepareSendMessage)가 합성.

### 1-D. 결과 분석 AI
- 응모·당첨·단축URL 반응도(`dm_views`) 데이터 → 인사이트 요약("응모율 X%, 유입 시간대 Y"). 실데이터만, 임의 상수 0(feedback_no_arbitrary_constants).

## 2. 모델·크레딧 연계

- DM AI는 기존 한줄로AI 흐름(callAIWithFallback, model 미지정=기본) — AI Operator(별도 모델)와 분리(feedback_ai_operator_model_isolation). 사용자 노출에 모델명 0(no_model_name_ui_exposure).
- 크레딧: F의 `dm-ai-*` 항목 — 캠페인 생성/경품/통보문안 각 호출 과금(F에서 단가). 결과 분석은 분석 단가 재사용.

## 3. 마케팅 UX (1클릭)

- 빠른 시작 12(D) 카드 클릭 = 시나리오 자연어 → 1-A 즉시 호출 → 완성 캠페인 + 편집 진입.
- 자유 입력("어떤 이벤트를 만들까요?") → 1-A.
- 모든 AI 출력은 편집 가능(사용자 최종 통제) + 임의 혜택 placeholder.

## 4. 안전·법적

- AI 통보 문안 = 발송 전 (광고)·무료거부 합성 검증(검증·테스트 경로 동일 CT, LESSONS D230+).
- 개인정보(응모자) AI 입력 금지 — 집계·익명 데이터만 AI에 전달.

## 검증

- backend tsc 0. AI 응답 파싱 순수 검증(경품 배분·확률 합계 등 `dm-ai-core` TDD).
- 외부 AI 응답 raw 검증(feedback_external_api_response_verification) — 첫 호출 raw 로그 확인 후 파싱 확정.
- 자가 grep: 박-단어·모델명(사용자 노출) 0 / 구체 혜택 임의생성 0 / native dialog 0.

## 배포

`tp-push` → backend `pm2 restart all`(ts-node) + frontend `build:safe`(AI 호출 UI).

## ★ 의존

F(크레딧 단가 확정) + B(dm_prizes 데이터모델) 선행. A(editor)와 결과 동기화.
