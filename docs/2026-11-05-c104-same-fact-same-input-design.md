# C104 · 여정 같은 사실 = 같은 입력 (1105 접수 A/B · 대상 인원 + 같은 증상 전수)

> 카드 C104 · 2026-11-05 · 접수 = 그룹웨어 1105 「여정 A/B안 테스트」(남지현 P1) · 「(여정) 생성 시 발송 예정 고객 수가 맞지 않는 것 같은데」(서수란)
> Harold 지시(1105 원문): 「묶어서 진행하되 구조체크를 진행해서 내가 늘 이야기한 같은 증상이 또 나올 수 있는게 있는지 전수적으로 체크하라고 알겠니? 그리고 완벽한 설계서를 작성을 하고 설계서구조체크를해 닫힐때까지 코덱스리뷰도 마찬가지로 닫힐때까지해 마지막으로 구현하고 코덱스리뷰 닫힐때까지 돌리고 배포명령어 보고해」
> 같은 날 함께 온 「(AI한줄로) 혜택 달력 기간」 = 새 기능 요청(결함 아님 · 이 카드 밖 · §11).

## §0 진행 표

| 단계 | 상태 |
|---|---|
| 접수 사실 확인 | 끝(1105 · A/B = 코드 · 인원 = Harold 실행 SQL 5회) |
| 흐름 표(기계 추출) · 결함 장부 | 이 문서 §3 · §4 |
| 설계 | 이 문서 §5 ~ §8 |
| 설계 구조체크 | 1차 끝(1105 · SC-1 ~ SC-13 · SC-5 정정 = 새 모양도 `updateJourneyStep` · SC-13 = 잠긴 칸 채우기 줄) |
| Codex 설계 | 1R 지적 4 · 보강 2 · 2R 1(같은 뿌리 = 구조 정정) 수용 · 3R approve(1105) |
| 구현 · 시험 | 끝(1105 · G1 ~ G7 · tsc 0 · 0 · vitest 759 / 11,515 · 실 PG 56 / 398(c104-same-input-1105.pg 11) · 계약 c104-contract-1105 18 · 변이 5 / 5 빨간불 · 옛 시험 8 파일 정정 = 바뀐 판정 줄) |
| 문서 | 뿌리 대장 R58 신설 · R5 · R56 넓힘 · 배포 원장 C104 · C104-S1 · 직원 시트 30 ~ 32 |
| Codex 구현 | 1R 지적 3 · 2R 2 · 3R 1(같은 뿌리 = 구조 정정 두 번) 수용 · 4R approve(1105 · §10-2) |
| 배포 | 67d7b5d3 push 1105 · 서버 배포 = C105 · C106 · 브랜드메세지와 한 배포(Harold 1105) · 배포 뒤 C104-S1 |

## §1 접수 사실(실측)

- **A/B**: 초안 여정 1번째 칸에 A안 · B안을 저장 → 작업 화면 휴대폰 = 기본 문안(`[혜택 안내: 직접 수정해주세요]` · `[URL 입력]` 남음) · 점검 판 「1번째 칸 본문에 채울 자리 [...]가 남아 있어요. 직접 고쳐 주세요.」 · 켜기 막힘. 그 문구 = 켜기 관문 `journey-builder.ts:1005` 글자 그대로(접수 첨부 3장 · 15:38 = C103 배포 전 화면).
- **인원**: 인비토 회사(c7c97996) · 「고른 고객에게」 · 구매횟수 = 0 → 여정 [시작] 카드 「지금 맞는 929명」 · 미리 보기 929명 / AI한줄로 1,084명 / 고객 DB 1,084명.
  - Harold 실행 SQL(1105): 같은 번호 여러 행 = 아님(1,084행 = 1,084번호) · 수신거부 표시 · 무효 · 080 명부 = 0 · 몰 동의 분류코드 = 없음 · 작성자 = user · 분류코드 없음 · **등록 7일 안 = 155 · 7일 넘음 = 929**(등록 2026-10-29 22:00 ~ 11-04 22:06 UTC).
  - 원인 = 「고른 고객에게」 이관 유예(`journey-intake-grace.ts:84-89` · 기본 7일 · 추출 `journey-target-extractor.ts:445-452`). 계산은 설계대로 · **화면이 그 이유를 말하지 않는다**.

## §2 같은 증상의 정의 · 여섯 번의 구조체크가 놓친 이유

