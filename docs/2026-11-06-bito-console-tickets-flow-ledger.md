# 비토엔진 오류접수 셋 — 흐름 표 · 결함 장부 (2026-11-06)

> 접수 = 그룹웨어 「비토엔진오류접수」 서수란 1106 셋(① 결과코드 매핑 cmw4lqirl0 15:36 · ② 발송이력 검색 조건 cmw4ioc8z0 14:11 · ③ 화면 페이징 cmw4jhxqo0 14:34).
> 순서 = `status/DEFECT-PLAYBOOK.md` §1(이 문서 = 0 접수 대조 · 1 흐름 표 · 2 결함 장부). **Harold 확인 전 설계 0.**
> 저장소 = bito-gateway(운영 콘솔 `web/dashboard` · 관리 API `web/api` · 엔진 `internal/gateway`) + 한줄로(결과 코드 라벨).
> 근거 표기 = (가) 내가 실행해 본 출력 · (나) Harold 실행 출력 · 파일:행 = 코드 읽기.

## 0 접수 대조

| 접수 | 접수 시각 | 그 뒤 바뀐 것 | 서버 지금 |
|---|---|---|---|
| ① 518 → 9013 기대 · 실제 V2200 → 52200 → 9999 | 15:36 | 콜비서 세션 젬텍 재매핑 운영 적용 17:56(`scripts/gw/gemtek-remap-1106.sql` · 원본 = .58 ngen/gmt code_sms.txt · code_mms.txt) | (나) 518 = sms → `SMS_9013_NUMBER_SPOOF_BLOCK` · lms_mms → `LMSMMS_9013_NUMBER_SPOOF_BLOCK` 활성 · all → V2200 꺼짐(17:56) → **접수 증상은 닫힘(넘김)** |
| ② 메시지 이력에 고객사 발송계정 조건 | 14:11 | 메시지 이력 파일 마지막 변경 10-13(9dd6a33) | 조건 칸 = 수신 · 회신 · 기간 · 상태 · 결과 · 유형(`MessageHistoryPage.jsx:198-207`) |
| ③ 화면 페이징 | 14:34 | 해당 화면 파일 마지막 변경 11-02(a4f95f4) 이전 | 아래 ③ 표 |

서버 콘솔 · API 판 = 저장소 HEAD 와 같은지 **미검증**(대시보드 manifest · API 파일 해시 대조 = 설계 단계에서 한 줄 조회).

---

## ① 결과코드 매핑 — 흐름 표

결과 한 건이 고객 화면에 닿는 길(이음매마다 판정).

