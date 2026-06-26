# 자동마케팅(Continuous Operator) 전면 재점검·업그레이드 설계

작성일: 2026-06-26
대상: AI 자동마케팅 = Continuous Operator (continuous_operators + operator_proposals)
요청: 보고된 6개 오류 수정 + 전체 코드 재점검 + 안정화 + 발전 기능 설계·구현

---

## 1. 현재 아키텍처 (확인된 사실)

- DB: `continuous_operators`(영구 목표 설정) + `operator_proposals`(매일 AI 제안서)
- 엔진: `utils/continuous-operator.ts`(createOperator/listOperators/updateOperator + 제안 생성) + `services/ai-orchestrator.ts`(orchestrate: 타겟·메시지 생성) + `utils/autosend-policy.ts`(순수 정책: lead분·발송판정·정지복구) + `utils/continuous-operator-policy.ts`
- 워커: app.ts `startContinuousOperatorScheduler` — **5분 주기** due check(next_run_at ≤ now)
- 라우트: `routes/ai.ts` 1748(create)/1776(list)/1798(update) + 제안 승인/거부/발송 경로
- 프론트: `pages/ContinuousOperatorPage.tsx` (생성/수정 폼 + 제안 목록·상세)
- 자율발송: 제안 'scheduled' → 준비(lead 120분) 뒤 자율 발송, dispatchProposalSend(직접발송 코어 공유), 발송 성공 시점 멱등 차감

### continuous_operators 현재 컬럼
id, company_id, created_by, name, objective, schedule, schedule_time, (schedule_day_of_week/month — ALTER 추가됨), status, last_run_at, next_run_at, total_*, created_at, updated_at

**누락 컬럼(이번 업그레이드 핵심)**: channel/message_type, benefit_content, notify_phones, backup_phones, notify_channel, lead_minutes

---

## 2. 6개 보고 이슈 — 근본 원인

| # | 증상 | 근본 원인 | 비고 |
|---|---|---|---|
| 1 | 발송 채널 선택 없음 (LMS 고정인데 테스트엔 SMS) | continuous_operators에 channel 컬럼 없음 → 제안 생성이 채널 비저장, 기본값으로 결정 | Harold 결정: 폼에서 선택 |
| 2 | VIP 동의 300명인데 타겟 299명 | **확정: 버그 아님** — countFilteredCustomers 안전필터(is_opt_out·is_invalid·수신거부 안티조인)가 1건 정당 제외. 고객DB 뷰어는 sms_opt_in만 필터 | UI에 "발송가능/매칭" 2값 노출로 해결 |
| 3 | 수정 시 담당자/백업 연락처 빈칸 + 2시간 전 알림 안 옴 | notify_phones/backup_phones/lead_minutes 컬럼 없음 → 폼 수집값 드롭 → 저장·로드·알림 전부 불가 | #1과 같은 뿌리 |
| 4 | 목표에 혜택 입력했는데 문안은 [혜택 내용을 입력해주세요] | benefit_content 컬럼·입력칸 없음 → 메시지 생성이 placeholder 유지 | Harold 결정: 별도 입력칸 |
| 5 | 10:00 지정인데 10:03/10:06 생성 | 워커 5분 주기 폴링 → 정각 후 다음 폴에 생성 | 경미(제안 시각, 발송은 lead 후) |
| 6 | 모든 사용자가 타사용자 자동발송 확인·수정 가능 | listOperators(companyId)·제안 목록·수정이 created_by 필터 없음 | 일반=본인만, 중간관리자/admin=전체 |

---

## 3. 설계 — 수정 + 추가

### 3-1. 스키마 — 신규는 2컬럼뿐 (★ 2026-06-26 information_schema 덤프로 정정)
덤프 결과 담당자/lead/예산 컬럼은 **이미 존재**:
`admin_phone_numbers`(text[])·`backup_admin_phone`·`admin_alert_channel`·`auto_send_lead_minutes`·`budget_monthly/daily/budget_alert_threshold`·`delivery_policy`·`opt_out_minutes`·`spam_score_threshold`·`max_spam_retries`·`verification_*`.
→ #3은 컬럼 부재가 아니라 **createOperator/updateOperator/list가 이 컬럼들을 쓰지/읽지 않는 코드 누락**.

