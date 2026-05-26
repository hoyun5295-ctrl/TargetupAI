# D220+ 한줄로AI / 맞춤한줄 모달 전면 재작성 — 다음 세션 진입 핸드오프

> **작성일**: 2026-05-27
> **세션 종결일**: 2026-05-27 (D219+ Part 2 후속 모든 작업 종결 직후)
> **다음 세션 진입 목적**: 한줄로AI / 맞춤한줄 흐름 안 모달 7건 전면 디자인 강화 (D215+ `feedback_design_quality_minimum_journey_level` 영구 룰 정합)
> **Harold 명시 (2026-05-27)**: "한줄로AI 모달들 = 디자인 스킬 대비 옛날 + 조잡 — 전체 손 본 의무 + 한줄로AI + 맞춤한줄 UI 전부"

---

## 1. 진입 배경

### Harold 캡처 신고 (2026-05-27)

캡처 안 `AiCampaignResultPopup.tsx` "AI 추천 결과 - 타겟 & 채널" 모달:
- 흰 배경 + 옛 라이트 톤 (bg-white + bg-violet-50 + bg-yellow-50 + bg-blue-50)
- 단순 4 영역 (추출된 타겟 / AI 추천 채널 / 광고성 메시지 / 채널 선택)
- D215+ 영구 룰 영역 X (다크 톤 X + AI 자율 진단 카드 X + Source caption X + 6 sub-agent 시각 효과 X)
- 사용자 = "디자인 스킬 대비 옛날 + 조잡" 직접 신고

### 영구 룰 정합 의무

`feedback_design_quality_minimum_journey_level` (Harold 명시 2026-05-25):
- 신규 메뉴 / 페이지 / UI 디자인 = 최소 AI 여정 (Journey Builder `/ai-journeys`) 동급 퀄리티 의무
- 옛 단순 form / 옛 단순 table view / native dialog 절대 사용 X
- 의무 요소 = 상단 헤더 sticky + AI 자율 진단 카드 (violet→fuchsia) + 자연어 입력 + 빠른 시작 카드 + 6 sub-agent 진행 시각 효과 + 1-click 액션 3 + 요약 5 metric + 격차 + 자세히 분석 토글 + 다크 톤 (bg-slate-950 + violet 액센트) + Source caption + 모바일 반응형 + ConfirmModal/useToast

---

## 2. 영향 모달 매트릭스 (7건 = 3,065 라인)

### 분류 A — 전면 재작성 의무 (D215+ 정합)

| # | 모달 | 라인 | 진입 시점 | 분량 |
|---|------|------|-----------|------|
| 1 | **AiCampaignResultPopup.tsx** | 451 | 캡처 안 모달 (AI 추천 결과 — 가장 자주 노출) | 4~5h |
| 2 | **AiCustomSendFlow.tsx** | 1,246 | 맞춤한줄 4 step 본격 흐름 (Step 1~4) | 15~20h |

### 분류 B — 다크 톤 + violet 액센트 정정 (단순 모달)

| # | 모달 | 라인 | 진입 시점 | 분량 |
|---|------|------|-----------|------|
| 3 | AiCampaignSendModal.tsx | 411 | 발송 시점 (캠페인명 + 발송 시간 + 회신번호) | 2~3h |
| 4 | RecommendTemplateModal.tsx | 559 | 추천 템플릿 선택 | 3~4h |
| 5 | AiMessageSuggestModal.tsx | 135 | 자연어 prompt → 메시지 생성 | 1h |
| 6 | AiPreviewModal.tsx | 132 | 미리보기 모달 | 1h |
| 7 | AiSendTypeModal.tsx | 131 | 발송 방식 선택 | 1h |

### 이미 다크 톤 종결 영역 (정정 의무 X)

- AiRefineModal.tsx + AiRefineLockedModal.tsx + DirectSendAiRefinePopup.tsx (D219+ Part 1 종결)
- AiOperatorWalkthroughModal.tsx (옛 종결)
- AiGuidePopup.tsx (D217+ 종결)

---

## 3. 단계 진입 매트릭스

### Step 1 — AiCampaignResultPopup 전면 재작성 (4~5h)

**진입 우선 사유**:
- Harold 캡처 안 본 모달 = 가장 자주 사용자 노출 영역
- 단일 모달 = 1 세션 안 처리 가능
- 사용자 즉시 체감 강화

**D215+ 의무 요소**:
- 다크 톤 (bg-slate-900/950 + border-white/10 + rounded-2xl + shadow-2xl)
- sticky 헤더 (gradient violet→fuchsia + BETA 배지)
- AI 자율 진단 카드 (추출된 타겟 + AI 추천 채널)
- 6 sub-agent 진행 시각 효과 (target → count → channel → message → compliance → schedule)
- Source caption 의무 ("Data source — AI 추천 매트릭스 (Opus/Sonnet 추론 + customer-filter 정합)")
- 모바일 반응형 (grid-cols-2 md:grid-cols-3 + flex-wrap)
- ConfirmModal + useToast (native dialog 0건)

