# 한줄로 (Target-UP) - 프로젝트 레퍼런스

## 프로젝트 개요
- **서비스명**: 한줄로 (내부 코드명: Target-UP / 타겟업)
- **서비스**: AI 기반 SMS/LMS 마케팅 자동화 플랫폼
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
- **로고**: 디자이너 시안 대기 중 (워드마크형 방향, 화해 스타일 참고)

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
| **https://hanjul.ai** | 서비스 | 고객사 일반 사용자 | frontend (React) |
| **https://app.hanjul.ai** | 고객사 관리 | 고객사 관리자 | company-frontend (React) |
| **https://sys.hanjullo.com** | 시스템 관리 | 슈퍼관리자 (INVITO 내부) | frontend (슈퍼관리자 모드) |

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
# 또는 company-frontend 변경 시
cd packages/company-frontend && npm run build

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
| `/etc/nginx/sites-available/targetup-app` | app.hanjul.ai | company-frontend/dist |

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

## API 라우트
```
/api/auth          → routes/auth.ts (로그인, 비밀번호 변경)
/api/campaigns     → routes/campaigns.ts (캠페인 CRUD, 발송, 동기화)
/api/customers     → routes/customers.ts (고객 조회, 필터, 추출)
/api/companies     → routes/companies.ts (회사 설정, 발신번호)
/api/ai            → routes/ai.ts (타겟 추천, 메시지 생성)
/api/admin         → routes/admin.ts (슈퍼관리자 전용)
/api/results       → routes/results.ts (발송 결과/통계)
/api/upload        → routes/upload.ts (파일 업로드/매핑)
/api/unsubscribes  → routes/unsubscribes.ts (수신거부)
/api/address-books → routes/address-books.ts (주소록)
/api/test-contacts → routes/test-contacts.ts (테스트 연락처)
/api/plans         → routes/plans.ts (요금제)
/api/billing       → routes/billing.ts (정산/거래내역서)
/api/balance       → routes/balance.ts (선불 잔액 조회/이력/요약)
/api/sync          → routes/sync.ts (Sync Agent 연동 - register, heartbeat, customers, purchases, log, config, version)
/api/admin/sync    → routes/admin-sync.ts (슈퍼관리자 Sync Agent 관리)
```

★ 슈퍼관리자(sys.hanjullo.com) / 고객사관리자(app.hanjul.ai) / 서비스사용자(hanjul.ai) 접속주소 완전 분리 완료

---

## 접속 구조 상세

### 사용자 역할별 접근
| 역할 | 접속 URL | 로그인 방식 | 로그인 후 이동 |
|------|----------|-------------|----------------|
| 서비스 사용자 | hanjul.ai | company 로그인 | /dashboard |
| 고객사 관리자 | app.hanjul.ai | company-admin 로그인 | 고객사 관리 대시보드 |
| 슈퍼관리자 | sys.hanjullo.com | super_admin 로그인 | /admin |

---

## QTmsg 발송 시스템

### 로컬 개발 환경
- Agent 1개 (단일 Bind ID) → 로컬 개발/테스트용
- SMSQ_SEND 테이블 1개 사용
- 환경변수: SMS_TABLES 미설정 → 기본값 `SMSQ_SEND`

### 상용 서버: 5개 Agent 균등 발송 ✅ 운영 중
- 각 Agent별 **별도 테이블** 운영 (충돌 방지)
- 중계서버 58.227.193.58:26352 연결 완료 (bind ack 성공)
- Agent 경로: `/home/administrator/agent1~5/`
- Java 8 (OpenJDK 1.8.0_482)
- MySQL 인증: `mysql_native_password` (QTmsg JDBC 호환)
- 서버 타임존: Asia/Seoul (KST)

| Agent | Deliver ID | Report ID | 테이블 | admin_port | 로그 테이블 |
|-------|-----------|-----------|--------|------------|------------|
| 1 | targetai_m | targetai_r | SMSQ_SEND_1 | 9001 | SMSQ_SEND_1_YYYYMM |
| 2 | targetai2_m | targetai2_r | SMSQ_SEND_2 | 9002 | SMSQ_SEND_2_YYYYMM |
| 3 | targetai3_m | targetai3_r | SMSQ_SEND_3 | 9003 | SMSQ_SEND_3_YYYYMM |
| 4 | targetai4_m | targetai4_r | SMSQ_SEND_4 | 9004 | SMSQ_SEND_4_YYYYMM |
| 5 | targetai5_m | targetai5_r | SMSQ_SEND_5 | 9005 | SMSQ_SEND_5_YYYYMM |

