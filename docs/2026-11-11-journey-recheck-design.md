# 여정 재점검 — 재진입 관문의 남은 구멍 넷 + %변수% 남은 출구 (C126 · 2026-11-11)

> 경위 = 1111 Harold 「어제 여정관련 결함수정한거 다시 정합성있게 코드 재 확인하고 설계부터 코덱스 리뷰 돌려서 전부 닫히면 넘어가는걸로 구현까지 다시 한번 총 체크」 → 「처방안 보고하지말고 전체 다 완벽하게 고치고 … 수정한것도 코덱스리뷰 닫힐때까지」.
> 대상 = 1110 에 나간 여정 수정 둘: C123 재진입 대기 최솟값(`5ed096e5` · 설계서 `docs/2026-11-10-journey-reentry-floor-design.md`) · C122 ④ 여정 문안 %변수% 통일(`23ede51c`).
> 절차 = `status/DEFECT-PLAYBOOK.md` · 뿌리 = `docs/ROOT-LEDGER.md` R87(넓힘) · R12(잠금 밖 판정 · 재발) · R90(새 · 같은 설정값의 기준 시각) · R91(새 · 여정 AI 글의 변수 꼴).
> 재점검 방법 = 직접 대조(C123 처방 1 ~ 16 ↔ 코드 · 실행 종결 UPDATE 전수 · 여정 AI 글 출구 전수) + Codex 설계 재리뷰 1R(높음 2 · 중간 1 · 기준 어긋남 1) → 수정 설계 2R(높음 5 · 중간 2) · 3R(높음 2 · 중간 2 = 교체가 멈춘 실행을 목표 달성으로 닫으면 뒤 여정이 열림 · 토큰 집합 비교는 조건의 적용 대상을 못 지킴 · 빈 칸 다듬기의 평문화가 승인 혜택을 지움 · 워커 시험이 잠금 밖 읽기를 못 잡음) · 4R(높음 2 · 중간 1 = 평문 결과의 조기 통과가 태그 삭제를 허용 · AI 수정이 다른 칸을 근거로 고름 · 빈 원문의 조각 사실 검사가 승인 혜택을 거부) · 5R(중간 2 = 토큰 비교의 공백 접기가 따옴표 안 값까지 접음 · 조각 숫자 검사의 「이번 달」 예외) · 6R(중간 1) · 7R(중간 1) = 조각 숫자 대조의 예외 · 정규식 경계가 세 번 되풀이 → **규칙을 줄였다: 조건 태그가 든 글은 AI 가 고치지 않는다**(조각 대조 · `findNewNumbers` 손대기를 설계에서 뺌) · 8R(높음 1 = 대조 뒤의 글자 정리가 조건식을 바꾸거나 새 문법을 만든다 → 출구 직전 최종 글에 같은 규칙을 한 번 더) · 9R(높음 1 = 최종 대조가 전송자 명칭 붙이기보다 앞 → 생산자가 돌려주는 글이 마지막으로 바뀐 뒤로). 2R 내용 = (사건 커서 · 교체의 멈춘 실행 · 워커 잠금 안 읽기 범위 · 워커 관문의 대기일 · 커서의 「가장 최근」 · 대기일 상한 · 고치기의 새 문법 면제 · 고치기 평문화의 내용 삭제).

## 0 실측 · 코드 사실

| # | 사실 | 근거 |
|---|---|---|
| K1 | 서버 배포본 = `0c955aab`(1111 13:55 · C123 · C122 코드 포함) | `status/DEPLOY-LEDGER.md` 머리 |
| K2 | C123 처방 1 ~ 16 은 코드에 설계서대로 들어가 있다(계약 필수 칸 · `reentryHoldSql` · 뽑기 8곳 · 감시 넣기 가드 · 워커 · 켜기 · 옵션 저장 · 만들기 올림 · 상세 응답 · 화면) | 직접 대조 1111 · Codex 재리뷰 ⑥ ~ ⑧ |
| K3 | 실행을 **종결**로 바꾸는 UPDATE = 전부 `completed_at = NOW()` 를 같이 쓴다(ended 8곳 · goal_met 2곳 · completed) | `grep "UPDATE journey_executions"` = `journey-executor.ts:528, 562, 606, 995, 1493, 1629` · `journey-pause-handler.ts:253` · `journey-resume.ts:54` · `journey-lineage.ts:398, 449` · `journey-entry-replace.ts:20` |
| K4 | **멈춘(paused) 실행**만 끝난 시각 없이 상태가 바뀐다 = 다시 켜면 되살아나는 미완료 상태(`RESUME_REVIVE_SQL` paused → active) · 사람 정지가 겹친 칸은 멈춘 채 남는다 | `journey-pause-handler.ts:339` · `journey-resume.ts:28-43` |
| K5 | 자동 멈춤 = 실행 멈춤(커밋) → 여정 멈춤(별도 문장) 두 걸음 · 뒤 걸음이 실패하면 삼킨다 → 여정은 켜진 채 멈춘 실행이 남을 수 있다 | `journey-executor.ts:1024, 1120-1121, 1162, 1294-1295, 1341-1342, 1915-1925` |
| K6 | `reentryHoldSql` = `status = 'active'` 또는 `COALESCE(completed_at, entered_at)` 가 최솟값 안 → 멈춘 실행은 **들어온 시각**으로 판정된다 | `journey-safety-filter.ts:68-73` |
| K7 | 자동 재진입 워커 = 여정 목록(시작 사건 · 대기일 · 재진입 허용)을 잠금 **밖**에서 읽고, 잠금 안에서는 켜짐 · 자동 켬만 다시 본다 | `journey-reentry-worker.ts:92-111, 137-139` · `journey-lineage.ts:159-167` |
| K8 | 켜진 여정의 시작 사건은 그 자리에서 바뀐다(떼기 = 앞 여정을 마치면 → 원래 시작 · 붙이기 = 반대) · 재진입 값은 그대로 · 검증 없음 · 시작 설정 세대(`start_gen`)를 올린다 | `journey-attach.ts:291-322` |
| K9 | 「고른 고객에게」 뽑기 = 재진입 설정과 무관하게 **실행이 하나라도 있으면** 뺀다 · 감시 묶음 넣기 가드 = 재진입 허용이면 `reentryHoldSql`(최솟값 0 = 진행 중만) | `journey-target-extractor.ts:437-447` · `journey-trigger-watcher.ts:853, 911-914` |
| K10 | 묶음 넣기는 대조군이면 `holdout` 으로 넣는다(진행 중 아님) · 대조군도 하루 몫에 든다 | `journey-trigger-watcher.ts:902-908` · `journey-step-limits.ts:67-80` |
| K11 | 화면 = 「다시 들어오게 하기 — 여정을 **마친** 고객이 다시 조건에 맞으면 또 받아요」 · 「**마친 뒤** [N]일 지나면」 | `JourneyStartCard.tsx:275-279` |
| K12 | 저장 대기일 판정 = 뽑기(대기 > 0 갈래) · 사건 커서 모두 **들어온 시각** 기준 · 자동 재진입 워커만 끝난 시각 기준 | `journey-safety-filter.ts:108` · `journey-trigger-watcher.ts:980-1004` · `journey-reentry-worker.ts:153` |
| K13 | 여정 AI 글은 전부 출구 `finishCopy · finishMany` 를 지난다(검사 + 표식 · 글을 바꾸지 않는다 · 생산자 이름 열) — 생산자 = 여정 만들기(`journey-package`) · 기념일 칸(`journey-anchor-plan`) · 직접 만든 칸(`journey-custom-steps`) · 다음 칸 추천(`journey-next-step`) · 칸 다듬기(`journey-step-refine`) · 스팸 재작성(`journey-pretest-regen`) · AI 수정(`journey-ai-edit`) · A/B 문안(`variant-generator`) | `utils/copy-finish.ts` · `grep "producer: '"` |
| K14 | C122 ④ 는 앞 넷에만 `liquidCopyToPercent` 를 넣었다 · 뒤 넷은 AI 가 낸 템플릿 문법이 그대로 응답 · 저장된다(어제 설계서도 「남은 자리」로 기록) | `grep liquidCopyToPercent` = `journey-ai-generator.ts:660-661, 1080-1081` · `journey-builder.ts:675` · `journey-step-diagnosis.ts:421-422` · `docs/2026-11-10-journey-reentry-floor-design.md` §9 #8 |
| K15 | 뒤 넷 중 셋은 **기존 글을 고치는** 자리다(다듬기 = 본문이 있으면 고치기 · 없으면 새로 쓰기) · 스팸 재작성 지시문은 원문의 템플릿 문법을 「정확히 보존」하라고 한다(장바구니 여정 · 1110 전 여정) | `journey-ai-generator.ts:845-1010, 1213, 1225` · `journey-ai-editor.ts:232-275` · `variant-generator.ts:62-195` |
| K16 | 사건 커서 진입 = 사건 하나에 실행 하나(사건 키가 관문) · 재진입 허용 여정은 **같은 판의 진행 중 실행이 있어도** 새 사건이면 들어온다(다른 판의 진행 중만 막는다) · 진입 교체 여정만 진행 중 실행을 닫고 새로 넣는다(닫는 대상 = `active` 만) | `journey-trigger-watcher.ts:616-647, 955-977` · `journey-entry-replace.ts:19-21` |
| K17 | 저장 대기일은 365일을 넘을 수 있다 — 만들기 주소는 받은 값을 그대로 넘기고 만들기는 최솟값만 올린다 · 옵션 저장만 0 ~ 365 로 접는다 | `routes/ai.ts:3402` · `journey-builder.ts:376, 411` · `journey-options-validator.ts:95-97` |
| K18 | `liquidCopyToPercent` 는 「새로 만드는 여정 문안 출구만」 부르게 돼 있다(「다듬기 · 스팸 회피 다시 쓰기는 원문 보존이라 부르지 않는다」) — 고치기에 같은 변환을 걸면 원문의 조건문이 접힌다 | `liquid-templating.ts:186-196` 주석 |

