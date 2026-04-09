# 전단AI — POS Agent 설계 (SyncAgent 확장)

> **작성:** 2026-04-09 (D112)
> **목표:** 마트 POS(포스뱅크/OKPOS/유니포스/삼성SDS 등) 데이터를 전단AI 서버로 실시간 수집
> **전제:** 기존 SyncAgent 패턴을 확장 → POS Adapter 추가

---

## 1. 전체 아키텍처

```
┌──────────────────────────────┐      ┌─────────────────────┐
│    마트 매장 PC / POS 서버    │      │  전단AI 백엔드 서버 │
│                              │      │                     │
│  ┌────────────────────────┐  │      │  ┌───────────────┐  │
│  │ 한줄로 POS Agent       │  │      │  │ /api/flyer/   │  │
│  │ (Windows Tray App)     │──┼──────┼─▶│   pos/sync    │  │
│  │                        │  │      │  │   pos/push    │  │
│  │  ┌──────────────────┐  │  │      │  │   pos/heart   │  │
│  │  │ POS Adapter      │  │  │      │  └──────┬────────┘  │
│  │  │ ┌────┐ ┌──────┐ │  │  │      │         │           │
│  │  │ │PB │ │OKPOS │ │  │  │      │  ┌──────▼────────┐   │
│  │  │ └────┘ └──────┘ │  │  │      │  │ PostgreSQL    │   │
│  │  │ ┌──────────────┐│  │  │      │  │ flyer_pos_*   │   │
│  │  │ │Uniposs/etc   ││  │  │      │  └───────────────┘   │
│  │  │ └──────────────┘│  │  │      │                     │
│  │  └──────────────────┘  │  │      └─────────────────────┘
│  │                        │  │
│  │  Local Cache (SQLite)  │  │
│  │  (오프라인 대비 큐)    │  │
│  └────────────────────────┘  │
│           ▲                  │
│           │ JDBC/ODBC/API    │
│  ┌────────┴───────────────┐  │
│  │ POS DB (MS-SQL/MySQL)  │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

---

## 2. Agent 구성 요소

### 2-1. 메인 프로세스 (Node.js 기반, pkg로 exe 패키징)

**스택:**
- Node.js + TypeScript
- `pkg`로 단일 exe 빌드 (Windows 설치 용이)
- better-sqlite3 (로컬 캐시)
- tedious (MS-SQL 드라이버) / mysql2 (MySQL 드라이버)
- systray (Windows 트레이 아이콘)

**이유:** 기존 SyncAgent가 이미 Node.js 기반이면 재활용. 아니면 Node.js는 Windows 7/10/11 호환성 우수, 드라이버 풍부.

### 2-2. POS Adapter 패턴

```typescript
interface PosAdapter {
  name: string;                    // 'posbank' | 'okpos' | 'unipos' | ...
  version: string;
  connect(config: PosConfig): Promise<void>;
  testConnection(): Promise<boolean>;

  // 데이터 수집
  fetchNewSales(since: Date): Promise<PosSale[]>;
  fetchInventorySnapshot(): Promise<PosInventoryItem[]>;
  fetchNewMembers(since: Date): Promise<PosMember[]>;
  fetchUpdatedMembers(since: Date): Promise<PosMember[]>;

