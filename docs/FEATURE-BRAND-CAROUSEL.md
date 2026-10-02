# 브랜드메시지 캐러셀(피드 · 커머스) 자유형 발송 (기능 상설 문서 · 2026-10-01 신설)

> **호출어 = "캐러셀 커머스" / "브랜드 캐러셀" / "캐러셀 3024"**. 이 문서가 캐러셀 2종(CAROUSEL_FEED · CAROUSEL_COMMERCE) 자유형 발송의 **규격 위치 · 소스 위치 · 재오픈 때 조사 순서 · 실측 원장 · 이력**을 소유한다. 버그 대장([BUGS](../status/BUGS.md) B-0922-3 · B-0923-2 · B-0923-3)에는 포인터만 있다.
> 브랜드메시지 전체(접속 · 4101 · 계약 정정 · 단가 · 게이트웨이)는 [FEATURE-GW-BRAND-MESSAGE.md](bito-gateway/FEATURE-GW-BRAND-MESSAGE.md)가 소유한다. 자유형 5종 개통 경위 = 버그 대장 B-0920-1 · [0828 인계](2026-08-28-gw-brand-5types-handoff.md). 문서와 코드가 다르면 **현재 코드가 진실**이다.

---

## §0 30초 요약

- **캐러셀 피드**: 운영 성공 실측 있음(0920 `SMSQ_SEND_15` seqno 115652 `1800`).
- **캐러셀 커머스**: 운영 성공 실측 **0건**. 접수 한 건(박성용 `cmuc0buy…`)이 관문을 하나씩 넘으며 세 번 다시 열렸다 — 0922 우리 검사가 막음(상품 정보) → 0923 카카오 1030(카드 버튼 0개) → 1001 카카오 3024(카드 이미지 비율 불일치).
- **지금(1001 23:37 배포)**: 서버가 카드·인트로 이미지를 올리기 직전에 전 장을 같은 픽셀 크기로 맞춘다. **카카오가 실제로 받는지는 미검증** = 시험 발송 1건(§6).
- **교훈**: 성공 실측이 한 번도 없는 유형의 처방은 가설이다 · 거절 코드를 건마다 다시 본다([LESSONS_BACKEND](../status/lessons/LESSONS_BACKEND.md) 핵심 원칙 첫 줄).

## §1 규격 — 원문 위치와 지켜야 하는 것

- **원문 파일**(로컬 · 절대 경로는 [FEATURE-GW-BRAND-MESSAGE](bito-gateway/FEATURE-GW-BRAND-MESSAGE.md) 「규격 파일 절대경로」 절): `attachment_method.pdf` §3.4(자유형 ATTACHMENT — 버튼·이미지·커머스) · §5.3(자유형 CAROUSEL) / `휴머스온 IMC-Agent 메뉴얼 v2.3.1.pdf` §6.9(기본형 캐러셀) · §6.11(자유형 캐러셀 · 160~163쪽) / 결과코드 = `휴머스온 IMC-Agent 결과코드 v2.3.1.xlsx`.
- **캐러셀 공통**: 인트로(head)는 커머스에서만 · 카드 수 = 인트로 있으면 1~5 · 없으면 2~6 · 카드마다 이미지 필수 · 카드 버튼 1~2개(§6.11.3) · 더보기(tail) 선택.
- **커머스 카드**: 헤더·메시지 사용 불가 · 부가 정보 34자 · 상품(`commerce`) = 상품명 30자 · 정상가 · 할인가가 있으면 할인율 또는 정액 할인 중 하나 필수.
- **피드 카드**: 헤더·메시지 필수 · 부가 정보·상품 사용 불가.
- **이미지**: 카카오 콘텐츠 서버에 올린 주소만(`img_url`) · 권장 800×600 또는 800×400 · 비율 2:1~3:4 · **「캐러셀 커머스는 전체 이미지 비율이 동일해야 함」**(attachment_method.pdf §3.4 이미지 요소).
- **우리가 원장으로 옮겨 둔 값** = `brand-message.ts BUBBLE_TYPES` · `CAROUSEL_COMMON`(화면 사본 = `constants/brand-message-spec.ts` · 일치 계약 = `brand-spec-parity.test.ts`).

## §2 소스 위치 (「소스 읽어」 하면 여기부터)

