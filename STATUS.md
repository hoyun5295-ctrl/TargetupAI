---

## 완료된 기능 (2026-01-31 추가)

### 대시보드 UI 개선 ✅
1. **5개 기능 카드 추가** - 최근 캠페인, 추천 템플릿, 고객 인사이트, 오늘의 통계, 예약 대기
2. **왼쪽 통계 확장** - VIP 고객, 이번 달 발송, 평균 성공률 (실데이터 연결 완료)
3. **탭 버튼 숨김** - AI 프롬프트 한 방으로 끝나므로 불필요
4. **최근 활동 피드 UI** - 껍데기 추가 (더미 데이터)
5. **카드 크기 확대** - p-6, min-h-[140px]

---

## 다음 작업 (우선순위)

### 대시보드 기능 연결
- [ ] 5개 카드 클릭 → 모달 팝업 + 실제 데이터 연결
- [ ] 최근 활동 피드 → campaigns 테이블 연결

### 기존 로드맵
- [ ] SMSQ → MySQL 연동 최적화
- [ ] 성과지표 대시보드

---

## 2026-02-01 (토) - 타겟업(9)

### 완료
- 파일 업로드 캠페인 UI (2버튼 분기: DB연동/파일업로드)
- 파일 파싱 API (/api/upload/parse)
- AI 컬럼 매핑 API (/api/upload/mapping) - Claude API 연동
- 매핑 결과 팝업 UI (Step1→Step2 전환 방식)
- customers_unified 뷰 생성 (company_id, phone, name 기준 중복제거, sync 우선)
- 고객 데이터 저장 API (/api/upload/save) - source='upload'
- companies 테이블 확장 (use_db_sync, use_file_upload)
- customers 테이블 확장 (source 컬럼)

### 진행 중 (4단계 - 여기서부터 이어서)

#### 🚀 새 세션 시작 시 실행 순서

**1. 도커 컨테이너 시작:**
```powershell
docker start targetup-postgres targetup-redis
```

**2. 백엔드 시작:**
```powershell
cd C:\projects\targetup\packages\backend
npm run dev
```

**3. 프론트엔드 시작 (새 터미널):**
```powershell
cd C:\projects\targetup\packages\frontend
npm run dev
```

**4. 4단계 작업:**
- `packages/backend/src/routes/customers.ts` 파일 업로드
- 쿼리 변경: `SELECT * FROM customers` → `SELECT * FROM customers_unified`
- 테스트: 파일 업로드 → 저장 → 대시보드 반영 확인

### 핵심 정책
- 같은 회사 내 이름+전화번호 같으면 중복제거 (sync 우선)
- 이름 다르거나 없으면 둘 다 유지
- 다른 회사끼리는 절대 영향 없음 (company_id 분리)

---

## 2026-02-02 (일) - 타겟업(10)

### 완료 ✅
1. **직접발송 기능 완성**
   - QTmsg MySQL (SMSQ_SEND) 연동
   - 회신번호 선택, 메시지 유형(SMS/LMS/MMS), 광고문구 자동삽입
   - 자동입력 변수 (%이름%, %기타1~3%)
   - 수신자 테이블 (추가/삭제/중복제거/전체삭제)
   - 미리보기 모달 (폰 프레임 UI)
   - 전송하기 API (`/api/campaigns/direct-send`)

2. **토스트 알림 UI**
   - 기본 alert → 예쁜 그라데이션 토스트로 교체
   - 성공(초록)/실패(빨강) 구분

3. **발송결과 동기화**
   - 직접발송(send_type='direct') 결과 동기화 추가
   - MySQL SMSQ_SEND → PostgreSQL campaigns 연동
   - 조회 시 자동 동기화 호출

4. **발송결과 모달 개선**
   - 유형 컬럼: AI(보라)/수동(파랑) 배지로 구분
   - 전송건수 → 성공 → 실패 → 대기 순서
   - 성공률 실시간 계산
   - 통신사별 분포: 숫자코드(11,16,19) → 이름+색상 매핑 (SKT/KT/LG U+)

### 기술 메모
- QTmsg status_code: 6=SMS성공, 1000=LMS성공, 1800=카카오성공, 100=대기, 9009=발신번호규정오류
- mob_company: 11=SKT, 16=KT, 19=LG U+
- 직접발송은 campaign_runs 없이 campaigns.id로 MySQL 조회

---

## 2026-02-02 (일) - 타겟업(11~12) ⚠️ 데이터 손실 사고

