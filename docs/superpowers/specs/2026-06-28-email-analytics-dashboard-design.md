# 이메일 분석 대시보드 — 확정 설계 (2026-06-28, Phase 2-A)

> Phase 2 후보(분석 대시보드 / A·B / 세그먼트) 중 Harold 선택 = **분석 대시보드부터**. 발송·돈 경로 무관(읽기 전용)이라 6원칙 승인·실측 게이트 없이 진행. A·B·세그먼트는 발송 경로라 다음에 6원칙 게이트 거쳐 별도.

## 0. 목표 (승리 공식 — 편리함 + AI 풍부, 기능 수 경쟁 X)

캠페인 성과를 자동 집계해 보여주고, "AI가 약한 지점을 진단 → 1클릭 액션"으로 잇는다. 데이터는 이미 쌓인 `email_campaigns`(denormalized 카운트) + `email_events`(open/click 등)만 사용.

## 1. 진입 / UI (모달 우선, 가로 큰 배너 배제)

- `EmailCampaignsPage` 헤더에 "분석" 버튼(캠페인 1건+ 일 때) → `EmailAnalyticsModal`(전체 다크 모달 `bg-slate-900`).
- 모달 구성(데이터 적응 — 부족하면 숨김):
  1. 기간 토글 7 / 30 / 90일(기본 30).
  2. 요약 5지표 + **이전 동기간 대비**(총 발송=상대 증감 %, 오픈율·클릭률·반송률·수신거부율=포인트 증감 pp). TrendingUp/Down + 색.
  3. **AI 종합 진단 카드**(violet→fuchsia, Sparkles) — "AI 진단 받기(5크레딧)" 1클릭(자동 과금 X). topInsight + 개선 2~3건(혜택 임의 생성 0).
  4. **일자별 추이**(발송/오픈/클릭) — 신규 의존성 0(인라인 CSS 바). 2일 미만 숨김.
  5. **캠페인 성과 비교**(오픈율/클릭률 정렬, 상·하위) — 페이지 campaigns로 클라이언트 계산. 각 행 1클릭 "AI 진단"·"미오픈 SMS"(기존 InsightModal/NonOpenerModal를 페이지 콜백으로 재사용).
  6. 모든 카드/차트 Source caption.
- 모델명 UI 0 / native dialog 0 / 모바일 반응형.

## 2. 백엔드

- `GET /api/email/analytics?days=30` — 읽기 전용·무과금·회사 격리. 신규 컬럼 0(전부 기존 컬럼).
  - summary.current / summary.previous: `email_campaigns` WHERE company_id + sent_at ∈ 현재/이전 동기간. SUM(sent_count/open_count/click_count/bounce_count/unsubscribe_count) → 비율은 순수 calc.
  - trend[{date, sent, open, click}]: 일자별. open/click = `email_events`(event_type) JOIN campaigns, sent = `email_campaigns.sent_at`. KST(`AT TIME ZONE 'Asia/Seoul'`).
- `POST /api/email/ai/account-insight` — 5크레딧(email-performance-insight). 집계 통계 위 AI 요약 `{topInsight, suggestions[]}`. `buildEmailAccountInsight`(email-ai 패턴 재사용, opus, 실측만·임의 혜택 0).

## 3. 순수 코어 (TDD)

- `utils/email/email-analytics-calc.ts`: `rate(num, den)`(0 가드·1소수 %) · `relativeDelta(cur, prev)`(prev≤0이면 null) · `pointDelta(curPct, prevPct)`(pp). 순수·DB 0 → vitest.

## 4. 신규/수정 파일

신규: `email-analytics-calc.ts` + 테스트 · `components/email/EmailAnalyticsModal.tsx` · `components/email/email-campaign-types.ts`(EmailCampaign 공유 타입).
수정: `routes/email.ts`(analytics + account-insight 라우트) · `email-ai.ts`(buildEmailAccountInsight) · `EmailCampaignsPage.tsx`(EmailCampaign 타입 공유 import + "분석" 버튼 + 모달 배선).

## 5. 영구 원칙

- 발송·돈 경로 무수정(읽기 전용). AI 진단 = on-demand 5크레딧·실측만·임의 혜택 0.
- 모델명 UI 0 · native dialog 0 · 모바일 반응형 · Source caption · 데이터 적응.
- 검증: backend tsc 0 + frontend tsc 0 + 순수 calc vitest + 자가 grep(모델명/native dialog/박-단어 0).
