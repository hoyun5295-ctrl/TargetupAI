# 비토 게이트웨이 보안 (스포크 8) — 발견·조치·잔여

> **호출어 = "게이트웨이 보안"**
> 허브 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md). 이 문서가 보안 축의 확정 사실·조치·잔여를 소유한다.
> 신설 = 2026-08-28. 착수 계기 = Harold "재판매보다 보안적으로 부족한 부분들을 개비하는 방향".

## 1. 이 축이 왜 최우선인가

문자 사업자에게 게이트웨이는 **발송 능력 그 자체**다. 뚫리면 남의 명의로 대량 발송이 나가고, 그건 통신사 제재와 전송자격 문제로 직결된다. 고객 정보 유출보다 먼저 막아야 하는 것이 "누구도 남의 발송 권한을 얻지 못하는 것"이다.

⚠ **실사용 트래픽이 있다.** 허브 §1의 "2026-08-14 기준 실사용 트래픽 0"은 낡은 서술이다.
**0828 실측 = API(REST) 접수가 하루 191건**(파주시청 DMZ 관광예약 업체). 시간대별 편차가 크다.

| KST | 7일 접수 | 평균 간격 |
|---|---:|---:|
| 03~06시 | 3~11건 | 720~3600초 |
| 08~09시 | 86~119건 | 84~120초 |
| **10시** | **485건/3일** | **21.6초** |
| 16~18시 | 35~67건 | 450~600초 |

이 수치가 배포 창 판단의 근거다. `message_request.source_type='api'` 기준.

## 2. 조치 완료

### 2-1. 무인증 라우트 7개 폐쇄 (0827 배포 · 커밋 `19933f0`)

**무엇이 열려 있었나** — `/api/messages/recent`가 **인증 없이 수신번호를 최대 200건** 반환했다. 외부에서 `curl` 한 번으로 `200`이 떨어지는 것을 실측했다. `/api/agents`는 고객사 계정·한도·라우팅·bind명을, `/api/connectors`는 중계사 커넥터 상태를 같은 조건으로 내보냈다.

이 경로들은 `/api/admin` 접두사가 아니라 **관리자 IP 제한 미들웨어도 타지 않았고**, MFA와도 무관했다.

**조치** — 7개에 `adminAuth` 부착(`engine/status`·`connectors`·`stats/today`·`queue/status`·`messages/recent`·`agents`·`stats/hourly`). `/api/health`는 배포 스크립트가 `127.0.0.1`로 호출하므로 무인증 유지. `adminAuth` 선언이 이 라우트들보다 뒤에 있어 그대로 참조하면 초기화 전 접근으로 기동이 깨지므로 pool 직후로 이동했다.

**검증** — 배포 전 `200` → 배포 후 `401`. 콘솔 5개 카드 정상. 대시보드는 이미 세션 쿠키로 돌고 있어(`ADMIN_API_KEY_FALLBACK_DISABLED=true`) 무영향.

### 2-2. 관리자 API 키 회전 (0827)

운영 `admin` 계정의 API 키가 **소스에 평문으로 적힌 개발용 기본값**(`init-db.js`)이었다. 저장소를 가진 사람은 누구나 아는 값이고, 그 키 하나로 `/api/admin/*` 21개가 MFA 없이 열린다. `openssl rand -hex 32`로 회전했다.

`suran` 계정은 처음부터 64자 랜덤이었다. 비밀번호는 기본값이 아니었다.

### 2-3. bind 자격증명 봉투 암호화 — **코드 배포 완료, 이행 대기** (0828 · 커밋 `0584b68`)

§3이 소유한다.

## 3. bind 자격증명 봉투 암호화 (진행 중)

### 3-1. 무엇이 문제였나

`bind_account.bind_pw_hash`는 이름과 달리 **해시가 아니라 자격증명 그 자체**다. gemtek NGS 규격이 SHA-256 hex를 그대로 인증 재료로 쓰고 다시 해시하지 않는다(`internal/gateway/connector/gemtek/crypto/password.go:85` 주석이 명시). 이 컬럼을 읽는 사람은 **원본 비밀번호를 몰라도 그 라인으로 발송**할 수 있다. 활성 bind 20건 전부 그 상태였다(gemtek 15 · humuson_imc 4 · mock 1).

