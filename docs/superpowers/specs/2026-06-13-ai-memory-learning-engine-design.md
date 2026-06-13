# AI 학습 메모리 — 제대로 학습엔진 설계서 (2026-06-13, Harold 승인)

> 이번 세션 = 설계만. 구현은 다음 세션. 본 문서 = 다음 세션이 그대로 구현할 수준의 상세 설계.

## 0. 배경 — 현재 무엇이 깨져 있나 (코드 실측)

`ai_company_memory` = 자동 5타입(success_pattern / channel_performance / customer_insight / brand_tone_evolution / compliance_learning) + Brand Voice 2타입(representative_message / brand_guideline). AI Operator 프롬프트에만 주입(`buildMemoryPromptContext`, 메인 한줄로AI는 모델 분리로 미사용 / Brand Voice는 `buildSystemPromptWithBrandVoice`로 메인 AI 별도 주입).

자동 writer 실측:
- `recordCampaignLearning` (company-memory.ts) → success_pattern(클릭률 ≥10%) + channel_performance. 호출처 ① `mysql-refund-sweeper.ts:459` — cdp_events 'message_click' 실클릭, 정상 / ② `ai-memory-accumulator-worker.ts:47` — 여정, **clickCount: 0 전달**.
- compliance_learning ← `continuous-operator-policy.ts:99` 1곳.
- customer_insight / brand_tone_evolution ← **자동 writer 0건**(관리자 수동 입력으로만 존재).

확정된 7대 결함:
1. 5타입 중 2타입(customer_insight·brand_tone_evolution) 자동 학습 0 — UI(도넛·빠른 시작 7카드)는 5개 다 노출하지만 2개는 거의 모든 회사에서 빈칸 → "브랜드 톤 진화" 빠른 시작은 항상 "데이터 부족".
2. 여정 학습이 클릭 0 전달 → "클릭률 0.0%" 가짜 channel_performance가 AI 프롬프트 오염 + 여정 success_pattern 미생성.
3. 전환율 항상 0 — cdp 'purchase'/'order' 미연동인데 memoryValue에 "전환율 0.00%" 가짜 노출.
4. company-memory.ts 주석 박-단어 대량 오염 + 일부 예시 문자열 누출.
5. usage_count = ALTER 컬럼(503 안전망) — 운영 미적용 시 overview·top-impact가 503 → 페이지 전체 막힘.
6. legacy CRUD(routes/ai.ts:2020~) ↔ 신규(routes/ai-memory.ts) 중복(overview 2벌·CRUD 2경로).
7. 메모리 수명관리 자동화 0(cleanup 수동만) + success_pattern 캠페인마다 새 키 → 무한 증가 가능.

## 1. 설계 원칙 (영구 룰 준수)

- **정직성**: 모든 메모리는 실데이터로만 채운다. 데이터 없으면 그 타입은 0, UI도 0으로 정직 표시. "0%"·임의 상수·추정치 절대 금지(`feedback_no_arbitrary_constants_use_real_data`).
- **회사 격리**: 전 쿼리 `company_id` 필터.
- **모델 분리**: 메모리 주입 대상은 AI Operator 유지. 메인 한줄로AI 영향 0 (model 분리 룰).
- **임의 혜택 금지**: memory_value에 구체 혜택(%/원/쿠폰) 임의 생성 0.
- **자연 한국어**: 주석·memory_value·UI 문구 박-단어 0, 마케팅 담당자 친화.

## 2. 데이터 소스 (실측 확인 완료)

| 용도 | 소스 | 확인 위치 |
|---|---|---|
| 클릭 | cdp_events `event_name='message_click'`, `properties->>'campaign_id'` / `'journey_id'` | mysql-refund-sweeper.ts:423, results.ts:653 |
| 구매/전환 | cdp_events `event_name IN ('purchase','order')` + campaign-response-attribution.ts | campaign-response-attribution.ts:113, cdp-orders.ts |
| 고객 등급/RFM | customers.grade + total_purchase_amount + purchase_count + ltv_score + cdp_events.customer_id | SCHEMA customers(417·430·432·434) |
| 톤 변화 | brand_guideline memory(memory_key='main') 직전 값 비교 | ai-memory.ts:635 |

> 구현 직전 `properties->>'journey_id'` 실제 키와 cdp_events.customer_id NULL 비율은 information_schema/실측 1건으로 재확인(db_column_verify).