- **S1 같은 사실 · 다른 입력**: 같은 사실(나갈 글 · 대상)을 여러 자리가 계산하는데 자리마다 입력이 다르다. 함수가 하나여도 넣는 글 · 넣는 조건이 다르면 두 벌이다.
- **S2 서버가 거른 이유를 화면이 말하지 않는다**: 계산은 맞지만 화면이 그 차이를 설명하지 않아 직원이 「틀렸다」고 본다(R56 의 수 판).
- 놓친 이유(문서 · 코드 사실): 11-01 원장 §0 M1 「모두 같은 판정을 쓰나는 보지 않았다」의 처방 계약(`journey-deploy2-1101.test.ts` 「판정 두 벌 0」)은 **같은 함수를 부르는가**만 본다. 켜기 관문 · 켜기 검증이 같은 판정 함수(`journeyCopyIssue`)를 부르지만 넣는 글이 다르다(기본 문안 · 나갈 판). 대상 인원 세기는 10-23 · 10-25 · 11-01 · 11-04 구조체크 문서 어디에도 축이 없었다(문서 grep 0).
- 이번 처방의 계약은 **입력을 본다**: 나갈 글을 판정 · 표시하는 자리 = 나갈 판 목록 CT(`stepSendVersions`)를 지난다 · 대상을 세는 자리 = 실제 진입과 같은 입력 CT 하나를 지난다(§6).

## §3 흐름 표(기계 추출 · 1105)

추출 = 작업 폴더 `c104_copy_sites.py`(여정 칸 글 `message_template` · `message_body` · `messageTemplate` 을 읽는 함수 전수 56 · 백엔드 + 화면) · 대상 함수 부르는 자리 grep 전수. 빈칸 0.

### 3-1 나갈 글 축(판정 · 표시 · 발송 자리)

| 자리 | 역할 | 나갈 판 경유 | 판정 |
|---|---|---|---|
| `journey-builder.ts` `activationBlockReason` | 켜기 관문 · 점검 판(forCheck) | **아님(기본 문안)** | **G1** |
| `journey-pretest-validator.ts` `validateJourneyForActivation` | 켜기 검증 · 점검 판 | 예(`stepSendVersions`) | 맞음 |
| `journey-executor.ts` `processMessageBatch` | 실행 · 보낼 글 판정 · 렌더 | 예 | 맞음 |
| `journey-pretest-notifier.ts` `processBundle` · `weeklyCheckStep` | 보내기 전 · 주간 검사 | 예 | 맞음 |
| `journey-message-render.ts` `journeyStepCopyIssueNow` | 보류 관문 | 예 | 맞음 |
| `journey-pretest-validator.ts` `journeyStepSpamParams` | 지금 스팸 검사 글(C103) | 예(첫 판 · §11) | 맞음 |
| `journey-builder.ts` `fillJourneyCopyFacts` | 혜택 · 링크 넣기 | **아님(칸 행만 채움 · A/B 판 그대로)** | **G2** |
| `journey-lifecycle-map.ts` `buildLifecycleMap` 619 `LEFT(message_template, 60)` | 지도 · 카드 칸 미리보기 | **아님** | **G4** |
| 화면 `JourneyAbCopyList.tsx` `abCopyLocked` · 서버 `updateJourneyStep` A/B 잠금 | 칸 편집기 · 문안 수정 창 · 칸 저장 | 켜진 여정만 A/B 판을 보임 · 초안 · 멈춤 = 기본 문안 편집기 | **G3** |
| `journey-builder.ts` `assertStepCopySendable` | 켜진 여정 칸 글 고침 판정 | 아님 · 고친 기본 문안 자체가 대상(A/B 칸 고침 = G3 이 먼저 막음) | 맞음(이유 붙은 예외) |
| `journey-builder.ts` `kakaoStepCopyIn` · `journey-kakao-step.ts` | 알림톡 칸(A/B 판 없음 · 실행기 = 템플릿) | 해당 없음 | 맞음 |
| `journey-step-campaign.ts` `createStepCampaignRow` | 발송 캠페인 행 | 실행기의 대표 렌더 글 | 맞음 |
| `journey-executor.ts` `reserveJourneyOperationCredit` · `journey-builder.ts` `getJourneyStats` · `createStepSnapshot(s)` · `insertJourneyStepRow` · `getJourneyDetail` · `journey-lineage.ts` | 행 복사 · 통계 · 확정본(기본 문안 판 = 실행기가 변이와 합친다) | 판정 · 표시 아님 | 해당 없음 |
| 생성기 · 편집기(`journey-ai-editor` · `journey-ai-generator` · `createJourneyFromTemplate` · `generateCustomSteps*` · `journey-step-diagnosis` · `variant-generator` · `bandit-optimizer` · `routes/ai.ts journeys-ai-edit` · 화면 `DateAnchorJourneyBuilder` · `JourneyStepStudio` · `toStudio` · `diffPatch` · `JourneysPage` 만들기 판) | 글을 만들거나 기본 문안을 고침 | 해당 없음(나갈 판을 판정 · 표시하지 않음) | 해당 없음 |

