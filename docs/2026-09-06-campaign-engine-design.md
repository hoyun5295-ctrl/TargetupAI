# 캠페인 엔진 설계서 — AI 영업 완성 → 오퍼레이터 DM·이메일 생성 코어 (2026-09-06)

> **상설 기능 문서 = [FEATURE-SALES-OUTREACH.md](FEATURE-SALES-OUTREACH.md)**(구조·불변·파일 소유). 이 문서는 2026-09-06 회의(5역할 · 1차 → 교차 토론 → 정정 반영 3라운드 → 회의론자 최종 검증)의 **수렴안과 세션별 구현 원장**을 소유한다.
> Harold 지시(2026-09-06): "설계문서 검토 맡을 필요 없으니 그냥 쭉 끝까지 구현 끝내고 보고" → 검토 게이트 없이 구현하며 이 문서에 실제 구현을 기록한다.
> 순서(Harold 확정): **AI 영업이 "그대로 보내도 되는 수준"을 먼저 내고, 그 엔진을 오퍼레이터 DM·이메일 생성에 심는다.**

## 0. 출발점(실측 · 2026-09-06)

| 항목 | 정적 fetch(우리 크롤러) | 헤드리스 렌더(사람이 보는 화면) |
|---|---|---|
| isoi.co.kr 본문 | 7,600B · 메뉴 7 + "사이트 연결이 잠시 지연되고 있습니다" + 푸터 | 6,979자 |
| 상품 카드 | 0 | 세일 카드 4 + 추석 기획전 세트 12 |
| 가격 / 할인율 | 0 / 0 | 23건 / 13건 |
| 메인 배너(1920x600) | 0 | 9장 |
| 진행 행사 | 0 | 9개 · 추석 기획전 "기간 : 2026.08.31 ~ 2026-09-18 08:59:59" |
| 리뷰·평점·랭킹 | 0 | 리뷰 455,083 · 평점 4.9 · 랭킹 5 |

산출 메일·DM의 모든 문장 = title · meta description · og:description · og 이미지 1장 · 법인명의 조합. 프로토 검증 3업체(이니스프리 398KB · 29CM 842KB · 커버낫 1.1MB)는 전부 서버 렌더라 이 결함이 표본에 없었다.

코드로 확인된 뿌리 5개: R1 입력 = 정적 fetch 하나(`dm-brand-extractor.ts:513`이 script 블록 제거) · R2 재료 게이트 없음(`jobs.ts:439` 200 = ok) · R3 포스터 = 배경 + 업체명(`produce.ts:423`) · R4 캠페인 구조 증발(면허 없으면 5종 제거 · reviews 상시 제외 · "브랜드 중심" 규칙 · hero 업체명 대체) · R5 면허 = 재대조 + YYYY-MM-DD 미래 종료일 한 형식.

## 1. 정체성

캠페인 엔진 = **재료 → 캠페인 구성(few-shot 섹션 + 재료 채우기 + 혜택 차단 + 빈 섹션 제거 + 룩 + CTA 보장) → 렌더.** 입구 셋: ① AI 영업(재료 = 홈페이지 렌더 크롤) ② 고객 생성(재료 = 업로드 이미지 + 직접 적은 행사 내용 + 자사몰 상품) ③ 원스텝 인터뷰(무접촉). "체험"이라는 별도 입구·단어는 쓰지 않는다.

## 2. 세션 순서(Harold 확정)

| 세션 | 축 | 내용 | 상태 |
|---|---|---|---|
| S1 | AI 영업 재료 | 렌더 크롤(별도 워커 + 프록시) + DOM 재료 v2 + 정적 부족 시 승격 + 3값 기록 | **코드 완료(§3)** |
| S2 | AI 영업 구성 | 재료 게이트(발송 잠금 6번째) + 면허 확장(기간 형식 · 목록 우선 · 사실 수치) + 규칙 4건 + 이메일 독립 계약 | §4 |
| S3 | 스튜디오 | 포스터 3칸(숫자 0 게이트) · 누끼 PNG 직접 합성 · 배너 0장일 때만 16:9 · 채점 | §5 |
| S4 | 운영 | 삭제(검토 대기·발송 포함 · 정리 토글) + 열람 이력(확정 2신호 · 픽셀 제외 · IP 0) | §6 |
| S5 | 엔진 공용화 | 조립부 추출(주입 인자) + 업로드 재료 어댑터 + DM 라우트 재료 분기 + 원클릭 화면 | §7 |
| S6 | 확장 | 이메일 라우트 합류 + 입력 컴포넌트를 DM 빌더·이메일 편집기에 | §8 |

매 세션 끝 = 아이소이 · 이니스프리 · SPA 몰 1곳을 375폭 전장 캡처로 남겨 직원 실물 옆에 놓는다(`scratch/proto/shot.js`). "그대로 보내도 되는 수준" 5축 = 첫 화면이 그 브랜드 실물 배너 · 가격 있는 상품 4장 이상 · 행사명이 헤드라인 · 사회적 증거 1블록 · 목적지 이름형 CTA 2개. 앞 둘만 발송을 잠그고(S2) 뒤 셋은 경고.

## 3. S1 — 렌더 크롤 + 재료 v2 (2026-09-06 구현 완료)

### 3-1. 구조

