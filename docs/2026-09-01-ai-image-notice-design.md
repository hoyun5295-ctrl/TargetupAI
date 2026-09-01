# AI 생성 이미지 표시 (브랜드 메시지) — 설계서

> **호출어 = "AI 이미지 표시"**
> 상태 = **1단계 구현 완료 · 배포 대기**(2026-09-01 Harold 승인: 전략 A + 발송 화면 전면 재설계 병행 · §9).
> 이 문서 하나만 읽으면 착수 가능하도록 썼다. 코드 위치·판정 규칙·미확정 항목·착수 순서가 전부 여기 있다.

---

## 0. 한 줄 요약

한줄로가 **AI로 생성한 이미지**를 카카오 브랜드 메시지로 보낼 때, 카카오 가이드가 요구하는
**"AI 생성물 표시"**가 우리 발송물에 하나도 붙지 않는다. 문안에 안내 문구를 자동으로 붙여 닫는다.

---

## 1. 왜 하는가 (경위)

### 1-1. 카카오 가이드 신규 조항

2026-09-01 Harold가 카카오비즈니스 「브랜드 메시지」 가이드를 정독 지시. 4-2절에 이 문장이 있다.

> 생성형 인공지능을 활용하여 소재를 제작하거나 생성한 경우, [인공지능기본법] 및 심사 가이드를 준수해야 하며,
> **이용자가 이를 명확히 인지할 수 있도록 안내 문구 또는 워터마크를 삽입해야 합니다.**
> 표시하였음에도 허위·과장광고 우려가 있는 경우 **메시지 발송이 제한될 수 있습니다.**

가이드 최종 갱신 = 조회 시점 기준 26일 전. **신규 조항이다.**

### 1-2. AI 기본법과 다른 축이다 (혼동 주의)

memory `reference_compliance_2026_regulatory_status`에 AI 기본법 의무 3이 정리돼 있고
**생성물 표시는 "미이행 · 계도 2027-01까지"**로 잡혀 있다. 그래서 여유가 있어 보이지만 **이 건과 다르다.**

| | AI 기본법 | 카카오 브랜드 메시지 |
|---|---|---|
| 성격 | 법정 의무 | 카카오 심사 기준 |
| 기한 | 계도 2027-01 | **지금 적용** |
| 위반 시 | 계도 | **발송 제한** |
| 표시 방향 | 메타데이터 + 반출 시 1회 안내 + UI 고지(이미지에 문구 X) | **안내 문구 또는 워터마크** |

⛔ **법 계도기간을 근거로 미루면 안 된다.** 카카오는 계도를 주지 않는다.

### 1-3. 딜러사(휴머스온) 확인 — 2026-09-01 박성용 과장

Harold가 직접 문의해 받은 답변. **이것이 이번 설계의 요건 확정 근거다.**

- **문안은 아직 카카오에서 별도로 잡아내지 않는 것 같다** → 문안 자체의 AI 생성 표시는 현재 대상 아님
- **이미지는** ①제미나이·GPT에서 워터마크가 박혀 있거나 ②**문안에 `*AI로 생성된 이미지 입니다` 같이 삽입**한다
- **휴머스온에서 별도로 제한하는 건 없다**

⇒ **대상 = 이미지뿐. 방법 = 문안 내 안내 문구.** 문안 생성은 이번 범위가 아니다.

---

## 2. 확정 사실 (조사 완료분)

### 2-1. 우리는 표시를 전혀 안 넣고 있다

`워터마크|watermark|AI 생성|생성형|인공지능기본법` 전 소스 grep = **관련 구현 0건**
(검색에 걸린 것은 전부 "AI 생성 실패" 같은 무관한 문자열).

### 2-2. 이미지 생성 = Gemini

`utils/image-studio.ts:26` → `GEMINI_IMAGE_MODEL = 'gemini-3-pro-image'`

딜러사가 말한 "제미나이" 쪽이라 **원본에는 SynthID 워터마크가 들어간다.** 그러나 이것을 근거로 삼지 않는다.

⛔ **후처리를 거친다.** `composeImage`로 타이포를 덧그리고, 채널별로 크롭·패딩하고,
MMS는 1080px·300KB로 재인코딩한다(`docs/FEATURE-IMAGE-STUDIO.md` §2-6·§3).
**이 변형 뒤에도 SynthID가 남는지 미검증**이고, 애초에 비가시적이라 육안 심사에서는 없는 것과 같다.
검증 도구도 구글 쪽에 있어 우리가 확인할 수단이 없다.

