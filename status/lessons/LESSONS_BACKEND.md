# LESSONS — Backend / API / Query / 발송 / AI 사고

> **참조**: Backend route / utils / 발송 / AI 호출 작업 시 우선 정독.
> **원본**: 옛 `LESSONS_LEARNED.md` §3 안 Backend 관련 사고 분할 (D215+ 도메인 분할 — 2026-05-24).

---

## 핵심 원칙

- **발송 5경로 전수 점검** — `messageUtils.ts replaceVariables()` 공통 (D32~D33)
- **컨트롤타워 단일 진입점** — `utils/` CT에만 로직 / 라우트 인라인 정의 금지
- **모델 분리 룰** — Opus 4.7 (AI Operator) / Sonnet 4.6 (기존 한줄로AI) 흐름 영향 0건
- **AI 임의 혜택 생성 X** — 구체 혜택(%/원/쿠폰/무료) 절대 미생성 / `[직접 작성해주세요]` placeholder
- **0건 타겟 자동완화 X** (D171) — 마케팅 의도 파괴 + 정보통신망법 위험
- **EUC-KR 호환 화이트리스트** — SMS/LMS 발송 시 unicode 이모지 사고 차단

---

## 발송 시스템 사고

### 발송 5경로 부분 패치 (반복 패턴)
- **사례**: AI 캠페인 / 직접발송 / 타겟 / 스케줄 / 테스트 5경로 중 1곳만 수정 → 동일 버그 재발.
- **대책**: `messageUtils.ts replaceVariables()` 공통 함수 사용. 발송 관련 수정 시 5경로 전수 점검.

### D188-Phase2B (Journey 통합 진화 + 자동발송 영구 폐기 + 위반 단어 117건)
- **Phase 2-B-4 자동발송 영구 폐기**: 사용 고객사 0 + 여정이 진짜 업그레이드 → DashboardHeader 메뉴 제거 + AutoSendPage 안내 페이지 + routes/auto-campaigns POST 410 Gone + 운영 데이터 보존
- **Phase 2-B-1 Wait + Condition step 신규**: journey-builder activateJourney step_type별 검증 + journey-executor evaluateCondition 함수 (customer_field 9 operator + custom_fields JSONB fallback)
- **Phase 2-B-2 MMS + KAKAO 채널 확장**: DB ALTER journey_steps 7 컬럼 + processExecution channel 분기 (kakao_templates 조회 + insertAlimtalkQueue)
- **Phase 2-B-3 A/B + Bandit 통합**: DB CREATE journey_step_variants + bandit-optimizer 7 함수 + Thompson Sampling 자동 선택 + reward 누적
- **위반 단어 영구 룰 전수 정정**: 117건 (Phase 1 PDF 캡처 31건 + Phase 2 frontend 21 파일 57건 + Phase 3 backend 응답 메시지 21건 + 활용형 변형 8건). 자가 grep 패턴 = 활용형 (박히지/박혔/박힐/박았 등) 전수 의무.

### D188 (영업팀장 알림톡 14건 — 9 파일 통합 fix)
- **대책 9 파일**:
  1. AlimtalkPreview select-none → select-text
  2. AlimtalkTemplateFormV2 wrapper textarea pointer-events-none 제거 + readOnly attribute + 반려사유 박스 max-h+scroll
  3. AlimtalkManagementSection 템플릿코드 컬럼 + 검색 UI(4 영역)
  4. AlimtalkChannelPanel rows={6} + LMS 대체 subject + 본문 변수 자동 동기화
  5. AlimtalkSendModal handleClose 안전망 + nextSubject 검증
  6. Dashboard alimtalkNextSubject state + 3 모달 props
  7. alimtalk-jobs callback fallback (admin_phone_number 빈 영역 → sender_registrations fallback)

### D152 (AI 다듬기 4 사고 — 창작/보수성/EUC-KR/백틱)

#### 4-1. In-Context Learning 창작 사고
- **사례**: AI 메시지 다듬기 시스템 프롬프트에 "매장에서 만나뵐게요"/"단 3일 한정" 같은 원본에 없는 표현 → AI 그대로 학습 → 모든 회사 다듬기에 임의 창작 확산 = 사고.
- **대책**:
  1. 시스템 프롬프트 §1 최상위 "원본에 없는 정보 절대 추가 금지"
  2. In-Context 4개 모두 원본 정보만 사용한 진짜 다듬기 예시
  3. negative example 1개 명시
  4. 후처리 `removeAddedVariables` — 원본에 없는 변수 + 후속 조사 자동 제거
  5. `appendMissingVariables` — 원본 변수 보존

