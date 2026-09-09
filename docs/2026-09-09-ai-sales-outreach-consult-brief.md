# AI 영업(아웃리치) 자문 브리프 — 구현 현황 · 실측 · 문제 · 해결 · 미결 (2026-09-09)

> 목적: 외부 모델(코덱스)이 이 문서 하나로 현황을 이해하고 처방을 내릴 수 있게 쓴다. 소스는 `packages/backend/src/utils/sales-outreach-*.ts` · `campaign-engine.ts` · `dm/` · `email/` 이고, 이 문서가 가리키는 함수는 전부 실재한다(2026-09-09 기준 · tsc 0 · vitest 260파일 4,007건).
> 독자에게 부탁: 파일을 수정하지 말고, 명령을 실행하지 말고, 처방을 md 로 답하라. 답은 사실 근거(파일:함수)와 함께.

## 0. 한 줄 정의와 대표의 요구

- 한줄로(hanjul.ai)는 SMS·카카오·모바일 DM·이메일·인앱 마케팅 자동화 SaaS 다. **AI 영업** = 영업 대상 브랜드(화장품·패션 자사몰)의 홈페이지 주소 하나만 넣으면, 그 브랜드가 자기 고객에게 보낼 법한 **모바일 DM + 이메일 시안**을 자동으로 만들고, 그 시안을 담은 **제안 메일**을 브랜드 담당자에게 보내 "한줄로를 쓰면 이게 자동으로 나온다"를 증명하는 기능이다.
- 대표(Harold)의 판정 기준 = 담당자가 시안을 보고 "이걸로 우리 고객에게 보내고 싶다"고 느끼는가. 오늘까지의 판정: **아이소이(기획전 페이지가 있는 몰)는 좋았고, 톤28(SPA 몰 · 기획전 없음)은 세 번 만들어 세 번 다 실패**.
- 대표가 원하는 산출물 구조(오늘 확정): **이미지 스튜디오로 "그 브랜드 행사 내용"을 얹어 생성한 히어로 1장 → 상품 큐레이션 → 행사 나열 → 버튼**. "이미지만 덩그러니 세우면 안 된다". "직원들이 손으로 만들던 DM 을 학습해서 그 수준으로".

## 1. 파이프라인 구조(현재 코드)

잡 상태머신 = `sales_outreach_jobs.stage`: `queued → crawling → analyzing → awaiting_confirm(사람 확인) → producing_copy → producing_image → producing_dm → producing_email → ready → sent`. 실패 = `failed`. 소유 = `utils/sales-outreach-jobs.ts`(`runOutreachJob`, `runProduction`). 산출물은 `sales_outreach_assets(kind: copy | studio_image | dm | email_html)` payload jsonb.

