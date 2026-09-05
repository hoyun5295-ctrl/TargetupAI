# 한줄로 — 운영 레퍼런스 (OPS)

> **이 문서는 STATUS.md / SCHEMA.md와 함께 운영됩니다.**
> 서버 설정, 접속 정보, 인프라 변경 시 반드시 이 문서도 함께 업데이트하십시오.

---

## 0-1. 운영 DB 설정 기준선 (★ 2026-07-17 인프라 감사 — 신규 컨테이너 생성 시 기본값 방치 금지)

| 항목 | 기준값 | 확인 명령 | 비고 |
|------|--------|-----------|------|
| PG shared_buffers | 4GB | `SHOW shared_buffers;` | 초기 구축 때 튜닝돼 있던 값 (양호) |
| PG effective_cache_size | 48GB | `SHOW effective_cache_size;` | 〃 |
| PG work_mem | 64MB | `SHOW work_mem;` | 〃 |
| MySQL innodb_buffer_pool_size | **2GB** | `SHOW VARIABLES LIKE 'innodb_buffer_pool_size';` | **2026-07-17 128MB(설치 기본값 방치)→2GB 온라인 확장(SET PERSIST — 재기동 유지).** 컨테이너 수명 누적 디스크 읽기 36.9TB가 방치의 증거(데이터 1~2GB DB의 상시 재읽기). 신규/재생성 시 반드시 재적용 확인 |
| nginx gzip | on + application/javascript 포함 | `grep gzip_types /etc/nginx/nginx.conf` | 양호 (JS 압축 확인 2026-07-17) |
| 관측 | pg_stat_statements + MySQL slow_query_log(0.5s) | `SELECT count(*) FROM pg_stat_statements;` | 2026-07-17 가동 — 성능 사이클의 측정 원천 |

## 1. 접속 정보

### 1-1. 로컬 개발 환경
| 서비스 | Host | Port | DB/User | 비고 |
|--------|------|------|---------|------|
| PostgreSQL | localhost | 5432 | targetup / targetup | `docker exec -it targetup-postgres psql -U targetup targetup` |
| MySQL (QTmsg) | localhost | 3306 | smsdb / smsuser / **(서버 .env 참조 — 문서 기재 금지)** | `docker exec -it targetup-mysql mysql -usmsuser -p smsdb` (비밀번호 프롬프트 입력) |
| Redis | localhost | 6379 | - | |
| 프론트엔드 | localhost | 5173 | - | |
| 백엔드 API | localhost | 3000 | - | |
| pgAdmin | localhost | 5050 | - | |

### 1-2. 상용 서버 (IDC)
| 서비스 | Host | Port | 비고 |
|--------|------|------|------|
| SSH | 58.227.193.62 | 22 | administrator |
| PostgreSQL | localhost | 5432 | Docker 컨테이너 (튜닝 완료) |
| MySQL (QTmsg) | localhost | 3306 | Docker 컨테이너, **TZ=KST(+09:00)** |

> **⚠️ MySQL 시간 컬럼 TZ 주의 (D98 확인):**
> - MySQL 서버 자체: `@@global.time_zone = +09:00` (KST)
> - `sendreq_time`: 우리 앱 `NOW()` → **KST** (DATE_ADD 불필요)
> - `mobsend_time`: QTmsg Agent가 **통신사 리포트 시간을 그대로 저장** → **UTC** (DATE_ADD +9h 필요)
> - `repmsg_recvtm`: QTmsg Agent가 **통신사 리포트 시간을 그대로 저장** → **UTC** (DATE_ADD +9h 필요)
> - QTmsg 설정(`qtmsg.xml update_report`)에서 통신사 문자열을 그대로 DATETIME에 INSERT하므로 변경 불가
> - **코드에서 조회 시 반드시 `SMS_DETAIL_FIELDS` / `SMS_EXPORT_FIELDS` 컨트롤타워 상수 사용** (results.ts 상단 정의)
| Redis | localhost | 6379 | Docker 컨테이너 |
| Nginx | 0.0.0.0 | 80/443 | 리버스 프록시 + SSL, client_max_body_size 50M |
| 백엔드 API | localhost | 3000 | PM2 관리 |

### 1-3. PAY 이관 수신 DB (pay-ingest-db — Track D · 레거시 PAY 통계 흡수)

레거시 PAY `sales` DB를 흡수한 도커 컨테이너. 게이트웨이(54·57·58)가 발송 통계를 1분 간격 replace로 직접 적재, 한줄로는 **READ only**. 설계 = `docs/2026-07-07-pay-absorption-track-d-design.md`.

| 항목 | 값 |
|------|------|
| 컨테이너 | `pay-ingest-db` (MariaDB 10.11, invito `58.227.193.62`, `-p 23388:3306`) |
| DB | `sales` |
| **localhost 접속 = root만** | `docker exec -it pay-ingest-db mariadb -uroot -p sales` (비번 프롬프트) |
| `sales` 계정 | **게이트웨이 IP(54·57·58)+비토(139.150.81.213) 전용** → localhost 접속 시 `ERROR 1045` = 정상(보안). 검증은 반드시 `-uroot` |

**반복 실수 방지 (2026-07-16 실측 시행착오):**
- 호스트(`administrator@invito`)에 mysql/mariadb 클라이언트 **없음** → 반드시 `docker exec`로 컨테이너 안 **`mysql`** 사용(★2026-08-28 실측 정정 — `mariadb`는 컨테이너에 없다) (`sudo apt install` 금지).
- `-usales`는 localhost에서 **거부**(IP 전용) → `-uroot`.
- MariaDB **예약어**(`rows`·`groups` 등)를 컬럼 별칭으로 쓰면 문법 에러 → 백틱 또는 개명(`rowcnt`).

**일통계 적재 검증 (서버별 유입·신선도·정합):**
```bash
docker exec -it pay-ingest-db mariadb -uroot -p sales -e "
SELECT SysId, COUNT(*) rowcnt, SUM(TotCnt) tot, SUM(OkCnt) ok, SUM(FailCnt) fail, MAX(InsTm) last_ins, TIMESTAMPDIFF(MINUTE, MAX(InsTm), NOW()) mins_ago FROM RSRM_SalesStts WHERE DestDt=DATE_FORMAT(NOW(),'%Y%m%d') GROUP BY SysId ORDER BY SysId;
SELECT SysId, LEFT(CustId,1) prefix, COUNT(*) c FROM RSRM_SalesStts WHERE DestDt=DATE_FORMAT(NOW(),'%Y%m%d') GROUP BY SysId, LEFT(CustId,1);
SELECT DestDt,SysId,CustId,StoreId,MsgType,COUNT(*) c FROM RSRM_SalesStts GROUP BY DestDt,SysId,CustId,StoreId,MsgType HAVING c>1 LIMIT 20;
"
```
- ① 서버별 유입 + `mins_ago` 작으면 1분 push 정상 / ② prefix 정합(B=54·C=57·D=58) / ③ replace 확정키 중복 0.
- 확정 키 = `(DestDt, SysId, CustId, StoreId, MsgType)`. StoreId 공란 = 후불 업체 정상(CustId 매칭). 스키마 = 설계문서 §2-2.
- ★ 완전성 검증 = 레거시 143 `sales` 원본과 같은 일자 집계 대조(설계 §7-4).

**실측 통과 이력**: 2026-07-16 — 54(65,033)·57(16,219)·58(898,442) 실시간 유입 + prefix 정합 + 중복 0 확인.

---

## 2. 개발 워크플로우

### 2-1. 로컬 개발 (코드 수정 & 테스트)
```bash
# 1. 도커 시작
docker start targetup-postgres targetup-redis targetup-mysql

# 2. 백엔드
cd "C:\Users\ceo\projects\targetup\packages\backend" && npm run dev

# 3. 프론트엔드
cd "C:\Users\ceo\projects\targetup\packages\frontend" && npm run dev

# 4. 코드 수정 → 로컬 테스트 → 완료 후:
git add -A
git commit -m "설명"
git push

# 5. 배포 자동화 (PowerShell 프로필 함수)
tp-push "커밋메시지"     # 타입체크 → git add → commit → push (메시지 생략 시 자동 타임스탬프)
tp-deploy               # 서버 git pull → pm2 restart all (백엔드만)
tp-deploy-full          # 서버 git pull → backend(npm install + build) → frontend build → flyer-frontend build → pm2 restart all
```

> **⚠️ D130 (2026-04-18) 변경:** `tp-deploy-full`에 **backend `npm install`** + **`flyer-frontend` 빌드** 추가. 새 의존성 추가 시 별도 서버 SSH 없이 자동 처리됨.
>
> **교훈:** `$cmds = @(...) -join " && "` + `ssh remote $cmds` PowerShell 배열 패턴이 긴 체인 전달 시 서버 sshd에서 `Connection closed by port 22` 발생 가능. → 반드시 **한 줄 쌍따옴표 방식** `ssh remote "cmd1 && cmd2 && ..."`로 작성.

