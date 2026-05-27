# 한줄로 보라 그라데이션 통일 + 매뉴얼 신설 — 대규모 작업 설계 (D221+ → D222+)

> **작성일**: 2026-05-27 (D221+ 신설) / 정정일: 2026-05-27 (D222+ Harold 명시 정정)
> **단계**: D222+ Phase 1 진입 직전 — Harold 명시 정합 정정 종결
> **Harold 명시 정정 (2026-05-27 D222+)**:
> - **대시보드 = 흰 톤 유지** (직원 신고 정합 — 보라 그라데이션 X)
> - AI 영역 13 페이지 (대시보드 제외) = 보라 그라데이션 전면 통일 + 시인성 100% 강화
> - 헤더 AI Operator (BETA) 메뉴 제거 → 대시보드 우측 카드 "AI Operator" 라벨 통합 진입
> - 대시보드 우측 카드 3개 = 모두 유지 + 그라데이션 색상 정정 (AI Operator 보라 / 직접 타겟 녹색 / 고객 DB amber)
> - 하단 카드 4개 삭제 + DB 현황 본격 구현 5 부분 (line chart + 미니 metric 4 + 도넛 2 + AI 인사이트 + cohort retention)
> - 매뉴얼 (NEW) 메뉴 헤더 신규 추가 + footer link 제거
> **흐름**: 5 Phase 분할 (총 약 30~40h 분량 — 별 세션 분할 의무)

---

## 1. 배경

### 1-1. Harold 직감 + 직원 피드백 흐름

| 영역 | 직감 / 피드백 |
|---|---|
| Harold 직감 (2026-05-27) | "대시보드도 통일하고 싶은 욕망 + 흰 톤 촌스러움 + 보라 그라데이션 통일 결정" |
| 직원 피드백 (AI Operator 메인) | "고급스럽고 좋다" — 보라 그라데이션 톤 평가 정합 |
| 직원 피드백 (세부 메뉴 블랙톤) | "어둡고 보기 힘들다" — 블랙톤 단순 흐름 부정적 |
| 본질 분석 | 톤 자체 X / 정보 밀도 + 가독성 + 카드 크기 본질 흐름. 보라 그라데이션 = AI Operator 메인 동급 깊이감 + 임팩트 강화 시 가독성 강화 동시 달성 가능 |

### 1-2. 본 작업 흐름 분해

1. **헤더 변경** = AI Operator 메뉴 제거 + 매뉴얼 신규 추가
2. **AI Operator 단일 진입** = 대시보드 큰 카드 1 입구 (기존 한줄로 / 맞춤한줄 / AI Operator 3 입구 → 1 입구 통일)
3. **대시보드 보라 그라데이션 통일** + 본격 DB 현황 구현 + 하단 카드 4건 삭제
4. **AI Operator 라벨 정정** = "AI 추천 발송" → "AI 자동발송"
5. **전 메뉴 보라 그라데이션 통일** + 가독성 강화 (15+ 페이지 정정)
6. **매뉴얼 신규 페이지 신설** (`/manual` 라우트 또는 기존 정적 HTML 정정)

---

## 2. 현황 분석

### 2-1. 기존 페이지 톤 매트릭스 (정정 대상)