### 2-3. AI 생성 여부 판정 = 이미 가능하다 (DDL 0)

`cdp_assets.kind` = `uploaded` / **`generated`** / `nukki` / `variant` (SCHEMA.md 2372행)
`cdp_assets.prompt` = AI 생성물 프롬프트 · `cdp_assets.source_asset_id` = 누끼·변형본의 원본 계보

⇒ **`kind='generated'`가 AI 생성물.** 새 컬럼이 필요 없다.

### 2-4. 발송 시간·(광고) 표시는 이미 충족

- 08:00~20:50 창 = `config/defaults.ts:223` (조립 후 차감·적재 중 20:50을 넘길 것까지 계산한 마감 여유 포함)
- (광고) 표시 = `AD_FLAG: 'Y'/'N'`으로 카카오에 전달(문자와 달리 본문에 직접 넣지 않는다)

### 2-5. 타입 커버리지 = 9종 중 8종

가이드 9종 중 **카탈로그만 미지원**. 나머지 8종은 `BUBBLE_TYPES`(`brand-message.ts:156`)에 있다.
카탈로그 수요는 미확인 — 이번 범위 밖.

---

## 3. ⛔ 결정적 제약 — 본문이 없는 타입이 있다

`BUBBLE_TYPES`의 `maxMessage` 실측값이다. **문안 삽입 방식은 여기서 절반이 막힌다.**

| 타입 | 이미지 | maxMessage | maxNewline | 문구 삽입 |
|---|---|---|---|---|
| TEXT | 선택 | 1300 | 99 | 가능 |
| IMAGE | **필수** | 1300 | 29 | 가능 |
| WIDE | **필수** | **76** | **5** | 가능하나 빠듯 |
| PREMIUM_VIDEO | 동영상 | 76 | 5 | 가능하나 빠듯 |
| **COMMERCE** | **필수** | **0** | 0 | **불가** |
| **CAROUSEL_FEED** | 카드마다 | **0** | 0 | **불가**(카드 message는 있음) |
| **CAROUSEL_COMMERCE** | 카드마다 | **0** | 0 | **불가**(카드 message 사용불가) |
| **WIDE_ITEM_LIST** | 아이템마다 | **0** | 0 | **불가**(header 20자만) |

**이미지를 쓰는 타입의 절반이 본문 0자다.** 그리고 WIDE는 76자 중 안내 문구가 약 5분의 1을 먹는다.

여기서 §1-2의 두 방향이 충돌한다. 본문 0자 타입은 **이미지에 그리는 것 말고 방법이 없는데**,
우리 AI 기본법 대응 방향은 "이미지에 문구 X"였다. **이 충돌의 해소는 2단계로 미룬다**(§5).

---

## 4. 설계 — 1단계 (이번에 만들 것)

### 4-1. 범위

**본문이 있는 4개 타입**(TEXT · IMAGE · WIDE · PREMIUM_VIDEO)에 한정해,
**AI 생성 이미지가 첨부된 경우** 본문 끝에 안내 문구를 자동으로 붙인다.

### 4-2. 문구

```
*AI로 생성된 이미지입니다
```

딜러사가 제시한 형태를 그대로 쓴다(심사 기준에 맞춰 통용되는 표현).
앞에 줄바꿈 1개를 두므로 **본문 소모 = 줄바꿈 1 + 15자**.
⚠ `charLen`(`brand-message.ts:710`)이 세는 방식과 `maxNewline` 소모를 **구현 시 실측 확인**할 것.

### 4-3. 판정 규칙

1. 발송 파라미터에서 **이미지 URL을 모은다** — `params.image?.img_url` · 캐러셀 아이템 · 아이템 리스트 등
   (필드 전수는 `buildAttachmentBody`(1159행)·`buildCarouselJson`(1292행)이 소비하는 것과 같은 집합)
2. 그 URL로 `cdp_assets`를 조회해 **`kind='generated'`가 하나라도 있으면** 대상
3. 본문에 **이미 같은 문구가 있으면 붙이지 않는다**(중복 방지 · 재발송·템플릿 경로 고려)