humuson_imc는 SHA-256 형태를 받으면 거부하고 `connection_config.password_env`를 쓴다. 그쪽은 **서버 ENV에 실제 비밀번호가 평문 상주**한다(별도 잔여).

### 3-2. 설계

`bind_pw_enc TEXT` nullable 컬럼에 AES-256-GCM 봉투를 함께 저장하고 키는 DB 밖 `GW_BIND_SECRET_KEY`에 둔다. 게이트웨이는 유일한 로드 지점 `loadAndStartConnectors`에서 복호화하므로 **커넥터 4종 무변경**.

**막는 것** = DB 덤프 유출, DB 계정 탈취, psql 접근만 있는 경우.
**못 막는 것** = 서버 자체에 들어온 사람. 키가 같은 서버에 있다.

### 3-3. 상태 네 갈래 (게이트웨이 집계의 근거)

| 상태 | 조건 | 커넥터에 가는 값 |
|---|---|---|
| `legacy` | 봉투 없음 | 옛 컬럼 |
| `decrypted` | 봉투를 우리 키로 열었고 값이 옛 컬럼과 같음 | 복호화 값 |
| `fallback` | 봉투가 있으나 못 엶 | 옛 컬럼 |
| `mismatch` | 봉투는 열렸으나 옛 컬럼보다 낡음 | **옛 컬럼**(최신) |

⛔ **값 비교로 상태를 추론하지 말 것.** 정상 이행이면 봉투 평문과 `bind_pw_hash`가 **같은 값**이라, 두 값이 같은지로 판정하면 정상 복호화를 폴백으로 세게 된다. 실제로 그 결함을 만들었다가 Codex 4라운드에서 잡혔다.

⛔ **`mismatch`면 봉투가 아니라 옛 컬럼을 쓴다.** 이행 기간에는 모든 writer가 `bind_pw_hash`를 쓰고 봉투는 envelope-aware 빌드만 갱신하므로 hash가 항상 최신이다. 봉투를 쓰면 그 회선이 옛 비밀번호로 붙는다.

### 3-4. 키 동일성 강제

봉투에 키 지문 `kid`(SHA-256 앞 16자)를 넣고, `GW_BIND_EXPECTED_KID`를 배포 설정에 둔다. 게이트웨이·Admin API·이행 스크립트가 **각자 기동 때 자기 키 지문과 대조하고 다르면 뜨지 않는다.**

⛔ **키가 있으면 기대 지문도 필수**(fail-closed). 있을 때만 비교하면 설정을 빠뜨린 인스턴스가 다른 키로 조용히 떠서 읽을 수 없는 봉투를 쌓는다.

왜 필요한가: 첫 이행 때는 기존 봉투가 없어서 **이행 스크립트가 게이트웨이와 다른 키를 들고도 전부 암호화하고 자체 검증까지 통과**한다. 폴백 덕에 그 순간 발송은 살아 있고, 폴백을 걷어내는 시점에 전 회선이 죽는다.

### 3-5. 이행 스크립트 (`web/api/scripts/migrate-bind-credentials.js`)

로직은 `services/bind-credential-migration.js`가 소유(DB 주입형). 실행기는 얇다.

⛔ **`bind_pw_hash`를 쓰지 않는다.** 게이트웨이 폴백 경로를 살려 둔다.
⛔ **봉투를 만든 즉시 되돌려 원본과 대조**하고, 다르면 그 행은 쓰지 않는다.
⛔ **advisory lock + `LOCK TABLE ... SHARE ROW EXCLUSIVE` + 단일 트랜잭션.** 한 행이라도 실패하면 전부 롤백. `lock_timeout 5s`.
⛔ **CAS로만 쓴다.** 신규는 `bind_pw_enc IS NULL AND bind_pw_hash = $3`, 낡은 봉투 교체는 기존 봉투까지 조건에 넣는다.
⛔ **완료를 선언하는 곳은 `verifyAll` 하나.** dry-run은 `BIND_CREDENTIAL_DRY_RUN_OK`를 쓰고 완료 marker를 내지 않는다.

