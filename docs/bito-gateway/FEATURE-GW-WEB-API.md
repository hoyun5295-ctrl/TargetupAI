# 비토 게이트웨이 — 관리 플레인 축 (GW-WEB-API)

> 허브 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md) (§9 등재). 수정 시 허브 §2-1 작업 규율(백업 의무 등) 적용.
> 이 문서가 `web/api` 축(Node.js Admin/Control/고객 API)의 확정 사실·결함·잔여를 소유한다. 최초 작성 = 2026-08-15 점검(비토 직접 실행).

## 1. 정체성

게이트웨이의 사람·프로그램용 문. 세 얼굴이 한 프로세스(server.js, `127.0.0.1:4000` 바인딩 + nginx 전면):

| 면 | 마운트 | 인증 |
|---|---|---|
| 관리(슈퍼관리자 대시보드) | `/api/admin/*` (23개 라우터) | 세션 쿠키(HttpOnly·SameSite=Strict) + TOTP MFA + API키 폴백 |
| Agent 컨트롤 플레인 | `/api/agent/control` | 토큰 digest(timingSafeEqual) + scope 강제 + 세대(current/next) 상태 기계 |
| 고객 API | `/api/v1/messages`·`/api/v1/account` | `agent_id:api_key` (Bearer 또는 헤더 쌍) |

규모 = routes 36 · services 15 · middleware 4 · workers 3(webhook/refund/agent-rollout)+alert. 의존성은 **express·pg·cors 셋뿐**(공급망 노출 최소). server.js 902줄에 로그인·MFA·세션 로직이 인라인.

## 2. 견고하다고 확인된 것 (2026-08-15)

- **관리 인증 스택** — 세션 토큰 sha256 해시 조회 · TOTP MFA · 로그인 잠금(기본 5회 실패/15분, ENV 조정) · 원격배포 변이는 비밀번호 재인증+CSRF(`remote-deploy-admin-auth`) · 선택적 관리 IP 제한(ENV)
- **Agent 토큰 검증** — sha256 digest + `crypto.timingSafeEqual`, provisional/active/rotating/revoked 상태별 scope 집합, `AGENT_CONTROL_SCOPE_DENIED` 403 강제 (`agent-control-auth.js:106-128·219-226`)
- **감사 로그** — 라우트 36 중 30이 audit 참조(호출 68곳), `sanitizeAuditDetail`로 비밀 세척
- **아티팩트 저장소**(`agent-artifact-store.js`) — `resolveInside`로 경로 탈출 차단, digest 정규식+sha256 전수 검증, 서명 검증은 별도 바이너리를 **execFile**(셸 미경유)로 호출, 검증기 오류 sanitize
- **중계사 비밀** — DB 무저장. `password_env` 등 **ENV 이름 참조**만 저장, 응답 redaction 목록 + 전용 테스트(`agent-response-redaction-test`) 존재 (`binds.js:38-132`)
- **고객 인증 캐시** — TTL 2분 + **generation 무효화**(정책 변경 중 조회가 stale을 캐시에 되살리지 않음 — 503 재시도 유도, `client-auth.js:84·154`)
- **webhook 워커** — 내구 큐(`webhook_queue`) + 지수 백오프 + max_retry + 최종 FAILED, 결과코드 표준 조인
- SQL은 확인 범위 전체가 파라미터 바인딩(동적 문자열은 컬럼명·내부 계산값뿐)

## 3. 확정 결함·위험 (2026-08-15)

