# 인앱 포스터 · 기능형 재구성 설계서 (2026-11-05)

> 호출어 **인앱 포스터 재구성** / 통짜 포스터 / 떠 있는 카드 / 기능 띠 / 인앱 예시 갤러리.
> 이 문서가 이번 재구성의 SoT 다(접수 대조 · 흐름 표 · 데이터 계약 · 단계 · 시험 · 직원 시트).
> 상위 = [인앱메세지전용.md](인앱메세지전용.md) · 직전 개편 = [2026-09-29 인앱 만들기 개편](2026-09-29-inapp-editor-redesign-design.md)(데이터 계약 `poster_layout` · `poster_slides` · 앱 잠금의 출처).
> 회의 = 2026-11-04 브레인스토밍(COLLAB §1 · 다섯 역할 Explore · 1차 의견 → 교차 토론 1라운드 → 회의론자 최종 검증 8건 전부 수용).
> 상태 = **구현 · 계약 시험 · 실 PG 통과 · Codex 구현 리뷰 approve · 배포 대기 · DDL 0** · 카드 = **C106**(배포 원장 · C105 = 다른 세션) · 새 뿌리 = **R60**(R57 · R58 = C103 · C104 · R59 = C105 가 먼저 씀).

## 진행 표

| 단계 | 상태 |
|---|---|
| 회의(다섯 역할) | 끝(1104) |
| 설계서 | 이 문서 |
| 설계 구조체크 | §11 · 9회차 · 결함 25 정정 · 마지막 회차 결함 0(1105) |
| Codex 설계 리뷰 | §12 · 3라운드 approve(1R 5 · 2R 2 · 3R 0 · 1105) |
| Harold 흐름 표 확인 · 승인 | 끝(1105 「끝까지 구현 끝내고 코덱스리뷰 닫힐때까지」 · 배너 시트 운영 사용 0건 = §10-1 Harold SQL) |
| 구현 · 계약 시험 | 끝(1105 · §13) · backend tsc 0 · frontend tsc 0 · sdk-js tsc 0 · 새 계약 51 · SDK 새 시험 17 · 실 PG 새 9(전체 57파일 407) |
| Codex 구현 리뷰 | §14 · 2라운드 approve(1R 4 · 2R 0 · 1105) |
| 배포(백엔드 · 프론트 · SDK 한 배포 · DDL 0) → 예시 그림 생성(서버 스크립트) → 팝폰 커밋 · OTA → APP_CONFIRMED_CAPS | 대기 |

---

## §0 접수 대조표 (Harold 원문 → 축 → 닫는 절)

| # | Harold 원문(요지 · 1104) | 축 | 이 설계에서 닫는 자리 | 이 축이 없으면 접수가 닫히나 |
|---|---|---|---|---|
| 1 | 「배너시트형 너무 구리지 않냐」 | 배너 시트 처리 | §3-12 | 안 닫힘 |
| 2 | 「이미지스튜디오랑 접목이 잘 안돼」 | 스튜디오 그림 = 메시지(통짜) · 넘김 | §3-3 · §3-8 | 안 닫힘 |
| 3 | 「반응이 좋은건 포스터형 · 형태가 다양」 | 포스터 구조(틀 × 판) | §3-1 · §3-4 | 안 닫힘 |
| 4 | 「모바일형으로 시작 · 웹도 구조체크」 | 앱 · 웹 같은 계약 · 같은 렌더 부품 | §3-2 · §3-7 · §3-11 | 안 닫힘 |
| 5 | 「새롭고 다채롭지만 깔끔하게 딱 떨어지는」 | 깔끔 규칙 = 계약 상수 | §3-4 | 안 닫힘 |
| 6 | 「인앱메세지에도 다양한 기능」 | 기능 띠 · DM 참여 연결 | §3-5 · §3-6 | 안 닫힘 |
| 7 | 「보여준 형태들만이 아니라 다양한 구조 · 창의성」 | 1차 + 2차 목록 | §3-4 · §9 | 안 닫힘 |
| 8 | 「클릭하면 예시 · 가상 업체로 그려 놓기 · 진짜 볼만하게」 | 예시 갤러리 | §3-9 | 안 닫힘 |
| 9 | 「기능 구현은 물론 완벽하게」 | 서빙 관문 · 계약 시험 · 직원 시트 | §3-2 · §6 · §7 | 안 닫힘 |

빠진 축 = 0.

---

## §1 지금 사실 (코드 · 실물에서 확인 · 1104 ~ 1105)

| 사실 | 근거 |
|---|---|
| 포스터 계열 모양 = `overlay` · `event_card` · `banner_sheet` 셋 · 닫기 방식 = `snooze_day` 하나 | `backend/src/utils/inapp-message.ts:127-128` |
| design 은 화이트리스트 정규화(밖의 키는 버림) | `inapp-message.ts:138-178` |
| 포스터형(`full_image`)은 블록 0(빈 허용표) · 카운트다운 · 상품 · 혜택 · 별점 블록은 기본 알림 템플릿에만 | `inapp-message.ts:508-521` |
| 새 시트 틀 = 아래 붙은 전폭 시트 하나(최대 520px · 위 모서리만 둥금) | `sdk-js/src/inapp.ts:1391-1409` |
| 지금 포스터(overlay) 한 장 = 사진 원본 비율 · 62vh 안에 들도록 폭을 줄임(자름 0) · 여러 장 = 4:5 상자 cover(자름) | `inapp.ts:1099-1114` · `:1261` · `:1265` |
| 글이 비면 스크림을 그리지 않는다(웹 · 팝폰 같음) | `inapp.ts:1181` · 팝폰 `InAppBottomSheet.tsx:166` |
| 사진 대체 글(alt)은 늘 빈 값 | `inapp.ts:1096` · `:1264` · `:1451` |
| 이벤트 카드는 장 버튼(cta)을 그리지 않고 사진 링크로 씀 | `inapp.ts:1453-1471` |
| 배너 시트 = 사진 58% × 78% 칸 contain · 글 칸 64% · 본문 굵기 900 → 글이 박힌 스튜디오 그림이 작게 들어가고 그 위에 글이 또 얹힘(1.webp) | `inapp.ts:1485-1492` · `:1509` |
| 스튜디오 생성 = 3:4 포스터 한 종 · 사람이 친 글(라벨 · 제목 · 부제)만 그림에 그림 · 글이 없으면 「글 없는 판」 | `image-studio.ts:158` · `:261-281` |
| 스튜디오 → 인앱 = 사진 주소 + 파일 이름만 · 받는 쪽은 채널 웹 고정 · 모양 지정 없음 | `ImageStudioPage.tsx:201-204` · `InAppMessagesPage.tsx:429-433` · `lib/studio-draft.ts` |
| 스튜디오 결과 카드는 생성에 쓴 제목을 든다 | `StudioMake.tsx:191` · `ImageStudioPage.tsx:144` |
| 스튜디오의 [인앱메시지 만들기]는 회사 관리자만 · 인앱 관리 주소도 관리자만 | `ImageStudioPage.tsx:59` · `routes/cdp.ts:1257` · `:1299` · `:1353` |
| 입구 썸네일 = 손으로 그린 SVG 도형 | `InAppEntryGallery.tsx:17-29` |
| 화면 게시 판정 사본(`publishDefectOf`)이 서버 판정과 두 벌 · 이미 어긋난 기록 있음 | `inappSlides.ts:162-185` · `status/BUGS.md` 245행 |
| 앱 잠금 = 화면 표시용 전역 상수 하나(서빙은 막지 않음) · 이미 true | `inappSlides.ts:222` · `InAppEntryGallery.tsx:83` |
| SDK 는 `/inapp/active` 에 판 정보(버전 · 아는 모양)를 보내지 않는다 · 팝폰도 같고 회원 토큰도 안 보낸다 | `inapp.ts:410-416` · 팝폰 `inapp-client.ts:69-76` |
| 서버 서빙 = 후보 → 변형 고르기 → 매핑 → 억제 → 라우트 후처리(주소 정리 · 웹 형태 보정 · 앱 색 · 개인화) | `inapp-message.ts:1471-1728` · `routes/cdp.ts:634-735` |
| 변형은 부모 첫 장 사진을 복사하고 제목 · 본문을 바꾼다 · 라우트는 제목 · 본문 필수 · 변형 행에는 시작 · 끝 시각이 없다 | `inapp-variant-optimizer.ts:150-152` · `:174-195` · `routes/cdp.ts:1873` |
| [반영] 전파 = 부모 첫 장 사본 + 변형 제목 · 본문 | `inapp-message.ts:1079-1081` |
| 빠른 작업 AI 다듬기 = 글만 바꾼 변형 3안 | `inapp-quick-action.ts:185` |
| 인앱 행을 쓰는 곳 = 세 파일 | grep `INSERT INTO cdp_inapp_messages\|UPDATE cdp_inapp_messages` → `inapp-message.ts` · `inapp-quick-action.ts` · `inapp-variant-optimizer.ts` |
| AI 생성기의 design 은 코드가 정한다(AI 출력 아님) | `inapp-ai-generator.ts:785-788` |
| DM 참여형 8종 · 1인 1회 UNIQUE · 선착순 잠금 · 동의 검사 · 원장 = DM 페이지 축 | `dm/dm-section-registry.ts:68-71` · `dm/dm-interaction.ts:84-88` · `:147-170` · `status/SCHEMA.md` 1044행 |
| DM 공개 주소 = `/api/dm/v/dm-<short_code>`(게시된 DM 만) · 짧은 주소 `hlj.kr/<code>` 해석 = `lookupDmShortLink` | `routes/dm.ts:219` · `dm/dm-builder.ts:681` · `dm/dm-recipient-token.ts:139` |
| 스튜디오 예시 = 서버 스크립트 · 서버 폴더 · 공개 주소 1400px 서빙본 | `backend/scripts/studio-samples.ts` · `image-studio.ts:40-94` · `routes/image-studio.ts:52-65` |
| 가상 업체 선례 = 결온 · 오후담 · 소요웨어 포스터 7장(p3 · p5 · p7 은 그림 속 가운뎃점) | `marketing/promo/2026-10-hanjul-ai/posters/포스터-목록.md` |
| 단가 = 인앱 게시 100 · DM 발행 100 · 스튜디오 생성 2 | `ai-credit-calc.ts:147` · `:164` · `:206` |
| 모델명 시험 = 화면 `.tsx` 에서 Opus · Sonnet · Haiku · Claude · Anthropic 만 봄 · 지금 프론트 `.ts` · `.tsx` 에 Gemini · GPT · OpenAI · 제미나이 0건 | `utils/__tests__/root-ledger.test.ts:583-585` · grep 1105 |
| 팝폰 인앱 폴더 = 4파일 수정 · `InAppPosterSheet.tsx` 새 파일이 커밋되지 않음 | `poppon-app` `git --no-optional-locks status --short src/lib/hanjul/`(1105) |
| 팝폰 = 여러 장 4:5 cover · 화면 62% 상한 · 한 장 = 66% 상한 cover · 링크 = 외부 브라우저 · 클립보드 모듈 있음 | `InAppBottomSheet.tsx:144` · `:165` · `:236-237` · `InAppHost.tsx:116-126` · `package.json:27` |

---

## §2 흐름 표 (이음매 · 쓰는 쪽 · 읽는 쪽 · 값 범위 · 그리는 화면)

뽑은 방법(손 목록 금지 · DEFECT-PLAYBOOK §1):
- 쓰는 자리 = `grep -rn "INSERT INTO cdp_inapp_messages\|UPDATE cdp_inapp_messages" packages/backend/src --include=*.ts`(시험 제외) → 3파일
- 변형 생산자 = `grep -rn "createVariant(" packages/backend/src --include=*.ts` → `routes/cdp.ts:1876` · `inapp-quick-action.ts:185`
- 켜기 길목 = `grep -rn "activateInAppMessage(\|status = 'active'" packages/backend/src/utils/inapp-*.ts`
- 모양 값 소비 = `grep -rln "poster_layout\|posterLayout" packages` → 백엔드 1 · 프론트 6 · SDK 1 · 팝폰 3
- 장 소비 = `grep -rln "poster_slides\|posterSlides" packages/backend/src` → `routes/cdp.ts` · `inapp-message.ts` · `inapp-personalization.ts` · `inapp-variant-optimizer.ts`
- 서빙 = `grep -rn "getActiveMessagesForCustomerV2\|mapRowToMessageDetail" packages/backend/src` → 라우트 1 · 매퍼 1
- 반응 = `grep -rn "event_type\|button_id" packages/backend/src/utils/inapp-*.ts`

