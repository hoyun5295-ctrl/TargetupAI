# AI Operator — Step 0 진행 추적 (D170~D174 · 2026-05-19 기준)

> 한줄로AI Braze급 SaaS 고도화 — Step 0 (D163~D174) 누적 작업 내역 + 잔여 작업.
> 매 세션 시작 시 이 문서 정독 → 잔여 작업 진입.
> ★ **공식 기능 정의서:** [`docs/AI_OPERATOR_기능정의서.md`](../docs/AI_OPERATOR_기능정의서.md) — 살아있는 문서 (현재 박힌 기능). 신규 기능/변경/영구 원칙은 본 정의서 § 13 변경 이력에 박음. 사외 소개서(.docx)는 본 정의서를 그대로 변환.
> ★ **BEYOND BRAZE 비전:** [`docs/한줄로_BEYOND_BRAZE_비전.md`](../docs/한줄로_BEYOND_BRAZE_비전.md) — 체어맨 + CTO 전용 살아있는 비전 문서 (대외 공개 X). Manifesto + 영구 원칙 5건 + 8축 차별화 + Continuous Operator + 음성 AI + 5년 시야 + 압축 로드맵 D176~D200. **압축 로드맵 진입 시 본 문서 정독 필수.**
> 상세 메모리: `memory/project_d162_5_braze_grade_roadmap_kickoff.md` + `memory/feedback_ai_operator_model_isolation.md` + `memory/project_d172_cdp_kickoff.md` + `memory/project_d173_d174_provider_and_next_action.md`

---

## 🟢 완료 현황 매트릭스

