# 비토 에이전트 감시 · 자동 복구 설계서 (2026-10-25)

> 소유 = 이 설계의 판정 · 조치 · 경보 · 시험. 경위 = memory `project_2026_1025_hanjul03_sigsegv_stall`.
> 회의 = COLLAB §1 브레인스토밍(기획 · 백엔드 · 회의론자 · 1차 → 교차 1R → 회의론자 최종 「납득」).

## 1. 원래 안건 (Harold 원문 요지 · 첫 줄 고정)

「에이전트가 멈추거나 정지하면 강제로 다시 살리는 감시 프로그램을 만들어, 내가 없어도 문자 발송이 멈추지 않게 한다. 제대로 · 완벽하게.」
「여행 가서 하다 말고 접속해서 보고하는 일을 최소화한다.」
「에이전트가 1분 단위로 폴링하는 게 맞는지 확인한다.」

## 2. 접수 축 대조표

| 접수 | 이 설계의 어느 절이 닫나 | 빠지면 안 닫히나 |
|---|---|---|
| 멈춤 · 정지 시 자동 복구 | §5-A 판정 · 조치 | 닫힘 |
| 사람 개입 최소화 | §5-A 상한 · §5-B 경보 규칙 · 매일 요약 | 경보 폭주 · 매일 확인이 사람 몫으로 남음 |
| 「1분 폴링」 확인 | §3 실측 (답 = 0.5초 · 1분은 상태 로그) | 닫힘(코드 변경 없음) |
| 경보 수신 = ceo@ · suran@ · 보내는 계정 = ceo@ | §5-B | 닫힘 |
| 테일스케일 상시 | 1025 실행 완료(두 서버 enable · 노트북 접속 확인) · 이 설계 범위 밖 | — |

## 3. 실측 사실 (1025 Harold 서버 실행 출력)

- .62 유닛 4개 = `bito-agent`(SMSQ_SEND_13) · `bito-agent-hanjul02`(14) · `bito-agent-hanjul03`(15) · `bito-agent-hanjul-04`(16 · 시스템 발송). systemd 가 띄우는 것 = `bito-agent-bootstrap`(감독) → 자식 에이전트(`internal/agent/bootstrap/process_linux.go:38`). `Type=simple` · `Restart=always` · `RestartSec=5s` · `WatchdogUSec=0` · `TimeoutStopSec=90s` · `KillMode=control-group` · `StartLimitBurst=5/1min` · `User=root` · `StandardOutput=journal`.
- 폴링 실값(이번 기동 「폴링 시작」 줄) = 4개 모두 `interval 500ms` · `batchSize 100` · `sendConcurrency 4` · `statePolicy final_result_only` · `pollTimeout 10s` · `claimedRecovery 5m` · `claimedMaxAge 10m` · `statusLogInterval 1m` · 유닛당 폴러 1개(`sourceProfiles 1`). `bootstrap.yaml` 의 `poll_interval 1s` 는 감독의 관제 폴링이다(`cmd/agent-bootstrap/config.go:30`).
- 10:10:08 hanjul03 SIGSEGV 뒤 프로세스가 덤프 중 안 끝남 → 10:10:09~11:08 유닛 로그 0줄 · systemd 는 active → 58분 · 8,949건 적체. 05:18:32 bito-agent SIGSEGV 는 종료(status=2) → systemd 5초 재시작(정상).
- GW 가 끊기면 폴러가 끝나 상태 로그도 멈춘다 · 끊긴 동안 「GW 연결 실패, 재시도 대기」 Warn 이 backoff(상한 60s)마다 찍힌다(`cmd/agent/main.go:437` · `:483-506` · `:802-811`). hanjul-04 는 10-20 13:21 끊김 뒤 재시작 없이 다시 붙었다(「GW 연결 성공」 재등장).
- .65 alert-worker 는 10:20:33 · 10:51:33 에 hanjul03 끊김을 **이미 감지**했다(`alert_event` 2건). 그러나 규칙 8개 전부 `notify_method = dashboard` · 채널 = Slack 없음 · 이메일 0 → **사람에게 0통**. 4개 에이전트 등록 `active` · heartbeat 정상.
- 운영자 경보 문자는 모두 SMSQ_SEND_16 → hanjul-04 → .65 한 길(`internal-alert.ts:49,75` · `system-alert.ts:186` · `OPS.md:668-669`).
- 두 서버 → `smtps.hiworks.com` · `smtp.hiworks.com` 465 · 587 나가는 길 열림.
- .62 메모리 = ECC DDR5 16GB×4 · EDAC 메모리 컨트롤러 드라이버 미적재(`mc0` 없음) → 메모리 오류가 OS 에 안 보임. 원인(메모리 · 그 밖) 미확정. **크래시는 또 난다고 보고 설계한다.**

