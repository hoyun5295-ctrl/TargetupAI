# Slot Manifest Spec v1 — 인쇄전단 V2 (D129)

> **목적:** 템플릿 1개 = HTML/CSS + **Slot Manifest(JSON)** 한 쌍.
> 엔진은 manifest를 읽어 엑셀 데이터를 슬롯에 주입하고, Paged.js로 렌더.
>
> **설계 원칙:**
> 1. 디자인은 HTML/CSS가 책임, **배치 규칙은 manifest가 책임** (관심사 분리)
> 2. 슬롯은 **반응형**(fr/% 단위) — 규격 바뀌어도 자동 맞춰짐
> 3. 슬롯은 **선언적** — "무엇을 받을지"만 기술, 엔진이 매칭

---

## 1. Manifest 최상위 구조

```json
{
  "id": "mart_spring_v1",
  "version": "1.0.0",
  "name": "마트 봄세일 A3 세로형",
  "industry": "mart",
  "season": "spring",
  "paper": { "size": "A3", "orientation": "portrait" },
  "pages": 1,
  "assets": {
    "css": "template.css",
    "html": "template.html",
    "preview": "preview.png"
  },
  "tokens": "design-tokens.json",
  "slots": [ ... ]
}
```

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 고유 ID. 폴더명과 일치. snake_case |
| `version` | semver | 템플릿 버전 (데이터 구조 호환성) |
| `industry` | enum | `mart`/`butcher`/`fruit`/`fish`/`convenience`/`general` |
| `season` | enum | `spring`/`summer`/`autumn`/`winter`/`chuseok`/`seol`/`general` |
| `paper.size` | PaperSizeKey | `PAPER-SIZES.ts` 참조 |
| `paper.orientation` | `portrait`/`landscape` | |
| `pages` | number | 1 이상. 2 이상이면 page-break 규칙 필요 |

---

## 2. 슬롯 타입 (13종)

각 슬롯은 공통 필드 + 타입별 필드를 가진다.

### 공통 필드

```json
{
  "id": "hero_title",
  "type": "text",
  "required": true,
  "editable": true,
  "maxLength": 20,
  "fallback": "이번 주 특가전",
  "position": { "css": ".slot-hero-title" }
}
```

| 필드 | 설명 |
|---|---|
| `id` | 슬롯 고유 ID. template.html 내 `data-slot="id"` 또는 CSS 셀렉터와 매칭 |
| `type` | 아래 13종 중 하나 |
| `required` | true면 빈값 시 렌더 거부, false면 빈 슬롯 자동 숨김 |
| `editable` | 사용자 에디터에서 편집 가능 여부 |
| `fallback` | 값 없을 때 기본값 (required=true일 때만 활성) |
| `position.css` | CSS 셀렉터 (슬롯 대상 DOM 위치) |

### 슬롯 타입별 스펙

#### 2.1 `text` — 단일 텍스트
```json
{ "type": "text", "id": "store_name", "maxLength": 30 }
```

#### 2.2 `rich_text` — 여러 줄/마크업 허용
```json
{ "type": "rich_text", "id": "store_address", "allowedTags": ["br","strong"] }
```

#### 2.3 `typography` — 장식 타이포(히어로 등) + AI 생성 가능
```json
{
  "type": "typography", "id": "hero_title",
  "aiGenerate": {
    "prompt": "마트 계절 세일 메인 카피, 8~14자, 굵은 디스플레이 느낌",
    "variants": 3
  },
  "effects": ["gradient", "outline"]
}
```

#### 2.4 `image` — 단일 이미지
```json
{
  "type": "image", "id": "store_logo",
  "aspectRatio": "1:1",
  "fit": "contain",
  "bgRemoval": false
}
```

#### 2.5 `qr` — QR 코드
```json
{
  "type": "qr", "id": "qr_online_mall",
  "source": "field:online_mall_url",
  "sizeMm": 30
}
```

#### 2.6 `map` — 약도 이미지
```json
{ "type": "map", "id": "store_map", "fallback": "assets/placeholder/map.svg" }
```

#### 2.7 `product_card` — 단일 상품 카드
```json
{ "type": "product_card", "id": "hot_item", "variant": "main" }
```

#### 2.8 `product_grid` — 상품 그리드 (고정 선택 기준)
```json
{
  "type": "product_grid", "id": "main_grid",
  "cols": 4, "rows": 1,
  "minItems": 3, "maxItems": 4,
  "selection": {
    "mode": "highest_discount",
    "filter": { "promoType": "main" }
  },
  "cardVariant": "main"
}
```

