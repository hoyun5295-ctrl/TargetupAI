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

---

## ✅ 완료된 핵심 기능

### 발송 시스템
- [x] 즉시/예약/분할 발송 (QTmsg MySQL 연동)
- [x] SMS/LMS/MMS 지원
- [x] 바이트 계산 EUC-KR 통일 (한글 2byte)
- [x] 90byte 초과 시 LMS 전환 경고 모달
- [x] SMS 비용 절감 안내 모달
- [x] 광고문구 자동 삽입 (080 수신거부)
- [x] 개인화 변수 치환 (%이름%, %포인트%, %등급%)
- [x] 발송결과 실시간 동기화 (통신사별 분포)
- [x] 개별회신번호 발송 (직접발송 완료)

### AI 마케팅
- [x] AI 타겟 추출 + 메시지 3안 생성
- [x] 채널/시간대 추천
- [x] 브랜드 정보 반영 (슬로건/설명/톤)
- [x] 동적 스키마 캐싱 (customer_schema)
- [x] 캠페인명 AI 자동 생성
- [x] 개인화 키워드 감지 (ai.ts: "개인화" → usePersonalization)
- [x] 개별회신번호 키워드 감지 ("매장번호", "주이용매장" → useIndividualCallback)
- [x] AI 캠페인 회신번호 선택 UI (2단계에 드롭다운 추가)
- [x] AI 캠페인 시간 선택 UI (오전/오후 드롭다운 + 날짜/시간 분리)
- [x] AI 미리보기 개인화 샘플 3개 표시

### 직접 타겟 설정
- [x] 필터 모달 UI (성별/나이/등급/지역/구매금액/최근구매)
- [x] 실시간 대상 인원 카운트
- [x] 타겟 추출 API (/api/customers/schema, count, extract)
- [x] store_codes 보안 필터 (일반 사용자는 본인 매장만)

### 개별회신번호
- [x] customers.callback 컬럼 추가
- [x] customers_unified 뷰 재생성
- [x] callback_numbers에 store_code, store_name 추가
- [x] 4브랜드 × 5매장 = 20개 회신번호 등록
- [x] 25만 고객에 매장별 callback 배정
- [x] 드롭다운 "📱 개별회신번호" 옵션
- [x] 회신번호 검증 로직
- [x] 직접발송 개별회신번호 발송 완료 (campaigns.ts direct-send)

### 예약 전송
- [x] 공용 달력 모달 (타겟/직접발송)
- [x] 12시간제 + 오전/오후 드롭다운
- [x] 현재시간 이전 예약 불가 검증
- [x] 예약 수정/취소 기능
- [x] 예약 대기 모달 개선 (회신번호 + 메시지 상세보기)

### 주소록 & 수신거부
- [x] 주소록 CRUD (address_books)
- [x] 수신거부 관리 (unsubscribes)
- [x] 080 API 콜백 연동 (나래인터넷)
- [x] 발송 시 수신거부 자동 필터링

### 슈퍼관리자
- [x] 회사/사용자 관리 (CRUD)
- [x] 요금제 관리 (plans)
- [x] 발신번호 관리 (callback_numbers)
- [x] 예약 캠페인 취소 (사유 기록)
- [x] 비밀번호 초기화 SMS 발송
- [x] 권한별 접근 제어 (super_admin/company_admin/company_user)

### 요금제 시스템
- [x] 요금제 안내 페이지 (PricingPage.tsx)
- [x] 요금제 신청/승인/거절 (plan_requests)
- [x] 플랜 제한 체크 모달

### UI/UX
- [x] 대시보드 리디자인 (INVITO 컬러: 그린+골드)
- [x] Lucide React 아이콘
- [x] 3컬럼 레이아웃 (AI/직접타겟/직접발송)
- [x] 토스트 알림 + 예쁜 모달 전면 적용
- [x] 미리보기 모달 (폰 프레임 UI)
- [x] 예약 대기 모달 버튼 정렬 (예약취소/문안수정 flex gap-2)

---

## ✅ 세션19 완료 작업 상세

### 1. AI 캠페인 시간 선택 UI 개선
- **파일**: Dashboard.tsx 2040~2133줄
- 기존 `datetime-local` → 날짜(date) + 오전/오후 드롭다운 + 시(1-12) + 분(0-59)
- 12시간제 → 24시간제 자동 변환 로직

