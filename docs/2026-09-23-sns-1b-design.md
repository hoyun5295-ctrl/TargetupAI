# SNS 1차-B 설계서 · 착수 원장 (2026-09-23)

> **이 문서가 소유하는 것** = SNS 채널 1차-B(영상 + 페이스북 페이지 + X)의 범위·결정·파일별 변경·실측 시나리오.
> **상설 SoT** = [FEATURE-SNS-CHANNEL.md](FEATURE-SNS-CHANNEL.md). **1차 설계** = [2026-09-17-sns-publish-design.md](2026-09-17-sns-publish-design.md)(불변 §2 20개는 그대로 유지한다).
> **발동** = Harold 0923 「1차-B 설계안 제대로 만들고 아예 구현까지 끝내도록하자」. 직전 질문 「영상은 어떻게 올리냐? 영상도 올릴 수 있잖아?」.
> 두 문서와 코드가 다르면 **현재 코드가 진실**이다.

---

## 0. 한 줄

영상 한 개를 올리면 고른 채널마다 그 채널 방식으로 각각 올라간다(인스타 = 릴스 · Threads = 영상 게시물 · 페이스북 페이지 = 페이지 영상 · X = 영상 첨부 글). 채널은 둘이 새로 열린다(페이스북 페이지 · X). 영상은 **다시 인코딩하지 않는다.**

---

## 1. 축 대조표 (접수 전수 · 이 축이 없으면 닫히는가)

0917 설계서 §5 1차-B 행 원문 = `MP4 업로드·Range 서빙·ISO-BMFF 파서(3파일) · instagram 릴스(asyncContainer) · facebook_page 어댑터(Facebook Login · 사진·영상) · x 어댑터(metered · upload · verify:'deferred' · 월 상한 fail-closed · 링크 고지)`.

| # | 항목 | 없으면 |
|---|---|---|
| A1 | 영상 업로드(조각) | 영상이 서버에 못 들어온다. nginx 본문 상한(OPS 50M · 강화안 5M)에 300MB 가 막힌다 |
| A2 | 영상 판독 CT(ISO-BMFF) | 길이·비율·코덱을 모르고 보내 채널이 몇 분 뒤 거부한다 |
| A3 | 영상 Range 서빙 | Meta 가 영상을 가져가지 못한다 |
| A4 | 인스타 릴스 | 접수 원문(영상) 자체 |
| A5 | Threads 영상 | 같은 화면에서 인스타만 되고 Threads 는 막히면 "한 번 쓰면 갈라진다"가 깨진다 |
| A6 | 페이스북 페이지 어댑터 | 1차-B 원문 |
| A7 | X 어댑터 + 월 상한 | 1차-B 원문 |
| **발견 D1** | **비동기 컨테이너 재개 경로** | 처리 5분을 넘긴 컨테이너는 발행 워커(`scheduled` 만 선점)도 대조 워커(`platform_post_id` 있는 것만)도 줍지 않아 **영구히 「올리는 중」**. 릴스는 반드시 밟는다 |
| **발견 D2** | **게시본 파일이 target 하나에 한 장** | `{targetId}.jpg` 를 사진마다 덮어써 **캐러셀이 마지막 사진 N장으로 나간다**(1차-A 결함 · 실측 전). 영상 서빙 때문에 미디어별 서빙으로 어차피 바뀌는 자리 |
| **발견 D3** | **컨테이너 ERROR 무한 재생성** | 상한 없이 2분마다 새 컨테이너. 코덱 거부 영상이 인스타 컨테이너 한도(24시간 400)를 태운다 |
| B1 | 연결 구조 확장(PKCE · 로그인 1회 = 계정 N) | X(PKCE 필수)·페이스북(로그인 1회에 페이지 N개)이 연결되지 않는다 |
| B2 | 채널별 미디어 수용 판정 | X 는 사진 4장·영상 단독, 인스타는 글만 불가. 판정이 없으면 워커에서 실패한다 |
| B3 | X 글자 가중치 | X 는 한글·이모지를 2자로 센다(280 가중). 우리 게이지가 1자로 세면 통과시킨 글을 X 가 거부한다 |
| B4 | 사용 직전 토큰 갱신 | X 액세스 토큰은 2시간이다. 6시간 워커로는 게시 시점에 이미 만료다 |

