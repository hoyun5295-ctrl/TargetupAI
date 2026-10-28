# 실 PG 시험층 · 배포 원장 설계서 (2026-10-27)

> 호출어 **"실 PG 시험층 / 배포 원장 / 개발 루프"**. 이 문서가 결정(D1~D6) · 구조 · 영향표 · 시험 · 구현 순서 · 진행표를 소유한다.
> 출발 = 1027 브레인스토밍 1회(Harold 발동 · 기획 · 백엔드 · 회의론자 · 1차 의견 → 교차 토론 1라운드 → 회의론자 최종 검증 P1~P17 · 요지 §10).
> 승인 = Harold 1027 「수렴안과 추천 1~4대로 설계서 작성 시작해」.
> 상태 = 설계 닫힘(Codex 적대 5R approve) · Harold 승인(D5 · D6 포함 · 1027) · 구현 완료 · Codex 적대 구현 리뷰 3R approve(1027) · 다음 = Harold 그릇 명령 1 → 「배포 시작하자」 때 첫 덤프 3명령 → 첫 판 실 PG 실행 · 변이 M1~M4 → pg-mem 판 삭제.

## §0 원래 안건 · 범위

- **원래 안건(첫 줄 고정)**: 「세 제안이 대표(Harold)와 AI 가 함께 일하는 효율을 올리는가, 또 하나의 방해 요소가 되는가, 그리고 발전적으로 하는 방법은 무엇인가」. 제안 1 = 실제 PostgreSQL 시험층 · 제안 2 = 배포 대기 원장 · 제안 3(규칙 통폐합) = 0814 재개 금지 · 다시 열지 않는다.
- **답(회의 결론)**: 두 제안 모두 형태가 가른다. Harold 손을 매번 부르면 방해 · 한 번 정한 뒤 장치가 돌면 효율. 발전적 방법 = 규칙 문장을 늘리지 않고 장치(시험 · git 계산 · 시험이 찍는 보고 줄)에 싣는다(0814 진단 「사고 → 룰 추가만 · 졸업 없음」의 반대 방향).
- **공통 조건**:
  - 새 규칙 줄은 세어서 적는다. 이 설계 = **3줄**(CLAUDE.md 2 · 메모리 1 · §1 D1 · D2 · D4). 그 밖의 금지 · 의무는 문장이 아니라 장치에 둔다(§2-8 보고 줄 · §2-9 스탬프 · §3-7 표시 규칙은 원장 머리에).
  - 각 제안은 지금 있는 손일을 지운다(§6 표). 못 지우면 채택하지 않는다.
- **범위** = 시험층 기반(그릇 · 실행 경로 · 안전문 · 덤프 적재 · 원장 DDL 얹기 · 보고 줄 · 스탬프) + 첫 판 1파일 + 원장 파일 + 배선(OPS · STATUS · 메모리 포인터) + 규칙 3줄 + 낡은 「배포 대기」 표시 1회 정정.
- **운영 코드 변경 = 0**(`src/` 의 운영 파일을 바꾸지 않는다 · 시험 · 설정 · 문서만).
- **범위 밖(기록 · 착수 = Harold)** = §9.

## §1 결정

| # | 결정 | 상태 |
|---|---|---|
| D1 | **그릇 = Harold 가 1회 띄우는 `tu-pgtest` 하나 · AI 는 컨테이너를 만들거나 끄지 않는다.** 허가 = 「tu-pgtest 안 `t_` 로 시작하는 DB 의 생성 · 그 안 읽기쓰기 · 삭제 · 그 밖 0」. 메모리 `feedback_never_operate_harolds_machine_without_approval` 에 예외 한 줄(§5-2 원문). | Harold 승인 1027(추천 1) |
| D2 | **컬럼 확인 해석**: 운영과 정의 해시가 같다고 마지막으로 대조된 덤프에, 그 뒤 닫힌 DDL(원장 §2)을 모두 얹은 시험 DB(`t_tpl_closed`)가 있으면 그 DB 의 information_schema 조회를 CLAUDE.md `db_column_verify_before_code` ①의 확인으로 친다. 대조 기록이 없거나 다르면 원래대로 Harold 님께 검증 SQL. 분포 · 행 수는 언제나 Harold 님 실행. CLAUDE.md 한 줄(§5-2 원문). | Harold 승인 1027(추천 2) |
| D3 | **C71 과의 순서**: C71 은 이 층 때문에 밀리지 않는다. 첫 판이 C71 배포 창 전에 준비돼 있으면 같은 창 안에서 「C71 사전 실측 → 첫 덤프 → 첫 판 실행 → C71 코드」. 첫 판이 실패하면 그 결함을 고친 뒤 C71 을 배포한다(C71 = 묶음 0 · A 한 커밋 · pull 이 전부 당기므로 일부만 배포할 수 없다). 준비 전이면 C71 먼저 · 덤프는 그 창에서 받는다. | Harold 승인 1027(추천 3) |
| D4 | **읽기 전용 git 세 명령 허용**: `git log` · `git merge-base` · `git --no-optional-locks status`(색인 갱신 쓰기를 막는 꼴). 그 밖의 git(add · commit · push · pull · fetch · checkout · reset · stash 등)은 그대로 금지. CLAUDE.md `no_system_modification` 한 줄(§5-2 원문). | Harold 승인 1027(추천 4) |
| D5 | **백업 갈음 원칙**(회의론자 P12 · 새): 원장 DDL · DML 항목마다 「백업 = 명령 또는 갈음 근거」 칸. 추천 = 칸 추가 · 색인 추가 · 제약 완화 = 정기 백업으로 갈음(OPS.md 정기 pg_dump) / 값을 바꾸는 DML · 칸 삭제 · 형 변경 · 제약 강화 = 그 표 `pg_dump -t` 명령. | **Harold 확인 필요(설계 검토 때)** |
| D6 | **설계가 더한 것 · 스탬프 계약**(새 · 요구를 닫으려면 필요한 이유 한 줄 = pg-mem 판을 지우면 push 전 시험이 선점 문장을 더는 보지 않아 실 PG 시험층이 「안 불리는 검사」가 된다 · 메모리 `feedback_dead_check_is_worse_than_no_check`): test:pg 가 통과할 때 「그 시험이 부르는 CT 파일의 해시」를 PC 에 적고, 짝 pg-mem 판이 지워진 뒤부터 기본 시험의 계약 하나가 지금 해시와 다르면 실패(§2-9). | 설계 검토 때 Harold 확인 |

## §2 제안 1 · 실 PG 시험층

### 2-1 그릇(D1)

- Harold 1회 명령(이 PC · PowerShell · 구현 때 그 한 줄만 드린다):
  `docker run -d --name tu-pgtest --restart unless-stopped --memory 1g --cpus 2 -e POSTGRES_PASSWORD=tu_pgtest_local -e TZ=Etc/UTC -p 127.0.0.1:56415:5432 --tmpfs /var/lib/postgresql/data:rw,size=512m postgres:15.15 -c shared_buffers=64MB -c fsync=off -c synchronous_commit=off -c full_page_writes=off`
- 근거 · 꼴:
  - 판 = 운영 PostgreSQL **15.15**(`docs/2026-09-25-hanjul-source-audit.md:724` · Harold 0926 실측). 이미지 = Debian 판(태그 `15.15` 기본). 운영 컨테이너의 이미지 계열(Debian · alpine)은 기록이 없다 → 머리 SELECT 로 받은 운영 `datcollate` 와 그릇의 값이 다르면 test:pg 가 멈춘다(§2-5 검사 4).
  - `127.0.0.1` 만 받는다(CLAUDE.md 개발 안전 · 0.0.0.0 금지). 포트 56415 = 1027 이 PC 수신 포트 조회에서 비어 있음(55432 대역은 bito-scratch-pg · 옛 gw-prepaid-verify 가 썼다 · 피한다). 구현 때 다시 조회한다.
  - 암호 `tu_pgtest_local` = 이 그릇 전용 시험 값(밖에서 닿지 않음 · 운영 값과 무관). `vitest.pg.config.ts` 머리 한 곳에 둔다.
  - 데이터 = tmpfs(RAM · 512MB 상한). Docker 가 다시 켜지면 그릇이 비어서 뜬다 → test:pg 가 덤프에서 다시 만든다(Harold 일 0).
  - 노트북 부담 상한(회의론자 P3 · 메모리 `feedback_heavy_local_runs_slow_harolds_laptop`: 32GB 중 남은 기억 1~4GB): `--memory 1g` · `--cpus 2` · `shared_buffers=64MB` · 쓰기 동기화 끔(시험 전용 · 잃어도 되는 데이터).
  - Docker Desktop 자동 시작 = 켜짐(1027 회의론자 읽기 조회 · `settings-store.json AutoStart = True`).
