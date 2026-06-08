# 한줄로 오픈 기념 구독 할인 팝업 — 마스터 프롬프트 (Claude Design용)

> 이 문서를 Claude Design에게 그대로 전달하세요. 한줄로(TargetUp) 로그인 직후 뜨는 메인 팝업을 교체할 새 팝업 디자인을 만드는 브리프입니다.

---

## 한 줄 목표
로그인하면 가장 먼저 뜨는 메인 팝업을 **오픈 기념 구독 할인** 프로모션으로 새로 디자인한다. 기존 "AI Operator 미리보기" 팝업을 대체한다.

## 핵심 메시지 (딱 이것 하나만 확실히 보이게)
> **"AI Operator · 12개월 약정 시 2개월 무료 제공"**
> 보조 한 줄: **"어떤 요금제든 동일하게 적용됩니다."**

- 사용자가 0.5초 안에 "12개월 약정 = 2개월 무료" 한 문장을 이해해야 한다.
- 복잡한 데모·표·여러 카드 전부 빼고 **진짜 심플하게**. 한 화면에 메시지 1개 + CTA 1개.
- 숫자 혜택은 **"2개월 무료"만**. 임의 % 할인이나 가격을 새로 만들지 말 것.

## 비주얼 — 현재 톤 100% 유지 (아래 토큰 그대로)
한줄로는 다크 톤 + violet/fuchsia 액센트다. 기존 팝업과 색·질감이 이어지게:

- 배경(backdrop): `bg-black/70` + `backdrop-blur-sm`
- 모달 카드: `bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950` + `border border-white/10` + `rounded-2xl` + `shadow-2xl`
- 글로우(은은하게): 상단우측 radial `rgba(167,139,250,0.25)`, 하단좌측 radial `rgba(217,70,239,0.20)`, `blur-3xl`
- 액센트: 버튼/강조 그라데이션 `from-violet-500 to-fuchsia-500`, 텍스트 강조 `from-violet-300 to-fuchsia-300` (`bg-clip-text text-transparent`)
- 뱃지/chip: `bg-violet-500/15 border border-violet-400/40 text-violet-200`
- 글씨: 본문 white, 보조 `text-white/60`, 흐린 텍스트 `text-white/40`

## 구성 (위→아래, 심플)
1. **eyebrow 뱃지** — "오픈 기념 혜택" (violet chip, 별/반짝임 아이콘 1개)
2. **헤드라인(크게)** — `12개월 약정 시 2개월 무료` ← "2개월 무료"만 violet→fuchsia 그라데이션 강조
3. **서브 한 줄** — "AI Operator를 포함한 어떤 요금제든 동일하게 적용됩니다."
4. (선택) **직관 요소 1개** — 예: `12개월 결제 → 14개월 이용` 같은 한눈에 들어오는 표현 1개. 과하지 않게, 없어도 됨.
5. **CTA 버튼 1개** — "요금제 보고 혜택 받기" → `/pricing` 이동. `from-violet-500 to-fuchsia-500` 그라데이션 + 은은한 glow.
6. **footer** — 좌측 "오늘 하루 보지 않기" 체크박스 + 우측 "나중에 보기" 텍스트 버튼.

## 기술 스펙 (통합 편의)
- 결과물: **React + Tailwind 단일 컴포넌트**. 기존 `AiGuidePopup.tsx` 구조를 재사용한다 — `Modal` wrapper + 우상단 close(X) 버튼 + ESC로 닫기 + `localStorage` 24h dismiss(오늘 하루 보지 않기).
- 모바일 반응형: 카드 폭 `max-w-[480px]~[560px]`, `sm:` 분기로 글자/여백 조정.
- z-index `9998`, 중앙 정렬, 세로 스크롤 안전(`overflow-y-auto`).
- (HTML/CSS로 줘도 됨 — 그러면 우리가 React로 옮긴다.)

## 절대 금지 (한줄로 영구 룰)
- **모델명 노출 0건**: Opus / Sonnet / GPT / Claude / Anthropic 단어 절대 금지. ("AI Operator"는 제품명이라 사용 가능)
- **native dialog 0건**: alert / confirm / prompt 금지 — 커스텀 다크 모달만.
- **라이트 톤 금지**: 흰 배경 + 파란 chrome 금지. 다크 톤 유지.
- **임의 혜택 생성 금지**: "2개월 무료" 외 다른 할인율·금액·사은품 만들지 말 것.

## 성공 기준
팝업을 처음 본 사용자가 **"아, 1년 약정하면 2개월 공짜구나"**를 즉시 이해하고, CTA 하나로 요금제로 넘어간다. 디자인은 기존 한줄로 팝업과 이어지는 다크+violet 톤.