| # | 내용 | 위치 | 등급 판단 |
|---|---|---|---|
| 1 | **관리자 비밀번호 = 무염 SHA-256 단일 해시** — KDF(bcrypt 등) 아님. DB 유출 시 오프라인 크래킹 용이. MFA·잠금이 온라인 공격은 막아줌 | `middleware/auth.js:180-182` | 높음(유출 연계) |
| 2 | **고객 API 키 평문 저장·평문 비교** — `agent_account.client_api_key`·`sender_account.client_api_key`를 SQL 등호로 비교. Agent 토큰은 digest인데 고객 키만 평문. DB 유출 = 즉시 도용 | `client-auth.js:107·145` | 높음(유출 연계) |
| 3 | **DB 비밀번호 하드코딩 폴백 `'bito1234'`** — 개발 compose와 동일 값. ENV 누락 시 조용히 약한 값으로 접속 시도 | `server.js:81` | 중 |
| 4 | 전역 에러 핸들러가 `err.message`를 응답 본문에 노출(내부 구조 유출). 로그는 남김 | `server.js:858-861` | 중 |
| 5 | **rate limiting 부재** — 로그인 잠금 외에 요청 속도 제한이 코드에 없음(고객 API 포함). nginx 계층 제한 여부 **미검증** | 전역 | 미검증 항목 동반 |
| 6 | 로컬 사본 node_modules 불완전 — `express`조차 해석 불가라 **DB 불요 mock 테스트마저 로컬 실행 불가**. Go와 달리 스위트 실행이 배포 환경에서만 가능한 상태 | `web/api/node_modules` | 위생 |
| 7 | (허브 §7-1 기존 확정) sendError 8벌 중 6곳 무로그 · 버전 핀 3곳 · CANARY_LANE_MISSING 가림 · finalize 경로 불일치 | 허브 참조 | — |

**관찰 (처방 아님)** — ①CORS `origin:true`+credentials 반사(SameSite=Strict가 실질 완화) ②webhook 대상 URL 무제한(사설 IP 차단 없음 — 기능 특성이고 admin이 loopback이라 실효 낮음) ③server.js 인라인 650줄(로그인·MFA·세션)은 구조 분리 여지.

## 4. 테스트 증거

- Node 테스트 8종 등재(`package.json`) — 응답 redaction·발신자 식별 계약·인증 캐시·비밀번호 리셋·마이그레이션 smoke·**API 구조(mock, DB 불요)**. **전부 로컬 미실행**(§3-6). 서버 환경 실행 이력은 미확인
- 참고: 이 축의 서버 반영분(`$9`·로그 2줄) 소스 동기화는 허브 §4-3에 기록(2026-08-15, `.bak-20260815`)

## 5. 착수 원장

1. [ ] sendError 잔여 6곳 로그 추가 — 인라인 8벌을 공용 헬퍼 1개로 합치는 구조 수정과 함께(허브 §8-8과 동일 항목). 자비스 협의 후
2. [ ] 고객 API 키 digest 저장 전환(§3-2) — 발급 시 digest 저장 + 조회를 digest 비교로. **고객사 이관으로 실키가 돌기 전이 마지막 싼 시점**
3. [ ] 관리자 비밀번호 KDF 전환(§3-1) — 로그인 성공 시 재해시하는 점진 이행 가능
4. [ ] `'bito1234'` 폴백 제거(§3-3) — ENV 누락 시 기동 실패가 정답
5. [ ] nginx rate limit 여부 실측(§3-5) — .65 nginx 설정 확인 1회
6. [ ] 로컬 사본 `npm install`로 테스트 실행 가능화(§3-6) — mock 테스트만이라도 green 확인
7. [ ] 에러 핸들러 응답에서 `err.message` 제거(§3-4) — 로그에만 남긴다

## 6. 2026-09-04 신설 endpoint 2종 (서수란 접수)

| endpoint | 축 | 근거 |
|---|---|---|
| `GET /api/admin/stats/lines` | 회선(Bind)별 발송 통계 | 접수 "회선별 발송 통계 지원 요청" |
| `GET /api/admin/access-events`<br>`GET /api/admin/access-events/summary` | 고객사 접속·동작 이력 | 접수 "업체 접속(동작) 이력 확인" |

### 6-1. 회선별 통계 (`/stats/lines`)

