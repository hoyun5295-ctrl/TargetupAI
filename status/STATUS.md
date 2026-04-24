# 한줄로 (Target-UP) — 프로젝트 운영 문서

> 관련 문서: DB 스키마 → SCHEMA.md | 운영/인프라 → OPS.md | 버그 추적 → BUGS.md | 확장 로드맵 → SCALING.md
> **SoT(진실의 원천):** 이 문서 + CURRENT_TASK. 대화 중 가정은 여기에 반영되기 전까지 "임시"다.

---

## 0) 사용법
1. 새 대화 시작 시 이 문서를 기준(SoT)으로 삼는다.
2. 작업 요청 시 Harold님이 `CURRENT_TASK`를 갱신하거나 구두 지시한다.
3. AI는 모든 응답에서 **(A) 현황 파악 → (B) 설계안/방향 제시 → (C) Harold님 컨펌 → (D) 구현** 순서를 유지한다.
4. DB 스키마 확인 필요 시 → `SCHEMA.md` 참조
5. 서버/접속/배포 정보 필요 시 → `OPS.md` 참조
6. 버그 상세/교차검증/재발 패턴 확인 시 → `BUGS.md` 참조

---

## 1) AI 에이전트 페르소나 & 계약

### 1-1. 역할(ROLE)
- **당신의 역할:** 15년 차 시니어 풀스택 개발자. Node.js/Express + React/TypeScript + PostgreSQL/MySQL + Docker/PM2 인프라 전체를 커버하며, 한국 통신사 SMS/LMS/MMS/카카오톡 발송 인프라에 정통함.
- **당신의 목표:** Harold님의 의도를 정확히 파악하고, 버그 없는 견고한 아키텍처와 유지보수가 쉬운 코드를 작성한다.
- **코드 스타일:** 엄격한 TypeScript, 불필요한 주석 최소화, SRP 준수, 명확한 네이밍

### 1-2. 불변의 운영 원칙(INVARIANTS)
- **SoT(진실의 원천)는 오직 이 문서 + `CURRENT_TASK`** 이다. 대화 중 떠도는 가정은 SoT에 반영되기 전까지 "임시"다.
- **범위는 `CURRENT_TASK` 밖으로 확장하지 않는다.** (필요하면 "추가 과제"로 분리해 제안만 한다.)
- **모든 의사결정은 `DECISION LOG`에 기록** 해서 흔들림/재논의를 줄인다.
- **모든 변경은 "최소 영향·가역성(rollback)"을 우선** 으로 한다.

### 1-3. 커뮤니케이션 규칙
- **Harold님께 항상 존댓말(경어)** 을 사용한다. **반말은 절대 금지.**
- 호칭은 **"Harold님"** 으로 통일한다.
- Harold님의 지시/요구사항을 최우선으로 존중하되, 안전·법률·정책에 위배되는 요청은 수행하지 않고 대안/옵션을 제시한다.

---

## 2) ⚠️ 절대 개발 원칙 (CRITICAL RULES)

### 2-1. 코드/파일 작성 전 반드시 Harold님 컨펌
- 반드시 **현황 파악 → 설계안/방향 제시 → Harold님 동의 → 코드 작성** 순서로 진행한다.
- 혼자 먼저 만들지 말 것.

### 2-2. 처음부터 제대로
- "일단 만들고 나중에 업그레이드" 없음.
- 모달/UI 컴포넌트는 처음부터 예쁜 버전으로 (animate-in, fade-in, zoom-in, max-w-sm, 아이콘+제목+설명+버튼 구조).
- confirm/alert → 예쁜 커스텀 모달로 교체 (복사 기능 포함).

### 2-3. 백업 필수
- 컨테이너 작업 전 pg_dump 백업 → 작업 → 복원.
- 작업 완료 후 pg_dump + git commit.
- DB 파괴적 작업 절대 신중. **데이터 손실 = 매출 손실.**
- **Docker 컨테이너 재생성 시 포트 바인딩 반드시 `127.0.0.1` 확인.** `0.0.0.0` 바인딩 절대 금지. (2026-02-28 MySQL 랜섬웨어 교훈)

### 2-4. ⚠️ 배포 전 TypeScript 타입 체크 필수
- 상용 서버 배포 코드는 반드시 TypeScript 타입 에러 없이 컴파일 가능해야 함.
- 특히 mysqlQuery 등 외부 라이브러리 반환값 타입 캐스팅 주의.
- **타입 에러 있는 코드 배포 = 서버 크래시 = 서비스 장애** (2026-02-19 장애 교훈)

### 2-5. ⚠️ SCHEMA.md / OPS.md 절대 준수
- **코드는 반드시 SCHEMA.md와 OPS.md에 정의된 구조를 벗어나지 않는다.**
- 새 코드 작성 시 반드시 SCHEMA.md를 먼저 읽고, 컬럼명·타입·관계를 확인한 후 코딩한다.
- **SCHEMA.md에 없는 컬럼명/타입을 코드에서 임의 생성 절대 금지.**
- 하드코딩 매핑(CATEGORY_MAP, CAT_LABELS 등)을 만들지 않는다. standard_fields 테이블과 `standard-field-map.ts` 매핑 레이어가 유일한 기준이다.
- standard_fields.field_key ↔ customers 컬럼 간 매핑은 `standard-field-map.ts` 한 곳에서만 정의한다.
- customers.ts, upload.ts, Dashboard.tsx, normalize.ts, sync.ts 등 모든 파일은 이 매핑 레이어를 import해서 사용한다.
- **"기준은 하나, 입구는 여럿"** — standard_fields = 유일한 기준, normalize.ts = 값 변환, upload/sync = 입구, customers/Dashboard = 출구. 전부 standard-field-map.ts 참조.

### 2-6. 추측성 땜질 금지 / 에러 대응 프로토콜
- 에러가 발생하면 임의로 코드를 덧붙이지 않는다.
- 1단계: 에러 로그 / 재현 절차 / 기대 결과 / 실제 결과를 확인한다.
- 2단계: 원인을 3줄 이내로 요약한다.
- 3단계: 2가지 이상 해결 옵션(장단점/리스크) 제시 후 Harold님 선택을 기다린다.
- 4단계: 선택된 옵션으로 최소 수정 → 회귀 테스트까지 수행한다.

### 2-7. 수정 파일 제공 방식
- 코드 수정 시 **"기존코드 → 새코드"** 형식으로, 파일 내 형태 그대로 복사해서 커서에서 바로 검색 가능하게 제공.
- Harold님이 명시 요청 시에만 완성된 단일 파일 전체로 제공.
- **모든 수정사항(코드, .md 문서 포함)은 수정파일로 제공한다.** 프로젝트 문서(.md)도 수정 시 파일로 제공하여 Harold님이 다운로드 후 교체할 수 있게 한다.

### 2-8. 데이터 정확성
- 대상자 수는 AI 추정이 아닌 DB 실제 쿼리 결과로 산출.

---

## 3) 표준 작업 흐름(Workflow) & 게이트

### 3-1. 기본 파이프라인
1) **요청 접수** → 2) **현황 파악** → 3) **설계안 제시** → 4) **Harold님 컨펌** → 5) **구현** → 6) **검증** → 7) **배포**

### 3-2. HOTFIX 트랙 (Harold님이 `[HOTFIX]` 태그 명시 시)
**조건:** UI 문구/오타/스타일, 설정값, 단순 조건 분기 등 저위험 변경. DB 스키마 변경 없음, 보안/인증 로직 변경 없음.
**흐름:** 구현 → 검증 → 배포 (설계 단계 암묵 합의)

### 3-3. 핵심 게이트 체크
- [ ] TypeScript 타입 에러 없이 컴파일 가능한가?
- [ ] pg_dump 백업 완료했는가? (DB 변경 시)
- [ ] 기존 기능 깨짐(회귀) 확인했는가?
- [ ] 롤백 방법이 있는가?

---

## 4) 🎯 CURRENT_TASK (현재 집중 작업)

> **규칙:** 아래 목표에만 100% 리소스를 집중한다.
> **⚠️ D-Day: 2026-05-05 새벽 레거시 이관 최종 단계 (Harold + Claude 공동).** 예약발송 + 레거시 Agent 차단.

---

### 🟢 D136 P1 (2026-04-22 밤 연속 세션) — PDF 9건 전체 완료 + 전수점검 추가 수정

> **상태:** 코드 수정 완료, 1차 배포 완료(D1/D1-2/D9/D6/D8/CustomerDBModal fieldKey), 전수점검 추가 2건 배포 대기(upload.ts/unsubscribe-helper.ts CT-03 통합)
>
> **✅ D136 P1 추가 완료 (전수점검으로 마무리):**
>
> | # | 내용 | 파일 |
> |---|------|------|
> | D1 근본 | **CT-18 신설** `utils/enabled-fields.ts` — `detectEnabledFields` + `buildDynamicSelectExpr`. standardHeaders 19개 하드코딩 전면 제거. enabled-fields ≡ download 100% 일치 | `utils/enabled-fields.ts` (신설), `routes/customers.ts` |
> | D1-2 근본 | sync.ts `/customers` 핸들러에 `customer_field_definitions` 자동 UPSERT 안전망 | `routes/sync.ts` |
> | D9-a/b 근본 | `getStoreScope` 유령 배정 방어 + **CT-03 `registerBulkCompanyUserUnsubscribes` 신설**으로 sync.ts/upload.ts/unsubscribe-helper.ts 3곳 분산 인라인 SQL 통합 | `utils/store-scope.ts`, `utils/unsubscribe-helper.ts`, `routes/sync.ts`, `routes/upload.ts` |
> | D6 | 예약대기 MMS 이미지 클릭 확대 모달 (ResultsModal 패턴) | `components/ScheduledCampaignModal.tsx` |
> | D8 | 대시보드 동적 카드 (`dyn_{key}_{aggType}` 패턴) — 고객사 업로드 커스텀 필드 기반 자동 생성 | `utils/dashboard-card-pool.ts`, `routes/admin.ts`, `routes/companies.ts`, `pages/Dashboard.tsx` |
> | 추가 P1 | CustomerDBModal fieldKey 전달 3곳 (커스텀 필드 콤마 포맷 가드 활성화) | `components/CustomerDBModal.tsx` |
> | 추가 P1 | admin.ts PUT dashboard-cards 카드 상한 17→50 (동적 카드 대응) | `routes/admin.ts` |
>
> **🎓 D136 P1 핵심 교훈 (CLAUDE.md 필수 체크 원칙 4 신설):**
>
> Harold님 지적: "전수 점검에서 맨날 놓치는게 있네" — sync.ts만 보고 "완료" 보고했으나 같은 SQL 패턴이 upload.ts + unsubscribe-helper.ts에 분산되어 있음. CLAUDE.md 7-1 프로세스 정면 위반.
>
> **교정:** 작업 시작 전 반드시 `grep -rn "패턴"` 전수 리스트업 → Harold님께 "N곳 수정" 컨펌 후 작업 → 완료 선언 전 grep 재확인.
>
> **배포 대기:**
> 1. `tp-push "D136 P1 전수점검 완료 (upload.ts + CT-03 통합)"` → `tp-deploy-full`
> 2. Agent 재동기화 후 Harold님 검증:
>    - suran/gwchae/sgbaek 고객DB 1500명 노출
>    - unsubscribes 카운트 5건 동일 (mobile/system_sync/suran/gwchae/sgbaek)
>    - 슈퍼관리자 대시보드 카드 설정에 커스텀 필드 동적 카드 추가 노출
>    - 예약대기 MMS 이미지 클릭 확대
>
> ---
>
> ### 🔴 D136 (초기 세션 — PDF 9건 최초 기록 / 아카이브)
>
> **PDF:** `C:\Users\ceo\OneDrive\문서\카카오톡 받은 파일\한줄로_20260422.pdf` 9건
> **세션 완료분 (타입체크 통과, 배포 대기):**
>
> | # | 제목 | 상태 | 파일 |
> |---|------|------|------|
> | D2 | 직접발송 무료거부 위 줄바꿈 과잉 제거 (고객 개행 100% 보존, AI 프롬프트 갱신) | ✅ | `messageUtils.ts` + `formatDate.ts` + `services/ai.ts` |
> | D3 | MMS 이미지 1/2/3 순서 어긋남 (toMmsImagePaths 빈슬롯 compact) | ✅ | `utils/mmsImage.ts` |
> | D4 | 맞춤한줄 MMS 담당자테스트 거부 (mmsImagePaths 하드코딩 수정) | ✅ | `AiCustomSendFlow.tsx:234` |
> | D5 | 맞춤한줄 머지결과 강조색 사라짐 (mergeAndHighlightVars 교체) | ✅ | `AiCustomSendFlow.tsx` |
> | D7-1 | 등급 NORMAL/SILVER 잔존 — 서버 dist trim 정상 확인. **시세이도 재업로드 대기** | 🟡 코드 OK / Harold님 재업로드 필요 | — |
> | D7-2 | 커스텀필드 varchar 숫자 콤마 — 원본 보존 원칙 구현 (formatByType fieldKey 가드) | ✅ | `formatDate.ts` + `feedback_custom_field_raw_preserve.md` |
> | D1-1 | 엑셀 다운로드 매칭 안 한 컬럼 빈값 출력 (activeHeaders 필터) | ✅ | `routes/customers.ts download` |
> | D1-2 | 엑셀 다운로드 커스텀필드 빈값 (JSONB key fallback) | 🟡 부분해결 | `routes/customers.ts download` |
> | — | 알림톡 템플릿등록 팝업 "휴머스온 IMC" 노출 → "카카오 검수" 중립화 (6곳) | ✅ | frontend alimtalk 전체 |
> | — | 슈퍼관리자 발신번호 회사별 페이징 10개씩 (금강제화 160개 무한 스크롤) | ✅ | `AdminDashboard.tsx` |
>
> **🔥 즉시 수정 필요 (다음 세션 최우선):**
>
> | # | 제목 | 이유 |
> |---|------|------|
> | **D1-2 (근본)** | `sync.ts /customers`에서 `customer_field_definitions` 자동 UPSERT | Sync Agent가 field-definitions API 미호출 → suran 계정 라벨 0건 / 시세이도는 upload.ts 정상 |
> | **D1 (근본)** | `routes/customers.ts download`를 `enabled-fields` 로직과 100% 동일하게 재작성 | Harold님 원칙: "고객DB 현황에 보이는 내역 그대로 다운로드". 현재 standardHeaders 하드코딩 → 화면과 불일치 가능 |
> | **D6** | 예약대기 MMS 이미지 클릭 시 확대 화면 (발송결과처럼) | `ScheduledCampaignModal.tsx` MMS 썸네일 클릭 이벤트 + 확대 모달 |
> | **D8** | 슈퍼관리자 대시보드 카드 선택 — 고객 업로드 컬럼 기준으로 동적 확장 (현재 7개 고정) | D133 후속. 회의 합의 내용 구현 미완 |
> | **D9-(a)** | 담당브랜드 없는 중간관리자(suran)에서 수신거부 자동 업로드 안 됨 (중간관리자 5건, suran 0건) | `admin-sync.ts` 또는 `upload.ts` 수신거부 처리 경로 |
> | **D9-(b)** | gwchae/sgbaek 담당브랜드 지정됐으나 "분류코드 없어 전체 접근"으로 표시됨 + 실제 DB조회 안 됨 | `store-scope.ts` (CT-02) 또는 사용자 관리 UI |
> | **알림톡 B7** | 강조 이미지 업로드 실패 (800x400 25.3KB JPG) — pm2 로그 재현 후 진단 | Harold님 업로드 재시도 + 로그 확인 |
> | **CSS 경고 정리** | Vite 빌드 시 `Expected identifier but found "-"` 경고 — `new Date().toISOString().replace(/[-:T]/g, '')` regex를 Tailwind JIT가 arbitrary value로 오스캔 → `-: T;` 무효 CSS 생성 (런타임 영향 0, 무해). 6개 파일 `compactTimestamp()` 유틸로 통합 | `CustomerDBModal.tsx:279` + 5곳 동일 패턴. `formatDate.ts`에 `compactTimestamp()` 신설 후 import 교체 |
>
> **배포 순서 (오늘 세션 완료분):**
> 1. `tp-push "D136 디버깅 9건 수정"` → `tp-deploy-full`
> 2. Harold님 실서버 검증:
>    - 직접발송 줄바꿈 (고객 여러 줄 띄운 것 그대로 유지)
>    - MMS 이미지 2번 슬롯에만 업로드 → 1장 카운트 + 엑박 없음
>    - 맞춤한줄 MMS 담당자테스트 + 머지결과 강조색
>    - 엑셀 다운로드 (suran 계정에서 custom_1/custom_2 값 나옴)
> 3. 다음 세션: 즉시 수정 필요 6건 착수
>
> **📊 이관 진행 현황 (2026-04-22 D134/D135 선제 완료):**
> | 종류 | 건수 | 상태 | 일자 |
> |---|---:|---|---|
> | 계정 (companies 62 + users 141) | — | ✅ | D134 2026-04-22 밤 |
> | 회신번호 callback_numbers + assignments | 1,492 + 1,051 | ✅ | D135 2026-04-22 오후 |
> | 수신거부 unsubscribes | 321,389 | ✅ | D135 2026-04-22 오후 |
> | 레거시 서버 팝업 교체 (migration-popup.jsp) | 10,457→13,924 bytes | ✅ | D135 2026-04-22 저녁 |
> | 레거시 `/transition` 랜딩 배포 (Nginx) | 47,736 bytes | ✅ | D135 2026-04-22 저녁 |
> | 주소록 | — | ⛔ 포기 | — |
> | **선불 잔액 이관 준비** (34사 / 20,398,110원) | 🟡 준비완료 | ⏳ 5/5 재조회후 UPDATE | 런북: `migrate-legacy/D-DAY-PREPAID-RUNBOOK.md` |
> | **예약발송 76건 + Agent 차단** | 76 | ⏳ **5/5 남음** | 2026-05-05 새벽 |
>
> **D135 정합성 검증**: 141명 login_id 전원 expected vs actual 완전 일치 PASS ✅
> **전환 안내 UI 검증**: Harold님 시크릿창 실화면 전 항목 통과 ✅
>
> **이관 정책 (2026-04-20, 영업팀장 컨펌 완료):**
> - **주소록 이관 X** — 레거시 "쌓아두기" 관행(gwss 샘플 CREATEDT 2.5년) → 각 고객사가 한줄로에 신규 엑셀 재업로드
> - **이관 대상 3종**: 수신거부(BLOCKEDNUM 33만) + 회신번호(MEMBER_SEND_NUM 3천) + 예약발송(MSGSUMMARY 76건)
> - **FREE 플랜 상한 10만명** 확정 (Brevo/솔라피 벤치마크)
> - **예약발송 이관 순서 (중복 발송 방지):** ① 한줄로 campaigns INSERT → ② 레거시 RESERVEYN=0 UPDATE → ③ 레거시 Agent 중지
> - 제외 대상: 90일 미사용(lush*/labnosh/amanex 등) + 이미 이관(gwss/isoi/shiseido* — 직원 직접 재업로드 예정)
> - 상세: [`status/LEGACY-MIGRATION.md`](LEGACY-MIGRATION.md) + [`migrate-legacy/`](../migrate-legacy/) 작업 디렉토리

---

### 🚑 D131 (2026-04-21) — 싱크에이전트 실점검 이슈 3건 해결 + D130 이슈 일괄 정리

> **문서**: [`status/SYNC-AGENT-TROUBLESHOOTING.md`](SYNC-AGENT-TROUBLESHOOTING.md) — 진단 체크리스트 + 에러 유형별 대응 + Agent 재시작
>
> **실점검 이슈 (sync-agent-001, 인비토 MS-SQL 테스트):**
> 1. 상태값 "지연" 오표시 — Agent heartbeat 60분 주기 vs 서버 판정 10/30분 불일치 → `admin-sync.ts` 70/130분으로 완화
> 2. `POST /api/sync/customers` 1500건 전건 실패 — `insertCols`에 region 중복 → **CT-16 `customer-upsert.ts` 신설** + upload.ts/sync.ts/customers.ts(단건/벌크) 전부 `createCustomerUpsertBuilder().buildBatch()` 호출로 통합
> 3. `GET /api/sync/version` 500 → Agent 크래시 — `sync_releases.checksum` 컬럼 누락 → `ALTER ADD COLUMN` 완료
>
> **D130 관련 동시 수정:**
> - 알림톡 템플릿 등록 권한: `POST /alimtalk/templates` `requireCompanyAdmin` 추가 + 프론트 `AlimtalkManagementSection` `canManage` 조건부 UI 3곳
> - `auto_campaigns` D130 알림톡 컬럼 7개 추가 (`channel`, `alimtalk_profile_id`, `alimtalk_template_id`, `alimtalk_template_code`, `alimtalk_variable_map`, `alimtalk_next_type`, `alimtalk_next_contents`)
> - 자동발송 '매일' 주기 제거 (D-2 AI 생성 시점 구조적 모순) — frontend SCHEDULE_TYPES + backend validation
>
> **0417 PDF 12건 검수 수정 (B1~B12):** 보관함 광고 상태 DB 왕복(is_ad 컬럼) + MMS 이미지 공용 컴포넌트 `MmsImagePreview` 신설 + 5경로 MMS 이미지 차단 검증(`validateMmsBeforeSend`) + 자동발송 스팸필터/제외하고 생성 버그 + AI 문안 3→1 variant 등
>
> **잔여 과제 (오픈 후):**
> - 중복 인덱스 `customers_company_store_phone_unique_idx` DROP (D131 실수로 추가)
> - 중복 UNIQUE 제약 `customers_company_phone_unique` DROP
> - Agent uncaughtException 핸들러 점검 (version check 500에서 복구 로직)
> - `sync_logs.failures` JSONB 기록 경로 검증
>
> **🚨 다음 세션 최우선 과제 — Agent v1.5.1 CWD 패치:** ✅ **2026-04-21 저녁 세션 완료**
> - 지시서: [`status/SYNC-AGENT-CWD-PATCH-v1.5.1.md`](SYNC-AGENT-CWD-PATCH-v1.5.1.md)
> - 증상: Windows 서비스로 실행 시 1053 에러 (cwd=System32 → config/data 경로 틀어짐)
> - 수정: `sync-agent/src/index.ts` 최상단에 `process.chdir(path.dirname(process.execPath))` 추가 (3줄) — 배포 완료

---

### 💎 D132 (2026-04-22) — CT-17 요금제 게이팅 + 30일 PRO 무료체험 + subscription_status 네이밍 정리 (✅ 배포+검증 완료)

> **세션 기록:** [`.claude/projects/.../memory/project_plan_gating_policy.md`](../.claude/projects/C--Users-ceo-projects-targetup/memory/project_plan_gating_policy.md)
>
> **배경:** Harold님 5회 정책 교정 끝에 2단계 구조 확정 — FREE(미가입) / TRIAL(무료체험=PRO와 동일 기능). 기존 `plan_code='FREE' && created_at+7d` 자동 체험 로직 폐기, 모바일 DM 게이팅 누락 버그(BASIC에서도 열림) 동시 해결. **오후 추가 세션에서 subscription_status 네이밍 충돌('active' 중복) 근본 정리 + 대시보드 요금제 현황 카드 D-N 뱃지 추가.**
>
> **매트릭스 (Harold님 확정):**
> | 기능 | FREE(미가입) | STARTER+ | BASIC+ | PRO/TRIAL+ |
> |---|---|---|---|---|
> | 직접발송·수신거부·발송결과·예약(직접) | ✅ | ✅ | ✅ | ✅ |
> | 고객DB·직접타겟발송·AI자동매핑·스팸필터수동 | ❌ | ✅ | ✅ | ✅ |
> | AI 메시지·AI 타겟 | ❌ | ❌ | ✅ | ✅ |
> | 자동발송·모바일DM·AI프리미엄·스팸자동화 | ❌ | ❌ | ❌ | ✅ |
>
> **주소록 한도(direct_recipient_limit):** FREE=99,999 / STARTER=100k / BASIC=300k / PRO+=NULL(무제한)
>
> ---
>
> #### 🅰️ 오전 세션 (CT-17 게이팅 시스템)
>
> **백엔드:**
> - `utils/plan-guard.ts` **신설** (CT-17, FeatureKey 10종: basic_send / customer_db / target_send / ai_mapping / spam_filter / ai_messaging / ai_premium / auto_campaign / mobile_dm / auto_spam_test)
> - `utils/trial-downgrade-worker.ts` **신설** — 매일 04:00 KST, `plan_code='TRIAL'` + 만료 조건으로 자동 강등
> - `routes/ai.ts` 5곳 인라인 → canUseFeature CT 호출 통일
> - `routes/auto-campaigns.ts` checkPlanGating CT-17 래퍼 재작성
> - `routes/companies.ts` plan-info SELECT 교체 + **grant-trial(TRIAL plan 사용)** + revoke-trial API
> - `routes/dm.ts` `requirePlanFeature('mobile_dm')` 미들웨어 (D131 BASIC 누락 버그 해결)
> - `app.ts` `startTrialDowngradeWorker()` 등록
>
> **프론트:**
> - `DmBuilderPage.tsx` 403 PLAN_FEATURE_LOCKED 수신 시 violet 가드 화면
> - `AdminDashboard.tsx` 고객사 상세 → "30일 PRO 체험 부여/취소" 버튼 + 모달
> - `PricingPage.tsx` violet 안내 카드 — "현재 무료체험 중인 요금제는 **프로 플랜**입니다" + 기능 나열 + D-N + 만료일 + TRIAL plan 카드 제외
> - `Dashboard.tsx` AI 발송 템플릿 카드 `isAiMessagingLocked` 잠금 표시 (FREE에서 403 토스트 방지)
>
> **DB DDL Step 1:**
> - plans 테이블 4컬럼 추가: `mobile_dm_enabled` / `ai_mapping_enabled` / `target_send_enabled` / `direct_recipient_limit`
> - FREE plan: `plan_name='미가입'`, 플래그 전부 false, `direct_recipient_limit=99999`, `max_customers=99999`
> - STARTER+: 기능 플래그 정책대로 설정
>
> **DB DDL Step 2 (오전 말미 실행):**
> - **TRIAL plan INSERT** (PRO와 기능 동일, `monthly_price=0`)
> - 기존 체험 회사 → `plan_id=TRIAL`로 이동
>
> ---
>
> #### 🅱️ 오후 세션 (subscription_status 네이밍 정리 + D-N 뱃지 추가)
>
> **🚨 발견된 3중 버그 (오후 실화면 검증 중):**
> 1. `admin.ts:384,1031` — 슈퍼관리자 요금제 수정/승인 API가 `subscription_status='active'`로 무조건 덮어쓰기 → grant-trial 후 저장 버튼만 눌러도 'trial' → 'active' 파괴
> 2. `trial-downgrade-worker` SQL에 `AND c.subscription_status='trial'` 조건 → 'active'로 바뀐 체험은 **영원히 강등 못 하는 무제한 체험 버그**
> 3. `PricingPage.isOnTrial` 판정이 `subscription_status='trial'` 기반 → 'active'로 바뀌면 D-N·violet 카드·안내 전부 미표시
>
> **🔍 근본 원인 추적:**
> - `companies.status`('active'/'inactive'/'terminated')와 `subscription_status`('trial'/'active'/'trial_expired'/...) 두 다른 컬럼에 **`'active'` 값이 공존** → 업계 표준('paid')과도 불일치 (CT-17 설계서는 'paid'로 정의했으나 코드는 'active' 사용)
> - 'active'는 회사 운영 상태 용도, 구독 상태는 `'paid'`가 표준. **오픈 D-Day 전에 근본 정리**가 맞다 판단 (Harold님 지시)
>
> **✅ 근본 수정 (옵션 B — 'paid'로 통일):**
> - `utils/plan-guard.ts` `SubscriptionStatus` 타입에서 `'active'` 제거, `'paid'` 공식화 / `isTrialActive` 판정을 `plan_code='TRIAL'` 기반 (subscription_status 의존 제거)
> - `utils/trial-downgrade-worker.ts` SQL에서 `subscription_status='trial'` 조건 제거 — `plan_code='TRIAL' + trial_expires_at<NOW()` 만으로 강등
> - `routes/admin.ts:384` 회사 수정 API: `planId` 있으면 **TRIAL→'trial' / 그 외→'paid'** 분기 (과거: 무조건 'active')
> - `routes/admin.ts:1031` 요금제 승인 API: 동일 분기 로직
> - `routes/companies.ts` revoke-trial 조건을 `plan_code='TRIAL'` 기반으로 (subscription_status 무관 — 'active'로 오염된 체험도 취소 가능) / grant-trial RETURNING에 `plan_code` 추가
> - `PricingPage.tsx` `isOnTrial = plan_code==='TRIAL' && !!trial_expires_at` (견고화) / `isUpgrade` 로직에 TRIAL 추가 → 무료체험 사용자 모든 카드 "업그레이드 신청" (다운그레이드 개념 제거)
> - `AdminDashboard.tsx` grant-trial 응답 후 `planCode: 'PRO'` 하드코딩 → API 응답 `plan_code` 사용
> - `Dashboard.tsx` 요금제 현황 카드에 **violet D-N 뱃지** — "요금제 만료 D-30" (PricingPage와 톤 통일)
>
> **DB 마이그레이션 (5단계, 모두 성공):**
> 1. CHECK constraint 사전 점검 — 없음 확인 (0 rows)
> 2. TRIAL plan인데 'active'로 오염된 1건 → 'trial' 복구 (테스트계정)
> 3. 남은 `'active'` 9건 → `'paid'` 마이그레이션
> 4. 검증: `paid: 9 / trial: 1` — `'active'` 0건
> 5. 테스트계정 재확인: `trial | 2026-05-21 | TRIAL` ✓
>
> **검증 결과:**
> - ✅ 대시보드 요금제 현황: "무료체험" + violet "요금제 만료 D-30" 뱃지
> - ✅ `/pricing`: "무료체험중 (요금제 프로플랜 체험) D-30" + violet 안내 카드 "현재 무료체험 중인 요금제는 **프로 플랜**입니다" + 기능 6종 나열 + 만료일 + 29일 남음
> - ✅ 요금제 비교 카드 5개 전부 **"업그레이드 신청"** (다운그레이드 완전 제거)
> - ✅ Harold님 실화면 최종 검증 통과

---

### 🚛 D135 (2026-04-22) — 레거시 회신번호+수신거부 이관 + 전환 안내 팝업/랜딩 배포 (✅ 완료)

> **세션 기록:** [`.claude/projects/.../memory/project_d135_legacy_callbacks_unsubs.md`](../.claude/projects/C--Users-ceo-projects-targetup/memory/project_d135_legacy_callbacks_unsubs.md)
>
> **배경:** D134 ID 이관 다음날 Harold님 "미리 옮기자" 지시로 5/5 D-Day 전 선제 진행. 레거시 Agent 아직 구동 중이라 예약발송은 5/5에 남김. 오후 데이터 이관 + 저녁 전환 안내 UI 배포까지 한 세션에 통합.

> **🎨 저녁 추가 작업 — 전환 안내 UI 2중 레이어 배포:**
> - **팝업 (footer include)** `/www/usom/WebContent/inc/migration-popup.jsp` 10,457 → **13,924 bytes** 교체
>   - D-Day 실시간 카운트다운 배지 (pulse 애니메이션)
>   - 혜택 배너 최상단에 ✅ "회신번호·수신거부 자동이관 완료" 1줄 추가
>   - 임시 비번 `qwer1234!` 하드코딩 → "안내받으신 임시 비밀번호" **추상화** (공개 페이지 자격증명 노출 금지)
>   - 보조 outline CTA "자세한 내용을 확인하세요" → `/transition` 연결
>   - 커스텀 스크롤바 (`scrollbar-width:thin` + 상하 20px margin)
> - **랜딩** `https://www.invitobiz.com/transition` 신규 배포 (`/usr/local/nginx/html/transition.html` 47,736 bytes)
>   - Claude.ai `frontend-design` artifact 초안 → Claude Code가 비번 5곳 제거 / Cloudflare email 난독화 제거 / `app.hanjul.ai`→`hanjul.ai` 전역 / `11년`→`10년` / Footer 중복 링크 제거
>   - Nginx 설정: `charset utf-8;` 앵커로 sed 안전 삽입 — `location = /transition` exact match (기존 `location /` Tomcat 프록시 영향 0)
>   - 구성: Hero D-Day count-up + Core 3 + 3-step Guide + Migration Checklist + Big CTA + FAQ + Footer
> - **로컬 원본**: `docs/legacy-popup.html` / `docs/transition.html` / `docs/migration-popup.jsp`
> - **배포 절차 8단계** 전부 Harold님 SSH 실행 (CLAUDE.md 원칙 — AI는 서버 접속 금지, 명령어만 안내) → 브라우저 시크릿창 실화면 검증 통과
>
> **🎓 핵심 교훈 (메모리 반영):**
> 1. **공개 페이지 임시비번 하드코딩 금지** — `feedback_no_secret_in_public_page.md` 신설. qwer1234! 노출이 Claude 수동편집 + Claude.ai artifact 양쪽에서 재발 → grep 검증 루틴 필수
> 2. **Nginx 1.6.3 단일파일 sed 안전 삽입** — `charset utf-8;` 유일 라인 앵커로 사용하여 다른 server 블록 영향 없이 삽입, diff로 정확히 추가 라인만 확인 후 reload
> 3. **JSP include는 컴파일 시점 include** — `<%@ include %>`는 호출하는 쪽(footer.jsp) touch로 재컴파일 유도, Tomcat 재시작 불필요
>
> ---
>
> **📊 오후 데이터 이관 결과:**
>
> **이관 결과:**
> | 테이블 | INSERT | 비고 |
> |---|---:|---|
> | callback_numbers | 1,492 | label='레거시', 단독 scope='all' / 다중 scope='assigned' |
> | callback_number_assignments | 1,051 | 다중회사 18곳 배정, assigned_by=해당 company admin |
> | unsubscribes | 321,389 | source='legacy_migration', user 265,619 + admin 합집합 55,770 (D88 정책) |
>
> **정합성 검증 PASS (141/141):** `expected-per-user.json` ↔ `verify_actual.csv` 자동 비교 — 단독회사 admin, 다중회사 user 개별 배정, 다중회사 admin 합집합 DISTINCT 전부 일치.
>
> **발생 이슈 + 해결:**
> 1. `assigned_by` NOT NULL (SCHEMA.md 불일치, D134 교훈 재발) → `admin_user_id` 채움, 전면 롤백 후 재실행
> 2. `unsubscribes` UNIQUE(user_id, phone) 실제 DB엔 없음 (SCHEMA.md 불일치) → ON CONFLICT 제거, JS Map DISTINCT로 대체
> 3. Oracle `BLOCKEDNUM.CREATEDT` NULL + `MEMBER_SEND_NUM.REG_DT` VARCHAR2 → 타임스탬프 덤프 제외, USERID+PHONE 2컬럼만
> 4. sqlplus 로케일 → `LANG=C NLS_LANG=AMERICAN_AMERICA.UTF8`
> 5. oracle `su - oracle` 다단 명령 붙여넣기로 4회 비번 실패 (계정잠금 직전) → `whoami` 확인 후 우회
> 6. BLOCKEDNUM 58,209건(18%) 정규화 탈락 중 94%가 빈 phone — 레거시 "쌓아두기" 관행 실증
> 7. Windows SCP 0바이트 문제 → `cat` 결과 채팅 붙여넣기 우회
>
> **작업 디렉토리** `migrate-legacy/`:
> - scripts 7종: build-user-map / analyze-coverage / gen-dump-sql(+v2) / build-migration-sql / gen-verify-sql / compare-verification
> - data: 매핑 JSON 3종 + 원본 CSV 2종 + 이관 SQL 2종 + expected/actual + verification-report.json
> - 5/5 예약발송 이관 시 동일 디렉토리 재활용
>
> **핵심 교훈:**
> 1. **SCHEMA.md 맹신 금지 — D134/D135 연속 재발**. SQL 작성 전 `information_schema.columns` + `pg_constraint` 선행 필수
> 2. **다단 SSH 명령 블록 일괄 붙여넣기 금지** — 엔터 타이밍 어긋남으로 비번란에 잔여 문자 → 계정잠금 위험
> 3. **expected vs actual 자동 비교 스크립트**가 정합성 보증의 표준 — 141명 unsub/cb_assign 완전 일치 확인
> 4. **레거시 Oracle DATE vs VARCHAR2 혼재** — 덤프 전 `DESC TABLE` 필수
> 5. **다중회사 admin 합집합 (D88 정책) 정상 동작 확인** — 18개 전 회사에서 검증

---

### 🔄 D134 (2026-04-22 밤늦게) — 레거시 ID 일괄 이관 (62 회사 + 141 사용자) + 후속 UI 수정 (✅ 완료)

> **세션 기록:** [`.claude/projects/.../memory/project_d134_legacy_migration.md`](../.claude/projects/C--Users-ceo-projects-targetup/memory/project_d134_legacy_migration.md)
>
> **배경:** 오픈 D-Day(5/5) 대비. 서팀장 `ID 신규생성리스트.xlsx`(123명 / 62 회사, 이관완료 6명 제외) 기준 회사·사용자 일괄 SQL 생성·실행. 직원 수작업 며칠→SQL 한 번에 처리.
>
> **규칙 (Harold님 확정):**
> - 단독 회사 (1명, 44개) → 기존 유저ID 그대로 `admin` 승격 (회신번호 등록 권한 필수)
> - 다중 회사 (2명+, 18개) → 영문명+`01`/`a` 신규 `admin` ID 18개 생성 + 기존 멤버 전부 `user`
> - 접미 규칙: 영문명에 숫자 포함 → `a` / 없음 → `01`
> - 임시 비밀번호 `qwer1234!` + `must_change_password=true`
>
> **자동화:** `_temp_generate_sql.js` — xlsx 읽기 + bcryptjs hash + UUID 생성 + SQL 조립 → `legacy_migration.sql` 53KB → `psql -1` 단일 트랜잭션 실행
>
> **🚨 발생 이슈 + 수정:**
> 1. `users_user_type_check` CHECK 위반 — DB 허용값 `('admin','user','system')`인데 코드 용어 `company_admin`/`company_user`로 INSERT 시도 → `admin`/`user` 교정 후 재실행 성공
> 2. 슈퍼관리자 고객사 목록 "총 20개" 표시 — `companiesApi.list()` 기본 limit 20 → `{ limit: 1000 }` 교정 (`AdminDashboard.tsx:997`)
> 3. 사용자 목록 회사 그룹 무한 스크롤 — `userPage` state + 20개씩 페이지네이션 + 검색/필터 변경 시 1페이지 리셋
>
> **최종 검증:**
> - companies 10 → **72** (신규 62)
> - users 30 → **171** (admin 69 / user 93 / system 9)
> - login_id 중복 0건
> - 슈퍼관리자 UI 정상 표시
>
> **배포 완료:** DB INSERT 성공 + 프론트 UI 수정 `tp-deploy-full` 배포
>
> **남은 작업 (오픈 D-Day까지):**
> - 영업팀 임시 비밀번호 안내 (`qwer1234!` + 다중 회사 18개 관리자 ID)
> - 영문명 검색권장 19개 서팀장 확정 시 변경 (bacon/paige/nsb/jisam/chaumet 등)
>
> **핵심 교훈 (CLAUDE.md 반영):**
> 1. DB CHECK 제약은 `pg_constraint` 쿼리 선행 필수 (SCHEMA.md 맹신 금지)
> 2. INSERT 사전 충돌 검사는 UNIQUE + CHECK 둘 다
> 3. 프론트 `pagination.total` vs `배열.length` 혼동 주의 (큰 리스트는 `{limit:1000}` 명시)
> 4. xlsx 병합셀 `sheet_to_json` 무시 → `sheet['!merges']` 상속 처리 필수
> 5. 코드 용어(company_admin) vs DB 실값(admin) 불일치 문서화 필요

---

### 📊 D133 (2026-04-22 밤) — 대시보드 카드 상세 개선 + 고객 DB 다운로드 (Phase A+B 통합 — ✅ 배포+실화면 검증 완료)

> **세션 기록:** [`.claude/projects/.../memory/project_dashboard_card_detail.md`](../.claude/projects/C--Users-ceo-projects-targetup/memory/project_dashboard_card_detail.md)
>
> **배경:** Harold님 대시보드 피드백 2건 — (1) DB 현황 카드 "언밸런스" (count 카드 숫자만 / distribution 카드 프로그레스바 꽉 참 → 밀도 불균형) (2) 각 카드 클릭 시 세부 지표 모달 원함. 추가 요청: 고객DB 현황 모달에 필터 조건 유지된 채 엑셀 다운로드.
>
> **✅ Phase A — 델타 뱃지 + 고객 DB 다운로드:**
> - 백엔드 `routes/companies.ts` `CardDataResult` 인터페이스 4필드(delta/deltaPercent/deltaBaseline/hasTrend) 확장 + `aggregateDashboardCards`에 30일 전 동일 시점 카운트 동시 집계 + `calcDelta` 헬퍼 추가. count 카드 7종 델타 계산 (total/gender_male/gender_female/opt_in_count/new_this_month/recent_30d_purchase/inactive_90d)
> - 백엔드 `routes/customers.ts` `GET /api/customers/download` 신설 — **CT-01 `buildDynamicFilterCompat` 재활용** + XLSX 응답. 한글 헤더 20컬럼 + gender enum 역변환(M→남성/F→여성) + sms_opt_in Y/N 변환 + customer_field_definitions 기반 custom_fields 평면화(동적 컬럼)
> - 프론트 `components/dashboard/DeltaBadge.tsx` **신설** — 증가 green / 감소 red / 변화없음 gray 뱃지 (PricingPage violet 톤)
> - 프론트 `Dashboard.tsx` `DashboardCardData` 4필드 확장 + 카드 렌더링에 델타 뱃지 1줄 추가 ("지난달 대비" 라벨 함께) + hover violet 테두리
> - 프론트 `components/CustomerDBModal.tsx` 헤더 우측 violet 그라디언트 "엑셀 다운로드" 버튼 + `handleDownload` (현재 `activeFilters`/`filterSmsOptIn`/`filterStoreCode` 그대로 query string으로 전달 → Blob 다운로드)
>
> **✅ Phase B — 카드 클릭 상세 모달 + 타겟 발송 연계:**
> - 백엔드 `routes/companies.ts` **`GET /api/companies/dashboard-cards/:cardId/detail`** 신설. 카드 타입별 자동 분기:
>   - **trend** (6개월 월별): count 카드 7종. generate_series + 상관 서브쿼리로 각 월말 기준 누적 카운트 (new_this_month는 해당월 신규, recent_30d_purchase는 각 월말 기준 최근 30일, inactive_90d는 90일 이상 비활성)
>   - **breakdown**: 성별/연령대/등급/지역 4종 (Promise.all 병렬), gender enum 역변환, 연령대는 10대 단위 CASE
>   - **topList** (생일 카드 전용): 이름/전화 검색(q) + 페이지네이션(page/limit). name ILIKE OR phone ILIKE
>   - **fullDistribution** (distribution 카드): 전체 확장 (age/grade/region/store, LIMIT 상향)
> - `npm install recharts` (React 친화 차트 라이브러리, ~50KB gzipped)
> - 프론트 `components/dashboard/CardDetailModal.tsx` **신설** — FileUploadMappingModal violet 톤 100% 계승 (그라디언트 헤더/rounded-2xl/shadow-xl). 구조:
>   - 요약 카드 2개 (현재값 + 지난달 대비 DeltaBadge)
>   - recharts `LineChart` 6개월 추이 (violet stroke + 그라디언트 필)
>   - breakdown 4칸 (성별/연령/등급/지역 프로그레스 바)
>   - 생일 카드: BirthdayCustomerList 렌더
>   - distribution 카드: fullDistribution 리스트
>   - 푸터 CTA: "닫기" + violet 그라디언트 **"타겟 발송 바로가기"** (cardId별 필터 매핑 후 부모 콜백)
> - 프론트 `components/dashboard/BirthdayCustomerList.tsx` **신설** — 검색 input + 페이지네이션(이전/다음) + 테이블(이름/전화/성별/생일/등급/총구매/최근구매). 페이지당 20건, violet 톤
> - 프론트 `components/DirectTargetFilterModal.tsx` **`initialFilters` optional prop 추가** (하위호환 — undefined면 기존 `sms_opt_in=true` 기본 유지). 주입 시 `selectedFields`/`filterValues` 자동 세팅. 기존 5개 호출부(Dashboard/DirectPreviewModal/TargetSendModal/KakaoRcsPage) 영향 없음
> - 프론트 `Dashboard.tsx` 카드 `onClick={() => setDetailCard(card)}` + CardDetailModal state(`detailCard`, `cardTargetFilters`) 연결 → "타겟 발송 바로가기" 클릭 시 `cardTargetFilters` 세팅 후 `showDirectTargeting=true`로 자동 연계
>
> **🛡️ 끌로드원칙 준수:**
> - **CT-01 재활용** (다운로드 API는 `buildDynamicFilterCompat` 직접 호출) / CT-02(store-scope) 재활용
> - 하드코딩 금지 (cardId/라벨/field_key 동적), 기간계 무접촉, 인라인 금지(3컴포넌트 별도 파일), 하위호환(DirectTargetFilterModal)
> - 타입 체크 백엔드/프론트 모두 **0 error**
>
> **🛠 덤 — CT-07 `field_type_check` 위반 근본 방어 (체크리스트 처리):** 로그 추적 결과 upload.ts:793 `fieldType = 'NUMBER'` 하드코딩(비표준) + CT-07 `toDbFieldType`의 대소문자 폴백 일부 엣지 취약. 3중 방어:
> 1. `upload.ts:793` `'NUMBER'` → `'INT'` (DB CHECK 표준값 직접 사용, 호출부 통일)
> 2. `utils/standard-field-map.ts` `FIELD_TYPE_DB_MAP`에 대문자 변형 8종 명시 추가 (`NUMBER`/`STRING`/`DATETIME`/`FLOAT`/`DECIMAL`/`BIGINT`/`TIMESTAMP`/`BIT`) + `toDbFieldType`에 `String(input).trim()` + 대문자/소문자 2단 폴백 + 매핑 실패 시 warning 로그
> 3. upsert 에러 로그에 `inputType` + `dbType` + `labelLen` 명시 — 재발 시 즉시 원인 특정
>
> **배포 (✅ 반영 완료):** `tp-push` → 서버 `git pull` + `npm run build` + `pm2 restart all`. grep 6건으로 dist/ 전수 확인 완료.
>
> **검증 체크리스트 (배포 후):**
> - [ ] DB 현황 count 카드에 violet/green/red 델타 뱃지 (`↑ +240 (+2.4%) 지난달 대비`)
> - [ ] 카드 hover → violet 테두리 + cursor pointer
> - [ ] 카드 클릭 → 상세 모달 (violet 헤더 + 요약 + 6개월 라인차트 + breakdown 4칸)
> - [ ] 생일 카드 상세 → 검색/페이지네이션 테이블
> - [ ] distribution 카드(연령/매장) 상세 → 전체 확장 리스트
> - [ ] "타겟 발송 바로가기" → DirectTargetFilterModal 자동 필터 적용 (예: 남성 → gender=M)
> - [ ] 고객 DB 조회 모달 → "엑셀 다운로드" 버튼 → 필터 적용된 XLSX 다운 (한글 헤더 + 성별/수신동의 변환 확인)

---

### 🔥 D131 (2026-04-21 저녁) — Agent v1.5.1 + 알림톡 IMC 6005 + 담당자테스트 9007 + PPT 9건 일괄 처리

> **세션 기록:** [`.claude/projects/.../memory/project_d131.md`](../.claude/projects/C--Users-ceo-projects-targetup/memory/project_d131.md) — 8섹션 전수 기록
>
> **싱크에이전트 v1.5.1** (수란님 긴급):
> - Windows 서비스 1053 에러 cwd 교정 (patch 3줄)
> - 버전 0.1.0 → 1.5.1 통일 (6곳)
> - **normalize 전면 미러링**: `sync-agent/src/normalize/index.ts`를 백엔드 `utils/normalize.ts`와 1:1 복제 + `field-map.ts` 신설 + 개별 6파일 삭제. 서수란 팀장 제보(포인트 "1,800"→NULL, 등급 한글→영문) 근본 해결.
> - 빌드: `sync-agent.exe` v1.5.1 (113.9MB) + `SyncAgent-Setup-1.5.1.exe` NSIS (19.4MB). 구버전 삭제 완료.
>
> **알림톡 IMC 템플릿 등록 6005 해결**:
> - 근본: `templateKey` 길이. IMC 공식 문서 128자 표기 but 실제 20자 (휴머스온 인정). `T{base36}` 20자 교정.
> - `handleImcError` IMC 응답 body + `createAlimtalkTemplate` 요청/응답 로깅 추가 (이전엔 서버 로그 0건).
> - 이중 래핑 자동 unwrap (D130 §2-1 블로커 해결).
> - 부수: 검수 알림 수신자 10→3명 + name 필수 + 동일 yellow_id 중복 등록 409 + `customSenderKey` UI/백엔드 제거 + `SenderData` 11필드 확장 + `listSenders` 파라미터 스펙 준수 + `syncSenderStatusJob`에 uuid→yellow_id 동기화.
>
> **담당자 테스트 9007 파일 오류** (37% 실패, 서수란 팀장 제보):
> - 근본: MMS + 이미지 0장 → QTmsg Agent가 파일 없음 → status_code=9007 반려 → 단말 미도달.
> - **3계층 가드**: `utils/mms-validator.ts` 컨트롤타워 신설 (인라인 3곳 작성 후 Harold님 지적받아 리팩터) → 라우트 3곳(test-send/direct-send/POST /) CT 호출 + `insertTestSmsQueue` throw + 프론트 4곳(handleTestSend/handleTargetTestSend/executeTargetSend/handleAiCampaignSend selectedChannel 교정).
>
> **PPT 9건 일괄 수정** (서수란 팀장):
> - #2 SMS 광고 빈줄 `\n\n→\n` (buildAdMessage 백/프론트 미러) · #4 맞춤한줄 MMS 이미지명 · #5 엑셀 수신확인시간 헤더 제거 · #6 취소건 `(예약취소)` · #7 MMS 미리보기 일관성 · #8 기간조회 limit 50→2000 · #9 예약대기 이미지명 · #10 자동발송 스팸필터 샘플 callback 폴백
>
> **FileUploadMappingModal violet 톤업** (전단AI 스타일 이식):
> - 헤더 그라디언트 + AI 이모지 뱃지 · 드래그/드롭 영역 + SVG 스피너 + 3단계 dots + 진행바 · 안내카드 드래그영역 밖 분리(눌린 느낌 수정) · rounded-2xl + 그림자
>
> **DB 정리**: `kakao_sender_profiles` truncated row 1건 삭제 완료.
>
> **메모리 반영**: `feedback_mirror_hanjul_standard.md` D131 추가 교훈 — Agent 미러 범위는 파일 단위로 전체 복제, 개별 분기 금지.
>
> **배포 대기**: Harold님 `tp-push` + `tp-deploy-full` + 수란님 exe 전달 + NSIS Setup 배포.

---

### 🔗 Sync Agent v1.5.0 — ✅ Day 1~3 전구간 구현 + 배포 완료 (2026-04-18)

> **배경:** 한줄로AI 최신화 맞춰 싱크에이전트 재정의 + AI 자동 매핑 + Linux/Windows 전 환경 커버.
> **설계서:** [`status/SYNC-AGENT-V1.5.0-DESIGN.md`](SYNC-AGENT-V1.5.0-DESIGN.md)
> **QA 가이드:** [`status/SYNC-AGENT-V1.5.0-QA-GUIDE.md`](SYNC-AGENT-V1.5.0-QA-GUIDE.md) — 8개 시나리오 (A~H)
> **릴리스 노트:** [`status/SYNC-AGENT-V1.5.0-RELEASE-NOTES.md`](SYNC-AGENT-V1.5.0-RELEASE-NOTES.md)
> **고객 배포용 매뉴얼:** [`sync-agent/SyncAgent_설치매뉴얼_v1_5.docx`](../sync-agent/SyncAgent_설치매뉴얼_v1_5.docx) (내부 스키마/AI 모델명 전부 배제)
> **다음 세션 핸드오프:** [`status/SYNC-AGENT-V1.5.0-SESSION-HANDOFF.md`](SYNC-AGENT-V1.5.0-SESSION-HANDOFF.md)
> **배포:** v1.5.0 빅뱅. 파일럿 없음 (기존 사용자 0).

#### ✅ 완료 (2026-04-18 단일 세션)
- **Day 1 백엔드** (7파일): `utils/ai-mapping.ts` CT + `routes/sync.ts` 확장 (`/ai-mapping`, `/field-map`, 응답 config, 3단 수신거부) + `auth.ts` is_system 차단 + `middlewares/sync-active-check.ts` + `routes/customers.ts`/`upload.ts` blockIfSyncActive + `routes/companies.ts` 시스템 user 자동 생성
- **Day 2 Agent** (14파일): types/customer.ts 레거시 9개 제거 / normalize/phone.ts normalizeStorePhone / scheduler 6h주기 + pollRemoteConfig 제거 + applyRemoteConfig / api/client.ts setRemoteConfigHandler + aiMapping + getFieldMap / setup/ai-mapping-client.ts 신규 / mapping/index.ts suggestMappingWithAI / setup-html.ts Step 4 AI 버튼 / cli.ts AI 대화형 / edit-config.ts aiRemap / index.ts ApiClient↔Scheduler 연결
- **Day 3 프론트** (2파일): `SyncActiveBlockModal.tsx` 신규 + `Dashboard.tsx` sync_block_active 수신 + 업로드 3곳 체크
- **DB 마이그레이션 적용**: users.is_system + customers.customer_code + customer_code_sequences + plans.ai_mapping_monthly_quota + companies.ai_mapping_calls_month/last_month. user_type CHECK 제약 확장 ('system' 허용). 9개 회사 시스템 user 자동 생성 + customer_code `{company_code}-000001` 부여
- **tsc 0 에러 전영역** (backend + sync-agent + frontend)
- **Git push**: commit `c5f2393` ("0418 싱크에이전트 대규모 업데이트 및 마이그레이션")
- **tp-deploy-full 배포 완료**
- **고객 배포용 매뉴얼 docx 작성** (내부 스키마 전부 배제 버전)

#### ✅ 빌드 완료 (2026-04-20)
1. **sync-agent 빌드 — 4개 산출물 전부 생성**:
   - `sync-agent/release/sync-agent.exe` (108.7MB, Windows pkg)
   - `sync-agent/release/sync-agent` (121.8MB, Linux pkg)
   - `sync-agent/installer/SyncAgent-Setup-1.5.0.exe` (18.5MB, NSIS)
   - `sync-agent/installer/SyncAgent-1.5.0-linux-x64.tar.gz` (36.4MB)
2. **불필요 파일 정리** — sync-agent/ 폴더 1.7GB → 532MB (구버전 인스톨러 12개 + 오래된 로그 삭제)

#### ⚠️ 빌드 중 이슈 기록 (향후 정리 필요)
- **`build-installer.bat` 인코딩**: BOM 없는 UTF-8 → PowerShell에서 cmd.exe 파싱 시 한글 깨져 `'S' is not recognized` 등 에러. 우회책으로 PowerShell에서 `makensis.exe` 직접 호출. **향후 수정 필요:** UTF-8 BOM 추가 또는 CP949 재저장
- **`package.json` version `"0.1.0"` 방치**: 빌드 CLI 인자로 버전 주입하는 구조라 기능상 무해하지만 `"1.5.0"` 정정 권장
- **pkg 경고 무시 OK**: `Cannot resolve 'mod'`, `xdg-open`, `Failed to make bytecode` 등 v1.4 동일 경고로 실제 동작 영향 없음

#### 🚧 남은 작업 (다음 세션 — Harold님 직접)
1. **GitHub Releases v1.5.0 등록** — 4개 빌드 산출물 업로드
2. **`sync_releases` 테이블 v1.5.0 INSERT** — 자동 업데이트 활성화 (서버 PG에서 실행)
3. **서팀장 QA** — `SYNC-AGENT-V1.5.0-QA-GUIDE.md` 8개 시나리오 E2E 테스트
4. **QA 이슈 반영** (발생 시 BUGS.md 등록 후 수정)
5. **첫 고객사 배포** — Windows 인스톨러 + 매뉴얼 docx 전달

#### ⚠️ 배포 중 배운 교훈
- **GitHub 100MB 제한**: 빌드 산출물(.exe, linux 바이너리, zip)은 반드시 `.gitignore`로 제외. `sync-agent/release/`, `installer/release/`, `*.exe`, `*.zip` 추가됨. 배포는 **GitHub Releases** 사용 권장 (2GB까지)
- **fail2ban restart 주의**: `systemctl restart fail2ban` 하면 Currently banned 목록이 리셋됨 → 공격자 IP 다시 차단되지 않음. 영구 차단이 필요하면 iptables 사용. 이번엔 원래 10개 차단 수동 복구 완료
- **서버 비밀번호 실수 방지**: SSH 키 인증은 로컬 PC 해킹 시 동일 리스크라 Harold님 보류. 대신 신중하게 한 번에 입력 + 실수 시 핫스팟으로 IP 밴 해제하는 방식 유지

---

### 📨 D130 — 알림톡/브랜드메시지 IMC 연동 Phase 1 — 🔄 2026-04-21 화요일 실점검 + 전수감사 진행 중

> **다음 세션 필독:** [`status/D130-NEXT-ACTIONS.md`](D130-NEXT-ACTIONS.md) — 남은 블로커 + 우선순위 + 실패 대응 가이드 포함

> **배경:** 레거시에서 수동으로 하던 "템플릿 관리자 + 발신프로필 등록"을 한줄로에 재구현 + 휴머스온 IMC API 연동으로 자동화.
> 승인 상태는 웹훅으로 실시간 반영 → 발송 시 `status='APPROVED'`만 노출 → 레거시의 수동 확인 절차 제거.
> **설계서:** [`status/ALIMTALK-DESIGN.md`](ALIMTALK-DESIGN.md) (1,735줄)
> **플랜:** [`.claude/plans/hidden-twirling-waffle.md`](../.claude/plans/hidden-twirling-waffle.md)
> **🚨 다음 세션 필독:** [`status/D130-SESSION-HANDOFF.md`](D130-SESSION-HANDOFF.md) — 현재 진행 상태 스냅샷 + Day 2 착수 순서 완전본

#### 🎯 Harold님 확정 정책 (2026-04-18 세션 종료 시점)
| 자원 | 등록 | 승인 | 조회·사용 범위 |
|------|------|------|-------------|
| **발신프로필** (회사 자산) | `company_admin`만 | `super_admin`만 | 회사 전체 공유 (승인 완료된 것만) |
| **알림톡 템플릿** (개인 자산) | 모든 로그인 사용자 | 카카오 검수 | `company_user`: 본인 등록 것만 / `company_admin`: 회사 전체 / `super_admin`: 전체 |

#### Day 1 완료 (2026-04-18)
**DB (Harold님 서버 psql 직접 실행):**
- ALTER `kakao_sender_profiles` +13 컬럼 / ALTER `kakao_templates` +14 컬럼
- CREATE 5종: `brand_message_templates` / `kakao_alarm_users` / `kakao_sender_categories` / `kakao_template_categories` / `kakao_webhook_events` / `kakao_image_uploads`
- 인덱스 전부 포함, 모두 IF NOT EXISTS + nullable (기간계 무접촉)

**백엔드 (tsc 0 — Harold님 `npm install axios form-data` 필요):**
- **CT-16** `utils/alimtalk-api.ts` — 39개 함수 (발신프로필 11 + 템플릿 13 + 알림수신자 4 + 카테고리 2 + 이미지 9). Lazy init, env 미설정 시에도 부팅 가능
- **CT-17** `utils/alimtalk-result-map.ts` — IMC 응답코드 맵 + 리포트 코드 맵 (resolveImcCode, resolveReportCode)
- **CT-18** `utils/alimtalk-webhook-handler.ts` — processKakaoWebhook + verifyWebhookSignature (HMAC-SHA256) + isAllowedWebhookIp + generateMessageKey(CR_/DS_/TS_/AC_)
- `utils/alimtalk-jobs.ts` — 카테고리 일일 동기화(03:00 KST) / 검수 템플릿 폴링(5분) / 발신프로필 상태(1시간). env 미설정 시 no-op
- `routes/alimtalk.ts` — 33 엔드포인트 전부 구현 (발신프로필 + 카테고리 + 템플릿 + 브랜드 + 이미지 + 알림수신자 + 웹훅)
- `app.ts` — 라우트 등록 + webhook raw body parser + scheduler
- `routes/companies.ts` — kakao-profiles/kakao-templates 기존 섹션에 @deprecated 주석만 추가 (로직 수정 0)

**프론트 (tsc 0 통과):**
- `pages/AlimtalkTemplatesPage.tsx` — 고객사 템플릿 목록 + 상태 배지(DRAFT/REQUESTED/REVIEWING/APPROVED/REJECTED/DORMANT) + 필터 + 검수요청/취소/삭제
- `pages/AlimtalkSendersPage.tsx` — 슈퍼관리자 발신프로필 목록 + 등록 Wizard + 080 설정 + 휴면해제
- `components/alimtalk/SenderRegistrationWizard.tsx` — 3-Step (채널ID/카테고리 → 인증번호 요청 → 인증번호 입력)
- `components/alimtalk/UnsubscribeSettingModal.tsx` — 080 무료수신거부 설정
- `components/alimtalk/AlimtalkTemplateFormV2.tsx` — **16조합 동적 UI** (BA/EX/AD/MI × NONE/TEXT/IMAGE/ITEM_LIST) + 실시간 미리보기
- `components/alimtalk/AlimtalkPreview.tsx` — 카톡 말풍선 실시간 렌더
- `components/alimtalk/ButtonEditor.tsx` — 버튼 9종 타입(WL/AL/DS/BK/MD/BF/BC/AC/PD) 최대 5개
- `components/alimtalk/QuickReplyEditor.tsx` — 빠른답장 5종 타입 최대 10개
- `components/alimtalk/ItemListEditor.tsx` — header + highlight + list(10) + summary
- `components/alimtalk/KakaoChannelImageUpload.tsx` — 업로드 타입 9종 공용 래퍼
- `components/alimtalk/AlarmUserManager.tsx` — 검수 알림 수신자 회사당 10명 관리
- `App.tsx` — `/alimtalk-templates` (고객사) + `/admin/alimtalk-senders` (슈퍼관리자) 라우트
- `DashboardHeader.tsx` — "알림톡" 메뉴 추가 (카카오&RCS 옆)
- `AdminDashboard.tsx` — 헤더 "알림톡 발신프로필" 버튼

**DB/컨트롤타워 보존:**
- ❌ 수정 금지: `utils/brand-message.ts` (CT-12), `utils/sms-queue.ts` (CT-04), `routes/campaigns.ts` 5경로, `routes/auto-campaigns.ts`, `utils/auto-campaign-worker.ts` — 기간계 무접촉

#### 🛠️ Day 1 추가 실수 수정 (2026-04-18 오후)
- ✅ 헤더 **"알림톡" 중복 메뉴 제거** — `카카오&RCS` 탭 안에 이미 있었음
- ✅ `/alimtalk-templates` 라우트 제거 + `pages/AlimtalkTemplatesPage.tsx` 삭제
- ✅ `components/alimtalk/AlimtalkManagementSection.tsx` 신규 — KakaoRcsPage 알림톡 탭 내부에 통합 렌더
- ✅ KakaoRcsPage 레거시 state/모달 정리 (기존 AlimtalkTemplateFormModal 제거)
- ✅ 발신프로필 등록 권한 `super_admin` → `company_admin` 완화 (이후 Harold님 정책 확정으로 유지)
- ✅ 백엔드 승인/반려 엔드포인트 추가: `PUT /senders/:id/approve`, `PUT /senders/:id/reject` (super_admin 전용)
- ✅ POST `/senders` 등록 시 `approval_status` 자동 설정 (super_admin=APPROVED, company_admin=PENDING_APPROVAL)
- ✅ AlimtalkManagementSection에 승인 상태 배지 + "승인 대기 중 안내" 문구 추가
- ✅ `tp-deploy-full` PowerShell 프로필 롤백 (`$cmds` 배열 방식 → 한 줄 쌍따옴표 방식, `Connection closed` 재발 방지) + `backend npm install` + `flyer-frontend` 빌드 포함

#### ✅ Day 2 완료 (2026-04-18 오후 연속 세션)

**DB ALTER (Harold님 서버 psql 실행 완료):**
- `kakao_sender_profiles` +5컬럼 — `approval_status`(DEFAULT 'PENDING_APPROVAL')/`approval_requested_at`/`approved_at`/`approved_by`/`reject_reason` + idx
- `kakao_templates` +1컬럼 — `created_by uuid REFERENCES users(id)` + idx
- 검증 통과: `\d kakao_sender_profiles` 24컬럼 / `\d kakao_templates` 41컬럼
- 기존 프로필 2건은 테스트 데이터(테스트계정2/인비토, yellow_id 없음)로 PENDING_APPROVAL 상태 유지

**백엔드 템플릿 소유자 체크 (tsc 0):**
- `resolveTemplateContext` 시그니처 확장 — user 파라미터 추가, `company_user`이면 `created_by = userId` 체크, forbidden 반환
- **신규 컨트롤타워 `requireTemplateAccess(req, res)`** — `companyId` 확보 + `resolveTemplateContext` + 404/403 응답 일원화. 13개 호출부의 2단계 패턴을 1단계로 축약
- `POST /templates` — `requireCompanyAdmin` 제거(모든 로그인 사용자 허용) + INSERT에 `created_by` 추가 + 승인되지 않은 발신프로필 사용 차단
- `GET /templates` — `company_user`면 `WHERE created_by = $N` 필터 + `LEFT JOIN users u ON u.id = t.created_by` + 응답에 `created_by_name`/`created_by_login_id`
- `GET /templates/:templateCode` — `requireTemplateAccess` 적용 + 응답 쿼리에도 users join
- `PUT/DELETE/inspect/inspect-with-file/cancel-inspect/release/custom-code/exposure/service-mode` 9개 라우트 — `requireCompanyAdmin` 제거 + `requireTemplateAccess`로 소유자 체크 일원화 (인라인 2단계 패턴 0건)

**프론트 (tsc 0):**
- `pages/AlimtalkSendersPage.tsx` — 승인/반려 UI 완성. 4탭 필터(전체/승인대기/승인완료/반려 + 카운트 배지), 승인 액션, 반려 사유 모달(3자 이상, 최대 500자), 재승인 액션, 반려 사유 인라인 표시, 커스텀 모달(window.confirm/alert 미사용 정책 준수)
- `components/alimtalk/AlimtalkTemplateFormV2.tsx` — `approval_status === 'APPROVED'` 프로필만 드롭다운 노출. 미등록/미승인 상태 안내 문구 + select 비활성화
- `components/alimtalk/AlimtalkManagementSection.tsx` — Template 인터페이스에 `created_by/_name/_login_id` 추가, 목록 테이블에 "등록자" 컬럼 신설(이름 + 로그인 ID 병기)

#### ✅ Day 3 완료 (2026-04-18 야간 연속 세션) — 알림톡 발송창 전구간

**전제 확인 (Harold님 지시):**
- 휴머스온 IMC 발송 API 별도 호출 없음 → QTmsg Agent가 기존 `SMSQ_SEND`에 `msg_type='K'`로 INSERT하면 자동 발송 (QTmsg 매뉴얼 ver4.0 §5 + sample_insert.sql 검증 완료)
- Phase 0 수령 없이도 발송 자체는 가동 가능 (템플릿 승인만 IMC 검수 필요)

**슈퍼관리자 UI 정리:**
- AdminDashboard 상단 "알림톡 발신프로필" 별도 버튼 제거
- 발송 관리 탭 내부 레거시 발신프로필 섹션(Sender Key 수동 입력) + 등록 모달 + 관련 state/handler 전부 제거
- 신규 `components/alimtalk/AlimtalkSendersSection.tsx` — AlimtalkSendersPage의 main 부분을 섹션으로 분리 → AdminDashboard 임베드. AlimtalkSendersPage는 wrapper로 축소.

**SenderRegistrationWizard 고객사 admin 모드 UX 개선:**
- `/api/companies/me` 가상 API 호출 제거 → `useAuthStore.user.company` 직접 참조
- `companies.length === 1`이면 귀속 회사 드롭다운 자체 숨김 (고객사 admin은 본인 회사 자동 고정)
- 카테고리 캐시 비어있을 때 안내 문구를 `singleCompany` 여부에 따라 분기

**신규 공용 컨트롤타워:** `components/alimtalk/AlimtalkChannelPanel.tsx` — 설계서 §6-3-D 반영
- 발신프로필 드롭다운 (승인된 것만, 1개면 자동 고정)
- 템플릿 드롭다운 (status APPROVED/APR/A/approved 호환)
- 변수 자동 매핑 (`#{...}` 추출 + 고객 필드 드롭다운 + `@@fieldKey@@` placeholder)
- 부달 5종 (N/S/L/A/B) + A/B 때만 대체 문구 입력
- 미리보기 (원본/치환 토글, 말풍선 + 강조 타이틀 + 버튼)
- `convertButtonsToQTmsg()` export — QTmsg `{"name1","type1","url1_1","url1_2",...}` 변환
- 단가 표시 제외 (Harold님 지시: 후불 위주라 불필요)

**3경로 발송창 Panel 적용:**
- `DirectSendPanel.tsx` — 알림톡 블록 전체 Panel 교체 + props에 `alimtalkSenders`/`alimtalkProfileId`/`alimtalkNextContents` 추가
- `TargetSendModal.tsx` — 알림톡 블록 Panel 교체 + 동일 props
- `AutoSendFormModal.tsx` — Step 5 탭에 🔔 알림톡 추가, `channel === 'alimtalk'`이면 SMS/LMS/MMS UI 전체 숨김 + Panel 임베드 + 폴백용 발신번호 필드, handleSubmit body에 `channel`/`alimtalk_*` 필드 포함

**버그 수정:** `Dashboard.tsx:540` 타겟발송 `sendChannel: 'kakao'` → `'alimtalk'` (백엔드 `directChannel === 'alimtalk'` 체크와 정합 불일치 해소)

**백엔드:**
- `campaigns.ts /direct-send` — 알림톡 분기에 `alimtalkProfileId`/`alimtalkVariableMap`/`alimtalkNextContents` 파라미터 + 승인 이중 가드(템플릿 status + 프로필 approval_status) + `k_etc_json`에 senderkey 자동 포함 + `#{변수}` 백엔드 치환
- `auto-campaigns.ts POST/PUT` — `channel`/`alimtalk_profile_id`/`alimtalk_template_id`/`alimtalk_template_code`/`alimtalk_variable_map`/`alimtalk_next_type`/`alimtalk_next_contents` 7개 컬럼 INSERT/UPDATE
- `auto-campaign-worker.ts executeAutoCampaign` — `channel === 'alimtalk'` 분기 → `insertAlimtalkQueue` 호출 (승인 가드 + variable map 치환 + senderkey etcJson)
- `alimtalk-senders` 화면용 DB/SELECT 정상. Dashboard.tsx `loadKakaoTemplates`는 `/api/alimtalk/senders` 병렬 로드로 `alimtalkSenders` 세팅

**검증:**
- 백엔드 `npx tsc --noEmit` 0 에러
- 프론트 `npx tsc --noEmit` 0 에러
- 잔존 인라인 알림톡 UI 0건 (DirectSendPanel/TargetSendModal/AutoSendFormModal 전부 Panel)

#### ✅ 2026-04-18 야간 배포 완료 (Day 1+2+3)
- 로컬: 백엔드/프론트 tsc 0
- 서버 DB: Day 2 DDL + Day 3 `auto_campaigns` 알림톡 7컬럼 반영
- 서버 코드: tp-deploy-full 완료

#### 🔄 2026-04-21 화요일 — Phase 0 수령 + 전수감사 + 버그 7건 수정

**Phase 0 (IMC 운영 API 키) 수령:**
- ✅ `IMC_API_KEY` (운영계) — 서버 `.env` 주입 + pm2 restart 완료
- ✅ `IMC_BASE_URL_PRD=https://msg-api.humuson.com`
- ✅ `IMC_WEBHOOK_ALLOWED_IPS=121.189.17.243,121.189.17.244`
- ❌ `IMC_WEBHOOK_HMAC_SECRET` — 폴링으로 대체, Phase 2 전 수령 필요
- ❌ `IMC_API_KEY_SANDBOX` — Phase 1은 운영계 관리 API로 충분

**IMC 스펙 전수감사 (Harold님이 `C:\Users\ceo\Downloads\imc_extracted\` 55개 공식 문서 페이지 직접 저장해서 제공):**
- Day 1~3 구현이 설계서 추측 기반이었음이 드러남 → 버그 7건 발견·수정
- 직접 Read한 파일 15개 (템플릿 13 + 알림수신자 2 + 응답코드 1)
- 미직접 대조 파일 17개 (발신프로필 9 + 템플릿 카테고리 2 + 알림수신자 2 + 브랜드메시지 5) → `D130-NEXT-ACTIONS.md §3`에 목록

**확정·수정된 버그 7건 (tsc 0):**
1. `listSenderCategories` 응답 이중 래핑 `data.data` + flat 11자리 (2026-04-21 오전 실측 후 서버 DB 272건 반영 완료)
2. 알림톡 검수요청(첨부): `/comment-with-file` → `/comment/file`, multipart `file` → `attachment`
3. 알림톡 노출 여부 수정: `/exposure` → `/show-yn`, body `exposureYn` → `showYn`
4. 알림톡 검수요청 취소: `/comment-cancel` → `/comment/cancel`
5. Button/QuickReply 필드명 camelCase → snake_case 자동 변환 (`normalizeTemplateBodyForImc`)
6. 알림수신자 `alarmUserId` → `alarmUserKey` (body + URL path + DB INSERT 값)
7. 카카오 리포트 코드 1001~1004 오매핑 교정 + 11개 → 55개 확장

**남은 🔴 블로커 (다음 세션 착수 시점):**
- 2-1: `createAlimtalkTemplate` 응답 이중 래핑 가능성 → Harold님 실점검 시 `template_code` null 여부 확인으로 확정
- 2-2: `listSenders` 파라미터 불일치 (`count→size`, `yellowId→uuid`, 12개 필터 누락) — 발신프로필 목록 조회 시 영향
- 2-3: `SenderData` 인터페이스 필드 불일치 (`yellowId→uuid` + 누락 7개)
- 2-4: 웹훅 HMAC 검증 강제 — Phase 2 전환 시점 대응, 지금은 폴링으로 커버

**실점검 진행 상태 (2026-04-21 11:02 KST 배포 직후):**
- ✅ 알림톡 스케줄러 3종 가동 (`[alimtalk-jobs][scheduler] started`)
- ✅ `GET /api/alimtalk/categories/sender 200 23587 bytes` — Wizard 카테고리 드롭다운 정상 로드 가능
- ⏳ Wizard 3-Step 등록 / 슈퍼관리자 승인 / 고객사 템플릿 등록 + 검수요청 테스트 대기

#### 🚨 다음 세션 즉시 할 일

1. [`status/D130-NEXT-ACTIONS.md`](D130-NEXT-ACTIONS.md) 정독
2. Harold님 실점검 진행 상황 확인 (Wizard 통과? 템플릿 등록 성공?)
3. 실패 로그 있으면 해당 IMC 스펙 파일 직접 Read → 즉시 수정
4. 실점검 막힘없이 통과했으면 §3 미대조 파일 순차 Read + 블로커 2-2, 2-3 수정 기반

#### 🚨 배포 전 Harold님 DB ALTER 필수

```sql
BEGIN;
ALTER TABLE auto_campaigns
  ADD COLUMN IF NOT EXISTS channel                 varchar(20) DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS alimtalk_profile_id     uuid REFERENCES kakao_sender_profiles(id),
  ADD COLUMN IF NOT EXISTS alimtalk_template_id    uuid REFERENCES kakao_templates(id),
  ADD COLUMN IF NOT EXISTS alimtalk_template_code  varchar(50),
  ADD COLUMN IF NOT EXISTS alimtalk_variable_map   jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS alimtalk_next_type      varchar(1) DEFAULT 'L',
  ADD COLUMN IF NOT EXISTS alimtalk_next_contents  text;
CREATE INDEX IF NOT EXISTS idx_auto_campaigns_channel
  ON auto_campaigns(company_id, channel);
COMMIT;
```

검증: `\d auto_campaigns` → 기존 컬럼 + 신규 7개 확인. 롤백은 동일 컬럼 DROP.

#### Phase 0 일부 수령 (2026-04-18 야간, 세션 종료 직전)
- ✅ **IMC API Key (운영계)** 수령 — 서버 `.env`에 `IMC_API_KEY`로 주입 필요 (Key 값은 대화 로그 보안상 여기 기록 안 함)
- ✅ **Webhook 발신 IP**: `121.189.17.243`, `121.189.17.244` → `IMC_WEBHOOK_ALLOWED_IPS`
- ✅ **운영 Base URL**: `https://msg-api.humuson.com` → `IMC_BASE_URL_PRD`
- ✅ **API 문서**: `https://msg-api.humuson.com/docs/getting-started?version=v1.0.0`
- ✅ **우리 Webhook URL 결정**: `https://app.hanjul.ai/api/alimtalk/webhook`
- ⏳ **Harold님 응답 필요**: 인비토 서버 공인 IP (`curl ifconfig.me`) 확인 후 휴머스온에 전달 → 방화벽 화이트리스트
- ❌ **미수령 — 추가 요청 필수**: `IMC_WEBHOOK_HMAC_SECRET` (우리 `verifyWebhookSignature()`가 검증 강제, 없으면 실 웹훅 401)
- ❌ **미수령 — 선택적 요청**: `IMC_API_KEY_SANDBOX` + `IMC_BASE_URL_STG` (샌드박스 E2E 없이 운영계 직행 시 카톡 실발송 주의)

#### 월요일(2026-04-21) 실점검 체크리스트
- [ ] 서버 공인 IP 확인 + 휴머스온 방화벽 추가 요청
- [ ] Webhook HMAC Secret 수령 + `.env` 주입
- [ ] `.env` 주입(IMC_ENV=PRD, IMC_API_KEY, IMC_BASE_URL_PRD, IMC_WEBHOOK_ALLOWED_IPS, IMC_WEBHOOK_HMAC_SECRET) + `pm2 restart all`
- [ ] 카테고리 동기화 1회 실행 → `kakao_sender_categories` 채워짐 확인
- [ ] 발신프로필 Wizard 3-Step E2E (token 요청 → 카톡 인증번호 수신 → createSender)
- [ ] 슈퍼관리자 승인 → 템플릿 등록 → 검수요청 → IMC 웹훅 수신 → 승인 처리
- [ ] 3경로 실발송 (직접/타겟/자동) — 본인 번호로 1건씩, `SMSQ_SEND` msg_type='K' INSERT 확인

---

### 🎨 D126 V2 + D127 V3 + D128 V4 — DM 빌더 고도화 (2026-04-17) — ✅ 전 구간 완료, 배포 대기

> **배경:** D125 V1 이후 연속 세션. V2 고도화 → V3 페이징 3모드 → V4 페이지 계층 구조까지 진행.
> **메모리:** [`project_d126.md`](../.claude/projects/C--Users-ceo-projects-targetup/memory/project_d126.md) (V2) + [`project_d127_d128.md`](../.claude/projects/C--Users-ceo-projects-targetup/memory/project_d127_d128.md) (V3+V4)

#### D126 V2 — 8과제 + 공용 인프라 3종 (완료, 배포)
- 인라인 텍스트 편집(11섹션) / AI 프롬프트 모달 / AI 개선 diff / 검수 모달 / 버전 히스토리 / 브랜드킷 URL 추출 / A/B 테스트 / style_variant 10종 CSS
- ModalBase / LCS text-diff / Zustand openModal 중앙화
- **26파일 신설/수정, 11개 라우트, DDL 3종 실행 완료**

#### D126 V2 배포 후 수정 3건 (완료)
- AI 프롬프트 모달 런타임 에러 — `parseRes.data?.spec ?? parseRes.data` unwrap 수정
- 공용 SaaS 시세이도 브랜드명 3곳 제거 (DmBuilderPage/HeaderEditor/unsubscribe-helper 주석)
- 섹션 드래그 재정렬 동작 — @dnd-kit 핸들 `touchAction:'none'` + `<button>`→`<div>`

#### D127 V3 — 페이징 3모드 (완료)
- `layout_mode`에 `scroll_snap` 추가, 총 3종 (scroll / scroll_snap / slides)
- LayoutModePickerModal 신설 (신규 DM 생성 시 카드 선택)
- DmTopBar 3모드 세그먼트 토글 (편집 중 자유 전환)
- dm-viewer.ts 모드별 CSS/JS 분기 + dots + counter + IntersectionObserver 추적

#### D128 V4 — 페이지 계층 구조 (완료)
- 구조: `sections: Section[]` → `pages: DmPage[]` (1페이지 = 여러 섹션 조립)
- layout_mode는 **페이지 간 전환 방식**만 결정
- 좌측 패널 2단계: 상단 페이지 목록(이름/복제/삭제/이동) + 하단 현재 페이지 섹션 목록
- DmCanvas 상단 페이지 네비게이션 바 (◁ 페이지명 ▷ 모드 배지)
- 뷰어 `renderPagesHtml`로 재작성 (페이지 단위 스냅/슬라이드, 페이지 내부는 세로 스크롤)
- **DDL 변경 없음** — 기존 `dm_pages.pages`/`sections` JSONB 컬럼 재활용, 런타임 구조 확장
- 하위호환: 스토어 top-level `sections`를 pages[currentPageIndex].sections 뷰로 유지 → 기존 10+ 파일 호출부 무수정

#### 레거시 인프라 복구 (관련 작업, 완료)
- 레거시 kkotemp Agent MySQL 연결 실패 → socat systemd 영구화
- `/etc/systemd/system/socat-mysql.service` + `Restart=always` → SIGKILL 시 819ms 자동 복구
- rc.local 중복 라인 sed로 주석 처리
- 참조 문서: `C:\Users\ceo\Downloads\INVITO-INFRA-HANDOVER.md`

#### 배포 대기 (Harold님 직접)
```powershell
tp-push
tp-deploy-full
```
- DDL: D126 V2용 3종(brand_kit/dm_ab_tests/dm_views 확장) 이미 실행 완료, D127/D128 DDL 추가 없음
- 타입: 백엔드 tsc 0건 / 프론트 tsc 0건

#### 다음 세션 후보
- D128 배포 후 실사용 피드백 반영
- 페이지 단위 AI 개선 (현재는 현재 페이지만)
- 페이지 단위 A/B 테스트 (variant = 페이지 레이아웃)
- 페이지 간 드래그 재정렬 (현재 ⋯ 메뉴의 위/아래 버튼만)

---

### 🎨 D125 — 모바일 DM 빌더 프로모델 v1 구현 (2026-04-17) — ✅ **전 구간 완료**

> **배경:** D119 슬라이드형 DM → **섹션 기반 실전 프로모델**로 전면 재설계. "MVP 아니고 실전 프로모델" (Harold님 2026-04-16 지시).
> **설계서:** [`status/DM-PRO-DESIGN.md`](DM-PRO-DESIGN.md) 19섹션 + **메모리 [`project_d125.md`](../.claude/projects/C--Users-ceo-projects-targetup/memory/project_d125.md) 구현 상세**
>
> **완료 집계:**
> - 의존성 그래프 14단계 + 통합 QA **전 구간 완료**
> - 신설/수정 **37파일** (백엔드 14 + 프론트 23)
> - 신설 API 라우트 **19개** (`/ai/*` 5, `/templates/*` 3, `/brand-kit` 2, `/versions/*` 3, 승인 3, 검수/변수/샘플/테스트/변환 각 1)
> - 신설 컨트롤타워 **11개** (dm-tokens/section-registry/section-renderer/viewer-utils/ai/validate/variable-resolver/sample-customer/brand-kit/template-registry/legacy-converter)
> - TypeScript 타입 에러 **0건** (백엔드·프론트 모두)
>
> **완료 영역:**
> - DB: dm_pages 7컬럼 + dm_versions + dm_templates + section_interactions (Harold님 실행 완료)
> - 디자인 토큰 3파일 (color/typography/spacing/radius/shadow/motion) + CSS 변수 234줄
> - 섹션 시스템 11종 (backend/frontend SSOT 미러)
> - 에디터 3분할 (좌 섹션목록+추가 / 중 모바일프레임+캔버스 / 우 필드에디터)
> - @dnd-kit/sortable 세로 DnD
> - 필드 에디터 11종 + 공용 컨트롤 7종
> - AI 4모듈 (Prompt Parser / Layout Recommender / Copy Generator / Tone Transformer) + improve 보너스
> - 변수 바인딩 + fallback + VIP/Newbie/Empty 3종 샘플 렌더링
> - 검수 10영역 × 3등급 (fatal/recommend/improve)
> - 브랜드킷 + 템플릿 7카테고리 (뷰티/패션/긴급/포인트/재방문/오프라인/VIP)
> - 버전 관리 스냅샷/복원 + 승인 플로우 (draft→review→approved/rejected→published)
> - 테스트 발송 (insertTestSmsQueue 재활용, 최대 5명, LMS)
> - 레거시 변환 (slides→scroll 자동)
>
> **배포:** Harold님 `tp-push` + `tp-deploy-full` 직접 실행 대기
>
> **V2 이관:** D126 섹션 참조 (메모리 project_d125.md)

---

### 🔧 D124 — 0416 직원 검수 5건 + 필드명 통일 + 무료수신거부 빈줄 (2026-04-16) — 🟡 수정완료-배포대기

> **배경:** 직원 검수 PDF(한줄로_20260416.pdf) 5건. D123 후속 수정 + 추가 UX/AI 개선.

#### 수정 5건 + 부가 2건

| # | 영역 | 근본 원인 | 해결 |
|---|---|---|---|
| **N1** | 직접타겟발송 하단 "중복제거" 버튼 잔존 | D123 P3에서 상단 체크박스만 제거, 하단 버튼 놓침 | TargetSendModal.tsx 하단 버튼 삭제. 선택삭제/전체삭제 유지 |
| **N2** | 발송결과 시간/엑셀/웹 불일치 | "등록일시" 값이 sendreq_time(QTmsg INSERT)이라 "한줄로에서 발송을 건 시간" 의미와 불일치. 엑셀 필드명·순서도 웹과 다름 | **UI 2컬럼 수신확인 제거 / 엑셀 3컬럼 유지** + **등록일시 값 = 캠페인 `created_at`** (ResultsModal/엑셀/AdminDashboard 3곳 동기화) + 엑셀 헤더 웹과 순서·이름 통일(수신번호,회신번호,메시지내용,등록일시,발송일시,전송결과,결과코드,통신사,메시지유형,수신확인시간) + 발송 내역 모달 960→1300px + 셀 whitespace-nowrap |
| **N3** | 특수문자 선택 시 문안 끝에 붙음 | Dashboard 특수문자 모달이 `setMessage(prev => prev + char)` — 개인화 변수는 이미 커서 삽입 | **신규 컨트롤타워 `utils/textInsert.ts`** (insertAtCursor / insertAtCursorOrAppend / insertAtCursorPos 3함수) + 4곳 인라인 제거 (Dashboard 특수문자 / DirectSendPanel 자동입력 / TargetSendModal insertVariable / AutoSendFormModal insertVariable) + textarea `data-char-target` 속성 |
| **N4** | MMS 이미지 호버 시 UUID 파일명 표시 | DB `mms_image_paths`가 문자열 배열(절대경로)만 저장. 원본 파일명 기록 없음 | `mms_image_paths` JSONB를 **객체 배열({path, originalName})로 확장** + **컨트롤타워 2종 신설** (백엔드 mms-image-util.ts / 프론트 mmsImage.ts) + 업로드 응답에 originalName(한글 latin1→utf8 복원) + 소비처 전수 호환 (Dashboard 7곳 / campaigns.ts / ResultsModal / AiCustomSendFlow / props 타입 3곳) |
| **N5** | AI 문안 하단(마무리/연락처) 줄바꿈 없이 붙음 | D123 P12 `dnCount ≤ 3` 강제 축소가 자연스러운 단락 구분까지 파괴 | BRAND_SYSTEM_PROMPT 재작성("마무리 앞 빈 줄 필수" 명시) + post-processing dnCount 제거. `\n{3,}→\n\n` 방어선만 유지 |
| **+α** | 무료수신거부 앞에 빈 줄 없음 | `buildAdMessage`가 `\n무료수신거부`만 부착 | `\n\n무료수신거부`로 변경(백·프론트 동기) + 본문 끝 개행 정규화(`\n+$`) + 5경로 + 스팸테스트 + 표시경로 자동 반영 |
| **+β** | DM 빌더 프로모델 설계서 | MVP → 실전 프로모델 방향 전환 | **DM-PRO-DESIGN.md 19섹션 완성** — 다음 세션부터 구현 착수 |

#### 수정 파일 총 약 18개

**백엔드:**
- `utils/messageUtils.ts` — buildAdMessage `\n\n무료수신거부` + 본문 끝 개행 정규화(N5/+α), replaceVariables skipNumberFormatting(D123 P2 유지)
- `routes/campaigns.ts` — 직접발송 3곳 skipNumberFormatting(D123 P2), MMS path normalizeMmsImagePaths(N4)
- `routes/admin.ts` — `/stats/send/detail` SELECT c.created_at(N2), `/sms-detail` recvTime 반환 제거(N2)
- `routes/results.ts` — SMS_DETAIL/EXPORT_FIELDS, 카카오 UNION ALL 필드, CSV 헤더/데이터 재정렬(N2)
- `routes/mms-images.ts` — originalName 응답 포함, latin1→utf8 복원(N4)
- `services/ai.ts` — BRAND_SYSTEM_PROMPT 재작성, dnCount 제거(N5)
- **신설** `utils/mms-image-util.ts` — MMS 경로/파일명 컨트롤타워(N4)

**프론트엔드:**
- `components/TargetSendModal.tsx` — 하단 중복제거 버튼 제거(N1), insertAtCursor 사용(N3), data-char-target(N3)
- `components/DirectSendPanel.tsx` — insertAtCursorPos 사용(N3), data-char-target(N3)
- `components/AutoSendFormModal.tsx` — insertAtCursorPos 사용(N3)
- `components/ResultsModal.tsx` — 수신확인 컬럼 제거, 등록일시=selectedCampaign.created_at, 모달 1300px, whitespace-nowrap, getMmsImageDisplayName(N2/N4)
- `components/AiCustomSendFlow.tsx` — img alt/title originalName 우선(N4)
- `pages/AdminDashboard.tsx` — 캠페인리스트/SMS상세/통계모달 등록/발송 2컬럼(N2)
- `pages/Dashboard.tsx` — 특수문자 모달 컨트롤타워(N3), mmsUploadedImages state+7곳 body 객체배열(N4), saveTemplate 타입(N4), 템플릿 복원 호환(N4)
- `utils/formatDate.ts` — buildAdMessageFront `\n\n무료수신거부`(+α)
- **신설** `utils/textInsert.ts` — 커서 삽입 컨트롤타워(N3)
- **신설** `utils/mmsImage.ts` — MMS 경로/파일명 컨트롤타워(N4)

#### 핵심 교훈 (D124)

> 1. **SQL 파일 자동생성 금지** — OPS.md 기반 Harold님 직접 실행 안내로 대체. feedback_no_sql_generation.md 메모리 기록.
> 2. **MVP 마인드 탈피** — 프로 요금제 차별화 기능은 "월 100만원 값어치" 기준. 기능·디자인 동시 완성도.
> 3. **컬럼 통일 요구는 순서·이름 양쪽** — 데이터 의미 같아도 헤더명·순서 다르면 직원 혼란. 웹 기준으로 엑셀 맞춤.
> 4. **동일 로직 2곳 이상 = 즉시 컨트롤타워** 원칙 4번 반복 적용 (N3 커서삽입 4곳→textInsert.ts / N4 MMS 경로 추출 여러 곳→mmsImage.ts).
> 5. **JSONB 구조 확장 > DB 스키마 변경** — mms_image_paths 객체 배열 / dm_pages layout_mode 등 하위호환 JSONB 확장이 안전.
> 6. **컨트롤타워 함수 시그니처는 범용 우선** — `(newValue: string) => void`가 React Dispatch와 일반 콜백 양쪽 호환 → TargetSendModal props 형태도 수용.
> 7. **"재작업"은 사용자 의도 재확인부터** — N2는 PDF 오독으로 3번 뒤집음 (엑셀 3컬럼 유지 / 등록일시=created_at 의미). "제대로 읽기"가 "빠르게 수정"보다 우선.

---

### 🔧 D123 — 0415 직원 검수 12건 전수 수정 + 레거시 인프라 복구 + 영업총판 제안서 (2026-04-16) — ✅ 배포완료

> **배경:** 직원 검수 PDF(한줄로_20260415.pdf) 12건 전수 수정. 080번호 누락 / 직접발송 숫자 콤마 / 직접타겟발송 체크박스 / 발송결과 상세 시간 / MMS 이미지 / 회신번호 하이픈 / 예약대기 드래그 / 자동발송 5건 / AI 줄바꿈 과다.
> **관련 인프라 복구:** 동일 세션에서 레거시 서버(invitobiz.com) 템플릿관리자 QTmsg Agent 문자발송 복구(MySQL 3306→3388 socat 포워딩) + 이니시스 PG 카드결제 복구(Tomcat setenv.sh에 JAVA_HOME=Oracle JDK 1.7.0_45 고정 — Java 8 설치로 alternatives 바뀌면서 SSL 컨텍스트 초기화 실패). 한줄로 프로젝트 범위 밖이지만 같은 세션에서 처리.
> **부가 업무:** 전단AI 영업총판 제안 대응 — 상대방 5:5 수익배분 제안 거절 후 30% recurring 총판 계약 제안서 Word 문서 작성 (`docs/인비토_솔루션_영업총판_제안서_20260416.md` + 바탕화면 .docx). 경어체 + 표/불릿/번호리스트 포함. DID 별도 사업/공동사업 거절/5개 독소조항 차단.

#### 수정 12건

| # | 영역 | 근본 원인 | 해결 |
|---|---|---|---|
| **P1** | 080번호 누락 (auto_sync OFF) | `getOpt080Number()`가 users.opt_out_080_number → companies.opt_out_080_number만 조회, D120 이전 데이터는 companies.opt_out_080_number NULL이고 reject_number에만 값 존재 → 080번호 빈값 반환 → (광고)+080 누락 | `getOpt080Number()` company 폴백을 `COALESCE(NULLIF(opt_out_080_number, ''), reject_number)`로 변경. 컨트롤타워 1곳 수정으로 5개 발송 경로 + 스팸테스트 12곳 전체 자동 반영. Harold님 일괄 동기화 SQL 실행 완료 |
| **P2** | 직접발송 숫자 콤마 자동 변환 | `replaceVariables()`가 모든 발송 경로에서 `formatNumericLike()` 무조건 호출 → 직접발송도 고객 업로드 원본(1000, 250103)이 1,000 / 250,103으로 변환되어 나감 | `replaceVariables()`에 `skipNumberFormatting` 옵션 추가. `prepareSendMessage()` 옵션 전달. 직접발송 3곳(SMS/카카오/알림톡) `skipNumberFormatting: true`. 프론트 `replaceDirectVars`도 `formatPreviewValue` 제거하여 raw 값 표시 |
| **P3** | 직접타겟발송 중복제거/수신거부제거 체크박스 무의미 | 앞 단에서 이미 중복 제거 + 수신거부 필터 적용된 데이터가 넘어오는데 추가 체크박스 UI 존재 | TargetSendModal 체크박스 2개 UI 제거 (state는 유지 — 백엔드 API 하위호환) |
| **P4** | 발송결과 상세 시간 컬럼 부족 + admin.ts UTC 그대로 표시 | (1) ResultsModal 상세 테이블에 "수신확인"(repmsg_recvtm) 컬럼 없음 (2) admin.ts sms-detail 쿼리가 `DATE_ADD +9h` 없이 raw SELECT → 슈퍼관리자 화면에서 UTC 그대로 표시 | ResultsModal에 "수신확인" 컬럼 + `formatDateTime(m.repmsg_recvtm)` 추가 (colSpan 9→10). admin.ts sms-detail 쿼리에 `DATE_ADD(mobsend_time/repmsg_recvtm, INTERVAL 9 HOUR)` 추가 |
| **P5** | MMS 캠페인 상세 이미지 너무 작음(64px) + 파일명 불가 | `mms_image_paths` 렌더링 시 `w-16 h-16` 고정, alt/title 없음 → 날짜/사은품 등 비슷한 이미지 구분 불가 | 경로에서 파일명 추출하여 `title` 속성(호버 툴팁) + 에메랄드 링 hover + `onClick` 전체화면 확대 모달. `enlargedImage` state + full-screen overlay(z-[90], 배경/✕ 클릭 닫기, 하단 파일명 카드) |
| **P6** | 회신번호 하이픈 불일치 (02-3449-0012 → 023-449-0012) | 인라인 `formatPhone` 함수가 **9곳**에 중복 정의, 10자리 → 3-3-4 단순 분할로 서울 02를 지역번호 0XX로 오인. CLAUDE.md 컨트롤타워 원칙 위반 상태 | `formatPhoneNumber()` 컨트롤타워로 통일. 050X 12자리(0507-1234-5678) 케이스 추가. 9곳 인라인 전부 제거 + import 교체 — ResultsModal/Settings/Unsubscribes/CustomerDBModal/CallbacksTab/AiCustomSendFlow/Dashboard/AutoSendFormModal. 백엔드 services/ai.ts `formatRejectNumber`도 동일 규칙으로 보강 |
| **P7** | 예약대기 메시지 상세보기 드래그 복사 불가 | 상위에 `select-none`은 없지만 명시적 `select-text` 미지정으로 상속/기본 스타일에서 드래그 차단 | ScheduledCampaignModal 본문 div에 `select-text cursor-text` 명시 |
| **P8** | 자동발송 이력 통계 (D-2 AI 생성 알림 미기록) | `runMessageGeneration()`이 담당자 AI 생성 알림 SMS 발송 후 `auto_campaign_runs INSERT`를 아예 안 함 → 이력 탭에 AI 생성 알림 회차 자체가 안 보임 | `runMessageGeneration()` 알림 발송 직후 `auto_campaign_runs INSERT` 추가 (status='ai_generated_notified', target/sent/success = phones.length). AutoSendPage.tsx `statusMap`에 `ai_generated_notified`(AI문안알림) + `spam_tested`(스팸테스트) 라벨 추가. 시간 분기도 포함 |
| **P9** | 자동발송 담당자번호 미입력 시 다음 단계 진행 가능 | `canProceed()` Step 4 검증 누락 + pre_notify 토글 OFF 가능 → AI 생성/스팸테스트/D-1 알림 수신 못 함 | AutoSendFormModal: **pre_notify 토글 완전 제거** (항상 true 고정). `canProceed()` Step 4에 `notifyPhones.length === 0` 차단 추가. 경고 메시지 "📌"→"⚠️", 빨간색. 5단계 확인 화면 단순화 |
| **P10** | 담당자 알림 특수문자 누락 | `applyAdAndSanitize()`가 messageContent에 `sanitizeSmsText()` 강제 적용 → 실제 발송에는 ★/※/▼ 나가지만 담당자 알림에는 제거되어 발송 | `applyAd()`로 함수명 변경 + sanitize 제거. messageContent 원본 그대로. 알림 템플릿 고정 부분은 영향 없음. 호출부 3곳 교체 |
| **P11** | 자동발송 미등록 회신번호 — "생성 실패" 메시지만 | 생성 API에 pre-flight validation 없음. 실제 발송 시점 CT-08이 자동 제외하지만 고객은 이유 모름 | auto-campaigns.ts POST에 pre-flight — `use_individual_callback=true` + `force !== true`이면 고객 조회 → CT-08 `filterByIndividualCallback` → 미등록 있으면 `409 code='UNREGISTERED_CALLBACKS'` 응답. CallbackConfirmModal sendType에 `'auto'` 추가. AutoSendFormModal에 `submitWithForce(force)` 함수 — 409 응답 시 모달 표시, "제외하고 생성" 클릭 시 `force=true`로 재호출 |
| **P12** | AI 추천 문안 줄바꿈 과다 (타 업체 대비 내실 없어 보임) | BRAND_SYSTEM_PROMPT에 빈 줄 총량 제약 없음. Post-processing도 `\n{3,}→\n\n`만 처리 | 프롬프트에 "과도한 줄바꿈 금지" 섹션 추가 (빈 줄 3개 이내, 의미 단위 묶기, 좋은 예/나쁜 예 쌍). Post-processing에 빈 줄(`\n\n`) 최대 3개 제한 로직 추가 (3개 초과분은 단일 줄바꿈으로 축소) |

#### 수정 파일 총 약 20개

**백엔드:**
- `messageUtils.ts` — getOpt080Number(P1), replaceVariables+prepareSendMessage(P2)
- `campaigns.ts` — 직접발송 3곳 skipNumberFormatting(P2)
- `admin.ts` — sms-detail DATE_ADD(P4)
- `services/ai.ts` — formatRejectNumber 보강(P6), BRAND_SYSTEM_PROMPT 줄바꿈 제약(P12), post-processing 빈줄 최대 3개(P12)
- `auto-campaign-worker.ts` — runMessageGeneration INSERT(P8)
- `auto-notify-message.ts` — applyAd messageContent sanitize 제외(P10)
- `auto-campaigns.ts` — POST pre-flight validation(P11)

**프론트엔드:**
- `TargetSendModal.tsx` — 체크박스 제거(P3)
- `ResultsModal.tsx` — 수신확인 컬럼(P4), MMS 확대 모달(P5), formatPhone 교체(P6)
- `CustomerDBModal.tsx`, `CallbacksTab.tsx`, `Settings.tsx`, `Unsubscribes.tsx` — formatPhone 컨트롤타워화(P6)
- `AiCustomSendFlow.tsx`, `Dashboard.tsx`, `AutoSendFormModal.tsx` — formatRejectNumber 컨트롤타워화(P6)
- `formatDate.ts` — formatPhoneNumber 050X 12자리 보강(P6), replaceDirectVars raw 값(P2)
- `ScheduledCampaignModal.tsx` — select-text cursor-text(P7)
- `AutoSendPage.tsx` — statusMap + 시간 분기(P8)
- `AutoSendFormModal.tsx` — 토글 제거+필수화(P9), CallbackConfirmModal 연동(P11)
- `CallbackConfirmModal.tsx` — sendType 'auto' 추가(P11)

#### 핵심 교훈 (D123)
> 1. **자동발송 5단계 라이프사이클 전수 이해 필수.** runMessageGeneration/runPreNotification/runPreSendSpamTest/executeAutoCampaign 각각 auto_campaign_runs INSERT 방식이 다름 → 하나만 보면 누락 발견 못 함.
> 2. **컨트롤타워 형태로 통합되어 있어도 소비처 전수 확인 필수.** formatPhone 인라인 9곳 중복(formatDate.ts에 formatPhoneNumber 있지만 import 안 함). 기존 컨트롤타워가 있다는 사실만으로 안심하지 말고 grep으로 인라인 패턴 전수 확인.
> 3. **settings 저장 시 양쪽 필드 동기화 원칙(D120)은 기존 데이터에 소급 적용 안 됨.** DB 마이그레이션 또는 읽기 쪽 폴백 로직으로 커버.
> 4. **AI 프롬프트 제약은 프롬프트+post-processing 이중 안전장치.** 프롬프트만 바꾸면 AI가 무시할 수 있음 → 코드에서 강제 축소 로직 추가.
> 5. **"기능 잠금"은 진짜 잠금 + UX 명시 2중 효과 필요.** 자동발송 담당자 번호처럼 필수 기능은 UI에서 토글 자체를 제거하고 필수 표시.

---

### 🔧 D122 — 전단AI 대규모 업데이트 + 한줄로 카카오추천 제거 (2026-04-15) — ✅ 배포완료

> **배경:** 전단AI 인쇄전단/장바구니/주문/POS자동/감사로그/엑셀매핑 등 엔터프라이즈급 기능 대량 추가. 한줄로 AI 추천에서 카카오 채널 추천 제거.

#### 전단AI 신규 기능 (10건)
| # | 영역 | 내용 |
|---|---|---|
| **#1** | 인쇄전단 시스템 | PrintFlyerPage.tsx + flyer-print-renderer.ts — 한국 마트 규격(A3/B4/A4/8절/타블로이드) 5종 + 9가지 테마(봄/여름/가을/겨울/추석/설+기본3색). 카테고리별 상품 그리드 에디터, 네이버 이미지 자동검색+직접업로드, 300dpi PDF 생성 |
| **#2** | 장바구니/주문 | flyer-carts.ts(CT-F19) + flyer-orders.ts(CT-F20) + OrdersPage.tsx — phone 기반 장바구니 UPSERT, 주문 생명주기(pending→confirmed→ready→completed/cancelled), 요약 카드 4개 + 상태탭 필터 |
| **#3** | POS 자동전단 생성 | flyer-pos-auto.ts(CT-F22) — 5분 간격 미처리 할인건 감지 → 카탈로그 이미지 매칭 → 할인율 분류(메인30%↑/서브10%↑/일반) → auto_draft 자동 생성 |
| **#4** | 수신자별 단축URL 추적 | flyer-short-code.ts(CT-F18) — base62 5자리 코드(9억 조합), 배치 INSERT 5000단위, 90일 만료, 클릭통계(유니크phone/첫클릭/총클릭) |
| **#5** | 감사로그 | flyer-audit-log.ts(CT-F23) — 로그인/전단생성/발송/주문/설정 등 13가지 액션 기록. 비동기 처리. 슈퍼관리자 FlyerAdminDashboard에 조회UI 추가 |
| **#6** | 엑셀 AI 자동매핑 | flyer-excel-mapper.ts(CT-F24) + ExcelUploadModal.tsx — 엑셀 헤더→상품필드 AI 매핑(Claude주/GPT폴백). 3단계(업로드→매핑확인→미리보기). 할인율 기반 promoType 자동분류 |
| **#7** | 배경제거 | flyer-rembg.ts — rembg Docker 서비스 호출(15초 타임아웃), 실패 시 원본 폴백 |
| **#8** | 인쇄전단 백엔드 수정 | flyers.ts — created_by→user_id, store_address→business_address 컬럼 변경 |
| **#9** | PDF 다운로드 토큰 | 인쇄전단 PDF 다운로드 시 인증 토큰 처리 수정 |
| **#10** | 인쇄전단 메뉴 이동 | App.tsx 메뉴 구조 개선, 인쇄전단 메뉴 위치 조정 |

#### 전단AI 오류 수정 (3건)
| # | 영역 | 해결 |
|---|---|---|
| **F1** | 전단생성 실패 | flyers.ts 전단 생성 로직 오류 수정 |
| **F2** | 인쇄전단 오류 | PrintFlyerPage 렌더링/이벤트 핸들링 수정 |
| **F3** | 전단 업데이트 | 인쇄전단 업데이트 로직 안정화 |

#### 한줄로AI 수정 (1건)
| # | 영역 | 변경 |
|---|---|---|
| **#1** | 추천카카오 제거 | AI 추천에서 카카오 채널 추천 옵션 제거 (ai.ts) |

#### 수정 파일 총 31개
- **전단AI 백엔드 (16개):** flyers.ts, carts.ts, orders.ts, pos.ts, short-urls.ts, stats.ts, flyer-admin.ts, auth.ts, app.ts, flyer-audit-log.ts, flyer-carts.ts, flyer-orders.ts, flyer-pos-auto.ts, flyer-pos-ingest.ts, flyer-print-renderer.ts, flyer-rembg.ts, flyer-templates.ts, flyer-send.ts, flyer-short-code.ts, flyer-excel-mapper.ts, index.ts
- **전단AI 프론트 (4개):** App.tsx, PrintFlyerPage.tsx, OrdersPage.tsx, ExcelUploadModal.tsx
- **한줄로 (2개):** ai.ts, FlyerAdminDashboard.tsx
- **기타:** CLAUDE.md, InvitoAI_Technical_Whitepaper_2026.docx

---

### 🔧 D121 — KISA subject(광고) 전경로 + AI 문안 4차/5차 강화 + 빈필드 제외 (2026-04-14~15) — ✅ 배포완료

> **배경:** KISA 2026-05 LMS/MMS 제목(광고) 의무 표기 전경로 적용 + AI 문안 생성 프롬프트 4차(감각언어/사용시나리오/업종별킬포인트) + 5차(소비자심리학/브랜드품격) 대규모 강화 + 빈 필드 변수 자동 제외

#### KISA subject(광고) 전경로 적용
**컨트롤타워 신설:**
- `messageUtils.ts` — `buildAdSubject(subject, msgType, isAd)` 신설
- `prepareSendMessage` 반환값 `{message, subject}`로 확장
- `formatDate.ts` — `buildAdSubjectFront` (프론트 미리보기용)

| 구분 | 적용 위치 | 건수 |
|---|---|---|
| **백엔드 발송** | campaigns.ts(AI/테스트/직접/예약수정 4곳), auto-campaign-worker.ts(1곳), spam-test-queue.ts(1곳), spam-filter.ts(1곳) | 7곳 |
| **프론트 제목 입력란** | DirectSendPanel/TargetSendModal/AutoSendFormModal/AiCampaignSendModal/ScheduledCampaignModal | 5곳 |
| **프론트 제목 표시** | AiCampaignResultPopup/AiPreviewModal/AiCustomSendFlow/ScheduledCampaignModal/ResultsModal | 5곳+(2추가) |
| **스팸필터 isAd prop** | SpamFilterTestModal + 호출부(Dashboard/AiCampaignResultPopup/AiCustomSendFlow/DirectSendPanel/TargetSendModal) | 5곳 |

#### AI 문안 생성 프롬프트 4차+5차 강화
**4차 — BRAND_SYSTEM_PROMPT 전면 교체:**
- 사용 시나리오 기법 (고객 생활 속 제품 사용 장면)
- 감각 언어 가이드 (오감 자극 표현)
- 업종별 킬 포인트 10개 업종
- 문장 리듬 (짧은↔긴 교차)
- A/B/C variant 설득 전략 자체 분리
- "왜 지금, 왜 나한테, 왜 이 브랜드" 3박자
- generateCustomMessages systemPrompt도 동일 적용

**5차 — 소비자 심리학 + 브랜드 품격:**
- AI 사고 과정 강제 (브랜드 이미지? 페인포인트? 감정? 과장 없이?)
- 소비자 심리 5가지: 손실회피/호기심갭/소속감·자부심/자연스러운긴급성/1:1대화 착각
- 전부 좋은 예+나쁜 예 쌍 — 과장/허풍 금지, 브랜드 품격 유지
- 느낌표 최대 2~3개, 과장 형용사 금지

#### 개인화 변수 데이터 필터링 (filterVarCatalogByData)
- `services/ai.ts` — `filterVarCatalogByData(varCatalog, availableVars, companyId)` 신설
- 직접 컬럼/커스텀 필드 데이터 0건이면 varCatalog에서 제거 → AI가 빈 필드 변수 사용 방지
- 적용: routes/ai.ts generate-messages + auto-campaign-worker.ts

#### 스팸필터 개인화 치환 불일치 수정
- **원인:** sampleCustomer 키 "이름" vs 메시지 변수 %고객명% — 미리보기에는 aliasMap 있지만 스팸필터에는 누락
- **수정:** AiCampaignResultPopup + AiCustomSendFlow 스팸필터 데이터에 aliasMap 적용

#### 스팸필터테스트 고객일치화 수정
- **원인:** 스팸필터 테스트 시 sampleCustomer가 없거나 타겟 무관 고객 사용
- **수정:** 미리보기와 동일한 sampleCustomer 전달

#### 수정 파일 총 21개
- **백엔드 (7개):** ai.ts(routes), ai.ts(services), campaigns.ts, spam-filter.ts, auto-campaign-worker.ts, messageUtils.ts, spam-test-queue.ts
- **프론트 (13개):** AiCampaignResultPopup, AiCampaignSendModal, AiCustomSendFlow, AiPreviewModal, AutoSendFormModal, DirectSendPanel, ResultsModal, ScheduledCampaignModal, SpamFilterTestModal, TargetSendModal, AutoSendPage, Dashboard, formatDate.ts
- **문서 (1개):** STATUS.md

#### 핵심 교훈 (D121)
> 1. **전수파악 없이 "다 했다" 보고 금지** — subject(광고) 적용을 4번 배포시킴. 매번 추가 발견.
> 2. **발송 경로뿐 아니라 표시 경로(미리보기/스팸필터/발송확인 모달) 전수 필수.**
> 3. **컨트롤타워를 만들면 호출부에서 각각 호출 X → 단일 진입점(prepareSendMessage)에서 처리.**
> 4. **동일 기능(변수 치환)을 여러 곳에서 호출할 때 옵션(aliasMap 등)도 동일해야 함.**

---

### 🔧 D120 — UI 통일 + 캘린더 이동 + 080 버그 + 전단AI user_id 격리 (2026-04-14) — ✅ 배포완료

> **배경:** 한줄로AI UI 통일감 작업 + 080 수신거부 저장 버그 + 전단AI 사용자별 데이터 격리

#### 한줄로AI 수정 5건
| # | 영역 | 변경 |
|---|---|---|
| **#1** | AiPreviewModal 핸드폰 프레임 리뉴얼 | 960px 텍스트 모달 → 400px 핸드폰 프레임 (맞춤한줄과 통일). 하단 버튼 4개 제거 (문안선택 화면에 이미 있음). 인라인 replaceAllVars → replaceVarsBySampleCustomer 컨트롤타워 |
| **#2** | DashboardHeader 메뉴 정리 | AI 분석 + 캘린더 메뉴 제거 (캘린더는 발송결과 모달로 이동) |
| **#3** | ResultsModal 캘린더 + 메시지 모달 | 콘텐츠 우측 상단에 캘린더 버튼(보라색) 추가 → CalendarModal 트리거. 스팸필터 이력 문안 클릭 가능(MessageCell 컨트롤타워). 메시지 상세 모달 핸드폰 프레임 리뉴얼 |
| **#4** | 080 수신거부 저장 버그 | PUT /settings에서 reject_number만 UPDATE → opt_out_080_number도 동기화. 근본 원인: GET은 opt_out_080_number를 읽는데 PUT은 reject_number에만 저장 |
| **#5** | CalendarModal embedded prop | 향후 임베드 가능하도록 embedded 옵션 추가 |

#### 전단AI 수정 1건
| # | 영역 | 변경 |
|---|---|---|
| **#1** | 전단지 목록 user_id 격리 | flyers.ts GET / — company_id만 필터 → user_id 추가. 같은 총판 내 다른 매장 사용자 전단 격리 |

#### 0414 PDF 디버깅 8건
| # | 영역 | 해결 |
|---|---|---|
| **P1** | 평균주문금액 날짜변환 | formatPreviewValue에 fieldLabel 키워드 판정 추가 (금액→숫자, 생일→날짜). CustomerDBModal "이름" 하드코딩→동적 |
| **P2** | 개인화/특수문자 커서 위치 | AutoSendFormModal+DirectSendPanel에 onSelect 커서 추적 + selectionStart 기반 삽입 |
| **P3** | 예약취소 미표시 | 미확정 draft DELETE 처리 + campaigns.ts/results.ts sent_count=0 제외조건 제거 |
| **P4** | 상세내역 시간 라벨 | "요청시간"→"등록일시", "발송시간"→"발송일시" |
| **P5** | 취소건 파란색 | cancelled 건 발송일시 회색+취소선+(예약취소) 표기 |
| **P6** | 캘린더 테스트탭 | 요약탭에서만 표시 + 무료/만료 사용자 잠금 |
| **P7** | 자동발송 이력 통계 | 알림류 run INSERT에 success_count 즉시 기록 (sync 대상 아님) |
| **P8** | AI문구 영문변수 | AutoSendFormModal personalFields 영문key→한글displayName 변환 |

#### AI 문안 생성 프롬프트 대규모 고도화 (3차 튜닝)
- BRAND_SYSTEM_PROMPT 전면 개편 — 실전 마케팅 기법 반영
- **뻔한 표현 금지 목록:** "안녕하세요", "특별한 소식", "준비했어요" 등 상투적 표현 금지
- **실전 기법 7가지:** 알림형식 차용, 고객한정 특별감, 호기심 유발, 시의성, 제품 어필, 개인화 고도 활용, 혜택 구조화
- **variant별 도입부 완전 분리:** 감성형(계절감) / 혜택강조(첫줄 숫자) / MZ(호기심 질문)
- **LMS 적정 길이:** 600~1200바이트 권장, 300바이트 미만 실격
- **계절감 + 월별 이벤트** 반영 필수
- campaigns 실발송 성공 문안 자동 조회 → 프롬프트 few-shot 레퍼런스
- ~~⚠️ 잔존 과제: 제미나이 대비 제품 사용 시나리오, 감각적 표현 부족~~ → **D121에서 4차/5차 프롬프트 강화로 해결 완료**

#### 수정 파일 총 14개
- `AiPreviewModal.tsx` — 핸드폰 프레임 전면 리뉴얼
- `DashboardHeader.tsx` — AI분석 + 캘린더 메뉴 제거
- `ResultsModal.tsx` — 캘린더 버튼 + 스팸필터 MessageCell + 메시지 모달 핸드폰 프레임 + P4/P5/P6
- `CalendarModal.tsx` — embedded prop 추가
- `CustomerDBModal.tsx` — P1 하드코딩 제거 + fieldLabel 전달
- `formatDate.ts` — P1 formatPreviewValue fieldLabel 키워드 판정
- `AutoSendFormModal.tsx` — P2 커서위치 삽입 + P8 personalFields 한글변환
- `DirectSendPanel.tsx` — P2 커서위치 삽입
- `Dashboard.tsx` — P3 DELETE + P6 캘린더 props 전달
- `companies.ts` (백엔드) — 080 opt_out_080_number 동기화
- `campaigns.ts` (백엔드) — P3 draft DELETE + sent_count 조건 제거
- `results.ts` (백엔드) — P3 sent_count 조건 제거
- `auto-campaign-worker.ts` (백엔드) — P7 알림 run success_count
- `ai.ts` + `routes/ai.ts` (백엔드) — AI 프롬프트 고도화 + 레퍼런스 문안 자동 조회
- `flyers.ts` (백엔드) — 전단AI user_id 격리

#### 전단AI 사업 확장 회의
- 회의록: `status/전단AI_회의록_20260414.docx`
- 설계서: `status/FLYER-EXPANSION-DESIGN.md`
- 4단계: 수신자별 단축URL → 인쇄용 전단 → 장바구니/주문 → POS 자동 생성
- 목표: 마트 2,000개+, 월 순수익 1.4억원

---

### 🔧 D119 — 0413 직원검수 7건 + 전단AI 흰화면 + 모바일DM 빌더 신규 (2026-04-13) — ✅ 배포완료

> **배경:** 직원 디버깅 PPT(한줄로_20260413.pptx) 7건 수정 + 전단AI 로그인 흰화면 + 총판모달 스크롤 + **모바일DM 빌더 신규 기능 (프로 요금제 이상)**

#### 한줄로AI 버그 수정 7건
| # | 영역 | 원인 | 해결 |
|---|---|---|---|
| **#1** | 고객DB 커스텀필드 날짜값 숫자처리 | CustomerDBModal에서 인라인 `Number().toLocaleString()` 사용 → YYYYMMDD 날짜에 쉼표 | formatPreviewValue 컨트롤타워 교체 + formatNumericLike에서 YYYYMMDD/YYMMDD → 날짜 문자열 반환 (백엔드 format-number.ts 동기화) |
| **#2** | 스팸필터 이력에 문안 미표시 | ResultsModal 테이블에 "문안" 컬럼 자체 없음 (API는 content 이미 제공) | 문안 컬럼 추가 (30자 truncate + title) |
| **#3** | (광고)+080 표기 누락 | `!isAd \|\| !optOutNumber`이면 통째로 안 붙임 → 080 미할당 계정 전부 누락 | `!isAd`만 체크 + 080 없어도 (광고)+무료거부 부착 (프론트 buildAdMessageFront + 백엔드 buildAdMessage + AutoSendFormModal getAdSuffix) |
| **#4** | 직접발송 리스트 없이 스팸테스트 | directRecipients[0] undefined → target-sample.ts가 DB 임의 고객 반환 | DirectSendPanel에서 리스트 0건이면 토스트 + 차단 |
| **#5** | 회신번호 취소 시 다른 타겟수 취소건 | draft→cancelled 전환 후 sent_count=0인 건이 캘린더/최근캠페인에 표시 | `NOT (status='cancelled' AND COALESCE(sent_count,0)=0)` 조건 추가 |
| **#6** | 자동발송 AI문구추천 개인화 미적용 | 프론트 `personalFields` → 백엔드 `personalizationVars` 키 불일치 | ai.ts에서 `personalFields` destructure + fallback |
| **#7** | 자동발송 회신번호 AI모드 선택 불가 | AI모드 발신번호 select에 `__individual__` 옵션 없음 + validation에 `useIndividualCallback` 체크 누락 | 양쪽 추가 |

#### 전단AI 수정
- **로그인 흰 화면:** App.tsx `useState(showMore)`가 조건부 return 뒤에 선언 → React Hooks 규칙 위반. 조건부 return 전으로 이동
- **총판/매장 등록·수정 모달 4개:** `max-h-[90vh] flex flex-col` + 본문 `overflow-y-auto` + 버튼 `shrink-0 border-t` 하단 고정

#### 모바일 DM 빌더 (신규 — 프로 요금제 이상)
- **DB:** `dm_pages` + `dm_views` 테이블, `plans.dm_builder_enabled` 컬럼
- **백엔드 CT:** `utils/dm/dm-builder.ts` (CRUD+발행+추적+통계), `utils/dm/dm-viewer.ts` (공개 뷰어 HTML)
- **백엔드 라우트:** `routes/dm.ts` (인증 CRUD+이미지업로드) + `routes/flyer/short-urls.ts`에 DM 공개 뷰어 합류 (`/dm-:code`)
- **프론트:** `DmBuilderPage.tsx` (3컬럼 레이아웃), App.tsx `/dm-builder` 라우트, DashboardHeader "모바일DM" 메뉴
- **기능:** 이미지/동영상/텍스트카드/CTA카드 4종 레이아웃, 상단 4종(로고/풀배너/카운트다운/쿠폰), 하단 4종(고객센터/CTA버튼/SNS/프로모코드)
- **발행 URL:** `https://hanjul-flyer.kr/dm-코드` (Nginx 수정 없이 기존 프록시 활용)
- **열람 추적:** `?p=전화번호` 파라미터로 고객별 페이지 도달/체류시간 추적

---

### 🔧 D114 — 0410 PDF 버그 10건 + 신규 기능 1건 (2026-04-12) — ✅ 배포완료

> **배경:** 4/13 레거시 이관 직후. 직원 검수 PDF(한줄로_20260410.pdf) 11건 중 P11(스팸테스트 불안정 — 서버 확인 결과 테스트폰 앱 상태 문제로 코드 이슈 아님) 제외 10건 수정 + 엑셀 다운로드 신규 기능.

#### 해결 항목 (10건)
| # | 영역 | 근본 원인 | 해결 |
|---|---|---|---|
| **P1** | 고객 전체삭제 후 업로드 충돌 | delete-all이 customer_field_definitions/customer_stores/unsubscribes/customer_schema 미정리 | 4개 테이블 삭제 + customer_schema 초기화 추가 |
| **P2** | 매핑 충돌 덮어쓰기 실패 | 고객 0명인데도 error 모달 표시 | 고객 0명이면 warning으로 격하 (3가지 충돌 타입 전부) |
| **P3** | 수신거부 사용자 간 공유 | company_user 업로드 시 회사 전체 sms_opt_in=false 대상 INSERT | store_code 필터 추가 (본인 브랜드 범위만) |
| **P4** | 직접발송 숫자 구분자 미적용 | 주소록 기타1/2/3 치환 시 formatNumericLike 미적용 | replaceVariables 0단계에 formatNumericLike 적용 |
| **P5b** | 맞춤한줄 필드명 영문 출력 | RecommendTemplateModal에서 field key 그대로 표시 | FIELD_KEY_DISPLAY_MAP 컨트롤타워 + 한글 변환 |
| **P6** | 자동발송 AI문안 알림 2건 중복 | runMessageGeneration에 잠금 없음 → 1분 간격 워커가 동일 캠페인 2번 픽업 | generating_at 컬럼 + 원자적 UPDATE RETURNING 잠금 |
| **P7** | 자동발송 AI문안 변수 미치환 | personal_fields가 field key(['name']) → AI가 %name% 생성 → 매칭 실패 | getFieldByKey→displayName 변환 (['고객명']) |
| **P8** | 자동발송 실행이력 3건 | 알림/스팸 run target_count=0 + 시간 불일치 + 실패건 성공 표시 | 건수 기록 + started_at 추가 + success_count=0 초기 + sync 연동 |
| **P9** | 슈퍼관리자 고객사 고객 수 0 | companies.ts 목록 SELECT에 total_customers 서브쿼리 없음 | COUNT(*) 서브쿼리 추가 |
| **P10** | 발송통계 엑셀 다운로드 (신규) | 기능 미존재 | admin.ts CSV 엔드포인트 + fetch+blob 다운로드 |

#### DDL (실행 완료)
```sql
ALTER TABLE auto_campaigns ADD COLUMN IF NOT EXISTS generating_at TIMESTAMPTZ;
```

#### 수정 파일 (12개)
customers.ts, upload-mapping-validator.ts, companies.ts, upload.ts, messageUtils.ts, auto-campaign-worker.ts, campaign-lifecycle.ts, AutoSendPage.tsx, RecommendTemplateModal.tsx, formatDate.ts, admin.ts, AdminDashboard.tsx

#### 핵심 교훈 (D114)
> 1. **전수 점검 3회 반복 — 매회 추가 발견.** 1차: 기본 수정. 2차: customer_stores 누락 + label_moved severity + CSV 이스케이핑 + window.open 인증 미전달 4건. 3차: spam_tested run target_count/started_at 미포함 1건. **처음부터 끝까지 데이터 흐름 추적하지 않으면 반드시 빠짐.**
> 2. **SCHEMA.md 맹신 금지.** spam_filter_tests의 sms_table/sms_msgkey/started_at 컬럼이 SCHEMA.md에는 있지만 실제 DB에 없었음. 서버 `\d` 명령으로 실제 구조 확인 필수.
> 3. **window.open은 Authorization 헤더를 보내지 않음.** 인증 필요 API의 파일 다운로드는 반드시 fetch+blob 패턴 사용.

---

### 🔧 D111 — 0408 검수 9건 + 오픈 전 결정사항 2건 (2026-04-09) — ✅ 배포완료

> **배경:** 4/13 레거시 이관 D-4. 0408 직원 검수리스트/PDF 지적 9건 + 오픈 전 결정사항(업로드 매핑 충돌 / 소수점 포맷) 2건을 한 세션에 전수 수정. 컨트롤타워 원칙 + 매트릭스 전수 점검으로 재발 차단.

#### 신규 컨트롤타워 (6개)
| 컨트롤타워 | 역할 |
|---|---|
| `utils/session-manager.ts` | 세션 무효화/생성 단일 진입점. `app_source`(hanjul/flyer/super) 분리로 전단AI와 한줄로 공존 + 같은 앱 내 단일 세션 강제 |
| `utils/campaign-validation.ts` | 과거 예약 차단 `validateScheduledAt()` — 파싱/과거/최대 365일 검증. POST `/`, `/direct-send`, PUT `/:id/reschedule` 3곳 통합 |
| `utils/format-number.ts` (+ frontend `formatDate.ts` 동일 함수) | `formatNumericLike()` — 정수/소수 자동 포맷. trailing zero 제거, 전화번호/YYMMDD 제외. 백/프론트 완전 동일 규칙 |
| `utils/upload-mapping-validator.ts` | 업로드 매핑 충돌 검증 `validateUploadMapping()`. 충돌 4종(slot_label/slot_type/label_moved/label_duplicate) × 해결 4종(유지/덮어쓰기/이동/취소) |
| `standard-field-map.ts` `applyFieldAliases()` | FIELD_MAP aliases(`name:['이름','성함']`) 자동 주입 — `extractVarCatalog` 최종 반환 전 호출하여 모든 회사 자동 혜택 |
| `components/NameEmptyWarningModal.tsx` / `UploadMappingConflictModal.tsx` | 재사용 가능 프론트 모달 2개 신설 |

#### 해결 항목 (PDF 9건 + 결정사항 2건)
| # | 영역 | 근본 원인 | 해결 |
|---|---|---|---|
| **P0** | 계정 중복접속 차단 | D100에서 "전단AI 401 방지"를 위해 5개 세션 허용했던 것이 "3명 동시 로그인 허용"으로 남음 | session-manager.ts + `app_source` 컬럼으로 서비스 분리. hanjul 1세션 + flyer 1세션 공존. 로그인 3곳(frontend/company-frontend/flyer-frontend) appSource 전달 + useSessionGuard storage 이벤트로 즉시 감지 |
| **P2** | isoi 직접발송 `%이름%` NULL | customer_schema.field_mappings 비어있는 회사에서 FIELD_MAP fallback 시 displayName('고객명')만 등록 → `%이름%` 매칭 실패 → 안전망이 빈값 치환 | 4단계 방어: (1) FIELD_MAP.aliases + applyFieldAliases (2) replaceVariables 폴백 — customer.name 비면 addressBookFields.name 사용 (3) NameEmptyWarningModal — 프론트 경고 (4) 직접발송 + 직접타겟발송 양쪽 |
| **P3** | 맞춤한줄 발송확정 (광고)+080 중복 | Dashboard.tsx 1968(미리보기) + 1664(실발송 body) 2곳 모두 `isAd={isAd}` Dashboard 전역 state 사용 → 맞춤한줄 Step 3에서 사용자 토글한 `customSendData.isAd` 무시 | 2곳 전부 `customSendData.isAd ?? false`로 변경 (미리보기와 실발송 동일) |
| **P4** | 예약대기 race condition + 과거 예약 orphan | (1) onClick 핸들러가 state 초기화 없이 fetch → 응답 도착 순서 역전 시 덮어쓰기 (2) D110 UNION ALL 승격 시 outer `ORDER BY seqno`가 inner alias `idx`와 충돌 → MySQL 에러 → 0건 (3) POST /, direct-send, reschedule에 과거 예약 차단 검증 전무 (4) 기존 32건 orphan draft 누적 | (1) `latestSelectedIdRef` + 4곳 race guard + state 선초기화 (2) **`smsSelectAll` 컨트롤타워에 alias 자동 재작성** — `extractAliasMap` + `rewriteSuffixWithAliases` → outer suffix의 raw 컬럼명을 자동으로 inner alias로 치환 (3) campaign-validation.ts 신설 + 호출부 3곳 적용 (4) orphan 32건 서버에서 일괄 cancelled 처리 |
| **P5** | 자동발송 사전알림 (광고) 누락 | CT-B `buildPreNotifyMessage`/`buildAiGeneratedNotifyMessage`/`buildSpamTestResultNotifyMessage` 3개 빌더가 `messageContent`를 순수 본문 그대로 push — buildAdMessage 호출 없음 | CT-B에 `isAd`/`opt080Number`/`messageType` 파라미터 추가 + `applyAdAndSanitize()` 내부 헬퍼 신설. auto-campaign-worker 호출부 3곳에서 `getOpt080Number` 조회 후 전달 |
| **P6** | 자동발송 스팸결과 "통과 통과" 중복 | auto-campaign-worker가 `'통과 ✓'`를 spamResultLabel로 넘기는데, CT-B 빌더가 `.replace(/✓/g, '통과')` → `통과 통과` 중복 | 호출부 라벨 `'통과'/'차단'` 단순화 + 빌더 replace 제거 (sanitize strip만 유지) |
| **E1** | 직접타겟발송 gender 'F' 노출 | TargetSendModal.tsx + DirectTargetFilterModal.tsx에 D109 이전의 인라인 `GENDER_DISPLAY_MAP`/`isGenderField` 하드코딩이 잔존 → D109 `FRONT_FIELD_DISPLAY_MAP` 컨트롤타워 미사용 | 인라인 하드코딩 2곳 전부 삭제 → `FRONT_FIELD_DISPLAY_MAP`/`reverseDisplayValueFront` 호출로 통합 |
| **E2** | 자동발송 시간 불일치 | `calcNextRunAt` 로직이 `routes/auto-campaigns.ts` + `utils/auto-campaign-worker.ts` **2곳에 동일 코드 중복** — 한쪽 수정 시 불일치 재발 위험 | worker 하나로 통합 `export` + routes에서 import. 워커 주기 1분 + 정각 align 유지 |
| **E3** | 캘린더 취소 이력 미표시 | D100에서 `cancelled/draft` 둘 다 캘린더 기본 제외 처리 — 취소 이력 확인 불가 | `draft`만 제외하도록 변경 (CalendarModal은 이미 cancelled 스타일/취소사유 렌더링 준비됨) |
| **①** | 업로드 매핑 충돌 | AI 자동 매핑이 회차마다 같은 헤더를 다른 custom_N 슬롯에 배정 가능 + CT-07이 `ON CONFLICT DO UPDATE` 라 기존 라벨/타입 조용히 덮어씀 → 기존 고객과 신규 고객의 custom_fields 의미 불일치 → 타겟팅 오류 | upload-mapping-validator.ts + `POST /api/upload/validate-mapping` + UploadMappingConflictModal 신설. 업로드 흐름: parse → mapping → **validate-mapping** → save |
| **②** | 숫자/소수점 포맷 미리보기 vs 실발송 불일치 | 백엔드 `replaceVariables`는 `/\d+\.\d+/` (소수점 필수) 패턴 → 정수 `50000` 감지 못함 → 쉼표 없이 발송. 프론트 formatPreviewValue는 정수도 감지 → 미리보기만 쉼표 | `formatNumericLike()` 컨트롤타워 백/프론트 동일 신설. messageUtils + formatPreviewValue + formatNumberPreview 3곳 통합. 규칙: 정수 그대로 / trailing zero 제거 / 유효 소수 보존 / 전화번호 / YYMMDD / YYYYMMDD 제외 |

#### DB 마이그레이션
```sql
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS app_source VARCHAR(20) NOT NULL DEFAULT 'hanjul';
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_app_active ON user_sessions(user_id, app_source) WHERE is_active = true;

-- orphan draft 32건 정리
UPDATE campaigns SET status='cancelled', cancel_reason='D111 P4: 과거 예약 orphan draft 일괄 정리'
WHERE scheduled_at IS NOT NULL AND scheduled_at < NOW() AND status='draft';
```

#### 핵심 교훈 (D111)
> **1. "동일 로직 2곳 이상 = 즉시 컨트롤타워" 원칙 또 적용됨.** `calcNextRunAt`이 routes/utils 2곳에 중복돼 있었고 한쪽 수정 시 불일치 위험. D110의 `smsSelectAll` UNION ALL 승격 시 호출부의 `ORDER BY seqno`/`ORDER BY msg_instm` 같은 raw 컬럼명 참조가 inner alias와 충돌 — **컨트롤타워가 alias 매핑을 자동 추출해서 suffix를 재작성하도록** 근본 수정. 호출부 땜질 3건은 전부 revert.
>
> **2. "설계 → 컨펌 → 전수 파악 → 구현 → 검증" 프로세스 재확인.** P3 수정 시 미리보기 prop 1줄만 고치고 "완료" 하려다 실발송 body도 같은 버그 있었음을 Harold님이 재현하시면서 발견. 이후 isAd 관련 호출부 매트릭스 전수 grep 후 2곳 동시 수정.
>
> **3. 자연어 "우기는" 행동 절대 금지.** 제가 배포 여부를 Harold님 기억보다 제 추측으로 판단해서 "배포 안 된 것 같다"고 우겼다가 서버 확인 결과 D111 완전 반영 상태였음. 서버 조회 명령어 먼저 안내하고 결과 기반으로 판단하는 원칙 철저 준수.
>
> **4. 5개 발송 경로 × 데이터 출처 매트릭스 유효.** D109에 이어 D111도 매트릭스 전수 점검으로 잔존 인라인(TargetSendModal/DirectTargetFilterModal의 GENDER_DISPLAY_MAP) 발견. 신규 컨트롤타워 만든 후 반드시 `grep -rn` 으로 기존 인라인 잔존 확인 필수.
>
> **5. 이관 D-4 리스크 관리.** 4/13 레거시 이관 전 마지막 세션이라 Harold님 예민도 극대. 땜질/대강 훑기 절대 금지, 컨트롤타워 + 전수 + 근본 원칙 철저히. 내일~12일까지 직원 자체 검증, 12일 코드 동결 추천.

#### 산출물
- **`status/한줄로_업데이트_검증가이드_2026-04-09.docx`** — 직원 검증용 Word 문서. 마지막 결정사항 2건(업로드 매핑 충돌 / 숫자 포맷)에 대한 수정 내용 + 5단계 검증 체크리스트. 표지+1번+2번+보고방법 4섹션.

---

### 🔧 D110 — 캠페인 결과조회 버그 + CT-04 전면 UNION ALL 최적화 (2026-04-08) — ✅ 코드수정완료, 배포대기

> **배경:** 슈퍼관리자 "캠페인내역 조회" 모달에서 완료된 캠페인 상세 조회 시 0건으로 나오는 버그 발견. 근본 원인은 `admin.ts sms-detail` 라우트가 `FROM SMSQ_SEND` 단일 테이블에 하드코딩되어 있어 QTmsg Agent가 완료 처리 후 LOG 테이블(`SMSQ_SEND_X_YYYYMM`)로 이동시킨 데이터를 못 찾는 것. 단순 버그 수정 후 Harold님 지시로 **발송·결과 양쪽 경로 전체 성능 재검토 + CT-04 전면 UNION ALL 승격**까지 확장.

#### 📌 버그 (B-D110-01) — 캠페인 상세 조회 0건
- **현상:** 슈퍼관리자 발송통계 화면의 [조회] 클릭 시 "발송 내역이 없습니다" 표시 (완료된 캠페인)
- **원인:** `packages/backend/src/routes/admin.ts:1534,1540` — `FROM SMSQ_SEND` 단일 테이블 하드코딩 (CLAUDE.md 4-2 하드코딩 금지 위반)
- **확인 절차:** QTmsg Agent가 rsv1=5 완료 처리 시 LIVE 테이블(SMSQ_SEND_X) → LOG 테이블(SMSQ_SEND_X_YYYYMM)로 이동. 완료 캠페인은 LOG에만 존재
- **해결:** `getCampaignSmsTables(companyId, refDate, userId)` CT-04 신설 — 해당 회사 라인그룹 LIVE(1~2개) + 발송월 LOG(1개) = **O(2~3) 테이블만** 조회. `smsCountAll` + `smsSelectAll` 컨트롤타워로 교체. 카카오 인라인 쿼리도 `kakaoCountWhere` + `kakaoSelectWhere`로 교체

#### 🚀 성능 최적화 — CT-04 전면 UNION ALL 승격

Harold님 지시: **"고객사가 늘어나도 가장 최적의 속도를 보장할 수 있도록 발송 및 결과 둘 다 체크해보도록하자"**

**기존 CT-04 helper의 문제:**
- `smsCountAll` / `smsAggAll` / `smsSelectAll` / `smsMinAll` 모두 **for 루프 N회 쿼리** (N = 회사 라인그룹 테이블 수)
- `results.ts`에는 이미 UNION ALL 기반 `smsUnionCount`/`smsUnionSelect`/`smsUnionGroupBy` 로컬 함수가 있었음 — 검증된 패턴
- 그러나 CT-04는 미승격 → 같은 패턴 중복

**승격/신설 컨트롤타워 (sms-queue.ts):**

| 함수 | 이전 | 이후 |
|------|------|------|
| `smsCountAll` | for 루프 N쿼리 | **UNION ALL 단일 쿼리** (SUM 외곽) |
| `smsAggAll` | for 루프 N쿼리 | **UNION ALL 단일 쿼리** + JS 합산 |
| `smsSelectAll` | for 루프 N쿼리 | **UNION ALL 단일 쿼리** + `_sms_table` 리터럴 보존 |
| `smsMinAll` | for 루프 N쿼리 | **UNION ALL 단일 쿼리** (MIN 외곽) |
| `smsGroupByAll` (신규) | results.ts 로컬 | **CT-04 승격** — UNION ALL + GROUP BY |
| `smsBatchAggByGroup` (신규) | 없음 | **다중 campaign_id IN + GROUP BY 배치 집계** (sync-results 루프 최적화용) |
| `getCampaignSmsTables` (신규) | 전역 스캔 | **회사 LIVE + 발송월 LOG = O(2~3)** |
| `kakaoCountWhere` (신규) | results.ts 로컬 | CT-04 승격 |
| `kakaoSelectWhere` (신규) | results.ts 로컬 | CT-04 승격 |
| `kakaoGroupBy` (신규) | 없음 | 카카오 범용 GROUP BY |
| `kakaoBatchAggByGroup` (신규) | 없음 | 카카오 다중 REQUEST_UID 배치 집계 |

**whereClause 규약 유연화:** 모든 helper에 `normalizeWhere()` — `"WHERE ..."` 접두사 유무 자동 수용 (호출부 규약 차이 흡수)

#### 🔄 sync-results 루프 배치화 (campaign-lifecycle.ts)

**기존:**
```
for (const run of runs) {
  smsAggAll(runTables, ..., [run.campaign_id])  // N개 run × N개 테이블 = N² 쿼리
  kakaoAgg('REQUEST_UID = ?', [run.campaign_id]) // N개 쿼리
}
```

**개선:**
```
회사/유저 조합별 그룹핑 → smsBatchAggByGroup(tables, 'app_etc1', aggFields, [id들])  // 1~2 쿼리
kakaoBatchAggByGroup(allIds)  // 카카오 전체 1 쿼리
for (const run of runs) { smsAggMap.get(run.campaign_id) ... }  // 메모리 조회
```

**쿼리 수: O(N²) → O(1)** — 고객사 수/캠페인 수 무관

#### 📋 수정 파일 요약

| 파일 | 변경 |
|------|------|
| `packages/backend/src/utils/sms-queue.ts` | CT-04 helper UNION ALL 재작성, 신규 함수 7개 추가 (`getCampaignSmsTables`, `smsGroupByAll`, `smsBatchAggByGroup`, `kakaoCountWhere`, `kakaoSelectWhere`, `kakaoGroupBy`, `kakaoBatchAggByGroup`), `getAllSmsTablesWithLogs` (사용 안함 유지) |
| `packages/backend/src/routes/admin.ts` | sms-detail 라우트 — `getCampaignSmsTables` + `smsCountAll`/`smsSelectAll`, 카카오는 `kakaoCountWhere`/`kakaoSelectWhere`. 1186/1331 테스트 통계는 `getTestSmsTables()` + `smsAggAll`/`smsSelectAll` |
| `packages/backend/src/routes/manage-users.ts` | 임시비밀번호 SMS INSERT — `SMSQ_SEND` 하드코딩 → `getAuthSmsTable()` 동적 조회 (시스템 SMS는 auth 라인 사용) |
| `packages/backend/src/routes/billing.ts` | `getBillingCompanyTables`/`getBillingTestTables` 자체 헬퍼 → CT-04 `getCompanySmsTables`/`getTestSmsTables` 래퍼 + `getBillingLogTables`는 information_schema REGEXP로 변경 |
| `packages/backend/src/utils/campaign-lifecycle.ts` | `syncCampaignResults` 루프 → 배치 집계 (AI runs + 직접발송 양쪽). `smsAggAll`/`kakaoAgg` import 제거 |
| `packages/backend/src/routes/results.ts` | 로컬 `smsUnionCount`/`smsUnionGroupBy`/`kakaoCountWhere`/`kakaoSelectWhere` 제거, CT-04 import로 교체. `smsUnionSelect`만 호환 래퍼로 유지 (ORDER BY/LIMIT 후미구문 호환) |

#### 📊 확장성 결과

| 시나리오 | 이전 | 이후 |
|---|---|---|
| 캠페인 1건 상세 조회 | 27 테이블 × 2 = 54 쿼리 | **1 쿼리** (UNION ALL 2~3 테이블) |
| 회사 1곳 sync (N runs) | N runs × 2 쿼리 = 2N | **1~2 쿼리** (회사당 + 카카오 1) |
| 대시보드 차트 1건 | 이미 UNION ALL (기존) | 동일 (CT-04로 승격) |
| 발송 70만건 | 140 배치 bulk INSERT (기존) | 동일 (변경 없음) |

**고객사 1개 → 1000개로 확장되어도 단일 캠페인 조회 쿼리 수는 일정.**

#### ⚠️ 배포 주의
- **tp-push + tp-deploy-full 미실행 상태** (Harold님 오늘 밤 배포 계획)
- 배포 후 전지영 주임님 기보 건과 무관, 버그 수정은 즉시 배포 필요

#### 핵심 교훈 (D110 — 컨트롤타워 반복 승격)

> **1. "동일 로직이 2곳 이상 = 즉시 컨트롤타워" 원칙이 또 적용됨.** `results.ts`가 이미 UNION ALL 패턴을 로컬로 검증해두고 있었는데 CT-04 미승격 → admin.ts/campaign-lifecycle.ts가 옛 for 루프 패턴을 그대로 씀 → 성능 격차. **검증된 로컬 패턴은 즉시 컨트롤타워로 승격해야 확장 이득이 발생.**
>
> **2. 하드코딩 테이블명(`SMSQ_SEND`)은 "숨어 있는 지뢰".** CLAUDE.md 4-2에 명시된 원칙이지만 admin.ts에 여전히 존재 → B-D110-01로 실화. 신규 파일 작성 시 `grep -rn "SMSQ_SEND"` 정기 스캔 필요.
>
> **3. "전역 스캔" 함수는 확장성 킬러.** 초기 수정 시 `getAllSmsTablesWithLogs()` (회사 무관 전역) 만들었다가 속도 저하 체감 → `getCampaignSmsTables(companyId, refDate, userId)` (해당 회사 발송월만)로 재설계. **캠페인 단일 조회는 항상 회사 + 발송월 기준으로 좁혀야 함.**
>
> **4. Promise.all 병렬화보다 UNION ALL 단일 쿼리가 상위.** Promise.all은 여전히 N회 왕복 + 커넥션 풀 점유. UNION ALL은 1회 왕복. 단, 호출부 규약(`WHERE` 접두사 유무)을 흡수하는 `normalizeWhere()` 필수.

---

### 🔧 D109 — 0406+0407 PDF 버그 + 검수리스트 일괄 처리 (2026-04-07) — ✅ 배포완료

> **배경:** 직원 검수리스트 + PDF 버그리포트 2일치(0406, 0407) 13건을 한 번에 잡음. 핵심은 컨트롤타워화 — 인라인 중복 함수 7개를 컨트롤타워 4개로 통합 + 백엔드 데이터 출처 시점 enum 변환으로 표시 경로 자동 정상화.

#### 신규 컨트롤타워 (8개)
| 컨트롤타워 | 위치 | 효과 |
|-----------|------|------|
| `CAMPAIGN_OPT080_SELECT_EXPR` + `buildCampaignOpt080LeftJoin()` | unsubscribe-helper.ts (CT-03 확장) | 캠페인 SELECT 8곳에 user/company 080번호 LEFT JOIN — alias 가변 (자동발송 'ac' 지원) |
| `formatCampaignMessageForDisplay()` + `stripAdParts()` | formatDate.ts (frontend) | 표시용 메시지 컨트롤타워 — D103 위반 데이터(message_content에 (광고)/무료거부 박힌 케이스) 정규화 후 is_ad에 따라 재부착 |
| `FIELD_DISPLAY_MAP` + `reverseDisplayValue()` | standard-field-map.ts (backend) | DB enum 값(gender F/M) → 표시 한글(여성/남성) 역변환 — 향후 enum 필드 추가 시 한 곳만 수정 |
| `FRONT_FIELD_DISPLAY_MAP` + `reverseDisplayValueFront()` | formatDate.ts (frontend) | 백엔드 FIELD_DISPLAY_MAP과 동기화 |
| `replaceVarsByFieldMeta()` | formatDate.ts | FieldMeta[] 기반 변수 치환 (DirectPreviewModal/TargetSendModal 인라인 통합) |
| `replaceVarsBySampleCustomer()` | formatDate.ts | sampleCustomer(displayName 키) 기반 + aliasMap 옵션 (AiCampaignResultPopup/AiPreviewModal 인라인 통합) |
| `fetchTargetSampleCustomer()` (CT-A) | utils/target-sample.ts | 자동발송 미리보기/스팸테스트 첫 고객 조회 단일 진입점 — store_code 격리 + 수신거부 제외 자동 |
| `buildAiGeneratedNotifyMessage()` / `buildPreNotifyMessage()` / `buildSpamTestResultNotifyMessage()` + `sanitizeSmsText()` (CT-B) | utils/auto-notify-message.ts | 자동발송 담당자 알림 빌더 — dingbats/이모지 자동 제거 + 옵션 A(=== 가로선) 디자인 |

#### 해결 항목 (PDF 13건 + 검수리스트)
| # | 영역 | 근본원인 | 해결 |
|---|------|---------|------|
| **B1** | 맞춤한줄 MMS 이미지 첨부 누락 | AiCustomSendFlow에 MMS UI 자체 미구현 + Dashboard handleAiCustomSend의 mmsImagePaths 하드코딩 [] | UI 인라인 추가 (Step 2 + variant 카드 + 미리보기 모달 + 발송확정 모달 4곳) + Dashboard에서 props 전달 + mmsImagePaths 조건부 전달 |
| **B2** | 발송결과 상세보기 (광고)+080 누락 | (1) 백엔드 results.ts SELECT에 opt_out_080_number 누락 (2) 호출부 7곳이 callback_number를 4번째 인자로 잘못 전달 (3) ResultsModal 794줄 buildAdMessageFront 미적용 (4) frontend buildAdMessageFront에 idempotent 처리 누락 → 중복 부착 발생 | 백엔드 SELECT 8곳에 LEFT JOIN 추가 + formatCampaignMessageForDisplay 컨트롤타워 + stripAdParts 정규화 + buildAdMessageFront idempotent 추가 |
| **B3** | 캘린더 광고 미표기인데 (광고)+080 자동기입 | direct-send INSERT 컬럼에 `is_ad` 자체가 누락 → 항상 false로 저장 + D103 위반 데이터(message_content에 (광고) 박힌 캠페인) | direct-send INSERT에 is_ad 컬럼 추가 + stripAdParts로 표시 시점 정규화 |
| **B8** | 슈퍼관리자 발송통계 일/월 뒤바뀜 | `setStatsView(key); setTimeout(() => loadSendStats(1), 0)` — React state batched 라 setTimeout 안에서도 statsView가 stale | `loadSendStats(page, viewOverride)` 시그니처 + `loadSendStats(1, key)` 명시 전달 |
| **검수 UX** | 캠페인 확정 후 변수 직관성 부족 | 변수 위치 vs 머지 결과를 동시에 못 봄 | `mergeAndHighlightVars()` 신설 + AiCampaignSendModal/AiCustomSendFlow 변수 강조 ↔ 머지 결과 토글 |
| **0407-1** | 직접타겟발송 성별(여성) `F` 출력 | 5개 발송 경로 × 데이터 출처 4곳에서 enum 'F'/'M'을 한글로 역변환하지 않음. frontend 인라인 replaceVars 7곳이 산재 | (1) backend ai.ts:recommend-target + customers.ts:/extract + customers.ts:/enabled-fields + target-sample.ts 4곳에서 데이터 응답 시점에 reverseDisplayValue 적용 → 한 곳만 수정해도 모든 frontend 표시 경로 자동 정상화 (2) frontend 인라인 replaceVars 7곳을 컨트롤타워 4개(`replaceVarsByFieldMeta` / `replaceVarsBySampleCustomer` / `replaceMessageVars` / `replaceDirectVars`)로 통합 |
| **0407-2** | 맞춤한줄 매장/브랜드 수정 시 0명 | (1) ai.ts:recount-target에 minPurchaseAmount 처리 자체 누락 (2) 매장/구매기간/기타조건 등 자연어 필드는 백엔드 재파싱 불가 | 발송대상 카드 + 프로모션 카드 양쪽 수정 기능 제거 (read-only) → "변경하려면 이전 단계에서 새 브리핑" 안내. 변수 케이스 폭발 방지 |
| **0407-3** | 맞춤한줄 LMS 제목 수정 미반영 | Dashboard.tsx:1632 `subject: variant.subject || ''` ← modalData.subject(사용자 수정값) 무시 | `subject: modalData.subject ?? variant.subject ?? ''` 우선순위 변경 |
| **자동발송 5건** (B4~B7, 0407-4) | 자동발송 영역 | 직원 검증 예정 — Harold님 검증 범위 외 | (코드 수정 완료, 직원 검증 후 처리) |

#### 자동발송 5건 코드 변경 요약 (직원 검증 대기)
- **B4 자동발송 스팸필터 미리보기 개인화** — AutoSendFormModal에서 스팸필터 모달 직전 `POST /api/auto-campaigns/preview-sample` 호출 (CT-A 신설)
- **B5 자동발송 스팸테스트 타겟 불일치** — auto-campaign-worker 인라인 SELECT 2곳 → CT-A로 통합 (store_code 격리 자동)
- **B6 자동발송 알림 ?/이모지** — 알림 메시지 빌더 3곳 → CT-B 통합 (sanitizeSmsText로 dingbats 자동 제거)
- **B7 자동발송 시간 지연** — 워커 주기 3분 → 1분 + 다음 분 0초 align
- **0407-4 자동발송 AI 개인화 미적용** — auto_campaigns 테이블에 personal_fields TEXT[] 컬럼 추가 + INSERT/UPDATE/worker extraContext (`personalizationVars`) 전달

#### DB 마이그레이션
```sql
ALTER TABLE auto_campaigns ADD COLUMN IF NOT EXISTS personal_fields TEXT[] DEFAULT NULL;
```

#### 수정 파일 (24개)
**백엔드 (12)**
- (신규) `utils/target-sample.ts` (CT-A), `utils/auto-notify-message.ts` (CT-B)
- `utils/standard-field-map.ts` (FIELD_DISPLAY_MAP)
- `utils/unsubscribe-helper.ts` (CAMPAIGN_OPT080_*)
- `utils/messageUtils.ts` (replaceVariables enum 역변환)
- `utils/auto-campaign-worker.ts` (인라인 SELECT 2곳→CT-A, 알림 3곳→CT-B, 워커 1분+정각, personalizationVars)
- `utils/stats-aggregation.ts` (캠페인 SELECT opt_out_080)
- `routes/results.ts` (캠페인 목록/상세 SELECT)
- `routes/campaigns.ts` (캘린더/캠페인 상세 SELECT + direct-send is_ad INSERT)
- `routes/admin.ts` (슈퍼관리자 통계 SELECT)
- `routes/ai.ts` (recommend-target sampleCustomer enum 변환 + recount-target storeName contains/minPurchaseAmount)
- `routes/auto-campaigns.ts` (preview-sample 라우트 + INSERT/UPDATE personal_fields)
- `routes/customers.ts` (/extract + /enabled-fields enum 변환)

**프론트엔드 (12)**
- `utils/formatDate.ts` (formatCampaignMessageForDisplay/stripAdParts/replaceVarsByFieldMeta/replaceVarsBySampleCustomer/FRONT_FIELD_DISPLAY_MAP)
- `utils/highlightVars.tsx` (mergeAndHighlightVars)
- `components/ResultsModal.tsx` (3곳 컨트롤타워 호출)
- `components/CalendarModal.tsx` (컨트롤타워 호출)
- `components/AiCustomSendFlow.tsx` (MMS UI 4곳 + 머지 토글 + 발송대상 카드 read-only)
- `components/AutoSendFormModal.tsx` (preview-sample 호출)
- `components/AiCampaignSendModal.tsx` (머지 토글 + 인라인 통합)
- `components/AiCampaignResultPopup.tsx` (인라인 통합)
- `components/AiPreviewModal.tsx` (인라인 통합)
- `components/DirectPreviewModal.tsx` (인라인 통합)
- `components/TargetSendModal.tsx` (인라인 통합)
- `pages/Dashboard.tsx` (handleAiCustomSend modalData.subject 우선 + mmsImagePaths 조건부)
- `pages/AdminDashboard.tsx` (loadSendStats viewOverride + 컨트롤타워 호출)
- `pages/AutoSendPage.tsx` (history 컨트롤타워)

#### 핵심 교훈 (B+0407 — 매트릭스 전수파악)
> **데이터 출처에서 변환하면 표시 경로 모두 자동 정상화.** frontend 표시 함수마다 enum 매핑을 추가하는 것보다, 백엔드 응답 시점에 한 번 변환하는 게 안전 + 컨트롤타워 효율 압도적.
>
> **인라인 함수 7곳 산재 = D106 재발 패턴.** 동일 로직이 2곳 이상이면 즉시 컨트롤타워 추출. 시간 없어서 인라인으로 빠르게 패치 = 다음 세션에 또 잡힘.
>
> **5개 발송 경로 × 데이터 출처 매트릭스로 한 번에 점검.** 한 경로씩 보면 또 빠짐. 매트릭스 = (한줄로AI / 맞춤한줄 / 직접발송 / 직접타겟발송 / 자동발송) × (미리보기 / 스팸필터 / 담당자테스트 / 실제발송) × (데이터 출처 API).

---

### 🔧 D108 — AI 분석 시각화 고도화 + BUSINESS 자동화 연계 + 예시 PDF (2026-04-04) — ✅ 배포완료

> **배경:** PRO(기본분석)와 BUSINESS(상세분석)의 체감 차이가 텍스트 인사이트 개수 차이뿐이었음. 시각적 차트 + BUSINESS 전용 자동화 연계 버튼 + 시연용 예시 PDF로 고도화.

#### 핵심 변경
- **PRO 차트 6종 추가:** 가로바(채널 성공률), 히트맵(요일x시간), 도넛(채널비율), 스택바(성별/등급), 미니라인(수신거부), 스코어카드(종합점수)
- **BUSINESS 차트 추가:** RFM 매트릭스, 퍼널(발송→성공→구매전환), 액션 타임라인
- **BUSINESS 자동화 연계:** "이 타겟으로 캠페인 만들기" 버튼 → 분석 결과에서 AI 한줄로 자동 실행
- **PRO 블러 배지:** 액션 버튼 자리에 "비즈니스 요금제에서 바로 실행 가능" 블러
- **collectedData 응답 포함:** 프론트에서 차트용 원본 데이터 직접 접근
- **히트맵 쿼리 추가:** 요일x시간 교차 성공률 데이터
- **예시 PDF 2종:** PRO(122KB, 5p, 차트6종) + BUSINESS(145KB, 8p, 차트12종+RFM+퍼널+액션플랜)
- **"고객 인사이트" → "AI 분석" 카드 교체:** 대시보드 하단 카드에서 AI 분석 맛보기 + 예시 리포트 다운로드 연결
- **예시 리포트 다운로드:** AnalysisModal 분석 실행 전 화면 + 프리뷰 섹션(무료) 양쪽에 PRO/BUSINESS 예시 PDF 다운로드 버튼

#### 수정 파일 (6개)
| 파일 | 변경 |
|------|------|
| **(신규)** `AnalysisCharts.tsx` | 순수 SVG/CSS 차트 컴포넌트 9종 |
| **(신규)** `public/sample_analysis_pro.pdf` | PRO 예시 리포트 (차트 포함) |
| **(신규)** `public/sample_analysis_business.pdf` | BUSINESS 예시 리포트 (차트+RFM+퍼널+액션플랜) |
| `analysis.ts` (백엔드) | collectedData 응답 포함 + 히트맵 쿼리 + actionItems 프롬프트 |
| `AnalysisModal.tsx` | 차트 렌더링 + 액션 버튼 + 예시 PDF 다운로드 + keyMetrics/recommendations |
| `Dashboard.tsx` | "고객 인사이트"→"AI 분석" 카드 교체 + onActionPrompt 콜백 |

---

### 🔧 D107 — AI 발송 템플릿 + DB 현황 디자인 리뉴얼 + 메시지 셀 컨트롤타워 (2026-04-04) — ✅ 배포완료

> **배경:** 기존 "빠른 발송 예시" 하드코딩 4개 카드를 "AI 발송 템플릿" 시스템으로 고도화. DB 현황 카드 디자인 모던화. 발송 내역 메시지 셀 컨트롤타워화.

#### 신규 컨트롤타워
| 컨트롤타워 | 파일 | 효과 |
|-----------|------|------|
| `saveSegment()` | saved-segments.ts | 세그먼트 저장 (20개 제한) |
| `getSegments()` | saved-segments.ts | 목록 조회 (최근 사용순) |
| `updateSegment()` | saved-segments.ts | 세그먼트 수정 (소유자 확인) |
| `deleteSegment()` | saved-segments.ts | 삭제 (소유자 확인) |
| `touchSegment()` | saved-segments.ts | 사용 시각 갱신 |
| `MessageCell` | ResultsModal.tsx | 메시지 내용 셀 렌더링 3곳 통일 |

#### 핵심 변경
- **"AI 발송 템플릿" 전면 구축** — 하드코딩 4개 예시 제거 → 전부 DB 저장. 업체/사용자별 완전 격리. 검색/8개씩 페이징/수정모달/+새로 만들기. 맞춤한줄 필드 선택은 한글 체크박스 목록(enabled-fields API 연동)
- **AiSendTypeModal 스킵** — 템플릿 클릭 시 타입이 이미 정해져 있으므로 중간 모달 없이 바로 실행
- **맞춤한줄 Step 1 스킵** — preloadData prop으로 필드/브리핑/채널 사전 세팅, Step 2부터 시작
- **발송 성공 후 저장** — CampaignSuccessModal에 "이 설정 저장하기" 인라인 폼 (이모지 16종 + 이름 입력)
- **DB 현황 디자인 리뉴얼** — 파스텔 bg 제거 → 화이트 카드 + 아이콘 컬러 배경 + distribution 프로그레스 바 + 호버 shadow. 요금제/발송 현황 헤더 통일 (녹색 바 + 볼드). 페이징 좌우 < > 화살표 추가
- **메시지 셀 컨트롤타워** — ResultsModal 3곳 인라인 메시지 표시를 MessageCell 서브 컴포넌트로 통일 (40글자 표시 + 클릭→모달 전체 보기)

#### DB 마이그레이션
```sql
CREATE TABLE saved_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) DEFAULT '📋',
  segment_type VARCHAR(20) NOT NULL,
  prompt TEXT,
  auto_relax BOOLEAN DEFAULT false,
  selected_fields TEXT[],
  briefing TEXT,
  url VARCHAR(500),
  channel VARCHAR(10),
  is_ad BOOLEAN DEFAULT false,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_saved_segments_company_user ON saved_segments(company_id, user_id);
```

#### 수정 파일 (11개)
| 파일 | 변경 |
|------|------|
| **(신규)** `utils/saved-segments.ts` | 컨트롤타워 5함수 (save/get/update/delete/touch) |
| **(신규)** `routes/saved-segments.ts` | CRUD 라우트 5개 (GET/POST/PUT/DELETE/POST touch) |
| `app.ts` | 라우트 등록 |
| `RecommendTemplateModal.tsx` | 전면 재작성 — 검색/페이징/수정모달(EditSegmentModal)/+새로만들기/한글 체크박스 필드선택 |
| `CampaignSuccessModal.tsx` | 저장 세그먼트 UI (이모지 + 이름 + 저장) |
| `AiCustomSendFlow.tsx` | preloadData prop + Step 2 자동 점프 |
| `Dashboard.tsx` | "AI 발송 템플릿" 카드 + DB 현황 리뉴얼 + 헤더 통일 + 페이징 화살표 + customFlowPreload/lastSendConfig state |
| `ResultsModal.tsx` | MessageCell 서브 컴포넌트 + 3곳 교체 (메시지 40글자+클릭→모달) |

#### 수정 파일 (7개)
| 파일 | 변경 |
|------|------|
| **(신규)** `utils/saved-segments.ts` | 컨트롤타워 4함수 |
| **(신규)** `routes/saved-segments.ts` | CRUD 라우트 4개 |
| `app.ts` | 라우트 등록 |
| `RecommendTemplateModal.tsx` | 전면 리뉴얼 (Props 변경, 세그먼트 로드/삭제) |
| `Dashboard.tsx` | customFlowPreload/lastSendConfig state + 배선 변경 + 저장 콜백 |
| `AiCustomSendFlow.tsx` | preloadData prop + Step 스킵 useEffect |
| `CampaignSuccessModal.tsx` | 저장 세그먼트 UI (이모지 + 이름 + 저장) |

#### DB 마이그레이션 (Harold님 서버 실행)
```sql
CREATE TABLE saved_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id),
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  emoji VARCHAR(10) DEFAULT '📋',
  segment_type VARCHAR(20) NOT NULL,
  prompt TEXT,
  auto_relax BOOLEAN DEFAULT false,
  selected_fields TEXT[],
  briefing TEXT,
  url VARCHAR(500),
  channel VARCHAR(10),
  is_ad BOOLEAN DEFAULT false,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_saved_segments_company_user ON saved_segments(company_id, user_id);
```

---

### 🔧 D103 — (광고) 중복 수정 + 발송 경로 컨트롤타워 전면 통합 + 개별회신번호 동적 필터링 (2026-04-02) — ✅ 배포완료

> **배경:** (광고) 중복 발송 버그 + 발송 경로 인라인 반복 패턴 전면 컨트롤타워화 + 개별회신번호 드롭다운에 전화번호 필드만 동적 표시.

#### 신규 컨트롤타워 6개 (핵심 성과)
| 컨트롤타워 | 파일 | 효과 |
|-----------|------|------|
| `prepareSendMessage()` | messageUtils.ts | 변수 치환 + (광고)+080 통합. 6경로 인라인 2줄 조합 제거 |
| `toQtmsgType()` | sms-queue.ts | SMS→S 코드 변환. 8곳 인라인 제거 |
| `insertTestSmsQueue()` | sms-queue.ts | 테스트 SMS INSERT. 인라인 함수 2개 + 호출 3곳 제거 |
| `resolveCustomerCallback()` | callback-filter.ts | 개별회신번호 최종 결정. 4곳 인라인 제거 |
| `isPhoneLikeValue()` + `detectPhoneFields()` | callback-filter.ts | DB 고객에서 전화번호 형태 필드 동적 감지 |
| `isPhoneLikeValue()` + `detectPhoneHeaders()` | formatDate.ts (프론트) | 파일 업로드 시 전화번호 컬럼 동적 감지 |

#### 구조 변경
- **(광고) 중복 원천 차단** — DB에는 순수 본문만 저장, (광고)+080은 백엔드 `prepareSendMessage()` 한 곳에서만 추가. 프론트 API body에서 `buildAdMessageFront()` 전면 제거.
- **`buildAdMessage()` 중복방지 안전장치** — 이미 (광고)가 있으면 접두사 안 붙임, 이미 수신거부가 있으면 푸터 안 붙임.
- **개별회신번호 드롭다운 5곳 통일** — `__col__` 패턴 + `phoneFields` 기반 동적 필터. 생일/주소 등 비전화번호 필드 제외. 하드코딩 'store_phone' 제거.
- **enabled-fields API** — `phoneFields` 응답 추가 (FIELD_MAP + 커스텀 필드 샘플링 기반 자동 감지)

#### 수정 파일 (13개)
| 파일 | 변경 |
|------|------|
| `messageUtils.ts` | prepareSendMessage + buildAdMessage 중복방지 |
| `sms-queue.ts` | toQtmsgType + insertTestSmsQueue |
| `callback-filter.ts` | resolveCustomerCallback + isPhoneLikeValue + detectPhoneFields |
| `campaigns.ts` | 4경로 prepareSendMessage + toQtmsgType + insertTestSmsQueue + resolveCustomerCallback |
| `auto-campaign-worker.ts` | prepareSendMessage + toQtmsgType + resolveCustomerCallback |
| `spam-test-queue.ts` | 인라인 함수 2개 삭제 → CT import |
| `spam-filter.ts` | 인라인 함수 1개 삭제 + getOpt080Number CT + toQtmsgType |
| `customers.ts` | enabled-fields API에 phoneFields 추가 |
| `Dashboard.tsx` | API body 순수 본문 + phoneFields 로드/전달 + 하드코딩 제거 |
| `AiCustomSendFlow.tsx` | API body 순수 본문 |
| `DirectSendPanel.tsx` | __col__ 패턴 + detectPhoneHeaders 동적 필터 |
| `TargetSendModal.tsx` | phoneFields 기반 동적 필터 |
| `AiCampaignSendModal.tsx` | __col__ 패턴 + phoneFields 동적 |
| `DirectTargetFilterModal.tsx` | phoneFields 콜백 전달 |
| `formatDate.ts` | isPhoneLikeValue + detectPhoneHeaders |
| `CLAUDE.md` | 절대 개발원칙 4-4 강화 |

---

### 🔧 D104 — 0402 PPT 버그리포트 10건 (타임존 컨트롤타워화 + 숫자필터 + YYMMDD + cooldown) (2026-04-02) — ✅ 배포완료

> **배경:** 직원 PPT(한줄로_20260402.pdf) 10건. 타임존 날짜 비교를 컨트롤타워화, 숫자 필터 근본 수정, YYMMDD 보호, cooldown 축소. 자동발송 4건은 별도 세션.

#### 핵심 수정
1. **타임존 날짜 비교 컨트롤타워화** — `AT TIME ZONE 'Asia/Seoul'` → `($N || ' 00:00:00+09')::timestamptz` (PG TZ=UTC에서 정확). stats-aggregation.ts 컨트롤타워 + 4개 라우트 import 교체. 서버 검증 7건 확인
2. **숫자 필터 근본 수정** — buildDynamicFiltersForAPI를 `filterValues` 순회 → `selectedFields` 순회로 변경. 포인트+누적구매금액+평균주문금액 등 전체 숫자 필드 필터 정상화
3. **YYMMDD 보호** — formatPreviewValue + formatNumberPreview 양쪽에 6/8자리 날짜 패턴 보호
4. **타겟발송 날짜 표시** — formatCellValue 인라인 toLocaleString → formatByType 컨트롤타워
5. **발송결과 cooldown** — 30초→5초 + 날짜 변경 시 force=true + onClick 래핑(D93 재발 방지)

#### 수정 파일 (11개)
| 파일 | 변경 |
|------|------|
| stats-aggregation.ts | buildDateRangeFilter/buildMonthRangeFilter/buildPeriodFilter KST timestamptz 패턴 |
| admin.ts | 발송통계+스팸필터 → 컨트롤타워 import |
| manage-stats.ts | 발송통계+스팸필터 → 컨트롤타워 import |
| results.ts | summary+campaigns → buildPeriodFilter import |
| campaigns.ts | 스팸필터 → buildDateRangeFilter import |
| billing.ts | 정산 스팸필터 2곳 인라인 패턴 수정 |
| database.ts | 타입파서 'Z'(UTC) 유지 확인 |
| DirectTargetFilterModal.tsx | selectedFields 순회 + 포인트 min/max UI + B17-06 중복 제거 |
| formatDate.ts | formatPreviewValue+formatNumberPreview YYMMDD 보호 |
| TargetSendModal.tsx | formatCellValue → formatByType CT |
| ResultsModal.tsx | cooldown 5초 + force 파라미터 + onClick 래핑 |

#### 자동발송 4건 — ✅ D105에서 수정 완료

---

### 🔧 D106 — 0403 버그리포트 8건 + 컨트롤타워 전수점검 강제 프로세스 (2026-04-04) — ✅ 배포완료

> **배경:** 직원 PDF(한줄로_20260403.pdf) 8건. 발송통계 컨트롤타워화, 발송결과 SQL ambiguous 수정, 회신번호 동적 감지 보강, 캘린더 (광고)+080 표시 경로 전수 적용, 자동발송 담당자 알림 라인 분리.

#### 핵심 수정 (8건)
| # | 버그 | 원인 | 수정 |
|---|------|------|------|
| B1 | 발송결과 조회 0건 | `LEFT JOIN users`에서 `status` ambiguous + `created_at` 필터 | aliasedWhere에 `\bstatus\b`,`\bsent_count\b`,`\bsent_at\b` 추가 + `COALESCE(sent_at, created_at)` 필터 |
| B2 | 회신번호 드롭다운 무관 컬럼 | `detectPhoneFields` data_type 미체크 + 날짜 패턴 오매칭 | data_type 필터 추가 + isPhoneLikeValue에 `(19\|20)\d{6}` 제외 + 수신번호 컬럼 제외 |
| B3 | 캘린더 (광고)+080 누락 | CalendarModal/ResultsModal/AdminDashboard에서 buildAdMessageFront 미호출 | 3곳 컨트롤타워 호출 추가 |
| B4 | 자동발송 의견 미반영 | 담당자 알림이 대량발송 라인(차단됨)으로 발송 | B6과 동일 원인 — 11번 라인으로 수정 |
| B5 | 스팸필터 미리보기 개인화 미치환 | replaceDirectVars(직접발송 변수 5개만)를 사용 → 필드매핑 변수 미인식 | AutoSendFormModal에서 replaceMessageVars로 사전 치환 후 전달 |
| B6 | D-1 알림 미발송 | 담당자 알림이 getCompanySmsTables(대량발송 라인)으로 INSERT → Agent 차단 | 알림 3곳 getAuthSmsTable(11번 라인)으로 변경 |
| B7 | 설정시간 3분 지연 | 5분 폴링 구조 한계 | 워커 간격 5분→3분 축소 |
| B8 | 일별/월별 뒤바뀜 | 인라인 통계 쿼리 + 프론트 race condition | querySendStats 컨트롤타워 + requestIdRef stale 응답 무시 |

#### 컨트롤타워 신설/강화
| 컨트롤타워 | 파일 | 효과 |
|-----------|------|------|
| `querySendStats()` | stats-aggregation.ts | 발송통계 일별/월별 조회 단일 진입점. manage-stats.ts 인라인 쿼리 제거 |
| `querySendStatsDetail()` | stats-aggregation.ts | 발송통계 상세(사용자별) 단일 진입점 |
| `ensureMonthlyLogTables()` | sms-queue.ts | 앱 기동 시 당월+다음달 MySQL 로그 테이블 자동 확인/생성 (202604 미생성 사고 재발 방지) |

#### 수정 파일 (14개)
| 파일 | 변경 |
|------|------|
| stats-aggregation.ts | querySendStats + querySendStatsDetail 컨트롤타워 신설 |
| manage-stats.ts | 인라인 통계 쿼리 → 컨트롤타워 import 교체 |
| results.ts | aliasedWhere 컬럼 누락 수정 + COALESCE(sent_at, created_at) |
| callback-filter.ts | isPhoneLikeValue 날짜패턴 제외 + detectPhoneFields data_type 필터 |
| auto-campaign-worker.ts | 담당자 알림 3곳 → 11번 라인 + 워커 3분 간격 |
| sms-queue.ts | ensureMonthlyLogTables 자동 생성 |
| app.ts | ensureMonthlyLogTables 기동 시 호출 |
| CalendarModal.tsx | buildAdMessageFront 적용 |
| ResultsModal.tsx | buildAdMessageFront 적용 |
| AdminDashboard.tsx | buildAdMessageFront 적용 |
| AutoSendFormModal.tsx | replaceMessageVars 사전 치환 |
| DirectSendPanel.tsx | 수신번호 컬럼 회신번호 드롭다운 제외 |
| manage/StatsTab.tsx | requestIdRef race condition 방지 + period 키 |
| StatsTab-company.tsx | requestIdRef race condition 방지 + period 키 |
| formatDate.ts | isPhoneLikeValue 날짜패턴 제외 |

#### CLAUDE.md 교훈 추가
- **섹션 7-1 신설:** 컨트롤타워 수정/생성 시 필수 3단계 프로세스 (1단계: 소비처 전수 리스트업 → 2단계: 인라인 잔존 0건 확인 → 3단계: 표시 경로까지 확인)
- **과거 교훈 테이블:** B1(status ambiguous), B2(isPhoneLikeValue 날짜오매칭), B3(buildAdMessageFront 표시경로 누락), B5(replaceDirectVars vs replaceMessageVars), B6(담당자 알림 라인 분리) 추가

---

### 🔧 D105 — 자동발송 4단계 라이프사이클 개선 (P7~P10) (2026-04-02) — ✅ 배포완료

> **배경:** 직원 테스트에서 발견된 자동발송 버그 4건 + D-day 스팸테스트 신설. 직원 요청 프로세스에 맞게 워커 3단계→4단계로 확장.

#### 워커 4단계 라이프사이클
| 단계 | 시점 | 동작 | 담당자 알림 |
|------|------|------|------------|
| 1 | D-2 | AI 문안 생성 | **[P7 신설]** 생성된 문안 SMS 발송 |
| 2 | D-1 | 사전 알림 | **[P9 개선]** 타겟 N명 + 발송시각 포함 |
| 3 | D-day 2시간 전 | **[신설]** 자동 스팸테스트 | 결과(통과/차단) SMS 발송 |
| 4 | D-day 정각 | 실제 발송 | - |

#### 수정 내역
| # | 버그 | 수정 |
|---|------|------|
| P7 | AI문안 생성 후 담당자에게 알림 안 됨 | 문안 생성 완료 후 notify_phones에 SMS 발송 추가 |
| P8 | 스팸필터 미리보기 개인화 미적용 | AutoSendFormModal → SpamFilterTestModal에 firstRecipient 전달 (recommend-target의 sample_customer_raw 사용) |
| P9 | D-1 알림 메시지에 타겟 수/발송시각 없음 | CT-01 + CT-03으로 타겟 수 실시간 조회, "X월 X일 XX:XX" 형식으로 개선 |
| P10 | 워커 10분 간격 → 최대 10분 지연 | 워커 간격 5분으로 축소 (최대 5분 지연) |
| 신규 | D-day 스팸테스트 없음 | runPreSendSpamTest() 신설 — CT-09 재활용, 결과를 담당자에게 SMS 발송 |

#### 수정 파일 (2개)
| 파일 | 변경 |
|------|------|
| auto-campaign-worker.ts | P7(AI알림) + P9(D-1개선) + P10(5분) + runPreSendSpamTest 신설 + buildUnsubscribeFilter import |
| AutoSendFormModal.tsx | P8: spamSampleCustomer state + recommend-target에서 sample_customer_raw 저장 + SpamFilterTestModal에 firstRecipient 전달 |

#### SCHEMA 변경
- auto_campaign_runs.status에 `spam_tested` 값 추가 (varchar — DB 마이그레이션 불필요)

#### 컨트롤타워 원칙 준수
- CT-01 buildFilterQueryCompat — 타겟 수 조회 (P9), 샘플 고객 조회 (스팸테스트)
- CT-03 buildUnsubscribeFilter — 수신거부 제외 (P9)
- CT-04 bulkInsertSmsQueue — 알림 SMS 발송 (전 단계)
- CT-09 autoSpamTestWithRegenerate — D-day 스팸테스트
- 인라인 로직 0개, 전부 기존 컨트롤타워 import

---

### 🔧 D102 — 0401 PPT 버그리포트 15건 + 맞춤한줄 회신번호 + 중복제거/수신거부 (2026-04-01) — ✅ 배포완료

> **배경:** 직원 PPT(한줄로_20260401.pptx) 15건 + 맞춤한줄 개별회신번호 대표번호 폴백 + 중복제거/수신거부 체크박스 미동작.

#### 신규 컨트롤타워 4개 (핵심 성과)
| 컨트롤타워 | 파일 | 효과 |
|-----------|------|------|
| `buildAdMessage()` | messageUtils.ts | 백엔드 (광고)+080 전 발송 경로 통일. 기존 4곳 인라인 제거 |
| `getOpt080Number()` | messageUtils.ts | 080번호 조회 users→companies 폴백 통일. 기존 7곳 인라인 제거 |
| `prepareFieldMappings()` | messageUtils.ts | schema+extractVarCatalog+enrich 3종세트 통일. 기존 7곳 인라인 제거 |
| `buildAdMessageFront()` | formatDate.ts | 프론트 (광고)+080 미리보기/바이트계산 통일. 기존 21곳 인라인 제거 |

#### 구조 변경
- **customMessages 프론트→백엔드 분기 완전 제거** — 모든 발송 경로에서 백엔드 replaceVariables 컨트롤타워 하나로 통일. 프론트 치환 경로 폐기.
- **숫자 포맷팅** — Math.round() + toLocaleString('ko-KR') 명시. 소수점 2자리(.00) 원천 차단.
- **중복제거/수신거부제거** — 프론트 체크박스를 state 연결 + 백엔드 플래그 전달. 기본 true, 해제 가능.

#### 슬라이드별 수정
| # | 내용 | 근본 원인 | 수정 |
|---|------|---------|------|
| 1,6,8 | 날짜/숫자 포맷팅 실발송 깨짐 | 프론트 customMessages가 replaceVariables 우회 | customMessages 폐기, 백엔드 통일 |
| 2 | 062 지역번호 NULL | isValidKoreanLandline 범위 0[3-5] 한정 | 범위 제한 제거 |
| 3 | AI 개인화 고객명만 매칭 | displayName 정확 매칭만 | fuzzy 매칭(includes) 추가 |
| 4 | AI(취소) 중복 2건 | 미발송 cancelled 목록 표시 | sent_count=0 취소 캠페인 제외 |
| 5 | 나이 51→52 불일치 | 생일 지남 여부 미반영 | derivedBirthMonthDay > todayMD 비교 |
| 7,12 | (광고)+080 누락 | auto-campaign-worker 로직 없음 + AI발송/직접발송 미적용 | buildAdMessage 컨트롤타워 전 경로 |
| 9 | 회신번호 드롭다운에 phone | 필터에 phone 포함 | phone 제외 |
| 13 | 자동발송 11시→11:49 | 워커 1시간 간격 | 10분 축소 |
| 15 | 메시지 확인 불가 | API에 message_content 누락 | SELECT 추가 + 클릭 모달 |
| 추가 | 맞춤한줄 회신번호 폴백 | handleAiCustomSend에 individualCallbackColumn 파라미터 누락 | 타입 추가 + 폴백 'store_phone' |
| 추가 | 중복제거/수신거부 체크박스 | UI만 있고 state 미연결 | state 연결 + API 전달 + 백엔드 플래그 |

---

### 🔧 D101 — 0331 PPT 버그리포트 15건 디버깅 (2026-03-31) — ✅ 배포완료

> **배경:** 직원 PPT 0331 버그리포트 15건. 커스텀 필드 타입 동적화, AI 개인화 커스텀필드 지원, 회신번호 자동설정, 수신자 선택삭제 등.

#### 핵심 변경
- **enrichWithCustomFields** — field_type 기반 동적 type 설정 (기존 'string' 하드코딩 → NUMBER/DATE/VARCHAR 분기)
- **formatDateValue** — YYMMDD 6자리, YYYYMMDD 8자리 날짜 포맷팅 추가
- **formatByType** (프론트 신규) — data_type 기반 날짜/숫자/문자열 포맷팅 분기 (formatPreviewValue 대체)
- **parsePersonalizationDirective** — "개인화 :" 패턴도 감지 (기존 "개인화 필수:" 한정 → 완화)
- **parseBriefing + generateMessages** — 커스텀 필드 라벨을 availableVars에 동적 추가

#### 수정 파일 (12개)
- `messageUtils.ts` — enrichWithCustomFields field_type 동적 + formatDateValue YYMMDD + else 분기 소수점 감지
- `formatDate.ts` (프론트) — formatDatePreview/formatNumberPreview/formatByType 신규 + replaceMessageVars 타입 기반 분기
- `ai.ts` (services) — parsePersonalizationDirective regex 완화 + parseBriefing 커스텀필드 availableVars 추가
- `ai.ts` (routes) — generateMessages용 availableVars 커스텀필드 추가 + sampleCustomer 커스텀필드 타입 포맷팅
- `TargetSendModal.tsx` — 체크박스+선택삭제+중복제거 구현 + 회신번호 드롭다운 비전화번호 필드 제거 + formatByType 교체
- `AiCampaignSendModal.tsx` — individualCallbackColumn 'store_phone' 기본 전달 + 타입 확장
- `Dashboard.tsx` — AI 개별회신번호 추천 시 individualCallbackColumn 자동설정
- `auto-campaign-worker.ts` — 스팸테스트 firstRecipient(타겟 첫 고객) 전달
- `campaigns.ts` — 직접발송 campaign_runs INSERT 추가
- `upload.ts` — 커스텀 필드 field_type 자동감지 (날짜→DATE, 숫자→NUMBER)
- `ResultsModal.tsx` — overscrollBehavior: contain
- `AutoSendFormModal.tsx` — D-1 알림 "ON (알림번호 미입력)" 표시

#### 교훈
- **땜질식 수정 절대 금지** — 코드 한 줄 쓰기 전에 PPT 시나리오대로 전체 데이터 경로 추적 + 실서버 데이터 확인. D101에서 5번 이상 고쳐가며 땜질 반복한 원인: 실데이터 미확인 상태에서 추측 기반 코드 작성
- **enrichWithCustomFields VARCHAR 샘플링 부작용** — 시리얼/고객번호(정수)에 쉼표 찍히는 부작용. field_type에만 의존하는 것이 안전. 자동 감지는 upload.ts에서 1회만
- **formatPreviewValue 직접 호출 경로 전수 확인** — replaceMessageVars뿐 아니라 TargetSendModal, AiPreviewModal 등 인라인 호출부도 확인 필수
- **AiCampaignSendModal individualCallbackColumn 미전달** — 한줄로/맞춤한줄 양쪽에서 개별회신번호 선택해도 컬럼 미전달 → 발송 시 대표번호 폴백

#### 서버 확인 필요
- **버그2:** 엑셀 업로드 시 매장전화번호 미매핑 (데이터 문제 — SH 일부 레코드 store_phone 빈값)
- **버그14-15:** campaigns 182건/campaign_runs 146건 데이터 존재 — 배포 후 슈퍼관리자 화면 재확인

---

### 🔧 D100 — PPT 버그리포트 전면 디버깅 + 전단AI 이미지 + 세션 동시접속 (2026-03-31) — ✅ 배포완료

> **배경:** 0327+0330 직원 PPT 버그리포트 전면 수정. 날짜 밀림 근본 해결, 사용금액 격리, 중복예약 방지, 전단AI 이미지 서빙, 세션 동시접속 허용.

#### 신규 컨트롤타워
- **formatDateValue** (messageUtils.ts) — 날짜 표시용 포맷팅 컨트롤타워 (순수 YYYY-MM-DD 직접 파싱, ISO→KST 변환). 백엔드 전 경로 통합.

#### 수정 파일 (12개)
- `messageUtils.ts` — formatDateValue 컨트롤타워 신설 (export). replaceVariables에서 사용. Date 객체 방어 처리
- `ai.ts` — sampleCustomer 날짜 포맷팅 → formatDateValue import로 통합 (인라인 new Date() 제거)
- `upload.ts` — parse API preview+allData에서 Date 객체 → normalizeDate() 컨트롤타워 (JSON.stringify UTC 밀림 방지)
- `customers.ts` — (1) 테스트/스팸 비용 balance_transactions 기반 전환 (created_by 격리) (2) enabled-fields VARCHAR일 때도 데이터 샘플링
- `campaigns.ts` — (1) testBillId=userId 저장 (2) cancelled/draft 캘린더 기본 제외 (3) campaign_runs 중복 INSERT 차단 (4) useIndividualCallback 컬럼 존재 조건
- `callback-filter.ts` — callbackColumn 지정 시에도 값 비면 store_phone 폴백
- `Dashboard.tsx` — (1) sampleCustomerRaw 타겟추출 시 업데이트 (2) MMS 템플릿 JSON.parse 추가 (3) 모달 이중호출 방지
- `ResultsModal.tsx` — 발송내역 min-h-[70vh] 제거
- `auth.ts` — 동시 세션 최대 5개 허용 (전단AI+메인 동시 사용 지원)
- `flyer/flyers.ts` — (1) company_admin 권한 추가 (403 수정) (2) product-images jpg 서빙 지원
- `flyer/short-urls.ts` — 인라인 formatDate 순수 YYYY-MM-DD 직접 파싱
- `product-images.ts` (백엔드+프론트) — Unsplash→Pixabay 로컬 이미지 47개 매핑 + resolveProductImageUrl 활성화

#### 교훈
- **new Date("YYYY-MM-DD") UTC 자정 해석** — 순수 날짜 문자열을 new Date()로 파싱하면 UTC 자정 → KST 변환 시 하루 전. 직접 파싱 필수
- **JSON.stringify(Date) UTC ISO 변환** — 엑셀 Date 객체가 API 응답에 포함되면 "1995-02-28T15:00:00.000Z"로 전달 → 프론트에서 하루 밀림. API 반환 전 normalizeDate 필수
- **로그인 시 기존 세션 전부 무효화** — 전단AI+메인이 같은 JWT/세션 사용 → 한쪽 로그인 시 다른쪽 세션 사망. 동시 세션 허용으로 해결
- **company_admin vs admin 타입 체크 누락** — JWT userType='company_admin'인데 코드에서 'admin'만 체크 → 403
- **balance_transactions가 유일한 비용 SoT** — MySQL 테스트 테이블에는 userId 미저장이었으므로 balance_transactions(created_by 정확) 기반으로 전환
- **커스텀 필드 field_type='VARCHAR' 기본값** — 업로드 시 fieldType 미전달 → 'VARCHAR' 저장 → enabled-fields에서 숫자 감지 건너뜀 → 쉼표 미적용. VARCHAR일 때도 샘플링 필요

---

### 🔧 D99 — 브랜드메시지 수신자 확장 + 날짜 밀림 최종 수정 + 개별회신번호 컬럼 선택 (2026-03-28) — ✅ 배포완료

> **배경:** 브랜드메시지 수신자 입력 3탭(직접입력/파일등록/DB추출) + 미리보기 통합 + 날짜 밀림 근본 수정 + 개별회신번호 컬럼 선택 기능.

#### 신규 컨트롤타워
- **resolveRecipientCallback** (formatDate.ts) — 수신자별 개별회신번호 값 추출 (individualCallbackColumn 기반)

#### 수정 파일
- `KakaoRcsPage.tsx` — 브랜드메시지 수신자 3탭(직접입력/파일등록/DB추출), DirectTargetFilterModal 재활용
- `BrandMessageEditor.tsx` — 미리보기(BrandMessagePreview) 에디터 내부 통합 (우측 분리 제거)
- `BrandMessagePreview.tsx` — 미리보기 크기 확대 (w-[360px], min-h-[400px], 말풍선 max-w-[290px])
- `normalize.ts` — normalizeDate: Math.ceil(올림) UTC 기준 자정 보정 (D98 로컬TZ 방식 실패 → 근본 수정)
- `normalize.ts` — normalizeByFieldKey: Date 객체 String() 변환 방지 (커스텀 필드 날짜 밀림 수정)
- `callback-filter.ts` (CT-08) — callbackColumn 파라미터 추가 (지정 컬럼에서 회신번호 추출)
- `campaigns.ts` — individualCallbackColumn 파라미터 처리 (AI send + direct-send)
- `TargetSendModal.tsx` — 회신번호 드롭다운 컬럼 선택 UI (optgroup: 수신자별 컬럼 + 등록 회신번호)
- `Dashboard.tsx` — individualCallbackColumn state + resolveRecipientCallback CT 호출 + API 전달
- `formatDate.ts` — resolveRecipientCallback CT 추가

#### DB 마이그레이션
- `ALTER TABLE campaigns ADD COLUMN individual_callback_column VARCHAR(50)` (완료)

#### 교훈
- **xlsx cellDates 부동소수점 오차** — 엑셀 시리얼→Date 변환 시 자정에서 ~9시간 부족한 값 생성 → Math.ceil(올림)으로 다음 자정 복원
- **normalizeByFieldKey가 Date를 String()으로 변환** — 커스텀 필드 경로에서 Date 객체가 영문 문자열로 변환 → normalizeDate의 문자열 파싱 경로를 타서 밀림 → Date 객체 보존 필수
- **recipientsWithMessage 구성 시 원본 필드 탈락** — phone/callback/message만 추출하면 store_phone 등 다른 컬럼이 사라짐 → resolveRecipientCallback을 원본 데이터에서 호출해야 함
- **프론트에서 callback 매핑 후 백엔드 CT-08에 callbackColumn 전달하면 덮어씌워짐** — direct-send는 프론트 매핑 완료이므로 callbackColumn 미전달

---

### 🔧 D98 — PPT 버그리포트 11건 전면 수정 + 재검증 (2026-03-27) — ✅ 배포완료

> **배경:** 테스터 직원 PPT 11건 전면 수정. 컨트롤타워 원칙 + 데이터 흐름 끝까지 추적 검증.

#### 신규 컨트롤타워
- **CT-14 deduplicate.ts** — 수신자 중복제거 단일 진입점 (phone 기준 normalizePhone)
- **mmsServerPathToUrl** (formatDate.ts) — MMS 이미지 serverPath→API URL 변환 (Dashboard+ResultsModal 2곳)
- **SMS_DETAIL_FIELDS / SMS_EXPORT_FIELDS** (results.ts) — SMS 필드 정의 상수 (3곳 인라인→상수 2개)

#### 수정 파일 (이번 세션 추가분 — D97 커밋 이후)
- `results.ts` — S8 mms_image_paths SELECT + S9 draft 실패카운트 + S10 smsFields CT화
- `CustomerDBModal.tsx` — S4 data_type/field_type 양쪽 체크
- `ResultsModal.tsx` — S9 draft "실패" 표시 + MMS URL CT 교체
- `Dashboard.tsx` — MMS URL CT 교체
- `formatDate.ts` — mmsServerPathToUrl CT 추가
- `OPS.md` — MySQL TZ 문서화 (sendreq_time=KST, mobsend_time/repmsg_recvtm=UTC)

#### D97 커밋에 포함된 수정 (이전 세션)
- S1 사용금액 격리: prepaid.ts created_by + 전 호출부 9곳 + companies.ts 대시보드 필터
- S2 업로드 미리보기: FileUploadMappingModal formatPreviewValue 적용
- S3 날짜 밀림: normalize.ts 로컬TZ 기준 getFullYear/getMonth/getDate
- S5 MMS 이미지: Dashboard.tsx serverPath→API URL 변환
- S6 중복제거: deduplicate.ts CT-14 + campaigns.ts direct-send 적용
- S10 엑셀 시간: formatCsvDateTime 함수 추가
- S11 알림톡 UI: AlimtalkTemplateFormModal 4건
- B97-01 스팸필터: SpamFilterTestModal+DirectPreviewModal 인라인→replaceDirectVars CT
- B97-02 담당자: CT-11 test-contact-helper.ts + test_contacts 테이블 완전 이관

#### 교훈
- **검증은 데이터 흐름 끝까지 추적** — 코드 존재가 아니라 입력→처리→저장→조회→표시 전체 경로를 실제 값으로 따라감
- **API 반환 키(data_type)와 프론트 접근 키(field_type)가 일치하는지 확인** — S4에서 키 불일치 발견
- **직원 요청 원문과 구현 결과의 의미가 동일한지 대조** — S9 "실패로 카운트" ≠ "목록에서 제외"
- **MySQL TZ ≠ QTmsg Agent TZ** — MySQL 서버는 KST이지만 통신사 리포트 시간은 UTC로 저장됨

---

### 🔧 D97 — 브랜드메시지 전체 구현 + 디버깅 이슈 발견 (2026-03-27) — ✅ 배포완료

> **배경:** 브랜드메시지 8종 자유형 + 기본형(템플릿) 전체 구현. CT-12 컨트롤타워 신설.

#### 브랜드메시지 전체 구현

**CT-12 brand-message.ts (신규 컨트롤타워):**
- `validateBrandMessage()` — 유형별 필수값/길이/버튼개수 검증
- `buildAttachmentJson()` — ATTACHMENT_JSON 구성 (버튼/이미지/쿠폰/리스트/커머스/동영상)
- `buildCarouselJson()` — CAROUSEL_JSON 구성 (head/items/tail)
- `sendBrandMessage()` — 자유형 발송 (validation → 수신거부 → 선불차감 → MySQL INSERT)
- `sendBrandMessageTemplate()` — 기본형 발송 (템플릿 코드 + 변수 JSON)
- 상수: BUBBLE_TYPES, BUTTON_TYPES, TARGETING_OPTIONS, RESEND_TYPES

**sms-queue.ts (CT-04 확장):**
- `insertKakaoBasicQueue()` 신규 — IMC_BM_BASIC_BIZ_MSG INSERT (TEMPLATE_CODE + 7개 VARIABLE_JSON)

**campaigns.ts:**
- `POST /brand-send` 엔드포인트 신규 — HTTP 핸들링만, 핵심 로직은 CT-12 호출

**프론트엔드:**
- `BrandMessageEditor.tsx` (신규) — 8종 유형 카드 선택 + 유형별 입력 폼 + 버튼/쿠폰/캐러셀 에디터
- `BrandMessagePreview.tsx` (신규) — 카카오 말풍선 스타일 미리보기
- `KakaoRcsPage.tsx` — 브랜드MSG 탭 플레이스홀더 → 실제 구현 교체

**브랜드메시지 엔터프라이즈 게이팅:**
- KakaoRcsPage 브랜드MSG 탭에 plan_code 기반 잠금 (ENTERPRISE 이상만 접근)
- 잠금 모달: "엔터프라이즈 요금제부터 이용 가능" 안내

#### 디버깅 이슈 발견 (다음 세션 처리 예정)

1. **스팸필터 미리보기 %회신번호% 숫자 포맷팅:** `1800-8125` → 하이픈 제거 → `18008125` → toLocaleString → `18,008,125`. 전화번호 형태 값은 숫자 포맷팅 제외 필요
2. **담당자 설정 회사 전체 공유:** 사용자별 담당자 격리 미완성. settings 저장/조회 시 users vs companies 테이블 흐름 추적 필요 → 컨트롤타워 필요
3. **직접발송 파일업로드 전화번호 하이픈 제거:** 엑셀에 `010-5295-8517`로 있는데 하이픈 없이 저장/표시됨 + 하이픈 없는 번호도 포맷팅해서 표시 필요
4. **생일 날짜 밀림:** 엑셀 Date 부동소수점 오차 관련 추가 확인 필요

#### 수정 파일 (6개)

**프론트엔드 (3개):**
- `packages/frontend/src/components/BrandMessageEditor.tsx` (신규)
- `packages/frontend/src/components/BrandMessagePreview.tsx` (신규)
- `packages/frontend/src/pages/KakaoRcsPage.tsx`

**백엔드 (3개):**
- `packages/backend/src/utils/brand-message.ts` (신규 — CT-12)
- `packages/backend/src/utils/sms-queue.ts`
- `packages/backend/src/routes/campaigns.ts`

---

### 🔧 D96 — 자동발송 테스터 피드백 5건 + 직접발송 분리 + 슈퍼관리자 (2026-03-26) — ✅ 배포완료

> **배경:** 자동발송 테스터 PPT 5건 처리 + Dashboard.tsx 직접발송 컴포넌트 분리 + 직접발송 변수맵 컨트롤타워 통합

#### 자동발송 테스터 피드백 (슬라이드 5건)

**슬1 개별회신번호:** 답변용 — 스팸테스트는 단일 발신번호만 가능(테스트폰 1대), 실제 발송은 개별회신번호 지원됨
**슬2 스팸테스트:** 답변용 — AI 3 variant 생성 → 각각 스팸테스트 → best 1건 선택. 정상 동작
**슬3 3번씩 발송:** 답변용 — D-2 자동 스팸테스트 3 variant. 정상 동작
**슬4 AI 생성 문안 확인/수정 불가:**
- `auto-campaigns.ts` — PUT /:id/generated-message 엔드포인트 추가
- `AutoSendPage.tsx` — AI 생성 문안 확인/수정 모달 + 캠페인 카드 AI상태 배지 + 실행이력 문안 표시
**슬5 모달 드래그 시 초기화:**
- `AutoSendFormModal.tsx` — overscrollBehavior: contain + onMouseDown stopPropagation

#### 직접발송 Dashboard 분리 (D96 핵심)

**컴포넌트 분리:**
- `DirectSendPanel.tsx` — **신규** (1,072줄). 직접발송 모달 전체를 Dashboard에서 분리
- `Dashboard.tsx` — 4,400줄 → 3,367줄 (-1,033줄). DirectSendPanel props 전달로 교체
- 직접발송 전용 내부 state 12개를 DirectSendPanel로 이동 (파일매핑, 직접입력, 검색, 선택 등)
- 발송 실행 로직(executeDirectSend)은 Dashboard에 그대로 유지 — 기간계 무접촉

**변수맵 컨트롤타워 통합:**
- `formatDate.ts` — DIRECT_VAR_MAP, DIRECT_VAR_TO_FIELD, DIRECT_FIELD_LABELS, DIRECT_MAPPING_FIELDS, replaceDirectVars 추가
- `Dashboard.tsx` — 하드코딩 변수맵 5곳 → 컨트롤타워 import로 교체 (자동입력 버튼, 스팸필터, 직접입력, 파일매핑, 바이트 계산)

#### 기타

**슈퍼관리자 반려 모달:**
- `AdminDashboard.tsx` — prompt('반려 사유') → 커스텀 모달 (rejectModal + handleTemplateRejectConfirm)

**담당자 폴백 제거:**
- `companies.ts` — settings GET에서 companies.manager_contacts 폴백 제거 → 사용자별 완전 격리

#### 수정 파일 (9개)

**프론트엔드 (7개):**
- `packages/frontend/src/components/DirectSendPanel.tsx` (신규)
- `packages/frontend/src/components/AutoSendFormModal.tsx`
- `packages/frontend/src/pages/AutoSendPage.tsx`
- `packages/frontend/src/pages/AdminDashboard.tsx`
- `packages/frontend/src/pages/Dashboard.tsx`
- `packages/frontend/src/utils/formatDate.ts`

**백엔드 (2개):**
- `packages/backend/src/routes/auto-campaigns.ts`
- `packages/backend/src/routes/companies.ts`

#### 미완료 (다음 세션)

**Dashboard 2차 리팩토링:**
- useSendExecution() 훅: executeDirectSend/executeTargetSend + 관련 state 캡슐화
- 공용 모달 분리 (SendOptionModals.tsx)
- AI 발송 흐름 분리
- 같은 패턴으로 AI발송, 타겟발송도 순차 분리 → Dashboard를 레이아웃+라우팅 역할만으로 경량화

**직접발송 추가 개선:**
- RCS 템플릿 폼 보강 (버튼, 브랜드정보)
- 직접발송 UI를 커스텀 훅 패턴으로 전환 (props 최소화)

---

### 🔧 D95 — QA 버그리포트 11건 + 컨트롤타워 정비 + 헤더 UI (2026-03-26) — ✅ 배포 완료

> **배경:** 0326 테스터 PPT 11건 버그 수정 + 프론트 바이트계산/변수치환 컨트롤타워 추출 + 헤더 메뉴 필(pill) 스타일 통일

#### 세션1 완료 (이전 세션)

**AI 발송 카카오 제거:** AiCampaignResultPopup, AiCampaignSendModal, AiPreviewModal, Dashboard
**하이라이트 효과:** highlightVars.tsx %변수% regex 수정
**직접발송 파일매핑:** 2열 콤팩트 + 동적 표시 + 알림톡 템플릿 변수 + 샘플 표시
**슈퍼관리자:** 통계 자동로드, 프로필 등록 커스텀 모달
**스팸필터:** Grace Period 10초→20초

#### 세션2 완료 (이번 세션) — 0326 QA 버그리포트 11건

**슬4 파일매핑 선택창 겹침/짤림:**
- `Dashboard.tsx` — grid 셀/select에 min-w-0, 모달 max-h-[80vh] overflow-y-auto

**슬5 머지 바이트 계산 오류:**
- `Dashboard.tsx` — messageBytes를 getMaxByteMessage(변수 치환 후) 기반 계산으로 변경. 비용절감도 동일

**슬6 맞춤한줄 미리보기 %개인화% 미치환:**
- `AiCustomSendFlow.tsx` — 미리보기 모달에서 sampleData 있으면 replaceSampleVars 적용

**슬7 미리보기 전화번호/날짜 이상:**
- `formatDate.ts` — formatPreviewValue: 0시작 숫자(전화번호) 보호 + ISO 타임스탬프 KST 변환

**슬8 회신번호 미등록 시 예약 중복:**
- `Dashboard.tsx` — CallbackConfirmModal 취소 시 draft 캠페인 cancel
- `client.ts` — campaignsApi.cancel 추가
- `campaign-lifecycle.ts` — cancelCampaign에 draft 상태 허용

**슬9 발송결과 메시지 스크롤 전체확인 불가:**
- `ResultsModal.tsx` — msg_contents 클릭 시 상세 모달 onClick 추가

**슬10 자동발송 모달 배경클릭 초기화:**
- `AutoSendFormModal.tsx` — 배경 onClick={onClose} 제거

**슬11 알림톡 템플릿 등록 UI 보강:**
- `AlimtalkTemplateFormModal.tsx` — 채널추가(AC) 자동 삽입, PC URL(linkP), 앱링크(scheme), 강조보조문구(emphasizeSubTitle)
- `companies.ts` — POST/PUT에 emphasize_sub_title 저장

**슬3 엑셀 날짜형식 업로드:**
- `normalize.ts` — normalizeCustomFieldValue 컨트롤타워 추가 (Date 객체 + JS Date.toString() + ISO 처리)
- `upload.ts`, `sync.ts` — 커스텀 필드 normalizeCustomFieldValue 사용

**슬7 백엔드 날짜 불일치:**
- `messageUtils.ts` — 순수 YYYY-MM-DD 감지 regex 수정 (`($|T|\s)`)

**컨트롤타워 정비 (D95 신규):**
- `formatDate.ts` — `calculateSmsBytes`, `truncateToSmsBytes`, `replaceMessageVars` 3개 컨트롤타워 추가
- `Dashboard.tsx` — 인라인 바이트 계산 5곳 제거 → calculateSmsBytes 사용
- `AiCustomSendFlow.tsx` — 인라인 replaceVars 2곳 → replaceMessageVars 사용
- `ResultsModal.tsx`, `AutoSendFormModal.tsx`, `ScheduledCampaignModal.tsx` — 인라인 바이트 계산 → calculateSmsBytes
- `Dashboard.tsx` — replaceVars 하드코딩 변수 9개 → 동적 Object.entries 순회
- `Dashboard.tsx` — directVarMap 3곳 통일 (%매장명%, %포인트% 추가)

**헤더 메뉴 UI 개선:**
- `DashboardHeader.tsx` — 밑줄 제거 → 필(pill) 스타일. useLocation 현재 페이지 활성 표시. tracking-wide 글자 간격. gap-1 메뉴 간격

**DB 마이그레이션 (서버 반영 완료):**
- `ALTER TABLE kakao_templates ADD COLUMN IF NOT EXISTS emphasize_sub_title VARCHAR(50);`
- `UPDATE customer_field_definitions SET field_type = 'INT' WHERE field_key = 'custom_1' AND company_id = (시세이도ID);`

#### 수정 파일 (15개)

**프론트엔드 (9개):**
- `packages/frontend/src/utils/formatDate.ts`
- `packages/frontend/src/pages/Dashboard.tsx`
- `packages/frontend/src/components/AiCustomSendFlow.tsx`
- `packages/frontend/src/components/ResultsModal.tsx`
- `packages/frontend/src/components/AutoSendFormModal.tsx`
- `packages/frontend/src/components/ScheduledCampaignModal.tsx`
- `packages/frontend/src/components/AlimtalkTemplateFormModal.tsx`
- `packages/frontend/src/components/DashboardHeader.tsx`
- `packages/frontend/src/api/client.ts`

**백엔드 (6개):**
- `packages/backend/src/utils/normalize.ts`
- `packages/backend/src/utils/messageUtils.ts`
- `packages/backend/src/utils/campaign-lifecycle.ts`
- `packages/backend/src/routes/companies.ts`
- `packages/backend/src/routes/upload.ts`
- `packages/backend/src/routes/sync.ts`

#### 미완료 (다음 세션)

**직접발송 전체 UI 재설계:**
- 직접입력: 메시지 변수 기반 동적 입력폼 (변수에 맞는 칸만 표시)
- 파일매핑: 알림톡은 템플릿 #{변수} 기준 매핑 (이름/기타1/2/3 대신)
- RCS 템플릿 폼 보강 (버튼, 브랜드정보)
- sms-result-map.ts 카카오 결과코드 보강

**슈퍼관리자:**
- 템플릿 수동등록 모달: prompt() → 커스텀 모달 + 고객사/사용자 드롭다운

**슬1 담당자 일괄변경:** ✅ settings GET에서 companies.manager_contacts 폴백 제거 → 각 사용자가 자기 담당자만 봄 (미설정 시 빈 배열)
**슬10 자동발송 질문사항:** AI 문안 확인/수정 기능, 개별회신번호 지원 등 기능 미비 — Phase 3 검토

---

### 🔧 D94 — 채널 확장 Phase 1: 카카오&RCS 메뉴 + 알림톡 발송 (2026-03-25) — ✅ 배포 완료

> **배경:** 발송창 탭 재구성(브랜드MSG→RCS) + 카카오&RCS 신규 메뉴(알림톡 템플릿/RCS 템플릿 관리) + 알림톡 실제 발송 연결 + 슈퍼관리자 템플릿 관리
> **설계:** `status/CHANNEL-EXPANSION.md` / `status/BRAND-MESSAGE-DESIGN.md`

#### 구현 내용

**DB 마이그레이션 (서버 반영 완료):**
- kakao_templates 12개 컬럼 확장 (category, message_type, emphasize_type, buttons JSON 등)
- rcs_templates 3개 컬럼 추가 (requested_at, reviewed_at, reviewed_by)

**백엔드 API:**
- 알림톡/RCS 템플릿 CRUD — `companies.ts` (GET/POST/PUT/DELETE 8개 엔드포인트)
- 슈퍼관리자 템플릿 승인/반려/수동등록 — `admin.ts` (7개 엔드포인트)
- 알림톡 발송 컨트롤타워 — `sms-queue.ts`의 `insertAlimtalkQueue()` (SMSQ_SEND msg_type='K')
- 직접발송 알림톡 분기 — `campaigns.ts` direct-send에 sendChannel='alimtalk' 처리

**프론트엔드:**
- 카카오&RCS 페이지 신규 — `KakaoRcsPage.tsx` (3탭: 알림톡 템플릿/브랜드메시지/RCS 템플릿)
- 알림톡 템플릿 등록 모달 — `AlimtalkTemplateFormModal.tsx` (카테고리, 유형, 강조, 버튼, 변수감지)
- RCS 템플릿 등록 모달 — `RcsTemplateFormModal.tsx`
- 메뉴 "카카오&RCS" 추가 (녹색) — `DashboardHeader.tsx`
- 라우트 `/kakao-rcs` 추가 — `App.tsx`
- 발송창 탭 변경: 문자/RCS/알림톡 (브랜드MSG 제거) — `Dashboard.tsx`, `TargetSendModal.tsx`
- 알림톡 탭 실제 발송 연결 (준비중 → 발송 버튼)
- AI 한줄로 유형선택에서 카카오 제거
- 슈퍼관리자 템플릿 관리 탭 + 2줄 메뉴 — `AdminDashboard.tsx`

#### 추가 수정 (전수점검 + UI 개선)
- `companies.ts` — 담당자 `manager_contacts` companies 덮어쓰기 방지 (슬라이드1 버그)
- `Dashboard.tsx` — 스팸테스트 `%회신번호%` selectedCallback 폴백 (슬라이드6 버그)
- `Dashboard.tsx` — RCS 탭 텍스트입력 → 템플릿 선택 기반으로 교체
- `Dashboard.tsx` — 알림톡/RCS 승인 템플릿 자동 로드 추가
- `ResultsModal.tsx` — 메시지 상세보기 모달 overscrollBehavior: contain (슬라이드11)
- `AdminDashboard.tsx` — 14개 탭 → 드롭다운 그룹 메뉴 (고객관리/발송관리/요금정산/시스템)

#### 수정 파일 (14개)
- `packages/backend/src/utils/sms-queue.ts` — CT-04 `insertAlimtalkQueue()` 추가
- `packages/backend/src/routes/companies.ts` — 알림톡/RCS 템플릿 CRUD 8개 엔드포인트
- `packages/backend/src/routes/admin.ts` — 슈퍼관리자 템플릿 관리 7개 엔드포인트
- `packages/backend/src/routes/campaigns.ts` — 직접발송 알림톡 분기 + import
- `packages/frontend/src/pages/KakaoRcsPage.tsx` — 신규
- `packages/frontend/src/components/AlimtalkTemplateFormModal.tsx` — 신규
- `packages/frontend/src/components/RcsTemplateFormModal.tsx` — 신규
- `packages/frontend/src/components/DashboardHeader.tsx` — 카카오&RCS 메뉴 추가
- `packages/frontend/src/App.tsx` — `/kakao-rcs` 라우트
- `packages/frontend/src/pages/Dashboard.tsx` — 발송창 탭 변경 + 알림톡 발송 연결 + 카카오 옵션 제거
- `packages/frontend/src/components/TargetSendModal.tsx` — 탭 변경 + 알림톡 발송 연결
- `packages/frontend/src/components/AiCampaignSendModal.tsx` — 타입 변경 (kakao_brand→rcs)
- `packages/frontend/src/pages/AdminDashboard.tsx` — 템플릿 관리 탭 + 2줄 메뉴
- `status/CHANNEL-EXPANSION.md` — 문서 업데이트

#### Phase 2 예정
- 휴머스온 알림톡 API 연동 (템플릿 등록 자동화 + 발송)
- 젬텍 RCS API 연동 (발송)
- 브랜드메시지 8종 메시지 유형 확장 (`status/BRAND-MESSAGE-DESIGN.md` 참조)
- QTmsg SMSQ_SEND 알림톡 발송 완전 연결 (`status/BRAND-MESSAGE-DESIGN.md` §10~11 참조)

---

### 🔧 D91 — QA 버그리포트 10건 전면 수정 (2026-03-23) — ✅ 수정 완료

> **배경:** 테스터 PPT 버그리포트 (한줄로_20260323.pptx) — 10개 슬라이드, 5개 그룹. 컨트롤타워 우선 수정 원칙 준수.
> **상세:** `status/D91-BUGFIX-REPORT.md` 참조

#### 수정 그룹 (5개)

**그룹1: 콜백번호 (A+B)**
- A: 미등록 회신번호 발송 시 "수신거부번호 미로딩" 에러 → 에러 메시지 명확화 (080 미설정 안내)
- B: 발신번호 배정(assigned) 미작동 → CT-08에 userId + assignment_scope 필터 추가

**그룹2: 담당자 격리 (C)**
- 담당자 등록 시 회사 전체 브랜드 공유 → users.manager_contacts 컬럼 추가 (DB 마이그레이션) + 사용자별 저장/조회

**그룹3: 소수점+스팸테스트 (E+H+I)**
- E+H: 맞춤한줄 자동 스팸테스트에서 타겟 아닌 고객 데이터 사용 → ai.ts에서 타겟 필터 적용 샘플을 firstRecipient로 전달
- I: 맞춤한줄/직접타겟발송 미리보기 소수점 잔존 → 프론트 replaceVars 숫자 포맷팅 추가

**그룹4: LMS (F+G)**
- F: LMS 제목 미입력 발송 가능 → campaigns.ts에 subject 필수 검증 추가
- G: 맞춤한줄 SMS 초과 시 LMS 전환 불가 → LMS 전환 확인 모달 추가

**그룹5: 필터/표시 (D+J)**
- D: 평균주문금액 드롭다운만 제공 → sampleValues 필터링 강화 (trim + null/빈값 정확 제거)
- J: 발송결과 LMS/MMS 제목 미표시 → results.ts SELECT + ResultsModal 제목 표시

#### 수정 파일 (12개)
- `packages/backend/src/utils/callback-filter.ts` — CT-08 userId + assignment_scope 필터
- `packages/backend/src/routes/campaigns.ts` — CT-08 userId 전달 + LMS subject 필수 + user 담당자 조회
- `packages/backend/src/routes/companies.ts` — GET/PUT settings 사용자별 manager_contacts
- `packages/backend/src/routes/ai.ts` — 스팸테스트 firstRecipient 전달 (2곳)
- `packages/backend/src/routes/customers.ts` — 자동 타입 감지 sampleValues 필터링 강화
- `packages/backend/src/routes/results.ts` — SELECT에 subject/message_subject 추가
- `packages/frontend/src/pages/Dashboard.tsx` — 080 미설정 에러 메시지 개선
- `packages/frontend/src/components/AiCustomSendFlow.tsx` — LMS 전환 모달 + 숫자 포맷팅
- `packages/frontend/src/components/TargetSendModal.tsx` — replaceVars 숫자 포맷팅
- `packages/frontend/src/components/ResultsModal.tsx` — LMS/MMS 제목 표시

#### DB 마이그레이션 (실행 완료)
- `users.manager_contacts` JSONB 컬럼 추가 + 기존 companies 데이터 admin에 복사

#### D91 교훈
- **컨트롤타워에 필터 추가 시 모든 발송 경로 확인:** callback-numbers 조회에만 배정 필터 적용하고 발송 시 CT-08에 미적용하면 배정이 무의미
- **스팸테스트·미리보기·발송의 고객 데이터는 반드시 타겟 필터 적용 동일 데이터:** 임의 고객으로 테스트하면 개인화 불일치
- **프론트 인라인 치환에도 백엔드와 동일한 숫자 포맷팅 필수:** 한쪽만 수정하면 나머지 경로에서 소수점 잔존

---

### 🔧 D90 — AI 한줄로/맞춤한줄 개별회신번호 옵션 누락 수정 (2026-03-20) — ✅ 수정 완료

> **배경:** AI 맞춤한줄 발송 모달에서 "📱 개별회신번호 (고객별 매장번호)" 옵션이 표시되지 않는 문제. 직접발송에서는 항상 표시되지만 AI 발송 모달에서만 `callbackNumbers.length >= 2` 조건이 걸려 있어 불일치 발생.

#### 원인
- `AiCampaignSendModal.tsx` 237줄에 `{callbackNumbers.length >= 2 && (...)}` 조건이 있어, callback_numbers가 1개(기본번호)인 경우 개별회신번호 옵션이 숨겨짐
- 직접발송(Dashboard.tsx), TargetSendModal.tsx 등 다른 모든 발송 경로에는 이 조건이 없어 항상 표시됨

#### 수정
- `AiCampaignSendModal.tsx`에서 `callbackNumbers.length >= 2` 조건 제거 → 직접발송과 동일하게 조건 없이 항상 표시

#### 수정 파일 (1개)
- `packages/frontend/src/components/AiCampaignSendModal.tsx` — 개별회신번호 옵션 조건부 렌더링 → 무조건 렌더링

#### D90 교훈
- **동일 UI 요소(개별회신번호 드롭다운)는 모든 발송 경로에서 동일한 조건으로 표시.** 한 경로에만 추가 조건을 걸면 UX 불일치 발생

---

### 🔧 D89 — 마이너 수정 5건 + D88 직접발송 잠금 회귀 수정 (2026-03-20) — ✅ 배포 완료

> **배경:** 테스터 PPT 마이너 수정 요청 5건 (한줄로(마이너한 수정 요청)_20260320.pptx) + D88에서 직접발송까지 과잉 잠금한 회귀 버그 수정.

#### 1. 고객DB 검색 정규화 (CT-01 customer-filter.ts)
- 전화번호 검색: 하이픈 자동 제거 (`REPLACE(col, '-', '')`)
- 주소/매장명 검색: 공백+언더스코어 자동 제거
- structured + mixed 양쪽 모드 적용

#### 2. 고객DB 숫자 포맷 (CustomerDBModal.tsx)
- 포인트/구매횟수/커스텀 NUMBER 필드에 toLocaleString() 적용

#### 3. 발송결과 전화번호 검색 (results.ts)
- SMS/카카오/폴백 3곳 하이픈 제거 정규화 적용

#### 4. 날짜 표시 하루 밀림 수정 (formatDate.ts)
- YYYY-MM-DD 순수 날짜를 UTC 변환 없이 직접 파싱하여 하루 밀림 방지

#### 5. 예약발송 바이트 계산 (ScheduledCampaignModal.tsx)
- UTF-8 TextEncoder → EUC-KR 기준 (한글 2바이트) 계산으로 변경

#### 6. D88 회귀 수정: 직접발송 잠금 해제 (DashboardHeader.tsx)
- D88에서 lockGuard()가 직접발송까지 잠금 → 무료체험 만료 시 직접발송 불가 회귀
- **수정:** 직접발송 메뉴에서 lockGuard + locked:isSubscriptionLocked 제거
- **정책:** 직접발송은 구독 상태 무관하게 항상 사용 가능. 스팸필터테스트만 잠금 유지

#### 수정 파일 (6개)
- `packages/backend/src/utils/customer-filter.ts` — normalizeContainsSearch 헬퍼 추가
- `packages/backend/src/routes/results.ts` — 하이픈 제거 검색 3곳
- `packages/frontend/src/components/CustomerDBModal.tsx` — 숫자 포맷팅
- `packages/frontend/src/utils/formatDate.ts` — 날짜 파싱 재작성
- `packages/frontend/src/components/ScheduledCampaignModal.tsx` — EUC-KR 바이트 계산
- `packages/frontend/src/components/DashboardHeader.tsx` — 직접발송 lockGuard 해제

#### D89 교훈
- **lockGuard 등 잠금 적용 시 "이 기능이 정말 잠겨야 하는가?" 기능별로 판단 필수.** 무료체험 만료여도 직접발송(기본 기능)은 사용 가능해야 함
- **검색 정규화는 컨트롤타워(CT-01)에서 일괄 처리.** 인라인 REPLACE 금지
- **SMS 바이트 계산은 EUC-KR 기준(한글 2바이트).** TextEncoder(UTF-8, 한글 3바이트)와 혼동 금지

---

### 🔧 D88 — QA 버그리포트 11건 전면 수정 (2026-03-20) — ✅ 배포 완료

> **배경:** 테스터 직원들의 PPT 버그리포트 (한줄로_20260320.pptx) — 11개 슬라이드, 7개 그룹(A~G). 컨트롤타워 패턴 + 동적 처리 원칙으로 전체 수정.

#### A. 구독/게이팅 (슬라이드 1)
- 무료체험 만료 후 자동발송/캘린더/스팸필터 사용 가능했던 문제
- **수정:** DashboardHeader.tsx `isSubscriptionLocked` prop + `lockGuard()` → AI 분석/자동발송/캘린더 잠금. Dashboard.tsx `isSpamFilterLocked` 등에 OR 조건 추가. auto-campaigns.ts `checkPlanGating`에 subscription_status + is_trial_expired 체크 추가
- **⚠️ D89 회귀 수정:** 직접발송까지 lockGuard 적용하여 과잉 잠금 → D89에서 직접발송 lockGuard 해제. 직접발송은 구독 상태 무관 항상 사용 가능

#### B. 고객DB 필터 (슬라이드 3-4)
- 수신동의여부: 텍스트 입력 → 동의/거부 드롭다운 필요
- 평균주문금액: 금액인데 상세조건(이상/이하/범위) 없음
- VIP행사참석: "참석" 검색 시 "미참석" 포함 전체 추출
- **수정:** CustomerDBModal.tsx boolean 필드 자동 드롭다운('동의'/'거부'). enabled-fields API D88 자동 타입 감지(샘플 20건→number/date/string). customer-filter.ts dropdown 필드 contains→eq 자동 전환

#### C. 개인화/소수점 (슬라이드 7-8-9)
- 맞춤한줄 미리보기에 타겟 아닌 고객 표시 + 스팸테스트 개인화 NULL + 금액 소수점 2자리
- **수정:** ai.ts parse-briefing에서 타겟 필터 적용 sampleCustomer 반환 → AiCustomSendFlow.tsx setSampleData. 스팸테스트 replaceVars에 field_key→field_label 매핑 추가. messageUtils.ts string→Number 파싱 후 toLocaleString(). AiCustomSendFlow.tsx replaceSampleVars도 동일 처리

#### D. 발신번호 배정 격리 (슬라이드 10) + 미등록 회신번호 확인 (슬라이드 2)
- 시세이도 나스만 배정한 번호가 다른 사용자에게도 공유
- **수정:** companies.ts callback-numbers: `company_admin`도 admin과 동일하게 전체 조회 (기존에는 company_user와 같은 필터 적용)
- 미등록 회신번호 확인 모달: 기존 CT-08 buildCallbackConfirmResponse 기반 4경로(direct/target/ai/aiCustom) 전부 적용 확인

#### E. 수신거부 자동 등록 (슬라이드 5)
- admin이 DB 업로드 시 수신거부 자동 반영 안 됨
- **수정:** upload.ts admin 경로에 ① admin 본인 user_id INSERT 추가 + ② 고객 store_code 기준 브랜드 사용자 배정 유지

#### F. 중간관리자 사용자별 DB 조회 (슬라이드 11)
- 시세이도 중간관리자가 사용자별 DB 조회 시 데이터 없음
- **수정:** customers.ts filterUserId를 `uploaded_by` → 해당 사용자의 `store_codes` 기준 `store_code = ANY(store_codes)` 필터로 변경

#### G. 스팸테스트 광고표기 (슬라이드 6)
- 스팸테스트 시 (광고)/무료수신거부 표기 없이 테스트됨
- **수정:** spam-test-queue.ts autoSpamTestWithRegenerate에서 isAd=true일 때 (광고) 접두사 + 무료수신거부 접미사 래핑 후 테스트

#### 수정 파일 (11개)
- `packages/backend/src/routes/customers.ts` — enabled-fields 자동 타입 감지 + filterUserId store_codes 기반
- `packages/backend/src/routes/companies.ts` — callback-numbers company_admin 전체 조회
- `packages/backend/src/routes/upload.ts` — admin 수신거부 자동 등록
- `packages/backend/src/routes/auto-campaigns.ts` — checkPlanGating 구독 체크
- `packages/backend/src/routes/ai.ts` — parse-briefing sampleCustomer 반환
- `packages/backend/src/utils/messageUtils.ts` — numeric string 포맷팅
- `packages/backend/src/utils/customer-filter.ts` — contains→eq 자동 전환
- `packages/backend/src/utils/spam-test-queue.ts` — 광고문구 래핑
- `packages/frontend/src/pages/Dashboard.tsx` — isSubscriptionLocked 전파
- `packages/frontend/src/components/DashboardHeader.tsx` — lockGuard + 잠금 prop
- `packages/frontend/src/components/AiCustomSendFlow.tsx` — sampleData/replaceVars/replaceSampleVars 수정
- `packages/frontend/src/components/CustomerDBModal.tsx` — boolean 드롭다운

#### D88 교훈
- **DB 값의 실제 타입을 맹신하지 않는다:** PostgreSQL numeric 필드가 JS에서 string으로 올 수 있음 → 항상 타입 체크 후 변환
- **미리보기 샘플은 타겟 필터를 적용한 고객이어야 한다:** enabled-fields의 범용 샘플 ≠ 타겟 매칭 샘플
- **dropdown 필드에 contains 연산자가 오면 eq로 전환:** "참석" contains → "미참석"도 매칭되는 패턴 방지
- **admin 업로드 시 수신거부는 admin 본인에게도 등록:** 단일 브랜드 회사에서 브랜드 사용자 없으면 수신거부 0건
- **구독 만료 게이팅은 프론트+백엔드 양쪽 필수:** 프론트만 차단하면 API 직접 호출로 우회 가능

---

### 🔧 D87 — 발신번호 사용자별 배정 기능 (2026-03-19~20) — ✅ 배포 완료

> **배경:** 발신번호를 "전체 사용" 또는 "특정 사용자에게만 배정" 선택적으로 관리하는 기능 요청 (Harold님 실무 피드백)

#### 수정 내용
- **DB 변경 (✅ 마이그레이션 완료):**
  - `callback_numbers.assignment_scope` 컬럼 추가 (VARCHAR(10), DEFAULT 'all')
  - `callback_number_assignments` 테이블 생성 (callback_number_id + user_id 매핑)
- **컨트롤타워 (CT-10 sender-registration.ts):**
  - 배정 관리 함수 7개 추가: updateAssignmentScope, assignUsersToCallback, unassignUserFromCallback, getAssignmentsByCallback, getAssignedCallbackIds, replaceAssignments
- **백엔드 API (manage-callbacks.ts):**
  - PUT /:id/scope — 전체/지정 전환
  - GET /:id/assignments — 배정된 사용자 조회
  - PUT /:id/assignments — 배정 사용자 전체 교체
  - DELETE /:id/assignments/:userId — 개별 배정 해제
  - GET / 목록에 assignment_scope 포함
- **발송 시 필터링 (companies.ts):**
  - callback-numbers 조회에 assignment_scope 기반 필터 적용
  - **admin 사용자:** assignment_scope 무관하게 전체 번호 조회 (관리 가시성 보장)
  - **일반 사용자:** scope='all' + 본인 배정된 'assigned' 번호만 조회
  - company-users API 추가 (배정 모달용)
  - 중복 callback-numbers 라우트 제거 (D87 버전으로 통합)
- **프론트엔드 (CallbacksTab.tsx):**
  - 등록 발신번호 테이블에 "사용 범위" 컬럼 + 전체/지정 토글
  - 사용자 배정 모달 (체크박스 선택 → 저장 + 이름/이메일 검색 기능)
  - **배정 0명 안전장치:** 저장/취소 시 배정 사용자 0명이면 자동으로 'all'(전체 사용)로 복귀
  - "발신번호 등록/삭제는 슈퍼관리자만 가능합니다" 안내 문구 제거
- **API 클라이언트 (api/client.ts):** manageCallbacksApi에 배정 메서드 4개 추가

#### 수정 파일 (5개)
- `packages/backend/src/utils/sender-registration.ts` — 배정 관리 컨트롤타워 함수
- `packages/backend/src/routes/manage-callbacks.ts` — 배정 API 4개
- `packages/backend/src/routes/companies.ts` — callback-numbers 필터링 (admin 전체조회 + 중복라우트 제거) + company-users API
- `packages/frontend/src/api/client.ts` — 배정 API 메서드
- `packages/frontend/src/components/manage/CallbacksTab.tsx` — 배정 UI + 0명 안전장치

#### D87 교훈
- **assigned 상태에서 배정 사용자 0명 → 아무도 해당 번호를 볼 수 없음** → AutoSendFormModal "등록된 발신번호가 없습니다" 사고 발생. admin은 항상 전체 조회 + 0명이면 자동 'all' 복귀 안전장치로 해결

---

### 🔧 D86 — 자동발송 완전화 + 맞춤한줄/개인화/스팸 수정 (2026-03-19) — ✅ 배포 완료

> **배경:** (1) 맞춤한줄 발송대상 추출 0명/전체 (2) 개인화 NULL (3) 맞춤한줄 스팸 자동화 미구현 (4) 날짜 UTC raw 표시 (5) 자동발송 Phase 2 미완성 (타겟필터/D-1알림/실행이력)

#### D84 — 맞춤한줄 발송대상 추출 0명/전체 (✅ 배포완료)
- **근본 원인:** parseBriefing 프롬프트 하드코딩 (직접 컬럼 9개만) → 커스텀 필드/registered_store 등 AI가 필터 생성 불가
- **수정:** `detectActiveFields()` + `buildFilterFieldsPrompt()` 공통 함수 추출 → recommendTarget과 parseBriefing 공용. 하드코딩 프롬프트 → 동적 프롬프트 전환
- **수정 파일:** services/ai.ts, routes/ai.ts, AiCustomSendFlow.tsx

#### D85 — 개인화 NULL + 맞춤한줄 스팸 자동화 + 날짜 KST (✅ 배포완료)
- **개인화 NULL 원인:** recommend-target이 `sample_customer`를 displayName 키("이름")로 반환 → test-send의 `replaceVariables`는 column 키("name")로 접근 → undefined
- **수정:** `sample_customer_raw` (column 키 DB row 원본) 추가 반환. Dashboard.tsx에서 test-send 호출 시 raw 데이터 전달
- **맞춤한줄 스팸 자동화:** generate-custom 라우트에 프로 이상 `autoSpamTestWithRegenerate` 추가 (한줄로와 동일 로직)
- **날짜 KST:** `replaceVariables`에 `timeZone: 'Asia/Seoul'` 고정 + ISO 문자열 자동 감지 포맷팅
- **수정 파일:** routes/ai.ts, pages/Dashboard.tsx, AiCustomSendFlow.tsx, utils/messageUtils.ts

#### D86 — 자동발송 완전화 3건 (✅ 배포완료)
- **D86-1 타겟 설정:** AutoSendFormModal 5→6단계. Step 3에 AI 기반 타겟 자동 생성 (`recommend-target` 컨트롤타워 재활용, `auto_relax: false`). 사용자가 자연어로 대상 설명 → AI가 target_filter 생성 → 예상 인원 표시. 매 실행 시 동적 조회. 빈 필터 {} 차단 (D83 사고 방지)
- **D86-2 D-1 사전 알림 UI:** Step 4(스케줄) 하단에 ON/OFF 토글 + 전화번호 입력. `pre_notify` + `notify_phones` handleSave에 전달. 백엔드 `sendPreNotification()` 기존 구현 활용
- **D86-3 실행 이력 조회:** AutoSendPage 캠페인 카드에 "이력" 버튼. GET /:id API → 모달에 회차별 결과 (대상/발송/성공/실패/상태/AI여부)
- **수정 파일:** AutoSendFormModal.tsx, AutoSendPage.tsx, DirectTargetFilterModal.tsx (원복)

#### D79 — ✅ 배포 완료 (Harold님 확인)
#### D83 — ✅ 배포 완료 (Harold님 확인)

#### 자동발송 Phase 2 완성 상태
- ✅ AI 문안 자동생성 (D80)
- ✅ 타겟 필터 설정 (D86-1) — recommend-target 재활용, 매 실행 시 동적 조회
- ✅ D-1 사전 알림 (D86-2)
- ✅ 실행 이력 상세 조회 (D86-3)
- ✅ 3건 중복 방지 + KST 이중변환 (D83)
- 🔜 Phase 3 (A/B 테스트, 발송 최적 시간 추천) — 향후 과제

---

### 🔧 D83 — 고객DB 필터 전면 수정 + 자동발송 3건 중복/시간오차/개인화 (2026-03-19) — ✅ 배포 완료

> **배경:** 직원 리포트 5건. (1) 고객DB 필터 검색 다수 컬럼 미작동 (2) 한줄로 정상 (3) 맞춤한줄 타겟추출 0명/전체 (4) 미리보기/담당자테스트 개인화 불일치 (5) 자동발송 3건 중복+시간오차+D-1 알림 미발송

#### 수정 항목 (8개 파일)

**1. structured 모드 FIELD_MAP 동적 루프 통일 (customer-filter.ts — CT-01)**
- **문제:** NUMERIC_FIELDS/DATE_FIELDS 하드코딩 리스트 + store_name 전용 핸들러 → contains 미지원, 새 필드 누락
- **수정:** 하드코딩 리스트 전부 삭제 → 한줄로(mixed 모드)와 동일한 FIELD_MAP 동적 루프로 통일. 특수 처리 필드(gender/grade/region/sms_opt_in/store_code/age)만 전용 핸들러 유지
- **추가:** age에 eq 연산자 추가 (일치 검색 시 전체 리스트 반환 버그), safeDateValue 방어 (한국식 날짜 입력 시 쿼리 에러 방지), 디버그 로그

**2. normalizeDate 한국식 날짜 패턴 (normalize.ts)**
- **문제:** "2025. 12. 17." 같은 한국식 형식 미지원 → 날짜 필터 시 PostgreSQL DateTimeParseError
- **수정:** 한국식 날짜 패턴 regex 추가 ("YYYY. M. D." → "YYYY-MM-DD")

**3. 날짜 필드 date picker (CustomerDBModal.tsx)**
- **문제:** 날짜 필드에 텍스트 자유 입력 → 비정상 형식 직접 입력 가능
- **수정:** `<input type="date">` 적용 (비정상 입력 원천 차단)

**4. 성별 dropdown (customers.ts + CustomerDBModal.tsx)**
- **문제:** filter-options API에 genders 미포함 → 성별이 텍스트 입력(contains) → 핸들러에서 무시 → 전체 리스트
- **수정:** filter-options에 genders 추가 + CustomerDBModal에서 성별 dropdown 활성화

**5. 맞춤한줄 담당자테스트 sampleCustomer (AiCustomSendFlow.tsx)**
- **문제:** test-send API 호출 시 sampleCustomer 미전달 → 미리보기와 다른 고객으로 개인화
- **수정:** sampleData를 sampleCustomer로 전달

**6. 자동발송 3건 중복 방지 (auto-campaign-worker.ts)**
- **문제:** `status='active'→'active'` UPDATE는 잠금 역할 못 함 → 워커 1시간 간격 재실행 시 동일 캠페인 반복 처리
- **수정:** `status='active'→'executing'` 원자적 잠금 + 완료 후 'active' 복원. executing 상태에서 다음 워커가 스킵

**7. 자동발송 KST 이중변환 (auto-campaigns.ts + auto-campaign-worker.ts)**
- **문제:** `toLocaleString('Asia/Seoul') + kstToUtc(-9h)` → KST 서버에서 이중 변환 → 9시간 오차 (10:00 KST 설정 → 01:00 KST 실행)
- **수정:** 서버 타임존 무관한 UTC+9 오프셋 기반 계산으로 교체 (`Date.UTC() - KST_OFFSET_MS`)

#### 미해결 (다음 세션)
- 자동발송 target_filter UI 미구현 (Phase 2 미완성) → 필터 `{}` → 전체 고객 발송
- 커스텀 필드(VIP행사참석 등) dropdown 연동 확인 (배포 후 디버그 로그로 확인)
- 자동발송 D-1 알림: pre_notify/notify_phones 설정 여부 확인 필요

#### 수정 파일 (8개)
- `packages/backend/src/utils/customer-filter.ts` — structured 하드코딩 삭제 + FIELD_MAP 통일 + age eq + safeDateValue + 디버그 로그
- `packages/backend/src/utils/normalize.ts` — 한국식 날짜 패턴
- `packages/backend/src/routes/customers.ts` — filter-options genders 추가
- `packages/frontend/src/components/CustomerDBModal.tsx` — date picker + gender dropdown
- `packages/frontend/src/components/AiCustomSendFlow.tsx` — sampleCustomer 전달
- `packages/backend/src/utils/auto-campaign-worker.ts` — executing 잠금 + calcNextRunAt KST 수정
- `packages/backend/src/routes/auto-campaigns.ts` — calcNextRunAt KST 수정

---

### 🔧 D82 — AI 타겟추출 정상화 + 전체필드 동적필터 통일 + 개인화 통일 + 자동발송 시간 KST (2026-03-18) — ✅ 배포 완료

> **배경:** (1) AI 타겟추출 0명 버그 (2) 전체고객 풀백 방지 과잉 로직 (3) address/name/phone 등 필터 누락 (4) 미리보기 vs 테스트발송 개인화 불일치 (5) 자동발송 시간 표시 오류 (6) 고객DB 필터 UI 중복/과잉

#### 수정 항목

**1. AI 타겟추출 0명 → 정상 추출 복구 (routes/ai.ts + services/ai.ts)**
- **문제:** 어제 커밋(73cd231)의 "전체 고객 풀백 방지" 로직이 정상 결과까지 0으로 덮어씀
- **수정:** (1) 풀백 방지 과잉 로직 삭제 — 로그만 남기고 actualCount를 임의로 0으로 만들지 않음 (2) AI 프롬프트 "핵심 안전 규칙" 삭제 — AI가 `filters: {}` 과잉 반환 유발 (3) countFilteredCustomers 에러 핸들링 — catch에서 조용히 0 반환 → throw로 전환

**2. 전체 필드 동적 필터 통일 (customer-filter.ts — CT-01)**
- **문제:** mixed 모드 SPECIAL_FIELDS에 name/email/address 포함 → FIELD_MAP 동적 루프에서 건너뜀 → AI가 address 필터 반환해도 SQL 미생성 → 전체 고객 반환
- **문제:** structured 모드 STRING_FIELDS에 phone 미포함 → 고객DB에서 전화번호 필터 무시
- **수정 (mixed 모드):** SPECIAL_FIELDS에서 name/email/address 제거 → FIELD_MAP 동적 루프가 자동 처리. SPECIAL_FIELDS에는 진짜 특수 처리 필요한 7개만 (gender, grade, region, age, phone, sms_opt_in, store_code)
- **수정 (structured 모드):** STRING_FIELDS/NUMERIC_FIELDS/DATE_FIELDS 하드코딩 분기 뒤에 FIELD_MAP 동적 처리 추가 → phone 포함 모든 직접 컬럼 필드 자동 처리. 새 필드 추가 시 FIELD_MAP에만 등록하면 양쪽 모드 모두 자동 반영.

**3. 고객DB 필터 UI 통합 (CustomerDBModal.tsx)**
- **수정:** (1) 상단 "이름 또는 전화번호 검색" 중복 영역 삭제 (2) 필터 한 줄로 통합 (3) 문자열 필드 → 연산자 드롭다운 없이 자동 contains(포함) 검색 (4) 숫자/날짜 필드만 이상/이하/범위 연산자 표시 (5) 초기화 버튼 필터 라인 끝으로 이동

**4. 미리보기 = 테스트발송 = 스팸테스트 개인화 통일 (Dashboard.tsx + campaigns.ts + spam-test-queue.ts)**
- **문제:** 미리보기 `ORDER BY name ASC` vs 테스트발송 `ORDER BY created_at DESC` → 서로 다른 고객 데이터로 치환
- **수정:** (1) Dashboard.tsx handleTestSend/handleTargetTestSend에 sampleCustomer body 전달 (2) campaigns.ts test-send에서 sampleCustomer 수신 시 DB 재조회 없이 그대로 사용 (3) spam-test-queue.ts 폴백 정렬 name ASC로 통일

**5. 자동발송 다음 발송일 시간 표시 KST 변환 (AutoSendPage.tsx)**
- **문제:** DB에 UTC로 저장된 next_run_at을 프론트에서 getHours()로 표시 → 10:00이 01:00으로 표시
- **수정:** formatDate()에서 UTC → KST (+9시간) 변환 후 getUTCHours()로 표시

#### 수정 파일 (8개)
- `packages/backend/src/utils/customer-filter.ts` — mixed SPECIAL_FIELDS 최소화 + structured FIELD_MAP 동적 처리
- `packages/backend/src/utils/spam-test-queue.ts` — 폴백 정렬 name ASC 통일
- `packages/backend/src/routes/ai.ts` — 풀백 방지 과잉 로직 삭제 + countFilteredCustomers 에러 핸들링
- `packages/backend/src/services/ai.ts` — AI 프롬프트 과잉 규칙 삭제 + countFilteredCustomers throw 전환
- `packages/backend/src/routes/campaigns.ts` — test-send sampleCustomer 수용
- `packages/frontend/src/pages/Dashboard.tsx` — sampleCustomer 전달
- `packages/frontend/src/components/CustomerDBModal.tsx` — 필터 UI 통합 + 자동 contains
- `packages/frontend/src/pages/AutoSendPage.tsx` — formatDate KST 변환

#### ⚠️ 검증 TODO
- [ ] AI 한줄로 타겟추출 → 정상 인원수 표시 확인
- [ ] 고객DB 필터 → 전화번호/주소/이름 포함 검색 정상 작동
- [ ] 담당자테스트 → 미리보기와 동일 고객명으로 개인화 확인
- [ ] 자동발송 다음 발송일 → 설정한 시간(KST) 그대로 표시 확인
- [ ] 자동발송 D-1 담당자 사전 알림 발송 여부 (내일 확인)

---

### 🔧 D78 — 프로 요금제 자동 스팸필터 테스트 + CT-09 (2026-03-16) — 배포 완료, 실서비스 검증 필요

> **배경:** 프로(100만원) 요금제 차별화 핵심 기능. AI 문안생성 시 자동으로 스팸필터 테스트 수행 → 차단 문안은 자동 재생성하여 안전한 문안만 제공.
> **⚠️ 상태: 코드 배포 완료, 실서비스 환경에서 E2E 검증 필요 (테스트폰 ACK 연동, 큐 순차 처리, 재생성 흐름 등)**

#### 구현 내역

**1. CT-09: spam-test-queue.ts (신규 컨트롤타워)**
- 글로벌 큐 기반 순차 처리 — 동시에 1건만 active (테스트폰 충돌 방지)
- batch_id로 3개 variant 그룹핑
- 차단 시 자동 재생성 (최대 2회, AI 프롬프트에 "스팸 차단됨, 다른 표현" 지시)
- Grace Period: 수동=10초, 자동=20초 (자동은 false positive 최소화)
- 3초 간격 큐 워커 (app.ts listen 콜백에서 시작)

**2. ai.ts — 자동 스팸테스트 연동**
- POST /generate-message: AI 문안 생성 후 plans.auto_spam_test_enabled=true이면 자동 스팸테스트 실행
- 3개 variant 전부 큐잉 → 순차 테스트 → 차단 시 재생성 → 결과를 응답에 포함
- 응답에 spam_result, spam_regenerated, spamTestBatchId 등 추가

**3. spam-filter.ts — 프로 이상 무료**
- auto_spam_test_enabled=true인 요금제: 스팸필터 테스트 선불 차감 skip (무료)
- 기존 베이직 요금제: 기존대로 수동 테스트 + 유료

**4. AiCampaignResultPopup.tsx — 스팸 배지 UI**
- Step 2 상단: 자동 스팸검사 진행/완료 배너 (검사 중.../전체 안전/N건 재생성됨)
- variant별 배지: ✅ 수신 안전 / 🔄 재생성 완료 / 🚫 스팸 차단
- 차단 variant 선택 불가 + 캠페인확정 버튼 disabled

**5. spam_check_number 하드코딩 제거**
- DB DEFAULT '0807196700' 제거 → 고객사 실제 080번호 동적 조회 (users 우선 → companies fallback)

#### DB 변경 (적용 완료)
```sql
ALTER TABLE plans ADD COLUMN auto_spam_test_enabled BOOLEAN DEFAULT false;
UPDATE plans SET auto_spam_test_enabled = true WHERE plan_code IN ('PRO', 'BUSINESS', 'ENTERPRISE');
ALTER TABLE spam_filter_tests ADD COLUMN source VARCHAR(20) DEFAULT 'manual';
ALTER TABLE spam_filter_tests ADD COLUMN variant_id VARCHAR(2);
ALTER TABLE spam_filter_tests ADD COLUMN batch_id UUID;
CREATE INDEX idx_spam_filter_tests_queued ON spam_filter_tests (status, created_at) WHERE status = 'queued';
ALTER TABLE spam_filter_tests ALTER COLUMN spam_check_number DROP DEFAULT;
```

#### 수정 파일 (7개)
- `packages/backend/src/utils/spam-test-queue.ts` — **신규** CT-09 컨트롤타워 (~450줄)
- `packages/backend/src/routes/ai.ts` — 자동 스팸테스트 연동
- `packages/backend/src/routes/spam-filter.ts` — 프로 무료 + 080번호 동적 조회
- `packages/backend/src/routes/companies.ts` — my-plan 쿼리에 auto_spam_test_enabled 추가
- `packages/backend/src/app.ts` — 큐 워커 시작 추가
- `packages/frontend/src/components/AiCampaignResultPopup.tsx` — 스팸 배지 UI
- 문서: CLAUDE.md (CT-09 추가), SCHEMA.md (컬럼 추가), STATUS.md

#### ⚠️ 실서비스 검증 TODO
- [ ] 프로 요금제 업체에서 AI 문안생성 → 자동 스팸테스트 실행 확인
- [ ] 큐 워커 정상 동작 (3초 간격 폴링, 순차 처리)
- [ ] 테스트폰 ACK → pass/blocked 판정 정상 여부
- [ ] 차단 시 자동 재생성 → 새 문안으로 교체 확인
- [ ] 여러 업체 동시 테스트 시 큐 충돌 없음 확인
- [ ] 베이직 요금제 → 기존대로 수동 테스트 유지 확인
- [ ] 프론트엔드 스팸 배지 표시 + 차단 variant 선택 불가 확인

#### TypeScript 타입 체크
- 백엔드/프론트엔드: ✅ 0 에러

---

### 🔧 D79 — 인라인 함수 전수조사/제거 + 날짜 정규화 수정 + 필터 UI 동적화 + plan_code 수정 (2026-03-16) — 배포 대기

> **배경:** (1) YYMMDD 6자리 엑셀 업로드 에러 재발 (2) 프로 요금제 대시보드에 스팸필터 테스트 비용 합산 (3) 고객DB 필터 UI 하드코딩 (4) 인라인 중복 함수 전수조사 — Harold님 강력 지시로 routes/ 전체 파일에서 컨트롤타워 중복 함수 제거
> **핵심:** CLAUDE.md 인라인 금지 원칙에도 불구하고 8건의 인라인 중복 함수가 잔존 → 물리적으로 전수 제거하여 구조적 재발 방지

#### 수정 항목

**1. YYMMDD 6자리 날짜 정규화 — 컨트롤타워(normalize.ts) 수정 (D79 핵심 교훈)**
- **문제:** upload.ts에 인라인 `normalizeDateValue()` 함수가 존재 → 이전 세션에서 인라인 함수만 수정 → FIELD_MAP 경로(`normalizeByFieldKey` → `normalizeDate`)에 미반영 → 업로드 에러 재발
- **수정:** normalize.ts `normalizeDate()`에 YYMMDD 6자리 핸들러 추가 (250103 → 2025-01-03). upload.ts 인라인 `normalizeDateValue()` + `excelSerialToDateStr()` 완전 삭제, `normalizeDate` import로 교체

**2. 프로 요금제 대시보드 — plan_code 대소문자 불일치**
- **문제:** customers.ts에서 `planCode === 'pro'`로 비교 → DB에 'PRO'(대문자) 저장 → 항상 false → 프로 계정도 스팸테스트 비용 합산
- **수정:** `.toUpperCase()` 적용 + 대문자 비교 (`'PRO', 'BUSINESS', 'ENTERPRISE'`)

**3. 고객DB 모달 필터 UI 동적화 (CustomerDBModal.tsx)**
- **문제:** 성별/등급/지역 필터가 하드코딩 버튼 → 새 필드 추가 불가
- **수정:** enabled-fields API 기반 동적 필드 드롭다운 + 연산자 선택 + 값 입력 UI. activeFilters 배열 → `buildDynamicFilterCompat` structured 형식 변환

**4. customers_unified VIEW — uploaded_by 컬럼 추가**
- **문제:** customers 테이블에 uploaded_by 추가 후 VIEW 미재생성 → 조회 에러
- **수정:** Harold님이 서버에서 직접 DROP VIEW + CREATE VIEW DDL 실행 완료

**5. ⚠️ 인라인 중복 함수 전수조사 — 8건 제거**

| # | 파일 | 인라인 함수 | 컨트롤타워 교체 |
|---|------|-----------|--------------|
| 1 | upload.ts | `normalizeDateValue()` + `excelSerialToDateStr()` | normalize.ts `normalizeDate()` |
| 2 | customers.ts | `buildDynamicFilter()` 래퍼 | customer-filter.ts `buildDynamicFilterCompat()` 직접 호출 |
| 3 | ai.ts | `buildFilterWhereClause()` 래퍼 | customer-filter.ts `buildFilterWhereClauseCompat()` 직접 호출 |
| 4 | campaigns.ts | `buildFilterQuery()` 래퍼 | customer-filter.ts `buildFilterQueryCompat()` 직접 호출 |
| 5 | manage-stats.ts | `getTestSmsTable()` | sms-queue.ts `getTestSmsTables()` |
| 6 | spam-filter.ts | `normalizeContent()` + `computeMessageHash()` + `getTestSmsTable()` | spam-test-queue.ts + sms-queue.ts |
| 7 | auto-campaigns.ts | `kstToUtc()` | auto-campaign-worker.ts `kstToUtc()` |
| 8 | spam-test-queue.ts / auto-campaign-worker.ts | (export 누락) | `export` 키워드 추가 |

#### 수정 파일 (12개)
- `packages/backend/src/utils/normalize.ts` — YYMMDD 6자리 핸들러 추가
- `packages/backend/src/utils/spam-test-queue.ts` — normalizeContent/computeMessageHash export 추가
- `packages/backend/src/utils/auto-campaign-worker.ts` — kstToUtc export 추가
- `packages/backend/src/routes/upload.ts` — 인라인 제거 + normalizeDate import
- `packages/backend/src/routes/customers.ts` — plan_code 대소문자 수정 + buildDynamicFilter 래퍼 제거
- `packages/backend/src/routes/ai.ts` — buildFilterWhereClause 래퍼 제거
- `packages/backend/src/routes/campaigns.ts` — buildFilterQuery 래퍼 제거
- `packages/backend/src/routes/manage-stats.ts` — getTestSmsTable 제거 + getTestSmsTables import
- `packages/backend/src/routes/spam-filter.ts` — 3개 인라인 제거 + import 교체
- `packages/backend/src/routes/auto-campaigns.ts` — kstToUtc 제거 + import
- `packages/frontend/src/components/CustomerDBModal.tsx` — 동적 필터 UI 전면 개편
- `CLAUDE.md` — 인라인 금지 원칙 + D79 사례 추가
- 서버 DDL: customers_unified VIEW 재생성 (Harold님 직접 실행 완료)

#### TypeScript 타입 체크
- 백엔드/프론트엔드: ✅ 0 에러

---

### 🔧 D81 — 대시보드 카드 동적 필터링 + UI 개선 4건 (2026-03-17) — 배포 대기 (git lock 해결 후)

> **배경:** (1) 자동조건완화 토글 기본값 OFF (2) 직접타겟발송 회신번호 제거 (3) 빈 배열 저장 허용 (4) 대시보드 카드 동적 필터링 (고객사 DB 데이터 유무 기반)

#### 수정 항목

**1. 자동 조건완화 토글 기본값 OFF**
- `AiSendTypeModal.tsx` — `useState(true)` → `useState(false)` (사용자가 명시적으로 켜야 함)

**2. 직접 타겟 설정 모달 회신번호 제거**
- `DirectTargetFilterModal.tsx` — CallbackNumber interface, callbackNumbers prop, selectedCallbackPhone state, 회신번호 select UI 블록 완전 삭제
- `Dashboard.tsx` — DirectTargetFilterModal 호출에서 `callbackNumbers={callbackNumbers}` prop 제거

**3. 대시보드 카드 빈 배열 저장 허용**
- `admin.ts` PUT — `cards.length === 0` 차단 조건 제거 → 카드 전부 해제 후 저장 가능

**4. ⚠️ 대시보드 카드 동적 필터링 (프론트+백엔드)**
- **핵심 버그:** 프론트엔드 AdminDashboard.tsx에 17개 카드 풀이 **하드코딩**되어 있어 백엔드 API의 동적 필터링을 완전히 무시 → 몇 번 배포해도 변경 없음
- **백엔드 (admin.ts GET /dashboard-cards):**
  - 직접 컬럼 EXISTS 서브쿼리로 데이터 유무 체크
  - customer_field_definitions + custom_fields JSONB 조합으로 커스텀 필드 체크
  - `filterPoolByAvailableData()` (dashboard-card-pool.ts) — 필터링된 pool만 API 응답에 포함
- **백엔드 (dashboard-card-pool.ts):**
  - DashboardCardDef에 `requiresField`, `customLabelPatterns`, `emoji` 속성 추가
  - 17개 카드 각각에 의존 직접 컬럼 + 커스텀 필드 라벨 패턴 매핑
- **프론트엔드 (AdminDashboard.tsx):**
  - ❌ 하드코딩 `DASHBOARD_CARD_POOL` 17개 **완전 삭제**
  - ✅ API 응답 `pool`을 `dashboardCardPool` state로 저장하여 동적 렌더링
  - 2열 그리드 레이아웃 (`grid-cols-1` → `grid-cols-2`)
  - 이모지 표시 (`card.icon` → `card.emoji`)

#### ⚠️ 배포 상태
- **git index.lock 이슈:** Harold님 로컬에서 `.git/index.lock` 파일 존재 → git add/commit 실패 → push 시 "Everything up-to-date" → 서버에 변경 미반영
- **해결:** `del C:\Users\ceo\projects\targetup\.git\index.lock` 후 재push 필요
- **테스트계정 예상 결과:** total_purchase_amount(0건), recent_purchase_date(0건) 관련 카드 3개(총 구매금액, 30일 내 구매, 90일+ 미구매) 필터링되어 14개 표시

#### 수정 파일 (6개)
- `packages/backend/src/utils/dashboard-card-pool.ts` — emoji 필드 추가, filterPoolByAvailableData() 함수
- `packages/backend/src/routes/admin.ts` — GET 동적 필터링 + PUT 빈 배열 허용
- `packages/frontend/src/pages/AdminDashboard.tsx` — 하드코딩 제거 → API pool 사용, 2열 그리드
- `packages/frontend/src/components/AiSendTypeModal.tsx` — 자동조건완화 기본 OFF
- `packages/frontend/src/components/DirectTargetFilterModal.tsx` — 회신번호 완전 제거
- `packages/frontend/src/pages/Dashboard.tsx` — callbackNumbers prop 제거

#### TypeScript 타입 체크
- 백엔드: ✅ 서버 tsc 0 에러 확인 완료
- 프론트엔드: ✅ Vite 빌드 성공 확인 완료 (git push 미반영 상태)

---

### ✅ D80 — AI 프리미엄 기능 3종 (자동조건완화 + 성과추천 + 문안자동생성) (2026-03-16) — 배포 완료

> **배경:** 프로(100만원) 요금제 전용 AI 프리미엄 기능 3종. plans.ai_premium_enabled 게이팅.
> **DB 마이그레이션:** ✅ 완료 (`migrations/ai-premium-features.sql`)

#### 기능 1: AI 타겟 자동조건완화 + ON/OFF 토글
- `services/ai.ts` — `relaxFilters()` 추가: AI가 조건을 완화하면서 마케팅 의도 유지
- `services/ai.ts` — `countFilteredCustomers()` 추가: 중복 COUNT 쿼리 공통화
- `routes/ai.ts` — recommend-target에 auto-relax 로직 (최대 2회, ai_premium_enabled 게이팅)
  - `auto_relax` 파라미터: 프론트에서 ON/OFF 제어 (기본 true)
- `AiSendTypeModal.tsx` — "AI 한줄로" 프롬프트 영역에 자동조건완화 ON/OFF 토글 추가
  - 프로 이상(aiPremiumEnabled)일 때만 표시
  - ON: "매칭 0건 시 AI가 조건을 완화하여 재추천"
  - OFF: "정확한 조건만 적용 (완화 없음)"
- `Dashboard.tsx` — `handleAiCampaignGenerate`에서 autoRelax 값을 recommendTarget API에 전달

#### 기능 2: 캠페인 성과 → AI 다음 캠페인 추천
- `stats-aggregation.ts` — `aggregateCampaignPerformance()` 추가: 세그먼트별/시간대별/메시지타입별/TOP5 다각도 집계
- `services/ai.ts` — `recommendNextCampaign()` 추가: AI가 성과 데이터 분석 → 다음 캠페인 추천
- `routes/ai.ts` — `POST /api/ai/recommend-next-campaign` 엔드포인트 추가
- `AiCustomSendFlow.tsx` — Step 2 헤더에 "AI 추천" 버튼 (앰버 그라데이션) + 호버 시 기능 설명 툴팁

#### 기능 3: 자동발송 + AI 문안 자동생성 (D-2/D-1/D-day 3단계 생명주기)
- `auto-campaign-worker.ts` — 전면 리팩토링:
  - Stage 1 `runMessageGeneration()`: D-2에 AI 문안생성 + `autoSpamTestWithRegenerate()` 자동 스팸테스트
  - Stage 2 `runPreNotification()`: D-1에 담당자 테스트발송 알림
  - Stage 3 `executeAutoCampaign()`: D-day 실제 발송 (AI 폴백 체인: generated → fallback → message_content)
- `auto-campaigns.ts` — CRUD API에 AI 필드 지원 (ai_generate_enabled, ai_prompt, ai_tone, fallback_message_content)
  - `checkAiPremiumGating()` — AI 프리미엄 게이팅 체크 함수 추가
  - CREATE/UPDATE에 AI 필수값 검증 + generated 필드 초기화 로직
  - GET 목록에 `ai_premium_enabled` 프론트 전달
- `AutoSendFormModal.tsx` — Step 4에 AI 자동생성 모드 토글:
  - 프로 이상만 표시되는 ON/OFF 토글 (문안 톤 선택 제거 — 불필요)
  - ON: 마케팅 컨셉 프롬프트 + 폴백 메시지 입력
  - OFF: 기존 수동 메시지 작성 (변경 없음)
  - Step 5 확인에 AI 설정 요약 표시
  - 발신번호 라벨 개선: "발신번호 (수신자에게 표시되는 번호)" + 매장전화번호 개별회신번호 안내
- `AutoSendPage.tsx` — PlanInfo에 ai_premium_enabled 추가, 모달에 prop 전달
- SMS + LMS 모두 AI 문안생성 지원 (message_type 동적 전달)

#### plan-info API 개선
- `companies.ts` — plan-info 조회에 `p.ai_premium_enabled` 추가
- `Dashboard.tsx` — PlanInfo 인터페이스에 `ai_premium_enabled` 타입 추가

#### 수정 파일 목록
- `migrations/ai-premium-features.sql` (신규)
- `packages/backend/src/utils/stats-aggregation.ts`
- `packages/backend/src/utils/auto-campaign-worker.ts`
- `packages/backend/src/services/ai.ts`
- `packages/backend/src/routes/ai.ts`
- `packages/backend/src/routes/auto-campaigns.ts`
- `packages/backend/src/routes/companies.ts`
- `packages/frontend/src/components/AutoSendFormModal.tsx`
- `packages/frontend/src/components/AiSendTypeModal.tsx`
- `packages/frontend/src/components/AiCustomSendFlow.tsx`
- `packages/frontend/src/pages/AutoSendPage.tsx`
- `packages/frontend/src/pages/Dashboard.tsx`
- `status/SCHEMA.md`, `status/STATUS.md`, `CLAUDE.md`

#### TypeScript 타입 체크
- 백엔드: ✅ 0 에러
- 프론트엔드: ✅ 0 에러

---

### ✅ D77 — 대시보드 DB현황 6분할 페이징 뷰 (2026-03-16) — 배포 완료

> **배경:** 대시보드 DB현황 카드가 4개/8개 고정 선택이었음. 카드를 자유롭게 선택하고 6개씩(3×2) 페이징으로 보여주도록 개선.

#### 수정 항목

**1. 슈퍼관리자 — 카드 선택 제한 해제 (AdminDashboard.tsx + admin.ts)**
- 4칸/8칸 토글 버튼 제거 → "자유롭게 선택, 6개씩 페이징" 안내 UI로 교체
- 체크박스 비활성화(isFull) 로직 제거 → 17종 풀에서 제한 없이 선택 가능
- 백엔드 PUT 검증: `cardCount !== 4 && !== 8` 제거 → 선택한 카드 수 자동 반영

**2. 고객사 대시보드 — 6분할 페이징 뷰 (Dashboard.tsx)**
- `grid-cols-4` → `grid-cols-3` (3열×2행 = 6개씩 표시)
- 페이지 state(dbCardPage) 추가, 도트 인디케이터로 페이지 전환 (2페이지 이상일 때만 표시)
- 블러 처리(미업로드)도 3×2 그리드로 통일
- 카드 색상은 전체 인덱스(globalIdx) 기준으로 페이지 간 일관성 유지

**3. 컨트롤타워 주석 업데이트 (dashboard-card-pool.ts)**
- "4개 또는 8개" → "원하는 만큼 선택, 6개씩 페이징 표시"

#### 수정 파일 (4개)
- `packages/backend/src/utils/dashboard-card-pool.ts` — 주석 업데이트
- `packages/backend/src/routes/admin.ts` — PUT 검증 로직 변경 (4/8 제한 제거)
- `packages/frontend/src/pages/AdminDashboard.tsx` — 4/8 토글 제거, 자유 선택 UI
- `packages/frontend/src/pages/Dashboard.tsx` — 6분할 페이징 뷰 + 도트 인디케이터

#### TypeScript 타입 체크
- 백엔드/프론트엔드: ✅ 0 에러

#### 하위호환
- 기존 4개/8개 설정 고객사 → 그대로 동작 (4개=1페이지, 8개=2페이지)
- DB/마이그레이션 불필요

---

### ✅ D76 — AI 문안 요일 오류 수정 + 요금제 피처 업데이트 + 자동발송 회사별 오버라이드 (2026-03-15) — 배포 완료

> **배경:** (1) AI 메시지 생성 시 요일이 틀림(3/20목→실제 금) — AI가 요일을 자체 계산해서 오류. (2) 요금제 비교 페이지 피처 업데이트 필요. (3) 베이직 업체에 서비스로 자동발송 1건 제공 필요.

#### 수정 항목

**1. AI 문안 요일 오류 — getKoreanCalendar() 누락 (ai.ts)**
- generateMessages() 프롬프트에 달력 미제공 → AI가 요일 자체 계산 → 오류
- getKoreanCalendar() + 경고 문구를 generateMessages, parseBriefing, optimizePrompt 3곳 추가
- getKoreanToday() 사용처 4곳 = getKoreanCalendar() 사용처 4곳 전수 일치 확인

**2. 요금제 피처 업데이트 (PricingPage.tsx)**
- 베이직: 분할 발송 제거, AI 자동매핑 추가
- 프로: API 연동→Sync-Agent 연동, 카카오톡 연동 제거, DB 실시간 동기화 추가, 자동발송 5건 추가
- 비즈니스: DB 실시간 동기화 제거(PRO에 이관), 자동발송 10건 추가
- 엔터프라이즈: 자동발송 무제한 추가

**3. 자동발송 회사별 오버라이드 (auto-campaigns.ts + DB)**
- companies 테이블에 auto_campaign_override 컬럼 추가 (INTEGER, DEFAULT NULL)
- NULL=플랜설정따름, 0=강제비활성, 1+=해당건수허용
- checkPlanGating() 수정: 오버라이드 값이 있으면 플랜보다 우선 적용
- GET / 목록 조회: 프론트에 전달하는 plan 정보도 오버라이드 반영
- 사용법: `UPDATE companies SET auto_campaign_override = 1 WHERE id = '업체ID';`

#### 수정 파일 (3개) + DB 마이그레이션 (1개)
- `packages/backend/src/services/ai.ts` — 3곳에 getKoreanCalendar() 추가
- `packages/frontend/src/pages/PricingPage.tsx` — getPlanFeatures() 피처 목록 업데이트
- `packages/backend/src/routes/auto-campaigns.ts` — checkPlanGating + GET / 오버라이드 반영
- `status/migrations/D76-auto-campaign-override.sql` — DB 마이그레이션

#### TypeScript 타입 체크
- 백엔드: ✅ 0 에러

#### ⚠️ 배포 시 필수 작업
1. 서버 DB에서 마이그레이션 SQL 실행: `status/migrations/D76-auto-campaign-override.sql`
2. 이후 tp-push → tp-deploy-full

---

### ✅ D75 — UI/UX 버그 4건 수정 + CT-08 개별회신번호 필터링 컨트롤타워 (2026-03-14) — 배포 완료

> **배경:** 직원(isoi, sh_de) 버그리포트 4건 — LMS 제목 입력 누락, 회신번호 에러 UX, 커스텀필드 타겟추출 NULL, 타겟추출 10000건 하드코딩 제한
> **원칙:** 컨트롤타워를 수정하고 나머지는 컨트롤타워를 바라보게 업데이트 (Harold님 명시 지시)

#### 수정 항목

**Bug 1 (B-D75-01): SMS→LMS 자동전환 시 제목 입력 불가 + window.confirm**
- AiCampaignResultPopup.tsx: `window.confirm` → 커스텀 모달 (amber/orange 그라데이션, 바이트 표시, LMS 전환 버튼)
- AiCampaignSendModal.tsx: LMS 제목 입력 필드 추가 (selectedChannel === 'LMS' || 'MMS' 일 때 표시)
- AiCampaignSendModal.tsx: 하드코딩 샘플 데이터 `{ '이름': '김민수', ... }` 제거 → `sampleCustomer` prop으로 실제 데이터 전달
- Dashboard.tsx: `sampleCustomer` prop 체인 연결, `subject` 전달 로직 추가

**Bug 2 (B-D75-02): 개별회신번호 미등록 시 전체 차단 → 개별 제외로 변경**
- ★ **CT-08 신설: `callback-filter.ts`** — 개별회신번호 필터링 컨트롤타워
  - `filterByIndividualCallback(customers, companyId)` — store_phone 폴백 → callback 미보유 제외 → 미등록 회신번호 제외
  - `buildCallbackErrorResponse(missing, unregistered)` — 제외 사유 구체적 안내 응답 생성
- campaigns.ts AI send 경로: 인라인 ~50줄 → CT-08 호출로 교체
- campaigns.ts direct-send 경로: 인라인 ~50줄 → CT-08 호출로 교체
- 에러 응답에 `callbackMissingCount`, `callbackUnregisteredCount`, `isCallbackIssue` 포함

**Bug 3 (B-D75-03): 직접타겟설정 커스텀필드 NULL 표시**
- customers.ts extract API: custom_fields JSONB를 flat하게 풀어서 반환 (백엔드 컨트롤타워에서 처리)
- Dashboard.tsx: 프론트엔드 인라인 flat 로직 제거 (백엔드로 이관)

**Bug 4 (B-D75-04): 타겟추출 10,000건 하드코딩 제한**
- customers.ts: `limit = 10000` 하드코딩 제거, LIMIT 절 완전 삭제 (무제한 추출)
- Dashboard.tsx: toast에 `toLocaleString()` 천단위 구분 적용

#### 수정 파일 (6개)
- `packages/backend/src/utils/callback-filter.ts` — ★ CT-08 신규 생성
- `packages/backend/src/routes/campaigns.ts` — CT-08 import + AI send/direct-send 인라인→CT-08 교체
- `packages/backend/src/routes/customers.ts` — limit 제거 + custom_fields flat 처리
- `packages/frontend/src/components/AiCampaignResultPopup.tsx` — window.confirm→커스텀 모달
- `packages/frontend/src/components/AiCampaignSendModal.tsx` — LMS 제목 입력 + sampleCustomer prop
- `packages/frontend/src/pages/Dashboard.tsx` — sampleCustomer/subject prop 연결 + toLocaleString

#### TypeScript 타입 체크
- 백엔드: ✅ 0 에러
- 프론트엔드: ✅ 0 에러

---

### ✅ D74 — 컨트롤타워 동적화 + store_phone 정규화 수정 (2026-03-14) — 배포 완료

> **배경:** sh_cpb 버그리포트 — AI 한줄로 타겟추출 시 타겟 수 불일치(1,224 vs 823) + 매장전화번호 개인화 실패
> **근본 원인:** (1) normalizePhone이 유선번호를 전부 null 처리, (2) customer-filter.ts/ai.ts에 필터 필드 하드코딩 잔존
> **핵심 수정:** 컨트롤타워를 FIELD_MAP 기반 동적 구조로 전환. 필드 추가 시 핸들러 수동 추가 불필요.

#### 수정 항목
- **normalizeStorePhone:** normalize.ts에 유선번호(02/031~055/070/080/1588 등) 허용 함수 추가. standard-field-map.ts store_phone → normalizeStorePhone 변경
- **customer-filter.ts 동적화:** mixed 모드 하드코딩 핸들러 전부 제거 → getColumnFields() 기반 dataType별(number/date/string) 자동 필터 생성. 새 필드 추가 시 핸들러 추가 불필요
- **ai.ts 프롬프트 동적화:** 하드코딩 필터 필드 목록 제거 → getColumnFields() + COUNT FILTER(데이터 있는 필드만) + customer_field_definitions(커스텀 필드 라벨) 동적 생성

#### 수정 파일 (4개)
- `packages/backend/src/utils/normalize.ts` — isValidKoreanLandline + normalizeStorePhone 추가, normalizeByFieldKey switch 추가
- `packages/backend/src/utils/standard-field-map.ts` — store_phone normalizeFunction 변경
- `packages/backend/src/utils/customer-filter.ts` — mixed 모드 FIELD_MAP 기반 동적 필터
- `packages/backend/src/services/ai.ts` — 프롬프트 필터 필드 동적 생성

---

### ✅ D73 — 무료체험 게이팅 + 수신거부 아키텍처 정비 + 커스텀 필드 라벨 CT-07 (2026-03-14) — 배포 완료

> **배경:** 직원 버그리포트 11건 중 관련 6건 처리 — 무료체험 기능제한, 수신거부 데이터 격리, 커스텀 필드 라벨 밀림
> **핵심 정책 결정:** company_admin은 발송 차단(관리 전용). 수신거부는 user_id(브랜드) 기준. 전체 데이터 = 회사 = 고객사관리자 뷰, 분류코드(store_code) = 사용자 = 브랜드 뷰.

#### 완료 항목
- **무료체험 게이팅:** FREE 플랜 → PRO 레벨 기능 7일 개방, 체험 만료 후 직접발송(파일/주소록 업로드)만 유지, 스팸필터테스트만 잠금
  - Dashboard.tsx: `isSubscriptionLocked`에 `plan_code=FREE && is_trial_expired` 추가, AI카드 opacity/lock 아이콘
  - upload.ts: 직접발송 파일파싱(`?includeData=true`) customer_db_enabled 게이팅 면제
- **수신거부 아키텍처 정비 (CT-03):**
  - `getUserUnsubscribes()` 확장: company_admin → `WHERE company_id` (전체), company_user → `WHERE user_id` (본인)
  - `registerUnsubscribe()` 신설: company_admin 등록 시 고객 store_code 기준 올바른 브랜드 사용자에게 자동 배정
  - unsubscribes.ts: 수동추가/CSV업로드 전부 CT-03 호출로 전환 (인라인 쿼리 제거)
  - upload.ts: sms_opt_in=false 자동등록도 admin이면 store_code 기준 브랜드 배정
  - DB 데이터 보정: 시세이도 admin에 몰린 1486건 → 각 브랜드 사용자에게 store_code 기준 재배정
- **커스텀 필드 라벨 CT-07:**
  - `upsertCustomFieldDefinitions()` 신설: ON CONFLICT DO UPDATE (라벨 항상 최신화, "최초 등록 우선" 정책 제거)
  - upload.ts, sync.ts 인라인 로직 → CT-07 호출로 전환
  - DB 데이터 보정: 시세이도 custom_1~6 라벨 1칸 밀림 교정 + custom_7(무데이터) 삭제
- **고객 상세 필드 누락:** CustomerDBModal.tsx에 주소, 최근구매금액 추가

#### 수정 파일 (8개)
- `packages/backend/src/utils/standard-field-map.ts` — CT-07 upsertCustomFieldDefinitions 추가
- `packages/backend/src/utils/unsubscribe-helper.ts` — CT-03 getUserUnsubscribes 확장 + registerUnsubscribe 추가
- `packages/backend/src/routes/unsubscribes.ts` — CT-03 호출 전환
- `packages/backend/src/routes/upload.ts` — CT-07 전환 + 직접발송 게이팅 면제 + admin 수신거부 배정
- `packages/backend/src/routes/sync.ts` — CT-07 전환
- `packages/frontend/src/pages/Dashboard.tsx` — 무료체험 만료 잠금
- `packages/frontend/src/components/CustomerDBModal.tsx` — 상세 필드 추가
- `CLAUDE.md` — 섹션 0 컨트롤타워 우선 확인 원칙 + CT-07 문서화

---

### 🔧 D69 — 자동발송 기능 (2026-03-12) — Phase 1 배포 완료 + 모달 개선 진행 중

> **배경:** 메트로시티 요청 — 생일자 자동발송 등 반복 스케줄 설정 기능
> **적용:** 프로 요금제(100만원) 이상
> **설계 문서:** `status/AUTO-SCHEDULE-DESIGN.md`

#### Phase 1 구현 완료 항목
- **DB:** auto_campaigns + auto_campaign_runs 테이블 생성 완료, plans.auto_campaign_enabled + plans.max_auto_campaigns 컬럼 추가 완료
- **백엔드:** routes/auto-campaigns.ts(CRUD 9개 엔드포인트) + utils/auto-campaign-worker.ts(매 1시간 체크 워커) + app.ts 마운트/워커 시작 연결
- **프론트:** DashboardHeader 메뉴 추가('AI 분석'↔'직접발송' 사이) + AutoSendPage.tsx(프로 미만 블러+CTA / 프로 이상 실제 기능) + AutoSendFormModal.tsx(5단계 모달)
- **UX:** AnalysisModal 블러 패턴 적용 — 누구나 메뉴 클릭→페이지 진입→상단 설명+하단 블러+CTA
- **권한:** company_admin + company_user(브랜드담당자) 모두 생성/수정/삭제 가능 (store_code 범위 내)
- **스케줄:** 매월(1~28일)/매주/매일 + 발송 시각 설정. 매월 28일 max (2월 고려)
- **게이팅:** 요금제별 동시 활성 수 제한 — PRO: 5개, BUSINESS: 10개, ENTERPRISE: 무제한
- **실패 정책:** 스킵 + failed 기록 → next_run_at 다음 스케줄로 갱신 (중복 발송 방지)
- **기존 파이프라인 100% 재활용:** customer-filter, sms-queue, messageUtils, unsubscribe-helper, prepaid, campaign-lifecycle, store-scope

#### AutoSendFormModal 개선 (2026-03-12, 배포 완료)
- **버그 수정:** 발신번호 로딩 — `data.callbackNumbers` → `data.numbers` (API 응답 키 불일치 수정)
- **5단계 재구성:** 1.기본정보 → 2.활용필드선택(신규) → 3.스케줄 → 4.메시지 → 5.확인
- **2단계 활용필드선택:** AiCustomSendFlow 패턴 — `/api/customers/enabled-fields` 기반 카테고리별 동적 필드 체크박스. 선택한 필드가 4단계 변수 드롭다운과 AI 문구생성 personalFields에 연동
- **4단계 메시지 보강:** SMS/LMS/MMS 수동 탭 토글, 바이트 동적표시(90/2000), 광고문구 실시간 미리보기((광고)+무료거부), 이모지 경고, MMS 이미지 업로드, LMS/MMS 제목 필수 체크
- **AI 문구추천:** AiMessageSuggestModal 연동 + selectedFields 기반 개인화. 프로 이상 접근이므로 잠금 제거
- **스팸필터테스트:** SpamFilterTestModal 연동. 프로 이상 접근이므로 잠금 제거
- **자동입력 변수:** 하드코딩 5개 버튼 → enabled-fields 기반 동적 드롭다운 (TargetSendModal 패턴)
- **⚠️ 미완료:** 타겟 필터 UI (Phase 2), 실행 이력 상세 조회 (Phase 2)

#### Phase 2 (미구현, 향후)
- D-1 사전 알림 (auto-campaign-notify.ts)
- 타겟 필터 UI (AutoSendFormModal에 필터 단계 추가)
- 실행 이력 상세 조회
- 캘린더 연동 (CalendarPage에 자동발송 이벤트 표시)
- 슈퍼관리자 모니터링 (admin 대시보드)

#### Phase 3 (미구현, 향후)
- AI 메시지 자동 생성 연동 (매 실행마다 시즌별 메시지 자동 생성)
- 실행 결과 리포트 (월간 자동발송 성과 대시보드)
- 카카오톡 채널 자동발송 지원

---

### ✅ D72 — 예약캠페인 관리 + 발송비용 계산 + storageType 동적필터 + 발송 성능개선 (2026-03-13) — 배포 완료

> **배경:** (1) 예약 대기 모달에 예약 캠페인이 표시되지 않고 취소 수단 없음, (2) 발송결과 모달의 예상 비용이 메시지 타입 무시하고 SMS 단가(9.9원)로만 계산됨, (3) 예약발송 시 `column "custom_2" does not exist` 에러 — enrichWithCustomFields가 JSONB 내부 키를 SQL SELECT에 노출, (4) 25,000건 발송에 3분 소요 — 건건이 MySQL INSERT (70만건이면 90분).
> **원칙:** 기록 보존 원칙 (삭제 아닌 상태 변경), 기간계 무접촉, 하드코딩 금지 — storageType 동적 판별, 컨트롤타워(CT-04) 활용.

#### ✅ 버그 1: 예약 대기 모달 — draft 캠페인 미표시 + 취소 기능 없음

**현상:** AI 캠페인 생성 후 예약 시간이 설정되어 있으나 예약 대기 모달에 표시되지 않음. 취소 수단 자체가 없음.
**원인:** AI 캠페인 생성 시 status='draft'로 INSERT, 예약 대기 모달은 status='scheduled'만 조회 → draft+scheduled_at 캠페인 누락
**수정 파일 및 내용:**

| 파일 | 수정 내용 |
|------|-----------|
| `campaigns.ts` | `DELETE /:id` 엔드포인트 추가 — 실제 삭제 아닌 `status='cancelled'`로 변경 (기록 보존). 과거 예약 차단 + 15분 이내 취소 제한 |
| `Dashboard.tsx` | `loadScheduledCampaigns` — draft+scheduled_at 캠페인도 함께 조회 (Promise.all 병렬 fetch) |
| `ScheduledCampaignModal.tsx` | draft 캠페인 "(미확정)" 라벨 표시, draft/scheduled 분기 취소 처리, 15분 제한 |
| `CalendarModal.tsx` | draft 캠페인 amber 색상 표시, 예약 취소 버튼 + 시간 제한 (과거/15분 이내 비활성화) |
| `ResultsModal.tsx` | 취소된 캠페인도 결과 목록에 기록 보존 (삭제하지 않음) |

#### ✅ 버그 2: 발송결과 모달 — 예상 비용 SMS 단가로만 계산

**현상:** LMS 27원인데 발송현황의 예상 비용이 SMS 9.9원 기준으로 계산
**원인:** ResultsModal.tsx에서 `totalSuccess * perSms` 단일 계산 — message_type 무시
**수정:**

| 파일 | 수정 내용 |
|------|-----------|
| `ResultsModal.tsx` | 캠페인별 `message_type`(SMS/LMS/MMS) + `send_channel`(kakao) 체크하여 올바른 단가 적용. `filteredCampaigns.reduce()` 패턴으로 개별 합산 |

**단가 기준:** SMS 9.9원 / LMS 27원 / MMS 50원 / 카카오 7.5원 (백엔드 results.ts API에서 조회)

#### ✅ 버그 3: 예약발송 `column "custom_2" does not exist` — storageType 동적 필터

**현상:** 예약발송 시 서버 500 에러 — `column "custom_2" does not exist at character 618`
**원인:** `enrichWithCustomFields()`가 customer_field_definitions에서 커스텀 필드를 fieldMappings에 추가할 때 `column: 'custom_2'` (custom_fields JSONB 내부 키)를 설정 → 5개 발송 경로의 동적 SELECT에 그대로 포함 → PostgreSQL에 실제 컬럼이 없으므로 에러
**해결 방향:** `VarCatalogEntry`에 `storageType` 속성 추가 — `'column'` (SQL SELECT 가능) vs `'custom_fields'` (JSONB 내부 키, SQL SELECT 불가). 모든 동적 SELECT 생성 지점에서 `storageType !== 'custom_fields'` 필터링.

| 파일 | 수정 내용 |
|------|-----------|
| `services/ai.ts` | `VarCatalogEntry` 인터페이스에 `storageType?: 'column' \| 'custom_fields'` 추가, `buildVarCatalogFromFieldMap()`에서 `storageType: 'column'` 설정 |
| `utils/messageUtils.ts` | `enrichWithCustomFields()`에서 `storageType: 'custom_fields'` 설정 |
| `routes/campaigns.ts` | **4곳** 동적 SELECT에 `.filter(m => m.storageType !== 'custom_fields')` 적용 — test-send, /:id/send, direct-send, schedule/문안수정 |
| `utils/auto-campaign-worker.ts` | **1곳** 동적 SELECT에 storageType 필터 적용 |
| `routes/spam-filter.ts` | **1곳** 동적 SELECT에 storageType 필터 적용 + custom_fields 컬럼 SELECT에 추가 |

**⚠️ 전수점검 — 동적 SELECT 6곳 모두 적용 완료:**
1. campaigns.ts ~277 (test-send)
2. campaigns.ts ~600 (/:id/send AI캠페인)
3. campaigns.ts ~1470 (direct-send)
4. campaigns.ts ~2088 (schedule/문안수정)
5. auto-campaign-worker.ts (자동발송)
6. spam-filter.ts (스팸필터 테스트)

#### ✅ 성능개선: 발송 MySQL INSERT 벌크화 — bulkInsertSmsQueue 컨트롤타워 (CT-04)

**현상:** 25,000건 발송에 약 3분 소요 — 건건이 MySQL INSERT (25,000회 DB 왕복). 70만건이면 ~90분.
**해결:** `sms-queue.ts` (CT-04)에 `bulkInsertSmsQueue()` 함수 추가 — 테이블 라운드로빈 분배 + 5,000건 배치 bulk INSERT.

| 파일 | 수정 내용 |
|------|-----------|
| `utils/sms-queue.ts` | `bulkInsertSmsQueue(tables, rows, useNow)` 함수 추가 — 라운드로빈 테이블 분배, BATCH_SIZES.smsSend(5000) 단위 배치 |
| `config/defaults.ts` | `BATCH_SIZES.smsSend: 5000` 추가 (max_allowed_packet 64MB 기준) |
| `routes/campaigns.ts` | AI캠페인(/:id/send): 건건이 INSERT → `bulkInsertSmsQueue()` 1줄 호출. 직접발송(direct-send): inline bulk → `bulkInsertSmsQueue()` + app_etc2(companyId) 추가 |
| `utils/auto-campaign-worker.ts` | 건건이 INSERT → `bulkInsertSmsQueue()` 1줄 호출, `mysqlQuery`/`BATCH_SIZES` import 제거 |

**적용 경로 (3개):**
- AI캠페인 `/:id/send` → `bulkInsertSmsQueue(companyTables, aiSmsRows, !isScheduled)`
- 직접발송 `/direct-send` → `bulkInsertSmsQueue(companyTables, directSmsRows, useNow)`
- 자동발송 `auto-campaign-worker` → `bulkInsertSmsQueue(companyTables, autoSmsRows, true)`

**미적용 (2개, 사유):**
- 테스트발송 `/test-send`: 1~3건 극소량 + bill_id 추가 컬럼 → 개별 INSERT 유지
- 문안수정 `/:id/schedule`: UPDATE (INSERT 아님) → 해당 없음

**성능 예상:** 25,000건 기준 25,000회 → 5회 INSERT (5000건 배치) = 약 5,000배 DB 왕복 감소

**TypeScript:** 백엔드 `tsc --noEmit` 에러 없이 통과

---

### 🔧 D71 — 시세이도 3만건 업로드 후속 수정 (2026-03-13) — ✅ 완료 (배포 완료)

> **배경:** 시세이도CPB 30,000건 엑셀 업로드 후 (1) 슈퍼관리자 고객 목록 500에러, (2) 업로드 전건 에러, (3) 조회 시 일부 컬럼 null 표시, (4) 업로드 속도 저하 발견.
> **원칙:** 하나씩 근본 원인 파악 → 수정. 기간계 무접촉.

#### ✅ customers_unified VIEW store_phone 누락 수정 (서버 DDL 직접 실행)
- **현상:** 슈퍼관리자 고객 목록 500에러
- **원인:** customers 테이블에 store_phone 컬럼 추가했지만 customers_unified VIEW 재생성 안 함 → SELECT에서 "column store_phone does not exist" 에러
- **수정:** DROP VIEW + CREATE VIEW (store_phone 포함, 3개 SELECT 모두에 명시적 추가)

#### ✅ upload.ts region 중복 INSERT 수정 (배포 완료)
- **현상:** 30,000건 업로드 전건 에러 ("column region specified more than once")
- **원인:** D70-17에서 region을 FIELD_MAP에 추가 → getColumnFields()에 region 포함 + insertCols/rowValues/updateClauses에 명시적 region이 남아있어 중복
- **수정:** 명시적 region 3곳(insertCols, rowValues push, updateClauses) 제거, FIELD_MAP 루프에서 derivedRegion 우선 처리

#### ✅ upload.ts AI 매핑 프롬프트 정합성 수정
- **현상:** 엑셀에 데이터가 있는데 DB에 null로 저장
- **원인 1:** 프롬프트 예시에 `"구매횟수": "custom_1"` — FIELD_MAP의 `purchase_count`와 모순
- **원인 2:** `recent_purchase_date` FIELD_MAP 미등록 → AI 매핑 대상 자체에 없음
- **원인 3:** mappingTargets, standardFields에 region 중복 (FIELD_MAP + 하드코딩)
- **원인 4:** 프롬프트에 store_name, 날짜/구매 관련 필드 구분 안내 없음
- **수정:**
  - `standard-field-map.ts`: `recent_purchase_date` 필드 추가 (dataType: date, normalizeDate)
  - `upload.ts` 프롬프트: 예시 수정 (`purchase_count`, `recent_purchase_date`), 규칙 #6 store_name 추가, 규칙 #7 날짜/구매 필드 구분 추가
  - `upload.ts` mappingTargets: region 하드코딩 삭제 (FIELD_MAP에서 자동 생성)
  - `upload.ts` standardFields: region 수동 push 삭제 (FIELD_MAP에서 자동 포함)
  - 주석: "필수 17개" 숫자 하드코딩 → "직접 컬럼 필드"로 변경

#### ✅ customers.ts SELECT 누락 컬럼 3개 추가
- **현상:** 고객DB 조회 시 최근구매금액, 구매횟수, 주소가 `-` 표시
- **원인:** 데이터는 DB에 정상 저장되어 있으나 customers.ts의 SELECT 쿼리에서 `address`, `recent_purchase_amount`, `purchase_count` 3개 컬럼을 가져오지 않음
- **수정:** SELECT에 3개 컬럼 추가. 재업로드 불필요 — 배포만 하면 기존 데이터 즉시 표시

#### ✅ 업로드 배치 사이즈 복원 (500 → 2000)
- **현상:** 업로드 속도 체감 저하
- **원인:** 초기 BATCH_SIZE 4000 → 어느 시점에 500으로 축소 → 30,000건 기준 8배치→60배치 (7.5배 증가)
- **수정:** `defaults.ts` customerUpload 500 → 2000 (30,000건 = 15배치, 4배 개선)

#### 수정 파일 목록
| 파일 | 수정 내용 |
|------|-----------|
| `standard-field-map.ts` | recent_purchase_date 추가, 주석 숫자 하드코딩 제거 |
| `upload.ts` | AI 프롬프트 예시/규칙 수정, region 중복 제거, 주석 정리 |
| `customers.ts` | SELECT에 address, recent_purchase_amount, purchase_count 추가 |
| `defaults.ts` | customerUpload 배치 사이즈 500→2000 |

**⚠️ 배포 필요:** tp-push + tp-deploy-full

---

### 🔧 D70 — 직원 QA 버그 일괄수정 (2026-03-12) — 🔶 진행 중 (3차 배포 완료, 잔여 1건 B-D70-18)

> **배경:** 직원 2명이 실동작 검증 후 PPT(8슬라이드) + 체크리스트(30항목) 버그 리포트 제출. 서버 검증 후 순차 수정.
> **원칙:** 직원 리포트 그대로 믿지 않고, 서버 실데이터/코드로 교차검증 후 수정.

#### ✅ 수정 완료 (1차 배포 완료)
1. **Redis 캐시키 브랜드 격리 (Slide 1):** `stats:${companyId}` → `stats:${companyId}:${userId}` — 다른 브랜드 담당자 간 캐시 충돌 방지 (`customers.ts`)
2. **고객DB 날짜 표시 (Slide 3):** `T15:00:00.000Z` → `formatDate()` 적용. birth_date, recent_purchase_date, created_at, wedding_anniversary, DATE 타입 필드 (`CustomerDBModal.tsx`)
3. **커스텀 필드 정의 저장 (Slide 4 일부):** field_type `'text'` → `'VARCHAR'` — customer_field_definitions CHECK 제약조건 위반 수정 (`upload.ts`)
4. **MMS 보관함 이미지 (Slide 7):** sms_templates.mms_image_paths 컬럼 추가 (ALTER TABLE 실행 완료) + 저장/불러오기 코드 (`sms-templates.ts`, `Dashboard.tsx`)
5. **주소록 파일업로드 401 (Slide 8a):** Authorization 헤더 누락 → `Bearer ${token}` 추가 (`AddressBookModal.tsx`)
6. **주소록 브랜드 격리 (Slide 8b):** address_books.user_id 컬럼 추가 (ALTER TABLE 실행 완료) + 4개 라우트에 user_id 필터 적용 (`address-books.ts`)
7. **대시보드 성공건수 (신규 발견):** `monthly_sent: totalSent`(큐 INSERT 건수) → `totalSuccess`(실제 성공건수)로 변경 + 담당자테스트/스팸필터 성공건수도 합산 (`customers.ts`)
8. **직접발송 머지변수 NULL (Slide 5):** replaceVariables 컨트롤타워에 `addressBookFields` 4번째 파라미터 추가 — %기타1/2/3%, %회신번호% 주소록 변수를 fieldMappings 순회 전에 치환하여 안전망에 잡히지 않도록 처리 (`messageUtils.ts`, `campaigns.ts` SMS+카카오 양쪽)
9. **upload.ts customer_schema 미갱신:** 엑셀 업로드 후 companies.customer_schema 자동 갱신 로직 추가 — customers.ts 일괄추가와 동일 쿼리 (`upload.ts`)

#### ✅ 수정 완료 (2차 배포 완료)
10. **브랜드 격리 — store_code 자동할당 (Slide 2):** 엑셀에 store_code 컬럼이 없으면 업로드 사용자의 `store_codes[0]`을 자동 할당 → UNIQUE(company_id, store_code, phone) 제약에 의해 브랜드별 별개 레코드 분리 (`upload.ts`)
11. **브랜드 격리 — 필드 라벨 덮어쓰기 방지:** customer_field_definitions에 이미 라벨이 있는 필드는 덮어쓰지 않음 — "최초 등록 우선" 정책 (`upload.ts`)
12. **고객사관리자 브랜드 필터:** 고객DB에서 브랜드(store_code) 드롭다운 필터 추가. filter-options API에 store_codes 목록 포함 (`customers.ts`, `CustomerDBModal.tsx`, `Dashboard.tsx`)
13. **store_phone → callback 폴백:** 개별회신번호 사용 시 callback이 없으면 store_phone을 회신번호로 사용. 둘 다 없는 수신자는 제외 (`campaigns.ts` /:id/send + /direct-send 양쪽)
14. **MMS 이미지 있을 때 비용절감 추천 스킵:** MMS 이미지가 업로드된 상태에서 SMS 전환 안내 모달을 띄우지 않음 (`Dashboard.tsx`, `TargetSendModal.tsx`)
15. **MMS 전송 후 이미지 리셋:** 직접발송/타겟발송 성공 후 `setMmsUploadedImages([])` 추가 — 이전 발송 이미지가 잔류하던 문제 해결 (`Dashboard.tsx`)

#### ✅ 수정 완료 (3차 배포 완료)
16. **매장 필드 고객DB 미표시 (Slide 4 일부):** customers.ts SELECT에 registered_store, recent_purchase_store, store_phone, registration_type 컬럼 누락 → 추가. CustomerDBModal에 4개 필드 표시 추가 (`customers.ts`, `CustomerDBModal.tsx`)
17. **AI맞춤한줄 개인화 불일치 (B8-03):** buildVarCatalogFromFieldMap()이 custom_fields를 스킵 → 커스텀 필드 라벨이 발송 시 fieldMappings에 없음 → 안전망이 제거. enrichWithCustomFields() 헬퍼 신설 + 5경로 전부 적용 (`messageUtils.ts`, `campaigns.ts` 4경로, `auto-campaign-worker.ts`)
18. **필터 UI 보유필드 미표시 (D39):** region, store_name, purchase_count가 FIELD_MAP에 미정의 → enabled-fields 감지 불가. FIELD_MAP에 3개 필드 추가 (`standard-field-map.ts`)

#### ❌ 미해결 (다음 세션)
- **B-D70-18 — 직원 QA 추가 버그:** Harold님이 다음 세션에서 추가 스크린샷 확인 예정

---

### ✅ D68 — 대시보드 UI 수정 + AI 생일 타겟팅 + 테스트 비용 합산 + 커스텀 필드 라벨 (2026-03-12) — 배포 완료

> **배경:** 메트로시티 첫 시연 준비 중 발견된 4건. 대시보드 UI 이슈 + AI 필터 누락 + 비용 집계 누락.
> **원칙:** 기간계 무접촉. 프론트+백엔드 수정만.

#### ✅ 대시보드 총 구매금액 아이콘/포맷 수정

**파일:** `dashboard-card-pool.ts`, `Dashboard.tsx`
**원인:** 총 구매금액 카드에 DollarSign($) 아이콘 + 천 단위 콤마 없음
**수정:** DollarSign → CreditCard 아이콘, `.toFixed(0)` → `Math.round().toLocaleString()` 천 단위 콤마 추가

#### ✅ 커스텀 필드 라벨 미표시 버그 수정

**파일:** `customers.ts`, `upload.ts`
**원인:** upload.ts에서 customer_field_definitions INSERT 시 `is_hidden` 미설정 → NULL로 저장 → enabled-fields 쿼리 `is_hidden = false` 조건에 NULL 미매칭 → FIELD_MAP 기본값 "커스텀1/2/3"으로 폴백
**수정:** 조회 조건 `(is_hidden = false OR is_hidden IS NULL)` + INSERT 시 `is_hidden = false` 명시

#### ✅ AI 생일 타겟팅 전체 고객 선택 버그 수정

**파일:** `customer-filter.ts`, `services/ai.ts`, `routes/ai.ts`, `AiCustomSendFlow.tsx`
**원인:** (1) AI 프롬프트에 birth_date 필터 필드 누락 → AI가 생일 필터 생성 불가 (2) customer-filter.ts mixed 형식에 birth_date 핸들러 없음 → 필터 생성해도 무시
**수정:**
- customer-filter.ts: mixed 형식에 birth_date 핸들러 추가 (birth_month/gte/lte/between)
- services/ai.ts: recommend-target + parseBriefing 프롬프트에 birth_date 필터 + birth_month 연산자 추가
- routes/ai.ts: recount-target에 birthMonth→birth_date 변환 추가
- AiCustomSendFlow.tsx: TargetCondition 인터페이스 + EMPTY_TARGET_CONDITION에 birthMonth 추가
- **3개 경로 전부 적용:** AI 한줄로(recommend-target) + AI 맞춤한줄(parse-briefing) + 타겟 수정 재조회(recount-target) + 실제 발송(campaigns.ts)

#### ✅ 대시보드 발송현황 총 사용금액에 테스트 비용 합산

**파일:** `customers.ts`
**원인:** 발송현황 통계가 campaign_runs + 직접발송만 집계, 담당자 테스트 + 스팸필터 테스트 비용 미포함
**수정:** 성공건수/성공률은 실발송만 유지, 총 사용금액에 MySQL 담당자 테스트(getTestSmsTables) + PostgreSQL 스팸필터(spam_filter_test_results) 비용 합산. try-catch 안전 처리.

#### 메트로시티 가상 고객 DB 2만건 생성

**출력:** `메트로시티_가상고객DB_20000건.xlsx`
**내용:** 전화번호 010-0001-0001~010-0002-0000, 메트로시티 매장 15개, 등급 6단계(VVIP~NORMAL), 수신동의 변형 포함, 스키마 필수 17필드 + 커스텀 3필드(선호스타일/최근방문일/구매횟수)

**⚠️ 배포 필요:** tp-push + tp-deploy-full

---

### 🔧 D67 — 080 콜백 진단 + 수신동의 변형 인식 + 사용자별 고객DB 삭제 (2026-03-12~) — ✅ 완료 (배포 완료)

> **배경:** 직원 080 수신거부 테스트 미동작 + DB 업로드 시 수신거부 자동등록 미작동 신고 + 슈퍼관리자 사용자별 고객DB 삭제 기능 요청.
> **원칙:** 하나씩 원인 파악 → 수정. 기간계 무접촉.

#### ✅ 080 나래인터넷 콜백 미동작 진단 완료

**현상:** sh_cpb 계정 080-540-5648로 전화 → 서버 콜백 미수신
**진단:**
- curl 직접 테스트 → 응답 `1` (서버 코드 정상, 080번호 매칭 성공)
- pm2 로그에 10:39 나래 콜백 기록 **0건** → 나래인터넷이 080-540-5648에 대해 콜백을 보내지 않음
- **원인:** 나래인터넷에 080-540-5648 번호의 콜백 URL 미등록. 080-719-6700(Harold님)은 등록되어 있어 정상 작동.
- **조치:** 나래인터넷에 080-540-5648 콜백 URL 등록 요청 필요 (`https://app.hanjul.ai/api/unsubscribes/080callback`)

#### ✅ 연동 테스트 버튼 stale state 버그 수정

**파일:** `packages/frontend/src/pages/Unsubscribes.tsx`
**원인:** `loadUnsubscribes()` 후 React state(비동기)를 바로 참조 → 항상 이전 값으로 체크
**수정:** `loadUnsubscribes()`가 최신 데이터를 return하도록 변경, `handleSyncTest()`에서 반환값으로 직접 체크

#### ✅ SMS_OPT_IN 변형 값 인식 확대

**파일:** `packages/backend/src/utils/normalize.ts`
**원인:** "비동의", "불동의", "미동의" 등이 인식 목록에 없어 null → 기본값 true(동의)로 저장됨
**수정:** SMS_OPT_IN_FALSE에 비동의/불동의/미동의/동의안함/거절/수신거절/해지/탈퇴/철회 추가, SMS_OPT_IN_TRUE에 수신 동의/동의함/수신동의함 추가

#### ✅ 슈퍼관리자 사용자별 고객 DB 삭제 기능

**파일:** `packages/backend/src/routes/admin.ts`, `packages/frontend/src/pages/AdminDashboard.tsx`
**기존:** customers 테이블에 `uploaded_by` 컬럼이 이미 존재하고 사용자 ID 저장 중
**추가:**
- 백엔드: 사용자 목록 조회에 `uploaded_customer_count` 추가 + `DELETE /api/admin/users/:id/customers` API (연관 purchases/consents 삭제 + 감사로그)
- 프론트: 사용자 수정 모달에 "업로드 고객 DB: N건 + 삭제 버튼" UI

**✅ 배포 완료**

#### ✅ 수정 완료-배포 완료: store_code/created_by 전수 격리

**배경:** Harold님이 사용자 ID(hoyun123, store_code=ONLINE)로 로그인 시 고객사관리자(hoyun)의 발송현황이 그대로 보이는 문제 발견.

**격리 원칙 (Harold님 확정):**
- **고객사관리자(company_admin):** company_id 전체 데이터 조회
- **사용자(company_user):** 고객 데이터는 store_code 기준, 발송 데이터는 created_by(본인 발송만)
- store_code 미배정 사용자: company_id 전체 (no_filter)

**수정 완료 파일 (TypeScript 0 에러):**
1. `routes/customers.ts` — 발송현황 카드에 created_by 격리 추가 (campaignStats, directStats)
2. `routes/companies.ts` — dashboard-cards 전체에 store_code + created_by 격리 (aggregateDashboardCards에 userId/userType 전달)
3. `routes/results.ts` — campaigns/:id 상세에 created_by 격리 추가

**⚠️ 배포 필요:** tp-push + tp-deploy-full 실행 대기 중

#### tp-deploy-full 백엔드 빌드 누락 해결

**문제:** tp-deploy-full이 프론트엔드만 빌드하고 백엔드 TypeScript 빌드(tsc)를 하지 않음 → 서버 dist/ 폴더에 이전 JS가 남아 코드 수정이 반영 안 됨 (080 버튼 미표시 원인)
**수정:** Harold님 PowerShell 프로필에 백엔드 빌드 단계 추가 — `cd packages/backend && npm run build`
**결과:** tp-deploy-full 실행 시 자동으로 백엔드도 빌드됨

#### D66 17차 실동작 검증 대기 (B17-01~B17-16)
- 16건 전건 수정+배포 완료 (2026-03-12)
- 15건 🟡수정완료-검증대기 (B17-08 배포 후 재확인, B17-13 코드이상없음 제외)
- 직원 재검증 결과 대기 중

---

### 🔧 D62 — 13차~15차 실동작 검증 버그 수정 (2026-03-09~03-10) — ✅ 15차 빌드+배포 완료 (2026-03-10 22:17), 실동작 검증 대기

> **배경:** 직원 전수 실동작 검증(30개 항목) + 한줄로 PPT 버그리포트(7슬라이드) 결과, 기존 버그 재발(Reopened) + 신규 버그(13차) 총 21건 확인.
> **범위:** 백엔드 8파일 + 프론트엔드 6파일. 기간계(발송 INSERT/차감/환불) 무접촉.
> **원칙:** 파일 1개씩 순차 수정 (병렬 에이전트 금지 — 파일 손상 교훈 반영)
> **결과:** FIX-GUIDE-D62.md 기반 11파일 수정 + 추가 수정(B8-13 성능최적화, B10-03 AI 매장맵핑, B13-03/04 AiPreviewModal 누락분, B13-06 특수문자 비호환 제거). TypeScript 0 에러. 전건 🟡수정완료-검증대기.
> **⚠️ 교훈:** B13-03/B13-04는 최초 수정 시 엉뚱한 파일(AiCampaignResultPopup.tsx)만 수정 — 실제 화면은 AiPreviewModal.tsx. Harold님 현장 확인으로 발견하여 재수정. **다음 세션에서 전건 전수점검 재실시 필수.**

#### 검증 결과 요약 (2026-03-09)
- **검증 항목:** 30개 (실동작검증-체크리스트_0309.xlsx)
- **통과(O):** 17개 → 해당 버그 ✅ Closed
- **실패(X):** 10개 → 코드 재수정 완료 → 🟡 수정완료-검증대기
- **미검증:** 3개
- **신규(PPT):** 9건 → B13-01 ~ B13-09 코드 수정 완료 → 🟡 수정완료-검증대기
- **추가 발견:** B8-13 대량 발송결과 성능 → 코드 수정 완료 → 🟡 수정완료-검증대기
- **현장 확인 재수정:** B13-03(개인화 미리보기), B13-04(스팸필터 "준비중"), B13-06(특수문자 비호환) — AiPreviewModal.tsx 누락 + 특수문자 팝업 비호환 문자 제거

#### ✅ 전수점검 결과 (2026-03-09)
- **22건 🟡수정완료-검증대기 전수점검**: 코드 직접 읽기 검증 (에이전트 위임 없이 직접 수행)
- **18건 코드 정상 확인** — 수정 코드가 관련 경로 전부에 일관 적용
- **3건 실제 미수정 발견 + 수정 완료:**
  - B14-01: 직접발송 수신거부 company_id→user_id 통일 (campaigns.ts L2088-2093)
  - B14-02: generateCustomMessages byte_count/byte_warning 누락 (ai.ts L1516-1528)
  - B14-04: sync-results 주석 60분→30분 수정 (campaigns.ts L1795)
- **1건 신규 발견 + 수정 완료:**
  - B14-03: 예약취소 시 campaign_runs 상태+fail_count 미변경 (campaigns.ts L2531-2552)
- **B12-02/B13-09 보완:** AI캠페인 타임아웃 60→30분 통일 (campaigns.ts L1791)

#### 🔧 15차 재수정 (2026-03-10) — 실동작검증 체크리스트 X 10건 메인코드 직접 반영
- **문제:** 기존 수정이 worktree에만 반영되고 메인코드에 미적용된 건들 발견
- **조치:** 10건 전부 메인코드(`packages/`)에 직접 반영 완료
  - B8-04: campaigns.ts — callback/useIndividualCallback INSERT 추가
  - B8-08: campaigns.ts — target_count 수신거부 NOT EXISTS + send u.user_id→u.company_id 4곳
  - B8-09: ai.ts — SMS 바이트 경고 (이미 메인코드 반영됨 확인)
  - B8-10: upload.ts/normalize.ts — 셀타입 처리 (이미 메인코드 반영됨 확인)
  - B8-13: campaigns.ts — sync-results company_id + 7일 제한, Dashboard.tsx fire-and-forget
  - B10-01: customers.ts/unsubscribes.ts — store_code 격리 (이미 메인코드 반영됨 확인)
  - B10-02: customers.ts — enabled-fields customer_schema 라벨 복구 + 자동보정 INSERT, upload.ts labels merge
  - B10-03: customers.ts — GET / SELECT에 registered_store, recent_purchase_store 등 누락 컬럼 추가
  - B10-04: normalize.ts — Integer 제약 제거 + Math.floor (이미 메인코드 반영됨 확인)
  - B10-06: ai.ts — generateMessages 프롬프트에 타겟 필터조건 주입 + ai route targetFilters 전달

#### ✅ 배포 완료 (2026-03-10 22:17)
- **tp-deploy-full 실행:** campaigns.ts (61줄 변경) + Dashboard.tsx (12줄 변경) 서버 반영 확인
- **서버 grep 검증:** useIndividualCallback 12곳, u.company_id 4곳, INTERVAL '7 days' 2곳, sync-results fire-and-forget — 전부 정상
- **PM2 재시작:** targetup-backend online 확인
- **프론트엔드 빌드:** vite 정상 빌드 (1837 modules, 15.4s)

#### ⚠️ 다음 단계 TODO
- **실동작 검증** — 30개 항목 전체 재검증 (특히 X 10건 집중 확인)
- 점검 시 **실제 화면에서 동작 확인** (코드 수정 파일이 아닌 사용자가 보는 화면 기준)

---

### 🔧 D63 — 16차 버그리포트 수정 + 메시징 컨트롤타워 리팩토링 (2026-03-10~) — 🟡 진행 중

> **배경:** 직원 PPT 버그리포트(한줄로_20260310.pptx, 7슬라이드) + Harold님 추가 리포팅. 15차 배포(22:17) 이전 오후 5시에 수신된 리포트이므로, 15차에서 수정한 건은 재검증 필요 (실패 단정 불가).
> **핵심 원칙:** 땜질식 수정 절대 금지. 컨트롤타워 기반으로 근본 원인 해결. 하나씩 원인 파악 → 수정안 브리핑 → Harold님 컨펌 → 작업.
> **에이전트 병렬 금지** — 하나씩 천천히 직접 읽고 정확하게.

#### ✅ 완료된 작업

**B16-01: 고객 DB 통합 문제 (브랜드 격리 체계)** — ✅ 배포 완료
- **근본 원인:** store_code 기반 브랜드 격리가 산재되어 있고, 브랜드 없는 단일 본사 고객사 케이스 미고려
- **수정:** `utils/store-scope.ts` 컨트롤타워 신규 생성
  - 3단계 판단: no_filter(브랜드 없음) / filtered(할당됨) / blocked(미할당)
  - customers.ts 7곳, campaigns.ts 3곳, ai.ts 3곳 총 13곳 일관 적용
  - buildDynamicFilter store_code 서브쿼리에 company_id 조건 추가
- **파일:** NEW utils/store-scope.ts, MOD customers.ts, campaigns.ts, ai.ts

**B16-02: 예약취소 불가 + 취소해도 실제 발송됨** — ✅ 배포 완료
- **근본 원인:** manage-scheduled.ts의 cancel이 PostgreSQL만 업데이트하고 **MySQL 큐를 전혀 건드리지 않음** → QTmsg Agent가 예약시간에 그대로 발송
- **수정:** 메시징 컨트롤타워 3개 모듈 생성 + 대규모 리팩토링
  - `utils/sms-queue.ts` — MySQL 큐 조작의 유일한 진입점 (campaigns.ts에서 20+ 함수 이동)
  - `utils/prepaid.ts` — 선불 차감/환불의 유일한 진입점
  - `utils/campaign-lifecycle.ts` — 캠페인 취소 + 결과 동기화 통합
  - campaigns.ts 3030줄 → 2340줄 (발송 인프라 유틸 분리)
  - manage-scheduled.ts → cancelCampaign() 컨트롤타워 호출로 교체 (MySQL 삭제 + 환불 + PG 상태 변경 전부 처리)
  - spam-filter.ts, results.ts, admin.ts → import 경로 utils/로 변경
- **파일:** NEW utils/sms-queue.ts, utils/prepaid.ts, utils/campaign-lifecycle.ts, MOD campaigns.ts, manage-scheduled.ts, spam-filter.ts, results.ts, admin.ts
- **기간계 영향:** 로직 변경 없음. 함수 위치만 이동 (동일 코드). manage-scheduled의 cancel만 MySQL 처리 추가 (버그 수정).
- **TypeScript:** 0 에러 확인

**추가 리포팅: 발송 완료인데 성공/실패 0/0** — ✅ 동일 수정으로 해결
- **원인:** sync-results 로직이 campaigns.ts 로컬 함수로 갇혀 있어 다른 곳에서 접근 불가
- **수정:** campaign-lifecycle.ts의 `syncCampaignResults()` 함수로 추출, campaigns.ts sync-results 라우트에서 호출

**CT-01: `utils/customer-filter.ts` — 고객 필터/쿼리 빌더 컨트롤타워** — ✅ 배포 완료
- campaigns.ts, customers.ts, ai.ts 3곳의 필터 빌딩 로직을 통합
- `buildCustomerFilter()` 단일 함수: mixed(ai.ts 방식) + structured(customers.ts 방식) 2가지 입력 포맷 지원
- 호환 래퍼: `buildFilterWhereClauseCompat()` (ai.ts용), `buildDynamicFilterCompat()` (customers.ts용)
- campaigns.ts의 `buildFilterQuery()`도 래퍼로 교체
- 내부에서 normalize.ts의 buildGenderFilter, buildGradeFilter, getRegionVariants 재사용
- **파일:** NEW utils/customer-filter.ts, MOD ai.ts, customers.ts, campaigns.ts

**B16-03: AI 맞춤한줄에 스팸필터/담당자테스트 추가** — ✅ 배포 완료
- AiCustomSendFlow.tsx Step 4에 담당자테스트 + 스팸필터 버튼 추가
- AI한줄로(AiCampaignResultPopup)의 기존 패턴 재사용: sampleCustomer로 변수 치환 후 테스트
- Dashboard.tsx에서 9개 props 전달 (setShowSpamFilter, handleTestSend, sampleCustomer 등)
- **파일:** MOD AiCustomSendFlow.tsx, Dashboard.tsx

**B16-04: EUC-KR 비호환 특수문자 제거** — ✅ 배포 완료
- Python EUC-KR 인코딩 테스트로 52개 특수문자 전수 확인
- 비호환 4개(♢, ♦, ✉, ☀) 제거 → 48개로 축소
- **파일:** MOD Dashboard.tsx

**B16-05: SMS 전환 후 MMS 이미지 잔존** — ✅ 배포 완료
- MMS 이미지 미리보기 조건: `directMsgType === 'MMS' || mmsUploadedImages.length > 0` → `directMsgType === 'MMS'`
- LmsConvert/SmsConvert 콜백에 `setMmsUploadedImages([])` 추가
- **파일:** MOD Dashboard.tsx, TargetSendModal.tsx

**B16-06: AI 타겟추출 age 필터 오류 (0명 반환)** — ✅ 배포 완료
- **근본 원인:** AI 경로(mixed 모드)는 `(currentYear - birth_year)` 계산, 직접타겟 경로(structured 모드)는 `age` 컬럼 직접 사용 → birth_year NULL이면 AI 경로 0명
- **수정:** CT-01 customer-filter.ts mixed 모드의 age 처리를 `age` 컬럼 직접 사용으로 통일 (BETWEEN, >=, <=)
- minAge/maxAge 기존 호환도 동일하게 변경
- **파일:** MOD utils/customer-filter.ts

**B16-07: 직접타겟 회신번호 선택 + 미등록 회신번호 제외** — ✅ 배포 완료
- **프론트엔드:** DirectTargetFilterModal에 회신번호 선택 드롭다운 추가 (기본/개별/특정번호)
  - 선택된 회신번호를 onExtracted 콜백으로 Dashboard에 전달
  - Dashboard에서 TargetSendModal의 selectedCallback/useIndividualCallback에 자동 반영
- **백엔드:** 미등록 회신번호 처리 변경 — 전체 발송 차단 → 해당 고객만 제외
  - `/:id/send` (AI 캠페인 발송): 미등록 회신번호 고객 제외 + callbackUnregisteredCount 응답 포함
  - `/direct-send` (직접발송): 동일 로직 적용 + validRecipients 별도 변수로 처리
  - 응답에 callbackMissingCount/callbackUnregisteredCount 구분 건수 포함
- **파일:** MOD DirectTargetFilterModal.tsx, Dashboard.tsx, campaigns.ts

#### 🔧 1순위: 추가 컨트롤타워 생성 (Harold님 컨펌 완료)

> **배경:** D63에서 sms-queue.ts, prepaid.ts, campaign-lifecycle.ts 3개 컨트롤타워를 만들어 campaigns.ts 3030줄→2340줄로 리팩토링한 결과, 예약취소 버그(B16-02)가 근본 해결됨. Harold님 피드백: "유틸파일을 기준으로 잡고 통일하는게 문제점 잡기엔 좋더라고". 동적치환 때 standard-field-map.ts로 통일한 것과 같은 패턴.
> **원칙:** 하나씩 생성 → Harold님 컨펌 → 적용. 기존 로직 변경 없이 위치만 이동(함수 추출). 기간계 무접촉.

**CT-01: `utils/customer-filter.ts` — 고객 필터/쿼리 빌더 컨트롤타워** — ✅ 완료 (위 완료 목록 참조)

**CT-02: `utils/permission-helper.ts` — 권한/스코프 헬퍼 컨트롤타워** — ⏳ 대기
- **문제:** `getCompanyScope()` 함수가 manage-scheduled.ts, manage-stats.ts, manage-callbacks.ts 등 **6개 이상 파일에 복붙**으로 존재. 슈퍼관리자/고객사관리자/일반사용자 분기 + 사용자 필터 + 매장 스코프 적용 로직이 8개 이상 라우트에서 각각 구현.
- **중복 패턴 3가지:**
  - (A) `getCompanyScope(req)` — super_admin이면 query에서, 아니면 토큰에서 companyId 추출. manage-stats.ts, manage-callbacks.ts, analysis.ts 등 6곳 동일 복붙
  - (B) 사용자 필터 — `company_user`면 `created_by = userId` 조건 추가, `company_admin`이면 `filter_user_id` 지원. campaigns.ts, results.ts, manage-stats.ts 등 8곳 유사 구현
  - (C) 매장 스코프 — `store-scope.ts`의 `getStoreScope()` 호출 후 WHERE 절 추가. campaigns.ts, customers.ts, ai.ts 등 5곳 유사 패턴
- **합치면:** 약 150줄 이상 중복 제거, 보안 일관성 확보
- **효과:** 권한 체크 누락 버그 방지 (하나 고치면 8곳 자동 반영). 특히 사용자 필터/매장 스코프 적용이 누락되는 보안 리스크 제거
- **설계:**
  ```typescript
  // utils/permission-helper.ts
  interface CompanyScope { companyId: string; isAdmin: boolean; isSuperAdmin: boolean; userId: string; }
  interface UserFilter { where: string; params: any[]; nextIndex: number; }
  function getCompanyScope(req: Request): CompanyScope
  function buildUserFilter(req: Request, startParamIndex: number): UserFilter
  function buildStoreFilter(req: Request, companyId: string, startParamIndex: number): Promise<FilterResult>
  ```
- **적용 파일:** manage-stats.ts, manage-callbacks.ts, analysis.ts, campaigns.ts, results.ts, customers.ts, ai.ts, unsubscribes.ts (8개)

**CT-03: `utils/unsubscribe-helper.ts` — 수신거부 관리 컨트롤타워** — ✅ 완료 (D64, 2026-03-11)
- **문제:** 수신거부 필터 SQL 패턴이 4곳에 산재 + 080 콜백이 companies 레벨에서만 매칭되어 사용자별 080번호 지원 불가
- **해결:** 기존 SQL 빌더 + 080 자동연동 + 슈퍼관리자 수신거부 관리 기능 통합
- **함수:**
  ```typescript
  // 기존 (CT-03 초기)
  buildUnsubscribeFilter(), buildUnsubscribeExistsFilter(), buildUnsubscribeCase()
  syncCustomerOptIn(), isUnsubscribed(), getUnsubscribedPhones()
  // 신규 (D64 080 확장)
  findUserBy080Number()    — users 우선 → companies fallback 매칭
  process080Callback()     — 080 콜백 처리 통합 (INSERT + sms_opt_in 동기화)
  getUserUnsubscribes()    — 슈퍼관리자용 사용자별 수신거부 조회
  deleteUserUnsubscribes() — 슈퍼관리자용 일괄삭제 + sms_opt_in 복구
  exportUserUnsubscribes() — CSV 다운로드용 전체 조회
  ```
- **적용 파일:** unsubscribes.ts(080콜백→컨트롤타워 위임), admin.ts(API 3개 신규), AdminDashboard.tsx(UI)

**CT-04: `utils/stats-aggregation.ts` — 통계 집계 컨트롤타워** — ⏳ 대기
- **문제:** manage-stats.ts와 results.ts에서 날짜 범위 필터링(KST 타임존 처리), 캠페인 성공/실패 집계 쿼리, 월별/일별 그루핑 로직이 거의 동일하게 중복
- **효과:** 통계 쿼리 변경 시 한 곳만 수정, KST 타임존 처리 일관성 확보
- **설계:**
  ```typescript
  // utils/stats-aggregation.ts
  interface DateRangeFilter { sql: string; params: any[]; nextIndex: number; }
  function buildDateRangeFilter(startDate?: string, endDate?: string, startParamIndex?: number): DateRangeFilter
  async function getCampaignSummary(companyId: string, options: StatsOptions): Promise<CampaignStats>
  ```
- **적용 파일:** manage-stats.ts, results.ts, analysis.ts

---

#### 🔧 2순위: 16차 버그리포트 수정 (Harold님 컨펌 완료, 하나씩 진행)

**B16-03 ~ B16-07:** ✅ 전부 수정 완료 (위 완료 목록 참조)

**개인화 미리보기 통일** — ✅ 완료 (D64, 2026-03-11)
- **수정:** AiCampaignResultPopup.tsx에서 sampleCustomer 치환 로직 제거
  - 추천 카드: `%고객명%` 변수 원본 그대로 표시
  - 미리보기(AiPreviewModal.tsx): 기존대로 샘플 데이터 치환 표시
- **수정 파일:** `components/AiCampaignResultPopup.tsx`

**080번호 사용자별 관리 + 수신거부 관리** — ✅ 완료 (D64, 2026-03-11)
- **수정:** 080 관리를 회사 단위 → 사용자 단위로 이전, CT-03 컨트롤타워에 통합
  - users 테이블에 `opt_out_080_number`, `opt_out_auto_sync` 컬럼 추가
  - 슈퍼관리자 사용자 편집 모달에 080 연동 설정/수신거부 관리 UI 추가
  - 나래인터넷 080 콜백: users 우선 → companies fallback 매칭
- **수정 파일:** `utils/unsubscribe-helper.ts`, `routes/unsubscribes.ts`, `routes/admin.ts`, `pages/AdminDashboard.tsx`

#### 추가 사항 (Harold님 언급)
- **DB삭제 사용자별** — 고객 DB 삭제를 사용자별로 권한 관리

#### 수정 파일 목록 (D63 전체)

**신규 생성 (유틸 컨트롤타워):**
- `utils/store-scope.ts` — 브랜드 격리 컨트롤타워 (B16-01)
- `utils/sms-queue.ts` — MySQL 큐 조작 컨트롤타워 (B16-02)
- `utils/prepaid.ts` — 선불 차감/환불 컨트롤타워 (B16-02)
- `utils/campaign-lifecycle.ts` — 캠페인 취소/결과동기화 컨트롤타워 (B16-02)
- `utils/customer-filter.ts` — 고객 필터/쿼리 빌더 컨트롤타워 (CT-01)

**백엔드 수정:**
- `routes/campaigns.ts` — B16-01(store-scope), B16-02(함수→import 교체), B16-07(미등록 회신번호 개별 제외)
- `routes/customers.ts` — B16-01(store-scope 7곳), CT-01(buildDynamicFilter 래퍼)
- `routes/ai.ts` — B16-01(store-scope 3곳), CT-01(buildFilterWhereClause 래퍼)
- `routes/manage-scheduled.ts` — B16-02(cancelCampaign 컨트롤타워 적용)
- `routes/spam-filter.ts` — B16-02(import 경로 변경)
- `routes/results.ts` — B16-02(import 경로 변경)
- `routes/admin.ts` — B16-02(import 경로 변경)

**프론트엔드 수정:**
- `components/AiCustomSendFlow.tsx` — B16-03(스팸필터/담당자테스트 추가)
- `components/DirectTargetFilterModal.tsx` — B16-07(회신번호 선택 드롭다운)
- `components/TargetSendModal.tsx` — B16-05(MMS 이미지 조건 수정)
- `pages/Dashboard.tsx` — B16-03(props 전달), B16-04(특수문자), B16-05(MMS 초기화), B16-07(회신번호 연동)

---

#### 수정 대상 버그 목록 (21건)

| 우선순위 | 버그ID | 제목 | 수정 파일 |
|:--------:|--------|------|-----------|
| 🔴🔴 | B13-07 | 수신거부 제외 오류 — 직접발송 시 수신거부자 포함 발송됨 | campaigns.ts, unsubscribes.ts |
| 🔴 | B13-05 | 금액필터 — 직접타겟 금액 조건 미작동 | campaigns.ts, DirectTargetFilterModal.tsx |
| 🔴 | B8-04 | AI 회신번호 — AI 발송 시 회신번호 '1234' 차단 안됨 | campaigns.ts |
| 🔴 | B10-01 | store_code 격리 — 다매장 고객 데이터 혼재 | customers.ts, unsubscribes.ts |
| 🔴 | B12-01 | 예약취소 — 예약 캠페인 취소 안됨 | campaigns.ts |
| 🔴 | B12-02 | 발송중 고착 — 결과 수신 후에도 '발송중' 유지 | campaigns.ts |
| 🔴 | B13-09 | 발송중 유지 — 직접발송 즉시도 '발송중' 고착 | campaigns.ts |
| 🟠 | B8-08 | 수신거부 건수 — 발송 성공 모달에 수신거부 건수 미표시 | campaigns.ts, Dashboard.tsx |
| 🟠 | B8-09 | SMS 바이트 경고 — AI 결과 SMS 90바이트 초과 시 경고 없음 | ai.ts, AiCampaignResultPopup.tsx |
| 🟠 | B8-10 | 엑셀 셀타입 — 숫자/날짜 셀 파싱 오류 | upload.ts, normalize.ts |
| 🟠 | B10-02 | 커스텀 필드 라벨 — 고객 상세 모달에서 커스텀 필드 라벨 누락 | CustomerDBModal.tsx |
| 🟠 | B10-03 | 매장필드 NULL — 엑셀 업로드 시 매장 필드 null 저장 | upload.ts |
| 🟠 | B10-04 | 날짜 시리얼 — 엑셀 날짜 셀이 숫자로 저장됨 | upload.ts, normalize.ts |
| 🟠 | B10-06 | 등급 프롬프트 — AI 프롬프트에 등급명 하드코딩 | ai.ts |
| 🟠 | B13-01 | 생일/나이 라벨 — 고객 상세 모달 나이 필드 라벨 미표시 | CustomerDBModal.tsx |
| 🟠 | B13-02 | 날짜 포맷 — 엑셀 날짜 YYYY-MM-DD 미변환 | upload.ts, normalize.ts |
| 🟠 | B13-03 | 미리보기 개인화 — AI 결과 미리보기에 %고객명% 치환 안됨 (**재수정**) | AiPreviewModal.tsx, AiCampaignResultPopup.tsx, Dashboard.tsx |
| 🟠 | B13-06 | 이모지 경고 + 특수문자 비호환 (**재수정**) | Dashboard.tsx, TargetSendModal.tsx |
| 🟠 | B13-08 | MMS→SMS 이미지 — MMS에서 SMS 전환 시 이미지 잔존 | TargetSendModal.tsx |
| 🟡 | B10-02 | 커스텀 필드 라벨 — fieldColumns 빈 배열 시 미표시 | CustomerDBModal.tsx |
| 🟡 | B13-04 | 스팸필터 "준비중" — 미리보기에서 스팸필터 미작동 (**재수정**) | AiPreviewModal.tsx, Dashboard.tsx |
| 🔴 | B8-13 | 대량 발송결과 성능 — 70~400만건 조회 시 로딩 불가 (**추가**) | ResultsModal.tsx, results.ts, defaults.ts |

#### 수정 대상 파일 (13개) — 전체 수정 완료 ✅

**백엔드 (8파일):**
1. `routes/campaigns.ts` — B13-07, B13-05, B8-04, B12-01, B12-02, B13-09, B8-08 ✅
2. `routes/customers.ts` — B10-01 (store_code 격리, 이미 적용 확인) ✅
3. `routes/unsubscribes.ts` — B10-01, B13-07 ✅
4. `routes/upload.ts` — B8-10, B10-03, B10-04, B13-02 ✅
5. `services/ai.ts` — B8-09, B10-06, B10-03(매장맵핑 분리) ✅
6. `utils/normalize.ts` — B8-10, B10-04, B13-02 ✅
7. `routes/results.ts` — B8-13 (Redis 캐시 + COUNT 최적화) ✅ **추가**
8. `config/defaults.ts` — B8-13 (CACHE_TTL 추가) ✅ **추가**

**프론트엔드 (6파일):**
9. `pages/Dashboard.tsx` — B8-08, B13-06(이모지+특수문자팝업), B13-03/B13-04(props전달) ✅ **재수정**
10. `components/AiCampaignResultPopup.tsx` — B8-09, B13-03(별칭매핑추가) ✅ **재수정**
11. `components/AiPreviewModal.tsx` — B13-03(개인화치환), B13-04(스팸필터연동) ✅ **신규 추가**
12. `components/TargetSendModal.tsx` — B13-08, B13-06 ✅
13. `components/CustomerDBModal.tsx` — B13-01, B10-02 ✅
14. `components/DirectTargetFilterModal.tsx` — B13-05 ✅
15. `components/ResultsModal.tsx` — B8-13 (sync-results fire-and-forget) ✅

**기간계 무접촉:** 발송 INSERT/차감/환불/인증 로직 일절 미수정.

---

### 🔧 D66 — 17차 실동작 검증 + PPT 버그리포트 수정 (2026-03-11~03-12) — ✅ 수정+배포 완료, 실동작 검증 대기

> **배경:** 직원 전수 실동작 검증(체크리스트 30개 항목, 0311) + PPT 버그리포트(9슬라이드) 결과 종합 분석.
> **검증 결과:** O(통과) 15건, X(실패) 8건, ▲(부분통과) 4건, 미검증 3건. PPT 신규 포함 총 16건 수정 대상.
> **원칙:** 하나씩 코드 직접 읽고 근본 원인 파악 → Harold님 컨펌 → 수정. 병렬 에이전트 금지.
> **기간계 무접촉:** 발송 INSERT/차감/환불 로직 직접 수정 금지.
> **결과:** B17-01~B17-07(이전 세션), B17-09~B17-16(이번 세션) 수정 완료 + 080 admin 자동동기화 추가. TypeScript 0 에러. 배포 완료(2026-03-12).

#### 체크리스트 결과 요약 (2026-03-11)

| 결과 | 건수 | 항목 |
|------|------|------|
| O (통과) | 15건 | B8-01,02,05,06,11,13, S9-04,08, B10-01,05,06,07, B11-01,03,04 |
| X (실패) | 8건 | B8-04,08,09,10,12, B10-02, B10-04, D39 |
| ▲ (부분) | 4건 | B8-03,07, B10-03, B11-02 |
| 미검증 | 3건 | B11-05, Phase2, B8-13b |

#### 수정 대상 버그 목록 (16건 — 우선순위순)

| # | 버그ID | 심각도 | 제목 | 상태 |
|---|--------|--------|------|------|
| 1 | B17-01 | 🔴🔴 | 직접발송 수신거부 제외가 발송에 미반영 (추출은 정상, 전송 시 전체 발송) | 🟡 수정완료-검증대기 |
| 2 | B17-02 | 🔴🔴 | 예약취소 완전 불가 — 캘린더/예약대기/발송결과 3곳 취소 안 됨 + 취소해도 발송됨 | 🟡 수정완료-검증대기 |
| 3 | B17-03 | 🔴 | AI한줄로/맞춤한줄 발송 시 "서버 오류" — AI 경로 전체 발송 불가 | 🟡 수정완료-검증대기 |
| 4 | B17-04 | 🔴 | AI 선택 문안 ≠ 실제 발송 — 두번째 발송 시 첫번째 문안 중복 | 🟡 수정완료-검증대기 |
| 5 | B17-05 | 🟠 | AI 맞춤한줄 스팸테스트 개인화 공백 (간헐적) | 🟡 수정완료-검증대기 |
| 6 | B17-06 | 🟠 | 직접타겟 누적금액/포인트 필터 미작동 — 전체 고객 추출됨 | 🟡 수정완료-검증대기 |
| 7 | B17-07 | 🟠 | MMS 비용절감 모달 후 LMS유지/SMS전환 눌러도 발송 불가 | 🟡 수정완료-검증대기 |
| 8 | B17-08 | 🟠 | 직접타겟 회신번호 리스트 로딩 안 됨 + 자동입력 변수 "고객명"만 표시 | 🟡 배포 후 재확인 |
| 9 | B17-09 | 🟠 | 엑셀 날짜 ISO/영문 표시 (B8-10/B10-04 재발) | 🟡 수정완료-검증대기 |
| 10 | B17-10 | 🟠 | AI한줄로 SMS 바이트 초과 시 LMS 전환 안내 없이 발송 가능 | 🟡 수정완료-검증대기 |
| 11 | B17-11 | 🟠 | 080 수신거부 자동연동 미동작 (슈퍼관리자 설정 후 0건) | 🟡 수정완료-검증대기 |
| 12 | B17-12 | 🟠 | AI맞춤한줄 담당자테스트 버튼 불안정 (실행됐다 안 됐다) | 🟡 수정완료-검증대기 |
| 13 | B17-13 | 🟡 | 커스텀 필드 라벨 여전히 "커스텀1,2" 표시 (B10-02 재발) | 🟡 코드 이상 없음-재업로드 시 해결 |
| 14 | B17-14 | 🟡 | 필터 UI — 대량 값 시 선택창 무한 + 매장번호/지역 미노출 (D39) | 🟡 수정완료-검증대기 |
| 15 | B17-15 | 🟡 | Toast 알림 리셋 안 됨 — 새로고침 전까지 남아있음 (B11-02) | 🟡 수정완료-검증대기 |
| 16 | B17-16 | 🟡 | DB 현황에서 AI 매핑 필드(등록매장 등) 미표시 (B10-03) | 🟡 수정완료-검증대기 |

#### 관련 이전 버그 매핑

| 17차 | 관련 이전 버그 | 비고 |
|------|--------------|------|
| B17-01 | B13-07, B14-01 | 수신거부 필터가 추출만 반영, 발송 INSERT에 미반영 |
| B17-02 | B12-01 | campaign-lifecycle.ts 배포 안 됐거나 manage-scheduled 미적용 |
| B17-03 | B8-04, B8-08 | AI 경로 공통 서버 오류 — 근본 원인 별도 분석 필요 |
| B17-04 | B8-12 | AI 캠페인 선택 문안 state 관리 문제 |
| B17-05 | B8-03 | 간헐적 = 비동기/타이밍 문제 가능성 |
| B17-06 | B13-05 | CT-01 customer-filter 배포 여부 확인 필요 |
| B17-07 | B16-05, B13-08 | MMS 전환 모달 콜백 문제 |
| B17-09 | B8-10, B10-04 | normalize.ts 날짜 처리 재발 |
| B17-11 | 신규 | CT-03 unsubscribe-helper 080 연동 배포 여부 확인 |
| B17-13 | B10-02 | customer_schema 라벨 복구 로직 미동작 |

#### 수정 내역 상세 (2026-03-11~03-12, 2세션)

**세션1 (D66 전반 — B17-01~B17-07):**
- B17-01: unsubscribes 10파일 user_id 통일 (campaigns.ts, customers.ts, ai.ts 등)
- B17-04: AI 캠페인 state 초기화 (Dashboard.tsx aiResult/selectedAiMsgIdx 리셋)
- B17-06: customer-filter.ts 숫자 필드 연산자 처리 수정
- B17-07: MMS 비용절감 모달 콜백 루프 수정 (SendConfirmModal.tsx)

**세션2 (D66 후반 — B17-09~B17-16 + 080 admin 동기화):**
- B17-09: upload.ts, sync.ts — XLSX Date 객체 normalizeDateValue() 처리
- B17-10: AiCampaignResultPopup.tsx — 캠페인확정 시 SMS 바이트 체크 + LMS 전환 confirm
- B17-11: 080 수신거부 — 7개 파일 users 우선→companies fallback 패턴 적용 (unsubscribes.ts, campaigns.ts×3, ai.ts×3, companies.ts)
- B17-12: AiCustomSendFlow.tsx — 자체 handleCustomTestSend 함수 생성 (variants 기반)
- B17-13: 코드 이상 없음 — customer_field_definitions 정상, 데이터 재업로드 시 해결
- B17-14: DirectTargetFilterModal.tsx — 15개 초과 시 검색+스크롤 영역
- B17-15: Dashboard.tsx — useEffect 4초 자동 해제 + 닫기 버튼
- B17-16: companies.ts — store_name(미존재)→COALESCE(registered_store, recent_purchase_store), opt_outs→unsubscribes

**추가 개선 (080 admin 자동동기화):**
- unsubscribe-helper.ts process080Callback() — 080 콜백 시 같은 회사의 admin user에게도 자동 INSERT (source='080_ars_sync')
- 매칭된 user INSERT 후 → 같은 company의 user_type='admin' 조회 → 미포함 admin에게 INSERT

#### 수정 파일 전체 목록 (D66 세션2)
- `utils/unsubscribe-helper.ts` — 080 admin 자동동기화
- `routes/unsubscribes.ts` — B17-11 users 우선 조회
- `routes/campaigns.ts` — B17-11 AI발송/직접발송/예약발송 3곳
- `routes/ai.ts` — B17-11 generate-message/recommend/generate-custom 3곳
- `routes/companies.ts` — B17-11 settings reject_number override + B17-16 store_name/opt_outs 수정
- `routes/upload.ts` — B17-09 Date 객체 처리
- `routes/sync.ts` — B17-09 Date 객체 처리
- `components/AiCampaignResultPopup.tsx` — B17-10 SMS 바이트 체크
- `components/AiCustomSendFlow.tsx` — B17-12 자체 테스트 핸들러
- `components/DirectTargetFilterModal.tsx` — B17-14 검색+스크롤
- `pages/Dashboard.tsx` — B17-15 Toast 자동해제

#### 배포 후 재확인 필요
- B17-08: 콜백 목록 (이전 세션 배포 분)
- B17-11: 080 실제 콜백 동작 (나래인터넷 → sh_cpb/sh_sh 테스트)
- B17-13: 커스텀 필드 라벨 (데이터 재업로드 후)

---

### ✅ D65 — sync-results 결과동기화 Blocker 수정 (2026-03-11) — 완료, 배포 완료

> **배경:** 발송 완료된 캠페인이 영구적으로 "발송중" + 성공/실패 0/0으로 고착. 결과 화면이 전혀 업데이트되지 않는 Blocker 버그.
> **진단 방법:** 서버 로그(pm2 logs) 기반 근본 원인 추적.

#### 발견된 근본 원인 3가지

1. **kakaoAgg() 미존재 테이블 throw** — MySQL에 `IMC_BM_FREE_BIZ_MSG` 테이블이 없는 상태에서 `kakaoAgg()`를 호출하면 에러 throw → `syncCampaignResults()` 함수 전체 중단 → SMS 결과 집계가 정상이어도 DB 업데이트까지 도달하지 못함
2. **PostgreSQL $3 타입 추론 실패** — UPDATE 쿼리에서 `status = $3`과 `CASE WHEN $3 = 'completed'`에 동일 파라미터 사용 → PostgreSQL이 `inconsistent types deduced for parameter $3` 에러
3. **캠페인별 에러 격리 없음** — for 루프에 try/catch가 없어 1건의 에러가 나머지 전체 캠페인 동기화를 중단

#### 수정 내용 (campaign-lifecycle.ts)

- `kakaoAgg()` 호출을 try/catch로 감싸 테이블 미존재 시 `{total:0, success:0, fail:0, pending:0}` 반환 (AI + 직접발송 2곳)
- UPDATE 쿼리 `$3` → `$3::text` 명시 캐스팅 (campaign_runs AI, campaigns AI, campaigns 직접발송, campaign_runs 직접발송 — 4곳)
- AI캠페인 / 직접발송 for 루프에 캠페인별 try/catch 추가 (2곳)
- 디버그 로그 추가: tables, created_by, success/fail/pending 카운트

#### 수정 파일 (sync-results)
- `utils/campaign-lifecycle.ts` — syncCampaignResults 함수

#### 추가 수정: 발송 내역 0건 표시 (B15-01)

**근본 원인:** mysql2의 `conn.execute()`(prepared statement)가 UNION ALL + 다수 `?` 파라미터 바인딩에서 `Incorrect arguments to mysqld_stmt_execute` 에러 발생 (mysql2 known issue). LIVE 테이블 fallback도 동일 실패.

**수정:**
- `config/database.ts` — `mysqlQuery` 함수의 `conn.execute()` → `conn.query()` 변경. `query()`는 문자열 이스케이프 방식이라 UNION ALL 문제 없음. `?` 파라미터 바인딩 동일 지원.
- `routes/results.ts` — SMS 서브쿼리의 `NULL AS kakao_*` → `'' AS kakao_*` 변경 (메인+fallback 2곳)

#### 추가 수정: 캠페인 상세 메시지 미리보기 overflow (B15-02)

**수정:** `ResultsModal.tsx` — 메시지 말풍선에 `break-all overflow-hidden` 추가. 긴 특수문자가 폰 프레임 밖으로 넘치던 문제 해결.

#### 추가 수정: 발송시간 UTC→KST 변환

**근본 원인:** QTmsg Agent가 `mobsend_time`, `repmsg_recvtm`을 UTC로 기록. `sendreq_time`은 앱에서 MySQL NOW()(KST)로 INSERT하므로 정상이나, QTmsg가 기록하는 발송시간/결과수신시간은 9시간 느리게 표시.

**수정:** `routes/results.ts` — messages/fallback/export 3곳에 `DATE_ADD(mobsend_time, INTERVAL 9 HOUR)`, `DATE_ADD(repmsg_recvtm, INTERVAL 9 HOUR)` 적용.

#### 추가 수정: 캠페인 상세 엉뚱한 메시지 표시 + 회신번호 공란 (B15-03)

**근본 원인:**
1. `ResultsModal.tsx` — "상세" 클릭 시 이전 캠페인의 `messages` state가 초기화되지 않아 `messages[0]?.msg_contents`가 이전 캠페인 내용을 표시
2. `results.ts` — 캠페인 목록 SELECT에 `callback_number` 컬럼 누락 → 프론트에서 항상 `-` 표시

**수정:**
- `ResultsModal.tsx` — 상세 클릭 시 `setMessages([])`, `setShowSendDetail(false)` 호출 추가
- `results.ts` — 캠페인 목록 SELECT에 `c.callback_number` 추가

#### 수정 파일 전체 목록 (D65)
- `utils/campaign-lifecycle.ts` — syncCampaignResults: kakao try/catch, $3::text 캐스팅, 캠페인별 try/catch
- `config/database.ts` — mysqlQuery: conn.execute() → conn.query()
- `routes/results.ts` — NULL→'' 변경, callback_number 추가, mobsend_time KST 변환
- `components/ResultsModal.tsx` — messages 초기화, 미리보기 overflow 수정

#### 관련 버그 Closed
- **B12-02** (발송결과 "발송중" 영구 고착) → ✅ Closed
- **B13-09** (결과 수신 후에도 미변경) → ✅ Closed
- **B15-01** (발송 내역 0건 표시) → ✅ Closed (신규)
- **B15-02** (미리보기 overflow + 발송시간 UTC) → ✅ Closed (신규)
- **B15-03** (상세 엉뚱한 메시지 + 회신번호 공란) → ✅ Closed (신규)

#### 기간계 영향: 없음
발송 INSERT/차감/환불 무접촉. 결과 동기화 + 조회 로직만 수정.

---

### ✅ D61 — 프론트엔드 난독화 적용 (2026-03-08) — 완료

> **배경:** 상용화 전 소스 코드 보호. STATUS.md 런칭 체크리스트 항목.
> **범위:** frontend + company-frontend 양쪽 vite.config.ts
> **결과:** `vite-plugin-javascript-obfuscator` 적용. production 빌드 시에만 활성화. stringArray+base64 인코딩, disableConsoleOutput, identifierNamesGenerator 등. 개발 환경 무영향.
> **배포:** 서버에서 `npm install` → `npm run build` 시 자동 적용

### ✅ D60 — SyncAgent API Key 관리 + 사용자별 라인그룹 배정 (2026-03-08) — 완료

> **배경:** (1) 상용화 시 고객사 온보딩마다 DB 직접 접근 불가 → 슈퍼관리자 UI 필요 (2) 동일 회사 내 사용자간 발송 라인 공유 → 대량발송 시 다른 사용자 홀딩 문제
> **범위:** 백엔드(admin.ts, campaigns.ts) + 프론트엔드(AdminDashboard.tsx) + DB DDL(users.line_group_id)
> **결과:**
> - SyncAgent: 고객사 편집 모달 9번째 탭 추가 — API Key/Secret 조회·재발급·비활성화, use_db_sync 토글. 3개 엔드포인트 신규.
> - 라인그룹: users 테이블에 line_group_id 추가(nullable). 발송 시 사용자 개별 라인그룹 우선, 없으면 회사 fallback. 슈퍼관리자 사용자 편집 모달에 라인그룹 드롭다운 추가. 고객사 관리자 접근 불가.
> - 고객사 편집 모달 너비/탭 UI 개선 (max-w-lg → max-w-2xl, 탭 라벨 줄바꿈 방지)
> **기간계 영향:** campaigns.ts getCompanySmsTables에 userId optional 파라미터 추가 (기존 호출 100% 호환)
> **DDL:** `ALTER TABLE users ADD COLUMN IF NOT EXISTS line_group_id uuid REFERENCES sms_line_groups(id) ON DELETE SET NULL` — 실행 완료 (2026-03-08)
> **tsc:** backend + frontend 모두 통과

### ✅ D59 — 2차 코드 전수점검 (2026-03-07) — 완료

> **배경:** 상용화 전 전체 코드 레벨 정밀 감사. 1차 점검(03-05 교통정리) 이후 코드 실물 기반 전수점검.
> **범위:** 전체 백엔드(routes, services, config, utils) + 전체 프론트엔드(pages, components) + company-frontend
> **결과:** P1~P6 총 28건 수정 완료, P7 장기 8건 백로그 기록. 기간계 무접촉. tsc 3패키지 통과.
> **상세:** `status/교통정리-전수점검-20260305.md` 섹션 11~14 참조 + `status/CODE-REVIEW-P7-BACKLOG.md`

---

### 🔧 D53 — 요금제별 기능 게이팅 구현 (2026-03-04~)

> **배경:** 상용화 직전, 레거시 웹 업체를 무료요금제로 강제이관 후 유료 전환 유도 전략. 기존 plans 테이블에 5단계 요금제 존재하나, 기능별 잠금이 AI 분석(`ai_analysis_level`)과 고객DB 한도(`max_customers`)에만 적용됨. 스팸필터·AI메시징·고객DB/타겟팅 등 핵심 기능에 요금제별 게이팅이 필요.
> **목표:** 요금제별로 기능 접근을 제어하여 무료→스타터→베이직 단계별 업셀 구조 완성.
> **원칙:** 기간계(발송/DB/인증) 무접촉. plans 테이블 컬럼 추가 + 백엔드 미들웨어 + 프론트 UI 잠금.

#### 요금제별 기능 매트릭스 (Harold님 확정 2026-03-04)

| 기능 | 무료(체험후) | 스타터(15만) | 베이직(35만) | 프로 | 비즈니스 |
|------|:-----------:|:-----------:|:-----------:|:----:|:--------:|
| 직접발송 (상단메뉴) | O | O | O | O | O |
| 발송결과 (상단메뉴) | O | O | O | O | O |
| 수신거부 (상단메뉴) | O | O | O | O | O |
| 설정 (상단메뉴) | O | O | O | O | O |
| 고객 DB 업로드 | X | O | O | O | O |
| 직접 타겟 발송 | X | O | O | O | O |
| 스팸필터 테스트 | X | O | O | O | O |
| 캘린더 | X | O | O | O | O |
| AI 추천 발송 (한줄로/맞춤한줄) | X | X | O | O | O |
| AI 분석 | X | X | X | basic | advanced |

#### 안건 목록

| # | 안건 | 성격 | 난이도 | 상태 |
|---|------|------|--------|------|
| 1 | plans 테이블 컬럼 추가 — `spam_filter_enabled`, `ai_messaging_enabled`, `customer_db_enabled` | DB/DDL | 낮음 | ✅ 완료 (DB 실행 완료 2026-03-05) |
| 2 | plans 테이블 데이터 업데이트 — 5개 요금제별 플래그값 설정 | DB/DML | 낮음 | ✅ 완료 (DB 실행 완료 2026-03-05) |
| 3 | 백엔드: /api/companies/my-plan 응답에 새 플래그 포함 | 백엔드 | 낮음 | ✅ 완료 |
| 4 | 백엔드: 스팸필터 API 게이팅 — spam-filter.ts에서 `spam_filter_enabled` 체크 | 백엔드 | 낮음 | ✅ 완료 |
| 5 | 백엔드: AI 발송 API 게이팅 — ai.ts에서 `ai_messaging_enabled` 체크 (recommend-target, parse-briefing, generate-custom) | 백엔드 | 낮음 | ✅ 완료 |
| 6 | 백엔드: 고객DB/타겟팅 API 게이팅 — upload.ts(parse/save)/customers.ts(extract)에서 `customer_db_enabled` 체크 | 백엔드 | 낮음 | ✅ 완료 |
| 7 | 프론트: Dashboard.tsx — PlanInfo 인터페이스 확장 + 3개 카드 잠금 UI (🔒 + opacity) | 프론트 | 중간 | ✅ 완료 |
| 8 | 프론트: 상단메뉴 게이팅 — 캘린더 메뉴 customer_db_enabled 체크 + 🔒 표시 | 프론트 | 낮음 | ✅ 완료 |
| 9 | 프론트: 업그레이드 유도 모달 — PlanUpgradeModal 범용화 (featureName/requiredPlan props) + SpamFilterLockModal 텍스트 수정 | 프론트 | 중간 | ✅ 완료 |
| 10 | 검증: DB 실행 완료 + 실서버 테스트 대기 | 검증 | 중간 | ✅ DB실행완료 (2026-03-05 plans 3컬럼 ALTER+UPDATE 6건 정상) |

#### 상세 구현 계획

**안건 #1-2: DB 변경**
```sql
-- plans 테이블 컬럼 추가
ALTER TABLE plans ADD COLUMN customer_db_enabled boolean DEFAULT false;
ALTER TABLE plans ADD COLUMN spam_filter_enabled boolean DEFAULT false;
ALTER TABLE plans ADD COLUMN ai_messaging_enabled boolean DEFAULT false;

-- 요금제별 플래그 설정
UPDATE plans SET customer_db_enabled = false, spam_filter_enabled = false, ai_messaging_enabled = false WHERE plan_code = 'FREE';
UPDATE plans SET customer_db_enabled = true,  spam_filter_enabled = true,  ai_messaging_enabled = false WHERE plan_code = 'STARTER';
UPDATE plans SET customer_db_enabled = true,  spam_filter_enabled = true,  ai_messaging_enabled = true  WHERE plan_code = 'BASIC';
UPDATE plans SET customer_db_enabled = true,  spam_filter_enabled = true,  ai_messaging_enabled = true  WHERE plan_code = 'PRO';
UPDATE plans SET customer_db_enabled = true,  spam_filter_enabled = true,  ai_messaging_enabled = true  WHERE plan_code = 'BUSINESS';
```

**안건 #3: 백엔드 my-plan 응답 확장**
- 파일: `companies.ts` GET `/my-plan`
- 기존 `ai_analysis_level` 외에 `customer_db_enabled`, `spam_filter_enabled`, `ai_messaging_enabled` 추가
- PlanInfo 인터페이스에 3개 boolean 필드 추가

**안건 #4: 스팸필터 게이팅**
- 파일: `spam-filter.ts` POST `/test`
- 발송 전 company의 plan → `spam_filter_enabled` 체크
- false면 403 + `{ error: '스팸필터 테스트는 스타터 이상 요금제에서 이용 가능합니다', code: 'PLAN_FEATURE_LOCKED' }`
- 기존 SpamFilterLockModal.tsx가 이미 존재 (monthly_price >= 150,000 체크) → plan 필드 기반으로 전환

**안건 #5: AI 발송 게이팅**
- 파일: `routes/ai.ts` POST `/recommend-target` (AI 한줄로), POST `/custom-send` (AI 맞춤한줄)
- 파일: `campaigns.ts` POST `/ai-send`
- company의 plan → `ai_messaging_enabled` 체크
- false면 403 + `{ error: 'AI 추천 발송은 베이직 이상 요금제에서 이용 가능합니다', code: 'PLAN_FEATURE_LOCKED' }`

**안건 #6: 고객DB/타겟팅 게이팅**
- 파일: `upload.ts` POST `/validate`, POST `/save`
- 파일: `customers.ts` POST `/extract` (타겟 추출)
- company의 plan → `customer_db_enabled` 체크
- false면 403 + `{ error: '고객 DB 관리는 스타터 이상 요금제에서 이용 가능합니다', code: 'PLAN_FEATURE_LOCKED' }`

**안건 #7: 대시보드 카드 잠금**
- 파일: `Dashboard.tsx`
- PlanInfo 인터페이스에 새 필드 추가
- 3개 메인 카드(AI 추천 발송, 직접 타겟 발송, 고객 DB 업로드)에 잠금 오버레이:
  - `ai_messaging_enabled = false` → AI 추천 발송 카드에 🔒 + "베이직 이상"
  - `customer_db_enabled = false` → 직접 타겟 발송 카드, 고객 DB 업로드 카드에 🔒 + "스타터 이상"
- 클릭 시 업그레이드 유도 모달 표시 (기존 PlanUpgradeModal 활용/확장)

**안건 #8: 상단메뉴 게이팅**
- 파일: `DashboardHeader.tsx`
- AI 분석 메뉴: `ai_analysis_level === 'none'`이면 클릭 시 업그레이드 모달 (기존 로직 유지)
- 캘린더 메뉴: `customer_db_enabled = false`면 클릭 시 업그레이드 모달

**안건 #9: 업그레이드 유도 모달**
- 기존 PlanUpgradeModal.tsx 확장 또는 범용화
- props: `requiredPlan` ('STARTER' | 'BASIC' | 'PRO') + `featureName` (잠긴 기능명)
- "이 기능은 {requiredPlan} 이상 요금제에서 이용 가능합니다" + [요금제 안내] 버튼 → /pricing

#### 수정 대상 파일 목록

**백엔드 (5파일):**
1. `routes/companies.ts` — my-plan 응답 확장
2. `routes/spam-filter.ts` — spam_filter_enabled 게이팅
3. `routes/ai.ts` — ai_messaging_enabled 게이팅
4. `routes/campaigns.ts` — ai-send ai_messaging_enabled 게이팅
5. `routes/upload.ts` — customer_db_enabled 게이팅
6. `routes/customers.ts` — extract customer_db_enabled 게이팅

**프론트엔드 (4~5파일):**
1. `pages/Dashboard.tsx` — PlanInfo 인터페이스 + 카드 잠금 UI
2. `components/DashboardHeader.tsx` — 메뉴 게이팅
3. `components/PlanUpgradeModal.tsx` — 범용 업그레이드 모달 확장
4. `components/SpamFilterLockModal.tsx` — plan 필드 기반 전환 (기존 price 기반→boolean 기반)
5. `components/DirectTargetFilterModal.tsx` — customer_db_enabled 체크 (선택적)

**기간계 무접촉:** 발송 파이프라인(campaigns.ts send/direct-send), 차감/환불(billing.ts), 인증(auth.ts), DB(database.ts) 전부 미수정.

---

### 🔧 D43 — 기능 정상화 및 DB 동적 기준 정립 (2026-02-27~) — ✅ 전체 완료

> **배경:** D39 표준 필드 아키텍처 확립 후 아직 반영되지 않은 부분들이 존재. 기존 발송 파이프라인의 발송 흐름/차감/환불 로직은 절대 건드리지 않음 (D43-7에서 결과값 해석 로직만 sms-result-map.ts 중앙화 전환).
> **목표:** DB 기준에 맞게 기능을 정상화하고, 동적 데이터 흐름을 확립한다.
> **원칙:** 스키마 벗어나는 하드코딩 금지. 의논 → 검증 → 실행.

#### 안건 목록

| # | 안건 | 성격 | 난이도 | 상태 |
|---|------|------|--------|------|
| 1 | 대시보드 회사명 — 슈퍼관리자 수정이 반영 안 됨 | 버그 | 낮음 | ✅ 완료 |
| 2 | AI 매핑 화면 개편 — 표준 17개 명확 나열 + 커스텀 필드 라벨 지정 | 기능개편 | 중간 | ✅ 완료 |
| 3 | 직접 타겟 설정 — enabled-fields 기반 동적 필터 조건 | 기능개발 | 중간 | ✅ 완료 |
| 4 | 수신거부 양방향 동기화 (독립 관리 vs DB 연동) | 설계+구현 | 높음 | ✅ 완료 (나래 080 콜백 연동 완료 2026-03-05) |
| 5 | AI 한줄로 입력 포맷 강제화 + 샘플 고객 미리보기 + 이모지 제거 | 기능개선 | 중간 | ✅ 완료 |
| 6 | 🚨 긴급: 스팸필터 테스트 안됨 (원인: MySQL 랜섬웨어) | 인프라/보안 | 높음 | ✅ 완료 |
| 7 | 결과값 매핑 중앙화 — sms-result-map.ts 컨트롤타워 | 구조개선 | 높음 | ✅ 완료 (3-Tier 전수 점검) |

#### 안건 #1: 대시보드 회사명 미반영 — ✅ 완료

- **증상:** 슈퍼관리자에서 회사명 → "테스트계정" 수정 완료했으나, 대시보드 좌측 상단에 "디버깅테스트" 표시
- **원인:** 이중 문제 — ① auth.ts가 `c.name`(구 컬럼) 조회, 슈퍼관리자는 `company_name` 수정 → 컬럼 불일치 ② authStore가 로그인 시점 localStorage 캐시 사용
- **해결 (D43-1, 2026-02-27):**
  - auth.ts: 로그인 쿼리 `c.name` → `c.company_name` 통일
  - companies.ts: GET /settings에 `company_name` 추가, PUT /:id에서 `name`도 동기 수정
  - Dashboard.tsx: `companyNameFromDB` state 추가 → loadCompanySettings에서 DB 실시간 조회값 우선 표시
- **수정 파일 3개:** auth.ts, companies.ts, Dashboard.tsx

#### 안건 #2: AI 매핑 결과 화면 개편 — ✅ 완료

- **증상:** 드롭다운 16개 하드코딩(레거시 컬럼 포함), 표준 17개 기준 불명확, 커스텀 필드 배정 불가, 공간 낭비
- **해결 (D43-2, 2026-02-27):**
  - **컴포넌트 분리:** Dashboard.tsx에서 파일 업로드+매핑 모달 310줄 분리 → FileUploadMappingModal.tsx 신규 (5,239줄→4,948줄)
  - **매핑 UI 개편:** 하드코딩 드롭다운 → FIELD_MAP 기반 동적 표준 20개(필수17+파생3), 카테고리별 그룹, 2열 컴팩트 그리드, 태그 클릭 방식(미배정 컬럼 팝업), 중복 배정 자동 방지
  - **커스텀 필드:** +/- 방식으로 슬롯 추가(최대 15개), 라벨명 직접 입력, AI 배정분 자동 초기 표시
  - **백엔드:** upload.ts `/mapping` 응답에 standardFields+categoryLabels 추가, `/save`에 customLabels 지원 → customer_field_definitions 라벨 저장
  - **팝업 overflow 수정:** absolute→fixed 포지션, 클릭 위치 기반 좌표 계산, 하단 공간 부족 시 위로 자동 조정
- **수정 파일 3개:** upload.ts, Dashboard.tsx, FileUploadMappingModal.tsx(신규)

#### 안건 #3: 직접 타겟 설정 동적 필터 — ✅ 완료

- **작업 완료 (D43-3, 2026-02-27):**
  - **컴포넌트 분리:** Dashboard.tsx에서 직접타겟 모달 265줄 분리 → DirectTargetFilterModal.tsx 신규 (4,952줄→4,547줄)
  - **모달 전면 리팩토링:**
    - SKIP_FIELDS 제거 → **전체 필드 노출** (Harold님 확정: 사용자가 선택하게)
    - 2열 컴팩트 그리드 (체크+조건 인라인)
    - 연령: 다중 체크(20대+30대) + 직접 범위 입력(25~35세) 전환
    - 문자열 필드: 단일 드롭다운 → **다중 태그 선택** (☑VIP ☑GOLD → OR 조건)
    - 금액/포인트/날짜: 드롭다운 → **프리셋 태그 토글**
    - sms_opt_in: 별도 체크박스 → 마케팅 카테고리 통합 (기본 ON)
  - **백엔드 개선 (customers.ts):**
    - enabled-fields 옵션: 4개 하드코딩 → **모든 string 필드 DISTINCT 동적 조회** (커스텀 포함)
    - buildDynamicFilter: `name`, `email`, `address` 등 직접 컬럼 → contains 검색 지원
    - numericFields: `recent_purchase_amount` 추가
    - extract SELECT: 6개 → 표준 필드 전체 반환
  - **Dashboard.tsx 연결:**
    - 기존 직접타겟 state 10개 + 함수 5개 제거
    - `handleTargetExtracted` 콜백으로 기존 발송 흐름 연결
- **수정 파일 3개:** DirectTargetFilterModal.tsx(신규), Dashboard.tsx, customers.ts

- **🚨 버그: 타겟 추출 후 발송 모달 미표시 — ✅ 수정 완료 (D43-3b, 2026-02-27)**
  - **증상:** 대상 인원 10,000명 조회 성공 → "타겟 추출" 클릭 → 아무 반응 없음 (발송 모달 안 뜸)
  - **확정 원인 3가지:**
    1. **extract SELECT 하드코딩 + customers_unified 뷰 불일치** — SELECT 컬럼 17개 하드코딩으로 나열 + `FROM customers_unified` 사용 → DDL 이후 뷰 미갱신으로 `store_phone`, `registration_type` 등 컬럼 참조 시 SQL 에러 → 500 반환 → `data.success` undefined → `onExtracted` 미호출
    2. **age 필터 birth_date 역산** — `buildDynamicFilter`에서 age 조건을 `EXTRACT(YEAR FROM AGE(birth_date))`로 처리 → `birth_date` NULL인 고객 전부 탈락 → 연령대 필터 시 0명
    3. **에러 핸들링 부재** — extract API 500 에러 시 DirectTargetFilterModal에서 `!res.ok` 체크 없이 `res.json()` 시도 → 파싱 실패하거나 success 없어서 조용히 실패
  - **수정 내용 (customers.ts + DirectTargetFilterModal.tsx):**
    - **extract SELECT 동적화:** 하드코딩 17개 컬럼 → `getColumnFields()` (FIELD_MAP 기반) + region/custom_fields/callback 추가. 필드 변경 시 FIELD_MAP만 수정하면 자동 반영
    - **customers_unified → customers 테이블 직접 조회:** extract + filter-count 모두 뷰 의존 제거
    - **age 필터 수정:** `EXTRACT(YEAR FROM AGE(birth_date))` → `age` 컬럼 직접 사용 (birth_date NULL인 고객도 필터 가능)
    - **에러 핸들링 추가:** `!res.ok` 체크 + `!data.success` 체크 + catch 네트워크 에러 → 모두 커스텀 알림 모달 표시 (animate-in zoom-in-95, error/warning/info 아이콘 분기)
    - **loadTargetCount에도 동일 에러 핸들링 적용**
  - **수정 파일 2개:** customers.ts, DirectTargetFilterModal.tsx
  - **기간계 미접촉:** campaigns.ts, spam-filter.ts, messageUtils.ts, results.ts, billing.ts, Dashboard.tsx 전부 미수정

- **발송창 하드코딩 전면 제거 + 컴포넌트 분리 — ✅ 완료 (D43-3c, 2026-02-27)**
  - **TargetSendModal.tsx 신규 (901줄):** Dashboard.tsx에서 직접타겟발송 모달 703줄 분리
  - **하드코딩 8곳 동적화 (fieldsMeta 기반):**
    1. SMS 자동입력 변수 (5개 고정 → fieldsMeta 동적)
    2. 카카오 자동입력 변수 (4개 고정 → fieldsMeta 동적)
    3. 수신자 테이블 헤더/데이터 (5컬럼 고정 → fieldsMeta 동적)
    4. handleTargetExtracted 매핑 (5개 하드코딩 → 원본 저장)
    5. executeTargetSend 치환 (5개 replace → fieldsMeta.forEach 동적)
    6. 스팸필터 replaceVars (8개 하드코딩 → fieldsMeta.forEach 동적)
    7. targetVarMap 바이트 체크 (5개 고정 → fieldsMeta 동적)
    8. DirectPreviewModal 미리보기 치환 (하드코딩 → replaceVarsWithMeta 동적)
  - **커서 위치 삽입 버그 수정:** `setTargetMessage(prev => prev + value)` → `textarea.selectionStart` 기반 정확한 위치 삽입
  - **데이터 흐름:** DirectTargetFilterModal → onExtracted(recipients, count, **fieldsMeta**) → Dashboard → TargetSendModal/DirectPreviewModal
  - **FieldMeta 인터페이스:** `{ field_key, display_name, variable, data_type, category }` — DirectTargetFilterModal에서 export
  - **Dashboard.tsx:** 4,548줄 → 3,910줄 (638줄 감소)
  - **수정 파일 4개:** TargetSendModal.tsx(신규), DirectTargetFilterModal.tsx, Dashboard.tsx, DirectPreviewModal.tsx
  - **기간계 미접촉:** campaigns.ts, spam-filter.ts, messageUtils.ts, results.ts, billing.ts 전부 미수정

- **직접타겟발송 발송창 하드코딩 전면 제거 + 컴포넌트 분리 — ✅ 완료 (D43-3c)**

#### 안건 #4: 수신거부 양방향 동기화 — ✅ 완료 (D43-4 + 2026-03-05 나래 080 콜백 연동)

- **설계 확정 내용:**
  - opt_outs 테이블 미사용 확인 (레거시) → **unsubscribes 테이블이 SoT**
  - 발송 파이프라인 이중 체크 유지: `sms_opt_in = true AND NOT EXISTS (SELECT 1 FROM unsubscribes ...)`
  - plan_id 기준 단순화: 플랜 있는 업체만 customers.sms_opt_in 동시 UPDATE, 없으면 unsubscribes만
  - `syncCustomerOptIn()` / `syncCustomerOptInBulk()` 공통 헬퍼 도입 (중복 제거)
- **DDL 완료:**
  - `ALTER TABLE companies ADD COLUMN opt_out_auto_sync boolean DEFAULT false;`
  - 테스트계정 opt_out_auto_sync = true 설정 완료
- **코드 배포 완료 (수정 2파일):**
  - **unsubscribes.ts:** 080콜백 opt_out_auto_sync 체크 추가, 직접추가/업로드/삭제 4곳 syncCustomerOptIn 적용, GET / 응답에 opt080Number+optOutAutoSync 추가
  - **Unsubscribes.tsx:** 080번호 하드코딩 제거→API 동적 표시, 연동테스트 버튼 optOutAutoSync=true일 때만 노출, 080 안내 모달
- **✅ 나래 080 콜백 연동 완료 (2026-03-05):**
  - 나래 담당자 콜백 URL 등록 확인 완료
  - 실제 080 ARS 수신거부 테스트 — 나래 IP(183.98.207.13) 콜백 수신 + 수신거부 DB 등록 정상 확인
  - OPT_OUT_080_TOKEN 검증 제거 — Nginx IP 화이트리스트(나래 6개 IP)로 보안 대체
  - 기존 누적 수신거부 목록: 한줄로 이관 시 수동 처리 예정 (별도 벌크 동기화 불필요)
- **기간계 미접촉:** campaigns.ts 발송 파이프라인 전체 미수정

#### 안건 #6: 🚨 긴급 — 스팸필터 테스트 안됨 → ✅ 완료 (원인: MySQL 랜섬웨어 공격)

- **증상 (2026-02-27 오전~):** 스팸필터 테스트 버튼 클릭 시 500 에러. PM2 로그: `Table 'smsdb.SMSQ_SEND_10' doesn't exist`
- **원인 — MySQL 랜섬웨어 공격:**
  - MySQL 컨테이너가 `0.0.0.0:3306`으로 외부에 노출된 상태 + 취약한 비밀번호(`sms123`/`root123`)
  - 2026-02-25~26 MySQL 타임존 설정 작업 중 컨테이너 3회 재생성하면서 포트가 `0.0.0.0`으로 바인딩됨
  - 자동화 봇이 3306 포트 스캔 → 딕셔너리 공격으로 비밀번호 탈취 → SMSQ_SEND_1~11 테이블 전체 삭제 → `RECOVER_YOUR_DATA_info` 랜섬 메시지 테이블 삽입
  - root 비밀번호 변경됨 (smsuser는 권한 제한으로 무사)
  - **PostgreSQL 무사** (처음부터 127.0.0.1 바인딩) — 핵심 데이터(고객/캠페인/정산) 전부 안전
- **복구 조치 (2026-02-28, D49):**
  1. ✅ MySQL 포트 `0.0.0.0:3306` → `127.0.0.1:3306` (외부 접근 원천 차단)
  2. ✅ root 비밀번호 강화 (취약 비밀번호 → 강화 비밀번호)
  3. ✅ smsuser 비밀번호 강화 + QTmsg Agent 11개 `encrypt_pass` 동기 변경 (DES 암호화 도구 자체 제작: EncryptPass.java)
  4. ✅ smsuser 권한 최소화: `ALL PRIVILEGES` → `SELECT, INSERT, UPDATE, DELETE` (DROP TABLE 불가)
  5. ✅ SMSQ_SEND_1~11 테이블 재생성 (SMSQ_SEND 뷰 기반 스키마 복원)
  6. ✅ 로그 테이블 SMSQ_SEND_*_202602 / 202603 재생성
  7. ✅ 이벤트 스케줄러 `auto_create_sms_log_tables` 정상 확인
  8. ✅ `RECOVER_YOUR_DATA_info` 랜섬 테이블 삭제
  9. ✅ QTmsg Agent 11개 재시작 + 통신사 바인딩 확인 (bind ack 성공)
  10. ✅ 스팸필터 테스트 정상화 확인 (LG U+ 수신 완료)
- **보안 강화 조치:**
  1. ✅ UFW 불필요 포트 차단: 3000(Node.js), 9001~9011(QTmsg Agent 관리) DENY
  2. ✅ SSH root 로그인 비활성화 (`PermitRootLogin no`)
  3. ✅ fail2ban 강화: 10분 내 3회 실패 → 1시간 자동 밴 (설정 직후 5개 IP 차단)
  4. ✅ MySQL smsuser DROP 권한 제거 (설령 뚫려도 테이블 삭제 불가)
- **피해 범위:** MySQL SMSQ 발송 큐 테이블 삭제 (임시 데이터). **고객 개인정보 유출 없음** (PostgreSQL 무사)
- **교훈:** Docker 컨테이너 재생성 시 포트 바인딩 반드시 127.0.0.1 확인. 외부 노출 DB는 강력한 비밀번호 + 권한 분리 필수

#### 안건 #5: AI 한줄로 입력 포맷 강제화 + 샘플 고객 미리보기 + 이모지 제거 — ✅ 완료

- **문제 3가지:**
  1. AI 한줄로(일반)가 고객사 DB 전체 필드를 통으로 바라봄 → 오류 확률 높음
  2. AI 결과 메시지에 `%고객명%` 등 변수가 그대로 표시됨 → 실제 모습 확인 불가
  3. AI가 프롬프트 무시하고 이모지(🔥📅⏰🎉) 삽입 → SMS/LMS에서 깨짐
- **해결 (D43-5, 2026-02-27):**
  - **개인화 필수 파싱 (services/ai.ts):** `parsePersonalizationDirective()` 신규 — "개인화 필수:" 키워드 감지 → 지정 변수만 AI에 전달, 없으면 기존 로직 유지 (하위호환 100%)
  - **샘플 고객 미리보기 (routes/ai.ts → Dashboard.tsx → AiCampaignResultPopup.tsx):** `/recommend-target` 응답에 `sample_customer` 추가 (필터 맞는 실제 고객 1명, FIELD_MAP displayName 키 기반) → AI 결과 메시지 미리보기에서 `%변수%` → 실제 데이터 치환 표시 + 스팸필터 점검에도 치환 적용
  - **이모지 강제 제거 (services/ai.ts):** `stripEmojis()` 후처리 안전장치 — SMS/LMS/MMS 발송 시 유니코드 이모지 자동 제거, KS X 1001 특수문자(★☆●○▶◀■□△▲【】「」 등) 유지. 카카오 채널은 이모지 허용으로 미적용
  - **하드코딩 제거:** AiCampaignResultPopup.tsx의 하드코딩 sampleData 9개 + replaceVars 8개 제거 → 동적 sampleCustomer 기반으로 전환
- **수정 파일 4개:** services/ai.ts, routes/ai.ts, Dashboard.tsx, AiCampaignResultPopup.tsx
- **UI 힌트 추가:** AiSendTypeModal.tsx placeholder + 개인화 안내 힌트

#### 안건 #7: 결과값 매핑 중앙화 — sms-result-map.ts 컨트롤타워 — ✅ 완료 (3-Tier 전수 점검 · Phase 4) (D43-7, 2026-02-28)

- **문제:** QTmsg status_code 해석, 통신사 코드, 스팸필터 판정 결과가 12곳에서 각자 하드코딩 → standard-field-map.ts 이전의 필드 매핑 문제와 동일 패턴
  - 스팸필터 테스트 결과 전부 "대기" 고착 (근본 원인: 백엔드 `'received'` 저장 → 프론트 `'pass'`만 정상 처리)
  - 스팸필터 테스트 이력에 수신번호 노출 (테스트 방식 유추 가능)
  - 발송결과 AI분석 탭 중복 (메인메뉴에 이미 존재)
- **해결 Phase 1 — 전수 파악 + 설계:**
  - 12곳 하드코딩 위치 전체 식별 (campaigns.ts 5곳, results.ts 5곳, ResultsModal.tsx 2곳 + spam-filter.ts 판정 로직)
  - sms-result-map.ts 컨트롤타워 설계 확정 (STATUS_CODE_MAP + CARRIER_MAP + SPAM_RESULT 3파트)
- **해결 Phase 2 — 백엔드 전환 + 프론트 1차 수정 (배포 완료):**
  - **sms-result-map.ts 신규 (148줄):** `backend/utils/` — STATUS_CODE_MAP, CARRIER_MAP, SPAM_RESULT 상수 + 헬퍼 함수 (isSuccess/isFail/isPending/getStatusLabel/getCarrierLabel/getSpamResultLabel)
  - **campaigns.ts 8곳 전환:** 가이드 기반 Harold님 수정 — SUCCESS_CODES/PENDING_CODES/isSuccess/isFail/SPAM_RESULT 사용
  - **results.ts 6곳 전환:** statusCodeMap/carrierMap 로컬 정의 제거 → import 사용, SQL WHERE도 상수 참조
  - **spam-filter.ts 6곳 전환:** 판정 로직 `sc === 6 || sc === 1000` → `SUCCESS_CODES.includes(sc)`, 문자열 `'received'`/`'timeout'`/`'failed'` → SPAM_RESULT 상수, SQL 파라미터화
  - **ResultsModal.tsx 3건 수정:** ① AI분석 탭 제거 (2탭 구조) ② 스팸필터 수신번호 컬럼 완전 제거 ③ 스팸판정 표시 확장 (pass/received→정상, blocked→차단, failed→실패, timeout→시간초과)
  - **DB 마이그레이션:** `UPDATE spam_filter_test_results SET result = 'pass' WHERE result = 'received'` — 384건 변환 완료
- **해결 Phase 3 — 프론트 하드코딩 제거 + 실코드 검증 (2026-02-28):**
  - **campaigns.ts 실코드 검증 완료:** 8곳 모두 sms-result-map.ts import 정상 사용 확인. `status_code = 100` (14곳)은 큐 관리용 초기 상태 특정이므로 정확 (PENDING_CODES로 바꾸면 104 처리중 건까지 삭제 위험)
  - **results.ts 3곳 추가 수정:** ① import에 `getStatusType`, `isSuccess` 추가 ② `/campaigns/:id/messages` 응답에 `status_label`/`status_type`/`carrier_label` 해석값 3개 필드 추가 (원본 유지+해석값 추가 → 하위호환 100%) ③ CSV export 카카오 분기 `m.status_code === 1800` → `isSuccess(m.status_code)` 헬퍼 사용
  - **ResultsModal.tsx 3곳 수정:** ① `STATUS_CODE_MAP` 14개 하드코딩 전체 삭제 (백엔드 22개와 8개 누락 불일치 해소) ② `CARRIER_MAP` 9개 하드코딩 전체 삭제 ③ 메시지 렌더링에서 백엔드 응답 `m.status_label`/`m.status_type`/`m.carrier_label` 직접 사용
- **해결 Phase 4 — 3-Tier 전수 점검 + admin.ts/billing.ts 전환 (2026-02-28):**
  - **서비스 프론트 (hanjul.ai) 7파일 점검 완료:** Dashboard.tsx, CampaignSuccessModal.tsx, AiCampaignResultPopup.tsx, AnalysisModal.tsx, TargetSendModal.tsx, DashboardHeader.tsx — 하드코딩 0건. ResultsModal.tsx getPreviewText sampleData 9개 레거시 삭제 → messages[0].msg_contents 동적 치환으로 전환
  - **슈퍼관리자 프론트 (sys.hanjullo.com) 1파일:** AdminDashboard.tsx 4562번 `[6,1000,1800].includes(r.statusCode)` → `r.statusType === 'success'` 동적 분기로 전환
  - **관리자 프론트 (app.hanjul.ai) 4파일 점검 완료:** CompanyDashboard.tsx, StatsTab.tsx, ScheduledTab.tsx, (UsersTab/CallbacksTab/CustomersTab 무관) — 하드코딩 0건
  - **admin.ts 5곳 전환:** ① import 추가 ② 테스트 통계 SQL `IN (6,1000,1800)` → `SUCCESS_CODES_SQL`/`PENDING_CODES_SQL` ③ 테스트 상세 `[6,1000,1800].includes()` → `isSuccess()`/`isPending()` ④ sms-detail 필터 SQL → 상수 참조 ⑤ statusMap 7개 + carrierMap 3개 로컬 하드코딩 삭제 → `getStatusLabel()`(22개)/`getCarrierLabel()`(9개) + statusType 필드 추가
  - **billing.ts 5곳 전환 + 버그 수정:** ① import 추가 ② smsAggByDateType 성공/실패/대기 3곳 → 상수 참조 ③ smsAggByRunAndType 성공 1곳 ④ smsAggTestByType 성공 1곳. **🐛 `>= 200` 버그 발견·수정:** 실패 판정에 `status_code >= 200` 조건이 있어 비가입자(7)/Power-off(8)/스팸차단(16)/기타실패(55) 등 200 미만 실패 코드가 정산 실패 건수에서 누락. 다른 파일과 통일하여 `NOT IN (성공, 대기) = 실패`로 수정
- **수정 파일 (전체):** sms-result-map.ts(신규), campaigns.ts, results.ts, spam-filter.ts, admin.ts, billing.ts, ResultsModal.tsx, AdminDashboard.tsx
- **기간계 미접촉:** 발송 흐름/차감/환불 로직 전부 미수정. 결과값 해석 로직만 sms-result-map.ts 중앙화 전환
- **3-Tier 전수 점검 결과:** 백엔드 6파일 + 프론트 12파일 = **18파일 점검, 하드코딩 잔존 0건**

#### 진행 순서 (Harold님 확정)

1. ~~**#1** 대시보드 회사명 (빠른 해결)~~ ✅ 완료
2. ~~**#2** AI 매핑 화면 개편 (컴포넌트 분리 + 태그 클릭 UI)~~ ✅ 완료
3. ~~**#5** AI 한줄로 포맷 강제화 + 미리보기 + 이모지 제거~~ ✅ 완료
4. ~~**#3** 직접 타겟 설정~~ ✅ 완료 (백엔드 버그 수정 + 발송창 하드코딩 전면 제거)
5. ~~**#4** 수신거부 동기화~~ ✅ 완료 — 나래 080 콜백 연동 완료 (2026-03-05), 토큰 검증 제거→Nginx IP 화이트리스트
6. ~~**🚨 #6 긴급: 스팸필터 테스트 안됨**~~ ✅ 완료 — 원인: MySQL 랜섬웨어 공격 (D49 보안 대응)
7. ~~**#7** 결과값 매핑 중앙화~~ ✅ 완료 — Phase 4: 3-Tier 전수 점검 + admin.ts/billing.ts 전환 + `>= 200` 버그 수정

→ 각 안건을 별도 채팅 세션에서 설계→컨펌→구현→테스트→정립 후 다음으로 진행

#### ⛔ 진행 규칙
- 기존 발송 파이프라인의 발송 흐름/차감/환불 로직 절대 건드리지 않음
- 코드 작성 전 Harold님 컨펌 필수
- SCHEMA.md에 없는 컬럼 임의 생성 금지
- standard-field-map.ts가 유일한 필드 매핑 기준
- sms-result-map.ts가 유일한 결과값 매핑 기준
- 의논 → 검증 → 실행 순서 엄수

---

### ✅ 이전 완료 요약

| 항목 | 상태 |
|------|------|
| D39 표준 필드 아키텍처 (세션0~2 전체) | ✅ 코드 수정 완료 · 실동작 검증 대기 |
| D40 AI 맞춤한줄 동적 필드 + UX | ✅ 완료 |
| D41 대시보드 동적 카드 시스템 (세션1~2) | ✅ 완료 |
| D42 발송현황 하드코딩 제거 | ✅ 완료 |
| D43 안건#1 회사명 | ✅ 완료 |
| D43 안건#2 매핑 UI 개편 | ✅ 완료 |
| D43 안건#3 직접타겟 리팩토링 | ✅ 완료 (백엔드 버그 + 발송창 하드코딩 전면 제거) |
| D43 안건#4 수신거부 동기화 | ✅ 완료 — 나래 080 콜백 연동 + 토큰 검증 제거 (2026-03-05) |
| D43 안건#5 AI 포맷+미리보기+이모지 | ✅ 완료 |
| D43 안건#7 결과값 매핑 중앙화 | ✅ 완료 — Phase 4: 3-Tier 18파일 전수 점검, 백엔드 6파일+프론트 12파일 하드코딩 0건, billing.ts `>=200` 버그 수정 |
| AI 맞춤한줄 Phase 1 (AI-CUSTOM-SEND.md) | ✅ 8단계 전체 완료 |
| 선불 요금제 Phase 1-A | ✅ 완료 |
| 8차 버그 13건 수정 | ✅ 코드 수정 완료 · 실동작 검증 대기 |
| AI 분석 모달 전체 | ✅ 완료 |
| 스팸필터 전체 (Android 앱 포함) | ✅ 완료 |

---

## 5) ⚠️ 발송 파이프라인 절대 보호 영역

> **아래 파일들은 발송·정산·결과조회의 핵심.** 2026-02-26 D32~D33에서 공통 치환 함수 통합 + 5개 경로 전수 점검 완료. 2026-02-28 D43-7에서 결과값 해석 로직을 sms-result-map.ts 중앙화로 전환 (발송 흐름/차감/환불 로직 미접촉).

| 파일 | 역할 | 비고 |
|------|------|------|
| campaigns.ts | AI 캠페인 발송 (예약+즉시) + 선불 차감/환불 | D43-7: 결과값 해석 8곳 → sms-result-map.ts 참조로 전환 |
| spam-filter.ts | 스팸필터 테스트 (Android 앱 연동) | D43-7: 판정 로직 6곳 → SPAM_RESULT 상수 전환, 'received'→'pass' |
| messageUtils.ts | 공통 변수 치환 (`replaceVariables`) | 미수정 |
| results.ts | 발송 결과 조회 + MySQL LIVE/LOG 통합 | D43-7: statusCodeMap/carrierMap 6곳 → sms-result-map.ts import + messages API에 해석값 3필드(status_label/status_type/carrier_label) 추가 |
| billing.ts | 정산·거래내역서 PDF | D43-7: 3개 집계함수 5곳 → SUCCESS_CODES_SQL/PENDING_CODES_SQL 참조. `>=200` 버그 수정(비가입자/Power-off/스팸차단 등 200 미만 실패코드 정산 누락 해소) |
| direct-send (campaigns.ts 내) | 직접 타겟 발송 | D43-7: 결과값 해석 동일 전환 |

---

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

## 8) 📲 진행 예정 작업 (TODO)

### 🟡 잔여 — 직원 버그리포트 실동작 검증 (코드 수정 전체 완료)
- [ ] **8차 B8-01~B8-13: 직원 실서비스 테스트** (app.hanjul.ai)
- [ ] **9차 S9-04/S9-08: 발송결과 조회 성능 + sent_at 정확성 확인**
- [ ] **D39 세션2 실동작 검증: 필터 UI + AI 보유필드 확인**

### ✅ 완료 — 표준 필드 아키텍처 통합 (D39)
- [x] 세션 0: DDL + standard-field-map.ts 재정의 (필수17+커스텀15)
- [x] 세션 1: upload.ts + normalize.ts 입구 정상화
- [x] 세션 2: customers.ts + Dashboard.tsx + ai.ts + AiCustomSendFlow.tsx 조회+AI 정상화

### 대시보드 리팩토링 Phase 3 (추후)
- [x] 직접 타겟 설정 모달 분리 — ✅ D43-3a DirectTargetFilterModal.tsx (729줄)
- [x] 직접 타겟 발송 모달 분리 — ✅ D43-3c TargetSendModal.tsx (901줄)
- Dashboard.tsx 누적 감소: 8,039줄 → 3,910줄 (총 4,129줄 감소)

### AI 맞춤한줄 Phase 2 (발송 연결) — ✅ 구현 완료 (문서 미갱신이었음, 2026-03-05 코드 검증)
- [x] 발송 확정 → AiCustomSendFlow.tsx Step 4 onConfirmSend 콜백으로 variant+targetFilters 전달
- [x] AiCampaignSendModal 연결 → Dashboard.tsx handleAiCustomSend에서 campaignsApi.create+send 호출
- [x] 전체 플로우 코드 구현 완료 (Step4 → 모달 → 캠페인생성 → targetFilter기반 고객조회 → 개인화치환 → MySQL INSERT)
- [ ] 실서비스 통합 테스트 (실제 발송 확인) — Harold님 검증 대기

### 카카오 알림톡 템플릿 관리 (Humuson API v2.1.1)
- [ ] 고객사 관리자(app.hanjul.ai) 템플릿 CRUD + 검수 프로세스 + 발신프로필 조회 + 관리 UI
- [ ] 슈퍼관리자(sys.hanjullo.com) 고객사별 Humuson 연동 설정 (humuson_user_id, uuid)
- [ ] 서비스 사용자(hanjul.ai) 캠페인 발송 시 APR 상태 템플릿만 선택
- [ ] 기술: 백엔드 프록시 /api/kakao-templates/*, DB kakao_templates 확장, 상태 전이 규칙
- [ ] Phase 2: 이미지 업로드, 알림 수신자 관리, 발신프로필 그룹

### 080 수신거부 (✅ 나래인터넷 콜백 연동 완료 — 2026-03-05)
- [x] 콜백 엔드포인트 구현 (고객사별 080번호 자동 매칭)
- [x] 토큰 검증 제거 — Nginx IP 화이트리스트(나래 6개 IP)로 보안 대체
- [x] Nginx 080callback 경로 나래 IP 화이트리스트 적용
- [x] D43-4 양방향 동기화: opt_out_auto_sync DDL + syncCustomerOptIn 헬퍼 + 4곳 적용
- [x] D43-4 프론트: 080번호 동적 표시 + 연동테스트 버튼 (auto_sync=true 조건부)
- [x] curl 로컬 테스트 정상 확인 (서버 `1` 반환)
- [x] 나래 담당자 콜백 URL 등록 확인 완료 (2026-03-05)
- [x] 실제 080 ARS 수신거부 테스트 — 나래 IP(183.98.207.13) 콜백 수신 + 수신거부 DB 등록 정상 확인
- [x] 기존 누적 수신거부 목록 — 한줄로 이관 시 수동 처리 예정 (벌크 동기화 불필요)

### 선불 요금제 Phase 1-B~2
- [ ] Phase 1-B: KCP PG 연동 (카드결제만, 가상계좌 제외)
- [ ] Phase 2: 입금감지 API 자동화

### Sync Agent
- [x] Sync Agent 코어 완성 (비토 v1.3.0 개발 완료)
- [x] 슈퍼관리자 SyncAgent API Key 관리 UI — ✅ D60 (2026-03-08): 고객사 편집 모달 9번째 탭. API Key/Secret 조회·재발급·비활성화, use_db_sync 토글. 백엔드 3개 엔드포인트 신규.
- [ ] sync_releases에 v1.3.0 릴리스 레코드 등록 (비토 최종 빌드 후)

### 보안
- [x] 소스 보호: 우클릭/F12/개발자도구/드래그 차단 (3개 도메인 전체 적용)
- [x] 🔴 MySQL 랜섬웨어 대응 (2026-02-28, D49): 외부 차단+비밀번호 강화+권한분리+fail2ban+포트차단 — 상세 내용 D43 안건#6 참조
- [x] 프론트엔드 난독화 — ✅ D61 (2026-03-08): vite-plugin-javascript-obfuscator 적용, production 빌드 시 stringArray+base64+disableConsoleOutput. frontend+company-frontend 양쪽 적용.
- [ ] 슈퍼관리자 IP 화이트리스트 설정
- [x] 외부 자동 백업 구축 — ✅ 2026-03-05 완료: pg_dump+mysqldump → 59번 서버(58.227.193.59) SCP 전송, SSH 키 인증, crontab 매일 03:00 KST, 7일 로컬 보관. 스크립트: /home/administrator/backups/backup.sh
- [x] 웹 애플리케이션 SQL Injection 점검 — ✅ D56 테이블명 화이트리스트 + D57-C4 sendTime 파라미터화 + D59 custom_fields JSONB 키 화이트리스트(3파일) + dateFilter 파라미터화 완료 (SSRF 별도)
- [ ] SSH 키 인증 전용 전환 (비밀번호 로그인 비활성화) — 선택

### 인비토AI (메시징 특화 모델)
- [x] ai_training_logs 테이블 + training-logger.ts + campaigns.ts 연결
- [ ] 이용약관에 비식별 데이터 활용 조항 추가
- [ ] 데이터 충분히 축적 후 모델 학습 파이프라인 설계

---

## 9) DECISION LOG (ADR Index)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.

| ID | 날짜 | 결정 | 근거 |
|----|------|------|------|
| D36 | 02-26 | MySQL 타임존 KST — 풀 레벨 보강 | 커넥션 풀 10개 중 1개만 TZ 설정되는 구조적 문제 |
| D37 | 02-26 | GPT 의견 수용 원칙 — 코드 근거 기반 판단 | GPT "미수정" 지적에 코드 확인 없이 동의→문서 오염 |
| D38 | 02-26 | 표준 필드 아키텍처 복구 — standard-field-map.ts 매핑 레이어 도입 | 4곳 하드코딩 불일치→필터 전멸+데이터 손실 |
| D39 | 02-26 | 표준 필드 아키텍처 재정의 — 필수 17개 + 커스텀 15개 확정 | 기존 41개→32개 정리. FIELD-INTEGRATION.md 기준 |
| D40 | 02-27 | AI 맞춤한줄 동적 필드 + UX 개선 — 커스텀 실데이터만 노출 + 톤 제거 + 필드명 표시 | enabled-fields 단일 경로+JSONB 실데이터만 반환 |
| D41 | 02-27 | 대시보드 동적 카드 시스템 — 슈퍼관리자 체크 설정 + FIELD_MAP 17개 기반 카드 풀 | 고객사마다 보유 데이터 다름. 하드코딩 고정→동적 전환. company_settings 활용, 4칸/8칸 모드 |
| D42 | 02-27 | 발송현황 하드코딩 제거 — VIP/30일매출 → 성공건수/평균성공률/총사용금액 | 발송현황 영역에 VIP·매출은 맥락 불일치. 발송 관련 지표로 통일 |
| D43 | 02-27 | 기능 정상화 및 DB 동적 기준 정립 — 5개 안건 (회사명/매핑UI/타겟필터/수신거부동기화/AI포맷) | D39 이후 미반영 기능 정상화. 발송 파이프라인 미접촉 |
| D44 | 02-27 | AI 매핑 화면 개편 — 컴포넌트 분리 + 태그 클릭 2열 그리드 + 커스텀 +/- | 하드코딩 드롭다운 16개→FIELD_MAP 동적 20개, Dashboard.tsx 310줄 분리 경량화 |
| D45 | 02-27 | AI 한줄로 3종 개선 — 개인화 필수 파싱 + 샘플 고객 미리보기 + 이모지 강제 제거 | 변수 오류 방지+미리보기 실감+SMS 깨짐 방지. 발송 파이프라인 무접촉 |
| D46 | 02-27 | 직접 타겟 설정 전면 리팩토링 — 컴포넌트 분리 + 전체 필드 노출 + 2열 컴팩트 + 다중선택 + 연령범위 | SKIP_FIELDS 제거(Harold님 확정), 사용자에게 필드 선택 위임. Dashboard 405줄 감소 |
| D47 | 02-27 | 직접 타겟 발송 모달 분리 + 하드코딩 8곳 동적화 + 커서위치 버그 수정 — TargetSendModal.tsx 신규 | fieldsMeta 기반 동적(자동입력/테이블/치환/바이트체크/미리보기). Dashboard 638줄 감소 |
| D48 | 02-27 | 수신거부 양방향 동기화 — plan_id 기준 customers.sms_opt_in 동시 UPDATE + opt_out_auto_sync 플래그 | unsubscribes=SoT, opt_outs 레거시 확인, 나래인터넷 전용 auto_sync 분기. 080번호 하드코딩 제거→동적 |
| D49 | 02-28 | 🔴 MySQL 랜섬웨어 긴급 대응 — 외부 차단+비밀번호 강화+권한 분리+보안 강화 | 3306 외부 노출→봇 공격→SMSQ 테이블 삭제. 127.0.0.1 바인딩+smsuser DROP 권한 제거+fail2ban+UFW 포트 차단. PostgreSQL 무사, 고객 데이터 유출 없음 |
| D50 | 02-28 | 결과코드 매핑 Phase 3 — 프론트 하드코딩 제거 + 백엔드 해석값 전달 | ResultsModal.tsx STATUS_CODE_MAP(14개)/CARRIER_MAP(9개) 하드코딩 삭제→백엔드 API가 sms-result-map.ts 기반 해석값 직접 전달. 프론트에 결과코드 매핑 로직 없음=불일치 불가 |
| D51 | 02-28 | 결과코드 매핑 Phase 4 — 3-Tier 전수 점검 완료 + admin.ts/billing.ts 전환 | admin.ts 5곳(statusMap7개+carrierMap3개 로컬 삭제→헬퍼 사용+statusType 추가) + billing.ts 5곳(3개 집계함수→상수참조) + `>=200` 버그 수정(실패 건수 누락). AdminDashboard.tsx statusType 동적 분기. ResultsModal.tsx sampleData 동적 치환. **18파일 점검, 하드코딩 잔존 0건** |
| D52 | 03-04 | 하드코딩 전수조사 + 동적 전환 + 설정 중앙집중화 (B11-01~05) | (1) campaigns.ts `'18008125'` 폴백→DB 필수화 (2) alert()→setToast 전면교체(40+곳) (3) ai.ts `'0807196700'`→DB 동적조회 (4) 단가 5파일→defaults.ts (5) AI모델명 4파일→AI_MODELS (6) Redis 4곳→공유인스턴스 (7) 타임아웃/배치/캐시TTL/RateLimit 12파일→중앙상수. **총 21건 전체 해소, 12파일 수정, 기간계 무접촉** |
| D53 | 03-04 | 요금제별 기능 게이팅 — 무료/스타터/베이직/프로/비즈니스 5단계 기능 잠금 | plans 테이블 3컬럼 추가(customer_db_enabled/spam_filter_enabled/ai_messaging_enabled). 백엔드 6파일 API 게이팅 + 프론트 5파일 UI 잠금. 무료=직접발송만, 스타터=+스팸필터+고객DB+타겟팅, 베이직=+AI발송, 프로=+AI분석basic, 비즈니스=+AI분석advanced. **기간계 무접촉** |
| D54 | 03-05 | 스팸필터 폴링 로직 개선 — QTmsg 성공 후 10초 대기→BLOCKED 판정 | 기존 3분 무조건 대기→QTmsg 성공 시점 추적(qtmsgSuccessTime Map)+10초 grace period. 타임아웃 180→60초. 이력 탭 추가. **기간계 무접촉** |
| D55 | 03-05 | 보안 긴급점검 + 슈퍼관리자 세션 관리 + 세션 타이머 UI | JWT_SECRET/MYSQL_PASSWORD fail-fast(폴백값 제거, 미설정 시 서버 기동 차단). mms-images.ts 자체 JWT→공용 authenticate. Math.random()→crypto.randomInt(). 슈퍼관리자 3중 구멍 수정(세션 미생성/세션체크 건너뛰기/프론트 감시 스킵→전부 해소, 30분 타임아웃). user_sessions.user_id FK 제거(DDL-D55, super_admins ID 허용). expires_at 서버측 만료 강제(브라우저 닫기→재오픈 시 서버 차단). dotenv.config() app.ts 최상단 이동. 은행 스타일 세션 타이머 UI 전체 사용자 적용. **코드+DDL+배포 완료. 기간계 무접촉** |
| D56 | 03-05 | P0-Q1 SQL Injection 방지 + 스팸필터 선불차감 누락 수정 | sms-table-validator.ts 신규(화이트리스트 정규식). admin.ts 라인그룹 생성/수정 API 입구 검증. campaigns.ts 환경변수 경고+DB 조회 필터링+prepaidDeduct/prepaidRefund export. spam-filter.ts 선불차감 추가(테스트폰×메시지타입 건수). 수정 3파일+신규 1파일. **기간계 무접촉. 배포+실서버 검증 완료** |
| D57 | 03-05 | P0-C1~C5 발송 파이프라인 안정화 5건 전체 구현 | **(C1)** AI발송+직접발송 per-customer/per-batch try/catch→sentCount 추적→부분실패 시 실패분만 선별적 환불(기존 all-or-nothing 제거). **(C2)** normalize-phone.ts 신규(normalizePhone 단일함수, `/\D/g` 비숫자 전체 제거)→campaigns.ts 27곳 `replace(/-/g,'')` 통일 교체+**directCustomerMap 키 불일치 핵심버그 수정**(L1962 raw phone→normalizePhone). **(C3)** calcSplitSendTime() 헬퍼 신규—SEND_HOURS.end 초과 시 다음날 start로 이월. defaults.ts SEND_HOURS 설정 추가(환경변수 SEND_START_HOUR/SEND_END_HOUR). 직접발송 SMS+카카오 2경로 적용. **(C4)** AI발송 sendTime `'${sendTime}'` 템플릿 리터럴→`?` 파라미터화(SQL Injection 차단). **(C5)** 테스트발송 bill_id `userId\|\|''`→`randomUUID()` 고유 추적ID+requestUid 통일+실패건 DB 기록+응답에 testRequestUid 반환. 수정 2파일(campaigns.ts, defaults.ts)+신규 1파일(normalize-phone.ts). TypeScript 0에러. **기간계 발송 흐름 자체는 변경 없음 — 에러 처리/환불/정규화 보강만** |
| D58 | 03-06 | 12차 버그리포트 4건 수정 + 기능개선 3건 — 예약취소 Agent 대응, 발송결과 타임아웃, 필터 UI 전면개선, 담당자테스트 | **(B12-01)** 예약취소 DELETE+UPDATE 이중처리(Agent 픽업건 9999 코드) **(B12-02)** sync-results 60분 타임아웃+환불 **(B12-03)** 스팸필터 subject 전달 **(B12-04)** 특수문자/보관함/저장 모달 공용화 **(F12-01)** AI 머지태그 원본 표시 **(F12-02)** 필터 UI: 성별 자동감지 패턴매칭(gender/sex/성별)+DB값 자동매핑(M/F/male/남/여/1/0→한글), 생일 월별 프리셋, 금액 최소~최대 범위입력(콤마포맷+원 단위+빠른선택+col-span-2), 수신자 테이블 성별 한글 표시 **(F12-03)** 타겟발송 담당자테스트 버튼(3열 그리드+10초 쿨다운). 수정 7파일. **기간계 무접촉** |
| D59 | 03-07 | 2차 코드 전수점검 P1~P6 총 28건 수정 — 정산정확성+SQL Injection+입력검증+하드코딩+인프라+프론트엔드 | **(P1)** ai.ts `\|\|10`→`??10`, analysis.ts 채널별 정확비용, manage-stats.ts dead code 삭제. **(P2)** safe-field-name.ts 신규+campaigns/customers/ai 3파일 custom_fields 화이트리스트+dateFilter 파라미터화. **(P3)** mms-images UUID검증, upload.ts path.basename, manage-users 비밀번호8~72자. **(P4)** SYSTEM_SMS_CALLBACK 환경변수화, INVITO_INFO 상수+billing 4곳교체, ©연도 동적화5곳, constants/company.ts 신규+15곳교체. **(P5)** Redis error handler, AI API 키 warn, process 에러핸들러(PM2 연계), PG Pool 환경변수설정. **(P6)** Dashboard setInterval cleanup, optOutNumber 안전장치, 교차중복발송방지, console.log삭제. 수정20파일+신규4파일. **기간계 무접촉. tsc 3패키지 전체 통과** |
| D60 | 03-08 | SyncAgent API Key 관리 UI + 사용자별 라인그룹 배정 | 상용화 온보딩 시 DB 직접 접근 불가→슈퍼관리자 UI 필요. 동일 회사 내 사용자간 발송 라인 공유→홀딩 문제. users.line_group_id 추가, getCompanySmsTables userId optional 확장. 기간계 기존 호출 100% 호환. |
| D61 | 03-08 | 프론트엔드 난독화 적용 | 상용화 전 소스 보호. vite-plugin-javascript-obfuscator production only. stringArray+base64+disableConsoleOutput. frontend+company-frontend 양쪽. |
| D67 | 03-12 | 080 콜백 진단 + 수신동의 변형 + 사용자별 고객DB 삭제 | 080 콜백 서버코드 정상 확인(나래측 URL 미등록 원인). 연동테스트 stale state 버그 수정. SMS_OPT_IN_FALSE 13개 변형 추가(비동의/불동의/거절/해지 등). admin.ts 사용자별 uploaded_by 기준 고객 삭제 API+UI. 기간계 무접촉 |
| D68 | 03-12 | 대시보드 UI 4건 + AI 생일 타겟팅 + 테스트 비용 합산 | (1) 총구매금액 $→CreditCard+천단위콤마 (2) 커스텀필드 라벨 is_hidden NULL 미매칭 수정 (3) AI 생일타겟팅: 프롬프트+customer-filter mixed+3경로 전부 birth_date 추가 (4) 발송현황 총사용금액에 담당자테스트+스팸필터 비용 합산. 메트로시티 가상DB 2만건 생성. 기간계 무접촉 |
| D69 | 03-12 | 자동발송 기능 기초 설계 | 메트로시티 요청. auto_campaigns+auto_campaign_runs 테이블 설계, PM2 워커+D-1 사전알림 아키텍처, 프론트 AutoSendPage(블러 프리뷰 게이팅)+DashboardHeader 메뉴 추가. 프로 이상 전용. company_user(브랜드담당자) 생성/수정/삭제 가능. 매월 28일 max. 기존 파이프라인(customer-filter, sms-queue, messageUtils) 100% 재활용. 설계문서: AUTO-SCHEDULE-DESIGN.md |
| D73 | 03-14 | 무료체험 PRO 게이팅 + 수신거부 브랜드 자동배정(CT-03) + 커스텀 필드 라벨 UPSERT(CT-07) | 무료체험 만료 후 직접발송만 유지. 수신거부 admin 등록 시 store_code 기준 브랜드 사용자 자동배정(기존 admin 몰림 방지). "최초 등록 우선" 라벨 고착 버그→ON CONFLICT DO UPDATE. 컨트롤타워 우선 확인 원칙 CLAUDE.md 섹션 0 추가 |
| D78 | 03-16 | 프로 자동 스팸필터 테스트 + CT-09 spam-test-queue.ts | 프로 요금제 차별화 핵심. AI 문안생성→자동 스팸테스트(큐 기반 순차처리)→차단 시 자동 재생성(최대2회). 프로 이상 무료. DB: plans.auto_spam_test_enabled + spam_filter_tests(source/variant_id/batch_id). spam_check_number 하드코딩 제거→080번호 동적조회. **배포 완료, 실서비스 E2E 검증 필요** |
| D71 | 03-13 | customers_unified 뷰 store_phone 누락 + upload.ts region 중복 수정 | (1) 슈퍼관리자 고객DB 탭 500 에러: customers_unified 뷰에 store_phone 미포함 → DROP+CREATE VIEW로 store_phone 추가 (서버 DDL). (2) 엑셀 업로드 30,000건 전건 오류: D70-17에서 region을 FIELD_MAP에 추가했으나 upload.ts에서 이미 파생 컬럼으로 별도 처리 → INSERT에 region 중복 → insertCols/rowValues/updateClauses 3곳에서 명시적 region 제거, FIELD_MAP 순회에서 derivedRegion 우선 사용하도록 통합. **교훈:** ①customers 테이블 컬럼 추가 시 customers_unified 뷰도 반드시 재생성 ②FIELD_MAP에 필드 추가 시 upload.ts 파생 컬럼과 중복 여부 확인 필수. 수정 1파일(upload.ts)+DDL 1건 |

**아카이브:** D1-AI발송2분기(02-22) | D2-브리핑방식(02-22) | D3-개인화필드체크박스(02-22) | D4-textarea제거(02-22) | D5-별도컴포넌트분리(02-22) | D6-대시보드레이아웃(02-22) | D7-헤더탭스타일(02-23) | D8-AUTO/PRO뱃지(02-23) | D9-캘린더상태기준(02-23) | D10-6차세션분할(02-23) | D11-KCP전환(02-23) | D12-이용약관(02-23) | D13-수신거부SoT(02-23) | D14-7차3세션분할(02-24) | D15-제목머지→D28번복(02-25) | D16-스팸테스트과금(02-25) | D17-테스트통계확장(02-25) | D18-정산자체헬퍼(02-25) | D19-구독상태필드(02-25) | D20-AI분석차별화(02-25) | D21-planInfo실시간(02-25) | D22-스팸잠금직접발송만(02-25) | D23-preview보안(02-25) | D24-run세션1완전구현(02-25) | D25-pdfkit선택(02-25) | D26-분석캐싱24h(02-25) | D27-비즈니스3회최적화(02-25) | D28-제목머지제거(02-25) | D29-5경로전수점검(02-25) | D30-즉시sending전환(02-25) | D31-GPT fallback(02-25) | D32-발송파이프라인복구(02-26) | D33-messageUtils통합(02-26) | D34-스팸필터DB직접조회(02-26) | D35-선불환불보장(02-26) | D-대시보드모달분리(02-23): 8,039줄→4,964줄

---

## 10) ASSUMPTION LEDGER (가정 목록)

(아직 없음)

---

## 11) RISK REGISTER (리스크 목록)
| ID | 리스크 | 확률(1-5) | 영향(1-5) | 점수 | 대응 |
|----|--------|-----------|-----------|------|------|
| R1 | TypeScript 타입 에러 배포 → 서버 크래시 | 2 | 5 | 10 | 배포 전 tsc --noEmit 필수 체크 |
| R2 | DB 파괴적 작업 시 데이터 유실 | 2 | 5 | 10 | pg_dump 백업 후 작업, 트랜잭션 활용 |
| R3 | QTmsg sendreq_time UTC/KST 혼동 | 1 | 4 | 4 | ✅ 해결: database.ts 풀 레벨 KST 보장 |
| R4 | 라인그룹 미설정 고객사 → 전체 라인 폴백 오발송 | 1 | 5 | 5 | ✅ 해결: 이중 방어 적용 |
| R5 | QTmsg LIVE→LOG 이동 후 결과 조회 불가 | 1 | 4 | 4 | ✅ 해결: LIVE+LOG 통합 조회 |
| R6 | 스팸필터 동시 테스트 시 결과 충돌 | 1 | 4 | 4 | ✅ 해결: SHA-256 세션 격리 + 디바이스 fallback |
| R15 | 발송 5개 경로 치환 로직 분산 → 재발 | 1 | 5 | 5 | ✅ 해결: messageUtils.ts 통합 |
| R16 | results.ts 대량 캠페인 OOM | 1 | 4 | 4 | ✅ 해결: UNION ALL 서버측 페이지네이션 |
| R17 | 선불 차감 후 발송 실패 → 정산 이슈 | 1 | 5 | 5 | ✅ 해결: 3경로 prepaidRefund + D57 C1 선별적 환불(부분실패 정확 환불) |
| R21 | standard_fields ↔ 코드 하드코딩 불일치 | 1 | 5 | 5 | ✅ 해결: D39 3세션 완료 — FIELD_MAP 단일 기준 |
| R22 | MySQL 외부 노출 → 랜섬웨어/데이터 삭제 | 1 | 5 | 5 | ✅ 해결: D49 — 127.0.0.1 바인딩+smsuser DROP 제거+비밀번호 강화+fail2ban+UFW |
| R23 | Docker 컨테이너 재생성 시 포트 바인딩 0.0.0.0 실수 | 2 | 5 | 10 | ⚠️ 운영: 컨테이너 작업 시 반드시 `docker ps --format` 포트 확인. OPS.md에 안전 명령어 기록 |
| R24 | SQL Injection → 내부 DB 공격 (127.0.0.1 우회) | 1 | 5 | 5 | ✅ 해결: D56 테이블명 화이트리스트 + D57-C4 sendTime 파라미터화 + **D59 custom_fields JSONB 키 화이트리스트(safe-field-name.ts 신규, campaigns/customers/ai 3파일 적용) + dateFilter MySQL 파라미터화 + mms-images UUID 검증 + upload.ts path.basename 경로탐색 방어** |
| R29 | 스팸필터 테스트 선불 차감 누락 → 무과금 발송 | 1 | 3 | 3 | ✅ 해결: D56 — spam-filter.ts에 prepaidDeduct 적용, 테스트폰×메시지타입 건수 차감 |
| R26 | JWT_SECRET/MYSQL_PASSWORD 환경변수 누락 → 서버 기동 실패 | 1 | 5 | 5 | ✅ 해결: D55 — fail-fast 적용, 폴백값 완전 제거. dotenv.config() app.ts 최상단 이동으로 로딩 순서 보장 |
| R27 | 슈퍼관리자 세션 무제한 → 토큰 탈취 시 24시간 악용 | 1 | 5 | 5 | ✅ 해결: D55 — 세션 레코드 생성+30분 타임아웃+서버측 세션 체크 적용 |
| R28 | Math.random() 임시비밀번호 → 예측 가능 | 1 | 3 | 3 | ✅ 해결: D55 — crypto.randomInt() CSPRNG 교체 |
| R25 | 백업 부재 → 랜섬웨어 시 복구 불가 | 1 | 3 | 3 | ✅ 해결: 2026-03-05 — pg_dump+mysqldump 자동화, 59번 서버(58.227.193.59) SCP 전송, SSH 키 인증, crontab 매일 03:00, 7일 보관 |
| R30 | 전화번호 정규화 불일치 → 개인화 메시지 치환 실패 | 1 | 4 | 4 | ✅ 해결: D57 C2 — normalizePhone() 단일함수 통일, directCustomerMap 키 불일치 수정 |
| R31 | 분할발송 시간 오버플로우 → 심야/새벽 발송 | 1 | 4 | 4 | ✅ 해결: D57 C3 — calcSplitSendTime() SEND_HOURS 경계 체크, 환경변수 기반 |
| R32 | AI발송 sendTime SQL Injection | 1 | 5 | 5 | ✅ 해결: D57 C4 — 템플릿 리터럴 삽입 제거, ? 파라미터화 |
| R33 | 테스트발송 bill_id 빈문자열 → 결과 추적 불가 | 1 | 3 | 3 | ✅ 해결: D57 C5 — randomUUID() 고유 추적ID 생성 |
| R34 | Redis 연결 에러 → 서버 크래시 | 1 | 5 | 5 | ✅ 해결: D59 — redis.on('error') 에러 핸들러 추가 |
| R35 | unhandledRejection/uncaughtException → 로깅 없이 서버 크래시 | 1 | 5 | 5 | ✅ 해결: D59 — process.on 핸들러 추가, PM2 자동 재시작 연계 |
| R36 | PostgreSQL Pool 커넥션 부족/누수 | 1 | 4 | 4 | ✅ 해결: D59 — max/idleTimeout/connectionTimeout 환경변수 기반 설정 |
| R37 | 수신거부번호 미로딩 상태 발송 → 법적 문제 | 1 | 5 | 5 | ✅ 해결: D59 — optOutNumber 초기값 '' + 3개 발송함수 가드 |
| R38 | 발송 상태 플래그 교차 미체크 → 동시 발송 | 1 | 3 | 3 | ✅ 해결: D59 — isSending/directSending 교차체크 3곳 |

---

## 12) ✅ DONE LOG (완료 기록)
> 항목이 10개를 초과하면 오래된 항목은 아카이브로 이동하고 1줄 요약만 남긴다.
> 상세 변경 이력은 Git 커밋 히스토리 참고.

| 날짜 | 완료 항목 |
|------|----------|
| 03-20 | **D88 QA 버그리포트 11건(7그룹) 전면 수정:** 테스터 PPT 버그리포트 기반. (A) DashboardHeader isSubscriptionLocked+lockGuard+auto-campaigns checkPlanGating 구독/트라이얼 체크. (B) CustomerDBModal boolean 자동 드롭다운+enabled-fields 자동 타입 감지(샘플20건)+customer-filter contains→eq 전환. (C) ai.ts parse-briefing 타겟 필터 sampleCustomer+AiCustomSendFlow replaceVars field_key→field_label 매핑+messageUtils string→Number 파싱+toLocaleString. (D) companies.ts company_admin 전체 조회+CT-08 확인 모달 4경로 적용. (E) upload.ts admin 본인 user_id 수신거부 INSERT. (F) customers.ts filterUserId store_codes 기준. (G) spam-test-queue.ts 광고문구 래핑. 수정 11파일. tsc 프론트+백엔드 통과. **기간계 무접촉.** |
| 03-08 | **D61 프론트엔드 난독화 적용:** vite-plugin-javascript-obfuscator — frontend+company-frontend 양쪽 vite.config.ts. production 빌드 시에만 활성화(mode === 'production'). stringArray+base64 인코딩, disableConsoleOutput, identifierNamesGenerator('hexadecimal'), splitStrings. 개발 환경(npm run dev) 무영향. 서버 배포 시 npm install 필요. |
| 03-08 | **D60 SyncAgent API Key 관리 + 사용자별 라인그룹 배정:** (1) SyncAgent: 고객사 편집 모달 9번째 탭 'Sync' 추가. 백엔드 3개 엔드포인트(GET sync-keys, POST regenerate, PUT use_db_sync 토글). 프론트 마스킹+보기/숨김+복사+2단계 재발급 확인 UI. (2) 사용자별 라인그룹: DDL users.line_group_id uuid FK nullable 추가(실행 완료). campaigns.ts getCompanySmsTables(companyId, userId?) 확장—사용자 개별 라인그룹 우선→회사 fallback. admin.ts 사용자 수정 API lineGroupId 추가+사용자 목록에 line_group_name 포함. 프론트 사용자 편집 모달에 라인그룹 드롭다운(슈퍼관리자 전용). 고객사 편집 모달 너비 max-w-lg→max-w-2xl+탭 UI 개선. 수정 3파일(admin.ts, campaigns.ts, AdminDashboard.tsx)+DDL 1건+신규 1파일(DDL-user-line-group.sql). **기간계: getCompanySmsTables userId optional 추가만, 기존 호출 100% 호환.** tsc 통과. |
| 03-07 | **D59 2차 코드 전수점검 P1~P6 총 28건 수정 완료:** **(P1 정산/데이터 3건)** ai.ts `\|\|10`→`??10` AI추정 0%치환 버그 수정. analysis.ts 하드코딩 `totalSent*15` 제거→채널별(SMS/LMS/MMS/KAKAO) getCompanyCosts() 정확 비용 계산. manage-stats.ts dead code 4줄 삭제. **(P2 SQL Injection 4건)** safe-field-name.ts 신규(custom_1~15 화이트리스트)→campaigns.ts buildFilterQuery, customers.ts buildDynamicFilter, ai.ts buildFilterWhereClause 3곳 적용. campaigns.ts dateFilter MySQL `?` 파라미터화+DATE_FORMAT 정규식 검증. **(P3 입력검증 3건)** mms-images.ts companyId UUID 정규식 검증. upload.ts `path.basename(fileId)` 디렉토리 탐색 방어. manage-users.ts 비밀번호 8~72자 bcrypt 안전 범위 검증. **(P4 하드코딩 5건)** admin.ts+manage-users.ts SMS 회신번호→`SYSTEM_SMS_CALLBACK` 환경변수(미설정 시 throw). defaults.ts `INVITO_INFO` 상수 신규+billing.ts PDF 2곳+이메일 2곳 import 교체. 프론트엔드 5곳 `©2026`→`©{new Date().getFullYear()}`. `constants/company.ts` 신규(frontend+company-frontend)+8파일 15곳 회사정보 상수 교체. **(P5 인프라 4건)** defaults.ts Redis error handler. ai.ts AI API 키 미설정 console.warn. app.ts unhandledRejection+uncaughtException PM2 연계. database.ts PG Pool max/idle/connection 환경변수 기반. **(P6 프론트 4건)** Dashboard.tsx setInterval→useRef+useEffect cleanup. optOutNumber 초기값''→미로딩 시 발송차단 가드 3곳. isSending/directSending 교차 중복 발송 방지 3곳. console.log 4줄 삭제. **(P7 장기 8건)** CODE-REVIEW-P7-BACKLOG.md 기록. 수정 20파일+신규 4파일. **기간계 무접촉. tsc backend+frontend+company-frontend 3패키지 전체 통과.** |
| 03-06 | **D58 12차 버그리포트 4건+기능개선 3건 전체 완료:** (B12-01) 예약취소 DELETE(pending)+UPDATE(Agent 픽업건→9999) 이중처리 (B12-02) sync-results 60분 타임아웃 강제완료+환불 (B12-03) 스팸필터 subject/firstRecipient 전달 (B12-04) 특수문자/보관함/저장 모달 showDirectSend 바깥 이동→공용화 (F12-01) AI 결과팝업 머지태그 원본 표시 (F12-02) 필터 UI 전면개선: 성별 자동감지(`isGenderField` 패턴매칭)+다양한 DB값 한글 매핑, 생일 월별 프리셋+`birth_month` 오퍼레이터, 금액 최소~최대 범위 입력(콤마포맷+'원' 단위+빠른선택 버튼+`col-span-2`+백엔드 `between` 대응), 수신자 테이블 `formatCellValue` 성별 한글 표시 (F12-03) 타겟발송 담당자테스트 버튼(3열 그리드+`handleTargetTestSend`+10초 쿨다운). 수정 7파일(campaigns.ts, Dashboard.tsx, TargetSendModal.tsx, DirectTargetFilterModal.tsx, AiCampaignResultPopup.tsx, CalendarModal.tsx, customers.ts). **기간계 무접촉.** |
| 03-05 | **나래 080 수신거부 콜백 연동 완료:** (1) 나래 담당자 콜백 URL 등록 확인 (2) 실제 080 ARS 테스트 — 나래 IP(183.98.207.13) 콜백 수신+수신거부 DB 등록 정상 (3) OPT_OUT_080_TOKEN 검증 제거→Nginx IP 화이트리스트(나래 6개 IP)로 보안 대체 (4) 기존 누적 수신거부: 한줄로 이관 시 수동 처리 예정. 수정 1파일(unsubscribes.ts). **기간계 무접촉.** |
| 03-05 | **D57 P0-C1~C5 발송 파이프라인 안정화 5건:** (C1) AI발송+직접발송 per-customer/per-batch try/catch→sentCount 추적→부분실패 선별적 환불. (C2) normalize-phone.ts 신규→campaigns.ts 27곳 통일+directCustomerMap 키 불일치 핵심버그 수정. (C3) calcSplitSendTime() SEND_HOURS 경계→오버플로우 방지, defaults.ts SEND_HOURS 추가. (C4) AI발송 sendTime `?` 파라미터화. (C5) 테스트발송 bill_id→randomUUID()+실패건 DB 기록+응답 testRequestUid. 수정 2파일(campaigns.ts, defaults.ts)+신규 1파일(normalize-phone.ts). TypeScript 0에러. **기간계 발송 흐름 자체 변경 없음** |
| 03-05 | **D56 P0-Q1 SQL Injection 방지 + 스팸필터 선불차감:** (1) sms-table-validator.ts 신규 — `/^SMSQ_SEND(_\d{1,3})?(_\d{4,8})?$/` 화이트리스트 정규식, validateSmsTable/validateSmsTables/isValidSmsTable 3함수 export. (2) admin.ts — POST/PUT `/api/admin/line-groups` 라인그룹 생성·수정 API에서 smsTables 검증, 잘못된 테이블명 400 거부. (3) campaigns.ts — 서버 기동 시 ALL_SMS_TABLES 검증(경고 로그, 기동 미차단) + getCompanySmsTables DB 조회 결과 필터링(잘못된 값 스킵→BULK_ONLY_TABLES 폴백) + prepaidDeduct/prepaidRefund export 추가. (4) spam-filter.ts — POST `/test`에 선불 잔액 차감 추가: testId 생성 후 prepaidDeduct(companyId, spamSendCount, spamDeductType, testId) 호출, 잔액 부족 시 402+테스트 cancelled, 응답에 deducted 금액 포함. 수정 3파일(admin.ts, campaigns.ts, spam-filter.ts)+신규 1파일(sms-table-validator.ts). TypeScript 타입 에러 0건. **기간계 무접촉. 배포+실서버 선불차감 로그 확인 완료.** |
| 03-05 | **D55 보안 긴급점검 + 슈퍼관리자 세션 관리 + 세션 타이머 UI (코드+DDL+배포 완료):** (1) JWT_SECRET fail-fast — auth.ts 미들웨어에서 환경변수 미설정 시 `process.exit(1)` 서버 기동 차단, 폴백값 `'dev-only-secret'` 제거. (2) mms-images.ts 자체 JWT 인증(`'your-secret-key'`) 완전 제거 → 공용 `authenticate` 미들웨어로 교체. (3) MYSQL_PASSWORD fail-fast — database.ts에서 미설정 시 `process.exit(1)`, 폴백값 `'sms123'` 제거. (4) dotenv.config() 로딩 순서 수정 — app.ts 최상단(1행)으로 이동, 모듈 import 전에 환경변수 로딩 보장. (5) Math.random()→crypto.randomInt() — admin.ts/manage-users.ts 임시비밀번호 생성을 암호학적 안전 난수로 교체. (6) 슈퍼관리자 세션 관리 — DDL-D55로 user_sessions.user_id FK 제거(super_admins ID INSERT 허용, 보안영향 없음=서버코드만 INSERT) + 로그인 시 user_sessions 레코드 생성+sessionId JWT 포함+기존 세션 무효화, auth.ts 미들웨어 `super_admin` 세션체크 건너뛰기 제거 + expires_at 서버측 만료 강제(브라우저 닫았다 열어도 서버가 차단), extend-session 슈퍼관리자 지원, defaults.ts `superAdminSessionMinutes: 30` (환경변수 변경 가능). (7) 프론트엔드 useSessionGuard 슈퍼관리자 스킵 제거 → 30초마다 서버 세션 체크. (8) 은행 스타일 세션 타이머 UI — SessionTimer.tsx 신규 컴포넌트(초록/주황/빨강 색상전환+5분미만 깜빡임+클릭 세션연장), SessionTimerContext Provider(App.tsx), DashboardHeader+AdminDashboard 양쪽 헤더에 삽입. 수정 12파일(app.ts, auth.ts미들웨어, auth.ts라우트, mms-images.ts, database.ts, defaults.ts, admin.ts, manage-users.ts, useSessionGuard.ts, useSessionTimeout.ts, App.tsx, DashboardHeader.tsx, AdminDashboard.tsx)+신규1파일(SessionTimer.tsx)+DDL 1건 실행 완료(`docker exec -it targetup-postgres psql -U targetup targetup`). **기간계 무접촉.** |
| 03-05 | **D54 스팸필터 폴링 로직 개선 + 이력 탭 추가:** (1) QTmsg 성공 후 3분 대기→10초 대기 후 BLOCKED 판정으로 변경 (qtmsgSuccessTime Map 기반 시점 추적, BLOCKED_GRACE_MS=10초). 실서버 테스트로 앱 ACK 즉시 수신 확인 후 Harold님과 합의. (2) 타임아웃 180초→60초(안전장치), 안전 강제종료 240초→90초 (defaults.ts). (3) 프론트 SpamFilterTestModal.tsx 카운트다운 180→60초 동기화. (4) SpamFilterTestModal에 **내 테스트 이력 탭** 추가 — `/api/spam-filter/tests?mine=true` 본인 필터 + 메시지 내용 반환 + 통신사별 판정결과 펼침 UI. 수정 3파일(spam-filter.ts, defaults.ts, SpamFilterTestModal.tsx). **기간계(발송파이프라인) 무접촉.** |
| 03-05 | **D53 DB 실행 완료 + 백업 자동화 구축 + AI 맞춤한줄 Phase 2 문서 정정:** (1) plans 테이블 3컬럼 ALTER TABLE + 6개 요금제 UPDATE 실서버 실행 완료 (2) 외부 백업 자동화 — pg_dump+mysqldump → 59번 서버(58.227.193.59:27616) SCP 전송, SSH 키 인증, crontab 매일 03:00, 7일 보관. R25 리스크 해소 (3) AI 맞춤한줄 Phase 2 코드 검증 — 실제로 발송 연결 전체 구현 완료 확인(AiCustomSendFlow→Dashboard→campaignsApi.create+send), STATUS.md Phase 2 항목 [x] 갱신 |
| 03-04 | **D53 요금제별 기능 게이팅 구현 + 배포 완료:** plans 테이블 3컬럼 추가(customer_db_enabled/spam_filter_enabled/ai_messaging_enabled)+5개 요금제+ENTERPRISE 플래그 설정. 백엔드 5파일 게이팅(companies.ts my-plan 확장, spam-filter.ts/ai.ts 3엔드포인트/upload.ts parse·save/customers.ts extract). 프론트 4파일(Dashboard.tsx PlanInfo 확장+하드코딩 가격체크 제거+3카드 잠금UI, DashboardHeader.tsx 캘린더 게이팅, PlanUpgradeModal.tsx 범용화 featureName/requiredPlan, SpamFilterLockModal.tsx 프로→스타터 텍스트 수정). tsc 에러 2건 수정(auth.ts jwt.sign 타입/campaigns.ts useIndividualCallback 선언순서). SCHEMA.md plans 테이블 반영. **기간계 무접촉.** |
| 03-04 | **프로젝트 루트 정리 (~1.51GB 확보):** 오래된 DB 백업 8개 삭제(backup_docker/for_server/utf8/before_sync/before_billing/before_maxusers/sync_phase4/20260214_kakao_enabled.sql, 총 1.46GB) + 일회성 SQL 패치 8개 삭제(fix_admin/fix_password/add_columns/update_schema/seed_customers/migration-phase1a/migration_plan_requests/sync_ddl.sql) + qtmsg_5agents.tgz(48MB) 삭제 + 빈 폴더 2개 삭제(files/, targetup-app/). git 히스토리 정리는 추후 결정 예정 |
| 03-04 | **10차 버그리포트 7건 전체 수정 (B10-01~07):** 직원 PDF 버그리포팅 기반. ①B10-01 🔴 customers.ts store_code 격리 누락 — GET `/`, POST `/filter`, GET `/filter-options`, GET `/enabled-fields` 4개 엔드포인트 `uploaded_by`→`store_codes` JOIN 패턴 통일 ②B10-07 🔴 campaigns.ts 회신번호 검증 UNION 누락 — `/:id/send`+`/direct-send` 2곳에 `sender_numbers UNION callback_numbers` 적용 ③B10-06 ai.ts 등급 하드코딩(`VIP,GOLD,SILVER,BRONZE`)→`SELECT DISTINCT` 실시간 조회+키워드맵 정리 ④B10-04 normalize.ts `normalizeDate()` 엑셀 시리얼넘버 변환 추가 ⑤B10-05 normalize.ts `isValidKoreanPhone()` 050x 안심번호 허용 ⑥B10-03 upload.ts AI 매핑 프롬프트 매장4필드 구분규칙 추가 ⑦B10-02 CustomerDBModal.tsx 커스텀필드 라벨 `fieldColumns` 조회 표시. **기간계 무접촉 확인.** 수정 6파일(campaigns.ts, normalize.ts, ai.ts, customers.ts, upload.ts, CustomerDBModal.tsx) |
| 03-04 | 스팸필터 테스트 LMS 제목 누락 수정: 전 구간(프론트→백엔드→MySQL)에서 subject가 빠져있던 문제. ①Dashboard.tsx spamFilterData 타입에 subject 추가+직접발송 스팸필터 호출에 directSubject 전달 ②SpamFilterTestModal.tsx subject prop 추가+API body에 subject 전달+LMS 미리보기에 제목 표시 ③spam-filter.ts req.body에서 subject 추출+insertSmsQueue에 title_str 컬럼 추가. ⚠️ PG spam_filter_tests에 subject/message_type 컬럼 미존재 확인(SCHEMA.md와 실제 DB 불일치) — PG INSERT는 기존 유지, MySQL title_str만 추가. 수정 3파일(spam-filter.ts, SpamFilterTestModal.tsx, Dashboard.tsx) |
| 02-28 | D43-7 Phase 4 결과코드 매핑 3-Tier 전수 점검 완료: **18파일 점검, 하드코딩 잔존 0건.** admin.ts 5곳 전환(statusMap7개+carrierMap3개 로컬삭제→getStatusLabel(22개)/getCarrierLabel(9개)+statusType 추가) + billing.ts 5곳 전환(3개 집계함수→SUCCESS_CODES_SQL/PENDING_CODES_SQL) + **billing.ts `>=200` 버그 수정**(비가입자7/Power-off8/스팸차단16 등 200미만 실패코드 정산 누락 해소). AdminDashboard.tsx statusType 동적분기. ResultsModal.tsx sampleData9개 삭제→messages[0].msg_contents 동적치환. 서비스/관리자/슈퍼관리자 프론트 12파일 점검 깨끗. 수정 4파일(admin.ts, billing.ts, AdminDashboard.tsx, ResultsModal.tsx) |
| 02-28 | 🔴 D49 MySQL 랜섬웨어 긴급 대응: 원인(3306 외부 노출+취약 비밀번호→봇 공격→SMSQ_SEND_1~11 삭제). 복구(127.0.0.1 바인딩+테이블 재생성+로그 테이블 복구+Agent 재시작+이벤트 스케줄러 확인). 보안 강화(root/smsuser 비밀번호 강화+Agent encrypt_pass DES 암호화 동기 변경+smsuser DROP 권한 제거+UFW 3000/9001~9011 차단+SSH root 로그인 차단+fail2ban 3회→1h밴). 피해: SMSQ 큐만 삭제(복구 완료), PostgreSQL/고객 데이터 무사. 스팸필터 테스트 LG U+ 수신 확인 |
| 02-27 | D43-4 수신거부 양방향 동기화: unsubscribes=SoT 확정, opt_outs 레거시 확인. syncCustomerOptIn 헬퍼+4곳(080콜백/직접추가/업로드/삭제) 적용. DDL opt_out_auto_sync 추가. 프론트 080번호 동적+연동테스트 조건부. curl 테스트 정상. **나래 콜백 미수신→월요일 확인.** 수정 2파일(unsubscribes.ts, Unsubscribes.tsx)+DDL 1건 |
| 02-27 | D43-3c 직접타겟 발송창 하드코딩 전면 제거 + 컴포넌트 분리: TargetSendModal.tsx 신규(901줄)+DirectTargetFilterModal.tsx FieldMeta export+onExtracted fieldsMeta 추가+Dashboard.tsx 638줄 감소(4548→3910)+DirectPreviewModal.tsx 동적치환. 하드코딩 8곳→fieldsMeta 동적. 커서위치 삽입 버그 수정(selectionStart). 발송파이프라인 미접촉 |
| 02-27 | D43-3b 직접타겟 백엔드 버그 3건 수정: ①extract SELECT 하드코딩→getColumnFields() FIELD_MAP 동적+customers_unified→customers 직접조회 ②filter-count도 customers_unified→customers 전환 ③buildDynamicFilter age 필터 EXTRACT(birth_date)→age 컬럼 직접사용 ④DirectTargetFilterModal 에러핸들링+커스텀알림모달 추가. 수정 2파일(customers.ts, DirectTargetFilterModal.tsx) |
| 02-27 | D43 안건#3 직접타겟 리팩토링: DirectTargetFilterModal.tsx 신규(646줄)+Dashboard.tsx 405줄 감소+customers.ts 옵션 동적화+extract SELECT 확장+buildDynamicFilter contains 지원. **🚨 타겟추출→발송모달 연결 버그 미해결 (다음 세션)** |
| 02-27 | D43 안건#5 AI 한줄로 3종 개선: ①개인화필수 파싱(services/ai.ts parsePersonalizationDirective) ②샘플고객 미리보기(routes/ai.ts sample_customer+Dashboard+AiCampaignResultPopup 동적 치환) ③이모지 강제제거(services/ai.ts stripEmojis, SMS/LMS/MMS 후처리). 수정 5파일 |
| 02-27 | D43 안건#2 AI 매핑 화면 개편: 컴포넌트 분리(FileUploadMappingModal.tsx 신규)+태그클릭 2열 그리드+커스텀 +/- 슬롯+upload.ts 백엔드 지원. 수정 3파일 |
| 02-27 | D43 안건#1 회사명 미반영 해결: auth.ts c.name→c.company_name 통일, companies.ts name동기수정+settings company_name추가, Dashboard.tsx DB실시간조회 우선표시. 수정 3파일 |
| 02-27 | D41 세션2 대시보드 대개편 완료 + D42 발송현황 수정: AdminDashboard.tsx 대시보드탭(4/8모드+17종체크)+Dashboard.tsx 고객현황 하드코딩 제거→동적카드+블러+발송현황 3칸(성공건수/성공률/사용금액). 수정 2파일 |
| 02-27 | D41 세션1 백엔드 API: dashboard-card-pool.ts(카드풀17종)+companies.ts(dashboard-cards 집계API)+admin.ts(카드설정 GET/PUT)+idx_company_settings_unique+plans 오염 수정. 신규1+수정2파일 |
| 02-27 | DashboardHeader.tsx AI 분석 메뉴 스타일 변경: 맨 앞 이동, Sparkles 아이콘 제거, gold+emphasized 유지 |
| 02-27 | AI 맞춤한줄 동적 필드 + Step 2 UX 개선 (D40): customers.ts enabled-fields 단일 경로, AiCustomSendFlow.tsx 톤 제거+필드명 태그, ai.ts tone optional. 수정 3파일 |
| 02-27 | D39 세션2 조회+AI 정상화 완료: customers.ts/ai.ts/Dashboard.tsx/AiCustomSendFlow.tsx 하드코딩 4곳 전수 제거→FIELD_MAP 동적. 수정 4파일 |
| 02-26 | D39 세션0+세션1 완료: DDL(store_phone)+standard_fields 32개+standard-field-map.ts 재작성+upload.ts+normalize.ts FIELD_MAP 기반 동적 전환 |
| 02-26 | 코드 실물 검증 5건 + S9-04/S9-08/GP-04 수정 + S9-07 모달 6곳 교체 + upload.ts sanitize/cleanup/인증 |

**아카이브 (02-26 이전):**
- 02-26: 구조적 결함 7건 발견 + D32 공통 치환 함수 통합(messageUtils.ts) + 5개 경로 연결
- 02-25: AI 분석 4세션 완료 + 요금제 기능 제한 + 구독 실시간 반영 + 스팸필터 잠금 + 8차 버그 13건 + GPT fallback + 대시보드 반응속도 개선
- 02-25: 발송통계 고도화 + 7차 3세션 완료 + 6차 11건 완료
- 02-24: 직원 버그리포트 7차 세션1(동적필드전환) + 요금제 게이지바 + 소스보호 + 어드민통계 수정 + 080연동
- 02-23: 대시보드 모달 분리(8039→4964줄) + 헤더 탭스타일 + 배포자동화 + 수신거부통합 + 6차 세션1
- 02-22: 대시보드 레이아웃 전면 개편 + AI 맞춤한줄 Phase 1 시작
- ~02-21: 수신거부 미반영 수정 + 스팸필터 완성 + 업로드 안정화 + 라인그룹 시스템
- ~02-10: 서버 인프라 전체 배포, 핵심 기능 완성, 슈퍼관리자·고객사관리자 대시보드, 정산 시스템, QTmsg Agent 5→11개
