# D217+ AI 메모리 + AI 사용량 강화 — 완벽 설계도

> **작성일**: 2026-05-25 (D216+ 종결 직후)
> **작성자**: Harold + 본 AI (자가 진단 + 영구 룰 정합 흐름)
> **포지셔닝**: 한줄로 AI Operator 마지막 2 메뉴 강화 — 옛 D182 / D210+ Phase 3 B-7 / D208+ Phase B-8 기반 영역 정합 + Journey Builder 동급 디자인 정합
> **분량**: 6~8h (각 메뉴 3~4h)
> **영구 룰 정합**: `marketing_user_ux_priority` + `design_quality_minimum_journey_level` + `cto_mandate_for_vito` + `no_model_name_ui_exposure` + `feedback_ai_no_arbitrary_benefit` + `no_bakkeum_usage` + `db_alter_safety_net`

---

## § 1. 진입 의도 / 포지셔닝

### 1-1. Harold 명시 본질 (2026-05-25)
- "강화 작업 많이 와서 메모리, 사용량 두 개 남았다" — AI Operator 마지막 2 메뉴
- "Journey Builder급 디자인으로 수정하는 건 기본으로 깔고"
- "뭘 어떻게 바꾸면 될지" — 본 AI 본질 강화 방안 도출 의무

### 1-2. 옛 영역 매핑
- **AI 메모리** (`/ai-memory`): D182 mysql-refund-sweeper 자동 학습 + D210+ Phase 3 B-7 (5 타입 가이드 + 영향도 시각화 + 자동 갱신)
- **AI 사용량** (`/ai-usage`): D208+ Phase B-8 (모델별 분포 + 비용 절감 + cache hit rate)

### 1-3. 강화 본질
- 옛 영역 = 단순 통계 표시만 → Journey Builder 동급 (자율 진단 + 자연어 입력 + 빠른 시작 카드 + 5 metric + 차트 + 1-click 액션)
- 마케팅 담당자 영역 = 한 클릭 = 즉시 결과 정합 (옛 D216+ 본질 사고 정정 영역 정합)

---

## § 2. AI 메모리 (`/ai-memory`) 강화 매트릭스

### 2-1. 8 화면 영역

| # | 영역 | 본질 매핑 |
|---|---|---|
| 1 | **상단 sticky 헤더** | Brain icon (10x10 rounded-xl) + BETA badge + violet → fuchsia 그라데이션 + 뒤로가기 → `/ai-operator` |
| 2 | **AI 자율 진단 카드** | violet/fuchsia 그라데이션 + Sparkles 영역 — "회사 메모리 N건 / 마지막 학습 X일 전 / 가장 영향력 큰 메모리 → Y / 5 타입 분포 한 줄 요약" |
| 3 | **자연어 입력 + 빠른 시작 7 카드** | fuchsia/purple/indigo 그라데이션 + Enter 키 → "최근 30일 VIP 영역 = AI 알아낸 영역 무엇?" → `buildMemoryPromptContext` 활용 AI 답변 모달 |
| 4 | **5 메모리 타입 분포 도넛 차트** | success_pattern (rose) / customer_insight (emerald) / brand_tone_evolution (violet) / channel_performance (sky) / compliance_learning (amber) — 호버 시 비율 + 건수 표시 |
| 5 | **영향도 top 10 카드** | usageCount + importance 매핑 (DESC) — 카드 view: memoryType badge + memoryKey + memoryValue (3줄 ellipsis) + 마지막 사용 + 사용 횟수 + 삭제 버튼 (rose) |
| 6 | **1-click 액션 3 카드** | rose: 메모리 정리 (cleanupDeprecated) / emerald: 직접 메모리 추가 (모달 영역) / amber: 5 타입 가이드 모달 |
| 7 | **자세히 분석 토글 (6 차트)** | 타입별 분포 / 월별 누적 (line) / 영향도 분포 (histogram) / 출처별 (campaign_result / manual / ai_auto) / 캠페인 성공률 매핑 (산점도) / 마지막 사용 영역 (시간대) |
| 8 | **Source caption** | "Data source — ai_company_memory + mysql-refund-sweeper 자동 학습 (30초 주기) + 회사 admin 직접 추가" |

### 2-2. 빠른 시작 7 카드 매핑