## 1 미가입 · 직접발송만 쓰는 회사 = 변화 0 증명

| 확인 | 결과 |
|---|---|
| 바뀌는 파일 | 여정 전용(`journey-safety-filter` 의 재진입 조각 · `journey-target-extractor` 재진입 호출 · `journey-trigger-watcher` 넣기 가드 · 쿨다운 · `journey-reentry-worker` · `journey-lineage` 넣기 관문 · `journey-trigger-capability` · `journey-ai-generator` · `journey-ai-editor` · `variant-generator` · `liquid-templating` 에 함수 하나 추가) |
| 직접발송 · 캠페인 · 정산 · 큐 CT | 수정 0 · `liquidCopyToPercent` · `flattenLiquidToPlainText` · `renderLiquid` 본문 그대로(더하는 함수는 여정 생산자만 부른다) · `buildJourneySafetyFilter` · `isCustomerSendable` 본문 그대로 |
| 여정 = 요금제 기능 | 여정 주소 전부 `journeyGate` 뒤 · 미가입 회사는 여정이 없다 |
| DDL · ENV | 0 |

## 2 흐름 표

### 2-1 실행이 새로 생기는 자리 × 「이미 있는 실행」을 보는 판정

| 단계 | 쓰는 쪽 | 읽는 쪽(판정 자리) | 지금 | 판정 |
|---|---|---|---|---|
| F1 상태형 뽑기(휴면 · 생일 · 포인트 · 주기 이탈 · 등급 · 장바구니 · 조회) | 여정 행(재진입 허용 · 대기일) · 계약 최솟값 | `buildReentryAntiJoin`(7곳) | 진행 중 = `active` 만 · 저장 대기일 = 들어온 시각 기준 | 결함 D1 · D4 |
| F2 감시 묶음 넣기 | 같은 값 | `reentryGuard`(`journey-trigger-watcher.ts:853`) | F1 과 같은 조각(진행 중 = `active` 만) | 결함 D1 |
| F3 「고른 고객에게」 뽑기 → 묶음 넣기 | - | 뽑기 = 실행 하나라도 있으면 뺌 / 넣기 = 재진입 허용이면 진행 중만 | 뽑기와 넣기가 다른 집합 | 결함 D3 |
| F4 앞 여정을 마치면 뽑기 → 넣기 | 앞 실행 표식 | 표식 안티조인 + `ba.status = 'active'` + `buildReentryAntiJoin`(최솟값 0) / 넣기 = 표식 + `reentryGuard` | 진행 중 = `active` 만 | 결함 D1(같은 조각) |
| F5 사건 커서 넣기(주문 완료 · 첫 구매 · 상품 구매 · 휴면 복귀 · 예약 · 배송) | 사건 키 · 커서 | 사건 키 한 번 + `checkCooldown → cooldownElapsed` · 교체 여정 = `cooldownElapsed` → 진행 중 닫기 → 넣기 | 사건 하나 = 한 번은 정상 · 저장 대기일 = 가장 늦게 들어온 실행 하나의 들어온 시각 · 다른 판 busy · 교체 닫기 = `active` 만 | 결함 D4(기준 · 범위) · D1(교체 · 다른 판) |
| F6 자동 재진입 워커 | 여정 행(잠금 밖에서 읽음) | 후보 문장(완료 실행에 끝난 시각 기준 저장 대기일 + 계보 전체에 `reentryHoldSql(최솟값)`) | 잠금 안 재확인 = 켜짐 · 자동 켬뿐 · 계보 전체 관문은 최솟값만 | 결함 D2 · D1(같은 조각) · D4(관문의 대기일) |
| F7 날짜 기준 · 한 번 보내기 | 표식 표 | `journey_anchor_dispatch` · 「이미 넣음」 확인 | 재진입 값을 쓰지 않는다(멱등) | 정상 |
| F8 멈춘 실행 되살리기(다시 켜기) | 멈춤 기록 | `RESUME_REVIVE_SQL` | 실행 id · 진행 칸을 그대로 잇는다(새 진입 아님) | 정상(단 F1 · F2 · F6 이 멈춘 실행을 「없는 것」으로 보면 되살린 뒤 실행 둘) = D1 의 결과 |
| F9 진입 교체(다시 사면 처음부터) | - | `CLOSE_ACTIVE_FOR_REPLACEMENT_SQL`(끝난 시각 기록) → 새 실행 | 사건 하나 = 한 번 | 정상 |
| F10 계보 옮기기(새 판) · 끝내기 | - | `journey-lineage.ts:398, 449`(끝난 시각 기록) | 종결 | 정상 |
| F11 켜진 여정의 시작 사건 바꾸기(붙이기 · 떼기) | `journey-attach.ts`(계보 잠금 · 세대 올림) | 감시 = 잠금 안 `startStillSame` / 워커 = 잠금 밖 값 | 감시는 받는다 · 워커는 옛 값으로 넣는다 | 결함 D2 |

### 2-2 여정 AI 글이 응답 · 저장되기까지(변수 꼴)

