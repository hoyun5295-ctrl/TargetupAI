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

## 직접발송 대량 504 사고 (D231+ 추가)

### D231+ (2026-06-04) — 톤28 8~30만 발송 504 + 중복 발송 (응답 전 동기 정제 self-join 폭발)

**사고**: 톤28(toun28) 8~30만 직접발송 시 빨간 알럿(504) 반복 → 오류로 알고 재시도 → 중복 64만건 처리(취소·예약도 send_phase='sent'로 게이트웨이 송출).

**Root cause**: commit endpoint가 정제(수신거부 DELETE + **중복제거 self-join** `a.phone=b.phone AND a.id>b.id`)를 **응답 전 동기로** 수행. `(staging_id,phone)` 인덱스가 있어도 **같은 테이블 자기조인**이라 10만에 59초(\timing 실측 239,674ms) → commit 60초 초과 → **nginx 504(upstream timeout)**. 백엔드는 완주 → 발송 + status='scheduled' 잔존 → 재시도 중복.
- 진단: 백엔드 out.log 완료만, error.log에 commit 에러 0 → **백엔드 안 죽음, nginx가 응답 못 받아 504**. nginx access.log `POST /direct-send/commit 504`, error.log `upstream timed out`.

**정정** (`routes/campaigns.ts` + `utils/direct-send-worker.ts` + `DirectSendPanel.tsx`/`Dashboard.tsx`):
1. commit 정제 제거 → 발송 건수만 COUNT(헬퍼 `countStagingFiltered`) → 즉시 202.
2. 정제(중복 ctid+ROW_NUMBER O(N log N) + 수신거부 인덱스 JOIN)를 worker 발송 직전(processed===0)으로 이동.
3. 모달 카운트도 phones 통째 POST·프론트 계산 폐기 → stage 적재 후 count endpoint(같은 헬퍼). count=commit=worker 동일 기준이라 모달=차감=발송 일치.

**교훈**:
- **응답 전 동기로 대량 정제(DELETE/JOIN) 금지** — 타임아웃은 백엔드 에러 안 남고 nginx 504. commit/모달은 즉시 응답, 무거운 작업은 worker 청크.
- **self-join(자기조인 `a.id>b.id`)은 인덱스로도 폭발** — 중복제거는 ctid+ROW_NUMBER 한 패스(O(N log N)).
- **진단은 백엔드 error.log + nginx access/error 둘 다** — 백엔드 완주 시 백엔드 로그엔 안 남는다.
- 대량 정제 카운트(모달)는 프론트 메모리/phones 통째 POST 금지 → staging 서버 COUNT.

---

## 여정 엔진 전면 결함 (D232+ 추가)

### D232+ (2026-06-04) — 여정 타겟 추출·발송·시점 전반 결함 (자유여정 진입 부재 포함)

**배경**: 신규가입 여정 시연 중 신규가입자 0(목업 고객DB 재업로드)인데 500건 발송. 추적 결과 여정 엔진 전반 결함. 핸드오프 `docs/superpowers/handoffs/2026-06-04-journey-engine-redesign-handoff.md`.

**결함(라인 근거)**:
1. **자유여정(custom) 진입 부재** [CRITICAL] — `journey-builder.ts:685` activateJourney가 status active+snapshot+알림스케줄만, journey_executions INSERT 0. `journey-trigger-watcher.ts:71` custom 제외 + `journey-target-extractor.ts:135` default 빈배열. → 자유여정 활성화해도 발송 0(사용자 최다 사용 타입).
2. **신규가입 created_at 재업로드 취약** [CRITICAL] — `journey-target-extractor.ts:41` `created_at >= NOW()-N시간`. 고객DB 전체 재업로드 시 created_at 갱신 → 전원 신규 오인(실측 2만명 일괄→전체→LIMIT 500 발송).
3. **cdp trigger opt-out/is_active 필터 누락** [CRITICAL] — `extractor.ts:97`(cart)·`152`(purchase/reservation): customer_conditions 없으면 customers JOIN 스킵 → sms_opt_in/is_active 미적용 → 수신거부 발송.
4. **조건평가 default pass** [HIGH] — `journey-executor.ts:1014/1029/1039/1043/1078` null·DB오류·미지원 전부 return true → 조건 무시 발송. (활성화 형식검증은 있으나 런타임 DB오류 못 막음.)
5. **고객당 개별 campaign** [CRITICAL] — `executor.ts:630` 고객 1명당 campaigns INSERT(target=1)+차감(587 ref=journey_id)+큐(702). 500명=500 campaign+500 차감+발송결과 500행 폭주. **여정도 직접발송처럼 staging 묶음+청크+%고객명% 필요.**
6. **LIMIT 500** [HIGH] — `trigger-watcher.ts:113`. 조건 10만이면 500만. 제거 필요(묶음 동반).
7. **step 시점 = now+delay** [HIGH] — `trigger-watcher.ts:145`. 전일 대상 묶어 다음날 지정 시각이어야(step1=충족 후 N일+시각, step2=step1+72h 등).
8. **is_invalid(무효번호) 전 trigger 누락** [HIGH].
9. **미리보기(LIMIT 30) vs 실발송(LIMIT 500) 규모 불일치** [MEDIUM].

