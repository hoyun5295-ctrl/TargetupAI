# 한국형 Braze 「한줄로」 빈 기능 대조 (내부용 · 2026-11-05)

> ⛔ 내부 문서. 고객 제안서에 이 표를 싣지 않는다(로드맵 노출 금지).
> 재료 = 롯데멤버스 「DSC 서비스 소개서」(GA · Braze · Airbridge · DeepAD DMP 묶음 · 20쪽 · Harold 1105 전달) + Braze 공개 자료(2026-11 검색 · 아래 출처).
> 한줄로 쪽 판정 근거 = 코드 grep · 기능 카탈로그(`packages/backend/src/content/feature-catalog.ts` · ready 40) · 기능 문서. 「없음」= 그 이름 · 동작의 코드를 찾지 못함(grep 0). 「확인 필요」= 흔적은 있으나 운영 동작을 보지 못함.
> 고객 제안서 = `marketing/proposals/2026-11-hanjul-proposal/index.html` → PDF `Downloads\한줄로_서비스제안서_2026-11\`.
> ★1106 재확인 = 여정 대조군 · 밴딧 A/B · 문장 조건문 · 발송 순간 외부 데이터 · 자사몰 퍼널은 **코드에 있다**(아래 두 표를 고쳤다 · 경위 = [ROADMAP §7](../status/ROADMAP.md)). 1105 판정은 영문 기능 이름으로만 grep 했다 → 남은 「없음」도 착수 전 재확인.
> **기능 추가 순위 = [status/ROADMAP.md](../status/ROADMAP.md)**(1106 Harold 승인 · 이 문서는 대조만 소유).

## 1) 이미 있는 것 (제안서에 쓴 것)

| Braze 쪽 기능 | 한줄로 | 근거 |
|---|---|---|
| Canvas 시나리오 자동화 | 여정 · 마케팅 사건 12종 · 분기 · 기다림 · 여정 이어 붙이기 · 매장 구매도 같은 트리거 | `docs/FEATURE-JOURNEY.md` §4 |
| 예약 · 행동 기반 발송 | 예약 발송 · 여정 | 카탈로그 `schedule-send` · `journeys` |
| 세그먼트 | 조건으로 대상 고르기 · 고객 묶음 저장 | 카탈로그 `send-target` · `segments` |
| Personalization Tag | 변수 치환(이름 · 등급 · 포인트 · 명단 열) | `utils/messageUtils.ts`(공통 치환 CT) |
| 예측 이탈 · 구매(Predictive) | 이탈 · 구매 예측 점수 | 카탈로그 `predictive` · `utils/predictive-suite.ts` |
| Intelligent Timing | 비슷 · 고객별 `bestHour`(최적 시간대) 점수 | `utils/predictive-suite.ts` · ⚠ 발송 시각에 자동으로 쓰이는지 확인 필요 |
| Intelligent Channel | 비슷 · 채널 자동 선택(카카오 > LMS > SMS > 이메일 > 웹 푸시 > 인앱 · 규칙 순서) | `utils/source-aware-channel-selector.ts` · 개인 반응 학습은 아님 |
| Email · Web Push · 웹 인앱 | 이메일 · 웹 푸시(VAPID) · 자사몰 배너 · 팝업 | 카탈로그 `email-campaign` · `push-campaign` · `inapp-message` |
| Landing pages | 모바일 DM(블록 편집기 · 카탈로그 DM) | 카탈로그 `mobile-dm` |
| BrazeAI(문안 · 이미지) | AI 문안 · 이미지 스튜디오 · 재료로 완성본 | 카탈로그 `write-copy-ai` · `image-studio` · `quick-campaign` |
| BrazeAI Agents | AI 오퍼레이터(한 줄 목표) · 자동 마케팅 · 마케팅 플래너 | 카탈로그 `ai-operator` · `auto-marketing` · `marketing-planner` |
| Agentic Standards(캠페인 점검) | 비슷 · 통신 3사 실폰 스팸 검사 · AI 문안 자동 스팸 검사 · 규격 밖 글자 처리 · 광고 표기 | 카탈로그 `check-spam` · `auto-spam-test` |
| SDK 데이터 수집 · CDI | 자사몰 스크립트(sdk) · 6종 몰 연동 · 싱크 에이전트(Oracle · MSSQL · MySQL · PG · 엑셀) | `docs/FEATURE-CDP-INTEGRATION.md` §4 · `docs/FEATURE-SYNC-AGENT.md` |
| A/B 테스트 · 자동 배분(Intelligent Selection) | ★1106 고침 · 여정 · 자동 마케팅 · 인앱 문안 = Thompson 밴딧 자동 배분 · DM A/B | CT-31 `utils/bandit-optimizer.ts` · `journey-executor.ts` · `inapp-variant-optimizer.ts` · `utils/dm/dm-ab-test.ts` |
| 여정 대조군(Experiment Paths 대조군) | ★1106 고침 · 여정만 · 대조군 비율 0 ~ 30% · 발송군 vs 대조군 전환율 비교 | `journeys.holdout_pct` · `journey-entry-ledger.ts:203` · `journey-stats.ts:641` · 일회성 캠페인 · 전체 대조군은 없음(아래) |
| 문장 안 조건문(Liquid if) | ★1106 고침 · 코드 있음(`{% if %}`) · 화면 · 운영 사용 미확인 | `utils/messageUtils.ts:259` |
| 발송 순간 외부 데이터 채움(Connected Content) | ★1106 고침 · 코드 있음(날씨 · 재고 · 가격 · 신상품 · 쓰는 곳 = 여정 문안 렌더) · 운영 사용 미확인 | CT-53 `utils/connected-content.ts` · `journey-message-render.ts` |
| 웹 행동 퍼널(GA 퍼널 일부) | ★1106 고침 · 30일 페이지뷰 → 장바구니 → 결제 시작 → 구매 · 자사몰 설정 창 | `utils/cdp-diagnostics.ts:247` · `CdpAnalyticsPanels.tsx` |
| Frequency capping | 비슷 · 발송 피로도 상한(회사 opt-in · 광고성만) | `utils/fatigue-guard-core.ts` · ⚠ 운영 DDL(`companies.fatigue_cap_*`) 실행 여부 확인 필요 → 제안서에서 뺐다 |

## 2) 없는 것 (DSC 소개서 · Braze 2026 자료 기준)

| 기능 | 어디에 있나 | 한줄로 | 메모 |
|---|---|---|---|
| 일회성 캠페인 대조군 · 전체 대조군(Global Control Group) · 증분 매출 ₩ · 신뢰도 | Braze Canvas(소개서 14쪽 「실험군 vs 대조군 비율」) | ★1106 고침 · 여정 대조군만 있음(위 표) | 성과 증명(lift)의 바탕 · 영업 질문 1순위 = ROADMAP 1순위 |
| 고객별 오퍼 결정 + 대조군 lift(Decisioning Studio Go / Pro) | Braze 2026 GA | 없음 | 자동 마케팅은 회차 단위 제안 |
| 외부 DMP · 고객사 API 를 부르는 Connected Content | Braze(소개서 16쪽 DeepAD API 호출) | ★1106 고침 · 날씨 · 재고 · 가격 · 신상품만(위 표) | 대기업 · 외부 DMP 연계 요구 |
| 외부 DMP 세그먼트 연동 | DSC(DeepAD DMP · ADID 타겟) | 없음 | 엑셀 · DB 로 명단을 받는 것은 됨 |
| API 트리거 발송(고객사 서버가 발송 시작) | Braze(소개서 13쪽) | 한줄로 앱 없음 | 비토 게이트웨이(별도 제품)에는 발송 API 있음 |
| 앱 네이티브 푸시(FCM / APNs) | Braze | 없음(grep 0 · 웹 푸시만) | 앱 보유사(L.POINT 앱류) 필수 |
| 앱 인앱 메시지 SDK | Braze | 확인 필요 | 인앱 만들기 개편(C02) · 앱 SDK OTA 흔적 · 운영 앱 실측 미확인 |
| Content Cards · News Feed · Banners(앱 안 고정 자리) | Braze | 없음 | 웹 배너 · 팝업만 |
| 원본 이벤트 실시간 내보내기(Currents · Datashare) | Braze(소개서 7쪽) | 없음 | 고객사 데이터 웨어하우스 적재 요구 |
| 여정 웹훅 단계(외부 시스템 호출) | Braze | 확인 필요 | |
| 대화형 에이전트(SMS · RCS 양방향 AI) | Braze 2026 beta | 없음 | 인바운드 AI 음성 통화 표는 있음(`voice_inbound_calls`) |
| RCS 발송 | Braze 2026 | 확인 필요 | `rcs_templates` 표 있음 · 운영 발송 실측 없음 |
| Feature Flags · Location trigger · Wearable | Braze | 없음 | 국내 마케팅 수요 낮음 |
| 앱 설치 어트리뷰션 · 매체 통합 성과 · 부정 설치 탐지 | Airbridge(MMP · 소개서 8 ~ 11쪽) | 없음 | 단축 링크 클릭 집계만 |
| 디퍼드 딥링크(앱 설치 여부로 웹 · 스토어 · 앱 분기) | Airbridge(소개서 10쪽) | 없음 | 문자 링크 → 앱 화면 직행 수요 큼 |
| 웹 · 앱 행동 분석(페이지 경로 · 상품별 이탈 지점 · 내부 검색 · 구좌별 클릭률) | GA(소개서 4 · 5쪽) | ★1106 고침 · 4단계 퍼널만 있음(위 표) | = ROADMAP 5순위 |
| 자유 대시보드 빌더 · 원본 데이터 BigQuery 연동 | GA + Data Studio(소개서 5 · 18쪽) | 없음 | 성과 화면은 고정형 |
| 담당자 교육 과정 · 태깅 가이드 컨설팅 | DSC(소개서 3 · 6쪽) | 서비스 형태로 없음 | 마케팅 진단 · 캠페인 대행 · 대행발송은 있음 |

## 3) 우선순위

**[status/ROADMAP.md](../status/ROADMAP.md) 가 소유한다**(1106 Harold 승인 1 ~ 5순위 · 다음 후보 · 착수 전 확인). 1105 에 여기 적었던 ① ~ ④ 는 ②(조건문 · 외부 데이터 = 코드 있음)가 틀려 지웠다. 출처 = [Braze Forge 2026 발표](https://www.braze.com/resources/articles/forge-2026-braze-product-announcements) · [Braze 2026-10-15 릴리스](https://www.braze.com/docs/releases/2026/10_15_26) · [BrazeAI 문서](https://www.braze.com/docs/user_guide/brazeai) · [Intelligence Suite](https://braze.com/docs/user_guide/brazeai/intelligence_suite) · [Predictive Suite](https://www.braze.com/docs/user_guide/brazeai/predictive_suite).
