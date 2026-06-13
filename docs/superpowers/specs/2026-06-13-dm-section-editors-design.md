# DM 섹션 속성 editor 완성 설계서 (A) — 2026-06-13

> 모바일 DM 재설계 7개 서브 중 **A**. 선행: B(인터랙션) 데이터모델. 연계: C(이미지).

## 배경 (검색 실측)

`SectionPropsEditor.tsx`의 switch는 기존 11섹션(header/hero/coupon/countdown/text_card/cta/video/store_info/sns/promo_code/footer)만 분기하고, **신규 16섹션은 `default: return null`** → 룰렛/상품/갤러리/설문 등을 선택해도 우측 속성 패널이 제목만 뜨고 **설정이 0**이다. (Harold 스크린샷의 "룰렛 이벤트 속성"이 빈 이유.)

## 목표

신규 16섹션의 속성 editor를 전부 작성하고, B의 경품 설정(`dm_prizes`)을 룰렛/추첨 editor에 통합한다. 모든 섹션이 우측 패널에서 완전히 설정 가능해진다.

## 전제 (실측)

- editor 11개 존재: editors/{Header,Hero,Coupon,Countdown,TextCard,Cta,Video,StoreInfo,Sns,PromoCode,Footer}Editor.tsx.
- `SectionPropsEditor`가 type별 분기, `EditorProps<P> = { props, onUpdate }`.
- props 구조는 `dm-section-registry.ts`(backend SSOT) + `dm-section-defaults.ts`(frontend 미러)에 16섹션 전부 정의됨 — **editor만 없다**.

## 1. 신규 editor 16종

각 editor는 props 필드를 `FormControls`(Field/TextInput/TextArea/Select/Toggle/ColorPicker/DateTimePicker/ImageUploader)로 매핑.

| 섹션 | editor 핵심 필드 |
|------|------------------|
| product_carousel | 상품 반복행(이미지·이름·가격·할인가·할인율·링크) + 인디케이터·자동슬라이드 |
| gallery | 다중 이미지 업로더 + 레이아웃(2×2/3×3/1×N) + 줌·풀스크린 |
| slideshow | 슬라이드 반복행(이미지·캡션) + 간격·일시정지 |
| tab_cards | 탭 반복행(라벨·콘텐츠타입·내용) + 기본탭 |
| poll | 질문 + 옵션 반복행 + 복수선택·결과표시·1인1회 |
| survey | 질문 반복행(타입 single/multiple/text/rating·필수) + 진행률·보상문구 |
| email_capture | 헤드라인·설명·보상·동의문구·동의필수·성공문구 |
| click_rewards | 타입(like/share/scroll)·목표수·보상·진행률 |
| **lucky_draw** | 제목·폼필드(name/phone/email 토글)·마감일시·동의문구 **+ 경품 등급/인원(dm_prizes)** |
| **roulette** | 세그먼트 반복행(라벨·확률·경품) **+ dm_prizes 매핑** + 1인1회 + 확률 합계 검증 |
| instant_coupon | 쿠폰라벨·할인설명·만료·조건·사용안내 |
| limited_quantity | 제목·설명·총수량 |
| youtube_embed | URL·자동재생 |
| instagram_embed | post URL |
| map_store_locator | 매장 반복행(이름·주소·좌표·전화·시간) + 사용자위치 |
| reviews | 리뷰 반복행(별점·작성자·본문·날짜) + 평균표시·더보기 |

## 2. 공통 컴포넌트 (신규)

- **`RepeatableList`**: 반복 항목(상품/이미지/탭/질문/세그먼트/매장/리뷰) 추가·삭제·드래그 순서변경 공용. props: `{ items, render, onAdd, onRemove, onReorder, addLabel, max }`.
- **`MultiImageUploader`**(C 연계): 갤러리/슬라이드 다중 이미지.
- 룰렛 확률 합계 인디케이터(합 100% 검증, 초과/미달 경고).

## 3. B 연계 — 경품 editor

- `lucky_draw` editor: 폼·마감·동의 + **경품 등급 반복행**(등급·경품명·인원) → `dm_prizes`(win_method='random').
- `roulette` editor: 세그먼트별 경품·확률 + 재고 → `dm_prizes`(win_method='roulette', roulette_segment_id).
- 저장 시 sections.props와 dm_prizes 동기화(A의 onUpdate가 prizes draft 보관 → 발행 시 dm_prizes INSERT, B에서 처리).

## 4. SectionPropsEditor 확장

switch에 16 case 추가 + import. default null 제거(전 섹션 editor 보장).

## 검증

- frontend tsc 0. 각 editor props 매핑 정확.
- 자가 grep: 박-단어·모델명·native dialog 0. AI 임의 혜택(%/원/쿠폰) placeholder만.
- 룰렛 확률 합계 순수 검증 함수 TDD(backend로 분리 — `sumProbabilities`).

## 배포

`tp-push` → frontend `build:safe`(editor는 frontend). backend 무관(props는 SSOT 기존).
