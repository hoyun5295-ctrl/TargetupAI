# C107 추가 과제 셋 흐름 표 · 결함 장부(구조체크 · 1106)

> 접수 = 2026-11-06 Harold 「전부 제대로 구조체크해」(C107 B-1105-4 추가 과제 ① ② ③).
> 단계 = DEFECT-PLAYBOOK §1 의 1 흐름 표 · 2 결함 장부. **설계 · 처방 · 코드 0**(Harold 「흐름이 빠짐없다」 확인 전).
> 판 = 서버 배포본 한줄로 11893902 · 게이트웨이 bff79a9(1106 00:37) · 번역 정책 네 대 mapped(1106 00:52). 아래 줄 번호 = 그 판 소스.

## ① 비토 라인 스팸 차단이 스팸 몰림 경보에 안 잡힌다

### 뽑은 방법
- 판정 자리 = `grep -rn "SPAM_BLOCK_STATUS_CODES\|isSpamBlockSurge\|smsCampaignSpamCountsSafe" packages/*/src`(시험 제외) → 소비처 셋.
- 실발송 결과 코드로 「스팸」을 가르는 자리 = 위 하나뿐. 그 밖 `spam_blocked`(training-logger · copy-best-ranker · export-training · journey-executor · auto-campaign-worker)는 발송 **전** 스팸 검사 판정이라 결과 코드를 읽지 않는다(`updateTrainingMetrics` 호출부 4곳에 spamBlocked 인자 0 · 넣는 곳 = auto-campaign-worker.ts:1558 검사 판정).
- 대역 코드 중 스팸 뜻 = `grep -n "SPAM\|스팸" result-code-hanjul-band.generated.ts`.

### 흐름 표
| 단계 | 쓰는 쪽 | 읽는 쪽 | 판정 자리 · 값 범위 | 그리는 화면 · 문구 |
|---|---|---|---|---|
| 1 통신사 스팸 반려 → 게이트웨이 표준 코드 | 게이트웨이 표준 코드 표 `standard_result_code`(migrations/027:6 · 스팸 분류 칸 없음 · 이름 · 제목에만) | customer_failure_code(migrations/100) | 스팸 이름 표준 = SMS_0016_SPAM_BLOCK · SMS_9004 · SMS_9010 · LMSMMS_9004 · LMSMMS_9010 · 카카오 채널 제재 KAKAO_1025 · KAKAO_1027 | 없음 |
| 2 표준 → 대역 코드 → 에이전트 → SMSQ | 게이트웨이 report_queue.customer_code → 에이전트 poller.go:1109 customerStatusValue(gateway_report) | SMSQ_SEND_13 ~ 16 status_code(이력 표로 이동) | 값 = 40016 · 49004 · 49010 · 39004 · 39010 · 21025 · 21027(대역) · **1106 00:49 전 비토 실패 = 전부 9999「기타 오류」**(에이전트 설정 status_values.failed · AGENT_MANUAL:651) | 발송결과 = bandStatusInfo 라벨(sms-result-map.ts:197) |
| 3 회사 결과 표 고르기 | sms-queue.ts:1048 getCompanySmsTablesWithLogs(회사 + 소속 사용자 전 라인 합집합 · userId 없어도 같음) | 아래 4 | 비토 라인 표 포함됨 → **정상** | 없음 |
| 4 스팸 수 세기 | sms-queue.ts:545 smsCampaignSpamCountsSafe · `status_code IN (SPAM_BLOCK_STATUS_CODES)`(:550) | 5 · 6 | 목록 = sms-result-map.ts:156 결과 표 라벨에 「스팸」 = 3004 · 16 · 52 · 53 · 54 · 9003 · 9010(QTmsg 계열 · 키 9999 이하) · **대역 코드 0개** | 없음 |
| 5 여정 결과 안내 문자 | journey-result-notice.ts:197 스팸 수 · :204 isSpamBlockSurge(20건 · 30% · sms-result-map.ts:160) | 담당자 휴대폰 | 비토 라인 = 스팸 수 0 → 몰림 판정 거짓 | 제목 `[여정 스팸 차단 안내]`(:95) · 본문 「통신사가 이 칸 문자 N건(P%)을 스팸으로 막았어요」(:82) → 비토 라인이면 안 나간다 |
| 6 상황판 할 일 | manager-board.ts:194 같은 표 · :200 isSpamBlockSurge | 상황판 화면 | 같음 | 「… 문자가 스팸으로 많이 막혔어요」 · 「통신사가 N건을 스팸으로 막았어요」(:204 · :205) → 비토 라인이면 안 뜬다 |
| 7 계약 시험 | c107-brand-contract-1105.test.ts:438(목록 전부 20000 미만) · spam-surge-notice-1102.test.ts:20(목록 = 결과 표에서 뽑은 것) | 위 4 | 지금 계약 = 「대역은 경보에 없다」를 지킨다 | 없음 |