| T | 단계 | 쓰는 쪽 | 읽는 쪽 | 판정 자리 | 값 범위(이번에 새로 들어오는 값) | 값을 그리는 화면 |
|---|---|---|---|---|---|---|
| T1 | 입구 | `InAppEntryGallery.tsx:63-195` · `inappStarters.ts` · 스튜디오 넘김 `InAppMessagesPage.tsx:429` · (새) 예시 갤러리 | 편집기 시작 상태 `onPick(seed)` | 없음(시작 상태) | 예시 seed · 스튜디오 초안 `{imageUrl, name, texts?, textInImage?}`(texts 없음 = 라이브러리 소재) | 입구 카드 · 예시 상세 창 · 틀 고르기 판 |
| T2 | 편집 작업본 → 저장 칸 | `inappSlides.ts:124-150` `messagePatchFromSlides` · 모양 바꾸기 `InAppMessagesPage.tsx:2180-2222` | 서버 create · update | 없음 | design 새 키 3 · 장 글(통짜 = 그림 속 글) · 띠 값 | 휴대폰 미리보기 · 오른쪽 칸 |
| T3 | 저장 정규화 | `sanitizeInAppDesign` `:138-178` · `sanitizePosterSlides` `:382-428` | 행(`design` · `poster_slides`) | 화이트리스트 | 모르는 값 · 조합 금지(통짜 + 이벤트 카드 등) · 띠 코드 길이 · 빈 값 | 없음(저장) |
| T4 | 게시 판정 | `inAppPublishDefect` `:590-624` · 부르는 자리 5 = create `:774-780` · update 결과 행 `:1042` · 변형 생성 `inapp-variant-optimizer.ts:163-172` · 켜기 `:1148` · 전파 `:1112` | 라우트 400 `INAPP_NOT_PUBLISHABLE` · 편집기 `InAppMessagesPage.tsx:2289-2291` | 같은 CT 한 곳 | 예시 그림 · 띠 코드 빈 값 · 자리표 · 남은 시간 띠 + 끝 시각 없음 · 끝 시각 지남 · 통짜 장 글의 변수 | 편집기 경고(칸 · 장 · 띠 · 기간으로 데려감) |
| T5 | 게시 과금 | `settleInAppPublish` `:696-714` · POST `routes/cdp.ts:1323-1326` · PUT `:1395-1407` | 크레딧 원장 | 게시로 넘어갈 때만 | 변화 없음(100) | 과금 확인 창 |
| T6 | 변형 | `createVariant` `inapp-variant-optimizer.ts:121-240` · 부르는 곳 2 · 전파 `propagatePosterToVariants` `:1064-1117` · 켜기 `:249` | 서빙 변형 고르기 `:1576-1598` | createVariant 한 곳 · 전파 한 곳 | 통짜 부모 + 글만 다른 변형 · 그림 없는 변형 · 변형 행 끝 시각 없음 | 변형 검토 창 · A/B 결과 |
| T7 | 서빙 후보 | `INAPP_CANDIDATE_WHERE` `:1523-1529` | `evaluateInAppCandidates` `:1536` | 기간 · 세그먼트 · 변형 · 억제 · (새) 클라이언트 관문 | 판 목록 없음(옛 SDK · 지금 팝폰) · 일부 · 모르는 낱말 · 긴 값 | 없음 |
| T8 | 서빙 매핑 | `mapRowToMessageDetail` `:1399-1428` | 라우트 · SDK · 앱 | (새) 통짜 비우기 | 통짜 장 글 · 라벨 · 배지 · 대체 글 | 웹 · 앱 화면 |
| T9 | 라우트 후처리 | `routes/cdp.ts:658-732` | SDK · 앱 | 주소 정리 · 웹 형태 보정 · 앱 색 · 개인화 | 비운 글(개인화 없음) · 띠 글 | 웹 · 앱 화면 |
| T10 | 웹 렌더 | `renderMessage` `inapp.ts:778` → `renderPoster` `:1007` → (새) 틀 렌더 | 몰 화면 | 모양 판정 `resolvePosterLayout` `:267` + (새) 틀 · 판 · 띠 판정 | 통짜 · 카드 · 띠 · 장 1 ~ 5 · 그림 비율 제각각 · 시계 어긋남 | 몰 화면(모바일 · PC) |
| T11 | 앱 렌더 | 팝폰 `InAppHost.tsx` → `InAppBottomSheet.tsx` · `InAppPosterSheet.tsx` | 앱 화면 | `resolvePosterLayout` `inapp-core.ts:16-19` | 같음 | 앱 화면 |
| T12 | 반응 기록 | SDK `track` `inapp.ts:2679` · 팝폰 | `trackImpression` `inapp-message.ts:1236-1272` | event_type 4종 `:1240` | (새) button_id `copy_code` · `slide_N` · `slide_N_image` · `snooze_day` | 통계 화면 |
| T13 | 억제 | 하루 보지 않기 · 다시 보지 않기 `:1607-1641` · 빈도 `:1643-1708` | 서빙 | 부모 축 | 변화 없음 | 없음 |
| T14 | 집계 | `getMessageStats(Batch)` `:1278-1337` · 깔때기 · 상위 메시지 | 목록 · 상세 | 이벤트 종류 | 복사 = click | 목록 카드 숫자 · 상세 |
| T15 | 그림 생성 | 스튜디오 생성 `routes/image-studio.ts:127-230` · `StudioInsertModal` | 장 그림 · 장 글 | `findUnfilledTemplateText` `:165`(기존 · 새 판정 0) | 자리표 든 글 · 빈 글(글 없는 판) · 80자 넘는 제목(`image-studio.ts:262` 에서 자름) | 생성 창 · 편집기 사진 칸 |
| T16 | 예시 | (새) 예시 표 CT · 스크립트 · 공개 그림 주소 · 목록 주소 | 갤러리 · 편집기 seed | 예시 그림 게시 차단(T4) | 그림 아직 없음 · 업종 없음 · 업종 4 밖 | 갤러리 · 상세 창 |
| T17 | 멈춤 · 보관 · 지우기 | PUT status · DELETE `routes/cdp.ts:1348` · `:1457` | 서빙 후보에서 빠짐 | `INAPP_CANDIDATE_WHERE` | 변화 없음 | 목록 |
| T18 | DM 참여 연결 | (새) 편집기 링크 고르기 · 게시 때 정책 판정 | DM 뷰어 `/api/dm/v/dm-<code>` · 참여 원장 | (새) 경품 DM 연결 판정 | 경품 · 선착순 섹션 든 DM · 게시 안 된 DM · 다른 회사 DM · 짧은 주소 · 직접 친 주소 | 링크 고르기 창 · 게시 경고 |

---

## §3 설계

### 3-1 데이터 계약 (DDL 0 · 새 template 값 0 · design jsonb 새 키 3)

| 키(design) | 값 | 없음일 때 | 뜻 |
|---|---|---|---|
| `poster_text` | `'baked'` | 지금(글 칸 · 렌더러가 글을 그림) | **통짜**: 그림 속 글이 메시지 · 서빙 때 글 칸을 비운다(§3-3) |
| `poster_frame` | `'card'` | 바닥 시트(지금) | **떠 있는 카드**: 가운데 · 네 모서리 둥금 · 닫기는 카드 위 어둠 위(§3-4) |
| `poster_strip` | `{ type: 'coupon', code, label? }` · `{ type: 'countdown', label? }` | 띠 없음 | **기능 띠**: 그림 아래 한 줄(§3-5) |

정규화 규칙(`sanitizeInAppDesign` 한 곳 · fail-closed · 아래 순서대로):
- `poster_text` = `'baked'` 만 받는다. 받으면 `poster_layout` 은 지운다(통짜 = 지금 포스터 갈래 · 이벤트 카드 · 배너 시트와 섞지 않는다). 이 판정을 먼저 한다(뒤 두 줄이 정리된 `poster_layout` 을 본다).
- `poster_frame` = `'card'` 만 받는다. `poster_layout` 이 `event_card` · `banner_sheet` 이면 버린다(1차 = 포스터 갈래만).
- `poster_strip.type` = `'coupon'` · `'countdown'` 만. `code` = 앞뒤 공백 · 줄바꿈 제거 · 40자에서 자름(글자 종류는 저장에서 거르지 않는다 · 초안의 자리표 코드가 저장 때 띠째 사라지지 않게 · 글자 판정은 게시 판정 §3-5) · `label` = 30자에서 자름. `countdown` 의 마감 = 메시지 `end_at`(새 칸 0). `poster_layout` 이 `event_card` · `banner_sheet` 이면 띠를 버린다.
- 세 키는 `template = 'full_image'` 일 때만 읽힌다(서빙 · 렌더 · 관문 모두 같은 조건 `isPosterFamily(row)` 한 곳).
- 생산자: 편집기만 쓴다. AI 생성기 design 은 코드가 정한다(`inapp-ai-generator.ts:785-788`) → 세 키를 만들지 않는다(계약 시험 CT-IA8).

옛 행 = 세 키 없음 = 지금 동작 그대로(회귀 0).

### 3-2 서빙 관문 (클라이언트가 그릴 수 있는 것만 준다)

- **요청**: 새 SDK · 새 앱은 `/inapp/active?caps=poster_baked,frame_card,strip_coupon,strip_countdown` 를 싣는다. 낱말 표 = 서버 상수 `INAPP_CLIENT_CAPS`(한 곳 · SDK · 앱은 같은 낱말을 상수로 든다 · 계약 시험 CT-IA4). 서버는 표 밖 낱말을 버리고, 200자 · 20낱말에서 자른다.
- **필요 판**(`inAppRequiredCaps(row)` 한 곳 · `isPosterFamily` 일 때만):
  - 반드시(hard) = `poster_baked`(통짜) · `strip_coupon` · `strip_countdown`(띠) · `frame_card` 인데 장 2장 이상(옛 SDK · 옛 앱은 틀을 지우면 여러 장을 4:5 cover 캐러셀로 그려 그림이 잘린다 `inapp.ts:1261-1265` · 팝폰 `InAppBottomSheet.tsx:144-165`)
  - 있으면 좋음(soft) = `frame_card` 이고 장 1장 이하(옛 클라이언트의 한 장 포스터 = 원본 비율 · 자름 0 `inapp.ts:1099-1114`)
- **판정 자리**: `evaluateInAppCandidates` 의 변형 고르기 뒤(`inapp-message.ts:1598` 다음) · 매핑 직후 한 곳. hard 가 빠진 클라이언트 = 그 메시지를 내보내지 않는다. soft 만 빠짐 = 내보내되 응답 사본에서 `poster_frame` 을 지운다(바닥 시트로 그린다 · 내용 손실 0). 쪽 반복(`:1506`)이 이 판정 뒤 수를 세므로 「20개 채우기」가 그대로 맞다.
- **옛 클라이언트**: 옛 SDK(배포 직후 최대 1시간 캐시) · 지금 팝폰 = `caps` 없음 = 통짜 · 띠 메시지를 받지 않는다(잘린 그림 · 빠진 쿠폰 코드를 보여 주지 않는다). 떠 있는 카드는 바닥 시트로 보인다.
- **SDK 캐시**: 캐시 키에 `caps` 를 넣는다(`inapp.ts:419`).
- **편집기 표시**: 앱 채널에서 hard 판이 필요한 모양을 고르면 「앱 새 판이 깔린 뒤 보여요」 · soft 만(떠 있는 카드) = 「앱 새 판 전에는 바닥 시트로 보여요」 · 게시 확인 창에 같은 줄(게시비 100 을 내도 앱에 안 보일 수 있음을 그 자리에서 말한다). 판정 = 프론트 상수 `APP_CONFIRMED_CAPS`(처음 = 빈 집합 · 팝폰 OTA 실기기 확인 뒤 낱말을 넣는다 · 옛 전역 `APP_SHEET_LAYOUTS_UNLOCKED` 를 대신한다 · 0929 세 모양은 늘 확인됨).

### 3-3 통짜 포스터 규칙 (`poster_text = 'baked'`)

