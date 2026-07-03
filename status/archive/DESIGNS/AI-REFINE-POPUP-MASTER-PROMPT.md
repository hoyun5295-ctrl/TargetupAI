# AI 인라인 다듬기 — 진입 안내 팝업 마스터 프롬프트 (재작성판)

> **★ 본 파일은 "진입 안내 팝업"만 명세. AI 다듬기 본체 모달은 `packages/frontend/src/components/AiRefineModal.tsx`로 이미 별도 구현됨. 둘은 다른 컴포넌트, 다른 목적.**
>
> **용도:** Claude Design 도구에 본 .md 파일을 drop하여 **가벼운 사용권고 안내 팝업 HTML** 생성 → React 컴포넌트로 통합.
> **패턴 미러:** D145 `AI-GUIDE-MASTER-PROMPT.md` (운영 hanjul.ai에 배포된 AI 활용 안내 팝업) — 짧고 가벼움, 사용 권유 중심.
> **트리거 위치:** `pages/Dashboard.tsx` `setShowDirectSend(true)` 직후, `localStorage.getItem('directSendAiRefinePopupSeen')` null 시 1회 노출.

---

## 1. ⚠️ 절대 만들면 안 되는 것 (가장 흔한 오해)

본 팝업은 다음이 **아닙니다:**
- ❌ 원본 메시지 textarea 입력 영역
- ❌ 톤 4선택 카드 (친근/공식/긴급/따뜻함)
- ❌ 길이·이모지·스팸회피 세부 옵션 토글
- ❌ "AI 다듬기 시작" 본격 CTA
- ❌ 로딩 step indicator
- ❌ 다듬기 결과 카드 (본체 모달에 1개 표시되는 영역)
- ❌ Before/After 큰 비교 영역

위 항목은 모두 **AI 다듬기 본체 모달**(이미 구현된 별도 컴포넌트)에 박혀있습니다. **절대 본 팝업에 박지 마세요.**

---

## 2. ✅ 본 팝업이 해야 하는 일

**한 줄 요약:** "직접발송 화면에 처음 들어온 사용자에게 'AI 다듬기 기능이 있다'고 짧게 알려주는 가벼운 사용권고 안내."

본 팝업은 다음입니다:
- ✓ 직접발송 진입 시 24h 1회만 노출
- ✓ 1~2줄 짧은 설명
- ✓ 가치를 보여주는 미니 Before/After 예시 (하드코딩 텍스트, 입력 영역 X)
- ✓ "지금 써볼게요" / "다음에 볼게요" 2 CTA
- ✓ 닫힐 때 localStorage 기록
- ✓ "지금 써볼게요" 클릭 시 직접발송 화면의 AI 다듬기 버튼 위치로 시선 유도 (3초 emerald glow ring + 화살표 인디케이터 가이드)

---

## 3. 디자인 톤

- **가볍게, 강요하지 않게** — 사용자가 "다음에 볼게요" 클릭에 부담 없도록
- **emerald 강조 톤** — D145 AI 가이드 페이지 + AiRefineModal 본체와 일관성
- **D145 운영 박힌 AI 활용 안내 팝업 패턴 미러** — Live Demo 단언형 톤

---

## 4. 레이아웃 명세 (정확히 이만큼만)

### 4-1. 모달 wrapper
- `position: fixed inset-0`
- backdrop: `bg-black/40 backdrop-blur-sm`
- z-index: `z-[60]`
- backdrop 클릭 → 닫기 + localStorage 기록

### 4-2. 모달 콘텐츠 박스
- `max-w-md w-full mx-4` (모바일 친화, 본체 모달보다 좁게)
- `bg-white rounded-2xl shadow-2xl`
- `animate-in fade-in zoom-in-95 duration-200`
- 내부 padding: `p-6 sm:p-7`
- **세로 길이 짧게 유지** — 본체 모달과 시각적 구분

### 4-3. 콘텐츠 구성 (위→아래, 7개 요소만)

1. **상단 중앙 원형 아이콘**
   - `w-14 h-14 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600`
   - 흰색 Sparkles 또는 별 아이콘

2. **헤드라인 (중앙 정렬)**
   - "✨ AI가 문안을 다듬어드려요"
   - `text-xl font-bold text-gray-900`

3. **서브 설명 1~2줄 (중앙 정렬)**
   - "직접 쓰신 메시지를 AI가 톤·길이·이모지를 자동으로 정리해서 다듬은 안을 보여드려요."
   - `text-sm text-gray-600 leading-relaxed`
   - **2줄 이내. 더 길게 박지 말 것.**

