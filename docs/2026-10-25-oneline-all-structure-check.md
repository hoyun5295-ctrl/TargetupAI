# 한 줄 프롬프트 전 기능 구조체크 · 한 번에 닫기 (2026-10-25)

> **원래 안건(Harold 1025):** 「여정이 이렇게 다시 결함이 나왔으면 자동마케팅도 마찬가지일 거 같은데」 → 「아예 한번에 전수적으로 한줄프롬프트를 쓰는것들 전부 다 구조체크를 다시해서 다 닫아버리는게 어떨까?」 → 「제발 이번엔 전체 결함없이 닫도록 해보자」 · 「결함이 없을 수가 없다는 말도 안 되는 소리 하지 마 · 돈 받고 파는 유료 서비스다」
> **기준 = 결함 0.** 「결함 0」은 아래 덮음표 빈칸 0 + 기계 시험 통과일 때만 쓴다. 그 전 보고 = 「덮음 N% · 남은 칸 M」.
> 상태 = 구조체크(읽기) 끝 · 결함 116건 + 공용 Z1~Z8 · 처방 설계안 = §8 · 코드 0 · Harold 동의 대기(결정 = D1).
> 관련 = [재발 방지 설계](2026-10-25-no-recurrence-system-design.md) §4-2(층 1 전 기능) · [뿌리 대장](ROOT-LEDGER.md) · [여정 2차](2026-10-25-journey-structure-check-2-design.md)

## §0 왜 이번에 또 나왔나 (자동마케팅 측정 1025)

여정 2차에서 넓힌 시험(R8 · R10 · R11 · R12 · R15 · R17)의 대상을 여정 파일(`JOURNEY_UTILS`)로만 걸었다. 같은 규칙을 자동마케팅 20파일 · 주소 63개에 걸자 죽은 주소 1 · 순서 없는 LIMIT 2 가 바로 나왔다. → 이번에는 **기계 시험 대상 = 전 파일**(백엔드 787 · 화면 686), 사람 읽기 = 한 줄 기능 파일 전부.

