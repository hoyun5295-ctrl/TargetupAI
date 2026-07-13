# 이메일마케팅 디자인 3.0 + 제품 링크 자동 매핑 — 설계서 (2026-07-13)

> SoT. STATUS §2 ⓪-A 항목의 실행 설계. 기준 = 모바일 DM 디자인 3.0(project_2026_0713_dm_design_3) 동급.
> 구현 전 Harold 컨펌 필수. DDL 1건(§4) 서버 psql 직접 실행 필요.

---

## §0 목표·범위

1. **Part B — 제품 링크·이미지 자동 매핑**: 행사 원문으로 이메일 생성 시 상품 카드에 link_url·og:image 자동 매핑 (DM 0713(4)과 동일 결과). 착수 단서 = generate-sections가 link_url을 떨구는 지점.
2. **Part A — 이메일 디자인 3.0**: 편집기·발송 렌더러를 DM 3.0 동급으로 — 테마 프리셋 8종·서체 폴백 스택·구도(treatment)·골든 템플릿 12종·배경면 리듬·헤드라인 마커 + 이메일 고유(클라이언트 다크모드·프리헤더·불릿프루프 버튼·모바일 조판).
3. 제외(이메일 클라이언트 렌더 제약 — STATUS 명시): 모션 팩·스티키 CTA·글래스 배경면·필름 그레인.

---

## §1 현황 전수 파악 (실측 확정)

### 파일 지도
| 축 | 파일 | 현황 |
|---|---|---|
| 발송 렌더러 | `utils/email/email-section-renderer.ts` (423줄) | table 인라인, 12블록+정적대체 5종. 디자인 2.0(밴드·그라데이션 버튼·티켓 쿠폰). **문서 골격 없음(fragment)** |
| 토큰 | `utils/email/email-tokens.ts` | DM 토큰 리터럴 차용 + primary 파생 5종. **아트디렉션·다크·폰트 카탈로그 없음** |
| 블록 화이트리스트 | `utils/email/email-blocks.ts` | 12종 + static/skip 맵. AI 블록 정규화 |
| AI 생성 | `utils/email-ai.ts` `generateEmailSections` | 원샷 → 블록. **407행 map이 link_url 유실, image_url '' 강제** |
| 발송 엔진 | `utils/email-channel.ts` `sendEmailCampaign` | 즉시/예약(sweeper)/재발송 3경로 단일 길목. 수신자별 재렌더. adFooter 말미 append |
| 추적 | `utils/email-tracking.ts` | 픽셀은 `</body>` 인지(문서화 호환), 링크 래핑 href 정규식 |
| 라우트 | `routes/email.ts` | POST/PATCH 저장 시 html_body 렌더(505·552), render-preview(942), generate-sections(896) |
| 편집기 | `components/email/EmailVisualEditor.tsx` (694줄) | 3패널 모달. 정렬·강조색 컨트롤(0712)만. **테마·구도·배경·서체·프리헤더 없음** |
| 템플릿 | `utils/email-templates.ts` + 갤러리 모달 | 6종 — 문안 골격만, **스타일·테마 없음** (DM은 골든 12종) |
| 브랜드 원천 | `companies.brand_kit` (getCompanyBrandKit) | 회사 단위 색·폰트만. **캠페인 단위 디자인 저장소 없음** |

### 확정 사실 (착수 단서 검증)
- **link_url 유실 지점 = `email-ai.ts:407~414`**: `validateProductsAgainstEventText(...)` 반환값(공용 엔진 — link_url 검증·결정적 배정까지 완료된 상태)을 `.map()`으로 재조립하며 name/price/discount만 담고 `v.link_url`을 버림 + `image_url: ''` 강제라 og:image 채움 경로 자체가 없음.
- 공용 엔진 3종은 그대로 재사용 가능: `event-brief.ts` validateProductsAgainstEventText(내부에서 assignProductLinksFromText 호출) + `dm/dm-brand-extractor.ts` fetchProductOgImages(SSRF 리다이렉트 가드 내장).
- 이메일 렌더러 끝단은 이미 link_url 소비(`email-section-renderer.ts:197` 상품 카드 a href 래핑 + 클릭 추적은 email-tracking 링크 래핑이 자동 커버) — **생성부만 고치면 끝단 무수정**.
- EMAIL_BLOCKS_SYSTEM 프롬프트(343행) product 스키마에 link_url 없음 — AI가 URL을 안 뽑아도 assignProductLinksFromText가 결정적 배정하지만, DM처럼 스키마에 넣으면 회수율 상승.
- 동일 패턴 전수 grep: validateProductsAgainstEventText 소비처 = dm-ai(정상)·email-ai(결함) 2곳뿐. 인앱 ai-generate는 상품 구조 추출 미사용 — 범위 밖.
- 진입 경로 2곳: EventCampaignModal(행사 원클릭 → event_text) + EmailCampaignsPage/편집기(prompt). 행사 초안은 30분 TTL 드래프트로 편집기 자동 진입.
- 프리헤더: 렌더러가 본문 첫 텍스트 90자 자동 추출뿐. generateEmailSections가 반환하는 preheader는 프론트가 버림(0712 감사 "AI preheader 사장" 그대로).
- 발송 HTML은 nodemailer html 필드에 fragment 그대로 — doctype/head/meta 없음 → 다크모드 meta·모바일 media query·폰트 @import를 넣을 자리 자체가 없음.
- 버튼은 table 셀 + 그라데이션(솔리드 폴백) — 아웃룩 데스크탑 VML 없음.