### Agent 관리 명령어
```bash
# 개별 시작/중지
cd /home/administrator/agent1/bin && ./qtmsg.sh start
cd /home/administrator/agent1/bin && ./qtmsg.sh stop

# 전체 시작
for i in 1 2 3 4 5; do cd /home/administrator/agent$i/bin && ./qtmsg.sh start; done

# 전체 중지
pkill -f qtmsg

# 프로세스 확인
ps aux | grep qtmsg | grep -v grep | wc -l   # 5개면 정상

# 로그 확인
grep "bind ack" /home/administrator/agent*/logs/*mtdeliver.txt
```

### 백엔드 라운드로빈 분배 ✅
- 환경변수: `SMS_TABLES=SMSQ_SEND_1,SMSQ_SEND_2,SMSQ_SEND_3,SMSQ_SEND_4,SMSQ_SEND_5`
- 서버 `.env`: `packages/backend/.env`에 설정
- 로컬은 SMS_TABLES 미설정 → 기존 `SMSQ_SEND` 1개로 동작 (변화 없음)
- campaigns.ts 헬퍼 함수: `getNextSmsTable()`, `smsCountAll()`, `smsAggAll()`, `smsSelectAll()`, `smsMinAll()`, `smsExecAll()`
- INSERT → 라운드로빈 분배, SELECT/COUNT → 5개 합산, DELETE/UPDATE → 5개 모두 실행
- 기동 시 로그: `[QTmsg] SMS_TABLES: SMSQ_SEND_1, ... (5개 Agent)`

### 로그 테이블 자동 생성
- MySQL 이벤트 스케줄러: `auto_create_sms_log_tables`
- 매월 25일 자동으로 2개월 후 로그 테이블 생성 (SMSQ_SEND_1~5_YYYYMM)
- 현재 수동 생성 완료: 202602, 202603

- rsv1 상태: 1=발송대기, 2=Agent처리중, 3=서버전송완료, 4=결과수신, 5=월별처리완료
- 백엔드 캠페인 발송 시 라운드로빈으로 5개 테이블에 균등 분배
- 결과 조회 시 5개 테이블 합산 조회

### QTmsg 주요 결과 코드
| 코드 | 의미 |
|------|------|
| 6 | SMS 전송 성공 |
| 1000 | LMS/MMS 전송 성공 |
| 1800 | 카카오톡 전달 성공 |
| 7 | 비가입자/결번/서비스정지 |
| 8 | Power-off |
| 16 | 스팸 차단 |
| 100 | 발송 대기 |

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

---

## Sync Agent 연동 시스템

### 개요
- 고객사 로컬 DB → 한줄로 서버로 고객/구매 데이터 자동 동기화
- Sync Agent (.exe)를 고객사 PC에 설치 → API 키 인증으로 데이터 전송
- 기존 upload와 독립적 (source: 'sync' vs 'upload' 구분)

