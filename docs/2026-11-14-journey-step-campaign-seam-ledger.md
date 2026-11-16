# 여정 단계 캠페인 행의 이음매 전수 표 (B-1114-1 · 흐름 표 1판)

> 결함 플레이북 1단계 산출물(`status/DEFECT-PLAYBOOK.md` §1). Harold 「네, 뽑아」(1114). 이 표가 확인되기 전에는 설계 · 처방 · 코드 0.
> 기준 판 = 서버 배포본 38c3671f(1114 19:30 배포 · 로컬 사본에서 읽음). 접수 = `status/BUGS.md` B-1114-1.
> 범위 = 여정이 만드는 **단계 캠페인 행**(`campaigns` 표의 `send_type = 'journey'`)의 일생. 여정 안쪽 흐름(진입 · 재진입 · 실행)은 C126 · C129 흐름 표가 소유.

## 0 왜 이 표인가

여정은 (여정, 칸, KST 날짜)마다 단계 캠페인 하나를 만들어 그날 내내 이어 쓴다(`utils/journey-step-campaign.ts:150-195` · 다시 쓸 때 보는 것 = 봉인 · 원장 꼴 · 규약뿐 · **상태는 보지 않는다**). 발송이 붙을 때마다 「보냈다」 확정 문장이 그 행의 대상 수 · 발송 수를 올린다(`utils/journey-send-claim.ts:113-148 confirmLoadUnit`).
그 행은 모든 발송 기능이 같이 쓰는 `campaigns` 표에 있다. 지난 여정 설계서 여섯(C126 · C129 · 1102 묶음 발송 · 1101 구조체크 · 흐름 원장 · 1023)은 여정 파일 안의 이음매만 뽑았고, **여정 밖 코드가 이 행을 고치는 자리**는 표에 없었다(여섯 문서에서 자동 완료 정리 · 트리거 언급 0).

## 1 뽑은 방법(기계 추출 · 손 목록 아님)

| 무엇 | 스크립트 · 패턴 | 결과 |
|---|---|---|
| `campaigns` 를 쓰는 문장 | 스크래치패드 `seam_extract.js` · `/\b(UPDATE\|INSERT\s+INTO\|DELETE\s+FROM)\s+campaigns\b(?![_\w])/i` · 운영 코드 876파일(시험 제외) | 88문장 · 16파일 |
| `campaigns` 의 상태 · 굳힘 값으로 판정하는 읽기 | `seam_extract_reads.js` · 백틱 한 덩이 안에 `FROM\|JOIN campaigns` 와 `status` · `result_final` 조건 | 50문장 · 28파일(발송 종류 조건 없는 것 39) |
| `campaigns` 의 트리거 | 로컬 실 PG 시험 그릇(운영 덤프 1027 + 원장 DDL) `pg_trigger` | 2개 |
| 캠페인 목록 주소를 부르는 화면 | 프론트 `grep /api/campaigns` · `admin/campaigns` | 사용자 4파일 · 관리자 3파일 |

추출의 한계(빈칸 §6 에 적음): 읽기 추출은 한 백틱 덩이 안의 조건만 본다(변수로 이어 붙이는 WHERE 는 손으로 읽음).

## 2 쓰는 쪽 — 88문장을 「여정 단계 캠페인 행에 닿는가」로 가른 표

### 2-1 닿는다 · 여정 밖 코드 (판정 대상)

