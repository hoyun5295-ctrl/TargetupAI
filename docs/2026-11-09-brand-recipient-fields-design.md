# 브랜드메시지 발송 창 · 받는 사람 명단에 항목 칸 보이기 — 흐름 표 · 결함 장부 · 설계서

> 접수 = 그룹웨어 `cmw2wry9z0kxjjnscfg0alhc7` 「대체 발송 화면 개선」 재오픈 2차(11-09 10:34 메모 「4번 타겟추출로 불러오면 휴대폰번호랑 이름만 · 다른 필드들은 선택해도 추출되지 않음」) · 등록 박성용 · 댓글 서수란
> 카드 = C120(가 번호 · 등록 때 STATUS-FEED §0 에서 다시 확인) · 앞 처리 = C107(11-05) · C117 D8(11-08 da9baa11 · 이름 칸만 · Harold H2)
> Harold 결정 = 1109 「A로 설계」(항목을 명단 표에 보기 칸으로 그대로 · 칸 맞추기 창 없음 · 발송 값 그대로)
> 판 = 서버 HEAD 1e2505c1 = 로컬 HEAD · 아래 파일 로컬 변경 0(`git --no-optional-locks status` 1109) → 아래 줄 번호 = 배포본
> Codex 설계 = 1R needs-attention 3(칸 이름을 행마다 정함 · 밑줄 철자로 칸 제거 · 시험이 창 열기 자리를 놓침 → 셋 다 수용 · §3-1 · §5) → 2R approve(1109) · 남은 것 = Harold 흐름 표 확인 · 구현 동의

## §0 접수 대조

| 접수 줄 | 서버 지금 | 이번 설계 뒤 |
|---|---|---|
| 4. 엑셀에 여러 필드 → 휴대폰 번호만 | 번호 + 이름 칸(C117 D8) | 파일의 모든 칸 |
| 4. 타겟 추출로 고객 DB → 휴대폰 번호만 | 번호 + 이름 | 추출 항목 전부(문자 창 칸 맞추기 창에 나오는 항목 = 같은 이름 · 같은 표기) |
| 11-09 메모 「다른 필드는 선택해도 추출되지 않음」 | 위와 같음 | 위와 같음 |
| 1 · 2 · 3 | 직원 메모 「완료」 | 그대로 |
| 서수란 댓글(채널 칩 두 줄) | C117 D11 배포(`campaign-axis.ts:145` whitespace-nowrap) | 그대로 · 직원 화면 확인만 |

## §1 흐름 표 — 받는 사람이 브랜드 창 명단에 들어와 보이고 나가기까지

뽑은 패턴(소스 · 손 목록 아님):
- 명단을 바꾸는 자리 = `grep -n "setRecipients(\|updateRecipients(\|setPhones(" packages/frontend/src/components/BrandSendModal.tsx`
- 보기 값을 쓰는 자리 = `grep -n "mergeNames(\|setNames(\|names\[" packages/frontend/src/components/BrandSendModal.tsx`
- 창 밖 인계 = `grep -n "setBrandInitialRecipients(" packages/frontend/src/pages/Dashboard.tsx`
- 타겟추출 창이 넘기는 값 = `grep -n "onExtracted" packages/frontend/src/components/DirectTargetFilterModal.tsx`