### 2-2. 서버 배포 (SSH 접속 후)
```bash
ssh administrator@58.227.193.62

# 1. 소스 업데이트
cd /home/administrator/targetup-app
git pull

# 2. 의존성 설치 (새 패키지 추가 시 — 그 패키지 폴더에서)
cd packages/backend && npm install     # 예: 0730 popbill 추가
cd packages/frontend && npm install

# ⚠️ 3. 백엔드 빌드 (TypeScript → JavaScript, 변경 시 필수!)
# git pull만으로는 dist/ 미갱신 → 코드 수정이 서버에 반영 안 됨 (D67 교훈)
# ★ 2026-07-30 정정 — 빌드는 **atomic safe-build만** 허용(CLAUDE.md). `npm run build`는 실패 시
#   dist를 깨진 상태로 남겨 pm2 restart가 죽는다. build:safe는 dist-new에 빌드→검증→atomic mv.
cd /home/administrator/targetup-app/packages/backend && npm run build:safe

# 4. 프론트엔드 빌드 (변경 시) — D61 난독화 플러그인 포함
# ★ build:safe는 backend·frontend **각자의 스크립트**다. 프론트가 바뀌었으면 이 줄을 반드시 실행 —
#   백엔드만 빌드하고 끝내면 화면 변경이 서버에 반영되지 않는다(0730 실수 지점).
cd /home/administrator/targetup-app/packages/frontend && npm run build:safe
# (company-frontend = 2026-07-18 폐기 — 고객사 관리자는 hanjul.ai "관리" 메뉴)
# ⚠️ 최초 빌드 시 vite-plugin-javascript-obfuscator 미설치 에러 발생하면:
# npm install vite-plugin-javascript-obfuscator --save-dev

# 4-1. git pull이 거부되면 (★2026-07-30 실측) — 서버 npm install이 고쳐 둔 lock 파일 드리프트다.
# `error: Your local changes to the following files would be overwritten by merge: …package-lock.json`
# lock은 생성물이고 정본은 커밋에 있으므로 서버 변경만 버린다. **소스 파일이 목록에 있으면 멈추고 확인.**
# git checkout -- packages/backend/package-lock.json && git pull

# 5. 백엔드 재시작 (변경 시) — env를 바꿨으면 `pm2 restart all --update-env`
pm2 reload targetup-backend

# 6. 확인
pm2 status
```

### 2-2-B. 서버 배포 — flyer-frontend만 빌드 (전단AI 전용, D129+)

> **전단AI 프론트엔드만 수정/배포할 때 사용.** 한줄로(frontend/company-frontend)와 완전 분리.
> 동일 서버(58.227.193.62), 동일 레포(`targetup-app`) 내 `packages/flyer-frontend/` 만 빌드.
> pm2 재시작 불필요 (정적 파일, dist/ 갱신 즉시 Nginx 서빙).

```bash
# 1. 로컬에서 코드 push (PowerShell)
tp-push "전단AI 프론트 수정"

# 2. 서버 SSH 접속
ssh administrator@58.227.193.62

# 3. 레포 최신화
cd /home/administrator/targetup-app
git pull

# 4. flyer-frontend 빌드
cd packages/flyer-frontend
npm install          # 의존성 변경 시만
npm run build        # tsc -b && vite build (약 30초~2분)

# 5. 빌드 결과 확인
ls -lh dist/

# 6. (선택) Nginx 리로드 — 보통 불필요
# sudo systemctl reload nginx

# 7. 브라우저에서 Ctrl+F5로 캐시 무시 리로드
```

**⚠️ 주의사항:**
- `packages/backend` 는 절대 건드리지 않는다 (한줄로 기간계)
- pm2 restart 불필요 — 정적 파일
- 최초 빌드에서 `vite-plugin-javascript-obfuscator` 에러 시 → `npm install` 한 번 더

