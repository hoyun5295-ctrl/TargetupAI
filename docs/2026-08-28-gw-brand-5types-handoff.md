# 게이트웨이 인계 — 브랜드메시지 자유형 5종 개통에 필요한 수정 3건

> **읽는 사람** = 비토 게이트웨이 세션(`C:\Users\ceo\projects\bito-gateway`).
> **쓴 사람** = 한줄로 세션. 이 문서는 **요청서**이고, 판단과 구현은 게이트웨이 세션이 소유한다.
> **성격** = 임시 문서. 3건이 배포되고 실측이 끝나면 결과를 [FEATURE-GW-BRAND-MESSAGE.md](bito-gateway/FEATURE-GW-BRAND-MESSAGE.md) §4로 옮기고 이 파일은 지운다.
> **선례** = 같은 형태의 지시서가 `docs/2026-08-15-brand-contract-fix.md`였다.

---

## 0. 30초 요약

한줄로가 브랜드메시지 **자유형 5종**(와이드 리스트·프리미엄 동영상·커머스·캐러셀 피드·캐러셀 커머스)을 여는 작업을 시작했다.
게이트웨이 코드를 실측해 보니 **그대로 열면 나가지 않거나 규격 밖으로 나가는 자리가 3곳** 있다.

| # | 자리 | 한 줄 |
|---|---|---|
| 1 | `payload.go:772` `normalizeTitleDescriptionObject` | 아이템 이미지 키 `img_url`을 **`image_url`로 바꿔서** 내보낸다. 브랜드 규격 키는 `img_url`이다 |
| 2 | `payload.go:201` `brandBaseItem` | `MESSAGE`를 **유형 불문 항상** 싣는다. 본문을 쓰지 않는 유형이 3종이고, 캐러셀 커머스는 규격상 **사용불가** 필드다 |
| 3 | `status/MESSAGE_RESULT_CODE_STANDARD.md` | 브랜드 REPORT 코드가 **미등재**다. 유형별 실측을 시작하면 원인 코드가 한줄로 화면에 오지 않는다 |

**1·2는 실측 전에 닫혀야 한다.** 안 닫으면 실패가 조용하다(아래 §1).

---

## 1. 왜 지금, 왜 이 순서인가

브랜드메시지는 **실패가 소리를 내지 않는 경로**다. 한줄로 조립기 머리 주석이 그것을 이렇게 적어 두었다
(`packages/backend/src/utils/brand-message.ts:21`).

> 형식이 어긋나면 큐에는 들어가고 발송만 오류 로그 없이 버려진다(차감은 되고 메시지는 안 감).

그래서 유형을 열기 전에 경계를 먼저 맞춘다. 조립기를 먼저 만들고 실측에 들어가면,
"형식은 맞는데 왜 안 나가지"를 다시 겪게 되고 그 상태에는 로그가 없다.
**0818에 `4101` 하나의 원인을 찾는 데 사흘이 걸린 것이 정확히 이 구조 때문이었다**(SoT §3).

한줄로 쪽 순서는 이렇게 잡았고, 게이트웨이 3건은 **2번 자리**에 있다.

```
1. 규격 CT 확장(한줄로)
2. ★ 게이트웨이 3건 ← 이 문서
3. 한줄로 조립기 확장
4. 등록 화면 전면
5. 유형별 실측 개방(1건씩)
```

---

## 2. 경계 계약 — 누가 무엇을 소유하는가

이 축의 기존 규율이다(SoT §4-2). **이번에도 그대로 지킨다.**

| 소유 | 내용 |
|---|---|
| **한줄로** | 규격 교정. 유형별 글자수·개수·필수 여부·필드 조합을 만드는 쪽에서 맞춘다 |
| **게이트웨이** | 통과와 전문 조립. 받은 값을 **규격 키 그대로** 프레임에 싣는다 |

