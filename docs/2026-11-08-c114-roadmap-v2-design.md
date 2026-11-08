# C114 · 로드맵 V2 설계서 — 인앱 웹뷰 호스트 + 옛 앱 서버 변환 · 할인 템플릿 · 제작 화면 · 템플릿 글자 (2026-11-08)

> 지시 = Harold 1108 「V2 나머지 전부 구현 · 인앱표 제대로 점검해서 왜 안 나오는지 원인을 무조건 찾아 · V2 완벽한 설계서 · 구조체크 닫힐 때까지 · Codex 닫힐 때까지 · 구현 끝까지 · Codex 닫힐 때까지 · 보고」 · 앱 방향 = 「추천대로」(웹뷰 한 번 붙이기 + 옛 앱 서버 변환).
> 원장 = `status/ROADMAP.md` §V2 · 결함 처리 순서 = `status/DEFECT-PLAYBOOK.md` · 직원 시트 = 로드맵 끝난 뒤 한 번(Harold 1107).

## §0 접수 대조표(Harold 원문 → 이 설계의 칸 · 이 칸이 없으면 접수가 닫히는가)

| # | Harold 원문(요지) | 칸 | 없으면 |
|---|---|---|---|
| J1 | 「사진 위 글」 여러 장 = 실제 앱에서 위 「NATURE」가 잘림 · 편집 화면은 보임(1107) | I-3 그리는 규칙 하나(잘림 0) + I-2 옛 앱 그림 미리 맞춤 | 안 닫힘 |
| J2 | 「통짜 포스터」 · 「통짜 포스터 카드」 게시해도 앱에 안 나옴(1107) | I-1 웹뷰 호스트 + I-2 옛 앱 변환(내보내지 않음 0) | 안 닫힘 |
| J3 | 「통짜 포스터 카 / 드」 줄바꿈(1107) | I-5 라벨 | 안 닫힘 |
| J4 | 「다 맘에 안 든다」(1107) | §2 흐름 표 전체(모양 7 × 장 수 × 클라이언트) | 안 닫힘 |
| J5 | 「사진 위 글 카드도 안 나와」(1107) | I-1 + I-2 | 안 닫힘 |
| J6 | 「뭐가 어디까지 되는지 알 수가 없네 · 제대로 체크해라」(1107) | §2 흐름 표 + I-4 편집기 안내 = 실제 | 안 닫힘 |
| J7 | 「업체가 어떻게 빌드돼 있는지 모르는데 · 앱 버전 올려라 할 수 없잖아 · 범용적으로」(1108) | D1 · I-1 · I-2 | 안 닫힘 |
| J8 | 할인 템플릿 = 혜택을 예쁘게 만든 템플릿 · 맨 위 제품명 · 그 밑 빗금 가격 › 판매가 · 2+1 · 제품 자리 정해 둠 · 숫자 칸(1107) | B 할인 템플릿 | 안 닫힘 |
| J9 | 「오픈 AI 로 가자」(1108) | D5 | 안 닫힘 |
| J10 | 「기존 템플릿들도 텍스트가 너무 보기에 작고 디자인적으로 별로」(1108) | D 글자 바닥 | 안 닫힘 |
| J11 | V2 「제작 화면 정리」 · 「브랜드 색」(1107 로드맵) | C 제작 화면 · E 브랜드 색 | 안 닫힘 |

## §1 결정

