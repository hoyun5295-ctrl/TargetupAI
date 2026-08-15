# 비토 게이트웨이 — 과금 축 (GW-BILLING)

> 허브 = [FEATURE-BITO-GATEWAY.md](../FEATURE-BITO-GATEWAY.md) (§9에서 이 문서 등재). 게이트웨이 저장소는 git이 없으므로 **소스 수정 전 `.bak` 백업 의무**(허브 §2-1 작업 규율).
> 이 문서가 과금 축의 확정 사실·결함·잔여를 소유한다. 최초 작성 = 2026-08-15 전수점검(비토 직접 실행).

## 1. 정체성

게이트웨이 자체 과금 계층. **한줄로의 크레딧 정산과 별개다** — 여기는 게이트웨이가 Agent(=고객사 발송 계정) 단위로 선불 잔액을 차감하거나 후불 통계를 쌓는 층이다. 한줄로 정산은 [../FEATURE-BILLING.md](../FEATURE-BILLING.md)가 소유하며 서로 코드·DB가 완전히 다르다. 2026-08-15 기준 실사용 트래픽 0.

- 선불(prepaid) = 지갑(`billing_wallet`) 잔액을 발송 직전 차감, 실패 시 환불
- 후불(postpaid) = 차감 없이 통계 행만 적재(성공 ACCRUED), 청구·발행은 게이트웨이 밖(관리 화면·수동)

## 2. 돈의 흐름 (소스 실독으로 확정)

```
수락(accept)          : 과금 없음 — 저장만                     [accept.go — 테스트 TestAcceptDoesNotBillBeforeDispatch]
   ↓
발송 직전(dispatch)   : SELECT prepare_dispatch_billing(id)    [dispatch_billing.go:20 → migrations/038 PG 함수]
                        한 트랜잭션: mr 행 잠금 → 지갑 FOR UPDATE
                        → 멱등키 'charge:<id>' 차감 → 미러 동기화
                        결과: prepaid_charged/prepaid_existing/postpaid
                              /insufficient(NO_BALANCE 종결)/no_price/bad_type
   ↓ (배치 경로: 후불만 인라인 fast-path, 나머지는 행별 prepare_provider_dispatch [dispatch_batcher.go:180, migrations/039·042])
REPORT 성공           : 선불 CAPTURED / 후불 ACCRUED           [billing_finalizer.go finalizeBillingSuccessSQL]
REPORT·ACK 실패       : 선불 REFUNDED(원장+지갑+미러) / 후불 FAILED  [finalizeBillingFailureSQL, 멱등키 'refund:<id>']
```

**환불 행위자 = 2 + 안전망 1** (전부 같은 멱등키 `refund:<id>`)
1. Go 엔진 — 실패 종결 시 동기 실행(`finalizeBillingFailure`). 실패해도 로그만 남기고 진행(fire-and-forget)
2. Node 워커 — DB 트리거 `pg_notify('refund_needed')` 수신(`workers/refund-worker.js`, server.js:881 기동 확인)
3. Node 워커 폴백 스윕 — 30초마다 `FAILED/SEND_FAILED + RESERVED/CHARGED` LIMIT 100 재스캔 → 1의 실패를 여기서 회수

## 3. 불변 원칙 (코드·스키마에서 확인된 계약)

1. **차감·환불은 원장이 먼저다** — `billing_ledger` INSERT(`ON CONFLICT (idempotency_key) DO NOTHING`)를 선점해야만 지갑 잔액을 만진다. 선점 실패 = 이미 처리됨.
2. **이중 환불은 세 겹으로 닫혀 있다** — ①Go·Node 동일 멱등키 ②원장 유니크 ③스키마 방벽 `uq_billing_ledger_refund_request`(request_id당 REFUND 1행, migrations/015:234).
3. **이중 장부** — `billing_wallet.balance`(진실) ↔ `agent_account.balance`(미러). 모든 변경 지점이 같은 문장/트랜잭션에서 미러를 동기화한다.
4. **지갑 유일성은 부분 유니크 인덱스** — scope(customer/sender/agent)별 `WHERE is_active=TRUE` (migrations/015:174-182). `ON CONFLICT DO NOTHING` 지갑 자동 생성이 이것에 의존한다.
5. **VAT는 공급가에 10% 얹어 차감** — Go(`billingcalc`)와 SQL(038) 모두 "VAT 반올림 → 합산 반올림" 동일 순서. 소수 단가 검증 케이스 있음(7.55→0.76→8.31).
6. **성공/실패 판정 코드는 결과 경로가 소유** — `isSuccessfulReportCode`(report.go). 과금은 그 판정을 소비만 한다.

