# C145 공개 페이지 세션 끊김 닫기 + 공개 페이지 방문 기록 — 설계서

> 절차 = `status/DEFECT-PLAYBOOK.md` 3단계. 흐름 표 · 결함 장부 = `docs/2026-11-19-c145-public-session-visits-flow-ledger.md`(Harold 1119 「표 맞음 · 추천대로」).
> 범위 = 흐름 표 전체(D1 ~ D5 · N1) + Harold 승인 결정 셋(① 방문 기록 = 공용 장치 + 이번엔 JBN 에 켬 · 「JBN 회원」 탭 안 「방문 기록」 · 보이던 시간만 · IP 90일 ② 로그인 사용자용 부품은 공개 경로에서 숨김 ③ 로그인 시간(24시간) 끝 = 안내를 띄움).

## §0 미가입 · 직접발송만 쓰는 회사 증명 표(메모리 절대 원칙)

| 그 회사 사용자가 겪는 자리 | 지금 | 배포 뒤 | 근거 |
|---|---|---|---|
| 로그인 · 로그인 필요 화면 사용 · 발송 · 결과 | 그대로 | 그대로(발송 핵심 다섯 파일 무수정 · 로그인 판정 · 세션 만드는 문장 무수정 · 옛 세션을 끄는 문장만 원인 칸을 함께 씀 = 칸이 없으면 지금 SQL · 칸 확인은 부를 때마다라 되돌리기에도 안전) | §2-1 · §2-4 |
| 로그인 필요 화면에서 세션이 끊길 때 | 끊김 창 → 로그인 화면 | 같은 동작 · 문구만 원인대로(같은 계정의 다른 로그인 = 지금 문구 글자 그대로) | §2-4 |
| 24시간 지나 로그인이 끝날 때 | 안내 없이 로그인 화면 | 로그인 화면 + 「로그인 시간이 끝났습니다…」 안내(**Harold 승인 결정 ③ · 모든 회사 같은 변화**) | §2-5 |
| 공개 페이지(요금 · 소개 · 승인 링크 등)를 열었을 때 | 남은 로그인이 죽었으면 로그인 화면으로 튕김 | 그 페이지 그대로 · 로그인 정보만 지움 | §2-1 |
| 8시간 입력 없음 자동 로그아웃 | 로그인 필요 화면 = 로그아웃 + 로그인 화면 | 같음(공개 페이지에서는 로그아웃만 · 이동 0) | §2-2 |

## §1 뿌리

| 결함 | 뿌리 | 한 줄 |
|---|---|---|
| D1 · D2 · D3 · 결정 ② | **R99 신설** — 「경로를 모르는 로그인 장치」 | 로그인 끝 처리(통로 401 · 감시 · 시간 초과)와 로그인 사용자용 전역 부품이 공개 경로인지 묻지 않는다 · 끝 처리 판정이 세 벌(통로 · 감시 창 · 시간 초과) |
| D4 · 결정 ③ | **R56 넓힘** | 서버가 세션을 끈 원인 다섯(다른 로그인 · 계정 중지 · 회사 중지 · 로그아웃 · 만료) + 24시간 끝을 화면 문구 하나(또는 0)로 말한다 |
| D5 | **R1 넓힘** | 「밀어낸 로그인」 기록이 두 벌(고객사 = `utils/login-issue.ts` · 슈퍼관리자 = `routes/auth.ts`)이고 슈퍼관리자 쪽만 밀려난 IP 가 없다 |

## §2 처방

### §2-1 D1 · D3 — 공개 경로 판정 한 곳 + 로그인 끝 처리 한 곳(프론트)

- 새 CT `packages/frontend/src/utils/public-paths.ts`
  - `PUBLIC_PATHS` = App.tsx 공개 라우트 18 줄 글자 그대로(`'/journey-pause/:token'` 같은 자리 표시는 접두로 비교) · `isPublicPath(pathname)`.
  - 계약 K1 이 App.tsx 에서 `PrivateRoute` 없는 `<Route path=` 를 뽑아 이 목록과 **양쪽으로** 맞춘다(공개 라우트를 새로 만들면 목록에 안 넣으면 빨간불).
