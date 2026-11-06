# 비토엔진 오류접수 셋 묶음 설계서 (2026-11-06)

> 흐름 표 · 결함 장부 = [2026-11-06-bito-console-tickets-flow-ledger.md](2026-11-06-bito-console-tickets-flow-ledger.md)(이 설계의 범위 = 그 표 전체).
> 결정(Harold 1106) = 세 접수 한 설계 · 한 배포 · 휴머스온 원본 = IMC 개발자 포털 저장본 · A8 = 대역 유지(518 → 한줄로 49013 · 39013 「번호도용 차단」).
> 상태 = **Codex 설계 6R approve · 구현 6R approve(1106)** · 미커밋 · 실 PG(--pg · 새 시험 TestResultCodeReportKeyPostgres 첫 실행) 미실행 · 배포 = 원장 C111. 구현 기록 = §6 끝.

## §0 원칙

1. 원시 코드 → 표준 코드를 푸는 자리는 하나(SQL 함수)다. 지금 일곱 자리가 같은 조각을 각자 들고 있다(흐름 표 A1-c).
2. 게이트웨이 · 커넥터가 스스로 만드는 실패 코드는 전부 표준 코드가 있다 — 소스에서 기계로 뽑아 시험한다.
3. 한줄로 대역 라벨은 원천(게이트웨이 표준 코드)이 바뀌면 드러난다 — 모르는 대역이 오면 경보 · 화면은 채널 이름으로라도 보인다.
4. 목록 화면은 늘어나는 목록 = 서버가 나눈다 · 고정 한도로 말없이 자르지 않는다.
5. 기존 동작 불변: 원 코드(raw 정책 고객사)는 바뀌지 않는다 · 표준 · 고객 코드만 바르게 풀린다.

## §1 처방

### A-1 접수 응답 · 리포트 코드표 가르기(D-A1c) — 마이그레이션 103 + API 일곱 자리

- 새 SQL 함수 `result_code_report_key(p_report_type text, p_report_code text, p_ack_code text, p_raw_code text) RETURNS text IMMUTABLE`(설계 6R 때는 p_norm_status 를 둔 5 인자 · 구현 1R 에 뺌 = 아래 ★★)
  = ① **상태가 접수 실패(FAILED · SEND_FAILED) · 리포트 코드 빔 · 원시 코드 = 접수 코드**면 `'ack'` ② 아니면 `NULLIF(BTRIM(p_report_type), '')` 가 있으면 그 값 ③ 그 밖 `'any'`.
  ★구현 때 순서를 바꿨다(①②): 엔진이 접수 실패를 에이전트에 돌려줄 때 만드는 결과(`report.go HandleSendFailure`)는 리포트 유형을 메시지 유형에서 채운다(`reportTypeForMsgType` = SM · MM · 그 밖 LM · 카카오도 LM). 리포트 유형을 먼저 보면 엔진 경로만 'ack' 을 못 보고(화면 · 웹훅은 원장 칸이 비어 'ack') 두 경로가 갈린다. 마이그레이션 매핑 행의 리포트 유형은 'any' 672 · 'ack' 14 뿐이라(1106 소스 실측) 접수 실패에서 리포트 유형 전용 행이 빠지는 일은 없다 — 운영 표는 배포 전 확인(§5).
  ★★Codex 구현 1R #1(high) — **상태 조건을 뺐다**(인자 4 = 리포트 유형 · 리포트 코드 · 접수 코드 · 원시 코드). 에이전트 발송건의 접수 실패는 엔진이 결과를 적재하기 **전에** 원장을 REPORTED · `report_code_raw` = 접수 코드 · `report_type_raw` = LM 으로 바꾼다(`enqueueSyntheticSendFailure`) · API 카카오 대체는 REPORTED · 리포트 코드 없음(`HandleAPISendFailureFallback`). 그 뒤로 상태로는 공급사 리포트와 가를 수 없다. 남는 출처 표식 = **접수 코드 칸**: 접수가 성공하면 그 칸이 성공 코드('0')로 덮인다(`updater.go MarkDelivered` · `dispatch_batcher.go`). → 'ack' = 접수 코드가 있고 · 원시 = 접수 코드 · 리포트 코드가 없거나 접수 코드와 같다. 'ack' 행은 접수 성공 코드에 두지 않는다(계약 시험 · `resultcode.IsAckSuccess`).
  상태를 넣는 이유(Codex 설계 1R 다음 단계) = 리포트를 처리하는 순간 원 요청 행은 접수 성공 상태(DELIVERED)라 리포트 코드가 아직 안 써졌어도 'ack' 로 볼 수 없다 · 접수가 거절된 건에는 리포트가 오지 않는다. 휴머스온 REPORT_TYPE 이 비어도(커넥터가 허용) 이 판정은 같다.
