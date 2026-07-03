# 성과리포트 고객 축(Customer Axis) 고도화 — 설계 문서 (2026-07-03)

> 대상: `packages/backend/src/utils/`(신규 CT + snapshot 확장) + `packages/frontend/src/pages/PerformancePage.tsx`
> 전제: 6/8 전면 재설계(3단 위계+모달+풀분석)는 구현 완료 상태 — 본 문서는 그 위에 "고객 DB 매칭 층"을 추가한다.
> Harold 비전(2026-07-03 확정): "모든 경로의 발송결과가 하나로 묶였으니, 실제 고객 DB 데이터와 매칭해서 보는 것이 성과리포트다."

---

## 0. 오늘 실측 점검에서 확인한 빈 곳 (전부 코드 근거)

1. 이메일 채널 미포함 — snapshot-v2 집계 원천은 campaigns+MySQL 큐뿐. email_campaigns/email_events는 어디에도 안 잡힘.
2. 고객 DB 속성 축 0 — 등급·구매액대별 성과 분해 없음(코호트=가입월 잔존뿐). 발송 전 추정은 등급별인데 사후 리포트는 등급 축 부재(비대칭).
3. attribution = 회사 전체 시간 윈도우 합집합("발송 후 N시간 안 회사 구매") — 수신 고객 매칭 아님. 코드 주석에 "캠페인별 정확 attribution = 다음 phase" 명시.
4. 채널 ROI·Top 캠페인 매출 = 기간 총매출 × 발송량 비중 비례 배분 — 실기여 아님.
5. AI 진단(explain) 입력에 고객 축 데이터 없음 — factors 'audience' 분류가 사실상 빈 칸.

## 1. 데이터 맵 — 채널별 "고객 매칭" 가능 수준 (운영 코드 실측)

| 채널 | 발송 고객 연결 | 반응 데이터 | 매칭 수준 |
|------|--------------|------------|----------|
| 여정 (SMS/MMS/카카오) | journey_step_logs(status='sent', sent_at) → journey_executions.customer_id | cdp_events.customer_id (구매) | 정확 (customer_id) |
| DM | dm_recipient_tokens(dm_id, customer_id, created_at) | dm_views(recipient_token → 열람·scroll) + cdp_events | 정확 (customer_id) |
| 이메일 | 발송 명단 미보존(email_campaigns 집계만) | email_events(email 키, open/click) → customers.email 조인 | 반응자만 정확 |
| SMS/LMS/MMS/KAKAO 직접·AI 캠페인 | campaign_send_staging 휘발 — 명단 미보존 | MySQL 결과(성공/실패) | 등급 근사(campaigns.target_filter — grade-conversion-stats 패턴) + 시간 윈도우 |

핵심: 여정·DM은 이번 학습 루프·추적 작업으로 customer_id 1급 연결이 생겼다. 이것이 "지금 가능해진" 이유.

## 2. 구현 범위 (v1 — 정답 1개)

### A. 신규 CT `utils/performance-customer-axis.ts`
1. `buildGradePerformance(companyId, days)` — 등급 × 성과 표:
   - 여정 발송: journey_step_logs ⨝ journey_executions ⨝ customers.grade (정확)
   - DM 발송·열람: dm_recipient_tokens ⨝ customers.grade + dm_views 열람자 (정확)
   - 이메일 반응: email_events(open/click) ⨝ customers.email ⨝ grade (반응자 기준)
   - SMS 캠페인 발송: target_filter grade 매칭 캠페인 발송합 (근사 — grade-conversion-stats 패턴 재사용)
   - 구매·매출: cdp_events(purchase/order, 기간) ⨝ customers.grade
   - 반환 행: { grade, sentExact, sentApprox, dmViews, emailClicks, buyers, revenue } + 원천 라벨(정확/근사)
2. `buildRecipientAttribution(companyId, days)` — 수신 고객 기준 정밀 기여:
   - 수신 고객 집합 = 여정 수신(customer_id) ∪ DM 수신(customer_id) — 기간 내
   - 그 집합 ∩ cdp_events purchase (수신 시각 후 24h/7d/30d 윈도우) → 구매 고객수·매출
   - 기존 시간 윈도우 attribution은 "전체 캠페인(시간 기준)"으로 병기 유지 — SMS 커버용