| # | 시나리오 | 그라데이션 | 본질 |
|---|---|---|---|
| 1 | VIP 패턴 분석 | violet/purple | "VIP 영역 클릭률 가장 높은 채널 + 시점은?" |
| 2 | 휴면 회수 인사이트 | rose/pink | "휴면 90일+ 영역 = 가장 응답 강한 메시지 톤은?" |
| 3 | 채널 성과 비교 | sky/cyan | "LMS / SMS / 알림톡 영역 전환율 차이는?" |
| 4 | 브랜드 톤 진화 | fuchsia/pink | "옛 6개월 영역 = 브랜드 톤 변화 트렌드는?" |
| 5 | 컴플라이언스 학습 | amber/orange | "옛 차단 단어 영역 + 안전 대체 단어 매핑은?" |
| 6 | 직접 메모리 추가 | emerald/teal | 회사 admin 직접 학습 — 모달 (타입 선택 + 키 + 값 + 중요도) |
| 7 | 메모리 정리 | indigo/violet | cleanupDeprecated 영역 — 90일+ 미사용 + importance ≤ 3 영역 자동 정리 |

### 2-3. 옛 백엔드 활용 (이미 존재 — 추가 작성 X)

| 함수 | 영역 | 활용 |
|---|---|---|
| `addMemory(input)` | utils/company-memory.ts | 직접 추가 + 자동 누적 |
| `listMemories(companyId, options)` | utils/company-memory.ts | top 10 + 타입별 분포 |
| `deleteMemory(companyId, memoryId)` | utils/company-memory.ts | 영향도 카드 삭제 |
| `cleanupDeprecatedMemories(companyId, options)` | utils/company-memory.ts | 1-click 정리 |
| `buildMemoryPromptContext(companyId, maxEntries)` | utils/company-memory.ts | 자연어 검색 시 시스템 프롬프트 |
| `recordCampaignLearning(input)` | utils/company-memory.ts | 자동 누적 (옛 mysql-refund-sweeper 호출 영역) |

### 2-4. 신규 endpoint 3건

```typescript
// 1. GET /api/ai-memory/overview — 5 metric + 자율 진단
{
  total_memories: number,
  last_learned_at: string | null,
  top_impact: { memoryKey: string, memoryValue: string, usageCount: number, importance: number } | null,
  type_distribution: { success_pattern: number, customer_insight: number, brand_tone_evolution: number, channel_performance: number, compliance_learning: number },
  recent_30d_added: number,
}

// 2. POST /api/ai-memory/search-natural — 자연어 검색 (AI 호출)
{ query: string } → { answer: string, related_memories: MemoryEntry[] }
// = callAIWithFallback({ model: 'opus', system: buildMemoryPromptContext(...) 활용 })

// 3. GET /api/ai-memory/top-impact — 영향도 top N
{ limit?: number } → { memories: MemoryEntry[] (usageCount DESC, importance DESC) }
```

### 2-5. Frontend 영역 신규/정정

| 파일 | 분량 |
|---|---|
| `pages/AiMemoryPage.tsx` 전면 재작성 | 옛 350~400줄 → 1100~1300줄 |
| `components/AiMemory/AddMemoryModal.tsx` 신설 | 200~250줄 |
| `components/AiMemory/MemoryTypeGuideModal.tsx` 신설 | 150~200줄 |
| `components/AiMemory/TopImpactCard.tsx` 신설 | 100~120줄 |

---

## § 3. AI 사용량 (`/ai-usage`) 강화 매트릭스

### 3-1. 8 화면 영역

| # | 영역 | 본질 매핑 |
|---|---|---|
| 1 | **상단 sticky 헤더** | TrendingUp icon (10x10 rounded-xl) + BETA badge + emerald → cyan 그라데이션 + 뒤로가기 → `/ai-operator` |
| 2 | **AI 자율 진단 카드** | emerald/cyan 그라데이션 — "이번 달 X / Y 호출 (Z%) / 일평균 N call / 예상 한도 도달 W일 후 / 옛 30일 대비 +/-%" |
| 3 | **자연어 입력 + 빠른 시작 5 카드** | "이번 달 가장 비싼 호출 영역 무엇?" / "AI 사용 절감 방법은?" → AI 답변 모달 |
| 4 | **5 metric 요약 + 격차** | 이번 달 호출 / Cache hit rate / Sonnet 호출 / Opus 호출 / Batch 처리 (전월 대비 +/-%) |
| 5 | **AI 비용 예측 라인 차트** | 향후 30일 사용량 + 비용 예측 (선형 회귀) + 한도 영역 시각화 (수평 dashed line) |
| 6 | **1-click 액션 3 카드** | sky: cache 초기화 / violet: Batch 모드 자동 전환 (옛 batch-ai 영역 활용) / amber: 한도 알림 설정 모달 |
| 7 | **자세히 분석 토글 (6 차트)** | 시간대별 (시간×일 히트맵) / 일별 (bar) / 모델별 (도넛) / source별 (orchestrate / refine / journey / dm / ...) / cache hit 추이 (line) / 비용 추이 (area) |
| 8 | **Source caption** | "Data source — ai_call_log + plans.ai_calls_per_month + ai_cache hit rate (5분 TTL)" |