**긍정(이미 있음)**: 발송 2h 전 담당자 알림 스케줄 `journey-builder.ts:679 scheduleNotificationsForActivation`(스팸필터 2h 전 토대).

**교훈**:
- **trigger 추출은 "레코드 생성 시각(created_at)"이 아닌 "안정 기준(가입일·이벤트 occurred_at)"으로** — 재업로드/갱신에 무너지면 전체 오발송.
- **공통 안전 필터(sms_opt_in·is_active·is_invalid·is_opt_out)는 모든 trigger·customer_conditions 유무 무관 적용** — JOIN 조건부면 누락.
- **조건평가 DB 실패 = default pass(발송) 금지 → 안전 분기(미충족 취급)**.
- **여정 발송도 직접발송 staging 묶음 구조 재사용** — 고객당 개별 campaign = 500명 500건 폭주.
- **자유여정도 진입 worker 필수** — trigger 제외 + extractor case 부재면 발송 0.
- **점검 보조 도구(서브에이전트)가 구버전 schema.sql을 보면 오진**(region·birth_month_day "없음" 보고했으나 실 customers엔 존재) — 실DB 컬럼 기준 의무.

**★ 2026-06-04 세션2 — Phase 1~5 fixed (배포)**:
- 결함 **#1·#2·#3·#5·#6(cdp)·#8 수정**. 남은 #4(조건평가 default pass)=Phase 7 · #7(step 시점)=Phase 6 · #9(미리보기)=Phase 9.
- **여정 SMS 큐 app_etc1/app_etc2 뒤바뀜 발견·정정** — `bulkInsertSmsQueue`는 app_etc1=row[6]·app_etc2=row[7](`sms-queue.ts:942·944`)인데, 여정 SMS가 row[6]=company_id·row[7]=`journey:...`로 뒤바뀌어 여정 SMS 수신자 상세(`results.ts` WHERE app_etc1=campaignId)가 안 잡혔음. Phase 5에서 row[6]=campaignId로 정정.
- **여정 과금 = prepaidDeduct(발송 시, `executor:587`), campaign_runs 월정산 밖**(여정은 campaign_runs 미생성) → app_etc1 변경이 billing에 영향 0. billing은 `campaign_runs.id`(run_id) GROUP BY app_etc1로 집계.
- **진입 원장 키 = 시스템 upsert 식별자(회사+매장코드+전화번호)** — created_at 의존 0. 업로드=`customer-upsert` upsert(키 동일)라 created_at·id 보존, 전체삭제(`customers.ts:1533`)·업로더별삭제(`admin.ts:231`)만 리셋(드묾).
- **묶음 발송 = (journey,step,KST날짜)당 campaign 1건 공유**(journey_step_campaigns find-or-create) — staging/사전렌더 불요(executor 5분 소량 처리 → OOM 위험 0, 톤28 무관). 직접발송 파이프라인 격리.