| Phase | 핵심 | 상태 | 배포 |
|-------|------|------|------|
| **D163** | 베타 안내 시스템 인프라 (헤더 메뉴 + BetaFeatureModal + isBetaAccessAllowed + AiOperatorPage placeholder + /ai-operator 라우트) | ✓ 완료 | ✓ |
| **D164** | AI Operator 통합 제안서 endpoint + Hero/Pipeline/Result 6 카드 | ✓ 완료 | ✓ |
| **D165** | 결과 카드 정합 강화 (메시지 3안 토글 + 성과 차트 + 비용 breakdown + 다듬기 + (광고) 미리보기 + body 단일 필드 fix) | ✓ 완료 | ✓ |
| **D166** | 승인→발송 (preview-recipients + /direct-send 2-step + 결과 모달) + **발송 시점 안전장치 (sendMode 3분기 + datetime input + confirm)** | ✓ 완료 | ✓ |
| **D167** | Prompt Caching (callAIWithFallback system cache_control ephemeral + hit/miss 로그) | ✓ 완료 | ✓ |
| **D168** | Tool Use SQL Loop 정신 (countFilteredCustomers 검증 — AI 추정 → DB 실제) | ✓ 완료 | ✓ |
| **D169** | Extended Thinking 옵션 (callAIWithFallback thinking 옵션 + Opus 4.7 adaptive 호환) | ✓ 완료 | ✓ |
| **D170** | Multi-Agent Orchestrator (ai-orchestrator.ts 신설 + 6 Sub-agent + 회사별 메모리 컨텍스트 + Compliance UI) | ✓ 완료 | ✓ |
| **D170+** | Harold 명시 정합 fix 누적 (모델 분리 + Opus 4.7 breaking changes + GPT 5.5 + UI 모델명 제거 + 발송 시점 안전장치 + CSS warning) | ✓ 완료 | ✓ |
| **D171 (A)** | SESSION_MILESTONES 데이터 갱신 (AiOperatorPage L148-158, D163~D170 done / D171 next) | ✓ 완료 | 빌드 대기 |
| **D171 (B)** | **Zero-Count Auto-Relax 영구 제거** (Harold 명시 — 타겟 정합성 100%, 0건 = 발송 차단). orchestrator/routes/ai.ts/services/ai.ts/saved-segments/AiSendTypeModal/Dashboard/RecommendTemplateModal/AutoSendFormModal 9 파일 통합 정정 | ✓ 완료 | 빌드 대기 |
| **D171 (C)** | ENTERPRISE 베타 운영 진입 가이드 (본 문서 § "ENTERPRISE 베타 운영 진입") | ✓ 완료 | 문서 |
| **D171 (D)** | **진정 Orchestrator AI (Opus 4.7 Tool Use) 활성** — `orchestrateWithAI()` 신설 (4 sub-agent tool + Loop max 8 + per-tool max 2 + 실패 시 `orchestrate()` fallback + Zero-Count system 프롬프트 강제) + `routes/ai.ts` env flag 분기 (`AI_OPERATOR_USE_AI_DECISION=true`) | ✓ 완료 | 빌드 대기 |
| **D172** | **한줄로 CDP — 자사몰 → 한줄로 sync 표준 인프라.** SCHEMA cdp 컬럼 + 5 신규 테이블 + utils CT 5종(cdp-auth/cdp-identity/cdp-events/cdp-orders/cafe24-client) + routes/cdp.ts 7 endpoint + routes/cafe24.ts OAuth+Webhook + plan-guard ai_cdp + CdpSettingsPage + DashboardHeader 자사몰연동 메뉴 + `@hanjullo/sdk` 패키지 신설 | ✓ 완료 | 빌드 + DB SQL 10건 + 환경변수 3건 대기 |
| **D173** | **Provider Adapter 일반화 (자사몰 종합 세트)** Harold "다양한 자사몰 종합 대응" 정합. utils/provider-registry.ts (CT-24 IProviderAdapter base + Registry + Skeleton 5종 Shopify/메이크샵/imweb/식스샵/WooCommerce) + cafe24Adapter 박음 + routes/cafe24 위임(단일 진실) + GET /api/cdp/providers + CdpSettingsPage Provider 매트릭스 카드 | ✓ 완료 | 빌드 대기 |
| **D174** | **Step 1 Next Action Advisor 핵심 ("1회성 발송툴 탈출")** utils/next-action-advisor.ts (CT-25 buildPerformanceSnapshot + recommendNextAction Opus 4.7) + POST /api/ai/operator/next-action + PerformancePage(30일 성과 + AI 추천 + AI Operator prefill 흐름) + 성과리포트 메뉴 + /performance 라우트 | ✓ 완료 | 빌드 대기 |
| **D175** | **공식 기능 정의서** `docs/AI_OPERATOR_기능정의서.md` (v1.0.4, 살아있는 문서) + CLAUDE.md 필수 참조 매트릭스 박음 + ai_operator_progress.md 정의서 연결 | ✓ 완료 | 문서 |
| **D175-A** | **Web Push + In-app Message 채널 (SDK 확장)** Harold 명시 + 영업팀장 의견 정합. 4 테이블 + utils CT-26 web-push(VAPID) + CT-27 inapp-message + routes 9 endpoint + SDK v0.2.0(push/inapp/service-worker 3 모듈) + PushCampaignsPage + InAppMessagesPage + 메뉴 2건. 환경변수 3건 VAPID_* + web-push 패키지 | ✓ 완료 | 빌드 + DB SQL 4건 + 환경변수 + npm install 대기 |
| **D175-B** | **BEYOND BRAZE 비전 문서 신설** Harold 명시 "글로벌 최강 마테크 + 압도적 AI Operator + 누구도 못 따라하는 솔루션". docs/한줄로_BEYOND_BRAZE_비전.md v0.1 (12 섹션 Manifesto + 영구 원칙 + Braze 분석 + 8축 차별화 + Continuous Operator 사용자 동의 흐름 + 음성 AI 정직 분석 + 압축 로드맵 + 5년 시야 + KPI) | ✓ 완료 | 문서 |
| **D176** | **Continuous Agentic Operator (사용자 동의 흐름)** 비전 압축 로드맵 1순위 박힘. DB 2 테이블 + companies ALTER 3 + utils CT-28(Zero-Count 영구 원칙 정합 + ENT 자동 실행 임계값 + 5분 worker) + routes 7 endpoint + ContinuousOperatorPage(2 탭) + 메뉴 + 라우트. AI 단독 실행 X 영구 원칙 100% 정합 | ✓ 완료 | DB SQL 박힘 종결 |
| **D177-fix** | AiOperatorPage SESSION_MILESTONES + 진행률 카드 + 9 세션 로드맵 영구 제거. 영구 원칙 #6 미래 로드맵 노출 X 박음 | ✓ 완료 | 배포 종결 |
| **D177-ux** | DashboardHeader dropdown UI (1차 박음, ux2에서 영구 제거) | ✓ 완료 → ux2 정정 | — |
| **D177-ux2** | dropdown 영구 제거 + AiOperatorPage 안 SUB_MODULE_CARDS 5건 박음 (함께 사용하는 AI 영역 섹션) | ✓ 완료 | 배포 종결 |
| **D177-ux3** | sub-module 페이지 뒤로가기 5건 navigate('/ai-operator') 일괄 정정 + 영구 원칙 #7 박음 (feedback_sub_module_back_navigation) | ✓ 완료 | 빌드 대기 (frontend만 변경) |
| **D178 Track A-1** | **자체 호스팅 자사몰 (Harold 명시 우선)** utils/custom-self-hosted-adapter.ts CT-29 + HMAC-SHA256 hex/base64 검증 + identifyCustomer/syncOrder/trackEvent 표준 + issueCustomWebhookSecret + routes/cdp.ts /webhook/custom + 회사 admin endpoint 3건 + CdpSettingsPage 카드(secret 1회 노출 + Node.js 코드 샘플) | ✓ 완료 | 빌드 + 운영 검증 대기 |
| **D178 Track A-2** | **네이버 스마트스토어 (Harold 명시 우선)** utils/naver-commerce-client.ts CT-30 + Naver Commerce API OAuth + Webhook + naverSmartStoreAdapter + routes/naver-commerce.ts(cafe24 미러) + CdpSettingsPage 카드. 환경변수 3건 NAVER_COMMERCE_CLIENT_ID/SECRET/REDIRECT_URI | ✓ 완료 | 빌드 + 환경변수 + 운영 검증 대기 |
| **D177 Self-Optimizing** | utils/bandit-optimizer.ts CT-31 Thompson Sampling(Beta-Bernoulli + Marsaglia-Tsang Gamma sample + cold start explore + operator 누적 학습) + DB operator_proposal_variants 테이블 + continuous-operator 확장(generateProposal에서 insertProposalVariants) + routes/ai.ts variants endpoint 2건 + ContinuousOperatorPage variant 매트릭스(Bandit 추천 강조 + reasoning) | ✓ 완료 | 빌드 + DB SQL 1건 대기 |
| **D178 음성 AI** | utils/naver-clova-client.ts CT-32(Clova Speech STT + Voice TTS) + utils/voice-inbound.ts CT-33(handleInboundCall + CDP 매칭 + Opus 4.7 + TTS + DB 저장) + DB voice_inbound_calls + companies ALTER voice_inbound_enabled + routes/voice.ts + VoiceInboundPage(토글 + 영구 원칙 안내 + 통화 이력 + 트랜스크립트 사후 확인) | ✓ 완료 | 빌드 + DB SQL 1건 + ALTER + 환경변수 4건(Clova) + VOICE_WEBHOOK_SECRET 대기 |
| **D179 Multi-Goal** | utils/multi-goal-decisioning.ts CT-34(analyzeGoalConflicts — Opus 4.7 충돌 분석 + sub_plans + conflict_matrix + recommended_order + 가중치 자동 정규화 + AI 실패 시 fallback) + routes/ai.ts POST /api/ai/operator/multi-goal/analyze | ✓ 완료 | 빌드 대기 |
| **D180 Email** | utils/sendgrid-client.ts CT-35(native fetch SendGrid Web API v3 + tracking) + utils/email-channel.ts CT-36(campaign CRUD + send + Zero-Count + 광고성 (광고) prefix + 무료거부 자동 + 1,000건 batch) + DB email_campaigns/events 2 테이블 + routes/email.ts(webhook + admin 4건) + EmailCampaignsPage | ✓ 완료 | 빌드 + DB SQL 2건 + 환경변수 3건(SENDGRID_*) 대기 |
| **AiOperatorPage SUB_MODULE_CARDS** | 5→7건 박음 (음성 AI + Email 카드 추가) + import Mail/Phone | ✓ 완료 | 빌드 대기 |
| **App.tsx 라우트** | /voice-inbound + /email-campaigns 2건 추가 (BUSINESS+ 회사 admin) | ✓ 완료 | 빌드 대기 |
| **운영 DB schema** | D172/D172-B/D175-A/D176 운영 SQL 17건 Harold 직접 박힘 종결 (11 테이블 + 6 companies 컬럼 + 2 plans 컬럼 검증 정합) | ✓ 박힘 종결 | — |
| **D178~D180 신규 DB schema** | operator_proposal_variants 1 + voice_inbound_calls 1 + email_campaigns 1 + email_events 1 = **4 신규 테이블** + companies ALTER voice_inbound_enabled 1 컬럼 = SQL 5건 박음 | ⏸ Harold 직접 박을 영역 | SQL 5건 + 환경변수 박힌 후 진입 |
| **D178 hoyun 박음 게이팅** | utils/plan-guard.ts isAiOperatorAllowed 박음 + routes/ai.ts 5건 정정 + GET /operator/access endpoint + Dashboard.tsx onAiOperatorClick 박음. ENV `AI_OPERATOR_ALLOWED_USERS=hoyun` 박힘 시 hoyun만 진입, 그 외 모두 BetaFeatureModal | ✓ 완료 + 배포 + .env 박음 종결 (Harold 직접) | — |
| **D181 #1 D179 Frontend UI** | ContinuousOperatorPage 다중 목표 modal + analyze + sub_plans + conflict_matrix + recommended_order UI 박음 + 가중치 자동 정규화 + 헤더 버튼 박음 | ✓ 완료 | 빌드 대기 (frontend만 변경) |
| **D181 #2 Anthropic Memory tool 패턴** | utils/company-memory.ts CT-37(5 메모리 타입 + addMemory/listMemories/buildMemoryPromptContext/recordCampaignLearning) + DB ai_company_memory 테이블 + ai-orchestrator.ts buildCompanyMemoryContext에 박음 + routes/ai.ts 회사 admin endpoint 3건 | ✓ 완료 | 빌드 + DB SQL 1건 박음 대기 |
| **D181 #3 Anthropic Batch API** | utils/batch-ai.ts CT-38(submitBatch + pollBatch + getBatchResults + listBatchJobs Anthropic native) + DB ai_batch_jobs 테이블 + routes/ai.ts /operator/batches endpoint 2건. **대량 발송 50% 비용 절감** | ✓ 완료 | 빌드 + DB SQL 1건 박음 대기 |
| **D181 #4 Anthropic Citations** | utils/citations.ts CT-39(buildCompanyDocuments 4 document + callAIWithCitations Opus 4.7 native citations.enabled) + routes/ai.ts /operator/explain endpoint. **사용자 신뢰 #4 본질 박음** | ✓ 완료 | 빌드 대기 (DB 박지 X) |
| **D181 신규 DB schema** | ai_company_memory 1 + ai_batch_jobs 1 = **2 신규 테이블** | ⏸ Harold 직접 박을 영역 | SQL 2건 박힌 후 진입 |
| **D182 직원 신고 fix 3건** | (1) 보관함 메시지 짤림 — Dashboard 모달 expandedTemplateIds + 전문 보기 토글. (2) 선불 타임아웃 환불 사고 — campaign-lifecycle 30→120분 + mysql-refund-sweeper reverseTimeoutRefundIfRecovered idempotent 함수. (3) 패스워드 초기화 SMS 라인 — admin.ts + manage-users.ts getTestSmsTables() 사용 | ✓ 완료 + 배포 종결 | Harold 직접 보전 SQL 86.9원만 남음 |
| **D182 Phase 1 UI 활성** | AiMemoryPage(/ai-memory 5 타입 + 직접 입력) + AiBatchesPage(/ai-batches 통계 + manual poll) + AiExplainPage(/ai-explain Citations + 예시 질문 4건) + App.tsx 3 라우트 + AiOperatorPage SUB_MODULE_CARDS 7→11건(모바일DM + 메모리 + 질문 + Batch) | ✓ 완료 + 배포 종결 | — |
| **D182 자동 학습 cron** | mysql-refund-sweeper에 accumulateCampaignLearning() 추가 — 30초 주기 + 24h 윈도우 + sent_count≥10 + metadata.campaign_id idempotent. ai_company_memory 자동 누적 → 영구 원칙 #6 "시간 지날수록 정확도↑" 본질 활성 | ✓ 완료 + 배포 종결 | — |
| **D182 모바일DM 영역 정리** | DashboardHeader 메뉴 영구 제거 + AiOperatorPage SUB_MODULE_CARDS 카드 추가 + DmBuilderPage 뒤로가기 3곳 navigate('/ai-operator') | ✓ 완료 + 배포 종결 | — |

