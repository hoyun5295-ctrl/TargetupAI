# C150 스팸 검사 · 통신사 늦은 전달 판정 + 재검사 대기 — 설계서

> 카드 C150 · 2026-11-21 · 접수 = Harold(아래 §0 원문) · 승인 = Harold 「제대로 파악해서 설계안작성해 그리고 설계안 코덱스리뷰닫힐때까지 돌리고 닫히면 바로 구현들어가 구현 마무리되면 코덱스리뷰돌려서 닫힐때까지 돌리고 보고해」
> 뿌리 = R103 신설 · R104 신설 · R89 넓힘(`docs/ROOT-LEDGER.md`) · 기능 문서 = `docs/FEATURE-SPAM-CHECK.md`
> 이력 = 1판(Codex 설계 1R needs-attention 2) → 2판(§10 판정표 · 고칠 수 있는 때를 줄마다 · 자동마케팅 무변경 · 보류 장애 셈 · 2R approve) → 3판(자가 발견: 이어 본 검사는 그 검사의 batch_id 가 이번 묶음과 달라 보류 사건의 batchId 로 못 찾는다 → 보류 사건에 검사 id 를 싣는다)

## §0 접수 원문과 축 대조표

| # | 원문 | 이 축이 없으면 닫히는가 | 닫는 처방 |
|---|---|---|---|
| 1 | (메일 「스팸 검사 판정이 굳은 뒤 문자 수신 보고가 닿았습니다(최근 24시간 · LGU 1건)」 첨부) 「유플러스가 유독 심한데 뭔 문제지?」 → 「다른게 중요한게 아니라 저 메일처럼 잘못오는거 말하는거아냐」 | 안 닫힘 — 늦게 닿은 실제 수신이 판정을 못 고치고 메일이 된다 | P1 · P5 |
| 2 | 「검사를 한번하고나서 문제가 있을때 재검사하는시간이 오래걸리잖아 그것도 문제야」 | 안 닫힘 — 차단 확정이 10분 넘게 미뤄지고, 보류 건은 5분 주기를 기다린다 | P2 · P3 |

빠진 축 0. 범위 밖(기록만) = §9.

## §0-1 미가입 · 직접발송 회사 변화 0 (메모리 `feedback_free_direct_send_zero_change` · 맨 앞 기준)

미가입 회사가 쓰는 스팸 검사 = 사람이 누르는 검사(출처 `manual` · 체험 `trial`). 이번 처방은 **자동 검사 출처(`auto_ai` · `auto_ai_free` = `isAutoSpamSource` · `notAutoSpamSourceSql` 한 목록)** 에만 문을 연다.

| 길 | 바뀐 코드 | 미가입 · 직접발송에서 왜 0 인가 | 증명 시험 |
|---|---|---|---|
| 늦은 보고 받아 주기(P1) | `SPAM_REPORT_TEXT_MATCH_SQL` 의 고칠 수 있는 때 · `readSpamTestOutcome` lateOpen | 사람 검사 출처 = 줄 결과와 상관없이 옛 10분 그대로(창 조각의 출처 갈래) | 실 PG K-PG1 · K-PG2(사람 검사 시간 초과 줄 닫힌 지 15분 = 못 고침 · lateOpen 거짓) |
| 확인 문자 시작(P2) | `runSpamProbeCycle` ③ 고르기 | 사람 검사 출처 = 옛 10분 그대로 | 실 PG K-PG3(사람 검사 닫힌 지 2분 = 안 고름) |
| 보류 깨우기 · 보류 장애 셈(P3) | 대행발송 일꾼 | 대행발송 = 회사 스위치 켠 회사만 | 단위 K4 |
| 하루 측정 경보(P5) | `measureSpamVerdicts` 경보 키 | 운영자 경보(회사 화면 · 문자 0) | 단위 K6 |
| 고객 화면 문구 | **0줄**(「길어도 20분 안에」 다섯 자리 = 사람 검사 그대로 · 자동 검사는 더 빨라져 상한이 여전히 맞다) | 바뀐 문구 없음 | 계약 K3 |

차감 · 환불 · 체험 횟수 · 큐 행: 변화 0(통과 · 차단 · 시간 초과는 모두 같은 청구 · 발송 실패 행은 늦은 보고가 바꾸지 않는다 = `routes/spam-filter.ts:592` 조건 그대로).

## §1 실측 사실 (근거 = Harold 실행 출력 · 코드 파일:행)

**메일 건(11-21 금강제화 bb1fc50b · 발신 0334339550 · SMS · 출처 auto_ai_free)**

