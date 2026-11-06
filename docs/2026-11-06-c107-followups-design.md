# C107 추가 과제 셋 설계서(1106)

> 접수 = 2026-11-06 Harold 「전부 제대로 구조체크해」 → 「제대로 체크해서 완벽하게 수리해」.
> 흐름 표 · 결함 장부 = [2026-11-06-c107-followups-flow-ledger.md](2026-11-06-c107-followups-flow-ledger.md)(실측 다섯 · 결과 기록).
> 카드 = C108(작업 이름 C107F · 배포 원장 C108-H1 ~ C108-S1).
> 판 = 한줄로 11893902 · 게이트웨이 bff79a9 · 에이전트 1.0.32(.62 네 대).

## §0 결정(Harold 1106)

| 번호 | 질문 | 답 |
|---|---|---|
| H1 | 공급사(휴머스온)가 친구 · 비친구를 무엇으로 나눠 청구하나 | **받는 사람별 실제 친구 여부**(카카오 보고 FRIEND_YN) |
| H2 | 게이트웨이가 리셀러에게 받는 브랜드 단가도 같이 바꾸나 | **함께 바꾼다** |
| H3 | 지난 마수동 전체(M) 발송 차액 소급 | **소급 없음**(고친 뒤 발송분부터) |

단가 규칙 하나(②의 핵심 · 세 시스템 같은 글자) = **친구 단가 ⇔ 대상값이 친구(I · F) 이거나 실제 친구(Y)** · 그 밖 = 비친구 단가.
- 대상값이 친구(I · F)인데 실제 N 은 카카오 정의상 나오지 않는다(I = 채널 친구만 · F = 채널 친구 전체). 나와도 **올려 받지 않는다**(선불 = 추가 차감 불가 · 후불도 같은 규칙으로 맞춘다) → 게이트웨이 로그 경고 한 줄만.
- 실제 값이 없는 행(브랜드 실패 · 문자 대체 · 옛 행 · QTmsg 라인) = 대상값 규칙 그대로(종전).

## §1 ① 비토 라인 스팸 차단 → 스팸 몰림 경보

### 처방
- `SPAM_BLOCK_STATUS_CODES`(sms-result-map.ts:156) = **결과 표 라벨에 「스팸」 ∪ 비토 대역 표(HANJUL_BAND_CODES) 제목에 「스팸」**. 둘 다 기계로 뽑는다(손 목록 0). 결과 = 종전 7개 + 39004 · 39010 · 40016 · 49004 · 49010.
- 카카오 채널 제재(21025 「메시지차단 상태의 카카오톡 채널」 · 21027)는 제목에 「스팸」이 없어 들어가지 않는다 = 종전 QTmsg 목록에도 카카오 코드가 없는 것과 같다(통신사가 문자를 막은 일이 아니다 · 안내 문구 「통신사가 … 스팸으로 막았어요」와 맞지 않는다).
- 소비처 = smsCampaignSpamCountsSafe 하나(sms-queue.ts:545) → 여정 결과 안내(journey-result-notice.ts:197) · 상황판(manager-board.ts:194). 둘 다 그대로(목록만 넓어진다).

### 뿌리 R64 — 결과 코드의 뜻 목록을 한 원천(QTmsg 결과 표)에서만 뽑아 새 원천(비토 대역 코드)을 모른다
- 같은 배포 전수 grep(1106) = `Object.entries(STATUS_CODE_MAP)` 로 뜻을 뽑는 곳 = 이 목록 하나. 그 밖 결과 판정은 `getStatusLabel` · `getStatusType`(대역 인식) 또는 SUCCESS · PENDING CT(대역 = 실패로 맞게 갈린다).
- 뿌리는 다르지만 같이 닫는다: manage-stats.ts:156 ~ 158 시험 발송 요약의 성공 · 대기 손 목록 = §3-2(R67).

### 계약 시험(c107f-contract-1106 · 한줄로)
- F1 목록 = 두 표에서 「스팸」을 뽑은 합집합과 **같다**(순서 무관) · 대역 쪽 원소 ≥ 1 · 원소 전부가 실패 유형(getStatusType = fail).
- 고치는 기존 시험: c107-brand-contract-1105.test.ts:438(「전부 20000 미만」 → F1 로 옮김) · spam-surge-notice-1102.test.ts:20(want = 두 표 합집합).
- 변이: 대역 합집합을 빼면 F1 빨간불.

