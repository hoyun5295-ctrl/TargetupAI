# SNS 채널 설계서 · 올릴 글 재설계 + 가장 편리한 채널 관리 + 페북·X 연동 계획 (2026-09-24)

> **발동** = Harold 0924 「AI로 캡션쓰기를 고객입장에서 편리하게 … 태그랑 AI 반반 … 자동으로 캡션으로 … AI 캡션쓰기 및 오타 검사기 … 브레인스토밍해서라도 완벽한 설계」 + 「가장 편리한 방법으로 SNS 채널 관리하는 부분들까지」 + 「페이스북이랑 X 는 연동계획」.
> **결정** = Harold 0924: Q1 가(끊겼을 때 예약은 기다림) · Q2 가(사진만 있을 때 AI 첫 글) · Q3 나(자주 쓰는 태그는 모두 켜진 채 시작) · 「바로 끝까지 구현」.
> **회의** = COLLAB §1 브레인스토밍 2회(5역할) · 교차 토론 2회 · 회의론자 최종 검증 2회(지적 56건 전부 반영). 회의 산출물 원문은 세션 작업 폴더에만 있다(여기 요지만 싣는다).
> **상설 SoT** = [FEATURE-SNS-CHANNEL.md](FEATURE-SNS-CHANNEL.md). 이전 설계 = [0917](2026-09-17-sns-publish-design.md) · [1b](2026-09-23-sns-1b-design.md). 문서와 코드가 다르면 현재 코드가 진실이다.

---

## 0. 운영 사실(이 설계의 출발점)

- 운영 게시 4건 모두 `sns_posts.tags = {}` · 인스타+Threads 두 채널 · 즉시 게시. 해시태그는 Harold 가 완성 글을 **본문에 붙여 넣은 것**이다(태그 칸 미사용).
- 증상 = 태그 칸에 넣은 태그가 글 칸(캡션)에 보이지 않는다. 구조상 칩은 저장 때 서버가 본문 뒤에 붙이고 화면 어디에도 조립본이 없다.
- 플랫폼 사실(2026-09-24 공식 열람): 인스타 해시태그 5개(Meta @creators 2025-12-18 · API 문서는 30) · Threads 게시물당 태그 1개(첫 유효 태그) · X 요금 글 $0.015 / 링크 포함 $0.200 / 읽기 $0.005 · X 개발자 정책 = 게시될 내용을 그대로 보여 줄 것 · 해시태그 추가는 명시 동의 · Meta 고객 개방 = 비즈니스 인증 → App Review(Advanced Access) → Access Verification.
- 공용 AI 함수는 이미 사진 입력을 받는다(`services/ai.ts` images). 0917 §9-11 보류 사유는 사실과 다르다.

## 1. 기존 결함(코드 읽기 확인 · 이번에 닫는다)

| # | 결함 | 근거 | 닫는 곳 |
|---|---|---|---|
| K1 | 형식 위반 칩을 서버가 말없이 버림 · 한글 조합 판정 없음 | SnsComposer 331·578 · sns.ts 506 | B-5 · B-3 |
| K2 | [다시 시도] 두 번 = 같은 글 두 번 게시 | sns.ts 699-726 · sns-view 138 | S1 |
| K3 | 게시 호출 뒤 확인 오류를 '실패'로 적음 | sns-publish-worker 320-346 | S2 |
| K4 | [연결 해제]가 예약을 남김(문구는 반대) · 재연결 시 옛 예약 게시 | SnsPage 156 · sns-accounts 227 | S4 |
| K5 | 예약 시각 시간대 없음 · 지난 시각 즉시 게시 | SnsComposer 360 · sns.ts 626·663 | S3 |
| K6 | SNS 라우트가 `user?.id`(JWT 는 `userId`)를 읽어 작성자·연결자 NULL | sns.ts 137·226·289·352·387·504 · auth.ts 8-14 | S0 |
| K7 | 둘째 계정이 끊겨도 카드 '연결됨' | SnsPage 245·250 | C5 |
| K8 | 즉시 게시도 '… 예정' 표시 | SnsHistory 129 · sns.ts 663 | E2 · S7 |
| K9 | AI 캡션 가짜 성공 · 본문 #태그 소실 · 혜택 자리표시 게시 | sns-caption-ai 67·111-123 | B-6 · B-4 |
| K10 | 태그 상한 인스타 30 · Threads 30 | instagram 55 · threads 50 | B-3 |
| K11 | X 게시 재검증이 코드포인트로 셈 | sns.ts 653 | A-0-1 |
| K12 | 다시 시도 성공 뒤에도 묶음이 '일부 실패' | sns-publish-worker 122 · sns-constants 86 | S6 |

