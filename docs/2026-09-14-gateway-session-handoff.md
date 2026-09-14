# 0914 게이트웨이 세션 인계: 링크가드 external3 시험 연결 종결·원복 · §8 A3·고객 배포자료 종결 · 이터널그룹 자료 · 다음 = §4 A9-나 (2026-09-14 12:1x 작성 · 14:2x 갱신)

> 이 문서는 **다음 세션이 바로 이어받을 자리와 Harold님이 실행할 순서**만 담는다. 사실·경위의 소유 문서는 링크가 가진다.
> 착수 첫 명령은 **현재 상태 확인**이다(아래 상태는 작성 시점 값).
> 명령마다 **실행 위치**를 적는다. `.62`·`.65` 호스트명이 둘 다 `invito`다. 명령은 **한 번에 하나씩** 드리고 결과를 본 뒤 다음을 드린다.
> 로컬 명령은 Windows PowerShell 5.1(`&&` 불가 → Git Bash 경유 또는 `;`) · 서버 명령은 이미 접속한 root 셸 기준(`sudo` 쓰지 않음 · 계정 전환은 `runuser -u <계정> --`).

## 0. 먼저 읽을 것

1. 이 문서 전체
2. 링크가드 쪽 요청 원문: `C:/Users/ceo/projects/linkguard/docs/handoff/2026-09-14-bito-external3-pilot.md`
3. 게이트웨이 접점: [FEATURE-GW-LINKGUARD.md](bito-gateway/FEATURE-GW-LINKGUARD.md) **§9 external3 시험 연결**(이번 세션 신설)
4. external3 호출 계약: `C:/Users/ceo/projects/linkguard/docs/integrations/LOCAL-MESSAGE-CHECK.md` · 소스 `linkguard/tmp/external-agent-minimal-20260912/source/internal/agent/local_http.go`·`local_mapping.go`·`local_customer_auth.go`·`config_external.go`
5. external3 설치 안내(ZIP 해제본, 4쪽): `C:\Users\ceo\Downloads\linkguard-external3-review\LinkGuard_설치_안내.pdf`

## 1. 현재 상태 스냅샷 (0914 14:2x 갱신)

