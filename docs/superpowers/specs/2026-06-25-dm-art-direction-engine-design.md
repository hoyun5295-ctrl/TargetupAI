# 모바일DM 아트디렉션 엔진 설계서 (P1)

- 작성일: 2026-06-25
- 상태: 설계 확정(브레인스토밍 완료) — 구현 대상
- 작성: 비토 (브레인스토밍 스킬 경유)
- 선행: 모바일DM 전 구조 직접 감사(2026-06-25)

---

## 0. 배경 / 감사 결론

모바일DM 빌더는 기능적으로 이미 성숙하다 — 3분할 에디터, 섹션 27종(카드형·수집형·이벤트형·임베드), AI(프롬프트 파싱·레이아웃 추천·카피 생성·톤 변환·개선·원샷·비주얼 디렉터·섹션 레이아웃·개인화·이벤트 추천·자가진단), AB테스트·버전관리·브랜드킷·검증·발행 뷰어·성과 지표. 기능을 더 늘릴 필요는 적다.

문제는 **결과물이 "디자인된" 느낌이 아니라 "AI가 찍어낸 템플릿"으로 보인다**는 점이다. 직접 확인한 근본 원인:

- `dm-section-renderer.ts`가 **섹션 타입마다 구도(레이아웃)를 사실상 1개씩만** 만든다. 예: `renderHero`는 항상 "이미지 + 하단 그라데이션 + 하단 정렬 텍스트" 하나뿐.
- `dm-visual-direction.ts`의 비주얼 디렉터는 **색·무드만** 바꾼다(`applyVisualDirection`은 accent_color + 이미지 없는 hero의 mood_background만 주입).
- `VisualConcept`에 `type_scale`('bold'|'editorial'|'minimal')·`hero_treatment`('gradient'|'color_block'|'image')가 선언돼 있으나 **구도/타이포에는 미사용**(잠자는 스캐폴딩).
- 타이포 스케일(`DM_TYPOGRAPHY.scale`)·여백(`DM_SPACING`)은 단일 고정값. 캠페인 톤에 따라 변하지 않는다.

즉 색만 바뀌고 **구도·타입스케일·여백·악센트가 고정**이라 평범해 보인다. 이 설계는 그 셋을 깨워 출력 디자인 품질을 끌어올린다.

### 결정사항 (Harold 2026-06-25)
- 세 방향(① AI 결과물 디자인 품질 ② 빌더 에디터 경험 ③ 인터랙티브 섹션 완성도)을 **3 phase로 분할**. 본 설계서는 **P1(아트디렉션 엔진)** 단독. P2(에디터 경험)·P3(인터랙티브 폴리시)는 별도 spec.
- 접근: **A안(큐레이션 treatment 라이브러리 + AI 디렉터)**. AI가 CSS 직접 생성(B안)·완성형 템플릿 세트(C안)는 채택 X(C는 후일 A 위 보완재).

### 공통 원칙
- 모든 판정·정규화·토큰 산출은 순수 함수(DB import 0) + `*.verify.ts`(ts-node) / `*.test.ts`(vitest) TDD.
- 컨트롤타워 내부 수정만 — 렌더러/디렉터 인라인 헬퍼 금지.
- AI는 **구도·스타일만** 다룬다. 카피·혜택(%/원/쿠폰/무료) 절대 생성 X(feedback_ai_no_arbitrary_benefit).
- 하위호환: 기존 DM(treatment/아트디렉션 없음)은 **현행 그대로 렌더**(비파괴).
- 토큰 SSOT 3파일 동기화: `packages/backend/src/utils/dm/dm-tokens.ts` · `packages/frontend/src/utils/dm-tokens.ts` · `packages/frontend/src/styles/dm-builder.css`.

---

## 1. 아키텍처 — 2계층

### Layer A · 아트디렉션 (DM 1개당 1세트)

기존 `VisualConcept`(dm-visual-direction.ts)를 확장한 `ArtDirection`. DM 전체에 일관 적용되는 "디자인 언어".

```ts
export type ArtDirection = {
  // 기존 VisualConcept 보존
  palette: { primary: string; accent: string; surface: string; on_surface: string };
  mood: string;
  emphasisSections: string[];
  // 확장 — 구도/타이포/여백/모티프
  typeScale: 'editorial' | 'bold' | 'minimal';   // 기존 type_scale를 실제 구현
  headlineFont: 'sans' | 'serif';                // editorial은 serif 디스플레이 옵션
  spacingDensity: 'compact' | 'standard' | 'airy';
  accentMotif: 'none' | 'rule' | 'index' | 'bracket' | 'dot';
  sectionDivider: 'none' | 'hairline' | 'gap' | 'rule';
};
```

- `typeScale` → 뷰어 `:root` CSS 변수 override(헤드라인 사이즈·중량·트래킹).
  - editorial: 디스플레이 크게 + (옵션)serif + 트래킹 타이트
  - bold: 고중량 산세리프 + 트래킹 약간 타이트
  - minimal: 절제된 크기·중량 + 트래킹 0
