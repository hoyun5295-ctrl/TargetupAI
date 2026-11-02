# 이미지 스튜디오 · 제품 사진 최대 3장을 한 장 포스터로 (설계서)

> 2026-11-02 · 기능 문서 = [FEATURE-IMAGE-STUDIO.md](FEATURE-IMAGE-STUDIO.md)(구현 뒤 이력 한 줄 · 이 문서 링크)
> 진행 = 설계 → Codex 설계 → 구조체크 → 구현 → Codex 구현 → 배포 명령(Harold 1102 일괄 지시)

## §0 접수 · 결정 · 실측

- **접수(Harold 1102)**: 고객사 「제품형 포스터에 이미지를 하나밖에 못 넣는다 · 2~3개까지」. 화장품 누끼 둘 · 의류도 같은 요구.
- **결정(Harold 1102)**: 「3개로 설계」 · 「업로드 최대 3개까지만 허용 · 그 이상은 업로드 안 되게 막고 · 3개 병합해서 이미지 만든다」.
- **실측(1102 · 운영 서버에서 시험 스크립트 · 운영 코드 무변경)**: 누끼 n장을 서버가 투명 PNG 한 장으로 나란히 붙여 지금의 `generatePoster` 에 넘겼다. 템플릿 `beauty-clean-bright` · `fashion-studio-clean` × 1·2·3장 × 엔진 2 = 12장.
  - OpenAI: 제품명 · 부제 · 큰 용량 줄은 3장까지 원본 그대로. 가장 작은 줄은 2장에서 한 곳(Mask → Maak), 3장(스틱 둘씩이라 물건 5개)에서 여러 곳 흔들림(Glow Shot → Glnw Shnt · 0.13 → 0.15).
  - Gemini: 1장에서도 용량 30 → 50 mL · 2장부터 성분 · 부제 철자가 깨짐.
  - 의류: 두 엔진 모두 3장까지 색 · 형태 그대로.
  - 운영 고객 생성 엔진 = OpenAI(FEATURE-IMAGE-STUDIO.md 237행 기록 · 서버 값은 배포 때 확인).
- **방식**: 실측한 그대로 「서버가 묶어 한 장으로 넘긴다」. 엔진 호출(`generatePoster`) · 크레딧(생성 2) · 수정 지시 · 저장 · 채널 경로는 그대로.

## §1 흐름 표 (고객사가 쓰는 흐름 · 이음매마다 쓰는 쪽 / 읽는 쪽)

뽑은 방법 = `grep -rn "/api/image-studio/(generate|edit|save|remove-bg|upload-product|ingest-product|temp|mms-from-asset)" packages/frontend/src` · `grep -n "imageStudioRouter\.(post|get)" routes/image-studio.ts` · `grep -rn "cutoutTempId|onPickMall|onUpload|prepareProduct|buildPosterPrompt\(|generatePoster\(|studioAttemptKey\(" packages`. `/generate` 를 부르는 화면 = `StudioMake.tsx` 하나(나머지 두 화면은 훅을 부를 뿐 · `make.` 사용 = busyMsg · generate · pickerOpen · reset · restart · texts 뿐).