```
backend(runOutreachJob 크롤 단계)
  정적 fetchHtmlGuarded ──▶ countMaterials(순수) ──▶ shouldEscalateToRender(순수)
        │                                                  │ 승격(상품<4 · 이미지<2 · 본문<1,500자 · 혜택가 쌍 0 중 하나)
        │                                                  ▼
        │                              renderPageGuarded(127.0.0.1:4317 · 5초 lock_at heartbeat)
        │                                                  │ 워커 부재(ECONNREFUSED)·점유(409)·차단·시간 초과 = 즉시 {ok:false}
        ▼                                                  ▼
  추출기(extractProducts · bannersOf · discoverProductLinks · buildCtaLinkMap · extractLogoCandidates · buildOutreachEventMaterial)
        └── 두 소스에 각각 돌려 합집합(렌더 앞 · 정적 뒤 · 키 = productKey / URL) ──▶ brand_profile(+materials v2) · stage_results(rendering 3값)

outreach-render(별도 PM2 프로세스 · DB 자격 없음 · 동시 1건)
  POST /render {url, deadlineMs, screenshot} → 크롬(BrowserContext 1개/잡) ─proxy─▶ 로컬 CONNECT/HTTP 프록시
  프록시: resolvePublicAddress(사설·예약 거절) → 검증 IP로만 net.connect(pinnedLookup) · 포트 80/443/8080/8443 · 바이트 20MB · 렌더 중이 아니면 403
  보조층: page.on('request') decideRequest(문서 이동 = 같은 사이트 + 메인 프레임만 · media/websocket/eventsource/ping/other 차단) · 다운로드 deny · 최종 호스트 이탈 = blocked
```

### 3-2. 파일

| 파일 | 소유 | 상태 |
|---|---|---|
| `packages/backend/src/workers/outreach-render-worker.ts` | 렌더 워커 프로세스(프록시 · 브라우저 수명 · 고아 수거 · HTTP API) | 신규 |
| `packages/backend/src/utils/sales-outreach-render-guard.ts` | 가드 판정(순수): registrableDomain · isSameSite · decideRequest · parseConnectTarget · isAllowedProxyPort · clampDeadline · RENDER_DEFAULTS · RenderMeta | 신규 |
| `packages/backend/src/utils/sales-outreach-render.ts` | 클라이언트 renderPageGuarded + 순수 countMaterials · shouldEscalateToRender · union* · mergeCtaLinks · buildMaterialsV2 · bannersOf | 신규 |
| `packages/backend/src/utils/sales-outreach-media.ts` | OutreachProduct 선택 필드(discount_rate·rating·review_count·badges · 카드 원문 문자열만) · extractImageCandidatesDetailed(alt·순서) · extractProofSignals(리뷰 총수·평점·1위 표기) · 기존 extractImageCandidates = 상세 판의 url 투영(문자 단위 동일) | 확장 |
| `packages/backend/src/utils/sales-outreach-jobs.ts` | 크롤 단계 승격·합집합·행사 상세 렌더 우선 · startLockHeartbeat · RESETTABLE_KEYS(+rendering·rendering_detail·render_meta·crawl_engine) | 확장 |
| `packages/backend/src/utils/dm/dm-brand-extractor.ts` | `resolvePublicAddress` export 1줄(동작 무변경) | 1줄 |
| `packages/frontend/src/components/admin/SalesOutreachModal.tsx` | 확인 대기 전폭 "홈페이지에서 읽은 재료" 카드(서버 counts만) · 읽기 방식 · 렌더 실패 사유 · 근거 패널 한 줄 | 확장 |
| `ecosystem.config.js` | `outreach-render` 앱(ts-node · 127.0.0.1:4317 · max_memory_restart 900M) | 확장 |
| `scratch/proto/render-gate.js` | 코드 0 착수 게이트 실측(3업체 × 3회 편차 · 벽시계 · RSS · 잔존 pid) — Harold가 .62에서 실행 | 신규(폐기 전제) |

### 3-3. 계약(불변으로 승격 = FEATURE 불변 28)

1. 크롬은 워커 안 로컬 프록시 뒤에서만 나간다. 프록시의 목적지 판정은 `resolvePublicAddress` 하나(새 판정기 0). 크롬 자체 DNS 0.
2. 워커는 DB를 모른다. backend 가 lock_token 을 계속 쥔다(워커 = 순수 함수 역할).
3. 승격은 정적 계측이 얇을 때만. 렌더 실패는 정적으로 전진하고 `stage_results.rendering` 3값(ok / no_content / unavailable) + `rendering_detail` + `render_meta` 에 남긴다. 시도 자체를 안 했으면 키가 없다(`crawl_engine` 만 남는다: static / render / mixed / none).
4. 렌더 대기 구간은 5초 heartbeat 로 `lock_at` 갱신(lock_token · stage 조건 동반 · 0행이면 멈춤). sweeper 좀비 15분에 닿지 않는다.
5. 재료 v2 값의 출처 = HTML 문자열(카드 원문에 문자열로 있는 것만 · 계산·추정 0). vision 은 S1 에 없다.
6. 기존 소비처 무변경: `imageCandidates`(string[])·`listProducts`·`productLinks`·`logoCandidates`·`ctaLinks`·`legal` 키 형태 그대로. 렌더 0건이면 결과는 옛 방식과 같다(무후퇴).

### 3-4. 검증

