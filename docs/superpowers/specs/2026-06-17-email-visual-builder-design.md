# Email 비주얼 빌더 — DM 엔진 차용 + 이메일 렌더러 설계 (2026-06-17)

## 1. 배경

AI 오퍼레이터 Email 캠페인을 점검한 결과, 백엔드는 이미 성숙하고 크레딧도 완비돼 있다. 진짜 격차는 "비주얼 예쁨 + 편집"이다.

**이미 잘 된 것 (보존):**
- 회사 본인 SMTP·본인 도메인 발신 (`company-smtp-client.ts`)
- 자체 트래킹 — 오픈 픽셀·클릭 리다이렉트·수신거부 (`email-tracking.ts`, `routes/email.ts`의 `/t/o` `/t/c` `/u`)
- 고객DB 등급 타겟·발송 전 스팸 진단·성과 AI 진단·미오픈자 SMS 크로스채널 (`email-channel.ts`, `email-ai.ts`)
- 크레딧 완비 — 생성 3 / 다듬기 1 / 진단 1 / 성과 5 / 시간 5 / **AI 발송 확정 30** (멱등 + 실패 시 0)

**격차 (이번 작업):**
- AI가 "이미지 금지 + 단순 table HTML"만 생성 (`email-ai.ts` `EMAIL_HTML_RULES`) → 브레이즈식 비주얼과 거리.
- 편집기 = raw HTML textarea + iframe 미리보기 + AI 다듬기 (`EmailCampaignsPage.tsx` `CampaignFormModal`) → 마케터가 비주얼로 못 만짐.

**핵심 자산 발견:** DM 기능(`utils/dm/`, `components/dm/`)이 이미 브레이즈급 비주얼 빌더다 — 캔버스 에디터, 섹션 27종, 이미지 업로드/호스팅, 브랜드킷(로고·컬러), A/B, AI 생성(레이아웃+카피), 개인화 변수. 단 DM 렌더러(`dm-section-renderer.ts`)는 웹용(`var(--dm-*)` CSS 변수·flex·div)이라 이메일 클라이언트에서 그대로 못 쓴다.

## 2. 목표 · 범위 (Harold 확정 2026-06-17)

이메일을 "이미지·디자인 풍부한 비주얼형"으로, **회사가 실제 상품 이미지를 업로드**해 채우는 방식으로 만든다. AI 이미지 생성은 안 한다(가짜 상품 위험 + 한줄로 영구 룰 충돌).

**1단계 (이번):** DM 엔진을 이메일 렌더 타깃으로 붙여 비주얼 이메일을 완성한다.
- DM 섹션 모델·캔버스 에디터·이미지 업로드·브랜드킷·AI 생성 **재사용**
- **이메일 안전 렌더러 신규** (`Section[]` → 이메일 HTML)
- 이메일 호환 블록만 선별
- 렌더 결과 → 기존 SMTP 발송·트래킹·크레딧에 배선

**2단계+ (후속, 이번 범위 밖):** A/B(`dm-ab-test.ts` 차용), 재사용 템플릿, 자동화 여정.

**비범위:** AI 이미지 생성, 기존 manual-HTML 캠페인 흐름 폐기(보존), DM 기능 자체 변경.

## 3. 아키텍처

```
[마케터]
  └─ 이메일 비주얼 에디터(신규 페이지, DM 캔버스 컴포넌트 차용)
       ├─ 섹션 추가/편집/정렬  → Section[] (email_campaigns.sections JSONB)
       ├─ 이미지 업로드        → POST /api/dm/upload-image (재사용) → URL
       └─ AI 생성/다듬기       → 이메일 레이아웃 AI (dm-ai 패턴 차용) → Section[]
                                   (image_url = 빈 자리 = 회사가 채움)
  └─ 저장 시: renderEmailSections(Section[]) → 이메일 안전 HTML → email_campaigns.html_body
[발송]
  └─ 기존 sendEmailCampaign — html_body 그대로 사용
       └─ 트래킹 주입(링크→클릭 리다이렉트, 오픈 픽셀), (광고)+수신거부 자동 부착 — 기존 그대로
```

