# 🤖 [AI AGENT HARNESS MASTER] Sync Agent 프로젝트 운영체제

> **목적:** 기획자(프로젝트 오너)의 의도를 왜곡 없이 구현하고, "설계→합의→구현→검증→릴리스"가 자동으로 굴러가도록 만드는 **프로젝트 운영체제(OS)**  
> **핵심:** (1) 진실의 원천(SoT) 고정 (2) 단계별 게이트(품질문) (3) 변경·결정 기록(기억) (4) 재현 가능한 디버깅

---

## 0) 사용법 (1분 세팅)
1. 이 문서를 프로젝트 루트에 `HARNESS.md`로 두고, **대화 시작 시 항상 여기만을 기준(SoT)** 으로 삼는다.
2. 작업 요청 시 오너는 아래 `CURRENT_TASK`만 갱신한다.
3. AI는 모든 응답에서 **(A) 현재 상태 요약 → (B) 다음 단계 제안 → (C) 리스크/질문 → (D) 산출물** 순서를 유지한다.

---

## 1) AI 에이전트 페르소나 & 계약

### 1-1. 역할(ROLE)
- **당신의 역할:** 15년 차 시니어 아키텍트급 Full-Stack 개발자 / Node.js+TypeScript+DB 인프라 전문 / 데이터 파이프라인·인코딩·보안 경험
- **당신의 목표:** 프로젝트 오너의 의도를 정확히 파악하고, 버그 없는 견고한 아키텍처와 유지보수가 쉬운 코드를 작성한다.
- **코드 스타일:** 불필요한 주석 최소화, 엄격한 TypeScript, SRP 준수, 명확한 네이밍

### 1-2. 불변의 운영 원칙(INVARIANTS)
- **SoT(진실의 원천)는 오직 `PROJECT STATUS` + `CURRENT_TASK`** 이다. 대화 중 떠도는 가정은 SoT에 반영되기 전까지 "임시"다.
- **범위는 `CURRENT_TASK` 밖으로 확장하지 않는다.** (필요하면 "추가 과제"로 분리해 제안만 한다.)
- **모든 의사결정은 `DECISION LOG`에 기록** 해서 흔들림/재논의를 줄인다.
- **모든 변경은 "최소 영향·가역성(rollback)"을 우선** 으로 한다.

### 1-3. 커뮤니케이션 규칙
- **항상 존댓말(경어)**을 사용한다. **반말은 금지**한다.
- 호칭은 기본적으로 **"프로젝트 오너님"** 으로 통일한다. (오너가 다른 호칭을 지정하면 그에 따른다.)
- 오너의 지시/요구사항을 최우선으로 존중하되, **안전·법률·정책에 위배되는 요청은 수행하지 않고** 가능한 범위의 **대안/옵션**을 제시한다.

---

## 2) ⚠️ 절대 개발 원칙 (CRITICAL RULES)

1. **묻기 전엔 절대 코드를 짜지 마라**  
   반드시 **현황 파악 → 설계안 제시 → 합의(결정 기록) → 구현 → 검증** 순서로 진행한다.

2. **추측성 땜질 금지 / 에러 대응 프로토콜(SELF-CORRECTION)**  
   - 에러가 발생하면 임의로 코드를 덧붙이지 않는다.
   - 1단계: **에러 로그 / 재현 절차 / 기대 결과 / 실제 결과**를 요구한다.
   - 2단계: 원인을 **3줄 이내로 요약** 한다.
   - 3단계: **2가지 이상 해결 옵션**(장단점/리스크/소요) 제시 후 오너 선택을 기다린다.
   - 4단계: 선택된 옵션으로 **최소 수정 → 회귀 테스트** 까지 수행한다.

3. **수정 파일 제공 방식**  
   파편화된 코드 조각이 아닌, 바로 덮어쓸 수 있는 **완성된 단일 파일 전체**로 제공한다.  
   (예외: "핵심 diff만"을 오너가 명시 요청한 경우)

4. **가정 관리(ASSUMPTION LEDGER)**  
   불확실한 정보는 "사실"로 말하지 말고, **가정 목록에 등록** 한 뒤 확인 질문을 남긴다.

---

## 3) 표준 작업 흐름(Workflow)

### 3-1. 전체 파이프라인(기본)
1) **INTAKE(요청 접수)** → 2) **DISCOVERY(현황 파악/제약 확인)** →  
3) **DESIGN(설계안/선택지 제시)** → 4) **AGREEMENT(결정/합의 기록)** →  
5) **IMPLEMENT(구현)** → 6) **VERIFY(검증/테스트)** → 7) **RELEASE(배포/정리)**

### 3-2. 경량화(HOTFIX) 트랙

**조건:** 오너가 요청에 `[HOTFIX]` 태그를 명시하고, 저위험 변경인 경우에만 적용.  
**흐름:** `IMPLEMENT → VERIFY → RELEASE` (1~4단계 암묵 합의)

### 3-3. 단계별 게이트 체크리스트

#### (1) INTAKE 게이트
- [ ] 현재 목표가 `CURRENT_TASK`에 한 문장으로 명시되었는가?
- [ ] "완료 기준(DoD)"가 체크박스로 존재하는가?
- [ ] 입력/출력/권한/데이터 등 **핵심 제약**이 적어도 3개 이상 적혀 있는가?

#### (2) DISCOVERY 게이트
- [ ] 관련 파일/폴더/DB 테이블/환경변수 목록이 확인되었는가?
- [ ] 기존 동작(AS-IS)과 원하는 동작(TO-BE)이 분리되어 기술되었는가?
- [ ] 실패 시나리오(에러/엣지 케이스) 최소 5개가 나열되었는가?

#### (3) DESIGN 게이트
- [ ] 선택지가 2개 이상이며, 각 선택지의 리스크/비용이 명시되었는가?
- [ ] 영향 범위(수정 파일/테이블)가 명확한가?

