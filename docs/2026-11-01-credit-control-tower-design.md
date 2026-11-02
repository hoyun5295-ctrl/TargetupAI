# 크레딧 컨트롤타워: 오차 0 원장 · 매월 1일 지급 · 일할 · 체험 · 후불 초과 · 분석 차감 (2026-11-01 설계 4판)

> 호출어 **크레딧 컨트롤타워 / 1일 지급 / 체험 크레딧 / 오차 0 원장**
> 상태 = 설계 5판 · **구현 끝 · Codex 구현 6R approve(지적 0)**(§13 · 1R~5R 지적 9건 + 범위 밖 1 + 자체 검토 6 전부 수용) · 배포 순서 = 사전 SQL → DDL-1(배포 앞) → 커밋 · 배포 → DDL-2(§10 · 원장 C90) · **구현 동의 = Harold 1101 「크레딧 관련 전부 결함 닫은 다음 Codex 닫힐 때까지 · 배포 명령어 보고」** · 미커밋 · 미배포.
> 뿌리 = [ROOT-LEDGER](ROOT-LEDGER.md) R1 · R14 · R18 넓힘 + 새 뿌리 R38(§5-4). 앞선 일할 묶음 = [2026-10-26 원장](2026-10-26-plan-credit-trial-agency.md) · 선불 기간 = [2026-10-04 설계서](2026-10-04-prepaid-plan-term-design.md) · 교훈 = LESSONS_DB 핵심원칙 1 · 11 · 17 · 33.

## 0. 한 화면 요약
- **지금 크레딧 방식의 문제 14개**(§4). 크게 넷이다.
  1. 지급이 일어난 때에 기록되지 않는다: 월 지급이 1일이 아니라 그 달 첫 사용 순간이고(1일 함수 호출 0), 체험 중 달이 바뀌면 체험 요금제 월분이 다시 들어간다.
  2. 원장으로 잔액을 설명할 수 없다: 원장 없이 잔액을 덮어쓰는 곳 3곳, 남은 기본분 소멸이 원장에 없음, 리셋은 잔액부터 쓰고 원장은 건너뛸 수 있음, 원장 순서가 거래 시작 시각이라 뒤바뀜, 원장과 잔액을 대조하는 장치 0.
  3. 같은 계산이 두세 벌이고 입력이 흔들린다: 남은 크레딧 판정 세 벌, 요금제 일할 반올림이 변경마다 따로(한 달 여러 번 바뀌면 1씩 어긋남), 요금제 월 크레딧을 달 중간에 바꿀 수 있어 그 달 계산이 갈림, 이력 화면 부호 판정 두 벌.
  4. 돈이 새거나 더 나가는 자리: 후불은 「내림 회수」로 생긴 음수가 청구에서 빠지고, 반대로 올림으로 메워져도 이미 적힌 초과분은 그대로 청구된다. 분석 차감은 실패해도 알림 0(이에스페이먼트 10/7~11/1 26일 · 원인 = 외래키 위반).
- **오차 0 장치**(§5): 잔액이 바뀌는 모든 순간 = 같은 트랜잭션의 원장 한 줄(원장 먼저) · 원장 순번(seq) · 줄마다 「직전 잔액 + 이 줄의 변동 = 이 줄 잔액」 · 「마지막 줄 잔액 = 회사 잔액 칸」을 **매일 대조 워커가 검사해 1크레딧이라도 다르면 그날 경보**. 그 달 권리 E = 그 달 전체 요금제 시간표 × 그 달에 고정한 월분을 한 번 반올림 · 1일 지급도 요금제 변경도 E 의 차이만 주고받는다(누적 오차 0).
- **Harold 결정 3개**(§11): D-A 체험 크레딧 = 체험 한 번에 한 번 · D-B 후불 초과 = 주기 마지막 기본분 기준 맞춤(충전분 불변) · D-C 선불 = 새 회사만 1일 맞춤(이에스 그대로).
- **4판 뼈대**(§5 머리): 월 마감은 한 달씩 순서대로 · 요금제 적용일은 이번 달 오늘까지만 · 환불은 자기 차감의 역만 · 발행이 그 회사 월 마감을 먼저 한다.
- **DDL 2개**(§7): 원장 순번 `seq` · 그 달 월분 고정표 `plan_month_credits`. 둘 다 추가만.
- **이에스페이먼트 분석 외래키**: 고객 한 명의 저장된 id 가 1비트 바뀜(확정 · §2-2 · 전체 고객 표에서 이 1행뿐) → 1101 Harold 실행으로 진짜 id 로 되돌림(확인 4개 정상 · §9 ⑫ · [B-1101-5](../status/BUGS.md)) · 남은 = 분석 실제 실행 확인.

## 1. 접수 대조표 (Harold 1101 원문 → 축 → 닫힘)
| # | 원문 | 축 | 닫힘 |
|---|---|---|---|
| 1 | 「제시뉴욕 · 이에스페이먼츠 크레딧이 지급이 안 되지」 | C2 1일 지급 | 배포 즉시 11월분 소급(§9 ①) |
| 2 | 「선불인데 16만5천원 차감되면서 크레딧은 들어가야」 | 선불 이용 기간(C15 · 변경 없음) + C2 | 결제 = 11/2 0시대 기존 워커(만료일 11/1 · 자동 연장 · 잔액 707,582원 · `plan-term.ts:1061`) · 실측 §9 ② |
| 3 | 「제시뉴욕은 스타터 크레딧 지급」 | C2 | §9 ① |
| 4 | 「43만건인데 분석차감이 안 되는데」 | C6 | 원인 = 외래키 위반(로그 확정) · 무엇이 빠졌는지 = §9 ⑥ 뒤 처방 · 경보는 원인과 무관하게 닫음 |
| 5 | 「매월 1일 자동지급」 | C2 · R18 | 닫힘 |
| 6 | 「중간 사용도 정산 일할 · 크레딧 일할」 | C4 | 정산 = 이미 됨(`billing.ts:2853`) · 크레딧 = 시간표 E 로 바꿔 오차 0 |
| 7 | 「크레딧을 컨트롤타워화해서 완벽하게」 | C1 · C5 · C7 · C9 · C10 · R38 | 닫힘 |
| 8 | 「설계서 구조체크 · 닫힐 때까지 수정」 | §12 · §13 | 구조체크 6회차 0 · Codex 2R 대기 |
| 9 | 「현재 크레딧 방식의 문제점 · 단 1의 오차도 없게」 | §4 · §5 | 문제 14 · 불변식 I1~I9 · 대조 워커 |
| 10 | 「슈퍼관리자 고객 숫자 천 단위 쉼표」 | §14 | 코드 반영 2곳 |
| 11 | 「선불업체는 1일에 자동 차감되어야 · 지금 2일날 차감되게 되어 있을 수도 · 선불은 먼저 차감」(1101) | 선불 결제일 = 달력 월(P15 · D-C) | 확인 = 코드(P15) + 데이터(Harold 1101: 이용 기간 관리 선불 회사 = 이에스 1곳 · 이력 = `start` 1건 10-04 ~ 11-01 · 0원 · super_admin 10-04 15:00 · 다음 결제일 11-02) · 이에스 = Harold 1101 「그냥 냅두고 내일 만료되면서 차감만 되면」 → **바꾸지 않음**(11/2 0시대 165,000원 · 11/2~12/1 · 결제일 2일 유지 · 크레딧 1일과 하루 차이) · 새로 시작하는 선불의 1일 맞춤(첫 결제 그달 말일까지 일할 · `periodEnd(1일)` = 그달 말일이라 그 뒤 연장은 1일) = D-C 결정 대기 |
| 12 | 「크레딧 관련 전부 결함 닫은 다음 Codex 리뷰 닫힐 때까지 · 배포 명령어 보고」(1101) | 구현 동의(workflow_4_1) · D-A · D-B · D-C = 추천안으로 진행 | 4판 → 구현 → Codex approve → 배포 명령 |

## 2. 실측
### 2-1. 운영 SQL (Harold 1101)
| 회사 | 결제 | 요금제 · 월분 | 기본 · 구매 | 마지막 리셋(KST) | 이용 기간 | 선불 잔액 | 11월 원장 | 고객 | 분석 차감 |
|---|---|---|---|---|---|---|---|---|---|
| (주)이에스페이먼트 `19c59d0c` | 선불 | STARTER 300 | 654 · 0 | 10-01 09:19 | 만료 11-01 · 자동 켬 | 707,582.70 | 0행 | 431,973 | 15행 · 마지막 10-06 09:06 |
| 제시뉴욕 `a589f07e` | 후불 | STARTER 300 | 8 · 40 | 10-24 04:00 | 없음 | 0 | 0행 | 0 | 0행(고객 0 = 차감 0 이 맞다) |

### 2-2. 서버 로그 · 스키마 (Harold 1101 · 시험 그릇 1101)
- `[PredictiveWorker] 회사 batch 오류, skip: 19c59d0c… insert or update on table "cdp_customer_predictions" violates foreign key constraint "cdp_customer_predictions_customer_id_fkey"` = 10-30 09:00 · 10-31 09:14 · 11-01 09:15(마지막 20줄에 잡힌 것만).
- 같은 회사 `일일 브리핑 저장` = 09-22 ~ 10-06 매일(분석 성공 뒤에만 남는 줄 · `predictive-worker.ts:143-147`) → 10-07 부터 실패.
- 외래키 정의(시험 그릇 `t_tpl_closed` · 운영 정의 대조 덤프) = `customer_id → customers(id) ON DELETE CASCADE` · 고객 표는 상속 없는 일반 표 · 고객 표를 연쇄로 지우는 외래키 · 트리거 · DB 함수 0.
- 고객을 지우는 코드 = 사람이 누르는 주소 3개(`routes/customers.ts:1354` 단건 · `:1435` 일괄 · `:1545` 전체 · 싱크 중이면 막힘) + 관리자 사용자 삭제(`routes/admin.ts:465`) + 회사 통째 삭제 스크립트(`fk-delete-plan.ts:208`). 고객 id 를 바꾸는 갱신 0. 운영 코드의 넷은 모두 감사 기록을 남긴다(`customer_delete`(대상 = 고객 id) · `customer_bulk_delete` · `customer_delete_all` · `customer_delete_by_user`) · 여러 줄 SQL 까지 grep 1101 = 이 두 파일뿐.
- 배치 SQL 의 고객 id 는 그 문장이 시작할 때의 고객 표에서만 나온다(`predictive-suite.ts:1057-1062` → INSERT `:1202`). 외래키 검사는 행을 넣는 순간의 최신 상태를 보므로, 문장이 도는 사이 다른 트랜잭션이 그 고객을 지우고 커밋하면 이 오류가 난다.
- Harold 1101 실측: 오류 Key 고객 `d65ae273-f184-4cd7-b817-90b5b96b0e2b` = id 로 찾으면 0행 · 이에스 고객 431,980(같은 날 앞선 조회 431,973) · 예측 429,506행 · 마지막 계산 10-06 09:06.
- Harold 1101 실측(§9 ⑦): 10/1 이후 이에스 고객 삭제 감사 기록 0건 · 고객 표 통계 = 넣기 21 · 고치기 1,049 · **지우기 0** · 살아 있는 행 21 · 통계 초기화 시각 NULL. 43만 명 회사가 든 표의 살아 있는 행이 21 = 통계가 0부터 다시 쌓인 상태(PostgreSQL 은 정상 종료가 아닌 상태에서 복구하며 켜지면 통계를 버린다). 지우기 0 이 오늘 9시 15분을 덮는지 = DB 시작 시각(§9 ⑧).
- 그래서 「지워짐」은 아직 증거가 없다. 남은 두 후보(미검증): (가) 기본키 색인이 그 고객을 못 찾는 상태 → 색인을 끄고 표를 직접 읽으면 그 고객이 나온다(외래키 검사 · id 조회는 기본키 색인으로 찾고, 배치는 회사 조건으로 표를 읽는다) (나) 코드 밖 경로 삭제 → 표를 직접 읽어도 0행 · DB 시작이 오늘 9시 15분 뒤.
- **Harold 1101 실측(§9 ⑧) = (가) 확정**: DB 시작 10-08 15:57(→ 지우기 0 이 10/30 · 10/31 · 11/1 9시대를 덮는다 · 삭제 없음) · 기본키 색인(`Index Only Scan using customers_pkey`) = 0 · 색인을 끈 순차 읽기(`Parallel Seq Scan`) = **1행**(이에스 · 활성 · 생성 09-21 07:50 · 수정 10-28 17:05) · `fsync` · `full_page_writes` on · `data_checksums` off · 고객 표 386 MB. = 표 본체와 기본키 색인이 어긋났다. 앱 코드로는 만들 수 없는 어긋남(색인은 DB 가 맞춘다).
- 같은 서버(.62)의 앞선 기록(사실): 10-06 TOAST 색인 손상 · 10-25 압축 데이터 손상(`status/SERVERS.md` .62 · memory hanjul03) · **10-26 memtester 메모리 고장 확정 · ECC 미동작** · 1101 MySQL 보조 색인이 본체와 어긋남 · 불량 메모리 칸 제거 = 남은 운영(`status/BUGS.md:62-66`) · 10-06 뒤 후속으로 잡은 전체 색인 점검(amcheck)은 실시 기록 없음. 이번 것도 같은 줄로 보지만 원인 확정은 아니다(미검증).
- **Harold 1101 실측(§9 ⑩) = (A) 확정 · 표 본체의 고객 id 한 비트가 바뀜**: 고아 예측 = 전체 1행(이에스) · 그 id `d65ae273-f184-4c97-b817-90b5b96b0e2b`(진짜 id · 예측 마지막 계산 10-06 09:06 KST) ↔ 본체 `…-4cd7-…` = 0x97 → 0xd7(비트 0x40 켜짐 · 차이 1비트) · 진짜 id 로 기본키 색인을 찾으면(`Index Scan using customers_pkey`) 본체 id `…4cd7…` 행이 같은 ctid `(9786,30)` 로 나온다 = 색인은 진짜 id 를 들고 그 행을 가리키는데 행에 저장된 id 만 바뀌었다. 바뀐 때 = 10-06 09:06 ~ 10-07 09:00(10-06 분석 성공 · 10-07 부터 실패). 그 뒤 매일 배치가 바뀐 id 로 예측을 새로 넣다가 외래키(기본키 색인)에서 실패했다. 같은 모양 = 1021 MySQL SMSQ_SEND_14 저장 바이트 비트 변형(0x40 꺼짐 등) · 1026 memtester 1비트 오류(.62).
- 처방이 갈리는 지점: 이 고객은 09-21 부터 있었고 09-22 ~ 10-06 분석이 매일 돌았는데 예측 행이 없어 새로 넣다가 실패했다 → (A) 표 본체의 고객 id 자체가 비트 단위로 바뀜(원래 id 의 예측 · 구매 이력이 남아 있음 · 색인만 다시 만들면 이력이 끊긴 채 굳는다 → 원래 id 로 되돌려야 함) (B) 색인만 깨짐(색인 재생성으로 끝). 가르는 SQL = §9 ⑨.

### 2-3. 화면 (Harold 1101)
- 크레딧 사용 이력: 11월 리셋 6행이 전부 그 회사 첫 작업과 같은 초(9:15:15 · 9:15:19 · 9:15:26 · 9:00:01).
- 고객사 관리: 이에스페이먼트 고객 수 `431971`(쉼표 없음). 431,973(SQL)과의 2 차이 = 목록은 활성 고객만 센다(`routes/companies.ts:1759` `is_active = true`).

## 3. 지금 구조 (소유 · 경계 · 같은 모양)
### 3-1. 잔액 칸(`ai_credits_base_remaining` · `ai_credits_purchased` · `ai_credits_reset_at`)을 쓰는 자리 전수 (grep 1101)
| # | 자리 | 하는 일 | 원장 | 순서 |
|---|---|---|---|---|
| W1 | `ai-credit-tx.ts:119` applyResetIfNeeded | 월 리셋(지급 = 지금 요금제 월분) | `reset`(amount = 지급 총량) | **잔액 먼저 · 원장 DO NOTHING** |
| W2 | `ai-credit-tx.ts:150` 차감 | 차감 | `deduct` | 잔액 먼저(중복은 잠금 뒤 미리 거름) |
| W3 | `ai-credit-tx.ts:271` 환불 | 환불(지난 주기 후불 초과분 = 부채만 취소 :367-376) | `refund`(amount = 환불 전체) | 잔액 먼저 |
| W4 | `ai-credit-tx.ts:459` 관리자 조정 | 구매분 ± | `grant` · `admin_deduct` | 잔액 먼저 |
| W5 | `ai-credit-recharge.ts:73 · 166` | 충전 | `purchase` · `postpaid_grant` | 잔액 먼저 |
| W6 | `plan-change-log.ts:289 · 300` | 요금제 변경 일할 | `plan_prorate`(부호 = 방향) | **원장 먼저 · 들어갔을 때만 잔액** |
| W7 | `basic-trial.ts:139 · 140` | 체험 부여 = 기본 덮어쓰기 · 리셋 시각 = 지금 | **없음** | |
| W8 | `trial-downgrade-worker.ts:128 · 129` | 체험 만료 = 기본 0 | **없음** | |
| W9 | `routes/companies.ts:2039 · 2040` | 체험 취소 = 기본 0 | **없음** | |

### 3-2. 남은 크레딧 판정 (세 벌)
| # | 자리 | 리셋 전 기본분 | 마이너스 허용 | 부르는 곳 |
|---|---|---|---|---|
| J1 | `ai-credit.ts:42` getCreditState → 표시 · `checkCredit`(:106) | 요금제 월분 그대로(:55) | 후불 한도만(:112) | 표시 7곳 · 사전 확인 51곳 |
| J2 | `ai-credit.ts:94` hasCreditForStrict | `carriedBaseOnReset`(:100 · 선불 음수 상계) | 원천별(`creditOverageAllowance`) | 2곳 |
| J3 | `ai-credit-tx.ts:186-196` 차감 | 실제 리셋 | 원천별 | 차감 전부 |

### 3-3. 시간으로 도는 것
- 월 리셋 = 첫 사용 순간(W1 을 부르는 곳 = 차감 :186 · 환불 :295 · 요금제 변경 `plan-change-log.ts:269`). 1일 함수 `resetMonthlyCreditsIfNeeded`(`ai-credit.ts:476`) = 호출 0.
- 매월 굳는 지급의 자리 = `free-messaging-grant-worker.ts`(10분 주기 · 기동 즉시 · 선불 기간 정산 먼저 :38-50).
- 선불 기간 = `plan-term.ts` 10분 패스(후보 = 만료일 < 오늘 :1061) · 바뀐 요금제는 `recordPlanChange`(적용일 = 오늘 :305 · 운영 코드에서 미래 적용일을 넘기는 곳 0 · 함수는 받는다).
- 체험 만료 = 매일 04:00 워커(W8) · 분석 차감 = 매일 9시대(`predictive-worker.ts:206-213`).

### 3-4. 돈 · 화면 · 잠금
- 후불 크레딧 청구 = 승인 충전 + 차감 행 초과분(`type='deduct' AND overage_credits > 0`) 세 곳: 미리보기 `billing.ts:2920-2930` · 발행 `billing-issue.ts:723-735` · 정액 발행 거부 `billing-issue.ts:1279-1287`.
- 정산 쓰기 잠금 = advisory(회사, 'billing') → 회사 행 `FOR NO KEY UPDATE`(`billing-lock.ts:32-37`) · 크레딧 쓰기 = 회사 행 `FOR UPDATE`(`ai-credit-tx.ts:81`) → 둘은 회사 행 하나로 줄을 선다(먼저 끝난 쪽이 앞 · 순서 보장은 아님).
- 원장 행을 그리는 화면 = `CreditsTab.tsx`(슈퍼관리자) · `CreditHistoryModal.tsx`(고객) 둘. 부호는 각자(`CreditsTab.tsx:284` · `CreditHistoryModal.tsx:46-47 · 145`) · 이름표 `constants/credit.ts:212-217`(없으면 type 글자 그대로 `:224` · 차감은 원천 이름표 `:221`).
- 목록 순서 = `created_at DESC`(`ai-credit.ts:551 · 582`) · `created_at` 기본값 = `now()` = 거래 시작 시각.

### 3-5. 요금제 월 크레딧을 쓰는 자리
- 요금제 추가 `routes/admin.ts:2773-2785` = 월 크레딧 칸을 받지 않는다 → NULL.
- 요금제 수정 `routes/admin.ts:2801-2815` = 월 크레딧을 아무 때나 바꾼다(슈퍼관리자 화면).
- 읽는 곳 = 리셋(`ai-credit-tx.ts:123` 지금 값) · 일할(`plan-change-log.ts:115 · 262`) · 표시 · 확인(`loadCreditRow` 지금 값).

