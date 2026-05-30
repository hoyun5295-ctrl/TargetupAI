# 발송결과 속도 개선 — 사전집계 캐시 설계 (2026-05-30)

> 발송결과 조회가 캠페인별 MySQL GROUP BY를 매번 돌려 12초+ 소요. 완료 캠페인 결과를 PG에 캐시해 "읽기만" 하도록 전환.

---

## 1. root cause (확정 — EXPLAIN + 실측)

발송결과(`/api/v1/results/summary`, `/campaigns`)는 `aggregateSmsCountsByCampaign` → `smsBatchAggByGroup`으로 라인그룹의 **11개 SMSQ 테이블(SMSQ_SEND_1~11_YYYYMM)을 UNION ALL + GROUP BY app_etc1** 집계.

hpio(라인 7) 실측:
```
EXPLAIN SELECT app_etc1, COUNT(*) FROM SMSQ_SEND_7_202605 GROUP BY app_etc1;
→ type=index, key=idx_app_etc1_status, Using index(커버링), rows=572,981
SELECT ... GROUP BY app_etc1;  → 269 rows (12.03 sec)
```

- **단순 COUNT GROUP BY가 12초** (커버링 인덱스인데도 — 57만 행 전수 스캔).
- 실제 발송결과는 여기에 `SUM(CASE status_code...)` + 11개 테이블 UNION → 더 무거움.
- 인덱스로는 더 못 줄임(이미 Using index). **매번 전체 재집계하는 구조 자체가 한계.** 업체 늘면 선형 폭증.

## 2. 근본 솔루션

발송 완료된 캠페인의 성공/실패 수는 **불변**(통신사 처리 종료). → 한 번만 집계해 PG에 저장, 발송결과는 PG를 **읽기만**.

- 완료 캠페인 = PG 캐시 SELECT (12초 → 수십 ms)
- 진행 중 캠페인만 MySQL 실시간 집계 (소수)

## 3. DB 설계

```sql
-- 구현 직전 information_schema로 기존 컬럼 검증 (sent_count/success_count/fail_count는 이미 존재)
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS pending_count INT DEFAULT 0,         -- 통신사 처리 대기 수
  ADD COLUMN IF NOT EXISTS result_final BOOLEAN DEFAULT false,  -- 완료 캐시 확정 (이후 재집계 X)
  ADD COLUMN IF NOT EXISTS result_synced_at TIMESTAMPTZ;        -- 마지막 집계 시각
CREATE INDEX IF NOT EXISTS idx_campaigns_result_pending
  ON campaigns(company_id, result_final, sent_at) WHERE result_final = false;
```

## 4. 완료 판정 기준 (D144 교훈 반영)

- D144가 PG 캐시를 뺀 이유 = 캐시가 실제와 어긋남(sync 부재). 본 설계는 **완료 판정된 것만 신뢰**.
- `result_final = true` 조건: `pending_count = 0` (모든 SMSQ 행 통신사 응답) **AND** `발송(sent_at) 후 6시간 경과` (통신사 지연 응답 안전 마진).
- final 전까지는 진행 중 → MySQL 실시간 집계(정확성 유지).

## 5. worker 설계

> **다음 세션 1차 확인**: 기존 `campaign-sync-worker.ts`(D151, 5분 cron — 환불 sync)가 sent/success/fail을 PG에 갱신하는지 grep/read. 갱신하면 확장, 아니면 신규 `result-sync-worker.ts`.

로직 (5분 cron):
1. `result_final=false AND sent_at > now()-7d` 캠페인 SELECT (대상 한정)
2. `aggregateSmsCountsByCampaign` MySQL 집계 → campaigns `sent_count/success_count/fail_count/pending_count` UPDATE + `result_synced_at=NOW()`
3. `pending_count=0 AND sent_at < now()-6h` → `result_final=true` (이후 제외)

## 6. results.ts 분기

`/summary`, `/campaigns` 둘 다:
1. PG campaigns SELECT 시 `sent_count/success_count/fail_count/result_final` 포함
2. `result_final=true` 캠페인 → **PG 값 그대로 사용** (MySQL 집계 호출 X)
3. `result_final=false` 캠페인만 모아 `aggregateSmsCountsByCampaign`(MySQL) — 소수
4. 합산 = PG 캐시(다수) + MySQL 실시간(소수)

→ 대부분 캠페인이 final이므로 발송결과는 PG SELECT 수준(수십 ms).

## 7. 구현 task (TDD 인프라 부재 → tsc + grep + 서버 검증)

1. campaigns ALTER (information_schema 검증 SQL 먼저 → 주인님 실행)
2. worker (campaign-sync-worker 확장 or 신규) — 집계 UPDATE + result_final 판정
3. results.ts `/summary` + `/campaigns` — result_final 분기 (final=PG, 진행중=MySQL)
4. 검증: EXPLAIN + PM2 응답시간(목표 <100ms) + 발송 직후 캠페인 실시간 정확성

## 8. 예약조회 (별도 — 다음 세션 후속)

주인님 "예약조회 내역도 느림" = `manage-scheduled`(PG). 본 작업 후 별도 EXPLAIN으로 PG 쿼리/인덱스 진단.

## 부록 — 핵심 수치

- SMSQ_SEND_7_202605 = 57만 행, COUNT GROUP BY 12초
- 라인그룹 11개 테이블 UNION → 실제 더 무거움
- 목표: 발송결과 12초 → <100ms (PG 캐시 SELECT)