### 확인(직원 시트 없음 · 운영 대조)
스팸 차단을 직원이 일부러 일으킬 수 없다. 배포 뒤 운영 대조 = 비토 라인 대역 스팸 코드 행이 생긴 캠페인의 스팸 수가 0 이 아닌지(배포 원장 C108-S1 · 읽기 SQL).

## §2 ② 브랜드메시지 친구 · 비친구 단가 = 받는 사람의 실제 친구 여부

### 흐름(고친 뒤 · 흐름 표 ② 의 각 칸)
카카오 REPORT FRIEND_YN → 게이트웨이 원장 `message_request.friend_yn`(이미 있음) → **(G-b) 게이트웨이가 에이전트로 보내는 보고에 실음** → **(A-a) 에이전트가 SMSQ 칸 `k_friend_yn` 에 씀** → **(H-a · H-b · H-c) 한줄로 청구 · 선불 정산 · 화면이 그 칸을 읽음**. 게이트웨이 자기 청구는 **(G-c) 보고 때 과금 행을 다시 매김**.

### G-a 보고 형식(proto)
- `ReportMessage` 에 `string friend_yn = 10;`(bito.proto:158 ~ 168). 생성 = 저장소 buf.gen.yaml(로컬 protoc-gen-go v1.36.11 · protoc-gen-go-grpc 1.6.1 · 지금 생성본과 같은 판). 옛 에이전트는 모르는 칸을 무시(proto3) · 새 에이전트 + 옛 게이트웨이 = 빈 값.