### 결함 장부
| 칸 | 판정 | 근거 · 고객이 겪는 일 |
|---|---|---|
| 4 목록 | **결함** | 비토 라인(SMSQ_SEND_13 ~ 16)으로 나간 여정 문자가 스팸으로 막혀도 수가 0 → 5 · 6 이 울리지 않는다. 고객 담당자는 문안을 고칠 신호를 못 받는다 |
| 2 옛 행 | 기록(결함 아님 · 되살릴 수 없음) | 1106 00:49 전 비토 실패는 9999 하나라 스팸을 가를 원천이 없다. 고칠 대상은 그 뒤 행 |
| 1 카카오 21025 · 21027 | 판정 보류(설계 질문) | 통신사 스팸이 아니라 카카오 채널 제재. 지금 QTmsg 목록에도 카카오 코드는 없다. 「스팸 몰림」에 넣을지는 설계에서 정한다 |
| 3 표 고르기 | 정상 | sms-queue.ts:1048 주석 · 회사 전 사용자 라인 합집합 |
| 5 · 6 문구 | 정상(문구는 원천과 무관하게 같은 뜻) | 「통신사가 스팸으로 막았어요」 = 대역 스팸 코드에도 맞는 말 |

### 실측(Harold · 실행 전 답 없음)
- ①-S1 지금 비토 라인으로 여정을 보내는 회사가 있는가(이 결함이 오늘 고객에게 닿는가). 명령 = 본문 아래 「실측 명령」 ①.
  - 결과 1106 Harold(.62) = 지난 30일 여정 캠페인 7 · 그중 회사(또는 소속 사용자) 라인에 비토 표(SMSQ_SEND_13 ~ 16)가 든 것 7 · 회사 1 → **이 결함이 지금 고객 한 곳의 여정 전부에 닿는다**(그 회사 라인에 비토 밖 표가 함께 있으면 일부는 다른 라인으로 나갔을 수 있다 · 캠페인별 실제 표는 미측정).

## ② 수신자별 친구 여부가 한줄로에 오지 않는다

### 뽑은 방법
- `grep -rni "friend_yn\|FriendYN" bito-gateway`(시험 제외) · proto `ReportMessage` 필드 전수 · `grep -rn "kakao_targeting\|TARGETING\|resolveBrandAudience\|BRAND_FRIEND_TARGETINGS" packages/backend/src`.