| 축 | 파일 | 볼 곳 |
|---|---|---|
| 규격 원장 | `packages/backend/src/utils/brand-message.ts` | `CAROUSEL_COMMON` · `BUBBLE_TYPES`(CAROUSEL_FEED · CAROUSEL_COMMERCE · `itemButtonMin`) |
| 조립 · 검사(차감 앞) | 같은 파일 | `buildBrandQueuePayload`(큐 `k_etc_json` 조립) · `assertBrandContentSpec` · `assertCarouselSpec` · `assertCommerceRequired` · `assertCommerceRange` · `buildCarouselJson` |
| 발송 순서 | 같은 파일 | `sendBrandMessage` — AI 생성 이미지 판정 → **이미지 확정(올리기)** → 조립·검사 → 차감 → 큐 적재 |
| 이미지 올리기 · 같은 크기 맞춤 | `packages/backend/src/utils/brand-image-resolver.ts` | `resolveBrandSendRichImages`(캐러셀 가지) · `prepareCarouselSameSize` · `planCarouselSameSize` · `CAROUSEL_RATIO_TOLERANCE`·`CAROUSEL_FIT_WIDTH`·`CAROUSEL_MIN_WIDTH` · `resolveOne`(회사·경로·허용 목록 검사 · 올린 기록 `kakao_image_uploads`) · `ROUTES`(올리기 창구 6개) |
| 카카오 올리기 호출 | `packages/backend/src/utils/alimtalk-api.ts` | `uploadBrandCarouselCommerceImages` · `uploadBrandCarouselFeedImages` · `extractImageListFromAnyShape` |
| 큐 폭 | `packages/backend/src/utils/sms-queue.ts` | `getEtcJsonCapacity`(비토 라인 13~15 = 8192) |
| 발송 라우트 | `packages/backend/src/routes/campaigns.ts` | `sendBrandMessage` 호출부 |
| 발송 창(화면) | `packages/frontend/src/components/BrandMessageEditor.tsx` · `components/brand-send/BrandRichSections.tsx` | 유형별 입력 칸 · 카드 탭 · 버튼 줄(`ButtonRows`) |
| 화면 검사 · 전송 모양 | `packages/frontend/src/components/brand-send/brandRich.ts` | `richBlockReason`(보내기 전 걸리는 것) · `richPayload` · `fitCarouselCards` · `toggleCarouselIntro` · `carouselRefRatio` |
| 화면 이미지 규격 | `packages/frontend/src/components/brand-send/brandImageSpec.ts` · `BrandImageSlot.tsx` · `useBrandImageGuard.tsx` | `BRAND_IMAGE_RULES.carousel` · `RATIO_TOLERANCE`(1%) · `sameRatio` · `judgeBrandImage` · `planBrandImageFit` |
| 화면 규격 사본 | `packages/frontend/src/constants/brand-message-spec.ts` | 캐러셀 값(`itemButtonMin` 등) |
| 템플릿 등록 화면(기본형) | `packages/frontend/src/components/alimtalk/BrandTemplateForm.tsx` | 캐러셀 카드 입력 · 카드 버튼 최소 검사(카드끼리 비율 검사는 없다) |
| 게이트웨이(별도 저장소 `bito-gateway`) | `internal/gateway/connector/humuson_imc/payload.go` | `CAROUSEL` 값을 가공 없이 그대로 넘긴다(`normalizeJSONishValue`) · 결과코드표 = `migrations/053_kakao_result_codebook_completion.sql` |
| 계약 테스트 | `packages/backend/src/utils/brand-carousel-spec.test.ts` · `brand-image-resolver.test.ts`(「캐러셀 커머스 — 전 장 같은 크기 맞춤」) · `__tests__/brand-rich-carousel.test.ts` · `__tests__/brand-spec-parity.test.ts` | |

## §3 재오픈이 오면 — 조사 순서(추측 금지 · 1001 에 실제로 쓴 순서)

1. **큐 행**: 실패 건의 실제 적재값을 본다. 서버에서 `smsuser` 직접 접속은 거부된다(1001 실측 2회 — 비밀번호 입력 · 컨테이너 환경값 모두 `ERROR 1045`). 지금 도는 백엔드와 같은 접속으로 조회한다(발신 키는 출력하지 않는다).