### 2. AI 캠페인 회신번호 선택 UI 추가
- **파일**: Dashboard.tsx 2단계
- 회신번호 드롭다운 추가 (개별회신번호 옵션 포함)
- handleAiCampaignSend에 회신번호 검증 추가

### 3. routes/ai.ts 개인화 정보 전달 버그 수정
- req.body에서 usePersonalization, personalizationVars 받기
- generateMessages에 개인화 정보 전달

### 4. 예약 대기 모달 개선
- **파일**: Dashboard.tsx 3400~3500줄
- 테이블 헤더: 발송시간 → 메시지 내용 + 회신번호
- 상세보기 버튼 + 메시지 상세보기 모달 추가 (messagePreview state)
- 버튼 정렬: 예약취소, 문안수정을 `<div className="flex gap-2">`로 감싸기

### 5. campaigns.ts recipients API 수정
- **파일**: campaigns.ts 995~1020줄
- scheduled 캠페인도 MySQL SMSQ_SEND에서 먼저 조회
- MySQL에 데이터 있으면 message, callback 포함하여 반환
- 쿼리에 `call_back as callback, msg_contents as message` 추가

### 6. 세션19에서 발견 및 수정한 버그들

| 버그 | 파일/위치 | 원인 | 수정 내용 |
|------|----------|------|----------|
| 예약 대기에서 AI 캠페인 데이터 안 보임 | campaigns.ts 423줄 | app_etc1에 campaignRun.id 저장 | `campaignRun.id` → `id` (campaign.id) |
| 개인화 변수 치환 안 됨 | campaigns.ts 422~434줄 | 치환 로직 없음 | personalizedMessage 치환 로직 추가 |
| 회신번호가 수신거부번호(080)로 발송 | campaigns.ts 338~344줄 | reject_number 조회 | callback_numbers 테이블에서 조회 |
| 개별회신번호 로직 없음 | campaigns.ts 347줄 | 로직 누락 | useIndividualCallback + customer.callback 사용 |
| customers 조회 필드 누락 | campaigns.ts 364~368줄 | points, callback 없음 | `points, callback` 컬럼 추가 |

### 7. 기존 AI 캠페인 MySQL 데이터 수정
```powershell
# app_etc1이 campaignRun.id로 저장된 기존 데이터 수정
docker exec -it targetup-mysql mysql -usmsuser -psms123 smsdb -e "UPDATE SMSQ_SEND SET app_etc1 = '34a8a11f-b1e9-4d9b-92f9-1f278bb594e4' WHERE app_etc1 = 'a4bc580d-275a-4a80-9252-b12b5826bf3b'"
```

---

## 🚨 발견된 심각한 문제: AI 개인화 스키마 매핑

### 문제 상황
1. **AI가 존재하지 않는 변수 임의 생성**: `%매장번호%` 같은 DB에 없는 변수를 AI가 마음대로 만듦
2. **하드코딩된 3개 변수만 치환**: 이름, 포인트, 등급만 치환됨 (campaigns.ts 422~427줄)
3. **고객사마다 컬럼명이 다름**: 범용 시스템으로 사용 불가

### 예시: 고객사별 컬럼명 차이
| 표준 변수 | 우리 DB | A고객사 | B고객사 |
|----------|--------|--------|--------|
| 이름 | name | customer_name | 고객명 |
| 포인트 | points | mileage | 적립금 |
| 등급 | grade | vip_level | 회원등급 |
| 매장명 | store_name | shop_name | 담당매장 |

### 현재 하드코딩된 코드 (문제점)

**ai.ts 209~215줄:**
```typescript
const varToTag: { [key: string]: string } = {
  '이름': '%이름%',
  '포인트': '%포인트%',
  '등급': '%등급%',
  '구매금액': '%구매금액%',
};
```

**campaigns.ts 422~427줄:**
```typescript
const personalizedMessage = (campaign.message_content || '')
  .replace(/%이름%/g, customer.name || '')
  .replace(/%포인트%/g, customer.points?.toLocaleString() || '0')
  .replace(/%등급%/g, customer.grade || '');
```

---

