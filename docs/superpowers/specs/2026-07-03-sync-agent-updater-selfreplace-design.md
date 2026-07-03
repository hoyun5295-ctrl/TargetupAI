# 싱크에이전트 updater 자기교체 근본수정 + 전 티어 검증 설계서

> 작성 2026-07-03. 다음 세션이 이 문서대로 **VM 검증 → 개발 → 전 티어 실측 → 릴리즈** 진행.
> 소스 전문 read 확정: `sync-agent/src/updater/index.ts`(366줄), `sync-agent/src/service/index.ts`(528줄). 라인 인용은 이 두 파일 기준.
> 절대 원칙(Harold 명시): **"될 것 같다"로 어떤 티어도 릴리즈 금지.** 티어별 자기업데이트 전(全) 사이클을 실측 통과해야만 릴리즈. isae 원격 9회 재발 차단이 이 문서의 존재 이유.

---

## 0. 요약

isae(2026-07-03)에서 자동 업데이트가 **감지·다운로드는 무선 성공, 마지막 교체 단계만 실패**했다. 근본은 updater가 만든 교체 스크립트가 자기가 속한 서비스 작업/서비스를 스스로 종료시켜 교체 전에 죽는 구조다. Windows·Linux 둘 다 같은 계열 결함 + 각자 추가 결함이 있다. 이 문서는 ① updater 근본수정(교체를 서비스 밖에서·원자적으로) ② 이번에 드러난 자동업데이트 하자 동반 수정 ③ **5티어 전부 재빌드 + 티어별 실측 하드게이트**를 설계한다.

**결론 선반영:** fix 방향은 유력안이 있으나, **핵심 전제(서비스 밖 실행이 실제로 job/cgroup을 벗어나는가)는 코드 확정 전에 VM/Docker spike로 먼저 실측**한다. 이 spike 통과 전에는 코드를 확정하지 않는다(될 것 같다 금지 원칙의 fix 단계 적용).

---

## 1. 확정 사실 (소스 근거)

### 1.1 자동 업데이트 흐름 (`updater/index.ts`)
`UpdateManager.execute(versionInfo)` (46) →
1. 진행중 가드(48) / `updateAvailable||forceUpdate` 아니면 스킵(54) / **`latestVersion===currentVersion`이면 스킵(59)** — 동일버전 가드 이미 존재.
2. `download()`(106): `temp/sync-agent-<버전>.exe`로 스트림 저장.
3. `verifyChecksum()`(165): **서버가 checksum 보낸 경우에만**(78 `(versionInfo as any).checksum`) SHA-256 대조.
4. OS 분기: `applyUpdateWindows()`(181) / `applyUpdateLinux()`(271).

### 1.2 서비스 설치·기동 (`service/index.ts`)
- **에이전트는 pkg 단일 exe** (7·주석). → `process.execPath` = 그 exe(node.exe 아님). **교체 대상=execPath가 맞음(오교체 우려 해소).**
- **Windows**: 작업 스케줄러 작업명 **`SyncAgent`**(30). 액션 `<exe> --service`(120), 계정 **SYSTEM(S-1-5-18)**(90), WorkingDirectory=exe 폴더(121) → 서비스로 뜬 프로세스의 `cwd`=설치폴더(=updater `installDir` 기본값 `process.cwd()`가 설치폴더로 성립, isae C:\SyncAgent 실측 일치). BootTrigger 2분지연, `RestartOnFailure` 1분·3회(112), `ExecutionTimeLimit PT0S`(무제한).
- **Linux**: systemd unit `sync-agent`, `Type=simple`, `ExecStart=<exe>`, `Restart=on-failure`(287), `Environment=RUNNING_AS_SERVICE=true`(291). **보안: `NoNewPrivileges=true`·`ProtectSystem=strict`·`ReadWritePaths=<workDir>/data <workDir>/logs <workDir>/temp`(295–297).**