**범위 밖(기록만 · 착수 판단 = Harold)**: §10.

---

## 2. 플랫폼 사실 (공식 문서 · 2026-09-23 열람 · **raw 전**)

⛔ 불변 19 = 필드명은 raw 로 확정한다. 아래는 **문서 기준**이며, 어댑터 주석에 같은 표기를 남기고 실측(§8)에서 다르면 그 블록만 고친다(Threads 게시 경로와 같은 처리).

| 채널 | 확인 사실 | 출처 |
|---|---|---|
| 인스타 릴스 | 컨테이너 `POST /{id}/media` + `media_type=REELS` + `video_url` (+ `caption` · `share_to_feed` · `thumb_offset`) · 상태 `status_code` = `EXPIRED`·`ERROR`·`FINISHED`·`IN_PROGRESS`·`PUBLISHED` · "상태는 분당 1회, 5분 이내로 조회 권장" · 24시간 100건 | developers.facebook.com/docs/instagram-platform/content-publishing |
| 인스타 릴스 규격 | MOV·MP4 · **moov atom at the front · no edit lists** · HEVC 또는 H264 · AAC 48kHz · 23~60fps · 가로 최대 1920 · 비율 0.01:1~10:1(9:16 권장) · **3초~15분 · 300MB** | …/instagram-graph-api/reference/ig-user/media |
| Threads 영상 | `media_type=VIDEO` + `video_url` + `text` · 게시 전 평균 30초 대기 권장 · 상태 `GET /{container}?fields=status,error_message` = `EXPIRED`·`ERROR`·`FINISHED`·`IN_PROGRESS`·`PUBLISHED` · `error_message` = `FAILED_DOWNLOADING_VIDEO`·`FAILED_PROCESSING_VIDEO`·`INVALID_DURATION`·`INVALID_ASPEC_RATIO`(원문 철자)·`INVALID_FRAME_RATE` 등 | …/docs/threads/posts · …/threads/troubleshooting |
| Threads 규격 | MOV·MP4 · moov 앞 · HEVC/H264 · **최대 5분 · 1GB** · 가로 1920 · 비율 0.01:1~10:1 · 캐러셀 2~20 | …/docs/threads/overview |
| 페이스북 로그인 | `https://www.facebook.com/v{N}/dialog/oauth` · `GET https://graph.facebook.com/v{N}/oauth/access_token`(code 교환) · 장기 교환 `grant_type=fb_exchange_token`(약 60일) · **장기 사용자 토큰으로 받은 페이지 토큰은 만료일이 없다** | …/facebook-login/guides/advanced/manual-flow · …/access-tokens/get-long-lived |
| 페이스북 페이지 게시 | 글 `POST /{page}/feed` + `message` · 사진 `POST /{page}/photos` + `url` + `caption` → `{id, post_id}` · 여러 장 = 사진마다 `published=false` 뒤 `/feed` + `attached_media=[{media_fbid}]` · **사진과 영상을 한 글에 섞을 수 없다** · 영상 `POST /{page}/videos` + `file_url` + `description` · 권한 `pages_show_list`·`pages_read_engagement`·`pages_manage_posts` · 글 주소 `permalink_url` | …/pages-api/posts · …/graph-api/reference/page/photos · …/page/videos · …/pagepost |
| X 연결 | `https://x.com/i/oauth2/authorize` + **PKCE**(`code_challenge` S256) · 토큰 `POST https://api.x.com/2/oauth2/token`(기밀 클라이언트 = Basic 인증) · **액세스 토큰 2시간** · `offline.access` 로 refresh token | docs.x.com/…/oauth-2-0/authorization-code |
| X 게시 | `POST /2/tweets` `{text, media:{media_ids}}` · 사진 `POST /2/media/upload`(`media_category=tweet_image`) · 영상 조각 `initialize → append(5MB 이하) → finalize → STATUS` · 사진 최대 4장 · **영상과 사진 혼합 불가** · 사진 5MB · 영상 0.5초~20분 · 비율 1:3~3:1 · H264 권장 | docs.x.com/x-api/media/… |
| X 요금 | **글 1건 $0.015 · 링크 포함 $0.200 · 글 읽기 건당 $0.005 · 사용자 읽기 $0.010** · 무료 구간 0 · 선불 크레딧 · 콘솔에 청구 주기별 지출 상한 | docs.x.com/x-api/getting-started/pricing |
| X 글자 수 | 280 가중 · **CJK·이모지 2** · URL 23 · NFC 정규화 | docs.x.com/…/counting-characters |

