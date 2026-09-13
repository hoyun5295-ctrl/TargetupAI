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
| 2026-09-13 | Agent 역분석·서명 공급망 전수 점검(출고 바이너리·서버 실측). 강화 설계 §8 신설. 코드 변경 0 |

## 8. Agent 역분석·서명 공급망 강화 (설계 · 2026-09-13)

> 착수 계기 = Harold "에이전트를 보고 리버스엔지니어링 가능성은? 강화작업 설계서 써야겠다".
> 이 절이 Agent 바이너리·서명 키·배포 무결성 축의 사실·잔여·처방을 소유한다. 게이트웨이 저장소 `status/STATUS.md` 미해결 index `0-G`는 여기를 가리키기만 한다.
> ⛔ 아래 판정은 전부 0913 실측이다. 표에 없는 것은 미검증으로 본다.

### 8-1. 결론

**역분석으로 구조와 프로토콜은 읽힌다. 그러나 접근과 권한은 얻지 못한다.**
바이너리를 끝까지 뜯어도 게이트웨이에 붙으려면 발급 토큰 + 등록된 출발지 IP + TLS가 모두 필요하고, 에이전트에 코드를 밀어 넣으려면 ed25519 서명 + 관리 화면 승인이 필요하다. 바이너리 안에 그 어느 것의 비밀도 들어 있지 않다.
**남는 실질 위험은 역분석이 아니라 서명 권한의 보관 방식과 Windows 배포 무결성이다**(8-3 A1·A2).

### 8-2. 실측 사실

대상 = Linux `out/agent-amd64-standalone-v1.0.25/stage/bito-agent` · Windows `deploy/agent/windows-amd64/versions/1.0.20/bito-agent.exe`(+ 같은 폴더 `bito-agent-bootstrap.exe`·`bito-agent-installer.exe`).

| 축 | 사실 | 확인 방법 |
|---|---|---|
| 심볼 | 두 출고본 모두 심볼 섹션 없음 · `-trimpath` | `go tool nm` = `no symbols` · `go version -m` |
| 모듈 경로 | `public.bito/agent/runtime/core`로 치환 · 원래 저장소명 0건 | `go version -m` · `grep -aic invito/bito-gateway` |
| 남는 단서 | 함수명(치환 경로 포함) 16~17 · gRPC 메서드 2(`/bito.v1.BitoGateway/ConnectGateway`·`SendMessage`) · 한글 오류문 86~87줄 · `SELECT` 33(Linux) · 타입명(`*poller.Poller`·`dbWriteBatcher` 등) | `grep -a` 계수 |
| 내부 이름 | `message_request`·`report_queue`·`agent_account`·`bind_pw_hash`·`hanjulgw`·`humuson`·`gemtek` 0건 · **`invito` 1건 = `gw.invito.local`** | `grep -aic` |
| 개인키 | PEM 개인키 블록 0건. `PRIVATE KEY` 4건은 Go 표준 라이브러리의 형식 이름·오류 문구 | `grep -ac -e '-----BEGIN [A-Z ]*PRIVATE KEY-----'` · 문맥 추출 |
| Windows 코드 서명 | **bootstrap·installer·agent 3종 전부 `NotSigned`** | PowerShell `Get-AuthenticodeSignature` |
| 기동 무결성 | 슈퍼바이저 시작(`supervisor.go:128` → `Recover`)과 활성화·롤백에서 자식 파일 SHA-256을 디스크에서 다시 계산해 서명된 `ChildDigest`와 대조 | `bootstrap/handoff.go` `Resolve` · `recovery.go:66` |
| 업데이트 서명 | ed25519 검증 5곳(매니페스트·신뢰 정책·스냅샷) · 서명 대상마다 도메인 분리 문자열 | `grep -rn ed25519.Verify` |
| 다운그레이드 | 업데이트는 엄격히 큰 버전만(`plan.go:49`·`child_executor.go:405`) · 롤백은 기록된 직전 버전만(`bootstrap/activation.go:30`) · 신뢰 정책 세대 역행 거부(`release/trust.go:60`) · `AllowDowngrade` 필드는 정의만 있고 읽는 코드 0곳 | 코드 |
| 인증 | 토큰 `randomBytes(32)` · 서버는 SHA-256만 저장 · `subtle.ConstantTimeCompare` · 허용 IP 목록이 비면 거부 | `web/api/routes/agents.js:25` · `session/grpc_server.go` `verifyAgent` |
| 전송 | **운영 게이트웨이(.65)에 9443만 LISTEN, 9090 없음**(0913 `ss -tln`) · mTLS는 코드 준비·미설정(`0-E`) | 서버 실측 |
| 파일 권한 | Windows 설정 파일 = 상속 끊은 DACL(SYSTEM·Administrators 전체 · 에이전트 전용 SID 읽기) · Linux = 전용 UID 읽기 · 자식은 root 아닌 계정 | `installer/windows.go:620` · `linux.go:679` |
| 로컬 데이터 | 상태 저널 필드 = `agent_id`·`table`·`source_seq`·`state`·`msg_type`·`updated_at`(번호·본문 없음) · **설정 YAML에 `source.password`·`gateway.token` 평문** · `cfgcrypt`는 수동 CLI에만 있고 설치 흐름 미사용 | `poller/state_journal.go:24` · `config.go:205·252` |
| 서명 권한 | `deploy/build-agent.sh init-authority`가 `release.pem`·`recovery.pem`을 **같은 `AUTHORITY_ROOT/private`**에 생성(기본 `/var/lib/bito-agent-release/authority`) · `build`는 복구 **공개키**만 읽고 `public/` 출처를 강제(263줄) · **.65에 `/var/lib/bito-agent-release` 존재**(일반 계정 `Permission denied`로 확인 · 내부 키 파일 존재는 root 확인 필요) · 보관 서버·복구 키 분리를 적은 문서 0건 | 스크립트 · 서버 실측 · 문서 grep |
| 경계 검사 | 빌드가 6개 바이너리 전부에 `sanitize_agent_binary.py` + `verify_customer_delivery_full_boundary.py` 실행 · **금지 목록에 단독 `invito`가 없어 `gw.invito.local`이 통과** | `build-agent.sh:141·304·307·345` · 검사기 `FORBIDDEN_BYTES` |