**★ 2026-06-04 세션3 — Phase 6·7·8 fixed (배포 408f6e9)**:
- **#4 조건평가 안전분기** = Phase 7: `evaluateCondition` boolean→`met`/`not_met`/`error` 3분기. DB오류=`error`→발송 보류+재시도(`handleConditionEvalError`, 발송실패 재시도 패턴 재사용, 발송 X). null·미지원 type·미지원 operator·빈 field·빈 event_name=`not_met`. customer_field 순수 평가 `journey-condition.ts`(신규 CT) 분리. 활성화 형식검증 유지.
- **#7 step 시점** = Phase 6A: `calculateNextRunAt`를 `send-time-util.ts` CT로 이동(now 인자→순수 테스트). trigger-watcher 두 enqueue가 step1 SELECT에 delay_mode·target_hour_kst 추가 후 calculateNextRunAt 사용 → step1도 specific_hour(다음날 지정 시각)·next_business_day 적용.
- **발송 2시간 전 스팸테스트** = Phase 6B: 깨진 `predictNextSendTimes`(journey_executions에 없는 scheduled_at·step_id 조회 → 활성화 catch가 삼켜 2h 알림 0건) 폐기 → `scanAndPretest`(active execution 중 next_run_at 2시간 안 + 다음 step이 message인 것을 (journey,step,KST날짜)당 1회, journey_pretest_schedules dedup). 통과면 담당자 LMS, enqueue 실패(잔액)면 다음 주기 재시도, 걸리면 `regenerateStepAvoidingSpam`(source `journey-ai-refine`=1크레딧 자동, callAIWithFallback)+재테스트→통과면 최신 snapshot UPDATE(executor가 최신 snapshot 본문 발송 238~252행)+안내, 또 걸리면 `pauseJourney`(공용 CT 추가). `runStepSpamTest` 공용 추출(활성화 검증+스캐너 공유). 순수 코어 `journey-pretest-scan.ts`(신규). **걸렸을 때만 1크레딧 — 통과는 무료(Harold 정책).**
- **trigger 확장** = Phase 8: `customer.points_expiring` — points 임계 + (미사용 recent_purchase_date 오래됨 / 연 소멸일 MM-DD D-N). extractor case + watcher 자동(active 전수) + JOURNEY_TEMPLATE + union. `resolvePointsExpiringConfig` 순수(미설정 vs 0 구분 — `Number(x) || def` falsy 함정 clampInt로 교체). **포인트 소멸일은 고객 필드가 아니라 여정 정책(회사 1개 날짜).**
- **남은 #9 미리보기** = Phase 9: simulator matchTriggerCustomers 폐기 → selectJourneyTargetCustomerIds 단일 진입점 통일 + 임의 상수 교체 + UI. 핸드오프 `docs/superpowers/handoffs/2026-06-04-journey-phase9-handoff.md`.
- **교훈**: tsc는 SQL 컬럼 검증 못 함 → information_schema 순수 덤프로 실컬럼 확인 후 작성(scheduled_at·step_id 부재 확정). DB-의존 wrapper(AI 호출·스팸 enqueue)는 순수 테스트 불가 → 순수 코어(조건·dedup·config)만 분리 TDD, 통합은 tsc+검증된 패턴 재사용.

**★ 2026-06-05 Phase 9 + 배포후 map 누락 fix (운영 실측)**:
- Phase 9 완료(미리보기=실발송 통일·실데이터 예측·시점 N일+시각 relative_at_hour·여정 옵션 PATCH·타임라인). 상세 = `memory/project_2026_0605_journey_phase9_done.md`.
- **배포후 버그**: 발송 시각(relative_at_hour) 저장 안 됨. 근본 = `journey-builder.ts:246` `createJourneyFromTemplate`의 `input.steps.map`이 step 재생성 시 신규 필드(`delayMode`·`targetHourKst`·알림톡 6·`mmsImagePaths`)를 **객체에 안 담음** → 프론트 전송·백엔드 수신(console.log 입증)에도 INSERT 직전 누락 → relative/null. **검토 캔버스(input.steps)로 만든 모든 여정이 이전부터 발송시각·알림톡·MMS를 잃던 잠재 버그**(옵셔널 필드라 무증상). fix=9필드 보존 + 720h→8760h.
- **교훈 1**: 신규 step 필드 추가 시 `createJourneyFromTemplate`·`generateCustomStepsWithAI`·`tmpl.steps` 등 **모든 transform/map 경로를 grep**해 보존 확인. 한 곳이라도 map이 새 필드를 안 따라가면 받아도 누락. (full_pattern_grep_required = falsy뿐 아니라 "필드 보존"에도 적용.)
- **교훈 2**: 옵셔널 신규 필드는 tsc 통과 + 순수 테스트 미적용으로 **자동 검증 못 잡음** → 생성→DB 왕복 1건 실측이 유일한 안전망. "완료" 보고 전 운영 흐름 1건 실측 의무.
- **교훈 3**: 디버깅 시 "배포 안 됐을 것" 추측 금지 → `console.log`(stdout)+PM2 로그로 **수신값 실측**부터. (배포상태 추측으로 헤매다 Harold 격분 — no_guess 위반.) 백엔드는 ts-node(소스 직접 실행)라 dist 빌드 무관, pull+pm2 restart면 반영.

