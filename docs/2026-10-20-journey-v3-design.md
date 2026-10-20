# 여정 V.3 대개편 설계서 (2026-10-20)

> 호출어 **여정 V.3 / 여정 대개편 / 켜진 여정 수정 / 지도 보기 쉽게** · 기능 상설 = [FEATURE-JOURNEY.md](FEATURE-JOURNEY.md) · 앞 설계 = [V2 마스터](2026-09-29-journey-v2-master-design.md) · [고객 관계 지도](2026-10-09-journey-crm-map-design.md)
> 상태 = **설계 승인(1020 Harold 「D1~D8 추천대로 승인. 여정 V.3 설계서 작성 시작해」 · D1 확정 「선불이든 후불이든 크레딧이 모자르면 둘 다 멈추는게 맞는거지 · 나머지는 추천안으로해」) · 코드 0 · DDL 0(D2 칸 1개 예정)**.

## 0. 요약

- 원칙 하나: **진행 중 고객이 이미 받은 것은 고치지 않는다. 고친 것은 다음에 일어날 일부터. 진행 중 고객을 다른 판으로 옮기지 않는다.**
- 켜진 여정에서 문안 · 간격 · 시작 조건 · 한도 · 재진입 · 홀드아웃 · 예산을 **그 자리에서** 고친다(지금은 문안만). 칸 모양처럼 진행 중 고객과 부딪히는 것만 **새 모양**(지금 있는 계보 장치를 한 흐름으로 다듬은 것 · 0크레딧)으로 간다.
- 처음 켜기 200 = **계보당 1번**(지금은 새 판을 켤 때 또 200). 운영 10 = **계보당 하루 1번**(지금은 옛 판 · 새 판이 같은 날 보내면 20). 「보낸 날만 하루 10」을 화면에 알린다.
- 요금제 내림 = 예상 크레딧(원장 사실 · 규칙 최대)이 새 요금제 기본을 넘으면 신청 창 경고 + 슈퍼관리자 승인 화면 같은 숫자. **그달 크레딧(기본 + 구매)이 모자라면 선불 · 후불 모두 여정을 멈춘다**(다음 달 당겨쓰기 없음 · D1). 요금제는 우리가 올리지 않는다. 다시 켜려면 고객사가 직접 요금제 상향을 신청하거나 크레딧을 채운다.
- 다시 켜기 구멍 4개(밀린 문자 몰림 · 멈춘 동안 사건 몰림 · 굳은 고객 · 하나씩 켜기 겹침 확인 누락)를 먼저 막고 지도에 [일시정지] [고치기]를 올린다.
- 상세 창 · 지도 칸 편집 창 · 지도 「자세히」 = **여정 작업 화면 하나**. 문자는 **큰 휴대폰**(폭 360~380 · 본문 16px)에서 바로 쓴다. 편집기 6벌 → 1벌.
- 지도 = **[한눈에] 요약 카드**가 기본(어디서 어디로 · 잘 되나 · 어디를 손보나). 지금 그림은 [칸까지]로 남긴다.
- 기존 고객 받기(하루 몫 나눠 받기 · 이미 쉬는 고객도 받기) · 「돌아온 고객은 환영만」 · 「마지막 구매 N일」 조건. 빈 도화지 직접 그리기는 하지 않는다.

## 1. 접수 · 축 대조표

| # | Harold 접수(1020) | 이 축이 없으면 안 닫히는가 → 닫는 절 |
|---|---|---|
| 1 | 휴면 · 신규 가입 틀과 상관없이 직접 조건 설정 | §7 |
| 2 | 켜진 여정은 문안만 수정 → 기간 · 조건 수정 못 하면 클레임 · 200 켜기 + 매일 운영 크레딧 점검 | §4 · §5 · §11(기간) |
| 3 | 지도에서 일시정지 · 수정 버튼 | §6 · §10 |
| 4 | 수정 창이 허접 → 큰 휴대폰 모양 · 글자 읽기 쉽게 | §9 |
| 5 | 켜진 여정 상세 창이 구림 | §9 |
| 6 | 기존 고객 대상 여정 · 휴면 복귀 → 단골 재구매 · 영업팀장 「직접 그리기」 | §8 |
| 7 | 200 낸 여정을 자유롭게 고쳐도 되나 · 언제부터 · 충돌(가장 걱정) | §4 |
| 8 | 고치기 크레딧 · 여정 잔뜩 켜고 요금제 내리기 → 경고 · 비활성 가능 경고 | §5 |
| 9 | 지도가 복잡하고 보기 힘듦 | §10 |

빠진 축 0. 범위 밖 발견은 §16에 기록만 한다.

## 2. 경위

1. 비토 구조 체크(improve-codebase-architecture) → 보고서(세션 산출물 `architecture-review-journey-v3.html`).
2. 브레인스토밍(COLLAB §1 · Harold 「발동」 2회) = 기획 · 프론트엔드 · 백엔드 · 디자이너 · 회의론자 5역할(읽기 전용) 1차 의견 → 교차 토론(안건 9 지도 추가) → 회의론자 최종 검증 「고친 뒤 예」 · 고칠 것 10개 전부 반영.
3. 토론에서 뒤집힌 것: 「문안 말고는 전부 보이지 않는 새 판」(회의론자 1차) → 「칸 번호가 안 바뀌는 수정은 그 자리」(백엔드) · 「켜기 멱등키를 계보로」 → 「판정만 계보 뿌리로」 · 「멈춘 시간만큼 밀기」 → 「일 단위로 올림해서 밀기」 · 「updated_at 으로 동시 수정 막기」 → 쓰지 않음(켜진 여정 updated_at 은 진입 · 완료 때마다 오름 · journey-trigger-watcher.ts:458 · journey-executor.ts:1447).
4. 설계서 작성 중 코드 대조로 새로 확인한 것: 운영 출처(journey-operation)는 선불 · 후불 구분 없이 −월 기본분까지 마이너스를 허용하고(ai-credit-tx.ts:91-95 · ai-credit-calc.ts:237), 그 아래는 차감 실패를 삼키고 공짜로 보낸다(executor:1325-1328). 「후불은 멈추지 않음」 추천의 근거가 틀렸다 → Harold 확정(§15-2): 선불 · 후불 모두 그달 크레딧이 모자라면 멈춤 · 마이너스(다음 달 당겨쓰기) 없음.

## 3. 불변 원칙과 코드 근거

| 원칙 | 근거 |
|---|---|
| 진행 위치는 칸 순서 번호다 | 다음 칸 = current_step_order + 1(journey-executor.ts:378-388) |
| 이미 보냄 판정은 (실행, 칸 id) 짝이다 → 실행을 다른 판으로 옮기면 보호가 사라진다 | executor:584-587 |
| 다음 칸 시각은 앞 칸을 보낼 때 그 칸 간격으로 정해 저장하고 다시 계산하지 않는다 → 간격을 그 자리에서 고쳐도 이미 잡힌 시각은 그대로 | executor:1469-1541 |
| 실행기는 발송 때 고객 조건을 다시 보지 않는다 → 조건을 고쳐도 진행 중 고객은 원래 조건으로 끝까지 | executor 안 customer_conditions 0건(grep) |
| 단, 목표 판정은 칸마다 그 자리 값을 읽는다(목표 종료 · 종류 · 상품 키) → 이 셋은 그 자리에서 바꾸면 진행 중 고객이 바뀐다 | executor:366-377 · 1590-1601 |
| 날짜 기준 · one_shot 실행은 칸 하나짜리 단발이다 | executor advanceOrComplete 단발 분기 · journey-anchor-scheduler.ts |
| one_shot 첫 발송 멱등은 여정 id 단위다 → 새 판이면 전원에게 다시 보낸다 | journey-anchor-scheduler.ts:253-255 |
| 과금 여부의 진실은 원장 하나다 | ai-credit.ts:128-155 |
| 기존 불변 원칙(FEATURE-JOURNEY §2) 그대로: 다른 여정으로 자동으로 태우지 않는다 · 과거분 소급 금지 · 상한 없이 켜지지 않는다 · 게이트는 실제로 시작되는 길목에 | FEATURE-JOURNEY.md §2 |

## 4. 고치는 범위 · 적용 시점 · 충돌 (접수 2 · 7)

### 4-1. 표 (서버 정책이 소유 · 화면은 응답만 그린다)

「그 자리」 = 켜진 채 저장 한 번 · 0크레딧. 「새 모양」 = §4-2 흐름 · 0크레딧.

| 고치는 것 | 켜진 여정에서 | 언제부터 · 누구에게 | 비고 |
|---|---|---|---|
| 문안(본문 · 제목) | 그 자리(지금과 같음) | 다음 발송부터 모두 · 저장하면 다시 검사 · 검사 대기 중 발송은 보류 | executor:636-661 그대로 |
| A/B 변형 문안 | 그 자리(변형 단위 · 칸 문안과 같은 재검사 관문) | 다음 발송부터 | 지금은 켜진 여정 변형 수정 · 삭제 막힘(bandit-optimizer.ts:536 · 597) |
| 간격 · 대기 방식 · 보낼 시각 | 그 자리(지금은 막힘 → 연다) | 이미 다음 시각이 잡힌 N명은 그 시각 그대로 · 그다음 칸부터 새 간격 | 화면 한 줄에 N(칸별 waitingHere) |
| 시작 조건(고객 조건 · 휴면 기준일 · 포인트 기준 등) · 한도(상한 · 칸 비용 · 위험도) · 재진입 | 그 자리 · 켜기 관문 공용 검사(§7-2) | 다음 진입부터 · 진행 중 N명은 원래 조건으로 끝까지 · 넓힐 때 저장 전 실발송 함수로 세고 상한 넘으면 저장 거부 · 상한 비우기 금지 | PATCH entry(§7-2) · options |
| 홀드아웃 | 그 자리 | 다음 진입부터 | |
| 개인 발송 시각 | 그 자리 | 다음 칸부터 | |
| 예산 | 그 자리 | 즉시 | |
| 목표 종료 켜기 | 그 자리(지금과 같음) | 즉시(덜 보내는 방향) | ai.ts:4526-4545 |
| 목표 종료 끄기 · 목표 종류 · 상품 재구매 여정의 상품 | 새 모양 | 새로 들어오는 고객부터 | 실행기가 그 자리 값을 칸마다 읽음 |
| 겹침 해소 옵션 끄기(첫 구매 빼기 · 돌아온 고객은 환영만) | 그 자리 + 겹침 확인 필수(§6-4 같은 판정) | 다음 진입부터 | 끄면 같은 구매 2통이 다시 생김 |
| 회신번호 · 회신 모드 | 새 모양(재검사 + 미등록 회신 확인) | 새로 들어오는 고객부터 | 실행기가 journeys 값을 바로 읽음(executor:205) · 매장 모드 전환이 미등록 확인을 우회(journey-activation.ts:61-83) |
| 칸 모양(채널 · 광고 · 칸 종류 · 조건 칸 · 이미지 · 알림톡 · 칸 추가 · 삭제 · 순서) | 새 모양. 멈춤 + 진행 중 0이면 지금처럼 그 자리(이미 보낸 칸 삭제는 새 모양 · journey-builder.ts:1720-1725) | 새로 들어오는 고객부터 | stepEditPolicy 의 structure 묶음 |
| 날짜 기준 여정(생일 · 소멸 · 기념일)의 기준일 · D-N | 새 모양 · 보낸 칸 잠금 · 같은 날 새 모양 켜기 막음 | 다음 회차부터 | 중복 표식 = (여정 · 칸 · 고객 · 발송일)(anchor-scheduler.ts:124-132 · 196-198) |
| one_shot(한 번 보내기) | 새 모양 금지. 보내기 전 = 멈춤 뒤 그 자리 · 보낸 뒤 = 새 여정 | | §3 |
| 시작 사건 | 못 바꿈 | 새 여정(처음 켜기 200) | 계보당 200 한 번의 남용 막기(D3) |
| 담당자 알림 | 그 자리 | 즉시 | 발송 내용 아님 |
| D2 「새 고객 받는 마지막 날」 | 그 자리(§11) | 그날 KST 끝까지 진입 · 다음 날부터 안 받음 · 진행 중은 끝까지 | |

정책 판정 자리는 두 곳이다. 칸 = `journey-step-edit-policy.ts`(stepEditPolicy · 지도 응답과 칸 PATCH 공용) · 여정 단위 = 옵션 주소(ai.ts:4506) · 자동 재진입(4462) · 회신번호(4286 → builder updateJourneyCallback:1790) · 변형(bandit-optimizer.ts:536 · 597). 여정 단위 판정은 새 순수 함수 `journeyOptionEditPolicy(status, startKind, keys)` 하나로 모아 네 주소가 같이 부른다(§12 영향표).

### 4-2. 새 모양 흐름 (지금 계보 장치의 숨은 구멍 정리)

지금 [새 판으로 고치기](journey-lineage.ts:158 createNewVersion)는 복제 초안을 만들고 끝난다. 사용자가 그 초안을 검사 · 켜기까지 따로 해야 하고, 그사이 구멍이 있다. V.3 흐름:

1. 사용자는 [고치기]에서 칸 모양을 바꾸고 [저장]을 누른다. 서버가 「새 모양이 필요한 변경」을 판정하면 409 `JOURNEY_NEEDS_NEW_SHAPE` + 한 줄(진행 중 N명 · 새로 들어오는 고객부터 · 추가 크레딧 0)을 돌려주고, 화면은 한 단계 확인을 띄운다(결과가 갈리는 갈림길).
2. [이렇게 바꾸기] = 서버 한 주소(`POST /operator/journeys/:id/reshape`)가 **복제 → 변경 적용 → 사전검사 → 켜기**를 한 흐름으로 한다. 어디서든 실패하면 복제 초안을 지운다(숨은 초안 0). 지금 「같은 계보 초안이 있으면 그것을 돌려준다」(lineage.ts:177-185)는 이 흐름에서는 쓰지 않는다(남는 초안이 없으므로).
3. 사전검사는 기존 검사 함수를 서버에서 부른다(pretest-validate 주소 · ai.ts:4985 본문을 함수로 꺼냄). 검사 실패 = 초안 삭제 + 실패 사유를 화면에 그대로.
4. 이름 접미사 「(새 판)」(lineage.ts:194)을 붙이지 않는다. 계보는 lineage_id 가 말한다.
5. A/B 변형을 복사한다(lineage.ts:156 · 229-233 은 지금 옮기지 않고 개수만 알림). 반응 통계는 새 칸에서 0부터 · 화면 숫자는 계보 합계(§9-4).
6. 일시정지 · 다시 켜기는 계보 전체에 적용한다(§6-5). 멈춘 옛 판도 진행 중 0이면 끝남(lineage.ts:244-252 endDrainedVersions 를 paused 까지 넓힘 · 단 사람이 멈춘 것은 다시 켤 때 계보 전체가 같이 켜지므로 끝남 판정은 「진입 닫힘 + 진행 중 0」만 본다).
7. one_shot 은 이 흐름에 들어오지 않는다(§4-1).
8. 날짜 기준 여정은 같은 KST 날짜에 옛 판이 보낸 칸이 있으면 그날 켜기를 막는다(다음 날 자정 뒤 켜짐 · 한 줄 안내).

### 4-3. 동시 수정

- updated_at 비교를 쓰지 않는다(켜진 여정은 진입 · 발송마다 오름 → 거짓 409).
- 여정 옵션 = 부분 PATCH + DB 안 병합(ai.ts:4553-4561) + 읽은 status 를 쓰기 조건(4589-4597)이 덮어쓰기를 막는다(지금 그대로).
- 칸 = 부모 여정 행 잠금 안에서 판정 · 갱신(withJourneyValidationReset · builder:1355-1380 · 지금 그대로).
- 새 모양 = 한 흐름이라 남는 초안이 없다. 같은 계보에 reshape 가 동시에 오면 계보 진입 잠금(lockLineageEntry · lineage.ts:69)으로 줄을 세우고 뒤 요청은 409.

### 4-4. 사전검사 표식 「유지 목록」 (D6)

지금 표식(last_pretest_passed_at)을 비우는 길목 8곳(grep 전수):

| # | 자리 | 지금 | V.3 |
|---|---|---|---|
| 1 | builder:1380 withJourneyValidationReset ← updateJourneyStep | 늘 비움 | 건드린 키가 전부 유지 목록이면 표식 유지 · updated_at 은 늘 올림(사전검사 CAS 판 · ai.ts:5012) |
| 2 | 같은 문 ← updateJourneyCallback(builder:1788) | 늘 비움 | 그대로 비움(회신번호는 유지 목록 아님) |
| 3 | 같은 문 ← bandit-optimizer.ts:533 | 늘 비움 | 그대로(변형 본문은 검사 대상) |
| 4 | 같은 문 ← bandit-optimizer.ts:596 | 늘 비움 | 그대로 |
| 5 | builder:1621 칸 추가 | 비움 | 그대로 |
| 6 | builder:1764 칸 삭제 | 비움 | 그대로 |
| 7 | ai.ts:4476 자동 재진입 켜기 | 비움 | 유지(재진입은 유지 목록) |
| 8 | ai.ts:4585 옵션 | 목표 키 외 비움 | 건드린 키가 전부 유지 목록이면 유지 |
| (9) | lineage.ts:149 새 판 복제 | 비움 | 새 모양 흐름 안에서 바로 다시 검사(§4-2 3) |

- 유지 목록(이 키만 건드렸을 때만 표식 유지): 칸 = delayHours · delayMode · targetHourKst · notifyManagerOnPretest / 여정 = 시작 조건(customer_conditions · logic · 휴면 기준일 · 포인트 기준 등 trigger_filters 의 대상 키) · thresholdRecipients · thresholdCost · thresholdRiskLevel · budgetMonthly · allowReentry · reentryCooldownDays · autoReentryEnabled · holdoutPct · personalSendTime · goalExitEnabled(켜기) · entry_ends_on.
- 그 밖 키가 하나라도 있으면 지금처럼 비운다(나열 방식이 아니라 「전부 유지 목록일 때만 유지」 · 새 키가 생기면 기본이 비움).
- 사전검사가 보는 것(문안 · 제목 · 채널 · 광고 · 이미지 · 회신번호 · 알림톡 템플릿 · 변수 매핑 · 대체 문안 · 칸 종류 · A/B 변형 · journey-pretest-validator.ts:96-105 · 131-142)은 유지 목록에 없다.
- 0802에 Codex 4라운드로 넓힌 문을 좁히는 일 → 이 묶음은 Codex 적대 필수 · 시험 = 키마다 「유지 / 비움」 표 고정.

### 4-5. 하지 않는 것

- 진행 중 고객을 새 판으로 옮기기(§3).
- 조건을 좁혔을 때 진행 중 고객 빼기([이 N명 빼기]) · 실행기가 발송 때 조건 다시 보기.
- 빈 도화지 자유 연결(§8-3).

## 5. 크레딧 (접수 2 · 8)

### 5-1. 처음 켜기 200 = 계보당 1번 (D3)

journey-activation.ts:85 `firstActivation` 한 값을 세 곳이 쓴다(과금 :86 · :109 / one_shot 첫 발송 :100 / 응답 :118). 둘로 쪼갠다.

- `isFirstOfVersion = status === 'draft'` → one_shot 첫 발송.
- `charge = status === 'draft' && COALESCE(lineage_id, id) = id` → 잔액 확인 · 차감.
- 판정 근거(회의론자 확인): 원 여정 lineage_id 는 첫 새 판 때 자기 id 로 채워지고 그전 NULL(lineage.ts:175) · 새 판과 새 판의 새 판은 뿌리를 받음(:174 · :193). 원장 조회 0회.
- 켜기 멱등키(`journey-activate:${journeyId}` · :115)는 그대로(원 여정 = 뿌리 = 자기 id).
- 켜기 SELECT(:45) · 묶음 SELECT(:168-171)에 lineage_id + 컬럼 가드(lineageColumnsReady · 없으면 charge = draft 그대로 = 옛 동작).
- 묶음 합계(:194-195) = charge 인 것만 센다.
- 응답: `firstActivation`(옛 이름 · 화면 호환) 대신 `charged: number`(이번에 낸 크레딧) 를 싣는다. 단건 라우트(ai.ts:3941)도 `charged` 를 돌려준다.
- 화면이 status 로 200 을 매기는 곳을 전부 서버 값으로: BatchActivateModal.tsx:114-115(합계) · 206(결과 문구) · 230(후보 문구) · JourneyActivationConfirmModal.tsx:524-528(확인 창 분기) · journey-map.ts:202(타입). 지도 · 상세 응답의 여정마다 `activationCost`(charge ? 200 : 0)를 싣는다.
- 시험 고칠 곳: journey-v2-phase2-activation-0930.test.ts:82 · 98 · 162.
- D4 실측(1020 Harold): 새 판 id 키로 받은 journey-activate 차감 0행 → 환불 대상 없음.

### 5-2. 운영 10 = 계보당 하루 1번

- 멱등키 `journey-operation:${exec.journey_id}:${KST날짜}`(executor:1421-1428) → `journey-operation:${계보 뿌리}:${KST날짜}`.
- 실행기 본 조회(executor:195-221) · 고아 표식 조회(294-305)에 `COALESCE(j.lineage_id, j.id) AS lineage_root` · ExecutionRow 에 필드 · creditOwner(:309)에 실음. 컬럼 가드 필수(lineage.ts:9-10 규약 · 없으면 42703 으로 발송 전체 멈춤) → 가드가 거짓이면 j.id.
- 원 여정은 뿌리 = 자기 id 라 키가 바뀌지 않는다(옛 원장과 이어짐). 바뀌는 것은 새 판뿐.
- 시험 고칠 곳: journey-send-claim-before-load-0926.test.ts:93 · v2-round5-0929.test.ts:201.

### 5-3. 고객 문장 묶음 (단일 원본 · 줄표 0)

`frontend/src/utils/journey-credit-copy.ts`(새 파일 · 상수 4개)에 두고 켜기 창 · 작업 화면 · 지도 요약 줄이 import 한다. 숫자는 서버 응답(costs)에서.

- 「여정 하나를 처음 켤 때 {activate}크레딧, 한 번뿐이에요.」
- 「고치기 · 멈췄다 다시 켜기는 0크레딧이에요.」
- 「켜진 동안 문자를 보낸 날만 여정 하나당 {operation}크레딧이에요. 30일이면 최대 {operation×30}이에요.」
- 「이번 달 크레딧이 모자라면 켜 둔 여정이 멈춰요. 여정을 많이 돌리시면 요금제를 올려 주세요.」(§5-6)
- AI 만들기 · 다듬기 = 버튼에 그 크레딧(getCreditCost 키 = 착수 때 ai-credit-calc.ts 대조).
- 지도 응답 costs 에 operation 추가(journey-lifecycle-map.ts:726 · 지금 generate · activate 뿐).

### 5-4. 예상 함수 `journeyCreditForecast(companyId)` (새 파일 `utils/journey-credit-forecast.ts`)

- 켜진 여정(active · 진입 열림)을 계보로 묶는다.
- 계보마다: 첫 journey-operation 차감 행이 30일보다 오래됐으면 **지난 30일 차감 행 수 × 10**(원장 사실 · basis = 'measured') · 아니면 **300**(규칙 · basis = 'max' · 화면에 「최대」). approved_at 은 다시 켤 때 NOW 로 덮여(builder:986) 기준으로 못 쓴다.
- 원장 조회는 회사당 1번: `ai_credit_transactions` WHERE source = 'journey-operation' AND type = 'deduct' AND created_at > NOW() − 30일 · 키 둘째 마디(여정 또는 뿌리 id)를 journeys 와 이어 `COALESCE(lineage_id, id)` 로 묶는다(V.3 전 새 판 키도 같은 계보로 모임).
- 반환 = `{ total, basis: 'measured' | 'max' | 'mixed', perLineage: [{ rootId, name, credits, basis }] }`. 못 세면 던진다(호출부 503 · 모르는 값을 0 으로 접지 않는다).
- 오차 한계(문서에 남김): V.3 배포 전 바닥 아래로 공짜로 나간 날은 원장에 없어 그 기간 실측이 낮다 → 배포 뒤에는 공짜 발송이 없어(§5-6) 30일이 지나면 사라진다. 여정 밖 운영 출처(continuous-operator-send · ai-credit-calc.ts:237)는 세지 않는다(§16).

### 5-5. 요금제 내림 경고

- 고객 신청 `POST /companies/plan-request`(companies.ts:565): 요청 요금제의 `plans.ai_credits_per_month` < forecast.total 이고 body.acknowledgeJourneyCredit !== true 이면 409 `JOURNEY_CREDIT_OVER_PLAN` + forecast. 같은 요금제 · 올림은 보지 않는다.
- 화면(PricingPage 신청 직전 · 커스텀 확인 창 · native dialog 0): 「켜 둔 여정 {n}개가 지난 30일 {total}크레딧을 썼어요(새 여정은 최대로 셈). 바꿀 요금제의 한 달 기본 크레딧은 {plan}이에요.」 + 「크레딧이 모자라면 켜 둔 여정이 멈춰요.」 + [여정 고르고 내리기](여정 목록으로) · [그대로 신청](acknowledge = true 로 다시 보냄). 선불 · 후불 같은 문구.
- 선불은 내림이 예약이다(plan-term.ts:718-726) → 「{적용일}부터 바뀌어요」.
- 슈퍼관리자 신청 목록 `GET /admin/plan-requests`(admin.ts:2840)에 대기 신청마다 forecast(total · plan) 한 칸 · 승인(2870)은 막지 않고 숫자만(결정은 사람).

### 5-6. 크레딧이 모자라면 멈춤 (D1 확정) + 80% 알림