**이미 내려진 결정(뒤집지 않는다)**: Garble 난독화는 Windows Defender가 실제로 PUA 차단해 고객 배포본에 쓰지 않는다(게이트웨이 저장소 `status/AGENT_MANUAL.md:1589` · `docs/superpowers/specs/2026-07-17-customer-delivery-zero-internal-strings-v208-design.md`).

### 8-3. 잔여와 처방 (위험 큰 순)

**A1. 복구 루트 개인키 오프라인 분리 — 최우선 · 코드 변경 0**
- 위험: 서명 키 두 벌과 승인 기록 DB가 같은 서버에 있다. 서버를 장악당하면 승인 행을 직접 쓰고 릴리스 키로 서명해 전 에이전트에 코드를 내릴 수 있다. 여기까지는 구조상 막기 어렵다. **복구 키까지 그 서버에 있으면 회복 수단도 함께 넘어간다**(새 세대 신뢰 정책을 공격자가 먼저 서명한다).
- 처방: `private/recovery.pem`만 서버에서 떼어 오프라인 매체 두 곳에 보관한다. `release.pem`은 평소 서명에 필요하므로 남긴다.
- 영향: **평소 릴리스 무영향**(`build`는 복구 공개키만 읽음 · 코드 확인). 복구 개인키가 필요한 때 = 신뢰 정책 재발급(`build-trust-policy`)뿐 = 릴리스 키 교체·유출 회복.
- 절차: root 작업이라 대표님 운영 절차로 한다. ①오프라인 매체 2곳 복사 ②두 사본 해시를 원본과 대조 ③서버에서 삭제 ④다음 릴리스 `build`가 정상인지로 확인 ⑤보관 위치·보관자·해시를 이 절에 기록(키 값은 기록하지 않는다).
- ⛔ `init-authority`는 키를 새로 만드는 명령이다. 운영 중 재실행하지 않는다(지금 이 경고가 어디에도 없다).