```bash
cd /home/administrator/targetup-app/packages/backend && npx ts-node --transpile-only <<'TS'
import { mysqlQuery } from './src/config/database';
(async () => {
  const rows: any = await mysqlQuery("SELECT seqno, msg_instm, mobsend_time, status_code, k_etc_json FROM SMSQ_SEND_15 WHERE seqno >= 326208 AND msg_type = 'F' AND k_etc_json LIKE '%CAROUSEL_COMMERCE%' ORDER BY seqno DESC LIMIT 4");
  for (const r of rows) {
    let j: any = null; try { j = JSON.parse(r.k_etc_json); } catch { j = null; }
    console.log(JSON.stringify({ seqno: r.seqno, msg_instm: String(r.msg_instm), status_code: r.status_code, bubble: j && j.CHAT_BUBBLE_TYPE, tgt: j && j.TARGETING, keys: j ? Object.keys(j) : '파싱 실패', CAROUSEL: j && j.CAROUSEL }, null, 1));
  }
  process.exit(0);
})().catch((e) => { console.error('실패', e.message); process.exit(1); });
TS
```

2. **거절 코드**: 한줄로 큐에는 `9999`(화면 「기타 오류」)만 남는다. 카카오 사유는 **게이트웨이 콘솔 > 메시지 상세**의 표준 코드로 본다(`KAKAO_1030_INVALID_PARAMETER` · `KAKAO_3024_MESSAGE_INVALID_IMAGE` 등). 접수 시각·수신번호로 찾는다.
3. **이미지**: 3024 면 올린 기록(`kakao_image_uploads` — 창구 · 원본 파일명 · 용량 · 시각)과 서버 원본 파일의 실제 가로·세로를 잰다(원본 = `INAPP_IMAGE_PATH` 또는 `packages/backend/uploads/inapp/<회사>/<파일>`). 큐 행 `CAROUSEL.list[*].attachment.image.img_url` 을 `image_url = $1` 로 찾고 `sharp(...).metadata()` 로 잰다(1001 에 쓴 스크립트 모양 = 위 1번과 같다 · `import { query }` + `require('sharp')`).
4. **규격 대조**: §1 원문과 적재값을 키 단위로 맞춰 본다. 게이트웨이는 캐러셀 값을 바꾸지 않으므로 적재값이 곧 휴머스온으로 가는 값이다.
5. **바꿔서 결과가 바뀌는가**: 발송 가능 시간(08:00~20:50)에 시험 계정(`BRAND_TRIAL_LOGIN_IDS`)으로 1건. 정황 일치는 원인이 아니다.

## §4 실측 원장 (Harold 실행분)

| 시각 | 큐 · seqno | 구성 | 결과 |
|---|---|---|---|
| 0920 19:57 | `SMSQ_SEND_15` 115652 | 캐러셀 **피드** · 카드마다 웹링크 버튼 · 대상 I | `1800` |
| 0920 20:32 | 115653 | 단일 커머스 · 웹링크 버튼 · 대상 I | `1800` · 실수신 |
| 0923 12:08 | 326208 | 캐러셀 커머스 · 인트로 있음 · 카드 2 · **버튼 없음** · 대상 M | `9999` · 콘솔 `KAKAO_1030_INVALID_PARAMETER` |
| 0923 12:13 | 326209 | 캐러셀 커머스 · 인트로 없음 · 카드 2 · **버튼 없음** · 대상 M | `9999` · 1030 |
| 1001 15:42 | 457376 | 캐러셀 커머스 · 인트로 없음 · 카드 2 · 카드마다 웹링크 버튼 1 · 이미지+링크 · 상품 · 부가 정보 · 대상 I | `9999` · 콘솔 `KAKAO_3024_MESSAGE_INVALID_IMAGE` |
| 1001 23:03 | (올린 기록 + 서버 원본) | 457376 의 카드 1 = 676×534 jpg(가로/세로 1.2659) · 카드 2 = 506×400 png(1.2650) · 둘 다 캐러셀 커머스 창구 | 비율 0.07% 차이 |
| 미실측 | | 같은 두 이미지를 맞춤 배포 뒤 재발송 | §6 |

## §5 이력 (버그 대장에서 옮김 · 원문 그대로)