---

## §2 Part B — 제품 링크·이미지 자동 매핑 (착수 지점부터)

1. **B-1 link_url 보존**: `email-ai.ts:407` map에 `...(v.link_url ? { link_url: v.link_url } : {})` 추가 (DM `dm-ai.ts:710` 미러).
2. **B-2 og:image 자동 채움**: eventText 경로에서 `fetchProductOgImages(extracted.map(p => p.link_url))` 호출 → `image_url: ogImages[i] || ''` (DM 702~705 미러. 실패/사설 호스트/og 부재 = 빈 값 유지, 생성 차단 X).
3. **B-3 프롬프트 스키마**: EMAIL_BLOCKS_SYSTEM product_carousel 스키마에 `"link_url": ""` 추가 + "원문에 상품 URL이 있으면 글자 그대로" 지시(검증기 3중 검증이 환각 차단 — DM PRODUCT_EXTRACT_SYSTEM과 동일 원칙). 혜택 임의 생성 규칙 무변.
4. **B-4 몰 자동 첨부와 순서**: route의 attachMallImagesToProductCarousels(빈 값만 채움)는 그 뒤 실행 유지 — 행사 원문 값 우선, 몰 매칭은 잔여 빈 값 보충. 충돌 없음(구현 시 "빈 값만" 로직 실코드 재확인).
5. 끝단(렌더러 197)·클릭 추적·발송 경로 무수정.

---

## §3 Part A — 이메일 디자인 3.0

### A-1 email-tokens 확장 (아트디렉션 → 리터럴 값)
- EmailBrand에 아트디렉션 파생값 추가: `typeScale`(editorial/bold/minimal → hero·h1·h2 px, DM TYPE_SCALE_VARS 미러) / `spacingDensity`(compact 0.8·standard 1·airy 1.4 — sp 리터럴 px 배율 계산) / `accentMotif`(rule·dot·bracket·index — 헤드라인 위 모티프 HTML 조각) / `sectionDivider`(hairline·gap·rule — 섹션 사이 행) / `displayFont`(헤드라인 서체).
- **다크 셸**: background_color 어두우면(DM getContrastRatio 원리 미러 — 결정적 판정) 중립 스케일 반전(text/textMuted/cardBg/border/shellBg). 자기 면 가진 요소(쿠폰 티켓·밴드)는 리터럴 유지(DM "다크 패널=리터럴" 원칙).
- **서체 카탈로그(이메일판)**: `EMAIL_FONT_CATALOG` — DM 6종 동일 큐레이션 + 이메일 전용 폴백 스택 보강(예: 세리프 = `"Noto Serif KR","Nanum Myeongjo","AppleMyungjo",serif`). head에 Google Fonts @import 1줄(지원 클라이언트 — Apple Mail 등 — 만 로드, 미지원은 폴백 스택). inlineFont(작은따옴표 치환) 전 스택 적용 유지.
- 배경면 리듬: `section.background`(soft/tint/dark/gradient) → 섹션 td 배경 리터럴 재정의(DM dm-bgx-* 의 bgcolor 치환판). glass 제외.