| 구분 | 상태 | 근거 |
|---|---|---|
| 게이트웨이 `origin/main` | **`a33262b`** push 완료(`108443e` §8 A3 → `bb79582` §8 A4~A6 소스 → `0b4e839` external3 시험 연결 → `a4a93c9`·`a33262b` STATUS) · 미커밋 0 | Harold 실행 출력 |
| .65 게이트웨이 실행파일 | `0b4e839` = SHA256 `e22745e2…d530`(13:47:26 배포 · 롤백 백업 `deploy-backups/20260914-134715`) · 14:14:11 ENV 원복 재기동 · Agent 4대 재연결 · 외부 검사 ENV 없음 = 기존 동작 | Harold 실행 출력 |
| .65 운영 API | `routes/agents.js` `49982e018c55` · `services/agent-install-bundle.js` `bad3a308c0c9` · `routes/customer-downloads.js` `6a86e7153a91` | 재대조 출력 |
| .65 대시보드 | manifest `e44e03932ff1`(11:20 · 「7개 공개 파일」·묶음 발급 승인 버전 판정) | `GW_DEPLOY_OK` · 화면 확인 |
| 고객 배포자료 | **1.0.28 게시 완료**: 패키지 `05e8f3ce…`(linux)·`3acb4467…`(windows) · 안내서 `aed92147…`(부트스트랩 1.0.27 표기) · 체크섬 12/12 | FEATURE-GW-WEB-API §9-5 |
| §8 A3 | **종결**(시험 Agent `bito-test-99` 모달 해시 = `Get-FileHash`) | FEATURE-GW-SECURITY §8-3 A3 |
| **링크가드 external3 시험 연결** | **★0914 14:16 종결.** A1~A9 실측 완료(`0b4e839` 배포 · 8 캐시 차단 유지 · 9 ready false 미검사 통과) → **시험분 전부 원복**(ENV 제거·external3 삭제·시험 자격 회수·시험 URL 해제 · 코드는 ENV 없으면 기존 동작이라 유지). 링크가드 쪽 결과 문서 = `C:/Users/ceo/projects/linkguard/docs/handoff/2026-09-14-bito-external3-pilot-result.md`. 이 문서 §2 는 다시 켤 때의 절차로만 남는다 | 결과 = FEATURE-GW-LINKGUARD §9-4 |
| .65 external3 설치 | **없음**(13:0x 설치 → 14:16 삭제 확인: `uninstall-service` exit 0 · 8471 0 · `linkguard` 계정·그룹·폴더 3개 없음 · 유닛은 `linkguard-control`만) · 관제 시험 자격 `lg-e116e71296a7dc98` 회수 14:14:47 · 시험 URL 비활성 14:15:16 · 운영 `bito-gateway` 자격 정상 동기화 | Harold 실행 출력 |
| .65 자원 | CPU 20 · 메모리 31.8GiB(가용 28GiB) · 디스크 여유 825G · `bito-gateway` = `User=ubuntu` · 상한 없음 | 같은 출력 |
| 게이트웨이 저장소 미커밋 | **없음**(`a33262b` push 뒤 `git status --short` 빈 출력) | Harold 실행 출력 |
| 한줄로 저장소 미커밋(문서) | `docs/bito-gateway/FEATURE-GW-SECURITY.md`·`FEATURE-GW-WEB-API.md`·`FEATURE-GW-LINKGUARD.md` · 이 인계 문서 | **게이트웨이 세션에서는 `tp-push`를 요청하지 않는다** — 한줄로 세션의 다음 `tp-push`에 실린다 |
| 링크가드 저장소(신규 파일) | `docs/handoff/2026-09-14-bito-external3-pilot-result.md` = 링크가드 쪽 결과 전달 문서 · 커밋은 링크가드 쪽 | Harold 가 링크가드 담당에게 전달 |
| **링크가드 external4 설치 관통 시험** | **★0914 중단·원복.** ZIP 해시 일치(`98e3009d…`) 뒤 한글 이름 항목 2개가 python 해제에서 깨져 `SHA256SUMS` 대조 2건 FAILED → `install-agent.sh` 미실행. .65 입력 토큰 `shred`·업로드 폴더 삭제·로컬 사본 삭제 확인 · **관제 시험 자격 `lg-6d18c5ab15fc783e` 회수 미확인** · 게이트웨이 무변경. 전달 = `linkguard/docs/handoff/2026-09-14-bito-external4-install-test-result.md`. **재시험 = 링크가드 수정본 수령 때(Harold)** | Harold 실행 출력 |
| 이터널그룹 | 전달 자료 준비 완료: `C:\Users\ceo\Downloads\Bito-Agent-Integration-20260914.zip`(148,954바이트 · 6파일 · 원본 해시 일치). **발송은 Harold · 회신 대기** | 이 문서 §3 |

## 2. 트랙 A — 링크가드 external3 시험 연결 (★0914 종결·원복 · 아래는 다시 켤 때의 절차 기록)

> 결과 = [FEATURE-GW-LINKGUARD.md](bito-gateway/FEATURE-GW-LINKGUARD.md) §9-4 · 링크가드 전달 = `linkguard/docs/handoff/2026-09-14-bito-external3-pilot-result.md`. 다시 켤 때 실제로 달랐던 점: 설치 파일은 한글 이름 2개를 빼고 올림(PowerShell 5.1) · 호출 인증 파일은 게이트웨이가 ENV 로 받으므로 `/etc/linkguard` 700 유지 · 방화벽 적용 직후 첫 동기화 실패는 10초 시간초과(열린 연결) · 9 사유 = `customer_policy_unavailable` · 게이트웨이 재기동 = Agent 4대 1초 안 재연결(3회) · 랩디(REST) 는 재기동 중 503 · 우리 쪽 자동 재발송 없음 → 배포 직전 `message_request` 최근 접수 확인.

