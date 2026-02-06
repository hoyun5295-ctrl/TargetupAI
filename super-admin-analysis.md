# Target-UP 개발 현황

> 최종 업데이트: 2026-02-05 세션 19 (타겟업 17)

---

## 🚀 시작 가이드

```powershell
# 1. 도커 컨테이너
docker start targetup-postgres targetup-redis targetup-mysql

# 2. 백엔드 (터미널 1)
cd C:\projects\targetup\packages\backend && npm run dev

# 3. 프론트엔드 (터미널 2)
cd C:\projects\targetup\packages\frontend && npm run dev

# 4. QTmsg (필요시)
cd C:\projects\qtmsg\bin && .\test_in_cmd_win.bat
```


# 슈퍼관리자 기능 역산 분석

> 백엔드 전체 라우트 및 유저 기능 기반으로 역산 정리

---

## 1. 현재 백엔드 라우트 전체 목록 (app.ts 기준)

| # | 라우트 파일 | 경로 | 핵심 기능 |
|---|-----------|------|----------|
| 1 | auth.ts | /api/auth | 로그인, 슈퍼관리자 생성 |
| 2 | companies.ts | /api/companies | 회사 목록/상세, 설정 GET/PUT, 콜백번호, 플랜요청, my-plan |
| 3 | plans.ts | /api/plans | 요금제 목록 (공개) |
| 4 | customers.ts | /api/customers | 스키마 조회, 인원 카운트, 타겟 추출, 업로드 정규화 |
| 5 | campaigns.ts | /api/campaigns | 캠페인 CRUD, 즉시/예약/분할 발송, 동기화, recipients |
| 6 | ai.ts | /api/ai | AI 타겟 추출, 메시지 3안 생성 |
| 7 | results.ts | /api/v1/results | 발송 결과 조회 |
| 8 | upload.ts | /api/upload | 엑셀/CSV 파일 업로드 + AI 컬럼 매핑 |
| 9 | unsubscribes.ts | /api/unsubscribes | 수신거부 CRUD, 080 API 콜백 |
| 10 | address-books.ts | /api/address-books | 주소록 CRUD |
| 11 | admin.ts | /api/admin | 슈퍼관리자 전용 API |
| 12 | test-contacts.ts | /api/test-contacts | 담당자 사전수신 관리 |

---

## 2. 현재 admin.ts에 구현된 기능

| 카테고리 | API | 상태 |
|---------|-----|------|
| **회사** | GET /companies - 목록 조회 | ✅ |
| | POST /companies - 추가 | ✅ |
| | GET /companies/:id - 상세 | ✅ |
| | PUT /companies/:id - 수정 | ✅ |
| **사용자** | GET /users - 목록 | ✅ |
| | POST /users - 추가 | ✅ |
| | PUT /users/:id - 수정 | ✅ |
| | DELETE /users/:id - 삭제 | ✅ |
| | POST /users/:id/reset-password - 비번초기화+SMS | ✅ |
| **예약** | GET /campaigns/scheduled - 예약목록 | ✅ |
| | POST /campaigns/:id/cancel - 취소(사유) | ✅ |
| **요금제** | GET /plans - 목록 | ✅ |
| | POST /plans - 추가 | ✅ |
| | PUT /plans/:id - 수정 | ✅ |
| | DELETE /plans/:id - 삭제 | ✅ |
| **발신번호** | GET /callback-numbers - 목록 | ✅ |
| | POST /callback-numbers - 추가 | ✅ |
| | DELETE /callback-numbers/:id - 삭제 | ✅ |
| | PUT /callback-numbers/:id/default - 대표설정 | ✅ |
| **플랜신청** | GET /plan-requests - 신청목록 | ✅ |
| | PUT /plan-requests/:id/approve - 승인 | ✅ |
| | PUT /plan-requests/:id/reject - 거절 | ✅ |

---

## 3. 유저 기능에서 역산한 "아직 없는" 슈퍼관리자 기능

### 🔴 A. 회사별 고객 데이터 관리 (customer_schema 기반)

유저 쪽에서는 companies.customer_schema를 기반으로 AI 타겟추출, 직접타겟설정, 개인화 변수 치환을 합니다.
슈퍼관리자가 이걸 회사별로 설정/관리할 수 있어야 합니다.

| 기능 | 설명 | 난이도 |
|------|------|--------|
| **회사별 필터항목 설정** | 기본 7개(성별/나이/등급/지역/구매금액/최근구매/수신동의) + 추가 커스텀 필드를 체크박스로 ON/OFF | ⭐⭐ |
| **field_mappings 확인/수정** | 회사별 컬럼→표준변수 매핑 상태 확인 및 수정 | ⭐⭐ |
| **available_vars 관리** | AI가 사용할 수 있는 개인화 변수 목록 | ⭐ |
| **고객 데이터 현황** | 회사별 총 고객수, 활성/비활성, 수신동의 비율 표시 | ⭐ |

→ 메모리에도 "슈퍼어드민에서 companies별 필터항목 체크 관리" 기록되어 있음

---

### 🔴 B. 전체 캠페인 조회 + 발송 통계

유저는 자기 회사 캠페인만 볼 수 있지만, 슈퍼관리자는 전체 회사 것을 봐야 합니다.

