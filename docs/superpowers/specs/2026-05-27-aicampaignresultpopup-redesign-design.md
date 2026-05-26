# AiCampaignResultPopup 전면 재작성 — 디자인 설계 (D220+ Step 1)

> **작성일**: 2026-05-27
> **단계**: D220+ Step 1 — 한줄로AI / 맞춤한줄 모달 7건 전면 재작성 1/7
> **흐름**: Superpowers brainstorming skill (Q1~Q5 Harold 컨펌 + 섹션 5건 디자인 컨펌)
> **영구 룰 정합**: feedback_design_quality_minimum_journey_level + feedback_no_native_browser_dialog + feedback_no_model_name_ui_exposure + feedback_marketing_user_ux_priority + feedback_no_bakkeum_usage + feedback_cto_mandate_for_vito

---

## 1. 배경

### 1-1. Harold 캡처 신고 (2026-05-27)

- 캡처 모달 = `packages/frontend/src/components/AiCampaignResultPopup.tsx` "AI 추천 결과 - 타겟 & 채널"
- 사용자 직접 평가 = "디자인 스킬 대비 시대 흐름 떨어짐 + 조잡 — 전체 손 본 의무 + 한줄로AI + 맞춤한줄 UI 전부" (Harold 표현 정합 재서술 — D219+ Part 1 영구 룰 정합)
- D215+ `feedback_design_quality_minimum_journey_level` 영구 룰 = "신규 메뉴 / 페이지 / UI 디자인 = 최소 AI 여정 (Journey Builder `/ai-journeys`) 동급 퀄리티 의무"

### 1-2. 본 모달 사용 흐름

- 캠페인 생성 페이지 → AI 추천 진입 → 본 모달 진입
- aiStep 1 = 타겟 + AI 추천 채널 + 광고성 + 채널 선택 → 다음 (메시지 생성)
- aiStep 2 = 메시지 3안 선택 + 미리보기 + 스팸필터 + 담당자 테스트 → 캠페인 확정
- 6,000사+ 운영 + 가장 자주 노출 영역

---

## 2. 현황 분석 (기존 451 라인)

### 2-1. 기존 구조

- 단일 컴포넌트 + 2 step 외부 컨트롤 (aiStep 1/2)
- props 33건 (외부 시그니처)
- LMS 자동 전환 sub-modal 내부 정의 (`showLmsAlert` + `lmsAlertBytes` state)

### 2-2. 기존 디자인 (D215+ 누락 흐름)

- `bg-white` + `bg-green-50` (헤더) + `bg-blue-50` (타겟) + `bg-purple-50` (채널) + `bg-yellow-50` (광고성) + `bg-gray-50` (바이트 하단) — 라이트 톤 흐름
- sticky 헤더 X / BETA 배지 X / 그라데이션 아이콘 X
- AI 자율 진단 카드 X (단순 박스 3건)
- 6 sub-agent 진행 시각 효과 X (단순 spin 이모지 ⏳)
- Source caption X
- 1-click 액션 3 카드 X (5 버튼 가로 배치)
- 모바일 반응형 X (`w-[600px]` / `w-[960px]` 고정)
- 이모지 9건 (✨ 📌 📱 💬 🖼️ 📷 ✏️ ✅ 👁️)

### 2-3. 보존 의무 흐름

- aiStep 1/2 외부 컨트롤 + props 33건 시그니처 (호출 위치 변경 X)
- `handleAiGenerateChannelMessage` / `handleTestSend` / `setShow*` 6 콜백 호환
- 0건 매칭 차단 (D77)
- `highlightVars` + `buildAdMessageFront` / `buildAdSubjectFront` + LMS 자동 전환 흐름 (90byte 초과)
- `MmsImagePreview` / `replaceVarsBySampleCustomer` 의존성

---

## 3. 디자인 목표 (D215+ Journey Builder 동급 의무)