## 2. 안전(배포 R1 · 자르지 않음)

- **S0** 사용자 id = `user?.userId` 6곳 · 정적 계약 'routes/sns.ts 에 user?.id 0'. 기존 NULL 행은 그대로(기본값은 수정 뒤 첫 게시부터).
- **S1** 다시 시도 CT `utils/sns-retry.ts` · 한 트랜잭션 · 문장 순서 고정: 옛 행 `FOR UPDATE`(잠금만) → **다음 문장**에서 같은 post·account 에 `(created_at,id)` 가 더 큰 행 수 → 있으면 409 `ALREADY_RETRIED` → 계정 `FOR SHARE` 로 active 판정(아니면 409 `action=reconnect`) → `PUBLISH_OUTCOME_UNKNOWN` 이면 409 → INSERT(`scheduled_at = GREATEST(원래, NOW())`) → COMMIT. 잠금 문장 안 EXISTS 금지. superseded 판정 SQL 조각과 화면 미러를 이 파일이 소유한다(계정별 최신 행 = `NOT EXISTS (… (n.created_at,n.id) > (t.created_at,t.id))`).
- **S2** 게시 호출 뒤: 게시 id 기록 뒤 오류 = `submitted`(lock 해제 · 대조 워커가 확인) · 게시 id 없이 publish_called 뒤 비결정 오류(네트워크·5xx) = `failed` + `PUBLISH_OUTCOME_UNKNOWN`(상태 추가 0 · 다시 시도 잠금 · [채널에서 확인]) · 좌초 회수도 게시 id 없으면 같은 모양 · 4xx 확정 거절은 그대로.
- **S3** 예약 시각 CT `parseSnsScheduleAt`(utils) = ISO + 오프셋 · 60초 넘게 지난 시각 400 `SCHEDULE_IN_PAST` · /posts·/publish·reschedule 공용 · 화면은 공용 DateTimeField(선택 prop `title` 추가만) + 오늘 지난 시각 화면 잠금.
- **S4** 해제 = 계정 UPDATE → 다음 문장에서 그 계정 scheduled → cancelled(같은 트랜잭션) · 확인 창에 건수(`waitingScheduled`).
- **S6** 묶음 상태 = GET /posts 가 계정별 최신 행만 모아 `derivePostStatus` 로 **읽을 때 파생**(sns_posts.status 읽는 곳이 GET /posts 한 곳) · 쓰는 쪽 불일치는 BUGS.
- **S7** 즉시 게시는 `sns_posts.scheduled_at = NULL`(target 은 지금처럼 NOW) · 화면 시각은 target 기준.

## 3. 페이스북·X(A-0 = R1 · 나머지 = 운영 절차)

- **A-0-1** 게시 재검증 = `countSnsCaption(caption, captionCounting)`.
- **A-0-2** 채널별 회사 게이트: `companyListAllows(companyId, raw)`(기본값 없는 순수 파서 · `snsPublishEnabled` 가 이를 감쌈) · `snsChannelAvailable(adapter, companyId, env)` · `SNS_FACEBOOK_PAGE_COMPANY_IDS` · `SNS_X_COMPANY_IDS`(비면 닫힘 · `*` 전체) · 인스타·Threads 는 이 ENV 무관 · 호출부 = specs(overview·/specs) · auth/start · /posts · 발행 워커 · 계약 3파일 갱신.
- **A-0-3** 칩·카드 계정 이름 `snsAccountName`(@username → displayName → '이름 없음' · 같은 채널 같은 이름이면 연결일 구분자).
- 운영 절차·자사 실측 6건·고객 개방 3단계·X 비용(2차) = FEATURE §6·§7 과 0924 회의 요지(보고 원문)를 따른다.

## 4. 올릴 글(R2)

