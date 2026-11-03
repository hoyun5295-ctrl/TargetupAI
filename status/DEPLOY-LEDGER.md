# 배포 원장

> 상시 로드 아님. **「배포 시작하자」 때 이 파일부터 연다.** 칸의 뜻 · 규칙 = [설계서](../docs/2026-10-27-real-pg-test-deploy-ledger-design.md) §3 · 코드 배포 순서 = [OPS.md](OPS.md) §2-2(여기는 가리키기만).
> 계산 = `packages/backend` 에서 `node scripts/deploy-ledger.mjs`(읽기 전용 git · 이번 pull 에 딸려 가는 것 · 받았지만 아직 안 도는 것 · 카드 상태).
> **이 파일을 쓸 때마다** 카드 상태를 다시 계산해 STATUS 줄을 맞춘다(STATUS 줄은 계산 결과의 사본). SQL 원문은 여기 한 곳(설계서에는 id 만).
> 명령은 응답 하나에 하나 · 되돌리기 블록은 답에 붙이지 않는다 · 발송을 멈추는 명령은 「그때 단독」.

## 머리

- pulled_head: 3af58654 · 2026-11-03 · Harold 출력(서버 pull 943fd803..3af58654 · Fast-forward · 212 files · 이미지 스튜디오 e904cb87 · C98 3af58654 · 서버 pull 앞 = 943fd803 · 원장 8372eb16 과 그 사이 pull 기록 없음) · 그 전 8372eb16
- deployed_head: 3af58654 · 2026-11-03 · Harold 출력(새 패키지 0 = npm install 건너뜀 · 백엔드 build:safe 08:42:53 성공 · 프론트 build:safe 성공 · 적재 중 0건(loading=0) 확인 뒤 pm2 restart targetup-backend --update-env · online · restarts 41 · 새 PID 2674452 · 켜진 시각 08:47:20 · /health 200 · 에러 로그 0줄(00:00 회전 뒤 0바이트 · pm2 가 쓰는 경로 확인) · 출력 로그 = 여정 · 자동마케팅 워커 시작 줄 · tick · SQL 오류 0 · 멈춤 1 = 한줄 뷰티(시연) 신규 가입 환영(C99 §11)) · 그 전 8372eb16(C94 · C95) · C77-ENV-1 은 아직
- 이번 창 확인 출력: backend-build · restart-env · uptime · frontend-build
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
| C99 | 미커밋 |
| C101 | 미커밋 |

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
- 결과:

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