- 진짜 신규 ADD 2개만: `channel varchar(10) DEFAULT 'lms'`(#1) + `benefit_content text`(#4).
- 처음 잘못 추가한 중복 4컬럼(notify_phones/backup_phones/notify_channel/lead_minutes) = **DROP**(두 컬럼셋 stale 차단, LESSONS J3). 데이터 0이라 안전.
- #3 fix = createOperator/updateOperator/list가 **기존 컬럼**(admin_phone_numbers·backup_admin_phone·admin_alert_channel·auto_send_lead_minutes) 저장·로드하도록 배선. (예산/delivery_policy도 이미 존재 → Phase 2 D는 신규 컬럼 불요.)

### 3-2. 채널 일관 적용 (#1)
- 폼: SMS/LMS(/MMS) 선택칸 추가 → operator.channel 저장
- orchestrate/제안 생성: operator.channel을 메시지 채널로 사용 (LMS 기본 분기 제거)
- 발송 2시간 전 스팸테스트·자율 발송도 동일 채널 → 제안·테스트·실발송 채널 100% 일치

### 3-3. 혜택 반영 (#4) — AI 임의 생성 금지 정합
- 폼: '혜택 내용' 입력칸(관리자 직접 작성) → operator.benefit_content 저장
- 메시지 생성: `[혜택 내용을 입력해주세요]` placeholder를 benefit_content로 치환. benefit_content 비어 있으면 placeholder 유지(승인 단계 차단 — hasUneditedPlaceholder 정합)
- AI는 혜택을 지어내지 않음 — 관리자가 적은 값만 사용 → 정보통신망법·거짓광고 룰 정합

### 3-4. 담당자 알림·연락처 (#3)
- 6필드 저장·로드 + 발송 2시간 전(= scheduled_send_at − lead) 스팸테스트 통과 문안을 notify_phones로 발송 (현 scanAndPretest/journey 패턴 재사용)
- 실측: 생성 직후 수정 재진입 시 연락처 유지 + 2시간 전 알림 1건 실제 수신

### 3-5. 생성 시각 정렬 (#5)
- due check 폴 주기 5분 → 1분으로 단축 (정각 ±1분), 또는 next_run_at 도래분에 정렬. (부하 영향 낮음 — listActiveOperators는 인덱스 100건 LIMIT)

### 3-6. 권한 격리 (#6) — ★ 2026-06-26 Harold 결정: 현행 유지(변경 없음)
- 2026-06-19 Harold 명시 "일반 사용자도 회사 자동마케팅 수정 가능(회사 스코프)"과 이번 보고가 충돌 → Harold 재확인 결과 **현행(회사 전체 공유) 유지**. 코드 변경 없음.

### 3-7. #2 타겟 카운트 — 확정: 버그 아님 (UI 명확화만)
- `countFilteredCustomers`(ai.ts:2283)가 `buildJourneySafetyFilter`(is_active·sms_opt_in·is_opt_out·is_invalid·unsubscribes 안티조인)로 카운트 → 고객DB 뷰어(동의만 필터, 300)보다 수신거부·무효 1건을 정당 제외 → 299. 보내면 안 되는 1명이 빠진 게 정상.
- 함수가 이미 `unsubscribeCount` 반환 → 제안 카드/상세에 "발송 가능 N · 조건 매칭 M (수신거부·무효 K 제외)" 2값 노출. 카운트 로직 변경 없음.

---

## 4. 발전 방안 (Harold 선택: A·B·C·D 전부 본 범위 포함)

A. **성과 학습 강화** — 현 Bandit(variant 선택)을 실제 클릭/전환 데이터로 보상 누적 정교화. 회사별 누적될수록 제안 문안·시각 자동 개선. 보상 = 실측 클릭/전환만(임의 상수 금지).

B. **발송 시각 최적화** — 고객별 과거 반응 시간대로 자율 발송 시각 개인화(`send-time-util` 재사용). 데이터 부족 시 등급별 실측 폴백 → 부족하면 정직 안내(임의 상수 X).

C. **다단계 시퀀스** — 자동마케팅 1발이 아닌 (1차 안내 → N일 후 미반응자 리마인드) 짧은 시퀀스. 여정 엔진(journey_step_campaigns·executor) 재사용 검토 — 신규 발송 파이프라인 신설 금지.

D. **예산·한도 가드 강화** — 월 예산/일별 한도/임계 알림(현 cost 제어)을 자율 발송 직전 재검증 + 초과 시 자동 보류(admin_review). 월 한도 = 당월 로그 SUM(누적 컬럼 X — 여정 J2 교훈).

E(부가). **제안 품질 가시화** — 제안 카드 타겟 근거·실데이터 출처·채널 적합도 표시 강화. 재점검 단계에 흡수.

전부 포함이나 규모가 크므로 §6처럼 Phase로 나눠 한 건씩 진행.

---

## 5. 검증·안전망 (6원칙 정합)
- 발송·돈 닿는 변경(채널·혜택·타겟·자율발송) = 실측 1건 시나리오 의무
- 차감↔발송 원자성·멱등(현 dispatchProposalSend 패턴 보존)
- 상태값 추가/변경 시 집계 SQL 전수 grep
- DB ALTER 새 컬럼 endpoint catch에 column-does-not-exist 503 분기
- 순수 정책(autosend-policy)·신규 순수 로직 vitest, 통합은 tsc + 검증된 패턴

---

## 6. 작업 순서 — Phase별 (no_parallel_tasks: 한 건씩)

### Phase 1 — 6 버그 fix + 재점검 (필수 토대)
1. #2 타겟 카운트 orchestrate 필터 대조 → 분기 확정
2. 스키마 ALTER(6컬럼) + createOperator/updateOperator/list 저장·로드 (#1·#3·#4 토대) — information_schema 검증 후
3. 폼(ContinuousOperatorPage): 채널 선택 + 혜택 입력칸 + 담당자/lead 저장·로드
4. 메시지 생성: 채널 일관 + benefit_content placeholder 치환
5. 발송 2시간 전 담당자 알림 배선(notify_phones·lead)
6. 권한 격리 전수(created_by 가드 — list/detail/update/proposal)
7. 생성 시각 정렬(폴 5분→1분) + E(제안 품질 가시화) 흡수
8. Phase 1 실측 + 검증(생성→수정 재진입 연락처 유지·채널 일관·혜택 반영·2h 알림 1건·권한 격리)

### Phase 2 — D 예산 가드 + A 성과 학습
9. D: 자율 발송 직전 월예산/일한도 재검증(당월 로그 SUM) + 초과 보류
10. A: Bandit 보상을 실측 클릭/전환으로 누적 정교화

### Phase 3 — B 시각 최적화 + C 다단계 시퀀스
11. B: 고객별 반응 시간대 개인화(send-time-util) + 데이터 부족 정직 폴백
12. C: 미반응자 리마인드 시퀀스(여정 엔진 재사용)

각 Phase 종료 시 tsc + vitest + 실측 보고 후 다음 Phase 진입. 발송·돈 닿는 단계는 실측 1건 의무.
