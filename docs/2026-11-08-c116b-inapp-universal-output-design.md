# C116-B 설계서 — 인앱 옛 연동 앱 출력 = 모든 고객사 앱 공통 규칙 하나(시험 앱 기준 값 걷어냄)

> 순서 = `status/DEFECT-PLAYBOOK.md` · 원 설계서 = [C116](2026-11-08-c116-inapp-bake-design.md)(흐름 표 §2 S1 ~ S15 그대로 쓴다 · 이 문서는 바뀌는 이음매만).
> 철회 기록 = [팝폰 서랍 흐름 표](2026-11-08-c116-poppon-baked-drawer-flow-ledger.md)(한 앱 전용 = 기능 아님).
> 범위 = 서버(맞춤 규격 · 맞춤 CT · 굽기 CT · 서빙 사본) + 편집기 「구버전 앱 모습」 + 관리 화면 앱 연동 안내. 고객사 앱 수정 0 · DDL 0 · ENV 0.

## §0 접수 · 기준

| 번호 | Harold 원문(1108) | 닫는 처방 |
|---|---|---|
| J1 | 「저걸로(통짜 포스터 카드) 수정해서 적용을 했는데, 이렇게 밖에 안된다」 | D1 · D2 · D3 |
| J2 | 「기능이 고객사의 어떤 앱에도 적용 가능한 것만 기능으로 제시 · 팝폰은 그냥 테스트 수단」 | D1(한 앱 기준 값 0) · D5 |
| J3 | 「고객사 어플이 어떤 상태인지 다 모르잖아 · 업데이트하고 검수 다시 받아서 올리세요? · 어떤 환경에서도 사용 가능하도록 주는 게 먼저」 | 고객사 앱 수정 0(전 처방 서버 · 화면 · 안내) |
| J4 | 「모든 고객사가 고루 · 누구나 오류 없이 · 팝폰에 맞춰서 보여지게 하는 게 뭔 의미」 | D1 · D4 · D5 · D6 |
| J5 | 「그러니까 · 똑바로 하라고」 = 보정 다섯 줄 동의(기준 = 연동 계약 하나 · 모든 모양 완성 그림 · 어떤 칸에서도 잘림 0 · 빈자리 = 디자인 바탕색 · 앱 버튼 그대로 · 안내 문구 = 서버 동작) | D1 ~ D6 |

**기준**: 고객사 앱 칸의 크기 · 비율 · 맞춤 방식은 모른다고 놓는다. 서버 출력은 연동 계약(관리 화면 앱 연동 안내 = 업체 개발자가 받는 문서)에 적힌 약속 하나로 정하고, 그 약속을 계약 문구에 그대로 쓴다. 팝폰 = 결과 확인 기기.

## §1 결함 장부(C116 흐름 표의 이음매 기준)

| 번호 | 이음매(C116 §2) | 결함 · 고객이 겪는 일 | 자리 |
|---|---|---|---|
| E1 | S10 앱 그리기 · 맞춤 규격 | 맞춤 `inapp`(1:1 · 안전 칸 80% × 92%)의 근거가 팝폰 칸 공식(min(가로×1.25, 화면×0.62) · 화면 1.5 하한)이다 → 다른 고객사 앱 칸에는 근거 없는 값 · 세로 92% 는 한 앱의 칸 범위에서만 맞다 | `image-fit-spec.ts:13 ~ :20` |
| E2 | S10 · 맞춤 CT | 빈자리 = 가장자리 색 또는 원본 흐림 복사(디자인과 무관한 흐린 띠 · J1 화면) | `image-serve.ts:106 ~ :114` |
| E3 | S7 굽기 찍기 | 틀 상자를 JPEG 로 찍어 상자 밖(둥근 모서리 귀퉁이)이 흰색 → 카드 모양(둥근 모서리 · 떠 있음)이 그림에서 사라지고, 서빙 때 맞춤(E1 · E2)이 덧댄다 | `inapp-bake.ts:391` · `inapp-message.ts:1617 bakedLegacyMessage`(`?fit=inapp`) |
| E4 | S15 안내 | 관리 화면 앱 연동 안내가 C116 전 서버 동작(「떠 있는 카드는 틀을 지워 바닥 시트로 · 띠는 본문 한 줄 · 여러 장 4:5」)을 업체 개발자에게 약속 | `AppIntegrationContract.tsx:77` |
| E5 | S15 편집기 | 「구버전 앱 모습」 굽기 = 칸 바탕 흰색 · 안전 칸 0.92(E1 값) / 대체 = 4:5 · `#23252c` · 맞추기 → 서버 출력과 다른 그림 | `LegacyBakedPreview.tsx:33` · `legacy-app-view.ts:92` · `PosterSheetPreview.tsx:184` |