| 단계 | 생산자 | 글의 성격 | 지금 | 판정 |
|---|---|---|---|---|
| G1 여정 만들기 · 기념일 칸 · 직접 만든 칸 · 다음 칸 추천 | `journey-package` · `journey-anchor-plan` · `journey-custom-steps` · `journey-next-step` | 새로 쓰기 | `liquidCopyToPercent` 를 지난다 | 정상(C122 ④) |
| G2 칸 다듬기 | `journey-step-refine` | 본문 있음 = 고치기 · 없음 = 새로 쓰기 | 변수 꼴 관문 없음 | 결함 D5 |
| G3 스팸 재작성(사전 검사 · 주간 검사) | `journey-pretest-regen` | 고치기 | 변환 없음 | 결함 D5 |
| G4 AI 수정(초안 패키지) | `journey-ai-edit` | 고치기(안 고친 칸은 그대로 돌아온다) | 변환 없음 | 결함 D5 |
| G5 A/B 문안 | `variant-generator` | 고치기(원문의 다른 말투) | 변환 없음 | 결함 D5 |
| G6 출구 | `finishCopy · finishMany` | 검사 + 표식 | 글을 바꾸지 않는다(설계 · C2) | 정상(변환은 생산자 몫) |
| G7 사람이 쓴 글 저장 | 사람 저장 라우트 | 사람 글 | 템플릿 문법 검증만(`journey-builder.ts:1075`) · 바꾸지 않는다 | 정상(고객 문안 불변) |

## 3 결함 장부

| # | 결함 | 사슬 | 고객이 겪는 일 |
|---|---|---|---|
| D1 | 재진입 관문이 멈춘 실행을 「끝난 실행」처럼 들어온 시각으로 판정한다 · 진입 교체는 진행 중만 닫는다 | K4 · K5 · K6 · K16 · F1 · F2 · F4 · F5 · F6 | 며칠 전 들어와 자동 멈춤(잔액 부족 · 통신사 실패 · 조건 평가 오류)된 고객이 같은 여정에 새로 들어와 첫 문자부터 다시 받는다 · 멈춘 실행을 되살리면 한 고객에 실행 둘(문자 · 과금 두 번) · 「다시 사면 처음부터」 여정도 멈춘 옛 주기가 남아 되살아난다 |
| D2 | 자동 재진입 워커가 잠금 밖에서 읽은 여정 값(시작 사건 · 대기일 · 재진입 허용 · 상한 · 하루 몫 · 첫 칸)으로 넣는다 | K7 · K8 · F6 · F11 | 담당자가 방금 뗀 여정 · 대기일을 늘린 여정 · 하루 몫을 줄인 여정 · 첫 칸 대기를 늘린 여정에 옛 값으로 고객이 다시 들어간다(옛 몫만큼 · 옛 시각에) |
| D3 | 「고른 고객에게」 묶음 넣기 가드가 뽑기와 다른 집합을 본다 | K9 · K10 · F3 | 같은 고객의 대조군 실행이 두 줄 생겨 진입 수 · 하루 몫이 틀리고, 몫을 먹어 다른 고객의 진입이 밀린다 |
| D4 | 저장 대기일이 화면 문구(「마친 뒤 N일」)와 다른 기준으로 판정된다 — 뽑기 · 사건 커서 = 들어온 뒤 N일 · 사건 커서는 「가장 늦게 들어온 실행 하나」만 봄 · 워커의 「최근 끝난 실행」 관문은 최솟값만 건다 | K11 · K12 · K17 · F1 · F5 · F6 | 14일짜리 휴면 여정에 「마친 뒤 30일」을 넣어도 끝난 지 16일 만에 다시 들어온다 · 자동 재진입은 「이 발송 정지」로 끝낸 지 8일(최솟값) 만에 다시 넣는다 · 사건형은 대조군 실행이 더 늦게 들어왔으면 어제 끝난 실행을 못 본다 |
| D5 | 여정 AI 글을 **고치는** 출구 넷(다듬기 · 스팸 재작성 · AI 수정 · A/B)에는 변수 꼴 관문이 없다 | K13 · K14 · K15 · K18 · G2 ~ G5 | 원문은 %고객명% 인데 고친 결과에 `{{ customer.name … }}` · `{% if … %}` 가 섞여 같은 여정 안에서 칸마다 변수 표기가 다르다(1110 접수와 같은 증상의 다른 입구) · AI 가 새로 넣은 조건문은 사람이 쓴 적 없는 분기다 |

## 4 처방

### 4-1 D1 — 미완료 실행 = 진행 중 + 멈춤(뿌리 R87 넓힘 「실행 시점 관문이 보는 상태가 실제 상태 집합과 다르다」)

1. `journey-safety-filter.ts` 에 조각 둘(상태 · 시간 판정의 글자는 이 파일 한 곳):
   - `openExecutionSql(실행 별칭)` = `별칭.status IN ('active', 'paused')` — 아직 끝나지 않은 실행(되살아날 수 있는 멈춤 포함).
   - `recentlyEndedSql(실행 별칭, N일)` = `COALESCE(별칭.completed_at, 별칭.entered_at) > NOW() − N일` — 끝난 지(끝난 시각이 없으면 들어온 지) N일 안.