### 2-0. 합의된 범위 (Harold 0914 "네 추천하는 방식으로 진행")

- **시험 위치** = .65 운영 게이트웨이. external3는 호출부와 같은 서버 loopback 에만 받으므로(`config.go:107-114`) 별도 게이트웨이 없이 **시험 문자만 골라** 연결한다.
- **시험 경로** = Agent **`hanjul03`**(Harold 지정: 실제 차단이 되는지 실경로로 확인) **AND** 수신번호가 **시험번호 목록**에 있는 문자만. 같은 hanjul03 의 고객사 문자·다른 Agent 는 기존 내장 검사 그대로(50ms 지연·busy 미검사가 고객 문자에 생기지 않게 · 이 조건은 구현 때 좁혔다 — 다음 세션 첫 보고에 한 줄로 알릴 것).
- 시험 문자는 **내장 검사를 건너뛴다**(같은 문안 중복 검사 금지). 운영 검사 전체는 끄지 않는다.
- 관제 자격 = **시험 전용 새 자격**(예: `bito-external3-pilot`). 기존 `bito-gateway` 자격 재사용·회전 금지.
- 호출 인증 = **caller token 사용**(고객 미지정 프로필은 토큰 파일이 없으면 무인증 · `local_customer_auth.go:61-63`).
- 가동 중 관제 단절 재현 = **`linkguard` 계정 한정 임시 방화벽 규칙**(관제센터 중지는 운영 게이트웨이 동기화까지 끊으므로 금지).
- A4~A6 Go 커밋 = 게이트웨이 빌드 전에 필요(`build.sh:21-23` 미커밋 거부) — 커밋 명령은 빌드 단계에서 파일 목록을 박아 드린다.
- 자원 상한 추천 = external3 드롭인 `MemoryMax=1G` · `CPUQuota=200%`(미검증 시작값 · 링크가드 쪽과 확정 · PDF 4쪽).

### 2-1. 이번 세션에 반영한 코드 (게이트웨이 저장소 · 미커밋 · **컴파일 미확인**)

| 파일 | 내용 |
|---|---|
| `internal/gateway/engine/urlguard_external.go`(신규) | 고정 loopback `/check` · 문안당 1회 · 재시도 0 · 50ms · 응답 8KiB · 동시 8(초과 = `caller_busy`) · 연결 재사용 안 함 · 리다이렉트 안 따라감 · **엄격 판정**(HTTP 200·JSON·ID 일치·다섯 필드 정확히·`policy_head` 음 아닌 정수·중복 키·중첩·뒤따르는 값 거부) · `block`+`inspected`+`registered_url`만 기존 `URL_BLOCKED`(Detail `via=linkguard_external`) · 그 외 전부 통과 + 구조화 로그(`path=linkguard_external decision reason policyHead`) · 게이트웨이 hits 미적재 |
| `internal/gateway/engine/urlguard.go` | `checkForCustomer` 첫머리 분기 3줄(`g.external.applies(msg)` → `checkExternal`) · 구조체 필드 `external` |
| `internal/gateway/engine/engine.go` | `EngineConfig.URLGuardExternal` · `New()`에서 조립(내장 가드 없거나 설정 오류면 **오류 로그 후 미적용 · 기동 계속**) |
| `cmd/gateway/main.go` | ENV 읽기 `parseLinkGuardExternalConfig` — **전부 비면 nil = 기존 동작 그대로** |
| `internal/gateway/engine/urlguard_external_test.go`(신규) | 설정 검증 · 적용 조건 · 필드 이름 수 대조 · 판정 7종 · 잘못된 응답 13종 · 시간초과(150ms 이내 복귀)·중지·busy · 전달 필드 6개·원문 불변·번호 미전달 · 시험 문자만 외부·내장 중복 없음·hits 0·토글 off 무호출·다른 수신자/Agent 내장 그대로 |