## 3. 설계 — Phase 구성 (다음 세션 작업 순서)

### Phase A — 정직성 수정 (가짜 제거) [가장 먼저]

핵심: 가짜 0%/0.00% 메모리가 이미 AI 프롬프트를 오염 중. 신규 학습 전에 오염원부터 차단.

- **A1. recordCampaignLearning 문구 규칙 변경** (company-memory.ts):
  - 클릭 표본(clickCount 집계 분모) 없으면 success_pattern·channel_performance **기록 안 함**(현재는 채널 성과를 무조건 기록).
  - memory_value 생성 시 값 없는 지표는 문장에서 생략. 전환 데이터 없으면 "전환율" 문구 자체를 빼고 클릭률만. (헬퍼 `composeCampaignLearningText` 순수 함수로 분리 — TDD.)
  - 신규 입력 필드 `hasConversionData: boolean` 추가(없으면 전환 문구 생략).
- **A2. ai-memory-accumulator-worker 여정 실클릭 연결**:
  - journey_executions 집계에 cdp_events 'message_click' (properties.journey_id 매칭) JOIN → 실클릭 수 산출. 실클릭 0이고 표본만 있으면 **기록 보류**(0% 금지).
  - 여정 전환은 campaign-response-attribution(journey_id 경로) 또는 미지원 시 hasConversionData=false.
- **A3. mysql-refund-sweeper conversion 주입**:
  - 현재 `conversion_count: 0` 하드코딩(line 428·468). campaign-response-attribution.ts로 실제 전환 집계 주입 + hasConversionData=true 전달. 전환 0이 진짜 0인지 데이터 없음인지 구분.

### Phase B — 죽은 2타입 살리기 (자동 writer 신설)

- **B1. customer_insight writer** (신규 순수 집계 + 워커):
  - 신규 `utils/ai-memory-customer-insight.ts`: 회사별 customers를 grade로 집계(평균 구매액·구매 빈도·ltv_score) + cdp_events 등급별 클릭/구매 share. 등급별 표본 최소 N(예 30명) 미만이면 그 등급 skip.
  - 순수 함수 `buildCustomerInsights(rows): Insight[]` — 등급별 실측 → 인사이트 문장. 전체 평균 대비 유의미 차이(예 구매액 1.5배+, 클릭 share 상위)만 생성. **임의 상수 0**(임계는 통계적 상대 비교만). TDD 대상.
  - memory_key = `grade_{grade}` 롤링(등급당 1건, UPSERT). 예: "VVIP 등급 — 평균 구매액 ₩N(전체 K배), 최근 30일 클릭 share X%".
  - 주기 = 통합 accumulator 워커 안에서 1일 1회(회사+날짜 멱등).
- **B2. brand_tone_evolution writer** (Brand Voice 변경 추적):
  - ai-memory.ts `extract-guideline` / `update-guideline` UPSERT **직전**에 기존 brand_guideline SELECT → 순수 함수 `diffGuideline(prev, next): ToneChange | null`로 비교(tone_signature 변경 / avg_length ±20%+ / cta_patterns 증감 / emoji_whitelist 변경).
  - 의미 있는 변화면 brand_tone_evolution 메모리 1건 추가(memory_key=`tone_change_{ISO}`, importance 6, source 'ai_auto'). 첫 등록(prev 없음)은 기록 안 함.
  - 예: "브랜드 톤이 '정보/실용'→'친근/캐주얼'로 변화. 평균 길이 245→180자.". 순수 diff = TDD 대상.

### Phase C — 메모리 수명관리 (신호 유지)

- **C1. 타입별 상한 + 자동 정리** (신규 순수 `pickMemoriesToPrune` + 워커):
  - 타입별 최대치(예 success_pattern 50·channel_performance 등급×채널·customer_insight 등급수·compliance 30·brand_tone_evolution 20). 초과 시 (낮은 importance, 오래된 last_accessed, 낮은 usage_count) 순으로 삭제 후보 선정. 순수 함수 TDD.
- **C2. success_pattern 키 통일**:
  - 현재 `${channel}/${campaignName}` → 캠페인마다 신규. 채널·(가능 시)등급 롤링 집계 키로(예 `pattern_${channel}`)로 변경, UPSERT로 누적 갱신. recordCampaignLearning 수정.