### API 엔드포인트 (Phase 1 ✅ 완료)
```
POST /api/sync/register    ← Agent 최초 등록 (api_key로 company_id 바인딩)
POST /api/sync/heartbeat   ← Agent 상태 보고
POST /api/sync/customers   ← 고객 데이터 벌크 UPSERT (배치 최대 1000건)
POST /api/sync/purchases   ← 구매내역 벌크 INSERT (배치 최대 1000건)
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

### 서버 배포 시 주의
1. 서버 DB에 DDL 먼저 실행 (sync_agents, sync_logs 테이블 + idx_customers_company_phone)
2. git pull
3. pm2 restart

### sync_agents (Agent 등록 정보)
| 컬럼 | 타입 |
|------|------|
| id | uuid PK |
| company_id | uuid FK |
| agent_name | varchar(100) |
| agent_version | varchar(20) |
| os_info | varchar(100) |
| db_type | varchar(20) |
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

### sync_logs (동기화 로그)
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
| started_at | timestamptz |
| completed_at | timestamptz |
| created_at | timestamptz |

---

## DB 스키마 (MySQL - QTmsg)

### smsdb.SMSQ_SEND_1~5 (SMS 발송 큐 - 5개 Agent 분배)
> 로컬: SMSQ_SEND (1개), 서버: SMSQ_SEND_1~5 (5개, 환경변수 SMS_TABLES로 분기)
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
| msg_type | varchar(10) | S=SMS, L=LMS |
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

---

### ✅ 완료된 작업

**서버 인프라**
- [x] IDC 상용서버 전체 배포 (SSH, Docker, Node.js, PostgreSQL/MySQL/Redis, Nginx, PM2)
- [x] 도메인 구매 (hanjul.ai, hanjul.co.kr, hanjullo.com, hanjullo.co.kr, hanjullo.ai)
- [x] DNS 설정 (가비아: hanjul.ai, sys.hanjullo.com, app.hanjul.ai → 58.227.193.62)
- [x] SSL 인증서 발급 (Let's Encrypt: hanjul.ai, sys.hanjullo.com, app.hanjul.ai)
- [x] Nginx 리버스 프록시 설정 (3개 도메인 → 각각 프론트엔드 + API)
- [x] Nginx client_max_body_size 50M 설정 (파일 업로드 413 에러 해결)
- [x] IP 직접 접속 차단 (SSL 없는 접속 방지)
- [x] PM2 백엔드 프로세스 관리
- [x] 상용 PostgreSQL 성능 튜닝 (shared_buffers 4GB, work_mem 64MB 등)

**도메인 분리 & 브랜딩**
- [x] 서비스명 "한줄로" 확정 (GPT/Gemini 대안 비교 완료)
- [x] hanjul.ai → 서비스 사용자 전용 (탭 없는 깔끔한 로그인)
- [x] app.hanjul.ai → 고객사 관리자 전용 (company-frontend)
- [x] sys.hanjullo.com → 슈퍼관리자 전용 (유추 어려운 URL)
- [x] 로그인 페이지 hostname 기반 조건부 렌더링
- [x] 로그인 페이지 디자인 통일 (깔끔한 스타일)
- [x] Git 소스 서버 동기화

**법률/규정**
- [x] 개인정보처리방침 작성 (PrivacyPage.tsx, /privacy)
- [x] 이용약관 작성 (TermsPage.tsx, /terms)
- [x] 푸터 사업자정보 추가 (주식회사 인비토, 사업자번호, 통신판매업 등)
- [x] 로그인 페이지 하단 + 대시보드 하단에 링크 반영

**핵심 기능 (로컬 개발 완료)**
- [x] 캠페인 CRUD + AI 타겟 추출 + 메시지 생성
- [x] QTmsg 연동 (로컬 Agent 1개)
- [x] 고객 데이터 업로드 (Excel/CSV + AI 자동 매핑)
- [x] 슈퍼관리자 대시보드
- [x] 고객사 관리자 대시보드 (company-frontend)
- [x] 정산/거래내역서 시스템
- [x] 데이터 정규화 시스템 (normalize.ts)
- [x] 자동입력변수 최대길이 기반 SMS/LMS 자동전환 바이트 계산 (getMaxByteMessage)
- [x] 정산 삭제 버튼 모든 상태에서 표시 + 백엔드 상태 제한 해제

**QTmsg 5개 Agent 서버 설치 (2026-02-10)**
- [x] QTmsg Agent 리눅스 버전 서버 설치 (Java 8 + 5개 Agent)
- [x] 5개 Agent 중계서버 연결 완료 (bind ack 성공)
- [x] MySQL 발송 테이블 5개 생성 (SMSQ_SEND_1~5)
- [x] MySQL 로그 테이블 수동 생성 (202602, 202603)
- [x] MySQL 로그 테이블 월별 자동 생성 이벤트 등록
- [x] MySQL smsuser 인증 방식 변경 (caching_sha2 → mysql_native_password)
- [x] 서버 타임존 KST 설정 (timedatectl set-timezone Asia/Seoul)
- [x] 백엔드 라운드로빈 분배 구현 (환경변수 SMS_TABLES 분기)
- [x] 로컬/서버 환경변수 분기 (로컬: SMSQ_SEND 1개, 서버: 5개)

**Sync Agent 서버 API Phase 1 (2026-02-10)**
- [x] Sync API 4개 엔드포인트 개발 (register, heartbeat, customers, purchases)
- [x] sync_agents, sync_logs 테이블 생성
- [x] customers 테이블 UPSERT용 유니크 인덱스 추가 (company_id + phone)
- [x] 테스트 계정 생성 (TEST_SYNC, api_key/api_secret)
- [x] register + customers UPSERT 로컬 테스트 완료
- [x] X-Sync-ApiKey/Secret 헤더 인증 + company 상태/use_db_sync 검증

**선불/후불 요금제 Phase 1-A (2026-02-10)**
- [x] DB 마이그레이션 (companies: billing_type/balance/deposit_account_info + balance_transactions/payments/deposit_requests 테이블)
- [x] campaigns.ts 선불 차감/환불 로직 통합 (prepaidDeduct/prepaidRefund, 8곳 적용)
- [x] balance.ts 신규 API (잔액 조회/이력/요약)
- [x] admin.ts 선불 관리 API (billing_type 전환, 수동 충전/차감, 이력, 전체 현황)
- [x] app.ts 라우트 등록 (/api/balance)
- [x] Dashboard.tsx: 잔액 표시 카드 (선불일 때만) + 402 잔액 부족 모달 (3개 발송 함수 전부)
- [x] AdminDashboard.tsx: 단가/요금 탭에 후불↔선불 전환 토글 + 선불 잔액 충전/차감 UI

**선불/후불 요금제 Phase 1-A 추가 + 서버 배포 (2026-02-10)**
- [x] Phase 1-A 로컬 테스트 완료 (선불 전환→충전→발송→차감→잔액부족 모달 확인)
- [x] Dashboard.tsx: 잔액 현황 모달 (잔액 + 유형별 단가 + 발송가능 건수)
- [x] Dashboard.tsx: 잔액 충전 모달 3단계 (카드/가상계좌 준비중 + 무통장입금 폼)
- [x] POST /api/balance/deposit-request API (무통장입금 요청 저장, 10분 중복방지)
- [x] 슈퍼관리자 충전 관리 탭 (결제수단/상태 필터, 페이지네이션, 대기 배지)
- [x] GET /api/admin/deposit-requests (목록 조회 + 필터)
- [x] PUT /api/admin/deposit-requests/:id/approve (승인 → 잔액 자동 충전 + balance_transactions 기록)
- [x] PUT /api/admin/deposit-requests/:id/reject (거절)
- [x] 승인/거절 커스텀 모달 (충전 후 잔액 미리보기, 관리자 메모, animate-in)
- [x] 서버 DB 마이그레이션 완료 (balance_transactions, payments, deposit_requests, sync_agents, sync_logs 테이블 + companies 컬럼 추가)
- [x] 서버 배포 완료 (git pull + frontend build + pm2 restart)

**Sync Agent 서버 배포 (2026-02-10)**
- [x] 서버 배포 완료 (sync_agents, sync_logs DDL + idx_customers_company_phone 인덱스)

**Sync Agent Phase 2 API + 모니터링 (2026-02-11)**
- [x] Sync API Phase 2: POST /api/sync/log, GET /api/sync/config, GET /api/sync/version
- [x] Admin Sync API 5개: agents 목록/상세, config 변경, command 전송, logs 조회
- [x] admin-sync.ts 신규 생성 + app.ts 라우트 등록
- [x] DB 마이그레이션 (sync_agents: config/sync_interval 컬럼, sync_logs: duration_ms/error_message, sync_releases 테이블)
- [x] AdminDashboard.tsx Sync 모니터링 탭 추가 (Agent 목록 테이블 + 상세/설정/명령 모달 3개)
- [x] 서버 배포 완료

**보안 강화 (2026-02-11)**
- [x] app.hanjul.ai 일반 사용자 로그인 차단 (auth.ts loginSource 체크 + company-frontend 헤더 전송)
- [x] 로그인 감사 로그 구현 (audit_logs에 login_success/login_fail/login_blocked 기록)
- [x] 로그인 IP 주소 기록 (Nginx X-Forwarded-For + Express trust proxy 설정)
- [x] audit_logs FK 제약 제거 (super_admin ID 호환)

**직원 버그 리포트 대응 (2026-02-11)**
- [x] 고객사별 최대 사용자 수 제한 (companies.max_users, 기본 5명, 슈퍼관리자 조정 가능)
- [x] 고객사 관리자 사용자 추가 시 max_users 체크 (manage-users.ts + admin.ts)
- [x] AdminDashboard 기본정보 탭에 최대 사용자 수 설정 필드 추가
- [x] 시간 표시 KST 통일 (pg types.setTypeParser + formatDateTime 유틸 전체 적용)
- [x] frontend/company-frontend 공통 formatDate.ts 유틸 생성 (toUTC + Asia/Seoul)
- [x] AdminDashboard 16곳, Dashboard 12곳, ResultsModal 7곳 등 전체 시간 포맷 수정

**로고 적용 (2026-02-11)**
- [x] AI 원본 파일에서 투명 배경 로고 추출 (pymupdf + PIL 크롭)
- [x] 로그인 페이지 로고 이미지 적용 (frontend + company-frontend, h-10)

**세션 타임아웃 구현 (2026-02-11)**
- [x] useSessionTimeout 훅 개발 (비활동 감지: mousedown/keydown/scroll/touchstart/click)
- [x] SessionTimeoutModal 컴포넌트 (원형 프로그레스 타이머, 1분 이하 긴급모드, animate-in)
- [x] auth.ts 로그인 응답에 sessionTimeoutMinutes 추가 (고객사: DB 조회, 슈퍼관리자: 60분 고정)
- [x] auth.ts POST /extend-session API 추가 (세션 연장 시 DB expires_at 갱신)
- [x] frontend App.tsx SessionTimeoutGuard 추가
- [x] company-frontend App.tsx SessionTimeoutGuard 추가
- [x] 로그인 시 localStorage에 sessionTimeoutMinutes 저장 (frontend + company-frontend)
- [x] AdminDashboard 기본정보 탭에 세션 타임아웃 설정 필드 추가 (5~480분)
- [x] admin.ts PUT /companies/:id에 session_timeout_minutes 저장 추가
- [x] 서버 배포 완료

**요금제 신청 시스템 개선 (2026-02-11)**
- [x] 중복 신청 방지: pending 상태 신청 존재 시 재신청 차단 (백엔드 409 응답 + 프론트 버튼 비활성화)
- [x] 대기 중 안내: 요금제 페이지 상단 노란 배너 + 모든 플랜 버튼 "신청 대기 중" 표시
- [x] 다운그레이드 허용: 낮은 플랜 "다운그레이드 신청" 버튼 활성화 (동일 plan_requests 흐름, 슈퍼관리자 수동 승인)
- [x] 승인/거절 결과 알림: 요금제 페이지 진입 시 미확인 결과 자동 모달 (승인→"변경 완료", 거절→"반려"+사유 표시)
- [x] 결과 확인 처리: user_confirmed 플래그로 한 번 확인하면 다시 안 뜸
- [x] DB 마이그레이션: plan_requests에 user_confirmed 컬럼 추가 (로컬/서버 완료)
- [x] 신규 API: GET /api/companies/plan-request/status, PUT /api/companies/plan-request/:id/confirm

**SMS 바이트 초과 처리 개선 (2026-02-11)**
- [x] SMS 90바이트 초과 시 잘린 메시지 미리보기 실시간 표시 (실제 수신 내용 확인 가능)
- [x] 광고 문자 + 수신거부 번호 잘림 → SMS 발송 차단 + 정보통신망법 제50조 경고 (LMS 전환만 가능)
- [x] 비광고 문자 → 잘림 경고 표시 후 SMS 유지 발송 허용 (사용자 책임)
- [x] 메시지 미리보기 바이트 수 버그 수정: 자동입력 변수 치환 후 실제 바이트 수로 표시
- [x] 미리보기 바이트 초과 시 빨간색 경고 표시

**직원 버그 리포트 대응 2차 + 발송 시스템 수정 (2026-02-12)**
- [x] 발송정책 저장 안됨: SQL 컬럼명 6개 불일치 수정 (send_hour_start→send_start_hour, daily_limit→daily_limit_per_customer 등)
- [x] 타겟전략 저장 안됨: PUT /companies/:id에 approval_required, target_strategy 파라미터 추가
- [x] 선불 충전금액 2~3번 시도 문제: setEditCompany stale closure → 함수형 업데이트로 수정
- [x] 잠금/휴면 계정 로그인 차단: auth.ts에 status='active' 체크 추가 + 상태별 안내 메시지 (잠금/휴면/비활성)
- [x] 발송내역 조회 0건: results.ts SMSQ_SEND 하드코딩 → SMS_TABLES 멀티테이블 합산 조회 (5개 Agent 대응)
- [x] 직접발송 바이트 초과 차단 누락: Dashboard.tsx 직접발송 버튼에 90바이트 초과 체크 추가 + smsOverrideAccepted 플래그
- [x] 슈퍼관리자 발송통계 0건: campaign_runs만 조회 → campaigns 직접 조회로 변경 (직접발송 포함)
- [x] 서버 로그인 500 에러: companies.session_timeout_minutes 컬럼 DDL 누락 → 서버 DB 추가

**고객사 관리자 사용자별 필터 추가 (2026-02-12)**
- [x] 예약캠페인 탭: 사용자별 필터 드롭다운 추가 (사용자 2명 이상 시 표시)
- [x] 발송통계 탭: 사용자별 필터 드롭다운 추가 (조회/상세 모두 적용)
- [x] 고객사 관리자 헤더 로고 한줄로 변경
- [x] 서버 배포 완료

**직원 버그 리포트 3차 — 회신번호 통합 + 대시보드 개선 (2026-02-12)**
- [x] AI 매핑(upload.ts)에 callback(매장번호/회신번호) 매핑 대상 추가
- [x] AI 매핑 결과 드롭다운에 '📞 회신번호(매장번호)' option 추가
- [x] 업로드 저장(upload.ts) INSERT/UPSERT에 callback 컬럼 추가
- [x] 직접발송 파일등록 컬럼 매핑 모달에 회신번호 필드 추가
- [x] 직접발송 수신자 테이블에 회신번호 열 추가
- [x] 직접발송 자동입력 버튼에 %회신번호% 추가
- [x] AI 타겟발송 자동입력 드롭다운에 %회신번호% 추가
- [x] campaigns.ts 직접발송 merge 변수 치환에 %회신번호% 추가
- [x] directVarMap/targetVarMap/activeVarMap/getMaxByteMessage 바이트 계산 반영
- [x] 헤더 로고 아래 부서명 표시 + 로고 클릭 시 새로고침
- [x] 예약 대기 카드 실시간 갱신: 발송 성공 콜백 3곳에 loadScheduledCampaigns() 추가
- [x] 서버 배포 완료

**직원 버그 리포트 3차 — 버그수정 + UI 기능 구현 (2026-02-12)**
- [x] 테스트 발송 토스트 2회 중복: 미리보기 모달 testSentResult 블록 중복 제거
- [x] 미발송 캠페인 최근 캠페인 노출: loadRecentCampaigns에서 draft 상태 필터 제외
- [x] 직접발송 하단 중복제거 버튼 제거 (상단 체크박스 중복제거로 통합)
- [x] 특수문자 입력 기능: 64개 특수문자 그리드 팝업 (AI 타겟/직접발송 양쪽)
- [x] 보관함/문자저장 기능: sms-templates.ts 신규 API + app.ts 라우트 등록
- [x] 문자저장 → 보관함 저장 / 보관함 → 목록 조회 + 적용 + 삭제
- [x] 서버 배포 완료

**고객 DB 삭제 기능 (2026-02-12)**
- [x] 백엔드 DELETE API 3개: 개별 삭제, 선택 삭제(bulk-delete), 전체 삭제(delete-all)
- [x] 권한 분리: 서비스 사용자 ❌ / 고객사 관리자 개별+선택 / 슈퍼관리자 전체 포함 전부
- [x] 연관 데이터 CASCADE 삭제 (purchases, consents)
- [x] audit_logs 감사 로그 기록 (삭제 유형, 건수, 대상 정보)
- [x] 슈퍼관리자 companyId 오버라이드 (다른 회사 고객 조회/삭제 가능)
- [x] 고객사 관리자 "고객DB" 탭 신규 (CustomersTab.tsx, 25건 페이지네이션, 체크박스 선택/삭제)
- [x] 슈퍼관리자 고객사 수정 모달 "고객DB" 탭 신규 (목록 조회 + 개별/선택/전체 삭제)
- [x] 전체 삭제: 회사명 직접 입력 확인 모달 (슈퍼관리자만)
- [x] company-frontend client.ts에 customersApi 추가 (list, deleteOne, bulkDelete)
- [x] Dashboard.tsx department 타입 에러 수정 (as any 캐스팅)
- [x] 서버 배포 완료

**MMS 이미지 첨부 기능 (2026-02-12)**
- [x] 백엔드: 이미지 업로드 API (multer, JPG만/300KB/최대 3장 규격 검증)
- [x] 백엔드: campaigns.ts MMS 발송 분기 (msg_type='M', file_name1 경로, cost_per_mms 단가)
- [x] 백엔드: 업로드 이미지 → 5개 Agent 공유 경로 저장 + mms-images.ts 서빙 엔드포인트
- [x] 프론트: MMS 업로드 모달 (3칸 슬롯, JPG/300KB 규격 안내, 미리보기/삭제)
- [x] 프론트: AI 추천발송/타겟직접추출/직접발송 3개 경로 통일 적용
- [x] 프론트: MMS 미리보기 (이미지+텍스트 통합 스크롤, 바이트 카운터 하단 고정)
- [x] 서버 배포 완료

**캘린더 · 발송결과 · 스팸필터 (2026-02-12)**
- [x] 캘린더 상태 색상 구분 (완료=초록, 예약=파랑, 진행=주황, 취소=회색 + 범례)
- [x] 발송결과 기간 필터: 월 단위 → 시작일~종료일 범위 선택 (results.ts fromDate/toDate 지원)
- [x] AI 추천발송 스팸필터 테스트 버튼 추가 (step 2 + 미리보기 모달, 현재 준비 중 토스트)

**슈퍼관리자 감사 로그 + 잔액 이력 (2026-02-12)**
- [x] 백엔드: GET /api/admin/audit-logs API (날짜/액션/고객사/사용자 필터, 10건 페이지네이션)
- [x] 프론트: 감사 로그 탭 추가 (테이블 + 필터 + 페이지네이션)
- [x] 액션 필터 한글화 + 상세 컬럼 한글 요약 (JSON → 읽기 쉬운 텍스트)
- [x] 단가/요금 탭: 선불 잔액 최근 10건 변동 이력 (충전=초록, 차감=빨강, 환불=파랑)
- [x] 고객 삭제 모달 z-index 버그 수정 (최상위 레벨 이동)
- [x] GitHub 서버 PAT 설정 (credential.helper store)
- [x] 서버 배포 완료

### 🔲 진행 예정 작업

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
- [x] "한줄로" 로고 적용 (AI 원본 → 투명배경 추출 → 로그인 페이지 3개 도메인)
- [x] 상표 출원 완료 (2026-02-10, 특허로, 문자상표 4개 류: 09/35/38/42, 출원료 262,000원)
- [ ] 파비콘/OG 이미지 적용

**기능 확장**
- [ ] 카카오톡 브랜드메시지/알림톡 연동 (단가 세분화: 브랜드메시지/알림톡 별도)
- [x] MMS 발송 기능 (2026-02-12 완료)
- [ ] PDF 승인 기능 (이메일 링크)
- [ ] Android 앱 (스팸필터 자동 테스트)
- [ ] 고객사 관리자 기능 세분화 (슈퍼관리자 기능 축소 버전)
- [ ] 추천 템플릿 8개 → 실용적 활용 예시로 개선 (직원 의견 수렴 후)