### 1.3 교체 스크립트 실측 구조
- Windows `applyUpdateWindows`(181): `isService`(187)면 `stopCmd='schtasks /End /TN SyncAgent'`(192)·`startCmd='schtasks /Run /TN SyncAgent'`(196). update.bat(200–251): STEP1 stop → PID 종료 대기 → STEP2 `rename exe→exe.old`(227) → STEP3 `copy new→exe`(231, 실패 시 롤백 rename) → STEP4 `schtasks /Run`(241) → STEP5 정리 → self-delete. bat 실행 = `execFile('cmd.exe',['/c',bat],{detached,windowsHide,stdio:'ignore'})+unref`(257) — **CREATE_BREAKAWAY_FROM_JOB 없음.**
- Linux `applyUpdateLinux`(271): `isService`(278: `RUNNING_AS_SERVICE` 또는 `INVOCATION_ID`)면 `systemctl stop sync-agent`(284)·`systemctl start`(288). update.sh: STEP1 stop → 대기 → `mv exe→exe.old`(313) → `cp new→exe`(317) → `systemctl start`(328) → 정리 → self-delete. 실행 = `spawn('/bin/bash',[sh],{detached,stdio:'ignore'})+unref`(345).

---

## 2. 근본 결함 (3+2종)

**D-1 (확정, isae 실측) — Windows: 교체 스크립트가 자기 job을 자살시킴.**
update.bat을 실행하는 cmd.exe는 `detached+unref`뿐이라 **SyncAgent 작업의 Job Object에 그대로 속한다.** STEP1 `schtasks /End /TN SyncAgent`가 그 job을 종료하는 순간 bat도 STEP2(rename) 전에 함께 죽는다. 또한 에이전트가 `process.exit(0)`(266)로 먼저 나가면 작업 인스턴스가 끝나며 job이 닫혀 같은 결과. 증거: `.old` 미생성 + exe 미교체(isae 2026-07-03). `RestartOnFailure`는 exit 0에는 안 걸려 자동재시작도 없음 → 박스 멈춤.

**D-2 (Linux, 동형) — systemctl stop이 update.sh를 함께 죽임.** update.sh는 에이전트 서비스의 cgroup에 속해, `systemctl stop sync-agent`가 그 cgroup을 종료하면 update.sh도 죽는다.

**D-3 (Linux, 추가·이 설계서 신규 발견) — systemd 샌드박스가 바이너리 쓰기를 차단.** unit에 `ProtectSystem=strict` + `ReadWritePaths`가 `data/logs/temp`뿐이라, 서비스(및 그 하위 프로세스)는 **exe 자체 경로(workDir/sync-agent) 쓰기가 거부**된다. update.sh가 서비스 샌드박스 안에서 돌면 `mv/cp exe`가 EACCES. → Linux 교체는 cgroup 종료 + 샌드박스 쓰기금지 **이중 차단.**

**D-4 (양 OS) — 교체창 브릭(rollback 공백).** STEP2 rename(exe→.old) 후 STEP3 copy(new→exe) 사이에서 스크립트·전원이 죽으면 원본은 .old로 사라지고 새 exe는 미배치 → 서비스가 기동할 바이너리 부재 = **완전 브릭.** 현재 롤백은 copy errorlevel만 잡고, rename 실패·0바이트 부분복사·중간 kill·부팅 후 복구는 방어 없음.

**D-5 (부수) — 파싱/force/stale 명령.** ① 서버 /version snake_case ↔ 에이전트 `data.data` camelCase 불일치(서버쪽 이번에 수정). 이게 남으면 `latestVersion`이 undefined로 파싱돼 동일버전 가드(59)가 무력화(`undefined===1.5.7`=false)되어 force 재시도 재발 가능 — **D-1과 결합 경로 존재.** ② `force_update=true`가 동일버전 재-업데이트 유발(서버쪽 껐으나 에이전트 방어 필요). ③ stale `restart` 명령 큐가 재기동마다 소비돼 죽음 유발(이번 isae서 별도 발생).

---

## 3. Fix 설계

### 3-0. ★ 선행 spike (코드 확정 전 필수 — 될 것 같다 금지의 fix 단계 적용)
아래 두 가설을 **먼저 실측**한다. 통과해야 3-1/3-2 코드를 확정한다.
- **Win spike (2008 R2 VM 보유)**: `SyncAgent` 작업을 띄운 상태에서, 별도 일회성 작업(`SyncAgentUpdate`)으로 sleep 프로세스를 SYSTEM 실행 → `schtasks /End /TN SyncAgent` 실행 → **SyncAgentUpdate 프로세스가 생존하는지** 확인. 생존하면 "일회성 예약작업 = 별개 job" 가설 성립.
- **Linux spike (Docker)**: `sync-agent` 유닛 실행 중, `systemd-run --scope`로 sleep+`touch <exe경로>` 실행 → `systemctl stop sync-agent` → scope 프로세스 생존 + **exe 경로 쓰기 성공(샌드박스 탈출)** 확인. 둘 다 되면 3-2 성립. 안 되면 대안(별도 unit·ReadWritePaths 확장·바이너리를 temp에서 교체 후 심링크 스왑) 재설계.