기존 `/stats/binds` 는 당일 고정·필터 없음·과금 없음이라 회선 모니터링 전용이다. 그대로 둔다.
새 endpoint 는 사용량 통계와 **같은 필터 계약**(`from`·`to`·`customer_id`·`sender_account_id`·`msg_type`·`q`)을 쓴다.

- 회선 축의 진실은 `message_request.bind_account_id` 하나다. `route_id` 는 채우는 코드가 없다
  (2026-09-04 운영 실측: 30일 38,998건 중 `route_id` 0건 · `bind_account_id` 38,998건).
- 성공률은 **결과가 확정된 건(성공+실패)만** 분모로 쓴다. 상위단 청구 수량과 맞춰 보는 자리라
  아직 결과를 모르는 건을 실패처럼 깎으면 안 된다. 표본이 없으면 100%가 아니라 `null`이다.
- `bind_account_id IS NULL`(회선 배정 전 종결) 행을 "회선 미지정"으로 그대로 낸다. 숨기면 회선 합계가
  전체 발송량과 어긋나 대조가 깨진다.
- 집계 범위는 `web/api/services/message-scope.js` 가 단독 소유한다. 같은 날 `/stats/customers` 와
  `/stats/export-data` 도 이 정의로 수렴시켰다 — 축마다 WHERE 를 다시 적으면 한 화면 안의 두 표와
  엑셀이 서로 다른 건수를 낸다.

### 6-2. 접속·동작 이력 (`/access-events`)

적재는 이 문서 밖의 두 곳이 한다(원장 = 게이트웨이 `status/SCHEMA.md` §2-18).

| 창구 | writer | 남기는 것 |
|---|---|---|
| Agent gRPC | `internal/gateway/session/access_event.go` | connected · disconnected · auth_failed(사유) |
| API 연동 | `web/api/services/access-event.js` (client-auth 미들웨어) | request(성공) · auth_failed(사유) |

- 같은 분·같은 (창구·사건·계정·출발지·사유)은 한 행으로 누적한다(`event_count`). API 연동은 요청마다
  인증을 타므로 건별 적재는 이력이 아니라 트래픽 사본이 된다.
- 거절 사유를 catch 에서 버리지 않는다. 사유 없는 거절 이력은 원인을 못 찾는다.
- 마이그레이션 056 전에는 두 writer 가 `42P01` 을 한 번 확인하고 조용히 멈추고, 조회 API 는
  500 이 아니라 `503 DB_MIGRATION_PENDING` 을 돌려준다.

## 7. 2026-09-06 대체발송 원본이 집계에서 성공으로 잡히던 것 (Harold 접수)

발송 이력에는 「카카오 실패 후 LMS/MMS 전환 성공」으로 보이는 건이, 관제 첫 화면 유형별에서는
알림톡 **전량 성공**으로 나왔다. 접수 = "카톡 실패면 카톡은 실패가 맞는 것 아닌가."

**원인.** 전환은 행이 둘이다(원본 알림톡 · 자식 문자). 자식 결과가 오면
`internal/gateway/engine/report.go` `markParentFallbackFinal` 이 **원본의 `norm_status` 를 DONE 으로,
`report_code_raw` 를 7830/7831 로 덮는다**(API source 기준). 그 코드가 성공 목록에 있어서
원본이 `kakao_alim` 성공으로 집계됐다. 컬럼 하나가 두 질문에 답한다 — API 소비자에게
"이 요청은 최종 전달됐다"는 맞지만, 카카오로는 도달한 적이 없다.

**처방.** `services/result-code.js` 에 `fallbackParentSql` 을 신설하고 집계 두 술어만 고쳤다.
`finalSuccessSql` 에서 원본을 빼고, `finalFailedSql` 의 **DONE 구간 안에서** 실패로 센다.
소비처 18곳(stats.js 13 · binds.js 3 · alert-worker.js 2)이 CT 하나로 따라온다.

