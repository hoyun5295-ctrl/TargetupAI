# 0914 게이트웨이 세션 인계: 아이티앤 「진행 중」 26건 정정 배포·화면 확인 완료 · external4 r1 설치 관통 통과 · A9-나 보류 · external3 종결 · 다음 = §0 순서 (2026-09-14 12:1x 작성 · 22:0x 최종 · 밤 §0-1·2 확인 반영)

> 이 문서는 **다음 세션이 바로 이어받을 자리와 Harold님이 실행할 순서**만 담는다. 사실·경위의 소유 문서는 링크가 가진다.
> 착수 첫 명령은 **현재 상태 확인**이다(아래 상태는 작성 시점 값).
> 명령마다 **실행 위치**를 적는다. `.62`·`.65` 호스트명이 둘 다 `invito`다. 명령은 **한 번에 하나씩** 드리고 결과를 본 뒤 다음을 드린다.
> 로컬 명령은 Windows PowerShell 5.1(`&&` 불가 → Git Bash 경유 또는 `;`) · 서버 명령은 이미 접속한 root 셸 기준(`sudo` 쓰지 않음 · 계정 전환은 `runuser -u <계정> --`).

## 0. 다음 세션 시작 순서 (★0914 22:0x 최종)

| # | 할 일 | 실행 위치 | 판정 | 상세 |
|---:|---|---|---|---|
| 1 | ~~현재 상태 확인~~ **0914 밤 확인 = 인계 시점과 동일**(HEAD·origin `795fb47` · 미커밋 0 · `result-code.js` `5b560afe…d642` · `stats.js` `8bb89228…cc00` · `bito-admin-api` active 21:35:32) | 로컬 PowerShell · .65 root | 일치 | §7-3 명령 |
| 2 | ~~아이티앤 화면 확인~~ **0914 밤 확인 = 기대값 그대로**(사용량 통계 9/9 `아이티앤_신규` 총 1,154 · 성공 1,078 · 실패 76 · 진행 중 0 · SMS 589·LMS 565 진행 0 · 「이관 준비 → 이전 게이트·준비도 → Agent 운용 상태」 `itensms03` 정상 · 결과 전달 대기 0 · 「결과지연」 없음). ※ 인계 원문의 「운영 대시보드」는 잘못된 이름 · 실제 메뉴는 앞의 경로(`App.jsx:107` `migration-readiness`) | 대시보드 | 일치 | §7-3 |
| 3 | **게이트웨이 문서 커밋·push** = 1·2 결과 반영분 `status/BUG_HISTORY.md`·`status/STATUS.md` 두 파일만(코드 0) | 로컬 PowerShell | `git status --short` = 정확히 그 2줄 → 커밋·push | §7-4 |
| 4 | **관제 시험 자격 `lg-6d18c5ab15fc783e` 회수 확인** | 링크가드 관제 화면 | 회수 상태 | §10 |
| 5 | ~~착수 축 선택~~ **★0914 밤 Harold 지시 = Agent 연결 신뢰도 축 전체 착수 → 코드 완료(§12)** | 대화 | `GW_CHECK_OK` | §12 |
| 6 | ~~§12 배포~~ **0914 밤 끝남** = 커밋 `2a79bbf` · 바이너리 23:34:42 · api 5파일 23:36~23:38 · dashboard 23:41:33 · 실측 1·4·5 통과 · 화면 2·3 확인 완료(0915 00:0x) · **후속 §12-7**(거절 줄 · 관제 미등록 판정) 커밋·api·dashboard 배포·화면 확인까지 완료 · 게이트웨이 status 2문서 마지막 커밋 = §12-8 | 로컬 PowerShell · .65 root · 대시보드 | 전부 통과 | §12 |
| 7 | 남은 축(Harold 선택): Agent 1.0.29(§8 · 반영 불가 결과 오류 코드 ACK) · 접수 2번 72시간(§9) · 기록만 항목(§5) | 대화 | — | §8·§9·§5 |

- 1·2 결과는 게이트웨이 `status/BUG_HISTORY.md` 2026-09-14(「화면 확인 완료 · 정정 종결」 · 남긴 것 ⑧ 친구톡 카드 추가)와 `status/STATUS.md` 0-J 에 반영했다(★0914 밤) → 3 에서 커밋.
- 변화 없는 트랙: external3 재가동 절차 §2(읽을 것 = 링크가드 요청 원문 `linkguard/docs/handoff/2026-09-14-bito-external3-pilot.md` · 호출 계약 `linkguard/docs/integrations/LOCAL-MESSAGE-CHECK.md`) · 이터널그룹 §3 · 보안 §8 §4.

## 1. 현재 상태 스냅샷 (0914 22:0x 최종 · 작성 시점 값)