  // 메타
  detectSchema(): Promise<SchemaInfo>; // 첫 실행 시 DB 구조 탐지
}
```

**Adapter 구현:**
```
pos-adapters/
├── base.ts                  // PosAdapter interface + 공통 헬퍼
├── posbank.ts               // 포스뱅크 (MS-SQL, TBL_SALES/TBL_MEMBER)
├── okpos.ts                 // OKPOS (MS-SQL)
├── unipos.ts                // 유니포스 (MySQL)
├── samsung-sds.ts           // 삼성SDS 유니ERP
├── generic-csv.ts           // CSV 파일 drop 방식 (호환 불가 POS용 대안)
└── registry.ts              // POS 종류별 Adapter 등록소
```

**우선순위 (Harold님 이사님 확인 후 확정):**
1. 포스뱅크 (가장 범용)
2. OKPOS
3. 유니포스
4. generic-csv (fallback — 어떤 POS든 관리자가 CSV로 내보내면 대응)

### 2-3. 로컬 캐시 (SQLite)

**테이블:**
- `pending_sales` — 서버 전송 대기 판매 데이터
- `pending_inventory` — 재고 스냅샷
- `pending_members` — 신규/업데이트 회원
- `sync_log` — 서버 전송 이력 (성공/실패)

**이유:**
- 인터넷 단절 시 데이터 손실 방지
- 서버 재기동 시 큐 유지
- 중복 전송 방지 (receipt_no 기준 dedupe)

### 2-4. 스케줄러

| 작업 | 주기 | 설명 |
|------|------|------|
| 판매 데이터 수집 | 5분 | 최근 판매 증분 조회 |
| 재고 스냅샷 | 30분 | 전체 재고 현황 |
| 회원 증분 싱크 | 10분 | 신규/변경 회원 |
| 하트비트 | 1분 | Agent 생존 신호 |
| 서버 푸시 | 2분 | pending_* 큐에서 서버로 전송 |

### 2-5. 트레이 UI

```
[한줄로 POS Agent]
┌─────────────────────────────┐
│ 상태: ✅ 연결됨              │
│ 마지막 싱크: 2분 전          │
│ 대기 중: 0건                 │
├─────────────────────────────┤
│ POS 종류: 포스뱅크           │
│ 매장: ○○마트                 │
├─────────────────────────────┤
│ [강제 싱크]                  │
│ [로그 보기]                  │
│ [설정]                       │
│ [종료]                       │
└─────────────────────────────┘
```

---

## 3. 서버 API

### 3-1. Agent 등록/인증

**POST /api/flyer/pos/register**
```json
// Request
{
  "agent_key": "FPA-XXXX-XXXX-XXXX-XXXX",  // 전단AI 대시보드에서 발급
  "pos_type": "posbank",
  "pos_version": "3.2.1",
  "hostname": "MART-POS-01",
  "os": "Windows 10"
}
// Response
{
  "company_id": "uuid",
  "auth_token": "jwt...",
  "sync_interval_sec": 300
}
```

### 3-2. 데이터 푸시

**POST /api/flyer/pos/push**
```json
// Request (청크 단위, 최대 1000건)
{
  "agent_key": "...",
  "auth_token": "...",
  "type": "sales",  // sales | inventory | members
  "items": [
    {
      "receipt_no": "R20260409-0001",
      "sold_at": "2026-04-09T10:30:00+09:00",
      "product_code": "P001",
      "product_name": "삼겹살 500g",
      "category": "정육",
      "quantity": 1,
      "sale_price": 12000,
      "cost_price": 8000,
      "pos_member_id": "M12345",
      "raw": { ... }
    }
  ]
}
// Response
{
  "accepted": 847,
  "rejected": 3,
  "errors": [
    { "index": 15, "reason": "duplicate receipt_no" }
  ]
}
```

**검증:**
- agent_key + auth_token 유효성
- 청크 크기 제한 (1000건)
- receipt_no + product_code + sold_at UNIQUE → 중복 자동 무시

### 3-3. 하트비트

**POST /api/flyer/pos/heartbeat**
```json
{
  "agent_key": "...",
  "last_sync_at": "2026-04-09T10:35:00+09:00",
  "pending_count": 0,
  "error_count_24h": 0
}
```

### 3-4. 설정 받아오기

**GET /api/flyer/pos/config**
→ 서버에서 Agent 쪽에 내려줄 설정 (싱크 주기, 대상 POS 테이블 이름 등)

---

## 4. 데이터 플로우 예시

### 4-1. 판매 데이터 수집 → 서버 전송

```
[POS DB: TBL_SALES]
  ↓ 5분마다 조회 (마지막 sold_at 이후 증분)
[Agent: PosAdapter.fetchNewSales()]
  ↓ 정규화
[Agent: SQLite pending_sales INSERT]
  ↓ 2분마다 배치
[Agent: POST /api/flyer/pos/push]
  ↓
[서버: flyer_pos_sales INSERT]
  ↓ 트리거
[서버: flyer_customers 구매이력 UPDATE]
  ↓ 트리거
[서버: RFM 세그먼트 재계산]
```

### 4-2. 재고 스냅샷 → 품절 자동표기

```
[POS DB: TBL_INVENTORY]
  ↓ 30분마다
[Agent: fetchInventorySnapshot()]
  ↓
[서버: flyer_pos_inventory INSERT (snapshot_at=now)]
  ↓