- 새 CT `packages/frontend/src/utils/session-end.ts` — 로그인 끝 처리의 유일한 자리(★설계 1R 지적 2 · 3 · 8 반영)
  - **판정은 순수 함수 하나** `decideSessionEnd(input)` — 입력 = `{ path, endedToken, sharedToken, tabToken, serverReason, sharedEnd, now }` · 출력 = `{ clearShared, tab: 'keep' | 'clear' | 'adopt', reason, navigate }`. 브라우저 일(지우기 · 따르기 · 이동 · 저장)은 바깥 껍데기 `endClientSession` 이 이 출력대로만 한다. 백엔드 vitest 가 이 함수와 `authStore` 를 직접 불러 행동을 시험한다(선례 `brand-axis-invariants.test.ts` 가 프론트 모듈을 import · 저장소는 시험 안 가짜 `localStorage`).
  - **상태 둘을 나눈다**(★설계 2R 지적 1 · 2 = 1R 지적 2 와 같은 부류 · 되풀이 원인 = 탭 메모리(`authStore`)와 브라우저 공유 저장소(`localStorage` · API 통로가 읽는 쪽 `client.ts:18-20`)를 한 덩어리로 지우면서 「끝난 로그인이 어느 것인가」를 정하지 않았다).
    - `endedToken` = 끝난 바로 그 로그인 = **요청을 보낼 때 고정한 값**(★설계 3R 지적 = 401 이 닿을 때 탭 토큰을 읽으면 그 사이 같은 탭 · 다른 창의 새 로그인 B 를 끝난 것으로 읽는다): 통로의 요청 가로채기(`client.ts:18-20`)가 보낼 때 `{ sentToken: 실은 토큰 또는 null, sentTabToken: 그 순간 탭 메모리 토큰 또는 null }` 을 요청 설정에 붙이고, 401 처리는 이 둘만 읽는다(`endedToken = sentToken ?? sentTabToken`) · 감시 창 확인 요청도 같은 통로라 같다 · 시간 초과 = 그 판정 순간의 탭 토큰 · 다른 탭 토큰 바뀜 이벤트 = 바뀌기 전 값(`StorageEvent.oldValue`).
  - 판정 규칙
    1. **공유 저장소는 끝난 그 토큰일 때만 지운다**: `clearShared = endedToken !== null && sharedToken === endedToken`. 다른 탭이 그 사이 새로 로그인했으면(`sharedToken` 이 다른 값) 지우지 않는다 · 토큰 없는 요청의 늦은 401 도 같은 규칙(끝난 것 = 탭의 옛 로그인 ≠ 새 공유 토큰).
    2. **탭 메모리는 끝난 뒤 공유 저장소를 따른다**: 지운 뒤 공유 저장소에 다른 로그인이 있으면 `tab: 'adopt'`(`loadFromStorage` · 메모리 = 새 로그인) · 없으면 `tab: 'clear'`(`authStore.clearLocal()` 신설 · 메모리 user · token · isAuthenticated 까지 · 공유 토큰 지우기는 규칙 1 이 정한 때만) · 끝난 것이 이 탭의 로그인이 아니고(`tabToken !== endedToken`) 공유 저장소도 그대로면 `tab: 'keep'`(아무것도 안 함).
    3. `serverAlive`(시간 초과처럼 서버 세션이 살아 있을 때 · 그 토큰이 아직 공유 저장소에 있을 때만)면 서버 로그아웃도.
    4. **원인을 탭끼리 나눈다**: 서버가 원인 문구를 준 끝(강제 표식)이면 `localStorage['hanjul.sessionEnd'] = { t: endedToken 끝 24자, reason, at }` 를 적는다(공개 경로여도 적는다 · 화면에 안 보일 뿐).
    5. 공개 경로면 여기서 끝(사유 창 0 · 이동 0 · `adopt` 면 새 로그인으로 그 페이지를 그대로 봄).
    6. 로그인 필요 경로 · `tab: 'clear'` 면 사유 = `serverReason` → 없으면 `sharedEnd` 중 `t` 가 `endedToken` 끝 24자와 같고 10분 안의 것 → 없으면 사유 없음 · 사유가 있으면 `sessionStorage.forceLogoutReason` · `/login` 으로(지금 동작).
    7. 로그인 필요 경로 · `tab: 'adopt'`(이 브라우저 다른 창의 새 로그인) = 창 「이 브라우저의 다른 창에서 새로 로그인되어 이 화면의 로그인이 끝났습니다.」 → 확인 = 새로 불러오기(`/` · 새 로그인으로 처음부터 · 옛 로그인 화면 자료가 남지 않는다) · **새 로그인의 토큰은 지우지 않는다**(지금 `SessionGuard` 확인 단추의 `logout()` 은 공유 토큰까지 지워 다른 창의 새 로그인을 끊는다 = 함께 닫음).
  - 읽는 쪽 = `api/client.ts` 401 처리(지금 `localStorage.removeItem` 넷 + 사유 + 이동 → 이 함수 한 줄 · `endedToken` = 요청 머리 Authorization 의 토큰 · 없으면 탭 토큰) · `App.tsx` `SessionGuard` 확인 단추 · `SessionTimeoutGuard` 로그아웃.
  - D3 은 규칙 2 가 메모리 상태까지 지우므로 닫힌다(로그인 화면에서 토큰 없는 세션 확인 반복 0) · 행동 시험 B1 이 지운 뒤 `isAuthenticated === false` · `token === null` 을 본다(메모리 초기화를 빼는 변이 = 빨간불).