## 4. 뿌리 (ROOT-LEDGER)

- **R14 신설 제안 = 「감지했는데 사람에게 안 닿음」** — 판정 결과가 사람에게 가는 길이 없거나(.65 규칙 전부 dashboard), 감시 대상과 같은 길 하나뿐(경보 문자 = 16번 라인 = .65)이다. LESSONS_BACKEND:848-850(경보 길이 죽어도 알릴 길이 경보 길뿐)과 같은 뿌리.
- 판정 기준 = 운영 경보를 내는 곳은 공용 경보 함수 하나를 지나고, 그 함수는 **서로 독립인 두 길**(문자 + 메일)로 보낸다.
- 같은 뿌리 전수(1025 grep) = `scripts/backup.sh:37-40`(ALERT_CMD 한 길) · `scripts/monitor-dist.sh:20,28-36`(localhost:3000 한 길) · 새 감시. → 같은 배포에 공용 경보로 옮긴다.
- 계약 시험 = `scripts/` 의 셸 · 감시 소스에서 `ALERT_CMD` 를 직접 부르는 곳을 기계로 뽑아, 공용 경보(`scripts/ops-alert.sh`) 밖 호출 = 실패.

## 5. 설계

### 5-A. .62 감시 (`agent-watchdog`)

**형태** = 판정은 순수 함수(TypeScript · vitest), 실행은 얇은 CLI. `packages/backend/src/ops/agent-watchdog/judge.ts`(순수) · `main.ts`(journalctl · systemctl 호출 · 상태 파일 · 경보) → 빌드 산출물 `dist/ops/agent-watchdog/main.js` 를 systemd 가 돌린다.
- `bito-agent-watchdog.timer` = 1분(`OnUnitActiveSec=60s` · `AccuracySec=5s`) → `bito-agent-watchdog.service`(oneshot · `TimeoutStartSec=50` · `OnFailure=` 경보).
- 설정 = `/etc/bito-watchdog.env`(root 600 · 메일 계정 · 수신자 · 모드). 상태 = `/var/lib/bito-watchdog/state.json`.
- 모드 = `dry-run`(판정 · 기록만 · 조치 0) / `active`. 처음은 dry-run.
- 기존 `/etc/cron.d/bito-agent-watchdog` = active 전환 때 한 블록에서 제거(§7).

**매 회차 순서**
1. 자기 점검: `logger -t bito-watchdog probe-<회차ID>` 를 쓰고 바로 읽는다. 안 보이면 = journald 이상 → 판정 중단 · 경보만(오탐 재시작 4개 방지).
2. 유닛마다 이번 기동만 본다: `InvocationID` · `ActiveEnterTimestamp` · `NRestarts` · `ActiveState`. 로그 = `journalctl _SYSTEMD_INVOCATION_ID=<id>`.
3. 판정(아래 표). 3개 이상 유닛이 같은 회차에 재시작 판정 = 공통 원인 → 재시작 안 하고 경보만.

| 판정 | 조건 | 조치 |
|---|---|---|
| 기동 유예 | 기동 3분 미만 | 판정 안 함 |
| 동결 | 이번 기동 로그 3분간 0줄 | KILL |
| 폴링 교착 | 마지막 「GW 연결 성공」이 마지막 「GW 연결 실패/끊김」보다 뒤인데 `Poller 상태` 3분간 0줄 | KILL |
| GW 끊김 | 재시도 Warn 만 10분 넘게 | 경보만(재시작으로 안 풀림) |
| 계약 불충족 | `main.go:467` Error 줄 있음 | 경보만 |
| 정지(paused) | 상태 로그 `paused=true` 10분 넘게 | 경보만 |
| 업데이트 중 | 감독의 handoff 진행 표시(구현 때 실제 로그 문구를 실측해 고정) | 판정 안 함 |
| 기동 실패로 굳음 | `ActiveState=failed`(StartLimit 5/1분 도달) | 경보만(사람 필요) |
| systemd 자체 재시작 | `NRestarts` 증가 | 기록 · 매일 요약 · 상한 계산 |