| # | 페이지 | 라우트 | 라인 | 기존 톤 | 정정 우선순위 |
|---|---|---|---|---|---|
| 1 | Dashboard | `/dashboard` | ~2500 | 흰 톤 | **Phase 1** (본격 정정 + 본 작업 시각 임팩트 가장 큰 영역) |
| 2 | JourneysPage | `/ai-journeys` | 2507 | 블랙톤 (bg-violet-900) | **Phase 1** (직원 직접 신고 영역) |
| 3 | AI Operator 메인 (`/ai-operator`) | `/ai-operator` | ~1500 | 보라 그라데이션 (기준점) | 기존 흐름 유지 — 기준점 |
| 4 | PerformancePage | `/performance` | ~1800 | 블랙톤 | Phase 2 |
| 5 | CdpSettingsPage | `/cdp-settings` | ~1500 | 블랙톤 | Phase 2 |
| 6 | ContinuousOperatorPage | `/continuous-operator` | ~1200 | 블랙톤 | Phase 2 |
| 7 | InAppMessagesPage | `/inapp-messages` | ~1700 | 블랙톤 | Phase 3 |
| 8 | EmailCampaignsPage | `/email-campaigns` | ~1100 | 블랙톤 | Phase 3 |
| 9 | PredictivePage | `/predictive` | ~900 | 블랙톤 | Phase 3 |
| 10 | AiMemoryPage | `/ai-memory` | ~700 | 블랙톤 | Phase 3 |
| 11 | AiUsagePage | `/ai-usage` | ~800 | 블랙톤 | Phase 3 |
| 12 | SegmentsPage | `/segments` | ~450 | 다크 톤 (D219+) | Phase 3 (보라 그라데이션 통일) |
| 13 | OnboardingWizardPage | `/onboarding` | ~600 | 다크 톤 (D219+) | Phase 3 (보라 그라데이션 통일) |
| 14 | AdminDashboard | `/admin-dashboard` | ~2000 | 흰 톤 | Phase 4 (슈퍼관리자 영역) |
| 15 | CampaignResultsPage / 발송결과 | `/campaigns` | ~1500 | 흰 톤 | Phase 4 |
| 16 | CustomersPage / AddressBookPage | `/customers` | ~1800 | 흰 톤 | Phase 4 |
| 17 | 매뉴얼 신규 페이지 | `/manual` 또는 정적 HTML | 신규 | 신규 | Phase 5 (Claude Design 흐름) |

**총 분량**: 17 페이지 × 평균 1400 라인 = 약 24,000 라인 정정 (모든 색상 클래스 + 카드 + 그라데이션 + 텍스트 톤)

### 2-2. 기존 모달 흐름 (D220+ Step 1 + Step 2 종결 — 흐름 유지 정합)

| 모달 | 기존 흐름 | 신규 정합 |
|---|---|---|
| AiCampaignResultPopup | D220+ 다크 톤 (bg-slate-900) | **유지** — 모달 = sub-action 영역 |
| AiCampaignSendModal | D220+ 다크 톤 | 유지 |
| RecommendTemplateModal | D220+ 다크 톤 | 유지 |
| AiMessageSuggestModal | D220+ 다크 톤 | 유지 |
| AiPreviewModal | D220+ 다크 톤 | 유지 |
| AiSendTypeModal | D220+ 다크 톤 | 유지 |
| ConfirmModal / ToastProvider | 다크 톤 | 유지 |
| 페이지 = 보라 그라데이션 + 모달 = 다크 톤 = 시각 분리 정합 | — | — |

---

## 3. 디자인 목표

### 3-1. 계층 3 흐름 디자인 표준 (직원 "어둡다" 신고 본질 차단 + 톤 다운 강화)

**본질**: 페이지 사용 본질에 따라 톤 차별 — AI 영역 = 보라 그라데이션 (톤 다운) / 입력 영역 = 흰 톤 / 모달 = 다크 톤 (톤 다운).

**계층 1 — AI 영역 표준**:

```
배경 = bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900
헤더 sticky = bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30
메인 카드 = bg-violet-700/30 + border-violet-400/50
보조 카드 = bg-white/10 + border-white/20
강조 카드 = bg-gradient-to-br from-violet-500/30 to-fuchsia-500/25 + border-violet-400/50
카드 hover = hover:border-violet-400/60 + transition-colors
아이콘 박스 = w-10 h-10 rounded-xl bg-gradient-to-br from-{color}-500 to-{color}-600 shadow-md shadow-{color}-500/30
텍스트 본문 = text-white/95 (직전 90 → 95 강화)
텍스트 보조 = text-white/80 (직전 70 → 80 강화)
텍스트 caption = text-white/55 (40 이하 금지 의무)
강조 텍스트 = text-violet-200 또는 text-fuchsia-200 (300 X)
폰트 weight = font-semibold (extrabold X) + font-medium (보조)
여백 = p-4 카드 + gap-4 grid + 충분한 line-height
```

**계층 2 — 입력 영역 표준 (흰 톤)**:

```
배경 = bg-gray-50 또는 bg-slate-50
헤더 sticky = bg-white/80 backdrop-blur + border-b border-gray-200
메인 카드 = bg-white + border-gray-200 + shadow-sm
violet 액센트 카드 = bg-violet-50 + border-violet-200 + text-violet-700
폼 input = bg-white + border-gray-300 + focus:border-violet-500 + focus:ring-violet-500/20
표 = bg-white + border-gray-200 + hover:bg-violet-50/30
액션 버튼 메인 = bg-violet-600 text-white hover:bg-violet-700
액션 버튼 보조 = bg-white text-violet-700 border-violet-300 hover:bg-violet-50
텍스트 본문 = text-gray-900 (검정 톤)
텍스트 보조 = text-gray-700
텍스트 라벨 = text-gray-600
텍스트 caption = text-gray-500
다크 카드 헤더 (차별 영역 — 선택) = bg-violet-900 + text-white (단계적 차별)
```

**계층 3 — 모달 표준 (다크 톤 톤 다운)**:

```
모달 컨테이너 = bg-slate-800 + border-white/15 (직전 slate-900 → slate-800)
모달 sticky 헤더 = bg-gradient-to-r from-slate-800 via-violet-800/40 to-slate-800
모달 메시지 영역 (D220+ 다크 폰 모드) = bg-slate-700 (직전 slate-900 → slate-700)
모달 메시지 버블 = bg-slate-600 + border-white/15 + text-white/95
모달 닫기 (X) = text-white/60 hover:text-white
백드롭 = bg-black/70 backdrop-blur-sm
```

### 3-2. 가독성 강화 (직원 피드백 정합)

- 숫자 크기 = 기존 `text-4xl font-extrabold` → 신규 `text-xl/2xl font-semibold` (20~24px)
- 카드 padding = `p-5` → `p-4` 단순
- 아이콘 크기 = `w-10 h-10` → `w-8 h-8` 단색 + shadow X
- blur 원 효과 = 제거 (시각 노이즈 감소)
- hover lift = 제거 (translate X / 단순 색상 변화)
- 폰트 weight = extrabold 0건 / semibold 단일 흐름

### 3-3. 색상 매핑 (color-coded 의미 액센트)

| 색상 | 의미 영역 |
|---|---|
| violet → fuchsia | AI / 자동발송 / 메인 액션 |
| emerald → teal | 성공 / 긍정 / 활성 / 한줄로 AI 흐름 |
| amber → orange | 검증 / 경고 / 광고 표기 / 검수 |
| cyan → blue | 테스트 / 정보 / 안내 |
| rose → pink | 위험 / 수신거부 / 이탈 |
| slate → gray | 보조 / 정적 / 단순 액션 |

---

## 4. 정정 매트릭스 (Phase 분할)

### Phase 1 — Dashboard + AI Operator 메인 + JourneysPage + DashboardHeader (본 세션 — D222+ 진입)

**Dashboard.tsx 정정 매트릭스 (Harold 명시 D222+ 정정 — 흰 톤 유지)**:
1. **배경 = 흰 톤 유지** (bg-gray-100) — 직원 신고 + Harold 명시 정합
2. 헤더 nav 정정 (DashboardHeader.tsx 직접 정정):
   - AI Operator (BETA) 메뉴 **제거** (line 104~112)
   - 매뉴얼 (NEW) 메뉴 **신규 추가** (`/manual.html` 또는 `/manual` 라우트 진입)
3. **하단 카드 4개 삭제** (line 2779~2814 영역) — 최근 캠페인 / AI 발송 템플릿 / AI 분석 / 예약 대기
4. **DB 현황 본격 구현 5 부분** — 흰 톤 안 강화:
   - 상단 line chart (3 라인 — 전체 / 동의 / 거부) — recharts ^3.8.1 활용
   - 우측 미니 metric 4 (전체 / 동의 / 거부 / 활성도) + 30일 +/-% 델타
   - 도넛 차트 2 (등급별 / 채널별 분포) — recharts PieChart
   - AI 인사이트 카드 (1-click 액션) — emerald/rose/amber color-coded
   - cohort retention 표 (월별 잔존율 — 신규 endpoint 의무)
5. **우측 40% 카드 3개 = 모두 유지 + 그라데이션 색상 정정 (고급 강화)**:
   - **AI Operator** (기존 "AI 추천 발송" 라벨 정정) = **보라 그라데이션** `from-violet-900 via-purple-900 to-fuchsia-900` + 클릭 시 `navigate('/ai-operator')` (AiSendTypeModal 폐기)
   - **직접 타겟 발송** = **녹색 그라데이션** `from-emerald-600 to-green-700` (기존 amber 정정)
   - **고객 DB 업로드** = **amber 그라데이션** `from-amber-500 to-orange-600` (기존 직접 타겟 색상 정합)