4. **미니 Before/After 카드 (시각화, 하드코딩 텍스트 1개씩만)**
   - 가로 박스 안에 2단:
   - **Before** (회색 박스):
     - 라벨: `직접 작성` (gray 배지)
     - 텍스트 (하드코딩 예시): "내일 신상품 입고됩니다!"
   - **화살표 →** (emerald 색)
   - **After** (emerald 박스):
     - 라벨: `AI 다듬기` (emerald 배지)
     - 텍스트 (하드코딩 예시): "내일 드디어! 기다리시던 신상품이 입고됩니다 😊"
   - **사용자가 입력하는 영역 X. 본체 모달의 원본 textarea와 다름.**

5. **사용 안내 3 step (작게)**
   - 작은 아이콘 + 텍스트 3줄:
     - 📝 메시지 직접 쓰기
     - ✨ "AI 다듬기" 버튼 클릭
     - ✅ 마음에 드는 안 선택
   - `text-xs text-gray-500 space-y-1`
   - **이 부분도 짧게. 본체 모달이 아니라는 시각적 단서.**

6. **CTA 2개 (가로)**
   - 좌측: "다음에 볼게요" (`bg-gray-100 hover:bg-gray-200 text-gray-700`)
   - 우측: "지금 써볼게요" (`bg-emerald-500 hover:bg-emerald-600 text-white font-medium`)
   - **둘 다 클릭 시 localStorage 기록 + 모달 닫힘**
   - "지금 써볼게요" 클릭 추가 효과: 모달 닫힌 후 직접발송 textarea focus + "AI 다듬기" 버튼 3초 emerald glow + 위쪽 화살표 인디케이터(`↓ 여기를 누르세요` 풍선)

7. **작은 하단 안내 (요금제)**
   - "베이직 요금제(35만원/월) 이상에서 이용 가능합니다."
   - `text-[11px] text-gray-400 text-center mt-3`
   - 무료체험(TRIAL) 회사는 분기: "무료체험 기간 동안 무제한 이용 가능 ✨" (`text-emerald-600`)

---

## 5. 인터랙션

- 모달 열림: `setShowDirectSend(true)` 직후 100ms delay → 자연스러운 등장
- 닫기 조건 (모두 localStorage 기록):
  - "다음에 볼게요" 버튼
  - "지금 써볼게요" 버튼 (+ AI 다듬기 버튼 시선 유도)
  - backdrop 클릭
  - ESC 키
- 24시간 이내 재진입 시 노출 안 함 (`localStorage.setItem('directSendAiRefinePopupSeen', String(Date.now()))`)

---

## 6. 반응형

- 데스크탑 (≥640px): `max-w-md`, 본체 모달의 절반 크기 정도
- 모바일 (<640px): `max-w-sm`, padding 줄임
- 두 CTA는 모바일에서도 가로 2개 유지 (세로 X)

---

## 7. 접근성

- `role="dialog" aria-modal="true"`
- ESC 키 닫기
- 첫 focus = "다음에 볼게요" 버튼 (실수 발송 방지 + 부담 X)
- 닫힐 때 이전 focus 복원

---

## 8. 본체 AI 다듬기 모달과의 시각적 구분

| 영역 | 본체 모달 (이미 구현됨) | **본 진입 안내 팝업** |
|---|---|---|
| 크기 | `max-w-2xl` 큼 | `max-w-md` 작음 |
| 세로 길이 | 본문 길게 (스크롤) | 짧게 (스크롤 X) |
| 사용자 입력 | 원본 textarea + 톤 선택 + 옵션 토글 | **없음** (정보 표시만) |
| AI 호출 | "AI 다듬기 시작" 버튼 → 실제 API 호출 | **없음** (안내만) |
| 결과 카드 | 1개 결과 카드 + 메타 + 적용 | **없음** |
| CTA | "AI 다듬기 시작" 본격 | "지금 써볼게요" + "다음에 볼게요" 가벼움 |
| 노출 시점 | 사용자가 "AI 다듬기" 버튼 클릭 시 | **직접발송 첫 진입 시 24h 1회 자동** |

---

## 9. React 통합 가이드 (HTML 생성 후)

