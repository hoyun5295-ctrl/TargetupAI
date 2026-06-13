# DM 빠른 시작 12종 설계서 (D) — 2026-06-13

> 모바일 DM 재설계 7개 서브 중 **D**. 연계: G(AI 자동생성), A(섹션 editor).

## 배경 (검색 실측)

빠른 시작이 **7개**(신상품 출시·시즌 세일·추첨 이벤트·매장 안내·설문+보상·신규 환영·룰렛 이벤트). Harold: "아예 12개 채울 수 있도록." 각 카드 클릭 = 시나리오별 섹션 chain + AI 카피 자동 생성 + 편집 모드 진입(marketing_user_ux_priority: 1클릭 = AI 자동 흐름).

> 주의: `dm-template-registry.ts`의 7템플릿(뷰티신상/시즌세일 등)은 **별개 시스템**(템플릿 갤러리). 빠른 시작은 `quick_start_scenario`(dm_pages 컬럼) 기반 — 정의 위치는 구현 시 확인(dm-ai oneShotGenerate scenario 매핑 추정).

## 목표

빠른 시작 시나리오를 12종으로 확장 + 각 미니 폰 썸네일 + 1클릭 즉시 AI 생성·편집 진입.

## 1. 시나리오 12종 (섹션 chain)

| # | 시나리오 | 섹션 구성 | 비고 |
|---|----------|-----------|------|
| 1 | 신상품 출시 | header·hero·product_carousel·cta·footer | 기존 |
| 2 | 시즌 세일 | header·countdown·coupon·hero·cta·footer | 기존 |
| 3 | 추첨 이벤트 | header·hero·lucky_draw·footer | 기존·B연계 |
| 4 | 매장 안내 | header·hero·map_store_locator·store_info·footer | 기존 |
| 5 | 설문 + 보상 | header·hero·survey·instant_coupon·footer | 기존·B연계 |
| 6 | 신규 환영 | header·hero·email_capture·cta·footer | 기존·B연계 |
| 7 | 룰렛 이벤트 | header·roulette·cta·footer | 기존·B연계 |
| 8 | **갤러리 룩북** | header·hero·gallery·product_carousel·cta·footer | 신규(패션/뷰티 화보) |
| 9 | **리뷰 모음** | header·hero·reviews·cta·footer | 신규(신뢰 전환) |
| 10 | **선착순 한정특가** | header·countdown·limited_quantity·coupon·cta·footer | 신규·B연계(잔여수량) |
| 11 | **실시간 투표** | header·hero·poll·cta·footer | 신규·B연계(참여형) |
| 12 | **VIP 초대** | header·hero·promo_code·text_card·cta·store_info·footer | 신규(고급 톤) |

## 2. 1클릭 흐름 (marketing UX)

빠른 시작 카드 클릭 → 즉시 `oneShotGenerate`(G) AI 호출(시나리오별 섹션 chain + 카피 자동) → 완성된 DM + 편집 모드 진입. **추가 입력·중간 선택 0단계**(feedback_marketing_user_ux_priority).

## 3. 미니 폰 썸네일

- `DmThumbnail` 공용 컴포넌트(list-enhancement spec `2026-06-13-dm-builder-list-enhancement`와 동일): 시나리오 섹션 구성을 9:16 미니 폰 프레임에 색블록 스택으로 도식화.
- 빠른 시작 갤러리 + DM 목록 카드 공용 재사용.

## 4. AI 카피 (G 연계, 임의 혜택 금지)

각 시나리오 생성 시 AI는 흐름·구조·인사문만 채우고 구체 혜택(%/원/쿠폰/무료)은 `[직접 작성해주세요]` placeholder(feedback_ai_no_arbitrary_benefit).

## 검증

- frontend tsc 0. 12 시나리오 섹션 chain 정확. 각 maxCount(SECTION_META) 준수.
- 자가 grep: 박-단어·모델명·native dialog 0.

## 배포

`tp-push` → frontend `build:safe` + backend(시나리오 매핑이 backend면 `pm2 restart all`).