### 🔴 사고 경위
1. **원래 목표**: 발송시간 UTC → 한국시간 통일 (MySQL/PostgreSQL)
   - 즉시발송 후 QTmsg가 미래 시간으로 인식 → 발송 지연 문제
2. **실수**: 백업 없이 Docker 컨테이너(PostgreSQL) 재생성
3. **결과**: PostgreSQL 전체 데이터 손실 (users, companies, customers, campaigns)
4. **복구 시간**: 3~4시간

### 🟢 시간대 통일 완료
- MySQL: `TZ=Asia/Seoul` 설정 → NOW() = 한국시간 ✅
- PostgreSQL: `TZ=Asia/Seoul`, `PGTZ=Asia/Seoul` 설정 ✅
- 백엔드: `toKoreaTimeStr()` 함수로 예약발송 시간 변환
- 즉시발송: NOW() 사용 / 예약발송: 한국시간 문자열 저장

### 🟢 복구 완료
- 스키마 복구 (schema.sql 기반)
- 테스트회사 생성 (company_code: TEST001, id: 8f649320-4384-4da6-a93f-70b419728b2e)
- 테스트 유저 생성 (login_id: test, password: 12345)
- 슈퍼관리자 생성 (login_id: admin, password: 12345)
- 40만명 고객 데이터 재생성 + 엑셀 7만명 추가 = 47만명
- customers_unified 뷰 재생성
- 누락 컬럼 대량 추가 (campaigns, companies, customers 테이블)
- 연령대별 분포 복구 (birth_year)

### 🟢 버그 수정
- 엑셀 업로드 미리보기: `row[colIdx]` → `row[fileHeaders[colIdx]]` (Dashboard.tsx 2049번줄)
- 슈퍼관리자 로그인: bcrypt 해시 수정 (PowerShell 이스케이프 문제로 SQL 파일 방식 사용)
- 슈퍼관리자 대시보드: status, plan_id 컬럼 추가
- 회신번호 테스트 데이터 추가 (02-1234-5678 대표번호, 1588-1234 고객센터)

### ⚠️ 교훈 (메모리 저장 완료)
```
1. 작업 완료 후 무조건 DB 백업 (pg_dump) + git commit
2. "재생성", "삭제", "drop" 단어 나오면 백업부터
3. 확신 없으면 Harold님께 먼저 확인
4. 백업 명령어: docker exec targetup-postgres pg_dump -U targetup targetup > backup_YYYYMMDD_HHMMSS.sql
```

### 다음 세션 TODO
```powershell
docker start targetup-postgres targetup-redis targetup-mysql
cd C:\projects\targetup\packages\backend && npm run dev
cd C:\projects\targetup\packages\frontend && npm run dev
```

**유저 화면 테스트 (우선):**
- [ ] AI 캠페인 생성 테스트
- [ ] 직접발송 테스트
- [ ] 설정 저장 테스트
- [ ] 캘린더 테스트
- [ ] 발송결과 모달 시간 표시 확인 (한국시간 정상 표시되는지)

**슈퍼관리자 (유저 완료 후):**
- [ ] 고객사 추가/수정/상태변경
- [ ] 회신번호 등록 기능
- [ ] 요금제 관리
- [ ] 전체 발송 통계

**기존 TODO:**
- [ ] 예약전송 기능 (scheduledAt 처리) - 시간대 통일 완료로 구현 가능
- [ ] 분할전송 기능 (건/분 제한)
- [ ] 특수문자/보관함/문자저장 모달
- [ ] 주소록 불러오기
- [ ] 수신거부관리 메뉴 추가
- [ ] 수신거부 기능 구현 (나래인터넷 080 API 연동)

## 2026-02-02 작업 내역

### 완료된 작업

#### UI/UX 개선
- [x] 캠페인 유형 한글화: AI(완료), AI(예약), AI(취소), 수동(완료), 수동(예약) 등
- [x] 캘린더 상태 색상 통일: 완료=금색(amber), 예약=핑크(pink), 취소=회색(gray)
- [x] 캘린더 모달에 상태 색상 가이드 추가
- [x] 최근 활동/최근 캠페인 상태 한글화 + 색상 통일
- [x] 예약 취소 시 토스트 알림 (alert → toast)

#### AI 캠페인 기능
- [x] AI 080번호 연동 (routes/ai.ts, services/ai.ts)
- [x] SMS 캠페인명 AI 자동 생성 (suggested_campaign_name)
- [x] 080번호 포맷 채널별 분리
  - SMS: `무료거부0801111111` (바이트 절약)
  - LMS/MMS: `무료수신거부 080-111-1111` (가독성)