| # | 이음매 | 자리 | 판정 |
|---|---|---|---|
| A1 | 공급사 원시 코드 → 표준 코드 | `provider_result_code_map`(provider 후보 · 유형 후보 · report 유형 · `result_code_provider_candidates` · `result_code_msg_type_candidates` 058) · 콘솔 조회 `web/api/routes/admin-messages.js:307-322` | 젬텍 = 1106 재매핑(sms 109 · lms_mms 169 · kakao 26 · all 25 활성 · all 71 꺼짐 (나)) → **정상(젬텍)** · 휴머스온 = 아래 A1-b · A1-c |
| A1-b | 휴머스온 카카오 리포트 코드 → 표준 | 원본 = Harold 전달 IMC 개발자 포털 저장본(1106 19:41 · 「응답 코드」 카카오 리포트 코드 150) ↔ 저장소 humuson_imc kakao 171(027 · 028 · 053 · 원천 「IMC 결과코드 v2.3.1」 · 운영 활성 171 (나) 와 같은 수) | **결함 D-A1b** = 포털 리포트 코드 16 매핑 없음: 1033 · 3000 · 8000 · 8001 · 8003 · 8004 · 8007 · 8008 · 8100 · 8101 · 8102 · 8103 · 8200 · 8201 · 9000 · 9999 → V9000 「알 수 없는 실패」. 저장소에만 있는 37(63 ~ 68 · 1005 · 1008 · 1010 · 2004 · 3042 · 3059 · 7101 ~ 7421 · ME04 ~ ME99 · MS03 · 1800)은 옛 친구톡 · 카카오 직접 코드라 그대로 둔다 |
| A1-c | 휴머스온 접수 응답(TCP RETURN_CODE) → 표준 | 커넥터 `connector/humuson_imc/connector.go:320-343` · 코드표 `payload.go:1307` = 1000 성공 · 2000 · 2001 · 2002 인증 · 3000 서비스 불허 · 4000 데이터 형식 · 8000 · 8001 일 · 월 한도 · 9000 · 9001 서버 / 커넥터가 만드는 것 = HUMUSON_NOT_READY · HUMUSON_DISCONNECTED · HUMUSON_IO · BAD_REQUEST · BAD_TYPE · NO_RETURN_CODE | **결함 D-A1c** = 접수 응답 코드 매핑 0 · 휴머스온 행이 전부 report_type 'any' 라 **같은 숫자의 리포트 뜻으로 풀린다**(4000 「데이터 형식 오류」 → KAKAO_4000 「응답 이력 없음」 · 3000 · 8000 · 8001 · 9000 도 리포트에 같은 숫자 = 다른 뜻) · 포털의 「카카오 결과 코드」 표(4000 BAD_REQUEST · 4005 · 4290 …)는 HTTP API 용이라 우리 커넥터(TCP)와 다른 코드표 = 대조 대상 아님 · 문자 · RCS 표 = 휴머스온으로 보내지 않아 대상 아님 |
| A2 | 게이트웨이가 스스로 만드는 실패 코드 → 표준 코드 | `internal/gateway/engine/sender.go` `markSendFailedAndFinalize` 상수 인자 9 = UNREG_SN · NO_SNDR · BAD_TYPE · LOST_BIND · BAD_PROV · DAILY_LIMIT_EXCEEDED · NO_BALANCE · NO_PRICE · BAD_BILL / 매핑 = bito 행 11(`migrations/027_result_code_registry.sql:176-191`: '' · 0 · 0000 · UNREG_SN · NO_SNDR · NO_ROUTE · NO_BIND · NO_PROVIDER · INVALID_PAYLOAD · TIMEOUT · DUPLICATE) | **결함 D-A2** = 7개(BAD_TYPE · LOST_BIND · BAD_PROV · DAILY_LIMIT_EXCEEDED · NO_BALANCE · NO_PRICE · BAD_BILL) 매핑 없음 → `V9000_UNKNOWN_FAILURE` → 고객 9999 · 한줄로 대역 59000(「알 수 없는 실패」). 실측 (나) 24시간 = gemtek sms DONE NO_BALANCE 3건 |
| A3 | 표준 코드 → 고객사 결과 코드 | `customer_result_code_map`(에이전트 · 발송계정 · 고객사 범위 · 유형) · 번역 함수 `customer_failure_code` 100 · 성공 `customer_success_code` 102 | 한줄로 네 대 = 대역 행(유형 all) · 518 → 49013(SMS) · 39013(LMS) 활성 (나) · hanjul01 옛 0708 행 9013 꺼짐(C107 G3) → **정상** |
| A4 | 고객사 결과 코드 → 한줄로 SMSQ status_code | 에이전트 `failure_code_source: gateway_report`(C107 G6) | **정상**(네 대 37행 · 82행 설정 · C107 원장) |
| A5 | 한줄로 SMSQ 코드 → 화면 · 엑셀 라벨 | 한줄로 `utils/sms-result-map.ts`(STATUS_CODE_MAP ≤ 9999 + `result-code-hanjul-band.generated.ts` HANJUL_BAND_CODES 244) · 엑셀 = `campaign-sms-export.ts:118` status_code 그대로 · 라벨 `getQueueRowStatus` | **결함 D-A5** = 1106 재매핑으로 생긴 대역 18개가 라벨 파일에 없다 (나): 27102 · 27104 · 27106 ~ 27110(카카오 발신프로필 · 옐로아이디 7) · 39078(LMS 발신번호 변작) · 40002 · 40004 · 40011 · 40013 · 40052 · 40053 · 40055 · 40056 · 40057 · 40090 → 한줄로 화면 = 라벨 없음 · **40052 「SMS 스팸 메시지」 · 40053 「SMS 스팸 번호」가 스팸 몰림 목록(C108 R64 = 대역 제목 「스팸」)에서도 빠진다** |
| A6 | 라벨 파일이 원천(게이트웨이 표준 코드 · 대역 행)을 따라가는가 | 생성 = `node scripts/gen-result-code-hanjul-band.mjs <게이트웨이 DB>`(손 실행) · 대역 행 = `scripts/gw/customer-failure-codes-hanjul.sql`(손 실행) | **결함 D-A6(뿌리)** = 게이트웨이에서 표준 코드 · 대역 행이 늘어도 한줄로 라벨은 모른다 · 알리는 장치 0 → D-A5 가 또 생긴다 |
| A7 | 직원이 매핑 전체를 대조할 수 있는가 | 콘솔 「표준화 관리」 세 탭(`ResultCodeMappingPage.jsx`) · API `result-codes.js:62 · 185 · 289`(LIMIT 없음) | **결함 D-A7** = 내려받기 · 출력 없음(접수 원문 「출력을 할 수 없어서 일일이 대조가 어렵다」) |
| A8 | 518 의 한줄로 숫자 | 대역 49013 · 39013 ↔ 직원 기대 9013 | **판단(Harold)** = C107 에서 정한 대역 방식 유지(한줄로 결과 표 숫자와 뜻이 다른 표준 번호가 있어 숫자 그대로는 겹친다 · 1106 G0 실측 3004 사례) · 화면 글은 「SMS 번호도용 차단」 → 추천 = 유지 |