| 구분 | 상태 | 근거 |
|---|---|---|
| 게이트웨이 `origin/main` | **`795fb47`** push 완료(`108443e` §8 A3 → `bb79582` §8 A4~A6 소스 → `0b4e839` external3 시험 연결 → `a4a93c9`·`a33262b` STATUS → ★`795fb47` 아이티앤 진행 중 정정 web/api·status 7파일) | Harold 실행 출력 |
| .65 게이트웨이 실행파일 | `0b4e839` = SHA256 `e22745e2…d530`(13:47:26 배포 · 롤백 백업 `deploy-backups/20260914-134715`) · 14:14:11 ENV 원복 재기동 · Agent 4대 재연결 · 외부 검사 ENV 없음 = 기존 동작 | Harold 실행 출력 |
| .65 운영 API | `routes/agents.js` `49982e018c55` · `services/agent-install-bundle.js` `bad3a308c0c9` · `routes/customer-downloads.js` `6a86e7153a91` · ★`services/result-code.js` `5b560afe…d642` · `routes/stats.js` `8bb89228…cc00`(0914 21:34~35 배포 · 백업 `deploy-backups/20260914-213430`·`20260914-213531` · `bito-admin-api` 21:35:32 기동) | 재대조 출력 · `GW_DEPLOY_OK` |
| .65 대시보드 | manifest `e44e03932ff1`(11:20 · 「7개 공개 파일」·묶음 발급 승인 버전 판정) | `GW_DEPLOY_OK` · 화면 확인 |
| 고객 배포자료 | **1.0.28 게시 완료**: 패키지 `05e8f3ce…`(linux)·`3acb4467…`(windows) · 안내서 `aed92147…`(부트스트랩 1.0.27 표기) · 체크섬 12/12 | FEATURE-GW-WEB-API §9-5 |
| §8 A3 | **종결**(시험 Agent `bito-test-99` 모달 해시 = `Get-FileHash`) | FEATURE-GW-SECURITY §8-3 A3 |
| **링크가드 external3 시험 연결** | **★0914 14:16 종결.** A1~A9 실측 완료(`0b4e839` 배포 · 8 캐시 차단 유지 · 9 ready false 미검사 통과) → **시험분 전부 원복**(ENV 제거·external3 삭제·시험 자격 회수·시험 URL 해제 · 코드는 ENV 없으면 기존 동작이라 유지). 링크가드 쪽 결과 문서 = `C:/Users/ceo/projects/linkguard/docs/handoff/2026-09-14-bito-external3-pilot-result.md`. 이 문서 §2 는 다시 켤 때의 절차로만 남는다 | 결과 = FEATURE-GW-LINKGUARD §9-4 |
| .65 external3 설치 | **없음**(13:0x 설치 → 14:16 삭제 확인: `uninstall-service` exit 0 · 8471 0 · `linkguard` 계정·그룹·폴더 3개 없음 · 유닛은 `linkguard-control`만) · 관제 시험 자격 `lg-e116e71296a7dc98` 회수 14:14:47 · 시험 URL 비활성 14:15:16 · 운영 `bito-gateway` 자격 정상 동기화 | Harold 실행 출력 |
| .65 자원 | CPU 20 · 메모리 31.8GiB(가용 28GiB) · 디스크 여유 825G · `bito-gateway` = `User=ubuntu` · 상한 없음 | 같은 출력 |
| 게이트웨이 저장소 미커밋 | **없음**(`795fb47` 커밋·push 전 `git status --short` = 정확히 §7-4 의 7줄) | Harold 실행 출력 |
| 한줄로 저장소 미커밋(문서) | `docs/bito-gateway/FEATURE-GW-SECURITY.md`·`FEATURE-GW-WEB-API.md`·`FEATURE-GW-LINKGUARD.md`(§9-5 신설) · `FEATURE-GW-AGENT-CORE.md`(§3-1·§5-1 0914 실사례) · 이 인계 문서 | **게이트웨이 세션에서는 `tp-push`를 요청하지 않는다** — 한줄로 세션의 다음 `tp-push`에 실린다 |
| 링크가드 저장소(신규 파일) | `docs/handoff/2026-09-14-bito-external3-pilot-result.md` = 링크가드 쪽 결과 전달 문서 · ★`2026-09-14-bito-external4-install-test-result.md`(첫 판 중단 · 결함) · `2026-09-14-bito-external4-r1-install-test-result.md`(r1 통과) · 커밋은 링크가드 쪽 | Harold 가 링크가드 담당에게 전달 |
| **아이티앤 결과 「진행 중」 26건(서수란 접수)** | **★0914 web/api 배포 완료 · 밤 화면 확인 완료(§0-2) · 정정 종결.** 원인 = 26건 전부 젬텍 결과 수신 완료(`REPORTED`) · 24건은 고객사 DB 반영 행이 없어 Agent 가 ACK 없이 끊고 게이트웨이가 재전달 20회 뒤 포기 · 종결 처리 부재. 정정 = 판정 CT `settledReportedSql`(상태·과금 불변 · 집계만) + Agent 운용 상태 대기 제외 · 배포 = `result-code.js`(백업 `20260914-213430`) → `stats.js`(`20260914-213531`) · 운영 DB 판정식 사전 실행 = 진행 중 26 → 0. 남은 것 = Agent dead-letter(1.0.29) · 기록만 7건 = 게이트웨이 `status/BUG_HISTORY.md` 2026-09-14 · 게이트웨이 저장소 변경 미커밋(4파일 + status 3) | Harold 실행 출력 |
| **링크가드 external4 r1 설치 관통 시험** | **★0914 17:1x 통과·제거 완료.** r1 ZIP `99e1c842…` · 설치(`INSTALL_READY`)·점검·잠금(종료 1)·`/check`(200 pass · 401)·단절 재시작 사유 `credential_scope_unconfirmed`·`sync-once` 종료 4·README 제거 절차 전부 통과 · .65 잔존 0 · 게이트웨이 가동 시각 불변 · **관제 자격 `lg-6d18c5ab15fc783e`(토큰 회전 재사용) 회수 확인 대기**. 전달 = `linkguard/docs/handoff/2026-09-14-bito-external4-r1-install-test-result.md` | Harold 실행 출력 |
| 링크가드 external4 첫 판 설치 시험 | **★0914 중단·원복.** ZIP 해시 일치(`98e3009d…`) 뒤 한글 이름 항목 2개가 python 해제에서 깨져 `SHA256SUMS` 대조 2건 FAILED → `install-agent.sh` 미실행. .65 입력 토큰 `shred`·업로드 폴더 삭제·로컬 사본 삭제 확인 · **관제 시험 자격 `lg-6d18c5ab15fc783e` 회수 미확인** · 게이트웨이 무변경. 전달 = `linkguard/docs/handoff/2026-09-14-bito-external4-install-test-result.md`. **재시험 = 링크가드 수정본 수령 때(Harold)** | Harold 실행 출력 |
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
- ★0914 아이티앤 건에서 기록만 7건(소유 = 게이트웨이 `status/BUG_HISTORY.md` 2026-09-14 「남긴 것」): ①Agent 반영 불가 결과 처리(§8) ②`web/api/routes/pipeline.js:226`·`routes/readiness.js:1778` 은 여전히 `REPORTED` 를 ACK 대기로 센다 ③운영 대시보드에 포기 건수 표시 없음(API 필드만) ④전달 확인(`delivered=true`)인데 `REPORTED` 인 2건(요청 1767786·1768156) 출처 미확인 ⑤0914 17:08~17:18 3~5분 간격 재접속 원인 미확인(재전달 무관) ⑥**`internal/gateway/paystats/reporter.go:531` 이 `DONE` 을 결과 코드 무관 `OkCnt` 로 센다** → PAY 보고 대상 Agent 계정이면 실패 코드 건이 성공으로 보고될 수 있다(대상 계정 존재 미확인 · 돈 축이라 우선 확인 후보) ⑦접수 2번 72시간(§9).