- 다크 톤 (`bg-slate-900` + `border-white/10` + violet 액센트)
- sticky 헤더 + BETA 배지 + 그라데이션 아이콘
- AI 자율 진단 카드 (violet → fuchsia + Sparkles + topInsight 한 줄)
- 6 sub-agent 진행 시각 효과 (target → count → channel → message → compliance → schedule)
- 1-click 액션 3 카드 (color-coded amber / cyan / emerald)
- Source caption (`Data source — AI 추천 (자율 진단 + customer-filter)`)
- 모바일 자동 풀스크린 (`max-md:inset-0`)
- ConfirmModal 패턴 (LMS sub-modal 다크 톤 정정)
- lucide-react 아이콘 (이모지 9건 전수 정정)
- 모델명 노출 X (Source caption 안 추상 명칭만)

---

## 4. 5 섹션 디자인 디테일

### 섹션 1 — 모달 컨테이너 + sticky 헤더

**외곽**:
- `fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50`

**컨테이너**:
- `w-full max-w-5xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto`
- 모바일 = `max-md:inset-0 max-md:fixed max-md:max-w-none max-md:max-h-none max-md:rounded-none`

**sticky 헤더**:
- `sticky top-0 z-30 bg-gradient-to-r from-slate-950 via-violet-950/40 to-slate-950 backdrop-blur-sm border-b border-white/10 px-6 py-4`
- 좌측 = 10x10 rounded-xl violet→fuchsia 그라데이션 아이콘 + Sparkles (text-white) + shadow-violet-500/30 + 제목 (`text-white font-bold text-lg`) + BETA 배지 + sub-라벨 (`text-xs text-white/50` → "타겟 & 채널 확인" / "캠페인 메시지 확정")
- 우측 (Step 2만) = "← 채널 변경" + "👁️ 미리보기" 작은 텍스트 버튼 (`text-xs text-white/60 hover:text-white`) + 닫기 (X) 아이콘

**BETA 배지**:
- `px-2 py-0.5 text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-400/30 rounded`

**보존 흐름**:
- Step 1/2 동일 모달 크기 (max-w-5xl) — 기존 600px → 960px 크기 점프 제거
- aiStep 토글 = 외부 컨트롤 그대로

---

### 섹션 2 — Step 1 흐름

**AI 자율 진단 카드 1건**:
- `rounded-xl bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-violet-500/10 border border-violet-400/20 p-5`
- 좌상단 8x8 rounded-lg violet→fuchsia 그라데이션 아이콘 + Sparkles
- 우측 = `text-xs text-violet-300 font-medium` ("AI 자율 진단") + `text-sm text-white/90 leading-relaxed` (topInsight 한 줄)
- 내부 grid (`grid-cols-2 max-md:grid-cols-1 gap-3`):
  - 타겟 카드 = `bg-white/5 border border-white/10 rounded-lg p-3` + Users 아이콘 + description + `text-2xl text-violet-300 font-bold` count + "명"
  - 채널 카드 = `bg-white/5 border border-white/10 rounded-lg p-3` + Smartphone 아이콘 + channel + `text-fuchsia-300 font-bold` + channelReason
- Source caption = `text-[10px] text-white/30 italic mt-3` ("Data source — AI 추천 (자율 진단 + customer-filter)")

**광고성 toggle 라인**:
- `rounded-xl bg-amber-500/5 border border-amber-400/20 p-4 flex items-center justify-between`
- 좌측 = 8x8 rounded-lg + amber-500/20 + Megaphone 아이콘 (amber-300) + 라벨 + 안내
- 우측 = toggle (`peer-checked:bg-amber-500`)

**채널 선택 3 카드**:
- `grid grid-cols-3 gap-2`
- 각 카드 = `flex items-center justify-center gap-2 py-3 rounded-lg border transition-all`
- 기본 = `border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:border-white/20`
- 선택 = `border-violet-400/50 bg-violet-500/10 text-violet-200 shadow-lg shadow-violet-500/20`
- 아이콘 = `MessageSquare` (SMS) / `FileText` (LMS) / `Image` (MMS)

**0건 차단 카드 (D77 유지)**:
- `rounded-xl bg-rose-500/10 border border-rose-400/30 p-4 text-center`
- AlertTriangle 아이콘 (rose-300) + "추출된 고객이 0명입니다" + "타겟 조건을 정정하거나, 고객 DB에 데이터를 업로드해주세요."