[공개 전단지 페이지] — 렌더링 시 최근 스냅샷 조회 → 재고 0 상품 "품절" 표시
```

---

## 5. 보안

### 5-1. Agent 인증
- agent_key는 전단AI 대시보드에서 1회 생성, Harold님이 마트 사장님께 전달
- Agent 설치 시 입력 → 서버에 POST /register → JWT 발급
- JWT는 24시간 유효, 만료 전 자동 갱신

### 5-2. 전송 보안
- HTTPS 필수
- agent_key 유출 시: 서버 대시보드에서 revoke 버튼 → DB에서 agent_key 무효화

### 5-3. 개인정보 보호
- POS 회원 주민번호/카드번호는 **Agent에서 masking** 후 전송
- 서버는 masking 된 데이터만 저장
- 원본 raw 데이터에도 주민번호는 저장 금지

### 5-4. 권한 분리
- Agent는 POS DB에 **SELECT 권한만**. INSERT/UPDATE/DELETE 절대 금지
- Harold님이 POS 사장님께 "읽기 전용 계정 만들어달라" 요청

---

## 6. 설치 가이드 (마트 사장님 대상)

```
1. 전단AI 대시보드 → [POS 연결] 메뉴
2. [Agent 다운로드] 클릭 → hanjul-pos-agent-setup.exe 다운로드
3. 설치 마법사 실행 → 관리자 권한 허용
4. Agent 실행 시 첫 화면:
   - POS 종류 선택 (포스뱅크/OKPOS/유니포스/기타)
   - POS DB 접속 정보 (호스트/포트/DB명/계정/비밀번호)
   - 전단AI에서 받은 연결 키 (FPA-XXXX-...) 입력
5. [연결 테스트] → 성공 시 [저장]
6. 트레이 아이콘 확인 (✅ 녹색 = 정상)
```

**Harold님이 초기에는 원격 지원으로 설치 도와드리는 게 안전합니다.**

---

## 7. POS별 차이점 대응

### 7-1. 문자셋
- 포스뱅크: EUC-KR
- OKPOS: CP949
- 유니포스: UTF-8
→ Agent가 Adapter에서 UTF-8로 통일 변환 후 전송

### 7-2. 날짜 형식
- 대부분 DATETIME 타입 사용
- 일부 POS는 VARCHAR(YYYYMMDDHHMISS) → Adapter에서 파싱

### 7-3. 회원 식별자
- 전화번호 (가장 일반적)
- 회원번호 (POS별 자체 체계)
- 바코드 (일부)
→ flyer_customers는 phone UNIQUE, pos_member_id는 참조키

### 7-4. 재고 단위
- ea, kg, g, L, ml, 박스, 팩 등
→ flyer_pos_inventory.unit 컬럼 원본 보존

---

## 8. 장애 대응

### 8-1. 인터넷 단절
- Agent: SQLite 큐에 쌓음
- 재연결 시: 큐 순차 전송 (최대 10,000건)
- 10,000건 초과 시: 오래된 데이터부터 drop + 알림

### 8-2. POS DB 접근 실패
- Agent: sync_log에 error 기록
- 5회 연속 실패 시: 트레이 아이콘 빨간색 + 서버로 알림
- 서버: 관리자 대시보드에 "Agent 장애" 표시

### 8-3. 서버 장애
- Agent: heartbeat 실패 시 재시도 (exponential backoff)
- 데이터는 SQLite에 계속 누적

### 8-4. 중복 전송
- 서버: UNIQUE 제약 (company_id, receipt_no, product_code, sold_at)
- ON CONFLICT DO NOTHING → 자동 무시

---

## 9. 테스트 전략

### 9-1. Adapter 단위 테스트
- POS 종류별 mock DB로 fetchNewSales 등 정상 동작 확인
- 문자셋/날짜 파싱 엣지케이스

### 9-2. 통합 테스트
- Agent ↔ 서버 end-to-end
- 네트워크 단절 시뮬레이션
- 대용량 (10만건/일) 부하 테스트

### 9-3. 실매장 파일럿
- 이사님 소개 마트 1곳에 먼저 설치 → 1주 모니터링
- 데이터 정확도 검증 (POS 원본 vs flyer_pos_sales)
- 피드백 반영 후 확대

---

## 10. 개발 일정

### Week 1: 인프라
- Agent 프로젝트 구조 (Node.js + pkg)
- SQLite 캐시
- 트레이 UI
- 서버 API 4종 (register/push/heartbeat/config)

### Week 2: Adapter 1종 (포스뱅크)
- 포스뱅크 MS-SQL 드라이버 연결
- 스키마 탐지 + 판매/재고/회원 fetch
- 통합 테스트

### Week 3: Adapter 2~3종 (OKPOS, 유니포스)
- 각각 Adapter 구현
- 공통 헬퍼 추출

### Week 4: 파일럿 + 안정화
- 실매장 설치
- 장애 대응 케이스 추가
- 설치 가이드 문서화

---

## 11. 확장 포인트

- **쿠폰 사용 이벤트 수집:** POS에서 쿠폰 사용 시 이벤트 → 전단AI QR 쿠폰 기능과 연동
- **양방향 통신:** 서버 → Agent 명령 (예: "지금 싱크해" 강제 트리거)
- **멀티 매장 체인점:** 한 회사가 여러 매장 운영 시 Agent 여러 대 → company_id 하나에 agent_key 여러 개
