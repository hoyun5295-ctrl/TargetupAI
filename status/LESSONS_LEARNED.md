# TargetUp (한줄로) — 핵심 아키텍처 및 과거 사고 교훈 (Lessons Learned)

> **⚠️ 주의 사항:** 이 문서는 TargetUp의 핵심 아키텍처와 과거에 발생했던 치명적인 서비스 사고(장애) 내역, 그리고 AI 협업 시 반복적으로 발생한 메타 위반 패턴을 담고 있습니다. 코드를 수정하기 전에 본인이 작업하려는 도메인(예: 필드 매핑, 수신거부, 발송 등)과 관련된 교훈이 있는지 반드시 검색하고 숙지하십시오.

---

## 1. 핵심 아키텍처 (컨트롤타워 체계)

각 도메인의 핵심 로직은 컨트롤타워 유틸(`utils/`) 1곳에만 존재해야 합니다. 인라인 작성을 절대 금지합니다.

### 백엔드 컨트롤타워 (packages/backend/src/utils/)

| CT | 파일 | 역할 |
|---|---|---|
| CT-01 | `customer-filter.ts` | 고객 필터/쿼리 빌더 (campaigns.ts, customers.ts, ai.ts 통합) |
| CT-02 | `store-scope.ts` | 브랜드(store_code) 격리. 사용자별 매장 접근 범위 결정 |
| CT-03 | `unsubscribe-helper.ts` | 수신거부 필터링 및 080 연동 단일 진입점 (user_id 기준 격리) |
| CT-04 | `sms-queue.ts` | MySQL 큐 조작(발송)의 유일 진입점 (하드코딩 테이블명 금지, UNION ALL 기반 집계) |
| CT-05 | `prepaid.ts` | 선불 잔액 관리 (Idempotent 환불 패턴 D145 P0+) |
| CT-06 | `campaign-lifecycle.ts` | 캠페인 취소 및 결과 동기화 |
| CT-07 | `standard-field-map.ts` | 필드 매핑 룰. `FIELD_MAP`은 유일한 기준이며 반드시 동적으로 조회 |
| CT-08 | `callback-filter.ts` | 개별회신번호 필터링 진입점 |
| CT-09 | `spam-test-queue.ts` | 스팸테스트 큐 + 자동 재생성 |
| CT-10 | `sender-registration.ts` | 발신번호 등록/배정 |
| CT-12 | `brand-message.ts` | 브랜드메시지 발송/검증 |
| CT-14 | `deduplicate.ts` | 수신자 중복제거 |
| CT-15 | `saved-segments.ts` | AI 발송 템플릿 저장 |
| CT-16 | `customer-upsert.ts` | customers 테이블 UPSERT 단일 진입점 (region 중복 등 구조적 차단) |
| CT-17 | `plan-guard.ts` | 요금제/기능 게이팅 (`isTrialActive`는 `plan_code` 기준) |
| CT-18 | `enabled-fields.ts` | 활성 필드 탐지 단일 진입점 |
| - | `messageUtils.ts` | 변수 치환 (5개 발송 경로 통합) + 광고+080 + KISA 제목 |
| - | `normalize.ts` | 값 정규화 + `cellToString` (셀 값 → 문자열 안전 변환) |
| - | `format-number.ts` | 숫자/통화 포맷팅 |

### 프론트엔드 컨트롤타워 (packages/frontend/src/utils/)

| 파일 | 역할 |
|---|---|
| `formatDate.ts` | 포맷팅 + 바이트 계산 + 변수 치환 + `cellToString` (백엔드 normalize.ts 미러) + DIRECT_VAR_MAP + displayValue |

---

## 2. 필수 점검 원칙 (사고 방지)

