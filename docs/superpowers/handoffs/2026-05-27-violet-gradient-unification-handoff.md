# D222+ 새 세션 진입 핸드오프 — 보라 그라데이션 통일 + AI Operator 대체 + 시인성 강화 대규모 작업

> **작성일**: 2026-05-27
> **작성자**: 본 AI (Harold 명시 흐름 정합 — CTO 사명감 영구 룰 정합)
> **다음 세션 진입 시 첫 메시지**: 본 .md 정독 + 기존 spec 정독 + Phase 1 진입
> **Harold 명시 (2026-05-27)**: "비토야 알아? 진짜 제대로 해야하고 메뉴들 프리뷰로 봐서 텍스트 폰트 색깔부터 전부 시인성 좋도록 해야"

---

## 1. 본 작업 본질 (CTO 사명감 정합)

본 작업 = **단순 디자인 정정 X / 한줄로 전체 시각 정체성 통일 영역**. 6,000사+ 운영 서비스 안 한줄로 차별점 강화 + 직원 피드백 정합 ("AI Operator 메인 고급스럽다" 흐름 전 메뉴 확장) + Harold 직감 정합 ("흰 톤 촌스러움 + 보라 그라데이션 통일").

본 작업 본질 = 영구 정합 fix. 단순 색상 치환 X / 시각 정체성 + 가독성 + 통일감 + 차별점 동시 달성 의무.

---

## 2. 다음 세션 진입 첫 메시지 (Harold 복붙 영역)

```
docs/superpowers/handoffs/2026-05-27-violet-gradient-unification-handoff.md 정독 +
docs/superpowers/specs/2026-05-27-violet-gradient-unification-design.md 정독 +
memory/feedback_cto_mandate_for_vito.md 정독 +
memory/feedback_design_quality_minimum_journey_level.md 정독 +
memory/feedback_marketing_user_ux_priority.md 정독 +
memory/feedback_no_bakkeum_usage.md 정독 +
memory/feedback_default_superpowers_workflow.md 정독 →
D222+ 진입 (보라 그라데이션 통일 대규모 작업 — Phase 1 우선 진입)
```

---

## 3. 본 작업 범위 매트릭스 (절대 결정 사항)

### 3-1. 헤더 변경 (결정 종결)

| 영역 | 정정 |
|---|---|
| AI Operator (BETA) 메뉴 | **제거** |
| 매뉴얼 (NEW) 메뉴 | **신규 추가** (Claude Design 수령 매뉴얼 진입 link) |
| AI Operator 진입 흐름 | 대시보드 큰 카드 1 입구 (라벨 = "AI 자동발송") |

### 3-2. 대시보드 정정 (결정 종결)

| 영역 | 정정 |
|---|---|
| 배경 | 흰 톤 → 보라 그라데이션 (bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900) |
| AI 추천 발송 카드 | **"AI Operator" 통합 단일 진입** (라벨 = "AI 자동발송") — 기존 한줄로 AI / 맞춤한줄 흐름 폐기 또는 AI Operator 하위 빠른 시작 카드로 통합 |
| 하단 카드 섹션 4개 | **삭제 의무** — 최근 캠페인 / AI 발송 템플릿 / AI 분석 / 예약 대기 (기존 카드 4건 전수 제거) |
| 직접 타겟 발송 카드 | 헤더 nav "직접발송" 진입 흐름으로 이동 (대시보드 카드 제거) |
| 고객 DB 업로드 카드 | 헤더 nav "관리" 안 진입 또는 별 모달 (대시보드 카드 제거) |
| DB 현황 영역 | 본격 구현 (5 영역) — 상단 line chart + 미니 metric 4 + 도넛 차트 2 + AI 인사이트 카드 + cohort retention |
| 요금제 + 발송 현황 | 기존 흐름 유지 + 디자인 톤 정정 |

### 3-3. 계층 3 흐름 (페이지 본질 별 톤 차별 — Harold 직감 + 직원 본질 동시 정합)

**본질**: 페이지 사용 본질에 따라 톤 차별. AI 영역 = 보라 그라데이션 (톤 다운) / 입력 영역 = 흰 톤 / 모달 = 다크 톤 (톤 다운).