**★ 2026-06-05 세션6 발송결과 markFinalized 미완성 확정 (목록↔상세 불일치)**:
- **현상**: 운영 고객사 발송결과 목록(성공 2,304)과 상세 모달(성공 2,685)이 다름. 직원 "대기 0→478 변동" 신고.
- **근본**: `markFinalizedCampaigns`(campaign-sync-worker.ts)가 확정 조건으로 `(success+fail)>0`만 검사 → 5/30 result_final 일괄 마킹 때 LIVE→LOG 이동이 덜 끝난 4건이 success+fail(2,362)<sent(2,840)인 **미완성 상태로 확정**. 이후 LOG로 더 들어온 결과가 영구 미반영(24h sync 윈도우 밖이라 PG success_count 안 갱신). 목록=PG캐시(과소)·상세=MySQL실시간(정확) 두 소스라 어긋남.
- **fix**: 확정 조건에 `sent_count>0 AND (success+fail)>=sent_count` 추가(완전 집계분만 캐시 확정). 굳은 4건은 `result_final=false`로 되돌려 실시간(LIVE+LOG) 복귀. 라인그룹 캐시(`LINE_GROUP_CACHE_TTL`)라 두 번 조회 시 LOG 갱신되어 값 바뀜.
- **교훈 1**: 캐시 확정(result_final) = "완전 집계(success+fail=sent) 검증" 의무. 단순 `>0`은 진행 중을 확정시킴.
- **교훈 2**: 정산(billing.ts /generate·admin 요금정산)은 D144 이후 **MySQL 직접 집계**라 PG 캐시 과소와 무관 — 발송결과 화면(result_final 캐시 분기)만 영향. 돈 영향 판단 시 정산 산출 소스부터 확인.
- **교훈 3 (메타)**: `LEFT JOIN bt ON bt.reference_id=c.id`가 0건일 때 "차감 없음"으로 단정 = 추측. reference_id가 campaign.id가 아닐 수 있음(여정 발송은 제3 id) — `(matched, status)` 교차 집계로 reference 정체부터 확정해야. no_guess 위반 반복 사례.

**★ 2026-06-05 세션5 발송통계 hpio 0 + hoyun 폭발 + result_final 캐시**:
- **hpio 0**: 발송 데이터가 회사 라인 `{SMSQ_SEND_7,8,9}`인데 집계는 created_by의 user 라인 `{1,2,3}` 우선 조회 → 매칭 0. user 개별 라인그룹이 발송(5/30) 후 부여돼 발송/집계 라인이 어긋남. fix = `getCompanySmsTablesWithLogs`(집계 전용)를 `mergeLineTables`로 user+company **합집합**. 발송 경로(`getCompanySmsTables` user 우선)는 불변.
- **교훈**: 집계가 라인그룹 한정 조회라 발송 후 라인그룹이 바뀌면 과거 발송 집계가 깨진다. 집계는 합집합으로 내성 확보. (발송내역 상세 `getCampaignSmsTables`도 같은 잠재 — 추후 동일 적용 검토.)

---

## 알림톡 강조표기형 7300 — QTmsg 발송 에이전트 select_sql (D234+ 추가)

### D234+ (2026-06-09) — 강조표기형 전부 7300, 근본은 한줄로 밖(에이전트 qtmsg.xml)

**현상**: 알림톡 강조표기형(emphasize_type=TEXT)만 전부 7300(카카오 기타에러) → LMS 대체로만 도달. 기본형·채널추가형 정상. 직원 deliver 로그에 `etcJson[]` 빔.

**2시간 헛다리(전부 정상이었음)**: 한줄로 코드(buildAlimtalkEtcJson CT·insertAlimtalkQueue)·send_config·kakao_templates(emphasize_title 존재)·카카오 검수 승인(강조 변수형)·senderkey 제거(매뉴얼 {title}만) — 다 맞는데도 7300.

**근본(확정)**: 발송 에이전트 QTmsg(java 11개, `/home/administrator/agent1~11/bin`, **PM2 아님** — `ps aux | grep qtmsg`)의 `conf/qtmsg.xml` `<select_sql>`이 발송 직전 k_etc_json을 변형:
```sql
else concat(concat(concat('{"sendercode":"',sender_code),'",'), replace(k_etc_json,'{',''))
```
`sender_code`(=인비토 특수유형 부가통신사업자 식별코드)가 NULL(한줄로 INSERT가 안 채움) → **MySQL concat은 인자 하나만 NULL이어도 전체 NULL** → k_etc_json 통째 NULL → 강조 title 소실 → 7300. 채널추가형·기본형은 etcJson 불요라 무증상.

**증거**: `SMSQ_SEND_1_202606`(월별 이력) — 강조형 행 k_etc_json `{"title":"…"}` 정상 저장 + sender_code NULL + status_code 7300. 채널추가형 1800 정상. 한줄로 진단로그 OUT.etc 정상.

**미해결**: 인비토=특수유형 부가통신사업자(식별코드 의무). 문자 SMS/LMS는 잘 나감=중계사 자동 삽입 추정 / 카카오는 식별코드 불필요 추정 → **서팀장→IMC 메일 확인 대기**. 답변 후 fix = `docs/superpowers/handoffs/2026-06-09-alimtalk-emphasize-7300-imc-handoff.md` 분기 참조. 진단로그 `[ALIMTALK-DEBUG2]`(direct-send-processor) 원인 확정 후 제거 의무.