**A2. Windows 실행 파일 코드 서명**
- 위험: 업데이트는 ed25519로 막혀 있지만 **고객사가 처음 받는 설치 파일은 발행자를 운영체제가 확인할 수 없다.** 전달 중 바꿔치기돼도 고객사는 모르고, SmartScreen·백신 경고도 여기서 난다.
- 후보: OV 코드서명 인증서 / EV 코드서명 인증서. **추천 = 설치기·부트스트랩부터 서명 + RFC 3161 타임스탬프.** 인증서 종류별 비용·발급 기간·SmartScreen 평판 차이, 서명이 Defender PUA 판정에 주는 영향은 **미검증**(조달 전 확인).
- ⛔ **순서 고정: 정리기 → 경계 검사 → Authenticode 서명 → 서명 검증 → SHA-256 산출 → 서명 매니페스트.** 서명은 바이트를 바꾼다. 서명 전 해시를 매니페스트에 실으면 부트스트랩 `Resolve`가 기동 때 해시 불일치로 자식을 거부한다.
- 확인 필요(미검증): 경계 검사기가 서명 블록의 인증서 문자열을 금지 패턴으로 오탐하지 않는지.

**A3. 설치 묶음 해시 공개**
- 사실: `deploy/agent/*windows-amd64.zip` 옆에 `.sha256`이 없다(0913 확인 범위). 안내서 PDF에는 있다.
- 처방: 발급 화면과 안내서에 설치 묶음 SHA-256과 대조 방법(PowerShell `Get-FileHash`)을 싣는다. A2 서명 이후 해시로 싣는다.

**A4. 출고본의 회사명 잔존과 검사기 누락**
- 사실: `gw.invito.local`이 소스 3곳에서 기본값·예시로 들어가 두 출고본에 남는다 — `internal/agent/onboarding/install_bundle.go:160` · `internal/agent/setup/wizard.go:95` · `cmd/agent/main.go:2446`. 검사기는 `github.com/invito/bito-gateway`·`INVITO_MMS`만 막는다.
- 처방: 세 곳을 중립 예시 호스트로 바꾸고, 검사기 `internal customer/provider`에 금지 패턴을 더한다. 추가 뒤 기존 공개자료 전체를 재검사해 오탐을 확인한다.
- Go 소스 변경이라 재빌드·릴리즈가 따른다. **단독 릴리즈를 만들지 않고 다음 릴리즈(1.0.28은 이미 롤아웃 · `0-F`)에 합류**한다.
- **★0913 소스 반영(게이트웨이 저장소 미커밋)**: 세 곳 기본값 = `gateway.invalid`(예약 도메인이라 해석되지 않음 · 종전 값도 해석되지 않는 자리표시자라 동작 차이 없음 · 이 문자열을 읽는 로직 0곳 전수 확인). 검사기 = `invito\.local`. ⛔ **처음 설계한 단어 경계 `invito`는 기각**: 공개자료 재검사에서 안내서 9건이 걸렸다(발급 주체로 `INVITO`를 적는다). 막을 것은 회사명이 아니라 내부 호스트명이다. 검증 = 공개자료 `CUSTOMER_DELIVERY_BOUNDARY_OK files=14` · 1.0.20 출고본 `--blob` 차단 확인 · 계약 테스트 23건 통과(표본 차단 + 안내서 문장 통과 신설) · 검사기 호출처 전수(`build-agent.sh`·`build-agent.ps1`·`build-bito-agent.ps1`·arm64 예외 빌드 = 전부 **새로 빌드한 산출물**만 검사 · `scripts/gw/check.sh` = 공개자료 폴더) = 이미 빌드된 1.0.28 출고본을 다시 검사하는 경로 없음.

**A5. 설치 마법사 TLS 기본값**
- 사실: `setup/wizard.go:98` 기본 `false` · `configs/agents/sample-agent.yaml` `false` · 발급 경로(`system_config`)는 `true`.
- 판정: 게이트웨이 평문이 닫혀 있어 `false`면 접속 실패로 끝난다(fail-closed) = 보안 구멍이 아니라 사용성 문제.
- 처방: 기본값을 `true`로. A4와 같은 릴리즈에 합류.
- **★0913 소스 반영(미커밋)**: `setup/wizard.go` 기본 선택 = TLS 사용. 이 마법사는 `agent setup` 대화형 한 곳에서만 불린다(자동 입력으로 부르는 설치 스크립트 0곳 전수 확인). 이미 설치된 Agent의 설정 파일과 발급 경로는 무변경. `sample-agent.yaml`은 손대지 않았다(출고 자료 아님).

