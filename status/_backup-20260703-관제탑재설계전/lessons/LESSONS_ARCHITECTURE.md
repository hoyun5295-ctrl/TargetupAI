# LESSONS — Architecture (핵심 아키텍처 + 도메인 매트릭스)

> **참조**: 컨트롤타워 신규/수정 / 도메인 흐름 확인 / 작업 진입 시 우선 정독.
> **원본**: 옛 `LESSONS_LEARNED.md` §1 + §2 + §5 + §6 통합 분할 (D215+ 도메인 분할 — 2026-05-24).

---

## 1. 핵심 아키텍처 (컨트롤타워 체계)

각 도메인의 핵심 로직은 컨트롤타워 유틸(`utils/`) 1곳에만 존재. 인라인 작성 절대 금지.

### Backend (`packages/backend/src/utils/`)

| CT | 파일 | 역할 |
|---|---|---|
| CT-01 | `customer-filter.ts` | 고객 필터/쿼리 빌더 통합 |
| CT-02 | `store-scope.ts` | 브랜드(store_code) 격리 |
| CT-03 | `unsubscribe-helper.ts` | 수신거부 필터링 + 080 연동 단일 진입점 |
| CT-04 | `sms-queue.ts` | MySQL 큐 단일 진입점 (UNION ALL 집계) |
| CT-05 | `prepaid.ts` | 선불 잔액 + Idempotent 환불 (D145 P0+) |
| CT-06 | `campaign-lifecycle.ts` | 캠페인 취소 + 결과 동기화 |
| CT-07 | `standard-field-map.ts` | FIELD_MAP — 유일 기준 + 동적 조회 |
| CT-08 | `callback-filter.ts` | 개별회신번호 필터링 |
| CT-09 | `spam-test-queue.ts` | 스팸테스트 큐 + 자동 재생성 |
| CT-10 | `sender-registration.ts` | 발신번호 등록/배정 |
| CT-12 | `brand-message.ts` | 브랜드메시지 발송/검증 |
| CT-14 | `deduplicate.ts` | 수신자 중복제거 |
| CT-15 | `saved-segments.ts` | AI 발송 템플릿 저장 |
| CT-16 | `customer-upsert.ts` | customers UPSERT 단일 진입점 (region 중복 차단) |
| CT-17 | `plan-guard.ts` | 요금제/기능 게이팅 (plan_code 기준) |
| CT-18 | `enabled-fields.ts` | 활성 필드 탐지 |
| CT-19~22 | `cdp-auth/identity/events/orders` | D172 CDP 매트릭스 |
| CT-23~24 | `cafe24-client / provider-registry` | D173 자사몰 Provider Adapter |
| CT-25 | `next-action-advisor.ts` | D174 Next Action Advisor (buildPerformanceSnapshotV2 — D213+ D144 정합) |
| CT-26~27 | `web-push / inapp-message` | D175-A Web Push + In-app |
| CT-28 | `continuous-operator.ts` | D176 Continuous Agentic Operator |
| CT-29~36 | 다양한 자사몰 / Voice AI / Multi-Goal / Email | D178~D180 |
| CT-37~39 | `company-memory / batch-ai / citations` | D181 Anthropic 5 무기 |
| CT-43~46 | `journey-builder / journey-executor / journey-ai-generator / message-sanitizer` | D187 Journey Builder Lite |
| CT-52~58 | predictive-suite / connected-content / ai-self-diagnosis / company-data-profile | D197~D208 |
| CT-59~63 | journey-step-diagnosis / journey-simulator / variant-generator / predictive-explainer | D211+ |
| CT-64 | `continuous-operator-policy.ts` | D212+ 발송 정책 |
| CT-65~70 | performance-cohort / benchmark / explainer / quick-action / attribution / data-availability | D213+ 성과리포트 |
| CT-71~76 | unified-customer-profile / customer-cdp-fusion / cdp-diagnostics / cdp-active-customers / source-aware-channel-selector / cdp-fusion-explainer | D214+ 자사몰 + 데이터 융합 |

### Frontend (`packages/frontend/src/utils/`)
- `formatDate.ts` — 포맷팅 + 바이트 + 변수 치환 + `cellToString` (backend normalize.ts 미러) + DIRECT_VAR_MAP + displayValue
- `liquid-templating.ts` — D191 Liquid 변수 치환
- `highlightVars.ts` — D210+ Phase 2-fix6 변수 하이라이트

### 주요 신규 컴포넌트 (D211+ ~ D214+)
- `components/ConfirmModal.tsx` — D212+ generic 4 모드 (default/info/warning/danger)
- `components/ToastProvider.tsx` — D212+ useToast hook (success/error/info/warning)
- `components/journey/JourneyActionConfirmModal.tsx` — D211+ archive/unarchive/delete
- `components/journey/JourneyFlowDiagram.tsx` — D211+ Phase A 4번 흐름 시각화

---

## 2. 필수 점검 원칙 (사고 방지)