- `hooks/useSessionGuard.ts`
  - 세션 확인 401(강제 표식) → 판정은 통로가 이미 함(창 0) · 지금 이 훅의 창 띄우기 갈래(`:26-30`)는 지운다(같은 401 을 두 자리가 판정하지 않는다).
  - 다른 탭 토큰 바뀜(새 값 · 옛 값 = `oldValue`) → `endClientSession({ endedToken: oldValue })` = 규칙 7(로그인 필요 경로 = 창 → 새로 불러오기) · 공개 경로 = 조용히 따름.
  - 다른 탭 토큰 지움(빈 값 · 지금은 무시) → 로그인 필요 경로이고 `hanjul.sessionEnd` 가 이 탭의 토큰 것이면 그 사유로 규칙 6 · 아니면 지금처럼 무시(본인 로그아웃).
- `localStorage.removeItem('token')` 이 남는 파일 = `stores/authStore.ts` 하나(계약 K2) · `forceLogoutReason` · `hanjul.sessionEnd` 를 적는 파일 = `utils/session-end.ts` 하나(계약 K2).

### §2-2 D2 — 자동 로그아웃 타이머는 로그인했을 때만

- `useSessionTimeout({ onLogout, enabled })` — `enabled = isAuthenticated`. 꺼져 있으면 매초 셈 · 경고 창 · 연장 0(로그인 순간 마지막 입력 시각을 지금으로 다시 잡는다).
- `SessionTimeoutGuard` 의 로그아웃 = `endClientSession({ reason: '장시간 활동이 없어 자동 로그아웃되었습니다.', serverAlive: true })`(공개 경로면 로그아웃만 · 이동 0).

### §2-3 결정 ② — 로그인 사용자용 전역 부품은 공개 경로에서 그리지 않는다

- 대상 = App.tsx 의 라우트 밖 부품 중 로그인 상태를 읽는 것(계약 K3 이 뽑는다): `HelpDock`(도움말 봇) · `SecurityNoticeCard`(보안 공지 카드) · `SessionTimeoutModal`(곧 로그아웃 창) · `DemoCompanyBanner`(시연 회사 띠) → 각자 `isPublicPath` 면 `null`.
- 예외(계약 K3 면제 · 이유 적음) = `SessionGuard`(공개 경로 판정을 안에서 함 · §2-1) · `PageViewTracker`(로그인 사용자의 공개 페이지 접속도 접속 기록 대상 · 화면에 그리지 않음).

### §2-4 D4 — 세션을 끈 원인을 적고 원인대로 말한다(R56)

- DDL `C145-DDL-1`(원장 블록): `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ended_reason varchar(20)` + CHECK(`login_elsewhere` · `account_stopped` · `company_closed` · `logout` · `expired`) · 되돌리기 `C145-RB-1` = `DROP COLUMN IF EXISTS`.
- 백엔드 `utils/session-manager.ts` 에 끄는 함수 하나 `endSessions(db, where, params, reason)`(이름은 구현에서 정함) — 지금 세션을 끄는 자리 다섯(F1-1 ~ F1-5: `invalidateAppSessions` · `invalidateCompanySessions` · `invalidateUserSessions` · `routes/auth.ts:467` 로그아웃 · `middlewares/auth.ts:90` 만료)이 전부 이것을 부른다(계약 K4 = 백엔드 src 에서 `user_sessions` 를 `is_active = false` 로 바꾸는 SQL 이 이 파일 밖 0).
  - **이미 꺼진 행은 건드리지 않는다**(★1R 지적 4): 모든 끄기에 `AND is_active = true`(지금 로그아웃 `routes/auth.ts:467` 에는 없음 → 더함 · 꺼진 행의 첫 원인을 덮지 않는다).
  - **원인 = 실제 원인**: `ended_reason = CASE WHEN expires_at <= NOW() THEN 'expired' ELSE <그 자리의 원인> END`(새 로그인 회전이 이미 만료된 행을 끌 때 「다른 곳 로그인」이라 적지 않는다).
  - 로그아웃 감사 기록(`routes/auth.ts:471`)은 실제로 끈 행이 있을 때만(이미 꺼진 세션의 로그아웃 = 기록 0).
  - **칸 확인 = 부를 때마다**(★1R 지적 1 · 기억 0): 같은 연결(`db`)로 `information_schema.columns` 를 한 번 읽고 있으면 원인을 쓰는 SQL · 없으면 지금 SQL. 읽기라 트랜잭션 안(`invalidateCompanySessions` 의 연결)에서도 실패 문장을 내지 않는다. 비용 = 세션을 끌 때만(로그인 회전 · 로그아웃 · 만료 · 중지) 목록 조회 한 번. 이 확인이 지키는 것 = **배포 뒤 DDL 순서**(칸을 더하기 전 새 코드 · 더하는 순간)뿐이다.
  - **칸 지우기는 새 코드가 다 내려간 뒤에만**(★2R 지적 4 · 확인과 UPDATE 사이에 칸을 지우면 그 UPDATE 가 실패한다 = 막을 수 없는 경쟁이라 순서로 막는다): 되돌리기 = 코드를 옛 판으로 내리고 재시작이 끝난 뒤(옛 코드는 칸을 모른다) C145-RB-1. 칸은 남겨도 옛 코드 무영향이라 지우지 않아도 된다.