> **게이트웨이는 브랜드 규격을 검증하지 않는다.** 유형별 길이·개수 검사를 게이트웨이에 넣지 말 것.
> 그건 한줄로가 적재 전에 한다(차감 전에 막아야 하므로).
> 이번 3건은 전부 **"통과가 통과가 아니게 되는 자리"**를 고치는 것이지 검증을 추가하는 것이 아니다.

⛔ **공용 함수를 그대로 고치면 알림톡·친구톡이 함께 바뀐다.** 아래 처방은 전부 **브랜드 경로 분기**를 전제로 적었다.

---

## 3. 수정 1 — 아이템 이미지 키가 바뀌어 나간다

### 현상

`normalizeTitleDescriptionObject`(`internal/gateway/connector/humuson_imc/payload.go:764`)가
아이템 객체를 정규화하면서 이미지 키를 **`image_url`로 통일**한다.

```go
setPayloadStringAlias(out, obj, "image_url", "image_url", "IMAGE_URL", "imageUrl", "img_url", "IMG_URL")
```

`img_url`로 들어온 값이 `image_url`이라는 **다른 이름으로** 나간다.

### 호출 경로 (브랜드도 이 길을 탄다)

```
buildKakaoAttachment            payload.go:280
  → normalizeGenericAttachment  payload.go:639
    → normalizeAttachmentBodyField("item")   payload.go:603
      → normalizeItemValue                   payload.go:792
        → normalizeTitleDescriptionList      payload.go:819
          → normalizeTitleDescriptionObject  payload.go:764   ← 여기
```

### 왜 이게 결함인가 (규격 근거)

브랜드 자유형 ATTACHMENT의 아이템 리스트 규격 키는 **`img_url`**이다.
출처 = `attachment_method.pdf` **§3.4 CAROUSEL - 브랜드 메시지 자유형**, `item.list` 항목.

```
item  list  title       Y  브랜드 메시지 아이템 타이틀
            img_url        친구톡 아이템 이미지 URL
            scheme_android / scheme_ios / url_mobile / url_pc
```

절대경로 = `C:\Users\ceo\OneDrive\문서\카카오톡 받은 파일\attachment_method.pdf`
(읽는 법 = `pdftotext -enc UTF-8`. SoT §3 「규격 파일 절대경로」에 3종 전부 등재돼 있다.)

**같은 표에 `description`은 없다.** 브랜드 아이템은 `title` + `img_url` + 링크 4종이 전부다.
`description`은 알림톡 아이템리스트 규격이고, 이 함수가 알림톡 기준으로 쓰였기 때문에 브랜드가 함께 걸린 것이다.

### 영향

**와이드 리스트(`WIDE_ITEM_LIST`)의 아이템 이미지가 전부 규격 밖 키로 나간다.**
휴머스온이 `img_url`을 찾는데 `image_url`이 오면 이미지가 없는 것으로 읽힌다.
아이템 리스트는 이미지가 본체인 유형이라 사실상 발송이 깨진다.

### 처방 방향 (판단은 게이트웨이 세션이 한다)

브랜드 경로에서는 **키를 바꾸지 않고 그대로 통과**시키는 것이 목적이다. 형태는 자유롭게 정하되,
알림톡·친구톡의 현재 동작은 **문자 단위로 보존**되어야 한다.

- 예: `normalizeItemValue`에 브랜드 여부를 넘겨 브랜드면 `img_url`을 유지
- 예: 브랜드 전용 정규화 함수를 분리

⛔ **`setPayloadStringAlias`의 별칭 목록에서 `img_url`을 빼는 방식은 위험하다.**
알림톡이 `img_url`로 들어오는 경로가 있으면 그쪽이 조용히 깨진다. 먼저 소비처를 전수 확인할 것.

### 미검증으로 남는 것

휴머스온이 `image_url`을 관용적으로 받아 주는지는 **확인한 적이 없다.**
받아 준다면 이 건은 결함이 아니라 무해한 변형이다. 다만 규격 문서는 `img_url`이라고 적고 있고,
브랜드는 규격을 벗어나면 무로그 폐기되는 경로라 **좁은 쪽(규격 그대로)으로 맞추는 것**이 이 축의 기존 규율이다.