| 자리 | 규칙 |
|---|---|
| 저장 | 장 글 칸(`title` · `body` · `eyebrow`)에 **그림 속 글**을 그대로 둔다(새 키 0 · 기존 혜택 · 자리표 검사 · 개인화 스캔이 그대로 돈다). 첫 장 제목 = 메시지 제목 = 목록 이름 = 대체 글 |
| 게시 판정 | 기존 판정 그대로 + 장 글에 개인화 변수가 있으면 「그림 속 글에는 고객 이름 같은 바꿔 넣기 글을 쓸 수 없어요」. 변수 판정 = 치환 함수와 같은 근거 한 곳 `textHasPersonalizationVar(t)` = `detectLiquidSyntax(t)` 또는 `LEGACY_VARIABLE_MAP` 의 키(`%이름%` 등)를 품음(`inapp-personalization.ts:81-88` · `:111`). `:122` 의 공백 정리 정규식(`%[가-힣A-Za-z]`)은 「30%할인」도 잡으므로 판정에 쓰지 않는다 |
| 서빙 | `toServedMessage(m)`(매핑 직후 · 관문과 같은 자리)에서 ① 장이 없으면(flat 만 · `:1424` 가 빈 배열을 낼 수 있음) flat 에서 첫 장을 먼저 만든다(그림 = `imageUrl` · 버튼 = `buttons[0]` · 링크 = `imageLinkUrl` · 제목 = 메시지 제목 · SDK 시트 폴백 `inapp.ts:1018-1027` 과 같은 규칙) ② 메시지 `title` · `body` = 빈 글 · `badgeText` = null · 장마다 `title` · `body` · `eyebrow` · `subtitle` 를 지우고 `alt` = 그 장 원래 제목(없으면 메시지 원래 제목). 장 버튼 · 링크 · 그림은 그대로 |
| 웹 · 앱 렌더 | 글 그리지 않음 · 그림 = contain(자름 0) · `img.alt` = 장 `alt` |
| 개인화 | 비운 글이라 치환 없음 · 대체 글은 변수 금지라 치환 대상 아님 |
| 변형 | 그림만 바꾼다. 생성 = `createVariant` 한 곳(부르는 곳 둘 다 지남): 부모가 통짜면 `image_url` 필수 · 첫 장 = 부모 첫 장 사본 + 변형 그림 · 변형 제목(= 그림 속 글) · 그림 없는 변형 = 400 「그림에 글이 들어간 메시지는 그림을 바꿔서 비교해요」. 부모가 통짜가 아니면 지금처럼 본문 필수(400). 라우트(`routes/cdp.ts:1873`)는 부모 design 을 모르므로 원본 · 제목만 확인하고 본문 · 그림 필수는 createVariant 가 정한다. **변형 판정 CT** `inAppVariantDefect(kid, parent)` 한 곳 = 부모가 통짜인데 변형 design 이 통짜가 아니면 「통짜 원본의 변형은 그림 변형만 켤 수 있어요」 · 켜기(`activateInAppMessage` 변형 · 부모 행을 함께 잠가 읽음)와 전파가 부른다 |
| 빠른 작업 AI 다듬기 | 통짜 부모 = 크레딧 · AI 호출 전에 400 「그림에 글이 들어간 메시지는 문구 다듬기 대신 그림을 바꿔 시험해 주세요」(`inapp-quick-action.ts` 진입 첫 줄). 화면 = 통짜 메시지에서는 [문구 다듬기(A/B 3안)] 단추를 그리지 않고 그 자리에 한 줄 같은 이유(죽은 단추 0) |
| 그림 A/B 입구 | 1차 없음. 지금 화면의 변형은 AI 다듬기 3안뿐이다(편집 화면이 부르는 변형 동작 = `list` · `set_status` 만 · `InAppMessagesPage.tsx:3831-3853`). 그림을 바꾼 변형 만들기 화면 = 2차(§9). createVariant 규칙은 API 길을 위해 1차에 둔다 |
| [반영] 전파 | `propagatePosterToVariants` 에서 통짜 부모면 변형마다 가른다(SELECT 에 `image_url` · `poster_slides` · `design` · `status` 를 더한다 · `:1071` · FOR UPDATE 그대로): ① 이미 통짜인 변형 = 첫 장 그림 = 변형의 지금 첫 장 그림(`poster_slides[0].image_url` · 없으면 변형 `image_url`) · 글 = 변형 제목 · 본문 · design = 부모 design ② 통짜가 아닌 변형(글 얹기 시절의 문구 변형) = design · 장을 바꾸지 않고 `status = 'paused'`(같은 트랜잭션) · 다시 켜기는 `inAppVariantDefect` 가 막는다. 그대로 두면 부모 baked design 이 옮겨 가 서빙 때 문구가 지워지고 배경만 남는다. 전파가 멈춘 수를 돌려주고(PUT 응답 `variants_paused`) 편집기는 [반영] 뒤 「글만 다른 변형 N개는 통짜에서 비교할 수 없어 멈췄어요」를 띄운다(화면이 따로 세지 않는다 · 원본을 글 얹기로 되돌리면 그 변형을 다시 켤 수 있다 = `inAppVariantDefect` 가 통과) |
| 모양 바꾸기 | 통짜 ↔ 글 얹기 전환은 글 · 그림을 그대로 둔다(미리보기가 결과를 그대로 보여 준다). 통짜에서 기본 알림으로 = 지금 규칙(첫 장 → flat) |

### 3-4 틀 · 깔끔 규칙 (계약 상수 `POSTER_FRAME_RULES` · 렌더 부품 안 한 곳)

1차 틀 = **바닥 시트**(지금 · 참고 2 · 4 · 6) · **떠 있는 카드**(새 · 참고 5). 닫기 자리는 틀이 정한다(마케터가 고르는 칸이 아니다).

| 규칙 | 바닥 시트 | 떠 있는 카드 |
|---|---|---|
| 위치 | 아래 붙음 · 전폭 · PC 최대 520px 가운데 | 화면 가운데 · 좌우 여백 28px(모바일) · PC 최대 400px |
| 모서리 | 위 20px | 네 모서리 16px |
| 그림 | contain(자름 0) · 원본 비율 · 전체 높이가 72vh 를 넘으면 폭을 줄여 비율 유지 | 같음 |
| 여러 장 | 3:4 상자 contain · 남는 자리 = 장 `bg_color` 또는 `#111827` | 같음 |
| 쪽 번호 | 그림 안 오른쪽 아래 12px 알약(그림 위 HTML 허용 예외 하나) | 같음 |
| 버튼(장 cta) | 그림 아래 흰 칸 안 가로 꽉 찬 48px 버튼(그림 위에 얹지 않음) | 카드 안 그림 아래 48px 버튼 |
| 닫기 | 바닥 흰 줄 52px: 왼쪽 「오늘 하루 보지 않기」(또는 「다시 보지 않기」) · 오른쪽 「닫기」 | 카드 위 어둠 위 한 줄 44px 높이: 왼쪽 「오늘 하루 보지 않기」 흰 글 · 오른쪽 X(누름 자리 44px) |
| 기능 띠 | 그림과 버튼 사이 52px | 같음 |
| 강조색 | 띠 · 버튼 = 메시지 `accent_color`(hex · 없으면 `#111827`) 하나 | 같음 |
| 글 얹기(live) | 지금 스크림 규격 그대로(`inapp.ts:1176-1207` 을 부품으로 옮겨 지금 포스터도 같은 함수를 부른다) | 같음 |
| 키보드 | ←/→ 장 넘김 · Esc 닫기(지금 시트와 같음) | 같음 |

「포스터 위 HTML 0」 · 「강조색 하나」 · 「72vh 넘으면 폭 축소」 · 「닫기 누름 자리 44px」 = 계약 상수(계약 시험 CT-IA6 이 부품 소스에서 값을 읽어 확인).

### 3-5 기능 띠 (원장 0)

| 띠 | 화면 | 동작 | 기록 |
|---|---|---|---|
| 쿠폰 코드 복사 | 「{label 또는 쿠폰 코드}」 · 코드 · [복사] | 웹 = `navigator.clipboard.writeText` · 막히면 숨은 글 칸 선택 + `document.execCommand('copy')` · 둘 다 실패 = 코드 글자를 선택해 둔다 · 성공 = 버튼 글 「복사했어요」 2초 · 메시지는 닫지 않는다 · 앱 = `expo-clipboard` | `click` · `button_id = 'copy_code'` |
| 남은 시간 | 「{label 또는 마감까지}」 · `N일 HH:MM:SS` 또는 `HH:MM:SS` | 1초마다 다시 셈 · 0 이하 = 「마감됐어요」 · 닫히면 시계 멈춤 · 서버 시각 기준(응답에 `serverNow` 를 싣는다 · 옛 SDK 는 모르는 칸이라 무시 · 받은 순간의 차이(서버 − 기기)를 5분 캐시 항목에 함께 적어 캐시 경로도 같은 차이를 쓴다) | 없음 |

- 마감 = 서빙한 메시지의 `endAt`. 변형이 뽑히면 서빙 사본의 시작 · 끝 시각을 부모 값으로 채운다(변형 행에 없음 · `inapp-variant-optimizer.ts:174-195` · SDK · 팝폰은 지금 `endAt` 을 읽지 않는다 = grep 0 · 기존 동작 영향 0).
- 게시 판정(T4 · `inAppPublishDefect` 한 곳): 쿠폰 코드 빈 값 · 자리표 · 띠 라벨 자리표 = 「쿠폰 코드를 넣어 주세요」 · 코드에 `[0-9A-Za-z가-힣_-]` 밖 글자 = 「쿠폰 코드는 영문 · 숫자 · 한글 · - · _ 만 쓸 수 있어요」(둘 다 `field: 'strip'`). 끝 시각 판정은 **부모 행만**(`parent_message_id` 없음): 남은 시간인데 `end_at` 없음 = 「남은 시간을 보여 주려면 게시 끝 시각을 정해 주세요」 · `end_at` 지남 = 「게시 끝 시각이 지났어요」(둘 다 `field: 'end_at'`). 변형 행은 끝 시각이 없고 부모 기간으로만 서빙되므로(`INAPP_CANDIDATE_WHERE` = 부모만 · `:1526`) 변형 생성 · 켜기 · 전파에서 이 판정을 하지 않는다. 부모 여부 = 판정 행의 `parent_message_id` 하나로 가른다(판정 행 = 저장 결과 행 · §3-13).
- 미리보기도 같은 셈(고정 목업 금지 · LESSONS_FRONTEND 170).

### 3-6 DM 참여 연결 (인앱 = 문 · DM 참여 페이지 = 방)

- 편집기 장 버튼 · 사진 링크 칸에 [내 DM 참여 페이지 연결] 고르기 창: 이 회사의 게시된 DM 중 참여 섹션이 있는 것 · 정식 주소 `${HANJUL_BASE_URL}/api/dm/v/dm-<short_code>` 를 넣는다(식별값 0 · `?p=` · `?r=` 금지).
- 1차 허용 = 경품 · 재고가 없는 참여(`poll` · `survey` · `email_capture` · `click_rewards` · `instant_coupon`). 경품 · 재고 섹션(`lucky_draw` · `roulette` · `limited_quantity`)이 든 DM = 고르기 창에서 흐리게 + 「경품 · 선착순 DM 은 앱 회원 확인이 붙은 뒤 연결돼요」.
- 서버 판정 = `inAppDmLinkPolicyDefect(run, companyId, row)` 한 CT(새 파일 `inapp-dm-link-policy.ts` · 읽기만 · 기존 함수 `getDmByCode` · `extractFlatSectionsFromDm` · `lookupDmShortLink` · `lookupCustomShortLink` 재사용 = 새 SQL 0). **읽기는 지금 트랜잭션의 연결(`run`)로만 한다** — 트랜잭션 연결을 쥔 채 풀에서 연결을 하나 더 기다리면 동시 요청이 풀을 채우는 순간 서로 막힌다(뿌리 R41). 재사용 세 함수(`getDmByCode` · `lookupDmShortLink` · `lookupCustomShortLink`)에 선택 인자 `run`(없으면 지금처럼 풀 `query`)을 더한다 · 다른 호출처 무변경(계약 시험 CT-IA12 = DM 판정 CT 소스에 풀 `query` 직접 호출 0) · 게시 판정과 같은 다섯 자리(T4)에서 함께 부른다. 판정 행(= 저장 결과 행 · §3-13)의 모든 링크(메시지 `action_url`(앱 응답이 버튼으로 승격 `inapp-message.ts:1723-1724`) · `buttons[].action_url` · `image_link_url` · 장 `cta.action_url` · 장 `link_url`)에서 DM 정식 주소(`/api/dm/v/dm-<code>`) · 짧은 주소(바탕 = 환경값 `DM_SHORT_LINK_BASE` · `routes/dm.ts:1469` 와 같은 값 · `/<code>` → `lookupDmShortLink`(`dm/dm-recipient-token.ts:139`) · 없으면 `lookupCustomShortLink`(`dm/dm-custom-short-link.ts:112`)의 목적 주소를 한 번 더 같은 판정 · 그 이상 따라가지 않는다)를 찾아 그 DM 섹션을 읽고, 경품 · 재고 섹션이 있으면 400 「경품 · 선착순 DM 은 아직 인앱에 연결할 수 없어요」(`field: 'link'` · 장 번호). 다른 회사 DM · 게시 안 된 DM = 「연결할 수 없는 DM 이에요」. 그 밖 주소 = 판정 밖(지금과 같음).
- 원장 · 1인 1회 · 동의 · 선착순 잠금 = DM 그대로(`dm-interaction.ts`). 인앱 클릭 기록 = 지금처럼 `click`.
- 2차 = 경품 · 선착순 연결(고객 앱이 회원 토큰을 보냄 + 클릭 때 서버가 1회 토큰 발급 + 「확인된 사람만」 게이트를 추첨 · 선착순 효과 자리까지).