| # | 단계 | 쓰는 쪽 | 읽는 쪽 | 이번에 바뀌나 |
|---|---|---|---|---|
| 1 | 템플릿 고르기 | `ImageStudioPage.tsx:302` · `StudioInsertModal.tsx:135` | `useStudioMake(template)` `StudioMake.tsx:25` | 아니오 |
| 2a | 몰에서 상품 고르기 | `MallProductPickerModal.tsx:93`(toggle) · `:212`(onPick) | `onPickMall` `StudioMake.tsx:116`(지금 `products[0]` 만) | **예** — 남은 칸 수만큼 · 창에 상한 |
| 2b | 사진 올리기 | `<input type=file>` `StudioMake.tsx:260`(한 장) | `onUpload` `StudioMake.tsx:124` | **예** — 여러 장 · 남은 칸 수만큼 |
| 3 | 원본 임시 저장 | `/ingest-product` `routes/image-studio.ts:453`(`writeTempBuffer` kind source `:463`) · `/upload-product` `:480`(`:493`) | 화면 `prepareProduct` `StudioMake.tsx:88 · 92` | 아니오(사진마다 한 번씩 부른다) |
| 4 | 누끼 | `/remove-bg` `:499`(`allocTempPath` · `removeBackground` · `writeTempMeta` kind cutout `:508-510`) | 화면 `StudioMake.tsx:100-104` | 아니오(사진마다) |
| 5 | 누끼 미리보기 | `GET /temp/:tempId` `:725` | `fetchAuthObjectUrl` `StudioMake.tsx:105` | **예** — 칸 여럿 · 빼기 |
| 6 | 자동 문구 | `autoStudioTexts(defaults, product)` `lib/studio-texts.ts:24` | `StudioMake.tsx:47` | **예** — 첫 몰 상품 기준 |
| 7 | 생성 요청 | `generate` `StudioMake.tsx:136-159`(body `cutoutTempId`) | `/generate` `routes/image-studio.ts:120` | **예** — 아래 7-1 ~ 7-8 |
| 7-1 | 시도 키 | `studioAttemptKey('gen', …, { …, cutoutTempId, … })` `:129` | `utils/image-studio-attempt.ts:13` | **예** — 지문 규칙 §3 B2 |
| 7-2 | 회사 잠금 · 같은 시도 결과 · 납부 확인 | `:133-144` | `tryAcquireGenerateLock` · `recallStudioResult` · `isChargedByKey` | 아니오 |
| 7-3 | 제품 파일 읽기 | `:151-158`(`findTempFile` · `readTempMeta` kind cutout·source) | — | **예** — 0~3장 · 넘침 400 |
| 7-4 | 예시 문구 그대로 거름 · 크레딧 사전 확인 · 임시 상한 | `:161-170` | `findUnfilledTemplateText` · `checkCredit` · `isStudioTempFull` | 아니오 |
| 7-5 | 프롬프트 | `buildPosterPrompt` `:175`(hasProduct) | `utils/image-studio.ts:208` | **예** — 개수 줄 |
| 7-6 | 생성 | `generatePoster(prompt, preset, cutout, …)` `:186` | `utils/image-studio.ts:516` | 아니오(한 장을 넘긴다) |
| 7-7 | 결과 임시 저장(prompt 포함) | `writeTempBuffer` kind poster `:192` | `/edit` 가 prompt 를 읽는다 | 아니오 |
| 7-8 | 성공 뒤 차감 · 못 걷으면 결과 거둠 · 결과 기억 | `settleOrUndo` `:204` · `rememberStudioResult` `:223` | 크레딧 원장 | 아니오 |
| 8 | 수정 지시 | `ImageStudioPage.tsx:157` | `/edit` `:233` → `editOrUpscale`(OpenAI = 「제품 그대로」 문장 `OPENAI_EDIT_KEEP_REST`) | 아니오(여러 제품도 같은 문장) |
| 9 | 저장 · 채널 | `lib/studio-api.ts:61` · `useMmsUpload.ts:164` · `JourneyMmsUploader.tsx:70` | `/save` `:518` · `/mms-from-asset` `:681` | 아니오 |
| 10 | 새 제작 · 처음으로 | `ImageStudioPage.tsx:302`(restart) · `StudioInsertModal.tsx:67`(reset) | `reset` `StudioMake.tsx:56` · `restart` `:72` | **예** — 칸 전부 · 미리보기 해제 · 늦은 응답 버림 |
| 11 | 임시 정리 | `sweepOldTemp` `utils/image-studio.ts:830` | 스윕 워커 | 아니오 |
| 돈 | 차감 → 실패 → 되돌림 | 성공 뒤 차감 한 규칙(7-8) | — | 아니오 — 묶기 실패 · 넘침 거절은 모두 AI 호출 전 = 미차감 |

같은 부품을 쓰는 다른 기능(바꾸지 않는다 · 영향 0 확인 대상):
- `buildPosterPrompt` 다른 소비처 = `line-headline-make.ts:62` · `sales-outreach-produce.ts:1649 · 1774` → 새 입력 `productCount` 는 선택 · 안 넘기면 지금 출력과 글자 하나까지 같다(시험 S2).
- `generatePoster` 다른 소비처 = `line-headline-make.ts:63` · `sales-outreach-produce.ts:1672` · 스크립트 둘 → 서명 그대로.
- `MallProductPickerModal` 다른 소비처 = `InAppMessagesPage.tsx:3732` · `QuickCampaignResultPage.tsx:487` · `PosterEditor.tsx:87` · `ProductCarouselEditor.tsx:301` → 새 속성 `max` 는 선택 · 안 넘기면 지금 그대로.

## §2 위험 장부 (칸마다 판정)