### 5-1. 0922 — 화면 필수값을 다 채워도 「상품 정보가 필요합니다」(B-0922-3)

> 버그 대장 원문 제목: 🟠 B-0922-3 캐러셀 커머스: 화면 필수값을 다 채워도 「상품 정보가 필요 합니다」로 발송이 100% 막힌다 (🟡 0922 수정 · **DDL 0** · 미배포 · 실측 대기) — 2026-09-22 박성용 오류접수 `cmuc0buy2015ajnjf089dzl28`

- **★0923 재오픈** — 이 수정으로 검사는 넘어갔고, 버튼 없는 카드가 카카오 1030 으로 실패했다 → B-0923-3(이 절 맨 위).

- **재현(코드 · vitest)**: 화면이 보내는 형태 그대로(카드 2장에 상품명·정상가·버튼 · 말풍선 첨부 없음) `buildBrandQueuePayload` 를 부르면 `캐러셀 커머스: 상품 정보가 필요합니다`. 인트로를 켜도 같다. 대조 = 카드 구성이 같은 **캐러셀 피드는 통과**, 최상위 `commerce` 를 억지로 실으면 통과.
- **원인**: `assertBrandContentSpec` 의 `if (spec.requireCommerce)` 가 유형을 가리지 않고 **말풍선 최상위** `attachment.commerce` 를 요구했다. 캐러셀 커머스는 규격상 상품 정보를 **카드가 소유한다**(§5.3). 화면 4곳(`brandRich.ts` 2 · `BrandMessageEditor` · `BrandTemplateForm`)은 전부 `!carousel` 조건으로 최상위에 안 싣고 있었고 백엔드 이 자리만 빠져 있었다 — 느슨한 쪽이 아니라 **엄격한 쪽이 구멍**이었던 경우. 자유형만 해당(기본형은 값 미전송이 템플릿 위임으로 면제돼 통과).
- **곁들여 드러난 반대쪽 구멍**: `assertCarouselSpec` 카드 루프는 상품명이 **있을 때만** 길이를 봐서, 상품이 통째로 빈 카드가 그대로 큐까지 갔다. 최상위 검사를 캐러셀에서 빼면 그 구멍이 유일한 판정 자리가 되므로 한 묶음으로 닫았다.
- **수정**: ①최상위 조건을 `spec.requireCommerce && !spec.carousel` 로 좁힌다 ②카드 루프에 `spec.requireCommerce` 일 때 상품명·정상가 필수 ③두 자리가 쓰는 판정을 CT 안 헬퍼 `assertCommerceRequired(commerce, at)` 하나로 모은다(두 벌이면 한쪽이 통과시킨 것을 다른 쪽이 막는다 = 0902 이미지 판정과 같은 부류). 0원도 유효한 정상가라 falsy 가 아니라 타입으로 본다.
- **회귀 0 근거**: 기본형 면제를 `isFreeForm || attCommerce !== undefined` 로 옮겨 적어 기존 `required(present, ok)` 와 분기 결과가 같다(자유형 = 항상 검사 · 기본형 무값 = 면제 · 기본형 유값 = 검사). 단일 커머스(`COMMERCE`)는 `carousel` 이 없어 조건이 불변. 캐러셀 2종의 나머지 유형축(`requireImage`·`requireVideo`·`requireHeader`·`minButtons`·`maxButtons`·`maxHeader`·`maxAdditional`·`maxMessage`)은 전부 0·false 라 같은 어긋남이 없음을 전수로 확인했다.
- **계약**: `brand-carousel-spec.test.ts` +5건(조립기 경로 왕복 — 그전에는 `assertCarouselSpec` 을 직접 부르는 테스트뿐이라 이 자리가 안 보였다 · 결함 주입 확인 = 수정 전 4건 실패). 백엔드 vitest 344파일 5,281건 · tsc 0.
- **실측 시나리오(배포 뒤)**: 시험 계정(`BRAND_TRIAL_LOGIN_IDS`)으로 캐러셀 커머스 카드 2장(상품명·정상가·이미지·버튼)을 도달 불가 번호 1건에 발송 → ①화면이 거절 없이 접수되는지 ②큐 행의 `k_etc_json.CAROUSEL.list[*].attachment.commerce` 에 상품이 실렸는지 ③REPORT 코드. `0000` 이면 `BUBBLE_TYPE_OPENED` 승격 후보.
- **Codex 면제 근거**: DDL 0 + 쓰기 경로이나 0815 면제 3조건 충족(실측 1건이 곧 판정 · 그 유형 운영 트래픽 0 = 이 결함으로 100% 막혀 있었다 · 조립 실패가 차감 **앞**에서 닫힘).

