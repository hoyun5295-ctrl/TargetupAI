# 배포 원장

> 상시 로드 아님. **「배포 시작하자」 때 이 파일부터 연다.** 칸의 뜻 · 규칙 = [설계서](../docs/2026-10-27-real-pg-test-deploy-ledger-design.md) §3 · 코드 배포 순서 = [OPS.md](OPS.md) §2-2(여기는 가리키기만).
> 계산 = `packages/backend` 에서 `node scripts/deploy-ledger.mjs`(읽기 전용 git · 이번 pull 에 딸려 가는 것 · 받았지만 아직 안 도는 것 · 카드 상태).
> **이 파일을 쓸 때마다** 카드 상태를 다시 계산해 STATUS-FEED 카드 · §0 목록 줄을 맞춘다(그 줄은 계산 결과의 사본 · ★1105 목록이 STATUS 에서 FEED §0 으로 옮김). SQL 원문은 여기 한 곳(설계서에는 id 만).
> 명령은 응답 하나에 하나 · 되돌리기 블록은 답에 붙이지 않는다 · 발송을 멈추는 명령은 「그때 단독」.

## 머리

- pulled_head: a7426275 · 2026-11-14 · Harold 서버 출력(git pull 로 a7426275 받음 · root 셸에서 받아 소유가 root 가 됨 → `chown -R administrator` 로 되돌림 · root_owned_left=0 · 장비 전환 뒤 새 장비 `git rev-parse --short HEAD` = a7426275) · 그 전 38c3671f · 2026-11-14 · Harold 서버 출력(git pull 5b7c709d..38c3671f · Fast-forward · 52 파일 5060+ 373- · C133 배포 A + B 38c3671f · 원장 문서 b8bda11a · 장비 = 전환 전 .62 = Xeon 6325P · tailnet 100.88.72.107) · 그 전 5b7c709d · 2026-11-13 · Harold 서버 출력(git pull f3623b12..5b7c709d · Fast-forward · 42 파일 2103+ 101- · C131 c5b199d7 · C132 5b7c709d) · 그 전 f3623b12 · 2026-11-13 오전 · C130(Harold 「배포 완료했고」 · 서버 출력 이 원장에 없음) · 그 전 ddbea40c · 2026-11-12 · Harold 서버 출력(git rev-parse HEAD = ddbea40c3fd1) · 그 전 1a3fbdbf · 2026-11-11 · Harold 서버 출력(git log -1) · 그 전 d8b5367d · 그 전 0c955aab · 2026-11-11 · Harold 서버 출력(git pull ede69d59..0c955aab · C125 14 파일 836+ 30-) · 그 전 ede69d59 · 2026-11-11 · Harold 서버 출력(C124-P1 리허설 출력의 HEAD ede69d59 · 스크립트 · 문서 · 빌드 · 재시작 없음) · 그 사이 5ed096e5(C123) pull = 1110 밤(서버 출력이 이 원장에 없음) · 그 전 23ede51c · 2026-11-10 · Harold 서버 출력(git log -1 = 23ede51c 2026-11-10 19:03:02 +0900 · C122 2차 28 파일) · 그 전 3f5f21ce · 2026-11-10 · Harold 서버 출력(git pull d7a97ce5..3f5f21ce · ecosystem.config.js · C121 원장 문서 셋) · 그 전 d7a97ce5 · 2026-11-10 · Harold 서버 출력(git log -1 = d7a97ce5 2026-11-10 13:00:22 +0900 · 1110 C121 인비토 합성 데이터 v3 1층) · 그 전 da47c9f7(원장 문서만) · 그 전 b44a9cf8(1110 C120 · 서버 출력 b44a9cf8 2026-11-10 07:12:24 +0900)
- deployed_head: a7426275 · 2026-11-14 20:41 · 로그인 화면 서버 점검 안내 창(프론트 build:safe 만 · 백엔드 빌드 · 재시작 0 = 백엔드 dist 는 38c3671f 판 그대로 · https://hanjul.ai/login 에서 안내 창 확인 · 11-15 01:00 뒤 저절로 사라짐) · **★1114 21:50 ~ 22:15 장비 전환 = 이 판이 새 장비(58.227.193.62 = i7-10700 · 옛 .57 장비)에서 돈다**(마지막 복사가 앱 폴더 · 볼륨을 통째로 옮김 · 해시 대조 · 전환 뒤 HEAD a7426275 · C133 표 셋 · `last_state_cursor_on` 있음 · pm2 resurrect 22:11:47 online 5 · 재시작 횟수는 새 pm2 데몬이라 0 부터 · 백엔드 에러 로그 새 종류 0 · 옛 장비 = 58.227.193.57 보관 · 기록 = 미러 런북 §11 1114 줄) · 그 전 38c3671f · 2026-11-14 19:30 · C133 배포 A + B(백엔드 · 프론트 · 단계 ENV 전부 비운 채) · 백엔드 build:safe 19:26:31(「[verify-dist] 통과 — .js 876개 문법 · 두 판 3504개 파일 일치」 · app.js 62299 bytes) · 프론트 build:safe(lazy 청크 55건 실존 · 비literal 동적 import 0 · 빌드 성공) · 적재 0건 한 줄(loading=0) → pm2 restart targetup-backend --update-env(원장 restart-env) · pm2 describe = online · uptime 94s · restarts 51 · unstable restarts 0 · script path dist/app.js · dist grep 「function 이름(」 = claimIntro · runProductSignalPass · snapshotBenchmarks · parseActivationCaps · v3FeaturesFor 각 1 · 기동 로그 19:30:01 「[product-signal] 워커 시작」 · 「[benchmark] 워커 시작」 각 한 줄 · 에러 로그 재시작 뒤 = 19:31:02 「[JourneyExecutor] 적재 중 표식 정리 실패 campaign=998900e1…」(재시작 전 17:36 부터 5분마다 같은 줄 = 새 종류 아님 · B-1114-1 · C129-S1) + 합성 데이터 안내 한 줄 · 장비 = 전환 전 .62(설계서 §14 전제 「서버 전환 끝」은 Harold 1114 「배포 시작하자」로 .62 에 진행 · 미러 실행 원장 §8-1 R4 = 마지막 복사가 앱 폴더 · PG 볼륨을 통째로 옮김 → 전환 밤 대조 = HEAD 38c3671f + 새 표 셋 user_intro_acks · product_signal_daily · benchmark_company_daily) · 커밋 자족 = 로컬 사본(미커밋 45파일 되돌림 = HEAD 해시 45 일치 · 미추적 31 삭제)에서 tsc 0 · 0 · 파일 하나 빼는 변이 빨간불 · 그 전 5b7c709d · 2026-11-13 09:12 · C131(백엔드) · C132(백엔드 · 프론트) · 이 판에 C130 f3623b12 포함 · 백엔드 build:safe(「[verify-dist] 통과 — .js 871개 문법 · 두 판 3484개 파일 일치」) · 프론트 build:safe(lazy 청크 55건 실존 · 비literal 동적 import 0 · 빌드 성공) · 적재 0건 한 줄(loading=0) → pm2 restart targetup-backend --update-env(원장 restart-env) · pm2 describe = online · uptime 2m · restarts 50 · unstable restarts 0 · 에러 로그 재시작 뒤 = 09:12:29 합성 데이터 안내 한 줄뿐(08:32 「Query execution was interrupted」 두 줄 = 재시작 전 옛 프로세스 · C131-DDL-1 실행 구간 안 · 원인 미검증) · dist grep 10줄 기대값 전부 일치(아래 C130-H1 · C131-H1 · C132-H1) · 에러 로그 [queue-scan-guard] 0줄 · 그 전 f3623b12 · 2026-11-13 오전 · C130(Harold 직접 · 서버 출력 이 원장에 없음 · 확인은 이 판에서) · 그 전 ddbea40c · 2026-11-12 00:08:47 · C129(백엔드 · 프론트는 다시 빌드만 · DDL C129-DDL-1 은 재시작 뒤 실행) · 그 전 1a3fbdbf · 2026-11-11 17:55:29 · C126 · C128(백엔드) · 그 전 d8b5367d · 2026-11-11 16:42:27 · C127(프론트 16:42 · 백엔드 재빌드 16:40) · 그 전 0c955aab · 2026-11-11 13:55:40 · C125(대행발송 늦은 보고 대기 해제 · 이 판에 C123 5ed096e5 · C124 ede69d59 코드 포함) · 백엔드 build:safe 13:19:18(「두 번째 빌드(대조용)」 → 「[verify-dist] 통과 — .js 868개 문법 · 두 판 3472개 파일 일치」 → swap · app.js 61011 bytes) · 프론트 build:safe(lazy 청크 55건 실존 · 비literal 동적 import 0 · 성공) · 적재 0건 한 줄(loading=0) → pm2 reload · pm2.log 13:55:40 exited(code 0 · SIGINT) → starting → online · status online · uptime 2m · restarts 45 · script path dist/app.js · unstable restarts 0 · dist grep recoverAgencySpamErrors = utils/agency-send-worker.js 2 · routes/spam-filter.js 1 · 에러 로그 13:20 ~ 13:59 = 13:56:42 합성 데이터 안내 한 줄뿐(끼움 13:19 → 재시작 13:55 사이 36분 포함) · 메모리 = 재시작 2분 307.6MB · pm2.log(0422 부터 전부) 「exceeds」 41줄 중 마지막 = 1110 18:03:49(dist 전환 뒤 0건 · 단 끊기지 않고 돈 구간은 길어야 4시간 안팎 = 하룻밤 뒤 메모리 미검증) · 그 전 = 1111 08:38:07 다시 빌드한 판(1110 22:46 깨진 판 복구 · C124 경위 · HEAD 5ed096e5) · 그 전 23ede51c · 2026-11-10 19:12:58 · C122 2차(묶음 트랜잭션 · 직접입력 9,999 · 여정 %변수%) · 백엔드 build:safe(dist/utils/queue-load-tx.js 19:11:40 · app.js 19:11:44) · 프론트 build:safe(index.html 19:12:57) · pm2 재시작 19:12:58(pm2.log Stopping → online · 「exceeds」 줄 0) · 재시작 뒤 에러 로그 0줄 · 그 전 3f5f21ce · 2026-11-10 18:37 · 메모리 처방 = 운영 백엔드 dist 실행(ecosystem script dist/app.js) · 백엔드 build:safe 18:37:02(dist/app.js 61,011 바이트) · 적재 0건 확인 한 줄 → pm2 delete targetup-backend · pm2 start ../../ecosystem.config.js --only targetup-backend · pm2 save(새 id 5) · 확인 = script path …/backend/dist/app.js · restarts 0 · 기동 18:37:54 배너 · RSS 기동 1분 291,788KB(전 42분 1,728,732KB) · kill_timeout 들어옴 · 환경 변수 이름 대조 = 빠진 것 GEMINI_API_KEY · GEMINI_IMAGE_MODEL 은 .env 2줄 있음(dotenv) · 나머지 = pm2 내부 칸 · 기동 뒤 오류 0 · 그 전 d7a97ce5 · 2026-11-10 · 백엔드 build:safe · pm2 reload(Harold · 원장 요구는 restart-env 였으나 reload 로 실행 · C121 새 ENV 는 아직 안 넣음 · 다른 카드 ENV 항목은 그대로 대기) · 서버 확인 = src grep pushRealismOnline 2 · online · unstable 0 · 13:09:26 워커 시작 「키 2개 · 자사몰 키 0개」 · 재기동 뒤 에러 로그 0줄(마지막 줄 11:42) · DDL 0 · ENV 0 · 그 전 b44a9cf8 = 1110 프론트 build:safe(dist 07:18:29 · Harold 화면 확인 넷 정상) · 그날 아침 reload 도 실행됨(pm2 로그 07:18:47 워커 시작 · 옛 줄 「reload 실행 여부 미확인」 정정) · 그 전 1e2505c1
- 이번 창 확인 출력: (없음)
- 마지막 해시 대조: 2026-10-28 08:27 · 같음(운영 6c12ee8b = t_tpl_closed 6c12ee8b · 덤프 + §2 DDL-1 · DDL-3 · 그 전 07:43 덤프만 043ff07c 같음 · test:pg 1파일 15건 통과)
- 덤프: 2026-10-27 21:55 서버 파일 · server_version 15.15 · datcollate en_US.utf8 · TimeZone Etc/UTC · 머리 SELECT 2026-10-28 07:42

## §0 카드

| 카드 | 커밋 |
|---|---|
| C70 | db9f8c36 |
| C71 | 0a4955fd |
| C72 | 0a4955fd |
| C73 | 00e093bf |
| C74 | 00e093bf |
| C75 | 00e093bf |
| C76 | 00e093bf |
| C77 | c7879512 |
| C78 | 8ee58bd7 |
| C79 | 35966174 |
| C80 | 35966174 |
| C81 | ec8b59d4 |
| C82 | 5264fa99 |
| C83 | 18cc05e2 |
| C84 | bb719adf |
| C85 | bb719adf |
| C86 | 33b7cdde |
| C87 | 33b7cdde |
| C88 | 3d5e09ef |
| C89 | d6e05ff5 |
| C90 | d6e05ff5 |
| C91 | 0b4562da |
| C92 | bec5d5d5 |
| C93 | bec5d5d5 |
| C94 | 8372eb16 |
| C95 | 450b5295 |
| C96 | 33f049c2 |
| C98 | 3af58654 |
| C99 | 14819363 |
| C102 | d7e3061f |
| C101 | cae2cd7c |
| C103 | c5ebdd86 |
| C104 | 67d7b5d3 |
| C105 | 11893902 |
| C106 | 11893902 |
| C107 | 11893902 |
| C108 | dd446c5d |
| C109 | c7b4ff35 |
| C110 | 4ffe7988 |
| C111 | 6d04f394 |
| C112 | 4ffe7988 |
| C113 | 4ffe7988 |
| C114 | b374ed44 |
| C116 | ca7c99cd · c70830be |
| C117 | da9baa11 |
| C118 | 5fc2d527 · b05a4dca · a06e041b |
| C119 | f0e7ea30 |
| C120 | b44a9cf8 |
| C121 | d7a97ce5 |
| C122 | 3f5f21ce · 23ede51c |
| C123 | 5ed096e5 |
| C124 | ede69d59 |
| C125 | 0c955aab |
| C126 | 1a3fbdbf |
| C127 | d8b5367d |
| C128 | 1a3fbdbf |
| C129 | ddbea40c |
| C130 | f3623b12 |
| C131 | c5b199d7 |
| C132 | 5b7c709d |
| C133 | 38c3671f |
| C134 | f01c711f |
| C135 | 03e5d935 |
| C136 | 50b50da1 |
| C137 | 7e186fd7 |
| C138 | 미커밋 |
| C139 | 미커밋 |

## §1 대기

### C71-S5 · 분류코드 몰 · 섞인 회사 수(사전 실측)
- 카드: C71
- 단계: 사전
- 선행: 없음
- 기대: 섞인 회사 수 0(0 이 아니면 ENV-3 전에 그 회사의 몰 코드를 정한다 · 고객사 확인 뒤 DML)
- 확인: 결과 표 그대로(SQL 원문 = 그 창에서 · SCHEMA.md 대상 절 대조 뒤)
- 결과: 1027 밤 Harold 실행 · 분류코드 몰 있는 회사 1(19c59d0c · woocommerce active · coded 4 · plain 0) · 섞인 회사 0 → ENV-3 선행 충족

### C71-S10 · 전달 status CHECK 제약(사전 실측)
- 카드: C71
- 단계: 사전
- 기대: superseded 를 받는가(pg_constraint 정의 한 줄)
- 확인: 정의 출력
- 결과: 1027 밤 Harold 실행 · 제약 3(pkey · company_id fkey · (company_id, source, idempotency_key) unique) · CHECK 0 · status = character varying(20) → superseded(10자) 받음

### C71-S15 · 7일 넘은 미처리 전달(사전 실측)
- 카드: C71
- 단계: 사전
- 기대: 수 · source · 가장 오래된 시각 · 0 이 아니면 배포 전 그 행을 하나씩 판정(되돌림 위험이면 superseded DML · Harold)
- 확인: 결과 표
- 결과: 1027 밤 Harold 실행 · 7일 넘은 미처리 전달(received · failed 재시도 3 미만 · oauth_state 제외) 0행 → 배포 직후 처음 재생될 옛 행 없음 · 판정 DML 없음

### PGT-DUMP · 운영 schema-only 덤프 3명령(실 PG 시험층 첫 덤프)
- 카드: C72
- 단계: 사전
- 선행: 첫 판 준비 여부에 따라 C71 코드 앞(준비됨) 또는 그 창 끝(준비 전) · 설계서 §4
- 기대: ① 서버 root 셸 docker exec -i 덤프 → 서버 파일 ② 같은 셸 SCHEMA_META_SQL 한 번 ③ 노트북 scp → %USERPROFILE%\.hanjul-pgtest\schema.sql(★1028 B-1028-4 · 옛 %LOCALAPPDATA% 자리는 앱 가상화로 두 벌)
- 백업: 해당 없음(읽기)
- 확인: 머리 SELECT 출력 → schema.meta.json · test:pg 시작 줄 「마지막 해시 대조 = 같음」
- 결과: 1028 · ① 서버 파일 477,334바이트(15.15) · ② 해시 043ff07c(정규화 뒤) · ③ scp → 꾸러미 폴더(설계서 §2-5) · test:pg 첫 판 1파일 15건 통과 · 해시 대조 같음 · 남은 일 = 서버 ~/pgtest-schema.sql · ~/pgtest-fp-lines.txt 지우기

### C71-DDL-1-FILL · consent_source_at 채우기(consent_at 에서)
- 카드: C71
- 단계: DML
- 선행: C71-DDL-1 · S6 결과
- 의미 바꿈: 예(비교 기준 시각을 채움)
- 기대: 행 수를 먼저 세고 회사별로 나눠 SET lock_timeout 아래
- 백업: 그 표 pg_dump -t customer_stores(값을 바꾸는 DML · 설계서 D5)
- 확인: 채운 뒤 NULL 아닌 수 = consent_at 있는 수
- 결과: 1028 앞 실측(S6) · 회사 19c59d0c 하나 · 몰 4(렌즈고고 · 일본이모 · 이로이로도쿄 · 렌즈007) · consent_at 있는 행 439,187 · 시계 있는 행 2(DDL-1 뒤 새 쓰기) · 표 590,384행 167 MB · 회사 하나라 한 문장 = 회사별 한 번 · **1028 08:39 실행** · 백업 backups/pre_c71_dml_20261028_0839.sql.gz(42,850,166바이트 · 끝 표식 1 · customer_stores + cdp_events) · UPDATE 439184 · 뒤 fill_left 0 · Codex 2R approve

```sql dml:C71-DDL-1-FILL
SET lock_timeout = '3s';
UPDATE customer_stores
   SET consent_source_at = consent_at
 WHERE company_id = '19c59d0c-77d3-4e52-9ceb-9a47a3c37e49'::uuid
   AND consent_source_at IS NULL
   AND consent_at IS NOT NULL;
```

### C71-DML-1 · 결제 전 purchase 6,064건 → order_placed
- 카드: C71
- 단계: DML
- 선행: C71 코드 배포 확인 · 앞 S1
- 의미 바꿈: 예
- 기대: 술어 P_unpaid 행만 · renamed_from = purchase · created_at 그대로 · 뒤 S1 = P_unpaid 0
- 백업: 그 표 pg_dump -t cdp_events(값을 바꾸는 DML · 설계서 D5)
- 확인: 앞뒤 S1
- 결과: 1028 앞 실측 · P_unpaid 6,116(woocommerce pending 4,428 · cancelled 1,425 · refunded 261 · cafe24 refunded 1 · cancelled 1 · 6,064 는 90일 창 · 이 술어는 0610 부터) · 표 50,712행 72 MB · **1028 08:39 실행**(같은 백업 파일) · UPDATE 6116 · 뒤 renamed 6116 · Codex 1R 지적 없음

```sql dml:C71-DML-1
SET lock_timeout = '3s';
UPDATE cdp_events
   SET event_name = 'order_placed',
       properties = properties || '{"renamed_from": "purchase"}'::jsonb
 WHERE event_name = 'purchase'
   AND NOT (properties ? 'revenue_applied')
   AND NOT (properties ? 'revenue_reversed')
   AND COALESCE(properties->>'status', '') NOT IN ('completed', 'paid')
   AND created_at >= '2026-06-10 00:00:00+09';
```

### C71-S9 · 주문당 purchase 중복 수
- 카드: C71
- 단계: 사후
- 선행: C71-DML-1
- 기대: 0(0 이어야 IDX-1)
- 결과: 1028 08:39 · **832 주문에 purchase 2행 이상** → IDX-1 건너뜀(명령 안 \if) · 중복 정리 방법은 다음 과제(지금 코드는 주문당 한 행으로 찾아 쓰므로 새 중복은 안 생기는 설계 · 옛 중복의 출처 · 매출 이중 집계 여부 미검증)

### C71-IDX-1 · 주문당 purchase 1행 부분 유일 색인
- 카드: C71
- 단계: 사후
- 선행: C71-S9 = 0
- 의미 바꿈: 예(같은 주문 purchase 두 번째 = 23505)
- 백업: 정기 백업으로 갈음(색인 추가 · 설계서 D5)
- 확인: pg_indexes 정의 한 줄 + SCHEMA_META_SQL 해시
- 되돌리기: DROP INDEX CONCURRENTLY uq_cdp_events_purchase_order(만들다 끊겨 INVALID 로 남아도 같은 문장)
- 결과:

```sql ddl:C71-IDX-1
CREATE UNIQUE INDEX CONCURRENTLY uq_cdp_events_purchase_order ON cdp_events (company_id, source, (properties->>'order_id')) WHERE event_name = 'purchase';
```

### C71-ENV-3 · MALL_CONSENT_ENFORCE_COMPANY_IDS 없앰(미설정 = *)
- 카드: C71
- 단계: ENV
- 선행: C71-S5 섞인 회사 0
- 의미 바꿈: 예(미설정 = 전 회사 · 끄기 = off)
- 확인: 프로세스 env 에 그 이름 없음(재시작 = restart --update-env)
- 결과: 1028 사전 확인 · packages/backend/.env 에 그 줄 1 · pm2 env 에는 없음(dotenv 가 부팅 때 .env 를 읽음) → 코드 배포 재시작 전에 .env 줄을 지우면 그 재시작 한 번으로 닫힘(값은 지우기 직전 출력으로 남김) · **1028 08:3x 닫힘** · 지우기 전 값 = 19c59d0c-77d3-4e52-9ceb-9a47a3c37e49(S5 의 분류코드 회사 하나 = 지금 실효 변화 0 · 앞으로 분류코드 회사는 기본 적용) · left=0 · restart --update-env · online uptime 15s · 되돌리기 = 그 줄을 .env 에 다시 넣고 restart --update-env

### C73-S3 · active 인데 connected_at NULL 인 카페24 · 아임웹 · 네이버 행(사전 실측)
- 카드: C73
- 단계: 사전
- 선행: 없음
- 기대: 0(0 이 아니면 그 행만 DML-3 connected_at = updated_at · K6 수신 자격 조각이 connected_at NULL 행의 웹훅을 뺀다)
- 확인: 결과 표(provider · 행 수 · id 목록)
- 결과: 1028 Harold 실행 · 0행(cafe24 · imweb · naver_smart_store) → DML-3 없음

### C73-S16 · SDK v0.3.5 요청 수(사전 실측 · M25)
- 카드: C73
- 단계: 사전
- 선행: 없음
- 기대: 최근 30일 nginx 접근 로그에서 /sdk/v0.3.5/ · /api/cdp/sdk/v0.3.5/ 요청 수와 Referer 호스트(0 이면 SERVED_SDK_VERSIONS 에서 v0.3.5 를 빼는 다음 배포)
- 확인: 수 · 호스트 목록
- 결과: 1028 Harold 실행 · 남은 접근 로그 전부(access.log*) 0건 → 다음 배포에서 v0.3.5 닫음

### C73-ENV-0 · PUBLIC_BASE_URL 값(사전 확인 · M24 확정 화면 주소)
- 카드: C73
- 단계: ENV
- 선행: 없음
- 기대: 비었거나 https://hanjul.ai(몰 승인 콜백이 로그인된 화면 /oauth-confirm 으로 돌려보내는 주소 · 다른 값이면 확정 화면에 못 닿는다)
- 확인: 그 한 줄 출력(비밀 값 아님)
- 결과: 1028 Harold 실행 · spawn 없음 · .env 비어 있음 → 기본값(https://hanjul.ai) · 그대로

### C73-ENV-1 · CDP_PLUGIN_KEY_SECRET(우커머스 플러그인 키 비밀 · K8)
- 카드: C73
- 단계: ENV
- 선행: 코드 배포
- 의미 바꿈: 예(없으면 플러그인 키 발급 503 · 플러그인 회원 토큰 0)
- 기대: 32자 이상 · JWT_SECRET 과 다른 값(값 = Harold 생성 · 출력 0)
- 확인: 길이만 출력 · restart --update-env 뒤 플러그인 키 발급 200
- 결과: 1028 Harold 실행 · 서버 openssl 64자 · .env 백업 .env.bak-1028 · reload --update-env(online · restarts 12) · 백업 = 비밀번호 관리자 메모(gpg 백업 파일은 백업 키 암호 불일치로 복호 시험 실패 · 서버 ~/backups/keys/cdp-keys-1028.env.gpg 는 남음) · 플러그인 키 발급 200 = 실측 대기

### C73-ENV-2 · CDP_SECRET_BOX_KEY(몰 연동 자격 암호화 키 · K8)
- 카드: C73
- 단계: ENV
- 선행: 코드 배포(읽기 이중 판이 먼저 돈다)
- 의미 바꿈: 예(넣은 뒤 새로 쓰는 자격 = 암호문 · 그 뒤로는 secret-box 없는 판으로 코드를 되돌리지 않는다 · 키를 지우지 않는다)
- 기대: 32바이트(hex 64자 또는 base64) · 같은 날 키 백업 · 복호 시험(백업 키 당일 복호 규칙)
- 확인: 부팅 로그에 「CDP_SECRET_BOX_KEY 없음」 경고 0
- 결과: 1028 Harold 실행 · 같은 명령으로 64자(hex) 넣음 · reload 뒤 부팅 경고 0(남은 경고 1줄 = 19:58:06 코드 배포 부팅 · 키 넣기 19:59 전) · 키 백업 = 비밀번호 관리자(Harold 저장 확인)

### C73-S8 · 자체호스팅 회사별 sdk 연결 수 · 브라우저 SDK identify 사용 여부(사후 실측 · Codex R4 #1)
- 카드: C73
- 단계: 사후
- 선행: C73-DDL-4
- 기대: 회사별 source = 'sdk' 연결 수 · server_verified_at 있는 수 · 그 회사가 브라우저 SDK 로 identify 를 부른 적이 있는가(고객사 확인). 브라우저 identify 를 쓴 적 없는 회사 = 그 회사의 sdk 연결 전부가 서버 비밀키 호출이 만든 것 → 그 회사만 server_verified_at 을 채우는 DML(회사 id 조건 · 고객사 확인 뒤 · SQL 원문은 그 창에서) · 쓴 적 있는 회사 = 채우지 않음(옛 브라우저 연결은 근거가 아니다 · 새로 만드는 연결부터 확인)
- 확인: 결과 표
- 결과: 1028 20:1x Harold 실행 · sdk 연결 = 테스트계정 한 곳 2,077 · verified 0(배포 직후 정상) · 고객사 0곳 → 채우는 DML 없음

### C73-DML-2 · 몰 연동 자격 다시 쓰기(암호문 · K8)
- 카드: C73
- 단계: DML
- 선행: C73-ENV-2 · C73-DDL-2 · 백업
- 의미 바꿈: 예(평문 → 암호문 · 되돌림 = 같은 스크립트 --reverse)
- 기대: packages/backend 에서 npx ts-node scripts/seal-integration-secrets.ts · 실패 0 · 건너뜀 0(건너뜀이 있으면 다시)
- 백업: 그 표 pg_dump -t company_integrations
- 확인: 출력 한 줄(행 · 바꿈 · 건너뜀 · 실패) · 다시 돌리면 바꿈 0
- 결과: 1028 20:06 Harold 실행 · 백업 ~/backups/dml/company_integrations-1028-before-seal.sql.gz(600 · 4,574바이트) · 1차 행 11 · 바꿈 11 · 건너뜀 0 · 실패 0 → 2차 바꿈 0 · 이 뒤 코드 되돌림 = --reverse 먼저(되돌림 최저판)

### C74-Q-D3 · 직접 발송 상태 값 분포(사전 실측 · K8 사람이 보낸 발송)
- 카드: C74
- 단계: 사전
- 선행: 없음
- 기대: 완료 상태 값이 'completed' 인가(코드 `utils/human-sent-messages.ts` 91 이 그 값만 읽는다 · 다른 값이 크면 그 값을 더하는 코드 수정 뒤 배포)
- 확인: 결과 표 그대로 · SQL = `SELECT status, COUNT(*) FROM campaigns WHERE send_type = 'direct' AND created_at >= NOW() - INTERVAL '180 days' GROUP BY 1 ORDER BY 2 DESC;`
- 결과: 1028 Harold 실행 · completed 30,140 · cancelled 368 · scheduled 32 · failed 27 → 완료 값 = completed 확정 · 코드 수정 0

### C74-ENV-1 · TRAINING_HMAC_SECRET 이 백엔드 프로세스 env 에 있는가(사전 확인 · K15 · V19)
- 카드: C74
- 단계: 사전
- 선행: 없음
- 기대: 있음 1 = 코드 기본값 줄(`utils/training-logger.ts` 26) 삭제 · 키 없으면 시작 거부로 바꾸는 코드 수정(다음 배포) / 없음 0 = 키 교체 = 재해시 이관 스크립트와 한 묶음(설계서 §3 ENV-1)
- 확인: 개수만(값은 찍지 않는다 · 명령 = 그 창에서 실행 위치와 함께 한 줄)
- 결과: 1028 Harold 실행 · spawn_env=0 · dotenv_len=64(packages/backend/.env) → 키 있음 · 운영은 코드 기본값을 안 쓴다 · 다음 배포 = 기본값 줄 삭제 + 키 없으면 시작 거부(재해시 이관 불필요)

### C74-DML-1 · 학습 원장 렌더본 행 정리(여정 · 알림톡 · K10-4)
- 카드: C74
- 단계: DML
- 선행: C74 코드 배포(K10-1 = 템플릿 원문 적재) · --before = 그 배포 시각(그 뒤 템플릿 원문 행은 지우지 않는다)
- 의미 바꿈: 예(지운 행 = 스크립트가 지우기 전에 홈 폴더 jsonl 파일로 남김 · 권한 600)
- 기대: packages/backend 에서 npx ts-node scripts/purge-rendered-training-rows.ts --before=<배포 시각 ISO> = 건수 출력(읽기만) → Harold 확인 → 같은 명령 + --apply --expect=<그 건수>
- 백업: 스크립트 jsonl(지울 행 전부) · 다시 센 수 ≠ expect 면 중단 · 지운 수 ≠ 센 수면 롤백
- 확인: 출력 「N건 지움 · 백업 = 파일」 · 다시 점검하면 0건
- 결과: 1028 20:12 Harold 실행 · 기준 = 코드 배포 부팅 19:58:06 KST · 점검 = 출처 캠페인 139 · 97건(LMS 16 · KAKAO 81) → --apply --expect=97 = 97건 지움 · 백업 ~/purge-rendered-training-2026-10-28T11-12-36-686Z.jsonl · 스크립트가 끝에 MySQL 연결을 안 닫아 종료하지 않음(Ctrl+C · 결과 무관 · 다음 배포에 process.exit 추가 = 추가 과제)

### C76-G1 · 싱크에이전트 1.7.3 을 서버에 올리지 않는다(엠티 개별 전달 · 다른 회사 영향 0)
- 카드: C76
- 단계: 출고
- 선행: 없음(서버 P3 코드는 백엔드 배포로 나간다 · 에이전트보다 먼저 나가도 무해 · DDL 0 · ENV 0)
- 기대: `npm run upload:releases` · 슈퍼관리자 릴리즈 등록 · `npm run upload:agents`(`build:tiers:deploy`) 셋 다 하지 않는다 · `CURRENT_AGENT_VERSION` 1.7.2 그대로 · 엠티 zip = VM 재검증(Harold 승인) 뒤 개별 전달
- 확인: 배포 창 SQL `SELECT version, tier, is_active FROM sync_releases WHERE is_active ORDER BY released_at DESC LIMIT 5;` 에 1.7.3 없음
- 결과:

### C77-ENV-1 · INTERNAL_TEST_COMPANY_IDS(사내 시험 회사 운영 경보 제외 · B-1028-3)
- 카드: C77
- 단계: ENV
- 선행: 코드 배포
- 의미 바꿈: 예(목록의 회사 일 = 운영 경보 문자 0 · 로그 「사내 회사 경보 생략」 한 줄만 · 비어 있으면 시연 회사만 = 지금 동작)
- 기대: 쉼표로 이은 회사 uuid · 테스트계정 a0990249-3550-4baa-92ca-32e45b185e83 (그 밖 사내 회사 = Harold 확인 뒤 더함) · 비밀값 아님
- 확인: restart --update-env 뒤 프로세스 env 에 그 이름이 있는가(값 길이만) · 다음 테스트계정 경보가 문자 대신 로그 한 줄로 남는가

### C79-DDL-1 · continuous_operators.voice_form(목소리 꼴 칸 결정 · B-1029-3)
- 카드: C79
- 단계: DDL
- 선행: 코드 배포
- 의미 바꿈: 아니오(칸 추가 · 넣기 전 = 결정이 있는 자동마케팅 등록 · 승인만 「DB 마이그레이션 필요」 · 기존 등록 · 회차 그대로)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'continuous_operators' AND column_name = 'voice_form';
- 확인: voice_form · jsonb 한 줄
- 결과: 1029 Harold 실행(백엔드 · 프론트 배포 뒤) · SET · ALTER TABLE · voice_form | jsonb 1 row

> C79-DDL-1 · 자동마케팅 목소리 꼴 칸 결정 칸(배포 뒤 · 넓힘 · 되돌리기 = 남겨도 무해)

```sql ddl:C79-DDL-1
SET lock_timeout = '3s';
ALTER TABLE continuous_operators ADD COLUMN IF NOT EXISTS voice_form jsonb NULL;
```

### C80-G1 · 싱크에이전트 1.7.4(Node 24.22.1 · 마법사 이 PC 전용)를 서버에 올리지 않는다(엠티 개별 전달 · 다른 회사 영향 0)
- 카드: C80
- 단계: 출고
- 선행: 없음(서버 코드 변경 0 · 바뀐 백엔드 파일 = 계약 시험 root-ledger.test.ts 한 개 · DDL 0 · ENV 0)
- 기대: C76-G1 과 같다 — `npm run upload:releases` · 슈퍼관리자 릴리즈 등록 · `npm run upload:agents`(`build:tiers:deploy`) 셋 다 하지 않는다 · `CURRENT_AGENT_VERSION` 1.7.2 · 서버 룰표 `agent-build-tiers.ts` modern `node: 20` 그대로(서버가 내주는 1.7.2 를 설명 · Node 24 판을 서버에 올리는 날 같은 배포에 24 로) · 엠티 zip(`Downloads\엠티콜렉션_SyncAgent_v1.7.4\`) = VM 재검증(Harold 승인) 뒤 개별 전달 · 1.7.3 폴더는 보내지 않는다
- 확인: 배포 창 SQL `SELECT version, tier, is_active FROM sync_releases WHERE is_active ORDER BY released_at DESC LIMIT 5;` 에 1.7.3 · 1.7.4 없음
- 결과:

### C81-G1 · 싱크에이전트 1.7.5(Oracle · PG 표준 날짜 칸 하루 당김 정정)를 서버에 올리지 않는다(엠티 개별 전달 · 다른 회사 영향 0)
- 카드: C81
- 단계: 출고
- 선행: 없음(서버 코드 변경 0 · 바뀐 파일 = sync-agent 만 · DDL 0 · ENV 0)
- 기대: C80-G1 과 같다 — `npm run upload:releases` · 슈퍼관리자 릴리즈 등록 · `npm run upload:agents`(`build:tiers:deploy`) 셋 다 하지 않는다 · `CURRENT_AGENT_VERSION` 1.7.2 그대로 · 엠티 전달본 = `Downloads\엠티콜렉션_SyncAgent_v1.7.5\`(zip sha256 `494d081d3467ed88ed7bbc312dfd8ce19b04326a10ae44cc17777b4bbc5ab58c` · 안내서 PDF 11쪽) · 1.7.4 · 1.7.3 폴더는 보내지 않는다(1.7.4 = 날짜 결함)
- 확인: 배포 창 SQL `SELECT version, tier, is_active FROM sync_releases WHERE is_active ORDER BY released_at DESC LIMIT 5;` 에 1.7.3 · 1.7.4 · 1.7.5 없음
- 결과:

### C83-S1 · 공지 판정 · 집계 쿼리 실행 계획(운영 · 배포 뒤 · 설계서 §5 2-1)
- 카드: C83
- 단계: 사후
- 선행: 5264fa99 배포(끝)
- 기대: 판정 SQL = `idx_audit_logs_user` Index Cond 에 user_id · created_at 함께 · 50ms 이하 / D 집계 = 2초 이하 · 넘으면 색인 설계(설계서 §5 2-1)
- 확인: Harold 실행 · 명령은 그 시각에 하나씩(공지 시작 뒤 감사 기록이 가장 많은 사람 계정 → 그 계정으로 판정 SQL `EXPLAIN (ANALYZE, BUFFERS)` → D 집계 `EXPLAIN (ANALYZE, BUFFERS)`)
- 결과:

### C83-S2 · 공지 후속 배포(구현 2R · 3R · 4R 수정분 + D 10개씩 · 확인한 업체 먼저)
- 카드: C83
- 단계: 사후
- 선행: 커밋(작업 트리 = SecurityNoticeCard.tsx · SecurityReportPage.tsx · security-report.ts · CustomerNoticeAckTab.tsx · customer-notice.ts(정렬) · customer-notice-1029.test.ts)
- 기대: 백엔드(정렬 한 곳 · reload) + 프론트(build:safe) · DDL 0 · ENV 0 · 배포본 C 문구 = 「교체한 뒤 서비스가 정상 동작하는 것을 확인했습니다」(1차 배포본의 「로그인, 발송, 결과 조회」 문장 사라짐) · D = 10개씩 · 기본 전체 · 확인한 업체가 1쪽 먼저 · 「확인한 업체」 버튼
- 확인: 배포 뒤 hanjul.ai `/security-report` 화면 문구 · 슈퍼관리자 공지 확인 현황 1쪽 10개 · 쪽 번호 · 고객 계정 로그인 때 B 카드 · 「확인했습니다」 뒤 카드 사라짐
- 결과: 커밋 76605ad7(19:40) · 18cc05e2(1029 밤) · 배포 = Harold 1030 「세션 마무리하자」로 완료로 받음(메모리 session_wrap_means_deployed) · 서버 머리 = 1031 Harold 출력 18cc05e2 로 맞춤(pulled · deployed_head)

### C82-S1 · 싱크 키 발급 = 설치 서버 공인 IP 필수 · 출발지 등록 한 번에(배포 뒤 실측 · 테스트계정)
- 카드: C82
- 단계: 사후
- 선행: 코드 배포(백엔드 + 프론트 · DDL 0 · ENV 0 · 새 컬럼 0)
- 기대: 슈퍼관리자 테스트계정 고객사 상세 Sync 탭 = 「접속 허용 IP」 칸이 뜬다 · 「API Key 재발급」 확인 칸에 「설치 서버 공인 IP」(빈 칸이면 확인 잠김 · 192.168 같은 사설 주소는 사유와 함께 거절) · 시험 PC 공인 IP 로 재발급 = 완료 알림에 「접속 허용 IP … 를 국외 접근 통제에 함께 등록했습니다」 · 칸에 그 IP 한 줄(사유 「싱크에이전트 키 발급 출발지」) · 설계서 `docs/2026-10-29-sync-key-origin-required-design.md` §2
- 확인: 배포 창 SQL `SELECT host(a.cidr) AS ip, a.reason, a.is_active, a.created_at FROM access_origin_allowlist a JOIN users u ON u.company_id = a.company_id WHERE u.login_id = 'hoyun' AND a.scope = 'company_agent' ORDER BY a.created_at DESC LIMIT 5;` 맨 위 = 방금 넣은 IP · 활성
- 결과:

### C84-S1 · 여정 담당자 안내 실측(배포 뒤 1건 · 테스트계정)
- 카드: C84
- 단계: 사후
- 선행: C84-DDL-2 · 코드 배포 · C84-DDL-1
- 기대: 테스트계정에서 1번 칸 「바로」 · 문자 칸 여정을 켜고 시험 고객 1명 진입 → 첫 발송이 10~20분 미뤄지고 그 전에 「[발송 전 안내]」(바로 보내는 칸 줄 · 짧은 정지 주소)가 만든 계정 번호로 옴 → 그 뒤 고객 문자 → 결과가 나오면 「[여정 발송 결과]」 1통 · 같은 날 두 번째 고객은 미루지 않고 바로
- 확인: 배포 창 SQL(안내 기록 · 큐 행 · 결과 기록) · 그 시각에 하나씩
- 결과:

### C85-S1 · 추천 타겟 날짜 칸 · 주소록 더하기 실측(배포 뒤 · 테스트계정)
- 카드: C85
- 단계: 사후
- 선행: 코드 배포(백엔드 + 프론트 · DDL 0 · ENV 0)
- 기대: ① 한줄로 「다음 달 생일 고객」 제안 → 추천 타겟 상세 「추출 대상 리스트 보기」 생일 칸 = `YYYY-MM-DD`(시각 꼬리 0 · DB 값 그대로) ② 직접발송 직접입력 번호 1개 → 주소록 [발송 목록에 더하기] → 직접입력 번호가 남고 주소록 번호가 뒤에 붙음 · 알림 「N명을 지금 명단에 더했어요」 ③ 알림톡 창 [중복제거] 켜짐 = 이미 있는 번호는 「중복 M명 제외」 · 설계서 `docs/2026-10-31-target-date-addressbook-append-design.md`
- 확인: 화면(Harold · 테스트계정) · 서버 명령 0
- 결과:

### C86-S1 · AI 오퍼레이터 되묻기 링크 실측(배포 뒤 · 테스트계정)
- 카드: C86
- 단계: 사후
- 선행: 코드 배포(백엔드 + 프론트 · DDL 0 · ENV 0)
- 기대: ① AI 오퍼레이터 AI 한줄로에 주소가 든 한 줄(예: 「가을 신상 할인 문자 https://테스트계정 쇼핑몰 주소」) → 되묻기 단계에 「문자에 넣을 링크 주소」 칸이 그 주소로 미리 채워져 있음 → 만들기 → 문안마다 그 주소 한 번 · 채널 SMS 였으면 결과 카드 LMS ② 주소 없는 한 줄 + AI 가 링크를 물으면 그 칸에 `www.` 주소를 적어도 받음 → 문안에 적은 그대로 `www.…`(Harold 1031 「적은 그대로 넣기」) ③ 링크를 등록한 회사(테스트계정에 브랜드 링크 1개)로 만들기 → 문안에 등록 링크 주소(지금은 사라짐) ④ 결과 카드 꾸미기 · 다듬기 뒤에도 주소 그대로 · 설계서 `docs/2026-10-31-ai-line-answer-link-design.md` ⑤ 뒤로가기: 빠진 정보 질문에 답한 뒤 확인 판에서 「‹ 빠진 정보」 → 적은 답이 칸에 그대로 · 고쳐 다음 → 확인 판(대상 · 칼럼 그대로) · 카톡 한 줄이면 빠진 정보에서 「‹ 채널」
- 확인: 화면(Harold · 테스트계정) · 서버 명령 0
- 결과:

### C87-S1 · 이미지 스튜디오 새 제작 = 입력 칸 처음으로(배포 뒤 · 테스트계정)
- 카드: C87
- 단계: 사후
- 선행: 코드 배포(프론트 · DDL 0 · ENV 0)
- 기대: 포스터 하나 만들기(문구 · 장면 힌트 · 상품) → 「템플릿으로」 → 같은 템플릿 또는 다른 템플릿 고르기 → 문구 칸 = 그 템플릿 기본 문구 · 장면 힌트 · 상품 = 비어 있음 / 결과 화면 「문구·상품 수정」 = 방금 넣은 값 그대로
- 확인: 화면(Harold · 테스트계정) · 서버 명령 0
- 결과:

### C88-S1 · 이미지 스튜디오 예시 서빙본 미리 만들기 · 새 템플릿 예시 생성(배포 뒤 · 서버 안)
- 카드: C88
- 단계: 사후
- 선행: 백엔드 배포(build:safe + reload · 프론트 무변경 · DDL 0 · ENV 0)
- 기대: ① `scripts/studio-samples.ts warm` = 기존 582장 서빙본(1400px) 미리 만듦 · 원본 합 1.5GB → 서빙본 합 출력(AI 0) ② `make 20` = 첫 20장 · 첫 줄 엔진 이름 · 실패 3 이면 멈춤 → Google 청구로 장당 값 대조 ③ 나머지 `make 180` · 끝 줄 「남은 예시 없는 템플릿 0개」 · 봄 · 여름 두 장은 파일 자체가 갈라져 있으면 옆 폴더로 옮긴 뒤 `make 2 fashion-spring-outing,fashion-summer-resort`
- 확인: 서버 출력(Harold) · 화면 = 갤러리 첫 쪽 카드가 바로 뜸 · 쇼핑몰·상품컷 · 신상·기획전 탭 · 패션 세부 아우터 · 상의 · 하의·원피스 · 뷰티 세부 보습 예시 그림
- 결과: ① warm 1101 = 582장 원본 합 1473.8MB → 서빙본 합 199.3MB(한 장 평균 2.5MB → 0.3MB · Harold 출력) ② make 200 = GPT 로 시작 → Harold 1101 「이번까지만 제미나이」로 멈추고 STUDIO_IMAGE_ENGINE=gemini 로 다시 띄움(GPT 로 이미 만든 장은 그대로) · 진행 중

### C89-DDL-1 · journeys.copy_facts(여정 사람 값 원장 · 설계서 2026-11-01-journey-recurrence-prevention-design.md §4 DDL-A)
- 카드: C89
- 단계: DDL
- 선행: 코드 배포
- 의미 바꿈: 아니오(칸 추가 · 넣기 전 = 원장 안 정함 = 옛 동작 · 채우기 주소만 「DB 마이그레이션 필요」)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'journeys' AND column_name = 'copy_facts';
- 확인: copy_facts · jsonb 한 줄
- 결과: 1101 Harold 실행(배포 d6e05ff5 뒤) · 출력 SET · ALTER TABLE · 통합 확인 SQL 12행 중 `journeys.copy_facts | jsonb` → 기대값 같음

> C89-DDL-1 · 배포 뒤 · 넓힘 · 되돌리기 = 남겨도 무해

```sql ddl:C89-DDL-1
SET lock_timeout = '3s';
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS copy_facts jsonb NULL;
```

### C89-DDL-2 · spam_filter_test_results 첫 판정 · 확정 시각 · 확정 뒤 수신(설계서 §4 DDL-B)
- 카드: C89
- 단계: DDL
- 선행: 코드 배포
- 의미 바꿈: 아니오(칸 추가 · 넣기 전 = 판정은 그대로 · 기록과 하루 측정만 건너뜀)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'spam_filter_test_results' AND column_name IN ('first_result', 'decided_at', 'late_report_at') ORDER BY 1;
- 확인: decided_at · first_result · late_report_at 세 줄 · result 칸 CHECK 제약 없음(시험 DB 1101 확인 · 운영은 같은 확인 SQL 로)
- 결과: 1101 Harold 실행 · 출력 SET · ALTER TABLE · 통합 확인 SQL = decided_at · late_report_at timestamp with time zone · first_result character varying · spam_filter_test_results CHECK 제약 0행(pg_constraint contype 'c') → 기대값 같음

> C89-DDL-2 · 배포 뒤 · 넓힘 · 되돌리기 = 남겨도 무해

```sql ddl:C89-DDL-2
SET lock_timeout = '3s';
ALTER TABLE spam_filter_test_results
  ADD COLUMN IF NOT EXISTS first_result varchar(20) NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS late_report_at timestamptz NULL;
```

### C89-DDL-3 · spam_test_probes(스팸 검사 확인 문자 · 설계서 §4 DDL-C)
- 카드: C89
- 단계: DDL
- 선행: 코드 배포
- 의미 바꿈: 아니오(새 표 · 만들기 전 = 확인 문자 0 · 창 닫힌 확인 중 = 검사 장애 + 경보)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT table_name FROM information_schema.tables WHERE table_name = 'spam_test_probes';
- 확인: spam_test_probes 한 줄
- 결과: 1101 Harold 실행 · 출력 SET · CREATE TABLE · CREATE INDEX × 2 · 통합 확인 SQL = spam_test_probes table · idx_spam_test_probes_open · idx_spam_test_probes_device index → 기대값 같음

> C89-DDL-3 · 배포 뒤 · 새 표 · 되돌리기 = 남겨도 무해(코드가 표 없음으로 돌아간다)

```sql ddl:C89-DDL-3
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS spam_test_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL UNIQUE REFERENCES spam_filter_test_results(id) ON DELETE CASCADE,
  phone varchar(20) NOT NULL,
  carrier varchar(20) NOT NULL,
  nonce varchar(12) NOT NULL,
  message_hash varchar(64) NOT NULL UNIQUE,
  status varchar(12) NOT NULL CHECK (status IN ('claimed', 'sent', 'received', 'expired')),
  attempts smallint NOT NULL DEFAULT 1,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  deadline_at timestamptz NULL,
  decided_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_spam_test_probes_open ON spam_test_probes (status, deadline_at) WHERE status IN ('claimed', 'sent');
CREATE INDEX IF NOT EXISTS idx_spam_test_probes_device ON spam_test_probes (phone, carrier);
```

### C89-DDL-4 · spam_filter_devices.last_body_report_at(본문 보고 단말 · 설계서 §4 DDL-E)
- 카드: C89
- 단계: DDL
- 선행: 코드 배포
- 의미 바꿈: 아니오(칸 추가 · 넣기 전 = 확인 문자 0 · 보고 경로는 last_seen_at 만 · 503 없음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'spam_filter_devices' AND column_name = 'last_body_report_at';
- 확인: last_body_report_at · timestamp with time zone 한 줄
- 결과: 1101 Harold 실행 · 출력 SET · ALTER TABLE · 통합 확인 SQL = `spam_filter_devices.last_body_report_at | timestamp with time zone` → 기대값 같음

> C89-DDL-4 · 배포 뒤 · 넓힘 · 되돌리기 = 남겨도 무해

```sql ddl:C89-DDL-4
SET lock_timeout = '3s';
ALTER TABLE spam_filter_devices ADD COLUMN IF NOT EXISTS last_body_report_at timestamptz NULL;
```

### C89-DDL-5 · journey_pretest_candidates(여정 보내기 전 재작성 후보 · 설계서 §4 DDL-D)
- 카드: C89
- 단계: DDL
- 선행: 코드 배포
- 의미 바꿈: 아니오(새 표 · 만들기 전 = 확정 차단에서 재작성 없이 여정 정지 · 차감 0)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT table_name FROM information_schema.tables WHERE table_name = 'journey_pretest_candidates';
- 확인: journey_pretest_candidates 한 줄
- 결과: 1101 Harold 실행 · 출력 SET · CREATE TABLE · 통합 확인 SQL = journey_pretest_candidates table → 기대값 같음

> C89-DDL-5 · 배포 뒤 · 새 표 · 되돌리기 = 남겨도 무해

```sql ddl:C89-DDL-5
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS journey_pretest_candidates (
  snapshot_id uuid PRIMARY KEY REFERENCES journey_step_snapshots(id) ON DELETE CASCADE,
  step_id uuid NOT NULL,
  body text NULL,
  subject text NULL,
  check_key varchar(64) NULL,
  status varchar(12) NOT NULL CHECK (status IN ('generating', 'testing', 'passed', 'blocked', 'failed')),
  claim_token uuid NULL,
  claimed_at timestamptz NULL,
  regen_count smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### C89-S1 · 여정 재발 방지 배포 1 실측(배포 뒤 · 테스트계정)
- 카드: C89
- 단계: 사후
- 선행: 코드 배포 · C89-DDL-1~5
- 기대: 설계서 docs/2026-11-01-journey-recurrence-prevention-design.md §9 배포 1 · 회귀 두 줄 그대로(질문표 혜택 「첫 구매 10% 할인쿠폰」 + 링크 여정 = 칸마다 혜택 · 링크 · 자리표시 0 / 늦은 통신사 = 「확인 중 · n분째」 → 통과 / 확인 중 회차 다음 회차 = 새 검사 0 · 차감 0)
- 확인: 화면 · 그 시각 SQL 하나씩
- 결과:

### C92-S1 · 여정 작업 화면 후속 실측(화면 전체 · 휴대폰 280 · 최대 인원 선택 · 날짜 기준 · 한 번 보내기 대상 전원 · 배포 뒤 · 테스트계정)
- 카드: C92
- 단계: 사후
- 선행: 코드 배포(DDL 0)
- 기대: ① 여정 작업 화면 = 창이 화면 전체(둥근 모서리 0) · 큰 화면은 작업대 가운데 1360 · 휴대폰 틀 280 · PC 글 13 ② 켜기 확인 창 · 일괄 켜기에서 최대 인원을 비우면 위험 안내 한 줄 · 비운 채 켜짐(저장값 NULL) ③ 상한을 비운 한 번 보내기 · 날짜 기준 여정 = 대상 수 = 실행 수(B-1101-7 ①② · 10만 넘는 실 사례는 운영에 없음 · 실 PG 시험이 묶음 3 으로 7명 전원 확인)
- 확인: 화면 · 테스트계정 여정 하나 켠 뒤 그 여정의 실행 수 SQL 하나(docker exec 포함 한 줄로 드린다)
- 결과:

### C91-S1 · 여정 재발 방지 배포 2 실측(3단 칸 화면 · 점검 판 · 칸 저장 뒤 자동 스팸 검사 · 메모리 · AI 출구 · 배포 뒤 · 테스트계정)
- 카드: C91
- 단계: 사후
- 선행: 코드 배포(DDL 0)
- 기대: 설계서 docs/2026-11-01-journey-recurrence-prevention-design.md §9 배포 2 그대로(3단 화면 1440 · 1280 · 390 / 점검 판 판정 문장 = 켜기 칩 = 레일 점 / 칸을 저장하면 20초 안팎에 점검 판 「검사 중」 → 통과 · 같은 날 같은 글 다시 저장 = 새 차감 0 / 메모리 = 목소리 없는 회사 생성 지시문에 메모리 블록(로그 길이만 · 원문 출력 금지) / AI 다듬기 결과에 「고칠 것」 줄)
- 확인: 화면 · 그 시각 SQL 하나씩(차감 = 크레딧 · 선불 원장 그 시각)
- 결과:

### C90-S1 · 크레딧 컨트롤타워 사전 실측(이력 없는 회사 · 미래 · 소급 적용일 · 후불 11월 리셋 전 초과 · 리셋 시각 없는 잔액 · 결제 방식 값)
- 카드: C90
- 단계: 사전
- 선행: 없음
- 기대: ② 미래 0 · ③ 0행 · ④ 0 · ⑤ prepaid · postpaid 두 줄뿐 · ⑥ not_first_row 전부 0 · 11월 날짜 줄 0 · ⑦ 0 · ⑧ 0행(설계서 docs/2026-11-01-credit-control-tower-design.md §9 사전 SQL ①~⑧ · ① 은 수를 보고 대체값 대상만 기록)
- 확인: 여덟 결과 그대로(SQL 원문 = 설계서 §9)
- 결과: 1101 Harold 실행 ①~⑤ · ① 0 · ② 미래 0 · 소급 141 · ③ 0행 · ④ 0 · ⑤ postpaid 89 · prepaid 59 → ②~⑤ 기대값 같음 · 소급 141 은 ② SQL 이 전 기간을 세어 판정 못 함 → ⑥~⑧ 추가(시험 그릇 칸 · 문법 + 손 이력 기대값 같음) · ⑥ 2026-07-26 141 · not_first 0(표 신설 기준선 행) · ⑦ 0 · ⑧ 0행 → 기대값 같음

### C90-DDL-1 · ai_credit_transactions.seq(원장 순번) · plan_month_credits(그 달 월 크레딧 고정표) · ★ 배포 앞
- 카드: C90
- 단계: DDL
- 선행: C90-S1
- 의미 바꿈: 아니오(칸 · 표 추가만 · seq 는 기본값 없음 = 옛 코드 줄은 seq 없음 · 옛 코드는 이 칸 · 표를 읽지도 쓰지도 않는다 · 새 코드는 원장 INSERT 마다 nextval 로 채우므로 **배포 앞**에 넣는다 = 새 줄은 언제나 seq · Codex 구현 5R 구조 처방)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'ai_credit_transactions' AND column_name = 'seq'; SELECT table_name FROM information_schema.tables WHERE table_name = 'plan_month_credits';
- 확인: seq 한 줄(column_default 비어 있음 = 정상 · 새 코드가 nextval 로 채운다) · plan_month_credits 한 줄
- 결과: **순서 어긋남** · C90 이 C89 커밋 d6e05ff5(1101 18:43)에 함께 들어가 DDL-1 보다 먼저 배포 → 18:48 1일 지급 패스가 회사마다 「column seq … does not exist」로 실패 · 회사마다 경보 1통(100통 넘음) · 1101 Harold 이 블록 실행 = 세 객체 이미 있음(NOTICE already exists × 3 · 그 전에 넣은 것 = C89 세션이 경보 문자 접수(18:49 화면) 뒤 드린 같은 블록 · Harold 출력 SET · CREATE SEQUENCE · ALTER TABLE · ALTER SEQUENCE · CREATE TABLE · 그 뒤 이번 달 마감 안 된 대상 회사 0 · Harold 실측) · seq column_default 빈칸 · plan_month_credits 1행 → 기대값 같음

> C90-DDL-1 · 배포 앞 · 추가만 · 되돌리기 = 설계서 docs/2026-11-01-credit-control-tower-design.md §7 되돌리기 줄(새 코드를 내린 뒤에만)

```sql ddl:C90-DDL-1
SET lock_timeout = '3s';
CREATE SEQUENCE IF NOT EXISTS ai_credit_tx_seq;
ALTER TABLE ai_credit_transactions ADD COLUMN IF NOT EXISTS seq bigint;
ALTER SEQUENCE ai_credit_tx_seq OWNED BY ai_credit_transactions.seq;
CREATE TABLE IF NOT EXISTS plan_month_credits (
  month      date        NOT NULL,
  plan_code  varchar(20) NOT NULL,
  credits    integer     NOT NULL CHECK (credits >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, plan_code)
);
```

### C90-DDL-2 · ai_credit_tx_company_seq 색인(대조 워커 · 환불 직전 행)
- 카드: C90
- 단계: DDL
- 선행: C90-DDL-1
- 의미 바꿈: 아니오(색인 · 트랜잭션 밖에서 단독 실행)
- 기대: 서버 psql 에서 아래 한 문장 · 확인 = SELECT indexname FROM pg_indexes WHERE tablename = 'ai_credit_transactions' AND indexname = 'ai_credit_tx_company_seq';
- 확인: 한 줄
- 결과: 1101 Harold 실행(C89 세션 안내 · 단독 문장) · 출력 CREATE INDEX · 통합 확인 SQL = ai_credit_tx_company_seq index 한 줄 · indisvalid 거짓 0행 → 기대값 같음

> C90-DDL-2 · 배포 뒤 · 단독 실행(CONCURRENTLY)

```sql ddl:C90-DDL-2
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_credit_tx_company_seq ON ai_credit_transactions (company_id, seq);
```

### C93-S0 · 엔진 재설계 사전 실측(켜진 채 실행 0 인 한 번 보내기 · DDL-1 앞)
- 카드: C93
- 단계: 사전
- 선행: 없음
- 기대: 켜진 한 번 보내기 중 실행 0 인 여정 수 = 0(있으면 DDL-1 이 「넣음」으로 찍기 전에 그 여정을 확인 · 설계서 §5 SC-4)
- 확인: 결과 수 그대로(SQL = 그 창에서 docker 한 줄)
- 결과: 2026-11-02 Harold 실행 · active_one_shot_no_exec = 0

### C93-S1 · 엔진 재설계 실측(배포 뒤 · 테스트계정)
- 카드: C93
- 단계: 사후
- 선행: C93-DDL-1 · C93-DDL-2 · C93-DDL-3 · 코드 배포
- 기대: ① 테스트계정 한 번 보내기 켜기 = 실행 수 = 대상 수 · one_shot_dispatched_at 찍힘 · 넣기 대기 NULL ② 문자 칸 문안을 고치면 그 칸만 검사를 기다리고 통과 뒤 나감 · 담당자 「발송 전 안내」 문자 0 ③ 상황판 주소(주간 요약 또는 직접 발급) = 한눈에 · 여정 · 자동마케팅 · 플래너 메뉴 · 휴대폰 폭 ④ 충전 승인 링크 = 누르면 확인 창 ⑤ 자동마케팅 수정 창 오른쪽 점검 판 ⑥ 배포 뒤 첫 시간 운영 경보에 journey-executor-lag · journey-watcher-budget · spam-queue-lag 0
- 확인: 화면(Harold · 테스트계정) · 그 시각 SQL 하나씩(docker 한 줄)
- 결과: 2026-11-02 배포 bec5d5d5(pull · 백엔드 build:safe · reload 07:45:30 · 프론트 build:safe) · 기동 = 새 워커 시작 줄(weekly-digest · 여정 · 자동마케팅) · 재시작 뒤 오류 로그 0 · 첫 주간 요약 받는 회사 = 주식회사 인비토 하나(켜진 여정 2 · 자동마케팅 0 · 직원이 받아 ③ 확인) · ①②④⑤⑥ 남음

### C93-DDL-1 · journeys 한 번 보내기 넣기 대기 · 넣기 완료 시각(엔진 재설계 E1-2) · ★ 배포 앞
- 카드: C93
- 단계: DDL
- 선행: 없음(배포 앞 · 앞 확인 SQL = 켜진 채 실행 0 인 한 번 보내기 수)
- 의미 바꿈: 아니오(칸 추가 · 옛 코드는 읽지 않는다 · 초안이 아닌 한 번 보내기 = 「넣음」으로 찍어 배포 뒤 다시 뽑지 않는다 · 초안 = NULL 그대로 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md §5)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'journeys' AND column_name IN ('one_shot_dispatch_pending_at', 'one_shot_dispatched_at') ORDER BY 1; + 초안 아닌 한 번 보내기 중 one_shot_dispatched_at NULL 0
- 확인: 두 줄 timestamp with time zone · NULL 0
- 결과: 2026-11-02 Harold 실행 · ALTER TABLE · UPDATE 0 · 두 칸 timestamp with time zone · 초안 아닌 한 번 보내기 NULL 0

> C93-DDL-1 · 배포 앞 · 추가 + 기준선 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C93-DDL-1
SET lock_timeout = '3s';
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS one_shot_dispatch_pending_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS one_shot_dispatched_at timestamptz NULL;
UPDATE journeys SET one_shot_dispatched_at = NOW()
 WHERE start_kind = 'one_shot' AND one_shot_dispatched_at IS NULL AND status <> 'draft';
```

### C93-DDL-2 · manager_weekly_digests(담당자 주간 요약 기록 · 엔진 재설계 E4-2)
- 카드: C93
- 단계: DDL
- 선행: 없음
- 의미 바꿈: 아니오(새 표 · 없으면 주간 요약을 건너뛰고 운영 경보)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT table_name FROM information_schema.tables WHERE table_name = 'manager_weekly_digests';
- 확인: 한 줄
- 결과: 2026-11-02 Harold 실행 · CREATE TABLE · information_schema.tables 한 줄

> C93-DDL-2 · 배포 앞 · 새 표 · 되돌리기 = 남겨도 무해

```sql ddl:C93-DDL-2
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS manager_weekly_digests (
  company_id uuid NOT NULL,
  owner_key  text NOT NULL,
  week_start date NOT NULL,
  attempts   smallint NOT NULL DEFAULT 0,
  sent_at    timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, owner_key, week_start)
);
```

### C93-DDL-3 · journey_pretest_schedules.snapshot_id · notice_sent_at(검사 기록에 검사한 판 · 담당자 안내 원장 · 엔진 재설계 E3-2 · E3-3 · Codex 구현 1R) · ★ 배포 앞
- 카드: C93
- 단계: DDL
- 선행: 없음
- 의미 바꿈: 아니오(칸 추가 · 옛 코드는 넣지 않는다 · 새 코드는 칸이 없으면 검사 스캔을 열지 않고 운영 경보 · 통과한 글은 그대로 나감 · notice_sent_at = 보류 · 지연 안내를 보냈는가(NULL = 보낼 것))
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'journey_pretest_schedules' AND column_name IN ('snapshot_id', 'notice_sent_at') ORDER BY 1;
- 확인: notice_sent_at · timestamp with time zone / snapshot_id · uuid 두 줄
- 결과: 2026-11-02 Harold 실행 · ALTER TABLE · notice_attempts smallint(C84) · notice_sent_at timestamp with time zone · snapshot_id uuid 세 줄

> C93-DDL-3 · 배포 앞 · 넓힘 · 되돌리기 = 남겨도 무해

```sql ddl:C93-DDL-3
SET lock_timeout = '3s';
ALTER TABLE journey_pretest_schedules
  ADD COLUMN IF NOT EXISTS snapshot_id uuid NULL,
  ADD COLUMN IF NOT EXISTS notice_sent_at timestamptz NULL;
```

### C94-DDL-1 · system_alert_pending(경보 원장 · 못 보낸 한 번뿐인 사건 · 설계서 docs/2026-11-01-credit-control-tower-design.md §17-3) · ★ 배포 앞
- 카드: C94
- 단계: DDL
- 선행: 없음(C93 = bec5d5d5 배포 끝 1102)
- 의미 바꿈: 아니오(새 표 · 옛 코드는 읽지도 쓰지도 않는다 · 새 코드는 표가 없으면 사건을 닫지 않고 「경보 원장 표 없음」 경보 = **배포 앞**에 넣는다)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'system_alert_pending' ORDER BY ordinal_position;
- 확인: 8줄(pass text · item_key text · company_id text · error text · title text · action text · total integer · created_at timestamp with time zone)
- 결과: 2026-11-02 Harold 실행 · 출력 SET · CREATE TABLE(already exists 알림 없음 = 새로 만듦) · 확인 SQL 8줄(pass · item_key · company_id · error · title · action = text · total = integer · created_at = timestamp with time zone) → 기대값 같음

> C94-DDL-1 · 배포 앞 · 새 표 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C94-DDL-1
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS system_alert_pending (
  pass       text        NOT NULL,
  item_key   text        NOT NULL,
  company_id text,
  error      text        NOT NULL,
  title      text        NOT NULL,
  action     text        NOT NULL,
  total      integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pass, item_key)
);
```

### C94-S1 · 크레딧 편입 · 경보 편입 실측(배포 뒤)
- 카드: C94
- 단계: 사후
- 선행: C94-DDL-1 · 코드 배포
- 기대: ① 배포 뒤 첫 시간 백엔드 로그에 `경보 원장 넣기 실패` · `system_alert_pending` 오류 0 ② `SELECT pass, COUNT(*) FROM system_alert_pending GROUP BY pass` = 0행이거나 한 시간 안에 비워짐(쌓이지 않음) ③ AI 사용량 화면 · 크레딧 화면 정상(한도 칸 없음 · 크레딧 사용률) ④ 운영 경보 문자 = 같은 원인 여러 곳이 한 통으로
- 확인: 로그 줄 · SQL 결과 · 화면(Harold)
- 결과: 1차 2026-11-02 11시 5x분 Harold 실행(배포 8372eb16 · 재시작 11:47:50 뒤) · system_alert_pending 0행 · 재시작 뒤 로그(out · err)에 경보 원장 표 · 없는 칸/표 오류(42P01 · 42703) 0줄 → ①② 1차 기대값 같음 · 2차 12:48(재시작 뒤 한 시간) 같은 조회 = 0행 · 0줄 → **①② 닫힘**(첫 한 시간 원장 쌓임 0 · 관련 오류 0) · ③ 화면 정상(Harold 확인 12:5x · /ai-usage = 월 호출 한도 칸 없음 · 크레딧 사용률) · 남은 = ④ 경보 한 통(경보가 생길 때)

### C95-S1 · 엔진 빈칸 묶음 실측(배포 뒤 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md §16)
- 카드: C95
- 단계: 사후
- 선행: 코드 배포(DDL 0 · ENV 0 · 백엔드만)
- 기대: ① 재시작 뒤 백엔드 로그에 직접발송 워커 시작 줄 · `처리 실패` 0 ② 배포 뒤 첫 시간 운영 경보에 direct-send-queue-lag · operator-send-lag · operator-generate-lag 0 ③ 테스트계정 직접발송 1건 = 접수 → 적재 → 완료(campaigns.send_phase 끝 · send_config 에 loadParkedAt · loadChunk 남지 않음 · loadProgress · loadFinalizing 은 종결 기록이라 남는 것이 정상 · `direct-send-worker.ts:936 · 976`) ④ 테스트계정 여정 켜기 확인 창 = 매장번호 확인 정상 · [타겟 확인] 날짜 기준 수에 「+」 없음
- 확인: 로그 줄 · 경보 수 SQL · 화면(Harold · 테스트계정)
- 결과: 2026-11-02 Harold 출력 · ① 워커 시작 줄 12:02:29 · 12:15:28(`회사별 줄 2 + 작은 줄 1 · 몫 120초`) · 12:15:12 종료 신호 `적재 중 0개 … 내려놓고 끝냅니다` · 오류 로그 직접발송 워커 줄 0 ② system_alert_state 밀림 키 셋 0 rows ③ 배포 뒤 직접발송 2건(a2ee5428 · 96822b6c) sent · completed · 1/1 · parked f · in_chunk f · finalizing t · loadProgress sent 1 · 대기열 queued · processing 0 ④ 화면 = 남음 · ★ 12:02:14 백엔드 SIGSEGV(pm2.log `exited … via signal [SIGSEGV]` · 자동 재기동) = .62 메모리 고장 계열(같은 날 11:01 hanjul02 SIGSEGV) · 걸린 캠페인 0

### C96-S0 · 묶음 발송 사전 확인(MySQL 큐 표 엔진 · 같은 계정 다른 연결 처리 목록 · 설계서 docs/2026-11-02-journey-batch-send-design.md 3-8 I1 · I4) · ★ 배포 앞
- 카드: C96
- 단계: 사전
- 선행: 없음
- 기대: 서버 백엔드 폴더에서 ts-node 한 번(지금 도는 백엔드와 같은 MySQL 접속 · smsuser 직접 접속은 1045 거부 = OPS §1) · 출력 `I1 engines [{"engine":"InnoDB",...}]`(InnoDB 한 줄만) · `I4 other-thread visible 1`
- 확인: 두 줄 그대로 · I1 에 InnoDB 밖 엔진이 있으면 그 표 이름 확인(이중 발송 0 은 그대로 · 일부만 든 단위 = 증명 못 함 → 닫음) · I4 가 0 이면 배포하지 않는다(종료 증명이 안 돼 결과 불명 단위가 1시간 뒤 닫힌다 = 다시 안 보냄 · 정산 환불)
- 결과: 2026-11-02 15:08 Harold 실행 · I4 other-thread visible 1(기대값 같음) · I1 = InnoDB 137 + ENGINE null 1 = `SMSQ_SEND` · TABLE_TYPE VIEW(뷰라 자기 엔진 없음 · Harold 두 번째 출력) · 이 카드의 확인 규칙대로 I1 밖 표는 배포를 막지 않는다(이중 발송 0 그대로) · 배포 관문 I4 = 맞음 → DDL-1 로

### C96-DDL-1 · journey_step_campaigns.seq(이어 붙임 순번 칸만 · 새 색인 0 · 설계서 §5 · I6) · ★ 배포 앞
- 카드: C96
- 단계: DDL
- 선행: C96-S0
- 의미 바꿈: 아니오(칸 추가 · 옛 행 = 0 · 3열 기본 키 그대로 = 옛 코드의 `ON CONFLICT (journey_id, step_id, send_date)` 와 그 경합이 지금과 같다 · 새 코드는 칸이 없으면 칸을 뺀 같은 문장 + 운영 경보 journey-step-campaign-seq-missing)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'journey_step_campaigns' AND column_name = 'seq';
- 확인: seq · smallint · 0 · NO 한 줄
- 결과: 2026-11-02 Harold 실행 · SET · ALTER TABLE · `seq | smallint | 0 | NO` 1 row(기대값 같음)

> C96-DDL-1 · 배포 앞 · 칸 추가 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C96-DDL-1
SET lock_timeout = '3s';
ALTER TABLE journey_step_campaigns ADD COLUMN IF NOT EXISTS seq smallint NOT NULL DEFAULT 0;
```

### C96-DDL-2A · journey_step_campaigns 4열 유일 색인(배포 뒤 · 옛 프로세스 0 확인 뒤 · I6)
- 카드: C96
- 단계: DDL
- 선행: C96-DDL-1 · 코드 배포 · pm2 status 로 새 프로세스 하나(옛 코드 프로세스 0)
- 의미 바꿈: 아니오(색인 추가 · 새 코드의 만들기 = 대상 없는 ON CONFLICT DO NOTHING = 색인이 있든 없든 같은 문장)
- 기대: 서버 psql 에서 아래 블록(트랜잭션 밖 · 그 문장 하나) · 확인 = SELECT i.indisvalid FROM pg_index i WHERE i.indexrelid = 'journey_step_campaigns_seq_uidx'::regclass;
- 확인: t 한 줄(f 면 DROP INDEX CONCURRENTLY IF EXISTS journey_step_campaigns_seq_uidx; 뒤 다시)
- 결과: 1103 Harold 실행(C96 · C98 · 이미지 스튜디오 한 배포 3af58654 · 새 PID 2674452 08:47:20 · 옛 프로세스 0) = CREATE INDEX · indisvalid t

> C96-DDL-2A · 배포 뒤 · 색인 추가 · 되돌리기 = DROP INDEX CONCURRENTLY IF EXISTS journey_step_campaigns_seq_uidx;

```sql ddl:C96-DDL-2A
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS journey_step_campaigns_seq_uidx ON journey_step_campaigns (journey_id, step_id, send_date, seq);
```

### C96-DDL-2B · journey_step_campaigns 기본 키 = 4열(이어 붙임 열림 · 배포 뒤 · I6)
- 카드: C96
- 단계: DDL
- 선행: C96-DDL-2A(indisvalid = t)
- 의미 바꿈: 예(같은 날 같은 칸에 순번 1 이상 캠페인을 만들 수 있다 = 증명 못 해 닫은 단위 뒤 이어 붙임 · 옛 코드가 남아 있으면 그 문장이 42P10 = 그래서 옛 프로세스 0 뒤 · 새 코드는 회차마다 pg_index 기본 키 열 수로 연다)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'journey_step_campaigns'::regclass AND contype = 'p';
- 확인: PRIMARY KEY (journey_id, step_id, send_date, seq) 한 줄
- 결과: 1103 Harold 실행 = NOTICE(색인 이름 → journey_step_campaigns_pkey) · SET · ALTER TABLE · 확인 = PRIMARY KEY (journey_id, step_id, send_date, seq)

> C96-DDL-2B · 배포 뒤 · 기본 키 바꿈 · 되돌리기 = 순번 1 이상 행이 0 일 때만 3열 기본 키로(그 SQL 은 그때 따로)

```sql ddl:C96-DDL-2B
SET lock_timeout = '3s';
ALTER TABLE journey_step_campaigns
  DROP CONSTRAINT journey_step_campaigns_pkey,
  ADD CONSTRAINT journey_step_campaigns_pkey PRIMARY KEY USING INDEX journey_step_campaigns_seq_uidx;
```

### C96-S1 · 묶음 발송 · 두 갈래 실측(배포 뒤 · 테스트계정)
- 카드: C96
- 단계: 사후
- 선행: C96-DDL-1 · 코드 배포 · C96-DDL-2A · C96-DDL-2B
- 기대: ① 배포 뒤 첫 회차 백엔드 로그 `[JourneyExecutor] 처리 완료(차례 N)` 줄 · `적재 단위 결과 불명` · `처리 실패` 0 ② 테스트계정 여정 1건 발송 = 그날 단계 캠페인 send_config 에 loadProtocol unit · loadUnit 남지 않음 · journey_step_logs sent 수 = campaigns.sent_count ③ 하루 묶음 여정(회원가입 등)의 새 진입 next_run_at = 다음날 아침 9시(칸 시각을 정했으면 그 시각) · 즉시 여정(구매 · 배송 · 예약)은 지금처럼 ④ 배포 뒤 첫 시간 운영 경보에 journey-step-campaign-seq-missing · journey-unit-unprovable 0
- 확인: 로그 줄 · 그 시각 SQL 하나씩(docker 한 줄) · 화면(Harold · 테스트계정)
- 화면 빌드: 1102 밤 배포에 프론트 build:safe 포함 · 23시 점검 취소로 점검 안내 창은 daab49e1(0a780fa3 되돌림 · 같은 날 15:49 push)에서 지워짐 · 서버 8372eb16 → daab49e1 프론트 순변경 = C96 두 파일뿐(JourneyActivationConfirmModal · JourneyStartCard · `git log --name-only 8372eb16..daab49e1 -- packages/frontend` = 0a780fa3 · 33f049c2 · daab49e1 세 커밋 · 점검 안내 세 파일은 `git log -p` 로 0a780fa3 과 daab49e1 패치가 줄 · 덩어리 머리 모두 정확히 뒤집힘 = 순변경 0 실측) · pull 끝 = daab49e1
- 결과:

### C98-S0 · 여정 · 자동마케팅 핵심 처방 사전 실측(배포 앞 · 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md §5)
- 카드: C98
- 단계: 사전
- 선행: 없음
- 기대: ① 켜진 여정 최신 판에 채울 자리([… 직접 · 작성해 · 수정해 · 입력해 · URL …])가 남은 문자 칸 수(0 이 아니면 그 칸 = 배포 뒤 첫 회차에 보류 · 담당자 안내 · 3-3) ② 「새로 가입한 고객」 축을 쓰는 켜진 자동마케팅 수(0 이 아니면 가입 근거가 생길 때까지 잠금 사유로 멈춤 · 3-6 D20) ③ 최근 7일 시스템 멈춤 여정 수(배포 뒤 첫 5분에 담당자 안내 한 통씩 · 7일 전 멈춤 = DDL-1 기준선 · 3-5 ①) ④ 카페24 가입일 값 꼴 분포(DML-2 의 형 변환 전) ⑤ standard_fields 행(field_key · category · data_type · sort_order · DML-1 전 같은 키 유무)
- 확인: 결과 그대로(SQL = 그 창에서 docker 한 줄씩)
- 결과: 1103 Harold 실행 = ① 0 · ② 0 · ③ 0행(최근 7일 멈춤 없음 = 배포 직후 멈춤 안내 0통) · ④ 0행(카페24 가입일 값 없음 · DML-2 예상 UPDATE 0) · ⑤ 32행 · joined_at 키 없음 · category store · data_type date 있음 · 최대 순서 32. Harold 「자사몰 연동은 전부 테스트 · 이에스페이먼츠만 우커머스 연동 · 여정 생성 없음」

### C98-DDL-1 · journeys 멈춤 안내 원장(pause_notice_for · pause_notice_attempts · 설계서 3-5 ①) · ★ 배포 앞
- 카드: C98
- 단계: DDL
- 선행: C98-S0
- 의미 바꿈: 아니오(칸 추가 · 옛 코드는 읽지 않는다 · 7일보다 오래된 멈춤 = 안내한 것으로 기준선 = 배포 직후 옛 멈춤 안내 0 · 새 코드는 칸이 없으면 안내 패스만 쉬고 운영 경보 journey-pause-notice-ddl)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'journeys' AND column_name IN ('pause_notice_for', 'pause_notice_attempts') ORDER BY 1;
- 확인: pause_notice_attempts · smallint · 0 · NO / pause_notice_for · timestamp with time zone · (빈칸) · YES 두 줄
- 결과: 1103 Harold 실행 = SET · ALTER TABLE · UPDATE 3(7일보다 오래된 멈춤 3 = 안내 마침 기준선) · 확인 두 줄 기대 그대로

> C98-DDL-1 · 배포 앞 · 칸 추가 + 기준선 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C98-DDL-1
SET lock_timeout = '3s';
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS pause_notice_for timestamptz NULL,
  ADD COLUMN IF NOT EXISTS pause_notice_attempts smallint NOT NULL DEFAULT 0;
UPDATE journeys SET pause_notice_for = paused_at
 WHERE status = 'paused' AND paused_at IS NOT NULL AND paused_at < NOW() - INTERVAL '7 days' AND pause_notice_for IS NULL;
```

### C98-DDL-2 · customers.joined_at(가입 근거 · 설계서 3-6 · D19 · D20) · ★ 배포 앞
- 카드: C98
- 단계: DDL
- 선행: C98-S0
- 의미 바꿈: 아니오(빈 칸 추가 · 옛 코드는 읽지 않는다 · 새 코드는 칸이 없으면 가입 근거 없음 = 신규 가입 여정 · 새로 가입 축 잠금)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'joined_at';
- 확인: joined_at · timestamp with time zone · YES 한 줄
- 결과: 1103 Harold 실행 = SET · ALTER TABLE · 확인 한 줄 기대 그대로

> C98-DDL-2 · 배포 앞 · 빈 칸 추가(표 다시 쓰기 0) · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C98-DDL-2
SET lock_timeout = '3s';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS joined_at timestamptz NULL;
```

### C98-DML-1 · standard_fields 「가입일」 행(설계서 3-6 · 표준 필드 = standard-field-map FIELD_MAP 과 같은 키)
- 카드: C98
- 단계: DML
- 선행: C98-S0 ⑤(같은 field_key 행 0 · category 값 확인) · C98-DDL-2
- 의미 바꿈: 아니오(행 추가 · 같은 키가 있으면 아무것도 안 함 · 읽는 곳 = 슈퍼관리자 표준 필드 화면 두 곳) · 서버 명령에 한글을 넣지 않으려고 표시 이름 = U& 이스케이프(= 「가입일」 · 실 PG 대조) · 설명 칸 비움
- 기대: INSERT 0 1 · 확인 = SELECT field_key, display_name, category, data_type, sort_order, is_active FROM standard_fields WHERE field_key = 'joined_at';
- 확인: joined_at · 가입일 · store · date · (맨 끝 순서) · t 한 줄
- 결과: 1103 Harold 실행 = INSERT 0 1 · 확인 = joined_at · 가입일 · store · date · 33 · t

> C98-DML-1 · 배포 앞 · 행 추가 · 되돌리기 = DELETE FROM standard_fields WHERE field_key = 'joined_at';

```sql dml:C98-DML-1
INSERT INTO standard_fields (field_key, display_name, category, data_type, sort_order, is_active)
SELECT 'joined_at', U&'\AC00\C785\C77C', 'store', 'date', COALESCE(MAX(sort_order), 0) + 1, true FROM standard_fields
ON CONFLICT (field_key) DO NOTHING;
```

### C98-DML-2 · 카페24 가입일 → customers.joined_at(배포 뒤 한 번 · 설계서 3-6)
- 카드: C98
- 단계: DML
- 선행: C98-DDL-2 · 코드 배포 · C98-S0 ④(값 꼴 = 시각대 붙은 ISO · 꼴이 다르면 이 블록을 고친 뒤)
- 의미 바꿈: 예(그 회사에 가입 근거가 생겨 신규 가입 여정 켜기 · 새로 가입 축이 열린다 · 옛 가입 시각은 기준선 · 72시간 규칙으로 진입 0)
- 기대: UPDATE n(S0 ④ 의 수 이하) · 확인 = SELECT COUNT(*) FROM customers WHERE joined_at IS NOT NULL;
- 확인: UPDATE 수와 같다(배포 뒤 새 가입이 있으면 그만큼 더)
- 결과: 1103 Harold 실행 = SET · UPDATE 0(S0 ④ 0행과 같음 · 옮길 카페24 가입일 없음)

> C98-DML-2 · 배포 뒤 · 빈 칸 채우기(이른 값만) · 되돌리기 = 채운 행만 되돌리는 블록은 그때 따로(배포 뒤 새 가입 행과 가른다)

```sql dml:C98-DML-2
SET lock_timeout = '3s';
UPDATE customers
   SET joined_at = (custom_fields->>'cafe24_join_date')::timestamptz
 WHERE custom_fields ? 'cafe24_join_date'
   AND custom_fields->>'cafe24_join_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[+-][0-9]{2}:[0-9]{2}$'
   AND (joined_at IS NULL OR joined_at > (custom_fields->>'cafe24_join_date')::timestamptz);
```

### C98-S1 · 여정 · 자동마케팅 핵심 처방 실측(배포 뒤 · 테스트계정 · 직원 시트)
- 카드: C98
- 단계: 사후
- 선행: C98-DDL-1 · C98-DDL-2 · C98-DML-1 · 코드 배포 · C96-DDL-2A · C96-DDL-2B
- 기대: ① 배포 뒤 첫 회차 새 PID ERROR 0 · 운영 경보 journey-pause-notice-ddl 0 ② 직원 지시문(설계서 §6 · 엑셀) 전 시트 기대 결과 그대로 ③ 첫 5분 = C98-S0 ③ 수만큼 멈춤 안내 · journeys.pause_notice_for 찍힘
- 확인: 로그 줄 · 그 시각 SQL 하나씩(docker 한 줄) · 직원 시트 결과
- 결과:

### C99-S0 · 두 문 회사 구매 처방 사전 실측(배포 앞 · 설계서 docs/2026-11-03-two-door-purchase-design.md §9)
- 카드: C99
- 단계: 사전
- 선행: 없음
- 기대: ① 두 문 회사 수(몰 결제 사실(netPurchaseSql · 표식 없는 옛 결제 포함)과 원장 행이 둘 다 있는 회사 · Harold 「지금 없어」 = 0 · 0 이 아니면 그 회사는 배포 직후 전환 패스가 센다) ② §6 새 칸 두 개 information_schema 0행(customers.summary_source · companies.two_door_since) ③ 가입 근거 길에 쓰는 기존 칸(sync_logs.sync_type · mode · completed_at · error_message · success_count · total_count · company_integrations.provider · status) 이름 · 형
- 확인: 결과 그대로(SQL = 그 창에서 docker 한 줄씩)
- 결과: 1104 Harold 실행 = ① 0(두 문 회사 없음 = 배포 직후 전환 패스 대상 0) · ② 0행(두 칸 모두 새 칸) · ③ 8줄 기대 그대로(company_integrations.provider · status = character varying · sync_logs.completed_at = timestamp with time zone · error_message = text · mode · sync_type = character varying · success_count · total_count = integer)

### C99-DDL-1 · customers.summary_source(두 문 회사 원본 요약 값 · 설계서 §4 T1 · §6) · ★ 배포 앞
- 카드: C99
- 단계: DDL
- 선행: C99-S0
- 의미 바꿈: 아니오(빈 칸 추가 · 표 다시 쓰기 0 · 옛 코드는 읽지 않는다 · 새 코드는 칸이 없으면 고객 쓰기 = 503 DB_MIGRATION_PENDING · 반드시 배포 앞 · 확인 출력 뒤 push)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'summary_source';
- 확인: summary_source · jsonb · YES 한 줄
- 결과: 1104 Harold 실행 = SET · ALTER TABLE · 확인 한 줄 기대 그대로(summary_source · jsonb · YES)

> C99-DDL-1 · 배포 앞 · 빈 칸 추가(표 다시 쓰기 0) · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C99-DDL-1
SET lock_timeout = '3s';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS summary_source jsonb NULL;
```

### C99-DDL-2 · companies.two_door_since(한 번 두 문이면 계속 · 설계서 §4 T1 · §6) · ★ 배포 앞
- 카드: C99
- 단계: DDL
- 선행: C99-S0
- 의미 바꿈: 아니오(빈 칸 추가 · 옛 코드는 읽지 않는다 · 새 코드는 칸이 없으면 고객 · 구매 쓰기 = 503 DB_MIGRATION_PENDING · 반드시 배포 앞)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'two_door_since';
- 확인: two_door_since · timestamp with time zone · YES 한 줄
- 결과: 1104 Harold 실행 = SET · ALTER TABLE · 확인 한 줄 기대 그대로(two_door_since · timestamp with time zone · YES)

> C99-DDL-2 · 배포 앞 · 빈 칸 추가 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C99-DDL-2
SET lock_timeout = '3s';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS two_door_since timestamptz NULL;
```

### C99-S1 · 두 문 회사 구매 처방 실측(배포 뒤 · 두 문 시험 계정 · 직원 시트 14 ~ 19)
- 카드: C99
- 단계: 사후
- 선행: C99-DDL-1 · C99-DDL-2 · 코드 배포
- 기대: ① 배포 뒤 새 PID ERROR 0(42703 · 42P08 0) ② 전환 패스 로그 = 두 문 회사 0(S0 ① = 0 이면) ③ 직원 시트 14 ~ 19 기대 결과 그대로 ④ 납품 고객사 연결 뒤 = 원본 누계(summary_source.totals)와 두 문 합 대조 SQL 결과 · ⑨-1 겹침 비율 Harold 보고
- 확인: 로그 줄 · 그 시각 SQL 하나씩(docker 한 줄) · 직원 시트 결과
- 결과: 1104 Harold 출력 = ① 재시작(02:55:57) 뒤 에러 로그 0줄 · 출력 로그 오류 · SQL 오류 코드 0 → 기대값 같음 ② [TwoDoorPass] 시작 줄 02:56:11 · 회사 셈 줄 0(S0 ① = 0) → 기대값 같음 ③ 직원 시트 14 ~ 19 = 남음 ④ 납품 고객사 연결 뒤 = 남음

### C102-S0 · 여정 · 자동마케팅 구조 결함 0 사전 실측(배포 앞 · 설계서 docs/2026-11-04-c102-structural-zero-design.md §5)
- 카드: C102
- 단계: 사전
- 선행: 없음
- 기대: ① 표식 없는 옛 결제가 결제 아닌 상태로 덮인 구매 사건(G2 · 회사별) = 0 이면 되살릴 것 없음 ② 음수 금액 원장 행 · 그 고객 수(G1 · 회사별) = 0 이면 옛 계산 보정 없음 ③ 미래 날짜 원장 행(G6 · 회사별) ④ 최근 구매일이 미래인 고객(G6 · G8 · 회사별) ⑤ 최근 3일 고객 없는 원장 행(G7 · 회사별) ⑥ 잇기 조회 계획(⑤ 가장 큰 회사 id 로 · 읽기만 · 색인 idx_purchases_company_created_id 범위 · 실행 시간) — ① ~ ④ 가 0 이 아니면 그 회사 · 수를 설계서 §5 에 적고 보정 길을 그 데이터로 정한다(일괄 다시 셈 = 원본 소유 칸을 덮으므로 금지 · Codex 2R)
- 확인: 결과 그대로(SQL = 설계서 §5 ① ~ ⑥ · 읽기만 · 서버 창에서 하나씩)
- 결과: 1104 Harold 실행 = ① 0 rows(덮인 옛 결제 없음 → 되살릴 것 없음 · 기대값 같음) · ② 0 rows(음수 금액 원장 행 없음 → 옛 계산 보정 없음 · 기대값 같음) · ③ 0 rows(미래 날짜 원장 행 없음 · 기대값 같음) · ④ 0 rows(최근 구매일이 미래인 고객 없음 = G8 지금 크기 0 · 기대값 같음) · ⑤ 1 row = 682956b7-37a3-46b5-9868-b63011bda47b 10행(최근 3일 고객 없이 온 원장 행 · 배포 뒤 그 회사 다음 원장 적재 때 같은 번호 고객이 있으면 이어짐) · ⑥ 실행 0.794 ms · idx_purchases_customer(customer_id IS NULL · 전체 고객 없는 행 501 = 그 회사 10 + 거름 491) → idx_customers_phone · 이어질 행 0(그 10행 번호 = 지금 고객 없음 = 배포 직후 잇기 0) → 사전 실측 끝 · 보정 없음

### C102-S1 · 여정 · 자동마케팅 구조 결함 0 실측(배포 뒤 · 직원 시트 20 ~ 23 · docs/2026-11-04-c102-staff-sheet.xlsx)
- 카드: C102
- 단계: 사후
- 선행: C102-S0 · 코드 배포
- 기대: ① 배포 뒤 새 PID ERROR 0(42703 · 42883 · 42P08 0) ② 직원 시트 20 ~ 23 기대 결과 그대로(23 = 두 문 시험 계정 · 싱크 시험 에이전트)
- 확인: 로그 줄 · 직원 시트 결과
- 결과: 1104 Harold 출력 = ① 재시작(07:33:08 · ee1166a6) · (08:32:38 · d7e3061f G8) 뒤 에러 로그 0줄 · 출력 로그 오류 · SQL 오류 코드 0 · health 200 → 기대값 같음 · 화면 셋 기대대로 · ② 직원 시트 20 ~ 23 = 남음

### C101-S0 · 같은 번호 수신동의 사전 확인(배포 앞 · 설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §5)
- 카드: C101
- 단계: 사전
- 선행: 없음
- 기대: 운영 고객 행 수신동의 NULL 수(공용 기본값이 「새로 넣은 행만」으로 바뀌면 이 행들은 업로드 · 화면이 동의 칸 없이 건드려도 동의로 안 채워진다 · 0 이 아니면 회사별 분포를 보고 정한다)
- 확인: SELECT COUNT(*) FROM customers WHERE sms_opt_in IS NULL;
- 결과: 1104 Harold 실행 = 0(대기 행 없음 · 공용 기본값 「새로 넣은 행만」 바꿈의 지금 고객 영향 0)

### C101-DDL-1 · 세대 표 셋(sync_consent_passes · sync_consent_stage · sync_consent_marks · 설계서 §5 · 3-2 ①) · ★ 배포 앞
- 카드: C101
- 단계: DDL
- 선행: C101-S0
- 의미 바꿈: 아니오(새 표 · 옛 코드는 읽지 않는다 · 1.7.6 에이전트가 세대를 시작하기 전까지 비어 있다)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT table_name FROM information_schema.tables WHERE table_name IN ('sync_consent_passes','sync_consent_stage','sync_consent_marks') ORDER BY 1;
- 확인: 세 줄(sync_consent_marks · sync_consent_passes · sync_consent_stage)
- 결과: 1104 Harold 실행 = SET · CREATE TABLE 3 · CREATE INDEX 2 · 확인 세 줄 기대 그대로

> C101-DDL-1 · 배포 앞 · 새 표 셋(운영 표 다시 쓰기 0 · sync_agents 참조 = 짧은 잠금) · 되돌리기 = DROP TABLE 세 줄(1.7.6 이 쓰기 전)

```sql ddl:C101-DDL-1
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS sync_consent_passes (
  pass_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       uuid        NOT NULL REFERENCES sync_agents(id) ON DELETE CASCADE,
  company_id     uuid        NOT NULL,
  started_at     timestamptz NOT NULL DEFAULT now(),
  state          text        NOT NULL DEFAULT 'collecting' CHECK (state IN ('collecting','collected','applying','done','abandoned','retiring')),
  load_batches   integer[]   NOT NULL DEFAULT '{}',
  prev_pass_id   uuid,
  publish_cursor text,
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS sync_consent_passes_agent ON sync_consent_passes (agent_id, state);
CREATE INDEX IF NOT EXISTS sync_consent_passes_company ON sync_consent_passes (company_id, state, started_at);
CREATE TABLE IF NOT EXISTS sync_consent_stage (
  pass_id     uuid    NOT NULL REFERENCES sync_consent_passes(pass_id) ON DELETE CASCADE,
  phone       text    NOT NULL,
  any_false   boolean NOT NULL DEFAULT false,
  any_true    boolean NOT NULL DEFAULT false,
  any_unknown boolean NOT NULL DEFAULT false,
  PRIMARY KEY (pass_id, phone)
);
CREATE TABLE IF NOT EXISTS sync_consent_marks (
  company_id      uuid        NOT NULL,
  phone           text        NOT NULL,
  refusal_seen_at timestamptz,
  raise_since     timestamptz,
  PRIMARY KEY (company_id, phone)
);
```

### C101-DDL-2 · sync_releases.company_id(회사 하나에만 거는 원격 릴리스 · 설계서 3-2 ⑩) · ★ 배포 앞
- 카드: C101
- 단계: DDL
- 선행: C101-DDL-1
- 의미 바꿈: 아니오(빈 칸 추가 · NULL = 지금 릴리스 그대로 · 옛 코드는 읽지 않는다)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'sync_releases' AND column_name = 'company_id';
- 확인: company_id · uuid · YES 한 줄
- 결과: 1104 Harold 실행 = SET · ALTER TABLE · company_id · uuid · YES 한 줄 · 같은 명령에 DDL-1 세 표 기본 키 확인(passes = pass_id · stage = pass_id, phone · marks = company_id, phone) 기대 그대로

> C101-DDL-2 · 배포 앞 · 빈 칸 추가(표 다시 쓰기 0) · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C101-DDL-2
SET lock_timeout = '3s';
ALTER TABLE sync_releases ADD COLUMN IF NOT EXISTS company_id uuid NULL;
```

### C101-S1 · 같은 번호 수신동의 거부 우선 실측(배포 뒤 · 설계서 docs/2026-11-03-sync-duplicate-phone-consent-design.md §8-1)
- 카드: C101
- 단계: 사후
- 선행: C101-DDL-1 · C101-DDL-2 · 코드 배포
- 기대: ① 배포 뒤 새 PID ERROR 0(SQL 오류 코드 · `DB_MIGRATION_PENDING` · `MIXED_AGENT` 0) · health 200 · 슈퍼관리자 「Agent 버전 배포」 창에 「배포 대상」 칸 ② 엠티 1.7.6 설치 뒤 첫 고객 실행 = 그 에이전트 세대 패스 `done` · 409 `MIXED_AGENT` 0 · 판매 뷰 휴대폰 칸 ③ 직원 시트(설계서 §7 · 시트 1 업로드 · 시트 2 싱크) 기대 결과 그대로
- 확인: 로그 줄 · 화면 · ② = 엠티 설치 뒤 패스 상태 SQL(TROUBLESHOOTING §4 C101 줄) · 직원 시트 결과
- 결과: 1104 Harold 출력 = ① 서버 HEAD cae2cd7c · 새 프로세스 08:11:09 KST(dist 시각 뒤) · 에러 로그 0줄 · 출력 로그 SQL 오류 코드 · `DB_MIGRATION_PENDING` · `MIXED_AGENT` 0 · health 200 · 화면 「배포 대상」 칸 보임 → 기대값 같음 · 엠티 1.7.6 묶음 + 안내서 PDF = 1104 오전 발송(설계서 §8-1) · ② 엠티 설치 뒤 = 남음 · ③ 직원 시트 = 남음(엑셀 아직)

### C103-S0 · 1104 오류접수 처방 사전 확인(배포 앞 · 읽기만 · 설계서 docs/2026-11-05-intake-1104-fix-design.md §4)
- 카드: C103
- 단계: 사전
- 선행: 없음
- 기대: ① 뷰 customers_unified 에 기대는 다른 객체 0 ② 컨펌 행 중 superseded_at · objection_resolved_at 이 찍힌 행 0 · 0(쓰는 코드가 없던 칸)
- 확인: 아래 두 SQL 출력 그대로
- 결과: 2026-11-05 Harold 출력 · ① 0 · ② 0|0(기대와 같음)

> C103-S0 ① = SELECT count(*) FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class WHERE d.refobjid = 'public.customers_unified'::regclass AND v.relname <> 'customers_unified';
> C103-S0 ② = SELECT count(*) FILTER (WHERE superseded_at IS NOT NULL) AS superseded, count(*) FILTER (WHERE objection_resolved_at IS NOT NULL) AS resolved FROM invoice_confirmations;

### C103-DDL-1 · customers_unified 뷰에 joined_at(가입일 · FIELD_MAP 칸 = 뷰 칸 · 설계서 F6) · ★ 배포 앞
- 카드: C103
- 단계: DDL
- 선행: C103-S0 ① = 0 · C98-DDL-2(customers.joined_at · 1103 실행 끝)
- 의미 바꿈: 아니오(뷰 끝에 칸 하나 · 옛 코드는 이 칸을 읽지 않는다 · 지금 운영 고객 DB 엑셀 = 이 칸이 없어 실패 중 = 이 DDL 뒤 바로 낫는다)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name FROM information_schema.columns WHERE table_name = 'customers_unified' AND column_name = 'joined_at';
- 확인: joined_at 한 줄
- 결과: 2026-11-05 Harold 실행 = SET · CREATE VIEW · 확인 joined_at 한 줄 기대 그대로(이 시각부터 고객 DB 엑셀 · 목록 · 필터의 「joined_at 칸 없음」 원인 해소 · 코드 배포 전)

> C103-DDL-1 · 배포 앞(배포 뒤여도 무해 · 앞이면 엑셀이 코드 배포 전에 낫는다) · 원문 = 운영 덤프(2026-10-27 · 해시 대조 같음) 정의 그대로 + 바깥 SELECT 끝 t.joined_at · 안쪽 SELECT customers.joined_at · 아래 UNION 끝 customers.joined_at · 되돌리기 = 남겨도 무해

```sql ddl:C103-DDL-1
SET lock_timeout = '3s';
CREATE OR REPLACE VIEW public.customers_unified AS
 SELECT t.id,
    t.company_id,
    t.phone,
    t.name,
    t.gender,
    t.birth_date,
    t.age,
    t.email,
    t.address,
    t.grade,
    t.points,
    t.store_code,
    t.registered_store,
    t.registered_store_number,
    t.registration_type,
    t.recent_purchase_amount,
    t.recent_purchase_store,
    t.total_purchase_amount,
    t.wedding_anniversary,
    t.is_married,
    t.sms_opt_in,
    t.custom_fields,
    t.is_opt_out,
    t.is_invalid,
    t.created_at,
    t.updated_at,
    t.source,
    t.birth_year,
    t.birth_month_day,
    t.region,
    t.total_purchase,
    t.last_purchase_date,
    t.purchase_count,
    t.is_active,
    t.recent_purchase_date,
    t.store_name,
    t.callback,
    t.store_phone,
    t.uploaded_by,
    t.rn,
    t.joined_at
   FROM ( SELECT customers.id,
            customers.company_id,
            customers.phone,
            customers.name,
            customers.gender,
            customers.birth_date,
            customers.age,
            customers.email,
            customers.address,
            customers.grade,
            customers.points,
            customers.store_code,
            customers.registered_store,
            customers.registered_store_number,
            customers.registration_type,
            customers.recent_purchase_amount,
            customers.recent_purchase_store,
            customers.total_purchase_amount,
            customers.wedding_anniversary,
            customers.is_married,
            customers.sms_opt_in,
            customers.custom_fields,
            customers.is_opt_out,
            customers.is_invalid,
            customers.created_at,
            customers.updated_at,
            customers.source,
            customers.birth_year,
            customers.birth_month_day,
            customers.region,
            customers.total_purchase,
            customers.last_purchase_date,
            customers.purchase_count,
            customers.is_active,
            customers.recent_purchase_date,
            customers.store_name,
            customers.callback,
            customers.store_phone,
            customers.uploaded_by,
            customers.joined_at,
            row_number() OVER (PARTITION BY customers.company_id, customers.phone, customers.name ORDER BY
                CASE
                    WHEN ((customers.source)::text = 'sync'::text) THEN 0
                    ELSE 1
                END) AS rn
           FROM public.customers
          WHERE ((customers.name IS NOT NULL) AND ((customers.name)::text <> ''::text))) t
  WHERE (t.rn = 1)
UNION ALL
 SELECT customers.id,
    customers.company_id,
    customers.phone,
    customers.name,
    customers.gender,
    customers.birth_date,
    customers.age,
    customers.email,
    customers.address,
    customers.grade,
    customers.points,
    customers.store_code,
    customers.registered_store,
    customers.registered_store_number,
    customers.registration_type,
    customers.recent_purchase_amount,
    customers.recent_purchase_store,
    customers.total_purchase_amount,
    customers.wedding_anniversary,
    customers.is_married,
    customers.sms_opt_in,
    customers.custom_fields,
    customers.is_opt_out,
    customers.is_invalid,
    customers.created_at,
    customers.updated_at,
    customers.source,
    customers.birth_year,
    customers.birth_month_day,
    customers.region,
    customers.total_purchase,
    customers.last_purchase_date,
    customers.purchase_count,
    customers.is_active,
    customers.recent_purchase_date,
    customers.store_name,
    customers.callback,
    customers.store_phone,
    customers.uploaded_by,
    1 AS rn,
    customers.joined_at
   FROM public.customers
  WHERE ((customers.name IS NULL) OR ((customers.name)::text = ''::text));
```

### C103-S1 · 1104 오류접수 처방 실측(배포 뒤 · 직원 시트 24 ~ 29 · docs/2026-11-05-c103-staff-sheet.xlsx)
- 카드: C103
- 단계: 배포 뒤
- 선행: 코드 배포 · C103-DDL-1
- 기대: 직원 시트 24 ~ 29 전 항목 「맞음」 · 배포 뒤 에러 로그에 joined_at 칸 없음 오류 0
- 확인: 시트 결과(날짜 · 계정 · 사람)
- 결과: 1105 부분 · 배포 뒤 에러 로그 joined_at 칸 없음 0(마지막 13:52:19 = DDL-1 앞 · Harold 출력) · 시트 28 ① 맞음(Harold 화면 엑셀 다운로드 받아짐) · 시트 24 ~ 27 · 28 ② · 29 대기

### C104-S1 · 같은 사실 = 같은 입력 실측(배포 뒤 · 직원 시트 30 ~ 32 · docs/2026-11-05-c104-staff-sheet.xlsx)
- 카드: C104
- 단계: 배포 뒤
- 선행: 코드 배포(DDL 0)
- 기대: 직원 시트 30 ~ 32 전 항목 「맞음」(A/B 칸 여정 켜기 · 혜택 넣기 안내 · 시작 카드 인원 + 등록 7일 안 빠진 수 · 미리 보기 「들어올 고객」) · 배포 뒤 에러 로그에 journeyEntryInputs · countJourneyTargetsWithGrace 오류 0
- 확인: 시트 결과(날짜 · 계정 · 사람) · 배포 뒤 에러 로그 grep
- 결과:

### C105-S0 · 여정 개별회신번호 규칙 바뀜 배포 전 실측(pull 뒤 · build 전 · 읽기만)
- 카드: C105
- 단계: 배포 전
- 선행: git pull
- 기대: packages/backend 에서 npx ts-node scripts/c105-s0-individual-callback-diff.ts · store 모드 켜진 · 멈춘 여정마다 「바뀜 없음 · 번호만 바뀜 · 발송 → 실패 · 실패 → 발송 · 멈춤 바뀜」 수(회사 고객 전원 상한 · 진행 중 부분 수) · 「발송 → 실패」 가 있으면 Harold 판단 뒤 build
- 확인: 출력 줄(번호 · 개인정보 0)
- 결과:

### C105-S1 · 범위 밖 다섯 실측(배포 뒤 · 직원 시트 33 ~ 37 · docs/2026-11-05-c105-staff-sheet.xlsx)
- 카드: C105
- 단계: 배포 뒤
- 선행: 코드 배포(DDL 0) · C105-S0
- 기대: 직원 시트 33 ~ 37 전 항목 「맞음」(혜택 기간 · 개별회신번호 · 재진입 인원 · 고객 목록 주소 숫자 · A/B 판마다 검사) · 배포 뒤 에러 로그에 INVALID_NUMBER_INPUT 이 나오면 주소 · 화면(생산자) 기록
- 확인: 시트 결과(날짜 · 계정 · 사람) · 배포 뒤 에러 로그 grep
- 결과:

### C106-S1 · 인앱 예시 갤러리 그림 만들기(배포 뒤 · 서버 스크립트 · AI 생성 원가)
- 카드: C106
- 단계: 배포 뒤
- 선행: 코드 배포(DDL 0 · **C105 와 한 배포 · Harold 1105 「다른세션 작업 끝나면 한번에 배포」** · routes/cdp.ts 에 C105 · C106 덩어리가 함께 있다) · 생성 원가 확인(설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §10-3)
- 기대: 그림 없는 장 14 → 0 · 실패 3번이면 멈춤 · 서빙본 미리 만들기(warm) · 새 인앱 메시지 입구 맨 위 「예시로 보고 시작」 카드 9개
- 확인: 스크립트 끝 줄(만듦 · 실패 · 남은 장) · 입구 화면
- 결과:

### C106-S2 · 인앱 포스터 재구성 실측(배포 뒤 · 직원 시트 S1 1 ~ 15 · 설계서 §7)
- 카드: C106
- 단계: 배포 뒤
- 선행: 코드 배포 · C106-S1
- 기대: 시트 1 ~ 15 전 항목 「맞음」(16 = 팝폰 OTA 뒤) · 배포 뒤 에러 로그에 is_ad 칸 없음 오류 0(B-1105-3)
- 확인: 시트 결과(날짜 · 계정 · 사람) · 배포 뒤 에러 로그 grep
- 결과:

### C106-S3 · 팝폰 앱 계약 v4(선행 = 팝폰 미커밋 5파일 커밋 · 설계서 §3-11 · §10-5)
- 카드: C106
- 단계: 배포 뒤
- 선행: C106-S2 · 팝폰 커밋(Harold)
- 기대: 앱 코드(caps · 통짜 · 떠 있는 카드 · 띠 2종) → OTA → 실기기(안드로이드 · iOS) 확인 → 프론트 APP_CONFIRMED_CAPS 에 낱말을 넣는 배포
- 확인: 실기기 화면 · 시트 16
- 결과:

### C107-S1 · 브랜드메시지 · 알림톡 창 · 발송결과 · 통계 · 정산 실측(배포 뒤 · 직원 시트 38 ~ 48 · docs/2026-11-05-c107-staff-sheet.xlsx)
- 카드: C107
- 단계: 배포 뒤
- 선행: 코드 배포(DDL 0 · **C104 · C105 · C106 과 한 배포 · Harold 1105 「다른세션 작업 끝나면 한번에 배포」** · 배포 전 C105-S0 는 그 카드대로) · 설계서 docs/2026-11-05-brand-message-design.md §9 · §11
- 기대: 시트 38 ~ 48 전 항목 「맞음」(받는 사람 4칸 · 중복제거 · 휴대폰 꼴 대체 창 · SMS 90바이트 · 브랜드 + 문자 대체 발송 · 발송결과 아랫줄 · 대체 거르기 · 목록 엑셀 · 통계 엑셀 · 충전금 결과별 정산 줄 · 알림톡 같은 창 · 타겟추출 · 파일 칸 고르기 · 주소록) · 배포 뒤 에러 로그에 brandFallbackOpt080 · resolveBrandFallback · kakaoFallbackSpamItems · smsKakaoResultAgg 오류 0
- 확인: 시트 결과(날짜 · 계정 · 사람) · 배포 뒤 에러 로그 grep
- 결과:

### C107-G0 · 게이트웨이 번역 켜기 전 사전 실측(읽기만 · 설계서 §4 G5')
- 카드: C107
- 단계: 게이트웨이 배포 전
- 선행: 없음
- 기대: ① 한줄로 SMSQ 결과 칸 형식 = SMSQ_SEND_13 ~ 16 의 status_code 가 정수(int · 5자리 20000 ~ 59999 가 들어간다 · smallint 면 멈춤) ② 한줄로 에이전트(hanjul02 · hanjul03 · 그 밖 = 게이트웨이 agent_account 조회로 확정) 설정 = state_policy.mode final_result_only · result_policy.failure_code_source status_values.failed(설치 폴더 설정 파일 · 비밀값 줄 제외) ③ 게이트웨이 운영 표준 코드 표의 실패 · 숫자 있는 코드 수(시험 DB 244 와 비교 · 다르면 한줄로 라벨 생성 파일을 운영 표 기준으로 다시 만들지 판단)
- 확인: 세 출력
- 결과: 1106 Harold 출력 = ① SMSQ_SEND 표 138개 status_code 전부 int → 통과 ② hanjul01(/opt/bito-agent) · hanjul02 · hanjul03 · hanjul-04(/opt/bito-agent-hanjul-04) 전부 state_policy final_result_only · failure_code_source status_values.failed → 통과(켜기 = 그 줄을 gateway_report 로) ③ 운영 대역 코드 244 · 계열 4(시험 DB 와 같음 · 라벨 생성 파일 그대로) · 에이전트 넷 등록 · 활성 · **hanjul01 에 0708 「Agent별 결과코드 매핑」 71행(고객사 3 = 한줄로AI · sms 28 · lms_mms 43 · 표준 코드 숫자 그대로 · 성공 2 = 6 · 1000 · 실패 69)** — 실패 코드 다수가 한줄로 결과 표와 뜻이 다르다(LMSMMS_3004 단말 꺼짐 → 한줄로 3004 「스팸 차단」 · LMSMMS_3000 → 「메시지 형식 오류」 등) · 유형이 딱 맞아 대역 행보다 앞서 뽑힌다 → G4 검사를 「대역 아닌 실패 매핑이 켜져 있으면 멈춤」으로 바꿈 · hanjul01 = C107-G3 먼저

### C107-G1 · 게이트웨이 마이그레이션 100(DDL · 새 판보다 먼저 · 게이트웨이 런북 §3-3 「DDL 선적용 → 바이너리」)
- 카드: C107
- 단계: 게이트웨이 배포 전
- 선행: C107-G0 ①(status_code 정수)
- 기대: bito-gateway migrations/100_customer_failure_code.sql 을 .65 게이트웨이 DB 에 적용 · `agent_account.failure_code_policy`(기본 raw) · `report_queue.customer_code` · 함수 `customer_failure_code(text,bigint,text,text)` 생김 · 정책 기본 raw = 동작 변화 0 · lock_timeout 250ms 로 멈추면 그대로 다시
- 확인: `to_regprocedure('customer_failure_code(text,bigint,text,text)')` · 두 칸 information_schema 출력
- 결과: 1106 Harold .65 실행 = SET · ALTER TABLE · DO · ALTER TABLE · CREATE FUNCTION · COMMENT · 확인 출력 fn t · 칸 2 · 에이전트 21 중 raw 21 → 통과

### C107-G2 · 게이트웨이 새 판 배포(게이트웨이 런북 §2 check · build · §3-3 gateway · §4 새 PID ERROR 세기)
- 카드: C107
- 단계: 게이트웨이 배포
- 선행: C107-G1 · 게이트웨이 커밋(Harold)
- 기대: GW_CHECK_OK(로컬) · GW_BUILD_OK · GW_DEPLOY_OK · 새 PID ERROR 종류별 0(기동 직후 젬텍 reconnect 1 ~ 3 제외) · 기동 로그에 「고객 실패 코드 번역(100)이 없다」 없음 · 정책이 전부 raw 라 결과 코드 변화 0
- 확인: 마커 · journalctl 세기 출력
- 결과: 1106 = GW_CHECK_OK · GW_PG_CHECK_OK(1926) · 커밋 bff79a9 push(00b7a7e..bff79a9) · GW_BUILD_OK out/bito-gateway-bff79a9(sha256 7d8946da…8e9ede) · 00:37:28 GW_DEPLOY_OK gateway(재기동 전 SENDING 0 · 백업 deploy-backups/20261106-003728-gateway.heSzvw) · 150초 뒤 새 PID 2362541 = ERROR 0줄 · 9444 같은 PID · 규격연동 입구 시작 1 · 기동 검사 실패 줄 0 → 통과

### C107-G3 · hanjul01 기존 실패 매핑 69행 끄기(hanjul01 을 켤 때만 · 대표 판단 · 지우지 않음)
- 카드: C107
- 단계: 게이트웨이 배포 뒤
- 선행: C107-G2
- 기대: hanjul01 의 0708 「Agent별 결과코드 매핑」 중 실패 계열 표준 69행 is_active = FALSE(UPDATE 69 · 성공 2행 = 6 · 1000 은 그대로) · 콘솔 고객 코드 칸이 hanjul01 실패에서 그 코드 대신 대역(또는 전역 기본) 코드로 보인다 · 되돌리기 = 같은 조건으로 is_active = TRUE
- 확인: UPDATE 69
- 결과: 1106 Harold 승인(「그렇게해」) · .65 실행 = `NOTICE: C107-G3 UPDATE 69` · DO(조건 = hanjul01 · 활성 · 실패 계열 표준 · note 두 개 · 69 아니면 되돌리는 DO 블록)

### C107-G4 · 한줄로 에이전트 실패 코드 대역 행(에이전트 하나씩 · bito-gateway scripts/gw/customer-failure-codes-hanjul.sql)
- 카드: C107
- 단계: 게이트웨이 배포 뒤
- 선행: C107-G2
- 기대: 에이전트마다 출력 한 줄 = band_codes · rows_band 244 · rows_other = 대역 밖 행 수(hanjul01 = 71 · 그 밖 0) · 대역 아닌 실패 매핑이 켜져 있으면 · 겹침 · 없는 에이전트면 멈춤(넣은 것 없음)
- 확인: 출력 줄
- 결과: 1106 hanjul02 = INSERT 0 244 · `hanjul02 | 244 | 244 | 0` · COMMIT / hanjul01(G3 뒤) = INSERT 0 244 · `hanjul01 | 244 | 244 | 71`(꺼 둔 69 + 성공 2) · COMMIT / hanjul03 = INSERT 0 244 · `hanjul03 | 244 | 244 | 0` · COMMIT / hanjul-04 = INSERT 0 244 · `hanjul-04 | 244 | 244 | 0` · COMMIT → 넷 전부 통과

### C107-G6 · 번역 켜기 · 에이전트 설정 바꿈(에이전트 하나씩 · 설계서 §4 G6)
- 카드: C107
- 단계: 게이트웨이 배포 뒤
- 선행: C107-G4(그 에이전트) · C107-G0 ②
- 기대: ① `UPDATE agent_account SET failure_code_policy = 'mapped', updated_at = NOW() WHERE agent_id = '<에이전트>';` (UPDATE 1) ② 전환 조건 = `SELECT count(*) FROM report_queue rq WHERE rq.agent_id = '<에이전트>' AND rq.delivered = FALSE AND rq.customer_code IS NULL AND BTRIM(rq.result_code) <> '' AND BTRIM(rq.result_code) NOT IN ('0', '6', '0000', '1000', '1800', '7830', '7831', 'MS03');` 가 0(정책 전에 실린 실패 결과가 원 코드로 재전달되면 한줄로가 100 · 104 를 대기로 적는다) · 0 이 아니면 기다렸다 다시(설정을 바꾸지 않는다) ③ 그 에이전트 설정 `result_policy.failure_code_source: gateway_report` · 재시작(적재 0건일 때 · 한 대씩) ④ 실패 1건 실측 = C107-S2
- 확인: 각 출력
- 결과: 1106 hanjul02 ① UPDATE 1 ② raw_failures_pending 0 ③ .62 loading=0 · 82행 gateway_report · 00:49:15 재시작 · ACTIVE=active · Agent 1.0.32 · GW 연결 완료 · SMSQ_SEND_14 폴링 시작 · WARN journal active claim 복원(재시작 정상 복구 줄) / 나머지 셋 = Harold 「다 하면 되지」 → 한 명령에 묶음 · ① UPDATE 3 ② 네 대 전부 mapped · raw_failures_pending 0 ③ .62 loading=0 · bito-agent(hanjul01) 82행 · bito-agent-hanjul03 82행 · bito-agent-hanjul-04 81행 gateway_report · 00:51:48 · 00:51:59 · 00:52:09 재시작 · 셋 다 ACTIVE=active · GW 연결 완료 · SMSQ_SEND_13 · 15 · 16 폴링 시작(WARN = 내려가는 옛 프로세스의 연결 종료 · journal claim 복원) → 네 대 전부 통과 · 남은 = C107-S2

### C107-S2 · 실패 사유 실측(번역 켠 뒤 · 직원 시트 49)
- 카드: C107
- 단계: 게이트웨이 배포 뒤
- 선행: C107-G6(그 에이전트)
- 기대: 시트 49 = 발송 상세 결과 「카카오: 메시지를 발송할 수 없음」(「기타 오류」 아님) · 한줄로 SMSQ 그 행 status_code = 23018 · 게이트웨이 report_queue 그 행 result_code 3018 · customer_code 23018
- 확인: 시트 결과 · 두 조회 출력
- 결과: 1106 00:5x 사전 조회(.65 report_queue · 00:45 뒤 한줄로 네 대) = 성공 4행(hanjul02 · hanjul03 result_code 0 · customer_code 비어 있음 = 성공은 번역 안 함 · delivered t) · 실패 0행 → 번역 실측 전 · 시트 49(발송 시간대 실패 1건) 대기

### C108-H1 · 한줄로 배포(① 스팸 목록 · ② 청구 식 · 선불 친구 조각 · 화면 · ④ 손 목록 · 받는 쪽 먼저)
- 카드: C108
- 단계: 한줄로 배포(DDL 0 · 설계서 docs/2026-11-06-c107-followups-design.md §4 의 1)
- 선행: C107(11893902) · 커밋(Harold)
- 기대: 친구 칸(k_friend_yn)이 아직 없으니 청구 · 집계 = 종전 식(getFriendColumnTables = 빈 집합) · 이때부터 비친구 대상 브랜드 차감 문구에 「· 친구 W원」 조각(비친구 단가가 따로 있는 회사만) · 스팸 몰림 목록 = 결과 표 7 + 대역 5 · 관리 통계 시험 요약 = CT · 배포 뒤 에러 로그 0
- 확인: pm2 기동 · 에러 로그 · (선불 비친구 브랜드 차감이 생기면) 차감 설명 문구
- 결과: 1106 Harold tp-push(다른 세션 문서와 함께 · Harold 「함께 올리기」) · 서버 배포 Harold 「배포완료」

### C108-M1 · .62 MySQL SMSQ 친구 칸(비토 라인 12 ~ 16만 · root)
- 카드: C108
- 단계: 한줄로 배포 뒤 · 에이전트 설정 전
- 선행: C108-H1
- 기대: 실행 전 실측 ① 네 대 설정 이력 옮기기 꺼짐(archive) ② `SMSQ_SEND_1[2-6]_%` 이력 표 0 ③ MySQL 판(INSTANT 지원) → `ALTER TABLE SMSQ_SEND_N ADD COLUMN k_friend_yn varchar(1) NULL DEFAULT NULL, ALGORITHM=INSTANT`(N = 12 ~ 16 · lock_wait_timeout 2) · information_schema 확인 5행 · 되돌리기 = **칸은 남긴다**(에이전트 설정 `field_map.friend_yn` 만 되돌리면 칸에 새 값이 안 쓰인다) · 칸을 꼭 지워야 하면 에이전트 설정 되돌림 → 한줄로 재시작(친구 칸 표 목록 5분 캐시를 비움 · 남은 캐시가 없는 칸을 부르면 청구 · 정산 쿼리가 죽는다) → `ALTER TABLE … DROP COLUMN k_friend_yn`
- 확인: 실측 셋 · DDL 출력 · information_schema 5행
- 결과: 1106 사전 실측(Harold) ① 네 대 설정 history 절 없음 = 기본 꺼짐(config.go:474 기본값은 주기 · 묶음만 · archiver.go:78 꺼지면 바로 돌아옴) ② `SMSQ_SEND_1[2-6]` 표 = 12 · 13 · 14 · 15 · 16 다섯 개뿐(이력 표 0) ③ MySQL 8.4.8 · 친구 칸 0 → DDL(1106 11:3x Harold · root · -it 없이 비밀번호 read -s → --defaults-extra-file=/dev/stdin · 컨테이너 MYSQL_ROOT_PASSWORD 는 지금 비밀번호와 달라 거부) = 다섯 표 k_friend_yn varchar(1) YES → 통과

### C108-A1 · 에이전트 1.0.33 출고 · .62 네 대 교체 + field_map.friend_yn
- 카드: C108
- 단계: SMSQ 칸 뒤 · 게이트웨이 켜기 전
- 선행: C108-M1 · 게이트웨이 커밋 push(에이전트 빌드 = .65 deploy/build-agent.sh · 엔진 감사 설계서 §14-8 절차)
- 기대: 네 대 heartbeat 1.0.33 · 설정 `field_map.friend_yn: "k_friend_yn"` · 재시작(적재 0건 한 줄 조건) · 옛 게이트웨이 = 친구 값 빈 값이라 칸을 쓰지 않음(UPDATE 에 k_friend_yn 없음)
- 확인: 네 대 시작 로그(판 · GW 연결 · 폴링) · 설정 grep
- 결과: 선행 게이트 1106 Harold = check.sh GW_CHECK_OK · check.sh --pg GW_PG_CHECK_OK(관리 API 25 + 중간 모양 24 · Go 6패키지 · 통과 1940 · 건너뜀 0) · 게이트웨이 커밋 8e47013 push(파일 22 · 다른 세션 status/OPS.md · tools/generate_agent_environment_checklist_pdf.py 뺌) · ⚠ 1.0.32(2288d93) 뒤 Agent 변경이 함께 실린다 = 0929 속도 · 읽은 시각(58b5055) · 1031 발신프로필(c8ac27f) · 1105 설정 인코딩(290ab30) · C108 → 출고 = 엔진 감사 설계서 §14-8 전 절차(안내서 · 게시 · 승인 · canary) · **Harold 「오늘 밤 출고 준비」(1106)** · 준비 = 안내서 생성기 1.0.33 문장(카카오 발신프로필 키 선택 · 성능 표 poll_interval_min/max · 1.0.32 글 그대로 대조) · 카카오 문장은 템플릿 필수 유형(알림톡 · 브랜드 기본형)으로 좁힘 · Codex 1R · 2R approve(지적 0) · 안내서 v1.0.33 PDF sha256 07157371…93da · 7쪽 · CUSTOMER_DELIVERY_BOUNDARY_OK · DELIVERY_CONSISTENCY_CONTRACT_TEST_OK · AGENT_MANUAL 1.0.33 절 · 오늘 밤 순서 = ⓪ 사전 확인(.65 GW_SEND_CREDIT · agent_dispatch_profile 상한 · heartbeat 판 · 릴리스 목록 · 게시 폴더 / .62 네 대 field_map 자리) → ① 커밋 · push → ② .65 pull → ③ build 1.0.33 1.0.27 1.0.32 → ④ 레인 반입 → ⑤ 대시보드 검증 2 · 등록(승인 전) → ⑥ 안내서 scp → ⑦ 게시 · sha256sum -c → ⑧ 승인 → ⑨ .62 네 대 field_map.friend_yn 넣기(재시작 없음 · 1.0.32 는 모르는 키 = 경고만 · UnknownFieldMapKeys) → ⑩ rollout hanjul01 canary · 600초 · 나머지 셋 → ⑪ heartbeat 1.0.33 · 로그 → G0 · G1 · G2 · ⓪ .65 결과(1106 12:4x Harold) = GW_SEND_CREDIT 없음(off) · agent_dispatch_profile 상한 0행 → 1.0.33 동시 발송 = 설정 그대로 · heartbeat hanjul01 · 02 · 03 · hanjul-04 = 1.0.32 running(시험 bito-test-97 · 98 · 99 = 10월 멈춤 · 대상 밖) · 릴리스 최신 = 47 linux · 48 windows 1.0.32(09-27 11:50 승인) · 게시 폴더 1.0.32 = 안내서 짝 · 아카이브 2 · checksums 514B = 다섯 줄(agent-config.example.yaml 7661e296… = 저장소 deploy/agent/scripts 판 · 1.0.32 뒤 안 바뀜 · 안내서 PDF · PDF.sha256 · 아카이브 2) → 1.0.33 목록도 같은 다섯 줄 · Harold 「지금 해버려도」(1106 13시) → ①~⑨(빌드 nice · 등록 · 게시 · 승인 · 설정 넣기 = 재시작 0)는 지금 · ⑩ rollout(네 대 재시작) · G0~G2(게이트웨이 재시작 · DDL)는 밤 · ②③ 결과 = .65 HEAD 8e47013 · BUILD_AGENT_SERVER_OK 1.0.33 bootstrap 1.0.27 rollback_exact_from 1.0.32 source_digest 4fc1b43c…6d8c(nice 19) · ④ 레인 반입 18:48 = v133-linux · v133-windows 각 3파일(child 아카이브 · release-descriptor.json · .sig · ubuntu 600) · ⑤ 대시보드 아티팩트 검증 2 · 릴리즈 등록(Harold · 승인 전) · ⑥ 안내서 PDF 짝 scp → .65 /home/invito · ⑦ 게시 18:50 = PDF OK · 빌드 아카이브 2 OK · EXAMPLE_SAME · 다섯 줄 목록 514B sha256sum -c 5 OK · 관리 API 계정 ubuntu READ_OK 6 · root 644 · ⑧ 대시보드 릴리즈 승인(Harold · 게시 뒤) · ⑨ 앞 확인 = 네 대 표 하나씩(hanjul01 SMSQ_SEND_13 · 02 = 14 · 03 = 15 · hanjul-04 = 16 · 넷 다 M1 친구 칸 있음) · field_map 23행 · report_recv_time 36행(들여쓰기 4) · Agent 에 설정 다시 읽기 없음(fsnotify · SIGHUP 0) = 넣어도 rollout 재시작 때 처음 읽음 · ⑨ 결과(1106 19시 전 Harold) = 네 대 37행 friend_yn: "k_friend_yn" · 백업 agent-config.yaml.bak-c108-* · 재시작 0 · Harold 「발송량 체크해보고 아예 해버리자」 → ⑩ 지금(적재 0 조건) · ⑩ 앞 loading=0 · 네 대 active · 지난 15분 재시작 줄 0(rollout 전) · ⑩ 카나리 = hanjul-04 18:57:11 「비토 Agent 시작」 version 1.0.33 commit source:4fc1b43c · GW 연결 완료 edge.hanjulgw.com:9443 · 폴링 시작 SMSQ_SEND_16 · ERROR 0 · WARN = 옛 프로세스 끊김 두 줄뿐(friend_yn 모르는 키 경고 0) · 관찰 10분 뒤 General · ⑪ General 끝 = .65 heartbeat hanjul01 · 02 · 03 · hanjul-04 네 대 1.0.33(G2 명령 첫 줄 agents_1033=4 · 19:20) → 통과

### C108-G0 · 켜기 전 문(읽기 · .62 한줄로 DB)
- 카드: C108
- 단계: 게이트웨이 켜기 직전
- 선행: C108-A1
- 기대: C108-H1 배포 전에 차감한 예약 브랜드 캠페인 중 대상값이 친구가 아니고 아직 안 나간 것 = 0(있으면 그 발송이 끝난 뒤 켠다 · 선불 차감 문구에 친구 조각이 없어 한줄로는 차액이 없는데 게이트웨이만 친구로 정산하는 경계)
- 확인: 조회 출력
- 결과: 1106 19시 Harold .62 = campaigns send_channel kakao_brand · kakao_targeting I · F 아님 · sent_at 없음 · 종결 아님 = 0행 → 통과

### C108-G1 · 게이트웨이 마이그레이션 101(DDL · 새 판보다 먼저)
- 카드: C108
- 단계: 게이트웨이 배포 전
- 선행: C108-G0
- 기대: message_billing.friend_unit_price · friend_settled_at · settle_brand_friend_price(bigint,text) · prepare_dispatch_billing 스냅숏(prosrc 에 v_friend_unit_price) · lock_timeout 250ms(멈추면 그대로 다시) · 옛 판이 도는 동안 = 스냅숏만 쌓이고 정산 표식 없음 = 친구 값 빈 값(종전) · 적용 전 문 = 운영 prepare_dispatch_billing 본문이 070 판과 같다(md5(replace(prosrc, CR 빼고)) = 404e38ed5fdee23b2dc2bceea6e5a8a1 · 070 뒤 이 함수를 바꾼 마이그레이션 0 = 101 이 070 을 이어받음) · 적용 뒤 같은 식 = 915dfd0621a874fa43704cb592a63c30(101 판) · 시점 = rollout General 관찰 중에 함께(옛 게이트웨이 · 옛 Agent 와 섞여도 스냅숏만 쌓임 · 순서가 걸리는 것은 G2 = 네 대 1.0.33 뒤)
- 확인: 칸 둘 · 함수 · prosrc 확인 출력
- 결과: 1106 19시 Harold .65 = prod_pdb 404e38ed…(070 판과 같음) → BEGIN · SET · ALTER TABLE 2 · COMMIT · COMMENT 2 · CREATE FUNCTION 2 · COMMENT → 칸 friend_settled_at(timestamptz) · friend_unit_price(numeric) · settle_fn t · pdb_md5 915dfd06…(101 판) · snapshot t → 통과(잠금 시간 초과 0)

### C108-G2 · 게이트웨이 새 판 배포(켜기 · 런북 §2 check · build · §3-3 · §4 새 PID ERROR 세기)
- 카드: C108
- 단계: 게이트웨이 배포
- 선행: C108-G1 · 게이트웨이 커밋(Harold)
- 기대: GW_CHECK_OK · GW_PG_CHECK_OK · GW_BUILD_OK · GW_DEPLOY_OK · 기동 로그에 「브랜드 친구 단가 정산(101)이 없다」 없음 · 새 PID ERROR 종류별 0 · 이 판이 처리한 브랜드 성공부터 친구 정산
- 확인: 마커 · journalctl 세기
- 함께 실릴 것(1106 콜비서 진단 세션 요청 · **Harold 「함께 싣기」 1106 19시**): 비토 ac35d0a(부모 8e47013 · 로컬 · push 전) = migrations/102 customer_success_code(운영 1106 18:29 적용 · 101 과 겹치는 함수 0 = 101 은 prepare_dispatch_billing · settle_brand_friend_price · 102 는 customer_success_code) · 성공 코드 번역(정책 mapped + 성공 매핑 행 있을 때만 · 한줄로 네 대 행 없음) · 에이전트 코드 0 = 1.0.33 빌드와 무관 · 그 세션 18:29 ac35d0a 단독 배포는 C108 기동 점검(101 없음)에서 멈추고 deploy.sh 자동 복원(PID 2405466) · 배포 뒤 확인 = callbiseo-1 ~ 3 성공 결과 report_queue.customer_code 6(SMS) · 1000(LMS) · ⚠ 같은 날 젬텍 재매핑 DML 로 한줄로 네 대 대역 244 → 262(새 18) = 한줄로 대역 라벨(result-code-hanjul-band.generated.ts)에 없음 → 스팸 몰림 목록(R64 · 대역 제목 「스팸」)도 새 대역을 모름 = 별도 과제
- 결과: 1106 19시 로컬 = 커밋 16a7173(안내서 · 매뉴얼) push · 위로 ac35d0a · 8e47013 · check.sh bff79a9 = GW_CHECK_OK · --pg 1차 = GW_PG_CHECK_FAIL 1건 TestDispatcherStopCancelsNotifyBackoff(queue · 가짜 DB 단위 시험 · 멈춤 기한 200ms · 같은 실행의 최종 모양 판에서는 PASS 0.06s · 중간 모양 판에서 FAIL 0.20s · 파일 마지막 변경 09-29 = C108 · ac35d0a 무관 · 단독 300회 300 통과) · 통과 1943 · 빌드 1차 = 복제본이 /tmp 라 go.mod replace ../linkguard 없음으로 실패(산출물 0) · --pg 2차(19:12) = 같은 시험이 최종 모양 판에서 FAIL(통과 970 뒤 멈춤 · pipefail 로 빌드 안 감) · 패키지 단독(PG 없음) 5회 5 통과 · 실패 자리 = Go PG 시험이 패키지 여럿을 동시에 돌릴 때만 → 3차 = GOFLAGS=-p=1(패키지 차례로) = **GW_PG_CHECK_OK 통과 1944 · 건너뜀 0** · 깨끗한 복제본(~/projects 아래 · ../linkguard 옆) **GW_BUILD_OK out/bito-gateway-16a7173 · sha256 2df63bc8…2aa0** · deploy.sh sha256 62195b30…ff96(LF) · **배포 1106 19:20:50 Harold .65** = agents_1033=4(rollout General 끝) · 해시 둘 OK · 재기동 전 SENDING 0 · GW_DEPLOY_OK(백업 deploy-backups/20261106-192050-gateway.SrMtmt) · DEPLOY_RC 0 · 150초 뒤 PID 2417457 · 9444_SAME_PID 1 · SPEC_START 1 · SCHEMA_GATE_FAIL 0(101 · 102 기동 점검 통과) · ERROR 0줄 → 통과 · 남은 = 콜비서 성공 customer_code 6 · 1000 실측 · 첫 브랜드 친구 정산 · SMSQ k_friend_yn 실측(발송 쌓인 뒤) · S1 직원 시트 50 · 54 · 배포 직후 조회(1106 19:3x Harold) = 콜비서 결과 0행 · 친구 스냅숏 0행 = 표본 없음(검증 아님) → 1107 오전 같은 조회 다시 · 이 시험이 게이트 부하에서 떨어지는 것 = 별도 기록(BUGS 아님 · 게이트웨이 시험 결함)

### C108-S1 · 실측(직원 시트 50 ~ 54 · 운영 대조)
- 카드: C108
- 단계: 켠 뒤
- 선행: C108-G2
- 기대: 시트 50 ~ 53(마수동 전체 브랜드 1건 · 직원 본인 = 채널 친구) = 발송결과 예상 비용 = 친구 단가 · 차감이력 「결과별 단가 차액 환불」 = 비친구 − 친구 · 정산 미리보기 「브랜드메시지(친구)」 +1 · 게이트웨이 원장 `friend_adjust:` 1줄 · SMSQ 그 행 k_friend_yn = 'Y' · 시트 54 시험 발송 요약 대체 성공 = 성공 · ① 운영 대조 = 비토 라인 대역 스팸 코드 행이 생긴 캠페인의 스팸 수 0 아님
- 확인: 시트 결과 · 조회 출력
- 결과:

### C109-H1 · 한줄로 배포(보낼 수 없는 글자 판정 자리 전체 · 백엔드 + 프론트 · DDL 0)
- 카드: C109
- 단계: 한줄로 배포(DDL 0 · 새 칸 0 · 설계서 docs/2026-11-06-b1106-1-unsupported-char-design.md §8)
- 선행: C108(dd446c5d) · 커밋(Harold)
- 기대: 대행 검사 입구 반려 = 「검사 장비 문제」 3회 대신 test_failed 한 번 + 위치 안내(spam_rejected_chars · test_failed reason unsupported_chars) · 대행 접수 · 원스텝 · 메일 = 이모지 · 보이지 않는 글자 정리 + 알림(content_cleaned · recipients_cleaned 이력) · 막음 글자 = 위치 반려 · 안내 문자 = 정리 뒤 인증 라인 · 배포 뒤 에러 로그 0
- 확인: pm2 기동 · 에러 로그 · 운영 로그 `[SpamTestQueue] variant … 큐 등록 반려(보낼 수 없는 글자)` 줄이 나오면 그 건 진행 기록이 「보낼 수 없는 글자」 반려인지
- 결과: 1106 Harold tp-push c7b4ff35 · 서버 배포 Harold 「배포까지 완료」 · 확인 출력 = HEAD c7b4ff35 · pm2 online · created at 06:51:46Z · unstable 0 · 새 프로세스 뒤 에러 로그 0줄

### C109-S1 · 실측(직원 시트 55 ~ 64 · docs/2026-11-06-c109-staff-sheet.xlsx)
- 카드: C109
- 단계: 배포 뒤
- 선행: C109-H1
- 기대: 시트 55 ~ 64 전부 맞음(문장 원문 = 엑셀 · 진짜 함수로 뽑은 값)
- 확인: 시트 결과 · 다름이면 캡처
- 결과:

### C110-S1 · 피로도 켠 회사 수(사전 실측 · 설계서 D13)
- 카드: C110
- 단계: 사전 실측
- 선행: 없음
- 기대: 서버 셸 = docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT COUNT(*) FILTER (WHERE fatigue_cap_days IS NOT NULL AND fatigue_cap_max IS NOT NULL) AS fatigue_on, COUNT(*) AS companies FROM companies;"
- 확인: fatigue_on 수 = 서버 적재 확정 · 플래너 · 대행 · DM 에 피로도가 새로 먹는 회사 수
- 결과: 1107 Harold = fatigue_on 0 · companies 148 → 배포 뒤 서버 적재 확정 · 플래너 · 대행 · DM 에 피로도 상한이 새로 먹는 회사 0(D13 바뀜 대상 0)

### C110-S2 · 시험 회사 합성 번호 고객 수(실측 1건 · 직원 시트 준비)
- 카드: C110
- 단계: 사전 실측
- 선행: 없음
- 기대: 서버 셸 = docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT COUNT(DISTINCT regexp_replace(phone, '[^0-9]', '', 'g')) AS phones FROM customers WHERE company_id = 'c7c97996-19b3-4e4f-9c45-ce10deab257f' AND is_active = true AND COALESCE(phone, '') <> '';"
- 확인: phones ≥ 200 이면 시트 그대로 · 모자라면 시험 고객을 먼저 더한다(합성 번호)
- 결과: 1107 Harold = phones 3,668(≥ 200) → 직원 시트 S3 그대로

### C110-DDL-1 · 광고 관문(대조군 · 우선순위) 칸 · 제외 원장 · ★ 배포 앞
- 카드: C110
- 단계: DDL
- 선행: C110-S1
- 의미 바꿈: 아니오(칸 · 표 · 색인 추가만 · 한 트랜잭션 · 옛 코드는 새 칸 · 표를 읽지도 쓰지도 않는다 · 새 칸 기본 NULL = 회사 기능 꺼짐)
- 기대: 서버 셸에서 아래 블록(docker exec -i targetup-postgres psql -U targetup targetup -P pager=off 에 블록을 넘긴다) · 확인 = SELECT table_name, column_name FROM information_schema.columns WHERE (table_name = 'companies' AND column_name IN ('global_holdout_pct','global_holdout_since','campaign_holdout_pct','send_priority_order')) OR table_name IN ('ad_send_marks', 'ad_gate_failures') ORDER BY 1, 2;
- 확인: companies 4줄 · ad_send_marks 9줄 · ad_gate_failures 5줄
- 결과: 1107 Harold = BEGIN · SET · ALTER TABLE · CREATE TABLE · CREATE INDEX 5 · CREATE TABLE · CREATE INDEX · COMMIT · 확인 18줄(ad_gate_failures 5 · ad_send_marks 9 · companies 4) → 통과(터미널 에코가 겹쳐 보인 것은 붙여넣기 표시 · psql 출력 기준)

> C110-DDL-1 · 배포 앞 · 추가만 · 되돌리기 = 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md §9 되돌리기 줄(새 코드를 내린 뒤에만)

```sql ddl:C110-DDL-1
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS global_holdout_pct smallint CHECK (global_holdout_pct BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS global_holdout_since timestamptz,
  ADD COLUMN IF NOT EXISTS campaign_holdout_pct smallint CHECK (campaign_holdout_pct BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS send_priority_order text[];
CREATE TABLE IF NOT EXISTS ad_send_marks (
  id          bigserial PRIMARY KEY,
  company_id  uuid        NOT NULL,
  batch_id    uuid        NOT NULL,
  campaign_id uuid,
  branch      varchar(20) NOT NULL,
  kind        varchar(20) NOT NULL CHECK (kind IN ('global_holdout', 'priority', 'fatigue', 'campaign_holdout', 'campaign_treated', 'reserved')),
  phone       varchar(20) NOT NULL,
  send_day    date        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_send_marks_batch_phone_kind_day ON ad_send_marks (batch_id, phone, kind, send_day);
CREATE UNIQUE INDEX IF NOT EXISTS ad_send_marks_arm ON ad_send_marks (batch_id, phone) WHERE kind IN ('campaign_holdout', 'campaign_treated');
CREATE INDEX IF NOT EXISTS ad_send_marks_campaign ON ad_send_marks (campaign_id, kind) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ad_send_marks_reserved ON ad_send_marks (company_id, phone, send_day) WHERE kind = 'reserved';
CREATE INDEX IF NOT EXISTS ad_send_marks_phone ON ad_send_marks (company_id, phone, created_at);
CREATE TABLE IF NOT EXISTS ad_gate_failures (
  id         bigserial PRIMARY KEY,
  company_id uuid        NOT NULL,
  branch     varchar(20) NOT NULL,
  error      varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_gate_failures_company ON ad_gate_failures (company_id, created_at);
COMMIT;
```

### C110-H1 · 한줄로 배포(광고 관문 · 효과 증명 · 여정 대조군 결함 A ~ F · 백엔드 + 프론트)
- 카드: C110
- 단계: 한줄로 배포
- 선행: C110-DDL-1 · 커밋(Harold) · ★1107 Harold 「배포 너무 자주 하지 말고」 = 로드맵 3순위가 닫히면 그 묶음과 한 배포
- 기대: 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md · ★1107 C113 D23 정정 = 미가입 · 새 기능을 안 켠 회사의 발송 = HEAD 그대로(피로도 = 그 입구의 HEAD 블록 그대로 · 서버 적재 확정 · 플래너 · 대행 · DM 에 피로도 새로 0) · 새 기능 = 요금제를 쓰고 켠 회사만
- 확인: pm2 기동 · 에러 로그 · 기동 뒤 첫 광고 발송 로그에 「C110-DDL-1 전」 경고가 없어야 함(있으면 DDL 이 안 들어간 것)
- 결과: 1107 Harold = 배포 1(4ffe7988 · C112 · C113 과 한 창) · 서버 pull · 백엔드 · 프론트 build:safe · pm2 reload · online ↺60 · unstable 0 · 에러 로그 reload 뒤 0줄 · ad-send-gate 줄 0(「C110-DDL-1 전」 경고 0) · 적재 중 캠페인 0 → 서버 단계 통과 · 남은 = 첫 광고 발송 뒤 같은 줄 세기 · 직원 시트 C110-S3 · 23:27 restart --update-env(원장 restart-env) · online ↺61 · 에러 로그 0줄

### C110-S3 · 실측(직원 시트 · 설계서 §11 · 실측 1건 = 시험 회사 200명 · 20%)
- 카드: C110
- 단계: 배포 뒤
- 선행: C110-H1 · C110-S2
- 기대: 설계서 §11 1 ~ 10 전부 맞음 · 실측 = 원장 campaign_holdout N · campaign_treated 200 − N · 큐 적재 = 200 − N · 차감 = 적재 수 × 단가
- 확인: 시트 결과 · 다름이면 캡처
- 결과:

### C112-S0 · 키트 로고가 있는 회사 수(사전 실측 · 설계서 D13 기존 동작 바뀜 대상)
- 카드: C112
- 단계: 사전 실측(읽기만)
- 선행: 없음
- 기대: 서버 셸 = docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT COUNT(*) FILTER (WHERE jsonb_typeof(brand_kit) = 'object' AND NULLIF(btrim(brand_kit->>'logo_url'), '') IS NOT NULL) AS kit_logo, COUNT(*) FILTER (WHERE jsonb_typeof(brand_kit) = 'string') AS string_kits, COUNT(*) AS companies FROM companies;"
- 확인: kit_logo = 배포 뒤 다음 생성부터 포스터에 로고가 얹혀 나오는 회사 수 · string_kits 가 0 이 아니면 그 회사 키트도 로고를 읽는다(읽기 CT 가 문자열을 풀어 읽는다 · 설계서 D4)
- 결과: 1107 Harold = kit_logo 1 · string_kits 0 · companies 148 → 다음 생성부터 포스터에 로고가 기본으로 얹히는 회사 1

### C112-H1 · 한줄로 배포(이미지 스튜디오 브랜드 로고 층 · 백엔드 + 프론트 · DB 변경 0)
- 카드: C112
- 단계: 한줄로 배포 = **C110-H1 과 한 배포**(★1107 Harold 「배포 너무 자주 하지 말고」 · 로드맵 합의 배포 1 = C110 + 3순위)
- 선행: C112-S0 · 커밋(Harold)
- 기대: 설계서 docs/2026-11-07-c112-studio-brand-logo-design.md · 새 주소 POST /api/image-studio/layers · /logo/read · /save 에 layers(없으면 지금 그대로) · 새 폴더 uploads/studio-logos(처음 쓸 때 생긴다 · 설정 변경 0)
- 확인: pm2 기동 · 에러 로그 · 스튜디오 포스터 하나 만들어 결과 카드에 로고 줄이 보이는지(키트 로고 없는 회사 = 「브랜드 키트에 로고가 없어요」)
- 결과: 1107 Harold = 배포 1(4ffe7988 · 위와 같은 창) · online · 에러 로그 reload 뒤 0줄 → 서버 단계 통과 · 남은 = 스튜디오 포스터 결과 카드 로고 줄 = 직원 시트 C112-S1 · 23:27 restart --update-env(원장 restart-env) · online ↺61 · 에러 로그 0줄

### C112-S1 · 직원 시트(설계서 §7 1 ~ 8)
- 카드: C112
- 단계: 배포 뒤
- 선행: C112-H1
- 기대: 설계서 §7 1 ~ 8 전부 맞음(크레딧 = 생성 2 만 · 로고 바꾸기 0 · 저장본 = 카드에 보이던 그대로)
- 확인: 시트 결과 · 다름이면 캡처
- 결과:

### C113-S0 · 대조군 · 우선순위를 저장한 회사 수(사전 실측 · 읽기만)
- 카드: C113
- 단계: 사전 실측(읽기만)
- 선행: 없음
- 기대: 서버 셸 = docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "SELECT count(*) FILTER (WHERE global_holdout_pct IS NOT NULL OR global_holdout_since IS NOT NULL OR campaign_holdout_pct IS NOT NULL OR send_priority_order IS NOT NULL) AS set_rows, count(*) AS companies FROM companies;" → set_rows 0
- 확인: set_rows 0 = 배포 뒤 모든 회사가 옛 길(HEAD 발송 그대로)로 시작 · 0 이 아니면 그 회사의 요금제부터 본다(미가입이면 D1 이 관문을 끈다)
- 결과: 1107 Harold = set_rows 0 · companies 148 → 배포 뒤 모든 회사가 옛 길(HEAD 발송 그대로)로 시작 · 대조군 · 우선순위 칸을 저장한 회사 0

### C113-H1 · 한줄로 배포(C110 · C112 구조체크 처방 25건 · 두 길 · 백엔드 + 프론트 · DB 변경 0 · ENV 0)
- 카드: C113
- 단계: 한줄로 배포 = **C110-H1 · C112-H1 과 한 배포**(배포 1)
- 선행: C113-S0 · 커밋(Harold · C110 + C112 + C113 경로 지정)
- 기대: 설계서 docs/2026-11-07-c113-structure-fix-design.md · 미가입 · 직접발송만 쓰는 회사 = HEAD 와 글자 그대로(직접 동기 · 건수 미리보기 · 서버 적재 확정 · 예약 변경 · 수신자 삭제 · 취소 · 응답 · 큐 · 차감) · 새 주소 POST /api/image-studio/logo/use · /logo/read 응답 = 후보(키트 쓰기 0)
- 확인: pm2 기동 · 에러 로그 · 미가입 시험 계정 직접발송 10명 응답 문장에 「대조군」 · 「우선순위」 0 · 설정에 「효과 측정 대조군」 칸 없음
- 결과: 1107 Harold = 배포 1(4ffe7988 · 위와 같은 창) · online · 에러 로그 reload 뒤 0줄 · ad-send-gate 줄 0 → 서버 단계 통과 · 남은 = 미가입 시험 계정 직접발송 응답 문장 · 설정 화면 = 직원 시트 C113-S1 · 23:27 restart --update-env(원장 restart-env) · online ↺61 · 에러 로그 0줄

### C113-S1 · 직원 시트(설계서 §7 1 ~ 14)
- 카드: C113
- 단계: 배포 뒤
- 선행: C113-H1
- 기대: 설계서 §7 1 ~ 14 전부 맞음
- 확인: 시트 결과 · 다름이면 캡처
- 결과:

### C111-S0 · 배포 전 운영 확인(읽기 · .65 게이트웨이 DB)
- 카드: C111
- 단계: 배포 전(읽기만)
- 선행: 커밋(Harold) · check.sh · --pg
- 기대: ① provider_result_code_map 리포트 유형 = 'any' 뿐(104 전 · 'any' · 'ack' 밖 행이 있으면 접수 실패에서 그 행이 빠지는지 설계로 되돌아간다) ② 실패를 번역하는 mapped 에이전트(정책 mapped + 실패 고객 행 1 이상) = 한줄로 네 대뿐(콜비서 = 실패 고객 행 0) ③ 그 네 대의 숫자 아닌 활성 실패 행 = 0(104 문 ②)
- 확인: 조회 출력(명령 = 배포 시작 때 하나씩)
- 선행 결과(1106 Harold 노트북): 게이트웨이 커밋 50f666b(39 파일 · 콜비서 세션 status 5 · tools 1 제외) · check.sh 1차 = API 3건 실패(agent-install-bundle · reconcile-verify-script · zip-writer · 셋 다 `AssignProcessToJobObject: (87)` · EXIT 3) → 같은 창에서 진짜 python3(`/c/Users/ceo/AppData/Local/Python/bin`)를 PATH 앞에 두면 셋 다 통과(스토어 별칭 python3 를 띄우는 연속 호출에서 남 · 이번 코드 무관) → `PATH=… PYTHON_BIN=python check.sh` = GW_CHECK_OK · `GOFLAGS=-p=1 … --pg` = GW_PG_CHECK_OK 1952 · 건너뜀 0 · push 16a7173..50f666b
- 결과: 1106 Harold .65 = ① 리포트 유형 any 593 한 줄 → 통과 ② 한줄로 네 대 = 실패 262 · 숫자 아님 0 · 대역 262 → 통과 · **콜비서 세 대 = 실패 고객 행 80 씩(숫자 아님 0 · 대역 0) = 설계 전제(성공만)와 다름** → 5-a 실측 = 80 행 전부 에이전트 전체(all) · 코드 = QTmsg 번호(SMS_0011 → 11 · LMSMMS_3006 → 3006 …) · V9000 · V2000 · V2500 · V2600 · V2700 · V2800 행 없음 · 세 대 같은 82 행(성공 6 · 1000 포함) → 104 문 ① · 감사 CODE 가 한줄로 대역 규칙을 모든 번역 에이전트에 요구해 콜비서에서 멈춤 · 경보 → 처방(Harold 「제대로」) = 문 ① = 옛 표준(미분류 V9000 + 같은 원시 코드의 리포트 행 표준 전부)을 번역하던 에이전트만 대상 표준 행 요구 · 감사 CODE = 미분류 V9000 을 번역하는 에이전트만 · 실 PG 사례 둘 · 감사 PG 사례 둘 · 게이트웨이 새 커밋 필요(push 전 check · --pg)

### C111-G1 · 게이트웨이 마이그레이션 103(표준 코드만 · 동작 변화 0)
- 카드: C111
- 단계: 게이트웨이 DB
- 선행: C111-S0
- 기대: standard_result_code 18 행 추가(V2850 · V9150 · KAKAO 16) · 매핑 행 0 · 함수 그대로 · 적용 안 DO 확인 통과
- 확인: 적용 출력 · SELECT count(*) FROM standard_result_code WHERE standard_code IN (18) = 18
- 결과: 1107 Harold .65 = 서버 소스 사본 pull 1차 실패(`.git/objects` 안 root 소유 35 = 예전 root git 흔적) → `.git` 안 root 소유만 invito 로 · 작업 트리 root 소유 = C108 에이전트 산출물(`deploy/agent`) + 소스 4 파일 → 소스 4 만 invito 로(산출물 손대지 않음) · 가드(`deploy/agent` 밖 root 소유 0) 뒤 pull 8e47013..a1c7f6f Fast-forward · 103 `--single-transaction` = INSERT 0 18 · DO · added_18 = 18 · mapping_rows_104 = 0 → 통과

### C111-G2 · 한줄로 네 대 대역 DML 다시(scripts/gw/customer-failure-codes-hanjul.sql · 에이전트 하나씩)
- 카드: C111
- 단계: 게이트웨이 DB
- 선행: C111-G1
- 기대: 대마다 새 표준 18 의 대역 행 추가(있는 행 그대로 · ON CONFLICT DO NOTHING) · 「대역이 아닌 실패 매핑」 멈춤 0 · 104 문 ①이 볼 에이전트 전체 숫자 행 = 104 대상 실패 표준 전부
- 확인: 대마다 적용 출력 · 대역 행 수(262 → 280)
- 결과: 1107 Harold .65 = 네 대 각각 SELECT 280 · INSERT 0 18 · DO · COMMIT · band_rows 280 × 4(hanjul01 rows_other 71 = C107 때 끈 0708 행 · 성공 행) → 통과

### C111-G3-0 · 104 미리 돌리기(운영 · 끝을 ROLLBACK 으로 · 바뀌는 것 0)
- 카드: C111
- 단계: 게이트웨이 DB(읽기와 같음 · 한 트랜잭션 · ROLLBACK)
- 선행: C111-G2
- 기대: 서버 소스의 104 파일 끝 `COMMIT;` 을 `ROLLBACK;` 으로 바꿔 흘린다 → 첫 줄 문 통과(콜비서 · 한줄로 네 대 · 출력에 RAISE 없음) · 마지막 ROLLBACK · 뒤 확인 = result_code_report_key 없음 · 매핑 행 note '104 결과코드 매핑(1106)' 0. 문이 멈추면 출력의 에이전트:표준 목록으로 정한다(콜비서 = 카카오 실측 · 행 추가 여부)
- 확인: 출력 · 뒤 확인 조회
- 결과: 1107 Harold .65 = 1차 미리 돌리기 = 문 ① 멈춤 · 콜비서 세 대 × KAKAO_3000_UNEXPECTED · V2000 · V2800 · V2850(옛 표준 = 같은 숫자의 젬텍 lms_mms 2000 · 2001 · 2002 · 3000 · 4000 · 9001 행 표준을 콜비서가 번역) · 운영 변화 0(fn_absent t · rows_104 0) → 콜비서 요청 실측 = callbiseo-3 sms 6건(1106)뿐 · 카카오 0 · Harold 「장문 · 단문만 · 카카오 아예 안 씀」 → 콜비서 세 대 × 네 표준 에이전트 전체 행 '9999' 명시(note 'C111 콜비서 SMS · LMS 전용(카카오 0 · 1106 실측) = 9999 명시 · 104 전후 같은 결과' · INSERT 0 12 · 행 없음 = 9999 와 같은 값) → 2차 미리 돌리기 = DO · INSERT 0 60 · DO · CREATE FUNCTION · COMMENT · CREATE FUNCTION · DROP TABLE · ROLLBACK · fn_absent t · rows_104 0 → 통과

### C111-L1 · 운영 대역 표 → 한줄로 라벨 파일 대조
- 카드: C111
- 단계: 게이트웨이 DB 읽기 → 로컬
- 선행: C111-G2
- 기대: 운영 게이트웨이 DB 에서 gen-result-code-hanjul-band.mjs 의 BAND_SQL 을 COPY TO STDOUT 으로 뽑아 --tsv 로 다시 만든 파일 = 커밋된 생성 파일(280 · 줄 같음 · diff 0). 다르면 그 파일로 바꿔 H1 에 싣는다
- 확인: 줄 수 · diff 출력
- 결과: 1107 Harold .65 = 운영 BAND_SQL(btrim 제목) COPY 280 줄 · md5 a90cb2f2bd10e277fae140c92d2e619e = 커밋할 라벨 파일의 표(band_1106.tsv)와 같음 → 통과

### C111-H1 · 한줄로 배포(대역 라벨 280 · 라벨 없는 대역 경보 · DDL 0)
- 카드: C111
- 단계: 한줄로 배포(적재 0 조건 재시작)
- 선행: C111-L1 · 커밋(Harold)
- 기대: 새 대역 코드(52850 · 59150 · 2xxxx 16 · 운영에서 빠졌던 18)가 화면에 글로 보인다 · 스팸 몰림 목록에 40052 · 40053 · 기동 뒤 에러 로그 0 · 감시 로그에 「대역 라벨 없음 통지」가 나오면 그 코드로 L1 다시
- 확인: pm2 기동 · 에러 로그
- 결과: 1107 Harold = 한줄로 경로 지정 커밋 6d04f394(8 파일 · C110 섞인 넷 뺌 · pre-push 시험 통과) push c7b4ff35..6d04f394 · .62 pull Fast-forward · 백엔드 build:safe · loading=0 → pm2 reload targetup-backend · online · created at 2026-11-07T00:04:56Z · unstable 0 · 에러 로그 0줄 → 통과

### C111-G3 · 게이트웨이 마이그레이션 104(매핑 · 열쇠 함수 · customer_failure_code 다시 · 첫 줄 문)
- 카드: C111
- 단계: 게이트웨이 DB
- 선행: C111-H1 · C111-G3-0 통과
- 기대: 첫 줄 문 통과(멈추면 출력의 에이전트:표준 목록을 G2 로 채우고 다시 · 적용 0) · 매핑 행 = m104_rows 전부 활성 · 사후 대조 통과 · result_code_report_key(4 인자) · customer_failure_code 본문 = 100 + 열쇠 두 줄 · 엔진 재시작 0(같은 이름 · 같은 인자)
- 확인: 적용 출력 · 함수 · 행 수 확인
- 결과: 1107 09:07:04 Harold .65 = INSERT 0 50 · INSERT 0 10 · DO(문) · INSERT 0 60 · DO(사후 대조) · CREATE FUNCTION · COMMENT · CREATE FUNCTION · DROP TABLE · COMMIT · key_fn t · rows_104 60 · 함수 100 안 열쇠 호출 2 · 2분 뒤 게이트웨이 ERROR 0 · 적용 뒤 결과 hanjul02 12 건 전부 고객 코드 번역(9999 0 · 원 코드 0) → 통과

### C111-G4 · 관리 API + 대시보드(런북 §3-1 · §3-2)
- 카드: C111
- 단계: 게이트웨이 관리 API · 대시보드 배포
- 선행: C111-G3(API 가 result_code_report_key 를 부른다 · 104 전이면 조회가 깨진다)
- 기대: 메시지 이력 · 공개 API · 웹훅 · 통계 실패 표 정상(새 PID 에러 0) · 정합성 감사 CODE 항목 경보 0 · 대시보드 13 화면 쪽 번호 · 결과코드 엑셀 받기
- 확인: 런북 확인 줄 · 에러 로그
- 결과: 1107 Harold = 관리 API 14 파일(§3-1-b · 폴더 하나 업로드 · ALL_HASH_OK · GW_DEPLOY_OK 14 = 신규 pagination.js 1 · 교체 13 · 롤백 0 · 09:15:41 ~ 09:16:11 · API_UPLOAD_CLEAN · 150 초 뒤 새 PID 2503159 ERROR 0) · 대시보드(§3-2 · build 52 files · manifest ac4ea6e8a4f9 · 서버 검증 52 · 52 · manifest · deploy.sh 일치 · GW_DEPLOY_OK dashboard · exit 0 · 백업 deploy-backups/20261107-092249) → 통과(업로드 정리 = 다음)

### C111-S1 · 실측(직원 시트 65 ~ 67 · 운영 대조)
- 카드: C111
- 단계: 배포 뒤
- 선행: C111-G4
- 기대: 시트 65 ~ 67 전부 맞음 · 운영 대조 = G3 뒤 휴머스온 접수 실패(원장 접수 코드 = 리포트 코드 = 4000 류) 건의 report_queue.customer_code = 대역(52000 등 · 9999 아님) · 한줄로 화면 라벨 = 「발송: 요청 형식 오류」 류
- 확인: 시트 결과 · 조회 출력
- 결과:

### C114-H1 · 한줄로 배포(로드맵 V2 · 인앱 결함 수정 · 할인 템플릿 8종 · 글자 바닥 · 백엔드 + 프론트 + SDK 서빙 파일 · DDL 0 · ENV 0)
- 카드: C114
- 단계: 한줄로 배포
- 선행: 커밋 b374ed44(Harold · 53 경로 · 다른 세션 문서 4 뺌) → push
- 기대: 설계서 docs/2026-11-08-c114-roadmap-v2-design.md · 새 주소 GET /api/cdp/inapp/webview(CSP connect-src none) · backend/sdk-serving 네 폴더 = renderInAppForHost 포함 · caps 없는 옛 앱 = 숨기던 모양(통짜 · 2장 이상 카드 · 띠)도 내려감(띠 = 글 줄) · 스튜디오 「할인 포스터」 탭 · 미가입 · 직접발송만 = 변화 0
- 확인: 서버 HEAD · pm2 기동 · 에러 로그 → 웹뷰 주소 응답 헤더 → 서빙 SDK 파일 → 팝폰(지금 설치판 · caps 없음)에서 테스트계정 헬로윈파티 노출
- 결과: 1108 Harold = 서버 pull · build:safe 둘 · reload → HEAD b374ed44(2026-11-08 07:59:40 +0900) · targetup-backend online ↺62 · 에러 로그 0줄 → 서버 단계 통과 · 남은 = 웹뷰 헤더 · 서빙 SDK · 팝폰 노출 · ★같은 확인 중 Harold 지적 셋(제작 화면 여백 · 장면 힌트 안내 · 할인 템플릿이 제품 지정형) = C114 보정 · 웹뷰 주소 = HTTP 200 · text/html · CSP default-src none · script-src self + nonce · connect-src none(설계 K9 와 같음) · X-Content-Type-Options 두 줄(무해 · 기록만) · 서빙 SDK v0.3.11 = renderInAppForHost 1 · 남은 = 팝폰 노출(기기)

### C114-S1 · 할인 예시 그림(배포 뒤 · OpenAI · 장당 약 $0.067 × 8)
- 카드: C114
- 단계: 배포 뒤
- 선행: C114-H1
- 기대: scripts/discount-template-samples.ts --save = 할인 8종 예시 저장 · 세트 템플릿 샘플 확인
- 확인: 스크립트 출력 · 갤러리 카드
- 결과: 1108 Harold = 8장 생성(GPT · C118-H2 결과 줄) → 세트 업종 섞임 · 브랜드 이름 반려 → C119 에서 8종 보편화 + 24장 다시 생성(C119-H1 결과 · `_log.txt` 「실제엔진=openai · 예시 저장」 24줄) · 갤러리 눈 확인(Harold 1108)

### C114-P1 · 팝폰 웹뷰 호스트(스토어 빌드 · OTA 아님)
- 카드: C114
- 단계: 배포 뒤
- 선행: C114-H1 · react-native-webview 접목 관문(네트워크 · 비밀값 · 자동 실행 증거 · Harold 동의)
- 기대: 팝폰 인앱 폴더 커밋 · 설치 · 스토어 빌드 → caps=webview · 모든 모양 그대로
- 확인: 새 판 설치 기기에서 통짜 · 카드 · 띠 노출
- 결과:

### C116-H1 · 한줄로 배포(인앱 구워 보내기 · 백엔드 + 프론트 + SDK 서빙 파일 · DDL 0 · ENV 0)
- 카드: C116
- 단계: 한줄로 배포
- 선행: 커밋 ca7c99cd(Harold · 35 경로 · C117 파일 뺌) → push
- 기대: 설계서 docs/2026-11-08-c116-inapp-bake-design.md · caps 없는 옛 앱 = 새 모양(틀 · 띠 · 통짜 · 카드)이 구운 그림으로 내려감 · 그림 맞춤 ?fit=inapp(1:1 + 안전 칸) · 바로가기 · 오늘 하루 보지 않기 · 닫기 = 앱 버튼 그대로 · caps 보내는 앱 · 미가입 · 직접발송만 = 변화 0
- 확인: 서버 HEAD · pm2 기동 · 에러 로그 → 테스트계정 헬로윈파티 다시 게시 한 번 → 서버 uploads/inapp/<회사>/bake-*.json · jpg 생김 → 팝폰(지금 설치판)에서 잘림 없이 새 모양 · 바로가기 동작
- 결과: 1108 Harold = 서버 pull · build:safe 둘 · reload → HEAD ca7c99cd(2026-11-08 13:05:29 +0900) · targetup-backend online ↺66 · unstable 0 · 에러 로그 0줄 → 서버 단계 통과 · 굽기 = 팝폰 열람 요청으로 13:19:01(1310ms) · 13:19:28(930ms · 통짜 포스터 카드로 고친 뒤 새 열쇠) 3장씩 · jpg 셋 + json 생김 · 팝폰 = 포스터 통째(잘림 0) · ★Harold 「이렇게 밖에 안된다」 = 편집기 모습(가운데 카드 · 1/3 · 카드 안 버튼)이 아니라 바닥 시트 · 원인(설치판 소스맵 = 지금 InAppBottomSheet.tsx 와 같음) = 2장 이상은 바닥 시트 캐러셀 서랍 하나뿐 · 가운데 모달은 한 장만 → 그릇은 앱이 정함 · 처방 대기
### C117-H1 · 한줄로 배포(오류접수 다섯 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C117
- 단계: 한줄로 배포
- 선행: 커밋 da9baa11(Harold · C117 경로 28 · 인앱 · 다른 세션 문서 뺌) → push
- 기대: 설계서 docs/2026-11-08-c117-intake-five-design.md · 여정 A/B 칸 스팸 검사 · 켜기 통과 · 브랜드 인증번호 칸 0 · 대체 발송 화면 겹침 0 · 스크롤 · 이름 칸 · 통계 대상 이름 · 수신번호별 친구 / 비친구 · 미가입 · 직접발송만 = 변화 0
- 확인: 서버 HEAD · dist 표식(withFriendYnField · 「번호 · 이름 검색」) · pm2 기동 · 에러 로그 → 직원 지시문 1 ~ 15(로드맵 묶음 끝 시트)
- 결과: 1108 Harold = 서버 pull · build:safe 둘 · reload → HEAD da9baa11(2026-11-08 13:34:41 +0900) · 백엔드 dist 표식 3 · 프론트 dist 표식 1 · targetup-backend online ↺67 · unstable 0 · 에러 로그 0줄 → 서버 단계 통과 · 직원 확인 대기

### C116-H2 · 한줄로 배포(C116-B 옛 연동 앱 출력 공통 규칙 · 백엔드 + 프론트 + SDK 서빙 파일 · DDL 0 · ENV 0)
- 카드: C116
- 단계: 한줄로 배포
- 선행: C116-H1 · 커밋 c70830be(Harold · 33 경로 · 다른 세션 파일 뺌) → push
- 기대: 설계서 docs/2026-11-08-c116b-inapp-universal-output-design.md · caps 없는 앱 = 구운 그림이 정사각 최종본(어두운 무대 위 카드 · 흰 귀퉁이 0 · 흐림 0) · 대체 그림 주소 ?fit=inapp&fr=2 · 편집기 「구버전 앱 모습」 = 같은 모습 · 관리 화면 앱 연동 안내 = 정사각 · 가운데 80% 문장 · caps 있는 클라이언트 · 미가입 · 직접발송만 = 변화 0
- 확인: 서버 HEAD · pm2 기동 · 에러 로그 → 팝폰 실행 한 번 → 서버 bake-*.jpg 새 열쇠 생김(정사각) → 팝폰 두 번째 실행에서 무대 위 카드 · 잘림 0
- 결과: 1108 Harold = 서버 pull · build:safe 둘 · reload → HEAD c70830be(2026-11-08 14:58:22 +0900) · online ↺68 · unstable 0 · 에러 로그 0줄 → 서버 단계 통과 · 굽기 = 15:08:19 · 15:08:53 · 15:09:33 세 열쇠 1400×1400 · 팝폰 = 무대 위 카드 · 잘림 0 · ★Harold 품질 반려(어두운 무대 위 작은 그림 · 「저딴 퀄리티」) → C118(스튜디오 인앱용 정사각 + 여백 0)

### C118-H1 · 한줄로 배포(이미지 스튜디오 용도별 제작 + 앱 채널 모양 넷 + 인앱용 그림 여백 0 · 백엔드 + 프론트 + SDK 서빙 파일 · DDL 0 · ENV 0)
- 카드: C118
- 단계: 한줄로 배포
- 선행: C116-H2 · Codex 구현 3R approve · 커밋 5fc2d527(Harold · 48 경로 · 다른 세션 파일 뺌) → push
- 기대: 설계서 docs/2026-11-08-c118-studio-per-use-inapp-app-design.md · 스튜디오 「만들기」 = 「어디에 쓸 그림인가요?」 넷 · 고른 수 × 2크레딧 · 인앱용 = 정사각 · 영구 이름 `.full.` · 만드는 중 안내 = 흰 카드 · 앱 채널 모양 = 넷 · 인앱용 그림 = 옛 연동 앱에 여백 0(통짜 = 원본 ?fit=inappfull&fr=1 · 사진 위 글 = 굽기 판 3) · [반영] 뒤 「앱 화면 준비됨」 · 웹 채널 · 미가입 · 직접발송만 = 변화 0
- 확인: 서버 HEAD · pm2 기동 · 에러 로그 → 스튜디오 인앱용 1장 실제 생성(약 $0.07 · 승인됨) → 영구 파일 이름 `.full.` → 앱 채널 통짜 포스터 게시 → 팝폰 완전히 껐다 켜기 = 그림 칸에 꽉 · 어둠 0
- 결과: 1108 Harold = pull 이 서버 작업 사본 packages/backend/src/routes/image-studio.ts(544행 주석에 │ 한 글자 · 동작 무관)에 막힘 → 그 파일 checkout 뒤 pull → HEAD 5fc2d527(2026-11-08 17:25:05 +0900) · build:safe 둘 · reload → targetup-backend online ↺70 · created at 2026-11-08T08:36:43Z · unstable 0 · reload 뒤 에러 로그 0줄(남은 줄 = 16:13 엑셀 암호 파일 업로드 · 그 전 것) · 서버 사본 packages/sdk-js/package-lock.json 수정 = 그대로 둠 → 서버 단계 통과 · 인앱용 실제 생성 1장(Harold · 할인 템플릿 · 정사각 확인) · 실사용 시험 접수 6건 → C118-H2

### C118-H2 · 한줄로 배포(C118 실사용 시험 보정 6건 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C118
- 단계: 한줄로 배포
- 선행: C118-H1 · Codex 설계 2R · 구현 3R approve · 커밋 b05a4dca(Harold · 21 경로 · 다른 세션 파일 뺌) → push
- 기대: 설계서 §10 · 스튜디오 만드는 중 안내 = 「인앱 메시지용 포스터를 만들고 있어요」(여러 장 = 「N장 중 i번째」) · 결과 로고 = 꺼진 채 · 할인 템플릿 인앱 = 글 자리 「위(고정)」 · 장 목록 줄마다 빼기 · 앱 가운데 팝업 · 하단 시트 = 미리보기 원본 비율 · 잘리는 사진이면 안내 창 · 디자인 탭 안내 줄 · 웹 채널 · 포스터 · 미가입 · 직접발송만 = 변화 0
- 확인: 서버 HEAD · pm2 기동 · 에러 로그 → 스튜디오 만드는 중 안내 줄 · 로고 꺼짐 → 인앱 편집기 장 목록 빼기 → 앱 채널 포스터 → 가운데 팝업 바꾸기 = 세로 사진이면 안내 창
- 결과: 1108 Harold = 서버 pull · build:safe 둘 · reload → HEAD b05a4dca(2026-11-08 19:24:11 +0900) · targetup-backend online ↺71 · created at 2026-11-08T10:29:54Z · unstable 0 · reload 뒤 에러 로그 0줄(남은 줄 = 16:13 엑셀 암호 파일 · 그 전 것) → 서버 단계 통과 · 화면 = 만드는 중 안내 · 로고 꺼짐 확인(Harold) · 할인 8종 예시 GPT 생성(C114-S1 · Harold) = 세트 업종 섞임 · 브랜드 이름 → C119

### C121-H1 · 한줄로 배포(인비토 합성 데이터 v3 1층 · 백엔드만 · DDL 0)
- 카드: C121
- 단계: 한줄로 배포
- 선행: Codex 설계 3R · 구현 3R approve · 커밋(Harold · 5 경로 · 다른 세션 파일 뺌) → push
- 기대: 설계서 docs/2026-11-10-synthetic-company-realism-design.md · 인비토(허용 목록 · 시연 아님)만 v3 · 시연 회사 v2 그대로 · 실제 고객사 변화 0 · ENV 넣기 전 = 매장 갈래만 v3(다음 07:00 tick) · 온라인 갈래 꺼짐
- 확인: 서버 HEAD · pm2 기동 · 에러 로그 · 기동 로그 「합성 데이터 워커 시작(매일 07:00 KST 이후 1회 · 키 2개 · 자사몰 키 0개)」
- 결과: 1110 Harold = push · 서버 pull · 백엔드 build:safe · pm2 reload → HEAD d7a97ce5(2026-11-10 13:00:22 +0900) · src grep pushRealismOnline 2 · targetup-backend online ↺80 · unstable 0 · 13:09:26 「합성 데이터 워커 시작(매일 07:00 KST 이후 1회 · 키 2개 · 자사몰 키 0개)」 · 재기동 뒤 에러 로그 0줄 → 서버 단계 통과 · 매장 갈래 v3 = 다음 07:00 tick 부터(C121-S1)

### C121-A1 · 인비토 자사몰 키 쓸 수 있나(요금제 활성 유료 · 월 자사몰 호출 한도 · K10)
- 카드: C121
- 단계: 배포 뒤
- 선행: C121-H1
- 기대: 서버 셸 한 줄(읽기만) = 인비토 회사의 plans.plan_code · 활성 유료 판정(ACTIVE_PAID_PLAN_WHERE) · plans.cdp_events_per_month · 이번 달 cdp_api_call_log 합 · 하루 약 330 사건 + 회원 잇기 = 한 달 약 1만 2천 호출이 한도 안
- 확인: 활성 유료 t · 한도 ≥ 이번 달 합 + 15,000 이면 C121-ENV-1 로 · 아니면 멈추고 Harold 판단
- 결과: 1110 Harold 서버 출력 = plan_code STAFF · subscription_status paid · active_paid t · monthly_limit NULL(무제한) · used_this_month 0 · has_cdp_key f · app_ids 0 → 통과 · 같은 출력 users = mobile admin · gwchae · sgbaek · suran user(인앱 메뉴 = 관리자만 · 담당자 403 · routes/cdp.ts 1295 · 1391)

### C121-ENV-1 · SYNTHETIC_CDP_KEYS(인비토 자사몰 키 · 합성 데이터 온라인 갈래)
- 카드: C121
- 단계: ENV
- 선행: C121-A1 · 인비토 자사몰 키 발급(화면 「자사몰 연동」 /cdp-settings · 비밀은 화면 1회 표시) · 등급 서열 등록은 뺌(1110 Harold 「등급순서 그런 거 자체가 없다」 = 여는 자리 0 · 등급 상승 여정을 켤 때 필요 · 데이터 층은 등급 서열 없이 돈다)
- 의미 바꿈: 예(인비토에 자사몰 방문 · 상품 조회 · 담기 · 결제 시작 · 주문이 10분마다 쌓인다 · 하루 약 330 사건 · 약 5 주문 · 비어 있으면 온라인 갈래 꺼짐 = 지금 동작)
- 기대: 「hjl_키:sk_비밀」 한 쌍 · 비밀값(출력 금지)
- 확인: restart --update-env 뒤 기동 로그 「자사몰 키 1개」 · 10분 안에 「자사몰 합성 · 보냄 N · 미룸 M」 · 「자사몰 합성 전송 실패」 0줄
- 결과: 1110 Harold = 인비토 자사몰 키 발급(화면) → 서버 .env 저장 스크립트(꼴 hjl_ · sk_ 64자 · 퍼블릭키 회사 = c7c97996 · 시크릿 bcrypt 짝 대조 통과 · .env 백업) = 「저장됨 · SYNTHETIC_CDP_KEYS 줄 1개 · 값 길이 136」 · 1110 13:22 restart --update-env(적재 0건 확인 한 줄 · loading=0 · ↺81 online) → 13:22:54 「자사몰 키 1개」 · 13:23:54 매장 회차 시연 35 · 35 · 46(v2 그대로) · 인비토 새 고객 0 · 재구매 51 · 구매 100(같은 날 재실행 = 구매 전 쓰기 0 · 13:10 과 같은 값) · 13:27:31 「자사몰 합성 · 보냄 600 · 미룸 179」 · err = 「2026-11-03 미전송 350건 = 7일 창 밖」 1줄(첫 켬 안내) · 실패 0 · 자사몰 연동 화면 「자체 호스팅 / 그 외 자사몰 · 연결됨」(source sdk 24시간 집계) → 통과

### C121-S1 · 실측(배포 다음 날 07:00 뒤)
- 카드: C121
- 단계: 사후
- 선행: C121-H1 (C121-ENV-1 뒤면 온라인 포함)
- 기대: 인비토 = 그날 매장 구매 줄 수 · 한 방문 평균 줄 수 2.6 ~ 3.2 · 덧붙인 줄(demo-v3x) 있음 · 수량 전부 1 · 포인트 있는 고객 > 0 · 등급 4종 분포 · 수신거부 늘어남 · (ENV 뒤) cdp_events page_view · product_view · cart_add · checkout_start · purchase 각 > 0 · 같은 event_key 2행 이상 0
- 확인: 서버 셸 SQL(그날 안내) · 시연 회사(hanjulai) 그날 구매 행 키 = demo-v2 만

### C119-H1 · 한줄로 배포(할인 · 혜택 템플릿 24 · 배치 둘 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C119
- 단계: 한줄로 배포
- 선행: C118-H2 · Codex 설계 4R · 구현 2R approve · 커밋 f0e7ea30(Harold · 21 경로 · 다른 세션 파일 뺌) → push
- 기대: 설계서 docs/2026-11-08-c119-discount-templates-20-design.md · 할인 포스터 = 24종 · 이름 · 설명에 업종 말 0 · 「가격 할인 웜 우드」 · 왼쪽 글형 6 · 인앱 용도 = 배치대로 고정 표시 · 다른 트랙 · 미가입 · 직접발송만 = 변화 0
- 확인: 서버 HEAD · pm2 기동 · 에러 로그 → 예시 24장 = 서버 셸 `cd /home/administrator/targetup-app/packages/backend && /usr/bin/ts-node -T scripts/discount-template-samples.ts --save`(OpenAI · 약 $1.61 · 줄마다 실제엔진=openai · 예시 저장) → 갤러리 24장 = 제품 없는 빈 자리 · 「상품명」
- 결과: 1108 Harold = 서버 pull · build:safe 둘 · reload → HEAD f0e7ea30(2026-11-08 20:33:50 +0900) · targetup-backend online ↺72 · created at 2026-11-08T11:40:34Z · unstable 0 · reload 뒤 에러 로그 0줄(남은 줄 = 16:13 엑셀 암호 파일 · 그 전 것) → 서버 단계 통과 · 예시 24장 = Harold 실행 · `_log.txt` 「실제엔진=openai · 예시 저장」 24줄 · 실패 · 대체 0(장당 약 23 ~ 26초) · 갤러리 눈 확인(Harold 1108 「갤러리 전부 눈으로 확인」)

### C118-H3 · 한줄로 배포(모바일 DM 2:3 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C118
- 단계: 한줄로 배포
- 선행: C119-H1 · Codex 구현 2R approve · 커밋 a06e041b(Harold · 10 경로 · 다른 세션 파일 뺌) → push
- 기대: C118 설계서 §11 · 스튜디오 고르기 창 모바일 DM = 「세로 2:3」 · DM 용도 생성 그림 = 2:3 · DM 편집기 안 스튜디오 창 = 2:3 · DM 카탈로그 쪽 창에서 연 스튜디오 = 3:4(판 비율) · 자유 형태 = 3:4 그대로
- 확인: 서버 HEAD · pm2 · 에러 로그 → 스튜디오에서 모바일 DM 1장 생성(2크레딧) = 세로 2:3 · Gemini 대체 경로 2:3 = 미검증(대체가 날 때만)
- 결과: 1108 Harold = 서버 pull · build:safe 둘 · reload → HEAD a06e041b(2026-11-08 21:31:44 +0900) · targetup-backend online ↺73 · created at 2026-11-08T12:43:40Z · unstable 0 · reload 뒤 에러 로그 0줄(남은 줄 = 16:13 엑셀 암호 파일 · 그 전 것) → 서버 단계 통과 · 화면 = 고르기 창 모바일 DM 「세로 2:3」 · Harold 「체크완료」 · Gemini 대체 경로 2:3 = 미검증 그대로(대체가 날 때 확인)

### C122-DDL-1 · MySQL 커밋 기록 표 HANJUL_LOAD_CHUNK(root · 새 표 하나 · 기존 SMSQ 표 변경 0)
- 카드: C122
- 단계: DDL
- 선행: 없음(표가 없으면 새 코드는 옛 방식으로 돈다 = 순서 자유 · 1101 규칙대로 DDL 먼저)
- 의미 바꿈: 아니오(새 표만 · 큐 · 결과 표 변화 0 · smsuser 권한 = smsdb.* 스키마 단위라 따로 줄 것 없음)
- 기대: 접속 꼴 = SCHEMA.md MySQL 절 「DDL 접속」(비밀번호 화면 입력 · 명령 줄 노출 0) · 문장 = `CREATE TABLE IF NOT EXISTS HANJUL_LOAD_CHUNK (campaign_id varchar(50) NOT NULL, first_staging_id bigint NOT NULL, rows_read int NOT NULL, sms_loaded int NOT NULL DEFAULT 0, brand_loaded int NOT NULL DEFAULT 0, committed_at datetime DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (campaign_id, first_staging_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4` · 같은 출력에서 information_schema 확인
- 확인: `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='smsdb' AND TABLE_NAME='HANJUL_LOAD_CHUNK'` = 1행 InnoDB
- 결과: 1110 Harold 서버 출력 = CREATE TABLE IF NOT EXISTS 통과 · information_schema 「HANJUL_LOAD_CHUNK InnoDB」 1행 · smsuser 권한 = SCHEMA_PRIVILEGES 'smsuser'@'%' smsdb SELECT · INSERT · UPDATE · DELETE 넷(새 표 자동 상속) → 통과 · 새 방식 = 백엔드 엔진 확인 캐시(10분) 뒤부터

### C122-H1 · 한줄로 배포(여정 %변수% 통일 · 직접입력 9,999 상한 · 적재 이어 넣기 · 백엔드 + 프론트 · MySQL DDL 1 · ENV 0)
- 카드: C122
- 단계: 한줄로 배포
- 선행: C122-DDL-1 · Codex 여정 · 직접입력 6R approve · 적재 이어 넣기 설계 4R · 구현 2R approve · 커밋(Harold · 다른 세션 파일 뺌) → push
- 기대: 설계서 docs/2026-11-10-load-resume-design.md · 1만 건 묶음 = MySQL 트랜잭션 하나(끊기면 그 묶음 0 · 다시 시작 = 같은 묶음 PK 로 확정) · 여정 문안 = %고객명% 꼴만(Liquid 출구 변환) · 직접입력 창 9,999 넘으면 추가 잠금 + 파일등록 안내 · 미가입 직접발송 동작 변화 0(1만 건 이하 = 묶음 하나 = 옛 결과와 같음)
- 확인: 서버 HEAD · 백엔드 build:safe · 프론트 build:safe · 적재 0건 한 줄 → pm2 reload(dist 실행 · OPS 「★1110 운영 백엔드 = dist」) · 기동 에러 0 · dist grep queueTxReady ≥ 1 · 프론트 dist grep 「그보다 많은 명단은」 ≥ 1(앞 문구 「한 번에 넣을 수 있는 번호는」은 빌드 난독화가 문자열 표로 옮겨 grep 0 · 1110 로컬 빌드 확인)
- 결과: 1110 Harold = push · 서버 pull → HEAD 23ede51c(19:03:02 +0900) · 백엔드 build:safe(dist/utils/queue-load-tx.js 19:11:40 · app.js 19:11:44) · 프론트 build:safe(index.html 19:12:57) · pm2 재시작 19:12:58(같은 id 5 · Stopping → online · 「restarted because … exceeds」 줄 0) · 재시작 뒤 에러 로그 0줄(19:14 합성 데이터 안내 줄만) · 프론트 dist grep 「그보다 많은 명단은」 1 → 서버 단계 통과 · 재시작 전 적재 0건 확인 한 줄은 이번에 안내하지 않음(Harold 직접 진행 · 18:13:54 옛 복구 fac4d140 적재 32,634 / 32,634 = 18:03 강제 재시작 몫)

### C122-S1 · 실측(배포 뒤 첫 1만 건 넘는 직접발송 한 건)
- 카드: C122
- 단계: 사후
- 선행: C122-H1
- 기대: 그 캠페인 HANJUL_LOAD_CHUNK 줄 = 묶음 수만큼 생겼다가 종결 뒤 0 · campaigns 적재 수 = 큐 행 수 · 로그 「보류」 · 「사람 확인」 0
- 확인: 서버 셸 SQL(그때 안내 · smsuser 조회)
- 결과: (대기)

### C122-T1 · 직원 지시문(설계서 §6 · 배포 뒤 한 번)
- 카드: C122
- 단계: 사후
- 선행: C122-H1
- 기대: 설계서 §6 네 줄(인비토 회사 · 파일 3만 줄 예약 → Harold 30초 안 재시작(다른 회사 적재 0건 확인 한 줄 뒤) → 대상 30,000 · 적재 30,000 → 예약 취소 · 대기 0) + 직접입력 창 10,000 = 잠금 · 9,999 = 추가 + 여정 만들기 문안에 {{ }} 0 · %고객명% 만
- 결과: (대기)

### C123-P1 · 배포 전 실측(새 최솟값보다 짧게 저장된 재진입 여정 목록 · 읽기만)
- 카드: C123
- 단계: 배포 앞
- 선행: 없음
- 기대: 서버 셸 한 줄 = `SELECT co.company_name, j.name, j.status, j.trigger_event, COALESCE(j.reentry_cooldown_days,0) AS cd, j.auto_reentry_enabled AS auto FROM journeys j JOIN companies co ON co.id = j.company_id WHERE j.allow_reentry = true AND j.status IN ('active','paused','draft') AND ((j.trigger_event = 'customer.dormant' AND COALESCE(j.reentry_cooldown_days,0) < 7) OR (j.trigger_event IN ('customer.birthday_approaching','customer.points_expiring','customer.created') AND COALESCE(j.reentry_cooldown_days,0) < 1) OR (j.auto_reentry_enabled = true AND COALESCE(j.reentry_cooldown_days,0) < 1)) ORDER BY j.status, co.company_name` · 켜진 실제 고객사 여정이 있으면 배포 전에 목록을 Harold 께 보고(배포 뒤 그 여정은 끝난 뒤 최솟값 동안 다시 넣지 않는다 = 덜 보내는 쪽)
- 확인: 행 = 미달 여정(1110 20시 다른 조건 실측 = 시연 회사 휴면 1건)
- 결과: 1110 Harold 서버 출력 = 6행 — 시연 회사 「휴면 고객 다시 만나기」(켜짐 · 휴면 · 0일) · 시연 회사 「신규 가입 환영」(멈춤 · 가입 · 0일) · 인비토 「고른 고객에게」 넷(초안 2 · 멈춤 2 · 0일) · 자동으로 다시 받기 켠 여정 0 · 실제 고객사 0. → 이 출력으로 설계 정정: 고른 고객에게 최솟값 1 → 0(템플릿 기본이 재진입 켬 · 0일이라 그 넷의 켜기가 거절됐을 것 · 원래 한 번만 들어오는 시작 사건) → 인비토 넷 = 영향 0. 남는 둘(시연 회사) = 휴면 여정은 배포 뒤 끝난 뒤 7일 동안 다시 넣지 않음 · 신규 가입 여정은 다시 켤 때 「최소 1일」 안내 → 통과

### C123-H1 · 한줄로 배포(여정 재진입 대기 최솟값 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C123
- 단계: 한줄로 배포
- 선행: C123-P1(결과 있음) · Codex 설계 2R · 구현 3R approve · 커밋(Harold · 다른 세션 파일 뺌) → push
- 기대: 설계서 docs/2026-11-10-journey-reentry-floor-design.md · 재진입 허용 여정 = 끝난 뒤 계약 최솟값(휴면 7일 · 생일 · 포인트 · 가입 1일 · 사건형 · 고른 고객에게 0) 동안 다시 넣지 않음 · 자동으로 다시 받기 = 재진입 켠 여정만 · 끝난 뒤 최소 1일 · 미가입 직접발송 변화 0
- 확인: 서버 HEAD · 백엔드 build:safe · 프론트 build:safe · 적재 0건 한 줄 → pm2 reload · 기동 에러 0 · dist grep reentryHoldSql ≥ 1 · 프론트 dist grep 「1시간마다 다시 넣어요」 ≥ 1
- 결과: 1110 22:46 백엔드 build:safe 가 한 파일이 깨진 판을 끼움 → 22:47:34 재시작부터 errored(10시간 정지 · C124 카드) → 1111 08:38:07 다시 빌드해 online · 1111 13:55:40 C125-H1 판(백엔드 + 프론트 둘 다 다시 빌드)에 C123 코드 포함 · **미확인 = dist grep 둘(reentryHoldSql · 프론트 문구) · 1110 밤 프론트 빌드 여부** — 서버 출력을 받지 못했다

### C123-S1 · 실측(배포 다음 날 · 휴면 여정 재진입 0)
- 카드: C123
- 단계: 사후
- 선행: C123-H1
- 기대: 서버 셸 한 줄 = `SELECT COUNT(*) AS again FROM journey_executions e JOIN journeys j ON j.id = e.journey_id JOIN companies co ON co.id = j.company_id WHERE j.trigger_event = 'customer.dormant' AND j.allow_reentry = true AND e.entered_at > '<배포 시각>' AND EXISTS (SELECT 1 FROM journey_executions p WHERE p.journey_id = e.journey_id AND p.customer_id = e.customer_id AND p.id <> e.id AND p.status <> 'active' AND COALESCE(p.completed_at, p.entered_at) > e.entered_at - INTERVAL '7 days' AND COALESCE(p.completed_at, p.entered_at) <= e.entered_at)` = 0(배포 뒤 들어온 휴면 여정 실행 가운데 같은 고객의 앞 실행이 끝난 지 7일 안인 것 0)
- 확인: again = 0
- 결과: (대기)

### C123-T1 · 직원 지시문(설계서 §7 일곱 줄 · 초안 여정 · 발송 0)
- 카드: C123
- 단계: 사후
- 선행: C123-H1
- 기대: 휴면 여정 = 「최소 7일」 · 0 을 넣어도 7 이상으로 저장 · 「1시간마다」 · 주문 완료 여정 = 0 저장 · 자동 켜면 최소 1일 · 재진입 끄면 자동도 꺼짐
- 결과: (대기)

### C124-P1 · 리허설(서버 pm2 실물 · 시험용 앱 · 운영 백엔드 무관)
- 카드: C124
- 단계: 배포 앞
- 선행: 커밋 → push → 서버 git pull(스크립트만 · 빌드 · 재시작 없음)
- 기대: administrator 셸 한 줄 = `bash /home/administrator/targetup-app/packages/backend/scripts/dist-gate-rehearsal.sh` · 1부 판 관문 다섯 갈래 + 판 잠금 둘(남이 쥠 · 풀림) · 2부 시험용 pm2 앱(wd-rehearsal)으로 online 기록 → 깨진 판 errored → 잠금 쥔 동안 건너뜀 → 돌던 판으로 되돌림 → 다시 손대지 않음
- 확인: 마지막 줄 「리허설 결과: 통과 14 · 실패 0」 · 「운영 백엔드 = 상태 · 재시작 횟수 · 기동 시각 그대로」(리허설 중 운영 백엔드가 따로 재시작되면 이 줄만 실패한다)
- 결과: 1111 09:57 Harold 서버 출력(HEAD ede69d59 · administrator 셸) = 통과 14 · 실패 0 — 판 관문 다섯 갈래 · 판 잠금 둘(flock 실물) · 시험용 앱 v1 online → 돌던 판 기록 → 깨진 v2 errored → 잠금 쥔 동안 건너뜀 → 「rollback 뒤 상태 = online」 → 다시 손대지 않음 · 운영 백엔드 online 44 · 기동 시각 그대로

### C124-H1 · 서버 설치(자동 복구 감시 crontab 한 줄 · 빌드 0 · 재시작 0 · DDL 0 · ENV 0)
- 카드: C124
- 단계: 한줄로 배포
- 선행: C124-P1
- 기대: administrator crontab 에 backend-watchdog 1분 줄 · 공용 경보 /usr/local/bin/ops-alert 실행 가능 · 운영 백엔드 무변화
- 확인: `which node pm2` 경로 = crontab PATH 안 · 1 ~ 2분 뒤 backend-watchdog.log 에 오류 줄 0 · 6분 뒤 ~/.hanjul-backend-watchdog.json 의 provenDistId 가 채워짐
- 결과: 1111 10:00 Harold 서버 출력 = crontab 한 줄(PATH=/usr/bin … node …backend-watchdog.js) · 상태 파일 ~/.hanjul-backend-watchdog.json 10:00 생성 · provenDistId 61011-1794353885866(지금 도는 판) · 기록 0줄 · 운영 백엔드 online · restarts 44 · uptime 30m · 경보 경로 ops-alert 는 같은 날 09:48 백업 중단 경보로 문자 · 메일 성공 확인

### C124-S1 · 실측(다음 백엔드 배포 때 · 관문 줄)
- 카드: C124
- 단계: 사후
- 선행: C124-H1
- 기대: build:safe 출력에 「두 번째 빌드(대조용)」 · 「[verify-dist] 통과 — .js N개 문법 · 두 판 M개 파일 일치」 · 빌드 시간 약 두 배
- 확인: 통과 줄이 있고 swap 줄이 그 뒤에 온다 · 실패면 옛 dist 유지(끼우지 않음)
- 결과: 1111 13:19:18 Harold 서버 출력(C125-H1 백엔드 build:safe) = 「tsc 빌드 시작 → dist-new」 → 「두 번째 빌드(대조용) → dist-new2」 → 「[verify-dist] 통과 — .js 868개 문법 · 두 판 3472개 파일 일치」 → 「빌드 성공 + atomic swap 완료」(app.js 61011 bytes) · 순서 = 통과 뒤 swap

### C125-H1 · 한줄로 배포(대행발송 늦은 보고 대기 해제 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C125
- 단계: 한줄로 배포
- 선행: Codex 구현 approve · 커밋(Harold · 다른 세션 파일 뺌) → push
- 기대: 설계서 docs/2026-11-11-agency-late-report-design.md · 늦은 보고가 닫힌 검사를 전부 통과로 바꾸면 그 검사로 장애가 남은 대행발송 건이 15분을 기다리지 않고 바로 다시 집힘 · 회복된 장애는 3번 셈에서 빠짐 · 검사 판정 · 청구 · 미가입 직접발송 변화 0
- 확인: 서버 HEAD · 백엔드 build:safe(출력에 「[verify-dist] 통과」 = C124-S1 같이 확인) · 프론트 build:safe · 적재 0건 한 줄 → pm2 reload · status online · uptime 증가 · 기동 에러 0 · dist grep recoverAgencySpamErrors ≥ 1
- 결과: 1111 Harold 서버 출력 = git pull ede69d59..0c955aab(14 파일) · 백엔드 build:safe 13:19:18([verify-dist] 통과 · swap) · 프론트 build:safe 성공 · loading=0 → pm2 reload · pm2.log 13:55:40 exited(code 0 · SIGINT) → online · status online · uptime 2m · script path dist/app.js · unstable restarts 0 · dist grep recoverAgencySpamErrors = agency-send-worker.js 2 · spam-filter.js 1 · 에러 로그 13:20 ~ 13:59 = 합성 데이터 안내 한 줄(13:56:42)뿐 · 업무시간 배포(Harold 「지금 배포」)

### C125-S1 · 실측(배포 뒤 · 회복 사건이 생긴 접수의 대기 시간)
- 카드: C125
- 단계: 사후
- 선행: C125-H1
- 기대: 서버 셸 한 줄 = 설계서 §7 의 SELECT(장애 기록 시각 · 회복 시각 · 다음 단계 시각)
- 확인: 회복된 행 = recovered_at 뒤 1분 안에 next_at · 회복 안 된 행 = 옛 그대로 15분 뒤 · 회복 사건이 0행이면 통신사 지연이 없었던 것(닫힘 아님 · 다음 발생 때 다시)
- 결과: 1111 Harold 서버 출력 = 배포(13:55:40) 뒤 장애 사건 1행 · 접수 d1ef7238 · 장애 17:38:30 → 회복 17:38:48 → 다음 단계 17:38:51(회복 18초 · 회복 뒤 3초 = 15분 대기 없음 · 옛 실측 17분 50초) · 닫힘

### C126-P1 · 배포 전 실측(읽기만 · 바뀌는 대상 수)
- 카드: C126
- 단계: 사전
- 선행: 없음
- 기대: 서버 셸 한 줄씩 = 설계서 docs/2026-11-11-journey-recheck-design.md §8 의 P1 ① ② ③ SELECT
- 확인: ① 켜진 재진입 허용 + 저장 대기일 > 0 여정(다음 진입이 여정 길이만큼 늦어지는 여정) ② 켜진 여정에 남은 멈춘 실행 수(그 고객은 그 계보에 새로 들어오지 않게 된다) ③ 조건 태그가 든 여정 문자 칸 수(AI 고치기 대상에서 빠지는 칸) — 수를 기록(0 이어도 닫힘 · 배포를 막는 값 아님)
- 결과: 1111 18:0x Harold 서버 출력(배포 직후 실측) = 적재 중 발송 0 · ① 재진입 허용 + 저장 대기일 > 0 켜진 여정 = 1(c7c97996 사내 회사 · customer.dormant · 90일) · ② 켜진 여정의 멈춘 실행 = 0행 · ③ 조건 태그가 든 문자 칸 = 681fed7a 멈춘 여정 4 · c7c97996 초안 2 · 끝난 여정 1 · d284960d 초안 1(켜진 여정 0)

### C126-H1 · 한줄로 배포(1110 여정 처방 재점검 · 백엔드만 · DDL 0 · ENV 0)
- 카드: C126
- 단계: 한줄로 배포
- 선행: Codex 구현 approve · 커밋(Harold · 다른 세션 파일 뺌) → push · C126-P1
- 기대: 설계서 docs/2026-11-11-journey-recheck-design.md · 멈춘 실행이 있는 고객은 그 계보에 새로 들어오지 않음 · 재진입 대기일 = 끝난 뒤 max(최솟값, 저장 대기일) · 자동 재진입 워커 = 잠금 안 값으로 판정 · 여정 AI 고치기 넷 = 새 템플릿 문법이 든 안은 버림 · 조건문이 든 문안은 AI 가 고치지 않음 · 미가입 직접발송 변화 0
- 확인: 서버 HEAD · 백엔드 build:safe(출력에 「[verify-dist] 통과」) · 프론트 빌드 없음(화면 수정 0) · 적재 0건 한 줄 → pm2 reload · status online · uptime 증가 · 기동 에러 0 · dist grep openExecutionSql ≥ 1 · journeyRevisedCopy ≥ 1
- 결과: 1111 Harold 서버 출력 = HEAD 1a3fbdbf · 백엔드 build:safe 17:54:57([verify-dist] 통과 .js 869개 · 두 판 3476개 일치 · swap) · pm2 reload → created at 17:55:29 · online · uptime 34s → 82s · unstable restarts 0 · 재시작 횟수 47 · dist grep openExecutionSql 4 · journeyRevisedCopy 4 · 에러 로그 17:55:29 뒤 = 합성 데이터 안내 한 줄(17:56:31)뿐 · 프론트 빌드 없음(화면 수정 0) · 재시작 앞 적재 0건 확인 줄은 출력에 없음(P1 과 함께 지금 건수 확인) · P1 은 배포 직후 실측으로 받는다 · 18:1x 추가 확인 = 서버 메모리 62GB 중 여유 39GB · 백엔드 재시작 8분 239.4MB(힙 106MB · 상한 1700MB) · 재시작 뒤 에러 로그 0줄(안내 줄 제외) · 여정 스케줄러 넷 17:55:30 시작 · 자동 재진입 워커 한 회차 완료(대상 여정 0개) · 재시작 뒤 새 여정 실행 0행(진입 감시의 넣기는 아직 미관측 → S1 때 확인) · 메모리 상한 강제 재시작 누적 41 그대로(마지막 11-10 18:03:49 · 오늘 0건)

### C126-S1 · 실측(배포 뒤 · 한 고객 한 계보에 미완료 실행 둘)
- 카드: C126
- 단계: 사후
- 선행: C126-H1(하루 뒤 = 진입 감시 · 자동 재진입이 돈 뒤)
- 기대: 서버 셸 한 줄 = 설계서 §8 의 S1 SELECT(배포 시각을 넣는다)
- 확인: 상태형 뽑기로 들어오는 시작(휴면 · 생일 · 포인트 · 주기 이탈 · 등급 · 장바구니 · 조회)과 「고른 고객에게」 행 = 0 · 사건 커서로 들어오는 시작은 판정 대상 아님
- 결과: 1114 Harold 서버 출력(C133-H1 재시작 전 · 배포 시각 2026-11-11 17:55:29+09 넣음) = cdp.purchase 28 한 줄뿐(구매 사건 커서 시작 = `journey-cdp-cursor.ts resolveCdpCursorEventName` · 판정 대상 아님) · 상태형 뽑기 시작 · custom 행 0 = 기대대로

### C126-T1 · 직원 시트(여정 AI 고치기 넷의 변수 표기)
- 카드: C126
- 단계: 직원 시트
- 선행: C126-H1
- 기대: 설계서 §7 직원 지시문 1 ~ 6(테스트계정 · 초안 여정 · 발송 0)
- 확인: 다듬기 · A/B · AI 수정 결과에 `{{` · `{%` 0 · 이름 자리 = %고객명% · 조건문이 든 칸의 AI 다듬기 = 안내 문구 · 본문 그대로
- 결과: (대기 · 로드맵 묶음이 끝난 뒤 한 번)

### C127-H1 · 한줄로 긴급 배포(알림톡 직접발송 「실패 시 문자」 창 저장 · 프론트만 · DDL 0 · ENV 0)
- 카드: C127
- 단계: 한줄로 배포
- 선행: Codex approve(1R) · 커밋(Harold · 세 파일만 = AlimtalkSendModal.tsx · AlimtalkChannelPanel.tsx · alimtalk-fallback-save-1111.test.ts) → push
- 기대: 「실패 시 문자」 창에서 고른 종류 · 대체문안 · 제목이 [저장] 한 번에 들어간다(옛: 「원문 그대로」 고정 → LMS 제목 요구로 발송 막힘) · 백엔드 코드 변화 0
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → pm2 reload · status online · uptime 증가 · 접수자(박성용) 화면 확인 = 대체 안함 저장 → 칸에 「대체 안함」 · 대체문안 작성 저장 → 칸에 「대체문안 작성」 · 다시 열면 넣은 제목 · 문구 그대로
- 결과: 1111 Harold 서버 출력(확인 한 줄) = HEAD d8b5367d(origin/main 같음) · backend dist/app.js 16:40 · frontend dist/index.html 16:42(커밋 뒤 두 빌드가 끼워짐) · pm2 targetup-backend online · 재시작 횟수 46 · 메모리 619.7MB · pm2 describe = created at 16:42:27(백엔드 빌드 16:40 뒤 재시작) · uptime 68m · unstable restarts 0 · script path dist/app.js · 남은 = 접수자 화면 확인

### C128-H1 · 한줄로 배포(직접발송 치환 = 올린 이름 우선 · 백엔드만 · DDL 0 · ENV 0 · C126-H1 과 한 배포)
- 카드: C128
- 단계: 한줄로 배포
- 선행: Codex approve(1R) · 커밋(Harold · C126 과 한 커밋) → push · C126-P1
- 기대: 직접발송(문자 · 브랜드 · 알림톡의 %이름% · %고객명% · %성함%)에서 올린 이름이 있으면 그 이름이 나간다 · 올린 이름이 빈 값이면 옛 그대로 고객 DB 이름 · 고객 DB 에 그 번호가 없는 회사는 변화 0
- 확인: C126-H1 과 같은 빌드 · 재시작 · 접수자 확인(C128-T1)으로 닫는다
- 결과: 1111 C126-H1 과 같은 배포(HEAD 1a3fbdbf · 17:55:29 재시작) · dist messageUtils.js 의 옛 조건 이름 customerNameEmpty = 0(새 규칙 판) · 남은 = 접수자 확인(C128-T1)

### C129-DDL-1 · journeys 날짜형 시작의 훑은 날(생일 임박 · 연 단위 포인트 소멸 따라잡기 · 설계서 docs/2026-11-11-journey-remaining-nine-design.md §10 처방 32) · ★ 배포 앞
- 카드: C129
- 단계: DDL
- 선행: 없음(배포 앞)
- 의미 바꿈: 아니오(칸 추가 · 옛 코드는 읽지 않는다 · 값 NULL = 따라잡지 않는다 = 종전 · 새 코드는 칸이 없으면 종전 동작)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'journeys' AND column_name = 'last_state_cursor_on';
- 확인: 한 줄 · date · YES
- 결과: 1112 00:1x Harold 서버 출력 = 실행 전 확인 0행 → SET · ALTER TABLE → 확인 한 줄 last_state_cursor_on · date · YES · 배포(재시작 00:08:47) 뒤에 넣음 = 그 사이 날짜형 따라잡기만 꺼진 종전 동작 · 코드의 칸 확인은 5분 주기(재시작 없음)

> C129-DDL-1 · 배포 앞 · 칸 추가 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C129-DDL-1
SET lock_timeout = '3s';
ALTER TABLE journeys
  ADD COLUMN IF NOT EXISTS last_state_cursor_on date NULL;
```

### C129-P1 · 배포 전 실측(읽기만)
- 카드: C129
- 단계: 사전
- 선행: 없음
- 기대: 서버 셸 한 줄씩 = 설계서 docs/2026-11-11-journey-remaining-nine-design.md §8 의 P1 ① ② ③ SELECT + §10-7 의 ④ ⑤ SELECT
- 확인: ① 끝난 시각이 있는데 멈춤으로 남은 실행 수(0 이 아니면 그 행을 completed 로 되돌리는 한 줄을 그때 낸다) ② 켜진 여정의 멈춘 실행 수 ③ 재진입 허용 여정의 시작 사건별 저장 대기일(최솟값 아래 줄 = 붙이기 · 떼기 흔적) ④ 선불 회사의 켜진 여정 알림톡 칸(0 이 아니면 = 배포 뒤 차감 단가가 max(알림톡, 고른 대체)로 오르는 대상 · 그 칸의 대체 유형과 회사 SMS · LMS 단가 설정을 함께 본다 · 고른 대체 단가가 비어 있으면 배포 뒤 그 칸에서 여정이 멈춘다) ⑤ 켜짐 · 멈춤 상태의 날짜형 시작(생일 임박 · 연 단위 소멸) 여정 수(멈춘 것 = 배포 뒤 처음 켤 때는 기록이 없어 따라잡지 않는다)
- 결과: 1112 00:1x Harold 서버 출력(배포 직후 실측) = ① 0행 · ② 0행 · ③ 19행 가운데 저장 대기일이 계약 최솟값 아래 = 3(customer.dormant 0일 켜짐 1 · customer.created 0일 멈춤 1 · customer.cycle_lapsed 0일 초안 1 · 읽을 때 max(최솟값, 저장값)이라 값 고침 없음) · ④ 0행(선불 회사의 켜진 여정에 알림톡 칸 없음 = 지금 차감 단가가 바뀌거나 단가 미설정으로 멈추는 여정 없음) · ⑤ 멈춘 생일 임박 2 · 켜진 날짜형 0 · 1112 Harold = 여정을 쓰는 고객사는 아직 없음(직원 시험만)

### C129-H1 · 한줄로 배포(여정 남은 결함 아홉 건 + 결정 둘 D10 · D11 · 백엔드만 · DDL 1 = C129-DDL-1 배포 앞 · ENV 0)
- 카드: C129
- 단계: 한줄로 배포
- 선행: Codex 구현 approve · 커밋(Harold · 다른 세션 파일 뺌) → push · C129-P1 · C129-DDL-1(배포 앞 · 없이 올라가도 날짜형 따라잡기만 꺼진 종전 동작)
- 기대: 설계서 §4 처방 1 ~ 25 + §10 처방 26 ~ 37 · 화면 수정 0 · 정산기 · 환불 함수 · 직접발송 수정 0 · 선불 차감 함수 = 여정 알림톡 칸의 원장 열쇠(kakaoCharge)만 추가(다른 호출 = 옵션 없음 = 종전)
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 적재 0건 한 줄 → pm2 reload · status online · uptime 증가 · 기동 에러 0 · dist grep CLEAR_UNPAID_CLAIMS_SQL ≥ 1 · reentryFloorSetSql ≥ 1 · resolveKakaoCharge ≥ 1 · OPEN_STATE_SCAN_SQL ≥ 1
- 결과: 1112 Harold 서버 출력 = Harold 직접 실행(git pull · 백엔드 build:safe · 프론트 build:safe · pm2 reload) · HEAD ddbea40c3fd1 · dist/.installed 00:07:33(판 검증을 통과해 끼운 뒤에만 찍히는 표식) · created at 00:08:47 · online · uptime 26s → 88s · 재시작 횟수 48 그대로 · unstable restarts 0 · script path dist/app.js · dist grep CLEAR_UNPAID_CLAIMS_SQL 1 · reentryFloorSetSql 1 · resolveKakaoCharge 3 · OPEN_STATE_SCAN_SQL 1 · 에러 로그 00:08:47 뒤 = 합성 데이터 안내 한 줄(00:09:48)뿐 · build:safe 출력([verify-dist] 통과 줄)과 재시작 앞 적재 0건 확인 줄은 받은 출력에 없음 · DDL 은 재시작 뒤(C129-DDL-1) · P1 은 배포 직후 실측 · 재시작 뒤 적재 중 캠페인(preparing · queued · processing) = 0

### C129-S1 · 실측(배포 뒤)
- 카드: C129
- 단계: 사후
- 선행: C129-H1(하루 뒤)
- 기대: 설계서 §8 P1 ① ② 를 다시 실행 + 켜진 날짜형 시작 여정의 last_state_cursor_on(SELECT id, trigger_event, last_state_cursor_on FROM journeys WHERE status = 'active' AND trigger_event IN ('customer.birthday_approaching', 'customer.points_expiring'))
- 확인: ① 0 유지 · ② 켜진 여정의 멈춘 실행 0 유지 · 여정 쪽 오류 로그 0 · 날짜형 여정의 기록 = KST 오늘 또는 어제(회차가 열려 있는 동안은 어제) · 선불 여정 알림톡 차감 행이 생겼으면 설명에 「결과별 정산」 꼬리
- 결과: (닫히지 않음) 1114 Harold 서버 출력(C133-H1 재시작 전) = ① 0행 · ② 0행 유지 · 켜진 날짜형 시작 여정 0행(last_state_cursor_on 판정 표본 없음 = 미검증) · 여정 쪽 오류 로그 0 아님 = 「[JourneyExecutor] 적재 중 표식 정리 실패 campaign=998900e1-00af-4f17-bc58-003ff4bf07c6: 완료된 캠페인의 target_count는 변경할 수 없습니다 (old=9, new=10)」 5분마다(1114 치 에러 로그 journey 줄 107 · 1112 · 1113 치 파일 0 · 1111 치 13) → B-1114-1(원인 · 영향 미진단) · 선불 여정 알림톡 차감 행 = 이번에 재지 않음

### C129-T1 · 직원 시트(붙이기 · 떼기 대기 일수 · AI 수정의 알림톡 칸)
- 카드: C129
- 단계: 직원 시트
- 선행: C129-H1
- 기대: 설계서 §7 직원 지시문 1 ~ 5(테스트계정 · 초안 여정 · 발송 0)
- 확인: 뗀 뒤 대기 일수 7 이상 · AI 수정 뒤 알림톡 칸의 템플릿 · 변수 · 실패 시 문자 그대로 · 알림톡 칸 추가 요청 = 안내 문구
- 결과: (대기 · 로드맵 묶음이 끝난 뒤 한 번)

### C128-T1 · 접수자 확인(이새에프엔씨 · 박성용)
- 카드: C128
- 단계: 직원 시트
- 선행: C128-H1
- 기대: 고객 DB 에 다른 이름으로 들어 있는 번호를 엑셀에 다른 이름으로 올려 %이름% 문안으로 직접발송(자기 번호 한두 건)
- 확인: 받은 문자의 이름 = 엑셀의 이름(화면 미리보기와 같다) · 엑셀 이름 칸을 비운 줄 = 고객 DB 이름
- 결과: 1111 저녁 Harold 전달 = 「직접발송 적용 잘 되었댄다」(접수자 확인) · 닫힘

### C130-DDL-1 · 대행 메일 접수 원장에 반려 회신 제목 · 본문 칸(설계서 docs/2026-11-13-c130-agency-optout-notice-reply-body-design.md §3 · §4②) · ★ 배포 앞
- 카드: C130
- 단계: DDL
- 선행: 없음(배포 앞 · .62 → .57 전환을 마친 뒤)
- 의미 바꿈: 아니오(칸 추가 · NULL 허용 · 옛 코드는 읽지 않는다 · 새 코드는 칸이 없으면 종전 문장 · 관제는 「마이그레이션 필요」 안내)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns WHERE table_name = 'agency_send_email_intake' AND column_name IN ('reply_subject', 'reply_text') ORDER BY column_name;
- 확인: 두 줄 · reply_subject · character varying · 200 · YES / reply_text · text · (빈칸) · YES
- 결과: 1113 07시대 Harold 서버 출력(.62 · administrator · hostname 확인 줄 통과) = SET · ALTER TABLE → 확인 두 줄 reply_subject · character varying · 200 · YES / reply_text · text · (빈칸) · YES · 코드 배포 앞에 실행(옛 코드는 칸을 읽지 않음)

> C130-DDL-1 · 배포 앞 · 칸 추가 둘 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C130-DDL-1
SET lock_timeout = '3s';
ALTER TABLE agency_send_email_intake
  ADD COLUMN IF NOT EXISTS reply_subject varchar(200) NULL,
  ADD COLUMN IF NOT EXISTS reply_text text NULL;
```

### C130-H1 · 한줄로 배포(대행발송 수신거부 줄 겹침 안내 + 메일 반려 회신 본문 보기 · 백엔드 + 프론트 · DDL 1 = C130-DDL-1 배포 앞 · ENV 0)
- 카드: C130
- 단계: 한줄로 배포
- 선행: Codex 구현 approve · 커밋(Harold · 다른 세션 파일 뺌) → push · .62 → .57 전환 끝 · C130-DDL-1
- 기대: 설계서 §4 처방 ① ② · 미가입 · 직접발송 변화 0 · 광고 꼬리 문장(buildAdMessage) 결과 변화 0 · 고객 문안 고침 0
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → pm2 reload · status online · 기동 에러 0 · dist grep agencyOptOutNotice ≥ 1 · readRecentRejectedIntakes ≥ 1 · sendRejectReply ≥ 1
- 결과: 1113 오전 Harold 「배포 완료했고」(커밋 f3623b12 · push · 서버 pull · build:safe · 재시작은 Harold 직접 · 서버 출력 = 이 세션에 미수신) → 1113 09:12 C132 판(5b7c709d · 이 코드 포함) 재시작 뒤 Harold 서버 출력 = dist grep utils/agency-send-intake.js 「function readRecentRejectedIntakes(」 1 · utils/agency-send-mail-worker.js 「function sendRejectReply(」 1 · online · uptime 2m · unstable 0 · 재시작 뒤 에러 0(agencyOptOutNotice 는 이번 grep 에 넣지 않음) · 닫힘

### C130-T1 · 직원 시트(수신거부 줄 안내 · 반려 회신 본문 보기)
- 카드: C130
- 단계: 직원 시트
- 선행: C130-H1
- 기대: 설계서 §6 직원 지시문(테스트계정 · 도달 불가 번호 · 발송 0)
- 확인: 「무료」 없는 수신거부 줄 문안 = 미리보기 · 접수 · 상세 · 직원 상세에 안내 상자 · 「무료수신거부」 문안 = 상자 없음 · 메일 반려 1건 = 슈퍼관리자 메일 접수 행을 누르면 업체가 받은 메일 제목 · 본문
- 결과: (대기 · 로드맵 묶음이 끝난 뒤 한 번)

### C131-DDL-1 · 비토 라인 큐 표 색인(MySQL .62 smsdb · SMSQ_SEND_16 · 13 · 14 · 15 · 설계서 docs/2026-11-13-c131-bito-line-scan-report-speed-design.md §4-1 · §7) · 배포와 무관
- 카드: C131
- 단계: 사전
- 선행: 없음
- 의미 바꿈: 아니오(색인 추가 · ALTER TABLE SMSQ_SEND_{16,13,14,15} ADD INDEX idx_status_seq_sendreq (status_code, seqno, sendreq_time), ALGORITHM=INPLACE, LOCK=NONE · lock_wait_timeout 60 · 표 하나씩 · PG 블록 아님)
- 기대: 설계서 §7 순서 · ⑤ 판정(에이전트 큐 조회 = 색인 · filesort 0)
- 확인: .57 = 전환 런북 §8-5 확인 SELECT 만
- 결과: 1113 08:29:07 ~ 08:32:50 Harold 실행 끝(C131 세션 보고) = 16 2초 · 13 12초 · 14 3분 6초 · 15 21초 · 실패 0 · 14번 잠금을 막던 읽기 조회만 KILL QUERY 4 · ⑤ 합격(에이전트 조회 Covering index lookup idx_status_seq_sendreq · filesort 0 · 0.02 ~ 0.6ms)

### C131-H1 · 한줄로 백엔드(R94 큐 표 전체 훑기 지킴이 · c5b199d7 · ENV 0 · DDL 0 · 프론트 변화 0)
- 카드: C131
- 단계: 한줄로 배포
- 선행: C131 Codex 구현 approve · 커밋 · push
- 기대: MySQL 실행 다섯 자리가 noteQueueSql 을 부른다 · 위반 = 로그 한 줄 + 경보(막지 않음)
- 확인: dist grep noteQueueSql 호출 config/database.js 4 · utils/queue-load-tx.js 2 · utils/sms-queue.js 1 · dist/utils/queue-scan-guard.js 있음 · 재시작 뒤 [queue-scan-guard] 줄 0
- 결과: 1113 09:12 C132 판(5b7c709d)과 한 재시작 · Harold 서버 출력 = dist 「noteQueueSql)(」 config/database.js 4 · utils/queue-load-tx.js 2 · utils/sms-queue.js 1 · utils/queue-scan-guard.js 「function noteQueueSql(」 1 · 에러 로그(console.warn 이 찍히는 곳) 「queue-scan-guard」 0줄(이 코드가 처음 든 판이라 파일 전체 = 재시작 뒤) · 경보 대기 표(system_alert_pending)는 보낸 뒤 지워지므로 로그 줄로 판정

### C131-H2 · 비토 에이전트 새 판(bito-gateway 미커밋 reportQueue · grpc_client.go · report_queue_test.go)
- 카드: C131
- 단계: 출고
- 선행: .62 → .57 전환 뒤 · 출고 절차 확정(DEPLOY-RUNBOOK 에 에이전트 절 없음 · AGENT_MANUAL §16)
- 기대: 한 대씩 새 판 → 그 대 기동 · Poller 확인 → 그 대만 report_concurrency 1 → 8 → 다음 대(옛 판에서 report_concurrency 만 올리면 같은 행 결과 순서가 깨짐)
- 확인: 대마다 기동 · 결과 반영 순서
- 결과: (대기 · 1113 합친 배포에서 뺌 · C131 세션 권고 · DDL 뒤 측정에서 에이전트 병목 아님)

### C131-S1 · 실측(백엔드 배포 뒤 하루)
- 카드: C131
- 단계: 사후
- 선행: C131-H1(하루 뒤)
- 기대: [queue-scan-guard] 로그 0 · 경보 원장 pass='queue-scan-guard' 0 · 첫 대량 발송 날 슬로 로그에 에이전트 큐 조회 · 감시 · 정리 워커 줄 0(설계서 §8)
- 확인: 위 셋
- 결과: (대기)

### C131-T1 · 직원 시트
- 카드: C131
- 단계: 직원 시트
- 선행: C131-H1
- 기대: 없음(화면 변화 0 · 설계서 §9)
- 확인: 닫힘 = Harold 실측(C131-S1)
- 결과: 직원 시트 없음(설계서 §9)

### C132-DDL-1 · 발송ID 브랜드 비친구 단가 칸(설계서 docs/2026-11-13-c132-four-tickets-design.md §4 · 접수 cmwbrqgnd19eojnscjynhf3fo) · ★ 배포 앞
- 카드: C132
- 단계: DDL
- 선행: 없음(배포 앞 · 새 코드의 청구 SELECT 가 이 칸을 읽는다)
- 의미 바꿈: 아니오(칸 추가 · NULL = 비친구도 친구 단가 = 종전 금액)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'company_agent_ids' AND column_name = 'cost_per_brand_nonfriend';
- 확인: 한 줄 · numeric · YES
- 결과: 1113 Harold 서버 출력(.62 · administrator · hostname 확인 줄 통과) = SET · ALTER TABLE → 확인 한 줄 company_agent_ids · cost_per_brand_nonfriend · numeric · YES · 코드 배포 앞

> C132-DDL-1 · 배포 앞 · 칸 추가 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C132-DDL-1
SET lock_timeout = '3s';
ALTER TABLE company_agent_ids
  ADD COLUMN IF NOT EXISTS cost_per_brand_nonfriend numeric NULL;
```

### C132-DDL-2 · 대행 접수 광고 표기 정책 칸(이메일 접수 = 문안 그대로 · 설계서 §2 · 서 팀장 요청) · ★ 배포 앞
- 카드: C132
- 단계: DDL
- 선행: 없음(배포 앞 · 칸이 없으면 새 코드도 종전 표기 = 이메일 접수 표기 제거가 꺼진 채로 돈다)
- 의미 바꿈: 아니오(칸 추가 · NULL = 종전 표기 · 배포 전 접수는 승인 · 미리보기 · 발송 모두 종전)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'agency_send_requests' AND column_name = 'ad_text';
- 확인: 한 줄 · boolean · YES
- 결과: 1113 Harold 서버 출력(같은 명령) = SET · ALTER TABLE → 확인 한 줄 agency_send_requests · ad_text · boolean · YES · 코드 배포 앞(옛 코드는 칸을 읽지 않음 · 배포 전 접수 = NULL = 종전 표기)

> C132-DDL-2 · 배포 앞 · 칸 추가 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C132-DDL-2
SET lock_timeout = '3s';
ALTER TABLE agency_send_requests
  ADD COLUMN IF NOT EXISTS ad_text boolean NULL;
```

### C132-H1 · 한줄로 배포(이메일 대행 문안 그대로 · 발신번호 사용 범위 · 발송ID 브랜드 비친구 단가 · 백엔드 + 프론트 · DDL 2 배포 앞 · ENV 0)
- 카드: C132
- 단계: 한줄로 배포
- 선행: Codex 구현 approve · 커밋(Harold · 다른 세션 파일 뺌) → push · C132-DDL-1 · C132-DDL-2
- 기대: 설계서 §2 ~ §4 · 미가입 · 직접발송 변화 0 · 배포 전 접수 표기 그대로 · 배포 뒤 이메일 접수 = (광고) · 무료수신거부 없음
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · uptime · dist grep agencyAdTextValue ≥ 1 · CALLBACK_USAGE_SCOPE_SQL ≥ 1 · adTextOn ≥ 1
- 결과: 1113 Harold 서버 출력 = git pull f3623b12..5b7c709d · 백엔드 build:safe 「[verify-dist] 통과 — .js 871개 문법 · 두 판 3484개 파일 일치」 · 프론트 build:safe 성공 · loading=0 → pm2 restart targetup-backend --update-env · online · uptime 2m · restarts 50 · unstable 0 · 재시작 뒤 에러 = 합성 데이터 안내 한 줄뿐 · dist grep(각 「function 이름(」 줄 수) agency-send-intake.js agencyAdTextValue 1 · agency-send-optout.js agencyAdTextApplies 1 · direct-send-spec.js adTextOn 1 · callback-filter.js describeCallbackUsage 1(CALLBACK_USAGE_SCOPE_SQL 은 Codex 구현 1R 에서 describeCallbackUsage 로 바뀌어 이 이름으로 봄) · 화면 확인 = C132-T1

### C132-H2 · 비토 게이트웨이 배포(PAY 통계 성공 판정 = 콘솔과 같은 식 · 브랜드 G · GN · C131 과 한 번에)
- 카드: C132
- 단계: 게이트웨이 배포
- 선행: C132-H1(한줄로가 GN 을 먼저 안다) · 비토 Codex approve · 비토 런북 scripts/gw
- 기대: 적재기 카운터 = 결과 코드 판정(콜비서 V0011 Agent 경로 실패가 실패로) · 브랜드 묶음 = G · GN 한 문장
- 확인: 배포 뒤 GW_PAY_STATS_LOOKBACK_DAYS 를 2026-11-01 까지 덮는 값으로 한 번 → 게이트웨이 로그 「PAY 통계 적재 완료」 full=true · since=2026-11-01 · failed=0 한 줄 → 원래 값(실측 = 10 · 0916 drop-in · 처음에 3 이라 적은 것 정정) · 한줄로 에이전트 통계 콜비서 11월 = 비토 콘솔과 같은 성공 · 실패
- 결과: 1113 비토 커밋 8438331(Harold · 네 파일 경로 지정 · C131 미커밋 파일 뺌) · build.sh gateway = GW_BUILD_OK out/bito-gateway-8438331(C131 파일 여덟 개 stash 로 치우고 빌드 · BUILD_RC=0 · 되돌림 확인) · sha256 3278bf79…55fe · deploy.sh 62195b30…ff96(0929 판 그대로) · .65 현재 값 실측 = zz-paystats-lookback-0916.conf 10 · 프로세스 10 → zz-paystats-lookback-1113.conf(12) · daemon-reload(PID 2417457 그대로) → GW_DEPLOY_OK gateway 09:27:10(재기동 전 SENDING 0 · 백업 deploy-backups/20261113-092710-gateway.4f9m6B · DEPLOY_RC=0) · 새 PID 3079110 ERROR 0 · 09:27:25 「PAY 통계 적재 시작」 lookbackDays 12 · 09:27:41 「PAY 통계 적재 완료」 rows 51 · failed 0 · full true · since 2026-11-01 · 대조(V0011 · 닫힌 날짜) .65 콘솔 판정식(result-code.js 가 만드는 SQL 그대로) = pay-ingest-db RSRM_SalesStts 날짜마다 같음 = 11-06 6 · 1 · 5 · 0 / 11-10 3 · 2 · 1 · 0(L 2 · S 1) / 11-11 16,461 · 16,186 · 275 · 0 / 11-12 16,466 · 16,187 · 192 · 87(전체 · 성공 · 실패 · 대기) · upd 09:27:41 · 브랜드 = 11월 비토 고객(V) 유형 K · KL · L · S 뿐 = G · GN 발송 0 → ③ 비토 적재 실측은 첫 브랜드 발송 때 · 정리 = 1113 drop-in 삭제 · daemon-reload → 다음 기동 값 10 · PID 3079110 그대로 · /tmp 업로드 0 · 비토 push b858a23..8438331(Harold)

### C132-T1 · 직원 시트(이메일 대행 문안 그대로 · 사용 범위 칸 · 브랜드 두 칸 · 콜비서 통계)
- 카드: C132
- 단계: 직원 시트
- 선행: C132-H1 · C132-H2
- 기대: 설계서 §7 직원 지시문 1 ~ 5(테스트계정 · 도달 불가 번호 · 발송 0)
- 확인: 이메일 요청서 테스트 문자 · 상세 = (광고) · 무료수신거부 없음 · 화면 원스텝 = 종전 · 사용 범위 칸 · 브랜드 두 칸 · 콜비서 11월 통계 = 콘솔
- 결과: (대기 · 로드맵 묶음이 끝난 뒤 한 번)

### C133-DDL-1 · 소개 창 노출 기억 표(설계서 docs/2026-11-13-hanjul-v3-design.md §2 · §10 V3-DDL-1) · ★ 배포 앞
- 카드: C133
- 단계: DDL
- 선행: 없음(배포 앞 · 새 표 · 표가 없으면 새 코드는 503 DB_MIGRATION_PENDING = 소개 창을 띄우지 않는다)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'user_intro_acks' ORDER BY ordinal_position;
- 확인: 다섯 줄 · user_id uuid NO · intro_key character varying NO · login_marks ARRAY NO · dismissed_at timestamp with time zone YES · updated_at timestamp with time zone NO
- 결과: 1114 Harold 서버 출력(push 전 · 전환 전 .62) = CREATE TABLE · 확인 다섯 줄이 기대값과 같음

> C133-DDL-1 · 배포 앞 · 새 표 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C133-DDL-1
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS user_intro_acks (
  user_id uuid NOT NULL,
  intro_key varchar(40) NOT NULL,
  login_marks text[] NOT NULL DEFAULT '{}',
  dismissed_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, intro_key)
);
```

### C133-DDL-2 · 상품 신호 표(설계서 docs/2026-11-13-hanjul-v3-design.md §5-1 · §10 V3-DDL-2 · 매출 칸은 읽는 곳이 없어 뺐다) · ★ 배포 앞
- 카드: C133
- 단계: DDL
- 선행: 없음(배포 앞 · 새 표 · 표가 없으면 야간 워커는 로그 한 줄 · 화면 길은 503 DB_MIGRATION_PENDING)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'product_signal_daily' ORDER BY ordinal_position;
- 확인: 아홉 줄 · company_id uuid NO · door character varying NO · product_key character varying NO · day date NO · product_name character varying YES · views integer NO · carts integer NO · orders integer NO · updated_at timestamp with time zone NO
- 결과: 1114 Harold 서버 출력(push 전 · 전환 전 .62) = CREATE TABLE · CREATE INDEX · 확인 아홉 줄이 기대값과 같음

> C133-DDL-2 · 배포 앞 · 새 표 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C133-DDL-2
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS product_signal_daily (
  company_id uuid NOT NULL,
  door varchar(8) NOT NULL,
  product_key varchar(200) NOT NULL,
  day date NOT NULL,
  product_name varchar(200) NULL,
  views int NOT NULL DEFAULT 0,
  carts int NOT NULL DEFAULT 0,
  orders int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, door, product_key, day)
);
CREATE INDEX IF NOT EXISTS idx_product_signal_company_day ON product_signal_daily (company_id, day);
```

### C133-DDL-4 · 업종 평균 스냅숏 표(설계서 docs/2026-11-13-hanjul-v3-design.md §4-1 · §10 V3-DDL-4) · ★ 배포 앞
- 카드: C133
- 단계: DDL
- 선행: 없음(배포 앞 · 새 표 · 표가 없으면 야간 워커는 로그 한 줄 · 화면 길은 503 DB_MIGRATION_PENDING = 비교 줄 없음)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'benchmark_company_daily' ORDER BY ordinal_position;
- 확인: 다섯 줄 · day date NO · company_id uuid NO · industry_code character varying NO · metric character varying NO · value double precision NO
- 결과: 1114 Harold 서버 출력(push 전 · 전환 전 .62) = CREATE TABLE · CREATE INDEX · 확인 다섯 줄이 기대값과 같음

> C133-DDL-4 · 배포 앞 · 새 표 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C133-DDL-4
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS benchmark_company_daily (
  day date NOT NULL,
  company_id uuid NOT NULL,
  industry_code varchar(40) NOT NULL,
  metric varchar(40) NOT NULL,
  value double precision NOT NULL,
  PRIMARY KEY (day, company_id, metric)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_day_industry_metric ON benchmark_company_daily (day, industry_code, metric);
```

### C134-DDL-1 · 여정 자동 판정 기록 표(설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §5 S1) · 배포 앞뒤 무관
- 카드: C134
- 단계: DDL
- 선행: 없음(새 표 · 표가 없으면 판정은 하되 기록을 안 남기고 로그에 「기록 표 없음(C134-DDL-1)」 · 발송 · 화면 길과 무관)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'journey_selfcheck_daily' ORDER BY ordinal_position;
- 확인: 열한 줄 · company_id uuid NO · day date NO · failed_executions · errored_executions · stuck_claims · fault_logs · unclosed_campaigns · count_mismatch · violations integer NO · first_judged_at · last_judged_at timestamp with time zone NO
- 결과: 1116 Harold 실행(새 장비 .62 · DDL-2 와 한 줄 · push 앞) = SET · CREATE TABLE · information_schema 열한 줄 기대와 같음

> C134-DDL-1 · 새 표 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C134-DDL-1
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS journey_selfcheck_daily (
  company_id uuid NOT NULL,
  day date NOT NULL,
  failed_executions integer NOT NULL DEFAULT 0,
  errored_executions integer NOT NULL DEFAULT 0,
  stuck_claims integer NOT NULL DEFAULT 0,
  fault_logs integer NOT NULL DEFAULT 0,
  unclosed_campaigns integer NOT NULL DEFAULT 0,
  count_mismatch integer NOT NULL DEFAULT 0,
  violations integer NOT NULL DEFAULT 0,
  first_judged_at timestamptz NOT NULL DEFAULT NOW(),
  last_judged_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, day)
);
```

### C134-DDL-2 · 여정 세트 원장 표(설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §12-2 S3) · 배포 앞뒤 무관
- 카드: C134
- 단계: DDL
- 선행: 없음(새 표 · 표가 없으면 여정 세트 워커만 쉬고 로그에 「원장 표 없음(C134-DDL-2)」 · 스위치 ENV 가 비어 있으면 이 표를 읽지도 않는다 · 발송 · 화면 길과 무관)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'journey_selfcheck_set' ORDER BY ordinal_position;
- 확인: 아홉 줄 · company_id uuid NO · set_key text NO · journey_id uuid YES · def_rev integer NO · validations integer NO · next_validate_at timestamp with time zone YES · last_reason text YES · created_at · updated_at timestamp with time zone NO
- 결과: 1116 Harold 실행(새 장비 .62 · DDL-1 과 한 줄 · push 앞) = CREATE TABLE · information_schema 아홉 줄 기대와 같음

> C134-DDL-2 · 새 표 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C134-DDL-2
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS journey_selfcheck_set (
  company_id uuid NOT NULL,
  set_key text NOT NULL,
  journey_id uuid,
  def_rev integer NOT NULL,
  validations integer NOT NULL DEFAULT 0,
  next_validate_at timestamptz,
  last_reason text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, set_key)
);
```

### C134-H1 · 한줄로 배포(B-1114-1 여정 단계 캠페인은 여정만 닫는다 + S3 여정 세트 워커 · 백엔드 + 프론트 한 줄 · DDL 2 = C134-DDL-1 · C134-DDL-2 · ENV 0 = 여정 세트 스위치는 비운 채)
- 카드: C134
- 단계: 한줄로 배포
- 선행: Codex 설계 1R 반영 · 구현 3R approve(1115) · S3(여정 세트 · 설계서 §12) 설계 Codex 4R approve · 구현 Codex 4R approve(1115) · 실 PG 전체 82파일 756 통과 = 통과 스탬프 찍힘(1115 09:16 · 낮 · 1114 23:36 · 1115 00:03 밤 실행에서 실패하던 다른 세션 시험 3건도 통과) · 단위 전체 820파일 13,193 중 13,192 통과(남은 1 = 아래 커밋 조건) · **C133 C + D 커밋 뒤 routes/ai.ts 의 통과 표식 세 줄을 CT(pretestAndMark) 호출로 바꾼다**(그때까지 계약 시험 journey-selfcheck-set-1115.test.ts 한 건이 빨간불 = 커밋 조건) · 커밋(Harold · 경로 · 문안 = 설계서 §11 · root-ledger.test.ts · journey-builder.ts 가 C133 C + D 와 한 파일 = 그 커밋 뒤) → push · C134-DDL-1 · C134-DDL-2 · **★1116 순서 바꿈 = C134 먼저 홀로**(1116 14:45 같은 결함 재발 · 운영 b3753555 · 합성 회사 · Harold 「꼼꼼히 수정해라」) = 겹치는 세 파일(routes/ai.ts · utils/journey-builder.ts · __tests__/root-ledger.test.ts)은 이 카드 절만 담은 패치 scratch/c134/partial.patch 를 index 에만(C133 C + D · C136 절은 작업 트리에 남음) · 커밋 판 사본(작업 트리 diff 를 거꾸로 적용해 HEAD 를 되살리고 blob 해시 대조 · 이 카드 파일만 얹음 · 다른 카드 새 파일 70 뺌)에서 backend tsc 0 · frontend tsc 0 · 단위 전체 820파일 통과 · 실 PG 전체 83파일 664 통과(1116 · 통과 기록 = 사본 판)
- 기대: 설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §3 · 여정을 안 쓰는 회사 = 변화 0 · 여정 단계 캠페인은 그날 「보내는 중」으로 보이고 다음 날 여정이 닫는다 · 운영의 998900e1(완료 + 미확정 표식)은 표식 정리 주기가 다시 열어 확정한 뒤 닫는다 · 여정 세트 워커는 스위치 ENV 가 비어 있어 아무것도 안 한다(원장 표도 읽지 않는다)
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · dist grep closeFinishedStepCampaigns ≥ 1 · applyListAutoComplete ≥ 1 · reopenStepCampaignForConfirm ≥ 1 · runJourneySelfcheck ≥ 1 · journeySetTick ≥ 1 · pretestAndMark ≥ 1 · 재시작 뒤 에러 로그에서 「적재 중 표식 정리 실패 campaign=998900e1」 이 멎음 · 로그에 「[journey-set]」 0줄(스위치 꺼짐) · SELECT status, result_final, target_count, sent_count FROM campaigns WHERE id = '998900e1-00af-4f17-bc58-003ff4bf07c6'; = 대상 수 · 발송 수 10 · 그 캠페인의 journey_step_logs 에 sending 0 · ★1116 재발 캠페인 b3753555-4ac9-4c92-8626-1a81bed5621c(배포 전 = completed · 대상 1 · 발송 1 · 실행 71c32db0 이 12번 오류 뒤 15:45 실패)도 같은 확인 = 대상 수 · 발송 수가 지금 값 + 그 캠페인의 sending 표식 수 · sending 0 · 두 캠페인을 다시 열 때 경보 「여정 단계 캠페인이 미확정 발송을 가진 채 완료로 닫혀 있어 다시 열었습니다」가 캠페인마다 한 번 = 기대(배포 전 목록이 닫은 흔적)
- 결과: 1116 17:05 ~ 17:07 Harold 실행(같은 pull 에 C138 beb01e0e 함께) = git pull 50b50da1..f01c711f fast-forward 48파일(package.json 0 = npm install 없음) · 백엔드 build:safe [verify-dist] 통과(.js 883 · 두 판 3532 파일 일치) · 빌드 성공 · 프론트 build:safe 빌드 성공(lazy 청크 55 · 비literal import 0) · `pm2 reload targetup-backend` ✓(적재 0건 한 줄 조건 없이 실행 · --update-env 없이 = 이번 범위의 새 env 는 비운 채 나가는 JOURNEY_SELFCHECK_SET_COMPANY_IDS 하나라 같은 결과 · 원장 계산의 AI_OPERATOR_ALLOWED_USERS 는 옛 이름(plan-guard.ts) · 원장 머리 a7426275 가 낡아 범위가 넓게 잡힌 것) · 배포 뒤 확인(1116 Harold 출력) = pm2 online · 서버 HEAD f01c711f · 적재 중 0 · dist grep 여섯 이름 ≥ 1 · b3753555 = 17:08:28 표식 정리 주기가 다시 열어 확정(대상 2 · 발송 2 · sending 0 · 다시 열기 경보 1번) · 그 뒤 「적재 중 표식 정리 실패」 0 · journey-selfcheck 첫 판정 위반 0 · 998900e1 = 대상 · 발송 9 · 그 캠페인 단계 기록 0 · 원인 = 그 여정이 지워져 칸 연결(journey_step_campaigns FK → journeys CASCADE) · 실행 · 단계 기록이 함께 지워짐(1116 C139 실측 = 칸 연결 없는 여정 캠페인 50 중 하나 · 단계 기록 0 · 살아 있는 칸 0 · 마지막 오류 10:47:37) · 기대한 10 은 지운 여정의 미확정 한 단위라 확정할 주인이 없다(큐에 10번째 줄이 있는지 = MySQL 미검증) · C138 dist 확인 = C138-H1 원장

### C134-S1 · 실측(배포 다음 날 아침)
- 카드: C134
- 단계: 사후
- 선행: C134-H1(다음 날 00:40 KST 뒤)
- 기대: 로그 「[journey-selfcheck] YYYY-MM-DD company=c7c97996 위반 0(…) · 연속 0 일수 n/7 · 7일 동안 안 나간 (시작 종류/채널) …」 · 「여정 단계 캠페인 N건 닫음」(campaign-sync-worker · 00:10 뒤 첫 주기)
- 확인: 위 두 줄 · 위반이 0 이 아니면 그 줄 그대로 · SELECT day, violations FROM journey_selfcheck_daily ORDER BY day DESC LIMIT 7;
- 결과: (대기)

### C134-ENV-1 · 합성 회사에 여정 세트 켜기(JOURNEY_SELFCHECK_SET_COMPANY_IDS = 인비토 회사 id 하나 · 설계서 §12)
- 카드: C134
- 단계: ENV
- 선행: C134-H1 · C134-DDL-2 · C134-S1(첫 판정 줄을 본 뒤)
- 의미 바꿈: 예(그 회사에만 워커가 시작 종류 11개의 여정을 만들고 · 발송 전 검증(스팸 검사 14건 · 회사 단가표 차감)을 거쳐 · 켠다(처음 켜기 크레딧 200 × 11 = 2,200 · 크레딧제 적용 회사일 때) · 켜진 여정은 합성 고객(도달 불가 번호)에게 문자를 낸다 = 통신사에서 전부 실패로 끝난다 · 손으로 켠 같은 시작 종류 여정이 있으면 같은 합성 고객이 두 통을 받는다 · 비우면 워커가 멈춘다(이미 켜진 세트 여정은 켜진 채 남는다 = 화면에서 멈추거나 끝낸다))
- 기대: ENV 에 인비토 회사 id(쉼표 없이 하나) · 비밀값 아님 · 합성 회사 허용 목록(SYNTHETIC_DATA_COMPANY_IDS)에 없는 id 는 무시된다 · 낮 09 ~ 18시에만 · 10분마다 여정 하나 = 처음 켜는 날 약 2시간
- 확인: restart --update-env 뒤 낮 시간 로그 「[journey-set] YYYY-MM-DD company=c7c97996 세트 11 · 켜짐 n · …」(하루 한 줄) · 「[journey-set] company=c7c97996 signup 켰다 …」 줄이 10분마다 · 못 켠 행은 사유 원문(크레딧 부족 · 보내는 번호 · 시작 종류 잠김 · 스팸 검사)이 같은 줄에 · SELECT set_key, journey_id IS NOT NULL AS made, def_rev, validations, next_validate_at, last_reason FROM journey_selfcheck_set ORDER BY set_key;
- 결과: (대기)

### C134-S2 · 실측(여정 세트 · ENV 다음 날 아침)
- 카드: C134
- 단계: 사후
- 선행: C134-ENV-1(다음 날 00:40 KST 뒤)
- 기대: 「[journey-set] … 세트 11 · 켜짐 11」 · 「[journey-selfcheck] … 위반 0 · 7일 동안 안 나간 (시작 종류/채널)」 줄이 줄어든다 · 세트 여정의 칸 알림은 꺼져 있어 담당자 휴대폰으로 결과 안내가 가지 않는다
- 확인: 위 두 줄 · SELECT j.name, j.status, j.pause_reason, COUNT(e.id) AS entered FROM journeys j LEFT JOIN journey_executions e ON e.journey_id = j.id WHERE j.id IN (SELECT journey_id FROM journey_selfcheck_set) GROUP BY 1, 2, 3 ORDER BY 1; = 켜짐 · 진입 수 · 멈춘 것이 있으면 사유 그대로(워커는 다시 켜지 않는다) · 하루 발송 수(설계서 §12-6 어림 200 ~ 400 = 미검증 → 이 값으로 대체)
- 결과: (대기)

### C135-DDL-1 · 이미지 스튜디오 무료체험 표(설계서 docs/2026-11-15-v3-popup-trial-design.md §5-4) · ★ 배포 앞
- 카드: C135
- 단계: DDL
- 선행: 없음(배포 앞 · 새 표 · 표가 없으면 체험 판정은 「없음」 = 미가입 회사는 종전 403 그대로 · 신청 · 상태 주소만 503 DB_MIGRATION_PENDING · 로그인 직후 창은 종전 소개 창)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'image_studio_trials' ORDER BY ordinal_position;
- 확인: 다섯 줄 · company_id uuid NO · requested_by uuid YES · requested_at timestamp with time zone NO · granted integer NO · used_keys ARRAY NO
- 결과: 1115 15:4x 실행(Harold · 운영 장비 58.227.193.62) · CREATE TABLE · 칸 다섯 줄 기대값과 같음 · 같은 조회에서 user_intro_acks 다섯 줄(user_id uuid NO · intro_key character varying NO · login_marks ARRAY NO · dismissed_at timestamp with time zone YES · updated_at timestamp with time zone NO)도 새 장비에 있음 · 실행 길 = 새 장비의 administrator 가 docker 그룹에 없어 docker 소켓 거절 → root 셸 `usermod -aG docker administrator`(1115 · getent = docker:x:988:administrator) → 그 전에 맺은 접속(1114 22:25)에는 그룹이 안 붙어 `sg docker -c "…"` 로 감싸 실행

> C135-DDL-1 · 배포 앞 · 새 표 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C135-DDL-1
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS image_studio_trials (
  company_id uuid PRIMARY KEY,
  requested_by uuid NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  granted integer NOT NULL DEFAULT 3,
  used_keys text[] NOT NULL DEFAULT '{}'
);
```

### C135-H1 · 한줄로 배포(V3 로그인 팝업 + V3 페이지 + 이미지 스튜디오 무료체험 3회 + 팝업 기록 · 백엔드 + 프론트 · DDL 1 = C135-DDL-1 배포 앞 · ENV 0 = V3_LOGIN_INTRO 비운 채)
- 카드: C135
- 단계: 한줄로 배포
- 선행: 설계 Codex 3R · 목업 Codex 3R · 구현 Codex 3R approve(1115) · 커밋(Harold · 경로를 정해 = scratch/c135/commit-paths.txt · 문안 = scratch/c135/commit-msg.txt · 이 카드의 코드 파일 변경은 전부 C135 줄이고 다른 세션 미커밋 파일에 기대지 않는다 = 1115 git status -vv · import 대조로 확인 → 커밋은 이 카드만 따로 선다 · tp-push 는 쓰지 않는다) → C135-DDL-1 확인 출력 → push(★1115 15:50 차단 = pre-push 가 작업 트리에서 단위 전체를 돌리고 빨간불 1건 = C134 의 의도된 커밋 조건 `journey-selfcheck-set-1115.test.ts` 「통과 표식을 찍는 문장은 CT 한 곳」 · 걸린 줄 = routes/ai.ts 4545행 인라인 · 시험 파일도 routes/ai.ts 도 이 커밋에 없다 · 전례 C55 = 그 세션 정리 뒤 재실행 · `--no-verify` 금지 → 처방 1115 16:0x(Harold 「처방을 하고 배포명령어를」) = C134 설계서 §11 의 남은 한 걸음(routes/ai.ts 켜기 전 점검 라우트의 인라인 표식 → CT `pretestAndMark`)을 작업 트리에서 앞당겨 함 · tsc 0 · 단위 전체 821파일 13,237 전부 통과(1115 16:07) · Codex 증분 1R approve · 이 수정은 이 커밋에 없다(C134 커밋에 실린다) → `git push origin 03e5d935:main` = 이 커밋만)
- 기대: 설계서 docs/2026-11-15-v3-popup-trial-design.md §10 · 로그인 화면 = 종전 인증 안내 창 그대로(스위치 꺼짐) · 요금제 미가입 + 아직 신청하지 않은 회사의 로그인 직후 창 = 무료체험 창(그 밖의 회사 = 종전 소개 창) · 무료체험을 신청하지 않은 미가입 회사의 이미지 스튜디오 = 종전 요금제 안내 그대로 · 유료 회사 · 30일 AI 체험 중인 회사 = 변화 0(체험 표를 읽지도 않는다) · 직접발송 · 과금 경로 무접촉
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · dist grep studioTrialGate ≥ 1 · reserveStudioTrial ≥ 1 · loadStudioTrials ≥ 1 · v3LoginIntroOn ≥ 1 · 프론트 dist 에 about-v3.html 과 v3/poster-serum.jpg 가 있다 · curl -s https://hanjul.ai/api/public/intro/v3-login = {"success":true,"on":false} · curl -sI https://hanjul.ai/about-v3.html 첫 줄 = 200(정적 파일이 그대로 나간다 = 미검증 → 이 값으로 확인) · 재시작 뒤 에러 로그에 studio-trial · image_studio_trials 0줄
- 결과: 1115 16:2x ~ 16:3x 배포(Harold) · push a7426275..03e5d935(이 커밋만) · 서버 pull Fast-forward 57 files · 백엔드 build:safe → 프론트 build:safe → pm2 reload targetup-backend(세 줄을 이어 실행 · 빌드 출력은 받지 못함 · 적재 확인 줄 없이 재시작이 나감 → 뒤 확인 loading=0) · 서버 확인(16:4x) = HEAD 03e5d935 · dist 에 studioTrialGate · reserveStudioTrial · loadStudioTrials · v3LoginIntroOn 각 2파일 · targetup-backend online ↺ 1 · 에러 로그 220줄 중 studio-trial · image_studio_trials 0줄 · 운영 주소 실측(16:37) = /api/public/intro/v3-login {"success":true,"on":false} · /about-v3.html 200 제목 「한줄로 V3」 23,996B · /v3/poster-serum.jpg image/jpeg 51,022B(커밋 파일 크기와 같다) · **배포 직후 접수** = 로그인 화면 인증 안내 창이 반투명하고 뒤 화면이 비쳐 보임(Harold 캡처) → 원인 · 처방 = 설계서 §12-5 → C135-H2

### C135-S1 · 실측(미가입 시험 계정 · 무료체험 한 바퀴)
- 카드: C135
- 단계: 사후
- 선행: C135-H1 · 미가입 시험 계정(noplan · 30일 AI 체험이 켜져 있지 않을 것 = 켜져 있으면 무료체험 창 대신 종전 소개 창이 뜬다)
- 기대: 로그인 직후 무료체험 창(누끼 → 포스터 → MMS 장면) → 「무료체험 3회 이용하고 싶습니다」 → 「무료체험 3회가 열렸습니다 · 남은 횟수 3회」 → 이미지 스튜디오로 → 포스터 한 장 만들기 = 머리 줄 「무료체험 2회 남았어요」 → 세 장을 다 만든 뒤 넷째 = 「무료체험 3회를 모두 쓰셨어요」(만들지 않는다) → 만든 포스터 저장 → 직접발송의 MMS 이미지 첨부 「라이브러리에서 가져오기」로 붙는다 → 다시 로그인하면 무료체험 창이 아니라 종전 소개 창
- 확인: SELECT company_id, requested_by, requested_at, granted, cardinality(used_keys) AS used FROM image_studio_trials ORDER BY requested_at DESC LIMIT 5; = 그 회사 한 줄 · used 3 · 슈퍼관리자 「기능 관심 업체」 탭의 「이미지 스튜디오 무료체험 신청 업체」 표에 그 회사 · 만든 포스터 3 / 3장 · 「기능별 관심」에 무료체험 안내 창 줄(뜬 회사 · 체험 신청) · 그 회사의 AI 크레딧 내역에 이미지 스튜디오 차감 줄 0 · 수정(AI 로 고치기)을 누르면 종전 요금제 안내
- 결과: (대기)

### C135-ENV-1 · 로그인 화면 V3 안내 창 켜기(V3_LOGIN_INTRO = on)
- 카드: C135
- 단계: ENV
- 선행: C135-H1 · V3 단계 기능(상품 반응 · 기본 여정 한 번에 · 업종 평균)을 고객사에 연 뒤(C133-ENV-1 의 다음 단계 = 고객사로 넓힌 뒤 · 안 연 기능을 로그인 전에 소개하지 않는다)
- 의미 바꿈: 예(모든 고객사 로그인 화면의 안내 창이 인증 안내 창 → 한줄로 V3 안내 창 다섯 장면 · 인증 안내는 다섯째 장면과 「인증 안내 전체 보기」로 남는다 · 슈퍼관리자 화면 · 점검 안내 창이 뜨는 동안은 그대로 · 비우면 종전 인증 안내 창으로 돌아간다)
- 기대: ENV 값 on(그 밖의 값 · 빈 값 = 꺼짐) · 비밀값 아님
- 확인: restart --update-env 뒤 curl -s https://hanjul.ai/api/public/intro/v3-login = {"success":true,"on":true} · 로그인 화면에 V3 안내 창 · 「V3 자세히 보기」 = /about-v3.html · 「오늘 하루 보지 않기」를 누르면 그날 다시 뜨지 않는다
- 결과: 1115 18:3x 켬(Harold 「왜 안바뀌냐고」 = 선행의 「V3 를 고객사에 연 뒤」를 Harold 지시로 앞당김) · packages/backend/.env 에 V3_LOGIN_INTRO=on(한 줄 · 값 출력 0) → 적재 0건 확인 → pm2 restart targetup-backend --update-env · 운영 실측 18:34 = /api/public/intro/v3-login {"success":true,"on":true} · 남은 확인 = 로그인 화면의 V3 안내 창(Harold 화면) · 끄기 = 그 줄을 지우거나 값을 비우고 같은 재시작(답을 받는 즉시 종전 인증 안내 창)

### C135-H2 · 한줄로 배포(로그인 화면 안내 창을 첫 그림부터 띄움 · 배포 직후 접수 고침 · 프론트만 · DDL 0 · ENV 0)
- 카드: C135
- 단계: 한줄로 배포
- 선행: C135-H1 · Codex approve · 커밋(Harold · 경로를 정해 = scratch/c135/fix-paths.txt · 문안 = scratch/c135/fix-msg.txt · tp-push 는 쓰지 않는다) → push(이 커밋만)
- 기대: 설계서 docs/2026-11-15-v3-popup-trial-design.md §12-5 · 로그인 화면의 안내 창이 로그인 화면의 첫 그림과 함께 뜬다(답을 기다렸다가 뒤늦게 나타나지 않는다) · 스위치가 꺼진 지금 = 종전 인증 안내 창 · 배포 전(a7426275)과 같은 동작 · 백엔드 변경 0(시험 파일만) = 재시작 없음
- 확인: 서버 HEAD · 프론트 build:safe · 운영 로그인 화면을 강력 새로고침해 안내 창이 로그인 화면과 함께 뜨고 반투명 장면이 남지 않는다(Harold 화면) · 그 브라우저의 localStorage v3LoginIntroOn = 0
- 결과: 1115 18:1x 배포(Harold) · 커밋 ae0d30c2(6 files) · push 03e5d935..ae0d30c2(이 커밋만) · 서버 pull → 백엔드 build:safe → 프론트 build:safe(출력 = lazy 청크 게이트 통과 55건 · 비literal 동적 import 0건 · 빌드 성공 + atomic swap) → pm2 reload targetup-backend(백엔드 운영 코드 변경 0 · 런북에 없는 재시작 한 번) · 운영 실측(18:13 ~ 18:2x) = index.html Last-Modified 16:19:34 → 18:14:36 KST · 번들 index-BWo8CEyL.js → index-Vbw1KjnA.js · 로그인 입력 칸과 안내 창이 그려진 시각의 차 13 ~ 14ms → 0.00ms(4회 · 창 안 MutationObserver) · 새 판을 받은 창의 localStorage v3LoginIntroOn = 0 · Harold 화면 캡처(18:2x) = 인증 안내 창이 선명하게 그려짐

### C135-H3 · 한줄로 배포(로그인 화면 V3 안내 창의 넘김 = 마우스 멈춤 걷음 + 장면 시간 줄임 · 프론트만 · DDL 0 · ENV 0)
- 카드: C135
- 단계: 한줄로 배포
- 선행: C135-H2 · C135-ENV-1(켜짐) · Codex approve · 커밋(Harold · 경로를 정해 = scratch/c135/pace-paths.txt · 문안 = scratch/c135/pace-msg.txt · tp-push 는 쓰지 않는다) → push(이 커밋만)
- 기대: 설계서 docs/2026-11-15-v3-popup-trial-design.md §12-6 · 로그인 화면 V3 안내 창이 마우스가 창 위에 있어도 넘어간다 · 장면 시간 5 · 5.5 · 6 · 5.3 · 4초(한 바퀴 25.8초) · 멈춤 단추 · 움직임 줄이기는 종전 그대로 · 백엔드 변경 0(시험 파일만) = 재시작 없음
- 확인: 서버 HEAD · 프론트 build:safe(빌드 성공 + atomic swap) · 운영 로그인 화면을 강력 새로고침해 마우스를 창 위에 둔 채 장면이 5초 안팎마다 넘어간다(Harold 화면)
- 결과: 1116 07:2x 배포(Harold) · 커밋 a2b6aeb2(6 files) · push ae0d30c2..a2b6aeb2(1115) · 서버 확인(1116) = pull 전 HEAD ae0d30c2 · data-ms 7500 → pull → 백엔드 build:safe → 프론트 build:safe → pm2 reload(백엔드 운영 코드 변경 0 · 런북에 없는 재시작 한 번 · 빌드 출력은 받지 못함) · 운영 실측(1116 07:2x) = index.html Last-Modified 1115 18:14:36 → 1116 07:24:39 KST · 번들 index-Vbw1KjnA.js → index-jC5WBL_Q.js · 운영 V3 안내 창의 장면 시간 5000 · 5500 · 6000 · 5300 · 4000 · 창에 마우스가 올라온 채로 잰 넘김 시각 5.0 · 10.6 · 16.6 · 21.9 · 25.9초(hold 없음) · 남은 확인 = Harold 화면

### C136-H1 · 한줄로 배포(배포 가 = 소개 내용을 로그인 뒤로 · 로그인 화면 V3 안내 창 · 공개 V3 페이지 · 그림을 서버 보관으로 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C136
- 단계: 한줄로 배포
- 선행: 설계 Codex 4R · 목업 Codex 2R · 구현 Codex approve · 커밋(Harold · 경로를 정해 = scratch/c136/a-paths.txt · 문안 = scratch/c136/a-msg.txt · 이 배포의 파일은 다른 카드의 미커밋 파일과 겹치지 않는다 · tp-push 는 쓰지 않는다) → push(이 커밋만)
- 기대: 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2 · §12 · 로그인 화면의 안내 창 = 종전 인증 안내 창(V3 안내 창 0) · 로그인 직후 창 = 한줄로 V3 장면 창(장면 넷 · 계정당 최대 3번 · 새 판이라 옛 소개 창을 다 본 계정에도 뜬다) · 무료체험 창은 대상 · 횟수 그대로 · 창의 글과 그림은 로그인 뒤에만 내려간다 · ENV V3_LOGIN_INTRO 는 읽는 코드가 없어진다(지워도 되고 남겨도 무해)
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · dist grep peekIntro ≥ 1 · gatedImageFile ≥ 1 · 서버에 packages/backend/assets/gated/v3 그림 12장 · curl -s -o /dev/null -w "%{http_code}" https://hanjul.ai/api/plans/gated/img/poster-serum.jpg = 401(로그인 없이 못 받는다) · curl -sI https://hanjul.ai/v3/poster-serum.jpg 의 content-type 이 image 가 아니다 · curl -s https://hanjul.ai/about-v3.html 에 「마케터가 하던 일을」이 없다 · curl -s https://hanjul.ai/api/public/intro/v3-login = 404 · 로그인 화면을 강력 새로고침하면 인증 안내 창 · 로그인하면 장면 창
- 결과: 1116 11:3x 배포(Harold) · push 8e7ec2c6..50b50da1(11:22 · push 전 검사 통과) · Harold 가 실행했다고 알려 준 서버 명령 = git pull → 백엔드 build:safe → 프론트 build:safe → pm2 reload targetup-backend(빌드 출력 · 적재 0건 줄은 받지 못함 = 머리의 deployed_head 는 올리지 않음) · 받은 서버 확인 출력 = HEAD 50b50da1 · online · dist peekIntro 3 · gatedImageFile 2 · 서버 보관 그림 12장 · 옛 공개 파일 0 · /api/plans/v3-intro/peek 401 · /api/plans/gated/img/poster-serum.jpg 401 · /api/public/intro/v3-login 404 · /v3/poster-serum.jpg content-type text/html(그림 아님) · about-v3 문구 0 · 에러 로그 새 종류 0 · 운영에서 noplan 계정 로그인 뒤 장면 창이 그림과 함께 뜸(Harold 캡처) · 남은 확인 = 로그인 화면을 강력 새로고침했을 때 인증 안내 창만 뜨는지(Harold 화면) · 이 배포 뒤 접수 = 카드 C138(장면 창 숨김 단추 · 무료체험 입구)

### C136-DDL-1 · 제작 대행 체험 표(설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §8) · ★ 배포 나 앞
- 카드: C136
- 단계: DDL
- 선행: 없음(배포 나의 코드 앞 · 배포 가와는 무관 = 먼저 실행해도 무해 · 새 표 · 표가 없으면 제안 페이지의 신청 · 상태 주소만 503 DB_MIGRATION_PENDING)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'proposal_trials' ORDER BY ordinal_position;
- 확인: 스물다섯 줄 · company_id uuid NO · requested_by uuid NO · requested_at timestamp with time zone NO · src character varying YES · channel character varying NO · brief text NO · extra text YES · notify_phone character varying YES · photo_urls ARRAY NO · status character varying NO · produce_token uuid YES · produce_beat_at timestamp with time zone YES · produce_error text YES · kit jsonb NO · revision integer NO · garbage jsonb NO · produced_at timestamp with time zone YES · delivered_at timestamp with time zone YES · delivered_by uuid YES · notify_tries integer NO · notify_tried_at timestamp with time zone YES · notified_at timestamp with time zone YES · opened_at timestamp with time zone YES · used_at timestamp with time zone YES · updated_at timestamp with time zone NO
- 결과: (대기)

> C136-DDL-1 · 배포 나 앞 · 새 표 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C136-DDL-1
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS proposal_trials (
  company_id uuid PRIMARY KEY,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  src varchar(64) NULL,
  channel varchar(8) NOT NULL,
  brief text NOT NULL,
  extra text NULL,
  notify_phone varchar(20) NULL,
  photo_urls text[] NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'requested',
  produce_token uuid NULL,
  produce_beat_at timestamptz NULL,
  produce_error text NULL,
  kit jsonb NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 0,
  garbage jsonb NOT NULL DEFAULT '[]',
  produced_at timestamptz NULL,
  delivered_at timestamptz NULL,
  delivered_by uuid NULL,
  notify_tries integer NOT NULL DEFAULT 0,
  notify_tried_at timestamptz NULL,
  notified_at timestamptz NULL,
  opened_at timestamptz NULL,
  used_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### C136-H2 · 한줄로 배포(배포 나 = 제안 페이지 /proposal + 제작 대행 체험 + 슈퍼관리자 「제안 체험」 탭 · 백엔드 + 프론트 · DDL 1 = C136-DDL-1 배포 앞 · ENV 0)
- 카드: C136
- 단계: 한줄로 배포
- 선행: C136-H1 · C136-DDL-1 · 구현 Codex approve · **C133 C + D · C134 커밋 뒤**(App.tsx · Dashboard.tsx · AdminDashboard.tsx · app.ts 에 그 카드들의 미커밋 변경이 함께 있어 경로 커밋으로 가를 수 없다) · 커밋(Harold · 경로를 정해 = scratch/c136/b-paths.txt · 문안 = scratch/c136/b-msg.txt · tp-push 는 쓰지 않는다) → push(이 커밋만)
- 기대: 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §3 ~ §7 · 로그인 없이 /proposal?src=값 을 열면 한 줄과 로그인 단추만 · 로그인하면 제안 페이지로 돌아온다 · 사진 3 ~ 4장 + 한 줄 + 보낼 방식으로 신청(회사당 한 번) → 기계 제작(포스터 3 · 문안 3 · 모바일 DM 1 · 통신사 스팸 검사) → 슈퍼관리자 「제안 체험」 탭에서 확인 · 전달 → 담당자에게 문자 → 완성본 화면의 「명단만 올려 보내기」 = 직접발송 작성 화면에 문안 · 포스터가 채워진 채 열린다 · 신청하지 않은 회사 = 화면 · 동작 변화 0 · 발송 · 과금 코드 무수정
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · dist grep startProposalProduce = dist/utils/proposal-trial.js 정의 · dist/routes/proposal.js 호출 · deliverProposalKit ≥ 1 · 로그인 없이 https://hanjul.ai/proposal?src=test 를 열어 한 줄과 로그인 단추만 보이는지 · curl -s -o /dev/null -w "%{http_code}" https://hanjul.ai/api/plans/proposal = 401
- 결과: (대기)

### C136-S1 · 실측(인비토 시험 회사 · 제작 대행 체험 한 바퀴)
- 카드: C136
- 단계: 사후
- 선행: C136-H2 · 인비토 시험 회사 계정(도달 불가 합성 번호 회사 · 등록 발신번호가 있을 것)
- 기대: /proposal?src=invito-test 를 로그인 없이 열기 → 로그인 → 제안 페이지 → 사진 3장 + 한 줄 + MMS 로 신청 → 제작 중 화면 → 슈퍼관리자 「제안 체험」 탭에 그 회사가 「확인 대기」 · 포스터 3 · 문안 3(검사 결과) · 모바일 DM → 「담당자에게 전달」 → 알림 문자 「보냄」 → 담당자 화면이 완성본 → 「명단만 올려 보내기」 = 직접발송 작성 화면에 문안 · 포스터 · 「보내기 누름」 기록
- 확인: SELECT company_id, status, revision, jsonb_array_length(garbage) AS garbage, notify_tries, notified_at IS NOT NULL AS notified, opened_at IS NOT NULL AS opened, used_at IS NOT NULL AS used FROM proposal_trials ORDER BY requested_at DESC LIMIT 5; = 그 회사 한 줄 · status delivered · garbage 0 · notified t · opened t · used t · 제작 뒤 SELECT COUNT(*) FROM ai_credit_transactions WHERE company_id = '그 회사' AND created_at > '신청 시각'; = 0(크레딧 원장 무접촉) · 스팸 검사 차감 0(spam_filter_tests 의 그 검사 source = 무료 자동 검사 표시값) · 모바일 DM 칸이 「만들지 못함」이면 pm2 로그의 [proposal-trial] 모바일 DM 발행 잠금 줄(code · 사유)을 적는다(실제 조립된 DM 이 첫 발행 잠금을 지나는지는 이 실측에서 처음 본다 · 미검증)
- 결과: (대기)

### C137-H1 · 한줄로 배포(재오픈 cmwd36hnr1 · 이메일 대행 건을 다시 그리는 화면의 광고 표기 = 승인 링크 · 발송 결과 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C137
- 단계: 한줄로 배포
- 선행: Codex 구현 approve · 단위 전체 · 실 PG(c137-ad-text-render.pg) · 커밋(Harold · 경로를 정해 = scratch/c137/commit-paths.txt · 문안 = scratch/c137/commit-msg.txt · 이 카드 파일은 다른 카드의 미커밋 변경과 겹치지 않는다 · tp-push 는 쓰지 않는다) → push(이 커밋만)
- 기대: 설계서 docs/2026-11-16-c137-ad-text-render-design.md §4 · 이메일 대행 접수의 승인 링크 = 제목 앞 (광고) 없음 · 「광고 표시와 무료 수신거부 번호는 자동으로 붙습니다」 없음 / 발송 결과 목록 · 상세 = 이메일 대행 캠페인(send_config.adText = false · 1116 실측 3건)의 제목 · 본문에 (광고) · 080 없음 / 그 밖의 건 · 화면 = 종전 글자 그대로(미가입 · 직접발송 회사 변화 0) · 캘린더 · 예약 목록 · 슈퍼관리자 통계는 C137-H2 전까지 종전 그대로
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · dist grep campaignAdTextSelect = dist/utils/direct-send-spec.js 정의 · dist/routes/results.js 호출 · 에러 로그 새 종류 0 · 직원 시트 C137-T1
- 결과: 1116 09:4x 배포(Harold) · push a2b6aeb22..7e186fd7b(이 커밋만 · 작업 폴더에 다른 카드 C136 미커밋 작업이 있어 커밋 판 그대로인 임시 작업 폴더 targetup-c137(git worktree · core.autocrlf=false = 줄 끝 LF · node_modules 연결)에서 실 PG 전체 79파일 593건 통과 · 통과 기록 09:31 → 그 폴더에서 push · push 전 검사 통과) · 서버 pull → 백엔드 build:safe → 프론트 build:safe → pm2 reload(적재 확인 줄 없이 · 출력 받지 못함) · 서버 확인 = HEAD 7e186fd7 · dist grep campaignAdTextSelect = direct-send-spec.js 2 · results.js 2 · agency-approve.js 「ad_text === false」 1 · targetup-backend online · uptime 3m · restarts 5 · unstable 0 · script path dist/app.js · 에러 로그 끝 = 5분마다 여정 표식 정리 줄(B-1114-1 · 전부터) + 합성 데이터 안내 = 새 종류 0 · 운영 프론트 = index.html Last-Modified 1116 09:44:25 KST · 번들 index-jC5WBL_Q.js → index-DGcQkAVP.js · 남은 = C137-T1 직원 시트 · C137-H2

### C137-H2 · 한줄로 배포(캘린더 · 예약 목록 · 슈퍼관리자 통계 상세에 표기 칸 · routes/campaigns.ts · routes/admin.ts · 백엔드만 · DDL 0 · ENV 0)
- 카드: C137
- 단계: 한줄로 배포
- 선행: C137-H1 · ★1116 Harold 「캘린더랑 예약 목록도 마저 고치자」 = C133 C + D · C134 커밋을 기다리지 않고 앞당김 · 두 파일의 다른 카드 미커밋 변경은 싣지 않음(작업 트리 diff 를 거꾸로 적용해 HEAD 판을 되살려 blob 해시 대조 → 이 카드 줄만 다시 적용한 패치 scratch/c137/h2.patch 를 index 에만 얹어 커밋) · Codex approve · 커밋 판 임시 작업 폴더에서 실 PG · push
- 기대: 캘린더 문안 · 예약 목록 제목과 문안 수정 칸의 (광고) 표시 · 슈퍼관리자 통계 상세 문안도 이메일 대행 건은 고객 문안 그대로(화면 코드는 C137-H1 에서 이미 표기 칸을 본다 = 칸만 오면 따른다)
- 확인: dist grep campaignAdTextSelect = routes/campaigns.js · routes/admin.js · 직원 시트 C137-T1 에 줄 더함
- 결과: 1116 10:1x 배포(Harold) · 커밋 8e7ec2c6(4 files · 커밋 안 서버 줄 = 이 카드 7줄뿐 · git log -p 확인) · push 7e186fd7b..8e7ec2c6a(임시 작업 폴더 · 실 PG 전체 79파일 593건 통과 10:05 · 첫 실행 8건 실패 = 그 시각 C136 실 PG 전체와 겹침(프로세스 확인) · push 전 검사 통과) · 서버 pull Fast-forward 4 files → 백엔드 build:safe([verify-dist] 통과 · .js 878 · 두 판 3512 일치 · 빌드 성공) → 적재 0건 한 줄(loading=0) → pm2 reload targetup-backend · online · restarts 6 · uptime 5s · 확인 = HEAD 8e7ec2c6 · dist routes/campaigns.js campaignAdTextSelect 1 · routes/admin.js campaignAdTextSelect 1 · 「ad_text: c.ad_text」 1 · 재시작 뒤 에러 로그 새 줄 0(재시작 전 10:09:27 「여정 일시정지 journey=e8cd588b 잔액 부족」 한 줄 = 이 카드와 무관 · 기록만) · 프론트 변경 0 · 남은 = C137-T1 직원 시트

### C137-T1 · 직원 시트(서 팀장 · 접수 화면 그대로 · 시험용 회사 계정 · 받는 번호 = 직원 본인 휴대폰)
- 카드: C137
- 단계: 사후
- 선행: C137-H1
- 기대: 설계서 docs/2026-11-16-c137-ad-text-render-design.md §6 열 줄 전부 맞음
- 확인: 직원 결과(날짜 · 계정 · 사람) · 다름이면 캡처
- 결과: (대기)

### C138-H1 · 한줄로 배포(무료체험 신청 회사의 이미지 스튜디오 입구 통일 · 로그인 뒤 안내 창 둘(장면 창 · 무료체험 안내 창)의 「다시 보지 않기」 제거 · 슈퍼관리자 「기능 관심 업체」 화면 · 백엔드 + 프론트 · DDL 0 · ENV 0)
- 카드: C138
- 단계: 한줄로 배포
- 선행: 구현 Codex approve · 커밋(Harold · 경로를 정해 = scratch/c138/paths.txt · 문안 = scratch/c138/msg.txt · 이 카드의 코드 파일은 다른 카드의 미커밋 파일과 겹치지 않는다 · tp-push 는 쓰지 않는다) → push(이 커밋만)
- 기대: 설계 기록 docs/2026-11-16-c138-trial-entry-interest-design.md §3 · 무료체험을 신청한 미가입 회사 = AI 오퍼레이터의 「이미지 스튜디오」 카드에 「무료체험」 표시 · 누르면 스튜디오로 들어간다(그 밖 카드 = 종전 자물쇠 · 요금제 안내) · 로그인 뒤 장면 창의 단추 = 「이미지 스튜디오 보기」 · 「다음에 볼게요」 둘 · 무료체험 안내 창도 숨김 단추 없음(신청 단추 아래 「다음에 볼게요」 하나 · Harold 1116 「같이 없앰」) · 슈퍼관리자 「기능 관심 업체」 = 표 하나(무료체험 · 다시 보지 않기 칸) · 보기 · 기능 걸러 보기 · 화면 가로 전체
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · dist grep INTRO_DISMISSED_SQL = dist/utils/v3-intro.js 정의 · dist/utils/feature-interest.js 에 loadIntroDismissals 호출 · dist/content/gated/v3-popup.js 에 「이 소개 다시 보지 않기」 0줄 · 「이 안내 다시 보지 않기」 0줄(data-act="dismiss" 0줄) · 에러 로그 새 종류 0
- 결과: (대기)

### C138-S1 · 실측(요금제 미가입 시험 계정 noplan = 무료체험 신청함 · 슈퍼관리자 ceo)
- 카드: C138
- 단계: 사후
- 선행: C138-H1
- 기대: 설계 기록 docs/2026-11-16-c138-trial-entry-interest-design.md §11 열두 줄 전부 맞음(12번은 미신청 미가입 계정이 있을 때만)
- 확인: 결과(날짜 · 계정 · 사람) · 다름이면 캡처
- 결과: (대기)

### C139-H1 · 한줄로 배포(발송결과 메시지 내용 창 제목 + 여정 발송 건 변수 자리 표기 · 백엔드 + 프론트 · DDL 0 · DB 쓰기 0 · ENV 0)
- 카드: C139
- 단계: 한줄로 배포
- 선행: Codex 설계 4R · 구현 3R approve(1116) · 커밋(Harold · 경로 = scratch/c139/paths.txt · 일부 파일 = scratch/c139/partial.patch(git apply --cached) · 문안 = scratch/c139/msg.txt · journey-executor.ts · journey-message-render.ts 는 이 카드 줄만 = 다른 카드 C133 미커밋 덩어리와 한 파일 · journey-message-render.ts 의 C139 판 = 추천 자리 없는 판) → push · ★ 바로 앞 로컬 커밋 91568234(비토 대역 라벨 다시 생성 · 비토엔진 세션 · 1116 22:59 · Harold 요청이라는 전달 = 다음 배포에 함께)가 조상이라 이 push 에 함께 올라간다(Harold 1116 「C139 랑 하위세션에서 같이 배포해달라고 한거랑 같이 배포」) · push 전 단위 시험의 실 PG 통과 기록 대조 = 작업 트리 실 PG 전체 통과가 필요(1116 밤 = C133 나눠 보내기 시험 2건이 발송 창 밖 시각에 실패 · STATUS-FEED C133)
- 기대: 설계서 docs/2026-11-16-c139-results-display-design.md · 테스트발송내역 · 채널통합조회 · 발송 내역의 메시지 내용 창 = 장문 · 그림 줄 · 캠페인에 제목 한 줄 · 알림톡 · 브랜드가 문자로 대체된 줄 = 문자 모양 창 · 받은 글 · 제목 · 그 밖 창 변화 0 · 다음 여정 발송부터 단계 캠페인 행 본문 = 보낸 꼴에서 고객 값만 넣지 않은 글(「%고객명%님」) · 배포 전 여정 행 55 = 옛 글 그대로(설계서 3절) · 미가입 · 직접발송 회사 = 메시지 내용 창 제목 한 줄 말고 변화 0
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · dist grep deliveredViewOf ≥ 1(dist/utils/sms-result-map.js · dist/routes/campaigns.js · dist/routes/results.js) · journeySmsDisplayCopy ≥ 1 · stepCampaignDisplayCopy ≥ 1(dist/utils/journey-executor.js) · 재시작 뒤 에러 로그에 발송 내역 · 테스트 목록 조회 오류(Unknown column) 0 · 91568234 가 함께 내려왔으면 dist/utils/result-code-hanjul-band.generated.js 에 「MIME 형식 오류」 ≥ 1
- 결과: (대기)

### C139-S1 · 실측(배포 다음 날 아침 · 인비토 합성 회사 여정 행)
- 카드: C139
- 단계: 사후
- 선행: C139-H1(다음 날 오전 10시 30분 뒤)
- 기대: 배포 다음 날 만든 여정 캠페인 행 = message_content 에 「%」 변수 자리가 있고 고객 이름 0 · 알림톡 행 = 템플릿 원문 · 그날 여정 실행 실패 0
- 확인: SELECT 한 줄(배포 뒤 만든 send_type journey 행의 앞 30자 · 그 칸 판 앞 30자 · 대조) · 직원 시트 = 설계서 6절 두 장(묶음 작업 뒤 한 번)
- 결과: (대기)

### C133-DDL-6 · 나눠 보내기 표 둘(설계서 docs/2026-11-13-hanjul-v3-design.md §6 · §18 「배포 C-3」) · ★ 배포 앞
- 카드: C133
- 단계: DDL
- 선행: 없음(배포 C 의 코드 앞 · 배포 A + B 와는 무관 = 먼저 실행해도 무해 · 새 표 · 표가 없으면 워커는 로그 한 줄 · 화면 길은 503 DB_MIGRATION_PENDING)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT table_name, count(*) FROM information_schema.columns WHERE table_name IN ('campaign_split_tests', 'campaign_split_members') GROUP BY table_name ORDER BY table_name;
- 확인: 두 줄 · campaign_split_members 4 · campaign_split_tests 19
- 결과: (대기 · 배포 C 커밋 뒤 · 62 → 57 전환 뒤)

> C133-DDL-6 · 배포 앞 · 새 표 둘 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C133-DDL-6
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS campaign_split_tests (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status varchar(12) NOT NULL,
  test_pct smallint NOT NULL,
  wait_code varchar(8) NOT NULL,
  start_at timestamptz NOT NULL,
  decide_at timestamptz NOT NULL,
  spec jsonb NOT NULL,
  variants jsonb NOT NULL,
  groups jsonb NOT NULL,
  winner_index smallint NULL,
  verdict varchar(20) NULL,
  result jsonb NULL,
  block_reason text NULL,
  claim_token uuid NULL,
  claimed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_split_due ON campaign_split_tests (status, decide_at);
CREATE INDEX IF NOT EXISTS idx_campaign_split_company ON campaign_split_tests (company_id, created_at DESC);
CREATE TABLE IF NOT EXISTS campaign_split_members (
  split_id uuid NOT NULL,
  phone varchar(20) NOT NULL,
  customer_id uuid NOT NULL,
  grp smallint NOT NULL,
  PRIMARY KEY (split_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_campaign_split_members_grp ON campaign_split_members (split_id, grp);
```

### C133-H1 · 한줄로 배포(한줄로 V3 배포 A + B · 백엔드 + 프론트 · DDL 3 = C133-DDL-1 · -2 · -4 배포 앞 · 단계 ENV 전부 비운 채)
- 카드: C133
- 단계: 한줄로 배포
- 선행: 62 → 57 전환 · Codex 설계 7R approve · 구현 배포 A 4R approve · 배포 B approve · 커밋(Harold · 다른 세션 파일 뺌) → push · C133-DDL-1 · C133-DDL-2 · C133-DDL-4
- 기대: 설계서 docs/2026-11-13-hanjul-v3-design.md §2 ~ §5 · §18 · 단계 ENV 가 비어 있는 동안 바뀌는 것 = 로그인 소개 창의 내용(전 고객사 · 계정당 최대 3번)과 「켜기 전 점검」 창의 닫기(검증 중 닫기 = 취소 · 켜기 접수 뒤 닫기 = 숨김 · 최대 인원은 켜는 문장이 함께 씀)뿐 · 상품 구역 · 업종 평균 · 추천 칸 셋 · 혜택 칸 · 무료 추정은 닫힘 · 발송 · 과금 경로 변화 0
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · uptime · dist grep claimIntro ≥ 1 · runProductSignalPass ≥ 1 · snapshotBenchmarks ≥ 1 · parseActivationCaps ≥ 1 · v3FeaturesFor ≥ 1 · 기동 로그 「[product-signal] 워커 시작」 · 「[benchmark] 워커 시작」 각 한 줄 · 재시작 뒤 에러 로그에 새 종류 0
- 결과: 1114 19:30 Harold 서버 출력 = git pull 5b7c709d..38c3671f(52 파일) · 백엔드 build:safe 「[verify-dist] 통과 — .js 876개 문법 · 두 판 3504개 파일 일치」 · 프론트 build:safe 성공 · loading=0 → pm2 restart targetup-backend --update-env · online · uptime 94s · restarts 51 · unstable 0 · dist grep 다섯 이름 각 1 · 기동 로그 워커 시작 두 줄(19:30:01) · 재시작 뒤 에러 로그 새 종류 0(JourneyExecutor 표식 정리 실패 줄은 재시작 전부터 = B-1114-1) · 선행 「62 → 57 전환」 = 하지 않은 채 .62 에 배포(Harold 「배포 시작하자」 · 머리 deployed_head 줄) · 화면 확인(소개 창 · 켜기 전 점검 창 닫기) = 미검증(C133-T1)

### C133-ENV-1 · 사내 회사에 단계 열기(V3_STAGE_PRODUCT_INSIGHT · V3_STAGE_BENCHMARK · V3_STAGE_JOURNEY_PACK = 인비토 회사 id 하나)
- 카드: C133
- 단계: ENV
- 선행: C133-H1
- 의미 바꿈: 예(그 회사에만 성과리포트 「상품 · 검색어 반응」 구역 · 성공률 카드의 업종 평균 줄 · 여정 추천 칸 셋 · 혜택 칸 · 켜기 창 무료 추정이 열린다 · 그 회사의 상품 신호를 밤마다 60일 다시 센다 · 업종 평균 스냅숏은 전 회사의 완료 캠페인 30일을 밤마다 한 번 읽는다(PG 만) · 비우면 전부 닫힘 = 되돌리기)
- 기대: 세 ENV 에 인비토 회사 id(쉼표 없이 하나) · 비밀값 아님
- 확인: restart --update-env 뒤 2분 안 로그 「[benchmark] 첫 채우기 — 스냅숏 N행」 · product_signal_daily 에 그 회사 행 > 0(기동 90초 뒤 첫 채우기) · 인비토 계정 화면에서 구역 · 줄이 보임 · 다른 회사 계정에는 안 보임
- 결과: (일부 · V3_STAGE_JOURNEY_PACK 은 열지 않음 = 설계서 §14 전제 C129-S1 이 B-1114-1 로 닫히지 않음) 1114 Harold 서버 출력 = 사전 확인 v3_lines=0 · 끝 줄바꿈 있음 → .env 에 V3_STAGE_PRODUCT_INSIGHT · V3_STAGE_BENCHMARK = c7c97996-19b3-4e4f-9c45-ce10deab257f 두 줄(백업 사본 없이 덧붙임 · 되돌리기 = 그 두 줄 삭제) · v3_lines=2 · loading=0 → pm2 restart targetup-backend --update-env 19:38:08 · online · uptime 3m · restarts 52 · unstable 0 · 19:40:08 「[benchmark] 첫 채우기 — 스냅숏 121행」(기동 120초 뒤 시작 · 같은 초에 끝) · product_signal_daily = 회사 한 줄(c7c97996) 1,622행 · 상품 62 · 2026-09-16 ~ 2026-11-14 · benchmark_company_daily = 2026-11-14 121행 · 회사 52 · 업종 10 · 에러 로그 [benchmark] · [product-signal] 0줄 · 화면 확인(인비토에 보임 · 다른 회사에 안 보임) = 대기

### C133-P1 · 실측(ENV 뒤 · 읽기 전용 SQL · 그날 하나씩 안내)
- 카드: C133
- 단계: 배포 뒤
- 선행: C133-ENV-1
- 기대: ① 소개 창 = user_intro_acks 의 cardinality(login_marks) 최댓값 ≤ 3 · 「다시 보지 않기」 계정은 그 뒤 늘지 않음 ② 상품 표 = 한 상품의 최근 30일 조회 수가 cdp_events 를 직접 센 값과 같음(같은 KST 경계) ③ 업종 평균 = 스냅숏 날짜 = 오늘 · 회사마다 success_rate 한 행 · 값 0 ~ 1 ④ 묶음 켜기 1회(인비토 · 초안 하나 · 최대 인원을 칸에서 바꿔 켬) = 켜진 여정의 최대 인원 = 화면 값 · 옵션 저장 요청 로그 0
- 확인: 넷 다 일치 · 다르면 멈추고 원인부터
- 결과: (대기)

### C133-M1 · 서버에서 재야 할 사실(설계서 §15 · 읽기 전용 · 하나씩)
- 카드: C133
- 단계: 배포 뒤
- 선행: 62 → 57 전환(배포와 무관하게 잴 수 있다)
- 기대: ① 실패 행의 통신사 칸(mob_company) 채움 비율 = 통신사별 발송 성공률(C133-DDL-5 · 미룸)을 만들 수 있는지 ② 사건이 가장 많은 회사의 30일 product_view · cart_add · search 수와 상품 신호 다시 세기 실행 계획 ③ 조회 · 장바구니 사건의 상품 칸 꼴(items 배열 · 맨 위 칸) 분포 ④ 회사 업종(industry_code) 분포 = 업종마다 5곳이 되는지
- 확인: 값을 설계서 §15 에 적고 · ① 이 「남는다」면 통신사별 성공률 구현 착수 판단 · ② 가 2분을 넘으면 전체 개방(*) 전에 처방
- 결과: (대기)

### C133-S1 · 실측(ENV 뒤 하루)
- 카드: C133
- 단계: 사후
- 선행: C133-ENV-1(하루 뒤)
- 기대: 밤 로그 「[product-signal] 밤 계산 — 다시 센 회사 1 · 지운 회사 0 · 실패 0」(KST 3시대) · 「[benchmark] 밤 계산 — 스냅숏 N행」(KST 4시대) · 두 워커 실패 로그 0
- 확인: 위 로그 · 실패가 있으면 그 줄 그대로
- 결과: (대기)

### C133-P0 · 배포 C 앞 확인(읽기 전용 · 추천 자리 글자가 든 기존 본문 0)
- 카드: C133
- 단계: 사전
- 선행: 없음(배포 C 의 코드 앞)
- 기대: 여정 칸 본문 · 그 스냅숏 · 문안 후보에 「<추천상품」 글자가 든 행 0(배포 C 뒤에는 그 글자가 추천 자리로 읽힌다)
- 확인: 세 수가 전부 0 · SELECT (SELECT count(*) FROM journey_steps WHERE message_template LIKE '%<추천상품%') AS steps, (SELECT count(*) FROM journey_step_snapshots WHERE message_body LIKE '%<추천상품%') AS snaps, (SELECT count(*) FROM journey_step_variants WHERE message_template LIKE '%<추천상품%') AS variants; · 0 이 아니면 그 행을 보고 멈춘다
- 결과: (대기 · 배포 C 커밋 뒤)

### C133-H2 · 한줄로 배포(한줄로 V3 배포 C = 추천 상품 자리 · 상품 묶음 앞세우기 · 받는 사람용 반응 숫자 · 나눠 보내기 · 백엔드 + 프론트 · DDL 1 = C133-DDL-6 배포 앞 · V3_STAGE_RECO · V3_STAGE_SPLIT 비운 채)
- 카드: C133
- 단계: 한줄로 배포
- 선행: C133-H1(배포 A + B 가 먼저 = 발송 길을 바꾸는 배포는 한 번에 하나) · Codex 구현 C-1 4R · C-2 2R · C-3 3R approve(1114) · 커밋(Harold · 다른 세션 파일 뺌 · 경로 = 설계서 §18 「배포 C + D 커밋 경로」 = C 와 D 한 커밋) → push · C133-P0 · C133-DDL-6
- 기대: 설계서 docs/2026-11-13-hanjul-v3-design.md §5-3 · §5-4 · §6 · §18 · 두 ENV 가 비어 있는 동안 바뀌는 것 = 0(추천 줄 · 상품 묶음의 「관심 상품을 앞에」 칸 · 나눠 보내기 패널과 현황 줄 = 그리지 않음 · 나눠 보내기 주소 = 403 · 워커 = 분당 빈 표 조회 한 번) · 상품 묶음의 「반응 숫자 표시」 칸은 배포 A 의 V3_STAGE_PRODUCT_INSIGHT 를 연 회사에만 보인다 · 발송 · 과금 경로 변화 0(직접발송 배관 파일 무수정)
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · uptime · dist grep advanceSplit ≥ 1 · discardSplitStart ≥ 1 · pickRecoIndex ≥ 1 · markRecoFront ≥ 1 · shortenUrlsStrict ≥ 1 · 기동 로그 「[campaign-split-worker] 시작」 한 줄 · 재시작 뒤 에러 로그에 새 종류 0
- 결과: (대기)

### C133-ENV-2 · 사내 회사에 단계 열기(V3_STAGE_RECO · V3_STAGE_SPLIT = 인비토 회사 id 하나)
- 카드: C133
- 단계: ENV
- 선행: C133-H2
- 의미 바꿈: 예(그 회사에만 여정 문자의 「추천 상품」 줄 · 상품 묶음의 「관심 상품을 앞에」 칸 · AI 한줄로 결과 창의 「문안을 나눠 보내고 반응 좋은 쪽으로」 패널 · 대시보드 나눠 보내기 현황 줄이 열린다 · 비우면 전부 닫힘 = 되돌리기 · 진행 중인 나눠 보내기는 다음 단계에서 남은 묶음을 보내지 않고 끝난다)
- 기대: 두 ENV 에 인비토 회사 id(쉼표 없이 하나) · 비밀값 아님
- 확인: restart --update-env 뒤 인비토 계정 화면에서 네 자리가 보임 · 다른 회사 계정에는 안 보임
- 결과: (대기)

### C133-P2 · 실측(배포 C · ENV 뒤 · 인비토 회사 = 도달 불가 합성 번호 · 하나씩 안내)
- 카드: C133
- 단계: 배포 뒤
- 선행: C133-ENV-2
- 기대: ① 추천 칸 1개 여정의 실발송 1건 = 받는 글의 추천 자리가 후보 안의 이름 또는 대체 문장 · 차감 1건 ② 상품 묶음(관심 상품을 앞에 켬) 이메일 1통 = 그 고객이 최근에 본 상품이 맨 앞 · 모바일 DM 열람 1회도 같음 ③ 나눠 보내기 1회(문안 2 · 몫 30% · 1시간) = 시험 묶음 캠페인 둘(send_type operator · 문안별 인원 = 확인 창의 수) → 판정 시각 뒤 나머지 캠페인 하나 · campaign_split_tests 한 행 done · campaign_split_members 0행 · 차감 = 세 캠페인의 접수 건수
- 확인: 셋 다 일치 · 다르면 멈추고 원인부터
- 결과: (대기)

### C133-M2 · 서버에서 재야 할 사실(배포 C · 읽기 전용 · 하나씩 · 고객사에 열기 전)
- 카드: C133
- 단계: 배포 뒤
- 선행: C133-H2
- 기대: ① 추천 고르기 조회(product-reco RECO_PICK_SQL)의 실행 계획과 시간 — 상품 신호가 가장 많은 회사 · 그 회사 고객 하나로(이메일은 받는 사람마다 한 번 돈다 · 설계서 §18 C-2 미측정) ② 나눠 보내기 판정 조회(campaign-split SPLIT_DEVICES_SQL)의 실행 계획 — message_click 이 가장 많은 회사 · 최근 6시간 ③ message_click 의 properties.ip 가 기기마다 다르게 찍히는가(최근 100건의 서로 다른 ip 수 · 전부 같은 값이면 누른 기기 수가 user_agent 만으로 묶인다)
- 확인: 값을 설계서 §18 에 적고 · ① 이 받는 사람마다 수십 ms 를 넘으면 회사 값 부분을 발송 한 번에 한 번으로 올리는 처방 뒤에 고객사에 연다 · ③ 이 한 값이면 프록시 설정부터 본다(나눠 보내기를 고객사에 열지 않는다)
- 결과: (대기)

### C133-DDL-7 · 답장 상담 표 넷(설계서 docs/2026-11-13-hanjul-v3-design.md §7 · §18 「배포 D」) · ★ 배포 앞
- 카드: C133
- 단계: DDL
- 선행: 없음(배포 D 의 코드 앞 · 먼저 실행해도 무해 · 새 표 · 표가 없으면 워커는 로그 한 줄 · 화면 길은 503 DB_MIGRATION_PENDING)
- 의미 바꿈: 아니오(새 표 · 옛 코드가 읽지 않음)
- 기대: 서버 psql 에서 아래 블록 · 확인 = SELECT table_name, count(*) FROM information_schema.columns WHERE table_name IN ('inbound_numbers', 'inbound_messages', 'inbound_settings', 'inbound_kb_items') GROUP BY table_name ORDER BY table_name;
- 확인: 네 줄 · inbound_kb_items 8 · inbound_messages 23 · inbound_numbers 8 · inbound_settings 10
- 결과: (대기 · 배포 D 커밋 뒤 · 62 → 57 전환 뒤)

> C133-DDL-7 · 배포 앞 · 새 표 넷 · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음)

```sql ddl:C133-DDL-7
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS inbound_numbers (
  number varchar(20) PRIMARY KEY,
  company_id uuid NULL,
  first_company_id uuid NULL,
  shared_at timestamptz NULL,
  note varchar(100) NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_numbers_company_history CHECK (company_id IS NULL OR (first_company_id IS NOT NULL AND company_id = first_company_id)),
  CONSTRAINT inbound_numbers_shared_alone CHECK (shared_at IS NULL OR (company_id IS NULL AND first_company_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_inbound_numbers_company ON inbound_numbers (company_id);
CREATE TABLE IF NOT EXISTS inbound_messages (
  id uuid PRIMARY KEY,
  provider_msg_id varchar(100) NOT NULL UNIQUE,
  direction varchar(3) NOT NULL,
  from_phone varchar(20) NOT NULL,
  to_number varchar(20) NOT NULL,
  body text NOT NULL,
  company_id uuid NULL,
  status varchar(16) NOT NULL,
  handled_by varchar(8) NULL,
  kb_item_id uuid NULL,
  draft text NULL,
  note varchar(200) NULL,
  reply_to uuid NULL,
  reply_callback varchar(20) NULL,
  reply_staging_id uuid NULL,
  reply_campaign_id uuid NULL,
  assigned_by uuid NULL,
  ai_called_at timestamptz NULL,
  claim_token uuid NULL,
  claimed_at timestamptz NULL,
  received_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_thread ON inbound_messages (company_id, from_phone, received_at);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_box ON inbound_messages (company_id, status, received_at);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_work ON inbound_messages (status, received_at);
CREATE INDEX IF NOT EXISTS idx_inbound_messages_ai ON inbound_messages (company_id, ai_called_at) WHERE ai_called_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_messages_ai_reply ON inbound_messages (reply_to) WHERE direction = 'out' AND handled_by = 'ai';
CREATE TABLE IF NOT EXISTS inbound_settings (
  company_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  mode varchar(8) NOT NULL DEFAULT 'auto',
  reply_callback varchar(20) NULL,
  auth_callback varchar(20) NULL,
  daily_cap int NULL,
  notify_phone varchar(20) NULL,
  handoff_text varchar(200) NULL,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS inbound_kb_items (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  title varchar(60) NOT NULL,
  body varchar(600) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbound_kb_company ON inbound_kb_items (company_id, sort);
```

### C133-H3 · 한줄로 배포(한줄로 V3 배포 D = 답장 상담 · 백엔드 + 프론트 · DDL 1 = C133-DDL-7 배포 앞 · V3_STAGE_INBOX · INBOUND_SMS_KEY 비운 채)
- 카드: C133
- 단계: 한줄로 배포
- 선행: C133-H2(배포 C 가 먼저) · Codex 설계 D 3R approve · 구현 Codex approve · 커밋(C 와 한 커밋 · 경로 = 설계서 §18 「배포 C + D 커밋 경로」) → push · C133-DDL-7
- 기대: 설계서 docs/2026-11-13-hanjul-v3-design.md §7 · §18 「배포 D」 · 두 ENV 가 비어 있는 동안 바뀌는 것 = 0(헤더의 「상담함」 · 편집기의 「상담 번호 넣기」 = 그리지 않음 · 상담함 주소 = 403 · 수신 입구 = 404 · 워커 = 분당 빈 표 조회 둘) · 슈퍼관리자에 「답장 상담」 탭이 생긴다(번호 0 · 미배정 0) · 발송 · 과금 경로 변화 0(직접발송 배관 파일 무수정)
- 확인: 서버 HEAD · 백엔드 build:safe([verify-dist] 통과) · 프론트 build:safe · 적재 0건 한 줄 → 재시작 · online · uptime · dist grep receiveInbound ≥ 1 · decideInbound ≥ 1 · sendClaimedReply ≥ 1 · discardSplitStart ≥ 1 · 기동 로그 「[inbound-worker] 시작」 한 줄 · 재시작 뒤 에러 로그에 새 종류 0
- 결과: (대기)

### C133-ENV-3 · 답장 상담 열기(V3_STAGE_INBOX = 인비토 회사 id 하나 · INBOUND_SMS_KEY = 수신 배선과 맞춘 열쇠)
- 카드: C133
- 단계: ENV
- 선행: C133-H3 · Harold 수신 배선(공용 수신 번호 발급 · 들어온 문자를 한줄로로 넘기는 길)
- 의미 바꿈: 예(V3_STAGE_INBOX = 그 회사 관리자에게만 상담함이 열린다 · 비우면 닫힘 = 되돌리기 · 받은 글은 남고 자동 답장은 멈춘다 / INBOUND_SMS_KEY = 수신 입구가 열린다 · 비우면 404)
- 기대: V3_STAGE_INBOX 에 인비토 회사 id 하나 · INBOUND_SMS_KEY 는 비밀값(출력하지 않는다 · 설정 여부만 슈퍼관리자 「답장 상담」 탭의 「수신 입구 열쇠 = 설정됨」으로 본다)
- 확인: restart --update-env 뒤 슈퍼관리자 탭에서 열쇠 = 설정됨 · 번호 하나 등록 → 인비토 회사에 묶기 → 인비토 관리자 계정 헤더에 「상담함」 · 담당자 계정과 다른 회사 계정에는 안 보임
- 결과: (대기)

### C133-P3 · 실측(배포 D · ENV 뒤 · 인비토 회사 = 도달 불가 합성 번호 · 하나씩 안내)
- 카드: C133
- 단계: 배포 뒤
- 선행: C133-ENV-3
- 기대: ① 상담 설정 = 켬 · 바로 답장 · 답변 항목 2개 저장(발신 인증 창이 뜨면 통과) ② 슈퍼관리자 「직접 등록」으로 묶인 번호에 문의 1건 → 1 ~ 2분 안에 상담함에 「자동으로 보냄」 답장 한 줄 · 발송결과에 「상담 답장 · ···끝4자리」 캠페인 1건(직접발송 · 광고 아님) · 차감 1건 ③ 「수신거부」 한 건 → 수신거부 메뉴에 그 번호(출처 inbound_sms) · 답장 0 ④ 등록 답변에 없는 문의 1건 → 넘김 문장 1통 + 상담함 「사람 필요」 → 직접 답장 1통 ⑤ 안 묶인 번호로 1건 → 미배정함 → 인비토로 배정 → 그 번호는 「직접 배정 전용」
- 확인: 다섯 다 일치 · 다르면 멈추고 원인부터
- 결과: (대기)

### C133-M3 · 서버에서 재야 할 사실(배포 D · 읽기 전용 · 고객사에 열기 전)
- 카드: C133
- 단계: 배포 뒤
- 선행: C133-P3
- 기대: ① 수신 배선이 넘기는 본문의 칸 이름 · 번호 표기(입구가 받는 from · to · text · receivedAt · providerMsgId 와 같은가 · 같은 문자를 두 번 넘길 때 providerMsgId 가 같은가) ② 상담함 목록 조회(inbound-sms listThreads)의 실행 계획 — 받은 글이 쌓인 뒤 ③ AI 고르기의 정확도(등록 답변 5 ~ 10개 · 문의 20건 · 틀리게 고른 수)
- 확인: 값을 설계서 §18 에 적고 · ① 이 다르면 입구의 본문 읽기를 맞춘 뒤에 · ③ 에서 틀리게 고른 답이 나가면 「초안만」 방식으로만 고객사에 연다
- 결과: (대기)

### C133-T1 · 직원 시트(한줄로 V3)
- 카드: C133
- 단계: 직원 시트
- 선행: C133-ENV-1 · 배포 C · D
- 기대: 설계서 §13 의 직원 지시문(테스트계정 · 도달 불가 번호 · 발송 0)
- 확인: 소개 창 3회 · 다시 보지 않기 · 상품 구역 → 직접발송 명단 · 업종 평균 줄 · 추천 칸 · 혜택 칸 · 켜기 창 추정 · 닫기 두 구간 · 여정 문자의 추천 상품 줄 · 상품 묶음의 반응 숫자와 관심 상품을 앞에 · 나눠 보내기(토글 잠금 이유 · 확인 창 · 시작 안 하기 · 요약 창 · 이어 보내기 · 그만) · 상담함(설정 켜기 · 답변 항목 · 직접 등록한 문의의 자동 답장 · 사람 필요 → 직접 답장 · 답 없이 닫기 · 상담 번호 넣기)
- 결과: (대기 · 로드맵 묶음이 끝난 뒤 한 번)

## §2 덤프 뒤 적용분

> 다음 재덤프 때 각 설계서(2026-10-27-mall-integration-hardening-design.md §3 · §11)로 옮기고 비운다.
> C71-DDL-1 · 1028 Harold 실행 · customer_stores.consent_source_at 있음(timestamp with time zone · NULL 허용) · 되돌리기 = 그 설계서 §3 DDL-1 행

```sql ddl:C71-DDL-1
ALTER TABLE customer_stores ADD COLUMN consent_source_at timestamptz NULL;
```

> C71-DDL-3 · 1028 Harold 실행 · customers.consent_source_at 있음(timestamp with time zone · NULL 허용) · 되돌리기 = 그 설계서 §3 DDL-3 행

```sql ddl:C71-DDL-3
SET lock_timeout = '3s';
ALTER TABLE customers ADD COLUMN consent_source_at timestamptz NULL;
```

> C73-DDL-2 · 1028 Harold 실행 · company_integrations.webhook_secret = text(before 100 → 길이 NULL) · 되돌리기 = 남겨도 무해(넓힘) · 정의 해시 대조 = 다음 대조 때

```sql ddl:C73-DDL-2
SET lock_timeout = '3s';
ALTER TABLE company_integrations ALTER COLUMN webhook_secret TYPE text;
```

> C73-DDL-4 · 1028 Harold 실행 · cdp_identity_links.server_verified_at 있음(timestamp with time zone · NULL 허용 · before 0행) · 되돌리기 = 남겨도 무해(칸 추가) · 정의 해시 대조 = 다음 대조 때

```sql ddl:C73-DDL-4
SET lock_timeout = '3s';
ALTER TABLE cdp_identity_links ADD COLUMN server_verified_at timestamptz NULL;
```

> C84-DDL-2 · 1031 Harold 실행(코드 bb719adf 배포 뒤 · 순서 바뀜 · 그 사이 발송 전 안내는 건너뛰고 경보 · 발송은 진행) · journey_pretest_schedules.notice_attempts 있음(smallint · NOT NULL · 기본 0) · 되돌리기 = 남겨도 무해(옛 코드가 읽지 않음) · 정의 해시 대조 = 다음 대조 때

```sql ddl:C84-DDL-2
SET lock_timeout = '3s';
ALTER TABLE journey_pretest_schedules ADD COLUMN IF NOT EXISTS notice_attempts smallint NOT NULL DEFAULT 0;
```

> C84-DDL-1 · 1031 Harold 실행(코드 bb719adf 배포 뒤 · C84-DDL-2 다음) · journey_step_campaigns.result_notice_at(timestamp with time zone · NULL 허용) · result_notice_attempts(smallint · NOT NULL · 기본 0) · result_notice_sent(integer · NULL 허용) 있음 · 기준선 UPDATE 10 · 남은 NULL 0 · 되돌리기 = 남겨도 무해(새 코드는 칸이 없으면 결과 안내를 건너뛴다) · 정의 해시 대조 = 다음 대조 때

```sql ddl:C84-DDL-1
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE journey_step_campaigns
  ADD COLUMN IF NOT EXISTS result_notice_sent integer NULL,
  ADD COLUMN IF NOT EXISTS result_notice_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS result_notice_attempts smallint NOT NULL DEFAULT 0;
UPDATE journey_step_campaigns jsc
   SET result_notice_sent = COALESCE(c.sent_count, 0), result_notice_at = NOW()
  FROM campaigns c
 WHERE c.id = jsc.campaign_id AND jsc.result_notice_at IS NULL;
COMMIT;
```