**다음 버튼**:
- `w-full py-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white rounded-xl font-medium hover:from-violet-500 hover:to-fuchsia-500 shadow-lg shadow-violet-500/30 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all`
- aiLoading false / count > 0 = "다음 — AI 메시지 생성" + ArrowRight 아이콘
- aiLoading true = 섹션 3 진행 카드로 자동 대체 (다음 버튼 자리)
- count === 0 = disabled + "추출된 고객이 0명입니다. 다시 추출해주세요"

**topInsight 생성 흐름**:
- `aiResult?.topInsight` 우선 (외부 AI 호출 결과 — backend 신규 응답 협의 영역)
- fallback = `` `${aiResult?.target?.description} ${count.toLocaleString()}명에게 ${aiResult?.recommendedChannel} 발송이 최적입니다.` ``

---

### 섹션 3 — Step 1 → Step 2 6 sub-agent 로딩 시각 효과

**컨테이너** (다음 버튼 자리 인라인 대체):
- `rounded-xl bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-violet-500/10 border border-violet-400/20 p-5`

**헤더**:
- `flex items-center gap-2 text-violet-300 font-medium text-sm mb-4`
- Loader2 (animate-spin) + "AI가 메시지를 생성 중입니다"

**6 sub-agent 리스트** (`space-y-2`):

| id | 라벨 | 아이콘 | doneMs |
|---|---|---|---|
| target | 타겟 분석 | Target | 0 (즉시 ✓) |
| count | 고객 수 집계 | Users | 0 (즉시 ✓) |
| channel | 채널 선정 | Smartphone | 0 (즉시 ✓) |
| message | 메시지 생성 | Sparkles | -1 (진행 중 — 실제 aiLoading false 까지) |
| compliance | 광고법 검수 | Shield | 1400ms |
| schedule | 발송 준비 | Calendar | 2800ms |

**각 항목 디자인** (`flex items-center gap-3 px-3 py-2 rounded-lg transition-all`):
- 대기 = `bg-white/5 border-white/10 text-white/30` + 기본 아이콘
- 진행 중 = `bg-violet-500/10 border-violet-400/30 shadow-md shadow-violet-500/10` + Loader2 spinner + `text-violet-200 font-medium`
- 완료 = `bg-emerald-500/10 border-emerald-400/20` + Check 아이콘 (emerald-300) + `text-emerald-200`

**state 흐름** (신규 내부 state):
- `elapsedMs: number` + `useState(0)`
- `loadingPhase: 'idle' | 'running' | 'done'`
- `useEffect`:
  - aiLoading true → loadingPhase 'running' + `setInterval(() => setElapsedMs(v => v + 100), 100)` + cleanup return
  - aiLoading false → loadingPhase 'idle' + elapsedMs reset

---

### 섹션 4 — Step 2 흐름

**6 sub-agent 결과 카드** (헤더 직후 — Step 2 진입 신호):
- `rounded-xl bg-emerald-500/5 border border-emerald-400/20 p-4`
- 헤더 = Check 아이콘 (emerald-300) + "AI 진단 종결 — 6 단계 완료" (`text-emerald-300 font-medium text-sm`)
- grid (`grid-cols-3 max-md:grid-cols-2 gap-2`) = 6 항목 (각 카드 = `bg-white/5 border-white/10 rounded-lg px-3 py-2` + Check + 라벨)
- Source caption = "Data source — AI 6 sub-agent (자율 진단)"

**선택 채널 + 광고성 칩 라인**:
- `flex items-center gap-2 text-xs text-white/60`
- "선택된 채널:" + 채널 칩 (`px-2 py-0.5 bg-violet-500/20 text-violet-200 border border-violet-400/30 rounded font-medium`)
- 광고성 시 칩 (`px-2 py-0.5 bg-amber-500/20 text-amber-200 border border-amber-400/30 rounded font-medium`)

