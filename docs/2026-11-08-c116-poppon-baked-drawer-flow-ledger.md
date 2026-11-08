# C116-2 흐름 표 — 팝폰 「구운 틀」 서랍(OTA) · 결함 A(앱 그릇 = 바닥 시트 고정)

> **철회(1108 Harold)** = 「기능이 고객사의 어떤 앱에도 적용 가능한 것만 기능으로 제시 · 팝폰은 테스트 수단」. 한 앱 전용 서랍은 기능이 아니다. 이 문서는 기록으로만 남긴다(B1 ~ B5 사실은 유효).

> 순서 = `status/DEFECT-PLAYBOOK.md` §1 단계 1(흐름 표) · 이 표에 Harold 확인이 있기 전 설계 · 코드 0.
> 접수(1108 13:20 · 배포 ca7c99cd 뒤) = Harold 「저걸로(통짜 포스터 카드) 수정해서 적용을 했는데, 이렇게 밖에 안된다」 → 「OTA 서랍 설계」.
> 원 설계서 = [C116 설계서](2026-11-08-c116-inapp-bake-design.md) §3 결함 A · §11 배포 뒤 기록.
> 팝폰 설치판 소스 = `poppon-app/dist/_expo/static/js/ios/entry-989c7f52….hbc.map`(2026-09-29 21:15 · sourcesContent) 에서 뽑음. 지금 작업 트리와 비교 = `InAppBottomSheet.tsx` · `InAppPosterSheet.tsx` · `config.ts` 같음 / `InAppHost.tsx` · `inapp-client.ts` · `inapp-core.ts` 다름(C114-P1 웹뷰 변경).
> 칸 뽑은 패턴 = 서버 `grep -n "serveInAppForClient\|parseInAppClientCaps\|settleInAppPublish\|prebakeInAppMessage" src` · SDK `grep -n "isCard\|still\|data-hjl-frame" poster-frame.ts` · 팝폰 소스맵 `sources ~ /src/lib/hanjul/`.

## §1 흐름(쓰는 쪽 → 읽는 쪽)