- 지금: 운영 출처(journey-operation · continuous-operator-send)는 선불 · 후불 구분 없이 −월 기본분까지 마이너스 허용(ai-credit-tx.ts:91-95 creditOverageAllowance · 운영 출처면 planCredits) · 선불은 그 음수를 다음 달 기본에서 먼저 뺀다(carriedBaseOnReset :103-108) · 후불은 그 음수를 overage 로 정산 청구 · 바닥 아래는 InsufficientCreditError 를 deductCreditSafe 가 삼키고 발송은 계속(executor:1325-1328) = 공짜 발송.
- V.3(Harold 1020 「선불이든 후불이든 크레딧이 모자르면 둘 다 멈추는게 맞는거지 · 다음달 크레딧에서 땡겨오냐」):
  - **journey-operation 은 마이너스를 허용하지 않는다**(선불 · 후불 같음 · 다음 달 당겨쓰기 0 · 후불 초과 청구 0). creditOverageAllowance 에서 source = 'journey-operation' 이면 0. continuous-operator-send(자동 마케팅)는 이 축이 아니라 그대로 둔다(§16 · 같은 질문을 자동 마케팅에 적용할지는 별도 과제).
  - 실행기가 **발송 판정 앞**(LESSONS_BACKEND:77 · 차감 앞)에서, 그 계보의 오늘 운영 키가 아직 원장에 없을 때만(isChargedByKey · UNIQUE 키 조회 1회) `hasCreditForStrict(company, 10, 'journey-operation')`(허용 0 · 월 리셋 반영)를 본다. 거짓이면 보내지 않고 계보 전체를 멈춘다(사유 코드 `operation_credit_out`).
  - 그날 이미 운영 키를 낸 계보는 그날 나머지 발송을 막지 않는다(하루 1번 과금 단위와 같은 단위로 판정).
  - 시연 회사 · 크레딧제 미적용 회사는 지금 규칙 그대로(hasCreditForStrict 가 true · checkCredit 시연 예외).
- 멈춘 이유 사람 말(§6-6): 「이번 달 크레딧이 모자라 여정을 멈췄어요. 요금제를 올리거나 크레딧을 채우면 다시 켤 수 있어요.」 + [요금제 올리기 신청](PricingPage · 우리가 올리지 않는다 · 신청은 고객사) · [크레딧 충전](충전 경로가 있는 회사만 · 착수 때 기존 충전 요청 화면 대조).
- 다음 달 기본 크레딧이 들어와도 자동으로 다시 켜지 않는다(사람이 [다시 켜기] · 한 줄 「이번 달 크레딧이 들어왔어요 · 다시 켤 수 있어요」를 카드에).
- 80% 알림: 그달 크레딧(기본 + 구매)의 80%를 쓴 날 1회(멱등 = 회사 · 월 · 남은 크레딧 < 월 기본 × 0.2). 알림 길 = 새 길 만들지 않고 기존 고객사 담당자 알림 CT 중 하나(착수 때 journey-pretest-notifier 담당자 문자 · 1019 대시보드 요금제 칸 경고 줄 대조) · 문구 「이번 달 크레딧을 80% 썼어요. 다 쓰면 켜 둔 여정이 멈춰요. 여정을 많이 돌리시면 요금제를 올려 주세요.」 + [요금제 올리기 신청].
- 영향: 지금 마이너스로 내려가 있는 회사(journey-operation 으로)는 배포 직후 첫 발송 판정에서 멈춘다 → 배포 전 측정(§14-3 ⑤)으로 회사 수 · 잔액을 먼저 보고 Harold 확인 뒤 배포(월초 리셋 직후 배포가 영향이 가장 작음).
- 경고 문구(§5-5) · 다시 켜기 한 줄(§6-7)이 이 규칙으로 참이 된다.

## 6. 다시 켜기 · 일시정지 (접수 3)

### 6-1. 밀린 문자 몰림 → 일 단위로 밀기

- 지금: 다시 켜기(activateJourney · builder:982-993)는 실행 시각을 손대지 않는다 → 멈춘 사이 때가 지난 실행이 다음 5분에 한꺼번에(executor:211-214).
- V.3: 다시 켜는 트랜잭션(계보 컬럼과 무관하게 늘 트랜잭션 · 지금은 계보 컬럼 있을 때만 · builder:972-981)에서, 옛 status 가 paused 일 때만, `next_run_at > paused_at` 인 켜진 실행을 `ceil((NOW − paused_at) / 1일)`일 만큼 민다. 보낼 시각 · 밤 보정(executor:686-692)이 그대로 맞는다. one_shot · 날짜 기준 여정은 밀지 않는다.
- paused_at 을 찍는 7곳은 모두 active 일 때만(builder:1801 · executor:1760 · pause-handler:278 · watcher:103 · anchor:155 · 181 · 273)이라 멈춘 동안 덮이지 않고, 멈춘 동안 새 실행도 생기지 않는다(watcher:141 · reentry:82 · anchor:80 = active 만 · 회의론자 확인). paused_at 은 UPDATE 가 지우기 전에 같은 문장 안에서 읽는다.
- `next_run_at <= paused_at` 인 실행(멈추기 직전 때가 된 것)은 밀지 않는다(바로 받음 · 순서 보존).

### 6-2. 멈춘 동안 생긴 사건 몰림 → 커서 다시 잡기

- 지금: 다시 켤 때 커서는 NULL 일 때만 잡는다(builder:1035 · 1057) → 멈춘 동안 생긴 구매 · 사건이 다시 켠 직후 한꺼번에 진입. 상한 자동 멈춤은 커서를 안 올려 다시 켜면 같은 묶음을 다시 본다(watcher:390-400).
- V.3: 옛 status 가 paused 이면 다시 켤 때 last_event_cursor · last_purchase_cursor 를 활성화 시각(approved_at)으로 다시 잡고 커서 id 는 비운다. 신규 가입은 기준선이 이미 매 활성화마다 보충된다(builder:945-950 · 덜 보내는 방향). = **멈춘 동안 생긴 가입 · 구매 · 사건은 받지 않는다**(과거분 소급 금지와 같은 방향).
- 상한 자동 멈춤으로 막힌 묶음도 다시 켜면 버려진다(대량 적재 = 이관이 원인인 경우가 대부분 · 덜 보내는 방향) · 다시 켜기 창 한 줄로 알린다.
- 커서 형식 규약(FEATURE-JOURNEY §2 「커서를 DB 정밀도 밖으로 내보내지 않는다」 · ::text 원문)을 지킨다 → 착수 때 watcher 커서 문(커서 · 커서 id 짝 비교) 대조 뒤 쓴다.

### 6-3. 굳은 고객 되살리기

- 지금: 잔액 부족 · 통신사 실패 자동 멈춤이 그 발송을 맞은 실행을 paused 로 굳힌다(journey-pause-handler.ts:301-309 autoPauseExecution) · 되살리는 길이 없다(builder:1727-1730 주석).
- V.3: 다시 켜는 트랜잭션에서 `journey_step_pause_logs` 의 pause_reason ∈ {balance_insufficient, carrier_temp_fail, auto_retry_exhausted} 이고 execution_status_at_pause = 'active' 인 실행만 status = 'active' 로(그 실행의 next_run_at 은 §6-1 과 같이 민다). phone_invalid · manager_manual(그날 정지 · 플래너 v2 당일 재확인)은 되살리지 않는다.
- 칸 지우기 가드(builder:1727 · paused 실행 수 포함)는 이 규칙과 같이 고친다.

### 6-4. 하나씩 켜기 겹침 확인

- 지금: 겹침 확인은 묶음 켜기에만(journey-activation.ts:181-192) · 단건 켜기(ai.ts:3938)는 없다.
- V.3: 판정을 지도 전체 만들기(buildLifecycleMap)에서 떼어 순수 함수 `computeOverlapPairs(journeys, filtersById)`(journey-lifecycle-map.ts:668-690 의 쌍 판정 부분 · computeMapLines 와 같은 모양)로. 동시 진행 수 쿼리는 지도만 한다.
- 라우트 두 곳(단건 · 묶음)이 한 번씩 부른다(activateJourneyGuarded 안에 넣으면 묶음에서 N번).
- 고른 쌍 = `trigger_filters.overlap_ack`(정렬한 「a|b」 배열 · DDL 0)에 저장 → 다시 켤 때 새로 생긴 쌍만 묻는다.
- 겹침 해소 옵션을 끄는 저장(§4-1)도 같은 확인을 지난다.

### 6-5. 계보 전체 멈춤 · 다시 켜기

- 사람 멈춤(builder pauseJourney:1797-1806 · ai.ts:4960 · 링크 멈춤 pause-handler:252)은 같은 계보의 켜진 판 전부(현재 판 + 진입 닫힌 옛 판)를 멈춘다. 다시 켜기도 계보 전체(옛 판은 activateJourney 가 「진입 닫힌 옛 판 = 마무리만」으로 이미 다룬다 · lineage.ts:139).
- 실행기 자동 멈춤(executor pauseJourney:1758 · 템플릿 · 라인그룹 · 잔액 등)은 그 판만(원인이 그 판의 칸) · 카드에 「옛 모양 마무리분이 멈췄어요」 한 줄(olderVersions status).

### 6-6. 멈춘 이유 사람 말 `pauseReasonView(raw)` (새 순수 함수 · `utils/journey-pause-reason.ts`)

- 입력 = pause_reason 원문(executor:738 · 743 · 762 · 848 · 860 · 866 · 877 · 927 · 984 · 1002 · 1046 · 1114 · 1149 · 1312 · 1829 · watcher 상한 · 신규 판정 · 사람 멈춤 · 링크 멈춤 · operation_credit_floor).
- 출력 = `{ kind: 'balance' | 'credit' | 'plan' | 'callback' | 'template' | 'subject' | 'budget' | 'cost' | 'carrier' | 'line' | 'cap' | 'identity' | 'manual' | 'unknown', text, fix }`. 모르는 문자열 = 「멈춰 있어요 · 이유를 확인해 주세요」(원문 노출 0 · 내부 말 · 「status=」 · 「step 3」 0).
- 시험 = 실행기 · 감시 · 사람 멈춤 문자열 전부를 표로 고정(문자열이 늘면 시험이 깨진다 → pause_code 칸 이관은 그때).

### 6-7. 버튼 동작

- [일시정지] = 1클릭 · 확인 창 0 · 같은 자리 버튼이 [다시 켜기]로 바뀐다(토스트에 동작 버튼 없음 · ToastProvider.tsx:24-31).
- [다시 켜기] = 한 단계 한 줄: 「다시 켜면 문자를 보낸 날마다 {operation}크레딧이에요. 멈춘 동안 생긴 가입 · 구매는 받지 않아요.」 + 잔액 · 크레딧 사유인데 아직 모자라면 「크레딧을 채우기 전에 켜면 다시 멈춰요」 + [요금제 올리기 신청].
- 멈추기 경로 2벌(JourneyMapPage.tsx:186 · JourneysPage.tsx:1805) → 훅 `useJourneyActions` 1벌.

## 7. 조건 직접 설정 (접수 1)

### 7-1. 화면

- 시작 사건 틀은 그대로. 만들기 · 작업 화면의 「시작」 카드 = **언제**(시작 사건 카드 · 숨어 있던 「고른 고객에게」(custom 상시)를 꺼냄) + **누구에게**(「그리고 이런 고객만」 문장 줄 · 모든 시작 사건).
- 편집기 = 여정 AudienceModal(JourneyBuilderUi.tsx:77)에 서버 허용 칸(CUSTOMER_CONDITION_FIELDS · journey-target-extractor.ts:930 · 9칸 + §7-3 1칸) + 그 회사 실제 값 목록(등급 · 지역 · 매장 = 서버가 DISTINCT 로). 화면 사본 COND_FIELDS(JourneyBuilderUi.tsx:15-19 · 8칸 · 수신 동의 빠짐) 삭제. 자유 입력 0.
- 고르는 즉시 「지금 맞는 N명」(§7-2 dryRun). 0명이면 0명이라고 쓰고 켜기를 막는다.
- 화면 한 줄: 「조건에 맞으면 한 번 들어와요. 다시 들어오게 하려면 재진입을 켜요.」

### 7-2. 서버 `PATCH /operator/journeys/:id/entry` (새 주소)

- 받는 것 = customer_conditions · logic · 시작 사건별 대상 키(휴면 기준일 · 포인트 기준 등) · 상한 · 재진입 · 쿨다운 · include_existing · backfill_per_day · entry_ends_on · dryRun.
- 켜기 관문 공용: activateJourney 의 설정 검사(builder:694-734 쿨다운 최소 · 고객 조건 이슈 · 포인트 ≥ 1 · 상한 필수 · 날짜 기준 · one_shot)를 순수 함수 `validateJourneyEntryConfig(row)` 로 꺼내 activateJourney 와 이 주소가 같이 부른다(검사 두 벌 0). builder:714 문구 「저장된 여정은 대상 조건을 고칠 수 없어 새로 만들어야 해요」는 이 주소가 생기면 「조건을 고쳐 주세요」로.
- 인원 = 실발송과 같은 함수(selectJourneyTargetCustomerIds · 상한 + 1 까지). 켜진 여정에서 넓히는 저장은 인원이 상한을 넘으면 저장 거부(지금 첫 회차에 여정 전체가 멈추는 것 · watcher:254-270 을 저장 때 막음) · 이유 한 줄.
- dryRun = 같은 검사 · 같은 셈 · 저장만 안 함.
- 상시(custom) 조건 0개 = 저장 거부 · 단 「전체 고객」 명시 신호(all-customers-signal)면 허용.
- 옛 응답 · 동시성 = 옵션 주소와 같은 DB 안 병합 + status 쓰기 조건.
- DB ALTER 칸(entry_ends_on)을 쓰므로 catch 에 DB_MIGRATION_PENDING 503(CLAUDE.md db_alter_safety_net).