**교훈**:
- **발송이 안 되는데 한줄로 코드·DB·send_config 전부 정상이면 → QTmsg 에이전트 `conf/qtmsg.xml` select_sql부터 의심.** 에이전트가 발송 직전 발송 큐 컬럼(k_etc_json 등)을 SQL 수준에서 변형/덮어쓴다.
- **발송 큐(SMSQ_SEND_X)는 발송 즉시 비워진다** — 사후 SQL 0건은 "값이 없었다"가 아니다. 발송분 실값은 월별 이력 `SMSQ_SEND_X_YYYYMM`에서 조회.
- **MySQL `concat`은 NULL 하나로 전체 NULL** — 에이전트/SQL 합성 경로에 NULL 가능 컬럼이 끼면 전체 소실.
- 발송 에이전트는 PM2 목록에 없다(별도 java 실행파일) — 프로세스 추적은 `ps aux`.
- **hoyun 폭발**: 여정 500 campaign `status='sending'`+`result_final=false`. `syncCampaignResults`(campaign-lifecycle:238 직접발송 섹션)가 `app_etc1=campaignId`로 결과 0집계 → status 전환 조건(433) 미충족 → sending 영영 방치 → 캐시 없음 → 발송결과 조회마다 500 생집계 폭발. 인덱스 OK(`idx_app_etc1_status`, PG 6.7ms)라 인덱스 문제 아님.
- **fix(②)**: 발송통계 5곳을 `getCampaignResultCounts`(result_final이면 PG 캐시 MySQL skip)로 전환. ★ **복제(read replica)는 부하분리지 속도 아님**(같은 GROUP BY) — 속도는 pre-aggregation(캐시).
- **교훈**: D144가 PG 캐시 뺀 건 속도가 아니라 정확성(`billing.ts` 미러). D228+ `result_final`(6h 확정)이 그 정확성 문제를 해결 — 발송통계만 캐시 미적용이라 느렸음.
- **프론트 순수 TDD**: `type:module`(ESM)라 ts-node 순수 함수 TDD가 `ERR_UNKNOWN_FILE_EXTENSION`로 막힘 → 순수 로직을 backend로 옮겨 TDD(`campaign-list-csv.ts`).

---

## 자동마케팅 자율 발송 (D233+ / 2026-06-05 세션8)

### 자동실행이 크레딧만 차감하고 실발송 코드 전무 (CRITICAL) — 해소

**사고 구조**: 자동마케팅(Continuous Operator) 자동실행이 status='auto_executed' INSERT + 문안 크레딧 차감까지만 하고 **실제 발송 코드가 없었다**(markProposalExecuted 호출 0, 발송 워커·엔드포인트 0). ENT가 켜면 크레딧만 빠지고 고객은 메시지를 못 받음.

**해소(세션8)**: prep('scheduled'+scheduled_send_at) → 발송 패스(runAutoSendPass: 타겟 재추출·staging·createDirectSendCampaign·크레딧 멱등·통지). 직접발송 파이프라인을 createDirectSendCampaign으로 추출해 공유.

**교훈**:
- **자동실행/자율발송류 = "실발송 코드가 끝까지 있는지 + 차감↔발송 원자성"을 꼭 확인.** 차감만·미발송이 가장 큰 사고. 크레딧은 **발송 성공 시점에만 멱등 1회**(키=proposalId). 생성/승인 시점 차감 금지.
- **발송 코어 공유(dispatchProposalSend)** — 자동·수동이 같은 발송 경로를 타게 해야 본문·안전필터·(광고)/080·크레딧이 일관(D230+ 검증=발송 본문 일치 정신). 수동 승인도 백엔드에서 즉시 발송 = 원자성.
- **상태 값 전환 시 집계 SQL 전수 갱신** — auto_executed→'sent'로 바꾸면서 예산 sub-query `status IN ('approved','auto_executed')`에 'sent'를 안 더하면 예산 집계가 누락. 상태 추가/변경 시 그 상태를 읽는 모든 WHERE/집계 grep 전수.
- **claim 패턴(scheduled→sending UPDATE RETURNING)** = 동시 발송/중복 차단. 단 claim 후 예외로 throw하면 'sending'에 stuck될 수 있음 → 복구(타임아웃) 고려.

### 순수 테스트 DB-free 분리 — config/database import 시 process.exit(1)

`config/database.ts`는 import 시점에 `pool.query("SELECT 1")` + MYSQL_PASSWORD 미설정 시 `process.exit(1)`. 따라서 그 모듈을(또는 transitive로 끌어오는 customer-filter 등을) import한 모듈은 `.verify.ts` 순수 테스트가 즉시 종료된다.