| 단계 | 하는 일 | 핵심 함수 |
|---|---|---|
| crawling | 홈 정적 fetch(가드) + **렌더 워커(헤드리스 크롬 · 별도 PM2 프로세스 · 로컬 프록시 뒤)로 항상 1회 렌더** → 두 소스 합집합 | `fetchHtmlGuarded` · `renderPageGuarded` · `unionProducts/unionImageDetails` |
| crawling | 이벤트 목록 페이지 후보(관례 주소 3개) → 카드(제목·기간·배너·링크) · 면허 카드 1번 상세 렌더 → **슬라이스 판정** · 없으면 홈에 걸린 **프로모션 페이지** 후보 ≤3 렌더 → 슬라이스 · 홈 상단 배너(렌더 기하) · 렌더 DOM 상품 카드 | `findEventListLinks` · `extractEventListCards` · `detectEventSlices` · `findPromoPageLinks` · `heroBannersOf` · `extractRenderedProductCards` |
| analyzing | 행사 후보 = 카드(AI 0) + AI 인용(원문 재대조 통과분만) · 재료 게이트(상품 4 · 배너 2 · 행사 1 중 둘 미달 = thin → 발송 잠금) | `eventCandidatesFromCards` · `filterQuoteCandidates` · `assessMaterialSufficiency` |
| awaiting_confirm | 사람이 행사 카드 ≤3 선택(순서 = DM 등장 순서) · 재료 카드 확인 | 화면 `SalesOutreachModal.tsx` |
| producing_copy | 문자 문안(AI · 면허 밖 혜택 자리 제거) | `buildCopyPrompt` |
| producing_image | 재료 사본 저장(갤러리 ≤8 · 카드 배너 · **슬라이스 ≤20** · 상품 이미지 ≤6 · 로고) · **이미지 종류 판정(vision 1회)** · 가격 없는 상품 상세 렌더 가격 채우기 · **스튜디오 포스터 생성** | `collectOutreachMedia` · `classifyOutreachImages` · `produceOutreachImage` |
| producing_dm | **조립**(아래 §3) → 발행(createDm/publishDm) → 375폭 캡처·채점(경고만) | `assembleOutreachDm` · `publishOutreachDm` · `captureAndScoreDm` |
| producing_email | 브랜드 이메일 시안(같은 조립) + 제안 메일(제목·서두 AI + 순수 조립) | `produceOutreachBrandEmail` · `assembleProposalEmail` |
| 발송 | 사람 클릭 1회 · 잠금 6종(발신 계정 · 수신거부 문구 · 조립본 · placeholder · 문구 · 재료 부족) | `computeSendLock` · `sendOutreachMailForJob` |

## 2. 재료 층 상세(오늘 v4 로 넓힌 것)

### 2-1. 렌더 워커
- `workers/outreach-render-worker.ts`: 크롬 1개 재사용 · 잡마다 BrowserContext · 로컬 CONNECT 프록시가 목적지(공인 IP · 같은 사이트만)를 판정 · 스크롤 끝까지 훑어 지연 로딩 확보 · 반환 = `{ html, text, palette(계산된 스타일 색), screenshotViewportBase64, images[{src, w, h, rw, rh, top, href, alt}] }`. `images` = 원본 폭 ≥600 인 `<img>` 80장의 기하(문서 위 세로 위치 · 렌더 폭·높이 · 감싸는 앵커 · alt).
- 정책: 워커 부재·차단·시간 초과 = 즉시 정적으로 전진(3값 `rendering`). 잡당 렌더 = 홈 1 + 팔레트 1 + 이벤트 목록 ≤3 + 카드 상세 1 + 프로모션 ≤3 + 상품 상세 ≤3 → 최악 2~3분.

### 2-2. 슬라이스(브랜드가 만든 디자인을 그대로 쓰는 재료)
- `detectEventSlices(images)` (`sales-outreach-slices.ts`): 원본 폭 ≥600 · 렌더 폭 ≥480 · 가로세로비 ≤3.2 · 문서 순서 · 세로 간격 ≤600px · 렌더 폭 ±15% 인 **가장 긴 세로 묶음**(3~20장). 실측: 아이소이 추석 기획전 = 960px 슬라이스 15장(히어로 1 · 혜택 6 · 상품 안내 1 · 상품 카드 7) · 톤28 펩타시카 페이지 = 1920×734 사진 6장(사이에 글 블록 220~475px).
- 입구 1 = 이벤트 목록 카드 중 면허(미래 종료일) 있는 1번 카드의 상세. 입구 2 = 홈에 걸린 프로모션·기획 페이지(`findPromoPageLinks`: 경로 조각 event/promotion/plan/special/campaign/collection/lookbook/benefit/hotdeal/sale 또는 앵커 문구 기획전/이벤트/프로모션… · 상품 상세·회원·목록 제외 · 최대 3). 통과하면 **코드가 행사 카드를 세운다**(`source: 'promo_page'` · `homeLinked: true` · 제목 = 슬라이스 alt → 경로 조각 → 페이지 title · `promoCardTitleOf`).
- 사본: `pickStoredImagesDetail(sliceUrls, 20, 600)` → `media.slices`(갤러리와 분리 · `srcUrl` 로 되찾는다).