## 6. 하지 말 것

- external3 **재빌드·추가 난독화·선택45/최종17항목·회귀/부하/KISA 시험 반복 금지**(요청 원문 19행).
- **링크가드 시험 작업에서 AI 가 직접 명령·CLI·자식 프로세스·서버 접속을 하지 않는다**(요청 원문 43행) — 로컬 파일 읽기·쓰기와 Harold 실행 결과 검토로만.
- 기존 `bito-gateway` 관제 자격 재사용·회전 금지 · 운영 내장 검사 전체 끄기·일괄 교체 금지 · 관제센터 중지로 단절 재현 금지.
- QTmsg/58 변경 · 고객사 이전 · 고객별 정책 연결 · KISA 운영 연동 금지.
- 시험번호 밖 실발송 금지(미정이면 외부 발송 없이 시험).
- `deploy/build-agent.sh build` 를 확인용으로 돌리지 않는다(게시 폴더를 비운다) · `init-authority` 재실행 금지.
- 게이트웨이 세션에서 한줄로 `tp-push` 요청 금지.
- A3·고객 배포자료 판정 재배포 불필요(운영 해시 §1).
- 재전달을 포기한 결과를 `DONE`·`FAILED` 로 바꾸는 처방 금지(Agent 계약 `CODEX.md:81` · `FAILED` = 환불 트리거 · §7).
- 포기 기준(20회·5분)을 Go(`grpc_server.go:497-499`)·web/api(`result-code.js`) 한쪽만 바꾸지 않는다(계약 테스트 11 이 깬다).
- 남의 산출물을 시험하다 결함이 나오면 우회해서 이어 가지 않는다 = 멈춤·원복·소유자에게 결함 공유(0914 external4 첫 판).
- 운영 서버(.65)에 복제 환경·리허설을 올리지 않는다(A9 보류 근거 · 실발송 서버와 한 기계).

## 7. 트랙 E — 아이티앤 결과 「진행 중」 26건 (서수란 접수 · ★0914 web/api 배포 완료 · 밤 화면 확인 완료 · 정정 종결)

> 경위·기각한 처방·남긴 것 = 게이트웨이 `status/BUG_HISTORY.md` 2026-09-14 · 계약 한 줄 = `status/domains/MESSAGE_PIPELINE.md` 현재 계약 · 미해결 = `status/STATUS.md` 0-J · 7.

### 7-1. 사실 (0914 Harold 실행 SQL·로그)

- 9/9 `itensms03`(발송계정 `아이티앤_신규` · 고객사 R9005) 1,154건 중 26건 `REPORTED` = 젬텍 결과는 **전부 수신**(성공 `0` 10 · 실패 `504` 10·`506` 5·`405` 1 · 실패는 발송 후 약 22~25시간 뒤 9/10 도착) · `report_queue` 24건 미전달 `retry_count=20` + 2건 `delivered=true`(요청 1767786·1768156) · 과금 확정(`ACCRUED` 10 · `FAILED` 16) · `pay_report_enabled=f`.
- 0914 16:22:13~16:27:04 약 1초 간격 재접속(연결마다 24건 재전달 · `재시도 횟수 갱신 실패 context canceled` 2회) → 16:27:05 `결과 재전달 포기 count=24` → 이후 재전달 0 · 새 결과 정상 반영(커서 1737329 → 1767542 · 0914 3건 DONE).
- 72시간 넘은 진행 건 = 전 Agent 에서 이 26건뿐 · 결과 미수신(`DELIVERED`) 0.
- 뿌리 = Agent 가 반영할 행이 없는 결과를 일시 오류처럼 다뤄 ACK 없이 끊음(§8) + 게이트웨이는 포기만 하고 끝내는 곳이 없음 → 집계 「진행 중」 영구.

### 7-2. 정정 (게이트웨이 web/api · Go·DDL·과금·웹훅 무변경)

| 파일 | 내용 | 운영 해시 |
|---|---|---|
| `web/api/services/result-code.js` | `settledReportedSql`(REPORTED · agent · 대체발송 원본 아님 · 대기열 행 1개 이상 · 전부 전달 확인 또는 재전달 포기) · `abandonedReportQueueSql`·`replayingReportQueueSql`(Go 포기식 · 20회·300초) → 종결 성공·실패·미분류에 결과 코드로 합류 · 진행 중에서 제외 | `5b560afe…d642` |
| `web/api/routes/stats.js` | Agent 운용 상태: 대기·지연 판정에서 포기·확정 제외 · `report_queue.abandoned`·`settled_reported` 응답·합계 | `8bb89228…cc00` |
| `web/api/test/result-code-contract-test.js` | 계약 11(Go 상수·포기식 형태·판정식 구조) | 배포 대상 아님 |
| `web/api/test/api-structure-test.js` | 운용 상태 포기·확정 분리 검사 | 배포 대상 아님 |