---

## 3. 설계 결정

### 3-1. 영상 원칙
1. **한 게시물에 영상 1개 · 사진과 섞지 않는다(1차-B).** 근거 = 페이스북·X 가 혼합을 받지 않고, 인스타 릴스는 단일 영상이다. 섞는 캐러셀은 2차.
2. **다시 인코딩하지 않는다**(불변 13 "MP4 는 변환 0"). 코덱·비트레이트는 바꾸지 않는다.
3. **예외 하나 = moov 앞당김(무손실).** 인스타·Threads 규격이 "moov atom at the front" 를 요구한다. 휴대폰 촬영본은 moov 가 뒤에 있는 경우가 흔하다. 상자 순서만 바꾸고 청크 위치표(`stco`·`co64`)를 그 길이만큼 밀어 준다. **영상·음성 바이트는 한 바이트도 바뀌지 않는다.** 업로드 완료 시 한 번 하고, 앞당긴 파일을 보관본으로 쓴다(원본을 따로 두지 않는다 · 같은 내용이다).
4. 압축된 moov(`cmov`)는 앞당기지 못한다 → 그 사유로 거절.

### 3-2. 업로드 = 4MB 조각 (A1)
- nginx 본문 상한을 바꾸지 않는다(서버 설정 변경 0 · 가이드 전역 5M 에도 통과).
- `POST /api/sns/media/uploads` `{name, bytes}` → 확장자 `.mp4`·`.mov` · **300MB 이하**(인스타 상한 = 채널 중 가장 작다) → `{uploadId, chunkBytes: 4MB}`.
- `PUT /api/sns/media/uploads/:id/chunks/:index`(`application/octet-stream` · 라우트 한정 raw 파서 5MB) → **순서대로만** 받는다(`index × 4MB = 지금 받은 크기`). 같은 조각을 다시 보내면 이미 받은 것으로 200.
- `POST /api/sns/media/uploads/:id/complete` → 크기 일치 확인 → 판독(A2) → 필요하면 moov 앞당김 → 보관 → `sns_media(kind='video')` → 채널별 판정(`fits`).
- 세션 = `uploads/sns-media/_incoming/{companyId}/{uploadId}.part` + `.json`(회사·사용자·총 크기). **메모리 상태 0**(재시작·다중 프로세스에서도 이어진다). 6시간 지난 조각은 다음 시작 때 치운다.

### 3-3. 판독 CT `utils/sns-video-probe.ts` (A2 · 순수 + 파일 읽기)
- 최상위 상자 순회(32·64비트 크기 · `size=0`) → `ftyp` 브랜드 · `moov` 위치와 `mdat` 위치 → `fastStart`.
- `mvhd` → 길이(초) · 첫 영상 `trak` 의 `tkhd` 폭·높이 + 행렬 → **회전 반영 표시 크기** · `stsd` 첫 항목 → 영상 코덱 표식(`avc1`·`avc3` = H264 / `hvc1`·`hev1` = HEVC) · 음성 표식(`mp4a`) · `mdhd`+`stts` → 초당 프레임.
- 못 읽은 값은 `null`(모름 ≠ 불합격 · 판정은 모르는 값으로 막지 않는다).
- `relocateMoovToFront(in, out)` = 3-1 의 3번. `moov` 만 메모리에 올리고 나머지는 스트림 복사.