- tsc backend 0 · frontend 0. vitest 아웃리치 14파일 150건 통과(신규 3파일: render-guard 4묶음 · render 8건 · media-v2 6건).
- 계약 테스트 이관 2건: 후보 24 문자열 → `bannersOf(rendered.html, finalUrl, 24)` · `bannersOf(page.html, staticUrl, 24)` · `imageCandidates: banners.map((b) => b.url)` / 브랜드 색 `resolveBrandColorGuarded(colorHtml, finalUrl`. OUTREACH_FILES 에 새 파일 3개 등재(모델명 0 스캔).
- 로컬 실측(크롬 실물 · 프록시 없이 게이트 스크립트): isoi.co.kr 렌더 1회 = 텍스트 6,970자 · 가격 23 · 할인율 13 · img≥400 79 · 8.8초.
- **미검증(서버 실측 대기)**: 프록시 경유 렌더 성공률 · 회차 간 편차 · RSS · 잔존 pid · sandbox 기동 여부(.62 Ubuntu 24.04 계열이면 `--no-sandbox` 자동 재시도가 로그에 남는다). 실측 = OPS §2-2-E ⑧.

### 3-5. 되돌리기

워커를 안 띄우면 backend 는 정적 크롤로 전진한다(ECONNREFUSED 즉시). 코드 롤백만으로 충분하다(DDL 0 · 새 jsonb 키는 구코드가 읽지 않는다).

## 4. S2 — 재료 게이트 · 면허 확장 · 구성 규칙 · 이메일 계약 (2026-09-06 구현 완료)

### 4-0. 구현 기록

| 파일 | 변경 |
|---|---|
| `utils/sales-outreach-review.ts` | `OUTREACH_MATERIAL_GATE`·`assessMaterialSufficiency`(순수 · 셋 중 둘) · `factQuoteOf`(가격만 · ' · ' 구분 · 혜택어 거부) · `OutreachQualityCode` +`HERO_FALLBACK` · QualityInput.heroFallback |
| `utils/sales-outreach-jobs.ts` | `SendLockReason` +`MATERIAL_THIN` · `computeSendLock` 3인자 · `sendLockMaterialOf` · `parseLicensedEndDate`·`findPeriodNear`·`normalizeAiDate` · `filterQuoteCandidates` 종료일 3단 폴백 · 분석 종료 `stage_results.material` 기록 · 제작 루프 `quoteBasis`(면허 인용 + 사실 수치) · dm asset `heroFallback` · 발송·상세 잠금 호출에 재료 인자 · `overrideOutreachMaterialGate` · RESETTABLE_KEYS +material·material_override |
| `utils/sales-outreach-produce.ts` | `toProductItems` discount_rate 통과(원문 문자열만) · DM maxLabel 16 · `sanitizeDmCopyBenefits` heroFallback 반환 · `insertProofCard`·`moveCountdownBeforeLastCta`(순수) · produceOutreachDm 배선(정렬 → 룩 · override 뒤 카드) · ProduceDmInput.proof · ProduceDmResult.heroFallback·proofInserted |
| `utils/sales-outreach-exemplars.ts` | 규칙 "행사가 있으면 행사 중심" · 공통 줄 표 `SECTION_CONTRACT_COMMON` · DM 계약(text_card 0~1 · sub_copy 60 · CTA 10~16자 목적지 이름형) · 이메일 계약 독립 문자열(상품 묶음 앞 text_card 3칸) |
| `utils/sales-outreach-look.ts` | CTA 라벨 13자 초과 = bar 미배정(기본 버튼 구도) |
| `routes/sales-outreach.ts` | `POST /jobs/:id/material-override`(감사 `sales_outreach.material_override`) |
| frontend `SalesOutreachModal.tsx` · `audit-action-labels.ts` | SEND_LOCK_LABEL.MATERIAL_THIN + [확인했으니 해제](ConfirmModal 2클릭) · QUALITY_LABEL.HERO_FALLBACK · 확인 대기 thin 배너 · 감사 라벨 |
| 테스트 | `sales-outreach-s2.test.ts` 신설 · invariants 계약 문자열 이관 2건(`applyOutreachLook(ordered, 'DM', dims)` · `computeSendLock(sendLockEnv(), emailAsset, sendLockMaterialOf(rest.stage_results))`) |

확인된 사실(테스트로 고정): 차단기는 공백 2자 이하 간격의 자리를 한 덩어리로 합치므로 사실 수치 근거는 ' · ' 로 잇는다 · 가격과 면허 없는 할인율이 붙은 헤드라인은 자리째 지워져 업체명으로 대체되고 HERO_FALLBACK 이 남는다(면허 없는 %는 어디서도 살지 않는다) · 마커(종료·지난) 판정은 인용문 기준이라 주변 원문의 "지난 이벤트"는 폐기 사유가 아니고 과거 종료일이 면허를 막는다 · 키 삭제는 resetJobTo·advanceStage 안에만(계약)이라 material_override 초기화는 재크롤 clear 목록이 맡는다.
미검증(서버 실측 대기): 아이소이 재생성에서 추석 기획전 인용이 "기간 : 2026.08.31 ~ 2026-09-18" 을 면허로 얻는가 · 사회적 증거 카드가 첫 상품 묶음 뒤에 보이는가 · 이메일 시안이 상품 묶음 앞 3칸 카드를 내는가 · MATERIAL_THIN 잠금과 해제가 화면에서 왕복되는가.

### 4-1. 수렴안(원문)

