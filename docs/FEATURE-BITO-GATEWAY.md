# 비토 게이트웨이 (ViTO Messaging Gateway) — 한줄로 측 피더 문서

> **호출어 = "비토 게이트웨이"**
> 이 문서는 **한줄로 저장소가 소유**한다. 게이트웨이 저장소의 `CODEX.md`·`status/STATUS.md`·`status/DEPLOY-RUNBOOK.md`는
> **우리가 관리**하고(★2026-08-15 개정 — 상세 = §2 읽기 규약), 나머지(`AGENTS.md`·`CLAUDE.md`·`docs/`·`status/` 나머지)는 편집하지 않는다.
> 우리 판단·확정 사실·잔여는 이 허브와 `docs/bito-gateway/` 스포크 6종에 쌓는다.

## 1. 정체성

한줄로가 발송한 메시지가 통신사로 나가는 **마지막 구간**. 자비스가 개발했고, 2026-08-14 기준 **실사용 트래픽 0**(완성 후 발송량 적은 고객사부터 이관 예정 — Harold 확정).

```
한줄로 INSERT → MySQL SMSQ_SEND_13/14/15 → Bito Agent 폴링 → 게이트웨이 → 중계/통신사 → REPORT → 고객 DB 반영
        (우리 통제권)                      (경계)        (자비스 개발)
```

게이트웨이 측 canonical 흐름(그쪽 `CODEX.md` 기재):
`고객 DB row/API 요청 → Canonical Message → message_request.id/ngs_serial → provider attempt → report_queue.id → 고객 DB/Webhook 반영 → ACK → DONE/FAILED`

## 2. 소스 위치와 읽기 규약

| 항목 | 값 |
|---|---|
| 소스 | **`C:\Users\ceo\projects\bito-gateway`** (★0815 이동 — 캐시·산출물 제외 복사, 수량 대조 검증). OneDrive 바탕 화면 옛 폴더 = **보존 사본**(대형 산출물·릴리즈 아카이브 원본, `MOVED-2026-08-15.md` 안내 있음, 수정 금지) |
| git | **있음(★0815 도입)** — 이력은 커밋이 소유(결함 하나 = 커밋 하나), `.bak`은 서버 직접 반영분만. **원격 = `ssh://invito@58.227.193.65/home/invito/repos/bito-gateway.git`(0815 push 완료)** — 커밋 후 `git push`(Harold)가 백업. 옛 폴더는 대형 산출물 원본으로 계속 보존 |

⚠ **★★ 장비가 둘인데 호스트명이 둘 다 `invito`다** (2026-08-14 실측 — 프롬프트만 보고 구분 불가, 사고 유발 지점)

| | 게이트웨이 | 에이전트 |
|---|---|---|
| IP | **58.227.193.65** | **58.227.193.62** |
| 로그인 계정 | `invito` | `administrator` (→ root) |
| 가진 것 | PostgreSQL 컨테이너 `bito-bench-postgres`(DB `bito_gateway`/계정 `bito`, **127.0.0.1:5432 정상 바인딩**) · Admin API **127.0.0.1:4000**(localhost 전용) · nginx `0.0.0.0:443` · `/opt/bito-agent-release-source` | Agent 3대(`/opt/bito-agent`·`/opt/bito-agent-hanjul02`·`/var/lib/bito-agent-bootstrap/hanjul03`) · `/var/lib/bito-agent-control` · MySQL `smsdb` |
| 여기서 하는 일 | nonce 발급·릴리즈 원장 조회 | `install.sh` 실행·config·ACL |

- Agent → GW gRPC `:9090` (에이전트가 .62에서 .65로 접속)
- ⛔ 저장소의 `docker-compose.yml`은 **개발용**이다(postgres `0.0.0.0:5432`·비번 `bito1234`). 운영은 `127.0.0.1` 바인딩으로 확인됨 — 이 파일을 운영 근거로 읽지 말 것

**읽기 규약 (Harold 지시 — ★2026-08-15 개정)**
- **`CODEX.md`·`status/STATUS.md`는 우리가 재편·관리한다**(0815 Harold 지시 — 한줄로 규율 이식판으로 교체 완료, 원본 = `.bak-20260815`). 수정 시 백업 의무.
- 그 외(`AGENTS.md`·`CLAUDE.md`·`docs/`·`status/` 나머지 문서)는 **계속 편집 금지.** 자비스와 왕복하는 공간이다.
- 소스 읽기·분석은 자유. 우리 결론은 이 허브와 `docs/bito-gateway/` 스포크에 적는다.
- 코드 수정이 필요하다고 판단되면 착수 전 Harold 승인 — 소유권이 아직 갈려 있다.

## 2-2. 배포 체계 — gw check/build/deploy (★2026-08-15 신설 · 한줄로 tp-push+build:safe 이식판)

**명령·절차의 소유 문서 = 게이트웨이 저장소 `status/DEPLOY-RUNBOOK.md`**(여기 재서술 금지). 스크립트 = `scripts/gw/{check,build,deploy}.sh`.

**원칙 = 변경 종류가 검증·배포 단위를 결정한다.** git diff가 판정 → 해당 게이트만 실행 → 최소 단위만 교체.
- api(Node)·문서 = **빌드 0** / dashboard = 프론트만 / Go = 로컬 크로스컴파일(**서버에 Go 없음 — 0815 실측**, 지금까지도 "서버 빌드"가 아니라 로컬 빌드물 전달이었다)
- 버전 = **git SHA**(버전 디렉터리·전용 스크립트·재포장 폐지) · 배포 실패 시 **자동 복원**(`GW_DEPLOY_ROLLBACK`) + `/opt/bito-gateway/deploy-backups/<TS>/`
- Agent 서명 릴리즈는 **대상 제외**(서명키 경계 — 기존 release authority 절차 유지)

**풀 리패키징 4중 차단** (Harold 지시 — "결함 하나에 버전 올려 통째 재빌드"가 한 건에 1.5~2시간을 태우던 병리)
①진입점(`AGENTS.md`·`CLAUDE.md`)에 금지 명시 — 어느 세션이 열려도 첫 화면에서 만난다 ②CODEX 규율에 정지 조항("재포장이 필요해 보이면 멈추고 보고") ③런북이 유일 배포 경로 ④`.gitignore`가 패키지 산출물 커밋 자체를 거부. **옛 OneDrive 폴더 진입 파일에도 같은 금지 + 작업 금지 안내**(`.bak-20260815`).

**첫 리허설이 잡은 것**(체계가 첫날부터 일함) — 이동 때 빠진 테스트 픽스처 2건(릴리즈 서술자·레인 payload) 복원 · Windows 환경 전용 실패 5건을 테스트 단위 `-skip`으로 명시(패키지 커버리지는 유지, Linux는 전체 실행). 최종 `GW_CHECK_OK` exit 0 실측.

**옛 폴더 청소**(0815) — 재생성 가능물만 삭제해 **10.5GB → 2.05GB**(8.5GB 회수, 파일 118,957→2,754). 지운 것 = Go 캐시 9종·모듈 캐시·node_modules 2벌·자비스 임시 사본(`.codex_tmp`)·`{cmd` 쓰레기·중단된 `.git` 잔재(커밋 0). **남긴 것 = 릴리즈 서명 아카이브·"Bito Agent" 원본 자료·invitoMsg**(서버 사본 실측 전 삭제 금지). ACL 잠긴 빈 껍데기 2개는 0MB라 존치.

