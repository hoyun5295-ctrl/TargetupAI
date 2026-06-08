# 성과 리포트 전면 재설계 — 설계 문서 (2026-06-08)

> 대상: `packages/frontend/src/pages/PerformancePage.tsx` (`/performance`).
> 구현 = 다음 세션. 이 문서만으로 바로 진입 가능하도록 세세·정확하게 작성.
> 데이터 모델은 현 `PerformancePage.tsx` 인터페이스(검증)에서 그대로 인용.

---

## 0. 한 줄 목적
산만하게 세로로 다 쏟아붓는 현재 성과 리포트를 **분석 중심 3단 위계(헤드라인 + 요약 바 + 클릭 시 세부 모달)**로 전면 재설계한다. 일반 CRM·표준 마케팅 솔루션을 넘어, **AI가 마케팅 성과를 해석(결과→원인→제안)**하고 싱크에이전트 SDK 자사몰 연동으로 **발송→실매출 닫힌 고리 기여**까지 잇는 최상위급 성과 분석 화면 + PDF 풀 보고서.

## 1. 자율예측 vs 성과리포트 (혼동 금지 — 0순위)
- **자율예측** = 미래. 매일 3크레딧으로 AI가 "누구에게·무엇을·언제" 보낼지 예측해 마케팅을 제안(forward).
- **성과리포트** = 과거~현재. 이미 집행한 마케팅이 "얼마나·왜" 성과를 냈는지 분석·해석·진단(backward). **예측 아님. 매일 크레딧 자동 소모 없음**(이미 쌓인 발송·자사몰 실적 분석). 무거운 AI 진단·PDF 풀분석만 사용자 요청 시점에 차감.
- 자율예측에서 **차용하는 것은 "난잡 금지" 구조 철학(3단 위계·모달·점진 공개)뿐**. 내용·AI 역할은 다르다.

## 2. 설계 원칙 (난잡 금지)
1. 3단 위계: 헤드라인(주인공 1) → 요약 바(작게) → 모달(클릭 시 세부).
2. 한 화면에 다 쏟지 않는다. 현재 세로로 펼친 인라인 차트 6종은 전부 모달로 격리.
3. **분석 서사**: 결과(무엇) → 원인(왜·드라이버/기여) → 제안(무엇을 할까).
4. 자사몰 적응형: 연동 시 승격 / 미연동 시 업셀.
5. 일관성 + 점진 공개.
6. 영구 룰: 다크 톤(`bg-slate-950` + violet 액센트), 모델명 노출 0, native dialog 0(커스텀 모달 + useToast), 모든 카드·차트에 source caption, 모바일 반응형, 결제 동선 = `CreditConfirmModal`.

## 3. 데이터 인벤토리 (백엔드 완비 — 재활용, 프론트 재구성 중심)
모든 엔드포인트·데이터 형식 존재. 형식은 현 `PerformancePage.tsx` 인터페이스 그대로.

| 엔드포인트 | 반환(요약) | 용도 |
|---|---|---|
| `GET /api/ai/operator/performance/snapshot-v2?period=` | `SnapshotV2`: 6 KPI(각 current/previous/diffPct/betterThan: totalCampaigns·totalSent·successRate·newCustomers·activeCustomers·estimatedRevenue) + byChannelROI[] + byHourWeekday[](히트맵) + byDailyTrend[]+previous + funnelStats? + topCampaigns[] | 헤드라인 KPI·채널·시간대·추세·퍼널·Top |
| `GET .../performance/data-availability` | `DataAvailability`: customerCount·campaignCount·cdpEventCount·**hasCdpIntegration**·cards[]·overallLevel | **자사몰 연동 판별** + 데이터 부족 안내 |
| `GET .../performance/cohort?months=12` | `CohortResult`: cohorts[](m1/m2/m3/m6 rate)·avgM1Rate·avgM3Rate | 코호트 잔존 |
| `GET .../performance/benchmark?days=` | `BenchmarkResult`: planCode·peerCompanyCount·metrics[](label·companyValue·industryAvg·diffPct·betterThan) | 업계 벤치마크 |
| `GET .../performance/attribution?days=` | `AttributionResult`: windows[](windowLabel/hours·cdpPurchaseCount·cdpRevenue·customerPurchaseCount)·**hasCdpData**·analysisPeriodDays | **닫힌 고리 기여(발송→실매출)** |
| `POST .../performance/explain` | `PerformanceExplanation`: overallScore·topInsight·factors[](category·label·impactScore·direction·detail)·recommendation | **AI 해석(결과→원인→제안)** |
| `GET .../performance/campaigns?` | `DrillCampaign[]` (검색/필터/정렬/페이지) | 캠페인 드릴다운 |
| `POST .../performance/quick-action` | 1-click: channel_recovery·time_optimization·top_performer_replication | 인사이트→1클릭 액션 |
| `POST .../performance/report-pdf` | PDF (풀분석 차감·같은 날 같은 기간 재다운 멱등 무료) | PDF 보고서 |
| `GET /api/insight/daily` | 일일 인사이트(CT-98 collectCompanyInsight: 어제 발송·성공·실패·활성고객·추천) | 어제 요약 칩 |