* **유틸 함수 수정 부작용 (D70~D72)**: 컨트롤타워 함수 반환값 변경 시 호출부 100% grep 점검 필수.
* **동적 참조 원칙 (D74)**: FIELD_MAP 등 컨트롤타워 데이터 소비 시 하드코딩 금지. 동적 루프 설계 필수.
* **표시 경로 확인 (D102~D106)**: 발송 백엔드만 패치하지 말 것. 미리보기/대시보드/캘린더 등 표시 경로 모두 grep.
* **falsy 패턴 전수 grep (D150-3)**: `|| ''`, `if (!val)` 등 falsy 패턴 분산 방지. 1곳 수정 금지 — 동일 패턴 전 영역 grep 후 통합 수정.
* **DB ALTER 안전망 (D214+ 신규)**: 새 컬럼 활용 endpoint catch에 `column does not exist` 분기 처리 의무. DB 마이그레이션 미실행 시 503 + 사용자 친화 메시지 반환.

---

## 3. 도메인 아키텍처

### 3-1. SMS 발송 5개 경로 (`campaigns.ts`)

```
1. POST /                  — AI 캠페인 생성
2. POST /:id/send          — AI 캠페인 발송
3. POST /direct-send       — 직접발송 (즉시)
4. POST /test-send         — 테스트발송
5. POST /:id/schedule      — 예약발송
```

**원칙**: 발송 관련 수정 시 5개 경로 전부 확인. `messageUtils.ts replaceVariables()` 공통 치환 함수 사용.

### 3-2. 동적 필드 매핑 ("기준은 하나, 입구는 여럿")

```
standard-field-map.ts (FIELD_MAP) ← 유일한 기준
    ↓ import
├── upload.ts     — 엑셀 업로드 (입구)
├── sync.ts       — SyncAgent 동기화 (입구)
├── normalize.ts  — 값 변환 (정규화)
├── customers.ts  — 고객 조회/관리 (출구)
├── campaigns.ts  — 발송 시 고객 조회 (출구)
├── ai.ts         — AI 메시지 생성 (출구)
└── Dashboard.tsx — UI 표시 (출구)
```

- **직접 컬럼 필드**: name, phone, gender, age, birth_date, email, address, region, recent_purchase_*, total_purchase_*, purchase_count, store_*, grade, points, sms_opt_in 등
- **D214+ 신규 unified profile**: last_activity_at, active_sources jsonb, primary_source, preferred_channel, source_priority_resolved
- **D214+ 신규 CDP event**: last_cart_add_at, cart_add_count_30d, last_wishlist_add_at, wishlist_add_count_30d, last_page_view_at
- **커스텀 슬롯 15개**: custom_1 ~ custom_15 (custom_fields JSONB)

### 3-3. 멀티테넌트 격리
- **company_id**: 회사 단위 (모든 테이블)
- **store_code**: 매장 단위 (다매장 고객사)
- **user_id**: 사용자 단위 (브랜드별 수신거부)

### 3-4. 변수 치환 (`messageUtils.ts`)
- `replaceVariables(template, customer, fieldMappings, addressBookFields?, options?)` — 5경로 통합
- 4번째 파라미터 `addressBookFields` (D70): 직접발송 주소록 변수 치환 (안전망 regex 전 먼저)
- D150-3 교훈: `cellToString` (normalize.ts) 통해 0/'0' 보존 필수

### 3-5. SMS 발송 흐름
```
PG campaigns → MySQL SMSQ_SEND_X INSERT (QTmsg Agent) → msg_result_YYYYMM 기록 → sync-results: MySQL → PG campaign_runs 업데이트
```
- 서버 `SMSQ_SEND` = VIEW = `SMSQ_SEND_1 UNION ALL ... SMSQ_SEND_11` (D144 검증)
- 라인 그룹 = `sms_line_groups` + `companies.line_group_id` / `users.line_group_id`. **추측 금지 — Harold께 라인 명시 질의**.

### 3-6. AI Operator 매트릭스 (D170+ ~ D214+)
- **AI Operator** = Opus 4.7 (자연어 한 줄 → 6 sub-agent orchestrate)
- **Continuous Operator** = 매일 cron + 사용자 승인 흐름 + 7일 만료
- **Predictive** = 1시간 cron 자동 예측 + Explainability
- **Journey Builder** = 6 sub-agent + variant 자동 생성 + 실시간 위치
- **Bandit Optimizer** = Thompson Sampling Beta-Bernoulli
- **Anthropic 5 무기** = Memory (CT-37) + Batch (CT-38) + Citations (CT-39) + Extended Thinking + Tool Use
- **Unified Customer Profile** (D214+) = 모든 source 통합 + source_priority 매트릭스 + preferred_channel 자동 분배

---

## 4. 작업 진입 자기 점검 순서

1. `CLAUDE.md` 룰 정독 — `MANDATORY_CHECKLIST` + `STANDARD_RESPONSES`
2. **작업 도메인별 LESSONS 파일 우선 정독** (D215+ 신규):
   - DB/SCHEMA/돈/환불 → `LESSONS_DB.md`
   - UI/모달/모바일/모델명 노출 → `LESSONS_FRONTEND.md`
   - API/Query/발송/AI → `LESSONS_BACKEND.md`
   - 배포/SSH/빌드 → `LESSONS_DEPLOY.md`
   - AI 답변 패턴 위반 → `LESSONS_META.md`
3. `status/STATUS.md` CURRENT_TASK 확인
4. 코드 수정 진입 시 — `utils/` CT 존재 확인 → 인라인 금지 → grep 전수 → Harold님 컨펌 → Edit
5. 빌드 안내 시 — `npm run build:safe` (atomic) 강제. `tp-deploy-full` 절대 금지.
6. 답변 송신 직전 — 위반 단어 검열 (박-단어 / 모델명 / "부탁드립니다" / "✅" / "1단계" 등)