| # | 페이지 | 라우트 | 계층 | 톤 | Phase |
|---|---|---|---|---|---|
| 1 | Dashboard | `/dashboard` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 1 |
| 2 | JourneysPage | `/ai-journeys` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 1 |
| 3 | AI Operator 메인 | `/ai-operator` | 계층 1 (AI 영역) | 기준점 + 톤 다운 | 기준점 정정 |
| 4 | PerformancePage | `/performance` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 2 |
| 5 | CdpSettingsPage | `/cdp-settings` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 2 |
| 6 | ContinuousOperatorPage | `/continuous-operator` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 2 |
| 7 | InAppMessagesPage | `/inapp-messages` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 3 |
| 8 | EmailCampaignsPage | `/email-campaigns` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 3 |
| 9 | PredictivePage | `/predictive` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 3 |
| 10 | AiMemoryPage | `/ai-memory` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 3 |
| 11 | AiUsagePage | `/ai-usage` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 3 |
| 12 | SegmentsPage | `/segments` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 3 |
| 13 | OnboardingWizardPage | `/onboarding` | 계층 1 (AI 영역) | 보라 그라데이션 (톤 다운) | Phase 3 |
| 14 | **직접발송 / 직접 타겟 발송** | `/direct-send` | **계층 2 (입력 영역)** | **흰 톤 + violet 액센트** | Phase 4 |
| 15 | **CampaignResultsPage (발송결과)** | `/campaigns` | **계층 2 (입력 영역)** | **흰 톤 + violet 액센트** | Phase 4 |
| 16 | **CustomersPage / AddressBookPage** | `/customers` | **계층 2 (입력 영역)** | **흰 톤 + violet 액센트** | Phase 4 |
| 17 | **AdminDashboard (슈퍼관리자)** | `/admin-dashboard` | **계층 2 (입력 영역)** | **흰 톤 + violet 액센트** | Phase 4 |
| 18 | 매뉴얼 페이지 | `/manual.html` | 별 영역 | 다크 톤 (Claude Design 수령 + 톤 다운) | Phase 5 |
| 19 | 모든 모달 (D220+ 종결 6건) | — | **계층 3 (모달)** | **다크 톤 (톤 다운 — bg-slate-800)** | 정정 의무 (별 작업) |

**계층 별 톤 매트릭스**:

**계층 1 — AI 영역 (보라 그라데이션 톤 다운)**:
- 페이지 배경 = `bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900` (직전 slate-950 → violet-900 톤 다운 + slate 제거 + violet 강화)
- sticky 헤더 = `bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30` (직전 slate-950/40 → violet-800/50)
- 카드 = `bg-violet-700/30 + border-violet-400/50` (직전 violet-900/40 → violet-700/30 + 더 밝은 톤)
- 텍스트 본문 = `text-white/95` (직전 90 → 95 강화)
- 텍스트 보조 = `text-white/80` (직전 70 → 80 강화)
- 텍스트 caption = `text-white/55` (직전 40 → 55 강화 — 40 이하 금지 의무)

**계층 2 — 입력 영역 (흰 톤 + violet 액센트)**:
- 페이지 배경 = `bg-gray-50` 또는 `bg-slate-50` (흰 톤 default — Braze 동급 흐름)
- 헤더 sticky = `bg-white/80 backdrop-blur + border-b border-gray-200`
- 카드 = `bg-white + border-gray-200 + shadow-sm` (기존 SaaS 표준)
- violet 액센트 (액션 버튼 / 강조 영역) = `bg-violet-600 text-white` 또는 `bg-violet-50 text-violet-700`
- 다크 카드 헤더 (차별 영역 선택) = `bg-violet-900 + text-white`
- 텍스트 본문 = `text-gray-900` (검정 톤)
- 텍스트 보조 = `text-gray-600`
- 표 / 폼 = 흰 톤 default + violet 액센트 (포커스 / 선택 영역)

**계층 3 — 모달 (다크 톤 톤 다운)**:
- 모달 컨테이너 = `bg-slate-800 + border-white/15` (직전 slate-900 → slate-800)
- 모달 sticky 헤더 = `bg-gradient slate-800 via violet-800/40 to slate-800` (직전 slate-950 → slate-800)
- 메시지 영역 (다크 폰 모드 D220+ 흐름) = `bg-slate-700 + 메시지 버블 bg-slate-600 + text-white/95` (톤 다운)

---

## 4. 시인성 강화 매트릭스 ★ (본 핸드오프 핵심 — 직원 "어둡다" 신고 본질 차단)

### 4-1. 텍스트 색상 매트릭스 (계층별 절대 의무 — 톤 다운 정합)

**계층 1 (AI 영역 — 보라 그라데이션 톤 다운)**:

| 영역 | 색상 매트릭스 | 대비 의무 |
|---|---|---|
| 본문 (가장 중요) | `text-white/95` 또는 `text-white` | violet-900 톤 다운 대비 충분 |
| 본문 보조 | `text-white/80` | 대비 강화 (text-white/70 X) |
| 라벨 | `text-white/70` | 충분 가독성 |
| caption / 보조 안내 | `text-white/55` | 40 이하 금지 의무 |
| 강조 (숫자 / 핵심) | `text-violet-200` 또는 `text-fuchsia-200` (text-violet-300 X) |
| 위험 / 경고 | `text-rose-200` (text-rose-300 X) |
| 성공 / 긍정 | `text-emerald-200` (text-emerald-300 X) |
| 정보 / 안내 | `text-cyan-200` |
| 광고 / 검수 | `text-amber-200` |

**계층 2 (입력 영역 — 흰 톤)**:

| 영역 | 색상 매트릭스 | 대비 의무 |
|---|---|---|
| 본문 (가장 중요) | `text-gray-900` (검정 톤) | 흰 톤 대비 강력 |
| 본문 보조 | `text-gray-700` | 충분 가독성 |
| 라벨 | `text-gray-600` | 충분 |
| caption | `text-gray-500` | 작은 영역 한정 |
| 강조 (액션) | `text-violet-700` 또는 `text-violet-600` | violet 액센트 |
| 링크 | `text-violet-600 hover:text-violet-800` | 명확 |

**금지 영역** (계층 1 + 2 공통):
- 계층 1 = `text-white/40` 이하 X (직원 "어둡다" 본질 차단 흐름)
- 계층 1 = `text-violet-400/500/600` X (보라 배경 안 흐림)
- 계층 2 = `text-gray-300/400` X (흰 톤 안 시각 약화)

### 4-2. 배경 대비 매트릭스 (계층별)

**계층 1 (AI 영역 — 보라 그라데이션 톤 다운)**:

| 카드 영역 | 배경 | 텍스트 |
|---|---|---|
| 페이지 | `bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900` (직전 slate-950 → violet-900) | text-white/95 |
| sticky 헤더 | `bg-violet-800/50 backdrop-blur-md` + `border-violet-400/30` | text-white/95 |
| 메인 카드 | `bg-violet-700/30` + `border-violet-400/50` (직전 900/40 → 700/30 톤 다운) | text-white/95 |
| 보조 카드 | `bg-white/10` + `border-white/20` (직전 white/5 → white/10 강화) | text-white/90 |
| 강조 카드 | `bg-gradient-to-br from-violet-500/30 to-fuchsia-500/25` + `border-violet-400/50` (채도 강화) | text-white |
| 위험 카드 | `bg-rose-500/20` + `border-rose-400/50` (직전 15 → 20 강화) | text-rose-100 |
| 성공 카드 | `bg-emerald-500/20` + `border-emerald-400/50` | text-emerald-100 |
| 광고 카드 | `bg-amber-500/20` + `border-amber-400/50` | text-amber-100 |

**계층 2 (입력 영역 — 흰 톤)**:

| 카드 영역 | 배경 | 텍스트 |
|---|---|---|
| 페이지 | `bg-gray-50` 또는 `bg-slate-50` | text-gray-900 |
| sticky 헤더 | `bg-white/80 backdrop-blur` + `border-b border-gray-200` | text-gray-900 |
| 메인 카드 | `bg-white` + `border-gray-200` + `shadow-sm` | text-gray-900 |
| 강조 영역 | `bg-violet-50` + `border-violet-200` | text-violet-700 |
| 위험 영역 | `bg-rose-50` + `border-rose-200` | text-rose-700 |
| 성공 영역 | `bg-emerald-50` + `border-emerald-200` | text-emerald-700 |
| 폼 input | `bg-white` + `border-gray-300` + `focus:border-violet-500` | text-gray-900 |
| 표 | `bg-white` + `border-gray-200` + `hover:bg-violet-50/30` | text-gray-900 |

**계층 3 (모달 — 다크 톤 톤 다운)**:

| 영역 | 배경 | 텍스트 |
|---|---|---|
| 모달 컨테이너 | `bg-slate-800` + `border-white/15` (직전 slate-900 → slate-800) | text-white/95 |
| 모달 sticky 헤더 | `bg-gradient-to-r from-slate-800 via-violet-800/40 to-slate-800` | text-white/95 |
| 메시지 영역 (D220+ 다크 폰 모드) | `bg-slate-700` (직전 slate-900 → slate-700 톤 다운) | text-white/95 |
| 메시지 버블 | `bg-slate-600` + `border-white/15` (직전 slate-800 → slate-600 톤 다운) | text-white/95 |

