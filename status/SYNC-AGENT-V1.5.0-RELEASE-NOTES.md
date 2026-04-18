# Sync Agent v1.5.0 — 릴리스 노트

> **릴리스 일자:** 2026-04-21 (예정)
> **전제:** v1.5.0 빅뱅 (파일럿 없음, 기존 사용자 0)
> **설계 문서:** `status/SYNC-AGENT-V1.5.0-DESIGN.md`

---

## 🆕 주요 변경사항

### 1. AI 자동 컬럼 매핑 (Claude Opus 4.7)
- 설치 마법사 Step 4에서 **"AI 매핑 실행"** 버튼 한 번으로 소스 DB 컬럼 자동 매핑
- **Claude Opus 4.7** 우선 호출 + **Sonnet 4.6** 폴백 + **로컬 autoSuggestMapping** 최종 폴백
- **Anthropic 프롬프트 캐싱**(ephemeral 5분 TTL) 적용 — FIELD_MAP 정의부 캐시
- **PII 금지**: 컬럼명만 전송 (샘플 데이터 외부 전송 불가)
- **회사당 월 10회 쿼터** (`plans.ai_mapping_monthly_quota` 기본 10)
- Windows 웹 UI + Linux CLI 양쪽 지원

### 2. 사용자/브랜드별 격리 강화 (설계서 §4)
- **시스템 가상 user** (`users.is_system=true`) — 싱크 업로더 식별
- **3단 수신거부 배정** (upload.ts admin 패턴 복제)
  - 시스템 user + 회사 admin + `store_code` 담당 company_user
- **customer_code** 자동 생성 — 포맷: `{company_code}-{6자리 시퀀스}` (예: `invito-000001`)
- **로그인 차단**: `is_system=true` 계정은 로그인 불가 (403)

### 3. 엑셀 업로드 차단 모달 (설계서 §4-4)
- 싱크 사용 중 회사(`use_db_sync=true AND active Agent`)에서 고객 DB 수동 변경 차단
  - 고객 개별 추가 / 수정 / 삭제
  - 엑셀 업로드
  - 전체 삭제
- 차단 미허용(= 정상 작동): 직접발송 수신자 엑셀, 수신거부 엑셀, AI 분석/발송
- 프론트 `SyncActiveBlockModal` + 백엔드 `blockIfSyncActive` 미들웨어 이중 방어

### 4. 동기화 주기 조정 (설계서 §7)
- **고객 싱크**: 60분 → **360분** (하루 4회)
- **구매 싱크**: 30분 → **360분**
- **Heartbeat**: 5분 → **60분**
- **큐 재전송**: 5분 → **30분**
- **설정 폴링 제거** — 싱크 응답 `config` 필드로 대체 (서버 부하 20배 감소)
- 슈퍼관리자만 주기 변경 가능 (sys.hanjullo.com)

### 5. 서버 응답 config 자동 갱신
- `POST /api/sync/customers` / `/api/sync/purchases` 응답에 `config` 필드 포함
- Agent가 `config.version`으로 변경 감지 → 자동 스케줄러 재시작
- 기존 `GET /api/sync/config` 유지 (레거시 호환)

---

## 🧹 Gap 정리 (설계서 §12)

| ID | 내용 | 변경 |
|----|------|------|
| M-1 | Agent Zod 스키마 레거시 9개 필드 | `registered_store_number, last_purchase_date, total_purchase, avg_order_value, ltv_score, wedding_anniversary, is_married, is_opt_out, is_active` **전부 제거** |
| M-2 | `normalizeStorePhone` 누락 | Agent `normalize/phone.ts`에 **서버 로직 복제** (유선번호 + 휴대폰 + 대표번호 모두 허용) |
| M-3 | `customer_schema` 미동기화 | `/api/sync/field-definitions`에 **자동 갱신 추가** |
| M-4 | FIELD_MAP Agent 동적 동기화 | `GET /api/sync/field-map` 신규, Agent `getFieldMap()` 메소드 추가 |
| — | customers 응답 노출 | `customer_code` 응답 자동 제외 (SELECT에 포함 안 함), 프론트 UI 표시 제거 (Day 3) |

---

## 📋 백엔드 변경 파일

| 파일 | 변경 |
|------|------|
| `packages/backend/src/utils/ai-mapping.ts` | **신규 CT** — Claude Opus 4.7 + 캐싱 + 폴백 + 쿼터 |
| `packages/backend/src/routes/sync.ts` | `POST /ai-mapping`, `GET /field-map` 신규 / 응답 config / 3단 수신거부 / customer_schema 동기화 |
| `packages/backend/src/routes/auth.ts` | `is_system=true` 로그인 차단 |
| `packages/backend/src/routes/companies.ts` | 회사 생성 시 시스템 user + `customer_code_sequences` 자동 생성 / `sync_block_active` 플래그 응답 |
| `packages/backend/src/routes/customers.ts` | POST/DELETE 5개 라우트에 `blockIfSyncActive` 적용 |
| `packages/backend/src/routes/upload.ts` | `POST /save`에 `blockIfSyncActive` 적용 |
| `packages/backend/src/middlewares/sync-active-check.ts` | **신규** 차단 미들웨어 |

