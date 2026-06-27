# 인앱메시지 렌더 퀄리티 격상 — 설계서 (구현 직행용)

작성: 2026-06-27 · 기획: 비토(CTO) · 다음 세션 구현 전용
목표: 쇼핑객이 보는 인앱메시지 그 자체를 "단색 텍스트 카드" → **요즘 잘 만든 앱 수준의 블록 조립 테마 메시지**로 격상. 브레이즈/Iterable/OneSignal 압도.

> 이 문서 하나로 다음 세션이 추측 없이 구현한다. 모든 변경은 **실제 파일·함수·컬럼**에 근거한다. DB 컬럼 추가는 구현 시점 `information_schema` 검증 후 ALTER([[feedback_db_column_verify_before_code]]).

---

## 0. 핵심 원칙 (절대 준수)

1. **블록 시스템 = 추가 레이어, 레거시 100% 보존.** `content_blocks`가 있으면 새 렌더러, 없으면 기존 렌더러 그대로. 운영 중 6,000사+ 기존 메시지 외형 변화 0.
2. **마케터가 보는 콘솔이 아니라 쇼핑객이 보는 메시지가 핵심.** (콘솔 slate 재설계는 별도 — 본 설계서 §11은 블록 작성 UI 최소만.)
3. **AI 임의 혜택 금지 유지.** `benefit` 블록 기본값 = `[혜택 안내 — 직접 작성해주세요]`. 저장 시 placeholder 잔존이면 차단(현행 검증 확장).
4. **모델명 UI 노출 0** / **native dialog 0**(ConfirmModal·useToast) / **0건 자동완화 X** / **Source caption** / **모바일 반응형** — 전부 유지.
5. **SDK는 자사몰에서 조용히 실패.** 블록 파싱 실패·미지원 블록 = 그 블록만 skip, 메시지는 표시(자사몰 안 깨짐).

---

## 1. 현재 실측 (grounded)

- DB `cdp_inapp_messages` 33컬럼(SCHEMA.md:1824): title·body·action_url·action_label·position·background_color·text_color·trigger_event·display_frequency·start_at·end_at·status·template·image_url·buttons(jsonb)·segment_conditions(jsonb)·trigger_conditions(jsonb)·personalization_vars(jsonb)·parent_message_id·variant_weight·auto_dismiss_seconds·max_displays_per_user·send_start_hour·send_end_hour·allowed_weekdays·locale_variants·animation·channel.
- SDK `packages/sdk-js/src/inapp.ts`: `renderMessage()`가 template 8종 분기 → `renderBanner/CenterModal/FullScreen/SlideIn/InlineCard/Toast/FloatingButton`. 공통 헬퍼 `appendImage/appendBadge/appendTextBlock/appendButtons/appendCloseButton/applyAnimation`. 메시지 = `background_color` 단색/그라데이션 한 장 위 title(700)+body(opacity .82)+badge+buttons+close.
- 프리뷰 `packages/frontend/src/components/InAppMessagePreview.tsx`: SDK 톤 1:1 모사(디바이스 프레임 안 Overlay). 동일 한계.
- AI 생성기 `packages/backend/src/utils/inapp-ai-generator.ts`(CT-77): `generateInAppMessagePackage()`가 평면 `GeneratedInAppMessage{title,body,badge_text,template,image_url,buttons,background_color,...}` JSON 출력. 6 sub-agent 진행 응답.
- 라우트 `routes/cdp.ts`: GET `/inapp/active`(561) SDK 조회, POST `/inapp/ai-generate`(1228) 생성.

## 2. 격차 5축 (현재 → 목표)

| 축 | 현재 | 목표(모던 앱 수준) |
|---|---|---|
| 구성 | title+body 한 덩어리 | 블록 조립(미디어/아이브로우/헤드라인/본문/리스트/혜택/카운트다운/평점/제품/CTA/푸터) |
| 테마 | raw 색상 피커(단색 범람) | 큐레이션 테마(light/dark/brand/vibrant/minimal) + 면 깊이 + accent 토큰 |
| 타이포 | 시스템 굵게 1줄 | 타입 스케일·위계(eyebrow/headline/body/caption) |
| 모션 | 등장 1회(fade/slide/bounce/pulse) | 등장 + 콘텐츠 순차 등장 + 버튼 누름 + 축하(celebrate) + prefers-reduced-motion |
| 디테일 | 단색+그림자 | 이미지 마스크·둥근 기하·대비 접근성·구분선·티켓 모양 |

