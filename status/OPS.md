# 한줄로 — 운영 레퍼런스 (OPS)

> **이 문서는 STATUS.md / SCHEMA.md와 함께 운영됩니다.**
> 서버 설정, 접속 정보, 인프라 변경 시 반드시 이 문서도 함께 업데이트하십시오.

---

## 1. 접속 정보

### 1-1. 로컬 개발 환경
| 서비스 | Host | Port | DB/User | 비고 |
|--------|------|------|---------|------|
| PostgreSQL | localhost | 5432 | targetup / targetup | `docker exec -it targetup-postgres psql -U targetup targetup` |
| MySQL (QTmsg) | localhost | 3306 | smsdb / smsuser / sms123 | `docker exec -it targetup-mysql mysql -usmsuser -psms123 smsdb` |
| Redis | localhost | 6379 | - | |
| 프론트엔드 | localhost | 5173 | - | |
| 백엔드 API | localhost | 3000 | - | |
| pgAdmin | localhost | 5050 | - | |

### 1-2. 상용 서버 (IDC)
| 서비스 | Host | Port | 비고 |
|--------|------|------|------|
| SSH | 58.227.193.62 | 22 | administrator |
| PostgreSQL | localhost | 5432 | Docker 컨테이너 (튜닝 완료) |
| MySQL (QTmsg) | localhost | 3306 | Docker 컨테이너 |
| Redis | localhost | 6379 | Docker 컨테이너 |
| Nginx | 0.0.0.0 | 80/443 | 리버스 프록시 + SSL, client_max_body_size 50M |
| 백엔드 API | localhost | 3000 | PM2 관리 |

---

## 2. 개발 워크플로우

### 2-1. 로컬 개발 (코드 수정 & 테스트)
```bash
# 1. 도커 시작
docker start targetup-postgres targetup-redis targetup-mysql

# 2. 백엔드
cd C:\projects\targetup\packages\backend && npm run dev

# 3. 프론트엔드
cd C:\projects\targetup\packages\frontend && npm run dev

# 4. 코드 수정 → 로컬 테스트 → 완료 후:
git add -A
git commit -m "설명"
git push
```

### 2-2. 서버 배포 (SSH 접속 후)
```bash
ssh administrator@58.227.193.62

# 1. 소스 업데이트
cd /home/administrator/targetup-app
git pull

# 2. 프론트엔드 빌드 (변경 시)
cd packages/frontend && npm run build
# 또는 company-frontend 변경 시
cd packages/company-frontend && npm run build

# 3. 백엔드 재시작 (변경 시)
pm2 restart all

# 4. 확인
pm2 status
```

### 2-3. QTmsg 발송 엔진 (로컬 - 개발용)
```bash
cd C:\projects\qtmsg\bin
.\test_in_cmd_win.bat
# 이미 실행 중 에러 시: del *.pid *.lock 후 재실행
```

---

## 3. 주요 파일 경로
```
C:\projects\targetup\  (로컬)
/home/administrator/targetup-app/  (서버)
├── packages/
│   ├── backend/
│   │   └── src/
│   │       ├── app.ts              ← 백엔드 메인
│   │       ├── routes/             ← API 라우트
│   │       └── services/           ← 비즈니스 로직
│   ├── frontend/                   ← 서비스 사용자 + 슈퍼관리자 UI
│   │   └── src/
│   │       ├── components/         ← UI 컴포넌트
│   │       ├── pages/              ← 페이지 (LoginPage.tsx, PrivacyPage.tsx, TermsPage.tsx)
│   │       └── services/           ← API 호출
│   └── company-frontend/           ← 고객사 관리자 UI (app.hanjul.ai)
│       └── src/
│           ├── components/
│           ├── pages/
│           └── services/
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
| `/etc/nginx/sites-available/targetup-app` | app.hanjul.ai | company-frontend/dist |

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

### 6-5. 백엔드 라인그룹 기반 분배
- 환경변수: `SMS_TABLES=SMSQ_SEND_1,SMSQ_SEND_2,SMSQ_SEND_3,SMSQ_SEND_4,SMSQ_SEND_5,SMSQ_SEND_6,SMSQ_SEND_7,SMSQ_SEND_8,SMSQ_SEND_9,SMSQ_SEND_10,SMSQ_SEND_11`
- 서버 `.env`: `packages/backend/.env`에 설정
- 로컬은 SMS_TABLES 미설정 → 기존 `SMSQ_SEND` 1개로 동작 (변화 없음)
- campaigns.ts 헬퍼 함수: `getNextSmsTable(tables)`, `smsCountAll(tables, ...)`, `smsAggAll(tables, ...)`, `smsSelectAll(tables, ...)`, `smsMinAll(tables, ...)`, `smsExecAll(tables, ...)`
- 모든 헬퍼에 `tables: string[]` 파라미터 → 회사별 라인그룹 테이블 기반 동작
- `getCompanySmsTables(companyId)`: 회사별 라인그룹 조회 (1분 캐시)
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
- 080 수신거부 번호: 080-719-6700
- 콜백 엔드포인트 구현 완료 (토큰 인증, curl 테스트 성공)
