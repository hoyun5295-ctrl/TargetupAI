# .62 → .57 한줄로 서버 이전(완전 거울 + IP 교체) · 1102

> 상태 = 설계 1판 · 실행 전 · 1102 오후 추가 = .57 업체 실측(§3-1) · 콜비서 이관 준비(§8) · .62 메모리 처리 · 새 서버 기준(§9). 명령은 실행하는 그 시각에 한 단계씩 드린다(서버 · 발송을 멈추는 명령을 미리 주지 않는다).
> 근거 = 1102 Harold 실행 출력(.62 · .57) · `status/SERVERS.md` · `scripts/backup.sh`.

## §0 왜 · 무엇을

- .62(HPE DL20 Gen11)는 메모리 고장이 확정됐고(1026 memtester 실패 4 · ECC 미동작 · 제조사 UNKNOWN), 1102 하루에 비토 에이전트(11:01)와 백엔드 본체(12:02)가 SIGSEGV 로 죽었다(같은 계열 넷째 · 1101 PG 고객 표 id 1비트 변형 B-1101-5).
- Harold 결정(1102): 「.57 업체를 먼저 옮기고 하나로호스팅에 요청해 싹 밀고 새로 설치」 · 「한줄로 62번 서버랑 동일하게 셋팅하고 아예 옮기는거야」 · 「고대로 완전히 미러떠서 지정된 시간에 IP 만 교체」 · 「ECC 안되는거랑 하드디스크 하나인건 상황이 같다」.
- 결과 모양: 전환 뒤 .57 이 58.227.193.62 를 그대로 쓴다 → 도메인 · 바깥 허용 IP(게이트웨이 · PAY 수집 · 통신사 · 알림톡 · 080 · 결제) 변경 0.

## §1 실측(1102)

| 항목 | .62(지금 한줄로) | .57(지금 · 지운 뒤 새로) |
|---|---|---|
| 하드웨어 | Xeon 6325P 4C/8T · 62GB(가용 39) · 디스크 1장(sda) | i7-10700 16스레드 · 62GB · NVMe 3.6TB 1장 |
| OS · 커널 | Ubuntu 24.04.3 LTS · 6.8.0-142 | 지금 = 도커 컨테이너 안 Ubuntu 23.04(실물 커널 5.15 · 1,283일) → 새로 = 24.04.3 LTS 실물 |
| 디스크 사용 | / 4.9G · /home 26G · /var 81G(분할 /boot · /boot/efi · / 98G · /var 295G · /home 1.5T) | — |
| PG | postgres:15 = 15.15 · 볼륨 `targetup_pgdata` · DB 4.47GB · 압축 백업 하루 약 +1MB | — |
| MySQL | mysql:8.4 = 8.4.8 · 볼륨 `targetup_mysqldata` · 64GB | — |
| PAY 수집 | mariadb:10.11 = 10.11.18 · `/home/administrator/pay-ingest-data` · 바깥 23388 | — |
| Redis | redis:7-alpine = 7.4.7 · 볼륨 `targetup_redisdata` · 키 78 | — |
| pm2 | `targetup-backend`(ts-node src/app.ts) · `outreach-render`(ts-node) · `hanjuldm-api`(`/home/administrator/hanjuldm-app` dist) · `studio-py`(`/home/administrator/rembg-venv` 파이썬) · 모듈 `pm2-logrotate` · Node 24.22.2 | — |
| systemd | `bito-agent` · `-hanjul02` · `-hanjul03` · `-hanjul-04` · `bito-agent-watchdog.timer` · nginx · certbot.timer · fail2ban · tailscaled · docker · cron | — |
| /opt | bito-agent ×4 · bito-watchdog · hanjul-chrome · containerd | — |
| nginx | 켜진 사이트 = hanjul-flyer · hlj · targetup · targetup-app · targetup-company(+ 옛 백업 셋) · ModSecurity 설정 있음 | — |
| cron(administrator) | backup.sh · backup-monitor.sh · monitor-dist.sh · security-watch.sh | — |
| 백업 | 매일 03:00 PG · MySQL 암호화 → `.59`(백업 계정 · 27616) 복사(`scripts/backup.sh:26 · 78`) | — |