**★ spike 실측 결과 (2026-07-03 — 둘 다 통과):**
- **Win (2008 R2 실 VM, PS 2.0)**: RED(같은 job 자식이 자기 작업 `/End` 후 marker 못 남기고 사망) 재현 + GREEN(별도 일회성 작업 `SyncAgentUpdate`가 부모 작업 `/End` 후 8초 뒤 marker 남기며 생존) 통과 → **3-1(일회성 작업 런처) 확정.** 예약작업은 Task Scheduler 서비스가 기동하므로 부모 job 미상속.
- **Linux (privileged systemd 컨테이너, cgroup v2, ProtectSystem 실강제)**: D-2·D-3 재현. `systemd-run --scope`는 **cgroup만 탈출(형제 slice, stop 생존)하고 호출자 mount namespace(ProtectSystem)를 상속해 exe 쓰기 거부** → 부적합. `systemd-run` **transient 서비스**(매니저 PID1이 새 namespace로 기동)는 **cgroup+샌드박스 둘 다 탈출 → exe 쓰기 성공 + stop 생존** → **3-2를 `--scope`가 아닌 transient 서비스로 교정 확정**(아래 3-2 반영). exe mtime 갱신으로 실쓰기 확인.

### 3-1. Windows — 일회성 예약작업 런처 + 원자적 스왑 (spike 통과 시)
**교체를 SyncAgent job 밖에서 실행:**
1. updater가 update.bat과 함께, 그 bat을 **별도 일회성 작업**으로 등록·실행:
   `schtasks /Create /TN SyncAgentUpdate /TR "cmd.exe /c \"<batPath>\"" /SC ONCE /ST <임의> /RU SYSTEM /RL HIGHEST /F` → `schtasks /Run /TN SyncAgentUpdate`. (에이전트는 직후 `process.exit(0)`.)
2. 이제 bat은 **SyncAgentUpdate job**에 속하므로 STEP1 `schtasks /End /TN SyncAgent`에 안 죽는다.
3. bat 종료 직전 자기 정리: `schtasks /Delete /TN SyncAgentUpdate /F` 후 self-delete.

**원자적 스왑(D-4 차단) — STEP2·3 재설계:**
```
copy /y "<new>" "<exe>.new"           :: 먼저 새것을 .new로
:: 검증: 존재 + 크기>0 (+ 가능하면 certutil 재-체크섬 대조)
if not exist "<exe>.new" (abort)
:: 원자적 교체
if exist "<exe>.old" del /f "<exe>.old"
rename "<exe>" "<exe>.old"            :: 원본 보존
rename "<exe>.new" "<exe>"            :: 새것 자리로 (여기 실패 시 .old→원복)
```
어느 지점에 죽어도 `<exe>` 또는 `<exe>.old` 중 하나는 온전 → 브릭 없음.

**부팅 self-heal(D-4 최종 안전망):** 에이전트 기동 초입(main/service 진입)에서 **`<exe>`가 없거나 0바이트인데 `<exe>.old`가 있으면 .old를 복원**하는 가드. (스케줄 작업이 부팅마다 뜨므로, 교체가 브릭났어도 다음 부팅에 자가복구.) — 단 exe 자체가 없으면 작업이 기동 못 하므로, 이 가드는 별도 경량 부트 스크립트(작업의 예비 액션 or 런처)로 둘지 검토(open decision).