### 7-3. 「마지막 구매 N일」 조건 (새 항목 1개)

- 가상 칸 `days_since_purchase` = `(KST 오늘 − c.recent_purchase_date)`(customers.recent_purchase_date date · SCHEMA customers 절 · 휴면 추출과 같은 칸 · journey-target-extractor.ts:122-140). 구매 이력 없는 고객(NULL)은 비교에서 빠진다(화면 한 줄).
- 연산자 = >= · <= · > · <. applyCustomerConditions 에서 col 대신 식을 쓴다(값은 정수 파라미터).
- 「가입 N일」(created_at)은 만들지 않는다(고객 DB 를 다시 올리면 전원이 신규 · LESSONS D232).

### 7-4. 추출기 구멍 (닫는 방향 = 덜 보냄)

- 지금 applyCustomerConditions(extractor:1025-1067)는 모르는 칸 · 연산자(:1037-1038) · 빈 in 목록(:1051)을 건너뛰고, 전부 빠지면 null(:1065) = 조건 없음 = 전 고객.
- V.3: 조건이 하나라도 들어왔는데 하나라도 건너뛰면 `FALSE`(0명)를 돌려준다. 소비처 = 추출기 안 14곳(grep · 전부 같은 함수) → 한 곳 수정으로 전부.
- 영향: 0929 이후 저장 · 켜기는 이미 막지만 그 전 저장분이 남아 있을 수 있다 → 배포 전 측정(§14-3 ①)으로 몇 여정이 0명으로 바뀌는지 먼저 본다.

## 8. 기존 고객 · 휴면 복귀 · 직접 그리기 (접수 6)

### 8-1. 기존 고객 받기 (D8 · 묶음 7)

- 고른 고객에게(custom): 지금도 조건에 맞는 기존 고객이 폴마다 들어온다(extractor:398-426 · 안티조인 · 기준선 없음). 많으면 상한 자동 멈춤 → **하루 몫 `backfill_per_day`**(trigger_filters 키 · 상한과 다른 값 · LESSONS_BACKEND:14)만 더한다. 하루 몫이 있으면 감시가 KST 하루에 그만큼만 넣고 상한 초과 멈춤 대신 다음 날로 넘긴다.
- 휴면 시작: 지금은 마지막 구매가 기준일 ~ +7일인 고객만(extractor:135-136) → 이미 오래 쉰 고객은 못 들어온다. **`include_existing`**(기본 꺼짐) 켜면 +7일 창을 없애고 하루 몫으로 받는다 · 최근에 쉰 순(ORDER BY recent_purchase_date DESC · :140).
- 켜기(또는 그 자리 저장) 한 단계: 「지금 해당하는 {N}명 · 하루 {K}명씩 약 {D}일 · 예상 발송비 {원}」(돈이 나가는 단계 · 이유를 숫자로).
- 이관 유예 · 계보 중복 제외 · 수신 동의 · 안전 필터 그대로. §6-3(굳은 고객)을 먼저 막은 뒤(선불 잔액 부족 중간 멈춤).

### 8-2. 휴면 복귀 → 단골 재구매 (D5)

- 지금: 휴면 복귀와 주문 완료가 같은 구매 한 건에 함께 시작(journey-trigger-capability.ts:240 overlapEvents) = 같은 날 두 통.
- 옵션 「돌아온 고객은 환영만」 = 주문 완료(cdp.purchase) 여정 `trigger_filters.exclude_dormant_return`. 판정 = 그 회사에 켜진 휴면 복귀 여정의 기준일(여럿이면 가장 짧은 값 · 없으면 빼지 않음)로, 직전 구매가 그 기준일 이상 과거인 고객을 이번 구매에서 뺀다. 자리 = watcher qualifyPurchaseTransition(:330-377 · exclude_first_purchase 와 같은 모양 · 같은 selectLastPriorPurchase).
- 소비처(exclude_first_purchase 전수 grep 4곳과 짝): 옵션 검증(journey-options-validator.ts:60) · 감시(watcher:346) · 지도 겹침 제외(journey-lifecycle-map.ts:670 · 679) · 대상 문구(journey-step-format.ts:152).
- 새 주문 완료 여정은 기본 켬(만들기 · AI 초안 · 프리셋).
- 계약 `TRIGGER_CONTRACTS` 휴면 복귀 nextEvents 에 cdp.purchase 등재 → 지도에 「돌아온 고객 → 단골 재구매」 선(D5). 계약 parity 시험 · DB CHECK 무관(트리거 집합 불변).

### 8-3. 직접 그리기 = 하지 않음

- 실행기는 칸 순서 번호로 돌고 조건 칸은 정해진 칸으로만 건너뛴다(journey-graph.ts:11-16 · executor:533-550). 자유 연결마다 진입 · 유예 · 상한 · 재진입 · 겹침 규칙을 새로 정해야 한다.
- 대신: 작업 화면에서 칸 넣기 · 빼기 · 순서 · 간격(§9) + 지도 빈 곳 찾기 · 문장으로 만들기(GapFinderModal · InterviewModal).
- 영업팀장 답: 「칸을 넣고 빼고 간격을 바꾸는 게 우리 식 직접 그리기이고, 여정끼리 잇는 선은 시작 사건이 정하며, 빈 곳은 AI가 찾아 줍니다.」

## 9. 여정 작업 화면 + 큰 휴대폰 (접수 4 · 5)

### 9-1. 그릇

- 상세 창(JourneysPage.tsx:2256-2818 expandedId 블록) · 지도 칸 편집 창(MapStepEditModal) · 지도 [자세히]를 **JourneyWorkspace** 하나로. 전체 높이 창 · `?journey=ID&step=ID`(JourneyMapPage.tsx:115 focus 와 같은 방식 · 같은 경로 navigate 함정 회피 · LESSONS_FRONTEND:13 · 지도 스크롤 유지). 목록 · 지도 · 카드 · 칸 점 어디서 눌러도 같은 창.
- /ai-journeys/:id(JourneyDetailPage · 진입 고객)는 그대로 · ⋯ 메뉴.
- 옮기는 방법 = 원본 복사 스크립트 재조립(메모리 「원본 복사」 · 「스크립트 재조립」) · 모양 그대로 옮긴 뒤 고친다.

### 9-2. 머리 · 숫자

- 머리(ZoneHeader endSlot): 이름 · 상태 점 · [일시정지/다시 켜기] · ⋯(진입 고객 · 정지 이력 · 시뮬레이션 · 끝내기 · 보관). 탭 · endSlot 이 있으면 kpis 를 안 그려(ZoneHeader.tsx:227 · 279) 숫자는 작업대 윗줄 흰 띠.
- 숫자 4칸(서버 · 계보 합계): 지금 진행 중 · 최근 W일 들어옴 · 구매로 마침 · 이번 달 운영 크레딧. 옛 모양으로 마무리 중이면 「옛 모양으로 마무리 중 N명」 한 줄. 멈춰 있으면 §6-6 이유 한 줄 + 고치기 버튼.

### 9-3. 작업대 배치

- 1280+ = 3열: **왼쪽** 시작 카드(§7-1) + 칸 레일(칸마다 채널 · 간격 · 「지금 N명 기다림 · 다음 발송 ○월 ○일 · 기다린 지 N일」) / **가운데** 큰 휴대폰 / **오른쪽** 도구 카드 4(보낼 때 · 넣기 · AI · 검사).
- 768~1279 = 2열(도구는 휴대폰 아래) · 768 미만 = 휴대폰 위 · 도구 아래 시트.
- 바닥 확정 바: [고친 칸 N개 저장] + 서버가 준 「언제부터 · 누구에게 · 추가 크레딧 0」 한 줄. 칸 이동은 막지 않는다(칸별 초안 · 고침 점 · 실패 칸만 표시 · 늦은 AI 응답 막기 selectedRef 유지). 켜진 여정 문안 2단계 확인 창(MapStepEditModal.tsx:174 confirmActive) 삭제 → 확정 바 위 한 줄.
- 옵션 = 문장 + 토글(「구매하면 남은 문자 안 보냄」 · 「같은 상품을 다시 사면 처음부터」 · 「돌아온 고객은 환영만」).
- 옛 창에만 있던 기능 이사(보존 단언 시험): 초안 · 멈춤 블록(JourneysPage.tsx:2308) · 재진입(2582) · A/B(2640) · 칸 지우기(2656) · 담당자 알림(2671 JourneyStepNotifyToggle).

### 9-4. 큰 휴대폰 `PhoneComposer` (새 공용 부품 · components/journey/)

- 폭 360~380 · 본문 16px · 줄 간격 넉넉 · **받은 문자 모양 회색 말풍선**(지금 보낸 문자 모양 보라 · MessageEditorModal.tsx:199-205 의 휴대폰 틀 모양만 빌림 · AiLinePage 의 MessageEditorModal 은 건드리지 않음).
- (광고) 줄 · 「무료거부 080…」 줄 = 회색 잠금 줄. 쓰는 동안 buildAdMessageFront(formatDate.ts:1035) 즉시 합성 · 바이트도 같은 합성(JourneyStepStudio.tsx:183-187) · [받는 모습] = 서버 미리보기(ai.ts:3848) 1회 · 둘이 다르면 받는 모습이 정답이고 바이트 막대 옆 한 줄.
- 080 번호 · 샘플 고객은 훅(useJourneyWorkspace)이 채운다(MapStepEditModal.tsx:284-300 이 넘기지 않던 결함 해소 · 호출부가 빠뜨릴 수 없게).
- LMS · MMS 제목 = `LMS_SUBJECT_MAX_CHARS`(40 · formatDate.ts:1075 · 직접발송 · DM · 자동 마케팅과 같은 값). 서버 저장 자르기(builder:1265 · bandit-optimizer.ts:568 · 지금 50)도 40 · 이미 41~50자인 칸은 그대로 나가고 편집할 때 「제목이 40자를 넘어요」(§14-3 ② 측정).
- 편집기 6벌 → 1벌: JourneyStepStudio(만들기 · MapStepEditModal 안) · JourneyMessageEditModal(모두 켜기 창 문안 고치기 · JourneysPage) · JourneyVariantsEditor(A/B · 변형마다 같은 휴대폰 · 탭 A | B) · JourneysPage.tsx:3598 만들기 검토 칸 · MapStepEditModal → 전부 PhoneComposer. (광고) · 080 없이 바이트를 세던 JourneyMessageEditModal · JourneyVariantsEditor 의 90바이트 경계 결함이 같이 닫힌다.

### 9-5. 화면에서 지우는 것

- 내부 코드(purchase.product · JourneyOptionsEditor.tsx:182) → 서버 triggerLabel.
- 「6092분」(JourneyFlowDiagram.tsx:187-189 · 실제 = NOW − entered_at · journey-stats.ts:787-788) → 서버가 칸별 「기다린 지 N일」(그 실행의 마지막 보낸 칸 sent_at · 첫 칸이면 entered_at 기준)과 다음 발송 날짜로 다시 계산.
- 화면 안 「새 판」 말과 버튼(MapJourneyCard.tsx:225-244 · 지도 [새 판으로 고치기]).
- 상세 응답(getJourneyDetail · builder:1906-1920 · ai.ts:3827)에 edit 정책 · 옵션 정책 · triggerLabel · activationCost · 이번 달 운영 크레딧(계보) · 멈춘 이유 view 를 싣는다.

## 10. 지도 보기 쉽게 (접수 9) · 다시 그리지 않고 뺀다

### 10-1. 복잡함의 뿌리(코드)

| 뿌리 | 근거 |
|---|---|
| 켜짐 · 멈춤 여정의 칸 척추를 기본으로 펼침(레인 앞 2 · 상품 3 · 모바일도) → 시연 7장 전부 펼침 · 칸마다 숫자 3종 | journey-map-layout.ts:194 · 256 · LifecycleMapCanvas.tsx:188 · 329-356 |
| 상품 띠로 가는 부채꼴 선(보내는 여정 × 상품 여정) · 위에서 내려꽂는 곡선 · 띠 간격과 열 간격 어긋남 | journey-lifecycle-map.ts:351-361 · journey-map-layout.ts:160-163 · 179 · 249 |
| 같은 두 여정 사이 「이어짐」 화살 + 빨간 「같은 구매로 함께 시작」 | journey-trigger-capability.ts:233-237 |
| 고칠 수단이 없는 겹침까지 「손볼 곳」 · 손볼 곳 수 두 벌 | JourneyMapPage.tsx:227-233 · LifecycleMapCanvas.tsx:64-66 |
| 이름표 「이어받음 아직 없음 / 108」 | LifecycleMapCanvas.tsx:137-139 · journey-map.ts:154-156 |
| 범례 7가지 11px · 열 머리 absolute(스크롤하면 사라짐) · 판 높이 고정 · 계단 36px · 멈춤 점 호박 | Canvas:478-495 · 219-224 · JourneyMapPage.tsx:317 · layout:29 · 229 · journey-map.ts:143 |
| 판 아래 기준 줄(머리 stamp 와 중복 · 10px 기울임) | JourneyMapPage.tsx:330-333 · operator-ui.ts:78 |
| 카드 코드 두 벌(데스크톱 캔버스 인라인 · 모바일 MapJourneyCard) | Canvas:285-380 · MapJourneyCard.tsx |

