# 여정 · 자동마케팅 흐름 표 (2026-11-02 · 결함 대처 피더 1단계)

> 절차 = `status/DEFECT-PLAYBOOK.md` §1 · 결함 장부 = `docs/2026-11-02-journey-automarketing-delivery-check.md`.
> 칸 = 소스에서 기계로 뽑음(패턴 = 아래 §0-1 그대로 · `packages/backend/src` 의 .ts 중 파일 이름 거름 통과 138개 · 시험 파일 · 주석 줄 제외 · 다시 돌릴 때 = 같은 패턴으로 줄마다 정규식 검색).
> 상태 = **칸 10 판정 끝 · 흐름 다섯 이음매 표 끝 · 빈칸 0(§3)** · Harold 확인 대기 · 결함 = D1 ~ D7 + B-1102-1(장부 `docs/2026-11-02-journey-automarketing-delivery-check.md`).

## §1 칸 판정(끝난 칸)

| 칸 | 판정 |
|---|---|
| A 여정 멈춤 쓰기 10곳 | 사람 멈춤 3(`routes/ai.ts:4387` · `journey-pause-handler.ts:320` · `journey-lineage.ts:355`) · 켜기 요청 안 오류 1(`journey-activation.ts:154`) · 날짜 기준 정상 마침 1(`journey-anchor-scheduler.ts:198`) · **시스템 멈춤 5곳(호출 13) = 담당자 안내 0 = D1**(실행기 1888 · 진입 감시 110 · 날짜축 237 · 한 번 보내기 343 · 재진입 173) |
| B 칸 문안 쓰기 3곳 | 칸 고치기 `journey-builder.ts:1417`(켜진 여정 포함 · 채울 자리 판정 0 = D6) · 칸 넣기 1658(켜진 여정 막힘) · 새 판 복제 `journey-lineage.ts:291` |
| C 발송 확정본 쓰기 5곳 | 켜기 스냅샷 `journey-builder.ts:1256`(켜기 검증 뒤) · 고침 스냅샷 1738(신뢰도 0 · 검사 대기) · 보내기 전 검사 결정 `journey-pretest-notifier.ts:688 · 690 · 692`(스팸만 · 채울 자리 판정 0 = D6) |
| D 진입 만들기 5곳 | 진입 감시 `journey-trigger-watcher.ts:83`(일괄) · 888(커서) · 날짜축 `journey-anchor-scheduler.ts:268` · 한 번 보내기 375 · 재진입 `journey-reentry-worker.ts:186`(진입 정보 0 = D5) |
| E 회차 입구 | `generateProposalForOperator` 부르는 곳 3 = 지금 실행(`routes/ai.ts:2394`) · 미리보기 시작(`automarketing-preview.ts:870`) · 워커(`continuous-operator.ts:2510`) · 리마인드 넣기 4423 · 회차 INSERT 1571 |
| G 다음 생성 시각 쓰기 | `updateOperatorAfterRun` 14곳 중 회차를 만든 뒤 = 1893 하나(**지금 기준으로 다시 잼 = D3 자리**) · 나머지 13 = 회차 없음(다시 시도 맞음) · 워커 실패 +30분 2517 · 승인 창 주기 4187 |
| H 양을 자르는 비교 | 고객사가 고른 브레이크(여정 최대 인원 · 예산) = 유지 · 우리가 박은 상한 = 자동마케팅 회사 자율 1,000명 · 5만원(`continuous-operator.ts:1016-1017 · 1550-1562 · 3642-3667` = B-1102-1) · 이상치 관문(`journey-executor.ts:1839-1867` = D2) · 진입 속도(`JOURNEY_COUNT_CAP` 10만/시간 · 재진입 1,000/6시간 = D4) · 넘김만(묶음 1만) |
| F 회차 상태 바꾸기 55곳 | 만들기 = INSERT 1571(대기 · 예약) · 리마인드 4423 / 예약 = 2153(야간 승인 → 아침) · 2708(늦은 검사 통과 회복) · 4478(리마인드) / 보내는 중 = 3258(자동 선점) · 승인 선점(2096 문장) / 보냄 = 3884 · 3147 · 3155(고착 회복) · 3763(시연) / 검토 = 25곳(보류 갈래) / 멈춤 = 876 · 919(운영자 보관 · 닫기) · 3198(운영자 중지) · 3528(리마인드 취소) / 만료 = 1620(**새 회차가 같은 운영자의 대기 · 검토 회차를 만료** = D3 영향: 검사 결과를 기다리던 검토 회차도 사라진다) · 1993(7일) · 2130(승인 때 7일) / 생략 = 3737(0명) · 3826(잔액). 회차 중복 막는 자리(1293-1305 · 1584-1589)는 예약만 본다 · 보냄 · 보내는 중 = 안 본다(D3) |
| J 담당자 안내 43곳 | 자동마케팅 = 기준선 · 판정 불가 · 크레딧 정지 · 첫 회차 멈춤 · 회차 검토 · 추천 문안 + 승인 대기 · 발송 예정 안내(정지 링크) · 회복 안내 원장 · 고착 보류 · 예산 보류 · 발송 보류 · 발송 시작 · 승인 기간 갱신 · 리마인드 · 하루 요약 · 준비 알림 / 플래너 = 승인 · 재확인 / **여정 = 보내기 전 검사 보류 · 지연(`journey-pretest-notifier.ts:527 · 716`) · 칸 결과(`journey-result-notice.ts:225`) · 주간 요약(`manager-weekly-digest.ts:105`)뿐 · 여정 멈춤 안내 0 = D1** |
| I 채울 자리 판정 | 발송 길목 판정 있음 = 직접발송 `direct-send-core.ts:259` · 자동마케팅 `continuous-operator.ts:3475` · 플래너 `planner-executor.ts:407` · **여정 = 켜기 때만(`journey-builder.ts:988` · `journey-pretest-validator.ts:117`) · 보내는 길목 0 = D6** |

## §2 흐름 다섯 · 이음매(쓰는 쪽 → 읽는 쪽 · 판정)