- 대시보드(`OperationsDashboardPage.jsx` = 사이드바 「이관 준비 → 이전 게이트·준비도」 · 「Agent 운용 상태」 카드)는 `health_status`·`totals.report_wait_total` 을 그리므로 재빌드 없이 지연이 사라진다(0914 밤 화면으로 확인). 진단 상세 문구는 화면에 안 그려져 바꾸지 않았다.

### 7-3. 배포·검증 기록과 확인 명령

| 시각(0914) | 단계 | 결과 |
|---|---|---|
| 저녁 | 로컬 | 계약 `result-code contract OK` · `npm test` 402 통과 · `GW_CHECK_OK`(`API_DEPLOY_TEST_OK` · `GW_GATE_OK` · `CUSTOMER_DELIVERY_BOUNDARY_OK files=14`) |
| 21:3x | 배포 전 운영 DB | 판정식 원문 SQL 파일(코드에서 추출) 실행 = 전체 1,154 · 성공 1,078 · 실패 76 · 미분류 0 · 진행 중 0 · 확정 26 · 업로드 해시 4/4 OK |
| 21:34 | `result-code.js` | `GW_DEPLOY_OK` 백업 `deploy-backups/20260914-213430` |
| 21:35 | `stats.js` | `GW_DEPLOY_OK` 백업 `20260914-213531` · 운영 해시 일치 · `bito-admin-api` 21:35:32 · 업로드 정리 `API_UPLOAD_CLEAN` · 이후 로그 오류 0(20줄) |
| 밤 | 화면 | **확인 완료**(§0-2 표 2 · 사용량 통계 진행 중 0 · 「이전 게이트·준비도 → Agent 운용 상태」 `itensms03` 정상) |

▶ 실행 위치: 로컬 PowerShell (§0-1)
```powershell
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /c/Users/ceo/projects/bito-gateway && git status --short && git log --oneline -1"
```

▶ 실행 위치: .65 (게이트웨이 서버) · root 셸 (§0-1)
```bash
sha256sum /opt/bito-gateway/app/web/api/services/result-code.js /opt/bito-gateway/app/web/api/routes/stats.js; systemctl show bito-admin-api -p ActiveState -p ActiveEnterTimestamp
```

화면이 기대와 다를 때만(.65 root): `journalctl -u bito-admin-api --since "2026-09-14 21:35:30" --no-pager | grep -iE 'error|exception|syntax|column|fail' | tail -n 30`
- 되돌리기 = 백업 두 파일을 역순(`stats.js` → `result-code.js`)으로 복원(게이트웨이 `status/DEPLOY-RUNBOOK.md` §4). 판정식을 다시 운영 DB 에서 볼 때는 `result-code.js` 를 `require` 해 SQL 을 파일로 뽑는 스크립트를 쓴다(PowerShell `node -e` 는 따옴표가 깨진다 · 0914 실측).
- 배포 절차 = 런북 §3-1 과 같은 단계를 root 셸에서 `sudo` 없이(`install -o root -m 0700 … /run/bito-gw-deploy-<sha>.sh` → `sha256sum -c` → `API_UPLOAD_DIR=… bash … api <rel> <sha>` → `rm`) · 순서 = 공용 함수(`result-code.js`) 먼저.

### 7-4. 커밋 (Harold 실행 · 파일 목록 고정 · ★0914 끝남 = `795fb47` · `7 files changed, 173 insertions(+), 10 deletions(-)` · 아래는 기록)

`git status --short` 기대 = 정확히 아래 7줄(다른 줄이 있으면 커밋하지 말고 그 목록부터 확인):

```text
 M status/BUG_HISTORY.md
 M status/STATUS.md
 M status/domains/MESSAGE_PIPELINE.md
 M web/api/routes/stats.js
 M web/api/services/result-code.js
 M web/api/test/api-structure-test.js
 M web/api/test/result-code-contract-test.js
```

▶ 실행 위치: 로컬 PowerShell
```powershell
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /c/Users/ceo/projects/bito-gateway && git add web/api/services/result-code.js web/api/routes/stats.js web/api/test/result-code-contract-test.js web/api/test/api-structure-test.js status/BUG_HISTORY.md status/STATUS.md status/domains/MESSAGE_PIPELINE.md && git commit -m '0914 아이티앤 결과 진행 중 영구 잔존 정정 - 판정 CT settledReportedSql(재전달 포기·전달 확인된 REPORTED 를 결과 코드로 집계 · 상태·과금·웹훅 불변) + Agent 운용 상태 대기 제외(GW_CHECK_OK · npm test 402 · 운영 DB 판정식 사전 실행 진행 중 26→0 · 배포 20260914-213430·213531)' && git push && git log --oneline -1"
```

(§0-2 화면 확인 결과를 게이트웨이 `status/BUG_HISTORY.md`·`status/STATUS.md` 0-J 에 반영하면 그 두 파일만 새 커밋으로 싣는다.)

### 7-5. 접수 회신 초안 (서수란 · 직원 지시문 = 반말)

> 9일 아이티앤 대기 26건은 결과를 못 받은 게 아니야. 26건 모두 젬텍 결과를 받았어(성공 10, 실패 16. 실패는 발송 다음 날 약 22~25시간 뒤 도착). 아이티앤 쪽 발송 테이블에 해당 건이 없어서 Agent가 결과를 반영하지 못했고, 그 상태가 통계에 계속 대기로 남았던 거야. 오늘 통계가 받은 결과대로 성공·실패로 잡히게 고쳤어. 결과가 끝내 안 오는 건의 자동 실패 처리(72시간)는 지금 해당 건이 없어서 따로 설계할게.