### 5-2. 0923 — 인트로를 켜도 빈 카드 2가 발송을 막는다(B-0923-2)

> 버그 대장 원문 제목: 🟠 B-0923-2 캐러셀 커머스: 인트로를 켜도 빈 카드 2가 「카드 2: 이미지를 넣어 주세요」로 발송을 막는다 (🟡 0923 수정 · **DDL 0** · 미배포) — 2026-09-23 박성용 오류접수 `cmudj4mga01c6jniypt5glsc9` 「인트로 사용 시 카드는 1~6개 사용 가능하나 2개 사용 필수로 표기」

- **원인(코드)**: 유형을 고르면 카드가 인트로 미사용 최소(2장)로 깔리고, 인트로 토글이 카드 수를 건드리지 않아 손대지 않은 카드 2가 검사에 걸렸다. 판정(인트로 = 1장부터)은 맞았다. 같은 모양 = 템플릿 등록 화면.
- **수정**: `brandRich.ts` `fitCarouselCards`(끝쪽 빈 카드만 최소에 맞춤 · 입력한 카드 불변) · `isEmptyRichCard` · `toggleCarouselIntro` → 발송 창 · 등록 화면 인트로 체크박스.
- **최대 장수**: 접수 「인트로 사용 시 최대 6장」 ↔ 원장 1~5(휴머스온 매뉴얼 v2.3.1 §5.3 인용 · 문서 2곳). 근거 미확보라 바꾸지 않았다.
- **계약**: `brand-rich-carousel.test.ts` 10.

### 5-3. 0923 버튼 없는 카드 = 1030 → 1001 재오픈 = 3024 이미지(B-0923-3)

> 버그 대장 원문 제목: 🟠 B-0923-3 캐러셀 커머스: 버튼 없는 카드가 차감 뒤 카카오 1030(잘못된 파라미터)으로 실패 · B-0922-3 재오픈 (🟡 0923 수정 + ★1001 재오픈 수정(이미지 같은 크기 맞춤) · **DDL 0** · **배포 완료(1001 23:37 · Harold · 서버 소스·빌드 시각·백엔드 재기동 확인)** · 실측 대기 = 시험 발송 1건) — 2026-09-22 박성용 오류접수 `cmuc0buy2015ajnjf089dzl28` 재오픈(09-23 12:13 「발송은 되나 기타오류로 실패」)