| # | 결정 | 근거 |
|---|---|---|
| D1 | **앱 인앱 = 웹뷰 호스트(계약 v5) 권장 · 옛 앱 = 서버가 그 앱이 그릴 수 있는 꼴로 바꿔 보낸다(내보내지 않음 0)** | Harold 1108 「추천대로」 · J7 |
| D2 | 웹뷰 페이지 = 우리 서버의 정적 HTML 한 장 + 웹 SDK 렌더러 · **API 호출 0**(fetch · XHR · sendBeacon 0 = CSP `connect-src 'none'` · 메시지 JSON 은 앱이 넣는다 · 기록 · 이동 · 닫기 · 복사는 다리로 앱에 넘긴다) · 정적 자원 GET(SDK 파일 · 그림 · 글꼴)은 받는다(Codex 설계 1R ③) | 비밀값 · 신원 · 출처 검사가 페이지에 없다 · 앱의 기존 빈도 · 기록 · 이동 로직을 그대로 쓴다 |
| D3 | 그리는 규칙 하나 = 웹 SDK `poster-frame.ts`(C106 틀) · **사진 위 글(overlay)도 이 틀로 그린다**(한 장 = 원본 비율 · 여러 장 = 3:4 상자 맞추기) · 이벤트 카드 사진 = 원본 비율 | J1 · 「형태마다 잘림 0」 · 편집 미리보기는 같은 부품 사본(`sync-poster-frame.mjs`) |
| D4 | 옛 앱 그림 미리 맞춤 = 이미 있는 서빙 CT `image-serve.ts` `?fit=` 에 비율 `4x5` · `4x3` 추가(맞추기 pad · 잘림 0) | 새 장치 0 · 같은 CT 재사용 |
| D5 | 할인 템플릿 생성 엔진 = OpenAI(`STUDIO_IMAGE_ENGINE=openai` 그대로) · 숫자 = 생성 모델이 그린다(프롬프트로 틀 · 크기 · 숫자 그대로) | Harold 1108 · 샘플 12/12 숫자 그대로(`status/ROADMAP.md` §V2 1108) |
| D6 | 할인 템플릿 = 새 트랙 kind `'discount'` · 화면 이름 「할인 포스터」 · 템플릿마다 혜택 꼴 `offer` 하나(`price` · `nplus` · `set`) · 기간 · 증정은 모든 꼴 선택 칸 | J8 · 회의 합의 §B 의 세 꼴 |
| D7 | 할인율 = 입력 없음 · `(할인 전 − 판매가) × 100 ÷ 할인 전` 정수 내림 · 1 미만 = 줄 없음 | 회의 합의 §B · 샘플 스크립트와 같은 식 |
| D8 | 숫자 확인 = 결과 카드에 「포스터에 들어간 숫자」 한 줄(보낸 값 그대로) · 숫자 판독 호출은 이번에 안 붙인다 | 샘플 12/12 · 원가 0 · 다음 판 = 실패가 보고되면 |
| D9 | 기존 템플릿 글자 = 프롬프트 공용 줄 하나(폰 화면 글자 바닥 · 모든 포스터) · 템플릿 782종 데이터는 안 고친다 | J10 · 한 곳 |
| D10 | 브랜드 색 = 브랜드 키트 `primary_color`(없으면 `accent_color`) 가 있으면 할인 포스터 강조색 한 줄 · 서체 지정은 하지 않는다(생성 모델이 서체를 고정하지 못한다) | J11 · 회의 합의 「색 · 서체 = 가격 판」이 접혔으므로 할인 포스터로 |
| D11 | 제작 화면 = 회의 합의 §C 를 그대로(흰 카드 하나 · 머리 안내 한 줄 · 칸 이름 · 상품 먼저 · 만들기 고정 바 · 9 · 10px 글자 0) · 목업 승인 단계는 Harold 「전부 완료」로 갈음 | J11 |
| D12 | 팝폰 앱 = 웹뷰 호스트로 바꾼다(`react-native-webview` = 네이티브 모듈이라 OTA 불가 · 스토어 빌드 한 번 = Harold) · 빌드 전까지 팝폰은 D1 옛 앱 변환으로 보인다 | 지금 판 = 커밋 0720(v2) · 「그때 이후로 한 게 없는 것 같다」(Harold 1108 · 미검증) |

## §2 흐름 표 — 인앱 모양 × 장 수 × 클라이언트(「뭐가 어디까지 되는지」 · J4 · J6)

### 2-1 이음매(쓰는 쪽 · 읽는 쪽 · 뽑은 패턴)

| # | 이음매 | 쓰는 쪽 | 읽는 쪽 |
|---|---|---|---|
| T1 | 모양 키 → design 세 키 | 편집기 `inappSlides.ts` `designForKey` · `layoutKeyOf` | 서버 `sanitizeInAppDesign` · SDK · 앱 |
| T2 | 조회 | 웹 SDK `inapp.ts` `fetchAndRender`(caps = `INAPP_SDK_CAPS` 넷) · 팝폰 `inapp-core.ts:28-34` `buildActiveUrl`(caps 없음) | `cdp.ts:654` `/inapp/active` → `parseInAppClientCaps` |
| T3 | 서빙 관문 | `inapp-message.ts:643-655` `inAppRequiredCaps`(hard · soft) | `:1438-1446` `gateInAppForClient`(hard 빠짐 = null · soft 빠짐 = 틀 지움) · `:1865` |
| T4 | 통짜 사본 | `inapp-message.ts` `toServedMessage`(글 비움 · 대체 글) | SDK · 앱 |
| T5 | 그리기(웹 SDK) | `inapp.ts:808` `renderMessage` → `usesPosterFrame`(통짜 · 카드 · 띠) = `renderPosterFrame:1395` / overlay 1장 = `renderPoster:1037`(원본 비율) / overlay 여러 장 = `renderPosterCarousel:1236`(**4:5 cover** `:1285`) / event_card · banner_sheet = `renderPosterSheet:1587`(사진 **4:3** `:1679`) | 몰 화면 |
| T6 | 그리기(편집 미리보기) | `PosterSheetPreview.tsx`(overlay 여러 장 **4:5 cover** `:180` · event_card **4:3** `:243`) · 새 틀 = `generated/poster-frame.ts`(SDK 원본 사본) | 편집기 · 갤러리 |
| T7 | 그리기(팝폰 커밋판 0720 v2) | `InAppBottomSheet.tsx`(포스터 한 장 = 원본 비율 · 높이 66% 상한 cover · 글이 비면 막 0 = `7cbdbd3` `message.title \|\| message.body \|\| message.badgeText`) · 여러 장 · 이벤트 카드 · 배너 = 커밋판에 없음(작업 트리 미커밋 = 4:5 cover `:144` · `:165`) | 앱 화면 |
| T8 | 편집기 안내 | `inappSlides.ts:270-276` `appCapsNote`(`APP_CONFIRMED_CAPS` 빈 집합 → hard = 「앱 새 판이 깔린 뒤 보여요」 · soft = 「앱 새 판 전에는 바닥 시트로 보여요」) · `PosterEditor.tsx:374` | 편집기 |
| T9 | 앱 계약서 | `AppIntegrationContract.tsx`(v2 · v3 · v4 네이티브) | 업체 개발자 |
| T10 | 그림 서빙 | `cdp.ts:618` `/inapp/image/:companyId/:filename`(`?fit=` 읽음) · `:641` `/inapp/example-image/:id/:slide`(`?fit=` 안 읽음) → `image-serve.ts` `getServePath` · 비율 표 `image-fit-spec.ts:12` = `1x1` 하나 | SDK · 앱 |