#### 4-2. 보수성 ↔ 풍성성 균형 사고
- **사례**: 창작 사고 차단을 위해 시스템 프롬프트 §1을 너무 보수적으로 → AI가 안전한 단어 정리 수준만 → 사용자 "API로 다듬은 거 맞아?" 의문.
- **대책**: "보존 영역(상품/할인율/일시/숫자/매장/연락처/이벤트명)" vs "자유 영역(수식어/감성/계절 묘사/감사 인사/CTA)" **명확히 분리** + 길이 80~150% 허용. `getSeasonContext()` helper (현재 월 기반 자동 시즌 키워드). 다듬기 = "사실 변경 X" + "표현 풍성 O" 양방향 균형.

#### 4-3. SMS EUC-KR 인코딩 이모지 발송 깨짐
- **사례**: 시스템 프롬프트 "이모지 1~2개 적절 추가" + In-Context 예시(😊⚡✨🤝) → AI 학습 → 다듬기에 유니코드 픽토그램 → SMS/LMS EUC-KR 발송 시 깨지거나 `?` 변환 = 사고.
- **대책**:
  1. 시스템 프롬프트 §3 "유니코드 이모지 절대 금지 + SMS 호환 특수문자만"
  2. `SMS_SAFE_SPECIAL_CHARS` 47개 (EUC-KR 호환 검증된 ★/☆/♥/♡/◆/■/▶/●/○/♨/※/☞/☎/①~⑧/㈜ 등)
  3. `stripIncompatibleEmojis` 후처리 — 화이트리스트 외 비-ASCII 비-한글 자동 제거 + variation selector + ZWJ 제거

#### 4-4. template literal raw 백틱 tsc 사고
- **사례**: 시스템 프롬프트 텍스트에 "?로 변환됨" 표현을 위해 raw 백틱 박음 → outer template literal 종료 → TypeScript parser 에러.
- **대책**: template literal 내부에 raw 백틱 절대 박지 말 것. 큰따옴표/작은따옴표 + 다른 표현. 시스템 프롬프트 작성 후 tsc 사전 검증 필수.

### D152-1 (form-data v4 multipart 한글 파일명 — RFC 5987)
- **사례**: 5/11 한글 파일명 (`11비율.jpg`) → IMC 미리보기 깨짐. `form-data` lib는 RFC 5987 자동 처리 X → IMC Java/Spring latin1 해석 → octet-stream 인식.
- **대책**: `toAsciiSafeFilename(filename)` 헬퍼 신설 — ASCII 영문/숫자/`.-_`만 통과, 한글/특수 포함 시 `evidence_${Date.now()}.${ext}` 변환. 원본 파일명은 PG `inspection_evidence_filename` 보존, IMC 전송 시점만 변환.
- **교훈**: 외부 라이브러리 동작은 영문/ASCII 케이스만 검증하면 한글 케이스 회귀 위험 — 검증 시 한글 파일명 케이스 필수 커버.

### D150-5 (UX 3건 — SearchableSelect 컨트롤타워)
- **대책**: D144 P11+P13 SearchableSelect 컨트롤타워 확장 적용. 드롭다운 검색 패턴 통합.

### D150-3 (직접발송 0 NULL — cellToString)
- **사례**: 엑셀 D2/E2/F2 = 0 값이 `row[col] || ''` falsy 처리로 빈 문자열 변환 → NULL 발송. 벤제프 113건 잘못 발송.
- **대책**: `cellToString` 컨트롤타워 신설. `|| ''` 패턴 25곳+ 일괄 교체. 인라인 `safeStr` 정의 금지.

### D150-4 (발송결과 ORDER BY tie)
- 발송결과 `dest_no ASC` tie-breaker 추가 (3곳). LIMIT/OFFSET 청크 = unique tie-breaker 필수.

### D151-2 (환불 워커 부재)
- `campaign-sync-worker.ts` 5분 cron 신설. fire-and-forget sync 한계 영구 차단.

### D110 (하드코딩 테이블명)
- `getCampaignSmsTables` 등 CT-04 함수 사용. 라우팅 단일 진입점.