#### (4) AGREEMENT 게이트
- [ ] 채택된 선택지가 `DECISION LOG`에 기록되었는가?
- [ ] 롤백(되돌리기) 전략이 있는가?

#### (5) IMPLEMENT 게이트
- [ ] 타입/린트/빌드가 통과하는가?

#### (6) VERIFY 게이트
- [ ] DoD 체크박스가 전부 "증거"와 함께 체크되었는가?
- [ ] 회귀 테스트 수행했는가?

#### (7) RELEASE 게이트
- [ ] 릴리스 노트 작성했는가?
- [ ] 롤백 스위치가 준비되어 있는가?

---

## 4) 산출물(Artifacts)

### 4-1. ADR(결정 기록) 템플릿
```md
## ADR-YYYYMMDD-XX: [결정 제목]
- 상태: 제안/승인/폐기
- 맥락: 왜 이 결정이 필요한가?
- 선택지:
  1) A안: 장점 / 단점 / 리스크
  2) B안: 장점 / 단점 / 리스크
- 결정: (채택한 안)
- 근거: (왜 이 안인가?)
- 영향 범위: (파일/테이블/엔드포인트)
- 롤백: (되돌리는 방법)
```

### 4-2. 이슈(버그) 리포트 템플릿
```md
## BUG: [한 줄 요약]
- 기대 결과:
- 실제 결과:
- 재현 절차(1~n):
- 환경:
- 에러 로그/스크린샷:
- 영향도: Blocker/Critical/Major/Minor
```

---

## 4-9) 📐 한줄로 필드 체계 SoT (항상 이 표 기준)

> **원본 SoT:** `packages/backend/src/utils/standard-field-map.ts` (한줄로 리포)  
> **최종 동기화:** 2026-04-17 (v1.4.1 기준)  
> **변경 시:** 원본이 바뀌면 즉시 SyncAgent setup-html.ts `CUSTOMER_FIELDS`도 동기화

### 📊 전체 개수

| 구분 | 개수 | storageType | 비고 |
|------|------|-------------|------|
| **고정 필드** | **21개** | `column` | 실제 DB customers 테이블 직접 컬럼 |
| **커스텀 슬롯** | **15개** | `custom_fields` | custom_1 ~ custom_15 (JSONB) |
| **매핑 가능 총계** | **36개** | — | getColumnFields() + getCustomFields() |

### 📋 고정 필드 21개 (카테고리별)

**basic (기본정보) — 8개**
1. `name` (고객명)
2. `phone` (고객전화번호) ★필수
3. `gender` (성별)
4. `age` (나이)
5. `birth_date` (생일)
6. `email` (이메일주소)
7. `address` (주소)
8. `region` (지역)

**purchase (구매정보) — 5개**
9. `recent_purchase_store` (최근구매매장)
10. `recent_purchase_amount` (최근구매금액)
11. `total_purchase_amount` (누적구매금액)
12. `purchase_count` (구매횟수)
13. `recent_purchase_date` (최근구매일)

**store (매장/등록정보) — 5개**
14. `store_code` (브랜드)
15. `registration_type` (등록구분)
16. `registered_store` (등록매장정보)
17. `store_phone` (매장전화번호)
18. `store_name` (매장명)

**membership (등급/포인트) — 2개**
19. `grade` (고객등급)
20. `points` (보유포인트)

**marketing (수신동의) — 1개**
21. `sms_opt_in` (수신동의여부)

### 📋 커스텀 슬롯 15개
`custom_1` ~ `custom_15` — customers 테이블의 `custom_fields` JSONB 컬럼 내부 키. 고객사별 라벨은 `customer_field_definitions` 테이블에서 관리.

### ⚠️ 매핑 대상 아닌 컬럼 (DB 스키마 한정)
DB `customers` 테이블에는 다음도 존재하지만 **매핑 드롭다운에는 포함하지 않음**:
- 파생: `birth_year`, `birth_month_day`
- 분석: `ltv_score`, `avg_order_value`
- 상태: `is_opt_out`, `is_invalid`, `is_active`
- 레거시: `total_purchase`, `last_purchase_date`, `wedding_anniversary`, `is_married`
- 시스템: `callback`, `source`, `uploaded_by`, `created_at`, `updated_at`, `company_id`, `id`

### 🔗 참조 경로
- 한줄로 백엔드: `packages/backend/src/utils/standard-field-map.ts` 그 안 FIELD_MAP
- 한줄로 컨트롤타워 함수: `getColumnFields()`, `getCustomFields()`
- SyncAgent 반영 지점: `src/setup/setup-html.ts` 의 `CUSTOMER_FIELDS` 배열

---

## 5) 🎯 CURRENT_TASK — v1.4.0 테스트

> **규칙:** AI는 아래 목표에만 100% 리소스를 집중한다.

- **현재 목표:** v1.4.0 재빌드 완료 (BUG-012/013/014 수정). 실 데이터 테스트 대기 중.
- **정의(한 줄):** 한줄로 DB 동적 전환(D39~D48) 반영 — 표준 필드 17개 + custom_fields JSONB 15슬롯 체계 적용
- **완료 기준 (DoD):**
  - [x] tsc 빌드 에러 0개
  - [x] build:all (esbuild → pkg) 성공 — exe 109MB + Linux bin 122MB
  - [x] NSIS 설치파일 빌드 — SyncAgent-Setup-1.4.0.exe (19MB)
  - [x] NSIS 설치 로그 한글 깨짐 해결 (BUG-012)
  - [x] 웹 설치 마법사 "Not Found" 해결 (BUG-013)
  - [ ] 기존 테스트 DB (20만+50만) 동기화 100% 성공 유지
  - [ ] 신규 필드 4개 + custom_fields JSONB 서버 저장 확인
  - [ ] store_code UNIQUE 키 정상 동작 확인
  - [ ] field-definitions API 등록 확인
  - [ ] 한글 인코딩 깨짐 없음 확인 (needsEncodingFix 자동 감지)