- 게이트: `StageOutcome` 3값 무변경. `stage_results.material = { products, banners, events, verdict: 'enough' | 'thin', at }` 별 키(assessMaterialSufficiency 순수 · 임계 = 상품 4 · 배너 2 · 행사 1 중 둘 · 상수는 `OUTREACH_QUALITY_THRESHOLDS` 이웃). 확정 앞 경고 배너(재료 수) + 발송 잠금 6번째 `MATERIAL_THIN`(`computeSendLock(env, emailAsset, material)` 3인자 한 벌 · 해제 = 커스텀 모달 2클릭 + 감사 로그 `sales_outreach.material_override`). 제작은 계속한다.
- 면허: `parseLicensedEndDate(raw)` 순수 = YYYY-MM-DD · YYYY.MM.DD · YYYY년 M월 D일 · 좌우 형식 혼합("2026.08.31 ~ 2026-09-18 08:59:59") · 시각 버림 · 연도 없는 표기 = null(작년 행사 부활 차단). `isFutureDate` 는 판정만. 상품 카드 할인율은 공용 렌더러 `computeDmDiscountRate` 가 이미 계산(직원 실물 discount_rate 필드 0건) → 재료(discount_price)만 채운다 · 카피 본문의 %만 면허. 사실 수치(가격·평점·리뷰수)는 공용 CT 시그니처 무변경 · 호출부가 근거 원문(licensedQuote + 재료 원문 문자열)을 넓혀 통과(혜택어 정규식 거부는 아웃리치 파일 안 순수 함수 소유). 목록 카드(쌍) 우선 · 상세는 보강(`produce.ts:304~317` 정책 반전).
- 구성: 규칙 문장 "행사가 있으면 행사 중심 · 없으면 브랜드 중심"(`exemplars.ts:119`) · reviews 타입 불허 · 사회적 증거 = 코드가 채우는 text_card 1장(tag 리뷰 총수 · headline 평점 · body 수집 시각 · treatment 'framed' 최상위 · **applySectionOverrides 뒤 삽입** · 숨김 목록 보호 타입) · `avail.social` = 재료 유무 · CTA 목적지 이름형 DM 16자(계약 `:135` · maxLabel `:657` · 삽입 라벨 `:728` 한 커밋 · EMAIL 유지) · label 13자 초과면 look 이 bar 배정을 건너뜀 · hero sub_copy 60자 · `HERO_FALLBACK` 품질 경고 + 라벨 · countdown banner 유지 + 마지막 CTA 직전 정렬 · 섹션 상한 12는 prune 실측 후.
- 이메일: `OUTREACH_EMAIL_SECTION_CONTRACT` 독립 문자열(상품 묶음 앞 text_card 3칸 의무 · DM은 text_card 0~1 · 실물 19건 집계 근거) · skeletonTypes 채널별.

## 5. S3 — 스튜디오(아웃리치 전용) (2026-09-06 구현 완료)

### 5-0. 구현 기록

| 파일 | 변경 |
|---|---|
| `utils/sales-outreach-produce.ts` | `buildOutreachPosterTexts`(순수 · label 행사 성격/업종 · title 인용 첫 구간·숫자 앞·40자·인용의 부분 문자열 · subtitle 상품명 또는 사이트 제목 · 게이트 = `hasBenefitPattern` + `POSTER_EXTRA_REJECT_RE`(특가·핫딜) + 숫자 0 · 근거 없는 칸 = null · dropped 기록) · `posterCategoryLabel` · `buildPosterTypography`(높이 비율 · zone top/bottom · 라벨 = 브랜드 색 badge) · `outreachPosterFontPath`(저장소 fonts/malgunbd.ttf 우선) · `scoreOutreachPoster`(vision · 숫자·%·원 유출 → 배경 1회 재생성) · `captureAndScoreDm`(렌더 워커 375폭 캡처 → 8항목 2값) · `produceOutreachImage` 재작성(프롬프트 texts 비움 + textPosition top · 서버 합성이 문구를 찍음 · 알파 PNG rembg 우회 · `wantBanner` 16:9 배너 격리) · `OutreachFillMedia.bannerUrl/bannerSize`(실측 배너 0장일 때만 히어로) · `ProduceDmInput.bannerUrl/bannerSize` |
| `utils/sales-outreach-media.ts` | `pngHasAlpha`(표본 alpha<250 · 4MB 상한 · PNG 아니면 false) |
| `utils/sales-outreach-render.ts` · `workers/outreach-render-worker.ts` | `viewportWidth`(320~1920 · 기본 1280 · 스크린샷 clip 폭 동기) |
| `utils/sales-outreach-review.ts` | `OutreachQualityCode` +VISION_ 8종 · `VISION_WARNING_OF` · QualityInput.dmVision(false 항목만 경고) |
| `utils/sales-outreach-jobs.ts` | producing_image 입력(eventQuote·products·siteTitle·wantBanner) · studio_image payload +posterTexts·cutoutSource·posterScore·posterRegenerated·bannerUrl·bannerSize · DM/이메일 제작에 bannerUrl 전달 · dm payload +visionScore(숨김 재실행은 승계) · 상세 quality dmVision |
| frontend `SalesOutreachModal.tsx` | QUALITY_LABEL VISION_ 8종 · 이미지 탭 "포스터 문구 N칸 반영 · 누끼 경로 · 배너 · 재생성" 줄 |
| 테스트 | `sales-outreach-s3.test.ts` 신설(12건) |

확인된 사실(테스트로 고정): 스튜디오 공용 `hasBenefitPattern` 은 "특가"를 보지 않아 이미지 글자 게이트가 아웃리치 낱말을 따로 막는다(공용 패턴은 건드리지 않음 · 스튜디오 사용자 영향 0) · 가격·할인율이 붙은 상품명은 subtitle 후보에서 건너뛴다 · 실측 배너가 있으면 생성 배너는 첫 화면에 오르지 않는다(불변 26 실물 우선).
미검증(서버 실측 대기): py 합성 typography 의 실제 글자 크기·위치(비율 값은 계산이고 폰트 렌더는 서버에서만 보인다) · 포스터 vision 채점의 오탐률 · 렌더 워커 375폭 캡처가 발행 직후 뷰어 URL 을 읽는가(발행 지연이면 null = 채점 없음) · 16:9 배너의 문구 하단 배치.