### 3-4. 채널별 수용 판정 (B2 · `sns-media-fit.ts` 확장)
- 어댑터 capabilities 에 추가: `publishText` · `maxMediaCount` · `video{maxBytes, minSec, maxSec, aspectMin, aspectMax, maxWidth, codecs}` · `pollIntervalSec` · `tokenRefresh('scheduled'|'at_use'|'none')` · `captionCounting('chars'|'x_weighted')`.
- `snsMediaBlockReason(summary, cap)` = 글만·사진 수·영상 여부·혼합 → 막는 사유 한 문장(없으면 null).
- `planSnsVideoFit(probe, cap)` = 크기·길이·비율·가로·코덱 → `{accepted, notice}`.
- 저장(`POST /posts`)이 **서버에서 다시 판정**하고, 화면은 같은 규칙을 `sns-view.ts` 에 두어 칩을 미리 잠근다. 두 구현이 같은 표에 같은 답을 내는지 계약 테스트가 잠근다.

### 3-5. 게시본·서빙 (A3 · D2)
- 사진 게시본 파일명 = `{targetId}-{mediaId}.jpg`(미디어별). 영상 = **보관본 그대로**.
- `/api/sns/m/:token` 은 서명 속 `mediaId` 로 `sns_media` 를 읽어 사진이면 게시본, 영상이면 보관본을 `video/mp4`·`video/quicktime` 으로 보낸다. `res.sendFile` 이 Range 206 을 처리한다. 유효 판정(상태 결박 · 36시간 · 미디어 교체)은 그대로.

### 3-6. 발행 워커 (D1 · D3 · B4)
- 어댑터 요청 = `media[] {kind, url, absPath, mime, bytes}`(순서 = 게시 순서). 업로드형(X)은 `absPath` 로 파일을 올린다.
- **처리 확인은 tick 당 1회**(tick 안에서 10초씩 5분 붙들지 않는다). 준비 안 됐으면 `submitted` 그대로 두고 `next_attempt_at = 지금 + pollIntervalSec`.
- **재개 선점(D1)** = `scheduled` due + `submitted AND platform_post_id IS NULL AND container_id IS NOT NULL AND next_attempt_at <= NOW()`. 게시 직전 기록에서 `next_attempt_at = NULL` 로 비워 **게시 호출까지 간 행은 재개 대상에서 빠진다**(`stage` 는 읽지 않는다 · 불변 7).
- **처리 상한** = 컨테이너 생성 30분 뒤에도 준비 안 됨 → `failed`(채널이 영상 처리를 끝내지 못함).
- **컨테이너 실패 상한(D3)** = `ERROR`·`EXPIRED` 3회째 → `failed` + 채널 사유(Threads `error_message` 는 한국어 문장으로 바꿔 보여 주고 원문은 `last_error` 에 남긴다).
- **사용 직전 토큰 갱신(B4)** = `tokenRefresh='at_use'` 채널은 만료 10분 전이면 게시 전에 갱신한다. 계정 행을 `FOR UPDATE` 로 잡고 갱신한다(X refresh token 은 1회용이라 두 곳이 동시에 쓰면 한쪽이 끊긴다). 토큰 워커는 이 채널을 건너뛴다.
- **X 월 상한(fail-closed)** = ENV `SNS_X_MONTHLY_POST_CAP`(정수). **비었거나 0 이면 X 는 열리지 않는다.** 이번 달(KST) X 게시 건수(`platform_post_id` 있는 행 · 전 회사 합산 = 우리 청구서)가 상한에 닿으면 게시하지 않고 사유와 함께 닫는다.