- 문구 CT `sessionEndMessage(reason)`(백엔드 `utils/session-manager.ts`):

| 원인 | 문구 |
|---|---|
| `login_elsewhere` | 다른 곳에서 로그인되어 현재 세션이 종료되었습니다.(지금 글자 그대로) |
| `account_stopped` | 계정 사용이 중지되어 로그인이 끝났습니다. 담당자에게 문의해 주세요. |
| `company_closed` | 회사의 서비스 이용이 중지되어 로그인이 끝났습니다. 담당자에게 문의해 주세요. |
| `logout` | 로그아웃되어 로그인이 끝났습니다. 다시 로그인해 주세요. |
| `expired` | 세션이 만료되었습니다. 다시 로그인해주세요.(지금 글자 그대로) |
| 칸 없음 · 옛 행 · 행 없음 | 로그인이 끝났습니다. 다시 로그인해 주세요. |

- `authenticate`: 살아 있는 행 조회 문장은 그대로 · 0행일 때만 `SELECT ended_reason …`(칸이 없거나 실패하면 원인 없음) → 401 `{ forceLogout: true, error: 문구, code: 'SESSION_ENDED', reason }`.
- 화면 쪽 대체 문구(`useSessionGuard.ts:29` · `client.ts:41`) = 서버 문구가 없을 때만 · 「로그인이 끝났습니다. 다시 로그인해 주세요.」로(원인을 모르면 「다른 곳」이라 말하지 않는다).
- 다른 탭 토큰 바뀜(`useSessionGuard.ts:60`) = 「이 브라우저의 다른 창에서 새로 로그인되어 이 화면의 로그인이 끝났습니다.」(다른 계정일 수 있어 「같은 계정」이라 말하지 않는다).

### §2-5 결정 ③ — 24시간 로그인 끝 안내

- `authenticate` catch: `jwt.verify` 의 만료 오류(`TokenExpiredError`)면 401 `{ forceLogout: true, code: 'TOKEN_EXPIRED', error: '로그인 시간이 끝났습니다. 다시 로그인해 주세요.' }` · 그 밖(서명 틀림 등) = 지금 그대로 `Invalid token`.
- 화면 = §2-1 처리 그대로(로그인 필요 화면 = 로그인 화면 + 안내 창 · 공개 경로 = 조용히 지움).

### §2-6 D5 — 슈퍼관리자 밀어낸 로그인에도 밀려난 IP(R1)

- `routes/auth.ts` 슈퍼관리자 `login_takeover` 의 details = `{ loginId, takenOverIp: superRotate.liveIp ?? null }`(고객사 경로와 같은 칸).
- ★구현 때 계약 K6 이 소스에서 뽑아 찾은 셋째 자리 = 슈퍼관리자 OTP 최초 등록(`routes/auth.ts` `enrollRotate.takeover`) · 같은 칸을 더함(흐름 표 F1-6 은 손 조사로 둘만 적었다).
- 계약 K6 = 백엔드 src 의 `'login_takeover'` 를 넣는 문장 전부가 `takenOverIp` 를 싣는다.

## §3 N1 — 공개 페이지 방문 기록(공용 장치 · 이번엔 JBN)

### §3-1 표 `public_page_visits`(DDL `C145-DDL-2` · 되돌리기 `C145-RB-2` = `DROP TABLE IF EXISTS`)

| 칸 | 꼴 | 뜻 |
|---|---|---|
| id | uuid PK | 화면이 만든 방문 하나(페이지를 열 때마다) |
| page | varchar(40) NOT NULL | 등록된 페이지 열쇠(`jbn`) |
| browser_key | uuid NOT NULL | 같은 브라우저(그 브라우저 `localStorage` 의 익명 열쇠 · 못 쓰면 방문 id) |
| ip_address | inet | 방문 IP(90일) |
| user_agent | text(앞 400자) | 기기 · 앱 판별 |
| referrer_host | varchar(200) | 들어온 곳의 호스트만(경로 · 검색어 버림) |
| src | varchar(60) | 주소의 `?src=`(영숫자 · `-_` 만) |
| login_id · user_type | varchar(100) · varchar(20) | 그 브라우저에 한줄로 로그인 흔적이 있으면(서명이 맞는 토큰의 값 · 세션 생사는 안 봄 = 「이 브라우저는 누구 것」) |
| application_id | uuid | 이 방문에서 낸 JBN 신청 |
| visible_seconds | int NOT NULL DEFAULT 0 · CHECK 0 ~ 21600 | 화면이 실제로 보이던 시간 합(6시간 상한) |
| started_at · last_seen_at | timestamptz NOT NULL DEFAULT now() | 연 시각 · 마지막 신호 |