| 단계 | 쓰는 쪽(파일:행) | 읽는 쪽(파일:행) | 지금 동작 |
|---|---|---|---|
| S1 만들기 | 편집기 `PosterEditor.tsx` → PATCH `cdp.ts:1467 updateInAppMessage` | `inapp-message.ts mapRowToMessageDetail` | 모양 = `design.poster_frame`(card · 없음=sheet) · `poster_text`(baked) · `poster_strip`(coupon · countdown) · `poster_layout`(event_card · banner_sheet · 없음) |
| S2 게시 | `cdp.ts:1474 settleInAppPublish` | `inapp-message.ts:839` → `:1653 prebakeInAppMessage` | 미리 굽기 = **게시로 넘어갈 때만**(이미 게시 중 수정 = 앱이 처음 받아 갈 때 굽기 요청) |
| S3 굽기 | `inapp-bake.ts requestInAppBake` → 크롬 → `/api/cdp/inapp/webview` → SDK `renderInAppForHost(still)` | `poster-frame.ts:317 buildPosterFrame` · 찍는 자리 `[data-hjl-frame]`(`:358` = 틀 뿌리) | 틀 뿌리 = 카드 · 시트 상자(둥근 모서리 16 · 그림자 · 그림 + 띠) · 정지 = 닫기 줄 · 쪽 번호 · 버튼 칸 · 바닥 줄 0 · 바깥 투명 → jpg(q90 · 390 화면 · DPR3) |
| S4 앱 조회 | 팝폰 `inapp-client.ts:65 fetchActiveMessages` · `inapp-core.ts:29 buildActiveUrl` | `cdp.ts:678 parseInAppClientCaps` | caps 보내지 않음 = 빈 집합 |
| S5 서빙 | `inapp-message.ts:1639 serveInAppForClient` | 구움 있음 = `:1617 bakedLegacyMessage` · 없음 = `:1491 legacyServeTransform` + 굽기 요청 | 구운 메시지 = 글 비움 · `poster_frame` · `poster_strip` · `poster_text` · `poster_layout` 지움 · 장 = 구운 그림 + `?fit=inapp`(1:1 · 안전 칸) · `imageUrl` = 첫 장 · 장 버튼 · 링크 · `dismiss_mode` 남음 |
| S5b 응답 손질 | `cdp.ts:690 ~ 772` | 앱 | 주소 https 보정 · 색 정리 · 개인화 · web 채널만 template 표(`WEB_OK`) |
| S6 앱 정규화 | 서버 응답 | 설치판 `inapp-core.ts:38 normalizeMessage` | template = `template ?? position ?? center_modal` · `posterLayout` = `design.poster_layout`(지워짐 → overlay) · 장 = 그림 있는 것 · cta · link_url · `dismissMode` |
| S7 서랍 고르기 | — | 설치판 `InAppHost.tsx:93` | `center_modal` = modal · `full_image` = poster · 그 밖 = sheet(구운 메시지도 원래 template 그대로) |
| S8 그리기 | — | 설치판 `InAppBottomSheet.tsx` | poster 2장 이상 = `:139 ~ :175` 바닥 시트 캐러셀(폭 전체 × min(폭×1.25, 화면×0.62) · cover · 점 · 활성 장 버튼) · poster 1장 = `:225 ~ :236` 원본 비율 · 높이 66% · cover · modal = `:300` 그림 한 장 · 높이 45% · 장 넘김 0 · **★ 떠 있는 카드 서랍 0 = 결함 A 자리** |
| S9 동작 | 설치판 `InAppHost.tsx:95 ~ :140` | `inapp-client.ts:85 trackEvent` → `cdp.ts:796 /inapp/track` | 버튼 = click(버튼 id) + 세션 억제 + 이동(`openAction` 스킴 · 앱 경로) · 그림 = click `slide_{i}_image` · 하루 = dismiss `snooze_day` + 24시간 · 다시 보지 않기 = opt_out · 닫기 = dismiss |
| S9b 닫힘 길 | 설치판 `InAppBottomSheet.tsx:109 · :147` | `onRequestClose` · 바탕 누름 | 뒤로 가기 · 바탕 누름 = 닫기(dismiss) · 자동 닫힘 = 앱에 없음 |
| S10 빈도 | 설치판 `inapp-core.ts:140 canDisplay` · `:163 markSeen` | AsyncStorage `hjl_inapp_seen_v1` | optout > snooze(부모 축) > 세션 닫기 > 최대 횟수 > 빈도 |
| S11 OTA 배달 | Harold `eas update`(채널) | 설치판 expo-updates(`package.json:45 ~29.0.18`) · `app.json:77 runtimeVersion = appVersion` · `:80 updates.url` | 같은 앱 버전(runtime)의 설치판만 받는다 · 채널 = `eas.json` production · production-apk · **설치판 버전 · 채널 · 빌드 커밋 = 빈칸 B1 ~ B3** |
| S12 OTA 내용물 | OTA 묶음 = 그 시점 작업 트리 JS 전체 | 설치판 네이티브 모듈 | 작업 트리 = C114-P1 웹뷰 변경 4파일 + `package.json` react-native-webview(네이티브 · 설치판에 없음) + 그 밖 앱 파일 13개 수정(`app/(tabs)/index.tsx` · `me.tsx` · `auth/index.tsx` · `kakao.ts` · `notifications.ts` · `recommendations.ts` · `DealAlertToggle.tsx` · `VoteButton.tsx` · `.env` · `app.json` · `eas.json` · `package.json` · `package-lock.json`) · **설치판에 들어 있었는지 = 빈칸 B4** |
| S13 편집기 미리보기 | `PosterEditor.tsx` `bakedLegacy` · `legacy-app-view.ts legacyAppWillBake` | `LegacyBakedPreview.tsx` | 「구버전 앱 모습」 = 바닥 시트 + 구운 그림 · 안내 `inappSlides.ts appCapsNote` |

## §2 판정 자리 · 두 축

### S7 · S8 서랍(값 범위 = 서버가 보내는 모양 · 그리는 화면 = 팝폰)

| 값 | 지금 팝폰 | SDK(편집기 새 모습) |
|---|---|---|
| 틀 카드 · 여러 장(헬로윈파티) | 바닥 시트 캐러셀 · 1:1 칸 · 흐림 채움 · 점 | 가운데 떠 있는 카드 · 3:4 칸 · 「‹ 1 / 3 ›」 알약 · 카드 안 버튼 · 카드 위 「오늘 하루 보지 않기 · X」 |
| 틀 카드 · 한 장 | poster 한 장 = 원본 비율 · 높이 66% · cover(구운 그림 1:1 · 안전 칸) | 가운데 카드 · 원본 비율 · 높이 72% 상한 |
| 틀 시트(카드 아님) · 여러 장 · 한 장 | 바닥 시트(그릇 같음) · 칸 비율 다름(1:1 맞춤) | 바닥 시트 · 여러 장 3:4 · 한 장 원본 · 바닥 줄 「하루 · 닫기」 |
| 띠(쿠폰 · 남은 시간) | 구운 그림 안 띠(정지 = 복사 버튼 0 · 마감 시각 글) | 띠 + 복사 버튼 · 시계 |
| 개인화 낱말 · 남의 그림 | 굽지 않음 → 옛 변환(글 얹기 · 띠 = 글 한 줄) | 그대로 |
| 이벤트 카드 · 배너 시트 | 팝폰 `InAppPosterSheet.tsx` 가 그린다(굽지 않음) | 같은 레이아웃 |
| 포스터 아님(center_modal · sheet 글 메시지) | modal · sheet | SDK 각 모양 |
| 굽기 전(처음 받아 감 · 실패 10분 쉼 · 글 넘침 영구) | 옛 변환 | 그대로 |