**메시지 3안 폰 UI carousel**:
- `grid grid-cols-3 max-md:grid-cols-1 gap-4`
- 폰 외곽 = `rounded-[1.8rem] p-[3px] transition-all bg-slate-800 group-has-[:checked]:bg-gradient-to-b group-has-[:checked]:from-violet-400 group-has-[:checked]:to-fuchsia-500 group-has-[:checked]:shadow-lg group-has-[:checked]:shadow-violet-500/30`
- 폰 안 = `bg-slate-900 rounded-[1.6rem] overflow-hidden flex flex-col h-[420px]`
- 폰 헤더 = `px-4 py-2.5 bg-gradient-to-r from-slate-950 to-violet-950/30 flex justify-between items-center border-b border-white/5 shrink-0`
  - 좌측 = "문자메시지" (`text-[11px] text-white/40 font-medium`)
  - 우측 = 수정 버튼 (선택 시) + variant_name 칩 (`text-[11px] font-bold text-violet-300`)
- LMS/MMS subject = `px-4 py-1.5 bg-amber-500/10 border-b border-amber-400/20 shrink-0` + `text-[11px] font-bold text-amber-300`
- 메시지 영역 = `flex-1 overflow-y-auto p-3 bg-white` (실제 폰 시각 보존)
  - 메시지 버블 = `bg-white border border-gray-100 rounded-2xl rounded-tl-sm p-3 shadow-sm text-[12px] leading-[1.6] whitespace-pre-wrap break-all text-gray-700 max-w-[95%]`
  - 아이콘 = `w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center` + Smartphone 아이콘
  - 변수 하이라이트 = `highlightVars` 그대로
- 수정 모드 = textarea (`bg-white text-gray-800 border-violet-300 focus:ring-violet-400 focus:ring-2`) + 저장 버튼 (`bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-[11px] font-medium rounded-lg hover:from-violet-500 hover:to-fuchsia-500`)
- 바이트 하단 = `px-3 py-2 border-t border-white/5 bg-slate-950 text-center shrink-0`
  - 정상 = `text-[10px] text-white/40`
  - 초과 = `text-[10px] text-rose-400 font-bold` + AlertTriangle 아이콘 + "SMS 90바이트 초과 — LMS 전환 필요"

**MMS 이미지 첨부** (MMS 선택 시만):
- `border-2 border-dashed border-white/15 rounded-xl p-4 bg-white/5 cursor-pointer hover:border-violet-400/50 hover:bg-violet-500/10 transition-all`
- 첨부됨 = MmsImagePreview + `text-sm text-violet-300 font-medium` + Edit3 아이콘 + "{N}장 첨부됨 (클릭하여 정정)"
- 빈 영역 = 12x12 rounded-full `bg-white/5 border-white/10` + Camera 아이콘 (white/40) + "클릭하여 이미지를 첨부합니다" + "JPG만 · 300KB 이하 · 최대 3장"

**testSentResult 안내** (있을 때만):
- `rounded-xl p-3 text-sm whitespace-pre-wrap`
- 성공 (`✅` 시작) = `bg-emerald-500/10 border border-emerald-400/30 text-emerald-300`
- 실패 = `bg-rose-500/10 border border-rose-400/30 text-rose-300`

**1-click 3 액션 카드** (`grid grid-cols-3 max-md:grid-cols-1 gap-3`):

- **카드 1 — 검증 (amber)**:
  - `rounded-xl bg-amber-500/10 border border-amber-400/30 hover:bg-amber-500/20 hover:border-amber-400/50 p-4 text-left transition-all`
  - 좌상단 8x8 rounded-lg + amber-500/20 + ShieldCheck (amber-300)
  - `text-xs text-amber-200 font-medium` ("검증")
  - `text-sm text-white font-bold` ("스팸필터 테스트")
  - `text-[11px] text-white/50` ("금지 단어 + 발신번호 검증")

- **카드 2 — 테스트 (cyan)**:
  - `rounded-xl bg-cyan-500/10 border border-cyan-400/30 hover:bg-cyan-500/20 hover:border-cyan-400/50 p-4 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed`
  - 좌상단 cyan-500/20 + Send 아이콘 (testSending 시 Loader2)
  - `text-xs text-cyan-200 font-medium` ("테스트")
  - `text-sm text-white font-bold` (testSending → "발송 중..." / testCooldown → "10초 대기" / 기본 "담당자 테스트")
  - `text-[11px] text-white/50` ("내 휴대전화로 1건 발송")