| 단계 | 쓰는 쪽 | 읽는 쪽 | 값 범위 | 그리는 화면 | 판정 |
|---|---|---|---|---|---|
| ① 직접입력(붙여넣기) | `BrandSendModal.tsx:235 addFromDraft` → `:241 setRecipients` | 명단 `:390` | 번호만(글에 이름 없음) | 이름 「-」 | 정상(넣을 항목이 없다) |
| ② 파일등록 | `:287` 업로드 분석(headers · allData) → `:253 addFromColumn` → `:255 namesByPhone(이름 칸 하나)` | `:548` 이름 칸 | 머리 N개(번호 · 이름 · 등급 · 지역 …) · 빈 칸 · 0 · 같은 머리 둘 | 「수신번호 · 이름」 두 칸 | **결함 F1** — 번호 · 이름 밖 칸을 버림 |
| ③ 주소록 | `AddressBookModal.tsx:210` 행 {phone · name · extra1~3} → `BrandSendModal.tsx:308 setAddrRows` → `:312` 이름만 | `:548` | 이름 · 기타1~3 | 이름만 | **결함 F2** — 기타1~3 버림 |
| ④ 타겟추출(창 안 칸) | `DirectTargetFilterModal.tsx:388 · :173 onExtracted(ext, fieldsMeta)` → `BrandSendModal.tsx:665 (ext) =>` **fieldsMeta 안 받음** → `:324` 보관본 전체 행 → `:330` 이름만 | `:548` | 활성 항목 전체(조건 칸 먼저 · `customerFilterBuild.ts:188`) · 성별 F · 금액 · 날짜 원값 | 이름만 | **결함 F3** — 항목 · 항목 이름(meta)을 버림. 문자 `DirectSendPanel.tsx:646` · 알림톡 `AlimtalkSendModal.tsx:501` = `extractionRowsToTable(rows, meta)` 로 모든 항목을 화면 표기로 받는다 |
| ⑤ 인계: 직접 타겟 발송 → 브랜드 | `Dashboard.tsx:3014` 보관본 전체 행 → `{ phone, name }` | 창 열기 `BrandSendModal.tsx:165-187` | ④와 같은 항목(키 = field_key · 원값) | 이름만 | **결함 F4** — ④와 같은 버림(같은 고객 DB 명단이 들어오는 다른 문) |
| ⑥ 인계: 문자 발송 → 브랜드 | `Dashboard.tsx:3218` directRecipients → `{ phone, name }` | 창 열기 | 이름 · 회신번호 · 기타1~3(문자 목록에 보이던 칸 · `DirectSendPanel.tsx:1089-1094`) | 이름만 | **결함 F5** — 회신번호 · 기타1~3 버림 |
| ⑦ 인계: 알림톡 → 브랜드 | `AlimtalkSendModal.tsx:826 onSwitchChannel(…, recipients)` → `Dashboard.tsx:3359` → `{ phone, name }` | 창 열기 | 알림톡 목록 칸(번호 밖 전부 · `AlimtalkSendModal.tsx:272-277`) | 이름만 | **결함 F6** — 알림톡 목록에 보이던 칸 버림 |
| ⑧ 보기 값 정리 | 명단에서 빠진 번호의 값 걷기 `:118-127` · 새 값은 있는 값을 덮지 않음 `:117` | — | 같은 번호가 두 원천 · 지운 뒤 다시 넣기 | — | 정상(C117 Codex 1R #2) — 칸 전체로 넓혀 그대로 지킨다 |
| ⑨ 명단 표 | `:482-494` 머리 「수신번호 · 이름」 · `:536-549` 줄 · CSS `direct-send.css:1324 · 1352` 격자 `44px 160px 1fr` · `.ds-list-body` 가로 넘침 숨김 `:1346-1350` | 화면 | 칸 0 ~ 수십 · 긴 값 | 두 칸 고정 | **결함 F7(R85)** — 칸이 늘면 담을 그릇(가로 스크롤 · 칸 폭)이 없다 |
| ⑩ 검색 | `:390` 번호 또는 이름 | 명단 | 칸 값 | 검색 칸 「번호 · 이름 검색」 | F1 ~ F6 처방 뒤 칸 값도 찾게 넓힘(같은 처방) |
| ⑪ 확인 · 발송 | `:709 onSend({ ...payload, phones: sendPhones })` → `Dashboard.tsx:3266 /api/campaigns/brand-send` | 서버 `campaigns.ts:4413` `phones: string[]` · 자유형 = 같은 글 · 기본형 변수 = 발송 한 건에 JSON 하나(`campaigns.ts:4596-4610` · `brand-message.ts:490`) | 번호만 | — | 정상 — **항목은 발송에 쓰이지 않는다**(보기 전용 · 계약 C117 B2-d 그대로) |
| ⑫ 브랜드 → 문자 · 알림톡 전환 | `BrandSendModal.tsx:606 onSwitchChannel(to, phones)` | 그 창 | 번호만 | 그 창 목록 | 이번 축 밖 · 기록만(브랜드에서 넘길 때 칸 0 — 그 창들은 변수 치환이라 칸 맞추기가 필요한 별개 흐름) |

## §2 결함 장부

| 번호 | 사슬 | 파일:행 | 고객이 겪는 일 |
|---|---|---|---|
| F1 | 파일 행 → 이름 칸 하나만 | `BrandSendModal.tsx:255` | 엑셀 칸이 많아도 이름만 보인다 |
| F2 | 주소록 행 → 이름만 | `:312` | 주소록 기타1~3 이 안 보인다 |
| F3 | 타겟추출 meta 안 받음 → 이름만 | `:665` · `:330` | 추출 항목(성별 · 등급 · 금액 …)이 안 보인다(접수 원문) |
| F4 | 직접 타겟 발송 인계 = 번호 · 이름 | `Dashboard.tsx:3014` | 같은 증상(다른 문) |
| F5 | 문자 인계 = 번호 · 이름 | `Dashboard.tsx:3218` | 문자 창에서 맞춘 기타1~3 이 사라진다 |
| F6 | 알림톡 인계 = 번호 · 이름 | `Dashboard.tsx:3359` | 알림톡 창에서 보던 칸이 사라진다 |
| F7 | 표 그릇 = 두 칸 고정 | `direct-send.css:1324 · 1346 · 1352` | 칸을 늘리면 겹치거나 잘린다 |

**뿌리 하나**: 브랜드 창 명단의 모양 = `phones: string[]` + 보기용 `names`(번호 → 이름 하나). 넣는 문 여섯이 모두 이 모양에 맞추느라 이름 밖 칸을 버린다(F1 ~ F6). 문자 · 알림톡 창은 행 전체를 들고 있다.
→ 뿌리 대장 **R86(새)**: 「같은 명단을 받는 창 가운데 하나가 보기 모양을 좁게 들고 있어, 들어오는 문마다 칸을 버린다」 · 판정 기준 = 명단 원천(파일 · 주소록 · 타겟추출 · 인계)이 가진 칸은 그 창 명단 표까지 같은 이름으로 온다 · 발송에 쓰지 않는 칸은 보기 전용으로 둔다.
F7 = 기존 **R85**(칸 안 최소 크기를 그릇이 받지 못함) 넓힘.

## §3 처방

### 3-1 모양 하나(뿌리 처방)
- `names: Record<번호, 이름>` → **`fields: Record<번호, Record<칸 이름, 값>>`** 로 바꾼다(보기 전용 · `phones` = 발송 · 중복 · 세대 규칙의 유일 진실 그대로).
- 인계 행 `BrandRecipientSeed` = `{ phone: string; fields?: Record<string, string> }`(name 키 폐기 · 이름 = `fields['이름']`).
- 칸 만들기 = CT 한 곳 `utils/recipient-paste.ts`(파일 이름 칸 CT 가 있는 곳 · `namesByPhone` 은 지운다 — 쓰는 곳 = 브랜드 창 하나):
  - **`recipientFieldLabels(rows, { phoneKey, nameKey, labelOf?, keys? }) → Map<원키, 칸 이름>`** — 칸 이름은 **원천 하나(파일 한 장 · 추출 한 번 · 인계 한 번 · 주소록 불러오기 한 번)마다 한 번** 정한다(행마다 정하지 않는다 · Codex 설계 1R #1 — 행마다 키가 다른 알림톡 명단에서 같은 항목이 줄마다 다른 칸으로 갈리던 길).
    - 그 원천 전체 행의 키를 처음 나온 순서로 모은다 → nameKey 를 먼저 「이름」으로 잡는다(원천마다 「고객명」 · 「성함」 · name 이 한 칸으로 모인다) → 나머지 = `labelOf(키)`(없으면 키 그대로) → 이미 잡힌 칸 이름과 겹치면 뒤 키 = 「칸 이름 2」 · 「3」 …(값이 조용히 덮이지 않게)
    - 뺀다: 번호 칸(phoneKey) · **우리 코드가 명단 행에 넣는 내부 키만** = 새 상수 `RECIPIENT_ROW_INTERNAL_KEYS`(`_templateVars` = `DirectSendPanel.tsx:618` · `originalIdx` = 목록 계산 · `customerFilterBuild.ts:208 ROW_RESERVED_KEYS` 가 같은 상수를 쓴다 = 한 곳). 키 철자(밑줄 시작)로 판단하지 않는다 — 사용자 머리 「_회원번호」는 남는다(Codex 설계 1R #2).
    - `keys` 를 주면 그 키만(문자 인계 = 문자 목록에 보이던 칸만).
    - 빈 값을 거르기 **전에** 정한다(값이 빈 줄도 칸 이름 자리는 같다).
  - `rowFields(row, labels) → Record<칸 이름, 값>` — 정한 대응을 그대로 적용 · 값 = 글자로(`cellToString` 과 같은 읽기) · 빈 값(없음 · 공백만) 뺌 · `0` · `'0'` 은 남긴다(문자 D150-3 과 같은 판정).
  - `fieldsByPhone(rows, phoneOf, labels) → Record<번호, 칸>` — 행마다 `phoneOf(row, i)` 로 번호(10자리 미만 = 건너뜀) · 같은 번호 두 번 = 앞 행.

### 3-2 문마다(F1 ~ F6)
| 문 | 처방 |
|---|---|
| ② 파일 | 대응 = `recipientFieldLabels(rows, { phoneKey: 고른 번호 칸, nameKey: pickNameColumn(headers) })` · 칸 = `fieldsByPhone(rows, 행 → 고른 칸 번호(phonesFromColumn 과 같은 읽기 · 지금 namesByPhone 읽기 그대로), 대응)` |
| ③ 주소록 | 불러온 행 묶음 하나 = 원천 하나 · `{ phoneKey: 'phone', nameKey: 'name', labelOf: DIRECT_FIELD_LABELS }` → 이름 · 기타1~3 |
| ④ 타겟추출 | `onExtracted={(ext, meta) => …}` 로 meta 를 받아 `extractionRowsToTable(rows, meta)`(문자 · 알림톡과 같은 CT · 같은 항목 이름 · 같은 표기 · 성별 F → 여성 · 금액 쉼표 · 행을 거르거나 순서를 바꾸지 않는다 = `rows.map` 1:1 · `customerFilterBuild.ts:224`) → 대응 = `{ phoneKey: t.mapping.phone, nameKey: t.mapping.name }` · 칸 = `fieldsByPhone(t.data, (_, i) => 원행 i 의 번호(지금 읽기 그대로), 대응)` · 명단 교체 = 칸도 교체(지금 「명단을 그것으로 바꾼다」 규칙과 같게) |
| ⑤ 직접 타겟 인계 | `Dashboard.tsx:3014` = ④와 같은 함수 · meta = 그 추출에서 함께 저장된 `targetFieldsMeta`(`Dashboard.tsx:1753` 같은 자리에서 저장 · 다시 추출 `:1090` 은 같은 filterBody 라 같은 항목) |
| ⑥ 문자 인계 | `keys = DIRECT_VAR_MAP 의 fieldKey`(이름 · 회신번호 · 기타1~3 · 문자 목록 `DirectSendPanel.tsx:1089-1094` 과 같은 칸) · `nameKey: 'name'` · `labelOf = DIRECT_FIELD_LABELS` |
| ⑦ 알림톡 인계 | 알림톡 목록과 같은 칸(번호 밖 키 전부 · `AlimtalkSendModal.tsx:272-277` 과 같은 규칙 · 내부 키는 위 상수로만 뺀다) · `nameKey` = 키에 name 이 있으면 name · 없으면 `pickNameColumn(키)` · `labelOf = DIRECT_FIELD_LABELS`(알림톡 `FIELD_LABEL_MAP` 과 이름 · 기타1~3 같은 말) |

- 합치기(⑧) = ★구현 정정 = **값이 있는 앞 묶음 통째**(빈 묶음은 막지 않는다 · 칸을 섞지 않는다 · CT `firstFilledRecord` 한 곳 = 한 원천 안 `fieldsByPhone` · 원천 사이 창 합치기 · 창 열기) · 명단에서 빠진 번호는 걷는다(그대로) · 타겟추출 = 교체. (설계 때 적은 칸 단위 합치기는 Codex 구현 1R · 2R 에서 빈 줄이 값을 막음 · 두 사람 값이 섞임으로 드러나 행 단위로 바꿨다)
- 창 열기 = 인계 행의 `fields` 로 만든다(지금 이름 만드는 자리 `:173-179` 를 바꾼다).
- 주소록 창에 넘기는 지금 명단(`addrRows :307`) = 이름 = `fields[p]?.['이름']`(지금과 같은 값 · 주소록 창 동작 그대로).

### 3-3 명단 표(F7 · R85)
- 칸 목록 = 지금 명단 번호 순서로 처음 나온 칸 이름 순서 · 「이름」 맨 앞 · 늘 「이름」 칸은 둔다(C117 과 같게 · 없으면 「-」).
- 표 = 가로 · 세로 한 그릇(`.ks-recipients .ks-list-scroll { overflow: auto }`) 안에 머리(위에 붙음 · `position: sticky; top: 0`) + 줄. 머리 · 줄 격자 = `44px 120px repeat(칸 수, minmax(92px, 1fr))`(★구현 실측으로 160 · 112 → 120 · 92 — 1440 수신자 열 안 폭 394 에서 두 칸까지 밀지 않게) · 최소 폭 = 그 합(칸이 적으면 넓은 칸으로 채우고, 많으면 표 안에서 옆으로 민다 · 창은 밀리지 않는다).
- 칸 값 = 한 줄 · 넘치면 줄임표 · 마우스를 올리면 전체 값(`title`).
- 규칙은 모두 `.ks-recipients` 안(문자 · 알림톡 ds-* 그대로 · direct-send.css 2165 원칙).
- 검색 = 번호 또는 칸 값 · 자리 글 「번호 · 이름 · 항목 검색」.

### 3-4 그대로 두는 것(증명)
- 발송 payload = `{ ...payload, phones: sendPhones }` 그대로 · 칸은 싣지 않는다(서버 · 적재 · 정산 영향 0).
- 미가입 · 직접발송만 쓰는 회사: 문자 직접발송 · 알림톡 창 코드 변경 0 → 동작 변화 0(메모리 `feedback_free_direct_send_zero_change`). 바뀌는 곳 = 브랜드 창 안 명단 표 · 대시보드의 브랜드 인계 세 줄뿐.
- 백엔드 · DDL · ENV 0.

## §4 영향표(바뀌는 값을 읽고 쓰는 곳 전수)

`grep -rn "BrandRecipientSeed\|namesByPhone\|brandInitialRecipients\|setBrandInitialRecipients" packages/*/src`:

| 소비처 | 지금 | 뒤 |
|---|---|---|
| `BrandSendModal.tsx` 상태 · 문 넷 · 표 · 검색 | 이름 | 칸 전체 |
| `Dashboard.tsx:502` 상태 · `:3014 · 3218 · 3359` 넘기기 · `:3232 · 3237 · 3277` 비우기(`[]`) | `{ phone, name }` | `{ phone, fields }` · 비우기 그대로 |
| `utils/recipient-paste.ts` `namesByPhone` | 브랜드 창 하나 | 지움 → `recipientFieldLabels` · `rowFields` · `fieldsByPhone` |
| `utils/customerFilterBuild.ts:208` `ROW_RESERVED_KEYS` | 내부 키 두 개를 글자로 적음 | 같은 값을 새 상수 `RECIPIENT_ROW_INTERNAL_KEYS` 에서 읽음(값 같음 · 추출 표 머리 동작 그대로) |
| `utils/__tests__/c117-intake-contract-1108.test.ts` B2-c · B2-e | 이름 꼴 계약 | 칸 꼴 계약으로 바꿈(같은 뜻 · 넓힘) |
| `direct-send.css` `.ks-recipients` | 두 칸 | 그릇 규칙 더함 · ds-* 공용 규칙 그대로 |

## §5 계약 시험(새 파일 `brand-recipient-fields-1109.test.ts`)

| 이름 | 못 박는 것 | 대상 뽑기 |
|---|---|---|
| R86-a | 판정 표: 이름 칸 → 「이름」 · 번호 칸 · 내부 키 상수만 뺌(「_회원번호」 남음) · 빈 값 뺌 · 0 남김 · 겹친 칸 이름 「이름 2」 · keys 제한 · **행마다 키가 다른 원천(예: 첫 줄 {name, 이름} · 다음 줄 {이름})에서 같은 키 = 모든 줄 같은 칸** · 파일 행 + 직접입력 행이 섞인 원천 · `fieldsByPhone` 같은 번호 = 앞 행 · 10자리 미만 건너뜀 | 함수 직접 |
| R86-b1 | 브랜드 창의 `setPhones(` 쓰기 전수 = 세 자리(`setRecipients` · `updateRecipients` 몸 · 창 열기 effect)뿐 · 그 밖 자리 = 실패(새 문이 상태를 바로 쓰면 빨강 · Codex 설계 1R #3) | 소스 기계 추출 |
| R86-b2 | `setRecipients(` · `updateRecipients(` 호출 자리 전수(인자 글자 그대로)를 분류표와 대조 — 원천 행을 받는 자리(파일 · 주소록 · 타겟추출) = 같은 함수 안에 칸 CT(`recipientFieldLabels` · `fieldsByPhone`) 호출 · 원천 행 없는 자리(붙여넣기 · 선택삭제 · 전체삭제) = 표에 적힌 그대로 · 표에 없는 자리 = 실패 | 소스 기계 추출 |
| R86-b3 | 창 열기 effect 가 인계 행의 `fields` 를 읽어 칸을 만든다 · `names` · `setNames` · `namesByPhone` 잔존 0 | 소스 |
| R86-c | 대시보드 `setBrandInitialRecipients(` 인자 중 빈 배열이 아닌 것마다 `fields` 를 싣는다 | 소스 기계 추출(matchAll) |
| R86-d | 타겟추출 문 = `onExtracted` 두 번째 인자(meta)를 받아 `extractionRowsToTable(` 를 부른다 · 직접 타겟 인계도 같은 함수 | 소스 |
| R86-e | 발송 payload 에 칸 0(`onSend(` 인자에 fields 없음 · C117 B2-d 문장 그대로) | 소스 |
| R85-f | `.ks-recipients .ks-list-scroll` = `overflow: auto` · 그 안 머리 = `position: sticky` · 줄 · 머리 격자 = 같은 칸 변수 | CSS 기계 추출 |
| 변이 | ④에서 meta 를 버림 → R86-d 빨강 · 칸 이름을 행마다 정하게 바꿈 → R86-a 빨강 · 번호만 넣는 새 함수(`setRecipients` 호출) 추가 → R86-b2 빨강 · 창 열기에서 fields 읽기 지움 → R86-b3 빨강 · `setPhones` 를 바로 쓰는 새 자리 → R86-b1 빨강 · 그릇 overflow 지움 → R85-f 빨강 | 파일 복사 변이 |

화면 실측(메모리 `feedback_layout_css_needs_rendered_measurement`): 정적 시험대(C117 과 같은 방식)에서 폭 1100 · 1280 · 1366 · 1440 · 1920 · 375 마다 ① 칸 2개 · ② 칸 20개 · ③ 긴 값 — 머리 칸 x = 줄 칸 x(가로로 민 뒤에도) · 창 가로 스크롤 0 · 표 안 가로 스크롤 있음.

## §6 직원 지시문 초안(구현 전 · 로드맵 묶음 끝 시트로 · 메모리 `feedback_staff_sheets_after_roadmap`)

계정 = 인비토 테스트 회사(고객 = 도달 불가 합성 번호) · **발송 버튼은 누르지 않는다.**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정으로 로그인 → 「직접발송」 → 머리 「브랜드메시지 발송」 | 브랜드메시지 발송 창이 열린다 |
| 2 | 오른쪽 「타겟추출」 → 조건 「성별 = 여성」 → 「담기」 | 명단 머리에 「수신번호 · 이름 · 성별 …」 · 성별 칸 값 「여성」 |
| 3 | 명단 표 안에서 오른쪽으로 민다 | 오른쪽 칸이 이어서 보이고, 머리 글자와 값이 같은 칸에 있다 · 창 전체는 움직이지 않는다 |
| 4 | 검색 칸에 「여성」 입력 | 여성인 줄만 남는다 |
| 5 | 「전체삭제」 → 「파일등록」 → 칸이 휴대폰 · 고객명 · 등급 · 지역인 엑셀(번호 010-0000-0001 ~ 0003) | 머리 「수신번호 · 이름 · 등급 · 지역」 · 값이 엑셀과 같다 |
| 6 | 창 닫기 → 「직접 타겟 발송」 → 조건 하나 → 「타겟 추출」 → 「브랜드메시지」 | 가져온 명단에 2번과 같은 칸들이 보인다 |
| 7 | 문자 직접발송에서 5번 엑셀을 올리고 「기타1」에 등급을 맞춤 → 머리 「브랜드메시지 발송」 | 브랜드 명단에 「이름 · 기타1」 칸 · 기타1 = 등급 값 |
| 8 | 관리 메뉴 → 발송결과(발송자 열이 보이는 화면) | 「브랜드메시지(비친구)」 칩이 한 줄 |

## §7 이번 축 밖(기록만)
- ⑫ 브랜드 → 문자 · 알림톡 전환 때 칸 0(번호만 넘김) — 그 창들은 칸 맞추기로 변수를 고르는 흐름이라 별개 과제.

## §8 구현 기록(1109 ~ 1110)
- 바뀐 파일 = `utils/recipient-paste.ts`(칸 CT: `recipientFieldLabels` · `rowFields` · `firstFilledRecord` · `fieldsByPhone` · `recipientSeeds` · `pickNameKey` · `columnPhoneOf` · 내부 키 상수 · `namesByPhone` 지움) · `utils/customerFilterBuild.ts`(`extractionFieldTable` · ROW_RESERVED_KEYS 가 내부 키 상수를 읽음) · `components/BrandSendModal.tsx` · `pages/Dashboard.tsx`(인계 세 자리) · `styles/direct-send.css`(`.ks-list-scroll`) · 시험 `brand-recipient-fields-1109`(새) · `c117-intake-contract-1108` · `kakao-send-windows-0925`(함수 머리 기준 글자).
- Codex 구현 = 1R needs-attention 2(중복 허용 주소록에서 빈 줄이 값을 막음 · 추출 창이 항목 목록을 못 받으면 이름까지 사라짐 → 둘 다 수용 · `extractionFieldTable` 신설) → 2R needs-attention 1(같은 번호 다른 사람 값이 칸 단위로 섞임 · 1R #1 과 같은 자리 = 합치기 단위가 칸이라서 → 행 단위 규칙 `firstFilledRecord` 하나로 구조 정리) → 3R approve.
- 변이 9 전부 빨간불(M1 meta 버림 · M2 칸 이름 첫 행만 · M3 번호만 넣는 새 함수 · M4 창 열기 fields 안 읽음 · M5 setPhones 바로 쓰기 · M6 그릇 overflow · M7 빈 줄이 막음 · M8 이름 항목 없는 meta · M9 칸 섞기).
- 폭 실측(정적 시험대 · 실제 direct-send.css · 같은 바깥 틀 · 버림) = 1920 · 1440 · 1366 · 1280 · 1100 · 375 × 칸 2 · 20 · 긴 값 = 페이지 가로 밀림 0 · 머리와 줄 칸 맞춤(가로로 민 뒤에도) · 붙는 머리 · 긴 값 줄임표 · 쪽 넘김 표 안. 1440 · 1366 · 1920 = 두 칸까지 밀지 않음 · 1280 · 1100 · 375 = 표 안에서 민다(옛 1100 = 이름 칸이 26px 로 눌려 안 보였음).
- 화면 실물(로그인 뒤 실제 창) = 배포 뒤 직원 지시문 §6 으로 확인(구현 단계 미검증).