**대책**: 순수 함수는 **DB import가 없는 파일**로 분리. SQL 빌더는 filterWhere를 **주입**받게 설계(operator-recipients.buildSendableRecipientsSql처럼) → journey-safety-filter 같은 순수 CT만 import → DB-free 테스트 가능. buildFilterWhereClauseCompat 호출은 DB-쓰는 호출부가 담당.

### updated_at 없는 컬럼을 UPDATE에 박아 조용히 실패

`operator_proposals`에는 `updated_at` 컬럼이 없는데 스팸 결과 UPDATE에 `updated_at = NOW()`를 박아 → catch에 삼켜져 spam_test_* 저장이 매번 조용히 실패하던 잠재 버그. **information_schema로 컬럼 실재 확인 후 UPDATE 작성**(db_column_verify_before_code). tsc는 SQL 문자열 컬럼을 검증 못 함.

### 직접발송 함수 추출(createDirectSendCampaign) — 동작 보존

/direct-send/commit 본문(라인그룹·검증 후 staging COUNT·campaign INSERT·prepaidDeduct·trigger)을 함수로 추출해 HTTP 엔드포인트와 자율 발송 워커가 공유. **INSERT 18 컬럼 파라미터를 순수 빌더(buildDirectSendCampaignParams)로 빼 테스트로 고정** → 톤28 504 정정(즉시 202+COUNT-only) 동작을 회귀 없이 보존.

---

## 자동마케팅·여정 점검 정정 (2026-06-06 / 배포)

### 차감↔발송 원자성 — 건당 발송은 "발송 성공 시점 차감"이 환불보다 깨끗 (여정 J1)
- **사고 구조**: journey-executor가 prepaidDeduct를 큐 INSERT 앞·비멱등(reference=journey_id)으로 호출 → 큐 실패 시 환불 없이 재시도가 재차감(중복 차감), 큐 성공인데 step_log 실패 시 재발송. 직접발송 워커는 실패분 환불하나 여정은 안 했음.
- **교정**: 큐 앞 = read-only 잔액 사전 확인만. 큐 성공 직후 = 멱등 마커(step_log 'sent') 먼저 기록 → 실제 차감. 큐 실패·발신번호 무효 = 차감 0·비용 0(advance 0). 재시도는 마커(alreadySent 가드)로 중복 차단.
- **원리**: 배치(직접발송)는 차감-후-환불(idempotent prepaidRefund, reference=campaignId 누적). 건당(여정)은 발송 성공 시점 차감 + 멱등 마커가 더 단순·안전(환불·reference 변경 불필요). **prepaidDeduct는 멱등 아님 — 같은 reference 매 호출 차감.**

### 월 예산은 누적 컬럼이 아니라 당월 로그 SUM (여정 J2)
- budget_monthly 검사가 journeys.stats_total_cost(전기간 누적)를 updated_at 당월 필터로 SUM = 단일 행이라 사실상 전기간 한도(월 리셋 없음). → 이번 달 journey_step_logs.cost(status='sent', sent_at >= date_trunc('month', NOW())) 합으로 교정.

### 같은 테이블 두 컬럼 세트 공존 = 쓰기/읽기 불일치 stale (여정 J3)
- journey_step_variants에 arm_alpha/arm_beta/variant_label(과거 503 "없는 컬럼" 정정 때 추가만)과 bandit_alpha/bandit_beta/variant_id(쓰기·선택 경로)가 공존. journey-stats는 arm_*/variant_label을 읽는데 그 컬럼은 한 번도 갱신 안 돼 변이 사후확률이 0.5 고정. → 쓰기 경로 컬럼(bandit_*/variant_id)을 출력 별칭으로 읽게 교정(map 무변).
- **교훈**: "없는 컬럼" 503을 컬럼 추가로만 막으면 데이터는 안 흐른다 — 쓰기 경로가 쓰는 컬럼으로 읽기를 통일. 두 세트 의심 시 information_schema 덤프로 실재 확정(0번 원칙). (operator_proposal_variants의 arm_*는 그 테이블 정상 컬럼 — 혼동 주의.)

### 자동마케팅 자율발송 'sending' 정지 복구 + 광고 080 가드
- claim(scheduled/pending→sending) 후 발송 커밋 전 예외면 'sending'에 영구 정지(runAutoSendPass는 scheduled만 조회). → dispatchProposalSend 커밋 전 try/catch가 admin_review로 내림 + createDirectSendCampaign 직후 campaign_id 마커 + 매 패스 reconcileStuckSending(campaign_id 있으면 sent 마감 / 없고 노후면 admin_review, 자동 재발송 X). 순수 decideStuckSendingRecovery + verify.
- 광고(isAd)인데 무료거부 번호(080·reject 폴백) 없으면 "(광고)…무료거부"가 번호 없이 발송(정보통신망법) → 자동·수동 공유 dispatchProposalSend에 가드(없으면 admin_review).