핵심: **Section[]가 진실원, html_body는 렌더 산출물.** 비주얼 캠페인 = sections 있음(편집 가능). manual 캠페인 = sections null(기존 raw HTML 흐름 보존).

## 4. 컴포넌트

### 4-1. 이메일 안전 렌더러 (신규 — 핵심 새 코드)
- `packages/backend/src/utils/email/email-section-renderer.ts`
- `renderEmailSections(sections: Section[], ctx): string` — DM과 같은 `Section` 타입을 입력받되 **이메일 안전 HTML** 출력.
- 이메일 규격:
  - 전체 `<table>` 레이아웃, 최대 폭 600px 중앙. flex/grid 금지.
  - 모든 스타일 인라인 `style=` (CSS 변수·`<style>`·외부 CSS·JS 금지). 브랜드킷 토큰은 **렌더 시점에 실제 값으로 치환**(예: `var(--dm-primary)` → `#7c3aed`).
  - 이미지 = 절대 URL(`publicImageUrl` 절대경로화) + `alt` 필수 + `width` 속성 + `display:block`. base64 인라인 금지(용량·스팸).
  - 다크모드 대비 배경/글자색 명시. 아웃룩 대비 `role="presentation"` 테이블.
- DM 렌더러(`dm-section-renderer.ts`)와 **별개 파일**로 나란히 둔다(웹 렌더러 무변경).

### 4-2. 이메일 블록 선별
| 이메일에서 쓰는 블록(정적 렌더) | 이메일에서 빼거나 정적 대체 |
|------|------|
| header(logo/banner), hero(이미지), text_card(이미지+글), cta(버튼), product_carousel→정적 그리드, gallery→이미지 행, coupon→정적 코드 카드, promo_code, store_info, sns(링크), reviews→정적, footer | countdown→정적 "D-3/마감 임박" 텍스트, video/youtube_embed→썸네일+링크, instagram_embed→링크, map_store_locator→정적 지도이미지+주소, poll·survey·email_capture·click_rewards·lucky_draw·roulette·instant_coupon·limited_quantity→이메일 블록 메뉴에서 제외 |
- 에디터의 블록 추가 메뉴는 이메일 모드에서 위 "쓰는 블록"만 노출.
- 저장된 캠페인에 비호환 블록이 있으면 렌더러가 정적 대체 또는 스킵(깨진 HTML 0).

### 4-3. 이메일 비주얼 에디터 (프론트 — DM 컴포넌트 차용)
- 신규 진입: `EmailCampaignsPage`에서 "비주얼로 만들기" → 이메일 컴포저(별도 흐름).
- DM 캔버스(`DmCanvas`)·섹션 렌더(`SectionRenderer`)·선별된 섹션 에디터·이미지 업로더 재사용.
- 미리보기 = 이메일 렌더러 산출 HTML을 iframe `srcDoc`(데스크탑/모바일 폭 토글).
- 기존 manual `CampaignFormModal`은 보존(raw HTML 캠페인용).

### 4-4. AI 이메일 생성 (dm-ai 패턴 차용)
- `email-ai.ts`에 비주얼 생성 함수 추가 — 입력(시나리오/자연어) → **이메일 블록 `Section[]`** 출력.
- 레이아웃 추천 + 카피 생성은 dm-ai 패턴 차용, **블록 후보 = 이메일 선별 집합 한정**.
- `image_url`은 빈 자리로 둔다(회사가 업로드해 채움) — placeholder 룰과 같은 원칙(혜택·이미지 임의 생성 0).
- 크레딧: 기존 `email-ai-generate`(3) 재사용. 다듬기 = 기존 `email-refine`(1) 재사용(블록 단위로 확장).

### 4-5. 저장·발송 배선 (기존 보존)
- `email_campaigns`에 `sections JSONB NULL` 컬럼 추가(ALTER). sections 있으면 html_body는 렌더 산출물.
- `POST/PATCH /api/email/campaigns`가 sections 받으면 렌더 후 html_body 동시 저장.
- 발송·트래킹·크레딧·placeholder 가드·Zero-Count — 전부 기존 그대로.