#### 담당자 테스트 기능
- [x] 담당자 테스트 회신번호 수정 (reject_number → callback_numbers 테이블)
- [x] 발송결과 모달에 "테스트 발송" 탭 추가
- [x] 테스트 발송 통계 API 추가 (`/api/campaigns/test-stats`)
- [x] 담당자 테스트 이력 리스트 + 페이징
- [x] 테스트 조회 30초 쿨다운 추가

### 수정된 파일
- `packages/frontend/src/components/ResultsModal.tsx`
- `packages/frontend/src/pages/Dashboard.tsx`
- `packages/frontend/src/pages/CalendarPage.tsx`
- `packages/backend/src/routes/campaigns.ts`
- `packages/backend/src/routes/ai.ts`
- `packages/backend/src/services/ai.ts`

---

## 다음 작업 (우선순위)

### 1순위 - 직접발송 기능 완성
- [ ] 분할전송 기능 구현 (N건/N분 간격)

### 2순위 - 주소록 기능
- [ ] 주소록 메뉴 UI
- [ ] 주소록 CRUD API
- [ ] 직접발송에서 주소록 연동

### 3순위 - 수신거부 메뉴
- [ ] 수신거부 관리 UI
- [ ] 080 수신거부 데이터 연동
- [ ] 발송 시 수신거부 자동 필터링

### 4순위 - 테스트/품질 관리
- [ ] 담당자 테스트 버튼 쿨다운 (연타 방지)
- [ ] 스팸필터 테스트 기능 (앱 개발 후 연동)

### 5순위 - 관리자 기능
- [ ] 슈퍼관리자 전체 발송 조회
- [ ] 브랜드관리자 기능

### 6순위 - 성과/통계
- [ ] SMSQ→MySQL 성과지표 연동

---

### 기술 메모
- MySQL 테이블 컬럼: `seq` → `seqno`, `send_time` → `mobsend_time`
- Express 라우트 순서: `/test-stats`가 `/:id`보다 먼저 정의되어야 함
- 080번호 DB 저장 형식: 하이픈 없이 저장 (`0801111111`), 표시 시 포맷팅

## 세션 17 (2026-02-03) - 예약 관리 고도화

### 완료
- [x] 15분 이내 예약 변경 차단 (백엔드 + 프론트 UI)
  - cancel, reschedule, recipients/:idx DELETE 모두 적용
  - 버튼 비활성화 + "15분 이내 변경 불가" 안내 문구
- [x] 문안 수정 기능 (고급)
  - campaigns.message_template, message_subject 컬럼 추가
  - 변수 치환(%이름%, %등급%, %지역%) 포함 대량 수정
  - Bulk UPDATE (1000건씩 배치) + Redis 진행률
  - 문안수정 모달 UI (제목/내용/바이트/진행률)
- [x] 예약 캠페인 상태 자동 동기화
  - ?status=scheduled 조회 시 MySQL 대기건 확인
  - 대기건 0이면 자동으로 completed 처리
- [x] 담당자 이름 추가
  - companies.manager_contacts JSONB 컬럼 추가
  - Settings.tsx 이름+번호 입력 UI
  - 테스트 발송 시 "이름님, [테스트] 메시지" 형태
  - 결과 표시: "홍길동(010-****-1234)"
- [x] 특수문자/이모지 안내 문구
  - 직접발송 메시지창 아래 경고 추가

### 수정 파일
- packages/backend/src/routes/campaigns.ts (15분체크, 문안수정API, 상태동기화)
- packages/backend/src/routes/companies.ts (manager_contacts)
- packages/frontend/src/pages/Dashboard.tsx (UI전체)
- packages/frontend/src/pages/Settings.tsx (담당자 이름)

### DB 변경
```sql

ALTER TABLE campaigns ADD COLUMN message_template TEXT;
ALTER TABLE campaigns ADD COLUMN message_subject VARCHAR(200);
ALTER TABLE companies ADD COLUMN manager_contacts JSONB DEFAULT '[]';

### 다음 작업
- [ ] 슈퍼관리자: 사용자 계정 관리 (발급/수정/삭제)
- [ ] 슈퍼관리자: 회사 상세 수정
- [ ] 슈퍼관리자: 비밀번호 초기화
- [ ] 슈퍼관리자: 관리자에서 예약취소