### 3-7. 채널별 어댑터
| 채널 | 연결 | 게시 | 확인 |
|---|---|---|---|
| 인스타 | 변경 0 | 영상 = `REELS` + `share_to_feed=true` · 사진 = 기존 · `asyncContainer` true | 기존 `fetchPost` |
| Threads | 변경 0 | 영상 = `VIDEO` + `video_url` · 상태 `status`+`error_message` | 기존 |
| 페이스북 페이지 | 로그인 → 장기 사용자 토큰 → `/me/accounts` → **페이지마다 계정 행 1개**(페이지 토큰 · 만료 0) · 글 작성 권한(`tasks` 에 `CREATE_CONTENT`)이 없는 페이지는 `ineligible` | 글 `/feed` · 사진 `/photos` · 여러 장 `published=false` 뒤 `/feed attached_media` · 영상 `/videos file_url` · 실제 게시는 `publish` 안에서만(부작용이 게시 직전 재확인 뒤에만 일어나게) | 글·사진 `permalink_url` · 영상 `status.video_status='ready'` 뒤 `permalink_url` |
| X | PKCE · `offline.access` · `/2/users/me` | 사진 `/2/media/upload` · 영상 조각 업로드(비공개 단계라 `createPost` 에서) → `POST /2/tweets` | **즉시 1건 확인으로 변경**(아래) |

**0917 `verify:'deferred'` → `immediate` 로 바꾼다.** 근거 = 공식 요금이 글 읽기 건당 $0.005 라 1건 확인이 싸고, 타임라인 대조는 읽어 온 글 수만큼 과금된다(100건 = $0.50). 삭제 감지는 30분마다 반복 과금이라 **실비 채널은 뺀다.**

### 3-8. 연결 구조 확장 (B1)
- 어댑터 선택 선언 `pkce: true` → `auth/start` 가 `code_verifier` 를 만들어 `sns_oauth_states.payload` 에 두고 `code_challenge`(S256)를 주소에 싣는다. 콜백은 1회용 소비(`DELETE … RETURNING payload`)로 꺼내 교환에 넘긴다.
- 어댑터 선택 메서드 `fetchAccounts(token)` → 로그인 1회에 계정 N개. 콜백이 N행을 `pending` 으로 저장하고 응답 뒤 각각 판정한다. 0개면 사유 창.
- 페이스북 권한 회수 콜백은 **사용자 id** 를 준다. 페이지 행은 `meta.owner_user_id` 로 찾는다(어댑터 선언 `deauthKey`).

### 3-9. 개방 판정
`available` = 어댑터 코드 준비 **AND** 자격 ENV 있음 **AND**(실비 채널이면 월 상한 > 0). 화면 카드·연결 시작·저장이 **같은 함수 하나**를 부른다. ENV 를 넣기 전에는 카드가 `준비 중` 그대로다(코드 배포만으로 고객에게 깨진 채널이 열리지 않는다).

### 3-10. 화면
- 파일 고르기 = 사진 + 영상(`.mp4`·`.mov`). 영상은 **1개 · 사진과 섞지 않음**. 고르는 즉시 브라우저가 길이·크기를 읽고 300MB 초과면 전송하지 않는다.
- 업로드 진행률(조각 수 기준) · 영상 칸 = 첫 프레임 + 재생 표시 + 길이.
- 채널 칩 = 이 미디어를 받지 못하는 채널은 잠기고 **칩 아래 사유 한 줄**(예: `X: 사진은 4장까지 올릴 수 있어요`). 이미 골라 둔 칩이 잠기면 선택에서 빠진다.
- 글자 게이지 = 채널마다 그 채널 방식으로 세고 **가장 빠듯한 채널**을 보여 준다(X 는 가중).
- 문구 = 모델명 0 · 줄표 0 · "잘린다" 0 · 성과 약속어 0.

---

## 4. 불변 (1차 §2 20개 + 1차-B 추가 5)

21. **영상 바이트는 바꾸지 않는다.** 허용되는 것은 moov 앞당김(상자 순서 + 위치표 보정)뿐이다.
22. **판정은 모르는 값으로 막지 않는다.** 판독이 못 읽은 값은 채널이 판단하게 둔다. 막는 것은 확인된 위반뿐이다.
23. **실비 채널은 상한 없이는 열리지 않는다.** 상한 ENV 가 비면 카드부터 `준비 중`.
24. **처리 대기는 워커를 붙들지 않는다.** tick 당 확인 1회 · 재개는 `next_attempt_at` 으로.
25. **1회용 refresh token 은 행 잠금 안에서만 쓴다.**

---

## 5. 파일별 변경 · 영향표