## 🎯 해결 방향: AI 자동 매핑 아키텍처

### 전체 플로우
```
[STEP 1: 업로드 시점]
엑셀/CSV 업로드 → AI가 컬럼명 + 샘플데이터 분석 → 매핑 추천

[STEP 2: 사용자 확인]
매핑 결과 보여주고 확인/수정 → 확정

[STEP 3: customer_schema 저장]
companies.customer_schema에 field_mappings, available_vars 저장

[STEP 4: AI 메시지 생성]
ai.ts에서 available_vars만 사용하도록 프롬프트 전달

[STEP 5: 발송]
field_mappings 기반으로 동적 변수 치환
```

### STEP 1: 업로드 시점 AI 분석

```typescript
// POST /api/upload/analyze-columns
// 요청
{
  columns: ["customer_name", "mileage", "vip_level", "shop_name", "reg_date"],
  samples: [
    ["김민수", 12500, "VIP", "강남점", "2024-01-15"],
    ["이영희", 8200, "GOLD", "홍대점", "2024-02-20"],
    ["박지현", 5000, "SILVER", "신촌점", "2024-03-10"]
  ]
}

// AI 분석 결과
{
  mappings: {
    "이름": "customer_name",      // "김민수", "이영희" → 이름이네
    "포인트": "mileage",          // 12500, 8200 → 숫자, 포인트/적립금이네
    "등급": "vip_level",          // VIP, GOLD, SILVER → 등급이네
    "매장명": "shop_name"         // 강남점, 홍대점 → 매장명이네
  },
  confidence: {
    "이름": 0.95,
    "포인트": 0.90,
    "등급": 0.98,
    "매장명": 0.85
  },
  unmapped: ["reg_date"]  // 매핑 못한 컬럼
}
```

### STEP 2: 사용자 확인 UI

```
┌────────────────────────────────────────────────────────┐
│  📋 컬럼 매핑 확인                                      │
├────────────────┬─────────────┬────────────┬───────────┤
│ 원본 컬럼명     │ 매핑된 변수   │ 샘플 데이터  │ 확인      │
├────────────────┼─────────────┼────────────┼───────────┤
│ customer_name  │ 이름 ✓      │ 김민수      │ [확인]    │
│ mileage        │ 포인트 ✓    │ 12,500     │ [확인]    │
│ vip_level      │ 등급 ✓      │ VIP        │ [확인]    │
│ shop_name      │ 매장명 ✓    │ 강남점      │ [확인]    │
│ reg_date       │ ??? ▼      │ 2024-01-15 │ [선택]    │
└────────────────┴─────────────┴────────────┴───────────┘
                              [저장하고 진행]
```

### STEP 3: customer_schema 구조 확장

```json
// companies.customer_schema
{
  // 기존 필드
  "genders": ["남성", "여성"],
  "grades": ["VIP", "GOLD", "SILVER", "BRONZE"],
  "custom_field_keys": ["store_code"],
  
  // 신규 추가 필드
  "field_mappings": {
    "이름": "customer_name",
    "포인트": "mileage",
    "등급": "vip_level",
    "매장명": "shop_name",
    "지역": "region",
    "구매금액": "total_purchase"
  },
  "available_vars": ["이름", "포인트", "등급", "매장명", "지역", "구매금액"],
  "custom_vars": {
    "가입일": "reg_date",
    "생일": "birthday"
  }
}
```

### STEP 4: ai.ts 수정

**recommendTarget 프롬프트에 추가 (391줄 부근):**
```typescript
## 사용 가능한 개인화 변수 (⚠️ 이 변수만 사용 가능!)
${availableVars.map(v => `- %${v}%`).join('\n')}

⚠️ 위 변수 외 다른 형식(%매장번호%, %고객명% 등)은 절대 사용 금지!
존재하지 않는 변수를 만들면 발송 시 치환되지 않고 그대로 노출됩니다.
```

**generateMessages 프롬프트에도 동일하게 추가 (253줄 부근)**

### STEP 5: campaigns.ts 동적 치환

