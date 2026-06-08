# 풀분석 Plan 3 — 보고서 보강 구현 Plan

> **For agentic workers:** 이 plan은 다음 세션에서 바로 구현한다. superpowers:subagent-driven-development 또는 executing-plans 사용. 각 신규 분석 함수는 순수 코어(DB-free)로 분리해 `.verify.ts` 순수 TDD로 고정한 뒤 호출부(DB SELECT)를 붙인다.

**Goal:** 풀분석 보고서에 익스큐티브 서머리·세그먼트 심층·다차원 비교·메시지 분석·예측·액션 플랜 섹션을 추가하고 벤치마크를 완전히 제거한다. 전부 그 회사 실데이터 도출(임의 상수 0)·데이터 부족 시 정직 표기·순수 TDD.

**Architecture:** Plan 1에서 만든 `full-analysis-runner` → 단계별 분석 함수 호출 → `performance-pdf-render`에 섹션 렌더. 분석 함수는 순수 코어(계산) + 호출부(customers/campaigns SELECT) 분리.

**Tech Stack:** Express + TS, PostgreSQL(`pg`), pdfkit. 기존: `buildPerformanceSnapshotV2`(snapshot), `explainPerformance`(AI 진단), `rfm-segment`/`segment-analysis`(이번 세션 완료).

---

## 0. 절대 전제 (다음 세션 시작 시 반드시 읽을 것)

- **데이터는 전부 목업(가짜)이다.** 실제 CDP 붙은 업체 0, 운영 고객 데이터도 시연용. 따라서 **실데이터 정확성 검증은 불가능**하다. 확인 가능한 건 코드 로직뿐: `tsc 0` + 순수 함수 TDD(가짜 입력→기대 출력) + 목업으로 풀분석 실행 시 PDF 생성·"데이터 부족" 분기 동작.
- **임의 상수 절대 금지** (메모리 `feedback_no_arbitrary_constants_use_real_data`). 전환율·CVR·uplift 등 지어내기 금지. 분위수/실측에서 도출, 없으면 `sufficient:false`/"데이터 부족".
- **customers RFM 컬럼은 실재 확정** — `recent_purchase_date`·`purchase_count`·`total_purchase_amount`·`ltv_score`·`avg_order_value`·`grade`가 운영 코드 47파일에서 실사용(기존 컬럼). cdp_events(실시간 매출/퍼널/기여)만 데이터 부족.
- **코드 SQL에 신규 컬럼/JOIN을 추가할 때만** information_schema 검증(db_column_verify). 기존 컬럼 재사용은 면제.

## 1. 이번 세션까지 완료 (Plan 1·2 + Plan 3 일부)

- **Plan 1 백엔드(미배포)**: `utils/full-analysis-steps.ts`(순수 9단계), `full-analysis-job.ts`(상태 CT), `performance-pdf-render.ts`(report-pdf 본문 추출·공유), `full-analysis-runner.ts`(단계 진행+PDF 파일저장, 차감=PDF성공후 멱등 `full-analysis:${jobId}`·실패시0), `routes/ai.ts` endpoint 3(start/status/download). `full_analysis_jobs` 테이블 생성 완료.
- **Plan 2 프론트(미배포)**: `PerformancePage.tsx` — 풀분석 버튼 + 설정 모달(기간·초점 4·제목) + 동의(CreditConfirmModal 재사용) + 진행도 모달(폴링 9단계). `startFullAnalysis`/`pollAnalysisStatus`/`downloadAnalysisPdf`. 옛 `downloadPdf`/`pdfLoading` 제거 완료.
- **Plan 3 일부(완료)**: `utils/rfm-segment.ts`(순수 RFM 분위수 분류, `computeRfmSegments`, TDD PASS) + `utils/segment-analysis.ts`(호출부 `buildSegmentAnalysis(companyId, nowMs)`: RFM+등급+LTV, 값 없으면 데이터부족).
- **레이아웃(완료)**: AI 자율진단 좌측 좁은 카드(36%) + 6카드 우측 grid 동일 높이 2단, 벤치마크 칩 제거. (단 벤치마크 모달/state/fetch는 죽은 코드로 남음 — T7에서 제거.)
- **미배포**: Plan 3 끝낸 뒤 Plan 1+2+3 한 번에 배포.