색인 = `(page, started_at DESC)` · `(page, browser_key)`.

### §3-2 서버(새 CT `utils/public-visits.ts` + 공개 라우터 `routes/public-visits.ts` · `/api/public/visits`)

- 페이지 등록부 `PUBLIC_VISIT_PAGES = ['jbn']`(다른 페이지 = 한 줄 더하고 그 화면에 훅 한 줄).
- **방문 행의 정체 = (id, browser_key, page) 셋**(★설계 2R 지적 3) — 모든 쓰기(start · beat · 신청 잇기)는 셋이 다 맞는 행만 바꾼다. `ON CONFLICT (id) DO UPDATE … WHERE public_page_visits.browser_key = EXCLUDED.browser_key AND public_page_visits.page = EXCLUDED.page` · beat 의 `WHERE id = $1 AND browser_key = $2 AND page = $3` · 맞지 않으면 바꾸지 않고 204(기록만 안 됨).
- `POST /start` `{ id, page, browserKey, src, referrerHost }` + 있으면 `Authorization` → 값 거름(uuid 꼴 · 등록 페이지 · 글자 허용 목록) → `INSERT … ON CONFLICT (id) DO UPDATE` = **비어 있는 칸만 채운다**(ip · 기기 · 들어온 곳 · src · 로그인 흔적 · `started_at` 은 더 이른 값) · `application_id` · `visible_seconds` 는 건드리지 않음 · 토큰은 `jwt.verify` 만(세션 조회 0 · 실패면 빈 칸 · 검증 함수는 `middlewares/auth.ts` 에서 내보내 같이 씀).
- `POST /beat` `{ id, page, browserKey, seconds }` → 더하는 양 = `seconds`(0 ~ 60 으로 자름) · **서버가 본 지난 신호 뒤 흐른 시간 + 5초**를 넘지 못함 · 합은 **연 뒤 흐른 시간 + 5초**와 6시간을 넘지 못함(★1R 지적 5 = 신호를 몰아 보내도 실제 흐른 시간 이상 쌓이지 않는다) · `last_seen_at = now()` · `started_at > now() - interval '1 day'` 인 행만.
- 호출 상한(IP당 10분) = 남용 막기 용도만(★1R 지적 7 · 머문 시간 부풀리기는 위 서버 상한이 막음) · start 300 · beat 3000(같은 IP 동시 방문 100명 · 30초 신호 기준) · 응답 = 늘 204(기록 실패가 페이지를 막지 않음) · 표가 없으면 503 `DB_MIGRATION_PENDING`(db_alter_safety_net · 화면은 무시).
- 보관 = 90일 지난 행 지움(새 워커 `startPublicVisitRetentionWorker` · 기동 1분 뒤 + 24시간 · 표 없으면 조용히) · 지운 수가 있으면 감사 기록 한 줄.
- 신청 잇기(★1R 지적 6 = 도착 순서와 무관하게 같은 결과): JBN 신청 본문에 `visitId` · `browserKey` → `routes/jbn-public.ts` `/apply` 가 신청을 받은 뒤(새로 · 이미 있음 둘 다) `linkVisitApplication({ visitId, browserKey, applicationId, page: 'jbn' })` = `INSERT (id, page, browser_key, application_id) … ON CONFLICT (id) DO UPDATE SET application_id = COALESCE(public_page_visits.application_id, EXCLUDED.application_id)` → start 가 먼저 오든 뒤에 오든 한 행에 모인다(실패해도 신청 응답은 그대로 · 같은 id 로 다시 보내는 신청도 같은 결과).
- 관리자 읽기 `GET /api/admin/jbn/visits?days=1|7|30|90`(소개 방문 탭과 같은 문 `isIntroLeadsViewer` · `Cache-Control: private, no-store`) → `loadPublicVisits('jbn', days)`:
  - 요약 = 방문 수 · 브라우저 수 · 평균 머문 시간 · 신청으로 이어진 브라우저 수.
  - 줄(최근 순 · 500 상한 · 넘으면 `truncated`) = 연 시각 · 머문 초 · IP · 기기(휴대폰 · PC · 태블릿) · 앱(카카오톡 · 네이버 · 인스타그램 · 페이스북 · 밴드 · 그 밖 브라우저) · 누구(같은 브라우저 어느 방문에서든 신청했으면 그 신청의 닉네임 · 회사명 → 로그인 흔적이면 아이디 · 종류 → 없으면 「알 수 없음」) · 같은 브라우저 방문 수 · 들어온 곳 · src.
  - 기기 · 앱 판별 = 서버 CT 의 순수 함수 하나(`describeVisitorAgent`).

