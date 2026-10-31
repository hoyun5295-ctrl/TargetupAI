# 추천 타겟 리스트 날짜 칸 · 주소록 불러오기 = 더하기 (1031 · 카드 C85)

> 상태 = 구조체크 2회차 결함 0(§5) · 구현 · Codex 구현 4R approve(§6) · 구현 뒤 구조체크 4회차 결함 0(§5) · 배포 대기(원장 C85). Harold 1031 「파악했으면 제대로 수정하고 코덱스리뷰 닫힐때까지 돌려 · 구조체크 진행해 · 닫힐때까지 반복해」.
> 같은 배포 = C84(여정 칸 관문) 와 묶음.

## 0. 접수 · 실측

| 접수 | 누가 · 언제 | 말한 것 | 실측 |
|---|---|---|---|
| A `cmvujgxpe039yjnsc61te7ekc` | 남지현 1030 | 생일자 추천 타겟 상세 「추출 대상 리스트 보기」 생일 날짜가 문자와 다르게 보임 · 기대 = 올린 날짜 그대로 | 화면 생일 칸 = `2003-11-05T15:00:00.000Z`(첨부 2) · DB = `2003-11-06`(Harold 1031 실행 · 인비토 · 한줄 뷰티(시연) 장채원 2657 둘 다). 보고자가 비교한 둘(문자 머지 한*윤 1984-11-15 ↔ 리스트 1번 장채원)은 다른 사람이라 그 비교는 근거가 아니다(Harold 댓글). 결함은 리스트 칸 자체 = DB date 칸을 시각으로 내보내 UTC 글자(하루 앞 15시)로 그림 |
| B `cmvuih2n002wijnscwzv1vgig` | 서수란 1030 | 직접발송 사용자: 직접입력 뒤 주소록에서 불러오면 직접입력 데이터가 사라지고 주소록 목록만 남음 · 관리자는 남음 | 코드: 주소록 창 불러오기 두 갈래(한 그룹 `AddressBookModal.tsx:302` · 여러 그룹 `:353`)가 명단을 통째로 바꿈. 직접발송 패널 · 주소록 창에 관리자 · 사용자 갈래 0 → 「관리자는 남음」은 코드로 설명되지 않는다(미검증 · 후보 = 시험 순서: 주소록 먼저 → 직접입력이면 이어 붙음) |

## 1. 구조(소유 · 같은 모양 전수)

### 1-1 A · 추천 타겟 창에 날짜가 그려지는 길

- 창 = `TargetRecipientsModal`(공용 · 고정 칸 = 이름 · 연락처 · 등급 · 성별 · 지역 · 나이 + 조건 칸 `extraColumns`). 날짜가 그려지는 길은 조건 칸뿐이고 창은 값을 그대로 그린다(`val()`).
- 조건 칸을 넘기는 화면 = 셋: `AiLinePage`(← `POST /api/ai/operator/target-recipients` · `routes/ai.ts:1322`) · `ProposalDecisionCard`(← 제안 대상 · `routes/ai.ts:2465`) · `JourneysPage`(← 여정 대상 · `routes/ai.ts:3791` 고정 칸 포인트 · 최근구매일). 그 밖 넷(`AutoSendFormModal` · `TargetExtractModal` · `AiCampaignResultPopup` · …)은 `extraColumns` 를 안 넘김 = 날짜 칸 0.
- 앞의 둘의 값 = `resolveConditionColumns`(`utils/operator-recipients.ts:174`)가 만든 SELECT 조각 `c.<칸> AS <키>` → 드라이버가 date 칸을 서버 로컬 자정 Date 로 → JSON = UTC 글자. 여정 대상 = 서버가 `new Date(r.recent_purchase_date).toLocaleDateString('ko-KR')`(프로세스 시간대에 기대는 꼴 · 오늘 표시는 맞음 · 꼴 「2026. 10. 6.」).
- FIELD_MAP 의 date 칸 = `birth_date` · `recent_purchase_date`(둘 다 DB `date` · t_tpl_closed `information_schema` 1031 실측). `wedding_anniversary`(date)는 FIELD_MAP 밖 = 조건 칸이 될 수 없다.
- 보내는 글(문자 머지)은 표시 CT `renderFieldValue` → `fmtDateDisplay` 가 시각 글자도 한국 날짜로 바꿔 정상(이번 결함 아님 · preview-recipients `routes/ai.ts:1172` 의 birth_date 도 이 길로 나간다).
- 뿌리 = 대장 R16(DB 날짜 칸을 시각으로 읽음 · 다섯 번째).