**금지 영역**:
- 계층 1 = `bg-{color}-500/5` 이하 (시각 효과 없음)
- 계층 1 = `bg-slate-950/900` 영역 (이전 너무 어두운 톤 — 직원 신고 본질)
- 계층 2 = `bg-gray-900/800` 영역 (흰 톤 영역 안 갑작스러운 어두운 영역 X)
- 계층 3 = `bg-slate-900/950` 영역 (이전 너무 어두운 톤 — 톤 다운 후 slate-800/700)

### 4-3. 폰트 weight + 크기 매트릭스

| 영역 | weight | 크기 |
|---|---|---|
| 페이지 제목 (h1) | `font-bold` | `text-3xl` (28~32px) |
| 섹션 제목 (h2) | `font-semibold` | `text-xl/2xl` (20~24px) |
| 카드 제목 (h3) | `font-semibold` | `text-base/lg` (16~18px) |
| 본문 | `font-medium` | `text-sm/base` (14~16px) |
| 보조 / caption | `font-normal` | `text-xs` (12px) |
| 숫자 강조 | `font-bold` | `text-2xl/3xl` (24~30px — 기존 text-4xl 폐기 의무) |

**금지 영역**:
- `font-extrabold` X (시인성 강화 X / 단순 무거움)
- `text-4xl` 이상 X (촌스러움 + 가독성 약화 — 직원 피드백 정합)

### 4-4. 여백 + 간격 매트릭스

| 영역 | 여백 |
|---|---|
| 카드 padding | `p-4` 단순 (기존 p-5 폐기) |
| grid gap | `gap-3` 컴팩트 |
| section margin | `mb-6` 충분 (기존 mb-12 폐기) |
| line-height | `leading-relaxed` (1.625) 본문 / `leading-snug` (1.375) 카드 |
| 텍스트 사이 간격 | 충분한 white space (기존 텍스트 밀집 폐기) |

---

## 5. 본 AI 프리뷰 확인 흐름 ★ (절대 의무)

### 5-1. 각 페이지 정정 직후 자가 검증 매트릭스

본 작업 = **시각 확인 의무**. 단순 코드 정정 X / 매 페이지 정정 직후 시각 검증 흐름:

1. **frontend tsc 검증** = EXIT_CODE=0 의무
2. **자가 grep 검증** = 박/D219+ 영구 룰 단어/모델명/native dialog/이모지 0건
3. **시인성 자가 검증** = 본 핸드오프 § 4-1 ~ 4-4 매트릭스 100% 정합 확인
4. **Source caption 확인** = 모든 카드 안 "Data source — ..." 포함됨
5. **모바일 반응형 확인** = max-md: 매트릭스 적용 (grid-cols-1 + inset-0 풀스크린)

### 5-2. Harold 직접 시각 확인 흐름

각 Phase 종결 시 = Harold 직접 운영 시각 확인 + 직원 피드백 수렴 의무. 본 AI 출력 후 Harold 컨펌 받기 전 = 다음 Phase 진입 X.

### 5-3. 정정 발견 시 흐름

시각 약점 발견 시 = 즉시 재 정정. 본 핸드오프 § 4 매트릭스 강화 또는 별 영역 추가 의무.

---

## 6. AI Operator 통합 흐름 (기존 한줄로 AI / 맞춤한줄 매트릭스)

### 6-1. 기존 흐름 분석

| 영역 | 기존 진입 | 정정 후 진입 |
|---|---|---|
| AI 한줄로 (자연어 한 줄 발송) | 대시보드 "AI 추천 발송" 카드 클릭 → AiSendTypeModal → "AI 한줄로" 선택 → 진입 | AI Operator 안 "자연어 한 줄 입력" 영역 + 빠른 시작 카드 "AI 자동" 통합 |
| AI 맞춤한줄 (정교한 개인화) | 대시보드 "AI 추천 발송" 카드 클릭 → AiSendTypeModal → "AI 맞춤한줄" 선택 → 진입 | AI Operator 안 "프로모션 브리핑" 영역 또는 빠른 시작 카드 "프로모션 자동 생성" 통합 |
| AI Operator | 헤더 메뉴 진입 | 대시보드 큰 카드 1 입구 단일 통합 |