뽑은 패턴: `grep -rn "poster_layout\|poster_text\|poster_frame\|posterLayout" packages poppon-app/src/lib/hanjul` · `grep -n "aspectRatio\|objectFit\|maxHeight" packages/sdk-js/src/inapp.ts packages/frontend/src/components/inapp/PosterSheetPreview.tsx poppon-app/src/lib/hanjul/*.tsx`.

### 2-2 실물(1108 · Harold 서버 조회)

앱 채널 최근 7일 = 테스트계정 2건 · 「헬로윈파티 (~10/30)」 active · full_image · frame = card · 장 3(= 사진 위 글 카드 · 여러 장 → hard `frame_card` → 팝폰(caps 없음)에 null) · 「한줄로 AI OPEN」 archived · overlay · 장 3. 통짜로 바꿔 게시하던 메시지 = 같은 행(마지막 저장 = 카드).

### 2-3 판정 표(지금 → 고친 뒤)

클라이언트: **웹** = 웹 SDK(caps 넷) · **웹뷰 앱** = v5(새) · **옛 앱** = caps 없음(팝폰 지금 · v2 ~ v4 네이티브 업체 앱).

| 모양 | 장 | 웹 지금 | 옛 앱 지금 | 웹 · 웹뷰 앱 고친 뒤 | 옛 앱 고친 뒤 |
|---|---|---|---|---|---|
| 통짜 포스터 | 1 | 틀 · 원본 비율 | **안 나옴**(hard) | 같음 | 그림 한 장 · 글 0(막 0) · 원본 비율 |
| 통짜 포스터 | 2+ | 틀 · 3:4 상자 | **안 나옴** | 같음 | 넘기기 · 장 그림 4:5 미리 맞춤(잘림 0) · v2 앱 = 첫 장 |
| 통짜 포스터 카드 | 1 · 2+ | 카드 | **안 나옴** | 같음 | 틀 지움(바닥 시트) + 위 두 줄 |
| 사진 위 글 | 1 | 원본 비율 | 원본 비율 | 틀(시트 · 글 얹기) · 원본 비율 | 같음(지금) |
| 사진 위 글 | 2+ | **4:5 cover = 잘림** | **4:5 cover = 잘림**(미커밋판) · v2 = 첫 장 | 틀 · 3:4 상자 맞추기(잘림 0) | 장 그림 4:5 미리 맞춤(잘림 0) |
| 사진 위 글 카드 | 1 | 카드 | 바닥 시트(soft) | 같음 | 바닥 시트 |
| 사진 위 글 카드 | 2+ | 카드 | **안 나옴**(hard) | 같음 | 바닥 시트 넘기기 · 4:5 미리 맞춤 |
| 쿠폰 · 남은 시간 띠 | 아무 | 띠 | **안 나옴**(hard) | 같음 | 글 한 줄로(「쿠폰 코드 ABC」 · 「11월 30일 23:59까지」) |
| 이벤트 카드 | 1 · 2+ | 사진 **4:3 cover = 잘림** | v3 앱 = 4:3 cover · v2 = 포스터 | 사진 원본 비율(잘림 0) | 장 `image_fit = contain`(v3 잘림 0) |
| 배너 시트 | 아무 | contain | v3 contain | 같음 | 같음 |
| 가운데 팝업 · 하단 시트 | – | 그대로 | 그대로 | 그대로 | 그대로 |

**미검증** = 팝폰 설치본의 판(Harold 「그때 이후로 한 게 없는 것 같다」) · J1 에서 편집 화면은 보이고 앱만 잘린 차이(설치본 판 · 기기 높이 · 그림 비율 중 무엇인지) — 고친 뒤는 셋 모두 잘림 0 규칙이라 같은 결과.

## §3 처방

### I-1 웹뷰 호스트(계약 v5)
- **페이지** `GET /api/cdp/inapp/webview`(공개 · 정적 · 인증 0 · CSP nonce · 투명 바탕) = SDK `/api/cdp/sdk/v0.3.11/hanjul.min.js` + 부팅 글 한 덩이. `window.HanjulInApp.render(payload)` · `message` 이벤트(RN `postMessage`) 둘 다 받는다. payload = `/inapp/active` 응답의 메시지 한 개 + `serverNow`(+ `customer`).
- **SDK** `renderInAppForHost(payload, bridge?)`(index.ts 공개) → `HanjulloInAppModule` 을 호스트 모드로 만들어 `renderMessage` 한 번. 호스트 모드에서:
  - **보임 신호 = `{type:'ready', messageId}` 한 번**(Codex 설계 1R ②) = 메시지 루트의 첫 장 그림(그 순간 보이는 장)이 `load` + `decode` 를 마친 뒤 · 그림이 없는 메시지 = 다음 그리기 틀(rAF) 뒤 · 첫 그림 `error` 또는 8초 안에 안 들어옴 = `{type:'failed', messageId}`(앱은 웹뷰를 보이지 않고 닫는다 · 기록 0)
  - **impression 은 앱이 기록**(`ready` 를 받아 웹뷰를 보인 순간 한 번) · 호스트 모드 SDK 는 `renderMessage` 의 impression 을 다리로도 보내지 않는다(이중 0)
  - **준비 중 숨김 = 실제 크기 그대로 투명(opacity 0)**(Codex 설계 2R · 크기 0 · display none · 화면 밖 배치 금지 = 그림이 안 들어온다) · 호스트 모드는 메시지 루트의 모든 그림을 `loading = 'eager'` 로 바꿔 숨긴 동안에도 받는다 · `failed` 뒤 늦은 `load` = 사건 0(ready · failed 는 합쳐 한 번)
  - `track`(click · dismiss · opt_out) → 다리 `{type:'track', messageId, event, buttonId, dwellSeconds}`(API 호출 0)
  - `safeNavigate` → `{type:'navigate', url, messageId}`
  - 메시지 DOM 이 사라지면 → `{type:'close', messageId}`(한 번)
  - 다시 보지 않기 · 하루 보지 않기 → `{type:'optout' | 'snooze', messageId}`
  - 쿠폰 복사 → 페이지 복사 시도 + `{type:'copy', text}`
  - 다리 찾기 순서 = `ReactNativeWebView.postMessage(JSON)` → `webkit.messageHandlers.hanjulInApp.postMessage(obj)` → `HanjulInAppAndroid.postMessage(JSON)` · 셋 다 없으면 이동 = `location.href` · 나머지 = 버림.