### 1-2 B · 받는 사람 불러오기

| 방식 | 직접발송(`DirectSendPanel`) | 알림톡(`AlimtalkSendModal`) |
|---|---|---|
| 직접입력 · 붙여넣기 | 더하기(`planAppend(..., false)` · 1437) | 더하기(`planAppend(..., dedupEnabled)` · 329 · 380 · 0925 Harold 승인 「추가인데 교체」 정정) |
| 주소록(공용 창 `AddressBookModal`) | **바꾸기** | **바꾸기** |
| 파일 등록 | 바꾸기(629) | 바꾸기(465) |

- 0925 알림톡 붙여넣기(바꾸기 → 더하기)와 이번 주소록이 같은 부류 = 두 번째 → 뿌리 대장 새 줄(R31).
- 「더하기」 판정 = `planAppend`(`frontend/src/utils/recipient-paste.ts:72` · 번호 숫자 비교) 한 곳. 중복 규칙은 여는 창의 직접입력 규칙을 따른다(직접발송 = 전부 더하고 보낼 때 [중복제거] · 알림톡 = 그 창 [중복제거] 토글).

## 2. 처방

### 2-1 A · 날짜 칸은 글자로 읽는다(R16)

- `resolveConditionColumns`: FIELD_MAP `dataType: 'date'` 인 칸 컬럼은 `c.<칸>::text AS <키>`(`YYYY-MM-DD`). `ConditionFieldDef` 에 `dataType` 을 더한다(부르는 곳은 FIELD_MAP 을 그대로 넘긴다 = 부르는 곳 변화 0 · `custom_fields->>` 는 이미 글자).
- 여정 대상(`routes/ai.ts:3763` SELECT · 3777): `recent_purchase_date::text AS recent_purchase_date` 로 읽고 그 글자를 그대로 넘긴다(서버 시간대 기대 0 · 꼴 = 다른 대상 창과 같은 `YYYY-MM-DD`).

### 2-2 B · 주소록 불러오기 = 지금 명단에 더하기(R31)

- `recipient-paste.ts` 에 `planAppendBy(items, existing, dedup, phoneOf)` 를 두고 `planAppend` 는 그것을 부른다(판정 한 곳 · 줄 객체를 그대로 돌려준다).
- `AddressBookModal` 두 갈래: 불러온 줄을 **지금 명단 뒤에 붙인다**(바꾸기 0). 판정 = 갱신 함수 하나 `appendUpdater(rows, dedup, phoneOf, onPlan)`(`recipient-paste.ts` · 그 순간 명단 prev 로 `planAppendBy` · 0 이면 같은 배열 · 판정 값을 onPlan 으로 창에 담기만). 창은 같은 비동기 이어짐에서 명단 갱신과 `noticeSeq` 를 함께 올리고, 알림 · 창 닫힘은 반영(커밋) 뒤 `noticeSeq` 효과가 그 판정을 읽어서 한다(Codex C85 1R · 2R · 미리 세기 · flushSync 0).
- 섞인 명단(주소록 줄 + 번호만 줄): 직접발송 = 빈 변수는 보내기 전 점검이 보인다(붙여넣기와 같다) · 알림톡 = 보내기 직전 `validateAlimtalkVariables` 가 빈 변수 수신자를 막는다(`AlimtalkSendModal.tsx:325` 주석 · 붙여넣기 때 이미 있는 장치).
- 창 prop `dedupOnAdd`(기본 거짓): 알림톡은 `dedupOnAdd={dedupEnabled}` · 직접발송(Dashboard)은 안 넘김(= 그 창 붙여넣기와 같은 규칙 · 보내기 전 점검이 「중복 N · 보낼 때 빠져요」를 이미 말한다).
- 여러 그룹 합치기 안의 번호 한 번만(옛 규칙 `seenPhones`)은 그대로.
- 글: 버튼 「발송 목록으로 불러오기」 → 「발송 목록에 더하기」 · 「고른 N개 합쳐서 불러오기」 → 「고른 N개 합쳐서 더하기」 · 「고른 1개 불러오기」 → 「고른 1개 더하기」. 알림 = 「N명을 지금 명단에 더했어요」(+ 중복 제외가 있으면 「· 중복 M명 제외」) · 더한 수 0 = 명단 그대로 + 오류 알림(알림 종류는 오류 · 성공 둘뿐): 겹침 때문이면 「고른 주소록 번호가 모두 이미 명단에 있어요」 · 주소록이 비었으면 「주소록에 번호가 없어요」(옛: 빈 그룹을 불러오면 명단을 빈 목록으로 바꿨다).