- **조치 = `systemctl kill -s KILL <유닛>` 만**. 다시 띄우기는 `Restart=always` 가 한다(감시가 restart 까지 하면 한 사건이 두 번 세어진다 · 회의론자 1). 다음 회차에 「GW 연결 성공」 · `Poller 상태` 재등장으로 복구 확인 → 복구 경보.
- **상한** = 유닛당 60분에 `NRestarts` 증가 3회 초과 → 자동 조치 멈춤 · 「사람 필요」 경보 · 멈춘 사실 logger. 해제 = `bito-agent-watchdog reset <유닛>` 한 줄.
- **실패하면 닫힘** = 상태 파일 쓰기 실패 · 설정 읽기 실패 → 조치 0 · 경보.
- **KILL 직전 재확인**(Codex 1R) = 판정 때의 InvocationID 와 지금이 다르면(그사이 스스로 재기동) 끊지 않는다.
- **상태 손상**(Codex 1R · 2R) = 원본은 그 자리에 두고(복사본만) `actionsBlockedAt` 를 저장 → `reset all` 전까지 KILL 금지 · 경보 계속.
- 외부 호출(journalctl · systemctl · 메일 · ALERT_CMD)마다 시간 상한 20초.

### 5-B. 경보 (`scripts/ops-alert.sh` · 공용)

- 두 길 동시: ① 문자 = 기존 `ALERT_CMD`(→ hanjul.ai → 16번 라인) ② 메일 = `curl --ssl-reqd smtps://smtps.hiworks.com:465` · 보내는 계정 `ceo@invitocorp.com` · 받는 사람 `ceo@invitocorp.com` · `suran@invitocorp.com`. 한 길이 실패해도 다른 길은 간다. 각 길의 성공 · 실패를 logger 로 남긴다.
- 메일 계정 파일 = `/etc/bito-ops-alert.env`(`root:administrator` · 640). `backup.sh` 는 administrator 로 돌고 감시는 root 로 돌아서 둘 다 읽어야 한다(감시 설정 `/etc/bito-watchdog.env` 와 따로 둔다).
- 비밀번호 = Harold 가 서버에서 직접 입력(`read -s` 로 받아 파일에 씀 · 채팅 · 저장소 · 명령 출력 0).
- 감시 경보 규칙(사건 = 유닛 + 판정 종류): 첫 감지 1통 · 안 나으면 30분 뒤 1통 · 그 뒤 침묵 · 복구 1통.
  - 보낸 횟수는 **성공했을 때만** 올린다 · 실패 = 5분 뒤 다시 · 시험 모드 = 횟수 · 시도 기록 0(Codex 1R).
  - 보내기 전에 시도 시각을 먼저 저장하고 그 저장이 될 때만 보낸다 · 보낸 뒤 확정 저장이 실패하면 30분 묶음(Codex 1R · 2R).
  - 유닛 사건은 그 유닛이 **정상 판정**일 때만 닫는다 · 알린 사건의 복구 문자는 나갈 때까지 다시(2시간 뒤 포기)(Codex 1R).
- 매일 09:00 요약 1통(제목 고정 「[비토 감시] 매일 요약」) = 어제 KILL · systemd 재시작 · 경보 건수 · 판정 문구별 매칭 수(문구 고정 확인). **안 오면 = 감시 또는 경보 길 이상.**
- `backup.sh` · `monitor-dist.sh` 의 경보도 이 공용 함수로 옮긴다(R14 같은 배포).

### 5-C. .65 alert-worker 메일 직접 발송 (bito-gateway)

- 지금 메일 = `ALERT_EMAIL_WEBHOOK_URL` 웹훅에 넘김(`alert-worker.js:291-308`) → 받는 곳이 없음 · 한줄로(.62)로 걸면 .62 다운 때 같이 죽는다.
- 처방 = `deliverPayload` 의 메일 갈래에 SMTP 직접 발송을 넣는다(`curl` 실행 · 새 의존성 0 · 시간 상한 10초 유지). 웹훅 설정이 있으면 종전대로. 메일 계정 = .65 관리 API 환경 파일에 Harold 가 직접 입력(같은 `read -s` 방식) · .65 `curl` 존재는 구현 전 실측.
- 운영 설정(관리 화면 · DB 행): 채널 이메일 = ceo@ · suran@ · 규칙 3 「Agent 접속 끊김」 `notify_method = email`. 규칙 1 · 2 · 4~8 도 같은 뿌리(전부 dashboard) → 어떤 규칙을 메일로 올릴지 = Harold 판단 항목(§8).
- 이 길이 **.62 통째 멈춤 · 감시 동반 사망**을 잡는다(.62 밖 · SMSQ 밖).