- 그릇이 없거나 멈춰 있으면: test:pg 가 첫 줄에서 실패하고 Harold 님이 칠 한 줄 `docker start tu-pgtest` 를 출력한다. **AI 는 기동하지 않는다.**
- 포트 · 이름 · 암호 · 기동 명령의 소유 = `scripts/test-pg-env.mjs` 머리 한 곳(실행기 · 안전문 · 관리 연결이 같은 값을 import · SERVERS.md 는 서버 문서라 등재하지 않는다 · 회의론자 P16).

### 2-2 실행 경로

- `packages/backend/package.json` scripts: `"test:pg": "node scripts/test-pg.mjs"`.
- **실행기 `scripts/test-pg.mjs`(새 · 환경 · cwd · 우선순위의 유일한 주인 · Codex R1 #1 · #3)**: vitest 를 자식 프로세스로 띄운다(셸 없이). 경로는 전부 **실행기 파일 위치 기준 절대경로**로 만든다(Codex R2 #1 · 자식 cwd = src 라 상대경로는 엉뚱한 곳을 가리킨다): `BE = resolve(dirname(fileURLToPath(import.meta.url)), '..')` → argv = `process.execPath`, `join(BE, 'node_modules/vitest/vitest.mjs')`, `run`, `--config`, `join(BE, 'vitest.pg.config.ts')` · cwd = `join(BE, 'src')`. 실행 전에 두 파일이 있는지 보고 없으면 그 경로를 찍고 멈춘다.
  - **env = 허용 목록으로 새로 만든다**(부모 셸 env 를 물려주지 않는다): OS 가 돌리는 데 필요한 이름(`PATH` · `PATHEXT` · `SystemRoot` · `SystemDrive` · `ComSpec` · `windir` · `TEMP` · `TMP` · `LOCALAPPDATA` · `APPDATA` · `USERPROFILE` · `HOMEDRIVE` · `HOMEPATH` · `OS` · `NUMBER_OF_PROCESSORS` · `PROCESSOR_ARCHITECTURE`) + 시험 값(§2-3 표). 부모 셸에 있는 운영 키 · 토큰은 시험 프로세스에 하나도 안 간다. 주 프로세스(globalSetup)와 작업자가 같은 env 를 처음부터 가진다(Vitest `test.env` 는 globalSetup 주 프로세스에 적용되지 않는다 · Codex R1 #3 · 그래서 쓰지 않는다).
  - **cwd = `src`**: `config/database.ts:9` 와 `app.ts:3` 의 `dotenv.config()` 는 `process.cwd()/.env` 를 읽는다. `src` 에는 `.env` 가 없으므로 운영 접속 값이 들어올 길이 없다(회의론자 P4 · 백엔드 위험 6).
  - **우선순위**: 자식을 띄운 직후 `os.setPriority(child.pid, os.constants.priority.PRIORITY_LOW)`(작업자는 자식의 자식이라 물려받는지 구현 때 확인 · 안 물려받으면 작업자 setupFiles 첫 줄에서 자기 pid 에 한 번 더).
  - 종료 코드는 vitest 의 것을 그대로 돌려준다.
- `vitest.pg.config.ts`(새 · packages/backend): `root` = packages/backend(실행기 cwd = src 라 따로 둔다) · `envDir: false`(vite 가 root 의 `.env` 파일을 읽지 않게) · `include: ['src/**/*.pg.test.ts']` · `maxWorkers: 2` · `globalSetup` · `setupFiles` · 보고 reporter(§2-8). `env` 는 두지 않는다(실행기가 소유).
  - vitest 4.1.12 의 설정 키 이름(`maxWorkers` 등)은 구현 때 그 판 문서로 확정한다.
  - `npx vitest --config vitest.pg.config.ts` 처럼 실행기를 건너뛰고 부르면 안전문 조건 1 · 4 에서 멈춘다(§2-3).
- `vitest.config.ts`(기본) · 글로브 한 곳 = `vitest.globs.ts`(`UNIT_INCLUDE` · `UNIT_EXCLUDE` · 스탬프 계약이 같은 값을 import): `exclude: [...configDefaults.exclude, 'src/**/*.pg.test.ts']`(기본 include `src/**/*.test.ts` 가 `.pg.test.ts` 를 잡기 때문 · 회의론자 (마) · `exclude` 를 두면 기본 제외 목록을 덮으므로 `configDefaults` 를 펼친다). **기본 `npm test` · pre-push 의 동작은 그 밖에 바뀌지 않는다.**

### 2-3 안전문(fail-closed)

`src/utils/__tests__/pg/pg-test-gate.ts` 의 순수 함수 `assertPgTestEnv(env, cwd)` 하나. globalSetup(주 프로세스)과 setupFiles(작업자마다) 첫 줄에서 부른다. 하나라도 어기면 throw(이유 한 줄).

1. `cwd` 에 `.env` 로 시작하는 파일이 없다(`.env.local` · `.env.test` 포함).
2. `DATABASE_URL` = `postgres://postgres:tu_pgtest_local@127.0.0.1:56415/<db>` 꼴이고 host = `127.0.0.1` · port = `56415` · db 이름 = `t_` 로 시작(작업자) 또는 관리 연결 전용 `postgres`(§2-4 함수 안에서만).
3. 다른 접속 env 는 닿지 않는 시험 값이다: `MYSQL_HOST=127.0.0.1` · `MYSQL_PORT=9` · `MYSQL_PASSWORD=tu_pgtest_local`(database.ts 의 빈 값 차단은 VITEST 에서 건너뛰지만 값을 둔다) · `REDIS_URL=redis://127.0.0.1:9` · `DB_POOL_MAX=5` · `TU_PG_RUN=1`(실행기를 지났다는 표식). 이 값들의 주인 = 실행기(§2-2).
4. **env 이름 전체 ⊆ 허용 목록**(OS 이름 · 시험 이름 · 러너가 스스로 넣는 이름 = 1027 실측 고정: vitest 4.1.12 `VITEST` · `VITEST_*` · `TEST` · `NODE_ENV` · `FORCE_TTY`(작업자) · vite 8.3.5 `BASE_URL` · `DEV` · `PROD` · `MODE` · `SSR` · `VITE_USER_NODE_ENV` · Windows 가 자식에 넣는 `USERNAME` · `USERDOMAIN` · `LOGONSERVER` · `FORCE_COLOR` · `VITE_` 접두를 통째로 열지 않는다). 목록 밖 이름이 하나라도 있으면 멈춘다(부모 셸 키 상속 · 실행기 우회를 함께 잡는다 · Codex R1 #1 · 메모리 `feedback_allowlist_beats_blocklist_for_untrusted_text`).

- 회귀 주입(믿기 전에 실패를 본다 · 백엔드 1-A): 기본 시험에 `pg-test-gate.test.ts`(DB 없음) = 조건 1~4 를 하나씩 어긴 env 마다 throw(예: `OPENAI_API_KEY` 하나 더함 · `TU_PG_RUN` 없음 · host `localhost` · db `targetup`) · 다 지키면 통과.
- ponytail: 밖으로 나가는 HTTP 자체는 막지 않는다. 키 · 토큰이 프로세스에 하나도 없으므로(조건 4) 인증된 외부 호출은 성립하지 않는다. 시험이 외부 모듈을 부르면 그 시험이 mock 한다(첫 판 = provider · system-alert mock).

### 2-4 관리 연결

`pg/admin.ts` 의 `adminExec(sql)` 하나만 `postgres` DB 에 붙는다. 받는 문장은 정규식 허용 목록 하나:
`^(CREATE DATABASE t_[a-z0-9_]+( TEMPLATE t_tpl(_closed|_after)?)?|DROP DATABASE IF EXISTS t_[a-z0-9_]+( WITH \(FORCE\))?|COMMENT ON DATABASE t_tpl(_closed|_after)? IS '[0-9a-f]{64}')$`(이름은 소문자 · 숫자 · 밑줄뿐이라 따옴표를 받지 않는다) · 그 밖 = throw(회의론자 P2). 그 밖의 읽기(판 · 정렬 확인 · t_ DB 목록)는 `SELECT` 두 문장만 별도 허용(`SHOW server_version` · `SELECT datname, datcollate FROM pg_database WHERE datname LIKE 't\_%' OR datname = 'postgres'`).

### 2-5 표 · 덤프

- **원천** = 운영 schema-only 덤프 하나(`pg_dump --schema-only --no-owner --no-privileges` · 데이터 0).
- **자리** = 저장소 밖 `%USERPROFILE%\.hanjul-pgtest\schema.sql`(회의론자 A 고친 꼴 · ★1028 B-1028-4 에서 옮김 · 아래 줄). 운영 구조 전체가 git 에 들어가지 않고(보안 무관용) · `git add -f` · 무시 예외 추가로 딸려 갈 길도 없다. 개발 기계 = 이 노트북 하나(CLAUDE.md worktree 금지).
  - ★1028 실측: Claude 앱(MSIX 꾸러미)이 `%LOCALAPPDATA%` 에 쓰는 파일은 Windows 가 꾸러미 폴더로 돌린다 → 이 자리의 실제 폴더 = `C:\Users\ceo\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\hanjul-pgtest\`. AI 쪽 프로세스(test:pg 포함)에는 `%LOCALAPPDATA%\hanjul-pgtest` 로 보이고 Harold 님 PowerShell 에는 보이지 않는다. **받는 꼴 ③ scp 의 받는 자리는 이 실제 폴더로 적는다**(1028 첫 scp 가 「No such file or directory」로 실패한 원인).
  - ★1028 B-1028-4 처방: 같은 이유로 통과 스탬프도 앱 밖 pre-push 시험이 못 읽었다(push 막힘) → 자리 = `%USERPROFILE%\.hanjul-pgtest`(AppData 밖은 돌려지지 않아 앱 안 · 밖이 같은 파일 · `pg/dump.ts` `pgTestDir` · 시험 `pg-dump-loader.test.ts`). 위 꾸러미 폴더 이야기는 옛 자리의 기록이다. scp 받는 자리 = `$env:USERPROFILE\.hanjul-pgtest\`.
- **받는 꼴 = 3명령**(회의론자 P7 · 「배포 시작하자」 때 하나씩 · 지금 서버 명령 안 줌 · 메모리 `feedback_hold_server_commands_until_deploy_go`): ① 서버 root 셸(docker DB 명령 = root · LESSONS_DEPLOY 1003)에서 `docker exec -i`(tty 없이)로 덤프를 **서버 파일**로 뜬다 ② 같은 셸에서 머리 SELECT 한 번(`SCHEMA_META_SQL` · §2-6 · 출력을 AI 가 `schema.meta.json` 에 옮긴다) ③ 노트북 PowerShell 에서 `scp` 한 줄로 받는다(출장 중이면 Tailscale 주소). 붙여넣기 · `ssh … >` 리다이렉트 금지(인코딩 · 잘림 · LESSONS_DEPLOY 0816).
- **싣기 전 검사**(test:pg globalSetup · 하나라도 어기면 실패):
  1. 머리에 `Dumped from database version 15.15` 가 있다(판이 다르면 그릇 판도 바꿔야 한다는 문장으로 실패).
  2. 끝에 `-- PostgreSQL database dump complete` 표식이 있다(잘린 파일).
  3. `\` 로 시작하는 줄은 `\restrict ` · `\unrestrict ` 둘만 허용하고 적재 전에 뺀다(15.14 이후 pg_dump 가 넣는 psql 전용 줄 · node-pg 는 실행 못 함 · 실제 덤프에 있는지는 첫 덤프에서 확인 · 미검증). 그 밖의 `\` 줄 = 실패.
  4. `schema.meta.json` 이 있고 그 `datcollate` · `TimeZone` 이 그릇의 값과 같다(schema-only 덤프에는 DB 정렬 · 시간대가 안 든다 · 그래서 머리 SELECT 를 따로 받는다).
- **덤프 머리 다섯 칸**(백엔드 1-A): `server_version` · `datcollate` · `TimeZone` · 뜬 시각 · 정의 해시(§2-6). 덤프 파일 옆 `schema.meta.json` 에 둔다(받는 꼴 ② 의 출력). 적재한 `t_tpl` 의 정의 해시가 이 값과 같으면 그 자리에서 「마지막 해시 대조 = 같음」(복원이 운영과 같다는 증거 · D2 가 이때부터 선다) · 다르면 test:pg 실패(복원 차이 · 확장 · 판).
- **template 셋**:
  - `t_tpl` = 덤프 그대로. 덤프 파일 sha256 을 `COMMENT ON DATABASE t_tpl` 에 적고 다르면 지우고 다시 만든다.
  - `t_tpl_closed` = `t_tpl` + 원장 §2(덤프 뒤 적용분) 블록을 위에서부터 차례로. 시험 기본 template · D2 의 조회 대상 · 정의 해시 대조 대상.
  - `t_tpl_after` = `t_tpl_closed` + 원장 §1(대기)의 `ddl:` 블록을 원장 순서대로 **한 번씩**(블록 하나 = simple query 한 번 · 여러 문장이면 한 암묵 트랜잭션 · `CONCURRENTLY` 가 든 블록은 그 문장 하나만 들어야 한다 = 아니면 실패). 두 번 실행(멱등) 요구는 두지 않는다(Codex R1 #4 · 운영에서 같은 ADD COLUMN 이 다시 돌면 42701 로 멈출 뿐 바뀌는 것이 없다 · C71 DDL 원문을 바꾸지 않는다). `dml:` 블록은 `t_tpl_after` 사본에서 `BEGIN … ROLLBACK` 안에 한 번(행 0 · 문법과 칸만 확인 · `CONCURRENTLY` 는 dml 에 올 수 없다). 실패하면 블록 id 와 PG 오류 코드로 test:pg 실패.
  - 세 template 은 원천(덤프 sha256 + 블록 글자 sha256)이 같으면 다시 만들지 않는다(COMMENT 에 그 해시).
- **시작할 때 청소**: 세 template 밖의 `t_` DB 를 전부 지운다(죽은 실행의 찌꺼기 · 회의론자 P3).

### 2-6 정의 해시 상수(회의론자 P5)

- `pg/schema-fingerprint.ts` 의 상수 `SCHEMA_FINGERPRINT_SQL` 하나 = public 스키마의 칸(표 · 칸 · 형 · 기본값 · NULL 허용) · 제약(`pg_get_constraintdef`) · 색인(`pg_indexes.indexdef`)을 이름 순으로 이어 붙인 md5 한 값. 위치 번호(ordinal)는 넣지 않는다. 같은 파일의 `SCHEMA_META_SQL` = `server_version` · `datcollate` · `TimeZone` · `now()` · 그 해시를 한 행으로(받는 꼴 ②).
- 운영과 로컬이 **같은 글자**를 돈다: 원장 DDL 항목의 「확인 한 줄」을 낼 때 AI 가 이 상수를 글자 그대로 옮긴다(그 칸 존재 조회 + 이 해시를 한 SELECT 로 · 한 대상 = 표 정의 조회이므로 「서로 무관한 확인 묶기」가 아니다 · 회의론자 D 판정). 따로 명령을 늘리지 않는다.
- 비교 대상 = **`t_tpl_closed`**(그 창에서 닫힌 DDL 을 §2 로 옮긴 뒤 다시 만든 것). `t_tpl_after` 와 비교하지 않는다(대기 DDL 이 둘 이상이면 매번 다르게 나온다 · P5).
- ★1028 첫 덤프 실측 = 덤프 왕복이 식 표기 하나를 바꾼다: varchar 칸 IN 목록의 CHECK · 부분 색인 정의(운영 `= ANY ((ARRAY['a'::character varying, …])::text[])` · 복원 `= ANY (ARRAY[('a'::character varying)::text, …])` · 5,167줄 중 94줄 · 그 밖 차이 0). 그래서 상수는 식 칸 셋(기본값 · 제약 · 색인 정의)에서 이 두 표기를 한 꼴로 맞춘 뒤 센다(문자열 상수 · 따옴표 이름은 통째로 건너뜀 · Codex R2 · R3). 다른 꼴의 표기 차이가 새로 나오면 해시가 달라 test:pg 가 멈춘다 → 그때 운영 줄 전체를 파일로 받아 줄 대조(1028 의 진단 꼴: 서버 파일 → scp → 복원본 줄과 diff).
- 같으면 원장 머리 「마지막 해시 대조 = 날짜 · 같음」. 다르면(원장 밖 ALTER) 그 창에서 덤프 3명령(§2-5 받는 꼴)을 다시 하고, 원장 §2 블록을 각 설계서로 옮기고 §2 를 비운다.

### 2-7 시험 파일 수명 · 첫 판

- **수명**: setupFiles 가 시험 파일마다 `t_f_<작업자>_<무작위>` 를 `t_tpl_closed` 에서 만들고 `DATABASE_URL` 을 그 DB 로 둔 뒤 시험 파일이 import 된다(`config/database.ts` 의 Pool 이 import 때 env 를 읽기 때문 · 백엔드 「백엔드 코드 변경 0」). 끝나면 `pool.end()` → `DROP DATABASE … WITH (FORCE)`. 두 작업자가 같은 template 에서 동시에 만들다 55006(사용 중)이 나면 짧게 다시 시도한다(동시 복사 동작은 구현 때 확인 · 미검증). globalSetup 은 template 연결을 다 닫은 뒤 끝난다.
- **대상 기준**(백엔드 ②): 시험의 주장이 PG 의미론에 기대는가 = 잠금 · 동시성(`FOR UPDATE [SKIP LOCKED]` · advisory lock · CAS 0행) / 충돌 · 제약(`ON CONFLICT … RETURNING` · UNIQUE · CHECK · DEFAULT · FK) / 타입 추론 · 드라이버(같은 `$n` 두 문맥 42P08 · `name[]` · timestamp 파서) / pg-mem 이 못 읽는 문법(jsonb 연산 · `'-infinity'` · 상관 하위 조회 · `make_interval`). 순수 판정 함수 · mock 으로 분기만 보는 라우트 · 소스 계약 · 성능(빈 DB 는 실행 계획이 다르다)은 대상이 아니다.
- **첫 판 = `cdp-webhook-claim-1027`** 한 파일 → `cdp-webhook-claim-1027.pg.test.ts`(머리 한 줄 `// replaces: cdp-webhook-claim-1027.test.ts` · §2-9). pg-mem 판 파일과 SQL 고쳐 쓰기(`replace(/FOR UPDATE SKIP LOCKED/…)` · `make_interval` 바꾸기 · `bindParams`)는 **실 PG 판이 처음 전부 통과하고 변이 M1~M4 가 잡힌 뒤** 지운다(같은 주장이 두 곳에 있으면 안 된다 · 그 전까지는 두 판이 함께 있고 pg-mem 판이 push 전 시험을 지킨다).
  - 옮기는 주장 = 지금 파일의 `it` 전부(수신 줄 · 선점 · 재처리 워커 · 정리 네 묶음) · SQL 은 운영 문장 그대로.
  - 새 주장(pg-mem 이 못 보던 것 · `cdp-webhook-delivery.ts:161-192` · `:72-79`):
    - (a) SKIP LOCKED: 연결 A 가 행을 `FOR UPDATE` 로 잡은 채 `claimDeliveries({ limit })` = 그 행 없이 2초 안에 돌아온다(2초 경주 = 막히면 실패).
    - (b) 줄 · 워커 경주: 연결 A 가 워커 선점 UPDATE 를 커밋하지 않은 채 `claimDeliveries({ ownId })` 를 띄우면 기다렸다가 A 커밋 뒤 `[]`(다시 읽은 행의 `processed_at IS NULL` 이 거짓).
    - (c) 같은 키 다시 받음: `ON CONFLICT DO NOTHING RETURNING id` = 0행 → 처리 완료 행만 `duplicate` · `failed` 행은 그대로(지금 파일 88행 주석 「pg-mem 은 기존 행을 돌려줘 여기서 못 본다」).
  - **변이 확인**(파일 복사 · 메모리 `feedback_mutation_check_by_file_copy_not_git`): M1 `SKIP LOCKED` 지움 → (a) 실패 · M2 ownId 조건의 `processed_at IS NULL` 지움 → (b) 실패 · M3 `DO NOTHING` → `DO UPDATE SET status = EXCLUDED.status` → (c) 실패 · M4 `10 minutes` → `0 minutes` → 옮긴 선점 단정 실패(pg-mem 판이 잡던 것을 실 PG 판도 잡음). 넷 다 잡혀야 pg-mem 판을 지운다.
  - **잰다**: 첫 판 한 파일 실행 시간(그릇 준비 포함 · 미포함 둘) · 고정 자료 줄 수(FK 로 필요한 `companies` 등 최소 행 · 칸은 덤프에서 확인). 이 두 값으로 나머지 6파일 묶음 착수를 Harold 님께 다시 묻는다(백엔드 기계 신호 후보 = `vitest.pg.config.ts` 머리 주석 · 의무 아님).

### 2-8 보고 줄(회의론자 P17 · 금지 문장 대신 장치)

reporter 가 끝에 한 줄을 찍는다. 사람은 이 줄을 완료 보고 · Codex 요청문 ① 에 그대로 옮긴다.
`실 PG(15.15) N파일 M건 통과 · 운영 규모 · 성능 · 데이터 분포는 이 시험 밖 · 덤프 <뜬 시각> · 덤프 뒤 적용 DDL <n> · 마지막 해시 대조 <날짜 · 같음/없음>`
- 시작 줄에도 「덤프 뜬 시각 · 그 뒤 닫힌 DDL 수 · 마지막 해시 대조 날짜」를 찍는다(DDL 없는 창이 이어져 덤프가 낡는 것을 보이게 · 회의론자 P6).

### 2-9 스탬프 계약(D6)

- test:pg 가 **전부 통과**했을 때만 `%USERPROFILE%\.hanjul-pgtest\last-pass.json` 에 `{ at, files: { <CT 경로>: sha256 } }` 를 쓴다. CT 경로 = 각 `*.pg.test.ts` 의 상대 import 중 `__tests__/` · `config/database` 밖의 것(기계 추출).
- 기본 시험 `pg-test-stamp.test.ts`(DB 없음 · pre-push 에서 돈다): 같은 규칙으로 CT 경로를 뽑아 지금 sha256 과 스탬프를 대조 → 스탬프가 없거나 하나라도 다르면 실패(「실 PG 시험 대상 CT 가 바뀌었다 · npm run test:pg 를 돌린 뒤 push」).
- **`replaces:` 문법(Codex R1 #5 · #6)** = pg 시험 파일 머리 한 줄 · 값은 둘 중 하나:
  - `none` = 짝 없음 → 스탬프를 늘 요구.
  - 짝 경로(`src/` 기준) = **기본 시험이 실제로 모으는 파일 꼴**이어야 한다: `.test.ts` 로 끝나고 · `.pg.test.ts` 가 아니고 · 자기 자신이 아니고 · 기본 설정의 include 에 들고 exclude 에 안 걸린다(판정은 `vitest.config.ts` 의 include · exclude 를 그대로 import 해 같은 글로브로). 그 파일이 **있으면** 그 판이 push 전 시험을 지키므로 스탬프를 요구하지 않는다 · **없으면**(지웠거나 이름이 바뀜) 스탬프를 요구한다.
  - 줄이 없음 · 값이 두 꼴 밖 · 짝 경로가 위 조건을 어김 = 그 자체로 실패(빠뜨리거나 잘못 가리켜 조용히 꺼지는 길을 막는다).
- 그래서 덤프가 없는 동안(첫 판을 써 둔 뒤 · 첫 배포 창 전) Harold 님 push(C70 · C71 커밋 등)가 막히지 않고, pg-mem 판을 지우는 순간부터는 스탬프 없이는 push 가 막힌다(지우는 일은 첫 통과 뒤에만 · §2-7).
- ponytail: 직접 import 만 본다(그 CT 가 부르는 하위 CT 가 바뀌면 못 잡는다 · 하위까지 넓히는 것은 같은 꼴이 새면 그때).
- 효과: AI 가 선점 CT 를 고치고 test:pg 를 안 돌리면 Harold 님 push 가 막힌다 = 「완료 보고 직전 실제 검증」(CLAUDE.md `skill_workflow_default`)의 기계판. 막히는 경우는 그것 하나뿐이다(CT 가 안 바뀌면 그릇이 꺼져 있어도 push 는 그대로).

## §3 제안 2 · 배포 원장

### 3-1 자리 · 배선

- 새 파일 `status/DEPLOY-LEDGER.md`(상시로드 밖 · STATUS.md:3 30KB 상한).
- STATUS §2 에 포인터 한 줄만(건수 같은 손 숫자를 두지 않는다 · 회의론자 P10 · 건수는 원장을 열 때 센다).
- OPS §2-2 머리에 한 줄: 「배포 전 = status/DEPLOY-LEDGER.md(이번 pull 에 딸려 가는 것 · git 밖 단계)」. 코드 배포 순서 자체는 OPS 가 소유하고 원장은 가리키기만 한다(LESSONS_DEPLOY 「OPS 에서 복사」).
- 메모리 `feedback_hold_server_commands_until_deploy_go` 의 「메모해 두었다가」 자리 = 이 원장(포인터만 고침 · 새 규칙 아님).
- STATUS 라우팅 표에는 넣지 않는다(15행 상한 · 지금 15행).

### 3-2 원장 머리

```
pulled_head   = <해시> (출처 = <날짜> git pull 출력 「Updating <옛>..<새>」)
deployed_head = <해시> (출처 = <날짜> 그 pull 뒤 빌드 · 재시작 · 가동 확인 출력 · 미수령이면 「미수령 · 과대 표시 쪽으로 계산」)
마지막 해시 대조 = <날짜 · 같음/다름/없음>
덤프 = <뜬 시각 · server_version · datcollate · TimeZone>
이번 pull 에 딸려 가는 것 = (AI 가 열 때 계산 · 적어 두지 않는다)
받았지만 아직 안 도는 것 = (deployed_head..pulled_head · AI 가 열 때 계산)
```
- **두 해시를 나눈다(Codex R1 #2)**: pull 성공은 「서버 파일이 바뀌었다」일 뿐 「새 코드가 돈다」가 아니다(OPS §2-2 = pull 뒤 build:safe · reload · 확인이 따로 · LESSONS_DEPLOY 0725 · 0904).
  - `pulled_head`(회의론자 P9) = 배포마다 Harold 님이 이미 붙여 주시는 `git pull` 출력의 `Updating <옛>..<새>` 의 <새>. `Already up to date` 면 그대로 둔다. 새 명령 0. 66 동기화 출력은 쓰지 않는다(1026 정지).
  - `deployed_head` = **계산값**(Codex R2 #2 · R1 #2 와 같은 뿌리 = 사건을 문장으로 늘어놓아 빠진 경우가 생김 → 함수 하나로): `advanceDeployedHead(범위 = deployed_head..pulled_head 의 바뀐 파일, 받은 출력들)`.
    - 필요한 단계는 **범위의 누적 변경**이 정한다(OPS §2-2 의 분기 그대로): `packages/backend/package.json` 바뀜 → 백엔드 `npm install` 출력(puppeteer postinstall 줄 · LESSONS_DEPLOY 1026) / `packages/frontend/package.json` 바뀜 → 프론트 `npm install` 출력 / `packages/backend/` 바뀜 → 백엔드 `build:safe` 성공 줄 + 재시작 줄 / `packages/frontend/` 바뀜 → 프론트 `build:safe` 성공 줄 / 새 `process.env.` 이름 · 원장 ENV 항목 → 재시작은 `restart … --update-env` 줄이어야 한다(reload 줄은 env 를 다시 안 읽어 인정 안 함) / 그 밖 = 「해당 없음」.
    - 재시작 줄 = `pm2 reload targetup-backend` 또는 `pm2 restart … --update-env`(OPS §2-2 5번 두 갈래) + 그 뒤 `pm2 status` · `pm2 describe` 의 uptime 이 pull 뒤로 리셋.
    - 순서 = 대화에서 받은 순서(명령 하나씩이라 순서가 그대로 남는다): pull → (install) → build:safe → 재시작 → uptime. 재시작 줄이 백엔드 build:safe 줄보다 먼저 왔으면 그 재시작은 인정하지 않는다(옛 코드로 다시 뜬 것 · LESSONS_DEPLOY 0904).
    - 필요한 단계의 출력이 다 있으면 `pulled_head` 로 올리고, 하나라도 없으면 그대로(무엇이 빠졌는지 한 줄). 이 출력들은 지금 배포 흐름에서 이미 받는 것이라 새 명령 0.
  - 「받았지만 아직 안 도는 것」이 비어 있지 않으면 다음 창 첫 줄에 「빠진 단계부터」로 나온다(빈 범위로 사라지지 않는다).
- 계산 = `packages/backend` 에서 `node scripts/deploy-ledger.mjs`(판정 = `scripts/deploy-ledger-lib.mjs` 순수 함수 · 확인 출력 꼬리표 = 원장 머리 「이번 창 확인 출력」에 받은 순서대로 `backend-install` · `frontend-install` · `backend-build` · `frontend-build` · `reload` · `restart-env` · `uptime`).
- 「이번 pull 에 딸려 가는 것」(D4 명령): `git log --oneline <pulled_head>..origin/main` · `git log --name-only <pulled_head>..origin/main` 로 백엔드 · 프론트 · `package.json` 변화 · `git log -p` 의 새 `process.env.` 이름 → 필요한 단계(npm install · 프론트 build:safe · ENV `--update-env`)를 원장 첫 줄에 도출. `deployed_head..pulled_head` 의 같은 계산을 앞에 붙인다. `origin/main` = 이 PC 에서 마지막으로 push 한 곳(fetch 는 하지 않는다).
- 첫 줄 경고: `git --no-optional-locks status --short` 의 미커밋 파일 수(다른 세션 `tp-push` 전체 add 혼입 · LESSONS_DEPLOY 1004).

### 3-3 본문 = git 밖 단계만

- **§0 카드 표**: 카드 · 커밋 해시들(push 출력에서). 그 카드의 열린 항목 = §1 항목의 `카드:` 칸에서 계산(id 를 두 곳에 적지 않는다). `cardState` 의 입력(§3-5).
- **§1 대기**: DDL · DML · ENV · root 스크립트 · cron · 사전 실측 · 배포 뒤 사람 실측. AI 가 내는 **모든** DDL 이 여기를 지난다(배포 창 밖의 처방 DDL 포함 · 회의론자 P6).
- 항목 칸: `id` · 묶음/카드 · 단계(사전 / 코드 배포 뒤 / DML / ENV / 사후) · 선행 조건 · 의미를 바꾸는가(예 → 코드 배포 뒤 강제 · 근거 = 그 칸을 읽는 주기 워커) · SQL 원문(```` ```sql ddl:<id> ```` 또는 ```` ```sql dml:<id> ```` 블록) · 기대값 · 가드(세는 SQL · 기대와 다르면 멈추는 꼴 · 숫자를 미리 적지 않는다) · **백업**(D5) · 되돌리기 위치(문서 안 자리만 · 블록은 답에 붙이지 않는다 · 1026) · 칸 없을 때 코드 동작 · test:pg 증거(§2-8 줄) · 확인 한 줄 · 결과.
- **§2 덤프 뒤 적용분**: 닫힌 DDL 의 실행본. 다음 재덤프 때 각 설계서 진행표로 옮기고 비운다. `t_tpl_closed` 의 원천.
- **원문 한 곳(회의론자 P13)**: 항목을 열 때 설계서의 DDL 원문을 원장으로 **옮기고** 설계서에는 id 만 남긴다. 닫으면 §2 로 옮긴다. 재덤프 때 설계서로 옮긴다. 어느 시점에도 원문은 한 곳.
- **닫힘** = 확인 출력이 붙은 때만. 닫힌 DML · ENV · 실측 항목은 결과를 설계서 진행표 · BUGS 로 옮기고 원장에서 지운다.
- **Harold 님께 드리는 SQL** = 블록을 글자 그대로 옮기고 접속 명령을 붙여 하나씩(test:pg 가 증명한 글과 실행하는 글이 같아야 한다 · 메모리 `feedback_no_sql_generation` 의 접속 명령 · 백업 · 확인 형식).

### 3-4 창

- **창 = Harold 님의 「배포 시작하자」**. 시각 · 횟수 규칙은 두지 않는다. AI 는 배포를 요청하지 않는다(기존 규칙 그대로).
- 원장 첫 줄 = 재시작 포함 여부 · 끊김 10~15초 · DDL 수 · 위험 등급(런타임 · 의존성 교체 / 의미 바꾸는 DDL 은 따로 표시 · 기능 묶음과 섞지 않기를 권한다).
- 업무시간이면 재시작 명령 위에 한 줄 「지금 치면 고객 화면이 10~15초 끊깁니다」(막지 않는다 · 회의론자 P11).
- 한 창 안에서 DDL 묶음은 하나씩 · 그 묶음의 사후 확인 출력을 받은 뒤 다음.
- 발송 · 관리 화면을 멈추는 명령은 원장에 「그때 단독」이라고만 적고 블록을 미리 쓰지 않는다(1026).
- 명령은 응답 하나에 하나(사전 실측 묶음 예외 없음 · 회의론자 D 받음).

### 3-5 카드 표시(회의론자 P14)

- **카드 표시 = 계산값**(Codex R2 #3 · 같은 뿌리 · 사건 목록 대신 함수 하나): `cardState(카드 커밋들, deployed_head, 그 카드의 열린 원장 항목)` =
  - 카드 커밋 중 하나라도 `deployed_head` 의 조상이 아님 → 「배포 대기」(일부만 조상이면 「배포 대기 · 일부 반영 <조상 수>/<전체 수>」 · Codex R3 #1)
  - **전부** 조상이고 열린 항목 있음 → 「코드 반영(<마지막 커밋 해시>) · 남은 단계 = <원장 id>」
  - **전부** 조상이고 열린 항목 0 → 「배포 완료 <날짜>」
- **세 입력은 전부 원장 안에 둔다**(Codex R4 #1 · R2 #3 과 같은 뿌리 = 입력 하나가 원장 밖(STATUS 카드)에 있어 「원장이 바뀔 때」가 그 변화를 못 덮음): 카드 커밋 목록 = 원장 **§0 카드 표**(카드 · 커밋 해시들). push 출력을 받은 뒤 AI 는 해시를 STATUS 카드가 아니라 이 표에 적는다. `deployed_head` · 열린 항목도 원장 안.
- 그래서 규칙은 하나다: **원장 파일을 쓸 때마다**(어느 칸이든) AI 가 §0 의 모든 카드를 `cardState` 로 다시 계산해 STATUS 줄이 그 값과 다르면 고친다. STATUS 줄은 계산 결과의 사본일 뿐 입력이 아니다. pull 출력만으로는 `deployed_head` 가 안 오르므로 카드도 안 바뀐다.
- 카드 번호 약속은 두지 않는다(push 출력을 받은 뒤 AI 가 해시를 원장 §0 에 적는다 · tp-push 전체 add 로 섞인 커밋도 조상 판정은 맞다).
- BUGS 제목의 「배포 대기」는 고치지 않는다(84곳 · 알고 둔다).

### 3-6 낡은 표시 1회 정정

다음 「배포 시작하자」에서 `deployed_head` 를 올린 뒤(§3-2) STATUS 의 「배포 대기」 줄마다 그 카드 커밋이 `git merge-base --is-ancestor <카드 커밋> <deployed_head>` 인가를 계산해 §3-5 꼴로 고친다. 1027 회의 때 역할 에이전트 계산 = C68 · C43 · C38 · C12 · C22 · C31(B-1015-4) · C45(1021) 가 573585ac 의 조상(서버 해시 대조 전 · 미검증) · 실제 대기 = C70(push 됨 · 서버 미반영) · C71(미커밋).

### 3-7 원장 처음 내용(이 설계 구현 때)

C70(백엔드 재시작 · 끊김 10~15초) · C71(사전 실측 S5 · S10 · S15 → 코드 → DDL-1 · DDL-3 → DML-1(앞뒤 S1) → S9 → IDX-1 · ENV-3) 의 git 밖 단계를 설계서 `2026-10-27-mall-integration-hardening-design.md` §3 · §11-7 에서 옮긴다(원문 한 곳 · §3-3). 이 설계의 첫 덤프 3명령(D3 순서).

## §4 C71 과의 순서(D3)

| 경우 | 그 창의 순서 |
|---|---|
| 첫 판이 창 전에 준비됨(코드 · 기본 시험 · Codex approve) | C71 사전 실측 S5 · S10 · S15 → 첫 덤프 3명령 → AI 가 test:pg(첫 판) → 통과면 C71 코드 배포 → DDL → DML …(원장 순서) / 실패면 결함을 고친 뒤 C71 배포(같은 창에서 안 끝나면 다음 창) |
| 첫 판 준비 전 | C71 먼저(원장 순서) · 첫 덤프 3명령은 그 창 안 끝에 |

- 선점 문장은 DDL 이 아니라 코드 배포로 켜지고 발송(구매 여정 중복 진입)에 닿는다(회의론자 P8 · 설계서 `2026-10-27-mall-integration-hardening-design.md` §2 K2-6 · §5 묶음 A ①). 그래서 준비돼 있으면 먼저 본다. 기다리게 하지는 않는다(메모리 `feedback_adapt_to_ops_reality_dont_defer`).

## §5 영향표 · 규칙 원문

### 5-1 영향표

| 바뀌는 것 | 읽는 · 부르는 곳 | 영향 |
|---|---|---|
| `vitest.config.ts` exclude 추가 | `npm test` · `.githooks/pre-push:18` | `.pg.test.ts` 를 안 잡는다. 지금 그런 파일 0 → 첫 판 전에는 동작 0 변화 |
| `cdp-webhook-claim-1027.test.ts` 삭제(pg-mem 판 · 첫 통과 뒤) | 기본 시험 수 | 그 파일 단정 수만큼 기본 시험이 준다 → 공백은 §2-9 스탬프가 닫는다(지우는 순간부터 요구) |
| `package.json` `test:pg` · 실행기 `scripts/test-pg.mjs` | 사람 · AI 실행만 | pre-push · 배포(safe-build)는 이 스크립트를 부르지 않는다 · `scripts/` 는 `tsconfig.json` include(`src/**/*`) 밖이라 운영 빌드에 안 든다 |
| 새 시험 도우미 `src/utils/__tests__/pg/*` · `*.pg.test.ts` | `*.pg.test.ts` 만 | 운영 빌드에 안 든다(`tsconfig.json:22` exclude = `src/**/*.test.ts` · `src/**/__tests__/**`) |
| `pg-test-stamp.test.ts`(기본 시험) | `npm test` · pre-push | 짝 pg-mem 판이 지워진 pg 시험의 CT 가 바뀌고 test:pg 를 안 돌렸을 때만 실패 · 그 밖 0 |
| `config/database.ts` | 변경 0 | env 로만 시험 DB 를 가리킨다 |
| 원장 파일 · OPS 머리 · STATUS 포인터 | 사람 · AI | 문서만 · `scripts/harness-check.sh` 실행 |
| CLAUDE.md 2줄 · 메모리 1줄 · 메모리 포인터 1 | 세션 상시 로드 | §5-2 원문 · harness-check |

### 5-2 규칙 원문(구현 첫 단계에서 넣는다)

- CLAUDE.md `no_system_modification` [절대 금지] 의 「git 직접 실행」 → 「git 직접 실행(예외 = 읽기 전용 `git log` · `git merge-base` · `git --no-optional-locks status` 세 명령 · ★1027 Harold 승인 · 배포 원장 계산용 · 그 밖의 git 은 그대로 금지)」.
- CLAUDE.md `db_column_verify_before_code` 끝에 한 줄: 「[덤프 확인 · ★1027 Harold 승인] 운영과 정의 해시가 같다고 마지막으로 대조된 덤프에 그 뒤 닫힌 DDL(배포 원장 §2)을 모두 얹은 시험 DB(`t_tpl_closed`)가 있으면 그 information_schema 조회를 ①의 확인으로 친다(조회 출력과 test:pg 보고 줄을 보고에 붙인다). 대조 기록이 없거나 다르면 원래대로. 분포 · 행 수는 언제나 Harold님 실행.」
- 메모리 `feedback_never_operate_harolds_machine_without_approval` How to apply 끝에 한 줄: 「예외(★1027 Harold 승인): Harold 님이 띄운 시험 그릇 `tu-pgtest` 안에서 `t_` 로 시작하는 DB 의 생성 · 그 안 읽기쓰기 · 삭제는 승인 없이 한다. 그릇 자체(기동 · 종료 · 설정)와 그 밖의 컨테이너 · 프로세스 · 포트는 그대로 금지.」

## §6 Harold 님 하루 · 더하는 것과 덜어 주는 것

| 시점 | 더하는 것 | 덜어 주는 것 |
|---|---|---|
| 처음 1회 | 그릇 명령 1(이미지 받기 포함) · 설계 검토(D5 · D6) | 없음 |
| 개발 중 | 0 | D2 가 서면 새 칸 쓰기 전 컬럼 확인 SQL 왕복 → 덤프 조회(분포 · 행 수는 그대로) · 「일회용 PG16 에서 확인」 문장을 믿던 판단 → 시험이 매번 다시 증명(운영 판) |
| push | AI 가 실 PG 대상 CT 를 고치고 test:pg 를 안 돌렸을 때만 막힘(§2-9) | 운영에서야 드러나던 SQL 의미 결함(B-1011-1 22P02 · 42P08 · ON CONFLICT RETURNING 반대 결과 · 선점 동시성) |
| 배포 창 | 첫 덤프 3명령(1회) · 해시가 다를 때만 덤프 3명령 · DDL 확인 SELECT 는 기존 명령 그대로(해시 칸만) | 「이거 배포됐나」 · STATUS · FEED 어긋남 · 배포 때 AI 가 문서를 뒤지는 대기 · DDL 문법 · 이미 있음 · CHECK 충돌로 배포 밤에 다시 치는 일 |
| 가끔 | 그릇이 멈췄을 때 `docker start tu-pgtest` 1 · 운영 판이 오를 때 그릇 다시 만들기 1 | 컨테이너 찌꺼기 정리 요청(AI 가 만들지 않음) |
| 그대로 남음 | 배포 뒤 사람 실측 · 명령 하나씩 · BUGS 제목 표시 | 원장 실측 칸은 쌓인 것을 보여 줄 뿐 줄여 주지 않는다 |

- 정직한 한 줄(회의론자 P1): D2 가 없으면 제안 1 은 Harold 님 손일을 줄이지 않고 결함만 줄인다. D2 는 승인됐다.

## §7 시험(seam)

| 시험 | 층 | 단정 |
|---|---|---|
| `pg-test-gate.test.ts` | 기본 · DB 없음 | §2-3 조건 1~4 를 하나씩 어긴 env 마다 throw(허용 목록 밖 키 하나 · 실행기 표식 없음 · host · db 이름) · 다 지키면 통과 |
| `pg-test-gate.test.ts` 안 「실행기 env · 경로」 | 기본 · DB 없음 | 실행기의 env 만드는 함수 = 부모 env 에 `OPENAI_API_KEY` · `DATABASE_URL`(운영 꼴)이 있어도 결과에 없다 · 결과 이름 ⊆ 허용 목록 · cwd = `<BE>/src` · vitest 진입 · 설정 경로가 절대경로이고 실제로 있다(cwd 와 무관) |
| `pg-admin.test.ts` | 기본 · DB 없음 | 허용 목록 밖 문장(`DROP DATABASE postgres` · `CREATE DATABASE x` · 세미콜론 두 문장) = throw |
| `pg-dump-loader.test.ts` | 기본 · DB 없음 | 판 줄 없음 · 끝 표식 없음 · 허용 밖 `\` 줄 = 실패 · `\restrict` 줄만 빠진다 |
| `deploy-ledger-parse.test.ts` | 기본 · DB 없음 | §1 · §2 블록 추출(id · 종류 · 순서) · 닫는 펜스 없음 · 같은 id 두 번 · 종류 밖 꼬리표 = 실패 |
| `pg-test-stamp.test.ts` | 기본 · DB 없음 | §2-9 판정 함수(임시 폴더): `none` + 스탬프 맞음 = 통과 · `none` + 없음 · 다름 = 실패 / 짝 있음 = 요구 안 함 / 짝 없음 + 맞음 = 통과 · 짝 없음 + 없음 · 다름 = 실패 / 줄 없음 · 자기 참조 · `.pg.test.ts` 가리킴 · 기본 exclude 에 걸린 경로 · 두 꼴 밖 값 = 실패. 실제 대조는 실제 스탬프로 |
| `deploy-ledger-head.test.ts` | 기본 · DB 없음 | `advanceDeployedHead`: pull 출력만 = 안 오름 · 백엔드만 바뀐 범위 = 백엔드 build:safe + reload + uptime 이면 오름(프론트 빌드 「해당 없음」) · 프론트만 = 프론트 build:safe 면 오름 · ENV 바뀐 범위 = reload 줄은 인정 안 함 · restart --update-env 면 오름 · package.json 바뀜 = install 출력 없으면 안 오름 · 재시작이 build:safe 보다 먼저 = 안 오름 / `cardState`: 세 값 · 항목을 나중에 닫으면 「코드 반영」 → 「배포 완료」 · 커밋 둘 중 하나만 조상 + 열린 항목 0 = 「배포 대기 · 일부 반영 1/2」(완료 아님) / `recomputeCards(원장)`: 「배포 완료」 카드의 §0 에 미배포 커밋 C2 를 더한 원장(`deployed_head` · 항목 그대로) = 「배포 대기 · 일부 반영 1/2」 로 바뀐다 · STATUS 줄 사본은 입력으로 읽지 않는다 |
| `cdp-webhook-claim-1027.pg.test.ts` | 실 PG | §2-7 옮긴 단정 + (a) · (b) · (c) · 변이 M1~M4 |
| template 짓기(globalSetup) | 실 PG | 원장 C71 DDL-1 · DDL-3 이 `t_tpl_after` 에서 한 번씩 돈다 · DML-1 이 ROLLBACK 안에서 돈다 · IDX-1(`CONCURRENTLY`)이 단독 블록으로 돈다 |

- 시험이 증명하지 않는 것: 운영 규모 · 성능 · 데이터 분포 · 운영과 다른 행 상태(보고 줄이 그대로 말한다).

## §8 구현 순서 · Harold 손(그때 하나씩)

1. 규칙 원문 §5-2(CLAUDE.md 2 · 메모리 1) · harness-check.
2. 원장 파일 · OPS 머리 · STATUS 포인터 · 메모리 포인터(§3-1 · §3-7) · harness-check.
3. 시험층 코드(§2-2 ~ §2-9) · 첫 판 · 기본 시험 7종(§7 DB 없음 줄) · tsc 0 · 기본 vitest 전체 · Codex 적대 구현 리뷰 approve 까지.
4. Harold 님: 그릇 명령 1(이 PC).
5. 다음 「배포 시작하자」: §4 표 순서(첫 덤프 3명령 → AI test:pg → C71 …) · 그 창에서 §3-6 1회 정정.
6. 첫 판 첫 통과 · 변이 M1~M4 확인 → pg-mem 판 삭제(§2-7) → 이때부터 스탬프 요구(§2-9) · 이 삭제도 코드 변경이라 Codex 증분.
7. 첫 판 잰 값(시간 · 고정 자료 줄 수)으로 나머지 6파일 묶음 착수를 Harold 님께 묻는다.

- 3 과 4 의 순서: 코드는 그릇 없이 쓸 수 있고(기본 시험 7종은 DB 없음), 첫 판 실행은 덤프가 생기는 5 에서 처음 돈다. 4 는 3 이 끝난 뒤 그 한 줄만 드린다.
- D4 의 git 세 명령을 harold-guard 훅이 막는지는 §8-1 직후 `git log --oneline -1` 한 번으로 확인한다(막으면 Harold 님께 그 사실만 보고 · 훅 수정은 하지 않는다).

## §9 범위 밖 기록(착수 = Harold)

- 이 PC 의 0.0.0.0 수신 4곳(1027 역할 에이전트 읽기 조회 · 수신 포트 조회 1027 재확인): invito-postgres 5433 · 로컬 PostgreSQL 16 서비스 5432(`listen_addresses='*'` · pg_hba 루프백만 trust) · sync-test-mysql 3307(1027 재조회 목록에는 없음 · 멈췄을 수 있음 · 미검증) · 저장소 `docker-compose.yml` `5432:5432`. 방화벽 미확인.
- 배포 순서 문서 두 곳 불일치: OPS §2-2(백 build → 프 build → reload) vs 메모리 `reference_deploy_downtime_fork_mode` 0921 정정(백 재시작 먼저 → 프론트 · 프론트가 먼저면 새 endpoint 404). 원장은 OPS 를 가리킬 뿐 정하지 않는다.
- 떠 있는 bito-scratch-pg(1026 부터 · 127.0.0.1:55432) · 멈춘 컨테이너 찌꺼기(50여 개).
- 나머지 pg-mem 6파일 이관 · 실 PG 성능 시험 · BUGS 제목 84곳.
- 기본 시험이 `config/database` 를 mock 하지 않고 import 하는 파일이 있으면 그 파일은 cwd(packages/backend)의 `.env` 를 읽는다(기본 층의 기존 동작 · 이 설계는 실 PG 층만 막는다 · 있는지는 미검증).

## §10 회의 요지

- 1차: 기획 = Harold 1회 그릇 + REQUIRED 깃발 · 백엔드 = 운영 덤프 · template · 안전문 · 원장 ddl 블록 · 회의론자 = PGlite 기본 + 손 원장 거짓 실증 · 정해 둔 창 반대.
- 교차 토론: PGlite 접음(단일 연결 · 판 · node-pg 소켓) · 최소 DDL 접음(1003 색인 누락 꼴) · 7파일 일괄 접음 · 하루 1회 상한 접음 · STATUS §2 위 표 접음 · DDL 마다 재덤프 접음(해시 비교).
- **끝까지 갈린 것 = 그릇 형태.** 기획 = 상시 그릇도 상시 허가 → `--rm` 스크립트 + 묶음마다 승인. 택한 것 = 백엔드 · 회의론자의 상시 그릇(AI 가 컨테이너를 만드는 길 = 찌꺼기 50여 개 · 55432 중복의 경로 · 묶음마다 승인 왕복이 남음 · 기동 · 종료가 Harold 손이라 never_operate 「기동 · 종료 금지」가 글자 그대로 지켜짐).
- 최종 검증 P1~P17 → §1 D2 · D5 · D6 · §2-1(부담 상한) · §2-3(cwd) · §2-4 · §2-5(자리 · 받는 꼴 · 검사) · §2-6 · §3-2 · §3-3 · §3-4 · §3-5 · §4 에 반영.

## §11 진행표

| # | 단계 | 상태 |
|---|---|---|
| 1 | 브레인스토밍 · 수렴 · Harold 승인(추천 1~4) | 완료 1027 |
| 2 | 설계서 작성 | 1027 |
| 3 | 자가 검토(빈칸 · 모순 · 범위 · 중의성) | 완료 1027 · 고친 것 = 첫 덤프 3명령(정렬 · 시간대는 schema-only 에 안 듦) · 스탬프 요구 시점(짝 pg-mem 판이 있으면 요구 안 함 · C71 push 를 막지 않게) · 기본 exclude 는 configDefaults 를 펼침 · tsconfig 제외 확인 |
| 4 | Codex 적대 리뷰 approve 까지 | 1R 6건(high 2 · medium 4) 전부 수용 1027 = 부모 셸 env 상속 → 실행기 허용 목록 env(§2-2 · §2-3) · pull 과 배포 완료 혼동 → pulled_head · deployed_head 분리(§3-2 · §3-5) · test.env 가 globalSetup 에 안 감 → 실행기가 소유 · 두 번 실행 요구가 C71 DDL 을 막음 → 요구 삭제(§2-5) · replaces 자기 참조 · none 충돌 → 문법 확정(§2-9) · 2R 3건(medium) 전부 수용 = 실행기 상대경로 → 실행기 기준 절대경로(§2-2) · 정상 부분 배포를 거부 · 항목을 나중에 닫으면 카드 안 바뀜 → R1 #2 와 같은 뿌리(상태 바뀌는 사건을 문장으로 늘어놓음)라 개별로 메우지 않고 `advanceDeployedHead` · `cardState` 계산 함수 둘로 바꿈(§3-2 · §3-5) · 3R 1건(medium) 수용 = 커밋 여럿인 카드의 일부 반영 판정 → 전부 조상일 때만 반영 · 일부면 「배포 대기 · 일부 반영 a/b」(§3-5) · 4R 1건(medium) 수용 = 카드에 후속 커밋이 붙으면 완료 표시가 남음 → R2 #3 과 같은 뿌리(입력 하나가 원장 밖)라 카드 커밋 목록을 원장 §0 으로 옮겨 세 입력 전부 원장 안 · 규칙 = 원장을 쓸 때마다 전 카드 재계산(§3-3 · §3-5) · **5R approve(1027)** |
| 5 | Harold 검토(D5 · D6 확인) | 완료 1027(「D5 · D6 추천대로 받고 구현 시작해」) |
| 6 | 구현 §8-1 ~ §8-3 | 1027 · 규칙 3줄 · 원장 · 배선 · 실행기 · 안전문 · 관리 연결 · 덤프 · 정의 해시 · template · 보고 줄 · 스탬프 · 첫 판 · 기본 시험 6파일 · 실행기 실측(주 프로세스 안전문 통과 → 그릇 없음 안내 · 작업자 env = throwaway probe 로 FORCE_TTY 확인) · Codex 적대 구현 1R 6(medium · 스탬프 일부 실행 · 대조 전 표식 · 정의 해시 정밀도 · env 차감 · 큰따옴표 import · 원장 항목 머리) 전부 수용 → 2R 1(카드 줄 앞 공백 = 1R #6 같은 뿌리 → 절별 허용 꼴 표 LINE_FORMS 로 구조 수정) → **3R approve** · 마지막 검증 = backend tsc 0 · 기본 vitest 707파일 10,404건 통과(이 트랙 전 701파일 10,315건) |
| 7 | Harold 그릇 명령 · 첫 덤프 · 첫 판 실행(§8-4 · §8-5) | 그릇 = 이 PC 에 떠 있음 1027(Harold 승인으로 AI 가 1회 기동 · postgres:15.15 · 127.0.0.1:56415 · 그 전에 같은 명령이 운영 서버에서 두 번 실행돼 컨테이너 · 이미지 태그를 지움 · PC Docker Desktop 내부 프록시가 Docker Hub 에 시간 초과 → Docker Desktop 재시작 뒤 받음) · test:pg = 안전문 · 그릇 판 15.15 통과 → 「덤프 없음」에서 멈춤(정상) · 첫 덤프 1027 밤 ~ 1028 아침(① 21:55 서버 파일 · ② 머리 SELECT 가 "char" 잇기 42725 로 거절 → ::text 수정 · ③ scp 받는 자리 = 꾸러미 폴더 · §2-5) · test:pg 1차 = 복원 해시 ≠ 운영 → 줄 대조로 덤프 왕복 표기 94줄 확인 → 정규화(§2-6) · **test:pg 첫 판 1파일 15건 통과 1028 07:43**(대기 DDL 블록 2 통과 · 해시 대조 같음 043ff07c) · 상수 수정 Codex = R1 approve · R2 · R3 지적(문자열 안 치환 · 같은 뿌리) → 구조 수정(문자열 · 따옴표 이름 건너뛰기) · R4 지적(ANY 밖 식) → 「= ANY (…)」 구문 통째 꼴일 때만 · **R5 approve 1028** · 견본 23 틀림 0 · 해시 043ff07c 그대로 |
