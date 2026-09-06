# AI 영업 v3 · 브랜드 페이지 재구성 엔진 설계서 (2026-09-06 · 전원합의체 수렴 + 회의론자 최종 검증 반영 · 다음 세션 구현용)

> **상태**: **구현 완료(2026-09-06 · 같은 세션 · T0~T8 코드완료 · 배포 대기 · DDL 0 · ENV 0 · 워커 무변경)**. Harold 지시 "컨텍 여유로우니 여기서 작업까지 끝내자" → 설계서 확정 직후 순차 구현. 설계 대비 편차·판단은 **§17** 이 소유한다(본문 §4~§13 은 설계 시점 그대로 두고 §17 로 정정한다).
> **소유**: 이 문서 = v3 의 구조·순서·계약·테스트·구현 순서. 기능 불변은 [FEATURE-SALES-OUTREACH.md](FEATURE-SALES-OUTREACH.md) §2 가 소유하고 이 문서는 개정 후보(§4)만 낸다. S1~S8 구현 기록은 [캠페인 엔진 설계서](2026-09-06-campaign-engine-design.md) 가 소유한다(중복 기술 0).
> **회의**: COLLAB §1 절차 그대로. 기획·프론트엔드·백엔드·디자이너·회의론자 5역할(Explore 읽기 전용) · 1차 의견 → 교차 토론 1라운드 → 주재자 수렴 → **회의론자 최종 검증 2인(회의론자 · 백엔드 검증자) → 검증 반영(이 판)**. 회의 원문 = 세션 scratchpad `meeting_v3/`(r1_* · r2_* · verify_all.txt). 안건 = `brief_v3.md`.
> **읽는 순서**: §1(요구) → §7(DM 표준) → §5(재료) → §13(구현 순서 T0~T8). 백엔드 구현자는 §11·§12·§16 을, 프론트 구현자는 §6·§8·§10 을 먼저 본다. **§16 은 검증이 잡은 12건 + 빈칸 12건과 그 처방이고 본문(§4~§13)은 그 처방을 이미 반영한 상태다.**

---

## 1. Harold 요구 원문 → 명세

### 1-1. 원문(그대로)

- "브랜드의 색감을 읽어서 그것에 맞춰 깔끔하게 제작된것도 아니고 굉장히 조악한 이런 샘플로 과연 영업담당자들이 움직일까?"
- "핵심은 AI가 자동으로 너희 홈페이지를 읽어서 제작한 한줄로의 기술력이다. 자동으로 만드는것으로도 이정도의 퀄리티를 낼 수 있지만, 너희가 자사몰연동 및 이미지를 몇개 넣기만 하면 훨씬 뛰어난 품질의 DM 및 이메일을 자동으로 제작해준다. 단, 5분만 투자하면 브로마이드급의 퀄리티의 제작물을 만들 수 있다"
- "저렇게 이미지에 설명도없는 이미지 나열이 도대체 뭐가 필요한거야? 차라리 제품가격이랑 두번째 스샷처럼 저런것들 바로 링크되어서 넘어갈 수 있도록 해주는게 더 예쁘고 효율적이야 그리고 얘네가 만들어놓은 배너 및 이벤트 페이지 설명 세번째 스샷같은 페이지들을 재구성해서 올려주는게 낫다고"
- "영업AI 잖아 완벽하게 틀만 만들어 놓으면 토큰을 사용해도 제대로 만들어서 영업을 해야 얘들이 들어올거아냐"
- "행사내용(행사가 여러개 있을 수 있으니), 행사이미지, 같은걸 올려놓는 페이지를 만들고 그것들을 다 올려놓고 제작 버튼만 누르면 AI가 재료들로 요리를 만드는것처럼 하려고해 그러니 지금 만드는 영업AI 페이지에 AI API 를 아주 잘 사용해서 제작만 해도 그게 곧 우리의 학습데이터가 된다"
- "(이벤트 목록 페이지) 저렇게 보기 좋고 활용하기 좋게 나열이 되어있잖아"

### 1-2. 스크린샷 4장의 뜻

| # | 화면 | 뜻 |
|---|---|---|
| 1 | 지금 DM 하단 · 배너 2장 나열(글자 0) | 설명 없는 이미지 블록은 존재 자체가 결함이다 |
| 2 | 아이소이 상품 상세 · 뱃지 5개 + 제품 + 이름 + 49,000원 | 상품 카드는 가격 · 근거(뱃지·수상) · 상세 링크 밀도를 가져야 한다 |
| 3 | 홈 메인 배너 · "고함량 50,000ppm 이상 백광기미앰플 출시!" · 서브카피 · 제품 · 사용 전/후 | 배너를 붙이는 것이 아니라 배너 안의 글과 그림을 우리 블록으로 다시 짠다 |
| 4 | 진행중 이벤트 목록 · 카드 6개(배너 · 제목 · **기간 2026-09-30 13:59:59 까지** · 상세 링크) | **재료의 정답 위치.** 행사 여러 개 · 기간(면허) · 배너 · 링크가 카드 하나에 다 있다 |

### 1-3. 명세 6문장

1. 재료의 1순위는 홈 배너가 아니라 **이벤트 목록 카드**다. 카드 = 행사 1개 = {제목 · 기간 · 배너 · 상세 링크}. 카드 제목·기간은 크롤 HTML 원문 문자열이라 재대조(불변 4)를 통과하고 기간이 미래면 면허(불변 5)가 AI 0회로 난다.
2. 설명 없는 이미지 블록은 0이다. 이미지는 언제나 글자(제목 · 기간 또는 부제)와 링크를 가진 **text_card + cta** 로 선다. 아웃리치 DM·이메일에서 gallery 는 0이다(고객 입구는 현행 유지 · §7-6).
3. 상품 카드는 가격 3층(할인율 · 판매가 · 정가 취소선)이 실제로 그려지고, 대표 상품은 크게(focus) 서며, 수상·순위 문구가 있으면 스포트라이트 카드 1장이 그것을 갖는다.
4. 브랜드 색 1개가 정해진 5자리에만 걸리고, 우리 생성물(포스터)은 실측 배너가 충분하면 만들지 않는다. 사진 위에 우리 색을 얹지 않는다.
5. 토큰은 제약이 아니되 자동 재조립은 producing_dm 안에서 1회(조립만 2회 · 발행은 1회), 사람 회차와 키를 가르고, 어디서 몇 번 썼는지 잡에 남긴다.
6. 제작 1건은 재료(읽은 것) · 블록 대응(어느 재료가 어느 블록이 됐나) · 판정 · 사람 수정(카운트·사유)을 원문 0으로 남겨 고객 재료 입구의 골격·채점 근거가 된다.

---

## 2. 오늘 실측한 결함과 왜 이전 정정으로는 부족한가