### 2-3 범위 밖(기록만 · 추가 과제)

- 파일 등록도 명단을 바꾸는 꼴(직접발송 629 · 알림톡 465) = 이번 접수 밖. 칸 맞추기 결과 전체를 쓰는 흐름이라 별도 설계(BUGS 기록).
- 알림톡 창은 보내기 접수 뒤 명단 비움을 `resetSignal` 효과(커밋 뒤 · `AlimtalkSendModal.tsx:475~483`)로 늦게 건다 → 같은 렌더에 들어온 불러오기(붙여넣기 · 파일 · 주소록) 줄까지 지운다 = 옛 경로(바꾸기 때도 같음) · 비움 배선(대시보드 ↔ 알림톡 창) 재설계는 이번 축 밖(Codex C85 3R · BUGS 기록). 직접발송은 await 뒤 바로 `setDirectRecipients([])`(큐에 쌓임)라 이 갈래가 없다.
- R16 계산 쪽 4곳(`inapp-personalization.ts:285` · `predictive-suite.ts:214` · `segment-analysis.ts:31` · `unified-customer-profile.ts:132` = `new Date(recent_purchase_date)` 로 날 수 셈) = 표시 아님 · 이번 접수 밖(BUGS 기록).

## 3. 영향표

| 바뀌는 것 | 소비처 | 영향 |
|---|---|---|
| `resolveConditionColumns` date 칸 = 글자 | `ai.ts:1322` → `AiLinePage` 추천 타겟 상세 · `ai.ts:2465` → `ProposalDecisionCard` | 응답 칸 값 Date → `'YYYY-MM-DD'` · 창 `val()` 이 그대로 그림 · 이 SQL(`buildSendableRecipientsTopSql` 상한 100)은 열람 전용(발송 = 다른 함수) · 서버 다른 쓰임 0 |
| 여정 대상 최근구매일 | `JourneysPage` 대상 창 | 꼴 「2026. 10. 6.」 → 「2026-10-06」 |
| `planAppendBy` 신설 · `planAppend` 위임 | `DirectSendPanel:1437` · `AlimtalkSendModal:329 · 380` | 동작 같음(`direct-input-modal-0925.test.ts` 그대로) |
| `appendUpdater` 신설(갱신 함수 · 판정 한 곳) | `AddressBookModal` addToList 하나 | 새 CT · 다른 소비처 0 |
| `AddressBookModal` 더하기 · `dedupOnAdd` | `Dashboard`(직접발송) · `AlimtalkSendModal` | 바꾸기 → 더하기 · 알림톡 = 토글 규칙 · 버튼 글 |

## 4. 시험

- 순수(backend vitest 가 프론트 CT 를 직접 import): `planAppendBy` dedup 참 · 거짓 · 숫자 비교 · 순서 · 줄 객체 그대로 · `planAppend` 결과 같음.
- 소스 계약: 주소록 창 명단 쓰기 = `setDirectRecipients(appendUpdater(` 한 줄 · 바꾸기 0 · 미리 세기(`planAppendBy(` · ref) · flushSync 0 · 알림 · 창 닫힘 = `noticeSeq` 효과 · 반영 전 알림 0 · 알림톡이 `dedupOnAdd={dedupEnabled}` · 버튼 글. 순수 = `appendUpdater` 갱신 큐 흉내(쌓인 비움 뒤 판정 1 · 겹침 = 같은 배열).
- 실 PG: `resolveConditionColumns` 가 만든 SELECT 조각(birth_date · recent_purchase_date)을 사본의 고객 한 행에 그대로 돌려(실제 드라이버) JSON 값 = `'2003-11-06'`(옛 코드 = 시각 글자 → 빨강). 전체 명단 SQL 은 안전 거름(`buildJourneySafetyFilter`)이 칸을 많이 요구해 조각 자리를 시험 자리로 고른다(결함이 사는 곳 = 조각 + 드라이버).
- 뿌리 대장: R16 넓힘(FIELD_MAP 에서 기계로 뽑은 date 칸마다 `::text` · 여정 대상 `new Date(r.recent_purchase_date)` 0) · R31 새 describe(여는 곳 = 프론트에서 `<AddressBookModal` 을 가진 파일을 기계로 뽑음 · 그 파일이 `planAppend(` 를 `dedupEnabled` 로 부르면 `dedupOnAdd={dedupEnabled}` 를 넘기고 아니면 넘기지 않는다 · 창 안 `setDirectRecipients(` = 한 줄이고 그 줄이 `appendUpdater(` · 판정은 그 갱신 함수 안 prev 기준).
- 변이: `::text` 제거 · 여정 `new Date` 되살림 · 주소록 바꾸기로 되돌림 · `dedupOnAdd` 무시.