**버티기 계산**: CPU 2배 · 메모리 같음 · 디스크 3.6TB 에 112GB(MySQL 이 2달에 두 배가 돼도 4%) = 자원으로는 내년 새 서버 때까지 충분.

## §2 방식 = 같은 판으로 깔고 · 두 번 복사 · 밤에 IP 교체

- 복제(PG 스트리밍 · MySQL binlog) 대신 **두 번 복사**를 쓴다: 1차 = 서비스를 켠 채 전부 복사(바이트가 어긋나도 됨) · 전환 = .62 서비스를 멈추고 2차 복사(바뀐 파일만) → 데이터 디렉터리가 바이트 그대로 같아진다. 움직이는 부품이 적고(복제 설정 · 승격 0) DB 셋 · Redis · 에이전트 기록 파일 · 업로드 파일을 한 방식으로 다룬다. 끊김 = 멈춤 → 2차 복사 → 켜기 → IP 교체 시간(2차 복사량으로 정해진다 · 1차 뒤 실측해서 적는다).
- 같은 판: 패키지 = .62 의 수동 설치 목록(`apt-mark showmanual`) + 바깥 저장소 목록(`/etc/apt/sources.list.d`)을 그대로 · Node 24.22.2 · 전역 ts-node · pm2 · 도커 이미지는 판 고정(postgres:15.15 · mysql:8.4.8 · mariadb:10.11.18 · redis:7.4.7) · 사용자 administrator 의 uid · gid · 그룹(docker) 같게.
- 경로 같게: 분할을 .62 와 같은 꼴(/ · /var · /home 따로)로 → 도커 볼륨 · 앱 경로가 글자 그대로 같다(설정 파일을 고칠 곳 0).

## §3 하나로호스팅 요청(Harold)

1. .57 의 지금 업체를 먼저 옮긴 뒤 지운다. **실측(1102 · §3-1) = 10월 cms 발송 업체는 콜비서 하나 → §8.** 브랜드메시지는 .57 의 kpm 모듈(`top_kpm` · `~/ngen/kpm/`)에서만 나간다는 1007 기록(`status/SERVERS.md` .57 절)이 있다 → 1102 근거 셋(아래)으로 여미지 친구톡 · 브랜드 영향이 없다고 보았지만 **kpm 모듈 자체의 최근 기록은 보지 않았다 = .57 을 비우기 전에 확인**(미검증).

### §3-1 .57 업체 실측(1102 · Harold 실행 출력)