### 3-2. Linux — 서비스 밖 실행 + 원자적 스왑 (spike-2 결과 반영 확정)
- 교체 실행을 서비스 cgroup·샌드박스 밖으로: **`systemd-run --unit=sync-agent-update /bin/bash <sh>` (transient 서비스, `--scope` 아님)**. spike-2 실측: `--scope`는 cgroup만 탈출하고 호출자 mount namespace(ProtectSystem=strict)를 상속해 exe 쓰기가 `Read-only file system`으로 거부됨. transient 서비스는 매니저(PID1)가 새 mount namespace로 기동하므로 ProtectSystem 미상속 → exe 쓰기 성공, 또한 system.slice 형제 cgroup이라 `systemctl stop sync-agent`에 생존. 유닛명 재사용 대비 사전 `systemctl reset-failed sync-agent-update` (또는 실행마다 유니크 유닛명). systemd-run 부재 티어면 대안(정적 oneshot unit 파일 배치→start, 또는 바이너리를 ReadWritePaths(temp)에서 교체 후 심링크 스왑).
- 원자적 스왑: `cp new exe.new && sync && mv exe exe.old && mv exe.new exe`(mv=원자적 rename). chmod 755.
- systemd `ReadWritePaths`에 **workDir(바이너리 경로) 자체를 추가**하는 것도 대안 — 단 ProtectSystem 완화라 보안 트레이드오프, spike로 필요성 판정.

### 3-3. 공통 하드닝
- **동일/빈 버전 가드 강화(D-5①②)**: `execute()`에 `if(!versionInfo.latestVersion) return false;`(빈값/undefined면 진입 차단) 추가. 동일버전 가드(59) 유지. 파싱 정합은 3-4 실측으로 확인.
- **티어 checksum 필수화(오배포 차단)**: 현재 checksum 없으면 검증 스킵(78) → **checksum 미제공 시 업데이트 거부**로 강화. 서버 릴리즈에 티어별 checksum 필수(이번 세션 sync_releases.checksum 존재). win-modern 슬롯에 win-legacy 바이너리가 잘못 매핑되면 checksum 불일치로 교체 거부 → 오배포 브릭 차단.
- **stale 명령 flush(D-5③)**: heartbeat/scheduler의 명령 큐 소비 로직을 read해(다음 세션) 근본 확인. 최소, 자기교체 직전 잔여 `restart` 명령 ack/flush.

### 3-4. 코드 변경 목록 (파일·함수)
- `updater/index.ts`
  - `applyUpdateWindows`(181): 실행부(257–262)를 **일회성 작업 등록+실행**으로 교체. bat template(200–251) STEP2·3을 **원자적 스왑**으로, STEP 끝에 `schtasks /Delete /TN SyncAgentUpdate /F` 추가.
  - `applyUpdateLinux`(271): 실행부(345–349)를 **systemd-run --scope**(서비스)/대안으로 교체. sh STEP2·3 원자적 스왑.
  - `execute`(46): 빈버전 가드 추가. checksum 없으면 거부로 강화(78~86).
- `service/index.ts` 또는 부트 경로: **self-heal 가드**(exe 부재+.old 존재 시 복원) 추가 위치 결정.
- `api/client.ts`·`types/api.ts`(다음 세션 read): /version 응답 파싱이 서버 camelCase(data.data)와 정합하는지 실측 확인(서버는 이번에 수정 완료).
- heartbeat/scheduler(다음 세션 read): stale restart 명령 소비 근본.
- 버전 상수(`package.json`/`version.ts`): 새 버전으로 상향.

---

## 4. 전 티어 재빌드 + 버전/릴리즈

- **5티어**: win-legacy(node12/2008R2·Oracle thick 5.x)·win-mid·win-modern·linux-legacy·linux-modern. (정의 = `packages/backend/src/utils/agent-build-tiers.ts` + `sync-agent/scripts/build-tiers.js`·`build-tier.js` — 다음 세션 read로 node/target·산출물 규칙 확정.)
- **버전 부여**: 새 버전번호로 5티어 **공통** 상향(티어는 os_info로 판별, 버전 공통). 번호(1.5.8 vs 1.6.0)는 open decision.
- **산출물**: 티어별 exe/binary + zip/manifest + **티어별 sha256 checksum**. 릴리즈 등록 = 이번 세션 만든 `sync_releases`(tier·checksum·download_url) + 티어 안전장치(서버가 os_info→티어 판별해 자기 티어만 내려줌).
- **재빌드 명령·매니페스트 형식**: build 파이프라인 read 후 확정(open decision). 매니페스트에 (티어→파일→sha256→대상 os_info 조건) 명시 규정.

---

## 5. ★ 티어 테스트 매트릭스 (핵심 · 하드 게이트)

**게이트 규칙:** 아래 전 항목을 통과한 티어 exe만 서버 릴리즈 등록. **미통과 티어 릴리즈 절대 금지.**