## 2-1. 작업 규율 (★2026-08-15 Harold 승인 — 자비스식 "빌드 재포장" 병리 차단)

게이트웨이 관련 모든 작업(비토 수행분)에 적용한다. 근거 = §7 진단·§4-1 교훈.

1. **작업 단위 = 결함 하나.** 산출물·버전이 단위가 아니다. 오류를 고치는 게 목적이지 빌드를 다시 포장하는 게 목적이 아니다("1글자와 1000줄이 같은 비용"이 되면 잘못된 것).
2. **빌드는 Go 바이너리가 바뀔 때만.** config·Node·문서·ACL·SQL은 백업 후 직접 수정한다 (0815 `$9` 소스 동기화가 실증 — 빌드 0회).
3. **에러는 먼저 로그를 넣고 진단한다.** 예외를 삼키는 경로에 가설 세우기 금지.
4. **변경당 DESIGN+PLAN 문서 쌍 금지, 버전당 전용 빌드 스크립트 금지** (현행 scripts 121개 중 30개가 이 병리).
5. **이력 = git 커밋**(★0815 도입 — 결함 하나 = 커밋 하나). 서버 직접 반영분만 `.bak-YYYYMMDD` 유지 + 당일 소스 커밋. 최소 diff + 실측 1건 검증은 불변.

## 3. 구조 지도 (2026-08-14 실측)

**규모** — 실소스 Go 391개(빌드 캐시 제외) · 마이그레이션 49개 · 상태 문서 139개 · deploy 패키지 163개 · 현재 v249대

```
cmd/            gateway · agent · agent-bootstrap · agent-canary · agent-installer
                agent-reinstaller · agent-release · bench-ingress · mock-gw · test-client
internal/
  gateway/      clientapi(server.go) · connector · db · engine · opsai · queue · redis · session · tps
  agent/        installer · installerconfig · installerruntime · bootstrap · update · canary · config
  common/ buildinfo/
web/api/        Node.js Admin/Control API — routes/ · services/
migrations/     001~049 (PostgreSQL)
proto/ gen/     gRPC 계약
```

**우리가 소비하는 축** (경계에서 우리에게 영향이 오는 지점)
| 축 | 게이트웨이 측 위치 |
|---|---|
| Agent 등록·자격증명 | `web/api/routes/agent-control-enrollment.js` · `web/api/services/agent-credential-service.js` · `migrations/041,043,045` |
| Agent 원격 업데이트 | `internal/agent/update/` · `internal/agent/bootstrap/` · `cmd/agent-release` |
| 라우팅·중계사 | `internal/gateway/connector/` · `status/domains/ROUTING_AND_PROVIDERS.md`(그쪽) |
| 결과코드 표준 | `status/MESSAGE_RESULT_CODE_STANDARD.md`(그쪽) — ViTO 표준코드 ↔ 고객값 매핑 |
| 브랜드메시지 F | `migrations/047_friendtalk_retirement_brand_pricing_split.sql` · 048·049 식별코드 |

## 4. 확정 사실 — Agent 전환의 진짜 관문 (★2026-08-14 소스 실독)

v1.0.21 `install.sh`는 203줄 중 170줄이 시스템 계정 생성·검증이고, 실제 전환은 마지막 6줄:

```
bito-agent-installer migrate --config installer.yaml --manifest package-manifest.json --nonce-stdin
```

**필요한 두 값은 모두 게이트웨이가 쥐고 있다. 서명물이 아니다.**

**(1) `installer.yaml` = 평문 YAML. 우리가 직접 작성 가능.**
스키마 = `internal/agent/installerconfig/config.go` `Schema = "vito-agent-installer-config/v1"`

| 필드 | 비고 |
|---|---|
| `schema` `agent_id` `service_id` `service_name` `bootstrap_service_name` | service_name ≠ bootstrap_service_name (검증됨) |
| `os` `arch` `base_root` `package_root` `version` | arch는 `amd64`만 |
| `release_id` (int64, **> 0**) | 게이트웨이 릴리즈 원장에 등록된 값이어야 함 |
| `child_identity` `child_uid` `child_gid` `child_sid` | 설치 스크립트가 이 계정을 `--system --shell /usr/sbin/nologin`으로 생성. home은 `/home/<identity>` 고정 |
| `legacy.{config_path, token_path, tls_paths, state_path, journal_path, cursor_path, log_path}` | 기존 설치 절대경로 — doctor로 확인된 값 |
| `control.{base_url, channel, tls_ca_file, tls_server_name, request_timeout, artifact_timeout}` | 컨트롤 플레인 접속 |

**(2) `enrollment nonce` = Admin API 호출 한 번.**

```
POST /api/agent/control/agents/{agentId}/enrollment-nonces
body: { service_id, os, arch, release_id, child_digest }
201 : { ..., enrollment_nonce, expires_in_seconds }
```

- 구현 = `web/api/routes/agent-control-enrollment.js:289` → `createEnrollmentNonce()` (`agent-credential-service.js:437`)
- 저장 = `agent_account.enrollment_nonce_digest` CHAR(64) + `enrollment_nonce_expires_at` (`migrations/041:252-253`) — 원문은 저장 안 하고 digest만
- `child_digest` = 패키지 `package-manifest.json`의 `payload/bito-agent` sha256
- 감사 = `AGENT_ENROLLMENT_NONCE_ISSUE`로 audit-log 적재

**결론 — 자비스 의존은 구조가 아니라 창구 문제다.** 게이트웨이가 우리 것이면 릴리즈 등록·nonce 발급 둘 다 우리가 한다. 지금까지 매 설치마다 사람을 거친 이유가 이 두 호출뿐이었다.

## 4-1. ★ 전환 실패 근본 원인 확정 (2026-08-14 실측)

**hanjul02 전환은 인증·credential·release 문제가 아니었다. `agent-config.yaml`의 상대 경로 한 줄이었다.**

오늘 두 번의 시도(14:26 · 19:53) 모두 동일 지점에서 실패:
```
Enrollment nonce:                                     ← nonce는 통과
installer migrate failed: systemctl failed: exit status 3 ()
```
- `exit status 3` + 빈 stderr = `systemctl is-active --quiet` (linux.go:222 `Health`). `start` 실패면 stderr가 차고 코드도 1.
- journald 실체: `Poller 초기화 실패: state journal 초기화 실패: journal 디렉터리 생성 실패: mkdir data: permission denied`
- 이유 = `SwitchService`(linux.go:200)가 drop-in으로 ExecStart를 bootstrap으로 바꾸며 **실행 계정을 root → 비특권 child(2102)로 낮춘다.** `journal_path`가 상대 경로(`data/...`)라 옛 root 소유 위치를 계속 가리켜 쓰기 실패 → child 즉사 → 61초 후 `bootstrap active child recovery failed: context deadline exceeded` → exit 1 → 롤백.
- 결과는 `rolled_back` / `failed_rolled_back` — **롤백은 정상 동작.** hanjul02는 legacy로 깨끗이 복귀(계정 `bito-hanjul02` 2102:2102만 잔존, 재사용 가능).

**hanjul03이 통과한 조치 = 두 가지뿐**
1. `state_policy.journal_path`(config.go:220) 상대 → **절대**
   - 실패기(Jul 17·Aug 4 14:11·15:10) = `data/agent-journal-hanjul03.jsonl`
   - 성공기(Aug 5 07:06~현재) = `/opt/bito-agent-hanjul03/data/agent-journal-hanjul03.jsonl`