### 3-2. 빠른 시작 5 카드 매핑

| # | 시나리오 | 그라데이션 | 본질 |
|---|---|---|---|
| 1 | 월별 트렌드 | sky/cyan | 옛 6개월 호출 추이 |
| 2 | 모델별 분포 | violet/purple | Sonnet / Opus / GPT-fallback 비율 |
| 3 | 비용 분석 | amber/orange | source별 비용 + Top 10 비용 호출 |
| 4 | 한도 알림 설정 | rose/pink | 임계값 (50% / 80% / 95%) + 알림 채널 |
| 5 | Batch 모드 가이드 | emerald/teal | 옛 batch-ai 영역 (24h SLA + 50% 절감) 활용 가이드 모달 |

### 3-3. 옛 백엔드 활용 (이미 존재 — 추가 작성 X)

| 함수 / 테이블 | 영역 | 활용 |
|---|---|---|
| `ai_call_log` 테이블 | DB | 호출 누적 + 비용 + 모델 + source |
| `checkAiRateLimit(companyId)` | utils/ai-rate-limit | 한도 검증 |
| `getCachedResponse / generateCacheKey` | utils/ai-cache | cache hit |
| `recordAiCall(...)` | utils/ai-rate-limit | 호출 통계 |
| `batch-ai.ts` (D181 영역) | utils | Batch 모드 전환 |
| `getMonthlyUsage(companyId)` | utils/ai-rate-limit | 이번 달 사용량 (★ D215+ 옛 사고 영역 — `c.plan_code` 컬럼 X 사고 → plan_id JOIN 정합 의무) |

### 3-4. 신규 endpoint 4건

```typescript
// 1. GET /api/ai-usage/overview — 5 metric + 자율 진단
{
  monthly_calls: number,
  monthly_limit: number,
  monthly_percent: number,
  daily_avg: number,
  predicted_limit_reached_days: number | null,
  cache_hit_rate: number,
  model_distribution: { sonnet: number, opus: number, gpt: number },
  batch_calls: number,
  prev_month_delta_percent: number,
}

// 2. GET /api/ai-usage/forecast — 향후 30일 예측
{ daily_forecast: Array<{ date: string, predicted_calls: number, predicted_cost: number }> }
// = 옛 30일 데이터 선형 회귀 매핑

// 3. POST /api/ai-usage/search-natural — 자연어 답변
{ query: string } → { answer: string, related_data: Record<string, unknown> }

// 4. POST /api/ai-usage/threshold-alert — 한도 알림 설정
{ threshold_percent: 50 | 80 | 95, channels: Array<'email' | 'sms' | 'inapp'> }
```

### 3-5. Frontend 영역 신규/정정

| 파일 | 분량 |
|---|---|
| `pages/AiUsagePage.tsx` 전면 재작성 | 옛 250~300줄 → 1000~1200줄 |
| `components/AiUsage/ThresholdAlertModal.tsx` 신설 | 180~220줄 |
| `components/AiUsage/BatchModeGuideModal.tsx` 신설 | 150~180줄 |
| `components/AiUsage/CostForecastChart.tsx` 신설 | 200~250줄 |

---

## § 4. DB 영역 정합

### 4-1. 신규 ALTER (옵션 = Harold 결정 영역)

```sql
-- AI 메모리 영역 = 옛 ai_company_memory 영역 정합 (추가 ALTER X)

-- AI 사용량 영역 = 한도 알림 영역 (companies ALTER 1 컬럼)
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ai_usage_threshold_config jsonb DEFAULT '{}'::jsonb;
-- = { threshold_percent: 80, channels: ['email', 'inapp'], last_notified_at: '...' }
```

### 4-2. 옛 사고 영역 동시 정정 의무 (D215+ 옛 영역)

