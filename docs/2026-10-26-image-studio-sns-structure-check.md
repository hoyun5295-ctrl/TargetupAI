# 이미지 스튜디오 · SNS 채널 구조체크 (2026-10-26)

> 호출어 **"스튜디오 SNS 구조체크 / SNS 채널 구조체크 / 페북 X 연동 / 틱톡 연동"**. 이 문서가 이번 구조체크의 접수 대조 · 범위 · 결함 · 처방 · 채널 연동 현황을 소유한다.
> 기능 상설 = [FEATURE-SNS-CHANNEL.md](FEATURE-SNS-CHANNEL.md) · [FEATURE-IMAGE-STUDIO.md](FEATURE-IMAGE-STUDIO.md) · 뿌리 = [ROOT-LEDGER.md](ROOT-LEDGER.md) · 앞선 표적 점검 = [2026-10-25 한 줄 전 기능 구조체크](2026-10-25-oneline-all-structure-check.md) §4-F · §4-I.
> 방식 = 에이전트 0 · 내가 직접 읽음(memory `feedback_no_agents_for_audit_direct_inspection`). 코드 0 · DDL 0(설계 단계 · Harold님 동의 전).

## §0 접수 대조표 (Harold 1026 원문 = 「이어서 이미지스튜디오, SNS 채널 구조체크하자 SNS 채널 페이스북이랑 X 까지 연동하긴해야하는데 틱톡도 아직 안했잖아」)

| # | 접수 | 이 문서가 닫는 방법 | 이것 없이 접수가 닫히는가 |
|---|---|---|---|
| 1 | 이미지 스튜디오 구조체크 | §2 결함 · §5 처방(스튜디오 몫) | 닫히지 않음 |
| 2 | SNS 채널 구조체크 | §2 결함 · §5 처방(SNS 몫 · 인스타 · Threads · 페북 · X 어댑터 포함) | 닫히지 않음 |
| 3 | 페이스북 · X 연동 | §4 현황 = 코드 완료(0923) · 실연결 0 · raw 0. 연동 = §5 처방 배포 뒤 콘솔 · ENV · raw 실측 · 1건 게시(§4-2 단계표) | 처방 없이 연동하면 §2 S2 · S4 가 그 채널에서 바로 터진다 |
| 4 | 틱톡 | §4-3 = 어댑터 0 · 설계 0 · 플랫폼 조건(0917 설계서 §1-1) · 새 채널 설계 착수 조건 | 별도 설계서(새 채널 = 새 축) |

## §1 범위 · 읽은 정도

| 기능 | 파일 | 줄 | 읽은 정도 |
|---|---|---|---|
| SNS 서버 | `routes/sns.ts` · `utils/sns-*.ts` 24 · `utils/sns/*.ts` 6(어댑터 · 계약) | 약 8,400 | 줄마다 = 라우트 · 계정 · 발행 · 대조 · 토큰 워커 · 저장(compose) · 다시 시도 · 목록 · 확인할 것 · 미디어 · 서명 주소 · 예약 시각 · 멱등키 · AI 표시 · 태그 · 글 규칙 · 규격 판정 · 실패 안내 · 어댑터 4. AI 캡션 = 본체 · 사진 읽기 · 출구 거름(1024 세 채널 구조체크 범위). 맞춤법 = 진입부. 영상 판독(`sns-video-probe.ts` 370) = 표적 제외(이진 상자 해석 · 짝 시험 `sns-video-probe.test.ts`) |
| SNS 화면 | `SnsPage.tsx` · `components/sns/*` 6 · `utils/sns-view.ts` · `sns-draft.ts` | 약 3,000 | 화면 줄마다 · 작성기(`SnsComposer.tsx` 1,647) = 상태 · 올리기 · 사진 · 영상 · AI · 맞춤법 · 태그 · 불러오기 · 보존(그리는 부분은 문구 · 버튼 표적) · `sns-view.ts` = 판정 함수(서버 미러 · 계약 시험이 같은 표로 맞춘다) |
| 이미지 스튜디오 | `routes/image-studio.ts` · `utils/image-studio.ts` · `image-studio-attempt.ts` · `python/image_studio_service.py` · 화면 `ImageStudioPage.tsx` · `components/studio/*` 3 · `lib/studio-*.ts` 3 | 약 3,400 | 줄마다. 템플릿 정의(`image-studio-templates*.ts` 5,505줄) = 자료라 표적 = 공개 칸 줄표 · 모델명 0 확인 |
| 같은 뿌리 전 기능 | §2 S5 · S8 · S9 가 걸린 다른 기능 파일 | — | 그 줄만 |

## §2 결함 (증거 = 코드 줄 · 실행 출력)