### 10-2. 바꿀 모양

- 기본 **[한눈에]**(요약 카드) + 스위치 [칸까지](지금 그림 그대로 · layoutCard 펼침 경로). 기본 펼침 규칙은 [칸까지]에서만. 기본값 = 1440 · 1280 · 390 캡처 두 벌 비교 뒤 확정(D7 추천 = 한눈에).
- **요약 카드 1벌**(MapJourneyCard 를 고쳐 데스크톱 · 모바일 · 상품 띠 공용 · 카드 = div · 버튼 각각 · 높이는 데이터로 정해 배치 함수는 순수 함수 그대로):
  1. 상태 점 · 이름 14px
  2. 한 문장 「신규 가입하면 · 문자 3통 · 구매하면 끝」(서버 triggerLabel · endNote)
  3. 칸 띠 ①─②─③(즉시 · 2일 · 5일 · 기다리는 칸에 「84명」 · 누르면 작업 화면 그 칸)
  4. 숫자 3칸: 지금 진행 · 최근 N일 들어옴 · 구매로 마침(라벨에 창 일수)
  5. (있을 때만) 손볼 곳 호박 한 줄 + [고치기] · 멈춰 있으면 이유 한 줄
  6. 바닥 [일시정지 · 다시 켜기 · 켜기] [고치기]. 초안 [켜기]는 §6-4 전까지 BatchActivateModal(preselect)로.
- **선**: 상품 띠로 가는 선은 띠 머리 한 점으로 묶음(시연 4 → 2 · 서버 선 판정 · journey-crm-map-1009.test.ts:85 그대로 · 좌표만) + 상품 카드 「이어받음 N명」 · 계단 0 · 선 SVG 를 카드 바탕 아래층 · 이름표 = 「이어받음 N명」(0명이면 없음 · 분모 · 사유는 선 창 Canvas:428-464).
- **겹침**: 결과 문장 「같은 구매에 문자 2통 · ○○ 여정」. 해소 옵션이 있는 쌍(첫 구매 빼기 · 돌아온 고객은 환영만) = 호박 + [한 통만 보내기] 1클릭 · 손볼 곳에 셈. 해소 길이 없는 쌍(상품 ↔ 주문 완료 · 1009 설계서 §7) = 회색 사실 줄 · 손볼 곳에서 뺌(켜기 창 · 작업 화면에는 그대로 남김 · 숨기지 않음).
- **요약 한 줄**(도구 줄 · 서버 summary): 「켜진 여정 7개 · 지금 진행 중 412명 · 손볼 곳 2곳 · 지난 30일 운영 120크레딧」. 진행 중 = 서버가 고객 기준으로 센 수(여정 합계 아님 · 겹친 고객 두 번 세지 않음). 누적(들어옴 · 구매)은 여정마다 창이 달라 합치지 않는다.
- **정리**: 범례 3가지(이어짐 · 손봐야 함 · 비어 있음) 12px · 판 아래 기준 줄 삭제(시각은 머리 stamp · 「구매 확인 예정 HH:MM」은 stamp 툴팁) · 열 머리 sticky + 흐름 화살(가입 → 첫 구매 → 재구매 → 이탈 · 복귀) · 판 높이 max-h · 멈춤 점 회색(호박 = 손볼 곳 전용 · 1009 설계서 :37) · 글씨 하한 12 · 이름 14 · 1440 가로 스크롤 0(열 간격 조정 · 실측).
- **모바일**: 같은 요약 카드 세로 목록 · 기본 접힘 · 범례 숨김 · 「구매하면 → ○○ 여정」 줄(MapJourneyCard.tsx:162-177) 유지.
- **누르기**: 카드 = 작업 화면 · 진입 고객 화면(Canvas:300 ExternalLink)은 ⋯ 로 · MapStepEditModal 퇴역.

### 10-3. 서버 추가 (journey-lifecycle-map.ts)

- 여정마다 `health` = 순수 함수 `journeyHealth(journey, lines, overlaps)` → `{ tone: 'blocked' | 'fix' | 'quiet' | 'good', text, fix }`. 순서 = 막힘(시스템 멈춤 · §6-6) > 손볼 곳(이 여정이 보내는 선의 leak · reentry_off · dormant_mismatch · 해소 가능한 겹침 · graph.issues · broadAudience) > 조용(켜졌는데 최근 W일 들어옴 0) > 잘 됨. 문장은 서버만 짓는다(1009 설계서 §1 「화면은 의미를 추론하지 않는다」).
- `summary` = { activeJourneys, inProgressCustomers(고객 기준 DISTINCT), fixCount(health.tone = fix 인 여정 수 + 해소 가능한 겹침), operationCredits30d } · 머리 · 카드 · AI 진단 배지가 같은 수.
- `overlaps[].fix` = 해소 행동(exclude_first_purchase · exclude_dormant_return) 또는 null.
- 여정마다 `pause` = pauseReasonView(pause_reason) · `activationCost` · `operationCredits30d`(계보 · 원장 회사당 1번 · §5-4 와 같은 함수).
- `costs.operation` 추가.
- 선 1클릭 고치기 `reentry_off` 의 「일시정지하고 다시 받기 켜기」(:760)는 재진입이 그 자리 수정이 되므로 「다시 받기 켜기」 하나로(지금 pause_and_allow_reentry 행동 삭제 · 소비처 grep 후).
- 성능: 선마다(:636-666) · 겹침 쌍마다(:680-688) 쿼리 + 60초 다시 읽기(JourneyMapPage.tsx:106-111). 이번에 늘어나는 조회 = 원장 1 · 고객 기준 진행 1. 측정 뒤 처방(p95 1초 넘으면 unnest 로 묶기 · 지금은 안 함).

## 11. D2 「새 고객 받는 마지막 날」

- 칸 = `journeys.entry_ends_on date NULL`(KST 날짜 · 기본값 없음). 진입 판정 두 곳에 같은 조건: `entryOpenClause`(lineage.ts:93-96 · 진입 감시 · 재진입 워커 · 날짜 예약이 공용) + `lockLineageEntry`(:69-90 · open 판정). 조건 = `entry_ends_on IS NULL OR entry_ends_on >= KST 오늘`.
- 컬럼 가드 = lineageColumnsReady 와 같은 모양의 확인(칸 없으면 조각 빈 문자열 = 옛 동작) · 배포 → DDL 순서(코드가 두 상태를 다 읽는다).
- 화면 = 작업 화면 시작 카드 「새 고객은 ○월 ○일까지 받아요」(비우면 계속) · 지나면 카드 한 줄 「새 고객 받기를 마쳤어요 · 진행 중 N명은 끝까지」 · 진행 중 0이 되면 끝남(endDrainedVersions 와 같은 자리에서 · 진입 닫힘 판정에 이 칸 포함).
- 그 자리 수정(§4-1) · 사전검사 표식 유지(§4-4).
- DDL(배포 뒤 · Harold 실행 · 잠금 예산 짧게):
  ```sql
  BEGIN; SET LOCAL lock_timeout = '250ms'; ALTER TABLE journeys ADD COLUMN entry_ends_on date; COMMIT;
  ```
  실행 전 확인 = `SELECT column_name FROM information_schema.columns WHERE table_name='journeys' AND column_name='entry_ends_on';`(0행이어야 함) · 실행 뒤 같은 SQL 1행 · SCHEMA.md 여정 절 등재.

## 12. 영향표 (수정 전 전수 · 착수 묶음마다 grep 결과를 구현 기록에 첨부)

| 바뀌는 것 | 읽고 쓰는 곳 | 바뀌는 동작 |
|---|---|---|
| activateJourneyGuarded firstActivation → isFirstOfVersion · charge · 응답 charged | ai.ts:3938 단건 · activateJourneysInOrder · BatchActivateModal.tsx:206 · journey-map.ts:202 · 시험 3곳 | 새 판 첫 켜기 0크레딧 · one_shot 첫 발송은 그대로 |
| 운영 키 계보 뿌리 | executor chargeJourneyOperationCredit · 본 조회 · 고아 표식 조회 · 시험 2곳 · 원장 집계(getMonthlyUsage 는 source 합이라 영향 0) | 같은 날 옛 판 · 새 판 = 10 한 번 |
| stepEditPolicy 확장 + journeyOptionEditPolicy | updateJourneyStep · 지도 응답 edit · MapStepEditModal(퇴역) · 작업 화면 · ai.ts 옵션 · 자동 재진입 · 회신번호 · 변형 2곳 | 켜진 여정 간격 · 조건 · 한도 · 재진입 그 자리 |
| withJourneyValidationReset keepMarker | updateJourneyStep 만 keepMarker 사용 · 나머지 3 호출부 그대로 | 간격만 고치면 표식 유지 |
| validateJourneyEntryConfig 꺼냄 | activateJourney · PATCH entry | 검사 두 벌 0 · 켜기 동작 불변 |
| applyCustomerConditions fail-closed | 추출기 14곳(전부 같은 함수) · 시뮬레이터 · 지금 맞는 N명 | 건너뛴 조건이 있으면 0명 |
| CUSTOMER_CONDITION_FIELDS + days_since_purchase | findCustomerConditionIssues · describeCustomerConditionIssue · partitionCustomerConditions · AI 초안 · 화면 허용 목록 응답 | 조건 1개 추가 |
| exclude_dormant_return | validator:60 · watcher:346 · lifecycle-map:670 · 679 · step-format:152 · 계약 nextEvents · 만들기 기본값 | 주문 완료에서 돌아온 고객 이번 구매 빼기 |
| activateJourney 다시 켜기 분기(밀기 · 커서 · 되살리기) | 단건 · 묶음 · 지도 다시 켜기 · 링크 다시 켜기(있으면) | 옛 status = paused 일 때만 |
| pauseJourney 계보 전체 | ai.ts:4960 · pause-handler pauseJourneyByToken · 플래너 v2 여정 정지(1018 · 착수 때 grep) | 사람 멈춤 = 계보 전체 |
| computeOverlapPairs 꺼냄 | buildLifecycleMap · activateJourneysInOrder · 단건 켜기 · 옵션 끄기 | 단건 켜기에도 겹침 확인 |
| createNewVersion → reshape 흐름 | ai.ts:3553 new-version(화면 버튼 삭제 뒤 주소는 reshape 가 안에서 부름) · 지도 canNewVersion · 토스트 JourneyMapPage.tsx:212 | 이름 접미사 0 · 변형 복사 · 실패 시 초안 삭제 |
| 지도 응답 필드 추가 · reentry_off 행동 | JourneyMapPage · LifecycleMapCanvas · MapJourneyCard · JourneyDiagnosisPanel · BatchActivateModal · attach-check | 화면만 |
| 편집기 6 → PhoneComposer | §9-4 다섯 파일 | 표시 · 바이트 · 제목 40 |
| 제목 40 | builder:1265 · bandit-optimizer.ts:568 · 화면 | 새 저장분만 |
| plan-request 409 | companies.ts:565 · PricingPage · 슈퍼관리자 요금제 신청 탭(1020 행 상세 창) | 내림 + 초과일 때 확인 한 번 |
| creditOverageAllowance journey-operation = 0 | _deductWithClient(ai-credit-tx.ts:183) · hasCreditForStrict(ai-credit.ts:101) · 이 출처를 쓰는 곳 = 실행기 chargeJourneyOperationCredit 하나(grep) · 화면 이름표 constants/credit.ts:96 · 요금제 소개 plan-feature-intros.ts:113(문구 대조) · 슈퍼관리자 크레딧 탭 「마이너스」 표시(CreditsTab.tsx:133 · 191 · 202 · 자동 마케팅 음수는 남음) | 여정 운영은 마이너스 0 · 선불 다음 달 상계 · 후불 초과 청구에 여정 몫이 더는 생기지 않음 |
| 실행기 크레딧 판정 | processExecution 발송 판정 앞 | 그달 크레딧이 모자라면 보내지 않고 계보 멈춤 |
| entry_ends_on | entryOpenClause · lockLineageEntry · endDrainedVersions · PATCH entry · 작업 화면 | 마지막 날 지나면 진입 0 |

