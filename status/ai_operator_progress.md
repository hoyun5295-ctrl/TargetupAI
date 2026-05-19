# AI Operator — Step 0 진행 추적 (D170+ · 2026-05-19 기준)

> 한줄로AI Braze급 SaaS 고도화 — Step 0 (9-Phase Delivery) 누적 작업 내역 + 잔여 작업.
> 매 세션 시작 시 이 문서 정독 → 잔여 작업 진입.
> 상세 메모리: `memory/project_d162_5_braze_grade_roadmap_kickoff.md` + `memory/feedback_ai_operator_model_isolation.md`

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
| **D171** | Step 0 통합 검증 + ENTERPRISE 베타 운영 진입 | ⏸ 잔여 | — |

---

## 📁 박힌 파일 영역 (D163~D170+)

### Backend
- `packages/backend/src/config/defaults.ts` — AI_MODELS 4분리(claude/opus/gpt/gptOperator)
- `packages/backend/src/utils/plan-guard.ts` — `isBetaAccessAllowed` 신설 (CT-17)
- `packages/backend/src/services/ai.ts` — `callAIWithFallback` model 옵션(sonnet/opus) + Opus 4.7 breaking changes 분기(temperature/thinking) + Prompt Caching + Extended Thinking + GPT-5.5 fallback temperature 박지 X / `generateMessages` extraContext.model / `recommendTarget` options.model
- `packages/backend/src/services/ai-orchestrator.ts` (신규) — `orchestrate` + `checkCompliance` + `buildCompanyMemoryContext` + `calculateCostROI` + Sub-agent 5종 분리
- `packages/backend/src/routes/ai.ts` — `POST /api/ai/operator/propose` (orchestrate 호출) + `POST /api/ai/operator/preview-recipients` (recipients 조회 + default callback)

### Frontend
- `packages/frontend/src/App.tsx` — `/ai-operator` 라우트
- `packages/frontend/src/components/BetaFeatureModal.tsx` (신규) — 그라데이션 모달 + 7 엔진 카드
- `packages/frontend/src/components/DashboardHeader.tsx` — "AI Operator" 메뉴 + BETA 뱃지 + beta 컬러
- `packages/frontend/src/pages/Dashboard.tsx` — BetaFeatureModal state + onAiOperatorClick 게이팅
- `packages/frontend/src/pages/AiOperatorPage.tsx` — Hero 입력창 + Multi-Agent Pipeline Loading + 결과 6 카드 + 메시지 3안 토글 + 성과 차트 + 비용 breakdown + AiRefineModal 통합 + (광고)/무료거부 자동 합성 + sendMode 라디오 + datetime input + 안전장치
- `packages/frontend/src/utils/formatDate.ts` — 주석 정규식 텍스트 자연어화 (CSS minify warning 차단)

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

---

## ⏸ 잔여 작업 (Step 0 D171)

### D171 — Step 0 통합 검증 + ENTERPRISE 베타 운영 진입

#### A. SESSION_MILESTONES 데이터 갱신 (frontend)
- 위치: `packages/frontend/src/pages/AiOperatorPage.tsx` L40~50
- 현재 표시: D165 "다음 진행" (실제는 D170까지 ✓ 완료)
- 갱신: D163~D170 done / D171 next

#### B. ENTERPRISE 베타 운영 진입 가이드
- ENT 고객사 1~3사 대상 베타 안내
- 사용 로그 수집 (PM2 + Orchestrator agentDurations)
- 발견 사고 fix 사이클

#### C. count 0건 매칭 시 relaxFilters 자동 loop (D170 단순화에서 미박힘)
- 현재: orchestrate에서 countFilteredCustomers 호출 후 0건이어도 그대로 응답
- 정합: 0건 → relaxFilters 호출 → 새 filters로 재 count → 최대 1 iteration
- 위치: `services/ai-orchestrator.ts` orchestrate 함수 내부

#### D. 진정 Orchestrator AI (Opus 4.7) 활성 (Phase 1+ 예정, D171에서 안 박을 수도)
- 현재: orchestrate가 backend 직접 통합 (sub-agent 순서 호출)
- Phase 1+: Opus 4.7 Orchestrator AI가 sub-agent 분배 결정

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
status/ai_operator_progress.md 정독 + status/STATUS.md CURRENT_TASK 확인 → D171 진입 또는 Harold 신고 우선
```