A/B 판 행 = 검증 · 실행이 같은 집합을 읽는다(`loadVariantRowsByStep` · `listJourneyStepVariants` 둘 다 `journey_step_variants WHERE step_id` 전부 · 조건 같음 · 확인 1105).

### 3-2 대상 인원 축(대상을 세거나 뽑는 자리)

실제 진입 = `journey-trigger-watcher.ts:343 · 387` = 여정 id · 재진입(`allow_reentry` · `reentry_cooldown_days` · **계보 목록** `lineageJourneyIds`) · 작성자 범위(`getJourneyOwnerScopeSql`) · 작성자 동의(`journeyOwnerConsent`) · 상한 · 하루 몫.

| 자리 | 화면 | 실제 진입과 다른 입력 | 판정 |
|---|---|---|---|
| 옵션 dryRun `routes/ai.ts:4012-4020` | [시작] 카드 「지금 맞는」 | 재진입에 **계보 목록 없음**(새 판 = 옛 판이 보낸 고객까지 셈) | **G5** |
| `journey-simulator.ts:81 · 85` | 「켜면 어떻게 될지」 들어올 고객 · 보낼 문자 · 비용 | **재진입 없음** | **G5** |
| `routes/ai.ts:3881 · 3882` 대상 목록 · `countJourneyTargetCustomers` | [타겟 확인] | **재진입 없음** | **G5** |
| `journey-activation.ts:74` `storeCallbackExposure` | 켜기 「미등록 매장번호 N명」 | 재진입 없음(대상 전원 기준 경고) | **G5**(같은 입력 CT 로) |
| `routes/ai.ts:987` 만들기 전 미리보기 | 만들기 창(여정 없음) | 여정 없음 · 작성자 = 요청자 = 실제 작성자 | 맞음(이유 붙은 예외) |
| `journey-message-render.ts:158` 표본 고객 | 받는 모습 표본 1명 | 표시용 1명 | 맞음 |
| 위 화면 전부 | 「지금 맞는 N명」 · 미리 보기 | **이관 유예로 빠진 수를 말하지 않음** | **G6** |
| 자동마케팅 `operator-audience.ts:338` | 승인 카드 대상 · 발송 | 조건 만드는 자리 1곳(`buildSegmentPredicate` 실사용 1) | 맞음 |
| 켜기 창 「7일 트리거 N건」 `estimateCost` | 지난 7일 진입 기록 수 | 다른 양(이력) · 같은 사실 아님 | 해당 없음 |

### 3-3 그 밖에 같은 꼴로 확인한 것(결함 아님 · 기록)

- 회신번호(고객마다 다른 번호): 여정 「고객 매장번호로 보내기」 = 매장 전화번호 → 고른 번호 → 회신번호 칸 · 직접발송 「개별회신번호」 = 회신번호 칸 → 매장 전화번호(`callback-filter.ts`). 각 화면은 자기 이름대로 나간다(본 것 = 나가는 것) · 두 규칙을 하나로 맞출지는 Harold 결정(1105 질의 · 이 카드 밖 · §11).

## §4 결함 장부

| ID | 뿌리 | 결함 | 접수 |
|---|---|---|---|
| G1 | R5 · R58(새) | 켜기 관문이 기본 문안만 판정 · A/B 판이 나가는데 기본 문안 채울 자리로 막음 · 점검 판도 같은 줄 | A/B |
| G2 | R5 · R58 | 혜택 · 링크 넣기가 칸 행만 채움 · A/B 판의 채울 자리는 남는데 「모든 문자 칸에 넣었어요」 | A/B(같은 증상) |
| G3 | R5 | 초안 · 멈춘 여정의 A/B 칸 = 기본 문안 편집기 · 휴대폰(나가지 않는 글)을 보이고 고치게 함 | A/B |
| G4 | R5 | 지도 · 카드 칸 미리보기 = 기본 문안 앞 60자 | A/B(같은 증상) |
| G5 | R58 | 대상을 세는 자리 넷(시작 카드 · 시뮬레이터 · 대상 목록 · 미등록 매장번호)이 실제 진입과 다른 재진입 입력(없음 · 계보 없음) | 인원(같은 증상) |
| G6 | R56 | 이관 유예로 빠진 고객 수를 [시작] 카드 · 미리 보기가 말하지 않음 | 인원 |
| G7 | R1 | 점검 판 「고칠 것」 합치기가 A/B 판 항목을 같은 것으로 세지 않음(G1 뒤 같은 채울 자리가 두 줄) | A/B(G1 이음매) |

R58(새 뿌리) = 「같은 함수를 불러도 입력(글 · 대상 조건)이 자리마다 다르면 두 벌이다」 · 판정 기준 = 같은 사실을 계산 · 표시하는 자리는 입력도 CT 한 곳에서 받는다 · 시험 = §6 C1 · C2(대상 = 소스 추출).