```typescript
// 기존 하드코딩 → 동적 치환으로 변경
const fieldMappings = companySchema?.field_mappings || {
  '이름': 'name',
  '포인트': 'points',
  '등급': 'grade',
  '매장명': 'store_name',
  '지역': 'region',
  '구매금액': 'total_purchase_amount'
};

let personalizedMessage = campaign.message_content || '';

for (const [varName, columnName] of Object.entries(fieldMappings)) {
  const value = customer[columnName];
  const displayValue = typeof value === 'number' 
    ? value.toLocaleString() 
    : (value || '');
  personalizedMessage = personalizedMessage.replace(
    new RegExp(`%${varName}%`, 'g'),
    displayValue
  );
}
```

---

## 📦 DB 스키마 참조

### companies 테이블 (주요 컬럼)
```
id, name, brand_name, reject_number, customer_schema (JSONB),
manager_contacts (JSONB), store_code_list (JSONB), plan_id
```

### customers 테이블 (주요 컬럼)
```
id, company_id, phone, name, gender, grade, points, 
store_code, store_name, callback, region,
total_purchase_amount, recent_purchase_date, custom_fields (JSONB)
```

### callback_numbers 테이블
```
id, company_id, phone, description, is_default, is_active,
store_code, store_name
```

### SMSQ_SEND (MySQL QTmsg)
```
seqno, dest_no, call_back, msg_contents, msg_type, title_str,
sendreq_time, status_code, rsv1, app_etc1 (campaign_id), app_etc2 (company_id),
mobsend_time, mob_company
```
- status_code: 100=대기, 6=SMS성공, 1000=LMS성공, 1800=MMS성공
- mob_company: 11=SKT, 16=KT, 19=LG U+

---

## 📋 TODO (우선순위)

| 순위 | 작업 | 상태 | 비고 |
|:---:|------|:---:|------|
| 1 | AI 스키마 매핑 아키텍처 구현 | ⏳ | 핵심! 위 설계 참조 |
| 2 | POST /api/upload/analyze-columns API | ⏳ | AI 컬럼 분석 |
| 3 | 매핑 확인 UI 컴포넌트 | ⏳ | |
| 4 | ai.ts available_vars 프롬프트 전달 | ⏳ | |
| 5 | campaigns.ts 동적 변수 치환 | ⏳ | |
| 6 | AI 발송 개별회신번호 테스트 | ⏳ | |
| 7 | 성과지표 대시보드 | ⏳ | |
| 8 | IDC 서버 배포 | ⏳ | |

---

## 🗄️ 테스트 환경

### 계정
| 역할 | ID | PW |
|------|----|----|
| 슈퍼관리자 | admin | 12345 |
| 테스트회사 | luna1234 | 12345 |

### 테스트 데이터
- company_id: `50031bbd-9930-46e9-af39-2e0d18a72727`
- 4개 브랜드: BLOOM, GLOW, LUNA, VELVET
- 25만 고객 (브랜드당 62,500명)
- 20개 매장 회신번호 (브랜드당 5개)

### 예약 대기 중인 캠페인
```
직접발송: b1833883-bbc5-4170-baf4-9439d5e68929 (24명)
AI발송: 34a8a11f-b1e9-4d9b-92f9-1f278bb594e4 (1,580명)
```

---

## ⚠️ 주의사항

1. **백업 필수**: 작업 전 `pg_dump`, 작업 후 `git commit`
2. **모달은 예쁘게**: confirm/alert 사용 금지, 커스텀 모달 사용
3. **코드 수정 형식**: "기존코드 → 새코드" 형식으로 요청
4. **Docker 주의**: 재생성/삭제 시 반드시 백업 먼저
5. **app_etc1 주의**: campaign.id를 저장해야 함 (campaignRun.id 아님!)

---

## 📝 세션20 시작용 지시사항

### 필수 파일 업로드
```
1. Dashboard.tsx
2. campaigns.ts
3. ai.ts
4. STATUS.md (이 파일)
```