## 4. 지금 크레딧 방식의 문제점
| # | 문제 | 증거 | 결과 | 뿌리 |
|---|---|---|---|---|
| P1 | 월 지급이 1일이 아니라 첫 사용 순간 | §3-3 · §2-1 11월 0행 · §2-3 | 원장에 지급이 늦게 또는 없게 남음 · 「지급 안 됨」으로 보임 | R18 |
| P2 | 원장 없이 잔액을 덮어쓰는 곳 3곳 | W7~W9 | 원장으로 잔액 설명 불가 · 1026 제시뉴욕 −160 오산의 원인(LESSONS_DB 1) · 체험 부여 · 만료가 선불 음수 빚을 지운다 | R38 |
| P3 | 남은 기본분 소멸이 원장에 없다 · 리셋 행 amount = 지급 총량 | `ai-credit-tx.ts:134-141` | 이에스 11월 리셋 때 654 → 300 의 −354 가 어디에도 안 남는다 | R38 |
| P4 | 리셋은 잔액부터 바꾸고 원장은 `ON CONFLICT DO NOTHING` | `ai-credit-tx.ts:127-141`(일할은 반대 순서 `plan-change-log.ts:289-303`) | 키가 이미 있으면 원장 없이 잔액만 바뀐다 | R38 |
| P5 | 체험 중 달이 바뀌면 TRIAL 월분이 다시 들어간다 | 체험 부여 = 300 또는 TRIAL 월분(`basic-trial.ts:53 · 112`) · 리셋 = 요금제 월분(`ai-credit-tx.ts:123`) · TRIAL 750 = SCHEMA 기준(§9 ④ 로 확인) | 7일 체험 300 에 750 이 더 | R1 |
| P6 | 남은 크레딧 판정 세 벌 | §3-2 | ① 선불 음수 빚이 있는 회사의 월초 = 화면 · 사전 확인은 빚을 빼지 않은 요금제 월분으로 통과 → 차감에서 거절(일한 뒤 결과를 못 줌) ② 사전 확인은 원천을 몰라 후불 한도를 주지만 발송 크레딧 원천은 차감에서 0 | R1 |
| P7 | 요금제 일할 반올림이 변경마다 | `plan-proration.ts:421` | 31일 달 14일 미가입→베이직, 30일 베이직→프로: 변경마다 반올림 435 + 106 = **541** · 날짜별 합 541.94 → **542** = 1 차이 | R1 |
| P8 | 후불 초과 = 차감 순간의 음수만 청구 | §3-4 · 일할 회수(`plan-change-log.ts:300`) · 후불 음수는 다음 달로 안 넘김(`ai-credit-tx.ts:114-115`) | ① 베이직 후불이 10일까지 750 다 쓰고 11일 스타터로 내리면 회수 −305 → 기본분 −305 → 청구 0 · 다음 달 1일 사라짐(305 크레딧 = 152,500원) ② 반대로 초과 50 이 적힌 뒤 올려서 그 달 권리 안이 되어도 50 이 그대로 청구 | R1 |
| P9 | 이력 화면 부호 두 벌 · 이름표 빠짐 | §3-4 | 리셋 빨간 −16,500 · 일할 +8 이 「-8」 · 회수는 「--」 · 고객 화면에 `plan_prorate` 영어 | R1 · R11 |
| P10 | 분석 차감 실패가 경고 로그 한 줄로 끝남 | `predictive-worker.ts:152-153` · §2-2 | 이에스 26일 분석 중단(예측 점수 10/6 그대로) · 알림 0 | R14 |
| P11 | 원장 순서 = 거래 시작 시각 | §3-4 | 잠금을 늦게 잡은 거래가 앞서 찍히고 같은 거래 줄은 같은 시각(§2-3) → 「직전 행」(`ai-credit-tx.ts:386-392`)과 화면 순서가 뒤바뀔 수 있음 · 원장 연쇄 대조 불가 | R38 |
| P12 | 원장과 잔액 칸 = 두 진실인데 대조 워커 0 | 6원칙 ③ | 어긋나도 아무도 모른다 | R38 |
| P13 | 요금제를 새로 만들면 월 크레딧이 NULL → 그 요금제 회사는 차감 자체가 꺼짐 | §3-5 요금제 추가 · `ai-credit-tx.ts:166-171` | AI 무제한 무료 · 운영 요금제 값 = §9 ④ | R1 |
| P15 | 선불 요금 결제일 = 첫 결제한 날 기준 한 달(1004 설계 D1 「10/4 시작 → 11/3 만료」) · 크레딧은 매월 1일 | 첫 결제 = 그날부터(`plan-term.ts:629` coversFrom = 오늘) · 기간 끝 = 다음 달 같은 날 −1(`plan-term-calc.ts:47`) · 연장 = 만료 다음 날 0시대(`plan-term.ts:410 · 429` 만료일 < 오늘) | 이에스 = 만료 11-01 → 11/2 0시대 165,000원(150,000 + 부가세) · 11월 크레딧은 11/1 에 먼저 들어감 = 「선불인데 돈보다 크레딧이 먼저」 · 달 중간 시작은 일할 없이 한 달 값 | R1 |
| P14 | 요금제 월 크레딧을 달 중간에 바꿀 수 있고 모든 계산이 그때의 값을 읽는다 | §3-5 요금제 수정 | 그 달 1일 지급분(옛 값)과 그 뒤 일할 · 표시(새 값)가 갈린다(Codex 1R 반례: 30일 달 1일 0시 5분 300 지급 → 9시 600 으로 수정 → 16일 750 요금제로 바꾸면 지금 코드 지급 합 375 · 옛 값 기준 권리 525 · 새 값 기준 675 = 어느 쪽과도 다름) | R1 |

## 5. 오차 0 설계 (4판)
4판에서 바꾼 뼈대 셋(Codex 2R 지적이 같은 자리에서 반복된 뿌리를 구조로 닫는다 · §13):
- **월 마감은 한 달씩 순서대로**(R2-3): 리셋이 밀린 달이 있으면 그 달마다 「마감(맞춤 · 소멸) → 다음 달 지급」을 차례로 하고, 줄의 시각은 그 달 경계다. 마지막 리셋 시각 하나로 앞 달들이 닫혔다고 보지 않는다.
- **요금제 적용일 = 이번 달 1일 ~ 오늘만**(R1-3 · R2-4): 운영 호출부 전부가 오늘을 넘긴다(`plan-term.ts:305` · 나머지는 생략 = `todayKst()`). 미래 · 지난달 적용일을 받지 않으면 달 경계의 시간표 = 그때 요금제 하나라 체험 잔액과 유료 지급이 한 달에 섞이지 않는다.
- **환불 = 자기 차감 행의 역만**(R1-6 · R2-1): 지금 코드 규칙(구성분 복원 · 지난 주기 후불이면 자기 미청구 초과분만 부채 취소) 그대로 · 환불 행 `overage_credits` = 부채로 갚은 양. 3판의 「그 주기 미청구 초과분(맞춤 줄 포함)을 먼저 줄인다」는 지운다. 월말 맞춤 줄은 환불이 다시 건드리지 않는다.

### 5-1. 불변식
| # | 불변식 |
|---|---|
| I1 | 잔액 칸이 바뀌는 모든 순간 = 같은 트랜잭션 · 같은 회사 잠금 안에서 **원장 줄을 먼저** 넣고(0행이면 멈춘다), 그다음 잔액 UPDATE. 기본분을 바꾸는 쓰기는 그 전에 월 마감(C2)을 먼저 돌린다 |
| I2 | 원장 순번 `seq` = 회사 잠금을 잡은 순서 |
| I3 | seq 순으로 「직전 줄 잔액 + 이 줄 변동(§5-2) = 이 줄 잔액」 |
| I4 | 「마지막 seq 줄 잔액 = 회사 잔액 칸」 |
| I5 | 그 달 권리 E(M) = round(Σ 날짜별 월분 ÷ 그 달 일수) 한 번. 날짜의 요금제 = 그 날 이전 마지막 이력의 to_plan · 첫 이력 전 날짜 = 첫 이력의 from_plan(없으면 0) · 이력이 하나도 없으면 지금 요금제(지금 lazy 리셋과 같은 결과 · 회사별 하루 1번 경고). 월분 = `monthCredits(M)`(C10) · TRIAL · FREE = 0 |
| I6 | 남은 크레딧 = 함수 하나(`projectCredit` = 마감 시뮬레이션 + 원천별 허용) · 표시 · 사전 확인 · 엄격 확인 · 차감이 같은 값 |
| I7 | 체험 크레딧 = 체험 한 번(연장 아님)에 한 번 · 달 경계에 요금제가 TRIAL 이면 양수 잔액을 남긴다 · TRIAL 을 떠날 때(전환 · 만료 · 취소) 양수 잔액 소멸 |
| I8 | 후불 초과 청구 = 주기마다 마지막 기본분의 음수(D-B) · 충전분은 건드리지 않는다 · 선불 음수 = 다음 달로 넘김 |
| I9 | E 의 입력은 그 달 안에서 바뀌지 않는다: 시간표 = 이번 달 오늘까지의 이력(미래 0 · 지난달 소급 0) · 월분 = 그 달 고정값 |
| I10 | 리셋 시각이 다음 달 1일 0시(KST) 이후 = 그 달까지 마감 줄이 그 달 날짜로 다 들어갔다(한 달씩 마감이라 참) |

### 5-2. 원장 줄 종류별 변동 (대조 워커 · 화면 · 계약 시험이 같은 표를 쓴다 · `creditTxDelta`)
| type | 기본 변동 | 구매 변동 | 비고 |
|---|---|---|---|
| `reset` 월 지급 | +amount | 0 | amount = E(M) · 0 이면 줄 없음 |
| `expire` 소멸 · 정리(신설) | amount(부호 있음) | 0 | 양수 소멸 = −잔액 · 후불 음수 정리 = +(−잔액) |
| `trial_credit` 체험 지급(신설) | +amount | 0 | |
| `plan_prorate` 요금제 변경 일할 | amount(부호 있음) | 0 | = E_after − E_before |
| `deduct` 차감 | 합 = −amount · 둘 다 ≤ 0 | | amount 0 = 후불 월말 맞춤 줄(변동 0 · overage_credits = U) |
| `refund` 환불 | 합 = +(amount − overage_credits) · 둘 다 ≥ 0 | | overage_credits = 지난 주기 부채로 갚은 양 |
| `grant` · `purchase` · `postpaid_grant` | 0 | +amount | |
| `admin_deduct` | 0 | −amount | |
- 모든 줄: 구매 잔액 ≥ 0.

### 5-3. 계약 (구현 단위)
**C1 잔액 쓰기 = CT 세 파일 · 원장 먼저 (I1 · P2 · P3 · P4)**
- 허용 파일 = `ai-credit-tx.ts` · `ai-credit-recharge.ts` · `plan-change-log.ts`. W1~W6 전부 「잠금 → (기본분 쓰기면) 월 마감 → 원장 INSERT … RETURNING(0행이면 멈춤) → 잔액 UPDATE」 순서로 바꾼다.
- 체험 3곳(W7~W9)은 UPDATE 에서 잔액 칸 · 리셋 시각 칸을 뺀다. 크레딧은 CT 두 함수만:
  - `applyTrialStart(client, companyId, credits, key)` = 월 마감 → 양수 잔액 `expire`(키 `trial-start-expire:회사:새 만료 시각`) → `trial_credit` +credits(키 `trial-credit:회사:새 만료 시각`). `basic-trial.ts` 가 **연장이 아닐 때만** recordPlanChange **뒤에** 부른다(유료 → 체험이면 일할 회수가 먼저 · 순서 반대면 회수가 체험 크레딧을 깎는다).
  - `expireTrialLeftover(client, companyId, key)` = 월 마감 → 양수 잔액 `expire`. 체험 만료 워커 · 체험 취소가 recordPlanChange **앞에** 부른다(키 `trial-end:회사:갱신 전 만료 시각` · 만료 시각이 NULL 인 상태 청소 = `trial-end:회사:cleanup:KST날짜`). recordPlanChange 도 TRIAL 을 떠나는 모든 변경에서 이력 INSERT 뒤 부른다(키 `trial-end:이력 id` · 이미 0 이하면 줄 없음) → 승인 · 슈퍼관리자 · 선불 첫 결제 등 어느 길로 체험이 끝나도 같은 규칙.
  - 재시도: fresh 아닌 부여의 재시도 = 이미 활성 체험이라 연장(크레딧 0) · fresh 부여의 재시도 = 같은 트랜잭션의 회사당 1회 기록(`diagnosis_trial_grants` UNIQUE)이 막는다 → **fresh 를 넘기는 호출부 = `marketing-diagnosis-grant.ts` 뿐**(계약 시험 R38 ④ · 넓히려면 그 호출부에 같은 1회 기록이 있어야 한다).

**C2 월 마감 · 매월 1일 지급 (P1 · R18 · I10)**
- CT 하나 `closeCreditMonths(client, companyId, lockedRow, now)`:
  - 리셋 시각 NULL = 첫 지급만: E(이번 달) `reset`(키 `reset:회사:YYYYMM` · 시각 = 지금) · 리셋 시각 = 지금. 이때 기본분 ≠ 0 이면(원장으로 설명 못 하는 잔액) 멈추고 던진다 + 경보(§9 사전 ④ = 0 확인).
  - 아니면 m = 리셋 시각의 달부터 지난달까지 차례로: ① 후불 맞춤(C8 · 줄 시각 = m 말일 끝 = 다음 달 1일 0시 − 1µs) ② `expire`(같은 시각 · 키 `expire:회사:m`): 후불 음수 → +(−잔액) · 양수 → −잔액(달 경계 요금제가 TRIAL 이면 양수는 남김) · 선불 음수 → 그대로 ③ `reset` +E(m+1)(키 `reset:회사:m+1` · 시각 = m+1 1일 0시). 끝에 리셋 시각 = 이번 달 1일 0시(KST) · 잔액 UPDATE 한 번. 경계 시각은 SQL 이 계산한다(`TIMESTAMP 'YYYY-MM-01' AT TIME ZONE 'Asia/Seoul'` · 끝 = 그 값 − 1µs · JS Date 는 ms 라 못 쓴다).
  - 키가 이미 있으면(마감한 달인데 리셋 시각이 뒤처짐 = 원장과 칸이 어긋남) 멈추고 던진다 + 경보(조용히 건너뛰지 않는다).
- 1일 패스 = 월 워커(`free-messaging-grant-worker.ts`) 선불 기간 정산 **다음**에 `grantMonthlyCreditsPass(exclude)`. 대상 = 리셋이 밀린 회사 중 (요금제 월분 NULL 아님 또는 구매분 > 0 또는 기본분 ≠ 0). 회사마다 트랜잭션 · 잠금 · 다시 판정 · 실패 = `sendSystemAlert`(회사 · 날짜 dedup · R14).
- 첫 사용 마감은 안전망(같은 함수). 발행도 같은 함수(C8).
- **시계(구현 1R 뒤 구조 규칙)**: 크레딧을 바꾸는 사건 하나 = 진입점에서 시계 한 번 · CT 끝까지 넘긴다(`recordPlanChange` 의 `now` · 체험 부여 · 만료 · 취소). 달 · 주기 판정은 그 판정 시각 · seq · 키(리셋 키 · 일할 = `plan-prorate:YYYYMM:이력 id`)로 한다. 줄 시각도 주기 순서와 같게 쓴다: 주기 시작 줄(리셋) = 리셋 시각(달 경계 · 첫 지급 판정 시각) · 마감 뒤 CT 가 쓰는 줄 = max(판정 시각 · 주기 시작 + 1µs)를 그 줄이 든 주기의 끝 − 1µs 로 자른 시각(구현 2R ~ 5R 뒤 · DB 시계는 줄 시각에 쓰지 않는다). 줄 순서 = seq(새 줄은 언제나 · 5R) · 줄 시각은 청구 달만 맡는다. 시각 비교 값은 SQL 이 µs 까지 낸 글자로 넘긴다(JS Date = ms).
- 결과: 매월 1일 0시~0시 10분 회사마다 (맞춤) · 소멸 · 지급 줄. 배포 직후 기동 패스 = 리셋이 밀린 회사만(11월은 대부분 이미 lazy 리셋 · 그 행은 그대로).

**C3 체험과 달 경계 (I7 · P5 · D-A)**
- 달 경계의 요금제(그 달 말일 기준 이력)가 TRIAL 이면 ② 에서 양수 잔액을 남긴다. 다음 달 E 는 이력이 미래를 안 담으므로 체험이 이어지는 동안 0 → 체험 잔액과 유료 지급이 섞이지 않는다(R2-4 반례 = 미래 적용일 금지로 생기지 않음).
- 체험 크레딧 = C1 `applyTrialStart` 의 양뿐(D-A).

**C4 일할 = 시간표 E 차이 (I5 · I9 · P7 · R2-2)**
- `recordPlanChange`: 적용일이 이번 달 1일 ~ 오늘(KST) 밖이면 던진다(호출부 트랜잭션 롤백 · 운영 호출부 영향 0).
- 순서(같은 advisory(plan_change) · 같은 트랜잭션): 회사 행 잠금 → **월 마감** → 이력 INSERT → (TRIAL 을 떠나면) `expireTrialLeftover` → E_after(M) → **Δ = E_after − 그 달 원장 지급 합**(그 달 `reset` 줄 + 그 달 `plan_prorate` 줄 · 5판 · Codex R3-2) → Δ ≠ 0 이면 `plan_prorate`(키 `plan-prorate:이력 id`) → 잔액. M = 오늘의 달.
- 원장 지급 합을 빼므로 그 달 합 = 언제나 마지막 E_after(마감이 어느 시간표로 줬든 · 옛 반올림 · 이력 없는 회사의 대체값이든 다음 변경에서 E 로 맞춰진다 · R2-2 반례 1,200 이중 지급 0).
- **변경 전 요금제 힌트**: 이력이 하나도 없는 회사는 첫 이력의 from_plan 이 NULL 이라 변경 전 날들의 권리가 0 이 된다 → 호출부가 UPDATE 전에 본 plan_id 를 `prevPlanIdHint` 로 넘기고, 이력이 없을 때만 첫 이력의 from_plan 으로 쓴다(이력이 있으면 무시 · 회사 생성은 없음이 맞다).
- 지금의 「체험 건너뜀」(`plan-change-log.ts:213-216`)과 변경마다 반올림(`planChangeCreditDelta`)을 지운다.

**C5 이력 화면 = 원장 뜻 함수 하나 (P9 · P11)**
- `creditTxDelta(tx)` = §5-2 표(백엔드 `ai-credit-calc.ts` · 프론트 `constants/credit.ts` 같은 표 · 계약 시험이 두 표를 대조). 두 화면 부호 · 숫자는 이 함수만.
- 이름표: `plan_prorate` 「요금제 변경 일할」 · `expire` 「남은 기본분 소멸」(+ 방향 = 「초과 사용 청구로 정리」) · `trial_credit` 「무료체험 크레딧」 · 원천 `month-end-overage` 「초과 사용 정산」.
- 목록 순서 = `created_at DESC, seq DESC NULLS LAST`(seq 준비 확인 후).

**C6 분석 차감 실패 경보 (P10)**
- 회사 하나가 계산 · 차감에 실패하면 `sendSystemAlert`(회사 · 날짜 dedup · 사내 회사 거름 R25). 이에스 원인 = 데이터(B-1101-5 · 처방 끝).

**C7 남은 크레딧 = 함수 하나 (I6 · P6)**
- `projectCredit(db, row, now)` = 월 마감을 쓰기 없이 계산(같은 순수 함수 `simulateClose` · 밀린 달 E 는 같은 `monthEntitlement` 를 읽기 모드로). 표시(`getCreditState`) · 엄격 확인(`hasCreditForStrict`) · 사전 확인(`checkCredit`)이 이것만.
- `checkCredit(companyId, cost, source = 'ai-generic')` 허용 = `creditOverageAllowance(row, source)`(원천 생략 51곳 = 지금 결과 · 발송 원천만 0).

**C8 후불 월말 맞춤 · 발행 (I8 · P8 · D-B)**
- C2 ① (후불만 · 회사 행 잠금 안): b = 그 시점 기본분 · R = 그 주기 차감 행 초과분 합(청구된 것 포함). 주기 = 그 주기 `reset` 줄 뒤(seq · 그 줄과 차감 줄이 다 seq 를 가지면 seq 비교 · 아니면 created_at ≥ 리셋 시각). U = max(0, −b) − R.
  - U > 0 → `deduct` amount 0 · overage_credits U · source `month-end-overage` · 키 `overage-settle:회사:m` · 시각 m 말일 끝 → 청구 쿼리 세 곳은 그대로 잡는다.
  - U < 0 → 그 주기 **미청구** 차감 행 초과분을 최근 것부터 −U 만큼 줄인다(`billed_billing_id IS NULL`). 청구된 것 때문에 다 못 줄이면 경보(사람 처리 · 크레딧으로 바꿔 주지 않는다).
  - 충전분은 건드리지 않는다.
- **발행이 마감을 먼저 한다**: `issueBilling` · `issueMinimumChargeBilling` 이 발행 트랜잭션 **전에** 그 회사 월 마감을 짧은 자기 트랜잭션으로 돌린다(`closeCreditMonthsNow(회사)` · 1일 패스가 실패한 회사도 발행 순간 닫힌다). 발행 트랜잭션 안(정산 잠금 뒤 · 초과분 읽기 전)에서는 **청구 기간에 말일이 든 달마다 리셋 시각 ≥ 그다음 달 1일 0시** 를 확인만 하고 아니면 422(「크레딧 월 마감 전」). 마감을 발행 트랜잭션 안에서 하지 않는 이유 = 회사 행을 FOR UPDATE 로 올리면 그 회사를 가리키는 모든 외래키 넣기(FOR KEY SHARE)가 발행이 끝날 때까지 막힌다(정산 잠금이 NO KEY UPDATE 인 이유). 리셋 시각은 앞으로만 가므로 확인과 발행 사이에 풀리지 않는다.
- 미리보기는 쓰지 않는다(1일 0시 10분 뒤에는 마감이 끝나 같은 값 · 그 전 = 아직 안 끝난 달).
- **환불(W3) = 자기 차감 행의 역 · 구성 셋으로**(5판 · Codex R3-1): 원 차감 행과 그 직전 행(seq · 없으면 지금 규칙)으로 차감 때 구성을 다시 계산한다 = 기본분 몫 `fromBase = min(max(0, 직전 기본분), amount)` · 구매분 몫 `fromPurchased = 직전 구매분 − 원 행 구매분` · 초과 몫 `shortfall = amount − fromBase − fromPurchased` · 검사 = 직전 기본분 − 원 행 기본분 = fromBase + shortfall(맞지 않으면 지금의 bucket 규칙으로 폴백). 되돌림: 구매분 몫 → 구매분(언제나 · 지금 기본분이 음수여도) · 기본분 몫 → 기본분 · 초과 몫 → 원 행의 지금 미청구 초과분만큼 부채 취소(후불 · 지난 주기 = 잔액에 안 넣음 · 같은 주기 = 기본분으로 되메움) · 나머지 초과 몫 → 기본분. 환불 행 `overage_credits` = 지난 주기 부채 취소분. 맞춤 줄은 건드리지 않는다.
- amount 0 차감 · 새 type = 들어간다(원장 표 CHECK 0 · §9 ③).

**C9 원장 순번 · 대조 워커 (I2 · I3 · I4 · P11 · P12)**
- DDL = `seq`(§7). 넣는 쪽은 기본값.
- 대조 = 매일 04:30 KST 한 번(월 워커 패스 날짜 가드). 회사마다 REPEATABLE READ READ ONLY 에서 seq 있는 줄을 차례로 읽어 I3 · I4 · 구매 ≥ 0 → 어긋나면 `sendSystemAlert`(회사 · 날짜) · 고치지 않는다. 첫 seq 줄 = 기준점. seq 칸이 없으면 하루 한 번 경고만.

**C10 요금제 월 크레딧 = 그 달 고정 (I9 · P13 · P14 · R2-6)**
- 표 `plan_month_credits(month, plan_code, credits)`. `monthCredits(client, M)` = 그 달 행이 없는 요금제를 지금 `plans` 값으로 넣고(ON CONFLICT DO NOTHING) 읽는다 · 읽기 모드(C7)는 넣지 않고 같은 값을 계산.
- 요금제 수정에서 월 크레딧이 바뀌면 한 트랜잭션: **아직 닫히지 않았을 수 있는 달 전부(회사 리셋 시각 중 가장 이른 달 ~ 이번 달 · 최대 24달)** 고정값을 바꾸기 전 값으로 먼저 넣기 → UPDATE · 응답 「월 크레딧은 다음 달 1일부터」(5판 · Codex R3-3 · 밀린 달을 나중에 닫아도 그 달 값 = 수정 전 값). **표가 없으면 월 크레딧 수정을 503 `DB_MIGRATION_PENDING` 으로 거절**(값이 못 바뀌므로 표 없는 동안 E 는 `plans` 값 그대로가 곧 고정값 · R2-6 반례 0).
- 요금제 추가 = 월 크레딧(0 이상 정수) 필수(화면 `PlanCreateModal` 칸 추가).