### B. snapshot-v2 채널 커버리지 확장 (`next-action-advisor.ts`)
- byChannelROI에 EMAIL 행 추가: email_campaigns 기간 SUM(sent_count/open_count/click_count). 비용 0(이메일 발송 무료 정책) → roas 표기는 프론트에서 "무료" 처리.
- byChannelROI에 DM 행 추가: dm_recipient_tokens 발급수(발송) + dm_views 열람자수(반응). campaigns의 "DM 발송 ·" SMS분과 이중 계상 주의 — DM 행은 "DM 열람 성과"로 별도 축(문자 발송분은 기존 SMS 행 유지).
- 기존 필드 전부 보존(추가만) — 회귀 0.

### C. 신규 endpoint `GET /operator/performance/customer-axis?period=`
- 반환 = { gradePerformance, recipientAttribution }. 모달 열 때 lazy load.
- D231 교훈 준수: snapshot-v2에 무거운 조인을 얹지 않는다. 별도 endpoint + 실패 graceful(모달만 영향).

### D. AI 진단(explain) 입력 보강 (`performance-explainer.ts`)
- userMessage에 ① 등급 성과 상위/하위 라인 ② EMAIL·DM 채널 성과 라인 추가 → 'audience' factors 실동작.
- snapshot 파라미터 시그니처 불변(추가 인자 옵셔널) — 기존 호출부 회귀 0.

### E. Frontend `PerformancePage.tsx`
- Tier 2 요약 바에 "고객 등급" 칩 추가 → GradeModal(등급 × 성과 표 + 원천 라벨 + source caption).
- 매출·기여 모달에 "수신 고객 기준(정확)" 블록 추가 — 기존 시간 윈도우 표와 병기.
- 채널 ROI 모달: EMAIL·DM 행은 byChannelROI 배열로 자동 렌더(비용 0 채널 roas 표기만 분기).
- PDF(`performance-pdf-render.ts`): 등급 성과 절 추가.
- 영구 룰: 다크+violet, 모델명 0, native dialog 0, source caption, 모바일 반응형.

## 3. 성능·안전 가드

- customer-axis 쿼리는 전부 company_id 격리 + 기간 필터(인덱스 컬럼: occurred_at/sent_at/created_at). self-join 금지(D231).
- 요청 경로 동기 대량 정제 금지 — 집계 SELECT만. 실패 시 해당 모달만 빈 상태(graceful).
- 크레딧 변경 없음: 화면 조회 무료 현행 유지. PDF/풀분석 300 현행 유지.
- 이중 계상 방지: DM 채널 행은 열람 축(발송 문자분은 SMS 행에 이미 존재)임을 라벨로 명시.

## 4. 구현 전 information_schema 검증 대상 (db_column_verify_before_code)

신규 SQL에 들어갈 테이블·컬럼 — Harold 실행 결과 확인 후 코드 작성:
- journey_executions(customer_id, journey_id) / journey_step_logs(execution_id, campaign_id, sent_at, status, cost)
- dm_recipient_tokens(token, dm_id, customer_id, company_id, created_at) / dm_views(recipient_token, dm_id?, created_at?)
- email_campaigns(company_id, sent_at, sent_count, open_count, click_count) / email_events(campaign_id, email, event_type, occurred_at)
- cdp_events(customer_id, event_name, occurred_at, properties) / customers(grade, email) — 기존 검증 완료(grade CT 헤더 기록)

## 5. 검증 계획

- backend tsc 0 + frontend tsc 0.
- 자가 grep: 모델명 0 / native dialog 0 / 박-단어 0.
- 실측 1건 시나리오(배포 후 Harold): ① DM 1건 발송·열람 → 고객 등급 모달에 해당 등급 DM 열람 1 반영 ② customer-axis 응답 200 + gradePerformance 행 존재 ③ 채널 ROI 모달에 EMAIL 행(이메일 발송 이력 회사) 표시.
- 회귀 확인: snapshot-v2 기존 필드 diff 0(추가만), 발송·돈 경로 0줄 변경.

## 6. 구현 순서

1. Harold information_schema 검증 결과 확인
2. performance-customer-axis.ts CT + verify 테스트(순수 부분)
3. customer-axis endpoint + snapshot-v2 EMAIL/DM 행
4. explainer 입력 보강
5. PerformancePage 칩+모달 2곳 + PDF 절
6. tsc + 자가 grep + 보고