기본은 dry-run. `--apply`로만 쓴다. `--verify`는 전체 행을 보고 미이행이 하나라도 있으면 실패한다.

### 3-6. 남은 단계 (다음 세션이 여기서 시작)

**1. 키 생성과 ENV 배포** — 셋을 한 번에 넣는다. 하나만 넣으면 기동이 거부된다(그게 설계다).

```
GW_BIND_SECRET_KEY      = openssl rand -hex 32 결과
GW_BIND_EXPECTED_KID    = 그 키의 지문 (bindKeyFingerprint / secret.Fingerprint)
GW_BIND_SECRET_REQUIRED = 컷오버 단계에서만 true. 지금은 넣지 않는다
```

Admin API는 systemd drop-in, 게이트웨이는 `/etc/default/bito-gateway`. **게이트웨이에는 아직 넣지 않는다**(코드가 아직 배포 전).

**2. `migrate-bind-credentials.js` 배포** — 재시작 1회. 실행할 때만 쓰이는 파일이라 0828 창에서 뺐다.

**3. 이행 실행** — dry-run 먼저, 그다음 `--apply`. **발송 중에 돌려도 안전**하다(`bind_pw_hash` 미변경, 복호화하면 같은 값).

**4. 게이트웨이 배포** — Go 바이너리. 다음 정기 배포 때. 기동 로그 `bind 자격증명 집계`에서 `fallback=0 mismatch=0 legacy=0`과 kid를 확인한다.

**5. 폴백 제거(컷오버)** — 별도 창. 조건은 `migrations/051_bind_credential_envelope.sql` 주석이 소유한다. 요지는 **writer 봉쇄가 최종 검증보다 먼저**이고, "오류 없음"은 증거가 아니라 `[BIND-KEY] hasKey=true required=true kid=<기대값>`을 값으로 확인해야 한다는 것.

### 3-7. 검증 이력

Codex 적대 검토 **11라운드**. high `3-2-3-3-2-2-1-1-0-0-0`. 잡힌 것 중 운영에 나갔으면 사고였던 것:

- 집계가 정상 복호화를 폴백으로 세어 컷오버 판단이 통째로 뒤집히던 것 (4R)
- 낡은 봉투가 옛 비밀번호로 발송되던 것 (5R)
- 그 낡은 봉투를 고칠 경로가 없어 컷오버가 영구히 막히던 것 (6R)
- Node는 아무 키나 받고 Go는 hex만 받아 읽을 수 없는 봉투가 조용히 쌓이던 것 (1R)
- mock이 실제 DB보다 관대해 재이행 경로가 동작하지 않는 것을 덮던 것 (6R)

`GW_CHECK_OK` · bind 계약 17 · 이행 동작 14 · api-structure 359 · Go engine 12 · 회귀 주입 16종.

## 4. 잔여 (우선순위)

| # | 항목 | 방어 겹 | 재시작 |
|---:|---|---|---|
| 1 | **bind 이행 미완** — 봉투가 DB에 0건. 보안 이득이 아직 없다 | 없음 | §3-6 |
| 2 | **DB 비밀번호가 개발 기본값** — 저장소 `docker-compose.yml`과 같은 값이고 systemd 유닛에 평문. `systemctl cat`은 일반 사용자도 읽는다 | 127.0.0.1 바인딩 | 양쪽 |
| 3 | **감사 수집 키 평문** — `SERVER_AUDIT_INGEST_KEY`가 같은 자리에. 알면 서버 감사 로그를 위조해 넣을 수 있다 | 없음 | Admin API |
| 4 | **Agent 구간 gRPC 평문** — `GW_GRPC_TLS_ENABLED` 미설정. 0827 기동에도 `gRPC TLS 비활성 상태` 경고. 메시지 원문·수신번호·인증 토큰이 그 구간을 지난다 | 방화벽 1겹(9090 외부 차단 실측) | 게이트웨이 + Agent 3대 |
| 5 | **수신번호·본문 무기한 보존** — `message_request.phone`·`message` 평문. 파기 로직은 MMS 미디어 바이트만(`022`) | 없음 | 워커 신설 |
| 6 | **고객 발송 API 키 평문** — `agent_account.client_api_key`·`sender_account.client_api_key`. 해시화하면 콘솔에서 재조회 불가가 되므로 운영 판단 필요 | 없음 | Admin API |
| 7 | **관리자 비밀번호 솔트 없는 SHA-256** — MFA가 전 계정 강제라 로그인 축은 막혀 있다. 남는 위험은 DB 유출 시 원문 복원과 재사용 | MFA | Admin API |
| 8 | **`admin-secret` 폴백** — 소스 6곳 + 배포 번들. DB에 그 키가 없어 인증은 불가하나 위생 항목 | 해당 키 부재 | 대시보드 빌드 |
| 9 | **IP allowlist fail-open** — `ipAllowed`가 목록이 비면 전부 허용. 나중에 스위치만 켜면 "켰다고 생각하는데 안 켜진" 상태가 된다 | 현재 미사용 | Admin API |
| 10 | **`server.js` bootstrap 미분리** — 엔트리포인트라 기동 배선을 테스트가 실행할 수 없어 소스 검사로 우회 중(Codex 11R medium) | 해당 없음 | 없음 |