- **서버** `INAPP_CLIENT_CAPS` 에 `webview` · `parseInAppClientCaps` 가 `webview` 를 받으면 SDK 판 넷을 함께 넣는다(웹뷰 = SDK 가 그린다).
- **앱 할 일(계약서 v5)** = 조회 주소에 `caps=webview` → 보일 메시지를 고른다(빈도 · 지금 로직) → 투명 전체 화면 웹뷰로 페이지를 열고 그 메시지를 넣는다 → 다리 사건대로 기록(`/inapp/track`) · 이동 · 닫기 · 복사. 앱 코드는 이것 한 번 · 모양이 늘어도 다시 안 고친다.

### I-2 옛 앱 서버 변환(`gateInAppForClient` 한 곳 · null 0)
caps 에 없는 판마다(웹 SDK · 웹뷰는 다 있어 변환 0):
1. `frame_card` 없음 = 틀 지움(장 수 무관 · 지금 soft 와 같은 동작을 hard 에도).
2. `poster_baked` 없음 = 그대로 보낸다(`toServedMessage` 가 글을 비운다 · 옛 앱은 글이 비면 막을 안 그린다 = T7).
3. `strip_coupon` 없음 = 띠를 지우고 글 한 줄 `쿠폰 코드 {code}` 를 첫 장 본문 끝(통짜는 비운 본문 자리)에 · `strip_countdown` 없음 = `{M월 D일 HH:mm}까지`(메시지 `end_at` · 한국 시각 · 없으면 줄 없음).
   **대체 줄을 넣은 통짜 = 서빙 사본에서 `poster_text` 를 지워 글 얹기로 내린다**(Codex 설계 1R ① · `poster_baked` 만 가진 앱 · SDK 틀은 통짜면 본문을 그리지 않는다 `poster-frame.ts:265` · `:361-368` · 글은 `toServedMessage` 가 이미 비웠으므로 그림 위에 대체 줄 하나만 얹힌다).
4. 여러 장(overlay 갈래 = 통짜 · 사진 위 글 · 카드 지운 것) = 장 그림 주소에 `?fit=4x5` (우리 그림 주소 두 꼴만 · 남의 주소 = 그대로).
5. 이벤트 카드 = 장 `image_fit = 'contain'`.
변환은 서빙 사본만(저장 행 무변경) · 순수 함수 `legacyServeTransform(m, caps, now)` 하나 · 순서 = 관문(틀 지움) → `toServedMessage` → `legacyServeTransform`(K1).

### I-3 그리는 규칙 하나(잘림 0)
- `poster-frame.ts` `usesPosterFrame` = 포스터 갈래 overlay(사진 위 글)면 늘 참 → overlay 1장 · 여러 장도 새 틀(한 장 = 원본 비율 · 여러 장 = 3:4 상자 · 남는 자리 바탕 = 규칙 상수).
- 이벤트 카드 사진 상자 = 그림이 들어온 뒤 원본 비율(높이 상한 넘으면 폭을 줄인다 · cover 0) · SDK `renderPosterSheet` · 편집 미리보기 `PosterSheetPreview` 같은 규칙.
- 편집 미리보기 = 같은 부품 사본(`npm run sync:poster-frame` 계열 · 사본 직접 수정 0).

### I-4 편집기 안내 = 실제
- `appCapsNote` = 앱 채널에서 옛 앱이 다르게 보이는 것만 말한다: 카드 = 「옛 앱에서는 바닥 시트로 보여요」 · 띠 = 「옛 앱에서는 쿠폰 코드 · 남은 시간이 글로 보여요」 · 통짜 · 사진 위 글 = 안내 0. `hidden` = 늘 거짓(내보내지 않음 0). 게시 확인 창 같은 줄.
- `PosterEditor.tsx:374` 「옛 앱에는 보내지 않아요」 문구 = 위 줄로.

### I-5 라벨 줄바꿈
- 모양 카드 이름(`InAppEntryGallery.tsx` · `PosterEditor.tsx` 모양 바꾸기 · `InAppFramePicker.tsx`) = `break-keep`(낱말 중간 끊김 0) · 좁으면 두 줄은 허용(낱말 단위).