- `spacingDensity` → 섹션 패딩/간격 변수 배율(compact 0.8 / standard 1.0 / airy 1.4).
- `accentMotif`·`sectionDivider` → 렌더러가 섹션 사이/안에 작은 디자인 요소(규칙선·인덱스 번호·괄호·도트·구분선)를 일관 삽입.

### Layer B · treatment (섹션마다 1개)

섹션 타입별 **구도 변형**. `Section`에 `treatment?: string` 신설(의미 분리: 기존 `style_variant`=색/톤은 유지, `treatment`=구도). 미설정 = `classic` = 현행 렌더와 동일.

P1 우선 섹션 + treatment 세트:

| 섹션 | treatment | 비고 |
|------|-----------|------|
| hero | `classic`(현행) · `full_bleed` · `split` · `typographic` · `editorial_overlap` | 가장 많이 노출 |
| text_card | `classic`(현행) · `lead`(오버사이즈 리드+규칙선) · `framed`(테두리 카드+악센트) | 카피 중심 |
| cta | `classic`(현행) · `bar`(풀폭 악센트 바+화살표) · `ghost`(아웃라인 대형 라벨) | 전환 |
| coupon | `classic`(현행) · `ticket`(티켓형) · `spotlight`(코드 강조) | 혜택 |

나머지 23종 섹션은 P1에서 `classic` 유지(이후 확대). 단 Layer A(타이포·여백·모티프)는 **전 섹션 즉시 적용**(구도 변형 없이도 전체 품질 상승).

---

## 2. 파일 맵 (신규/수정)

**신규(순수 + 테스트):**
- `packages/backend/src/utils/dm/dm-art-direction.ts` — `normalizeArtDirection`·`artDirectionToCssVars`·`selectTreatment`·treatment 허용표(순수)
- `packages/backend/src/utils/dm/__tests__/dm-art-direction.verify.ts` (ts-node)
- `packages/backend/src/utils/dm/dm-treatment-render.test.ts` (vitest — 렌더 구조/하위호환 골든)

**수정:**
- `dm-visual-direction.ts` — `VisualConcept`→`ArtDirection` 확장(보존+추가), `applyVisualDirection`이 treatment·아트디렉션 동봉
- `dm-tokens.ts` — `renderArtDirectionCss(ad)` 추가(타이포·여백 변수 override), 디스플레이 폰트 변수 `--dm-font-display`
- `dm-section-registry.ts` — `Section.treatment?: string` + 섹션별 허용 treatment 메타
- `dm-section-renderer.ts` — `renderHero`/`renderTextCard`/`renderCta`/`renderCoupon`을 treatment 디스패처로(각 순수 HTML), 모티프/구분선 삽입
- `dm-ai.ts` — `designVisualConcept` 프롬프트가 아트디렉션+섹션별 treatment 추천 출력, `oneShotGenerate` 동봉
- `dm-viewer.ts` — `renderArtDirectionCss` 주입(기존 `renderDmTokensCss` 다음)
- 프론트 미러: `packages/frontend/src/utils/dm-tokens.ts` + `dm-builder.css`(새 변수), 캔버스 우선 섹션(`HeroSection`/`TextCardSection`/`CtaSection`/`CouponSection`)·`SectionRenderer` treatment 분기, `DmRightPanel`/`SectionPropsEditor` treatment 픽커(최소), 상단 아트디렉션 토글(최소)

---

## 3. 순수 함수 시그니처 (TDD 대상)

```ts
// dm-art-direction.ts (DB import 0)

export const TREATMENTS: Record<string, readonly string[]> = {
  hero: ['classic', 'full_bleed', 'split', 'typographic', 'editorial_overlap'],
  text_card: ['classic', 'lead', 'framed'],
  cta: ['classic', 'bar', 'ghost'],
  coupon: ['classic', 'ticket', 'spotlight'],
};

// 요청 treatment 검증 → 허용표에 있으면 그대로, 없거나 미설정이면 결정적 기본값.
//   아트디렉션 영향: typeScale='editorial' + hero 이미지 없음 → 기본값 'typographic'.
export function selectTreatment(
  sectionType: string,
  requested: string | undefined,
  ctx: { typeScale?: ArtDirection['typeScale']; hasImage?: boolean },
): string;

// AI 출력(부분/불량 가능)을 안전 기본값으로 정규화. normalizeVisualConcept 확장.
export function normalizeArtDirection(
  raw: Partial<ArtDirection> | null | undefined,
  industry: string,
  tone?: string,
): ArtDirection;

// 아트디렉션 → 뷰어 :root override CSS 문자열(타이포·여백 변수). 기존 토큰 뒤에 주입돼 우선.
export function artDirectionToCssVars(ad: ArtDirection): string;
```