## 5. 구조체크 진행표

| 회차 | 결함 | 처방 |
|---|---|---|
| 1 | SC1 알림톡 창에서 주소록 줄과 번호만 줄이 섞일 때 빈 변수 처리를 안 적음 | 2-2 줄(이미 있는 `validateAlimtalkVariables` · 직접발송 = 보내기 전 점검) |
| 1 | SC2 빈 그룹 불러오기 = 옛 코드는 명단을 빈 목록으로 바꿨다 · 더한 수 0 의 알림 · 알림 종류(오류 · 성공 둘뿐)를 안 정함 | 2-2 글 줄 |
| 1 | SC3 비동기 응답 뒤 명단 쓰기를 ref 값으로 하면 그사이 다른 쓰기(보내기 접수 뒤 비움 `Dashboard.tsx:828`)를 덮을 수 있음 | 2-2 = 함수형 갱신 한 곳 · 알림 수만 ref |
| 1 | SC4 R31 계약의 「여는 곳의 규칙」을 무엇으로 뽑는지 안 정함 | §4 R31 줄 |
| 1 | SC5 실 PG 시험 자리 = 전체 명단 SQL 은 안전 거름이 칸을 많이 요구 | §4 실 PG 줄 = 조각 + 실제 드라이버 |
| 1 | 확인한 것 = 여정 대상 `recent_purchase` 소비처 = 공용 창 조건 칸 하나(다른 읽는 곳 0) · `ConditionFieldDef` 에 `dataType` 을 더해도 FIELD_MAP 은 그대로 넘어간다(구조 타입) · `operator-recipients.verify.ts` 의 DEFS 는 dataType 없음 = 옛 조각 그대로 · 날짜 칸을 그리는 공용 창 입구 = 셋(나머지 넷은 조건 칸 0) | 없음 |
| 2 | 0: 0절 ~ 4절을 처음부터 다시 코드 줄(`operator-recipients.ts` 150~230 · `routes/ai.ts` 1241~1345 · 2455~2495 · 3755~3795 · `AddressBookModal.tsx` 60~100 · 285~360 · 638~650 · 874~882 · `recipient-paste.ts` 60~90 · `AlimtalkSendModal.tsx` 318~360 · 1228~1235 · `DirectSendPanel.tsx` 1430~1465 · `Dashboard.tsx` 820~830 · 3446~3452 · `TargetRecipientsModal.tsx` 150~165)에 대 봄 · 함수형 갱신 타입(Dispatch<SetStateAction<Contact5[]>> · 알림톡 any[]) · 알림 종류 · 계약 시험 뽑기(`sourceFiles(FE, /\.tsx$/)`) 다 맞음 | 없음 |
| 3(구현 뒤 · Codex 4R approve 뒤) | SC6 2-2 가 1R 전 꼴(명단 = 함수형 갱신 안 planAppendBy · 알림 수 = ref)을 적음 ↔ 코드 = 갱신 함수 `appendUpdater` + 반영 뒤 효과 | 2-2 줄 |
| 3 | SC7 §4 계약 줄 · R31 줄이 `planAppendBy` 직접 부름을 적음 ↔ 계약 시험은 `appendUpdater` 한 줄 · 효과 | §4 두 줄 · 뿌리 대장 R31 줄 |
| 3 | SC8 §3 영향표에 새 CT `appendUpdater` 줄 없음 | §3 줄 |
| 3 | 확인한 것 = 두 불러오기 모두 세대 확인(`loadSeqRef`) 뒤에 `addToList` · 실패 응답 · 예외 갈래는 옛 그대로(오류 알림 · 가림막 해제) · 새 글(버튼 · 알림 4종)에 모델명 · native dialog · 줄표 0 · 날짜 칸 처방은 Codex 1R 부터 지적 0 | 없음 |
| 4 | 0: 설계서 0절 ~ 4절 · 뿌리 대장 R16 · R31 줄을 최종 코드(`operator-recipients.ts` 190~205 · `routes/ai.ts` 3760~3780 · `recipient-paste.ts` 60~120 · `AddressBookModal.tsx` 1~10 · 198~226 · 325~392 · 640~650 · 876~882 · `AlimtalkSendModal.tsx` 1228~1236)와 시험 3파일에 다시 대 봄 · 남은 옛 낱말(ref · 미리 세기 · flushSync · appendCommitted) 0 | 없음 |

## 6. Codex 진행표