### 3-7 렌더 구조 (그리는 부품 하나)

- **새 파일** `packages/sdk-js/src/poster-frame.ts`: `buildPosterFrame(input) → { backdrop, root, parts }`. 순수 DOM 조립만(document.createElement · 스타일 · data-hjl-part). 기록 · fetch · 저장소 · 이동 · 타이머 0(계약 시험 CT-IA6 이 소스에서 `fetch` · `track` · `localStorage` · `setInterval` · `location` 0 을 확인). 입력 = 메시지(서빙 사본) · 현재 장 · 스크롤 위치 · 정적 여부 · 지금 시각 · **붙이는 자리 `mount: 'page' | 'frame'`**(page = 몰 화면 · 배경 `position: fixed` 화면 전체 / frame = 편집기 · 갤러리의 휴대폰 틀 안 · 배경 `position: absolute` 틀 크기 · 72vh 같은 화면 비율 값은 틀 높이 기준). SDK 는 늘 page, 프론트는 늘 frame(계약 시험 CT-IA6 이 frame 렌더 결과에 `position: fixed` 0 을 확인).
- **SDK** `renderPoster`(`inapp.ts:1007`): 통짜 · 떠 있는 카드 · 띠 중 하나라도 있으면 `renderPosterFrame` → 부품을 조립하고 SDK 가 손잡이를 붙인다(장 넘김 · 기록 · 하루 보지 않기 · 복사 · 시계 · 키보드 · 링크). 장이 없는 메시지(flat 만)는 지금 시트 경로와 같은 규칙으로 flat 에서 첫 장을 만든다(`:1018-1027`). 그 밖 = 지금 경로 그대로.
- **지금 3모양**(overlay · event_card · banner_sheet) = 바꾸지 않는다. 단 스크림은 부품 함수로 옮겨 지금 포스터 · 캐러셀이 같은 함수를 부른다. 이 둘의 DOM 이 옮기기 전후 같다는 스냅샷 시험을 먼저 잠근다(CT-IA7).
- **프론트 미리보기**: 스크립트 `packages/frontend/scripts/sync-poster-frame.mjs` 가 SDK 파일을 `frontend/src/components/inapp/generated/poster-frame.ts` 로 복사(머리 한 줄 「자동 복사본 · 직접 고치지 않는다」). 계약 시험 CT-IA5 = 머리를 뺀 본문이 글자 단위로 같음. `PosterFramePreview.tsx` = 부품 결과를 shadow root 에 붙인다(앱 전역 서체 `!important` 규칙이 닿지 않아 서체도 실물과 같다). 편집 클릭 = `data-hjl-part` 위임 → 오른쪽 칸.
- **앱(팝폰)**: RN 렌더 = 같은 규칙 상수 표(`POSTER_FRAME_RULES` 값)를 계약서에 적고 앱이 미러 · 실기기 대조(§3-11).

### 3-8 이미지 스튜디오 접목

| 자리 | 바꿈 |
|---|---|
| 넘김 데이터 | `StudioDraft` = `{ imageUrl, name, texts?: {label,title,subtitle}, textInImage? }`. 새 결과 카드 = 생성에 쓴 글(`StudioMake.tsx:191` 이 texts 전체를 결과에 싣는다) · `textInImage = true`. 라이브러리 소재 = 소재 `channelSpec` 이 `poster` · `inapp-poster` 면 `textInImage = true` · 글 = 파일 이름에서 「_채널.확장자」를 뺀 헤드라인(`buildAssetDisplayName` 규칙의 반대 · 비면 빈 글) |
| 받는 쪽 | `InAppMessagesPage.tsx:429-433`: 채널 웹 고정을 없앤다. **틀 고르기 판** 한 장(내 그림을 바닥 시트 · 떠 있는 카드에 끼운 실물 썸네일 · 채널 웹/앱 고르기 · 한 번 누르면 편집기). 통짜면 첫 장 글 = 넘어온 글 · 제목이 비면 제목 칸을 먼저 연다(목록 이름 · 대체 글이라 필수) |
| 편집기 사진 칸 [AI로 그리기] | 공용 `StudioInsertModal` 재사용. 바꿈 = `onInserted(url, texts)`(DM 호출부는 둘째 인자를 안 쓴다 · 영향 0) · `textless` 선택(글 얹기 장 = 글 없는 판 · `textPosition: 'bottom'` 으로 아래 자리를 비운다) · `initialTemplateId` 선택(시작본 · 예시가 템플릿을 정해 두면 고르기 단계를 건너뛰고 만들기 단계로 연다 = 누름 한 번 + 2크레딧 확인 · 없으면 지금처럼 고르기부터 · DM 영향 0). 통짜 장이면 넣은 글이 그 장 글이 된다. 2크레딧 = 버튼에 적는다 · 닫기 = 숨김(지금 창 규칙) |
| 생성 전 자리표 판정 | **이미 있다** = 생성 라우트 `routes/image-studio.ts:165-168` `findUnfilledTemplateText`(`image-studio-templates.ts:5835` · 대괄호 안 「직접 · 입력해 · 작성해」 · `{productName}` 토큰 → 400 `PLACEHOLDER_TEXT` + `field` · 크레딧 확인 `:171` 전). 새 판정을 만들지 않는다. 예시 seed · 통짜 시작본의 혜택 자리는 `[혜택 안내: 직접 작성해주세요]` 꼴로만 넣어 이 판정에 걸리게 한다(계약 시험 CT-IA3 가 모든 seed 의 혜택 자리를 이 함수로 확인) |
| 예시에서 시작 | §3-9 |

### 3-9 예시 갤러리 (가상 업체 · 실제 생성 · 실제 렌더)

- **예시 표 CT** `backend/src/utils/inapp-examples.ts`: `INAPP_EXAMPLES` = `{ id, industry('beauty'|'fashion'|'commerce'|'cafe'), brand, title(카드 이름), seed(편집기 시작 상태 = 메시지 저장 칸 그대로), slides[{ studioTemplateId, texts, product? }] }`. 예시 글 = 사람이 쓴 표 · 혜택 숫자(% · 원) · 혜택 낱말(쿠폰 · 무료 · 할인 · 증정) · 줄표 · 가운뎃점 0(계약 시험 CT-IA3).
- **생성 스크립트** `backend/scripts/inapp-examples.ts`(`studio-samples.ts` 와 같은 꼴): `make <장수> [id,…]` = 그림 없는 장만 · 같은 엔진(`studioImageEngine`) · `buildPosterPrompt` + 템플릿 + 예시 글(통짜) 또는 글 없는 판(글 얹기) · 상품 누끼 = `backend/assets/inapp-examples/cut-*.png`(선례 cut-kyeolon · cut-ohudam · cut-soyo 를 옮겨 둔다 · 커머스 누끼 1 = 미결 §10) · 실패 3번이면 멈춤 · 크레딧 · DB 0. `warm` = 서빙본 미리 만들기. 저장 = `INAPP_EXAMPLE_PATH`(기본 `./uploads/inapp-examples`) · `<id>-<장>.jpg` · 임시 파일 → 이름 바꾸기.
- **주소**: `GET /api/cdp/inapp/examples`(관리자 · `/inapp` 과 같은 문 · `router.use(authenticate)` `routes/cdp.ts:877` 뒤) = 회사 업종을 붙인 예시 목록 + 장 그림 주소 + `ready`. 업종 = `resolveCompanyIndustry`(`copy-prompt-composer.ts:38`) → `inAppExampleIndustry(code)`(새 · `studioIndustryCategories` `sales-outreach-produce.ts:342` 옆 · 뷰티 → beauty · 의류 → fashion · 요식 → cafe · 그 밖 · 없음 = null = 전체). `GET /api/cdp/inapp/example-image/:id/:slide`(공개 · `/inapp/image` `:613` 옆 = 인증 미들웨어 **앞** · id · 장 번호를 표로 검증 · 1400px 서빙본 · 긴 캐시 · `?v=수정 시각`). 둘 다 갤러리가 부른다(R15).
- **화면**: 입구 맨 위 「예시로 보고 시작」 · 업종 칩(회사 업종 자동 · 없으면 전체) · 카드 = 흐린 앱 화면 위 휴대폰 틀 안에 실제 부품 정적 렌더 · 화면에 보이는 카드만 그린다 · 그림 미준비 예시 = 목록에서 뺀다 · 준비된 예시 0 = 섹션 자체를 그리지 않는다(빈 틀 · 빈 섹션 0). 누르면 상세 창(커스텀 창 · 실제 부품 · 장 넘김 · 복사 · 남은 시간 동작) → [이 모양으로 시작].
- **남은 시간 예시**: 상세 창 · 카드의 마감 = 그 화면을 연 시각 + 2일(고정 숫자 아님 · 매번 계산). seed 의 `end_at` 은 비워 둔다(게시 때 판정이 묻는다 §3-5).
- **이 모양으로 시작**: seed 를 편집기로. 예시 그림은 그대로 보이고 사진 칸에 「예시 그림이에요 · 내 그림으로 바꾸면 게시할 수 있어요」 + [AI로 내 그림 만들기](같은 템플릿 · 예시 글에서 브랜드 라벨을 회사 이름(`authStore` `user.company.name`)으로 바꾼 글 · 혜택 자리는 자리표 → 채우기 전에는 생성이 막힌다 §3-8). 쿠폰 코드 = 자리표.
- **seed 의 채울 자리**: 혜택이 있어야 말이 되는 예시(쿠폰 띠 · 남은 시간)는 seed 글의 부제 = `[혜택 안내: 직접 작성해주세요]` · 쿠폰 코드 = `[쿠폰 코드: 직접 입력해주세요]` · DM 연결 버튼 주소 = `[DM 참여 페이지: 직접 입력해주세요]`(주소 정규화가 대괄호 값을 그대로 두고 `inapp-message.ts:376` · SDK 는 대괄호 주소로 이동하지 않는다 `inapp.ts:297` · 게시 판정 `findAiFillPlaceholder` 가 막는다 `inapp-message.ts:603-608`). 그대로 게시 · 생성하면 막힌다.
- **예시 그림 게시 차단**: `inAppPublishDefect` 한 곳 · 메시지 그림과 모든 장 그림에서 `/api/cdp/inapp/example-image/` 를 찾으면 「N번째 장은 예시 그림이에요. 내 그림으로 바꿔 주세요」(`field: 'slide_image'` · 장 번호).
- **1차 예시 12 · 그림 19장**:

| # | 업종 · 가상 업체 | 판 · 틀 · 띠 | 장 |
|---|---|---|---|
| 1 | 뷰티 · 결온 | 통짜 · 바닥 시트 | 1 |
| 2 | 뷰티 · 결온 | 통짜 · 떠 있는 카드 · 쿠폰 띠 | 1 |
| 3 | 뷰티 · 결온 | 글 얹기 · 바닥 시트 | 3 |
| 4 | 의류 · 소요웨어 | 통짜 · 떠 있는 카드 | 2 |
| 5 | 의류 · 소요웨어 | 통짜 · 바닥 시트 · 남은 시간 띠 | 1 |
| 6 | 의류 · 소요웨어 | 이벤트 카드(지금 모양) | 2 |
| 7 | 커머스 · 미결 §10 | 통짜 · 바닥 시트 | 3 |
| 8 | 커머스 · 미결 §10 | 통짜 · 떠 있는 카드 · DM 투표 연결 버튼 | 1 |
| 9 | 커머스 · 미결 §10 | 글 얹기 · 떠 있는 카드 · 쿠폰 띠 | 1 |
| 10 | 카페 · 오후담 | 통짜 · 떠 있는 카드 | 1 |
| 11 | 카페 · 오후담 | 통짜 · 바닥 시트 · 남은 시간 띠 | 1 |
| 12 | 카페 · 오후담 | 글 얹기 · 바닥 시트 | 2 |

생성 단가(엔진 원가) = 미검증 · 생성 전에 Harold 확인(§10).

### 3-10 편집 화면 UX