### 흐름 표
| 단계 | 쓰는 쪽 | 읽는 쪽 | 판정 자리 · 값 범위 | 그리는 화면 · 문구 |
|---|---|---|---|---|
| 1 발송 대상 고르기 | 브랜드 창 · 캠페인 저장(campaigns.ts:2714 · :4250 기본 'I' · 칸 기본값 'I' = campaigns.ts:4222 주석 · 미실측) | campaigns.kakao_targeting(복사본) · 적재 k_etc_json.TARGETING(direct-send-processor.ts:204 · campaigns.ts:1112 기본 'I') | 값 = I(채널 친구) · F · M(마수동 전체 = 친구 + 비친구) · N(뜻이 매뉴얼 안에서 반대로 적힘 · brand-message.ts:252 ~ 260) · 빈 값 | 브랜드 창 대상 고르기(TARGETING_OPTIONS 라벨) |
| 2 게이트웨이 청구 | 게이트웨이 brand_targeting_is_friend(migrations/057:134 · I · F 만 친구) | prepare_dispatch_billing(057 · 064 · 070) | M · 빈 값 = 비친구 단가 **일부러**(057:15 「싼 쪽을 고르면 정산 차액을 우리가 문다」) | 콘솔 정산 |
| 3 카카오 결과 보고 | 휴머스온 REPORT FRIEND_YN → connector.go:819 · protocol.go:158 normalizeFriendYN | updater.go:148 message_request.friend_yn | 값 = Y · N · 빈 값(빈 값이면 옛 값 유지) · 057:112 「관찰용 · 요금에 쓰지 않음」(만들 때 표본 1건) | 없음 |
| 4 게이트웨이 → 에이전트 | report.go:220(FriendYN 은 원장 갱신에만) | proto ReportMessage(bito.proto:158 ~ 168 · 필드 9개 · 친구 여부 없음) · report_queue(친구 칸 없음) | **여기서 끊김** | 없음 |
| 5 에이전트 → SMSQ | poller.go(친구 여부를 받지 않음) | SMSQ_SEND_13 ~ 16(친구 칸 없음) | 없음 | 없음 |
| 6 한줄로 청구 · 차감 | send-usage-aggregation.ts:51 ~ 76 · billing-types.ts:299 ~ 324(F 행을 TARGETING 으로 갈라 비친구 = FN) · unit-price.ts:121 · :133 resolveBrandAudience · prepaid 차감(direct-send-core.ts:333 기본 'I') | 정산서 · 통계 · 충전금 | 친구 = I · F · 그 밖 = 비친구(게이트웨이와 같은 규칙) | 정산 줄 「브랜드메시지(친구)」 · 「브랜드메시지(비친구)」(billing-types.ts:320 · :324) |
| 6-2 게이트웨이 청구 확정 · 청구서 | billing_finalizer.go:16 성공 확정(과금 상태만) · 발송 과금 070:85 + dispatch_batcher.go:45(후불 묶음) | 콘솔 청구서 billing-admin.js:1760 `SUM(charge_amount)` · 정합 점검(과금 상태) | 보고 뒤 금액을 다시 매기는 자리 없음(대상값 단가 그대로 굳음) | 콘솔 청구서 금액 |
| 6-3 한줄로 선불 정산 | prepaid.ts:225(대체 켬 브랜드만 결과별 문구) · mysql-refund-sweeper.ts:506 · refund-calc.ts:173 · :190 | 충전금 · 차감이력 | 결과 갈래 = 카카오 · SMS 대체 · LMS 대체 · 친구 갈래 없음 | 차감이력 「결과별 단가 차액 환불」 |
| 6-4 한줄로 화면 금액 · 통계 칸 | results.ts:211 단가 둘 · ResultsModal.tsx:547 대상값으로 고름 · admin.ts:6541 캠페인 대상값으로 칸 | 발송결과 비용 · 관리 통계 내보내기 | 대상값만 봄 | 비용 칸 · 「브랜드메시지(친구/비친구)」 칸 |
| 7 한줄로 화면 이름 | campaign-list-csv.ts:17 · admin.ts:6541 · results.ts:211(캠페인 복사본 kakao_targeting) | 발송결과 · 목록 엑셀 · 관리 통계 | 복사본과 행 값의 기본이 둘 다 'I' → 같음 → **정상** | 같은 이름 |

### 결함 장부
| 칸 | 판정 | 근거 · 고객이 겪는 일 |
|---|---|---|
| 2 · 6 M 대상 | **결함(돈 · 11-05 실측 = M 브랜드 성공 5 중 3 이 채널 친구인데 비친구 단가)** | 마수동 전체(M)로 보내면 받는 사람 중 채널 친구에게도 비친구 단가를 받는다. 057:4 「카카오는 친구 · 비친구를 다르게 받고 공급사가 그 갈림으로 정산한다」 → 친구 몫만큼 고객이 실제 원가보다 비싸게 낸다. 다만 057 은 「정산서 대조 전 미검증 칸으로 돈을 정하지 않는다」고 일부러 막았다 → 1106 실측 = 브랜드 성공 행 12 중 12 에 친구 여부가 찼다(빈 값은 실패 · 대체 행뿐) · 057 이 막은 까닭(표본 1)은 지금 하루 표본 12 로 줄었다 · 공급사가 건별 친구 여부로 정산하는지(②-S3)는 대표 확인 |
| 1 N 뜻 | **결함 후보(뜻 미확정 · 11-05 값이 찬 2 = 전부 N → §4.4.1 「친구 제외」와 맞음 · 표본 2)** | 매뉴얼 §4.4.1(친구 제외) ↔ §5.4.6(채널 친구) 반대. 친구이면 비친구 단가로 받는 셈. 문의 원장 = docs/bito-gateway/FEATURE-GW-BRAND-MESSAGE.md §6 |
| 4 · 5 끊김 | 구조 사실 | 실제 친구 여부가 게이트웨이 원장에서 멈춘다. 한줄로는 고칠 원천이 없다(①과 달리 한줄로만 고쳐서는 닫히지 않는다) |
| 7 화면 이름 | 정상 | 두 원천의 기본값이 같음(campaigns.ts:2714 · :4250 · :1112 · direct-send-processor.ts:204) |