---

## 6) 📌 PROJECT STATUS (진실의 원천)

### 6-1. 프로젝트 개요
- **프로젝트명**: Sync Agent (싱크 에이전트)
- **한 줄 정의**: 고객사 로컬 DB(POS/ERP) → 한줄로 서버(hanjul.ai)로 고객/구매 데이터 자동 동기화
- **회사**: INVITO (인비토) / 대표: Harold
- **상위 서비스**: 한줄로 (Target-UP) — AI 기반 SMS/LMS 마케팅 자동화 플랫폼
- **배포 형태**: Windows exe(18MB NSIS 설치파일) + Linux zip — 고객사 PC/서버에 설치
- **최신 버전**: v1.4.0 (2026-03-15) — 재빌드 완료 (BUG-012/013/014 수정), 테스트 대기
- **핵심 가치**: 고객사가 별도 작업 없이, 자사 DB의 고객·구매 데이터가 자동으로 한줄로에 반영
- **범위 밖**: 양방향 동기화, AI 컬럼 매핑(LLM), 동기화 필터 — 향후 고도화 과제

### 6-2. 기술 스택
| 영역 | 기술 | 비고 |
|------|------|------|
| 언어 | Node.js + TypeScript | 한줄로와 동일 스택 |
| 빌드/번들링 | esbuild + @yao-pkg/pkg | TS→JS 번들(3.3MB) → 단일 exe |
| 설치 마법사 | Express 웹 UI (Windows) / readline CLI (Linux) | OS 자동 감지 분기 |
| DB 드라이버 | mssql, mysql2, oracledb, pg | 6종 DB 지원 |
| 파일 커넥터 | xlsx, papaparse | Excel/CSV 대응 |
| 로컬 큐 | sql.js (순수 JS SQLite) | 오프라인 큐 |
| HTTP 클라이언트 | axios | API 호출 |
| 스케줄러 | node-cron | 동기화 주기 관리 |
| 암호화 | crypto (내장) | AES-256-GCM, PBKDF2 |
| 로깅 | winston + daily-rotate-file | 일별 로테이션, 민감정보 마스킹 |
| 검증 | zod | 스키마 기반 유효성 검증 |
| 설치 프로그램 | NSIS | Windows 전용, 한글 UI |

### 6-3. 전체 아키텍처

```
[고객사 환경]                          [INVITO 서버]
┌─────────────────┐                   ┌─────────────────────────┐
│  POS / ERP DB   │                   │  hanjul.ai (한줄로)      │
│  (MSSQL/MySQL/  │  ── Sync Agent ──▶│                         │
│   Oracle/기타)  │     HTTPS 전송     │  /api/sync/*            │
└─────────────────┘                   │  PostgreSQL (customers,  │
                                      │  purchases 테이블)       │
┌─────────────────┐                   │                         │
│  Sync Agent     │  ◀── 상태 확인 ──│  sys.hanjullo.com       │
│  (Win/Linux)    │     원격 모니터링  │  (슈퍼관리자 대시보드)   │
└─────────────────┘                   └─────────────────────────┘
```

### 6-4. 데이터 흐름
1. Sync Agent가 고객사 로컬 DB에 주기적으로 접속 (읽기 전용)
2. 변경된 데이터 감지 (증분 동기화, 테이블별 timestamp 컬럼 사용)
3. 컬럼 매핑 (autoSuggestMapping) → 표준 17개 + 미매핑 컬럼은 custom_1~15 슬롯 자동 배정
4. 데이터 정규화 (전화번호/성별/날짜/금액/지역/등급/이메일)
5. custom 슬롯 매핑 값을 custom_fields JSONB 객체로 구성
6. Zod 스키마 검증 → HTTPS로 한줄로 API에 배치 전송 (최대 5,000건/배치)
7. 한줄로가 customers/purchases 테이블에 UPSERT (파생 필드 서버 자동 계산)
8. 최초 동기화 시 커스텀 필드 라벨을 field-definitions API로 서버 등록
9. 동기화 결과를 Agent 로컬 로그 + 서버에 보고

### 6-5. API 엔드포인트 (전체 구현 완료 — v1.4.0: 8개)

```
POST /api/sync/customers           ← 고객 데이터 벌크 UPSERT (최대 5,000건/배치)
POST /api/sync/purchases           ← 구매내역 벌크 INSERT
POST /api/sync/heartbeat           ← Agent 상태 보고
POST /api/sync/log                 ← 동기화 결과 로그 전송
POST /api/sync/register            ← Agent 최초 등록
POST /api/sync/field-definitions   ← 🆕 커스텀 필드 라벨 등록 (v1.4.0)
GET  /api/sync/config              ← Agent 설정 원격 조회
GET  /api/sync/version             ← Agent 버전 확인
```

### 6-6. 프로젝트 구조

```
C:\projects\sync-agent\
├── package.json / tsconfig.json / esbuild.config.js
├── .env / .env.example / .env.test
├── data/                       # 런타임 (sync_state.json, queue.db, config.enc, agent.key)
├── logs/                       # 일별 로그
├── release/                    # 빌드 출력 (exe, bin, zip, wasm)
├── installer/                  # NSIS 설치 프로그램
└── src/
    ├── main.ts                 # 진입점 (--setup/--edit-config/--show-config → OS감지 분기)
    ├── index.ts                # Agent 메인 오케스트레이션
    ├── config/                 # 설정 로더 + AES-256 암호화 + loadConfigDecrypted/updateConfigEncrypted
    ├── db/                     # DB 커넥터 (mssql, mysql, oracle, pg, excel-csv, mock)
    ├── normalize/              # 데이터 정규화 (phone, gender, date, amount, region, grade, email)
    ├── mapping/                # 컬럼 매핑 + autoSuggestMapping + custom_1~15 슬롯 배정
    ├── api/                    # ApiClient + 인증 + 재시도
    ├── sync/                   # SyncEngine + SyncState (테이블별 timestamp 컬럼 지원)
    ├── queue/                  # 오프라인 큐 (sql.js SQLite)
    ├── heartbeat/              # 5분 주기 상태 보고
    ├── updater/                # 자동 업데이트 (다운로드→체크섬→교체→재시작)
    ├── alert/                  # 이메일 알림 (오프라인/장애)
    ├── scheduler/              # node-cron 스케줄러 + 원격 설정 폴링
    ├── setup/                  # 설치 마법사 (server.ts 웹 / cli.ts CLI / edit-config.ts 설정편집)
    ├── service/                # OS 서비스 관리 (sc.exe / systemd)
    ├── logger/                 # winston + 민감정보 마스킹
    └── types/                  # Zod 스키마 (customer, purchase, sync, api)
```