전달 필드(`urlGuardRecipientFields` 순서) = `message`·`title`·`kakao_buttons`·`kakao_payload`·`kakao_alt_msg`·`kakao_failover_title`(버튼·페이로드는 원문 JSON 문자열 그대로 = 내장 검사와 같은 기준). 검사 호출 위치 = 두 접수 경로 모두 `checkForCustomer` 로 모인다(`policy.go:213` · `ingress_profile.go:257`).

ENV(`/etc/default/bito-gateway` · root 600 · 전부 비면 미적용):

```text
GW_LINKGUARD_EXTERNAL_CHECK_URL=http://127.0.0.1:8471/check
GW_LINKGUARD_EXTERNAL_PROFILE=bito_gateway
GW_LINKGUARD_EXTERNAL_CALLER_TOKEN=<caller token 원문 · 서버에서 파일로부터 넣는다 · 화면에 찍지 않는다>
GW_LINKGUARD_EXTERNAL_AGENT_IDS=hanjul03
GW_LINKGUARD_EXTERNAL_TEST_PHONES=<Harold 지정 시험번호 · 쉼표 구분>
```

게이트웨이는 `ubuntu` 로 돌고 `/etc/linkguard` 는 `linkguard` 0700 이라 토큰 파일을 못 읽는다 → **게이트웨이는 ENV 원문(systemd 가 root 로 읽는 파일)** · external3 는 `/etc/linkguard/caller-bito-gateway`. `_FILE` 변형도 코드에 있으나 이 배치에서는 쓰지 않는다.

### 2-2. 다음 순서

| # | 단계 | 실행 위치 | 완료 표시 |
|---:|---|---|---|
| A1 | gofmt·vet·test(엔진·cmd/gateway) | 로컬 PowerShell | `GOFMT_DONE` 위 파일명 0 · `ok` 2줄 |
| A2 | Harold 정보 수령: **시험 수신번호** · **시험 문자를 hanjul03 으로 태우는 방법**(한줄로 어느 화면·회사 계정) | 대화 | 두 값 확정 |
| A3 | hanjul03 계정·정책·과금·라우팅 읽기 전용 확인(아래 SQL) | .65 root | 활성 · `url_guard_enabled` 합성 true |
| A4 | 관제 화면에서 시험 자격 발급(kind=agent · 허용 IP `58.227.193.65`·`127.0.0.1` = 기존 `bito-gateway` 자격과 같은 출발지 · 토큰 1회 표시) | 관제 화면 | 자격 ID 확보 |
| A5 | external3 설치: 계정·폴더 → 실행파일(해시 `5b0af3c3…` 대조) → `agent.yaml`·`token`·caller token → `check-config` → `sync-once`(`ready=true`) → `install-service` → `service-status` → `User=linkguard`/`Group=linkguard` → 자원 드롭인 → `/healthz` | 로컬 scp → .65 root | `ready=true` |
| A6 | `/check` 직접 호출(정상·미등록 URL·등록 차단 URL · caller token 헤더) — 게이트웨이 연결 전 | .65 root | pass/pass/block |
| A7 | 커밋(A4~A6 Go + 시험 연결 5파일 · 파일 목록 명시) → `check.sh` → `build.sh gateway` → 업로드 → `deploy.sh gateway`(재기동 약 3초 · 발송 적은 시간) | 로컬 → .65 | `GW_DEPLOY_OK gateway` |
| A8 | ENV 5개 추가 → `systemctl restart bito-gateway` → 로그 「링크가드 외부 검사 시험 연결 활성」 | .65 root | 활성 로그 |
| A9 | 실측(§2-4 표) | 한줄로 발송 + .65 | 표 전 항목 |
| A10 | 결과 기록: FEATURE-GW-LINKGUARD §9-4 · 링크가드 쪽 최종 보고 항목(요청 원문 45행: 실행 버전·해시 · 서비스 계정/상태 · 시험 경로 · 정상/차단/장애/재시작 · 원문·발송횟수·과금/결과 보존 근거 · 남은 항목) | 문서 | — |

