# 전단AI — POS Agent 개발 설계서 (즉시 구현용)

> **작성:** 2026-04-12 (D114)
> **참조:** FLYER-POS-AGENT.md (아키텍처 설계), FLYER-MART-ROADMAP.md (기능 1~3)
> **목표:** 투게더스 POS 우선 → Windows exe 설치 → 고객/매출/재고 자동 수집
> **다음 세션에서 이 문서 읽고 즉시 개발 착수**

---

## 0. 핵심 전제

- **타겟 POS:** 투게더스(Together's) 우선, 토마토는 클라우드라 2순위
- **투게더스:** 로컬 DB 설치형 → Agent 직접 접근 가능
- **DB 엔진:** 미확인 (MS-SQL Express / Firebird / MySQL 중 하나 — 실매장 확인 필요)
- **전화번호 마스킹:** UI에서만 마스킹일 가능성 높음, DB 원본 확인 필요
- **POS 업체 비협조 대비:** 매장 로컬 DB에 직접 접근 (사장님 동의 기반)

---

## 1. 프로젝트 구조

```
packages/pos-agent/                    ← 신규 패키지
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                       ← 메인 엔트리포인트
│   ├── config.ts                      ← 설정 관리 (agent_key, DB접속, 서버URL)
│   ├── scheduler.ts                   ← 주기적 작업 스케줄러
│   ├── server-client.ts               ← 전단AI 서버 통신 (push/heartbeat/register)
│   ├── local-cache.ts                 ← SQLite 로컬 큐 (오프라인 대비)
│   ├── tray.ts                        ← Windows 시스템 트레이 UI
│   ├── logger.ts                      ← 파일 로깅
│   │
│   ├── adapters/                      ← POS별 Adapter
│   │   ├── base.ts                    ← PosAdapter interface
│   │   ├── togethers.ts               ← ★ 투게더스 Adapter (1순위)
│   │   ├── tomato.ts                  ← 토마토 Adapter (클라우드 API 방식)
│   │   ├── generic-csv.ts             ← CSV 파일 감시 (범용 fallback)
│   │   └── registry.ts               ← Adapter 등록소
│   │
│   └── setup/                         ← 초기 설정 마법사
│       ├── wizard.ts                  ← CLI 기반 초기 설정
│       └── db-detector.ts             ← POS DB 자동 감지 (포트 스캔 + 프로세스 확인)
│
├── assets/
│   └── icon.ico                       ← 트레이 아이콘
│
├── build/
│   └── build.js                       ← pkg 빌드 스크립트
│
└── README.md                          ← 설치 가이드
```

---

## 2. POS Adapter 인터페이스

```typescript
// src/adapters/base.ts

export interface PosConfig {
  host: string;         // localhost (대부분)
  port: number;         // MS-SQL: 1433, MySQL: 3306, Firebird: 3050
  database: string;
  username: string;
  password: string;
  charset?: string;     // euc-kr / cp949 / utf-8
}

export interface PosSale {
  receipt_no: string;
  sold_at: string;      // ISO 8601
  product_code: string;
  product_name: string;
  category?: string;
  quantity: number;
  unit_price: number;
  sale_price: number;
  cost_price?: number;
  pos_member_id?: string;
  raw?: Record<string, any>;
}

export interface PosMember {
  pos_member_id: string;
  name?: string;
  phone: string;         // ★ 원본 전화번호 (마스킹 아님)
  gender?: string;
  birth_date?: string;
  grade?: string;
  points?: number;
  total_purchase?: number;
  last_purchase_at?: string;
  sms_opt_in?: boolean;
}

export interface PosInventoryItem {
  product_code: string;
  product_name: string;
  category?: string;
  current_stock: number;
  unit?: string;
  cost_price?: number;
  sale_price?: number;
  expiry_date?: string;
}

export interface SchemaInfo {
  tables: { name: string; columns: string[] }[];
  memberTable?: string;
  salesTable?: string;
  inventoryTable?: string;
  phoneColumn?: string;      // 전화번호 컬럼명
  phoneFormat?: 'raw' | 'masked' | 'encrypted';  // ★ 마스킹 여부 자동 감지
}

export interface PosAdapter {
  name: string;
  version: string;

  // 연결
  connect(config: PosConfig): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<boolean>;

  // 스키마 탐지 (첫 실행)
  detectSchema(): Promise<SchemaInfo>;

  // 데이터 수집 (증분)
  fetchNewSales(since: Date): Promise<PosSale[]>;
  fetchNewMembers(since: Date): Promise<PosMember[]>;
  fetchUpdatedMembers(since: Date): Promise<PosMember[]>;
  fetchInventorySnapshot(): Promise<PosInventoryItem[]>;
}
```

---

## 3. 투게더스 Adapter (1순위)

```typescript
// src/adapters/togethers.ts

/**
 * ★ 투게더스(Together's) POS Adapter
 *
 * 사전 조사 결과:
 * - 로컬 DB 설치형 (매장 PC)
 * - DB 엔진: 미확인 → db-detector.ts로 자동 감지
 *   - MS-SQL Express: port 1433, tedious 드라이버
 *   - Firebird: port 3050, node-firebird 드라이버
 *   - MySQL: port 3306, mysql2 드라이버
 *
 * 테이블명 추정 (투게더스 공통 패턴):
 * - 회원: TB_MEMBER, MEMBER, T_MEMBER 등
 * - 판매: TB_SALES, SALES_DETAIL, T_SALE_DTL 등
 * - 재고: TB_STOCK, INVENTORY, T_PRODUCT 등
 *
 * ★ 실매장 원격 접속 후 확인 필요:
 * 1. POS 설치 폴더 (C:\Together 또는 C:\TogetherPOS 등)
 * 2. 설정 파일에서 DB 접속 정보 추출
 * 3. DB 접속 후 테이블 목록 확인
 * 4. 회원 테이블에서 전화번호 원본/마스킹 여부 확인
 */

export class TogethersAdapter implements PosAdapter {
  name = 'togethers';
  version = '1.0.0';

  // DB 엔진별 드라이버는 런타임에 동적 로드
  // → detectSchema에서 DB 종류 판별 후 적절한 드라이버 사용
}
```

### 3-1. DB 자동 감지 (db-detector.ts)

```typescript
/**
 * POS DB 자동 감지
 * 매장 PC에서 실행 시:
 * 1. 알려진 POS 설치 경로 스캔 (C:\Together*, C:\TogetherPOS, C:\Tomato* 등)
 * 2. 설정 파일(ini, xml, json, config) 파싱 → DB 접속정보 추출
 * 3. 로컬 포트 스캔 (1433/3050/3306) → 어떤 DB 엔진인지 판별
 * 4. 프로세스 목록 확인 (sqlservr.exe, fbserver.exe, mysqld.exe)
 */

export async function detectPosDb(): Promise<{
  dbType: 'mssql' | 'firebird' | 'mysql' | 'unknown';
  host: string;
  port: number;
  possibleConfigs: PosConfig[];
  posInstallPath?: string;
}> {
  // Step 1: 프로세스 확인
  // Step 2: 포트 스캔
  // Step 3: POS 설치 폴더 스캔
  // Step 4: 설정 파일 파싱
}
```

---

## 4. 서버 API (백엔드)

> 기존 FLYER-POS-AGENT.md 설계 기반. 실제 구현할 엔드포인트.

### 4-1. routes/flyer/pos.ts (신규)

```
POST /api/flyer/pos/register      — Agent 등록 (agent_key로 인증, JWT 발급)
POST /api/flyer/pos/push          — 데이터 푸시 (sales/members/inventory)
POST /api/flyer/pos/heartbeat     — 하트비트 (1분 간격)
GET  /api/flyer/pos/config        — Agent 설정 다운로드 (싱크 주기 등)
```

### 4-2. 데이터 처리 파이프라인

```typescript
// POST /api/flyer/pos/push 처리 흐름

type PushType = 'sales' | 'members' | 'inventory';

// 1. sales → flyer_pos_sales INSERT (ON CONFLICT DO NOTHING)
//         → flyer_customers.last_purchase_at, total_purchase_amount UPDATE
//         → flyer_catalog 자동 등록 (신상품 감지)

// 2. members → flyer_customers UPSERT (phone 기준)
//           → sms_opt_in 반영
//           → ★ 전화번호 마스킹 감지: phone에 * 포함 시 → 경고 로그 + 스킵

// 3. inventory → flyer_pos_inventory INSERT (snapshot)
//             → is_low_stock / is_expiring_soon 자동 계산
```

---

## 5. 설치 마법사 (사장님 대상)

### 5-1. 설치 방식

```
1. Harold님이 agent_key 발급 (슈퍼관리자 대시보드)
2. 매장 사장님에게 설치파일 전달 (hanjul-pos-agent-setup.exe)
3. 설치 실행 → 자동 DB 감지
4. agent_key 입력 → 서버 등록 → 연결 테스트
5. 시스템 트레이에 상주 (Windows 시작 시 자동 실행)
```

### 5-2. 초기 설정 화면 (Electron 또는 CLI)

```
┌──────────────────────────────────────┐
│  한줄로 POS Agent 설정               │
│                                      │
│  연결 키: [FPA-____________]         │
│                                      │
│  ── POS 자동 감지 결과 ──             │
│  ✅ 투게더스 POS 감지됨               │
│  DB: MS-SQL Express (localhost:1433)  │
│  설치 경로: C:\TogetherPOS            │
│                                      │
│  DB 계정: [sa          ]             │
│  DB 비번: [************]             │
│                                      │
│  [연결 테스트]     [저장 및 시작]      │
└──────────────────────────────────────┘
```

---

## 6. 빌드 및 배포

### 6-1. exe 패키징

```json
// package.json
{
  "name": "hanjul-pos-agent",
  "version": "1.0.0",
  "scripts": {
    "build": "tsc && pkg dist/index.js --target node18-win-x64 --output build/hanjul-pos-agent.exe",
    "build:installer": "node build/make-installer.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.0.0",
    "tedious": "^16.0.0",
    "mysql2": "^3.0.0",
    "node-firebird": "^1.1.0",
    "systray2": "^2.0.0",
    "node-fetch": "^3.0.0"
  }
}
```

### 6-2. Windows 서비스 등록 (자동 시작)

```typescript
// node-windows 또는 레지스트리 직접 등록
// HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
// "HanjulPosAgent" = "C:\Program Files\HanjulPOS\hanjul-pos-agent.exe"
```

---

## 7. 슈퍼관리자 UI (Agent 관리)

### FlyerAdminDashboard.tsx — POS Agent 탭

```
┌─────────────────────────────────────────────────┐
│  POS Agent 모니터링                              │
│                                                  │
│  ┌──────┬──────────┬──────┬──────┬──────────┐   │
│  │ 매장 │ POS 종류 │ 상태 │ 대기 │ 마지막   │   │
│  ├──────┼──────────┼──────┼──────┼──────────┤   │
│  │○○마트│ 투게더스 │ ✅   │ 0건  │ 2분 전   │   │
│  │△△슈퍼│ 투게더스 │ ⚠️   │ 47건 │ 35분 전  │   │
│  │□□정육│ -        │ ❌   │ -    │ 미등록   │   │
│  └──────┴──────────┴──────┴──────┴──────────┘   │
│                                                  │
│  [Agent 키 발급]  [Agent 다운로드]                │
└─────────────────────────────────────────────────┘
```

### API 추가

```
POST /api/admin/flyer/pos-agents/generate-key  — agent_key 생성
GET  /api/admin/flyer/pos-agents               — Agent 목록 (상태/마지막 싱크)
DELETE /api/admin/flyer/pos-agents/:id         — Agent 키 무효화
```

---

## 8. 개발 순서

```
Step 1: packages/pos-agent 프로젝트 초기화 (tsconfig, package.json)
Step 2: PosAdapter interface + db-detector.ts (DB 자동 감지)
Step 3: 서버 API 4종 (routes/flyer/pos.ts — register/push/heartbeat/config)
Step 4: server-client.ts (Agent → 서버 통신)
Step 5: local-cache.ts (SQLite 오프라인 큐)
Step 6: scheduler.ts (5분/10분/30분 주기 작업)
Step 7: togethers.ts Adapter (★ 실매장 DB 구조 확인 후 구현)
Step 8: tray.ts (Windows 시스템 트레이)
Step 9: pkg 빌드 → exe 생성
Step 10: 슈퍼관리자 UI (Agent 키 발급/모니터링)
Step 11: generic-csv.ts Adapter (범용 fallback)
Step 12: 실매장 파일럿 테스트
```

---

## 9. 실매장 확인 체크리스트 (개발 전 필수)

> Harold님이 투게더스 POS 매장 1곳에 원격 접속(팀뷰어)하여 확인:

- [ ] POS 설치 경로 확인 (C:\Together* 또는 D:\Together* 등)
- [ ] 설치 폴더 내 설정 파일 캡처 (.ini, .xml, .config, .json)
- [ ] DB 엔진 확인: 작업관리자에서 sqlservr.exe / fbserver.exe / mysqld.exe 프로세스 확인
- [ ] DB 접속 정보: 설정 파일에서 host/port/dbname/user/password 추출
- [ ] DB 접속 테스트: SSMS 또는 DB 클라이언트로 접속
- [ ] 테이블 목록 캡처 (전체 테이블 이름)
- [ ] 회원 테이블: `SELECT TOP 10 *` 실행 → 전화번호 원본/마스킹 여부 확인
- [ ] 판매 테이블: `SELECT TOP 10 *` 실행 → 컬럼 구조 확인
- [ ] 재고 테이블: 존재 여부 + 구조 확인

→ 캡처/결과를 Harold님이 공유해주시면 즉시 Adapter 코드 개발

---

## 10. 전화번호 마스킹 대응 전략

| DB 상태 | 대응 |
|---------|------|
| **원본 저장 (010-1234-5678)** | 그대로 수집 → 정상 |
| **가운데 마스킹 (010-1***-5678)** | 수집 불가 → 사장님에게 "POS 업체에 마스킹 해제 요청" 안내 |
| **암호화 저장 (AES 등)** | 복호화 키 필요 → POS 업체 협조 필수 |
| **DB에 없음 (클라우드만)** | POS 업체 API 제휴 or 사장님이 엑셀 내보내기 |

**예상:** 투게더스는 로컬 DB에 원본 저장 가능성 높음 (확인 필요)

---

## 11. 보안

- Agent ↔ 서버: HTTPS 필수
- agent_key: 1회 등록 후 JWT 발급 (24시간 자동 갱신)
- POS DB 접속 정보: Agent 로컬에 AES 암호화 저장 (config.enc)
- 개인정보: 주민번호/카드번호는 Agent에서 strip 후 전송
- POS DB: SELECT 권한만 (INSERT/UPDATE/DELETE 절대 금지)