---

## 4. 수정 2 — MESSAGE가 유형과 무관하게 항상 실린다

### 현상

`brandBaseItem`(`payload.go:189`)이 유형을 보지 않고 `MESSAGE`를 채운다.

```go
item["MESSAGE"] = firstNonEmpty(payloadString(payload, "MESSAGE", "message"), req.Message)
```

`req.Message`는 SMSQ `msg_contents`에서 온 값이다. 한줄로가 `MESSAGE`를 비워 보내도 **그 자리가 채워진다.**

### 왜 이게 결함인가 (규격 근거)

`attachment_method.pdf` §5.3 CAROUSEL 브랜드 자유형이 유형별로 **사용 가부**를 못 박고 있다.

| 유형 | header | message | additional_content |
|---|---|---|---|
| `CAROUSEL_FEED` | **필수** | **필수** | **사용불가** |
| `CAROUSEL_COMMERCE` | **사용불가** | **사용불가** | 사용 |

또한 본문 자체를 쓰지 않는 유형이 3종이다(한줄로 규격 CT `BUBBLE_TYPES` 기준 `maxMessage: 0`):
`WIDE_ITEM_LIST` · `COMMERCE` · `CAROUSEL_COMMERCE`.

즉 **캐러셀 커머스에 `MESSAGE`가 실려 나가는 것은 "값이 좀 남는" 문제가 아니라 규격 위반**이다.

### 영향

캐러셀 커머스 발송 시 사용불가 필드가 전문에 실린다. 휴머스온이 거부하면 실패이고,
무시하면 운이 좋은 것이다. **어느 쪽인지 우리가 모르는 상태로 실측에 들어가는 것이 문제다.**

### 처방 방향

`CHAT_BUBBLE_TYPE`을 보고 `MESSAGE`를 싣지 않는 분기.
`brandBaseItem`은 이미 `CHAT_BUBBLE_TYPE`을 세팅하고 있으므로(`payload.go:197`) 같은 자리에서 판정할 수 있다.

⛔ **어느 유형이 `MESSAGE`를 안 쓰는지의 목록을 게이트웨이가 갖는 것은 규격 검증에 가깝다.**
그 목록이 두 곳에 생기면 다음에 갈라진다. 두 가지 중 하나로 정할 것을 제안한다.

- **(가) 한줄로가 빈 값을 명시하고 게이트웨이는 `stripEmpty`에 맡긴다** ← 한줄로 쪽 선호
  이 경우 게이트웨이 수정은 `firstNonEmpty(..., req.Message)`의 **`req.Message` 폴백을 브랜드에서 빼는 것**으로 끝난다.
  한줄로가 `MESSAGE`를 안 넣으면 안 실린다.
- (나) 게이트웨이가 유형 목록을 갖는다 → 목록 이원화. 권하지 않는다.

**(가)로 가면 협업 계약이 하나 생긴다** → §6-1.

### 확인 부탁

`req.Message` 폴백이 **TEXT·IMAGE·WIDE에서 실제로 쓰이고 있는지** 확인이 필요하다.
지금 운영 중인 3종이 이 폴백에 의존하고 있다면 브랜드 전체에서 빼면 회귀가 난다.
한줄로 조립기는 자유형에서 본문을 `msg_contents`로 싣고 있어(`brand-message.ts:259`)
`payload.MESSAGE`가 비어 있을 가능성이 있다. **이 한 가지는 게이트웨이 쪽에서 봐 주셔야 한다.**

---

## 5. 수정 3 — 브랜드 REPORT 코드가 결과코드 표준에 없다

### 현상

브랜드 REPORT 코드(`4101` 계열)가 어디에도 개별 등재돼 있지 않아 **미지 실패로 접히고**,
한줄로 화면에는 `9999`가 온다.

접히는 자리는 `web/api/services/result-code.js:143` `standardCodeSql`이다.