## 4. 확정 결함·위험 (2026-08-15)

| # | 내용 | 위치 | 판정 |
|---|---|---|---|
| 1 | **죽은 코드에 경합 차감 로직** — `prepareInboundBilling`·`applyInboundBilling` 호출부 0곳. 잔액을 Go에서 read-then-write하는 구식 경로라 **되살리면 트랜잭션 경계에 따라 이중 차감** 위험 | `inbound_billing.go:41·64` | grep 전수로 호출 0 확정 |
| 2 | **과금 보정 스윕(Go)도 죽은 코드** — `finalizePendingBillingFailures` 호출부 0곳. 실제 안전망은 Node 워커 30초 스윕이 대신함 | `billing_finalizer.go:23` | 동일 |
| 3 | **credit_limit 미강제** — 컬럼·관리 UI 입력은 있으나 런타임 소비처가 죽은 코드뿐. 후불은 사실상 무제한 | `commercialization.js:900` 입력만 | grep 전수 확정 |
| 4 | **refund_needed 트리거 3세대** — 008(unit_price만)→015→031(charge_amount 포함). 구세대가 걸려 있으면 환불액이 VAT 제외가 된다. 워커는 `charge_amount || unit_price` 폴백. **운영 DB에 실제 어느 판이 걸려 있는지 미검증** — 확인 SQL: `SELECT prosrc FROM pg_proc WHERE proname='notify_refund_target';` (실제 함수명은 마이그레이션 대조 후) | migrations/008·015·031 | 미검증 |
| 5 | 관리자 수동 충전 멱등키가 랜덤(`deposit:...random`) — 더블클릭/재시도 = 이중 입금 가능. FOR UPDATE 트랜잭션은 있으나 요청 단위 dedupe 없음 | `billing-admin.js:536·749` | 코드 확정 |
| 6 | 후불 폴백 스윕은 `billing_status='PENDING'` 실패 행을 안 줍는다(RESERVED/CHARGED만) — 돈 아닌 통계 정합 문제. Go 동기 종결이 실패한 후불 행은 FAILED 표시가 누락될 수 있음 | `refund-worker.js:_fallbackPoll` | 코드 확정 |
| 7 | 038 가격 결정의 ELSE 폴백 = SMS 단가 — 미지 msg_type이 오면 no_price가 아니라 SMS 요금으로 차감. 현재는 sender.go의 타입 검증이 앞에서 막고 있음 | migrations/038:43 | 코드 확정 |

## 5. 테스트 증거 (2026-08-15 로컬 실행, go1.26.0)

- `internal/gateway/engine` + `internal/common/billingcalc` 과금 계열 전부 PASS — 수락 무과금 / dispatch 원자 1콜 / 선불 멱등 재차감 방지 / 잔액 부족 거부 / 실패 환불이 부가세 포함 총액(gross) / 원장 선점 후 지갑 반영 / 후불 통계-무잠금 / 배치 코얼레싱
- PG 필요 통합 테스트(`TestRefundPrepaidSQLConcurrentPostgres`)는 로컬 DB 없이 스킵 — 동시 환불 실증은 미실행
- web/api(Node) 테스트는 로컬 사본에서 의존성 미설치로 실행 불가(허브 §7-1 관찰 ③)

## 6. 착수 원장

1. [ ] 죽은 코드 2건 제거(§4-1·2) — 삭제만으로 위험 축 하나가 닫힌다. 자비스 협의 후
2. [ ] 운영 DB 트리거 세대 확인(§4-4) — 고객사 이관 전 1회, 확인 SQL은 §4-4
3. [ ] credit_limit 정책 결정(§4-3) — 강제할 것인지, 컬럼을 걷어낼 것인지. Harold 판단 필요
4. [ ] 수동 충전 요청 단위 멱등(§4-5) — 관리 화면에서 실제 입금 운영을 시작하기 전
5. [ ] 후불 정산·청구 흐름 부재 확인 — ACCRUED 통계를 청구서로 바꾸는 경로가 게이트웨이에 없다(관리 화면 조회뿐). 고객사 후불 계약을 받기 전 필요 여부 판단