- 26352(MT) 접속 = 바깥 IP 7 · 에이전트 8(QTmsg 에이전트 하나 = 연결 2) · 127.0.0.1 내부 2. `ss` 는 지금 붙은 것만 보여 잠깐 끊긴 IP(27.255.85.75)는 두 번 결과를 합쳤다. .58 과 겹치는 IP 는 211.239.159.87 하나.
- 그날 붙은 계정(cms 로그 파일 이름 · .57 은 `C<번호>` · .58 은 `D<번호>` · `ls` 별칭이라 `command ls -1`) = callsms01(콜비서 · 이용자 C0112 · 9/23 부터 날마다) · inssasms2 · koreasms2 · munjaday1 · runsoft3 · secum1 · unisms · 내부 insvc11 · 12 · test11 · 12.
- **10월 월간 통계 = 발송 업체는 C0112 「콜비서_진1」 하나**(선불 · 잔액 7,051,770원 · SMS 459,887 · 성공 427,796 · 실패 32,088 · 대기 3 · LMS 0). 나머지 계정 6개는 연결만 있고 발송 0 · 10월 .57 FMS · GMS 0.
- .54 → .57 연결 = 그 순간 어떤 포트로도 0(`ss` = 지금 붙은 것만) · 여미지 계정 .57 cms 에 없음 · 10월 cms 통계 FMS · GMS 0 → 여미지 친구톡 · 브랜드 영향 없음으로 판단(1102 Harold 「57 내려도 친구톡은 문제없나보네」). **남은 확인** = .57 kpm 모듈 로그(`~/ngen/kpm/` · 1007 기록 = 로그 2025-10-30~ · 고객사 큐 `ODP_KPM1~5`)의 최근 기록 유무 · .57 을 비우기 전.
- **여미지 = .54 · .58 의 친구톡을 활용해 브랜드메시지를 보낸다(1102 Harold)** → .57 을 비우기 전 마지막 확인 = .54 · .58 에서 여미지 계정의 친구톡 · 브랜드 길이 .57(kpm)에 기대는지(결과는 이 줄 아래에 적는다).
- 콜비서 서버 = 211.233.58.117(qtmsg.xml DB 주소 · .57 에 에이전트 1 · .58 에는 없음). cms 로그에는 접속 IP 가 안 남는다.
- [범위 밖] 1102 07:00 cms 로그에 C0112 결과 92(미수신 마감) 선불 반영 `nok coin` 줄 · 잔액 7,051,770원이 그 92건까지 반영한 값인지 미확인.
2. 실물(컨테이너 아님)에 Ubuntu 24.04.3 LTS Server · 분할 = /boot/efi 1G · /boot 1G · / 100G · /var 1T · /home 나머지(.62 와 같은 꼴 · 크기는 넉넉히) · 스왑 .62 와 같게(확인 뒤 적음).
3. 지정한 밤에 **.62 의 IP(58.227.193.62)를 .57 로 옮기는 것**이 되는지 · 걸리는 시간 · 그 순간 .57 콘솔(원격 KVM) 접속이 되는지(네트워크 설정을 바꾸다 막히면 콘솔이 유일한 길).
4. 설치 뒤 우리 쪽 접속 = .57 자기 IP 로 SSH(administrator · 키) 하나.

## §4 .57 세팅(서비스는 끈 채 · 순서)

| # | 무엇 | 확인 |
|---|---|---|
| S1 | 하드웨어 점검: memtester(가용 메모리 대부분 1회전) · NVMe SMART | 실패 0 · SMART 정상 |
| S2 | 시간대 · 로캘 · 스왑 · sysctl(.62 `/etc/sysctl.d` 그대로) · 사용자 administrator(uid · gid · 그룹 · authorized_keys) | .62 와 diff 0 |
| S3 | 패키지: .62 바깥 저장소 목록 + 수동 설치 목록 그대로(nginx · ModSecurity · fail2ban · certbot · tailscale · docker · cron · gpg 등) · Node 24.22.2 · 전역 ts-node · pm2 · pm2-logrotate | 판 목록 diff 0 |
| S4 | 설정 복사(root): nginx 사이트 · ModSecurity · /etc/letsencrypt · fail2ban · ufw · iptables 고정 규칙(4곳 · SERVERS.md §3) · apparmor(크롬) · logrotate · journald · systemd 유닛(bito-* · watchdog · 드롭인) · `/etc/bito-*.env` · `/usr/local/bin/ops-alert` · root crontab | 파일 목록 diff 0 |
| S5 | /opt(비토 에이전트 4 · 감시 · hanjul-chrome) · /home/administrator(앱 둘 · rembg-venv · backups · .ssh · .pm2 설정 · pay-ingest-data) · 도커 볼륨 넷 = 1차 복사 | 크기 대조 |
| S6 | 서비스는 **켜지 않는다**: bito-agent ×4 · watchdog 타이머 · pm2 · cron(백업이 .59 로 두 번 가지 않게) · 도커 컨테이너 넷은 이미지만 받아 둔다 | 켜진 것 = sshd · docker 데몬뿐 |
| S7 | 시험 기동(선택 · 외부 차단 상태): DB 컨테이너만 1차 복사본으로 띄워 열리는지 보고 다시 끈다(1차 복사본은 어긋날 수 있어 읽기 확인만) | 오류 없이 기동 |