### 실측(Harold)
- ②-S1 게이트웨이에 지금 친구 여부가 실제로 차 있는가 · 대상 값별 분포(명령 ②-1).
- ②-S2 한줄로에서 M · N 대상 브랜드 발송이 얼마나 나갔는가(명령 ②-2).
- ②-S3(대표) 공급사 정산서가 친구 · 비친구를 건별 실제로 가르는가 · N 의 뜻 회신.
- ②-1 첫 시도(1106 · 30일 · 30초 제한) = statement timeout(바뀐 것 0) · message_request 에 에이전트 × 유형 인덱스 없음(migrations 전수 = created_at · 상태 · 정산 쪽뿐) → 브랜드가 나간 날로 좁혀 다시.
- ②-S2 결과 1106 Harold(.62 · 지난 90일 캠페인 · 전부 kakao_brand) = I 56건 · 발송 63 · M 37건 · 발송 32 · N 6건 · 발송 9 · 첫 발송 08-14 ~ 마지막 11-05(세 값 모두) → 브랜드 발송량 자체가 작다(합 104) · M · N 발송 41 이 ② 해당 가능 몫.
- ②-S1 결과 1106 Harold(.65 · 11-05 하루 · 한줄로 네 대 · 브랜드 유형) = I: 빈 값 5 · Y 5 / M: N 2 · Y 3 / N: 빈 값 6 · N 2(전부 DONE) → ⓐ 친구 여부가 실제로 차는 행이 있다 ⓑ **M 으로 보낸 5 중 3 이 채널 친구(Y)인데 비친구 단가로 청구됐다** ⓒ N 으로 보낸 것 중 값이 찬 2 는 전부 N(= 「친구 제외」 뜻과 맞음 · 표본 2) ⓓ 빈 값 11 의 까닭 미확인(실패 · 대체 발송 행인지) → 결과 코드로 가른다.
- ②-S1b 결과 1106 Harold(.65 · 같은 하루 · 결과 코드 · 보고 유형) = 친구 여부가 찬 12 행 = 전부 브랜드 성공(0000 · BF) · 빈 값 11 행 = 브랜드 실패 3018 BF 2 · LMS 대체 실패 509 LM 2 · SMS 대체 성공 7830 SM 5 · LMS 대체 성공 7831 LM 2 → **브랜드로 받은 행에는 빠짐없이 친구 여부가 온다**(하루 표본) · 대체 · 실패 행은 문자 단가 · 환불이라 친구 축과 무관(C107 결과별 정산).

## ③ 게이트웨이 시험 TestCursorFlushRecoversAfterTransientSyncFailureAndReplay 가 가끔 실패

### 흐름 표(시험이 밟는 길)
| 단계 | 코드 | 일어나는 일 |
|---|---|---|
| 1 첫 보고 처리 | grpc_client_test.go:284 → grpc_client.go:1296(연결 상태 확인) → markResultAcked → :1471 기록 작업 등록(동기) | 기록 작업 고루틴 시작 |
| 2 첫 기록 실패 | grpc_client.go:1551 ~ 1569 | 작업을 목록에서 지우고 오류 · 신호를 내고 잠금을 푼다 → **그다음** :1569 finishCursorWriter |
| 3 첫 Flush | grpc_client.go:877 ~ 916 | 작업 목록이 비면 오류를 돌려준다 = 2 의 잠금 해제 직후(finishCursorWriter 전일 수 있다) |
| 4 연결 끊기(늦게) | grpc_client.go:1627 ~ 1629 → :1079 disconnectGeneration → :1085 상태 = 끊김 | 기록 작업 고루틴이 시험보다 늦게 실행되면 여기서 상태를 덮는다 |
| 5 시험이 되살림 | grpc_client_test.go:290 상태 = 연결 | 4 가 이 뒤에 오면 되살림이 지워진다 |
| 6 두 번째 보고 | grpc_client_test.go:293 → grpc_client.go:1296 | 상태가 끊김이면 아무것도 안 하고 돌아간다(기록 작업 0) |
| 7 두 번째 Flush | grpc_client.go:900 ~ 912 | 작업 0 · 남은 첫 오류를 그대로 돌려준다 = 관측된 실패 문구 「recovered Flush error=transient cursor fsync failure」(grpc_client_test.go:295) |