같은 꼴 둘째(플래너 읽기 1025) = R2 시험이 「화면 PlanGate 표에 오른 라우터」만 본다 → 같은 기능의 공개 링크 라우터(planner-recheck-public)가 밖이라 휴대폰 [보내기]에 요금제 문이 없었다(#55). 시험 대상을 손 표로 고르면 표에 없는 길이 빠진다 → R2 도 전 라우터(공개 링크 포함 · 돈 · 발송 함수 기계 추적) 대상으로 넓힌다.

## §1 범위 (손 목록 0 · import 그래프로 뽑음)

- 한 줄 CT = `utils/one-line-ct/*` + `utils/one-line-*.ts` 11파일 · 2,605줄.
- CT 를 직접 부르는 백엔드 29파일(주소 = ai · ai-line · cdp · content-interview · dm · email · line-templates · mall-products · sns / 서비스 = ai · ai-line · ai-orchestrator / 기능 = 자동마케팅 · 여정 묻기 · 플래너 · 한 줄 템플릿 · 상품 카드 · 이미지 스튜디오).
- 거기서 import 를 따라간 백엔드 = 455파일 · 159,126줄(백엔드 전체 787 · 284,633줄). 화면 한 줄 입구에서 따라간 = 300파일 · 81,434줄(화면 전체 686 · 201,101줄).
- 워커(실행기 · 발송 워커)는 import 로 닿지 않는다(예: journey-executor) → 기능 이름 씨앗(journey- · continuous-operator · operator- · automarketing- · autosend- · planner- · dm- · email- · inapp- · sns- · line- · content-interview · image-studio · ai-line)을 더해 사람 읽기 범위를 다시 뽑는다(§3).

## §2 기계 측정 1차 (뿌리 규칙을 전 파일에 · 분류 전 후보 수)

| 뿌리 | 규칙 | 전 파일 후보 | 그중 한 줄 범위 |
|---|---|---|---|
| R12 | 순서 없는 묶음 LIMIT | 33 | 7 |
| R17 | 자리표 ≠ 바인드 | 1 | 0 |
| R15 | 화면 · SDK 소비처 없는 주소(960개 중) | 204(없음 68 · 애매 114 · 서버 링크 22) | 50 |
| R6 | 상태 칸 쓰기 값 | 312 | 131 |
| R8 | 주기 작업 66 · 횟수 올림 16 | 82 | 15 |
| R10 | 한국어 일반 Error(500 으로 나갈 수 있음) | 370 | 236 |
| R11 | 고객에게 돌려주는 문장에 칸 이름 · 개발 용어(서버 244 · 화면 118) | 362 | 90 |

후보 ≠ 결함. 줄마다 소비 코드를 읽고 결함 · 오탐(이유)으로 가른다(§4).

## §3 덮음표 (기능 × 뿌리 · 1025 읽기 끝 시점)

칸의 뜻:
- 읽음 = 사람이 줄마다 또는 표적으로 읽고 결함 · 오탐을 갈랐다.
- 시험 = 지금 계약 시험이 그 기능을 덮는다.
- 빈칸(□) = 사람 읽기는 했지만 기계 시험이 그 기능을 안 덮는다. 다음에 바뀌면 다시 샐 수 있는 칸이다.

| 뿌리 | 자동마케팅 | 플래너 | 모바일 DM | 이메일 | 인앱 | SNS | 만들기 | AI 한줄로 | 스튜디오 | 한 줄 CT | 여정 | 공용 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 같은 사실 두 벌 | 읽음 □ | 읽음 · 시험 | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 · 시험 | 표적 □ |
| R2 요금제 문 | 읽음 · 시험 | 읽음 □(공개 링크) | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 □ | 읽음 □ | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 해당 없음 |
| R3 사용자 범위 | 읽음 · 시험 | 읽음 □(결과 문자) | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 · 시험 | 표적 □ |
| R4 돈 순서 | 읽음 · 시험(발송) | 읽음 · 시험 | 읽음 □(AI) | 읽음 □(AI) | 읽음 □(AI) | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 · 시험 | 측정 □(Z4 31) |
| R5 본 것 ≠ 나가는 것 | 읽음 · 시험 | 읽음 · 시험 | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 해당 없음 |
| R6 닫히지 않는 상태 | 읽음 □ | 읽음 · 시험 | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 · 시험 | 측정 □ |
| R7 판정 못 함 | 읽음 □(함수 단위) | 읽음 □ | 읽음 · 시험 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | 읽음 · 시험 | 해당 없음 | 해당 없음 | 읽음 · 시험 | 측정 □ |
| R8 상한 없는 재시도 | 읽음 □ | 읽음 · 시험 | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 해당 없음 | 읽음 □ | 읽음 □ | 읽음 · 시험 | 측정 □ |
| R10 오류 원문 · 종류 | 읽음 · 시험(5xx) | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 읽음 · 시험 | 측정 □(Z7 110) |
| R11 고객 문장 하한 | 읽음 □(개발 용어) | 읽음 · 시험 | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 · 시험(□ 넘어온 문장) | 측정 □ |
| R12 묶음 LIMIT · 조용한 상한 | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 · 시험 | 측정 □ |
| R14 사람에게 안 닿음 | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 측정 □(Z8) |
| R15 죽은 주소 | 측정 □ | 측정 □ | 측정 □ | 측정 □ | 측정 □ | 측정 □ | 측정 □ | 측정 □(동적) | 측정 □ | 해당 없음 | 측정 · 시험 | 해당 없음 |
| R16 날짜 | 읽음 □ | 읽음 □ | 읽음 □(렌더러) | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 □ | 읽음 · 시험 | 표적 □ |
| R13 · R9 · R17 | 시험(전 파일 · 한 줄 입구 · 여정 + ai.ts) | | | | | | | | | | | |

지금 상태:
- 사람 읽기는 12기능 중 11기능을 마쳤다. 공용은 후보 줄과 돈 · 경보 입구만 표적으로 읽었다.
- 기계 시험 칸은 168칸(14뿌리 × 12기능)이다. 시험 39칸 · 빈칸(□) 118칸 · 해당 없음 11칸이다(기계로 셈).
- 결함 0을 말하려면 빈칸이 0이어야 한다. 그래서 처방(§8)은 결함을 고치는 것과 함께 빈칸마다 시험을 건다.

## §4 결함 목록

| # | 뿌리 | 자리 | 무엇이 틀렸나(증거) | 생긴 때 | 왜 지난번에 안 잡혔나 |
|---|---|---|---|---|---|
| 1 | R15 | routes/ai.ts `POST /operator/next-action` | 화면 · SDK 소비처 0 · AI 를 부르는 주소 | (확인 중) | R15 시험이 여정 주소만 봄 |
| 2 | R12 | utils/continuous-operator.ts `settlePendingCycleSnapshots` | 순서 없는 LIMIT 20 + 「완료인데 수신번호 0건」 행은 표식을 영구 유지 → 20건 쌓이면 뒤 행 영영 미처리 · 경고 = 로그만 | (확인 중) | R12 시험이 여정 파일만 봄 |
| 3 | R12 | utils/continuous-operator.ts `reconcileStuckSending` | `status = 'sending' LIMIT 100` 순서 없음 · 아직 안 늦은 행 · 조회 실패 행을 JS 에서 건너뛰어 그대로 남음(거름이 LIMIT 뒤) | (확인 중) | 같음 |
| 4 | R12 | utils/agency-send-mail-worker.ts:950 메일 접수 중복 판정 | 같은 회사 · 시각 · 문안 후보를 `LIMIT 5` 로 뽑은 뒤 받는 사람 명단 비교를 JS 에서 함 → 같은 문안 · 시각의 다른 명단 접수가 5건 넘으면 진짜 중복을 못 봐 두 번 접수(두 번 발송) | (확인 중) | 대행은 한 줄 기능 밖 · R12 시험 없음 |
| 5 | R12 | utils/agency-send-worker.ts:1834 `runLockRecovery` | `status IN (testing, final_testing) LIMIT 50` 순서 없음 · 「늦었나」 판정이 JS · 진행 중 행 50개가 자리를 차지하면 멈춘 건 복구 안 됨 | (확인 중) | 같음 |
| 6 | R12 | utils/ai-memory-accumulator-worker.ts DM 학습 · 이메일 학습(276 · 355) | 회사당 표식 한 행이라 SQL 이 이미 한 DM · 캠페인도 다시 뽑고 JS(doneRecently)에서 건너뜀 → LIMIT 20 · 50 이 끝난 것으로 차면 나머지 영영 미학습 | (확인 중) | 같음 |
| 7 | R12 · R8 | utils/ai-memory-accumulator-worker.ts:403 금지 패턴 증류 | 표본 부족 · AI 응답 실패 · 빈 결과면 기록 없이 `continue` → 그 회사가 계속 후보(LIMIT 5) · 매 회차 AI 를 다시 부름(비용 · 상한 없음) · 5개사가 걸리면 나머지 영영 미처리 | (확인 중) | 같음 |
| 8 | R12 | utils/company-daily-brief.ts:74 여정 정착 후보 | 순서 없이 `LIMIT 5` → 브리핑에 「정착할 만한 자동 마케팅」이 성과순이 아니라 임의 5개 | (확인 중) | 같음 |
| 9 | R12 | utils/customer-timeline.ts:312 DM 수신 토큰 | 순서 없이 `LIMIT 500` → 고객 활동 기록의 DM 열람이 임의로 잘림 | (확인 중) | 같음 |
| 10 | R12 | utils/planner-reconcile.ts:198 참여 클릭 보충 | 보낸 이메일 접점은 처리해도 조건에서 안 빠짐 · 순서 없이 `LIMIT 200` → 200 개 넘으면 뒤 접점은 참여 수집 영영 안 됨 | (확인 중) | 같음 |
| 11 | R12 | utils/retention-sweeper.ts:83 풀분석 PDF 파기 | 폴더 밖 경로 · 삭제 실패 행은 표식 없이 남음 · 순서 없이 `LIMIT 1000` → 쌓이면 뒤 PDF 영영 안 지움(보관 기한 위반) | (확인 중) | 같음 |
| 12 | R12 | utils/unified-customer-profile.ts:222 통합 프로필 재계산 | 「최근 6분 바뀐 고객」 창에서 순서 없이 `LIMIT 5000` → 동기화로 5천 명 넘게 바뀌면 나머지는 다음 회차 창에서도 빠져 영영 재계산 안 됨 | (확인 중) | 같음 |

| 13 | R15 | routes/ai.ts `POST /recommend-next-campaign` · `POST /recount-target` | 화면 · SDK 소비처 0(앞의 것 = AI 를 부르는 주소) | (확인 중) | R15 시험이 여정 주소만 봄 |
| 14 | R15 | routes/content-interview.ts(`/api/one-step` 5주소 · AI 생성 포함) | 화면 소비처 0 · 라우터 통째로 안 불림(R2 시험의 「만들기」 화면 라우터 목록에만 남음) | (확인 중) | 같음 |
| 15 | R15 · R6 | 자동발송(routes/auto-campaigns.ts 6주소 · `AutoSendFormModal.tsx` 1,648줄) | 0521 폐기 뒤 화면이 그리지 않음 · 멈춤 · 재개 주소 소비처 0 · 그런데 `auto-campaign-worker` 는 켜진 행을 계속 보냄 → 고객이 남은 자동발송을 멈출 길이 화면에 없음(켜진 행 수 = 배포 때 조회 · 미검증) | (확인 중) | 같음 |
| 16 | R15 | routes/cdp.ts `GET /recent-events` · `POST /recompute-profile` · `GET /inapp/stats` · `GET /inapp/preview/:id` | 화면 · SDK 소비처 0 | (확인 중) | 같음 |
| 17 | R15 | routes/email.ts `GET /ai/scenarios` · `GET /brand-signal` · `POST /ai/send-time` | 화면 소비처 0 | (확인 중) | 같음 |

R15 한 줄 범위 판정 = 외부 호출(오탐) = SDK(cdp identify · event · order · track · push · bulk-import) · 몰 서버(member-token) · 싱크 에이전트(`sync-agent/src/api/endpoints.ts` · /api/sync 11) · 동적 부름(proposals `${id}/approve` · 플래너 재확인 `${base}/${kind}` · ai-line `call('/x')` · 여정 동작 메뉴) · 옛 문자 링크 착지(플래너 approval/:token · 확인 대기). 한 줄 밖 죽은 주소 후보(알림톡 12 · 게이트웨이 템플릿 12 · 회사 7 · 그 밖) = §6 추가 과제로 따로 센다.

R12 후보 33 중 결함 = 위 #2~#12 · 오탐 21(LIMIT 0 칸 확인 6 · 표본 설계 4(enabled-fields 2 · gateway 3건 경고 · geo 같은 이름 2개 확인 2) · 처리하면 조건에서 빠짐 6(cdp 2 · retention 52 · planner 175 · sales 33 · 55) · 실패만 남고 영구 갈래 없음 2(memory 473 · alimtalk 469) · 미리보기 표본(발송은 전량 적재 · ai-line 은 수를 먼저 셈) 1) · 확인 대기 2(customers.ts:502 키 수 상한 · sales-outreach 78 파기 실패 반복이 사람에게 안 닿음).
R17 후보 1 = 오탐(agency-send-state.ts:152 함수가 $2 를 만든다 · 측정 규칙의 「앞 번호 빈칸」이 함수 반환 조각을 못 풂 → 시험에서 같은 파일 함수 반환 글까지 풀어야 함).

### §4-A 자동마케팅 (사람 읽기 · 백엔드 21파일 9,419줄 + routes/ai.ts 자동마케팅 주소 + 화면 15파일 · 다 읽음)

| # | 뿌리 | 자리 | 무엇이 틀렸나(증거) |
|---|---|---|---|
| 18 | R7 | continuous-operator.ts `recheckOpenProposals` 2093 · 2094~2105 | 혜택 · 회신번호를 고친 뒤 시스템 재검사 판정 = `passedVariantId` 유무(공용 판정 아님) · 검사 예외(장애) = 「차단」 기록 → 검사 장애 한 번에 예약 회차가 「바뀐 문안이 스팸 검사에 걸렸어요」로 멈춤. R7 시험이 파일 단위라 함수를 못 봄 |
| 19 | R7 | continuous-operator.ts `scheduleSequenceReminder` 3985 · `runProposalSpamRetest` 2224 | 리마인드 검사 · 화면 검사 결과 = 원값(`spamResult === 'pass'`) · 공용 판정 아님 |
| 20 | R6 | continuous-operator.ts `listProposals` 1878 · 회차 생성 만료 1527 | 검토(admin_review) 제안은 만료 없음(만료 = 승인 대기만) · 리마인드는 회차 만료에서도 빠짐 → 몇 주 지난 검토 제안 · 리마인드를 [승인]하면 그대로 나감(머리말 「7일 미응답 = 만료」가 검토 상태에 없음) |
| 21 | R14 | continuous-operator.ts `generateProposalForOperator` 1384~1387 | 문안 생성 실패 회차 = 다음 시각만 밀고 담당자 통지 0 · 회차 기록 0(같은 함수의 「판정 불가 · 계약 없음」은 알리고 기록함) |
| 22 | R14 | continuous-operator.ts `sendAutoSendPrepNotice` 4199~4208 · operator-prep-reminder.ts 57~75 · 133~151 | 담당자 문자 적재 결과를 보지 않고 「안내함」 기록(발송 예정 안내 = 멈춤 링크가 든 문자 · D-2 준비 · 만료 임박) |
| 23 | R14 | continuous-operator.ts `updateOperator` 875~878 · `archiveOperator` 907 | 중지 · 보관 때 열린 제안 닫기 실패 = 로그만 · 성공 응답(같은 함수의 리마인드 취소는 재시도 + 문자) |
| 24 | R14 | continuous-operator.ts `settlePendingCharges` · `releaseUnsentSendCharges` 2635 | 옛 정산 미확정 · 되돌림 실패 = 로그만(되돌림은 7일 창을 벗어나면 영영 안 함) · (적재 행 삭제 실패 `cleanupOrphanStaging` 3810 은 결함 아님 = 전역 청소 워커 staging-sweeper 가 24시간 뒤 미연결 적재분을 통째로 지운다 · 플래너 `cleanupPlannerStaging` 도 같다) |
| 25 | R12 | continuous-operator.ts `updateOperator` 697~703 · 796~800 | 월 · 일 예산 · 백업 담당자를 잠금 없이 미리 읽어 UPDATE 에 되씀 → 동시 편집 둘이면 앞 편집 값을 옛 값으로 되돌림(같은 함수 MMS 칸은 「선조회 되쓰기 금지」로 고침) |
| 26 | R8 | continuous-operator.ts 1331~1332 | 회사 문맥 없음이면 다음 시각을 안 밀고 끝 → 워커가 1분마다 다시 집음 |
| 27 | R1 | continuous-operator.ts `dispatchProposalSend` 3421~3428 | 예산 알림의 「이번 발송 금액」= 선점 때 옛 추정 · 같은 함수가 방금 실측으로 고친 값을 안 씀 |
| 28 | R5 | autosend-stop-link.ts `loadAutosendStopView` 95 · 102 · 화면 AutosendStopPage 112~118 | 멈춤 링크 화면 「나갈 문안」= 1안 원문(혜택 치환 전 · 보낼 안 번호 무시) · 같은 뿌리 = `adminStopProposal` 1803 학습 기록도 1안 |
| 29 | R1 · R5 | continuous-operator-policy.ts `resolveRetestCopy` 116~133 | 화면 스팸 검사가 「나갈 글」을 따로 만든다(주석 「발송 쪽 규칙을 바꾸면 여기도 바꾼다」) · 장문 승격 = 고쳤을 때만(발송 CT 는 늘) → 90바이트 넘는 안 고친 단문 = 단문으로 검사 · 장문으로 나감 |
| 30 | R1 | operator-daily-recap.ts 31~38 | 담당자 성과 문자 「발송 후 구매 N건 · 금액」= 회사 전체 구매(받은 사람 · 결제 확정 · 환불 · 주문 중복 거름 0) · 0927 R165 가 ROI 만 실수신자 기준으로 고침 |
| 31 | R1 | operator-conversion-attribution.ts 51~63 | A/B 밴딧 전환 = 회사 전체 구매 수 · 주석 「automarketing-roi 와 동일」이 0927 뒤로 거짓 → 학습이 엉뚱한 안에 점수 |
| 32 | R1 | 화면 ProposalDecisionCard.tsx 86~88 · 222 · 578 | 「ROI」= 추정기 퍼센트 값(operator-performance-estimator 236 `×100`)을 「N.N×」로 → 100배 부풀림(350% → 「350.0×」) · 같은 값을 OperatorResultCard 42 는 매출 ÷ 비용으로 바르게 |
| 33 | R1 | 화면 ProposalDecisionCard.tsx 89 · 381 | 「추천」 표지 = 열 때 다시 뽑은 밴딧 추천 · 「보낼 문안」= 만들 때 저장한 추천 → 다르면 안 나갈 안에 「추천」(1024 결함 9 를 서버만 고침) |
| 34 | R1 · R6 | routes/ai.ts learning-summary 2534 · 화면 ContinuousOperatorPage 720 | 「승인률」= status 'approved' 수 · 지금 승인은 'sending → sent' 라 'approved' 를 쓰는 곳 0 → 늘 0% |
| 35 | R1 | one-line-ask.ts `buildAutoAsk` 154~168 | 한 줄 묻기 「오늘의 추천」 카드 = 날짜 무관 최신 브리핑 · GET /operator/daily-brief 는 1024 결함 12 로 「오늘 · 어제 것만」 |
| 36 | R5 | 화면 SegmentPicker.tsx 175~194 | 「목표 문장으로 자동 판단 · 매 회차 다시 해석」= 1005 에 없앤 동작 · 실행 중 자동 마케팅을 이것으로 고치면 계약이 비어 다음 회차부터 멈춤 |
| 37 | R5 | 화면 ContinuousOperatorPage.tsx 728~730 | 「지난 14일 가장 효과 좋은 변형 = 변형 B」= 서로 다른 제안의 B안을 자리 번호로 합친 클릭률(다른 글끼리) |
| 38 | R5 | 화면 ContinuousOperatorPage.tsx 538 | 승인 확인 창 「승인 즉시 발송」 · 야간(21~8시)엔 서버가 오전 9시 예약으로 바꿈 |
| 39 | R4 | operator-message-decorator.ts `decorateOperatorMessages` 129~152 | AI 꾸미기 = 응답 받으면 3크레딧 차감 · 파싱 실패 · 사실 추가로 거절된 안은 원문을 그대로 돌려주고 알리지 않음(전부 거절이어도 차감) |
| 40 | R1 | 화면 OperatorPreviewModal.tsx 73 · OperatorSetupModal.tsx 159~160 (+ DmSendAndTrackModal 424 · AiLinePage 1001 · JourneyStepStudio 107) | 발송 가능 시각(8~21시)을 화면마다 숫자로 따로 적음 · 서버 SEND_HOURS 는 환경 변수로 바뀜 |
| 41 | (새 · 돈 버튼 금액) | 화면 MultiGoalModal.tsx 99~101 | 「충돌 분석 시작」= 5크레딧(ai-credit-calc 180) · 버튼 · 창에 금액 0(다른 한 줄 입구는 금액 표시) |
| 42 | R11 | continuous-operator.ts 275 · 279 · operator-message-decorator.ts 36 · routes/ai.ts 2268 | 고객에게 가는 문장에 영문 칸 이름 · 개발 용어(「name과 objective는 필수」 · 「컬럼」 · 「month는 1~12」) |
| 43 | R16 | operator-prep-reminder.ts 49~52 | date 칸을 ::text 없이 읽음 · 「원본 글 대조」 대안은 String(Date) 를 잘라 늘 거짓(죽은 대안) · 지금 값은 우연히 맞음 |
| 44 | R16 이웃 | autosend-policy.ts `computeNextOccurrence` 281 | 매월인데 날짜 칸이 빈 옛 행 = setUTCMonth(+1) → 29~31일이 다음다음 달로(그런 행 수 = 배포 때 조회) |
| 45 | R1 | continuous-operator.ts 3739 · automarketing-preview.ts 938 | 승인 기간 요약 SQL 두 벌(지금은 같은 글) |

자동마케팅 「결함 아님」으로 확인한 것(읽은 줄) = 등록 차감 → INSERT 한 트랜잭션 · 승인 선점 CAS · 발송 직전 상태 · 야간 · 스팸 통과 기록 · 예산(행 잠금) · 계약 일치(FOR SHARE) · 회신번호 · 080 · MMS · 발송 크레딧 엄격 차감 · 되돌림 거름 LIMIT 앞 · operator-audience · operator-recipients · automarketing-segment · operator-cycle-snapshot · operator-final-copy · operator-route · autosend-stop-public · automarketing-roi · recipient-conversion · automarketing-interview · automarketing-preview(보관본 · 판 번호 · 키) · 주소 22개(문 · 주인 · 오류 매핑).

### §4-B 플래너 (사람 읽기 · 백엔드 25파일 10,343줄 + 화면 10파일 3,111줄 · 다 읽음)

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 46 | R7 | planner-copy.ts 315~331 | 고친 문안 검사 = `spamCheckPlannerCopy(...).then((r) => !!r)` · 막힘과 장애가 둘 다 null → 검사 장애가 「고치신 문안이 스팸 검사를 통과하지 못했습니다」로 굳는다(같은 일을 하는 planner-recheck `checkEditedCopy` 는 판정 셋 · 장애 = 다음 주기) |
| 47 | R8 | planner-executor.ts 바깥 catch 730~734 · CHARGE_UNCONFIRMED 478~483 | 보내기 전 실패 = ready 로 되돌림 → 10분마다 하루 종일 다시 집고 매번 통신 3사 실검사 · 횟수 상한 0 |
| 48 | R7 | planner-recheck.ts `prepareProposal` 633~641 | 새 문안 검사 장애(error) = 「만들지 못함」+ 오늘 시도함 기록 → 그날 다시 안 만든다(마감도 그날 20시) · 만든 AI 문안은 버림 |
| 49 | R14 | planner-recheck.ts `remindRecheck` 595~605 | 17시 마감 전 문자 = 「보냄」 기록을 먼저 쓰고 적재 결과를 안 봄 → 못 나가도 다시 안 보냄(#22 와 같은 꼴 · 같은 파일 `notifyRecheck` 는 실패하면 기록을 되돌림) |
| 50 | R14 | planner-approve.ts `cancelPlannerEvent` 398~399 | 행사 취소 뒤 모바일 DM 멈춤 실패 = `.catch(() => null)` 로그도 없음 · 사람에게 0 → 취소한 행사의 DM 주소가 그대로 열림 |
| 51 | R1 | planner-approval.ts `cancelMonthlyApproval` | 월 대행 취소는 그 달 행사를 전부 취소하면서 모바일 DM 을 멈추지 않는다(행사 취소는 멈춤) · 「취소된 행사의 DM」 처리가 두 갈래 |
| 52 | R1 · R5 · R14 | planner-approval.ts 196 · 200~214 · 225~233 · planner-approve.ts 254 | 환불 금액 = 월 원장 `agency_credits`(그 달 승인 때마다 그때 단가로 덮어씀) · 원 차감액과 다르면 환불 거절(partial_not_supported) → 로그만 · 담당자 문자 = 「대행료를 전액 환불합니다」(환불 안 됐는데 판정 문장을 그대로 씀) |
| 53 | R3 | planner-report.ts 271~281 | 월말 결과 문자(회사 전체 수치) 받는 사람 = 그 달 행사 만든 사람 중 아무나 하나(`created_by LIMIT 1` 순서 없음 → 연락처 함수가 그 계정 번호를 먼저 씀) · 담당자가 남의 행사 결과를 받는다(1024 R3 는 화면만 고침) |
| 54 | R12 | planner-report.ts 250~255 · 284 | `ORDER BY plan_month LIMIT 50` + 못 보낸 달(시연 회사 = 통지 0 · 번호 없음)은 표식 없이 남음 → 그런 달이 줄 맨 앞을 영구히 차지 · 50개가 차면 아무 회사도 결과 문자를 못 받음 |
| 55 | R2 | routes/planner-recheck-public.ts 116~134 | 휴대폰 링크 [보내기](`approvePlannerPairTx` = 발송) = 요금제 문 없음 · PC 같은 동작(marketing-planner.ts 507)은 `aiZonePlanBlocked` 를 지남 · R2 계약 시험이 화면 PlanGate 표에 오른 라우터만 봐서 그 기능의 공개 링크 라우터가 밖 |
| 56 | R1 · R5 | planner-confirm.ts `buildConfirmView` 377 · 화면 PlannerConfirmView `CostCard` · `ConfirmSummary` · PlannerConfirmPage 137 · 151 · PlannerEventDetailPage 129 · 207 · 254 | 확인 본문의 문자 발송 = 생략된 것까지 전부(메일은 생략을 뺀다) → 「보낼 내용 N번」· 「N번 발송」· 문안비 합계가 생략 · 보낸 것까지 세고, [승인하기] 잠금이 생략된 발송의 문안 상태(검사 중 · 없음)에도 걸린다(서버 승인은 남은 것만 본다) |
| 57 | R5 | 화면 PlannerRecheckPanel.tsx 174 | 보내기 확인 창 「보내기 전에는 PC 한줄로에서 행사 승인을 풀거나 …」 = 그 행사에 이미 나간 발송이 있으면 승인 풀기는 거절(planner-approve 298~307) → 둘째 발송부터 거짓 |
| 58 | R1 | 화면 PlannerRecheckPanel.tsx 59 | 받는 사람 = 자체 문구(막힘 · 오류 = 「확인 중」) · 확인 화면은 `recipientsText` 가 셋을 가른다 → 영구 막힘이 「확인 중」으로 보임 |
| 59 | R5 | 화면 PlannerRecheckPanel.tsx 122 | 함께 나갈 DM 미리보기 = `sandbox=""` iframe(스크립트 0 = 슬라이드가 안 넘어감) · 확인 화면은 공용 미리보기(슬라이드 넘어감) → 담당자가 본 DM ≠ 고객이 보는 DM |
| 60 | R5 | 화면 PlannerRecheckPage.tsx 158 | 처리 뒤 「담당자에게 알림이 갔어요」 = 통지 결과를 보지 않고 늘 말함(번호 없음 · 적재 실패여도) |
| 61 | R5 | planner-line-read.ts 270~273 · 339 | 「언제 산 고객인가요?」 질문 = 필수 아님으로 내보내고 서버가 상품 구매자면 필수로 거절 → [담기]가 한 번 막힌 뒤 다시 눌러야 함(질문표 = 판정 계약 위반) |
| 62 | R1 (#40 같은 뿌리) | 화면 PlannerRecheckPanel 19 · PlannerRecheckPage 114 · PlannerEventDetailPage 69 · MarketingPlannerPage 할 일 · 행사 줄 · 다음 발송 · 빈 안내 · PlannerEventModal 167 · 170 · 298 · 405 · CopyEditDialog 367 · RecheckPanel 132 · planner-reasons.ts 33 · 80 · PlannerEventModal `sendDateOf` | 서버가 가진 값(발송 시작 8시 · 승인 마감 20시 · 확인 요청 3일 전 · 문안 1000자 · 야간 9시~8시)을 화면 · 문장이 숫자로 따로 씀(확인 본문엔 `sendHour` · `deadline.hour` 가 이미 온다) · 발송일 계산을 화면이 따로 함(앞날 기본값 화면 3 · 서버 0 = 이미 갈림) |

플래너 「결함 아님」으로 확인한 것 = planner-review(되돌림 한 트랜잭션 · 잠금 순서 · 쌍 재확인 진입 · 링크 발급 · 승인 직후 실주소 검사 판정 셋) · planner-recheck(잠금 · CAS · 마감 재확인 · 토큰 대조 · 미루기 날짜 잠금 · 링크 권한) · planner-reconcile(#10 밖 · 취소 잔존 표식 = 처리하면 조건에서 빠짐) · planner-build(만드는 중 잠금이 승인 · 고치기를 막음 · 같은 토큰 재사용) · planner-execution · planner-audience(참여자 축 = 저장 검증이 「전체」로 고정 · 도달 불가) · planner-channel-gate · planner-dm-check · planner-confirm(지문 · 번호 각인 · 견적) · planner-approve(잠금 순서 · 견적 잠금 안 재계산 · 대행료 트랜잭션 안) · planner-alimtalk · planner-participation(1차 밖 채널 = 저장 거절 · 도달 불가) · planner-calendar · routes/planner-recheck-public(#55 밖) · 화면 PlannerLineAsk · PlannerAudiencePicker · MarketingPlannerPage 판정 · PlannerEventModal 돈 줄.

### §4-C 모바일 DM (사람 읽기 · routes/dm.ts 2,898줄 + DM 유틸 55파일 · 화면 보내기 · 상세 · A/B · 편집기)

읽은 정도 = routes/dm.ts · dm-builder · dm-interaction · dm-draw-worker · dm-publish-core · dm-publish-gate · dm-recipient-token · dm-quick-action · dm-alert-copy · dm-event-recommender · dm-ab-test 전부 줄마다 · dm-ai 생성 길(oneShotGenerate) 줄마다 · 렌더 · 정의 파일(dm-viewer · dm-section-renderer · dm-section-registry · dm-tokens · dm-property-contract 등)은 날짜 · 추적 · 응모 토큰 · 개수 상한 표적 확인(편집기 대조는 1024 계약 시험 dm-editor-parity · dm-flow-invariants 가 덮음) · 화면 = MakeSendModal · DmDetailModal 줄마다 · DmBuilderPage · DmSendAndTrackModal · AbTestModal · DmEditScreen 은 돈 · 발송 · 주장 문구 표적.

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 63 | 부품≠기능 | routes/dm.ts GET /:id/winners · /:id/responses/export · POST /:id/winners/import · 화면 DmDetailModal 응답 탭 | 추첨 당첨자 명단 · 응모자 엑셀 · 사전 지정 올리기 = 서버 주소만 있고 화면 0 → 고객사는 「당첨 N」 숫자만 보고 누가 당첨됐는지 볼 길이 없다(경품을 못 보낸다) · 응답 목록 = 첫 50건만(더 보기 · 잘림 표시 0) · 블록 종류를 영문 원문(lucky_draw 등)으로 보임 |
| 64 | R1 · R5 | dm-ab-test.ts `aggregateResults` 365~380 · 화면 AbTestModal 525~527 | 클릭 = 기록에 없는 키(`cta_click`)를 셈 → 늘 0 · 「클릭」 · 「전환」 지표 승자 영영 없음 / 순방문 = 공개 A/B 링크에 없는 전화번호를 셈 → 0 / 완독률 = 완독 CT 와 다른 식 · 세로 스크롤 DM 은 거의 100%(A/B 추적은 스크롤 % 를 받지도 않음 routes/dm.ts 2529) |
| 65 | R1 · R4 · R5 | dm-publish-core.ts 78~91 · dm-publish-gate.ts 173~180 · 화면 DmBuilderPage 798 · 802 | 발행비 판정 두 벌 — 보내기 길은 옛 발송 이력이 있으면 면제(소급 금지) · 발행 길은 면제 없음 + 목록 [발행 주소 복사]는 금액을 싣지 않아 확인 없이 차감 → 원장 키 없는 옛 발행 DM(종량제 전 발행 · 보내기 면제로 발행 · 크레딧제 나중 적용)의 주소 복사 = 발행비가 조용히 빠지고 화면은 「이미 발행, 추가 과금 없음」 |
| 66 | R4 · R5 | 화면 DmSendAndTrackModal 540 「SMS 짧게 (90바이트·저단가)」 · dm-alert-copy · routes/dm.ts 1516 `msgType: 'LMS'` | 짧은 문안을 고르게 하고 「저단가」라 말하지만 DM 발송은 늘 LMS 로 적재 → 고객사는 LMS 요금을 낸다 |
| 67 | R4 · (#41 부류) | dm-quick-action.ts 139~147 · 화면 DmBuilderPage 952~958 | [카피 다듬기] = 글 블록마다 AI 1회 · 1크레딧(묶음 밖) · 버튼에 금액 0 · 버린 다듬기 · 바뀐 것 0 도 차감(#39 같은 꼴) |
| 68 | R1 | dm-quick-action.ts 332~342 | 빠른 수정이 dm_pages 를 바로 덮는다 — 발행 중 DM 이면 일반 저장(PUT /:id)은 관문을 보는데 이 길은 안 본다 · 저장 판도 안 본다(띠가 닫을 때까지 남아 발행 뒤에도 누를 수 있다) |
| 69 | R1 · 부품≠기능 | dm-interaction.ts `loadDrawableLuckyDraws` 490 · dm_draw_runs(DM 당 1행) · 화면 dmBuilderStore 700(쪽마다 개수 제한) | 한 DM 의 여러 쪽에 추첨 블록을 하나씩 두면 둘째부터는 영영 추첨되지 않는다(후보 = 첫 추첨 블록 · 서버 개수 판정 `isMaxCountExceeded` 는 부르는 곳 0) |
| 70 | R5 | dm-interaction.ts `getWinners` 287~297 · `buildResponseExportRows` 336~354 | 당첨자 조회가 response_id 를 안 꺼내 응모자 엑셀의 당첨여부 · 당첨등급이 추첨 당첨자에게 늘 빈칸(#63 을 열면 바로 드러남) |
| 71 | R8 · R14 | dm-draw-worker.ts 38~40 | 추첨이 실패하면 로그만 · 1분마다 끝없이 다시 · 사람 0(당첨자가 안 나오는 사실이 아무에게도 안 간다) |
| 72 | R5 | routes/dm.ts 1959~1963 | 테스트 문자 「- 샘플: VIP 샘플」 · 링크의 샘플 값(s)을 뷰어가 읽지 않아 열면 「고객님」 공용 화면 |
| 73 | R1 · R5 | routes/dm.ts GET /overview 2718 · 화면 DmBuilderPage 1136 | 「평균 클릭률」 = 응모 · 응답 수 ÷ 열람 수(클릭이 아니다 · 공용 링크 익명 열람까지 분모) |
| 74 | R5 | 화면 DmDetailModal 「구매 = 열람 뒤 7일 안 주문」 · routes/dm.ts 1603~1607 | 서버는 발송(토큰 발급) 뒤 7일을 센다 → 문장 ≠ 셈 |
| 75 | R5 | 화면 MakeSendModal 377 · 382 · DmSendAndTrackModal 397 · 977 | 「추천 시간」 · 「AI 추천」 = 늘 내일 오전 10시 · 「문자 열람이 많은 시간대예요」 근거 0(열람 시간대 실측 hourDistribution 이 있는데 안 씀) |
| 76 | R1 · R4 | 화면 DmBuilderPage 1503~1511 · 1441~1450 | 편집기 [발행] 확인 창 금액 = 화면 단가표 · 서버로 그 금액을 싣지 않음(expected_fee 0) → 서버 단가가 바뀌면 창 금액 ≠ 차감 · 보내기 창은 서버 견적 + 금액 묶음(같은 돈 두 규칙) |
| 77 | R15 | routes/dm.ts GET /:id/stats · /sample-customers · /templates · /templates/:id · /catalog/templates · POST /event-recommend(AI 5크레딧) · GET /personalization-vars · /:id/event-insight (+ #63 의 셋) | 화면 · SDK 호출 0(정확 대조 · 동적 조립 확인) · /:id/stats 의 완독 = 또 다른 식 · R15 기계 측정이 이 주소들을 놓쳤다(기준 주소 + 끝 조각 맞춤이 느슨 = 거짓 음성) |
| 78 | R10 | dm-ab-test.ts 273 → routes/dm.ts 2400 | A/B 시작 조건(발행 중 DM 만)이 500 으로 나간다 |
| 79 | R11 | routes/dm.ts 1024 · 2272 · 2301 · 2335 · 공개 2463 · 공개 2748 · dm-event-recommender 115 | 고객 문장에 개발 용어(prompt · scenario · sections · url · variant_a_page_id · section_id · 「회사 admin 직접 혜택 작성 의무」) |
| 80 | R12(조용한 상한) | dm-builder.ts listDmVersions 371 · getDmStats 1155 · getDmSendBatches 988 · dm-ab-test listAbTests 167 · routes/dm.ts 1282 | 목록 상한(50 · 200 · 100 · 100 · 10,000)에 잘림 알림 0 |
| 81 | R16 이웃 | dm-section-renderer.ts 1246 · 1277 · 1477 · 152~154 · dm-viewer.ts 41~43 | 발표 · 만료 시각 · 날짜 = 시간대 지정 없는 서버 로컬 표시 · D-day = 'YYYY-MM-DD' 를 UTC 자정으로 읽어 KST 0~9시엔 당일이 「D-1」(서버 시간대 값 = 배포 때 확인) |
| 82 | R1 | dm-alert-copy.ts 84 | 단문(SMS)을 골라도 사용자 지시 끝 = 「LMS 문안 1개」(시스템 지시와 갈림) |

모바일 DM 「결함 아님」으로 확인한 것 = 공개 뷰어(토큰 회사 대조 · 중지 문구) · 열람 추적(토큰 우선 · 테스트 거름) · 단축 링크(검증 · 상한 INSERT 결합 · 발급 뒤 차감) · 한글 주소 · 저장(발행 중 관문 · 저장 판 CAS) · 버전 셋(같은 가드 · 번호 잠금) · 중지 · 재개(한 문장 판정) · 첫 발행 CAS · one-shot(단계 = runLineCookOrder · 일반 = 확인 → 생성 → 차감) · send-to-target 순서(중지 → 관문 → 발행비 → 080 → 발신 → 대상 · 범위 · 동의 → 개별 회신 → 정제 뒤 토큰 → 발행 → 차감 → 적재 → 정제 수 → 접수 · 실패 = 토큰 정리) · 응모 제출(블록 종류 서버 판정 · 동의 · 필수 · 쿠폰 만료 · 1인 1회 · 추첨 뒤 응모 막음 · 선착순 잠금) · 룰렛 재고 원자 차감 · 추첨 한 트랜잭션 · 보내기 창 080(설정 응답이 발송과 같은 함수) · 대상 수(같은 범위 · 동의 문) · 편집기 일시 = ISO UTC.

### §4-D 이메일 (사람 읽기 · routes/email.ts 1,836줄 · email-channel 발송 엔진 · 예약 워커 · 완성 · 관문 · AI 실패 처리 · 화면 EmailCampaignsPage · 보내기 창 · 이력 · 받는 사람)

읽은 정도 = routes/email.ts · email-send-sweeper · email-send-gate · email-complete-core · email-completion · email-channel 발송 · 이벤트 · 대상 함수 줄마다 · email-ai 는 차감 앞뒤 실패 처리 표적 · 렌더러(email-section-renderer · email-tokens · email-blocks)는 1024 세 채널 구조체크 범위 · 화면 = 돈 · 수 · 상태 표시 표적.

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 83 | R5 | email-channel.ts 446~456 · routes/email.ts 813 · 화면 MakeSendModal 543 | 같은 메일을 다시 보내면 이미 받은 사람은 조용히 건너뛴다 · 응답 · 화면은 「N명에게 보내기 시작했어요」(실제 새로 나가는 수 ≠ N · 다 받은 메일이면 0통) |
| 84 | R5 · R14 | email-channel.ts 597~632 | 한 통도 못 나가도(회사 메일 인증 오류 등 수신자마다 실패) 상태 = completed · 보낸 수 0 · 사람 0 |
| 85 | R14 | email-send-sweeper.ts 99~104 · 124~131 · 136~145 · 152~159 | 예약 메일이 실패(채울 자리 · 받는 사람 0 · 회사 메일 오류 · 30분 정체)로 끝나면 로그만 · 담당자 알림 0(화면 상태만 「보내지 못함」) |
| 86 | R12(조용한 상한) | 화면 EmailCampaignsPage 219 · 785~797 · listEmailCampaigns 216~224 | 목록 = 최근 50개만(서버 상한 200) · 51번째부터 화면에서 사라진다 · 「평균 오픈율 · 클릭률 · 반송률」도 50개로 셈 |
| 87 | R1 · R4 | routes/email.ts 1587 · 1611 | 같은 「다듬기」 1크레딧이 두 규칙 — 글 다듬기는 바뀐 것이 없어도 차감 · 블록 다듬기는 바뀐 때만 |
| 88 | R5 | routes/email.ts 864~873 · 화면 MakeSendModal 「테스트로 받아 보기」 | 테스트 메일 = 저장값 그대로((광고) 제목 · 수신거부 꼬리 · 추적 없음) → 받아 본 메일 ≠ 고객이 받을 메일 |
| 89 | R15 | = #17 (같은 결함 · 정확 대조로 다시 확인 · 덧붙임 = /ai/send-time 은 5크레딧 주소) | 처방 · 셈은 #17 한 줄로 |
| 90 | R11 | routes/email.ts 156(.env SMTP_ENCRYPTION_KEY) · 429 · 468 · 569 · 584 · 751 · 1582 · email-channel.ts 412 | 고객 문장에 칸 이름 · 내부 설정 이름(host / port / user · to_email · html_body · recipients · 「회사 admin … 진입 의무」) |
| 91 | R1(#40 · #62 같은 뿌리) | routes/email.ts 774 · 846 · 913 · 화면 EmailCampaignsPage 512 · 1296 · 1390 | 단가를 문장에 숫자로 박음(「완성 저장(50크레딧)」 · 「AI 다듬기 (1 크레딧)」) |

이메일 「결함 아님」으로 확인한 것 = 추적 픽셀 · 클릭(서명 토큰 · 열린 리다이렉트 차단) · 수신거부(토큰 · 고객 행 동의 끔) · 즉시 발송 선점 CAS · 예약 선점 · 정체 복구 · 완성 = 차감 앞 관문 · 엔진 단일 길목 관문(채울 자리 · 링크) · 거부 주소 거름(엔진 + 대상 수 = 고객 행 표식으로 같은 결과) · 재발송 1회 잠금 · 담당자 범위(대상 · 미리보기 · 목록) · 이벤트 첫 발생 잠금 · 이력 CSV 상한 알림.

### §4-E 인앱 (사람 읽기 · routes/cdp.ts 인앱 · 푸시 주소 1,198~2,152 줄마다 · 쇼핑몰 공개 주소(노출 · 기록) · inapp-explainer · inapp-quick-action 과금 길 · inapp-ai-generator 돈 순서 · 화면 InAppMessagesPage 돈 · 문구 표적)

읽은 정도 = 주소 줄마다 · inapp-message(1,798줄) · funnel-stats · segment-matcher · variant-optimizer · personalization 은 주소가 부르는 함수 표적(1024 세 채널 구조체크가 줄마다 본 범위).

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 92 | R1 · R4 | routes/cdp.ts POST /inapp 1338~1345 · PUT /inapp/:id 1426~1453 | 같은 「게시」 돈 두 규칙 — 새 메시지를 바로 게시(POST)하면 차감이 실패해도 게시가 남는다(로그만) · 고쳐서 게시(PUT)는 실패하면 게시를 되돌린다 |
| 93 | R4 · Z4 | inapp-explainer.ts 281~295 · inapp-quick-action.ts 112~175 | AI 영향 요인 분석 · 다듬기 = 응답을 받는 순간 차감 → 읽지 못함(형식 오류 → 500) · 세 안 전부 버림(혜택 · 숫자가 생김)이어도 1크레딧 나감 |
| 94 | R15 | = #16 (같은 결함 · 정확 대조로 다시 확인 · 덧붙임 = /recompute-profile 을 지우면 그 안의 `recomputeProfileBatch`(#12 순서 없는 LIMIT 5000)도 부르는 곳 0 → #12 는 함께 지운다) | 처방 · 셈은 #16 한 줄로 |
| 95 | R11 | routes/cdp.ts 776 · 1228 · 1748 · 1757 · 1772 · 1785 · 1793 · 1928 · 1979 · 2003 · 2013 · 2022 · 화면 InAppMessagesPage 965~966 | 고객 문장에 칸 이름 · 영어(message_id · action_type · segment_conditions · parent_message_id · variant_id · Explain · Quick action · Variant · impression · 1-click) |

인앱 「결함 아님」으로 확인한 것 = 노출 판정(회원 증명 뒤만 개인화 · 기기 id 기록) · 노출 기록(회원 증명 · 소유 대조) · 게시 앞 표시 가능성 관문 · 링크 결함 관문 · PUT 게시 잠금 · 보상 순서 · 요금제 문(게시 · 생성 · 변형 켜기) · 관리자 전용 · 이미지 경로 조작 차단 · 생성 = 잔액 확인 → 생성 → 성공 뒤 1회.

### §4-F SNS (사람 읽기 · 주소 정확 대조 · 게시 워커 · 대조 워커 · AI 글 과금 길 · 화면 호출 목록)

읽은 정도 = sns-publish-worker 앞 140줄 + 재시도 · 상한 갈래 · sns-reconcile-worker 확인 · 삭제 감지 줄마다 · sns-caption-ai 과금 길(단가표 키 없음 = 0크레딧) · 나머지 어댑터 · 미디어 · 계정은 2026-09 설계 · Codex 범위(이번 뿌리 R12 · R14 · R15 만 표적).

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 96 | R14(#85 같은 꼴) | sns-publish-worker.ts `failTarget` 107~111 · sns-reconcile-worker.ts 66~76 | 예약 게시가 실패(채널 거절 · 결과 모름 · 컨테이너 3회 실패)로 끝나도 사람 알림 0 · 화면 이력만 |
| 97 | R12 | sns-reconcile-worker.ts `verifySubmitted` 92~133 | 계정 토큰이 빠진 행은 확인을 건너뛰고 갱신 시각을 안 바꿔 순서(updated_at) 맨 앞을 24시간 차지 → 그런 행이 5개면 다른 게시의 확인이 최대 24시간 밀린다(「올리는 중」) |
| 98 | R15 | routes/sns.ts GET /specs · POST /posts/:id/publish | 화면 호출 0(게시 = POST /posts 의 publish 칸 · 규격 = overview) |

### §4-G 만들기 · 템플릿 (사람 읽기 · routes event-campaigns · line-templates · mall-products · content-interview 줄마다 · campaign-quick 1,089줄 · ai-auto-build-materials 561줄 · line-steps-context · line-materials · line-headline-make · line-draft-memo 줄마다 · 그 밖 line-* = 돈 · 출력 · 상한 · 날짜 표적 · 화면 만들기 · 결과 · 행사 창 · 판독 창 · 재료 패널 돈 · 문구 표적)

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 99 | R15 | = #14 (같은 결함 · 정확 대조 · 세 화면 꾸러미로 다시 확인) | 덧붙임 = 이 라우트만 쓰는 부품 셋(content-interview-fill.ts · one-step-cost.ts · dm/dm-interview-contract.ts)도 함께 지운다 · `content-interview.ts` 유틸의 `validateAnswer` 는 ai-line · one-line-facts · one-line-steps 가 써서 남긴다 · R2 시험 목록에서 content-interview.ts 를 뺀다 · 처방 · 셈은 #14 한 줄로 |
| 100 | R15 · R12 | routes/event-campaigns.ts POST /drafts/:id/archive · GET /drafts `LIMIT 50` · 화면 EventCampaignResumeBar | 「보관 종료」 주소는 있는데 화면 버튼 0 → 임시 보관 띠의 초안을 고객이 치울 길 없음 · 30일 동안 칩이 50개까지 쌓이고 넘치면 조용히 잘림 |
| 101 | R15 · R11 | routes/mall-products.ts GET /preview · /search 400 문장 | /preview = 화면 호출 0 · 몰 API 원문 응답을 그대로 내보냄 · 두 오류 문장에 로드맵(「메이크샵 · 고도몰 · 아임웹은 … 추가」 · 로드맵 노출 금지) |
| 102 | R5 · R4 | utils/campaign-quick.ts `generateFromBuildMaterials` 판독 캐시 갈래(`if (cachedVision)` · `readKeyToCharge`) | 미정산 판독 캐시는 이미지 묶음만 키로 본다 → 글을 넣어 견적에서 판독 부품이 빠져도 판독비 3을 걷음 · 재현 = 사진만 넣고 만들기 → 조립 실패(초안 0 · 캐시 미정산) → 행사 글 입력 → 견적 5 → 만들기 → 5 + 3 = 8 차감 |
| 103 | R5 · R1 | 화면 QuickCampaignResultPage 170 · 177 · 180~200 · 372~376 → QuickCampaignPage 350~356 | 「이메일도 만들기 · N」 버튼 · 「다시 만들기 · N 크레딧」 확인 창 = 화면 단가표(AI_GENERATE_COSTS) 생성비만 · 실제 차감 = 서버 견적 합계 → 사진만 재료이고 판독 캐시(10분)가 지나면 판독 3이 붙는데 다른 채널은 확인 창 없이 · 다시 만들기는 만들기 화면이 「확인은 이미 받았다」로 바로 실행 |
| 104 | R1 · R4 | MaterialQuickPanel(DM 편집기 · 이메일 편집기 · 이메일 만들기 편집) → `generateDmFromMaterials` · `generateEmailFromMaterials` / 만들기 화면 → `generateFromBuildMaterials` | 「재료로 만들기」가 두 길 · 견적 함수 두 벌(quoteQuickCampaign · quoteBuildMaterials) · 돈 순서 두 벌(v0 = 견적 결박 0 · 시도 토큰 0 · 이메일 차감 멱등키 0 · deductCreditSafe / v1 = 결박 409 · 시도 토큰 · 던지면 행 회수) · 채우기 엔진 두 벌(v0 = 영업용 outreachEngineDeps · v1 = 고객용 customerEngineDeps) → 같은 재료가 입구마다 다른 결과 · 다른 돈 규칙 |
| 105 | R1(Z2 이웃) | 화면 ImageToCopyModal 18 · EventCampaignModal 34 `IMAGE_EXTRACT_COST = 3` · EventCampaignModal 28~30 `?? 5 · ?? 3 · ?? 3` | 판독 단가를 화면에 숫자로 박음 · 단가표에 키가 없으면 숫자로 대체(서버 단가가 바뀌면 화면만 거짓) |
| 106 | R11 | routes/event-campaigns.ts 61 · 168 | 업로드 오류 = multer 원문(영어 「File too large」 · 「Too many files」)을 고객 문장으로 그대로 → 공용 Z5 |
| 107 | R11 | utils/ai-auto-build-materials.ts `normalizeBuildMaterials` | 고객 문장 「시도 토큰이 없거나 형식이 맞지 않습니다」(개발 용어) |
| 108 | R15 | line-template-run.ts `lineTemplateManual` · `buildLineTemplateInapp` · line-compositions.ts `compositionBodyCount` · ai-auto-build-materials.ts `buildImagesOf` | 운영 · 시험 호출 0(이름은 라우트 금지 목록 글자로만 남음) |
| 109 | R10 | utils/campaign-quick.ts 297 · 400(`throw new Error(한국어)`) → routes/dm.ts 재료 갈래 catch · email 같은 갈래 | 재료가 비면(이미지 0 · 글 0) 사용자 조건인데 500 「재료로 시안을 만들지 못했습니다」로 접힘(400 이어야 · 사유 문장 소실) |
| 110 | R11 | 화면 EventCampaignModal 316 `summaryOf` | 인앱 결과 요약에 템플릿 · 카드 모양 영문 키(center_modal · full_image · 카드 모양 키) 그대로 |

만들기 「결함 아님」으로 확인한 것:
- 사진 판독 주소(extract-image)는 요금제 문 밖이 맞다. AI 한줄로 · DM · 이메일 · 인앱 입력칸이 함께 쓰는 판독이고, 크레딧 확인 뒤 성공했을 때만 걷는다.
- v0 엔진의 AI 호출은 회사 값을 넘기지 않는다. 그래서 묶음 밖에서 따로 차감하는 일이 없다.
- v1 판독은 묶음 안에서 돌고, 초안이 생긴 뒤 시도 토큰 키로 한 번만 걷는다. 실패한 시도는 미정산 캐시로 남아 다음 성공 때 처음 키로 걷는다. 다만 #102 갈래는 예외다.
- 몰 재조회가 실패해도 결과 바가 「불러온 값을 그대로 썼어요」라고 알린다.
- 첫 화면 사진 자격 문구에 「로고 · 세로형은 첫 화면이 되지 않아요」가 들어 있다.
- 카페24 · 네이버는 회사 단위 연동이라 담당자 범위 판정 대상이 아니다. 담당자 범위는 우커머스만 본다.
- 헤드라인 그림 작업 원장(만드는 중 → 차감 중 → 완료 · 차감 원장 대조)은 정상이다.
- 착지 초안 기억(낸 초안 30분 · 회수 실패 초안은 회수될 때까지)은 정상이다.
- 한 줄 단계 금액 확정의 순서는 503 → 409 → 같은 시도의 오늘 · 어제 키다.

확인 대기(배포 때 서버에서): AI_AUTO_BUILD_COMPANY_IDS 값. 비어 있거나 일부 회사만 들어 있으면, 빠진 회사의 만들기 화면이 옛 화면(QuickCampaignLegacyPage)으로 열린다.

### §4-H AI 한줄로 (사람 읽기 · routes/ai-line.ts · services/ai-line.ts · ai-line-spam · hub-company-context · alimtalk-ai-matcher 줄마다 · utils/ai-line.ts 순수 판정 = 1018~1023 Codex 범위라 돈 · 출력 표적 · 화면 AiLinePage · LineIntakeModal · LineResultCards 돈 · 제목 · 문구 표적)

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 111 | R11 | 화면 AiLinePage 520 `resolveSubject` | 문자 제목 대체 = 캠페인 내부 이름(AI 추천 캠페인명) → 「{회사명} AI 캠페인」 → 「AI Operator」(영어 · 개발 이름) · 제목 칸에 미리 채워져 그대로 보내면 받는 고객에게 내부 이름이 감 |
| 112 | R12 | utils/alimtalk-ai-matcher.ts 169~178 | 승인 템플릿 `ORDER BY created_at DESC LIMIT 50` → 51번째부터 매칭 후보에서 조용히 빠짐(안내 0) |
| 113 | R4 · Z4 | routes/ai.ts POST /operator/alimtalk/match(화면 JourneysPage 823) → `matchAlimtalkTemplate` | 묶음 밖 1크레딧(alimtalk-matcher) · AI 응답을 읽지 못하면 키워드 대체 결과를 주는데 1크레딧이 이미 나감(AI 한줄로 갈래는 묶음 안 = 0 · 같은 함수 두 돈 규칙) |
| 114 | R10 | services/ai-line-spam.ts `startLocked` `throw new Error(out.error)` | 시험폰 0대(「지금은 스팸 검사를 할 수 없습니다」) · DB 마이그레이션 대기(503 이어야) · 큐 등록 오류가 전부 500 「처리 중 문제가 생겼어요」로 접힘 → 칩이 사유 대신 일반 오류 |

AI 한줄로 「결함 아님」으로 확인한 것:
- 네 입구(대상 찾기 · 진행 · 만들기 · 알림톡)의 돈 순서가 한 꼴이다. 원장 먼저 → 잔액 → 묶음 AI → 검증 → 성공 뒤 차감이고, 동시 소진은 402로 끝난다.
- 기본 정산은 한 자리에서 한다. 키 잠금 안에서 오늘 · 어제를 다시 본다.
- 같은 시도의 재요청은 원장 금액만큼만 돌려준다.
- 꾸미기는 글이 바뀌었을 때만 걷는다.
- 대상은 승인 발송과 같은 몸통이고, 해석 못 한 조건은 돈 입구에서 막는다.
- 스팸 검사는 회사 잠금 안에서 재사용 → 줄 → 선불 순서로 간다.
- 080 번호는 getOpt080Number로 덮어쓴다.
- 추천 시간은 실제 AI 추천을 「AI 추천」으로 표시한다.
- 주소 정확 대조에서 ai-line 10개가 「죽음」으로 나온 것은 거짓 양성이다. 화면이 `/api/ai-line${path}`로 조립해 부른다. 시험은 이 조립 꼴을 읽어야 한다.

### §4-I 이미지 스튜디오 (사람 읽기 · routes/image-studio.ts 795줄 줄마다 · utils/image-studio.ts 오류 표 · 시간 상한 · 임시 정리 · 잠금 표적 · 템플릿 정의 4,616줄 = 자료(문안 · 무드)라 표적 제외 · 화면 ImageStudioPage 돈 표적)

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 115 | R15 | routes/image-studio.ts POST /compose · POST /template-samples/generate | /compose = 화면 호출 0 · /template-samples/generate = 슈퍼관리자 도구(화면 0 · 면제라면 이유 줄로) |
| 116 | R1(Z2 이웃) | routes/image-studio.ts 생성 `checkCredit(companyId, 2)` · `const cost = 2` · line-headline `checkCredit(…, 2)` · `cost: 2` · 수정 `const cost = 1` · 화면 ImageStudioPage 303 「· 2크레딧」 · constants/credit.ts 33 `cost: 2` | 단가표 키(image-studio-generate · image-studio-edit)가 있는데 같은 값을 일곱 곳에 숫자로 박음 |
| 117 | R1 · R5 | utils/line-headline-make.ts `makeLineHeadlineImage`(moveTempToPermanent 만) vs routes/image-studio.ts /save(registerAsset) | 2크레딧 낸 한 줄 헤드라인 그림은 소재 등재 0 → 라이브러리에 안 보이고(다시 쓰기 · 지우기 불가) 저장 용량 셈(getStorageUsage = cdp_assets 합)에서 빠짐 · 같은 2크레딧 스튜디오 포스터는 등재 · 셈 둘 다 |
| 118 | R11 | routes/image-studio.ts 491 upload-product | 업로드 오류 = multer 원문(영어) → Z5 |

이미지 스튜디오 「결함 아님」으로 확인한 것:
- 생성 · 수정 · 헤드라인의 돈 순서가 맞다. 회사 잠금 → 기억 결과 → 납부 확인 → 잔액 → 생성 → settleCreditAfterSuccess 순이다.
- 헤드라인 파일 원장(만드는 중 · 차감 중 · 완료)은 정상이다.
- 저장 경합(같은 임시 id 줄 세우기)과 등재 모름 → 503 · 마무리 대기 처리는 정상이다.
- MMS 변환은 300KB 실측으로 보장한다.
- 임시 파일은 7일 정리 워커가 지운다.
- 상품 받기는 가드 이미지 CT를 쓴다.
- 오류 표에 모델명이 없다.

### §4-J 한 줄 CT (사람 읽기 · one-line-ct/order.ts · ai.ts · index.ts 판단 · questions · recurring 줄마다 · listen · catalog · preview · one-line-facts · one-line-steps · one-line-ask = 1022~1024 재점검 범위라 날짜(KST) · 돈 · 상한 · 출력 표적)

새 결함 0. 확인한 것:
- 요리 주문 한 곳에서 돈 순서가 맞다. 시도 잠금 → 한 줄 잠금 → 착지 기억 → 오늘 · 어제 키 → 금액 확정 → 몰 · 페이지 대조 → 잔액 → 묶음 cook → 초안 → 차감 → 결말 순이다.
- 판단 2는 성공 뒤에만 정산하고, 정산 직전에 다시 확인한다. AI 실패 · 상한 · 잔액 부족은 규칙 판단(0원)으로 간다.
- AI 칸 정리는 숫자 · 혜택 · 효능 단정 판정을 거친다.
- 날짜는 전부 KST로 계산한다.
- 질문 답은 서버 질문표로만 검증한다.

덧붙임:
- 요리 주문은 차감 결말이 failed이면 결과를 주지 않는다. settleCreditAfterSuccess는 failed여도 결과를 준다.
- 그래서 Z6의 「성공 뒤 차감」 규칙은 두 벌이 아니라 세 벌이다(아래 Z6).

### §4-K 여정 남은 칸(R1 · R5) · 허브 주소(routes/ai.ts · cdp.ts 나머지)

읽은 정도:
- 여정 미리보기 · 사전 시험 · 실행기가 문안을 조립하는 함수를 대조했다.
- 여정 켜기 판정의 거절 문장 출처를 따라갔다.
- 허브 두 라우터는 주소를 정확 대조했다. 동적 조립(proposals `${path}` · 여정 동작 `${mode}`)은 손으로 확인했다.

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| 119 | R11 | utils/journey-builder.ts 980~986 `activateJourney` Liquid 검증 → `valid.errors.map(e => e.message)` | 여정 켜기 거절 문장에 템플릿 엔진 오류 원문(「Tag 미종결 (position N)」 · 「for 문법 오류」 · 「미지원 tag」 · 「assign 문법 오류」)이 그대로 붙어 고객에게 감 · 1025 여정 R11 시험은 여정 파일에 적힌 문장만 보고 다른 모듈에서 넘어오는 문장은 안 봄 |

확인한 것:
- 여정 미리보기(preview-message) · 사전 시험 · 실행기가 같은 `renderJourneySmsMessage`를 쓴다. 080은 여정을 만든 사람 기준이라 R5에 맞다.
- 허브 죽은 주소는 정확 대조로 다시 확인했다. 결과는 #1(operator/next-action · 5크레딧 키)과 #13(recommend-next-campaign 5크레딧 · recount-target)이고 새 주소는 없다.
- cdp의 SDK · 몰 서버 주소(ingest · member-token · identify · event · order · webhook · push · inapp active · track · image · bulk-import · journey-variants track)는 외부 호출이다. 시험 면제(이유 = 외부 연동 API)로 둔다.

### §4-Z 공용(기능 넘음 · 읽는 중 쌓음)

| # | 뿌리 | 자리 | 결함 |
|---|---|---|---|
| Z1 | R14 · R5 | utils/ai-credit.ts `deductCreditSafe` 288 · 302 | 크레딧 차감 최종 실패 = stdout `[CREDIT][MISS]` 만 · 사람 0(소비처 전부) · 원장 행이 판정인 곳(이메일 완성 · DM 발행비)은 「완성 · 발행」 응답 뒤 판정이 거짓이 된다(이메일 = 발송이 「완성 저장 후」로 막힘) |
| Z2 | R1 | dm-alert-copy.ts 90 · event-image-extract.ts 188 · 228 | 단가를 숫자로 박음(`creditCost: 3` · 단가표 키 없음) |
| Z4 | R4 | services/ai.ts `callAIWithFallback` 109 · 133~136(묶음 밖 = 응답 받는 순간 차감) · 소비처 #39(자동마케팅 꾸미기) · #67(DM 다듬기) · #93(인앱 설명 · 다듬기) · #113(알림톡 매칭) · event-image-extract.ts 180 · 220(3크레딧 걷은 뒤 글 0 = 「읽지 못했습니다」 던짐) | 결과를 버릴 수 있는 생산자(파싱 · 혜택 · 효능 판정)가 묶음 밖 과금 호출을 쓴다 → 결과 0 이어도 돈이 나간다 · 바른 꼴은 이미 있다(이메일 = 호출 0크레딧 + 성공 뒤 1회 · 인앱 생성 = 확인 → 생성 → settleCreditAfterSuccess) · 기계 측정 = 묶음 밖 · 회사 값 · 단가 > 0 호출 31곳(부록 §7-1) · 사례로 확정한 것 6 · 나머지는 시험이 자리마다 「묶음 안 · 0크레딧 · 결과 버림 0 증명」 중 하나를 강제 |
| Z7 | R10 | 공용 유틸의 한국어 일반 `throw new Error`(측정 110 · 부록 §7-2) | 사용자 조건(입력 · 상태)과 내부 장애가 같은 Error 종류라 라우트마다 500 · 4xx 를 따로 짐작한다 · 이번에 사례로 확정한 것 = #78 · #109 · #114 · 처방 = 종류 있는 오류(사용자 조건 = 상태 · 코드 · 문장) + 기계 시험(유틸 한국어 일반 Error = 줄마다 면제 이유 · 낡은 면제 = 실패) |
| Z8 | R14 | utils/system-alert.ts `sendSystemAlert`(호출 29파일) | 백엔드 운영 경보 = 문자 한 길(QTmsg 인증 문자표)뿐 · 1025 R14 기준(서로 독립인 두 길 · 문자 + 메일)과 갈림 · 경보 대상 다수가 MySQL · 발송 장애라(예: 직접발송 preparing 잔존 「발송은 차단된 상태」) 바로 그 장애 때 경보가 안 닿는다 · Z1 의 `[CREDIT][MISS]` · `[CREDIT][ORPHAN]` 도 사람에게 닿으려면 이 입구를 지나야 한다 |
| Z3 | R1(시험 빈칸) | 화면 constants/credit.ts `CONFIRM_CREDIT_COSTS` · `AI_GENERATE_COSTS` · 서버 CREDIT_COST_MAP | 화면 단가표 두 벌이 서버 단가를 손으로 베낌 · 대조 시험(credit-label-parity)은 이름만 본다(금액 0) · 지금 금액은 같음(측정 25개 차이 0) · 서버 단가를 바꾸는 날 화면 금액이 거짓이 된다 |
| Z5 | R11 · R1 | routes event-campaigns.ts 61 · 168 · billing.ts 1502 · 1680 · campaign-agency.ts 152 (전수 측정은 공용 읽기 때) | 업로드 오류 번역이 라우트마다 따로(LIMIT_FILE_SIZE 를 고치는 곳 · 원문을 그대로 내는 곳) · 공용 번역 함수 0 |
| Z6 | R1 · R4 | utils/ai-credit.ts `settleCreditAfterSuccess`(잔액 부족 = 402 · 원장 실패 = 결과 줌) · `deductCreditOutcome` · `deductCreditSafe`(잔액 부족 · 원장 실패 = failed · 결과 줌 · 만들기 v0 · v1 · 카탈로그) · one-line-ct/order.ts · index.ts 판단(잔액 부족 = 402 · 원장 실패 = 결과 안 줌) | 「성공 뒤 차감」 규칙이 세 벌 · 같은 상황(확인 뒤 잔액 소진 · 원장 쓰기 실패)에 기능마다 402 · 무과금 결과 · 결과 회수가 갈림 · 소비처 전수 측정은 Z4 측정 때 함께 |

Z1 소비처 추가 = line-draft-memo.ts `deleteLineDraftWithRetry` `[CREDIT][ORPHAN]`(미과금 초안 회수 실패도 stdout 만).

## §5 진행표

| 단계 | 상태 |
|---|---|
| 범위 뽑기(import 그래프) | 됨 |
| 기계 측정 1차 | 됨 |
| 기계 후보 분류(R12 · R17 · R15 끝 · R6 · R8 · R10 · R11 = 기능 읽기 때 그 파일분을 함께 가름) | 진행 중 |
| 사람 읽기 · 자동마케팅 | 됨(§4-A · 28건) |
| 사람 읽기 · 플래너 | 됨(§4-B · 17건 · #24 의 적재 행 삭제는 결함에서 뺌) |
| 사람 읽기 · 모바일 DM | 됨(§4-C · 20건 · 렌더 · 정의 파일은 표적 확인) |
| 사람 읽기 · 이메일 | 됨(§4-D · 9건 · 렌더러는 1024 범위) |
| 사람 읽기 · 인앱 | 됨(§4-E · 4건 · 메시지 엔진 내부는 1024 범위) |
| 사람 읽기 · SNS | 됨(§4-F · 3건 · 어댑터 · 미디어는 09월 설계 범위) |
| 사람 읽기 · 만들기 · 템플릿 | 됨(§4-G · 12건 · line-* 일부는 표적 · 확인 대기 1 = 서버 env) |
| 사람 읽기 · AI 한줄로 | 됨(§4-H · 4건) |
| 사람 읽기 · 이미지 스튜디오 | 됨(§4-I · 4건 · 템플릿 정의 자료는 표적 제외) |
| 사람 읽기 · 한 줄 CT | 됨(§4-J · 새 결함 0 · Z6 넓힘) |
| 사람 읽기 · 여정 남은 칸 · 허브 | 됨(§4-K · 1건 · 허브 죽은 주소는 #1 · #13 재확인) |
| 공용 199파일 | 기계 후보 분류 됨(R12 4 · R8 6 · R6 27 · R11 19 · R10 110 · Z4 31) · 사람 읽기는 후보 줄 + 돈 · 경보 입구 표적 · 줄마다 읽기 아님 |
| 결함 목록 | 됨(116건 · 공용 Z1~Z8 · 부록 §7) |
| 처방 설계안 | 됨(§8 · 결함 116건 전부 처방에 매김(기계 대조) · 결정 1 = D1 = A · Harold님 동의 1025) |
| 구현 · 시험 · 변이 · Codex · build:safe | 됨 1026(§9 · backend vitest 689파일 10,108건 · tsc 0 · 0 · Codex 적대 5R approve · build:safe 백엔드 · 화면 성공) |
| 배포 | 대기(C61 과 한 번에 · §9-5 · 서버 확인은 「배포 시작하자」 때) |

## §7 부록 · 측정 목록 (처방 때 시험이 자리마다 판정을 강제한다)

### §7-1 Z4 · 묶음 밖 · 회사 값 · 단가 > 0 인 `callAIWithFallback` 31곳(scratchpad z4.js · 줄 = 호출 줄)

| 자리 | 단가 키 · 값 | 판정 |
|---|---|---|
| routes/ai-memory.ts 203 · 693 | ai-memory-search 1 · brand-voice-extract 1 | 미판정 |
| routes/ai-usage.ts 347 | ai-usage-search 1 | 미판정 |
| services/ai.ts 2135 | recommend-target 5 | AI 한줄로 = 묶음 · routes/ai.ts 485 · ai-orchestrator 433 · 824 · crm-agency-proposal 120 = 미판정 |
| services/ai.ts 2531 · 2786 | parse-briefing 1 · generate-custom-messages 5 | 미판정 |
| services/ai.ts 3050 | recommend-next-campaign 5 | 죽은 주소 #13 과 함께 지움 |
| utils/ai-column-mapper.ts 267 | ai-column-mapper 1 | 미판정(대행 접수) |
| utils/ai-segment-generator.ts 251 | ai-segment-generator 1 | 미판정 |
| utils/alimtalk-ai-matcher.ts 265 | alimtalk-matcher 1 | #113 확정(여정 화면 갈래) · AI 한줄로 = 묶음 |
| utils/dm/dm-alert-copy.ts 82 | 숫자 3(Z2) | 미판정 |
| utils/dm/dm-event-recommender.ts 170 | dm-event-recommender 5 | 죽은 주소 #77 과 함께 지움 |
| utils/dm/dm-quick-action.ts 139 | dm-quick-action-refine 1 | #67 확정 |
| utils/dm/dm-self-diagnosis.ts 280 | dm-self-diagnosis 1 | 미판정 |
| utils/event-image-extract.ts 180 · 220 | 숫자 3(Z2) | 확정(글 0 = 걷은 뒤 던짐) · 자동제작 v1 = 묶음 |
| utils/inapp-explainer.ts 281 · inapp-quick-action.ts 112 | 1 · 1 | #93 확정 |
| utils/journey-ai-generator.ts 667 · 930 · 1030 · 1170 | journey-ai-generate 3 · journey-ai-refine 1 | 미판정 |
| utils/journey-builder.ts 604 | journey-builder-custom 3 | 미판정 |
| utils/journey-step-diagnosis.ts 365 | journey-step-diagnosis 1 | 미판정 |
| utils/multi-goal-decisioning.ts 104 | multi-goal-decisioning 5 | 미판정 |
| utils/next-action-advisor.ts 300 | next-action-advisor 5 | 죽은 주소 #1 과 함께 지움 |
| utils/operator-message-decorator.ts 69 · 129 | ai-operator-decorate 3 | AI 한줄로 = 묶음 · routes/ai.ts 4491 = #39 확정 |
| utils/performance-explainer.ts 113 | performance-explainer 5 | 풀분석 = 묶음 · routes/ai.ts 1777 = 미판정 |
| utils/performance-quick-action.ts 113 | performance-quick-action 5 | 미판정 |
| utils/variant-generator.ts 128 | variant-generator 5 | 미판정 |

「미판정」 = 결과를 버리는 갈래가 있는지 사람 확인 전. 처방 시험이 자리마다 셋 중 하나를 요구한다(묶음 안 + 성공 뒤 정산 · 0크레딧 · 결과를 버리는 갈래 0 증명). 그래서 미판정이 남은 채 통과할 수 없다.

### §7-2 Z7 · 공용 유틸의 한국어 일반 Error 110곳(줄 번호)

- services/ai-orchestrator.ts 484 · 518 · 1096 · 1105
- utils/ai-credit-tx.ts 459 · 465 · 473 · 483
- utils/ai-json.ts 87
- utils/assets.ts 193
- utils/audience-translate.ts 359
- utils/bandit-optimizer.ts 585
- utils/billing-settings.ts 64 · 67 · 135 · 288
- utils/brand-message.ts 413
- utils/cafe24-client.ts 118 · 133 · 155 · 171 · 448
- utils/campaign-quick.ts 292 · 297 · 398 · 400(297 · 400 = #109 확정)
- utils/cdp-events.ts 151 · 182
- utils/cdp-identity.ts 132 · 387
- utils/cdp-member-token.ts 40
- utils/cdp-orders.ts 96 · 99 · 119 · 324
- utils/company-smtp-client.ts 90 · 96 · 106 · 109 · 157 · 159 · 164 · 169 · 228 · 257 · 261 · 289 · 291 · 295 · 342 · 346
- utils/direct-send-core.ts 324 · 356 · 380
- utils/event-brief.ts 389
- utils/event-image-extract.ts 177 · 199 · 217 · 234
- utils/liquid-templating.ts 224 · 231 · 301 · 317 · 335 · 357 · 366 · 372 · 426 · 442(문장 = #119 의 원문)
- utils/mall-consent.ts 224 · 291
- utils/naver-commerce-client.ts 118 · 345 · 518 · 522 · 528
- utils/prepaid.ts 615
- utils/provider-oauth-url.ts 20
- utils/provider-registry.ts 191 · 194 · 197 · 203(문장에 「Phase 2 지원 예정」 = 로드맵 노출 겹침)
- utils/sales-outreach-catalog.ts 214
- utils/sales-outreach-jobs.ts 1672 · 1689 · 1894 · 2026 · 2032
- utils/sales-outreach-produce.ts 1231 · 1508 · 1509 · 1512 · 1592 · 1679 · 1688 · 1704 · 1764 · 1996 · 2608 · 3251 · 3253 · 3350 · 3517
- utils/sales-outreach-purge.ts 56
- utils/short-url.ts 65 · 68 · 100
- utils/sms-queue.ts 185
- utils/spam-test-queue.ts 504 · 830

공용 그 밖 후보 판정:
- R12 4 = 오탐 3(callback-filter LIMIT 0 = 칸 확인 · geo-access LIMIT 2 = 같은 이름 두 개 확인 ×2)과 #12(죽은 주소 #16과 함께 지움).
- R8 6 = 주기 작업마다 종료 조건 · 시간 상한이 있다(스팸 검사 폴러 · 멈춘 active 정리 · 직접발송 감시 10분 창). 새 결함 0.
- R6 27 = 발송 · 정산 · 연동 상태다. 비종결 상태(preparing · active)는 닫는 자리가 있다(직접발송 = 사람 판정 경보 · 스팸 검사 = 멈춘 active 자동 정리). 새 결함 0. 다만 그 경보가 Z8 한 길이다.
- R11 19 = 고객 화면이 아닌 문장이다. AI 도구 결과 · SDK 개발자 API 응답 · 운영자 503 · 운영 경보 · 로그로 쓰인다. 고객 화면으로 새는 것은 #119(Liquid 원문) 하나다.

## §8 처방 설계안 (Harold 동의 전 · 코드 0)

### §8-0 원칙

- 결함은 116건이다(줄 119 중 #89 · #94 · #99 는 다른 줄과 같은 결함). 공용 뿌리는 Z1 ~ Z8 이다.
- 결함을 한 줄씩 때우지 않는다. 같은 뿌리는 한 곳(CT)에서 고치고, 그 뿌리의 시험 대상을 **전 파일**로 넓힌다. 대상은 소스에서 기계로 뽑고, 손 목록은 0이다.
- 시험마다 변이 확인을 한다. 고친 자리 하나를 파일 복사로 옛 꼴로 되돌려, 시험이 빨개지는지 본다.
- 한 배포로 낸다. DDL 은 0으로 예상한다. 생기면 information_schema 확인을 먼저 받는다.
- 덮음표(§3) 빈칸 118칸은 모두 「시험」이 되어야 끝난다. 그 전에는 「결함 0」이라고 쓰지 않는다.

### §8-1 묶음별 처방 (결함 → 한 답)

**A. 돈 · AI 결과 정산 (Z4 · Z6)**

공용 처방은 셋이다.
- `utils/ai-credit.ts` 에 AI 결과 정산 CT 하나를 둔다.
  - 순서: 원장 먼저 → 잔액 → 묶음 안 AI → 호출부의 「쓸 결과인가」 판정 → 성공 뒤 차감.
  - 결과 0 · 전부 거절이면 0원이다.
- 고객 생산자는 이 CT 만 쓴다. `callAIWithFallback` 의 응답 순간 차감은 내부 도구에만 남긴다.
- 「성공 뒤 차감」 규칙은 한 벌로 줄인다(§8-2 결정 D1).

| # | 처방 |
|---|---|
| 39 | 자동마케팅 꾸미기 = CT · 바뀐 안이 있을 때만 차감 · 거절된 안은 화면에 「원문 그대로」 표시 |
| 67 | DM 카피 다듬기 = CT · 바뀐 블록만 차감 · 버튼에 「최대 N크레딧(바뀐 블록만)」 |
| 87 | 이메일 글 다듬기 = 블록 다듬기와 같은 규칙(바뀐 때만) |
| 92 | 인앱 새로 게시(POST)도 차감 실패 = 게시 되돌림(PUT 과 같은 함수) |
| 93 | 인앱 영향 요인 분석 · 다듬기 = CT · 읽힘 + 남은 안 1개 이상일 때만 |
| 102 | 판독 캐시는 견적이 판독을 넣었을 때(글 0)만 쓴다 · 글이 있으면 미정산 캐시를 무시(차감 0 · 재료에도 안 섞음) |
| 113 | 알림톡 매칭(여정 화면 갈래) = CT · 고를 템플릿이 나올 때만(AI 한줄로 갈래와 같은 판정) |
| Z4 사진 판독 | event-image-extract = CT · 글이 나올 때만 |
| Z4 나머지 | 부록 §7-1 「미판정」 자리마다 시험이 셋 중 하나를 강제(묶음 안 + 성공 뒤 정산 · 0크레딧 · 버림 갈래 0 증명) |

**B. 화면 금액 = 서버 금액 (Z2 · Z3)**

공용 처방은 둘이다.
- 단가는 `CREDIT_COST_MAP` 한 곳에만 둔다. 서버 코드에 숫자로 박지 않는다(`creditCost: 3` · `checkCredit(x, 2)` · `cost = 2`).
- 화면 금액은 단가표(constants/credit) 또는 서버 견적에서만 읽는다. 화면 단가표 금액은 서버 금액과 값까지 대조하는 시험을 둔다.

| # | 처방 |
|---|---|
| 27 | 예산 알림 「이번 발송 금액」 = 같은 함수가 방금 고친 실측 값 |
| 41 | 충돌 분석 버튼 · 창에 금액(단가표) |
| 65 | 발행비 판정 한 함수(보내기 길의 면제 규칙 포함)를 /publish 도 씀 · 목록 [발행 주소 복사]도 금액 확인(expected_fee) |
| 66 | DM 알림 문자 종류 = 바이트로 정함(90바이트 이하 SMS · 공용 문자 종류 판정) → 「저단가」 문장 = 실제 적재 · 정산 |
| 76 | 편집기 [발행] = 서버 견적 + expected_fee(보내기 창과 같은 규칙) |
| 91 · 105 · 116 | 문장 · 버튼의 「N크레딧」 = 단가표에서 읽음(이메일 50 · 1 · 판독 3 · 스튜디오 2 · 1) · 서버 스튜디오 = getCreditCost |
| 103 | 만들기 결과 화면 [다른 채널] · [다시 만들기] = 누르기 전에 서버 견적을 받아 그 합계를 버튼 · 확인 창에 표시 · 다시 만들기는 그 금액으로 확인 |
| Z2 | dm-alert-copy · event-image-extract 의 `creditCost: 3` → 단가표 키(dm-alert-copy 키 신설 · 값 3) |
| Z3 | 화면 단가표 두 벌의 금액 = 서버 금액 시험(지금은 이름만 봄) |

**C. 사람에게 닿기 (R14 · Z1 · Z8)**

공용 처방은 셋이다.
- `sendSystemAlert` 는 공용 경보 입구(`scripts/ops-alert.sh` · 문자 + 메일 두 길)를 부른다.
  - 명령 인자에 비밀값을 싣지 않는다. 본문은 환경 · 표준입력으로 넘긴다.
  - 쿨다운(PG)은 그대로 둔다.
- 차감 실패 기록(`[CREDIT][MISS]` · `[CREDIT][ORPHAN]`)은 공용 함수 하나로 남긴다. 로그와 경보(dedup)를 함께 한다.
- 담당자 통지는 「보냄 · 안내함」 기록을 적재 성공 뒤에만 쓴다. 화면 문장은 통지 결과를 그대로 말한다.

| # | 처방 |
|---|---|
| 21 | 문안 생성 실패 회차 = 판정 불가와 같은 함수(통지 + 회차 기록) |
| 22 · 49 | 안내 · 마감 문자 = 적재 결과를 보고 기록(실패면 기록 안 함 · 다음 회차 재시도) |
| 23 | 중지 · 보관 때 제안 닫기 실패 = 재시도 + 경보(리마인드 취소와 같은 꼴) |
| 24 | 정산 미확정 · 되돌림 실패 = 경보 + 7일 창 밖도 되돌림 대상으로 남김(표식) |
| 50 | 행사 취소 뒤 DM 멈춤 실패 = 재시도 + 경보 |
| 52 | 환불 금액 = 원 차감 원장 행에서 읽음 · 환불 못 하면 담당자 문자 = 실제 결과 문장 |
| 60 | 「담당자에게 알림이 갔어요」 = 통지 결과(보냄 · 번호 없음 · 실패) 그대로 |
| 71 | 추첨 실패 = 횟수 상한 + 담당자 통지 + 경보 |
| 84 | 전원 실패 메일 = failed 상태 + 담당자 통지 |
| 85 | 예약 메일 실패 = 담당자 통지 |
| 96 | 예약 SNS 게시 실패 = 담당자 통지 |

**D. 묶음 · 재시도 · 닫기 (R12 · R8 · R6)**

공용 규칙은 둘이다.
- 묶음 SELECT 의 LIMIT 에는 ORDER BY 가 있어야 한다. 거름은 SQL WHERE 에 두고, 처리 · 영구 실패 모두 표식을 남긴다.
- 목록 상한에 걸리면 응답에 잘림(총수 · `truncated`)을 싣고, 화면은 「앞 N개」 · [더 보기]로 말한다.

| # | 처방 |
|---|---|
| 2 · 3 · 5 · 8 · 9 | ORDER BY + 거름 SQL(늦음 판정 · 수신 0 종결 표식 · 성과순 · 최신순 + 잘림 표시) |
| 4 | 대행 메일 중복 판정 = 받는 사람 지문을 SQL 조건으로 |
| 6 · 10 · 11 | 처리 · 실패 표식을 SQL 거름에 넣음 + ORDER BY |
| 7 | 금지 패턴 증류 실패 · 표본 부족 = 다음 시도 시각 기록 + 횟수 상한 |
| 12 | #16(죽은 주소)과 함께 지움 |
| 20 | 검토 제안 · 리마인드도 7일 만료(승인 대기와 같은 판정) |
| 25 | 예산 · 백업 담당자 = UPDATE 안에서 읽음(선조회 되쓰기 금지 · MMS 칸과 같은 꼴) |
| 26 | 회사 문맥 없음 = 다음 시각 밀기 + 통지 |
| 47 | 플래너 보내기 전 실패 = 시도 횟수 상한(3) → 실패 종결 + 통지 |
| 54 | 결과 문자 못 보낸 달 = 사유 종결 표식 + ORDER BY |
| 80 · 86 | 목록 상한 = 잘림 표시 · 이메일 목록 = [더 보기] · 평균 지표 = 서버가 전체로 집계 |
| 97 | SNS 토큰 없는 행 = 「확인 불가」 종결 표식(줄 앞자리 차지 0) |
| 100 | 임시 보관 띠에 [치우기](보관 종료 주소 연결) + 잘림 표시 |
| 112 | 알림톡 매칭 = 승인 템플릿 전부를 후보로(길이 상한을 넘으면 최신순 + 「앞 N개만 봤어요」 응답) |

**E. 화면 · 문장의 사실 = 서버 사실 (R1 · R5)**

공용 규칙은 하나다. 서버가 가진 값(발송 시각 8~21시 · 승인 마감 · 확인 요청일 · 글자 상한 · 야간)은 설정 응답에 싣는다. 화면은 숫자를 박지 않는다(#40 · #62).

| # | 처방 |
|---|---|
| 28 | 멈춤 링크 화면의 「나갈 문안」 = 보낼 안 · 혜택 치환 뒤(발송 CT 조립) · 학습 기록도 같은 안 |
| 29 | 화면 스팸 검사 글 = 발송 CT 조립 함수 그대로(따로 만드는 함수 삭제) |
| 30 · 31 | 성과 문자 · 밴딧 전환 = 실수신자 귀속 CT(automarketing-roi) |
| 32 | ROI 표시 = 매출 ÷ 비용(OperatorResultCard 와 같은 함수) |
| 33 | 「추천」 표지 = 만들 때 저장한 추천 |
| 34 | 승인률 = 지금 승인 상태 집합(공용 상태 표)으로 셈 |
| 35 | 오늘의 추천 = daily-brief 와 같은 「오늘 · 어제」 함수 |
| 36 | SegmentPicker 「매 회차 다시 해석」 선택지 삭제 |
| 37 | 「가장 효과 좋은 변형」 = 제안마다 비교(서로 다른 글 합산 0) |
| 38 | 승인 확인 창 = 서버 야간 규칙 문장(야간이면 「오전 9시에 나가요」) |
| 40 · 62 | 공용 규칙대로 서버 값으로 바꾼다. 플래너 발송일 계산도 서버 한 곳으로 옮긴다 |
| 45 | 승인 기간 요약 SQL 한 함수 |
| 51 | 월 대행 취소 = 행사 취소 함수를 부름(DM 멈춤 포함) |
| 56 | 확인 본문 = 생략 뺀 발송만(메일과 같은 규칙) · [승인하기] 잠금 = 서버 승인 판정과 같은 집합 |
| 57 | 확인 창 문구 = 승인 풀기 가능 여부(서버 값)로 분기 |
| 58 | 받는 사람 문구 = `recipientsText` 공용 |
| 59 | 함께 나갈 DM = 공용 DM 미리보기 부품 |
| 61 | 질문표 필수 여부 = 서버 판정과 같은 함수에서 받음 |
| 64 | A/B 집계 = 기록 모양(섹션별 clicks 합) · 순방문 = 토큰 · 세션 · 완독 = 완독 CT |
| 68 | 빠른 수정 = PUT 과 같은 저장 함수(발행 중 관문 · 저장 판 확인) |
| 69 | 한 DM 추첨 블록 1개 = 편집기 개수 제한 + 서버 저장 · 발행 검사(`isMaxCountExceeded` 배선) · 지금 데이터 모델(DM 당 추첨 1행)과 맞춤 · DDL 0 |
| 70 | 당첨자 조회가 response_id 를 꺼냄 |
| 72 | 테스트 링크(p=test)에서만 샘플 값(s)을 읽어 샘플 고객으로 그림 |
| 73 | 이름 = 「평균 응답률」(값 = 응답 ÷ 열람) |
| 74 | 문장 = 「발송 뒤 7일 안 주문」 |
| 75 | 「추천 시간」 = 열람 시간대 실측(hourDistribution) · 표본 부족이면 「추천」 표지 없이 기본 시각 |
| 82 | 단문 요청 = 단문 지시(시스템 · 사용자 지시 한 벌) |
| 83 | 재발송 = 새로 나갈 수를 먼저 세어 확인 창 · 응답에 「이미 받은 N명 제외」 |
| 88 | 테스트 메일 = 발송과 같은 조립(광고 표기 · 수신거부 꼬리) |
| 104 | 편집기 재료 패널 = v1 재료(만들기 화면과 한 길) · v0 함수 · 견적 삭제 |
| 111 | 문자 제목 대체 = 「[회사명] 소식」 꼴(내부 캠페인 이름 · 영어 0) |
| 117 | 한 줄 헤드라인 그림 = 소재 등재(라이브러리 · 용량 셈) |

**F. 죽은 주소 · 빠진 화면 (R15)**

| # | 처방 |
|---|---|
| 1 · 13 · 14 · 16 · 17 · 77 · 98 · 101 · 108 · 115 | 지운다. 그 주소만 쓰는 함수 · 단가 키 · R2 시험 목록 줄도 함께 지운다. 단가 키는 지난 차감 이력 이름표가 쓰면 이름표만 남긴다 |
| 63 | 지우지 않고 화면을 만든다. DM 상세 응답 탭에 「당첨자」 칸(명단 표 · 엑셀 받기 · 사전 지정 올리기)을 두고, 서버 주소 셋을 그대로 쓴다(DDL 0). 응답 목록에 [더 보기]를 달고, 블록 종류는 한국어 이름으로 보인다 |
| 15 | 배포 때 켜진 옛 자동발송 행 수를 확인한 뒤 그 결과로 한 답을 낸다. 0이면 주소 · 워커 · 화면을 지운다(지금은 서버를 못 써 미검증) |

**G. 고객 문장 · 오류 종류 (R11 · R10 · Z5 · Z7)**

공용 처방은 셋이다.
- 사용자 조건 오류 종류 하나(상태 · 코드 · 사람 문장)를 `utils/http-error.ts` 에 둔다. 라우트 catch 의 공용 응답 함수가 그 상태로 돌려준다.
- 업로드 오류 번역 공용 함수를 둔다(크기 · 개수 · 형식). multer 원문은 쓰지 않는다.
- 다른 모듈의 오류 원문을 고객 문장에 붙이지 않는다.

| # | 처방 |
|---|---|
| 42 · 79 · 90 · 95 · 107 | 문장 고침(칸 이름 · 설정 이름 · 영어 → 사람 말) |
| 78 · 109 · 114 | 사용자 조건 오류 종류(409 · 400 · 503 · 시험폰 0대 = 「지금은 검사할 수 없어요」 칩) |
| 101 | 로드맵 문장 삭제 |
| 106 · 118 · Z5 | 업로드 오류 공용 함수 |
| 110 | 인앱 요약 = 템플릿 · 카드 모양 한국어 이름표 |
| 119 | Liquid 오류 = 원문 빼고 「N번째 칸의 개인화 문법이 맞지 않아요. 미리보기에서 확인해 주세요」 |
| Z7 | 공용 유틸 110줄을 자리마다 가른다(사용자 조건 = 오류 종류 · 내부 = 면제 이유) · 시험이 강제 |

**H. 날짜 (R16)**

| # | 처방 |
|---|---|
| 43 | date 칸 `::text` · 죽은 대안 삭제 |
| 44 | 매월 날짜 칸이 빈 행 = 원래 일자 기준 말일 보정 |
| 81 | 렌더러 날짜 · 시각 = Asia/Seoul 지정 · D-day = KST 날짜 글자로 셈 |

**I. 요금제 · 범위 (R2 · R3)**

| # | 처방 |
|---|---|
| 53 | 회사 전체 수치 결과 문자 = 회사 관리자 연락처(공용 연락처 CT) |
| 55 | 휴대폰 링크 [보내기] = PC 와 같은 요금제 판정(회사 id 로) |

**J. 스팸 판정 (R7)**

| # | 처방 |
|---|---|
| 18 · 19 · 46 · 48 | `spamVerdictOf` 판정 셋 · 장애 = 통과도 차단도 아님(다음 주기 재검사 · 상한) |

### §8-2 결정 한 가지 (D1 · 성공 뒤 차감 한 규칙)

지금은 같은 상황(잔액 확인 뒤 다른 기능이 잔액을 먼저 씀 · 원장 쓰기 실패)에 기능마다 답이 셋으로 갈린다(Z6).

| 안 | 잔액 부족 | 원장 쓰기 실패 | 장점 | 비용 |
|---|---|---|---|---|
| A | 402 · 결과 안 줌 | 결과 안 줌(만든 행 회수) + 경보 | 미과금 결과 0 · 이미 한 줄 주문 · 판단이 쓰는 규칙 · 재정산 장치 신설 0 | 원장 DB 가 잠깐 끊긴 순간 고객이 다시 눌러야 함 |
| B | 402 · 결과 안 줌 | 결과 줌 + 경보 + 같은 키 재정산 워커 | 고객 흐름이 안 끊김 | 재정산 워커 신설(이중 진실 = 6원칙 ③ 안전망 동반) · 못 걷은 돈이 생길 수 있음 |

추천 = A. 돈이 안 빠진 결과를 내주지 않는 쪽이 유료 서비스의 기본이다. 이미 가장 최근에 만든 길(1023 한 줄 주문)이 이 규칙이라, 옮기는 양도 가장 적다.

### §8-3 기계 시험 (덮음표 빈칸 → 시험 · 전 파일 · 대상은 소스에서 뽑음)

| 뿌리 | 시험(대상 뽑기) | 변이 확인(되돌리면 빨개져야 함) |
|---|---|---|
| R1 | ① 서버 단가 숫자 박기 0(`creditCost: 숫자` · `checkCredit(…, 숫자)` · 차감 호출의 숫자 cost) ② 화면 단가표 금액 = 서버 금액 ③ 화면 `.tsx` 문장의 「N크레딧」 숫자 0(단가표 · 견적 변수만) ④ 화면의 발송 시각 · 마감 숫자 0(설정 응답 값만) | 스튜디오 `cost = 2` 되돌림 · 단가표 한 값 바꿈 · 「50크레딧」 문장 되돌림 |
| R2 | 전 라우터(공개 링크 포함) · 돈 · 발송 · AI 함수를 유틸까지 따라가 뽑은 주소 = 요금제 문 · 손 표(PLAN_SCREEN_ROUTERS) 삭제 | #55 문 빼기 |
| R3 | 회사 전체 수치를 사람에게 보내는 함수 = 관리자 연락처 CT(보내는 함수 전수) | #53 되돌림 |
| R4 | 전 파일 `callAIWithFallback` 중 회사 값 · 단가 > 0 · 묶음 밖 = 0(면제 = 줄마다 이유 · 낡은 면제 = 실패) · `deductCreditOutcome` · `deductCreditSafe` 직접 호출 = 허용 목록(발송 · 정산 · 등록)만 | #39 · 판독 하나씩 묶음 밖으로 |
| R5 | 자리마다 단위 시험(보이는 값 = 나가는 값 · 같은 함수) + 점검표 | #28 · #29 · #88 되돌림 |
| R6 | 전 파일 비종결 상태 쓰기 → 닫는 자리 표(상태 칸 · 값을 소스에서 뽑음) | #20 만료 빼기 |
| R7 | 전 파일 함수 단위 · 스팸 결과를 읽는 함수 = `spamVerdictOf` | #46 `.then(r => !!r)` 되돌림 |
| R8 | 전 파일 주기 작업(setInterval · 워커 등록) · 실패 갈래가 횟수 · 다음 시각을 올림 | #47 · #71 되돌림 |
| R10 | utils · services 의 한국어 일반 Error = 0(면제 = 줄마다 이유) · 라우트 catch = 공용 응답 | #109 되돌림 |
| R11 | 라우트가 돌려주는 고객 문장에 영문 칸 이름 0 · multer 원문 0 · 다른 모듈 오류 원문 붙이기 0 · 화면 요약의 내부 키 출력 0 | #119 · #106 되돌림 |
| R12 | 전 파일 SELECT … LIMIT n(n > 1) = ORDER BY 있음(면제 이유) · 목록 응답 상한 = 잘림 칸 | #2 ORDER BY 빼기 · #80 잘림 칸 빼기 |
| R14 | 백엔드 경보 = `sendSystemAlert` 하나 · 그것이 공용 입구(문자 + 메일)를 부름 · `[CREDIT][MISS]` 직접 로그 0 | 경보 입구 한 길로 되돌림 · 직접 로그 하나 |
| R15 | 전 라우터 · 세 화면 꾸러미 + SDK 원본 정확 대조 · 동적 조립 읽기(기준 주소 함수 · `${}` 조각 · 동작 표) · 면제 = 외부 연동 API(이유) | 지운 주소 하나 되살림 |
| R16 | 전 파일 date 칸 `::text` · 렌더러 날짜 표시 = 시간대 지정 | #81 시간대 빼기 |

### §8-4 순서 · 검증 · 배포

1. 구현 순서는 돈(A · B) → 사람에게 닿기(C) → 묶음 · 재시도(D) → 사실(E) → 죽은 주소(F) → 문장(G) → 날짜 · 요금제 · 스팸(H · I · J)이다. 묶음마다 tsc 0 · 그 묶음 시험 · 변이 확인을 한다.
2. 끝에 백엔드 · 화면 시험 전체를 돌리고, Codex 적대 리뷰를 approve 까지 돌린다(1라운드 = 변경 전체 · 2라운드부터 = 고친 줄).
3. 빌드는 `npm run build:safe` 만 쓴다.
4. 배포 때 서버에서 확인할 것이 넷 있다. 지금은 명령을 드리지 않고, 「배포 시작하자」 때 하나씩 드린다.
   - 서버 시간대(#81)
   - AI_AUTO_BUILD_COMPANY_IDS 값(§4-G)
   - 켜진 옛 자동발송 행 수(#15)
   - 매월인데 날짜 칸이 빈 옛 행 수(#44)
5. C61(여정 구조체크 2차) push · 배포는 아직 Harold님 몫이다. 이 묶음과 함께 내면 경보 입구(Z8)도 한 번에 바뀐다.

## §9 구현 기록 (1025~1026 · 설계 §8 대비 바뀐 것 · 더 찾은 것)

### §9-1 처방이 바뀐 것
- R4 · Z4 = 묶음 밖 AI 호출 12곳을 감싸는 대신 **AI 호출 함수(callAIWithFallback) 자체가 성공 뒤 차감 한 규칙**(뿌리 처방). 정산은 공급자 try 밖 한 곳(finishPaidCall) · 캐시는 정산이 끝난 결과만(Codex 1R).
- 결과를 저장 · 공개한 뒤 걷는 자리 = `settleOrUndo` 한 벌(걷고 · 못 걷으면 되돌리고 · 되돌리기 실패 = [CREDIT][ORPHAN] 경보) — 첫 발행 두 입구 · 단축 링크 · 인앱 게시 · 스튜디오 그림 3 · 풀분석 PDF · DM 다듬기(저장 판 조건). 저장 트랜잭션 안 차감 = `settleCreditInTx`(브랜드 보이스).
- 첫 발행 = DM 단위 잠금(`withDmPublishLock`) 안에서 판정 → 발행 → 정산 · 보내기는 잠금 안에서 엄격 판정을 다시 봄(실패 = 503 · 바뀜 = 409).
- 쓸 결과 판정 = 정산 직전 **최종 글** 기준(accept · 빈 항목 거름 · AI JSON 칸 = `aiStr`) · 늘 참 accept = 이유 있는 두 곳만.
- 검수 항목 = 고정 키(code)로 판정(화면 make-flow) · 원스텝 인터뷰 CT(content-interview)는 혜택 칸 규칙만 `isValidLineBenefit` 로 옮기고 삭제 · 합쳐 놓기 옵션 삭제.

### §9-2 시험을 고치다 더 찾은 결함(같은 배포에 닫음)
- 검수 문장을 사람 말로 다듬자 화면 정규식 판정이 꺼짐(「버튼 주소 없음 → [넣기]」 · 「꼬리 블록 없음 → 그대로 보낼 수 있어요」) → 고정 키 · R11 짝 계약.
- R15 시험 구멍(앞부분 후보가 DM `/:id/…` 전부를 「부름」으로 셈) → 좁힘 · 드러난 죽은 주소 `POST /api/dm/:id/render-sample` 삭제.
- R10 시험 구멍(「값 || 한국어」 일반 Error) → 자동마케팅 대상 쓸 수 없음 2곳 = 409 사유 문장.
- 공용 오류 응답 넣기 스크립트가 catch 안 if(DB 마이그레이션 등)에 넣은 40곳 → catch 바닥으로 · SDK 주소 7곳 = 오류 종류면 그 상태로 기록 · 응답 · 계약 = 깊이 검사.
- 서버 문장 글자 판정 3곳(예측 근거 '회사 격리' · SMTP 키 · 사업자번호) → 오류 종류 · 저장 세그먼트 '최대' 죽은 갈래 삭제 · 대상 축 문장의 내부 키 노출 삭제.
- 플래너 고친 글 검사 장애 = 상한 · 사유 · 멈춤 표시 · 리비전 조건 · 못 보내는 글자 = 저장 400 · 자동마케팅 전환 귀속 = 수신자 못 읽음은 다음 회차 · DM 시각 = 오프셋 없는 글 = 한국 시각 · 이메일 편집기 → 만들기 화면 = 이탈 보호.

### §9-3 Codex 적대
1R 네 묶음(돈 8 · 워커 3 · 오류 문장 3 · 삭제 1 = 15 · 불수용 1 = DB 마이그레이션 문장은 규칙 db_alter_safety_net) → 2R 5 → 3R 4 → 4R 1 → 5R approve. 같은 부류 두 번 = 빈 AI 결과 과금(2R · 3R) — 2R 처방이 글자 꼴만 막고 판정 자리를 안 봄 → 정산 직전 판정 = 최종 결과(뿌리 대장 점검표 R4 쓸 결과).

### §9-4 추가 과제(축 밖 · 기록만)
- 축 밖 라우터의 오류 문장 글자 판정 4곳: routes/admin.ts 크레딧 조정(이미 처리 · 부족 · 찾을 수 없) · campaigns.ts 예약 취소 · manage-scheduled.ts · test-contacts.ts(`result.error === '…'`).
- AI 공용 호출 대체 경로의 PDF 400(AI_PDF_FALLBACK)이 catch 에서 503 AI_DELAYED 로 바뀜(옛 동작 · 실패는 그대로).
- DM 뷰어 카운트다운 `data-end` 를 브라우저 시간대로 읽음(한국 밖 보는 사람만 · R16).
- 여정 활성화 확인 창 보라 그라데이션 4곳(C61 시간대 파일 · 디자인 훅).
- 앞서 적은 것 = AI Operator 상표 문자열 · '[URL: 회사 admin 수정]' 표식 · 축 밖 R10 · R11 · R15 · #72 · #62 · #24 · #80 메모 · 결과 창 원화 대체 · 알림톡 1,000자 · A/B 창 상한.

### §9-5 배포(C61 과 한 번에 · 명령은 「배포 시작하자」 때 하나씩)
- DDL 0 · 서버 확인 = 시간대(#81) · AI_AUTO_BUILD_COMPANY_IDS · 켜진 옛 자동발송 행 수(#15 결정) · 매월인데 날짜 빈 옛 행(#44) · 새 ORDER BY 칸 존재(information_schema · kakao_templates.last_synced_at · sales_outreach 칸 등) · 운영 경보 두 길 확인.
- 실측 1건 = 크레딧제 시험 회사에서 DM 첫 발행(발행비 1행 · 원장 = 결과) · AI 다듬기 1회(바뀐 블록 수 × 단가 1행) · 이메일 편집기에서 만들기 화면 이동(고친 내용 저장 뒤 이동).
