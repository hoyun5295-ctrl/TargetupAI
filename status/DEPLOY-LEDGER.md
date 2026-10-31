# 배포 원장

> 상시 로드 아님. **「배포 시작하자」 때 이 파일부터 연다.** 칸의 뜻 · 규칙 = [설계서](../docs/2026-10-27-real-pg-test-deploy-ledger-design.md) §3 · 코드 배포 순서 = [OPS.md](OPS.md) §2-2(여기는 가리키기만).
> 계산 = `packages/backend` 에서 `node scripts/deploy-ledger.mjs`(읽기 전용 git · 이번 pull 에 딸려 가는 것 · 받았지만 아직 안 도는 것 · 카드 상태).
> **이 파일을 쓸 때마다** 카드 상태를 다시 계산해 STATUS 줄을 맞춘다(STATUS 줄은 계산 결과의 사본). SQL 원문은 여기 한 곳(설계서에는 id 만).
> 명령은 응답 하나에 하나 · 되돌리기 블록은 답에 붙이지 않는다 · 발송을 멈추는 명령은 「그때 단독」.

## 머리

- pulled_head: bb719adf · 2026-10-31 · Harold 실행 출력 `git pull` = 18cc05e2..bb719adf Fast-forward 53파일(C84 · C85)
- deployed_head: bb719adf · 2026-10-31 · Harold 보고 「여기까지 했어」(backend · frontend build:safe · pm2 reload targetup-backend · 빌드 출력 원문은 안 받음) · 그 전 18cc05e2(1030 C83 후속) · C77-ENV-1 은 아직
- 이번 창 확인 출력: backend-build · frontend-build · reload(Harold 보고 · 출력 원문은 안 받음)
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
| C86 | 미커밋 |
| C87 | 미커밋 |

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