- **실측(Harold 조회 · `SMSQ_SEND_15`)**: seqno 326208·326209 = `9999` · `mobsend_time` 기록(카카오 도달) · 게이트웨이 콘솔 표준 `KAKAO_1030_INVALID_PARAMETER`. 성공 대조 = 115652(캐러셀 피드 · 카드마다 WL 버튼 · 대상 I) · 115653(단일 커머스 · WL 버튼 · 대상 I). 조회 도구 기본 문자집합에서는 한글이 `????` 로 보인다(`--default-character-set=utf8mb4` 로 저장값 정상 확인).
- **변수 분리(같은 라인 브랜드 발송 전체 집계)**: 대상 M 은 같은 프로필에서 캐러셀 피드(115660)·이미지·텍스트·와이드·와이드 리스트가 성공 → 제외. 326209 는 인트로·부가 정보·이미지 링크가 없어도 실패 → 제외. 남은 차이 = 카드 버튼 0개. 단일 커머스는 규격상 버튼 최소 1개(`minButtons`).
- **수정**: 원장 `BrandCarouselSpec.itemButtonMin`(커머스 1 · 피드 0 = 근거 없음) → 조립기 `assertCarouselSpec` 자유형 카드 검사(기본형 면제 = 말풍선 `minButtons` 와 같은 규칙 · 차감 앞) · 프론트 규격 사본 · 파리티 축 · 발송 창 검사·안내(`brandRich`·`BrandRichSections`) · 등록 화면 검사·안내(`BrandTemplateForm`) · 같은 패턴 = 단일 커머스 말풍선의 「버튼 없이 보낼 수 있습니다」 문구(`BrandMessageEditor`).
- **미검증**: 버튼을 넣은 캐러셀 커머스가 실제로 `1800` 이 되는가(바꿔서 결과가 바뀐 확인 전) · 채널추가(AC) 버튼 단독 카드(단일 커머스 AC 단독 115661 은 `9999`).
- **실측 시나리오(배포 뒤)**: 시험 계정으로 캐러셀 커머스 카드 2장 · 카드마다 웹링크 버튼 1개 → `1800` 이면 원인 확정 · `BUBBLE_TYPE_OPENED` 승격 후보.
- **★1001 재오픈(박성용 15:43 「기타오류로 계속 실패 · 필수값 전부 입력」) — 버튼만으로는 안 닫힌다**: Harold 조회 = `SMSQ_SEND_15` seqno 457376(10-01 15:42:23 · 대상 I · 인트로 없음 · 카드 2장 · 카드마다 웹링크 버튼 1 · 이미지 `img_url`+`img_link` · 상품명·정상가·할인가·할인율 · 부가 정보) = `9999`. 적재값은 매뉴얼 v2.3.1 §6.11(자유형 캐러셀 · 인트로 선택 · 이미지 필수 · 버튼 1~2)의 키·필수와 어긋나는 자리를 찾지 못했다. **게이트웨이 콘솔(Harold 확인) = `KAKAO_3024_MESSAGE_INVALID_IMAGE`**(0923 의 1030 과 다른 사유 = 버튼으로 1030 은 넘었고 이미지에서 걸림 · 인트로·할인율 후보는 이 코드와 맞지 않아 제외). **카드 이미지 실측(Harold 실행 · `kakao_image_uploads` + 서버 원본)**: 카드 1 = 676×534 jpg(가로/세로 1.2659) · 카드 2 = 506×400 png(1.2650) · 둘 다 캐러셀 커머스 창구로 한 장씩 올라가 접수됨. 규격 원문 = 「캐러셀 커머스는 전체 이미지 비율이 동일해야 함」(attachment_method.pdf §3.4). 화면 검사는 「첫 이미지와 같은 비율」을 1% 오차까지 통과시킨다(`brandImageSpec.ts RATIO_TOLERANCE`) = 두 장이 같지 않은데 통과한 자리. 미검증 = 카카오가 요구하는 것이 「정확히 같은 비율」인지 「2:1·4:3 같은 정해진 비율」인지(같은 크기 두 장으로 보낸 실측 전).
- **★1001 수정(Harold 승인 · 배포 완료 1001 23:37)**: 올리는 함수(`brand-image-resolver resolveBrandSendRichImages` · 차감 앞)가 캐러셀 커머스의 이미지 자리(기준 먼저 = 인트로 → 카드)를 **전부 같은 픽셀 크기**로 맞춘 뒤 올린다(`planCarouselSameSize` · `prepareCarouselSameSize` · sharp 가운데 자르기 · 결과 가로 = 가장 작은 가로 · 상한 800 · 키우지 않음 · 이미 그 크기인 장은 바이트 그대로). 기준과 1% 넘게 다르면 한 장도 올리지 않고 「카드 N 이미지: 카드 1 이미지와 비율이 다릅니다」로 거절. 화면에서 둘째 장만 맞추는 방식은 반올림으로 다시 어긋나(676×534 기준 506 폭 = 400) 서버 한 곳에서 맞춘다. 손대지 않는 것 = 피드(운영 성공 중 · 규격이 비율 동일을 적은 유형은 커머스뿐) · 이미 올린 카카오 주소가 섞인 건(재발송·예약분) · 크기를 못 읽는 파일 · 최소 가로 500 미달 장이 섞인 건 · 이미 전 장 같은 크기. 계약 = `brand-image-resolver.test.ts` 「캐러셀 커머스 — 전 장 같은 크기 맞춤」 15(실측 두 장 → 506×400 두 장) · 오차·상한·최소 가로는 화면 값과 같음을 고정 · 변이 10종 검출 · backend tsc 0 · vitest 530파일 7,362건 · **Codex 적대 1R approve(지적 0 — 맞춘 버퍼 경로가 종전 검사를 건너뛰는지 · 일부만 올린 뒤 거절되는 순서 · 차감 앞 전제 · 수식의 키움·0·500 미만을 물음)**.
- **실측 시나리오(배포 뒤 · 발송 가능 시간 08:00~20:50 · 시험 계정 1건)**: 10-01 과 같은 두 이미지(676×534 · 506×400)로 캐러셀 커머스 재발송 → `1800` 이면 「정확히 같은 비율」 확정 · 또 3024 면 800×600 두 장으로 한 번 더 보내 정해진 비율 여부를 가른다. 확인 = `kakao_image_uploads` 의 두 장 `file_size` 와 게이트웨이 콘솔 표준 코드.
- [범위 밖 · 기록만] 한줄로 발송 결과 화면에는 `9999` = 「기타 오류」만 보이고 게이트웨이 표준 코드(3024 이미지 등)가 넘어오지 않는다(접수자 「상세 사유 알려 달라」의 원인) · 템플릿 등록 화면(`BrandTemplateForm`)에는 카드끼리 비율 검사가 없다(등록은 카카오가 사유를 돌려준다).
- **계약**: `brand-carousel-spec.test.ts` +4 · `brand-rich-carousel.test.ts`(발송 창) 3 · `brand-spec-parity.test.ts` 축 +1.