- 표시 식(`services/result-code.js standardCodeSql`)도 범위다(1R #1): 지금 「접수 실패 · 리포트 코드 없음」은 매핑을 보기 전에 V9000 이다. → 그 갈래에서 접수 코드가 있고 접수 성공 코드(ACK_SUCCESS_CODES)가 아니면 'ack' 열쇠로 매핑을 찾고, 없으면 V9000. **접수 성공을 전달 성공으로 올리지 않는 기존 보호는 그대로**(성공 판정 식 불변 · 계약 시험).
- 조회 일곱 자리의 `COALESCE(NULLIF(<표>.report_type_raw, ''), 'any')` 를 이 함수로 바꾼다(일치 조건 · 순서 둘 다):
  `admin-messages.js` 두 곳 · `public-messages.js` · `stats.js` · `workers/webhook-worker.js` · `result-codes.js:485`(입력 미리보기 = 입력 그대로 · 바꿀 것 없음 확인) · 마이그레이션 100 `customer_failure_code` · 102 `customer_success_code`(103 에서 같은 이름 · 같은 인자로 다시 만든다 = 엔진 Go 코드 · 기동 점검 불변).
- 엔진 쪽 두 함수 안에서는 `mr.report_code_raw` · `mr.ack_code_raw`(원 요청 행)와 인자 `p_raw_code` · `p_report_type` 으로 같은 함수를 부른다.
- 휴머스온 접수 응답 행(report_type `'ack'` · 원천 = 커넥터 `payload.go humusonReturnMessage` 숫자 갈래 전부 · 계약 시험이 같은 추출): 2000 · 2001 · 2002(인증) → `V2850_GATEWAY_CONFIG` · 3000(서비스 불허) → `V2850_GATEWAY_CONFIG` · 4000(형식) → `V2000_VALIDATION_ERROR` · 8000 · 8001(한도) → `V2600_QUOTA_LIMIT` · 9000 · 9001(서버) → `V2800_PROVIDER_ERROR` · 9999(FILTER · 1R #5) → `V2500_POLICY_BLOCK`.
  'ack' 행이 'any' 리포트 행보다 앞선다(기존 순서식 = 정확히 같은 report_type 먼저).
- 젬텍 · bito 는 'ack' 행이 없어 지금과 같다('any' 행이 그대로 잡힘).

### A-2 휴머스온 리포트 코드 16(D-A1b) — 103

- 표준 코드 16 신설 `KAKAO_<코드>_<이름>`(제목 = 포털 설명 · 설명 없는 것은 이름 번역) · `humuson_imc` `kakao` `any` 행 16.
  1033 · 3000 · 8000 · 8001 · 8003 · 8004 · 8007 · 8008 · 8100 · 8101 · 8102 · 8103 · 8200 · 8201 · 9000 · 9999.
- 한줄로 대역 = 20000 + 번호(21033 · 23000 · 28000 · 28001 · 28003 · 28004 · 28007 · 28008 · 28100 · 28101 · 28102 · 28103 · 28200 · 28201 · 29000 · 29999 · 기존 대역과 겹침 0 = 흐름 표 실측 목록 대조).

### A-3 게이트웨이 · 커넥터 자체 실패 코드(D-A2) — 103

- 표준 코드는 **그 건을 다시 보내도 되는가**로 고른다(1R #2 · 공개 API 가 retryable 을 그대로 준다 `public-messages.js:466`).
  **규칙 하나(3R #2 · 커넥터가 이미 정한 값을 그대로 따른다):** 표준의 retryable = 그 코드를 만드는 자리의 `Retryable` 값. 단 쓴 뒤 결과를 모르는 자리(`SendWriteUnknown` · 엔진이 쓴 뒤 격리 · 응답은 왔는데 코드가 빔)는 Retryable 과 무관하게 false(중복 발송). 명시 거절(`SendRejected`)은 공급사가 받지 않았다는 뜻이라 중복 위험이 없어 커넥터 값을 따른다(8000 · 8001 · 9000 · 9001 = true · 4000 · 2000 ~ 3000 · 9999 = false = `payload.go:1339`).
  계약 시험 2-a 가 커넥터 소스에서 기계로 뽑는다 = 상수 `SendResult{ResultCode, Retryable, WriteState}` + 동적 거절 경로(`humusonReturnMessage` 의 숫자 갈래 × `isRetryableReturnCode` 의 갈래) → 매핑된 표준의 retryable 과 대조.
  | 무엇 | 코드 | 표준 | 다시 보내도 됨 |
  |---|---|---|---|
  | 쓰지 않았음이 증명된 일시 장애(SendNotWritten · Retryable true) | HUMUSON_DISCONNECTED | `V2800_PROVIDER_ERROR` | 예(기존) |
  | 쓰지 않았지만 커넥터가 재시도 아님으로 돌려줌(SendNotWritten · Retryable false = 연결 준비 안 됨) | HUMUSON_NOT_READY(3R #2) | `V2850_GATEWAY_CONFIG` | 아니오 |
  | 쓴 뒤 결과를 모름(SendWriteUnknown · 쓴 뒤 바인드 잃음 · 응답은 왔는데 RETURN_CODE 가 빔) | HUMUSON_IO · LOST_BIND · NO_RETURN_CODE(2R #1 · `connector.go:321-323` 요청 뒤 응답 · `payload.go:1339` 재시도 아님) | 새 `V9150_UNCERTAIN_AFTER_WRITE`(「발송 기록 뒤 결과 모름 · 공급사 결과 확인 필요」) | **아니오**(중복 발송 방지 · `sender.go:486-494`) |
  | 요청 자체가 틀림 | BAD_TYPE · BAD_REQUEST | `V2000_VALIDATION_ERROR` | 아니오(기존) |
  | 잔액 · 한도 | NO_BALANCE · DAILY_LIMIT_EXCEEDED | `V2600_QUOTA_LIMIT`(기존 설명 = 「잔액 또는 계약 한도」 · 젬텍 5005 잔액 부족과 같은 자리) | 예(충전 · 한도 뒤) |
  | 게이트웨이 · 공급사 설정 오류(사람이 고쳐야 함) | NO_PRICE · BAD_BILL · BAD_PROV · 휴머스온 접수 2000 ~ 3000 | 새 `V2850_GATEWAY_CONFIG`(「게이트웨이 설정 오류 · 담당자 확인」) | 아니오 |
- **저장되는 실제 값**으로 매핑한다(1R #4): `ack_code_raw` 는 10자이고 재시도를 다 쓰면 `코드 + "_MR"` 을 10자로 자른다(`sender.go:1036-1041 · 1118-1123 · 1209`). → 계약 시험이 소스의 실패 상수 · 재시도 대상 코드(커넥터 Retryable · `isRetryableReturnCode` · 젬텍 재시도 후보)마다 `left(code, 10)` · `left(code || '_MR', 10)` 둘을 계산해 매핑 행이 있는지 본다 · 마이그레이션 행도 그 두 꼴로 넣는다(예: HUMUSON_DISCONNECTED → 'HUMUSON_DI' · 9000 → '9000_MR'). 자른 꼴이 둘 이상의 원 코드와 겹치면 시험이 멈춘다(겹치면 설계로 되돌아온다).
- 목록은 구현 때 소스 추출로 확정한다(커넥터 `ResultCode: "…"` 상수 · 엔진 `markSendFailedAndFinalize("…")` · 상수 변수) — 계약 시험이 같은 추출을 한다(§3).

### A-4 한줄로 대역 라벨(D-A5 · D-A6)

- 103 적용 · 대역 DML(네 대 · `customer-failure-codes-hanjul.sql` 다시 = 있는 행 그대로 · 새 표준 코드 행만 추가) 뒤 라벨 파일을 다시 만든다(`node scripts/gen-result-code-hanjul-band.mjs`) → 1106 빠진 18 + 이번 신설 18 · 스팸 목록(R64)은 라벨에서 자동.
- 드러내기(D-A6 뿌리): 한줄로 `sms-result-map` 의 대역 판정(20000 ~ 59999)에서 라벨 없는 대역 코드를 만나면 ① 화면 라벨 = 채널 이름 + 「결과 n」(예: 「카카오 결과 27102」) ② 운영 경보 1회(코드별 하루 한 번 · 기존 시스템 경보 CT)로 「라벨 파일 다시 만들기」를 알린다. 생성 스크립트 · 대역 DML 머리말에 「표준 코드를 바꾸면 라벨 다시 만들기」 한 줄.

### A-5 매핑 내려받기(D-A7)

- `GET /admin/result-codes/export?kind=standard|provider|customer`(필터 = 화면과 같은 조건) → CSV(UTF-8 BOM · 엑셀) · 세 탭에 「엑셀로 받기」 단추.

### B 메시지 이력 발송계정 조건(D-B1 · D-B2)

- API `buildWhere`: `customer_id` · `sender_account_id` 조건. 발송계정 = 표시와 같은 식(`mr.sender_account_id`, 비면 `agent_account.sender_account_id`)
  → `(mr.sender_account_id = $n OR (mr.sender_account_id IS NULL AND mr.agent_id IN (SELECT agent_id FROM agent_account WHERE sender_account_id = $n)))`.
- 고객사 = 표시 식 세 단계 그대로(1R #6 · `admin-messages.js:232 · 304-305`): `COALESCE(mr.customer_id, sa.customer_id, aa.reseller_id) = $m` (sa = `COALESCE(mr.sender_account_id, aa.sender_account_id)` 의 발송계정) · COUNT 와 쪽 고르기 둘 다 같은 식(한 조각 함수 · 계약 시험 = mr · 발송계정 · Agent 의 고객사가 서로 다른 행 셋).
- 화면: 「고객사」 → 「발송계정」(고객사를 고르면 그 계정만) 두 칸 · 접수 거부 탭도 같은 조건(거부 원장 agent_id → 계정 · 칸 유무는 구현 전 information_schema).
- 속도: 운영 EXPLAIN(ANALYZE 없이 · 기간 하루 · 계정 하나) 결과로 인덱스 필요 판단(설계 닫기 전 실측).

### C 목록 나누기(D-C · D-C2)

- 서버 나눔(늘어나는 목록): `stats/lines` · `stats/binds` · `stats/connections`(고정 50 제거 · 1R #7) · `commercialization/customers` · `sender-identities` · `result-codes` 셋 · `policies/blocks/history`(page) · `spec-accounts`(1000 자름 제거) · page · limit 해석 = 공용 함수 하나(`services/pagination.js` · 상한 200).
- 응답 꼴 호환(1R 다음 단계): **page 인자가 올 때만 나누고** 응답에 `pagination: { page, limit, total }` 칸을 더한다 · 지금 꼴(배열 칸 이름)은 그대로 = page 를 보내지 않는 소비처는 지금과 같다. 소비처 목록 = 구현 전 `web/dashboard/src` · `web/api` 전수 grep(이 설계서 §6 에 붙임).
- 고르는 목록(Agent · 고객사 선택 칸)의 고정 `limit=200` 제거: 선택 칸 전용 가벼운 목록(`/admin/agents/options` · `/admin/resellers/options` = id · 이름만 · 전부) · 표는 서버 나눔.
- 화면: 접수 12 메뉴 표마다 `OpsPagination` · 작은 고정 목록(발송제어 Agent 상태 · 사업자별 잔액 · 관제 라우터별)은 화면 나눔 공용 훅 하나(`useClientPagination`) · 한 쪽 20줄.
- 다른 화면(라우팅 · 원격배포 등 쪽 나누기 0 인 8)은 이번 범위 밖 = 기록만.

## §2 뿌리

- 원시 → 표준 풀이 조각이 일곱 자리에 복사돼 접수 · 리포트를 가르지 못했다(A-1).
- 자체 실패 코드에 「매핑 있음」을 시험하지 않았다(A-3).
- 생성 라벨 파일이 원천 변경을 모른다(A-4).
- 목록 API 를 고정 한도로 부르고 넘는 줄을 알리지 않는다(C).
(뿌리 번호 = 구현 때 `docs/ROOT-LEDGER.md` 다음 번호.)

## §3 계약 시험(소스에서 기계로 뽑기)

1. 게이트웨이 소스에서 `provider_result_code_map` 을 읽는 SQL 전부 = `result_code_report_key(` 를 쓰고 옛 조각(`COALESCE(NULLIF(… report_type_raw, ''), 'any')`)은 0.
2-a. 커넥터 소스의 `SendResult` 상수 코드 · 동적 거절 경로(`humusonReturnMessage` 숫자 갈래 × `isRetryableReturnCode`)마다 (WriteState · Retryable) 를 뽑아 매핑된 표준의 retryable 과 대조: 표준 retryable = 그 자리 Retryable · 단 SendWriteUnknown · 쓴 뒤 격리 · 빈 응답 코드는 false(NO_RETURN_CODE · HUMUSON_IO · LOST_BIND → V9150 · HUMUSON_NOT_READY → V2850 · 8000 · 8001 · 9000 · 9001 = true).
2-b. 실 PG: 103b 문 = 번역하는 mapped 에이전트에 접수 4000 → V2000 의 **에이전트 전체 행**(범위 없음 · all)이 없으면 RAISE · V2000 행이 발송계정 S1 전용 · 고객사 C1 전용 · 유형 sms 전용뿐이어도 RAISE(범위 행은 인정하지 않음) · 숫자가 아닌 고객 코드 행은 인정하지 않음 · 숫자 전체 행(52000)과 숫자 아닌 발송계정 S1 전용 행('ERR')이 함께 있으면 RAISE(5R) · 실패 고객 행 0 인 mapped 에이전트는 통과 · 에이전트 전체 행이 있으면 함수 100 이 어떤 (고객사 · 발송계정 · 유형) 요청에서도 그 코드 또는 더 좁은 범위 행의 코드를 돌려준다(9999 아님).
2. 엔진 · 커넥터의 상수 실패 코드 · 재시도 대상 코드 전부 = 저장 꼴 두 개(`left(code,10)` · `left(code||'_MR',10)`)마다 마이그레이션의 활성 매핑 행이 있다(bito 또는 그 공급사) · 자른 꼴 겹침 0 · 휴머스온 `humusonReturnMessage` 숫자 갈래 = 'ack' 행 전부.
3. 실 PG: 휴머스온 4000 이 접수 실패(SEND_FAILED · 리포트 없음)면 `V2000_VALIDATION_ERROR` · 리포트면 `KAKAO_4000_…` · 접수 성공(DELIVERED) 뒤 리포트 코드가 접수 코드와 같아도 'ack' 아님 · 젬텍 518 은 그대로 `SMS_9013` · `customer_failure_code` 가 접수 4000 을 한줄로 대역 52000 으로 · 표시 식이 접수 성공 코드를 전달 성공으로 올리지 않음 · LOST_BIND 표준의 retryable = false.
4. 한줄로: 대역 라벨 없는 코드 = 채널 이름 라벨 · 경보 CT 한 번 호출(같은 코드 하루 한 번).
5. 콘솔 목록 API = 응답에 pagination · 고정 `limit=200` 호출 0(대시보드 소스 추출).

## §4 직원 지시문(시트 65 ~ 67 · 구현 전 초안 → 구현 뒤 화면 글자로 확정)

- 엑셀 = [2026-11-06-bito-console-tickets-staff-sheet.xlsx](2026-11-06-bito-console-tickets-staff-sheet.xlsx) · 만든 스크립트 꼴 = C109 시트와 같음(안내 + 시트마다 순 · 하세요 · 보이면 맞음 · 맞음/다름 · 캡처).
- 65 결과코드 매핑(휴머스온 4000 두 줄 = ack V2000 · any KAKAO_4000 · bito 자체 코드 · 젬텍 518 그대로 · 엑셀로 받기 세 탭 · 쪽 번호) · 66 메시지 이력 발송계정(고객사 → 그 계정만 · 결과 = 그 계정 · 접수 거부 탭) · 67 목록 쪽 나누기(접수 12 메뉴 + 결과코드 · 발송정책 차단 이력의 오래된 기록).
- 문자 발송 0 · 저장 · 삭제 · 켜기 단추 누르지 않음(안내 시트).

## §5 배포 순서(한 묶음 · 1R #3 = 고객 대역이 먼저 · 매핑 · 함수는 나중)

`customer_failure_code` 는 고객 행이 없으면 9999 를 돌려주고 그 값이 `report_queue.customer_code` 에 굳어 재전달에도 쓰인다(100 · `customer_failure_code.go:7-8`). 그래서:

1. 103a = 새 표준 코드만(V2850 · V9150 · 휴머스온 리포트 16) · 매핑 행 0 · 함수 그대로 = 동작 변화 0.
2. 정책 mapped 인 에이전트 전부(hanjul 네 대 · 콜비서 등 = 적용 직전 `agent_account.failure_code_policy` 조회로 목록 확정)에 새 표준 코드의 고객 행: 한줄로 = 대역 DML 다시(있는 행 그대로) · 그 밖 = 그 에이전트 규칙(설계 닫기 전 확인).
3. 한줄로 라벨 다시 만들기 · 경보 CT · 한줄로 배포(적재 0 조건 재시작) — 라벨이 먼저 있어야 새 대역 코드가 화면에 바로 글로 보인다.
4. 103b = 공급사 · bito 매핑 행 · `result_code_report_key` · 함수 100 · 102 다시 만들기(함수 100 의 고객 행 고르기 조각은 **그대로** · 웹훅 조각도 그대로). **첫 줄 = 문(4R 단순화)**: 앞으로 올 요청의 범위를 맞히지 않는다. 대신 **범위와 무관하게 늘 잡히는 행**을 요구한다 = 103b 가 넣거나 바꾸는 연결의 실패 표준 전부(새 V2850 · V9150 · KAKAO 16 + 기존 V2000 · V2500 · V2600 · V2800 · …) × 정책 mapped 이고 실패 고객 행을 하나라도 가진 에이전트마다 **에이전트 전체 행**(agent_id = 그 에이전트 · customer_id NULL · sender_account_id NULL · msg_type 'all' · 활성 · 고객 코드 숫자 1 ~ 5자리)이 없으면 RAISE(빠진 (에이전트 · 표준) 목록 출력 · 적용 0). **그리고** 같은 (에이전트 · 표준)의 활성 고객 행 중 범위와 무관하게 고객 코드가 숫자 1 ~ 5자리가 아닌 행(NULL 포함)이 하나라도 있으면 RAISE(5R · 함수 100 은 더 좁은 범위 행을 먼저 고르고 LIMIT 1 뒤에 숫자를 보므로 그런 행이 숫자 전체 행을 가려 9999 가 된다 · 한줄로 대역 스크립트의 「대역이 아닌 실패 매핑이면 멈춤」과 같은 방어).
   이 행은 함수 100 의 범위 조건(고객사 NULL · 발송계정 NULL · 유형 all)을 어떤 요청에서도 통과하므로 「어느 범위로 올지」를 예측할 필요가 없다. 한줄로 대역 행이 바로 이 꼴(에이전트 · all · 범위 없음 · `customer-failure-codes-hanjul.sql`)이다. 범위 행만 쓰는 에이전트가 생기면 문이 멈춰 사람이 에이전트 전체 행을 넣게 한다(지나치게 엄격한 쪽 = 9999 가 굳는 것보다 안전).
   실패 고객 행 0 인 mapped 에이전트(성공만 번역 · 예 콜비서)는 지금도 실패 = 9999 라 대상 아님(3R 에서 함수 100 과 일치 확인).
   상설 감사 항목 = 같은 식(번역하는 에이전트 × 활성 매핑으로 닿는 실패 표준 × 에이전트 전체 행). 실패 고객 행이 하나도 없는 mapped 에이전트(성공만 번역 · 예 콜비서)는 지금도 실패가 전부 9999 라 이번 연결로 바뀌는 것이 없다 = 문 대상 아님(계약 시험 = 그 판단 그대로).
   같은 검사를 정합성 감사기 항목으로 상설(「번역하는 에이전트가 활성 매핑으로 닿는 실패 표준의 고객 행을 가졌는가」) — 다음에 누가 매핑을 바꿔도 드러난다.
5. 관리 API 파일 · 대시보드(런북 §3-1 · §3-2) — 103b 뒤(표시 식이 새 함수를 부른다).
6. 직원 시트.

## §6 리뷰 기록

- Codex 설계 1R(1106) = needs-attention 7 · 전부 수용 · 같은 뿌리 = 「실제로 저장되는 값 · 단계(접수 실패 · 쓴 뒤 불확실 · 재시도 소진 · 고객 행 준비)를 설계가 안 봤다」:
  #1 표시 식이 접수 실패를 매핑 전에 V9000 → A-1 에 표시 식 넣음 · #2 LOST_BIND · 쓰기 불확실을 재시도 가능으로 안내 → 다시 보내도 되는가 축 표(V9150 · V2850 신설) · #3 고객 대역 전에 매핑 켜면 9999 가 굳음 → §5 순서 + 103b 문 · #4 재시도 소진 `_MR` · 10자 자름 → 저장 꼴로 매핑 · 계약 · #5 휴머스온 접수 9999 FILTER → 접수 행 · #6 고객사 조건 세 단계 → 표시 식 그대로 · #7 접속 50 고정 → 서버 나눔.
  다음 단계 지적 = 리포트 중 'ack' 오판 → 상태 조건(DELIVERED 는 ack 아님) · 응답 꼴 호환 → page 인자 올 때만 나눔.
- Codex 설계 2R = needs-attention 2 · 둘 다 1R 과 같은 부류 둘째(#1 = 1R #2 · #2 = 1R #3) → 개별 수정 대신 「왜 되풀이되나」: ① 재시도 분류를 **손으로** 정해 NO_RETURN_CODE(응답은 왔는데 코드만 빔 · 재시도 아님)를 「안 씀」 칸에 잘못 넣었다 → 분류를 만드는 자리의 사실(WriteState · Retryable)에서 기계로 내고 시험이 대조 ② 고객 행 문을 **「새 표준」으로만** 그어 기존 표준으로 새로 이어지는 연결(접수 4000 → V2000)을 놓쳤다 → 문 대상 = 이번에 넣거나 바꾸는 연결의 실패 표준 전부 · 상설 감사 항목.
- Codex 설계 3R = needs-attention 2 · 같은 두 부류 셋째 → 되풀이의 진짜 뿌리 = **엔진의 실제 판정(고객 행 고르기 · 재시도 여부)을 설계 안에서 손으로 다시 흉내 냈다**(흉내는 범위 · 우선순위 · 커넥터 값 하나씩을 빠뜨린다). 처방 = 흉내 0: 고객 행 고르기는 함수 100 에서 떼어 낸 `customer_code_for_standard` 하나를 엔진 · 웹훅 · 문 · 감사가 같이 부른다 · 재시도 여부는 커넥터의 Retryable 값을 그대로 따르고(쓴 뒤 모름만 false) 시험이 소스에서 뽑아 대조.
- Codex 설계 4R = needs-attention 3(전부 3R 의 「범위 묶음 예측」에서 나옴: 30일 이력에 없는 발송계정 · 기본 묶음의 고객사 식 · 공유 선택기가 웹훅 고르기를 바꿈) + 범위 밖 1(계약 2-a 문구가 A-3 규칙과 충돌). 처방 = **더 단순한 길**: 범위를 예측하지 않고 범위와 무관하게 늘 잡히는 「에이전트 전체 행」을 요구 · 선택기 떼어 내기 철회(함수 100 · 웹훅 조각 그대로 = 3R #1 의 웹훅 회귀 위험도 사라짐) · 계약 2-a 문구를 규칙 한 줄과 같게.
- Codex 설계 5R = needs-attention 1(숫자 아닌 범위 행이 숫자 전체 행을 가림 · 함수 100 은 고른 뒤 숫자 검사) → 문에 「대상 (에이전트 · 표준)의 활성 행 중 숫자 아닌 행 하나라도 있으면 멈춤」 · 계약 2-b 사례.
- Codex 설계 6R = **approve**(지적 0 · 대상 표준으로 풀리는 요청은 전체 행이 후보를 보장하고 활성 후보 전부 숫자 = 9999 폴백 차단).

### 구현 기록(1106)

- Codex 구현 1R = needs-attention 6(high 1 · medium 5) · 전부 수용.
  - #1(high) 합성 접수 실패가 적재 전 REPORTED 로 바뀌어 'ack' 을 못 탐 → 열쇠 = 접수 코드 칸(§1 A-1 ★★) · 실 PG 시험 = `enqueueSyntheticSendFailure` 를 직접 불러 원장 REPORTED/4000/LM 뒤 고객 코드 52000 · 화면 열쇠 'ack'.
  - #3 · #4 · #5 = 한 뿌리(**설계 A-4 = 대역 판정 자리에서 드러내기 · 구현이 발송 표 시간 창 훑기로 바꿨다** → 늦은 결과 누락 · 공통 쿨다운 · 큰 표 훑기) → 설계대로: `sms-result-map bandStatusInfo` 가 라벨 없는 대역을 모으고 감시 패스 첫 줄이 꺼내 코드별 하루 한 번(한 통 = 새 코드 묶음 · 경보 키 = 묶음) · 발송 표 질의 0.
  - #2 정책 차단 이력 쪽 넘김이 편집 중 정책 값을 덮음 → 정책 조회 · 이력 조회 분리 · 나중 요청 응답만.
  - #6 표준 탭 화면(운영 힌트 포함 · 글자 포함)과 엑셀 조건(ILIKE · 운영 힌트 없음)이 다름 → 서버 조건을 화면과 같은 판정(`strpos(lower())` 네 칸).
- Codex 구현 2R = needs-attention 2 · 전부 수용 · 둘 다 1R 수정 자리의 「다음 단계」(같은 부류 둘째 아님):
  - [high] 범위를 바꾸는 사이 늦게 온 앞 범위 정책 응답이 form 을 덮어 지금 범위에 저장될 수 있음(옛 코드에도 있던 경합 · 1R 에 손댄 함수라 함께) → 정책 응답 순번 · 받은 범위 키가 지금 범위와 같을 때만 저장.
  - [medium] 대역 경보가 보냄 확인 전에 코드를 소모 · 쿨다운 확정 → 대기 묶음에 남기고 sendSystemAlert > 0 일 때만 코드별 쿨다운.
- Codex 구현 3R = needs-attention 1 = 2R [high] 와 같은 부류 둘째(앞 범위를 붙잡은 저장 뒤 재조회가 순번을 올려 지금 범위 조회를 무효로 하고 앞 범위 값을 그림) → 개별 수정 대신 「왜 되풀이되나」: 지금 범위를 비동기 경로마다 클로저가 따로 붙잡았고 순번은 「나중 요청」만 가렸다 → 구조 = 지금 범위 키 ref 하나(currentScope) · 붙잡은 범위가 지금 범위가 아니면 시작 · 그림 0 · 순번 = 같은 범위 안 순서만 · 이력도 범위 + 쪽 키로 같은 규칙.
- Codex 구현 4R = needs-attention 2(high 상위 정책 적용이 지금 범위 정책을 받기 전에도 움직임 · medium 이력 조회 실패 뒤 앞 범위 행이 남음) = 같은 부류 셋째 → 뿌리 = **받은 값이 어느 범위의 것인지를 함께 담지 않아 확인을 쓰는 자리마다 따로 붙였다** → 구조 = 받은 값은 받은 키와 한 덩어리(정책 = loadedScope · 이력 = historyData { scope, page, rows, total, error }) · 화면 · 저장 · 적용 · 쪽 번호는 키에서 나온 값만(policyCurrent · historyCurrent · 같은 범위 합계).
- Codex 구현 5R = needs-attention 1(medium · 4R 구조의 정책 덩어리에 「실패」가 빠져 저장 뒤 재조회 실패가 성공 알림에 가려지고 무기한 「불러오는 중」) → 정책 덩어리 = { scope, error }(이력과 같은 꼴) · 조회 반환 true · false · null(범위 떠남) · 저장 · 적용 뒤 재조회 실패 = 경고 · 차단 이력 패널은 정책 표시 조건에서 뗌.
- Codex 구현 6R = **approve**(지적 0).
- **배포 전 S0 실측(1106 Harold)** = 콜비서 세 대가 번역 에이전트(실패 행 80 · 전부 에이전트 전체 · QTmsg 번호 · V9000 · V2000 ~ V2800 행 없음 · 같은 날 콜비서 세션이 mapped 로 켬). 설계 §5 의 「콜비서 = 성공만」 전제가 구현 뒤 바뀜 → 문 ① · 감사 CODE 가 한줄로 대역 규칙(대상 표준 전부 행)을 모든 번역 에이전트에 요구해 104 가 콜비서에서 멈추고 감사가 콜비서를 울림. 뿌리 = 한 에이전트 규칙(한줄로 대역)을 모든 번역 에이전트 규칙으로 일반화 · 설계가 적은 「적용 직전 조회로 확정」을 구현 끝까지 미룸.
  처방 = 지킬 것 하나(「매핑을 바꿔도 이미 번역되던 결과가 9999 로 떨어지지 않는다」) · 문 ① = 옛 표준(미분류 V9000 + 같은 원시 코드의 활성 리포트 행 표준 전부 · 넉넉히 · 옛 함수 후보 순서 흉내 0)을 번역하던 에이전트만 대상 표준의 에이전트 전체 숫자 행 요구 · 감사 CODE = 미분류 V9000 을 숫자로 번역하는 에이전트만(정상 상태) · 배포 원장 G3-0 = 운영에서 104 를 ROLLBACK 으로 미리 돌려 문 통과를 본다. 104 매핑 · 열쇠 · 함수 본문 그대로.
- Codex 구현 7R(S0 수정분) = **approve**(지적 0) · 남은 확인 = 수정 뒤 실 PG(--pg).

- 범위 = 설계 그대로 + 아래 넷(전부 계약 시험이 소스에서 뽑아 드러낸 것 · 손 목록 0).
  1. 열쇠 함수 순서(§1 A-1 ★).
  2. 엔진 합성 코드 매핑(104 · sender.go 실제 흐름): `SEND_ERROR`(커넥터 오류 · 코드 없음 · 소진 꼴도 같은 10자 · 결과 nil = 격리) → V9150 · `EMPTY_ACK`(코드 없는 ACK = 격리 · 또는 쓰지 않음 · 재시도 아님) → V9150 · `EMPTY_ACK_`(쓰지 않음 · 소진) → V2800 · `PACE_ABORT`(쓰기 전 멈춤) → V2800.
  3. `TIMEOUT_MR` = 설계 초안의 V9150 을 **V2700** 으로 바로잡음 — 소진 꼴은 쓰지 않음이 증명된 안전 재시도(handleSafeRetry)에서만 나오고 쓴 뒤 모름은 격리(quarantineAmbiguousAttempt · 소진 없음)라, 규칙(그 자리 Retryable)대로 다시 보내도 됨.
  4. 젬텍 재시도 후보(packet/deliver.go rateLimitedAckCodes ∪ systemTransientAckCodes = 100 · 101 · 110 · 111 · 212)의 소진 꼴 = **원 코드 행을 유형별로 그대로 옮김**(INSERT … SELECT · 운영 DML 로 생긴 sms · lms_mms 행 포함). 10자 코드(E_SYS_FAIL 등)는 소진 꼴 = 원 코드라 행이 이미 있다.
- 표시 식 접수 실패 갈래 = 매핑을 보되 **성공 표준은 받지 않음**(부분 질의 · 실패 건이 전달 성공으로 보이는 길 0) · 계약 시험 6 이 그 조각 하나만 guard 구간에 허용.
- 화면 나눔 · 서버 나눔 가름: 서버 목록 API 는 전부 page 를 받는다(설계 §1 C · 응답 꼴 호환). 화면은 **거르기 · 정렬 · 위 합계를 화면에서 하는 표**(결과코드 세 탭 · 회선 모니터 · 규격연동 · 식별코드 · 사업자 잔액 · 관제 라우터별 · 고객사 · 허용 발신번호 고객사 · 발송제어 Agent · 통계 회선별)는 전부를 받아 화면에서 20줄씩 나눈다 — 서버 나눔으로 바꾸면 그 거르기 · 합계가 한 쪽만 보게 된다. 서버로 나누는 표 = 발송정책 차단 이력(오래된 기록까지 넘겨 봄 · 고객사 · 발송계정 조건을 서버로) · 메시지 이력 · 전송파이프(이미 있음).
- 전송파이프 「Agent 수신」 = 이미 서버 나눔(`PipelinePage.jsx` page · limit 70 · 위아래 쪽 번호) → 변경 0 · 직원 시트로 확인.
- 고르는 칸 전용 `/options` API 는 만들었다가 뺐다 — 대시보드가 쪽을 끝까지 넘겨 받는 `api.getAllPages`(200씩 · 500쪽 상한) 하나로 충분(새 API 0). 작은 고정 목록은 화면 나눔 공용 훅 `usePagedRows`(설계의 useClientPagination).
- 102(성공 번역)는 다시 만들지 않음 — provider 매핑을 보지 않는다(요청 유형으로 성공 표준을 정함) · 열쇠와 무관.
- 함께 닫음: C108 때 들어간 `brand_friend.go`(주석에 원장 이름)가 `web/api/test/ledger-readers.json` 분류에 빠져 있었다 — 그때 바뀐 파일이 Go 뿐이라 check.sh 가 API 시험을 안 돌려 지나갔다 · 이번 묶음은 API 를 바꿔 그 시험이 돈다.
- 한줄로: 라벨 파일 244 → 280(기존 줄 변화 0 · 생성기 `--tsv` = COPY text 꼴 풀기) · 라벨 없는 대역 경보(1R 뒤 = 판정 자리 기록 · 코드별 하루 한 번 · 질의 0) · 뿌리 장부 회사 null 목록 등재.
- 계약 시험: Go `result_code_mapping_contract_test.go`(저장 꼴 매핑 · 열쇠 읽는 자리 · 104 = 100 + 두 줄) · 실 PG `result_code_report_key_postgres_test.go`(열쇠 · 엔진 경로 접수 실패 52000 · 리포트 24000 · retryable 규칙 · 젬텍 소진 꼴 = 원 코드 · 104 문 여섯 사례) · API `pagination-contract-test.js` · `result-code-contract-test.js` 6 · 한줄로 `bito-band-label-alert-1106.test.ts`. 변이 = 104 행 넷 삭제 · 젬텍 목록 축소 → 다섯 다 빨간불.
- 범위 밖(기록만): OperationsDashboard 원격 배포 함대 `?limit=200` · 결과 미전달 `?limit=500`(접수 12 메뉴 밖).
- 배포 전 운영 확인 추가: `provider_result_code_map` 의 리포트 유형 분포('any' · 'ack' 밖의 행이 있으면 접수 실패에서 그 행이 빠진다) (대역 경보 질의 실측은 1R 뒤 질의 0 이라 뺐다).