### S11 · S12 OTA(값 범위 = 설치판 · 그리는 화면 = 실제 사용자 폰)

| 값 | 결과 |
|---|---|
| 설치판 앱 버전 = OTA 묶음의 앱 버전 | 다음 실행 또는 그다음 실행에 새 JS |
| 플랫폼 = 안드로이드 · iOS(둘 다 runtime 1.0.2 · 지금 마지막 그룹이 플랫폼마다 따로) | `eas update` 플랫폼 지정 없음 = 둘 다 같은 JS |
| 다른 앱 버전 | 받지 않음(옛 서랍 그대로) |
| OTA 묶음이 설치판에 없는 네이티브 모듈을 부름 | 그 화면에서 앱 오류(실사용자 전원) |
| OTA 묶음에 설치판에 없던 다른 기능 변경이 섞임 | 그 기능이 실사용자에게 같이 나감 |

## §3 빈칸 채움

| 번호 | 칸 | 값(근거) |
|---|---|---|
| B1 | 설치판 앱 버전 · 버전 코드 | 1.0.2 · 14(Harold `eas build:list` 1108 · 마지막 안드로이드 빌드 2026-07-17 18:01 · production · store) |
| B2 | 채널 · runtime | production · runtime 1.0.2(`app.json` version 1.0.2 = OTA 대상 runtime 같음) |
| B3 | 빌드 커밋 | 8c679d87(빌드 11 ~ 14 같은 커밋인데 버전이 1.0.1 → 1.0.2 = 커밋 안 한 작업 트리째 올린 빌드) |
| B4 | 지금 폰에서 도는 JS | 빌드(07-17)에는 09-29 기능(오늘 하루 보지 않기 · 새 레이아웃)이 없는데 폰에는 있다 = **09-29 OTA 가 도는 중**. 이 PC 의 마지막 내보내기 `dist/`(09-29 21:15 · metadata = ios 묶음만) 소스맵 앱 소스 55개 중 52개 = 지금 작업 트리와 글자 그대로 같음 · 다른 3개 = `InAppHost.tsx` · `inapp-client.ts` · `inapp-core.ts`(C114-P1 웹뷰 변경 · 11-08). S12 의 13개 수정 = 09-29 묶음에 이미 들어 있음(git 커밋만 안 됨). → OTA 바탕 = 09-29 묶음 소스(3개 = 소스맵 판) + 새 서랍 |
| B5 | 지금 걸린 OTA(production · runtime 1.0.2) | Harold `eas update:list` 1108 = 안드로이드 마지막 = 그룹 8ef61ef8(약 1개월 전 · 메시지 「0720 포스터형 스크림」 = git 마지막 커밋 글 재사용) · iOS 마지막 = c1b14c87(「0929 인앱 새 모양 · 오늘 하루 보지 않기 · 계약 v3」). 안드로이드 폰에 09-29 코드(오늘 하루 보지 않기 · `InAppBottomSheet.tsx` 09-29 19:17)가 보이므로 8ef61ef8 = 09-29 19:17 이후 내보낸 묶음. 09-01 이후 바뀐 앱 파일 = 09-29 19:16 · 19:17 둘(시트 · 포스터 시트) + 11-08 C114-P1 다섯(hanjul) 뿐 → 두 플랫폼 지금 JS = 09-29 소스맵 판과 같다(C114-P1 hanjul 넷은 그 사이 고친 흔적 확인 불가 · 새 OTA 는 소스맵 판으로 되돌려 iOS 와 같게 맞춘다) |

## §4 범위 밖(기록만)

- 팝폰이 아닌 다른 업체 네이티브 앱 = 그 앱 서랍은 그 업체 코드 · 지금처럼 바닥 시트 + 구운 그림(C116 그대로).
- C114-P1 웹뷰 호스트(react-native-webview = 네이티브 · 스토어 빌드) = 이 OTA 에서 뺀다(작업 트리 변경은 보존 · 되돌리지 않음).