- **입구**(`InAppEntryGallery.tsx`): ① 예시로 보고 시작(새) ② 용도로 바로 시작(배너 시트 시작본 `inappStarters.ts:49-60` → 통짜 바닥 시트 시작본: 장 글 채워짐 · 사진 비어 있음 · 사진 칸 첫 버튼 = [이 글로 AI 그림 만들기](2크레딧 표기 · 혜택 자리표가 남았으면 생성 막힘)) ③ 크게 보여 주기 = 통짜 · 바닥 시트 / 통짜 · 떠 있는 카드 / 사진 위 글 / 사진 위 글 · 떠 있는 카드 / 이벤트 카드(배너 시트 뺌) ④ 기본 알림 ⑤ 작게 알리기. 크게 보여 주기 썸네일 = 실제 부품 + 예시 그림(준비 전 = 지금 SVG 표본).
- **모양 키**: `LayoutKey` 에 `baked_sheet` · `baked_card` · `live_card` 를 더한다. 키 ↔ design 은 한 함수 `designForKey(key, design)`(`poster_layout` · `poster_text` · `poster_frame` 을 함께 쓰고 지움 · `messagePatchFromSlides` `inappSlides.ts:124-150` 가 부름) · 반대 = `layoutKeyOf`(`:208`)가 세 키를 함께 읽는다. `isPosterLayout`(`:214`) · `LAYOUT_INFO`(`:189`) · `layoutsFor`(`:201`)에 새 키를 더한다(목록 카드 모양 이름 = 「통짜 포스터 · 바닥 시트」 · 「통짜 포스터 · 떠 있는 카드」 · 「사진 위 글 · 떠 있는 카드」). 띠는 모양이 아니라 오른쪽 칸 선택(쿠폰 · 남은 시간 · 없음).
- **죽은 칸 0**: 정규화가 버리는 조합(이벤트 카드 · 배너 시트 + 틀 · 띠)은 오른쪽 칸에 그 선택을 그리지 않는다(LESSONS_FRONTEND 83).
- **오른쪽 칸**: 통짜 장 = 「그림 속 글」(읽기 전용 표시 + [그림 다시 그리기]) · 제목 칸(목록 이름 · 대체 글) · 버튼 · 링크(+ DM 연결) · 띠 · 띠 색(`accent_color`).
- **구버전 앱 모습 버튼**: 통짜 · 띠 메시지(앱 채널)는 흉내 화면 대신 「옛 앱에는 이 메시지가 보이지 않아요(앱 새 판에서 보여요)」 · 떠 있는 카드만 = 바닥 시트 모습.
- **서버 결함 데려가기**(`InAppMessagesPage.tsx:2289-2291`): 새 `field` = `strip` → 띠 칸 · `end_at` → 타겟 · 시점 칸 · `link` → 그 장 버튼 칸 · `slide_image`(예시 그림 포함) → 그 장 사진 칸. 새 판정은 서버에만 둔다(화면 사본 `publishDefectOf` 에 더하지 않는다 · 두 벌을 늘리지 않음). 기존 사본의 어긋남(BUGS 245)은 범위 밖 기록.
- **앱 표시**: §3-2 `APP_CONFIRMED_CAPS`.
- **모양 바꾸기**: 포스터 갈래 안에서는 장 · 글 · 그림 · 띠를 그대로 둔다(이벤트 카드로 가면 색만 그 모양 기본). 지금 「되돌리기」 그대로.

### 3-11 앱(팝폰) — 계약 v4 · OTA

- **선행**: 팝폰 인앱 폴더의 미커밋 5파일(0929 렌더러 포함)을 Harold 가 커밋(앱 작업 전 · §1).
- **계약서 v4**(`AppIntegrationContract.tsx`): `caps` 요청 · 통짜(글 칸 빈 값 · `alt` · contain) · 떠 있는 카드 · 띠 2종(복사 = 클립보드 · 기록 `copy_code` · 남은 시간 = `serverNow` 기준) · `POSTER_FRAME_RULES` 값 표.
- **팝폰 코드**: `inapp-client.ts` 요청에 `caps` · `types.ts` 새 키 · `inapp-core.ts` 판정(통짜 · 틀 · 띠) · `InAppPosterFrame.tsx`(새 · RN 기본 + expo-image + expo-clipboard = OTA 가능) · `InAppHost.tsx` 분기.
- **해제 순서**: OTA(Harold) → 실기기(안드로이드 · iOS)에서 통짜 · 떠 있는 카드 · 쿠폰 복사 · 남은 시간 확인 → `APP_CONFIRMED_CAPS` 에 낱말을 넣는 프론트 배포. OTA 전까지 앱은 `caps` 를 안 보내므로 서빙 관문이 막는다(잘린 화면 0).

### 3-13 판정 행 = 저장 결과 행 (다섯 판정 자리 한 규칙)

게시 판정(`inAppPublishDefect`) · DM 연결 판정(`inAppDmLinkPolicyDefect`) · 변형 판정(`inAppVariantDefect`)은 **쓰기 뒤 `RETURNING *` 결과 행을 같은 트랜잭션 안에서** 판정하고, 미달이면 `ROLLBACK` 후 그 결함을 던진다(지금 update `inapp-message.ts:1042` 의 방식을 다섯 자리 전부로).

| 자리 | 지금 | 바뀜 |
|---|---|---|
| create `createInAppMessage` | INSERT 전 인라인 행(`:775-778` · `image_link_url` · `action_url` · `end_at` · `design` 없음)으로 판정 | 트랜잭션 · INSERT … RETURNING * → 결과 행 판정 → 미달 ROLLBACK(행 0 · 지금과 같은 결과) |
| update | 결과 행 판정(그대로) | 같은 트랜잭션에 DM 판정 · 변형 판정(전파) 추가 |
| createVariant | 잠금 없이 부모를 읽고(`inapp-variant-optimizer.ts:128-138`) INSERT 전 인라인 행(`:164-170`)으로 판정 | 트랜잭션 · **부모 `FOR UPDATE` 먼저** → 잠근 부모 행으로 입력 검사 · 상속 · 통짜 규칙 → INSERT … RETURNING * → 결과 행 판정(+ `inAppVariantDefect`) → 미달 ROLLBACK(부모를 읽은 뒤 다른 요청이 통짜 전환 · 문구 변형 멈춤을 끝내 옛 모양 변형이 켜진 채 들어오는 틈을 닫는다) |
| 켜기 `activateInAppMessage` | 잠근 옛 행으로 판정한 뒤 기간 window 를 쓴다(`:1148` → `:1153-1158`) | 잠금 → UPDATE(상태 + window) RETURNING * → 결과 행 판정(+ 변형이면 `inAppVariantDefect`) → 미달 ROLLBACK · 반환 꼴(`ok:false · reason:'defect'`) 그대로. **잠금 순서 = 부모 → 변형**: 변형 켜기는 부모 행을 먼저 `FOR UPDATE` 하고 변형 행을 잠근다(전파 = 부모 UPDATE → 변형 `FOR UPDATE` `:1069-1074` 와 같은 순서 · 거꾸로면 [반영]과 변형 켜기가 서로 기다린다) |
| 전파 | 변형 결과 행 판정(`:1112` 그대로) | 같은 자리에서 DM 판정 · 변형 판정 |

판정 함수는 행 모양(snake_case DB 행) 하나만 받는다(인라인으로 칸을 골라 만든 행 0 · 계약 시험 CT-IA9 = 다섯 자리 소스에 인라인 판정 행 0 · 최상위 링크만 쓴 생성 · 변형 우회 표본).

**잠금 한 규칙**: 변형을 쓰는 모든 자리(createVariant · 변형 켜기 · 전파)는 같은 트랜잭션에서 **부모 행을 먼저 `FOR UPDATE`** 하고 그 잠근 부모로 판정한 뒤 변형 행을 쓴다(순서 = 부모 → 변형 · 전파는 부모 UPDATE 가 그 잠금이다). 판정에 필요한 읽기(DM 판정 포함)는 그 트랜잭션 연결로만 한다(R41 · 위 §3-6).

### 3-12 배너 시트

- 입구 카드 · 용도 카드에서 내린다. 저장된 배너 시트 메시지는 그대로 그린다(화이트리스트 · 렌더러 · 앱 유지). 모양 바꾸기 메뉴엔 이미 배너 시트인 메시지에만 보인다.
- 렌더 코드 삭제 = 운영 사용 0 확인 뒤 별건(Harold SQL §10-1).

---

## §4 영향표 (바뀌는 파일 · 소비처)

| 파일 | 바뀜 | 소비처 · 확인 |
|---|---|---|
| `backend/src/utils/inapp-message.ts` | 새 키 정규화 · `isPosterFamily` · `inAppRequiredCaps` · `toServedMessage` · `INAPP_CLIENT_CAPS` · 관문 · 게시 판정(예시 그림 · 띠 · 끝 시각 · 변수) · 판정 행에 `end_at` · `design` · 전파 통짜 분기 · 변형 끝 시각 채우기 | 라우트 `/inapp` POST · PUT · `/inapp/active` · 변형 · 켜기 · 시험 |
| `backend/src/routes/cdp.ts` | `/inapp/active` `caps` 파싱 · `serverNow` · 변형 필수 칸(통짜) · 예시 두 주소 · 링크 정책 판정 호출 | SDK · 팝폰 · 편집기 |
| `backend/src/utils/inapp-variant-optimizer.ts` | createVariant 통짜 규칙 · 판정 행 design · end_at | 라우트 · 빠른 작업 |
| `backend/src/utils/inapp-quick-action.ts` | 통짜 부모 거절(AI 전) | 라우트 |
| `backend/src/utils/inapp-personalization.ts` | `textHasPersonalizationVar` 꺼냄(같은 정규식 · `:122` 가 부름) | 게시 판정 · 서빙 |
| (새) `backend/src/utils/inapp-dm-link-policy.ts` | DM 연결 판정 CT(트랜잭션 연결 `run` 로만 읽음) | 게시 다섯 자리 |
| `backend/src/utils/dm/dm-builder.ts` `getDmByCode`(`:678`) · `dm/dm-recipient-token.ts` `lookupDmShortLink`(`:139`) · `dm/dm-custom-short-link.ts` `lookupCustomShortLink`(`:112`) | 선택 인자 `run`(없으면 지금처럼 풀) | 지금 호출처(짧은 주소 리다이렉트 `routes/dm.ts:202` · `:208` · DM 뷰어 `:231` · 참여 제출 `dm-interaction.ts:68` · grep 1105) = 인자 없이 부름 = 영향 0 · 새 호출처 = DM 판정 CT |
| (새) `backend/src/utils/inapp-examples.ts` · `backend/scripts/inapp-examples.ts` · `backend/assets/inapp-examples/` | 예시 표 · 생성 · 누끼 | 예시 주소 · 갤러리 |
| `backend/src/routes/image-studio.ts` | 바꿈 0(자리표 판정 이미 있음 `:165-168`) | 스튜디오 · StudioInsertModal |
| `sdk-js/src/inapp.ts` | `caps` 요청 · 캐시 키 · 새 틀 렌더 분기 · 스크림 부품 호출 · 복사 · 시계 · `serverNow` | 몰 화면 |
| (새) `sdk-js/src/poster-frame.ts` | 그리는 부품 · 규칙 상수 | SDK · 프론트 복사본 |
| `frontend/src/components/inapp/*` | 미리보기(부품 · shadow root) · 모양 키 · 입구 · 예시 갤러리 · 상세 창 · 틀 고르기 판 · 앱 표시 상수 · 계약서 v4 | 편집기 |
| `frontend/src/pages/InAppMessagesPage.tsx` | 스튜디오 받기 · 서버 결함 데려가기 · 오른쪽 칸 | 편집기 |
| `frontend/src/pages/ImageStudioPage.tsx` · `components/studio/StudioMake.tsx` · `lib/studio-draft.ts` · `components/dm/build/StudioInsertModal.tsx` | 넘김 글 · `onInserted(url, texts)` · `textless` · `initialTemplateId` | 스튜디오 · DM(새 인자 안 씀 · 둘째 인자 안 씀 = 영향 0) |
| `backend/src/utils/__tests__/inapp-poster-redesign-1105.test.ts`(새 · R60 · R11 확대 = CT-IA10) | R11 모델명 낱말 · 범위 확대 · R60 계약 | 시험 |
| 팝폰 `src/lib/hanjul/*` | §3-11 | 앱 |

DB = 0(새 칸 · 새 표 0 · design jsonb 안). SCHEMA.md 갱신 = cdp_inapp_messages.design 키 표에 세 키(문서만).

---

## §5 뿌리 (docs/ROOT-LEDGER.md)