실측(2026-09-06 · 주재자 직접 · 375폭 캡처 + DOM 계측): DM `dm-7ZcaTxq` 는 기본 보라(#4f46e5) · 12블록 중 문장 블록 2(그중 1개는 증거 카드와 중복) · 배너 갤러리 2개 글자 0 · 포스터(금색)·배너(민트)·세일 배너(보라) 혼재 · 상품 카드 = 이미지·이름·단일가. 공개 샘플 `b06c56c938` 은 자리표시자 4회 노출 · "만든 것 나열".

같은 날 S1~S8(설계서 §3~§9-2)로 닫은 것: 배너 alt 캡션 · 갤러리 앞 설명 카드 · 포스터 자기 블록 · 증거 중복 제거 · 자리표시자 0 · 렌더 팔레트 브랜드 색 · 3막 메일. **부족한 이유(회의·검증이 확정한 코드 사실):**

- 캡션의 유일한 원천이 alt 다(`produce.ts` fill `captionOf(img.alt)`). alt 가 없으면 캡션 0 · 설명 카드 0 → 나열이 그대로 재현된다.
- 배너 안 글자는 HTML 원문에 없다. 전사(vision)는 재대조를 원리적으로 통과하지 못하고, 차단기 `copy-benefit-detector.ts:79` 는 원·%·만원·천원만 잡아 "50,000ppm"·"200시간" 같은 수치가 그대로 통과한다.
- 이메일 갤러리는 caption 을 img alt 로만 쓴다(`email-section-renderer.ts:485`). 제안 메일의 DM 캡처·포스터도 지금 gallery grid_2x2 로 들어가 같은 자리에서 재발한다.
- DM 의 text_card `lead`·`quote` 구도는 `image_url` 을 읽지 않는다(`dm-section-renderer.ts` renderTextCardLead:512 · renderTextCardQuote:401 · classic:413 과 framed:526 만 그린다). 룩은 첫 text_card 에 lead 를 준다(`sales-outreach-look.ts:175`). 즉 이미지 있는 text_card 를 첫 자리에 두면 **DM 에서 배너가 조용히 사라진다**(이메일에서는 보인다).
- 상품 밀도의 절반은 배관이다: `collectOutreachMedia` 가 `OutreachMediaProduct` 를 만들 때 `badges·rating·review_count·discount_rate` 를 빠뜨린다(`produce.ts:341`). 그리고 그 4키를 만드는 쪽은 목록 추출기(`media.ts:153~159`)뿐이고 상세 1홉 파서(`parseProductPage` media.ts:583~589)는 5키만 돌려주며, 병합은 상세 결과를 먼저 6개까지 채운다(`produce.ts:316~329`). 스프레드 한 줄만으로는 운영에서 값이 실리지 않는다(검증 B6).
- 크롤은 이벤트 페이지를 이미 1홉 읽지만(`jobs.ts` findEventPageLink) 그 결과를 텍스트 2,000자로 접는다(`jobs.ts:590`). 카드 경계는 `sales-outreach-extract.ts:29` 의 사설 함수가 알면서 href·img 를 버리고, `STRUCTURED_MAX 1500 < CARD_TEXT_MAX 400 × 6` 이라 카드 4장째부터 AI 가 보기 전에 잘린다. `findPeriodNear` 는 `indexOf` 1회라 카드가 여럿이면 A 제목에 B 기간이 붙는다. 이벤트 페이지 HTML 은 배너 후보 합집합(`jobs.ts:640`)에 들어가지 않아 카드 배너 사본이 만들어지지 않는다(검증 B4).
- 채점 항목 `sections_enough`("구획 8개 이상")가 블록 수를 보상해 나열형이 채점상 합격이다.
- 행사 선택이 단수다(`event_quote.selected` 1개 · `OutreachSelection.eventIndex` · 화면 라디오 · `jobs.ts:895` licensedQuote 단수).
- 관측이 없다: 아웃리치 AI 호출은 companyId 를 넘기지 않아 `ai_call_log` 에 남지 않고, `recordAiCall` 은 companyId 없이는 아무것도 쓰지 않으며(`ai-rate-limit.ts:111`), `callAIWithFallback` 은 토큰 사용량을 돌려주지 않는다(검증 B1).

---

## 3. 회의 요약(5역할 · 2라운드 · 최종 검증 2인)

### 3-1. 전원 합의

- 재료 1순위 = 이벤트 목록 카드. 배너 vision 전사는 카드 0건일 때의 폴백(수치 든 줄은 재대조 통과분만 · licensedQuote 에 절대 넣지 않는다).
- 아웃리치 DM·이메일에서 gallery 0. 이미지 + 설명 = text_card(image_position) + cta. 포스터도 text_card.
- P0 = 상품 4키 복구(상세·목록 병합 · 행동 테스트) · 제안 메일 gallery → text_card.
- 상품 6개 = 2 + 4(첫 묶음 focus) · 스포트라이트 text_card 는 수상 문구가 잡혔을 때만.
- 뱃지 필드 신설(ProductCarouselItem.badges) 은 이번 판 0(8자리 한 커밋 조건 · 고객 편집기 요구 발생 시).
- 채점 `sections_enough` 키 유지 · 정의 교체 · 새 항목 · 골든과 같은 커밋 · 파리티 테스트.
- 자동 재조립 = producing_dm 안 1회 · 조립 2회 발행 1회 · auto_seq 분리 · 벽시계 상한.
- 관측 = 아웃리치 코드가 스스로 세는 `ai_cost{calls, bySource, ms}` · companyId 주입 0 · 토큰은 `onUsage` 콜백 별건.
- 학습 = 새 테이블 0 · dm payload `recipe`(bindings 포함) · `stage_results.edits[]`(전용 append CT) · 승격 = best_copy_assets kind `recipe`(CHECK 없음 실측 · §11 SQL 로 재확인).
- 고객 입구 = 행사 카드 최대 3 · 카드당 이미지 3 · 판독 1회(대표 이미지 묶음) · `eventCards` 신규 키 · 몰 상품 배관과 같은 배포에만 버튼.
- 제안 메일 = 3막 · 1막 대조 2장(홈 캡처가 있을 때만 왼쪽) · 회신 문장 · 체험 링크 범위 밖.

### 3-2. 갈린 지점과 택한 이유

| 지점 | 갈림 | 택함 | 이유 |
|---|---|---|---|
| DM 에 싣는 행사 수 | 기획·백엔드 3 / 디자이너·회의론자 2 | **후보 선택 ≤3 · DM 반영 ≤2** · 3번째는 마지막 CTA 목적지 | text_card 는 링크가 없어 행사마다 cta 가 따라온다 |
| 파생색 | 회의론자 brandRamp 2색 → registry 색 prop / 디자이너·기획 반대 | **파생색 0** · 주색 1개 5자리 · 섹션 예외는 최상위 `accent_color` 1개 | 색 prop 은 사람 편집 칸 · "미지정 = 옛 출력 동일" 계약 · 지적은 색 부족이 아니라 혼재 |
| 관측 방식 | companyId+creditCost:0 / recordAiCall 직접 | **둘 다 불가(검증 B1)** → 아웃리치 코드가 호출 수를 스스로 센다 · 토큰은 `onUsage` 콜백 커밋 별건 | recordAiCall 은 companyId 없이 무기록 · callAIWithFallback 은 usage 미반환 |
| 블록 최소 요건 숫자 | 4역할 4가지 숫자 | **이번 배포 = 경고만** · 상수 1곳 · 375폭 캡처 3건 뒤 삭제 승격 | 실측 근거 0 |
| 갤러리 0 구현 위치 | "분기 금지" / "분기 1개" | **entry 분기 1개 + 계약·허용 타입 2벌(함수)** · 골든 2벌 + 계약 테스트 2줄 | 골든은 generate 를 픽스처로 갈아끼워 계약 문자열 구간을 못 본다(검증 B1/B2) |
| 확인 화면의 사람 입력 | 판독 필드 편집 / 반대 | **작문 칸 0** · 줄 [빼기] · 블록 [사용 안 함] | 사람 클릭은 원문 실재를 만들지 못한다 |
| 증거 카드 위치 | 표 8행(상품 2묶음 뒤) / 코드(첫 묶음 뒤) | **코드에 맞춘다(첫 상품 묶음 직후 · insertProofCard 무변경)** | 3줄 커밋과 s2 테스트 갱신을 늘리지 않는다 |
| provenance 자리 | 섹션 최상위 / recipe.bindings | **recipe.bindings 만(이번 판)** · 최상위 키는 §15 | Section 타입은 공용 닫힌 객체 · badges 와 같은 8자리 잣대 |
| 배너 전사기 | extractEventsFromImages 재사용 / 로컬 함수 | **로컬 `transcribeBannerLines`** | 공용 판독기는 companyId 필수 · creditCost 3 고정 · 레이트리밋 결합 |
| 카드 상세 1홉 시점 | confirm 뒤 / analyzing 안 | **analyzing 안(재료 게이트 앞) · 면허 있는 카드 상위 2** | 게이트가 늘어난 재료로 계산되어야 MATERIAL_THIN 이 뒤집히지 않는다 |
| 답장 유도 | 페이지 버튼만 / 메일 문장 | **둘 다** | 클릭 관측은 페이지, 회신은 메일 본문 |

---

## 4. 목표 · 불변 개정 후보(FEATURE §2 에 등재 · 번호는 등재 시 확정)

**신설 후보**
- **34 재료 1순위 = 이벤트 목록 카드.** 카드 제목·기간은 원문 문자열 · 기간 미래 = 면허 자동. 배너 전사는 폴백이고 전사 줄(`bannerLines`)은 licensedQuote 에 들어가지 않는다(가드 `assertLicensedQuoteSources(licensedQuote, bannerLines)` · produceOutreachDm 진입 첫 줄 · 행동 테스트).
- **35 설명 없는 이미지 블록 0.** 아웃리치 DM·이메일에 gallery 0(포스터 포함). 이미지가 실린 text_card 에는 lead·quote 구도를 배정하지 않는다.
- **36 채점은 블록 수를 보상하지 않는다.** sections_enough 정의 = 범위 안(9~13). uncaptioned_image_zero 상시. 항목·경고 코드·화면 라벨 파리티 테스트.
- **37 자동 재조립은 producing_dm 안 1회 · 조립 2회 · 발행 1회 · auto_seq 키 · 사람 5회와 분리 · 벽시계 상한.**
- **38 관측 = 아웃리치 코드가 세는 `stage_results.ai_cost{calls, bySource, ms}`.** companyId 주입 0(레이트리밋·5분 캐시 결합 금지). 토큰은 `callAIWithFallback onUsage` 콜백이 생긴 뒤에만.
- **39 학습 원장은 새 테이블 0 · 원문 0.** dm payload `recipe`(bindings) · `stage_results.edits[]`(전용 append CT 1곳) · 승격만 best_copy_assets kind recipe.

**개정 후보(기존)**
- **불변 1**: "발송·재시도는 사람 클릭 하나. 예외 = 조립 단계 안의 자동 재조립 1회(생성 ≤2 · 벽시계 60초 · 발행 1회 · auto_seq 로 사람 회차와 분리)."
- **불변 18**: 행사 1홉 = 이벤트 목록 페이지 1 + 면허 있는 카드 상세 최대 2(analyzing 안 · 카드당 10초 · 총 30초). 제작 단계 상품 상세 10 이하 유지.
- **불변 26**: "갤러리는 배너를 통째로 2장씩" 문장 삭제 → §7 표준으로 대체.
- **불변 28**: "팔레트·홈 첫 화면 캡처 목적의 렌더 1회는 얇음 판정 밖 예외(별 변수 `paletteShot` · 재료·재대조 원문에 대입 0 · 실패·409 = 즉시 전진 · 3값 키 palette_render)."
- **불변 30**: "포스터는 실측 배너 ≥ 3장 이고 이벤트 카드 ≥ 1건이면 만들지 않는다(asset 행은 url null 로 남긴다)."

---

## 5. 재료 층 v3

### 5-1. 이벤트 목록 카드(1순위 · AI 0회)

**진입**: `findEventPageLink`(jobs.ts:318~339) 유지(1홉 수 무변경). 정렬만 바꾼다: `<nav>`·`<header>` 안 링크(메뉴) → 텍스트가 정확히 "이벤트 · 기획전 · 프로모션 · EVENT · PROMOTION" → 나머지 EVENT_LINK_RE 매치. 첫 매치 1개 반환은 그대로.

**파싱**: 순수 함수 **`extractEventListCards(html, base): EventCard[]`** 를 `sales-outreach-media.ts` 에 신설(이름 = 검증 B12 · extract.ts:29 의 사설 `extractEventCards(html): string[]` 와 동명 회피 · 그 사설 함수는 T0 에서 `sliceEventBlocks` 로 개명 · 호출부 extract.ts:81 한 줄). 기법 = `extractProducts(media.ts:130~178)` 의 카드 슬라이싱 복제.
- 카드 판정 = `a`/`li`/`div` 블록 안에 `img` 1개 이상 + 텍스트에 FULL_DATE_RE 매치(기간) 또는 "기간" 낱말.
- `EventCard = { title, periodRaw, startDate, endDate, imageUrl, linkUrl, order }` 상한 6 · 같은 linkUrl 중복 제거 · 같은 호스트만.
- title = 카드 텍스트에서 기간 줄을 뺀 첫 줄(80자) · periodRaw = 기간 줄 원문(60자) · endDate = `parseLicensedEndDate(periodRaw).end`(단일 날짜 = 종료일 · jobs.ts:201~220).
- 렌더 HTML(`rendered.html` 또는 행사 페이지 렌더 결과)이 있으면 그것을 먼저 · 정적 폴백.

**저장(소유자 = `buildMaterialsV2` · sales-outreach-render.ts:238~266 · 검증 GAP2)**: `OutreachMaterialsV2` 에 `eventCards: EventCard[]` 와 `counts.eventCards` 를 더한다. jobs.ts 크롤에서 `let eventCards: EventCard[] = []` 를 `hasSource` 판정 위(:546 부근)에 선언 · subHtml 이 잡힌 자리(:576~592)에서 `eventCards = extractEventListCards(subHtml, subFinal)` · :650 buildMaterialsV2 호출에 넘긴다. 3값 키 `stage_results.event_list`(ok · no_content · unavailable)는 renderKeys 객체(:672~674)에 넣어 두 UPDATE(unavailable 분기 · toAnalyzing 분기)에 함께 실린다.

**카드 배너 사본(검증 B4)**: 크롤 단계에서 카드 `imageUrl` 들을 별 배열 `cardBannerUrls` 로 두고 `imageCandidates` **뒤에** 붙인다(홈 첫 배너 우선 규칙 유지 · 중복 제거 · 상한 24 → 카드 배너 포함 30). 사본은 producing_image 의 `collectOutreachMedia` 가 만들고, 조립은 `media.gallery.find((g) => g.srcUrl === card.imageUrl)?.url` 로 되찾는다(`StoredImage.srcUrl` 실재). 확인 화면 썸네일은 사본이 아직 없으므로 **원 URL** 임을 계약에 적는다(핫링크 · 표시만).

**후보 결속(analyzing)**: 카드마다 `EventCandidate` 를 만든다: `quote = title`(재대조 = 자기 카드 텍스트 안에서만) · `startDate/endDate` · `benefitLicensed = isFutureDate(endDate)` · `origin = 'card'`(유니온 `'crawl' | 'manual' | 'card'` · 소비처 = 화면 카드/인용문 분기 · §5-1 정렬 · 감사 라벨) · `title · bannerUrl(원 URL) · detailUrl`. 정렬 = 카드(면허 있음) → 카드(면허 없음) → AI 후보. `findPeriodNear` 는 카드 후보에 부르지 않는다.

**카드 상세 1홉(검증 B10 · analyzing 안 · 재료 게이트 앞)**: 대상 = 면허 있는 카드 상위 2(사람 선택 전이라도 결정적) · 정적 fetch(가드 · 같은 호스트 · 렌더 0) · 상품 링크·배너를 합집합에 더한다 · 예산 카드당 10초 · 총 30초 · 초과 전진 · 3값 `stage_results.crawling_cards`. 그 뒤에 `assessMaterialSufficiency` 를 계산하므로 게이트가 늘어난 재료를 본다.

### 5-2. 배너 전사(폴백 · 카드 0건일 때만)

- 대상 = 실측 통과 배너 상위 2장 · **로컬 함수 `transcribeBannerLines(images): string[]`**(produce.ts · `judgePersonInImage`·`scoreDmCapture` 와 같은 형태 · companyId 0 · source 'sales-outreach-banner-read' · maxTokens 상한 · 검증 B4). 공용 `extractEventsFromImages` 는 고객 입구 전용으로 남긴다.
- 전사 줄 게이트 `licensedLineOf(line, crawlText)` 순수 함수: 숫자 없는 줄 통과 · 숫자 있는 줄은 `norm(crawlText).includes(norm(line))` 일 때만 통과 · 아니면 폐기.
- 결과 `bannerLines` 는 그 회차 제작 안 지역 변수(저장 0 · EventCandidate 0). 전사 0 = 그 배너를 싣지 않는다. 가드 `assertLicensedQuoteSources` 가 bannerLines 원소가 licensedQuote 에 섞이면 throw(불변 34).
- 비교 사진은 자르지 않는다. 라벨이 전사에 있으면 body 끝에 ' · ' 로. 인물 판정을 태우고 person 이면 그 배너를 버린다(판정 실패 = 제외).

### 5-3. 상품 밀도 배관(P0 · 검증 B6 반영)

1. **병합 규칙**: `collectOutreachMedia` 가 상세 1홉 결과(fromPages)를 먼저 채우므로 목록 상품이 가진 4키를 같은 `productKey` 의 상세 상품에 덧입힌다. jobs.ts 가 `listProducts` 를 넘기고(이미 넘긴다), produce.ts:318~325 병합 루프가 `listByKey.get(k)` 로 badges · rating · review_count · discount_rate 를 조건부 스프레드한다. `produce.ts:341` 리터럴에도 4키 스프레드. 잠금 = 행동 테스트 "상세 1홉 상품 6개 + discount_rate 는 목록 상품에만 → 결과 카드에 실린다".
2. `perCarousel` 6 → 첫 묶음 2 · 둘째 묶음 4(상수 `OUTREACH_CAROUSEL_FOCUS = 2` · `OUTREACH_CAROUSEL_CLASSIC = 4`) · 홀수 금지 · 남는 1개는 앞 묶음에 붙이거나 버린다. 룩 focus 조건(look.ts:180~184)이 첫 묶음에 자동으로 걸린다. invariants `const perCarousel = 6;` 는 새 상수 2개로 이관.
3. 어워즈 `parseProductAwards(html)`(media.ts 신설 · 네트워크 0 · 이미 받은 HTML 재파싱): 화이트리스트(어워즈 · AWARDS · 1위 · 대상 · 수상 · 인증 · 비건 · WINNER) 포함 조각 40자 · 최대 3 · 원문 · 정규식 축 = `extractProofSignals` 재사용 · 이미지 뱃지 0. `OutreachProduct.awards?: string[]`.
4. `collectProductsFromLinks` 벽시계 인자 `PRODUCT_DETAIL_BUDGET_MS`(값은 홉 상한 6 × 요청 타임아웃 10초 실측 뒤 상수 1곳) · 예산 소진 = 수집분 전진 · `stats.productsTimedOut`.

### 5-4. 브랜드 색 · 홈 첫 화면 캡처(검증 B5 반영)

- 팔레트 1순위(S8)는 유지. **얇음 판정이 승격을 안 했을 때만** 별 변수 `paletteShot` 로 렌더 1회: `renderPageGuarded(job.homepage_url, { screenshot: false, screenshotViewport: true, viewportWidth: 375, deadlineMs: 8_000 })`. `paletteShot` 은 `brand.palette` 와 `homeCaptureUrl` 두 자리에만 쓰고 `rendered · materialSource · listProducts · banners · subHtml` 분기에 절대 대입하지 않는다(재료 원문·재대조 축 무변경). 3값 `stage_results.palette_render`. 행사 상세 렌더 조건은 `if (rendered)` → `if (escalation.escalate && rendered)`(팔레트 렌더가 두 번째 홉을 만들지 않게).
- 홈 첫 화면 캡처(375×900)는 공개 사본으로 저장 = `brand_profile.homeCaptureUrl`.
- `brand.colorSource` 를 4값으로 확정: `'render' | 'meta' | 'icon' | 'neutral'`(못 뽑으면 `'neutral'` · 지금은 null). `QualityInput.colorSource?` 를 더하고 `'neutral'` 이면 품질 경고 `BRAND_COLOR_FALLBACK`.

---

## 6. 선택 층(확인 대기 · awaiting_confirm)

### 6-1. 서버 계약(검증 GAP3·GAP4·GAP5 반영)

- `event_quote.candidates[]` 항목에 `title · endDate · bannerUrl(원 URL) · detailUrl · origin` 을 실는다(옛 항목은 필드 없음 = 인용문 행으로 그린다).
- `OutreachSelection.eventIndexes?: number[] | null` 추가. 라우트 `POST /jobs/:id/confirm` 은 `eventIndexes: Array.isArray(req.body?.eventIndexes) ? req.body.eventIndexes : null` 로 받고 audit 에 `events: n` 을 남긴다.
- 정규화(한 문단): `idxs = eventIndexes ?? (eventIndex != null ? [eventIndex] : [])` → 정수 · 0 이상 · `candidates.length` 미만만 남김(범위 밖은 그것만 버리고 warnings 1줄) → 중복 제거 → 앞 3개 절단(배열 순서 = 누른 순서 = DM 등장 순서) → `selectedList` 저장 · `selected = selectedList[0] ?? null`. **우선순위 = manualEventText > eventIndexes > eventIndex.** manual 이면 `selectedList = [manual]`(면허 없음 유지). `eventIndex` 는 응답에 계속 내려주되 요청 키로는 다음 판 폐기.
- UPDATE 리터럴(jobs.ts:801~810)은 event_quote 를 통째 교체하므로 `JSON.stringify({ candidates, selectedList, selected: selectedList[0] ?? null, confirmedBy, confirmedAt })` 로 바꾼다.
- **licensedQuote 자리 = runProduction 진입부(jobs.ts:895)**: `selectedList = event_quote.selectedList?.slice(0,3) || (selected ? [selected] : [])` · `licensedQuote = selectedList.filter(benefitLicensed).map(quote).join(' · ')`. 구분자는 ' · ' 만(줄바꿈은 차단기가 인접 자리를 합친다 · `copy-benefit-detector.ts:118~119`). `selected` 는 대표 1건으로 남겨 카피 프롬프트(:908)·포스터 문구(:975) 하류 무변경.
- 배너 전사문(폴백)의 사람 조작 = 줄 [빼기](override · 재생성 뒤 유지) · 블록 [사용 안 함]. 작문 칸 0. 승격 체크박스는 아웃리치에 없다.

### 6-2. 화면(SalesOutreachModal step 3)

- 인용문 라디오 → **카드 격자**(배너 썸네일(원 URL) · 제목 · 기간 · 상세 링크 아이콘 · 체크박스 · 선택 순서 번호 뱃지). 4번째 체크 = disabled + 사유 "행사는 3개까지 담깁니다". 옛 후보는 인용문 행.
- API 가 배열을 받는 배포(T4)에서만 체크박스를 그린다(죽은 컨트롤 금지).
- 브랜드 색: 이번 판은 `BRAND_COLOR_FALLBACK` 경고 1줄 · 다음 판에 기본 접힘 카드(팔레트 스와치 ≤5 · 직접 입력 · [무채색으로 진행]).
- [이 조합으로 제작 시작] 은 카드 위에 그대로(1클릭 · 아무것도 안 열어도 서버 기본 선택으로 시작).
- 재료 탭: 뱃지 원문 칩 · 평점 · 리뷰 수 · 상세 링크 유무 · [대표] 라디오 1개 = 배관 복구(§5-3-1)와 같은 배포에서만.

---

## 7. 조립 층 v3 · DM 블록 표준

### 7-1. 순서(고정) · 출처 · 조건 (검증 B6 증거 카드 위치 = 코드에 맞춤)

| # | 블록 | 출처(bindings.src) | 필드 | 조건 |
|---|---|---|---|---|
| 1 | header | code | brand_name · logo_url · brand_size lg | 항상 |
| 2 | hero(split) | card#1 | image_url = 카드1 배너 **사본**(srcUrl 매칭) · headline = `headlineFromCard(card, licensed)` · sub_copy = 기간 원문 또는 부제 | `heroEligible(url, dims)`(비율 ≥ 0.8 · dims 없음 = false) · 아니면 text_card(top) 강등 |
| 3 | cta | card#1 | label 행사 이름형 10~16자 · url 상세 링크 | 카드가 있으면 |
| 4 | text_card(classic · image left) 스포트라이트 | product#대표 | image_url · tag = awards[0] · headline = 상품명 · body = 가격 줄(`factQuoteOf` 형태) | awards ≥ 1 일 때만 |
| 5 | cta | product#대표 | label 상품명 앞 12자 · url link_url | 4 가 있을 때 |
| 6 | product_carousel(focus) | product#1..2 | 2개 · title 필수 | 상품 ≥ 2 |
| 7 | text_card(framed) 증거 카드 | proof | 리뷰 N건 · 평점 · 순위 · 기준일 | **코드 삽입 · 첫 상품 묶음 직후(insertProofCard 무변경)** |
| 8 | product_carousel(classic) | product#3..6 | 4개 | 상품 ≥ 4 |
| 9 | text_card(classic · image top) 행사 2 | card#2 | image_url = 카드2 배너 사본 · headline · body = 기간(+부제) | selectedList[1] |
| 10 | cta | card#2 | 상세 링크 | 9 가 있을 때 |
| 11 | countdown | card#1 | `end_datetime = cards[0].endDate`(fill 이 채운다 · 검증 없으면 제거) | 면허 종료일 · 마지막 CTA 직전 |
| 12 | cta | code | 대표 목적지(3번째 행사 링크 → 코너 딥링크 → 홈) | 항상 |
| 13 | footer | code | 법정 표기 · 수신거부 | 항상 |

- `OUTREACH_SECTION_MAX = 13` · 절단 조건 `sections.length > OUTREACH_SECTION_MAX` · 절단 순서 상수 `OUTREACH_TRIM_ORDER = ['proof', 'carousel#2', 'event#2']`(뒤에서부터).
- 3번째 행사는 블록 0 · 12번 CTA 목적지 1순위.
- 룩 서수: 이미지 있는 text_card 는 classic 고정(§7-3)이므로 lead 는 이미지 없는 첫 text_card 에만 · framed 는 증거 카드가 스스로 단다. 골든 단언 `treatments + backgrounds > 0` 은 증거 카드 framed + 배경면으로 성립한다(테스트에서 확인).
- `headlineFromCard(card, licensed): { headline, demoted }`: licensed 이면 제목 원문(18자) · 아니면 AMOUNT_RE·NPLUSN_RE 구간을 뺀 앞머리 · 그래도 6자 미만이면 hero 를 text_card(top) 로 강등(검증 B7 · 면허 없는 "최대 50% 기획전" 이 업체명으로 대체되지 않게).

### 7-2. gallery 0 (entry 분기 1개 + 계약·허용 타입 2벌 · 검증 B1/B2/B3/B8 반영)

- **타입·상수 넓히기(T0)**: `OutreachGenInput.entry: EngineEntry`(필수) · `dmSectionContract(entry)` 함수(아웃리치 = gallery 줄 제거 · 고객 = 현행 문자열 그대로) · `OUTREACH_DM_TYPES_OUTREACH`(gallery 제외 · 기존 `OUTREACH_DM_TYPES` 유지) · `generateSections(dmPrompt, entry === 'outreach' ? OUTREACH_DM_TYPES_OUTREACH : OUTREACH_DM_TYPES, ...)`.
- `EngineDeps.fill(sections, materials, channel, entry)` 4인자 · `assembleDmCampaign` 이 `opts.entry` 를 넘긴다 · `fillOutreachDmMedia(sections, media, channel, entry: EngineEntry = 'customer')` **마지막 인자 · 기본값 customer**(3인자 직접 호출 테스트 12곳 무변경).
- `ProduceDmInput.entry: EngineEntry` **필수**(jobs.ts 'outreach' · campaign-quick 'customer' · 기본값 0 = tsc 가 누락을 잡는다). `produceOutreachBrandEmail` 도 entry 를 fill 에 전달(고객 입구 이메일 갤러리는 현행 유지).
- fill 의 `entry === 'outreach'`: gallery 섹션을 비운다(prune 이 지운다) · 설명 카드(`so-lead-*`)·포스터 gallery 블록 0 · **배너 풀은 dims 와 히어로 후보용으로 계속 만든다**(검증 B2 · 히어로 = 카드1 배너 사본 → galleryAll[0] → 포스터 → 상품 순).
- 계약 테스트 2줄: `expect(dmSectionContract('customer')).toContain('각 gallery 바로 앞에 1개씩')` · `expect(dmSectionContract('outreach')).not.toContain('- gallery:')`. 새 행동 테스트 1건 = `fillOutreachDmMedia(secs, media, 'DM', 'outreach')` → gallery 0 · so-lead 0 · so-poster 0.
- 골든 2벌: 아웃리치 스냅샷(gallery 0 · 카드 픽스처 있음/없음 2케이스 · `hero.props.image_url` 기대값 두 케이스) · 고객 스냅샷 바이트 그대로. invariants `const heroImage = galleryAll[0]?.url || ...` 문자열은 새 표현으로 같은 커밋에 이관.

### 7-3. 이미지 있는 text_card 의 구도(look.ts · T3 선행 커밋)

- `applyOutreachLook` text_card 분기: `props.image_url` 이 있으면 lead·quote 를 배정하지 않고 **classic** 고정 · 이미지 없는 첫 text_card 에만 lead.
- 파리티 행동 테스트: image_url 이 실린 text_card 를 넣고 **DM 렌더 HTML 에 `<img` 가 실제로 나오는지**.

### 7-4. 포스터

- 생성 생략 조건: 실측 통과 배너 ≥ 3 **그리고** 이벤트 카드 ≥ 1 → 포스터 0(`studio_image` asset 행은 `url: null · skippedReason` 으로 남긴다 · 하류 null 분기 실재).
- 만들 때는 hero 다음 **text_card(image top)** 1장(headline = 포스터 title · body = label · subtitle). gallery 예외 0.

### 7-5. 아트 디렉션 규칙(코드가 지킨다)

- 주색 1개 5자리(hero split 밴드 · text_card tag 칩 · cta bar · 포스터 힌트 · 첫 상품 묶음 soft 배경) · 파생색 0 · props 색 칸 자동 기입 0 · 섹션 예외는 최상위 `accent_color` 1개.
- 배경면 soft·tint 교대 · `product_carousel.image_height` 한 값(`md`) · 사진 위 오버레이 0.
- `OUTREACH_HERO_MIN_RATIO = 0.8`(look.ts · LANDSCAPE_RATIO 아래) · `heroEligible(url, dims)`: dims 없음 또는 ratio < 0.8 → false(fail-closed) · 행동 테스트 3건(1.78 유지 · 0.7 강등 · dims 없음 강등).

### 7-6. 블록 최소 요건(경고 → 삭제 승격 절차)

- `assertBlockMinima(sections, minima)` 순수 함수 + `OUTREACH_BLOCK_MINIMA` 상수 1곳. **이번 배포 = 삭제 0 · 경고 `BLOCK_MINIMA_SHORT` 1건 + `stage_results.dm_block_gate = { short: [{type, field, len}], kept }`.**
- 삭제 승격 = 375폭 전장 캡처 3건 실측 뒤 상수 1곳 커밋. 잔존 부족은 발송 잠금 아님(MATERIAL_THIN 이 앞단).
- 품질 경고 `FEW_SECTIONS`(임계 6 · 조립 결과 하한 경고)와 채점 `sections_enough`(9~13 · 375폭 캡처 육안)는 다른 축이다: `OUTREACH_QUALITY_THRESHOLDS.sections` 는 9 로 올린다(같은 커밋).

### 7-7. 채점 항목 개정(같은 커밋 = 표준 + 골든 + 파리티)

- 유지 7 · `sections_enough` 키 유지 · 정의 "구획이 9~13 안이다" · 추가 4 = `uncaptioned_image_zero` · `first_screen_has_headline` · `brand_color_consistent` · `text_clipping_zero`. 총 12 · vision maxTokens 300.
- **파리티 테스트 1건(검증 GAP6)**: `DM_VISION_ITEMS.length === 12` · 모든 항목이 `VISION_WARNING_OF` 키 · 그 값이 `OutreachQualityCode` 유니온 안 · 프론트 `QUALITY_LABEL` 키 집합이 값 집합과 일치. 회귀 주입(항목 반전)은 배포 전 수동 1회로 §14.

### 7-8. 자동 재조립(producing_dm 안 · 1회 · 검증 B7 반영)

- `produceOutreachDm` 을 **`assembleOutreachDm`(섹션·pages·look 반환 · DB 0)** 과 **`publishOutreachDm`(createDm + publishDm)** 으로 쪼갠다. 375폭 캡처는 공개 주소가 필요하므로 순서 = assemble#1 → publish(1회) → capture → score → 트리거(uncaptioned_image_zero · first_screen_has_headline · text_clipping_zero 중 false) 이면 assemble#2 → **기존 dmId 를 `updateDm` 으로 갱신(createDm·publishDm 재호출 0 · short_code 유지)** → 재캡처 0.
- 상한: 생성 ≤ 2 · vision ≤ 4/잡 · 단계 벽시계 60초 · 잡 제작 예산 8분(초과 = 그때까지 산출물로 ready).
- 카운터 `stage_results.auto_seq[kind]`(사람 `regen_seq` 와 분리). **RESETTABLE_KEYS 에 등재**(검증 B3): `auto_seq · event_list · crawling_cards · palette_render · dm_block_gate · ai_cost · edits · reply_line` · 진입점별 clear = regenerate(dm) → ['regen','auto_seq'] · regenerate(image) → ['regen','section_overrides','auto_seq'] · recrawl → RESETTABLE_KEYS 전량 · rebuildEmail → ['regen']. invariants `clear: k === 'image' ? [...]` 문자열 갱신 · 소스 스캔 1줄 "새 stage_results 키는 RESETTABLE_KEYS 에 있다".
- 워커 busy(409) = 캡처 포기(대기 0). 색 통일·정렬·높이는 코드가 고친다.

### 7-9. 관측(검증 B1 반영)

- 아웃리치 축 AI 호출을 감싸는 `callOutreachAi(params)` 1곳이 호출 수·source·ms 를 잡 지역 카운터에 더한다(companyId 0 · recordAiCall 직접 호출 0). 제작 종료에 `stage_results.ai_cost = { calls, bySource: {source: n}, ms }` append.
- 토큰이 필요하면 `callAIWithFallback` 에 `onUsage?: (u: { inputTokens, outputTokens }) => void` 선택 콜백을 더하는 **별도 커밋**(반환형 무변경 · 기존 호출부 무영향)을 T5 앞에 세운다.
- 근거 패널 1줄: "이 건에 쓴 AI 호출 N회 · 자동 재조립 n/1 · 사람 재생성 n/5".

---

## 8. 제안 메일 v3

- 3막 유지(S8). **P0 배치 정정**: DM 캡처·포스터의 gallery grid_2x2 → text_card 2개(image top · 문구는 `emailCopy.story` · 한글 리터럴 0).
- 1막 = 대조 2장: 왼쪽 text_card(홈 첫 화면 캡처 `homeCaptureUrl` · **있을 때만**) · 오른쪽 text_card(DM 첫 화면 캡처). 캡처 위 글자 0.
- 2막 실샘플도 text_card(top). 이메일 gallery 0.
- 회신 유도 1문장 = 마지막 text_card body 마지막 줄(`emailCopy.reply`) · 검토 화면에서 제목과 같은 급으로 편집(60자 · 저장 = 재조립 · `stage_results.reply_line` · 얕은 병합 그대로).
- 3막 문장 = 행동 요청("이미지 2장과 자사몰 주소만 회신 주시면 3벌을 더 만들어 보내드립니다"). 체험 링크 범위 밖.
- 검토 화면: "담당자가 열 주소" 카드(산출물 · 공개 샘플 · 복사) · DM 탭 폭 토글(375/600).
- 공개 샘플 리미터 실측 항목(§14).

---

## 9. 학습 데이터(재료 → 요리의 정답표 · 검증 B11·GAP5 반영)

| 무엇 | 어디 | 모양 | 원문 |
|---|---|---|---|
| 제작 1건 레시피 + 블록 출처 | `sales_outreach_assets` kind dm payload `recipe` | `{ materials: {products, banners, eventCards, licensed, thin}, sectionTypes[], bindings: [{ sectionId, src: 'card'|'product'|'proof'|'poster'|'quote'|'code', ref, reader: 'html'|'vision'|'code' }], gates: {benefitStripped, removed[], heroFallback, eventList, bannerRead}, look: {treatments, backgrounds, primary, colorSource}, vision: {items, outcome}, cost: {calls, bySource} }` | 0 |
| 사람 수정 | `stage_results.edits[]` | `{ kind: 'hide'|'reselect'|'edit'|'reply', key 또는 url, reason?: 'no_text'|'duplicate'|'blurry'|'wrong'|'tone', beforeLen?, afterLen?, fieldPath?, at, by }` 상한 100 | 0 |
| 승격(ceo 버튼) | `best_copy_assets` kind `recipe` | `content = sectionTypes 문자열 · meta = { recipe 요약, bindings 통계, edits 통계, source job }` | 0 |

- **섹션 최상위 provenance 는 이번 판 0**(Section 은 공용 닫힌 타입 · badges 와 같은 8자리 잣대 · §15). bindings 가 sectionId 로 결속한다.
- **`appendStageResultArray(jobId, key, entry, cap)` CT 1개**(SQL 한 문장 append + 절단 · 왕복 0 · 동시성 안전). 숨김·재료 재선택·문구 편집 라우트 3곳은 이 함수만 부른다 · 다른 곳에서 `stage_results.edits` 직접 쓰기 0(invariants 소스 스캔 1줄).
- few-shot(마스킹 예시) 축과 recipe 축은 섞지 않는다.
- 화면: ConfirmModal 안 사유 라디오 5개 + 기본 [사유 안 남김] · 문구 편집은 fieldPath 동반.

---

## 10. 고객 재료 페이지 v3(/quick-campaign · 검증 GAP6 반영)

- 화면: 상단 브랜드 줄(브랜드명 · 주색 스와치 · 못 뽑았으면 폴백 견본 + 직접 지정 · 로고) → 행사 카드 리스트(최대 3 · 카드 = 제목 40자 · `MaterialInput compact` · **이미지 카드당 3장(`QUICK_EVENT_CARD_IMAGES = 3` · 총 9)** · 링크 1 · 체크박스 "이 문구를 그대로 씁니다"(= licensed) · [이 행사 삭제]) → [행사 추가](3이면 disabled + 사유) → "우리 몰 상품 붙이기"(엔진에 상품이 실리는 배포에서만) → 하단 고정 바(견적 1줄 + [제작] 1개).
- 카드 컴포넌트 분리(objectURL 은 카드 언마운트에서만 해제 · key = uuid · focus() effect 0).
- 저장: 카드 이미지를 고르는 즉시 `POST /api/event-campaigns/materials` 에 `read=0`(업로드 전용 · `wantRead = String(req.body?.read ?? '1') !== '0'` · 기본 1 = 현행 무변경). 판독은 카드 대표 이미지들을 **1회 호출**로 묶는다(다중 이미지 지원 실재). 견적 `quoteQuickCampaign({ imageCount, hasText, reads })` 는 판독을 `reads > 0 ? 1건` 으로만 센다(호출 1회 = 3크레딧 고정 · 곱셈 금지 · 카드별 호출로 바꾸는 커밋에서 함께). 카드 업로드 라우트의 multer 상한만 9 로.
- 요청 계약(신규 키 · `events` 는 판독 결과 전용으로 유지): `eventCards: [{ id, title, text, licensed, images: [{url, width, height}], link }]` 상한 3. **`normalizeQuickEventCards(raw, companyId)` 형제 함수**(기존 `normalizeQuickMaterials` 무변경 · 테스트 3건 보존 · 이미지 URL 화이트리스트 같은 규칙).
- 엔진 대응: `EngineMaterials` 에 `eventCards?: EngineEventCard[]` 1필드(§11 · 아웃리치와 같은 필드) + `EngineImage.group?: string`. 정규화 `materialsFromEventCards(cards)` 가 `gallery(group)` · `material('[행사 1] … [행사 2] …')` · `ctaLinks[group] = link` · `licensedQuote = licensed 카드 text ' · ' 결합` 으로 펴서 기존 경로에 태운다. fill 은 group 이 있으면 행사별 text_card + cta, 없으면 현행. 골든 = group 미지정 입력에서 바이트 동일.
- 브랜드 색: `getCompanyBrandKit` → `accessiblePrimaryOf`.
- 몰 상품: `campaign-quick.ts:175` products:[] → 선택 상품(≤6 · 대표 1)을 `EngineProduct[]` 로 · 화면 버튼은 그 배포에 묶는다.
- 미리보기 폭 토글 375/600 · srcDoc 스크롤 복원 · 판정 6항목 서버 값 표시.

---

## 11. 데이터 모양(DDL 0 · jsonb 키 사전)

| 위치 | 키 | 값 |
|---|---|---|
| `brand_profile.materials`(buildMaterialsV2 소유) | `eventCards[]` · `counts.eventCards` | §5-1 EventCard |
| `brand_profile` | `homeCaptureUrl` · `brand.colorSource` 4값 · `brand.palette` | §5-4 |
| `brand_profile.media.products[]` | `awards?` · badges·rating·review_count·discount_rate(실제 실림) | §5-3 |
| `event_quote.candidates[]` | `+ title · endDate · bannerUrl(원 URL) · detailUrl · origin('crawl'|'manual'|'card')` | §6-1 |
| `event_quote` | `selectedList[]`(≤3) | §6-1 |
| `stage_results` | `event_list` · `crawling_cards` · `palette_render` 3값 · `dm_block_gate` · `auto_seq` · `ai_cost` · `edits[]` · `reply_line` (**전부 RESETTABLE_KEYS 등재**) | §5·§7·§8·§9 |
| `sales_outreach_assets` kind dm payload | `recipe` | §9 |
| `best_copy_assets` | kind `recipe` | §9 |

**타입(공용 0 · 아웃리치·엔진 파일 안)**: `EngineEventCard = { title, periodRaw, endDate, bannerUrl(사본), detailUrl }` · `EngineMaterials.eventCards?` · `ProduceDmInput.eventCards? · entry(필수)` · `OutreachGenInput.entry(필수)` · `OutreachFillMedia.eventCards?` · fill `case 'text_card'` 신설(카드 매핑 시 image_url · image_position · headline · body 를 코드가 찍는다) · countdown case 는 `if (!p.end_datetime && cards[0]?.endDate) p.end_datetime = cards[0].endDate` 를 검증 앞에.

**information_schema 확인(코드 전에 · Harold 실행)**:
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'best_copy_assets'::regclass;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'sales_outreach_assets'::regclass;
```
기대 = best_copy_assets 는 PK 만 · sales_outreach_assets 는 kind CHECK 4값. 다르면 §9 의 자리를 다시 정한다.

---

## 12. 파일별 변경 계획 · 테스트 계획

### 12-1. 백엔드

| 파일 | 변경 |
|---|---|
| `utils/sales-outreach-media.ts` | `extractEventListCards` · `parseProductAwards` · `collectProductsFromLinks` 벽시계 · `OutreachProduct.awards?` |
| `utils/sales-outreach-extract.ts` | 사설 `extractEventCards` → `sliceEventBlocks` 개명(T0) |
| `utils/sales-outreach-render.ts` | `OutreachMaterialsV2.eventCards` · `counts.eventCards` · buildMaterialsV2 입력 |
| `utils/sales-outreach-jobs.ts` | findEventPageLink 정렬 · eventCards 선언·파싱·저장 · cardBannerUrls 합집합 · `paletteShot` 별 변수 · homeCaptureUrl · colorSource 4값 · 카드 후보 결속 · 카드 상세 1홉(analyzing) · selectedList/eventIndexes · licensedQuote 결합(:895) · UPDATE 리터럴 · RESETTABLE_KEYS 8키 · 진입점별 clear · auto_seq · ai_cost · edits(append CT) · reply_line · 포스터 생략 조건 · ProduceDmInput.entry 'outreach' |
| `utils/sales-outreach-produce.ts` | `OutreachGenInput.entry` · `dmSectionContract(entry)` 사용 · 허용 타입 2벌 · fill 4인자(entry 기본 customer) · 카드 → hero/text_card+cta · `headlineFromCard` · 스포트라이트 · 4키 병합(listByKey) · 2+4 · 포스터 text_card/생략 · 절단 순서 · `assertBlockMinima` · 채점 12 · `assembleOutreachDm`/`publishOutreachDm` 분리 · 자동 재조립(updateDm) · `callOutreachAi` · `transcribeBannerLines` · `licensedLineOf` · `assertLicensedQuoteSources` · 제안 메일 text_card 배치·대조 2장·회신 · recipe.bindings |
| `utils/sales-outreach-look.ts` | image_url text_card = classic · `OUTREACH_HERO_MIN_RATIO` · `heroEligible` · image_height 한 값 · 배경면 교대 |
| `utils/sales-outreach-exemplars.ts` | `dmSectionContract(entry)` · `OUTREACH_DM_TYPES_OUTREACH` · 이메일 계약 |
| `utils/campaign-engine.ts` | `EngineEventCard` · `EngineMaterials.eventCards?` · `EngineImage.group?` · `EngineDeps.fill` 4인자 · `opts.entry` 전달 |
| `utils/campaign-quick.ts` | `normalizeQuickEventCards` · `materialsFromEventCards` · `QUICK_EVENT_CARD_IMAGES` · 몰 상품 경로 · ProduceDmInput.entry 'customer' |
| `utils/sales-outreach-review.ts` | 경고 +BRAND_COLOR_FALLBACK · BLOCK_MINIMA_SHORT · VISION 4종 · `QualityInput.colorSource` · `OUTREACH_QUALITY_THRESHOLDS.sections` 9 |
| `utils/best-copy-assets.ts` | kind `recipe` 승격 함수 |
| `routes/sales-outreach.ts` | confirm eventIndexes · reply-line · recipe 승격(ceo) · edits reason |
| `routes/event-campaigns.ts` | materials `read` 파라미터 · quote `reads` · 카드 업로드 multer 9 |
| `utils/sales-outreach-style.ts` | emailCopy.story 대조 2장 · reply |
| `services/ai.ts`(별건 · T5 앞) | `onUsage?` 선택 콜백(반환형 무변경) |

### 12-2. 프론트엔드

`SalesOutreachModal.tsx`(행사 카드 격자 다중 선택 · 재료 탭 뱃지 칩·대표 라디오 · 근거 패널 호출 수 1줄 · 담당자가 열 주소 2줄 · DM 탭 폭 토글 · 회신 문장 편집 · 사유 라디오 · QUALITY_LABEL 6줄) · `QuickCampaignPage.tsx`(행사 카드 3 · 브랜드 줄 · 하단 고정 바 · 판독 정책 · 폭 토글) · `MaterialInput.tsx`(변경 0) · `audit-action-labels.ts`.

### 12-3. 테스트 계획(행동 테스트 우선)

- `extractEventListCards`: 아이소이 이벤트 목록 HTML 픽스처 → 6카드 · endDate 6 · 순서 · 중복 링크 제거 · 기간 없는 카드 제외.
- 카드 후보 재대조가 자기 카드 텍스트 안에서만(A 제목에 B 기간 0).
- confirm 정규화 4건(다중 · 하위 호환 · 4개 절단 · manual 우선) · licensedQuote ' · ' 결합.
- 4키 병합: "상세 1홉 상품 6개 + discount_rate 는 목록 상품에만 → 카드에 실림"(행동).
- 2+4 묶음 · focus 배정 · 홀수 금지.
- `heroEligible` 3건 · `headlineFromCard` 2건(면허 있음 수치 남음 · 없음 자리표시자 0 · heroFallback false).
- 파리티: image_url text_card → DM HTML `<img` 실재 · 채점 12항목 ↔ 경고 코드 ↔ 유니온 ↔ 프론트 라벨.
- 골든 2벌(아웃리치 gallery 0 · 카드 있음/없음 hero 두 케이스 · 고객 바이트 동일) · `fillOutreachDmMedia(…, 'outreach')` gallery 0 · so-lead 0 · so-poster 0.
- 계약 2줄(`dmSectionContract('customer')` 포함 · `('outreach')` 갤러리 줄 0) · `assertLicensedQuoteSources` throw · RESETTABLE_KEYS 스캔 · edits 직접 쓰기 0 스캔.
- 제안 메일: gallery 0 · 대조 2장(homeCaptureUrl 없으면 1장) · 회신 문장 · 자리표시자 0.
- `assertBlockMinima` 순수 · 경고만 · `appendStageResultArray` 상한 100.
- `assembleOutreachDm` 2회 → publish 1회 · updateDm 갱신(short_code 불변).
- OUTREACH_FILES 스캔(모델명 0 · 동명 export 0).

---

## 13. 구현 순서(다음 세션 · 주재자 단독·순차) · 완료 조건

| T | 내용 | 완료 조건 |
|---|---|---|
| **T0 타입·상수 넓히기** | `OutreachGenInput.entry` · `dmSectionContract(entry)` · `OUTREACH_DM_TYPES_OUTREACH` · `EngineDeps.fill` 4인자 · `fillOutreachDmMedia` entry 기본 customer · `ProduceDmInput.entry` 필수 · `EngineMaterials.eventCards?`/`EngineEventCard` · `buildMaterialsV2.eventCards` · `sliceEventBlocks` 개명 · `colorSource` 4값 · `QualityInput.colorSource` · RESETTABLE_KEYS 8키 등재 | tsc 0 · 기존 테스트 전량 초록(동작 무변경) |
| **T1 P0** | 4키 병합(listByKey + :341) · 제안 메일 gallery → text_card 2개(왼쪽은 homeCaptureUrl 있을 때만) · 회신 문장 · BRAND_COLOR_FALLBACK · `OUTREACH_QUALITY_THRESHOLDS.sections` 9 | 행동 테스트 3 · 아웃리치 테스트 전량 · **단독 배포 가능** |
| **T2 재료** | `extractEventListCards` · 크롤 저장·3값 · cardBannerUrls 합집합 · 카드 후보 결속 · 카드 상세 1홉(analyzing) · `paletteShot` + homeCaptureUrl · 어워즈 · 벽시계 | 픽스처 테스트 · 아이소이 재크롤 실측 eventCards ≥ 1 · 재대조 오염 0 |
| **T2.5 선택 서버 계약** | selectedList · eventIndexes 정규화 · UPDATE 리터럴 · licensedQuote 결합(:895) | confirm 행동 테스트 4 · 하위 호환 |
| **T3 조립** | look.ts 규칙(선행) · fill entry 분기 · 카드 → hero/text_card+cta · `headlineFromCard` · `heroEligible` · 2+4 · 스포트라이트 · 포스터 text_card/생략 · 절단 순서 · minima 경고 · 채점 12 + 파리티 · 계약 2줄 · `transcribeBannerLines`+`licensedLineOf`+가드 | 골든 2벌 · 파리티 img · 회귀 주입(수동) |
| **T4 선택 화면** | 카드 격자 다중 선택 · 재료 탭 칩·대표 · 담당자가 열 주소 · DM 탭 폭 토글 · 회신 편집 | tsc · build:safe |
| **T5 루프·관측** | `assembleOutreachDm`/`publishOutreachDm` 분리 · 자동 재조립 1회(updateDm) · auto_seq · `callOutreachAi` · ai_cost · 근거 패널 1줄 (+ 별건 `onUsage` 커밋은 선택) | 벽시계 테스트 · 발행 1회 · 금액 영향 0 |
| **T6 학습** | recipe(bindings) · `appendStageResultArray` · edits(reason) · 승격 라우트·화면 | 원문 0 검사 · pg_constraint 확인 뒤 |
| **T7 고객 입구** | `normalizeQuickEventCards` · `materialsFromEventCards` · read=0 · reads 견적 · 카드 화면 · 폭 토글 · 몰 상품 경로(+버튼) | 골든 group 미지정 바이트 동일 · 견적 = 차감 일치 |
| **T8 문서·배포** | FEATURE 불변 34~39 + 개정 5 · SCHEMA 키 사전 · STATUS · 배포 → 아이소이 재생성 375폭 캡처 대조 | 캡처 전후 대조 보고 |

배포 단위 = T0+T1 한 배포(값이 바로 나오고 되돌릴 것이 가장 적다) · T2~T3(+T2.5) 한 배포 · T4 이후 순차. DDL 0 · ENV 0 · 워커 코드 변경 0.

---

## 14. 미검증 · 실측 항목

- 아이소이 이벤트 목록 HTML 구조(카드 컨테이너 · 기간 줄 형식 · 렌더 필요 여부). 픽스처는 실물 저장본.
- `best_copy_assets`·`sales_outreach_assets` 제약 실측(§11 SQL).
- 내부 회사 플랜 `ai_calls_per_month`(companyId 주입 판단용 · 이번 판 미주입).
- `PRODUCT_DETAIL_BUDGET_MS` 값 · 블록 최소 요건 임계(375폭 전장 캡처 3건) · 채점 항목 회귀 주입 1회(배포 전 수동).
- 공개 샘플 리미터 사내 다수 열람 재현.
- 렌더 팔레트가 아이소이에서 채도 있는 색을 잡는가 · 홈 첫 화면 375 캡처 품질.
- 이메일 클라이언트 600폭에서 text_card 대조 2장 표시(검수 메일 1건).
- `updateDm` 으로 섹션을 갈아끼웠을 때 발행 상태·short_code 가 유지되는가(자동 재조립 경로 · dm-builder 계약 확인).

---

## 15. 범위 밖(등재만)

- `ProductCarouselItem.badges` 신설 · 섹션 최상위 `provenance` 키(둘 다 8자리 한 커밋 조건 · 착수 = 렌더러·편집기가 실제로 읽어야 할 때).
- 담당자 체험 링크(비로그인 실행) · 블록 단위 재생성(안정 섹션 id 선행) · 공개 샘플 리미터 코드별 상한 · 이미지 뱃지(픽셀) 전사 · 카드별 판독 호출(견적 곱셈).
- vision 호출 companyId 주입(내부 회사 월 한도 실측 뒤).

---

## 16. 회의론자 최종 검증(수렴안 대상 · 검증자 2인 · 전부 본문에 반영)

### 16-1. 깨지는 지점과 막은 형태(요약 · 상세 근거는 `meeting_v3/verify_all.txt`)

| # | 심각 | 깨지는 지점 | 막은 형태(본문 반영 절) |
|---|---|---|---|
| 1 | high | 관측: `recordAiCall` 은 companyId 없이 무기록 · `callAIWithFallback` 은 usage 미반환 · companyId 를 넣으면 이중 계상 | `callOutreachAi` 가 호출 수를 스스로 셈 · ai_cost 토큰 제외 · `onUsage` 콜백 별건(§7-9 · 불변 38) |
| 2 | high | gallery 0: 계약·허용 타입이 두 입구 공용 상수 1벌 · 골든은 generate 를 픽스처로 갈아끼워 그 구간을 못 본다 | `dmSectionContract(entry)` · `OUTREACH_DM_TYPES_OUTREACH` · 계약 테스트 2줄(§7-2) |
| 3 | high | fill 시그니처: EngineDeps.fill 3인자 · 이메일은 엔진을 안 타고 fill 직접 · 고객 이메일 갤러리 소실 위험 | fill 4인자(entry 마지막 · 기본 customer) · ProduceDmInput.entry 필수(§7-2) |
| 4 | high | 카드 배너 사본이 확인 화면 시점에 없음 · 이벤트 페이지 HTML 이 배너 후보 합집합에 없음 → §7-1 hero 불성립 | cardBannerUrls 합집합(뒤) · 사본은 srcUrl 매칭 · 확인 화면은 원 URL(§5-1) |
| 5 | high | 팔레트 목적 렌더가 `rendered` 에 담기면 재료 원문·재대조·행사 상세 렌더 분기가 전 사이트에서 이동 · 불변 28 충돌 · viewportWidth 미지정(1280 캡처) | 별 변수 `paletteShot` · 팔레트·캡처 2자리만 · 375 고정 · `escalation.escalate && rendered` · 불변 28 개정(§5-4 · §4) |
| 6 | high | 4키 복구가 스프레드 한 줄로는 운영에서 안 실림(상세 1홉 파서 5키 · 상세 우선 병합) | listByKey 병합 · 행동 테스트 입력 정정(§5-3) |
| 7 | high | 히어로 원천 = 배너 풀 · 풀을 안 쓰면 카드 배너 hero 불능 · invariants:346 문자열 · 골든 :74 | EngineMaterials.eventCards · 히어로 순서(카드 사본 → galleryAll[0] → …) · 풀은 유지 · 문자열 이관 · 골든 두 케이스(§7-2) |
| 8 | high | 자동 재조립이 불변 1 과 정면 충돌 · 새 stage_results 키 8개가 RESETTABLE_KEYS 밖(타입 단계에서 막힘 · recrawl 뒤 잔존) | 불변 1 개정 후보 · 8키 등재 · 진입점별 clear · 스캔 1줄(§4 · §7-8) |
| 9 | high | 배너 전사 폴백이 `extractEventsFromImages` 재사용 = companyId 필수 · creditCost 3 · 레이트리밋 결합(§3-1 이 거부한 것) | 로컬 `transcribeBannerLines`(§5-2) |
| 10 | medium | 자동 재조립 = createDm+publishDm 재호출 = 살아 있는 공개 주소 2개 · 중지 경로 미도달 | assemble/publish 분리 · 2회차는 updateDm(§7-8) |
| 11 | medium | 증거 카드 위치 표(8행)와 코드(첫 묶음 직후) 불일치 · 이미지 text_card classic 고정으로 lead/framed 서수 변화 | 표를 코드에 맞춤 · 서수 설명 · 골든 단언 확인(§7-1) |
| 12 | medium | 면허 없는 카드 제목(예: 최대 50% 기획전)을 hero.headline 원문으로 실으면 차단기가 prop 째 비워 업체명 대체 + HERO_FALLBACK 상시 | `headlineFromCard`(§7-1) |
| 13 | medium | fill 4번째 인자 필수화 시 3인자 직접 호출 테스트 12곳 깨짐 · 기본값이 계약 | 마지막 인자 · 기본 customer · 새 테스트 1건(§7-2) |
| 14 | medium | T 순서: T3 이 selectedList(T4) 전제 · T1 대조 2장 왼쪽이 T2 값 · colorSource 'neutral' 미생산 · QualityInput 색 필드 0 | T0 신설 · T2.5 · T1 범위 조정 · colorSource 4값(§13 · §5-4) |
| 15 | medium | 카드 상세 1홉이 confirm 뒤면 재료 게이트(analyzing 1회 계산)가 옛 thin 으로 남아 MATERIAL_THIN 이 뒤집힘 | analyzing 안 · 면허 있는 카드 상위 2(§5-1 · 불변 18 개정) |
| 16 | medium | 섹션 최상위 provenance 는 공용 닫힌 타입 변경 = badges 와 같은 8자리 잣대 · 자기 모순 | recipe.bindings 로 이동 · 최상위 키 §15(§9) |
| 17 | low | `extractEventCards` 동명(extract.ts 사설) | `extractEventListCards` · 사설은 `sliceEventBlocks`(§5-1 · T0) |

### 16-2. 빈칸(GAP)과 채움

| # | 빈칸 | 채움(절) |
|---|---|---|
| 1 | 히어로 비율 0.8 상수·소유·dims 없음 판정 | `OUTREACH_HERO_MIN_RATIO` · `heroEligible` fail-closed · 테스트 3(§7-5) |
| 2 | 절단 상한 N 없음 · FEW_SECTIONS(6)와 sections_enough(9~13) 관계 | `OUTREACH_SECTION_MAX = 13` · 임계 9 · 축 구분 문장(§7-1 · §7-6) |
| 3 | confirm 정규화(우선순위 · 절단 · 중복 · 범위 밖 · eventIndex 폐기) | 한 문단 명세 + 테스트 4(§6-1) |
| 4 | 불변 34 계약 테스트의 판정 함수·자리 · EventCandidate.origin 'card' 소비처 | `assertLicensedQuoteSources` · bannerLines 지역 변수 · 소비처 3곳(§5-2 · §4) |
| 5 | edits[] 동시성(얕은 병합 = 배열 통째 덮임) | `appendStageResultArray` CT · 스캔 1줄(§9) |
| 6 | 채점 항목 회귀 주입이 수동 절차 | 파리티 테스트 4조건 · 수동 주입은 §14(§7-7) |
| 7 | buildMaterialsV2 소유 누락 · subHtml 지역 변수 · event_list 저장 자리 | render.ts 행 · 선언 위치 · renderKeys(§5-1 · §12-1) |
| 8 | 카드를 조립까지 나르는 타입 0 · text_card case 없음 · countdown end_datetime 주체 없음 | EngineEventCard · ProduceDmInput.eventCards · fill `case 'text_card'` · countdown 채움(§11) |
| 9 | confirm 배선 4곳(라우트 · OutreachSelection · 분기 · UPDATE 리터럴) | §6-1 |
| 10 | licensedQuote 결합의 자리(jobs.ts:895) | §6-1 |
| 11 | read=0 · reads 견적(호출 1회 3크레딧 고정) · 카드별 licensed · 이미지 상한 5 | wantRead · reads>0 ? 1건 · `normalizeQuickEventCards` · 카드당 3장(§10) |
| 12 | 자동 재조립 뒤 updateDm 이 발행 상태·short_code 를 유지하는가 | 실측 항목(§14) |

### 16-3. 판정

두 검증자 모두 "설계서가 인용한 코드 사실은 실측과 맞다. 그러나 수렴안 그대로는 T1 의 일부만 구현 가능하고 나머지는 배선이 빠졌거나 순서가 뒤집혔다"고 냈다. 위 17건과 12건을 본문에 반영한 이 판이 구현 대상이다. 남은 판단 보류 = 내부 회사 월 한도(companyId 주입) · 블록 최소 요건 임계 · 상세 홉 예산 값 · 리미터(전부 §14 실측 항목).

---

## 17. 구현 기록(2026-09-06 · 같은 세션 · T0~T8) · 설계 대비 편차

### 17-1. 결과

- **코드**: 백엔드 tsc 0 · 프론트 tsc 0 · vitest 전체 3,908건 통과(신규 `sales-outreach-v3.test.ts` 28건 · 골든 2벌 갱신 · 계약 문자열 이관 6곳). DDL 0 · ENV 0 · 워커 코드 0.
- **배포 단위**: T0~T8 한 배포(같은 세션에서 전부 만들었고 중간 상태를 배포하지 않는다). `tp-push` → `pm2 reload targetup-backend`(워커 재시작 불필요). 프론트 빌드 동반.
- **파일**: 백엔드 12(`campaign-engine` · `sales-outreach-{produce,jobs,media,render,look,exemplars,extract,review,style}` · `campaign-quick` · `best-copy-assets`) · 라우트 2(`sales-outreach` · `event-campaigns`) · 프론트 4(`SalesOutreachModal` · `QuickCampaignPage` 재작성 · `EventCardsInput` 신설 · `audit-action-labels`) · 테스트 8(v3 신설 + 7 갱신).

### 17-2. 설계 대비 편차(전부 의도 · 이유 함께)

| 절 | 설계 | 구현 | 이유 |
|---|---|---|---|
| §7-2 | `OutreachGenInput.entry` 필수 | 타입은 필수(`entry: EngineEntry`) · `dmSectionContract(entry)` 는 undefined 를 customer 로 읽는다 | 옛 3인자 호출 테스트 12곳(타입 검사 밖)이 그대로 옛 계약을 받아야 한다 |
| §7-6 · §11 | `stage_results.dm_block_gate` | **dm asset payload `blockGate`**(회차마다 자연히 갈린다 · RESETTABLE_KEYS 미등재) · 품질 경고는 `QualityInput.blockShort` 로 읽는다 | 회차 산출물의 판정은 그 회차 asset 에 두는 선례(visionScore) · 별 UPDATE 1회 절약 |
| §7-8 | 재캡처 0 | **재캡처 1회**(워커 409 = 첫 캡처 유지) · vision 잡당 ≤2 | 저장된 채점이 발행본과 일치해야 한다(첫 캡처는 갈아끼운 전 화면) |
| §5-4 · 불변 28 | 얇음 판정이 승격을 안 했을 때만 팔레트 렌더 | **항상 1회**(`paletteShot` · 12초 · 별 변수) · 팔레트는 rendered 우선 · 홈 캡처는 여기서만 | SPA(아이소이)처럼 승격된 사이트가 정확히 대조 왼쪽 그림이 필요한 사이트다 · 렌더 1회 예외는 같다 |
| §5-1 | 카드 상세 1홉 = analyzing 안 | **crawl 단계 안**(subHtml 직후 · brand_profile 저장 전) | 재료 게이트(analyzing)보다 앞이라는 요건은 같고, brand_profile 을 두 번 쓰지 않는다 |
| §5-2 | 전사 줄 = 지역 변수 · 배너를 "실을 때" 캡션 | 전사 줄로 **폴백 행사 카드**(`bannerCardsFromTranscripts` · 면허 0 · 링크 = 코너)를 만들어 같은 13행 표준을 탄다 · dm asset `bannerFallback: true` | 이미지 경로가 하나(카드 → text_card+cta)라 gallery 0 이 유지된다 |
| §7-1 | 표 12행 CTA 라벨 = 코드 | 목적지가 홈일 때만 모델의 목적지 이름형 라벨을 살린다 | 코드 라벨은 목적지(카드3·코너)가 정해졌을 때만 뜻이 있다 |
| §7-1 | 상품 6 = 2+4 | 풀이 정확히 3이면 첫 묶음 3(focus) · 둘째 묶음은 4 아니면 2(홀수 0) · 스포트라이트 상품은 묶음에서 뺀다(같은 이미지 2회 = 채점 no_duplicate_image false) | 홀수 금지 + 중복 이미지 0 |
| §9 | 승격 = ceo 버튼 | 아웃리치 운영자 게이트(`assertOperator`)만 · 라우트 `/promote-recipe` | 운영자 = ceo 1인 · 별 게이트 축을 만들지 않는다 |
| §10 | 고객 카드 이미지 3장 전부 카드 블록 | 첫 장 = 배너(히어로·카드) · 나머지 ≤2 = **카드 제목 캡션 갤러리**(고객 계약은 gallery 허용) · 카드 본문은 히어로 아래 글자 카드 | 이미지마다 같은 제목 카드를 3번 세우면 반복 · 고객 입구 계약(캡션 있는 갤러리)은 "설명 없는 이미지 0" 을 만족한다 |
| §10 | 판독 = 카드 대표 이미지 묶음 1회 | 내용이 빈 카드들의 대표 이미지만 묶어 1회 · 읽은 글은 첫 빈 카드의 내용으로 · `read=0` 업로드 + 별건 판독 호출 | 판독 구조(events)가 카드에 1:1 로 매핑되지 않는다 · 1회 3크레딧 계약 유지 |
| §6-2 | 브랜드 색 접힘 카드(다음 판) | 확인 대기 1줄 경고 + 고객 페이지 브랜드 줄(표시만) | 설계대로 이번 판은 경고만 |
| §12-1 | `sales-outreach-exemplars` 이메일 계약 | 아웃리치 브랜드 이메일은 **허용 타입에서 gallery 제거**(`OUTREACH_EMAIL_TYPES.filter`) · 계약 문자열 무변경 | 이메일 계약 문자열은 고객 입구 이메일이 공유한다 · 허용 타입만 가르면 gallery 0 이 성립 |
| §13 | T0+T1 / T2~T3 / T4~ 배포 3회 | 한 배포 | 같은 세션 완결 · 중간 상태 미배포 |

### 17-4. 구현 뒤 읽기 전용 적대 리뷰(Explore 3렌즈 → 반박 검증 · 2026-09-06) — 확인 15(중복 포함 · 뿌리 8) · 전부 정정

| # | 뿌리 | 형태 | 정정 |
|---|---|---|---|
| R1 | `assertLicensedQuoteSources` 가 정당한 겹침(전사 줄은 크롤 원문 재대조 통과분 = 면허 인용과 겹치는 게 보통)에 throw → producing_dm 실패 | high | 가드를 **출처 검사**로: 전사 수치가 근거(quoteBasis) 안에 있으면 그 출처가 선택 후보 인용문·사실 수치여야 한다(겹침 정상 · 출처 없는 섞임만 throw) |
| R2 | 카드 배너 사본이 영영 안 받아짐(후보 꼬리 index ≥24 · `pickStoredImagesDetail` 시도 24·통과 8 상한) → 카드 히어로 불성립 · 포스터도 생략 | high | `collectOutreachMedia.cardBannerUrls` **전용 예산**(≤6 · 폭 ≥400 · 20초) · 갤러리 뒤에 붙인다(홈 첫 배너 규칙 유지) · stats `cardBannersTried/Passed` |
| R3 | `eventCardsOf` 가 사람이 뺀 재료(mediaSelection)를 무시 → 뺀 배너가 히어로로 재등장 | medium | `applyOutreachMediaSelection` 을 거친 media 로 카드 사본을 되찾는다 |
| R4 | 폴백 히어로 = `galleryAll[0]` 이 카드가 이미 가진 배너 → 같은 이미지 2회(채점 no_duplicate_image false) | medium | 폴백은 카드 배너 집합을 피한다(`cardBannerSet`) |
| R5 | 재료 게이트 banners 가 홈 배너만(카드 상세 1홉 배너 미포함) → 화면 숫자 ≠ 게이트 숫자 | medium | `allBanners` 하나를 저장·게이트가 함께 본다 |
| R6 | 원클릭 업로드 응답을 순번으로 카드에 재배치 → 서버가 형식 판별로 1장 빼면 다음 카드로 밀림 | medium | **카드마다 업로드 1요청** · 빠진 장수 토스트 |
| R7 | 카드 "내용 있음" 판정(≥10자)이 체크박스 활성 조건(비어 있지 않음)과 어긋남 → 짧은 문구가 판독으로 덮이고 면허 탈락 | medium | 판정 하나(비어 있지 않음) |
| R8 | 파기가 뷰포트 캡처(홈 · DM 첫 화면)를 안 지움 | medium | `purgeOutreachJobArtifacts` 가 `brand_profile.homeCaptureUrl` · dm asset `captureUrl` 도 unlink |
| R9 | 재료 재선택 회차에 `auto_seq` 잔존 → 자동 재조립 0회(검증자는 기각했으나 수용) | low | `selectOutreachMaterials` clear 에 `auto_seq` |

### 17-5. 첫 실측(아이소이 · 2026-09-06 배포 직후) 결과와 정정

실측 SQL 결과 = `event_list no_content · crawling_cards null · palette_render no_content · colorSource neutral · n_cards 0 · ai_calls 11 · home_capture f`. 주재자가 아이소이 실물 DOM 을 열어 원인을 특정했다(브라우저 도구 · 읽기만).

| 원인 | 실측 사실 | 정정 |
|---|---|---|
| 목록 페이지 주소 | 홈에 이벤트 **목록** 으로 가는 `<a>` 가 없다(메뉴가 앵커가 아닌 SPA) · `findEventPageLink` 가 첫 상세 링크(`/event/202609/cream_diy_event`)를 골라 카드 0 · 실제 목록 = `/event/event_list`(같은 몰 `/hotdeal/hotdeal_list` 관례) | `findEventListLinks`(순수): 목록형 경로 앵커 → 옛 첫 매치 → **관례 주소 3개**(`/{seg}/{seg}_list` · `/{seg}` · `/{seg}/list` · 상세 링크 3개 이상이 같은 첫 세그먼트일 때) · 크롤이 최대 3개를 순서대로 시도해 카드가 나오면 멈춘다(`render_meta.eventListTried`) |
| 카드 상한 · 기간 없는 카드 | 실물 카드 7장(기간 6 + OUTLET 기간 없음) · 실물 DOM = `<li>` 안 `<a><img></a>` + 형제 `<span class=…tit>` + `<span class=…date>기간 : … 까지</span>` | 상한 6 → 8 · 기간 없는 카드는 링크가 행사성이면 받는다(면허 0) · **실물 HTML 을 픽스처로 고정**(`__tests__/fixtures/isoi-event-list.html` · 7장 · 제목·기간·배너 절대 URL) |
| 팔레트 렌더 비었음 | 예산 12초 = SPA 첫 화면 전에 종료(워커는 남은 시간 1.5초 미만이면 캡처를 건너뛴다) | 예산 25초(본 렌더와 같다) |
| 브랜드 색 neutral | 아이소이 계산 스타일에 채도 있는 큰 면이 없다(핑크 뱃지 1개뿐) · theme-color 0 · 아이콘 = `.ico`(PNG 0) · 헤더 로고 = `logo_blk.png`(검정) | 헤더 로고 PNG 를 4순위 색 원천으로(지배색 1개 · 픽셀 사용 0) · 아이소이는 그래도 neutral 이 맞다(흑백 브랜드) |

### 17-3. 배포 뒤 실측(Harold)

1. 아이소이 재크롤 → 확인 대기에서 **행사 카드 격자**(이벤트 목록 카드 N건 · 배너·기간·상세)가 뜨는가 · `stage_results.event_list` 가 `ok` 인가 · `palette_render` 3값 · `brand.colorSource` 4값.
2. 카드 2개 선택 → 제작 → DM 375폭 캡처: gallery 0 · 카드1 배너 히어로 + 제목·기간 · 카드2 이미지 카드 + 버튼 · 상품 2+4 · 증거 카드 · 마지막 버튼 목적지.
3. 근거 패널 "이 건에 쓴 AI 호출 N회 · 자동 재조립 n/1" · `stage_results.ai_cost` 실재.
4. 제안 메일 검수 발송 1통: 1막 대조 2장(홈 캡처 왼쪽 · DM 캡처 오른쪽 · 220px 열) · 마지막 카드 회신 문장 · gallery 0.
5. 원클릭 캠페인: 카드 2개(각 이미지 2장 · 하나는 내용 비움) → 견적에 판독 1회 → 제작 → 시안 · 크레딧 차감 = 견적.
6. §11 SQL 은 이미 실측(PK 만 · CHECK 4값) → 레시피 승격 1회 → `best_copy_assets` kind `recipe` 1행.