**A1 명령**(그대로 드린다):

▶ 실행 위치: 로컬 PowerShell
```bash
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /c/Users/ceo/projects/bito-gateway && gofmt -l internal/gateway/engine/urlguard_external.go internal/gateway/engine/urlguard_external_test.go internal/gateway/engine/urlguard.go internal/gateway/engine/engine.go cmd/gateway/main.go; echo GOFMT_DONE; go vet ./internal/gateway/engine/ ./cmd/gateway/ && go test ./internal/gateway/engine/ ./cmd/gateway/ -count=1 2>&1 | tail -n 40"
```
gofmt 가 파일을 내면 = 정렬만 다른 것(특히 테스트의 한 줄 여러 키 composite literal) → 해당 파일만 고친다. 실패 출력은 전문을 받아 고친다.

**A3 SQL**(`bito-agent-01` 로 준비했던 것을 `hanjul03` 으로 바꾼 것 · 컬럼 = `policy.go:234-294`·`migrations/038`·`SCHEMA.md §2-12`):

▶ 실행 위치: .65 (게이트웨이 서버) · root 셸
```bash
docker exec bito-bench-postgres psql -U bito -d bito_gateway \
 -c "SELECT aa.agent_id, aa.is_active, aa.sender_account_id, aa.reseller_id, sa.customer_id, sa.is_active AS sender_active, LOWER(COALESCE(sa.billing_type, aa.billing_type, r.billing_type, 'prepaid')) AS effective_billing_type FROM agent_account aa LEFT JOIN sender_account sa ON sa.id = aa.sender_account_id LEFT JOIN reseller r ON r.id = COALESCE(sa.customer_id, aa.reseller_id) WHERE aa.agent_id = 'hanjul03';" \
 -c "SELECT sp.id, sp.scope_type, sp.customer_id, sp.sender_account_id, sp.url_guard_enabled, sp.url_guard_unknown_check FROM send_policy sp CROSS JOIN agent_account aa LEFT JOIN sender_account sa ON sa.id = aa.sender_account_id WHERE aa.agent_id = 'hanjul03' AND sp.is_active = TRUE AND (sp.scope_type = 'global' OR (sp.scope_type = 'customer' AND sp.customer_id = COALESCE(sa.customer_id, aa.reseller_id)) OR (sp.scope_type = 'sender' AND sp.sender_account_id = aa.sender_account_id)) ORDER BY sp.id;" \
 -c "SELECT arm.msg_category, arm.route_slot, arm.route_config_id, arm.is_active FROM agent_route_map arm WHERE arm.agent_id = 'hanjul03' ORDER BY arm.msg_category, arm.route_slot;"
```

### 2-3. external3 설정 초안 (A5에서 확정 · **`control:` 키 이름은 external3 소스 `ControlConfig` 로 먼저 확인** — 여기 값은 `deploy/local-agent/linkguard-agent.yaml.example`(dev-20260906) 기준이라 미검증)

`/etc/linkguard/agent.yaml`(linkguard 0600 · 경로는 설치 PDF 2쪽):

```yaml
mode: local_api
credential_id: <A4에서 발급한 시험 자격 ID>
token_file: /etc/linkguard/token
control:
  base_url: https://linkguard.hanjulgw.com
  sync_interval: 30s
  request_timeout: 10s
state_dir: /var/lib/linkguard
log_level: info
local_check_api:
  enabled: true
  listen: 127.0.0.1:8471
  check_timeout: 40ms
  max_concurrent: 8
profiles:
  bito_gateway:
    caller_token_file: /etc/linkguard/caller-bito-gateway
    fields:
      - path: message
        required: true
      - path: title
        required: false
      - path: kakao_buttons
        required: false
      - path: kakao_payload
        required: false
      - path: kakao_alt_msg
        required: false
      - path: kakao_failover_title
        required: false
```