### I-6 앱 계약서
- `AppIntegrationContract.tsx` 맨 앞 = 「v5 웹뷰(권장) — 한 번 붙이면 모양이 늘어도 앱을 다시 안 고칩니다」(페이지 주소 · 넣는 값 · 다리 사건 표 · RN · iOS · 안드로이드 다리 이름) · v2 ~ v4 = 「옛 네이티브(그대로 동작 · 서버가 맞춰 보냄)」로 내린다.

### I-7 팝폰 앱(별도 저장소 `poppon-workspace/poppon-app`)
- `react-native-webview` 추가 · `InAppWebViewHost.tsx`(새) · `InAppHost.tsx` = 메시지를 웹뷰로 · `inapp-core.ts` `buildActiveUrl` 에 `caps=webview` · 기록 · 이동 · 빈도 = 지금 로직 재사용.
- 선행 = 인앱 폴더 미커밋 5파일을 Harold 가 먼저 커밋 · 이후 스토어 빌드(OTA 아님) = Harold.

### B 할인 템플릿
- **CT** `utils/studio-discount.ts`(새) = `DISCOUNT_OFFERS` · `readDiscountOffer(raw)`(검사 · 400 이유) · `discountRate` · `wonText` · `discountPromptLines(offer, brandColor)` · `discountExpectText(offer)`(결과 카드 확인 줄 · 화면은 같은 규칙의 사본 0 = 서버가 응답에 넣는다).
  - price: `before` · `sale` 정수 · `0 < sale < before ≤ 100,000,000`
  - nplus: `n` · `m` 1 ~ 9 · `unit` 정수 1 ~ 1억 · 그림 = `{n+m}개 {unit×(n+m)}원 빗금 › {unit×n}원` + 표지 `{n}+{m}`
  - set: `items` 2 ~ 3(이름 1 ~ 20자 · 금액 · % 꼴 금지) · `prices` 같은 수 · **각각 양의 정수 1 ~ 1억 · 합 ≤ 1억 · `sale` 양의 정수 · 0 < `sale` < 합**(Codex 설계 1R ④) · 그림 = 구성 줄 + `따로 사면 {합}원` 빗금 › 할인율 › `세트가 {sale}원`
  - 공통 선택 = `period`(1 ~ 20자 · 날짜 · 시각 숫자 허용 · 금액 · % 금지) · `gift`(1 ~ 20자 · 금액 · % 금지)
- **카탈로그** `image-studio-templates-discount.ts`(새) = 8종(샘플로 확인한 6 + 세트 2) · `kind:'discount'` · `category:'할인·혜택'` · `offer` · 문구 기본값 = `{productName}` 만(가격 토큰 0) · `listTemplatesPublic` 에 `offer`.
- **프롬프트** `buildPosterPrompt` 에 `offer?` · 할인형 = 지정 문구(제목 = 제품명) 뒤 혜택 줄 · 마지막 금지 줄 앞 · 맨 끝 고정 틀 줄(샘플 스크립트 그대로 옮김) · 강조색 줄(D10).
- **/generate** = 할인형이면 `offer` 검사(잠금 · 차감 · 생성 전 400 + 칸 이름) · 제목 필수 · 시도 키 지문에 `offer`(숫자가 다르면 다른 포스터) · 응답에 `discountCheck`(확인 줄).
- **다른 길** = 할인형 제외: AI 영업 자동 풀 · 한 줄 헤드라인 · 인앱 예시 시작본 · 예시 일괄 스크립트(`studio-samples.ts make`)(할인 예시 = 샘플 스크립트 `--save`).
- **화면** = 트랙 셋째 탭 「할인 포스터」 · 할인형 칸 = 제품명 + 혜택 꼴별 숫자 칸(숫자 · 쉼표만 · 해석값 곁에) + 기간 · 증정 · 몰 상품 1클릭 자동(정가 = 할인 전 · 판매가 · 할인 중 아니면 판매가 칸 비움) · 만들기 바 = 「포스터에 들어갈 숫자」 한 줄.

### C 제작 화면(회의 합의 §C 그대로 · 공용 `StudioMakeFields` = 스튜디오 · DM 창 함께)
- 흰 카드 한 장 + 가는 선 구역 · 카드 머리 한 줄 「입력한 글자가 그대로 새겨져요 · 혜택 · 숫자는 직접 넣어요」 · 칸 위 이름(11px) · 안내 12px · 9 · 10px 글자 0 · 구역 순서 = 제품 · 할인: 상품 → 혜택 → 문구 → 장면 힌트(접힘) / 행사: 문구(+ 위치) → 제품(접힘) → 장면 힌트 · 헤드라인 예시의 숫자 예(「30% 할인 · 2+1」) = 숫자 없는 예 + 「가격 · 할인은 할인 포스터에서 정확히」 · 스튜디오 만들기 = 아래 고정 바(왼쪽 = 템플릿 · 상품 n/3 · 할인 숫자 한 줄 · 「2크레딧 · 성공했을 때만 차감」 / 오른쪽 = 만들기).

### D 글자 바닥(모든 포스터)
- `buildPosterPrompt` 마지막 금지 줄 바로 앞에 한 줄: 「Legibility floor for phone screens: the headline must be large and bold (at least about 5% of the poster height), any secondary line at least about 2.5%, never thin hairline weights for the headline, no tiny fine print.」 · 글 없는 포스터 = 줄 0.