### 5-D. 문구 고정 시험

- bito-gateway: 감시가 찾는 문구 4개(「GW 연결 성공」 · 「GW 연결 실패, 재시도 대기」 · 「GW 연결 끊김 감지」 · 계약 불충족 Error · `Poller 상태`)가 `cmd/agent/main.go` · `poller.go` 에 그대로 있는지 시험. 바뀌면 실패 → 감시 문구도 같이 고치게 강제.
- targetup: 감시 소스의 문구 상수가 위 목록과 같은지 시험.

## 6. 영향표

| 소비처 | 영향 | 처리 |
|---|---|---|
| 유닛 4개(systemd) | 감시가 KILL 을 보냄(active 모드에서만) | dry-run 하루 뒤 전환 |
| `/etc/cron.d/bito-agent-watchdog`(임시) | 대체 | 전환 블록에서 제거 · `ls /etc/cron.d` 확인 |
| `scripts/backup.sh` 경보 | 공용 경보로 | 문자 + 메일 · 실수신 1건 |
| `scripts/monitor-dist.sh` 경보 | 공용 경보로 | 같음 · 실행 비트 · 전례(Permission denied) 확인 |
| `alert-worker.js` `deliverPayload` · `deliverCustomerEmail` | 메일 갈래에 SMTP 추가 | 고객 메일(`deliverCustomerEmail`)은 이번에 안 바꿈(범위 밖 · 기록만) |
| `AlertSettingsPage.jsx:228` 안내 문구 | 「웹훅 있어야」가 틀린 말이 됨 | 문구 정정 |
| backend 빌드(`build:safe`) | `dist/ops/` 가 생김 | 빌드 실패 시 옛 dist 유지(safe-build) |
| 발송 파이프라인 · 정산 | 없음(읽기 · KILL 만) | — |

## 7. 시험 · 전환 순서 (= 「완벽」의 증명)

1. 판정 순수 함수 단위 시험(vitest): 표의 판정 9종 · 유예 · 3개 동시 · 상한 · 실패하면 닫힘 · 경보 규칙(1통 · 30분 · 복구).
2. 문구 고정 시험(§5-D) · R14 계약 시험.
3. 배포 → dry-run 하루: 회차마다 판정 · 「시각 지난 status 100」 건수(2단계 임계용) 기록. 오탐 0 확인.
4. 메일 · 문자 실수신 1건(감시 · backup · alert-worker 각 1).
5. 가짜 고장 5종(시험 번호만 적재한 상태에서): ① `kill -STOP`(동결) ② GW 차단(재시작 안 하고 경보만) ③ 계약 불충족 흉내(경보만) ④ timer 끄기(매일 요약 · OnFailure) ⑤ .65 중지(.62 메일 경보 · SMS 실패 기록).
6. KILL 시험 뒤 중복 · 유실 DB 확인(SQL 은 시험 전에 미리 적는다 · `state_journal.go:128-134` fsync 안 기다리는 점유가 대상).
7. active 전환 = 한 블록(cron 제거 · `systemctl enable --now bito-agent-watchdog.timer` · `list-timers` · `ls /etc/cron.d`).

## 8. Harold 판단 항목

1. .65 규칙 중 메일로 올릴 것 — 추천 = 3 「Agent 접속 끊김」 · 7 「최근 대량 실패」 · 8 「서비스 차단 상태」(발송이 멈추는 것만) · 1 잔액 · 2 성공률 · 4~6 한도는 화면 유지.
2. 매일 요약 시각 — 추천 = 09:00.

## 9. 2단계 (이번 아님)

- 에이전트 `sd_notify WATCHDOG`(폴링 루프 안 · 연결 루프 포함) — memtest 뒤에도 동결이 재발하고 3분이 길다고 판단될 때.
- DB 적체 경보 — dry-run 분포로 임계를 정한 뒤.
- 감시의 감시(.62 감시 생존을 .65 가 보기) — 매일 요약 + OnFailure 로 부족하다고 확인될 때.