### 흐름 1 가입 환영(하루 묶음 · C96)
| 이음매 | 쓰는 쪽 | 읽는 쪽 | 판정 |
|---|---|---|---|
| 고객 적재 → 수신거부 | `routes/sync.ts:606-1070`(번호 정규화) · 325-347 | 실행기 `journey-executor.ts:738-741 · 799` | 맞음(같은 번호 꼴) |
| 진입 → 그날 묶음 | `journey-trigger-watcher.ts:859-860 · 887-905`(entered_at = 트랜잭션 NOW · `firstRunAtFor`) | `send-time-util.ts:330-378` · 실행기 266-282 | 맞음(같은 시각) |
| 확정본 → 발송 글 | C 칸(켜기 1256 · 고침 1738 · 검사 688-692) | 실행기 552-568 · 렌더 `journey-message-render.ts` | **D6**(고친 글 채울 자리 판정 0) |
| 묶음 관문 | 실행기 680-728 | — | **D2**(이상치 관문 바닥 0 · C96 뒤) |
| 적재 → 확정 → 정산 | `sendUnits` 1098-1182 · `prepaidDeduct` 1121 | `mysql-refund-sweeper.ts:399 · 430-470` | 맞음(불명 = 5분 환불 → 들어감 증명 = 회수) |
| 전진 → 다음 칸 | `advanceExecutions` 1517-1590 | 실행기 다음 회차 | 맞음 |
| 멈춤 → 담당자 | A 칸 시스템 멈춤 5곳 | J 칸 | **D1** |
| 끝 → 재진입 | `journey-reentry-worker.ts:186-191` | 목표 판정 1699-1708 | **D5**(진입 정보 0) · **D4**(1,000/6시간) |

### 흐름 2 구매 즉시(첫 구매 · 주문 완료 · 상품 · 휴면 복귀 · 배송)
| 이음매 | 쓰는 쪽 | 읽는 쪽 | 판정 |
|---|---|---|---|
| 몰 주문 → 구매 사건 | `cdp-orders.ts:207-330`(결제 = purchase · 취소 · 환불 = 같은 사건에 revenue_reversed · cancel_seen_at) | 여정 커서 `journey-target-extractor.ts:756-765`(event_name 만) | **D7**(취소 · 환불 주문도 진입 · 판정 조각 `netPurchaseSql` 미사용 · R1) |
| 매장 구매 → 원장 문 | `routes/sync.ts:1075-1309` | `journey-trigger-watcher.ts:669-746`(창 끝 = 오늘 0시 · 09 ~ 12시 · 나이 = 도착) | 맞음(B-1101-7 ③④ C93 닫음) |
| 진입 뒤 취소 → 남은 칸 | 위 취소 표식 | 실행기 · 목표 판정(`journey-goal-purchase.ts:19-36`) | **D7**(취소를 읽는 자리 0 · 리뷰 요청 · 재구매 권유가 계속 나감) |
| 커서 · 진입 한 번 | `finishCursorBatch` 554-660 | — | 맞음(진입 + 커서 한 트랜잭션) |

### 흐름 3 날짜 · 상태 트리거(생일 · 포인트 소멸 · 휴면 · 지정일 · 한 번 보내기)
| 이음매 | 쓰는 쪽 | 읽는 쪽 | 판정 |
|---|---|---|---|
| 상태 트리거 진입 | `journey-trigger-watcher.ts:334-408`(10만 · 1시간) | 실행기 | **D4**(속도 · 버림 0) |
| 지정일 · 한 번 보내기 | `journey-anchor-scheduler.ts:223-298 · 306-403`(한 문장 전원 · 표식) | 실행기 단발 전진 | 맞음 · 대량 멈춤 = D1 |
| 한 번 보내기 정산 · 회복 | 512-650(잠금 안 다시 판정) | — | 맞음 |

### 흐름 4 운영 중 수정 · 멈춤 · 재개 · 새 모양
| 이음매 | 쓰는 쪽 | 읽는 쪽 | 판정 |
|---|---|---|---|
| 화면 저장 → 칸 고침 | `JourneyWorkspace.tsx:553-600`(검사 = 빈 글 · 제목 · 사진) → `routes/ai.ts:3532` → `applyStepPatchInLock` | 스냅샷 1738 → 스캐너 `processBundle` | **D6** |
| 변이 | `bandit-optimizer.ts:539 · 603`(켜진 여정 막음) | — | 맞음 |
| 멈춤 → 재개 | 사람 멈춤 3곳 · 시스템 멈춤 5곳 | `journey-resume.ts:85-105`(밀린 칸 하루 단위로 밂 · **사건 커서를 재개 시각으로**) | 사람 멈춤 = 맞음 · **시스템 멈춤 = D1(무안내 + 그동안 사건 빠짐)** |
| 새 모양 | `journey-reshape.ts:125-172` | 켜기 검증(채울 자리 포함) | 맞음 |

### 흐름 5 자동마케팅 회차
| 이음매 | 쓰는 쪽 | 읽는 쪽 | 판정 |
|---|---|---|---|
| 등록 · 미리보기 시작 · 지금 실행 → 회차 | E 칸 입구 3 | `generateProposalForOperatorRound` 1232-1899 | **D3**(1893 다음 생성 시각 = 지금 기준 · 같은 발송 시각 회차 두 번 · 막는 자리 = 예약만 봄 · 새 회차가 검토 회차 만료) |
| 회차 자격 · 발송 직전 상한 | 1547-1567 · 3628-3710 | 화면 `OperatorPreviewModal.tsx:642-646` · `OperatorsManageList.tsx:64` | **B-1102-1**(리마인드 4478 → 발송 직전 상한도 같은 자리) |
| 승인 → 발송 | `approveProposal` 2075-2185 | `ContinuousOperatorPage.tsx:540-543` | **B-1102-1**(즉시 발송) |
| 검사 → 예약 · 보류 · 회복 | 1655-1862 · 2608-2794 | 발송 패스 2800-2866 | 맞음 |
| 발송 → 돈 | 3779-3887(엄격 차감 → 캠페인 → 마커) | 되돌림 3083 · 고착 복구 3101 · 정산 3024 | 맞음 |
| 결과 → 다음 회차 | `settlePendingCycleSnapshots` 2922-2981 | 다음 회차 대상 | 맞음 |
| 발송 전 안내 · 미승인 안내 | `sendAutoSendPrepNotice` 4673(자동 예약 회차만 · 1841) | 둘째 접수 기대 | B-1102-1 설계에 넣는다 |

