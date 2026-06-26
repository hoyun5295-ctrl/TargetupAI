# 자동마케팅(Continuous Operator) 업그레이드 — 다음 세션 인계

작성: 2026-06-26 (세션 종료) · 다음 세션 진입용
배포: **아직 안 됨.** Harold 명시 = 다음 세션에서 Phase 2~3까지 다 끝내고 **한 번에** 배포. (이번 세션 모든 작업 미배포.)

---

## 0. 먼저 읽을 것
- 설계 spec: `docs/superpowers/specs/2026-06-26-auto-marketing-upgrade-design.md` (Phase 1~3 전체 + §6 작업 순서)
- 이 인계문 전체

## 1. 자동마케팅 = Continuous Operator (구조)
- DB: `continuous_operators`(영구 목표 설정) + `operator_proposals`(매일 AI 제안)
- 엔진: `utils/continuous-operator.ts`(CRUD + generateProposalForOperator + worker) · `services/ai-orchestrator.ts`(orchestrate: 타겟·문안 생성) · `utils/autosend-policy.ts`(순수 정책) · `utils/bandit-optimizer.ts`(variant 선택)
- 라우트: `routes/ai.ts` (POST 1747 create / GET 1772 list / PUT 1784 update / 제안 승인·거부·발송)
- 프론트: `pages/ContinuousOperatorPage.tsx`
- 워커: app.ts `startContinuousOperatorScheduler` (이번에 5분→1분)

## 2. ★★ 절대 주의 — continuous_operators 컬럼 (재실수 금지) ★★
information_schema 덤프(2026-06-26)로 확인: 아래 컬럼이 **이미 존재**한다. 절대 새로 ADD 하지 말 것.
`admin_phone_numbers`(text[]) · `backup_admin_phone`(varchar) · `admin_alert_channel`(varchar) · `auto_send_lead_minutes`(int) · `budget_monthly` · `budget_daily` · `budget_alert_threshold`(default 80) · `delivery_policy` · `opt_out_minutes`(default 5) · `spam_score_threshold`(default 30) · `max_spam_retries`(default 3) · `verification_required_days/passed_days` · `schedule_day_of_week/month`.
- 이번 세션에 **진짜 신규 2개만 ADD**: `channel varchar(10) DEFAULT 'lms'` · `benefit_content text` (ALTER 적용 완료).
- 처음에 잘못 추가한 중복 4컬럼은 DROP. **다음 세션 첫 작업으로 아직이면 실행:**
```sql
ALTER TABLE continuous_operators
  DROP COLUMN IF EXISTS notify_phones,
  DROP COLUMN IF EXISTS backup_phones,
  DROP COLUMN IF EXISTS notify_channel,
  DROP COLUMN IF EXISTS lead_minutes;
```
- 교훈: SQL 코드 전 **information_schema 덤프 먼저**(db_column_verify). 이름만 다른 중복 컬럼 = J3 stale 사고.

## 3. Phase 1 — 완료 (6개 보고 이슈) · 미배포
| # | 처리 | 파일 |
|---|---|---|
| #1 채널 | 폼에 SMS/LMS/MMS 선택칸 + orchestrate가 `targetResult.recommended_channel`를 ctx.forcedChannel로 **1곳 override**(327행 직후) → 문안생성·검수·비용·표시 전 하류 일관 | ContinuousOperatorPage / ai-orchestrator / continuous-operator / ai.ts |
| #2 타겟 299/300 | **버그 아님 확정** — `countFilteredCustomers`(ai.ts:2283 buildJourneySafetyFilter)가 수신거부·무효 1건 정당 제외. 고객DB 뷰어는 sms_opt_in만 필터(300). | (코드 변경 없음) |
| #3 담당자 연락처 | 근본 = POST(생성) 라우트·createOperator가 담당자/예산/lead를 통째 드롭(PUT·스키마·updateOperator는 이미 지원). 생성 경로 배선 완료 | continuous-operator(CreateOperatorInput·INSERT·mapRow) / ai.ts POST |
| #4 혜택 | 폼 '혜택 내용' 입력칸 + orchestrate가 생성 문안의 `[혜택 ...]`(정규식 `/\[혜택[^\]]*\]/g`)를 benefit_content로 치환. 미입력 시 placeholder 유지 → 승인 차단 | 동상 |
| #5 생성 시각 | 워커 폴 5분→1분 (continuous-operator startContinuousOperatorScheduler) | continuous-operator |
| #6 권한 | **Harold 결정 = 현행 유지(회사 전체 공유)**. 변경 없음 (2026-06-19 결정 유지) | (코드 변경 없음) |