> 구현 시 확인: explain/cohort/benchmark/attribution이 실데이터 완성인지 일부 stub인지 백엔드 점검. 임의상수(impactScore 등) 실데이터 근거 의무.

## 4. 화면 구조 (메인)

### 헤더 (sticky)
"성과 리포트" + BETA 배지 + 그라데이션 아이콘. 우측: **자사몰 연동 상태 배지**(연동됨/미연동) · 기간 토글(7/14/30/90일) · PDF 보고서(CreditConfirmModal) · 새로고침.

### Tier 1 — 헤드라인 (주인공)
- **핵심 KPI 4 큰 카드** (데스크톱 1줄, 모바일 2×2). 각 큰 숫자 + 이전 기간 대비 +/-%(TrendingUp/Down):
  1. **매출** `estimatedRevenue` — 연동 시 실매출(attribution `cdpRevenue`) + "실매출(자사몰)" 배지 / 미연동 시 추정 + "추정" 배지. 클릭 → 매출·기여 모달.
  2. **ROAS/ROI** (byChannelROI 합산) — 클릭 → 채널 ROI 모달.
  3. **성공률** `successRate` — 클릭 → 추세/채널 모달.
  4. **활성 고객** `activeCustomers` — 클릭 → 코호트 모달.
  (KPI 4 구성은 운영 확인 후 미세 조정 가능 — 매출/ROAS는 고정 권장.)
- **AI 한 줄 진단** — `explanation.topInsight` + `overallScore` 배지. 예: "이번 30일 매출 X, 전월 +Y%. 채널 A가 ROI 주도, 시간대 B 저조." → "자세히" 클릭 = AI 진단 모달.
- Source caption.

### Tier 2 — 요약 아이콘 바 (각 칩 클릭 → 세부 모달)
아이콘 + 라벨 + 한 줄 요약 칩을 한 줄(모바일 flex-wrap):
- 채널 ROI(byChannelROI) → 모달
- 시간대(byHourWeekday) → 모달
- 퍼널(funnelStats)[자사몰] → 모달 / 미연동=업셀
- 기여도(attribution)[자사몰] → 모달 / 미연동=업셀
- 코호트(cohort) → 모달
- 벤치마크(benchmark) → 모달
- 추세(byDailyTrend) → 모달

### Tier 3 — AI 진단 & 액션
- **AI 자율 진단 요약 카드**: topInsight + 영향 요인 상위 2 + "자세히" → 진단 모달.
- **1-click 액션 3**(channel_recovery·time_optimization·top_performer_replication): 컴팩트 행. 클릭 = AI 자동 마케팅 진입(quick-action → CreditConfirmModal). `recommendation`과 시각적으로 연결.
- **Top 캠페인 상위 3** + "전체 보기" → 캠페인 드릴다운 모달.
- **어제 인사이트(CT-98)**: 작은 칩/접이식 카드(어제 발송·성공·실패). 헤드라인 산만하지 않게 작게.

## 5. 모달 명세 (공통 + 각)
공통: `bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl`, 우상단 X, ESC/backdrop 닫기, 하단 source caption, 모바일 세로 스크롤. 차트 = recharts(현재 사용).
- **매출·기여 모달**: attribution windows(윈도우별 발송→구매 기여 매출·건수) + 추정/실매출 구분. 미연동=업셀.
- **채널 ROI 모달**: 채널별 ROAS 막대 + 표(sent·success·successRate·estRevenue·estCost·roas·이전 sent).
- **시간대 모달**: 요일×시간 히트맵(byHourWeekday: sent·successRate).
- **퍼널 모달**[자사몰]: 조회→장바구니→위시→구매 단계 + 전환율(funnelStats). 미연동=업셀.
- **코호트 모달**: 월별 가입 코호트 m1/m2/m3/m6 잔존율 표/히트맵.
- **벤치마크 모달**: metrics[] 업계 평균 대비 막대(우리 vs 업계·peerCompanyCount).
- **추세 모달**: 일별 발송/성공 라인 + 이전 기간 비교(byDailyTrend/Previous).
- **AI 진단 모달**: overallScore + factors 전체(드라이버 분석·direction +/-·detail) + recommendation + 1-click 액션 연결.
- **캠페인 드릴다운 모달**: 검색·필터·정렬·페이지(campaigns endpoint, DrillCampaign).

## 6. 자사몰 적응형 (`hasCdpIntegration` / `hasCdpData`)
- **연동(true)**: 헤드라인 매출 = 실매출 배지, 요약 바에서 퍼널·기여도 칩을 앞쪽으로 승격, 모달에서 실데이터 차트.
- **미연동(false)**: 매출 = 추정 배지, 퍼널·기여도 칩 자리에 "**자사몰 연동하면: 실매출·퍼널·기여도까지 보입니다**" 업셀 카드 + 연동 진입(자사몰 진단). `cdpEventCount===0`이면 "SDK 설치 / webhook 동작 확인" 안내(현재 data-availability cards 재활용).