### D106 (LEFT JOIN 모호성)
- JOIN 추가 시 모든 컬럼에 alias (`c.`, `u.`) 명시 필수.

### D98 (MMS 절대경로)
- `mmsServerPathToUrl` 컨트롤타워 활용.

### D76 (AI 요일 연산 오류)
- 날짜/요일 관여 프롬프트에 반드시 시스템 생성 달력 (`getKoreanCalendar`) 제공.

---

## AI 호출 매트릭스 (D170+ ~ D214+)

### 크레딧 created_by = 요청 컨텍스트 자동 (2026-06-02)
- callAIWithFallback createdBy = `params.userId || currentUserId() || null`. currentUserId = AsyncLocalStorage(`utils/request-context.ts`), authenticate가 `enterWith`로 요청 사용자 전파.
- 새 AI 작업(callAIWithFallback 경유)은 호출부 무수정으로 자동 created_by 기록. orchestrate도 동일 fallback.
- cron/worker(예측·operator)는 요청 컨텍스트 없음 → 호출측 명시(예측=회사 대표 admin / operator=operator.createdBy). 월 리셋=created_by 없음='자동'.
- 이력은 정산·감사 근거 = 모르는 과거 건에 부정확 ID 소급 X(created_by null='자동' 정직). enterWith 전파는 환경따라 불안정 가능 — 런타임 확인 후 미작동 시 명시 전달 fallback.

### 모델 분리 룰 (`feedback_ai_operator_model_isolation`)
- **AI Operator** = Opus 4.7 (callAIWithFallback `model: 'opus'`)
- **기존 한줄로AI** = Sonnet 4.6 (절대 건드리지 말 것 — 6,000사+ 운영 영향)
- gpt vs gptOperator 분리

### AI 임의 혜택 금지 (`feedback_ai_no_arbitrary_benefit`)
- AI는 메시지 흐름/구조/인사 텍스트만 제안
- 구체 혜택 (%/원/무료/쿠폰/사은품/적립/무료배송/할인) 절대 임의 생성 X
- `[직접 작성해주세요]` placeholder + activateJourney 활성화 시 `hasUneditedPlaceholder` 차단

### 0건 타겟 자동완화 X (D171 + `feedback_no_target_auto_relax`)
- `relaxFilters/auto_relax/autoRelax/Zero-Count Auto-Relax` 어디에도 박지 X (D171 전수 제거)
- `saved_segments.auto_relax` DB 컬럼 보존 + 항상 false
- 0건이면 "조건을 조정해주세요" 안내만 + AI 재추천 X

---

## 외부 API 응답 검증 사고 (D217+ 추가)

### D217+ (2026-05-26) — 카카오 알림톡 templateCode 18일 누락 사고

**Critical 사고**: 옛 D147(2026-05-08) 코드 안 IMC list 응답 구조 추정 사고. 운영 환경 8건 (검수 통과) 100% 자체 코드(`Tmp_xxx`)로 18일 유지. 진정 카카오 templateCode(`B_XX_xxx_xx_xxxxx`) 동기화 누락.

**Root cause**:
- 옛 D147 코드: `(lst.data as any)?.list || (lst.data as any)?.data?.list || []`
- 본 코드 = 4014 fallback 전용 진입 경로라 일반 운영에서 검증 X = 잠재 사고
- 실제 IMC 응답 키 = `[hasNext, total, templateList]` — 옛 fallback 매트릭스 어디에도 없음
- D217+ sync worker 신설 시 옛 코드 그대로 차용 = 첫 사이클 `matched=0/failed=8` 사고

**진정 정정** (`utils/kakao-template-sync.ts` + `routes/alimtalk.ts:706`):
```typescript
const items: any[] =
  (r.data as any)?.templateList ||   // 진정 IMC 필드명
  (r.data as any)?.list ||
  (r.data as any)?.data?.list ||
  [];
```

**4 Phase 동시 정합** (영구 안전망):
1. `POST /api/alimtalk/jobs/sync-template-codes` 백필 endpoint (1회성)
2. `getAlimtalkTemplate` 사용자 조회 시점 자동 동기화
3. `kakao-template-sync-worker.ts` 30분 cron worker
4. 옛 D135+ B3 fallback 동시 정정