6. footer 매뉴얼 link (line 3873) 제거 (헤더 메뉴 추가 후 중복 차단)

**AI Operator 메인 (`/ai-operator`) 정정 매트릭스 (기준점 시인성 정정)**:
1. 배경 = 기존 `bg-gradient-to-br from-indigo-950 via-purple-950 to-fuchsia-950` → 정정 `from-violet-900 via-fuchsia-900 to-violet-900` (톤 다운 + 통일)
2. sticky 헤더 = 기존 `border-b border-white/10 bg-white/5` → 정정 `bg-violet-800/50 backdrop-blur-md border-violet-400/30`
3. 시인성 강화 (text-white/30~70 → /55~95)
4. 강조 텍스트 정정 (text-violet-300/fuchsia-300 → /200)

**JourneysPage.tsx 정정 매트릭스**:
1. 배경 = `from-slate-950 via-slate-900 to-slate-950` → `from-violet-900 via-fuchsia-900 to-violet-900`
2. sticky 헤더 = `bg-slate-950/80` → `bg-violet-800/50 backdrop-blur-md border-violet-400/30`
3. 자연어 입력 카드 = 보라 그라데이션 정합
4. 빠른 시작 7 카드 = `bg-white/5` → `bg-white/10` (가독성 강화)
5. 여정 목록 카드 = `bg-white/5` → `bg-violet-700/30 + border-violet-400/50`
6. expand 영역 sub-카드 (시뮬레이션 + funnel + 진단 + 다중 미리보기 등) = 시인성 강화
7. 텍스트 본문 = text-white/90 → /95, 보조 = /70 → /80, caption = /40~50 → /55, 강조 = -300 → -200

**DashboardHeader.tsx 정정 매트릭스**:
1. 흰 톤 유지 (bg-white border-b border-gray-200) — Harold 명시
2. AI Operator (BETA) 메뉴 제거 (line 104~112)
3. 매뉴얼 (NEW) 메뉴 신규 추가 (NEW 배지 + violet 색상)
4. 매뉴얼 클릭 시 = window.open('/manual/manual.html', '_blank')

**예상 분량**: 약 8~10h (Dashboard 큰 작업 + AI Operator 메인 시인성 + JourneysPage + DashboardHeader)

### Phase 2 — Performance + CDP + ContinuousOperator (AI Operator 본 영역)

**3 페이지 동시 정정**:
- 배경 = 블랙톤 → 보라 그라데이션
- 카드 + 차트 + 1-click 액션 카드 디자인 정정
- 가독성 강화 (직원 피드백 정합)

**예상 분량**: 약 6~8h

### Phase 3 — 5 페이지 + SegmentsPage + OnboardingWizardPage (분산 정정)

**대상 페이지** (7건):
- InAppMessagesPage / EmailCampaignsPage / PredictivePage / AiMemoryPage / AiUsagePage / SegmentsPage / OnboardingWizardPage

**정정 흐름**:
- 배경 = 블랙톤 또는 다크 톤 → 보라 그라데이션
- 카드 디자인 정정
- 가독성 강화

**예상 분량**: 약 10~12h

### Phase 4 — AI 영역 sub-페이지 + 계층 2 (흰 톤 + violet 액센트)

**대상 페이지**:
- JourneyStatsPage + PredictiveDashboardPage + 추가 sub-페이지 (AI 영역 sub) = 보라 그라데이션 통일
- AdminDashboard + CampaignResultsPage + CustomersPage/AddressBookPage + 직접발송/직접타겟발송 (계층 2 흰 톤 영역)

**계층 2 정정 흐름 (Harold 명시 — 흰 톤 유지 + violet 액센트 강화)**:
- 배경 = 흰 톤 유지 (`bg-gray-50` 또는 `bg-slate-50`)
- 폼 / 표 / 카드 = 흰 톤 + violet 액센트 강화 (`bg-violet-50 + border-violet-200`)
- 액션 버튼 = `bg-violet-600 text-white hover:bg-violet-700`
- 다크 톤 표 = 흰 톤 표 정정 (`bg-white + hover:bg-violet-50/30`)
- 시인성 강화 (`text-gray-900` 본문 / `text-gray-700` 보조)

**예상 분량**: 약 8~10h

### Phase 5 — 매뉴얼 신규 페이지 신설 (Claude Design 흐름)