## 8. 트랙 F — Agent 반영 불가 결과 처리 (★0914 밤 게이트웨이 쪽 = §12 로 코드 완료 · Agent 1.0.29 쪽만 남음)

> 원장 = [FEATURE-GW-AGENT-CORE.md](bito-gateway/FEATURE-GW-AGENT-CORE.md) §3-1·§5-1 · 게이트웨이 `status/STATUS.md` 7. 게이트웨이 쪽(재전달 제한·dead-letter 화면·경보)은 §12 에서 끝났다. 아래는 Agent 1.0.29 설계 때 쓸 사실 표다.

**확인된 사실 (코드 · 0914)**

| # | 사실 | 위치 |
|---:|---|---|
| 1 | Agent `HandleReport` 는 고객 DB `affected_rows=0` 을 오류(「결과 반영 대상 row 없음」)로 반환하고 저널 정리·ACK 로 가지 않는다 | `internal/agent/poller/poller.go:571-575` |
| 2 | Agent `ReportAck` 는 결과 코드 0 만 보낸다 | `internal/agent/client/grpc_client.go:1284-1291` |
| 3 | 게이트웨이는 결과 코드 ≠ 0 인 ReportAck 를 경고 로그만 남기고 버린다 | `internal/gateway/session/grpc_server.go:405-412` |
| 4 | 게이트웨이 재전달 = 연결마다 미전달 전부 · 재시도 수는 연결당 +1 · 20회 이상·5분 경과면 재전달 제외(포기 경고만 · 종결 없음) | `grpc_server.go:493-625` |
| 5 | Agent 가 빨리 끊으면 재시도 수 갱신이 `context canceled` 로 날아가 포기까지 더 걸린다 | `grpc_server.go:604-615` · 0914 로그 |
| 6 | 포기 결과는 web/api 집계에서만 결과 코드로 센다(상태 불변) · 포기 기준을 바꾸면 web/api 계약 테스트 11 과 함께 | §7-2 |
| 7 | 계약 = Agent 소스 `DONE` 은 고객 DB 반영 + ReportAck · `FAILED` 전환은 환불 트리거 | 게이트웨이 `CODEX.md:81` · `migrations/031` |

**미확인 (설계 첫 단계에서 코드로 읽는다)**: `HandleReport` 오류 뒤 Agent 가 스트림을 끊는 정확한 경로(근거 = `grpc_server.go:504-508` 주석의 0909 로그 「GW 연결 종료 감지」뿐) · 결과 커서 frontier 가 반영 불가 결과에서 멈추는지 · 1.0.29 구성(보안 §8-4 5 = A2 서명 + A4·A5·A6)과 묶는 방식.

**설계 제약 (원장 §5-1)**: 자동 성공 처리 금지 · 별도 원장(dead-letter) + 운영 알림 · 사람 판정 후 ACK. 배포 = 관리형 3대(hanjul01·02·03)는 원격 rollout · 직접 설치 고객(`itensms03` 등)은 수동 업그레이드.

## 9. 트랙 G — 접수 2번: 결과 미수신 72시간 자체 실패 처리 (별도 축 · 미착수)

- 요청(서수란) = 전송 후 결과 전문을 계속 못 받으면 무한 대기가 아니라 72시간(이통사 MMS 기준) 뒤 우리 쪽에서 실패 처리.
- 0914 사실: 72시간 넘은 `DELIVERED` 0건(전 Agent) · 젬텍 실패 리포트는 9/10 실제로 약 22~25시간 뒤 도착.
- 설계 전 확인할 것: `FAILED` 전환 = 환불 트리거(`migrations/031` `notify_refund_target` · `engine/billing_finalizer.go:23-52`) → 결과를 모르는 건을 환불할지 결정 필요 · 늦게 온 실제 REPORT 우선 계약(`status/domains/MESSAGE_PIPELINE.md` 현재 계약) · `engine/monitor.go` GapDetector 가 `DELIVERED` 정체를 센다(`migrations/052` 주석 · 코드 미확인) · 같은 문서 활성 과제 「REPORT timeout 을 넘긴 DELIVERED 운영 장애 조건」과 같은 축 · Agent 소스는 게이트웨이 상태만 바꿔서는 고객 DB 에 결과가 가지 않는다.
- 신규 설계 = 후보·추천 1개 형태로 시작.

## 10. 트랙 H — 링크가드 external4 (r1 설치 관통 통과 · 게이트웨이 연결 없음)

- 결과 = [FEATURE-GW-LINKGUARD.md](bito-gateway/FEATURE-GW-LINKGUARD.md) §9-5 · 링크가드 전달 = `linkguard/docs/handoff/2026-09-14-bito-external4-install-test-result.md`(첫 판 중단 · 한글 파일명 ZIP) · `…-bito-external4-r1-install-test-result.md`(r1 통과 · 시험 중 본 것 5건).
- 남은 것 = 관제 시험 자격 `lg-6d18c5ab15fc783e`(`bito-external4-install` · 토큰 회전 재사용) 회수 확인 · 게이트웨이 연결 실시험은 Harold 지시 때만(그때는 발송 계정 `ubuntu` 로 설치 → `GW_LINKGUARD_EXTERNAL_CALLER_TOKEN_FILE=/etc/linkguard-caller/caller.token` · 미실측).
- 설치 시험 순서(재사용) = T0 사전 상태 → T1 시험 자격(자격 ID 먼저 메모) → T2 입력 토큰(`read -rs` · 호출 토큰 urandom 64자) → T3 업로드(로컬 PowerShell) · `python3 -m zipfile` 해제 · `SHA256SUMS` 대조 → T4 `install-agent.sh`(입력 5개 · 관제 `https://linkguard.hanjulgw.com` · 발송 계정 `ubuntu`) → T5 계정·권한·상한·사본·8471·`/healthz` → T6 가동 중 `sync-once` 잠금 → T7 `ubuntu` 로 `/check` 200·401 → T8 `linkguard` 443 출력 차단 재시작 → T9 자격 「차단 사용」 끔 → `sync-once` 종료 4 → 다시 켬 → T10 README 제거 + 드롭인·호출 사본 폴더·계정·입력 토큰·업로드 정리 · 자격 회수.
- 로컬 명령은 반드시 노트북 PowerShell 창에서(0914 두 번 서버 bash 에 붙여 `command not found`).