포스터 3칸 = label 행사 카테고리 · title 면허 행사명의 부분 문자열 · subtitle 상품군/슬로건. 각 칸 `hasBenefitPattern`(image-studio.ts) 게이트 → 이미지 안 숫자·%·원 0(발송 잠금이 이미지 글자를 못 보므로 조립기 안에서 거부). 기간·할인율·금액은 이미지에 싣지 않는다. 알파 PNG(`pngHasAlpha`)는 rembg 우회. 서버 직접 합성(composeImage typography)으로 문구는 코드가 찍는다 · textPosition = 누끼 있으면 top. 상품 카드 이미지 생성 0. 16:9 배너는 실측 배너 0장일 때만 1장. vision 채점 = 디자이너 8항목 2값 + '요청하지 않은 숫자·%·원 유출' 필수 축 · 자동 재생성 1회(기존 상한 5 안) · 채점 unavailable = 통과(품질은 발송을 막지 않는다).

## 6. S4 — 삭제 · 열람 (2026-09-06 구현 완료)

### 6-0. 구현 기록

| 파일 | 변경 |
|---|---|
| `utils/sales-outreach-purge.ts`(신규) | `purgeOutreachJobArtifacts(jobId, companyId)` = DM 중지(not_published 멱등) + 포스터·16:9 배너·재료 사본·로고 파일 삭제 · `unlinkPublicImage` · 발송 능력 0 |
| `utils/sales-outreach-sweeper.ts` | 만료 파기 본문 → 공용 함수 호출(스탬프·롤백은 그대로 소유) |
| `utils/sales-outreach-jobs.ts` | `deleteOutreachJob`(스탬프 선점 `purged_at + deleted_at/deleted_by` → 파기 → 실패 시 롤백 + CONFLICT · 진행 중·sending 거절 · sent 허용) · `deleteOutreachJobsBulk`(sent 제외 · 100) · `recordOutreachPreviewView`(views_preview · CAS 1회 재시도) · `DM_VIEW_AGG_SQL`(dm_views 조인 · company_id 동반) · 목록 `view` 필터(viewed · unread3d) + LATERAL + 사람 삭제 제외 + 같은 주소 N건 · 상세 `views` · `normalizeHomepageKey` 호스트만(공유 호스트는 첫 세그먼트) · `findDuplicateJob` LIMIT 300 제거 |
| `utils/sales-outreach-review.ts` | `classifyViewerUa` · `mergePreviewView`(60초 합산 · 항목 50) · `previewHumanViewsSince` · `summarizeOutreachViews`(문장 서버 완성 · unread3d = 재접촉 후보) |
| `routes/sales-outreach.ts` · `routes/outreach-public.ts` · `routes/dm.ts` | `POST /jobs/:id/delete` · `POST /jobs/delete-bulk`(감사 delete · delete_bulk) · 공개 페이지 열람 기록(응답 비차단) · 아웃리치 DM track 은 ip·user_agent null |
| frontend `SalesOutreachModal.tsx` · `audit-action-labels.ts` | 열람 칩 2종 · [정리] 다중선택 + [선택 N건 삭제](sent 제외) · 행 Eye 2단 · 3일 무열람 메타 · 같은 주소 N건 더 보기 · 상세 [이 건 삭제](링크 닫고 삭제 · 서버 파기 숫자) · 실패 블록 삭제 · 근거 패널 "담당자 열람" 카드 |
| 테스트 | `sales-outreach-s4.test.ts` 신설(14건) · invariants 파일 목록 +purge · fail-closed ALLOW +recordOutreachPreviewView(공개 축) · jobs-pure 키 케이스 |

확인된 사실(코드로 확정): awaiting_confirm 은 크롤 lock_token 이 남아 있어 삭제 가능 판정은 `lock_token IS NOT NULL` 이 아니라 **stage 집합**(queued~producing_email)으로 갈랐다 · 옛 중복 키(호스트 + 첫 세그먼트)는 `/kr/ko` 같은 언어 경로가 다르면 같은 업체를 새 건으로 받았다(이니스프리 4건의 원인 후보 · 원문 4건 실측은 배포 뒤) · 스마트스토어 등 공유 호스트는 호스트만으로 묶으면 다른 상점이 한 업체가 되므로 예외 목록 · 키 삭제 연산(`- '`)은 resetJobTo·advanceStage 계약이라 삭제 롤백은 null 덮기(`->>` 가 JSON null 을 SQL NULL 로 읽는다).
미검증(서버 실측 대기): dm_views 조인 실측(아웃리치 회사 dm_views 행 존재) · 공개 페이지 열람 기록 CAS 충돌률 · 이니스프리 4건 원문 키 대조 · 삭제 뒤 파일 잔존 0 재카운트(`ls uploads/inapp/<companyId>`) · 기존 dm_views 행의 ip·UA 1회 UPDATE 는 Harold 결재.