### 6-2. 흐름 통일 의무

- 대시보드 "AI 추천 발송" 카드 클릭 = AiSendTypeModal **폐기** 또는 AI Operator 메인 페이지 즉시 진입
- AI Operator 메인 페이지 안 = 자연어 입력 + 빠른 시작 7 카드 + 프로모션 브리핑 진입 흐름 = 기존 한줄로 / 맞춤한줄 흐름 모두 통합
- 사용자 = "AI 추천 발송 = AI Operator 진입" 단일 학습 흐름

### 6-3. 기존 진입 link 정리 의무

기존 한줄로 AI / 맞춤한줄 진입 link = 모든 페이지 안 grep + 정리 의무 (직접발송 / 직접 타겟 발송 / 세그먼트 / 자동발송 / RecommendTemplateModal 등).

---

## 7. 영구 룰 정합 매트릭스 (전체 17건 통과 의무)

| # | 영구 룰 | 정합 흐름 |
|---|---|---|
| 1 | feedback_cto_mandate_for_vito | CTO 사명감 + 단순 1 fix X = 영구 정합 fix |
| 2 | feedback_design_quality_minimum_journey_level | Journey Builder 동급 + 보라 그라데이션 확장 강화 |
| 3 | feedback_no_native_browser_dialog | ConfirmModal / useToast 활용 |
| 4 | feedback_no_model_name_ui_exposure | UI 안 Opus/Sonnet/GPT/Claude/Anthropic 0건 |
| 5 | feedback_marketing_user_ux_priority | 1-click 흐름 + 한 시야 + 직관 강화 |
| 6 | feedback_ai_no_arbitrary_benefit | AI 생성 메시지 안 구체 혜택 X |
| 7 | feedback_no_target_auto_relax | 0건 매칭 자동 완화 X |
| 8 | feedback_no_inline_duplication | utils CT 활용 + 인라인 정의 X |
| 9 | feedback_no_bakkeum_usage | 박-단어 + D219+ 영구 룰 단어 0건 |
| 10 | feedback_no_preview_verification | Claude_Preview MCP 도구 0건 |
| 11 | feedback_jondaetmal_to_harold | Harold 대상 존댓말 |
| 12 | feedback_default_superpowers_workflow | brainstorming + writing-plans + verification-before-completion |
| 13 | feedback_no_humuson_keyword_exposure | 휴머스온 / Humuson 0건 |
| 14 | feedback_no_sudo_use_echo | sudo 0건 |
| 15 | feedback_no_devtools_browser_diagnostic | F12 DevTools 안내 0건 |
| 16 | feedback_push_and_deploy_commands | tp-push 표준 흐름 |
| 17 | feedback_no_pm2_delete_before_git_push | pm2 reload / restart all 흐름 |

---

## 8. Phase 1 진입 흐름 (다음 세션 첫 작업)

### 8-1. Phase 1 = Dashboard + JourneysPage 동시 정정

**예상 분량**: 약 8~10h (가장 큰 작업 — 대시보드 전수 재작성 + JourneysPage 톤 정정)

**진입 직전 본 AI 의무**:
1. Dashboard.tsx 전수 정독 (2500 라인+) — 기존 흐름 100% 분석
2. JourneysPage.tsx 전수 정독 (2507 라인) — 기존 흐름 100% 분석
3. AI Operator 메인 페이지 정독 (기준점 — 디자인 톤 학습)
4. brainstorming skill 호출 — Harold 의논 (기존 흐름 보존 vs 전수 재작성)
5. writing-plans skill 호출 — Plan 매트릭스 분할 작성
6. 본 핸드오프 § 4 시인성 매트릭스 100% 정합 + 자가 검증

### 8-2. Dashboard 정정 매트릭스 (절대 의무)

1. 배경 = 흰 톤 → 보라 그라데이션
2. 헤더 nav 정정 (AI Operator 제거 + 매뉴얼 신규 추가)
3. AI 추천 발송 카드 → AI 자동발송 라벨 정정 + AI Operator 단일 진입
4. **하단 카드 섹션 4건 전수 삭제** (최근 캠페인 / AI 발송 템플릿 / AI 분석 / 예약 대기)
5. 직접 타겟 발송 카드 + 고객 DB 업로드 카드 제거 (헤더 nav 진입 흐름으로 이동)
6. DB 현황 영역 본격 구현 (5 영역 — 본 핸드오프 § 3-2 정합)
7. 시인성 매트릭스 100% 정합 (§ 4 정합)