## 11. 다음 세션 진입 명령

**작업 디렉터리 `C:\Users\ceo\projects\targetup`**

```text
0914 게이트웨이 인계 이어가자. docs/2026-09-14-gateway-session-handoff.md 먼저 정독하고 현재 상태 확인부터 시작해
```

- 시작 순서 = **§0 표**. 첫 명령은 현재 상태 확인(§7-3)이다.
- A9-나 = **보류**(FEATURE-GW-SECURITY §8-8 재개 조건) · §4 3번으로 시작하지 않는다.
- external3 시험 연결 = 종결. 링크가드 쪽 회신이 오면 그 내용만 검토한다(재시험은 Harold 지시 때만 · §2 절차).
- 이터널그룹 회신이 오면 §3 순서.
- 게이트웨이 세션에서 한줄로 `tp-push` 는 요청하지 않는다(이 문서·`docs/bito-gateway/*` 는 한줄로 세션의 다음 `tp-push` 에 실린다).
- ★0914 밤: §12(Agent 연결 신뢰도 축)·§12-7(후속) 전부 배포·화면 확인까지 끝났다(게이트웨이 쪽 종결). 다음 세션은 §0 표 7번(남은 축 선택)에서 시작한다. 실효 실측 = 다음에 반영 불가 결과가 생길 때 게이트웨이 로그 `report replay 완료 periodic=true` 가 1분 간격·10회 안에 멈추는지 · 끊긴 Agent 경보가 dashboard 알림에 뜨는지.

## 12. 트랙 I — Agent 연결 신뢰도 축 (★0914 밤 · Harold 「전체 한 번에 착수 · 끝까지 · 중간 확인 없이」 · 코드 완료 · `GW_CHECK_OK` · **커밋 `2a79bbf` · 배포 3종 · 화면 확인 완료(0915 00:0x) · 게이트웨이 쪽 종결**)

> **배포 기록(0914 밤 · Harold 실행 출력)**: 바이너리 `ccd9bb0e…deee` 23:34:42 `GW_DEPLOY_OK gateway`(백업 `20260914-233442` · 기동 로그 keepalive `maxConnectionAge=0` · 5대 1초 안 재접속 · 정리 대상 0 · ERROR 0) · api `agent-session.js`(신규 `233656`) → `result-code.js`(`233718`) → `stats.js`(`233738`) → `alert-worker.js`(`233802`) → `agents.js`(`233832`) 운영 해시 5/5 일치 · `bito-admin-api` 23:38:33 · 오류 0 · dashboard manifest `13af5407db3a` 46 files 23:41:33 `GW_DEPLOY_OK dashboard`(백업 `20260914-234133/dist`) · 업로드 정리 완료 · `alert_rule` id 3 「Agent 접속 끊김」 전역·10분·cooldown 30·enabled·dashboard · 포기 결과 = itensms03 24건(retry 20)뿐 · §12-5 2·3 화면 확인 완료(0915 00:0x · 「접속」열 · 「끊김 0」 · 「24건 보기」 모달).

> 사실·뿌리·정정 파일·검증의 소유 = 게이트웨이 `status/BUG_HISTORY.md` 2026-09-14(2) · 상태 = 게이트웨이 `status/STATUS.md` 0-K · 재전달 계약 = `status/domains/MESSAGE_PIPELINE.md` 현재 계약 두 줄. 여기는 **배포 순서와 실측**만.

### 12-1. 무엇이 바뀌나 (한 줄씩)

| # | 항목 | 효과 | 어디 |
|---:|---|---|---|
| ① | 재전달 60초 간격 제한 + 붙어 있는 연결 60초 주기 재전달 + 포기 10회·10분 + 보낸 id 만 `retry_count` | 반영 불가 결과 1건당 재접속 약 300회 → 최대 10회(1분 간격) 뒤 포기 목록으로 | 게이트웨이 바이너리 |
| ① | 기동 시 마지막 이력이 「접속」인 Agent 에 「접속 종료(gateway_restart)」 기록 | 강제 종료 뒤 죽은 연결이 「접속 중」으로 남지 않음 | 게이트웨이 바이너리 |
| ② | 오프라인 경보 `agent_disconnect` 에 세션 축(붙은 적 있는 Agent 가 N분 넘게 끊김) | heartbeat 없는 직접 설치(itensms03)도 경보 · 닷새 방치 재발 차단 | api `alert-worker.js` |
| ③ | 운용 상태 표 「접속」(접속 중/끊김 언제부터 얼마나/미접속) · 「반영 불가」(건수 보기 → 모달 · 다시 보내기) · Agent 카드 「끊김 N」 | 「지금 붙어 있는가」를 화면에서 답함 | api `stats.js`·`agents.js`·`agent-session.js` + dashboard |

### 12-2. 검증 기록 (0914 밤 · 로컬)

`go test ./...` 전 패키지 ok(Windows 환경 제외 5건은 종전과 동일) · web/api `npm test` = `api-structure-test` 409 통과 · 계약 11 통과(Go 10·10분 = JS 10·600) · `agent-session-contract-test`·`alert-scope-contract-test` 통과 · dashboard `npm test` 26/26(`test-agent-session-ui.mjs` 신규) · `bash scripts/gw/check.sh` = `GW_CHECK_OK`(`API_DEPLOY_TEST_OK` · `DASHBOARD_DEPLOY_TEST_OK` · `GW_GATE_OK` · `CUSTOMER_DELIVERY_BOUNDARY_OK files=14`). DDL 0 · ENV 변경 0.

