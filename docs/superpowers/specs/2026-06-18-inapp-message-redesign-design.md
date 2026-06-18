# 인앱 메시지 디자인·카피 전면 개선 — 설계서

- 날짜: 2026-06-18
- 작성: 비토 (한줄로 CTO)
- 승인: Harold (4가지 방향 동의 2026-06-18)

## 배경 (Harold 피드백 그대로)

- 모달 퀄리티가 약하다 — 이미지가 모달 크기에 안 맞고(높이 190px 하드코딩), 이미지 없으면 그라데이션 배경에 텍스트만 떠서 휑하다.
- AI 생성 카피가 너무 길다 — 인앱 팝업인데 200~400자라 안 읽힌다. 짧고 강렬해야 한다.
- 결과물이 "신상품 입고" 한 종류처럼 단편적이다 — 빠른 시작 7개 시나리오 + 자연어 입력마다 색·뱃지·카피가 다양해야 한다. NEW 같은 뱃지는 좋다.
- 편집 모달이 복잡하다 — 여덟 덩어리가 세로로 쌓여 고급설정을 펼치기도 전에 빽빽하다. 심플하되 기능은 다 있어야 한다.

## 범위

### 포함

1. SDK 모달 렌더러(`packages/sdk-js/src/inapp.ts`) 디자인 격상
2. 미리보기(`packages/frontend/src/components/InAppMessagePreview.tsx`) — SDK와 1:1 정합
3. AI 생성기(`packages/backend/src/utils/inapp-ai-generator.ts`) — 시나리오별 색/뱃지/짧은 카피 + 카피 길이 축소
4. 편집 모달(`packages/frontend/src/pages/InAppMessagesPage.tsx`) — 8섹션 → 3탭 심플화 (기능 전부 유지)
5. 신규 `badge_text` 컬럼 (시나리오 뱃지 저장)

### 비포함 (따로 진행)

- 이미지 저장이 비는 원인 디버깅 (배포는 됐다는 전제, 실측 1건으로 별도 확인)
- 서수란 팀장 모바일 DM 요구(완성 이미지 업로드 → 슬라이드/스크롤 → 단축 URL) — 별도 작업

## 상세 설계

### 1. 데이터 — `badge_text` 컬럼 신규

- `cdp_inapp_messages.badge_text varchar(20)` nullable.
- ⚠ `db_column_verify_before_code` 룰 — 코드 작성 전 `information_schema` 존재 검증 SQL을 Harold께 먼저 제공하고, ALTER 실행 결과 확인 후 코드 진입.
- `inapp-message.ts` INSERT/UPDATE에 `badge_text` 추가. UPDATE는 `COALESCE` 사용(빈 입력에 기존값 보존 — image_url 직접대입 버그와 같은 함정 회피).
- SCHEMA.md 갱신.

### 2. AI 생성기 — 시나리오 매핑 + 카피 축소

#### 2-1. 카피 길이 (핵심)

- 현재 시스템 프롬프트의 "본문 200~400자 풍성하게 의무" 제거.
- 신규 지침: 제목 18자 안, 본문 1~2문장(40~70자) 짧고 강렬. 한 호흡에 읽히게.
- 응답 JSON 예시·userMessage도 동일하게 수정.
- 구체 혜택(%/원/쿠폰/무료/할인) 임의 작성 금지 + `[혜택 안내 — 직접 작성해주세요]` placeholder 유지 (`feedback_ai_no_arbitrary_benefit`).

#### 2-2. 시나리오별 색/뱃지/카피 톤 매핑

빠른 시작 7 시나리오 SEED + 자연어 추론 모두 적용. 색은 추천 프리셋이며 사용자가 8종에서 자유 변경.