- 필수 필드 `message`: 빈 문자열은 유효(게이트웨이는 6필드를 항상 문자열로 보낸다). 선택 문자열 합계 32KiB·요청 64KiB 초과 = external3 `413 input_too_large` → 게이트웨이 `unavailable` 로 1회 발송.
- caller token 은 서버에서 만들고 화면에 찍지 않는다(32~4096 출력 가능 ASCII · 예: `umask 077; head -c 48 /dev/urandom | base64 | tr -d '\n=+/' > /etc/linkguard/caller-bito-gateway` 뒤 `chown linkguard:linkguard`).
- 설치 PDF 의 `sudo -u linkguard …` 는 `runuser -u linkguard -- …` 로 바꿔 드린다.
- 설치 명령은 **A5 착수 직전 .65 상태를 다시 확인한 뒤** 하나씩 드린다(0914 사전 확인 값은 시점 값).

### 2-4. 실측 표 (A9 · 실제 문자는 A2 시험번호에만)

| # | 시나리오 | 방법 | 기대 | 증거 |
|---:|---|---|---|---|
| 1 | 정상 문안(URL 없음) | 시험번호로 1건 | 발송 1회 · `decision=pass` | 게이트웨이 로그 · `message_request` 1행 · 수신 |
| 2 | 미등록 URL | 원장에 없는 `…invalid` 주소 | 발송 1회 · pass(`no_block_match`) | 같음 |
| 3 | 등록 차단 URL | 관제 원장에 `http://linkguard-test.invalid/<고유값>` 차단 등록 → 그 주소 문자 | **발송 0** · `URL_BLOCKED` · `policy_block_event` detail `via=linkguard_external` · 한줄로 결과 실패 · **관제 판정 이력 = 시험 자격** | SQL·관제 화면 |
| 4 | 비시험 문자 대조 | 같은 주소를 시험번호 아닌 내부 번호로(선택) | 내장 검사로 차단 · 외부 호출 없음 | 로그에 `linkguard_external` 없음 |
| 5 | Agent 중지 | `systemctl stop linkguard-agent` 뒤 1건 | 발송 1회 · `transport_error` | 로그 |
| 6 | 호출 인증 오류 | external3 caller token 파일만 바꾸고 재시작 → 1건 → 원복 | 발송 1회 · `http_status_401:caller_unauthorized` | 로그 |
| 7 | 서비스 재시작 | `systemctl restart linkguard-agent` → `ready=true` → 1·3 반복 | 같은 결과 | healthz · 로그 |
| 8 | **가동 중 관제 단절** | `iptables -I OUTPUT -p tcp --dport 443 -m owner --uid-owner linkguard -j REJECT` → 3 반복 → 규칙 삭제 | **캐시로 차단 유지**(발송 0) | 로그 · healthz `stale` |
| 9 | **단절 상태에서 Agent 재시작** | 규칙 유지 → restart → healthz `ready=false` → 3 반복 → 규칙 삭제 → `ready=true` | **미검사 bypass**(`policy_unavailable`) · 발송 1회 · 사유 기록 | 로그 · healthz |
| 10 | 보존 | 1~9 전 건 | 원문·수신·발신·유형·예약 = 입력 · 발송 횟수 = 기대(중복 0) · 과금 = 발송 건만 · 결과코드 | `message_request`·과금·결과 SQL(A9 때 컬럼 확인 후) |