| 칸 | 위험 | 판정 · 처리 |
|---|---|---|
| 상한 숫자 | 화면 3 · 서버 3 두 벌(R1) | 서버 상수 `STUDIO_MAX_PRODUCTS` 가 판정 권한(넘치면 400) · 화면 상수는 막기용 · 두 값이 같은지 계약 시험 S5 |
| 넘침 | 화면을 거치지 않은 요청 · 옛 화면 | 서버가 4장 이상 · 중복 id · 글자 아닌 id 를 400 으로 거른다(AI · 차감 전) |
| 옛 화면(캐시) | 배포 직후 옛 화면이 `cutoutTempId` 하나를 보낸다 | 서버는 `cutoutTempIds`(배열)이 없으면 `cutoutTempId` 하나를 한 장 목록으로 읽는다 |
| 시도 키(돈) | 지문이 바뀌면 배포 걸친 재요청이 새 키 = 한 번 더 걷힘 | 지문 = **보낸 값 그대로**(옛 화면 = `cutoutTempId` 생략 · null · id 를 지금처럼 · 새 화면 = `cutoutTempIds` 배열을 같은 이름 자리에) · 해석 · 400 거절은 지문과 떼어 잠금 · 기억 · 납부 확인 뒤 · 시험 S4(생략 · null · id 셋 다 옛 키와 같다) · Codex 설계 1R ① |
| 묶기 | 크기 · 메모리 · 실패 | **배율을 먼저 정한다**: 장마다 헤더로 크기를 읽어 입력 2,500만 화소 넘으면 거절 → 투명 가장자리 잘라낸 크기로 공통 높이 H = min(1200, 3600 ÷ (폭/높이 비 합 + 0.08 × (장수 − 1))) → 각 장을 처음부터 그 높이로 · 캔버스도 처음부터 3600 이하 · 한 장씩 차례로(동시 디코드 0) · 실패 = 생성 실패 응답(AI 호출 전 · 미차감) · Codex 설계 1R ② |
| 1장 | 지금 결과가 바뀜 | 1장은 묶지 않고 지금처럼 그 파일 그대로 · 프롬프트도 지금과 같다(S2) |
| 칸 수명(준비 · 실패 · 처음으로 · 언마운트) | 늦은 응답이 새 제작에 들어옴(1031 같은 부류) · 미리보기 실패로 준비된 누끼가 빠짐 · 칸이 「준비 중」으로 남음(R6) | 아래 **칸 수명 표** 하나로 정한다 · 시험 S6 · Codex 설계 1R ③ ④ |
| 동시 준비 | 누끼 서비스에 한꺼번에 3건 | 차례대로 한 장씩(같은 묶음 안 순차) · 준비 중엔 담기 버튼 · 빼기 · 만들기가 눌리지 않는다 |
| 미리보기 주소 | blob 새는 것 | 빼기 · 처음으로 · 화면 닫힘(언마운트) 때 해제 |
| 자동 문구 | 어느 상품 이름을 쓰나 | 칸 순서상 첫 몰 상품(사진 올리기 칸은 상품 정보 없음) · 사람이 고친 칸은 그대로(`applyAutoTexts`) |
| 화면 하한(R11) | native dialog · 모델명 · 모바일 | 알림 = 토스트 · 칸은 줄바꿈(flex-wrap) · 모델명 0 |
| R2 요금제 문 | 새 돈 주소 | 새 주소 없음 · `/generate` 는 이미 `aiZonePlanBlocked` |
| R15 죽은 주소 | — | 새 주소 없음 |
| R21 외부 부품 | — | `sharp` 는 이미 backend dependencies(라우트가 이미 씀) |
| R6 · R8 · R12 · R18 | 새 상태 · 재시도 · 잠금 · 시계 | DB · 상태 칸 · 주기 작업 없음 · 회사당 생성 잠금 그대로(묶기는 잠금 안) |

**칸 수명 표**(화면 · 한 칸 = 사진 한 장)