---

## 3. 데이터 모델 — 신규 컬럼 3개

구현 시점 `information_schema`로 먼저 검증, 없으면 ALTER:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='cdp_inapp_messages' AND column_name IN ('content_blocks','theme','accent_color');

ALTER TABLE cdp_inapp_messages ADD COLUMN IF NOT EXISTS content_blocks jsonb DEFAULT '[]'::jsonb;
ALTER TABLE cdp_inapp_messages ADD COLUMN IF NOT EXISTS theme varchar(30) DEFAULT 'auto';
ALTER TABLE cdp_inapp_messages ADD COLUMN IF NOT EXISTS accent_color varchar(20);
```

- `content_blocks` jsonb = 순서 있는 블록 배열(§4). 비어 있으면 레거시 렌더.
- `theme` = 큐레이션 테마 키(§5).
- `accent_color` = 액센트 hex(테마가 면을 정하고 액센트만 회사색). NULL이면 테마 기본 accent. **`background_color`는 레거시 메시지 전용으로 그대로 둔다(건드리지 않음).**
- `animation` 컬럼 재사용 — 허용값에 `'spring'`, `'celebrate'` 추가(컬럼 변경 X, 값만 확장).
- DB ALTER 활용 endpoint catch에 `column does not exist` → 503 `DB_MIGRATION_PENDING` 분기(현행 `handle503` 유지).

## 4. 블록 카탈로그 (content_blocks 정밀 스키마)

각 블록 = `{ type, ...props }`. 순서 = 화면 위→아래. 미지원 type = SDK가 skip.

| type | props | 렌더 |
|---|---|---|
| `media` | `variant:'image'\|'icon'\|'illustration'`, `url?`, `icon?`(아이콘 키), `aspect?:'16:9'\|'4:3'\|'1:1'\|'banner'`(기본 16:9), `fit?:'cover'\|'contain'`, `radius?`, `overlay?:boolean` | 이미지=마스크+aspect 고정+lazy+onerror 숨김 / icon=accent 원형 배지 / illustration=내장 SVG 세트 |
| `eyebrow` | `text`, `tone?:'accent'\|'neutral'\|'on_media'` | 작은 라벨/칩(11px·600·letter-spacing). accent=accent색 |
| `headline` | `text`, `size?:'lg'\|'xl'`(기본 lg) | 헤드라인(lg 18 / xl 22, weight 600, line-height 1.3) |
| `body` | `text` | 본문(13.5px, secondary 색, line-height 1.55, clamp 템플릿별) |
| `bullets` | `items:[{icon?,text}]`(2~4) | 체크/아이콘 + 텍스트 리스트 |
| `benefit` | `text`(기본 `[혜택 안내 — 직접 작성해주세요]`) | 점선 티켓 모양(좌측 노치) + gift 아이콘 + accent. **placeholder 잔존 시 저장 차단** |
| `countdown` | `ends_at`(ISO), `label?` | 남은 시간 카운트(SDK setInterval, 만료 시 숨김) |
| `rating` | `value`(0~5), `count?`, `label?` | 별점(아이콘) + "4.6 · 후기 N" |
| `product` | `image?`, `name`, `meta?`, `rating?` | 썸네일 + 이름 + 메타(가격 자리 placeholder) + 평점 1행 카드 |
| `divider` | — | 1px 구분선(테마 border) |
| `spacer` | `size?:'sm'\|'md'\|'lg'` | 수직 여백 |
| `cta_group` | `layout?:'stack'\|'inline'`, `buttons:[InAppButton+'ghost']` | 버튼 1~3. primary=accent 채움 / secondary=면 / ghost=텍스트. 누름 피드백. 클릭=track(button_id)+이동 |
| `footer` | `text?` | 잔글씨/광고 표기. **is_ad=true면 자동 주입(광고 + 무료거부 080)** |

- 모든 텍스트 블록(`eyebrow/headline/body/benefit/bullets.text/product.name/cta.label/footer`) = Liquid `{{ customer.X }}` + `%변수%` 치환 대상(§9).
- `InAppButton`에 `style:'ghost'` 추가(현 primary/secondary/tertiary + ghost). SDK·프리뷰·편집기 공통.

## 5. 테마 시스템

테마 = 토큰 세트. SDK·프리뷰 공용 단일 정의(`packages/sdk-js/src/inapp-theme.ts` 신규 + 프리뷰가 동일 토큰 import 또는 미러).

```ts
interface InAppTheme {
  surface: string;        // 카드 배경
  surfaceElevated: string;// 블록 내부 면(benefit/product)
  textPrimary: string;
  textSecondary: string;
  accent: string;         // accent_color 우선, 없으면 테마 기본
  accentText: string;     // accent 위 글자
  border: string;
  radius: number;         // 카드 모서리
  shadow: string;
}
type ThemeKey = 'auto'|'light'|'dark'|'brand'|'vibrant'|'minimal';
```

큐레이션 테마:
- `light` — surface #fff / text #0f172a·#64748b / border rgba(15,23,42,.08) / shadow soft. accent=accent_color\|\|#6d5cf0.
- `dark` — surface #14182b / text #eef1f8·#aab0c6 / border rgba(255,255,255,.08). accent 동일.
- `brand` — surface 중립(#fff 또는 #14182b 자동) + accent=회사 accent_color 강조(면은 중립, 액센트만 브랜드).
- `vibrant` — surface=accent_color 채움 / text 흰색 / accentText=accent / 환영·축하용.
- `minimal` — surface #fff·flat·그림자 약 / 액센트 절제.
- `auto` — 자사몰 `prefers-color-scheme` 따라 light/dark.

규칙:
- 테마가 **면**을 정하고 **accent**만 회사색 → 단색 범람 제거.
- 대비 자동 점검: accent 위 글자는 accentText, 면 위 글자는 textPrimary. 대비 부족 시 SDK가 textPrimary를 면 명도로 보정.
- **레거시 호환**: `content_blocks` 없으면 테마 무시 + 기존 `background_color/text_color` 단색 렌더 그대로(외형 변화 0).

## 6. 타이포 + 모션

타이포 토큰(테마 무관 고정): eyebrow 11/600/+.04em · headline-lg 18/600 · headline-xl 22/600/-.01em · body 13.5/400/1.55 · caption 11/500. 폰트 스택 = 현행 `-apple-system,...`.

모션(`applyAnimation` 확장 + 신규 `staggerReveal`):
- 등장: 템플릿별(modal=spring scale-in, slide_in=slide-right, banner=slide-top/bottom, toast=bounce, full=fade-up).
- 콘텐츠 순차 등장: 블록 0→N 60ms stagger(opacity+translateY 8px). 카드 등장 후 1프레임.
- `cta_group` primary 누름: active scale .98 + 그림자 변화.
- `celebrate`(animation='celebrate'): 등장 시 가벼운 컨페티(SDK 내장 canvas-free DOM 입자 ~12개, 600ms, 1회). 환영/축하 전용.
- **`prefers-reduced-motion: reduce`면 stagger·celebrate·spring 끄고 즉시 표시**(접근성).

## 7. 템플릿 = 컨테이너 (8종 × 허용 블록)

템플릿은 위치·크기만, 내용은 블록. 일부 템플릿은 블록 제한:

| 템플릿 | 컨테이너 | 허용 블록 |
|---|---|---|
| center_modal | 중앙 backdrop, max 400, radius theme | 전부 |
| full_screen | 전체화면 중앙 | 전부(+ 슬라이드 다단 추후) |
| slide_in | 우하단 max 340 | media(소)·eyebrow·headline·body·rating·product·benefit·cta_group |
| bottom_banner / top_banner | 가로 고정 1행 | media(아이콘)·eyebrow·headline·body(1줄)·cta_group(inline) |
| inline_card | DOM inline(selector) | 전부 |
| toast | 우상단 소형 3초 | eyebrow·headline·body(짧게) — CTA·media 제외 |
| floating_button | 우하단 알약 | cta_group 1개만(라벨) |

미허용 블록이 들어오면 SDK가 해당 템플릿에서 skip(안전).

## 8. SDK 렌더 아키텍처 (`packages/sdk-js/src/inapp.ts`)

핵심: `renderMessage()`에서 분기 **전에** content_blocks 판정.

```
renderMessage(msg, input):
  blocks = msg.content_blocks (파싱·검증)
  if blocks && blocks.length > 0:
    theme = resolveTheme(msg.theme, msg.accent_color)
    container = makeContainer(template, theme)      // 위치·면·radius·shadow (기존 render* 컨테이너 로직 재사용)
    renderBlocks(container.contentRoot, blocks, theme, msg, input)  // 블록 → DOM, 허용블록 필터, stagger
    mountWithMotion(container, animation, template)
  else:
    <기존 renderBanner/CenterModal/... 그대로>   // 레거시 폴백 — 변경 0
  track impression + markSeen + incrementDisplayCount + sticky (현행 공통)