- **성공 코드 목록에서 7830·7831 을 빼지 않았다.** 그 목록은 `standardCodeSql` 의 라벨 분기와
  Go `internal/common/resultcode` 가 함께 쓴다. 빼면 발송 이력 라벨이 「미분류 실패」가 되고
  Go 판정과 갈라진다. `admin-messages.js`·`public-messages.js`·`workers/webhook-worker.js` 는
  `standardCodeSql` 만 import 하므로 **고객 조회 API·웹훅 계약은 무변경**이다.
- **DONE 구간 안에 둔 것이 계약이다.** 자식 생성 시점에 원본의 `fallback_request_id` 가 이미 채워지고
  (`report.go` `startKakaoFallback`) 그때 원본은 REPORTED 다. 밖에 두면 전환 진행 중을 실패로 단정한다.
- **원본을 집계에서 통째로 빼지 않는다.** 관제는 시도 축이라 카카오 회선 실패가 보여야 한다.
  paystats(청구 축)가 원본을 세지 않는 것과 방향이 반대이고, 그쪽은 자식이 건수를 들고 있어 성립한다.

**과금은 무변경.** 2026-09-06 실측 = 전환 원본 전 기간 90건(07-27~09-06)의 `billing_status` 가
**전부 FAILED** 다. `report.go:208` 이 카카오 실패 감지 시점에 원본 과금을 닫는다. 청구 합계 필터
(`billedFilterSql`)의 대상 집합에 FAILED 가 없으므로 게이트웨이 자체 청구에 원본이 들어간 적이 없다.
당일 화면 청구액 375원도 ACCRUED 만의 합으로 역산이 맞는다.

**같은 세션에서 `done_today` 도 닫았다(Harold 지시 "할 때 같이 해야지").** `stats.js` `agent-operational`
의 CTE 만 CT 밖에서 `norm_status` 만 세고 있었고 그 값이 `stats.js:489`·`552` 성공률의 분자다.
두 카운터를 `finalSuccessSql('message_request')`·`finalFailedSql('message_request')` 로 교체해
(가)빈 REPORT 코드 DONE (나)실패 코드로 끝난 DONE (다)대체발송 원본 셋이 함께 성공에서 빠졌다.
`failed_today` 에는 CT 정의대로 SEND_FAILED 가 편입된다 — 다른 통계 축과 같은 정의가 되는 대신
진단 문구 「오늘 실패 N건, 전송 실패 상태 M건」의 두 수가 겹칠 수 있다(표시 문구는 무변경).

**남은 축 둘도 같은 세션에서 닫았다(Harold 지시 "안 닫힌 것들 다 닫아라").**

①**총계가 통화 수보다 큰 이유를 화면에 드러냈다. 숫자는 바꾸지 않았다.** 이 화면은 전송 대기·TPS·
성공률까지 전부 **시도 축**이고 청구액만 청구 축이다. 총계만 도달 축으로 바꾸면 그것 하나만 축이 달라진다.
대신 `today-summary` 에 `fallback_converted`(전환 원본 수)를 실어 「오늘 발송」 카드 아래
「문자 전환 N」으로 내고, 통화 수(`total - fallback_converted`)를 tooltip 에 붙였다.

②**성공률 분모를 CT `successRate` 로 옮겼다.** `agent-operational` 은 분자가 `updated_at` 기준 당일 종결,
분모가 `created_at` 기준 접수 전체라 축이 둘이었다. `today-summary` 도 분모가 `total` 이라 같은 부류였고
그쪽이 접수 화면이므로 함께 바꿨다. 두 곳 다 분모 = 성공+실패, 표본 0 = `null`.
프론트 두 곳을 동반 수정했다 — `ConsolePage.jsx` 는 `Number(null)=0` 이 「—」 분기를 죽이고 있었고,
`OperationsDashboardPage.jsx:765` 는 `??` 로 null 을 축이 다른 오늘 요약값에 폴백하고 있었다(키가 아예
없을 때만 폴백하도록 고쳤다).