| 시각 | 무엇 | 근거 |
|---|---|---|
| 08:03:20 | 검사 등록 | PG `spam_filter_tests` |
| 08:03:22 | 세 줄 적재(`SMSQ_SEND_16` · sendreq_time) | MySQL 조회 출력 |
| 08:03:25 | KT · SKT 통신사 결과(mobsend_time) · 단말 보고(받은 지 0초 · 1번째 시도) | MySQL · pm2 out 로그 |
| 08:04:22 | 검사 닫힘 · LGU 줄 = 시간 초과(통신사 결과조차 없음) | PG decided_s 62 · `spam-test-queue.ts:1180-1186` |
| 08:18:41 | LGU 통신사 결과(mobsend_time = repmsg_recvtm) · LGU 단말 보고(받은 지 0초 · 1번째 시도) · 「매칭 없음」 | MySQL · pm2 로그 |
| 08:18:41 | 닫힌 지 14분 19초 = 고칠 수 있는 때(10분) 밖 → `late_report_at` 만 찍힘 | `spam-test-queue.ts:254 · 329-331 · 407-414` |
| 08:23:20 | 재검사(대행발송 장애 대기 15분 + 일꾼 주기 5분) · 세 통신사 모두 3 ~ 5초 | MySQL · `agency-send-state.ts:533` · `agency-send-worker.ts:65` |
| 09시대 · 16:26:07 | 하루 측정 경보 메일(16:26 = 배포 재시작 뒤 같은 건을 다시 보냄) | `spam-probe.ts:223-268` · 09시대 메일 유무 = 미검증(Harold 메일함) |

- `SMSQ_SEND_16` 의 mobsend_time = 게이트웨이가 상위 중계(gemtek)의 REPORT 를 받은 순간(gemtek 연결은 결과 시각을 싣지 않아 `bito-gateway internal/gateway/connector/gemtek/conngroup.go:600` · 엔진이 `time.Now()` 로 채움 = `internal/gateway/engine/report.go:42-48` · 에이전트가 칸에 씀 = `internal/agent/poller/poller.go:1082`). 중계가 LG U+ 전달을 08:18:41 에 보고했고, 단말도 같은 초에 받았다(KT · SKT 도 통신사 결과 = 단말 수신 같은 초). 게이트웨이에 통신사별 갈래는 없다(`grep '"LGU"'` 0). 게이트웨이가 중계에 넘긴 시각 = 미검증(게이트웨이 원장).
- 한줄로 쪽 처방은 어느 쪽 지연이든 같다: **통신사 결과가 늦게 오는 것을 받아 주고, 그동안 헛대기하지 않는다.**

**최근 30일(통신사마다 검사 646)**

| 60초 안에 보고가 안 온 줄(세 통신사 함께 걸린 15줄 제외) | LG U+ | KT | SKT |
|---|---|---|---|
| 60 ~ 120초에 닿아 통과로 고쳐짐 | 4 | 5 | 4 |
| 2분 넘어 닿아 통과로 고쳐짐 | 7 | 1 | 0 |
| 끝내 시간 초과로 굳음 | 3 | 0 | 0 |

- 위 줄은 전부 첫 판정이 시간 초과(통신사 결과조차 없음)였다. LG U+ 의 늦은 10건은 네 아침(11-02 10:03 ~ 10:05 · 11-12 11:03 · 11-20 10:01 ~ 10:03 · 11-21 08:03) 정각 뒤 5분 안에 몰렸다. 11-20 은 10:01 · 10:02 · 10:03 세 검사가 연달아 늦었다(133초 · 끝내 안 옴 · 173초) = **지연 중에 빨리 다시 보내도 같이 늦는다.**
- 닫힌 뒤 늦게 고쳐진 최장 = 335초(10분 안) · 오늘 860초(닫힌 뒤 14분 20초 · 10분 밖) = 30일 중 창 밖 1건.
- 확인 중(통신사 전달 성공 + 앱 보고 없음)으로 닫힌 줄 = 36(차단 35 = 전부 확인 문자로 확정 · 통과 1 = SKT 11-10 시작 뒤 62초). **닫힌 뒤 2 ~ 10분 사이에 앱 보고로 통과가 된 확인 중 줄 = 0.** 확인 문자는 닫힌 뒤 10분을 기다려야 나간다(`spam-probe.ts:152-157`).
- 차단 뒤 재검사 간격(11-19 금강제화 LGU) = 16:07:49 → 16:21:31(13분 42초) · → 16:26:15(18분 26초). 대행발송 보류는 다음 주기(5분)를 기다린다(`agency-send-worker.ts:596-607` · 깨우는 자리 없음).

## §2 흐름 표 (칸 = 소스에서 뽑음 · 뽑은 패턴은 각 줄)

뽑은 패턴: `grep -rn "SPAM_LATE_REPORT_MINUTES\|lateOpen\|late_open\|spamTestFinalBy\|settleSpamHold\|spam_check_hold\|kickSpamRetest\|measureSpamVerdicts\|PROBE_" packages/backend/src`(시험 제외) · 「길어도 N분」 = `grep -rnE "(10|17|19|20)분" frontend/src backend/src | grep 확인|검사|확정|도착`.