### 2-3. 홈 상단 배너 · 상품 카드
- `heroBannersOf(images)`: 문서 위 300px 안 · 원본 ≥900 · 가로형 ≥1.2 · 같은 주소 1번 · ≤8 → 갤러리 후보 **맨 앞**(히어로 = 홈 첫 배너 규칙). `brand_profile.heroBanners`.
- `extractRenderedProductCards(html)`: 상품 링크(`/product/1367` · `goods_no=` 등 id 동반) + `<img>` 가 있는 앵커 = 카드. 이름 = alt(일반 alt "베스트 셀러 이미지"는 앵커 문구 폴백) · 가격 = 카드 안 "N원" · 없으면 카드 문구 **끝**의 천 단위 숫자 1~2개(리뷰·평점 뒤 숫자 제외 · 톤28 "새벽크림 2.0 50g 34,200") · 이름에서 뗀다. 프로모션 페이지의 상품 카드가 홈 카드보다 앞.
- 상세 페이지 파서 `parseProductPage`(**증거 허용 목록** · B-0909-1): 상품 페이지 증거 = og:type product · ld+json Product · 0 보다 큰 구조화 가격 · 라벨 붙은 본문 가격(판매가·정가…) 중 하나. 이름이 og:site_name 과 같으면 null. 이름·이미지 같은 결과 2개 이상은 껍데기라 묶음째 거부. 경위 = 톤28 상세 정적 HTML 이 껍데기(og:title "톤28" · 가격 메타 0 · "15,000원 담으면 무료배송")라 "톤28 · 15,000원/40,000원" 카드 6장이 나갔다.

### 2-4. 이미지 종류 판정(v4-3)
- `classifyOutreachImages(items)`: 슬라이스 전부 + 홈 갤러리 앞 8장의 사본 버퍼를 **vision 모델 1회**에 보내 `{ kind: banner | product | document | photo | other, text: bool }` 를 받는다(상한 14장 · 장당 1.2MB · 실패 = 판정 없음). `media.imageKinds`(사본 URL 키). 프롬프트 = 분류만(문안 0).
- 선별은 코드: `selectEventSlices`(행사 블록 안 · 문서 제외 · 배너·상품 → 분위기 사진 ≤2 · 문서만이면 0장) · `selectSliceImages`(옛 슬라이스 전용 모드 · 프로모션 = 글자 있는 홈 배너 앞자리).

### 2-5. 면허(혜택 수치 허용) 규칙
- 불변 5: 혜택 수치는 홈페이지 원문에 문자열로 실재하고 종료일이 **미래**일 때만(`isFutureDate(parseLicensedEndDate(...))`). 그 밖은 `[직접 작성해주세요]` 자리가 되고 남아 있으면 발송 잠금.
- 오늘 추가한 예외(불변 42): 종료일이 없는 카드라도 **오늘 홈에 링크돼 있었으면(homeLinked · 프로모션 페이지)** 진행 중으로 본다. 슬라이스 안 글자는 이미지라 차단기가 못 본다.

## 3. 조립 층 상세

### 3-1. v3 AI 골격(2026-09-06 · 재료가 없을 때의 폴백으로 남음)
- 모델이 섹션 조각(hero 문구 · text_card 0~2 · cta 라벨 · coupon · countdown)을 few-shot 예시(직원 실물 DM 10건 + 이메일 9건 마스킹본 · `sales-outreach-exemplar-seed.ts` · DB `best_copy_assets kind=outreach_example`)와 함께 생성 → 코드가 13행 표준(header · hero(카드1 배너) · cta · 스포트라이트 · 상품 2+4 · 증거 카드 · 카드2 · countdown · cta · footer)으로 채운다(`fillOutreachDmMediaV3`) → 혜택 차단기(`sanitizeDmCopyBenefits`) → 빈 섹션 정리 → 룩(구도·배경면) → 숨김 override → 증거 카드 → 페이지. 결정 구간은 `campaign-engine.ts assembleDmCampaign` 하나(아웃리치·고객 입구 공용).
- 채점: 발행 DM 375폭 캡처를 vision 이 12항목으로 채점(경고만 · 잠금 아님) · 트리거면 1회 자동 재조립.