## 📋 Agent 변경 파일 (sync-agent/src/)

| 파일 | 변경 |
|------|------|
| `types/customer.ts` | 레거시 9개 필드 제거 (M-1) |
| `normalize/phone.ts` | `normalizeStorePhone` + `isValidKoreanLandline` 추가 (M-2) |
| `normalize/index.ts` | 레거시 필드 처리 삭제 + `store_phone`에 `normalizeStorePhone` 적용 |
| `types/api.ts` | `RemoteConfig.version/heartbeatInterval/queueRetryInterval` + AI 매핑 타입 |
| `api/endpoints.ts` | `AI_MAPPING`, `FIELD_MAP` 추가 |
| `api/client.ts` | `aiMapping`, `getFieldMap`, `setRemoteConfigHandler`, 응답 config 자동 파싱 |
| `scheduler/index.ts` | 주기 360분 / Heartbeat 60분 / 큐 30분 / `pollRemoteConfig` 제거 / `applyRemoteConfig` 추가 |
| `index.ts` | ApiClient ↔ Scheduler.applyRemoteConfig 연결 |
| `mapping/index.ts` | `suggestMappingWithAI()` 추가 (Opus → 로컬 폴백) |
| `setup/ai-mapping-client.ts` | **신규** 설치 마법사용 AI 매핑 호출 |
| `setup/setup-html.ts` | Step 4에 "AI 매핑 실행" 버튼 + runAiMapping/applyMappingToTable 함수 |
| `setup/server.ts` | `/api/setup/ai-mapping` 엔드포인트 추가 |
| `setup/cli.ts` | Step 4에서 AI 매핑 옵션 대화 |
| `setup/edit-config.ts` | 매핑 편집 메뉴에 "AI 자동 매핑 재실행" 옵션 추가 |

## 📋 프론트엔드 변경 파일 (packages/frontend/src/)

| 파일 | 변경 |
|------|------|
| `components/SyncActiveBlockModal.tsx` | **신규** 싱크 차단 모달 |
| `pages/Dashboard.tsx` | `sync_block_active` 수신 + 업로드 3곳에 체크 + 모달 렌더 |

---

## 🗄️ DB 스키마 변경

| 테이블/컬럼 | 타입 | 설명 |
|-----------|------|------|
| `users.is_system` | BOOLEAN DEFAULT false | 시스템 가상 user 식별 |
| `customers.customer_code` | VARCHAR(50) | 회사별 디버깅 식별자 |
| `customer_code_sequences` | (신규 테이블) | 회사별 시퀀스 관리 |
| `plans.ai_mapping_monthly_quota` | INTEGER DEFAULT 10 | AI 매핑 호출 쿼터 |
| `companies.ai_mapping_calls_month` | INTEGER DEFAULT 0 | 현재 월 호출 횟수 |
| `companies.ai_mapping_last_month` | VARCHAR(7) | 마지막 호출 월(YYYY-MM) — 월 리셋 판정 |
| `users_user_type_check` | CHECK 제약 | `('admin', 'user', 'system')` |

---

## 🛡️ 호환성

- **v1.4.x → v1.5.0**: 빅뱅 업그레이드. 기존 사용자 0이므로 호환성 이슈 없음
- **기존 `GET /api/sync/config` 엔드포인트**: 유지 (Agent v1.5.0+는 호출 안 함, 방어적 유지)

---

## 🚀 배포 순서

1. **DB 마이그레이션** (Harold님 수동) — `status/SYNC-AGENT-V1.5.0-QA-GUIDE.md` 참조
2. **백엔드/프론트엔드 배포** — `tp-deploy-full`
3. **Agent 빌드** — Harold님 로컬 PowerShell
   ```powershell
   cd sync-agent
   npm run build:exe
   npm run build:linux
   bash installer/build-linux-package.sh 1.5.0
   installer\build-installer.bat 1.5.0
   ```
4. **서팀장 QA** — `SYNC-AGENT-V1.5.0-QA-GUIDE.md` 시나리오 실행
5. **고객사 배포** — v1.5.0 정식 릴리스

---

## 📞 문의

- 설계: `status/SYNC-AGENT-V1.5.0-DESIGN.md`
- QA 가이드: `status/SYNC-AGENT-V1.5.0-QA-GUIDE.md`
- 버그 트래커: `status/BUGS.md`