| # | 이음매 | 쓰는 쪽 | 읽는 쪽 | 값 범위 · 판정 | 그리는 화면 |
|---|---|---|---|---|---|
| F1 | 검사 등록 · 출처 | `spam-test-queue.ts:613-760`(enqueue · storedSource 712) | 큐 워커 `executeSpamTest` · 보고 라우트 | manual · trial · auto_ai · auto_ai_free · NULL(옛 = manual) | 수동 검사 창 · AI 한줄로 칩 · 대행 진행 상황 |
| F2 | 적재 → 게이트웨이 → 중계 → 통신사 | `sms-queue.ts:172-213` | MySQL `SMSQ_SEND_16` status · mobsend_time | 성공 · 대기 · 실패 코드 | - |
| F3 | 60초 판정 | `spam-test-queue.ts:1129-1193`(큐) · `routes/spam-filter.ts:404-480`(수동) | `decideSpamResult` | 성공 + 보고 없음 = 확인 중(45초 뒤) · 대기 = 시간 초과 · 실패 = failed | 결과표 이름 `sms-result-map.ts:595-602` |
| F4 | 단말 보고 → 검사 고르기 | `routes/spam-filter.ts:515-630` | `resolveSpamReportTest` `spam-test-queue.ts:312-354` · `SPAM_REPORT_TEXT_MATCH_SQL` 252-270 | 닫힌 뒤 경과(진행 중 / 0 ~ 10분 / 10 ~ 30분 / 30분 넘음) × 출처(사람 · 자동) × 그 단말 줄 결과(§10) | 수동 검사 창 다시 읽기 · 칩 |
| F5 | 늦은 보고 반영 · 회복 | `routes/spam-filter.ts:588-606` | `recoverAgencySpamErrors` `agency-send-worker.ts:742-752` | 고칠 수 있음 = 행 통과 + 대행 장애 회복 · 못 고침 = `noteAfterDecidedReport` 407-414 | 대행 진행 상황(회복 줄) |
| F6 | 확인 문자 시작 | `spam-probe.ts:152-193` ③ | `sendProbe` 97-104 · 기한 5분 | 닫힌 뒤 경과 × 출처 | 수동 검사 창 「확인 중」 |
| F7 | 확인 문자 닫힘 | 보고 라우트 `matchProbeReport` `spam-probe.ts:205-220` · 주기 ① ② `spam-probe.ts:124-149` · ⓪ 115-122 | 원 행 blocked · error | 받음 = 차단 · 기한 지남 · 보내기 실패 상한 = 장애 + 단말 경보 | 결과표 · 칩 |
| F8 | 판정 읽기 | `spamTestOutcomeOf` 431-437 · `readSpamTestOutcome` 464-473 · `spamVerdictOf` 1418-1435 · `mergeAlternativeVerdicts` 1475-1478 | 대행 · 자동마케팅 · 여정 · AI 한줄로 | 차단 > 진행 중 > 결과 0 = 장애 > 확인 중 > 전부 통과 = 통과 > 그 밖 = 장애 · lateOpen = 그 검사의 어느 줄이든 아직 늦은 보고로 고쳐질 수 있음(§10) | - |
| F9 | 대행 검사 결과 처리 | `runFirstTest` 786-830 · `finalTestRow` 967- · `runSpamRound` 368-475 | `settleSpamCheckError` 482-540 · `settleSpamHold` 596-607 | 장애 = 사건 + 15분 대기(3번째 = 사람) · 보류(확인 중 · 검사 중) = 사건 + 접수 상태로 · 통과 · 차단 = 다음 단계 | 대행 진행 상황 · 담당자 문자 |
| F10 | 대행 다시 집기 | 일꾼 주기 `startAgencySendWorker` 2338-2341(5분) · `kickSpamRetest` 725-734 · 접수 직후 진입 | `runFirstTest(id)` · `runFinalTest(id)` 고르기 SQL 796-810 · 942-952 | 장애 대기 = `spamErrorBackoffSql` 628-632(회복 제외) · 보류 = 대기 없음 · 깨우는 자리 = 회복(장애)만 | - |
| F11 | 자동마케팅 보류 회복 | `recoverHeldProposals` `continuous-operator.ts:2765-2822` | `readSpamTestOutcome` lateOpen | 통과 = 되살림 · 보류 · (장애 · 차단) × lateOpen = 기다림 · 6시간 = 포기 안내 | 제안 카드 · 담당자 문자 |
| F12 | 하루 측정 경보 | `measureSpamVerdicts` `spam-probe.ts:224-251` · 주기 256-275(메모리 날짜 `_measuredDay`) | `sendSystemAlert` `system-alert.ts:426-` 쿨다운 6시간(PG `system_alert_state`) | 24시간 안 `late_report_at` 1건 이상 = 경보 · 재시작 = 그날 측정 다시 | 운영자 메일 · 문자 |
| F13 | 화면 다시 읽기 끝 | `spamTestFinalBy` `spam-probe.ts:32-37` | `routes/spam-filter.ts:900` | 닫힘 + 10 + 5 + 2 + 2분 | 수동 검사 창 |
| F14 | 「길어도 20분」 문구 다섯 | `DirectCheckTiles.tsx:42` · `SendSpamWarnModal.tsx:77` · `SpamFilterTestModal.tsx:575` · `journey-check.ts:57` · `journey-pretest-validator.ts:210` | 고객 화면 | 확인 중 상한 = 닫힘 뒤 19분 | 직접발송 타일 · 경고 창 · 수동 검사 창 · 여정 점검 · 여정 켜기 |

빈칸 0.

## §3 결함 장부 · 처방