### §3-3 화면

- 새 훅 `hooks/usePublicVisit(page)` — 열 때 방문 id(`crypto.randomUUID`) · 브라우저 열쇠(없으면 만듦 · 저장 실패면 방문 id) → start(토큰이 있으면 실음 · `keepalive`) → 보이는 동안만 시간을 쌓아 30초마다 beat · 숨겨질 때(`visibilitychange`) · 떠날 때(`pagehide`) 남은 시간을 `keepalive` beat 로 · 실패는 전부 삼킨다 · `{ visitId, browserKey }` 를 돌려준다.
- `JbnPage` = `const visit = usePublicVisit('jbn')` + 신청 본문에 `visitId` · `browserKey`(`utils/jbn-public.ts` 의 본문 꼴에 선택 칸 둘).
- `JbnMembersTab` 맨 아래 넓은 칸 「방문 기록」: 기간 고르기(오늘 · 7일 · 30일 · 90일 · 기본 7일) · 요약 넷 · 표(연 시각 · 머문 시간 「1분 20초」 · 누구 · 기기 · 앱 · IP · 다시 온 횟수 · 들어온 곳) · 빈 상태 문구 · 불러오기 실패 줄 · 표 한 줄 규칙(`ADMIN_TABLE_ONELINE`) · 표 머리 설명 「머문 시간 = 화면이 실제로 보이던 시간」. 디자인 = 같은 탭의 칸 모양 그대로(LESSONS_FRONTEND 「디자인 최소 기준」).

## §4 계약 시험 · 실 PG 시험

| 이름 | 무엇을 뽑아 무엇을 보나 |
|---|---|
| K1 공개 경로 목록 | App.tsx `<Route path=` 중 `PrivateRoute` 없는 줄 = `PUBLIC_PATHS`(양쪽 · 404 `*` 제외) |
| K2 끝 처리 한 곳 | 프론트 src 에서 `removeItem('token')` 파일 = authStore 하나 · `forceLogoutReason` 을 적는 파일 = session-end 하나 · 통로 401 갈래가 `endClientSession` 을 부름 |
| K3 전역 부품 | App.tsx 라우트 밖 JSX 부품 중 정의에 `useAuthStore` · `localStorage.getItem('token')` 이 있는 것 = `isPublicPath` 를 부르거나 면제 표(이유 있음)에 있음 |
| K4 세션 끄는 SQL 한 곳 | 백엔드 src 에서 `user_sessions` 를 `is_active = false` 로 바꾸는 문장 = session-manager 의 끄는 문장 하나 |
| K5 원인 문구 | 원인 목록 = CHECK 목록 = 문구 표 · `authenticate` 비활성 갈래에 글자 문구 0 |
| K6 인계 기록 | `'login_takeover'` 를 넣는 문장 전부 `takenOverIp` |
| K7 방문 장치 배선 | `PUBLIC_VISIT_PAGES` 의 페이지마다 그 화면이 `usePublicVisit('<page>')` · JBN 신청 본문이 `visitId` 를 싣고 `/apply` 가 `linkVisitApplication` 을 부름 |
| 실 PG `c145-session-visits.pg` | 원장 블록 C145-DDL-1 · 2 글자 그대로 · DDL 전 = 끄는 다섯 자리가 지금 SQL 로 돎(트랜잭션 안 포함) · DDL 뒤 = 원인 다섯 저장 · **이미 꺼진 행에 로그아웃 = 원인 그대로 · 감사 기록 0** · **만료된 행을 새 로그인이 끄면 `expired`** · **칸이 없는 판(DDL 전) → 같은 프로세스에서 칸을 더한 뒤 다음 끄기 = 원인을 씀** · `authenticate` 가 원인 문구 · 행 없음 · 옛 행 문구 / 방문 = start 두 번 한 행 · **apply 먼저 → start 뒤 = 한 행에 신청 · 기기 둘 다** · **같은 id 를 다른 browserKey · 다른 page 로 start · beat · 신청 잇기 = 원래 행 그대로** · **beat 를 몰아 360번 = 흐른 시간 + 5초 이하** · 6시간 상한 · 하루 뒤 beat 무시 · 신청 잇기(이미 이어진 방문은 그대로) · 요약 · 누구 우선순위 · 90일 지움 · 표 없음 503 |
| 행동 B1 `c145-session-end`(백엔드 vitest 가 프론트 `utils/session-end` · `stores/authStore` 를 직접 import · 가짜 `localStorage` · `sessionStorage`) | ① 지운 뒤 `localStorage` 토큰 · 사용자 없음 **그리고** `useAuthStore.getState()` 의 `isAuthenticated false · token null · user null` ② 공개 경로 = 이동 0 · 사유 창 0 · 공유 원인 기록은 적힘 ③ 로그인 필요 경로 = 사유 + 이동 ④ **늦게 닿은 실패(끝난 토큰 ≠ 지금 공유 토큰) = 공유 토큰 그대로 · 탭은 새 로그인을 따름** ⑤ 공개 탭이 먼저 지운 뒤 로그인 필요 탭의 토큰 없는 401 = 공유 원인으로 「다른 곳에서 로그인…」 사유 ⑥ 10분 지난 공유 원인 · 다른 토큰 것 = 쓰지 않음 ⑦ **토큰 없는 요청(보낼 때 탭 토큰 A 고정) → 그 사이 (가) 같은 탭에서 B 로그인 완료 (나) 다른 창 B 를 이 탭이 따름 완료 → 옛 401 도착 = 두 순서 모두 B 그대로 · 탭 메모리 B 그대로(끝난 것 = 고정한 A)** · 보낼 때 고정 대신 닿을 때 탭 토큰을 읽는 변이 = 빨간불 ⑧ **탭 메모리 A · 다른 창이 B 로 로그인(이벤트 옛 값 A) → 확인 = B 그대로 · 탭 메모리 A 아님 · 새로 불러오기** ⑨ 끝난 것이 이 탭 로그인이 아니고 공유도 그대로 = 아무것도 안 함 · 변이 = 메모리 초기화 빼기 · 공유 토큰 대조 빼기 · 따르기 빼기 · 공개 경로 판정 빼기 · 공유 원인 빼기 각각 빨간불 |
| 단위 `c145-session-visits` | `describeVisitorAgent` 표(카카오톡 · 네이버 · 아이폰 · 안드로이드 · 아이패드 · PC) · 값 거름 · `sessionEndMessage` · 만료 오류 갈래 |

