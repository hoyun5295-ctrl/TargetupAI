# 한줄로 매뉴얼 · 에디토리얼 시스템

> transition.html의 디자인 언어를 매뉴얼 전 챕터에 일관 적용하기 위한 단일 규칙집.
> 모든 챕터 HTML은 이 문서의 **토큰 · 컴포넌트 · 패턴**을 그대로 사용한다.
> 매뉴얼 = "제품 매거진". Apple / Bloomberg / Stripe 수준의 에디토리얼 톤.

---

## 0. 철학 3줄

1. **실제 화면이 주인공** — 스크린샷은 감추지 않고, 에디토리얼 프레임이 돋보이게 한다.
2. **번호 · Fig · § 로 리듬을 만든다** — 번호가 페이지를 "읽히게" 한다.
3. **브랜드 톤은 여백과 타이포에서 온다** — 장식이 아니라 절제에서.

---

## 1. 디자인 토큰

### 1-1. 컬러 팔레트 (tailwind.config 그대로)

```js
colors: {
  ink: {
    950:'#0b0b0f', 900:'#111115', 800:'#1c1c21', 700:'#2a2a31',
    600:'#4a4a55', 500:'#6b6b76', 400:'#9898a2', 300:'#c7c7cf',
    200:'#e4e4e8', 100:'#efeff2', 50:'#f7f7f9'
  },
  canvas: { DEFAULT:'#fafaf9', warm:'#f5f5f3' },
  violet: {
    50:'#f5f3ff', 100:'#ede9fe', 200:'#ddd6fe', 300:'#c4b5fd',
    400:'#a78bfa', 500:'#8b5cf6', 600:'#7c3aed', 700:'#6d28d9',
    800:'#5b21b6', 900:'#4c1d95', 950:'#2e1065'
  }
}
```

**사용 원칙:**
- **본문:** `ink-950` 헤드라인 / `ink-600` 본문 / `ink-500` 메타 / `ink-400` 힌트
- **강조:** `violet-700` (인용 · 링크 · 숫자) / `violet-600` (CTA)
- **배경:** `canvas` (섹션 교차 배경) / `white` / `ink-950` (검정 CTA band)
- **그라디언트:** `from-violet-400 to-violet-700` (카드 상단 바) / `from-violet-400 via-violet-600 to-violet-800` (프로그레스 바)

### 1-2. 타이포그래피

```html
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css" rel="stylesheet">
```

```js
fontFamily: {
  sans: ['"Pretendard Variable"','Pretendard','-apple-system','BlinkMacSystemFont','system-ui','"Malgun Gothic"','sans-serif'],
  mono: ['"JetBrains Mono"','ui-monospace','"SF Mono"','Menlo','Consolas','monospace'],
}
```

- **Sans:** 본문 · 헤드라인 전체
- **Mono:** 모든 **레이블 · 번호 · 메타 · 캡션** (tracking 0.22em, uppercase)
- **Serif Italic:** Times New Roman italic — "**한줄로**" 브랜드 악센트에만 사용
- `letterSpacing.tightest = -0.045em` (헤드라인 전용)
- `font-feature-settings: "ss01","ss02","cv01","cv11"` (body 기본)
- `.num` 클래스 — 숫자에 반드시 부여 (`font-variant-numeric: tabular-nums`)
- 본문은 항상 `word-break: keep-all` (한글 단어 중간 줄바꿈 방지)

### 1-3. 타입 스케일

| 요소 | 크기 (desktop) | leading | 용도 |
|------|---------------|---------|------|
| Hero display | 180~260px | 0.88 | D-Day, 큰 숫자, Vol 번호 |
| H1 | 44~80px | 1.02 | 챕터 제목 |
| H2 | 30~42px | 1.1 | 섹션 제목 (§ 01) |
| H3 | 20~26px | 1.25 | 하위 섹션 |
| Body Large | 17~19px | 1.75 | Hero 부제 |
| Body | 14~15px | 1.8 | 본문 |
| Meta Mono | 10~11px | tracking 0.22em uppercase | 라벨 · 캡션 |