뿌리 = R83 재발(남의 렌더러 칸 규칙에 서버 출력을 맞춤 · C116 은 시험 앱 하나를 실측해 모든 앱의 규칙으로 일반화) + R-값문구(서버 동작이 바뀌었는데 그 동작을 말하는 안내 · 미리보기가 따라오지 않음).

## §2 처방

| 번호 | 처방 | 근거 |
|---|---|---|
| D1 | **공통 규칙 하나** = 맞춤 키 `inapp`(키 이름 유지 · 이미 내려간 주소도 같은 규칙을 받는다 · Codex 설계 1R ①) 값을 바꾼다: 정사각 캔버스 · 내용은 가운데 **80% × 80%** 안에 통째로(맞추기) · 빈자리 = 무대색(D2) · 규격에 `rev: 2` → **주소와 변환본 캐시 폴더 둘 다에 판을 넣는다**: 새 주소 = `?fit=inapp&fr=2` · **`withInAppImageFit` = 정규화 한 곳**(Codex 설계 3R ① · 같은 부류 세 번째 → 구조): 들어온 주소에서 우리 맞춤 표시(`fit=inapp` · `fr`)를 먼저 걷어내고 → 맞춤 대상(우리 그림 · 예시)이면 지금 판 표시를 붙인다 · 다른 `fit` 값(예 `fit=1x1`)이 든 주소 · 바깥 주소 = 그대로 · 몇 번 거쳐도 같은 결과(멱등) → 새 주소 · 저장된 주소 · 이미 맞춤 붙은 주소 · 옛 판 주소가 모두 지금 판 하나로 · 화면 거울도 같은 정규화 · 서버는 `fr` 을 읽지 않고 `fit` 만 읽는다(주소만 달라져 앱 · 중간 캐시가 옛 그림을 다시 쓰지 않음) · 폴더 = `1400-inapp-pad-r2`(옛 값 변환본을 다시 쓰지 않음 · `rev` 없는 다른 키 폴더 이름 그대로) · 옛 주소(`fr` 없음)가 서버까지 오면 새 규칙 · 앱 캐시에 남은 옛 주소 그림(이미지 응답 캐시 1일 `cdp.ts:631` · 예시 30일 `:651`)은 그 앱이 다음 조회에서 새 주소를 받으면 끝(서버가 남의 캐시를 지울 길 없음 · 계약에 적음). 상수 = `image-fit-spec.ts` 한 곳 | 칸 비율 모름 → 가로형 · 세로형 손해가 대칭인 정사각 · 앱이 **가운데 맞춤 cover**(RN `contentFit` · 안드로이드 centerCrop · iOS scaleAspectFill · CSS `object-fit` 기본값)로 잘라도 칸 세로/가로 0.8 ~ 1.25(5:4 ~ 4:5) 안이면 내용 0 잘림 · contain · 원본 비율이면 통째. 이 조건(가운데 맞춤 · 범위)을 계약에 적는다(D5 · Codex 설계 1R ②) |
| D2 | **무대색** = SDK 여러 장 칸 채움 규칙과 같다: 그 장 `bg_color`(hex) · 없으면 `#111827`(`POSTER_FRAME_RULES.multiFill`). 서버 상수 `INAPP_STAGE_FILL`(image-fit-spec) · 인앱 맞춤 갈래(`safe` 있는 규격)에서 가장자리 색 · 흐림 0. 다른 맞춤(상품 격자 `1x1` · SNS)은 그대로 | 디자인이 정한 바탕색(SDK 와 같은 값) · 「흐림 대신 디자인 바탕색」(J5) |
| D3 | **굽기 = 최종 그림**: SDK 정지 그리기는 틀 상자 그림자도 0(`buildPosterFrame` still = `boxShadow: none` · 찍는 상자 밖으로 뻗는 그림자가 잘리지 않게 · 무대색 위에서는 원래 보이지 않는 값 · 편집기 정지 미리보기도 같은 SDK = 같음 · Codex 설계 1R ⑤) · 틀 상자를 **투명 바탕 PNG** 로 찍고(`omitBackground` · 웹뷰 페이지 바탕 = transparent 확인 `inapp-webview-page.ts:63`) → `composeInAppBakeSlide(png, stage)` 가 D1 규칙으로 무대 위에 얹어 JPEG(q90) 저장 → 서빙 때 맞춤 0(`bakedLegacyMessage` = 구운 파일 주소 그대로). 장마다 무대색 = 굽기 판정이 계산해 일감에 실음(`InAppBakeJob.stages` · 길이 = 장 수 · hex). `INAPP_BAKE_VERSION` 1 → 2(모든 열쇠 새로 = 옛 그림 안 씀) | 카드 둥근 모서리 · 떠 있는 모양이 무대 위에 그대로(J1) · 서빙 맞춤 덧댐 0 |
| D4 | **대체 길**(굽기 전 · 굽지 않는 메시지 = 개인화 · 글 넘침 · 실패 쉼) = 우리 그림 주소에 `?fit=inapp`(지금 그대로 · 새 값) · 무대색 = `INAPP_STAGE_FILL` 하나(대체 길은 장 색을 쓰지 않음 · 캐시 = 키 하나) · 남의 주소 = 원본 그대로(지금 그대로) | 같은 규칙 · 같은 약속(D5) |
| D5 | **연동 안내 = 서버 동작 그대로**: caps 없는 앱 = 모든 모양(떠 있는 카드 · 통짜 · 쿠폰 · 남은 시간 · 여러 장)이 정사각 완성 그림으로 온다 · 내용은 가운데 80% · **가운데 맞춤** cover 로 5:4 ~ 4:5 칸까지 내용 잘림 0 · 원본 비율 · contain 이면 통째 · 업체가 올린 바깥 주소 그림(우리 서버 그림이 아닌 것) = 원본 그대로(맞춤 0) · 글 칸 = 빈 값(구운 그림) · 장 버튼 · 그림 링크 · 메시지 버튼 그대로 · 굽기 전 대체 = 같은 정사각 그림 + 앱이 글을 얹는다. 숫자는 규격 상수에서 끌어온다(손 글 0) | 업체 개발자가 받는 약속 = 서버 출력(R-값문구) |
| D6 | **편집기 「구버전 앱 모습」 = 서버 출력 거울**: 굽기 = 정사각 칸 바탕 = 지금 장 무대색 · 안전 칸 = D1 값(`LEGACY_BAKE_SAFE` 0.8 × 0.8 · 백엔드 상수와 계약 시험) · 정지 그림자 0(SDK 같은 코드) / 대체(`legacyAppPreviewOf` 갈래) = 그림을 다시 그리지 않고 **서버가 실제로 내주는 맞춤 주소를 그대로 쓴다**: 거울 `legacyAppImageUrl(url)` = 서버 `withInAppImageFit` 과 같은 판정(우리 그림 = `isOwnInAppImageUrl` · 예시 그림 경로 · 이미 `fit=` 있음 = 그대로 · **이벤트 카드 · 배너 시트 = 장 · flat 모두 그대로**(서버 `legacyServeTransform:1527 ~ :1536` 과 같음 · 거울 함수가 design 을 받아 한 곳에서 판정)) → `?fit=inapp&fr=2` · `legacyAppPreviewOf` 의 장 그림 + 두 자리(편집기 · 공용 미리보기 `AppInAppPreview`)의 flat `imageUrl` 에 적용 · **믿는 호스트 = 서버가 내려준 목록 하나**(Codex 설계 3R ② · 2R ② 와 같은 부류 세 번째 → 구조: 서버 설정에 달린 값을 화면이 짐작하지 않는다): 서버 CT `trustedImageHosts`(brand-image-resolver · 기본 넷 + 환경값 호스트)를 내보내고 로그인 뒤 `GET /api/cdp/inapp/own-image-hosts` = `{ hosts }` → 화면 `legacy-app-view.ts` 판정 = **세 값**(`own` · `foreign` · `unknown` · Codex 설계 4R ①): 상대 경로(우리 그림 길 · 예시 길) = own · 절대 주소 = 받은 목록에 있으면 own · 목록을 받았고(ready) 없으면 foreign · **목록을 아직 못 받았거나(loading) 실패(error)했고 기본 넷 밖의 절대 주소 = unknown**(짐작 0) · `legacyAppWillBake` · `legacyAppImageUrl` 은 그림 하나라도 unknown 이면 `unknown` 을 돌려주고 두 자리(편집기 · 공용 미리보기)는 「구버전 앱 모습 확인 중」(loading) · 「확인하지 못했어요 · 다시 시도」(error · 누르면 다시 받기) 칸을 그린다 · 목록 상태 = 모듈 한 곳(한 번 받기 · 실패 = 다시 시도 때만) · 받으면 두 자리가 다시 그린다(구독) · 화면 호스트 자동 신뢰 0 → 대체 그리개(`PosterSheetPreview` overlay · `PosterCarouselPreview` · `posterCard`)는 손대지 않음(서버가 만든 그림을 그대로 그린다 · 바깥 주소 = 원본 = 서버와 같음 · Codex 설계 1R ③ ④) | 미리보기 = 실제(J4) |

