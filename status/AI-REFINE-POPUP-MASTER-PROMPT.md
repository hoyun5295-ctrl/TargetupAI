# AI 인라인 다듬기 진입 안내 팝업 — Claude Design 마스터 프롬프트

> **용도:** Claude Design 도구에 본 .md 파일을 drop하여 HTML 팝업 생성 → React 컴포넌트로 통합.
> **패턴 미러:** D145 `AI-GUIDE-MASTER-PROMPT.md` (Live Demo + 단언형 + emerald 톤).
> **트리거 위치:** `pages/Dashboard.tsx` `setShowDirectSend(true)` 직후, `localStorage.getItem('directSendAiRefinePopupSeen')` null 시 1회 노출.

---

## 1. 디자인 의도

직접발송 진입 사용자가 메시지를 직접 작성하는 동선에서, "AI 다듬기"라는 신기능을 자연스럽게 인지하고 사용 동기를 부여하는 **24시간 1회 안내 팝업**.

**핵심 메시지:** "메시지 직접 쓰셨네요? AI가 더 잘 팔리게 다듬어드릴게요."

**톤:**
- 친근하고 가볍게 (강요하지 않음)
- 단언형 ("~할 수 있습니다" 아닌 "~합니다")
- 가치를 즉시 보여주는 Before/After 미리보기 포함

**색상:**
- 한줄로 메인 amber/emerald 톤 유지
- AI 액션 영역만 emerald (기존 AI 가이드 페이지와 일관성)

---

## 2. 레이아웃 명세

### 2-1. 모달 wrapper
- `position: fixed inset-0`
- backdrop: `bg-black/40 backdrop-blur-sm`
- z-index: `z-[60]` (다른 모달보다 위, toast보다 아래)
- 클릭 시 닫기 + localStorage 기록

### 2-2. 모달 콘텐츠 박스
- `max-w-md w-full mx-4` (모바일 친화)
- `bg-white rounded-2xl shadow-2xl`
- `animate-in fade-in zoom-in-95 duration-200`
- 내부 padding: `p-6 sm:p-7`

### 2-3. 구성 요소 (위에서 아래로)

#### (a) 아이콘 영역
- 상단 중앙 원형 배지: `w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600`
- 아이콘: 마법봉/스파클 (✨ 또는 SVG). 흰색.

#### (b) 헤드라인
- "✨ AI가 문안을 다듬어드려요"
- `text-xl font-bold text-gray-900`
- 중앙 정렬

#### (c) 서브 설명
- "직접 쓰신 메시지를 AI에게 맡기면 톤 / 길이 / 이모지 / 스팸 회피를 자동으로 정리해서 3~5개 안을 제시합니다."
- `text-sm text-gray-600 leading-relaxed`
- 중앙 정렬

#### (d) Before/After 미리보기 카드 (핵심 가치 시각화)
- 회색 박스 안에 2단 비교
- **Before:** "내일 신상품 입고됩니다!"
  - 라벨: `직접 작성` (gray 배지)
- 화살표 아이콘 또는 "→ AI 다듬기 →"
- **After (3개 안 중 1개):** "내일 드디어! 기다리시던 신상품이 입고됩니다 😊 매장에서 만나뵐게요"
  - 라벨: `AI 다듬기 (친근 톤)` (emerald 배지)
  - 바이트 표시: `78B / SMS`

스타일:
- Before: `bg-white border border-gray-200 rounded-lg p-3 text-sm text-gray-700`
- After: `bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-gray-900`

#### (e) 사용 안내 (3 step, 짧게)
- 작은 아이콘 + 텍스트 3줄:
  1. 📝 메시지를 직접 쓰세요
  2. ✨ "AI 다듬기" 버튼 클릭
  3. ✅ 마음에 드는 안 선택 → 발송
- `text-xs text-gray-500 space-y-1`

#### (f) CTA 버튼 영역
- 가로 2개 버튼:
  - 왼쪽: "다음에 볼게요" (`bg-gray-100 hover:bg-gray-200 text-gray-700`)
  - 오른쪽: "지금 써볼게요" (`bg-emerald-500 hover:bg-emerald-600 text-white font-medium`)
- 둘 다 클릭 시 localStorage 기록 + 모달 닫기
- 오른쪽 버튼 클릭 시 추가로: textarea에 포커스 + AI 다듬기 버튼 글로우 애니메이션 (3초)

#### (g) 하단 안내 (요금제)
- "베이직 요금제(35만원/월) 이상에서 이용 가능합니다."
- `text-[11px] text-gray-400 text-center mt-3`
- 무료체험 회사는 "무료체험 기간 동안 무제한 이용 가능 ✨" 분기 (`text-emerald-600`)

---

## 3. 인터랙션

- 모달 열림: `setShowDirectSend(true)` 직후 100ms delay → 자연스러운 등장
- 닫기 조건:
  - 두 버튼 중 하나 클릭
  - backdrop 클릭
  - ESC 키
- 닫힐 때 모두 `localStorage.setItem('directSendAiRefinePopupSeen', Date.now())` 기록
- 24시간 이내 재진입 시 노출 안 함
- "지금 써볼게요" 클릭 후:
  - 모달 닫힘
  - 직접발송 textarea에 자동 focus
  - "AI 다듬기" 버튼 3초간 glow ring (emerald) — 사용자 시선 유도

---

## 4. 반응형

- 데스크탑 (≥640px): `max-w-md`, padding 넉넉히
- 모바일 (<640px): `max-w-sm`, padding 줄임, Before/After 카드 폰트 약간 축소
- 버튼은 모바일에서도 가로 2개 유지 (세로 stacking X)