**A6. `AllowDowngrade` 필드**
- 사실: `release/types.go:55` 정의만 있고 읽는 코드 0곳. 다운그레이드는 plan·claim 단계에서 무조건 거부된다.
- 처방: **바로 지우지 않는다.** 서명 JSON은 엄격 디코딩 경로(`DisallowUnknownFields`)가 있어, 기존 서명 산출물에 이 키가 들어 있으면 필드 제거가 디코딩 실패가 된다(해당 구조체가 그 경로를 타는지 미검증). 먼저 "소비처 없음 · 다운그레이드는 plan/claim이 거부" 주석으로 고정하고, 기존 산출물 키 존재를 확인한 뒤에만 제거한다.
- **★0913 확인·반영(미커밋)**: 기존 서명 산출물에 키가 **있다**(`deploy/agent/.release-build/1.0.20/signed/*/release-descriptor.json` `"allow_downgrade":false`) · 엄격 디코딩 경로 `bootstrap/handoff.go:222`·`store.go:382`. **따라서 필드는 영구히 지우지 않는다.** 주석은 구조체 위에 달았다(필드 사이에 달면 gofmt가 정렬을 다시 잡아 diff가 커진다) · 코드 동작 변경 0.

**A7. 역분석 잔여 단서 — 수용**
- 함수명·gRPC 메서드·한글 오류문·SQL 문장은 남는다. 알아도 8-1의 관문(토큰·허용 IP·TLS·서명·승인)을 넘지 못한다.
- 난독화는 0717 결정(Defender PUA 차단)대로 쓰지 않는다. 오류문을 숨기면 고객사 현장 진단이 막히는 비용이 더 크다.

**A8. 설정 파일 평문 — 수용**
- DB 비밀번호·게이트웨이 토큰이 YAML 평문이다. 방어는 파일 권한(8-2)이 맡고, 토큰은 허용 IP에 묶여 새도 다른 곳에서 못 쓴다.
- 같은 서버에 키를 두는 암호화(`cfgcrypt` 기본화)는 로컬 관리자에게 무의미해 실익이 작다. 토큰 단독 의존을 줄이는 길은 mTLS(`0-E`)다.

### 8-4. 적용 순서

| 순서 | 항목 | 성격 | 선행 조건 |
|---:|---|---|---|
| 1 | A1 복구 키 분리 | 운영 · 코드 0 | 오프라인 매체 2곳 |
| 2 | A4·A5 + A6 주석 | 소스 · 다음 릴리즈 합류 | 1.0.28 창(`0-F`) |
| 3 | A2 코드 서명 파이프라인 | 빌드 스크립트 · 인증서 | 인증서 조달 · 오탐 확인 |
| 4 | A3 해시 공개 | 발급 화면·안내서 | A2 완료(서명 후 해시) |

### 8-5. 완료 판정

- **A1**: root 세션에서 `private/`에 `release.pem`만 남음 · 다음 릴리스 `build` 성공 · 이 절에 보관 기록.
- **A2**: 로컬 PowerShell `Get-AuthenticodeSignature`가 3종 모두 `Valid` · 서명본으로 만든 릴리스를 부트스트랩이 기동해 `Recover` 해시 대조 통과.
- **A3**: 발급 화면·안내서 해시 = 실제 묶음 `Get-FileHash` 값.
- **A4**: 새 출고본 `grep -aic invito.local` = 0 · 검사기에 `gw.invito.local`을 넣은 표본이 차단되는지 계약 확인(**0913 계약 확인 완료** · 새 출고본 확인은 다음 릴리즈 빌드 때).
- **A5**: 마법사 기본 선택이 TLS 사용(**0913 소스 반영** · 단위 테스트 통과).
- **공통 회귀 기준(Harold 0913 "기존에 잘 되던 게 안 되면 안 된다")**: 수정 패키지 `go test`(setup·onboarding·release·cmd/agent) 통과 · 전체 `go test ./...`의 실패 2패키지(`cmd/agent-bootstrap`·`internal/agent/bootstrap`)는 Windows 로컬의 권한·파일 모드 테스트이고 이번 변경 파일을 포함하지 않는다(릴리즈 빌드 환경 Linux에서 재확인 대상).

### 8-6. 하지 않는 것

- Garble 등 난독화(0717 결정).
- 디버거 탐지·안티 디버깅(현재 코드에 없음 · 고객사 운영 도구와 충돌 위험 대비 효과 낮음).
- 설정 파일 암호화 기본화(A8).