## §3 영향표(소비처 전수 · grep 근거)

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| `ASPECT_RATIOS.inapp` 값 · `rev` | `parseFitOption`(`cdp.ts:638` 올린 그림 · `:654` 예시 그림) · `buildServePath`(캐시 폴더 이름 = `rev` 붙음) · `withInAppImageFit` · 화면 거울 `legacyAppImageUrl` | 키 그대로 = 이미 내려간 주소 · 늦게 요청한 다음 장도 새 규칙(잘림 0) · 옛 변환본 폴더 = 쓰지 않음(디스크에 남음 · 작음) |
| `fitToCanvas` 안전 칸 갈래 | `buildServePath`(인앱만 `safe`) · `composeInAppBakeSlide`(새) · `sns-media.ts:222`(`safe` 없음 = 그대로) | 상품 격자 · SNS · 메일 맞춤 변화 0 |
| `bakedLegacyMessage` · `inAppBakePlan`(stages) · `InAppBakeJob` | `serveInAppForClient` · `prebakeInAppMessage` · `requestInAppBake` · `pump` · `runWithChrome` · 시험 | caps 있는 클라이언트(웹 SDK · 웹뷰) = 판정 거짓 = 변화 0 |
| `INAPP_BAKE_VERSION` 2 | `inAppBakeKey` | 배포 뒤 첫 조회 · 게시에 다시 굽기(대기열 20 · 쓸기 48시간이 옛 파일 정리) |
| `LEGACY_BAKE_SAFE` · `LegacyBakedPreview` | `PosterFramePreview placeBake` · `PosterEditor` · `InAppMessagePreview` | 편집기 구버전 모습만 |
| `trustedImageHosts` 내보냄 · `GET /api/cdp/inapp/own-image-hosts`(새 · 로그인 뒤 `cdp.ts:914` 다음) | `legacy-app-view.ts` 판정 목록 · 편집기 · 공용 미리보기 | 읽기 전용 · 공개 호스트 이름만(비밀값 0) |
| `legacyAppPreviewOf` 장 그림 주소 · `legacyAppImageUrl` | `PosterEditor:252`(legacy) · `InAppMessagePreview:577`(legacyView) + 그 자리 flat `imageUrl` | 구버전 모습 대체 갈래만(그리개 · 갤러리 · 예시 손대지 않음) |
| SDK `buildPosterFrame` still 그림자 | 굽기 페이지 · `LegacyBakedPreview`(정지) | still 아닌 그리기(웹 SDK · 웹뷰 · 편집기 새 모습) 변화 0 · 서빙 SDK 파일 다시 빌드(v0.3.8 ~ v0.3.11) |
| `AppIntegrationContract.tsx:77` 글 | 관리 화면 `CdpSettingsPage:1468` · 편집기 앱 계약 모달 | 글만 |
| 미가입 · 직접발송만 쓰는 회사 | 인앱 메시지 0 → 호출 0 | 변화 0 |