### G-b 게이트웨이 → 에이전트
- 실시간: `engine.OutboundReport` 에 `FriendYN` · 브랜드 보고를 적재하는 자리(handleReportOne · 브랜드는 늘 느린 경로 = report_batcher.go:65 문자만 빠른 경로)에서 `report.FriendYN` 을 싣는다 · session/agent_stream.go:55 가 `FriendYn` 으로 옮긴다.
- 재전달: session/grpc_server.go:880 조회가 이미 `JOIN message_request mr` → `COALESCE(mr.friend_yn, '')` 을 읽어 싣는다(report_queue 새 칸 없음).
- 값 = **청구에 쓰는 친구 확인** = 그 요청의 과금 행에 **친구 정산 표식(G-c `friend_settled_at`)이 있을 때만** 원장 값(Y · N) · 없으면 빈 값. 판정 식 = Go 상수 하나(실시간 적재 · 재전달이 같은 글자 · GC0).
  - ★ Codex 설계 2R: 표식을 「스냅숏 있음」으로 하면 마이그레이션 101 과 새 판 사이에 옛 판이 처리한 보고(스냅숏 있음 · 친구 정산 없음)가 새 판 재전달로 Y 를 싣는다 → 한줄로만 친구 청구. 정산 함수만 쓰는 표식으로 거르면 배포 순서 · 옛 판 동작과 무관하게 「게이트웨이가 친구 정산을 마친 요청만」 친구 값이 나간다(옛 게이트웨이를 멈추는 단계 불필요). 실시간 · 재전달 같은 규칙(재전달 조회에 `LEFT JOIN message_billing mb ON mb.request_id = mr.id`).
  - 까닭(Codex 설계 1R #2): 켜는 시점을 하나로 묶는다. 스냅숏은 게이트웨이 새 판이 발송 과금을 한 요청에만 생긴다 → 그 전에 나간 발송의 늦은 보고 · 재전달은 빈 값 = 한줄로 · 게이트웨이 모두 종전 규칙(H3 소급 없음과 같은 경계). 대상값이 친구(I · F)면 스냅숏이 없어 빈 값 = 한줄로가 대상값으로 친구 단가(같은 결과).

### G-c 게이트웨이 청구 다시 매기기(H2)
- 마이그레이션 101(lock_timeout 250ms · 다시 실행해도 같음):
  - `message_billing.friend_unit_price NUMERIC(10,2) NULL` = **차감 순간의 친구 단가 스냅숏**(브랜드 · 대상값이 친구가 아닌 행만 · 그 밖 NULL).
  - `message_billing.friend_settled_at TIMESTAMPTZ NULL` = 친구 정산을 마친 시각(정산 함수만 쓴다 · 차액 0 · 실제 N 이어도 마침 표식은 남긴다 · 스냅숏 없는 행 = NULL 그대로).
  - 표식과 돈(원장 · 지갑 · 과금 행 · 요청 행)은 **정산 함수 한 번 = 한 트랜잭션**에서 함께 움직인다(표식만 남고 돈이 안 움직이거나 그 반대인 상태 0). 이미 표식이 있으면 아무것도 하지 않고 `already` 를 돌려준다(멱등 키와 이중 방어).
  - 발송 과금 두 자리(`prepare_dispatch_billing` 070:85 · `dispatch_batcher.go:45` 묶음 SQL)가 같은 친구 단가 식으로 스냅숏을 함께 쓴다(지금 두 자리의 브랜드 CASE 글자는 같다 · 계약 시험이 고정).
  - 새 함수 `settle_brand_friend_price(p_request_id BIGINT, p_key TEXT) RETURNS TEXT`: 조건 = 브랜드 유형 · 결과 성공(과금 상태 CAPTURED · ACCRUED) · `mr.friend_yn = 'Y'` · `NOT brand_targeting_is_friend(payload)` · `friend_unit_price IS NOT NULL AND friend_unit_price < unit_price`. 잠금 순서 = 요청 행 → 지갑 → 과금 행(환불 SQL 세 벌과 같은 순서).
    - 친구 금액 = 발송 과금과 같은 반올림(`vat = ROUND(friend_unit_price × 0.1, 2)` · `charge = ROUND(friend_unit_price + vat, 2)` · 070:191 ~ 192). **차액 = 잠근 과금 행의 기존 charge_amount − 친구 charge**(Codex 설계 1R #3 · 공급가 차에 부가세를 다시 붙이면 반올림이 어긋난다).
    - 선불: 원장 `REFUND` 한 줄(멱등 키 `friend_adjust:{request_id}` · 금액 = 차액 · 설명 「브랜드 친구 단가 차액」 · parent = 차감 원장) · 지갑 + 차액 · 과금 행 · 요청 행의 unit_price · vat_amount · charge_amount = 친구 금액. 차액 ≤ 0 이면 아무것도 안 함.
    - 후불: 과금 행 · 요청 행 금액만 친구 단가로(지갑 0).
    - 대상값 친구(I · F) + 실제 N = 바꾸지 않고 `brand_friend_mismatch` 로 돌려준다(엔진이 경고 로그).
  - 소비처: 콘솔 청구서 = 과금 행 금액 합(billing-admin.js:1760 `SUM(charge_amount)`) → 자동으로 따라온다. 지갑 정합 점검(integrity-auditor · reconciliation) = 과금 상태만 본다(CAPTURED 그대로) → 영향 없음.
- 부르는 자리 = 성공 확정 바로 뒤(billing_finalizer.go:16 `finalizeBillingForReport` 성공 갈래) · 같은 오류 계약(실패하면 중계사 수신 확인 보류 → 재전송 때 다시 · 멱등 키로 두 번 움직이지 않는다).

### M-a SMSQ 칸(.62 MySQL · root)
- `SMSQ_SEND_12 ~ 16` 에 `k_friend_yn varchar(1) NULL DEFAULT NULL` 추가(`ALGORITHM=INSTANT` · 안 되면 INPLACE · `LOCK=NONE` · lock_wait_timeout 2 · 0920 k_etc_json 확장과 같은 꼴).
- 비토 라인만: 이 표들은 월별 이력 표가 없다(SCHEMA.md:1795 · 비토 에이전트는 제자리 갱신) → 에이전트 이력 옮기기(archiver.go:638 `INSERT … SELECT *`)와 칸 수 어긋남이 생길 자리가 없다. **실행 전 실측**: 네 대 설정의 이력 옮기기 꺼짐 · `SMSQ_SEND_1[2-6]_%` 표 0개 · MySQL 판(INSTANT 지원).
- QTmsg 라인(1 ~ 11 · 이력 표 103개)은 건드리지 않는다.

### A-a 에이전트(1.0.33)
- `fieldmap.StandardFieldMapKeys`(standard_fields.go:27 「결과 반영용」)에 `friend_yn` · poller 결과 쓰기(poller.go:1021 옆)에 `if col := OptionalColumn("friend_yn"); col != "" && report.FriendYn != "" { addSet(col, report.FriendYn) }`.
- 설정에 그 칸을 넣은 회사만 동작(외부 고객사 에이전트 영향 0) · 값 = Y · N 만 씀(빈 값이면 칸을 건드리지 않는다).
- 설정(네 대 · 배포 때): `field_map.friend_yn: "k_friend_yn"` → 재시작(적재 0건 · G6 와 같은 한 줄). ⚠ field_map 칸은 SELECT 목록에 들어가므로(standard_fields.go:7) **M-a 가 먼저**다.

### H-a 한줄로 후불 청구 식
- 새 CT `smsTableFriendColumn(table)` = 그 표에 `k_friend_yn` 이 있으면 그 이름 · 없으면 null(information_schema 한 번 읽어 캐시 · 표 목록 CT 와 같은 꼴).
- `BILLING_MSG_TYPE_SQL`(send-usage-aggregation.ts:73) → `billingMsgTypeSql(friendCol)` 함수: 친구 칸이 있으면 브랜드 갈래 = `TARGETING ∈ (I, F) OR k_friend_yn = 'Y'` → F · 그 밖 FN · 칸이 없으면 종전 글자 그대로. 쓰는 세 함수(:314 · :341 · :367)가 표마다 `FROM ${t}` 로 따로 묻는다 → 그 표의 식을 쓴다. 대체 WHEN 이 먼저인 순서는 그대로(c107 K1 ③).
- 그 결과를 읽는 곳(정산서 · 매장별 미리보기 billing.ts BRAND_NF · 발행 항등식 billing-issue.ts) = 유형 키 그대로라 변경 0.

### H-b 한줄로 선불 정산
- 차감 때(대상값이 친구가 아닌 브랜드 차감 · prepaidDeduct BRAND 축): 결과별 정산 문구에 친구 단가를 함께 싣는다 — `· 결과별 정산: 브랜드메시지 X원 · 친구 W원 · SMS 대체 Y원 · LMS 대체 Z원`(대체 끔이면 `· 결과별 정산: 브랜드메시지 X원 · 친구 W원`). X = 그 대상값 단가(비친구) · W = 같은 형태의 친구 단가(차감 순간 · 부가세 포함 · deduct-reference 원칙).
- 되읽기(parseAlimtalkUnits)가 두 꼴 + 친구 조각을 받는다 · 친구 조각이 없는 옛 행 = 종전.
- 스위퍼(mysql-refund-sweeper.ts:506 4-2-A): 그 캠페인의 **브랜드 성공 중 `k_friend_yn = 'Y'` 수** × (X − W) 를 같은 차액 항아리(REFUND_KEYS.KAKAO_DIFF)에 더한다 · 회수 한도 · 불변식 = 같은 차액 합(unitDiffLegit).
- **원장 축 둘 다**(Codex 설계 1R #1): 지금 결과별 차액은 `axis.scope === 'all'` 일 때만 계산한다(:514 · :515). 브랜드 전용 = BRAND 축 scope all(종전 자리에 친구 갈래) · 문자 + 브랜드(both) = BRAND 축 scope brand(billing-types.ts:173 ~ 176 · 대체 끔이라 친구 갈래만) → scope brand 에서도 같은 계산을 돌린다. 친구 수 = 그 축이 소유한 행(msg_type F)만. 정산 기준(read_high)에 `brandUnitDiff` 칸을 따로 둔다(scope all 의 `unitDiff` 와 섞지 않는다 · mergeReadHigh · parseReadHigh 짝) · 회수 한도 · 불변식은 그 축의 차액 합.
- 친구 수 집계 = 결과 집계 CT(smsKakaoResultAgg · sms-queue.ts:608) 에 `friendOk` 칸. 이 CT 가 쓰는 `smsBatchAggByGroup`(sms-queue.ts:482)은 표마다 같은 글자를 `UNION ALL` 로 붙인다(:497) → 집계 글자 인자를 `string | (table) => string` 으로 넓혀 친구 칸이 있는 표 = `SUM(CASE WHEN <브랜드 성공> AND k_friend_yn = 'Y' …)` · 없는 표 = `0 AS friendOk`(별칭 순서 같음).
- 정산 식(refund-calc.ts:190 calcAlimtalkUnitDiff): 결과 갈래에 `친구 성공 × max(0, 차감 단가 − 친구 단가)` 를 더하고 알림톡 · 브랜드 성공 갈래에서 그 수를 뺀다(resolveAlimtalkMix · :173). 친구 단가가 없는 문구 = 그 갈래 0(종전).
- 대체 끔 브랜드 차감: 지금은 결과별 문구를 싣지 않는다(prepaid.ts:225 brandFb 일 때만) → 대상값이 비친구면 대체 끔이어도 `KAKAO = 차감 단가 · SMS = LMS = 차감 단가 · 친구 W` 문구를 싣는다(친구 갈래 말고는 차액 0 = 종전 금액).

### H-c 한줄로 화면 금액 · 이름
- 발송결과 비용(results.ts:211 + ResultsModal.tsx:536 ~ 547): 서버가 캠페인별 브랜드 친구 성공 수를 함께 내고, 화면이 `친구 성공 × 친구 단가 + 나머지 브랜드 성공 × 대상값 단가` 로 그린다(대상값이 친구면 종전과 같은 값).
- 관리 통계 내보내기(admin.ts:6541): 대상값이 친구가 아닌 브랜드 캠페인은 친구 성공 수만큼 「브랜드메시지(친구)」 칸으로 나눠 센다(정산서와 같은 줄).
- 캠페인 이름(campaign-list-csv.ts:17 · sms-result-map.ts:389) = 보낸 설정의 이름이라 그대로.

### 뿌리 R65 — 청구 축(친구 · 비친구)을 받는 사람의 실제 값이 아니라 보낸 설정값으로 매기고, 실제 값은 원장에서 멈춘다
- 같은 배포 전수 grep(1106) = 대상값으로 친구를 가르는 자리: 게이트웨이 070:122 · :134 · dispatch_batcher.go:45 · :51 / 한줄로 send-usage-aggregation.ts:76 · prepaid.ts(차감 단가 · 그대로 = 차감은 최대값) · results.ts:211 + ResultsModal.tsx:547 · admin.ts:6541 · sms-result-map.ts:389(이름 · 그대로).

### 계약 시험
- 게이트웨이: GC0 친구 확인 값 = 정산 표식 있을 때만 원장 값(실시간 · 재전달 같은 상수 · 실 PG = 스냅숏 없는 요청 · **스냅숏은 있는데 정산 없이 적재된 요청(옛 판 처리)**의 재전달 = 빈 값 · 정산 뒤 = Y) · GC1 AST = `pb.ReportMessage{` 리터럴 전부(agent_stream.go · grpc_server.go)가 `FriendYn` 을 싣는다 · GC2 발송 과금 두 자리의 친구 단가 식이 같은 글자 · 스냅숏을 쓴다 · GC3 실 PG(t_ 그릇) = M + Y → 선불 차액 환불 1 · 다시 불러도 1 · 후불 금액만 · I + N → 그대로 · 실패 행 → 그대로 · 스냅숏 없음 → 그대로.
- 에이전트: AC1 StandardFieldMapKeys ∋ friend_yn · AC2 결과 쓰기 = Y 면 칸 · 빈 값이면 SET 에 없음.
- 한줄로: HC1 청구 식 = 친구 칸 있는 표 / 없는 표 두 꼴 · 세 함수가 표마다 함수를 부른다(상수 직접 사용 0) · HC2 결과별 정산 문구 생산 · 되읽기 짝(친구 조각) · HC3 스위퍼 차액 = 친구 성공 × (X − W) · scope all(브랜드 전용 · 대체 켬 / 끔) · scope brand(both · 문자 성공과 브랜드 친구 성공이 섞인 캠페인) · brandUnitDiff 기준 · HC4 화면 금액식.
- 게이트웨이 GC3 에 반올림 사례(친구 공급가 10.04 · 기존 10.05 → 차액 = 11.06 − 11.04 = 0.02).
- 변이: 각 자리 하나씩 꺼서 빨간불.

### 직원 지시문 초안(시트 50 ~ 53 · 테스트계정 · 직원 본인 휴대폰 · 그 번호가 테스트 채널 친구인 상태)
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 50 | 브랜드메시지 보내기에서 대상을 「마수동 전체」로 골라 직원 본인 번호 1명에게 보낸다 | 「발송했어요」가 뜬다 |
| 51 | 10분 뒤 발송결과에서 그 발송을 연다 | 결과 「성공」 · 비용 칸이 친구 단가 1건 값과 같다 |
| 52 | 충전관리 차감이력을 연다 | 그 발송 차감 줄 아래 「결과별 단가 차액 환불」 줄이 있고 금액 = 비친구 단가 − 친구 단가 |
| 53 | 정산 미리보기(그 달)를 연다 | 「브랜드메시지(친구)」 줄에 1건이 더해져 있다 |

## §3 ③ 게이트웨이 시험 흔들림

### 처방
- grpc_client_test.go:264 시험이 첫 Flush 뒤 **실패한 기록 작업의 연결 끊기(상태 = 끊김)가 끝날 때까지 기다린 다음** 상태를 되살린다(운영 = 끊김 뒤 새 연결이 되살리는 순서와 같다 · grpc_client.go:567).
- 운영 코드 변경 0.

### 뿌리 R66 — 시험이 상태를 되돌릴 때 앞 단계의 비동기 부작용이 끝났는지 확인하지 않는다
- 같은 배포 전수 grep(1106) = `client.state.Store(int32(StateConnected))` 10곳(internal/agent/client 시험) 중 **실패 뒤 다시 부르는 자리 = grpc_client_test.go:290 하나**. 그 밖 = 처음 차림(:36 · :117 · :225 · :251 · :280 · :325 · :387 · :946) · :404 = 세대를 올린 새 연결(옛 작업이 못 건드리는 바른 꼴 · 끊김이 세대를 확인한다 grpc_client.go:1081).

### 확인
- 고친 시험 `-count=600` 실패 0 · 고치기 전 꼴(기다림 뺌)로 되돌리면 실패가 다시 난다(변이).

## §3-2 ④ 결과 판정 손 목록(1106 Harold 「봤으면 없애야지」 · 설계 중 발견)

### 결함
- manage-stats.ts:156 ~ 158 시험 발송 요약 = 성공 `IN (6, 1000, 1800)` · 실패 `NOT IN (6, 1000, 1800, 100)` · 대기 `= 100` 손 목록 → 대체 성공 7830 · 7831 이 실패 · 대기 104 가 실패로 센다(관리 화면 시험 발송 성공 · 실패 · 대기 수가 틀린다). C107 이 같은 파일 :287 행 판정만 CT 로 옮기고 이 집계를 빠뜨렸다.
- expired-pending-sweeper.ts:30 대기 `IN (100, 104)` 손 목록 = 값은 지금 PENDING_CODES 와 같지만 목록이 바뀌면 이 자리만 어긋난다(같은 꼴).

### 처방
- 두 자리를 결과 CT(sms-result-map.ts SUCCESS_CODES_SQL · PENDING_CODES_SQL)로. manage-stats 실패 = `NOT IN (성공, 대기)`(results.ts:795 와 같은 글자).

### 뿌리 R67 — 결과 판정 목록(성공 · 대기)을 CT 대신 손으로 적는다
- 전수 grep(1106 · packages 전체 · 빌드 산출물 dist-old 제외) = `IN \(6, ?1000|\[6, ?1000|\(100, ?104\)|\[100, ?104\]` → 위 두 곳뿐(sms-result-map.ts 정의 자리 제외).
- `status_code = 100` 단독(campaigns.ts · campaign-lifecycle.ts · cancelled-queue-sweeper.ts · direct-send-worker.ts) = 결과 판정이 아니라 「아직 에이전트가 안 집은 행만 지운다 · 옮긴다」는 동작 조건(104 = 집은 뒤 결과 대기라 지우면 안 된다) → 대상 아님.

### 계약 시험(c107f-contract-1106 · F4)
- 한줄로 backend src 전체(시험 · sms-result-map.ts 제외)에서 `status_code (NOT )?IN (` 바로 뒤가 숫자인 SQL 조각 0 · 배열 리터럴 `[6, 1000` · `[100, 104` 0. 변이 = manage-stats 를 옛 글자로 되돌리면 빨간불.

### 직원 지시문 초안(시트 54)
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 54 | 관리 메뉴 발송 통계에서 시험 발송 요약을 연다(시트 50 의 브랜드 시험이 대체 문자로 나간 날이 있으면 그날) | 대체로 나간 시험 건이 「성공」 수에 들어 있다 |

## §4 배포 순서(런북 · 한 묶음 · 받는 쪽 먼저 · 켜기 = 게이트웨이 마지막 · Codex 설계 1R #2)
1. 한줄로 배포(친구 칸이 없으면 종전 식 · 이때부터 비친구 대상 브랜드 차감에 친구 단가 조각) · ①(스팸) · ④(손 목록)도 이 배포.
2. C108-M1 .62 MySQL 실측(이력 옮기기 꺼짐 · 이력 표 0 · 판) → M-a DDL.
3. 에이전트 1.0.33: 게이트웨이 런북의 에이전트 출고 절차 → .62 네 대 교체 + `field_map.friend_yn` → 재시작(적재 0건 · 옛 게이트웨이 = 친구 값 빈 값이라 쓰지 않는다).
4. 켜기 전 문 C108-G0(읽기 · .62): 한줄로 배포(1) 전에 차감한 예약 브랜드 캠페인 중 대상값이 친구가 아니고 아직 안 나간 것 = 0(있으면 그 발송이 끝난 뒤 켠다 · 차감 문구에 친구 조각이 없어 선불 차액이 없는데 게이트웨이만 친구로 정산하는 경계를 막는다).
5. 게이트웨이(켜기): 마이그레이션 101 → bff79a9 다음 판 배포(§2 check · build · §3-3 · 새 PID ERROR 세기). 101 과 새 판 사이 옛 판이 과금 · 처리한 요청은 스냅숏만 있고 정산 표식이 없어 친구 값이 나가지 않는다(Codex 설계 2R · 옛 판을 멈추지 않는다). 새 판이 처리한 보고부터 정산 · 친구 값.
6. 실측: 브랜드 M 1건(시트 50 ~ 53) · 게이트웨이 원장 `friend_adjust:` 1줄 · SMSQ `k_friend_yn = 'Y'` 1행.

## §5 구조체크(설계 · 이음매)
| 이음매 | 확인 | 판정 |
|---|---|---|
| 카카오 → 원장 friend_yn | updater.go:148 · 브랜드 = 느린 경로뿐(report_batcher.go:65) | 이미 됨(11-05 실측 12/12) |
| 원장 → 보고(실시간 · 재전달) | G-b 두 자리 · GC1 | 설계 |
| 보고 → 에이전트 → SMSQ | A-a · M-a 먼저 · AC1 · AC2 | 설계 |
| SMSQ → 한줄로 후불 | H-a 표마다 식 · HC1 | 설계 |
| SMSQ → 한줄로 선불 | H-b 차감 문구 ↔ 되읽기 짝 · 스위퍼 · HC2 · HC3 | 설계 |
| 원장 → 게이트웨이 청구 | G-c 스냅숏 · 정산 함수 · 잠금 순서 · GC2 · GC3 | 설계 |
| 화면 금액 · 통계 칸 | H-c · HC4 | 설계 |
| 대상값 I · F + 실제 N | 올려 받지 않음 · 경고 | 결정(§0) |
| 켜는 시점 · 배포 사이 | 게이트웨이 마지막 · 친구 확인 값 = 정산 표식 있을 때만(2R) · 켜기 전 문 G0 | 설계(Codex 1R #2 · 2R) |
| both 브랜드 원장 | scope brand 계산 · brandUnitDiff | 설계(Codex 1R #1) |
| 게이트웨이 차액 반올림 | 기존 청구액 − 친구 청구액 | 설계(Codex 1R #3) |
| 화면 「예상 비용」 | 전 채널 현재 단가 어림 칸 · 친구 몫도 같은 근거 | 불수용(Codex 1R #4 · 근거 = ResultsModal.tsx:573 「예상 비용」 · 실제 청구액 = 차감이력 · 정산서) |
| 옛 행 · QTmsg 라인 · 친구 칸 없는 표 | 종전 식 | 설계 |
| 소급 | 없음(H3) | 결정 |

## §6 구현 기록(1106)

- 파일(한줄로) = sms-result-map.ts(스팸 목록 두 원천 · SMSQ_FRIEND_COLUMN · BRAND_FRIEND_DELIVERED_SQL · 분리 집계 friendSuccess) · sms-queue.ts(getFriendColumnTables · 집계 글자 표마다 · smsKakaoResultAgg friendKakao) · send-usage-aggregation.ts(billingMsgTypeSql · 세 함수) · stats-aggregation.ts(is_friend) · refund-calc.ts(mix.friend · FRIEND 단가 · brandUnitDiff) · deduct-reference.ts(친구 조각) · prepaid.ts · mysql-refund-sweeper.ts(diffKey · 기준 문장 $9 · $10) · expired-pending-sweeper.ts · manage-stats.ts · admin.ts(내보내기 칸) · ResultsModal.tsx · kakao-split.ts.
- 파일(게이트웨이 · 에이전트) = migrations/101(070 원본 복사 + 스냅숏 + 재진입 보존 · 정산 함수) · engine/brand_friend.go(AgentFriendYNSQL · 정산 호출) · billing_finalizer.go · report.go(적재 친구 값 · OutboundReport 네 자리) · report_batcher.go · outbound.go · customer_failure_code.go · dispatch_batcher.go(후불 묶음 스냅숏) · session/agent_stream.go · grpc_server.go(재전달) · queue/registry.go(CheckBrandFriendSchema) · cmd/gateway/main.go · proto + 생성본(buf · 같은 판) · agent fieldmap · poller · ③ grpc_client_test.go.
- 검증 = backend · frontend tsc 0 · vitest 764 파일(고친 고정 시험 9 · 원장 카드 · 실 PG 도장 갱신 뒤 전부) · 실 PG 59 / 420 · 게이트웨이 go build · vet 0 · go test 56 패키지(실패 5 = 윈도우 파일 권한 시험 · 기존) · 게이트웨이 실 PG(시험 그릇 001 ~ 101) engine · queue · session 통과 · 변이 15 빨간불(게이트웨이 · 에이전트 6 · 한줄로 9) · ③ 160 회 0 실패.
- 계약 = 게이트웨이 brand_friend_contract_test.go(GC0 · GC1 · GC2 · GC4) · brand_friend_migration_contract_test.go(101 함수 = 070 + 정한 10 구절) · 실 PG TestBrandFriendSettlementPostgres(1 ~ 7) · 에이전트 AC2 · 한줄로 c107f-contract-1106(F1 · F4 · HC1 ~ HC4).
- Codex 게이트웨이 구현 1R(needs-attention · high 1 · 수용) = 선불 재진입(prepaid_existing)이 지금 요금표로 친구 스냅숏을 덮음 → 이미 차감한 재진입은 과금 행의 차감 순간 값(단가 · 부가세 · 청구액 · 스냅숏)을 지킨다 · 같은 자리에서 070 부터 단가 · 청구액도 덮였다(실패 환불 = charge_amount 라 실제 차감과 어긋남) = 같은 뿌리라 함께 닫음.
- Codex 게이트웨이 구현 2R = approve. [범위 밖] 「REFUNDED 과금 행이 SENDING 재진입 때 CHARGED 로 덮인다(070)」 = 도달 경로 없음 확인(1106): SENDING 은 QUEUED 에서만 잡히고(queue/dispatcher.go:757) · QUEUED 로 되돌리는 6 곳(engine/sender.go) · RequeueStale(queue/updater.go)은 전부 norm_status = 'SENDING' 조건(종결 전 재시도) · 환불은 실패 종결(SEND_FAILED) 뒤에만(sender.go:1321) · web/api 에 QUEUED 로 되돌리는 문장 없음 → 고칠 대상 아님(근거 기록).
- 배포 원장 카드 = C108(원장 형식 C + 숫자 · 작업 이름 C107F).
- Codex 한줄로 구현 1R(needs-attention · medium 1 · 수용) = 시험 발송 요약에서 대기 104 를 바로 세자 비용 식(전 채널 대기 합을 시험 SMS 건수에서 뺌)이 MMS 시험만 있는 기간에 음수. 뿌리 = 비용 식이 정산서와 다른 축(건수 = 전 행 − 대기 · 유형 = SMS · LMS 둘뿐 · 시험 MMS · 브랜드 = 0 · 대체 문자 = LMS) → 새 CT utils/test-summary-cost.ts(청구 수량(성공) × 정산서와 같은 유형 testBillingTypeKey × 표시 단가 · 스팸 검사 = 청구 판정 행 × 일반 단가) · 시험 test-summary-cost-1106. 직원 시트 54 에 비용 줄 확인은 넣지 않는다(건수만 · 단가는 회사마다 다르다).