| 시나리오 | 추천 프리셋 | 뱃지(기본) | 제목 톤 예시 |
|---|---|---|---|
| cart_recovery | 선셋 | 장바구니 | 두고 가신 상품이 기다려요 |
| new_welcome | 포레스트 | WELCOME | 첫 방문을 환영해요 |
| dormant_recovery | 미드나잇 | 오랜만이에요 | 다시 만나 반가워요 |
| new_product | 캔디 | NEW | 이번 주 신상품 |
| vip_appreciation | 골드 럭스 | VIP | 고객님께 감사드려요 |
| checkout_abandon | 선셋 | 거의 다 왔어요 | 결제만 남았어요 |
| repeat_purchase | 오션 | 다시 만나요 | 그때 그 상품, 어떠세요 |

- 뱃지는 시나리오 라벨(혜택 X). AI가 자연어에서 시나리오를 추론해 적절 뱃지/제목/추천색 생성.
- `badge_text`는 AI 생성 결과에 포함 + 편집 가능.

### 3. SDK 모달 렌더러 (`inapp.ts`)

- `renderCenterModal` 이미지: 높이 190px 하드코딩 제거 → `aspect-ratio: 4/3; width:100%; object-fit:cover` (모달 폭에 비례, 잘림 최소).
- 이미지 없으면: 상단 색 영역 + 뱃지·제목 타이포 중심으로 분기(휑하지 않게).
- 뱃지 렌더: 제목 위 작은 pill (`badge_text` 있을 때). 배경은 메시지 색 계열.
- 본문 줄임: modal clamp 8 → 3 (짧은 카피 전제).
- CTA: 기존 stack 풀폭 유지 + 마감 다듬기.
- 다른 템플릿(banner/slide_in/toast 등)도 뱃지·짧은 카피와 톤 일관성 점검.

### 4. 미리보기 (`InAppMessagePreview.tsx`)

- modal hero 높이 118px 고정 → SDK와 같은 4:3 비율.
- 뱃지 렌더 추가. clamp modal 8 → 3.
- `PreviewButton`/props에 `badge` 추가.

### 5. 편집 모달 (`InAppMessagesPage.tsx`) — 3탭

기능 하나도 빼지 않음(`feedback_ui_simplify_not_empty`). 세로 8섹션을 성격별 3탭으로 묶음.

- 탭1 내용: 제목, 본문, 뱃지, CTA 버튼, 혜택 placeholder 경고
- 탭2 디자인: 표시 형태(4종), 디자인 프리셋(8종), 이미지 업로드
- 탭3 타겟·시점: 타겟 세그먼트, 트리거, 시간대/요일, 빈도 (기존 "고급설정" 단일 접기를 이 탭으로 흡수해 제거)
- 우측 실시간 미리보기는 탭 무관 항상 고정.
- 빠른 시작/AI 생성 진입 시 내용 탭이 이미 채워져 그대로 저장 가능(`marketing_user_ux_priority` — 클릭 최소).
- ConfirmModal/useToast 유지, native dialog 0건.

## 영구 룰 정합

- `feedback_ai_no_arbitrary_benefit` — 구체 혜택 placeholder 유지, 뱃지는 혜택 아닌 라벨.
- `feedback_ui_simplify_not_empty` — 탭으로 묶되 기능·진입점 제거 0.
- `design_quality_minimum_journey_level` — 다크+violet 톤, 헤더, 미리보기, 모바일 반응형 유지.
- `no_model_name_ui_exposure` — UI 모델명 0건.
- `db_column_verify_before_code` — badge_text ALTER는 information_schema 검증 후 코드.

## 검증 계획

- backend / frontend / sdk-js `tsc` 0
- sdk-js `vitest` (모달 렌더 + 뱃지 + 4:3 케이스 추가)
- grep 0건: 박-단어, 모델명, native dialog(alert/confirm/prompt)
- AI 생성 카피 길이 실측 1건(본문 70자 이내 확인)
- 디자인 자가점검: 7 시나리오 색/뱃지/카피 다양 + 편집 3탭

## 배포 (참고)

- DB ALTER(Harold 실행) → backend `pm2 restart targetup-backend`(build:safe 금지 — ts-node, OOM 사고) → frontend `build:safe` → sdk-js `build:all` + company-frontend `public/sdk` + `dist/sdk` cp (캐시버스팅 버전업).