⛔ **`uploaded`에는 붙이지 않는다.** AI가 만들지 않은 이미지에 AI 생성이라 적으면 그것이 거짓 표시다.
⛔ `nukki`·`variant`는 **1단계 대상에서 뺀다.** 배경 제거는 AI를 쓰지만 "새로 그린" 것이 아니라 판단이 갈린다.
   가이드의 예외 문구("생성형 AI 미사용 단순 편집만")로도 단정이 어렵다. 필요해지면 `source_asset_id` 계보를 따라간다.

### 4-4. 삽입 지점

**`sendBrandMessage`(`brand-message.ts:1426`)에서 `buildBrandQueuePayload`를 호출하기 전에 `message`를 보강한다.**

이유가 있다. `buildBrandQueuePayload`는 **순수 조립 함수**이고 DB를 보지 않는다.
AI 생성 판정은 `cdp_assets` 조회가 필요하므로, DB를 볼 수 있는 async 발송 함수에서 처리하고
조립기는 순수한 채로 둔다. 조립기에 DB를 들이면 그 함수의 테스트 가능성이 무너진다.

신규 CT는 `utils/brand-message.ts` 안에 두되, 에셋 조회는 기존 `utils/assets.ts`를 재사용한다
(인라인 SQL 금지 · CLAUDE.md `no_inline_duplication`).

### 4-4-1. ⛔ 템플릿 경로는 본문을 건드릴 수 없다 (구조 제약)

`sendBrandMessageTemplate`(1548행)은 `buildBrandQueuePayload`에 **`message`를 넘기지 않는다**(1568~1591행 실측).
넘기는 것은 `messageVariableJson`·`couponVariableJson`뿐이다. **본문은 카카오에 등록된 템플릿이 소유**하고
우리는 변수만 채운다. 즉 **발송 시점에 문구를 덧붙일 자리가 없다.**

⛔ 1단계 배선은 **`sendBrandMessage` 한 곳뿐이다.** 템플릿 경로에 같은 코드를 넣으려 하면 안 된다.

템플릿 경로에서 AI 이미지를 쓰는 경우의 처리는 **미정**이다. 선택지는 둘.
- 템플릿을 카카오에 등록할 때 본문에 문구를 포함(운영 규칙 · 코드 아님)
- 변수 슬롯에 문구를 끼워 넣기(템플릿이 그 자리를 갖고 있어야 성립)

참고로 템플릿 경로는 `imageVariableJson`을 **현재 거부한다**(1555행 — "기본형은 본문 변수·쿠폰 변수만 지원").
이미지는 `params.image`로 첨부되므로 **첨부는 되고 본문만 못 건드리는** 상태다.

### 4-4-2. ⛔ 판정 근거가 약하다 — 편집기가 URL 텍스트 입력이다

`BrandMessageEditor.tsx:406`이 이미지를 **자유 텍스트 URL 입력**으로 받는다.
라이브러리에서 고르는 UI가 아니다(`<input type="text" value={imageUrl}>`).

그래서 §4-3의 "URL로 `cdp_assets`를 조회한다"가 **그대로는 성립하지 않는다.**

- `cdp_assets.url` = `/api/cdp/inapp/image/{companyId}/{filename}` (상대 경로)
- 브랜드 메시지 `img_url` = 카카오가 직접 내려받아야 하므로 **외부 접근 가능한 절대 URL**
- 사용자가 외부 URL을 그대로 붙여넣을 수도 있다

**판정 전략 3안 — 착수 시 하나를 고른다.**

| 안 | 방법 | 장단 |
|---|---|---|
| **A (권장)** | 편집기에 **라이브러리 선택 UI 추가** + `assetId`를 함께 전달 | 판정이 확실하다. 프론트 작업이 붙는다 |
| B | URL **경로 끝(파일명) 기준 매칭** | 코드는 작다. 외부 URL·파일명 충돌에 취약해 오탐·미탐이 남는다 |
| C | 사용자가 "AI 생성 이미지" 체크 | 추가 입력 요구라 `marketing_user_ux_priority` 위반. **채택 금지** |

⚠ **A를 고르면 이 작업은 백엔드만의 일이 아니다.** 착수 전 Harold 확인 필요.
B로 시작하고 A로 올리는 것도 가능하나, B 상태에서는 **"판정했다"고 단정하면 안 된다**(미탐이 남는다).

### 4-5. 길이 초과 처리

문구를 붙여 `maxMessage`·`maxNewline`을 넘기면 조립기가 거부해 **발송이 실패한다.**
그대로 두면 사용자는 이유를 모른다.