* **유틸 함수 수정 부작용 (D70~D72):** 컨트롤타워 함수(`enrichWithCustomFields` 등) 반환값 변경 시, 호출부 전수(`grep`)를 확인하지 않아 SQL 에러 및 프론트 표시 누락 사고 반복. 수정 시 소비처 100% 점검 필수.
* **동적 참조 원칙 (D74):** FIELD_MAP 등 컨트롤타워 데이터를 소비할 때 하드코딩(switch/if) 금지. 새 필드 추가 시 동적 루프가 자동 처리하도록 설계해야 누락 방지.
* **표시 경로까지 확인 (D102~D106):** 발송 백엔드 로직만 패치하고 프론트 표시(미리보기, 대시보드, 캘린더 등)를 빼먹어 "(광고) 텍스트 중복 표시" 등의 문제가 수차례 재발. 발송 경로 + 표시 경로 모두 grep 필수.
* **falsy 패턴 전수 grep (D150-3):** `|| ''`, `if (!val)` 등 falsy 처리 패턴이 여러 곳에 분산되어 0/'0'/false 보존 사고 반복. 1곳만 수정 금지, 동일 패턴 전 영역 grep 후 통합 수정.

---

## 3. 과거 치명적 사고 이력 (오답 노트)

| 교훈 / 사고 번호 | 상세 내용 및 대책 |
|---|---|
| **D152 (AI 다듬기 In-Context Learning 창작 사고)** | AI 메시지 다듬기 시스템 프롬프트에 모범 예시 박을 때 "매장에서 만나뵐게요"/"단 3일 한정" 같은 원본에 없는 표현을 무심코 박으면 AI가 그대로 학습 → 모든 회사 다듬기 결과에 임의 창작 확산 → 다듬기 ≠ 창작 = 사고. 직접발송 phone-only 데이터에 AI가 `%이름%` 임의 추가하면 발송 시 "%이름%님 안녕하세요" 그대로 발송. **대책:** ① 시스템 프롬프트 §1 최상위 "원본에 없는 정보 절대 추가 금지". ② In-Context 4개 모두 원본 정보만 사용한 진짜 다듬기 예시로. ③ negative example 1개 명시. ④ 후처리 `removeAddedVariables` — 원본에 없는 변수 + 후속 조사 자동 제거. ⑤ `appendMissingVariables` — 원본 변수 보존. AI 모범 예시 박을 때 1줄 1줄 검토 필수. |
| **D152 (AI 다듬기 보수성 ↔ 풍성성 균형 사고)** | 창작 사고 차단을 위해 시스템 프롬프트 §1을 너무 보수적으로 박음("원본 정보 100% 유지 + 톤/특수문자/어순만") → AI가 안전한 단어 정리 수준만 → 사용자 "API로 다듬은 거 맞아?" 의문 발생. "증정" 같은 단어 삭제로 의미 모호화 사고까지. **대책:** "보존 영역(상품/할인율/일시/숫자/매장/연락처/이벤트명)" vs "자유 영역(수식어/감성/계절 묘사/감사 인사/CTA)" **명확히 분리** + 길이 80~150% 허용. `getSeasonContext()` helper(현재 월 기반 자동 시즌 키워드) + systemPrompt 자동 박음으로 시즌감 풍성 + 사실 보존 균형. 후처리 길이 필터(d-2) — 원본 50자+ 결과 70% 미만 = 정보 손실 의심 제외. **다듬기는 "사실 변경 X" + "표현 풍성 O" 양방향 균형**이지 어느 쪽 단방향으로 박으면 사고. |
| **D152 (SMS EUC-KR 인코딩 이모지 발송 깨짐)** | AI 다듬기 시스템 프롬프트에 "이모지 1~2개 적절 추가" + In-Context 예시(😊⚡✨🤝)에 이모지 박음 → AI가 학습 → 다듬기 결과에 유니코드 픽토그램 박혀서 SMS/LMS EUC-KR 발송 시 깨지거나 `?`로 변환 = 발송 사고. **대책:** ① 시스템 프롬프트 §3 "유니코드 이모지 절대 금지 + SMS 호환 특수문자만" 명시 + 화이트리스트 박음. ② `SMS_SAFE_SPECIAL_CHARS` 47개 (Dashboard:3410 특수문자 모달 리스트 그대로 — EUC-KR 호환 검증된 ★/☆/♥/♡/◆/◇/■/□/▲/△/▶/◀/●/○/◎/♨/※/☞/☎/①~⑧/㈜/㎝/㎏/㎡ 등). ③ `stripIncompatibleEmojis` 후처리(z단계) — 화이트리스트 외 비-ASCII 비-한글 자동 제거 + variation selector + ZWJ 제거. **EUC-KR 발송 채널에선 unicode 픽토그램 모두 사고 — 화이트리스트 방식 + 후처리 안전망 박아야 함.** |
| **D152 (template literal 텍스트 내 raw 백틱 tsc 사고)** | 시스템 프롬프트 텍스트 안에 "?로 변환됨" 표현을 위해 ` `?` ` 박음(백틱 강조) → outer template literal 종료 → TypeScript parser가 닫는 백틱에서 `:` 기대 (`?:` 삼항 또는 object key 추정) → tsc 에러 "':'  expected" → atomic safe-build 빌드 실패. **대책:** template literal(\`...\`) 안의 일반 텍스트 내용에 **raw 백틱(`) 절대 박지 말 것**. 강조하려면 큰따옴표 또는 작은따옴표 + 다른 표현 사용. 다국어/특수 문자 강조 시 escape(\\`) 또는 단어 자체 변경. **systemPrompt 같은 큰 template literal 작성 후 tsc 사전 검증 필수** — atomic safe-build 안전망이 잡아주긴 하지만 빌드 사이클 시간 낭비. |
| **D152-1 (form-data v4 multipart filename RFC 5987 자동 변환 X)** | `requestInspectionWithFile` D149-#B(2026-05-08) 검증은 영문 파일명(`2대1.jpg`) byte 단위 일치만 확인됨. 5/11 직원이 한글 파일명(`11비율.jpg`)으로 시도 → IMC 측 미리보기 깨짐. `node_modules/form-data/lib/form_data.js:218-237` `_getContentDisposition` 정독 결과 `filename="..."` 그대로 헤더에 박음, RFC 5987(`filename*=UTF-8''<encoded>`) 자동 처리 X → 한줄로 → IMC HTTP 헤더에 한글 byte 그대로 → IMC Java/Spring 서버 latin1 해석 → 확장자 추출 실패 → octet-stream 인식 → 미리보기 깨짐. **대책:** `toAsciiSafeFilename(filename)` 헬퍼 신설 — ASCII 영문/숫자/`.-_`만 통과, 한글/특수 포함 시 `evidence_${Date.now()}.${ext}` 변환. 원본 파일명은 PG `inspection_evidence_filename`에 보존, IMC 전송 시점만 변환. 3곳(requestInspectionWithFile/uploadSingleImage/uploadMultipleImages) 적용. **외부 라이브러리 동작은 영문/ASCII 케이스만 검증하면 한글 케이스 회귀 위험 — 검증 시 한글 파일명 케이스 필수 커버.** |
| **D151-2 (환불 워커 부재 1년 반복)** | Dashboard 진입 의존 fire-and-forget sync(D144) 한계 — 사용자가 화면 안 보면 대기→실패 전환 시 sync 0회 → PG `fail_count` 미증가 → 환불 함수 호출 0건. 스킨큐어 5/11 사례: 547건 실패 중 251건만 환불, 293건 누락 8.5시간 영속. D145 P0+ idempotent 함수측은 박혔으나 **호출 트리거가 없어서** 1년 반복. **대책:** `campaign-sync-worker.ts` 5분 cron 신설(`utils/campaign-sync-worker.ts`), 최근 24h pending>0 회사 자동 sync. idempotent 함수는 누가 호출만 하면 자동 차액 환불. 라이브 +8,158원 자동 환불 검증. D144 메모리의 "추가 워커 불필요 확인"이 오판이었음. |
| **D151-6 (devDependencies skip 한 세션 2회)** | 운영 서버 `NODE_ENV=production` → `npm install`이 devDependencies skip → tsc 빌드 1,310 에러(backend) → 21,328 에러(frontend) 한 세션에서 동일 패턴 반복. atomic safe-build(D145)가 옛 dist 유지로 사이트 차단 0초였지만 새 dist 미진입 = 운영 stale. **메모리 박는 것만으론 동일 세션 2회 반복 차단 불가** = 빌드 스크립트 자체 영구 코드 필요. **대책:** `packages/backend/scripts/safe-build.sh` + `packages/frontend/scripts/safe-build.sh` 둘 다 첫 단계에 `if [ ! -d "node_modules/typescript" ]; then npm install --include=dev; fi` 추가 — 다음 빌드부터 자동 보장. |
| **D150-5 (UX 3건 통합)** | PDF #4 캘린더 모달 예약/발송 시간 중복 표시 → 발송 1개로 통일(sent_at \|\| scheduled_at). PDF #6 발신번호 등록 기타명의 안내문에 통신가입증명원 누락 + 파일 매칭 select 옵션 누락. PDF #2 슈퍼관리자 충전관리/정산생성 단순 select → SearchableSelect 적용. **대책:** D144 P11+P13에서 SearchableSelect 컨트롤타워 신설된 것 확장 적용. UX 사고는 동일 패턴(드롭다운 검색)이 다른 영역에 분산되지 않도록 grep 전수 후 통합 적용. |
| **D150-4 (발송결과 ORDER BY tie)** | 폴라초이스 14df97e7 16,106건이 모두 sendreq_time='2026-05-06 11:00:00' 단일 시각 → `ORDER BY sendreq_time ASC LIMIT 10000 OFFSET ?` tie-breaker 없음 → 청크 1과 2 사이 row 비결정적 분배 → 총 건수 동일하지만 분류별 row 수가 어긋남(직원 신고: 화면 15,450/656 vs 엑셀 15,470/636). **대책:** `dest_no ASC` tie-breaker 추가 (results.ts:591/634/734 3곳, CT-14 deduplicate로 한 캠페인 내 unique 보장). LIMIT/OFFSET 청크 패턴은 unique tie-breaker 필수. |
| **D150-3 (직접발송 0 NULL)** | 엑셀 D2/E2/F2 = 0 값이 `row[col] \|\| ''` falsy 처리로 빈 문자열 변환되어 발송 본문에 NULL로 박힘. 벤제프 113건 잘못 발송. **대책:** `cellToString` 컨트롤타워 신설(frontend formatDate.ts + backend normalize.ts), `\|\| ''` 패턴 25곳+ 일괄 교체. 인라인 `safeStr` 정의 금지 — 컨트롤타워 일관 import. |
| **D150-2 (환불 description 행 단위 모순)** | `prepaid.ts:130` description이 누적 fail × 단가 표시인데 amount는 차액 → 행 단위로 모순 표시 (직원/고객사 오해). **대책:** `alreadyRefunded > 0`이면 신규 환불 건수 + 누적 정보 별도 표시로 행 단위 일치. |
| **D145 (5/7 배포 사고)** | **[가장 치명적]** `tp-deploy-full` 스크립트 실행 중 frontend vite 빌드가 실패하여 `dist` 폴더가 빈 채로 종료. 9시간 거래처 차단 장애. **대책:** `tp-deploy-full` 안내 절대 금지. 빌드는 반드시 `atomic safe-build` (`npm run build:safe` — frontend/backend 모두). dist-new → 검증 → atomic swap. 빌드 실패 시 옛 dist 유지 = 차단 0초. |
| **D145 P0+ (환불 idempotent)** | delta 환불 패턴이 호출/함수 의미 충돌로 트렉스타 17,820원 누락 + 폴라초이스 113,559원 이상지급 양방향 사고. **대책:** count = 누적 fail 그대로 호출, 함수가 alreadyRefunded와 비교해 차액만 환불 (idempotency 함수 측 보장). delta 계산 폐기. |
| **D142 (호출부 의존성 파괴)** | 포맷팅 안전 가드를 함수 호출부(파라미터 전달)에 의존하게 설계했다가, 프론트에서 파라미터 누락하여 콤마 포맷팅 에러가 1년 반복. **대책:** 호출부 의존 전면 폐기. 컨트롤타워 내부에서 스스로 안전한 기본값을 반환하도록 구조 개선. `FIELD_DISPLAY_FORMAT_MAP` 22개 1:1 + `renderFieldValue/displayValue` 단일 진입점. |
| **D136 P1 (전수 확인 누락)** | 버그 원인이 3곳에 산재해 있었으나 `grep` 전수 확인 없이 1곳만 수정하고 "완료" 보고. **대책:** 작업 시작 전 무조건 `grep -rn` 리스트업 및 Harold님 보고 필수. |
| **D134 (DB 제약 조건 불일치)** | SCHEMA.md에 의존하다가 실제 DB의 `CHECK` 제약 조건을 위반하여 마이그레이션 SQL 전건 실패. **대책:** DB 구조는 SCHEMA.md가 아닌 `pg_constraint` 쿼리로 실제 값을 확인 후 작성. |
| **D132 (보조 상태값 오염)** | `subscription_status` 같이 여러 곳에서 덮어쓸 수 있는 보조 상태에 의존하다가 평가 로직 꼬임. **대책:** 요금제 판정 등은 진실의 원천인 단일 필드(`plan_code`)에 의존. |
| **D131 (SyncAgent 누적 합산)** | Agent 상태를 DB 조회 카운트가 아닌 `+=` 누적 합산으로 처리하여 UI에 수만 건으로 표시. **대책:** 통계와 실제 스냅샷 카운트의 의미를 분리. |
| **D110 (하드코딩 테이블명)** | `admin.ts` 상세 조회에 `SMSQ_SEND` 테이블명을 하드코딩하여 완료된 캠페인 데이터를 찾지 못함. **대책:** 테이블 라우팅은 반드시 `getCampaignSmsTables` 등 CT-04 함수 사용. |
| **D106 (LEFT JOIN 모호성)** | 쿼리에 LEFT JOIN 추가 후 `WHERE status` 절이 어느 테이블의 컬럼인지 명시하지 않아 SQL 500 에러. **대책:** JOIN 추가 시 모든 컬럼에 테이블 alias(`c.`, `u.`) 명시 필수. |
| **D98 (MMS 절대경로)** | 서버 절대경로(`/home/admin/...`)를 웹브라우저 `img src`에 그대로 전달하여 이미지 깨짐. **대책:** `mmsServerPathToUrl` 컨트롤타워 활용. |
| **D93 (서버 SSH 계정 잠금)** | AI가 스스로 SSH 접속을 시도하여 비밀번호 오류로 IP가 차단되고 Harold님의 접속까지 막히는 사고. **대책:** AI의 SSH 접속 및 시스템 명령어 직접 실행 일절 금지. |
| **D76 (AI 요일 연산 오류)** | AI에게 날짜 계산을 맡겼다가 요일이 꼬임. **대책:** 날짜/요일 관여 프롬프트에는 반드시 시스템에서 생성한 달력(`getKoreanCalendar`) 제공 필수. |
| **D70 (안전망의 역설)** | 변수 치환 로직에서 `replaceVariables`의 정규식 안전망이 주소록 변수를 빈 값으로 치환하여 삭제. **대책:** 방어 로직이 유효한 데이터를 지우지 않는지 데이터 흐름을 끝까지 검증. |
| **발송 5경로 부분 패치 (반복)** | 발송 버그 수정 시 AI/직접발송/타겟/스케줄/테스트 5경로 중 1곳만 수정하고 방치하여 동일 버그 반복. **대책:** 발송 관련은 `messageUtils.ts`로 통합하거나 5경로 전수 점검 필수. |

---

## 4. AI 메타 위반 패턴 (Harold님 협업 시 반복 사고)

> 코드 사고와 별개로, AI의 답변 패턴/행동에서 반복적으로 발생한 위반 사례. 매 답변 작성 전 이 섹션 확인 필수.

### 4-1. 자기검증 자랑식 출력
- **사례:** "✅ 통과 (추측 0 / 옵션 0 / 떠넘기기 0)" 식의 자기검증 결과를 답변 끝에 자랑처럼 박음.
- **문제:** 자기검증은 내부 행동 룰인데 답변에 자랑식 출력 = 안전 방어 패턴.
- **대책:** MANDATORY_CHECKLIST 출력은 코드 수정/검증 명령어 안내 직전에만. 일반 답변에 검증 자랑 X.

### 4-2. 떠넘기기 표현
- **사례:** "1단계 git push 진행 부탁드립니다", "컨펌 부탁드립니다", "선택해 주세요", "Harold님 판단 영역입니다"
- **문제:** AI가 결정/분석 책임을 Harold님에게 떠넘김. 같은 답변에서 "떠넘기기 0"이라 박아놓고 끝에서 또 발생.
- **대책:** [STANDARD_RESPONSES] 정의된 표준 멘트만 사용. "부탁드립니다" 단어 자체 차단.

### 4-3. 포장식 마크업 자동 출력
- **사례:** "✅ 신설", "📋 다음 단계", "🎯 Root Cause 확정", "✅ 통일 완료" 등 이모지/심볼 남발. 표/단계 늘어놓기.
- **문제:** Harold님은 사실만 짧게 원함. 포장식 출력 = 답변 분량 증가 + 핵심 가림.
- **대책:** `answer_format_strict` 룰 적용. 이모지/✅ 마크 사용 금지. 표는 비교/대조 명확히 필요한 경우만.

### 4-4. 인라인 헬퍼 정의 위반
- **사례:** D150-3 작업 중 `address-books.ts:100`에 `const safeStr = (v: unknown) => ...` 인라인 정의. 컨트롤타워(`utils/normalize.ts`) 사용 룰 위반.
- **문제:** 같은 답변에서 "컨트롤타워 통일"이라 박아놓고 인라인 헬퍼 작성.
- **대책:** 신규 헬퍼 필요 시 반드시 `utils/` 컨트롤타워에 정의 후 import. 라우트 파일 내 인라인 정의 절대 금지.

### 4-5. Harold님 보고 사실 반박/단정
- **사례:** Harold님 "빌드 실패한거잖아" → AI "exit 0 + tsc stderr 0건 = 빌드 통과로 보입니다"라고 단정.
- **문제:** Harold님 보고를 의심하고 AI 출력으로 반박. 끌로드원칙 0번 추측 금지 위반.
- **대책:** Harold님 보고는 단어 그대로 인정. 충돌 시 추가 검증 명령어부터 제공. 반박/단정 금지.

### 4-6. 정보 부족 시 추측 진입
- **사례:** SMSQ_SEND 컬럼명 모르면서 `mobile` 추측 → ERROR 1054. 벤제프 라인 모르면서 SMSQ_SEND_1~12 다 검색 시도.
- **문제:** Harold님께 묻지 않고 추측해서 자원 낭비 + 에러.
- **대책:** `ask_dont_guess` 룰. 컬럼/라인/매핑 모르면 즉시 "Harold님, [정보] 알려주실 수 있을까요?" 형식 질의.

### 4-7. 같은 내용 중복 안내
- **사례:** 빌드/배포 단계 안내를 직전 답변에 박았는데 다음 답변에 같은 내용 또 박음.
- **문제:** 답변 분량 증가 + Harold님 시간 낭비.
- **대책:** 직전 답변 내용 중복 박지 말 것. 새 정보 + 새 검증 결과만.

### 4-8. 컨펌 없이 사이드 grep/SQL 실행
- **사례:** Harold님 컨펌 안 받고 임의로 grep 진행 → "Harold님이 어떻게 할지 컨펌해 달라" 형태로 답변. 사이드 작업으로 분량/시간 낭비.
- **문제:** 워크플로우 4-1 위반. 컨펌 받기 전 작업 진입 X.
- **대책:** SQL/DB/화면 1차 검증 외 모든 grep/Read는 명시적 컨펌 후. 예외: `status/`, `utils/` 컨트롤타워 파일.

### 4-9. 옵션 늘어놓기 (no_option_recommend 위반)
- **사례:** "Fix A/B/C/D 통합 수정안" 형식으로 옵션 4개 나열 후 "어느 것 진행할까요?".
- **문제:** Harold님이 명시적으로 옵션 추천 금지 룰 박았는데 자동 패턴 발생.
- **대책:** 정답 1개만. 모르면 추가 검증 명령어 요청. A/B 분기 자체 금지.

### 4-10. 약속만 하고 위반 반복
- **사례:** "다음 답변부터 떠넘기기 X / 자기검증 자랑 X" 약속 후 다음 답변에서 또 같은 위반.
- **문제:** 약속이 행동에 반영 안 됨. 매 답변 작성 시 의식적 자가 검증 안 함.
- **대책:** MANDATORY_CHECKLIST 매 턴 강제 출력 (코드 수정/명령어 실행 전). 답변 send 전 위반 단어 검열 필수.

---

## 5. 도메인 아키텍처

### 5-1. SMS 발송 5개 경로 (campaigns.ts)

`campaigns.ts`에 5개 발송 경로가 한 파일에 존재한다:

1. `POST /` — AI 캠페인 생성
2. `POST /:id/send` — AI 캠페인 발송
3. `POST /direct-send` — 직접발송 (즉시)
4. `POST /test-send` — 테스트발송
5. `POST /:id/schedule` — 예약발송

**과거 재발 패턴:** "5개 경로 중 1개만 패치하고 나머지 4개를 점검하지 않음" → 동일 버그 재발.
**해결:** `messageUtils.ts`의 `replaceVariables()` 공통 치환 함수로 5경로 통합 (D32~D33).
**원칙:** 발송 관련 수정 시 반드시 5개 경로 전부 확인.

### 5-2. 동적 필드 매핑 체계 ("기준은 하나, 입구는 여럿")

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

- **직접 컬럼 필드 (FIELD_MAP storageType=column):** name, phone, gender, age, birth_date, email, address, region, recent_purchase_store, recent_purchase_amount, total_purchase_amount, purchase_count, recent_purchase_date, store_code, registration_type, registered_store, store_phone, store_name, grade, points, sms_opt_in
- **커스텀 슬롯 15개:** custom_1 ~ custom_15 (custom_fields JSONB)
- **customer_field_definitions 테이블:** 고객사별 커스텀 필드 라벨 정의
- **customer_schema (companies 테이블 JSONB):** 업로드 시 매핑/라벨 메타데이터

### 5-3. 발송 결과값 매핑 (sms-result-map.ts)

QTmsg `status_code`, 통신사 코드, 스팸필터 판정 결과를 한 곳에서 정의:
- `STATUS_CODE_MAP` — 성공(6/1000/1800), 대기(100/104), 실패(7/8/16/55/2008 등)
- `CARRIER_MAP` — 통신사명
- `SPAM_RESULT` — 스팸필터 판정 상수
- 헬퍼: `isSuccess()`, `isFail()`, `isPending()`, `getStatusLabel()` 등

### 5-4. 변수 치환 시스템 (messageUtils.ts)

`replaceVariables(template, customer, fieldMappings, addressBookFields?, options?)` — 메시지 내 `%이름%`, `%등급%` 등의 변수를 실제 고객 데이터로 치환.
- 5개 발송 경로 전부 이 함수 사용.
- 새 변수 추가 시 이 함수만 수정하면 전 경로 자동 반영.
- **4번째 파라미터 `addressBookFields` (D70):** 직접발송 시 주소록 `%기타1/2/3%`, `%회신번호%` 치환. fieldMappings 순회 전에 먼저 치환하여 안전망 regex에 잡히지 않도록 처리.
- **D70 교훈:** 주소록 변수는 fieldMappings에 없으므로, replaceVariables의 잔여 `%...%` 안전망이 빈값으로 제거함. 반드시 안전망 전에 치환해야 함.
- **D150-3 교훈:** `fmtExtra` 내부에서 `if (!val)` falsy 처리 시 number `0`이 빈 문자열로 변환되는 사고 발생. `cellToString` 컨트롤타워(`normalize.ts`) 통해 0/'0' 보존 필수.

### 5-5. 멀티테넌트 격리

- **company_id:** 회사 단위 데이터 격리 (모든 테이블)
- **store_code:** 매장 단위 추가 격리 (다매장 고객사)
- **user_id:** 사용자 단위 (브랜드별 수신거부 등)
- 쿼리 작성 시 반드시 `company_id` 조건 포함.

### 5-6. 자동발송 기능 (D69~)

> 설계 문서: `status/AUTO-SCHEDULE-DESIGN.md`

**개요:** 한 번 설정하면 매월/매주/매일 반복 자동 발송. 프로 요금제 이상.

**DB 테이블:**
- `auto_campaigns` — 스케줄 설정 + 타겟 필터 + 메시지 + 상태
- `auto_campaign_runs` — 매 실행 이력
- `plans.auto_campaign_enabled` — 요금제별 기능 게이팅
- `plans.max_auto_campaigns` — 동시 활성 자동캠페인 수 제한
- `companies.auto_campaign_override` — 회사별 오버라이드

**백엔드 파일:**
- `routes/auto-campaigns.ts` — CRUD API
- `utils/auto-campaign-worker.ts` — PM2 워커 (5분 체크). 4단계 라이프사이클: D-2 AI문안 → D-1 사전알림 → D-day 2시간전 스팸테스트 → D-day 발송

**프론트엔드 파일:**
- `pages/AutoSendPage.tsx`
- `components/AutoSendFormModal.tsx` — 5단계 위저드 모달

**기존 파이프라인 100% 재활용:** customer-filter, sms-queue, messageUtils, unsubscribe-helper, prepaid, campaign-lifecycle, store-scope

**실패 정책:** skip + failed 기록 + next_run_at 전진 (재시도 없음 → 중복 발송 방지)

### 5-7. AI 프리미엄 기능 (D80 — plans.ai_premium_enabled 게이팅)

1. **자동조건완화 (auto-relax):** AI가 매칭 0건 시 조건 완화 (최대 2회 시도)
2. **캠페인 성과 → AI 다음 캠페인 추천:** `aggregateCampaignPerformance()` + `recommendNextCampaign()`
3. **자동발송 AI 문안생성:** D-2 생성 + 스팸테스트 → D-1 담당자 알림 → D-day 발송

### 5-8. AI 메시지 생성 흐름

```
프론트엔드 → POST /api/ai/generate-messages
    → routes/ai.ts (req.body에서 filters 추출, targetInfo 구성)
    → services/ai.ts (generateMessages — Anthropic Claude 우선, OpenAI 폴백)
    → 프롬프트에 타겟 필터조건(등급/성별/연령/지역) + 샘플 고객 포함
```

### 5-9. SMS 발송 흐름

```
PostgreSQL campaigns/campaign_runs 생성
    → MySQL SMSQ_SEND_X 테이블에 INSERT (QTmsg Agent가 실제 발송)
    → 결과: MySQL msg_result_YYYYMM에 기록
    → sync-results: MySQL 결과 → PostgreSQL campaign_runs 업데이트
```

**서버 SMSQ_SEND 구조 (D144 검증):**
- `SMSQ_SEND` = VIEW = `SMSQ_SEND_1 UNION ALL ... SMSQ_SEND_11`
- LIVE: `SMSQ_SEND_1` ~ `SMSQ_SEND_11` (11개 라인 그룹)
- LOG: `SMSQ_SEND_X_YYYYMM` (라인별 월별)
- 라인 그룹 매핑은 `sms_line_groups` 테이블 + `companies.line_group_id` / `users.line_group_id`로 결정. **추측 금지 — Harold님께 회사별 라인 번호 명시 질의.**

---

## 6. 작업 진입 시 자기 점검 (실전 적용 순서)

1. CLAUDE.md 룰 정독 — 특히 `MANDATORY_CHECKLIST` + `STANDARD_RESPONSES`
2. 본 문서 §4 메타 위반 패턴 정독 — 답변 작성 시 자동 패턴 차단
3. 작업 도메인 §3 사고 이력 + §5 아키텍처 검색 — 동일 패턴 사고 차단
4. `status/STATUS.md` CURRENT_TASK 확인
5. 코드 수정 진입 시 — `utils/` CT 존재 확인 → 인라인 금지 → grep 전수 → Harold님 컨펌 → Edit
6. 빌드 안내 시 — `npm run build:safe` (atomic) 강제. `tp-deploy-full` 절대 금지.
7. 답변 송신 직전 — 위반 단어 검열 ("부탁드립니다", "✅", "1단계", "통과" 등)