### 12-3. 커밋 (Harold 실행 · 파일 목록 고정)

`git status --short` 기대 = 아래 21줄(`??` = 신규). `web/dashboard/dist` 줄이 더 보이면 빌드 산출물이라 넣지 않는다(아래 add 는 목록을 명시하므로 자동으로 빠진다).

```text
 M cmd/gateway/main.go
 M internal/gateway/session/grpc_server.go
 M internal/gateway/session/grpc_server_test.go
?? internal/gateway/session/report_replay_guard.go
?? internal/gateway/session/report_replay_guard_test.go
 M status/BUG_HISTORY.md
 M status/STATUS.md
 M status/domains/MESSAGE_PIPELINE.md
 M web/api/package.json
 M web/api/routes/agents.js
 M web/api/routes/stats.js
 M web/api/services/alert-worker.js
 M web/api/services/result-code.js
?? web/api/services/agent-session.js
 M web/api/test/alert-scope-contract-test.js
 M web/api/test/api-structure-test.js
?? web/api/test/agent-session-contract-test.js
 M web/dashboard/src/components/api.js
 M web/dashboard/src/pages/OperationsDashboardPage.jsx
 M web/dashboard/src/utils/auditLogLabels.js
?? web/dashboard/scripts/test-agent-session-ui.mjs
```

▶ 실행 위치: 로컬 PowerShell
```powershell
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /c/Users/ceo/projects/bito-gateway && git status --short"
```

▶ 실행 위치: 로컬 PowerShell (위 목록이 맞을 때만)
```powershell
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /c/Users/ceo/projects/bito-gateway && git add cmd/gateway/main.go internal/gateway/session/grpc_server.go internal/gateway/session/grpc_server_test.go internal/gateway/session/report_replay_guard.go internal/gateway/session/report_replay_guard_test.go status/BUG_HISTORY.md status/STATUS.md status/domains/MESSAGE_PIPELINE.md web/api/package.json web/api/routes/agents.js web/api/routes/stats.js web/api/services/alert-worker.js web/api/services/result-code.js web/api/services/agent-session.js web/api/test/alert-scope-contract-test.js web/api/test/api-structure-test.js web/api/test/agent-session-contract-test.js web/dashboard/src/components/api.js web/dashboard/src/pages/OperationsDashboardPage.jsx web/dashboard/src/utils/auditLogLabels.js web/dashboard/scripts/test-agent-session-ui.mjs && git commit -m '0914 Agent 연결 신뢰도 - 결과 재전달 60초 간격 제한·붙어 있는 연결 60초 주기 재전달·포기 10회 10분·보낸 id 만 retry_count·기동 시 접속 잔존 이력 종료(Go) + 오프라인 경보 세션 축(heartbeat 없는 직접 설치 포함) + 운용 상태 접속·반영 불가 열·반영 불가 모달 다시 보내기(api+dashboard) (go test 전부 ok · api 409 · dashboard 26/26 · GW_CHECK_OK · DDL 0)' && git push && git log --oneline -1"
```

### 12-4. 배포 순서 (Harold 실행 · 한 번에 하나씩 · 런북 `status/DEPLOY-RUNBOOK.md` §3)

| # | 단계 | 실행 위치 | 판정 |
|---:|---|---|---|
| 1 | `bash scripts/gw/build.sh gateway`(커밋 뒤에만 · 미커밋이면 거부) → `out/bito-gateway-<sha>`·`.sha256` | 로컬 Git Bash | `GW_BUILD_OK` |
| 2 | 바이너리 + `.sha256` + `scripts/gw/deploy.sh` 를 .65 `/tmp/` 로 scp → root 셸에서 런북 §3-3 (`install -o root -m 0700 /tmp/deploy.sh /run/bito-gw-deploy-<sha>.sh` → `sha256sum -c` → `bash … gateway /tmp/bito-gateway-<sha>` → `rm`) · 재기동 약 3초 · **발송 적은 시간에** | 로컬 → .65 root | `GW_DEPLOY_OK gateway` · Agent 4대 재연결 |
| 3 | api 5파일을 런북 §3-1 로 **순서대로**(파일마다 재시작): `web/api/services/agent-session.js`(**`--create`**) → `web/api/services/result-code.js` → `web/api/routes/stats.js` → `web/api/services/alert-worker.js` → `web/api/routes/agents.js` | 로컬 → .65 root | 파일마다 `GW_DEPLOY_OK api` · 끝나면 `API_UPLOAD_CLEAN` |
| 4 | dashboard: `bash scripts/gw/check.sh` → `bash scripts/gw/build.sh dashboard`(순서 계약 · 런북 §3-2) → dist 업로드 → 서버 4값 대조 → `deploy.sh dashboard <manifest 64자>` | 로컬 → .65 root | `GW_DEPLOY_OK dashboard` · `DASHBOARD_UPLOAD_CLEAN` |

순서 이유: 바이너리가 먼저면 게이트웨이는 10회·10분으로 포기하고 api 는 잠깐 20회·5분으로 세어 몇 분간 「반영 불가」 건수가 적게 보일 뿐이다(반대 순서도 같은 정도). `agent-session.js` 가 `stats.js`·`alert-worker.js` 의 의존이라 가장 먼저 `--create` 로 올린다.

### 12-5. 실측 (배포 뒤 · Harold)