### 8-3. JourneysPage 정정 매트릭스

1. 배경 = 블랙톤 → 보라 그라데이션
2. 자연어 입력 + 빠른 시작 7 카드 + AI 진단 카드 흐름 유지 (디자인만 정정)
3. 카드 디자인 정정 (§ 4-2 정합)
4. 텍스트 색상 강화 (§ 4-1 정합)
5. 폰트 weight / 크기 정정 (§ 4-3 정합)
6. 여백 강화 (§ 4-4 정합)

### 8-4. Phase 1 종결 직후 의무

1. frontend tsc 0 errors 검증
2. 자가 grep 검증 (박/D219+ 영구 룰 단어/모델명/native dialog/이모지)
3. 시인성 매트릭스 자가 확인
4. Harold 직접 시각 확인 + 직원 피드백 수렴 흐름
5. Phase 2 진입 컨펌 받기

---

## 9. Phase 2~5 흐름 (별 세션 분할)

### Phase 2 — PerformancePage + CdpSettingsPage + ContinuousOperatorPage (AI Operator 본 영역)

**분량**: 약 6~8h

**흐름**: Phase 1 종결 + Harold 컨펌 후 진입

### Phase 3 — InAppMessages + Email + Predictive + AiMemory + AiUsage + Segments + Onboarding (7 페이지)

**분량**: 약 10~12h

### Phase 4 — AdminDashboard + 발송결과 + 고객 DB / 주소록 (기존 흰 톤 페이지 전수)

**분량**: 약 8~10h

### Phase 5 — 매뉴얼 페이지 정정 (Claude Design 수령 HTML)

**분량**: 약 4~6h

**흐름**:
1. Harold Claude Design 수령 HTML 본 AI 정독
2. 기존 `packages/frontend/public/manual/manual.html` 정정 또는 신규 `/manual` 라우트 신설
3. 헤더 매뉴얼 메뉴 진입 link 정합 확인
4. 기존 footer 매뉴얼 link 정리 (Dashboard.tsx line 3873)

---

## 10. 본 핸드오프 활용 흐름 (Harold 결정 영역)

### Step 1 — Harold 본 핸드오프 정독 + 기존 spec 정독

본 핸드오프 + 기존 spec (`docs/superpowers/specs/2026-05-27-violet-gradient-unification-design.md`) 둘 다 정독.

### Step 2 — Harold Claude Design 수령 후 본 AI 알림

기존 매뉴얼 작업 Claude Design 진행 중 — 수령 직후 본 AI 알림 + 검토 흐름.

### Step 3 — 새 세션 진입 (D222+)

새 세션 진입 시 첫 메시지 = 본 핸드오프 § 2 영역 복붙 → 본 AI 정독 → Phase 1 진입 흐름.

### Step 4 — Phase 1 진행 (대시보드 + JourneysPage)

본 AI 진행 흐름:
1. brainstorming skill 호출 → Harold 의논
2. 기존 코드 정독 (Dashboard + JourneysPage + AI Operator 메인)
3. 시인성 매트릭스 강화 spec 추가 작성 (기존 spec 보완)
4. writing-plans skill 호출 → Plan 작성
5. 본격 정정 진입 (전수 재작성 흐름)
6. 자가 검증 + 시인성 매트릭스 100% 정합 확인
7. Harold 시각 확인 + 직원 피드백 수렴

### Step 5 — Phase 2~5 진행 (별 세션 분할)

각 Phase 종결 후 Harold 컨펌 받음 흐름. 단계 진행 의무.

---

## 11. 본 작업 종결 흐름 (전체 Phase 종결 후)

### 11-1. 전수 검증 매트릭스

- 전 메뉴 시각 통일 확인 (보라 그라데이션 일관 흐름)
- 전 메뉴 시인성 강화 확인 (§ 4 매트릭스 100% 정합)
- 헤더 변경 + 매뉴얼 진입 흐름 정합
- AI Operator 단일 진입 흐름 정합 (기존 한줄로 / 맞춤한줄 진입 link 0건)
- 하단 카드 4건 삭제 확인
- 직원 피드백 수렴 ("고급스럽다" 평가 전 메뉴 확장 + "어둡고 보기 힘들다" 0건)

### 11-2. 운영 검증 흐름 (Harold + 직원 직접 — AI 영역 X)