2. child 계정 **POSIX ACL** 부여 (소유자는 root:root 유지)
   ```
   /opt/bito-agent-hanjul03       user:bito-hanjul03:--x   (통과만)
   /opt/bito-agent-hanjul03/data  user:bito-hanjul03:rwx   (쓰기)
   ```

**hanjul01·02는 둘 다 미적용.** doctor 출력이 증거 — 01 `path=data/agent-journal-hanjul01.jsonl` · 02 `path=data/agent-journal-hanjul02.jsonl`. `/opt/bito-agent`·`/opt/bito-agent-hanjul02`에 ACL(`+`) 없음. **01을 그대로 전환하면 같은 지점에서 같은 실패를 한다.**

⛔ 교훈 — 이 결함은 **서명 패키지 밖**에 있다. `agent-config.yaml`은 설치 시 덮어쓰지 않는 고객 서버 전용 파일이라, 고치는 데 빌드·manifest·배포 패키지가 필요 없다. 그런데 실제로는 owner 키트 재작성과 릴리즈 재발행(release 5→7→9→15)으로 대응했다. **작업 단위를 결함이 아니라 산출물로 잡으면 1글자와 1000줄이 같은 비용이 된다.**

## 4-2. ★★ 차단 결함 — 신규 등록 경로가 닫혀 있다 (2026-08-14 실측 확인)

**상태 = 현재 어떤 Agent도 신규 등록(enrollment)이 불가능하다. hanjul01·02 전환도, 향후 고객사 이관도 여기서 막힌다.**

실측: 대시보드 원격배포 → hanjul02 → "Bootstrap 전환 안내" → 본인확인 → `nonce 발급` →
**"요청을 완료하지 못했습니다. 상태를 새로고침해 주세요."** 모달의 `버전` 표시 = **1.0.22**.

두 코드가 서로 어긋나 있다:

| 위치 | 동작 |
|---|---|
| `web/api/services/agent-credential-service.js:459` | `release.version !== '1.0.20'` → **409 `ENROLLMENT_RELEASE_NOT_APPROVED`**. 등록은 **오직 v1.0.20**만 수용 |
| `web/dashboard/src/pages/RemoteDeployPage.jsx:152` | `currentRelease = releases.find(r => r.status === 'approved')` — **승인된 첫 릴리즈를 그대로 사용. 릴리즈 선택 UI 없음** |

→ 릴리즈 원장에 1.0.21·1.0.22가 올라온 순간부터 화면은 최신을 보내고 서버는 1.0.20만 받는다. **hanjul03은 1.0.20이 최신이던 시기(0805)에 통과했고, 그 뒤 등록 경로는 아무도 지나갈 수 없다.**
모달 안내문("공개 v1.0.20 설치 패키지는…")만 1.0.20을 말하고 실제 전달 값은 최신이라, 화면 문구와 동작도 어긋나 있다.

**수정 위치 = Node(`web/api/…`) — Go 게이트웨이 재빌드 불필요.** 파일 교체 + 재시작.

★2026-08-15 전수점검 — **핀은 459 한 곳이 아니라 3곳**: `agent-credential-service.js:210`(legacy bootstrap 발급) · `:459`(nonce 발급) · `:566`(enrollment). 정리 시 세 곳을 한 번에 같은 축으로 고쳐야 한다.

**★2026-08-15 해소 — 핀 3곳 제거 완료**(Harold 승인 "핀 제거 방식" · 커밋 `8a6cfc1` · npm test 8종 exit=0). 수용 기준 = 릴리즈 원장의 `approved` + os/arch/child_digest 일치. **1.0.20 세트가 은퇴해도 등록 경로가 유지된다.** 잔여(별건) = 화면 릴리즈 선택 UI 부재(`RemoteDeployPage.jsx:152` — 첫 approved 자동 선택).

⛔ **수정 방향은 미확정이다.** 버전 문자열을 `1.0.22`로 바꾸면 다음 릴리즈에 같은 함정을 다시 놓는다(= 증상 수정). 능력 축으로 판정하는 것이 맞으나, **`agent_release` 테이블에 `payload_profile` 같은 능력 컬럼이 없다**(`migrations/041` 실측 — store_key·descriptor_digest·manifest_digest·child_digest·signing_key_id·verified_at뿐). `payload_profile`(`agent-child-v1`)은 패키지 manifest와 `internal/agent/release/types.go`에만 존재한다. 따라서 ①핀 제거(approved+os+arch+child_digest 검증은 유지) ②능력 컬럼 신설(DDL 동반) 중 선택이 필요하고, **착수는 Harold 승인 후.**

## 4-3. ★★★ 신규 등록 SQL이 100% 실패한다 — `$9` 미참조 (2026-08-14 확정·수정완료)

**증상** = 에이전트가 `enrollment HTTP 500`. 서버 로그 없음, 에이전트도 본문을 버려(`enroller.go:240` `fmt.Errorf("enrollment HTTP %d", ...)`) **원인이 어디에도 안 남았다.**

**실제 오류**(로그 추가 후 포착):
```
42P18  could not determine data type of parameter $9
   at agent-credential-service.js:675   ← enrollment UPDATE
```

`enrollControlCredentials`는 `mutationParams` 14개를 항상 넘기는데, `$9`(`legacy_bootstrap_generation`)를 참조하는 fence는 두 개뿐이었다:

| 분기 | `$9` |
|---|---|
| `legacyRecoveryAttempt` (614행) | `AND legacy_bootstrap_generation=$9` ✓ |
| `authActor==='bootstrap'` (631행) | `AND legacy_bootstrap_generation=$9` ✓ |
| **일반 등록 (642행)** | **없음 → 타입 추론 불가 → 쿼리 전체 실패** |

→ **일반 등록 경로는 구조적으로 100% 실패.** hanjul03이 0805에 이 경로로 성공했으므로, 그 뒤 legacy bootstrap 기능(v246·v247 `legacy_bootstrap_initial_fence` 계열)이 들어오며 깨졌고 **신규 등록을 한 번도 안 해봐서 아무도 몰랐다.**

**적용한 수정** (Harold 승인, `.bak-20260814` 백업 보유):
```js
   AND bind_pw_hash=$8
   AND COALESCE(legacy_bootstrap_generation,0)=$9        // ← 추가
   AND legacy_control_grace_expires_at>clock_timestamp()`;