### 실측(1106 · 노트북 · 단일 시험)
- 원 시험 `-count=40 -v` = 통과 38(각 1.01 ~ 1.02초 = 두 번째 기록이 최소 간격 1초(grpc_client.go:280)를 기다린 뒤 성공) · **실패 2(각 0.01초 = 두 번째 기록이 아예 안 일어남 · 6 의 꼴)**.
- 버리는 판(첫 Flush 뒤 상태가 끊김이 될 때까지 기다린 다음 되살림 · 파일은 실행 뒤 지움) `-count=600 -v`(시간 제한으로 171번에서 멈춤) = 통과 171 · 실패 0. 원 실패율(40 중 2)이면 171번에 실패 0일 확률 ≈ 0.02%.
- 앞서 말한 「1,500번 중 16번」은 시간 제한으로 1,500번을 다 돌지 못한 수라 분모가 틀렸다(바로잡음).

### 결함 장부
| 칸 | 판정 | 근거 |
|---|---|---|
| 시험 4 · 5 순서 | **결함(시험)** | 시험이 「실패한 기록 작업의 연결 끊기」를 기다리지 않고 상태를 되살린다. 운영에서는 끊김 뒤 새 연결(새 세대)이 되살리고(grpc_client.go:567 한 곳) 재전달 보고가 새 기록 작업을 만들어 첫 오류를 지운다(:1576 ~ 1578) |
| 운영 코드 | 결함 없음(이 시험 범위) | 상태를 연결로 바꾸는 운영 코드 = :567 하나 · 끊김 뒤에만. 운영에서 같은 순서가 생기는 길을 찾지 못했다(근거 = 위 grep) |

## ④ 결과 판정 손 목록(1106 설계 중 발견 · Harold 「봤으면 없애야지」)
| 칸 | 쓰는 쪽 | 읽는 쪽 | 판정 · 값 범위 | 그리는 화면 |
|---|---|---|---|---|
| 시험 발송 요약 | manage-stats.ts:156 ~ 158(성공 6 · 1000 · 1800 · 대기 100 손 목록) | 관리 발송 통계 시험 요약 | 7830 · 7831(대체 성공) · 104(대기) → **실패로 셈 = 결함** | 시험 발송 성공 · 실패 · 대기 수 |
| 만료 대기 표시 | expired-pending-sweeper.ts:30(대기 100 · 104 손 목록) | 4000 마킹 | 값은 CT 와 같음 · 목록이 바뀌면 혼자 어긋남 = 같은 꼴 | 없음 |
| `status_code = 100` 단독 | campaigns.ts · campaign-lifecycle.ts · cancelled-queue-sweeper.ts · direct-send-worker.ts | 대기 행 지우기 · 옮기기 | 동작 조건(집기 전 행만) = 정상 | 없음 |

## 실측 명령(Harold · 하나씩)
1. ①-S1 · .62 root 셸 · 한줄로 DB: 지난 30일 여정 캠페인 중 회사 또는 소속 사용자 라인이 비토인 것.
2. ②-1 · .65 root 셸 · 게이트웨이 DB: 지난 30일 한줄로 네 대 브랜드 요청의 대상 값 × friend_yn 분포.
3. ②-2 · .62 root 셸 · 한줄로 DB: 지난 90일 브랜드 캠페인 대상 값별 건수 · 발송 수.

## 다음(Harold 확인 뒤)
- 이 표에 빠진 흐름이 없다는 확인 + 실측 셋 결과 → 결함 장부 확정 → 설계서(처방 · 뿌리 · 계약 시험 · 직원 지시문).