### A-2 email-section-renderer 확장
- **문서 골격**: renderEmailSections가 완전한 HTML 문서 출력 — `<!DOCTYPE>` + head(`meta charset/viewport` + `meta name=color-scheme content="light dark"` + `supported-color-schemes`) + `<style>` 블록(아래 2종) + body. applyTracking 픽셀은 `</body>` 인지라 호환.
  - `@media (max-width:600px)`: 셸 100%·히어로 높이 축소·text_card 좌우 이미지 스택·폰트 1단 축소 (class 훅 `em-*` 부여. style 스트립 클라이언트는 현행 fluid 폴백 = 회귀 0).
  - `@media (prefers-color-scheme: dark)` + `[data-ogsc]`(아웃룩 앱): 셸/카드/텍스트 보정 — Gmail 강제 반전에서 브랜드색 가독 유지.
- **adFooter 삽입 정합**: email-channel의 `+= adFooter` 2곳(307·329)은 문서화 후 `</html>` 밖에 붙음 → 렌더러가 `<!--EMAIL_FOOTER_SLOT-->` 마커(footer 블록 뒤·`</body>` 앞)를 제공하고 channel은 마커 치환(마커 부재 = 기존 append 폴백 — 수동 HTML 경로 무회귀).
- **불릿프루프 버튼**: renderButton에 MSO 조건부 VML(roundrect) + 기존 table 버튼 병행 — 아웃룩 데스크탑에서도 라운드·배경 유지.
- **구도(treatment) 5타입**: `EMAIL_TREATMENTS` 상수(email-blocks에 단일 진실, DM TREATMENTS의 이메일 안전 부분집합):
  - hero: classic / split(2열 테이블 이미지+텍스트) / typographic(대형 타이포 — 이미지 미사용)
  - text_card: classic / lead / framed / quote
  - cta: classic / bar(전폭 밴드) / ghost
  - coupon: classic(티켓) / spotlight
  - product_carousel: classic(2열) / focus(대표 1 크게+나머지 2열) / list(1열 행)
  - **DM 교훈 반영**: 이미지 미사용 구도(hero typographic)는 이미지 주입 시 기본 구도 자동 전환(편집기 updateSelected 단일 길목) + 픽커 라벨 "(이미지 미사용)".
- **헤드라인 마커**: hero/text_card 헤드라인 강조(마커펜/밑줄 — 인라인 그라데이션 배경). prop 스키마는 DM 3.0 W3 실스키마 확인 후 동일 키 재사용.
- **프리헤더**: design.preheader 있으면 우선, 없으면 기존 자동 추출(무회귀).

### A-3 테마 프리셋 8종 + 편집기
- `frontend/utils/email-themes.ts`: DM 8종 동일 id·큐레이션의 이메일판(kit = primary/accent/background/font_display + art_direction{typeScale,spacingDensity,accentMotif,sectionDivider}). grain 제외. 톤 결정적 추천(recommendThemeIds 미러).
- `EmailDesignThemeModal`(다크 앱 모달, 스와치+서체 미리보기 — DM DesignThemeModal 미러) + 편집기 헤더 "테마" 버튼. 적용 = 편집기 design state 1클릭 갱신 — **companies.brand_kit 무변경(캠페인 단위)** → DM·인앱·타 캠페인 영향 0.
- 편집기 추가 UI: 프리헤더 입력칸(제목 옆) / 블록 스타일 패널에 구도 픽커(EMAIL_TREATMENTS 있는 타입만 — 죽은 컨트롤 금지) + 배경면 픽커 / 서체 페어링 셀렉터(테마 모달 안).
- 미리보기: render-preview body에 design 동승 → 편집 화면 = 발송물(3면 대조 원칙).

### A-4 골든 템플릿 12종
- email-templates.ts 6종 → 12종 격상(기존 6 key 유지 + 6 신규). 각 템플릿에 구도/배경 패치 + 추천 design kit 동승(DM buildStyledSections 미러). 혜택 수치 0(placeholder 규칙 유지). 갤러리 카드에 테마 스와치·서체 표시.

### A-5 AI 디자인 추천 (추가 AI 호출 0)
- generateEmailSections 반환에 design 동승 — 시나리오·톤 → 테마 결정적 매핑(임의 상수 아님, 큐레이션 매핑). 행사 원클릭·편집기 AI 생성 모두 즉시 완성 룩(1클릭 UX 유지).

---

## §4 영속화 + DDL (1건)

- 캠페인 단위 design(테마·아트디렉션·서체·프리헤더) 저장소 필요. sections 배열 동승(가짜 섹션)은 소비처 전체가 `Array.isArray(sections)` + 타입 순회 전제라 오염 — 배제. companies.brand_kit 동승은 회사 단위라 캠페인별 룩 불가 + DM·인앱 연쇄 — 배제.
- **정답: `email_campaigns.design jsonb` 1컬럼.** 실행 전 검증(§4-1) → ALTER(§4-2) → 코드.