| # | 등급 | 뿌리 | 자리 | 결함 |
|---|---|---|---|---|
| S1 | 높음 | 새 뿌리(R18 · 판정 시계 = 사건 시각) | `sns-signed-media.ts` `isSnsMediaUrlLive` 88 | 플랫폼이 사진 · 영상을 가져가는 서명 주소의 절대 상한 36시간을 **target 행 생성 시각(= 글 저장 시각)** 으로 잰다. 저장하고 36시간 넘게 뒤로 예약한 사진 · 영상 글은 게시 순간 주소가 404 라 인스타 · Threads · 페이스북이 미디어를 못 받는다(X 는 우리가 올려서 무관). **실행 확인 1026**: 저장 3일 뒤 예약 · 선점 직후 = `live=false` · 컨테이너 방금 만듦 = `live=false` · 지금 올리기 = `live=true`. 예약 블록(0924)이 생기기 전의 36시간 규칙이 그대로 남은 것 |
| S2 | 높음 | R7(판정 못 함을 반대로 읽음) | `sns/instagram.ts` 311 · `threads.ts` 251 · `facebook-page.ts` 271 `fetchPost` · `sns-reconcile-worker.ts` `detectDeleted` 186 | 재조회가 HTTP 400 을 「게시물 없음」으로 읽는다 · 삭제 감지는 계정 상태(active)를 보지 않는다. 권한 회수 콜백 · 토큰 워커는 계정을 `reauth_required` 로 바꾸되 토큰을 남기므로, 끊긴 계정의 게시물이 30분마다 최대 30건씩 「채널에서 삭제됨」으로 찍힌다(실제로는 살아 있다). Meta 가 만료 · 회수 토큰에 400 을 준다는 것 = 문서 기준 · raw 미검증. 상태 미확인 경로 = 코드로 확정 |
| S3 | 높음 | R3(사용자 범위) | `routes/sns.ts` 전 주소 · `sns-posts.ts` · `sns-accounts.ts` | SNS 전체가 회사 단위다. 담당자가 다른 담당자의 글을 보고 · 취소 · 다시 시도 · 시각 바꾸기 · 고치기를 하고, 계정을 해제 · 다시 연결한다. 그리고 **소재 라이브러리의 남의 소재를 SNS 소재 고르기로 보고 복사한다**(`/assets` · `/media/from-asset` = 회사 조건만 · 라이브러리 자체는 담당자 = 자기 것 `utils/assets.ts` listAssets · getAsset ownerId). 상시 원칙(`owner-scope.ts` · memory `feedback_user_scope_is_a_standing_principle` 「SNS 계정 연결」 명시)과 0917 설계서 §9-7(「승인 직후 개정 1회」)이 미반영 |
| S4 | 중간 | 새 뿌리 후보 · R14 이웃(연결이 끊긴 것을 끊김으로 못 봄) | `sns-publish-worker.ts` 360 · `sns-accounts.ts` `isSnsReauthError` 338 | 게시 중 다시 연결 판정 = HTTP 401 만. Meta 는 만료 · 회수 토큰에 400(OAuthException 190 · 문서 기준)을 주므로 계정이 active 로 남고 예약 글이 하나씩 「채널이 받아들이지 않았어요」로 실패한다(확인할 것 띠의 「다시 연결」이 안 뜬다). 거꾸로 토큰 워커는 400 · `/invalid|permission/` 을 모두 다시 연결로 본다(한도 · 일시 오류도 끊김으로 읽을 수 있다 · 미검증). 판정이 상태 코드 · 문장 글자에 기댄다(memory `feedback_fix_the_decision_point_not_the_spelling`) |
| S5 | 중간 | R10 · R11(외부 원문 노출) | `routes/sns.ts` 879 · 965 · `sns-publish-worker.ts` `failureMessage` 67 · `sns-failure-notice.ts` 27 | 플랫폼 영어 원문이 고객 글이 된다: 승인 취소 `(error_description)` · 연결 실패 = 어댑터 오류 원문 · 게시 실패 = 원문이 `last_error` → 기록 화면 · 확인할 것 띠 · **담당자 안내 문자(80자)** 로 나간다. 공용 CT `publicErrorText`(한국어 · 영문 0 꼴만 통과) 미사용 |
| S6 | 중간 | Z5 · R10(같은 뿌리 기능 넘음) | `routes/sns.ts` 271 · `dm.ts` 2813 · `sender-registration.ts` 90 · `upload.ts` 89 | multer 를 미들웨어 꼴로 쓰는 4곳은 크기 · 개수 초과가 전역 처리기로 가서 **500 「서버 오류가 발생했습니다」**(app.ts 569). SNS 는 8MB 넘는 휴대폰 사진에서 흔하다. 계약 시험(root-ledger 「업로드 오류 = uploadErrorText」)이 콜백 꼴만 센다(느슨한 매칭) |
| S7 | 중간 | R9(한 줄 + AI) | `SnsComposer.tsx` 818 | 위 한 줄 칸 → 작성기 넣기에서 AI 실행 판정이 **넣기 전 글**로 계산된 `aiMode` 를 본다. 빈 작성기에 한 줄을 넣으면 `locked` 로 읽혀 AI 가 돌지 않는다(글만 들어가고 멈춤) · 쓰던 글이 있을 때만 돈다. 렌더 실측 = 구현 때 시험으로 |
| S8 | 중간 | R4(쓸 결과 · AI JSON 칸) 계약 구멍 | `sns-caption-ai.ts` 486 · 320 · `email-ai.ts` 355 · 363 · 404 · 405 · 557 · 607 · `company-daily-brief.ts` 117 | aiStr 계약(root-ledger 1482)이 `extractJsonFromAiText(` 글자와 `String(parsed.칸 ||` 꼴만 본다. **실행 확인 1026**: `email-ai.ts` = 제네릭 호출(`extractJsonFromAiText<…>(`)이라 `extract=false` 로 빠짐 · `sns-caption-ai.ts` = `??` 꼴이라 빠짐 · `company-daily-brief.ts` = 다른 해석기(`extractJsonObject`). AI 가 칸에 객체를 주면 「[object Object]」가 사진 초안 · 메일 제목 · 브리핑 머리말이 된다 |
| S9 | 낮음 | R10(죽은 줄) 계약 구멍 | `routes/image-studio.ts` 665 · 714 · `routes/ai.ts` 2147 · 2520 · 3176 · 4056 | `return …;` 바로 뒤 같은 깊이의 `if (respondUserError(res, err)) return;` 6줄 = 도달 불가(1025 넣기 스크립트). 앞의 공용 함수가 이미 사용자 오류를 처리해 동작 차이 0 · 계약(깊이 검사)이 도달성을 안 본다 |
| S10 | 중간 | R6 이웃(쌓이는 자원 = 정리 · 상한 짝) | `sns-media.ts` 268 · `assets.ts` getStorageUsage | SNS 게시본(`sns-render`) · 원본(`sns-media` · 영상 300MB씩) 정리 경로 0 — `removeSnsRenderFile` 호출 0(머리 주석 「보관 기간이 지나면 게시본만 지운다」 = 미구현) · SNS 미디어는 회사 저장 용량 셈(`cdp_assets` 합)에 안 들어 상한이 없다. 스튜디오 임시 파일은 정리 워커가 있다(`studio-temp-sweeper.ts`) |
| S11 | 중간 | 부품 ≠ 기능(memory `feedback_a_feature_can_be_dead_with_every_part_present`) | `sns-ai-notice.ts` 18 | AI 표시 판정이 `sns_media.ai_declared` 를 읽지만 쓰는 곳 0 · 화면 칸 0(0917 설계 §3-9 「업로드 칸 체크 AI로 만든 영상 · 이미지예요 · 기본 꺼짐」 미구현). 다른 도구로 만든 AI 이미지를 직접 올리면 표시할 길이 없다 |
| S12 | 낮음 | R16 이웃(R18 같은 뿌리) | `sns-publish-worker.ts` `meteredMonthCount` 155 | X 이번 달 상한 셈 = target **생성 시각** 기준 → 지난달 저장 · 이번 달 게시분은 이번 달 셈에서 빠진다(실비 상한 넘침 가능). 기준 = 게시 선점 시각(`claimed_at`) |
| S13 | 낮음 | R15(죽은 주소 · 갈래) | `routes/sns.ts` 568 PUT `/tag-set` · `sns-compose.ts` 초안 갈래 | PUT `/tag-set` 화면 호출 0(「옛 화면 호환」) · POST `/posts` 의 초안 갈래(publish 없음) = 화면은 늘 publish 를 싣고 `/publish` 는 1025 에 지웠으므로 초안은 영영 올릴 수 없다 |
| S14 | 낮음 | R1(같은 판정 여러 벌 · 죽은 칸) | `sns-publish-worker.ts` 116 · `sns-reconcile-worker.ts` 199 · `routes/sns.ts` 739 · `sns-compose.ts` 302 | `sns_posts.status` = 읽는 곳 0(목록은 계정별 최신 행에서 파생 · `sns-posts.ts` 머리 주석 「읽는 곳은 여기 한 곳」도 사실과 다름) · 계산 = TS `derivePostStatus` + SQL 사본 2 + 직접 쓰기 2 |
| S15 | 낮음 | R1 | `routes/sns.ts` `fitsByChannel` 372 | 사진별 채널 안내가 어댑터 준비(`available`)만 보고 개방 판정 CT(`snsChannelAvailable` · 회사 명단 · 자격 ENV)를 안 본다 → 이 회사에 닫힌 채널 안내가 응답에 섞인다(화면은 고른 채널만 써서 지금 보이는 영향 0) |
| S16 | 낮음 | R7(실패를 빈 것으로) | `SnsAssetPicker.tsx` 40 · `SnsHistory.tsx` 145 · `ImageStudioPage.tsx` 104 | 조회 실패를 「아직 소재가 없어요」 · 빈 기록 · 빈 라이브러리로 그린다 |
| S17 | 낮음 | 화면 하한(목록) | `routes/sns.ts` `/assets` 313 · `SnsAssetPicker.tsx` | SNS 소재 고르기 = 최신 60개 · 검색 0(라이브러리 CT `listAssets` = 검색 · 200 · 담당자 범위) → 오래된 소재를 못 고른다. S3 처방(같은 CT)으로 함께 닫는다 |
| S18 | 낮음 | 화면 하한(다시 입력 요구) | `sns-media.ts` `SNS_IMAGE_MAX_BYTES` 35 | SNS 사진 8MB 넘으면 거절 = 사용자가 다시 내보내야 한다. 게시본은 어차피 채널 폭 · 용량으로 다시 굽는다(폭 상한 + 품질 사다리) → 원본 상한은 더 커도 된다 |
| S19 | 낮음 | 형식 = 실제 내용 | `routes/image-studio.ts` `/upload-product` 470 | 스튜디오 상품 업로드가 브라우저가 적은 형식(mimetype)만 믿는다(SNS 는 sharp 로 실제 내용 판정) → 그림이 아닌 파일이 임시로 저장되고 그 형식으로 서빙된다 |
| S20 | 낮음 | R1 | `SnsComposer.tsx` 849 | 쓰던 글 복원이 「이미 올린 글인가」를 기록 1쪽(10개)에서만 찾는다 → 11번째 이후 글은 다시 복원되고 올리기에서 「이미 올렸어요」로 끝난다. 글 하나 조회(`GET /posts/:id`)가 있다 |
| S21 | 중간 | R14(감지했는데 사람에게 안 닿음) | `sns-reconcile-worker.ts` 154 | 「올라갔는지 모름」 중 확인 포기(`verify_gave_up_at`)는 담당자 문자 0(실패 · 결과 모름은 #96 으로 보낸다). 확인할 것 띠는 화면을 열어야 보인다 |

### §2-1 결함 아님으로 확인한 것
- 이중 게시 3겹(UNIQUE · SKIP LOCKED + lock_token · 게시 직전 소유권) · 게시 호출 뒤 결과 모름 = 다시 시도 잠금 · 좌초 회수(게시 호출 행은 되돌리지 않음) = 정상.
- 저장 · 예약 한 트랜잭션 · composeId 중복 0 · 화면 확정본 대조(409) · 글 고치기 대체 · 시각 바꾸기 NOWAIT · 다시 시도 두 번 = 한 번 = 정상.
- OAuth state 서명 + 1회용 행 · PKCE verifier 1회용 · 권한 회수 서명 검증(timingSafeEqual) · 복귀 창 postMessage origin 명시 = 정상.
- 서명 미디어 주소 = 상태 결박 · 미디어 교체 감지 · 경로 조작 차단 = 정상(시간 기준만 S1).
- X 토큰 = 계정 행 잠금 안에서만 갱신 · 토큰 워커는 X 를 건너뜀 = 정상.
- 스튜디오 생성 · 수정 · 헤드라인 = 회사 잠금 → 기억 결과 → 납부 확인 → 잔액 → 생성 → 정산(settleOrUndo) = 정상 · 외부 호출 시간 상한(엔진 120초 · py 60초) 있음 · 임시 파일 7일 정리 워커 있음 · 파이썬 서비스 127.0.0.1 바인딩.
- 화면 = native dialog 0 · 모델명 0 · 줄표는 주석에만(계약 `em-dash-invariants`).

## §3 덮음표 (기능 × 뿌리 · 1026 읽기 끝)

| 뿌리 | SNS 서버 | SNS 화면 | 스튜디오 서버 | 스튜디오 화면 |
|---|---|---|---|---|
| R1 같은 사실 두 벌 | S14 · S15 | S20 | 0 | 0 |
| R3 사용자 범위 | S3 | S3 | 0(임시 = 회사 · 소재 = 담당자 범위 사용) | 0 |
| R4 쓸 결과 | S8 | — | 0 | — |
| R6 닫히지 않는 상태 · 쌓임 | S10 | — | 0 | — |
| R7 판정 못 함 | S2 · S4 | S16 | 0 | S16 |
| R9 한 줄 | — | S7 | 0 | 0 |
| R10 · R11 문장 | S5 · S6 | 0 | S9 | 0 |
| R12 잠금 | 0 | — | 0 | — |
| R14 사람에게 닿음 | S21 | — | 0 | — |
| R15 죽은 주소 | S13 | — | 0 | — |
| R18(신설) 판정 시계 | S1 · S12 | — | 0 | — |
| 부품 ≠ 기능 | S11 | S11 | 0 | 0 |

## §4 채널 연동 현황

### §4-1 채널별

| 채널 | 연결 | 게시 | 확인(재조회) | 지금 막고 있는 것 |
|---|---|---|---|---|
| 인스타그램 | 실동작(0920) | 코드 · 실측 대기(S3 게이트 1건 미실행) | 코드 | S1 · S2 · S4 · S5 |
| Threads | 실동작(0921) | 코드 · 미검증(버전 없는 게시 주소 `/{id}/threads` · `/v1.0/me` 와 다름 = raw 로 확정) | 코드 | S1 · S2 · S4 · S5 |
| 페이스북 페이지 | 코드 · 미검증(0923 · 문서 기준) | 코드 · 미검증 | 코드 · 영상은 처리 중이면 「없음」 | S1 · S2 · S4 · S5 · 서버 ENV 유무 미확인 |
| X | 코드 · 미검증(PKCE · 0923) | 코드 · 미검증(업로드 = 우리 디스크 → S1 무관) | 게시 직후 1건(실비) · 삭제 감지 제외 | S5 · S12 · 서버 ENV · 월 상한 유무 미확인 |
| 틱톡 | 0 | 0 | 0 | 어댑터 · 설계 0 |

### §4-2 페이스북 · X 연동 단계 (§5 처방 배포 뒤 · 명령은 그때 하나씩)
1. 서버 ENV 유무 확인(값 비노출 · `grep -c`) — `FACEBOOK_PAGE_CLIENT_ID/SECRET/REDIRECT_URI` · `SNS_FACEBOOK_PAGE_COMPANY_IDS` · `X_CLIENT_ID/SECRET/REDIRECT_URI` · `SNS_X_MONTHLY_POST_CAP` · `SNS_X_COMPANY_IDS`.
2. 콘솔(Harold) — Meta 앱 「Facebook 로그인」 이용 사례 · 권한 `pages_show_list` · `pages_read_engagement` · `pages_manage_posts` · 콜백 `https://hanjul.ai/api/sns/auth/callback/facebook_page` · 권한 회수 `…/api/sns/deauthorize/facebook_page` · 자사 페이지 관리자 역할. X 개발자 콘솔 OAuth 2.0 Web App(기밀) · 콜백 `…/api/sns/auth/callback/x` · 지출 상한(두 번째 겹).
3. ENV 넣기 · `pm2 restart targetup-backend --update-env`(reload 는 env 를 다시 안 읽는다 · 업무 시간 밖).
4. raw 먼저(memory `feedback_external_api_response_verification` · 어댑터보다 curl 먼저) — 토큰 교환 · `/me/accounts` · 글 1건 · 사진 1건 · 재조회 · **지운 글 재조회(없음 응답 꼴 = S2 「없음」 판정 근거)** · 만료 토큰 응답 꼴(S4 근거).
5. 실측 1건 — 자사 계정 연결 → 사진 1장 · 글 → 두 채널 게시됨 → permalink → 예약 1건(저장 36시간+ 뒤 · S1 처방 확인).
6. 회사 개방 = 채널 명단 ENV(심사 전 채널은 명단 회사에만 · `sns-availability.ts`). 남의 회사 페이지 게시 = Meta 앱 검수(Advanced Access) 뒤.

### §4-3 틱톡 (새 채널 = 별도 설계서)
- 플랫폼 조건(0917 설계서 §1-1 · 공식 문서 열람 기준): 감사 전 앱 = 자사 계정이어도 비공개(SELF_ONLY) 게시만 · 24시간 5명 · 공개 범위 기본값 금지(사용자가 고름) · 업로드 화면에 닉네임 표시 · 명시 동의 뒤 전송 · 로고 · 워터마크 · 홍보 문구 · **링크 덧붙이기 금지** · `is_aigc` 표시 · URL 가져가기(PULL_FROM_URL)는 도메인 소유 인증 · 토큰당 분당 6요청.
- 우리 쪽에 필요한 것: 어댑터 1파일(연결 · 크리에이터 정보 조회 · 게시 · 상태 조회) · 화면 요구 요소(공개 범위 고르기 · 닉네임 · 동의 칸 · 상업 콘텐츠 표시) · `requiresExplicitConsent` 갈래(계약에 자리만 있음) · 영상 전송 방식 결정(도메인 인증 vs 조각 업로드) · 감사 신청(공개 게시 조건).
- 착수 = 이 문서 처방 배포 · 페북 · X 실측 뒤 별도 설계서(새 축 · `scope_discipline_one_ticket_axis`).

## §5 처방 설계안 (Harold님 동의 전 · 코드 0)

| # | 처방(한 답) | 바뀌는 동작 |
|---|---|---|
| S1 | 서명 주소 절대 상한 = **선점 시각부터**(`COALESCE(claimed_at, created_at)` · 서빙 조회에 `claimed_at` 추가) · 컨테이너 시각 26시간 규칙은 그대로 | 예약 글 사진 · 영상이 게시 순간 열린다 |
| S2 | 재조회 「없음」 = 404 · 플랫폼이 「대상 없음」이라 답한 꼴만(§4-2 ④ raw 로 확정 · 그 전에는 400 = 판정 못 함 → 던짐) · 삭제 감지 · 확인 = active 계정만 | 끊긴 계정 글이 「삭제됨」이 되지 않는다 · raw 전까지 인스타 삭제 감지는 404 만 |
| S4 | 다시 연결 판정 한 곳 = 어댑터가 **오류 본문 코드로** 가른다(Meta = OAuthException 190 계열 → 끊김 · 한도 코드 → 미룸 · 그 밖 = 일시) · 발행 · 대조 · 토큰 워커가 같은 함수 · 상태 코드 · 문장 정규식 판정 삭제 | 끊긴 계정이 「다시 연결」로 뜬다 · 한도를 끊김으로 읽지 않는다 |
| S5 | 고객 글 = `publicErrorText(err, 사람 문장)` 한 곳(승인 취소 · 연결 실패 · 게시 실패 · 안내 문자) · 원문은 로그만 | 영어 원문 0 |
| S6 | 4곳 = 콜백 꼴 + `uploadErrorText` · 계약 = 미들웨어 꼴도 센다 | 크기 초과 = 400 + 「파일 하나는 N MB 이하」 |
| S7 | 넣기 뒤 글로 모드 판정(`snsCaptionMode({ body: 넣은 뒤 글 … })`) | 빈 작성기에 한 줄 → AI 글이 바로 나온다 |
| S8 | `aiStr` 적용(위 9줄) · 계약 = **AI 를 부르는 파일**에서 해석 결과 칸을 `String(x.칸 ?? ‖ …)` 로 읽는 꼴 0(호출 꼴 · 해석기 이름 · 변수 이름 무관) · 예외 = 이유 줄 | 객체 칸 = 빈 글(그 갈래의 「못 씀」 처리로) |
| S9 | 6줄 삭제 · 계약 = return · throw 바로 뒤 같은 깊이 줄 0 | 동작 차이 0 |
| S10 | 게시본 = 그 target 이 끝난(게시됨 확인 · 실패 · 취소) 뒤 **D3 일** 지나면 지움(스튜디오 정리 워커에 한 갈래) · SNS 원본을 회사 저장 공간 셈에 넣는다(**D3**) · 업로드 전 한도 판정 | 디스크 상한 · 한도 넘으면 「저장 공간이 가득 찼어요」 |
| S11 | **D4** | — |
| S12 | 월 상한 셈 기준 = `claimed_at`(게시 선점) | X 상한이 실제 게시 달로 센다 |
| S13 | PUT `/tag-set` 삭제 · `/posts` 초안 갈래 삭제(publish 필수 · 없으면 400) | 옛 주소 404 |
| S14 | `sns_posts.status` 계산 사본 2 · 직접 쓰기 2 삭제(넣을 때 값만) · 머리 주석 정정 | 화면 차이 0 |
| S15 | `fitsByChannel` = 개방 판정 CT 로 거른다 | 응답에서 닫힌 채널 안내 0 |
| S16 | 조회 실패 = 「불러오지 못했어요 · 다시 시도」 줄(빈 화면과 가른다) | 실패가 빈 것으로 안 보인다 |
| S17 | S3 와 함께 = 라이브러리 CT(`listAssets` · 담당자 범위 · 검색) 재사용 · 고르기 창에 검색 칸 | 오래된 소재 · 검색 |
| S18 | 사진 원본 상한 8MB → **D2** · 게시본 굽기가 채널 폭 · 용량으로 줄인다(지금 경로 그대로) | 큰 휴대폰 사진을 다시 내보내지 않는다 |
| S19 | 상품 업로드 = sharp 로 실제 형식 판정(SNS 저장과 같은 규칙) | 그림이 아니면 400 |
| S20 | 복원 확인 = `GET /posts/:id` | 11번째 이후 글도 다시 복원되지 않는다 |
| S21 | 확인 포기도 같은 안내 함수(`notifySnsTargetsFailed` 의 「결과 모름」 문장) | 담당자 문자 1통 |
| S3 | **D1** + 글 · 미디어 · 소재 = 만든 사람(`resolveOwnerScope` · `canAccessOwnedRow`) · 관리자 = 회사 전체 | 담당자 = 자기 것 |

### §5-1 결정 (추천 1개씩)

| # | 무엇 | 후보 | 추천 |
|---|---|---|---|
| D1 | SNS **계정**의 주인 | 가 회사 공용(담당자도 회사 계정으로 올림 · 해제 · 다시 연결 = 관리자만) / 나 연결한 사람(`connected_by` · 담당자 = 자기가 연결한 계정만 · 관리자 = 전체) / 다 분류코드(0917 §9-7 안 · `sns_accounts.store_code` DDL) | **나** — 상시 원칙(데이터 = 담당자별 격리)과 같은 축 · 칸이 이미 있어 DDL 0 · 몰별 담당자가 자기 몰 계정을 직접 연결하면 다른 몰 계정으로 올릴 길이 닫힌다. 대가 = 관리자가 연결한 회사 대표 계정으로 담당자가 올리려면 그 담당자가 직접 연결해야 한다 |
| D2 | SNS 사진 원본 상한 | 8MB 유지 / 20MB / 30MB | **20MB** — 휴대폰 원본(대개 3~12MB)을 다시 내보내지 않는다 · 게시본은 채널 규격으로 다시 굽는다 · S10 저장 공간 셈 안에서 |
| D3 | SNS 파일 수명 · 셈 | 게시본 보관 일수 · 원본을 회사 저장 공간에 넣는가 | **게시본 7일(스튜디오 임시와 같은 값) · 원본 = 회사 저장 공간에 넣는다** — 같은 「저장 공간」 약속 하나 · 영상 300MB 가 상한 없이 쌓이는 길을 닫는다. 대가 = 한도 가까운 회사는 SNS 업로드가 막힐 수 있다(라이브러리처럼 정리 안내) |
| D4 | AI 표시 직접 체크(S11) | 칸을 만든다(업로드한 사진 · 영상마다 「AI로 만든 사진이에요」 1탭 · 기본 꺼짐) / 판정에서 그 칸을 뺀다 | **만든다** — 0917 승인 설계 · AI 기본법 표시 의무 · 1탭 |

### §5-2 시험 (덮음표 빈칸 → 시험 · 대상은 소스에서 뽑음)
- R18 신설(뿌리 대장 + 계약): 서명 주소 · 월 상한 = 시계 칸 고정 단언 + S1 짝 시험(저장 3일 뒤 예약 = live).
- R7: 어댑터 `fetchPost` 「없음」 = 404 · 확정된 꼴만(400 → 던짐) · 삭제 감지 · 확인 조회 = `status = 'active'`.
- R3: SNS 라우터 전 주소 = 담당자 범위 함수를 지난다(라우터에서 뽑음 · 면제 = 이유 줄).
- R4 · R10 · Z5 계약 넓힘(S6 · S8 · S9 꼴) · 새 시험마다 변이 1건.
- S7 렌더 검사(빈 작성기 · 한 줄 → AI 요청 1회).

### §5-3 순서 · 검증 · 배포
D1~D4 동의 → `LESSONS_FRONTEND` 디자인 하한 · `LESSONS_BACKEND` 정독 → 구현(서버 → 화면 · 같은 뿌리 다른 기능 포함) → 계약 · 짝 시험 · 변이 → backend · frontend tsc 0 · 전 시험 → 렌더 검사 → Codex 적대(approve 까지) → build:safe → 배포(업무 시간 밖 · DDL 0 예정 · D1 = 나 · D4 칸은 `information_schema` 로 `sns_media.ai_declared` 있음 확인 뒤) → §4-2 페북 · X 연동.

## §8 구현 기록 (1026 · Harold 「끝까지 구현하고 닫은다음에 코덱스적대리뷰까지 끝내고 보고해」 · D1~D4 = 추천안)

### §8-1 처방대로 한 것 · 바뀐 것
- S1 · S12 = 시계 `COALESCE(claimed_at, created_at)` · 서빙 조회에 `claimed_at`.
- S2 · S4 = 오류 종류 `SnsAdapterError.kind`(auth · rate · not_found · other) · Meta = `metaErrorKind`(본문 코드) · X = 401 · invalid_grant · 재조회 「없음」 = `isSnsNotFound` 만 · 다시 연결 = `isSnsReauthError` = kind 하나(발행 · 대조 · 토큰 워커 공용) · 대조 = active 계정만 · 한도(rate) 실패 문장 따로.
- S3 · D1 = 공용 조각 `snsOwnerClause` · 계정 = `connected_by`(주인 유지 · 옛 행 · 해제된 계정만 새 연결자) · 글 · 사진 = `created_by` · 소재 = 라이브러리 CT(`listAssets` · `getAsset`) · 형식이 틀린 id = 없음(옛 uuid 변환 500).
- S5 = `publicErrorText` 한 곳(게시 실패 · 컨테이너 사유 · 승인 취소 · 연결 실패).
- S6 = 공용 감싸개 `uploadGuard`(http-error.ts) · **같은 뿌리 전 라우터 16곳**(SNS · DM 당첨자 · 발신 담당자 2 · 엑셀 업로드 · 알림톡 11) · 전역 처리기 안전망(MulterError · 본문 크기 413 · 해석 실패 400).
- S8 = `aiStr` · **같은 뿌리 전 기능**(SNS 캡션 2 · 이메일 AI 6 · 오늘 브리핑 1 · 080 요금 판독 2 · 여정 트리거 추천 2 · AI 영업 템플릿 고르기 2).
- S10 · D3 = 정리(게시본 7일 · 원본 = 90일 동안 쓰인 글 없음 + 올리는 중 줄 없음 · 행 먼저 지우고 파일) · 저장 공간 셈 = 라이브러리 + SNS 원본 · 업로드 · 소재 복사 · 영상 시작 전에 한도 판정 · 게시 직전 원본 하나라도 없으면 SOURCE_MISSING(옛: JOIN 이 조용히 걸러 장수가 준 채 나갈 수 있었다).
- S11 · D4 = PATCH `/media/:id/ai-declared` · 작성기 칸마다 「AI?」 1탭(결과 = 서버 판정) · 서버 확정본 대조 지문에 AI 표시.
- S13 = 저장 = 언제나 올리기(publish 없으면 400) · PUT `/tag-set` · `replaceSnsTagSet` 삭제.
- S14 = `refreshPostStatus` 두 벌 · 직접 쓰기 두 곳 삭제(넣을 때 값만 · 읽는 곳 0).
- S18 · D2 = 원본 20MB · S19 = 상품 업로드 sharp 실제 형식 · S20 = 복원 확인 `GET /posts/:id` · S21 = 확인 포기 · 확인 불가도 안내 문자.
- 작성기 불러오기(Codex 1R~4R · §8-4) = 첨부는 불러온 사진(media)과 붙어야 할 사진(held)을 따로 든다 · 불러오기 하나 = 차례 하나(첫 await 전 · await 마다 확인) · 복원 판정 중 = 작성기 입력 잠금 · 보존 멈춤 · 차례 안 기다림 = 전부 상한(`SNS_LOAD_STEP_TIMEOUT_MS` · 공용 `fetchAuthJson` · `fetchAuthObjectUrl(url, timeoutMs)`) · 작성기 = 회사 · 사용자 key 로 다시 만듦 · 다시 시도 = 계정 주인 조각.

### §8-2 시험 · 변이
- 짝 시험 `sns-structure-1026.test.ts`(시계 · 오류 종류 · 재조회 · X · 범위 조각 · 업로드 감싸개 · 초안 갈래 · 정리 2).
- 뿌리 대장 끝 「1026 스튜디오 · SNS」 10건(R18 신설 · R7 재조회 · 다시 연결 · R3 SNS 주소 전수 · R4 AI JSON 칸 = 해석 결과 변수 기준 · R10 도달성 · Z5 미들웨어 꼴 · S5 · S10 · S7). **넓힌 계약이 같은 뿌리를 다른 기능에서 더 찾았다** = AI 칸 6줄 · 업로드 12곳(§8-1).
- ★1026 push 전 전체 실행에서 `journey-v3-credit-out-1020`(준비 단계 10초) · `oneline-content-1021`(시험 20초)이 시간 초과로 push 를 막음(값 실패 0 · 단독 통과 · 불러오기 합계 1,170초 부하) → `packages/backend/vitest.config.ts` 에 hookTimeout 신설 · 두 제한 60초(9-29 testTimeout 만 올렸던 같은 뿌리 · Harold 승인).
- 고친 시험 = sns-0924(쪽 넘김 자리표 $4) · sns-contract(소재 = 라이브러리 CT · 미리보기 정규식에서 AI 표시 PATCH 제외 · 함수 순서) · AI 존 기준표(SNS 호출 꼴 3줄 · 그 밖 = 늘어난 값).

### §8-4 Codex 적대 리뷰 (gpt-6-astra · 라운드마다 직전에 고친 줄만)
| 라운드 | 지적 | 판정 · 처방 |
|---|---|---|
| 1R | high 다시 시도가 계정 주인을 안 봄 · medium 복원이 못 찾은 사진을 말없이 뺌 | 수용 · 다시 시도 계정 조회에 주인 조각(계약 = 요청 길 파일의 계정 SQL 전수) · 못 찾은 사진 = 알림 · 올리기 잠금 · 보존에 남김 |
| 2R | high 사진 확인이 끝나기 전에 올리기 · 보존이 열림 · medium 고치기 중 「빼고 올리기」 = REPLACE_MISMATCH | 수용 · **1R 2번과 같은 부류(첨부가 사람 모르게 줄어듦) → 구조**: 붙어야 할 사진을 불러온 사진과 따로 든다(held · 확인 중) · 고치기 중엔 「고치기 그만두기」 · 내 검토에서 같은 부류 하나 더(늦은 옛 불러오기가 새 글에 사진을 붙임 → 차례) |
| 3R | high 복원의 게시 확인 구간이 차례 밖 · 그 사이 보존이 초안을 지움 | 수용 · **같은 부류 세 번째 = 반복 이유는 한 단계씩만 지킨 것 → 단위를 불러오기 전체로**: 첫 await 전에 차례 · await 마다 확인 · 복원 판정 중엔 작성기에 쓰는 길 0(입력 fieldset 잠금 · 보존 멈춤 · 한 줄 넣기 기다림 · 다른 불러오기 확인 창) · 2R 의 따로 만든 차례는 걷어 하나로 합침 |
| 4R | high 같은 인스턴스가 회사 · 사용자 키를 바꾸면 앞 사람 글이 새 키에 저장 · medium 게시 확인이 끝나지 않으면 잠금 영구 | 수용 · 상태 주인 = 회사 · 사용자 → 호출부가 그 키로 다시 만든다(key 한 줄) · 상한 없는 기다림 = 같은 뿌리 3곳(게시 확인 · 사진 조회 · 미리보기) → 공용 인증 요청 파일 한 곳이 상한(본문 읽기까지) · 넘으면 기존 실패 갈래 |
| 5R | 지적 0 · **approve** | 첫 실행은 잡이 결과 없이 죽음(잡 pid 없음 · 로그 정지 · 전체 시험과 겹친 부하) → 같은 요청문으로 혼자 다시 띄워 approve |
- 실제 화면 확인(3R · 임시 화면 · 확인 뒤 삭제): 게시 확인 응답 3초 지연 중 다른 글 불러오기 → 확인 창 → 글 B · 사진 B 1장 · 늦은 404 뒤에도 B · 보존 = 판정 중 A 유지 후 B / 끼어듦 없는 복원 = A · 사진 A · 「이어서 불러왔어요」 / 판정 중 한 줄 넣기 = 기다림 알림 · 본문 A / 375 폭 넘침 0.
- 변이: 1R 3 · 2R 8 · 3R 22 · 4R 8 전부 잡음. 새로 쓴 화면 문장 가운뎃점 0(9곳 풀어 씀 · 원래 있던 문장은 그대로).
- 마지막 검증(5R approve 뒤 · 코드 변경 0): backend · frontend tsc 0 · build:safe 화면 · 백엔드 성공 · backend vitest 690파일 10,138건 전부 통과(단독 실행). 다른 전체 시험과 겹쳐 돈 회차의 실패는 전부 10~36초 시간 초과였다.

### §8-3 배포 때 낼 것(「배포 시작하자」 때 하나씩 · DDL 0 예정) — ★1026 배포 전 확인 = `sns_media.ai_declared` 있음(boolean · 기본 false · Harold 실행) · 배포 완료(Harold 보고) · 아래 「배포 뒤 확인」이 남은 실측
- 배포 전 = `sns_media.ai_declared` 칸 존재(information_schema · D4 가 처음 쓴다 · 읽기 SQL 은 전부터 있었다) · 없으면 D4 주소가 503 DB_MIGRATION_PENDING 으로 답한다(그 밖 동작 무관).
- 배포 = 백엔드 → 화면(build:safe · 업무 시간 밖) · 정리 워커는 기동 직후 1회 · 그 뒤 1일 1회(게시본 7일 · 원본 90일).
- 배포 뒤 확인 = 전역 처리기 업로드 오류(큰 파일 1건 = 400 문장) · SNS 담당자 계정으로 목록 · 소재 고르기가 자기 것만인지 · 페북 · X 연동 = §4-2.

## §6 추가 과제 (축 밖 · 기록만)
- 스튜디오 결과 카드 채널 버튼에 SNS 가 없다(인앱 · DM · 이메일만 · 「만들고 → 내보내는」 동선이 SNS 에서 끊김).
- 파이썬 스튜디오 서비스 = 단일 스레드 · 노드 60초 상한 → 여러 회사 동시 누끼에서 대기 · 시간 초과 가능(측정 0 · 측정 후 처방).
- SNS 삭제 감지 = 전 회사 합쳐 30분 30건(사용이 늘면 덮는 범위가 준다 · 설계 선택).
- 인스타 사진 폭 하한(320px · 0917 §1-1) 판정 0(작은 사진 = 플랫폼 거절 가능 · 미검증).

## §7 진행표

| 단계 | 상태 |
|---|---|
| 읽기 · 결함 · 덮음표 | 됨 1026 |
| 처방 설계안 · 결정 D1~D4 | 됨 1026 · Harold 「끝까지 구현하고 닫은다음에 코덱스적대리뷰까지」 = 추천안으로 진행 |
| 구현 · 시험 · 변이 · Codex · build:safe | 됨 1026 · Codex 적대 5R approve(§8-4) · 배포 대기 |
| 배포 | 완료 1026(Harold 보고 · 배포 전 `sns_media.ai_declared` 있음 실측 · push 1차 = 시험 시간 초과로 막힘 → 시험 제한 60초 → 2차 push 성공 · pull · build:safe · reload = Harold · 서버 확인 출력은 이 세션에 없음) · 배포 뒤 확인 = §8-3 |
| 페북 · X 연동(§4-2) | 대기 |
| 틱톡 설계서 | 대기(§4-3) |
