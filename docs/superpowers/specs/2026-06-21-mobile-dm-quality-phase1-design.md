# 모바일DM 결과물 퀄리티 강화 — Phase 1 설계 (2026-06-21)

> 브레인스토밍 결론. Harold 승인 후 writing-plans로 구현 계획 작성.
> 작업 흐름: 본 spec 승인 → 구현 계획 → TDD 구현 → 검증 → 배포(Harold).

## 1. 배경

모바일DM은 기능 범위(27종 섹션·AI 생성·인터랙션·페이지분할)는 이미 넓다. 그러나 "결과물 완성도"가 떨어진다는 진단. 코드 근거 3갭:
1. AI 생성물 비주얼 공백 — 생성하면 이미지 없는 텍스트 골격 + "[추가해주세요]" placeholder.
2. 천편일률 레이아웃 — objective 5종·시나리오 12종 고정 템플릿.
3. 신규 16섹션 렌더 디테일 — 이모지 + 하드코딩 색 박스, 옛 11섹션보다 거침.

Harold가 세 갭 모두 공감(편집 UX는 제외). 단계 합의:
- **Phase 1 (본 문서) = 즉효·전 회사·인프라 0**: 갭3(렌더 격상) + 갭1의 범용분(AI 비주얼 디렉션 + 브랜드 자산).
- Phase 2 = 연동사 상품 카탈로그(갭1의 연동분).
- Phase 3 = AI 섹션 구성·순서 다양화(갭2의 구조분).

## 1-A. 핵심 가치 — "AI가 만들어준다"는 체감 (Harold 명시 2026-06-21)

**Phase 1의 합격 기준**: AI 생성 직후 결과물이 "이걸 AI가 만들었네" 싶은 완성도여야 한다.
- 빈 골격 + placeholder가 아니라, **사진이 없어도** 색면·타이포·구성으로 "디자인된" 완성형 그래픽이 나와야 한다.
- 그 비주얼을 **AI가 캠페인마다 다르게 설계**해야 한다. 규칙으로 색을 1:1 채우는 자동화로는 "AI 느낌"이 나지 않는다.
- 즉 단위 B의 본질은 "자산 자동배치"가 아니라 **AI 비주얼 디렉션**이다.

## 2. 현황 (코드 근거)

- **렌더**: 옛 11섹션(hero/coupon/countdown/promo_code 등)은 디자인 토큰(`var(--dm-*)`) 기반으로 정제됨. 신규 16(lucky_draw/roulette/instant_coupon/limited_quantity/poll/survey/email_capture/product_carousel/gallery/slideshow 등)은 큰 이모지(🎁🎡🎟️⏳) + 하드코딩 색(`#fef3c7`·`#7c3aed`·`#fee2e2`) + 단순 박스. 코드 주석도 "SSR placeholder"로 명시(`dm-section-renderer.ts:315`).
- **토큰 자산**: `DM_COLOR_TOKENS`에 neutral·brand·semantic + **industry(beauty `#ec4899` / fashion `#18181b` / food `#ea580c` / tech `#0ea5e9` / luxury `#1e3a8a`, 각 accent 포함)** 보유. `DM_SPACING`·`DM_RADIUS`·`DM_SHADOW`(sm~xl)·`getContrastRatio`(WCAG) 완비. 신규 섹션이 이 자산을 거의 안 씀.
- **생성**: `oneShotGenerate`가 `brandKit = { tone }`만 반환, 섹션 props에 이미지·색·비주얼 컨셉 미주입. `hero.image_url` 빈 채 → 렌더가 검정 배경(`--dm-neutral-900`) + 텍스트. carousel/gallery는 "[추가해주세요]". 카피만 생성하고 **디자인 판단은 0**.
- **brandKit 구조**: `logo_url`·`primary/secondary/accent/neutral/background_color`·`font_family`·`tone`·`contact`·`sns`. brand-extractor가 og:image·favicon·theme-color를 채울 수 있음(대표 이미지 1장 + 로고 + 색 수준).

## 3. 단위 A — 신규 16섹션 렌더 디테일 격상 (완성도 토대)

**목적**: 신규 16섹션을 옛 11 수준의 정제 디자인으로 끌어올린다. AI 디렉션(단위 B)이 입혀질 깨끗한 토대.

**설계**:
- **색**: 하드코딩(`#fef3c7` 등) → 디자인 토큰(`var(--dm-primary/accent/neutral)`, `--dm-shadow-*`). 섹션 `accent_color` override 존중(렌더 wrap이 이미 `--dm-primary` 주입).
- **아이콘**: 큰 이모지(🎁🎡🎟️) → 절제된 인라인 SVG 아이콘(단색 `currentColor`, 일관 크기). 섹션 성격상 아이콘이 군더더기면 제거하고 타이포로 강조. SVG는 외부 의존 없이 문자열 내장.
- **레이아웃**: 여백(`--dm-sp-*`)·라운드(`--dm-radius-*`)·그림자(`--dm-shadow-*`) 토큰 통일. 카드 경계·시각 계층 명확화. 버튼은 공통 `.dm-cta` 클래스 재사용.
- **대상(가시 높은 순)**: lucky_draw · roulette · instant_coupon · limited_quantity · poll · survey · email_capture · reviews · product_carousel · gallery · slideshow · tab_cards · click_rewards · map_store_locator · youtube_embed · instagram_embed.
- **SSOT**: backend `dm-section-renderer.ts`(발송·뷰어 HTML) + frontend 편집 미리보기 미러 + `dm-builder.css` 동시 수정.

## 4. 단위 B — AI 비주얼 디렉션 + 브랜드 자산 ("AI가 만들어준다"의 핵심)