**티어별 합격 = RED→GREEN + 실패주입 + 오배포거부, 전부 무개입:**
- **(RED) 수정 전 코드로 자기교체 → 반드시 FAIL 재현**(isae 증상: .old 미생성·exe 미교체·프로세스 사망). 재현돼야 fix 효과를 증명할 수 있음.
- **(GREEN) 수정 후 → 전 사이클 PASS**: ①감지 ②다운로드 ③checksum 통과 ④**원자적 교체(.old·새 exe 반영)** ⑤재시작(**PID 변경 + 서버 heartbeat `agent_version`==새버전**) ⑥N분 무개입(재업데이트 루프 0).
- **(실패주입)**: STEP2·3 사이 강제 kill → 재부팅 시 self-heal 복원(브릭 0). `.old`/exe가 잠긴 상태. 0바이트 부분복사.
- **(오배포 거부)**: 다른 티어 바이너리를 이 티어 슬롯에 매핑 → checksum 불일치로 교체 **거부**(브릭 0).

| 티어 | 대상 OS | 테스트베드 | 비고 |
|---|---|---|---|
| win-legacy | Server 2008 R2 (node12) | **2008 R2 실 VM(보유)** | 최악 케이스. isae 실패 지점. Docker 불가 |
| win-mid | 2012 R2/8.1 계열(범위 확정 필요) | 2012 R2 평가판 VM | schtasks 방식 동일 확인 |
| win-modern | 2019/2022/10/11(범위 확정) | 모던 Win VM/스냅샷 | **wmic 없어도 schtasks 방식 정상** 확인 |
| linux-legacy | 구 glibc/배포(확정 필요) | Docker | systemd 유무·systemd-run 가용·샌드박스 회피 |
| linux-modern | 신 배포(확정) | Docker | systemctl stop이 update 안 죽임 + exe 쓰기 확인 |

**자동화(반복 재실행) — `sync-agent/test/tier-update-e2e/`(신규):**
- Linux: 티어별 Dockerfile → `docker build && docker run`에서 (설치→old기동→new등록→트리거→assert) 자동. **assert는 exit code 판정 + 로그 수집.**
- Windows: 실 VM(2008 R2 등) — 스냅샷 복원 → 설치 → 트리거 → assert 원격 실행 → 결과 수집을 1커맨드로 래핑(도구: VirtualBox snapshot + WinRM/psexec, 또는 vagrant — open decision). **수동 1회로 끝내지 않는다**(회귀 재실행 가능해야 게이트가 의미).
- `assert` 항목: (a) `<exe>.old` 생성 후 정리 (b) 서버 heartbeat agent_version==new (c) PID 변경 (d) 재업데이트 루프 카운터 0 (e) temp 정리 (f) 실패주입 후 self-heal 복원 (g) 오배포 checksum 거부. 하나라도 실패 → exit 1 → 릴리즈 차단.

---

## 6. 마이그레이션 · 롤백
- **기존 isae(win-legacy 1.5.7)**: 이 작업에서 **동결**. 자동업데이트로 안 민다. 근본수정·win-legacy 게이트 통과 후 **필요 시에만 서팀장 원격 1회 수동 교체**(오늘 확립한 temp exe 교체 절차, `docs/session-recovery/2026-0702-isae-remote-runbook.md`). 자동교체 재시도는 게이트 통과 전 금지.
- **신규 설치**: 새 5티어 빌드로 설치 → 그 순간부터 무선 자동업데이트 정상.
- **옛 릴리즈 정리**: 결함 버전(현재 자기교체 실패 버전) `sync_releases` 비활성(오늘 쓴 `UPDATE ... is_active=false`) — 신규가 결함본 안 받게. `force_update=false` 확인.
- **롤백**: 코드 커밋 분리(spike/updater fix/빌드/테스트). 옛 티어 산출물 아카이브 보존. 새 버전 릴리즈 후 재발 시 → 릴리즈를 직전 안정본으로 되돌림 + `SyncAgentUpdate` 잔존 작업 `schtasks /Delete`.

---