| 사건 | 칸 | 누끼 id | 미리보기 주소 | 준비 표시(busyMsg) |
|---|---|---|---|---|
| 담기 | 생김(준비 전) | 없음 | 없음 | 묶음 시작에 켬 · 세대 `seq = ++prepSeq` |
| 원본 저장 실패 · 누끼 실패 | **뺀다** + 토스트 | — | — | 다음 칸 계속 |
| 누끼 성공 | 그대로 | **먼저 넣는다** | — | — |
| 미리보기 받기 실패 | **그대로**(「미리보기 없음」 칸) | 그대로 → 생성에 들어간다 | 없음 | — |
| 미리보기 받음 | 그대로 | 그대로 | 넣음(세대가 바뀌었으면 즉시 해제하고 버림) | — |
| 준비 중(묶음 시작 ~ 끝) | 담기 · 빼기 · 만들기 막힘(busyMsg · 두 화면 만들기 버튼이 busyMsg 를 본다) | — | — | 켜짐 · 사진 한 장이 끝나도 끄지 않는다 |
| 묶음 끝(마지막 사진까지 성공 · 실패와 무관) | — | — | — | 세대가 같을 때만 끔 → 만들기 눌림 |
| 빼기(준비 중이 아닐 때만 눌림) | 뺀다 | — | 해제 | — |
| 처음으로(reset · restart) | 전부 뺀다 | — | 전부 해제 | 세대 올림 · 끔 |
| 훅 언마운트(스튜디오 화면 떠남 · DM 편집기 닫힘) | — | — | 전부 해제 | 세대 올림(남은 단계 중단 · 늦은 미리보기는 받자마자 해제) |
| DM 창 닫기 = 숨김(훅은 그대로 삶 · `StudioMake.tsx:9`) | 그대로 | 그대로 | 그대로 | 준비는 계속 · 다시 열면 그 칸 그대로 |

범위 밖(기록만 · 이번에 고치지 않는다): 몰 상품 창 버튼 글자 「슬라이드에 추가」가 스튜디오에서도 그대로 보인다 · Gemini 엔진은 1장에서도 라벨 숫자를 바꿨다(운영 엔진이 OpenAI 면 고객 영향 없음).

## §3 처방(구현 단위)

### 서버 — `utils/image-studio.ts`(CT) · `routes/image-studio.ts`

- **B1 상한** `export const STUDIO_MAX_PRODUCTS = 3`.
- **B2 요청 읽기 · 지문(둘을 뗀다)**
  - 지문 `export function studioProductFingerprint(body): unknown` = 몸에 `cutoutTempIds` 칸이 있으면 그 값 그대로 · 없으면 `cutoutTempId` 그대로(생략 = undefined 라 지문에서 빠짐 · null · id = 지금과 같다). 라우트 지문 payload 의 키 이름 · 자리 `cutoutTempId` 그대로.
  - 해석 `export function readProductTempIds(body): string[] | null` — `cutoutTempIds` 칸이 있으면 배열이어야 하고(아니면 null), 없으면 `cutoutTempId`(임시 id 꼴 글자면 한 장 · null · 생략 = 0장 · 그 밖 = null). 칸마다 임시 id 꼴(`isValidTempId`) · 중복 없음 · 개수 ≤ 상한. 어긋나면 null → 라우트 400 `PRODUCTS_INVALID`(「제품 사진은 3개까지 넣을 수 있어요. 다시 골라 주세요.」).
- **B3 묶기** `export async function groupProductCutouts(absPaths: string[]): Promise<{ base64: string; mime: 'image/png' }>` — 한 장씩 차례로: 헤더 크기 > 2,500만 화소면 거절(디코드 전) → 투명 가장자리 잘라낸 버퍼 · 크기(실패면 원본) → 공통 높이 H = min(1200, ⌊(3600 − n) ÷ (Σ폭/높이 + 0.08 × (n − 1))⌋)(최소 1) → 각 장 폭 = round(폭 × H ÷ 높이)(최소 1) · 간격 ⌊0.08 × H⌋ → **정수 폭 합 + 간격 합 > 3600 이면 리사이즈 · 캔버스 전에 거절**(`PRODUCT_TOO_LARGE` 400 「제품 사진이 너무 크거나 길쭉해서 함께 넣을 수 없어요…」 · 최소 1 보정이 만드는 극단 모양 · Codex 설계 2R ①) → 넣은 순서대로 왼쪽부터 → PNG. H 계산에서 장수 n 만큼 덜어 두는 것은 폭 반올림 · 최소 1 보정이 보통 모양을 거절로 밀지 않게 하려는 것이다.
- **B4 프롬프트** `buildPosterPrompt` 입력에 선택 `productCount?: number`. `hasProduct && productCount >= 2` 일 때만 제품 보존 줄 바로 뒤에 실측 문장 한 줄: 「The attached transparent image contains N different products placed side by side as one group. Show all N products together as the hero group, keep their order and spacing, and preserve every one of them EXACTLY as provided, including each label text.」 그 밖은 지금 출력 그대로.
- **B5 라우트 `/generate`** — 순서: 시도 키(지문 = `studioProductFingerprint(req.body)`) → 잠금 · 기억 · 납부 확인(그대로) → 템플릿 → `readProductTempIds(req.body)` (null = 400) → 장마다 `findTempFile` · `readTempMeta`(kind cutout · source · 없으면 지금 404 문장) → 예시 문구 거름 · 사전 크레딧 · 임시 상한(그대로) → 1장 = 그 파일 그대로 · 2~3장 = `groupProductCutouts` → `buildPosterPrompt({ …, hasProduct: !!cutout, productCount: ids.length })` → `generatePoster(prompt, preset, cutout, …)` 이하 그대로. 묶은 그림은 임시 저장하지 않는다(메모리에서 넘기고 끝).