---

## 📁 박힌 파일 영역 (D163~D170+)

### Backend
- `packages/backend/src/config/defaults.ts` — AI_MODELS 4분리(claude/opus/gpt/gptOperator)
- `packages/backend/src/utils/plan-guard.ts` — `isBetaAccessAllowed` 신설 (CT-17)
- `packages/backend/src/services/ai.ts` — `callAIWithFallback` model 옵션(sonnet/opus) + Opus 4.7 breaking changes 분기(temperature/thinking) + Prompt Caching + Extended Thinking + GPT-5.5 fallback temperature 박지 X / `generateMessages` extraContext.model / `recommendTarget` options.model
- `packages/backend/src/services/ai-orchestrator.ts` (D170 신설, D171-B/D 갱신) — `orchestrate` + `checkCompliance` + `buildCompanyMemoryContext` + `calculateCostROI` + Sub-agent 5종 분리. **D171-B Zero-Count 정책: 0건 매칭 시 자동완화 박지 X**. **D171-D `orchestrateWithAI()` 신설 — Anthropic Tool Use 기반 진정 multi-agent loop (Opus 4.7 + 4 sub-agent tool + Loop max 8 + per-tool max 2 + 실패 시 `orchestrate()` 자동 fallback + Zero-Count system 프롬프트 강제)**
- `packages/backend/src/routes/ai.ts` — `POST /api/ai/operator/propose` (orchestrate 호출) + `POST /api/ai/operator/preview-recipients` (recipients 조회 + default callback) + **D171-B `recommend-target` auto-relax 블록 + 응답 메타 3건 영구 제거 + `relaxFilters` import 제거** + **D171-D env flag `AI_OPERATOR_USE_AI_DECISION=true` 시 `orchestrateWithAI` 진입 분기**
- `packages/backend/src/services/ai.ts` — **D171-B `relaxFilters` 함수 본체 + `RelaxFiltersResult` 인터페이스 영구 삭제 (dead code 차단)**
- `packages/backend/src/utils/saved-segments.ts` + `routes/saved-segments.ts` — **D171-B `autoRelax` 인터페이스/파라미터 영구 제거 (DB 컬럼 보존 + 항상 false 박음)**
- `packages/backend/src/utils/plan-guard.ts` — D171-B `ai_premium` feature 주석에서 "auto-relax" 표현 영구 제거