## §4 계약 시험(뿌리마다 기계 대조) · 변이

| 번호 | 시험 | 변이(빨간불이어야) |
|---|---|---|
| VB1 | `inapp` = 정사각 · safe 0.8 × 0.8 · rev 2 · `INAPP_STAGE_FILL` = SDK `POSTER_FRAME_RULES.multiFill`(SDK 소스에서 읽음) · 캐시 폴더 이름 = `-r2` 붙음 · rev 없는 키 폴더 이름 그대로 | N1 safe 0.92 · N2 무대색 다른 값 · N2b 폴더 이름에서 rev 뺌 |
| VB2 | `fitToCanvas` safe = 복잡한 사진(줄무늬 · 노이즈)도 바깥 띠 픽셀 = 무대색(±2) · 흐림 0 · 내용 = 가운데 80% 상자 안 | N3 흐림 갈래 되살림 |
| VB3 | `getServePath(?fit=inapp)` = 정사각 · GIF · 다중 프레임 · 이미 정사각 · 작은 원본 다 맞춤 · **옛 값 변환본이 캐시에 있어도 새 규칙**(옛 폴더에 둔 파일을 안 씀 · Codex 설계 1R ①) | N4 원본 반환 갈래 되살림 |
| VB4 | `composeInAppBakeSlide(투명 모서리 PNG, '#ff0000')` = 정사각 JPEG · 네 귀퉁이 = 무대색 · 카드 둥근 모서리 밖 = 무대색 · 내용 = 가운데 80% · 원본보다 크게 늘리지 않음 | N5 omit 없이 흰 귀퉁이 · N6 무대색 무시 |
| VB5 | `bakedLegacyMessage` 장 그림 · `imageUrl` = 구운 파일 주소 그대로(`fit` 0) | N7 `withInAppImageFit` 되살림 |
| VB6 | `inAppBakePlan` stages = 장마다 `bg_color` hex 또는 `#111827` · 잘못된 hex = 기본 · 길이 = expected · `requestInAppBake` 길이 · hex 어긋남 = invalid | N8 stages 길이 검사 끔 |
| VB7 | 열쇠 = 판 2 · 판 1 열쇠와 다름 | N9 판 1 |
| VB8 | `legacyServeTransform` 대체 = `?fit=inapp&fr=2`(우리 그림만 · 바깥 주소 그대로 · 이벤트 카드 · 배너 = 그대로) · `withInAppImageFit` 정규화 표본 = 맨 주소 · `?fit=inapp` · `?fit=inapp&fr=1` · `?a=1&fit=inapp&fr=2` · `?fit=1x1`(그대로) · 바깥 주소 · 두 번 거침(멱등) | N10 fr 빠짐 · N10b 옛 fit 걷기 끔 |
| VB9 | 연동 안내 글 = 규격 값(80 · 정사각 · 5:4 ~ 4:5 · 가운데 맞춤 · 바깥 주소 원본) 포함 · 옛 문구(「틀을 지워」 · 「본문 한 줄」 · 「4:5 로 미리」) 0 | N11 옛 문구 |
| VB10 | 화면 거울 = `LEGACY_BAKE_SAFE` = 규격 safe · `LegacyBakedPreview` 칸 바탕 = 지금 장 무대색(장 `bg_color` hex · 없으면 `#111827` = 서버 판정과 같은 표본 대조) · `legacyAppImageUrl(url, design)` = 서버 변환 결과와 **레이아웃별 전체 표본 대조**(overlay · 틀 · 이벤트 카드 · 배너 × 상대 경로 · hanjul.ai · app.hanjul.ai · localhost · 화면 호스트 · 남의 호스트 · 예시 · 이미 fit · 쿼리 있음 · 장 · flat) · 두 자리 flat `imageUrl` 에 적용(소스 계약) | N12 바탕 흰색 · N13 거울에서 바깥 주소에도 fit |
| VB11 | SDK still = 틀 상자 그림자 0 · still 아님 = 그림자 그대로 | N14 still 그림자 |
| VB12 | `GET /inapp/own-image-hosts` = 서버 `trustedImageHosts()` 그대로(환경값 호스트 포함 · 로그인 뒤) · 화면 판정 세 값 표본 = 환경값 전용 호스트 주소 × (받기 전 = unknown · 실패 = unknown · 받은 뒤 = own) · 서버가 안 믿는 호스트(받은 뒤 = foreign · 맞춤 0 · 굽기 거짓) · 상대 경로 = 늘 own · 기본 넷 = 받기 전에도 own · 그림 하나라도 unknown = 굽기 판정 · 맞춤 주소 둘 다 unknown | N15 화면이 location.hostname 믿음 · N16 받기 전 unknown 을 foreign 으로 |