### Step 2 — 단순 모달 5건 일괄 다크 톤 정정 (8~10h)

**진입 사유**: 분류 B 5건 = 단순 정정 = 통합 1 세션 처리 가능 + 사용자 흐름 안 흐름 정합 보장

**정정 매트릭스**:
- bg-white → bg-slate-900
- bg-violet-50 / bg-blue-50 / bg-yellow-50 / bg-green-50 → bg-white/5 + border-white/10
- text-gray-* → text-white/*
- 헤더 그라데이션 정합 (violet→fuchsia or violet→indigo)
- ConfirmModal 활용 (alert/confirm 0건)
- Source caption 추가

### Step 3 — AiCustomSendFlow 전면 재작성 (15~20h)

**진입 사유**: 4 step 본격 흐름 = 한줄로AI 핵심 영역 + 분량 매우 큰 영역 = 단일 세션 한계

**4 step 매트릭스 (옛 흐름 유지)**:
- Step 1 — 필드 선택 + 빠른 시작 카드 매트릭스 추가
- Step 2 — briefing + URL + channel + 광고 동의 + AI 자율 진단 카드
- Step 3 — 프로모션 카드 + 타겟 조건 + 매칭 수 (이미 영역 존재 — D215+ 정합 재작성)
- Step 4 — variants 본문 생성 + 6 sub-agent 시각 효과 + 1-click 액션

**단계 분할 가능** (단일 세션 한계 시):
- Step 3a — Step 1+2 D215+ 재작성 (7~10h)
- Step 3b — Step 3+4 D215+ 재작성 (8~10h)

---

## 4. 영구 룰 정합 매트릭스 (다음 세션 자가 검증 의무)

- `cto_mandate_for_vito` — CTO 사명감 + 정합성 100%
- `design_quality_minimum_journey_level` — Journey Builder 동급 퀄리티 의무 (다크 톤 + violet 액센트 + Source caption + 모바일 반응형)
- `no_native_browser_dialog` — alert/confirm/prompt 0건 + ConfirmModal/useToast 활용
- `no_model_name_ui_exposure` — UI 안 Opus/Sonnet/GPT/Claude/Anthropic 단어 0건 의무
- `marketing_user_ux_priority` — 1-click + AI 자동 흐름
- `ai_no_arbitrary_benefit` — 본문 안 구체 혜택 placeholder 의무
- `no_target_auto_relax` — 0건 매칭 자동 완화 X (D171)
- `no_inline_duplication` — utils CT 활용 + 인라인 정의 X
- `feedback_no_bakkeum_usage § D219+ Part 1` — 박/옛/진정/영영 신규 영역 0건
- `feedback_no_preview_verification` — Claude_Preview MCP 도구 0건 활용
- `feedback_default_superpowers_workflow` — brainstorming / verification-before-completion 호출 의무

---

## 5. 다음 세션 진입 명령어 (첫 메시지)

```
docs/superpowers/handoffs/2026-05-27-ai-hanjullo-modal-redesign-handoff.md 정독 + memory/feedback_design_quality_minimum_journey_level.md 정독 + memory/feedback_no_bakkeum_usage.md 정독 + memory/feedback_default_superpowers_workflow.md 정독 + memory/feedback_cto_mandate_for_vito.md 정독 + memory/project_d219_part2_completed.md 정독 → D220+ 진입 (한줄로AI / 맞춤한줄 모달 7건 전면 재작성 — Step 1 AiCampaignResultPopup 우선 진입)
```

---

## 6. 진입 추천 우선순위

1. **Step 1 (AiCampaignResultPopup)** = 캡처 본 모달 = 사용자 즉시 체감 강화 우선
2. **Step 2 (단순 5건 다크 톤 정정)** = 통합 흐름 정합 + 1 세션 처리 가능
3. **Step 3 (AiCustomSendFlow 전면 재작성)** = 본격 흐름 = 분량 매우 큰 영역 = 2 세션 분할 가능

---

## 7. 옛 진행 종결 영역 (참조용)

D219+ Part 2 후속 작업 (2026-05-27 종결):
- Task 1: DirectTargetFilterModal 자연어 모드 추가 (CT-97 활용)
- Task 2: AddressBookModal AI 자동 매핑 영구 폐기 (Harold 명시 — FREE 회사 사치 영역)
- Task 5: Performance 일일 인사이트 카드 (CT-98 collectCompanyInsight export + routes/insight.ts 신설)
- Task 7: isAiOperatorTrialActive duplicate 정정 (plan-guard.ts 단일 진입점 통합)
- 박과장님 신고: 주소록 다운로드 + 기존 그룹 안 번호 추가

---

> 본 문서 = D220+ 진입 의무 매트릭스 종결. 다음 세션 첫 메시지 = 위 § 5 명령어 복사 진입.
