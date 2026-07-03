# 한줄로 — 시스템 아키텍처 (ARCHITECTURE)
> 이 문서가 시스템 구조의 유일한 소유 문서다. 타 문서에는 링크만 존재한다.
> 원본: STATUS.md §6·§7 — 2026-07-03 관제탑 재설계 v2로 원문 그대로 이관. CT 상세는 lessons/LESSONS_ARCHITECTURE.md.

## 6) 🏗️ 시스템 아키텍처

### 6-1. 3-Tier 도메인 구조
| 도메인 | 역할 | 사용자 |
|--------|------|--------|
| hanjul.ai | 서비스 사용자 대시보드 | 마케터/직원 |
| app.hanjul.ai | 회사 관리자 대시보드 | 고객사 관리자 |
| sys.hanjullo.com | 슈퍼관리자 시스템 | INVITO 내부 |

### 6-2. 핵심 인프라
- **발송 엔진:** QTmsg Agent 11개 (SKT 6 / KT 4 / LGU+ 1) → MySQL 큐 관리
- **DB:** PostgreSQL (메타데이터) + MySQL (SMS 큐)
- **배포:** Docker + PM2 + Nginx
- **AI:** Claude API (primary) + GPT API (fallback)

---

## 7) 💡 핵심 아키텍처 참조

### 7-1. 데이터 정규화 (utils/normalize.ts + utils/standard-field-map.ts)

고객사별 DB 형식 차이를 흡수하는 핵심 레이어.

**아키텍처 (D39 확정 — 필수17 + 커스텀15):**
1. **standard-field-map.ts** — 유일한 매핑 정의 (field_key ↔ customers 컬럼/custom_fields 위치 ↔ 카테고리 ↔ normalize 함수)
2. **normalize.ts** — 값 변환 함수 (다양한 입력 → 표준값)
3. **customer_field_definitions** — 고객사별 커스텀 필드 라벨 정의

**필수 직접 컬럼 17개:** name, phone, gender, age, birth_date, email, address, recent_purchase_store, store_code, registration_type, registered_store, store_phone(DDL신규), recent_purchase_amount, total_purchase_amount, grade, points, sms_opt_in
**커스텀 슬롯 15개:** custom_1 ~ custom_15 (custom_fields JSONB)

**절대 원칙:** SCHEMA.md에 정의된 컬럼명/타입만 사용. 하드코딩 매핑 금지. FIELD-INTEGRATION.md가 기준 문서.

참조 파일: ai.ts, customers.ts, campaigns.ts, upload.ts, sync.ts

### 7-1b. 발송 결과값 매핑 (utils/sms-result-map.ts) — D43-7 신규

QTmsg status_code, 통신사 코드, 스팸필터 판정 결과를 한 곳에서 정의하는 컨트롤타워.

**구조 (3파트):**
1. **STATUS_CODE_MAP** — QTmsg status_code → 라벨/타입 (성공: 6/1000/1800, 대기: 100/104, 실패: 7/8/16/55/2008 등)
2. **CARRIER_MAP** — mob_company → 통신사명 (11→SKT, 16→KT, 19→LG U+ 등)
3. **SPAM_RESULT** — 스팸필터 판정 상수 (PASS/BLOCKED/FAILED/TIMEOUT)

**헬퍼 함수:** isSuccess(), isFail(), isPending(), getStatusLabel(), getCarrierLabel(), getSpamResultLabel(), getSpamResultType()
**SQL용 상수:** SUCCESS_CODES_SQL, PENDING_CODES_SQL (IN 절 문자열)

**참조 파일 (전환 완료):** campaigns.ts, results.ts, spam-filter.ts, admin.ts, billing.ts (백엔드 6파일) / ResultsModal.tsx, AdminDashboard.tsx (프론트 2파일)

**절대 원칙:** 새로운 status_code 추가/변경 시 sms-result-map.ts만 수정. 개별 파일에 하드코딩 금지.

**역할 3가지:**
1. **값 정규화** — 어떤 형태로 들어오든 표준값으로 통일
   - 성별: 남/남자/male/man/1 → 'M' | 등급: vip/VIP고객/V → 'VIP'
   - 전화번호: +82-10-1234-5678 → '01012345678'
   - 금액: ₩1,000원 → 1000 | 날짜: 20240101, 2024.01.01 → '2024-01-01'
2. **필드명 매핑** — `normalizeCustomerRecord()`에서 다양한 컬럼명을 표준 필드로 통일
   - raw.mobile / raw.phone_number / raw.tel → phone
   - raw.sex / raw.성별 → gender | raw.등급 / raw.membership → grade
3. **AI 동적 구성** — 고객사가 올린 데이터 기반으로 사용 가능한 변수 목록 생성 → AI 프롬프트에 주입

> **주의:** opt_in_sms(field_key) ↔ sms_opt_in(customers 컬럼) 등 이름 불일치는 standard-field-map.ts에서 처리. 컬럼명 변경 금지.

### 7-2. 선불/후불 요금제 시스템

**개요:**
- **후불(postpaid)**: 기본값. 제한 없이 발송, 월말 정산 (기존 방식)
- **선불(prepaid)**: 잔액 충전 후 사용, 발송 시 atomic 차감, 실패 시 환불

**단가 체계:**
- companies.cost_per_sms/lms/mms/kakao → **VAT 포함 금액** 저장
- 프론트엔드: 단가 × 건수로 표시
- PDF 거래내역서만: 총액 ÷ 1.1로 공급가액/부가세 분리

**발송 시 차감 흐름 (campaigns.ts):**
1. `prepaidDeduct()` → billing_type 확인 → postpaid면 즉시 pass
2. 필요금액 = 건수 × VAT포함단가
3. Atomic 차감: `UPDATE companies SET balance = balance - $1 WHERE balance >= $1`
4. 성공 → balance_transactions 기록 / 실패 → 402 응답 (insufficientBalance)
5. 발송 결과 sync 시 실패 건수 → `prepaidRefund()` 환불 (중복 방지 내장)

**통합 포인트 (8곳):**
- POST /test-send: 테스트 발송 전 잔액 체크
- POST /:id/send: AI 캠페인 발송 전 차감
- POST /direct-send: 직접발송 전 차감
- POST /sync-results: 결과 동기화 시 실패분 환불 (campaign_runs/direct 모두)
- POST /:id/cancel: 예약 취소 시 대기 건수 전액 환불
- GET /: 목록 조회 시 완료 캠페인 자동 환불 체크

**슈퍼관리자 API:**
- PATCH /api/admin/companies/:id/billing-type → 후불↔선불 전환
- POST /api/admin/companies/:id/balance-adjust → 수동 충전/차감 (사유 필수)
- GET /api/admin/companies/:id/balance-transactions → 회사별 이력
- GET /api/admin/balance-overview → 전체 선불 고객사 잔액 현황

**서비스 사용자 API:**
- GET /api/balance → 잔액 + billing_type + 단가 조회
- GET /api/balance/transactions → 변동 이력 (페이지네이션, 타입/날짜 필터)
- GET /api/balance/summary → 월별 충전/차감/환불 요약

---