## 5. 데이터 흐름 (비주얼 캠페인 1건)

1. 마케터 "비주얼로 만들기" 또는 AI 빠른 시작 클릭.
2. (AI 경로) `/api/email/ai/generate` → 이메일 `Section[]` + 카피, image_url 빈 자리. 크레딧 3.
3. 에디터에서 블록 편집 + 회사 상품 이미지 업로드(`/api/dm/upload-image`).
4. 저장 → `renderEmailSections` → html_body. `email_campaigns`에 sections + html_body 저장.
5. 발송 → 기존 `sendEmailCampaign` → html_body에 트래킹 주입 + (광고)/수신거부 부착 → 회사 SMTP. AI 캠페인이면 발송 확정 30크레딧.

## 6. 도달률 (이미지 비주얼의 핵심 리스크)

- 이미지 절대 URL + `alt` 필수(이미지 차단 환경에서 의미 전달).
- text_body(순수 텍스트) 자동 동반 — 렌더 시 Section[]에서 텍스트 추출해 생성(기존 `runEmailCodeChecks`의 text_body 경고와 같은 맥락).
- 이미지/텍스트 비율 경고 — 이미지만 있고 텍스트 적으면 스팸 위험(발송 전 진단에 항목 추가).
- 외부 링크 = 전부 클릭 추적 래핑(기존). 이미지 호스팅은 회사 발신 도메인과 무관(한줄로 서버) — SPF/DKIM 영향 0.

## 7. 컨트롤타워 원칙

- 렌더러는 `utils/email/email-section-renderer.ts` 단일 — 라우트 인라인 렌더 금지.
- 블록 선별 집합은 단일 상수(`EMAIL_BLOCK_WHITELIST`) — 에디터·렌더러·AI 셋이 같은 상수 소비.
- 브랜드킷 토큰 치환은 단일 함수(`resolveBrandTokens`) — 인라인 색상 하드코딩 금지.

## 8. 에러 · 엣지

- 비호환 블록이 sections에 있음 → 렌더러가 정적 대체/스킵, 깨진 HTML 0.
- image_url 빈 자리로 발송 시도 → 발송 전 진단 경고("이미지 자리가 비었습니다"). placeholder 가드와 동일 철학.
- `sections` 컬럼 미마이그레이션 → 기존 `db_alter_safety_net` 503 분기 재사용(`handleDbMigrationError`).
- AI 생성이 비호환 블록 출력 → 화이트리스트로 필터(보이면 작동 불변식과 같은 fail-closed).

## 9. 테스트

- 렌더러 유닛(순수 — DB/AI 0): 블록별 `Section` → HTML 골든 테스트. `email-ai.ts`의 `runEmailCodeChecks` 패턴(이미 vitest 대상).
- 이메일 안전 린트: 렌더 출력에 `var(--`·`<style`·`flex`·`<script` 0건 정규식 검사.
- 텍스트 본문 자동 생성 검증(이미지 차단 환경 대비).
- 클라이언트별 실제 표시(Gmail/아웃룩/네이버/모바일) = 운영 실측(테스트 발송 활용).

## 10. 기존 자산 보존 확인

SMTP·트래킹·크레딧·발송·가드레일·manual-HTML 캠페인 — 변경 0(추가만). 기존 캠페인은 sections null로 그대로 동작.

## 11. 단계

- **1단계(이번):** 이메일 렌더러 + 블록 선별 + 비주얼 에디터 + AI 블록 생성 + 이미지 업로드 + 저장/발송 배선. = "예쁘게 만들어서 편집까지".
- **2단계+:** A/B(dm-ab-test 차용), 재사용 템플릿/브랜드킷 심화, 자동화 여정.

## 12. 비고
- DB ALTER(`email_campaigns.sections`) = information_schema 검증 후 Harold 실행(`db_column_verify_before_code`).
- DM 섹션 모델 변경 금지(읽기 차용만) — DM SSOT 양쪽 미러 영향 회피.
- git/배포 = Harold 직접.