---

## 2. 남은 Task

### Task 1: 다차원 비교 분석
**Files:** Create `utils/multidim-comparison.ts`(순수 + 호출부) + `__tests__/multidim-comparison.verify.ts`
- 순수 코어 `computeChannelTypeCompare(rows)`: campaigns 행(send_type·message_type·sent·success·estimatedRevenue)을 받아 유형별(직접/AI/여정/자동)·채널별 성과 비교 표. 신규 컬럼 없음(snapshot.byChannelROI 재활용 + send_type 집계).
- 신규 vs 기존: `customers.created_at` 기준 신규(기간 내 가입) vs 기존, 발송 반응 비교 — 단 반응(구매)은 cdp 필요 → 발송 도달/성공률만, 매출 비교는 데이터부족.
- 기간 비교: snapshot의 `diffPct`(직전 대비) 재활용. 전년 동기는 데이터부족 가능(목업 범위).
- 호출부 `buildMultiDimComparison(companyId, period, snapshot)`: snapshot 재활용 + campaigns send_type GROUP BY SELECT.
- TDD: 순수 코어만(유형별 집계·비교 계산).

### Task 2: 메시지·콘텐츠 분석
**Files:** Create `utils/message-analysis.ts` + verify
- 순수 `computeMessageTypePerformance(rows)`: message_type(S/L/M = SMS/LMS/MMS)별 발송·성공률·건당 비용. campaigns + 비용(companies.cost_per_*).
- 반응 높은 패턴(길이·시간대): snapshot.byHourWeekday 재활용 + 메시지 길이 분포. 구매 반응은 데이터부족.
- 호출부 `buildMessageAnalysis(companyId, period)`: campaigns message_type GROUP BY.
- TDD: 순수 코어(유형별 집계).

### Task 3: 예측·기회
**Files:** Create `utils/forecast.ts` + verify
- 순수 `computeSendTrendForecast(dailySeries)`: 최근 발송량 일별 시계열 → 보수적 추세(선형 회귀 or 이동평균). **매출 예측은 cdp_events 매출 없으면 `{ available:false }`("데이터 부족")**.
- 놓친 기회: 휴면/이탈위험 세그먼트(RFM Task에서) 수 × (데이터부족이면 잠재매출 미산출, 세그먼트 규모만 제시).
- 호출부 `buildForecast(companyId, period)`: campaigns 일별 SELECT.
- **임의 상수 금지** — 추세는 실측 시계열에서만. 매출 추정 지어내지 말 것.

### Task 4: 우선순위 액션 플랜
**Files:** Create `utils/action-plan.ts` + verify
- 순수 `buildActionPlan(explanation, segmentResult, channelCompare)`: 기존 `explanation.recommendation`(AI 진단) + 세그먼트(이탈위험/휴면 규모) + 저성과 채널을 순위화한 권고 리스트. 각 권고에 근거(어느 데이터) + 연결(여정/자동마케팅 1-click은 텍스트 안내).
- 예상 효과 숫자는 데이터 있으면 실측, 없으면 생략(임의 상수 금지).
- TDD: 순수(우선순위 정렬·근거 매핑).