**★ 백엔드도 같이 바꿨을 때 (예: routes/flyer/* 수정):**
```bash
# backend 빌드 추가 + pm2 restart 필요
cd /home/administrator/targetup-app/packages/backend && npm run build
pm2 restart all
```

---

### 2-2-C. 비토 게이트웨이 배포 (.65 — 별도 저장소·별도 서버) ★2026-08-18 신설

> **한줄로(.62)와 완전히 다른 축이다.** 저장소 = `C:\Users\ceo\projects\bito-gateway` · 서버 = `58.227.193.65`(계정 `invito`) · 서버에 Go 없음(로컬 크로스컴파일).
> **절차 원문 = 그 저장소의 `status/DEPLOY-RUNBOOK.md`가 소유한다**(변경 분류표 · 롤백 · 환경 오버라이드). 여기는 "어디를 봐야 하나"와 실행 위치만 적는다.
> `tp-push`·`build:safe`·`pm2`는 이 축에 쓰지 않는다 — 한줄로 전용이다.

| 변경 | 빌드 | 배포 단위 |
|---|---|---|
| docs·status | 0 | push만 |
| web/api (Node) | 0 | `deploy.sh api` |
| web/dashboard | 프론트만 | `deploy.sh dashboard` |
| Go (gateway) | 로컬 크로스컴파일 | `deploy.sh gateway` |

**노트북 — PowerShell 기준** (Harold님 셸은 PowerShell 5.1이라 **`&&` 체이닝이 파서 오류**다. 한 줄에 이으려면 `;`, 아니면 한 줄씩).
⚠ PowerShell에서 `bash`를 그냥 부르면 `C:\WINDOWS\system32\bash.exe`(WSL)가 잡힌다 — **Git Bash 경로를 명시**한다.

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/gw/check.sh      # GW_CHECK_OK 떠야 push
```

```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/gw/build.sh gateway
```

산출물 이름은 `out\bito-gateway-<short sha>`다. **와일드카드 금지**(PowerShell은 네이티브 명령에 글롭을 확장하지 않는다) — 변수로 짓는다.

```powershell
$sha = git rev-parse --short HEAD; scp "out\bito-gateway-$sha" "out\bito-gateway-$sha.sha256" invito@58.227.193.65:/tmp/
```

**`.65` 서버에서** (`git pull`은 invito로, `deploy.sh`만 sudo — root로 pull하면 트리 소유권이 깨진다):

```bash
cd /home/invito/bito-gateway && git pull --ff-only && sudo bash scripts/gw/deploy.sh gateway /tmp/bito-gateway-<sha>
```

성공 마커 `GW_DEPLOY_OK` / 자동 복원 마커 `GW_DEPLOY_ROLLBACK`. 백업 = `/opt/bito-gateway/deploy-backups/<타임스탬프>/`.
health = gateway unit active + `:9090` LISTEN · api `{"ok":true,"db":"connected"}`.

---

### 2-2-D. 대행발송 이메일 접수 워커 운영 (★2026-08-26 신설 · 설계 = [설계서 §18](../docs/2026-08-22-agency-send-design.md))

> **이 워커는 스스로 멈춘다.** POP3 로그인이 3연속 실패하면 폴링을 정지하고 경보를 보낸 뒤 **사람이 재개할 때까지 안 돈다**(1분마다 로그인 재시도가 하이웍스 계정 잠금을 부르기 때문). 그래서 이 절이 필요하다.
> 계정 = `hanjullo@invitocorp.com` · 수신 `pop3s.hiworks.com:995` · 발신 `smtps.hiworks.com:465` · **메일 전용 비밀번호**(하이웍스 로그인 비밀번호 아님).
> ⛔ 이 메일함에 **다른 POP3 클라이언트(아웃룩 등)를 물리지 마라** — 그쪽 "서버에서 삭제" 설정이 메일을 지우면 워커가 못 본다(가비아 문서 경고). 워커는 메일을 지우지 않는다(DELE 0).

**① 가동 여부 확인**
```bash
grep -a "agency-mail" ~/.pm2/logs/targetup-backend-out*.log | tail -5
```
부팅 로그 `이메일 접수 워커 시작: hanjullo@… · 60초 주기 · 틱당 10통` = 가동. `이메일 접수 비활성(…)` = ENV 미설정 또는 `AGENCY_MAIL_ENABLED != true`. **아무 줄도 없으면 크래시 루프를 의심하고 에러 로그부터 본다**(`tail -20 ~/.pm2/logs/targetup-backend-error.log`).

**② ENV 3키** — `packages/backend/.env`. 바꾼 뒤에는 `pm2 restart targetup-backend --update-env`(reload는 env를 다시 안 읽는다).
```
AGENCY_MAIL_ENABLED=true
AGENCY_MAIL_USER=hanjullo@invitocorp.com
AGENCY_MAIL_PASS=<메일 전용 비밀번호>
```
서버 주소는 코드 기본값이라 보통 생략한다(바꾸려면 `AGENCY_POP3_HOST`·`AGENCY_POP3_PORT`·`AGENCY_SMTP_HOST`·`AGENCY_SMTP_PORT`).

**③ 정지 상태 확인·재개** — 정지의 진실은 `agency_send_mail_state.paused_at`이다.
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT mailbox, last_ok_at, login_fail_count, paused_at, paused_reason FROM agency_send_mail_state;"
```
비밀번호를 고친 뒤 재개(**재개 = `paused_at`을 NULL로 · 실패 카운터도 함께 0**):
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "UPDATE agency_send_mail_state SET paused_at = NULL, paused_reason = NULL, login_fail_count = 0 WHERE mailbox = 'hanjullo@invitocorp.com';"
```
다음 틱(1분 이내)에 자동으로 다시 돈다. pm2 재시작 불필요.

**④ 긴급 정지 3단** — 범위가 좁은 것부터 고른다.
| 범위 | 방법 | 되돌리기 |
|---|---|---|
| 발신자 1명 | 슈퍼관리자 회사 편집 → 허용 이메일 관리 → 그 주소 **비활성** 토글 | 같은 자리에서 활성 |
| 회사 전체 | 같은 모달의 **전부 비활성** 버튼(등록은 남는다) | 주소별 활성 토글 |
| 전 회사 | `.env`에서 `AGENCY_MAIL_ENABLED=false` → `pm2 restart targetup-backend --update-env` | `true`로 되돌리고 같은 재시작 |

**⑤ 접수 현황·반려 확인** — 슈퍼관리자 → 발송 관리 → **대행발송 접수** 탭(반려·격리 메일은 접수 목록에 행이 없어 여기가 유일한 노출면). SQL로 볼 때:
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT status, reason, COUNT(*) FROM agency_send_email_intake GROUP BY status, reason ORDER BY 3 DESC LIMIT 20;"
```

**⑥ 경보 3종**(시스템 알림 LMS · dedupKey) — `agency-mail-login-fail`(즉시 · 폴링 정지 동반) / `agency-mail-unknown-sender`(미등록 발신 · 6시간 요약) / `agency-mail-poll-fail`(마지막 성공 폴링 30분 초과 · ⛔ "메일 0통"과는 다른 축).

**⑦ 상한 조정** (★2026-08-26(6) 개정 — 옛 "주소 5통·회사 10통·리드타임 240분 코드 상수" 서술은 폐기)
- **일일 상한 = 기본 무제한**이고 **ENV로 조인다**(코드 배포 없이). `AGENCY_MAIL_DAILY_SENDER_LIMIT`(주소별) · `AGENCY_MAIL_DAILY_COMPANY_LIMIT`(회사별) · **0 또는 미설정 = 그 축을 세지 않는다**(쿼리도 안 돈다). 바꾼 뒤 `pm2 restart targetup-backend --update-env`.
- 푼 근거 = 진짜 방벽은 상한이 아니라 **담당자 승인 게이트**(승인 없이 나가는 경로 0)이고, 검사·테스트 문자 비용은 요청한 고객사 몫이다. 폭주가 실제로 오면 위 ENV로 되돌린다.
- **리드타임 = 40분**(화면·이메일 통일 · `utils/agency-send-state.ts`). 미달 요청은 거절이 아니라 `max(요청+30분, 지금+40분)`으로 **자동 조정**되고 그 사실이 4곳(확인 화면·회신 메일·담당자 문자·변경 토스트)에 고지된다. 발송 허용 시간 밖이면 조정하지 않고 거절.
- 틱당 처리 통수(10)는 그대로 코드 상수다(`utils/agency-send-mail-worker.ts MAX_PER_TICK`).

**⑧ 허용 이메일 등록 — 한 주소가 여러 청구 계정을 대신할 때** (★2026-08-27 신설 · 설계 = [설계서 §20](../docs/2026-08-22-agency-send-design.md))

> 담당자 1명이 청구 계정 여러 개(부서·법인)를 관리하는 업체용이다. 계정이 하나인 업체는 종전과 같아 아무 조치도 필요 없다.

1. 슈퍼관리자 → 고객사 수정 → **허용 이메일 관리**에서 **같은 주소를 계정마다 한 번씩** 등록한다(회사가 달라도 같은 방법).
2. **두 번째 등록부터 표시명이 필수**다. 이 표시명이 곧 담당자가 요청서에 적을 이름이므로 업체가 부르는 대로 적는다(예: 금강 · 신환). 표시명이나 귀속 계정 로그인 아이디가 그 주소의 기존 등록과 겹치면 **등록이 400으로 막힌다**(겹치면 지정 판정이 안 돼 그 주소의 접수가 전부 반려되기 때문). 다중 등록 행에는 목록에 "청구 계정: 이름" 뱃지가 붙는다.
3. 업체 담당자 안내 = 요청서 "내용" 시트 **아무 빈 줄**의 라벨 칸에 `청구 계정`, 값 칸에 안내받은 이름. 지정이 없거나 이름을 못 찾으면 접수가 반려되고 **회신 메일에 그 주소로 요청 가능한 계정 목록이 자동으로 실린다**(담당자가 그걸 보고 다시 보내면 된다).
4. ⛔ **기본 계정을 만들지 않는다.** 후보가 여럿인데 지정이 없으면 반려가 정답이다(자동 선택 = 엉뚱한 계정으로 조용히 청구).

같은 주소의 다중 등록 현황:
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT s.email_norm, c.name AS company, u.login_id, s.label, s.is_active FROM agency_send_email_senders s JOIN companies c ON c.id = s.company_id LEFT JOIN users u ON u.id = s.user_id WHERE s.email_norm IN (SELECT email_norm FROM agency_send_email_senders WHERE is_active GROUP BY email_norm HAVING COUNT(*) > 1) ORDER BY s.email_norm, s.created_at;"
```

---

### 2-2-E. AI 영업 아웃리치 v2 배포 (★2026-08-26 신설 · 기능 = [FEATURE-SALES-OUTREACH.md](../docs/FEATURE-SALES-OUTREACH.md) · 설계 = [설계서 §15](../docs/2026-07-31-ai-sales-outreach-design.md))

> **코드는 이미 서버에 있다**(0824 커밋 `4ca769e7`·`c5c0862e`. 이후 배포에 함께 실려 갔다). 남은 것은 **ENV와 DDL 둘뿐**이다.
> ⛔ 순서 = **⓪ 코드 확인 → ① 존재 검증 → ② ENV → ③ DDL → ④ 반영 확인**. 코드 배포가 DDL보다 먼저라는 규율은 이미 충족된 상태다.
> ⛔ **ENV 없이 DDL만 넣으면 화면은 안 열린다.** `OUTREACH_COMPANY_ID`·`OUTREACH_USER_ID`가 없으면 기능 전체가 "준비가 되지 않았습니다"로 정직하게 거절한다(폴백 없음).
> ⛔ **발송은 3중으로 잠겨 있다**(불변 3): `OUTREACH_SMTP_USER/PASS` 미설정 · `OUTREACH_UNSUB_NOTICE` 공백 · 문안에 `BENEFIT_PLACEHOLDER` 잔존. 셋 중 하나라도면 발송 버튼이 안 열린다. **수신거부 문구는 아직 Harold 미결정**(설계서 §15-10 #8)이라 ②에서 그 키를 비워 두면 **제작까지만 도는 상태로 안전하게 실측**할 수 있다.

**⓪ 코드가 서버에 실려 있는지** — 부팅 때 sweeper가 자기를 등재한다.
```bash
grep -a "sales-outreach-sweeper" ~/.pm2/logs/targetup-backend-out*.log | tail -3
```
`[sales-outreach-sweeper] 시작 (주기 10분 · 좀비 15분 · 파기 30일)` = 실려 있음. 아무 줄도 없으면 그 커밋 이후 재기동이 없었던 것이니 `pm2 restart targetup-backend` 후 다시 본다.

**① 테이블 존재 검증 (③ 실행 전 필수 · 0행이어야 CREATE 한다)**
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('sales_outreach_jobs','sales_outreach_assets');"
```
0행 = 미생성(정상 · ②로). 행이 나오면 이미 만들어진 것이니 ③을 건너뛰고 ④의 컬럼 대조부터 한다.

**② ENV** — `packages/backend/.env`. 넣은 뒤 `pm2 restart targetup-backend --update-env`(**reload는 env를 다시 안 읽는다**).

| 키 | 값 | 없으면 |
|---|---|---|
| `SALES_OUTREACH_ALLOWED_USERS` | `ceo` | **키가 없어도 기본값 `ceo`가 적용된다**(전면 차단이 아니다 · `audit-log.ts:55`). fail-closed가 걸리는 곳은 미로그인·미등록·조회 실패다 |
| `OUTREACH_COMPANY_ID` | 인비토 내부 귀속 회사 `companies.id`(uuid) | **기능 전체가 "준비 안 됨"으로 거절** |
| `OUTREACH_USER_ID` | 그 회사의 `users.id`(uuid) | 위와 같음 |
| `OUTREACH_SMTP_USER` | `hanjul@invitocorp.com` | 발송만 잠김(제작은 정상) |
| `OUTREACH_SMTP_PASS` | 그 계정 **메일 전용 비밀번호** | 위와 같음 |
| `OUTREACH_MAIL_TO` | 자사 수신함 주소 | 생략 = `INVITO_INFO.email` 기본값 사용 |
| `OUTREACH_UNSUB_NOTICE` | 메일 하단 수신거부 안내 문구 | 발송 잠김(**지금은 이게 정상 상태**) |

발신 서버는 기존 `SMTP_HOST`·`SMTP_PORT`를 그대로 쓴다(기본 `smtp.hiworks.com:465`). 공개 샘플 주소의 앞부분은 `PUBLIC_BASE_URL`(기본 `https://hanjul.ai`).

귀속 회사·사용자 uuid를 모를 때 찾는 SQL:
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT c.id AS company_id, c.name, u.id AS user_id, u.login_id FROM companies c JOIN users u ON u.company_id = c.id WHERE c.name LIKE '%인비토%' ORDER BY c.created_at, u.created_at;"
```

**③ DDL 2테이블** — ★**2026-08-28 실행완료**(반영 확인 = jobs 20컬럼 · assets 6컬럼). 아래는 재실행이 필요할 때의 원문이고, ①이 0행일 때만 돈다. `ON_ERROR_STOP`+트랜잭션으로 묶여 있어 **한 줄이라도 실패하면 통째로 롤백**된다(반쯤 만들어진 상태가 안 남는다). 문법만 미리 보고 싶으면 마지막 `COMMIT;`을 `ROLLBACK;`으로 바꿔 한 번 돌린 뒤 되돌린다.
```bash
docker exec -i targetup-postgres psql -U targetup targetup <<'SQL'
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE sales_outreach_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name      text NOT NULL,
  industry_category text,
  homepage_url      text NOT NULL,
  stage             text NOT NULL DEFAULT 'queued'
                    CHECK (stage IN ('queued','crawling','analyzing','awaiting_confirm',
                                     'producing_copy','producing_image','producing_dm','producing_email',
                                     'ready','sent','failed')),
  lock_token        uuid,
  lock_at           timestamptz,
  stage_results     jsonb NOT NULL DEFAULT '{}'::jsonb,
  brand_profile     jsonb,
  event_quote       jsonb,
  fail_stage        text,
  fail_reason       text,
  fail_detail       text,   -- ★2026-09-05 ⑦ ALTER로 추가(신규 CREATE면 여기 포함)
  preview_code      text UNIQUE,
  mail_sent_at      timestamptz,
  mail_result       text CHECK (mail_result IN ('sending','sent','rejected','unknown')),
  mail_confirmed_at timestamptz,
  forwarded_at      timestamptz,
  purged_at         timestamptz,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_soj_created_at ON sales_outreach_jobs (created_at DESC);
CREATE INDEX idx_soj_stage      ON sales_outreach_jobs (stage);
CREATE INDEX idx_soj_unpurged   ON sales_outreach_jobs (purged_at) WHERE purged_at IS NULL;

CREATE TABLE sales_outreach_assets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES sales_outreach_jobs(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('copy','email_html','dm','studio_image')),
  payload     jsonb NOT NULL,
  regen_count integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_soa_job_kind ON sales_outreach_assets (job_id, kind, created_at DESC);
COMMIT;
SQL
```
⛔ `created_by`에 **FK를 걸지 않는다** — 슈퍼관리자는 `super_admins` 소속이라 `users` FK를 걸면 `23503`으로 터진다(2026-07-28 회사 수정 실패 사고 · SCHEMA.md 공통 원칙). 값은 `super_admins.id` uuid다.
⛔ CHECK 목록은 코드 실측 전수다(stage 11값 = 모달·라우트·잡·sweeper 교차 확인 · `mail_result`에 **`sending` 포함**이 핵심 — 발송 선점 CAS가 쓰는 값이라 빠뜨리면 발송이 통째로 막힌다).

**④ 반영 확인** — 컬럼 수 **21**(⑦ ALTER 뒤 · 0828 원본 CREATE 직후는 20) · 6이 나와야 한다.
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT table_name, COUNT(*) AS cols FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('sales_outreach_jobs','sales_outreach_assets') GROUP BY table_name ORDER BY 1;"
```
DDL 전에 화면을 열면 라우트가 **503 `DB_MIGRATION_PENDING`**과 "DB 마이그레이션 필요" 안내를 낸다(`routes/sales-outreach.ts:43`). 500이 뜨면 그건 다른 원인이다.

**⑤ 운영 실측 1건 (설계서 §15-8 잔여)** — 순서대로 하나씩.
1. 슈퍼관리자 `ceo`로 **AI 영업** 메뉴 진입 → 업체 1곳 등록(홈페이지 주소만) → 확인 대기까지 도달하는지
2. 이미지 단계가 도는지 = rembg 상주(`studio-py` pm2 프로세스)가 살아 있어야 한다
3. 제작 완료(ready) 후 **메일 미리보기**가 화면에 뜨는지 · 공개 샘플 페이지 링크가 열리는지
4. 발송은 `OUTREACH_UNSUB_NOTICE`가 정해진 뒤에 한다. 첫 발송은 자사 수신함 1통이고, 결과 3값(`sent`/`rejected`/`unknown`)이 목록에 그대로 찍히는지 본다
5. `[업체에 전달함]` 표시까지 눌러야 공개 샘플 페이지 수명 기산이 설계대로 도는지 확인된다

**⑥ 긴급 정지** — `SALES_OUTREACH_ALLOWED_USERS`를 존재하지 않는 login_id로 바꾸고 `pm2 restart targetup-backend --update-env`. 메뉴 자체가 닫힌다. 발송만 막으려면 `OUTREACH_UNSUB_NOTICE`를 비운다.

**⑦-2 2026-09-05(3) 퀄리티 상향 수렴안(룩·재료·검수 축) + 핫픽스 B-0905-2 배포** = DDL 0 · ENV 0 · 순서 = git pull → backend·frontend `npm run build:safe` → `pm2 reload targetup-backend`(administrator) → 실측 = 이니스프리 잡 새로 만들어 검토 화면 DM 탭(iframe에 **세로 한 페이지 전부**가 보이고 구도 n·배경면 n 표시) · 재료 탭에서 사진 1장 제외 → [고른 재료로 다시 만들기] → 새 DM · 블록 숨김 1회(확인 모달) → 새 DM · 품질 경고 표시 · **[다시 읽기](awaiting_confirm)가 500이 아니라 202**(B-7 회귀 정정 확인). 롤백 = 코드만 되돌리면 된다(stage_results·brand_profile 새 키는 구코드가 읽지 않는다 · 구코드 dm asset에 sections가 없으면 화면은 링크만 보인다).

**⑦ 2026-09-05 개정(샘플 학습 층·검수 발송·운영 조작) 배포 순서 = ALTER → 코드** (설계 = [0905 설계서 §8-1](../docs/2026-09-05-ai-sales-outreach-refinement-design.md) · 컬럼은 nullable 로그성이라 구코드에 무해하고, 신코드는 42703 폴백을 두지 않으므로 **ALTER를 코드보다 먼저** 실행한다)
1. 확인(0행이어야 ALTER 대상):
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_outreach_jobs' AND column_name='fail_detail';"
```
2. ALTER(nullable · 즉시 · 락 부담 0):
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "ALTER TABLE sales_outreach_jobs ADD COLUMN IF NOT EXISTS fail_detail text;"
```
3. 반영 확인(기대 21):
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT COUNT(*) AS cols FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_outreach_jobs';"
```
4. ENV 추가(선택 · `packages/backend/.env`): `OUTREACH_TEST_MAIL_DOMAINS=invitocorp.com`(검수 메일 허용 도메인 · 생략 = 같은 기본값). 넣었으면 `pm2 restart targetup-backend --update-env`.
5. 코드 배포 = §2-2 표준 순서(pull → npm install → `build:safe` → reload). 부팅 로그에 `[sales-outreach-sweeper] 시작 (주기 10분 · 좀비 15분 · 대기 초과 2시간 · 파기 30일)`이 찍히면 신코드다.
6. 실측 1건(순서대로): (a) `fetchHtmlGuarded('https://www.innisfree.com/')` 실측 → `ok 3xxxxx`([B-0905-1](BUGS.md) 종결 기준) (b) 업체 1곳 등록 → 확인 대기 → 확정 → ready (c) 검토 화면에서 [검수 메일 보내기]에 `@invitocorp.com` 주소 입력 → 수신함 도착 (d) 근거 패널 "선명한 이미지 n장 · 상품 n개" · DM 열어 갤러리·상품 이미지가 선명한지 (e) `curl -I` 발행 DM 주소에 `X-Robots-Tag: noindex` (f) 공개 샘플 URL 61회 연타 → 429 안내 HTML.
7. **실물 예시 학습 적재(0905(2) · Harold 화면 1회)**: `/admin/best-layout` → "실물 예시 · AI 영업 학습" 패널 → [실물 예시 올리기] → 단축코드 29줄(신규 10 + 기존 인비토 19 · 브랜드명·담당자 표기가 섞여 있어도 된다)을 붙여넣고 [찾기] → 이미 seed에 있는 9건은 그대로 올려도 되고(같은 본문은 1번만 쓴다) → 이메일 후보에서 짝(탑텐)과 추가할 것(아디제로·마리오아울렛·신규 환영)을 체크 → 일괄 업종 지정(패션 대부분 · 뷰티 7 · 식품 교촌·마리오 · 여행 아난티 · 리빙 에이스하드웨어 · 건강 덴프스) → [올리기]. 확인 = 패널 건수(DM ≥ 20 · 이메일 ≥ 4) · 제외 사유 0 · 그 뒤 AI 영업 1건 제작의 근거 패널 "실물 예시 n건"이 seed 19보다 큰가. 되돌리기 = 패널의 [삭제](두 번 클릭) 또는 `DELETE FROM best_copy_assets WHERE kind='outreach_example';`(전량).

---

### 2-2-F. 국외 접속 판정 대역(geo_allow_cidrs) 갱신 (★2026-08-30 신설 · 반기 권장)

국외 접속 판정은 `geo_allow_cidrs`에 "있으면 국내, 없으면 국외"다(`utils/geo-access.ts`). 목록이 한국 전체 대역을 못 덮으면 국내 로그인이 국외 감지로 오탐된다(2026-08-30 실측: 수기 60개 시절 사흘간 57개 IP 216건 오탐).

1. 원천 재다운로드: `https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest` (약 9MB)
2. 변환(로컬): `node packages/backend/scripts/build-kr-cidrs.js <받은 파일> packages/backend/scripts/data/kr-cidrs.txt`
   - 표본 국내 IP 3개 커버·정렬·최소 1,000개 단언 내장. 실패하면 적재로 넘어가지 않는다.
3. 적재: 슈퍼관리자 시스템 관리 → 국외 접속 통제 카드 → 대역 일괄 등록 textarea에 `kr-cidrs.txt` 내용 전체 붙여넣기 → 등록(전체 교체 · `POST /api/admin/geo/cidrs/bulk`)
4. 재검증:
```bash
docker exec -i targetup-postgres psql -U targetup targetup -c "SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE '115.138.27.202'::inet <<= cidr) AS 표본커버 FROM geo_allow_cidrs;"
```
⛔ 시행 스위치(`GEO_BLOCK_ENFORCE_FROM`)는 적재·재검증 후 오탐이 잦아든 것을 확인한 뒤에만 켠다. 대역이 불완전한 상태로 켜면 전 고객 로그인이 차단된다.

**이행 기록**: 2026-08-30 첫 적재 완료(2,597개 · 감사 로그 "국외 대역 갱신" after 2597/before 60) · 재로그인 실측 = 국외 감지 미발생(오탐 종결) · 같은 날 이새에프앤씨 싱크에이전트 출발지(`125.141.198.22/32` · 발송 에이전트 범위) 예외 등록 완료(기계 접속 감지 종결).

---

### 2-3. QTmsg 발송 엔진 (로컬 - 개발용)
```bash
cd C:\projects\qtmsg\bin
.\test_in_cmd_win.bat
# 이미 실행 중 에러 시: del *.pid *.lock 후 재실행
```

---

## 3. 주요 파일 경로
```
C:\Users\ceo\projects\targetup\  (로컬)
/home/administrator/targetup-app/  (서버)
├── packages/
│   ├── backend/
│   │   └── src/
│   │       ├── app.ts              ← 백엔드 메인
│   │       ├── routes/             ← API 라우트
│   │       ├── services/           ← 비즈니스 로직
│   │       └── utils/              ← 공통 유틸리티 (컨트롤타워)
│   │           ├── standard-field-map.ts  ← 표준 필드 매핑 + customer_field_definitions UPSERT (CT-07, D73 확장)
│   │           ├── sms-result-map.ts      ← 발송 결과값 매핑 (유일한 결과값 기준)
│   │           ├── normalize.ts           ← 데이터 정규화 (값 변환)
│   │           ├── messageUtils.ts        ← 공통 변수 치환 (replaceVariables)
│   │           ├── store-scope.ts         ← 브랜드 격리 컨트롤타워 (D63 B16-01)
│   │           ├── customer-filter.ts     ← 고객 필터/쿼리 빌더 컨트롤타워 (D63 CT-01)
│   │           ├── sms-queue.ts           ← MySQL 큐 조작 컨트롤타워 (D63 B16-02)
│   │           ├── prepaid.ts             ← 선불 차감/환불 컨트롤타워 (D63 B16-02)
│   │           ├── campaign-lifecycle.ts  ← 캠페인 취소/결과동기화 (D63 B16-02)
│   │           ├── unsubscribe-helper.ts ← 수신거부 관리 + 080 자동연동 컨트롤타워 (D64 CT-03, D73 확장: registerUnsubscribe + getUserUnsubscribes)
│   │           └── stats-aggregation.ts ← 대시보드 통계 집계
│   ├── frontend/                   ← 서비스 사용자 + 슈퍼관리자 UI
│   │   └── src/
│   │       ├── components/         ← UI 컴포넌트
│   │       ├── pages/              ← 페이지 (LoginPage.tsx, PrivacyPage.tsx, TermsPage.tsx)
│   │       └── services/           ← API 호출
│   └── (company-frontend = 2026-07-18 폐기 — 관리자 화면 nginx 404 차단·패키지 제거.
│        SDK 서빙 실물 = backend/sdk-serving/{version}/hanjul.min.js)
├── docker-compose.yml
└── STATUS.md
```

---

## 4. Nginx 설정

### 4-1. 설정 파일
| 파일 | 도메인 | 프론트엔드 경로 |
|------|--------|----------------|
| `/etc/nginx/sites-available/targetup` | hanjul.ai | frontend/dist |
| `/etc/nginx/sites-available/targetup-company` | sys.hanjullo.com | frontend/dist |
| `/etc/nginx/sites-available/targetup-app` | app.hanjul.ai | (2026-07-18 관리자 화면 폐기 — `location /` = 404, /sdk·/api 프록시만 유지) |

> **★ 2026-07-08 인앱 SDK 서빙 — `targetup-app`에 `location ^~ /sdk/ { proxy_pass http://127.0.0.1:3000; }` 추가됨** (`location /` SPA 폴백보다 앞·`^~`). 정적 `/sdk/`가 SPA index.html로 새어 팝폰(레거시 `/sdk/v0.3.6/` 스니펫) 인앱이 깨진 것 복구용. **이 블록 지우면 팝폰 인앱 재차단.** backend가 버전폴백으로 서빙(utils/sdk-serve.ts). 신규 몰은 `/api/cdp/sdk/`(이미 `/api/`가 backend).
> **⚠️ sites-enabled/targetup-app 은 심볼릭이 아니라 사본(copy)** — sites-available만 고치면 반영 안 됨. 실제 로드 파일 = **sites-enabled/targetup-app** 직접 수정(또는 available→enabled cp) 후 `nginx -t && systemctl reload`. **백업 파일은 sites-enabled 밖에 둘 것**(`sites-enabled/*` 전부 로드 → `.bak`가 server_name 중복 경고 유발).

### 4-2. SSL 인증서 (Let's Encrypt)
| 도메인 | 인증서 경로 | 만료일 |
|--------|------------|--------|
| hanjul.ai | /etc/letsencrypt/live/hanjul.ai/ | 2026-05-08 |
| sys.hanjullo.com | /etc/letsencrypt/live/sys.hanjullo.com/ | 2026-05-08 |
| app.hanjul.ai | /etc/letsencrypt/live/app.hanjul.ai/ | 2026-05-08 |

---

## 5. 상용 PostgreSQL 튜닝 (62GB RAM, 8코어)

| 설정 | 값 |
|------|-----|
| shared_buffers | 4GB |
| work_mem | 64MB |
| maintenance_work_mem | 512MB |
| effective_cache_size | 48GB |
| random_page_cost | 1.1 |
| checkpoint_completion_target | 0.9 |
| wal_buffers | 64MB |
| max_worker_processes | 8 |
| max_parallel_workers_per_gather | 4 |
| max_parallel_workers | 8 |

---

## 6. QTmsg 발송 시스템

### 6-1. 로컬 개발 환경
- Agent 1개 (단일 Bind ID) → 로컬 개발/테스트용
- SMSQ_SEND 테이블 1개 사용
- 환경변수: SMS_TABLES 미설정 → 기본값 `SMSQ_SEND`

### 6-2. 상용 서버: 11개 Agent 라인그룹 발송 ✅ 운영 중
- 각 Agent별 **별도 테이블** 운영 (충돌 방지)
- 중계서버 58.227.193.58:26352 연결 완료 (bind ack 성공)
- Agent 경로: `/home/administrator/agent1~11/`
- Java 8 (OpenJDK 1.8.0_482)
- MySQL 인증: `mysql_native_password` (QTmsg JDBC 호환)
- 서버 타임존: Asia/Seoul (KST)

| Agent | Deliver ID | Report ID | 테이블 | admin_port | 로그 테이블 | 용도 |
|-------|-----------|-----------|--------|------------|------------|------|
| 1 | targetai_m | targetai_r | SMSQ_SEND_1 | 9001 | SMSQ_SEND_1_YYYYMM | 대량발송 |
| 2 | targetai2_m | targetai2_r | SMSQ_SEND_2 | 9002 | SMSQ_SEND_2_YYYYMM | 대량발송 |
| 3 | targetai3_m | targetai3_r | SMSQ_SEND_3 | 9003 | SMSQ_SEND_3_YYYYMM | 대량발송 |
| 4 | targetai4_m | targetai4_r | SMSQ_SEND_4 | 9004 | SMSQ_SEND_4_YYYYMM | 대량발송 |
| 5 | targetai5_m | targetai5_r | SMSQ_SEND_5 | 9005 | SMSQ_SEND_5_YYYYMM | 대량발송 |
| 6 | targetai6_m | targetai6_r | SMSQ_SEND_6 | 9006 | SMSQ_SEND_6_YYYYMM | 대량발송 |
| 7 | targetai7_m | targetai7_r | SMSQ_SEND_7 | 9007 | SMSQ_SEND_7_YYYYMM | 대량발송 |
| 8 | targetai8_m | targetai8_r | SMSQ_SEND_8 | 9008 | SMSQ_SEND_8_YYYYMM | 대량발송 |
| 9 | targetai9_m | targetai9_r | SMSQ_SEND_9 | 9009 | SMSQ_SEND_9_YYYYMM | 대량발송 |
| 10 | targetai10_m | targetai10_r | SMSQ_SEND_10 | 9010 | SMSQ_SEND_10_YYYYMM | 테스트 전용 |
| 11 | targetai11_m | targetai11_r | SMSQ_SEND_11 | 9011 | SMSQ_SEND_11_YYYYMM | 인증 전용 |

### 6-3. 라인그룹 배정 구조
| 그룹 | 타입 | 테이블 | 용도 |
|------|------|--------|------|
| 대량발송(1) | bulk | SMSQ_SEND_1,2,3 | 고객사 A 전용 |
| 대량발송(2) | bulk | SMSQ_SEND_4,5,6 | 고객사 B 전용 |
| 대량발송(3) | bulk | SMSQ_SEND_7,8,9 | 고객사 C 전용 |
| 테스트발송 | test | SMSQ_SEND_10 | 테스트 전용 (격리) |
| 슈퍼관리자인증 | auth | SMSQ_SEND_11 | 2FA 인증번호 전용 |
| 비토게이트웨이 1(13) | bito | SMSQ_SEND_13 | (★2026-07-17 개명 — 옛 이름 '비토테스트(13)') 자체 게이트웨이(Bito) 연동 — Bito Agent **v1.0.8**(2026-07-05 교체; 1.0.5→1.0.7→1.0.8) 라이브 = `/opt/bito-agent` systemd `bito-agent.service`(enabled), agentID `hanjul01`, journal `/opt/bito-agent/data/`. **v1.0.8=MMS 이미지 첨부** — agent-config `mms:`(allowed_base_dirs=`/home/administrator/mms-images`·max_file_bytes 1MB·on_error:fail) 추가, Agent가 file_name1~5 로컬파일을 읽어 gRPC 바이트 전송, **Gateway v135(media_data inline base64)와 짝** — 둘 다 반영돼야 MMS 이미지 전달(E2E 실측 대기). 발송/집계/드롭다운 `bulk+bito` 포함. Gateway **58.227.193.65:9090**(★2026-08-14 실측 — 하나로호스팅 이전, 옛 클라우드 139.150.81.213 폐기. use_tls:false, 12자 구형 토큰 신 GW 수용 확인), MySQL=smsuser, agent_id/token=비토 발급. 교체 절차=바이너리 `sudo install`+(v1.0.8은 config `mms:` append 동반)+systemd restart. (`~/bito-install`=6/16 옛 스테이징 사본, 미실행) |
| 비토게이트웨이 2(14) | bito | SMSQ_SEND_14 | ★2026-07-17 신설(자비스 요청) — Agent `hanjul02`, Agent v1.0.12 바이너리·설정·systemd·Gateway 계정/인증/라우팅 전부 **비토(자비스) 측 설치 완료**. 한줄로 측 = 테이블 생성(`CREATE TABLE LIKE SMSQ_SEND_13`) + 라인그룹 연결만. |
| 비토게이트웨이 3(15) | bito | SMSQ_SEND_15 | ★2026-07-17 신설(자비스 요청) — Agent `hanjul03`. 그 외 위와 동일. |
- **★ 2026-07-17 라인 14·15 신설 요지:** MySQL 테이블은 13과 완전 동일(컬럼 29 · 인덱스 3 = PK `seqno`+`idx_app_etc1_status`+`idx_app_etc1_sendreq` · InnoDB · utf8mb4_0900_ai_ci). **권한 별도 GRANT 불요** — `smsuser@%`가 `smsdb.*` 스키마 단위 보유라 신규 테이블 자동 상속. 단 smsuser는 CREATE 권한이 없어 **DDL은 root로**. 비토 라인은 `.env` `SMS_TABLES`(1~11)에 넣지 않는다 — 라우팅은 `sms_line_groups`가 전담하고, env에 넣는 순간 라인 미할당 고객사의 일반 발송이 비토로 샌다(`BULK_ONLY_TABLES` 격리는 2차 방어선).
- **★2026-08-14 게이트웨이 이전·Agent 전환 트랙:** 비토 게이트웨이 = 하나로호스팅 `58.227.193.65:9090`(01·02·03 라이브 연결 실측 확정). Agent 3대 실측 = 01 `/opt/bito-agent`(`bito-agent.service`, v1.0.8) · 02 `/opt/bito-agent-hanjul02`(`bito-agent-hanjul02.service`, v1.0.12, 토큰 64자) · 03 `/var/lib/bito-agent-bootstrap/hanjul03`(bootstrap 관리형 = 원격 업그레이드형, 0812 설치). 01·02는 구형이라 원격 업그레이드 미지원 → **v1.0.21(bootstrap v1.0.27 동봉) 보호 전환 진행 중** — 02 doctor FAIL 0·config/유닛 `.bak-20260814` 백업 완료, 발급물(installer config·release_id·nonce) 대기. 전환은 기존 config·토큰·서비스 정체성 보존. 상세 = memory `project_2026_0814_bito_agent_v1021_conversion`.
- **라인그룹 관리 화면 (★2026-07-17 신설):** 슈퍼관리자 `시스템 → 발송 라인 설정`. **쓰기(생성/수정/삭제)는 `LINE_GROUP_ADMIN_USERS`(기본 `ceo,admin`)만** — Harold 명시. 조회는 슈퍼관리자 공용(고객사/사용자 편집 모달의 발송 라인 드롭다운이 같은 API를 쓰므로 막으면 그 화면이 깨진다). 판정 CT = `utils/audit-log.ts` `isLineGroupAdmin`. 저장 시 `findMissingSmsTables`가 MySQL 실존까지 검증(패턴만 맞는 오타 테이블이 라인에 들어가면 그 라인의 적재·집계·정산 UNION이 전부 SQL 에러).
- **사용자별 라인그룹 배정 (D60, 2026-03-08):** users.line_group_id (nullable uuid FK → sms_line_groups.id). 발송 시 사용자 개별 라인그룹 우선 → null이면 회사 라인그룹 fallback. 슈퍼관리자 사용자 편집 모달에서 설정. **배정 자체는 슈퍼관리자 공용 — 위 라인그룹 쓰기 게이트와 별개.**
- 고객사별 라인그룹 할당: 고객사 수정 → 기본정보 탭 → 발송 라인 드롭다운
- 미할당 고객사는 ALL_SMS_TABLES 전체 라운드로빈 폴백

### 6-4. Agent 관리 명령어
```bash
# 개별 시작/중지
cd /home/administrator/agent1/bin && ./qtmsg.sh start
cd /home/administrator/agent1/bin && ./qtmsg.sh stop

# 전체 시작
for i in 1 2 3 4 5 6 7 8 9 10 11; do cd /home/administrator/agent$i/bin && ./qtmsg.sh start; done

# 전체 중지
pkill -f qtmsg

# 프로세스 확인
ps aux | grep qtmsg | grep -v grep | wc -l   # 11개면 정상

# 로그 확인
grep "bind ack" /home/administrator/agent*/logs/*mtdeliver.txt
```

### 6-4-A. Agent가 죽었을 때 복구 순서 (★2026-08-31 실사고 기반 런북)

> ⛔ **재기동을 먼저 하지 않는다.** 올리는 순간 `status_code=100` 중 발송 시각이 지난 건이 즉시 나간다.
> 늦은 발송은 0611 에이치피오 사고(250만원)의 형태다. **적체를 판정하고 늦은 건을 닫은 뒤에 올린다.**

**① 어느 에이전트가 죽었나** — 커맨드라인에 `agentN`이 안 찍히므로 **관리 포트로 본다**(1번=9001 … 11번=9011).
```bash
ss -ltn | grep -oE ':(900[1-9]|901[01])\b' | sort -uV | tr '\n' ' '; echo
```

**② 원인** — 로그 끝이 곧 죽은 시각이다. 에러 없이 온전한 줄에서 끊겼으면 애플리케이션이 스스로 죽은 게 아니다.
```bash
tail -20 "$(ls -t /home/administrator/agent<N>/logs/* | head -1)"
ls -lt /home/administrator/agent<N>/bin/ | head -5      # hs_err_pid*.log = JVM 크래시 확정
```
- `hs_err_pid*.log` 있음 = JVM 크래시. 파일 머리의 신호·`Problematic frame`이 원인.
- 없고 시스템 로그(`journalctl`)에 OOM도 없음 = 외부 종료 쪽.
- ⚠ **OOM으로 단정하지 마라** — 커널 로그에 `Killed process`가 없으면 OOM이 아니다.

**③ 적체 판정** — 올리면 나갈 것과 이미 늦은 것을 가른다.
```bash
docker exec -i targetup-mysql mysql -usmsuser -p smsdb -e "SELECT status_code, SUM(sendreq_time <= NOW()) due_now, SUM(sendreq_time > NOW()) future, MIN(sendreq_time) oldest, MAX(sendreq_time) newest, SUM(mobsend_time IS NULL) not_stamped FROM SMSQ_SEND_<N> WHERE status_code IN (100,104) GROUP BY status_code;"
```
- `100` = 미발송. `due_now`가 올리자마자 나갈 건수, `future`는 예약분(제 시각에 나감).
- `104` = 에이전트가 집었으나 미완결. **재기동해도 안 나간다**(폴링은 100만 집는다).
- `not_stamped`(mobsend_time NULL)가 전량이면 **통신사에 안 갔다** = 되살려도 중복 발송 아님.

**④ 늦은 건 닫기** — `104` + `rsv1='3'`(서버전송요청완료) + `mobsend_time IS NULL`만 대상.
⛔ `rsv1='1'·'2'`는 정상 진행분이라 **절대 건드리지 않는다**(`expired-pending-sweeper` 절대 원칙과 같은 선).
```bash
docker exec -i targetup-mysql mysql -usmsuser -p smsdb -e "SELECT rsv1, COUNT(*) FROM SMSQ_SEND_<N> WHERE status_code=104 GROUP BY rsv1;"
docker exec -i targetup-mysql mysql -usmsuser -p smsdb -e "SELECT COUNT(*) before_cnt FROM SMSQ_SEND_<N> WHERE rsv1='3' AND status_code=104 AND mobsend_time IS NULL; UPDATE SMSQ_SEND_<N> SET status_code=4000, repmsg_recvtm=NOW() WHERE rsv1='3' AND status_code=104 AND mobsend_time IS NULL; SELECT COUNT(*) remain_104 FROM SMSQ_SEND_<N> WHERE status_code=104;"
```
- `4000` = 전송 시간 초과=실패. **워커와 같은 컬럼 세트를 쓴다**(다르게 쓰면 정합이 깨진다).
- 효과 검증 = `remain_104`가 **0**이어야 성공(6원칙 ②).
- 환불은 `mysql-refund-sweeper`(14일 윈도우)가 실패 건수를 세어 자동 처리 — 별도 조치 불요.
- **급하지 않으면 안 해도 된다** — `expired-pending-sweeper`가 48시간 경과분을 같은 방식으로 자동 마킹한다. 수동 실행은 그것을 앞당기는 것뿐이다(화면에 '대기'로 남아 문의가 꼬이는 것을 막는 값).

**⑤ 재기동 · 소화 확인**
```bash
cd /home/administrator/agent<N>/bin && ./qtmsg.sh start && sleep 3 && ss -ltn | grep :90<NN>
docker exec -i targetup-mysql mysql -usmsuser -p smsdb -e "SELECT status_code, COUNT(*) cnt FROM SMSQ_SEND_<N> GROUP BY status_code ORDER BY cnt DESC;"
```
`100`이 줄고 성공 코드가 늘면 정상 소화 중이다.

> **실사고 기록(2026-08-31)** — agent6이 18:32:16에 JVM SIGSEGV(`GCTaskThread`·`libjvm.so`)로 죽었다. 로그는 PING/PONG 정상 중 예고 없이 끊겼고 시스템 로그엔 흔적이 없었으며 OOM도 아니었다. `hs_err_pid1779348.log`가 유일한 증거였다. **11개 에이전트 통틀어 크래시 덤프 1건 = 일회성**(반복이면 JVM 버전·서버 메모리를 봐야 한다). 영향 = 어제 접수 721건 미발송(7개 캠페인·아난티 등) + 오늘 740건 지연. 조치 = 721건 4000 마킹(잔존 0 확인) 후 재기동.

### 6-5. 백엔드 라인그룹 기반 분배
- 환경변수: `SMS_TABLES=SMSQ_SEND_1,SMSQ_SEND_2,SMSQ_SEND_3,SMSQ_SEND_4,SMSQ_SEND_5,SMSQ_SEND_6,SMSQ_SEND_7,SMSQ_SEND_8,SMSQ_SEND_9,SMSQ_SEND_10,SMSQ_SEND_11`
- 서버 `.env`: `packages/backend/.env`에 설정
- 로컬은 SMS_TABLES 미설정 → 기존 `SMSQ_SEND` 1개로 동작 (변화 없음)
- `SYSTEM_SMS_CALLBACK=18008125` — 비밀번호 초기화/정산 등 시스템 SMS 회신번호 (D59, 환경변수화. 미설정 시 서버 기동 차단)
- campaigns.ts 헬퍼 함수: `getNextSmsTable(tables)`, `smsCountAll(tables, ...)`, `smsAggAll(tables, ...)`, `smsSelectAll(tables, ...)`, `smsMinAll(tables, ...)`, `smsExecAll(tables, ...)`
- 모든 헬퍼에 `tables: string[]` 파라미터 → 회사별 라인그룹 테이블 기반 동작
- `getCompanySmsTables(companyId, userId?)`: 회사별/사용자별 라인그룹 조회 (1분 캐시). userId 제공 시 사용자 개별 라인그룹 우선, null이면 회사 fallback
- `getTestSmsTables()`: 테스트 전용 라인 조회
- `getAuthSmsTable()`: 인증번호 전용 라인 조회
- 기동 시 로그: `[QTmsg] ALL_SMS_TABLES: SMSQ_SEND_1, ... (11개 Agent)`

### 6-6. 로그 테이블 자동 생성
- MySQL 이벤트 스케줄러: `auto_create_sms_log_tables`
- 매월 25일 자동으로 2개월 후 로그 테이블 생성 (SMSQ_SEND_1~11_YYYYMM)
- 현재 수동 생성 완료: 202602, 202603

### 6-7. QTmsg 상태/결과 코드

**rsv1 상태:**
- 1=발송대기, 2=Agent처리중, 3=서버전송완료, 4=결과수신, 5=월별처리완료

**주요 결과 코드:**
| 코드 | 의미 |
|------|------|
| 6 | SMS 전송 성공 |
| 1000 | LMS/MMS 전송 성공 |
| 1800 | 카카오톡 전달 성공 |
| 7 | 비가입자/결번/서비스정지 |
| 8 | Power-off |
| 16 | 스팸 차단 |
| 100 | 발송 대기 |

### 6-8. QTmsg 트러블슈팅 교훈
- `sendreq_time`: **반드시 MySQL NOW() 사용** (서버 UTC, JS에서 KST 넣으면 미래시간 → Agent 예약발송 대기)
- `status_code`: 100=대기, 6=SMS성공, 1000=LMS성공
- Agent는 seqno 기반 폴링 → 이전 seq보다 큰 것만 처리
- Agent 강제 재시작: `./fkill.sh` → `./startup.sh`
- Agent 10 경로: `/home/administrator/agent10/`
- 담당자 테스트(campaigns.ts) INSERT 형식을 기준으로 맞출 것
- 백엔드 캠페인 발송 시 회사 라인그룹 테이블 기반 라운드로빈 분배
- 테스트 발송 → 테스트 전용 라인 (SMSQ_SEND_10) 격리
- 결과 조회 시 회사 라인그룹 테이블 합산 조회

---

## 7. Sync Agent 연동 시스템

### 7-1. 개요
- 고객사 로컬 DB → 한줄로 서버로 고객/구매 데이터 자동 동기화
- Sync Agent (.exe)를 고객사 PC에 설치 → API 키 인증으로 데이터 전송
- 기존 upload와 독립적 (source: 'sync' vs 'upload' 구분)
- **슈퍼관리자 API Key 관리 UI (D60, 2026-03-08):** 고객사 편집 모달 9번째 탭 'Sync'. API Key/Secret 조회(마스킹+보기/숨김+복사), 재발급(2단계 확인), use_db_sync 토글. 백엔드 3개 엔드포인트: GET `/api/admin/companies/:id/sync-keys`, POST `/api/admin/companies/:id/sync-keys/regenerate`, PUT `/api/admin/companies/:id/sync-keys` (use_db_sync 토글)

### 7-2. API 엔드포인트
```
POST /api/sync/register    ← Agent 최초 등록 (api_key로 company_id 바인딩)
POST /api/sync/heartbeat   ← Agent 상태 보고
POST /api/sync/customers   ← 고객 데이터 벌크 UPSERT (배치 최대 1000건)
POST /api/sync/purchases   ← 구매내역 벌크 INSERT (배치 최대 1000건)
```

### 7-3. 인증 방식
- 헤더: `X-Sync-ApiKey` + `X-Sync-Secret`
- companies 테이블의 api_key/api_secret으로 인증
- company.status = 'active' && use_db_sync = true 검증

### 7-4. UPSERT 규칙 (customers)
- UNIQUE KEY: company_id + COALESCE(store_code,'__NONE__') + phone
- sms_opt_in, is_opt_out → 기존 한줄로 값 유지 (덮어쓰지 않음)
- 나머지 필드 → Agent 값으로 덮어쓰기 (COALESCE 처리)
- source = 'sync' 태깅

### 7-5. 테스트 계정
- 회사: 테스트고객사_싱크 (company_code: TEST_SYNC)
- company_id: `081000cc-ea67-4977-836c-713ace42e913`
- api_key: `test-sync-api-key-001` / api_secret: `test-sync-api-secret-001`
- agent_id: `63864d32-91ea-4daf-99bb-74f6642fc81e`

### 7-6. 서버 배포 시 주의
1. 서버 DB에 DDL 먼저 실행 (sync_agents, sync_logs 테이블 + idx_customers_company_phone)
2. git pull
3. pm2 restart

### 7-7. OS별 빌드 티어 + 배포 위저드 (2026-06-16)
- 단일 빌드 폐기 → OS 범위별 **5티어** (`sync-agent && npm run build:tiers`): win-modern(node20)/win-mid(node16)/win-legacy(node14)/linux-modern(node20)/linux-legacy(node16). 지원 바닥 = Windows 2008R2/Win7 · Linux CentOS7(glibc2.17), 미만 비지원.
- Windows 구형(win-mid·win-legacy) = `dist-tiers/<tier>/SyncAgent/`에 런타임(UCRT46+vcruntime3)+wasm+`INSTALL-run-as-admin.bat`(EXIT_CODE→diagnose.txt) 동봉 → vc_redist 불필요. (구형 OS는 NSIS Setup.exe 대신 이 폴더 통째 복사)
- 슈퍼관리자 → 시스템 → "싱크에이전트 배포" 위저드(플랫폼→OS→DB) = 룰표 CT `packages/backend/src/utils/agent-build-tiers.ts`로 내보낼 빌드·설치절차 안내.
- **다운로드 서빙**: `GET /api/admin/sync/build-tiers/download/:tier` → 서버 **`packages/backend/agent-builds/`**(백엔드 startup 자동생성, ENV `AGENT_BUILDS_DIR`)의 `sync-agent-<tier>.zip` 서빙. 빌드 머신(Windows)에서 만든 zip 5개(`sync-agent/dist-tiers/downloads/`)를 빌드 후 서버 agent-builds/에 업로드(scp) 1회 필요. 인증은 토큰 헤더(`<a href>` 다운로드 불가 → 프론트 fetch+blob).

---

## 8. 스팸필터 테스트 시스템

- 테스트폰 3대 설치 (SKT/KT/LGU+ 모두 활성)
- SMS/LMS 수신 테스트 성공 (기본 SMS 앱 설정 불필요)
- 스팸 판정 15초 폴링 (QTmsg 성공 + 앱 미수신 = 즉시 blocked)
- APK 경로: `C:\spam\app\build\outputs\apk\debug\app-debug.apk`
- `.\gradlew assembleDebug` 로 커맨드라인 빌드 가능 (Android Studio 불필요)
- 상세: SPAM-FILTER-TEST.md 참고

---

## 9. 080 수신거부 운영 정보

- 나래인터넷 콜백 IP: 121.156.104.161~165, 183.98.207.13
- 콜백 URL: `https://app.hanjul.ai/api/unsubscribes/080callback` (GET, 파라미터: cid=수신거부번호&fr=080번호, 응답: 1/0)
- 인증: Nginx IP 화이트리스트 (토큰 인증 제거됨)
- **080번호 등록 절차:** 나래인터넷에서 080번호 발급 → 나래에 콜백 URL 등록 요청 → 슈퍼관리자에서 사용자별 080번호+자동연동 ON 설정
- **⚠️ 주의:** 새 080번호를 슈퍼관리자에 등록할 때, 나래인터넷에도 해당 번호의 콜백 URL을 등록 요청해야 함 (나래 자체 API 없음, 수동 요청)
- **매칭 로직:** `fr` 파라미터(080번호) → users.opt_out_080_number 매칭 (opt_out_auto_sync=true인 사용자만) → 없으면 companies fallback
- **현재 등록 080번호:** 080-719-6700 (Harold님 계정, 정상 작동)
- **curl 테스트:** `curl "https://app.hanjul.ai/api/unsubscribes/080callback?cid=01012345678&fr=080번호(숫자만)"`
- **DB 접속:** `psql "postgresql://targetup:targetup@127.0.0.1:5432/targetup"`

---

## 8-B. 슈퍼관리자 API를 서버 curl로 호출하는 절차 (★2026-07-20 기록 — 그동안 미기록)

> 대상 = `requireSuperAdmin`이 걸린 endpoint 전부 (`/api/gateway-templates/*`, `/api/alimtalk/senders/import`·`/templates/import`, `/api/admin/*` 등).
> 백엔드 = `http://127.0.0.1:3000` (nginx가 `/api/`를 여기로 프록시). 비밀번호·OTP는 Harold님이 직접 입력 — 문서·대화에 남기지 않는다.

**1) 토큰 발급** — 슈퍼관리자 로그인은 2FA(TOTP) 통과해야 JWT가 나온다 (routes/auth.ts).

> ★2026-08-11 보강 — `loginId`는 **`ceo`**(Harold 확인). 호출은 **도메인이 아니라 서버 안 `127.0.0.1:3000`** 이다.
> 페이로드 4필드는 아래 그대로이며 이름이 하나라도 틀리면 400/401이 난다(`userType`·`loginId`·`password`·`totpCode`).
> `<비밀번호>`·`<OTP 6자리>` 두 자리만 지우고 실제 값을 넣는다 — **큰따옴표는 그대로 둔다**(예: `"totpCode":"123456"`).
> OTP는 30초마다 바뀌므로 코드를 확인한 직후 실행한다. `ceo`로 받으면 열어둔 관리자 화면은 로그아웃된다(단일 세션).

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"userType":"super_admin","loginId":"<아이디>","password":"<비밀번호>","totpCode":"<OTP 6자리>"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "len=${#TOKEN}"    # 0이면 로그인 실패(비번·OTP·차단 확인)
```

**2) 호출** — 헤더는 `Authorization: Bearer <token>` (middlewares/auth.ts:40).

```bash
curl -s -X POST http://127.0.0.1:3000/api/gateway-templates/bulk-migrate-templates \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"dryRun":true,"offset":0,"maxCompanies":10}' -o /tmp/out.json
head -c 3000 /tmp/out.json
```

> 응답이 크면 파일로 받고 잘라 본다(서버에 jq·python 의존 안 함).

**주의 2건 (모르면 작업 중간에 끊긴다)**
- **슈퍼관리자는 `super` 단일 세션**(auth.ts D111 P0) — curl로 로그인하는 순간 브라우저에 열려 있던 슈퍼관리자 화면 세션이 무효화된다(다음 클릭에서 401). 반대로 작업 중 브라우저에서 재로그인하면 curl 토큰이 죽는다. **한 번에 한쪽만 쓴다.**
- **토큰 수명 30분**(`TIMEOUTS.superAdminSessionMinutes`, D55) — 긴 작업은 중간에 1)을 다시 실행해 갱신.

**라우트 배포 반영 확인(토큰 불필요)** — 인증 걸린 경로라 살아있으면 401, 미탑재면 404다.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/gateway-templates/status
```

---

## 9. AI Operator 환경변수 매트릭스 (D170~D181 누적, 2026-05-19)

> 박은 영역 = `/home/administrator/targetup-app/packages/backend/.env`. 박지 X 시 영역별 안전 default 박음.

### 9-1. AI Operator 게이팅 (D178)

| 변수 | 박힘 영역 | 동작 |
|------|---------|------|
| `AI_OPERATOR_ALLOWED_USERS` | hoyun (2026-05-19 박힘) | ENV 박힘 시 본 list 박은 loginId/userId만 진입, 그 외 모두 BetaFeatureModal. ENV 박지 X 시 기존 ENT/BUS 게이팅 (안전 default) |
| `AI_OPERATOR_USE_AI_DECISION` | false (default) | true 시 진정 Orchestrator AI Tool Use 진입 (Opus 4.7 multi-agent loop) |

### 9-2. AI 모델 (D170+)

| 변수 | 박힘 영역 | 비고 |
|------|---------|------|
| `ANTHROPIC_API_KEY` | 박힘 | Claude API (Sonnet 4.6 + Opus 4.7) |
| `OPENAI_API_KEY` | 박힘 | GPT fallback (gpt-5.4-mini + gpt-5.5) |

### 9-3. 자사몰 OAuth (D172/D178)

| 변수 | 박힘 영역 | 비고 |
|------|---------|------|
| `CAFE24_CLIENT_ID` | 설정됨 | 2026-07-03 개발자센터 앱 "한줄로AI" 키 등록 (Harold 실행) |
| `CAFE24_CLIENT_SECRET` | 설정됨 | 〃 |
| `CAFE24_REDIRECT_URI` | 설정됨 | `https://app.hanjul.ai/api/cafe24/oauth/callback` |
| `CAFE24_WEBHOOK_API_KEY` | 설정됨 | 2026-07-03 신규 — WebHook X-API-Key 인증(개발정보 관리 인증정보 값). 미설정 시 구형 HMAC 경로만 동작 |
| `NAVER_COMMERCE_CLIENT_ID` | 박지 X | 네이버 커머스 API 콘솔 박은 영역 |
| `NAVER_COMMERCE_CLIENT_SECRET` | 박지 X | |
| `NAVER_COMMERCE_REDIRECT_URI` | 박지 X | `https://app.hanjul.ai/api/naver-commerce/oauth/callback` |

### 9-4. Web Push (D175-A)

| 변수 | 박힘 영역 | 비고 |
|------|---------|------|
| `VAPID_PUBLIC_KEY` | 박지 X | `web-push generate-vapid-keys` 박음 |
| `VAPID_PRIVATE_KEY` | 박지 X | |
| `VAPID_SUBJECT` | 박지 X | `mailto:admin@hanjul.ai` |

### 9-5. 인바운드 음성 AI (D178)

| 변수 | 박힘 영역 | 비고 |
|------|---------|------|
| `NAVER_CLOVA_STT_INVOKE_URL` | 박지 X | NCloud Clova Speech 박은 영역 |
| `NAVER_CLOVA_STT_SECRET` | 박지 X | |
| `NAVER_CLOVA_TTS_CLIENT_ID` | 박지 X | NCloud Clova Voice 박은 영역 |
| `NAVER_CLOVA_TTS_CLIENT_SECRET` | 박지 X | |
| `VOICE_WEBHOOK_SECRET` | 박지 X | 통신사 박은 HMAC-SHA256 박음. 박지 X 시 서명 검증 skip |

### 9-6. Email 채널 (D180)

| 변수 | 박힘 영역 | 비고 |
|------|---------|------|
| `SENDGRID_API_KEY` | 박지 X | SendGrid 박은 영역 (Bearer token) |
| `SENDGRID_FROM_DOMAIN` | 박지 X | SPF/DKIM/DMARC 박힘 도메인 (예: `mail.hanjul.ai`) |
| `APP_BASE_URL` | 박힘 | `https://app.hanjul.ai` — Custom Webhook URL 박음 정합 |

### 9-7. 박을 영역 확장 명령어 (Harold 직접)

```bash
# 단순 박음 + restart 한번에 (마지막 줄에 박음)
echo "변수명=값" >> /home/administrator/targetup-app/packages/backend/.env && pm2 restart all --update-env

# 박힘 검증
tail -20 /home/administrator/targetup-app/packages/backend/.env
```

★ `pm2 restart all` 단독 박음 시 옛 env 박힌 영역 캐시 박힘 가능 → `--update-env` 박음 정합.

---

## 10. DB 백업 체계 (2026-03-05 구축)

### 10-1. 자동 백업 스케줄
| 항목 | 값 |
|------|-----|
| 스케줄 | crontab — 매일 03:00 KST |
| 스크립트 | `/home/administrator/backups/backup.sh` |
| 환경변수 | `/home/administrator/backups/.env` (chmod 600) |

### 10-2. 백업 대상
| DB | 방식 | 옵션 |
|----|------|------|
| PostgreSQL (targetup) | `docker exec targetup-postgres pg_dump` | gzip 압축 |
| MySQL (smsdb) | `docker exec targetup-mysql mysqldump` | `--single-transaction --no-tablespaces --skip-lock-tables --ignore-table=smsdb.SMSQ_SEND` (SMSQ_SEND는 VIEW) |

### 10-3. 전송 및 보관
| 항목 | 값 |
|------|-----|
| 원격 서버 | 58.227.193.59 (59번 서버) |
| 포트 | 27616 |
| 계정 | backup |
| 원격 경로 | `/home/backup/targetup/` |
| 인증 | SSH 키 (`/home/administrator/.ssh/id_rsa_backup`) |
| 로컬 보관 | 7일 (`find -mtime +7 -delete`) |

### 10-4. 관리 명령어
```bash
# 수동 백업 실행
source /home/administrator/backups/.env && /home/administrator/backups/backup.sh

# 크론 로그 확인
tail -20 /home/administrator/backups/cron.log

# 원격 백업 확인
ssh -p 27616 -i /home/administrator/.ssh/id_rsa_backup backup@58.227.193.59 "ls -la /home/backup/targetup/"

# 복원 (비상 시)
gunzip -c /home/administrator/backups/YYYYMMDD/pg_targetup_*.sql.gz | docker exec -i targetup-postgres psql -U targetup targetup
gunzip -c /home/administrator/backups/YYYYMMDD/mysql_smsdb_*.sql.gz | docker exec -i targetup-mysql mysql -usmsuser -p smsdb
```

### 10-5. 초기 설치 절차
1. 서버에 `mkdir -p /home/administrator/backups`
2. `backup-automate.sh` 복사 → `chmod +x`
3. `/home/administrator/backups/.env` 생성 (BACKUP_DIR, PG/MySQL 정보, ENABLE_S3=false) → `chmod 600`
4. 수동 실행 테스트 → `gzip -t *.sql.gz` 무결성 확인
5. `crontab -e` → `0 3 * * * source .env && backup.sh >> cron.log 2>&1`
6. 향후 S3 연동 시: `.env`에 `ENABLE_S3=true, S3_BUCKET, S3_PREFIX` + `apt install awscli && aws configure`