삭제: `purged_at` 소프트 + `stage_results.deleted_at`(사람 삭제와 만료 파기 구분 · 목록 WHERE `deleted_at IS NULL`) · `purgeOutreachJobArtifacts` 공용(sweeper 본문 이관) · `lock_token IS NOT NULL` 거절 · 스탬프 선점 → 파기 → 실패 시 롤백 + 409 · 감사 로그 `sales_outreach.delete` · 단건 = 상세 액션 카드 1개(sent 허용 · confirmLabel '링크 닫고 삭제' · 서버 파기 숫자) · 목록 = [정리] 토글 다중선택 + 헤더 [선택 N건 삭제](sent 제외) · 중복 = 회색 메타 줄 '같은 주소 N건 보기' · 중복 원인은 4건 원문 실측 뒤 키 정정(호스트만) + LIMIT 300 제거 · force 는 dup_ack 기록과 함께 유지.
열람: 새 테이블 0 · 메일 픽셀 제외(첫 오픈 = 우리 자신) · 산출물 페이지 = `stage_results.views_preview`(상한 50 · 60초 합산 · 식별자 0 · UA 3분류) · DM = assets kind='dm' 전 dmId 로 `dm_views` 조인(**company_id 항상 동반** · 소스 계약 테스트) · 목록 LATERAL 1문장 · `view` 파라미터(viewed | unread3d) 보조 칩 · Eye + 숫자 2단 · 근거 패널 카드(문장은 서버 완성) · 3일 무열람 = 메타 줄 · 재접촉 후보 = forwarded_at 3일 경과 + 확정 신호 0 · 아웃리치 DM 은 track 호출부에서 ip·user_agent null · 기존 행 1회 UPDATE 는 Harold 결재.

## 7. S5 — 엔진 공용화 + 고객 입구(회의론자 최종 검증 12건 반영) (2026-09-06 구현 완료)

### 7-0. 구현 기록

| 파일 | 변경 |
|---|---|
| `utils/campaign-engine.ts`(신규) | `assembleDmCampaign(materials, options, deps)` = 생성 → 채우기 → 차단 → 정리 → 카운트다운 → 룩 → 숨김 → 증거 카드 → 재구성 → 통계 → 페이지. `sales-outreach-*` import 0(계약 테스트) · 생성기·채우기·차단·룩 전부 deps 주입 · `options.entry` 로 규칙 분기 가능(지금은 0) |
| `utils/sales-outreach-produce.ts` | `outreachEngineDeps()`(아웃리치 구현 묶음 · 생성기는 few-shot + 예시 원천 DB+seed) · `produceOutreachDm` 결정 구간을 엔진 호출로 교체(골격 선택·발행·brand_kit 은 잔류) · `generateSections` export |
| `utils/campaign-quick.ts`(신규) | `quickMaterialsEnabled`(ENV 회사 목록 · 비면 전 회사) · `quoteQuickCampaign`(기존 키 2개) · `quickPlanLocked` · `saveMaterialImages`(DM 이미지 저장소 · 매직 바이트 · 크기 실측) · `normalizeQuickMaterials`(이 회사 서빙 경로만 · origin 서버 판정) · `materialTextFromEvents` · `generateDmFromMaterials`(엔진 → 초안 DM `approval_status='draft'` → 차감 멱등 `quick:{draftId}`) · `extractMaterialsText` |
| `routes/dm.ts` | one-shot-generate `materials` 분기(응답 필드명 유지 + materials 계측 + draft_id · 몰 상품 첨부 0 · `structure:` 0 · 402) |
| `routes/event-campaigns.ts` | `GET /materials/quote`(enabled · plan_locked · 부품) · `POST /materials`(requirePlanFeature('mobile_dm') · 사본 저장 · 텍스트 비었을 때만 판독) |
| frontend `MaterialInput.tsx`(신규) · `QuickCampaignPage.tsx`(재작성) | 재료 한 칸(이미지 5 · 텍스트 · 링크) · 버튼 1개 → 견적(costOverride) → 재료 → 생성 → render-sample · 결과 2열(재료 스트립 · 판정 6항목 · 375 액자) · [DM 편집으로] = `/dm-builder?id={draft}` · 로딩 3층(3초 · 단계 텍스트 · 15초 안심 문구) · 3채널 세트 모달은 버튼으로 유지(자동 오픈 해제) |
| 테스트 | `campaign-engine.test.ts` 신설(골든 3 + 순수 4 + 계약 3) · invariants 문자열 이관(룩·override·페이지·통계 → 엔진 파일) · OUTREACH_FILES +2 |

확인된 사실(골든으로 고정): 고정 픽스처(모델 CTA 1 · 카운트다운 종료일 없음 · 면허 없는 30%)에서 결정 구간 결과 = `header hero text_card product_carousel text_card cta cta gallery text_card footer`(증거 카드가 첫 상품 묶음 뒤 · 코드 보장 CTA 가 모델 CTA 옆에 붙는다 · 카운트다운 제거 · 30% 차단) · 고객 입구 3장 = 히어로 1 + 갤러리 2 · 상품 카드 0.
설계와 달라진 것: 잡 + 폴링(15초 초과)은 두지 않았다(요청을 끝까지 기다리고 안심 문구만 · 잡 테이블 신설 없이는 폴링 대상이 없다) · 재료 사본 회수 회차 대신 문구 정직화(DM 편집기 업로드와 같은 수명) · `dm-ai-generate` 는 5크레딧(설계 3 은 옛 값) · 원클릭 캠페인 진입 시 모달 자동 오픈을 해제(첫 화면 = 재료 한 칸).
미검증(서버 실측 대기): 판독본(vision) 흐름의 첫 시안 품질(혜택 수치가 비운 채 나온다 · 확인 뒤 재생성이 승격) · 초안 DM 이 빌더 목록에 보이는가(created_by 스코프) · render-sample 이 draft 에 대해 HTML 을 내는가 · 5장 업로드 왕복 시간.