### 6-7. CLI 명령어 레퍼런스 (v1.4.0)

```
sync-agent                     → Agent 실행 (설정 없으면 자동 마법사)
sync-agent --setup             → 설치 마법사 (OS 자동 감지)
sync-agent --setup-web         → 설치 마법사 강제 웹 UI
sync-agent --setup-cli         → 설치 마법사 강제 CLI
sync-agent --edit-config       → 설정 편집 (대화형 CLI)
sync-agent --show-config       → 현재 설정 조회 (민감정보 마스킹)
sync-agent --install-service   → OS 서비스 등록
sync-agent --uninstall-service → OS 서비스 제거
sync-agent --service-status    → 서비스 상태 확인
```

### 6-8. 테스트 인프라

| 항목 | 값 |
|------|-----|
| 테스트 DB | Docker MySQL 8.0 (localhost:3307, container: sync-test-mysql) |
| DB명 | customer_db (synctest / synctest123) |
| 테이블 | TB_MEMBER (200,000건), TB_ORDER_HISTORY (500,000건) |
| 전화번호 | 010-0131-xxxx 시리즈 (가짜번호 — SMS 오발송 방지) |
| 한줄로 테스트 계정 | company_id: 081000cc-ea67-4977-836c-713ace42e913 |
| API Key | test-sync-api-key-001 / test-sync-api-secret-001 |
| TB_MEMBER timestamp 컬럼 | UPD_DT |
| TB_ORDER_HISTORY timestamp 컬럼 | ORD_DT (⚠️ UPD_DT 아님!) |

---

## 7) 작업 완료 현황

### ✅ Phase 1~4: 기반 + 코어 + 설치 + 원격 모니터링 (완료)
- Agent 코어 파이프라인: DB 접속 → 증분 감지 → 정규화 → 매핑 → API 전송
- 한줄로 서버 API 7개 + Admin API 5개 전체 연결 완료
- 설치 마법사 웹 UI + CLI 마법사 구현
- 슈퍼관리자 대시보드 Sync 모니터링 탭 구현 (비토 작업)
- 오프라인 내성 검증 (서버 다운 → 로컬 큐 → 복구 시 자동 재전송)
- Windows 서비스(sc.exe) + Linux 서비스(systemd) 등록

### ✅ Phase 5: 고도화 (완료)
- DB 지원 확대: Oracle(thin 모드), PostgreSQL, Excel/CSV 추가
- 자동 업데이트: SHA-256 검증 → exe/bin 교체 → 재시작
- 듀얼 OS: Windows exe(110MB) + Linux bin(124MB)
- AES-256-GCM 설정 암호화 + config.json→enc 자동 마이그레이션
- AlertManager: Heartbeat 3회/동기화 5회/DB 장애 시 이메일 알림

### ✅ Phase 6: CLI 마법사 & 배포 (완료 — 2026-02-14)
- CLI 설치 마법사: Node.js readline (외부 의존성 없음, pkg 100% 호환)
- OS 자동 감지: --setup → Windows=웹, Linux=CLI
- 최종 산출물: NSIS 설치파일 18MB + Linux zip 37MB

### ✅ Phase 7: 실 데이터 테스트 (완료 — 2026-02-25)
- [x] 20만 고객 + 50만 구매 테스트 데이터 생성
- [x] 배치 크기 이슈 해결: 서버 배치 제한 1000→5000건 상향 (비토 작업)
- [x] templates.ts 매핑 패턴 대량 추가: MBR_HP, MBR_NM, GRD_CD, LST_BUY_DT 등
- [x] templates.ts 구문 에러 수정: 135줄 `{ {` → `{`
- [x] 동기화 성공: 고객 200,000/200,000 + 구매 500,000/500,000 (100%)
- [x] **한글 인코딩 깨짐 해결 (BUG-007)** — cp1252 역매핑 + needsEncodingFix 강제 true
- [x] **테이블별 timestamp 컬럼 분리 (BUG-010)** — customerTimestampColumn / purchaseTimestampColumn 스키마 추가 + --edit-config로 수정
- [x] **서버 API 500 에러 해결 (BUG-008/009)** — 비토: sync_logs DDL 수정 + sync_releases 테이블 생성
- [x] **--edit-config 설정 편집 CLI 추가** — config.enc 부분 수정 + 재암호화 저장
- [x] **최종 빌드 v1.3.0** — SyncAgent-Setup-1.3.0.exe (18MB)

### 🔄 Phase 8: 한줄로 DB 동적 전환 반영 — v1.4.0 (진행 중 — 2026-03-07)

**배경:** 한줄로 서버가 2026-02-26~27(D39~D48)에서 DB 동적 전환 전면 단행.
customers 테이블이 표준 필드 17개 + custom_fields(JSONB) 15슬롯 체계로 변경.
서버 sync.ts는 비토가 이미 수정 완료 (FIELD_MAP 기반 동적 INSERT, 파생 필드 자동 계산).

**Agent 수정 내용 (13개 파일, tsc 통과 완료):**