### 시작 메시지
```
타겟업 세션20 시작.

STATUS.md 파일 읽고 시작해주세요.

세션19 완료:
- AI 캠페인 시간 선택 UI (오전/오후 드롭다운)
- AI 캠페인 회신번호 선택 UI
- 예약 대기 모달 (회신번호+메시지상세보기)
- campaigns.ts recipients API (MySQL 우선 조회)
- campaigns.ts send API 버그 수정 (app_etc1, 개인화, 회신번호)

세션19 발견된 심각한 문제:
- AI가 %매장번호% 같은 존재하지 않는 변수 임의 생성
- 고객사마다 컬럼명이 다름 (범용 불가)
- 하드코딩된 3개 변수만 치환

세션20 핵심 작업: AI 스키마 매핑 아키텍처
1. customer_schema 구조 확장 (field_mappings, available_vars)
2. POST /api/upload/analyze-columns API
3. ai.ts: available_vars 프롬프트 전달 + "다른 변수 금지"
4. campaigns.ts: 동적 변수 치환 (field_mappings 기반)

STATUS.md의 "해결 방향: AI 자동 매핑 아키텍처" 섹션에 상세 설계 있음.
```

### 세션20 작업 순서

**1단계: customer_schema 확장**
```sql
-- companies 테이블 customer_schema 구조 확인
SELECT customer_schema FROM companies WHERE id = '50031bbd-9930-46e9-af39-2e0d18a72727';

-- 기존 구조에 field_mappings, available_vars 추가
```

**2단계: AI 컬럼 분석 API 구현**
```typescript
// routes/upload.ts 또는 routes/customers.ts
// POST /api/upload/analyze-columns
// - 컬럼명 + 샘플 5개 받아서 AI 분석
// - field_mappings 추천 반환
```

**3단계: ai.ts 수정**
```typescript
// recommendTarget 함수 (291줄~)
// - companyInfo.customer_schema.available_vars 받아서
// - 프롬프트에 "사용 가능 변수" 목록 추가
// - "다른 변수 사용 금지" 경고 추가

// generateMessages 함수 (156줄~)
// - 동일하게 available_vars 전달
```

**4단계: campaigns.ts 동적 치환**
```typescript
// send 엔드포인트 (302줄~)
// - companySchema.field_mappings 조회
// - 하드코딩 replace → 동적 루프로 변경
```

**5단계: 테스트**
```
1. AI 캠페인 생성 → %매장번호% 같은 잘못된 변수 안 나오는지 확인
2. AI 캠페인 발송 → 개인화 변수 제대로 치환되는지 확인
3. 개별회신번호 → customer.callback으로 발송되는지 확인
```

---

## 🔧 현재 코드 수정 상태

### campaigns.ts 수정된 부분 (세션19)

**338~347줄 (회신번호 조회):**
```typescript
// 기본 회신번호 조회 (callback_numbers 테이블에서)
const callbackResult = await query(
  'SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1',
  [companyId]
);
const defaultCallback = callbackResult.rows[0]?.phone || '18008125';

// 개별회신번호 사용 여부
const useIndividualCallback = campaign.use_individual_callback || false;
```

**364~368줄 (고객 조회):**
```typescript
const customersResult = await query(
  `SELECT id, phone, name, grade, points, callback FROM customers c
   WHERE c.company_id = $1 AND c.is_active = true AND c.sms_opt_in = true ${filterQuery.where}${storeFilterFinal}
   AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.company_id = c.company_id AND u.phone = c.phone)`,
  [companyId, ...filterQuery.params, ...storeParams]
);
```

**422~434줄 (개인화 + 개별회신번호):**
```typescript
for (const customer of filteredCustomers) {
  // 개인화 변수 치환
  const personalizedMessage = (campaign.message_content || '')
    .replace(/%이름%/g, customer.name || '')
    .replace(/%포인트%/g, customer.points?.toLocaleString() || '0')
    .replace(/%등급%/g, customer.grade || '');

  // 개별회신번호: customer.callback 있으면 사용, 없으면 캠페인 설정 또는 기본값
  const customerCallback = useIndividualCallback && customer.callback 
    ? customer.callback.replace(/-/g, '') 
    : (campaign.callback_number || defaultCallback).replace(/-/g, '');

  await mysqlQuery(
    `INSERT INTO SMSQ_SEND (
      dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1, app_etc1, app_etc2
    ) VALUES (?, ?, ?, ?, ${sendTime ? `'${sendTime}'` : 'NOW()'}, 100, '1', ?, ?)`,
    [customer.phone.replace(/-/g, ''), customerCallback, personalizedMessage, campaign.message_type === 'SMS' ? 'S' : 'L', id, companyId]
  );
}
```

