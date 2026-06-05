# 2026-06-05 세션5 핸드오프 — 직원 디버깅 + 발송통계 캐시·라인그룹

## ★ 절대 원칙 (이번 세션 격분 명령)
- **여정 코드 절대 손대지 말 것** (executor·builder·step-campaign·trigger). 여정 묶음발송은 이미 고쳐졌다(주인님 명시). 모든 잔여 작업은 **조회·동기화 워커·데이터 정리**로만 우회.
- 0번 원칙: 추측 SQL 금지. 첫 SQL은 순수 덤프, 컬럼/스키마/라인그룹 단정 0. DB 컬럼은 `information_schema`로 못 박고 코드.
- "사고" 남발 금지, 자연 한국어, 존댓말, 박-단어/모델명 매 답변 grep 0건.

## 이번 세션 결과 (구현·배포 상태)
1. **알림톡 대체발송 통계 분리** — 배포 완료. 통계 엑셀(/stats/export)에서 알림톡 캠페인을 "알림톡"(K)/"알림톡대체발송"(L·k_oriseq>0) 2행 분리. `sms-result-map.ts` classifyMsgChannel/tallySmsChannelCounts(순수 TDD) + `stats-aggregation.ts` aggregateSmsChannelSplitByCampaign + admin /stats/export.
2. **발송결과 채널통합조회 엑셀 다운로드** — 배포 완료. backend CSV(프론트 ESM라 순수 TDD 불가→backend로). `campaign-list-csv.ts`(buildCampaignListCsv/channelPlainLabel, 순수 TDD) + results.ts `/campaigns/export`(필터 sendType/sender=login_id) + ResultsModal 버튼. 메시지 줄바꿈→공백 한 줄(oneLine) fix 포함.
3. **발송통계 hpio 0건 → 라인그룹 합집합** — 배포 완료. `sms-queue.ts` mergeLineTables(순수 TDD) + getCompanySmsTablesWithLogs를 user+company 라인그룹 **합집합**. (집계 전용, 발송 무영향.)
4. **발송통계 5곳 result_final 캐시 전환** — **구현 완료·미배포(Harold 배포 예정)**. querySendStats·querySendStatsDetail(stats-aggregation) + admin /stats/send·send/detail·export(else 일반만) → `getCampaignResultCounts`(result_final이면 PG 캐시, 아니면 실시간). tsc 0, grep 0.

## 핵심 실측 (확정 — 추측 아님)
- **hpio**: 발송 데이터 87,326건 전부 **회사 라인 {SMSQ_SEND_7,8,9}**(대량발송3, G7/G8/G9). 집계는 created_by의 **user 라인 {1,2,3}**(대량발송1) 우선 조회 → 0. user 개별 라인그룹이 발송(5/30) 후 부여돼 어긋남. → 라인그룹 합집합으로 fix.
- **hoyun**: 어제 6/4 여정 발송 500 campaign 전부 `status='sending'` + `result_final=false`. `syncCampaignResults`(campaign-lifecycle:238)가 `app_etc1=campaignId`로 MySQL 집계 시 성공·실패·대기 0 → status 전환 조건(433) 미충족 → sending 영영 방치 → result_final 안 됨 → 캐시 없음 → 발송결과 조회마다 500개 생집계 → 로딩 폭발. (여정 발송이 SMSQ에 app_etc1을 campaignId 아닌 값으로 남긴 미스매칭 의심 — **확정 미완**, 여정 코드 X라 sync/안전망/데이터로 우회.)
- **인덱스 OK**: MySQL `idx_app_etc1_status`(app_etc1+status_code) 존재, PG campaigns 6.7ms. 느림은 인덱스가 아니라 **result_final 캐시 미사용(매 조회 MySQL 직접) + 캠페인 多**.
- 워커: campaign-sync-worker markFinalizedCampaigns(237) = status completed/failed + sent_at NOT NULL + 6h → result_final=true. sending은 제외 → hoyun이 영영 false.

## 잔여 작업 (다음 세션)
1. **② 발송통계 캐시 배포 검증** — 배포 후 통계·예약 조회 속도, hpio 정상, 캐시 전후 수치 동일(틀어짐 0), 통계 조회 스모크.
2. **③ hoyun 500 status 정리** — 데이터 UPDATE(sending→failed). ★ 환불(prepaidRefund) 영향 먼저 실측 — 수동 UPDATE는 환불 미호출이나 정산 검토 필요. status=failed면 markFinalized 잡혀 result_final=true → 캐시 → 폭발 해소.
3. **④ status 장기 방치 안전망** — campaign-sync-worker에 "sending 장시간(예 6h+) + 결과 0 → failed 확정"(환불 검토). 향후 같은 케이스 자동 정리. **여정 코드 아님(워커).**
4. (선택) 근본 — 여정 발송 app_etc1 미스매칭 실측만(코드 X). 1방: hoyun campaign 1개 id로 SMSQ_SEND_1/2/3 app_etc1 값 확인.

## 다음 세션 진입 명령어
> CLAUDE.md 0번 원칙 + 여정 코드 X 정독 → docs/superpowers/handoffs/2026-06-05-session5-stats-cache-handoff.md 정독 → status/STATUS.md CURRENT_TASK 세션5 정독 → status/lessons/LESSONS_BACKEND.md 2026-06-05 세션5 블록 정독 → memory/project_2026_0605_session5.md 정독 → ② 캐시 배포 확인부터 받고 ③ hoyun status 정리(환불 실측 먼저) → ④ 안전망. 추측 금지·information_schema 선검증·여정 코드 0.