- [x] **Zod customerSchema 확장** — store_phone 필드 추가 (types/customer.ts)
- [x] **autoSuggestMapping 패턴 추가** — store_phone, registration_type(REG_GB), registered_store, recent_purchase_store(RCT_STORE/RECENT_STORE) 4개 신규 패턴 + store_code priority 120 상향 (mapping/templates.ts)
- [x] **custom_fields 자동 배정** — assignCustomFieldSlots() 함수: 표준 17개 미매핑 컬럼 → custom_1~15 슬롯 배정, 최대 15개, 초과 시 warn (mapping/templates.ts)
- [x] **custom_fields JSONB 구성** — mapRow()에서 custom_N 매핑 필드를 custom_fields 객체로 수집 (mapping/index.ts)
- [x] **config 스키마 확장** — customFieldLabels: z.record().default({}) 추가 (config/schema.ts)
- [x] **field-definitions API** — POST /api/sync/field-definitions 엔드포인트 + registerFieldDefinitions() 메서드 (api/endpoints.ts, api/client.ts, types/api.ts)
- [x] **field-definitions 등록** — 최초 동기화 시 커스텀 라벨 서버 등록, fieldDefinitionsRegistered 플래그로 중복 방지 (index.ts, types/sync.ts, sync/state.ts)
- [x] **email 정규화** — trim + lowercase (normalize/index.ts)
- [x] **store_phone 정규화** — trim (normalize/index.ts)
- [x] **CLI 마법사** — Step 4에 커스텀 슬롯 자동 배정 결과 표시 + 라벨 수정 기능 (setup/cli.ts)
- [x] **edit-config** — 커스텀 필드 라벨 표시 + 편집 지원 (setup/edit-config.ts)
- [x] **needsEncodingFix 자동 감지** — 기존 verifyDoubleEncoding() 확인 완료 (mysql.ts에 이미 구현됨)
- [x] **TS 빌드 에러 수정** — DbType 불일치(excel-csv→excel, postgresql→postgres), 누락 필드(delimiter/encoding/watchMode/maxFiles/maxSize), execFile→spawn (cli.ts, updater/index.ts)
- [x] build:all (esbuild → pkg) 성공 — sync-agent.exe (113MB) + sync-agent Linux bin (127MB)
- [x] NSIS 설치파일 빌드 — SyncAgent-Setup-1.4.0.exe (18MB)
- [x] **NSIS 한글 깨짐 수정 (BUG-012)** — nsExec::ExecToLog→ExecToStack 변경, DetailPrint로 한글 직접 출력
- [x] **웹 설치 마법사 Not Found 수정 (BUG-013)** — HTML을 setup-html.ts에 인라인 임베드 (pkg exe 호환)
- [x] **age 정수 정규화 추가 (BUG-014)** — intFields에 age 추가 (POS 문자열 나이 대응)
- [x] v1.4.0 재빌드 (2026-03-15) — exe 109MB + Linux 122MB + NSIS 19MB
- [ ] 실 데이터 테스트 (20만+50만 동기화 + 신규 필드 + custom_fields 확인)
- [ ] 테스트 완료 후 v1.4.0 릴리스

---

## 8) 발견된 이슈

### 🟡 활성 이슈 (미해결)

| ID | 이슈 | 상태 | 비고 |
|----|------|------|------|
| CHK-001 | POST /api/sync/field-definitions 인증 방식 확인 | ⬜ 미확인 | 기존 api_key/api_secret 헤더와 동일한지 비토 확인 필요 |

### ✅ 해결 완료

| ID | 이슈 | 원인 | 해결 |
|----|------|------|------|
| BUG-014 | age 필드가 POS에서 문자열로 올 때 정수 변환 안 됨 | intFields 배열에 age 미포함 | intFields에 'age' 추가 (normalize/index.ts) |
| BUG-013 | 웹 설치 마법사 localhost:9876 "Not Found" | server.ts가 express.static(파일경로)로 HTML 서빙 → esbuild→pkg 번들에 HTML 파일 미포함 | HTML을 setup-html.ts에 인라인 임베드, res.type('html').send(SETUP_HTML)로 직접 응답 |
| BUG-012 | NSIS 설치 로그에 한글이 깨져서 표시 | nsExec::ExecToLog가 exe의 UTF-8 콘솔 출력을 제대로 표시 못함 | nsExec::ExecToStack + Pop $1로 stdout 무시, DetailPrint로 한글 메시지 직접 출력 |
| BUG-011 | v1.4.0 tsc 빌드 에러 6개 (cli.ts 5개 + updater 1개) | cli.ts: DbType 값 불일치(excel-csv/postgresql), config 구성 시 누락 필드. updater: execFile 타입 불일치 | DbType 값 정정(excel→excel, postgres→postgres), config에 delimiter/encoding/watchMode/maxFiles/maxSize 추가, execFile→spawn 변경 |
| BUG-010 | TB_ORDER_HISTORY timestamp 컬럼이 ORD_DT인데 config.enc에 UPD_DT로 설정 | 스키마에 timestampColumn 하나로 두 테이블 공유 | 테이블별 customerTimestampColumn / purchaseTimestampColumn 분리 + --edit-config로 수정 (ADR-20260225-01) |
| BUG-009 | GET /api/sync/version 500 에러 | sync_releases 테이블 미생성 | 비토: 테이블 생성 완료 (version, download_url, checksum 등) |
| BUG-008 | POST /api/sync/log 500 에러 | sync_logs 테이블에 duration_ms, error_message 컬럼 누락 | 비토: DDL로 컬럼 2개 추가 완료 |
| BUG-007 | 한글 인코딩 깨짐 (name, region 등) | 이중 인코딩: POS가 latin1 커넥션으로 UTF-8 전송 → MySQL이 cp1252→utf8mb4 재인코딩 | cp1252 역매핑 테이블로 JS에서 직접 복원 + needsEncodingFix=true 강제 (ADR-20260224-02) |
| BUG-001 | 증분 동기화 반복 전송 | UTC ISO → MySQL 로컬 시간 해석 | `toLocaleString('sv-SE', {timeZone:'Asia/Seoul'})` |
| BUG-002 | scheduler.ts 구문 오류 | JSDoc 내 `*/30`이 주석 종료로 해석 | `//` 주석으로 변경 |
| BUG-003 | STORE_NM 자동매핑 오류 | NM이 name 규칙에 걸림 | 우선순위 기반 규칙 (compound 150 > fallback 10) |
| BUG-004 | sendLog 400 에러 | camelCase vs snake_case | snake_case 변환 추가 |
| BUG-005 | templates.ts 구문 에러 | 135줄 `{ {` 중괄호 중복 | `{` 하나로 수정 |
| BUG-006 | 배치 5000건 → 서버 1000건 제한 | 서버 배치 제한 | 서버 5000건으로 상향 (비토) |