## §5 처방

### G1 켜기 관문 = 나갈 판으로 판정
- `activationBlockReason` 의 칸 JSON 에 `id` 를 더하고, 문자 칸(sms · lms · mms)은 `stepSendVersions({ message_template, subject }, null, 그 칸 A/B 판)`(A/B 판 = `loadVariantRowsByStep` 한 번 · 켜기 검증과 같은 집합 · 확정본 null = 켜기 검증과 같은 규칙)의 **판마다** 지금 검사(길이 · 채울 자리 · `journeyCopyIssue` · LMS/MMS 제목)를 한다.
- 막는 문구: A/B 판이면 `${order}번째 칸 ${variant_id}안` 을 앞에 둔다 · 채울 자리 문구 끝 = A/B 판이면 「A/B 창에서 고쳐 주세요.」 · 아니면 지금 문구 그대로(「직접 고쳐 주세요.」).
- 알림톡 칸 = A/B 판 없음(지금 그대로 · 켜기 검증과 같은 `[]`).

### G2 혜택 · 링크 넣기 = 초안 · 멈춘 여정은 A/B 판도 채우고, 켜진 여정은 채우지 못한 판을 말한다
- 초안 · 멈춘 여정: `fillJourneyCopyFacts` 의 같은 잠금 · 같은 트랜잭션에서 문자 칸의 A/B 판 행(`loadVariantRowsByStep(ids, run)`)에도 칸 행과 같은 `fillBenefitSpots` · `fillLinkSpots` 를 적용해 `UPDATE journey_step_variants SET message_template = $3, subject = $4 WHERE id = $1 AND step_id = $2`(값이 바뀐 판만 · 판 제목은 값이 있을 때만). 멈춘 여정은 다시 켤 때 켜기 검증이 판마다 다시 보고(`validateJourneyForActivation`) 켜기가 새 확정본을 만든다(`createJourneyStepSnapshots`).
- **켜진 여정: A/B 판을 건드리지 않는다**(Codex 설계 2R · 구조 정정). 켜진 여정의 A/B 판 고침에는 그 나름의 상태 규칙(보류 칸만 · 새 확정본 · 신뢰도 0 · 재검사)이 있어 채우기 길이 그 규칙을 다시 흉내 내면 이음매가 빈다(1R 보류 판정 · 2R 확정본 전이 = 같은 뿌리 두 번). 대신 채우기 응답에 **채울 자리가 남은 A/B 판 수**(`variantsLeft` · 판 글 = `hasUneditedJourneyPlaceholder` · 켜기 · 실행기와 같은 자리 판정)를 싣고, 화면 안내 = 「모든 문자 칸에 혜택을 넣었어요. A/B 문안 ${n}개는 A/B 창에서 넣어 주세요.」(n > 0 일 때 · 링크도 같은 꼴) = 거짓 「모두 넣었어요」 0(S2).
- 남은 판의 길 = 지금 그대로(켜진 여정 A/B 판 고침 = 보류 칸에서 A/B 창 · 실행기 보낼 글 판정이 그런 판이 있는 칸을 보내기 전에 보류).

### G3 A/B 칸 = 상태와 무관하게 나갈 판을 보이고 기본 문안 잠금
- 화면 `abCopyLocked(status, variants)` = A/B 판 1개 이상이면 참(상태 무관) · 서버 `updateJourneyStep` 의 A/B 잠금도 상태 무관(같은 잠금 안 판정).
- 문구 = 상태별 한 쌍(화면 · 서버 같은 글 · 짝 시험): 켜진 여정 = 지금 문구 그대로 · 그 밖 = 「A/B 문안이 있는 칸은 A/B 창에서 고쳐 주세요. A/B 문안을 모두 지우면 이 칸 문안으로 나가요.」 · 화면 함수 `abStepCopyLockedMessage(status)` · 서버 같은 이름.
- 채우기 길(G2)은 지금처럼 잠금 밖(모든 칸 · 모든 판을 같이 채운다). 잠긴 A/B 칸에서도 칸 편집기의 「혜택 · 링크 넣기」 줄은 보인다(`JourneyStepStudio.tsx:270` `!copyLock && factsRow` → `factsRow` · 모든 문자 칸이 A/B 인 여정도 채울 길이 남는다 · SC-13).

### G4 지도 칸 미리보기 = 나갈 판
- `buildLifecycleMap` 칸 미리보기: A/B 판이 있으면 「A/B N개 · 」 + 첫 판 글(판 글이 비면 칸 글 · `applyVariantToStep` 규칙) 앞 60자 · 없으면 지금 그대로. 화면 두 곳(지도 · 카드)은 서버 글을 그대로 그린다(화면 변경 0).