```js
ELSE COALESCE(
  ${providerAlias}.standard_code,     // ← provider 매핑에 있으면 그 값
  CASE
    WHEN ${successSql(alias)} THEN ...
    ELSE 'V9000_UNKNOWN_FAILURE'      // ← 없으면 여기로 전부 접힌다
  END
)
```

즉 **provider 매핑에 행이 없는 실패 코드는 종류를 잃는다.** 브랜드 코드가 그 상태다.

| 층 | 위치 | 상태 |
|---|---|---|
| 판정 로직 | `web/api/services/result-code.js:143` | 미지 실패를 `V9000_UNKNOWN_FAILURE`로 접음 |
| provider 매핑 | `result_code_registry` (`migrations/027_result_code_registry.sql`) | 브랜드 코드 **미등재** |
| 문서 | `status/MESSAGE_RESULT_CODE_STANDARD.md` | 브랜드는 `KAKAO_*` 한 줄뿐 |

⚠ **문서만 고치면 동작은 그대로다.** 실제로 값을 가르는 것은 레지스트리 쪽이다.

### 왜 지금인가

**5종을 열면 유형마다 새 코드가 나온다.** 규격 위반의 종류가 유형 수만큼 늘어나기 때문이다.
그것이 전부 `9999`로 접히면 실측 5회가 전부 "안 나갔는데 이유를 모름"이 된다.

SoT §7이 이 축의 최대 교훈으로 적어 둔 문장이 이것이다.

> 대조군을 만드는 데 든 비용은 로그 3줄이었다. 알림톡에 같은 로그를 넣자 한 번의 발송 쌍으로 축이 즉시 닫혔다.

**이 건은 실측을 시작하기 전에 열려 있어야 값이 싸다.** 열고 나서 겪으면 그때부터 다시 사흘이다.

### 처방 방향

착수 원장 8번(SoT §6)에 이미 등재된 항목이다. 그 항목의 처방을 그대로 따르면 된다.
필요한 것은 **원시 코드가 한줄로까지 도달하는 것**이지 코드별 한글 문구가 아니다.
전량 등재가 부담이면 **미지 브랜드 코드를 원문 그대로 흘리는 통로 하나**만 있어도 이번 실측은 된다.

### 참고 자료

`4101 = SerialNumberPrefixDateException`은 PDF 매뉴얼이 아니라 **결과코드 xlsx 비즈메시지 시트**에 있다.
경로 = `C:\Users\ceo\OneDrive\문서\카카오톡 받은 파일\휴머스온 IMC-Agent 결과코드 v2.3.1.xlsx`
(PDF 코드표는 스스로 요약본이라고 밝힌다. SoT §3-0의 오판 기록 참조.)

---

## 6. 협업 지점

### 6-1. `MESSAGE` 계약 (수정 2가 (가)로 갈 경우)

| 쪽 | 약속 |
|---|---|
| 한줄로 | 본문을 쓰지 않는 유형에서 `payload.MESSAGE`를 **넣지 않는다.** `msg_contents`도 비운다 |
| 게이트웨이 | 브랜드 경로에서 `req.Message` 폴백을 쓰지 않는다. `payload`에 없으면 전문에도 없다 |

**이 계약은 양쪽 테스트로 고정해야 한다.** 한쪽만 고치면 다음 사람이 되돌린다.
한줄로 쪽은 계약 테스트를 조립기에 넣겠다. 게이트웨이 쪽도 `payload_brand_test.go`에 한 건 부탁드린다.

### 6-2. 순서와 신호

한줄로는 **게이트웨이 3건이 끝나기를 기다리지 않고** 규격 CT와 화면을 먼저 만든다(§1의 1·4번).
막히는 것은 **5번 유형별 실측**뿐이다.

| 시점 | 신호 |
|---|---|
| 게이트웨이 3건 배포 완료 | 게이트웨이 세션 → Harold님 → 한줄로 세션 |
| 한줄로 조립기 완료 | 한줄로 세션 → Harold님 |
| **둘 다 끝난 뒤** | 유형별 실측 1건씩 개시 |

실측은 유형 하나에 발송 1건이고, REPORT `0000`을 확인한 유형만 화면에서 열린다.