### E 브랜드 색
- 할인형만 · `getCompanyBrandKitRaw` 의 `primary_color` → 없으면 `accent_color` · `#` 6자리 hex 일 때만 「Use the brand color {hex} as the accent for the badge, the discount rate and the sale price.」

## §4 영향표(전 소비처 · 기존 동작 바뀜 표시 ★)

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| `gateInAppForClient` null → 변환 | `/inapp/active`(웹 · 앱) · `evaluateInAppCandidates` 가 null 을 거르는 `.filter` | ★ 옛 앱이 받는 메시지 수 늘어남(안 나오던 것이 나옴) · 웹 = caps 넷이라 변환 0 |
| `parseInAppClientCaps` `webview` | 같은 곳 | 새 낱말만 · 옛 낱말 그대로 |
| `ASPECT_RATIOS` + `4x5` · `4x3` | `image-serve.ts` `parseFitOption` · `getServePath`(cdp · dm 서빙) · `image-fit-spec.ts` 다른 소비처 grep | 표에 키만 늘어남 · `1x1` 동작 그대로 |
| `example-image` 서빙 `?fit=` | 예시 갤러리 · SDK | 꼬리 없으면 그대로 |
| `usesPosterFrame` overlay 참 | SDK `renderMessage` · 편집 미리보기 · 갤러리 썸네일 | ★ 몰 화면 사진 위 글 = 새 틀 모양(점 → 쪽 번호 · 4:5 → 3:4 맞추기) |
| 이벤트 카드 사진 비율 | SDK · 미리보기 | ★ 사진 상자 높이가 그림 비율대로 |
| `appCapsNote` 문구 · hidden | 편집기 모양 고르기 · 게시 확인 · `PosterEditor` | 문구만 |
| `buildPosterPrompt` 글자 바닥 줄 | 스튜디오 /generate · DM 창 · 인앱 스튜디오 · AI 영업 · 한 줄 헤드라인 · 예시 스크립트 · /edit 원 프롬프트 재사용 | ★ 모든 새 포스터 글자 커짐(의도 · J10) |
| `buildPosterPrompt` `offer` | 할인형만 | 다른 템플릿 출력 = 글자 바닥 줄 말고 그대로 |
| 카탈로그 + 8 · `TemplateCategory` + 1 | 갤러리 · 카테고리 표 · 계약 시험(카탈로그 수 · 문구 숫자 0 규약) · AI 영업 · 한 줄 · 인앱 예시 | 할인형은 영업 · 한 줄 · 인앱 예시에서 뺀다 |
| `/generate` 시도 키 지문 + offer | 같은 시도 재요청 | 할인형만 · 다른 템플릿 키 그대로(offer 없음 = 키에 안 들어감) |
| `StudioMakeFields` 재배치 | 스튜디오 · DM 스튜디오 삽입 창 | ★ 화면 모양 |
| 계약서 v5 | 업체 개발자 | 안내만 |
| 팝폰 앱 | 팝폰 | 스토어 빌드 뒤 |

## §5 시험
- **CT-V1 서빙 변환 표**(순수) = 모양 × 장 수 × caps(없음 · 넷 · webview · **일부**: poster_baked 만 · frame_card 만 · strip 하나만) → 결과(null 0 · 틀 · 글 줄 · 통짜 강등 · fit 꼬리 · image_fit) · 대체 줄이 든 사본을 SDK 틀 판정(`usesPosterFrame` · baked)으로 다시 읽어 그 줄이 그려지는 쪽인지 · 변이 = 변환 끄면 null 이 나와 빨간불.
- **CT-V2 webview caps** = `parseInAppClientCaps('webview')` ⊇ SDK 넷.
- **CT-V3 호스트 다리**(SDK vitest · DOM) = 호스트 모드 렌더 → 그림 `loading` 이 전부 `eager` · ready(그림 load 뒤 · 감싼 상자 opacity 0 상태에서도) · failed(error · 시한) · ready · failed 합쳐 한 번 · track(click · dismiss · opt_out) · navigate · close 한 번 · optout · copy 사건 · impression 다리 0 · `fetch` · `XMLHttpRequest` · `sendBeacon` 호출 0 · 웹뷰 페이지 응답 CSP 에 `connect-src 'none'`.
- **CT-V4 잘림 0** = SDK · 미리보기 소스에서 `objectFit: 'cover'` + 고정 `aspectRatio` 조합이 포스터 갈래 이미지에 0(기계 추출) · overlay → 틀 경로.
- **CT-V5 할인 CT** = 사례 표(562,000 → 494,000 = 12 · 1,000 → 800 = 20 · 250,000 → 217,510 = 12 · 10,000 → 9,950 = 줄 없음 · 판매가 ≥ 할인 전 = 400 · N 0 · 10 = 400 · 세트 합 · 이름 금액 꼴 400) · 프롬프트 줄 = 샘플 스크립트 확인 문장과 같은 꼴.
- **CT-V6 할인형 길 제외** = kind 비교 자리 기계 추출 표(영업 · 한 줄 · 인앱 예시 · 예시 스크립트)에 할인형 0.
- **CT-V7 글자 바닥 줄** = 글 있는 프롬프트 = 줄 1 · 글 없음 = 0 · 마지막 금지 줄보다 앞.
- **CT-V8 라벨** = 모양 이름을 그리는 자리 셋에 `break-keep`.
- 백엔드 시험 전체 · tsc 0(백엔드 · 프론트 · SDK) · SDK vitest · 실 PG = 새 SQL 0(DDL 0).