---

## 9) AI 응답 포맷(항상 동일하게)

AI는 매 응답을 아래 순서로 작성한다.

1) **상태 스냅샷**: 현재 SoT 기준으로 "무엇이 확정/미확정인지" 5줄 이내  
2) **다음 단계 제안**: 지금 단계(INTAKE/DISCOVERY/...)와 다음 산출물  
3) **리스크 & 질문**: 가정/불확실성/결정 필요한 포인트  
4) **산출물**: (설계안/체크리스트/파일 전체/테스트 플랜 등)

---

## 10) DECISION LOG (ADR Index)

### ADR-20260307-01: v1.4.0 — 한줄로 DB 동적 전환 반영 (표준 17개 + custom_fields JSONB)
- 상태: **승인**
- 맥락: 한줄로 서버가 D39~D48(2026-02-26~27)에서 customers 테이블을 표준 필드 17개 + custom_fields(JSONB) 15슬롯 체계로 전면 변경. UNIQUE 키도 `(company_id, COALESCE(store_code,'__NONE__'), phone)`으로 변경. Sync Agent v1.3.0의 페이로드와 서버가 불일치 상태.
- 선택지:
  1) A안: 서버에 호환 레이어 추가 (v1.3.0 페이로드를 서버에서 변환)
  2) B안: Sync Agent를 직접 수정하여 새 서버 스펙에 맞춤
- 결정: **B안**
- 근거: 상용화 전이므로 Agent를 올바른 스펙으로 맞추는 것이 장기적으로 깔끔. 서버 sync.ts는 이미 비토가 수정 완료.
- 영향 범위: 13개 파일 (types/customer.ts, types/api.ts, types/sync.ts, api/endpoints.ts, api/client.ts, config/schema.ts, mapping/templates.ts, mapping/index.ts, normalize/index.ts, sync/state.ts, index.ts, setup/cli.ts, setup/edit-config.ts) + 빌드 에러 수정 (setup/cli.ts, updater/index.ts)
- 롤백: v1.3.0 src 백업에서 복원. customFieldLabels 미존재 시 Zod default로 자동 폴백.

### ADR-20260225-01: 테이블별 timestamp 컬럼 분리 + --edit-config CLI
- 상태: **승인**
- 맥락: TB_MEMBER는 UPD_DT, TB_ORDER_HISTORY는 ORD_DT를 사용하는데, 스키마에 timestampColumn이 하나여서 구매 테이블 증분 동기화 실패 (BUG-010)
- 선택지:
  1) A안: config.enc 삭제 후 CLI 재설정 — 확실하지만 전체 재입력 필요
  2) B안: 스키마 확장 (customerTimestampColumn/purchaseTimestampColumn) + --edit-config 부분 수정 CLI
- 결정: **B안**
- 근거: 향후 고객사 운영에서도 설정 부분 수정이 반드시 필요 (R5 리스크 해소). 하위호환 유지 (기존 config.enc 그대로 동작)
- 영향 범위: src/config/schema.ts, src/config/index.ts, src/sync/engine.ts, src/index.ts, src/main.ts, src/setup/cli.ts, src/setup/edit-config.ts (신규)
- 롤백: customerTimestampColumn/purchaseTimestampColumn 미지정 시 기존 timestampColumn 폴백

### ADR-20260224-01: 한글 인코딩 — charset:'utf8mb4' 추가 시도
- 상태: **폐기**
- 맥락: MySQL character_set_client=latin1 → Agent charset 미지정으로 깨짐 추정
- 선택지: 1) charset:'utf8mb4' + SET NAMES 추가  2) charset 제거
- 결정: 1안 시도 → 실패, 2안 시도 → 실패
- 근거: 둘 다 실패. 근본 원인은 이중 인코딩이었음
- 영향 범위: src/db/mysql.ts
- 롤백: charset:'utf8mb4'로 원복 (원래 상태)

### ADR-20260224-02: 한글 인코딩 — cp1252 역매핑 + 강제 보정 모드
- 상태: **승인**
- 맥락: MySQL 이중 인코딩(Double Encoding) 확정. POS 앱이 latin1 커넥션으로 UTF-8 바이트 전송 → MySQL이 cp1252로 해석 → utf8mb4 테이블에 재인코딩. HEX 진단으로 확정 (`정` = C3ACC2A0E280A2, 7바이트 — 정상은 ECA095, 3바이트)
- 선택지:
  1) A안: charset 자동 감지 로직 (ratio 기반) → **실패** (ratio 계산 오류, global charset 불일치)
  2) B안: needsEncodingFix=true 강제 + cp1252 역매핑
- 결정: **B안** (Gemini 제안 수용)
- 근거: fix 함수 자체는 test-encoding.js로 2회 검증 통과. 감지 로직이 매번 실패 원인. 강제 true가 가장 확실
- 영향 범위: src/db/mysql.ts — CP1252_TO_BYTE 역매핑 테이블 + fixDoubleEncodedString 함수 + fixRowEncoding (fetchIncremental, fetchAll 적용)
- 롤백: needsEncodingFix=false로 변경 (정상 utf8mb4 DB에서는 false)
- 향후: 실제 고객사 배포 시 자동 감지 로직 추가 검토 (정상 DB에서 불필요한 fix 방지)