### 화면 — `components/studio/StudioMake.tsx` · `components/dm/MallProductPickerModal.tsx`

- **F1 상태** 단일 `product · cutoutTempId · cutoutBlob` → 칸 목록 `items: { key, product | null, cutoutTempId | null, blob | null }[]`(최대 `STUDIO_MAX_PRODUCTS`). 남은 칸 = 상한 − 칸 수.
- **F2 담기** 몰 = 창에 `max = 남은 칸` · 돌려받은 것도 남은 칸까지만(고른 순서 = 창에서 누른 순서). 올리기 = `<input multiple>` · 한 번에 고른 여러 장은 **파일 이름 순서**(숫자 인식 · 브라우저가 주는 순서는 운영체제마다 달라 사람이 예측할 수 없다 · Codex 설계 3R) · 고른 파일을 남은 칸까지만 담고 넘친 장은 담지 않고 토스트 「제품 사진은 최대 3개까지 넣을 수 있어요. 앞의 N장만 넣었어요.」 칸이 다 차면 두 버튼이 눌리지 않고 그 아래 한 줄 「3개를 다 넣었어요. 바꾸려면 하나를 빼 주세요.」
- **F3 준비** 새로 담은 칸만 차례대로 한 장씩: (몰 = ingest · 올리기 = upload) → remove-bg → 그 칸에 누끼 id 먼저 → 미리보기. 칸 수명 표(§2) 그대로: 묶음 시작 때 `const seq = ++prepSeq.current` · 응답마다 `live()` 확인 · 원본 · 누끼 실패만 칸을 뺀다 · 미리보기 실패는 칸 · id 를 남긴다 · 늦은 미리보기는 해제하고 버린다 · busyMsg 는 묶음 끝에 세대가 같을 때만 끈다(두 화면 모두 busyMsg 로 만들기를 막는다 = 준비 중 생성 0). 진행 글 「상품 이미지 준비 중... (2/3)」.
- **F4 칸 보기** 넣은 순서대로 번호 1·2·3 · 칸마다 빼기 단추(준비 중엔 막힘) · 머리에 「n/3」 · 안내 두 줄(제품): 「제품 사진은 최대 3개까지 넣을 수 있어요. 넣은 순서대로 왼쪽부터 놓여요.」 · 「여러 개를 넣으면 제품이 작아져 라벨의 아주 작은 글씨가 바뀔 수 있어요. 만든 뒤 꼭 확인해 주세요.」 「단일 제품 사진에서 가장 잘 작동합니다」 문장은 지운다.
- **F5 생성** body `cutoutTempIds: items 의 누끼 id(순서 그대로)` · `cutoutTempId` 는 보내지 않는다. 그 밖 그대로.
- **F6 처음으로 · 언마운트** reset = `prepSeq` 올림 · 칸 전부 비움 · 미리보기 전부 해제. 훅 언마운트 정리 = `prepSeq` 올림 + 그때 칸의 미리보기 전부 해제(칸 목록은 ref 로 따라간다). DM 창 숨김은 언마운트가 아니므로 아무것도 하지 않는다.
- **F7 몰 창** 선택 속성 `max?: number` — 다 찼으면 새로 체크되지 않고 바닥 글 「최대 N개까지 고를 수 있어요 (k/N)」. 안 넘기면 지금 그대로.

## §4 계약 시험 (구현 전 · 이름 고정)

`packages/backend/src/utils/__tests__/image-studio-multi-product-1102.test.ts`