**C11 선불 새 회사 1일 맞춤 (P15 · D-C · Harold 1101 「새 회사만 1일 맞춤」)**
- 첫 결제 · 다시 열기(잠김 뒤 · 1개월 연장으로 다시 여는 경우 포함) = 오늘 ~ 그달 말일 · 금액 = 월 공급가 × 남은 일수(오늘 포함) ÷ 그달 일수(원 미만 내림 · `monthlyCharge` 와 같은 부가세 규칙) → 다음 연장부터 1일(`periodEnd(1일)` = 그달 말일).
- 연장(만료 다음 날부터 한 달) · 예약 = 지금 그대로. 이미 결제일 기준으로 도는 회사(이에스 2일)는 그대로.
- 올림 차액의 하루치 분모(`denomOfDay`) = 그날을 산 구매가 **한 달 안에서 말일까지**(일할 구매)면 그 달 일수 · 아니면 지금처럼 구매 구간 일수(결제일 기준 한 달 · 1일~말일은 둘이 같다). 일할로 산 구간을 구간 일수로 나누면 하루치가 부풀어 차액을 더 받는다(16일치를 산 회사의 하루치 = 월 요금 ÷ 30 이지 ÷ 16 이 아니다).
- 크레딧 = 같은 날 recordPlanChange 의 E 차이(일할) → 돈과 크레딧이 같은 날짜로 일할된다.
- 문구: 「이번 달 남은 N일 요금 X원(부가세 포함)을 차감했고 그달 말일까지 이용합니다 · 다음 달부터 매월 1일 Y원」.

### 5-4. 새 뿌리 R38 「크레딧 잔액은 원장 CT 만 · 원장 먼저 · 모든 변동 = 원장 한 줄 · 매일 대조」
- 계약 시험(소스에서 기계로): ① 잔액 칸 대입 · INSERT 칸을 가진 파일 ⊆ C1 허용 세 파일 ② `INSERT INTO ai_credit_transactions` 의 type 글자 ⊆ §5-2 표 = 백엔드 `creditTxDelta` 표 = 프론트 이름표 · 표 ③ 허용 파일의 함수마다 잔액 UPDATE 앞에 같은 함수의 원장 INSERT ④ `fresh: true` 호출부 ⊆ {marketing-diagnosis-grant.ts} ⑤ 발행 코어 두 곳이 정산 잠금 뒤 월 마감을 부른다 ⑥ 프론트 `.tsx` 에서 원장 type 글자 비교 0.
- 넓힘: R1(남은 크레딧 · 일할 · 월분 · 화면 부호 = 함수 하나) · R14(회사를 도는 워커의 회사별 실패 = 경보) · R18(지급 원장 시각 = 권리가 생긴 때).

## 6. 영향표 (전 경로)
| 경로 | 지금 | 바뀐 뒤 | 소비처 · 확인 |
|---|---|---|---|
| 적재 · 월 지급 | 첫 사용 · 지금 요금제 월분 · 소멸 줄 없음 | 1일 패스 + 안전망 + 발행 · 한 달씩 마감 · E · 맞춤 · 소멸 · 지급 줄 | 이력 두 화면(C5) · 월 사용량 `ai-credit.ts:505`(deduct · refund 만 · 맞춤 줄 0) |
| 적재 · 체험 | 원장 없음 · 빚 지움 | 마감 → `expire` · `trial_credit` · 빚 그대로 | `basic-trial.ts`(승인 · 회사 생성 · 슈퍼관리자 · 진단 · 플랜 변경 체험) · 체험 워커 · 체험 취소 |
| 수정 · 요금제 변경 | 변경마다 반올림 · 체험 건너뜀 · 미래 · 소급 적용일 허용 | 마감 → E 차이 · TRIAL 떠나면 소멸 · 적용일 이번 달 오늘까지 | `recordPlanChange` 호출 9곳(함수 안만 · 적용일 전부 오늘) |
| 수정 · 요금제 관리 | 월 크레딧 아무 때나 · 추가 때 NULL | 이번 달 고정 뒤 수정 · 표 없으면 거절 · 추가 때 필수 | `admin.ts:2773 · 2801` · `PlanCreateModal` · `PlanEditModal` |
| 수정 · 선불 첫 결제 | 오늘부터 한 달 · 한 달 값 | 오늘 ~ 말일 · 일할 값 → 1일 연장 | `plan-term.ts` purchase(first_charge · restore · extend 다시 열기) · 승인 응답 문구 |
| 조회 · 표시 | J1 | `projectCredit` | `/my-credit` · 슈퍼관리자 회사 상세 · 대시보드 크레딧 띠 |
| 사전 확인 | J1 + 후불 한도 | 같은 함수 · 원천 기본 일반 AI | `checkCredit` 호출부(시그니처 하위 호환) |
| 차감 · 환불 | 잔액 먼저 · 직전 행 = created_at | 원장 먼저 · 직전 행 = seq · 환불 행 overage_credits | W2 · W3 호출부 전부(함수 안만) |
| 집계 · 정산 | 차감 행 초과분 · 마감 없음 | 같은 쿼리 + 맞춤 행 · 발행이 마감을 먼저 | `issueBilling` · `issueMinimumChargeBilling`(일괄 발급은 `issueBilling` 을 부른다) · 미리보기 변경 0 |
| 원장 키 읽기 | 차감 키 판정 다수 | 새 키 꼴 `expire:` `trial-start-expire:` `trial-credit:` `trial-end:` `overage-settle:` = 차감 키와 안 겹침 | `FROM ai_credit_transactions` 파일 전수(구현 때 줄마다) |
| 워커 | 분석 실패 = 경고 | 경보 · 1일 패스 · 대조 | `predictive-worker.ts` · `free-messaging-grant-worker.ts` |
| 화면 | 부호 두 벌 · 이름 빠짐 | 함수 하나 | `CreditsTab.tsx` · `CreditHistoryModal.tsx` |

## 7. DDL (DDL-1 = 배포 **앞** · DDL-2 = 배포 뒤 · `lock_timeout` = 정지 예산 · 둘 다 추가만)
```sql
SET lock_timeout = '3s';
CREATE SEQUENCE IF NOT EXISTS ai_credit_tx_seq;
ALTER TABLE ai_credit_transactions ADD COLUMN IF NOT EXISTS seq bigint;
ALTER SEQUENCE ai_credit_tx_seq OWNED BY ai_credit_transactions.seq;
CREATE TABLE IF NOT EXISTS plan_month_credits (
  month      date        NOT NULL,
  plan_code  varchar(20) NOT NULL,
  credits    integer     NOT NULL CHECK (credits >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (month, plan_code)
);
```
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_credit_tx_company_seq ON ai_credit_transactions (company_id, seq);
```
- seq 는 **기본값 없음**. 새 코드가 원장 INSERT 마다 `nextval`(`LEDGER_SEQ_SQL`)로 채운다 → 새 줄은 언제나 seq · 옛 코드 줄은 seq 없음(= 옛 행 · 테이블 다시 쓰기 0) · 대조 기준점 = 회사별 첫 seq 줄이라 옛 행의 옛 뜻(리셋 amount = 총량)은 검사하지 않는다.
- 순서 = **DDL-1 → 배포 → DDL-2**(구현 5R 구조 처방). DDL-1 은 의미를 바꾸지 않는다(칸 · 표 추가만 · 옛 코드는 이 칸 · 표를 읽지도 쓰지도 않는다 · 기본값이 없어 옛 코드 줄은 seq 를 안 받는다) → 메모리 「마이그레이션은 배포 뒤」(의미를 바꾸는 이전)의 대상이 아니다. 배포 앞에 넣어야 새 코드 줄에 seq 없는 창이 생기지 않는다(그 창이 줄 시각으로 순서를 흉내 내다 구현 2R · 3R · 5R 반례를 낳았다).
- DDL-1 없이 새 코드가 뜨면 원장 INSERT 가 칸 없음으로 실패한다(차감 · 지급이 멈추고 크게 드러난다 · 조용히 seq 없는 줄을 쓰지 않는다).
- 되돌리기: `DROP INDEX CONCURRENTLY ai_credit_tx_company_seq; ALTER TABLE ai_credit_transactions DROP COLUMN seq; DROP SEQUENCE ai_credit_tx_seq; DROP TABLE plan_month_credits;`
- DDL 뒤 확인 = `information_schema.columns`(seq) · `information_schema.tables`(plan_month_credits) 각 1행.

## 8. 시험
- 계약(root-ledger R38 ①~⑥) · R1 · R14.
- 단위(순수): `simulateClose`(선불 · 후불 × 양수 · 음수 × 체험 경계 · 밀린 달 2개 · NULL 첫 지급) · `monthEntitlementFrom`(P7 542 · 같은 날 두 번 · 유료 → 체험 → 유료 · 이력 없음 · 첫 이력 전 = from_plan · P14 반례 525) · 맞춤(U > 0 · U < 0 · 청구된 초과 때문에 못 줄임) · 환불 행 overage_credits(같은 주기 0 · 지난 주기 = 부채 취소분) · `creditTxDelta` 표 · 대조 검사(줄마다 + 어긋난 줄) · 선불 첫 결제 일할 금액(1일 = 한 달 값 · 말일 = 하루).
- 실 PG(test:pg): 월 마감 트랜잭션(한 달 · 두 달 밀림) · 1일 패스 대상 SQL · 체험 시작 · 끝 · recordPlanChange 순서(마감 → E_before → 이력 → E_after) · 발행 안 마감 · `monthCredits` 동시 넣기 · 대조 스냅숏 SQL · seq 없는 상태(DDL 전) 폴백.
- 변이(파일 복사): 허용 파일 밖 잔액 쓰기 · 원장 INSERT 를 UPDATE 뒤로 · 이름표에서 type 하나 빼기 · 변경마다 반올림으로 되돌리기 · 마감에서 한 달 건너뛰기 · 맞춤 끄기 · 발행 마감 빼기 · fresh 호출부 하나 더 → 각각 빨간불.
- 전체: backend tsc · frontend tsc · backend vitest 전체 · test:pg.
- Codex 적대 리뷰: 설계 4판 → 구현 각각 approve 까지.

## 9. 실측
**사전 SQL(배포 전 · 읽기 전용)**: ① 이력 0 인 회사 수(I5 폴백 대상) ② 이번 달 적용일이 미래 · 지난달인 이력 행 수(0 이어야 C4 가 운영과 맞음) ③ 후불 회사 11월 초과 차감 중 그 회사 11월 리셋 줄보다 created_at 이 앞선 행(0 이어야 12/1 첫 맞춤의 created_at 폴백이 정확) ④ 리셋 시각 NULL 인데 기본분 ≠ 0 인 회사(0 이어야 C2 첫 지급 규칙이 맞음). ⑥ ~ ⑧(1101 ① ~ ⑤ 실행에서 ② 소급 141 이 나와 추가 · ② SQL 은 전 기간을 세어 이번 달 행을 가르지 못한다): ⑥ 소급 행을 기록한 날(KST)별 수 · 그 회사 첫 행이 아닌 수(전부 0 · 11월 날짜 줄 0 이어야 함) ⑦ 뒤에 쓴 행이 앞 행보다 이른 적용일인 행(0 이어야 이력 순서 = 쓴 순서) ⑧ 이력 마지막 요금제 ≠ 지금 요금제인 회사(0행 이어야 함 · 이력이 있는 회사는 크레딧을 이력으로만 센다 · ① = 0 이라 전 회사).
```sql
-- ① 이력 0 인 회사
SELECT count(*) FROM companies c WHERE NOT EXISTS (SELECT 1 FROM company_plan_changes h WHERE h.company_id = c.id);
-- ② 적용일 ≠ 기록한 날(KST) 인 이력 행(미래 · 소급 기록 흔적)
SELECT count(*) FILTER (WHERE effective_date > (changed_at AT TIME ZONE 'Asia/Seoul')::date) AS future_rows,
       count(*) FILTER (WHERE effective_date < (changed_at AT TIME ZONE 'Asia/Seoul')::date) AS backdated_rows
  FROM company_plan_changes;
-- ③ 후불(선불이 아닌 회사 전부 · 빈 값 포함 · billedMonthly) 11월 리셋 전 초과 차감
SELECT c.company_name, count(*) AS early_overage_rows
  FROM ai_credit_transactions t JOIN companies c ON c.id = t.company_id AND c.billing_type IS DISTINCT FROM 'prepaid'
  JOIN ai_credit_transactions r ON r.company_id = t.company_id AND r.type = 'reset' AND r.idempotency_key LIKE 'reset:%:202611'
 WHERE t.type = 'deduct' AND t.overage_credits > 0 AND t.created_at >= '2026-11-01 00:00:00+09' AND t.created_at < r.created_at
 GROUP BY 1;
-- ④ 리셋 시각 NULL · 기본분 ≠ 0
SELECT count(*) FROM companies WHERE ai_credits_reset_at IS NULL AND COALESCE(ai_credits_base_remaining, 0) <> 0;
-- ⑤ 결제 방식 값 분포(빈 값 · 그 밖 글자 = 월 마감은 후불로 읽고 추가 사용 한도 · 충전은 막힌다 · 있으면 값부터 정한다)
SELECT COALESCE(billing_type, '(빈 값)') AS billing_type, count(*) FROM companies GROUP BY 1 ORDER BY 1;
-- ⑥ 소급 행을 기록한 날(KST)별 수 · 그 회사 첫 행이 아닌 수
SELECT (b.changed_at AT TIME ZONE 'Asia/Seoul')::date AS recorded_on,
       count(*) AS backdated_rows,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM company_plan_changes a
                                       WHERE a.company_id = b.company_id AND a.changed_at < b.changed_at)) AS not_first_row
  FROM company_plan_changes b
 WHERE b.effective_date < (b.changed_at AT TIME ZONE 'Asia/Seoul')::date
 GROUP BY 1 ORDER BY 1;
-- ⑦ 뒤에 쓴 행이 앞 행보다 이른 적용일인 행
SELECT count(*) AS misordered
  FROM company_plan_changes b
 WHERE EXISTS (SELECT 1 FROM company_plan_changes a
                WHERE a.company_id = b.company_id AND a.changed_at < b.changed_at AND a.effective_date > b.effective_date);
-- ⑧ 이력 마지막 요금제 ≠ 지금 요금제인 회사
SELECT c.company_name, p.plan_code AS now_plan, h.to_plan_code AS history_plan
  FROM companies c
  LEFT JOIN plans p ON p.id = c.plan_id
  LEFT JOIN LATERAL (SELECT x.to_plan_code FROM company_plan_changes x WHERE x.company_id = c.id
                      ORDER BY x.effective_date DESC, x.changed_at DESC LIMIT 1) h ON true
 WHERE p.plan_code IS DISTINCT FROM h.to_plan_code
 ORDER BY 1;