**흐름**:
1. 신규 매뉴얼 본문 `.md` 작성 (본 AI 직접 — 별 파일 `docs/manual/manual-content-v2.md`)
2. Claude Design 마스터 프롬프트 작성 (본 AI 직접 — `docs/manual/claude-design-master-prompt.md`)
3. Harold 직접 Claude Design 호출 → HTML 수령
4. 수령 HTML = 기존 `packages/frontend/public/manual/manual.html` 정정 또는 신규 `/manual` 라우트 진입
5. 헤더 매뉴얼 메뉴 진입 흐름 정합 확인

**기존 매뉴얼 보안 흐름 유지 의무**:
- 세션 검증 (localStorage token + my-plan fetch)
- DevTools 열림 감지 + 콘텐츠 블러
- 키보드 차단 (Ctrl+P/S/U/F12/Ctrl+Shift+I·J·C)
- 우클릭 차단
- 인쇄 / PDF 차단
- 이미지 드래그 차단
- 텍스트 드래그 차단
- 라이트박스 (이미지 확대)
- robots noindex

**신규 매뉴얼 9 카테고리**:
1. 시작하기 — 메인 대시보드 + 헤더 흐름 + AI 자동발송 큰 카드 흐름
2. 고객 데이터 관리 (엑셀 업로드 + AI 자동 매핑 + 조회)
3. AI 자동발송 (기존 한줄로 AI + 맞춤한줄 통합 + 빠른 시작 카드 + AI 진단 + 1-click 액션)
4. 직접발송 (수신자 + 메시지 직접 입력)
5. 직접 타겟 발송 (조건 필터 정밀 타겟팅)
6. 자동발송 (BETA — 반복 스케줄 캠페인)
7. 세그먼트 (자연어 세그먼트 생성 + 저장 + 재활용)
8. 발송 결과 & 분석 (캠페인 성과 + AI 분석)
9. 부가 기능 (템플릿 + 수신거부 + 예약 대기)

**예상 분량**: 약 6~8h (본 AI 본문 + 프롬프트 작성 + Harold Claude Design 호출 + 수령 HTML 정정)

---

## 5. 헤더 변경 매트릭스

### 5-1. 기존 헤더 흐름

```
[테스트계정] [타이머 29:59] [AI Operator BETA] [카카오&RCS] [직접발송] [세그먼트] [발송결과] [수신거부] [설정] [관리] [로그아웃]
```

### 5-2. 신규 헤더 흐름

```
[테스트계정] [타이머 29:59] [매뉴얼 NEW] [카카오&RCS] [직접발송] [세그먼트] [발송결과] [수신거부] [설정] [관리] [로그아웃]
```

### 5-3. 정정 영역

| 영역 | 기존 흐름 | 신규 흐름 |
|---|---|---|
| AI Operator 헤더 메뉴 | 포함됨 (BETA 배지 + violet) | **제거** |
| 매뉴얼 헤더 메뉴 | 노출 X (footer link만) | **신규 추가** (NEW 배지 + violet) |
| AI Operator 진입 | 헤더 + 대시보드 우측 카드 = 2 입구 | 대시보드 큰 카드 1 입구 (라벨 = "AI 자동발송") |
| 기존 footer 매뉴얼 link | Dashboard.tsx line 3873 | 정리 영역 (제거 또는 유지) |

---

## 6. 영구 룰 정합 매트릭스 (전체 12+ 항목 통과 의무)