| 라운드 | 지적 | 판정 · 처방 |
|---|---|---|
| 1R needs-attention | 중간 · `AddressBookModal` addToList: 알림 수와 「더한 수 0 → 쓰지 않음」을 마지막으로 그린 명단(ref)으로 판정 → 알림톡 보내기 접수 뒤 명단 비움(`setRecipients([])`)이 그려지기 전에 같은 번호 주소록 응답이 오면 빈 명단인데 「이미 있어요」로 줄이 빠짐 | 수용(새 뿌리 · 미리 센 값과 반영 값이 두 벌 = R1). 판정 · 명단 · 수 · 알림 · 창 닫힘 = 반영된 계산 하나: CT `appendCommitted(setList, flush, rows, dedup, phoneOf)`(함수형 갱신 안 prev 로 `planAppendBy` · `flushSync` 로 바로 처리 · 0 이면 같은 배열) · 창의 ref · 미리 세기 삭제(코드 줄어듦). 시험 = React 갱신 큐 흉내(그리기 전 비움 → 더한 수 1 · 명단 = 주소록 줄 · 겹침 = 같은 배열) · 계약 = 창 안 쓰기 = `appendCommitted(setDirectRecipients, flushSync,` 한 줄 · `listRef` · `planAppendBy(` 0. 변이 둘(flush 빼기 · 미리 세기 되살림) → 잡힘. 덧붙인 말(`::text` = ISO DateStyle 전제)은 지적 아님 · 이 저장소 날짜 칸 규약이 `::text` 하나(R16 · 날짜축 워커 `anchor_date::text` 가 같은 전제로 운영 중)라 여기만 `to_char` 로 바꾸면 규약이 두 벌 |
| 2R 질문(판정 보류) | Codex 가 React 판 · 루트 생성 방식을 물음(flushSync 가 쌓인 일반 갱신을 함께 처리하는가가 판 마다 다름) | 확인 = react · react-dom 18.3.1 · `createRoot` · StrictMode(`main.tsx:10`). 그 사실로 내 1R 처방을 다시 따져 결함을 찾음: 18 동시 모드의 flushSync 는 동기 우선순위만 바로 처리해, 비동기 이어짐에서 걸린 접수 뒤 비움(기본 우선순위)을 건너뛰고 우리 갱신을 계산한다 → 명단은 나중에 다시 맞지만 알림 · 창 닫힘은 옛 계산을 따른다. 같은 부류 두 번(R1 지적 · 내 처방) = 「반영 전 계산으로 알림을 정함」이 뿌리 → 구조 수정: 판정 = 갱신 함수 하나(`appendUpdater(rows, dedup, phoneOf, onPlan)` · 그 순간 prev) · 알림 · 창 닫힘 = 반영(커밋) 뒤 효과가 그 판정을 읽음(같은 이어짐에서 명단 갱신과 `noticeSeq` 를 함께 올려 같은 우선순위로 한 번에 그려짐) · flushSync · `appendCommitted` 삭제. 시험 = 갱신 큐 흉내(쌓인 비움 → 판정 1 · 겹침 = 같은 배열) · 계약 = 쓰기 한 줄 · 효과가 알림 · 창 닫힘 · 반영 전 알림 0. 변이 넷(prev 무시 · 미리 세기 · noticeSeq 빠짐 · 반영 전 창 닫기) → 잡힘 |
| 3R needs-attention | 중간 · 알림톡 보내기 접수 뒤 `resetSignal` 이 주소록 응답과 같은 렌더에 들어가면, 비움(`setRecipients([])`)은 그 커밋 뒤 효과에서 걸려 방금 더한 줄까지 지운다(성공 알림 뒤 명단 0) | 불수용(축 밖 · 옛 경로): 비움이 효과로 늦게 걸리는 배선은 이번 수정 전부터 있었고 옛 「바꾸기」 주소록 · 붙여넣기 · 파일 등록도 같은 렌더에 들면 똑같이 지워진다(C85 가 만든 갈래 아님) · 처방(대시보드 ↔ 알림톡 창 비움 배선 재설계)은 C85 축 밖 → 설계서 2-3 · BUGS B-1031-3 남김에 기록. 닿는 조건 = 알림톡 보내기 접수가 진행 중인 동안 그 창 위 주소록 창에서 불러오기 응답이 같은 렌더에 들어옴(주소록 창이 보내기 버튼을 덮는다). Codex 확인 = ①(쌓인 같은 우선순위 갱신 · eager) · ②(StrictMode) 맞음 · ③ 전환 · 언마운트 갈래 차단 사유 아님 · ④ R1 · R31 충족 |