### G5 대상을 세는 자리 = 실제 진입과 같은 입력 CT 하나 · 실제 모드와 추정 모드를 가른다
- 새 CT `journey-target-extractor.ts` `journeyEntryInputs(companyId, journeyId, override?)` = `{ reentry: { allowReentry, cooldownDays, lineageIds }, scopeSql, consent }`(여정 행 · `lineageJourneyIds` · `getJourneyOwnerScopeSql` · `journeyOwnerConsent`).
  - override = 저장 전 재진입 값(`allowReentry` · `cooldownDays`) · 옵션 주소가 쓰는 두 자리 = dryRun 세기 · **켜진 여정 옵션 저장의 상한 판정**(`routes/ai.ts` 옵션 주소 `STANDING_COUNT_TRIGGERS` · cap 비교 · 같은 matched · Codex 설계 1R).
- 부르는 자리: 실제 진입(watcher · 추출 입력 = 이 CT · 잠금 뒤 계보 다시 읽기는 그대로 SC-10) · 옵션 dryRun · 시뮬레이터(세기 · 평균) · 대상 목록 · 대상 수 · 미등록 매장번호. `countJourneyTargetCustomers` · `averageTargetScores` · `storeCallbackExposure` 에 재진입 인자를 더한다.
- **세기 두 모드(Codex 설계 1R)**: 실제 모드 = 「지금 조건에 맞는 고객」이 곧 다음 회차 대상인 트리거(`STANDING_COUNT_TRIGGERS` = 고른 고객에게 · 휴면 전환 · 옵션 주소와 같은 집합) · 세기 = 실제 진입과 같은 SQL · 같은 입력. 추정 모드 = 사건형 · 이어받기(`journey.after` 미리보기 = 최근 7일 근사 · `journey-target-extractor.ts:426-429`) · 실제 진입은 커서 · 사건마다라 미리 셀 수 없다 → 화면이 「최근 사건 기준 약」으로 말한다(시작 카드는 지금도 `approximate` · **시뮬레이터 응답 · 화면에도 같은 표시**를 더한다 = S2). C2 는 실제 모드 자리에 건다 · 추정 모드 미리보기 함수 = 이유 붙은 예외.

### G6 이관 유예로 빠진 수를 말한다
- 새 함수 `countJourneyTargetsWithGrace(companyId, triggerEvent, filters, journeyId, inputs)` = **한 SQL 한 번 훑기**(Codex 설계 1R · 같은 스냅숏): 유예를 끈 대상 SQL(`intake_grace_days: 0` · SC-9) 위에서 `COUNT(*) FILTER (WHERE c.created_at <= NOW() - 유예)` = 지금 대상 · `COUNT(*) FILTER (WHERE c.created_at > NOW() - 유예)` = 유예로 빠짐(이관 유예 조각 `buildIntakeGraceClause` 와 같은 식 · 정수 일수만). 유예 대상 트리거가 아니거나 유예 0 이면 지금 대상만(빠짐 0).
- 옵션 dryRun 응답에 `graceHeld` · `graceDays` · 시뮬레이터 응답 warnings 에 한 줄(실제 모드 트리거만).
- 문구(약속하지 않는다 · Codex 설계 1R): 「등록한 지 ${graceDays}일이 안 된 ${graceHeld}명은 지금 빠져 있어요. ${graceDays}일이 지난 뒤에도 조건에 맞으면 들어와요.」 · 문구 CT = 화면 `journey-cap-copy.ts` 옆 함수 · 서버 시뮬레이터 = 같은 글(짝 시험).

### G7 점검 판 합치기
- 켜기 관문 결과를 구조로 낸다: 새 `activationBlockIssue(companyId, journeyId, opts)` = `{ message, stepOrder?, variantId?, cause }`(cause = `placeholder_unedited` · `copy_issue` · `subject_missing` · `too_short` · `definition` · 켜기 검증 실패 원인 코드와 같은 이름 공간) · `activationBlockReason` = 그 message(지금 부르는 곳 그대로).
- `checkJourney` 합치기 = **같은 칸 · 같은 판(variantId) · 같은 원인(cause = 검증 실패 reason)** 의 「고칠 것」이 이미 있을 때만 관문 줄을 뺀다 · 다른 판 · 다른 원인은 둘 다 남긴다 · 관문 줄 고칠 곳(fixTarget) = cause 로(채울 자리 · 글 문제 · 짧음 = body · 제목 = subject · 그 밖 = 칸 · 여정) (Codex 설계 1R).

## §6 계약 · 시험

