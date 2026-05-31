# AI Operator 성과 추정 — 실데이터 분석 전환 설계

> D227+ (2026-05-31). AI Operator 제안서의 "예상 성과"가 전 회사·전 고객 동일 하드코딩(클릭 3% × 전환 0.8% × 객단가 5만원)이라 VIP 1,301명에 "매출 50만원" 같은 비현실 수치를 노출. 돈 내는 AI Operator가 진단값을 못 함 → 실제 DB 분석 기반으로 전환.

## 문제 (확정)

`utils/ai-orchestrator.ts` `calculateCostROI`:
- `expectedClickRate = 0.03`, `expectedConversionRate = 0.008` — 전 회사·전 타겟 동일 고정.
- `avgRevenue = customerStats.avg_total_spent || 50000` — 전체 고객 평균(타겟 무관) 또는 5만원 fallback.
- 결과: VIP(누적구매 수천만원) 타겟인데 객단가 5만원·전환 0.8% 적용 → 50만원. 타겟 등급·실제 객단가·과거 실적 전부 무시.

## 목표

타겟 고객군의 **실제 데이터**로 객단가·전환율을 산출하고, 추정 **근거(basis)**를 화면에 명시한다. 깡통 단일 숫자 → 데이터 분석 결과.

## 기존 자산 (재사용 — 신규 신설 최소화, 실제 시그니처 확인 완료)

- `utils/campaign-response-attribution.ts` `buildCampaignAttribution(companyId, analysisPeriodDays=30)` → `AttributionResult`. **실제 반환** = `{ totalCampaigns, totalSent, totalSuccess, windows[], hasCdpData, ... }`. windows[]는 `{ windowLabel:'24h'|'7d'|'30d', cdpPurchaseCount, cdpRevenue, customerPurchaseCount }`.
  - ⚠️ clickRate/conversionRate 필드는 **없음** → estimator가 raw에서 직접 계산: 전환율 = (windows '7d' cdpPurchaseCount 또는 customerPurchaseCount) ÷ totalSent. 매출/건 = cdpRevenue ÷ totalSent (hasCdpData=true일 때).
- `utils/customer-filter.ts` `buildFilterWhereClauseCompat(filters, startParamIndex)` → `{ sql, params }`. 타겟 객단가 쿼리 WHERE 재사용.
- `customers` 컬럼: `avg_order_value`, `total_purchase_amount`, `purchase_count`, `grade`, `recent_purchase_date`.

## 설계

### 신규 CT — `utils/operator-performance-estimator.ts`

estimatePerformance(input) → { cost, performance, basis }

입력: companyId, filters(타겟 filters), count(검증된 타겟 수), channel, unitCost(채널 단가).
출력:
- cost: { estimated, unitCost, breakdown }
- performance: { expectedClicks, expectedConversions, expectedRevenue, clickRate, conversionRate, avgRevenue, roi }
- basis: { level: 'campaign_actual'|'target_profile'|'low_data', label, confidence: 'high'|'medium'|'low', notes[] }

### 객단가 산출 (타겟 실제값 — 이론 여지 없음)

타겟 filters로 매칭된 customers의 실제 객단가. 우선순위 fallback:
1. AVG(NULLIF(avg_order_value,0)) (채워진 회사)
2. AVG(total_purchase_amount / NULLIF(purchase_count,0)) (avg_order_value 비어있을 때)
3. 둘 다 0이면 전체 고객 평균(customerStats.avg_total_spent), 그래도 0이면 basis.level='low_data'

쿼리는 buildFilterWhereClauseCompat로 타겟 WHERE 재사용 + company_id 격리.

### 전환율 산출 (3단계 우선순위)

1. campaign_actual — buildCampaignAttribution 결과 totalCampaigns >= 1 AND totalSent >= 임계(예: 100):
   - 전환율 = windows '7d' 구매수(hasCdpData면 cdpPurchaseCount, 아니면 customerPurchaseCount) ÷ totalSent. (estimator가 직접 계산 — clickRate/conversionRate 필드 부재)
   - 매출/건 = hasCdpData면 cdpRevenue ÷ totalSent, 아니면 객단가 쿼리값 사용.
   - 클릭률은 별도 실측 없음 → conversionRate 기반 역산 또는 표시 생략(전환·매출 중심). 화면은 전환수·매출·ROI 위주.
   - basis.label = "과거 N개 캠페인 실측 기반", confidence='high'.
2. target_profile — 실적 부족하지만 타겟 객단가·구매성향 데이터 있음:
   - base 전환율에 타겟 우량도 보정. 보정 근거 = 타겟군 실제 지표:
     - 평균 purchase_count 높을수록 상향 (재구매 고객 = 반응 높음)
     - 평균 recent_purchase_date 최근일수록 상향 (활성 고객)
   - 단순 등급 하드코딩(VIP=×3) 금지 — 타겟군 실제 구매빈도/최근성으로 산출.
   - basis.label = "타겟 고객 구매성향 기반 추정", confidence='medium'.
3. low_data — 타겟/회사 데이터 모두 빈약:
   - 보수적 base(clickRate 2%, conversionRate 0.5%) + basis.label="데이터 부족 — 보수적 추정", confidence='low'.

base 계수는 SMS/LMS 마케팅 보수적 하한. campaign_actual 데이터가 쌓이면 자동으로 1단계로 승급되어 base 의존이 사라지는 구조.

### 호출부 교체

- ai-orchestrator.ts orchestrate() + orchestrateWithAI() 양쪽의 calculateCostROI 호출을 estimatePerformance로 교체. filters 전달(이미 targetResult.filters 보유).
- OrchestratorResult.performance에 avgRevenue, roi, basis 추가.
- 기존 calculateCostROI는 다른 소비처 grep 확인 후 제거 또는 흡수.

### 프론트 표기 (AiOperatorPage.tsx)

- "예상 성과" 카드에 basis.label + confidence 배지 표시 (예: "과거 실측 기반 · 신뢰도 높음" / "데이터 부족 · 참고용").
- confidence='low'면 수치를 흐리게 + "데이터가 쌓이면 정확해집니다" 안내. 깡통 숫자 오인 방지.

## 영구 원칙 준수

- feedback_ai_no_arbitrary_benefit — 성과 추정은 분석값(메시지 본문 혜택 생성과 별개). 추정 근거를 과장 없이 사실로 표기.
- no_inline_duplication — DB 조회는 기존 함수 재사용. 추정 로직만 신규 CT 1개.
- db_column_verify_before_code — avg_order_value / total_purchase_amount / purchase_count / recent_purchase_date 4개 컬럼 information_schema 검증 후 쿼리.
- 회사 격리 — 모든 쿼리 company_id 필수.

## 테스트

- ts-node 단독 테스트(백엔드 vitest 부재): 3단계 분기 각각 mock 입력 → 올바른 basis.level + 수치 범위 검증.
- campaign_actual: hasEnoughData=true 시 실제 clickRate 사용 확인.
- low_data: 타겟 0 데이터 시 보수적 base + confidence='low'.

## 범위 밖

- 등급별 정교한 머신러닝 전환 예측(향후). 이번엔 실측 우선 + 구매성향 보정까지.
- 시간대별/채널별 세분 추정(aggregateCampaignPerformance 활용 — 향후).