- **카드 3 — 메인 액션 (emerald)**:
  - `rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-500/10 border border-emerald-400/40 hover:from-emerald-500/30 hover:to-emerald-500/20 hover:border-emerald-400/60 p-4 text-left transition-all shadow-lg shadow-emerald-500/20`
  - 좌상단 emerald-500/30 + CheckCircle2 (emerald-300)
  - `text-xs text-emerald-200 font-medium` ("메인 액션")
  - `text-sm text-white font-bold` ("캠페인 확정")
  - `text-[11px] text-white/50` ("발송 시간 + 회신번호 설정")

---

### 섹션 5 — LMS sub-modal + 디테일

**LMS 자동 전환 sub-modal** (90byte 초과 시 — 본 모달 안 내부):
- 외곽 = `fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[70]`
- 컨테이너 = `bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden`
- 헤더 = `p-5 bg-gradient-to-r from-amber-500/20 to-orange-500/10 border-b border-white/10`
  - 10x10 rounded-xl + amber-500/20 + border-amber-400/30 + FileText 아이콘 (amber-300)
  - 제목 (`text-white font-bold text-base` — "메시지 길이 초과")
- 본문 (`p-5`):
  - byte 표시 중앙 = `text-3xl font-bold text-rose-300` + " / 90 byte" (`text-base text-white/40`) + "SMS 제한을 초과했습니다" (`text-white/60 text-sm`)
  - LMS 안내 박스 = `bg-violet-500/10 border border-violet-400/30 rounded-lg p-3` + violet-200 본문 ("LMS로 전환하시겠습니까?" + "LMS는 최대 2,000byte까지 발송 가능합니다")
  - 2 버튼:
    - 닫기 = `flex-1 py-2.5 border border-white/20 rounded-lg text-white/70 font-medium hover:bg-white/5 transition-colors`
    - LMS 전환 = `flex-1 py-2.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white rounded-lg font-medium hover:from-violet-500 hover:to-fuchsia-500 shadow-md shadow-violet-500/30 transition-all`

**lucide-react 아이콘 통합 import** (22 아이콘):
- `Sparkles, X, ArrowLeft, Eye, Users, Smartphone, Megaphone, MessageSquare, FileText, Image, AlertTriangle, Loader2, ArrowRight, Target, Shield, Calendar, Check, CheckCircle2, ShieldCheck, Send, Camera, Edit3`

**기존 이모지 9건 전수 정정**:
| 이모지 | 정정 아이콘 |
|---|---|
| ✨ | Sparkles |
| 📌 | Target |
| 📱 | Smartphone / Send |
| 💬 | MessageSquare |
| 🖼️ | Image |
| 📷 | Camera |
| ✏️ | Edit3 |
| ✅ | Check / CheckCircle2 |
| 👁️ | Eye |
| ⏳ | Loader2 (animate-spin) |
| 📝 | FileText |
| 📢 | Megaphone |
| ⚠️ | AlertTriangle |

**Source caption 위치** (총 2건 — 과다 X):
- Step 1 진단 카드 안 = "Data source — AI 추천 (자율 진단 + customer-filter)"
- Step 2 6 sub-agent 결과 카드 안 = "Data source — AI 6 sub-agent (자율 진단)"

**모바일 자동 풀스크린**:
- 모달 외곽 = `max-md:inset-0 max-md:max-w-none max-md:max-h-none max-md:rounded-none`
- 모든 grid = `max-md:grid-cols-1` (Step 2 폰 UI carousel + 1-click 3 카드 자동 세로 stacked)
- sticky 헤더 유지 = 모바일에서도 항상 보임

**모델명 노출 X 자가 검증**:
- UI 안 "Opus / Sonnet / GPT / Claude / Anthropic" 단어 grep = 0건 의무
- Source caption 안 추상 명칭만 ("AI 추천 / AI 6 sub-agent / 자율 진단")

---

## 5. 컴포넌트 구조 (props 시그니처 유지)

### 5-1. 외부 props 33건 (보존 의무)