## 7. AI 해석 서사 (정석 초월 핵심)
- `topInsight` → 헤드라인 한 줄(결과 요약).
- `factors` → 진단 모달의 드라이버 분석(무엇이 성과를 이끌었나/어디서 새는가, direction +/-, impactScore).
- `recommendation` → 다음 액션 제안 → 1-click 액션으로 연결.
- 차별점 = 닫힌 고리 기여(발송→자사몰 실매출) + AI 서사 + 업계 벤치마크 + 코호트 잔존 + 인사이트→1클릭. "분석의 깊이 + 즉시 실행".
- 임의상수 금지: impactScore·ROAS 산식 등은 실데이터 근거(자율예측 교훈). 미검 시 별도 점검 항목.

## 8. PDF 풀 보고서
화면(모달)과 PDF(평면)는 같은 데이터·다른 표현. PDF는 모달 항목을 전부 펼친 인쇄용 풀 보고서:
- 표지(회사·기간·생성일시) → 핵심 KPI(이전 대비) → AI 진단 서사(topInsight·factors·recommendation) → 채널 ROI·시간대·퍼널·기여도·코호트·벤치마크 차트/표 → Top 캠페인 표 → 부록(데이터 소스·산식 주석).
- 같은 다크/violet 톤(또는 인쇄 가독성 위해 라이트 변형은 PDF 한정 검토). `report-pdf` 확장, 현재 차감 멱등 유지.

## 9. 컴포넌트 분해
- `PerformancePage`(컨테이너: fetch·상태·적응형 분기·기간).
- `HeadlineKpiCard`×4 · `AiDiagnosisLine` · `SummaryChipBar` · 각 `*DetailModal`(채널/시간대/퍼널/기여/코호트/벤치마크/추세/진단/캠페인) · `CdpUpsellCard` · `QuickActionRow` · `DailyInsightChip`.
- 순수 헬퍼(KPI 포맷·요약 산출·ROAS 합산)는 DB-free 파일로 분리 → 필요 시 TDD(ESM 충돌 시 backend로).

## 10. 검증 / 영구 룰
- frontend tsc 0. 자가 grep: 모델명(Opus/Sonnet/GPT/Claude/Anthropic) 0 · native dialog(alert/confirm/prompt) 0 · 박-단어 0.
- 모든 카드·차트 source caption. 다크 톤 + violet. 모바일 반응형. CreditConfirmModal/ConfirmModal/useToast.
- 임의상수(impactScore 등) 실데이터 근거 점검.

## 11. 구현 순서 (다음 세션)
1. 백엔드 엔드포인트 실재·반환 확인(snapshot-v2 ~ report-pdf, explain/cohort/benchmark/attribution 완성도 + stub 여부).
2. 컴포넌트 골격(헤드라인 + 요약 바 + 모달 셸) — 현 PerformancePage 점진 교체.
3. 데이터 바인딩(기존 fetch 재활용).
4. 자사몰 적응형 분기.
5. 모달 채우기(차트·표).
6. PDF 풀 보고서.
7. tsc + 자가 grep + 순수 헬퍼 TDD.

## 12. 확정 결정 (2026-06-08 brainstorming 종료)
- **헤드라인 KPI 4 확정**: 매출 · ROAS · 성공률 · 활성고객. 매출/ROAS 고정 + 성공률/활성고객. 나머지 지표(캠페인 수·총 발송·신규 고객)는 추세/채널 모달 안에서 노출.
- **어제 인사이트(CT-98) 배치 확정**: Tier 3 작은 접이식 칩(기본 접힘). 헤드라인과 분리해 산만함 방지.
- **백엔드 수정 범위 = Harold 위임**: "제대로 된 성과 리포트가 되려면 무엇이 필요한지 비토가 판단해 그대로 진행." 따라서 구현 1단계에서 백엔드를 직접 점검해, 정석을 넘는 리포트에 꼭 필요한 백엔드 보강만 근거와 함께 진행한다(임의상수 실데이터 전환·필요 데이터 추가·PDF 풀 보고서 확장 포함). DB 변경 시 information_schema 선검증 의무, 발송결과 등 운영 핵심 엔드포인트 회귀 0 확인.

### 구현 1단계에서 직접 점검할 항목 (위 위임에 따른 백엔드 실측)
- explain/cohort/benchmark/attribution 실데이터 완성도 vs stub.
- 임의상수(impactScore·ROAS 산식 등) 실데이터 근거 유무.
- ROAS 이전기간 비교 데이터 가용성(현 snapshot-v2 byChannelROI에 previous revenue/cost 부재 — 헤드라인 ROAS 카드 +/-% 표시 가능 여부).
- PDF 생성 방식/라이브러리(report-pdf 내부) — 풀 보고서 확장 범위.