---

## 발송 시각 기준 통일 (D233+ 추가)

### D233+ (2026-06-09) — 발송통계 성공→실패 오분류 + 미도래 예약 대기집계 (등록시각 vs 발송시각)

**사고**: shiseido4·라프레리 발송통계에서 정상 성공 건이 실패로 집계(목록=실패/상세=성공), 미발송 예약이 '대기'로 집계. P1 돈/정산.

**Root cause**: **모든 시각 체크가 "발송시각"이 아니라 "등록/요청 시각" 기준**. 예약발송은 `campaigns.sent_at`이 **생성 시점**에 찍히고 실제 통신사 송출은 `scheduled_at`에 일어남.
- `campaign-lifecycle.ts` 120분 타임아웃이 `sent_at || scheduled_at`(등록 우선) → 예약은 scheduled_at에 발송되는 순간 이미 "120분 초과" → 통신사 결과 몇 초만 늦어도 `pending→실패`로 굳음. 굳으면 `success+fail=target`이라 재sync(`target > success+fail`)에서 **영구 제외**(session6 markFinalized와 같은 뿌리). 상세=MySQL 실시간(성공)·목록·통계=PG 캐시(실패) 불일치.
- 발송통계가 STAT_DATE_EXPR로 묶기만 하고 "발송 시작됨" 가드가 없어 미도래 예약도 집계.

**정정** (backend ~25곳):
- 발송시각 = `COALESCE(scheduled_at, sent_at)`로 타임아웃·markFinalized·sync 윈도우·성과집계 전수 통일(`campaign-lifecycle`·`campaign-sync-worker`·`mysql-refund-sweeper`·`stats-aggregation`). AI/직접 sync에 예약 발송전 제외 가드(`scheduled_at <= NOW`).
- `STAT_STARTED_GUARD = NOT (c.status='scheduled' AND COALESCE(c.scheduled_at,c.sent_at) > NOW())` CT 신설 + STAT_DATE_EXPR 소비처 전수 동반(발송통계·상세·캠페인관리·발송결과·export·results 요약/목록).
- 후불은 `prepaidRefund` no-op(prepaid.ts:68)이라 돈 영향 0(표시 전용). 굳은 65건 `result_final=false`+counts0 UPDATE로 실시간 복귀+재집계.

**교훈**:
- **발송 관련 시각 체크는 전부 발송시각(scheduled 우선). 예약 `sent_at`은 등록 때 찍히는 함정** — 타임아웃/통계/sync/확정/윈도우에 sent_at-first면 예약 오작동.
- **타임아웃류는 값을 굳히면(예: success+fail=target) 재처리에서 빠지는지 확인** — 굳히기 전 발송시각 기준 충분한 유예.
- **통계 = 발송 시작된 것만**. 미도래 예약은 별개(취소 가능). STAT_DATE_EXPR 소비처엔 STAT_STARTED_GUARD 동반.

---

## 예약취소 미삭제 실발송 — 라인 불일치 + 무검증 성공 표시 (2026-06-11 추가)

### 2026-06-11 — 에이치피오 예약취소 87,014건 실발송 (손해 250만원, CLAUDE.md 최상단 6원칙의 기원)

**사고**: 06-10 17:50 취소(화면·PG 모두 취소 표시)한 87,014건 LMS가 06-11 10:00 실발송. 예약 직접발송 = 등록 직후 MySQL 큐 선적재(sendreq_time=예약시각)라 취소의 실체는 큐 DELETE인데, 적재는 사용자 라인(`getCompanySmsTables(companyId, userId)`)·취소는 회사 라인만(`getCompanySmsTables(companyId)` — userId 누락) 조회해 DELETE 0건 → 검증 없이 PG만 cancelled → 발송. 전날(0610) 같은 라인 불일치를 집계(읽기)에서 고치고 취소(쓰기) 경로 전수 grep을 빠뜨린 대가.

**근본수정 5겹**: ① 적재 워커가 실제 INSERT 테이블을 `send_config.sentTables`에 기록 ② `getCampaignQueueTables` CT(기록 1순위+회사·사용자·전 사용자 라인 합집합) — 큐를 만지는 6곳(취소/수신자조회/수신자삭제/시간변경/문안수정/안전망) 단일 헬퍼 ③ 취소 = DELETE 후 잔존 0 재카운트 검증 후에만 성공 응답(잔존>0이면 success:false — 환불·PG 변경 전이라 무변경) ④ direct-send-worker 취소 가드 3곳(queued 조회·claim에 status!='cancelled' + 청크마다 감지 시 적재분 삭제 중단 + 완료 UPDATE 가드) ⑤ cancelled-queue-sweeper 1분 안전망(취소됐는데 큐에 남은 행 자동 삭제, SMS+카카오).