`show`, `onClose`, `aiStep`, `setAiStep`, `aiResult`, `setAiResult`, `selectedChannel`, `setSelectedChannel`, `selectedAiMsgIdx`, `setSelectedAiMsgIdx`, `editingAiMsg`, `setEditingAiMsg`, `isAd`, `setIsAd`, `user`, `aiLoading`, `handleAiGenerateChannelMessage`, `testSentResult`, `testSending`, `testCooldown`, `handleTestSend`, `setShowPreview`, `setShowAiSendModal`, `setShowSpamFilter`, `setSpamFilterData`, `setShowMmsUploadModal`, `mmsUploadedImages`, `setMmsUploadedImages`, `wrapAdText`, `calculateBytes`, `optOutNumber`, `selectedCallback`, `campaign`, `formatRejectNumber`, `targetRecipients?`, `sampleCustomer?`

### 5-2. 신규 내부 state (Step 1 → Step 2 로딩 시각 효과 흐름)

- `elapsedMs: number` (기본 0)
- `loadingPhase: 'idle' | 'running' | 'done'` (기본 'idle')
- `useEffect` aiLoading 흐름 (interval 100ms tick + cleanup)

### 5-3. 보존 내부 state

- `showLmsAlert: boolean`
- `lmsAlertBytes: number`

### 5-4. 보조 함수 (내부 정의 — utils CT 신설 X)

- `handleSpamFilterClick` = onClick inline → 함수 분리 (가독성)
- `handleConfirmClick` = onClick inline (SMS bytes > 90 → LMS sub-modal 진입) → 함수 분리
- 단순 UI 흐름 = utils CT-99 신설 X (CT-77~98 영역 X)

---

## 6. 외부 의존성

### 6-1. 변경 X (보존)

- `formatPreviewValue`, `buildAdMessageFront`, `buildAdSubjectFront`, `replaceVarsBySampleCustomer` (utils/formatDate)
- `highlightVars` (utils/highlightVars)
- `MmsImagePreview` (components/shared)

### 6-2. 신규 추가

- lucide-react 아이콘 22건 (위 § 4 섹션 5 리스트)
- 기존 import 0건 → 22건 신규 추가

---

## 7. 자가 검증 매트릭스 (Spec 단계)

### 7-1. 디자인 룰 정합

- [x] D215+ Journey Builder 동급 디자인 요소 (다크 톤 + violet 액센트 + sticky 헤더 + AI 자율 진단 카드 + 6 sub-agent + 1-click 3 카드 + Source caption + 모바일 반응형 + lucide-react 아이콘)
- [x] feedback_design_quality_minimum_journey_level 영구 룰 정합
- [x] feedback_no_native_browser_dialog — LMS sub-modal 다크 톤 정정 (alert/confirm/prompt 0건)

### 7-2. 영구 룰 정합

- [x] feedback_no_model_name_ui_exposure — Source caption 안 추상 명칭만 (Opus/Sonnet/GPT/Claude/Anthropic 0건)
- [x] feedback_marketing_user_ux_priority — 1-click 3 카드 + 한 시야 + 직관 흐름
- [x] feedback_ai_no_arbitrary_benefit — 본 모달 안 메시지 본문 = `highlightVars` 활용 (외부 AI 호출 결과 그대로 — 본 모달 안 구체 혜택 생성 X)
- [x] feedback_no_target_auto_relax — D77 0건 차단 카드 유지 (자동 완화 X)
- [x] feedback_no_inline_duplication — utils CT 활용 보존 (formatDate / highlightVars)
- [x] feedback_no_bakkeum_usage — Spec 안 박-단어 0건 의무 (자가 grep 후 출력)
- [x] feedback_no_preview_verification — Claude_Preview MCP 도구 0건 활용
- [x] feedback_jondaetmal_to_harold — Spec 안 한국어 자연 흐름
- [x] feedback_cto_mandate_for_vito — 디자인 단순 fix X / 5 섹션 통합 정정 / 6,000사+ 운영 안전망 영역

### 7-3. 보존 흐름 정합

- [x] props 33건 시그니처 유지 (외부 호출 위치 정정 X)
- [x] aiStep 1/2 외부 컨트롤 유지
- [x] 0건 매칭 차단 (D77) 유지
- [x] LMS 자동 전환 (90byte 초과) 흐름 유지
- [x] `highlightVars` + `buildAdMessageFront` / `buildAdSubjectFront` / MMS 첨부 흐름 유지