- **B-1 배치**: `md:grid-cols-2` · 왼쪽 = [AI로 캡션 쓰기](`OUI_BTN_AI` 신설) · [맞춤법 검사] · 글 상자(textarea + 꼬리) · 게이지 · 결과 · 오른쪽 = 태그 패널. 좁은 화면 = 글 → 태그 → 채널별 글.
- **B-2 조립본 보이기**: 꼬리(글 상자 안 · '올릴 때 글 끝에 붙어요' · 태그 줄 violet · AI 표시 회색 · 읽기 전용 · 누르면 태그 입력칸) · 꼬리·카운터 기준 = 칩 예산(maxTags − 본문 태그 수)이 가장 큰 채널 · 켜진 칩이 꼬리에 없으면 칩에 사유('글에 이미 있어요' · '인스타그램에 안 실려요') · 채널별 글(올리기 바로 위 · 아코디언 · 탭 0) = 실제 게시 문자열만 pre-wrap · 모두 같으면 한 줄 '인스타그램 @a · Threads @b 두 곳 모두 이 글 그대로 올라가요' · 넘침·빠진 태그·X·같은 채널 계정 2+ 이면 펼침(X 는 접을 수 없음). 꼬리·게이지·채널별 글·올리기 잠금은 **미러 결과 하나**로만(409 서버 확정본 상태만 예외).
- **B-3 캡션 CT**(`sns-caption-rules.ts` · 화면 미러 `sns-view.ts` · 표 계약): `checkSnsTag`(사유: 허용 글자 밖 · 숫자만 · 자모만) · `extractBodyHashtags`(checkSnsTag ok 인 것만 · 대소문자 무시 고유 · URL 조각 제외) · `buildSnsCaption` 확장(`bodyTags` · `alreadyInBody` · 칩 예산 · `bodyTagsOver`(인스타만 경고 · Threads 제외) · `placeholderLeft`(message-placeholders 규약 서버 이전) · AI 표시 이중 부착 방지(NOTICE_TAIL_RE)) · 상한 인스타 5 · Threads 1 · 페북 30·X 10 근거 없음 주석 · 상한 변경은 새 저장부터(예약·재시도는 굳은 확정본).
- **B-4 저장**(S5 와 한 몸): /posts = composeId 대조 → replacesPostId 판정 → TAG_INVALID·CAPTION_NOT_OK(넘침·자리표시)·S3 → expected 대조(선택 필드 · 다르면 409 `CAPTION_CHANGED` + 서버 확정본 · 채널 집합이 다르면 409 `ACCOUNT_STATE_CHANGED`) → 한 트랜잭션 INSERT·예약. composeId: post id = uuid v5(company·user·composeId) · target id = uuid v5(post·account) · 같으면 200 existing · 내용 다르면 409 `COMPOSE_ALREADY_SAVED`. 계정은 `FOR SHARE`. 화면 409 처리·composeId 재생성 규칙은 §8.
- **B-5 태그 패널**: 입력칸 전폭 + [추가] · 입력칸만 감싼 form onSubmit · isComposing/229 무시 · 구분자(공백·쉼표·#)는 onChange 값으로 · 붙여넣기 쪼개기 · 형식 미러로 입력 순간 거절(글자는 칸에 남기고 사유 한 줄) · 칩 = 켜짐(직접 · 자주 쓰는 태그 · AI 가 켬 Sparkles) · 꺼짐(누르면 켜짐) · **Q3 나: 저장해 둔 자주 쓰는 태그는 새 글마다 모두 켜진 채 시작 + [모두 끄기]** · 1클릭 [자주 쓰는 태그에 저장](칩 옆 · 글 속 태그 줄) · 제자리 [편집](세트 칩 x = 세트에서 빼기) · 씨앗(세트 비었을 때) = 이 회사 지난 글 tags ∪ 본문 #태그 빈도 상위 10(AI 0) · 서버 PATCH /tag-set {add?, remove?}(pool.connect · FOR UPDATE · jsonb_set · 상한 50 · PUT 도 상한) · GET 은 invalid[] 동봉(말없이 삭제 0) · 이름 '자주 쓰는 태그'.
- **B-6 AI 캡션**: 모드는 서버가 정함 = 글 있음 → 다듬기 · 글 없음 + 사진 → **사진 초안(Q2 가)** · 영상만/둘 다 없음 → 잠금 + 사유. 요청 `{body, tags, mediaIds?, action('write'|'again'|'fit'), previous?, fitPlatform?}` · 응답 기존 필드 + `mode` · `changed`. 사진 = 회사 조건 재조회 · 영상 제외 앞 3장 · sharp 축소 → images(공용 함수 수정 0). 가드: extractJsonFromAiText · 끝 태그 줄 분리 후 재부착 · 문장 속 #태그·링크·맨 도메인·금액·혜택 덩어리(findBenefitSpans export)를 `{{k#}}` 로 가림 · 잃으면 폐기 · 결과 URL ⊆ 원문(호스트 소문자) · 원문에 없던 #태그 제거(원문에 낱말이 있으면 # 만) · stripUnauthorizedBenefits · 맞춤법 교정 한 줄 · AiRateLimitExceeded 429. 사진 초안 가드 = 결과에서 숫자·URL·혜택·행사/사실 낱말 든 문장 제거 → 짧으면 결과 없이 '한 줄만 써 주시면 다듬어 드릴게요' · 재생성 0 · 글에 AI 표시 0. again = 면허는 aiBase(AI 직전 사용자 글) · previous 는 같은 토큰 표로 가리고 피할 안으로만 · 캐시 키가 바뀐다. 화면: 즉시 적용 · 요청 중 readOnly + 오버레이 · 보낸 글과 다르면 넣지 않음 · 표시 모드(추가 violet · 지운 곳 N · 1,500자 넘으면 생략 · 누른 자리로 편집 전환) · [원래 글로] 맞바꿈 · [다시 쓰기] · 넘칠 때만 [X 길이에 맞게 줄이기].
- **B-7 맞춤법 검사**: 버튼만 · CT `utils/sns-spell-check.ts` · POST /api/sns/typo-check {body} → {bodyHash, issues[{id,start,end,before,after,kind,reason}]} · 위치는 서버가 계산(before 가 원문에 정확히 1번일 때만 · 공통 앞뒤를 자른 최소 변경 구간으로 판정) · 버림 = 보호 구간(URL·금액·%·#태그·@계정·회사명·자주 쓰는 태그) · after 에 새 숫자·URL·혜택 · spacing 인데 공백 외 차이 · typo 편집 거리 > max(2, 30%) · 같음 · 20자 초과(코드포인트) · 겹침 · 20개 초과. 화면 목록 · [고치기][그대로 두기][모두 고치기] · setSelectionRange · 고친 뒤 뒤쪽 행 오프셋 이동 · 사용자 직접 편집 때만 결과 지움 · 요청 중 로딩 장치 · 0건 '고칠 곳을 찾지 못했어요'. 엔진 = 자사 AI 경로(결정성 약속 0).
- **B-8 AI 표시 판정**: 헬퍼 = `ai_declared OR (asset_id 있음 AND (소재 행 없음 OR kind='generated'))`(모르면 붙임) · /posts·미디어 응답 공용 · 변경 사항: 직접 올려 둔 소재에는 더 이상 붙지 않는다 · 직접 올린 AI 사진 선언 체크는 2단계.

## 5. 연결 관리(R3)

- **C1 확인할 것 띠**: 서버 CT `utils/sns-attention.ts` → overview.attention(최대 3 + total · GET /posts 도 함께 실음). ① 다시 연결 = status ∉ {active, revoked}(끊김 '연결이 끊겼어요' · pending 10분 '연결 확인이 끝나지 않았어요' · ineligible '지금 올릴 수 없는 계정이에요. {사유}' · 기다리는 예약 수) ② 연장 실패(active ∧ meta.refresh_error ∧ 만료 7일 이내 · 재연결 때 refresh_error 삭제) ③ 올리지 못한 글(최근 7일 · 최신 행 · 끊김 사유는 ①로 · 그 뒤 같은 계정에 같은 본문/사진 글이 있으면 제외) ④ 올라갔는지 확인 필요(PUBLISH_OUTCOME_UNKNOWN ∨ verify_gave_up_at · 7일). 버튼 [다시 연결] · [보기] · [채널에서 확인](snsChannelUrl · 없으면 0).
- **C2 다시 연결 1탭**: 누르는 순간 빈 창 → reconnect 응답(platform 유지 + authorizeUrl·stateNonce 추가 · CT startSnsAuth 공용) → 주소 · 실패 시 창 닫고 토스트.
- **C3 기다림(Q1 가)**: 토큰 워커·권한 회수 콜백의 '미리 닫기' UPDATE 제거 · 발행 워커가 게시 직전 계정 재확인으로 닫음 · 재연결 = 같은 행 → 원래 시각에 게시 · 띠 ①과 예약 행 blockedReason.
- **C4 카드 파생값**: renewFailing · waitingScheduled · stuck · '자동 연장'은 renewFailing 거짓일 때만 · Threads 에는 '자동 연장' 0.
- **C5 채널 카드**: 가장 나쁜 계정 배지(snsChannelSummary) · 컨테이너 안 형제 버튼 2(머리 = 채널 창 · 아래 = 주 동작 1) · 모바일 2열 · 준비 중 = opacity 제거 + 점선 + 능력 줄 + '지금은 연결할 수 없어요'.
- **C6 작성 칩**: 끊김 = amber '다시 연결'(누르면 C2) · ineligible = '계정 확인 필요' · 선택 불가 · 전부 끊겨도 작성 구역 유지(올리기 잠금 + 사유).

## 6. 매 게시 기본값·예약·기록(R2·R4·후속)

- **D1 채널 기본값**: overview.defaults.accountIds = 이 사용자 최근 게시(target 이 전부 cancelled 인 글 제외 · 상태는 target 으로 판정) 계정 ∩ active ∩ 개방 ∩ X 제외 · 기록 없고 고를 계정이 1개면 그것 · 초기값 1회(복원된 초안이 있으면 적용 안 함) · 게시 뒤 유지 · 고지 줄은 선택이 기본값과 같을 때만 · 빠진 계정은 사유 줄 · 버튼 'N곳에 올리기/예약하기 · 시각'. is_default 미사용.
- **D2 태그 기본값(Q3 나)**: 자주 쓰는 태그 전부 켜진 채 시작 + [모두 끄기] · 본문과 같은 태그는 alreadyInBody 로 한 번만.
- **D3 글 속 태그 저장**: '글에 쓴 태그 5개 · 글 그대로 올라가요 · [자주 쓰는 태그에 저장]' · 모두 세트에 있으면 '자주 쓰는 태그에 있어요'.
- **E1 목록**: GET /posts = {upcoming(최신 행 scheduled ∧ post.scheduled_at 있음 · 오름차순 · 상한 200), posts(upcoming 과 여집합 · 최근 50 · REPLACED 묶음 제외 · 전부 draft 묶음 제외), attention} · 블록 '예약 N'(날짜 머리) → '올린 기록'.
- **E2 행**: 썸네일(GET /media/:id?thumb=1 · 96px · 사진만) · 시각 줄 = target 상태 · 계정 이름 · 펼침 = 채널별 확정본.
- **E3 사유별 버튼**(서버 CT `snsFailureAction` · 미러): reconnect · retry_at(다시 예약 · 원래 시각) · publish_now(지금 다시 올리기) · check(채널에서 확인 + 불러와서 쓰기 · '이미 올라갔을 수 있어요') · rewrite(불러와서 쓰기).
- **E4 시각 바꾸기**: POST /posts/:id/reschedule · NOWAIT(55P03 → 409) · 최신 행 전부 scheduled 아니면 409 · scheduled_at·next_attempt_at=NULL·컨테이너 비움 · 건수 대조 · post.scheduled_at 갱신.
- **E5 예약 취소**: ConfirmModal · 되살리기 전이 없음.
- **E6 글 고치기**: 글·태그·시각만(사진·채널 잠금) · /posts replacesPostId · 409 REPLACE_TARGET_GONE → 글 유지·교체 해제·[새 글로 올리기] · 옛 계정 중 끊긴 것이 있으면 버튼 잠금 · 쓰던 글이 있으면 확인 창 · [그만 고치기] = 비움.
- **E7 불러와서 쓰기**: 게시·실패·취소 행 · body 원문·tags·media·계정(active ∩ 개방 ∩ X 제외) · POST /media/lookup(회사 조건 · {media, fits, aiNotice} · 영상 재판독) → appendMedia · 같은 글이면 amber 한 줄.
- **E8 폴링**: 진행 중(claimed ∨ 확인 대기 submitted) 또는 10분 안 예약 · 다음 예약 −10분 타이머 + visibilitychange.
- **쓰던 글 보존**: localStorage `sns-compose:v1:{companyId}:{userId}` · body·tags·mediaIds·selected·scheduledAt(미래만)·composeId·replacesPostId · AI 상태 제외 · 1초 debounce · 성공 시 삭제 · 7일 · 로그아웃·401 처리에서 삭제(함수 하나) · 복원 전 composeId 파생 post 가 이미 있으면 복원하지 않음.

## 7. 화면 순서(R4)

확인할 것 띠 → 올리기 → 예약과 기록 → 채널 카드(접지 않음). 연결 계정(active·끊김) 0개면 카드가 맨 위이고 올리기는 그리지 않는다.

## 8. 화면 쪽 409 · composeId 규칙

- CAPTION_CHANGED: 채널별 글·꼬리를 서버 확정본으로 덮고 '서버 확정본' 상태 · overview 재조회 · 다음 누름 expected = 그 확정본 · 본문·칩·미디어·채널이 바뀌면 미러로 복귀.
- COMPOSE_ALREADY_SAVED: 글 유지 · '이 글은 이미 저장됐어요 · 고친 내용은 반영되지 않았어요 [보기]' · 버튼 [새 글로 올리기](그때만 composeId 새로).
- composeId 새로 만드는 때 = 성공 뒤 · [비우기] · 불러와서 쓰기 · 글 고치기 시작 · 다른 탭 성공(storage 이벤트).

## 9. 배포 단위와 순서

R1 = S0~S7 · A-0 · GET /posts 채널 줄 확장(accountId·accountName·scheduledAt·caption·superseded·action) · draft 묶음 숨김 · 좌초 회수 결과 모름.
R2 = B-1~B-8 · S5 · D1 · D3 · D2.
R3 = C1~C6.
R4 = 화면 순서 · 카드 개편 · E1~E3 · E5 · E8.
그다음 = E4 → E6 → E7 → 쓰던 글 보존(자를 때는 뒤에서부터 · E7 을 자르면 E3 rewrite 줄은 '글을 고쳐 새로 올려 주세요').
1단계 전체 = 새 컬럼·테이블·워커·권한 0.

## 10. 배포 전 확인(Harold)

1. 기본 키·제약: `SELECT conrelid::regclass, conname, contype, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('sns_posts'::regclass,'sns_post_targets'::regclass,'sns_media'::regclass);` (composeId ON CONFLICT(id) 전제)
2. 예약·실패 중인 target: `SELECT platform, status, count(*) FROM sns_post_targets WHERE status IN ('draft','scheduled','failed') GROUP BY 1,2;`
3. 게시 호출 뒤 결과 모름 후보: `SELECT id, status, last_error_code FROM sns_post_targets WHERE stage='publish_called' AND platform_post_id IS NULL AND status IN ('submitted','failed');`
4. 자주 쓰는 태그 현황: `SELECT id, brand_kit->'sns_tag_set' FROM companies WHERE brand_kit ? 'sns_tag_set';`

## 11. 2단계 이후 · 버림 · BUGS

- 2단계: 인스타 좋아요·댓글(새 컬럼 · 확인 경로 fetchPost 에 필드 추가 금지) · 끊김·실패 문자 알림 · 빠른 시각 칩 · 서버 초안 · 채널별 따로 쓰기(X 개방 때) · 사진·채널까지 바꾸는 고치기 · 같은 글 두 번 예약 경고 · 월 달력 · 다른 계정 로그인 안내 · Threads 90일 권한 표시 · 직접 올린 AI 사진 선언 체크.
- 3단계(고객 개방 심사와 함께): 인사이트 권한 · 추천 시간.
- 버림: 톤 고르기 · 게시 직전 확인 창 · AI 태그 후보 · 큐 슬롯 · 끌어 옮기기 · xl sticky 칸 · 취소 되살리기 전이 · 본문 태그 '옮기기'.
- BUGS 등재: DM 브랜드킷 저장이 읽기 실패 때 brand_kit 전체를 기본값으로 덮음(dm-brand-kit.ts 72-74·103-111) · post 상태 쓰는 쪽 7곳 불일치 · routes/admin.ts `user?.id` 3곳(슈퍼관리자 토큰 형태 별도 확인) · X 월 상한이 결과 모름 행을 세지 않음 · sns-constants 51행 'stage 는 읽지 않는다' 주석과 대조 워커 불일치.

## 12. 이력

| 날짜 | 무엇 |
|---|---|
| 0924 | 브레인스토밍 2회 · 설계 확정 · Q1 가 · Q2 가 · Q3 나 |
| 0924 | **R1~R4 + 그다음(E4·E6·E7·쓰던 글 보존) 전량 구현** · DDL 0 · tsc 0(백·프) · vitest 362파일 5,562건 · build:safe 통과 · 미배포 · BUGS B-0924-2~7 |