**교훈**:
- **큐를 변경하는 모든 경로(취소/삭제/시간변경/문안수정)는 발송 적재와 같은 테이블 집합을 보고, 변경 후 실제 효과(잔존 0)를 검증한 뒤에만 성공 표시.** DELETE 0건인데 성공 응답 = 시스템이 거짓말 — 예약시간 변경·문안 수정도 같은 결함이라 화면만 바뀌고 옛 시각·옛 문안으로 발송되던 잠재 사고였다.
- **같은 원인 fix 시 읽기(집계)뿐 아니라 쓰기(DELETE/UPDATE) 경로까지 전수 grep** — 하루 차이로 같은 뿌리 재발.
- **예약 발송 구조 = 큐 선적재라 PG 상태는 발송을 막지 못한다.** PG 상태 ↔ MySQL 큐처럼 진실이 두 곳이면 자동 대조 안전망 워커 동반 의무.
- 사후 추적 = nginx access log(시각·IP·UA) + audit_logs login(계정) + MySQL 월별 이력(라인 전환점) 3종 대조로 본문 로그 없이도 행위를 데이터로 닫을 수 있다. 이후는 audit-log CT가 변경 전후를 직접 기록.
- 상세 = CLAUDE.md `dev_process_six_rules` + `memory/project_2026_0611_cancel_line_mismatch_incident.md`.

---

### 2026-06-11 — 알림톡 강조형 7300 최종 근본 = 대표링크 미동봉 (이틀 추적 종결 — 가설 2개 폐기)

**사고/추적**: 79738 강조표기형만 전 건 7300. 가설 1(sender_code concat NULL — 부차, 가드 수정으로 종결)·가설 2(imc_template_status R 차단 — 폐기) 거쳐, 휴머스온 답변+실측으로 최종 확정: **템플릿에 등록된 대표링크(ATTACHMENT.link)를 발송 요청에 미동봉 → 카카오 등록값 불일치 거부**. 한줄로는 `kakao_templates.represent_link`를 저장만 하고 발송 경로 소비 0건이었다.

**교훈**:
- **카카오 알림톡의 템플릿 부속 데이터(버튼·대표링크)는 "등록값 = 발송 요청 동봉값" 일치 의무.** 저장 컬럼이 있다고 끝이 아니라 발송 적재까지 이어져야 한다. 신규 템플릿 요소 추가 시 = 등록 → 저장 → 발송 동봉 → 게이트웨이 변환 → IMC 4구간 전부 점검.
- **IMC 템플릿 status 정의(휴머스온 공식): S=중지 / A=정상 / R=대기(발송 전 — 첫 발송 시 자동 A).** R은 차단 사유가 아니다. "발송해야 A가 되는데 발송을 막는" 차단 로직은 신규 템플릿 첫 발송을 영구 차단하는 역효과 — 상태값 의미는 공급사 공식 정의로만 확정하고 추정 차단 금지.
- **다구간 체인(한줄로→에이전트→게이트웨이→IMC→카카오) 디버깅 = 구간별 운반 실측으로 막힌 지점을 좁힌다.** 형식 추측 반복(LINKTEST 5회) 대신 각 구간 로그(SMSQ 적재값 → 게이트웨이 deliver 전문 → IMC 접수 데이터)를 먼저 대조했으면 1회에 끝났다. "다른 업체는 된다" = 그 업체 발송의 실제 전문을 보는 게 최단 경로(타업체는 전부 대표링크 없는 템플릿이었음).
- **차이 변수 확정은 대조군 SQL 1방** — 정상 5개 vs 실패 1개 템플릿의 represent_link/buttons 한 줄 비교로 원인 변수가 즉시 드러났다.
- 게이트웨이(인비토 자체, mmsr3/ngen) deliver 전문 필드 = title/btnJson/etcJson뿐. btnJson=버튼 전용(매뉴얼 name1/type1/url1_1/url1_2 → IMC button 변환 실증), etcJson=평면 변수 봉투(title/senderkey/sendercode 실증). link는 엔진 매핑 추가(서팀장) 후 etcJson `{"link":{"urlMobile","urlPc"}}`로 운반 예정. IMC v1 스펙 = link 최상위 camelCase, link 포함 시 버튼 최대 2개.
- 상세 = `memory/project_2026_0609_alimtalk_emphasize_etcjson_diagnosis.md` + STATUS.md 2026-06-11 항목.

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