---

## ② 메시지 이력 발송계정 조건 — 흐름 표

| # | 이음매 | 자리 | 판정 |
|---|---|---|---|
| B1 | 화면 조건 칸 | `MessageHistoryPage.jsx:194-209` · 칸 = phone · callback · from/to · status · result · type | **결함 D-B1** = 고객사 · 발송계정 고르는 칸 없음 |
| B2 | API 조건 | `admin-messages.js:105-176 buildWhere` = phone · callback · status · result · type · agent_id · bind_id · 기간 | **결함 D-B2** = sender_account_id · customer_id 조건 없음(agent_id 는 있는데 화면에 칸이 없다) |
| B3 | 발송 기록에 발송계정이 있는가 | `message_request.sender_account_id` · `customer_id`(015) · 표시 = `COALESCE(mr.sender_account_id, aa.sender_account_id)`(`admin-messages.js:304`) | 정상(칸 있음) · ⚠ 옛 행은 sender_account_id 가 비고 Agent 쪽에서 메운다 → 조건도 같은 식이어야 한다(설계) |
| B4 | 조회 속도 | 이력 인덱스 `idx_mr_history_filter (created_at, id) INCLUDE (…agent_id, bind_account_id)`(087) · 발송계정 · 고객사 칸은 INCLUDE 밖 · `idx_mr_sender_created`(015)는 분할(095) 뒤 존재 **미검증** | 설계 때 운영 EXPLAIN(ANALYZE 없이) 한 줄 |
| B5 | 접수 거부 탭 | `fetchRejections`(`MessageHistoryPage.jsx:227-246`) · `intake-rejections.js` | 같은 조건을 거부 탭에도 거는지 = 설계(거부 원장에 발송계정 칸 유무 확인 필요) |
| B6 | 고르는 목록 | 발송계정 목록 API `getSenderAccounts` 있음(`ResultCodeMappingPage` 사용) | 정상 |

---

## ③ 화면 페이징 — 흐름 표(메뉴 = 접수 원문 순서 · API 한계 = 핸들러 코드)

| 메뉴(접수) | 화면 | API | 서버가 주는 줄 | 화면 나눔 | 판정 |
|---|---|---|---|---|---|
| 관제 외부 라우터별 발송 | `ConsolePage.jsx`(★구현 때 바로잡음 · 관제 = 대시보드 첫 화면 · 「외부 라우터별」 글자가 있는 화면) | `/admin/stats/binds` 등 | 라우터 수만큼(제한 없음) | 없음 | D-C · 라우터가 늘면 끝없이 길어짐 |
| 전송파이프 Agent 수신 | `PipelinePage.jsx` | `/admin/pipeline/daily` | page · limit 70(상한 200) | 일부 있음 | 해당 구역 확인 필요(설계) |
| 통계 회선별 전송 | `StatsPage.jsx` | `/admin/stats/lines`(`stats.js:867`) | **제한 없음** | 없음 | D-C |
| 회선모니터링 | `LineMonitorPage.jsx` | `/admin/stats/binds`(`stats.js:1286` 제한 없음) · `/connections?limit=50` | 바인드 전부 · 접속 50 | 없음 | D-C |
| 고객사 | `CommercialAccountsPage.jsx` | `/admin/commercialization/customers`(`commercialization.js:1745`) | **제한 없음** | 없음 | D-C |
| 규격연동 계정 | `SpecAccountsPage.jsx` | `/admin/spec-accounts`(`spec-accounts.js:89`) | **LIMIT 1000 · 넘으면 말없이 잘림** | 없음 | **D-C2(잘림)** |
| 과금관리 사업자별 잔액 | `BillingPage.jsx` | `/admin/billing/overview`(`billing-admin.js:2122`) | 사업자 전부 | 없음 | D-C |
| 식별코드 등록부 | `SenderIdentityRegistryPage.jsx` | `/admin/sender-identities`(`sender-identities.js:84`) | **제한 없음** | 없음 | D-C |
| 발송제어 | `DispatchControlPage.jsx` | `/admin/dispatch-control/state` · `getAgents`(`api.js:75` **limit=200 고정**) | Agent 200 에서 말없이 잘림 | 없음 | **D-C2(잘림)** |
| 허용 발신번호 고객사 리스트 | `SenderNumberPage.jsx` | `getResellers`(`api.js:139` **limit=200 고정**) · `/admin/customer-sender-numbers`(page · limit 500 · 상한 1000) | 고객사 200 에서 말없이 잘림 | 없음 | **D-C2(잘림)** |
| 결과코드 매핑 | `ResultCodeMappingPage.jsx` | `/admin/result-codes/standard · provider · customer`(LIMIT 없음) | 전부(표준 258 · 원시 약 520 · 고객 = 에이전트마다 대역 262 → 대수만큼 늘어남) | 없음 | D-C + D-A7 |
| 발송정책 최근 정책 차단 | `SendPolicyPage.jsx` | `/admin/policies/blocks/history?limit=40`(상한 200) | 최근 40 | 없음 · 그 전 기록 못 봄 | D-C |