---

## 11) ASSUMPTION LEDGER (가정 목록)

- **A1:** ~~MySQL 소스 DB의 실제 저장 인코딩이 utf8mb4라고 가정~~ → **확인 완료**: utf8mb4 테이블에 이중 인코딩으로 저장됨 (HEX 검증)
- **A2:** ~~Agent 메모리에서 한글이 깨진 상태로 읽히고 있다고 가정~~ → **확인 완료**: utf8mb4 연결 시 mojibake 상태로 읽힘 (mysql2가 이중 인코딩된 데이터를 그대로 전달)
- **A3:** ~~pkg exe 바이너리가 인코딩에 영향을 준다고 가정~~ → **확인 완료**: pkg 무관, 소스 node 실행에서도 동일
- **A4:** ~~로그의 한글 깨짐이 콘솔 인코딩 문제가 아닌 실제 데이터 문제라고 가정~~ → **확인 완료**: 실제 데이터 문제 맞음
- **A5:** ~~needsEncodingFix=true 강제 설정이 정상 utf8mb4 DB(이중 인코딩 아닌)에서 문제를 일으킬 수 있음~~ → **해결됨** (v1.4.0: verifyDoubleEncoding() 자동 감지로 정상 DB에서 false 반환)
- **A6:** ~~TB_ORDER_HISTORY의 timestamp 컬럼이 ORD_DT → config.enc 재설정 또는 CLI 재실행 필요~~ → **확인 완료**: --edit-config로 해결. 스키마에 테이블별 timestamp 분리 완료
- **A7:** POST /api/sync/field-definitions 인증이 기존 sync API와 동일 (api_key + api_secret 헤더) → **미확인** (비토 확인 필요)

---

## 12) RISK REGISTER (리스크 목록)

| ID | 리스크 | 확률(1-5) | 영향(1-5) | 점수 | 대응 |
|----|--------|-----------|-----------|------|------|
| R1 | ~~한글 깨짐이 mysql2 드라이버 + latin1 서버 조합의 근본 버그~~ | - | - | - | **해결됨** (cp1252 역매핑) |
| R2 | 고객사 실제 POS DB도 charset 혼합일 가능성 | 4 | 5 | 20 | needsEncodingFix 강제 true로 대응 중. 향후 자동 감지 고도화 필요 |
| R3 | ~~pkg exe 환경에서 Node.js 인코딩 동작이 다를 가능성~~ | - | - | - | **해결됨** (pkg 무관 확인) |
| R4 | ~~needsEncodingFix=true 강제 시 정상 DB에서 오히려 깨질 가능성~~ | - | - | - | **해결됨** (v1.4.0: verifyDoubleEncoding() 자동 감지 — 정상 DB는 false) |
| R5 | ~~config.enc 암호화로 인해 설정 변경이 어려움~~ | - | - | - | **해결됨** (--edit-config CLI 추가) |
| R6 | custom_fields 슬롯 배정 순서가 고객사마다 달라질 수 있음 | 2 | 2 | 4 | config.enc에 매핑 고정 저장 → 재실행 시 동일 매핑 유지 |
| R7 | v1.3.0 config.enc와 v1.4.0 호환성 | 1 | 3 | 3 | customFieldLabels 미존재 시 Zod default({}) 폴백 → 하위호환 유지 |

---

## 13) DONE LOG (완료 기록)

- 2026-02-09: 프로젝트 초기 설정 + 아키텍처 설계 완료
- 2026-02-10: Agent 코어 파이프라인 E2E 테스트 성공 (10/10건)
- 2026-02-10: exe 빌드 + 설치 마법사 웹 UI 구현
- 2026-02-11: Phase 3~4 완료 (암호화, 서비스 등록, 원격 모니터링)
- 2026-02-11: Phase 5 완료 (Oracle/PG/Excel, 자동업데이트, 듀얼OS, 알림)
- 2026-02-14: Phase 6 완료 (CLI 마법사, NSIS 설치파일, Linux zip)
- 2026-02-24: templates.ts 매핑 패턴 대량 추가 + 구문 에러 수정
- 2026-02-24: 20만+50만 동기화 100% 성공 (배치 제한 5000건 상향)
- 2026-02-24: **BUG-007 한글 인코딩 해결** — 이중 인코딩(Double Encoding) 근본 원인 확정 + cp1252 역매핑 + 강제 보정 모드로 해결
- 2026-02-25: **BUG-010 해결** — 테이블별 timestamp 컬럼 분리 (customerTimestampColumn / purchaseTimestampColumn)
- 2026-02-25: **--edit-config CLI 추가** — config.enc 부분 수정 + 재암호화 저장 기능
- 2026-02-25: **BUG-008/009 해결** — 비토: sync_logs DDL 수정 + sync_releases 테이블 생성
- 2026-02-25: **Phase 7 완료** — 고객 200,000/200,000 + 구매 500,000/500,000 전체 동기화 100% 성공
- 2026-02-25: **v1.3.0 최종 빌드** — SyncAgent-Setup-1.3.0.exe (18MB) + Linux bin (127MB)
- 2026-03-07: **v1.4.0 코드 수정 완료** — 한줄로 DB 동적 전환(D39~D48) 반영, 13개 파일 수정
- 2026-03-07: **서버 sync.ts 수정 완료 (비토)** — FIELD_MAP 기반 동적 INSERT, 파생 필드 자동 계산, field-definitions API
- 2026-03-07: **tsc 빌드 에러 해결 (BUG-011)** — DbType 불일치 + 누락 필드 + execFile 타입 수정
- 2026-03-07: **v1.4.0 빌드 완료** — esbuild → pkg (exe 113MB + Linux 127MB) + NSIS (SyncAgent-Setup-1.4.0.exe 18MB)
- 2026-03-15: **BUG-012 해결** — NSIS 설치 로그 한글 깨짐 (nsExec::ExecToStack + DetailPrint)
- 2026-03-15: **BUG-013 해결** — 웹 설치 마법사 Not Found (HTML 인라인 임베드 — pkg exe 호환)
- 2026-03-15: **BUG-014 해결** — age 정수 정규화 추가 (intFields)
- 2026-03-15: **v1.4.0 재빌드** — exe 109MB + Linux 122MB + NSIS 19MB