### 1-4. 그리드 · 여백

- Max width: `1200px` (`max-w-[1200px]`)
- Padding: `px-6 md:px-10`
- 섹션 상하: `py-16 md:py-24` (일반), `py-20 md:py-28` (CTA band)
- 섹션 경계선: `border-t border-ink-200`
- Anchor scroll offset: `scroll-margin-top: 88px`

---

## 2. 페이지 골격 (챕터 공통)

```
┌────────────────────────────────────────────────────────┐
│  [Top Ticker]  (옵션 — Vol.01만)                       │  ← marquee 40s
├────────────────────────────────────────────────────────┤
│  [Sticky Nav]  Invito → 한줄로 · § 목차 · 바로가기       │  ← backdrop-blur
├────────────────────────────────────────────────────────┤
│                                                         │
│  [Hero]                                                 │
│   eyebrow  Notice · Vol.02 / Customer DB              │
│   H1       고객 DB, 한 줄로                           │
│            (serif italic 악센트)                       │
│   sub      엑셀을 올리면 AI가 매핑해서 저장합니다...    │
│   meta 3-col  (Release · Size · Support)               │
│   CTA pair (Primary + Ghost)                           │
│                                                         │
│   Fig Block (오른쪽 컬럼 — 상징 숫자 or 스크린샷)       │
│                                                         │
├────────────────────────────────────────────────────────┤
│  § 01  What's in this chapter  (3~4줄 요약)           │
├────────────────────────────────────────────────────────┤
│  § 02 ~ § N                                            │
│   각 섹션 = 제목 + 본문 + [Fig/Screenshot/Terminal]    │
├────────────────────────────────────────────────────────┤
│  [Callout]  ⚠️ 주의 / 💡 팁 / ⭐ 프로 기능              │
├────────────────────────────────────────────────────────┤
│  [CTA Band]  다음 챕터로 · 한줄로 시작하기              │  ← ink-950 배경
├────────────────────────────────────────────────────────┤
│  [Chapter FAQ]  (옵션)                                 │
├────────────────────────────────────────────────────────┤
│  [Footer]  © 2026 INVITO · Vol.02 · v1.0              │
└────────────────────────────────────────────────────────┘
```

---

## 3. Faux-Screenshot 프레임 패턴 7종

> **본체는 실제 스크린샷**. 아래 패턴은 스크린샷을 **감싸거나**, 스크린샷이 불필요한 개념을 **대체**하는 HTML 프레임.

### Pattern A — Browser Chrome Frame (★ 주력)
실제 스크린샷을 감싸는 브라우저 창. URL · 탭 · 버튼까지 표현.

```html
<figure class="rounded-2xl border border-ink-200 bg-white overflow-hidden shadow-[0_1px_0_rgba(11,11,15,0.04),0_24px_48px_-24px_rgba(11,11,15,0.15)]">
  <div class="flex items-center justify-between px-4 py-2.5 bg-ink-50 border-b border-ink-200">
    <div class="flex items-center gap-1.5">
      <span class="w-3 h-3 rounded-full bg-ink-200"></span>
      <span class="w-3 h-3 rounded-full bg-ink-200"></span>
      <span class="w-3 h-3 rounded-full bg-ink-200"></span>
    </div>
    <div class="font-mono text-[11px] tracking-[0.16em] uppercase text-ink-500">app.hanjul.ai/customers</div>
    <div class="w-12"></div>
  </div>
  <img src="../captures/vol-02/cap-03-customer-list.png" alt="고객 DB 목록 화면">
  <figcaption class="px-5 py-3 border-t border-ink-200 flex items-center gap-3">
    <span class="font-mono text-[10px] tracking-[0.22em] uppercase text-ink-500 num">Fig 02-C</span>
    <span class="text-[13px] text-ink-700">고객 DB 목록 — 세그먼트 필터 적용 후 2,413명</span>
  </figcaption>
</figure>
```