고객 화면 밖 영향: 슈퍼관리자 요금제 신청 목록 한 칸. 발송 파이프라인 절대 보호 영역(campaigns.ts · spam-filter.ts · messageUtils.ts · results.ts · billing.ts) 수정 0.

## 13. 묶음 · 순서 · 배포

서버 먼저 · 묶음마다 tsc 0 · vitest 패키지 전체 · 실측 · Codex 적대 approve(라운드 상한 없음). 배포는 묶음을 모아 한 번(메모리 「묶음 끝내고 안내 1회」) · 업무시간 밖.

| 묶음 | 내용 | DDL |
|---|---|---|
| 1 돈 | §5-1 · 5-2 · 5-3(문장 상수) · 5-4 · 5-5 · 5-6 | 0 |
| 2 수정 | §4-1 정책 · 4-2 reshape · 4-4 표식 · §7-2 PATCH entry · 7-3 · 7-4 · §8-2 · §9-5 상세 응답 · 칸 기다림 계산 | 0 |
| 3 다시 켜기 | §6-1 ~ 6-6 · 6-5 계보 멈춤 | 0 |
| 4 지도 서버 | §10-3 | 0 |
| 5 작업 화면 | §9 · §6-7 · §7-1 · 훅 · PhoneComposer · 옛 창 퇴역 | 0 |
| 6 지도 화면 | §10-2 | 0 |
| 7 기존 고객 · 마감일 | §8-1 · §11 | 1(entry_ends_on · 배포 뒤) |

## 14. 시험 · 실측

### 14-1. 시험 seam (tdd · 묶음 착수 때 먼저 빨간 시험)

- 1: 과금 판정 표(원 여정 초안 · 새 판 초안 · 새 판의 새 판 · 멈춤 다시 켜기 · one_shot 원 여정 · 계보 컬럼 없음) × (charge · isFirstOfVersion · 응답 charged) / 운영 키 = 뿌리 / forecast 순수 부분(원장 행 → 계보별 · basis) / plan-request 409 · acknowledge / journey-operation 허용 0(선불 · 후불 · 월 리셋 직후) · 크레딧 판정(거짓 → 보내지 않음 · 계보 멈춤 · 사유 코드 · 그날 이미 낸 계보는 통과) · continuous-operator-send 는 옛 허용 그대로.
- 2: 정책 표(status × startKind × 묶음 × 진행 중) · 옵션 정책 표(키 × 상태) · 표식 유지 표(키마다 유지/비움 · 섞이면 비움) · validateJourneyEntryConfig = activateJourney 와 같은 거절 문장 · applyCustomerConditions fail-closed(모르는 칸 · 빈 in · 전부 빠짐 → FALSE) · days_since_purchase SQL 조각 · reshape(성공 = 켜짐 · 실패 = 초안 0 · 이름 그대로 · 변형 복사) · exclude_dormant_return 자격.
- 3: 밀기 일수 순수 함수(멈춘 시간 → 올림 일수) · 다시 켜기 분기(옛 status paused 일 때만 · one_shot · 날짜 기준 제외) · 커서 다시 잡기 · 되살리기 사유 집합 · computeOverlapPairs = 옛 지도 겹침과 같은 쌍(시연 시드) · pauseReasonView 문자열 전부.
- 4: journeyHealth 표 · summary 고객 기준 · overlap fix.
- 5 · 6: 화면 계약 시험(백엔드 vitest 가 tsx 를 읽는 방식 · 1020 admin-table 시험과 같은 모양): 화면 「새 판」 0 · status==='draft' 과금 판정 0 · 편집기 = PhoneComposer 만 · 출처 줄 0 · 모델명 0 · native dialog 0 / 배치 불변 시험(journey-crm-map-1009 · 끝점 누락 0 · 겹침 0) 갱신 / 브라우저 실측(esbuild 번들 + 응답 흉내 + 빌드 CSS · 1020 admintbl 도구) 390 768 1024 1280 1440 1920 × [한눈에 · 칸까지] · 작업 화면 3열 · 2열 · 1열 · 휴대폰 글자 16px · 1440 가로 스크롤 0.
- 7: 하루 몫(상한과 별개 · 다음 날 이어받기) · include_existing 창 · entry_ends_on 진입 판정(어제 · 오늘 · 내일).

### 14-2. 실측 시나리오 (발송 · 돈 · 6원칙 ⑤ · Harold 실행 · 사내 시험 회사 · 도달 불가 번호)

1. 켜진 여정 간격을 그 자리에서 3일 → 2일 → 이미 잡힌 실행 next_run_at 불변 · 다음 칸부터 2일(journey_executions 조회).
2. 칸 모양 변경 → reshape → 원장 journey-activate 새 행 0 · 이름 그대로 · 옛 판 entry_closed_at 찍힘.
3. 같은 날 옛 판 · 새 판 모두 발송 → 원장 journey-operation 그 계보 그날 1행.
4. 일시정지 2일 → 다시 켜기 → 밀린 실행 next_run_at +2일 · 멈춘 동안 구매 진입 0.
5. 요금제 내림 신청(시험 회사) → 409 → 확인 창 숫자 = 슈퍼관리자 목록 숫자.
6. 선불 · 후불 시험 회사 각각 남은 크레딧을 월 기본의 20% 아래로 → 80% 알림 1회 → 10 미만에서 다음 날 첫 발송 판정에 여정 멈춤 · 이유 문장 · 원장 음수 행 0.

### 14-3. 배포 전 측정 (Harold 실행 · 실행 전 SCHEMA 대조해 그때 한 줄씩 드림)

① 저장된 고객 조건에 허용 밖 칸 · 빈 in 목록이 있는 켜진 여정 수(§7-4 · 0명으로 바뀔 여정).
② 제목 41~50자 칸 수(§9-4).
③ 굳은 실행 수(pause_logs 사유별 · §6-3 되살릴 대상).
④ 계보가 있는 켜진 여정 수 · 옛 판 진행 중 수(§4-2 · §6-5).
⑤ 지금 잔액(기본 + 구매)이 10 미만인 회사 중 켜진 여정이 있는 회사 수 · 청구 전 후불 여정 운영 overage 합(§5-6 · 배포 직후 멈출 회사).

## 15. Harold 결정 기록

### 15-1. 1020 승인 (「D1~D8 추천대로 승인」)

| | 결정 |
|---|---|
| D1 | 그달 크레딧이 모자라면 여정 멈춤 · **선불 · 후불 같음** · 여정 운영 마이너스(다음 달 당겨쓰기 · 후불 초과 청구) 없음 · 80% 알림 · 멈춘 이유 한 줄 · 요금제 상향은 고객사가 신청(§15-2) |
| D2 | 「기간」 = 간격 그 자리 수정 + 「새 고객 받는 마지막 날」 칸 1개(§11) |
| D3 | 계보당 200 한 번 · 같은 시작 사건 안에서는 무엇을 고쳐도 0 · 시작 사건은 못 바꿈 |
| D4 | 새 판 이중 200 실측 0행 → 환불 없음 · 결함은 묶음 1에서 |
| D5 | 휴면 복귀 → 단골 선 계약 등재 |
| D6 | 사전검사 표식 유지 목록(§4-4) + Codex 적대 |
| D7 | 지도 기본 [한눈에] · 캡처 비교 뒤 확정 |
| D8 | 기존 고객 받기 V.3 포함(묶음 7) |

### 15-2. D1 확정 (1020 · 설계서 작성 중 발견 → Harold 결정)

- 발견: 처음 추천 「선불만 멈춤 · 후불은 정산 청구라 멈추지 않음」은 근거가 틀렸다. 운영 출처는 선불 · 후불 같은 −월 기본분까지 마이너스를 허용하고(ai-credit-tx.ts:91-95), 그 아래는 둘 다 공짜로 보낸다(executor:1325-1328).
- Harold 1020: 「선불이든 후불이든 크레딧을 월에 지급하는게 있는데 크레딧이 모자르면 둘 다 멈추는게 맞는거지 왜 후불은 안멈추냐? 다음달 크레딧에서 땡겨오냐? … 나머지는 추천안으로해」 · 「우리가 우리 맘대로 요금제를 올릴 수 없잖아 고객사에서 지불하는건데 그들이 여정이 그렇게 빡새게 돌아가면 직접 요금제 상향 신청을 해야지」.
- 확정: 선불 · 후불 모두 그달 크레딧(기본 + 구매)이 모자라면 멈춘다 · 여정 운영은 마이너스 0(§5-6) · 요금제는 우리가 올리지 않고 멈춤 · 80% 알림 · 경고 창에서 고객사가 직접 상향 신청하게 버튼을 둔다. 후불 운영 한도를 postpaid_overage_limit 로 늘리는 대안은 버린다.

## 16. 범위 밖 · 추가 과제 (착수 안 함 · 기록만)

- 문안을 고친 뒤 재검사가 2시간 안에 안 돌면 검사 없이 나감(executor:660 PRETEST-MISS) · 화면 문구는 「보내기 전에 다시 검사해요」로만 쓰고 시간을 약속하지 않는다.
- journey_steps.updated_at 을 updateJourneyStep 이 올리지 않음(builder:1236-1253 · DB 트리거 여부 미검증 · 확인 = `SELECT tgname FROM pg_trigger WHERE tgrelid = 'journey_steps'::regclass`).
- 요금제 내림 예상이 여정 밖 운영 출처(continuous-operator-send)를 세지 않음.
- 자동 마케팅 운영 과금(continuous-operator-send)도 지금 −월 기본분까지 마이너스 허용 · 그 아래 공짜 발송 여부는 미검증(확인 = 자동 마케팅 차감 실패 처리 읽기) · D1 같은 규칙을 적용할지는 별도 과제.
- 성별 · 생일 · 고객사 고유 칸 조건(추출기 미지원 · CUSTOMER_CONDITION_FIELDS 밖).
- 지도 만들기 입구 두 길(명령 줄 → 목록 · [문장으로 만들기] → 지도 위 창 · JourneyMapPage.tsx:279 · 289) 하나로.
- 탭 이름 「생애 지도」(zone-tabs.ts:27) vs 「고객 관계 지도」.

## 17. 구현 기록

### 17-1. 묶음별 결과 (1020 · 코드 완료)

| 묶음 | 결과 | 시험(새로 씀 · 모두 통과) |
|---|---|---|
| 1 돈 | 처음 켜기 = 계보당 1번(journey-activation-cost.ts 한 곳) · 운영 키 = 계보 뿌리 · journey-operation 마이너스 0 + 실행기 엄격 판정(차감 앞 · 그날 키가 없을 때만) · 예상 함수 · 요금제 내림 409 · 80% 알림(달 1번) | journey-v3-money · credit-out · forecast |
| 2 수정 | 칸 정책(켜짐 = 문안 · 간격) · 옵션 판정 한 곳 · 사전검사 유지 목록 · reshape 한 흐름 · 시작 조건 직접 설정(옵션 주소 확장) · 추출기 닫힘 · 마지막 구매 N일 · 휴면 복귀 → 단골 | journey-v3-edit · conditions · reshape |
| 3 다시 켜기 | 일 단위 밀기 · 쓰던 커서 다시 잡기 · 굳은 실행 되살리기 · 계보 전체 멈춤 · 다시 켜기 · 하나씩 켜기 겹침 확인 · 멈춘 이유 사람 말 | journey-v3-resume · pause-reason · overlap |
| 4 지도 서버 | health · summary · overlaps fix/text · pause · operationCredits30d · costs.operation | journey-v3-map-health |
| 5 작업 화면 | JourneyWorkspace(목록 옛 상세 창 · 지도 칸 편집 창 대체) · 시작 카드 · 칸별 초안 · 확정 바 · 새 모양 확인 한 단계 · useJourneyActions 한 벌 · PhoneComposer(스튜디오 · 문안 수정 창 · A/B · 만들기 검토 칸) · 조건 칸 = 서버 10칸 · 목록 · 상세 응답 pause_view | journey-v3-workspace(서버 판정 짝 · 보존 단언 · 문구) |
| 6 지도 화면 | [한눈에 \| 칸까지] · 요약 카드 한 벌 · 상품 띠 선 묶음 · 계단 0 · 선 아래층 · 범례 3 · 열 머리 sticky · 요약 한 줄 · 겹침 1클릭 · 멈춤 점 회색 · 글씨 12/14 | journey-v3-workspace(한눈에 배치 불변) |
| 7 기존 고객 · 마감일 | include_existing · backfill_per_day · entry_ends_on(칸 확인 뒤에만 · 상세는 ::text) | journey-v3-existing |

검증(Codex 적대 approve 뒤 · A 3R · B 5R) = backend tsc 0 · frontend tsc 0 · backend vitest 651파일 9,468건 전부 통과 · 화면 실측(실제 부품 + 응답 흉내 + 빌드 CSS · 390/768/1024/1280/1440/1920 × 작업 화면 · 시작 카드 · 지도 두 모양 · 휴대폰 · 문안 수정 창 · 보통 값과 긴 값) = 그리기 오류 0 · 가로 넘침 0 · 12px 미만 글자 0.

### 17-2. 설계서와 다르게 한 것