| 파일 | 변경 | 읽는 곳 · 영향 |
|---|---|---|
| `utils/sns/adapter.ts` | capabilities 6필드 · `SnsPublishMedia` · `media[]` · `pkce`·`fetchAccounts`·`deauthKey` · `buildAuthorizeUrl/exchangeToken/refreshToken` 선택 인자 | 어댑터 4 · 워커 3 · 라우트 · specs(화면) |
| `utils/sns/instagram.ts` · `threads.ts` | 영상 경로 · `media[]` 로 교체 · 상태 상세 | 워커만 |
| `utils/sns/facebook-page.ts` · `x.ts` | 스켈레톤 → 전체 구현 | 워커·라우트 |
| `utils/sns-video-probe.ts`(신규) | 판독 + moov 앞당김 | 업로드 완료 · 저장 판정 |
| `utils/sns-media-fit.ts` | `snsMediaBlockReason` · `planSnsVideoFit` | 라우트(저장·업로드 응답) |
| `utils/sns-media.ts` | 조각 세션 · 영상 보관 · 게시본 미디어별 파일명 · 서빙 경로 해석 | 라우트 · 워커 |
| `utils/sns-caption-rules.ts` | X 가중 글자 수 | 저장 · 화면 게이지(미러) |
| `utils/sns-availability.ts`(신규) | 개방 판정 1함수 | specs · auth/start · 저장 · 워커 |
| `utils/sns-publish-worker.ts` | D1·D3·B4·월 상한·media[] | 발행 |
| `utils/sns-reconcile-worker.ts` | 실비 채널 삭제 감지 제외 | 대조 |
| `utils/sns-token-worker.ts` | `tokenRefresh='scheduled'` 만 · refresh token 전달 | 토큰 |
| `utils/sns-accounts.ts` | 계정 N 저장 · 잠금 갱신 · 카드의 만료 표시 | 라우트 · 워커 |
| `routes/sns.ts` | 조각 업로드 3 · 저장 판정 · 콜백 PKCE·N계정 · 권한 회수 키 · 서빙 | 화면 |
| `frontend utils/sns-view.ts` | capabilities 타입 · 수용 판정 미러 · 가중 글자 수 미러 | 작성 구역 · 계약 테스트 |
| `frontend components/sns/SnsComposer.tsx` | 영상 선택·조각 업로드·진행률·칩 잠금·게이지 | 화면 |
| `frontend pages/SnsPage.tsx` · `SnsHistory.tsx` · `SnsChannelModal.tsx` | 문구(채널 이름 고정 제거 · 사진만 → 글 없음) · X 만료 표시 숨김 | 화면 |

**미디어 요청 형태 교체(`mediaUrls` → `media[]`) 소비처 전수** = 어댑터 2(인스타·Threads) + 워커 1 + 대조 워커 `buildRequest` 1. 이 넷 밖에서 읽는 곳 0(grep 증거는 구현 보고에 싣는다).

---

## 6. DB

**신규 컬럼·테이블 0.** 새로 쓰는 것은 **값**뿐이다: `sns_media.kind='video'` · `sns_post_targets.format='video'`. 0917 예정 DDL 에는 이 두 컬럼에 CHECK 가 없었지만 실행분은 미검증이라 **배포 전 확인 1회**(아래 SQL · Harold 실행). CHECK 가 있고 값이 빠져 있으면 그때 ALTER 1줄을 따로 낸다.

```sql
SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE contype = 'c' AND conrelid IN ('sns_media'::regclass, 'sns_post_targets'::regclass);
```

`duration_ms` 컬럼은 **쓰지 않는다**(판정은 파일을 다시 읽어서 한다 · 미검증 컬럼에 기대지 않는다).

---

## 7. Harold 선행 작업 (코드 밖)