### Task 5: PDF 섹션 추가 + 벤치마크 제거
**Files:** Modify `utils/performance-pdf-render.ts`
- `PerformancePdfData`에 `segment`(SegmentAnalysis)·`multidim`·`message`·`forecast`·`actionPlan` 추가, `benchmark` 제거.
- 렌더 순서(spec §3 10섹션): 익스큐티브 서머리(explanation 요약 1p) → 성과 진단(기존) → 원인(기존 AI 진단) → 세그먼트 심층(RFM 분포+등급+LTV, `sufficient=false`면 "데이터 부족") → 채널·캠페인(기존) → 다차원 비교(신규) → 메시지 분석(신규) → 예측(신규, 매출 데이터부족 표기) → 액션 플랜(신규) → 부록(데이터 출처·부족 항목).
- **벤치마크 섹션(현재 1579~) 완전 삭제.**
- 각 섹션 `sufficient`/`available` false면 "데이터 부족 — 자사몰 연동 또는 구매 데이터 필요" 캡션.

### Task 6: 러너 연결
**Files:** Modify `utils/full-analysis-runner.ts`
- `import { buildSegmentAnalysis }` 등 + 단계별 호출: step3 세그먼트=`buildSegmentAnalysis(companyId, nowMs)`, step4 다차원, step6 메시지, step7 예측, step8 액션. `nowMs`는 함수 인자(런타임 `new Date()` 호출부에서).
- `renderPerformanceReportPdf(doc, { ...기존, segment, multidim, message, forecast, actionPlan })` — benchmark 제거.
- benchmark 수집(`buildBenchmark`) 호출 삭제.

### Task 7: 벤치마크 죽은 코드 정리 (프론트)
**Files:** Modify `PerformancePage.tsx`
- 벤치마크 모달(`activeModal==='benchmark'`, 현재 1097~) 삭제, `benchmarkSummary`(useMemo) 삭제, `benchmark` state·`buildBenchmark` fetch(load 내) 삭제, `BenchmarkResult` import·`ModalKey`의 `'benchmark'` 삭제.
- tsc로 미사용 잔존 0 확인.

### Task 8: ai.ts report-pdf 정리
**Files:** Modify `routes/ai.ts`
- report-pdf endpoint(1348~1608)는 프론트 호출이 끊겨 미사용. 인라인 PDF 본문(1390~1595)을 `renderPerformanceReportPdf(doc, {...})` 호출로 교체(중복 제거) — 또는 endpoint 통째 제거. **200줄 교체이므로 Read로 정확 경계 확보 후 한 번에**, tsc로 회귀 0 확인. benchmark 제거된 PdfData에 맞출 것.

### Task 9: 통합 검증
- backend `tsc.cmd --noEmit` exit 0, frontend 동일.
- 모든 신규 `.verify.ts` 순수 TDD PASS.
- 자가 grep: 박-단어·모델명·native dialog 0건(신규 영역).
- 목업으로 풀분석 1회 실행 → PDF 생성 + "데이터 부족" 섹션 정상(Harold/배포 후, 코드로는 분기 TDD).

---

## 3. 데이터 소스 (확정)
- customers: recent_purchase_date·purchase_count·total_purchase_amount·ltv_score·avg_order_value·grade·created_at·is_active(기존 47파일 실사용).
- campaigns: send_type·message_type·sent/success·sent_at·estimatedRevenue(snapshot 경유).
- companies: cost_per_sms·cost_per_lms.
- cdp_events: 매출/퍼널/기여 — 붙은 업체 0 → 데이터 부족 분기.

## 4. 배포 (Plan 3 종료 후 한 번에)
```
tp-push "풀분석 프리미엄 보고서 — 비동기 job + 프론트 3모달 + 보고서 10섹션(RFM/다차원/메시지/예측/액션) + AI진단 2단 레이아웃 + 벤치마크 제거"
cd /home/administrator/targetup-app && git pull
cd /home/administrator/targetup-app/packages/backend && npm run build:safe
pm2 restart all
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe
```

## 5. Self-Review 체크
- 모든 섹션 데이터부족 분기 有 / 임의 상수 0
- 벤치마크: PDF 섹션·러너 수집·프론트 모달/state/칩 전부 제거(잔존 grep 0)
- 순수 코어 분리(DB import 0)로 TDD 가능
- 배포는 Plan 1+2+3 한 번에
