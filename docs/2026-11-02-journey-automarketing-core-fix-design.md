# 여정 · 자동마케팅 핵심 결함 처방 설계서 (2026-11-02)

> 절차 = `status/DEFECT-PLAYBOOK.md` 3단계(흐름 표 → 결함 장부 → **설계** → 구조체크 · Codex → 구현 → 계약 시험 → Codex → 배포 → 직원 확인).
> 범위 = 흐름 표 전체(`docs/2026-11-02-journey-automarketing-flow-ledger.md` · 빈칸 0 · Harold 1102 「AI 오퍼레이터 전 기능이 파는 기능 · 여정 · 자동마케팅이 가장 중요하고 복잡하니 완벽하게」).
> 결함 사실 = `docs/2026-11-02-journey-automarketing-delivery-check.md`(파일:행 · 서버 지금 / 배포 뒤). 이 문서 = 처방 · 순서 · 시험 · 직원 지시문 · DDL.

## §0 진행 표

| 단계 | 상태 |
|---|---|
| 흐름 표 · 결함 장부 | 끝(빈칸 0) |
| 설계(이 문서) | 2판(1102 밤 전수 읽기 끝 · D1 ~ D21 + B-1102-1) |
| 설계 구조체크 | 1회차 · 2회차 = §9 · 3-0 줄 단위 대조 |
| Codex 설계 | **approve(1102 밤 5R · 1R 8 → 2R 4 → 3R 1 → 4R 3+중단분 1 → 5R 0 · 전부 수용 · 같은 부류 = 구조 처방 · 표 = §9)** |
| Harold 동의 · 정할 것(§4) | ① ~ ⑧ 확정(1102 밤 「추천대로 정함」 두 번 · 「그렇게 고침」) · ⑨ = 두 문 다(1103 「추천대로 정함」) · **C99 로 따로 처방(§11 · 이 배포에 없음)** · 「전체 다 닫아야지」 |
| 새 칸 확인 | 끝(§5 확인 출력 · Harold 1102 21:56) |
| 구현 · 계약 시험 | 끝(1103 · §10 · tsc 0 · 백엔드 752파일 11,376 · 실 PG 46파일 310 · 계약 = `journey-automarketing-core-1102.test.ts` 67 · 변이 빨간불) |
| Codex 구현 | 2R approve(1103 · §10 끝 표) |
| 배포(C96 과 한 배포 · 원장 C98) · 직원 확인 | 전 |

## §0-1 스팸 검사 기준(1102 밤 Harold 확정 · 이 설계 전체가 따른다)

- 원문 요지: 「여정 · 자동마케팅 둘 다 트리거가 있으면 바로 처리 · 매일 승인하게 만들 수 없다 · 회사 단위 묶음 · 일요일 → 월요일 밤 회사별 검사 · 걸린 것만 일시정지 · 업체별 상황판 · 월요일 오전 9시 확인 문자 · 걸린 것을 누르면 그 여정이든 자동마케팅이든 바로 이동해 문안을 바꾸고 검사(AI 생성이든 직접 입력이든)」 · 「월요일에 나가야 하는 사람들의 문안이 구멍」 → 추천안 A 로 진행 · 「예약 · 배송 안내는 카카오 템플릿을 더 쓴다 · 카카오는 검수 대상이 아니다」 · 「100% 다 막을 수는 없다 · 통신사가 아니고 실시간으로 로직이 바뀐다 · 최대한 신경을 쓰자」.
- 기준
  1. 트리거 = 바로 처리(검사가 발송을 막지 않는다 · 막는 것은 「이번 주 검사에서 걸린 칸」과 「검사 전 새 글 · 고친 글」뿐).
  2. 주간 검사 = 회사 단위 묶음 · **일요일 21시**(일요일 발송 창이 닫힌 뒤) 시작 · 회사 안 = 다음 발송이 이른 칸부터 · 대상 = 켜진 여정의 문자 칸(SMS · LMS · MMS · 변이 판마다) · **카카오 칸은 대상 아님**(템플릿 검수 = 카카오) · 자동마케팅은 회차마다 새 문안이라 회차 검사를 그대로 둔다.
  3. 걸린 칸 = 그 칸만 보류(여정 전체 · 다른 칸 멈춤 0) · 밤새 AI 수정안을 만들어 수정안 검사까지 마쳐 둔다 · 원문은 사람이 누를 때만 바뀐다(고객 문안 불변).
  4. 월요일 09시 = 담당자 문자 한 통(기존 주간 요약 `manager-weekly-digest.ts` 에 「걸린 것 N건」) · 상황판 = 걸린 것 목록 · 원문 / 통과한 수정안 · [이 글로 보내기] [직접 고치기] · 누르는 순간 기다리던 고객에게 나간다.
  5. 새 글 · 고친 글 = 저장 · 켜기 때 그 자리에서 검사(월요일을 기다리지 않는다).
  6. 다 못 끝낸 회사 = 지난 통과본 그대로 발송 · 검사는 이어서.
  7. 우리는 통신사가 아니다 = 주간 검사 · 저장 검사로 최대한 막고, 막힌 결과(발송 결과 코드)가 보이면 같은 상황판에 올린다(100% 차단 약속 문구 0).
- 확인할 것(미검증): 밤 검사 판정 = 낮 발송 판정과 같은가(첫 주 같은 글 낮 · 밤 한 번씩) · 전체 회사 켜진 문자 칸 판 수 ≤ 12시간 검사 용량(줄 하나 · 건당 최대 60초 · 약 720)

## §1 접수 대조표(원문 모양 · 축이 없으면 닫히지 않는 것)

| # | Harold · 직원 원문 요지 | 닫는 축 |
|---|---|---|
| H1 | 「여정 · 자동마케팅을 많이 쓸 고객사 납품 · 결함이 남았는지 · 모든 경우의 수」 | 흐름 표 전체 = D1 ~ D7 + B-1102-1 |
| H2 | 1101 「여정이나 자동마케팅 발송 수량의 상한이 없어야」 | B-1102-1 A(자동마케팅 회사 자율 상한이 승인 기간 · 사람 승인을 덮지 않음) · D4(진입 속도) |
| H3 | 임은지 cmvytc7b70b42jnschh4yawah 「이 문안으로 승인 = 설정 시각(매월 2일 14시) 무시 즉시 발송 · 승인하면 설정 시각에 보낸다는 문구 · 다음 실행 12:00 = 사전 알림으로」 | B-1102-1 B(승인 = 정한 시각 예약) · C(카드 두 줄) |
| H4 | 임은지 cmvyvqvhe0b8kjnsci44e1l28 「2시간 전 승인 대기 + **새로 짠** 추천 문안이 또 옴(승인 안 했든 · 승인해 이미 보냈든) · 기대 = 안 했으면 「승인하지 않으면 발송되지 않습니다」 · 승인했으면 여정 같은 「발송 전 안내(취소 링크)」 · 보냈으면 발송 알림 · 결과」 | D3(같은 회차 두 번) · B-1102-1 D(안내 셋) |
| H5 | 「기초부터 다시 · 핵심 설계를 완벽하게」 | 이 문서 전체 · 결함마다 처방 · 뿌리 · 계약 시험 · 직원 지시문 |
| H6 | 「직원에게 구체적으로 어떻게만 하라는 지시문 · 그대로 해보면 닫혔는지 안다」 | §6(구현 전 · 동작 · 볼 결과만) |
| H7 | 「자잘한 버그는 고쳐 나가 · 전체 기능은 다 돌아가야」 | 우선순위 = 기능이 깨진 것(B-1102-1 · D3 · D6 · D7 · D1 · D2) 먼저 · 같은 설계 · 같은 배포에 D4 · D5 |

빠진 축 = 0.

## §2 공통 원칙(이 설계의 판정 기준)

- **효과 자리에 관문** — 고객에게 나가는 자리(실행기 · 발송 직전)에서 막는다. 저장 · 켜기 관문은 사람에게 일찍 알리는 덧입구다.
- **상태에서 안내** — 담당자 안내는 쓰는 자리마다 붙이지 않고 상태(멈춤 · 대기 · 예약)를 읽는 패스 한 곳이 보낸다 → 새 쓰기 자리가 생겨도 빠지지 않는다.
- **회차 · 진입은 정체가 있다** — 회차 = (운영자 · 회차 시각) · 진입 정보 = 한 함수.
- **같은 사실 = 한 판정** — 결제된 구매 = `netPurchaseSql` · 멈춤 사유 = `pauseReasonView` · 채울 자리 = `hasUneditedJourneyPlaceholder` · 자동마케팅 상한 갈래 = 새 판정 함수 하나.
- 사람이 정한 값(승인 · 발송 시각 · 고객사가 고른 최대 인원 · 예산)을 판정 자리가 다시 판단하지 않는다.

## §3 처방(결함마다 · 바뀌는 자리 · 뿌리 · 계약 시험 · DDL)

### 3-0 컨트롤타워 편입표(★ 1102 밤 Harold 「컨트롤타워가 필요한 부분은 적극 도입 · 그 함수를 쓰는 모든 것이 컨트롤타워를 참조」 · 메모리 「CT 를 만들면 읽기 · 판정 · 한도 · 수명 · 화면까지 전수」)

> 쓰는 곳 = 소스 grep 으로 뽑은 것(1102 밤 · 패턴을 함께 적는다 · 손 목록 금지 · 테스트 파일 제외). 각 줄의 계약 시험 = **그 판정 · 그 칸을 CT 파일 밖에서 직접 쓰면 빨간불**(대상은 시험이 같은 패턴으로 다시 뽑는다 · 허용 목록은 줄마다 이유). 아래 3-1 ~ 3-18 의 처방은 이 CT 를 통해서만 고친다(라우트 · 다른 파일에 같은 판정 인라인 0).