| # | 자리 | 하는 일 | 대상 선정 | 여정 행을 가리나 | 판정 |
|---|---|---|---|---|---|
| W1 | `routes/campaigns.ts:269-275` · 사용자 캠페인 목록 `GET /api/campaigns` | 상태 `sending → completed` | 목록 한 쪽에 든 캠페인 중 결과 대기 0 + (성공 · 실패 > 0) | 안 가림 | **결함(B-1114-1)** · 열린 날의 단계 캠페인을 완료로 바꾼다 |
| W2 | `routes/admin.ts:3545-3550` · 관리자 캠페인 목록 | 같음 | 같음 | 안 가림 | **결함(같은 뿌리)** |
| W3 | `utils/campaign-sync-worker.ts:143-177 markFinalizedCampaigns` | `result_final = true`(발송결과 화면이 PG 캐시만 읽게) | 상태 completed · failed + 발송 6시간 뒤 + 성공 + 실패가 다 참 | 안 가림 | W1 · W2 가 먼저 돌아야 닿는다 · 열린 날에 굳을 수 있음(종속) |
| W4 | `utils/campaign-sync-worker.ts:209-323 reconcileFinalizedCampaigns` | 상태 `failed → completed` 복원 · 발송 수 `GREATEST(지금 값, 큐 행 수)` · 성공 · 실패 · 굳힘 | failed(10분 뒤) · completed + 굳음(24시간 뒤 · 성공 + 실패 < 발송) · completed · failed + 안 굳음(72시간 뒤) | 안 가림 | **결함 후보 2**(§5) · 큐 행 수에는 알림톡 대체 행이 든다 |
| W5 | `utils/mysql-refund-sweeper.ts:108 · 403` | 성공 · 실패 수 · 정산 기준 | 선불 회사 · 상태 sending · completed · failed | **가린다**(여정 원장 · 발송 수는 여정 값 그대로 `:400` · 회수 · 불변식은 닫힌 날만 `:645 isStepCampaignDayClosed`) | 정상(설계된 협업) |

### 2-2 닿는다 · 여정 자신 (11문장)

| 자리 | 하는 일 |
|---|---|
| `journey-step-campaign.ts:204` INSERT | 단계 캠페인 만들기(상태 sending · 대상 0 · 발송 0) |
| `journey-step-campaign.ts:170` | 옛 캠페인에 새 규약 표식 달기 |
| `journey-step-campaign.ts:248 · 253` DELETE | 매핑 경쟁에서 진 새 행 지우기 |
| `journey-send-claim.ts:88` | 적재 단위 기록 |
| `journey-send-claim.ts:100 · 184` | 단위 기록 지우기 |
| `journey-send-claim.ts:125` **confirmLoadUnit** | 대상 수 + n · 발송 수 + n ← **트리거에 막히는 문장** |
| `journey-send-claim.ts:196` | 증명 못 한 단위 닫기 + 봉인 |
| `utils/ad-send-gate.ts:551` · `utils/sms-queue.ts:274` | 여정 실행기가 부르는 표식 · 발송 표 기록(값 덧붙임만) |

### 2-3 닿지 않는다 (70문장 · 근거 · 합계 = 여정 밖에서 닿는 7 + 여정 자신 11 + 70 = 88)

| 묶음 | 문장 | 닿지 않는 근거 |
|---|---|---|
| 다른 발송의 INSERT | `campaigns.ts:680 · 2862 · 4528` · `auto-campaign-worker.ts:949` · `direct-send-spec.ts:94 · 103 · 106` | 새 행을 만든다(발송 종류가 다르다) |
| 같은 요청이 방금 만든 id | `campaigns.ts:3093 · 3122 · 3125 · 3239 · 3377 · 3490 · 3495 · 4623 · 4633` · `auto-campaign-worker.ts:1009 · 1230` · `brand-message.ts:2192`(부르는 곳 `campaigns.ts:4617` 하나) · `direct-send-core.ts:405 · 422 · 443 · 463` | id = 그 요청이 만든 직접 · 브랜드 · 자동 발송 캠페인 |
| 사용자가 id 를 주는 주소 | 발송 `POST /:id/send`(`:1424 · 1506 · 1513`) · 수신자 삭제(`:3832 · 3847`) · 예약 변경(`:3946 · 3980 · 4000 · 4030`) · 문안 수정(`:4103 · 4147 · 4272`) · 삭제(`:4381`) | 관문 = 발송 뒤 상태 거절(`:786`) · `status = 'scheduled'`(`:3728 · 3873 · 4055`) · `status = 'draft'` → 여정 행(sending · completed)은 통과 못 함 |
| 취소 | `campaign-lifecycle.ts:282 · 357 · 423` · `cancel-settle.ts:140 · 165 · 205` | `cancelCampaign` 관문 = scheduled · draft 만(`:250`) · 큐만 취소는 대행발송 자기 id · 관리자 취소 = scheduled 만(`admin.ts:2492`) |
| 예약 종결 | `campaign-lifecycle.ts:100` | `status = 'scheduled'` |
| 결과 동기화 | `campaign-lifecycle.ts:635`(실행 행이 있는 AI 캠페인) · `:767`(발송 종류 = direct · operator `send-type-axis.ts:61`) | 여정 행은 실행 행이 없고 그 집합 밖 |
| 직접발송 워커 | `direct-send-worker.ts` 23문장 | 대상 = `send_phase` queued · processing · preparing · sent 또는 환불 의무 열쇠(`refundPending` · `refundPendingCancel`) · 여정 행은 `send_phase` 없음 · 그 열쇠를 여정 행에 쓰는 자리 0 |
| 환불 의무 | `refund-pending.ts:103 · 161` | 부르는 곳 = 자동 · 브랜드 · 직접 · 스위퍼(적재 0 고착 = 여정 제외 `refund-calc.ts:102`) |