**테스트(verify):**
- `selectTreatment`: 유효 passthrough / 미허용→classic / 미설정→classic / editorial+이미지없는 hero→typographic / 알 수 없는 섹션→classic.
- `normalizeArtDirection`: 누락→안전 기본(bold/standard/none/sans) / 잘못된 enum→기본 / 업종 색 fallback / tone 반영(premium→editorial 경향 등 결정적 규칙).
- `artDirectionToCssVars`: 각 typeScale·density가 기대 변수 override 포함 / serif면 `--dm-font-display` serif.

**테스트(렌더 vitest):**
- 각 treatment가 렌더되고 기대 구조 마커 포함 + 입력 escape.
- **classic 하위호환 골든**: treatment 미설정 섹션이 변경 전과 구조 동일(현행 보존 증명).

---

## 4. AI 디렉터 확장 (dm-ai.designVisualConcept)

- 프롬프트에 아트디렉션 필드(typeScale·headlineFont·spacingDensity·accentMotif·sectionDivider) + **우선 섹션별 treatment 추천** 출력 추가.
- 출력은 `normalizeArtDirection` + `selectTreatment`로 안전화 → AI가 누락/오작해도 **최소 classic+기본 토큰**(현행보다 나빠지지 않음).
- **카피·혜택 절대 생성 X** — 구도·스타일 enum만. 시스템 프롬프트 최상단 명시.
- `oneShotGenerate`가 생성 섹션에 treatment + 아트디렉션 동봉. `applyVisualDirection`이 색뿐 아니라 treatment·아트디렉션을 함께 적용.

---

## 5. 빌더 노출 (P1 최소 — 풀 UX는 P2)

- 우측 패널(`SectionPropsEditor`)에 우선 섹션 한정 "구도(treatment)" 픽커(라벨/썸네일). 변경 시 캔버스 재렌더.
- 상단(`DmTopBar` 또는 소형 패널)에 아트디렉션 토글(typeScale·density·motif) + "AI에게 맡기기"(디렉터 호출).
- 컨트롤 시각 폴리시·드래그·인라인 편집 고도화는 **P2**. P1은 동작 픽커 + ConfirmModal/useToast(native dialog 0) + 모델명 0.

---

## 6. 렌더 일치(WYSIWYG) / SSOT

- 뷰어(발행물) 렌더가 1순위. 에디터 캔버스(우선 섹션)는 같은 treatment 분기를 미러 → 마케터가 보는 미리보기 = 고객이 받는 발행물.
- 새 CSS 변수는 SSOT 3파일 동시 수정(backend dm-tokens · frontend dm-tokens · dm-builder.css). 누락 시 미리보기↔발행물 불일치.

---

## 7. 리스크 / 안전망

- **하위호환**: classic 골든 테스트로 기존 DM 불변 증명. treatment/아트디렉션 미설정 경로가 현행과 동일해야 통과.
- **AI 변동성**: normalize 바닥값으로 "현행보다 나빠지지 않음" 보장.
- **WYSIWYG 드리프트**: 우선 섹션 뷰어/에디터 양쪽 테스트 + SSOT 3파일 체크리스트.
- **혜택 생성**: AI는 enum만 — 카피/혜택 props 불변(applyVisualDirection 영구 룰 유지).
- **프론트 자가검증**: 모델명 0 / native dialog 0 / 박-단어 0.
- 큰 작업이므로 종결 직전 `/codex:review` 권장.

---

## 8. 구현 순서

1. `dm-art-direction.ts` 순수(TREATMENTS·selectTreatment·normalizeArtDirection·artDirectionToCssVars) + verify (RED→GREEN).
2. `dm-tokens.ts renderArtDirectionCss` + 새 변수(SSOT 3파일) + verify.
3. `dm-section-registry.ts Section.treatment` + 허용 메타.
4. `dm-section-renderer.ts` treatment 디스패처(hero→text_card→cta→coupon) + 모티프/구분선 + classic 골든 테스트(vitest).
5. `dm-viewer.ts` renderArtDirectionCss 주입.
6. `dm-visual-direction.ts applyVisualDirection` treatment·아트디렉션 동봉 + `VisualConcept`→`ArtDirection`.
7. `dm-ai.designVisualConcept` 프롬프트 확장 + `oneShotGenerate` 동봉(혜택 생성 0 명시).
8. 프론트 미러: dm-tokens/dm-builder.css 변수, 캔버스 우선 섹션 treatment 분기, SectionPropsEditor treatment 픽커, 상단 아트디렉션 토글.
9. backend tsc 0 + vitest 회귀 + 신규 verify, frontend tsc 0 + 자가 grep(모델명/dialog/박-단어 0).

## 범위 밖 (P1 X)
- 비우선 섹션 23종 treatment(이후 확대).
- 에디터 드래그·인라인 편집·실시간감 고도화(P2).
- 인터랙티브 섹션 모션·터치 폴리시(P3).
- 발행 뷰어 로딩/스크롤 모션/OG(Harold 미선택 — 후일).
