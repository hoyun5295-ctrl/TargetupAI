# 1순위 효과 증명 넓히기 — 흐름 표(1단계)

> 순위 · 할 일 = `status/ROADMAP.md` §1 · 형식 = `status/DEFECT-PLAYBOOK.md` §1 「1 흐름 표」.
> 뽑은 날 = 2026-11-06 · 기준 = 로컬 `main`(c7b4ff35 이후 미커밋 문서만 다름).
> 운영 표본 = 0(1106 Harold 실측 · 4개 회사 여정 46개 전부 `holdout_pct = 0` · 대조군 실행 0건 · 유료 고객사 여정 미사용). → 아래 「정상」은 소스 판정이다. 운영에서 끝까지 돈 적은 없다.
> **이 표가 빈칸 0 + Harold 확인을 받기 전에는 설계 · 코드 0.**

## 0. 칸을 뽑은 명령(손 목록 금지)

| 무엇 | 명령(packages/ 에서) |
|---|---|
| 대조군 값이 지나가는 모든 자리 | `grep -rn -i "holdout" --include=*.ts --include=*.tsx backend/src frontend/src`(시험 · dist 제외 · 25 파일) |
| 실행 행을 만드는 모든 자리 | `grep -rn "INSERT INTO journey_executions" backend/src`(5곳) |
| 실행 상태를 바꾸는 모든 자리 | `grep -rn "UPDATE journey_executions" backend/src` |
| 효과 숫자를 내는 모든 산식 | `grep -rln "campaign-response-attribution\|campaignRecipientOrders\|purchasedSinceEntrySql" backend/src` |
| 광고 발송 입구(대조군을 넓힐 자리) | `grep -rn "createDirectSendCampaign(\|getFatigueBlockedSet(" backend/src` |

## 1. 흐름(여정 대조군 · 지금 있는 것)

| # | 단계 | 쓰는 쪽 | 읽는 쪽 | 판정 |
|---|---|---|---|---|
| 1 | 비율 넣기 | 화면 `frontend/src/components/journey/workspace/JourneyStartCard.tsx:296`(0 ~ 30 자름) → `routes/ai.ts:4098` `holdout_pct` | 검증 `utils/journey-options-validator.ts:100` `clampInt(0, 0, 30)` · 편집 잠금 목록 `journey-step-edit-policy.ts:85` · 폼 복원 `frontend/src/utils/journey-start-form.ts:51` | 정상 |
| 2 | 비율 읽기 | — | `utils/journey-entry-ledger.ts:207` `getJourneyHoldoutPct`(NaN · 0 이하 = 0 · 30 위 = 30 · 오류 = 0) | 정상 · 오류 때 0 = 대조군 없이 전원 발송(덜 재는 쪽 · 기록 없음) |
| 3 | 진입 · 배정(트리거 1건) | `journey-trigger-watcher.ts:88 ~ 97` · 호출 `:595` `:646` | — | 같은 여정에 대조군 행이 있으면 다시 대조군(고정) · 아니면 `random() * 100 < pct` |
| 4 | 진입 · 배정(트리거 묶음) | `journey-trigger-watcher.ts:855` `:885` `:898 ~ 904` | — | 3과 같은 규칙 |
| 5 | 진입 · 배정(날짜 기준 · 한 번 보내기) | `journey-anchor-scheduler.ts:281 ~ 304` · `:408 ~ 424` | — | 3과 같은 규칙 |
| 6 | 재진입 | `journey-reentry-worker.ts:191`(언제나 `'active'`) | 후보 = `:146` `completed` · `goal_met` 만 | 대조군 행은 끝나지 않아(아래 9) 재진입 후보가 안 됨 → 대조군 고객이 재진입으로 발송군이 되지 않음 · 정상 |
| 7 | 발송 제외 | — | 실행기 `journey-executor.ts:276` `:315` `status = 'active'` 만 · 밀림 경보 `:362` · 운영자 수신자 `operator-recipients.ts:72` | 정상(대조군은 어느 발송 조회에도 안 잡힘) |
| 8 | 다른 상태로 바뀌나 | `UPDATE journey_executions` 전 자리 | 멈춤 `journey-pause-handler.ts:339`(실행 id 지정 · 발송 실패 경로만) · 되살림 `journey-resume.ts:28`(`paused` 만) · 교체 `journey-entry-replace.ts:18`(`active` 만) | 대조군을 건드리는 자리 0 · 정상 |
| 9 | 대조군의 끝 | — | — | **끝나는 자리 없음** · `holdout` 은 영원히 `holdout`(완료 시각 없음) |
| 10 | 전환 판정 | — | `journey-goal-purchase.ts:21` `purchasedSinceEntrySql` = 진입 뒤 구매(프로필 최근 구매일 · 몰 · 매장 원장 · 가입 묶음) | 기간 끝 없음(진입 뒤 지금까지) |
| 11 | 비교 숫자 | — | `journey-stats.ts:645 ~ 676`(대조군 1명 이상일 때만) · 발송군 = `status <> 'holdout'` 전부 | 아래 결함 후보 A · B · C |
| 12 | 다른 숫자에서 빼기 | — | 완주율 분모 `journey-stats.ts:204` · 지도 코호트 `journey-lifecycle-map.ts:682` `:708` `:886` `:905` `:915` | 정상(대조군이 희석하지 않음) |
| 13 | 화면 | — | 비교 카드 `frontend/src/pages/JourneyStatsPage.tsx:184 ~ 211` · 목록 뱃지 `JourneysPage.tsx:1749`(`journey-builder.ts:2274`) · 고객 이력 `customer-timeline.ts:700` · 목록 거르기 `journey-list-filter.ts:9` | 아래 결함 후보 D |