## 3 트리거

| 이름 | 언제 | 하는 일 | 여정에 주는 뜻 |
|---|---|---|---|
| `campaigns_protect_completed_target_count` | `BEFORE UPDATE OF target_count` | 옛 상태가 completed 이고 대상 수가 바뀌면 예외 | 완료된 단계 캠페인에는 확정 문장이 통째로 되돌아간다 |
| `tr_campaigns_updated` | `BEFORE UPDATE` | `updated_at = NOW()` | 없음 |

`status/SCHEMA.md` 의 이 트리거 설명 「정상 코드 흐름은 모두 `status='scheduled'` 가드라 영향 0」(5월)은 여정의 확정 문장이 생긴 뒤로 맞지 않는다.

## 4 읽는 쪽 — 여정 단계 캠페인의 상태에 기대는 판정

| 묶음 | 자리 | 여정 행을 어떻게 읽나 | 뜻 |
|---|---|---|---|
| 후불 청구 | `send-usage-aggregation.ts:677-684` | 발송 종류 = journey · **상태 조건 없음** | 상태와 무관(정상) |
| 선불 정산 | `mysql-refund-sweeper.ts:222-246` | 상태 sending · completed · failed 전부 | 상태와 무관(정상) |
| 발송결과 화면 | `routes/results.ts:99-146 · 326-357 · 480-493` | `result_final` 이면 PG 값 · 아니면 큐 실측 | W3 가 굳힌 뒤에는 PG 값만 |
| 캠페인 목록 표시 | `routes/campaigns.ts:245-266` · `routes/admin.ts`(같은 꼴) | 결과가 다 오면 응답에서 「완료」로 보임 | 표시 + W1 · W2 의 방아쇠 |
| 성과 · 분석 | `performance-benchmark.ts:41`(업종 평균) · `performance-customer-axis.ts:104` · `performance-data-availability.ts:52` · `campaign-response-attribution.ts:56 · 112 · 131` · `next-action-advisor.ts:136 · 152 · 339` · `grade-conversion-stats.ts:53` · `ai-self-diagnosis.ts:75` · `continuous-operator.ts:3009` · `routes/help.ts:51` | `status = 'completed'`(발송 종류 조건 없음) | 여정 발송은 **누가 목록을 열어 완료가 된 뒤에만** 이 숫자들에 든다 |

여정 단계 캠페인을 완료로 바꾸는 자리는 W1 · W2 뿐이다(여정 자신의 9문장에 상태를 바꾸는 것 0). 그래서 지금 여정 발송이 성과 숫자에 드는 시점 = 누군가 캠페인 목록을 연 때다.

## 5 값 범위 · 화면 두 축

### 5-1 판정 자리 = 「그날의 단계 캠페인을 다시 쓴다」(`journey-step-campaign.ts:162-167`) 에 들어오는 행의 값

| 값 | 그 값이 되는 길 | 지금 동작 | 판정 |
|---|---|---|---|
| 상태 sending | 만든 그대로 | 이어 씀 | 정상 |
| 상태 completed | W1 · W2(대시보드 · 캘린더 · 관리자 목록을 열 때) | 이어 씀 → 확정 문장이 트리거에 막힘 → 그 실행 오류 12번 뒤 실패 · 남은 표식 정리 5분마다 실패 · 그날 그 칸의 뒤 실행도 같은 자리에서 막힘(묶음 가드가 남은 단위부터 판정) | **결함(B-1114-1)** |
| 상태 failed | 여정 행에 닿는 문장 0(§2-3) | 도달 불가 | 근거 = §2-3 |
| 상태 cancelled | 취소 관문이 막음 | 도달 불가 | 근거 = §2-3 |
| 굳음(`result_final`) | completed 뒤 6시간(W3) | 발송결과 화면이 PG 값만 읽음 | 완료가 선행될 때만 |
| 봉인 · 원장 꼴 다름 · 옛 규약 | 여정 자신 | 이어 붙임(순번 + 1 새 캠페인) | 정상(C96 · C129) |
| 날짜 경계(자정) | 새 날짜 = 새 캠페인 | 전날 캠페인에는 붙지 않음 | 정상 |