```typescript
// utils/ai-rate-limit.ts 안 getMonthlyUsage 영역
// 옛 사고: SELECT ... FROM companies c WHERE c.plan_code = $1 영역 = `c.plan_code` X 영역
// 정정: companies LEFT JOIN plans p ON c.plan_id = p.id WHERE p.plan_code = $1
```

본 사고 영역 = 옛 D215+ PM2 로그 영역 = `[AiRateLimit] getMonthlyUsage 오류, default 0: column c.plan_code does not exist` 영역 = AI 사용량 메뉴 진입 시점 = silent fallback 0 영역 = 진정 정정 의무 (본 메뉴 강화 직전 동시 정정 정합).

---

## § 5. 영구 룰 정합 검증 매트릭스

| 룰 | 검증 항목 |
|---|---|
| `marketing_user_ux_priority` | 자연어 입력 + 빠른 시작 카드 = 1 클릭 즉시 AI 답변 모달 / 사용자 추가 입력 X / 3 단계+ 영역 0건 |
| `design_quality_minimum_journey_level` | sticky 헤더 + AI 자율 진단 카드 + 빠른 시작 카드 + 5 metric + 차트 + 1-click 액션 + Source caption + 다크 톤 + violet/emerald 액센트 |
| `cto_mandate_for_vito` | 옛 백엔드 영역 (addMemory / listMemories / ai-rate-limit / ai-cache / batch-ai) 정독 의무 / 추측 X / 옛 사고 (`c.plan_code`) 동시 정정 |
| `no_model_name_ui_exposure` | UI 안 Sonnet / Opus / GPT / Claude 단어 0건 — 추상 명칭 ("AI 모델 / 고급 추론 모드 / Batch 처리 모드") 정합 |
| `feedback_ai_no_arbitrary_benefit` | 자연어 답변 시스템 프롬프트 = "구체 혜택 임의 생성 X" 명시 |
| `no_bakkeum_usage` | 박-단어 0건 자가 grep |
| `db_alter_safety_net` | companies ALTER 1 컬럼 활용 endpoint catch = 503 DB_MIGRATION_PENDING 분기 의무 |
| `feedback_no_native_browser_dialog` | ConfirmModal + useToast 의무 |

---

## § 6. 작업 분할 (2 단계)

### 6-1. Step 1 — AI 메모리 (3~4h)
1. DB 정합 = 추가 ALTER X (옛 영역 정합)
2. 신규 endpoint 3건 (routes/ai-memory.ts 신설)
3. AiMemoryPage 전면 재작성 (Journey 동급 8 영역)
4. AddMemoryModal + MemoryTypeGuideModal + TopImpactCard 신설
5. tsc 0 + 자가 grep 0 + 박-단어 / 모델명 / native dialog 0건

### 6-2. Step 2 — AI 사용량 (3~4h)
1. DB ALTER 1 컬럼 (companies.ai_usage_threshold_config)
2. **옛 ai-rate-limit getMonthlyUsage `c.plan_code` 사고 동시 정정**
3. 신규 endpoint 4건 (routes/ai-usage.ts 강화)
4. AiUsagePage 전면 재작성 (Journey 동급 8 영역)
5. ThresholdAlertModal + BatchModeGuideModal + CostForecastChart 신설
6. tsc 0 + 자가 grep 0 + 박-단어 / 모델명 / native dialog 0건

### 6-3. Step 3 — 종결 + 배포
- 통합 tp-push + 서버 빌드
- Codex 이중 검증 (`/codex:adversarial-review`) — DB ALTER + 신규 endpoint 7건 + AI 호출 영역 = Critical

---

## § 7. 다음 세션 진입 명령어 (Harold 직접 복사)

```
docs/superpowers/specs/2026-05-25-ai-memory-usage-redesign-design.md 정독 + status/STATUS.md CURRENT_TASK 정독 + memory/feedback_marketing_user_ux_priority.md 정독 + memory/feedback_design_quality_minimum_journey_level.md 정독 + memory/feedback_cto_mandate_for_vito.md 정독 → D217+ 진입 (AI 메모리 + AI 사용량 강화 / Step 1 AI 메모리 먼저 진행 / 옛 ai-rate-limit `c.plan_code` 사고 동시 정정 의무)
```

---

## 변경 이력

| 날짜 | 변경 | 담당 |
|---|---|---|
| 2026-05-25 | 본 설계서 신설 (D216+ 종결 직후 + Harold 옵션 A 명시) | Harold + 본 AI |