## §5 직원 지시문(로드맵 묶음 끝 시트 · 기대 결과 먼저)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정으로 로그인 → 인앱 메시지 → 헬로윈파티 열기 | 편집 화면이 열린다 |
| 2 | 미리보기 위 「구버전 앱」을 누른다 | 휴대폰 아래 흰 시트 안 정사각 칸 · 어두운 바탕 위 카드(둥근 모서리)가 가운데 · 아래 「바로가기」 |
| 3 | 팝폰을 끄고 다시 켠다(1분 뒤 한 번 더) | 아래 시트 안 정사각 칸에 어두운 바탕 위 둥근 카드 · 포스터 글자 위 · 아래 잘림 없음 · 흐린 띠 없음 |
| 4 | 오른쪽으로 두 번 넘긴다 | 2 · 3번째 장도 같은 모양 · 잘림 없음 |
| 5 | 「바로가기」를 누른다 | 이벤트 페이지가 열린다 |
| 6 | 다시 켜서 「오늘 하루 보지 않기」 → 팝폰 다시 켜기 | 오늘은 다시 뜨지 않는다 |
| 7 | 관리 → 앱 연동 안내를 연다 | 「정사각 그림 · 가운데 80%」 문장이 있다 · 「틀을 지워」 문장이 없다 |