### 5-2 누가 방아쇠를 당기나(값 범위 「누가」)

| 누가 | 화면 | 주소 |
|---|---|---|
| 그 회사의 모든 로그인 사용자 | 대시보드(`pages/Dashboard.tsx`) · 캘린더(`pages/CalendarPage.tsx` · `components/CalendarModal.tsx`) · 자동화 띠(`components/dashboard/LiveAutomationStrip.tsx`) | `GET /api/campaigns` → W1 |
| 슈퍼관리자 | 관리자 대시보드(`pages/AdminDashboard.tsx`) 캠페인 목록 | 관리자 목록 → W2 |

요금제 · 역할 조건은 없다. 선불 · 후불 무관. 조건 = 그 칸이 하루에 두 번 이상 나가고(사건형 시작 · 고객마다 다른 시각) 그 사이에 결과가 다 온 뒤 누가 목록을 연다.

### 5-3 화면 축(빈칸 있음)

| 화면 · 글 | 지금 | 상태 |
|---|---|---|
| 시스템 알림 메일 「여정 실행이 12번 연속 처리 오류로 실패 처리됐습니다(더 보내지 않음)」 | 운영자에게만 | 확인(1114 16:06 메일) |
| 캠페인 목록 · 발송결과의 여정 단계 캠페인 줄 | 결과가 오면 「완료」 | 코드 확인 |
| 여정 화면에서 실패한 실행이 고객사 담당자에게 어떻게 보이나 | — | **빈칸** |

## 6 결함 장부 초안 · 빈칸

| # | 내용 | 상태 |
|---|---|---|
| D1 | 열린 날의 여정 단계 캠페인을 여정 밖 목록 조회가 완료로 바꾼다(W1 · W2) → 확정 문장이 트리거에 막힌다 | 결함 확정(운영 로그 · DB 출력 · 코드) |
| D2 | 여정 단계 캠페인을 완료로 닫는 주인이 없다 → 성과 · 분석 숫자에 드는 시점이 「누가 목록을 연 때」(§4) | 결함(같은 뿌리의 다른 얼굴) |
| D3 | 재대조(W4)가 여정 알림톡 단계 캠페인의 발송 수를 큐 행 수(대체 행 포함)로 올린다 → 선불 정산의 미적재 계산이 줄 수 있다(스위퍼가 0926 에 막은 것과 같은 꼴 `mysql-refund-sweeper.ts:397-400`) | **후보 · 미검증**(재대조 대상에 실제로 드는지 · 올라간 값을 정산이 읽는지 실 PG 로 확인 필요 · 지금 선불 회사의 여정 알림톡 칸 0 = 1112 실측) |

빈칸(이 표를 「빈칸 0」이라 부르려면 채워야 하는 것):