| 기능 | 설명 | 난이도 |
|------|------|--------|
| **전체 캠페인 목록** | 모든 회사의 완료/예약/진행중 캠페인 통합 뷰 (현재 예약만 있음) | ⭐⭐ |
| **전체 발송 통계 대시보드** | 일별/월별 발송량 그래프, 회사별 발송량 순위, 성공률 | ⭐⭐⭐ |
| **회사별 발송 상세** | 특정 회사 클릭 → 해당 회사의 캠페인/발송 기록 드릴다운 | ⭐⭐ |
| **실시간 발송 모니터링** | MySQL SMSQ_SEND 대기건 현황 (status_code=100) | ⭐⭐ |

---

### 🔴 C. 회사 상세 설정 (companies 확장 컬럼 관리)

companies 테이블에 이미 아래 컬럼들이 있지만, 슈퍼관리자 UI에서 편집할 수 없음:

| 컬럼 그룹 | 컬럼명 | 현재 상태 |
|----------|--------|----------|
| **브랜드 정보** | brand_slogan, brand_description, brand_tone | DB에 있음, 어드민 UI 없음 |
| **발송 정책** | send_hour_start, send_hour_end, daily_limit, holiday_send, duplicate_check_days | DB에 있음, 어드민 UI 없음 |
| **단가 설정** | cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao | DB에 있음, 어드민 UI 없음 |
| **AI 설정** | target_strategy, excluded_segments | DB에 있음, 어드민 UI 없음 |
| **승인 설정** | approval_required | DB에 있음, 어드민 UI 없음 |
| **매장 목록** | store_code_list (JSONB) | DB에 있음, 어드민 UI 없음 |
| **담당자 연락처** | manager_contacts (JSONB) | DB에 있음, 어드민 UI 없음 |

→ 회사 수정 모달을 탭 구조로 확장하면 됨 (기본정보 / 발송정책 / 단가 / AI설정 / 매장관리)

---

### 🟡 D. 기존 기능 보완

| 기능 | 설명 | 난이도 |
|------|------|--------|
| **고객사 삭제(비활성화)** | soft delete - status를 'terminated'로 변경 | ⭐ |
| **발신번호 수정** | 라벨/번호 수정 (현재 추가/삭제만 됨) | ⭐ |
| **회사별 청구 내역** | 월별 발송량 × 단가 = 청구금액 | ⭐⭐ |

---

### 🟡 E. 모니터링 & 로그

| 기능 | 설명 | 난이도 |
|------|------|--------|
| **로그인 이력** | users.last_login_at 기반 + 별도 login_logs 테이블 | ⭐⭐ |
| **시스템 상태** | PostgreSQL/MySQL/Redis 연결 상태, 디스크 사용량 | ⭐ |
| **발송 대기 현황** | MySQL SMSQ_SEND status_code=100 건수 실시간 | ⭐ |

---

### ⚪ F. 향후 고려 (지금은 불필요)

| 기능 | 설명 |
|------|------|
| 공지사항 관리 | 사용자에게 공지 발송 |
| API 키 관리 | 회사별 외부 API 키 발급 |
| IP 접근 제한 | 사용자별 접속 IP 제한 |
| 감사 로그 | 모든 관리 작업 이력 |

---

## 4. 추천 개발 순서

### 1순위 - 당장 필요 (실제 운영에 필수)

| # | 작업 | 예상 시간 | 이유 |
|---|------|----------|------|
| 1 | 고객사 삭제(비활성화) | 15분 | 간단, 필수 |
| 2 | 발신번호 수정 | 15분 | 간단, 필수 |
| 3 | 회사 상세 설정 탭 확장 | 1시간 | 발송정책/단가/AI설정/매장 - DB에 이미 있는데 UI만 없음 |
| 4 | 회사별 필터항목 설정 | 1시간 | customer_schema 기반 체크박스 UI |

### 2순위 - 운영 편의

| # | 작업 | 예상 시간 | 이유 |
|---|------|----------|------|
| 5 | 전체 캠페인 목록 (탭 추가) | 1시간 | 모든 회사 캠페인 조회 |
| 6 | 전체 발송 통계 대시보드 | 2시간 | 일별/월별 차트 |
| 7 | 회사별 고객 데이터 현황 | 30분 | 회사 상세에 고객 통계 추가 |
| 8 | 회사별 청구 내역 | 1시간 | 발송량 × 단가 |

### 3순위 - 안정성

| # | 작업 | 예상 시간 |
|---|------|----------|
| 9 | 로그인 이력 | 1시간 |
| 10 | 시스템 상태 모니터링 | 30분 |
| 11 | 발송 대기 현황 | 30분 |


✅ 완료 (2025-02-05)
- 1순위: 회사별 필터항목 설정, 회사 상세 설정 탭 확장

🟡 2순위 (운영 편의) - 미구현
 1. 전체 캠페인 목록 (모든 회사 통합 뷰)
 2. 전체 발송 통계 대시보드 (일별/월별 차트)
 3. 회사별 고객 데이터 현황
 4. 회사별 청구 내역

🟢 3순위 (안정성)
 5. 로그인 이력
 6. 시스템 상태 모니터링
 7. 발송 대기 현황

🔵 플랫폼 기능
 8. 분할전송
 9. 주소록 관리
10. 수신거부 (080) 자동처리
11. AI 스키마 매핑
12. 성과지표 대시보드
13. IDC 서버 배포