```
같은 트랜잭션에서 읽은 값이라 항상 일치하며, 다른 두 분기와 같은 낙관적 동시성 fence다. DDL 0 · 응답 형식 변경 0.

**같이 넣은 것** — `agent-control-enrollment.js` `sendError()`에 `console.error` 1줄. 이 경로는 **모든 예외를 로그 없이 500으로 삼키고 있었다.** 임시가 아니라 영구 코드로 둔다.

⛔ **교훈** — 트래픽 0은 안전의 증거가 아니다. 이 결함은 "고객사 200곳" 계획의 첫 관문에 있었고, 버전 핀(§4-2)과 함께 **신규 등록을 막는 두 겹**이었다.

**★2026-08-15 소스 사본 동기화 완료** — 서버(.65)에만 있던 세 수정을 소스 사본에 반영했다: ①`agent-credential-service.js` 일반 등록 분기에 `AND COALESCE(legacy_bootstrap_generation,0)=$9` 추가(3분기 전부 `$9` 참조 확인) ②`agent-control-enrollment.js` `sendError()`에 `console.error` ③`agent-upgrade-rollouts.js` `sendError()`에 `console.error`. 백업 = 각 파일 `.bak-20260815`, `node --check` 3파일 통과. 로그 줄 문구는 서버판과 다를 수 있으나 **소스판이 정본** — 다음 배포 때 소스가 서버를 덮는다.

## 4-4. hanjul01 전용 차단 — 옛 토큰이 12자 (2026-08-14 확정)

`install.sh` → `installer migrate setup failed: **invalid protected legacy token**`

`loadLegacyToken`(`installerruntime/runtime.go:188`)이 `agent-config.yaml`의 `gateway.token`을 꺼내 `validLegacyToken`(239행)으로 검사하는데 **최소 32자**를 요구한다. hanjul01은 **12자**(doctor `GatewayToken length=12`), hanjul02·03은 64자라 통과했다.

**제품이 준비한 우회로는 쓰지 않는다.** `legacy-bootstrap-credential`(migration 043 · `2026-07-30_..._TOO_SHORT_BOOTSTRAP_RECOVERY_*`)이 이 문제를 위해 만들어졌지만, 요청 본문에 `prepared_gate_sha256`·`prepared_state_sha256`이 **필수**(`normalizedBootstrapInput:151-152`)이고 이 값을 만드는 서브커맨드가 설치기에 없다(`account-profile`·`migrate`·`recover`뿐). 즉 **폐기된 owner 키트에 묶인 경로**다.

**처방 = 토큰 자체를 정상 길이로 바꾼다.** `POST /api/admin/agents/{agentId}/token/rotate`(`routes/agents.js:730`, 본문 `token` 직접 지정 가능)로 hanjul01의 토큰을 ≥32자로 회전 → `/opt/bito-agent/agent-config.yaml`의 `gateway.token` 갱신 → 재시작·GW 연결 확인 → 그다음은 §5 일반 절차 그대로. 우회로 자체가 불필요해진다.

⛔ 회전과 config 갱신 사이에는 인증이 끊긴다. 라인 13은 트래픽이 없어 위험이 낮지만 **연속 작업으로 처리**할 것.

## 4-5. 공유 부모 디렉터리에 통과 ACL이 없다 (2026-08-15 확정)

hanjul01 전환 시 `installer migrate failed: systemctl failed: exit status 3 ()` → journald 실체:
```
bootstrap active child recovery failed:
fork/exec /var/lib/bito-agent-bootstrap/hanjul01/instances/<hash>/versions/<digest>/payload/bito-agent: permission denied
```

원인 = 공유 부모 `/var/lib/bito-agent-bootstrap`의 ACL:
```
user:bito-hanjul02:--x
user:bito-hanjul03:--x     ← bito-hanjul01 없음
```

**설치기는 에이전트별 하위 디렉터리는 만들지만 공유 부모의 통과 ACL은 추가하지 않는다.** 부모에서 끊기면 하위 권한이 아무리 맞아도 exec이 거부된다. 02·03 것은 과거 키트가 넣어준 값이었다.

**처방** = `setfacl -m u:bito-<agent>:--x /var/lib/bito-agent-bootstrap` (신규 설치마다 필요)

⛔ **고객사 신규 설치에 매번 걸린다.** 에러 문구(`fork/exec … permission denied`)만으로는 부모 ACL이 원인임을 알 수 없어 진단이 오래 걸린다. §5-0에 상시 절차로 편입했다.

## 4-6. 브랜드메시지 — **전용 피더로 분리**(★2026-08-15 Harold 지시)

**이 축의 확정 사실·결함·이력은 [bito-gateway/FEATURE-GW-BRAND-MESSAGE.md](bito-gateway/FEATURE-GW-BRAND-MESSAGE.md)가 소유한다**(호출어 **브랜드메시지**). 여기 재서술 금지.

요지만 — 0815에 **파이프 관통 확인**(한줄로→Agent→게이트웨이→휴머스온 접수 `RETURN_CODE 1000`)하고 Agent F/FB 매핑을 개통했으나, 카카오 발송은 **REPORT 4101 고정**(= `SERIAL_NUMBER_PREFIX_DATE_EXCEPTION`, 형식 규격 미보유로 휴머스온 회신 대기). 같은 날 **한줄로 측 결함 4건 확정**(AD_FLAG·HEADER/ADDITIONAL_CONTENT·수신거부 필드 미전송 + 본문 컬럼에 제어 필드를 섞는 구조) — 작업 지시서 = `docs/2026-08-15-brand-contract-fix.md`(완료 후 삭제).

## 5. 전환 실행 절차 (확정본 — 2026-08-14)

⚠ **최초 등록은 v1.0.20만 가능**(§4-1 하드코딩). v1.0.21은 전환 완료 후 **원격 업그레이드**로 올린다. v1.0.21 패키지는 1단계에 쓰는 물건이 아니다.

**0. 사전 수정** (§4-1 상대경로·ACL + §4-4 토큰 길이 + §4-5 부모 ACL — 셋 다 안 하면 반드시 실패한다)
```bash
# 토큰이 32자 미만이면 먼저 회전 (§4-4) — POST /api/admin/agents/<AGENT>/token/rotate {token:"<64자>"}
sed -i 's|journal_path: "data/agent-journal-<AGENT>.jsonl"|journal_path: "<INSTALL_DIR>/data/agent-journal-<AGENT>.jsonl"|' <INSTALL_DIR>/agent-config.yaml
setfacl -m u:bito-<AGENT>:--x <INSTALL_DIR>
setfacl -m u:bito-<AGENT>:rwx <INSTALL_DIR>/data
setfacl -m u:bito-<AGENT>:rw- <INSTALL_DIR>/data/agent-journal-<AGENT>.jsonl
setfacl -m u:bito-<AGENT>:--x /var/lib/bito-agent-bootstrap          # ★ 공유 부모 (§4-5)
# control 디렉터리도 동일 (installer-config·CA를 child가 읽어야 함)
setfacl -m u:bito-<AGENT>:--x /var/lib/bito-agent-control/<AGENT>
setfacl -m u:bito-<AGENT>:r-- /var/lib/bito-agent-control/<AGENT>/control-ca.pem
```
→ `systemctl restart` 후 journald에 절대 경로 + `GW 연결 완료` + ERROR 0 확인. **여기서 걸러야 설치를 낭비하지 않는다.**

**1. nonce 발급 — 슈퍼관리자 대시보드** (`ops.hanjulgw.com`)
좌측 메뉴 **원격배포**(`remote-deploy` · App.jsx:71) → Agent 선택 → 액션 **"Bootstrap 전환 안내"**(RemoteDeployPage.jsx:75) → **본인 확인(비밀번호 재입력 = `remoteDeployMutation` CSRF 발급)** → 모달의 `버전`이 **1.0.20**인지 확인 → **"nonce 발급"**. 15분 유효.
- API 실체 = `POST /admin/agent-upgrades/agents/{agentId}/enrollment-nonces` → 내부적으로 `createEnrollmentNonce`
- 재인증 없이 호출 시 `REMOTE_DEPLOY_REAUTH_REQUIRED`(428)

**2. 설치 — 서버 root, 15분 안에**
```bash
cd /var/lib/bito-agent-control/<AGENT>/package-v1.0.20 && bash install.sh --config /var/lib/bito-agent-control/<AGENT>/installer-config.yaml
```
`Enrollment nonce:` 프롬프트에 붙여넣기(비표시). **프롬프트 상태에서 Ctrl+C는 안전** — nonce를 읽은 뒤에야 `installer migrate`가 시작된다. 실패 시 `rollback.sh`(2회 실측 검증됨).

**3. 실측 → 확정** — 발송 1건 결과 반영 확인 후 대시보드 **"Bootstrap 전환 확정"**(finalize_bootstrap). 화면 경고 그대로 **실번호 smoke 전에는 확정 금지.**

**4. 원격 업그레이드** — 확정 후 v1.0.21은 SSH 없이 원격 교체.

⛔ **owner 키트(`/var/lib/vito-owner-kits/…`)는 쓰지 않는다** — `install` 단계가 SSH `authorized_keys` forced-command 라인을 교체한다. 우리가 필요한 건 nonce와 `install.sh`뿐이다. (키트 규모 = host.sh 49KB + owner.ps1 62KB + README 16KB)

## 6. 한줄로 측 현황 (Agent 3대)

| agentID | 라인 | 테이블 | systemd 유닛 | 버전 | 상태 (2026-08-14 23:30 기준) |
|---|---|---|---|---|---|
| hanjul01 | 13 | SMSQ_SEND_13 | **`bito-agent.service`**(hanjul01 안 붙음) | **1.0.20** | ✅ **전환 완료**(2026-08-15 00:03) — bootstrap 관리형 · credential `active`(gen 2) · 실측 수신 정상(Harold 확인) |
| hanjul02 | 14 | SMSQ_SEND_14 | `bito-agent-hanjul02.service` | **1.0.20** | ✅ **전환 완료** — bootstrap 관리형 · credential `active`(gen 3) · smoke 확정 · 발송/결과반영 실측 완료 |
| hanjul03 | 15 | SMSQ_SEND_15 | `bito-agent-hanjul03.service` | 1.0.22 | 전환 완료형(목표 상태) · bootstrap **1.0.27** |

- 전환 사유 = 01·02가 구형이라 **원격 업그레이드 미지원**. 주소·연결·인증은 전부 정상이었다.
- 전환은 기존 config·토큰·서비스 정체성을 보존한다 → **잊어버린 ID·비번 재입력 불필요**(이 세션의 출발 질문).
- ⚠ **bootstrap 버전 격차** — hanjul02 `1.0.22` vs hanjul03 `1.0.27`. hanjul02를 1.0.22 child로 올리려 하면 rollout이 `CANARY_LANE_MISSING`으로 거부된다(실체는 적격 판정 실패가 그 이름으로 튀어나오는 것 — `agent-rollout-service.js:127-137`은 **`eligible===true`인 canary만** 세므로 진짜 사유가 가려진다). 유력 원인 = `minimum_bootstrap_version` 미달(`:97-98`). 임계값은 `agent_release` 컬럼이 아니라 **아티팩트 descriptor**에 있어 한 겹 더 들어가야 확인된다. `state_schema`는 01·02·03 모두 `1`로 동일 — 그 축은 아니다.

## 7. 관측된 개발 방식 (판단 근거 — 비난 아님)

| 사실 | 수치 |
|---|---|
| 상태 문서 | 139개 (DESIGN 48 + PLAN 63 = 111개가 설계/계획 쌍) |
| deploy 패키지 디렉터리 | 163개 |
| 버전 | 3주 만에 v230 → v249 |

변경 하나당 `_DESIGN.md` + `_IMPLEMENTATION_PLAN.md` 한 쌍과 버전 디렉터리 하나가 생기는 구조다. SSH 타임아웃 하나에도 설계서가 붙었다(`2026-07-24_AGENT_V120_PREPARE_SSH_TIMEOUT_DESIGN.md`).

**진단 = 규칙이 나쁜 게 아니라 "크기 다이얼"이 없다.** 그쪽 `CODEX.md`의 안전 경계(멱등성 계약·ACK 규약·credential 상태 기계)는 이 도메인에 타당하다. 문제는 작은 변경에 싼 경로가 없어서 비밀번호 재설정 하나가 프로토콜 변경과 같은 의식을 치른다는 것. 우리 `CLAUDE.md`의 `HOTFIX` 조항에 해당하는 장치가 없다.

## 7-1. 소스 전수점검 결과 (2026-08-15 실측 — 비토 직접 실행)

**총평 = Go 코어는 상급, 결함은 Node 관리 플레인(web/api)과 저장소 위생에 집중.** 우리가 겪은 결함 6종(§4)이 전부 Node·config·ACL에서 나온 이유가 코드 구조와 일치한다.

**규모** — Go 실소스 394파일 101,248줄(테스트 파일 159개) / web/api JS 109파일 44,599줄 / 마이그레이션 49개.

**테스트 실행 증거** (로컬 go1.26.0, 격리 캐시)
- `internal/gateway/...`+`internal/common/...` 전 패키지 ok
- `internal/agent/...`+`cmd/...` 30개 ok, 2건 실패:
  - `internal/agent/reinstaller` **테스트 빌드 실패** — `reinstall_test.go:29`가 리팩터로 사라진 `Plan.StagedRoot` 참조. 프로덕션 코드는 컴파일됨. 전체 스위트가 green이 아닌 채 방치돼 있었다는 신호
  - `cmd/agent-bootstrap` 3건 — Windows DACL "Access is denied". 실행 환경 요인 유력, 코드 결함 여부 미검증

**Go 코어에서 확인한 견고함** — provider write 3분류(미기록/거절/불명)와 불명 시도 격리(`sender.go` quarantine, REPORT/운영자 해소 전 재클레임 차단) / 내구 ACK 복구 / 발신자 식별코드 FOR SHARE 잠금(TOCTOU 차단) / `ON CONFLICT` 멱등 + 동일 키 상이 본문 충돌 검출(`writer.go`) / report_queue 내구 적재 + Agent ACK 후에만 DONE + 재연결 replay / 3-tier TPS 전부 Redis 장애 fail-closed / 마이그레이션 041은 실행 전 기존 데이터 위반 검증까지 수행. 위생: panic 1곳·TODO 2곳, 인증 sha256+timingSafeEqual, 세션 쿠키 SameSite=Strict.

**신규 확정 결함·위험** (§4 기존 6종 외)
| # | 내용 | 위치 |
|---|---|---|
| 1 | 1.0.20 버전 핀 3곳 (§4-2에 반영) | `agent-credential-service.js:210·459·566` |
| 2 | `sendError` 에러 삼킴은 **8개 라우터 전부** — 인라인 중복 8벌, 로그는 enrollment·rollouts 2곳만 넣은 상태. 잔여 6곳 = agent-control-commands · agent-control-heartbeats · agent-control-releases · agent-upgrade-commands · agent-upgrade-fleet · agent-upgrade-releases | `web/api/routes/` |
| 3 | **결과 반영 poison 처리 부재** — 고객 DB에 영구 반영 불가한 결과(row 소멸 등)는 ReportAck 보류 → 재연결마다 무한 재전달. dead-letter 경로 없음. 7월 hanjul01 반영 실패 2,502회 누적과 형태 일치. 다른 결과 처리는 막지 않음(head-of-line 아님) | `poller.go` HandleReport·`recordReportDBFailure` |
| 4 | finalize 경로 불일치 소스 확정 — 프론트 `bootstrap/finalize` vs 서버 `bootstrap-finalize` (§8 잔여) | `api.js:160` vs `agent-control-enrollment.js:321` |
| 5 | CANARY_LANE_MISSING 가림 구조 확정 — 부적격 사유 14종을 계산해 놓고 밖으로는 한 마디로 던짐 (§6 기재와 일치) | `agent-rollout-service.js:90-137` |
| 6 | 저장소 위생 — `.git` 빈 껍데기(이력 0) · 30MB 바이너리 3개 방치 · `{cmd` 셸 확장 실패 쓰레기 디렉터리 · scripts 121개 중 버전·사고당 전용 빌드 스크립트 30개 | 최상위 |

**관찰 (처방 아님, 영향 미측정)** — ①발신번호 허용 캐시가 전역 뮤텍스를 DB 조회 동안 유지(`sender.go:1177-1182`), 대량 발송 시 직렬화 지점 가능 ②CORS가 모든 origin을 credentials와 함께 반사하나 SameSite=Strict가 실질 방어 중 ③web/api 테스트는 로컬 사본에서 의존성 미설치로 실행 불가(MODULE_NOT_FOUND) — Node 쪽은 Go와 달리 계약 테스트 규율이 얇다.

## 7-2. 2차 전수점검 — 결함 5종 확정·수정 (2026-08-15(2) 실측 · Harold 승인 후 수정)

§7-1이 표면을 훑은 뒤 돈·발송 경로를 깊이 읽은 회차다. **찾은 5건 전부 수정·커밋 완료**(`139a6c9`·`a9db8ad`·`6b8fd1b`·`95f4a0b` + 리뷰 정정 `d8723d6`·`f44e36e`). 서버 미반영 — Go 바이너리 재빌드 필요(그쪽 STATUS 「미배포 수정」이 배포 원장).

| # | 결함 | 근거 | 처리 |
|---|---|---|---|
| A | **빈 결과코드를 성공으로 판정**(fail-open) | `report.go:302`·`sender.go:1549`·`poller.go:820` 3곳 복제. 유입 = `humuson_imc/protocol.go:159-166`(키 부재 시 `""`) · `gemtek/packet/report.go:66`(4바이트 RESULT 공백) | 판정을 `internal/common/resultcode` 하나로 모으고 빈 코드 제외. ACK 집합(`0`,`0000`)과 REPORT 집합(8종)은 계약이 달라 분리 유지 |
| B | **PAY 통계에서 단가 키 없는 msg_type이 DB 안에서 소멸** | `paystats/reporter.go` `CASE ELSE NULL` + 같은 CASE를 반복한 `HAVING` | 매핑을 Go(`payMsgType`)로 이관, `HAVING` 제거. 미적재는 유지하되 Error 로그로 노출. 같은 보고 키로 접히는 유형은 Go에서 합산 |
| C | 공용 오류 헬퍼가 내부 예외 메시지를 응답 본문에 노출 | `web/api/middleware/route-error.js:11` — 8개 라우터 전부 사용 | `statusCode`를 단 오류만 코드 유지, 그 외는 기본 코드로 덮음 |
| D | 죽은 과금 코드 **6개**(§7-1이 2건으로 본 것보다 많다) | `inbound_billing.go` 전체 + `billing_finalizer.go` SQL 빌더 4개. 참조 0 실측 | 삭제(839줄). `applyInboundBilling`은 잔액 읽기·차감이 트랜잭션 밖이라 재배선 시 동시 차감 경합 |
| E | Bind TPS 토큰을 쓰고 버림 | `router.go:211·255` | 후보 판정을 `Ready`(부작용 0)/`Claim`(HALF_OPEN probe 예약)로 분리. `bind_health.go`에 `CanProbe` 신설 |

**E는 원안을 폐기하고 다시 설계했다.** 처음엔 `eligible`을 `Acquire` 앞으로 옮기려 했는데, 그 함수가 `AllowProbe`로 probe를 **예약하는 부작용**을 갖고 있었다(`engine.go:496`). 순서만 뒤집으면 자가 회복되는 초당 토큰 대신 그 bind를 복구 불가로 묶는 probe가 샌다. `router_test.go:100`이 원래 순서를 고정하고 있던 이유가 그것이다. ⛔ **부작용이 있는 판정 함수를 "그냥 앞으로 옮기는" 처방은 트레이드오프를 옮길 뿐이다 — 순수 부분과 자원 확보 부분을 나눠야 둘 다 안 샌다.**

### Codex 적대 리뷰 2라운드 (돈·환불 경로라 `adversarial-review`)

**1R = `needs-attention` · high 3 · critical 0.** 셋 다 코드로 사실 확인 후 수용했다.

1. **빈 REPORT가 자동 재발송을 촉발**(`report.go:414`가 `success==false`만 봄 · `poller.go:565` 동일) — A 수정으로 빈 코드가 "실패"가 되면서, 원문이 실제로 전달됐는데 코드만 빠진 건까지 kakao fallback이 열렸다. **내가 만든 회귀다.**
2. **빈 ACK 격리가 미전송 확정 건까지 삼킴** — 격리는 REPORT를 기다리는 상태인데 미전송 건엔 REPORT가 오지 않아 그대로 미발송으로 끝난다.
3. **paystats 유형 비교를 `EqualFold`·`TrimSpace`로 넓힘** — 키가 옮겨가면 UPSERT가 이전 키를 안 지워 옛 행과 새 행이 함께 남아 이중 청구.

1·2는 **같은 뿌리** — 3상태(성공/실패/불명)를 재발송 판정 지점에서 2상태로 접은 것. 항목별로 때우지 않고 원칙 하나로 고쳤다: **상태·과금은 실패로 종결하되, 새 메시지를 보내는 동작만 명시적 실패 증거를 요구한다.** `shouldStartKakaoFallback`이 `bool` 대신 `resultcode.Verdict`를 받는다.

3은 수용하되 처방을 축소했다. Codex는 "기존 스냅샷 재조정 절차"를 권했지만, 넓힌 것을 되돌리면 키 이동 자체가 없어 절차가 불필요하다. **더 작은 수정이 결함을 닫는다.**

부수로 하나 더 닫혔다 — 빈 `ack_code`가 NULL로 적재되면 `durable_ack_accepted` 판정(`sender.go` loadMessage)이 그 건을 성공으로 되살린다. 합성 코드 `EMPTY_ACK`가 그 경로도 막는다.

**2R = `approve` · material findings 0.** 지목한 5개 판단(호출부 3곳의 판정값 · `SendWriteUnknown` 선반환 · 합성 코드의 하류 영향 · poller에서 빠지는 것이 `Indeterminate`뿐인지 · paystats가 원래 SQL과 동일한지)을 모두 확인. 종료 조건 충족.

### 잔여 (처방 아님 — 미검증)

- **PAY 통계 대상 테이블 UNIQUE 실존 미확인** — `RSRM_SalesStts`에 (DestDt,CustId,StoreId,MsgType) UNIQUE가 없으면 스냅샷 UPSERT가 성립하지 않고 매 주기 INSERT가 쌓인다. **우리 DB가 아니라 코드로 못 막는다.** 첫 적재 실측(§10 잔여)에서만 확정된다
- **성공 판정이 계열을 구분하지 않는다** — `MESSAGE_RESULT_CODE_STANDARD.md`는 SMS/LMS·MMS/카카오를 별도 코드북으로 규정하고 카카오 `1000`을 "접수 성공, 최종 성공 아님"으로 둔다. 현재는 계열 무관 8종 단일 집합. 카카오 REPORT에 `1000`이 실제로 오는지 표본이 없어 고치지 않았다
- admin API 키 인증 캐시에 무효화 훅 없음(`auth.js:96-114`) — 계정 비활성·키 회전이 최대 5분 지연. 평문 저장 축(그쪽 STATUS #10)과 함께 처리

⛔ **교훈** — ①"빈 값"은 성공도 실패도 아니다. 2상태로 접는 순간 어느 쪽으로 접든 사고가 난다 ②**돈 방향을 fail-safe로 바꾸는 것만으로는 부족하다** — 같은 판정을 먹는 다른 동작(재발송)이 있으면 그쪽은 반대 방향으로 위험해진다 ③리팩터에 의미 확장을 끼워 넣지 않는다(paystats `EqualFold`)

## 8. 남은 것 (착수 순서 — ★2026-08-14 Harold 지시로 비토가 컨트롤)

**전제: 자비스 세션 정지 확인 후 착수.** 게이트웨이 저장소의 `status/`·`CLAUDE.md`·`CODEX.md`·`AGENTS.md`는 계속 편집 금지(§2).

1. [x] ~~**hanjul02 전환**~~ — **2026-08-14 완료.** 사전 수정 → nonce(release 15) → `install.sh` → `BITO_AGENT_MIGRATION_OK` → smoke 1건(결과반영 1.24초·실패 0) → `bootstrap-finalize` → credential `active`
2. [x] ~~**hanjul01 전환**~~ — **2026-08-15 00:03 완료.** 토큰 회전(12→64자) → 사전 수정 → **부모 ACL 추가**(§4-5) → nonce → `install.sh` → `MIGRATION_OK` → finalize → `active`(gen 2)
2-1. [x] ~~hanjul01 실측~~ — 라인 13 수신 정상 확인(Harold, 2026-08-15). ⚠ finalize를 smoke 전에 눌렀으므로 `reportDBFailures` 카운터 자체는 미확인 — 다음 세션에서 `journalctl … grep "Poller 상태" | tail -1`로 한 번 볼 것
2-2. [x] ~~★게이트웨이 서버 수정분을 소스 사본에 반영~~ — **2026-08-15 완료.** `$9` fix + 로그 2줄을 소스 사본에 반영(§4-3 동기화 기록 참조, 백업 `*.bak-20260815`, `node --check` 통과). 서버 백업 = `*.bak-20260814`
3. [ ] **버전 핀 정리** (§4-2) — 오늘은 release 15(v1.0.20)가 approved라 우회했지만, **1.0.20 세트가 은퇴하는 순간 신규 등록이 전면 불가**가 된다. 고객사 이관 전 필수. **핀은 3곳**(§4-2 ★0815). 화면의 릴리즈 선택 부재(`RemoteDeployPage.jsx:152`)도 같은 축
4. [ ] **finalize 경로 불일치** — 프론트 `/bootstrap/finalize` ↔ 서버 `/bootstrap-finalize`. 화면 버튼 조건도 실제 판정 코드(`자격증명 활성화 대기`)와 불일치(`FleetRolloutPanel.jsx:68`은 `BOOTSTRAP_VALIDATION_PENDING`만 처리). **이 기능은 화면에서 한 번도 성공한 적이 없다**
5. [ ] **bootstrap 버전 격차** — 01·02를 1.0.27로. child 원격 교체와 **별도 게이트**. 패키지의 `upgrade.sh`는 `/opt/vito-agent` 레이아웃 전제라 이 설치에 그대로 못 쓴다
6. [ ] **원격 업그레이드 실측** — 5번 해소 후 SSH 없이 왕복 1회
7. [ ] **재시도 불가 구조** — 롤백 성공(`rolled_back`) 후에도 `Migrate()`가 journal 존재만으로 거부(`migrate.go:31`), `Recover()`는 아무 것도 안 함(`recovery.go:22`). 인스턴스를 밖에서 치워야만 재시도된다. 그 도구(owner 키트)는 `gen1` 하드코딩. **고객사 설치가 한 번 실패하면 매번 사람이 들어가야 한다**
8. [ ] **에러가 로그에 안 남는 구조** — `sendError`가 예외를 삼킨다. **★0815 전수 실측 = 인라인 중복 8벌**(§7-1 표 2번), 로그는 enrollment·rollouts 2곳만 반영됨. 잔여 6곳 + 에이전트도 응답 본문을 버린다(`enroller.go:240`)
9. [ ] **고객사 이관 전 검증 4종** (§7 판단 근거) — 라인 14에서: ①결과 반영률(보낸 건수 = 최종 status_code 반영 건수) ②`batch_size 200` 초과 물량 ③실패 코드 혼합 ④발송 중 에이전트 재시작 시 중복·유실 0
10. [ ] **`reportDBFailures` 경로 확인** — 7월 hanjul01에서 2502회 실패 이력. **★0815 소스 확정 = poison 결과 dead-letter 부재**(§7-1 표 3번): 영구 반영 불가 결과는 재연결마다 무한 재전달. 고객사에서 터지면 "발송됐는데 영원히 대기"
11. [~] **문서 정제** — ★0815 (1)스포크 6축 전부 점검·문서화 완료(§9 표) (2)작업 규율 성문화(§2-1) (3)**게이트웨이 `CODEX.md`·`status/STATUS.md` 한줄로 규율판으로 재편 완료**(Harold 지시 · 백업 `.bak-20260815` · CODEX = 승인 게이트·결함 단위·빌드 규율·백업·로그 먼저·정답 1개 + 기존 안전 경계·라우터 보존 / STATUS = snapshot·index 전용, 3대 실측 기준점·미해결 12건 표). (4)status/ 루트 날짜형 문서 **114개** → `archive/root-design-plan-20260815/` + 무날짜 일회성 **15개** → `archive/root-standing-oneoffs-20260815/`(참조 5곳 경로 정정 동반) — 루트 상설 11개만 잔존 (5)**domain 8개 현행화 완료**(0815(5) — 스포크 상호 참조 헤더 + 낡은 서술 2곳 정정: hanjul01·02 전환 완료 반영·0814 운영 반영 구분) (6)STATUS 미해결 표를 「항목→코드 근거→소유 문서」 구조로(한줄로는 모티브만 — 호출어·카드 스키마 등 한줄로 고유 장치는 이식하지 않음, 게이트웨이 정체성 보존 = ★0815 Harold 지시). ⚠hanjul03 버전 상충 발견(자비스 기록 1.0.21 vs 우리 0814 기록 1.0.22) — STATUS에 실측 1회 필요로 표기. 잔여 = 재편 사실 자비스 공유(Harold 몫)뿐. **Harold 확정 순서 = 에이전트 전환 완료 → 자비스 작업 종료·빌드 → 전 작업 정지 → 자비스가 그 시점까지 문서 현행화 → 그다음 착수.** 핵심은 형식이 아니라 강제력(§7 진단): ①HOTFIX 등가 조항(위험 등급별 절차 분기) ②"명령 하나씩 주고 결과 보고 받기"를 명시 — 현행 규칙이 (가)/(나) 중 어느 쪽인지 안 정해놔서 112KB 자가복구 절차가 나왔다 ③"배포 산출물 자동복원 검증" 조항에 적용 조건 부여 ④변경당 DESIGN+PLAN 쌍 금지, 버전당 전용 빌드 스크립트 금지 ⑤**reinstaller 테스트 빌드 실패 수선 + 전체 스위트 green 상시화**(§7-1)
12. [ ] 미수령 자료 2건 확보 — `ViTO-Agent-API-DB-Handoff-v1.2.zip` · `ViTO-Gateway-API-Integration-Manual-v1.13.docx` (checksums.sha256 등재분)
13. [ ] **한줄로 측 브랜드 3종 (★0815 우선순위 상승 — §4-6이 원장)** — ①능력 기반 라우팅(F는 게이트웨이 라인 전용 · `brand-message.ts:618·743`. 오늘 psy5868 7421로 재현) ②발송 시간 가드(08:00~20:50) ③기본형 FB 적재. 게이트웨이 측 준비는 완료 상태
14. [x] ~~pay-ingest `sales` 계정 허용 IP에 `.65` 추가~~ — **0815 완료**(§10에 통합). 옛 게이트웨이 계정(`139.150.81.213`) 삭제도 함께
15. [ ] **`.54` 업체 이관 준비** (★0815 Harold 목표 — 이 트랙의 종착점) — `.54`(mmsr-qtmsg)에 붙은 고객사들을 우리 게이트웨이로 옮긴다. 그러려면 우리가 `.54`가 하는 일을 다 해야 한다: **①PAY 통계 적재**(0815 구현 = §10) **②브랜드메시지 발송**(4101 미해결 = 스포크 §3) ③이관 전 검증 4종(위 9번). 고객사 목록은 `.54`의 `~/ngen/cms_mg2/logs/YYYY-MMDD/`에 발송ID별로 있다(27개 — `isaekko`·`macaw` 등)

## 10. PAY 통계 적재 — 게이트웨이 → 한줄로 (★2026-08-15 신설·배포)

**왜** — 에이전트로 직접 발송하는 고객사는 한줄로에 아무 기록이 안 남아 **발송통계·청구·선불잔액이 성립하지 않는다.** QTmsg 중계(`.54`·`.57`·`.58`)는 이미 한줄로 수집 DB에 넣고 있고, **비토는 넣어줄 사람이 없으니 우리가 만든다**(0815 Harold — 게이트웨이·한줄로 둘 다 우리 통제권).

| 항목 | 값 |
|---|---|
| 규격 | [2026-08-14-bito-gateway-result-contract.md](../2026-08-14-bito-gateway-result-contract.md)(한줄로가 소유) |
| 구현 | `internal/gateway/paystats/reporter.go` · 기동 = `cmd/gateway/main.go`(opsAI와 동일 패턴) |
| DDL | `migrations/050_pay_stats_report_identity.sql` |
| 대상 | 한줄로 수집 DB `.62:23388` MariaDB `sales.RSRM_SalesStts` |
| **SysId** | **`65`** (중계 54·57·58과 구분 — 0815 Harold 확정) |
| 설정 | `.65` `/etc/default/bito-gateway`의 `GW_PAY_STATS_DSN`(+`_INTERVAL`·`_LOOKBACK_DAYS`). 미설정이면 조용히 비활성(발송 무영향) |
| 계정 | `sales@58.227.193.65`(0815 신설, `.54`와 동일 권한·비밀번호) |

**설계 결정 둘**
- **식별자 = `agent_account.pay_cust_id`(신설·UNIQUE)** — `agent_id`는 고객사가 자기 `agent-config.yaml`에 넣는 값이라 형식을 강제할 수 없다(0815 Harold 지적). 한줄로는 QTmsg의 `B`·`C`·`D`와 겹치지 않는 전역 유일 `CustId`를 요구하므로, **우리가 발급·소유하는 코드를 따로 둔다.** UNIQUE 제약이 규격서 §5의 전역 유일을 DB가 보장한다.
- **`pay_report_enabled` 기본값 FALSE** — 한줄로 발송분(`hanjul01/02/03`)은 **이미 SMSQ 큐로 청구된다.** 여기 또 넣으면 같은 발송이 두 번 청구되고, **에러 없이 금액만 틀려서 발견이 늦다.** 이름 규칙(`hanjul*`)으로 거르지 않는다 — 계정명이 바뀌면 조용히 샌다. 명시적으로 켠 계정만 적재한다.

⛔ **누적값 append 금지** — 한줄로가 `SUM()+GROUP BY`로 읽어서, 매 주기 누적 스냅샷을 새 행으로 쌓으면 **청구액이 배수로 부풀어 그대로 고객사에 나간다.** 그래서 스냅샷 UPSERT(한 키 한 행 덮어쓰기)이고, **그 형태를 테스트가 고정한다**(`reporter_test.go` 8건 — 누적으로 바꿔 주입하면 실패하는 것 확인).

**착수 절차(업체 붙일 때)** — ①`pay_cust_id` 발급 + `pay_report_enabled=true` ②한줄로 `company_agent_ids`에 그 값 ↔ 회사 등록 ③유형 단가 설정. **셋 중 하나라도 빠지면 그 업체 발송이 청구에서 통째로 빠진다.**
**잔여** = 실측(규격서 §10 — 1건 → 5건 추가 후 **행이 여전히 1개인지**. 2개면 즉시 중단).

## 9. 관련 문서

**기능별 피더(스포크) — ★2026-08-15 Harold 승인 체계.** 이 허브가 총괄·전환 운영·착수 원장을, 스포크가 축별 확정 사실·결함·잔여를 소유한다. 진행 순서 = 5→1→6→2→3→4 (Harold 확정).

| # | 축 | 문서 | 상태 |
|---|---|---|---|
| 1 | 관리 플레인(web/api) | [bito-gateway/FEATURE-GW-WEB-API.md](bito-gateway/FEATURE-GW-WEB-API.md) | **0815 점검·문서화 완료** |
| 2 | 설치·전환·업데이트 | [bito-gateway/FEATURE-GW-AGENT-DEPLOY.md](bito-gateway/FEATURE-GW-AGENT-DEPLOY.md) | **0815 완료** (결함 6종은 이 허브 §4가 계속 소유) |
| 3 | 에이전트 코어(poller·journal) | [bito-gateway/FEATURE-GW-AGENT-CORE.md](bito-gateway/FEATURE-GW-AGENT-CORE.md) | **0815 완료** |
| 4 | 발송·결과 엔진 | [bito-gateway/FEATURE-GW-ENGINE.md](bito-gateway/FEATURE-GW-ENGINE.md) | **0815 완료** |
| 5 | 과금 | [bito-gateway/FEATURE-GW-BILLING.md](bito-gateway/FEATURE-GW-BILLING.md) | **0815 완료** |
| 6 | 커넥터·라우팅 | [bito-gateway/FEATURE-GW-CONNECTOR-ROUTING.md](bito-gateway/FEATURE-GW-CONNECTOR-ROUTING.md) | **0815 완료** (능력 라우팅 부재 소스 확정) |
| 7 | **브랜드메시지** | [bito-gateway/FEATURE-GW-BRAND-MESSAGE.md](bito-gateway/FEATURE-GW-BRAND-MESSAGE.md) | **0815 신설**(허브 §4-6에서 분리) · 호출어 **브랜드메시지** |

- 한줄로 측 라인·Agent 운영 = [status/OPS.md](../status/OPS.md) §6-3
- 브랜드메시지 F 트랙 = [2026-07-29-brand-message-qtmsg-agent-design.md](2026-07-29-brand-message-qtmsg-agent-design.md)
- 게이트웨이 연동 명세(구버전) = [bito-gateway-integration-spec.md](bito-gateway-integration-spec.md) — ⚠ 주소가 옛 값
- 세션 기록 = memory `project_2026_0814_bito_agent_v1021_conversion`