## 2. 판정 자리 두 축(값 범위 · 그리는 화면)

| 판정 자리 | 값 범위 | 그리는 화면 · 문구 |
|---|---|---|
| 비율(1 · 2) | 빈 값 · 음수 · 소수 · 31 이상 · 문자 → 0 ~ 30 정수 | 시작 카드 「들어온 고객의 N%는 보내지 않고 비교해요」 |
| 배정(3 ~ 5) | 비율 0 = 대조군 0 · 표본 적음 = 0명일 수 있음 · 같은 고객 재진입 = 대조군 고정 | 뱃지 「홀드아웃 N」 |
| 전환(10) | 구매 없음 · 미래 최근 구매일(안 산 것으로) · 환불 · 몰 · 매장 같은 구매 = 한 번 | 비교 카드 각주 「전환 판정 = 진입 이후 구매(이벤트·프로필)」 |
| 비교(11) | 대조군 0명 = 카드 없음 · 발송군 0명 = 0% | 「발송군 전환율 · 대조군 전환율 · 증분 효과 %p」 · 단위 「명」 |

## 3. 결함 후보(판정 · 근거 · 고객이 겪는 일) — 설계 범위 확인용 · 처방 0

| 후보 | 근거 | 고객이 겪는 일 |
|---|---|---|
| A 발송군에 안 받은 고객이 섞임 | `journey-stats.ts:651` `status <> 'holdout'` = 실패 · 멈춤 · 끝남 · 진행 중(아직 안 받음)까지 발송군 | 증분이 실제보다 작게 보임 |
| B 사람이 아니라 실행 행을 셈 | 같은 고객 재진입 = 행 여럿(대조군 고정이라 대조군도 여럿) · 화면 단위 「명」 | 「명」 숫자가 실제 고객 수보다 큼 |
| C 기간 끝 없음 · 양쪽 기간 다름 | 10 · 9 — 대조군은 끝나지 않고, 발송군은 진입 시각이 제각각 | 오래된 진입일수록 전환이 쌓여 비교가 기울 수 있음(미검증) |
| D 같은 값 이름 셋 | 시작 카드 「대조군」 · 뱃지 · 비교 카드 「홀드아웃」 · 고객 이력 「비교군」 | 같은 고객 묶음을 세 이름으로 봄 |
| E 비율 오류 = 기록 없이 0 | `journey-entry-ledger.ts:213` catch → 0 | 대조군이 조용히 꺼짐(꺼짐도 로그 원칙) |
| F 돈 · 믿을 만한가 없음 | 비교 = 전환율만 · 금액 · 유의성 계산 0 | 로드맵 §1 만들 것 3 · 4 그대로 |

## 4. 효과 숫자 산식(지금 세 벌)

| 산식 | 자리 | 단위 · 기간 · 금액 | 쓰는 화면 · 문서 |
|---|---|---|---|
| ① 여정 대조군 비교 | `journey-stats.ts:645` + `purchasedSinceEntrySql` | 실행 행 · 진입 뒤 지금까지 · 금액 없음 | 여정 통계 |
| ② 자동 마케팅 ROI | `automarketing-roi.ts:40` `campaignRecipientOrders` · `:97` `buildAutoMarketingRoi` | 실수신자 번호 · 발송 뒤 7일 · 결제 확정 · 환불 제외 · 같은 주문 한 번 · 금액 있음 · **대조군 없음** | `PerformancePage.tsx:407 · 838 · 859` · `ContinuousOperatorPage.tsx:129 · 726` · 담당자 성과 문자 `operator-conversion-attribution.ts` · 하루 요약 `operator-daily-recap.ts` · 밴딧 |
| ③ CT-69 반응 창 | `campaign-response-attribution.ts:50` `buildCampaignAttribution` | **회사 전체** 24시간 · 7일 · 30일 창(캠페인별 아님 · 받은 사람 구분 없음) · CDP 없으면 최근 구매일 고객 수 | 성과 리포트 `routes/ai.ts:1722` · 풀분석 `full-analysis-runner.ts:59` · `operator-performance-estimator.ts:412`(90일) · PDF `performance-pdf-render.ts:199 ~ 209` 「캠페인 발송 후 기여 · 발송 후 7d: CDP 구매 N건 / 매출 ₩」 |
| ④ 블렌디드 ROAS | `performance-roas-core.ts` · 매출 = `next-action-advisor.ts:166` · `:417`(기간 회사 매출) | 기간 회사 전체 매출 ÷ 발송 비용 · 받은 사람 구분 없음 | 성과 리포트 머리 ROAS 카드 · PDF `performance-pdf-render.ts:99 ~ 129` 「추정 매출 · ROAS」 · `:157 ~ 161` 「최고 효율 채널」 |
| ⑤ 수신 고객 기준 기여 | `performance-customer-axis.ts:207`(여정 · DM 의 `customer_id` 정확 매칭 · 수신 뒤 창 시간) | 고객 · 몰 사건만(`cdp_events` · **매장 원장 없음**) · 결제 확정 | PDF `performance-pdf-render.ts:212 ~` 「수신 고객 기준 기여(여정·DM 정확 매칭)」 · 성과 리포트 |