- 시작 조건 저장 = 새 주소(PATCH entry) 대신 **옵션 주소를 넓혔다**(같은 행 잠금 · 같은 병합 · dryRun 인원 · ENTRY_OVER_CAP · ALL_CUSTOMERS_REQUIRED). 주소 두 벌이면 같은 칸을 두 곳이 쓴다.
- 새 모양 = **켜진 여정만**. 멈춘 여정은 진행 중 고객이 옛 판에 멈춘 채 남아 다시 켠 뒤 고친다(화면이 칸 모양을 잠그고 이유를 보인다).
- 크레딧 멈춤은 계보 전체가 아니라 **그 판만** 멈춘다(같은 회사 크레딧이라 다른 판도 자기 발송 판정에서 각자 멈춘다).
- A/B 변형 그 자리 수정은 **열지 않았다**(스냅숏 · 재검사 스캐너가 변형 본문을 다시 검사하지 않는다). 켜진 여정 변형은 읽기 전용 휴대폰.
- 칸 순서 바꾸기는 하지 않는다(빼고 넣기로).
- 작업 화면 왼쪽은 「시작 카드 + 레일」을 세로로 쌓지 않고 **레일 맨 위 [시작] 칸**을 누르면 가운데에 시작 카드가 열린다(휴대폰과 시작 카드가 한 화면을 다투지 않게).
- 옛 상세 창의 「미리보기 샘플 6명」(예측 점수) · 「칸별 흐름 막대」는 옮기지 않았다. 받는 모습 = 휴대폰 [받는 모습](서버 · 대상 고객 1명) · 칸별 숫자 = 레일(지금 기다림 · 평균 기다린 날) · 진단 줄 · 칸별 흐름은 성과 화면(/ai-journeys/:id/stats).
- 옛 부품 삭제: MapStepEditModal · JourneyOptionsEditor · JourneyFlowDiagram(소비처 0 확인 뒤). 존 기능 보존 기준표는 일부러 걷어 낸 주소 5개(new-version · preview-samples · auto-reentry · 목록 stats · 상세 읽기 1곳)만 줄어 시험 머리 절차대로 다시 떴다(자동 재진입은 옵션 주소 autoReentryEnabled · 같은 판정).

### 17-3. Codex 적대 리뷰

두 갈래로 나눠 돌렸다(A = 서버 · B = 화면 · 모델 gpt-6-astra · 검사 재실행 금지 · 1라운드 전체 · 2라운드부터 고친 줄 + 직접 호출부).

| 라운드 | A 서버 | B 화면 |
|---|---|---|
| 1 | needs-attention 9(high 6 · medium 3) · 전부 수용(A4 는 옵션 주소만 · 아래) | needs-attention 8(high 3 · medium 5) · 전부 수용 |
| 2 | needs-attention 1(high · A1 과 같은 뿌리) · 수용 = 구조 수정 | needs-attention 5 · 전부 수용 |
| 3 | **approve**(되돌림 작업 · 확정 차감 날짜) | needs-attention 2(high 1 · medium 1 · 칸 넣기 결과 모름 = 같은 부류 세 번째) · 수용 = 구조 수정 |
| 4 | (닫힘) | needs-attention 1(high · 502 · 504 도 결과 모름) · 수용 |
| 5 | (닫힘) | **approve** |

1라운드 처방(같은 뿌리끼리):
- A1 운영 크레딧 확인과 차감 사이 경합 → 확인을 없애고 **보내기 전 그 자리에서 같은 키로 엄격 차감**(차감이 곧 판정 · 그날 이미 받았으면 조회만 · 라인그룹 확인 뒤).
- A2 새 모양 켜기 도중 사람 멈춤 → 사람 멈춤도 켜기와 **같은 계보 잠금** · 켜기는 원본이 아직 켜져 있을 때만(requireActiveSource). A9 켜기는 계보 칸 유무와 무관하게 늘 한 트랜잭션 · 보정 실패 = 되돌림.
- A3 되살리기가 사람이 다시 멈춘 실행까지 깨움 → 그 실행의 다음 칸에 사람 그날 정지 기록이 있으면 되살리지 않는 보수 판정(기록 테이블 시각 칸은 마이그레이션 = created_at · 조회문 = paused_at 로 달라 실측 전이라 쓰지 않음).
- A4 「전체 고객」 해제가 통과 → 옵션 주소가 병합 결과로 검사. **켜기 공용 검사에는 넣지 않았다**(V.3 전 상시 여정 · 빌더가 만든 상시 여정은 조건 0 = 전체 활성 고객으로 저장돼 있어 다시 켜기 · 새로 만들기가 막힌다) · 대신 화면 초기값을 사실대로(조건 0 · 신호 키 없음 = 전체 고객).
- A5 휴면 위쪽 끝 매개변수가 안 쓰일 때 PG 형 오류 → 쓸 때만 싣는다 · A7 조건 닫힘 때 앞 값 잔존 → 지역 배열 · A6 휴면 복귀 기준 = 새 고객을 받는 판만 · A8 charged = 실제 차감 결말.
- B1 늦은 조회가 다른 여정을 덮음 → 요청 순번 + 지금 여정 · B2 칸 넣기/빼기 부분 성공 → 성공분 즉시 정리 · 결과 모름 = 서버 칸 수 대조 · B4 실패 뒤 다시 읽기 = sync(안 보낸 고친 값 유지) · B5 저장 중 화면 잠금 · B6 늦은 AI 응답 = 최신 값에 본문만 · 요청 때 본문일 때만 · B7 칸마다 알림 토글 · B3 켜기 확인 창 = 포털 · 작업 화면 위 · 창 잡기 단계 Esc · B8 받는 모습 응답 무효화.
- 고정 시험 = journey-v3-codex-r1-1020(조건 닫힘은 실제 함수로 · 나머지 계약) · 옛 시험 갱신 = journey-activate-gate(켜기 트랜잭션 흉내) · journey-v2-phase2-activation-0930 · journey-v3-money(차감 결말) · journey-v3-credit-out(그 자리 차감 · 경합) · journey-v3-existing(휴면 매개변수).

2라운드 처방:
- A 그 자리 차감이 그날 한 통도 안 나가도 남음 = 1R A1 과 **같은 뿌리**(판정과 차감을 한 지점에 두면 「무과금 발송 0」과 「보낸 날만 과금」을 함께 못 지킨다). 구조 = 보내기 전 차감은 **그날 몫을 잡아 두기**, 하루(KST)가 끝난 뒤 그 계보 · 그 날짜에 발송 기록('sent' · 결과 모름 'sending')이 0건이면 되돌린다(journey-operation-release.ts · 10분 작업자 · 멱등 키 `release:원키` · 원 차감 버킷 복원 · 8일 안 · 500건씩). 본 AI 적대 검토 추가 = 정상 발송 확정 차감 날짜를 표식 시각으로(옛 new Date() 는 자정을 넘기면 한 발송에 두 날을 받았다 · 복구 경로 · 되돌림과 한 축).
- B1 결과 모름 칸 넣기를 칸 수로 대조 → **넣기 전 id 목록 + 보낸 내용 지문**(채널 · 간격 · 제목 · 본문 · 서버 저장 보정 applyVariableDefaults 와 무관한 값)으로 찾는다 · 못 찾으면 sent 표시를 남기고 다음 저장이 먼저 찾는다. B2 sync 가 남이 바꾼 값까지 되돌림 → **rebaseForm**(내가 바꾼 키만 새 서버 값 위에 · 이미 같으면 버림 · 양쪽 변경 = 내 값 + 충돌 수) · 칸 초안도 같은 규칙. B3 담당자 알림 뒤 open → sync. B4 덮개만으로 키보드가 들어감 → 네 자리 inert + 편집 함수 editLockRef 가드. B5 켜기 확인 창 Tab · Esc 를 아래 창이 받음 → **공용 창 껍데기가 화면 맨 위 창일 때만** Esc · Tab 을 받는다 · 켜기 확인 창도 그 껍데기로(자체 포털 · 창 잡기 단계 키 처리 삭제).
- 공용 창 껍데기(JourneyModalShell) 영향표 — 소비처 17곳(JourneyWorkspace · JourneyActivationConfirmModal · useJourneyActions · BatchActivateModal · LineTemplatePick · LineStepsModal · PlannerEventModal · JourneyPlanModal · JourneyBriefingModal · GradeOrderModal · LineIntakeModal · GapFinderModal · DiagnosisModal · InterviewModal · MarketingJourneyModal · ProductJourneyModal · DiagnosisInviteModal). 창이 하나만 떠 있으면 늘 맨 위라 동작이 같다. 겹쳐 떠 있을 때만 바뀐다 = 옛: 문서 잡기 단계라 겹친 껍데기가 Esc 한 번에 함께 닫혔다 → 새: 맨 위 창만 닫힌다.
- 고정 시험 = journey-v3-codex-r2-1020(되돌림 SQL 조건 · 되돌림 동작 흉내 · 작업자 체인 · 확정 차감 날짜 · rebaseForm 실제 값 · 넣기 지문을 실제 서버 보정 함수로 대조 · 화면 계약) · 옛 시험 갱신 = journey-v3-codex-r1-1020(B2 · B3 · B4 기대값) · journey-send-claim-before-load-0926 · v2-round5-0929(확정 차감 줄).

3라운드 처방:
- B 칸 넣기 결과 모름(1R 칸 수 → 2R 내용 지문 → 3R 지문 불일치 재전송 · 확인 때 뒤 편집 유실) — **왜 되풀이됐나** = 멱등이 아닌 넣기 요청의 성공 여부를 화면이 서버 상태로 추측했다. 추측 장치를 바꿀 때마다 다른 틈이 났다. 구조 = **화면이 칸 id 를 미리 만들어 보낸다**(clientStepId · crypto.randomUUID) · 서버 addJourneyStep 은 여정 행 FOR UPDATE 뒤 같은 id 가 이 여정에 있으면 만들지 않고 그 칸을 돌려준다(existed · 상태 · 개수 검사보다 앞 · 다른 여정 id 면 409 STEP_ID_CONFLICT) · 없으면 그 id 로 넣는다(journey_steps.id 기본키 재사용 · 새 칸 0 · DDL 0). 결과를 못 받은 칸은 잠근다(편집기 대신 안내 · 지우기 허용) · 다시 저장 = 같은 id · 다시 읽어 그 id 가 보이면 대기 목록에서 뺀다. **덧댄 장치(칸 목록 다시 읽기 · 내용 지문 · 서버 보정 맞추기)는 함께 지웠다.** 빌더 만들기 · 새 모양 복제본은 id 를 안 줘 서버가 만든다(종전).
- 4라운드 = 결과 모름 판정 범위 바로잡기(3라운드 구조 그대로): 「넣지 않았다」 확정 = 4xx 뿐 · 연결 끊김 · 5xx(게이트웨이 502 · 504 포함) = 그 칸 잠금 · 한 번 잠근 칸은 화면이 풀지 않는다(풀리는 길 = 같은 id 로 성공 · 다시 읽어 보임 · 사람이 지움).
- A 판정 메모(결함 아님) = 지난달 마지막 날 몫을 새 달에 되돌리면 refundCredit 의 기존 규칙대로 원 차감 버킷(base)에 얹힌다(월 리셋 뒤 base 에 10 가산).
- 고정 시험 = journey-v3-codex-r3-1020(addJourneyStep 실제 함수 + 흉내 DB 로 멱등 5경우 · 주소 · 화면 계약 · 추측 장치 0) · 옛 시험 갱신 = journey-v3-codex-r2-1020(지문 시험 → 추측 장치 0) · journey-v2-phase4-branch-0930(INSERT 값 목록을 괄호 밖 쉼표로만 나눔).

### 17-4. 범위 밖 발견(착수 안 함 · 기록만)

- JourneyActivationConfirmModal 점검 실패 「다시 만들기」 = 토스트에 내부 이름(JourneysPage) 노출 + 아무도 안 듣는 이벤트(journey:expand-step). 작업 화면 그 칸으로 여는 것이 맞다.
- JourneyDetailPage · JourneyStatsPage 가 상세 응답을 detail.journey 로 읽는다(실제 응답 = journey · steps) → 여정 이름이 비어 보일 수 있다.
- ai-credit-calc.verify.ts 「base-150 → 140」 줄은 0925 C-08 이후 갱신 안 됨(이번 변경 전부터 실패).
- POST /operator/journeys/:id/new-version 주소는 화면 소비처가 0이 됐다(남겨 둠 · 지울지 판단 필요).

## 18. 기존 여정 뒤에 붙이기 + 붙기 전 점검 (★1020 Harold 「기존 여정 뒤에 붙일 방법 · 붙을 수 있는지 점검」 · 「여기서 아예 하자」)