| # | 결함(사슬 · 파일:행 · 고객이 겪는 일) | 뿌리 | 처방 | 계약 시험 |
|---|---|---|---|---|
| D1 | 자동 검사가 닫힌 뒤 10분이 지나 닿은 실제 수신(통신사 지연 · 닫힌 뒤 14분 19초)을 받아 주지 못한다(F4 `spam-test-queue.ts:254`) → 판정이 시간 초과로 굳고 · 대행 회복(F5)이 안 돈다 · 운영 메일(F12) | R103 | **P1** 고칠 수 있는 때를 **그 단말 줄의 늦음 원천**으로 잰다(§10): 자동 검사의 시간 초과 줄(통신사 결과조차 없던 줄) = 닫힌 뒤 30분 · 그 밖 줄(통신사 성공을 이미 본 확인 중 · 차단 · 장애 줄) = 앱 보고 보관 10분 · 사람 검사 = 전부 10분. 창 조각 하나(`spamRowLateMinutesSql`)를 고칠 수 있는 때 · lateOpen 둘이 같이 쓴다 | K1 · K2 · K3 · K-PG1 · K-PG2 · K-PG5 |
| D2 | 자동 검사의 확인 중 줄이 닫힌 뒤 10분을 기다려야 확인 문자가 나간다(F6 `spam-probe.ts:157`) → 차단 확정 11분 + · 대행 재검사 13 ~ 18분. 30일 실측 = 그 10분 동안 앱 보고로 풀린 줄 0 | R103 | **P2** 자동 검사 출처의 확인 문자 시작 = 닫힌 뒤 1분(`SPAM_AUTO_PROBE_AFTER_MINUTES`). 사람 검사 = 10분 그대로. 창 조각(`spamProbeAfterMinutesSql`) | K1 · K3 · K-PG3 |
| D3 | 대행 보류(확인 중 · 검사 중)는 검사가 굳어도 깨우는 자리가 없다(F9 · F10) → 다음 5분 주기 · 앞 접수 처리 시간만큼 더. 또 보류 묶음이 장애로 굳으면(확인 문자 기한 지남 = 단말 장애) 다음 집기가 같은 키 장애 검사를 잇지 않아 새 검사를 걸고, 보류는 장애 횟수에 안 세어 15분 대기 · 3번 상한을 비켜 간다(옛부터 · P2 로 빨라짐 · Codex 설계 1R #2) | R89 넓힘 | **P3** ① 대행 일꾼 30초 보류 감시(`wakeResolvedSpamHolds`) — 마지막 사건이 그 문안 버전의 보류인 접수(received · approved)의 묶음 결과(`mergeAlternativeVerdicts`)가 보류가 아니면(통과 · 차단 · 장애) `kickSpamRetest` ② `runSpamRound` 첫머리 — 같은 보류 묶음이 장애로 굳었으면 새 검사 없이 그 묶음으로 `verdict: 'error'` → 부르는 쪽 `settleSpamCheckError`(장애 셈 · 15분 대기 · 3번째 = 사람 · 늦은 보고가 그 묶음을 통과로 고치면 C125 회복 그대로) | K4 · K-PG4 |
| D5 | 하루 측정이 메모리 날짜로만 하루 한 번을 지켜, 재시작마다 같은 24시간 건을 다시 세고 쿨다운 6시간이 지났으면 다시 보낸다(F12 · 16:26 메일) | R104 | **P5** 경보 키에 한국 날짜(`spam-verdict-after-decided:YYYYMMDD`) + 쿨다운 24시간 = 같은 날 두 번 0 | K6 |

(1판 D4 = 자동마케팅 기다림에서 차단 빼기는 버렸다 — Codex 설계 1R #1: 확인 문자 보고가 원 문자 보고보다 먼저 닿으면 차단으로 마감한 뒤 원 문자 늦은 보고가 통과로 고쳐도 회차가 되살아나지 않는다. 2판은 P1 이 차단 줄의 고칠 수 있는 때를 10분으로 잡아 자동마케팅 식(`continuous-operator.ts:2801`)을 **한 글자도 안 바꾼다**: 차단 = 닫힌 뒤 10분 기다림(그 사이 원 문자 보고가 오면 되살림) · 시간 초과 = 30분 기다림.)

### §10 판정표 — 늦은 보고가 그 줄을 고칠 수 있는 때(닫힌 뒤 · 분)

| 그 단말 줄 결과 \ 출처 | 사람(manual · trial · NULL) | 자동(auto_ai · auto_ai_free) | 왜 |
|---|---|---|---|
| timeout(통신사 결과조차 없음) | 10 | **30** | 늦음 원천 = 통신사 지연(실측 닫힌 뒤 14분 20초 · ×2 여유) |
| unconfirmed · blocked · error(통신사 성공을 닫히기 전에 봄) | 10 | 10 | 늦음 원천 = 앱 보고 보관(받은 뒤 10분 다시 보냄 · `SPAM_LATE_REPORT_MINUTES` 주석) · 이 선에서 통신사 성공 = 단말 수신 같은 초(§1) → 받은 때 ≤ 닫힘 → 보고는 닫힌 뒤 10분 안에 닿거나 안 닿는다 |
| pass · failed · NULL(진행 중) | 10 | 10 | pass · failed 는 라우트 갱신이 바꾸지 않음(`received = false` · `result <> failed`) · 진행 중 = 늘 고침 |

- 고칠 수 있는 때(라우트) = 그 단말 줄(phone · carrier · type)의 칸 값. lateOpen(검사) = 그 검사 줄들 칸 값의 최댓값(어느 줄이든 아직 고쳐질 수 있으면 참).
- 확인 문자 시작(닫힌 뒤 · 분) = 사람 10 · 자동 1. 확인 문자를 1분에 보내도 위 표의 10분 칸이 그대로라, 원 문자 보고가 확인 문자 보고보다 늦게 닿아도 10분 안이면 차단 줄이 통과로 고쳐지고 자동마케팅은 기다리다 되살린다(K-PG5).
- 대행은 차단에서 곧바로 다듬기로 넘어간다(옛 그대로 · 감시가 30초 안에 깨움). 원 문자가 10분 안에 늦게 닿는 순서 역전(앱 보고 지연)이면 다듬기가 한 번 헛돈다 — 30일 실측 0건(§1 확인 중 → 2 ~ 10분 통과 0) · 승인 전이라 발송 0 · 받아들임(§9-5).

### P1 · P2 상세 (창 CT — `spam-test-queue.ts`)

```ts
/** 닫힌 검사에 늦은 보고를 받아 주는 시간(분) — 앱 대기열 보관 시간(10분) · 사람 검사 전부 · 통신사 성공을 본 줄 */
export const SPAM_LATE_REPORT_MINUTES = 10;   // 그대로
/** ★ C150 자동 검사의 시간 초과 줄 — 통신사 지연(1121 실측 닫힌 뒤 14분 20초)을 받아 준다 */
export const SPAM_AUTO_LATE_REPORT_MINUTES = 30;
/** ★ C150 자동 검사 확인 문자 시작(닫힌 뒤) — 30일 실측 2 ~ 10분 사이 앱 보고로 풀린 확인 중 0 */
export const SPAM_AUTO_PROBE_AFTER_MINUTES = 1;
/** §10 칸 SQL 조각 — 출처 목록 = notAutoSpamSourceSql 한 곳 · 결과 값 = SPAM_RESULT */
export function spamRowLateMinutesSql(test: string, result: string): string
export function spamProbeAfterMinutesSql(test: string): string
```

- 쓰는 자리 셋(전부 이 조각): `SPAM_REPORT_TEXT_MATCH_SQL` correctable(그 단말 줄 · 같은 문장 안 하위 조회) · `readSpamTestOutcome` late_open(줄 최댓값) · `runSpamProbeCycle` ③. 그 밖 `completed_at` 창 비교 0(K1).
- `spamTestFinalBy`(F13) 는 그대로(사람 검사 화면 · 자동 검사는 더 일찍 풀려 다시 읽기가 늦게 끝날 뿐).

### P3 상세 (`agency-send-worker.ts`)

```ts
export const SPAM_HOLD_WAKE_MS = 30_000;
/** 보류 묶음의 지금 결과(그 문안 버전의 마지막 사건이 보류일 때만 · 아니면 null) — 감시 · runSpamRound 가 같은 함수 */
export async function heldSpamBatch(requestId: string, version: number): Promise<{ batchId: string; verdict: SpamVerdict } | null>
// 마지막 사건(request_id, created_at DESC 색인) = spam_check_hold · payload version = 지금 문안 버전
// 검사 = payload testIds(3판 · 새로 씀) · 없으면(배포 전 사건) payload batchId 의 검사(spam_filter_tests.batch_id)
// verdict = 검사마다 readSpamTestOutcome(판정 읽기 한 곳) → mergeAlternativeVerdicts · batchId = 그 검사들의 batch_id(장애 마감 · C125 회복 키)
export async function wakeResolvedSpamHolds(kick = kickSpamRetest): Promise<string[]>
// 고르기: status IN ('received','approved') AND updated_at > NOW() - 60분(setStatus 가 찍음 = 162행) → heldSpamBatch → 보류가 아니면 kick
// startAgencySendWorker 가 setInterval(SPAM_HOLD_WAKE_MS) 로 띄움 · 겹침 방지 플래그
```

- 왜 검사 id 를 싣나(3판): 보류 뒤 다음 회차는 같은 글 검사를 이어 본다(`enqueueSpamTest` reuseSameDay 의 이른 반환 `spam-test-queue.ts:637-641`). 그 검사의 `batch_id` 는 처음 만든 회차의 묶음이고, 이번 회차의 `result.batchId`(`spam-test-queue.ts:1576`) 와 다르다. 보류 사건이 이번 batchId 만 들고 있으면 `batch_id` 로 검사를 못 찾는다. 그래서 `runSpamRound` 의 detail 에 `testIds: Object.values(result.testIds ?? {})`(이어 보기면 그 검사 · `spam-test-queue.ts:1638`)를 넣고, `settleSpamHold` 가 사건 payload 에 그대로 싣는다(jsonb · DDL 0 · 진행 상황 화면은 payload 를 그리지 않는다). 장애 마감에 넘기는 batchId 는 그 검사의 `batch_id` — C125 회복(`recoverAgencySpamErrors` = 검사 → batch_id → 장애 사건 batchId)과 같은 키.
- `runSpamRound` 첫머리(SMS 길이 판정 뒤 · 검사 앞): `heldSpamBatch` 결과가 `error` 면 `{ verdict: 'error', detail: { batchId } }` 로 돌려준다 → 부르는 쪽(첫 검사 · 최종 검사) 옛 장애 갈래 그대로(`settleSpamCheckError` = 사건 + 셈 + 대기 · 같은 묶음 회복 잠금). 통과 · 차단 = 옛 길(같은 검사 이어 보기 `spamCheckFor` · 새 검사 0 → 통과 = 다음 단계 · 차단 = 다듬기 → 새 검사).
- 집기는 CAS(`runFirstTest(id)` · `runFinalTest(id)` 의 고르기 SQL) — 정기 주기 · 회복 깨우기와 겹쳐도 한쪽만. approved 보류가 최종 검사 창 밖이면 헛 깨우기(SELECT 0행)가 30초마다 — 만료 단계(5분 주기)가 상태를 바꾸면 끝.
- 마지막 사건이 보류가 아니게 되는 경우(그 뒤 다른 사건 · 담당자 문안 수정 = 버전 바뀜) = 감시가 안 고름 → 옛 5분 주기가 맡는다(놓치는 것 = 빨라지지 않을 뿐 · 멈춤 0).
- ★ 구현 Codex 1R 반영 둘: ① 발송 직전 단계 선점(적재 · 당일 재검사 두 갈래) = 상수 `FINAL_STAGE_CLAIM_SQL` 하나 + `revision = 후보를 읽을 때 값` — 정기 최종 검사가 후보를 읽은 뒤 감시가 장애 마감으로 승인 상태에 돌려놓은 행을 옛 값으로 다시 잡아 15분 대기 없이 새 검사를 거는 길을 닫음(실 PG 회귀) ② 보류 사건 = 던지는 `insertAgencyEvent` 로 쓰고 실패하면 보류로 돌리지 않고 장애 갈래(사건 = 보류 장애 셈의 근거 · 옛 `logEvent` 는 삼킴).

### P5 상세 (`spam-probe.ts:243-249`)

`dedupKey: \`spam-verdict-after-decided:${kstDateTag(new Date())}\`` · `cooldownMs: 24 * 60 * 60 * 1000` (한국 날짜 태그 = 기존 CT `ai-credit-calc.ts` `kstDateTag` · YYYYMMDD).

**P5 2판(배포 adb43a01 뒤 · 1121 19:31:49 메일)** — 1판은 키만 날짜로 바꾸고 자료 창은 「돌린 때부터 24시간」 그대로였다. 배포 재시작 뒤 측정이 19:31 에 다시 돌아 아침 08:18 건을 다시 셌고, 새 키에는 보낸 기록이 없어 쿨다운이 비었다. 창이 돌린 때에 매이면 늦게 돈 날은 다음 날 창과 겹치고 앞 구간을 빠뜨린다. 2판 = 자료 창 = 그 날짜 키의 창 하나 `spamMeasureWindow(now)` = [전날 09시, 그날 09시)(한국 시각 · 한국 09시 = 같은 날짜 UTC 00시) · `measureSpamVerdicts(now)` 가 경계를 `$1 · $2` 로 · 키 = 창의 날짜 · 메시지 「전날 09시 ~ 오늘 09시」. 같은 날 몇 번을 돌려도 같은 창 · 같은 키(24시간 쿨다운) · 이웃 날 창은 끝 = 시작 = 사건 하나 = 경보 한 번. 그날 09시 뒤 생긴 건 = 다음 날 측정에서 한 번. 함께 = C149 빈틈(§9-1) 고침(Harold 「빈틈도 고쳐야지?」). 09시 측정 뒤에 생긴 건 = 다음 날 09시 측정의 24시간 창에 들어가 다음 날 키로 한 번(놓침 0).

## §4 영향표 (바뀌는 값을 읽는 전 소비처)

| 바뀌는 것 | 소비처(파일:행) | 영향 |
|---|---|---|
| correctable(§10) | `resolveSpamReportTest` → 보고 라우트 하나 | 자동 검사 시간 초과 줄의 닫힌 뒤 10 ~ 30분 수신 = 통과로 고침 + 회복(대행 장애 · C125 그대로) · `late_report_at` 은 칸 밖만 |
| late_open(§10 줄 최댓값) | `continuous-operator.ts:2789-2801` 하나(다른 `readSpamTestOutcome` 호출 = outcome 만: `agency-send-worker.ts:658` · `journey-pretest-validator.ts:293 · 407` · `spamCheckFor` 511) | 자동마케팅 식 무변경 · 시간 초과 보류 = 30분까지 회복 기다림(옛 10) · 차단 = 10분(옛 실효 = 차단이 닫힌 뒤 11분 + 에 생겨 바로 마감 → 이제 1.5 ~ 7분에 생겨 10분까지 기다림 = 원 문자 늦은 보고 되살림 가능) · 진짜 장애 안내는 시간 초과 건만 20분 늦게 |
| 확인 문자 시작(자동 1분) | 주기 ③ 하나 | 자동 검사 확인 중 → 차단 · 장애 확정이 닫힌 뒤 약 1.5 ~ 7분(옛 11 ~ 17) |
| 보류 감시 · 보류 장애 셈 | 대행 일꾼(새 주기 · `runSpamRound` 첫머리) | 보류 접수 = 검사가 굳은 뒤 30초 안 다시 집힘 · 보류 묶음 장애 = 장애 셈 + 15분 대기(단말 장애 재검사 고리 닫힘 · 3번째 = 사람 안내) |
| 경보 키 | `system_alert_state` 새 키(날마다 한 행) | 같은 날 두 번 0 · R14 상수 키 표에서 그 줄 빠짐 · R25 회사 null 목록 줄 = 템플릿 글로 바뀜 |
| 「길어도 20분」 문구 | 다섯 자리 | 0줄(사람 검사 그대로 · 자동 검사 상한 아래) |
| 청구 · 환불 · 체험 횟수 | `spamBillableTestSql` · 환불 = failed 만 | 0 |
| 닫힌 뒤 판정이 바뀌는 창(자동 시간 초과 줄 10 → 30분) | 판정을 읽는 자리 = 호출 파일 기계 추출(`autoSpamTestWithRegenerate` 7파일 · `readSpamTestOutcome` 4 · `spamCheckFor` · `getSpamTestBatchResults`) | 굳히는가 · 기다리는가 = R89 장부 그대로(대행 = 회복 깨우기 · 자동마케팅 회차 = 회복 일꾼(lateOpen 이 같은 칸) · 여정 보내기 전 · 2시간 전 = 다음 주기 같은 키 다시 읽기 · 플래너 = 사람 · 자동발송 재검사 · 리마인드 = 60초 이어 보기). 창이 길어져 새로 굳는 자리 0 · 늦게 고쳐지는 건만 늘어난다(LESSONS_BACKEND 1120 판별) |
| 재검사 고르기 순서(같은 문안 · 받기 전 만든 검사 중 진행 중 우선 → 최근) | `SPAM_REPORT_TEXT_MATCH_SQL` ORDER BY 264-269(무변경) | 시간 초과 칸 30분과 대행 장애 대기 15분이 겹쳐 앞 검사의 늦은 수신이 뒤 재검사로 붙을 수 있다 = 옛 「가를 수 없는 경우」 규칙(`spam-test-queue.ts:307-310`) 그대로 · 같은 문안이 그 통신사에 닿았다는 결론은 같다 · 뒤 검사 자기 문자의 보고는 0행으로 끝나고 앞 검사는 시간 초과로 남는다(경보 0 · 칸 안) |

## §5 계약 시험 (뿌리마다 기계 추출 · 변이)

- `c150-spam-carrier-delay-1121.test.ts`
  - K1(R103): `spam-test-queue.ts` · `spam-probe.ts` 에서 `completed_at` 을 `NOW()` 와 견주는 SQL 을 소스에서 뽑아 전부 창 조각을 거친다 · `${SPAM_LATE_REPORT_MINUTES} minutes` 날 삽입 0(조각 정의 안 제외). 변이 = 한 자리를 옛 날 삽입으로 → 빨간불.
  - K2(R103): `SPAM_AUTO_LATE_REPORT_MINUTES * 60` ≥ 2 × 860(1121 실측 닫힌 뒤 지연 초) · 조각의 자동 · 시간 초과 칸 = 그 상수. 변이 = 10 → 빨간불.
  - K3(미가입 0): 사람 검사 = 모든 줄 10 · 확인 문자 시작 10 · 확인 문자 기한 5 그대로 · 「길어도 20분」 다섯 자리 = `spamTestFinalBy` 분(10 + 5 + 2 + 2 = 19) 이상. 변이 = 사람 갈래 30 → 빨간불.
  - K4(R89): 감시가 읽는 사건 종류 = `settleSpamHold` 가 쓰는 종류(구문 트리로 두 리터럴 추출) · `startAgencySendWorker` 가 감시를 띄운다 · `runSpamRound` 첫머리가 `heldSpamBatch` 장애를 `verdict: 'error'` 로 돌려준다(구문 트리 = 검사 호출 앞) · 감시 단위(주입 kick): 통과 · 차단 · 장애 = kick · 확인 중 · 검사 중 = 0. 변이 = 장애 갈래 지움 / 띄우기 지움 → 빨간불.
  - K6(R104): 하루 측정 경보 키에 날짜 · 쿨다운 24시간(sendSystemAlert 주입). 변이 = 날짜 뺌 → 빨간불.
- 실 PG `c150-spam-carrier-delay-1121.pg.test.ts`
  - K-PG1: `SPAM_REPORT_TEXT_MATCH_SQL` correctable — 자동 · 시간 초과 줄 닫힌 지 15분 = 참 · 35분 = 거짓 · 자동 · 차단 줄 15분 = 거짓 · 5분 = 참 · 사람 · 시간 초과 줄 15분 = 거짓 · 5분 = 참.
  - K-PG2: `readSpamTestOutcome` lateOpen 같은 경우(줄 최댓값 = 시간 초과 줄 하나라도 있으면 30).
  - K-PG3: 주기 ③ — 자동 확인 중 닫힌 지 2분 = 고름 · 사람 2분 = 안 고름 · 사람 11분 = 고름.
  - K-PG4: `heldSpamBatch` · 감시 고르기 — 마지막 사건 보류 + received + 버전 같음 = 고름 · 보류 뒤 다른 사건 = 안 고름 · 버전 다름 = 안 고름 · testing = 안 고름 · 묶음 결과(장애 = error · 통과 = pass · 확인 중 = 보류) · **이어 본 검사(batch_id ≠ 사건 batchId · payload testIds 만 맞음) = 찾음 · 돌려주는 batchId = 검사의 batch_id** · 옛 사건(testIds 없음) = batchId 로 찾음. 변이 = testIds 읽기 지움 → 이어 본 검사 칸 빨간불.
  - K-PG5(Codex 1R #1 상태 전이): 자동 검사 확인 중 → 확인 문자 보고 먼저 = 차단 → (원 보고 전) `recoverHeldProposals` = 미종결(기다림) 단언 → 닫힌 지 5분 원 문자 늦은 보고 = 라우트 갱신 조건으로 통과 → `recoverHeldProposals` = 되살아남(차단 + lateOpen = 기다림 · 식 무변경). 변이 = 차단 줄 칸 0 → 빨간불.
- 바뀌는 옛 시험: `spam-late-report-1002`(correctable 글) · `c148-staff-tickets`(late_open 글) · `root-ledger` R36(주기 ③ 글) · R14 상수 키 표 · R25 회사 null 목록 · `spam-verdict-probe-1101.pg`(자동 확인 중 3분 = 이제 확인 문자 대상 · 경보 키 접두) · `automarketing-held-recovery-1102.pg`(시간 초과 11분 = 이제 기다림 → 31분).
- 대장 점검표(기계로 못 잡는 R1 · R6 · R8 · R12)는 Codex 요청문 ④.

## §6 직원 지시문

없음. 두 동작(통신사 지연 · 확인 문자로 확정되는 차단)은 사람이 일으킬 수 없다(C143 선례 = 직원 시트 없음 · 서버 실측으로 닫음). 고객 화면 문구 변화 0.

## §7 닫기 실측 (배포 뒤 · Harold 실행 · 명령은 배포 안내 때)

- S1: 배포 뒤 자동 검사 시간 초과 줄 중 닫힌 뒤 10 ~ 30분에 수신이 닿은 줄 = 통과로 고쳐지고 `late_report_at` 0(다음 자연 발생 때).
- S2: 배포 뒤 대행 보류 → 다시 집기 간격(사건 `spam_check_hold` → 다음 사건) = 검사가 굳은 뒤 1분 안 · 보류 묶음 장애 = `spam_check_error` 사건.
- S3: 재시작한 날 하루 측정 경보가 같은 날 한 번(`system_alert_state` 날짜 키 한 행).

## §8 배포

코드만(DDL · DML 0 · 새 칸 0 · 새 사건 종류 0). 런북 그대로(OPS.md §2-2) · 적재 0건일 때 재시작.

## §9 범위 밖 (기록만 · 착수 0)

1. (★ 1121 P5 2판과 함께 고침 · Harold 「빈틈도 고쳐야지?」 · R11 식 넓힘) C149 빈틈 — 고객이 보는 글 일곱 줄에 「검사폰 · 검사 단말」이 남았다(`SendSpamWarnModal.tsx:77` · `SpamFilterTestModal.tsx:429 · 433 · 575` · `PerformancePage.tsx:847` · `journey-pretest-validator.ts:210` · `sms-result-map.ts:601` 결과표 이름 = 사용량 화면). C149 계약(R11) 식이 「테스트폰 · 시험 폰 · 실제 휴대폰으로」만 본다. 미가입이 보는 문장이라 이번 축에서 손대지 않는다.
2. (2판에서 P3 ② 로 닫음 — 단말 장애 재검사 고리)
3. 대행 일꾼 한 주기가 접수를 차례로 검사(한 건 60 ~ 90초 + 다듬기) — 같은 회사 여러 건이 몰리면 뒤 건이 그만큼 밀린다(11-19 16:05 ~ 16:07 금강제화 8건).
4. 게이트웨이가 중계에 넘긴 시각 대조(LG U+ 지연이 중계 · 통신사 어느 쪽인지) — 게이트웨이 원장 조회.
5. 대행 차단 → 다듬기가 원 문자 늦은 보고(10분 안 순서 역전)보다 먼저 가는 경우 — 30일 0건 · 승인 전이라 발송 0 · 받아들임.
6. 같은 뿌리(판정이 SQL 로 읽는 사건을 삼키는 logEvent 로 씀)의 발송 쪽 자리 셋 — `dispatch_retry`(발송 직전 고르기 대기 · `agency-send-worker.ts` 1252 · 1296 · 1761 근처) · `queue_failed` · `cancel_sweep_retry`. 이번 축(스팸 검사)은 `spam_check_hold` · `spam_check_error` 만 닫음(구현 Codex 1R #2 · 2R) · 발송 배관은 보호 영역이라 따로.