검증: 백엔드 tsc 0 · vitest 70/70 · 프론트 tsc 0 · 금지 단어 0.

### Phase 1 남은 선택 항목(필수 아님)
- #2 UI 명확화: 제안 카드에 "발송가능 N / 조건매칭 M (수신거부·무효 K 제외)" 2값 표시. countFilteredCustomers가 `unsubscribeCount` 반환하나, 매칭(안전필터 전) 카운트는 별도 1쿼리 필요. 폴리시로 남김.

## 4. Phase 2~3 — 구현 완료 (2026-06-26 세션 / 미배포)
no_parallel_tasks대로 한 건씩. 전부 tsc 0 + 단위 테스트 통과. 발송·돈 종단 검증은 배포 후 실측(직원, 6원칙 ⑤).

### Phase 2 D — 예산 가드 (완료)
- 자율 발송 직전 월/일 예산 재검증. 순수함수 `decideBudgetGuard`(autosend-policy, verify 9건) + `sendScheduledProposal`(continuous-operator) 배선. 당월/당일 로그 SUM(누적 컬럼 X·J2), status 집합은 listOperators sub-query와 동일. 초과·검증 실패 시 admin_review 보류(돈 보호 fail-safe). 수동 승인 경로는 제외(자율 발송 전용).

### Phase 2 A — 성과 학습 (완료 — 근본 버그 정정 포함)
- **버그 정정**: 보상 함수 `if(sent<=0)return` 가드가 클릭/전환(sent=0) 호출(short-url·cdp)을 전부 떨궈 학습이 정지돼 있었다(operator·journey 공통). α/β를 실측 count에서 도출(`deriveBanditArm` 순수·vitest 8건)로 단일화 + 가드 제거. 읽기 경로(bandit-optimizer mapRow/listJourneyStepVariants + journey-stats) 도출 통일 → 과거 drift 자가 치유, DB 마이그레이션 불요. **여정 A/B도 즉시 정상화**.
- 자율 발송이 Bandit 추천 변이 발송 + sent_count 실측 기록(dispatchProposalSend). 발송 본문 URL을 변이 id로 단축·추적(shortenUrlsInText) + 클릭을 종류 무관 라우터(`recordVariantClickConversion`)로 매칭 테이블 귀속 → 자동마케팅 변이가 실제 클릭으로 학습. message_short_urls ALTER 불요(uuid 전역 유일).
- **A4 전환 자동 귀속(구매→변이)은 보류** — α/β 모델이 클릭만 성공 신호로 쓰므로(임의 가중치 회피) 학습은 클릭으로 완결. 전환 자동 귀속은 별도 attribution 설계 필요.

### Phase 3 B — 발송 시각 최적화 (완료)
- 회사 `cdp_events 'message_click'` 시각(KST) 히스토그램에서 발송 가능 시간대 내 클릭 피크로 자율 발송 예정 시각 개인화. 순수함수 `pickBestSendHour`·`computeOptimalSendAt`(send-time-util, verify 7건). 준비(정지) 창 보존. 표본<20·시간대 내 클릭 없음·조회 오류 시 현행 now+lead 폴백(insufficient_data 정직). `resolveOptimalScheduledSendAt`가 generateProposalForOperator 배선.