## §5 전환(밤 · 발송 대기 0 확인 뒤 · 한 단계씩)

1. .62: 대량 발송 대기열 0 · 에이전트 대기 상태 · 예약 발송 다음 시각 확인(그 사이에 끝나게).
2. .62: pm2 넷 멈춤 → 비토 에이전트 넷 멈춤(기록 파일 확정) → cron 멈춤 → 도커 컨테이너 넷 멈춤(DB 깨끗이 닫힘).
3. 2차 복사(.62 → .57 · 바뀐 파일만): 도커 볼륨 넷 · pay-ingest-data · /opt/bito-agent*/data · 업로드 · 앱 폴더.
4. .62 네트워크에서 58.227.193.62 를 놓는다(하나로호스팅 · 또는 .62 를 끈다) → .57 에 58.227.193.62 를 올린다.
5. .57: 도커 넷 → pm2 넷 → 비토 에이전트 넷 → 감시 타이머 → cron 켬.
6. 실측: 웹 · API · 로그인 OTP 문자 · 테스트계정 직접발송 1건 · 에이전트 폴링 상태 줄 · 게이트웨이 연결 · PAY 수집 23388 · 감시 회차 · 백업(다음 03:00 또는 손으로 1회).
7. SSH 호스트 키: .62 키를 .57 에 옮겨 두면(§4 S4) 접속 경고 0.

## §6 되돌리기

- 전환 뒤 실측(§5-6)에서 막히면: .57 서비스 멈춤 → IP 를 .62 로 되돌림 → .62 서비스 켬(데이터는 .62 에 그대로 남아 있다 · 전환 뒤 .57 에서 받은 쓰기가 있으면 그만큼 잃는다 → 판단 창 = 전환 뒤 30분 · 그 안에는 바깥 접수가 거의 없는 밤).
- .62 는 이전 뒤 끄지 않고 1주 보관(전원만 내리고 지우지 않음) → 메모리 4장을 빼 넥스서버 부품 보증 청구(§9) → 그 뒤 DB 가 아닌 일(렌더 · 시험 · 백업 받기)용 예비.

## §7 아직 모르는 것(세팅 때 실측)

- systemd 유닛 · 드롭인 실제 내용(1102 `systemctl cat` 은 출력 0 · 파일째 옮긴다) · root crontab · 바깥 apt 저장소 목록 · 스왑 크기 · tailscale(새 기기로 인증 · 상태 파일 복사 금지 = 두 대가 같은 이름).
- IP 교체가 하나로호스팅에서 되는지 · 걸리는 시간 · .57 콘솔.
- 1차 복사 속도(.62 ↔ .57 같은 대역) → 2차 복사 시간 = 끊김 시간.

## §8 콜비서 이관(.57 을 비우는 유일한 선행 · 비토 에이전트 맞춤 · 11-05 설치)