2. `reentryHoldSql(별칭, N일)` = N 0 → `openExecutionSql` · 1 이상 → `(openExecutionSql OR recentlyEndedSql)`. 상태형 묶음 · 자동 재진입에서 멈춘 실행이 있는 동안은 대기일과 무관하게 다시 넣지 않는다(되살리거나 끝내야 풀린다 = 덜 보내는 쪽).
3. 앞 여정 뒤 뽑기의 따로 쓴 `ba.status = 'active'`(`journey-target-extractor.ts:523`) → `openExecutionSql('ba')`.
4. 사건 커서(F5 · 사건 하나 = 실행 하나가 원래 설계 — 재진입 허용 여정은 같은 판의 진행 중 실행이 있어도 새 사건이면 들어온다 K16):
   - **진입 교체**(「다시 사면 처음부터 — 진행 중인 흐름을 마치고」): 닫는 대상 = 미완료 전부. 진행 중 = 지금 그대로 `goal_met`(`CLOSE_ACTIVE_FOR_REPLACEMENT_SQL` 글자 그대로) · **멈춘 실행 = `ended`**(새 문장 `CLOSE_PAUSED_FOR_REPLACEMENT_SQL` · 끝난 시각 기록) — 멈춘 옛 주기도 닫혀 새 주기 하나만 남는다(되살리기 `RESUME_REVIVE_SQL` 은 `status = 'paused'` 만 깨운다). 멈춘 실행을 `goal_met` 으로 닫지 않는 이유 = 뒤에 붙인 여정이 `goal_met · completed` 를 「마침」으로 받아(`journey-after-config.ts:20-22`) 멈춰 있던 고객에게 뒤 여정 문자가 새로 나간다(Codex 설계 3R #1) · `ended` 는 뒤 여정의 어느 결과에도 들지 않는다.
   - **계보 다른 판 busy 검사**(`checkCooldown` 의 `status = 'active'`) → `openExecutionSql`(다른 판에 멈춘 실행이 있으면 그 판에서 마무리).
   - 교체가 아닌 일반 진입 = 그대로(사건 키가 관문 · 같은 판의 진행 중 · 멈춘 실행은 그 사건의 실행이고 새 사건은 새 실행 — 진행 중을 막지 않는 것과 같은 규칙. 한 고객 실행 여럿 = 사건 여럿).
5. 불수용(기록) = Codex 1R 권고의 「실행 멈춤과 여정 멈춤을 한 트랜잭션으로」. 근거: 상태형 묶음 · 자동 재진입 · 진입 교체의 사슬은 1 ~ 4 가 닫는다 · 한 트랜잭션으로 묶으면 여정 멈춤 실패 시 실행 멈춤까지 되돌아가 같은 칸이 다시 발송 대상이 된다(더 보내는 쪽) · 멈춤 신뢰성은 다른 뿌리 → §9 #1.

### 4-2 D2 — 워커의 판정 = 전부 잠금 안에서 읽는다(뿌리 R12 「잠금 밖에서 읽은 판정으로 쓰기」 재발)

6. 여정 목록 문장은 **id · 회사만** 읽는다(돌 순서 · 회사 돌아가며). 그 밖의 값은 목록에서 읽지 않는다.
7. 여정마다 트랜잭션: `lockEntryIfActive`(계보 잠금 · 진입 열림 · 켜짐) → 같은 연결로 `SELECT … FROM journeys WHERE id · 회사 · status = 'active' FOR UPDATE`(옵션 저장 · 칸 편집이 쥐는 행 잠금과 같은 줄 · 잠금 순서 = 계보 → 행 = 옵션 저장 주소와 같음) → 그 행의 `auto_reentry_enabled` · `allow_reentry` 가 참이 아니면 건너뜀 → **그 행에서** 시작 사건 · 저장 대기일 · 상한 · `trigger_filters`(하루 몫) → 같은 연결로 첫 칸(`journey_steps`) → 동의 조각 · 작성자 범위 → 후보 문장 · 넣기. 잠금 앞에서 읽은 값으로 하는 계산 0.
8. `lockEntryIfActive` = 그대로(반환 칸 추가 없음 · 날짜 기준 · 한 번 보내기 영향 0).
9. 감시 묶음 · 사건 커서 넣기 = 재진입 판정에 쓰는 시작 사건 · 세대는 지금도 잠금 안 `startStillSame` 이 본다(그대로). 상한 · 첫 칸을 회차 처음 값으로 쓰는 것은 재진입 축 밖 → §9 #5.

### 4-3 D3 — 한 번만 들어오는 시작은 넣기 가드도 「실행 하나라도 있으면 뺀다」

10. 계약 CT 에 읽는 함수 `entersOncePerCustomer(시작 사건)` = 계약 `cls === 'standing'`(지금 = 고른 고객에게 하나) — 뽑기가 재진입 설정을 쓰지 않는 시작.
11. 감시 묶음 넣기 가드: `재진입 허용 && !entersOncePerCustomer(시작 사건)` 일 때만 `reentryHoldSql` 조각 · 아니면 조각 없음(= 계보에 실행이 하나라도 있으면 넣지 않는다 · 뽑기 `journey-target-extractor.ts:437-447` 과 같은 집합). 날짜 기준 · 한 번 보내기는 감시 묶음 넣기를 지나지 않는다(자기 넣기 문장 · F7).
12. 자동 재진입 워커는 그대로(「고른 고객에게」 여정의 유일한 반복 길 · 재진입 허용 여정만 · 자기 후보 문장).

### 4-4 D4 — 저장 대기일도 「끝난 뒤」 기준 한 규칙(뿌리 R90 새 「같은 설정값을 자리마다 다른 기준 시각 · 다른 범위로 읽는다」)

13. 대기일 한 함수 `reentryWaitDays(계약 최솟값, 저장 대기일)`(`journey-safety-filter.ts`) = 둘 중 큰 값 · 유한한 0 이상 정수로 접음 · **저장값을 줄이지 않는다**(1110 전 만든 여정 · AI 초안은 365일을 넘을 수 있다 K17 — 730일은 730일 그대로) · 숫자가 아니거나 36,500일(100년)을 넘으면 36,500(막는 쪽). 조각이 글자로 싣는 값은 이 함수의 결과(숫자 글자)뿐이다.
14. 상태형 뽑기 `buildReentryAntiJoin`: 재진입 허용 두 갈래를 하나로 — `NOT EXISTS (… AND reentryHoldSql('je', reentryWaitDays(최솟값, 저장 대기일)))`. 재진입 불가 갈래 = 그대로.
15. 감시 묶음 넣기 가드 = 같은 값(`reentryWaitDays(reentryFloorDays(시작 사건), 저장 대기일)`) → 뽑기 수 = 넣기 수.
16. 자동 재진입 워커의 「계보의 어느 실행이든」 관문 = `reentryHoldSql('je2', reentryWaitDays(autoReentryFloorDays(시작 사건), 저장 대기일))`(옛: 최솟값만 → 최근 ended 가 저장 대기일을 비켜 갔다). 후보 문장의 저장값 바인드(완료 시각 비교 · 목표 달성 자격 `저장값 > 0`)는 그대로.
17. 사건 커서 `cooldownElapsed` = 「가장 늦게 들어온 실행 하나」가 아니라 **계보 전체**: 저장 대기일 > 0 이면 `NOT EXISTS (계보 실행 중 recentlyEndedSql(저장 대기일))`(시간 판정만 · 미완료 판정과 분리 → 진행 중 실행은 들어온 시각으로 읽혀 진입 교체의 「쿨다운 확인 → 닫기 → 새 실행」 순서가 지금과 같다) · 0 이면 참(그대로).
18. 더 보내는 쪽이 되는 조합 0: 끝난 시각 ≥ 들어온 시각이므로 `recentlyEndedSql(N)` 이 거짓이면 옛 조건 `entered_at > NOW() − N` 도 거짓 · 계보 전체는 「하나만」보다 넓다 · 대기일은 줄지 않는다.
19. 화면 문구 · 검증 문장 = 그대로(코드가 문구를 따른다). 기존 여정 영향 = 재진입 허용 + 대기 > 0 여정에서 다음 진입이 여정 길이만큼 늦어진다(덜 보내는 쪽 · 배포 전 실측 P1).

### 4-5 D5 — 여정 AI 글의 변수 꼴 = 쓰기 · 고치기 두 규칙을 공용 함수 한 곳에(뿌리 R91 새 「생산자마다 따로 붙인 글 변환은 빠진 생산자가 남는다」 · R13 · R24 와 같은 계열)

20. 새 파일 `utils/journey-ai-copy.ts`(여정 AI 글의 변수 꼴 CT · 렌더 파서의 토큰 뽑기 `liquidTokens` 를 `liquid-templating.ts` 가 내보내고 이 파일이 쓴다):
    - `journeyNewCopy(AI 글)` = **새로 쓰는 생산자 넷** 전용 = `liquidCopyToPercent`(C122 ④ 그대로 · 결과 같음).
    - `journeyRevisedCopy(AI 글, 원문)` → 글 또는 `null`(쓸 수 없는 안) = **고치는 자리** 전용(원문이 빈 글이어도 이 함수 — 빈 칸 다듬기). 순서:
      ① AI 글에도 원문에도 템플릿 문법이 없으면 글자 그대로.
      ② 원문에 **태그(`{% … %}` = 조건문 · 반복문 · 대입 · 주석)가 하나라도 있으면** → 결과가 원문과 **글자 그대로 같을 때만** 통과 · 아니면 `null`. 조건 태그가 든 글은 갈래마다 받는 사람이 달라, 숫자 · 혜택이 어느 갈래에 있는가까지 지켜야 하는데 사실 CT 는 글 전체 단위다(갈래 단위 대조를 덧붙이는 설계가 Codex 설계 3R · 4R · 5R · 6R · 7R 에서 매번 새 구멍을 냈다) → **조건 태그가 든 글은 AI 가 고치지 않는다**(사람이 직접 고친다 · 1110 부터 AI 가 새로 쓰는 여정 글에는 조건 태그가 없다).
      ③ (원문에 태그 없음) 원문에 없던 `{{ customer.<아는 칸> … }}` 출력 = `%표시명%`(1 대 1 바꿔 적기 · 원문에 글자 그대로 있던 출력은 그대로 둔다).
      ④ 그 뒤 남은 템플릿 토큰은 **전부 출력(`{{ … }}`)이어야 하고**(태그가 하나라도 있으면 `null` = 새 조건문) 그 순서열이 원문의 출력 순서열과 **똑같아야** 한다(렌더 파서가 뽑은 값 글자 그대로 · 추가 · 삭제 · 순서 바뀜 = `null` · 원문에 출력이 없으면 남은 토큰 0). 출력만 있는 글에는 갈래가 없으므로 그 밖의 글은 지금처럼 생산자의 사실 판정(글 전체)이 본다.
      ⑤ 파서가 못 읽는 글 = `null`.
      조건문을 평문으로 접지 않는다(접으면 원문 사실이 지워진 안이 통과한다 · Codex 설계 2R #7 · 3R #3).
21. 부르는 자리 = **두 번**(Codex 설계 8R — 대조 뒤의 글자 정리 `sanitizeForSms` 가 연속 공백 · 보이지 않는 글자를 지워 조건식을 바꾸거나 `{` 와 `%` 사이에 숨은 글자를 지워 새 태그를 만들 수 있다):
    (가) AI 응답에서 본문 · 제목을 꺼낸 **직후** = 변환(③) + 판정(사실 판정 · 꼴 검사가 변환된 글을 본다).
    (나) **생산자가 돌려주는 글이 마지막으로 바뀐 뒤**(글자 정리 · 혜택 자리 채우기 · 링크 붙이기 · **전송자 명칭 붙이기 `ensureSenderName`** 까지 끝난 실제 반환 글 · 그 뒤에 글을 바꾸는 줄 0 — 다듬기 `journey-ai-generator.ts:1001` · 스팸 재작성 `:1278` · AI 수정 `journey-ai-editor.ts:273` 의 전송자 명칭이 회사가 저장한 이름을 그대로 붙이므로 이름에 템플릿 문법이 들어 있으면 여기서 새 문법이 생긴다 · Codex 설계 9R · `finishCopy · finishMany` 와 전송자 명칭의 순서는 지금 그대로) = `journeyRevisedKept(최종 글, 원문)` = 같은 규칙을 다시 돌려 **바꿀 것 없이 그대로 통과해야** 한다(`journeyRevisedCopy(최종 글, 원문) === 최종 글`) · 아니면 그 안을 버린다. 조건 태그가 든 원문은 정리 과정에서 한 글자라도 달라지면 통과하지 못한다.
    생산자마다:
    - 쓰기 넷(`journey-package` · `journey-anchor-plan` · `journey-custom-steps` · `journey-next-step`) = `liquidCopyToPercent` 직접 호출을 `journeyNewCopy(글)` 로(같은 결과 · 이름 하나).
    - 칸 다듬기 = `journeyRevisedCopy(글, input.currentMessage 또는 빈 글)`. `null` = 그 후보 제외(지금의 「쓸 결과 없음」 규칙 · 후보가 0 이면 과금 없음 = 지금 규칙). **원문에 조건 태그가 있으면 AI 를 부르기 전에** 안내하고 끝낸다(「조건문({% %})이 든 문안은 AI 가 고치지 않아요. 직접 고쳐 주세요.」 · 과금 0 · AI 호출 0 — 부르면 결과가 늘 0 이라 「다시 시도」만 되풀이된다). 안내 자리 = 과금 래퍼 `runChargedAi` 에 들어가기 **전**(`refineStepMessage` 맨 앞 — 안에 두면 잔액 부족 오류가 안내를 가린다).
    - A/B 문안 = `journeyRevisedCopy(글, 기준 문안)`. `null` = 그 문안 제외. 기준 문안에 조건 태그가 있으면 다듬기와 같은 안내(과금 0 · AI 호출 0 · 과금 래퍼 진입 전 = 「기준 문안 10자」 안내와 같은 자리 · 같은 꼴 `warnings`).
    - 스팸 재작성 = `journeyRevisedCopy(글, input.currentMessage)`. `null` = 재작성을 버린다(자동 교체 없음 · 담당자 안내 = 지어낸 혜택 · 새 숫자와 같은 길). 원문에 조건 태그가 있으면 AI 를 부르지 않고 `null`.
    - AI 수정 = 칸마다 본문 · 제목을 **같은 자리의 원래 칸**과 대조한다(대응을 먼저 정한다 · Codex 설계 4R #2):
      · 편집 전 패키지에 템플릿 문법이 든 칸이 **하나도 없으면** = 결과 칸마다 `journeyRevisedCopy(글, 빈 글)`(새 아는 변수 = %변수% · 그 밖 새 문법 = `null`).
      · **하나라도 있으면** = 결과의 칸 수가 편집 전과 같아야 하고(다르면 대응이 모호 = 수정 전체 미적용 「변수 표기가 든 칸이 있어 칸 수를 바꾸는 수정은 적용하지 않았어요. 칸은 직접 추가하거나 지워 주세요.」), i번째(전체 칸 배열의 자리) 결과 칸 = `journeyRevisedCopy(글, i번째 원래 칸의 같은 필드)` — 조건 태그가 든 원래 칸은 글자 그대로 돌아와야 한다(다른 칸은 고칠 수 있다).
      · 하나라도 `null` = 수정 전체를 적용하지 않는다(「원문에 없던 변수 표기가 섞였거나 조건문이 든 칸이 바뀌어 수정을 적용하지 않았어요. 다시 눌러 주세요.」 = 효능 · 계절 낱말과 같은 길).
22. 출구(`finishCopy`)는 그대로(글을 바꾸지 않는다 · C2 설계). 다듬기 지시문의 한 줄(「Liquid 분기 안 텍스트만 톤 정련」 · `journey-ai-generator.ts:899`)은 이제 닿지 않는 지시라 지운다(조건 태그가 든 원문은 AI 를 부르지 않는다) · 그 밖 지시문은 그대로(프롬프트는 경계가 아니다).

## 5 영향표 — 바뀌는 것을 읽는 자리

| 바뀌는 것 | 읽는 자리(grep) | 영향 |
|---|---|---|
| `reentryHoldSql` 조각(미완료 = 진행 중 + 멈춤) | `journey-safety-filter.ts`(뽑기 안티조인) · `journey-trigger-watcher.ts:853`(넣기) · `journey-reentry-worker.ts:161`(워커) | 멈춘 실행이 있는 고객 = 다시 넣지 않음 · 그 밖 같음 |
| `buildReentryAntiJoin` 재진입 허용 갈래 하나 · 대기일 = `reentryWaitDays` | `journey-target-extractor.ts:191, 213, 257, 295, 337, 383, 413, 524` | 대기 0 = 조각만 D1 · 대기 > 0 = 들어온 시각 조건이 끝난 시각 조건으로 · 바인드 하나 줄어듦(호출부는 순서대로 push · 영향 0) |
| 감시 넣기 가드 | `journey-trigger-watcher.ts:853` 한 곳 | 뽑기와 같은 값 · 「고른 고객에게」 = 조각 없음 |
| `checkCooldown` 다른 판 busy · `cooldownElapsed` | 사건 커서 넣기(`journey-trigger-watcher.ts:632-647`) | 다른 판의 멈춘 실행도 막음 · 대기 > 0 = 계보 전체 · 끝난 뒤 기준 |
| 진입 교체 닫기(문장 하나 추가) | `journey-trigger-watcher.ts:634` · 뒤 여정 결과 읽기(`journey-after-config.ts:20-22` = `goal_met · completed` 만) | 멈춘 실행 = `ended` 로 닫음(뒤 여정 진입 0 · 통계의 목표 달성 수 그대로) · 진행 중 닫기 문장 글자 그대로 |
| 워커 = 잠금 안 읽기 | `journey-reentry-worker.ts` 한 파일 | 목록 = id · 회사 · 나머지 = 행 잠금 안 · 넣는 고객 집합은 최신 값 기준 |
| `entersOncePerCustomer` | 감시 넣기 가드 | 「고른 고객에게」 재진입 허용 여정의 넣기 = 실행 하나라도 있으면 뺌 |
| `journeyNewCopy` · `journeyRevisedCopy`(새 파일 `journey-ai-copy.ts`) · `liquidTokens`(내보내기 추가) | 여정 AI 생산자 여덟 | 쓰기 넷 = 결과 같음 · 고치기 넷 = 새 아는 변수는 %변수% · 새 조건문 · 출력 순서열이 달라진 안은 버림 · **조건 태그가 든 원문 = AI 가 고치지 않음**(다듬기 · A/B = 안내 뒤 끝 · 스팸 재작성 = 자동 교체 없음 · AI 수정 = 그 칸이 그대로일 때만 적용)(옛: 그대로 응답 · 저장) |
| 기존 시험 | `journey-reentry-floor-1110.test.ts`(조각 글자 · 대기 > 0 갈래 · 워커 소스 줄) · `journey-reentry-floor-1110.pg.test.ts` · `journey-reentry-antijoin.verify.ts` · `c105-*` · `journey-v2-*`(교체 문장 이름) · `journey-percent-only-1110.test.ts`(호출 글자) | 기대를 새 규칙으로 고친다(구현 때 목록 첨부) |

기존 동작이 바뀌는 지점 = (가) 멈춘 실행이 있는 고객의 재진입(막음) · 교체 여정의 멈춘 옛 주기(`ended` 로 닫음 · 뒤 여정으로 넘어가지 않음) (나) 재진입 대기 > 0 여정의 다음 진입 시각(여정 길이만큼 늦어짐) (다) 「고른 고객에게」 대조군 중복 행(안 생김) (라) 워커가 늘 최신 여정 값으로 판정 (마) 고치기 AI 결과의 변수 꼴(새 문법이 든 안은 버림) · **조건 태그가 든 문안(1110 전에 만든 여정 · 사람이 직접 쓴 조건문)은 AI 다듬기 · A/B · 스팸 자동 재작성 · AI 수정의 대상에서 빠진다**(기능이 주는 자리 · 배포 전 실측 P1 ③ 으로 해당 칸 수를 본다 · 더 나가는 글 0). 전부 「덜 보내는 쪽」 또는 표기.

## 6 시험

| 시험 | 대상을 뽑는 법 | 변이(빨간불 확인) |
|---|---|---|
| T1 계약(R87 넓힘 · `journey-recheck-1111.test.ts`) | 백엔드 운영 소스 전수(시험 제외)의 글자열 · 템플릿 글자열 노드를 구문 트리로 훑어 `journey_executions` 가 든 SQL 글자 안에 진행 중 상태를 직접 적은 자리(`status = 'active'` · `status IN (… 'active' …)`)를 [파일 · 감싼 함수 선언 또는 최상위 상수]로 전부 뽑는다 → 분류표(실행기 · 화면 · 통계 · 멈춤 · 되살리기 · 닫기 · 사전 검사 · 칸 편집 가드 · 캠페인 대상 조건 = 「진입 판정 아님」 31곳)와 집합이 같아야 한다 · 분류 없는 새 자리 = 실패(진입을 막는 판정이면 표에 올리지 않고 `openExecutionSql` 을 쓴다) · 진입 판정 함수 일곱(`reentryHoldSql` · `buildReentryAntiJoin` · `afterJourneyTargetQuery` · `enqueueCandidates` · `checkCooldown` · `cooldownElapsed` · `runReentryBatch`)은 표에 없고 그 안의 실행 표 SQL 에 `status = 'active'` 0 · 조각 함수 `openExecutionSql` 을 부르는 파일 = 셋(여정 끝내기 · 옛 판 닫기처럼 실행을 **닫는** 문장의 `IN ('active', 'paused')` 는 표의 「닫기」) · `UPDATE journey_executions … SET status = '<값>'` 전수 = 미완료 목록 밖 값으로 바꾸는 문장은 같은 SET 에 `completed_at` · 감시 넣기 가드의 글자 · 교체 닫기 두 문장의 호출 순서 | 조각에서 `paused` 삭제(M1) · 다른 판 검사를 `e.status = 'active'` 로(M8) · 교체가 멈춘 실행을 안 닫음(M2) · 종결 UPDATE 하나에서 `completed_at` 삭제(M28) · 진입 판정 아닌 함수에 새 자리(M30) → 각각 빨간불 |
| T2 계약(R12 · 워커) | 워커 소스 구문 트리 = 목록 문장이 고르는 칸 = `id, company_id` 둘뿐 · 그 밖의 `journeys` 읽기는 넣기 트랜잭션 연결(`client`)로 하고 `FOR UPDATE` 가 있다 · 전역 `query` 로 여정 설정을 읽는 호출 0 | 목록 문장에 `reentry_cooldown_days` 를 다시 넣음(M10) → 빨간불 · 행 읽기를 전역 `query` 로(M29) → 빨간불 · 잠금 안 재진입 허용 재확인 삭제(M12) → 빨간불 |
| T3 단위 | `openExecutionSql` · `recentlyEndedSql` · `reentryHoldSql`(0 · 7) · `reentryWaitDays`(3 · 7 → 7 / 30 · 7 → 30 / 730 · 7 → 730 / 음수 · NaN · 무한 · 아주 큰 수) · `buildReentryAntiJoin`(재진입 불가 = 옛 글자 · 허용 대기 0 최솟값 0 · 허용 30 · 7 · 허용 3 · 7 · 허용 730 · 7 · 단일 / 계보) · `entersOncePerCustomer`(계약 전수) · `journeyNewCopy`(C122 ④ 사례 그대로) · `journeyRevisedCopy`(둘 다 문법 없음 = 글자 그대로 · 원문 %고객명% + AI 가 `{{ customer.name | default: '고객' }}` = %고객명% · 새 조건문 = null · 모르는 칸 출력 = null · 원문 혜택 문장을 if 로 감쌈 = null · 원문이 빈 글 + 승인 혜택을 if 안에 넣음 = null · 원문이 빈 글 + `{{ customer.name }}님, 20% 할인 안내입니다.` = `%고객명%님, 20% 할인 안내입니다.` · **원문에 조건 태그 + 결과가 글자 그대로 같음 = 통과 · 한 글자라도 다름 = null**(태그 통째 삭제 · 갈래 글 맞바꾸기 · 조건식 따옴표 안 공백 변경 · 갈래 밖에 같은 혜택 문장 추가 · 이번 달 기한의 갈래 이동 전부 이 한 규칙) · 원문 `{{ cart.product_name }}` 출력만 + 뼈대 유지 + 주변 글 고침 = 통과 · 그 출력을 지움 = null · 출력을 하나 더 씀 = null · 출력 순서 바꿈 = null · 출력의 필터 글자를 바꿈 = null · 닫히지 않은 태그 = null) | 규칙마다 하나 |
| T4 실 PG(`journey-recheck-1111.pg.test.ts`) | 실제 표: ① 상태형 재진입 여정 · 8일 전 들어와 멈춘 실행 = 뽑기 0 · 넣기 0 · 워커 0 ② 30일 전 들어와 16일 전 끝남 · 대기 30 = 뽑기 0 / 31일 전 끝남 = 1 ③ 대기 730 · 400일 전 끝남 = 뽑기 0(줄지 않음) ④ 사건 커서: 대기 30 · 40일 전 들어와 어제 끝난 실행 + 35일 전 들어온 대조군 = 쿨다운 안(넣기 0) ⑤ 교체 여정 · 멈춘 실행 + 새 사건 = 멈춘 실행이 `ended` 로 닫히고 새 실행 하나 · 그 뒤 되살리기 = 깨어나는 실행 0 · **그 여정 뒤에 붙인 여정(결과 = 마친 고객 모두)의 후보 0** ⑥ 다른 판에 멈춘 실행 = 사건 넣기 0 ⑦ 「고른 고객에게」 재진입 허용 · 대조군 실행 하나 = 넣기 0 ⑧ 워커: 완료 50일 전 + 진입 20일 전 · 끝냄 8일 전 · 대기 30 = 0 ⑨ 워커 **끼어들기 시험**(실제 순서 재현 · 시험용 훅 없음): 다른 연결이 그 여정의 계보 잠금(`journey-entry`)을 쥔 채 워커를 띄운다 → 워커는 목록을 읽고 잠금에서 기다린다(`pg_locks` 로 기다림 확인) → 다른 연결에서 설정을 바꿔 커밋(시작 사건 · 대기일 늘림 · 하루 몫 줄임 · 첫 칸 대기 늘림 · 재진입 허용 끔 각각) → 잠금을 놓는다 → 워커가 넣은 결과 = 새 값 기준(새 최솟값 · 새 대기일 · 새 몫 · 새 첫 칸 시각 · 끈 여정 = 0) ⑩ §8 의 실측 문장 넷(P1 ① ② ③ · S1)이 실제 표에서 오류 없이 돈다(설계서의 sql 블록을 읽어 실행). 잠금 앞에서 읽는 옛 구조는 이 시험에서 옛 값으로 넣어 실패한다 | 조각 · 가드 · 교체의 멈춘 실행 닫기 · 멈춘 실행을 `goal_met` 으로 닫기 · 워커 관문 · 워커의 행 읽기 · **첫 칸 읽기를 잠금 앞으로** 각각 되돌려 빨간불 |
| T5 계약 + 생산자 결과(D5 · `journey-recheck-1111.test.ts` · 옛 `journey-percent-only-1110.test.ts` 는 호출 글자만 새 이름으로) | ① 소스 전수에서 `finishCopy · finishMany` 호출의 생산자 이름을 구문 트리로 뽑아 = 알려진 집합(여정 여덟 = `journey-package` · `journey-anchor-plan` · `journey-custom-steps` · `journey-next-step` · `journey-step-refine` · `journey-pretest-regen` · `journey-ai-edit` · `variant-generator` + 여정 밖 하나 = `decorate`(AI 오퍼레이터 꾸미기 · §9 #8)) · 생산자 이름은 글자열 리터럴 · 새 이름 = 실패 ② `liquidCopyToPercent` 를 직접 부르는 운영 파일 = `journey-ai-copy.ts` 하나(정의 파일 제외) · `journeyNewCopy` · `journeyRevisedCopy` · `journeyRevisedKept` 를 부르는 파일 집합 고정 ③ **생산자 결과 시험**(AI 호출을 흉내 내어 실제 생산자 함수를 돈다): 다듬기 · 스팸 재작성 · A/B · AI 수정마다 — 원문 %고객명% + AI 가 `{{ customer.name | default: '고객' }}` 로 답함 = 결과 %고객명% · AI 가 새 `{% if %}` 를 넣음 = 그 안 없음(다듬기 · A/B) · null(스팸) · 거절(AI 수정) · 제목에 넣은 경우도 같음 · 원문 「20% 할인 안내입니다.」 를 if 로 감쌈 = 그 안 없음 · 원문 `{% if customer.grade == 'VIP' %}20% 할인 안내입니다.{% endif %}` = 다듬기 · A/B 는 AI 호출 0 · 안내 오류 · 과금 0 / 스팸 재작성 = AI 호출 0 · null(자동 교체 0) · 빈 칸 다듬기 + 승인 혜택 「20% 할인」 + AI 가 그 문장을 if 안에 넣음 = 후보 0 · 과금 0 · 같은 조건에서 AI 가 `{{ customer.name }}님, 20% 할인…` 으로 답함 = 후보 있음(%고객명% · 혜택 그대로) · **출구 직전 최종 대조**: 문법 없는 원문 + AI 가 `{` 와 `%` 사이에 보이지 않는 글자(U+200B)를 넣은 답(정리 뒤 새 태그가 된다) = 그 안 없음 · AI 수정에서 조건값에 연속 공백이 든 원래 칸(`'VIP   A'`)을 AI 가 그대로 돌려줘도 글자 정리로 달라지면 = 미적용 · 회사 이름(전송자 명칭)이 `{{ customer.name }}` 인 회사에서 다듬기 · 스팸 재작성 · AI 수정 = 명칭이 붙은 최종 글에 새 문법 → 그 안 없음 · null · 미적용 · AI 수정: 문법 없는 패키지 + 새 조건문 = 미적용 · 문법 있는 패키지 + 칸 수가 달라짐 = 미적용 · **같은 뼈대의 두 칸 A(VIP 20% · 일반 10%) · B(VIP 10% · 일반 20%) 에서 A 를 B 와 같게 바꾼 답 = 미적용**(조건 태그가 든 칸은 글자 그대로여야 한다) · 조건 태그가 든 칸은 그대로 두고 다른 칸의 말투만 바꾼 답 = 적용 | 생산자 하나에서 `journeyRevisedCopy` 호출 삭제 → 그 생산자의 결과 시험 빨간불 · `journeyRevisedKept`(최종 대조)만 삭제 → 보이지 않는 글자 · 연속 공백 · 전송자 명칭 사례 빨간불 |
| 전체 | backend tsc 0 · vitest 전체 · `npm run test:pg` · frontend tsc 0(화면 수정 0 이면 생략 사유 기록) | - |

## 7 직원 지시문(배포 뒤 · 테스트계정 invito01 · 초안 여정으로만 · 발송 0)

| 순 | 하세요 | 보이면 맞음 | 맞음 / 다름 |
|---|---|---|---|
| 1 | invito01 로 로그인해 여정 화면에서 문자 칸이 있는 초안 여정을 하나 연다(없으면 「생일 D-7」으로 새로 만든다) | 여정 작업 화면이 열린다 | |
| 2 | 첫 문자 칸을 눌러 본문에 「%고객명%님, 생일 축하드려요」를 넣고 저장한다 | 저장된다 | |
| 3 | 같은 칸에서 「AI 다듬기」를 누른다 | 다듬은 안이 1개 이상 나오고, 모든 안에 `{{` 또는 `{%` 글자가 없다 · 이름 자리는 「%고객명%」으로 보인다 | |
| 4 | 다듬은 안 하나를 골라 적용한 뒤 「A/B 문안 자동 만들기」를 누른다 | 만든 문안 전부에 `{{` 또는 `{%` 글자가 없다 | |
| 5 | 여정 만들기 화면에서 한 줄로 새 초안을 만든 뒤 「AI 로 수정」에 「말투를 더 정중하게」를 넣는다 | 수정된 칸 전부에 `{{` 또는 `{%` 글자가 없다 | |
| 6 | 초안 여정의 문자 칸 본문을 `{% if customer.grade == 'VIP' %}VIP 고객님께 안내드려요.{% else %}안내드려요.{% endif %}` 로 바꿔 저장한 뒤 「AI 다듬기」를 누른다 | 「조건문({% %})이 든 문안은 AI 가 고치지 않아요. 직접 고쳐 주세요.」 안내가 보이고 본문은 그대로다 | |

실행 시점 판정(멈춘 실행 · 끝난 뒤 기준 · 대조군 · 워커)은 화면으로 볼 수 없다 → 실 PG 시험 T4 와 배포 뒤 서버 SQL(§8 S1)로 본다.

## 8 배포

- DDL 0 · ENV 0 · 백엔드 build:safe(화면 수정 0) · 재시작 = 적재 0건 확인 뒤(런북).
- 배포 전 실측 P1(읽기만) = ① 켜진 재진입 허용 + 대기 > 0 여정 수(회사 · 시작 사건 · 대기일 · 칸 수) — D4 로 다음 진입이 늦어지는 여정 ② 켜진 여정에 멈춘 실행이 남아 있는 건수 — D1 로 막히는 고객 수 ③ 조건 태그(`{%`)가 든 여정 문자 칸 수(회사 · 여정 상태) — D5 로 AI 고치기 대상에서 빠지는 칸.
- 배포 뒤 실측 S1 = 상태형 · 교체 여정에서 한 고객에 미완료(진행 중 · 멈춤) 실행이 둘 이상인 계보 0 · 「고른 고객에게」 여정에서 한 고객 실행 둘 이상 0(자동 재진입 뺌).
- 원장 = C126-P1 · C126-H1 · C126-S1 · C126-T1.

실측 문장(읽기만 · 서버 셸에서 `docker exec -i targetup-postgres psql -U targetup targetup -P pager=off -c "…"` 로 하나씩):

```sql
-- P1 ① 켜진 재진입 허용 + 저장 대기일 > 0 여정(D4 로 다음 진입이 여정 길이만큼 늦어진다)
SELECT j.company_id, j.trigger_event, j.reentry_cooldown_days, COUNT(*) AS journeys FROM journeys j WHERE j.status = 'active' AND j.allow_reentry = true AND j.reentry_cooldown_days > 0 GROUP BY 1, 2, 3 ORDER BY 4 DESC;
-- P1 ② 켜진 여정에 남아 있는 멈춘 실행(D1 로 그 고객은 그 계보에 새로 들어오지 않는다)
SELECT j.company_id, COUNT(DISTINCT j.id) AS journeys, COUNT(*) AS paused_executions FROM journey_executions e JOIN journeys j ON j.id = e.journey_id WHERE e.status = 'paused' AND j.status = 'active' GROUP BY 1 ORDER BY 3 DESC;
-- P1 ③ 조건 태그가 든 여정 문자 칸(D5 로 AI 고치기 대상에서 빠진다)
SELECT j.company_id, j.status, COUNT(*) AS steps FROM journey_steps s JOIN journeys j ON j.id = s.journey_id WHERE strpos(COALESCE(s.message_template, ''), '{%') > 0 OR strpos(COALESCE(s.subject, ''), '{%') > 0 GROUP BY 1, 2 ORDER BY 3 DESC;
-- S1 배포 뒤: 한 고객 · 한 계보에 미완료(진행 중 · 멈춤) 실행이 둘 이상이고 그 가운데 가장 늦은 진입이 배포 뒤인 것(시작 사건별 고객 수 · 배포 시각을 넣는다)
SELECT t.trigger_event, COUNT(*) AS customers FROM (SELECT COALESCE(j.lineage_id, j.id) AS lineage, MIN(j.trigger_event) AS trigger_event, e.customer_id, MAX(e.entered_at) AS last_in FROM journey_executions e JOIN journeys j ON j.id = e.journey_id WHERE e.status IN ('active', 'paused') GROUP BY 1, 3 HAVING COUNT(*) > 1) t WHERE t.last_in > '2026-11-11 00:00:00+09' GROUP BY 1 ORDER BY 2 DESC;
```

S1 판정 = §2-1 F1 상태형 뽑기로 들어오는 시작(휴면 · 생일 · 포인트 · 주기 이탈 · 등급 · 장바구니 · 조회)과 F3 「고른 고객에게」(`custom`) 행이 0 · F5 사건 커서로 들어오는 시작(주문 완료 · 첫 구매 · 상품 구매 · 휴면 복귀 · 예약 · 배송)은 사건마다 실행을 만들어 둘일 수 있으므로 판정 대상 아님.

## 9 이번 범위 밖(기록)

| # | 내용 | 처리 |
|---|---|---|
| 1 | 자동 멈춤 = 실행 멈춤과 여정 멈춤이 두 걸음(뒤 걸음 실패를 삼킨다 · K5) | 재진입 사슬은 D1 처방으로 닫힘 · 멈춤 신뢰성(여정이 켜진 채 남는 것)은 다른 뿌리 · 별도 |
| 2 | 재진입 허용 + 「이미 쉬고 있는 고객도 받기」 휴면 · 포인트 소멸(미사용 기준) = 끝난 뒤 대기일마다 계속 다시 들어온다 | 화면이 말하는 동작 그대로(「마친 뒤 N일 지나면 또 받아요」) · 결함 아님 |
| 3 | C123 설계서 §9 의 나머지(자동 다시 받기가 시작 조건을 다시 안 봄 · 선불 알림톡 단가 · 생일 멈춘 날 · 월 예산 달 경계 · 적재 시도 상한 · 알림톡 대체 문안) | 그대로(제품 판단 · 별도 설계) |
| 4 | 켜진 여정의 붙이기 · 떼기가 재진입 값을 다시 검증하지 않는다 | 실행 시점 관문이 지금 시작 사건의 최솟값으로 건다(D2 처방 뒤 워커 포함) · 저장값은 다음 재진입 저장 때 거절 = C123 설계 4-5 와 같은 규칙 |
| 5 | 감시 묶음 · 사건 커서 넣기가 첫 칸을 회차 처음(잠금 앞) 읽은 값으로 쓴다 — 재진입 허용 · 대기일 · 상한 · 하루 몫은 옵션 저장이 켜진 여정에서 시작 설정 세대를 올려 감시가 그 회차를 건너뛴다(`routes/ai.ts` `JOURNEY_ENTRY_KEYS` · 1023 처방 · 1111 저녁에 이 줄을 「재진입 허용 · 대기일도 옛 값」이라고 잘못 적었던 것을 바로잡음) | 첫 칸 = C129 D9 로 처방(`docs/2026-11-11-journey-remaining-nine-design.md`) |
| 7 | 조건 태그가 든 문안을 AI 가 갈래 단위로 안전하게 고치는 기능(갈래마다 사실을 지키는 대조) | 이번에는 고치지 않는 쪽으로 닫았다(처방 20 ②) · 필요해지면 갈래 단위 사실 CT 를 먼저 설계 |
| 8 | AI 오퍼레이터 꾸미기(생산자 이름 `decorate` · 캠페인 문안)가 여정 AI 글과 같은 출구(`finishCopy`)를 쓰지만 템플릿 문법 관문이 없다(구현 중 T5 ① 생산자 이름 추출로 발견) | 여정 글 아님 · 캠페인 문안에 템플릿 문법이 섞였을 때의 영향 = 미검증 · 계약(T5 ①)에 이름으로 올려 둠 · 별도 |
| 9 | 칸 지우기 가드(`journey-builder.ts` `deleteJourneyStep`)가 진행 중(`active`) 실행만 센다 — 그 자리 주석이 「재개 기능을 만들면 이 조건을 함께 고쳐야 한다」고 적었고(0802) 그 뒤 멈춘 실행 되살리기(`RESUME_REVIVE_SQL`)가 생겼다(구현 중 T1 분류로 발견) | 진입 판정 아님(T1 분류표 「칸 편집 가드」) · 멈춘 실행이 있는 여정에서 칸을 지운 뒤 되살렸을 때 받는 칸 = 미검증 · 별도(칸 편집 축) |
| 10 | AI 수정(`journey-ai-editor.ts` `normalizeStep`)이 카카오 칸의 대체 문자(`alimtalkNextContents` · `alimtalkNextSubject`)를 AI 답 그대로 싣는다 — 혜택 · 효능 · 변수 꼴 관문이 전부 카카오 칸을 건너뛴다(구현 중 Codex 구현 1R 수정 때 읽다가 발견) | 본문은 승인 템플릿이라 대상 아님 · 대체 문자를 AI 가 실제로 바꿔 돌려주는지 = 미검증 · 별도 · 같은 함수에 끝 칸(`end`)의 본문 · 제목을 비우는 분기가 없다(Codex 구현 2R 범위 밖 메모 · 끝 칸은 발송하지 않는 칸) |
| 6 | 멈춘 실행이 되살아나지도 끝나지도 않고 남는 경우(사람 정지가 겹친 칸)에 그 고객은 그 계보의 상태형 진입에서 계속 빠진다 | 덜 보내는 쪽 · 담당자가 그 칸을 멈춘 뜻과 같은 방향 · 영영 남지는 않는다: 여정 끝내기(`journey-lineage.ts:398-399`)와 닫힌 옛 판 정리(`:444-452`)가 멈춘 실행을 종결(끝난 시각 기록)로 바꾼다 → 그 뒤 최솟값 · 대기일이 지나면 다시 대상 |