- **S1 묶기** 투명 바탕 위 사각형 3장 → 높이 1200 · 폭 = 장마다 폭 합 + 96×2 · 알파 있음 · 넣은 순서(첫 장 색이 왼쪽) · 아주 넓은 3장(1000×100) → 폭 3600 이하 · 극단 비(10000×10 두 장) → 폭 3600 이하 · 높이 1 이상 · 최소 1 보정 뒤 3600 을 넘는 반례(20000×10 두 장 · 3599×1 + 1×100 두 장) → `PRODUCT_TOO_LARGE` · 2,500만 화소 넘는 입력 → 거절(던짐).
- **S2 프롬프트** `productCount` 없음 · 1 = 지금 출력과 같다(같은 입력의 두 호출 비교 + 개수 줄 없음) · 2 · 3 = 개수 줄이 제품 보존 줄 바로 다음 · 마지막 제한 줄 · FINAL LAYOUT RULE 순서 그대로 · hasProduct 없으면 개수 줄 없음.
- **S3 요청 읽기** 0 · 1(옛 `cutoutTempId`) · 3 = 목록 · 4장 · 중복 · 글자 아님 · 배열 아님 = null.
- **S4 지문** 옛 화면 몸(`cutoutTempId` 생략 · null · id) 지문 = 지금 라우트 지문과 같은 키(셋 각각 옛 payload 로 만든 `studioAttemptKey` 와 비교) · 새 화면 배열은 순서가 바뀌면 다른 키.
- **S5 상한 한 값** 화면 `StudioMake.tsx` 의 `STUDIO_MAX_PRODUCTS` 숫자 = 서버 값(소스에서 읽어 비교).
- **S6 화면 계약(소스 읽기 · 칸 수명 표의 줄마다)** reset 첫 줄 = `prepSeq.current += 1` · 언마운트 정리에 `prepSeq.current += 1` 과 미리보기 해제 · 준비 묶음 = `++prepSeq.current` · 누끼 id 를 미리보기 받기 전에 칸에 넣는다 · 칸 빼기는 원본 · 누끼 실패 자리에만(미리보기 실패 catch 에는 빼기 없음) · 늦은 미리보기 해제 · **busyMsg 끄기는 준비 함수 안에 한 곳 · 사진마다 도는 반복이 끝난 뒤 · `if (live())`**(반복 안 · 사진별 finally 에 끄기 0 · Codex 설계 2R ②) · **준비 중 막힘**: 담기 두 단추 = `disabled={busy || full}` · 빼기 단추 = `disabled={busy}` · 만들기 = 스튜디오 `disabled={busy || !ready}`(busy 에 make.busyMsg 포함) · DM 창 `generating = !!make.busyMsg` · 생성 body = `cutoutTempIds` · 업로드 input `multiple` · 담기 = 남은 칸까지만 · 몰 창에 `max=`. (화면 시험 틀이 없어 동작은 소스 계약 + 직원 지시문 12 · 14 · 15 · 16번으로 본다.)
- **S7 라우트 순서(소스 읽기)** `/generate` 에서 지문(`studioProductFingerprint(req.body)`) → 시도 키 → 잠금 → `readProductTempIds` 거절 → `checkCredit` → 묶기 → `generatePoster(prompt, preset, cutout, { engine: studioImageEngine() })` 한 줄 그대로.
- 기존 `bug-1031-back-studio.test.ts` ② · Codex 1R 반례는 보호하는 성질(처음으로 = 늦은 응답 버림 · id 먼저)을 그대로 두고 새 코드 모양으로 옮긴다(느슨하게 바꾸지 않는다).
- 변이: S1(간격 0) · S3(상한 4) · S6(prepSeq 올림 삭제)로 빨간불 확인.

## §5 직원 지시문(초안 · 엑셀 = `docs/2026-11-02-image-studio-multi-product-staff-sheet.xlsx`)