변이 = 각 계약 · 갈래의 장치를 하나씩 꺼서 빨간불 확인(구현 보고에 표).

## §5 직원 지시문 초안(§3 서식 · 구현 전에 못 박음)

시트 1 「공개 페이지 끊김」(PC 두 대 또는 PC + 휴대폰 · 테스트계정 = 배포 전 정함)

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | PC 1 크롬에서 hanjul.ai 에 테스트계정으로 로그인한다 | 대시보드가 열린다 |
| 2 | PC 1 크롬 새 탭 주소창에 hanjul.ai/jbn 을 넣는다 | JBN 회원 전용 페이지가 열린다 · 오른쪽 아래 도움말 단추가 없다 |
| 3 | PC 2(또는 휴대폰)에서 같은 테스트계정으로 로그인한다 · 「이미 사용 중」 창이 뜨면 「계속」을 누른다 | 대시보드가 열린다 |
| 4 | PC 1 의 JBN 탭으로 돌아와 1분 기다린다 | JBN 페이지가 그대로 있다 · 창이 뜨지 않는다 · 주소가 hanjul.ai/jbn 그대로다 |
| 5 | PC 1 의 대시보드 탭을 누른다 | 「다른 곳에서 로그인되어 현재 세션이 종료되었습니다.」 창이 뜬다 → 확인 → 로그인 화면 |
| 6 | 슈퍼관리자(ceo)가 테스트계정을 「사용 중지」로 바꾼다 · PC 2 대시보드를 1분 둔다 | 「계정 사용이 중지되어 로그인이 끝났습니다. 담당자에게 문의해 주세요.」가 뜬다 |
| 7 | 슈퍼관리자가 테스트계정을 다시 「사용」으로 되돌린다 | 테스트계정으로 다시 로그인된다 |

시트 2 「JBN 방문 기록」

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 직원 휴대폰 카카오톡에서 JBN 페이지 주소를 눌러 연다 · 30초 동안 화면을 켜 둔다 · 카카오톡 창을 닫는다 | — |
| 2 | PC 크롬(로그인 안 한 창)에서 hanjul.ai/jbn 을 연다 · 1분 동안 둔다 · 신청서에 회사명 「시험상사」 · 닉네임 「시험 직원」 · 연락처 직원 본인 번호로 신청한다 | 「신청을 받았습니다」가 뜬다 |
| 3 | 슈퍼관리자(ceo) 「JBN 회원」 탭 맨 아래 「방문 기록」에서 「오늘」을 누른다 | 두 줄이 있다: ① 휴대폰 · 카카오톡 · 머문 시간 20 ~ 40초 ② PC · 머문 시간 1분 이상 · 누구 = 「시험 직원 · 시험상사」 |
| 4 | 같은 탭 위 목록에서 「시험상사」 신청을 지운다 | 목록에서 사라진다 |