→ 로드맵 §1 「한 산식(두 벌 금지)」의 실제 대상 = **다섯 벌**. 같은 PDF 한 장에 ③ 「발송 후 기여 매출」 · ④ 「추정 매출」 · ⑤ 「수신 고객 기준 기여」가 서로 다른 매출 숫자로 함께 나간다. 설계 때 ② 를 바탕으로 한 벌로 모을지 정한다(제안 · 미확정).
→ 대행 운영 월간 리포트 · 컨설팅 성과 지표를 만드는 코드 = **0**(`grep -iE "월간|monthly" utils/agency-*.ts utils/crm-agency-*.ts` 0 · 성과 리포트 · PDF 가 유일한 리포트 출력). 컨설팅 성과 지표는 지금 사람이 위 숫자를 옮겨 적는 자리다.

## 5. 넓힐 자리(광고 발송 입구 · 대조군이 지금 없는 곳)

| 갈래 | 입구 | 피로도 판정(2순위와 같은 자리) |
|---|---|---|
| AI 한줄로 캠페인 | `routes/campaigns.ts:997` | 있음 |
| 직접 발송(조건 대상) | `routes/campaigns.ts:2445` → `:2113` `createDirectSendCampaign` | 있음(라우트에서) |
| 자동 마케팅(자동 캠페인) | `auto-campaign-worker.ts:818` | 있음 |
| 연속 운영자(자동 마케팅 제안 발송) | `continuous-operator.ts:3665` 게이트 → `operator-recipients.ts:70` 대상 SQL 안 `buildFatigueGuardClause` → `:3881` `createDirectSendCampaign` | 있음(대상 추출 SQL 안) |
| 마케팅 플래너 | `planner-executor.ts:505` `createDirectSendCampaign` | **없음**(grep `fatigue` 0) · 기록만 `direct-send-processor.ts:357` |
| 대행 발송 | `agency-send-worker.ts:1304` `createDirectSendCampaign` | **없음**(grep 0) · 기록만 |
| DM 발송 | `routes/dm.ts:1520` `createDirectSendCampaign` | **없음**(grep 0) · 기록만 |
| 여정 | `journey-executor.ts:778` | 있음 |

→ 공용 입구 `direct-send-core.ts:240` `createDirectSendCampaign` 안에 판정이 없다. 대조군 · 우선순위를 「효과가 생기는 함수 안 한 곳」에 둔다면 후보 자리. 플래너 · 대행 · DM 에 피로도 판정이 없는 것은 2순위 범위의 사실로 적어 둔다(처방 0).

## 6. 광고 · 정보성 판정 자리(대조군 = 광고만 · 로드맵 §1 「설계 때 지킬 것」)

판정 값 = 발송마다 `campaigns.is_ad` 한 칸(`journey-step-campaign.ts:196` · `auto-campaign-worker.ts:927` 등 INSERT). 갈래마다 정하는 자리:

| 갈래 | 정하는 자리 | 정보성이 될 수 있나 |
|---|---|---|
| 여정 | `journey-executor.ts:776` `resolveJourneyAdFlag(channel, is_ad)`(`journey-ad-policy.ts:15` · 저장값 무시 · 알림톡 = 정보성 · 그 밖 = 광고) | 알림톡 칸만 |
| 자동 캠페인 | `auto-campaign-worker.ts:815` `ac.is_ad` | 있음(설정값) |
| 직접 발송 | `routes/campaigns.ts:2436` `adEnabled`(요청값) | 있음 |
| DM 발송 | `routes/dm.ts:1530` `isAd`(요청값) | 있음 |
| 대행 발송 | `agency-send-worker.ts:1318` `row.is_ad` | 있음 |
| 마케팅 플래너 | `planner-executor.ts:514` `adEnabled: true` 고정 | 없음(언제나 광고) |
| 연속 운영자 | `continuous-operator.ts:1531` `isAd = true` 고정 | 없음(언제나 광고) |

→ 대조군을 광고에만 걸면 판정 입력 = `is_ad` 하나로 충분하다(새 축 0). 여정은 채널로 정해져 같은 여정 안에 광고 칸 · 정보성 칸이 섞일 수 있다 → 여정 대조군은 지금 **실행 단위**(정보성 칸도 안 나감). 이 차이는 설계에서 정한다(미확정).

## 7. 빈칸

0(1106 채움). Harold 「이번 범위 흐름이 빠짐없다」 확인 대기.