계정 = 테스트계정 · 사진 = 화장품 제품 사진 4장(배경 단색 · 서로 다른 제품) · 화면 글자는 구현 뒤 같은 날 맞춘다(기대 결과는 바꾸지 않는다).

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정으로 로그인해 「이미지 스튜디오」를 연다 | 템플릿 고르는 화면 |
| 2 | 제품 템플릿 「클린 브라이트 뷰티」를 누른다 | 만들기 화면 · 상품 이미지 칸 머리에 「0/3」 |
| 3 | 「사진 업로드」로 사진 1장을 고른다 | 잠시 뒤 배경이 지워진 사진 1칸 · 「1/3」 |
| 4 | 「사진 업로드」로 사진 2장을 한 번에 고른다 | 사진 3칸(1·2·3 번호) · 「3/3」 · 「3개를 다 넣었어요」 한 줄 |
| 5 | 「사진 업로드」 · 「연동 몰에서」를 누른다 | 둘 다 눌리지 않는다 |
| 6 | 2번 사진의 빼기 단추를 누른다 | 사진 2칸 · 「2/3」 · 처음 사진이 1번 그대로 |
| 7 | 「사진 업로드」로 사진 3장을 한 번에 고른다 | 1장만 들어가 「3/3」 · 「최대 3개까지 … 앞의 1장만 넣었어요」 알림 |
| 8 | 헤드라인 칸에 「베스트 3종 기획전」을 넣고 만들기를 누른다 | 1분 안에 포스터 1장 · 넣은 제품 3개가 모두 보인다 |
| 9 | 화면 위 AI 크레딧 숫자를 본다 | 8번 전보다 2 적다 |
| 10 | 템플릿을 다시 고른다(새로 만들기) | 상품 이미지 칸이 비어 있고 「0/3」 |
| 11 | 사진 1장만 넣고 만들기를 누른다 | 제품 1개 포스터(지금과 같은 모습) |
| 12 | DM 만들기에서 이미지 스튜디오 창을 열고 3~5를 한다 | 3~5와 같다 |
| 13 | (연동 몰이 있는 계정만) 사진 2장을 넣은 뒤 「연동 몰에서」를 열고 상품 2개를 차례로 누른다 | 첫 상품만 체크 · 바닥에 「최대 1개까지」 |
| 14 | DM 만들기의 이미지 스튜디오 창에서 사진 2장을 한 번에 고른 뒤 「준비 중」 글이 떠 있는 동안 창을 닫았다가 10초 뒤 다시 연다 | 사진 2칸이 그대로 있고 「2/3」 · 「준비 중」 글이 없고 만들기가 눌린다 |
| 15 | 새로 만들기에서 파일 이름이 「1-사진.jpg」 「2-움짤.gif」 「3-사진.jpg」인 세 파일을 한 번에 고른다 | 「준비 중」 글이 뜬 동안 화면이 가려져 아무것도 눌리지 않는다 · 「준비 중」 글이 떠 있는 동안 움짤이 안 된다는 알림이 뜬다 · 그 뒤에도 「준비 중 (3/3)」 글이 보인다 · 끝나면 사진 2칸(1번 = 1-사진 · 2번 = 3-사진 · 둘 다 배경이 지워진 그림) · 「2/3」 · 「준비 중」 글이 사라지고 만들기가 눌린다 |
| 16 | 15번 상태에서 만들기를 누른다 | 포스터에 사진 2개의 제품이 모두 보인다 |

## §6-0 구조체크 · Codex 설계 기록(1102 ~ 1103)

| 회차 | 지적 | 처리 |
|---|---|---|
| 구조체크(직접) | 두 화면 모두 `make.busyMsg` 로 만들기를 막는다 → 묶음 준비 중 표시를 끝까지 유지해야 한다 | F3 · 칸 수명 표 「준비 중」 줄 |
| 구조체크(직접) | B3 폭 반올림 · 최소 1 보정이 3600 을 몇 px 넘길 수 있다 | H 계산에서 장수만큼 덜기 |
| Codex 설계 1R | ① 생략 · null 지문 합침 = 이중 차감 ② 폭 상한이 합성 뒤 = 중간 그림 무제한 ③ 미리보기 실패로 누끼 칸 제거 = 1031 회귀 ④ 언마운트 무효화 빠짐 | ① 지문 = 보낸 값 그대로 · 거절은 납부 확인 뒤 ② 배율 먼저 · 2,500만 화소 헤더 거절 ③ ④ 칸 수명 표 하나(같은 뿌리) |
| Codex 설계 2R | ① 최소 1 보정 뒤 3600 초과 반례 둘 ② S6 이 묶음 끝 해제 · 준비 중 막힘을 안 봄 | ① 정수 폭 합 검사 → 거절 · 반례 S1 ② S6 · 직원 15 · 16(③④와 같은 뿌리 = 칸 수명 · 시험 쪽 보강) |
| Codex 설계 3R | 직원 15 가 실패 사진 위치를 고정 못 함 | 여러 장 = 파일 이름 순 · 15 = 1-사진 · 2-움짤 · 3-사진 |
| Codex 설계 4R | 지적 0 | **approve** |
| Codex 구현 1R | 미리보기 대기 중 처음으로 → 미리보기 실패면 다음 사진으로 넘어가 표시를 켠 채 끝남(화면 잠김) | 칸 수명 지적이 네 번째 = 구조로: 준비 반복을 순수 함수 `lib/studio-products.ts` `runProductPrep` 로 꺼내 **반복 입구에 세대 관문 하나**(다음 사진으로 가는 모든 길) · 칸 수명 표 줄마다 동작 시험(S6-가 8건) · 변이(입구 관문 삭제 = 빨간불) |
| Codex 구현 2R | 지적 0 · **approve** · 다음 단계 = 동작 시험 두 행(원본 대기 중 처음으로 → 늦은 성공 · 마지막 칸 미리보기 대기 중 처음으로 → 실패) | 두 행 추가 · 변이(원본 뒤 관문 · 반복 끝 관문 삭제) 둘 다 빨간불 |
| Codex 구현 3R | 지적 0 | **approve** |

