# 한줄로 (Target-UP) - 프로젝트 레퍼런스

## 프로젝트 개요
- **서비스명**: 한줄로 (내부 코드명: Target-UP / 타겟업)
- **서비스**: AI 기반 SMS/LMS/MMS 마케팅 자동화 플랫폼
- **회사**: INVITO (인비토) / 대표: Harold
- **로컬 경로**: `C:\projects\targetup`
- **서버 경로**: `/home/administrator/targetup-app`
- **핵심 가치**: 자연어 입력 → AI 타겟 추출 → 메시지 자동 생성 → 실제 발송
- **구조**: 멀티 테넌트 (고객사별 독립 DB/캠페인 관리)

## 브랜딩
- **서비스명**: 한줄로
- **도메인**: hanjul.ai (메인), hanjullo.com (브랜드 보호), hanjul.co.kr, hanjullo.co.kr, hanjullo.ai
- **상표 출원**: ✅ 2026-02-10 특허로 출원 완료 (문자상표, 출원인: 유호윤)
  - 제09류 (소프트웨어): 데이터 처리용 컴퓨터 소프트웨어 등 5개 항목
  - 제35류 (광고/마케팅): 온라인 광고업, 마케팅업, 디지털 마케팅업 등 30개 항목
  - 제38류 (통신): SMS송신업, 데이터통신업, 인터넷통신업 등 17개 항목
  - 제42류 (SaaS/IT): 서비스형 소프트웨어업, 클라우드 컴퓨팅, AIaaS 등 22개 항목
  - 출원료: 262,000원 (출원료 184,000 + 지정상품 가산금 78,000)
  - 등록 예상: 14~18개월 소요
- **로고**: AI 원본에서 투명배경 추출 → 로그인 페이지 3개 도메인 적용 완료

## 핵심 원칙
- **데이터 정확성**: 대상자 수는 AI 추정이 아닌 DB 실제 쿼리 결과로 산출
- **자연어 인터페이스**: 복잡한 필터 폼 대신, 사용자가 자유롭게 설명하면 AI가 타겟 조건으로 변환
- **처음부터 제대로**: "일단 만들고 나중에 업그레이드" 없음
- **백업 필수**: 컨테이너 작업 전 pg_dump → 작업 → 복원. 작업 완료 후 pg_dump + git commit
- **UI 품질**: confirm/alert 대신 커스텀 모달(복사 기능 포함), 버튼 쿨다운, 일관된 피드백