## §3 빈칸 확인

- 칸 A ~ J = 기계 추출 줄 전부 판정(§1 · 원문 §0).
- 흐름 다섯 = 이음매마다 쓰는 쪽 · 읽는 쪽 파일:행 · 판정(§2) · 처음 표에서 빈칸이었던 넷(주문 취소 · 새 모양 · 리마인드 · 회차 마감)은 읽고 채움(취소 = D7 새로 나옴).
- 빈칸 = 0. 범위 밖(이번 흐름 표에 넣지 않은 것) = 마케팅 플래너 · 자동발송(auto-campaign) · 대행발송 · AI 문안 생산자 안쪽(11/01 구조체크 · C89 · C91 대상 · 출구 → 저장 → 관문 이음매는 위에 있음).

## §0-1 추출 패턴(원문)

```python
CELLS = [
    ('A 여정을 멈추는 자리(여정 · 실행 상태 = paused)', [
        r"UPDATE journeys SET status = 'paused'",
        r"UPDATE journeys\s*$",
        r"\bpauseJourney\(",
        r"\bpauseJourneyForCompany\(",
        r"\bautoPauseExecution\(",
        r"SET status = 'paused'",
    ]),
    ('B 여정 칸 문안을 쓰는 자리(journey_steps 문안 · 제목)', [
        r"UPDATE journey_steps SET[^;]*message_template",
        r"message_template = COALESCE",
        r"UPDATE journey_steps\s+SET\s+message_template",
        r"INSERT INTO journey_steps",
    ]),
    ('C 발송 확정본(스냅샷)을 쓰는 자리', [
        r"INSERT INTO journey_step_snapshots",
        r"UPDATE journey_step_snapshots",
    ]),
    ('D 여정 진입(실행 행)을 만드는 자리', [
        r"INSERT INTO journey_executions",
    ]),
    ('E 자동마케팅 회차를 만드는 입구', [
        r"\bgenerateProposalForOperator\(",
        r"INSERT INTO operator_proposals",
    ]),
    ('F 자동마케팅 회차 상태를 바꾸는 자리', [
        r"UPDATE operator_proposals SET status",
        r"UPDATE operator_proposals\s*$",
    ]),
    ('G 운영자 다음 생성 시각을 쓰는 자리', [
        r"next_run_at = \$",
        r"next_run_at = NOW\(\)",
        r"\bupdateOperatorAfterRun\(",
    ]),
    ('H 발송 · 진입 양을 자르는 비교 · 상수', [
        r"cdp_auto_execute_max_(recipients|cost)",
        r"\bJOURNEY_COUNT_CAP\b",
        r"\bPER_JOURNEY_BATCH_LIMIT\b",
        r"\bthreshold_recipients_per_step\b",
        r"\bentryCapExceeded\(",
        r"\bDAILY_VOLUME_GATE_",
        r"\bJOURNEY_STEP_BATCH_MAX\b",
    ]),
    ('I 채울 자리 판정을 부르는 자리', [
        r"\bhasUneditedJourneyPlaceholder\(",
        r"\bhasUneditedPlaceholder\(",
        r"\bfindUneditedSendPlaceholder\(",
        r"\bhasUneditedBenefitPlaceholder\(",
        r"placeholderLeft",
    ]),
    ('J 담당자에게 문자 안내를 보내는 자리', [
        r"\bnotifyOperatorAdmins\(",
        r"\benqueueManagerNotice\(",
        r"\bsendNoticeOnce\(",
        r"\bpickOwnerContact\(",
    ]),
]

FILE_RE = re.compile(r"(journey|operator|automarketing|continuous|autosend|spam|manager|direct-send|bandit|routes[\\/]ai\.ts|routes[\\/]journey|routes[\\/]manager|routes[\\/]autosend|send-placeholder|copy-finish|operator-final-copy|planner)", re.I)

```

## §0 기계 추출 원문