- **8 과 9 를 둘 다 「장애 중 차단 성공」으로 기록하지 않는다**(요청 원문 §7).
- 시간초과(Agent 판정 40ms 초과)는 실서버에서 만들기 어렵다 → 단위 테스트로만 확인했다고 기록.
- 방화벽 규칙은 Harold 실행 · 넣기 전에 `ufw`와 공존 여부를 읽기 전용으로 먼저 본다(미검증).
- external3 는 내장 검사와 **기능상 중복**이다. 시험 성공을 「운영 검사 교체 필요」로 해석하지 않는다(요청 원문 31행).

### 2-5. 복구

| 범위 | 방법 |
|---|---|
| external3 만 멈춤 | `systemctl stop linkguard-agent` → 게이트웨이는 `transport_error` 로 1회 발송(발송 멈추지 않음) |
| 외부 검사 경로 끄기 | `/etc/default/bito-gateway` 에서 `GW_LINKGUARD_EXTERNAL_*` 삭제 → `systemctl restart bito-gateway`(시험 문자도 내장 검사로 복귀) |
| 바이너리 원복 | `deploy-backups/<시각>/` 직전 바이너리(런북 §3-3) |
| 완전 제거 | `/opt/linkguard/linkguard-agent uninstall-service -config /etc/linkguard/agent.yaml` → 폴더·계정 삭제 → 관제 화면 시험 자격 회수 → 원장 시험 항목 비활성 → 방화벽 규칙 잔존 0 확인 |

## 3. 트랙 B — 이터널그룹 신규 연동 자료

- 요청(Harold 전달): "연동 가능 시점 및 매뉴얼 우선 전달(스키마 구성)". **이전 약속 기록은 없다**(Harold 확인 · 메모리·문서 검색 0).
- 준비물 = `C:\Users\ceo\Downloads\Bito-Agent-Integration-20260914.zip` — `schema-{mysql-mariadb,postgresql,mssql,oracle}.sql` · `DB-Schema-Guide.md`(= `bito-gateway/docs/customer-agent-schema/v1.0/README.md`) · `Bito-Agent-Install-Manual-v1.0.28.pdf`(`aed92147…`). 6파일 모두 원본 해시 일치(세션 중 대조).
- **보내지 않은 것** = `agent-config.*.example.yaml` 4종: 게이트웨이 포트 `9090`(운영 9443) · 폐지된 친구톡 유형. 설정 파일은 계정 발급 때 설치 묶음으로 나간다.
- 고객사 회신으로 받을 것: ① 연동 방식(DB·Agent / API) ② DB 종류·버전·기존 발송 테이블 여부 ③ Agent 서버 OS·공인 출발지 IP ④ 발송 유형(카카오·발신프로필) ⑤ 발신번호 목록(사전 등록) ⑥ 매장·지점별 청구 필요 여부(`bill_id`).
- 회신 오면: 연결 마법사로 고객사·발송계정·Agent 발급 → 허용 IP → 설치 묶음 발급(1.0.28 · 오늘 실측으로 발급 가능 확인). 0908 기록상 발급에 서버 작업 불필요(현재 상태로 재확인 필요).
- 안내 문구 초안은 0914 세션 대화에 있다(요지 = 첨부 3종 · `message_type` 값 `SMS·LMS·MMS·KAKAO_ALIM·KAKAO_ALIM_IMAGE·KAKAO_BRAND_BASIC·KAKAO_BRAND_FREE` · 설정 파일은 발급 묶음 · Agent DB 계정 SELECT·UPDATE · `edge.hanjulgw.com 9443/TCP` 아웃바운드 · 회신 6항목 · 연동 가능 시점은 Harold 기입).

## 4. 트랙 C — 게이트웨이 보안 §8 나머지 (소유 = FEATURE-GW-SECURITY §8-4)