### 5-4. 1001 수정 요약 — 전 장 같은 픽셀 크기

- **자리**: `brand-image-resolver.ts resolveBrandSendRichImages` 의 캐러셀 가지(차감 앞). 커머스에만 건다(피드는 운영 성공 중 · 규격이 비율 동일을 적은 유형은 커머스뿐).
- **규칙**(`planCarouselSameSize`): 기준 = 인트로가 있으면 인트로 · 없으면 카드 1(화면 `carouselRefRatio` 와 같은 순서). 기준과 1% 넘게 다른 장이 있으면 한 장도 올리지 않고 거절. 전 장이 이미 같은 크기면 손대지 않는다. 그 밖 = 가로는 가장 작은 장(상한 800) · 세로는 가장 넓은 비율 기준 반올림이되 어느 장의 세로도 넘지 않음 · sharp 가운데 자르기 · 이미 그 크기인 장은 바이트 그대로.
- **넘기는 경우(종전 그대로)**: 자리 1개 이하 · 이미 올린 카카오 주소가 섞임(재발송·예약분) · 다른 회사 경로·경로 조작 · 크기를 못 읽거나 jpg·png 가 아님 · 최소 가로 500 미달 장이 섞임.
- **왜 서버인가**: 화면에서 둘째 장만 맞추면 반올림으로 다시 어긋난다(676×534 에 맞춘 506 폭 = 400 → 1.2650). 전 장을 같은 가로·세로로 만들 수 있는 자리는 올리는 함수 하나다.
- **검증**: 계약 15건(실측 두 장 → 506×400 두 장 · 디스크 원본 불변) · 변이 10종 검출 · backend tsc 0 · vitest 530파일 7,362건 · Codex 적대 1R approve(지적 0).

## §6 남은 것 · 범위 밖 (착수 판단 = Harold님)

- **시험 발송 1건(닫는 조건)**: 08:00~20:50 · 시험 계정 · 10-01 과 같은 두 이미지 → `1800` 이면 「정확히 같은 비율」 확정. 또 3024 면 800×600 두 장으로 한 번 더 보내 「정해진 비율(2:1 · 4:3)」 여부를 가르고 권장 비율 강제로 넘어간다.
- 한줄로 발송 결과 화면에는 `9999` = 「기타 오류」만 보이고 게이트웨이 표준 코드가 넘어오지 않는다(접수자 「상세 사유를 알려 달라」의 원인).
- 템플릿 등록 화면(기본형)에는 카드끼리 비율 검사가 없다(등록은 카카오가 사유를 돌려준다).
- 인트로 사용 시 최대 장수: 접수 「6장」 ↔ 원장 1~5(매뉴얼 §5.3 · §6.11) — 근거 미확보라 바꾸지 않았다(§5-2).
- 채널추가(AC) 버튼 단독 카드(단일 커머스 AC 단독 115661 = `9999`) 미검증.