**목적**: AI가 캠페인마다 비주얼을 설계해 완성형으로 채운다. 사진이 없어도 "디자인됐다"는 결과.

**설계**:
- **AI 비주얼 디렉터(신규)**: 생성 시 AI가 brand·objective·industry·캠페인 맥락으로 **비주얼 컨셉**을 JSON으로 설계.
  - 컨셉 스키마(예): `{ palette: { primary, accent, surface, on_surface(hex) }, mood: 키워드, hero_treatment: 'gradient'|'color_block'|'image', emphasis_sections: [강조 섹션 id], rhythm: 섹션 강약 패턴, type_scale: 'bold'|'editorial'|'minimal' }`.
  - 색은 brandKit이 있으면 그 색에서 조화로운 팔레트를 파생, 없으면 industry 토큰 기반으로 AI가 무드에 맞게 결정. (같은 브랜드라도 캠페인 목적에 따라 다른 팔레트.)
  - AI는 **디자인 디렉션만** 만든다. 구체 혜택(%/원/쿠폰/무료)·상품명·가격 등 사실은 생성하지 않는다(기존 영구 룰 유지).
- **컨셉 적용(순수 함수)**: `applyVisualDirection(sections, direction)` — 컨셉을 섹션 색(`accent_color`)·무드 배경·강조·타이포 강약에 매핑. DB-free.
- **무드 배경(순수 함수)**: `buildMoodBackground(palette | industry, mood)` → 이미지 없는 hero·시각 섹션을 휑한 검정/placeholder 대신 팔레트 그라데이션 + 강한 타이포로 완성. CSS 문자열 반환.
- **브랜드 자산 배치**: brandKit에 로고·대표이미지가 있으면 `header.logo_url`·`hero.image_url`에 우선 배치(없으면 강제 X, 무드 배경으로 대체).
- **placeholder 정제**: "[추가해주세요]" 직설 문구 → 옅은 톤의 디자인된 안내(편집 모드에서만 강조). 발송·미리보기에서는 무드 배경으로 자연스럽게.
- **WCAG**: 팔레트 대비를 `getContrastRatio`로 확보(어두운 배경 → 흰 글자, 밝은 배경 → 진한 글자). 컨셉 색이 대비 미달이면 자동 보정.
- **모델 분리**: AI 호출은 DM 도메인 모델 정책 그대로(`model: 'opus'`, source 집계). 사용자 노출 모델명 0.

## 5. 비범위 (다음 Phase — 본 작업서 제외)

- **Phase 2**: provider 상품 카탈로그 조회 신규(cafe24/naver `read_product` scope 보유, 호출 함수 미구현) → carousel·gallery에 실제 상품·가격·이미지 자동.
- **Phase 3**: AI 섹션 구성·순서 다양화(고정 objective/시나리오 템플릿 → 콘텐츠 기반 섹션 chain 결정). ※ Phase 1의 AI 디렉션은 "비주얼(색·무드·강조)"까지, 섹션 "구성·순서"는 Phase 3.

## 6. 영구 룰 준수

- 모델명 UI 노출 0(추상 명칭).
- **AI 임의 혜택 금지 유지** — 이미지·색·레이아웃·무드·비주얼 컨셉은 혜택이 아니다. %/원/쿠폰/무료 등 구체 혜택 문구는 여전히 생성 X, `[직접 작성해주세요]` placeholder 유지.
- 박-단어 0 / native dialog 0(편집 UI 변경 시 ConfirmModal·useToast).
- SSOT 동시 수정(backend renderer ↔ frontend 미러 ↔ dm-builder.css).
- 발송 경로 영향 점검 — 렌더러는 발송 HTML·뷰어·미리보기 공용이므로 세 경로 동일 결과 확인.
- Zero-Count / AI 단독발송 X 등 기존 원칙 무관(본 작업은 생성·렌더만, 발송 트리거 변경 0).

## 7. 테스트 전략 (TDD)

- **순수 함수 우선 분리 후 TDD**(DB-free): `applyVisualDirection`, `buildMoodBackground`, 팔레트 대비/보정 헬퍼, `mapBrandKitToSections`. `.verify.ts` ts-node.
- **AI 비주얼 디렉터**: 컨셉 JSON 파서·정규화(잘못된 hex·누락 필드 안전 기본값)를 순수 TDD. AI 호출 자체는 통합(tsc + 검증된 callAIWithFallback 패턴).
- **렌더 격상**: 섹션별 HTML 문자열 골든 점검(토큰 변수·`.dm-cta`·아이콘 포함, 하드코딩 hex 잔존 0).
- backend tsc 0 + frontend tsc 0 + 자가 grep(박-단어·모델명·native dialog·하드코딩 hex).

## 8. 작업 순서

1. **단위 A (렌더 격상)** — 가시 즉효·의존성 0. 신규 16섹션 토큰화 + 골든. AI 디렉션이 입혀질 토대.
2. **단위 B (AI 비주얼 디렉션)** — 순수 함수(컨셉 적용·무드 배경·대비 보정) TDD → AI 비주얼 디렉터 추가 → `oneShotGenerate` 주입 → 렌더 반영.

## 9. 핵심 결론

Phase 1의 본질은 "자동 색 채우기"가 아니라 **AI가 캠페인마다 비주얼을 설계해 완성형으로 만들어주는 경험**이다. 외부 API·저작권·신규 인프라 0으로, 토큰 자산(업종 색·그림자) 위에 AI 디렉션을 얹어 전 회사가 즉시 "AI가 디자인했다"는 결과를 받는다. 실제 상품 이미지(Phase 2)·섹션 구성 지능(Phase 3)은 이 토대 위에 얹는다.