| 채널 | 할 일 | ENV |
|---|---|---|
| 인스타·Threads 영상 | 없음(같은 권한 `instagram_business_content_publish`·`threads_content_publish`) | 없음 |
| 페이스북 페이지 | Meta 앱에 **Facebook 로그인** 이용 사례 추가 · 권한 3개(`pages_show_list`·`pages_read_engagement`·`pages_manage_posts`) · 리디렉션 `https://hanjul.ai/api/sns/auth/callback/facebook_page` · 권한 회수 `…/api/sns/deauthorize/facebook_page` · 한줄로 페이지 관리자 계정이 앱 역할 보유 | `FACEBOOK_PAGE_CLIENT_ID` · `FACEBOOK_PAGE_CLIENT_SECRET` · `FACEBOOK_PAGE_REDIRECT_URI` |
| X | 개발자 콘솔 앱(OAuth 2.0 · **Web App = 기밀 클라이언트**) · 콜백 `https://hanjul.ai/api/sns/auth/callback/x` · 크레딧 충전 · **콘솔 지출 상한**(우리 월 상한과 두 겹) | `X_CLIENT_ID` · `X_CLIENT_SECRET` · `X_REDIRECT_URI` · `SNS_X_MONTHLY_POST_CAP` |

---

## 8. 실측 시나리오 (배포 뒤 · Harold)

1. **릴스 1건** = 휴대폰 세로 영상(1080p · 30초 안쪽) → 인스타만 선택 → 업로드 진행률 → 이력 `올리는 중` 이 1~몇 분 뒤 `게시됨` → 인스타 앱 릴스 탭 확인.
2. **Threads 영상 1건** = 같은 파일 · Threads 만.
3. **moov 뒤 파일 1건** = 편집 앱을 거치지 않은 촬영 원본 → 업로드 완료 응답에 앞당김 여부 기록 → 1과 같은 결말.
4. **페이스북 페이지** = 연결 → 카드에 페이지 이름 → 사진 1건 → `게시됨` + permalink.
5. **X** = ENV 상한 2 → 연결 → 글만 1건 → `게시됨` → 사진 1건 → 3번째 글은 `이번 달 X 게시 한도` 로 막히는지.
6. **캐러셀 회귀(D2)** = 사진 3장 인스타 → 3장이 서로 다른 사진인지.

---

## 9. 미검증

① 영상 경로 필드 전부(§2 = 문서 기준) ② 페이스북 영상에 `publish_video` 권한이 추가로 필요한지(가이드 두 곳이 다르게 적는다 · 영상 거부 시 추가) ③ Graph 버전 문자열(`v26.0` · 레퍼런스 표기 · 로그인 예시는 `v25.0`) ④ 페이스북 영상 `file_url` 크기 상한(문서에 없음) ⑤ X 에 MOV(`video/quicktime`)가 통과하는지 ⑥ X refresh token 수명 ⑦ Meta 가 영상을 가져갈 때 Range 를 쓰는지(쓰든 안 쓰든 `sendFile` 이 처리) ⑧ 4K 세로 영상(가로 2160)이 인스타에서 실제로 거부되는지(규격 문구대로 막는다) ⑨ `sns_media`·`sns_post_targets` CHECK 제약 실행분(§6 SQL).

---

## 10. 범위 밖 · 별건 (기록만)

| # | 무엇 | 왜 이번에 안 하나 |
|---|---|---|
| 10-1 | 게시 호출 뒤 응답 유실 행(`publish_called` · `platform_post_id` 없음)이 `submitted` 에서 영원히 머문다 · 설계 §2-8 의 "사람 확인 1줄" 미구현 | 1차-A 부터 있던 경로 · 이번 변경은 이 행을 재개 대상에서 **빼기만** 한다 |
| 10-2 | `refreshPostStatus` 가 발행·대조 워커에 두 벌 | 인라인 중복 · 동작 동일 · CT 로 올리는 별건 |
| 10-3 | 사진·영상 혼합 캐러셀(인스타·Threads 는 지원) | 3-1 의 1번 |
| 10-4 | 페이스북 페이지 선택 화면(로그인 창에서 고른 페이지 전부가 연결된다) | 1클릭 원칙 · 로그인 창이 이미 고르게 한다 |
| 10-5 | 0917 §4-4 의 X 링크 실비 고지 | 1차 크레딧 값 0 이라 고객이 내는 비용이 없다. 고지 대상이 생기는 2차 크레딧 값과 함께 |