```tsx
// 새 컴포넌트 `DirectSendAiRefinePopup.tsx`
import DirectSendAiRefinePopup from './DirectSendAiRefinePopup';

// Dashboard.tsx state
const [showAiRefinePopup, setShowAiRefinePopup] = useState(false);

// 직접발송 진입 시 24h 1회 트리거
useEffect(() => {
  if (!showDirectSend) return;
  const seen = localStorage.getItem('directSendAiRefinePopupSeen');
  if (seen && Date.now() - Number(seen) < 24 * 60 * 60 * 1000) return;
  // 요금제 잠금 시 노출 안 함
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

## 10. 콘텐츠 카피 (한국어, 톤 가볍게)

| 영역 | 텍스트 |
|---|---|
| 헤드라인 | ✨ AI가 문안을 다듬어드려요 |
| 서브 (1~2줄) | 직접 쓰신 메시지를 AI가 톤·길이·이모지를 자동으로 정리해서 다듬은 안을 보여드려요. |
| Before 라벨 | 직접 작성 |
| Before 텍스트 | 내일 신상품 입고됩니다! |
| After 라벨 | AI 다듬기 |
| After 텍스트 | 내일 드디어! 기다리시던 신상품이 입고됩니다 😊 |
| Step 1 | 📝 메시지 직접 쓰기 |
| Step 2 | ✨ "AI 다듬기" 버튼 클릭 |
| Step 3 | ✅ 마음에 드는 안 선택 |
| 좌 CTA | 다음에 볼게요 |
| 우 CTA | 지금 써볼게요 |
| 하단 (TRIAL) | 무료체험 기간 동안 무제한 이용 가능 ✨ |
| 하단 (BASIC+) | 베이직 요금제(35만원/월) 이상에서 이용 가능 |

---

## 11. 디자인 토큰 (한줄로 시스템 정합)

| 토큰 | 값 |
|---|---|
| Primary AI 색 | `emerald-500` (#10b981) → `emerald-600` (#059669) 그라데이션 |
| Surface | `white` |
| Border | `gray-200` |
| Backdrop | `bg-black/40 backdrop-blur-sm` |
| Text primary | `text-gray-900` |
| Text secondary | `text-gray-600` |
| Text tertiary | `text-gray-400` |
| Border radius (모달) | `rounded-2xl` |
| Border radius (카드) | `rounded-lg` |
| Shadow | `shadow-2xl` |
| Animation | `animate-in fade-in zoom-in-95 duration-200` |
| 폰트 | 시스템 또는 Pretendard (운영 hanjul.ai와 정합) |

---

## 12. 푸터 외부 LLM 표기 금지 (2026-05-12 정책)

- ❌ "Powered by Claude AI" 표기 절대 금지
- ❌ "OpenAI" / "GPT" / 외부 LLM 이름 노출 금지
- ✓ 푸터는 짧은 한 줄 안내만 (요금제 표시 또는 빈 칸)

---

## 13. Claude Design 도구 사용 흐름

1. **Drag in this file** — `AI-REFINE-POPUP-MASTER-PROMPT.md`을 Claude Design "Drag in a Figma file" / "Add screenshot" / 파일 import 영역에 drop
2. **Describe what you want to create** 입력 (정확히):
   > "본 마스터 프롬프트의 §4 레이아웃 명세 그대로, 가벼운 사용권고 안내 팝업 HTML/Tailwind 컴포넌트를 만들어주세요. §1에 박힌 '절대 만들면 안 되는 것'(원본 textarea, 톤 선택, 옵션 토글, 결과 카드 등)은 절대 포함하지 마세요. 본체 AI 다듬기 모달은 이미 별도 구현되어 있으니, 본 팝업은 짧은 안내(헤드라인 1줄 + 서브 1~2줄 + 미니 Before/After 1개 + Step 3줄 + CTA 2개 + 하단 작은 안내)로만 구성하세요."
3. **Send** → 생성된 HTML 결과 받기
4. 결과 HTML을 `packages/frontend/src/components/DirectSendAiRefinePopup.tsx`로 변환
5. `Dashboard.tsx`에 import + state + useEffect 24h 트리거 박기

---

## 14. 메모리 컨텍스트

- `memory/project_d145_ai_guide_popup.md` — D145 AI 활용 안내 팝업(원본 패턴, 운영 박힘)
- `status/AI-INLINE-REFINE-DESIGN.md` — 본 fix 전체 설계 (Backend + Frontend + 게이팅)
- `packages/frontend/src/components/AiRefineModal.tsx` — 본체 AI 다듬기 모달 (별도 컴포넌트, 본 팝업과 분리)
- `packages/frontend/src/components/DirectSendPanel.tsx` — 직접발송 화면의 "AI 다듬기" 버튼 위치 (시선 유도 대상)