- **C3. cleanupDeprecatedMemories 워커 승격**:
  - 통합 accumulator 워커 1일 1회 차수에서 회사별 cleanup(저영향+오래됨) + C1 상한 정리 동시 수행.

### Phase D — usage_count 내성 + ALTER 확정

- ALTER 운영 적용 확인 SQL 제공 → 없으면 `ALTER TABLE ai_company_memory ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;`.
- overview·top-impact를 usage_count 부재에도 핵심 지표는 응답하도록 부분 실패 허용(현재는 503으로 전체 차단). usage_count 관련 정렬·표시만 degrade.

### Phase E — legacy 중복 정리

- routes/ai.ts:1840~ overview + 2020~ CRUD 소비처 전수 grep → 프런트가 신규 routes/ai-memory.ts만 쓰는지 확인 후 기존 경로 제거 또는 신규로 위임. (소비처 남아 있으면 위임만.)

### Phase F — 주석·문구 자연 한국어

- company-memory.ts 전 주석 박-단어 정리(파일 전수 grep 0건) + memory_value 생성 문구(성공 패턴·채널·인사이트·톤 변화) 마케팅 담당자 친화 재작성. ai-memory-accumulator-worker.ts·mysql-refund-sweeper.ts 학습 구간 주석도.

### Phase G — UI 정직성 (AiMemoryPage)

- 5타입 모두 자동 학습되면 도넛·빠른 시작 5종 유지. 각 타입 카드에 "이렇게 쌓여요"(예: 고객 인사이트 = 등급별 반응에서 자동) 한 줄 안내. 빠른 시작 쿼리가 실제 채워지는 타입을 가리키도록 맞춤. 가짜 0% 노출 0.

## 4. 신규/수정 파일 (구현 단위)

신규:
- `utils/ai-memory-customer-insight.ts` — buildCustomerInsights(순수) + 집계 쿼리.
- `utils/ai-memory-text.ts` — composeCampaignLearningText / diffGuideline / pickMemoriesToPrune (순수, TDD 집중).
- `scripts/verify-ai-memory.ts` — 순수 함수 검증(전환 문구 생략·diff·prune·인사이트 임계).

수정:
- `utils/company-memory.ts` — recordCampaignLearning(전환 조건부·키 통일) + cleanup 호출 + 주석 정리.
- `utils/ai-memory-accumulator-worker.ts` — 여정 실클릭 + customer_insight + cleanup 통합.
- `utils/mysql-refund-sweeper.ts` — conversion 실주입.
- `routes/ai-memory.ts` — brand_tone_evolution diff append + usage_count 부분 실패 허용.
- `routes/ai.ts` — legacy 정리.
- `pages/AiMemoryPage.tsx` + `components/AiMemory/*` — UI 정직성.

## 5. DB 변경

- `ai_company_memory.usage_count` ALTER(없을 시). 그 외 신규 컬럼/테이블 없음(brand_tone_evolution 이력은 메모리 자체 row로 누적). 구현 직전 information_schema로 usage_count 존재 확인.

## 6. 검증 계획

- backend tsc 0 / frontend tsc 0.
- `scripts/verify-ai-memory.ts` 순수 검증 GREEN: ① 전환 데이터 없을 때 문구에 "전환율" 미포함 ② diffGuideline 변화 감지/무변화 null ③ pickMemoriesToPrune 상한 초과분만·저신호 우선 ④ buildCustomerInsights 표본 미달 등급 제외·임의 상수 0.
- 자가 grep: 박-단어·모델명·임의 혜택·"0%" 가짜 수치 0건.
- 실측 시나리오(배포 후 Harold/직원): 클릭 있는 캠페인 1건 → success_pattern 생성 확인 / 여정 1건 → 0% 메모리 미생성 확인 / 등급 데이터 회사 → customer_insight 생성 확인 / Brand Voice 가이드라인 변경 → brand_tone_evolution 1건 추가 확인.

## 7. 리스크 / 미해결

- 여정 전환 attribution 경로(journey_id) 미지원이면 B/A2에서 전환은 hasConversionData=false로 정직 생략.
- customer_insight 임계(표본 N·유의미 배수)는 통계적 상대 비교로만 — 임의 상수 금지 원칙을 따름. 구현 시 등급별 실표본으로 재확정.
- legacy 정리는 소비처 잔존 시 제거 대신 위임(파괴적 변경 회피).