1. ~~운영 DB 의 `campaigns` 트리거 목록~~ — **닫힘(1114 Harold 서버 출력)**: 운영도 2개(`campaigns_protect_completed_target_count` · `tr_campaigns_updated`) = 로컬 덤프와 같음.
2. ~~여정 화면에서 실패한 실행의 표시(§5-3)~~ — **닫힘(1114 밤 · 코드)**: 여정 통계(`pages/JourneyStatsPage.tsx:183 · 255`) · 여정 상세(`pages/JourneyDetailPage.tsx:69 · 184`)의 「실패」 카드 · 필터에 건수로 보인다(사유 문구 없음). 판정 = 표시는 있음(정상) · B-1114-1 실패 자체를 없애는 것이 처방.
3. ~~D3 검증~~ — **결함 확정(1114 밤 · 코드)**: 재대조 대상 SELECT(`campaign-sync-worker.ts:210-242`)에 발송 종류 조건이 없어 여정 행이 든다(완료 + 굳음 24시간 뒤 불일치 · 완료 + 안 굳음 72시간 뒤) · 그 행의 발송 수를 큐 행 수로 올린다(`:299-313`) · 선불 정산은 여정 행의 발송 수를 적재 수로 읽는다(`mysql-refund-sweeper.ts:400` — 같은 이유로 스위퍼는 여정 행을 안 올린다고 적혀 있다). 운영 실측(실 PG 재현)은 시험으로 대신한다.
4. ~~읽기 추출이 못 잡는 꼴~~ — **닫힘(1114 밤 · 스크래치패드 `seam_blank5.js` · 변수로 조건을 붙이면서 상태 글자가 없는 덩이 35)**: 목록 넷(`campaigns.ts:180` · `admin.ts:2447 · 3489` · `results.ts:307` = 요청 필터 · 손으로 읽음) · 성과 목록(`routes/ai.ts:1618` = `status = 'completed'` · D2 와 같은 얼굴) · 통계 집계(`stats-aggregation.ts:915` = completed · sending 둘 다 → 상태와 무관) · 실행 행 기준 분석(`analysis.ts` 9 · `recipient-conversion.ts` = 여정 행은 실행 행 없음) · 직접발송 워커 8(`send_phase` 기준) · 후불 청구(`send-usage-aggregation.ts:678` 상태 조건 없음) · 여정 자신 2 · 담당자 보드(`manager-board.ts:277` = 단계 캠페인 id 로 PG 성공 · 실패 수 합 · 후불 여정 행은 72시간 재대조 전까지 0 → [범위 밖 기록] 담당자 보드의 여정 성공률이 후불 회사에서 늦게 찬다).
5. ~~같은 꼴이 `campaigns` 밖 공용 표에도 있는가~~ — **닫힘(1114 밤 · 같은 스크립트)**: 여정 소유 표를 쓰는 문장은 전부 여정 계열 파일이다 — `journey_step_logs`(실행기 6 · 표식 CT 3) · `journey_step_campaigns`(단계 캠페인 CT 2 · 결과 알림 2) · `journey_executions`(여정 파일 9곳) · `journey_step_variants`(밴딧 4 · 빌더 1 · 계보 1 · 표식 CT 1). 큐 표의 여정 행 = 적재 CT 와 에이전트만 쓴다(취소 길은 발송 전 상태 관문 · §2-3). 선불 원장 = 스위퍼의 설계된 협업(W5).

## 7 닫는 방식(1114 Harold 「네, 진행」) · 착수 시점

- 방식 = **구조로 막기 + 합성 회사 매일 자동 판정**. ① 규칙 「여정의 단계 캠페인은 여정만 닫는다」 = 여정 밖 네 곳(W1 · W2 · W3 · W4)은 닫힌 날의 것만(판정 = `isStepCampaignDayClosed` 한 곳) · 닫는 일은 여정이 직접 · `campaigns` 를 쓰는 문장을 소스에서 기계로 뽑는 계약 시험(§1 의 88문장 표가 첫 판) ② 인비토 합성 회사에 여정 세트(틀 8종 · 시작 종류 11 · 채널)를 합성 데이터 워커가 화면과 같은 서버 함수(`createJourneyFromTemplate` · `activateJourneysInOrder`)로 만들고 켠다(사람 손 0 · 직원에게 시키지 않는다) · 목록 여는 동작도 워커가 흉내 · 밤마다 불변식 자동 판정(실패 실행 0 · 안 풀린 표식 0 · 여정 오류 로그 0 · 차감 = 발송 수 · 한 번도 안 탄 시작 종류 · 채널 줄) ③ 고객사에 여정을 여는 기준 = 합성 회사에서 7일 연속 0(제안값 · 요일 한 바퀴) · 검토 · Codex 통과는 닫힘의 근거가 아니다.
- 미검증 = 인비토의 알림톡 · 브랜드 템플릿 유무 · 합성 고객에 생일 · 포인트 · 예약 값이 있는지 · 세트를 켰을 때의 발송 건수와 AI 호출 수.
- **착수 = 서버 전환(.62 → .57 IP 교체) 뒤**(1114 Harold 「오늘 서버 IP 교체작업부터 끝내고 추가 개발」). 그때 순서 = 빈칸 2 ~ 5 → 설계서 · 설계 Codex → 구현 · 구현 Codex → 배포 → 7일 측정. 그 전까지 코드 수정 0.
