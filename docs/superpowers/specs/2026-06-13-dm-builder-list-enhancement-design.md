# 모바일 DM 빌더 목록 페이지 강화 설계서 (2026-06-13, Harold 승인)

## 배경

`/dm-builder` 목록 화면이 "많이 부족해" 보임 (Harold 명시 — 중앙정렬 + 완성도). 코드 실측으로 3대 원인 확정.

1. 중단부 통째 증발 — 5지표·AI 진단·1-click 액션·자세히 분석이 전부 `overview &&` 게이트. `/dm/overview` 실패/지연이면 프런트가 silent fallback(catch 무처리) → overview=null → 블록 전체가 화면에서 사라짐. 스크린샷이 그 상태(빠른 시작 → 바로 목록).
2. 중앙정렬 깨짐 — 목록 그리드 `repeat(auto-fill, minmax(280px,1fr))` + 카드 1~2개면 좌측 쏠림, 우측 공백.
3. 카드가 글자뿐 — DmCard에 시각 미리보기 없음. `getDmList`가 `status`만 주고 `approval_status` 미반환이라 카드가 항상 "임시저장" 표시. AI 진단 문구에 내부 개발 용어 노출.

## 전제 (실측 확정)

- `dm_pages`에 `status`(draft/published) + `approval_status`(draft/review/approved/published/rejected) 둘 다 존재. `layout_mode`/`sections`(Section[] jsonb)/`brand_kit`/`quick_start_scenario` 모두 실재 (SCHEMA.md D125/D216+).
- DB 변경 0. `getDmList` SELECT 확장 + clone 엔드포인트만 backend.
- 정확 컬럼 추가 SQL 작성 직전 information_schema 재확인은 불필요(전부 기존 컬럼) — SCHEMA.md 기록 + 기존 코드 사용분으로 확정.

## Phase 1 — Backend (소)

### 1-A. getDmList 확장 (utils/dm/dm-builder.ts)
현재: `id, title, store_name, status, short_code, view_count, jsonb_array_length(pages) as page_count, created_at, updated_at`.
추가: `layout_mode, approval_status, sections, brand_kit, quick_start_scenario`.
반환 직전 각 행에서 `sections`(또는 legacy `pages`) → `section_summary` 계산 후 **sections/brand_kit 원본은 응답에서 제거**(목록 payload 경량 유지).

### 1-B. section_summary 순수 함수 (신규 — TDD 대상)
`buildSectionSummary(row) → { types: string[], headline: string|null, accent: string|null, count: number }`
- `types`: visible 섹션을 order순 정렬 후 type만, 최대 6개. sections 없으면 legacy pages 길이만 count.
- `headline`: 첫 hero/header/text_card props에서 제목/문구 추출(없으면 null).
- `accent`: brand_kit primary 색(없으면 null).
- DB/AI 의존 0 → scripts/verify-dm-list.ts로 검증.

### 1-C. clone 엔드포인트
`POST /api/dm/:id/clone` — 회사 격리 검증 후 행 복제: 새 id, `title = "{원제목} 사본"`, `status='draft'`, `approval_status='draft'`, `short_code=null`, `view_count=0`, sections/brand_kit/settings 등 콘텐츠 복사. CT 함수 `cloneDm(id, companyId, userId)` 신설. 크레딧 차감 0(복제는 AI 호출 없음).

## Phase 2 — Frontend (대, DmBuilderPage.tsx)

### 2-A. 빈 화면 차단 (근본)
지표 5·AI 진단·1-click·자세히 분석을 `overview &&` 게이트에서 분리해 **항상 렌더**.
- 로딩 중: 스켈레톤(지표 카드 자리만).
- overview 성공: 실값.
- overview 실패/지연: `total_dm`은 목록 길이, 나머지 0. 진단 문구는 "데이터 모으는 중" 톤.
- overview useEffect catch에서 폴백 객체 세팅(목록 기반)으로 변경.

### 2-B. 레이아웃 / 중앙정렬
- 컨테이너 max-width 통일(1100 유지) + 헤더 아래 히어로 띠(인사 + 주요 현황 1줄 + AI로 만들기 CTA).
- 목록 그리드: 고정 트랙 `repeat(auto-fill, 264px)` + `justify-content: center` → 카드 1~2개도 중앙. (모바일 1열 자동.)

### 2-C. DmCard 재설계 + 폰목업 썸네일
- 상단: 9:16 미니 폰 프레임. `section_summary.types`를 색 블록 스택으로 도식화(타입별 색 매핑 + accent 반영), `headline` 1줄 오버레이. legacy(slides)는 page_count 블록.
- 하단: 제목 + store + 상태 배지(approval_status 실값) + 열람/CTR 배지 + 액션(편집/복제/삭제).
- 복제 버튼 → POST clone → 목록 새로고침 + toast.

### 2-D. 희소/빈 상태
- 0개: 가운데 일러스트(아이콘) + "첫 DM 만들기" CTA(빠른 시작으로 스크롤/포커스).
- 1~2개: 중앙 그리드 + 점선 "다음 추천 DM" ghost 카드(미사용 빠른 시작 시나리오 1개 제안 → 클릭 시 즉시 생성).

### 2-E. 빠른 시작 7종 갤러리
각 카드에 미니 폰 썸네일(시나리오별 대표 섹션 구성 도식) 추가 — DmCard 썸네일과 동일 컴포넌트 재사용.

### 2-F. 문구 자연 한국어
AI 진단 분기 문구 + Source 캡션에서 내부 개발 용어 제거, 마케팅 담당자 친화 표현으로 재작성.

## 컴포넌트 분리

- `DmThumbnail`(신규, frontend) — props: `{ types, headline, accent, pageCount, layoutMode }`. DmCard + 빠른 시작 갤러리 공용. 순수 표현 컴포넌트.
- `buildSectionSummary`(신규, backend 순수) — 목록 행 → 요약.
- `cloneDm`(신규, backend CT).

## 검증

- backend tsc 0 / frontend tsc 0.
- `scripts/verify-dm-list.ts` — buildSectionSummary 순수 검증(빈 sections, legacy pages, 6개 초과 캡, headline 추출, accent 폴백) ts-node GREEN.
- 자가 grep: 모델명 0 / native dialog 0 / 박-단어 0 / 내부 용어(영역/정합/매트릭스 등) 사용자 노출 0.
- DB 변경 없음 → 마이그레이션 무관. 발송·돈 경로 무관(목록/복제만, 발송 로직 미수정).

## 배포 (Harold 직접)

`tp-push` → backend `build:safe` + frontend `build:safe` + `pm2 restart all`. ALTER 없음.