## §6 배포 · 원장

- 원장 C145-P0(배포 앞 확인 = `user_sessions` 에 `ended_reason` 없음 · `public_page_visits` 없음 · information_schema 한 줄) → C145-H1(서버 pull → 백엔드 build:safe → 프론트 build:safe → 적재 0건 → 재시작 · DDL 전 새 코드 = 끄기는 지금 SQL · 문구는 원인 없음 문구 · 방문 주소 503 무시) → C145-DDL-1 · DDL-2(**배포 뒤** · 메모리 「마이그레이션은 배포 뒤」 · `lock_timeout 3s` · CHECK 는 `NOT VALID` = 표를 훑지 않음) → C145-S1(실측 = 시트 1 · 2 를 Harold 또는 직원이 · 서버 확인 = `SELECT ended_reason, count(*) FROM user_sessions WHERE is_active = false AND created_at > now() - interval '1 day' GROUP BY 1` · `SELECT count(*) FROM public_page_visits`).
- 되돌리기 = 코드를 옛 판으로 내리고 재시작이 끝난 뒤 C145-RB-2(표 지우기) · C145-RB-1(칸 지우기 · 선택). **새 코드가 도는 동안 칸 · 표를 지우지 않는다**(§2-4 · 막을 수 없는 경쟁).
- 발송 핵심 다섯 파일(campaigns · spam-filter · results · billing · messageUtils) 무수정 · ENV 0.

## §7 하지 않는 것(범위 밖 · 기록만)

- 다른 공개 페이지(소개 · 제안 · 요금 · 진단)에 방문 기록 켜기 = Harold 결정 뒤 한 줄씩.
- 소개 페이지의 옛 방문 기록(`intro_view`)을 새 표로 옮기기.
- nginx 기록을 화면에서 보기.

## §9 구현 결과(1119)

- Codex = 설계 4R approve(1R 8 · 2R 4 · 3R 1 · 4R 0) · 구현 3R approve(1R 3 · 2R 1 · 3R 0).
  - 설계 1R ~ 3R 의 「새 로그인 보호」 세 번 = 같은 부류 · 탭 메모리와 브라우저 공유 저장소를 나눈 판정 하나로 닫음(§2-1 규칙 1 ~ 7).
  - 구현 1R = 다른 창 로그인을 따를 때 옛 계정 탭 자료 · 「오늘」 = 한국 시간 자정 기준 · 기간 변경 실패 때 옛 자료 / 2R = 따르기는 탭 자료만(브라우저가 같이 쓰는 SNS 쓰던 글은 두고 · 로그인을 지울 때만 지움).
- 계약 K6 이 소스에서 슈퍼관리자 OTP 최초 등록의 인계 기록(셋째 자리)을 찾아 같이 닫음(§2-6).
- 시험 = 새 단위 `c145-session-visits` 37건 · 새 실 PG `c145-session-visits.pg` 12건(원장 블록 글자 그대로 · DDL 전 → 뒤 같은 프로세스) · 기대값을 옮긴 옛 시험 여덟(session-takeover · admin-account-disable-sessions-1003 · company-terminate-1021 · session-8h-login-notice-1002 · ai-line-1018 · c144-jbn 주소 수 · root-ledger 라우터 분류 · 주소 숫자 값 CT = parseVisitDays 가 parseQueryInt) · 변이 24 전부 빨간불(처음 18 중 못 잡은 둘 = 계약을 좁혀 다시) · backend tsc 0 · frontend tsc 0 · 단위 전체 831파일(마지막 실행 = 실 PG 통과 기록 대조 1건만 남음 → 실 PG 전체 다시) · 실 PG 전체 98파일 892건(1R 고침 전).
- 화면 = 개발 서버 실제 컴포넌트 + 시험 API(127.0.0.1:3000 · 시험 값): 꺼진 토큰이 남은 브라우저로 /jbn = 세션 확인 401 뒤에도 그 페이지 · 창 0 · 그 브라우저 로그인만 지움 · 나눈 원인 적힘 / /settings = 로그인 화면 + 「다른 곳에서 로그인되어…」 창 / 로그인 화면에서 세션 확인 반복 0(1분+) / 방문 start(토큰 실음) · 30초 beat(29초) 실제로 나감 / 「방문 기록」 칸 폭 320 · 390 · 1024 · 1920 페이지 가로 넘침 0 · 좁은 폭 = 표만 칸 안에서 가로 · 넓은 폭 = 줄마다 한 줄.
- 미검증 = 운영 실측(원장 C145-S1 · 직원 시트 §5) · 카카오톡 안 브라우저의 숨김 · 떠남 신호(실기기).