### Frontend
- `packages/frontend/src/App.tsx` — `/ai-operator` 라우트
- `packages/frontend/src/components/BetaFeatureModal.tsx` (신규) — 그라데이션 모달 + 7 엔진 카드
- `packages/frontend/src/components/DashboardHeader.tsx` — "AI Operator" 메뉴 + BETA 뱃지 + beta 컬러
- `packages/frontend/src/pages/Dashboard.tsx` — BetaFeatureModal state + onAiOperatorClick 게이팅
- `packages/frontend/src/pages/AiOperatorPage.tsx` — Hero 입력창 + Multi-Agent Pipeline Loading + 결과 6 카드 + 메시지 3안 토글 + 성과 차트 + 비용 breakdown + AiRefineModal 통합 + (광고)/무료거부 자동 합성 + sendMode 라디오 + datetime input + 안전장치 + **SESSION_MILESTONES D163~D170 done / D171 next (D171-A)**
- `packages/frontend/src/utils/formatDate.ts` — 주석 정규식 텍스트 자연어화 (CSS minify warning 차단)
- `packages/frontend/src/components/AiSendTypeModal.tsx` — **D171-B `autoRelax` state + 자동조건완화 토글 UI 영구 제거 + onSelectHanjullo 시그니처 단순화 (`aiPremiumEnabled` prop 제거)**
- `packages/frontend/src/pages/Dashboard.tsx` — **D171-B `lastSendConfig.autoRelax` 필드 + `handleAiCampaignGenerate` autoRelax 파라미터 + AiSendTypeModal/RecommendTemplateModal 콜백 autoRelax 인자 + saved-segments POST body `autoRelax` 영구 제거**
- `packages/frontend/src/components/RecommendTemplateModal.tsx` — **D171-B `onSelectHanjullo` autoRelax 인자 + `handleSelect` 전달 인자 제거** (SavedSegment.auto_relax DB select 매핑은 보존)
- `packages/frontend/src/components/AutoSendFormModal.tsx` — **D171-B `auto_relax: false` body 박지 X (서버 측에서 자체 차단)**
- `packages/frontend/src/pages/CdpSettingsPage.tsx` + `PerformancePage.tsx` + `ContinuousOperatorPage.tsx` + `PushCampaignsPage.tsx` + `InAppMessagesPage.tsx` — **D177-ux3 ArrowLeft onClick navigate('/') → navigate('/ai-operator') 일괄 정정 (영구 원칙 #7 정합)**
- `packages/frontend/src/pages/AiOperatorPage.tsx` — **D177-ux2 SUB_MODULE_CARDS 5건 + "함께 사용하는 AI 영역" 섹션 박음 (7 엔진 카드 위)**
- `packages/frontend/src/components/DashboardHeader.tsx` — **D177-ux/ux2 dropdown 박힘 → 영구 제거 (AI Operator 메뉴만 박음, sub-module은 페이지 안에 박힘)**

### 메모리 (Harold 영구 정합)
- `memory/project_d162_5_braze_grade_roadmap_kickoff.md` — Step 0 로드맵 + 9 세션 분할
- `memory/feedback_ai_operator_model_isolation.md` — 모델 절대 분리 룰 (Opus 4.7 vs Sonnet 4.6)
- `memory/feedback_jondaetmal_to_harold.md` — 존댓말 룰

---

## 🔧 Harold 명시 정합 룰 (D170+ 누적)

### 모델 영역 절대 분리 (혼용 시 6,000사+ 영향 사고)

| 영역 | Claude 모델 | GPT fallback | temperature |
|------|------------|--------------|-------------|
| **AI Operator 신메뉴** (Target/Message/Compliance) | **Opus 4.7** (`claude-opus-4-7`) | **GPT 5.5** (`gpt-5.5`) | 박지 X (둘 다 default 1만 지원) |
| **기존 한줄로AI 전체** (refine/generate/recommend-target/parse-briefing) | **Sonnet 4.6** (`claude-sonnet-4-6`) | **gpt-5.4-mini** | 그대로 박음 |

### Opus 4.7 Breaking Changes 정합 (callAIWithFallback)

- `temperature`/`top_p`/`top_k` 박으면 400 error → Opus 호출 시 박지 X
- `thinking.type: 'enabled' + budget_tokens` 박으면 400 → `adaptive` 박음
- Adaptive thinking은 off by default

### 발송 시점 안전장치 (D170+ Harold 명시)

- `sendMode`: `'aiRecommended'` | `'immediate'` | `'custom'`
- 안전장치: 미래 1분+ / 08:00~21:00 KST / 즉시 발송 confirm 모달
- AI 추천 시점 자동 예약 (미래 시점이면) / 과거 시점은 즉시 발송 + confirm

### UI 정합

- 모델명 사용자 노출 금지 (Compliance 카드에 "HAIKU 4.5" / "Opus 4.7" 박지 X)
- 어색한 구어체 금지 ("어마어마한" 등 → "AI Marketing Operations" 톤)
- Compliance Check 통과/경고만 표시 (모델명 태그 X)

### 타겟 정합성 100% (D171 Harold 명시 영구 원칙)

- 타겟 매칭 0건 시 자동완화(relaxFilters / auto-relax) 절대 금지 — 발송 차단이 정합
- AI가 임의로 조건 풀어서 다른 고객에게 발송 = 마케팅 의도 파괴 + 정보통신망법 위험 + 수신자 권리 침해 + 발신번호 차단 위험
- 0건 응답 시 사용자에게 "조건을 조정해주세요" 안내만 박고, AI 재추천 X
- `orchestrateWithAI()` system 프롬프트에 영구 강제 명시 + `count_verification` tool 결과에 0건 warning 박음
- 메모리: `memory/feedback_no_target_auto_relax.md` 영구 박힘

### Orchestrator AI Tool Use 운영 (D171-D)

- env flag `AI_OPERATOR_USE_AI_DECISION=true` 시 `orchestrateWithAI()` 진입 (default false)
- Loop max 8 iteration / per-tool max 2 호출 / max_tokens 4096 / 실패 시 `orchestrate()` 자동 fallback (응답 인터페이스 호환)
- `OrchestratorResult.meta.usedAIDecision: true` + `meta.aiDecisionTrace[]` (iteration/tool/inputSummary/durationMs) PM2 로그에 박음
- 운영 진입 순서:
  1. ENT 베타 진입 회사 대상 env flag false 유지 (기존 `orchestrate` 검증)
  2. 안정성 확인 후 1사 한정 `AI_OPERATOR_USE_AI_DECISION=true` 박음 + `meta.aiDecisionTrace` PM2 로그 모니터링
  3. 비교 분석 (orchestrate vs orchestrateWithAI): tool 호출 패턴 / 비용 / latency / Compliance 통과율
  4. 안정성 검증 시 ENT 전체 default true 진입 (Step 1+ 진입과 함께)

---

## ⏸ 잔여 작업 (다음 세션 진입 영역)

> Step 0 D163~D177-ux3 전체 종결 + 운영 DB schema 박힘 종결 + 비전 v0.3 박힘. 다음 세션은 운영 환경 사용 검증 + D177~D180 압축 로드맵 진입.

### 1순위 — 운영 환경 사용 검증 (Harold 명시 "사용하면서 디버그" 정합)

| 영역 | Harold 검증 위치 |
|------|----------------|
| AI Operator + Continuous Operator + 성과리포트 + CDP + Web Push + In-app | `/ai-operator` 진입 → SUB_MODULE_CARDS 5건 차례 진입 |
| 운영 환경 노출 본 후 디자인 정정 결정 | BETA 뱃지 / 색상 톤다운 / dropdown 호버 시간 |

### 2순위 — 압축 로드맵 D177~D180 (BEYOND BRAZE 비전 v0.3 정합)

| D | 영역 | 박을 의존성 |
|---|------|------------|
| **D177 Self-Optimizing (Bandit A/B)** | utils/bandit-optimizer.ts CT-29 (Thompson Sampling) + Continuous Operator proposal 변형 박음 + 결과 분석 | D176 운영 데이터 누적 후 (1주+ 권장) |
| **D178 인바운드 AI 음성 응답** | 한국 음성 인프라 검토(NCloud / Naver Clova / Twilio) + STT + TTS + 자사몰 전화 클릭 → AI 응답 | 외부 인프라 검토 + Harold 결정 필요 |
| **D179 Multi-Goal Decisioning** | Continuous Operator 확장 — 다중 목표 박음 + AI 충돌 없는 흐름 | D176/D177 안정화 후 |
| **D180 Email 채널 통합** | SDK Email 모듈 + SendGrid / Postmark 통합 | 외부 의존성 검토 |

### 3순위 — Harold 결정 받음

| 항목 | 결정 영역 |
|------|----------|
| **카페24 진입 방안** | 옵션 C (SDK 직접 박음, 이미 박힌 인프라) vs 옵션 B (admin API key 발급 가능 여부 검증) — Harold 카페24 admin 확인 후 |
| **ENT 베타 진입 회사 1~3사 명단** | Harold 결정 — 카페24/자사몰 종류 + 등급 정합 |
| **Shopify / 메이크샵 wrapper 구체 구현** | Phase 2 — ENT 후보사 자사몰 종류 우선순위 |

### Step 2 (D181~D200) — 사용 검증 후 진입

- Journey Builder Lite — 가입/재구매/휴면/장바구니/생일/예약 자동 여정
- 자연어 진입 (AI Operator 통합)

### Step 3 (D201~D230) — Step 2 박힌 후

- Decisioning Engine — 고객별 채널/시점/오퍼 AI 자동 결정

---

## 🎯 ENTERPRISE 베타 운영 진입 가이드 (D171-C)

> Harold 명시 (D162-5 kickoff): "ENTERPRISE/BUSINESS만 실제 진입, 그 외 BetaFeatureModal 예쁜 디자인". 진입 후 사용 로그 + 사고 신고 사이클로 안정성 검증 → 그 후 PRO → BASIC 단계적 확장.

### 1. 진입 게이팅 (이미 박힘 — 검증만)

| 등급 | AI Operator 메뉴 | `POST /api/ai/operator/propose` | BetaFeatureModal |
|------|:-:|:-:|:-:|
| **ENTERPRISE** | ✓ 노출 | ✓ 200 OK | — |
| **BUSINESS** | ✓ 노출 | ✓ 200 OK | — |
| **PRO** | ✓ 노출 | ✗ 403 `BETA_GATE` | ✓ 표시 |
| **BASIC** | ✓ 노출 | ✗ 403 `BETA_GATE` | ✓ 표시 |
| **STARTER** | ✓ 노출 | ✗ 403 `BETA_GATE` | ✓ 표시 |
| **TRIAL/FREE** | ✓ 노출 | ✗ 403 `BETA_GATE` | ✓ 표시 |

- 게이팅 컨트롤타워: `packages/backend/src/utils/plan-guard.ts` `isBetaAccessAllowed(planCtx)` (CT-17)
- BetaFeatureModal: `packages/frontend/src/components/BetaFeatureModal.tsx`

### 2. 베타 대상 후보사 매트릭스 (Harold 결정 후 명단)

| 후보사 | 등급 | 업종 | 주력 채널 | 진입 우선순위 |
|--------|:-:|------|----------|:-:|
| (TBD) | ENT | (TBD) | SMS+카카오 | 1 |
| (TBD) | ENT | (TBD) | SMS | 2 |
| (TBD) | BUS | (TBD) | (TBD) | 3 |

> Harold님이 베타 진입 1~3사 명단 확정 시 본 매트릭스 박음. 후보 추출 기준 후보:
> - 최근 30일 발송 활성 (campaigns sent_at > NOW() - INTERVAL '30 days' 1건 이상)
> - 회원 stats (companies.brand_name + brand_slogan + brand_description 박힘)
> - customer_schema 활성 필드 3개 이상 (Target Sub-agent 필터 도출 풍부)

### 3. 진입 시 사전 안내 항목 (Harold 직접 안내)

1. "본 기능은 베타 운영 중입니다. 실 발송 진행 시 결과는 통상 발송과 동일하게 청구됩니다."
2. AI Operator 진입 흐름 (자연어 입력 → 6 Sub-agent → 제안서 → 승인 → 발송)
3. **발송 시점 안전장치 인지:** AI 추천 / 즉시 발송 / 직접 지정 3분기 + 미래 1분+ + 08:00~21:00 KST + 즉시 발송 confirm 모달
4. **count 0건 자동완화 인지 (D171 신규):** filters로 0명 매칭 시 1회 자동 완화 시도 + `target.autoRelaxed=true` 응답
5. 사고 발견 즉시 Harold 카톡 신고 → fix 사이클 진입

### 4. 사용 로그 수집 채널

| 채널 | 위치 | 주요 키워드 |
|------|------|------------|
| PM2 backend | `pm2 logs targetup-backend --lines 200` | `[Orchestrator]` / `[AI Operator]` / `[Compliance` / `relaxFilters` |
| Orchestrator duration | response `meta.agentDurations` | target/verify/relax/message/compliance/costRoi ms |
| Compliance result | response `compliance.passed/riskLevel/warnings` | high/medium 발생 시 추적 |
| 자동완화 발생 | response `target.autoRelaxed=true` + `target.relaxedFields[]` | 0건→완화 효과 검증 |
| Prompt cache hit | PM2 로그 `[Anthropic] prompt cache` | D167 ephemeral 히트율 |
| 발송 결과 | `campaigns.status=completed/failed` + `campaign_runs` | AI 추천 → 실 발송 결과 비교 |

### 5. 사고 fix 사이클 (Harold 신고 → 종결)

1. Harold 신고 (구체적 회사/objective/응답 JSON 또는 PG row 첨부)
2. PM2 로그 시점 추적 (회사명 + 시각 → `pm2 logs` grep)
3. 재현 SQL/grep으로 root cause 확정 (추측 0건, CLAUDE.md `no_guess_strict` 룰)
4. 동일 패턴 전수 grep (`full_pattern_grep_required`)
5. 통합 fix 1개 도출 → Harold 동의 → 구현 → tsc 0 errors → atomic safe-build → 배포
6. 본 문서 D171 매트릭스에 사고/fix row 박음

### 6. 베타 종료 조건 (PRO 확장 게이트)

- ENT/BUS 베타 진입 후 4주 운영 누적 사고 fix 사이클 0~1건
- Prompt cache hit율 60%+ (D167 검증)
- 자동완화 정합성: 0건→완화 후 매칭 성공률 70%+ (D171-B 신규)
- Compliance high risk 차단: 발송 후 통신사 차단 0건
- Harold 명시 PRO 확장 동의

---

## 🚀 Step 1+ 예고 (D172~)

### Step 1: 성과 리포트 → Next Action 추천 (D172~D180)
- 매출/ROI/고객군별 성과 통합 리포트
- AI가 다음 캠페인 자동 제안 (recommendNextCampaign 강화)
- "1회성 발송툴" 탈출 → 운영 파트너 진입

### Step 2: Journey Builder Lite (D187 Step 1 종결)
- ✓ 7 표준 여정 템플릿 (가입/재구매/휴면/장바구니/생일/예약/Custom) — utils CT-43 journey-builder + CT-44 journey-executor
- ✓ Custom 자연어 진입 — Opus 4.7 + ai_company_memory 통합
- ✓ 트리거 5분 cron polling — customer.created / cdp.purchase / customer.dormant / cdp.cart_abandon / customer.birthday_approaching / cdp.reservation_created
- ✓ 회사 자유 임계값 (NULL=무제한 default) — recipients/cost/risk 3종
- ✓ 광고 자동 검증 4건 — (광고) prefix / 080 무료거부 / 발송 시간 KST 08:00~21:00 / KISA 제목
- ✓ 재진입 cooldown 정책 — 여정별 default 매트릭스
- ⏳ Step 2-B 잔존 — wait/condition step 타입 / MMS·KAKAO 채널 확장 / 트리거 다양화 / journey 단위 A/B 테스트 / 분석 차트 강화

### Step 3: Decisioning Engine (D201~D230)
- 고객별 채널/시점/오퍼 AI 자동 결정
- 반응 점수 + 채널 선호도 + 빈도 제한 + 홀드아웃

---

## 진입 명령 (다음 세션 첫 메시지)

```
status/STATUS.md CURRENT_TASK § "다음 세션 진입 가이드" 정독 + status/ai_operator_progress.md 정독 + docs/AI_OPERATOR_기능정의서.md v1.1.0 정독 → Harold 신고 우선 종결 또는 D188 Step 2-B(wait/condition step + MMS/KAKAO 채널 확장 + journey A/B 테스트) 진입 또는 SDK v0.3.0 진입
```

> Step 0~Step 2 Step 1 (D187 Journey Builder Lite Step 1) 종결. 다음 세션은 운영 검증 1주+ 후 Step 2-B 또는 Harold 명시 영역 진입.