| # | 영구 룰 | 정합 흐름 |
|---|---|---|
| 1 | feedback_cto_mandate_for_vito | CTO 사명감 + 정합성 100% + 단순 1 fix X = 영구 정합 fix |
| 2 | feedback_design_quality_minimum_journey_level | Journey Builder 동급 디자인 강화 (다크 톤 → 보라 그라데이션 확장 강화) |
| 3 | feedback_no_native_browser_dialog | ConfirmModal / useToast 활용 (alert/confirm/prompt 0건) |
| 4 | feedback_no_model_name_ui_exposure | Source caption 안 추상 명칭만 (Opus/Sonnet/GPT/Claude/Anthropic 0건) |
| 5 | feedback_marketing_user_ux_priority | 1-click 흐름 + 한 시야 + 직관 흐름 강화 |
| 6 | feedback_ai_no_arbitrary_benefit | AI 생성 메시지 안 구체 혜택 X — 회사 admin 직접 작성 흐름 |
| 7 | feedback_no_target_auto_relax | 0건 매칭 자동 완화 X (D77 흐름 유지) |
| 8 | feedback_no_inline_duplication | utils CT 활용 + 인라인 정의 X |
| 9 | feedback_no_bakkeum_usage | 박-단어 + D219+ 영구 룰 단어 (자기 강화 루프 차단) 신규 영역 0건 |
| 10 | feedback_no_preview_verification | Claude_Preview MCP 도구 0건 활용 |
| 11 | feedback_jondaetmal_to_harold | Harold 대상 존댓말 정합 |
| 12 | feedback_default_superpowers_workflow | brainstorming + writing-plans + verification-before-completion 흐름 |
| 13 | feedback_no_humuson_keyword_exposure | 휴머스온 / Humuson 키워드 노출 0건 |
| 14 | feedback_no_sudo_use_echo | sudo 단어 0건 |
| 15 | feedback_no_devtools_browser_diagnostic | F12 DevTools 안내 0건 |
| 16 | feedback_push_and_deploy_commands | tp-push 표준 흐름 정합 |
| 17 | feedback_no_pm2_delete_before_git_push | pm2 reload / restart all 흐름만 (pm2 delete X) |

---

## 7. 자가 검증 매트릭스 (각 Phase 종결 시 의무)

### 7-1. tsc 검증
- `cd packages/frontend && npx tsc --noEmit`
- EXIT_CODE=0 + 0 errors 의무