## 5. 판단이 내려진 것

**관리자 IP 제한은 켜지 않는다.** `zz-superadmin-mobile-otp.conf`(7/8 20:35)가 `ADMIN_WEB_IP_RESTRICT_ENABLED=false`와 빈 `ADMIN_ALLOWED_IPS`로 앞선 두 파일의 허용 IP를 덮고 있다. 파일명과 시각으로 보아 **모바일 접속을 열려고 IP 제한을 MFA로 교체한 의식적 결정**이고, 실제로 여행 중 외부 접속 이력이 있다(0827 확인). 그 판단을 뒤집지 않는다.

**게이트웨이는 정지시킬 수 없다.** 하루 종일 나가는 실사용 고객이 있다. 이행을 위한 정지 창을 만드는 대안은 폐기했고, 공존 기간과 폴백을 유지하는 무중단 방식으로 간다.

## 6. 배포 창 실측 (0828)

**Admin API 재시작은 1초 미만**이다(8/27 22:17:11에 Stopping·Stopped·Started·워커 시작이 같은 초).

**0827 배포(API 6파일, 19:40~19:59)에 502가 0건**이었다. 그 20분간 요청 479건(200:300 / 201:7 / 304:172)이 있었는데 5xx가 하나도 없다. nginx는 `proxy_pass`로 단일 주소를 직접 지정하고 재시도 설정이 없으므로 이론상 겹치면 502여야 하는데, 실측은 0이다.

**0828 배포(6파일, 10:42:51~10:43:02)도 502가 0건.** 그 사이 `200` +3, `201` +1로 접수가 계속 들어왔다. 10시대는 API 21.6초 간격으로 가장 붐비는 시간대였다.

⇒ **배포 창을 새벽으로 미룰 근거가 없다.** 다만 `migrate` 실행처럼 되돌리기 어려운 작업은 여전히 한산한 시간대를 고른다.

확인 명령은 `status/OPS.md`가 아니라 여기 둔다(게이트웨이 전용).

```bash
# 배포 직전 접수 밀도
docker exec -i bito-bench-postgres psql -U bito -d bito_gateway -c "SELECT NOW() AT TIME ZONE 'Asia/Seoul' AS now_kst, COUNT(*) AS last_10min FROM message_request WHERE source_type='api' AND created_at >= NOW() - INTERVAL '10 minutes';"

# 배포 직후 실패 여부
sudo awk -v t="$(date '+%d/%b/%Y:%H')" '$0 ~ t {print $9}' /var/log/nginx/access.log | sort | uniq -c
```

## 7. 이력

| 날짜 | 내용 |
|---|---|
| 2026-08-27 | 무인증 라우트 7개 폐쇄(`19933f0`). 관리자 API 키 회전. 외부 `200`→`401` 실측 |
| 2026-08-28 | bind 봉투 암호화 코드 배포(`0584b68`, API 6파일). Codex 11라운드. 이행은 미실행 |