### 3-2. v5 표준 조립(오늘 · 대표 지시 · AI 0)
- 아웃리치 입구에서 상품 또는 행사 카드가 하나라도 있으면 AI 골격 대신 `composeOutreachStandard`(`sales-outreach-slices.ts`)가 짠다:
  `header` → `hero`(gallery 1장 풀폭 · 원본 비율 · **스튜디오 포스터** → 없으면 홈 캠페인 배너 사본(판정 배너·글자 우선) → 카드1 배너) → `product_carousel`(≤6 · 이름·이미지·링크 · 가격은 있을 때만 · 없으면 가격 줄 0) → 행사 N(≤3): `text_card`(태그 "이벤트" · 제목 · 기간 줄 · 배너) + `gallery`(그 행사의 슬라이스 선별 ≤3) + `cta`(제목형 라벨 · 사이트명이면 "상품 자세히 보기") → 대표 `cta`(마지막 행사와 같으면 생략) → `footer`.
- 엔진에는 `presetSections` 로 넘긴다 = 채우기·차단기·룩을 건너뛰고 숨김 override·재구성·페이지만 탄다. 자동 재조립 0. DM·이메일이 같은 재료(`standardMaterialsOf`)·같은 함수.
- 근거: dm payload `sliceMode(=코드 조립)` · `stdHero('poster'|'banner'|'card')` · `stdProducts` · `stdEvents` · `sliceCount` · 레시피 `bindings[{sectionId, src: poster|card|product|slice|code}]`.

### 3-3. 이미지 스튜디오 포스터(히어로 후보 1순위)
- `produceOutreachImage`: 사람이 고른(또는 첫) 상품 이미지 누끼(알파 PNG 는 rembg 우회) + 업종별 템플릿 풀(`TEMPLATE_POOLS` · 15업종 · 잡·순번 seed) + **3칸 문구를 서버가 찍는다**(`buildOutreachPosterTexts` → `buildPosterTypography` → `composeImage`). 3칸 = label(행사 성격/업종) · title(면허 인용 첫 구간의 부분 문자열) · subtitle(상품명/사이트 제목). **모든 칸에서 숫자·%·원·혜택어를 거부**(발송 잠금이 이미지 글자를 못 보므로). 생성 뒤 vision 이 숫자 유출·헤드라인 가시성을 채점 → 유출이면 배경 1회 재생성(그래도 유출이면 첫 이미지 저장 = 코덱스 지적).
- 오늘 바꾼 것: v3 의 "실측 배너 ≥3 · 카드 ≥1 이면 포스터 생략" 규칙 폐지 → 항상 생성. 실패 = asset url null → 히어로는 홈 배너.
- **문제**: 3칸이 숫자·혜택어를 거부하니 "추석 기획전 최대 50%"가 "추석 기획전"으로만 얹힌다. 대표가 원하는 "행사 내용을 얹은 히어로"에 못 미친다. 면허 인용(원문 실재 + 미래 종료일)이 있으면 그 문구를 그대로 얹어도 될 텐데, 지금 계약이 면허 정보를 입력받지 않는다.