### Pattern B — Terminal Mock (데이터 흐름)
실제 화면이 불필요한 **데이터 파이프라인** 설명에 사용.

```html
<div class="rounded-xl border border-ink-200 bg-white overflow-hidden">
  <div class="flex items-center justify-between px-4 py-2.5 bg-ink-50 border-b border-ink-200">
    <div class="flex items-center gap-1.5">
      <span class="w-2 h-2 rounded-full bg-ink-200"></span>
      <span class="w-2 h-2 rounded-full bg-ink-200"></span>
      <span class="w-2 h-2 rounded-full bg-ink-200"></span>
    </div>
    <div class="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-500">customers_2026Q2.xlsx</div>
  </div>
  <div class="p-4 font-mono text-[11px] text-ink-600 leading-[1.9]">
    <div><span class="text-ink-400">→</span> parsing rows <span class="text-ink-950 num">· 8,412</span></div>
    <div><span class="text-ink-400">→</span> AI mapping <span class="text-violet-700">· 14/14 fields</span></div>
    <div><span class="text-ink-400">→</span> deduplication <span class="text-violet-700">· 92 merged</span></div>
    <div><span class="text-ink-400">→</span> opt-out check <span class="text-violet-700">· 3 excluded</span></div>
    <div><span class="text-ink-400">✓</span> <span class="text-ink-950">ready to send</span></div>
  </div>
</div>
```

### Pattern C — Card Grid + Status Badge
기능/상태/옵션 비교를 카드로.

```html
<div class="grid grid-cols-1 md:grid-cols-3 gap-5">
  <!-- 카드: 상단 violet 바 + 아이콘 + 라벨 + 제목 + 본문 + 하단 status row -->
</div>
```

상태 뱃지:
- ✅ **DONE** — `text-violet-700 bg-violet-50 border-violet-200`
- ⏳ **YOUR TURN** — dashed border, `text-violet-800 bg-white border-violet-300`
- ⭐ **PRO** — `text-violet-700 bg-violet-100 border-violet-200` + `pulse dot`
- ⚠️ **BETA** — `text-ink-700 bg-ink-50 border-ink-300`

### Pattern D — Step Progress (단계 가이드)
`68px` 원형 번호 + 가로 바이올렛 커넥터.

```html
<div class="relative">
  <div class="hidden md:block absolute top-[34px] left-[8%] right-[8%] h-px bg-gradient-to-r from-violet-200 via-violet-400 to-violet-200"></div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
    <!-- 각 스텝: 68×68 원형 + 번호 + 라벨 + 설명 -->
  </div>
</div>
```

### Pattern E — Figure + Annotation Pin (주석 핀)
스크린샷 위에 번호 핀 ①②③으로 UI 요소 짚기.

```html
<figure class="relative">
  <img src="..." alt="..." class="rounded-2xl border border-ink-200">
  <span class="absolute top-[12%] left-[18%] w-7 h-7 rounded-full bg-violet-600 text-white font-mono text-[12px] flex items-center justify-center shadow-[0_4px_12px_rgba(124,58,237,0.4)] num">1</span>
  <span class="absolute top-[34%] right-[22%] w-7 h-7 rounded-full bg-violet-600 text-white font-mono text-[12px] flex items-center justify-center shadow num">2</span>
</figure>
<ol class="mt-6 space-y-3 text-[14px] text-ink-700">
  <li class="flex gap-3">
    <span class="font-mono text-violet-700 num">①</span>
    <span>헤더의 "고객 DB" 메뉴를 누르면 목록이 열립니다.</span>
  </li>
  ...
</ol>
```

### Pattern F — Concept Diagram (개념 다이어그램)
실제 UI가 아닌 "시스템이 어떻게 동작하는가"를 노드 + 화살표로.
**용도:** 발송 4경로 비교, 자동발송 4단계 라이프사이클, 수신거부 080 연동 흐름 등.