| 뿌리 | 이 설계에서 |
|---|---|
| R1 같은 판정 두 벌 | 새 게시 판정은 서버 한 곳 · 렌더 규격은 부품 한 곳(SDK) + 복사본 글자 같음 시험 · 필요 판 = `inAppRequiredCaps` 한 곳 |
| R11 화면 하한 | 모델명 낱말에 Gemini · GPT · OpenAI · 제미나이 · 범위 = 프론트 `.ts` · `.tsx` + 예시 표 · native dialog 0 |
| R15 죽은 주소 | 새 주소 둘 = 갤러리가 부른다(계약 시험) |
| R47 판정이 효과 자리 | 서빙 관문 = 내보내는 자리 · 자리표 = 생성(돈 · 굽기) 자리 · 예시 그림 = 게시 자리 |
| **R60(새 · 설계 때 R57 로 적었으나 C103 · C104 · C105 가 R57 ~ R59 를 먼저 씀)** 클라이언트가 그릴 수 없는 메시지를 준다 | 판정 = `evaluateInAppCandidates` 안 관문 한 곳 · 필요 판 = 메시지 design 에서 기계로 뽑음 · 시험 = CT-IA4 |

점검표(기계로 못 잡는 것): R1(화면 사본 publishDefectOf 에 새 판정이 들어가지 않았나) · R6(새 상태 0 · 전파가 멈춘 문구 변형은 기존 상태 paused) · R8(예시 스크립트 = 실패 3번 멈춤) · R12(변형을 쓰는 모든 자리 = 부모 먼저 FOR UPDATE · 판정과 쓰기 = 같은 트랜잭션) · R18(남은 시간 = 서버 시각 · 끝 시각 = 사건 시각) · R41(트랜잭션 안 읽기 = 그 연결).

---

## §6 계약 시험 (기계 추출 · 변이로 빨간불 확인)

| 이름 | 지키는 것 | 대상 뽑기 |
|---|---|---|
| CT-IA1 | design 새 키가 서버 화이트리스트 · SDK 판정 · 프론트 모양 키 · 계약서에 같은 값 | 소스에서 상수 읽기(`INAPP_*` · `POSTER_*`) |
| CT-IA2 | 통짜 서빙 = 글 칸 0 · `alt` 있음 · 라우트 개인화 뒤에도 0 · 장 없는 통짜(flat 만) = 첫 장을 만들어 `alt` 보존 | `/inapp/active` 라우트 함수 + 표본 행 |
| CT-IA3 | 예시 표: 모든 seed 가 정규화 왕복 같음 · 게시 판정 = 예시 그림 결함만 · 그림 바꾸면 통과 · 글에 혜택 숫자 · 낱말 · 줄표 · 가운뎃점 · 모델명 0 | `INAPP_EXAMPLES` 전부 |
| CT-IA4 | 필요 판 hard 가 빠진 클라이언트 = 0건 · soft 만 빠짐 = 틀 지움 · 여러 장 카드 = hard(옛 캐러셀 표본에서 잘림 없음을 보장) · 판 목록 = 서버 상수 = SDK 상수 = 계약서 | `INAPP_CLIENT_CAPS` · `inAppRequiredCaps` 소스 |
| CT-IA5 | 프론트 복사본 = SDK 부품 글자 같음 | 두 파일 |
| CT-IA6 | 부품에 기록 · fetch · 저장소 · 이동 · 타이머 0 · 규칙 상수 값(44 · 72vh · 강조색 하나 · 그림 위 HTML = 쪽 번호만) | 부품 소스 · 정적 렌더 결과 |
| CT-IA7 | 지금 3모양 DOM 이 바뀌기 전후 같음 | 표본 메시지 3모양 × 장 1 · 3 |
| CT-IA8 | 생산자(AI 생성 · 빠른 작업 · 한 줄)가 새 키를 만들지 않음 · 통짜 부모 변형 규칙이 createVariant 한 곳(부르는 곳 전부) | `createVariant(` 호출 grep · 생성기 출력 |
| CT-IA9 | 판정 다섯 자리가 모두 쓰기 뒤 결과 행으로 같은 판정(`inAppPublishDefect` · `inAppDmLinkPolicyDefect` · 변형이면 `inAppVariantDefect`)을 부름 · 인라인 판정 행 0 · 최상위 `action_url` · `image_link_url` 만 쓴 경품 DM 생성 · 변형 우회 표본이 막힘 · 켜기 window 두 표본(옛 끝 시각 없음 + 새 기간 유효 = 통과 / 옛 미래 + 새 기간 지남 = 거절) | 켜기 길목 grep · 표본 행 |
| CT-IA11 | 글 얹기 → 통짜 [반영] = 문구 변형 멈춤 · 통짜 변형 그림 유지 · 멈춘 문구 변형 다시 켜기 거절 · 원본을 글 얹기로 되돌리면 켜기 통과 · 변형 생성과 통짜 전환이 겹쳐도 옛 모양 변형이 켜진 채 남지 않음(부모 선잠금) | 실 PG |
| CT-IA12 | 트랜잭션 안에서 부르는 판정 읽기(DM 판정 CT · 재사용 세 함수의 `run` 경로)가 풀 `query` 를 직접 부르지 않음 | 소스 |
| CT-IA10 | R11 모델명 확대 | 프론트 `.ts` · `.tsx` · 예시 표 |
| 실 PG | 관문 쪽 반복(20개 채우기) · 전파 통짜 분기 FOR UPDATE · DM 링크 판정 SQL · 변형 끝 시각 채우기 | 시험 DB |

---

## §7 직원 시트 S1 (구현 전 기대 결과 · 테스트계정 · 직원 본인 휴대폰)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정으로 로그인 → 왼쪽 메뉴 「인앱 메시지」 → [새 인앱 메시지] | 맨 위에 「예시로 보고 시작」 카드들이 휴대폰 모양으로 보인다 |
| 2 | 예시 카드 중 「결온」 첫 카드를 누른다 | 큰 창에 포스터 그림이 화면 아래에 붙어 보이고 그림 위에 글자 칸이 따로 없다 |
| 3 | 창에서 [이 모양으로 시작] | 편집 화면이 열리고 사진 칸에 「예시 그림이에요」가 보인다 |
| 4 | 오른쪽 위 [발행] | 「1번째 장은 예시 그림이에요. 내 그림으로 바꿔 주세요」가 보이고 발행되지 않는다 |
| 5 | 사진 칸 [AI로 내 그림 만들기] → 글을 그대로 두고 [만들기] | 「문구 칸에 예시 문구가 그대로 있습니다. 실제 문구로 바꾼 뒤 만들어 주세요.」가 보이고 크레딧이 줄지 않는다 |
| 6 | 혜택 칸에 「신규 고객 감사」를 넣고 [만들기] | 1분 안에 새 그림이 들어오고 크레딧이 2 줄어든다 |
| 7 | 모양 「떠 있는 카드」를 누른다 | 그림이 화면 가운데 카드로 바뀌고 카드 위에 「오늘 하루 보지 않기」와 X 가 보인다 |
| 8 | 오른쪽 칸 「기능 띠」에서 「쿠폰 코드」 → 코드 칸에 `HANJUL1105` | 그림 아래 한 줄에 쿠폰 코드와 [복사]가 보인다 |
| 9 | 채널 「웹」 · 게시 → 테스트 몰(○○)을 휴대폰으로 연다 | 카드가 뜨고 [복사]를 누르면 「복사했어요」가 보인다 · 메모장에 붙이면 `HANJUL1105` |
| 10 | 같은 몰을 PC 로 연다 | 카드가 화면 가운데 400px 안팎 크기로 뜬다 |
| 11 | 「오늘 하루 보지 않기」 → 새로 고침 | 다시 뜨지 않는다 |
| 12 | 새 메시지 · 「통짜 · 바닥 시트」 · 기능 띠 「남은 시간」 · 게시 끝 시각을 지금부터 10분 뒤로 · 게시 | 몰에서 「마감까지 00:09:5x」가 1초마다 줄어든다 |
| 13 | 이미지 스튜디오 → 포스터 하나 만들기 → 결과 카드 [인앱메시지 만들기] | 「틀 고르기」 판에 내 그림이 두 모양으로 보이고 채널을 고를 수 있다 |
| 14 | 「앱」 채널 · 「떠 있는 카드」 고르기 | 「앱 새 판이 깔린 뒤 보여요」 표시가 보인다(OTA 전) |
| 15 | 인앱 버튼 링크 칸 [내 DM 참여 페이지 연결] | 투표 DM 은 고를 수 있고 경품 DM 은 흐리게 「경품 · 선착순 DM 은 앱 회원 확인이 붙은 뒤 연결돼요」 |
| 16 | 팝폰 OTA 뒤 앱을 연다(안드로이드 · iOS 각각) | 7 · 8 · 12 와 같은 모양 · 복사 · 남은 시간이 앱에서도 같다 |

---

## §8 단계 · 배포 순서

1. 배포 전(읽기만 · Harold): §10-1 SQL.
2. 한 배포 = 백엔드(관문 · 판정 · 주소) + SDK 빌드(`build:all` · 서빙 폴더 동기화 · 옛 SDK 는 1시간 캐시 동안 `caps` 없음 = 관문이 막음) + 프론트. DDL 0. 순서 = 서버가 먼저 관문을 가진 상태로 SDK 가 나간다(같은 배포라 순서 충돌 0).
3. 배포 뒤(Harold · 서버): `ts-node -T scripts/inapp-examples.ts make 19` → `warm` → 갤러리 확인.
4. 팝폰: 미커밋 5파일 커밋 → 앱 코드 → OTA → 실기기 확인 → `APP_CONFIRMED_CAPS` 프론트 배포.
5. 직원 시트 S1.

---

## §9 2차 목록 (창의 확장 · 1차가 닫힌 뒤)

틀 = 들뜬 시트(참고 3 · 좌우 16 · 닫기 어둠 위) · 전체 화면 스토리(진행 막대 · 탭으로 넘김) · 엿보기 캐러셀(옆 장 9%) · 웹 나란히(포스터 360 + 기능 320 · 480 미만 금지) · 띠에서 펼침 · 구석 미니 카드(웹).
판 = 긴 포스터(상세 페이지형 스크롤) · 숫자 히어로(누끼 + 사람이 친 숫자) · 상품 그리드(몰 상품 · 가격 신선도 설계 뒤) · 상품 핫스팟.
기능 = 통짜 그림 A/B(그림을 바꾼 변형 만들기 화면) · 경품 · 선착순 DM 연결(§3-6 조건) · 한 문항 질문(답 → 고객 속성 → 타겟 · 여정 조건) · 별점 · 출석 도장 · 재입고 알림(수신 동의 원장 설계 뒤) · 수신동의 받기(같음).
구조 = 지금 3모양을 부품으로 옮기기(미리보기 손 미러 제거).

---

## §10 미결 · Harold 확인

| # | 항목 | 형태 |
|---|---|---|
| 10-1 | **닫힘(1105 Harold 실행 = 0 rows)** 배너 시트 운영 사용 건수(읽기만 · 서버 운영 PostgreSQL psql) · 렌더 코드 삭제는 별건(§3-12) | `SELECT status, channel, COUNT(*) FROM cdp_inapp_messages WHERE template = 'full_image' AND design->>'poster_layout' = 'banner_sheet' GROUP BY status, channel;` (칸 = template · design · status · channel · `inapp-message.ts:1452-1458` 서빙 칸 목록과 INSERT 에 있음) |
| 10-2 | 커머스 가상 업체 이름 · 누끼 상품 1 | 이름 후보는 상표 검색 뒤(미검증) |
| 10-3 | 예시 그림 19장 엔진 원가 | 미검증 · 생성 전 확인 |
| 10-4 | 인앱 게시 100 + 참여 DM 발행 100 이 겹친다 | 그대로 둘지 |
| 10-5 | 팝폰 미커밋 5파일 커밋 | Harold |
| 10-6 | 직원 시트 S1 의 테스트 몰 주소 · 테스트계정 아이디 | 시트를 엑셀로 낼 때 Harold 지정 |

---

## §11 설계 구조체크 기록

방법 = §2 흐름 표 T1 ~ T18 이음매마다 (가) 값 범위 (나) 그리는 화면 두 축으로 설계 문장을 코드에 대어 본다. 설계가 기대는 함수 · 줄은 그 자리를 열어 확인했다(주재자 직접 · 에이전트 0).

### 1회차 (1105 · 결함 14 → 설계 정정)