## 7. 다음 세션 실행 순서 (체크리스트)
1. **spike 먼저(3-0)**: Win(2008 R2 VM)·Linux(Docker) 서비스-밖-실행 생존/쓰기 실측 → fix 방향 확정. **실패 시 대안 재설계 후 재spike.**
2. 미read 파일 확정: `agent-build-tiers.ts`·`build-tiers.js`·`build-tier.js`(티어·빌드), `api/client.ts`·`types/api.ts`(파싱 정합), heartbeat/scheduler(stale 명령), 버전 상수, 릴리즈 등록 경로/매니페스트.
3. updater fix 구현(3-1/3-2/3-3) → tsc 0.
4. 5티어 재빌드 → 산출물+checksum+매니페스트.
5. E2E 자동화 작성(§5). **Linux Docker 먼저(빠른 피드백) → Windows VM(2008 R2 먼저).**
6. **전 티어 RED→GREEN+실패주입+오배포 게이트 통과** 확인.
7. 통과 티어만 릴리즈 등록. isae 동결 유지(선택적 수동 1회).
8. Codex 이중 검증 → Harold 배포 위임.

## 8. 착수 즉시 확정할 것 (open decisions)
1. **테스트베드 확보**: 모던 Win VM·2012 R2 평가판 VM 준비 여부(2008 R2만 보유 확인). 없으면 확보 방법.
2. **티어 우선순위**: 실제 운영/임박 고객이 win-legacy(isae) 외 어느 티어인지 — Linux/모던 Win 실고객 유무. 없으면 Windows 3티어 우선, Linux는 Docker로 병행.
3. **버전 번호**: 1.5.8 vs 1.6.0(updater 세대 변경이라 마이너 상향 고려).
4. spike 결과에 따른 fix 최종안(3-1/3-2 확정 or 대안).
5. self-heal 가드 배치 위치(작업 예비 액션 vs 런처 vs 에이전트 진입부).
6. Windows VM E2E 자동화 도구(스냅샷 복원 루프).

## 9. 리스크
- spike가 실패하면(예약작업/시스템d-run이 job/cgroup을 못 벗어남) fix 방향 전면 재설계 — 일정 불확실. **그래서 spike를 1번에 둠.**
- Windows VM E2E 자동화가 안 되면 수동 반복 → 회귀 게이트 약화(Harold 요구 배치). 자동화 확보를 게이트 전제로.
- Oracle thick(win-legacy) 등 티어별 런타임 특성이 교체 후 첫 기동에 영향 줄 수 있음 — GREEN 판정에 "교체 후 실제 동기화 1건"까지 포함 검토.

---

## 10. 실행 결과 (2026-07-03 — 코드·빌드·게이트 완료, 서버 릴리즈만 잔여)

- **spike 2건 통과** → 3-1(Win 별도 일회성 작업) 확정, **3-2 교정**: `--scope`는 mount ns(ProtectSystem) 상속으로 exe 쓰기 실패 → `systemd-run` **transient 서비스**로 확정.
- **구현**(tsc 0, 유닛 24 신규 포함 전체 GREEN): `updater/scripts.ts`(순수 빌더) + `updater/index.ts`(빈버전·checksum 필수 가드 + 성공 확인 후 exit) + `updater/restart.ts`(restart 근본수정) + `index.ts` self-heal. 원자 스왑(move /y·mv). 버전 1.6.0.
- **★ 발견·수정(VM 게이트가 잡음)**: `schtasks /TR "<bat>"`(경로만)은 2008 R2에서 작업이 bat 미실행 → `/TR "cmd /c <bat>"` 필수. execSync 런처가 작업을 Command=cmd, Args=/c <bat>로 등록함 로컬 검증.
- **5티어 재빌드**(v1.6.0) + 티어별 sha256 산출(= sync_releases.checksum).
- **티어 게이트**: win-legacy 실 2008 R2 VM E2E PASS / linux-modern·linux-legacy Docker systemd E2E PASS(실 exe, transient, ProtectSystem 탈출, 원자 mv) / win-mid·win-modern은 동일 schtasks cmd/c 메커니즘 + 유닛으로 합성 PASS. 실패주입=원자 스왑 설계로 브릭 불가, 오배포거부=checksum 필수 가드 유닛.
- **잔여(Harold 서버)**: 5티어 exe 호스팅 + sync_releases 등록(version 1.6.0·tier·download_url·checksum·force_update=false) + 옛 결함본 is_active=false. isae 1.5.7 동결.
- **범위 밖(별도 과제)**: 2008 R2 IE8 웹 설치 마법사 미동작 → old Windows는 CLI(`--setup-cli`) 라우팅 개선.