**처방**: 붙이기 전에 초과 여부를 계산하고, 초과하면 **사유가 분명한 에러**를 돌려준다.

```
AI 생성 이미지 안내 문구를 포함하면 본문 글자 수를 넘습니다. 본문을 N자 줄여 주세요.
```

⛔ 문구를 빼고 발송하는 폴백을 만들지 않는다. 표시 없이 나가면 이 작업의 목적 자체가 사라진다.

### 4-6. 회귀 0 조건

- AI 생성 이미지가 없으면 본문이 **한 글자도 바뀌지 않는다**
- `uploaded` 이미지만 있으면 붙지 않는다
- 이미 문구가 있으면 두 번 붙지 않는다

### 4-7. 함께 봐야 하는 경로 (빠뜨리기 쉬운 곳)

**① 대체발송(resend)** — 브랜드 메시지는 미도달 시 문자로 대체 발송된다
(`resolveBrandFallback` 538행 · `resendMessage`·`resendTitle`).
카카오 심사 대상이 아니므로 **문자 대체본에는 붙이지 않는다**가 1단계 방침이다.
⚠ 단 대체발송이 **MMS로 그 이미지를 함께 보내는 경우**라면 AI 기본법 축(§7)에서 다시 봐야 한다.
착수 시 `resolveBrandFallback`이 이미지를 싣는지 실측할 것.

**② 미리보기** — 편집기 미리보기에 문구가 안 보이면 사용자는 발송 후에야 알게 된다.
본문 길이 계산도 미리보기 기준으로 하므로, 여기에 반영하지 않으면 §4-5 길이 초과 에러가
"쓰지도 않은 글자 때문에" 나는 것처럼 보인다. **프론트 반영이 1단계에 포함돼야 한다.**

**③ 테스트 발송** — 테스트도 실제 카카오를 지나므로 **같은 규칙을 적용한다**.
테스트만 빼면 "테스트는 됐는데 본발송이 막히는" 상태가 된다.

**④ 캐러셀 카드 일부만 AI** — 카드 5장 중 1장만 생성물이면 문구를 붙일지.
**하나라도 있으면 붙인다**가 방침이다(표시 누락보다 과표시가 안전).
단 캐러셀 2종은 본문이 0자라 1단계 범위 밖이다(§3).

---

## 5. 2단계 (이번에 하지 않음 · 판단 대기)

**본문 0자 타입 4종**(COMMERCE · CAROUSEL_FEED · CAROUSEL_COMMERCE · WIDE_ITEM_LIST)의 처리.

선택지는 셋이고 **아직 정하지 않았다.**

1. **이미지에 문구를 그린다** — `composeImage`에 작은 안내 문구를 함께 렌더. 모든 타입에 통하지만
   이미지 스튜디오 산출물 **전체**에 영향을 준다(DM·이메일·MMS·인앱). AI 기본법 대응 방향("이미지에 문구 X")과 충돌
2. **해당 타입은 AI 이미지 사용 시 차단** — 안전하지만 기능이 줄어든다
3. **그대로 둔다** — 딜러사가 "제한 없다"고 했으므로 당장 문제가 안 될 수 있으나, 심사 기준이 바뀌면 그대로 노출

**판단에 필요한 것 = 실사용 분포.** 그 타입들을 실제로 쓰고 있는지 모르면 정할 수 없다.

⚠ **`campaigns.message_type`으로는 안 나온다** — 2026-09-01 조회 결과 0행.
브랜드 메시지는 MySQL 큐의 카카오 필드(`k_etc_json`·`k_template_code`)로 적재되므로 거기서 봐야 한다.
버블 타입은 `k_etc_json` 안에 있다. 조회 SQL은 착수 시 `brand-message.ts`의 적재 규약을 보고 작성할 것.

---

## 6. 착수 순서

**0. 먼저 Harold 확인 — §4-4-2 판정 전략 A/B 중 무엇으로 갈지.** A면 프론트 작업이 범위에 들어온다.
   이걸 정하지 않고 시작하면 만들어 놓고 다시 만든다.

1. `resolveBrandFallback`(538행)이 대체발송에 **이미지를 싣는지 실측** (§4-7-①의 갈림길)
2. `cdp_assets` 조회 CT 확인 — `utils/assets.ts`에 URL·id 기준 조회가 있는지. 없으면 거기에 추가
   (라우트·발송 파일에 인라인 SQL 금지 · `no_inline_duplication`)