| # | T | 축 | 결함(설계 문장이 코드와 부딪힌 자리) | 정정 |
|---|---|---|---|---|
| S1 | T4 · T6 | 값 범위(변형 행 = 끝 시각 없음 · `inapp-variant-optimizer.ts:174-195`) | 남은 시간 띠의 끝 시각 판정을 다섯 자리 모두에 걸면 띠 달린 메시지의 변형 생성 · 켜기 · 전파가 전부 거절된다 | 끝 시각 판정 = 부모 행만(§3-5) · 변형은 부모 기간으로만 서빙(`:1526`) |
| S2 | T4 | 값 범위(「30%할인」) | 변수 판정을 `inapp-personalization.ts:122` 정규식(`%[가-힣A-Za-z]`)으로 하면 혜택 글을 변수로 잡는다 | 판정 = `detectLiquidSyntax` 또는 `LEGACY_VARIABLE_MAP` 키(치환 함수와 같은 근거 · §3-3) |
| S3 | T15 | 판정 자리 | 생성 전 자리표 판정을 새로 만들려 했으나 이미 있다(`routes/image-studio.ts:165-168` · `image-studio-templates.ts:5835`) → 새로 만들면 판정 두 벌(R1) | 새 판정 0 · 예시 seed 혜택 자리 꼴을 그 판정에 맞춘다(§3-8) |
| S4 | T16 | 인증 순서(`routes/cdp.ts:877` `router.use(authenticate)`) | 공개 그림 주소를 관리자 주소들과 같이 두면 인증에 막혀 `<img>` 가 못 연다 | 공개 주소 = `/inapp/image` 옆(인증 앞) · 목록 = 인증 뒤(§3-9) |
| S5 | T6 | 판정 자리 | 라우트(`:1873`)는 부모 design 을 모르는데 통짜 부모 필수 칸을 라우트에 두려 했다 | 본문 · 그림 필수 = createVariant 한 곳 · 라우트 = 원본 · 제목만(§3-3) |
| S6 | T6 | 값 범위(변형 그림 출처) | 전파 때 변형 그림을 어디서 읽는지 빠짐 | 변형 첫 장 그림 → 없으면 변형 `image_url`(§3-3) |
| S7 | T1 · T2 | 그리는 화면(용도 시작본) | 통짜 시작본은 그림이 없는데 「그림 속 글」만 있는 상태가 된다 | 사진 칸 첫 버튼 = [이 글로 AI 그림 만들기](§3-10) |
| S8 | T11 | 그리는 화면(구버전 앱 모습) | 옛 앱은 통짜 · 띠 메시지를 받지 않는데 흉내 화면을 그리면 거짓 표시 | 「옛 앱에는 이 메시지가 보이지 않아요」(§3-10) |
| S9 | T14 · T1 | 그리는 화면(목록 카드 모양 이름) | 새 모양 키 이름 · 포스터 갈래 판정 함수가 빠짐 | `LAYOUT_INFO` · `isPosterLayout` · `layoutsFor` · `designForKey`(§3-10) |
| S10 | T10 | 값 범위(5분 캐시) | `serverNow` 차이를 캐시 경로가 모른다 | 차이를 캐시 항목에 함께 저장(§3-5) |
| S11 | T16 | 값 범위(준비 0) | 그림 생성 전 갤러리가 빈 섹션을 그린다 | 준비 0 = 섹션 없음(§3-9) |
| S12 | T16 | 값 범위(업종 4 밖) | 회사 업종 → 예시 업종 대응표가 빠짐 | `inAppExampleIndustry`(§3-9) |
| S13 | T18 | 값 범위(고객사 자체 짧은 주소) | `dm_custom_short_links` 가 DM 주소를 가리킬 수 있다 · 짧은 주소 바탕 값 출처 미정 | 한 번 더 풀기 · 바탕 = `DM_SHORT_LINK_BASE`(§3-6) |
| S14 | T2 | 그리는 화면(죽은 칸) | 정규화가 버리는 조합(이벤트 카드 + 띠)을 오른쪽 칸이 고르게 두면 「눌러도 안 변함」 | 그 조합에선 칸을 그리지 않는다(§3-10) |

### 2회차 (1회차 정정 뒤 · 바뀐 이음매 다시)

| # | T | 결함 | 정정 |
|---|---|---|---|
| S15 | T3 | 쿠폰 코드 글자 검사를 저장 정규화에 두면 예시 seed 의 자리표 코드(`[쿠폰 코드: 직접 작성해주세요]`)가 초안 저장 때 띠째 버려진다 | 저장 = 자르기만 · 글자 판정 = 게시(§3-1 · §3-5) |
| S16 | T6 · 그리는 화면 | 통짜에 [문구 다듬기(A/B 3안)] 단추가 남으면 누를 때마다 400 · 화면에 변형 만들기 입구가 AI 다듬기뿐이라 통짜 A/B 입구가 없다(`InAppMessagesPage.tsx:3831-3853` = list · set_status 만) | 통짜에서 단추를 그리지 않고 이유 한 줄 · 그림 A/B = 2차(§3-3 · §9) |
| S17 | T16 | 남은 시간 예시의 마감을 고정 값으로 그리면 거짓 표시(LESSONS_FRONTEND 170) | 연 시각 + 2일 · seed 끝 시각 = 비움(§3-9) |

### 3회차 (2회차 정정 뒤)

| # | T | 결함 | 정정 |
|---|---|---|---|
| S18 | T1 · T2 그리는 화면 | 그리는 부품의 배경이 `position: fixed` 라 편집기 · 갤러리의 휴대폰 틀 안에서 관리자 화면 전체를 덮는다 | `mount: 'page' | 'frame'` · frame = absolute · 틀 높이 기준(§3-7) · 시험 CT-IA6 |

### 4회차 (3회차 정정 뒤 · 남은 이음매 T5 · T9 · T12 · T13 · T17 · 1클릭 규칙)

| # | T | 결함 | 정정 |
|---|---|---|---|
| S19 | T15 · 1클릭 | 시작본 · 예시의 [AI로 그리기]가 템플릿 고르기 단계부터 열려 「누름 한 번」이 아니다(`StudioInsertModal` 인자 = open · onClose · onInserted · defaultTitle · defaultSubtitle 뿐 · `dm/build/StudioInsertModal.tsx:27-34`) | `initialTemplateId` 선택 인자(§3-8) |

T5(게시비 · 예시 그림 거절은 INSERT · 정산 전) · T9(비운 글 = 개인화 변수 0) · T12(`copy_code` 50자 안 · 라우트 `:790`) · T13(카드 틀도 같은 하루 보지 않기 · 부모 축) · T17(변화 없음) = 결함 0.

### 5회차 (4회차 정정 뒤 · 설계서 전체를 처음부터 다시 읽음 · T1 ~ T18 · 두 축)

| # | T | 결함 | 정정 |
|---|---|---|---|
| S20 | T4 · T6 | createVariant 판정 행(`inapp-variant-optimizer.ts:164-170`)에 `parent_message_id` · `design` 이 없어, 「끝 시각 판정 = 부모 행만」을 넣으면 변형이 부모로 판정돼 남은 시간 띠 변형 생성이 끝 시각 없음으로 거절된다 | 판정 행에 원본 id · 부모 design 을 넣는다(§3-5) |
| S21 | T15 | 흐름 표 T15 줄이 1회차 S3 전 문장(「새 자리표 판정」)으로 남아 설계 안에서 두 말 | 「기존 · 새 판정 0」 |
| S22 | T16 · T18 | 예시 #8 의 DM 연결 버튼 주소를 비우면 고객이 눌러도 아무 데도 안 가는 버튼이 게시된다(빈 주소는 지금 게시 판정에 안 걸림) | seed 주소 = 대괄호 채울 자리 → 기존 게시 판정이 막는다(§3-9) · 직원 시트 5 를 서버 문구로 고침 |

### 6회차 (5회차 정정 뒤 · 바뀐 줄 + 직접 영향 · 판정 행 다섯 자리를 하나씩)

판정 행 다섯 자리 = create(인라인 행 · `parent_message_id` 없음 = 부모 · `end_at` · `design` 넣음) · update(결과 행 `RETURNING *`) · createVariant(인라인 행 · 원본 id · 부모 design 넣음) · 켜기(`SELECT *`) · 전파(`RETURNING *`). 다섯 모두 `parent_message_id` · `design` · `end_at` 을 가진 행으로 판정한다. 예시 seed 채울 자리 세 꼴 = 정규화가 버리지 않음(코드 = 자르기만 · 주소 = 대괄호 보존) · 게시 판정이 막음 · 새 메시지 POST 의 링크 오타 검사(`routes/cdp.ts:1308` `findLinkDefectDeep` · `normalize.ts:830-834`)는 `http(s)://` 로 시작하는 값만 보므로 대괄호 자리표 · 상대 경로 예시 그림 주소로 초안 저장이 막히지 않음. 결함 0.

### 7회차 (Codex 1라운드 처방 뒤 · 바뀐 이음매 §3-2 · §3-3 · §3-6 · §3-13)

| # | T | 결함 | 정정 |
|---|---|---|---|
| S23 | T6 · R12 | 변형 켜기에 부모 행 잠금을 더하면서 「변형 → 부모」 순으로 잡으면 [반영](부모 UPDATE → 변형 FOR UPDATE)과 잠금 순서가 반대가 되어 서로 기다린다 | 잠금 순서 = 부모 → 변형 한 규칙(§3-13) |

게시비 정산 = 생성 뒤 라우트(`routes/cdp.ts:1326`) 그대로. 8회차(S23 뒤) = 결함 0 으로 적었으나 **틀렸다**: 7회차에 「트랜잭션 안 DM 판정 = 풀 연결 읽기 · 잠금 0 이라 괜찮다」고 판정했는데, 연결을 쥔 채 풀을 다시 기다리는 것 자체가 결함이다(Codex 2라운드 C6 · 뿌리 R41). 행 잠금만 보고 연결 점유를 보지 않았다.

### 9회차 (Codex 2라운드 처방 뒤)

| # | T | 결함 | 정정 |
|---|---|---|---|
| S24 | T18 · R41 | (C6 를 구조체크가 놓친 자리) DM 판정 읽기 연결 | 트랜잭션 연결 `run` 로만(§3-6) |
| S25 | T6 · R12 | (C7) createVariant 부모 읽기 잠금 없음 | 변형을 쓰는 모든 자리 = 부모 먼저 FOR UPDATE 한 규칙(§3-13) |

점검표에 R41 을 더한다(트랜잭션 안에서 부르는 모든 읽기 함수가 그 연결을 받는가). 결함 0.

## §12 Codex 설계 리뷰 기록

방법 = `status/CODEX-RUNBOOK.md` · adversarial-review · `--model gpt-6-astra` · 1라운드 = 설계서 전체 · 2라운드부터 = 고친 줄 + 직접 영향만.

### 1라운드 (1105 · needs-attention · high 2 · medium 3 · 전부 수용)

| # | 등급 | 지적 | 판정 | 처방 |
|---|---|---|---|---|
| C1 | high | DM 정책 판정 행에 실제 저장 · 서빙되는 링크(`image_link_url` · 최상위 `action_url`)가 빠진다(create · createVariant 인라인 행) | 수용 · **구조체크 S20 과 같은 뿌리**(인라인으로 칸을 골라 만든 판정 행) → 같은 부류 두 번 = 개별 땜질 금지 | 판정 행 = 저장 결과 행 한 규칙(§3-13) · 최상위 `action_url` 도 DM 판정 대상(§3-6) |
| C2 | high | 글 얹기 문구 변형이 있는 원본을 통짜로 바꾸면 변형은 옛 배경 그림 + 부모 baked design 이 되어 서빙 때 문구가 지워지고 배경만 나간다 | 수용 | 전파 = 통짜 변형만 그림 유지 · 문구 변형 = 멈춤 · 다시 켜기 = `inAppVariantDefect` 가 막음(§3-3) |
| C3 | medium | 여러 장 카드를 soft 로 강등하면 옛 SDK · 옛 앱이 4:5 cover 캐러셀로 그려 잘린다 | 수용 | 여러 장 카드 = hard · soft = 한 장만(§3-2) |
| C4 | medium | 켜기가 window 적용 전 옛 행으로 판정한다(옛 끝 시각 · 새 끝 시각이 반대면 거꾸로 판정) | 수용 · C1 과 같은 뿌리(판정 행 ≠ 결과 행) | §3-13 켜기 = UPDATE RETURNING 결과 행 판정 |
| C5 | medium | 장 없는 통짜(flat 만)는 비울 때 대체 글이 사라진다 | 수용 | 서빙 = flat 에서 첫 장을 먼저 만든 뒤 비움(§3-3) |

같은 뿌리 판정: C1 · C4 · 구조체크 S20 = 「판정 행을 저장 행과 따로 만든다」 한 부류 세 번 → §3-13 으로 구조를 바꿨다(인라인 판정 행 두 곳 · 옛 행 판정 한 곳이 사라짐 = 덧댄 장치 0).