### A 여정을 멈추는 자리(여정 · 실행 상태 = paused) — 36곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `routes/ai.ts:4387` |  | `const ok = await pauseJourney(companyId, req.params.id, reason);` |
| `utils/journey-activation.ts:154` |  | ``UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $3, updated_at = NOW()` |
| `utils/journey-anchor-scheduler.ts:198` |  | ``UPDATE journeys SET status = 'paused', paused_at = NOW(),` |
| `utils/journey-anchor-scheduler.ts:237` |  | ``UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()` |
| `utils/journey-anchor-scheduler.ts:343` |  | ``UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()` |
| `utils/journey-builder.ts:2045` | 정의 | `export async function pauseJourney(companyId: string, journeyId: string, reason?: string): Promise<boolean> {` |
| `utils/journey-executor.ts:981` |  | `await pauseJourney(head.journey_id, out.pauseText);` |
| `utils/journey-executor.ts:985` |  | `await autoPauseExecution({` |
| `utils/journey-executor.ts:990` |  | `console.warn(`[JourneyExecutor] autoPauseExecution(${out.autoPause}) 사고 (skip):`, apErr?.message);` |
| `utils/journey-executor.ts:1087` |  | `await autoPauseExecution({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: gave[0]` |
| `utils/journey-executor.ts:1088` |  | `await pauseJourney(head.journey_id, '통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)');` |
| `utils/journey-executor.ts:1125` |  | `await pauseJourney(head.journey_id, deduct.error \|\| '잔액 부족');` |
| `utils/journey-executor.ts:1128` |  | `await autoPauseExecution({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: claimed` |
| `utils/journey-executor.ts:1130` |  | `console.warn(`[JourneyExecutor] autoPauseExecution(balance_insufficient) 사고 (skip):`, apErr?.message);` |
| `utils/journey-executor.ts:1254` |  | `await autoPauseExecution({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: e.execu` |
| `utils/journey-executor.ts:1255` |  | `await pauseJourney(head.journey_id, '통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)');` |
| `utils/journey-executor.ts:1301` |  | `await autoPauseExecution({ companyId: head.company_id, journeyId: head.journey_id, stepId: step.id, executionId: first.e` |
| `utils/journey-executor.ts:1302` |  | `await pauseJourney(head.journey_id, '통신사 일시 발송 실패 (자동 재시도 1회 후에도 fail)');` |
| `utils/journey-executor.ts:1872` |  | `await pauseJourney(head.journey_id, text);` |
| `utils/journey-executor.ts:1886` | 정의 | `async function pauseJourney(journeyId: string, reason: string): Promise<void> {` |
| `utils/journey-executor.ts:1888` |  | ``UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()` |
| `utils/journey-executor.ts:1938` |  | `await autoPauseExecution({` |
| `utils/journey-executor.ts:1946` |  | `await pauseJourney(exec.journey_id, '조건 평가 DB 오류 (자동 재시도 후에도 실패)');` |
| `utils/journey-lineage.ts:355` |  | ``UPDATE journeys j SET status = 'paused', paused_at = NOW(), pause_reason = $3, updated_at = NOW()` |
| `utils/journey-pause-handler.ts:320` | 정의 | `export async function pauseJourney(` |
| `utils/journey-pause-handler.ts:327` |  | ``UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()` |
| `utils/journey-pause-handler.ts:337` | 정의 | `export async function autoPauseExecution(params: {` |
| `utils/journey-pause-handler.ts:357` |  | ``UPDATE journey_executions SET status = 'paused' WHERE id = $1`,` |
| `utils/journey-reentry-worker.ts:173` |  | ``UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $3, updated_at = NOW()` |
| `utils/journey-trigger-watcher.ts:106` | 정의 | `async function pauseJourneyForCompany(journeyId: string, companyId: string, reason: string, expect: StartExpect): Promis` |
| `utils/journey-trigger-watcher.ts:110` |  | ``UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $3, updated_at = NOW()` |
| `utils/journey-trigger-watcher.ts:284` |  | `await pauseJourneyForCompany(j.id, j.company_id, `상품 재구매 설정 오류: ${why}`, startExpectOf(j));` |
| `utils/journey-trigger-watcher.ts:288` |  | `await pauseJourneyForCompany(j.id, j.company_id, '구매가 들어오는 곳이 바뀌어(자사몰 · 매장) 고른 상품을 알아볼 수 없어요. 상품을 다시 골라 새로 만들어 주세요.', st` |
| `utils/journey-trigger-watcher.ts:322` |  | `await pauseJourneyForCompany(j.id, j.company_id, `신규 고객 판정 불가: ${judgement.reason}`, startExpectOf(j));` |
| `utils/journey-trigger-watcher.ts:380` |  | `const paused = await pauseJourneyForCompany(` |
| `utils/journey-trigger-watcher.ts:570` |  | `const paused = await pauseJourneyForCompany(` |

### B 여정 칸 문안을 쓰는 자리(journey_steps 문안 · 제목) — 3곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `utils/journey-builder.ts:1417` |  | `message_template = COALESCE($4, message_template),` |
| `utils/journey-builder.ts:1658` |  | ``INSERT INTO journey_steps (` |
| `utils/journey-lineage.ts:291` |  | ``INSERT INTO journey_steps` |

### C 발송 확정본(스냅샷)을 쓰는 자리 — 5곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `utils/journey-builder.ts:1256` |  | ``INSERT INTO journey_step_snapshots` |
| `utils/journey-builder.ts:1738` |  | ``INSERT INTO journey_step_snapshots` |
| `utils/journey-pretest-notifier.ts:688` |  | `await run(`UPDATE journey_step_snapshots SET message_body = $2, confidence_score = 100 WHERE id = $1::uuid`, [testedSnap` |
| `utils/journey-pretest-notifier.ts:690` |  | `await run(`UPDATE journey_step_snapshots SET confidence_score = 100 WHERE id = $1::uuid AND confidence_score < 100`, [te` |
| `utils/journey-pretest-notifier.ts:692` |  | `await run(`UPDATE journey_step_snapshots SET confidence_score = 0 WHERE id = $1::uuid`, [testedSnapshotId]);` |

### D 여정 진입(실행 행)을 만드는 자리 — 5곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `utils/journey-anchor-scheduler.ts:268` |  | `INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, create` |
| `utils/journey-anchor-scheduler.ts:375` |  | ``INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, creat` |
| `utils/journey-reentry-worker.ts:186` |  | ``INSERT INTO journey_executions` |
| `utils/journey-trigger-watcher.ts:83` |  | ``INSERT INTO journey_executions (` |
| `utils/journey-trigger-watcher.ts:888` |  | ``INSERT INTO journey_executions (id, journey_id, customer_id, current_step_order, status, entered_at, next_run_at, creat` |

### E 자동마케팅 회차를 만드는 입구 — 6곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `routes/ai.ts:2394` |  | `const proposal = await generateProposalForOperator(req.params.id);` |
| `utils/automarketing-preview.ts:870` |  | `proposal = await generateProposalForOperator(operator.id, useResult ? { precomputed: useResult, variantIndex: vi } : und` |
| `utils/continuous-operator.ts:1211` | 정의 | `export async function generateProposalForOperator(operatorId: string, opts?: { precomputed?: any; variantIndex?: number ` |
| `utils/continuous-operator.ts:1571` |  | ``INSERT INTO operator_proposals (` |
| `utils/continuous-operator.ts:2510` |  | `await generateProposalForOperator(row.id);` |
| `utils/continuous-operator.ts:4423` |  | ``INSERT INTO operator_proposals (` |

### F 자동마케팅 회차 상태를 바꾸는 자리 — 55곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `utils/continuous-operator.ts:876` |  | `const cancelSql = `UPDATE operator_proposals SET status = 'admin_stopped', scheduled_send_at = NULL, reviewed_at = NOW()` |
| `utils/continuous-operator.ts:919` |  | ``UPDATE operator_proposals SET status = 'admin_stopped', scheduled_send_at = NULL, auto_execute_reason = $2, reviewed_at` |
| `utils/continuous-operator.ts:1620` |  | ``UPDATE operator_proposals SET status = 'expired'` |
| `utils/continuous-operator.ts:1775` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:1806` |  | ``UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL, auto_execute_re` |
| `utils/continuous-operator.ts:1816` |  | ``UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL, auto_execute_re` |
| `utils/continuous-operator.ts:1856` |  | ``UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:1993` |  | ``UPDATE operator_proposals SET status = 'expired'` |
| `utils/continuous-operator.ts:2130` |  | ``UPDATE operator_proposals SET status = 'expired'` |
| `utils/continuous-operator.ts:2153` |  | ``UPDATE operator_proposals SET status = 'scheduled', scheduled_send_at = $2` |
| `utils/continuous-operator.ts:2165` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:2208` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2236` |  | `? `UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2240` |  | `: `UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2325` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2391` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2663` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2708` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2727` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2763` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2777` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:2824` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 준비 오류. 담당자 검` |
| `utils/continuous-operator.ts:2989` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:3006` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:3147` |  | ``UPDATE operator_proposals SET status = 'sent', auto_sent_at = COALESCE(auto_sent_at, NOW())` |
| `utils/continuous-operator.ts:3155` |  | ``UPDATE operator_proposals SET status = 'sent', auto_sent_at = COALESCE(auto_sent_at, NOW())` |
| `utils/continuous-operator.ts:3165` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:3198` |  | ``UPDATE operator_proposals SET status = 'admin_stopped', scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:3220` |  | ``UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:3249` |  | ``UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:3258` |  | ``UPDATE operator_proposals SET status = 'sending', reviewed_at = NOW()` |
| `utils/continuous-operator.ts:3289` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = $2` |
| `utils/continuous-operator.ts:3304` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '예산 검증 오류. 담당자 검` |
| `utils/continuous-operator.ts:3415` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '요금제` |
| `utils/continuous-operator.ts:3426` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '광고 ` |
| `utils/continuous-operator.ts:3443` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = 'MMS` |
| `utils/continuous-operator.ts:3459` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '고른 ` |
| `utils/continuous-operator.ts:3467` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발신번` |
| `utils/continuous-operator.ts:3477` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:3490` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_executed = false,` |
| `utils/continuous-operator.ts:3510` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:3528` |  | ``UPDATE operator_proposals SET status = 'admin_stopped', scheduled_send_at = NULL, reviewed_at = NOW(),` |
| `utils/continuous-operator.ts:3597` |  | ``UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:3619` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '고객별` |
| `utils/continuous-operator.ts:3685` |  | ``UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL,` |
| `utils/continuous-operator.ts:3737` |  | `await query(`UPDATE operator_proposals SET status = 'skipped', auto_execute_reason = $2 WHERE id = $1::uuid`, [proposalI` |
| `utils/continuous-operator.ts:3746` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 ` |
| `utils/continuous-operator.ts:3763` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:3784` |  | ``UPDATE operator_proposals` |
| `utils/continuous-operator.ts:3820` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_executed = false, aut` |
| `utils/continuous-operator.ts:3826` |  | `await query(`UPDATE operator_proposals SET status = 'skipped', auto_execute_reason = '잔액 부족으로 발송 생략' WHERE id = $1::uuid` |
| `utils/continuous-operator.ts:3830` |  | `await query(`UPDATE operator_proposals SET status = 'admin_review', scheduled_send_at = NULL, auto_execute_reason = '발송 ` |
| `utils/continuous-operator.ts:3884` |  | ``UPDATE operator_proposals SET status = 'sent', auto_sent_at = NOW() WHERE id = $1::uuid AND status = 'sending'`,` |
| `utils/continuous-operator.ts:4478` |  | ``UPDATE operator_proposals SET status = 'scheduled', auto_executed = true,` |
| `utils/continuous-operator.ts:4702` |  | ``UPDATE operator_proposals SET status = 'admin_review', auto_executed = false, scheduled_send_at = NULL,` |

### G 운영자 다음 생성 시각을 쓰는 자리 — 24곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `utils/continuous-operator.ts:1252` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1282` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1287` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1303` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1335` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1370` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1396` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1403` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1417` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1467` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1479` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1493` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1610` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 0);` |
| `utils/continuous-operator.ts:1893` |  | `await updateOperatorAfterRun(operator.id, operator.schedule, operator.scheduleTime, 1, autoExecuteEligible);` |
| `utils/continuous-operator.ts:1945` | 정의 | `async function updateOperatorAfterRun(` |
| `utils/continuous-operator.ts:1972` |  | `next_run_at = $2,` |
| `utils/continuous-operator.ts:2517` |  | ``UPDATE continuous_operators SET next_run_at = NOW() + INTERVAL '30 minutes', updated_at = NOW()` |
| `utils/continuous-operator.ts:4187` |  | `sets.push(`schedule = $${params.length - 3}`, `schedule_day_of_week = $${params.length - 2}`, `schedule_day_of_month = $` |
| `utils/journey-executor.ts:606` |  | `await query(`UPDATE journey_executions SET next_run_at = $2 WHERE id = ANY($1::uuid[]) AND status = 'active'`, [ids, at]` |
| `utils/journey-executor.ts:610` |  | `await query(`UPDATE journey_executions SET next_run_at = NOW() + ($2 \|\| ' minutes')::interval WHERE id = ANY($1::uuid[])` |
| `utils/journey-executor.ts:1240` |  | `next_run_at = NOW() + INTERVAL '5 minutes',` |
| `utils/journey-executor.ts:1287` |  | `next_run_at = NOW() + INTERVAL '5 minutes',` |
| `utils/journey-executor.ts:1637` |  | `await query(`UPDATE journey_executions SET current_step_order = $2, next_run_at = $3 WHERE id = ANY($1::uuid[])`, [ids, ` |
| `utils/journey-executor.ts:1926` |  | `next_run_at = NOW() + INTERVAL '5 minutes',` |

### H 발송 · 진입 양을 자르는 비교 · 상수 — 57곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `routes/ai.ts:3931` |  | ``SELECT status, trigger_filters, trigger_event, allow_reentry, reentry_cooldown_days, threshold_recipients_per_step` |
| `routes/ai.ts:3975` |  | `threshold_recipients_per_step: 'thresholdRecipients' in body ? norm.options.thresholdRecipients : cur.threshold_recipien` |
| `routes/ai.ts:3986` |  | `const cap = merged.threshold_recipients_per_step;` |
| `routes/ai.ts:4060` |  | `if ('thresholdRecipients' in body) add('threshold_recipients_per_step', norm.options.thresholdRecipients);` |
| `utils/automarketing-preview.ts:512` |  | `maxRecipients: Number(loaded.ctx.cdp_auto_execute_max_recipients) \|\| 0,` |
| `utils/automarketing-preview.ts:513` |  | `maxCost: Number(loaded.ctx.cdp_auto_execute_max_cost_krw) \|\| 0,` |
| `utils/continuous-operator.ts:984` |  | `cdp_auto_execute_max_recipients: number;` |
| `utils/continuous-operator.ts:985` |  | `cdp_auto_execute_max_cost_krw: number;` |
| `utils/continuous-operator.ts:1016` |  | `COALESCE(c.cdp_auto_execute_max_recipients, 1000) AS cdp_auto_execute_max_recipients,` |
| `utils/continuous-operator.ts:1017` |  | `COALESCE(c.cdp_auto_execute_max_cost_krw, 50000) AS cdp_auto_execute_max_cost_krw,` |
| `utils/continuous-operator.ts:1550` |  | `recipientCount <= ctx.cdp_auto_execute_max_recipients &&` |
| `utils/continuous-operator.ts:1551` |  | `costEstimate <= ctx.cdp_auto_execute_max_cost_krw &&` |
| `utils/continuous-operator.ts:1561` |  | `recipientCount > ctx.cdp_auto_execute_max_recipients && `${recipientCount}건 > ${ctx.cdp_auto_execute_max_recipients}`,` |
| `utils/continuous-operator.ts:1562` |  | `costEstimate > ctx.cdp_auto_execute_max_cost_krw && `${costEstimate}원 > ${ctx.cdp_auto_execute_max_cost_krw}원`,` |
| `utils/continuous-operator.ts:3642` |  | ``SELECT COALESCE(c.cdp_auto_execute_max_recipients, 1000) AS max_recipients,` |
| `utils/continuous-operator.ts:3643` |  | `COALESCE(c.cdp_auto_execute_max_cost_krw, 50000) AS max_cost,` |
| `utils/journey-anchor-scheduler.ts:59` |  | `threshold_recipients_per_step: number \| null;` |
| `utils/journey-anchor-scheduler.ts:111` |  | `trigger_filters, threshold_recipients_per_step` |
| `utils/journey-anchor-scheduler.ts:231` |  | `const cap = j.threshold_recipients_per_step;` |
| `utils/journey-anchor-scheduler.ts:235` |  | `if (cap != null && entryCapExceeded(cap, null, ids.length)) {   // 날짜축 = 하루 몫 없음(정한 날 한 번에)` |
| `utils/journey-anchor-scheduler.ts:310` |  | ``SELECT id, company_id, trigger_filters, one_shot_scheduled_at, threshold_recipients_per_step, status, start_kind${track` |
| `utils/journey-anchor-scheduler.ts:337` |  | `const cap = j.threshold_recipients_per_step;` |
| `utils/journey-anchor-scheduler.ts:341` |  | `if (cap != null && entryCapExceeded(cap, null, ids.length)) {   // 날짜축 = 하루 몫 없음(정한 날 한 번에)` |
| `utils/journey-builder.ts:424` |  | `threshold_recipients_per_step, threshold_cost_per_step, threshold_risk_level,` |
| `utils/journey-builder.ts:700` |  | `threshold_recipients_per_step: number \| null;` |
| `utils/journey-builder.ts:749` |  | `j.trigger_event, j.threshold_recipients_per_step,` |
| `utils/journey-builder.ts:825` |  | `threshold_recipients_per_step: row.threshold_recipients_per_step,` |
| `utils/journey-executor.ts:104` |  | `threshold_recipients_per_step: number \| null;` |
| `utils/journey-executor.ts:230` |  | `export const JOURNEY_STEP_BATCH_MAX = 10_000;` |
| `utils/journey-executor.ts:300` |  | `j.budget_monthly, j.threshold_cost_per_step, j.threshold_recipients_per_step,` |
| `utils/journey-executor.ts:313` |  | `[grp.journey_id, grp.current_step_order, JOURNEY_STEP_BATCH_MAX],` |
| `utils/journey-executor.ts:319` |  | `if (!out.progressed \|\| rows.length < JOURNEY_STEP_BATCH_MAX) doneGroups.add(key);` |
| `utils/journey-executor.ts:1839` |  | `export const DAILY_VOLUME_GATE_FACTOR = 3;` |
| `utils/journey-executor.ts:1840` |  | `export const DAILY_VOLUME_GATE_MIN_DAYS = 7;` |
| `utils/journey-executor.ts:1867` |  | `if (r.rows[0]?.gated \|\| days < DAILY_VOLUME_GATE_MIN_DAYS \|\| today <= maxPrev * DAILY_VOLUME_GATE_FACTOR) {` |
| `utils/journey-lifecycle-map.ts:580` |  | `allow_reentry, auto_reentry_enabled, threshold_recipients_per_step, updated_at${lineageReady ? ', lineage_id, entry_clos` |
| `utils/journey-lifecycle-map.ts:739` |  | `thresholdRecipients: r.threshold_recipients_per_step != null ? Number(r.threshold_recipients_per_step) : null,` |
| `utils/journey-reentry-worker.ts:46` |  | `const PER_JOURNEY_BATCH_LIMIT = 1000;  // 한 journey당 1 cron 진입 영역 limit (큰 회사 영역 분산 정합)` |
| `utils/journey-reentry-worker.ts:91` |  | ``SELECT id, company_id, reentry_cooldown_days, threshold_recipients_per_step, trigger_event, trigger_filters` |
| `utils/journey-reentry-worker.ts:117` |  | `const cap = j.threshold_recipients_per_step != null ? Number(j.threshold_recipients_per_step) : null;` |
| `utils/journey-reentry-worker.ts:119` |  | `let pickLimit = cap != null ? cap + 1 : PER_JOURNEY_BATCH_LIMIT;` |
| `utils/journey-reentry-worker.ts:134` |  | `if (room != null) pickLimit = Math.max(0, Math.min(room, cap ?? room, PER_JOURNEY_BATCH_LIMIT));` |
| `utils/journey-reentry-worker.ts:170` |  | `if (cap != null && entryCapExceeded(cap, backfill, picked.length)) {` |
| `utils/journey-reentry-worker.ts:181` |  | `const ids = picked.slice(0, PER_JOURNEY_BATCH_LIMIT);   // 회차 상한(남은 분 = 다음 회차 · 완료가 이른 순)` |
| `utils/journey-simulator.ts:51` |  | ``SELECT id, trigger_event, trigger_filters, threshold_recipients_per_step FROM journeys WHERE id = $1::uuid AND company_` |
| `utils/journey-simulator.ts:103` |  | `const cap = journey.threshold_recipients_per_step != null ? Number(journey.threshold_recipients_per_step) : null;` |
| `utils/journey-simulator.ts:106` |  | `if (firstRoundIsMatched && entryCapExceeded(cap, backfill, matched)) {` |
| `utils/journey-step-limits.ts:60` | 정의 | `export function entryCapExceeded(cap: number \| string \| null \| undefined, backfill: number \| null, candidates: number): ` |
| `utils/journey-target-extractor.ts:925` |  | `export const JOURNEY_COUNT_CAP = 100000;` |
| `utils/journey-trigger-watcher.ts:32` |  | `import { selectJourneyTargetCustomerIds, selectAfterJourneyCandidates, selectCdpEventRowsForCursor, selectPurchaseLedger` |
| `utils/journey-trigger-watcher.ts:69` |  | `threshold_recipients_per_step: number \| null;` |
| `utils/journey-trigger-watcher.ts:193` |  | `threshold_recipients_per_step, last_event_cursor` |
| `utils/journey-trigger-watcher.ts:334` |  | `const cap = j.threshold_recipients_per_step;` |
| `utils/journey-trigger-watcher.ts:335` |  | `let extractLimit = cap != null ? Number(cap) + 1 : JOURNEY_COUNT_CAP;` |
| `utils/journey-trigger-watcher.ts:379` |  | `if (entryCapExceeded(cap, backfill, ids.length)) {` |
| `utils/journey-trigger-watcher.ts:568` |  | `const cap = j.threshold_recipients_per_step;` |
| `utils/journey-trigger-watcher.ts:569` |  | `if (entryCapExceeded(cap, backfillPerDayOf(j), ids.length)) {` |

### I 채울 자리 판정을 부르는 자리 — 22곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `utils/continuous-operator.ts:2110` |  | `if (!approvedFinal \|\| approvedFinal.placeholderLeft) {` |
| `utils/continuous-operator.ts:2205` |  | `if (!final \|\| !final.body.trim() \|\| final.placeholderLeft \|\| finalCopyCleared(pj, final).ok) continue;` |
| `utils/continuous-operator.ts:2308` |  | `if (hasUneditedBenefitPlaceholder(rawBody) \|\| hasUneditedBenefitPlaceholder(rawSubject)) {` |
| `utils/continuous-operator.ts:3475` |  | `if (!final \|\| !final.body.trim() \|\| final.placeholderLeft) {` |
| `utils/copy-finish.ts:57` |  | `if (hasUneditedJourneyPlaceholder(text) \|\| hasUneditedJourneyPlaceholder(input.subject \|\| '')) items.push({ key: 'placeh` |
| `utils/direct-send-core.ts:259` |  | `const sendPh = findUneditedSendPlaceholder(spec.message, spec.subject, spec.alimtalkNextContents, spec.alimtalkNextSubje` |
| `utils/journey-builder.ts:171` | 정의 | `export function hasUneditedPlaceholder(message: string \| null \| undefined): boolean {` |
| `utils/journey-builder.ts:173` |  | `return hasUneditedJourneyPlaceholder(message);` |
| `utils/journey-builder.ts:988` |  | `if (hasUneditedPlaceholder(msg)) {` |
| `utils/journey-pretest-validator.ts:117` |  | `if (hasUneditedJourneyPlaceholder(msg.body)) {` |
| `utils/operator-check.ts:53` |  | `if (f.fixedBody && hasUneditedBenefitPlaceholder(f.fixedBody)) add('benefit', 'fix', '혜택 자리', '문안에 혜택 자리가 그대로 있어요. 혜택을 적` |
| `utils/operator-final-copy.ts:29` |  | `placeholderLeft: boolean;` |
| `utils/operator-final-copy.ts:81` |  | `placeholderLeft: hasUneditedBenefitPlaceholder(body) \|\| hasUneditedBenefitPlaceholder(subject),` |
| `utils/planner-copy.ts:369` |  | `if (!draft \|\| !draft.body.trim() \|\| hasUneditedBenefitPlaceholder(draft.body) \|\| hasUneditedBenefitPlaceholder(draft.sub` |
| `utils/planner-copy.ts:473` |  | `if (hasUneditedBenefitPlaceholder(text)) throw new PlannerCopyEditError(400, 'PLACEHOLDER', '채워지지 않은 자리가 남아 있습니다. 혜택 문구를` |
| `utils/planner-executor.ts:407` |  | `if (hasUneditedBenefitPlaceholder(finalBody) \|\| hasUneditedBenefitPlaceholder(subject)) {` |
| `utils/planner-recheck.ts:157` |  | `if (hasUneditedBenefitPlaceholder(input.text) \|\| hasUneditedBenefitPlaceholder(input.subject)) return 'placeholder';` |
| `utils/planner-recheck.ts:370` |  | `if (hasUneditedBenefitPlaceholder(text)) throw new PlannerRecheckError(400, 'PLACEHOLDER', '채워지지 않은 자리가 남아 있습니다. 혜택 문구를 ` |
| `utils/planner-recheck.ts:635` |  | `if (draft && draft.body.trim() && !hasUneditedBenefitPlaceholder(draft.body)) {` |
| `utils/send-placeholder-gate.ts:29` | 정의 | `export function findUneditedSendPlaceholder(` |
| `utils/send-placeholder-gate.ts:46` | 정의 | `export function hasUneditedJourneyPlaceholder(text: string \| null \| undefined): boolean {` |
| `utils/send-placeholder-gate.ts:54` | 정의 | `export function hasUneditedBenefitPlaceholder(text: string): boolean {` |

### J 담당자에게 문자 안내를 보내는 자리 — 43곳

| 파일:행 | 구분 | 줄 |
|---|---|---|
| `routes/autosend-stop-public.ts:30` |  | `await notifyOperatorAdmins(mapRowToOperator(r.rows[0]), title, body);` |
| `utils/continuous-operator.ts:887` |  | `await notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:938` |  | `await notifyOperatorAdmins(op, '[AI 자동마케팅] 확인 필요',` |
| `utils/continuous-operator.ts:1272` |  | `void notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:1318` |  | `const notified = await notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:1328` |  | `const failNotified = await notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:1461` |  | `await notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:1824` |  | `await notifyOperatorAdmins(operator, '[AI 자동마케팅] 첫 회차 멈춤',` |
| `utils/continuous-operator.ts:1831` |  | `await notifyOperatorAdmins(operator, '[AI 자동마케팅] 이번 회차 검토 필요', isFixedCopy` |
| `utils/continuous-operator.ts:1873` |  | `await notifyOperatorAdmins(operator, '[AI 자동마케팅] 추천 문안', finalNoticeCopy);` |
| `utils/continuous-operator.ts:1875` |  | `await notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:2761` |  | `const result = await sendNoticeOnce({` |
| `utils/continuous-operator.ts:2774` |  | `return notifyOperatorAdmins(op, String(row.n?.title \|\| '[AI 자동마케팅] 안내'), String(row.n?.body \|\| ''));` |
| `utils/continuous-operator.ts:3176` |  | `await notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:3293` |  | `await notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:3354` |  | `notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:4237` |  | `const sent = await notifyOperatorAdmins(op, '[AI 자동마케팅] 다음 승인 요청', buildRenewalNoticeBody({` |
| `utils/continuous-operator.ts:4330` |  | `await notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:4373` |  | `notifyOperatorAdmins(notifyCtx, title, body)` |
| `utils/continuous-operator.ts:4531` | 정의 | `export async function notifyOperatorAdmins(` |
| `utils/continuous-operator.ts:4556` |  | `const fallback = await pickOwnerContact(operator.companyId, operator.createdBy \|\| null);` |
| `utils/continuous-operator.ts:4628` |  | `sent = await notifyOperatorAdmins(operator, copy ? copy.title : '[AI 자동마케팅] 발송 대상 없음', body);` |
| `utils/continuous-operator.ts:4685` |  | `await notifyOperatorAdmins(operator, '[AI 자동마케팅] 발송 예정 문안', messageBody);` |
| `utils/continuous-operator.ts:4689` |  | `const infoSent = await notifyOperatorAdmins(` |
| `utils/journey-notice-once.ts:29` | 정의 | `export async function sendNoticeOnce(steps: NoticeOnceSteps): Promise<NoticeOnceResult> {` |
| `utils/journey-pretest-notifier.ts:527` |  | `const result = await sendNoticeOnce({` |
| `utils/journey-pretest-notifier.ts:540` |  | `return notice ? enqueueManagerNotice(notice, b.companyId) : true;   // 받을 담당자 없음 · 시연 회사 = 보낼 것 없음(마감)` |
| `utils/journey-pretest-notifier.ts:716` |  | `const ok = await enqueueManagerNotice(notice, b.companyId);` |
| `utils/journey-pretest-notifier.ts:732` |  | `const contact = await pickOwnerContact(b.companyId, b.createdBy \|\| null);` |
| `utils/journey-pretest-notifier.ts:769` | 정의 | `async function enqueueManagerNotice(notice: ManagerNotice, companyId: string): Promise<boolean> {` |
| `utils/journey-result-notice.ts:186` |  | `const owner = await pickOwnerContact(row.company_id, row.created_by \|\| null);` |
| `utils/journey-result-notice.ts:225` |  | `const result = await sendNoticeOnce({` |
| `utils/manager-weekly-digest.ts:83` |  | `const contact = await pickOwnerContact(companyId, o.created_by ? String(o.created_by) : null);` |
| `utils/manager-weekly-digest.ts:105` |  | `return sendNoticeOnce({` |
| `utils/operator-daily-recap.ts:59` |  | `await notifyOperatorAdmins(` |
| `utils/operator-prep-reminder.ts:60` |  | `const sent = await notifyOperatorAdmins(` |
| `utils/operator-prep-reminder.ts:138` |  | `const sent = await notifyOperatorAdmins(` |
| `utils/planner-approval.ts:225` |  | `if (!alreadyCancelled \|\| refunded) await notifyOperatorAdmins(` |
| `utils/planner-recheck.ts:563` |  | `const contact = await pickOwnerContact(p.ev.companyId, p.ev.createdBy).catch(() => null);` |
| `utils/planner-recheck.ts:578` |  | `const sent = await notifyOperatorAdmins(` |
| `utils/planner-recheck.ts:598` |  | `const contact = await pickOwnerContact(p.ev.companyId, p.ev.createdBy).catch(() => null);` |
| `utils/planner-recheck.ts:602` |  | `const sent = await notifyOperatorAdmins(` |
| `utils/planner-touchpoint.ts:621` |  | `return await notifyOperatorAdmins(` |