## 10. 알고 둔 한계

- 감시 자체가 통째로 죽으면 알릴 주체가 없다 → 매일 요약이 안 오는 것으로 안다.
- .62 메모리 손상이 감시 프로세스도 깰 수 있다 → .65 메일 길(§5-C)이 마지막 그물.
- dry-run 하루 동안은 임시 cron 이 남아 .65 장애 때 5분마다 헛재시작한다(해롭지 않음 · 재연결 루프로 돌아갈 뿐).

## 11. 배포 절차 (Codex approve 뒤 · 명령은 한 단계씩 결과를 보고 다음)

| # | 어디서 | 무엇 | 통과 기준 |
|---|---|---|---|
| 0 | 노트북 | 한줄로 · 게이트웨이 커밋 + 푸시(Harold) | — |
| 1 | .62 root | 사전 확인: systemd 버전 · node · flock · logger · curl · base64 · timeout 경로 | systemd 248 이상(`--timestamp=unix`) · `/usr/bin/node` 존재(다르면 유닛 ExecStart 를 그 경로로) |
| 2 | .62 root | 배포된 에이전트 바이너리에 감시 문구 8개가 있는지(`grep -a`) | 4개 유닛 모두 8/8 |
| 3 | .62 administrator | `git pull`(빌드 · 재기동 없음 — 이번 변경은 스크립트뿐) | 감시 파일 생김 |
| 4 | .62 root | 설치: `/usr/local/bin/ops-alert` · `/opt/bito-watchdog/` · systemd 유닛 3개 | `ls -l` |
| 5 | .62 root | 메일 계정 파일 `/etc/bito-ops-alert.env`(Harold 가 `read -s` 로 비밀번호 입력 · root:administrator 640) | 파일 권한 |
| 6 | .62 root | `ops-alert` 시험 1통 | 「문자 성공 alert_http=200」 · 「메일 성공」 · 휴대폰 문자 + ceo@ · suran@ 메일 실수신 |
| 7 | .62 root | 감시 설정(dry-run) · timer 켜기 · 70초 뒤 감시 로그 | 4개 유닛 `judged … 정상` |
| 8 | .62 root | 백업 스크립트 두 개: 서버본과 저장소본 차이 확인 → 저장소본으로 교체 | diff 가 경보 줄 · 주석만 |
| 9 | .62 administrator | `crontab -l` 의 monitor-dist 줄을 `/bin/bash …` 로(실행 비트 없음 · 07-18 부터 Permission denied 로 죽어 있던 것) | 다음 분 `dist-monitor.log` 에 Permission denied 없음 |
| 10 | .65 root | 관리 API 메일 계정(`/etc/bito-admin-api-alert-mail.env` 600 · Harold `read -s`) + drop-in `zz-alert-mail.conf` · daemon-reload · `command -v curl` | curl 존재 |
| 11 | 노트북 → .65 | 게이트웨이 API 2파일 배포(DEPLOY-RUNBOOK §3-1-b · `smtp-mail.js --create` → `alert-worker.js`) | `GW_DEPLOY_OK api` 2개 |
| 12 | 노트북 → .65 | 대시보드 안내 문구 1줄 배포(DEPLOY-RUNBOOK §3-2 · check.sh → build.sh → 업로드 → deploy) | `GW_DEPLOY_OK dashboard` |
| 13 | .65 관리 화면 | 알림 설정 → 채널 이메일 ceo@ · suran@ 저장 → [테스트] → 규칙 3 · 7 · 8 알림 채널 = 이메일 | 테스트 메일 실수신 · 전송 이력 `sent` |
| 14 | 다음 날 | dry-run 하루 로그 확인(오탐 0) → 가짜 고장 5종(§7) → active 전환 블록(cron 제거 · `MODE=active` · `list-timers` · `ls /etc/cron.d`) | §7 |

- 되돌리기 = `systemctl disable --now bito-agent-watchdog.timer` · 백업 스크립트는 `/home/administrator/backups/*.bak-20261025` 로 복원 · 게이트웨이는 `deploy.sh` 자동 백업(`/opt/bito-gateway/deploy-backups/<시각>`).
- 운영기록대장 = 6 · 10 · 13(경보 경로 · 방화벽 무관 · 계정 정보 위치만) 한 줄.