- 쪽 나누기 공용 부품 = `web/dashboard/src/components/ops-ui`의 `OpsPagination`(쓰는 화면 = 메시지 이력 · 로그 · 전송파이프 · 통계 일부 · 고객사(resellers) · 알림 · 차단 목록 · 온보딩).
- 대시보드 화면 28 중 쪽 나누기 0 = 20(접수가 짚지 않은 화면 = 라우팅 · 원격배포 · 설정 · AI · 정산 대조 · 다운로드 · 콘솔 · 정산서 · 경로).
- **D-C2 뿌리** = 목록 API 를 「한도 고정 숫자」로 불러 넘는 줄을 화면에 알리지 않는다(api.js 200 두 곳 · spec-accounts 1000). 지금 수(에이전트 21 · 고객사 수 = 미측정)로는 안 잘렸어도 늘면 고르는 목록에서 빠진다.

---

## 결함 장부 요약 · Harold 확인할 것

| 결함 | 고객 · 직원이 겪는 일 | 처방 방향(설계 단계에서 확정) |
|---|---|---|
| D-A1b 휴머스온 리포트 코드 16 매핑 없음 | 카카오 발송 실패 일부가 「알 수 없는 실패」 | 포털 표 그대로 표준 코드 · 행 추가 |
| D-A1c 휴머스온 접수 응답 코드가 리포트 뜻으로 풀림 | 접수 단계 실패(형식 · 한도 · 인증)가 엉뚱한 사유로 보임 | 접수 · 리포트 코드표를 가르는 축(설계) |
| D-A2 게이트웨이 자체 실패 코드 7 매핑 없음 | 잔액 부족 · 단가 없음 등이 「알 수 없는 실패(9999)」로 보인다 | bito 행 7 추가(표준 코드 = 기존 V 코드 또는 새 코드) + 계약 시험(소스의 상수 인자 전부 = 매핑 있음) |
| D-A5 한줄로 대역 라벨 18 빠짐 | 한줄로 결과 화면 · 통계에 라벨 없는 숫자 · 스팸 2코드가 스팸 몰림 경보에서 빠짐 | 라벨 파일 다시 생성 · 한줄로 배포 |
| D-A6 라벨이 원천을 못 따라감(뿌리) | D-A5 재발 | 원천이 바뀌면 알게 하는 장치(설계에서 후보 · 추천) |
| D-A7 매핑 내려받기 없음 | 직원 전수 대조 불가 | 세 탭 내려받기(엑셀) |
| D-B1 · B2 발송계정 조건 없음 | 고객사 계정 단위로 이력 못 찾음 | 화면 칸 + API 조건(옛 행 메우는 식 그대로) |
| D-C 목록 쪽 나누기 없음 | 끝없는 스크롤 | 메뉴마다 서버 나눔(늘어나는 목록) 또는 화면 나눔(작은 목록) · 공용 부품 |
| D-C2 목록 말없는 잘림 | 200 · 1000 넘으면 고르는 목록에서 빠짐 | 고정 한도 제거 · 서버 나눔 |

판단: 휴머스온 원본 = Harold 1106 IMC 개발자 포털 저장본(A1-b · A1-c 반영) · 세 접수 = 한 설계서 · 한 배포(Harold 1106 「묶어서 설계하는게 맞지」) · A8 = 대역 유지(추천 · Harold 반대 없으면 그대로).