**진단 흐름 (영구 사례)**:
- 1차 진단: `matched=0/failed=8` 결과만 보고 stderr 추정 사고 가설
- 2차 진단: 디버그 로그 추가 (응답 키 / 첫 item / raw 500자)
- 3차 진단: Harold raw 정독 = `templateList` 필드명 영구 발견
- 4차 정정: 진정 root cause fix = 8건 모두 정정 완료

**교훈**:
- **외부 API 응답 구조는 추측 또는 옛 코드 차용 X — 실제 raw 직접 확인 의무** (영구 룰 `feedback_external_api_response_verification` 신설)
- 옛 fallback 매트릭스가 있다면 = 옛 코드가 실제로 진입한 경로인지 git log + PM2 로그 검증 의무
- `console.error` / `console.warn` 진단 의존 X (stderr 분기 진입 차단) — `console.log` (stdout) 의무
- 페이지네이션 (`hasNext`) 처리 — 첫 페이지만 break X

---

## 여정 검증/테스트 경로 본문 불일치 사고 (D230+ 추가)

### D230+ (2026-06-03) — 여정 스팸테스트 본문 ≠ 실제 발송 본문 (광고 표기·무료거부·제목 누락)

**사고**: 여정 스팸필터 테스트(활성화 검증 시 테스트폰 3대 발송)에 (광고) 표기·무료수신거부·LMS 제목이 모두 누락. 광고성 메시지인데 정보통신망법 표기 누락 = 큰일 직전. (실고객 발송이 아니라 테스트폰이었으나, 같은 누락이면 실발송도 위험했음.)

**Root cause**:
- 실고객 발송(`journey-executor` 484-508)은 `prepareSendMessage`로 (광고)+080+제목을 합성 → **정상**.
- 스팸테스트(`journey-pretest-validator` 145)는 원본 `msg.body`/`step.subject`를 `enqueueSpamTest`에 그대로 전달 → `buildAdMessage`/`buildAdSubject` 미적용 → (광고)/무료거부 없음.
- `spam_filter_tests`에 `subject` 컬럼 부재(information_schema 0 rows) → 제목이 저장조차 안 됨 → `executeSpamTest` 339 `test.subject`=null → 제목 빈칸.

**정정**:
1. pretest-validator에서 `getOpt080Number`로 080 조회 → `buildAdMessage`(본문)·`buildAdSubject`(제목) 합성 후 enqueue.
2. `enqueueSpamTest` INSERT에 `subject` 추가.
3. `ALTER TABLE spam_filter_tests ADD COLUMN subject text` (executeSpamTest는 `t.*` 조회라 자동 반영).

**교훈**: **검증/테스트 경로가 실제 발송 경로와 다른 본문을 쓰면 사고.** 스팸 판정이 부정확해지고 테스트폰에도 비정상 본문이 나간다. 광고 합성·무료거부·제목 등 발송 가공은 **실발송/검증/미리보기 전 경로가 동일 CT(`prepareSendMessage`·`buildAdMessage`·`buildAdSubject`)를 거치게** 정합. 발송 5경로 전수 점검에 **검증·테스트 경로 포함**.

---

## 자가 검증 매트릭스 (Backend 작업 시)

- [ ] 발송 5경로 전수 점검 (AI/직접/타겟/스케줄/테스트)
- [ ] 컨트롤타워 (`utils/`) 존재 확인 + 인라인 정의 금지
- [ ] AI 호출 = 모델 분리 룰 정합 (Opus 4.7 / Sonnet 4.6)
- [ ] 사용자 노출 영역 (alert/toast/error response/message/throw) 박-단어 grep = 0건
- [ ] AI 시스템 프롬프트 안 구체 혜택 (%/원/쿠폰) 박지 X 명시
- [ ] 0건 타겟 = 발송 차단 (자동완화 X)
- [ ] SMS/LMS 발송 영역 = EUC-KR 화이트리스트 + stripIncompatibleEmojis
- [ ] 외부 라이브러리 활용 시 한글 케이스 검증 필수
- [ ] template literal raw 백틱 X
- [ ] **외부 API 응답 구조 = 옛 코드 차용 X = 실제 raw 디버그 로그로 직접 확인 의무 (D217+ 영구 룰 `feedback_external_api_response_verification`)**
- [ ] **`console.error` / `console.warn` 진단 의존 X = `console.log` (stdout) 의무 (grep 누락 차단)**
- [ ] **list API 페이지네이션 `hasNext` 처리 — 첫 페이지만 break X**