- 절단선 = `produce.ts` 950~961(재료 채우기 → 룩) · 생성기(generateSections) · 예시(exemplarSource) · 혜택 차단(sanitizeDmCopyBenefits) · fill 은 **주입 인자(deps)**. 엔진 파일은 `sales-outreach-*` 를 하나도 import 하지 않는다(계약 테스트 · 순환 참조 차단). 내부 회사 게이트(`:907~912`)·createDm·publishDm 은 produceOutreachDm 잔류.
- 골든 = AI 뒤 결정 구간만(gen.sections 고정 픽스처 · now·skeleton 인자 · sectionTypes·look 통계·CTA 수 스냅샷). 아웃리치 골든은 상시 회귀. `options.entry('outreach'|'customer')` 로 규칙 분기 가능.
- `sales-outreach-invariants.test.ts:246~325` 소스 스캔은 삭제하지 않고 대상 파일만 옮긴다(호출 횟수 2 단정은 파일별로 재배치). OUTREACH_FILES 확장.
- 라우트: `routes/dm.ts` one-shot-generate 에 `materials:` 분기 3~5줄(`structure:` 문자열 금지 · content-interview.test.ts:238) · 응답 필드명 유지(sections/pages/layout_mode/brand_kit + brief/coverage + materials 계측 + benefitStripped) · 엔진 분기에서 `attachMallImagesToProductCarousels` 호출 0 · 성공 직후 `approval_status='draft'` DM 1행 생성 → id 응답(render-sample srcDoc 미리보기 · [DM 편집으로]가 같은 id) · 멱등키 `quick:{draftId}:{attempt}` · 요금제 게이트는 dm 라우터 것 그대로.
- 재료 입구: `POST /api/event-campaigns/materials`(authenticate + 같은 `requirePlanFeature('mobile_dm')` · 견적 응답 `plan_locked`) = 사본 저장(dm.ts:361~372 저장 함수 공유) + 텍스트 비었을 때만 판독(3크레딧 · 성공 시만) → `{ images[{url,w,h}], event_text, events }` · 라이브러리 등재 0 · 사본 회수 회차(30일 초안 → 파일 삭제) 동반 또는 문구 정직화.
- 재료 v2(업로드 입구) events = `{ title, subtitle, benefit, products }`(판독 구조 그대로) · origin ∈ dom | vision | mall | user · **licensedQuote = origin user 텍스트만**(판독본은 사용자가 편집·확정하면 user 로 승격 · 미승격은 재료로만).
- 배치 규칙(fillOutreachDmMedia 기구현): 1장 = 히어로 · 2~5장 = 히어로 1 + 갤러리 2장 묶음 · 업로드 이미지는 상품 카드에 붙이지 않는다 · 이미지 없는 상품은 카드 금지(text_card 목록 줄) · MAX 5장.
- 화면(/quick-campaign 한 화면): 공용 MaterialInput(인라인 · 신규 1 · 삭제 0 — ImageToCopyModal 삭제는 S6) · 버튼 1개(이미지만 있어도 활성 · 텍스트 비면 판독 자동 선행 · 총액에 3 포함) · 크레딧 = 서버 견적 → CreditConfirmModal costOverride · 채널 DM만(이메일·인앱 슬롯은 기존 호출) · 포스터 없음(기본 off · 이후 체크 시 2크레딧) · 결과 = 모달 닫고 페이지 본문 max-w-6xl 2열(재료 스트립 · 다크 액자 시안 · 판정 줄 6항목 · [사진 더 올리고 다시 만들기]) · 로딩 3층(3초 스피너 · 15초 서버 단계 텍스트 · 초과 = 잡 + 폴링) · 바로 사용 = 기존 sessionStorage 이관.
- 크레딧 = 기존 키 그대로 · 신규 키 0 · 무료 회차 0("첫 사용 무료"는 견적 total 0 으로만 · 별건 결재) · ENV 회사 목록 = 노출 스위치 + 효과 함수 안 판정.

## 8. S6 — 이메일 합류 · 편집기 입구 (2026-09-06 구현 완료)

### 8-0. 구현 기록

| 파일 | 변경 |
|---|---|
| `utils/campaign-quick.ts` | `generateEmailFromMaterials`(같은 재료 정규화 · `produceOutreachBrandEmail` 재사용 = 이메일 독립 계약 · EMAIL 룩 · 크레딧 `email-ai-generate` 기존 순서) |
| `routes/email.ts` | `/ai/generate-sections` `materials` 분기(편집기가 읽는 형태 sections·subjects·preheader·name + materials 계측 · 재료 없으면 옛 경로 문자 그대로 · 몰 첨부 0 · 402) |
| frontend `MaterialQuickPanel.tsx`(신규) · `DmBuilderPage.tsx` · `EmailVisualEditor.tsx` | 편집기 안 "재료(이미지·행사 내용)로 만들기" 접이식 패널(compact MaterialInput · 견적 · CreditConfirmModal costOverride) · DM = 초안 id 로 `loadDm` · 이메일 = 블록 교체(기존 AI 생성과 같은 적용 경로) · `ImageToCopyButton` 은 무접촉(다른 두 화면이 아직 쓴다 · 사본 삭제는 그 화면들이 패널로 옮긴 뒤) |
| 테스트 | `campaign-engine.test.ts` +이메일 합류 계약 1건 |