---

## 5. 접근성

- `role="dialog" aria-modal="true"`
- ESC 키 닫기
- 첫 focus = "다음에 볼게요" 버튼 (실수 발송 방지)
- 닫힐 때 이전 focus 복원

---

## 6. React 통합 가이드 (HTML 생성 후)

```tsx
// Dashboard.tsx 또는 별도 컴포넌트로 분리
import DirectSendAiRefinePopup from './DirectSendAiRefinePopup';

// state
const [showAiRefinePopup, setShowAiRefinePopup] = useState(false);

// 직접발송 열릴 때 24h 1회 노출
useEffect(() => {
  if (!showDirectSend) return;
  const seen = localStorage.getItem('directSendAiRefinePopupSeen');
  if (seen) {
    const seenAt = Number(seen);
    if (Date.now() - seenAt < 24 * 60 * 60 * 1000) return;
  }
  // 요금제 잠금 시 노출 안 함 (BASIC 미만)
  if (!user?.features?.ai_messaging_enabled) return;
  const t = setTimeout(() => setShowAiRefinePopup(true), 100);
  return () => clearTimeout(t);
}, [showDirectSend, user]);

const closePopup = (action: 'now' | 'later' | 'backdrop') => {
  localStorage.setItem('directSendAiRefinePopupSeen', String(Date.now()));
  setShowAiRefinePopup(false);
  if (action === 'now') {
    // textarea focus + AI 다듬기 버튼 glow trigger
    document.dispatchEvent(new CustomEvent('focus-ai-refine-btn'));
  }
};
```

---

## 7. 콘텐츠 카피 (한국어 마케팅 톤)

### 기본 (BASIC+ / TRIAL)

| 영역 | 텍스트 |
|---|---|
| 헤드라인 | ✨ AI가 문안을 다듬어드려요 |
| 서브 | 직접 쓰신 메시지를 AI에게 맡기면 톤 / 길이 / 이모지 / 스팸 회피를 자동으로 정리해서 3~5개 안을 제시합니다. |
| Before 예시 | 내일 신상품 입고됩니다! |
| After 예시 | 내일 드디어! 기다리시던 신상품이 입고됩니다 😊 매장에서 만나뵐게요 |
| Before 라벨 | 직접 작성 |
| After 라벨 | AI 다듬기 (친근 톤) |
| Step 1 | 📝 메시지를 직접 쓰세요 |
| Step 2 | ✨ "AI 다듬기" 버튼 클릭 |
| Step 3 | ✅ 마음에 드는 안 선택 → 발송 |
| 좌 버튼 | 다음에 볼게요 |
| 우 버튼 | 지금 써볼게요 |
| 하단 (TRIAL) | 무료체험 기간 동안 무제한 이용 가능 ✨ |
| 하단 (BASIC+) | 베이직 요금제 이상에서 이용 가능합니다 |

### 잠금 (FREE/STARTER) — 별도 컴포넌트
- 버튼 노출 X (팝업 자체 안 띄움) — 사용자가 보지 못한 기능에 대한 안내는 노이즈
- 단, 추후 별도 "베이직 이상 업그레이드 시 사용 가능한 기능" 안내 페이지로 분리 (별건)

---

## 8. 디자인 토큰 (한줄로 시스템 정합)

| 토큰 | 값 |
|---|---|
| Primary AI 색 | `emerald-500` (#10b981) → `emerald-600` (#059669) 그라데이션 |
| Surface | `white` / `bg-white` |
| Border | `gray-200` |
| Backdrop | `bg-black/40` + `backdrop-blur-sm` |
| Text primary | `text-gray-900` |
| Text secondary | `text-gray-600` |
| Text tertiary | `text-gray-400` |
| Border radius (모달) | `rounded-2xl` |
| Border radius (카드) | `rounded-lg` |
| Shadow | `shadow-2xl` |
| Animation | `animate-in fade-in zoom-in-95 duration-200` |

---

## 9. Claude Design 도구 사용 흐름

1. **Drag in this file** — `AI-REFINE-POPUP-MASTER-PROMPT.md`을 Claude Design "Drag in a Figma file" 또는 "Add screenshot" 영역에 drop (또는 파일 import)
2. **Describe what you want to create** 입력:
   > "위 마스터 프롬프트 명세대로 HTML/Tailwind CSS 팝업 컴포넌트를 만들어주세요. React 컴포넌트로 변환 가능한 단일 파일로, props는 isOpen + onClose만 받도록 합니다. Before/After 미리보기는 실제 텍스트로 채워주세요."
3. **Send** → 생성된 HTML 결과 받기
4. 결과 HTML을 `packages/frontend/src/components/DirectSendAiRefinePopup.tsx`로 변환 (props 정합 + i18n 필요 시 분리)
5. `Dashboard.tsx`에 import + state + useEffect 트리거 박기

---

## 10. 메모리 컨텍스트

- `memory/project_d145_ai_guide_popup.md` — D145 AI 활용 안내 팝업(원본 패턴) + nginx SPA cache 영구 박음
- `status/AI-INLINE-REFINE-DESIGN.md` — 본 fix 전체 설계 (Backend + Frontend + 게이팅)
- `status/STATUS.md` D143 — TRIAL=PRO 기능 동일, ENTERPRISE 잠금 정책
- `packages/backend/src/utils/plan-guard.ts` — CT-17 요금제 게이팅 컨트롤타워