## §6 배포(실행 = Harold · 이번 지시 = 구현까지)
DDL 0 · 백엔드 · 프론트 · SDK 서빙 파일(`backend/sdk-serving`) 한 배포 → 할인 예시 = 샘플 스크립트 `--save`(OpenAI · 장당 약 $0.067 × 8) → 팝폰 = 인앱 폴더 커밋 → 스토어 빌드.

## §7 범위 밖(기록만)
- 4순위(다른 채널 형태 맞춤 · 9:16) · 숫자 판독 호출 · 세트 3 + 증정 사진 · 기획전 가격표 · 쿠폰 · 적립금 — 다음 판.
- 팝폰 작업 트리의 인앱 밖 미커밋 변경(.env · auth · push 등) — 손대지 않는다.

## §8 구조체크(1108 · 이음매 T1 ~ T10 를 따라감 · 찾은 것 = 처방에 반영)

| K | 찾은 것 | 처방 |
|---|---|---|
| K1 | 옛 앱 변환이 `toServedMessage` 앞이면 통짜 글 비움이 쿠폰 · 기간 줄까지 지운다 | 순서 = 관문(틀 지움) → `toServedMessage` → `legacyServeTransform`(글 줄 · fit · image_fit · 띠 지움) |
| K2 | 편집기 「옛 앱」 미리보기(`PosterEditor.tsx:245-252` `legacyApp` · `legacyHidden` 「옛 앱에는 이 메시지가 보이지 않아요」)가 변환 뒤와 다르다 | `legacyHidden` 삭제 · 옛 앱 미리보기 = 변환 결과(틀 지움 · overlay · 통짜 글 0 · 띠 = 글 줄) · `PosterSheetPreview` overlay 여러 장 = 맞추기(contain · 4:5 미리 맞춤과 같은 결과) |
| K3 | 미리보기 분기 자리 넷 = `PosterEditor.tsx:252` · `:509` · `InAppExampleGallery.tsx:42`(= `usesPosterFrame`) · `InAppEntryGallery.tsx:40-58`(모양 키로 직접 분기 · overlay = 시트) | 넷 다 `usesPosterFrame(designForKey(k))` 한 판정 · overlay = 틀 |
| K4 | overlay 를 틀로 옮기면 기존 사진 위 글의 색 · 크기가 바뀌는가 | 바뀌지 않는다 — 틀이 같은 폴백 사슬(장 → `design.poster_*` → 기본)을 읽는다(`poster-frame.ts:344-368`) · 편집 칸은 live_card 와 같은 칸 |
| K5 | 웹뷰에 메시지를 넣는 길 · 깜빡임 | RN = `injectedJavaScriptBeforeContentLoaded` 로 `window.__HJL_INAPP__` · 네이티브 = 로드 뒤 `HanjulInApp.render(json)` · 앱은 `ready` 사건을 받은 뒤 웹뷰를 보이고 impression 을 기록한다(Codex 설계 1R ② · `failed` = 닫음) |
| K6 | 할인형이 인앱 글 없는 장 창 · 한 줄 헤드라인 창에 나오면 글 없는 할인 포스터가 생긴다 | `TemplatePicker` 허용 트랙 prop · 인앱 · 한 줄 창 = 제품 · 행사만 · 스튜디오 · DM 창 = 셋 |
| K7 | 할인형 제품 사진 | 제품 트랙과 같은 규칙(`image-studio.ts:402` `isProduct` 계열 = 할인 포함) |
| K8 | 호스트 모드 기록 | impression = 앱이 `ready` 뒤 한 번(SDK 다리 0) · click · dismiss · opt_out = 다리 · 페이지 API 호출 0 |
| K9 | helmet 기본 CSP 가 인라인 부팅 글 · `<style>` 주입을 막는다 | 이 페이지만 CSP 헤더를 덮어쓴다(script = self + nonce · style = self · inline · Google Fonts · font = gstatic · data · img = https · data · blob · connect = none) |