```

신규 파일/함수:
- `inapp-theme.ts` — `resolveTheme(themeKey, accentColor): InAppTheme` + 토큰 테이블.
- `inapp-blocks.ts` — `renderBlocks(root, blocks, theme, msg, input)` + 블록별 `renderMediaBlock/renderHeadlineBlock/...`. 버튼 클릭·dwell·track은 기존 `appendButtons` 트래킹 로직 재사용(button_id).
- `inapp.ts` — `makeContainer(template, theme)`(기존 render* 컨테이너 스타일을 테마 토큰 기반으로 일반화), `renderMessage` 분기 추가, `applyAnimation` 확장, `staggerReveal`.
- 레거시 `render*`는 **삭제 X** — content_blocks 없을 때 그대로 호출.

## 9. 백엔드

- `utils/inapp-message.ts getActiveMessagesForCustomer` — SELECT에 `content_blocks, theme, accent_color` 추가, 응답 필드 포함. (information_schema 검증 후)
- 블록 텍스트 Liquid 치환 = **SDK 클라이언트 단일 처리**(현행 `replaceVariables`가 title/body만 → 블록 텍스트 필드로 확장). 서버는 raw 블록 + customer 동봉(현행 패턴 유지). `utils/inapp-personalization.ts`는 서버 렌더 경로가 생길 때만 블록 대응 추가(1차 불요).
- 라우트 `/inapp/active`(routes/cdp.ts:561) — 응답 메시지에 `content_blocks, theme, accent_color` 포함(getActive가 반환하면 자동).
- AI 생성기 `inapp-ai-generator.ts`(CT-77) — `GeneratedInAppMessage`에 `content_blocks: Block[]`, `theme: ThemeKey`, `accent_color: string` 추가. 시스템 프롬프트에 §4 블록 카탈로그 + §5 테마 + 작성 규칙(benefit 블록은 placeholder 고정, headline 변수 X·body 변수 O) 주입. 출력 JSON에 `content_blocks`·`theme`·`accent_color` 추가. **검증**: 블록 type 화이트리스트, benefit.text placeholder 강제, 미지원 필드 제거, image 블록 url은 AI 생성 금지(현행 image 환각 차단 규칙과 동일 — url 비움). title/body는 **접근성·레거시 폴백용으로 계속 출력**(블록의 headline/body와 동일 텍스트).
- 저장 검증(routes save) — content_blocks 안 benefit placeholder 잔존 시 차단(현행 body 검증을 블록까지 확장).

## 10. 프리뷰 컴포넌트 (`InAppMessagePreview.tsx`)

- SDK와 **동일 토큰·블록 렌더**로 parity. `inapp-theme` 토큰을 프리뷰도 사용(SDK 패키지에서 import 가능하면 import, 아니면 동일 상수 미러 + 주석으로 단일 출처 표기).
- props에 `blocks?: Block[]`, `theme?: ThemeKey`, `accentColor?: string` 추가. 있으면 블록 렌더, 없으면 기존 title/body 렌더(레거시 미리보기).
- 디바이스 토글(데스크탑/모바일)·샘플 customer(VIP/일반/신규) Liquid 치환은 블록 텍스트에도 적용.

## 11. 관리자 편집기 (블록 작성 — 최소 + slate 톤)

> 콘솔 전면 재설계는 별도. 여기선 블록을 만들 수 있는 UI만, slate 톤으로.

- `InAppMessagesPage.tsx` 편집 모달 좌측 '내용' 탭 → **블록 컴포저**: 블록 추가(+ 메뉴 13종)·순서 변경(위/아래 또는 드래그)·블록별 인라인 편집(텍스트/아이콘/버튼). 우측 실시간 프리뷰가 블록 렌더.
- 상단에 **테마 피커**(light/dark/brand/vibrant/minimal 칩) + accent 색 1개(raw 색상 피커는 'accent'만, 면은 테마가 결정). 기존 8 색상 프리셋 = accent 프리셋으로 축소.
- AI 자동 생성 결과 = content_blocks로 들어와 컴포저에 채워짐(편집 모드 진입).
- 레거시 메시지(블록 없음) 열면 = "블록으로 전환" 1버튼(현 title/body/buttons → 헤드라인/본문/CTA 블록으로 1:1 변환) 제공. 전환 전엔 기존 폼 유지.
- native dialog 0 · 모델명 0 · Source caption 유지.

## 12. 백워드 호환 + 안전 + 룰

- content_blocks 빈 메시지 = 레거시 렌더(외형 변화 0). 신규/전환 메시지만 블록.
- SDK 블록 파싱 실패·미지원 type·필수 필드 누락 = 그 블록만 skip(자사몌 안 깨짐).
- AI 임의 혜택 0(benefit placeholder 강제 + 저장 차단). is_ad → footer 자동(광고+080).
- 0건 세그먼트 = 안내만. 모델명 UI 0. native dialog 0.
- 이미지 = AI 생성 url 금지(환각 차단), 회사 admin 업로드만(현행 유지).

## 13. 접근성

- 테마별 대비 AA 보정(면↔글자). prefers-reduced-motion 존중. media `alt`(빈 alt 허용 — 장식). close 버튼 `aria-label`. 키보드 닫기(Esc) — modal/full.

## 14. 다음 세션 구현 순서 (파일별 — no 추측)

1. DB: information_schema 검증 → ALTER 3컬럼(content_blocks·theme·accent_color) + animation 값 확장(코드만). Harold 직접 SQL.
2. SDK: `inapp-theme.ts`(resolveTheme+토큰) → `inapp-blocks.ts`(renderBlocks+블록 렌더러) → `inapp.ts`(renderMessage 분기·makeContainer·모션 확장). 레거시 render* 보존. 단위 테스트(`__tests__/inapp-blocks.test.ts`).
3. Backend: `inapp-message.ts` getActive SELECT 확장 → `/inapp/active` 응답 → AI 생성기 CT-77 블록 출력 + 시스템 프롬프트 + 검증 → 저장 placeholder 검증 확장.
4. Preview: `InAppMessagePreview.tsx` 블록 렌더 parity(테마 토큰 공용).
5. Frontend 편집기: 블록 컴포저 + 테마 피커 + 레거시 전환 버튼(slate 톤).
6. 검증: backend tsc 0 · 프론트 tsc 0 · SDK 빌드 0 · vitest(블록 렌더·테마 해석·AI 블록 검증) · 금지 패턴(모델명/native dialog/박-단어) grep 0 · 레거시 메시지 외형 회귀 0(블록 없는 메시지 = 기존 렌더 확인).

## 15. 구현 전 확정 필요

1. `content_blocks` 안 benefit 외 placeholder 정책(예: product.image 비었을 때 표시) — 기본: 비면 블록 skip.
2. illustration 내장 SVG 세트 범위(환영/축하/빈장바구니 등 ~6종) — 1차 6종 고정.
3. countdown `ends_at` 만료 후 메시지 전체 숨김 여부 — 1차: countdown 블록만 숨김, 메시지 유지.
4. 레거시→블록 전환 버튼의 자동 변환 매핑 확정(title→headline, body→body, image_url→media, buttons→cta_group, background_color→accent_color 또는 vibrant 테마).

---

## 16. 다음 세션 진입 명령어 (그대로 붙여넣기)

```
인앱메시지 렌더 퀄리티 격상 구현 — 쇼핑객이 보는 메시지를 모던 앱 수준(블록 조립 + 테마 + 모션)으로.