## 방향성
- MVP → 엔터프라이즈급 마케팅 자동화 플랫폼으로 확장
- SMS/LMS → MMS, 카카오톡 등 멀티채널 확장 예정
- 고객 데이터 동기화: Sync Agent(범용 exe) + Excel/CSV 업로드(AI 자동 컬럼 매핑)
- 소스 보호: 핵심 로직 별도 서버 분리, 빌드 시 난독화, 라이선스 서버 검토
- 프로덕션 배포: IDC 서버 ✅ 완료 (HTTPS, Let's Encrypt, Nginx, PM2)

---

## 도메인 & 접속 구조 (상용 서버)

| 도메인 | 용도 | 대상 | 프론트엔드 |
|--------|------|------|------------|
| **https://hanjul.ai** | 서비스 + 고객사관리 | 일반 사용자 + 고객사 관리자 (/manage) | frontend (React) |
| **https://sys.hanjullo.com** | 시스템 관리 | 슈퍼관리자 (INVITO 내부) | frontend (슈퍼관리자 모드) |

> ※ app.hanjul.ai는 hanjul.ai /manage 라우트로 통합 완료 (2026-02-13)

- 모든 도메인 → IDC 서버 58.227.193.62
- 모든 도메인 HTTPS (Let's Encrypt 자동갱신)
- IP 직접 접속 차단 (SSL 없는 접속 방지)
- 슈퍼관리자 URL은 hanjullo.com 서브도메인으로 분리 → 유추 어려움

### 로그인 페이지 분기 (LoginPage.tsx)
- **hanjul.ai**: "한줄로 / AI 마케팅 자동화" 브랜딩, 탭 없음 (서비스 사용자 전용)
- **sys.hanjullo.com**: "Target-UP / 시스템 관리자" 브랜딩, 탭 없음 (슈퍼관리자 전용)
- hostname 기반 조건부 렌더링: `window.location.hostname === 'sys.hanjullo.com'`
- 푸터: 사업자정보 (주식회사 인비토, 대표이사 유호윤, 사업자등록번호, 통신판매신고, 주소, 문의전화)
- 개인정보처리방침 / 이용약관 링크 포함

### 사용자 역할별 접근
| 역할 | 접속 URL | 로그인 방식 | 로그인 후 이동 |
|------|----------|-------------|----------------|
| 서비스 사용자 | hanjul.ai | company 로그인 | /dashboard |
| 고객사 관리자 | hanjul.ai | company_admin 로그인 | /manage |
| 슈퍼관리자 | sys.hanjullo.com | super_admin 로그인 | /admin |

---

## 기술 스택
| 구분 | 기술 |
|------|------|
| 프론트엔드 | React + TypeScript |
| 백엔드 | Node.js / Express + JWT 인증 |
| 캠페인 DB | PostgreSQL (Docker) |
| SMS 큐 DB | MySQL (Docker) |
| 캐싱 | Redis (Docker) |
| AI | Claude API |
| SMS 발송 | QTmsg (통신사: 11=SKT, 16=KT, 19=LG U+) |
| DB 관리 | pgAdmin |
| 웹서버 | Nginx (리버스 프록시 + SSL) |
| 프로세스 관리 | PM2 |

---

## 개발 워크플로우

### 로컬 개발 (코드 수정 & 테스트)
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

### 서버 배포 (SSH 접속 후)
```bash
ssh administrator@58.227.193.62

# 1. 소스 업데이트
cd /home/administrator/targetup-app
git pull

# 2. 프론트엔드 빌드 (변경 시)
cd packages/frontend && npm run build

# 3. 백엔드 재시작 (변경 시)
pm2 restart all

# 4. 확인
pm2 status
```

### QTmsg 발송 엔진 (로컬 - 개발용)
```bash
cd C:\projects\qtmsg\bin
.\test_in_cmd_win.bat
# 이미 실행 중 에러 시: del *.pid *.lock 후 재실행
```

---

## 접속 정보

### 로컬 개발 환경
| 서비스 | Host | Port | DB/User | 비고 |
|--------|------|------|---------|------|
| PostgreSQL | localhost | 5432 | targetup / targetup | `docker exec -it targetup-postgres psql -U targetup targetup` |
| MySQL (QTmsg) | localhost | 3306 | smsdb / smsuser / sms123 | `docker exec -it targetup-mysql mysql -usmsuser -psms123 smsdb` |
| Redis | localhost | 6379 | - | |
| 프론트엔드 | localhost | 5173 | - | |
| 백엔드 API | localhost | 3000 | - | |
| pgAdmin | localhost | 5050 | - | |

### 상용 서버 (IDC)
| 서비스 | Host | Port | 비고 |
|--------|------|------|------|
| SSH | 58.227.193.62 | 22 | administrator |
| PostgreSQL | localhost | 5432 | Docker 컨테이너 (튜닝 완료) |
| MySQL (QTmsg) | localhost | 3306 | Docker 컨테이너 |
| Redis | localhost | 6379 | Docker 컨테이너 |
| Nginx | 0.0.0.0 | 80/443 | 리버스 프록시 + SSL, client_max_body_size 50M |
| 백엔드 API | localhost | 3000 | PM2 관리 |

### 상용 PostgreSQL 튜닝 (62GB RAM, 8코어)
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

### Nginx 설정 파일 (서버)
| 파일 | 도메인 | 프론트엔드 경로 |
|------|--------|----------------|
| `/etc/nginx/sites-available/targetup` | hanjul.ai | frontend/dist |
| `/etc/nginx/sites-available/targetup-company` | sys.hanjullo.com | frontend/dist |
| `/etc/nginx/sites-available/targetup-app` | app.hanjul.ai | frontend/dist (통합 완료) |

### SSL 인증서 (Let's Encrypt)
| 도메인 | 인증서 경로 | 만료일 |
|--------|------------|--------|
| hanjul.ai | /etc/letsencrypt/live/hanjul.ai/ | 2026-05-08 |
| sys.hanjullo.com | /etc/letsencrypt/live/sys.hanjullo.com/ | 2026-05-08 |
| app.hanjul.ai | /etc/letsencrypt/live/app.hanjul.ai/ | 2026-05-08 |

---

## 주요 파일 경로
```
C:\projects\targetup\  (로컬)
/home/administrator/targetup-app/  (서버)
├── packages/
│   ├── backend/
│   │   └── src/
│   │       ├── app.ts              ← 백엔드 메인
│   │       ├── routes/             ← API 라우트
│   │       └── services/           ← 비즈니스 로직
│   └── frontend/                   ← 서비스 사용자 + 고객사 관리자 + 슈퍼관리자 UI (통합)
│       └── src/
│           ├── components/         ← UI 컴포넌트
│           ├── pages/              ← 페이지 (LoginPage, ManagePage, PrivacyPage, TermsPage)
│           └── services/           ← API 호출
├── docker-compose.yml
└── STATUS.md
```

---

## API 라우트
```
/api/auth          → routes/auth.ts (로그인, 비밀번호 변경, 세션 연장)
/api/campaigns     → routes/campaigns.ts (캠페인 CRUD, 발송, 동기화)
/api/customers     → routes/customers.ts (고객 조회, 필터, 추출, 삭제)
/api/companies     → routes/companies.ts (회사 설정, 발신번호, 문의폼)
/api/ai            → routes/ai.ts (타겟 추천, 메시지 생성)
/api/admin         → routes/admin.ts (슈퍼관리자 전용)
/api/results       → routes/results.ts (발송 결과/통계)
/api/upload        → routes/upload.ts (파일 업로드/매핑)
/api/unsubscribes  → routes/unsubscribes.ts (수신거부, 080 콜백)
/api/address-books → routes/address-books.ts (주소록)
/api/test-contacts → routes/test-contacts.ts (테스트 연락처)
/api/plans         → routes/plans.ts (요금제)
/api/billing       → routes/billing.ts (정산/거래내역서, 이메일 발송)
/api/balance       → routes/balance.ts (선불 잔액 조회/이력/요약)
/api/sync          → routes/sync.ts (Sync Agent 연동 - register, heartbeat, customers, purchases, log, config, version)
/api/admin/sync    → routes/admin-sync.ts (슈퍼관리자 Sync Agent 관리)
/api/spam-filter   → routes/spam-filter.ts (스팸필터 테스트 - 발송요청, 수신리포트, 이력, 디바이스)
```

---

## QTmsg 발송 시스템

### 로컬 개발 환경
- Agent 1개 (단일 Bind ID) → 로컬 개발/테스트용
- SMSQ_SEND 테이블 1개 사용
- 환경변수: SMS_TABLES 미설정 → 기본값 `SMSQ_SEND`

### 상용 서버: 11개 Agent 라인그룹 발송 ✅ 운영 중
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

### 라인그룹 배정 구조
| 그룹 | 타입 | 테이블 | 용도 |
|------|------|--------|------|
| 대량발송(1) | bulk | SMSQ_SEND_1,2,3 | 고객사 A 전용 |
| 대량발송(2) | bulk | SMSQ_SEND_4,5,6 | 고객사 B 전용 |
| 대량발송(3) | bulk | SMSQ_SEND_7,8,9 | 고객사 C 전용 |
| 테스트발송 | test | SMSQ_SEND_10 | 테스트 전용 (격리) |
| 슈퍼관리자인증 | auth | SMSQ_SEND_11 | 2FA 인증번호 전용 |
- 고객사별 라인그룹 할당: 고객사 수정 → 기본정보 탭 → 발송 라인 드롭다운
- 미할당 고객사는 ALL_SMS_TABLES 전체 라운드로빈 폴백

### Agent 관리 명령어
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

### 백엔드 라인그룹 기반 분배 ✅
- 환경변수: `SMS_TABLES=SMSQ_SEND_1,SMSQ_SEND_2,...,SMSQ_SEND_11`
- 서버 `.env`: `packages/backend/.env`에 설정
- 로컬은 SMS_TABLES 미설정 → 기존 `SMSQ_SEND` 1개로 동작
- campaigns.ts 헬퍼: `getNextSmsTable()`, `smsCountAll()`, `smsAggAll()`, `smsSelectAll()`, `smsMinAll()`, `smsExecAll()`
- 모든 헬퍼에 `tables: string[]` 파라미터 → 회사별 라인그룹 테이블 기반 동작
- `getCompanySmsTables(companyId)`: 회사별 라인그룹 조회 (1분 캐시)
- `getTestSmsTables()`: 테스트 전용 라인 조회
- `getAuthSmsTable()`: 인증번호 전용 라인 조회

### 로그 테이블 자동 생성
- MySQL 이벤트 스케줄러: `auto_create_sms_log_tables`
- 매월 25일 자동으로 2개월 후 로그 테이블 생성 (SMSQ_SEND_1~11_YYYYMM)
- 현재 수동 생성 완료: 202602, 202603

### QTmsg 주요 참고사항
- `sendreq_time`: **반드시 MySQL NOW() 사용** (서버 UTC, JS에서 KST 넣으면 미래시간 → Agent 예약발송 대기)
- `rsv1` 상태: 1=발송대기, 2=Agent처리중, 3=서버전송완료, 4=결과수신, 5=월별처리완료
- `status_code`: 100=대기, 6=SMS성공, 1000=LMS/MMS성공, 1800=카카오성공, 7=비가입자/결번, 8=Power-off, 16=스팸차단
- Agent는 seqno 기반 폴링 → 이전 seq보다 큰 것만 처리
- Agent 강제 재시작: `./fkill.sh` → `./startup.sh`
- 담당자 테스트(campaigns.ts) INSERT 형식을 기준으로 맞출 것
- SMSQ_SEND VIEW 생성 완료 (11개 에이전트 테이블 UNION ALL, 통합 조회용)

---

## utils/normalize.ts (데이터 정규화 코어)

**역할 3가지:**
1. **값 정규화** — 어떤 형태로 들어오든 표준값으로 통일
   - 성별: 남/남자/male/man/1 → 'M' | 등급: vip/VIP고객/V → 'VIP'
   - 지역: 서울시/서울특별시/Seoul → '서울' | 전화번호: +82-10-1234-5678 → '01012345678'
   - 금액: ₩1,000원 → 1000 | 날짜: 20240101, 2024.01.01 → '2024-01-01'
2. **필드명 매핑** — `normalizeCustomerRecord()`에서 다양한 컬럼명을 표준 필드로 통일
   - raw.mobile / raw.phone_number / raw.tel → phone
   - raw.sex / raw.성별 → gender | raw.등급 / raw.membership → grade
3. **필터 빌더** — DB에 어떤 형식으로 저장돼 있든 잡아내는 SQL 조건 생성
   - `buildGenderFilter('M')` → WHERE gender = ANY(['M','m','남','남자','male'...])

**참조 파일:** ai.ts, customers.ts, campaigns.ts, upload.ts (백엔드 핵심 4개 전부)

> ⚠️ 이 유틸이 고객사별 DB 형식 차이를 흡수하는 핵심 레이어.
> standard_fields(49개) + normalize.ts + upload AI매핑 조합으로 field_mappings 별도 UI 불필요.

---

## DB 스키마 (PostgreSQL)

### address_books (주소록)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| group_name | varchar(100) |
| phone | varchar(20) |
| name | varchar(50) |
| extra1~3 | varchar(100) |
| created_at | timestamp |

### audit_logs (감사 로그)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| action | varchar(50) |
| target_type | varchar(50) |
| target_id | uuid |
| details | jsonb |
| ip_address | inet |
| user_agent | text |
| created_at | timestamptz |

### callback_numbers (발신번호)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| phone | varchar(20) |
| label | varchar(100) |
| is_default | boolean |
| store_code | varchar(50) |
| store_name | varchar(100) |
| created_at | timestamp |

### campaign_runs (캠페인 실행)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| campaign_id | uuid FK |
| run_number | integer |
| target_filter | jsonb |
| sent_count | integer |
| success_count | integer |
| fail_count | integer |
| status | varchar(20) |
| scheduled_at | timestamp |
| sent_at | timestamp |
| target_count | integer |
| message_content | text |
| message_type | varchar(20) |
| started_at | timestamp |
| completed_at | timestamp |
| created_at | timestamp |

### campaigns (캠페인)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| company_id | uuid FK |
| campaign_name | varchar(200) |
| description | text |
| user_prompt | text |
| ai_mode | boolean |
| send_type | varchar(20) — ai/manual |
| target_spec | jsonb |
| target_filter | jsonb |
| target_count | integer |
| total_target_count | integer |
| message_type | varchar(10) |
| message_content | text |
| message_template | text |
| message_subject | varchar(200) |
| subject | varchar(200) |
| callback_number | varchar(20) |
| sender_number_id | uuid FK |
| kakao_profile_id | uuid FK |
| kakao_template_id | uuid FK |
| is_ad | boolean |
| sent_count | integer |
| success_count | integer |
| fail_count | integer |
| status | varchar(20) |
| scheduled_at | timestamptz |
| sent_at | timestamptz |
| send_rate_per_minute | integer |
| analysis_start_date | date |
| analysis_end_date | date |
| event_start_date | date |
| event_end_date | date |
| excluded_phones | text[] |
| created_by | uuid FK |
| cancelled_by | uuid |
| cancelled_by_type | varchar(20) |
| cancel_reason | text |
| cancelled_at | timestamp |
| created_at | timestamptz |
| updated_at | timestamptz |

### companies (고객사)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| name | varchar(100) | |
| company_name | varchar(100) | |
| company_code | varchar(20) | |
| business_number | varchar(20) | 사업자번호 |
| business_type | varchar(50) | |
| ceo_name | varchar(50) | |
| brand_name | varchar(100) | |
| brand_slogan | varchar(200) | |
| brand_description | text | |
| brand_tone | varchar(50) | |
| contact_name | varchar(50) | |
| contact_email | varchar(100) | |
| contact_phone | varchar(20) | |
| address | text | |
| manager_phone | varchar(20) | |
| manager_contacts | jsonb | |
| opt_out_080_number | varchar(20) | 수신거부 번호 |
| reject_number | varchar(20) | |
| sender_number_preregistered | boolean | |
| status | varchar(20) | active 등 |
| plan_id | uuid FK | |
| trial_expires_at | timestamp | |
| monthly_budget | numeric(12,2) | 요금 |
| cost_per_sms | numeric(6,2) | |
| cost_per_lms | numeric(6,2) | |
| cost_per_mms | numeric(6,2) | |
| cost_per_kakao | numeric(6,2) | |
| billing_type | varchar(20) | postpaid/prepaid (기본 postpaid) |
| balance | numeric(15,2) | 선불 잔액 (기본 0) |
| deposit_account_info | text | 무통장입금 계좌 안내 |
| send_start_hour | integer | 기본 9 |
| send_end_hour | integer | 기본 21 |
| daily_limit | integer | |
| daily_limit_per_customer | integer | |
| holiday_send_allowed | boolean | |
| duplicate_prevention_days | integer | 기본 7 |
| cross_category_allowed | boolean | |
| target_strategy | varchar(50) | AI 설정 |
| excluded_segments | text | |
| approval_required | boolean | 승인 |
| approver_email | varchar(100) | |
| use_db_sync | boolean | 데이터 |
| use_file_upload | boolean | |
| data_input_method | varchar(20) | |
| db_name | varchar(100) | |
| customer_schema | jsonb | |
| enabled_fields | jsonb | |
| test_contact_mode | varchar(20) | |
| store_code_list | jsonb | |
| basic_analysis_url | varchar(400) | |
| premium_analysis_enabled | boolean | |
| premium_analysis_url | varchar(400) | |
| print_url | varchar(400) | |
| alarm_threshold | integer | |
| use_product_category_large | boolean | |
| use_product_category_medium | boolean | |
| use_product_category_small | boolean | |
| api_key | varchar(100) | |
| api_secret | varchar(100) | |
| max_users | integer | 최대 사용자 수 (기본 5) |
| session_timeout_minutes | integer | 세션 타임아웃 분 (기본 30) |
| line_group_id | uuid FK | 발송 라인그룹 |
| created_by | uuid | |
| created_at | timestamp | |
| updated_at | timestamp | |

### company_settings (고객사 설정 KV)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| setting_key | varchar(100) |
| setting_value | text |
| setting_type | varchar(20) |
| description | varchar(500) |
| created_at | timestamp |
| updated_at | timestamp |

### consents (수신 동의)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| customer_id | uuid FK |
| channel | varchar(20) |
| consent_type | varchar(20) |
| status | varchar(20) |
| consented_at | timestamptz |
| revoked_at | timestamptz |
| source | varchar(30) |
| source_detail | text |
| consent_text | text |
| proof_ref | varchar(200) |
| collected_by_user_id | uuid FK |
| created_at | timestamptz |
| updated_at | timestamptz |

### customer_field_definitions (고객 필드 정의)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| field_key | varchar(50) |
| field_label | varchar(100) |
| field_type | varchar(20) |
| field_size | integer |
| search_popup_type | varchar(30) |
| is_key | boolean |
| is_hidden | boolean |
| display_order | integer |
| created_at | timestamp |

### customers (고객)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| phone | varchar(20) |
| name | varchar(100) |
| gender | varchar(10) |
| birth_date | date |
| birth_year | integer |
| birth_month_day | varchar(10) |
| age | integer |
| email | varchar(100) |
| address | text |
| region | varchar(100) |
| grade | varchar(50) |
| points | integer |
| store_code | varchar(50) |
| store_name | varchar(100) |
| registered_store | varchar(100) |
| registered_store_number | varchar(50) |
| registration_type | varchar(50) |
| callback | varchar(20) |
| recent_purchase_date | date |
| recent_purchase_amount | numeric(15,2) |
| recent_purchase_store | varchar(100) |
| last_purchase_date | varchar(20) |
| total_purchase_amount | numeric(15,2) |
| total_purchase | numeric(12,2) |
| purchase_count | integer |
| avg_order_value | numeric |
| ltv_score | integer |
| wedding_anniversary | date |
| is_married | boolean |
| sms_opt_in | boolean |
| is_opt_out | boolean |
| is_invalid | boolean |
| is_active | boolean |
| custom_fields | jsonb |
| source | varchar(20) |
| created_at | timestamp |
| updated_at | timestamp |

### file_uploads (파일 업로드)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| original_filename | varchar(255) |
| stored_filename | varchar(255) |
| file_size | integer |
| file_type | varchar(20) |
| total_rows | integer |
| success_rows | integer |
| fail_rows | integer |
| column_mapping | jsonb |
| status | varchar(20) |
| error_message | text |
| created_at | timestamptz |
| completed_at | timestamptz |

### kakao_sender_profiles (카카오 발신 프로필)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| profile_key | varchar(100) |
| profile_name | varchar(100) |
| is_active | boolean |
| created_at | timestamp |

### kakao_templates (카카오 템플릿)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| profile_id | uuid FK |
| template_code | varchar(50) |
| template_name | varchar(100) |
| content | text |
| buttons | jsonb |
| status | varchar(20) |
| reject_reason | text |
| created_at | timestamp |
| updated_at | timestamp |
| approved_at | timestamp |

### kakao_friendtalk_images (카카오 친구톡 이미지)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| image_name | varchar(200) |
| image_url | varchar(500) |
| original_filename | varchar(200) |
| file_size | integer |
| width | integer |
| height | integer |
| status | varchar(20) |
| created_at | timestamp |
| processed_at | timestamp |

### messages (메시지) — 월별 파티션 (messages_2026_01~12)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| project_id | uuid FK |
| user_id | uuid FK |
| message_type | varchar(10) |
| recipient_phone | varchar(20) |
| recipient_name | varchar(100) |
| merge_data | jsonb |
| sender_number | varchar(20) |
| reply_number | varchar(20) |
| subject | varchar(200) |
| content | text |
| content_merged | text |
| template_id | uuid FK |
| kakao_profile_id | uuid FK |
| kakao_buttons | jsonb |
| fallback_enabled | boolean |
| fallback_message_id | uuid |
| scheduled_at | timestamp |
| send_rate_per_minute | integer |
| status | varchar(20) |
| result_code | varchar(20) |
| result_message | text |
| sent_at | timestamp |
| delivered_at | timestamp |
| charge_amount | numeric(10,2) |
| created_at | timestamp |
| updated_at | timestamp |

### mobile_dm_requests (모바일 DM 요청)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| dm_sample_id | varchar(50) |
| request_note | text |
| completed_url | varchar(500) |
| status | varchar(20) |
| created_at | timestamp |
| completed_at | timestamp |

### opt_outs (수신거부)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| opt_out_number | varchar(20) |
| phone | varchar(20) |
| source | varchar(20) |
| created_at | timestamp |

### opt_out_sync_logs (수신거부 동기화 로그)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| sync_type | varchar(20) |
| total_count | integer |
| added_count | integer |
| removed_count | integer |
| status | varchar(20) |
| error_message | text |
| started_at | timestamp |
| completed_at | timestamp |

### plans (요금제)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| plan_code | varchar(20) |
| plan_name | varchar(50) |
| max_customers | integer |
| monthly_price | numeric(12,2) |
| is_active | boolean |
| trial_days | integer |
| created_at | timestamp |

### plan_requests (요금제 변경 요청)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| requested_plan_id | uuid FK |
| message | text |
| status | varchar(20) |
| admin_note | text |
| processed_by | uuid |
| processed_at | timestamp |
| user_confirmed | boolean |
| created_at | timestamp |

### products (상품)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| product_code | varchar(50) |
| product_name | varchar(200) |
| category_large | varchar(100) |
| category_medium | varchar(100) |
| category_small | varchar(100) |
| price | numeric(15,2) |
| is_active | boolean |
| created_at | timestamp |
| updated_at | timestamp |

### projects (프로젝트)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| project_name | varchar(200) |
| analysis_start_date | date |
| analysis_end_date | date |
| total_count | integer |
| success_count | integer |
| fail_count | integer |
| created_at | timestamp |
| updated_at | timestamp |

### purchases (구매내역)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| customer_id | uuid FK |
| customer_phone | varchar(20) |
| purchase_date | timestamp |
| store_code | varchar(50) |
| store_name | varchar(100) |
| product_id | uuid FK |
| product_code | varchar(50) |
| product_name | varchar(200) |
| quantity | integer |
| unit_price | numeric(15,2) |
| total_amount | numeric(15,2) |
| custom_fields | jsonb |
| created_at | timestamp |

### rcs_templates (RCS 템플릿)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| brand_id | varchar(100) |
| brand_name | varchar(100) |
| template_id | varchar(100) |
| template_name | varchar(100) |
| message_type | varchar(20) |
| content | text |
| media_url | varchar(500) |
| buttons | jsonb |
| status | varchar(20) |
| reject_reason | text |
| created_at | timestamp |
| updated_at | timestamp |
| approved_at | timestamp |

### sender_numbers (발신번호 관리)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| phone_number | varchar(20) |
| description | varchar(200) |
| is_verified | boolean |
| is_active | boolean |
| created_at | timestamp |

### sender_number_documents (발신번호 인증서류)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| sender_number_id | uuid FK |
| document_type | varchar(50) |
| file_name | varchar(200) |
| file_path | varchar(500) |
| file_size | integer |
| status | varchar(20) |
| reject_reason | text |
| verified_at | timestamp |
| verified_by | uuid FK |
| created_at | timestamp |
| expires_at | timestamp |

### sms_templates (SMS 템플릿)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| template_name | varchar(100) |
| message_type | varchar(10) |
| subject | varchar(200) |
| content | text |
| created_at | timestamp |
| updated_at | timestamp |

### sms_line_groups (발송 라인그룹)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| group_name | varchar(50) | 그룹명 (대량발송(1) 등) |
| group_type | varchar(20) | bulk/test/auth |
| sms_tables | text[] | 할당된 테이블 목록 |
| is_active | boolean | 활성 여부 |
| sort_order | integer | 정렬 순서 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### spam_filter_tests (스팸필터 테스트)
| 컬럼 | 타입 |
|------|------|
| (spam_filter_tests, spam_filter_test_results, spam_filter_devices 테이블) |

### standard_fields (표준 필드 정의)
| 컬럼 | 타입 |
|------|------|
| id | integer PK |
| field_key | varchar(50) |
| display_name | varchar(50) |
| category | varchar(20) |
| data_type | varchar(10) |
| description | text |
| sort_order | integer |
| is_active | boolean |
| created_at | timestamptz |

### super_admins (슈퍼 관리자)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| login_id | varchar(50) |
| password_hash | varchar(255) |
| name | varchar(100) |
| email | varchar(100) |
| role | varchar(20) |
| is_active | boolean |
| created_at | timestamp |
| last_login_at | timestamp |

### test_contacts (테스트 연락처)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| user_id | uuid FK |
| name | varchar(100) |
| phone | varchar(20) |
| created_at | timestamp |

### transmission_certifications (전송 인증)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| certification_number | varchar(100) |
| certification_type | varchar(50) |
| issued_by | varchar(100) |
| issued_at | date |
| expires_at | date |
| certificate_file_path | varchar(500) |
| is_active | boolean |
| created_at | timestamp |

### unsubscribes (수신거부)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| phone | varchar(20) |
| source | varchar(20) |
| created_at | timestamp |

### user_alarm_phones (사용자 알림 전화번호)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| phone | varchar(20) |
| is_active | boolean |
| created_at | timestamp |

### user_sender_profiles (사용자-카카오 프로필 매핑)
| 컬럼 | 타입 |
|------|------|
| user_id | uuid FK |
| profile_id | uuid FK |
| created_at | timestamp |

### user_sessions (사용자 세션)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| user_id | uuid FK |
| session_token | varchar(500) |
| ip_address | varchar(50) |
| user_agent | text |
| device_type | varchar(20) |
| is_active | boolean |
| created_at | timestamp |
| last_activity_at | timestamp |
| expires_at | timestamp |

### users (사용자)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| login_id | varchar(50) |
| password_hash | varchar(255) |
| user_type | varchar(20) |
| role | varchar(20) |
| name | varchar(100) |
| email | varchar(100) |
| phone | varchar(20) |
| department | varchar(100) |
| status | varchar(20) |
| is_active | boolean |
| must_change_password | boolean |
| password_changed_at | timestamp |
| created_at | timestamp |
| updated_at | timestamp |
| last_login_at | timestamp |

### billing_invoices (거래내역서/정산)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| store_code | varchar(50) | 브랜드별 정산 시 매장코드 |
| store_name | varchar(100) | 브랜드별 정산 시 매장명 |
| billing_start | date | 정산 시작일 |
| billing_end | date | 정산 종료일 |
| invoice_type | varchar(20) | combined=통합, brand=브랜드별 |
| sms_success_count | integer | SMS 성공 수량 |
| sms_unit_price | numeric(6,2) | SMS 단가 |
| lms_success_count | integer | LMS 성공 수량 |
| lms_unit_price | numeric(6,2) | LMS 단가 |
| mms_success_count | integer | MMS 성공 수량 |
| mms_unit_price | numeric(6,2) | MMS 단가 |
| kakao_success_count | integer | 카카오 성공 수량 |
| kakao_unit_price | numeric(6,2) | 카카오 단가 |
| test_sms_count | integer | 테스트 SMS 수량 |
| test_sms_unit_price | numeric(6,2) | 테스트 SMS 단가 |
| test_lms_count | integer | 테스트 LMS 수량 |
| test_lms_unit_price | numeric(6,2) | 테스트 LMS 단가 |
| spam_filter_count | integer | 스팸필터 테스트 수량 |
| spam_filter_unit_price | numeric(6,2) | 스팸필터 단가 |
| subtotal | numeric(12,2) | 공급가액 |
| vat | numeric(12,2) | 부가세 |
| total_amount | numeric(12,2) | 합계 |
| status | varchar(20) | draft/confirmed/paid |
| pdf_path | varchar(500) | 생성된 PDF 경로 |
| email_sent_at | timestamptz | 메일 발송 시각 |
| notes | text | 비고 |
| created_by | uuid | 생성자 |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### balance_transactions (잔액 변동 이력)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| type | varchar(20) | charge/deduct/refund/admin_charge/admin_deduct/deposit_charge |
| amount | numeric(15,2) | 변동 금액 |
| balance_after | numeric(15,2) | 변동 후 잔액 |
| description | text | 설명/사유 |
| reference_type | varchar(30) | campaign/payment/admin 등 |
| reference_id | uuid | 연관 ID |
| payment_method | varchar(20) | admin/bank_transfer/card/virtual_account/system |
| admin_id | uuid | 관리자 수동 조정 시 |
| created_at | timestamptz | |

### payments (PG 결제 내역)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| payment_method | varchar(20) | card/virtual_account/transfer |
| pg_provider | varchar(20) | tosspayments |
| pg_payment_key | varchar(200) | PG 결제 키 |
| pg_order_id | varchar(100) | 주문 ID |
| amount | numeric(15,2) | 결제 금액 |
| status | varchar(20) | pending/completed/failed/cancelled |
| paid_at | timestamptz | |
| cancelled_at | timestamptz | |
| pg_response | jsonb | PG 응답 원본 |
| created_at | timestamptz | |

### deposit_requests (무통장입금 요청)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | uuid PK | |
| company_id | uuid FK | 고객사 |
| amount | numeric(15,2) | 요청 금액 |
| depositor_name | varchar(50) | 입금자명 |
| status | varchar(20) | pending/confirmed/rejected |
| confirmed_by | uuid | 승인 관리자 |
| confirmed_at | timestamptz | |
| admin_note | text | 관리자 메모 |
| created_at | timestamptz | |

---

## DB 스키마 (MySQL - QTmsg)

### smsdb.SMSQ_SEND_1~11 (SMS 발송 큐 - 11개 Agent 라인그룹 분배)
> 로컬: SMSQ_SEND (1개), 서버: SMSQ_SEND_1~11 (11개, 환경변수 SMS_TABLES + 라인그룹으로 분기)
| 컬럼 | 타입 | 설명 |
|------|------|------|
| seqno | int PK AUTO_INCREMENT | |
| dest_no | varchar(20) | 수신번호 |
| call_back | varchar(20) | 발신번호 |
| msg_contents | mediumtext | 메시지 내용 |
| msg_instm | datetime | 입력 시간 |
| sendreq_time | datetime | 발송 요청 시간 |
| mobsend_time | datetime | 발송 완료 시간 |
| repmsg_recvtm | datetime | 결과 수신 시간 |
| status_code | int | 100=대기, 200+=결과 |
| mob_company | varchar(10) | 11=SKT, 16=KT, 19=LGU+ |
| title_str | varchar(200) | LMS 제목 |
| msg_type | varchar(10) | S=SMS, L=LMS, M=MMS |
| rsv1 | varchar(10) | 기본 '1' |
| sender_code | varchar(9) | |
| bill_id | varchar(40) | |
| file_name1~5 | varchar(120) | MMS 첨부 |
| k_template_code | varchar(30) | 카카오 템플릿 |
| k_next_type | varchar(1) | N=없음 |
| k_next_contents | text | |
| k_button_json | varchar(1024) | |
| k_etc_json | varchar(1024) | |
| k_oriseq | varchar(20) | |
| k_resyes | varchar(1) | |
| app_etc1 | varchar(50) | campaign_run_id 저장 |
| app_etc2 | varchar(50) | |

### sync_logs (Sync Agent 동기화 로그)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| agent_id | uuid FK |
| company_id | uuid FK |
| sync_type | varchar(20) — customers/purchases |
| mode | varchar(20) — full/incremental |
| batch_index | integer |
| total_batches | integer |
| total_count | integer |
| success_count | integer |
| fail_count | integer |
| failures | jsonb |
| duration_ms | integer |
| error_message | text |
| started_at | timestamptz |
| completed_at | timestamptz |
| created_at | timestamptz |

---

## Sync Agent 연동 시스템

### 개요
- 고객사 로컬 DB → 한줄로 서버로 고객/구매 데이터 자동 동기화
- Sync Agent (.exe)를 고객사 PC에 설치 → API 키 인증으로 데이터 전송
- 기존 upload와 독립적 (source: 'sync' vs 'upload' 구분)

### API 엔드포인트 (Phase 1~2 ✅ 완료)
```
POST /api/sync/register    ← Agent 최초 등록 (api_key로 company_id 바인딩)
POST /api/sync/heartbeat   ← Agent 상태 보고
POST /api/sync/customers   ← 고객 데이터 벌크 UPSERT (배치 최대 1000건)
POST /api/sync/purchases   ← 구매내역 벌크 INSERT (배치 최대 1000건)
POST /api/sync/log         ← 동기화 로그 기록
GET  /api/sync/config      ← Agent 설정 조회
GET  /api/sync/version     ← 최신 버전 정보
```

### 인증 방식
- 헤더: `X-Sync-ApiKey` + `X-Sync-Secret`
- companies 테이블의 api_key/api_secret으로 인증
- company.status = 'active' && use_db_sync = true 검증

### UPSERT 규칙 (customers)
- UNIQUE KEY: company_id + phone (idx_customers_company_phone)
- sms_opt_in, is_opt_out → 기존 한줄로 값 유지 (덮어쓰지 않음)
- 나머지 필드 → Agent 값으로 덮어쓰기 (COALESCE 처리)
- source = 'sync' 태깅

### 테스트 계정
- 회사: 테스트고객사_싱크 (company_code: TEST_SYNC)
- company_id: `081000cc-ea67-4977-836c-713ace42e913`
- api_key: `test-sync-api-key-001` / api_secret: `test-sync-api-secret-001`
- agent_id: `63864d32-91ea-4daf-99bb-74f6642fc81e`

### sync_agents (Agent 등록 정보)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| agent_name | varchar(100) |
| agent_version | varchar(20) |
| os_info | varchar(100) |
| db_type | varchar(20) |
| config | jsonb |
| sync_interval | integer |
| status | varchar(20) — active/inactive/error |
| last_heartbeat_at | timestamptz |
| last_sync_at | timestamptz |
| total_customers_synced | integer |
| total_purchases_synced | integer |
| queued_items | integer |
| uptime | integer |
| ip_address | varchar(50) |
| created_at | timestamptz |
| updated_at | timestamptz |

---

## 선불/후불 요금제 시스템

### 개요
- **후불(postpaid)**: 기본값. 제한 없이 발송, 월말 정산 (기존 방식)
- **선불(prepaid)**: 잔액 충전 후 사용, 발송 시 atomic 차감, 실패 시 환불

### 단가 체계
- companies.cost_per_sms/lms/mms/kakao → **VAT 포함 금액** 저장
- 프론트엔드: 단가 × 건수로 표시
- PDF 거래내역서만: 총액 ÷ 1.1로 공급가액/부가세 분리

### 발송 시 차감 흐름 (campaigns.ts)
1. `prepaidDeduct()` → billing_type 확인 → postpaid면 즉시 pass
2. 필요금액 = 건수 × VAT포함단가
3. Atomic 차감: `UPDATE companies SET balance = balance - $1 WHERE balance >= $1`
4. 성공 → balance_transactions 기록 / 실패 → 402 응답 (insufficientBalance)
5. 발송 결과 sync 시 실패 건수 → `prepaidRefund()` 환불 (중복 방지 내장)

### 통합 포인트 (8곳)
- POST /test-send: 테스트 발송 전 잔액 체크
- POST /:id/send: AI 캠페인 발송 전 차감
- POST /direct-send: 직접발송 전 차감
- POST /sync-results: 결과 동기화 시 실패분 환불 (campaign_runs/direct 모두)
- POST /:id/cancel: 예약 취소 시 대기 건수 전액 환불
- GET /: 목록 조회 시 완료 캠페인 자동 환불 체크

### 슈퍼관리자 API
- PATCH /api/admin/companies/:id/billing-type → 후불↔선불 전환
- POST /api/admin/companies/:id/balance-adjust → 수동 충전/차감 (사유 필수)
- GET /api/admin/companies/:id/balance-transactions → 회사별 이력
- GET /api/admin/balance-overview → 전체 선불 고객사 잔액 현황

### 서비스 사용자 API
- GET /api/balance → 잔액 + billing_type + 단가 조회
- GET /api/balance/transactions → 변동 이력 (페이지네이션, 타입/날짜 필터)
- GET /api/balance/summary → 월별 충전/차감/환불 요약

### 요금제 정책
- 스타터 15만 (DB 10만, AI 제외, 스팸필터테스트만)
- 베이직 35만 (DB 30만, AI 무제한)
- 프로 100만 (DB 100만, AI 마케팅분석 기본, API/카카오톡 연동)
- 비즈니스 300만 (DB 300만, AI 마케팅분석 고급, DB 실시간동기화, 전담매니저, SLA)
- 엔터프라이즈 550만 (DB 무제한, 온프레미스, 커스텀, 24/7)

---

## ✅ 완료된 작업 (날짜순)

### 서버 인프라
- [x] IDC 상용서버 전체 배포 (SSH, Docker, Node.js, PostgreSQL/MySQL/Redis, Nginx, PM2)
- [x] 도메인 구매 (hanjul.ai, hanjul.co.kr, hanjullo.com, hanjullo.co.kr, hanjullo.ai)
- [x] DNS + SSL + Nginx 리버스 프록시 설정 완료
- [x] IP 직접 접속 차단, PM2 프로세스 관리
- [x] 상용 PostgreSQL 성능 튜닝 완료

### 도메인 분리 & 브랜딩
- [x] 서비스명 "한줄로" 확정
- [x] 3개 도메인 분리 (hanjul.ai / app.hanjul.ai / sys.hanjullo.com)
- [x] company-frontend → frontend 통합 완료 (2026-02-13, /manage 라우트)
- [x] 로그인 페이지 hostname 기반 조건부 렌더링
- [x] "한줄로" 로고 적용 완료 (투명배경 추출 → 3개 도메인)
- [x] 상표 출원 완료 (2026-02-10)

### 법률/규정
- [x] 개인정보처리방침, 이용약관 작성
- [x] 푸터 사업자정보 추가 (로그인 + 대시보드)

### 핵심 기능
- [x] 캠페인 CRUD + AI 타겟 추출 + 메시지 생성
- [x] QTmsg 연동 (11개 Agent 라인그룹 분배)
- [x] 고객 데이터 업로드 (Excel/CSV + AI 자동 매핑)
- [x] 슈퍼관리자 / 고객사 관리자 / 서비스 사용자 대시보드
- [x] 정산/거래내역서 시스템 (PDF 다운로드 + 이메일 발송)
- [x] 데이터 정규화 시스템 (normalize.ts)
- [x] 자동입력변수 최대길이 기반 SMS/LMS 자동전환 바이트 계산
- [x] MMS 이미지 첨부 기능 (JPG/300KB/최대 3장, 3개 발송 경로 통합)
- [x] 선불/후불 요금제 Phase 1-A (차감/환불/충전/무통장입금)
- [x] 고객 DB 삭제 기능 (권한 분리, CASCADE, 감사 로그)
- [x] 보관함/문자저장 기능 (sms-templates)
- [x] 특수문자 입력 기능 (64개 그리드 팝업)
- [x] 세션 타임아웃 구현 (비활동 감지, 원형 프로그레스 타이머)
- [x] 요금제 신청 시스템 (중복 방지, 다운그레이드, 승인/거절 알림)
- [x] 캘린더 상태 색상 구분 + 읽기전용
- [x] 발송결과 기간 필터 (시작일~종료일 범위)
- [x] 문의폼 모달 + SMTP 메일 발송 (하이웍스)

### QTmsg Agent (2026-02-10 ~ 02-12)
- [x] 11개 Agent 서버 설치 + 중계서버 연결 완료
- [x] MySQL 11개 발송 테이블 + 로그 테이블 + 월별 자동 생성 이벤트
- [x] 백엔드 라인그룹 기반 분배 구현
- [x] 라인그룹 CRUD API + 고객사별 할당 UI

### Sync Agent (2026-02-10 ~ 02-11)
- [x] Phase 1: 서버 API 4개 + DB 테이블 + 테스트
- [x] Phase 2: log/config/version API + Admin 모니터링 탭

### 보안 강화 (2026-02-11)
- [x] app.hanjul.ai 일반 사용자 로그인 차단
- [x] 로그인 감사 로그 (audit_logs)
- [x] 로그인 IP 주소 기록 (X-Forwarded-For)
- [x] 잠금/휴면 계정 로그인 차단 + 상태별 안내

### 직원 버그 리포트 대응 (1~5차, 2026-02-11 ~ 02-13)
- [x] 1차: max_users 제한, KST 시간 통일, 로고 적용
- [x] 2차: 발송정책 저장, 선불 충전, 발송내역 멀티테이블, 바이트 초과 차단
- [x] 3차: 회신번호 통합 매핑, 보관함, 특수문자, 테스트 토스트 중복 등
- [x] 4차: 통계 KST, 취소 제외, 사용자 필터, 캘린더, AI 시간 보정
- [x] 5차: 개별회신번호 매칭, 예약대기 검색/삭제, 접속 차단, 머지 미리보기, 엑셀 카운트, AI 문안, MMS 초기화, 광고 토글, 통계 취소 제외, 상태전환

### 스팸필터 테스트 시스템 (2026-02-13)
- [x] DB + 백엔드 + 프론트 완료
- [x] Android 앱 "스팸한줄" 개발 (Kotlin, APK 빌드)
- [x] 디바이스 등록 + LGU+ SMS 수신 성공 확인

### 추가 개선 (2026-02-13)
- [x] AI 캠페인확정 모달 분리 (AiCampaignSendModal.tsx)
- [x] AI 메시지 선택 인덱스 수정 (selectedAiMsgIdx)
- [x] 매핑 모달 컴팩트 축소 (노트북 대응)
- [x] 예약대기 수신자 목록 성능 최적화 (서버사이드 페이징 50건)
- [x] 충전 관리 통합 뷰 (대기건 카드 + 통합 이력 테이블)
- [x] 080 수신거부 콜백 연동 (토큰 인증, 고객사 매칭)
- [x] 소스맵 비활성화 (frontend)
- [x] manage-stats.ts SMSQ_SEND dotenv 타이밍 수정

### 추가 개선 (2026-02-13 오후)
- [x] #9-B AI 광고문구 생성 금지 (ai.ts 프롬프트 전면 수정, 생성 후 자동 strip 안전장치)
- [x] AI 혜택 날조 금지 프롬프트 강화 (사용자 미언급 할인율/적립금/사은품 생성 차단)
- [x] 광고표기 프론트 처리 통일 (SMS: (광고)바로붙임, LMS: (광고) 스페이스하나)
- [x] AI 추천 메시지 인라인 편집 기능 (선택 카드 ✏️수정→textarea→수정완료, 바이트 실시간 반영)
- [x] #11 특수문자 팝업 컬러 이모지 제거 (64→56개, SMS 발송 불가 문자 13개 제거)
- [x] 폴백 메시지 광고문구 제거 (getFallbackVariants)

---

## 🔴 미해결 버그 / 즉시 처리 필요

현재 없음

---

## 🔍 확인 후 결정

**중복 접속 정책** — 허용할지 차단할지 정책 결정 필요

---

## 🔲 진행 예정 작업

**080 수신거부 (나래인터넷 연동 잔여)**
- [ ] 나래인터넷에 콜백 URL + 토큰 키값 전달
- [ ] 나래에 확인: 콜백 실패 재시도 정책, 수신거부 목록 조회 API 여부
- [ ] Nginx 080callback 경로 나래 IP 화이트리스트 (121.156.104.161~165, 183.98.207.13)
- [ ] 실제 080 ARS 수신거부 테스트 (080-719-6700)

**선불 요금제 Phase 1-B~2**
- [ ] Phase 1-B: 토스페이먼츠 PG 연동 (카드결제/가상계좌 충전)
- [ ] Phase 2: 입금감지 API 자동화

**Sync Agent (고객사 DB 동기화)**
- [ ] Sync Agent 코어 완성 (로컬 큐, 스케줄러, Heartbeat 남음)

**보안**
- [ ] 슈퍼관리자 IP 화이트리스트 설정
- [ ] www.hanjul.ai SSL 인증서 추가 (DNS 전파 후)
- [ ] VPN 접근 제한 검토

**브랜딩**
- [ ] 파비콘/OG 이미지 적용

**기능 확장**
- [ ] 카카오톡 브랜드메시지/알림톡 연동
- [ ] PDF 승인 기능 (이메일 링크)
- [ ] 테스트폰 3대 설치 (현재 LGU+ 1대만, SKT/KT 추가 필요)
- [ ] 고객사 관리자 기능 세분화

**별도 프로젝트 (고객사 온보딩 시점)**
- [ ] 발신번호 관리 체계 (본인인증, 사업자등록증, 위임장)
- [ ] 회신번호 권한 분리 (company_admin/user 구조 적용)
- [ ] 시간 선택 UX 개선 — 드래그/타임피커 (후순위)

**직원 피드백 — 미구현**
- [ ] #13 직접 타겟 발송에 AI 문구 생성 추가 (베이직 이상)