3. 이미지 URL 수집 함수 — `buildAttachmentBody`(1159행)·`buildCarouselJson`(1292행)이 소비하는 필드 집합과 **같은 곳**을 본다
4. 문구 부착 함수 + 길이 초과 판정 (`charLen` 710행이 세는 방식·`maxNewline` 소모 실측)
5. **`sendBrandMessage` 한 곳에 배선** (⛔ 템플릿 경로는 구조상 불가 — §4-4-1)
6. 프론트 미리보기 반영 (§4-7-②)
7. 회귀 테스트 — §4-6 세 조건 + 본문 있는 타입 4종 각각 + 길이 초과 에러 + `uploaded` 미부착
8. **결함 주입 검출 확인** — 부착 분기를 죽였을 때 테스트가 실제로 깨지는지
9. 게이트 = backend tsc 0 · frontend tsc 0 · vitest 전량 · 프론트 production 빌드 · BUGS/SoT 등재

**DDL 0.** `cdp_assets.kind`가 이미 있어 스키마 변경이 없다.

### 6-1. 착수 전 실측할 것 — ★2026-09-01 전량 확정 (구현 세션 실측)

| 무엇 | 확정 결과 |
|---|---|
| 판정 전략 A/B | **A 확정**(Harold) + 발송 화면 전면 재설계 병행. 목업 승인 = `docs/mockups/2026-09-01-brand-send-redesign-mockup.html` |
| 대체발송의 이미지 동반 여부 | **동반 경로 자체가 없다.** `resolveBrandFallback`은 N/A/B만 허용하고 MM(MMS)은 throw. 반환 타입에 이미지 필드도 없다 → §4-7-① 방침(문자 대체본 미부착) 그대로 확정 |
| `charLen`의 계산 방식 | 코드포인트(`[...s].length`). **`\n`도 1자로 maxMessage에 포함** → 문구 소모 = maxMessage 16자 + maxNewline 1(§4-2의 "줄바꿈 1 + 15자" 표현을 정정) |
| 본문 0자 타입 실사용 | **구조적 0건 확정.** `BUBBLE_TYPE_OPENED` 게이트가 TEXT·IMAGE·WIDE만 개통(그 외는 조립기가 거부)이라 MySQL 조회 불필요. §5 2단계는 해당 유형 개통 시점에 판단 |

### 6-2. ★2026-09-01 배선 실측 정정 — §6-5 "sendBrandMessage 한 곳"의 실제 커버리지

`buildBrandQueuePayload` 직접 호출부가 sendBrandMessage 밖에 4곳 있다(전수 grep).

| 호출부 | 이미지 | 1단계 문구 |
|---|---|---|
| `/brand-send` 자유형 → sendBrandMessage | 가능 | **부착(배선 완료)** |
| `/brand-send` 기본형 → sendBrandMessageTemplate | 가능 | 구조상 불가(§4-4-1) · 화면이 기본형+AI 이미지 조합에 안내 띄움 |
| 테스트발송 campaigns.ts:429 | **attachmentJson 자체를 안 실음** | 대상 아님(이미지 없음) |
| AI캠페인 campaigns.ts:1017 · 직접발송 2374 · 예약청크 direct-send-processor.ts:170 | `kakao_attachment_json` 경유 가능 | **미배선 — 추가 과제**(그 경로에 asset_id 축이 없다. 실사용 실측 후 판단) |

---

## 7. 이번 범위가 아닌 것 (기록만)

- **문안(텍스트)의 AI 생성 표시** — 딜러사 확인상 현재 카카오가 잡지 않는다. 바뀌면 재개
- **카탈로그 타입 미지원** — 9종 중 유일한 미지원. 수요 미확인
- **성인인증 채널·연령인증 메시지** — `adult` 필드가 알림톡 경로에만 있고 브랜드 메시지 경로에는 없다.
  주류·전자담배 업종 고객사가 생기면 필요
- **AI 기본법 ②사전 고지 · ③생성물 표시 전면 대응** — 계도 2027-01. 채널 전체(DM·이메일·MMS·인앱)가 대상이라
  이 문서(브랜드 메시지 한정)보다 범위가 넓다. memory `reference_compliance_2026_regulatory_status`가 소유

---

## 8. 참조