| # | 항목 | 상태 |
|---:|---|---|
| 3 | A9-나 유출 시 재설치 절차 + 시험 에이전트 리허설 | **★0914 보류(Harold)** · 절차 초안 = FEATURE-GW-SECURITY §8-7(미검증) · 보류 사유·재개 조건 = §8-8 |
| 4 | A2 Windows 코드서명 인증서 | Harold 구매 결정 대기 |
| 5 | 1.0.29 릴리즈(A2 서명 + A4·A5·A6 · 새 설치 게시만) · A1 `build` 확인 | A2 뒤 · **승인 전에 고객 배포자료 게시 먼저**(FEATURE-GW-WEB-API §9-5 규칙) |
| 6 | .66 백업 | 별도 축 |

## 5. 기록만 한 것 (착수 판단 대기)

- `web/api/services/agent-config.js:306-308` — **발급 설정 생성기가 아직 친구톡 유형 3개를 싣는다**(친구톡 폐지 · REST 신규 발송 400).
- `docs/customer-agent-schema/v1.0/agent-config.*.example.yaml` 4종 — 포트 `9090` · 친구톡 유형(고객 전달에서는 뺐다).
- 발급 감사 기록 `bundle_sha256` — 배포 뒤 발급이 없어 운영 기록 미확인 → 다음 실제 발급 1건의 `ISSUE_INSTALL_BUNDLE` detail 로 확인.
- 릴리즈 게시 자동화(빌드 산출물 → `/opt/bito-gateway/app/Bito Agent/`) — 새 배포 스크립트라 게이트웨이 CODEX 규율 2(근거 보고 먼저). 지금은 KPI 가 누락을 「불가」로 보인다.
- (닫음) `agent-control-enrollment.js:44` 헤더 = 결함 아님(값 전부 커밋 전 검증) · 1.0.26 체크섬 파일·안내서 표기 = 소비처 없음.

## 6. 하지 말 것

- external3 **재빌드·추가 난독화·선택45/최종17항목·회귀/부하/KISA 시험 반복 금지**(요청 원문 19행).
- **링크가드 시험 작업에서 AI 가 직접 명령·CLI·자식 프로세스·서버 접속을 하지 않는다**(요청 원문 43행) — 로컬 파일 읽기·쓰기와 Harold 실행 결과 검토로만.
- 기존 `bito-gateway` 관제 자격 재사용·회전 금지 · 운영 내장 검사 전체 끄기·일괄 교체 금지 · 관제센터 중지로 단절 재현 금지.
- QTmsg/58 변경 · 고객사 이전 · 고객별 정책 연결 · KISA 운영 연동 금지.
- 시험번호 밖 실발송 금지(미정이면 외부 발송 없이 시험).
- `deploy/build-agent.sh build` 를 확인용으로 돌리지 않는다(게시 폴더를 비운다) · `init-authority` 재실행 금지.
- 게이트웨이 세션에서 한줄로 `tp-push` 요청 금지.
- A3·고객 배포자료 판정 재배포 불필요(운영 해시 §1).

## 7. 다음 세션 진입 명령

**작업 디렉터리 `C:\Users\ceo\projects\targetup`**

```text
0914 게이트웨이 인계 이어가자. docs/2026-09-14-gateway-session-handoff.md 먼저 정독하고 현재 상태 확인부터 시작해
```

- ★0914 갱신: A9-나는 **보류**(FEATURE-GW-SECURITY §8-8 재개 조건). §4 3번으로 시작하지 않는다.
- ★0914 external4: 링크가드 수정 패키지가 오면 설치 관통 시험을 **처음부터** 다시 한다(범위 = 게이트웨이 연결·재기동·실발송 없음 · 단계 = 결과 문서 §1·§6). 첫 조치 = 관제 자격 `lg-6d18c5ab15fc783e` 회수 여부 확인.
- external3 시험 연결은 종결이다. 링크가드 쪽 회신이 오면 그 내용만 검토한다(재시험은 Harold 지시 때만 · §2 절차).
- 이터널그룹 회신이 오면 §3 순서.