- 모든 페이지 직접 시각 확인
- 모바일 반응형 동작 확인
- 사용자 흐름 단순화 확인 (AI Operator 1 입구)
- 매뉴얼 페이지 진입 흐름 확인

### 11-3. 영구 룰 정합 종결

본 작업 종결 후 메모리 신설 의무:
- `project_d222_violet_gradient_unification_completed.md` 신설
- 본 작업 흐름 + 영구 룰 정합 + Phase 1~5 종결 매트릭스 기록

---

## 12. 비토 (본 AI) 본 작업 의무 인지 매트릭스 ★

Harold 명시 흐름 = CTO 사명감 영구 룰 정합. 본 AI 의무:

1. **단순 fix X / 본질 깊은 root cause + 영구 정합 fix 의무**
2. **매 페이지 시인성 본 AI 직접 검증 의무** (§ 4 매트릭스 100% 정합 자가 확인)
3. **Harold 컨펌 받은 후 다음 단계 진입 의무** (Phase 종결 직후 즉시 진입 X)
4. **6,000사+ 운영 안전망 영역 의무** (사용자 영향 큰 작업 = 안정성 절대 의무)
5. **직원 피드백 정합 흐름 의무** ("고급스럽다" + "어둡고 보기 힘들다" 차단)
6. **본 핸드오프 + 기존 spec 100% 정합 의무** (변경 영역 발견 시 본 AI 즉시 신호 + Harold 컨펌 받기)

본 작업 = **한줄로 자체 디자인 정체성 통일 영역**. 진행 X / 의논만 단계 종결 후 새 세션 진입 흐름.

---

## 13. 영구 룰 정합 자가 검증 매트릭스 (본 핸드오프)

- [x] 박-단어 + D219+ 영구 룰 단어 0건
- [x] 모델명 / 도메인 / 사용자 매트릭스 / 회사 정보 X
- [x] sudo / tp-deploy-full / SSH 안내 X
- [x] F12 DevTools 안내 X
- [x] 옵션 추천 X (정답 1개 — 보라 그라데이션 통일)
- [x] Harold 보고 단어 그대로 인정
- [x] 영역/본질/정합 단어 자제

---

> **본 핸드오프 종결.** 다음 세션 진입 직전 = 본 핸드오프 § 2 영역 복붙 → 본 AI 정독 → Phase 1 진입.

---

## 14. 작업 완료 체크 매트릭스 ★ (각 Phase 종결 시 본 AI 직접 체크)

### Phase 1 — Dashboard + JourneysPage (계층 1 — 보라 그라데이션 톤 다운)

**예상 분량**: 8~10h

- [ ] Dashboard.tsx 전면 정정 진행
  - [ ] 배경 = `bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900` 적용
  - [ ] 헤더 nav 정정 (AI Operator 메뉴 제거 + 매뉴얼 메뉴 신규 추가)
  - [ ] AI 추천 발송 카드 → AI 자동발송 라벨 정정 + AI Operator 단일 진입
  - [ ] 하단 카드 4건 전수 삭제
  - [ ] 직접 타겟 발송 카드 제거 (헤더 nav 진입 흐름)
  - [ ] 고객 DB 업로드 카드 제거 (헤더 nav 진입 흐름)
  - [ ] DB 현황 본격 구현 (5 영역 — line chart + 미니 metric 4 + 도넛 2 + AI 인사이트 + cohort)
  - [ ] 시인성 매트릭스 100% 정합 (text-white/95/80/55 + violet-200)
- [ ] JourneysPage.tsx 정정 진행
  - [ ] 배경 = 블랙톤 → 보라 그라데이션 (톤 다운)
  - [ ] 카드 디자인 정정 (계층 1 매트릭스)
  - [ ] 시인성 매트릭스 100% 정합
- [ ] frontend tsc 0 errors
- [ ] 자가 grep (박/D219+ 영구 룰 단어/모델명/native dialog/이모지) = 0건
- [ ] Harold 시각 확인 + 직원 피드백 수렴
- [ ] Phase 1 종결 → 메모리 신설 + STATUS.md 업데이트 + Harold 직접 배포

### Phase 2 — Performance + CdpSettings + ContinuousOperator (계층 1)

**예상 분량**: 6~8h