### Pattern G — Side-by-side Comparison
Before/After 또는 옵션 A/B를 2컬럼 분리. 왼쪽 `ink-50` 배경, 오른쪽 `violet-50` 배경.

---

## 4. 공통 컴포넌트

### 4-1. § 섹션 헤더
```html
<div class="mb-10 md:mb-14">
  <div class="font-mono text-[10px] tracking-[0.22em] uppercase text-ink-500 mb-3">§ 02 — Upload & mapping</div>
  <h2 class="text-ink-950 font-semibold tracking-tightest text-[30px] md:text-[42px] leading-[1.1]">엑셀을 올리면, AI가 매핑합니다.</h2>
</div>
```

### 4-2. Meta Row (3-column)
```html
<div class="grid grid-cols-3 gap-4 md:gap-8 max-w-[560px]">
  <div class="pt-4 border-t border-ink-300">
    <div class="font-mono text-[10px] tracking-[0.22em] uppercase text-ink-500">Release</div>
    <div class="mt-2 text-[15px] md:text-[17px] text-ink-900 font-medium num">2026.05</div>
  </div>
  ...
</div>
```

### 4-3. CTA Primary (conic spin)
```html
<a class="cta group inline-flex items-center gap-3 text-white font-medium text-[15px] pl-6 pr-5 h-14 rounded-full">
  <span class="relative z-10">다음 챕터로</span>
  <span class="relative z-10 flex items-center justify-center w-8 h-8 rounded-full bg-white/15 backdrop-blur-sm cta-arrow">→</span>
</a>
```

### 4-4. Callout Block
```html
<aside class="my-10 rounded-2xl border-l-4 border-violet-500 bg-violet-50/60 p-5 md:p-6">
  <div class="flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] uppercase text-violet-700 mb-2">
    <span class="w-1.5 h-1.5 rounded-full bg-violet-600 pulse"></span> Pro only
  </div>
  <p class="text-[14.5px] leading-[1.8] text-ink-800">자동발송은 월 100만원 프로 요금제부터 사용할 수 있습니다.</p>
</aside>
```

Callout 종류:
- `⚠️ Warning` — `border-amber-500 bg-amber-50`
- `💡 Tip` — `border-ink-400 bg-ink-50`
- `⭐ Pro` — `border-violet-500 bg-violet-50`
- `🔒 Admin` — `border-ink-600 bg-ink-900 text-white`

### 4-5. FAQ (details/summary)
transition.html §05 그대로 복사.

### 4-6. CTA Band (ink-950)
챕터 하단 고정. 왼쪽 "지금 이어서 한줄로 시작하세요" + 오른쪽 CTA pill.

---

## 5. 애니메이션 규칙

```css
.reveal { opacity: 0; transform: translateY(14px); transition: opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1); }
.revealed { opacity: 1; transform: translateY(0); }

.d-1 { transition-delay: .05s } .d-2 { transition-delay: .12s } .d-3 { transition-delay: .2s }
.d-4 { transition-delay: .28s } .d-5 { transition-delay: .36s } .d-6 { transition-delay: .44s }
.d-7 { transition-delay: .52s } .d-8 { transition-delay: .6s } .d-9 { transition-delay: .68s }

.pulse::before { content:""; position:absolute; inset:-4px; border-radius:999px; background:rgba(124,58,237,.45); animation: pulse 2s ease-out infinite; }
@keyframes pulse { 0%{ transform: scale(.6); opacity:.6 } 70%{ transform: scale(2.2); opacity:0 } 100%{ opacity:0 } }
```

- `reveal` + `d-N` 조합을 모든 섹션 블록에 적용 (스크롤 시 순차 등장)
- `pulse` — 상태 뱃지 · Live 표시에만
- `.cta::before` conic spin — Primary CTA에만