§4-1 검증 SQL (Harold 서버 실행 — 접속: `docker exec -it targetup-postgres psql -U targetup targetup`):
```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'email_campaigns' AND column_name = 'design';
```
0 rows 확인 후:

§4-2 DDL:
```sql
ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS design jsonb;
```
- db_alter_safety_net: design을 명시 참조하는 endpoint(POST/PATCH/GET 캠페인) catch에 `column does not exist` → 503 DB_MIGRATION_PENDING 분기 의무. SCHEMA.md 해당 절 갱신 동반.
- design 스키마: `{ theme, art_direction: {typeScale, spacingDensity, accentMotif, sectionDivider}, font_display, font_family, palette: {primary, accent, background}, preheader }` — 전 키 옵셔널, 미설정 = 현행 렌더(회귀 0).

---

## §5 영향표 (수정 대상 → 전 소비처)

| 수정 대상 | 소비처 전수 | 영향·조치 |
|---|---|---|
| email-ai.ts 407 map | generate-sections route 1곳 → 편집기/행사모달 | link_url 추가 필드 — 렌더러 기소비, 하위호환 |
| renderEmailSections 시그니처(ctx.design 추가) | email.ts 505·552·942 / email-channel 328 / 테스트 | 옵셔널 인자 — 4곳 design 전달 추가. sweeper·재발송은 sendEmailCampaign 경유라 328 1곳으로 커버 |
| 문서 골격 출력 | applyTracking(픽셀 `</body>` 인지 — 호환) / adFooter append 2곳(마커 치환으로 정합) / hasUneditedPlaceholder(문자열 검사 — 무관) / html_body 저장값(목록 미리보기 iframe — srcDoc이라 문서형 호환) | 테스트로 고정 |
| email_campaigns.design 쓰기 | createEmailCampaign / updateEmailCampaign(PATCH) / **재발송 자식 INSERT(email-channel 901~921 — sections처럼 design 복사 동반)** | 3곳 전수 |
| email_campaigns.design 읽기 | sendEmailCampaign(SELECT * — 컬럼 추가 자동) / mapRow / GET 목록·상세 | mapRow에 design 매핑 추가 |
| EMAIL_TREATMENTS 신설 | 렌더러 + 편집기 픽커 + (템플릿 12종) | 3면 단일 진실(email-blocks 소유) |
| resolveEmailBrand 확장 | 렌더러 2곳(395·348 accent override) + 테스트 | 시그니처 하위호환(brandKit에 design merge 후 전달) |
| 편집기 sections 밖 design state | persistCampaign body / render-preview body / AI 생성 수용 / 템플릿 pick / 행사 드래프트 수용(EmailCampaignsPage 484~) | 5곳 전수 |

발송 파이프라인 절대 보호 영역(campaigns.ts/results.ts 등)·크레딧 흐름·법 준수 흐름(광고 표기·수신거부·List-Unsubscribe)은 무접촉. adFooter는 삽입 위치만 이동(내용·판정 로직 무변).

---

## §6 검증 계획

- BE/FE tsc 0 + vitest: 신규 테스트(link_url 보존·og 채움 스킵 폴백 / 문서 골격·다크 meta·VML·프리헤더 우선순위 / 구도별 렌더 / 다크 셸 반전 / adFooter 마커 치환 / design 미설정 = 현행 산출 동일(회귀 0 스냅샷)).
- 금지 패턴 grep 0건: 모델명(frontend)·native dialog·박-단어·로드맵 노출.
- Codex `/codex:review` (규모상 필요 시 adversarial) — 종결 전 의무.
- 실측(직원, 배포 후): Gmail 라이트/다크 + 모바일 Gmail 앱 + 네이버 메일 수신함 / 행사 원문(상품+URL) → 링크·이미지 자동 매핑 1건 / 테마 8종 전환·완성 저장→발송 왕복 1건.

## §7 구현 순서

1. **W0 = Part B** (독립·저위험): email-ai map 보존 + og 채움 + 프롬프트 스키마 + 테스트.
2. **W1 = 렌더러·토큰**: 문서 골격/다크/모바일/VML/폰트/아트디렉션/배경면/구도/마커/프리헤더 + adFooter 마커 + 테스트 (design 미설정 = 현행 동일이라 DDL 전에도 배포 안전).
3. **W2 = 영속·편집기**: DDL(Harold) → design API 5지점 + 편집기(테마 모달·프리헤더·픽커) + 템플릿 12종 + AI design 추천.