`selection.mode`:
- `highest_discount` — 할인율 상위
- `manual` — 사용자가 직접 선택
- `ai_recommend` — LLM 추천 (Phase 2)
- `featured` — `featured=true` 플래그된 상품
- `random` — 랜덤

#### 2.9 `category_grid` — 카테고리별 상품 그리드
```json
{
  "type": "category_grid", "id": "fresh_left",
  "cols": 3, "rows": 5,
  "category": { "mode": "auto", "prefer": ["축산","정육","한우"] },
  "overflow": "shrink"
}
```

`category.mode`:
- `auto` — 상품 분포 보고 자동 결정
- `fixed` — `category.name` 고정
- `prefer` 배열 순서대로 시도, 상품 있는 첫 카테고리 채택

`overflow`:
- `shrink` — 슬롯에 안 맞으면 카드 축소
- `paginate` — 다음 페이지로 분할
- `truncate` — 잘라냄

#### 2.10 `section_banner` — 섹션 배너 (SVG 또는 텍스트+배경)
```json
{
  "type": "section_banner", "id": "fresh_banner",
  "label": "자연에서 신선한 그대로",
  "svgAsset": "banners/fresh_stripe_red.svg",
  "editableText": true
}
```

#### 2.11 `store_header` — 매장정보 헤더 (복합)
```json
{
  "type": "store_header", "id": "masthead",
  "includes": ["logo", "name", "hours", "phone", "address", "map", "qr"],
  "layout": "3col"
}
```

#### 2.12 `footer_notice` — 하단 유의사항
```json
{
  "type": "footer_notice", "id": "fine_print",
  "template": "default",
  "editable": true,
  "fallback": "행사상품은 조기 품절될 수 있습니다. 사진은 이미지컷이며 실제와 다를 수 있습니다."
}
```

#### 2.13 `decoration` — 장식 요소(고정, 데이터 없음)
```json
{
  "type": "decoration", "id": "flower_top_left",
  "svgAsset": "deco/spring_flower_pink.svg",
  "static": true
}
```

---

## 3. 데이터 바인딩 플로우

```
[엑셀] → [excel-mapper (Claude)] → [정규화된 상품배열]
                                          │
                                          ▼
[manifest.slots] ←→ [slot-filler.ts]
                        │
     ┌──────────────────┼──────────────────┐
     ▼                  ▼                  ▼
[image-processor]  [product-classifier]  [ai-copy]
  (rembg)           (카테고리 정규화)     (히어로 카피)
     │                  │                  │
     └──────────────────┼──────────────────┘
                        ▼
              [채워진 슬롯 데이터]
                        │
                        ▼
     [template.html + template.css + data]
                        │
                        ▼
        [Paged.js (DOM 가공) → Puppeteer → PDF]
```

---

## 4. HTML 연결 규약

`template.html`의 각 슬롯 대상 엘리먼트는 두 방법 중 하나:

**방법 A — data-slot 속성 (추천)**
```html
<div class="hero" data-slot="hero_title">봄세일의특가전</div>
```

**방법 B — CSS 셀렉터 매칭**
```html
<div class="slot-hero-title">봄세일의특가전</div>
```
manifest에 `"position": { "css": ".slot-hero-title" }` 명시.

**그리드 슬롯**은 자식 템플릿을 `<template>` 태그로 정의:
```html
<div class="main-grid" data-slot="main_grid">
  <template data-role="card">
    <div class="card">
      <img data-bind="imageUrl">
      <div class="price" data-bind="salePrice"></div>
      <div class="name" data-bind="productName"></div>
    </div>
  </template>
</div>
```

slot-filler가 `<template>`을 복제해서 상품 수만큼 삽입.

---

## 5. 검증 규칙 (validator)

- [v] 필수 슬롯 누락 시 에러 (required=true + fallback 없음)
- [v] 슬롯 ID 중복 금지
- [v] `position.css` 셀렉터가 template.html에 실재하는지 확인
- [v] `selection.mode` / `overflow` 값 enum 검증
- [v] `paper.size`가 PAPER-SIZES.ts에 존재하는지
- [v] `aspectRatio` 형식 (`W:H` 또는 숫자)
- [v] `aiGenerate.prompt`가 있을 때 `variants` 1~5 범위

validator는 `renderer/template-registry.ts`의 `loadTemplate()` 시점에 실행.

---

## 6. 확장 포인트 (Phase 2+)

- **브랜드킷 오버라이드:** `tokens.overrides` 필드로 매장별 컬러/폰트 교체
- **A/B 배리언트:** `variants: [{id, weight}]` 한 manifest에 여러 레이아웃
- **다중 페이지:** `pages > 1` + `pageBreakAfter` 슬롯 속성
- **모션:** `export: ["pdf", "mp4"]` + keyframes 필드