---

## 14) 교훈 & 회고

### 한글 인코딩 디버깅 회고 (2026-02-24)
- **근본 원인:** MySQL 이중 인코딩 (POS→latin1 커넥션→utf8mb4 테이블)
- **진단 핵심:** `SELECT HEX(MBR_NM)` 으로 실제 바이트 확인 → 3바이트(정상) vs 7바이트(이중 인코딩) 판별
- **해결:** cp1252 역매핑 테이블 (MySQL latin1 ≠ Node.js latin1)
- **실수:** charset 자동 감지 로직에 집착 (ratio 계산 오류, global charset 불일치 등). Gemini의 "강제 보정 모드" 제안을 즉시 수용했어야 함
- **교훈:**
  1. fix 함수가 검증 통과했으면, 감지 로직보다 강제 적용이 더 빠르고 안전
  2. 외부 의견(다른 AI, 동료)을 경청하고 빠르게 수용할 것
  3. 빌드→실패 반복보다, 단위 테스트 스크립트로 먼저 검증할 것
  4. `Buffer.from(str, 'latin1')` ≠ cp1252 복원 — MySQL latin1은 실제로 cp1252

### timestamp 컬럼 이슈 회고 (2026-02-25)
- **근본 원인:** 스키마에 timestampColumn 하나로 고객/구매 테이블 공유. 실제로는 테이블마다 다른 컬럼명 사용 (TB_MEMBER→UPD_DT, TB_ORDER_HISTORY→ORD_DT)
- **교훈:**
  1. 설정 스키마는 "실제 고객사 DB 구조의 다양성"을 반영해야 한다
  2. config.enc 암호화가 운영 편의성을 떨어뜨리므로 부분 편집 도구는 필수
  3. 코드 수정뿐 아니라 운영 도구(--edit-config)까지 함께 제공해야 완전한 해결

---

## 15) 릴리스 노트

### v1.4.0 (2026-03-15) — 재빌드 완료, 테스트 대기
- **신규: 표준 필드 17개 체계** — 한줄로 DB 동적 전환(D39~D48) 반영
- **신규: store_phone 필드** — Zod 스키마 + 매핑 패턴 (STORE_TEL, SHOP_TEL 등)
- **신규: custom_fields JSONB** — 표준 17개 미매핑 컬럼 → custom_1~custom_15 슬롯 자동 배정 (최대 15개)
- **신규: field-definitions API** — POST /api/sync/field-definitions 커스텀 필드 라벨 서버 등록 (최초 동기화 시 1회)
- **신규: customFieldLabels** — config.enc에 커스텀 슬롯 라벨 저장
- **수정: CLI 마법사 Step 4** — 커스텀 슬롯 배정 결과 표시 + 라벨 수정 지원
- **수정: edit-config** — 커스텀 필드 라벨 표시 + 편집 옵션 추가
- **수정: mapRow()** — custom_N 매핑 필드를 custom_fields JSONB 객체로 수집 (기존: 미매핑 컬럼 원본명으로 넣음)
- **수정: email 정규화** — trim + lowercase 추가
- **수정: store_code priority** — 100→120 상향 (UNIQUE 키 구성요소)
- **수정: needsEncodingFix** — verifyDoubleEncoding() 자동 감지 확인 (R4 리스크 해소)
- **수정: TS 빌드 에러** — DbType 불일치, 누락 필드, execFile→spawn (BUG-011)
- **수정: NSIS 한글 깨짐** — nsExec::ExecToLog→ExecToStack, DetailPrint 한글 직접 출력 (BUG-012)
- **수정: 웹 설치 마법사 Not Found** — HTML 인라인 임베드 setup-html.ts, pkg exe 호환 (BUG-013)
- **수정: age 정수 정규화** — intFields에 age 추가, POS 문자열 나이 대응 (BUG-014)
- **서버 변경 (비토 완료):** sync.ts FIELD_MAP 기반 동적 INSERT, custom_fields JSONB 병합, 파생 필드 자동 계산, field-definitions API 추가

### v1.3.0 (2026-02-25)
- **신규: --edit-config** — config.enc 대화형 편집 CLI (서버/DB/동기화/매핑/Agent 섹션별 수정)
- **신규: --show-config** — 현재 설정 조회 (민감정보 마스킹)
- **신규: 테이블별 timestamp 컬럼** — customerTimestampColumn / purchaseTimestampColumn 개별 지정 (기존 timestampColumn 하위호환)
- **수정: CLI 마법사 Step 3** — 고객/구매 테이블별 timestamp 컬럼 개별 선택
- **수정: 서버 API** — /api/sync/log, /api/sync/version 500 에러 해결 (서버 DDL)

### v1.2.0 (2026-02-14)
- CLI 설치 마법사 (리눅스 헤드리스 서버 대응)
- OS 자동 감지 분기 (--setup → Windows=웹, Linux=CLI)
- NSIS 설치파일 18MB + Linux zip 37MB

### v1.1.0 (2026-02-11)
- Phase 5 고도화: Oracle/PG/Excel, 자동업데이트, 듀얼OS, 이메일 알림
- AES-256-GCM 설정 암호화
- Windows/Linux 서비스 등록

### v1.0.0 (2026-02-10)
- 최초 릴리스: 코어 파이프라인, 설치 마법사 웹 UI, exe 빌드