### 2라운드 (1105 · needs-attention · high 1 · medium 1 · 전부 수용)

Codex 확인 = 400 응답 · 게시비 정산 · 켜기 잠금 순서 반례 없음.

| # | 등급 | 지적 | 판정 | 처방 |
|---|---|---|---|---|
| C6 | high | 트랜잭션 안 DM 판정이 풀에서 연결을 더 얻으면 동시 요청이 풀을 채울 때 서로 막힌다 | 수용 · 새 부류 아님 = 뿌리 대장 R41(잠금을 쥔 연결이 같은 풀을 다시 기다린다) | DM 판정 읽기 = 트랜잭션 연결 `run` · 재사용 세 함수에 선택 인자(§3-6) · CT-IA12 |
| C7 | medium | createVariant 가 부모를 잠그지 않고 읽어 통짜 전환과 경합하면 옛 모양 변형이 켜진 채 들어온다 | 수용 · 구조체크 S23(변형 켜기 잠금 순서)과 같은 부류 = 「변형을 쓸 때 부모를 먼저 잠근다」 | 변형을 쓰는 모든 자리 한 규칙(§3-13) |

### 3라운드 (1105 · **approve** · 지적 0)

Codex 확인 = 선택 인자 `run` 기본값 = 지금 풀 `query` → 지금 호출처 호환 · 짧은 주소 폴백 포함 네 조회 모두 `run` 적용 가능 · 세 경로(createVariant · 변형 켜기 · 전파) 잠금 순서 = 부모 → 변형 일치 · AI 다듬기 반복 생성 = 앞 트랜잭션이 끝난 뒤 다음을 시작해 새 교착 0 · 부분 성공은 지금 동작.

## §13 구현 기록 (1105 · 카드 C106)

### 13-1 바뀐 파일

| 층 | 파일 |
|---|---|
| 백엔드 | `utils/inapp-message.ts`(새 키 정규화 · `isPosterFamily` · `isBakedPoster` · `inAppRequiredCaps` · `parseInAppClientCaps` · `gateInAppForClient` · `toServedMessage` · 게시 판정 추가 · `judgeSavedInAppRow` · `inAppVariantDefect` · create 트랜잭션 · 켜기 · 전파 통짜 갈래) · `inapp-variant-optimizer.ts`(createVariant 트랜잭션 · 부모 선잠금 · 통짜 규칙) · `inapp-quick-action.ts`(통짜 거절) · `inapp-personalization.ts`(`textHasPersonalizationVar`) · (새) `inapp-dm-link-policy.ts` · (새) `inapp-examples.ts` · `dm/dm-builder.ts` · `dm/dm-recipient-token.ts` · `dm/dm-custom-short-link.ts`(선택 인자 `run`) · `routes/cdp.ts`(예시 그림 공개 주소 · `caps` · `serverNow` · 예시 목록 · DM 연결 목록 · `variants_paused` · 변형 필수 칸) · (새) `scripts/inapp-examples.ts` · (새) `assets/inapp-examples/cut-*.png`(선례 누끼 3) |
| SDK | (새) `poster-frame.ts` · `inapp.ts`(`INAPP_SDK_CAPS` · 캐시 키 · 서버 시각 차이 · `renderPosterFrame` · `copyCouponCode` · 스크림 = 부품 함수) |
| 프론트 | (새) `components/inapp/PosterFramePreview.tsx` · `InAppExampleGallery.tsx` · `InAppDmLinkPicker.tsx` · `InAppFramePicker.tsx` · `generated/poster-frame.ts`(사본) · `scripts/sync-poster-frame.mjs` · `inappSlides.ts` · `inappStarters.ts` · `PosterEditor.tsx` · `InAppEntryGallery.tsx` · `AppIntegrationContract.tsx`(계약 v4) · `InAppMessagePreview.tsx` · `dm/build/StudioInsertModal.tsx` · `studio/StudioMake.tsx` · `lib/studio-draft.ts` · `pages/ImageStudioPage.tsx` · `pages/InAppMessagesPage.tsx` |

### 13-2 설계와 달라진 점 (근거)

| # | 설계 | 구현 | 근거 |
|---|---|---|---|
| D1 | 띠 라벨 채울 자리 = 「쿠폰 코드를 넣어 주세요」(§3-5) | 「띠 문구에 직접 채울 자리가 남아 있어요…」 | 라벨 결함에 쿠폰 코드 문구를 쓰면 남은 시간 띠에서도 거짓 안내가 된다 |
| D2 | 마감 = 게시 끝 시각(새 칸 0) | 같음 + 남은 시간 띠를 고르면 발행 전 확인 칸에 「게시 끝 시각」 입력(`endAt` 으로 보냄) | 편집기에 끝 시각을 넣는 칸이 없었다(목록 응답 = 원본 행 `end_at` · 편집기 입력 0) · 이 칸 없이는 남은 시간 띠를 게시할 수 없다 |
| D3 | 예시 12 · 그림 19장 | 9 · 14장(결온 3 · 소요웨어 3 · 오후담 3) | 커머스 3 = §10-2 업체 이름 · 누끼 미정(지어낸 이름 금지) · 정해지면 표에 3줄 더함 |
| D4 | — | `cdp_inapp_messages.is_ad` 를 읽던 createVariant(SELECT · INSERT) · AI 다듬기(SELECT)에서 칸을 뺐다 | 실 PG 42703 · 운영과 정의 해시가 같다고 대조된 덤프에 칸 없음 · SCHEMA.md 41칸에도 없음 = 운영에서도 변형 만들기 · AI 다듬기가 첫 SELECT 에서 실패하던 것(이번 변경 전부터) · 이 함수가 통짜 변형 규칙 · 부모 선잠금의 자리라 빼지 않으면 요구가 닫히지 않는다 · 같은 칸을 SQL 로 읽는 곳 = grep 전수 2파일 · BUGS 등재 |
| D5 | 모양 이름 「통짜 포스터 · 바닥 시트」 등 | 「통짜 포스터」 · 「통짜 포스터 카드」 · 「사진 위 글」 · 「사진 위 글 카드」 | 고객이 읽는 글의 가운뎃점을 줄인다(memory `feedback_no_middle_dot_in_outward_copy`) |
| D6 | 그리는 부품 = 편집기 · 갤러리 · 고객으로 보기 | + 공용 미리보기(`InAppMessagePreview` · `AppInAppPreview`)의 포스터 갈래도 새 틀이면 부품 | 목록 · 테스트저장 · 기본 미리보기가 통짜 글을 그림 위에 한 번 더 그리지 않게(소비처 전부 한 갈래) |
| D7 | 쪽 번호 알약 하나 | 알약 안에 ‹ 1 / 3 › | 마우스만 쓰는 PC 에서 장 넘김 수단(그림 위 HTML = 쪽 번호 하나 규칙 그대로) |
| D8 | 「앱 새 판」 표시 판정 = APP_CONFIRMED_CAPS | 필요 판 = SDK 부품 `posterFrameRequiredCaps`(사본) | 화면이 서버 함수를 부를 수 없다 → 서버 `inAppRequiredCaps` 와 표본 표로 묶음(CT-IA4 · R1) |
| D9 | 팝폰 앱 코드(§3-11) | 미착수 | §10-5 미커밋 5파일 선행 · OTA 전까지 앱은 `caps` 를 안 보내 서빙 관문이 막는다(잘린 화면 0) |

### 13-3 시험

- 계약 `backend/src/utils/__tests__/inapp-poster-redesign-1105.test.ts` 51건 = CT-IA1 · 2 · 3 · 4 · 5 · 8 · 9 · 10 · 12 + 게시 판정 · 변형 판정 · DM 판정 · 화면 배선.
- SDK `sdk-js/src/__tests__/inapp-poster-frame-1105.test.ts` 14건(CT-IA6 · 손잡이) · `inapp-poster-dom-lock-1105.test.ts` 3건(CT-IA7 · 부품 옮기기 **전** 스냅샷을 먼저 쓰고 옮긴 뒤 같음).
- 실 PG `inapp-poster-1105.pg.test.ts` 9건(CT-IA11 · 결과 행 판정 · 경품 DM · 끝 시각 · 문구 변형 멈춤 · 다시 켜기 · 통짜 변형 그림 · 관문 20개 채우기 · 변형 끝 시각).
- 옛 구조를 글자로 확인하던 시험 고침 = `inapp-editor-redesign-0929.test.ts`(인라인 판정 행 → 결과 행 · 켜기 순서 · 전파 반환값) · `image-studio-picker-channel-1016.test.ts`(`onInserted` 둘째 인자) · 생성 스크립트 = 성공해도 스스로 끝남(R26).
- 변이 확인(파일 복사) = 관문 줄 삭제 · DM 판정 빼기 · 끝 시각 부모만 조건 빼기 → 셋 다 빨간불 · 원본 복구 `cmp` 같음.
- 전체 = backend vitest 760파일 · sdk-js 24파일 235건 · 실 PG 57파일 407건(도장 기록).

### 13-4 브라우저 실측 (SDK 소스를 esbuild 로 묶은 시험 페이지 · 1105)

| 장면 | 375×812 | 1280×800 |
|---|---|---|
| 통짜 · 떠 있는 카드 · 쿠폰 띠 | 카드 위 닫기 줄(하루 보지 않기 · X 44px) · 그림 contain · 띠(라벨 · 코드 · 복사) · 강조색 버튼 | — |
| 통짜 · 바닥 시트 · 남은 시간 | 「2일 02:59:50」이 1초마다 줄어듦 · 높이 상한에 맞춰 시트 폭 축소 | — |
| 통짜 · 카드 2장 | 장 3:4 · 전체 높이 67.7% · 쪽 번호 1 / 2 | 가운데 · 폭 325 · 높이 69.1% |
| 글 얹기 · 카드 | 스크림 라벨 · 제목 · 본문 | — |

## §14 Codex 구현 리뷰 기록

방법 = `status/CODEX-RUNBOOK.md` · adversarial-review · `--model gpt-6-astra` · 1라운드 = 변경분 전체 · 2라운드부터 = 고친 줄 + 직접 영향만.

### 1라운드 (1105 · needs-attention · high 1 · medium 3 · 전부 수용)

| # | 등급 | 지적 | 판정 | 처방 |
|---|---|---|---|---|
| I1 | high | 일반 수정(PUT)이 변형 행을 고칠 때 부모를 잠그지 않고 변형 판정을 건너뛴다 = 통짜 전환으로 멈춘 문구 변형을 PUT 으로 다시 켤 수 있다 | 수용 · **설계 C7 · 구조체크 S23 과 같은 부류**(「변형을 쓰는 자리 = 부모 먼저 잠금 + 변형 판정」에서 수정 길을 빠뜨림) → 개별 땜질 금지 | 잠금 한 규칙을 함수 하나 `lockParentFirst` 로(일반 수정 · 켜기가 같은 함수 · 초안 행 잠금보다 앞) · 켜기의 부모 잠금 사본 삭제 · 실 PG = PUT 으로 켜기 거절 |
| I2 | medium | 장 · 버튼 없이 action_url 만 있는 통짜 = 서빙 첫 장 합성에서 버튼을 잃는다 | 수용 | 같은 합성 CT `synthesizeButtonsFromActionUrl`(SDK renderLegacy 와 같은 규칙) |
| I3 | medium | 40자 쿠폰 코드가 [복사]를 카드 밖으로 밀어 잘린다 | 수용 | 코드 칸 = 줄어들며 말줄임(min-width 0) · [복사] 고정 · 복사 원문 = 글자 전체 |
| I4 | medium | 메시지가 버튼 · 그림 이동 · 자동 닫힘으로 사라져도 전역 키 · 창 크기 리스너가 남는다 | 수용 | 정리 한 곳 `dispose`(바깥 틀이 문서에서 빠지면 body 직속 자식 관찰로 부름 · 닫기도 부름) |

범위 밖(기록만) = 지금 이벤트 카드 · 배너 시트(`renderPosterSheet`)의 keydown 리스너도 다음 키 입력 때만 떨어진다(이번 변경 전부터 · 같은 처방을 옮겨 쓸 수 있다).

### 2라운드 (1105 · **approve** · 지적 0)

Codex 확인 = 부모 → 변형 잠금 순서(일반 수정 · 켜기 · 전파 · createVariant 같음 · 부모를 고치는 수정은 추가 잠금 0) · 켜기 반환 계약(부모 id 를 아는 변형 · 모르는 변형 · 부모) · 모든 사라짐 길의 dispose · 쿠폰 [복사] 자리 · 첫 장 버튼 합성.