**성공률 인라인 아홉 자리도 같은 세션에 닫았다(Harold 지시 "남기지 마").** 8곳이라 보고했는데
전수를 다시 세니 아홉이었다 — `typeBucket` · `customerStatRow` 2 · `rollupCustomerRows` 2 ·
`lineStatRow` 1 · export summary · `/stats/agents` · `/stats/today-detail`. 전부
`successRate(success, failed)` 로 옮겼다. 이제 `stats.js` 의 성공률 열세 자리가 전부 CT 를 탄다
(인라인 잔존 grep 0건 · **계약 테스트 10** 이 재발을 막는다 — `success_rate` 와 `* 100` 이 한 줄에
있으면 실패한다). 종전 `lineStatRow` 주석의 "고객사 축과 분모가 다르다"는 의도가 아니라
그 아홉 때문에 생긴 차이였다. 주석도 함께 고쳤다.

카카오 계열 합산이 `customerStatRow` 와 `lineStatRow` 에 **같은 코드로 두 벌** 있었고 성공률 산식도
각자 인라인이었다. `kakaoRollup(byType)` 하나로 합쳤다.

**프론트가 null 을 받을 수 있게 된 것이 이 변경의 진짜 파급이다.** 종전에는 서버가 사실상 항상
문자열을 줘서 「판정 전」 경로가 거의 죽어 있었다. 다섯 파일을 신설 `utils/rate.js` 하나에 맞췄다
(`formatRate` · `hasRate` · `rateTone`/`rateColor`).

| 자리 | 종전 | 지금 |
|---|---|---|
| `TodayPage` 카드·고객사 열 | `{summary.success_rate}%` → 「null%」 | `formatRate` |
| `StatsPage` 고객사 열 | 회선 열만 「판정 전」을 알았다 | `rateBadge` 공용 |
| `charts.jsx` `RateBar` | `Number(null)=0` → 빨간 0% | 막대 비우고 「판정 전」 |
| `ConsolePage` 추이선 색 | 같은 이유로 빨강 | 판정 없으면 본문색 |
| `OperationsDashboardPage` | `??` 로 축 다른 값에 폴백 | 키 부재일 때만 폴백 |

## 8. 2026-09-06 상태 표시 한글화 + 조회 축 2종 (Harold 접수)

접수 = "관제에서 실패 6건인데 이력에서 FAILED 로 찾으면 2건만 나온다" · "영문 말고 한글로 해야
직원이 모니터링할 때 편하다" · "카톡 실패 후 전환도 골라 볼 수 있어야 한다".

### 8-1. 두 화면이 다른 질문에 답하고 있었다

이력 목록의 상태 필터는 `mr.norm_status = $N` 단순 일치였고, 관제 집계는 CT `finalFailedSql`
(결과 코드까지 본다)이다. 카카오 전환 원본은 자식 결과를 받아 `norm_status` 가 **DONE 으로 덮이므로**
집계에서는 실패지만 이력의 FAILED 필터에는 안 걸린다. 2026-09-06 실측 116건 기준:

| 역할 | 유형 | norm_status | 코드 | 건수 | 관제 판정 | 종전 이력 FAILED |
|---|---|---|---|---|---|---|
| 전환 원본 | 알림톡 | **DONE** | 7831 | 4 | 실패 | 안 걸림 |
| 전환 원본 | 알림톡 | FAILED | 505 | 1 | 실패 | 걸림 |
| 전환 자식 | LMS | FAILED | 505 | 1 | 실패 | 걸림 |
| 전환 자식 | LMS | DONE | 0 | 4 | 성공 | |
| 일반 | 알림톡 | DONE | 0000 | 83 | 성공 | |
| 일반 | SMS | DONE | 0 | 23 | 성공 | |

관제 실패 6 = 4 + 1 + 1 인데 이력에서는 2건만 보였다.

### 8-2. 조회 축을 섞지 않고 항목을 나눴다