## §6 구조체크(이음매 · 경계)

| 번호 | 점검 | 판정 |
|---|---|---|
| K1 | 옛 `?fit=inapp` 주소를 이미 받아 둔 앱(배포 전 응답의 다음 장을 배포 뒤 요청) | 키 그대로 · 새 규칙(정사각 · 80% · 무대색)으로 맞춤 · 옛 구운 파일(판 1 = 틀 상자 JPEG)도 같은 맞춤을 받아 잘림 0 · 48시간 뒤 쓸기가 지움 · 굽기 판 2 = 첫 조회는 대체 → 굽기 뒤 구운 그림 |
| K2 | 굽기 판 2 = 모든 게시 메시지 다시 굽기 | 조회 때 요청 · 대기열 20 · 넘침 = 대체 서빙(안전) · 다음 조회에 다시 요청 |
| K3 | PNG 찍기 크기 · 바이트 상한 | 상한은 받은 바이트(그림 내려받기)만 셈 · 찍기 출력과 무관 · 최종 JPEG 한 장 1 ~ 2MB 안팎 · 캔버스 변 ≤ `SERVE_MAX_WIDTH`(1400) |
| K4 | 투명 찍기 = 페이지 · 바깥 투명 | 웹뷰 페이지 html · body `background:transparent`(`inapp-webview-page.ts:63`) · 정지 = 바깥 어둠 0(`poster-frame.ts:342`) |
| K5 | 무대색 hex 검증 | 장 `bg_color` = 저장 때 `POSTER_HEX` 검사 + 판정에서 다시(잘못된 값 = 기본) · 일감 받는 쪽도 hex 검사(invalid) |
| K6 | 굽기 · 대체 둘 다 같은 규칙 | 상수 한 곳(`image-fit-spec`) · 굽기 = `fitToCanvas` 같은 함수 |
| K7 | caps 있는 클라이언트 | `inAppBakePlan` 거짓 · `legacyServeTransform` noV4 거짓 = 맞춤 0 · 구운 그림 0 |
| K8 | 편집기 거울이 갤러리 · 예시에 번짐 | `legacyAppFit` 넘기는 두 자리만(VB10) |