### 6-3. 실측 때 게이트웨이 쪽에서 필요한 것

0818 성공 때 남긴 로그 형태가 그대로 있으면 된다(SoT §3 종결 증거).

```
카카오 전송 프레임  accountID / msgType / command / MSG_UID / ngs_serial
카카오REPORT 원문   REPORT_TYPE / REPORT_CODE / FRIEND_YN / RESEND
```

유형별 실측에서는 여기에 **전송 프레임의 `ATTACHMENT`·`CAROUSEL` 원문**이 함께 보여야 한다.
키가 바뀌었는지(수정 1) 사용불가 필드가 실렸는지(수정 2)를 눈으로 확인할 자리가 그것뿐이다.

---

## 6-4. 배포 창 — 게이트웨이는 정지시킬 수 없다

★2026-08-28 같은 날 보안 세션이 실측한 사실이다(허브 §1 · [보안 스포크](bito-gateway/FEATURE-GW-SECURITY.md) §1·§6).

> 게이트웨이에 **실사용 트래픽이 있다.** API(REST) 접수가 하루 191건이고 하루 종일 나간다.
> 이전 문서의 "실사용 트래픽 0" 서술은 폐기됐다.

이 문서의 수정 3건은 전부 **브랜드 경로에만 닿는 분기**라 다른 채널에는 영향이 없어야 한다.
그 전제가 깨지지 않는지(공용 함수를 그대로 고치지 않았는지)를 배포 전에 한 번 더 확인해 주시기 바란다.
정지 창을 전제로 한 이행 설계는 성립하지 않는다.

## 7. 하지 말 것

- ⛔ **브랜드 규격 검증을 게이트웨이에 넣지 마라.** 차감 뒤에 막는 것이라 늦다. 한줄로가 적재 전에 한다.
- ⛔ **공용 정규화 함수를 브랜드 기준으로 바꾸지 마라.** 알림톡·친구톡이 같은 함수를 탄다. 분기로 간다.
- ⛔ **`RESERVED_DATE`·`RESEND_MT_*`를 되살리지 마라.** 0815에 제거한 비규격 필드다. 브랜드만 `4101`이던 원인 축이었다(`payload.go:191~217` 주석이 경위를 소유).
- ⛔ **`MSG_UID` 자릿수를 건드리지 마라.** 브랜드는 9자리다. 11자리로 돌아가면 전량 `4101`이다(SoT §3).
- ⛔ **결과코드를 "정리"하면서 기존 매핑을 바꾸지 마라.** 이번에 필요한 것은 **더하는 것**뿐이다.

---

## 8. 근거 파일 색인

| 무엇 | 어디 |
|---|---|
| 브랜드 자유형 ATTACHMENT·CAROUSEL 규격 | `attachment_method.pdf` §3.4 · §5.3 (OneDrive 카카오톡 받은 파일) |
| 결과코드 (4101 포함) | `휴머스온 IMC-Agent 결과코드 v2.3.1.xlsx` 비즈메시지 시트 |
| IMC-Agent 매뉴얼 | `휴머스온 IMC-Agent 메뉴얼 v2.3.1.pdf` §4.4.1 · §6.10.x |
| 브랜드 축 SoT (경위·교훈·착수 원장) | `docs/bito-gateway/FEATURE-GW-BRAND-MESSAGE.md` |
| 한줄로 규격 CT | `packages/backend/src/utils/brand-message.ts` `BUBBLE_TYPES` |
| 게이트웨이 payload 조립 | `internal/gateway/connector/humuson_imc/payload.go` |
| 게이트웨이 브랜드 테스트 | `internal/gateway/connector/humuson_imc/payload_brand_test.go` |

---

## 9. 이력

- **2026-08-28 신설** — 한줄로 세션이 자유형 5종 개통 착수 전 게이트웨이 코드를 실측하고 3건 도출.
  수정 1·2는 실측 전 필수, 수정 3은 실측 진단 가능 여부를 가른다.