설계와 달라진 것: `ImageToCopyModal` 사본 삭제는 하지 않았다(AI Operator·인앱 화면이 아직 그 버튼을 쓴다 · 삭제하면 그 둘이 깨진다) · 원스텝(structure)·플래너 무인 제작은 무접촉(계약 테스트 `structure:` 0 유지).
미검증(서버 실측 대기): 이메일 재료 시안의 상품 묶음 앞 3칸 카드 · 편집기 블록 교체 뒤 저장 왕복.

`routes/email.ts:1044` 에 같은 `materials` 분기(재료 0이면 generateEmailSections 문자 단위 동일 · 무후퇴 계약) · 이메일 독립 계약 · MaterialInput 을 DM 빌더(:870 ImageToCopyButton 자리)·EmailVisualEditor(:344) 에 꽂고 ImageToCopyModal 사본 삭제 · 원스텝은 무접촉(엔진 진입 계약에 "structure 가 오면 그것이 이긴다") · 플래너 무인 제작(planner-production.ts:160)은 범위 밖 등재.

## 9-1. 2026-09-06(2) 배포 뒤 첫 육안 정정 (Harold "이미지만 나열 · 설명 없음" · 구현 완료)

실측(https://hanjul.ai/api/dm/v/dm-QJ2m5IL · 375폭 캡처): 9블록 · 문장 블록 = 첫 화면 1줄 · 갤러리 4장(생성 포스터 1 + 홈 배너 3) 글자 0 · 포스터 title "풍성한 한가위 보름달 혜택 최대"(절단 잔재 · 폭 초과) · subtitle "올세라 탄력 옵션 선택" · 증거 카드 숫자만.

| 파일 | 변경 |
|---|---|
| `utils/sales-outreach-media.ts` · `produce.ts`(collectOutreachMedia) · `jobs.ts` | `StoredImage.alt`(배너 문구 정리본) · `bannerAltMapOf(materials)` → `imageAlts` → 사본에 붙인다 · `cleanBannerCaption`(파일명·배너N·업체명 단독·잡음 낱말만 = null) |
| `utils/sales-outreach-produce.ts`(fill) | 갤러리 images[].caption = 배너 문구(면허 밖 혜택 수치는 `stripUnauthorizedBenefits` 로 차단 → 캡션 없음) · 갤러리 앞 설명 카드(`so-lead-*` · 모델이 안 두었고 캡션이 있을 때만 · tag 카테고리 · headline 첫 문구 · body 나머지) · 포스터 = hero 다음 자기 블록(`so-poster-*` · 캡션 = 포스터 title · hero 없는 조각은 옛 자리) · 자동 CTA 앵커는 포스터 블록을 건너뛴다 |
| `utils/sales-outreach-produce.ts`(포스터) | `trimDanglingTail`(절단 뒤 수식어 최대·단·총·무려·오직 등 + 조사 · 마지막 낱말 2자면 보존) · subtitle 후보에서 옵션·선택·택N·단품·더블 제외 · 14자 이하 우선 · 타이포 폭 맞춤 size ≤ 0.9×(W/H)/글자수 |
| `utils/sales-outreach-produce.ts`(insertProofCard) | tag = 1위 표기 또는 "고객 후기" · headline "리뷰 N건 · 평점 R" · body "고객이 남긴 리뷰와 평점입니다 · 날짜 업체 홈페이지 기준" |
| `utils/sales-outreach-exemplars.ts` · `OutreachGenInput.bannerCaptions` · 엔진 `EngineGenInput.bannerCaptions` | DM 계약 "각 gallery 바로 앞에 text_card 1개씩 · headline·body 는 [배너 문구]·홈페이지 본문에 있는 말만" · 프롬프트 [배너 문구] 목록 |
| `utils/sales-outreach-style.ts` · `produce.ts`(buildProposalEmailSections·평문) | ★ Harold 지시 제안 메일 기능 소개 = `emailCopy.features`(소개 카드 1 + 여정 · 자동마케팅 · 이미지 스튜디오 3칸 · CTA 앞 · 사실만 · 포스터가 있으면 "이 메일 맨 위 이미지도 그렇게 만들었습니다") · 조립 함수 한글 리터럴 0 유지 |
| 테스트 | `sales-outreach-s7.test.ts` 신설(12건) · produce-pure 포스터 위치 3건 · s2 증거 카드·계약 · 골든 순서 |

확인된 사실(테스트로 고정): 갤러리 렌더러는 이미지별 `caption` 을 그리고 섹션 제목은 그리지 않는다 · `DM_EDITABLE_TEXT_KEYS.gallery = ['title']` 이라 캡션은 공용 차단기 밖 → 채우기 단계가 직접 차단한다 · 배너 alt 는 크롤 재료 v2 까지만 오고 사본에는 없었다(그래서 캡션에 쓸 사실이 손에 없었다).
미검증(재생성 뒤 캡처 대조): 아이소이 배너 alt 실측(문구가 있는가 · 잡음인가) · 설명 카드가 실물 리듬으로 보이는가 · 포스터 블록 3:4 가 히어로 다음에서 자연스러운가 · 기능 3칸이 메일 길이를 과하게 늘리지 않는가.

## 9. 범위 밖(등재만)

플래너 무인 제작 엔진 합류 · 원스텝 대행 델타 50 재정의 · 무료 회차 · 기존 dm_views 외부인 IP 행 정리 · `produce.ts:709` 정규식 역슬래시 누락 · `:627` JSDoc 반대 · `media.ts:202` 특정 사이트 경로 하드코딩 · 상품 상세 1홉 벽시계 예산 없음 · crawlSub 두 사실 합침 · 사본 1.5MB 상한 탈락 사유 미기록.