## §7 배포

DDL 0 · ENV 0 · 백엔드 + 프론트(SDK 변경 0 · 서빙 SDK 파일 변경 0). 배포 뒤 = 헬로윈파티 조회 한 번(팝폰 실행) → 서버 `bake-*` 새 열쇠 생김 → 팝폰 확인(§5 3 ~ 6).

## §8 범위 밖(기록만)

- 고객사 앱 칸이 5:4 ~ 4:5 밖이고 cover 로 그리는 경우 = 내용 가장자리가 잘릴 수 있다 → 안내(D5)에 범위를 적어 업체가 알 수 있게 한다(서버가 칸을 알 길 없음).
- 웹뷰 연동(계약 v5) = 원하는 업체의 선택지(그대로).

## §9 기록

- 1108 작성 · 구조체크 K1 ~ K8.
- **Codex 설계 5R = approve**(지적 0 · 1108).
- **구현(1108)** — 백엔드: `image-fit-spec.ts`(무대색 · 무대색 판정 · `inapp` rev 2 · 80% × 80%) · `image-serve.ts`(안전 칸 = 무대색 단색 · 폴더 rev) · `inapp-bake.ts`(판 2 · stages · `composeInAppBakeSlide` · 투명 PNG 찍기 → 합성) · `inapp-message.ts`(`withInAppImageFit` 정규화 · stages · 구운 주소 그대로) · `brand-image-resolver.ts`(`trustedImageHosts` 내보냄) · `cdp.ts`(`GET /inapp/own-image-hosts`). SDK: `poster-frame.ts`(정지 그림자 0 · 서빙 네 폴더 다시 빌드). 프론트: `legacy-app-view.ts`(세 값 판정 · `legacyAppImageUrl` · 무대색) · `inapp-image-hosts.ts`(새) · `LegacyBakedPreview.tsx`(무대색 바탕 · 확인 중 · 실패 칸) · 편집기 · 공용 미리보기 · 연동 안내 문구.
- 시험 = `c116b-inapp-universal-1108.test.ts`(VB1 ~ VB12 · 34) · 기존 C116(V14 = 공통 규칙으로 다시 씀 · V16 무대색 귀퉁이) · C114(맞춤 주소 · 거울 = 서버 주소까지) · SDK VB11 · 변이 N1 ~ N19 빨간불 · 로컬 실제 크롬 굽기 3종(통짜 카드 · 쿠폰 카드 · 남은 시간 시트 = 1400 × 1400 · 무대색 · 흰 귀퉁이 0 · 장당 약 1.4초).
- Codex 구현 1R = 지적 1(공용 미리보기 flat 그림 없음을 호스트 판정 보류로 오인 → 확인 중 고정) → flat 없음 = undefined · null = 보류만(시험 VB10). 같은 부류 = 없음.
- **Codex 구현 2R = approve**(지적 0 · 1108).
- Codex 설계 4R = 지적 1(호스트 목록 받기 전 · 실패 때 환경값 전용 호스트 그림을 바깥 그림으로 판정 = 서버와 다름) = 3R ② 와 같은 부류(네 번째 · 화면이 서버 설정에 달린 판정을 짐작) → 처방 = 모르는 것은 모른다고(세 값 · unknown) · 그 동안 화면 = 확인 중 · 실패 · 다시 시도 · 짐작으로 그리는 길 0.
- Codex 설계 3R = 지적 2(① 저장된 주소에 이미 `fit=inapp` 이 있으면 `fr` 이 안 붙음 ② 화면 호스트 자동 신뢰 = 서버가 안 믿는 주소를 화면만 믿음). 같은 부류 판정 = ① = 1R ① · 2R ① 과 같은 부류(세 번째 · 내려간 · 저장된 주소와 내용 판) → 되풀이 원인 = 주소를 만드는 입구마다(새 주소 · 옛 주소 · 저장 주소) 따로 고침 · 구조 처방 = `withInAppImageFit` 을 「우리 맞춤 표시를 걷고 지금 판을 붙이는」 정규화 한 곳으로(멱등 · 입구 무관) · ② = 1R ④ · 2R ② 와 같은 부류(세 번째 · 화면이 서버 판정을 다시 짬) → 되풀이 원인 = 서버 설정에 달린 값을 화면이 짐작 · 구조 처방 = 서버 CT 목록을 내려받아 쓴다(짐작 0).
- Codex 설계 2R = 지적 3(① 폴더 rev 만으로는 앱 · 중간 캐시의 옛 그림이 그대로(이미지 응답 1일 · 30일 캐시) ② 화면 판정 믿는 호스트가 서버와 다름 ③ 거울에 이벤트 카드 · 배너 제외 빠짐). 같은 부류 판정 = ① 은 1R ① 과 같은 부류(내려간 주소는 그대로 두고 내용만 바꿈) → 되풀이 원인 = 주소가 내용의 판을 담지 않음 · 구조 처방 = 주소에 규격 판(`fr`)을 넣는다(어느 층의 캐시든 주소가 다르면 새 그림) · ② ③ = 1R ④ 와 같은 부류(거울 판정이 서버 판정의 일부만 옮김) → 구조 처방 = 거울 함수 하나가 서버와 같은 입력(design · 주소)을 받아 같은 갈래를 모두 갖고, 시험은 함수 단위가 아니라 레이아웃별 전체 변환 결과를 서버와 대조.
- Codex 설계 1R = 지적 5(① 옛 키 지우면 이미 내려간 주소의 잘림 방지가 풀림 ② 가운데 맞춤 cover 조건 없이 잘림 0 약속 불가 ③ 공용 미리보기 대체 갈래는 PosterSheetPreview 가 아니라 PosterCarouselPreview · posterCard ④ 바깥 주소 그림에도 안전 칸을 그리면 서버와 다름 ⑤ 찍는 상자 밖 그림자 잘림) → ① 키 유지 + 캐시 폴더 rev ② 계약에 가운데 맞춤 조건 · 플랫폼 기본값 근거 ③ ④ 그리개를 고치지 않고 서버 맞춤 주소를 그대로 쓰는 거울(같은 판정 · 바깥 주소 그대로) ⑤ 정지 = 그림자 0. 같은 부류 = 없음(첫 라운드).
- 1108 배포 c70830be(C116-H2) = 서버 확인 통과(online ↺68 · unstable 0 · 에러 로그 0줄) · 굽기 세 열쇠 1400×1400 · 팝폰 = 무대 위 카드 · 잘림 0 · Harold 품질 반려(어두운 무대 위 작은 그림 · 「저딴 퀄리티」) → C118(스튜디오 인앱용 정사각 + 여백 0).
- 1108 결정 등재 = DECISIONS D116 · 기능 SoT 포인터 = `docs/인앱메세지전용.md` §10-F.