## 4. 학습 층(현재)
- 직원 실물 DM 19건(마스킹 · 별칭·상품명·수치·링크 치환)을 채널·업종군별로 골라 **AI 골격의 few-shot** 으로만 쓴다(`pickOutreachExemplars`). v5 표준 조립은 AI 를 안 거치므로 학습이 0.
- 원장: `stage_results.edits[]`(숨김·재선택·문안·제목·회신 · 사유 5값) · dm payload `recipe`(재료 수 · 섹션 순서 · bindings) · `stage_results.views_preview`(공개 페이지 열람 · UA 3분류) · `dm_views`. 발송 결과(클릭·전환)는 학습에 안 쓴다. 승격 = 사람 버튼(`promoteOutreachRecipe` → `best_copy_assets kind=recipe`).

## 5. 실측 기록(왜 세 번 실패했나)

| 회차 | 브랜드 | 결과 | 원인 | 조치 |
|---|---|---|---|---|
| 0908 | 아이소이 | 관리자 미리보기 이미지 9장 전부 깨짐 | helmet 기본 CSP `img-src 'self'`(페이지 호스트 sys ≠ 이미지 호스트 hanjul.ai) | 라우터 범위 CSP · template-sample CORP |
| 0908 | 아이소이 | 골격 DM 이 "AI 티"(우리 슬롯에 재료를 다시 그림) | 골격이 상한 | 프로토타입: 기획전 슬라이스 7장 + 로고 + 버튼 → 대표 "압도적으로 좋다" → **슬라이스 모드** 구현 |
| 0909(1) | 톤28 | 상품 카드 6장 전부 "톤28 · 15,000원/40,000원" · 링크는 제각각 | 상세 정적 HTML 껍데기 · 파서가 og:title(브랜드명)·무료배송 문구를 상품·가격으로 | 파서 증거 허용 목록 |
| 0909(2) | 톤28 | 상품 0 · 히어로 1 · 글 카드 3 | 이벤트 목록 없음 · SPA 라 정적 상품 0 | **재료 축 v4**(렌더 상시 · 홈 배너 · 프로모션 페이지 입구 · 렌더 DOM 상품) |
| 0909(3) | 톤28 | 농장·인증서·연구실 사진 6장 + "톤28 공식몰 보기" 버튼 | 프로모션 페이지가 브랜드 스토리였고 슬라이스 모드가 사진만 이어 붙임 · 제목 = 페이지 title | 상품 카드 합류 · 프로모션 4장 · 제목 규칙 · 이미지 종류 판정 · **v5 표준 조립** |

- 로컬 실물 렌더 도구(`scratch/proto/slice-preview.ts` · 재료 JSON → DM HTML · `shot.js` 캡처)를 만들어 지금은 캡처를 보고 넘긴다. 톤28 최신 캡처 = 헤더 → 9월 캠페인 배너(스튜디오 없어서) → 펩타시카 상품 4(가격 있음) → 행사 카드(Farm to Product · 사진) → 사진 1 → 버튼.
- 닫힌 길: 네이버 쇼핑 검색 API 2026-07-31 서비스 종료(대체 없음) · brand.naver.com/smartstore robots `Disallow: /` + 정적 429(사무실 IP 실제 크롬은 렌더됨 = 53상품·8배너 · 정책상 미사용).

## 6. 문제점 · 미결(처방이 필요한 것)