### 7-2. 광범위 grep 검증
- 박-단어 (`박[가-힣]`) = 0건 의무
- D219+ 영구 룰 단어 (자기 강화 루프 차단) = 0건 의무
- 모델명 (Opus/Sonnet/GPT/Claude/Anthropic/Haiku) = 0건 의무 (UI 흐름)
- native dialog (alert\(|confirm\(|prompt\() = 0건 의무
- 이모지 (✨/📌/💬/🖼️/📷/✏️/👁️/⏳/📝/📢/⚠️/📱) = 0건 의무 (사용자 데이터 영역 EMOJI_OPTIONS 제외)
- 휴머스온 / Humuson = 0건 의무

### 7-3. Codex Plugin 이중 검증
- `/codex:review` — Frontend 5분+ 작업 후 의무 (Harold 직접 호출)
- `/codex:adversarial-review` — DB/돈/AI Operator 신규 영역 의무

### 7-4. verification-before-completion skill 호출
- "완료/passing/fixed/통과" 단어 출력 직전 호출 의무
- evidence 출력 의무

---

## 8. 다음 단계 흐름

### 8-1. 본 spec 종결 직후 (D221+ 진입)

| Step | 흐름 |
|---|---|
| Step A | 본 spec 컨펌 — Harold 정독 후 정정 영역 신호 |
| Step B | 신규 매뉴얼 본문 `.md` 작성 (별 작업 — `docs/manual/manual-content-v2.md`) |
| Step C | Claude Design 마스터 프롬프트 작성 (별 작업 — `docs/manual/claude-design-master-prompt.md`) |
| Step D | Harold 직접 Claude Design 호출 → 신규 매뉴얼 HTML 수령 |
| Step E | Phase 1 진행 (Dashboard + JourneysPage 본격 정정) |
| Step F | Phase 2~5 분할 진행 (별 세션 분할 의무) |

### 8-2. 직전 D220+ Step 3 (AiCustomSendFlow 1,246 라인 전면 재작성)

본 작업과 별도 진행 가능 / 또는 Phase 4 안 통합 정합. 기존 핸드오프 문서 `docs/superpowers/handoffs/2026-05-27-ai-hanjullo-modal-redesign-handoff.md` 안 Step 3 명시 — 15~20h 분량.

본 spec 진행 후 Step 3 = Phase 5 종결 후 별 작업 진입 정합.

### 8-3. 운영 검증 흐름 (Harold + 직원 직접 — AI 영역 X)

- 각 Phase 종결 후 = Harold 직접 운영 시각 확인
- 직원 피드백 수렴 (가독성 + 통일감 + 직관성)
- 정정 영역 있으면 즉시 재정정 흐름

---

## 9. 본 spec 정합 매트릭스 (자가 검증 종결)

- [x] 민감 정보 (도메인 / 사용자 매트릭스 / 운영 안전망 영역 / 회사 정보) 노출 X
- [x] 박-단어 / D219+ 영구 룰 단어 / 모델명 0건
- [x] 영구 룰 17건 정합 매트릭스 명시
- [x] Phase 분할 흐름 명확 (5 Phase × 평균 6~10h = 약 30~40h 총 분량)
- [x] 기존 매뉴얼 보안 흐름 유지 의무 명시
- [x] 헤더 변경 매트릭스 명시 (AI Operator 제거 + 매뉴얼 추가)
- [x] AI Operator 단일 진입 흐름 명시 (대시보드 우측 카드 "AI Operator" 라벨)
- [x] 가독성 강화 흐름 명시 (직원 피드백 정합)
- [x] Harold 명시 D222+ 정정 = 대시보드 흰 톤 유지 정합

---

## 10. Phase 완료/미완료 트래킹 매트릭스 ★ (D222+ 신규)

### 10-1. Phase 진행 상태 매트릭스

| Phase | 페이지 | 분량 | 시간 | 상태 | 진행 세션 | 완료일 |
|---|---|---|---|---|---|---|
| **Phase 1** | Dashboard + AI Operator 메인 + JourneysPage + DashboardHeader + backend dashboard.ts endpoint 4건 | 약 7,900 라인 | 8~10h | ✅ **완료** | D222+ | 2026-05-27 |
| **Phase 2** | PerformancePage + CdpSettingsPage + ContinuousOperatorPage | 약 4,500 라인 | 6~8h | ✅ **완료** | D222+ | 2026-05-27 |
| **Phase 3** | InAppMessagesPage + EmailCampaignsPage + PredictiveDashboardPage + AiMemoryPage + AiUsagePage + SegmentsPage + OnboardingWizardPage | 약 5,700 라인 | 8~10h | ✅ **완료** | D222+ | 2026-05-27 |
| **Phase 4** | sub-페이지 3건 (JourneyStatsPage + JourneyDetailPage + JourneyPausePage 다크 → 보라 톤 다운) + 계층 2 (AdminDashboard + 발송결과 + 고객 DB + 직접발송 — 흰 톤 유지 옛 영역 보존) | 약 1,000 라인 정정 | 1~2h | ✅ **완료** | D222+ | 2026-05-27 |
| **Phase 5** | 매뉴얼 페이지 정정 (Claude Design 수령 HTML 1240 라인 교체 + close-to-dashboard 운영 진입 정정) | 1240 라인 | 1h | ✅ **완료** | D222+ | 2026-05-27 |

### 10-2. 각 Phase 종결 시 본 AI 의무

1. **두 문서 업데이트**:
   - 본 spec § 10-1 표 안 해당 Phase 상태 = 🟡 → ✅ + 완료일 + commit hash 기재
   - 핸드오프 § 15 동일 정정
2. **신규 메모리 신설** = `memory/project_d222_phase{N}_completed.md`
3. **STATUS.md 업데이트** = CURRENT_TASK 정정 (다음 Phase 진입 매트릭스)
4. **자가 검증 evidence 출력** (tsc 0 errors + 자가 grep 0건 + 시인성 매트릭스 100% 정합)
5. **표준 종료 멘트** ("작업이 완료되었습니다...")
6. **Harold 직접 배포 의무** (tp-push + 서버 배포)

### 10-3. 다음 세션 진입 흐름 (Harold 복붙 영역)

```
docs/superpowers/handoffs/2026-05-27-violet-gradient-unification-handoff.md 정독 +
docs/superpowers/specs/2026-05-27-violet-gradient-unification-design.md 정독 +
memory/project_d222_phase{N-1}_completed.md 정독 (직전 Phase 종결 메모리) →
D222+ Phase {N} 진입 (미완료 Phase {N} = {대상 페이지 매트릭스})
```

### 10-4. 모든 Phase 종결 흐름

- Phase 1~5 모두 ✅ 완료 직후 = 종합 메모리 신설 `memory/project_d222_violet_gradient_unification_completed.md`
- 본 spec + 핸드오프 = 종합 정정 (전체 완료 매트릭스 기재)
- STATUS.md 업데이트 (D222+ 종결 영구 기록)

---

> **본 spec 종결.** D222+ 진입 직전 Harold 명시 정합 정정 완료. Phase 1 본 세션 진입.