## §9 기록
- 1108 작성 · 구조체크 K1 ~ K9 반영 · Codex 설계 = 아래에 라운드별로 적는다.
- Codex 설계 1R = 지적 4(① 일부 caps 통짜 + 대체 줄 소실 · ② impression ≠ 보임 · ③ 「네트워크 0」 과장 · ④ 세트 검사 양수 · 상한) → ① 통짜 강등 · ② ready / failed 사건 + 앱이 impression · ③ 「API 호출 0」 + CSP connect-src · ④ 양의 정수 · 합 상한. 같은 뿌리 = 없음(첫 라운드).
- Codex 설계 2R = 지적 1(숨긴 웹뷰 + lazy 그림 = ready 막힘) · 1R ② 처방의 빈 곳(같은 자리 · 새 부류 아님) → 준비 중 = 실제 크기 투명 · 호스트 모드 그림 eager · ready · failed 한 번.
- **Codex 설계 3R = approve**(지적 0 · 1108).
- **구현(1108)** — 백엔드: `inapp-message.ts`(`INAPP_WEBVIEW_CAP` · `gateInAppForClient` null 0 · `legacyServeTransform` · `withInAppImageFit` · `inAppDeadlineText` · 관문 → 통짜 → 옛 앱 순서) · `inapp-webview-page.ts`(새 · CSP) · `cdp.ts`(`/inapp/webview` · 예시 그림 `?fit=`) · `image-fit-spec.ts`(`4x5`) · `studio-discount.ts`(새 CT) · `image-studio-templates-discount.ts`(새 8종) · `image-studio-templates.ts`(kind · offer · 카테고리) · `image-studio.ts`(혜택 줄 · 고정 틀 · 글자 바닥 `POSTER_LEGIBILITY_FLOOR`) · `routes/image-studio.ts`(/generate 검사 · 지문 · 강조색 · 확인 줄 · 한 줄 헤드라인 할인 400) · 스크립트 둘. SDK: `poster-frame.ts`(`drawsWithPosterFrame`) · `inapp.ts`(사진 위 글 = 새 틀 · 옛 4:5 캐러셀 · 단일 포스터 경로 삭제 · 이벤트 카드 원본 비율 · 기본 contain · 호스트 모드 · `renderInAppForHost` · `defaultHostBridge`) · IIFE 내보내기 · 빌드 → `backend/sdk-serving` 네 폴더. 프론트: 미리보기 분기 넷 = 한 판정 · 옛 앱 미리보기 = `legacy-app-view.ts`(서버 거울) · 라벨 `break-keep` · 안내 문구 · 계약서 v5 · 할인 탭 · 숫자 칸 · 제작 화면 §C · 아래 고정 바 · 결과 확인 줄 · 허용 트랙. 팝폰: 웹뷰 호스트(`InAppWebViewHost.tsx` 새 · `InAppHost` · `caps=webview` · 원문 · serverNow) · `react-native-webview` 의존 줄(설치 · 스토어 빌드 = Harold).
- 범위 밖으로 남긴 것(기록만): 몰 상품 창 할인율 표시를 판 산식으로(회의 합의 1-13) · 몰 상품 창 버튼 글 「포스터에 넣기」 · 팝폰 옛 네이티브 렌더러 파일(`InAppBottomSheet.tsx` · `InAppPosterSheet.tsx`)은 이제 안 불림(지울지 = 팝폰 커밋 때 Harold).
- 구조체크 덧붙임(1108 · 2R 대기 중 찾음) = 한 줄 헤드라인 갤러리(`LineHeadlineStep.tsx:180` TemplatePicker)에서 할인 템플릿을 직접 고를 수 있고 만들기 라우트(`image-studio.ts:401-402`)가 kind 로 할인을 막지 않는다 → 화면 허용 트랙(K6) + 라우트 할인형 400 · AI 영업 풀(`sales-outreach-produce.ts:350-351` · `:429`)은 kind 를 product · event 로 고정해 할인형 0(변경 0).
- Codex 구현 1R = 지적 3(① 사진 위 글 한 장이 새 틀로 가며 바깥 칸 버튼 · 그림 링크 소실 · ② 스스로 닫지 않는 모양에서 호스트 이동 뒤 웹뷰 남음 · ③ 할인형에서 숨긴 라벨 · 부제 값 전송) → ① 공용 `frameSlidesWithFlat`(SDK · 편집 미리보기 · 갤러리 한 함수) · ② 호스트 이동 = navigate 사건 뒤 메시지 DOM 제거 · 앱도 닫음 · ③ 화면 · 서버 둘 다 제품명 + 템플릿 기본 라벨만. 같은 뿌리 = 없음(첫 라운드).
- Codex 구현 2R = 지적 1(한 장 폴백이 이벤트 카드 · 배너 시트에도 바깥 칸을 섞음) · 1R ① 처방의 적용 범위(같은 함수 · 새 부류 아님) → 폴백 조건에 `drawsWithPosterFrame`.
- Codex 구현 3R = 지적 1(장 없는 시트 첫 장에 배지 `badge_text` 누락 · 갤러리만) · 같은 함수의 입력 칸 빠짐(새 부류 아님) → `PosterFlatFallback.eyebrow` 필수 칸 · 장 없음 첫 장에만 · 기존 장에는 섞지 않음.
- **Codex 구현 4R = approve**(지적 0 · 1108). 변이 M1 ~ M18 전부 빨간불 · tsc 0(백엔드 · 프론트 · SDK) · SDK vitest 25파일 251건.
- 1108 배포 b374ed44(C114-H1) = 서버 확인 통과(online ↺62 · 에러 로그 0줄) · 웹뷰 주소 HTTP 200 · CSP default-src none · connect-src none(K9 와 같음) · 같은 확인 중 Harold 지적 셋(제작 화면 여백 · 장면 힌트 안내 · 할인 템플릿이 제품 지정형) = 원장 C114-H1 결과 줄.
- 1108 C114-S1 할인 예시 8장 = Harold 생성 → 세트 업종 섞임 · 브랜드 이름 반려 → C119(8종 보편화 + 24장 다시 · 배치 둘 · f0e7ea30).
- 1108 인앱 결함 이어짐 = 팝폰(caps 없음)에서 여전히 잘림 · 기능 축소 → C116 구워 보내기(ca7c99cd) → C116-B 공통 규칙(c70830be) → C118 앱 모양 넷 · 인앱용 그림(5fc2d527). C114-P1 팝폰 스토어 빌드 = 실행 0 · 같은 날 DECISIONS D116(깔린 앱 그대로가 기능 기준 · 팝폰 = 시험 수단 · 웹뷰 호스트 = 새로 붙이는 앱의 길).
- 1108 기능 SoT 반영 = `docs/FEATURE-IMAGE-STUDIO.md` §2-8 · §4-1-F · §5 · §7 · `docs/인앱메세지전용.md` §10-F.