### 18-1. 왜
- 측정(1020) = 지도 밖 여정 0 · 선 없는 여정 = 아랫띠 11(고른 고객에게 8 · 생일 2 · 장바구니 1). 계약 순서 밖의 여정을 생애 흐름에 둘 길이 없었다.
- 이것만 풀면 빈 도화지 직접 그리기는 필요 없다(Harold) — 순서대로 잇기 · 결과별 두 갈래 · 길게 잇기가 모두 「뒤에 붙이기」로 된다. D111 「직접 그리기 안 함」과 같은 방향.
- 기능 문서 §2 「다른 여정으로 자동으로 태우지 않는다」를 Harold 결정으로 고친다: **담당자가 붙인 여정만** 앞 여정을 마친 고객을 받는다. 진입은 특수 진입로가 아니다 — B 의 동의 · 범위 · 조건 · 상한 · 재진입 · 대조군 · 마지막 날을 그대로 지난다(같은 추출 · 같은 넣기 함수).

### 18-2. 구조
- 새 시작 사건 `journey.after`(계약 · attachOnly = 만들기 · AI 목록에서 고를 수 없다 · 붙이기로만 생긴다).
- `trigger_filters` 새 키(DDL 0): `after_root`(앞 여정 계보 뿌리 · 앞 여정이 새 모양으로 바뀌어도 그대로) · `after_outcome`(`goal_met` 목표를 이뤄 마친 고객 · `completed` 끝까지 받은 고객 · `any` 둘 다) · `attach_prev`(붙이기 전 시작 사건 · 시작 방식 · 필터 · [떼기]가 되돌린다).
- 진입 = 진입 감시(5분)가 앞 여정 계보에서 그 결과로 끝난 실행(`completed_at`)을 읽어 넣는다. 새 커서를 만들지 않는다:
  - 기준 시각 = `last_event_cursor`(켤 때 · 붙일 때 · 다시 켤 때 그 시각 · 새 모양은 이어받기) · 그 전에 마친 고객은 받지 않는다(소급 0).
  - 한 번 마침 = 한 번 진입: 진입 표식 `__entry = {src: 'after', key: 앞 실행 id}` · 같은 계보에 그 표식이 있으면 넣지 않는다. 재진입 · 쿨다운은 B 설정 그대로.
  - 7일 창(마친 뒤 7일 안에 못 들어오면 받지 않는다 · 늦은 문자 0).
- 실행이 끝나는 문장(실행기 4 · 진입 교체 1)은 손대지 않는다 — 감시 한 곳이 읽는다(끝내는 자리마다 넣으면 하나 빠질 때 안 붙는다).

### 18-3. 붙기 전 점검(서버 한 함수 · 후보 목록 · 붙이기 저장이 같은 함수)
| 막음 | 이유 |
|---|---|
| 같은 여정(같은 계보) | 자기 뒤에 자기를 붙일 수 없다 |
| 앞 · 뒤 여정이 끝남 · 보관 | 받을 고객 · 보낼 곳이 없다 |
| 뒤 여정이 옛 모양으로 마무리 중(진입 닫힘) | 새 고객을 받지 않는 판이다 |
| 뒤 여정이 날짜 기준 · 한 번 보내기 | 날짜가 시작이라 앞 여정 뒤에 둘 수 없다 |
| 고리 | 뒤 여정을 따라가면 앞 여정이 다시 나온다 |
| 결과 = 목표 이룸인데 앞 여정 「목표 달성하면 끝내기」 꺼짐 | 그 결과로 끝나는 고객이 생기지 않는다(죽은 연결 금지) |

| 알림(붙이되 보여 준다) | |
|---|---|
| 뒤 여정이 원래 시작 사건으로 고객을 받던 길이 끊긴다 | 진행 중 고객은 끝까지 받는다 |
| 다른 여정 뒤에 이미 붙어 있다 | 이 여정 뒤로 옮긴다 |
| 앞 여정이 꺼져 있다 · 뒤 여정이 초안 · 멈춤 | 켜기 전까지 넘어오는 고객이 없다 |
| 최근 30일 그 결과로 마친 고객 수 | 0명이면 그대로 보인다 |

### 18-4. 화면
- 지도 카드 ⋯ [뒤에 여정 붙이기] → 창: 결과 고르기(목표 이룸 · 끝까지 · 둘 다 · 막힌 결과는 이유) → 여정 목록(붙일 수 있음 위 · 못 붙임은 이유와 함께 흐리게) → 고른 여정의 알림 → [붙이기]. 창 자체가 확인 한 단계(뒤 여정이 들어오는 방식이 바뀌는 갈림길 · 이유 한 줄).
- 붙은 여정 = 앞 여정과 같은 열 · 바로 아래 · 선(같은 열 선 모양 그대로) · 카드 문장 「「앞 여정」 마친 뒤」. 앞 여정이 아랫띠면 둘 다 아랫띠 · 줄 「마치면 → 뒤 여정」.
- 붙은 여정 ⋯ [앞 여정에서 떼기] · 작업 화면 [시작] 「언제」 = 「앞 여정」 마친 뒤 · 결과 + [떼기]. 떼기 = 원래 시작 사건 · 방식 · 필터로(지금 고친 대상 조건은 유지).
- 켜진 뒤 여정도 그 자리에서 바뀐다(시작은 새로 들어오는 고객에게만 영향 · V.3 「시작 조건 그 자리」와 같다).

### 18-5. 영향표(소비처 전수)
| 자리 | 바뀜 |
|---|---|
| `journey-trigger-capability` 계약 | `journey.after` 추가(attachOnly · key null · lane 은 지도가 앞 여정에서 정함) · AI 선택 목록 · 프롬프트 표에서 제외 · 만들기 길(`isCreatableTriggerEvent`)에서 거부 |
| DB CHECK `journeys_trigger_event_registered` | 18값(배포 뒤 DDL · 전 = 붙이기 503 DB_MIGRATION_PENDING) |
| `journey-builder` 켜기 검사 · 첫 켜기 커서 | after_root · after_outcome 형식 · 앞 여정 존재 · 첫 켜기 커서 = 지금 |
| `journey-target-extractor` | `case 'journey.after'`(미리보기 · 인원) + 감시용 후보(고객 · 앞 실행 id) |
| `journey-trigger-watcher` | after 갈래(후보 → 상한 판정 → 같은 넣기 함수 · 표식) |
| `journey-lifecycle-map` | 붙은 여정 열 · 순서 · 선(앞 여정 → 뒤 여정 · 상태 · 이어받음 숫자) · `attachedAfter` |
| `journey-step-format` | 사건 이름 · 대상 문장(내부 값 노출 0) |
| 새 `journey-attach.ts` · 주소 3(`attach-candidates` · `attach` · `detach`) | 점검 · 붙이기 · 떼기(계보 잠금 + 행 잠금 안에서 다시 점검) |
| 화면 | 지도 카드 메뉴 · 붙이기 창 · 시작 카드 「언제」 · 목록 사건 이름 |

### 18-6. 시험
- 점검 함수(순수): 막음 6 · 알림 · 고리(사슬 셋) · 결과 막음.
- 후보 SQL: 결과 상태 · 기준 시각 · 7일 창 · 표식 안티조인 · 재진입 · 동의 · 조건 · 회사.
- 감시: after 갈래가 같은 넣기 함수로 표식을 싣는다 · 상한 초과 = 멈춤.
- 지도: 붙은 여정 열 · 순서 · 선 상태(초안 · 멈춤 · 보내는 쪽 꺼짐 · 목표 끔 = 새는 선 · 이어짐).
- 붙이기 · 떼기: 잠금 안 다시 점검 · attach_prev 왕복 · 켜진 여정 기준 시각 = 지금 · CHECK 전 = 503.

### 18-7. 구현 기록 (1020 · 코드 완료 · Codex 적대 approve = 서버 4R · 화면 3R)

- 서버: 새 `journey-attach.ts`(점검 judgeAttach · 후보 · 붙이기 · 떼기 · 회사 붙이기 잠금) · `journey-after-config.ts`(설정 읽기 · 세대) · `journey-trigger-db.ts`(CHECK 판정 · 상품 여정과 공용) · 계약 `journey.after`(attachOnly) · 추출 `selectAfterJourneyCandidates` · 감시 after 갈래 · 켜기 검사 · 지도 붙인 선 · 주소 3(`attach-candidates` · `attach` · `detach`).
- 화면: `JourneyAttachModal` · 지도 카드 ⋯ [뒤에 여정 붙이기] · [앞 여정에서 떼기] · 작업 화면 시작 카드 「넘겨받는 고객」 + [떼기] · 선 문구(「마치면 → 여정 이름」) · 「때」 문구(triggerWhen).
- 본 AI 적대 검토로 더한 점검: 뒤 여정 알림톡이 사건 값(@@order_no@@ · 상품명 · 결제금액 · 운송장 · 예약)을 쓰면 막음(앞 여정을 마친 고객에게는 그 값이 없어 빈 값 발송) · 인원 미리 세기는 기준 시각 없이 최근 7일.
- 검증: backend tsc 0 · frontend tsc 0 · backend vitest 652파일 9,496건(journey-attach-1020 29건) · 화면 실측 6폭 × 11상황(붙이기 창 · 고른 뒤 · 붙인 여정 작업 화면 시작 카드 포함) × 보통 · 긴 값 = 그리기 오류 0 · 넘침 0 · 12px 미만 0.

Codex 적대 리뷰(A 서버 · B 화면):

| 라운드 | A 서버 | B 화면 |
|---|---|---|
| 1 | needs-attention 7(high 5 · medium 2) · 전부 수용 = 뿌리 넷 | needs-attention 2(medium) · 수용 |
| 2 | needs-attention 4(high 3 · medium 1) · 수용(같은 부류 두 번째 → 구조) | needs-attention 1(medium) · 수용 |
| 3 | needs-attention 2(high 2 · 같은 부류 세 번째 → 세대값 구조) | **approve** |
| 4 | **approve** | (닫힘) |

라운드별 처방(같은 뿌리끼리):
- 1R 뿌리 1(고리 · 동시 반대 방향 · 옛 판 지정) = 회사 단위 붙이기 잠금(붙이기 · 떼기 · 맨 먼저) + 앞 여정은 계보 대표 판으로. 2R = 고리 판정을 계보 단위 연결(진입이 열린 모든 판의 앞 여정 설정)로 바꿔 판 승격(켜기)이 연결을 바꾸지 않게.
- 1R 뿌리 2 → 2R → 3R(같은 부류 세 번) = 감시가 잠금 밖에서 판정하고 쓰기가 다시 확인하지 않았다 → 이름 · 커서 값 비교는 붙였다 떼는 왕복(ABA)을 못 가른다 → **시작 설정 세대 `start_gen`**(trigger_filters 안 · 붙이기 · 떼기마다 +1 · DDL 0)을 감시가 읽고, 모든 쓰기(넣기 두 길 = 계보 잠금 직후 확인 · 커서 전진 두 곳 = 문장 조건 · 멈춤 다섯 자리 = UPDATE 행 조건)가 같은 조각(startSameSql)으로 비교 · after 넣기는 같은 앞 실행 표식이 계보에 없을 때만(잠금 안) · 진행 중 고객은 상한 판정 전에 뺌.
- 1R 뿌리 3 = 첫 켜기 기준 시각을 켜기 트랜잭션 안(커서 이어받기 뒤 · 비어 있을 때 켠 시각)으로 · 2R = 커서 이어받기는 같은 앞 여정 · 결과일 때만(INHERIT_ENTRY_CURSORS_SQL).
- 1R 뿌리 4 = 지도 사슬 배치를 부모부터(재귀 · 고리 방어).
- 화면: 떼는 동안 편집 · 닫기 잠금 + 확인 순간 고친 곳 다시 보기 · 실패 문장 고객 말(journeyApiErrorText) · 다시 읽기는 상세가 있으면 sync(고친 값 유지).

### 18-8. 배포 · DDL · 범위 밖
- 배포 = 백엔드 · 프론트 빌드 · reload 뒤 **시작 사건 CHECK 교체**(18값 · 0930 상품 재구매와 같은 방식 · 행 수가 작아 한 트랜잭션 · lock_timeout 1s). 그 전 = 붙이기 503(고객 화면 = 「준비 중이라 아직 할 수 없어요」 · 기존 여정 동작 영향 0).
  - 값: 'customer.created','purchase.first','cdp.purchase','purchase.product','customer.dormant','customer.dormant_return','customer.cycle_lapsed','customer.grade_changed','customer.birthday_approaching','customer.points_expiring','cdp.cart_abandon','custom_order_shipped','cdp.browse_no_purchase','cdp.reservation_created','reservation.visit_dn','reservation.visit_done','custom','journey.after'
- 시험 데이터 · 실발송 실측(Harold): 사내 시험 회사에서 A(초안 · 칸 1) 뒤에 B 를 붙이고 둘 다 켠 뒤 도달 불가 번호 고객 1명이 A 를 마치면 5분 안에 B 에 들어오는지 · 같은 마침으로 두 번 들어오지 않는지 · 떼면 원래 시작으로 돌아가는지.
- [범위 밖] `journey-executor.ts:1534`(마지막 칸 완료 문장 · Codex 4R 기록 · 내용 미기재) · 추가 과제 = 앞 여정 사건 값(주문 · 상품)을 뒤 여정에 이어 주기(지금은 그 값을 쓰는 여정을 막음).