`admin-messages.js` 에 `QUERY_SCOPES` 신설. 기존 상태 값의 의미는 **불변**이다.

| 값 | 라벨 | 술어 |
|---|---|---|
| `FINAL_FAILED` | 실패(관제 기준) | CT `finalFailedSql('mr')` |
| `FALLBACK` | 카카오 실패 후 전환 | `mr.fallback_request_id IS NOT NULL` |

- **`DONE` 필터까지 집계 축으로 바꾸지 않았다.** 그러면 결과 코드가 비어 있는 DONE 건을 운영자가
  찾을 수단이 사라진다. 드롭다운은 `optgroup` 으로 「처리 단계」와 「관제 기준」을 갈랐다.
- 전환은 **원본 기준**으로 센다. 건수가 곧 전환 통화 수라 관제 「문자 전환 N」과 그대로 대조된다.
  자식은 별도 행으로 남아 유형 필터로 찾는다.
- 목록 응답에 `is_fallback_parent`·`is_fallback_child` 를 실어 상태가 「완료」인데 관제에서 실패로
  세는 이유를 행에서 읽을 수 있게 했다(상태 배지 아래 「문자 전환」).

### 8-3. 상태 라벨은 theme.js 가 소유한다

색(`STATUS_TONES`)은 이미 그 파일이 소유하는데 **라벨만 밖에 있어** 화면마다 갈렸다 —
이력·파이프라인은 영문 그대로, `App.jsx` 만 자기 한글을 들고 있었다.

| norm_status | SCHEMA §2-2 정의 | 라벨 |
|---|---|---|
| `QUEUED` | 게이트웨이 수신·저장 완료 | 발송 대기 |
| `SENDING` | 중계사로 전송 중 | 전송 중 |
| `DELIVERED` | 중계사 접수 응답(ACK) 수신 | **중계사 접수** |
| `REPORTED` | 결과 통지(REPORT) 수신 | 결과 수신 |
| `DONE` | 최종 종결 | 완료 |
| `FAILED` | 최종 실패 | 실패 |
| `SEND_FAILED` | 접수 실패 후 재시도·최종판단 대기 | 전송 실패(보류) |

⛔ **`App.jsx` 의 「전달완료 (DELIVERED)」는 오기였다.** ACK 는 중계사가 받았다는 뜻이고 단말 도착이
아니다. 그대로 두면 결과를 아직 모르는 건을 도착으로 읽는다. `DONE` 을 「전달 완료」가 아니라
「완료」로 둔 것도 같은 이유다 — DONE 이지만 그 유형으로 못 간 건이 있다(전환 원본).

원문 상태는 **지우지 않고 마우스 오버로** 남긴다. 화면에서 없애면 새 상태가 생겨도 아무도 모른다.

적용 = `theme.js`(신설 `STATUS_LABELS`·`statusLabel`·`MESSAGE_STATUS_GROUPS`) ·
`MessageHistoryPage`(드롭다운·배지·상세) · `PipelinePage`(자체 맵 제거) · `App.jsx`(큐 6칸·목록 셀) ·
`OperationsDashboardPage`(표 헤더 2벌 7열) · `statsExports.js`(엑셀 용어집에서 `norm_status=DONE`·
`charge_amount` 같은 내부 용어 제거).

## 9. 2026-09-06 고객 배포자료 — 감시가 뒤집혀 있었다 (Harold 접수)

접수 = "고객 배포자료가 저렇게 싹 빠져 있는데 이게 필요하냐. 묶음 저장 누르면 고객사 전용으로
하나씩 나오는 상태 아니냐. 전수 점검해봐."

### 9-1. 실측 — 「누락」은 파일이 없어서가 아니었다

`/opt/bito-gateway/app/Bito Agent/` 실측(2026-09-06):