| ID | 계약(대상 = 소스 추출 · 손 등재 = 이유 붙은 허용 목록만) |
|---|---|
| C1 R58 나갈 글 | `utils/journey-*.ts` · `routes/ai.ts` 함수 중 칸 글 판정(`journeyCopyIssue(` · `hasUneditedPlaceholder(` · `hasUneditedJourneyPlaceholder(`)을 부르는 함수 = 같은 함수에서 `stepSendVersions(` 를 부르고 **판정 인자에 칸 행 글 직접 읽기(`message_template` · `s.message` · `.messageTemplate`) 0**(입력 일치 · Codex 설계 1R) · 허용 = `assertStepCopySendable`(고친 기본 문안 자체) · 생성기(이유 붙음) |
| C2 R58 대상 입력 | 여정 id 를 넘겨 `selectJourneyTargetCustomerIds(` · `countJourneyTargets(` · `countJourneyTargetCustomers(` · `countJourneyTargetsWithGrace(` · `averageTargetScores(` · `storeCallbackExposure(` 를 부르는 자리 = 감싼 함수가 `journeyEntryInputs(` 를 부르고 **범위 · 동의 · 재진입 인자가 그 결과 값**(입력 일치) · 허용 = 만들기 전 미리보기(여정 없음) · 추출 파일 내부 위임 · 추정 모드 미리보기(이어받기 근사) |
| C3 G3 | 화면 `abCopyLocked` 에 상태 조건 0 · 서버 A/B 잠금에 상태 조건 0 · 문구 한 쌍 = 화면 · 서버 같은 글 |
| C4 G2 | `fillJourneyCopyFacts` 본문 = `journey_step_variants` 갱신 · 켜진 여정 = 판 갱신 0 · `variantsLeft` 응답 · 화면 안내가 그 수를 말한다 |
| C5 G6 | 화면 [시작] 카드 · 시뮬레이터가 유예 문구 CT 를 부른다 |
| 실 PG | G1(초안 · 기본 문안 채울 자리 + A/B 판 깨끗 = 막지 않음 · A/B 판 채울 자리 = 「1번째 칸 A안」으로 막음) · G2(초안 · 멈춤 = A/B 판 채움 · 켜진 여정 = 판 그대로 + variantsLeft 수 · 켜진 여정 보류 칸 A/B 저장 직후 채우기 = 판 그대로 + 수) · G3(초안 A/B 칸 기본 문안 고침 409) · G4(지도 미리보기 A/B) · G5(계보 · 재진입 = 실제 진입과 같은 수) · G6(등록 7일 안 고객 = graceHeld) · G7(점검 판 한 줄) |

## §7 배포 순서
- DDL · DML · ENV 0(칸 · 표 새로 0 · `journey_step_variants.message_template` · `subject` = 기존 칸).
- 백엔드 build:safe · 프론트 build:safe · 적재 0 조건 재시작 · 배포 뒤 확인 · C104-S1 직원 시트.

## §8 직원 시트(C104-S1 · `docs/2026-11-05-c104-staff-sheet.xlsx` · 시트 30 ~ 32 · 단추 이름 = 화면 글자 대조 1105)
- 30 A·B 문안: 초안 문자 칸(기본 문안에 [혜택 안내 …] 남음)에 「A/B 문안 시험」으로 A안 · B안 → 그 칸 = A/B 문안 목록 + 초안 잠금 문구 · 점검에 채울 자리 없음 · 「켜기」 확인 창까지 감 · B안에 자리를 남기면 점검 「채울 자리가 남았어요 (A/B 판)」 한 줄 · 「켜기」 = 「1번째 칸 B안에 채울 자리 … A/B 창에서 고쳐 주세요.」 · 「혜택 넣기」 뒤 B안에도 혜택 · 지도 칸 글 「A/B 2개 · 」 · 켜진 여정이면 「A/B 문안 N개는 A/B 창에서 넣어 주세요.」
- 31 인원: 최근 7일 안 등록 고객이 있는 회사 · 「고른 고객에게」 + 「전체 고객에게 보내기」 → 「지금 맞는 N명」 아래 「등록한 지 7일이 안 된 M명은 지금 빠져 있어요. 7일이 지난 뒤에도 조건에 맞으면 들어와요.」 · N + M = 고객 DB 수 · 메뉴 「켜면 어떻게 될지 미리 보기」 같은 수 · 같은 줄 · 사건형 = 「최근 사건 기준 약」.
- 32 고친 뒤 인원: 켜진 「고른 고객에게」 여정 인원을 적고 칸 보내는 방식을 바꿔 저장(새 모양 · 다시 켜짐) → [시작] 카드 「다시 세기」 = 적은 수 · 여정 목록 「발송 대상 확인」 전체 인원 = 같은 수.

## §9 설계 구조체크