### Phase 3 C — 다단계 시퀀스 (완료 — ★접근 분기)
- **여정 엔진 자동 생성은 채택 안 함**: 여정은 draft→활성화+pretest 안전 게이트를 거쳐야 발송되는데, 자동 생성 여정이 이 게이트를 우회하면 발송 사고 위험 + 여기서 종단 검증 불가. 대신 **자동마케팅의 검증된 발송 경로(dispatchProposalSend) 재사용**(신규 파이프라인 신설 금지에 부합) — 예산 가드·추적·광고/080 가드 그대로 적용.
- 구현: 1차 발송 성공 시 `scheduleSequenceReminder`가 같은 오퍼레이터의 'scheduled' 리마인드 제안을 N일 후로 예약(관리자 입력 문안 `sequence_reminder_content`). 리마인드 발송 시 수신자 추출에서 1차 후 클릭한 고객 제외(`buildSendableRecipientsSql(excludeClickedSince)` anti-join, verify 2건). `proposal_json.meta.is_reminder`로 리마인드 재귀 차단. 담당자 예약 알림 전송.
- 신규 컬럼 3개 ALTER 적용 완료: `sequence_enabled` boolean DEFAULT false / `sequence_delay_days` int / `sequence_reminder_content` text. createOperator·updateOperator·listOperators·mapRow·라우트(POST/PUT)·프론트 폼(토글+대기일+리마인드 textarea) 배선.
- **알려진 갭(정직)**: 리마인드 제안은 1차와 달리 사전 스팸테스트를 거치지 않음(관리자 직접 입력 문안 + 발송 N일 전 담당자 예약 알림으로 사람 검토 가능). 광고/080 가드는 동일 적용.

### 변경 파일
백엔드: utils/{autosend-policy, bandit-arm(신규), bandit-optimizer, journey-stats, send-time-util, operator-recipients, continuous-operator}.ts · routes/{ai, short-url}.ts · 테스트 {bandit-arm.test, autosend-policy.verify, journey-send-time.verify, operator-recipients.verify}.ts
프론트: pages/ContinuousOperatorPage.tsx
DB(이번 세션 Harold 적용 완료): 중복 4컬럼 DROP + channel/benefit ALTER + sequence 3컬럼 ALTER.

## 5. 배포 (다음 세션 끝에 한 번에)
- 이번 세션 전체(앞서 커밋된 드래그/3항목/취소 fix + 자동마케팅 Phase 1~3) 묶어 배포.
- 자동마케팅: 백엔드 `pm2 restart all`(ts-node) + 프론트 `build:safe`. DB는 이미 적용 완료(DROP + channel/benefit + sequence ALTER).
- 검증: 백엔드 tsc 0 · 프론트 tsc 0 · vitest 78/78 · verify (autosend 28 / operator-recipients 9 / send-time 16). 금지 패턴(박-단어/모델명/native dialog) 0건.
- 배포 후 실측(직원, 6원칙 ⑤):
  1. 자동마케팅 1건 채널=SMS + 혜택 입력 + 시퀀스 ON(대기 1일·리마인드 문안 입력)으로 생성 → 제안 문안 SMS형식 + 혜택 반영 + 담당자 알림 수신.
  2. 자율 발송 1건 후 → 다음 제안의 Bandit 추천이 변이 누적 클릭에 따라 달라지는지(operator_proposal_variants click_count 증가) 확인.
  3. 1차 발송 → 1일 후 리마인드가 미클릭자에게만 발송되는지(scheduled 리마인드 제안 + excludeClickedSince) 확인.

## 6. 룰 리마인더 (헛소리 방지)
- no_guess_strict / db_column_verify(information_schema 먼저) / no_parallel_tasks(한 건씩) / no_arbitrary_benefit(AI 혜택 생성 X — benefit은 관리자 입력값만) / no_arbitrary_constants(성과·예산 실데이터) / verification-before-completion(tsc+vitest+실측) / 발송·돈 = 실측 1건.
