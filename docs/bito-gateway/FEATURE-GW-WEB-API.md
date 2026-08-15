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