[정독 순서]
1. docs/superpowers/specs/2026-06-27-inapp-message-elevation-design.md (전체 — 블록 13종·테마 5·모션·파일별 §14·기본값 §15)
2. status/lessons/LESSONS_FRONTEND.md + status/lessons/LESSONS_META.md
3. memory: feedback_db_column_verify_before_code · feedback_ai_no_arbitrary_benefit · feedback_no_native_browser_dialog · feedback_ai_operator_model_isolation · feedback_no_bakkeum_usage

[현재 코드 — 재확인용]
- SDK: packages/sdk-js/src/inapp.ts (renderMessage 8종 분기 + appendTextBlock/Buttons/Image)
- 프리뷰: packages/frontend/src/components/InAppMessagePreview.tsx
- AI 생성기: packages/backend/src/utils/inapp-ai-generator.ts (CT-77)
- 페이지: packages/frontend/src/pages/InAppMessagesPage.tsx
- DB: cdp_inapp_messages 33컬럼 (status/SCHEMA.md:1824)

[구현 순서 — 스펙 §14, 추측 금지]
1. DB: information_schema 검증 SQL을 Harold께 먼저 → content_blocks jsonb · theme varchar(30) · accent_color varchar(20) ALTER(Harold 직접). animation 값 spring/celebrate 추가는 코드만.
2. SDK: inapp-theme.ts(resolveTheme+토큰) → inapp-blocks.ts(renderBlocks+13 블록 렌더러) → inapp.ts(renderMessage 분기·makeContainer·모션 확장). 레거시 render* 보존(삭제 X). __tests__/inapp-blocks.test.ts.
3. 백엔드: inapp-message.ts getActive SELECT 확장 → /inapp/active 응답 → inapp-ai-generator CT-77 블록 출력 + 시스템 프롬프트(블록 카탈로그·테마·benefit placeholder 강제·image url 비움) + 검증 → 저장 placeholder 검증을 블록까지 확장.
4. 프리뷰 parity(테마 토큰 공용) → 편집기 블록 컴포저 + 테마 피커 + 레거시 전환 버튼(slate 톤).
5. 검증: backend tsc 0 · 프론트 tsc 0 · SDK 빌드 0 · vitest(블록 렌더·테마 해석·AI 블록 검증) · 금지 패턴 grep 0(모델명/native dialog/박-단어) · 레거시 메시지 외형 회귀 0(블록 없는 메시지 = 기존 렌더 확인).

[절대 룰]
- content_blocks 없으면 레거시 렌더 그대로(운영 메시지 외형 변화 0). 신규·전환만 블록.
- AI 임의 혜택 0(benefit 블록 placeholder 강제 + 저장 차단) · 모델명 UI 0 · native dialog 0(ConfirmModal/useToast) · is_ad → 광고+080 자동 · 이미지 AI 생성 url 금지.
- 매 코드 수정 직전 MANDATORY_CHECKLIST 출력 · 매 답변 직전 박-단어/모델명 grep 0.
- §15 구현 전 확정 4건은 문서 기본값으로 진행.
```

---

## 변경 이력
| 날짜 | 변경 | 담당 |
|---|---|---|
| 2026-06-27 | 인앱메시지 렌더 격상 설계서 신설(블록+테마+모션, 레거시 보존) | 비토 + Harold |