| # | 이음매 | 확인 | 처방 반영 |
|---|---|---|---|
| SC-1 | G1 forCheck 경로 = 점검 판도 같은 관문 | `journey-check.ts:101` 같은 함수 | G7 합치기 |
| SC-2 | G1 판 목록의 칸 채널 · 제목 · 변이 빈 글 | `stepSendVersions` · `applyVariantToStep`(변이 빈 글 = 칸 글) | 판정 = 판마다 · 제목 = 판 제목 |
| SC-3 | G2 켜진 여정 A/B 판 고침 = 보류 칸만(3-16) | 켜기 검증이 판마다 채울 자리를 막음 = 켜진 여정 판에 채울 자리 0 | 켜진 여정 = 판 안 건드림 + 시험 |
| SC-4 | G3 초안에서 기본 문안을 고칠 길 | A/B 판을 모두 지우면 기본 문안으로 나간다(실행기 = 판 0 이면 칸 글) | 문구에 그 길을 적음 |
| SC-5 | G3 서버 잠금이 채우기 길 · 새 모양 · 복제에 걸리는가 | 채우기 = `applyStepPatchInLock` 직접(잠금 판정 밖) · **새 모양 = 복제본(초안 · A/B 판도 복사 `journey-lineage.ts:315`)에 `updateJourneyStep` 으로 칸 패치(`journey-reshape.ts:123`)** · 화면이 켜진 여정 A/B 칸 기본 문안 편집을 이미 잠가 새 모양 패치에 기본 문안 키가 실리지 않는다 · 실리면 같은 409 → 새 모양이 복제본을 지우고 409(맞는 동작) | 잠금 = `updateJourneyStep`(사람 고침 · 새 모양) · 채우기 밖 · 실 PG 시험에 새 모양 A/B 칸 갈래 |
| SC-6 | G5 override(저장 전 dryRun 의 재진입 값) | 옵션 dryRun 은 저장 전 값으로 센다 | CT override 인자 |
| SC-7 | G6 유예 수 = 두 번 세기 비용 | 이관 유예 대상 트리거만 · 「고른 고객에게」 · 휴면 등 | 대상 트리거만 · 유예 0 이면 한 번 |
| SC-8 | G6 상한(cap) 갈래의 dryRun = 목록 cap+1 | 유예 수는 세기 함수로 따로(상한과 무관) | 유예 수 = 세기 함수 |
| SC-9 | G6 「유예 0으로 센 수」 = 정말 0일인가 | `clampInt(0, 7, 0, 90)` = 0(빈 값 · 숫자 아님만 기본값 · `journey-points-trigger.ts:27-30`) | 거름 끔 = `intake_grace_days: 0` |
| SC-10 | G5 실제 진입을 CT 로 바꿀 때 계보 값 | 진입 감시는 추출 앞 `lineageJourneyIds`(288) · 잠금 뒤 `lockLineageEntry` 로 다시 읽은 계보(610)를 넣기 판정에 쓴다 | CT = 추출 입력만 · 잠금 뒤 다시 읽기는 그대로 |
| SC-11 | G1 판마다 제목 · 판정 맥락 | 판 제목 = 판 제목 또는 칸 제목(`applyVariantToStep`) · `journeyCopyContext` = 판 글로 | 켜기 검증과 같은 입력 |
| SC-12 | G3 잠금이 켜진 여정 사람 고침 문구와 섞이는가 | 켜진 여정 = 지금 문구 · 그 밖 = 새 문구 · 화면 · 서버 같은 함수 이름 | 문구 한 쌍 짝 시험 |
| SC-13 | G3 잠금이 혜택 · 링크 넣기 입력까지 가리는가 | `JourneyStepStudio.tsx:270` `!copyLock && factsRow` | 잠긴 칸에서도 보임(G3 처방) |

## §10 Codex 설계 판정