배포 순서(1103 · Harold 「여정쪽도 끝났는데 그냥 같이 배포해도되는거 아니냐?」): 운영 = 8372eb16(C94) · origin 에 C96(33f049c2 · 여정 세션 · 배포 대기)이 먼저 쌓여 있고 여정 세션 설계서 §8 = 「C96 은 D2 와 한 배포 · D2 가 먼저」 → 이 작업만 먼저 따로 = 불가(서버 pull 이 C96 을 데려간다) · 여정 뒤 따로 = 재시작 한 번 더(고객 화면 10~15초) → **여정 C96 · C98 과 한 배포**. 이 작업은 DDL · ENV · 의존성 0 이라 여정 배포 순서에 서버 단계를 더하지 않는다. 섞임 막기 = 커밋을 세션마다 따로(이 작업 10파일을 먼저 경로 지정 커밋 · push 직전 `origin/main..HEAD` = 이 커밋 + C98 둘).
커밋 자족 실측(1103): 작업 트리 사본에서 다른 세션 변경을 걷어낸 「HEAD + 이 10파일」 트리(되돌린 추적 파일 126 = HEAD blob 해시 126/126 일치 · 다른 세션 새 파일 20 삭제) = tsc 백엔드 0 · 프론트 0 · 변이(`lib/studio-products.ts` 뺌) = 프론트 오류 12.

뿌리 대장 점검표: R1(상한 두 벌 → 서버 판정 · S5 한 값) · R6(준비 칸 → 칸 수명 표 · 실패 = 제거 · 끝 = 표시 해제) · R8(재시도 없음 · 사람이 누른다) · R12(묶기 = 회사 생성 잠금 안) · R18(시계 칸 없음) · R4(성공 뒤 차감 그대로 · 거절 · 묶기 실패 = AI 전 미차감) · R21(sharp 기존 dependencies) — 결함 0.
변이(파일 복사 → 장치 끔 → 시험 → 원본 복구 cmp 확인): 간격 0 · 상한 4 · 폭 검사 끔 · reset 세대 올림 삭제 · 사진마다 표시 끄기 · 미리보기 실패에 칸 빼기 = 6건 모두 빨간불.

## §6 배포

DDL 0 · ENV 0 · 의존성 변경 0 · 서버 · 화면 같은 배포. 다른 세션 파일과 커밋을 섞지 않는다(이 작업 파일만 경로 지정 커밋 · 메모리 `feedback_no_combined_push_across_sessions`) · 서버 배포는 §6-0 끝 「배포 순서」대로 여정 C96 · C98 과 한 pull.

| 파일 | 이 작업 |
|---|---|
| `packages/backend/src/utils/image-studio.ts` | B1 ~ B4 |
| `packages/backend/src/routes/image-studio.ts` | B5 |
| `packages/frontend/src/components/studio/StudioMake.tsx` | F1 ~ F6 |
| `packages/frontend/src/lib/studio-products.ts`(새 파일) | F3 준비 반복(`runProductPrep` · 칸 수명 표 · 동작 시험 대상) |
| `packages/frontend/src/components/dm/MallProductPickerModal.tsx` | F7 |
| `packages/backend/src/utils/__tests__/image-studio-multi-product-1102.test.ts` | S1 ~ S7 |
| `packages/backend/src/utils/__tests__/bug-1031-back-studio.test.ts` | ② 옮김 |
| `docs/2026-11-02-image-studio-multi-product-design.md` · `…-staff-sheet.xlsx` · `docs/FEATURE-IMAGE-STUDIO.md` | 문서 |