- 방식 = 콜비서 QTmsg 에이전트를 비토 에이전트로 바꾼다(Harold 「우리 비토엔진 에이전트 저기에 맞춤형으로」). 고객이 이미 준 Agent 양식 · qtmsg.xml 로 맞추고 다시 묻지 않는다(1102 Harold 「니가 만들어준 거에 정보 다 입력해서 준 건데 뭘 또 달래」).
- 비토 쪽 발급 · 맞춤 묶음 · 설치 순서 · 전환 순간 잔액 = `bito-gateway/status/STATUS.md` 1102 · `bito-gateway/status/CUSTOMER_MIGRATION_RUNBOOK.md` §8(소유). 요지 = 표마다 Agent 하나(callbiseo-1 · 2 · 3 = SMSQ_SEND · _2 · _J) · 발송계정 CALLBISEO-MAIN(과금잔액 0 → 전환 순간의 .57 잔액 입금) · 메시지별 식별코드 `sender_code` · 허용 IP 211.233.58.117 · 맞춤 묶음 3개 = Harold 다운로드 폴더 `callbiseo-custom`(SHA 앞 12자리 3ac8cdd63bc2 · f36c03db62d2 · e7ad75a24f4b).
- 순서: 라인그룹 지정 · 원본 묶음 삭제(Harold) → 메일(김근형 · 초안 1102 대화) → 11-05 설치 동행(QTmsg 먼저 멈춤 · 설치 스크립트는 끝나면 바로 발송 · test-poll 로 sender_code 9자리 · 시험 1건 뒤 다음 표) → 잔액 입금 → .57 중계는 나간 건 결과가 다 돌아온 뒤 비움 → 하나로호스팅 §3 2~4.
- ★1105 설치 1차(callbiseo-3) 실패 = 콜비서 서버가 EUC-KR(`LANG=ko_KR.euckr`)이라 고쳐 저장한 agent-config.yaml 의 한글 주석이 CP949 → Agent 가 YAML 전체 거부 · 설치 스크립트가 /opt 에 먼저 들어간 그 파일을 계속 씀 · [3/7] 에서 멈춤(서비스 등록 전 = 비토 발송 0). 처방 · 배포 = 비토 290ab30(1105 16:26 · 그 뒤 받는 묶음은 자동 변환). 이미 나간 콜비서 묶음 손 절차 = `bito-gateway/status/CUSTOMER_MIGRATION_RUNBOOK.md` §8-9(소유) · 경위 = 비토 `status/BUG_HISTORY.md` 2026-11-05. 남은 = 담당자 재설치 결과 → test-poll · 시험 1건 → 다음 표.

## §9 .62 메모리 · 새 서버 기준(1102 Harold 결정)

- 하나로호스팅이 메모리 전체 검사(1102 23:00 점검)를 거절 → 로그인 점검 안내 창 취소(0a780fa3 → 되돌림 daab49e1). 고장 난 장을 집을 방법이 없다.
- ECC 메모리로 바꾸지 않는다(비용 · Harold 「ECC 못 산다 · 비싸서」). .62 에 메모리 돈을 더 넣지 않는다(어차피 떠날 서버 · 4장 다 사야 함).
- 메모리 4장 모두 서드파티인 것을 알고 샀다(넥스서버 2/3 견적 435만 6천원 = 본체 P65391-B21 + 16GB × 2 추가 · 정품 한 장 약 180만원이라 기본 장착분도 서드파티로 듣고 삼). 정품 문제로 따질 것 없음 → **청구 = 넥스서버 부품 보증**(9개월 만의 고장 · 근거 = 10/26 memtester 실패 4 · SIGSEGV 4번) · 이전 뒤 4장을 빼서 · 담당 = 박성용(Harold 지시).
- 새로 살 서버 기준(Harold 「서버 여러 대 굴린다는 마인드」 · .57 조립 업체 품질 신뢰): ① 납품 전 메모리 검사 24시간 결과를 받고 인수(처음부터 불량 걸러냄 · 값 그대로) ② 두 대로 굴림(한 대가 죽어도 받음 · DB 복제 + 백업) ③ 케이스 = ACP-2000(섀시만 · 2U · 단일 전원 · 3.5" 베이 2 → 디스크 2장 RAID1) 또는 DB 서버면 HPC-7242(이중 전원 + 핫스왑 베이 4). ECC 가 없으면 메모리 비트 오류를 실시간으로 잡을 방법은 없다(1101 고객 id 1비트 변형 같은 것은 대수를 늘려도 복제된다).
