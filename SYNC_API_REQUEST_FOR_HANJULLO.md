# Sync Agent → 한줄로 서버 연동 요청사항

## 1. 테스트용 회사 계정 생성 요청

Sync Agent E2E 테스트를 위해 한줄로에 테스트용 회사 계정이 필요합니다.

- **회사명**: "테스트고객사_싱크" (또는 적절한 이름)
- **용도**: Sync Agent가 이 계정의 api_key/api_secret으로 인증하여 데이터 전송 테스트
- **필요한 것**: company_id, api_key, api_secret 값
- **주의**: 테스트 전화번호는 `010-0222-0001` ~ `010-0222-0010` 사용 (실제 존재하지 않는 번호)

## 2. Sync API 엔드포인트 개발 요청

SYNC_AGENT_STATUS.md에 정의된 API를 한줄로 백엔드에 구현해야 합니다.
우선순위 순서:

### Phase 1 (필수 — Agent 기본 동작)
```
POST /api/sync/register       ← Agent 최초 등록 (api_key로 company_id 바인딩)
POST /api/sync/heartbeat      ← Agent 상태 보고
POST /api/sync/customers      ← 고객 데이터 벌크 UPSERT
POST /api/sync/purchases      ← 구매내역 벌크 INSERT
```

### Phase 2 (운영 관리)
```
POST /api/sync/log             ← 동기화 결과 로그 전송
GET  /api/sync/config          ← Agent 설정 원격 조회
GET  /api/sync/version         ← 버전 확인 (자동 업데이트용)
```

### Agent가 보내는 요청 형식

#### POST /api/sync/register
```json
{
  "apiKey": "company-api-key",
  "apiSecret": "company-api-secret",
  "agentName": "agent-001",
  "agentVersion": "0.1.0",
  "osInfo": "win32 10.0.26200",
  "dbType": "mysql"
}
```
응답 필요:
```json
{
  "success": true,
  "data": {
    "agentId": "uuid",
    "companyId": "uuid",
    "companyName": "테스트고객사_싱크",
    "config": {}
  }
}
```

#### POST /api/sync/heartbeat
```json
{
  "agentId": "uuid",
  "agentVersion": "0.1.0",
  "status": "active",
  "osInfo": "win32 10.0.26200",
  "dbType": "mysql",
  "lastSyncAt": "2025-02-09T14:00:00Z",
  "totalCustomersSynced": 10,
  "queuedItems": 0,
  "uptime": 3600
}
```

#### POST /api/sync/customers
```json
{
  "customers": [
    {
      "phone": "01002220001",
      "name": "김영희",
      "gender": "F",
      "birth_date": "1985-03-15",
      "grade": "VIP",
      "region": "서울",
      "sms_opt_in": true,
      "email": "test01@fake.com",
      "points": 15000,
      "store_code": "S001",
      "store_name": "강남점",
      "recent_purchase_date": "2024-12-20",
      "recent_purchase_amount": 150000,
      "total_purchase_amount": 2500000,
      "purchase_count": 23,
      "custom_fields": {}
    }
  ],
  "mode": "full",
  "batchIndex": 1,
  "totalBatches": 1
}
```
응답 필요:
```json
{
  "success": true,
  "data": {
    "upsertedCount": 10,
    "failedCount": 0,
    "failures": []
  }
}
```

#### POST /api/sync/purchases
```json
{
  "purchases": [
    {
      "customer_phone": "01002220001",
      "purchase_date": "2024-12-20 14:30:00",
      "total_amount": 150000,
      "store_code": "S001",
      "store_name": "강남점",
      "product_code": "P001",
      "product_name": "프리미엄 세트",
      "quantity": 1,
      "unit_price": 150000
    }
  ],
  "mode": "full",
  "batchIndex": 1,
  "totalBatches": 1
}
```

### 인증 방식
모든 요청 헤더:
```
X-Sync-ApiKey: {api_key}
X-Sync-Secret: {api_secret}
Content-Type: application/json
```

### DB 테이블 추가 필요
- `sync_agents` — Agent 등록 정보 (SYNC_AGENT_STATUS.md 참조)
- `sync_logs` — 동기화 로그 (SYNC_AGENT_STATUS.md 참조)

### customers 테이블 UPSERT 규칙
- UNIQUE KEY: company_id + phone
- source 컬럼: 'sync' (기존 upload와 구분)
- sms_opt_in, is_opt_out → 기존 한줄로 값 유지 (덮어쓰지 않음)
- 나머지 필드 → Agent 값으로 덮어쓰기

## 3. 현재 Agent 개발 상태

| 항목 | 상태 |
|------|------|
| DB 연결 (MySQL) | ✅ 동작 |
| 데이터 읽기 (증분/전체) | ✅ 동작 |
| 컬럼 매핑 | ✅ 동작 |
| 데이터 정규화 (전화번호, 성별, 날짜, 금액, 지역, 등급) | ✅ 동작 |
| Zod 유효성 검증 | ✅ 동작 |
| API 클라이언트 (HTTP 전송) | ✅ 코드 완성, 서버 API 대기 중 |
| 지수 백오프 재시도 | ✅ 코드 완성 |
| 로컬 큐 (오프라인 대비) | 🔲 개발 예정 |
| 스케줄러 | 🔲 개발 예정 |
| Heartbeat | 🔲 개발 예정 |

**Agent는 서버 API가 준비되면 바로 E2E 테스트 가능합니다.**