```
### 9-1. 이에스 분석 진단 기록 (B-1101-5 · Harold 1101 실행)
- ③ 원장 표 제약 = 시험 그릇(`t_tpl_closed` · 운영 정의 대조 덤프)에서 type · amount CHECK 0 · `amount integer NOT NULL` · `created_at DEFAULT now()` · seq 없음(1101).
- ④ 요금제 월 크레딧(운영): FREE 0 · STAFF 16,500 · TRIAL 750 · STARTER 300 · BASIC 750 · PRO 2,400 · BUSINESS 7,800 · ENTERPRISE 16,500(활성 8 · NULL 0 → P13 = 새로 만들 때만 · P5 TRIAL 750 확인) ⑤ 이에스 예측 429,506행 · 마지막 10-06 09:06 ⑥ 오류 Key 고객 = id 로 0행.
- ⑦ 고객 삭제 감사 기록 0건 · 고객 표 지우기 누계 0(통계는 마지막 복구 시작부터).
- ⑧ DB 시작 10-08 15:57 · fsync · full_page_writes on · data_checksums off · 고객 표 386 MB · 기본키 색인 조회 0 · 순차 읽기 1행 → 본체와 색인 어긋남 확정.
- ⑨ 그 고객 예측 0 · 본체 id 중복 0 · 전체 고객 표에서 기본키 색인으로 못 찾는 행 = 1행(이에스) · 고아 예측 SQL 은 병렬 해시 공유 메모리 부족으로 실패(§14 범위 밖).
- ⑩(병렬 끔) 고아 예측 전체 1 = 진짜 id `d65ae273-f184-4c97-…`(0x97 ↔ 본체 0xd7 · 1비트 · 10-06 09:06) · 진짜 id 색인 조회 = 본체 행 같은 ctid (9786,30) → 저장된 id 1비트 변형 확정.
- ⑪ 고객 id 칸 19곳(외래키 13 · 없는 6) 진짜 id = 예측 1 · `cdp_identity_links` 1 · `customer_stores` 1 · 바뀐 id = 0 → 고칠 것 = 고객 표 1행.
- ⑫ 처방 = 한 트랜잭션(ON_ERROR_STOP · lock_timeout 3초 · 색인 끈 순차 찾기 FOR UPDATE 로 ctid → 색인 켜고 ctid · 바뀐 id 조건 UPDATE) → UPDATE 1 · 새 ctid (9786,10) · 확인 4개 정상 · 「지금 실행」13:40:49 = reset 300 · predictive-daily 9(→ 291). 되돌림 = 커밋 뒤 반대 방향은 진짜 id 를 3곳이 가리켜 외래키가 막는다(진짜 id 가 맞다는 증거) · 매일 03:00 백업.

**배포 뒤**: ① 기동 패스: 리셋이 밀린 회사의 지급 줄 · 경보 0 ② DDL 확인 ③ 다음 9시대: 분석 차감 줄 · 실패 경보 0 ④ 첫 04:30 대조: 경보 0 · 「대조 N곳 · 어긋남 0」 ⑤ 12/1 0시 10분 뒤: 12월 지급 줄 = 대상 수 · 후불 회사 리셋 시각 12월 · 맞춤 줄(있으면) ⑥ 새 선불 첫 결제가 생기면 그 이벤트 covers_to = 그달 말일.

## 10. 배포 순서
업무시간 밖 · 사전 SQL(§9 · C90-S1) → **DDL-1(§7 · 배포 앞)** → DDL-1 확인 → 커밋 · 푸시 → 백엔드 · 프론트 한 번에(빌드 = `npm run build:safe`) → 재기동 → 기동 패스 확인 → DDL-2(색인 · 단독) → 다음 04:30 대조 → 다음 9시대 분석. 배포 달(11월)만의 차이: 배포 전 11월 안에서 요금제가 바뀐 회사는 그 변경이 옛 반올림으로 들어가 11월 합이 E 와 1까지 다를 수 있다(12월 1일 지급부터 0) · 그런 회사 수 = `SELECT count(DISTINCT company_id) FROM company_plan_changes WHERE effective_date >= '2026-11-01';`

**실제 배포 경위(1101)**: C90 이 C89 커밋 d6e05ff5(18:43)에 함께 실려 DDL-1 보다 먼저 배포됐다(공용 작업 트리). 18:48:33 ~ 18:49:05 기동 패스 = 마감 56(원장 줄 쓸 일 없는 선불 지급 0) · 실패 85(전부 seq 칸 없음 · 회사마다 경보 1통) · 원장 대조는 seq 칸 확인에서 건너뜀(경보 0). 그 뒤 C89 세션 안내로 DDL-1 → 18:58:02 패스 = 마감 85 · 실패 0 · 남은 대상 0(Harold 실측) · DDL-2 유효. 그 사이 다른 크레딧 경로(AI 차감 = [CREDIT][MISS] 줄이 반드시 남는 경로 · 환불 · 충전 · 요금제 변경 · 체험)의 seq 오류 로그 0줄 → 고객 쪽 실패 기록 0 · 남은 영향 = 경보 문자 · 마감 10분 늦음. 후속 = 경보 한 주기 1통 · 배포 앞 DDL 남음 = 배포 멈춤(설계안 · Harold 동의 대기).

## 11. Harold 결정
- **D-A 체험 크레딧** = 체험 한 번에 한 번(추천안으로 진행 · Harold 1101 「전부 결함 닫고」).
- **D-B 후불 초과** = 주기 마지막 기본분 기준 맞춤(추천안으로 진행).
- **D-C 선불 결제일** = 새 회사만 1일 맞춤(Harold 1101 선택) · 이에스 = 그대로(Harold 1101 「그냥 냅두고」).

## 12. 구조체크 진행표
| 회차 | 결함 | 처방 |
|---|---|---|
| 1(1판 → 2판) | SC1 1판은 소멸을 원장에 안 적는 지금 방식 그대로(P3) → 원장 합으로 잔액을 설명 못 함 | `expire` 신설 · §5-2 |
| 1 | SC2 1판은 리셋 「잔액 먼저 · 원장 DO NOTHING」 순서를 그대로 둠(P4) | C1 원장 먼저 |
| 1 | SC3 1판 체험 CT 는 「기본 = 새 값」 덮어쓰기라 선불 음수 빚을 없앰(지금 W7~W9 와 같음) | C1 start · end = 양수만 소멸 · 음수 그대로 |
| 1 | SC4 1판에 남은 크레딧 판정 세 벌(P6)이 없음 | C7 |
| 1 | SC5 1판은 변경마다 반올림(P7)을 「바꾸지 않음」으로 둠 | C4 시간표 E |
| 1 | SC6 1판은 후불 회수 음수 미청구 · 올림 뒤 초과 과청구(P8)를 못 봄 | C8 · D-B |
| 1 | SC7 1판에 두 진실 대조 워커(6원칙 ③) · 원장 순서(P11) 없음 | C9 · §7 seq |
| 1 | SC8 1판 R38 은 쓰기 파일만 봄 · 원장 먼저 순서 · type ⊆ 화면 이름표를 안 봄 | §5-4 ②~④ |
| 1 | SC9 1판 D5 원인 미상 | 로그로 외래키 위반 확정(§2-2) · 남은 것 = §9 ⑥(오류 상세 Key) |
| 2(2판 첫 글 → 코드 대조) | SC10 P6 에 「체험 회사도 화면 · 차감이 갈린다」고 적음 ↔ 지금 코드는 체험도 J1 · J3 가 같은 750(어긋남은 선불 빚 · 발송 원천 두 경우) | P6 글 정정 |
| 2 | SC11 체험 CT 가 월 리셋 없이 잔액을 바꿈 → 지난달 후불 음수 맞춤 · 소멸이 체험 사건에 묻힘 · 체험 UPDATE 가 리셋 시각을 지금으로 덮어 그 달 리셋이 사라짐 | I1 끝 문장 · C1 공통 · 체험 UPDATE 에서 리셋 시각 칸도 뺌 |
| 2 | SC12 C8 의 「그 달」 = 리셋이 몇 달 밀리면 어느 달인지 없음 | 「직전 리셋 이후」 · 날짜 = 이번 달 1일 0시 직전 |
| 2 | SC13 1일 패스 대상이 「월분 > 0 또는 기본 ≠ 0」뿐 → 기본 0 인 후불(초과 뒤 올려 0 이 된 회사)의 초과 맞춤이 빠짐 | C2 대상(3판 = 후불 전부) |
| 2 | SC14 C8 이 발행과의 경합을 안 적음 · advisory 를 잡으면 행 → advisory 와 발행의 advisory → 행이 엇갈림 | C8 잠금 줄(회사 행으로 직렬화 · advisory 안 잡음) · 확인 = `billing-lock.ts:32-37` |
| 2 | SC15 고객 창 「기본 제공」에 `trial_credit` 을 더하면 체험 → 유료 회사의 이번 달 값이 소멸된 체험분까지 셈 | C5 = `reset` + `plan_prorate` · 체험 요금제만 「체험 제공」 |
| 2 | SC16 맞춤 줄(type deduct · 원천 `month-end-overage`)의 이름표가 없어 「AI 작업」으로 보임(`constants/credit.ts:221`) | C5 원천 이름표 |
| 2 | SC17 1일 패스 실패가 월 워커 바깥 catch 한 줄(`free-messaging-grant-worker.ts:58-60`)로 끝남 = P10 과 같은 꼴 | C2 회사별 실패 = 경보 |
| 3(2회차 처방 반영본 → 코드 대조) | SC18 C4 가 체험 시작 · 만료 일할 건너뛰기를 그대로 둠 → 유료 → 체험이면 남은 유료 날 회수가 없음 | C4 = 모든 변경 · 건너뛰기 삭제 · 순서 |
| 3 | SC19 C8 이 후불 음수를 그대로 청구 → 충전분을 두고 초과 청구 | (2판) `cover` 신설 → **Codex 1R 이 그 장치의 이중 회수 · 환불 소실을 잡음 → 3판에서 장치 삭제**(§13 R1-1 · R1-2) |
| 3 | SC20 P2 결과에 「체험 부여 · 만료가 선불 빚을 지운다」가 빠짐 | P2 글 |
| 3 | 확인한 것 = 충전 · 관리자 조정은 리셋 없이 원장 잔액 = 저장 칸 → I3 성립 · 발행 · 크레딧 잠금 축 · 체험 경로 넷이 체험 CT 한 길 · `seq` 기본값 = 잠금 안 INSERT 시각의 순서 | 없음 |
| 4 | 0: 2판 전체를 코드 줄에 다시 대 봄 | 없음 |
| 5(Codex 1R 반영본 → 코드 대조) | SC21 발행 가드가 「리셋 시각 < 다음 달 1일」로 막는데, 1일 패스 대상이 E · 기본분 · 초과분이 없는 후불(미가입 후불 등)을 빼면 그 회사 리셋 시각이 안 넘어가 발행이 영영 막힘 | C2 대상 = 후불 전부(줄 없어도 리셋 시각만) |
| 5 | SC22 요금제 수정이 월 크레딧을 바꾼 뒤 그 달 처음 쓰는 회사는 새 값을 그 달 값으로 고정해 버림(그 달 고정표에 그 요금제 행이 아직 없으면) → 「다음 달부터」가 거짓 | C10 = 수정 트랜잭션에서 바꾸기 **전에** 이번 달 고정값을 먼저 넣음 |
| 5 | SC23 체험 end 키의 만료 시각은 강등 UPDATE 가 NULL 로 지운 뒤에는 읽을 수 없음(`trial-downgrade-worker.ts:127`) | C1 키 = 갱신 전 값 |
| 5 | SC24 「적용일이 다음 달 이후인 변경」의 지급 책임이 없음(Codex R1-3) · W1 지급이 지금 요금제 월분이라 시간표와 갈림 | I5 · C2 ③ = E(M) · C4 둘째 줄 |
| 5 | 확인한 것 = 운영 코드에서 미래 적용일을 넘기는 곳 0(`plan-term.ts:305` = 오늘) · 요금제 월 크레딧 쓰기 = `admin.ts:2773 · 2801` 둘뿐 · 환불의 지난 주기 부채 취소 = `ai-credit-tx.ts:367-376` · 원장 표 CHECK 0(시험 그릇) | 없음 |
| 6 | 0: 3판 §3~§10 의 파일 · 줄과 반례 숫자(541 · 542 · 547 · 305 · 675)를 다시 코드와 계산에 대 봄 | 없음 |
| 7(4판 → 코드 대조) | SC25 지난 주기 환불 나머지를 「지금 기본분으로」라고만 적음 ↔ 지금 코드(`ai-credit-tx.ts:378-419`)는 구성분대로 복원 | 4판 C8 = 자기 차감의 역(지금 규칙) + 환불 행 overage_credits · 3판 확장 규칙 삭제(Codex R2-1 과 같은 뿌리) |
| 7 | SC26 발행 트랜잭션 안에서 마감하면 회사 행이 NO KEY UPDATE → FOR UPDATE 로 올라가 그 회사를 가리키는 외래키 넣기(FOR KEY SHARE)가 발행 내내 막힘 | 마감 = 발행 전 짧은 자기 트랜잭션 · 발행 안 = 말일 든 달 리셋 시각 확인만(C8) |
| 7 | SC27 리셋 시각 NULL 인데 기본분 ≠ 0 이면 첫 지급이 설명 못 하는 잔액 위에 E 를 더함 | 멈추고 경보 · 사전 SQL ④ |
| 7 | SC28 경계 시각(말일 끝 = 1일 0시 − 1µs)을 JS Date(ms)로는 못 만든다 | SQL 이 계산(C2) |
| 7 | SC29 상태 청소(만료 시각 NULL) 체험 끝의 키가 없음 | `trial-end:회사:cleanup:KST날짜` |
| 7 | SC30 자정을 넘긴 선불 정산 패스가 어제 날짜로 recordPlanChange 를 부르면 적용일 검사가 던짐(달 경계) | 그 회사 트랜잭션 통째 롤백(돈 포함) · 10분 뒤 패스가 오늘 날짜로 다시 · 기록만 |
| 7 | SC31 3판 §9 ② SQL(미래 적용일을 now() 로 셈)은 소급 기록을 못 봄 | 적용일 ≠ 기록한 날(KST) 으로 셈 |
| 7 | SC32 C11 일할 첫 결제 구간을 올림 차액이 구간 일수로 나눔(`plan-term-calc.ts:84-90` denomOfDay) → 하루치 부풀림 | 일할 구매(같은 달 · 말일까지) 분모 = 그 달 일수(C11) |
| 8(5판) | SC33 E_before(시간표)는 이력 없는 회사 · 옛 반올림 · 마감 대체값과 어긋날 수 있다 | Δ = E_after − 그 달 원장 지급 합(C4) · 그 달 합 = 마지막 E 가 원장으로 성립 |
| 7 | 확인한 것 = 요금제 변경 호출 9곳의 적용일 = 전부 오늘(생략 = `todayKst()` · `plan-term.ts:305` = 패스 기준일) · fresh 호출 = `marketing-diagnosis-grant.ts:103` 하나(같은 트랜잭션 `diagnosis_trial_grants` INSERT · UNIQUE) · 체험 부여 = 연장이면 기본분 그대로(`basic-trial.ts:139`) · 발행 코어 = `issueBilling` · `issueMinimumChargeBilling`(일괄 발급은 앞의 것을 부름) · 선불 첫 결제 · 다시 열기 = `purchase(coversFrom = 오늘)` 두 곳 + 연장의 다시 열기(`plan-term.ts:506`) | 없음 |

## 13. Codex 진행표
| 라운드 | 지적 | 판정 · 처방 |
|---|---|---|
| 1R needs-attention | R1-1 high · C8 `cover` 가 이미 청구된 초과분에도 구매분을 소비(기본 −100 · 구매 100 · R 100 청구됨 → 청구 100 + 구매 100) · 발행이 리셋보다 먼저 끝나는 순서를 행 잠금이 막지 않음 | 수용 · 뿌리 = `cover` 장치(R1-2 · R1-5 와 같은 뿌리 · 구조를 지운다) · C8 에서 삭제 · 충전분 불변 · 발행 가드 신설 |
| 1R | R1-2 high · `cover` 뒤 환불이 구매분을 소멸 가능한 기본분으로 복원 | 수용 · 같은 뿌리 · `cover` 삭제로 닫힘 · 환불 「직전 행」 = seq(C9) |
| 1R | R1-3 high · 다음 달 적용 예약 변경이 월초 지급에 안 들어감(12/1 750 지급 vs 권리 547) | 수용 · 뿌리 = 지급이 시간표가 아니라 지금 요금제 · I5 · C2 ③ = E(M) · C4 |
| 1R | R1-4 high · 1일 리셋 뒤 월 크레딧을 바꾸면 누적이 어긋남(375 vs 675) | 수용 · 뿌리 = E 의 입력(월분)이 그 달 안에서 바뀜 · I9 · C10 그 달 고정표 · DDL `plan_month_credits` |
| 1R | R1-5 medium · 기본분만 공통 계산 → `cover` 뒤 가용액과 다름 | 수용 · R1-1 과 같은 뿌리 · `cover` 삭제로 리셋이 구매분을 안 바꿔 기본분만 계산이 맞음(C7) |
| 1R | R1-6 medium · 지난 주기 후불 초과분 환불(부채만 취소)을 대조 워커가 원장 오류로 판정 | 수용 · 환불 행 `overage_credits` = 부채로 갚은 양 · §5-2 환불 = amount − overage_credits · C8 지난 주기 환불 규칙 |
| 1R | R1-7 medium · 같은 TRIAL 에 새 체험을 주면 요금제 이력이 안 생겨 C1 키가 없음 | 수용 · 체험 사건 키(만료 시각) · C1 |
| 1R | 코드(고객 수 캐스트 · 시험 표지) = 차단 결함 0 | 없음 |
| 2R needs-attention | R2-1 high · 지난 주기 환불 나머지를 기본분으로 → 구매분 소멸(11/10 구매 100 · 12/2 환불 → 1/1 소멸) | 수용 · 뿌리 = 3판이 환불 뜻을 자기 차감 밖(그 주기 미청구 초과 · 맞춤 줄)으로 넓힘(1R-6 과 같은 자리 두 번째 → 구조로) · 4판 C8 = 자기 차감의 역(구성분 복원 · 자기 미청구 초과분만 부채 취소) · 넓힌 규칙 삭제 |
| 2R | R2-2 high · 이력 INSERT(:187) 뒤 리셋(:268-270)이면 지급이 E_after 를 써 변경분 이중(1,200) | 수용 · 뿌리 = 마감과 E 차이의 순서 · 4판 C4 = 잠금 → 마감 → E_before → 이력 → E_after |
| 2R | R2-3 high · 마지막 리셋 시각 하나가 앞 달들 마감을 증명한다고 봄(12월 실패 · 1/1 회복 → 맞춤이 12/31 날짜로 → 11월 청구서에서 100 빠짐) | 수용 · 뿌리 = 리셋이 「지금 달로 한 번에 점프」 · 4판 C2 = 한 달씩 마감 · 줄 시각 = 그 달 경계 · I10 |
| 2R | R2-4 high · 달 경계 TRIAL 예외가 혼합 시간표 지급을 0 으로 만듦(11/30 TRIAL→BASIC 12/15 적용 · E(12월)=411 인데 0) | 수용 · 뿌리 = 미래 적용일이 한 달에 체험과 유료를 섞음 · 4판 C4 = 적용일 이번 달 오늘까지만(운영 호출 영향 0) · 1R-3 반례(547)도 같은 장치로 생기지 않음 |
| 2R | R2-5 medium · 만료 시각 키는 fresh 지급 재시도를 못 막음(100 → 130) | 수용 · 키가 아니라 호출 규칙으로 닫음: fresh 아닌 재시도 = 연장(크레딧 0) · fresh = 같은 트랜잭션 1회 기록이 막는 호출부만(계약 시험 R38 ④) |
| 2R | R2-6 medium · DDL 전 폴백이 월 고정을 깸(375 vs 525) | 수용 · 표가 없으면 월 크레딧 수정 거절(503) → 그동안 plans 값 = 고정값 · 4판 C10 |
| 3R needs-attention | R3-1 high · 초과가 섞인 지난 주기 환불에서 구성분 검사가 음수 기본분까지 fromBase 로 셈 → 폴백 → 구매분 100 이 기본분으로(정답 (−100, 100)) | 수용 · 뿌리 = 구성을 「차이 둘」로만 봐서 초과 몫이 기본분 몫에 섞임(환불 세 번째 · 같은 자리) · 5판 C8 = 구성 셋(기본 · 구매 · 초과)을 직전 기본분으로 다시 계산 · 구매분 몫은 언제나 구매분 |
| 3R | R3-2 high · 이력 없는 회사의 E_before 가 바뀐 뒤 요금제를 읽음(275 대신 −475) | 수용 · 뿌리 = 변경 전 요금제가 이력에도 잠금 아래에도 없음 · 5판 C4 = Δ 를 그 달 원장 지급 합 기준으로 + 호출부 `prevPlanIdHint`(이력 없을 때만 첫 이력 from_plan) |
| 3R | R3-3 medium · 밀린 과거 달 고정값을 수정 뒤 값으로 만듦(150 부족) | 수용 · 5판 C10 = 수정 전에 닫히지 않았을 수 있는 달 전부를 수정 전 값으로 고정 |
| 3R | 닫힘 확인 = R2-3(11/30 맞춤 100 · 11월 청구서만 · 리셋 < 12/1 이면 발행 막힘) · R2-2(이력 있는 회사 1,200 반례 한 번) · R2-4(혼합 반례 차단) · C11(30,000원 · 750 = 12,100원 · 275 · 12/1 33,000원 · 750) | 없음 |
| 구현 자체 검토 | ① 빈 billing_type 회사의 월 마감이 선불처럼 음수를 넘김(정산서는 선불만 막아 그 초과를 청구 → 이중 청구 · 옛 C-08 계약 회귀 · 칸 = NULL 허용 · CHECK 없음 · 시험 그릇 실측) | 수용 · 판정 함수 하나 `billedMonthly`(월 마감 · 미리 계산 · 환불) · 사전 SQL ③ 조건도 같게 · 단위 시험(빈 값 · 공백 = 후불) |
| 구현 자체 검토 | ② 자정 직전에 시작한 거래의 일할 줄이 지난달 시각으로 찍혀 그 달 지급 합에서 빠짐 → 다음 변경 때 이중 지급 · 오늘 · 적용일 · 마감 시각을 시계 세 번으로 읽음 | 수용 · 일할 줄의 달 = 그 이력 행 적용일(키로 잇기) · 시계 한 번 |
| 구현 자체 검토 | ③ 무료 메시징 회수 · 지급이 던지면 크레딧 1일 지급 · 대조가 그 주기 통째로 빠짐 | 수용 · 겹침 방지 안 finally |
| 구현 자체 검토 | ④ 대조가 매일 원장 전체를 다시 읽음(줄 수 상한 없음 · 옛 어긋남이 매일 경보) | 수용 · 최근 40일 줄 + 바로 앞 기준 줄 하나 · 실 PG 시험 |
| 구현 자체 검토 | ⑤ 잠긴 회사 버튼 · 안내가 「1개월 연장」(C11 뒤 = 이번 달 말일까지 일할) | 수용 · 두 화면 문구(PrepaidTermCard · PlanChangeModal) |
| 구현 자체 검토 | ⑥ 새 뿌리 번호 R33 이 다른 세션(혜택 판정)과 겹침 · R34~R37 도 쓰거나 예약 | 수용 · R38 로 올림(대장 · 계약 시험 · 이 문서) |
| 구현 1R needs-attention | 1R-1 high · 이력 없는 회사를 지금 요금제로 다시 승인하면 힌트(= 그 요금제)를 버려 「최초 가입」 이력 → 그 달 앞 날 권리 0 → 이미 준 월분 회수(300 → 110 · −190) | 수용 · 힌트는 언제나 직전 요금제(호출부 6곳 모두 바꾸기 전 값) → same_plan · 실 PG 회귀 |
| 구현 1R | 1R-2 high · 체험 → 유료 전환에서 체험 소멸이 시계를 다시 읽어, 이력 INSERT 뒤 자정이면 11월 지급분을 체험 잔여로 지움 | 수용 · 뿌리 = 한 사건이 시계를 여러 곳에서 읽음(1R-3 · 자체 검토 ② 와 같은 뿌리 → 구조 규칙: 사건 하나 = 진입점 시계 하나 · CT 끝까지 넘김 · 달 · 주기 판정은 판정 시각 · seq · 키로만) · recordPlanChange now · 체험 세 경로 |
| 구현 1R | 1R-3 high · 첫 지급의 달 키 = 판정 시각 · 리셋 시각 = DB 거래 시작 → 자정을 낀 거래 뒤 다음 마감이 같은 키를 다시 넣다 영구 실패 | 수용 · 같은 뿌리 · 리셋 시각 = 판정 시각 · 환불 같은 주기 = 리셋 줄 seq → 그 줄 시각 → 리셋 시각 · 실 PG 회귀 · 변이 셋 빨간불 |
| 구현 2R needs-attention | 2R-1 high · seq 없는 옛 행 폴백에서 자정 직전에 시작한 차감(줄 시각 10/31 · 마감은 11월 판정)을 지난 주기로 읽어 부채만 취소(정답 300 · 결과 200) | 수용 · 1R-2 · 1R-3 과 같은 부류 세 번째 = 읽는 쪽을 하나씩 고쳐서 반복 → **쓰는 쪽 규칙**: 주기 시작 줄 = 리셋 시각 · 마감 뒤 CT 가 쓰는 줄(차감 · 환불 · 일할 · 체험) = 거래 시작과 「주기 시작 + 1µs」 중 늦은 쪽(`AFTER_CYCLE_START_SQL`) → 시각으로 주기를 가르는 모든 곳(청구 기간 · 옛 행 폴백)이 주기 순서와 같아짐 · 1R-3 의 LEAST 덧댐은 지움 |
| 구현 2R | 2R-2 medium · 일할 줄의 달을 이력 행 잇기로 셈 → 이력 행을 지우면 그 줄이 지급 합에서 빠져 다음 변경이 이중 지급(525 → 750) | 수용 · 일할 키에 달을 박음(`plan-prorate:YYYYMM:이력 id`) · 그 달 지급 합 = 리셋 키 + 그 달 일할 키(옛 1026 키 꼴 = 줄 시각의 달 · 배포 전에만 생김) · 잇기 지움 |
| 구현 2R | 2R-3 medium · 대조 기준 줄 = 40일 전 시각의 MAX(seq) → 밀린 마감이 지난 날짜 · 큰 seq 로 넣은 줄이 최근 줄을 범위 밖으로 밀어냄 | 수용 · 기준 줄 = 최근 줄 중 가장 작은 seq 의 바로 앞 · 최근 줄 없으면 마지막 줄(I4) |
| 구현 2R 변이에서 드러남 | 환불 직전 줄 찾기 · 같은 주기 비교가 원 차감 시각을 JS Date(ms)로 받아 다시 넘겨 µs 가 잘림 → 같은 ms 안 줄(주기 시작 + 1µs · 한 거래의 같은 NOW())의 앞뒤가 id 순으로 흔들림(옛 코드부터 · 시험이 50% 로 흔들려 발견) | 고침 · 시각 비교 값 = SQL 이 µs 까지 낸 글자(`TS_US_SQL`) · 시험 줄 id 순서를 시각과 반대로 고정 → 옛 꼴이면 언제나 빨간불 |
| 구현 3R needs-attention | 3R-1 medium · seq 없는 경로에서 주기 시작 전에 시작한 두 거래의 차감이 같은 「주기 시작 + 1µs」 → id 순으로 흔들려 B 환불이 A 를 건너뜀 → 기본분 100 이 구매분으로(정답 (100, 100) · 결과 (0, 200)) | 수용 · 2R 쓰는 쪽 규칙의 바닥을 보강(뿌리 같음 · 새 장치 아님): 마감 뒤 줄 시각 = 실행 시각(clock_timestamp) · 주기 시작 + 1µs · 그 회사 마지막 줄 + 1µs 중 가장 늦은 것 → 회사 잠금 아래 쓴 순서 = 시각 순서 · 실 PG 회귀(역순 id 두 차감) |
| 구현 3R [범위 밖 표시 · 내 코드라 수용] | 대조 SQL `ORDER BY seq` 가 출력 별칭(seq::text)을 따라 99 → 100 경계에서 순서가 뒤집혀 정상 회사를 경보 | 수용 · `ORDER BY r.seq`(숫자) · 시험에서 seq 를 99 · 100 으로 맞춰 고정 |
| 구현 4R needs-attention | 4R-1 high · 3R 의 실행 시각(clock_timestamp) 바닥이 반대 방향을 엶: 10/31 판정(마감 없음) 차감이 자정 뒤에 실행되면 11월로 찍혀 다른 주기로 읽힘 → 환불이 부채 취소 + 기본분 복원을 함께 해 300 대신 400 | 수용 · 뿌리 같음(줄 시각을 DB 시계로 찍음) → 줄 시각 = **판정 시각**을 그 줄이 실제로 든 주기 [마감 뒤 리셋 시각, 다음 달 1일) 안으로 묶음(max(판정 시각, 주기 시작 + 1µs, 마지막 줄 + 1µs) → 주기 끝 − 1µs 로 자름 · `CYCLE_ROW_TIME_SQL`) · DB 시계는 줄 시각에 안 씀 · 실 PG 회귀 · 변이 빨간불 |
| 구현 5R needs-attention | 5R-1 high · 주기 끝 − 1µs 로 자른 줄들이 같은 시각이 되면(미래 시각 이상 줄) seq 없는 환불 경로가 id 순으로 직전 줄을 놓쳐 기본분 100 이 구매분으로((0, 200) · 정답 (100, 100)) | 수용 · 같은 부류(seq 없는 경로의 순서) 세 번째(3R-1 · µs · 5R-1) → 멈추고 뿌리 답: **새 코드 줄에 seq 없는 경로가 남아, 줄 시각 하나에 청구 달과 원장 순서 두 역할을 시켰다** → 구조 처방 = seq 칸을 기본값 없이 **배포 앞**에 넣고 새 코드가 INSERT 마다 nextval(7곳 · R38 ⑦ 계약 시험) · 순서 = seq · 시각 = 청구 달만 · 3R 의 「마지막 줄 + 1µs」 덧댐은 지움(코드 줄어듦) · 옛 행(seq 없음 = 옛 코드 줄)만 시각 폴백 |
| 구현 6R approve | 지적 0(INSERT 7곳 seq · 회사 잠금 · 옛 NULL 행 폴백 · 같은 시각 정렬 · 청구 달 경계 · DDL 순서 확인) | 닫힘 |

## 14. 같이 고친 것 · 범위 밖
- **고객 수 천 단위 쉼표**(Harold 1101 「스샷의 고객숫자 천단위 쉼표」): 원인 = `COUNT(*)` 는 bigint 라 드라이버(node-pg)가 글자로 넘기고, 화면은 숫자로 알고 `toLocaleString()` 을 부른다(글자의 `toLocaleString` = 그대로) · 화면 타입은 `number`(`admin-types.ts:12`). 처방 = 서버가 숫자로 보낸다: 목록 `routes/companies.ts:1756` `::int` · 회사 상세 `routes/admin.ts:610-611` `::int`(화면 소비 0 · 같은 꼴). 화면 코드 변경 0. 소스 표지로 자르는 계약 시험 1줄 표지 갱신(`secret-hash.test.ts:94`).
  - 검증 = backend tsc 0 · 시험 그릇(t_tpl_closed · PG 15)에서 두 SQL 실행 → `total_customers` · `total_users` 타입 23(int4) · 그 시험 파일 11건 통과 · backend vitest 전체 728파일 10,833건 중 실패 1건 = `pg-test-stamp`(다른 세션이 오늘 새로 만든 `result-read-floor-1101.pg.test.ts` 도장 · 작업 트리 미추적 파일 · 이 작업과 무관) · Codex 1R = 차단 결함 0.
- [범위 밖] 라우트 SQL 의 `COUNT(...) AS 이름` 캐스트 없는 자리 46곳(캐스트 있음 143 · 1101 grep) · 화면이 숫자로 쓰는지는 자리마다 다르다 · 기록만.
- [범위 밖] 운영 PG(`targetup-postgres`)에서 병렬 해시 조인이 `could not resize shared memory segment ... 16777216 bytes: No space left on device` 로 실패(1101 진단 SQL · 고객 표 × 예측 표) = 컨테이너 공유 메모리 칸 부족 때 나는 오류 · 크기 미확인 · 앱의 큰 읽기 쿼리도 병렬로 돌면 같은 오류가 날 수 있다 · 기록만.

## 15. 전수점검 (1101 밤 · 컨트롤타워 밖에 남은 크레딧 일)
접수(Harold 1101 밤): 「체험크레딧은 체험 종료가 되면 그냥 사라져야」 · 「크레딧을 컨트롤타워화 했으면 파편화 되어있는걸 모아서 컨트롤타워에서 처리를 하도록 싹 다 바꿔야」 · 「여러곳에서 사용할 기능은 컨트롤타워화」.
C90 1~6R 은 **잔액 · 원장을 쓰는 자리**(R38)만 모았다. 읽는 자리 · 걷는 판단 · 단가표 · 한도 · 체험 수명 · 경보는 전수로 보지 않았다 = 이 절.
방법 = 직접 grep · 읽기(에이전트 0). 대상 = 백엔드 운영 소스(시험 제외)에서 크레딧 모듈을 부르는 96파일 · 크레딧 칸 · 표 이름이 나오는 23파일 · 프론트 `constants/credit` 를 부르는 43파일 · `content/plan-feature-intros.ts`.

### 15-1. 원장 · 잔액 · 월 크레딧 칸 SQL 이 CT 밖에 있는 자리
| # | 자리 | 하는 일 |
|---|---|---|
| F1 | `planner-approval.ts:50` · `:157` | 대행 환불 회차 = 환불 줄 키 접두 수(같은 SQL 두 벌) |
| F2 | `planner-approval.ts:83` | 대행 차감이 있나 |
| F3 | `planner-approval.ts:196` | 원 차감 금액 |
| F4 | `planner-confirm.ts:333` | 행사 빠른 제작에 걷은 합(키 꼴 LIKE ANY) |
| F5 | `journey-operation-release.ts:28` · `planner-executor.ts:579` · `continuous-operator.ts:2780` | 못 보낸 발송 크레딧 되돌림 후보 = **같은 꼴 SQL 세 벌**(`release:` 키 · R4) |
| F6 | `dm/dm-publish-gate.ts:153` | DM 발행비를 걷었나 |
| F7 | `email/email-completion.ts:39` · `:75` · `:80` | 이메일 완성비를 걷었나(키 목록 · 키 접두) |
| F8 | `journey-credit-forecast.ts:97` · `:133` | 여정 · 자동 마케팅 30일 차감 수(예상 크레딧) |
| F9 | `journey-draft-save.ts:133` | 다음 차감 키(환불된 시도 세기) |
| F10 | `billing-issue.ts:728` · `:744` · `:918` · `:926` · `:1295` · `:1303` · `routes/billing.ts:2603` · `:2613` · `:2911` · `:2921` | 후불 크레딧 청구 줄(승인 충전 · 미청구 초과) 읽기 · 청구 표시 · 되돌리기 · 미리보기 |
| F11 | `routes/admin.ts:4115` | 후불 한도 쓰기 |
| F12 | `routes/admin.ts:4199~4207` | 크레딧 위험 회사 = 날 칸(월 마감 투영 없음 · `getCreditState` 와 다른 판정) |
| F13 | `routes/admin.ts:2822~2841` | 요금제 월 크레딧 수정(+ CT 고정표 스냅숏) |
| F14 | `routes/companies.ts:626` | 요금제 신청 = 바꿀 요금제 월 크레딧 대 여정 예상 |
| F15 | `basic-trial.ts:109` | 체험 크레딧 양 = TRIAL 요금제 월 크레딧 |
| F16 | `plan-change-log.ts:143` · `:304` · `:315` | 요금제 변경 일할 = 원장 줄 + 잔액(R38 허용 쓰기 파일 · CT 모듈 밖) |
| F17 | `ai-usage-threshold-alert.ts:111~117` `shouldAlertJourneyCredit` · `routes/admin.ts:4206` | 「크레딧 모자람」 판정 두 벌 · 기준도 다름(여정 안내 = 남은 < 월 기본 × 0.2 · 관리자 위험 회사 = ≤ 0.2) |
| F18 | `email/email-completion.ts:26` · CT 안 `ai-credit.ts:53 · 85 · 98` · `ai-credit-tx.ts:294` | 「크레딧제 적용 회사인가」(월 크레딧 칸 있음 또는 구매분 > 0) 판정 다섯 벌 · 하나는 CT 밖 |
| F19 | `continuous-operator.ts:585` · `line-steps-context.ts:224` | 차감 결과 해석(차감 · 중복 · 미적용 = 걷힘)을 기능이 각자 |
| 면제 후보 | `routes/plans.ts:16` · `plan-recommend.ts:96` · `marketing-diagnosis-store.ts:42` · `marketing-diagnosis-report.ts:241` · `routes/admin.ts:2789` · `:2899` · `plan-term.ts:158 · 163` | 요금제 표 칸을 그대로 보이거나 추천(그 달 지급 = CT 고정표) · plan-term 은 싣기만 하고 쓰는 곳 미확인(구현 때 확인) |

### 15-2. 단가 · 표가 두 벌
| # | 자리 | 두 번째 사본 | 지금 맞추는 법 |
|---|---|---|---|
| D1 | 프론트 `constants/credit.ts` | 작업 단가 표 · 생성 단가 · 확인 창 단가 · `creditCost` · 충전 단가 · 부가세 · 충전 금액 · 일일 분석 식 · 원장 type 표 · 증감 함수 | 손으로 다시 적고 일치 시험(`credit-label-parity` 등) |
| D2 | 백엔드 `content/plan-feature-intros.ts` | 기능 소개 창 크레딧 숫자 42줄 | 손 숫자 + 일치 시험(`plan-feature-modal-contract`) |

### 15-3. 걷는 판단이 CT 밖
| # | 자리 | 하는 일 |
|---|---|---|
| P1 | `services/ai.ts:115~178` | AI 호출 하나 = 과금 자리(단가 · 묶음이면 0 · 캐시 적중 = 0 · 사전 확인 · 성공 뒤 차감) |
| P2 | `creditCost: 0` 28곳(`email-ai.ts` 8 · `services/ai.ts` 3 · 그 밖 15파일) | 호출부가 숫자 0 으로 「이 호출은 안 걷는다」를 정함 |
| P3 | `line-steps-context.ts:68` · `services/ai-line.ts:210 · 396` · `one-line-ct/order.ts:148~157` · `routes/ai-memory.ts:368 · 744~834` · `campaign-quick.ts:644 · 817` | 한 줄 · AI 한줄로 · 목소리 · 빠른 제작 금액 규칙(같은 날 같은 한 줄 = 0 · 판단 뒤 13 등) |

### 15-4. 사용 한도가 두 벌
| L1 | `ai-rate-limit.ts:114` · 부르는 곳 `services/ai.ts:128~131` · `routes/ai.ts:2883` | 월 AI 호출 수(`plans.ai_calls_per_month`)가 크레딧과 따로 막는다 · 묶음 · 걷지 않는 호출도 센다 |
|---|---|---|
| L1 딸림 | 한도 초과 예외를 받는 곳 12(`ai-memory.ts:264 · 776` · `ai-usage.ts:382` · `ai.ts:2906` · `campaign-agency.ts:156` · `cdp.ts:2335` · `event-campaigns.ts:77 · 192` · `sns.ts:656 · 709` · `cdp-fusion-explainer.ts:169` · `sns-caption-ai.ts:315`) · AI 사용량 화면(`routes/ai-usage.ts` 한도 · 사용률 · 도달 예상일 · 문구) · 한도 알림 워커(`ai-usage-threshold-alert.ts:26~` 호출 수 ÷ 한도) · 프론트(`AiUsagePage.tsx:340` · `AiMemoryPage.tsx:375` 토스트 · `ThresholdAlertModal.tsx:101`) | 한도가 있다는 전제로 만든 것 |

### 15-5. 체험 수명
- T1 체험 끝 = 하루 한 번 04:00(`trial-downgrade-worker.ts:209`) → 만료 뒤 최대 하루 체험 크레딧을 쓸 수 있다(크레딧 CT 는 만료를 안 본다 · `plan-guard.ts:194` isTrialActive 는 계산만 · 막는 곳 0).
- T2 만료일 없는 체험은 작업이 건너뛴다(`trial-downgrade-worker.ts:52`). Harold 실행 SQL(1101 밤): 체험 4곳(벨루티코리아 600 · 우림에프엠지 600 · 금강제화 747 · 아이디룩 745) 전부 active · 만료일 없음 0 · 만료 지남 0 · FREE 남은 기본분 0.
- T3 체험 크레딧 양 판정 = F15.

### 15-6. 경보가 항목마다(A)
`ai-credit.ts:535` 월 마감 실패 회사마다 · `ai-credit-reconcile.ts:114` 대조 어긋남 회사마다 · `ai-credit-tx.ts:195` 미청구 초과 회사 · 달마다 · `predictive-worker.ts:160` 분석 실패 회사마다 · `plan-change-log.ts:330` 요금제 변경 실패 회사마다(체험 강등 · 기간 패스가 부름) · `continuous-operator.ts:2808` 발송 크레딧 되돌림 실패 회사마다. 크레딧 밖: 경보를 부르는 운영 파일 44곳 94자리(1101 grep) 중 주기 작업의 항목마다 경보 = 구현 때 기계로 뽑아 목록화.

### 15-7. 기록만
CT 안 걷는 함수가 여러 꼴이다(`checkCredit` 29 · `runChargedAi` 18 · `settleCreditAfterSuccess` 12 · `deductCreditOutcome` 11 · `settleOrUndo` 7 · `deductCreditSafe` 6 · `refundCredit` 6 · `hasCreditForStrict` 2 · `settleCreditInTx` 1 · `deductCredit` 1 · 부르는 파일 수). 전부 CT 안이라 이번 편입 대상이 아니다.

## 16. 편입 설계 (6판 · D · A · B · C 한 배포 · Harold 동의 1101 밤 · Codex 설계 리뷰 = 16-9)
원칙: 크레딧 칸 · 표 이름이 나오는 SQL · 단가 숫자 · 걷을지 판단 · 한도 · 체험 크레딧 수명은 크레딧 CT 파일(`utils/ai-credit*.ts`) 안에만 둔다. 기능 · 정산 · 관리 · 화면은 CT 함수를 부른다. 옮김 = 원본 SQL · 식 복사(다시 쓰지 않음 · 동작 그대로).

| 접수 | 이 축이 없으면 닫히나 | 축 |
|---|---|---|
| 체험 크레딧은 체험 종료 때 사라져야 | 아니오 | 16-5 |
| 파편 전부 CT 로 | 아니오 | 16-1 ~ 16-4 · 16-6 |
| 경보 100통(A) · 배포 앞 DDL(B) | 아니오 | 16-6 · 16-7 |

### 16-1. 원장 · 잔액 · 월 크레딧 읽기 · 쓰기 (F1~F16)
- 원장 읽기 함수(새 `ai-credit-ledger.ts`): 키 접두 줄 수 · 키 접두 줄 목록 · 키 꼴 합 · 원천별 기간 차감 수 · 있는 함수(`isChargedByKey` · `chargedAmountByKey` · `chargedKeysAmong`)로 F1~F4 · F6~F9 교체. 원장 읽기 함수는 호출부의 연결(client)을 받는다(대행 환불 회차는 기능 잠금 안에서 센다 · 그 잠금 · 그 거래 그대로).
- 판정 한 벌(F18 · F19): 「크레딧제 적용 회사인가」 = CT `creditApplies(row)` 하나(CT 안 네 벌 + 이메일 완성 한 벌) · 「걷힘인가」(차감 · 중복 · 미적용) = CT `chargeSettled(outcome)` 하나.
- 발송 크레딧 되돌림 한 함수(F5 세 벌 → 하나): CT = 후보 원장 줄 · `release:` 줄 쓰기 · 기능 = 「그 발송이 나갔나」 판정만 넘김.
- 정산 크레딧 줄(F10): 청구 줄 읽기 · 청구 표시 · 되돌리기 · 미리보기 · 남은 줄 있나 = CT 함수 · 정산 코드는 부르기만.
- 관리(F11~F13): 후불 한도 설정 · 위험 회사 목록(`getCreditState` 와 같은 투영) · 요금제 월 크레딧 바꾸기(스냅숏 + 수정 한 트랜잭션) = CT 함수.
- 요금제 · 체험(F14 · F15): 요금제 월 크레딧 읽기 · 체험 크레딧 양 = CT 함수.
- 일할 쓰기(F16): 원장 · 잔액 쓰기를 `ai-credit-tx.ts` 로 옮김 → R38 쓰는 파일 = CT 두 파일.
- 새 뿌리 R39 「크레딧 일을 기능 파일이 직접 한다」 계약 시험(`utils/__tests__/credit-ct-contract.test.ts` · 대상 = 소스에서 기계로 뽑음 · 두 층):
  ① 원장 · 잔액 · 충전 요청 · 초과 · 월 고정표 · 후불 한도 칸(`ai_credit_transactions` · `ai_credits_base_remaining|purchased|reset_at|monthly_cap` · `postpaid_overage_limit` · `overage_credits` · `plan_month_credits` · `ai_credit_requests`)이 SQL 글(백틱)에 나오는 파일 = CT 파일 밖 0 · 면제 없음.
  ② 요금제 월 크레딧 칸(`ai_credits_per_month`) = CT 밖은 면제 **문장**만: (파일 · 문장 꼴) 짝 = `routes/admin.ts` SELECT · 요금제 만들기 `INSERT INTO plans` / `marketing-diagnosis-store.ts` SELECT / `plan-term.ts` SELECT · 이 칸을 바꾸는 UPDATE = CT `setPlanMonthCredits` 하나(스냅숏과 한 거래).
  모으는 법(Codex 설계 4R~11R 같은 부류 → 구조 처방 두 번) = TypeScript 구문 나무 + **컴파일러 결속**: 조각 = 작은 · 큰따옴표 글 · 템플릿 머리 · 사이 · 꼬리(템플릿 안 템플릿까지) / 식 = 글 · 템플릿 · `+` 사슬의 가장 바깥 / 이름 → 값 = 백엔드 소스 전체를 한 프로그램으로 묶어(모듈 해석 = 이 소스 파일만 · 패키지 안 풀림) 식별자 → 기호(가져오기면 원래 기호) → 선언이 하나이고 초기값 있는 const 일 때만 접는다(다른 파일 const 포함 · 다른 범위 · import = require · 구조 분해 · 매개변수가 같은 이름을 가려도 결속이 정한다 · 4R~6R). 부분 값 = 접히는 자리는 값 · 안 접히는 자리만 빈칸. ② 층 대상 = (SQL 문장이면서 조각 · 부분 값에 칸 이름) 또는 (끝까지 안 접힌 동적 SQL 의 정적 글 어디든 **쓰기 낱말(UPDATE · DELETE · INSERT · MERGE · COPY · ALTER · DROP · TRUNCATE)과 요금제 표 이름 후보가 함께** 있음 · 표 이름 후보(12R~14R = 따옴표 주변 빈칸 위치를 하나씩 막다 같은 부류 세 번 → 위치를 따지지 않는다) = ① 맨 낱말 `plans`(빈칸 끼움 · 대소문자 무관 · 따옴표 이름 "plans" 도 여기서 걸린다) ② 정적 큰따옴표가 하나라도 있음(U& 유니코드 이스케이프로 글자를 숨긴 따옴표 이름 · 여는 · 닫는 따옴표 · U& 를 빈칸이 어디서 대도 정적 따옴표 하나가 남는다) ③ 기본 유니코드 이스케이프 = 도입자(정적 `\` 또는 빈칸 · 빈칸이 `\` 를 댈 수 있다 · 16R) + hex 4 · `+` hex 6(숫자 사이 빈칸 허용 · 따옴표를 전부 빈칸이 대도 본문은 남는다) ④ 정적 UESCAPE 낱말(사용자 지정 이스케이프 문자 = UESCAPE 가 정적이면 언제나 보인다 · 15R) ⑤ 정적 U& 표기(U 와 & 사이 빈칸 허용 · 16R) · **빈칸은 빈칸마다 따로** 비움(글자 사이에 끼어도 같은 낱말) 또는 경계(낱말 앞뒤)로 본다(13R) · 정적 글이 `<` 로 시작 = SQL 아님(HTML 틀 · PG 는 여러 문장 글 전체를 먼저 구문 분석해 첫 글자가 구문 오류면 어떤 문장도 실행하지 않는다 · 14R 이 단순 · 확장 프로토콜 모두 성립 확인) · 경계 = UESCAPE 까지 빈칸이 대면 이스케이프 문자가 실행 중에 정해진다(모델 밖) · 도입자 없는 일반 hex 4자리는 실측 24곳(문자 큐 상태 9999 · 주석 날짜 · UUID)이 걸려 안 쓴다(15R 처방 대안 · 판정 지문 19개 추가 = 정상 수정마다 빨간불 · 16R 이 도입자 = `\` 또는 빈칸으로 좁혀 같은 꼴을 닫음 · 실측 5곳 그대로)). **동적 SQL 은 토큰으로 해석하지 않는다**(7R~11R = 빈칸이 실행 때 주석 · 따옴표를 열고 닫아 정적 글의 어휘 구조를 바꿀 수 있어 토큰 해석 갈래를 늘릴 때마다 새 우회가 나온 같은 부류 다섯 번 → 정적으로 정할 수 없는 것은 막는다 · 쓰기 대상 문법 · 재검사 함수는 지웠다). 쓰기 낱말 + plans 가 함께 있는 정상 동적 문장 = 사람이 읽고 판정한 **지문 표**(부분 값 sha256 앞 16자 + 이유 · 문장이 바뀌면 지문이 달라져 빨간불 · 낡은 지문 = 실패) — 실측 1101 = 5곳(무료 문자 지급 INSERT 둘 = 다른 표에 쓰고 요금제 표는 읽기 · 진단 지급 자격 SELECT … FOR UPDATE OF c · 청구 발행 수기 항목 SELECT = 주석의 ALTER 낱말 · 회사 병합 UPDATE "${표}" = 코드 상수 표 목록 · plans 에는 company_id 칸 없음 information_schema 0행). 면제 문장(끝까지 접힘) = **어휘 허용 목록**(주석 · 달러 글 · 세미콜론 · 백슬래시 · E · U& 가 있으면 거부 · 8R) 을 통과한 평범한 SQL 만 토큰으로 자른다(낱말 · 따옴표 이름 · '' 글 · 기호 · $n = PG 와 같게 자르는 부분집합) → 첫 꼴이 면제 꼴(SELECT / 요금제 만들기 INSERT INTO plans) · 그 뒤 쓰기 낱말 0(UPDATE(행 잠금 FOR [NO KEY] UPDATE 제외) · INSERT · DELETE · MERGE · TRUNCATE · COPY · ALTER · DROP · CREATE · GRANT · REVOKE). 보수적 실패 = 면제 파일이라도 칸 이름 SELECT 에 안 풀리는 import 를 끼우면 빨간불 · 동적 SQL 이 쓰기 낱말과 plans 를 함께 품으면 읽기만 해도 지문 표 전에는 빨간불(의도). 정적 검사의 경계(모델 밖) = 실행 중에 정해지는 이름 · 낱말(카탈로그 · 자료로 고르는 표 · 칸 · 쓰기 낱말이 빈칸) · DB 안 코드(함수 · 트리거 · 규칙 · `EXECUTE` 글)가 하는 쓰기 — 실측 1101: CT 밖 동적 표 이름 쓰기 13곳 = 문자 큐 회선 표(MySQL) · 회사 삭제 도구 `fk-delete-plan`(카탈로그 · 스크립트 전용) · 보관 기한 규칙 표(같은 파일 글 목록 = ① 이 본다)뿐 · 컴파일러 접기로 CT 밖 새 거짓 빨간불 0(① 걸림 10 = 전부 「DB 마이그레이션 필요」 안내).
  검사 대상(Codex 설계 2R-2 · 3R-3) = 따옴표 세 꼴(작은 · 큰 · 백틱) 글 · `'a' + 'b'` 처럼 이어 붙인 정적 글은 합친 뒤 · 대소문자 무관. ① 층 = 칸 이름이 든 **모든** 글(SQL 낱말 여부 무관 · 이어 붙이기 · 소문자로 숨긴 쓰기도 잡힘) · 예외 = 「DB 마이그레이션 필요」로 시작하는 오류 안내 글(사용 문맥). ② 층 = SQL 꼴(SELECT · UPDATE · INSERT INTO · DELETE FROM · FROM · JOIN · WHERE 낱말) 글 · 바꾸는 문장 = `UPDATE 표 SET` · `DELETE FROM` · `ON CONFLICT … DO UPDATE SET`(요금제 만들기 면제가 UPSERT 로 값을 바꾸는 반례 · 3R-2). 변이 = 면제 파일에 쓰기 한 줄(백틱 `UPDATE plans SET ai_credits_per_month` · 작은따옴표 `UPDATE companies SET postpaid_overage_limit` · 소문자 · 이어 붙이기 · 템플릿 안 템플릿 · `${'postpaid_' + 'overage_limit'}` · `INSERT INTO plans … DO UPDATE SET ai_credits_per_month` · const · let 변수로 나눈 UPSERT · 같은 이름 다른 범위 const · 칸 이름 const + 동적 꼬리 · import 상수 칸 이름 · import = require 와 다른 범위 같은 이름 · 별칭 · 스키마 · 따옴표 · 주석 끼운 동적 UPDATE · 다른 파일 const 로 숨긴 칸 · 여러 문장 · 주석 뒤 쓰기)을 넣으면 빨간불 · 행 잠금 FOR UPDATE SELECT · 칸 이름 없는 동적 SELECT = 통과 · 정상 면제 꼴 · 오류 안내 글 = 통과(시험 「①② 변이」).

### 16-2. 단가 한 곳 (D1 · D2)
- 프론트 단가 · 충전 단가 · 부가세 · 일일 분석 식 · 원장 type 표 · 증감 = 백엔드 CT 에서 만든 파일(`frontend/src/constants/credit.generated.ts`) · 만드는 스크립트 · 시험 = 지금 CT 로 다시 만든 글자와 같다(손 수정 = 빨간불). `constants/credit.ts` 는 그 파일을 다시 내보낸다(숫자 0 · 화면 43파일 고칠 곳 0).
- 기능 소개 창 = 숫자 없이 원천만 · 서버가 보낼 때 `getCreditCost` 로 채운다 · 시험 = content 안 크레딧 숫자 0.

### 16-3. 걷는 판단 한 곳 (P1~P3)
- AI 호출 과금(P1) = CT 함수 하나로 옮김(단가 · 묶음 0 · 캐시 적중 0 · 사전 확인 · 성공 뒤 차감).
- 걷지 않는 호출(P2) = 원천 표 하나로는 못 가른다(같은 `generate-messages` 원천에서 첫 호출 5 · 보정 재시도 0 · Codex 설계 1R-1). 호출부는 금액 대신 **사실**을 넘긴다: `charge` 없음 = 원천 단가(묶음 안이면 0) / `{ kind: 'retry', of }` 같은 작업 보정 재시도 / `{ kind: 'settled-by', by }` 부른 진입점이 성공 뒤 한 번 걷음 / `{ kind: 'included-in', parent }` 다른 과금에 포함(등록 · 일일 분석) / `{ kind: 'internal' }` 고객 크레딧 밖(슈퍼관리자 내부 · 학습). 금액은 CT `aiCallCost(source, charge)` 하나가 정한다 · `creditCost` 칸 삭제.
  시험 = ① CT 밖 `creditCost` 0 ② 문안 생성 첫 호출 5 + 보정 재시도 0(지금과 같음) ③ `settled-by` · `included-in` 의 부모 = 단가표 값 > 0 인 원천(고객이 진입점 과금 없이 반복하는 AI 호출 0) ④ 28곳 분류표(진입점 걷음 = 이메일 · 캘린더 · 목소리 · 다목표 / 재시도 = 문안 / 포함 = 등록 매핑 · 번역 · 일일 브리프 · 문안 의도 분류 / 내부 = 관리자 도구 · 학습 · 묶음).
- 금액 규칙(P3) = CT 값 모듈(`ai-credit-price.ts`)로 옮김 · 기능은 「무엇을 했나」만 넘긴다.

### 16-4. 한도 (L1) · Harold 결정(1101 밤) = 없앰
- Harold 「요금제에 따라 지급되는 기본 크레딧은 남아도 매월 초에 전체 초기화되고 다시 지급 · 슈퍼관리자 승인하에 1크레딧당 500원 정가로 추가한 크레딧은 이월 · AI 호출한도는 없애 · 어짜피 지들 크레딧 소모하는건데 한도를 두는거 자체가 문제」. 지금 코드 = 기본분 매월 소멸 · 지급(`ai-credit-tx.ts:248`) · 구매분 이월(`:264` 기본분 칸만 바꿈 · 충전 = 구매분 `ai-credit-calc.ts:285`) · 쓰는 순서 = 기본분 먼저(`ai-credit-calc.ts:60`) = 같다.
- 지움: 한도 확인 두 곳 · 한도 초과 예외와 그것을 받는 12곳 · 면제 목록(`AI_CALL_LIMIT_EXEMPT_SOURCES`)과 그 셈 조각 · 프론트 한도 초과 토스트. 남김: 호출 기록 · 통계(`recordAiCall` · 일별 · 모델별 · 캐시) · 맞춤법 원천 상수(맞춤법 무료 횟수는 따로 센다 · `spell-check-quota.ts`).
- AI 사용량 화면 · 한도 알림 = 크레딧 기준으로 바꾼다(추천): 사용률 = 이번 달 쓴 크레딧 ÷ (쓴 크레딧 + 남은 크레딧) · 알림 기준 50 · 80 · 95% 그대로 · 값은 CT(`getCreditState` · 월 사용량). 다른 안 = 한도 알림을 없앰(화면은 통계만).
- 걷지 않는 호출은 한도가 막아 주던 마지막 상한이 사라지므로 16-3 의 사실 꼴 · 시험 ③(부모 = 값 있는 원천)이 「고객이 진입점 과금 없이 반복할 수 있는 AI 호출 = 0」을 본다.
- 「크레딧 모자람」 판정 두 벌(F17) = CT 함수 하나(`isCreditLow`) · 여정 담당자 안내 · 관리자 위험 회사가 같이 쓴다.

### 16-5. 체험 수명 (C)
- CT 마감 함수(`applyResetIfNeeded` · 부르는 곳 = 차감 · 환불 · 체험 시작 · 체험 끝 · 1일 패스 · 요금제 변경)와 화면 투영(`projectBaseAfterClose`)이 「만료 지난 체험 = 남은 기본분 소멸」을 먼저 한다(키 = 강등 작업과 같은 `trial-end:{회사}:{만료 시각}` · 두 번 지움 0).
- 체험 강등 작업 = 하루 한 번 → 1분마다(요금제도 만료 1분 안에 FREE).
- 체험 크레딧 양 = CT(F15).
- 끝난 수명의 기본분은 환불로 되살아나지 않는다(Codex 설계 1R-2 · 체험 300 중 100 사용 → 만료 소멸 200 → 그 100 환불 → 기본분 100 이 다시 생겨 강등 작업이 같은 trial-end 키로 지우다 충돌 · 강등 롤백 반복): 환불이 기본분을 되메울 때 원 차감 **뒤에** 기본분 수명을 끝낸 줄(체험 시작 소멸 `trial-start` · 체험 끝 소멸 `trial-end` · 비교 = seq · seq 없는 옛 줄 = 시각)이 있으면 같은 거래에서 되메운 **지급 크레딧 몫만** 바로 소멸한다 = 원 차감이 양수 기본분에서 걷은 몫(구성분 `fromBase`) **그대로** · 부채 취소분(초과 몫 · 음수 메우기)은 소멸하지 않는다(Codex 설계 3R-1 · 잔액 −100 → 체험 크레딧 0 → 같은 달 환불 → 잔액 0 · 통째 소멸이면 −100 으로 빚이 되살아남). 소멸액에 상한(환불 뒤 양수 기본분)을 두지 않는다(1101 구현 준비 중 정정 · 상한을 두면 새 수명의 빚을 끝난 크레딧이 갚는다: 체험 끝 뒤 새 빚 −30 → 끝난 체험 차감 60 환불 → 상한 소멸 30 → 잔액 0 · 정답 −30). 빚 되살아남 0 은 상한이 아니라 「소멸 = fromBase 만」이 보장한다(되메움 = fromBase + 초과 몫 − 부채로 갚은 몫 ≥ fromBase) (원장 = 환불 줄 → 소멸 줄 → 잔액 한 번 · 키 = `trial-end-refund:{환불 키}` · 구매분 복원은 그대로) → 체험이 끝난 뒤 기본분이 다시 생기지 않아 강등 작업의 소멸은 0 이 된다(키 충돌 0).
- 수명 경계 줄은 금액 0 이어도 남긴다(Codex 설계 2R-1 · 체험 300 을 다 쓰고 끝나면 옛 `expireTrialLeftover` 는 줄을 안 남겨 그 뒤 환불이 판정 근거 없이 300 을 되살렸다): 체험 끝 = 남은 기본분이 0 이하여도 `expire` 0 줄(source `trial-end` · 그 경로의 키) · 같은 키가 이미 있으면(게으른 소멸이 먼저 씀) 넘어가고, 그때 기본분이 양수면 던진다(환불 규칙상 생길 수 없는 잔액 · 소리 내 멈춤) / 체험 시작 = 남은 기본분 소멸 줄도 체험 크레딧 줄도 없으면 `expire` 0 줄(source `trial-start`). 시험 = 전부 사용 → 강등 → 같은 달 환불 = 기본분 되살아남 0 · 반쯤 사용 → 게으른 소멸 → 환불 → 강등 = 충돌 0 · 체험 전 차감 → 체험 시작(크레딧 0) → 환불 = 되살아남 0 · 잔액 −100 → 체험 크레딧 0 → 같은 달 환불 = 잔액 0(빚 취소 보존) · 기본 60 + 초과 40 섞인 차감 → 체험 끝 → 환불 = 60 만 소멸 · 빚 40 취소 보존 · 기본 60 + 구매 40 차감 → 체험 끝 → 환불 = 구매분 40 만 복원.
- 구성분을 모르는 줄(직전 줄로 몫을 못 구한 옛 줄 · 폴백) + 원 차감 뒤 수명 경계가 있는 환불 = 자동으로 돌려주지 않는다(Codex 설계 4R-1 · 폴백은 split 을 구매분으로 돌려 끝났어야 할 기본분 60 을 구매분으로 살렸다): 잔액 변동 0(판정은 원 행 부채 취소 등 어떤 쓰기보다 먼저 · 호출부 거래에서도 쓴 것 0) · 결과 `held` (skipReason `held_after_lifetime_end`) · `[CREDIT][HOLD]` 로그 · 경보 = CT 환불 함수 `refundCredit` 한 곳(하루 1통 · 이 함수를 지나는 되돌림 · 인앱 · 여정 초안 · 재작성 환불 전부) · 월 대행 취소(거래 함수 직접)는 그 경로의 환불 실패 경보(`planner-refund-miss`) · 되돌림 패스는 그 키를 기간 동안 다시 시도(돌려준 것으로 세지 않음) · 사람이 원장으로 판정해 같은 키로 수동 환불. 시험 = 옛 split 기본 60 + 구매 40(직전 줄 없음) → 체험 끝 → 환불 = 보류 · 잔액 그대로 · 원 행 초과 칸 그대로. 상한 정정 시험 = 체험 끝 뒤 새 빚 −30 → 끝난 체험 차감(기본 60) 환불 → −30.

### 16-6. 경보 (A)
CT `alertPassFailures` 한 함수(실패 N곳 / 대상 M곳 · 오류 종류 많은 순 3 · 회사 앞 3 · 날짜 키 · 6시간) · 15-6 다섯 자리 + 크레딧 밖 같은 뿌리 워커 전수(같은 배포 · 대장 줄 · 계약 시험).

### 16-7. 배포 멈춤 (B)
`deploy-ledger.mjs` = 결과 빈 「★ 배포 앞」 DDL 이 남으면 [먼저 실행]을 맨 위에 찍고 실패 코드.

### 16-8. 순서 · 시험 · 배포
- Harold 동의 → Codex 설계 리뷰 닫힘 → 구현(계약 시험 빨간불 먼저 → CT 함수 → 소비처 파일마다 한 번에 교체 → 실 PG 시험: 정산 줄 · 되돌림 · 체험 만료 · 일할) → tsc · 전체 시험 → Codex 구현 리뷰 approve → 배포 명령.
- DDL 0(코드만) · 백엔드 + 프론트 한 배포.
- 겹침: 여정 파일 셋(`journey-credit-forecast.ts` · `journey-draft-save.ts` · `journey-operation-release.ts`)을 고친다 · 고치기 직전 작업 트리에서 다른 세션 변경 여부를 본다 · push 는 다른 세션 작업과 섞지 않는다. 다른 세션이 `root-ledger.test.ts` · `ROOT-LEDGER.md` 를 고치는 중이라 R39 계약 시험은 새 파일 `credit-ct-contract.test.ts` 에 둔다.

### 16-9. Codex 설계 리뷰
| 회차 | 판정 · 지적 | 처리 |
|---|---|---|
| 설계 1R(잡 1회 = 런처가 3분 반에 끝나며 잡도 끝남 · 런북 §4 · 분리 프로세스로 재실행) | needs-attention · ① high 원천 표로는 첫 호출 · 보정 재시도를 못 가름 ② high 만료 뒤 환불이 기본분을 되살려 강등 작업이 같은 trial-end 키로 충돌 · 반복 실패 ③ medium 파일 단위 면제가 면제 파일의 직접 쓰기를 허용 · 중간 메모 = 원장 읽기는 기능 잠금 안 연결로 | 셋 다 수용 · ① 16-3 사실 꼴 + `aiCallCost` ② 16-5 끝난 수명 기본분 환불 = 같은 거래 소멸 ③ 16-1 R39 두 층 · 문장 단위 면제 · 변이 · 중간 메모 = 16-1 client |
| 설계 2R | needs-attention · ① high 잔액 0 으로 끝난 체험은 경계 줄이 없어 뒤 환불이 기본분을 되살림 ② medium 백틱만 보면 작은따옴표 SQL(`admin.ts:4115`)이 R39 를 우회 · 1R-1 사실 꼴 · client 는 지적 0 | 둘 다 수용 · ① 16-5 경계 줄 금액 0 이어도 남김 + 시험 3사례 ② 16-1 따옴표 세 꼴 · SQL 낱말 판정 · 작은따옴표 변이 |
| 설계 3R | needs-attention · ① high 환불 뒤 즉시 소멸에 부채 취소분까지 넣으면 취소한 빚이 되살아남 ② medium 요금제 만들기 면제가 `ON CONFLICT DO UPDATE SET` 로 값을 바꿀 수 있음 ③ medium 소문자 · 이어 붙인 SQL 이 R39 를 우회 | 셋 다 수용 · ① 16-5 소멸 = 지급 크레딧 몫만(fromBase · 폴백 기본분 버킷) · ≤ 환불 뒤 양수 · 시험 2사례 ② 16-1 바꾸는 문장에 DO UPDATE SET · 변이 ③ 16-1 ① 층 = 칸 이름 든 모든 글(대소문자 무관 · 이어 붙이기 합침 · 오류 안내만 문맥 예외) · 변이 |
| 설계 4R | needs-attention · ① high 구성분 모르는 옛 split 환불은 끝난 기본분을 구매분으로 살림 ② medium 템플릿 안 템플릿의 칸 이름이 ① 검사에서 빠짐 ③ medium 변수로 나눈 UPSERT 가 DO UPDATE SET 검사를 우회 | 셋 다 수용 · ① 16-5 구성분 모름 + 수명 경계 뒤 환불 = 보류 · 경보 · 시험 ② ③ 16-1 TypeScript 구문 나무 수집 · 상수 접기 · 안 접히는 식 = 면제 안 함 · 변이 시험 8꼴(빨간불) + 정상 2꼴(통과) 실행 확인 |
| 설계 5R | needs-attention · ① medium 파일 전체 const 표 = 같은 이름 다른 범위 값으로 접혀 숨긴 UPSERT 통과 ② medium 칸 이름을 const 에 두고 동적 꼬리를 붙이면 접기 실패로 칸 이름이 사라져 통과 · 범위 밖 메모 = 되돌림이 보류(held)를 실패로 안 셈 | 둘 다 수용 · ① 16-1 한 번만 선언된 const 만 접음(다른 범위 · let · 매개변수 · import 같은 이름 = 접지 않음) ② 16-1 부분 값(참조 const 값 포함) 검사 · 안 접히는 `plans` 쓰기 거부 · 변이 4꼴 추가(빨간불 확인) · 메모 = 16-5 구현에 포함(되돌림 결과 held = 실패 셈 · 경보) |
| 설계 6R | needs-attention · ① medium `import x = require()` 바인딩을 안 모아 다른 범위 같은 이름 const 로 접힘 ② medium 별칭 있는 동적 `UPDATE plans p SET` 가 대상에서 빠짐 · **같은 부류 세 번째(4R-3 · 5R · 6R)** → 개별 수정 금지 · 왜 반복되나 = 이름 해석을 손으로(선언 모으기) · 쓰기를 문법 꼴 하나씩(블록 목록) 흉내 냄 | 구조 처방 · ① 이름 해석 = 컴파일러 결속(모든 바인딩 꼴 · 다른 파일 const 까지 정확히 · 손 수집 코드 삭제) ② 쓰기 대상 = PG 문법(쓰기 낱말 바로 뒤 표 이름 · 별칭 무관) · 면제 문장 = 허용 목록(첫 꼴 + 쓰기 낱말 0 + 한 문장 · SQL_WRITE 삭제) · 경계(실행 중 정해지는 이름) 실측 · 문서화 · 변이 9꼴 빨간불 + 거짓 빨간불 0 2꼴 실행 확인 |
| 설계 7R | needs-attention · ① medium 글 안 `--` 를 주석으로 지워 `SELECT '--', …; UPDATE plans …` 가 허용 꼴로 통과 ② medium SQL 거름에 TRUNCATE 가 없어 동적 `TRUNCATE plans` 가 대상에서 빠짐 · 같은 뿌리(SQL 을 정규식으로 읽음) | 둘 다 수용 · 구조 처방 = SQL 토큰기 하나(글 · E 글 · 달러 글 · 따옴표 이름 · 줄 · 중첩 주석 구분)로 문장 수 · 첫 꼴 · 쓰기 낱말 · 쓰기 대상 · SQL 여부 판정(정규식 판정 3개 삭제) · 동적 요금제 표 쓰기 = SQL 거름과 따로 · 변이 6꼴 빨간불 + 거짓 빨간불 0 1꼴 실행 확인 · 같은 회차에 16-5 소멸 상한 정정(구현 준비 중 발견 · 위 16-5) |
| 설계 8R | needs-attention · 상한 삭제 = 부채 취소 · 보류 불변식과 충돌 0 · ① medium CR 로 끝나는 줄 주석(토큰기는 LF 만) ② medium 비ASCII 달러 태그(토큰기는 ASCII 만) ③ medium DROP TABLE 둘째 대상 · 같은 부류(토큰기 ≠ PG 어휘 · 문법) | 셋 다 수용 · 구조 처방 = 면제 문장은 어휘 허용 목록(평범한 SQL 만 · 토큰기 충실도와 무관하게 닫힘) · 동적 경로 토큰기 = PG scan.l 규칙(CR · 비ASCII 태그 · U& 이름 · 빈칸이 글 안이면 경계 무시 재검사) · 표 목록 순회 = TRUNCATE · DROP 한 함수 · 변이 7꼴 빨간불 + 거짓 빨간불 0 1꼴 · 보수적 실패 1꼴 실행 확인 |
| 설계 9R | needs-attention · ① medium 글 밖 빈칸(prefix = `1 --`)이 실행 때 주석을 열어 뒤 글 안 `TRUNCATE plans` 가 실행되는데 재검사는 빈칸이 글 안일 때만 돌았다 | 수용 · 처방 = 동적 식은 언제나 경계 무시 재검사(빈칸 위치 추적 장치 삭제 · 코드 줄어듦) · 변이 1꼴 빨간불 · 실제 소스 거짓 빨간불 0 실행 확인 |
| 설계 10R | needs-attention · ① medium 경계를 지운 재검사가 `TRUNCATE/*note*/plans` 의 주석 본문을 표 이름으로 읽어 놓침 | 수용 · 처방 = 경계 지우기 삭제 → 쓰기 낱말 후보 자리마다 그 자리부터 PG 토큰(주석 · 따옴표 이름 뜻 보존) · 쓰기 낱말과 표 이름 사이 빈칸 · 빈칸 스키마 건너뜀(④-1 에 내가 물은 꼴도 닫음) · 변이 3꼴 빨간불 · 거짓 빨간불 0(USING · SELECT 읽기) 실행 확인 |
| 설계 11R | needs-attention · ① medium 주석 안 빈칸이 주석을 닫아 뒤 정적 `plans` 가 코드가 되는 꼴(`'TRUNCATE /*' + endComment + 'plans CASCADE'`) · **같은 부류 다섯 번째(7R~11R · 동적 SQL 을 토큰으로 해석)** | 구조 처방 · 동적 SQL 토큰 해석 삭제(쓰기 대상 문법 · 후보 자리 재검사 · 경계 처리 함수 전부 지움) → 정적 글에 쓰기 낱말 + plans(또는 U&) 공존 = 대상 · 정상 3곳 = 사람 판정 지문 표(이유 · 낡은 지문 = 실패) · 토큰기 = 면제 문장(평범한 SQL) 부분집합만 · 변이 전 꼴 빨간불 · 판정 지문 통과 · 실제 소스 거짓 빨간불 = 지문 3곳뿐 실행 확인 |
| 설계 12R | needs-attention · ① medium 빈 빈칸이 `U&` 와 따옴표 사이를 갈라 U& 표기를 놓침(`'TRUNCATE U&' + gap + '"\\0070lans"'`) | 수용 · 처방 = 표 이름 후보를 PG 식별자 표기 전부로(맨 낱말 plans · 따옴표 이름 내용 = plans · `&"` · 여는 따옴표 앞 빈칸) · 빈칸 비움 · 띄움 두 가지로 이어 봄 · 변이 5꼴 빨간불(U&+빈칸 · U+빈칸+& · 빈칸+따옴표 · 따옴표 안 빈칸 · 쓰기 낱말 안 빈칸) · 회사 병합 꼴(이름 전체 빈칸) 거짓 빨간불 0 · 실제 소스 지문 3곳 그대로(따옴표만으로 잡으면 7곳 = HTML 틀 · 회사 병합까지 걸려 좁혔다) 실행 확인 |
| 설계 13R | needs-attention · ① medium 앞쪽 주석의 큰따옴표가 짝 짓기를 어긋나게 해 `U&"…"` 를 놓침 ② medium 빈칸마다 비움 · 띄움이 섞이면(`'TRUN'+a+'CATE'+b+'plans'`) 일괄 치환 두 가지로 못 봄 | 둘 다 수용 · 처방 = 일괄 치환 · 짝 짓기 삭제 → 글자 사이 빈칸(0개 이상)을 허용하고 빈칸을 경계로도 보는 낱말 정규식(빈칸마다 따로) · 따옴표는 하나하나의 앞뒤만 · 빈칸 앞 따옴표 규칙은 닫는 따옴표까지(회사 병합 `"${t}"` 거짓 빨간불 0) · `<` 로 시작하는 HTML 틀 = SQL 아님(PG 구문 분석 근거) · 변이 2꼴 빨간불 + HTML 음성 · 빈칸 앞 `<` 양성 실행 확인 · 실제 소스 지문 3곳 그대로 |
| 설계 14R | needs-attention · 낱말 경계 · `<` 근거(단순 · 확장 프로토콜) = 지적 0 · ① medium 닫는 따옴표까지 빈칸이 대는 꼴(`'TRUNCATE ' + p + '"\\0070lans' + q`) · **따옴표 주변 빈칸 위치 부류 세 번째(12R~14R)** | 구조 처방 · 따옴표 위치 규칙 3개 삭제 → 정적 큰따옴표가 하나라도 있으면 후보 + 정적 유니코드 이스케이프도 후보(따옴표를 전부 빈칸이 대는 꼴) · 경계 = UESCAPE 빈칸 · 판정 지문 +2(청구 발행 SELECT · 회사 병합 · plans 에 company_id 없음 실측) · 변이 3꼴 빨간불(14R · 따옴표 전부 빈칸 · 회사 병합 꼴 = 보수적 실패) 실행 확인 |
| 설계 15R | needs-attention · 새 판정 지문 두 곳 = 지적 0 · ① medium 정적 UESCAPE 사용자 지정 이스케이프(`'TRUNCATE ' + p + '!0070lans' + q + " UESCAPE '!'"`)가 ③ 을 비껴감 · 처방 제안 = 빈칸 지운 글의 hex 4자리 | 수용(처방은 바꿈) · 정적 UESCAPE 낱말 = 후보 ④ + 기본 이스케이프 숫자 사이 빈칸 허용 · 제안한 hex 4자리는 실측 24곳(문자 큐 상태 9999 · 날짜 · UUID)이 걸려 불수용(판정 지문 19개 = 정상 수정마다 빨간불) · UESCAPE 빈칸 = 모델 경계 그대로 · 변이 2꼴 빨간불 · 실제 소스 지문 5곳 그대로 실행 확인 |
| 설계 16R | needs-attention · ① medium 기본 이스케이프 `\` 를 빈칸이 대는 꼴(`'TRUNCATE U&' + p + '0070lans' + q`) = UESCAPE 없이 문자가 `\` 로 고정이라 모델 경계 아님 | 수용 · 처방 = ③ 도입자를 정적 `\` 또는 빈칸으로 · ⑤ 정적 U& 표기 후보 · 변이 2꼴 빨간불(정적 U& · U& 까지 빈칸) · 실제 소스 지문 5곳 그대로(새 거짓 빨간불 0) 실행 확인 |
| 설계 17R | **approve** · 지적 0(모델 경계 안에서 ①~⑤ 를 우회하는 정적 표기 반례 없음 · PG 식별자 문법 대조) | 설계 리뷰 닫힘(1~17R) |

### 16-10. 구현 기록 (1101 밤 ~ 1102)
- P3 넓힘: 설계 목록(15-3) 밖 같은 부류를 기계로 뽑아 함께 옮김(단가 합 · 조건으로 0 · 묶음 판정). 금액 규칙 = `ai-credit-price.ts`(`duePrice` 크레딧제 아님 · 이미 냄 = 0 · `aiLineBasePrice` · `genSourceOf` · `channelMakePrice`) · 진입점 금액 = `ai-credit-context.ts` `entryCreditCost`(바깥 묶음 = 0 · callAIWithFallback · 진단 · 인앱 생성 · 다목표). 계약 ⑧ = CT 밖 단가 `+` `−` 0 · `isInCreditBundle` 0. 수량 × 단가는 규칙 아님(대상 밖).
- A 범위 판정: 「주기 작업 반복문의 catch 안 항목마다 경보」(원인 하나가 N 항목을 막으면 N 통 · 1101 월 마감 꼴)만. 감시 경보(자사몰 침묵 · 싱크 적재 실패 등 · catch 밖 · 항목별 긴 쿨다운 · 보낸 수로 다음 판정)는 항목마다 알리는 것이 일이라 대상 아님. 바꾼 곳 = 월 마감 · 대조 · 발송 크레딧 되돌림 · 일일 예측 · 체험 강등 · 기간 정산 · 자사몰 토큰 유지 · 게이트웨이 템플릿 매핑 push · DM 마감 추첨 · 미청구 초과(그 달 1통). 계약 ⑥ = 주기 파일 전수 기계 추출(직접 · 한 단계 간접).
- 겹침: 여정 · 엔진 재설계 작업이 `routes/ai.ts` · `continuous-operator.ts` · `root-ledger.test.ts` · 여정 파일을 고치는 중 → 이 작업의 그 파일 변경은 되돌려 두고 미룬 묶음(그 작업 커밋 뒤 적용 · 스크립트 = 이 작업 scratchpad `r39/co_revert.py apply` · `deferred_root_ledger.py`)으로. 그동안 계약 ① ③ ⑥ ⑦ · 대장 R1 · R4 넓힘 ② · R8 #71 · R38 이 빨간불(그 묶음이 닫는다).

- 축 밖 기록(구현 1R-2 와 같은 꼴 · 이 작업 전부터 있음 · 다른 기능 · 착수 판단 = Harold): 회사 · 항목 없는 공용 키로 보내는 경보 중 한 번뿐인 사건일 수 있는 자리 = `agency-send-mail-worker.ts:612` 모르는 발신자 · `cdp-webhook-retry-worker.ts:62` 웹훅 재시도 소진 · `expired-pending-sweeper.ts:68` 이상 상태 닫음 · `retention-sweeper.ts:108 · 111` 보관 기한 PDF · `spam-probe.ts:246` 판정 뒤 결과 · `kakao-template-sync.ts:62` 목록 상한 · `journey-pretest-notifier.ts:414 · 426` · `journey-anchor-scheduler.ts:621`(여정 세션 파일). 그 밖 공용 키(로그인 실패 · 폴링 실패 · 밀림 · 적체 · 접속 불가 · 드리프트 · 인증 오류 등)는 이어지는 상태 경보라 공용 키가 맞다.

### 16-11. Codex 구현 리뷰
| 회차 | 판정 · 지적 | 처리 |
|---|---|---|
| 구현 1R(변경 전체 110파일 + 미룬 묶음 글) | needs-attention · ① high 보류 환불은 환불 줄을 안 남겨 오래된 후보가 LIMIT 앞자리를 계속 차지 → 뒤 정상 후보가 굶다 7일 창 밖으로 사라짐 · 보류는 실패 집계에서도 빠짐 ② medium 모아 보내는 경보 키 = 이름 + 날짜(6시간)라 A 를 알린 뒤 쿨다운 안에 생긴 다른 한 번뿐인 확정 실패 B 가 버려짐 | 둘 다 수용(이번 변경이 만든 것) · ① = 결말별 기다림(보류 · 되돌릴 수 없는 꼴 24시간 · 다른 길 환불 24시간 + 끝난 일 · 예외 30분)을 LIMIT 앞 SQL $3 로 뺌 + 기간 끝 하루 전 후보 = 수동 환불 경보 · 보류를 패스 실패에 또 넣지 않음(경보 자리 = 환불 CT 한 곳 · 두 통 방지 · ⑤ 근거) ② = 경보 CT 가 항목(key)을 기억 · 안 알린 항목이 있을 때만 · 이름당 1시간 1통 · 못 보낸 항목은 다음 통에 · 10분 타이머가 다시 보냄 · 같은 뿌리 = reportCreditMiss(공용 키) · 미청구 초과(달 키)도 같은 함수로 · 시험 = 반례 그대로(변이 확인) · 실 PG 새 SQL 3건 |
| 구현 2R(1R 고친 줄 + 바로 부르는 곳) | needs-attention · ① high 보내는 동안 같은 이름에 들어온 B 까지 「보냄」으로 지움(사건 경로 reportCreditMiss 는 비동기라 겹침 가능) ② medium 다시 보내기가 다른 이름을 기다리는 동안 이미 지나간 이름에 들어온 항목이 있어도 순회 중 센 값 0 이면 타이머를 끔 ③ medium 기간 끝 조회가 오래된 100건만 되풀이해 101번째가 경보에 안 실림 | 셋 다 수용(1R 처방이 만든 것 · 같은 뿌리 = 「못 실은 것이 조용히 사라짐」) · ① 보낼 항목 고정 · 성공한 것만 끝냄 · 같은 이름 한 통씩 ② 끄기 직전 동기 재확인 · 반환 = 끝난 뒤 다시 센 수 ③ 실은 키 6시간 LIMIT 앞에서 뺌 · 같은 뿌리 함께 = acceptKey 거절 키 하루 뺌 · 남은 항목 상한 넘은 수를 다음 통에 · 시험 = 반례 그대로 3건 + 변이 3건(빨간불 확인 · 원본 복원) |
| 구현 3R(2R 고친 줄) | needs-attention · ① high 기간 끝 후보 601건(1시간 주기)이면 6시간 뒤 다시 실을 키가 처음 실을 키의 조회 자리를 다시 차지 → 601번째가 기간 끝까지 안 실림 | 수용 · **같은 부류 세 번째(1R-1 · 2R-3 · 3R-1 = 「오래된 순 LIMIT N」을 작업 큐로 쓰고 진행을 빼기 집합으로 덧댐 · 빼는 시간이 유한하니 막힌 항목이 용량 × 그 시간을 넘으면 다시 막힘)** → 구조 처방: 후보 = 커서 순환(시각 · 키 뒤부터 · 덜 차면 처음부터 · 한 바퀴 안에 전부) · 기간 끝 경보 = 회사별 수 · 크레딧 집계(LIMIT 없음) · 덧댄 agingNoted 삭제(코드 줄음) · 시험 = 601건 반례(실 PG) · 커서 무시 변이 빨간불 · 교훈 메모리 feedback_work_queue_needs_progress_guarantee |
| 구현 4R(3R 구조 처방) | needs-attention · ① high 커서가 「덜 차면 처음부터」로만 돌아 회차마다 새 후보가 LIMIT 만큼 이어지면 바퀴가 안 돌고 커서 앞의 실패 건(30분 뒤 다시)이 다시 시도되지 못한 채 7일 창 밖으로 | 수용(3R 처방의 빈틈 · 같은 구조 안) · 바퀴 상한 = 바퀴 시작 때 DB NOW() 고정($6 · bound_text 로 다음 회차에 그대로) · 상한까지 다 보면 새 유입과 무관하게 새 바퀴 · 시험 = 회차마다 꽉 찬 유입 반례(단위) + 상한 뒤 줄 제외(실 PG) · 변이 두 개 빨간불 · 원본 복원 |
| 구현 5R(4R 고친 줄) | **approve** · 지적 0(상한 유지로 새 유입에도 바퀴 끝남 · 같은 시각 줄 = 키로 구분 · 상한과 같은 시각 포함 · 늦게 커밋된 줄 = 다음 바퀴 · 상한 조건 LIMIT 앞) | 이 작업 트리 몫 구현 리뷰 닫힘(1~5R) · 남은 것 = 미룬 묶음 적용분(여정 세션 커밋 뒤) 증분 라운드 |

## 17. 한 번뿐인 사건 경보 = 항목 키로 모아 보내기 (R14 넓힘 · 1102)

접수(Harold 1102): 「다른 기능 공용 키 경보 → 모아 보내기 편입」(16-10 축 밖 기록에서 이어짐) · 「끝까지 · 설계 Codex 닫힐 때까지 · 구현 · 배포 명령」. 상태 = **설계 Codex 4R approve**(17-8) · **구현 Codex 3R approve**(17-9 · 크레딧 미룬 묶음 포함) · 배포 = C94(배포 앞 DDL 1).

### 17-1. 뿌리 · 판정 기준
- 뿌리 = 대장 R14(감지했는데 사람에게 안 닿음). 감지한 뒤 닫히는 사건(반려 · 실패로 닫음 · 경로 비움 · 인수)을 사건보다 굵은 키(상수 · 메일함 · 회사)로 보내면, 쿨다운 안에 생긴 다른 사건은 어디에도 다시 실리지 않는다(구현 1R-2 와 같은 꼴 · 이번엔 다른 기능).
- 자리마다 세 질문. **셋 다 해당하면 결함**(항목 키로 옮긴다).
  1. 감지 뒤 그 사건이 닫히는가(다음 주기에 다시 감지되지 않는다)? 아니면 이어지는 상태 = 공용 키가 맞다(남아 있으면 쿨다운 뒤 다시 알린다 · 쿨다운 = 되풀이 억제).
  2. 사건마다 사람이 따로 할 일이 있는가(고객 연락 · 수동 환불 · 파일 삭제 · 재시작)? 원인 하나의 증상이고 할 일이 같으면 공용 키가 맞다.
  3. 그 사건을 사람에게 따로 전하는 길이 없는가? 요청자가 실패 응답을 받거나, 담당자 안내 원장 + 상황판이 맡으면 경보는 원인 신호라 공용 키가 맞다.

### 17-2. 전수 (`sendSystemAlert` 호출 93곳 · 1102 기계 추출)
- 키에 사건 id 가 든 곳 40 = 이미 사건 단위(캠페인 · 접수 · 주문 · 검사 · 판 · 단말 등) · 대상 아님.
- 상수 키 27 + 계산 키 1 + 단위 키 25 = 아래 표 53곳.

| 자리(파일:줄) | 키 | 판정 | 근거(질문 번호) |
|---|---|---|---|
| agency-send-mail-worker.ts:610 | `agency-mail-unknown-sender` | **옮김 A1** | 미등록 발신 메일은 반려 · 회신 없이 끝(1) · 그 주소가 고객이면 등록 · 안내가 따로 필요(2) · 회신이 없어 다른 길 없음(3) · 둘째 고객 메일이 6시간 안이면 영영 모름 |
| agency-send-mail-worker.ts:319 | `agency-mail-claim-exhausted:${mailbox}` | **옮김 A2** | 그 메일 = 실패로 닫힘(1) · 보낸 분께 알릴 일이 메일마다(2) · 회신 없음(3) · 같은 메일함 1시간 안 둘째 메일이 버려짐 |
| agency-send-worker.ts:1862 | `agency-dispatch-stuck` | **옮김 A3** | 인수한 시도는 닫힘(1) · 붙잡힌 연결 = 재시작이 사건마다(재시작 뒤 새 사건 = 새 할 일)(2) · 다른 길 없음(3) |
| expired-pending-sweeper.ts:66 | `queue-abnormal-status-closed` | **옮김 A4** | 닫은 행은 다시 안 걸림(1) · 48시간 지나 값이 깨진 행은 1분 안에 닫혀 감시(5분)가 못 봄 = 이 경보가 유일(3) · 재발 = 서버 점검 다시(2) · 12시간 안 재발이 버려짐 |
| retention-sweeper.ts:108 | `retention-pdf-outside` | **옮김 A5** | 경로를 비워 다시 안 걸림(1) · 그 파일 직접 삭제가 작업마다(2) · 다른 길 없음(3) · 배포 재기동 10분 뒤 회차가 6시간 안이면 버려짐 |
| routes/campaigns.ts:413 · 417 · 515 · 519 | `test-refund-miss:${companyId}:${type}` | **옮김 B1** | 요청마다 고유 참조(TEST_REF)의 환불 실패 = 돈 항목(1) · 수동 환불이 요청마다(2) · 캠페인 레코드가 없어 의무 기록 불가(3) · 같은 회사 · 종류 6시간 안 둘째 환불이 버려짐 |
| journey-pretest-notifier.ts:258 | `journey-pretest-bundle-error:${journeyId}` | **옮김 C1**(17-4) | 주기 패스 반복문 catch = 원인 하나에 N통(크레딧 A 꼴) · 계약 ⑥ 이 타이머 없는 파일이라 못 봄 |
| journey-pretest-candidate.ts:165 | `journey-pretest-regen-refund:${snapshotId}` | **옮김 C1**(17-4) | 위와 같음(재작성 차감 환불 대조 실패 · 돈) |
| continuous-operator.ts:3065 | `operator-release-fail:${company_id}` | 미룬 묶음 1(F5) | 되돌림 CT 로 옮김(§16 · 패스 경보) |
| journey-executor.ts:330 · journey-anchor-scheduler.ts:604 | 여정 · 실행 단위 | 미룬 묶음 6 | 반복문 catch(계약 ⑥) |
| agency-send-mail-worker.ts:1235 · 1247 | 로그인 · 폴링 실패 | 남김 | 이어지는 상태(1) |
| agency-send-mail-worker.ts:622 · 976 | 귀속 비활성 · 청구 계정 모호(주소 · 회사) | 남김 | 설정 상태 = 고칠 때까지 메일마다 다시(1) |
| agency-send-worker.ts:1959 | `agency-worker-stage-stall:${name}` | 남김 | 상태(1) |
| cafe24-client.ts:461 | API 판 거절 | 남김 | 모든 호출이 다시 실패 = 상태(1) |
| cdp-webhook-retry-worker.ts:60 | `cdp-webhook-exhausted` | 남김 | 하루 창 집계(24시간) > 쿨다운(12시간) → 쿨다운 안 사건도 다음 경보 수에 다시 실림(1) |
| cdp-webhook-retry-worker.ts:82 · direct-send-worker.ts:394 · gateway-template-mapping-worker.ts:198 · 325 · pay-ingest-monitor.ts 3곳 · system-monitor-worker.ts:81 · 189 · kakao-template-sync.ts:62 | 적체 · 남은 행 수 · 인증 · 드리프트 · 통계DB · 상태값 · 큐 지연 · 목록 상한 | 남김 | 이어지는 상태(1) |
| journey-anchor-scheduler.ts:620 · 635 · journey-executor.ts:353 · journey-trigger-watcher.ts:212 · spam-test-queue.ts:837 · journey-pretest-notifier.ts:158 | 밀림 · 옛 판 수 · 예산 · 판 칸 | 남김 | 수 · 상태(1) |
| journey-pretest-notifier.ts:436 | `journey-pretest-recheck-error` | 남김 | 원인 하나(검사 큐 · 시험 폰)의 증상 · 발송은 이어짐(2) |
| journey-pretest-notifier.ts:479 | `journey-pretest-new-copy-late` | 남김 | 판마다 담당자 안내 원장이 맡음(3) |
| journey-pretest-notifier.ts:549 · journey-result-notice.ts:258 · continuous-operator.ts:2764 · 4682 · 939 | 안내 포기 · 회차 보류 · 제안 닫기(여정 · 운영자) | 남김 | 안내 원장 · 상황판 · 담당자 직접 통지가 항목을 맡고 경보는 그 전달 경로(원인 하나)를 알림(3) · 여정 설계 「그 여정 · 원인 하나」 |
| journey-executor.ts:764 | `journey-pretest-late:${journey_id}` | 남김 | 실행이 기다리며 다시 감지 = 상태(1) |
| journey-activation.ts:182 · journey-anchor-scheduler.ts:496 | `journey-activate-revert:${journeyId}` | 남김 | 항목 = 그 여정 켜기(같은 여정 = 같은 일) |
| plan-change-log.ts:263 | `plan-change-miss:${companyId}` | 남김 | 요청자(관리자 · 고객)가 실패 응답을 받음(3) · 같은 회사 = 같은 할 일(재시도) |
| plan-term.ts:319 | `plan-term:${종류}:${회사}` | 남김 | 매 주기 다시 감지 = 상태(1) |
| planner-approval.ts:242 | `planner-refund-miss:${companyId}:${planMonth}` | 남김 | 키 = 돈 항목 하나(그 달 대행료 · 취소는 멱등) |
| cdp-auth.ts:464 · spam-probe.ts:67 · mall-watch-worker.ts:77 | 그 달 상한 · 단말 · 모르는 상태값 | 남김 | 상태(1) |
| retention-sweeper.ts:111 | `retention-pdf-delete-fail` | 남김 | 지우지 못한 줄은 남아 다음 날 다시(1) |
| spam-probe.ts:244 | `spam-verdict-after-decided` | 남김 | 하루 한 번 측정 · 날이 다르면 24시간 > 쿨다운 6시간 · 같은 날 재측정 = 같은 자료(1) |

### 17-3. 경보 CT 변경 (`system-alert.ts` `alertPassFailures`)
- **사건 모드** = `total` 을 넘기지 않는다. 첫 줄 = 「새 N건」(주기 모드 = 종전 「새 실패 N곳 · 마지막 주기 실패 M곳 / 대상 T곳」 · 재기동 뒤 마지막 주기 수를 모르면 「새 실패 N곳 / 대상 T곳」) · 항목 글은 숫자를 그대로 둔다(주기 모드 = 숫자를 N 으로 묶어 같은 원인을 한 줄로) · 줄 = 글(같은 글이 여럿이면 뒤에 「(N건)」 · 주기 모드 = 종전 「오류 N곳: 글」).
- 같은 뿌리 함께(크레딧 작업 · 같은 배포): `reportCreditMiss` · 미청구 초과(`credit-overage-unreduced`)는 사건 경로인데 `total: 1` 이라 문자가 「마지막 주기 실패 1곳 / 대상 1곳」으로 나간다 → 사건 모드.
- **못 보낸 항목 = PG 원장 `system_alert_pending`**(설계 1R-1 · 옛: 프로세스 메모리라 쿨다운 1시간 안에 배포 재기동이 오면 한 번뿐인 사건이 사라졌다 · 크레딧 작업의 사건 경로 `reportCreditMiss` 에도 같은 구멍).
  - 칸 = 이름(pass) · 항목 키 · 회사 · 글 · 머리 · 할 일 · 대상 수(NULL = 사건 모드) · 들어온 시각 · 기본키 (이름, 항목 키). DDL = 배포 앞(더하기만 · 옛 코드 영향 0 · 원장 블록).
  - 넣기 = 사내 회사 거름 → 6시간 안에 알린 항목 거름 → `INSERT … ON CONFLICT (pass, item_key) DO NOTHING`(같은 항목 = 한 줄 · 처음 들어온 글 그대로). 함수 둘:
    - `persistPassFailures(o) → 참 · 거짓` = 원장에만 쓴다(메모리 대기 없음) · 참 = 거른 뒤 남은 항목이 전부 원장에 있다(남은 항목 0 이면 참).
    - `alertPassFailures(o)` = `persistPassFailures` → 거짓이면 종전 메모리 대기(상한 500 · 넘은 수)로 받고 로그 한 줄 → 보내기. 닫기가 없는 경보(B1 · A3 · 주기 패스 · 크레딧 사건)만 쓴다.
  - **닫기 계약**(설계 2R 구조 · 1R-1 · 2R-1 · 2R-2 = 같은 부류 「영속 기록 없이 사건을 닫는다」 두 번째): 사건을 닫는 자리(A1 · A2 · A4 · A5)는 `persistPassFailures` 가 참일 때만, 그리고 **기록한 항목만** 닫는다(A1 · A2 = 그 한 줄 · A5 = 기록한 작업 id 만 · A4 = 기록한 캠페인:값 묶음만 UPDATE 조건에). 거짓이면 닫지 않는다 → 사건이 남아 다음 주기에 같은 키로 다시. 닫는 쓰기가 다른 DB(A4 = MySQL)여도 같은 규칙(원장 커밋이 먼저 · 닫기 실패 = 다음 분에 같은 키).
  - 메모리 대기 항목은 보낼 때마다 먼저 원장으로 옮겨 본다(DB 가 돌아오면 원장으로 · 그 뒤 쿨다운 판정).
  - 원장 표가 없으면(42P01 · 배포 앞 DDL 빠짐) 닫는 자리는 닫지 않고 멈춘다(fail-closed · 사건은 남는다) + 상태 경보 「경보 원장 표 없음 · DDL 필요」(상수 키 · 이어지는 상태 · 메모리 길로 나감).
  - 넣는 글 = NUL 문자 제거 · 칸마다 길이 상한(독 항목 하나가 닫기를 영영 막지 않게).
  - 남은 한계(원장에 쓸 길이 없는 경우뿐): DB 장애 중 생긴 닫기 없는 사건(B1 · A3 · 크레딧 사건)이 DB 회복 전에 재기동을 만나면 사라진다 · 그 사건의 로그 줄은 남는다.
  - 교훈 LESSONS_BACKEND 0731(「best-effort 경보 위에 행 단위 1회 전달을 쌓지 마라 · 감시는 수 + 공용 키」)과의 경계: 그 교훈은 남아 있어 다시 감지되는 행의 감시다(공용 키가 맞다 · 17-2 남김). 이 원장은 감지 뒤 닫혀 다시 감지되지 않는 사건만 받고, 지우기는 `sendSystemAlert` 가 1 이상(실제 적재 · 공용 입구 성공)을 돌려준 때만 · 쿨다운 · 수신자 없음 · 적재 0 = 0 = 남김 · 같은 이름 한 번에 한 통 · 보낸 줄만 지워 다음 읽기가 다음 줄(굶음 없음).
  - 보내기(이름마다 · 한 번에 한 통) = 그 이름의 원장 줄을 들어온 순으로 읽는다(한 번에 1,000 · 넘으면 「남은 항목은 다음 통」 줄) + 메모리 대기 → 한 통 → 성공하면 **읽은 키만** 지운다(보내는 동안 들어온 줄은 남는다 · 2R-1 성질 그대로). 지우기가 실패하면 다음 통에 다시 실린다(중복 · 사라짐 아님).
  - 다시 보내기 = 늘 도는 10분 타이머(원장에 줄이 있는 이름 + 메모리 대기 이름 전부) · 켜는 곳 = 부팅(app.ts `startPassAlertFlusher` · 재기동 뒤 남은 줄을 바로 보냄) + 첫 경보(늦게라도 켜짐). 종전의 「끄기 직전 다시 세기」(2R-2) 장치는 늘 도는 타이머로 없어진다.
  - 알린 항목(6시간) · 마지막 주기 수는 메모리 그대로 = 재기동하면 같은 항목을 한 번 더 알릴 수 있다(중복 · 사라짐 아님).
  - ponytail: 받는 사람이 아예 없는 환경(SYSTEM_ALERT_PHONES · 공용 입구 둘 다 없음)은 줄이 쌓인다 · 운영은 둘 다 있다 · 정리 규칙은 그때.
  - 문장(PG 15 · 새 SQL = 실 PG 시험 뒤):
    ```sql
    -- DDL(배포 앞 · 더하기만)
    CREATE TABLE IF NOT EXISTS system_alert_pending (
      pass text NOT NULL, item_key text NOT NULL, company_id text, error text NOT NULL,
      title text NOT NULL, action text NOT NULL, total integer, created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (pass, item_key));
    -- 넣기
    INSERT INTO system_alert_pending (pass, item_key, company_id, error, title, action, total)
      SELECT $1, k, c, e, $5, $6, $7::int FROM unnest($2::text[], $3::text[], $4::text[]) AS u(k, c, e)
      ON CONFLICT (pass, item_key) DO NOTHING;
    -- 보내기 읽기(이름마다) · 성공 뒤 읽은 키만 지우기 · 타이머의 이름 목록
    SELECT item_key, company_id, error, title, action, total FROM system_alert_pending WHERE pass = $1 ORDER BY created_at, item_key LIMIT 1000;
    DELETE FROM system_alert_pending WHERE pass = $1 AND item_key = ANY($2::text[]);
    SELECT DISTINCT pass FROM system_alert_pending;
    ```
  - 머리 · 할 일 · 대상 수 = 같은 프로세스의 마지막 부름 값(메모리) · 없으면(재기동 뒤) 읽은 줄 중 마지막 줄 값.
- **먼저 넣고 닫는다**(설계 1R-1 · 닫기와 전달 의무 사이 창): 위 닫기 계약대로 원장 커밋 → 닫기 → 보내기(기다리지 않음). 닫기가 실패해 다음에 다시 감지되면 같은 키라 한 줄 그대로. 요청 경로(B1)는 닫기가 없어 `alertPassFailures` 의 넣기까지 응답 전에 기다리고 보내기만 비동기.
- 사건 모드에서 새로 들어온 항목은 CT 가 로그 한 줄(이름 · 키 · 글)을 남긴다 — 문자에는 글 셋까지만 실리므로 나머지 항목을 로그에서 찾게(주기 모드는 부르는 쪽이 이미 항목마다 로그).
- 잡음 상한: 사건이 이어져도 이름당 1시간 1통 · 같은 항목은 6시간 안에 다시 알리지 않는다(A1 스팸 메일이 이어지면 시간당 1통 · 종전 6시간 1통).

### 17-4. 자리별 처방
| 번호 | 자리 | 이름(pass) | 항목 키 | 문자 줄(글) | 회사 |
|---|---|---|---|---|---|
| A1 | 미등록 발신 · 원장 기록 참일 때만 반려 | `agency-mail-unknown-sender` | 보낸 주소 소문자(주소 없으면 접수 id) | 보낸 주소 | null(발신자 판정 전 · R25 이유 그대로) |
| A2 | 선점 소진 · 원장 기록 참일 때만 실패로 닫기 | `agency-mail-claim-exhausted` | 메일함:uidl | 메일함 · uidl | null(같음) |
| A3 | 멈춘 시도 인수 뒤(`alertStuckAttempt(접수 id)`) | `agency-dispatch-stuck` | 접수 id | 예약 시각이 N분 넘게 지난 시도 | null(처리기 건강) |
| A4 | 이상 상태값 · 원장 기록 참일 때만 기록한 묶음 닫기 | `queue-abnormal-status-closed` | **캠페인(app_etc1 · 없으면 -):상태값**(설계 1R-2 · 닫기가 실패해 다음 분에 같은 행을 다시 봐도 같은 키 · 새로 깨진 다른 캠페인 · 다른 값만 새 항목) | 상태값 v · N행 | null(서버) |
| A5 | 보관 폴더 밖 경로 · 원장 기록 참일 때만 기록한 작업 경로 비우기 | `retention-pdf-outside` | 작업 id | 경로(앞 60자) · 전체 경로와 작업 id = 로그 한 줄 | null(저장소) |
| B1 | 테스트 발송 환불 미완 · 실패(4곳) · 응답 전에 넣기 | `test-refund-miss` | 요청 참조(TEST_REF):종류 | 미완 · 실패 · 종류 · 건수 | 그 회사(사내 거름) |
| C1 | 재작성 환불 대조 실패 · 묶음 예외 상한(반복문 catch · 주기 모드) | `journey-pretest-regen-refund` · `journey-pretest-bundle-error` | 판 id · 묶음 키 | 오류 앞 80자 | 그 회사 |

- A3 만 인수 뒤에 넣는다: 인수 결과(트랜잭션)를 알아야 사건이고, 인수와 넣기 사이에 프로세스가 죽으면 그 재기동이 붙잡힌 연결을 이미 푼다(경보가 요청하는 일 = 재시작이 끝남).
- A4 문자 = 「새 N건」(캠페인 · 값 묶음 수) + 「상태값 v · N행」 줄 · 묶음 조회는 종전 상태값 묶음 자리를 캠페인 · 값 묶음 하나로 바꾼다(MySQL 조회 수 그대로).
- A4 닫기(설계 2R-2): 묶음 조회 실패 = 이번 분 이상 상태값 닫기를 건너뛴다(다음 분) · 원장 기록 참 = 닫기 UPDATE 조건에 `CONCAT(COALESCE(app_etc1, ''), '|', status_code) IN (기록한 묶음)` 을 더한다 → 조회와 UPDATE 사이에 새로 깨진 다른 묶음은 이번에 닫지 않고 다음 분에 기록 · 닫기(종전 `markFailed` 에 바인드 칸만 더함). QTmsg 만료 닫기(①)는 그대로.
- 보내기는 기다리지 않는다(`void … .catch`) · 넣기만 기다린다.
- A5 후보 = 커서 순환(설계 3R · 메모리 `feedback_work_queue_needs_progress_guarantee` 구조 그대로): 지난 회차 마지막 (updated_at · id) 뒤부터 같은 순서로 1,000 · 덜 차면 다음 회차 새 바퀴 · **바퀴 상한 = 바퀴 시작 때 DB 의 「지금 − 90일」 고정**(다음 회차에 그대로 넘김 · 새로 90일을 넘는 줄은 다음 바퀴) · 커서 = 프로세스 기억(재기동 = 처음부터 한 바퀴). → 원장 표가 없어 닫지 못한 밖 경로 · 지우지 못한 파일 줄이 1,000 을 넘어도 뒤 PDF 가 그 바퀴 안에 지워지고, 닫지 못한 줄은 다음 바퀴에 다시 기록 · 닫기를 시도한다(종전 원장 #11 의 「오래된 순 LIMIT 1000」 = 막힌 줄 1,000 이면 정지 · 보관 기한 위반).
  ```sql
  SELECT id, pdf_path, updated_at::text AS at_text, COALESCE($3::timestamptz, NOW() - INTERVAL '90 days')::text AS bound_text
    FROM full_analysis_jobs
   WHERE status = 'done' AND pdf_path IS NOT NULL
     AND updated_at < COALESCE($3::timestamptz, NOW() - INTERVAL '90 days')
     AND ($1::timestamptz IS NULL OR (updated_at, id) > ($1::timestamptz, $2::uuid))
   ORDER BY updated_at ASC, id LIMIT 1000;   -- $1 · $2 = 커서(시각 글 · id) · $3 = 바퀴 상한 · 실 PG 15.15 에서 돎(1102)
  ```
- 계약 ⑥ 빈틈(C1 의 뿌리): 「주기 파일 = 그 파일에 setInterval · cron」 거름이라 타이머를 다른 파일에서 거는 패스(발송 전 검사 스캔)를 못 봤다 → ⑥ 대상 = routes 밖 전수 · 면제 = 요청 경로 함수(이유 · 지금 `createDirectSendCampaign` 하나).

### 17-5. 계약 · 시험
- **R14 넓힘**(root-ledger.test.ts): `sendSystemAlert` 의 상수 키 자리 = 이어지는 상태 표(키 → 이유)와 같다 · 새 상수 키 = 실패 · 낡은 줄 = 실패. 단위 키(메일함 · 회사 · 여정)는 기계로 못 가른다 → 대장 R14 점검표(구조체크 · Codex 요청문 ④ 에 17-1 세 질문).
- **R25 넓힘**: `alertPassFailures` 항목의 `companyId: null` 도 이유 목록(옮긴 자리의 NULL_OK 줄을 이름으로 옮긴다 · 사내 거름 보장 유지).
- **⑥**: 주기 파일 거름 삭제 · 변이 = 타이머 없는 패스 파일의 반복문 catch 경보는 잡힘 · 면제 함수는 안 잡힘.
- **단위**: 사건 모드 글(새 N건 · 숫자 그대로) · 주기 모드 글 그대로 · 자리마다 반례 = 서로 다른 사건 둘 → CT 에 서로 다른 항목 둘(상수 키로 되돌리는 변이 = 빨간불) · 같은 사건 다시 = 같은 항목.

### 17-6. 순서 · 배포
- **구현 전부 = 여정 세션 커밋 뒤 한 묶음**(설계 1R-3 · 파일이 겹치지 않아도 중간 상태가 계약을 깬다: A1~A5 를 먼저 옮기면 R25 NULL_OK 정확 일치가 깨지고 · ⑥ 을 먼저 넓히면 아직 안 옮긴 notifier 가 걸린다 · 여정 세션이 그 사이 시험을 돌리면 실패). 묶음 안 = CT · 원장 표 · A1~A5 · B1 · C1 · ⑥ · R14 · R25 계약 · 대장 R14 줄 · 크레딧 미룬 묶음(DEFERRED 1~9).
- 여정 커밋 전에 하는 것 = 설계 리뷰 · 미룬 묶음 스크립트를 사본에 얹어 보기(1102 넷 다 그대로 얹힘)뿐.
- 배포 = 여정 배포(C93)가 끝난 뒤 · 배포 앞 DDL 1(`system_alert_pending` 만들기 · 원장 블록) → 확인 출력 → 이 작업 파일 목록 커밋 · push → 빌드 · 재기동(백엔드 + 크레딧 묶음 프론트). 표가 없으면 닫는 자리가 멈추고(사건 남음) 「경보 원장 표 없음」 상태 경보가 나간다 = DDL 이 배포 앞이어야 하는 이유.

### 17-7. 축 밖 기록(착수 판단 = Harold)
- retention-sweeper.ts:111 삭제 실패 경보 본문의 작업 id(UUID)가 문자에서 걷혀 「작업 , 외」로 빈다(경보는 이어지는 상태라 그대로 · 글만 · 이 작업 전부터).
- 사건 id 키 경보 40곳의 보내기 실패(공용 입구 두 길 + 인증 문자 모두 실패) 뒤 재시도 없음 = R14 현 기준(두 길) · 이번 축(굵은 키)과 다른 면.

- 대행 메일 시도 상한에서 진짜 처리 오류로 끝나는 보통 행(판정 없음) = failed/4 로 조용히 종결(경보 없음 · 접수 패널에서만 보임) · 이 작업 전부터 · R14(감지 → 사람) 다른 면.
- (1102 다른 세션 진행 중) 여정 세션이 새로 만드는 상수 키 밀림 경보 셋(`operator-lag.ts` 두 곳 · `direct-send-worker.ts` `direct-send-queue-lag`)은 R14 넓힘 이어지는 상태 표 · R25 NULL_OK 에 줄이 있어야 대장 계약이 통과한다 = 그 세션 커밋 몫.

### 17-8. Codex 설계 리뷰
| 회차 | 판정 · 지적 | 처리 |
|---|---|---|
| 설계 1R | needs-attention · ① high 못 보낸 항목이 프로세스 메모리라 재기동하면 한 번뿐인 사건(A1 · A2 · A5 · B1)이 사라진다 · 닫기와 전달 의무를 묶어라 ② medium A4 회차마다 새 키 = 닫기가 실패하면 같은 행이 매분 새 사건 ③ medium 파일이 안 겹쳐도 중간 상태가 계약(R25 NULL_OK 정확 일치 · 넓힌 ⑥)을 깬다 | 셋 다 수용 · ① 원장 표 `system_alert_pending`(배포 앞 DDL) · 먼저 넣고 닫기 · 늘 도는 10분 타이머 + 부팅 보내기 · 같은 구멍인 크레딧 사건 경로도 함께 ② 키 = 캠페인:상태값 ③ 구현 전부를 여정 커밋 뒤 한 묶음으로(17-6) |
| 설계 2R | needs-attention · ① high 넣기가 실패해 메모리로만 받은 항목인데 닫기를 허용 → 재기동하면 원장에도 재감지에도 없음 · 표만 없어도 같음(「DDL 빠짐 = 경보 잃지 않음」 틀림) ② medium A4 묶음 조회 실패를 무시하면 항목 0 인 채 전부 닫음 | 둘 다 수용 · **같은 부류 두 번째(1R-1 · 2R-1 · 2R-2 = 영속 기록 없이 닫기)** → 구조: 닫기 계약(17-3) = `persistPassFailures` 참일 때만 · 기록한 항목만 닫는다 · A4 = 조회 실패면 건너뜀 + UPDATE 조건에 기록한 묶음 · 표 없음 = 닫기 멈춤 + 상태 경보 · 메모리 대기는 닫기 없는 경보만(보낼 때 원장으로 옮겨 봄) |
| 설계 3R | needs-attention · ① medium 원장 표가 없어 A5 밖 경로를 닫지 못하면 오래된 순 1,000 조회가 같은 줄만 골라 뒤 정상 PDF 를 영영 안 지움(원장 #11 이 막은 보관 기한 위반 재도입) | 수용 · 같은 부류 = 작업 큐 진행 보장(크레딧 작업 3R · 4R 의 구조) · A5 후보 = 커서 순환 + 바퀴 상한 고정(17-4) · 실 PG 로 문장 확인 |
| 설계 4R | **approve** · 지적 0(밖 경로 1,500 이 막혀도 뒤 정상 PDF 를 같은 바퀴에 처리 · 막힌 줄은 다음 바퀴 · 같은 시각 · 상한 경계 · 경로 비우기 갱신에 누락 · 반복 없음 · 조건 전부 LIMIT 앞) | 설계 리뷰 닫힘(1~4R) · 구현 = 여정 커밋 뒤 한 묶음 |

### 17-9. 구현 기록 (1102)
- 끝(여정 목록 밖 · 작업 트리): 경보 CT `system-alert.ts`(원장 넣기 · 사건 모드 · 닫기 계약 `persistPassFailures` · 메모리 대기 `queuePassFailures` · 이름 보내기 `flushPassAlerts` · 늘 도는 타이머 · 부팅 `startPassAlertFlusher` · 표 없음 상태 경보) · 크레딧 사건 경로 두 곳 사건 모드 · A1 · A2(`agency-send-mail-worker.ts`) · A3(`agency-send-worker.ts`) · A4(`expired-pending-sweeper.ts` · 묶음 조회식 = 닫기 조건 같은 글) · A5(`retention-sweeper.ts` · 커서 순환) · C1 재작성 환불 대조(`journey-pretest-candidate.ts`) · B1 도우미 `reportTestRefundMiss`(`prepaid.ts`) · 계약 ⑥ 넓힘(routes 밖 전수 · 면제 = 함수 이름 이유 · 낡은 면제 = 실패) · 시험용 내보내기 셋(`claimIntake` · `processMessage` · `alertStuckAttempt`).
- 시험: `alert-pass-failures-1101`(원장 흉내 15건 · 재기동 = 모듈 새로 불러옴) · `alert-event-sites-1102`(자리 12건) · 변이 = CT 5 · 자리 11 전부 빨간불 · 원본 복원 같음 · 새 SQL = 실 PG 15.15 임시 DB(원장 다섯 문장 · A5 커서 문장) · 실 PG 시험 파일 `alert-pending-ledger-1102.pg`(원장 블록 C94-DDL-1 이 배포 원장에 들어간 뒤 돈다). MySQL 문(A4 묶음 · 닫기 조건)은 시험 그릇이 없어 실행 못 함(칸 이름 = 이미 쓰는 app_etc1 · status_code · 표준 CONCAT · COALESCE).
- 여정 커밋 뒤(스크립트 준비 · 사본에 얹어 봄 · 대장 계약은 사본 시험 6건 통과): `routes/campaigns.ts` B1 네 곳 · `journey-pretest-notifier.ts` C1 · `app.ts` 부팅 · `root-ledger.test.ts` R14 넓힘(상수 키 = 이어지는 상태 표 24) · R25 넓힘(경보 CT 명세 회사 null 5) · R25 NULL_OK 정리 · 래퍼 면제 `system-alert.ts send`(새 상태 칸이 분석에 보이게 됨 · 옛 줄임 칸은 우연히 비켜 갔다) · 대장 R14 줄 · 배포 원장 C94 카드 + DDL-1 + S1 + 크레딧 미룬 묶음(DEFERRED 1~9).
- 적용(1102 · 여정 커밋 bec5d5d5 · 배포 뒤): 위 스크립트 전부 + DEFERRED 1~9 그대로 얹힘(원장 C93 줄만 커밋 뒤 값으로 고쳐 얹음) · 대장 R39 줄 · STATUS C94 줄.
  - 내 적대 검토로 고침: 실행기 실패로 닫은 실행 경보 = 반복문 뒤 한 통 → **묶음마다**(다음 묶음 조회가 던지면 앞 묶음에서 닫은 실행 경보가 사라졌다) · 대장 R8 면제 키(그 자리 앞 글자가 바뀜 · 이유 그대로).
  - 같이 고침: 여정 세션 실 PG 시험 `journey-step-gate-1031.pg` 경보 목업에 모아 보내기 · 단언 = 항목 키(여정:칸:날짜) · 크레딧 껍데기 이름을 보던 시험 셋(tier3-a explain · precheck-0925 자르기 끝 · no-voice 목업).
  - 반례 4(B1 요청 참조 키 · 라우트 응답 전 await · 실행기 묶음 끝 원장 · 한 번 보내기 회복 한 회차 1통) · 변이 5 전부 빨간불 · 원본 복원 같음 · tsc 0(백 · 프론트) · 실 PG 33파일 223건 통과(스탬프).
- Codex 구현 리뷰(C94 묶음 = §17 구현 + 크레딧 미룬 묶음):
  | 라운드 | 지적 | 처리 |
  |---|---|---|
  | 1R(묶음 전체) | needs-attention · ① high 원장 장애 동안 선점 소진 행이 메일 처리 슬롯 10개를 매분 독점(뒤 고객 메일 접수 0) ② medium 경보 대기 행이 다음 틱 헤더 받기 예외로 일반 catch 가 원장 없이 failed 종결 | 둘 다 수용 · 같은 뿌리 = ① 설계 3R(작업 큐 진행 보장) ② 설계 1R · 2R(원장 없이 닫음) → 구조 = **경보만 남은 접수를 일반 처리 큐에서 분리**(판정 `alertPendingKind` 한 곳 · 처리 목록 `pickIntakeTodo` 가 뺌 · 닫기 `closeAlertPendingIntakes` 한 곳 · 틱 앞 단계가 DB 에서 읽음 = 메일이 서버에서 지워져도 닫힘) · 선점 함수 소진 분기 삭제 · 반례 2 · 변이 4 · 실 PG 메일 접수 문장 셋 |
  | 2R(1R 고친 줄) | needs-attention · ① medium 빈 메일함 틱은 닫기 단계 전에 반환 ② medium 마지막 시도에서 표식 UPDATE 만 실패하면 일반 catch 가 원장 없이 failed 종결 | 둘 다 수용 · ② = 1R-2 와 **같은 부류 두 번째** → 왜 = 판정과 표식이 두 쓰기로 나뉘어 그 사이를 다른 닫기 길이 끝냄 → 구조 = 판정을 선점 쓰기 셋(새 행 · 실패 재선점 · 멈춘 선점 재선점)에 같이 싣기(표식 UPDATE 삭제) + 일반 catch = `markProcessFailure` 한 함수가 경보만 남은 접수를 덮지 않음 · ① = 닫기 단계를 잠금 직후로(정지 · 연결 실패 · 빈 메일함에도) · 반례 3 · 변이 5 · 실 PG 선점 쓰기 셋 |
  | 3R(2R 고친 줄) | **approve** · 지적 0 | 닫힘 |
  - 마무리 검증(1102 09시): tsc 0(백 · 프론트) · vitest 전체 11,221 중 실패 17 = 전부 다른 세션(여정) 진행 중 파일(direct-send-worker · journey-target-extractor · journey-activation · journey-simulator · operator-lag 새 파일 · 새 실 PG 시험 셋)을 읽는 시험 + 그 세션 새 경보 셋이 걸린 대장 R14 · R25 + 그 파일들로 바뀐 실 PG 스탬프(이 묶음 몫 실패 1 = 대행 ⑧ 시험의 자르기 주석 → 되살림) · 이 묶음 실 PG 다섯 파일 76건 통과(다른 세션 test:pg 와 겹친 실행은 그릇 DB 를 서로 지워 다시 돌림).