| # | 확인 | 실행 위치 | 기대 |
|---:|---|---|---|
| 1 | `journalctl -u bito-gateway --since "<배포 시각>" --no-pager \| grep -E "접속 이력을 종료로 정리\|gRPC keepalive\|Agent 연결\"" \| head -n 12` | .65 root | 기동 뒤 「기동 전 남아 있던 Agent 접속 이력을 종료로 정리 count=N」(재기동 직전까지 붙어 있던 Agent 수 · 보통 4) 뒤 `Agent 연결` 4줄 |
| 2 | 이관 준비 → 이전 게이트·준비도 → Agent 운용 상태 | 대시보드 | 「접속」열에 hanjul01·02·03·itensms03 = 접속 중(HH:MM부터) · 나머지 = 미접속 · Agent 카드 「끊김 0」 · itensms03 「반영 불가」 = **24건 보기** |
| 3 | 「24건 보기」 → 반영 불가 모달 | 대시보드 | seq·결과 코드(`504`·`506`·`405`·`0`)·재전달 20회 · **다시 보내기는 누르지 않는다**(고객사 행이 없는 상태) |
| 4 | `docker exec bito-bench-postgres psql -U bito -d bito_gateway -c "SELECT id, name, scope_type, threshold, window_minutes, cooldown_minutes, enabled, notify_method FROM alert_rule WHERE condition_type='agent_disconnect';"` | .65 root | 행 1개 이상 · `enabled=t`. **0행이면 경보가 나가지 않는다** → 알림 설정 화면에서 `Agent 접속 끊김` 규칙(전역 · 10분 · dashboard 또는 slack) 생성 |
| 5 | (선택) `journalctl -u bito-gateway --since "<배포 시각>" --no-pager \| grep -c "report replay 완료"` | .65 root | 붙어 있는 연결의 주기 재전달은 미전달이 있을 때만 줄을 남기므로 0~소수 |

### 12-6. 하지 말 것·되돌리기

- 「다시 보내기」는 고객사가 발송 테이블 행을 되살린 뒤에만. 아니면 그 Agent 가 10분간 1분 간격으로 다시 끊었다 붙는다.
- 포기 상수(Go 10회·10분 · JS 10·600)를 한쪽만 바꾸지 않는다(계약 11).
- 되돌리기 = 바이너리 `deploy-backups/<시각>/` 직전본(런북 §4) · api 는 백업 파일 역순 복원(`agents.js` → `alert-worker.js` → `stats.js` → `result-code.js` · `agent-session.js` 는 `.absent` marker 대로 삭제) · dashboard 는 직전 live 재교환.

### 12-7. 후속(3) — 고객사 화면 거절 줄 · 원격배포 「관제 미등록」 (★0914 밤 · 코드 완료 · `GW_CHECK_OK` · **커밋·배포 완료**: api `agent-rollout-service.js` 23:57:46 백업 `20260914-235746` · dashboard manifest `c5b92c7d006b` 47 files 23:59:28 백업 `20260914-235928/dist` · 화면 확인 완료 0915 00:0x · 종결)

### 12-8. 마지막 커밋 (게이트웨이 status 2문서 · 화면 확인 반영분 · ★0915 00:0x 끝남 = `04026f9` · 후속(3) 코드 커밋 = `14abeec` · 게이트웨이 `origin/main` = `04026f9` · 미커밋 0)

`git status --short` 기대 = ` M status/BUG_HISTORY.md` · ` M status/STATUS.md` 두 줄. 한줄로 쪽(이 문서 · `docs/bito-gateway/FEATURE-GW-AGENT-CORE.md`)은 한줄로 세션의 다음 `tp-push` 에 실린다.

▶ 실행 위치: 로컬 PowerShell
```powershell
& "C:\Program Files\Git\bin\bash.exe" -lc "cd /c/Users/ceo/projects/bito-gateway && git add status/BUG_HISTORY.md status/STATUS.md && git commit -m '0914 문서 - Agent 연결 신뢰도 축(2)·후속(3) 배포 기록·화면 확인 완료·종결 (BUG_HISTORY·STATUS 0-K)' && git push && git log --oneline -1"
```

> 사실·뿌리·정정 = 게이트웨이 `status/BUG_HISTORY.md` 2026-09-14(3). 요지 = 닷새 전 거절 줄이 「지금 끊김」으로 읽혔고, itensms03·thewc01 은 **설치 묶음(관제 등록) 없이 설치된 Agent**(`enrollment_*`·`control_credential_state` NULL · heartbeat 0)라 원격배포·버전 보고 경로 자체가 없는데 화면은 「플랫폼 릴리즈 누락」이라고 했다.

**바뀐 파일(12 · 신규 1)** = `web/api/services/agent-rollout-service.js`(ENROLLMENT_MISSING) · `web/api/test/agent-rollout-service-test.js` · `web/dashboard/src/utils/agentSession.js`(신규) · `utils/remoteDeploy.js` · `pages/OperationsDashboardPage.jsx` · `pages/CommercialAccountsPage.jsx` · `pages/RemoteDeployPage.jsx` · `components/remote-deploy/FleetRolloutPanel.jsx` · `scripts/test-account-access-ui.mjs` · `scripts/test-remote-deploy-ui.mjs` · `status/BUG_HISTORY.md` · `status/STATUS.md`.

**배포** = api 1파일(`web/api/services/agent-rollout-service.js` · 런북 §3-1 교체 모드) → dashboard(§3-2 전체 순서 다시) · DDL 0 · ENV 0. 실측 = 고객사 화면 itensms03 「마지막 접속」 = 「접속 중」 배지 + `N분 전` + 회색 「이전 거절 5일 전 · Agent 자격 정보 불일치 · 그 뒤 접속됨」 · 원격배포 대상 Agent 표 itensms03·thewc01 = 「관제 미등록」 + 힌트 · 버전 「미보고」.

**아이티앤이 실제로 원격배포되려면** = 설치 묶음(관제 등록)으로 재설치(고객사 손). 우리 쪽 = 고객사 화면에서 itensms03 설치 묶음 발급 → 전달. gRPC `Auth` 에 Agent 버전 필드 추가(미등록 Agent 도 버전 보고)는 1.0.29 후보.