| 자산 | 있는 버전 |
|---|---|
| 패키지 linux·windows | 1.0.21 · 1.0.24 · **1.0.25** |
| 설치 안내서 **PDF** | 1.0.24 · **1.0.25** |
| 설치 매뉴얼 **docx** | 1.0.21 · 1.0.24 (1.0.25 없음) |

슬롯이 `versionGroup: 'agent-release'` 라 패키지 최신(1.0.25)과 같은 버전을 요구하는데 docx 가
거기서 멈춰 탈락했다. **화면 문구 「현재 버전 파일 없음」은 정확했다.**

⛔ **진짜 결함은 반대편이었다.** 산출물은 0904 에 PDF 로 넘어갔고
(`services/agent-install-bundle.js` 가 `Bito-Agent-Install-Manual-v<ver>.pdf` 를 zip 에 넣는다)
화면은 발급이 **쓰지 않는** docx 를 감시하고 있었다. 즉 발급이 실제로 읽는 PDF 가 사라져도
화면은 초록이었을 것이고, 반대로 만들지도 않는 docx 때문에 붉은 경고가 상시로 떠 있었다.

### 9-2. 축을 「나눠줄 파일」에서 「발급이 의존하는 자산」으로

| 고친 것 | 내용 |
|---|---|
| `agent-manual` 슬롯 | 패턴을 `.docx` → **`.pdf`**. 짝인 `agent-manual-sha256` 도 함께(한쪽만 바꾸면 그룹 버전 잠금이 깨져 「누락」이 그쪽으로 옮겨 갈 뿐이다) |
| `contentTypeFor` | `.pdf` 분기가 없어 안내서가 `text/plain` 으로 나가고 있었다 |
| `CURRENT_AGENT_VERSION='1.0.24'` · `CURRENT_BOOTSTRAP_VERSION='1.0.27'` | **상수 제거.** 파일이 1.0.25 로 올라가도 설명 문구는 1.0.24 를 말했다. 버전의 진실은 파일명이고 `version` 필드가 이미 낸다 |
| `bootstrap_version` 응답 | 제거. 릴리즈 원장이 소유하는 값을 이 화면이 중복 보관하다 멈춰 있었다 |
| 그 자리 | **`bundle_ready`·`bundle_assets`** 신설. 발급이 읽는 패키지·안내서가 최신 버전으로 있는지를 KPI 로 낸다 — 이 화면이 답해야 할 첫 질문 |
| 슬롯 설명 | 묶음과의 관계로 다시 씀(원본·참고용·수동 전달본 구분) |

**묶음이 대체한 것과 아닌 것.** 발급 zip = 패키지 · 안내서 PDF · `agent-config.yaml`(고객사 값) ·
`installer-config.yaml` · `first-install.sh`(신규) · `README.txt`(고객사 경로가 박힌 명령) · 체크섬.
그래서 공용 설정 예시·README 3종은 **참고용**으로 내려가고, `ViTO-Agent-API-DB-Handoff` 는
Agent 부분이 대체됐지만 **DB 권장 스키마가 거기에만 있어** 남는다. `API 연동 매뉴얼` 은 Agent 없이
API 로 붙는 고객용이라 묶음과 무관하게 그대로다.

### 9-3. 재발 방지

`test/customer-downloads-contract-test.js` 신설(`npm test` 등록). 번들 서비스 소스의 파일명 리터럴을
뽑아 **화면 슬롯 패턴이 그것을 매치하는지** 검사한다. 발급 자산 3종이 같은 `versionGroup` 인지,
설명 문구에 버전이 박혔는지, PDF 의 Content-Type 이 맞는지도 함께 고정한다.

**남은 판단 = 낡은 자료 정리.** `ViTO-Agent-API-DB-Handoff-v1.2`(2026-08-13 · 31MB)와 공용 README·
설정 예시를 화면에서 내릴지는 **다운로드 실적으로 정한다**(`audit_log` `action='CUSTOMER_ARTIFACT_DOWNLOAD'`
· `target_id` 가 슬롯 id). 아직 조회 전이다.