| CT | 파일 · 함수 | 소유하는 판정 | 쓰는 곳(뽑은 패턴 · 지금) | 옮길 것 · 계약 시험 |
|---|---|---|---|---|
| CT-J1 보낼 판 | `journey-pretest-notifier.ts` `stepSendableSql` · `stepHeldSql` · 최신 판 읽기 `latestSnapshotSql` = `journey-step-versions.ts`(★ 구현 = 가져오기 고리 피함 · 판정은 notifier) · 판 쓰기 = `journey-builder.ts` 판 쓰기 함수(`createJourneyStepSnapshots` · `createStepSnapshot`) · `applyPassedCandidate` · `recordIfCurrent` | 최신 판 · 신뢰도 100 · 보류(3-18 · 3-9) | `confidence_score\|stepHeldSql(` = 실행기 5 · 상황판 3 · 빌더 4 · 알림 파일 17 | 실행기 스냅샷 읽기 · 관문 · 선점 · 상황판 = 조각 호출로 · 시험: `confidence_score` 는 위 두 파일의 판 쓰기 · 판정 함수 밖 0 |
| CT-J2 여정 멈춤 | `journey-pause-reason.ts` 새 **SET 조각** `pausedSetSql(params, 종류, 사람 말)` = `status = 'paused', paused_at = NOW(), pause_reason = $n`(종류 머리표 + 사람 말 · 매개변수만 더한다) · `pauseReasonView`(읽기 · 머리표 먼저 · 옛 행 = 지금 규칙) · `MANUAL_PAUSE_REASON`. **쓰기 함수(setter)로 대신하지 않는다**(★ Codex 설계 4R #2): 멈춤 쓰기마다 조건 · 함께 쓰는 칸이 다르다 — 진입 감시 = 시작 설정 세대 비교 `startSameSql`(`journey-trigger-watcher.ts:111`) · 한 번 보내기 되돌리기 = 승인 시각 토큰 · 미발송 조건 + 대기 표식 지우기 + 초안이면 승인 칸 비우기(`journey-anchor-scheduler.ts:482-491` `revertOneShotAttempt`) · 재진입 대량 차단 = 그 트랜잭션 · 계보 멈춤 = 계보 전체 · 잠금 → 각 자리의 UPDATE 문장 · WHERE · 함께 쓰는 칸 · 영향 행 반환은 그대로 두고 SET 의 멈춤 칸만 조각으로 바꾼다 | 멈춤 종류(사람 · 시스템 · 마침) · 안내 대상 · 재개 때 커서 · 기준선 | 쓰기 `pause_reason = \|SET status = 'paused'\|status = \$[0-9]+::text\|pauseJourney(` = 여정 파일 활성화 1 · 날짜 기준 3 + 한 번 보내기 되돌리기 1(`status = $4::text` 꼴 · 4R 이 짚은 빠진 자리) · 실행기 2 + `pauseJourney` 8 · 계보 1 · 멈춤 처리 2 · 재진입 1 · 재개 1 · 진입 감시 1 · `routes/ai.ts` 1 / 읽기 `pauseReasonView(` = 라우트 1 · 빌더 1 · 지도 1 · 상황판 2 | 여정 멈춤 쓰기 전부 = 자기 문장 안에 `pausedSetSql` · 시험: ① 여정 파일에서 `journeys` 를 멈춤으로 만드는 UPDATE(위 패턴 · 상태 매개변수 문장은 그 매개변수가 'paused' 가 될 수 있는 것) = 조각을 포함 · 조각 밖에서 `pause_reason` 을 쓰면 빨간불 ② 자리마다 지금 계약 시험(세대 비교 · 토큰 · 표식 지우기 · 회사 일치)은 그대로 돈다(바뀌는 것 = SET 한 조각) ③ 실 PG: 시작 설정이 바뀐 뒤 옛 판단 멈춤 = 0행 · 새 승인 회차에 옛 되돌리기 = 0행 · 여정 밖(`auto-campaigns` · `dm-ab-test` · `inapp-variant-optimizer` · `auto-campaign-worker`) = 다른 표 · 허용 목록 |
| CT-J3 결제된 구매 | `cdp-order-revenue.ts` `netPurchaseSql` · 새 `cdpEventNameMatchSql(별칭, 매개변수)` | 결제 확정 · 취소 · 환불 아님 · 사건 이름 비교에 구매가 오면 같은 판정 | `event_name = 'purchase'\|event_name IN \('purchase'\|event_name = \$[0-9]` = 19 파일(이미 쓰는 곳 5: automarketing-roi · cdp-order-revenue · cdp-orders · planner-audience · purchase-history-source) · **판정(구매했다 · 구매 금액 · 전환)** = campaign-response-attribution:113 · cdp-active-customers:69(30일 매출 합 · 사건 수는 그대로) · grade-conversion-stats:83 · inapp-segment-matcher:120 · journey-goal-purchase:27 · journey-product 5 · journey-stats 2 · journey-target-extractor 3 · journey-executor 조건 1764 · 기다리기 1367 · marketing-calendar-store:118(월 구매 · 매출) · next-action-advisor 2 · performance-customer-axis 2 · **관측 · 표식(허용 · 이유)** = customer-purchase-aggregates:50(웹훅이 고객 누계를 직접 쓴 표식 `revenue_applied` · `revenue_reversed` 를 보는 보호 장치 · 결제 판정을 씌우면 환불 뒤 보호가 풀려 싱크 재계산이 누계를 덮는다 · ★ Codex 설계 4R 중간 판정 · 코드 확인) · journey-purchase-ledger 105 · 116 · 135 · 162(자사몰 문이 살아 있는가 = 사건이 들어오는가) · cdp-diagnostics:253 · mall-integration-monitor:74(수집 감시) · company-data-profile 281 · 289(구매 데이터가 있는 회사인가) · cdp-orders 212 · 256 · 266(적재 · 표식을 쓰는 쪽 = 원천) · planner-participation 118 · 155(고정 이름 `PLANNER_JOIN_EVENT` · 구매가 올 수 없음) | **판정 자리 전부 = CT** (여정 · 자동마케팅 밖 통계 · 인앱 · 캘린더 · 추천 포함 · 화면 숫자가 취소분만큼 줄어든다 = 맞는 값) · 관측 = 허용 목록(이유 = 「들어온 사건 수」를 세는 자리) · 시험: 위 패턴이 CT · 허용 목록 밖 0 · `'order'` 이름(저장되지 않는 옛 이름 · `journey-stats.ts:250` 주석)은 CT 가 받지 않는다 |
| CT-J4 한 사람 | `journey-entry-ledger.ts` 새 `onePersonSql`(대상 갈래 = 번호 한 행) · `samePhoneActiveSql`(사건 · 상태 넣기) · 날짜 기준 · 한 번 보내기 = 잠금 안 「이미 뽑았나」 재확인 함수 `anchorStepDispatched`(있음 · 잠금 안에서 부르게) | 한 사람 = 번호(3-17) | `DISTINCT ON \((c\.)?phone\|normalizePhone\(` = 대상 추출 4 · 원장 3 · 실행기 3(피로도 · 번호 유효 = 판정 아님) / 넣기 `INSERT INTO journey_executions` = 진입 감시 2 · 재진입 1 · 날짜 기준 2 | 대상 SQL 갈래 · 넣기 전부 = CT 조각 · 시험: 넣기 문장마다 조각 하나 · 대상 갈래마다 `onePersonSql` |
| CT-J5 알림톡 칸 | 새 `journey-kakao-step.ts` `kakaoStepBlockReason`(템플릿 코드 · 존재 · 승인 · 카카오 활성 · 변수 연결 = 템플릿 본문 기준 · 3-14 · D21) | 알림톡 칸을 보낼 수 있는가 | `alimtalk_template_code\|kakao_templates\|decideKakaoTemplateSendable` = 실행기 10 · 빌더 8 · 검증 1 · 계보 2(판 복제 = 값 옮김 · 판정 아님) | 켜기 · 켜기 검증 · 실행기 = CT · 시험: 여정 파일에서 `kakao_templates` 조회 · 변수 연결 판정 = CT 밖 0(계보 복제 = 허용) |
| CT-J6 신규 가입 | 새 `customer-joined-at.ts`: 쓰기 `joinedAtFor(들어오는 길 · 처음 보는 번호 · 원천 가입일 · 지금)` · upsert 조각 `joinedAtUpsertSql`(이른 값) / 읽기 `newSignupSql(별칭, 기준 시각 매개변수)` · `hasJoinedAtEvidence(회사)` | 가입 근거 · 신규 가입 · 가입일 있는 회사인가(3-6 · D19 · D20) | 쓰기 `INSERT INTO customers` = `customer-upsert.ts:204`(부르는 곳 = `routes/customers.ts` · `sync.ts` · `upload.ts`) · `cdp-identity.ts:299`(몰) / 신규를 `created_at` 으로 세는 곳 = 여정 대상 추정 `journey-target-extractor.ts:119` · 자동마케팅 축 `automarketing-segment.ts:328` · **여정 추천 「지난 7일 신규」 `journey-opportunities.ts:139`**(새로 찾음 · 같은 뿌리) | 고객 행 쓰기 둘 = CT 조각 · 신규 판정 셋 + 신규 가입 여정 대상 + 켜기 근거 판정 = CT · 시험: `INSERT INTO customers` 마다 `joinedAtUpsertSql` · 여정 · 자동마케팅 · 추천 파일에서 `created_at` 으로 신규를 가르는 식 0 |
| CT-J7 보낼 시각 | `send-time-util.ts`(있음) + 칸 채널 인자 · `BUSINESS_DAY_HOUR` · 다시 켤 때 시각 `resumeRunAt` | 밤 밀기(문자만) · 하루 묶음 · 다음 평일 · 다시 켤 때 · 문구 시각(3-10 · 3-12) | `shiftToSendableHour(\|calculateNextRunAt(\|firstRunAtFor(\|dailyFirstRunAt(\|NIGHT_ARRIVE_HOUR\|sendWindowState(` = 실행기 6 · 자동마케팅 5 · 진입 감시 2 · 날짜 기준 2 · 재진입 1 · 정책 1 · 라우트 2 / CT 밖 시각 계산 = **다시 켜기 `RESUME_SHIFT_SQL`(`journey-resume.ts:45-50` · SQL 날짜 산술)** / 문구 숫자 = `journey-trigger-capability.ts:316` · `journey-graph.ts:87` · 다음 단계 추천 지시문 「09~20시」(`journey-step-diagnosis.ts` 322 부근) | 다시 켜기 시각 · 문구 · AI 지시문 = CT 상수 · 함수 · 시험: 여정 · 자동마케팅 파일에서 시 숫자로 시각을 만드는 식(`Date.UTC(…, 숫자 - 9` · `getUTCHours() [<>]= 숫자`) · 「N시」 문구 리터럴 = CT 밖 0 |
| CT-J8 광고 판정 | `journey-ad-policy.ts` `resolveJourneyAdFlag`(있음 · 코드 쪽) + 새 `journeyStepIsAdSql(별칭)`(SQL 쪽 · 같은 규칙) | 칸이 광고인가(알림톡 = 늘 아님 · 3-11) | `\.is_ad\|is_ad !==\|is_ad ===` = 여정 파일 12(빌더 4 · 알림 3 · 검증 2 · 점검 2 · AI 생성 · 편집 · 지도 · 그래프 · 스캔 · 렌더) | 읽기 전부 = CT · 시험: 여정 파일 `is_ad` 직접 판정 = CT 밖 0(저장 기본값 쓰기 = 빌더 한 곳) |
| CT-J9 클릭 | 새 `journey-click.ts` `journeyClickSql(여정 · 칸)` | 그 여정 · 그 칸 링크 클릭(3-15) | `message_click` = 실행기 4(조건 2 · 목표 1 · **개인화 발송 시각 1 = `journey-executor.ts:1554` · 그 고객의 90일 클릭 · 조회 · 구매 시간대 = 활동 관측 · 여정 · 칸으로 좁히면 다른 캠페인 클릭으로 얻던 시각이 사라진다 · ★ Codex 설계 4R #3**) · 통계 5 · 빌더 1 | 조건 · 목표 · 통계 = CT · 시험: 여정 파일 `message_click` = CT · 허용 목록 밖 0 · 허용 = 개인화 시각(1554 · 이유 = 활동 관측) · 빌더 1(그 자리 확인 뒤 판정이면 CT · 이름 목록이면 허용) |
| CT-J10 보낼 글 | `send-placeholder-gate.ts`(있음) + `messageUtils.ts` 새 `unknownVarTokens`(치환과 같은 쪼개기 · 같은 매핑) + 장바구니 변수 판정 | 채울 자리 · 없는 변수 · 장바구니 변수(3-3 · 3-13) | 지금 CT 소비처(켜기 · 켜기 검증 · 보내기 전 검사 · 자동마케팅 출구) + 새 = 실행기 · 칸 저장 · 주간 검사 · 화면 저장 검사(서버 판정 문장) | 시험: 여정 · 자동마케팅 파일에서 자리표시 정규식 · `%…%` 쪼개기 = CT 밖 0 |
| CT-O1 자동마케팅 회차 | 새 `operator-round.ts` `roundKeyOf` · `withRoundLock` · `replaceRoundCas`(본 id 조건 · 수 비교) | 회차 정체 · 동시 생성 · 교체(3-1) | `INSERT INTO operator_proposals` = `continuous-operator.ts:1571`(회차) · 4423(리마인드 = 회차 아님 · 허용) / 다음 생성 시각 `updateOperatorAfterRun` · 승인 정한 시각(3-2 B) | 시험: 비리마인드 INSERT = `withRoundLock` 안 · 회차 키 = `roundKeyOf` 밖에서 만들지 않음 |
| CT-O2 자동마케팅 상한 | `autosend-policy.ts` 새 `operatorCapPolicy` | 갈래별 상한 · 예산(3-2 A) | `cdp_auto_execute_max_` = `continuous-operator.ts` 15 · `automarketing-preview.ts` 2 · `routes/admin.ts` 4(슈퍼관리자 설정 쓰기 · 허용) | 시험: 상한 칸 읽기 = CT · 설정 화면 밖 0 |
| CT-J11 기준선 | `journey-entry-ledger.ts` 새 `reseedOnActivate(run, 여정, 앞 상태 · 멈춘 종류)` | 기준선을 심는가 · 기준 시각을 옮기는가(3-5 ② · 3-6) | `seedBaselineForJourney(\|seedGradeStateForJourney(` = 켜기 2 · 떼기 2 | 켜기 · 떼기 = CT 한 함수 · 시험: 두 심기 함수 직접 호출 = CT 밖 0 |
| CT-J12 수정안 · 주간 일 | `journey-pretest-candidate.ts` `applyPassedCandidate` · `weeklyStepDoneSql` | 수정안 반영 · 주간 검사 끝난 칸(3-9) | 새(상황판 [이 글로 보내기] · 주간 워커 · 보내기 전 검사) | 시험: 칸 본문을 후보 글로 바꾸는 쓰기 = CT 밖 0 · `newBody` 0 |
| (있음 · 그대로) | 담당자 연락처 `pickOwnerContact` · 한 번 안내 `sendNoticeOnce` · 스팸 판정 `spamVerdictOf` · 이어 보기 `spamCheckFor` · 자리표시 `findUneditedSendPlaceholder` | — | 새 안내 패스(3-5 ①) · 주간 검사 · 상황판이 이것만 부른다 | 시험 = 지금 계약 그대로 + 새 소비처 편입 |

- **3-0 줄 단위 대조(1102 밤 · 4R 뒤 주재자가 쓰는 곳을 한 줄씩 열어 다시 분류 · 판정 = CT · 관측 · 값 옮김 = 허용 · 이유)**
  - CT-J1: 판 쓰기 = `journey-builder.ts:1258`(켜기 판 · 100) · 1740(고친 판 · 0) / 판정 읽기 = 실행기 553 · 561 · 683 · 1059 · **상황판 `manager-board.ts:121-142`(칸 검사 상태 표시 = 판정 → CT 조각으로)** / 알림 파일 17 = 소유.
  - CT-J2: `journeys` 멈춤 쓰기 = `journey-activation.ts:154` · 날짜 기준 198(D-0 마침) · 237(상한) · 343(한 번 보내기 상한) · 486(되돌리기 · 상태 매개변수) · 빌더 `pauseJourney` 2045(← `routes/ai.ts:4387` 사람 멈춤) · 실행기 지역 `pauseJourney` 1886(← 981 · 1088 · 1125 · 1255 · 1302 · 1872(D2 관문 · 지움) · 1946) · 계보 355 · `journey-pause-handler.ts:327`(내보내기 · 가져다 쓰는 곳 0) · 재진입 173 · 진입 감시 110 / 허용 = 빌더 1120(다시 켤 때 비움) · `journey-resume.ts:32` · 36(멈춤 기록 표 `journey_pause_logs` · 다른 칸) · `journey-pause-handler.ts:357`(실행 행 멈춤 · 다른 표).
  - CT-J3: 위 표 줄(줄 번호 · 판정 / 관측 이유 · 4R 중단분 반영).
  - CT-J4: 번호 한 행 = 대상 추출 139(가입) · 341(등급)뿐 → 나머지 갈래에 더한다 / 허용 = 원장 103 · 130 · 162(기준선 · 등급 기준선 쓰기 · 번호 단위 그대로) · 실행기 817(피로도) · 909(번호 유효) · 915(보낼 번호) · 대상 추출 1013(매장 번호 표시).
  - CT-J5: 판정 = 실행기 762-781 · 켜기 검증 80 · 140-149(변수 연결) · 켜기 관문(새 호출) / 허용 = 빌더 1237-1271 · 1730-1746(판 쓰기 = 값 옮김) · 1425 · 1660(칸 쓰기) · 실행기 1152(대체 문자 적재 = 보내는 값) · 계보 316 · 321(판 복제).
  - CT-J8: 판정 읽기 = 점검 140 · 그래프 179 · 알림 521 · 스캔 93 · 검증 156 · 실행기 858(렌더가 CT 를 부른다 = 이미 CT) · AI 편집 107 · 273 · AI 생성 780 · 787(이미 CT) · **지도 `journey-lifecycle-map.ts:264` · 268(`MARKETING_JOURNEY_SQL` = SQL 안에서 저장값 `is_ad` 로 정보 여정을 가른다 · 알림톡 = 늘 정보성이 되면 저장값과 갈린다 → SQL 조각 `journeyStepIsAdSql(별칭)` = 알림톡이 아니고 is_ad 가 false 아님 · 새로 찾음)** / 허용 = 빌더 1236 · 1269 · 1729 · 1745(판 쓰기 = 값 옮김) · 알림 188 · 509(문자 칸만 고르는 SELECT 칸).
  - CT-J9: 판정 = 실행기 1680(목표) · 1784(옛 클릭 조건) · 1819(링크 클릭 조건) · 통계 242 · 344 · 407(시간대) · 449(요일 · 모두 여정 · 칸 id 로 이미 좁힘 → CT 조각으로) / 허용 = 실행기 1554(개인화 시각 · 활동 관측) · 빌더 595(AI 지시문의 사건 이름 예시 글).
- 프론트 사본: 여정 화면이 서버 판정을 그대로 그리는가 = 멈춘 이유(`JourneysPage.tsx:113-114` 「원문 pause_reason 은 그리지 않는다」 · `useJourneyActions.tsx` 는 `pause.kind`) · 밤 시각(`/api/send-policy` 의 `nightArriveHour`) · 「다음 평일 09시」 문구(`JourneysPage.tsx:449` · 2014 · 2063 = CT-J7 의 `BUSINESS_DAY_HOUR` 를 같은 정책 응답으로 받는다) · 저장 검사(`JourneyWorkspace.tsx:571` = 서버 판정 문장). 화면이 판정을 따로 하는 자리 = 0 으로 만든다.
- `JourneyPauseLogsModal.tsx` 의 `pause_reason` 은 멈춤 기록 표(`journey_pause_logs`)의 코드(admin_manual 등)라 CT-J2 와 다른 칸 — 그대로.

### 3-1 D3 같은 발송 시각의 자동마케팅 회차가 두 번 만들어짐(납품 전)

- **회차 키** = (운영자 · 회차 시각). 회차 시각 = 일정의 그 회차(`computeNextOccurrence` · 고정 시각 = 발송 희망 시각 T · AI 최적 시각 = 그 회차의 일정 시각) — 제안 `proposal_json.meta.roundKey`(ISO)에 저장(새 칸 0 · DDL 0). 옛 제안 = `proposal_json.target.anchorAt` 를 키로 읽는다(고정 시각 · 1444 에서 늘 저장).
- ① 다음 생성 시각: 회차를 만든 뒤(`continuous-operator.ts:1893`) `updateOperatorAfterRun` 에 회차 시각을 넘겨 **그 회차 다음 회차**의 (발송 − 준비 시간)으로 잰다(`computeNextGenerationRun` 기준 시각 = max(지금, T + 1분)). 회차를 못 만든 갈래(1252 ~ 1610 · 13곳)는 지금 그대로(다시 시도 = 맞음).
- ② 생성 관문(입구 셋 공통 = `generateProposalForOperatorRound` 안 · AI 를 부르기 전): 같은 회차 키의 비리마인드 제안이
  - 예약 · 보내는 중 · 보냄 · 승인 · 자동 실행 · 거부 · 멈춤 · 생략 = 있으면 **만들지 않고 끝**(+ ① 다음 회차로 넘김) — 같은 고객 두 번 발송 0.
  - 대기 · 검토 = 워커는 만들지 않는다(이미 담당자에게 간 회차 · 검토 회차를 새 회차가 만료시키는 1620 길 0) · **지금 실행(사람이 누름)** = 지금처럼 옛 것을 만료하고 새로 만든다(문안 다시 받기).
- ③ 동시 생성(★ Codex 설계 1R #3 · `NOT EXISTS` 한 문장은 READ COMMITTED 에서 동시 생성을 막지 못한다 · 지금 유일 제약은 scheduled 만 · `continuous-operator.ts:1579` 주석이 이 경쟁을 적고 있다): 생성 입구 셋(워커 · 지금 실행 · 첫 회차)이 같은 함수 안에서 **(운영자 · 회차 키) 트랜잭션 잠금**(`pg_advisory_xact_lock(hashtext('operator-round'), hashtext(운영자 id || 회차 키))`)을 잡고, 그 잠금 안에서 ② 재확인 → (지금 실행이면) 옛 대기 회차 만료(1619-1623) → INSERT 를 한 트랜잭션으로 한다. AI 호출은 잠금 밖(잠금 = 확인 · 교체 · 넣기만) · AI 를 부르기 전 잠금 없는 ② 확인은 빠른 길로 남긴다(잠금 안에서 다시 본다 = spam-test-queue 이어 보기와 같은 꼴).
  - **교체 = 읽은 상태를 조건으로(★ Codex 설계 2R #2 · LESSONS_BACKEND 「읽은 값을 조건에 넣지 않고 쓰면 워커와 사용자가 서로를 덮는다」)**: 승인(`approveProposal` 2115-2127 · `WHERE status IN ('pending','admin_review')` 선점)은 회차 잠금을 잡지 않는다. 그래서 잠금 안 재확인에서 본 대기 · 검토 제안 id 묶음을 그대로 만료 문장 조건에 넣고(`WHERE id = ANY($본 id) AND status IN ('pending','admin_review') RETURNING id`) **돌아온 행 수 = 본 수일 때만** 새 회차를 넣는다. 적으면(그사이 사람이 승인해 sending · scheduled) 롤백 · 새 회차 0 · 「그사이 이 회차를 승인하셨어요」. 승인이 만료 뒤에 오면 승인 선점이 0행(만료됨 · 지금 문장 그대로). 행 잠금이 둘을 줄 세우므로 같은 회차 승인본 + 새 대기본이 함께 남는 갈래 0.
  - 만료 문장의 자리 = INSERT **앞**(지금은 INSERT 뒤 1619-1623 · 「방금 만든 것 제외」 조건은 필요 없어진다).
  - 승인(3-2 B)은 회차를 새로 만들지 않아 회차 잠금 밖 · 위 행 잠금 + 조건으로 엇갈림이 닫힌다.
- 뿌리 = **R46 새**(「회차를 정체 없이 만든다 — 같은 회차가 입구마다 따로 생긴다」).
- 계약 시험: (a) 소스의 비리마인드 `INSERT INTO operator_proposals` 전수(기계 추출) = 회차 키를 쓰고 같은 트랜잭션에서 회차 잠금을 먼저 잡는다(같은 함수 안 · 잠금 문장이 INSERT 앞) (b) 회차를 만든 뒤 부르는 `updateOperatorAfterRun` = 회차 시각 인자 필수(타입) (c) 실 PG: 등록 10:57 · T 14:00 · 준비 120분 → 12:00 워커 = 회차 0 · 다음 생성 = 다음 회차 / 1회차 승인 · 보냄 뒤 워커 = 회차 0 / 대기 회차 + 지금 실행 = 새 회차 1 · 옛 것 만료 (d) 실 PG 두 연결 경합: 워커 ↔ 지금 실행 · 워커 ↔ 첫 회차 · 지금 실행 ↔ 지금 실행 · **지금 실행 ↔ 승인**(재확인 뒤 · 만료 전에 승인 커밋 / 만료 뒤 승인) = 같은 회차 키 비리마인드 제안 중 보낼 수 있는 것(대기 · 검토 · 예약 · 보내는 중)이 끝에 하나 · 승인한 회차를 경합이 만료시키지 않음 (e) 소스 계약: 회차 잠금 안 만료 문장 = 본 id 조건 + 돌아온 수 비교 뒤에만 INSERT.

### 3-2 B-1102-1 자동마케팅 승인 기간 · 회차 승인 시각 · 표기 · 안내(납품 전)

처방 원장 = `docs/FEATURE-AUTOMARKETING.md` §12 8번 A ~ F 를 그대로 가져오고, 둘째 접수(H4)의 안내를 더한다.

- **A 상한 갈래 = 판정 함수 하나**(`autosend-policy.ts` · 이름 예 `operatorCapPolicy`): 회사 자율 회차 = 회사 상한(`cdp_auto_execute_max_*`) + 예산 / 승인 기간 회차 = 예산만 / 사람이 그 회차를 승인 = 상한 · 예산 보지 않음 / 리마인드 = 1차가 따른 갈래. 위험도 · 준법 · 발신번호 · 080 · 스팸 관문은 그대로. 부르는 자리 = 회차 자격(1547-1555) · **예약 발송 앞 예산 관문(`sendScheduledProposal` 3271-3309 · ★ Codex 설계 1R #6 · 사람이 승인해 예약된 회차가 여기서 예산으로 검토로 내려가 정한 시각에 안 나가던 자리)** · 발송 직전(3628-3710) 셋 다 이 함수만. 갈래 근거(사람 승인 · 승인 기간 · 회사 자율 · 리마인드)는 제안 행에서 읽는다(사람 승인 = `reviewed_at` · 승인 기간 = 생성 때 `proposal_json.meta.capPath` · 리마인드 = 1차 제안의 갈래) · 새 칸 0.
- **B 회차 승인 = 정한 시각**: `approveProposal`(2075) — 회차 시각 T 가 아직이면 T 에 예약(야간 승인과 같은 예약 문장 · 운영자당 예약 1건 계약 그대로) · 지났으면 확인 창이 「정한 시각(○일 ○시)이 지났어요. 지금 보낼까요?」를 묻고 지금 보낸다(지금 경고 모드 · `ContinuousOperatorPage.tsx:526-543`) · 서버 응답 문구(`routes/ai.ts:2585`) · 확인 창 문구 「승인하면 ○일 ○시에 보내요. 보내기 2시간 전에 안내 문자를 드려요」.
- **C 표기**: 카드 「다음 발송 ○월 ○일 오후 ○시」 + 「제안 준비 ○시」 두 줄(`OperatorsManageList.tsx:64`) · 목록 응답에 다음 발송 시각(고정 = 다음 생성 + 준비 시간 · AI 최적 = 「AI 최적 시각」).
- **D 안내 셋(H4 기대 그대로 · 상태에서 보내는 패스 하나 · 발송 패스 1분 주기 안)**:
  - 예약된 회차(자동 · 사람 승인 모두) = 발송 시각 − 준비 시간(기본 2시간)에 「발송 예정 안내(정지 링크)」 1통 — 지금 자동 예약 회차만 보내는 `sendAutoSendPrepNotice`(1841)를 이 패스로 옮긴다(안내 원장 = 제안 `admin_notified_at` 그대로 · 못 보내면 그 회차 검토 = 4700 규칙 그대로).
  - 승인 대기 회차 = 같은 시각에 「승인하지 않으면 ○시 회차는 보내지 않아요」 1통(원장 = `proposal_json.meta.unapprovedNoticeAt` · 새 칸 0).
  - 보낸 회차 = 지금 「발송 시작」(3887) + 캠페인 결과 그대로.
- **E 재발 방지** = R44(「사람이 정한 승인 · 발송 시각을 판정 자리가 다시 판단한다」) + 계약 시험 셋(§12 8번 E ⑨: `cdp_auto_execute_max_*` 읽는 자리 = 판정 함수 밖이면 빨간불 · 승인 처리가 시각 판정 없이 발송하면 빨간불 · 발송 경로의 「대상 수 > 숫자」 = 이유 붙은 허용 목록 밖이면 빨간불) + 엔진 설계서 §17 덮음표에 판정 자리.
- **F 실 PG 시험**(§12 8번 F 다섯) + D 안내 셋(예약 · 대기 · 보냄 각 1통 · 두 번 0).
- 범위 밖 기록 = §12 8번 D(DM 다시 보내기 id 1만 = DM 기능 · 다음 결함 대처에서).

### 3-3 D6 켜진 여정에서 고친 글의 채울 자리(납품 전)

- ① **발송 관문(효과 자리)** — 실행기 문자 묶음(`journey-executor.ts` `processMessageBatch` · 스냅샷 문안 확정 뒤 · 관문 680 앞)에서 그 칸 문안 · 제목(변이 포함 = `stepSendVersions`)에 `hasUneditedJourneyPlaceholder` 가 참이면 **그 칸 보류**(보내기 전 검사의 보류 기록과 같은 문장 · `holdCurrent` 꼴 · 담당자 「보류」 안내 원장 그대로 · 여정 멈춤 0) → `stepHeldSql` 이 지금처럼 60분마다 다시 본다.
- ② 보내기 전 검사(`journey-pretest-notifier.ts` `processBundle` 280): 유료 스팸 검사 전에 같은 판정 → 참이면 그 판 보류 + 안내(검사 0원).
- ③ 저장 관문(덧입구): 켜진 여정 칸 고치기(`applyStepPatchInLock`)에서 고친 문안 · 제목에 채울 자리가 있으면 409 「채울 자리(…)가 남아 있어요. 내용을 적거나 그 줄을 지운 뒤 저장해 주세요」(초안 · 멈춘 여정은 지금처럼 켜기 관문이 본다) · 화면 저장 검사(`JourneyWorkspace.tsx:571` `validateCopy`)도 같은 판정(서버 판정 값을 화면 유틸로 · 판정 한 벌 = 서버 응답 문장 그대로 보임).
- 뿌리 = **R47 새**(「판정이 켜기에만 있고 효과 자리에 없다」 · 메모리 「게이트 = 효과가 생기는 함수 안」).
- 계약 시험: (a) 실행기 문자 묶음 함수 = 채울 자리 판정 호출(소스 계약) (b) 켜진 여정 칸 문안을 쓰는 자리 전수(B 칸 기계 추출) = 판정을 지나거나 이유 붙은 허용 목록(초안 · 새 판 복제) (c) 실 PG: 켜진 여정 칸에 「[혜택 안내: 직접 수정해주세요]」 → 저장 409 · 기록에 직접 넣은 판 = 실행기 보류 · 발송 0 · 안내 1.
- 배포 앞 확인 SQL(Harold): 지금 켜진 여정의 최신 스냅샷에 채울 자리가 남은 칸 수(이미 나간 · 나갈 위험).

### 3-4 D7 취소 · 환불된 주문이 구매 여정에 들어감(납품 전)

- ① 진입: 사건 커서(`journey-target-extractor.ts` `selectCdpEventRowsForCursor` 756-765)에서 구매 계열 시작 사건(`cdp.purchase` · `purchase.first` · `purchase.product` · `customer.dormant_return`)이면 `AND ${netPurchaseSql('e')}`(결제 확정 · 취소 · 환불 아님 · `cdp-order-revenue.ts:74-80`). 배송 · 예약 사건은 그대로.
- ② 진입 뒤 취소: 실행기 묶음 판정(목표 판정 옆 · 문자 · 대기 · 조건 칸 공통)에서 구매 계열 여정의 실행 중 진입 사건(`entry_event_properties.__entry.key` = cdp 사건 id)이 지금 취소 · 환불이면 그 실행 끝(ended · 로그 skipped `order_cancelled` · 발송 0).
- ③ 목표 판정(`journey-goal-purchase.ts:25-27`)의 cdp 갈래 = `netPurchaseSql`(취소된 구매는 목표 달성이 아니다).
- ④ 구매를 읽는 나머지 자리 전부(장부 D7 넓힘 · ★ Codex 설계 1R #5 · 시작 사건이 구매가 아닌 여정에도 닿는다): 조건 칸 `cdp_event_exists`(`journey-executor.ts:1757-1769` · 사건 이름이 매개변수로 들어온다) · 기다리기 칸의 사건(1363-1368) · `purchase_since_entry` · 첫 구매 · 휴면 복귀의 이전 구매(`selectLastPriorPurchase` `journey-target-extractor.ts:860-889`) · 구매 주기 이력(291-317) · 상품 구매자(620-628). 사건 이름을 비교하는 자리는 문자 그대로든 매개변수든 한 조각(`cdpEventNameMatchSql(별칭, 매개변수)` = 이름이 같고 그 이름이 구매면 `netPurchaseSql` · `cdp-order-revenue.ts` 옆)을 쓴다.
- 매장 구매(싱크 원장 `purchases`) = 취소 칸이 데이터에 없다(SCHEMA 1332-1353) → 범위 밖 기록(싱크가 취소를 싣게 되면 같은 판정 자리에 더한다).
- 뿌리 = R1 넓힘(결제된 구매 = `netPurchaseSql` 한 곳).
- 계약 시험: 여정 · 자동마케팅 파일에서 `cdp_events` 를 사건 이름으로 거르는 SQL 전수(기계 추출 · `event_name = '…'` 문자 · `event_name = $n` 매개변수 둘 다) = `netPurchaseSql` 이나 `cdpEventNameMatchSql` 을 지나거나 이유 붙은 허용 목록(구매가 올 수 없는 고정 이름 · 클릭 등) · 실 PG: 결제 → 취소 순 사건 = 진입 0 / 진입 뒤 취소 = 다음 칸 발송 0 · ended / 가입으로 시작한 여정의 「구매했으면」 조건 + 취소한 구매 = 「안 샀으면」 갈래.

### 3-5 D1 시스템 멈춤 안내 · 다시 켤 때 빠짐(납품 전)

- ① 안내 = 상태에서 패스 하나(`notifyPausedJourneys` · 보내기 전 검사 스캔과 같은 5분 · 새 파일 또는 `journey-pause-reason.ts` 옆): 멈춘 여정 중 `pauseReasonView(pause_reason).kind` 가 사람 멈춤(manual)이 아니고 그 멈춤(`paused_at`)에 안내한 적 없는 것 → 담당자(`pickOwnerContact`) 1통 「'여정 이름' 여정이 멈췄어요. 이유: (사람 말) · 할 일: (fix 라벨) · 상황판 링크」 · 원장 = `journeys.pause_notice_for`(안내한 `paused_at`) + 시도 수 · `sendNoticeOnce` 꼴(잡기 → 적재 → 성공 기록 · 3번 · 다 실패 = 운영 경보 한 통).
- 사람 멈춤 사유 = 서버 상수 하나(`MANUAL_PAUSE_REASON` · `journey-pause-reason.ts`): 멈추기 경로(`routes/ai.ts:4386` 은 지금 화면이 보낸 `req.body.reason` 을 그대로 씀 → 사유 글자가 화면 손에 있다)는 본문 사유를 버리고 이 상수를 쓴다 · 안내 문자 링크 멈춤(`journey-pause-handler.ts:302`)도 같은 상수 → 「사람 멈춤인가」 = 글자 맞추기가 아니라 상수 비교.
- 날짜 기준 정상 마침(`journey-anchor-scheduler.ts:198` 「지정일 D-0 발송 완료」) = `pauseReasonView` 에 「마침(completed)」 종류를 더해 안내 0 · 화면 문구 「정한 날 보내기를 마쳤어요」.
- ② 다시 켤 때: 시스템 멈춤(manual 아님)에서 다시 켜면 사건 커서를 재개 시각으로 옮기지 않는다(`journey-resume.ts:65-71` 를 사람 멈춤에만) · **기준선도 다시 심지 않는다**(★ Codex 설계 1R #4 · 지금 켜기는 매번 `seedBaselineForJourney`(신규 가입 · 회사 전 번호 원장 보충) · `seedGradeStateForJourney`(등급 · 값 재기준)를 부른다 `journey-builder.ts:1053-1067` → 시스템 멈춤 동안 가입한 고객 · 오른 등급이 다시 켜는 순간 「전에 본 것」이 되어 영영 빠진다) → 기준선 = 처음 켤 때(`entry_baseline_at IS NULL`) · 사람 멈춤에서 다시 켤 때 · 초안에서 켤 때만 · 시스템 멈춤에서 다시 켤 때는 둘 다 건너뜀(판정 = 멈춘 이유 종류 `pauseReasonView` 한 곳 · 읽는 자리 = 켜기 함수가 상태를 바꾸기 **전에** 잠근 행의 `pause_reason`)
  - **신규 가입 기준 시각도 같이**(★ Codex 설계 2R #4 · 원장 보충은 그때 있는 고객 행만 막는다 → 사람이 멈춘 동안 가입했는데 다시 켠 뒤에 늦게 적재된 고객은 원장에 없고 가입 시각은 기준선 뒤 · 72시간 안이라 들어왔다): 기준선을 심는 때(처음 · 사람 멈춤 재개 · 초안 켜기 · 떼기) = `entry_baseline_at` 을 **지금으로**(옛: NULL 일 때만 · `journey-entry-ledger.ts:59` · 114) · 시스템 멈춤 재개 = 그대로. 신규 판정(3-6)이 `joined_at ≥ entry_baseline_at` 을 보므로 사람 멈춤 동안의 가입은 늦게 적재돼도 0 · 시스템 멈춤 동안의 가입은 들어온다. `entry_baseline_at` 을 읽는 자리 = 기준선 유무(`hasBaseline` `journey-entry-ledger.ts:178`) · 켜기(`journey-builder.ts:1055`) · 판 새로 만들기 비움(`journey-lineage.ts:232`) 셋뿐 · 값을 옮겨도 「있음」은 그대로(grep 1102 밤). → 멈춘 동안 도착한 사건 중 도착 72시간 안(`PURCHASE_TRIGGER_MAX_AGE_HOURS` · 지금 규칙)이 들어온다 · 다시 켜기 창(`useJourneyActions.tsx:110-113` · 멈춘 이유 `pause.kind` 를 이미 받는다)에 「멈춘 동안 들어온 고객도 받아요(72시간 안)」 한 줄(사람 멈춤 = 「멈춘 동안 생긴 일은 받지 않아요」 지금 문구 · `resumeLine`).
- 뿌리 = **R45 새**(「시스템이 사람의 일을 멈췄는데 사람에게 안 닿는다」 · R14 의 담당자 판).
- 계약 시험: (a) 소스의 여정 멈춤 쓰기 전수(A 칸 기계 추출)가 남기는 사유 글자(리터럴 · 템플릿 머리) = `pauseReasonView` 에서 manual · unknown 이 아닌 종류(`MANUAL_PAUSE_REASON` 을 쓰는 자리 2 만 manual · 그 밖 자리가 manual 로 읽히면 빨간불 · 멈추기 경로가 `req.body.reason` 을 사유로 쓰면 빨간불) (b) 실 PG: 시스템 멈춤 = 안내 1 · 다시 멈춤(새 paused_at) = 1 더 · 사람 멈춤 = 0 · 재개 = 시스템 멈춤만 커서 유지.
- DDL = §5 DDL-1.

### 3-6 D2 · D19 신규 가입 판정 = 가입 근거 · 하루 묶음 이상치 관문 없앰(C96 배포 전 · ★ 1102 밤 Harold 「그렇게 고침」)

> Harold 원문 요지: 「그것 때문에 더 큰 걸 막아 버린다고? · 왜 안 되는지 설명하고 문제 있는 여정을 정지하고 다시 시도하라고 하는 게 맞지 않나 · 싱크로 새로 추가되는 데이터를 무조건 신규 가입이라고 판단하기보다 다른 방법으로 · 자사몰에서 새로 가입을 하거나 등등」.

- **관문 없앰(D2)**: `dailyVolumeGate` · 호출 자리(`journey-executor.ts:721-728`) · 상수 둘(1839-1840)을 지운다. 양으로 판정 오류를 뒤늦게 잡는 장치라 작은 여정을 통째로 멈췄다. 막으려던 사고(처음 보는 옛 고객이 한꺼번에 신규로 잡힘)는 아래 판정이 들어오는 자리에서 막는다.
- **사실(1102 밤 확인)**: 같은 고객을 지웠다 다시 올리는 것은 지금도 신규로 잡히지 않는다. 켤 때 회사 전 번호를 원장에 적고(`journey-entry-ledger.ts:14-28`) 신규 = 원장에 그 번호가 없을 때(`journey-entry-ledger.ts:4-11` · 번호만 비교). 그래서 삭제 · 다시 올리기를 막을 까닭은 없다. 위험은 **처음 보는 번호**가 대량으로 들어오는 순간이다.
- **가입 근거 칸(DDL-2)**: `customers.joined_at timestamptz NULL` = 「이 고객이 실제로 가입한 때」. 고객 행을 만드는 자리마다 근거가 있을 때만 쓴다.

| 들어오는 길 | `joined_at` | 근거 |
|---|---|---|
| 자사몰 회원 가입 사건(카페24 `customer.created`) | 몰이 준 가입 시각 | `cafe24-client.ts:719-741`(지금은 `custom_fields.cafe24_join_date` 에만 넣는다) · 다른 몰 = 몰마다 확인(미검증) |
| 자사몰 주문 · 백필로 생긴 고객 | NULL(가입 사실 아님) | 주문자 = 회원 가입이 아니다 |
| 싱크 `mode = 'full'` | NULL(기존 고객) | `routes/sync.ts:606-611` · 모드 빈 값 = full |
| 싱크 `mode = 'incremental'` 에서 처음 보는 번호 | 원천 가입일 칸이 있으면 그 값 · 없으면 받은 시각 | 표준 필드에 「가입일」(join_date) 추가(`standard-field-map.ts` · 지금 없음) · 「처음 보는 번호」 = 그 회사 고객 **어느 행에도 없는 번호**(고객 유일 키가 매장별이라 다른 매장에 있는 단골이 새 매장 행으로 들어와도 신규가 아니다) |
| 엑셀 올리기 | 기본 NULL · 아래 한 번 묻기에서 [신규로 올리기]를 고르면 올린 시각 | `routes/upload.ts` · 묻는 자리 = 칸 맞추기 확인(`/validate-mapping` 335 · 저장 전 단계) 응답에 새 번호 수 · 켜진 신규 가입 여정 이름 → 저장(`/save` 400)이 고른 값을 받는다(저장 뒤 묻지 않는다) |
| 화면에서 고객 한 명 추가 | 추가한 시각 | 사람이 새 고객을 적었다 |

- **이미 있는 고객 행을 다시 쓸 때(ON CONFLICT · 싱크 · 몰 재적재)**: `joined_at` = 두 값 중 이른 값(`LEAST` · 한쪽 NULL 이면 다른 쪽) · 덮어쓰기 · 지우기 0. 늦게 들어온 「받은 시각」이 진짜 가입 시각을 덮으면 그 고객이 다시 신규로 잡힌다(LESSONS_DB 「양방향 적재 = GREATEST/COALESCE」 사고와 같은 부류 · 여기는 이른 값이 진실).
- **신규 판정(D19)**: 신규 가입 여정 대상 = `joined_at` ≥ 그 여정의 기준선 시각(`journeys.entry_baseline_at` · 처음 켠 때 · 켜기 전 가입자는 신규가 아니다) **그리고** `joined_at` ≥ 지금 − 72시간(시스템 멈춤 뒤 받는 사건과 같은 나이 규칙 ② · 오래전 가입이 늦게 들어와도 환영 문자 0) + 원장에 번호 없음(멱등 그대로) + 번호 한 행(D18). 사람 멈춤 동안의 가입 = 재개 때 기준 시각이 지금으로 옮겨져 0(3-5 ② · 늦게 적재돼도 같다). 구매 횟수 · 포인트 · 등급 「기존 근거」(`journey-identity-signals.ts:97-116`)는 지운다(가입 포인트 · 첫 구매가 같이 들어온 진짜 신규가 빠지던 것).
- **켜기 판정**: 그 회사에 `joined_at` 을 쓰는 길이 하나도 없으면(가입 사건 연동 0 · 싱크 incremental 0 · 화면 추가 0) 신규 가입 여정은 「가입 근거 없음」으로 켜지 않는다(`resolveNewCustomerJudgement` 자리 · 지금 문장 그대로 쓴다).
- **엑셀 한 번 묻기**: 켜진 신규 가입 여정이 있는 회사에서 처음 보는 번호가 든 파일을 올리면 올리는 화면에서 「새 번호 N명이 '여정 이름' 환영 문자를 받습니다」 + [기존 고객으로 올리기](기본) / [신규 고객으로 올리기] 한 번. 여정을 멈추라고 하지 않는다.
- **자동마케팅 「새로 등록된 고객」(D20 · 같은 뿌리 · 같은 배포)**: 대상 조건 `c.created_at >= 기준`(`automarketing-segment.ts:328`)을 `c.joined_at >= 기준` 으로 · 쓸 수 있는가(`resolve` 320-325) = 그 회사 고객 중 `joined_at` 이 있는 행이 1명 이상일 때만(`loadCompanySegmentFacts` 에 한 칸 · 없으면 잠금 + 사유 「가입일 정보가 아직 없어요. 자사몰 회원 연동이나 싱크 가입일이 들어오면 열립니다」) · 이름 · 설명 「새로 가입한 고객 · 가입한 지 기준일 이내」 · AI 대상 축 지시(`autosend-policy.ts` `TARGET_HINTS` new_customers 「등록일」)도 같은 말. 이미 이 축을 쓰는 운영자 = DDL 뒤 첫 회차에 잠금 사유로 멈추고 안내(지금 0건 통지 길 그대로) · 배포 앞 확인 SQL(Harold) = 이 축을 쓰는 켜진 운영자 수.
- 기준선 원장(`seedBaselineForJourney` · 켜기 `journey-builder.ts:1061` · 떼기 `journey-attach.ts:283`)은 남기되 심는 때를 3-5 ② 로 좁힌다(처음 · 사람 멈춤 재개 · 초안 켜기 · 떼기 · 시스템 멈춤 재개 = 심지 않음). 떼기(`journey-attach.ts:281-284`)는 시작을 바꾸는 사람 조작이라 지금처럼 심는다.
- 뿌리 = **R53 새**(「신규 판정 근거가 가입 사실이 아니다 · 우리가 처음 본 때 · 시점 없는 이력으로 신규를 가른다」) · R40 넓힘(양 관문 = 거짓 멈춤).
- 계약 시험: 고객 행을 만드는 문장 전수(`INSERT INTO customers` · 소스 추출) = `joined_at` 을 정하거나 이유 붙은 허용 목록 · 신규 가입 대상 SQL = `joined_at` 을 읽고 구매 · 포인트 근거를 읽지 않음 · 「신규 · 새로」 대상을 만드는 자리 전수(여정 대상 SQL 갈래 · 자동마케팅 축 · 소스 추출) = `created_at` 으로 신규를 가르지 않음 · `dailyVolumeGate` 0(소스) · 실 PG = 가입 포인트 있는 몰 신규 = 진입 1 / 싱크 full 1만 명 = 진입 0 / incremental 새 번호 = 진입 1 / 엑셀 기존으로 올리기 = 0 / 자동마케팅 새로 가입 축 = 오늘 엑셀로 올린 옛 고객 0.

### 3-7 D4 큰 회사 진입 속도(같은 배포)

- 상태 트리거(`journey-trigger-watcher.ts:219-224`): 그 회차가 잘렸으면(뽑은 수 = 뽑기 상한) 1시간 쉬지 않고 다음 회차(5분)에 이어서(잘린 회차는 `_stateTriggerRanAt` 를 찍지 않는다).
- 재진입(`journey-reentry-worker.ts:45-46 · 181`): 한 회차 여정당 1,000 → `JOURNEY_COUNT_CAP`(10만 · 같은 상수) · 주기 6시간 → 1시간 · 잘리면 다음 회차.
- 뿌리 = R40 넓힘. 계약 시험: 진입 넣기 자리(D 칸) 회차 상한 상수 = `JOURNEY_COUNT_CAP` 하나(숫자 상수 0).

### 3-8 D5 재진입 진입 정보(같은 배포)

- 진입 정보 = 한 함수(`entryPropsFor(journey, customerIds)` · 포인트 = `points_at_entry` · 장바구니 = 담은 상품 · 그 밖 = 없음) — 진입 감시(`journey-trigger-watcher.ts:392-407`) · 재진입(`journey-reentry-worker.ts:186-191`) 둘 다 부른다.
- 뿌리 = R1 넓힘. 계약 시험: 사건 · 상태 여정의 `INSERT INTO journey_executions` 자리(D 칸) = 진입 정보를 그 함수에서 받는다(날짜 기준 · 한 번 보내기 = 허용 목록 · 진입 정보 없음).

### 3-9 W 주간 회사 묶음 검사(§0-1 · D10 을 닫는다 · 납품 전)

- 새 워커 `runWeeklyStepCheck`(journey-pretest-notifier 옆 · 시작 = 일요일 21:00 KST · 회사 돌아가며(`interleaveByCompany`) · 회사 안 = 다음 발송이 이른 칸부터).
  - 대상 = 켜진 여정의 문자 칸(SMS · LMS · MMS) × 보낼 판(`stepSendVersions` · 최신 스냅샷 + 변이) · 카카오 칸 0 · 진행 중 실행이 없어도 대상(발송 예정과 무관).
  - 검사 = `runStepSpamTest`(자동 줄 · `reuseDays` 를 넘기지 않는다 = 같은 날 검사만 이어 봄 · 지난주 결과를 다시 쓰지 않는다 · 스캐너의 7일 이어 보기 `journey-pretest-notifier.ts:336` 는 새 글 · 보류 재검사에 그대로) · 기록 = `recordIfCurrent`(판 확인 쓰기 한 곳 · 지금 그대로).
  - 보류 재검사(`journey-pretest-notifier.ts:230` · 7일마다)와 주간 검사가 같은 판을 같은 주에 보면 = 같은 글 · 7일 이어 보기로 한 번만 검사된다(차감 · 검사 두 번 0).
  - 검사 전 판정(유료 검사 앞 · D6 ② · D9 와 같은 함수): 채울 자리 · 없는 변수가 남은 판 = 스팸 검사 없이 그 칸 보류 + 상황판(검사 0원).
  - 통과 = 결정 기록 notified · 막힘 = `holdCurrent`(그 칸 · 그 판만 보류 · 여정 멈춤 0) + AI 수정안(`journey-pretest-candidate` 후보 표 · `regenerateStepAvoidingSpam` 1회 · 차감 키 = 판) → 수정안 검사까지 → 결과를 후보에 남긴다. **원문은 바꾸지 않는다**(지금 `testCandidate` 의 자동 반영 갈래는 주간 검사에서 쓰지 않는다).
  - 다 못 끝낸 회사 = 월요일 아침에도 이어서 · 그동안 지난 통과본 발송(보류 0).
  - 이어 하기 = DB 기준(재시작 · 배포에도 · 프로세스 기억 0) · 워커는 1분마다 끝나지 않은 칸 하나를 고른다. **끝난 칸** = 이번 주 시작(일요일 21:00 KST) 뒤 그 칸 지금 판의 결정 기록이 있고, 그 기록이 보류이면 **수정안 일도 끝났을 때**(★ Codex 설계 1R #7 · 보류 기록과 수정안 만들기는 다른 트랜잭션이라 보류 직후 멈추면 수정안이 영영 안 생겼다):
    - 수정안 일이 끝남 = 그 판 후보가 통과 · 막힘 · 실패(`journey_pretest_candidates.status` passed · blocked · failed) · 또는 수정안을 만들지 않는 칸(A/B 칸 · 채울 자리 · 없는 변수 보류 · 후보 표 없음).
    - 후보가 만드는 중(generating · 10분 넘으면 정리 워커가 failed) · 검사 중(testing) = 끝나지 않음 → 다음 분에 이어 본다(검사 중 = 같은 글 같은 날 검사를 이어 봄 · 새 차감 0 · `testCandidate` 와 같은 길).
    - 그래서 보류 판을 7일 뒤에야 다시 고르는 지금 스캐너 규칙(230)과 무관하게 월요일 아침까지 이어진다.
  - 검사는 한 번에 하나 걸고 끝을 기다린다(`runStepSpamTest` = 등록 + 완료 대기) — 줄에 쌓아 두지 않는다. 쌓으면 「30분 넘게 기다린 검사」 운영 경보(`spam-test-queue.ts` `checkSpamQueueLag`)가 밤새 울리고, 사람이 누른 검사(사람 줄 우선 `pickNextSpamTest` 3 : 1)도 그 뒤에 선다.
  - 지금 스캔의 「통과한 글 7일 재검사」 갈래(`journey-pretest-notifier.ts:228-229`)는 지운다(검사 두 벌 0) · 새 글 · 고친 글(①) · 보류 재검사(③)는 그대로.
- 월요일 09:00 = 주간 요약(`manager-weekly-digest.ts`)에 「스팸 검사에 걸린 칸 N개」 한 줄 · 상황판 링크 그대로.
- 상황판(`manager-board.ts` held_step 할 일): 원문 · 통과한 수정안 · [이 글로 보내기] · [직접 고치기].
  - [이 글로 보내기] = 상황판은 읽기 전용 원칙 그대로(`manager-board.ts:7` · 토큰 링크로 문안을 바꾸지 않는다) → 로그인 화면 그 칸으로 가서 수정안이 미리 채워진 채 [이 글로 바꾸기] 한 번 → `applyStepPatchInLock`(켜진 여정 문안 고치기와 같은 길 · 새 스냅샷) + 그 판 = 이미 검사 통과(같은 글 · 같은 검사 결과 재사용) → 보류 풀림 · 기다리던 고객에게 다음 회차.
  - [이 글로 보내기] 쓰기 = 새 함수 하나 `applyPassedCandidate`(★ Codex 설계 1R #8 · 옛 `recordIfCurrent` 의 `newBody` 는 같은 판 id 의 본문을 덮어 늦게 온 원문 검사 결과가 판 확인을 지나 통과한 수정안을 다시 보류할 수 있었다 · 칸 고치기 `applyStepPatchInLock` 는 새 판을 만들어 그 판 확인과 부딪힌다) — 한 트랜잭션:
    1. journeys 행 잠금(수정 경로와 같은 순서 · `withJourneyValidationReset` 의 잠금 · 표식은 지킨다 `keepMarker`).
    2. 그 칸 최신 판 id = 후보의 판 id · 후보 상태 = passed 확인(아니면 아무것도 안 쓰고 「문안이 바뀌어 이 수정안은 쓸 수 없어요」).
    3. 칸 본문 · 제목(`journey_steps`)을 후보 글로.
    4. 새 판(`createStepSnapshot` 꼴 · 본문 = 후보 · 신뢰도 100 · 후보 검사가 그 글로 통과했다).
    5. 새 판의 결정 기록 = notified(안내 마감 · 검사 id = 후보 검사).
    - 옛 판으로 늦게 온 검사 결과 = 최신 판 ≠ 검사한 판이라 `recordIfCurrent` 가 버린다(지금 규칙 그대로 · 새 장치 0).
  - **보내기 전 검사(발송 2시간 전)의 자동 반영 갈래 삭제**: 지금 후보가 통과하면 「안내 뒤 반영」으로 원문을 저절로 바꾼다(`testCandidate` → `recordIfCurrent` `newBody`) → §0-1 3 「원문은 사람이 누를 때만」 · 메모리 「고객 문안 불변」과 어긋난다 → 후보 통과 = 그 칸 보류 유지 + 안내(「수정안이 준비됐어요 · 상황판에서 [이 글로 보내기]」) · 반영 = 위 함수 하나(주간 검사 · 보내기 전 검사 공통). `recordIfCurrent` 의 `newBody` 는 부르는 곳이 0 이 되어 지운다.
  - [직접 고치기] = 지금 링크(`/ai-journeys?journey=…&step=…` · 화면이 그 칸을 연다 · `JourneysPage.tsx:737-740`) · 저장 = 지금처럼 그 자리 검사(`routes/ai.ts:3570-3572` `startJourneyStepSpamChecks`).
  - **A/B 칸(변이 있음)**: 수정안은 만들지 않는다(지금 규칙 그대로 · `journey-pretest-notifier.ts:369-373` 「모르는 문안으로 바꾸지 않는다」) → 그 칸 보류 · 상황판 = 걸린 문안 이름(A · B · C) + [A/B 문안 고치기].
    - 켜진 여정의 A/B 문안 고치기는 지금 늘 막힌다(`bandit-optimizer.ts:539` · 603 · `routes/ai.ts:3778-3780`) → 이대로면 여정을 멈춰야 고칠 수 있다(다른 칸까지 멈춤 · §0-1 3 「그 칸만」과 어긋남).
    - 그래서 **그 칸이 지금 보류(`stepHeldSql`)일 때만** 켜진 여정에서도 A/B 문안 저장 · 지우기를 받는다(보류가 아닌 칸 = 지금처럼 409 · 나가는 중인 글을 검사 없이 바꾸지 않는다) · 같은 잠금(`withJourneyValidationReset`) 안에서 새 판(`createStepSnapshot` · 신뢰도 0)을 함께 만든다 → 옛 판 보류는 관문에서 빠지고 새 판은 검사 전이라 실행기가 기다린다 → 저장 뒤 그 자리 검사(`startJourneyStepSpamChecks` · 판 전부) 통과 = 100 → 다음 회차 발송.
    - 보류 판정 · 새 판 쓰기 = 같은 트랜잭션(판정과 쓰기 사이에 보류가 풀려 나가는 중인 칸을 고치는 갈래 0).
    - 이미 관문을 지나 도는 실행기 묶음이 고친 A/B 글을 읽어 보내는 갈래 = 3-18(선점 판 확인)이 닫는다.
- 자동마케팅 = 회차마다 새 문안이라 회차 검사 그대로 · 걸린 회차(검토) = 상황판 할 일에 그 제안 링크(지금 `/ai-operator` 목록 → 제안 id 로) · 월요일 요약 수에 포함 · 매일 승인 0 은 B-1102-1(3-2)이 닫는다.
- 뿌리 = **R48 새**(「주기 검사의 대상이 발송 예정에 묶여 바로 보내는 칸이 빠진다」).
- 계약 시험: 주간 대상 = 켜진 여정 문자 칸 판 전부(실 PG · 진행 중 실행 0 인 칸 포함 · 카카오 0) · 막힘 = 원문 불변 + 후보 · 보류 / [이 글로 보내기] 전에는 판 그대로.
- 확인할 것 = 밤 검사 판정 = 낮과 같은가(첫 주 같은 글 낮 · 밤 비교) · 전체 판 수(아래 SQL) ≤ 12시간 용량(검사 폰 동시 1건 · `spam-test-queue.ts:5` · 건당 45~60초).

### 3-10 N 밤 트리거 규칙(D15 · Harold 1102 「카카오 템플릿형을 제외하곤 다음날 8시」)

- 밤 도착 시각 = 상수 한 곳(`NIGHT_ARRIVE_HOUR`) · 값 = §4 ⑤.
- 발송 창 = 문자(SMS · LMS · MMS)만. 실행기 `sendWindowState`(`journey-executor.ts:714`) · 적재 단위 창(1051) · 첫 칸 · 다음 칸 시각(`calculateNextRunAt` · `firstRunAtFor`)이 칸 채널을 받아 알림톡이면 밤 밀기를 하지 않는다.
- 8시 영향표(`NIGHT_ARRIVE_HOUR` 를 읽는 자리 전수 · grep):
  - `shiftToSendableHour`(`send-time-util.ts:245-258`) = 여정 밤 밀기 · 자동마케팅 발송 직전 밤 밀기 · 승인 기간 회차 계산 → 모두 8시(같은 말 · 화면 = `/api/send-policy` 의 `nightArriveHour` 를 읽어 `JourneyStepStudio.tsx:380-382` · `ContinuousOperatorPage.tsx:538` 이 저절로 8시).
  - `dailyFirstRunAt` 기본 시각(`send-time-util.ts:357-359`) → 8시(⑤).
  - `dailyFirstRunAt` 의 「다음 평일」(`send-time-util.ts:348-356`)은 이 상수를 쓰면 안 된다 — 같은 모드가 바로 갈래(`calculateNextRunAt` 293-307 = 09시 고정)와 갈려 8시 · 9시가 되고 화면은 「다음 평일 09시」(`JourneysPage.tsx:449` · 2014 · 2063 · `journey-graph.ts:87`)라 말한다 → 「다음 평일」 시각 = 상수 하나(`BUSINESS_DAY_HOUR = 9`)를 두 함수가 같이 쓴다(⑤는 밤 도착 · 하루 묶음만 · 다음 평일은 정한 적 없음 = 지금 9시 그대로).
  - 고객 문장 「다음날 아침 9시에 보내요」(`journey-trigger-capability.ts:316` `sendTimingLine`) = 숫자를 박지 않고 상수를 읽는다.
- 밤 알림톡의 대체 문자(⑥ 과 맞물림): 알림톡이 안 닿으면 게이트웨이가 바로 대체 문자를 보낸다(`journey-executor.ts:1144-1152`). 대체 = 템플릿 글 그대로(대체 종류 S · L) · 대체 없음(N)이면 정보성 그대로라 밤에 바로 보낸다. **대체 = 직접 쓴 대체 문안(A · B · `usesCustomContents` `alimtalk-fallback.ts:82`)이면** 그 글은 검수받지 않은 문자라 문자 규칙(밤이면 8시)을 따른다 — 그 칸은 문자 칸과 같은 시각 함수로 잰다.
- 뿌리 = **R49 새**(「광고 시간 규칙을 정보성 채널에 건다」 · D16 과 같은 뿌리).
- 계약 시험: 시각을 정하는 자리(진입 셋 · 전진 · 분기 · 다시 켜기) 전수 = 칸 채널을 넘긴다(소스 추출) · 표 시험(밤 11시 진입 문자 = 다음날 ⑤시 · 알림톡 = 그 회차).

### 3-11 D16 알림톡 = 정보성(납품 전)

- `resolveJourneyAdFlag('kakao')` = 늘 false(알림톡은 광고를 실을 수 없다) → 피로도 상한 · 광고 시간 규칙 밖.
- 수신 거름: 알림톡 칸 = §4 ⑦(확정 = 활성 · 번호 유효만 · 광고 동의 · 080 거부는 문자 칸만).
- 피로도 기록 = 광고 발송만(`journey-executor.ts:1193` `if (c.isAd)`) → 광고 판정이 false 가 되면 알림톡은 피로도 수에도 들어가지 않는다(같은 판정 한 곳 · 따로 고칠 자리 0) · 칸 저장 기본값(`journey-builder.ts:1677` is_ad true)은 알림톡 칸이면 false 로 저장(읽을 때 판정이 이미 false 라 옛 행도 같다).
- 뿌리 = R49.

### 3-12 D8 다시 켤 때 시각(납품 전)

- `RESUME_SHIFT_SQL` = 멈춘 동안 때가 된 실행(`paused_at < next_run_at <= 다시 켠 시각`)만 · 앞으로 보낼 실행은 그대로 · 때가 된 실행의 새 시각 = §4 ⑧(다음 발송 창 · 칸 채널을 받는 3-10 의 같은 시각 함수 · 문자 = 밤이면 8시 · 알림톡 = 바로).
- 뿌리 = R45 넓힘(시스템 · 사람 멈춤이 멈춤과 무관한 고객 일정을 바꾼다).
- 계약 시험: 5분 멈춤 → 다시 켜기 = 미래 실행 시각 불변(실 PG).

### 3-13 D9 없는 변수(납품 전)

- 생산자: AI 맞춤 여정 지시문(`journey-builder.ts:588`)의 변수 = 그 회사 필드 매핑에 있는 것만(여정 AI 생성 `journey-ai-generator.ts:412` 「회사 실측」과 같은 목록 함수).
- 관문(모든 생산자 공통 · 효과 자리): 보낼 글 판정 한 곳(`send-placeholder-gate.ts`)에 「매핑에 없는 %변수%」를 더해 켜기 · 칸 저장 · 보내기 전 검사 · 실행기가 같은 함수로 막는다(지우고 보내지 않는다 · 그 칸 보류 = D6 과 같은 자리).
  - 「없는 변수」의 기준 = 치환 함수가 실제로 채우는 이름(`messageUtils.ts` `replaceVariables` 2단계 = 그 회사 `prepareFieldMappings` 의 이름 · 290-322) · 글을 변수로 쪼개는 것도 치환과 같은 함수(`replaceVarTokens` · `cleanLeftoverVars` 161-164)로 — 판정 함수를 `messageUtils.ts` 에 두고(치환 동작 불변 · 순수 함수 추가) 관문이 부른다. 판정과 치환이 다른 목록을 보면 「검사는 통과 · 발송은 빈칸」이 다시 생긴다.
  - 같은 판정에 「값이 보장되지 않는 장바구니 변수」: `{{ cart.* }}`(`cdp-events.ts:311-342` = 그 고객의 가장 최근 장바구니를 시작 사건과 무관하게 읽고 없으면 빈 값)는 시작이 장바구니인 여정에서만 통과.
  - 생산자 전수 확인(1102 밤): 여정을 켜는 길 = 켜기 한 곳(AI 생성 · 인터뷰 · 지도 · 상품 여정 · 다음 단계 추천 모두 초안으로 만들고 켜기를 지난다 · `INSERT INTO journeys` = `journey-builder.ts:421` · 판 복제 `journey-lineage.ts:287` 둘뿐) → 생산자마다 따로 막지 않고 이 관문 하나로 닫힌다.
- 뿌리 = **R50 새**(「없는 변수가 발송 때 조용히 빈칸이 된다」).
- 계약 시험: 여정 · 자동마케팅 글을 만드는 AI 지시문 전수(소스 추출) = 변수 목록을 함수에서 받는다 · 실행기 문자 묶음 = 판정 호출.

### 3-14 D11 알림톡 칸 켜기 관문(납품 전)

- 실행기 판정(`journey-executor.ts:761-786` 템플릿 코드 · 존재 · 승인 · 카카오 활성)을 함수 하나로 빼고(`kakaoStepBlockReason`) 켜기(`activationBlockReason`)와 실행기가 같이 부른다.
- **D21 같은 함수에**: 알림톡 변수 연결 검사 = 실제로 보내는 글(승인 템플릿 본문 `kakao_templates.content` · 실행기 852)의 `#{…}` 전부가 연결됐는가. 지금 켜기 검증은 칸 본문(`journey-steps.message_template` · `journey-pretest-validator.ts:140-141` · 229-236)을 보고 실행기는 템플릿 본문을 채운다 → 둘이 다르면 검사를 지난 칸이 빈 변수로 나간다. 켜기 검증의 그 갈래도 이 함수를 부른다(판정 한 벌).
- 뿌리 = R47 넓힘. 계약 시험: 켜기 관문 = 그 함수 호출(소스) · 실 PG = 템플릿 없는 알림톡 칸 켜기 거절.

### 3-15 D12 · D13 클릭 판정

- 클릭 = 그 여정 · 그 칸 링크(`message_click.properties` 의 `journey_id` · `step_id` · 코드 확인 1102 밤: 실행기가 링크를 줄일 때 여정 · 칸 · 고객 id 를 원장에 싣고(`journey-executor.ts:1068-1070`) 클릭 기록이 그 값을 사건에 적는다(`routes/short-url.ts:83-95`) · 통계가 이미 이 칸으로 센다 `journey-stats.ts:243` · 344).
- 옛 조건(`journey_step_clicked`) = 켜기에서 같은 번호 칸의 `step_link_clicked` 로 바꿔 저장 · AI 맞춤 지시문도 새 조건으로 · 실행기 옛 갈래 = 칸 id 로 거름.
- 목표 「클릭」 = 이 여정 링크만.
- 뿌리 = **R51 새**(「클릭 판정이 그 링크가 아니다」).

### 3-16 D14 A/B 칸 고치기

- 켜진 여정 · 변이 있는 칸의 본문 고치기 = 409 「A/B 문안이 있는 칸은 A/B 창에서 고치거나 모양 바꾸기로 고쳐 주세요」 · 화면 = 그 칸 편집기에 A/B 문안을 보이고 본문 칸을 잠근다.
- 뿌리 = R5 넓힘(본 것 ≠ 나가는 것).

### 3-17 D18 같은 번호 한 통

> **★ 구현 때 확인(1102 밤 · 결함 아님)**: 운영 덤프 = `customers_company_id_phone_key UNIQUE (company_id, phone)`(`~/.hanjul-pgtest/schema.sql` 7209행) → 한 회사에 같은 번호 행이 둘일 수 없다. 아래 「번호 한 행 · 같은 번호 진행 중 실행 NOT EXISTS」는 넣지 않았다(같은 번호 = 같은 고객 id). 닫은 것 = 날짜 기준 · 한 번 보내기의 경합(잠금 안 「이미 뽑았나」 → 상한 셈 · 멈춤 → 넣기 · 실 PG 두 연결 = `journey-anchor-paging-1101.pg.test.ts` 3-17 묶음). 배포 앞 「같은 번호 쌍 수」 확인 SQL 도 필요 없다.

- **한 사람 판정 = 진입 자리 한 곳**(★ Codex 설계 1R #1 · 실행기 묶음 안에서 번호로 거르면 대표 실행이 보낸 뒤 · 중복 실행을 끝내기 전에 멈췄을 때 재처리에서 대표가 비교 대상에서 빠져 두 번째가 다시 나간다 → 실행기 거름을 만들지 않고 진입에서 막는다):
  - **사건 · 상태 여정(진입 감시 · 재진입)**: 대상 SQL 갈래 전부 = 번호로 한 행(가입 갈래와 같은 `DISTINCT ON (c.phone)` · 최근 행) + 넣는 문장 자체에 「이 계보(새 판 · 옛 판 · `lockLineageEntry` 가 돌려주는 `lineageIds`)에 같은 번호(정규화)의 진행 중 실행이 있으면 넣지 않음」(`NOT EXISTS` · 넣기 자리 = 진입 감시 `journey-trigger-watcher.ts:83` 을 부르는 두 자리 · 888 · 재진입 186). 넣기는 지금도 계보 잠금 안(감시 605 · 851 · 재진입 `lockEntryIfActive`) → 같은 계보의 넣기 둘이 동시에 「없음」을 보는 갈래 0. 진입 바꾸기(`usesEntryReplacement`)는 옛 실행을 끝낸 뒤 넣으므로 같은 문장 안에서 끝난 실행은 「진행 중」이 아니다(순서 확인 = 구현 때 그 자리 줄로).
  - **날짜 기준 · 한 번 보내기(★ Codex 설계 2R #3 · 이 여정은 칸 · 날짜마다 실행이 따로 생겨 한 고객에게 진행 중 실행이 여럿인 것이 정상)**: 진행 중 실행 `NOT EXISTS` 를 걸지 않는다(걸면 앞 칸 실행이 보류로 남은 동안 다음 칸이 막히고, 표식만 남아 그 칸은 영영 안 나간다). 대신 **(여정 · 칸 · 보내는 날) 뽑기 = 정확히 한 번 · 그 한 문장 안에서 번호 한 행**:
    - 지금도 (칸 · 날) 뽑기는 한 문장 · 한 시점 전원이고(`journey-anchor-scheduler.ts:258-279` CTE `claimed`) 그날 표식이 하나라도 있으면 다시 뽑지 않는다(`anchorStepDispatched` 92-98 · 172). 그런데 그 확인이 **잠금 밖**이라 두 회차가 함께 지나면 뒤 회차가 잠금을 얻은 뒤 표식 없는 줄(고객 id 기준)을 또 뽑는다(★ Codex 설계 3R · 그사이 번호가 바뀌면 같은 번호로 두 통).
    - 처방 = 「이 칸 · 이날 이미 뽑았나」를 **계보 잠금(`lockEntryIfActive` 251) 안에서 다시 본다**(한 번 보내기 363-368 「멱등은 잠금 안에서 다시 본다」와 같은 꼴) → 뽑기가 한 번뿐이라 다른 회차가 다른 줄을 다시 뽑는 갈래 자체가 없다 · 그 한 문장의 대상(`anchorAudienceSql` · `audienceSource`) = 번호로 한 행(`onePersonSql`) → 표식 · 실행 = 같은 거른 묶음(표식만 남고 실행 없는 갈래 0).
    - 상한 넘음 · 꺼짐 · 대상 0 = 표식 0 이라 같은 날 다시 뽑는다(지금 규칙 그대로).
    - **상한 멈춤도 잠금 안에서(★ Codex 설계 4R #1)**: 지금 상한 셈 · 멈춤은 잠금 **앞**(날짜 기준 `journey-anchor-scheduler.ts:233-242` · 한 번 보내기 341-347)이라, 두 회차가 바깥 확인을 함께 지난 뒤 앞 회차가 정상으로 넣고 대상이 늘면 뒤 회차가 잠금 전에 여정을 멈춘다(이미 넣은 정상 발송까지 멈춤). → 순서 = 잠금 → 「이미 뽑았나」(뽑았으면 아무것도 안 함) → 상한 셈 · 넘으면 멈춤(같은 트랜잭션 · CT-J2 조각) → 넣기. 잠금 앞 셈은 「대상 0 이면 잠금도 잡지 않는다」 빠른 길로만 남긴다.
    - Codex 추천(표식에 그때 번호를 남기고 (칸 · 날 · 번호) 유일)은 쓰지 않는다 — 뽑기를 한 번으로 만들면 회차 사이 번호 이력이 필요 없다(새 칸 · 색인 0 · 지울 개념 = 「같은 번호 표식」 조각).
  - 실행기 = 지금 고객 id 거름 그대로(번호 거름 새로 만들지 않음 · 재처리 경합 0).
  - 이미 들어와 있는 같은 번호 쌍(배포 앞 생긴 것) = 배포 앞 확인 SQL(Harold) 수 → 0 이 아니면 배포 뒤 한 번 뒤 실행을 ended 로(되돌리기 블록 동봉 · Harold 실행).
- 뿌리 = **R52 새**(「한 사람 = 번호 하나 판정이 진입마다 다르다」).
- 계약 시험: 대상 SQL 갈래 전수(`buildJourneyTargetQuery` · `anchorAudienceSql` · 소스 추출) = 번호 한 행 · `INSERT INTO journey_executions` 전수(소스 추출) = 사건 · 상태 넣기는 같은 번호 진행 중 실행 `NOT EXISTS` 조각 · 날짜 기준 · 한 번 보내기 넣기는 「이미 뽑았나」를 같은 트랜잭션 잠금 뒤에 다시 보는 문장이 INSERT 앞에(허용 목록 = 이 두 갈래 이름) · 실 PG = 두 매장 같은 번호 생일 = 한 통 / 같은 번호 다른 행이 다른 회차에 휴면이 됨 = 진입 1 / 날짜 기준 2칸 여정에서 1칸 실행이 보류로 남은 동안 2칸 날이 옴 = 2칸 실행 생성 · 발송 / 같은 번호 두 줄 날짜 기준 = 그날 한 통 / 두 연결이 같은 (칸 · 날)을 함께 뽑음(앞이 커밋한 뒤 · 그사이 한 줄의 번호를 바꿈) = 뒤 연결 뽑기 0.

### 3-18 발송 선점 = 관문 때 판과 같을 때만(★ Codex 설계 1R #2 · 3-9 A/B 예외 · 주간 검사 · 보내기 전 검사 공통)

- 지금 실행기 순서: 관문(보류 · 검사 전 판 `journey-executor.ts:681-711`) → 살아 있는 변이 읽기(731) → 렌더 → 단위마다 보류만 다시 봄(1058-1063) → 선점 문장(1098-1110 · 실행 · 여정 active 만 확인). 관문을 지난 뒤 보류 → A/B 고치기(새 판)가 차례로 커밋되면 이미 도는 묶음이 검사 전 새 변이 글을 읽고, 새 판 때문에 옛 보류는 풀려 단위 확인도 지나 보낸다.
- **왜 1R 처방이 2R 에서 다시 깨졌나(★ Codex 설계 2R #1)**: 「지금 보낼 수 있는 판인가」를 세 번 · 서로 다른 시각에 읽는다 — ① 스냅샷 읽기(`journey-executor.ts:548-561` · 본문 · 제목 · 신뢰도 → `pendingSnapshotAt`) ② 관문(681-711 · 보류 · ①의 값으로 검사 전) ③ 단위 확인(1058-1063 · 보류만). 1R 에서 판 id 를 ②에 더했지만 검사 통과 여부는 여전히 ①의 옛 값이라, ①과 ② 사이에 새 판(신뢰도 0)이 커밋되면 ②와 선점이 새 판 id 를 읽고 옛 보류는 사라져 둘 다 지난다. 조건을 하나 더 덧대면 또 다른 틈이 남는다 → **판정을 조각 하나로 만들고 결정은 효과 문장(선점) 한 곳에서만** 한다.
- 처방 = 판을 발송 사건에 묶는다(관문 = 효과 자리 · R47):
  - **판정 조각 하나** `stepSendableSql(여정, 칸, 판 id)` (`journey-pretest-notifier.ts` 의 `stepHeldSql` 옆 · 판정 소유 = 그 파일): 「그 칸 최신 판 id = 넘긴 판 id · 그 판 신뢰도 = 100 · 그 판 보류 아님」.
  - ①을 판 id 까지 읽게 바꾼다(본문 · 제목 · 신뢰도 · **id** = 한 SELECT · 렌더 글 = 이 판 본문 · 변이 칸은 변이 행).
  - **선점 문장**(1098 의 `WITH att AS (UPDATE …)`)의 WHERE 에 `stepSendableSql(…, ①의 판 id)`(문자 칸) — 확인과 선점 사이 틈 0 · 거짓이면 선점 0 → 그 단위부터 보내지 않고 다음 회차(새 판이 검사를 지나면 그 글로 나간다).
  - ② 관문 · ③ 단위 확인 = 같은 조각을 미리 보는 빠른 길(거짓이면 일찍 미룸 · 결정 아님) · ③은 선점 조건이 덮으므로 지운다(같은 판정 두 벌 0).
  - 고치는 쪽은 모두 새 판을 커밋한다(칸 고치기 · A/B 예외 · [이 글로 보내기]) → 렌더가 언제 일어났든 선점 시점 최신 판이 ①의 판이 아니면 안 나간다 · 같으면 렌더 글 = 그 판 = 검사를 통과한 글(A/B 변이 행은 새 판 없이 바뀌지 않는다 = 3-9 예외가 같은 트랜잭션에서 새 판을 만든다 · 그 밖의 켜진 여정 변이 쓰기는 막힘 `bandit-optimizer.ts:539` · 603).
- 뿌리 = R47 넓힘(「판정이 켜기 · 관문에만 있고 효과 자리에 없다」).
- 계약 시험: 실행기 선점 문장(소스 추출 · `INSERT INTO journey_step_logs … 'sending'`) = `stepSendableSql` 을 문장 안에 · 「판이 보낼 수 있는가」를 판정하는 SQL(신뢰도 · 보류 · 최신 판) = 그 조각 파일 밖 0(소스 추출) · 실 PG 두 연결: ①(스냅샷 읽기) 직후 · 관문 직후 · 렌더 직후 세 시점 각각에 (다른 연결) 보류 + A/B 고치기 커밋 → 선점 = 0 · 발송 0 / 끼어든 쓰기 없음 = 선점 · 발송.

## §4 정할 것(Harold · 추천 1 · 이유)

> ★ 1102 밤 Harold 「추천대로 정함」 = ⑤ ~ ⑨ 추천안으로 확정(⑤ 둘 다 8시 · ⑥ 알림톡 밤 바로 · ⑦ 알림톡 = 활성 · 번호 유효만 · ⑧ 다음 발송 창에 바로 · ⑨ 납품 고객사 구성 확인 뒤).
> ★ 1102 밤 Harold 「추천대로 정함」(둘째) = ② ~ ④ 추천안으로 확정(② 받기 · 도착 72시간 안 · ③ 확인 창 뒤 지금 · ④ 새로 만들기 · 보냄 · 예약 회차가 있으면 막음). ① = 관문 없앰(3-6). **정할 것 = ⑨ 하나(납품 고객사 구성).**

| # | 무엇 | 후보 | 추천 · 이유 |
|---|---|---|---|
| ① | D2 하루 묶음 이상치 관문 | (★ 1102 밤 Harold 결정) | **관문 없앰 · 신규 판정을 가입 근거로(3-6)** — 바닥 1,000 추천은 거둠 |
| ② | D1 시스템 멈춤 재개 때 멈춘 동안 사건 | 받기(도착 72시간 안) · 받지 않기(지금) | **받기** — 사람이 고르지 않은 멈춤으로 고객이 빠지면 안 된다(빠짐 0) · 72시간 넘은 것은 지금 규칙대로 안 받는다 |
| ③ | B 회차 시각이 지난 뒤 승인 | 확인 창 뒤 지금 · 다음 회차로 | **확인 창 뒤 지금** — 지금 경고 모드 그대로 · 담당자가 늦게 본 날도 보낼 수 있게 |
| ④ | D3 대기 회차에서 지금 실행 | 새로 만들기(지금) · 막기 | **새로 만들기** — 사람이 문안을 다시 받으려고 누른 것 · 보냄 · 예약 회차가 있으면 막는다 |
| ⑤ | 밤 트리거 문자가 나가는 시각 · 하루 묶음 첫 발송 시각 | 8시(Harold 1102 밤) · 9시(지금 코드 · 주석 「Harold 명시」) | **둘 다 8시 한 숫자** — 발송 창 시작(8시)과 같고 Harold 최신 말씀 |
| ⑥ | 밤에 들어온 알림톡 | 바로 보내기 · 아침까지 기다리기(지금) | **바로** — Harold 「카카오 템플릿형은 제외」 · 정보성 |
| ⑦ | 알림톡 칸의 수신 거름 | 광고 동의 · 080 거부까지(지금) · 활성 · 번호 유효만 | **활성 · 번호 유효만** — 배송 · 예약은 정보성 · 법률 판단 = Harold 확인 |
| ⑧ | 멈춘 동안 때가 된 실행(D8) | 다음 발송 창에 바로 · 멈춘 일수만큼 밀기(지금) | **다음 발송 창에 바로** — 늦어진 고객을 더 늦추지 않는다 · D1 안내로 멈춤 자체가 짧아진다 |
| ⑨ | 두 문 회사(자사몰 + 매장)의 매장 구매 | 자사몰 문만(지금) · 두 문 다(같은 주문 중복 제거) | **납품 고객사 구성 확인 뒤** — 그 고객사가 두 문을 다 쓰면 두 문 다 · 아니면 지금 그대로 · ★ 1103 Harold 「둘 다 쓸 거야」 → 두 문 다 = **C99**(§11) |

## §5 DDL(배포 앞 · 확인 출력 뒤 push · 코드는 칸이 없으면 옛 동작 + 운영 경보)

- DDL-1(D1): `ALTER TABLE journeys ADD COLUMN IF NOT EXISTS pause_notice_for timestamptz NULL, ADD COLUMN IF NOT EXISTS pause_notice_attempts smallint NOT NULL DEFAULT 0;` — 확인 SQL(구현 전 Harold): `SELECT column_name FROM information_schema.columns WHERE table_name = 'journeys' AND column_name IN ('pause_notice_for', 'pause_notice_attempts');`(0행이어야 새 칸).
- DDL-2(D19 · 3-6): `ALTER TABLE customers ADD COLUMN IF NOT EXISTS joined_at timestamptz NULL;` + 카페24 가입 사건으로 이미 들어온 가입일 옮기기(`custom_fields->>'cafe24_join_date'` → `joined_at` · 값 모양 확인 뒤 · 배포 뒤 한 번) — 확인 SQL(구현 전 Harold): `SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' AND column_name = 'joined_at';`(0행이어야 새 칸) · 표준 필드 「가입일」은 `standard_fields` 행 추가(같은 배포 앞 · 칸 이름 확인 SQL = `SELECT column_name FROM information_schema.columns WHERE table_name = 'standard_fields';`).
- 그 밖 = DDL 0(D3 = `proposal_json.meta` · B = `proposal_json.meta` · `admin_notified_at` 기존 칸 확인 SQL = `SELECT column_name FROM information_schema.columns WHERE table_name = 'operator_proposals' AND column_name = 'admin_notified_at';`).
- **확인 출력(1102 밤 21:56 · Harold 운영 실행 · 한 문장으로 넷)**: `journeys.pause_notice_for` · `pause_notice_attempts` = 0행(새 칸) · `customers.joined_at` = 0행(새 칸) · `operator_proposals.admin_notified_at` = 있음(timestamp with time zone) · `standard_fields` 칸 = id(integer) · field_key · display_name · category · data_type(character varying) · description(text) · sort_order(integer) · is_active(boolean) · created_at(timestamp with time zone) → 「가입일」 행 = field_key · display_name · category · data_type · sort_order · is_active 로 넣는다(값 · 같은 field_key 행 유무는 넣기 직전 Harold 실행 SELECT 로 · 분포 · 행 수는 Harold 실행).

## §6 직원 지시문 초안(구현 전 · 동작 · 볼 결과만 · 엑셀 한 장 · 시트 = 흐름)

> 계정 = 테스트계정 · 받는 번호 = 직원 본인 휴대폰 · 화면 글자는 구현 뒤 같은 날 화면에서 한 번 맞춰 엑셀로 낸다(기대 결과는 바꾸지 않는다).
> 엑셀 = `docs/2026-11-02-journey-automarketing-staff-sheet.xlsx`(1102 밤 · 구현 전 · 이 절에서 기계로 뽑음 · 시트 13 + 안내 · 50줄 · 맞음/다름 고르기 칸 · 기술 말 검사 0 · 만든 스크립트 = 세션 scratchpad `build_staff_sheet.py` · 이 절을 고치면 다시 뽑는다).

**시트 1 자동마케팅 승인 · 시각 · 안내**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 자동 마케팅을 새로 만든다 · 받는 사람 = 직원 본인만 들어가는 조건 · 매일 · 보내는 시각 = 지금부터 3시간 뒤 정각 · 승인 기간 없이 시작 | 휴대폰에 「승인 대기」 · 「추천 문안」 문자가 1번씩 온다 |
| 2 | 보내는 시각 2시간 전까지 기다린다 | 휴대폰에 「승인하지 않으면 ○시 회차는 보내지 않아요」 문자 1통 · **새 「승인 대기」 · 「추천 문안」은 오지 않는다** |
| 3 | 「승인할 제안」에서 그 제안 「이 문안으로 승인」을 누른다 | 확인 창에 「○일 ○시에 보내요」가 보인다 · 누른 순간 문자가 오지 않는다 |
| 4 | 카드를 본다 | 「다음 발송」에 정한 시각 · 「제안 준비」에 2시간 전 시각이 따로 보인다 |
| 5 | 보내는 시각까지 기다린다 | 정한 시각에 광고 문자 1통 · 같은 문자가 두 번 오지 않는다 · 「발송 시작」 문자 1통 |
| 6 | 같은 자동 마케팅에서 다음 날 같은 시각까지 지켜본다 | 하루에 「승인 대기」 1번 · 광고 문자는 승인한 날만 |

**시트 2 자동마케팅 승인 기간 · 큰 대상**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 대상이 1,000명이 넘는 자동 마케팅(받는 번호 = 시험 번호 묶음)을 「이번 주 승인하고 시작」으로 시작한다 | 승인 기간이 카드에 보인다 |
| 2 | 다음 회차 2시간 전까지 기다린다 | 「발송 예정 안내」 문자(정지 링크)가 온다 · 「승인 대기」는 오지 않는다 |
| 3 | 정지 링크를 눌러 「이번 회차 건너뛰기」 | 그 회차 문자가 나가지 않는다 |

**시트 3 여정 운영 중 문안 고치기**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 켜져 있는 여정(받는 사람 = 직원 본인)의 문자 칸 문안 끝에 `[혜택 안내: 직접 수정해주세요]` 를 붙여 저장한다 | 저장되지 않고 「채울 자리가 남아 있어요」가 보인다 |
| 2 | 그 줄을 지우고 저장한다 | 「저장했어요」 |
| 3 | 그 칸 보낼 시각까지 기다린다 | 휴대폰 문자에 `[` `]` 자리 글자가 없다 |

**시트 4 여정 멈춤 안내 · 다시 켜기**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정 발송 잔액을 0원으로 만든 상태에서 켜진 여정의 보낼 시각을 기다린다 | 담당자 휴대폰에 「'여정 이름' 여정이 멈췄어요. 이유: 발송 잔액이 모자라…」 1통 |
| 2 | 10분 더 기다린다 | 같은 문자가 또 오지 않는다 |
| 3 | 충전한 뒤 여정 「다시 켜기」 | 창에 「멈춘 동안 들어온 고객도 받아요」가 보인다 · 다시 켜진다 |
| 4 | 직접 「멈추기」를 누른다 | 멈춤 문자가 오지 않는다 |
| 5 | 신규 가입 여정이 켜진 상태에서 발송 잔액을 0원으로 만들어 그 여정이 저절로 멈추게 한다(1번과 같은 문자가 온다) | 「여정이 멈췄어요」 문자 1통 |
| 6 | 멈춘 동안 테스트 몰에서 직원 본인 번호로 회원 가입한다 | 문자가 오지 않는다 |
| 7 | 충전한 뒤 그 여정 「다시 켜기」 → 다음날 아침 8시까지 기다린다 | 환영 문자 1통 |

**시트 5 구매 여정 · 주문 취소**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트 몰에서 직원 본인 번호로 주문 · 결제한다(구매 여정 = 1번 칸 바로 · 2번 칸 1일 뒤) | 1번 칸 문자 1통 |
| 2 | 그 주문을 몰에서 취소한다 | — |
| 3 | 다음 날 2번 칸 시각까지 기다린다 | 2번 칸 문자가 오지 않는다 |
| 4 | 새 주문을 결제하고 바로 취소한다(5분 안) | 1번 칸 문자가 오지 않는다 |
| 5 | 신규 가입으로 시작하고 「1일 뒤 · 구매했으면 A 문자 / 안 샀으면 B 문자」로 갈리는 여정을 켜고 직원 본인 번호로 가입한다 | 다음날 환영 문자 1통 |
| 6 | 그날 안에 테스트 몰에서 주문 · 결제한 뒤 취소한다 | — |
| 7 | 갈림 시각까지 기다린다 | B 문자 1통(A 문자 0통) |

**시트 6 밤에 들어온 트리거**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 밤 10시에 문자 칸으로 시작하는 구매 여정에 테스트 주문을 넣는다 | 그날 밤 문자가 오지 않는다 |
| 2 | 다음날 아침까지 기다린다 | ⑤에서 정한 시각(8시)에 문자 1통 |
| 3 | 밤 10시에 알림톡 칸으로 시작하는 배송 여정에 배송 시작을 넣는다 | 5분 안에 알림톡 1통 |

**시트 7 멈췄다 다시 켜기**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 내일 오후 2시에 2번 칸이 나갈 고객이 있는 여정을 「멈추기」 → 5분 뒤 「다시 켜기」 | 다시 켜진다 |
| 2 | 내일 오후 2시까지 기다린다 | 2번 칸 문자가 내일 오후 2시에 온다(모레가 아니다) |

**시트 8 주간 검사 · 상황판 · 수정안**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 켜진 여정 문자 칸 하나에 스팸으로 걸리는 문구(검수팀이 정해 준 시험 문구)를 넣어 저장해 둔다 | 저장된다 · 몇 분 안에 그 칸에 「스팸 검사에 걸렸어요」가 보인다 · 그 칸 문자는 0통 |
| 2 | 일요일 밤을 지나 월요일 오전 9시까지 기다린다 | 휴대폰에 「한줄로 주간 요약」 1통 · 「스팸 검사에 걸린 칸 1개」 줄 |
| 3 | 요약 문자의 상황판 링크를 연다 | 그 여정 그 칸이 할 일에 있다 · 원문과 수정안이 같이 보인다 |
| 4 | 「이 글로 보내기」를 누른다 | 되묻는 창 → 확인 뒤 「보내기로 했어요」 · 그 칸 문자가 다음 회차에 수정안으로 온다 · 그 전까지 원문 문자는 0통 |
| 5 | 다른 칸에서 「직접 고치기」를 누른다 | 로그인 뒤 그 여정 그 칸 편집이 바로 열린다 |
| — | (A/B 칸이 주간 검사에서만 걸리는 상태는 직원이 만들 수 없다 · 켜기 검사가 같은 글을 먼저 막는다 → A/B 보류 칸 고치기 · 선점 판 확인은 실 PG 시험으로 닫는다 · §7) | — |

**시트 9 두 매장에 같은 번호**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정 고객 두 줄(매장 A · 매장 B · 같은 직원 번호 · 생일 7일 뒤)을 올린다 | 고객 화면에 두 줄 |
| 2 | 생일 D-7 여정을 켜고 다음날 아침까지 기다린다 | 생일 문자 1통(2통 아님) |

**시트 11 신규 가입 여정**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트 몰에서 직원 본인 번호로 회원 가입한다(가입 포인트를 주는 몰 설정 그대로) | 다음날 아침 8시 환영 문자 1통 |
| 2 | 기존 고객 명단 엑셀(시험 번호 500개)을 올린다 | 「새 번호 500명이 환영 문자를 받습니다」 창이 보인다 |
| 3 | [기존 고객으로 올리기]를 누른다 | 다음날 환영 문자 0통(시험 번호 수신 기록 0) |
| 4 | 직원 본인 고객 행을 지우고 같은 번호로 다시 올린다 | 다음날 환영 문자 0통 |

**시트 10 알림톡 칸 켜기**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 템플릿을 고르지 않은 알림톡 칸이 있는 여정을 켠다 | 켜지지 않고 「○번째 칸 알림톡 템플릿을 골라 주세요」가 보인다 |
| 2 | 변수가 있는 알림톡 템플릿을 고르고 그 변수 하나를 연결하지 않은 채 켠다 | 켜지지 않고 「○번째 칸 알림톡 변수를 연결해 주세요」가 보인다 |
| 3 | 변수를 모두 연결하고 켠 뒤 직원 본인 번호로 그 여정을 시작시킨다 | 알림톡 1통 · 빈 자리 없이 값이 다 들어가 있다 |

**시트 12 자동마케팅 「새로 가입한 고객」**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 테스트계정에 기존 고객 명단 엑셀(시험 번호 50개)을 [기존 고객으로 올리기]로 올린다 | 고객 화면에 50줄 |
| 2 | 자동 마케팅을 새로 만들며 대상 「새로 가입한 고객 · 30일」을 고르고 대상 수를 본다 | 대상 수에 방금 올린 50명이 들어 있지 않다 |
| 3 | 테스트 몰에서 직원 본인 번호로 회원 가입한 뒤 대상 수를 다시 본다 | 대상 수가 1 늘어 있다 |

**시트 13 장바구니 변수 · 없는 변수**

| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 신규 가입으로 시작하는 여정 문자 칸에 `%혜택%` 을 넣고 저장 · 켜기를 누른다 | 켜지지 않고 「없는 변수(%혜택%)」가 보인다 |
| 2 | 같은 칸에 `{{ cart.product_name }}` 을 넣고 켜기를 누른다 | 켜지지 않고 「장바구니 여정에서만 쓸 수 있어요」가 보인다 |

## §7 시험

- 실 PG(`npm run test:pg` · 새 파일 `journey-automarketing-core-fix-1102.pg.ts`): 3-1 (c) (d) 두 연결 경합 · 3-2 F + D · 예산 넘은 상태의 사람 승인 회차 = 정한 시각 발송 · 3-3 (c) · 3-4 + 비구매 시작 여정 조건 갈래 · 3-5 (b) + 시스템 멈춤 중 가입 → 재개 → 진입 1 · 사람 멈춤 중 가입 → 재개 → 진입 0 · 사람 멈춤 중 가입 → 재개 → 그 뒤 늦게 적재 → 진입 0 · 시스템 멈춤 중 등급 오름 → 재개 → 진입 1 · 3-6 표 · 3-7 · 3-8 · 3-9 (보류 직후 멈춤 → 다음 분에 후보 이어 만듦 · 후보 검사 중 → 이어 봄 · [이 글로 보내기] 뒤 옛 판 검사 결과 버림 · A/B 보류 칸 고치기 = 저장 · 새 판 · 보류 아닌 A/B 칸 = 409) · 3-17 · 3-18 두 연결(관문 통과 → 보류 + A/B 고치기 → 선점 0).
- 계약 시험(`root-ledger.test.ts` describe R44 ~ R53 · R1 · R5 · R40 넓힘) = §3 각 계약 시험 줄 · 대상은 소스에서 기계로 뽑는다 · 변이(장치를 꺼 봄)로 빨간불 확인.
- CT 계약 시험(3-0 표 14줄 · 새 파일 `journey-automarketing-ct.test.ts`) = 줄마다 「그 판정 · 칸을 CT 파일 밖에서 직접 쓰면 빨간불」 · 패턴 = 3-0 표의 뽑은 패턴 그대로 · 허용 목록 = 줄마다 이유 · 변이 = CT 밖에 인라인 한 줄을 넣은 사본으로 빨간불 확인(파일 복사 변이 · 메모리 「변이 = 파일 복사」).
- 단위 = 백엔드 전체 · tsc 0(백엔드 · 프론트).

## §8 배포

- 한 배포 = C96 + 이 설계(D2 는 C96 배포 전에 반드시 들어간다).
- 순서 = DDL-1 · DDL-2 · 표준 필드 「가입일」 행(배포 앞 · 확인 출력) → C96-DDL-1 이미 끝 → push → 백엔드 · 프론트 build:safe → 재시작(적재 0건 조건) → C96 옛 프로세스 0 → C96-DDL-2A · 2B → 배포 뒤 확인(새 PID ERROR · health · 화면) → 직원 지시문(§6) 실행 → 결과로 닫기.

## §9 설계 구조체크 기록

### 1회차(1102 · 주재자 · 흐름 표 이음매 대상)

| # | 이음매 | 결과 |
|---|---|---|
| SC-1 | D3 회차 키 ↔ AI 최적 시각 | 최적 시각은 회차마다 다르다 → 키를 발송 시각이 아니라 **일정의 그 회차 시각**으로 정함(위 3-1 반영) |
| SC-2 | D3 ② ↔ 리마인드 | 리마인드(`is_reminder`) = 키 관문 밖(별개 발송 · 1293 · 1588 과 같은 제외) |
| SC-3 | B-D 안내 ↔ 자동 예약 회차 안내(1841) | 두 곳에서 보내면 두 통 → 생성 때 안내를 패스로 옮김(한 곳) · 원장 `admin_notified_at` 그대로 |
| SC-4 | D6 ① 실행기 보류 ↔ 보내기 전 검사 보류 기록 | 같은 기록 문장 · 같은 안내 원장을 써야 안내 두 통 0 · 판 = 최신 스냅샷(`stepHeldSql` 판 대조와 같다) |
| SC-5 | D1 ① ↔ 사람 멈춤 두 입구(`routes/ai.ts:4386` · `journey-pause-handler.ts:302`) · 계보 멈춤(`journey-lineage.ts:346`) | 멈추기 경로가 화면 본문 사유를 그대로 써서 글자 판정이 화면 손에 있었다 → 사람 멈춤 = 서버 상수(3-5 반영) · 계보 멈춤은 받은 사유 그대로 · `journey-pause-handler.ts:320` `pauseJourney` = 가져다 쓰는 곳 0(죽은 내보내기 · 계약 시험 추출 대상에는 남긴다) |
| SC-6 | D1 ② ↔ 사건 커서 축(도착) | 커서를 두면 멈춘 동안 도착분이 그대로 읽힌다 · 72시간 넘은 것은 기존 나이 거름이 뺀다 · 원장 문(매장 구매)은 창 끝 = 오늘 0시라 그대로 |
| SC-7 | D7 ① ↔ 결제 전 주문(order_placed) | 시작 사건은 purchase 만 · `netPurchaseSql` 이 purchase 이름을 이미 본다(둘이 겹쳐도 같은 답) |
| SC-8 | D2 ↔ D1 | (1102 밤 Harold 결정으로 관문을 없애 이음매 없음 · 3-6) · 신규 판정 ↔ 원장 멱등 = 원장 번호 거름은 그대로 두고 가입 근거만 더한다(지웠다 다시 올리기 = 원장 번호로 막힘) |
| SC-9 | D4 ↔ C96 하루 묶음 | 진입이 빨라지면 그날 안에 들어와 하루 묶음이 갈리는 면이 준다(같은 방향) |

결함 = 0(1회차 · 처방에 반영). 2회차 = Codex 설계 리뷰 앞에 전문 다시 대조.

### 2회차(1102 밤 · 주재자 · 처방끼리 맞물리는 이음매 · 코드 대조)

| # | 이음매 | 결과 |
|---|---|---|
| SC-10 | 3-9 주간 검사 ↔ A/B 칸 | 보류 · 판 = 칸 단위(`stepHeldSql` = 칸의 최신 판 · `journey-pretest-notifier.ts:66-76`) · 변이 칸은 지금도 수정안을 안 만든다(369-373) · 켜진 여정 A/B 고치기는 늘 막힘 → 이대로면 걸린 A/B 칸을 고치려면 여정 전체를 멈춰야 함(§0-1 3 과 어긋남) → **보류 칸만 A/B 저장 허용 + 새 판 한 트랜잭션**(3-9 반영) |
| SC-11 | 3-9 [이 글로 보내기] ↔ D14 409 · 판 확인 쓰기 | 쓰기 = 자동 반영 갈래와 같은 `recordIfCurrent`(newBody · candidatePassed) · 사람 클릭에서만 · 변이 칸은 수정안이 없어 D14 와 부딪히지 않음(3-9 반영) |
| SC-12 | 3-9 ↔ D6 · D9 | 채울 자리 · 없는 변수 판은 유료 검사 전에 보류(검사 0원 · 3-9 반영) |
| SC-13 | 3-9 ↔ 검사 줄 · 이어 보기 | 한 번에 하나 · 끝 기다림(줄 밀림 경보 0 · 사람 줄 우선 그대로) · 7일 이어 보기는 넘기지 않음(지난주 결과 재사용 0) · 보류 재검사와 겹쳐도 같은 글 = 한 번(3-9 반영) |
| SC-14 | 3-9 이어 하기 ↔ 재시작 · 배포 | 진행 = DB(이번 주 시작 뒤 결정 기록) · 프로세스 기억 0(3-9 반영) |
| SC-15 | 3-10 8시 ↔ 「다음 평일」 | 같은 상수를 쓰는 「다음 평일」이 하루 묶음에서만 8시가 됨(바로 갈래 9시 · 화면 「09시」) → 「다음 평일」 = 9시 상수 따로(3-10 반영) |
| SC-16 | 3-10 ⑥ 밤 알림톡 ↔ 대체 문자 | 게이트웨이가 바로 대체 문자를 보냄 · 직접 쓴 대체 문안(A · B)은 검수 밖 문자 → 그 칸은 문자 시각 규칙(3-10 반영) · 템플릿 글 대체(S · L) · 대체 없음 = 밤 바로 |
| SC-17 | 3-11 알림톡 정보성 ↔ 피로도 기록 | 기록 = `c.isAd` 일 때만(1193) → 판정 한 곳으로 같이 닫힘(3-11 반영) |
| SC-18 | 3-12 D8 ↔ ⑧ · 3-10 | 때가 된 실행의 새 시각 = 칸 채널을 받는 같은 시각 함수(문자 = 밤이면 8시 · 알림톡 = 바로 · 3-12 반영) |
| SC-19 | 3-5 ② ↔ 다시 켜기 창 | 창이 멈춘 이유 종류를 이미 받음(`useJourneyActions.tsx:102-113`) → 종류별 한 줄(3-5 반영) · 72시간 넘은 사건 = 지금 나이 거름 |
| SC-20 | 3-6 ↔ 싱크 incremental 「처음 보는 번호」 | 고객 유일 키가 매장별 → 다른 매장 행으로 들어온 단골이 신규로 잡힐 뻔함 → 기준 = 회사 전체 번호(3-6 반영) |
| SC-21 | 3-6 엑셀 묻기 ↔ 올리기 단계 | 올리기 = 고르기 → 칸 맞추기 → 확인(`/validate-mapping`) → 저장(`/save`) · 묻는 자리 = 확인 응답 · 저장이 고른 값을 받음(3-6 반영) |
| SC-22 | 3-6 ↔ 기준선 원장(켜기 · 떼기) | 원장은 그대로(덜 보내는 쪽 · 3-6 반영) |
| SC-23 | 3-13 없는 변수 ↔ 치환 함수 | 판정 목록 ≠ 치환 목록이면 재발 → 판정 = `messageUtils` 같은 쪼개기 · 같은 매핑(3-13 반영) |
| SC-24 | 3-17 같은 번호 ↔ 진행 보장 | 건너뛴 실행을 다음 칸으로 넘기면 같은 사람이 다른 날 남은 칸을 받음 → 그 실행 끝냄(3-17 반영) |
| SC-25 | 3-15 클릭 판정 ↔ 판 바꾸기(모양 바꾸기) | 진행 중 실행은 옛 판에서 끝까지(옛 칸 id 그대로) · 클릭 사건의 칸 id = 그 실행이 받은 칸 → 어긋남 0 |
| SC-26 | D20 ↔ 운영자 점검 · 대상 고르기 화면 | 쓸 수 있는가 · 사유 = `resolveSegmentAvailability` 한 곳 → 화면 잠금 · 사유 그대로 보임 |
| SC-27 | ③ · ④ ↔ 3-1 · 3-2 | ③ = 3-2 B 그대로 · ④ = 3-1 ② 그대로(어긋남 0) |

결함 = 0(2회차 · 처방에 반영). 다음 = Codex 설계 리뷰(이 문서 + 장부 + 처방이 닿는 소스 · approve 까지).

### Codex 설계 1R(1102 밤 · needs-attention · high 5 · medium 3 · 전부 수용)

| # | 지적 | 판정 · 같은 뿌리? | 반영 |
|---|---|---|---|
| 1 | 묶음 안 번호 거름이 「대표 발송 뒤 · 중복 끝내기 전」 멈춤을 못 견딤 | 수용 · 새 뿌리(R52) 안 · 판정 자리를 효과 뒤(실행기)에 둔 것이 원인 | 3-17 = 진입 자리 한 곳(넣는 문장 `NOT EXISTS` · 기존 계보 잠금) · 실행기 번호 거름 만들지 않음 |
| 2 | 관문 뒤 A/B 고치기가 끼면 검사 전 글 발송 | 수용 · R47(판정이 효과 자리에 없다) | 3-18 선점 문장에 판 id 조건 · 단위 보류 확인은 그 조건으로 옮겨 지움 |
| 3 | `NOT EXISTS` 가 동시 회차 생성을 막지 못함 | 수용 · R46 안 | 3-1 ③ 회차 잠금 + 잠금 안 재확인 · 교체 · 넣기 |
| 4 | 다시 켤 때 기준선 재적재 = 시스템 멈춤 중 가입자 영구 제외 | 수용 · R45 안(② 와 같은 뿌리 · 커서만 보고 기준선을 못 봤다) | 3-5 ② · 3-6 기준선 = 처음 · 사람 멈춤 · 초안 · 떼기만 · 신규 = 기준선 시각 이후 + 72시간 |
| 5 | D7 조건 칸 · 기다리기 · 이력 판정 빠짐 | 수용 · R1 안(장부 D7 넓힘을 처방이 덜 덮음) | 3-4 ④ + 사건 이름 비교 한 조각 · 계약 시험 = 문자 · 매개변수 둘 다 추출 |
| 6 | 예약 발송 앞 예산 관문이 공통 정책 밖 | 수용 · R44 안 | 3-2 A 부르는 자리 셋 |
| 7 | 보류 기록만으로 주간 일 완료 = 수정안 유실 | 수용 · R48 안 | 3-9 끝난 칸 = 수정안 일까지 |
| 8 | [이 글로 보내기] 쓰기 정의 충돌 · 같은 판 본문 덮기 | 수용 · R5 · 고객 문안 불변 | 3-9 `applyPassedCandidate` 한 트랜잭션 · 보내기 전 검사 자동 반영 삭제 · `newBody` 삭제 |

같은 부류 반복 = 1 · 2 · 3 이 「판정과 효과가 같은 원자 경계에 없다」 한 부류 → 개별 덧대기 대신 판정을 효과 문장 · 기존 잠금 안으로 옮김(새 장치 = 회차 잠금 하나 · 지운 장치 = 실행기 번호 거름 계획 · 단위 보류 확인 · `newBody`).

### Codex 설계 2R(1102 밤 · needs-attention · high 3 · medium 1 · 전부 수용)

| # | 지적 | 판정 · 같은 뿌리? | 반영 |
|---|---|---|---|
| 1 | 검사 대기(스냅샷 읽기)와 판 id(관문)가 다른 시점 값 → 그 사이 새 판이 끼면 검사 전 변이 발송 | 수용 · **1R #2 와 같은 부류(두 번째)** → 개별 수정 금지 · 왜 반복: 「보낼 수 있는 판인가」를 세 번 다른 시각에 읽었다 | 3-18 = 판정 조각 하나(`stepSendableSql` · 최신 판 = 읽은 판 · 신뢰도 100 · 보류 아님) · 결정 = 선점 문장 한 곳 · 앞 읽기는 빠른 길 · 단위 확인 지움 |
| 2 | 회차 잠금 밖 승인이 재확인과 교체 사이에 낌 | 수용 · **1R #3 과 같은 부류(두 번째)** → 왜 반복: 잠금이 「읽은 상태를 쓰기 조건에 넣지 않는」 쓰기를 대신하지 못한다 | 3-1 ③ 만료 = 본 id 조건 + 돌아온 수 = 본 수일 때만 INSERT · 만료를 INSERT 앞으로 |
| 3 | 날짜 기준 여정에 진행 중 실행 NOT EXISTS → 다음 칸 영구 누락 | 수용 · 1R #1 처방이 시작 종류마다 「한 사람 한 통」의 단위가 다르다는 것을 못 봄 | 3-17 = 사건 · 상태는 진행 중 실행 · 날짜 기준 · 한 번 보내기는 (칸 · 날 · 번호) 표식 |
| 4 | 사람 멈춤 중 가입 + 재개 뒤 늦은 적재 = 환영 문자 | 수용 · 1R #4 처방의 빈칸(원장은 그때 있는 행만) | 3-5 ② = 기준선을 심는 때 기준 시각도 지금으로 · 시스템 멈춤 재개 = 그대로 |

2R 의 1 · 2 = 같은 부류 두 번째 → 판정 자리를 하나로 줄이는 구조 처방(덧댄 조건 0 · 지운 확인 1). 3R 대상 = 이 표의 반영 줄 + 직접 닿는 소스.

### Codex 설계 3R(1102 밤 · needs-attention · high 1 · 수용 · 처방은 추천과 다르게)

| # | 지적 | 판정 | 반영 |
|---|---|---|---|
| 1 | 날짜 기준 (칸 · 날 · 번호) 표식이 그때 번호를 남기지 않아 · 두 회차 경합 + 그사이 번호 수정이면 같은 번호 두 통 | 수용(경합 실재 · 「이미 뽑았나」 확인이 잠금 밖 `journey-anchor-scheduler.ts:172` · 251) · 추천(표식에 번호 칸 · 새 유일 색인 · 실행 수신 번호 = 표식 번호)은 불수용 — 근거: 뽑기를 (칸 · 날)마다 한 번으로 만들면 회차 사이 번호 이력이 필요 없고, 수신 번호를 표식에 묶으면 번호를 바꾼 고객에게 옛 번호로 보낸다(다른 사람이 받는다) | 3-17 = 「이미 뽑았나」를 계보 잠금 안에서 다시 봄(한 번 보내기와 같은 꼴) · 그 한 문장 안 번호 한 행 · 「같은 번호 표식」 조각 삭제(CT-J4) |

같은 부류 = 「한 사람 = 한 통」 축 세 번째(1R #1 실행기 거름 · 2R #3 날짜 기준 단위 · 3R #1 회차 경합). 왜 반복: 진입 갈래마다 중복 판정 자리를 따로 정했다(어떤 갈래는 넣는 문장 · 어떤 갈래는 잠금 밖 확인). **구조 규칙 하나로 묶는다 = 「진입 회차의 쓰기(넣기 · 표식 · 상한 멈춤 · 커서)는 모든 갈래가 계보 잠금 안에서 판정과 함께 한다(판정 = CT-J4 조각 · 잠금 밖 확인 · 셈은 빠른 길일 뿐 · ★ 4R #1 로 상한 멈춤까지 넓힘)」** — 사건 · 상태 = 넣는 문장 `NOT EXISTS` · 날짜 기준 · 한 번 보내기 = 잠금 안 「이미 뽑았나」 + 한 문장 번호 한 행. 계약 시험 = `INSERT INTO journey_executions` 전수가 같은 트랜잭션에서 `lockLineageEntry`(또는 그것을 부르는 `lockEntryIfActive`) 뒤에 있고, 판정 조각이 그 뒤에 있다(소스 추출 · 순서 검사).

### Codex 설계 4R(1102 밤 · 첫 실행 모델 혼잡 중단 · 재실행 needs-attention · high 2 · medium 1 · 전부 수용)

| # | 지적 | 판정 · 같은 뿌리? | 반영 |
|---|---|---|---|
| (중단분) | CT-J3 에서 `customer-purchase-aggregates.ts:50` = 웹훅 누계 표식 보호 장치 · 결제 판정을 씌우면 환불 뒤 보호 풀림 | 수용 · 분류 잘못(손 분류를 줄 단위로 안 열었다) | CT-J3 줄 = 자리마다 줄 번호와 판정 / 관측 이유 |
| 1 | 날짜 기준 · 한 번 보내기 상한 멈춤이 잠금 앞 → 정상 넣은 여정을 뒤 회차가 멈춤 | 수용 · 3R 구조 규칙(진입 회차 쓰기 = 잠금 안)의 빈칸 · 멈춤이 「넣기」 밖의 쓰기라 규칙 문장에서 빠졌다 | 3-17 순서 = 잠금 → 이미 뽑았나 → 상한 → 넣기 · 구조 규칙 문장을 「진입 회차의 쓰기 전부」로 넓힘 |
| 2 | CT-J2 를 쓰기 함수로 모으면 자리마다 조건 · 함께 쓰는 칸이 사라짐 · 되돌리기 쓰기 빠짐 | 수용 · CT 의 모양 잘못(판정 · 칸 소유 ≠ 문장 소유) | CT-J2 = SET 조각 · 자리 문장 · 조건 그대로 · 빠진 자리(`status = $4::text`) 추출 패턴에 더함 |
| 3 | 개인화 시각의 클릭 = 활동 관측 | 수용 · 분류 잘못(1554 를 줄 단위로 안 열었다) | CT-J9 허용 목록 · 이유 |

같은 부류 = 중단분 · 3 이 「편입표 분류를 패턴 수로만 하고 줄을 안 열었다」 한 부류 → 5R 전에 3-0 표 14줄의 쓰는 곳을 전부 줄 단위로 열어 판정 / 관측 / 쓰기를 다시 적는다(주재자 · 아래 「3-0 줄 단위 대조」).

### Codex 설계 5R(1102 밤 · **approve** · 지적 0)

「지정된 설계 반영분은 4R 지적 4건을 해소 · 기존 조건 · 초안 복귀 · 집계 단위를 보존한다는 계약에서 새 차단 결함 없음」. 설계 닫힘 → 다음 = 직원 지시문 엑셀(구현 전) → 구현(tdd · CT 먼저) → 계약 시험 · 실 PG → Codex 구현.

## §10 구현 진행(1102 밤~ · CT 먼저 · CT 마다 = 만들기 → 쓰는 곳 전수 배선 → CT 밖 0 계약 시험 → 변이 빨간불 · Harold 「컨트롤타워를 만든 것들은 그 함수를 쓰는 것들을 전수 점검해서 배선 확실하게」)

| CT | 상태 | 배선(쓰는 곳 · 뽑은 패턴) | 시험 · 변이 |
|---|---|---|---|
| CT-J7 보낼 시각 | 끝 | `send-time-util.ts` = 밤 도착(발송 창 시작 · 8시) · 다음 평일 9시 따로 · 밤 예외 칸(정보성 알림톡 · 보내지 않는 칸) · 발송 창 판정 · 다음날 창 · 문구 함수 / 옮긴 사본 3(실행기 `sendWindowState` · `isWithinSendHours` · `computeNextSendWindow` · `nextDayWindowStart` · 자동 캠페인 `isWithinSendHours`) · `autosend-policy isSendableHourKst` = CT 본문 호출 / 넘기는 자리 = 진입 감시 2 · 재진입 · 다음 칸 2 · 분기 · 날짜 기준 2 · 그래프 문구 · 트리거 문구 · 정책 응답(`businessDayHour`) / 허용 = 순수 판정 함수에 설정값을 넘기는 자리 15 · 설정값 표기 문구 | `journey-automarketing-core-1102.test.ts` CT-J7 6 + 배선 4 · 변이 5 빨간불 · 옛 시험(묶음 발송) 9시 → 8시 · verify 스크립트 둘 8시 |
| CT-J2 여정 멈춤 | 끝 | `journey-pause-reason.ts` `pausedSetSql` · `pausedCaseSetSql` · `MANUAL_PAUSE_REASON` · `ANCHOR_COMPLETED_PAUSE_REASON` · `pauseReasonView`(상수 먼저 · 마침 종류) / 바꾼 쓰기 = 켜기 · 날짜 기준 4(마침 · 상한 2 · 되돌리기 CASE) · 실행기 · 계보 · 재진입 · 진입 감시(세대 비교 그대로) / 사람 멈춤 입구 2 = 상수(화면 본문 사유 버림) / 지운 것 = `journey-pause-handler.ts` 죽은 `pauseJourney` | CT-J2 4 · 변이 3 빨간불 · 옛 멈춤 · 계보 · 날짜 기준 · 재진입 · 켜기 시험 20파일 229 통과 |

| CT-J1 보낼 판 | 끝 | 판 읽기 = `latestSnapshotSql`(journey-step-versions) · 선점 WHERE = `stepSendableSql`(읽은 판 id) · 단위 보류 확인 지움 · 상황판 · 정지 화면 · 후보 · 주간 고르기 | 계약 · 실 PG 3-18(다른 연결이 새 판 커밋 = 거짓) |
| CT-J3 결제된 구매 | 끝 | `netPurchaseSql` · `cdpEventNameMatchSql` 25자리(진입 커서 · 조건 · 기다리기 · 목표 · 이력 · 통계 · 성과 · 예측 · 캘린더 · 인앱) · 3-4 ② `ENTRY_PURCHASE_VOIDED_SQL`(구매로 시작한 여정 · 칸 처리 앞 · 실패 = 던짐) | 계약 · 변이 · 실 PG(취소 = ended · order_cancelled · 가입 여정 조건 갈래 · 커서) · **별칭 정합 계약 새로**(1103 실 PG 가 `journey-opportunities` `FROM customers c` + `customers.joined_at` 결함을 잡음 → 조각 이름 = 그 문장이 정한 이름 · 변이 2) |
| CT-J4 날짜 기준 · 한 번 보내기 | 끝 | 빠른 길 → 잠금 → 이미 뽑았나 → 상한 셈 · 멈춤(트랜잭션) → 넣기 · D18 = 결함 아님(3-17) | 실 PG 두 연결 = 한 번 · 뽑은 뒤 상한 넘음 = 멈춤 0 · 2칸 여정 |
| CT-J5 알림톡 칸 | 끝 | `kakaoStepVerdict`(켜기 · 검증 · 실행기) · 정보성 칸 수신 거름 = 활성 · 번호 유효(§4 ⑦ · 칸 단위 · 진입 거름 그대로) | 계약 · 실 PG 문장 |
| CT-J8 광고 · CT-J9 클릭 | 끝 | 알림톡 = 늘 정보성 · `journeyStepIsAdSql` · 화면 사본 / `journeyClickSql`(목표 · 옛 조건 · 이 칸 링크 · 통계 4) | 실 PG = 조건 두 꼴 · 목표 · 통계 · 지도 |
| CT-J10 보낼 글 | 끝 | 켜기 · 검증 · 켜진 칸 **사람이 고칠 때만** 409 COPY_ISSUE(1103 · 채우기 길은 판정 밖 = 남은 칸은 실행기 보류) · 보내기 전 검사(유료 앞) · 실행기 보류 · 안내 | 실 PG = 판에 채울 자리 = 보류 · 발송 0 · 409 저장 0 |
| CT-J11 기준선 · 3-5 | 끝 | `reseedOnActivate`(켜기 트랜잭션 · 떼기) · 커서 = 사람 멈춤만 · 멈춤 안내 패스(`journey-pause-notice.ts` · DDL-1 · 7일 기준선) | 실 PG = 안내 1 · 사람 0 · 새 멈춤 1 · 커서 · 가입 시나리오 3 |
| CT-J6 가입 근거 | 끝 | `customer-joined-at.ts` 쓰기(업서트 LEAST · 처음 만든 행 · 몰 회원) · 읽기(`newSignupSql` · **`journeySignupSinceSql` 1103 = 시각 있는 가입 = 기준선 시각 · 날짜뿐 = 그날 KST 시작**(옛 = 모두 그날 시작 → 같은 날 사람 멈춤 · 재개 뒤 늦게 적재된 가입이 들어왔다 · 실 PG 가 확인) · 업로드 한 번 묻기 · 자동마케팅 축 · 추천 · 다음 행동 | 실 PG = 쓰기 표 · 새로 가입 축 = 가입 근거 고객만 · 변이 |
| CT-J12 주간 검사 · 3-9 | 끝 | `journey-weekly-check.ts` · **남은 칸 판정 = `weeklyCheckRows` SQL 한 곳 · LIMIT 앞(1103 · 옛 JS 거름 = 채울 자리 보류 칸을 매분 다시 골라 다른 칸이 영영 밀림 → `week_done` 기록 · `weeklyStepDone` 지움)** · 수정안 = 후보 · [이 글로 보내기] | 실 PG = 한 칸 검사 · 다시 0 · 막힌 칸 앞이어도 다음 칸 · 후보 적용 · stale |
| CT-O1 회차 | 끝 | `operator-round.ts` 회차 키 · 잠금 · 본 id 교체 · 생성 빠른 길 | 실 PG = 보낸 회차 · 대기 회차 = 0 · 두 연결 하나 · 승인 엇갈림 2 |
| CT-O2 상한 갈래 · 3-2 | 끝 | `operatorCapPolicy` · `operatorCapPathOf`(리마인드 = 1차 갈래 1103) · 예약 예산 관문 · 발송 직전 · 승인 = 정한 시각 · 회차 안내(**LIMIT 앞 안내 때 거름 · 시도 상한 3 · 1103**) · 승인 창 = 예산 칸(④) · 상한 칸 읽는 파일 = 이유 붙은 목록(E ⑨) | 실 PG(시연 회사 = 대상 · 상한 · 예산까지 진짜) = 정한 시각 전 · 뒤 · 야간 · 승인 기간 상한 무시 · 예산 · 회사 자율 상한 · 안내 셋 |
| 3-7 · 3-8 · 3-16 | 끝 | 잘린 상태 트리거 = 다음 회차 · 재진입 1시간 · `JOURNEY_COUNT_CAP` · `entryPropsFor` / A/B 칸 409 · 화면 `JourneyAbCopyList` | 실 PG = 3 → 2 · 재진입 포인트 · A/B 409 · 상세 · 보류 칸 A/B |

**구현 중 새로 찾아 같은 배포에 닫은 것(1103)**: ① 추천 집계 SQL 별칭 결함(실 PG) ② 같은 날 사람 멈춤 재개 뒤 늦게 적재된 가입 진입(실 PG) ③ 회차 안내 · 주간 고르기 = LIMIT 뒤 JS 거름(R12 · 자가 검토) ④ 회차 안내 무한 재시도(R8) ⑤ 통과한 글 정기 재검사의 죽은 「확인 못 함」 갈래 지움 ⑥ 사람 승인 회차 안내 문구 「위 문안」 → 「승인하신 문안」.

**Codex 구현 리뷰**

| 라운드 | 지적 | 처리 |
|---|---|---|
| 1R(1103 · 전체 변경분) | 5 = high 2 · medium 3 | #1 사람 승인 예약 = 안내 실패해도 보냄 → **불수용**(3-2 D 「4700 규칙 그대로」 = 사람이 손댄 제안을 덮지 않음 · 검토로 내리면 B-1102-1 되살아남 · 3번 실패 = 운영 경보) · #2 이미 있는 몰 고객 갱신에 가입 시각 없음 → 수용(syncCustomerFields LEAST · 실 PG 주문 먼저 → 회원) · #3 회사 자율이 승인 기간을 덮음 → 수용(승인 기간 먼저) · #4 화면 고객 추가 업서트 · 가입 시각 따로 커밋 → 수용(세 길 한 트랜잭션 · 계약 = 부르는 곳 전부 run) · #5 새 멈춤이 옛 시도 수를 물려받음 → 수용(두 칸 뜻 = 지금 멈춤의 시도 · DDL · 멈춤 쓰기 그대로 · 실 PG) · 같은 뿌리 = #2 · #4 = CT-J6 쓰기 길 전수(UPDATE 갈래 · 원자성)를 계약으로 닫음 |
| 2R(1103 · 증분 = 1R 고친 줄 + 직접 호출부) | 0 · **approve** | 「No material findings」 · 1R #1 불수용 근거에 재지적 없음 · 최종 = backend tsc 0 · frontend tsc 0 · vitest 752파일 11,378 · 실 PG 46파일 315 · 원장 대기 블록 22 통과 |

## §11 ⑨ 두 문 회사 → C99 로 넘김(1103 · 이 배포에 없음)

> Harold 1103 원문: 「둘 다 쓰긴 쓸거야 체크해봐야해」 · 「두문을 다 사용하는 회사 지금 없어 그래서 걱정인거고 이제 생길테니까」 · 「추천대로 정함」 · 「99는 따로 처방하면 되겠다」. 이 배포(C98)는 문 판정을 바꾸지 않는다(지금 동작 = 자사몰 문이 30일 안에 살아 있으면 매장 원장 문을 닫는다).

흐름 표(1103 코드에서 뽑음 · 두 문 회사 = 자사몰 30일 안 주문 + 매장 싱크):

| 갈래 | 자리 | 지금 | 두 문 회사에서 |
|---|---|---|---|
| A 구매 진입 | `journey-purchase-ledger.ts:185-189` · `journey-trigger-watcher.ts:677-678` | 자사몰 문이 살아 있으면 원장 문 통째로 닫음 | 구매 · 첫 구매 · 휴면 복귀 · 상품 재구매 여정에 매장 구매 진입 0 |
| B 고객 구매 요약 칸 | `customer-purchase-aggregates.ts:111-112` · `customer-upsert.ts:107-123` · `cdp-orders.ts:298-305` | 자사몰 매출 표식 회사 = 원장 재계산 건너뜀 · 싱크 원본 요약 칸 = 구매횟수 큰 값 · 누적금액 원본으로 덮음 | 요약 칸이 두 채널 합이 아님 · 자동마케팅 대상(`automarketing-segment.ts:218-440`)이 매장 구매를 모름(어제 매장에서 산 고객에게 휴면 문자) |
| C 자사몰 사건만 읽는 칸 | 조건 칸 `journey-executor.ts:1722-1735` · 기다리기 칸 `:1355-1361` | `cdp_events` 만 | 매장 구매 = 「안 샀음」(매장만 쓰는 회사도 같음) |
| D 문 하나로 보여 주는 자리 | `journey-product.ts:104` · `planner-audience.ts:227-240` · `journey-opportunities.ts:536` · `journey-stats.ts:656` · `routes/ai.ts:4141` | 지금 문 하나 | 매장 상품 고를 수 없음 · 문이 바뀌면 상품 재구매 여정 멈춤(`journey-trigger-watcher.ts:293-296`) |
| 이미 두 문 | `journey-goal-purchase.ts:20-37` · `journey-product.ts:240-256` · `journey-target-extractor.ts:879` · `purchase-history-source.ts` | 두 문 OR · 구매 이력 = 같은 고객 · 같은 날 · 한 행 금액 같음이면 원장 우선 | — |

정함(Harold 1103 「추천대로 정함」):
- ⑨-1 같은 구매 = 같은 고객 · 같은 날(KST) · (한 행 금액 같음 **또는** 그날 합계 같음). 시험 DB 확인(1103): 매장 원장이 상품 줄 단위면 한 행 금액 비교는 같은 주문을 못 잡고 그날 합계 비교는 잡는다. 구매 이력 화면도 이 판정 하나로.
- ⑨-2 고객 구매 요약 칸 세 칸 = 두 문 합(같은 구매 한 번) · 엑셀 · 싱크 원본이 준 값보다 내려가지 않음.
- ⑨-3 상품 = 「자사몰 상품 / 매장 상품」 나눠 함께 보여 줌 · 고른 상품은 그 문에서 재구매 · 문 바뀜 멈춤 없앰.
- 바로 처방: A 문 판정 없앰 · 두 문 다 열고 들어올 때 다른 문에 같은 구매가 있으면 진입 0(양쪽) / C 매장 구매도 구매(진입 다음 날부터 · 목표 판정 규칙).
- 지금 두 문 회사 = 0(Harold 1103) · 납품 고객사 연결 뒤 그 데이터로 ⑨-1 이 실제 겹침을 잡는지 SQL 한 번 → 첫 발송 전.