| 라운드 | 지적 | 판정 | 반영 |
|---|---|---|---|
| 1R | G5 이어받기 · 사건형 미리보기 = 최근 사건 근사(실제 진입 입력과 다름) | 수용 | 실제 모드 · 추정 모드 분리 · C2 = 실제 모드 · 시뮬레이터 추정 표시 |
| 1R | G6 두 번 세기 사이 데이터 변화 | 수용 | 한 SQL `COUNT FILTER` |
| 1R | G6 문구가 유예 뒤 진입을 약속 | 수용 | 「지금 빠져 있어요 · 지난 뒤에도 조건에 맞으면」 |
| 1R | G7 합치기가 다른 판 · 다른 원인을 숨김 | 수용 | 관문 결과 구조(칸 · 판 · 원인) · 같은 셋만 합침 |
| 1R 보강 | C1 · C2 = 입력 일치 · override 적용 자리 · G2 불변 근거 | 수용 | C1 · C2 입력 계약 · 켜진 여정 상한 판정 · G2 = 켜진 여정 보류 칸 판만(2R 에서 다시 정정) |
| 2R | G2 켜진 여정 보류 칸 판 채우기 = 확정본 전이(보류 A/B 저장 뒤 새 확정본 → 보류 아님 · 판만 바뀌면 확정본 0 → 재검사 7일 뒤) 누락 | 수용 · **1R 과 같은 뿌리 = 구조 정정** | 켜진 여정 = 판을 채우지 않는다 + 남은 판 수를 말한다(새 상태 규칙 0 · 켜진 여정 A/B 고침 = 지금 길 그대로) |
| 3R | 지적 0 · approve · 구현 주의 = variantsLeft 는 빈 값을 칸 글로 채운 판 본문 · 제목 중 하나라도 채울 자리가 남은 판을 판마다 한 번 | 반영 | 구현 · 시험에 그 사례 |

## §10-2 Codex 구현 판정

| 라운드 | 지적 | 같은 뿌리? | 판정 | 반영 |
|---|---|---|---|---|
| 1R | A/B 만들기 · 지우기 뒤 작업 화면 상세(ab_variants)가 그대로 = 잠금 · A/B 목록이 옛 상태(초안에서 만든 뒤 기본 문안 편집기가 남아 저장 409) | 새(R56 · 서버 값을 화면이 안 따라감) | 수용 | 편집기 글 바뀐 네 갈래 뒤 `onCopyChanged` → 작업 화면 sync 다시 읽기 · 칸 글을 고친 채 A/B 를 열면 먼저 저장 안내 |
| 1R | 혜택 · 링크 줄 표시 판정(slotsLeft)이 칸 글만 봄 = A/B 판에만 자리가 남으면 줄이 사라짐 | **R58 화면 쪽**(G1 과 같은 뿌리 · 화면 층) | 수용 | 화면 나갈 글 공용 함수 `abSendCopies` · slotsLeft · A/B 목록 그리기가 같은 함수 · 계약 「C1 화면 R58」 |
| 1R | 계약 C1 · C2 가 인자 꼴(끝말)만 보고 값 출처를 안 봄 | 새(시험 강도) | 수용 | 감싼 함수 안 선언을 따라 올라가는 출처 추적(declOf · traceText · fromEntryInputs) + 반례 시험 · 변이 6 / 6 빨간불 |
| 2R | 편집 칸 머리 「A/B」 단추가 저장 안내를 우회 · 비율 적용도 판 글을 쓰는데 부모 갱신 빠짐 | **1R 첫 줄과 같은 뿌리**(동기화 · 안내를 호출 자리마다 덧댐) | 수용 · 구조 정정 | 여는 길 = `openVariants` 하나 · 편집기 = 모든 쓰기가 끝에 부르는 `loadVariants` 의 처음 읽기 뒤 다시 읽기 = 부모 알림(덧댄 afterCopyWrite 삭제) · 계약 = 쓰기 fetch 마다 다시 읽기 · setVariantsOpen 인자 · 변이 4 / 4 |
| 3R | 비율 적용이 중간에 실패하면 이미 저장된 판이 화면에 안 반영 | **같은 뿌리 세 번째** · 왜 = 알림을 성공 때만 부르는 읽기(loadVariants)에 매달았다 · 효과는 쓰기 요청에서 생긴다 | 수용 · 구조 정정 | 쓰기 다섯 = `writeFetch` 하나 · finally(성공 · 실패 · 예외)에서 부모 알림 · 읽기 쪽 장치 삭제 · 계약 = POST · DELETE 마다 writeFetch · 변이 3 / 3 |
| 4R | 지적 0 · approve | | | |

## §11 남은 위험 · 범위 밖(기록만)
- (AI한줄로) 혜택 달력 기간(11/1 ~ 30) = 새 기능 요청 · 설계 따로.
- 회신번호 고객별 규칙 두 벌(여정 매장번호 · 직접발송 개별회신번호) = Harold 결정 대기(1105 질의 B안 추천).
- 「지금 스팸 검사」 A/B 칸 = 첫 판만(C103 기록 · 나머지 판은 켤 때 · 보내기 전 검사).
- 고객 목록 주소 정수 자리 NaN 500(1105 13:58 운영 로그 · 옛 `customers.ts:193`) = 범위 밖 새 발견 · Harold 착수 판단.
- 재진입 허용 · 쿨다운 0 에서 지금 여정 진행 중 고객을 추출은 넣고 진입 INSERT 는 빼 인원이 다를 수 있음(Codex 구현 1R [범위 밖] `journey-safety-filter.ts:78`) = 기록만 · Harold 착수 판단.