**995~1020줄 (recipients API - MySQL 우선 조회):**
```typescript
// 예약 상태면 먼저 MySQL SMSQ_SEND에서 조회 시도
if (camp.status === 'scheduled') {
  const mysqlRecipients = await mysqlQuery(
    `SELECT seqno as idx, dest_no as phone, call_back as callback, msg_contents as message 
     FROM SMSQ_SEND 
     WHERE app_etc1 = ? AND status_code = 100
     ORDER BY seqno
     LIMIT 1000`,
    [campaignId]
  ) as any[];

  // MySQL에 데이터 있으면 그걸 반환
  if (mysqlRecipients && mysqlRecipients.length > 0) {
    const totalResult = await mysqlQuery(
      `SELECT COUNT(*) as total FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100`,
      [campaignId]
    ) as any[];

    return res.json({ 
      success: true, 
      campaign: camp,
      recipients: mysqlRecipients,
      total: totalResult[0]?.total || 0
    });
  }
}
```

---

## 📞 QTmsg MySQL 접속

```bash
# 접속
docker exec -it targetup-mysql mysql -usmsuser -psms123 smsdb

# 예약 대기 확인
SELECT app_etc1, COUNT(*) as cnt FROM SMSQ_SEND WHERE status_code = 100 GROUP BY app_etc1;

# 특정 캠페인 확인
SELECT seqno, dest_no, call_back, LEFT(msg_contents, 50) FROM SMSQ_SEND WHERE app_etc1 = 'campaign-id' LIMIT 5;
```

---

## 📚 최근 3개 세션 요약 (타겟업 15~17)

### 타겟업 15 (세션17)
- 분할전송 완성 (Bulk INSERT 최적화 7만건 30초)
- 예약 수정/삭제 API
- 15분 전 변경 차단
- 문안수정 (변수치환 + 진행률)
- 예약상태 자동동기화
- 담당자 이름 추가
- 특수문자 안내

### 타겟업 16 (세션18)
- 요금제 시스템 (PricingPage, plan_requests)
- 대시보드 UI 리디자인 (INVITO 컬러)
- 직접 타겟 설정 (schema/count/extract API)
- 바이트 계산 EUC-KR 통일
- 예약전송 개선 (공용달력, 12시간제)
- 개별회신번호 DB (callback컬럼, 20매장, 25만고객배정)
- 개별회신번호 프론트 (state, 드롭다운, 검증)
- 분할전송 테스트 성공

### 타겟업 17 (세션19) - 현재
- AI 캠페인 시간 선택 UI (오전/오후 드롭다운)
- AI 캠페인 회신번호 선택 UI (2단계)
- AI 미리보기 개인화 샘플 3개 표시
- routes/ai.ts 개인화 정보 전달 수정
- 예약 대기 모달 (회신번호 + 메시지상세보기)
- campaigns.ts recipients API (MySQL 우선 조회)
- campaigns.ts send API 버그 수정:
  - app_etc1: campaignRun.id → campaign.id
  - 개인화 변수 치환 로직 추가
  - 회신번호: callback_numbers에서 조회
  - 개별회신번호 로직 (useIndividualCallback)
  - customers 조회에 points, callback 추가
- **발견된 심각한 문제**: AI 스키마 매핑 아키텍처 필요

---

## 2026-02-05 세션20 (타겟업 18) 완료
- normalize.ts 유틸리티 생성 (성별/등급/지역/전화번호/수신동의/나이/금액/날짜 정규화)
- services/ai.ts 전면수정: DEFAULT_FIELD_MAPPINGS, VarCatalog, available_vars 프롬프트 전달
- routes/campaigns.ts 7곳 수정: buildGenderFilter/buildGradeFilter 헬퍼함수 + 동적치환
- routes/ai.ts 수정: generateMessages 호출부에 변수카탈로그 전달
- customer_schema DB UPDATE: field_mappings + available_vars 구조 추가

## 2026-02-05 세션21-22 (타겟업 21) 완료
- normalize.ts 전체적용 (ai.ts, campaigns.ts, customers.ts, upload.ts)
- 성별/등급/지역 변형값매칭, 업로드시 정규화

**⚠️ 프로젝트 작업 시작 전 반드시 이 파일 전체를 읽고 시작하세요!**