---

## 6. 배경 디테일 3종

### 6-1. Grid lines (Hero 전용)
```css
.grid-lines { position:absolute; inset:0; pointer-events:none;
  background-image:
    linear-gradient(to right, rgba(11,11,15,0.045) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(11,11,15,0.045) 1px, transparent 1px);
  background-size: 80px 80px;
  mask-image: radial-gradient(ellipse 80% 60% at 70% 40%, black 40%, transparent 85%);
}
```

### 6-2. Grain texture (Hero, CTA band)
SVG turbulence noise, opacity 0.35, mix-blend multiply.

### 6-3. Halo blur (Hero 상징 숫자 뒤)
```css
.halo { position:absolute; border-radius:999px; filter: blur(60px); opacity:.55; pointer-events:none; }
```

---

## 7. 챕터 HTML 파일명 규약

```
docs/manual/chapters/
├── index.html         # 매뉴얼 허브 (목차 페이지)
├── vol-01.html        # 한줄로란?
├── vol-02.html        # 고객 DB
├── vol-03.html        # 발송의 4가지 길
├── vol-04.html        # 자동발송
├── vol-05.html        # AI 문안
├── vol-06.html        # 알림톡 · 브랜드메시지
├── vol-07.html        # 발신번호 · 수신거부 · 스팸필터
└── vol-08.html        # 결과 분석
```

각 챕터 공통:
- `<title>Vol.0X · [제목] — 한줄로 매뉴얼</title>`
- `<meta name="description">` 2줄 요약
- 상단 nav에 **이전 / 다음 챕터 링크**
- 하단 Footer에 **Vol 번호 + 버전 + 빌드스탬프**

---

## 8. Claude 디자인 프롬프트 스켈레톤

각 챕터 HTML을 Claude에서 뽑을 때 쓸 프롬프트 기본 형태.

```
# Context
한줄로(hanjul.ai) 제품 매뉴얼 Vol.0X를 만들고 있다.
디자인 시스템은 docs/manual/EDITORIAL-SYSTEM.md 기준 — Pretendard + ink/violet 팔레트 + § 번호 + Fig 캡션 + reveal 애니메이션.
레퍼런스: docs/transition.html (같은 톤으로)

# Task
아래 챕터 콘텐츠 팩을 기반으로 단일 HTML 파일을 생성하라.

# Content Pack
[챕터 내용 삽입]

# Assets
[스크린샷 경로 리스트]

# Rules
- transition.html과 동일한 Pretendard + tailwind CDN 사용
- 모든 섹션에 reveal + d-N delay
- 본문 한글 word-break: keep-all
- 숫자는 .num 클래스 + tabular-nums
- Fig 캡션은 font-mono 10px tracking 0.22em uppercase
- 스크린샷은 Pattern A (Browser Chrome Frame)으로 감싸기
- 마지막에 이전/다음 챕터 링크 있는 CTA band
```

---

## 9. 체크리스트 (챕터 완성 전)

- [ ] Hero H1에 serif italic 악센트 1회 이상 사용
- [ ] 모든 숫자에 `.num` 클래스
- [ ] 모든 캡션/라벨에 font-mono + tracking 0.22em
- [ ] Reveal + d-N 순차 애니메이션 적용
- [ ] 스크린샷은 전부 Pattern A (Browser Chrome Frame)
- [ ] 최소 1개 이상의 Callout (Pro/Tip/Warning 중)
- [ ] 하단 CTA band (이전/다음 챕터 링크)
- [ ] 빌드스탬프 스크립트 포함
- [ ] `word-break: keep-all` body 기본 적용
- [ ] 모바일 뷰포트에서 Hero 숫자 축소 (`.hero-num` media query)

---

**End of system.** 각 챕터는 이 시스템의 변주일 뿐. 새로운 컴포넌트가 필요하면 이 문서에 먼저 추가하고 챕터에 쓴다.