---

## 8. 다음 단계

### 8-1. writing-plans skill 진입 (Spec 컨펌 후)

- `superpowers:writing-plans` skill 호출 → Plan 매트릭스 (단계 분할) 작성
- 본 세션 안 단계별 진행 (`superpowers:subagent-driven-development`) 또는 별 세션 분할 (`superpowers:executing-plans`)

### 8-2. 예상 구현 흐름 (5단계 분할)

| Phase | 영역 | 분량 |
|---|---|---|
| Phase 1 | 모달 컨테이너 + sticky 헤더 (섹션 1) + lucide-react import | 30분 |
| Phase 2 | Step 1 흐름 전체 (섹션 2) | 1.5h |
| Phase 3 | 6 sub-agent 로딩 시각 효과 (섹션 3) + state/useEffect | 1h |
| Phase 4 | Step 2 흐름 전체 (섹션 4) — 폰 UI + 1-click 3 카드 + MMS | 2h |
| Phase 5 | LMS sub-modal + 디테일 마무리 (섹션 5) + 자가 검증 | 30분 |

**총 분량 = 약 5h** (단일 세션 처리 가능 — 핸드오프 §3 Step 1 4~5h 예상 일치)

### 8-3. 자가 검증 흐름 (구현 직후 의무)

- frontend tsc = 0 errors
- 박-단어 광범위 grep = 0건 (`박[가-힣]`)
- D219+ 영구 룰 단어 (자기 강화 루프 차단 단어) grep = 0건
- 모델명 grep = 0건 (Opus/Sonnet/GPT/Claude/Anthropic)
- native dialog grep = 0건 (alert/confirm/prompt)
- 이모지 grep = 0건 (✨/📌/📱/💬/🖼️/📷/✏️/✅/👁️/⏳/📝/📢/⚠️)
- Codex Plugin `/codex:review` 이중 검증 (영구 룰 codex_review_after_code_change)
- superpowers:verification-before-completion skill 호출 + evidence 출력 의무

### 8-4. 운영 검증 (Harold + 직원 직접 영역 — AI 영역 X)

- 캠페인 생성 → AI 추천 진입 → Step 1 디자인 + 흐름 확인
- 다음 클릭 → 6 sub-agent 로딩 흐름 확인 (700ms 간격 + 색상 신호등)
- Step 2 폰 UI carousel + 메시지 수정 + MMS 첨부 + 1-click 3 카드 흐름 확인
- LMS 자동 전환 (90byte 초과) sub-modal 다크 톤 확인
- 모바일 자동 풀스크린 흐름 확인

---

## 9. 영구 룰 정합 매트릭스 (전체 11건 통과)

| # | 영구 룰 | Spec 정합 |
|---|---|---|
| 1 | feedback_cto_mandate_for_vito | CTO 사명감 + 5 섹션 통합 정정 |
| 2 | feedback_design_quality_minimum_journey_level | Journey Builder 동급 11 의무 요소 |
| 3 | feedback_no_native_browser_dialog | ConfirmModal 패턴 (LMS sub-modal 다크 톤) |
| 4 | feedback_no_model_name_ui_exposure | Source caption 추상 명칭만 |
| 5 | feedback_marketing_user_ux_priority | 1-click 3 카드 + 한 시야 |
| 6 | feedback_ai_no_arbitrary_benefit | 메시지 본문 외부 AI 결과 그대로 |
| 7 | feedback_no_target_auto_relax | D77 0건 차단 카드 유지 |
| 8 | feedback_no_inline_duplication | utils CT 활용 보존 |
| 9 | feedback_no_bakkeum_usage | Spec 안 박-단어 0건 |
| 10 | feedback_no_preview_verification | Claude_Preview MCP 0건 |
| 11 | feedback_default_superpowers_workflow | brainstorming + writing-plans + verification-before-completion |

---

> **본 spec 종결.** Harold 검토 후 `superpowers:writing-plans` skill 진입 + 5 Phase 분할 Plan 작성 흐름.