| 무엇 | 어디 |
|---|---|
| 브랜드 메시지 조립·발송 CT | `packages/backend/src/utils/brand-message.ts` (BUBBLE_TYPES 156 · charLen 710 · buildAttachmentBody 1159 · buildCarouselJson 1292 · resolveBrandFallback 538 · **sendBrandMessage 1426** · sendBrandMessageTemplate 1548) |
| 발송 라우트 호출부 | `packages/backend/src/routes/campaigns.ts:3508` |
| **편집기(이미지 입력)** | `packages/frontend/src/components/BrandMessageEditor.tsx` (URL 텍스트 입력 406 · image 조립 285) |
| 이미지 생성 엔진 | `packages/backend/src/utils/image-studio.ts` (`GEMINI_IMAGE_MODEL` 26행) |
| 이미지 스튜디오 구조 | `docs/FEATURE-IMAGE-STUDIO.md` |
| 에셋 원장 | `status/SCHEMA.md` `cdp_assets` 절 (2363행~) · CT = `utils/assets.ts` |
| 발송 시간 창 | `packages/backend/src/config/defaults.ts:216~232` |
| 규제 현황(AI법·계도기간) | memory `reference_compliance_2026_regulatory_status` |
| 원본 가이드 | 카카오비즈니스 「브랜드 메시지」 가이드 4-2 · 5절 |

---

## 9. ★2026-09-01 1단계 구현 기록 (전략 A + 화면 전면 재설계)

### 9-1. 백엔드

- `utils/brand-message.ts` — `BRAND_AI_IMAGE_NOTICE`(문구 상수) · `isBrandImageAiGenerated`(판정:
  **발송 실물 img_url 단일 축** — Codex 1R H1 수용으로 asset_id의 kind를 믿는 초안을 폐기했다.
  id와 URL을 엇갈리게 보내면 표시 우회/거짓 표시가 됐기 때문. 자사 서빙 경로(상대 = 정확 접두 ·
  절대 = 신뢰 호스트(HANJUL_BASE_URL·PUBLIC_BASE_URL 파생) + pathname 접두)만 `getAssetByUrl` 정확
  일치로 조회하고 그 행의 kind가 판정 전부다. asset_id는 "라이브러리에서 골랐다"는 주장으로만 쓴다:
  주장 + 행 없음 = 거절. 외부 URL = false. 조회 오류 = fail-closed 거절, cdp_assets 미생성 환경만 false)
  · `appendAiImageNotice`(순수 부착: 빈 본문 무변경 · **말미 독립 줄일 때만 멱등**(1R M2 — includes
  판정은 본문 중간 언급으로 부착이 생략됐다) · 길이/줄바꿈 사전 판정, 초과 시 몇 자 줄일지 포함 거절,
  문구 생략 폴백 없음)
- 배선 = `sendBrandMessage` try 블록 맨 앞(조립·차감 앞). **대체발송(`resolveBrandFallback`)은 원본
  본문으로 확정** — 문자 대체본에 문구가 새지 않는다(소스 계약 테스트로 고정)
- `BrandImage.asset_id` 추가 — `buildAttachmentBody`가 img_url·img_link만 투영하므로 카카오 전문에 안 샌다
- `utils/assets.ts` — `getAssetByUrl`(URL 정확 일치 단건) · `storeAssetFile`(실물 저장 + kind='uploaded' 등재)
- `routes/assets.ts` — `POST /api/assets/upload` 신설(authenticate만: 브랜드 발송이 요금제 무관이라
  인앱 업로드의 관리자+유료 게이트를 재사용하면 죽은 버튼이 된다. multer 2MB·확장자/mime 화이트리스트·
  플랜별 저장 한도)
- 테스트 = `brand-message.test.ts` 3블록 16건(부착 경계·판정 조합·소스 계약). **결함 주입 검출 확인**:
  부착 분기를 지우면 소스 계약 테스트가 깨진다(실측). campaigns.message_content는 원본 본문 유지(의도:
  사용자가 쓴 본문. 발송 실물은 큐 msg_contents가 진실)

### 9-2. 프론트 (승인 목업 기준 전면 재작성)

- `BrandMessageEditor.tsx` — 이미지 입력 3방식(라이브러리 픽커+asset_id / 업로드 / URL 직접 입력),
  AI 생성 배지, 본문 카운터 +16 반영(코드포인트 계산 `cpLen`으로 backend charLen과 동일 자), 줄바꿈
  카운터 신설, 사전 차단 사유, 유형 카드 규격 힌트, 접이식 값 요약, 하단 고정 발송 바(수신자·유형·광고·
  대체·AI 안내 요약), 버튼명 길이 거울(maxBtnName) 신설. **이미지는 이미지 유형에서만 payload에 싣는다**
  (옛 코드는 유형 전환 후 남은 imageUrl이 TEXT 발송에 따라갔다)
