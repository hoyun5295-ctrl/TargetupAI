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
| **D176** | **Continuous Agentic Operator (사용자 동의 흐름)** 비전 압축 로드맵 1순위 박힘. DB 2 테이블 + companies ALTER 3 + utils CT-28(Zero-Count 영구 원칙 정합 + ENT 자동 실행 임계값 + 5분 worker) + routes 7 endpoint + ContinuousOperatorPage(2 탭) + 메뉴 + 라우트. AI 단독 실행 X 영구 원칙 100% 정합 | ✓ 완료 | 빌드 + DB SQL 3건 대기 |

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

## ⏸ 잔여 작업 (Step 1+ 예정)

> D171 Step 0 코드 작업 (A/B/C/D) 전체 종결. 잔여는 Step 1+ (D172~).

### Step 1 (D172~D180): 성과 리포트 → Next Action 추천
- 매출/ROI/고객군별 성과 통합 리포트
- recommendNextCampaign 강화
- "1회성 발송툴" 탈출

### Step 2 (D181~D200): Journey Builder Lite
- 가입/재구매/휴면/장바구니/생일/예약 자동 여정

### Step 3 (D201~D230): Decisioning Engine
- 고객별 채널/시점/오퍼 AI 자동 결정

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

### Step 2: Journey Builder Lite (D181~D200)
- 가입/재구매/휴면/장바구니/생일/예약 자동 여정
- 7 여정 템플릿 + 트리거 + 흐름 검토 UX

### Step 3: Decisioning Engine (D201~D230)
- 고객별 채널/시점/오퍼 AI 자동 결정
- 반응 점수 + 채널 선호도 + 빈도 제한 + 홀드아웃

---

## 진입 명령 (다음 세션)

```
status/ai_operator_progress.md 정독 → Harold 신고 우선 종결 → Step 1 (D172~D180) 진입 또는 ENT 베타 대상사 명단 확정
```

> D171 코드 작업 (A/B/C) 종결 — 빌드/배포 후 ENT 베타 진입 대상사 확정 단계만 Harold 결정 대기.