1. **포스터 3칸이 행사 내용을 못 얹는다.** 숫자·혜택어 전면 거부. 면허 인용을 그대로 얹는 계약이 없다. 유출 검사는 숫자 검출뿐.
2. **재료 품질 편차.** 기획전 페이지가 있는 몰(아이소이)과 없는 몰(톤28)의 격차가 크다. 스토리 페이지·인증서·분위기 사진을 판정으로 거르지만, "이 이미지가 DM 에 어울리는가"는 판정하지 않는다.
3. **preset 경로는 차단기를 안 탄다.** 표준 조립 텍스트 = 카드 제목(정제본) · 기간 · 상품명 · 버튼. 오늘 정제 탈락 제목의 원문 복원을 막았지만, 상품명 안의 "1+1"·"기획팩" 같은 혜택성 문구는 통과한다.
4. **homeLinked 면허 예외.** 종료일 없는 프로모션 페이지를 "진행 중"으로 보는 근거가 "오늘 홈에 걸려 있음"뿐이다. 슬라이스 안 글자(혜택)는 검사 밖.
5. **학습 미연결.** 직원 DM 은 AI 골격 예시로만. 표준 조립의 상품 수·순서·히어로 선택·문구 길이에 직원 판단이 안 들어간다. 발송 결과는 미사용.
6. **품질 판정 부재.** 지금 합격 기준은 사람이 캡처를 보는 것. 자동 채점(12항목)은 골격 기준이라 표준 조립에 안 맞는다.
7. **가격 없는 몰.** 톤28은 상세를 렌더해도 "원" 표기가 없다(카드 문구 끝 숫자만). 가격 없는 상품 카드는 가격 줄을 비운다.
8. **제안 메일 자체.** 3막(자동으로 만든 것 · 자사몰 연동 시 · 5분이면) + 시안 + 기능 소개 = 8,000px. 담당자가 볼 한 장면이 늦게 나온다.
9. **렌더 비용.** 잡당 렌더 최대 10회 · 2~3분. 워커 동시 1.
10. **담당자 반응 데이터 0.** 열람(공개 페이지 · DM 뷰)만 있고 회신·전환은 없다.

## 7. 제약(바꿀 수 없는 것)
- 발송은 사람 클릭 1회 · 자동 재시도 0(예외 = producing_dm 안 1회 재조립) · 잠금 6종 · 지어낸 혜택 0 · 모델명·로드맵 고객 노출 0 · 타사 이미지는 사본·고지·30일 파기 · 새 테이블 회피(jsonb 우선) · 네이버 스토어 접근 0.

## 8. 질문(처방을 원하는 것 · 우선순위 순)
- Q1. §6-1 포스터 3칸: 면허 인용·카드 제목·기간·상품명을 어떤 규칙으로 3칸에 배치하고, 지어낸 혜택을 막는 검사(문구 대조 · 이미지 OCR)를 어떻게 두는가. 현재 계약을 어떻게 바꾸는가(입력 객체 · 실패 폴백).
- Q2. §6-2·§6-6 "DM 에 어울리는 이미지" 판정과 채널별 품질 판정을 어떻게 자동화하는가(vision 채점 항목 · 임계 · 폴백). 사람 캡처 검수를 어디까지 줄일 수 있는가.
- Q3. §6-5 학습: 직원 DM 19건과 발송 결과를 표준 조립의 파라미터(상품 수 · 순서 · 히어로 구도 · 슬라이스 수 · 문구 길이)로 옮기는 현실적 절차. jsonb 로 시작하는 데이터 모양. 표본 부족 시 기본값.
- Q4. §6-3·§6-4 preset 경로와 homeLinked 예외의 위험을 어디서 어떻게 막는가(최소 변경).
- Q5. §6-8 제안 메일을 "한 장면"으로 다시 짜는 안(담당자가 5초 안에 이해하는 구조).
- Q6. 우리 설계 전체에서 틀렸거나 과한 것.

## 9. 참고 파일
- `packages/backend/src/utils/sales-outreach-jobs.ts`(상태머신·크롤·제작 루프) · `sales-outreach-produce.ts`(재료 사본·포스터·조립·이메일) · `sales-outreach-slices.ts`(슬라이스·배너·판정 선별·표준 조립) · `sales-outreach-media.ts`(파서) · `sales-outreach-render.ts`(워커 클라이언트·합집합) · `workers/outreach-render-worker.ts` · `campaign-engine.ts` · `sales-outreach-exemplars.ts`(few-shot) · `dm/dm-section-renderer.ts` · `email/email-section-renderer.ts`.
- 문서: `docs/FEATURE-SALES-OUTREACH.md`(불변 1~42) · `docs/2026-09-06-outreach-v3-brand-page-recomposition-design.md` §17~§19 · `status/BUGS.md` B-0909-1 · B-0826-2.