- [ ] PerformancePage.tsx 정정 진행
- [ ] CdpSettingsPage.tsx 정정 진행
- [ ] ContinuousOperatorPage.tsx 정정 진행
- [ ] frontend tsc 0 errors
- [ ] 자가 grep = 0건
- [ ] Harold 시각 확인 + 직원 피드백 수렴
- [ ] Phase 2 종결 → 메모리 신설 + STATUS.md 업데이트 + Harold 직접 배포

### Phase 3 — InAppMessages + Email + Predictive + AiMemory + AiUsage + Segments + Onboarding (계층 1)

**예상 분량**: 10~12h

- [ ] InAppMessagesPage.tsx 정정 진행
- [ ] EmailCampaignsPage.tsx 정정 진행
- [ ] PredictivePage.tsx 정정 진행
- [ ] AiMemoryPage.tsx 정정 진행
- [ ] AiUsagePage.tsx 정정 진행
- [ ] SegmentsPage.tsx 정정 진행 (D219+ 다크 톤 → 보라 그라데이션 톤 다운 통일)
- [ ] OnboardingWizardPage.tsx 정정 진행 (D219+ 다크 톤 → 보라 그라데이션 톤 다운 통일)
- [ ] frontend tsc 0 errors
- [ ] 자가 grep = 0건
- [ ] Harold 시각 확인 + 직원 피드백 수렴
- [ ] Phase 3 종결 → 메모리 신설 + STATUS.md 업데이트 + Harold 직접 배포

### Phase 4 — AdminDashboard + 발송결과 + 고객 DB / 주소록 + 직접발송 (계층 2 — 흰 톤 + violet 액센트)

**예상 분량**: 8~10h

- [ ] AdminDashboard.tsx 정정 진행 (흰 톤 default + violet 액센트)
- [ ] CampaignResultsPage.tsx 정정 진행 (흰 톤 + 표 가독성 강화)
- [ ] CustomersPage / AddressBookPage 정정 진행 (흰 톤 + 폼 가독성)
- [ ] 직접발송 / 직접 타겟 발송 정정 진행 (흰 톤 + violet 액센트)
- [ ] **AiCustomSendFlow (1,246 라인 — D220+ Step 3 잔여 영역)** 진입 가능 (별 작업 또는 Phase 4 통합)
- [ ] frontend tsc 0 errors
- [ ] 자가 grep = 0건
- [ ] Harold 시각 확인 + 직원 피드백 수렴
- [ ] Phase 4 종결 → 메모리 신설 + STATUS.md 업데이트 + Harold 직접 배포

### Phase 5 — 매뉴얼 페이지 (Claude Design 수령 HTML 정정)

**예상 분량**: 4~6h

- [ ] Harold Claude Design 호출 후 수령 HTML 본 AI 정독
- [ ] 기존 `packages/frontend/public/manual/manual.html` 정정 또는 신규 `/manual` 라우트 신설 결정
- [ ] 헤더 매뉴얼 메뉴 진입 link 정합 확인
- [ ] 기존 footer 매뉴얼 link (Dashboard.tsx line 3873) 정리 (제거 또는 유지)
- [ ] 보안 흐름 유지 확인 (세션 검증 + DevTools 차단 + 인쇄 차단 + 이미지 드래그 차단 + 라이트박스)
- [ ] frontend tsc 0 errors (React 변환 시)
- [ ] Harold 시각 확인
- [ ] Phase 5 종결 → 메모리 신설 + STATUS.md 업데이트 + Harold 직접 배포

### 전체 종결 (Phase 1~5 모두 종결 시)

- [ ] 전 메뉴 시각 통일 확인 (계층 3 흐름 일관)
- [ ] 전 메뉴 시인성 강화 확인 (§ 4 매트릭스 100% 정합)
- [ ] 헤더 변경 + 매뉴얼 진입 흐름 정합 확인
- [ ] AI Operator 단일 진입 흐름 정합 (기존 한줄로 / 맞춤한줄 진입 link 0건)
- [ ] 대시보드 하단 카드 4건 삭제 확인
- [ ] 직원 피드백 수렴 ("고급스럽다" + "어둡다" 0건)
- [ ] 영구 룰 17건 정합 매트릭스 통과
- [ ] 최종 종결 메모리 신설 (`project_d222_violet_gradient_unification_completed.md`)
- [ ] Harold 최종 컨펌 + 운영 검증 흐름 (Harold + 직원 직접 — AI 영역 X)

---

> **본 작업 완료 체크 매트릭스 종결.** 각 Phase 진행 시 본 AI 직접 체크 + Harold 컨펌 받은 후 다음 Phase 진입 흐름 의무.