- `BrandMessagePreview.tsx` — `aiNoticeText` prop: 본문 아래 "자동 추가" 표시와 함께 문구 렌더
- `AssetLibraryPickerModal.tsx` — `showKindBadge` optional prop(미전달 호출부 무변화): generated 타일에
  "AI 생성" 배지 + 하단 안내 1줄
- `BrandSendModal.tsx` — 에디터 래퍼 패딩 제거(발송 바 sticky) + recipientCount 전달
- 수용한 간극: URL 직접 입력으로 자사 라이브러리 AI 이미지 주소를 붙여넣으면 **백엔드만 부착**(화면
  미리보기에는 안 보임 · kind 근거가 없어서). 초과 시 백엔드가 사유 있는 오류로 알려준다

### 9-2-1. Codex 적대 리뷰 (1R: high 4 · medium 2)

| 지적 | 처리 |
|---|---|
| H1 판정이 asset_id와 실제 img_url을 결합하지 않음 + toOwnAssetPath 중간 매칭 | **수용·구조 정정** — 판정을 발송 실물 URL 단일 축으로(§9-1). 엇갈림 조합·적대 host 테스트 추가 |
| H2 업로드 fail-open(용량 조회 오류 무시·등재 실패 흡수) | **부분 수용** — 용량 조회 실패 = 503/500 fail-closed, 등재 실패 = 파일 회수 + 오류. 원자적 용량 예약은 불수용(B-0901-1 ②) |
| H3 기본형 전환 후 숨은 자유형 문안이 대체발송으로 실발송 가능 | **수용** — payload 모드별 투영 + 기본형 대체발송 문안 필수 사전 차단. (옛 편집기부터 있던 결함이 재작성 파일에 승계된 것 — 재작성 범위라 즉시 수정) |
| H4 늦게 끝난 업로드가 최신 이미지 선택을 덮음 | **수용** — 이미지 소스 세대 가드(imageSeqRef) |
| M1 업로드 바이트 미검증 | **기록** — [BUGS B-0901-1 ①](../status/BUGS.md) (기존 인앱 라우트와 공통 과제) |
| M2 본문 중간 문구로 부착 우회 | **수용** — 말미 독립 줄 멱등 판정(백엔드 + 프론트 거울 + 테스트) |

**2R (high 2 · medium 1 · 범위 밖 1) — 라운드 상한 2회로 종결:**

| 지적 | 처리 |
|---|---|
| H1a 자사 경로 + 행 없음이 asset_id 생략만으로 fail-open | **수용** — 자사 경로 행 없음 = 무조건 거절(테이블 미생성 환경만 false). asset_id는 판정에서 완전 제외 |
| H1b trailing-dot 호스트(`hanjul.ai.`) 우회 + scheme 미검증 | **수용** — 호스트 정규화(소문자 + root dot 제거) + http/https 화이트리스트. 회귀 테스트 추가 |
| M1 등재 실패 보상 삭제가 불확정 커밋을 못 다룸 | **부분 수용** — 파일 삭제 전 행 재확인(커밋이면 성공 반환) + unlink 실패 로그. 잔여 = [BUGS B-0901-1 ③](../status/BUGS.md) |
| 범위 밖: 기본형 LM 대체발송 제목 공란 미차단 | **정정** — LM 제목 사전 차단을 기본형·자유형 blockReason에 추가(백엔드 거절 문구와 동일 문장) |

### 9-3. 추가 과제 (기록만 · 착수 판단 = Harold)

1. AI캠페인·직접발송 재실행·예약청크 경로(§6-2)의 문구 부착 — `kakao_attachment_json`에 asset_id 축 신설 필요
2. cdp.ts 인앱 업로드 라우트의 `storeAssetFile` CT 수렴(현재 저장 로직 두 벌)
3. WIDE 권장 해상도 표기 — 화면은 800×400 안내 유지 중. 매뉴얼 실측값 확인 후 유형별 분기(미검증)
4. 이미지 스튜디오 산출물에 브랜드 채널 규격(channel_spec) 태그 — 픽커에서 브랜드 적합 이미지 우선 노출
