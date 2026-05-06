# D144 — 발송 통계 실시간 동기화 근본 리팩터

> **작성일:** 2026-05-06
> **작성 컨텍스트:** D-Day(2026-05-05) 정식 오픈 + 5/6 운영 첫날 직원 지적으로 발송 통계 sync 문제 발견.
> **다음 세션 진행:** 이 문서를 처음부터 끝까지 정독한 후 「§ 다음 세션 시작 절차」부터 그대로 따른다. 추측·땜질·임의 행동 절대 금지 (CLAUDE.md 끌로드원칙 0번 + 7-1 절차 그대로).

---

## § 1. 배경 (D-Day 운영 첫날 무엇이 일어났나)

### 1-1. 사건 흐름 (5/5 ~ 5/6)
1. **2026-05-05 (D-Day):** 레거시 인비토메시지(비즈웹) → 한줄로AI 이관 완료. 70 캠페인 + 1454 수신자 PG/MySQL INSERT. 67개 무료체험 회사 동시 진입.
2. **2026-05-06 07:00:** 캐럿글로벌 14건 LMS 첫 발송 정상 (status_code=1000). 시스템 검증 통과.
3. **5/6 오전:** 자연인(이소이) 4,900건 LMS 발송 진행 (당일 최대 캠페인). 한국시세이도 1,274건. 캐럿 추가 캠페인 다수.
4. **5/6 11:00:** 폴라초이스 16,106건 발송 시작 (단일 최대 캠페인).
5. **5/6 오전 ~ 11시:** 직원이 슈퍼관리자 발송통계 + 비즈웹 잔액 비교 작업 → "잔액이 다 틀리고 통계도 0으로 표시된다" 보고.
6. **5/6 11시 이후:** Harold 검증 결과 — 슈퍼관리자 발송통계 화면에 폴라초이스가 아예 안 보임. 자연인 4,900건 / 성공 0 / 대기 4,900 표시. 캐럿 188건 / 성공 14만 표시 등 모든 통계 잘못.

### 1-2. 무엇이 정상이었나 (사용자 발송은 안전)
- **MySQL 큐 + QTmsg Agent 처리 = 정상.** 캐럿 14건 통신사 리포트 정상 수신, 자연인 4,728/22(success/fail), 한국시세이도 1,222/9, 폴라 발송 진행 중.
- **사용자 메시지 발송 영향 0.** 모든 거래처가 정상적으로 메시지 받음.
- **선불잔액 차감(prepaidDeduct) 정상.** 후불 회사가 다수라 차감 자체 적음 (직원 잔액 비교는 별건 — § 5-7 참조).

### 1-3. 무엇이 문제였나 (PG 통계만 어긋남)
- **PG `campaigns.sent_count` / `success_count` / `fail_count` 0 또는 부분값 그대로.** 화면 통계는 이 값을 SUM해서 표시 → 발송 결과가 화면에 0 또는 부분 표시.
- **slow query, race condition 아님.** 단순히 PG에 발송 결과가 반영 안 되어 있는 것.

---

## § 2. 근본 원인 (왜 이런 문제가 발생했나)

### 2-1. 아키텍처 설계 실수 (Claude의 책임)
한줄로AI는 다음 구조:
```
[한줄로AI 백엔드] → [MySQL 큐 INSERT] → [QTmsg Agent (별도 프로세스)]
                                              ↓
                              [통신사 발송 + 결과 status_code 자동 UPDATE]
                                              ↓
                              [LIVE 테이블 + LOG 테이블 (5월별)]

  ※ Agent → 백엔드 통보 메커니즘 없음 (webhook/콜백 X)
```

**Agent가 발송 결과를 백엔드에 직접 통보하지 않는다.** Webhook 미지원, 콜백 미지원. MySQL의 status_code만 자동 업데이트.

이 구조에서:
- **MySQL = 발송 결과의 진실의 원천 (실시간)**
- **PG = 캠페인 메타데이터 (campaign_name, scheduled_at, status, target_count, message_content 등)**

**올바른 설계:** 화면이 발송 카운트(sent/success/fail)를 표시할 때 **MySQL에서 직접 읽어야 한다.** PG에 카운트를 캐시하면 sync가 깨질 때마다 화면이 어긋남.

**Claude가 한 잘못된 설계:**
1. PG `campaigns` 테이블에 `sent_count`, `success_count`, `fail_count` 컬럼을 두고 캐시
2. `syncCampaignResults` 함수로 "MySQL 카운트 → PG UPDATE" 동기화 의존
3. `syncCampaignResults`는 **사용자 화면 fire-and-forget**으로만 호출 (Dashboard.tsx, ResultsModal.tsx)
4. → 사용자가 화면 안 열면 PG 영원히 sync 안 됨

### 2-2. 정상 패턴 사례 — billing.ts (이미 올바르게 구현됨)
[`packages/backend/src/routes/billing.ts:60-65`](../packages/backend/src/routes/billing.ts):
```sql
SELECT msg_type, DATE(sendreq_time) as send_date,
       COUNT(*) as total_count,
       SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success_count,
       SUM(CASE WHEN status_code NOT IN (${SUCCESS_CODES_SQL},${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as fail_count,
       SUM(CASE WHEN status_code IN (${PENDING_CODES_SQL}) THEN 1 ELSE 0 END) as pending_count
FROM ${MySQL_table} WHERE ...
```
→ billing은 PG `sent_count` 안 본다. MySQL에서 직접 카운트. **이게 모든 화면이 따라가야 할 정상 패턴.**

### 2-3. 메세징 SaaS의 표준 (Harold 지적 정확)
> "QTmsg가 자동으로 결과값을 가져다 주는데 니가 설계를 병신같이 했겠지"

정확한 지적. QTmsg가 MySQL에 결과를 자동 update해주는데, 백엔드는 그것을 직접 읽으면 항상 실시간. PG에 캐시하고 sync 의존하는 건 추가 단계 + 오류 지점만 늘리는 잘못된 설계.

---

## § 3. 5/6 세션에서 잘못된 임시 시도 (다시 하지 말 것)

다음 세션에서는 **이 임시 시도들을 다시 시도하지 말 것**. 모두 땜질이고 근본 해결 아니다.

### 3-1. ❌ sync-results 코드 `($1::int + $2::int)` 캐스팅 추가 (campaign-lifecycle.ts:249, 357)
- 처음 PG 타입 에러("operator is not unique unknown+unknown")로 모든 캠페인 sync 실패한 것을 수정.
- 코드는 정상이나 **근본 해결이 sync-results 자체를 폐기하는 방향이라면 이 수정도 무의미**.
- **현재 상태:** 이미 배포됨 (5/6 11:00경 tp-deploy-full + pm2 reload). 코드는 살아있음.
- **다음 세션:** 근본 해결(§ 4) 후 sync-results 폐기 시 함께 제거.

### 3-2. ❌ sync-results-worker.ts (5분 cron 폴링)
- [`packages/backend/src/utils/sync-results-worker.ts`](../packages/backend/src/utils/sync-results-worker.ts) 신설.
- [`packages/backend/src/app.ts`](../packages/backend/src/app.ts) line 41-42, line 263-266에 import + 호출 추가.
- **현재 상태:** 코드만 작성, **push/배포 안 됨.** Harold님이 운영 중 배포 거부 + 근본 해결로 방향 전환.
- **다음 세션:** 근본 해결 적용하면 워커 불필요 → **이 파일 + app.ts 변경 둘 다 삭제** (롤백).

### 3-3. ❌ PG 강제 UPDATE (자연인/캐럿 19건 + 폴라 1건)
- 5/6에 자연인/캐럿 19건은 PG UPDATE 실행 완료 (Harold가 실제 실행).
- 폴라초이스 14df97e7-cf3f-474c-89f6-a698d9036d35는 MySQL 카운트만 받았고 PG UPDATE 안 함 (Harold가 임시 SQL 실행 안 함).
- **현재 상태:** PG에 19건 임시 보정값 들어있음. 폴라/시세이도/이새/수스 등 다른 5/6 캠페인은 여전히 PG sent_count = 0 또는 부분.
- **다음 세션:** 근본 해결(MySQL 직접 카운트) 적용 후 화면이 자동으로 정상 표시되므로 **추가 PG UPDATE 불필요**. 단, 임시 보정 19건은 그대로 두어도 무관 (RPG 캐시 일치 또는 불일치는 화면이 MySQL 직접 읽기 시작하면 무관).

### 3-4. ❌ Math.floor 소수점 절삭 보정 시도
- D143 이관 시 `analyze-prepaid.js`의 Math.floor로 회사별 0.x원 절삭. 직원 잔액 비교 차이의 일부 원인.
- **그러나 직원이 본 차이는 1~30원 ~ 백단위 수준 → 이 0.x원 절삭만으로는 설명 안 됨.** 추측으로 분석하다 Harold가 분노.
- **현재 상태:** Harold가 "직원에게 적당히 처리하라고 했다" 결정 — **이 건은 종결.** 더 이상 분석 X, 코드 변경 X.
- **다음 세션:** 잔액 정합성은 § 5-7 별건. 근본 통계 리팩터와 분리.

---

## § 4. 진짜 근본 해결 방향 (다음 세션에서 진행)

### 4-1. 핵심 원칙
**PG `campaigns.sent_count` / `success_count` / `fail_count`를 화면 표시 시 SUM/SELECT하지 않는다.**
모든 발송 카운트 표시는 **MySQL에서 직접 카운트**한다.

PG는 다음 용도로만 유지:
- `target_count` (등록 시 결정, 변하지 않음) ← 그대로 유지
- `status` (scheduled/sending/completed/cancelled/draft/failed) ← 상태 머신
- 메타데이터 (campaign_name, message_content, callback_number, scheduled_at 등)
- `sent_at`, `cancelled_at` 같은 시각 컬럼

### 4-2. 옵션 비교

| 옵션 | 설명 | 결정 |
|---|---|---|
| **A. PG 캐시 + sync 짧은 폴링 (5분/1분)** | 임시 우회. 근본 X. | ❌ 채택 안 함 (땜질) |
| **B. PG 카운트 deprecate, 화면 모두 MySQL 직접** | 근본 해결. 5/6 세션에서 결정. | ✅ **채택** |
| **C. PG + MySQL 합산 표시** | 복잡, 중복 데이터. | ❌ 채택 안 함 |
| **D. QTmsg Agent webhook** | Agent 외부 솔루션 수정 필요. 가능 여부 불확실. | ⏳ 향후 검토 (B 적용 후) |

### 4-3. 결정 (Harold 컨펌 완료, 5/6 세션)
> Harold: "B로 하는게 맞는거 아니냐? 근데 끌로드원칙에 맞게 땜질 추측 이딴 개소리 하지말고 제대로 고쳐야겠지?"

→ **옵션 B 진행, 끌로드원칙 7-1 절차 그대로.**

---

## § 5. 변경 매트릭스 (정밀 라인 — grep 결과 기반)

> ⚠️ 다음 세션 진행 전 반드시 grep 다시 돌려서 라인 번호 검증 (코드 변경됐을 수 있음).

### 5-1. 🟢 변경 X (캐시 유지) — Backend WRITE 경로
| 파일 | 위치 | 동작 | 유지 이유 |
|---|---|---|---|
| `routes/campaigns.ts` | line 159-161 (자동 완료 처리) | UPDATE campaigns SET sent_count, success_count, fail_count | 발송 직후 즉시 PG에 채움 (캐시) |
| `routes/campaigns.ts` | line 1796-1801 (직접발송 직후) | UPDATE campaigns SET sent_count, fail_count, sent_at = NOW() | 동일 |
| `routes/campaigns.ts` | line 905-907, 918-920 (campaign_runs) | UPDATE campaign_runs SET sent_count | AI 캠페인 run 단위 |
| `routes/campaigns.ts` | line 414-416, 1805-1807 | INSERT campaign_runs | 신규 run 등록 |
| `utils/auto-campaign-worker.ts` | (D69 자동발송) | INSERT/UPDATE auto_campaign_runs | 자동발송 캐시 |
| `utils/campaign-lifecycle.ts` | cancelCampaign | UPDATE campaigns SET fail_count | 취소 시 |
| `migrate-legacy/scripts/migrate-reservations.js` | (D-Day 1회 실행) | INSERT campaigns | 1회성 |
| `utils/training-logger.ts` | AI 학습 메트릭 | metrics 호출 | MySQL 카운트 받아서 처리 |
| `routes/billing.ts` | line 60-101 등 | MySQL 직접 SUM | **이미 정상 패턴 — 손대지 말 것** |

### 5-2. 🔴 변경 O — Backend READ 경로 (MySQL 직접 카운트로 전환)

| # | 파일 | 라인 (5/6 기준, 변경 시 grep 재확인) | 현재 SQL | 변경 후 |
|---|---|---|---|---|
| **1** | `utils/stats-aggregation.ts` | `querySendStats` 248-291 (요약 + 그룹핑) | `SUM(c.sent_count), SUM(c.success_count), SUM(c.fail_count) FROM campaigns c WHERE c.sent_at IS NOT NULL ...` | PG에서 5/6 캠페인 ID 도출 → MySQL `smsBatchAggByGroup`로 status_code 카운트 → 응답에 합산 |
| **2** | `utils/stats-aggregation.ts` | `querySendStatsDetail` 326-378 (사용자별·캠페인별) | 동일 | 동일 패턴 |
| **3** | `routes/admin.ts` | 1199-1240 (전체 캠페인 탭 합계) | `SUM(c.sent_count)` | MySQL 카운트 |
| **4** | `routes/admin.ts` | 1347-1380 (사용자별·캠페인별) | 동일 | 동일 |
| **5** | `routes/admin.ts` | 1521-1525 (campaign_runs SUM) | `SUM(cr.sent_count) FROM campaign_runs` | MySQL 카운트 (campaign_runs 무관, MySQL이 진실) |
| **6** | `routes/admin.ts` | 1561-1564 | `c.success_count, c.fail_count` SELECT | MySQL 카운트 매핑 |
| **7** | `routes/admin.ts` | 2867-2876 (회사별 통계) | 동일 | 동일 |
| **8** | `routes/results.ts` | 97-101 (요약) | `SUM(sent_count), SUM(success_count), SUM(fail_count) FROM campaigns` | MySQL 카운트 |
| **9** | `routes/results.ts` | 233-244 (캠페인 목록) | `c.sent_count, c.success_count, c.fail_count` SELECT + 성공률 계산 | MySQL 카운트 매핑 + 성공률 재계산 |
| **10** | `routes/results.ts` | 405-407 (차트) | `success_count, fail_count` | MySQL 카운트 매핑 |
| **11** | `routes/ai.ts` | (정밀 grep 필요) | TBD | TBD — Phase 0에서 확정 |
| **12** | `routes/analysis.ts` | (정밀 grep 필요) | TBD | TBD — Phase 0에서 확정 |
| **13** | `routes/customers.ts` | (정밀 grep 필요 — 부가 가능성) | TBD | TBD — Phase 0에서 확정 |
| **14** | `routes/sync.ts`, `routes/admin-sync.ts` | (정밀 grep 필요 — 싱크에이전트 통계?) | TBD | 싱크에이전트 무관 통계면 그대로, 발송 통계면 변경 |

### 5-3. ❌ 폐기 (근본 해결 후 불필요)

| 파일 | 처리 |
|---|---|
| `utils/sync-results-worker.ts` | **삭제** (5/6 세션에서 신규 작성된 파일, push 안 됨) |
| `app.ts` line 41-42 (import) | **롤백** (sync-results-worker import 제거) |
| `app.ts` line 263-266 (호출) | **롤백** (`startSyncResultsWorker()` 제거) |
| `utils/campaign-lifecycle.ts` `syncCampaignResults` | 검토 후 결정 — 보조용으로 두거나 (PG 캐시 갱신용) 완전 폐기 |
| `routes/campaigns.ts:1240` `POST /api/campaigns/sync-results` | 동일 검토 |
| `pages/Dashboard.tsx:1138-1141` fire-and-forget 호출 | 동일 검토 |
| `components/ResultsModal.tsx:108-112` fire-and-forget 호출 | 동일 검토 |

### 5-4. 🟢 변경 X — Frontend (자동 반영)

| 파일 | 이유 |
|---|---|
| `pages/AdminDashboard.tsx` | 변경 0 (백엔드 응답 형태 유지하면 자동 반영) |
| `pages/AutoSendPage.tsx` | 동일 |
| `components/ResultsModal.tsx` | 동일 (단, sync 호출 fire-and-forget만 제거 — § 5-3) |
| `components/CalendarModal.tsx` | 동일 |
| `components/AnalysisModal.tsx` | 동일 |
| `components/StatsTab-company.tsx` | 동일 |
| `components/manage/StatsTab.tsx` | 동일 |
| `components/RecentCampaignModal.tsx` | 동일 |
| `pages/CalendarPage.tsx` | 동일 |

→ **백엔드만 수정하면 frontend는 자동 반영.** 응답 키(`sent_count`, `success_count`, `fail_count`, `total_sent`, `total_success`, `total_fail`)를 그대로 유지하면 된다.

---

## § 6. 활용할 컨트롤타워 (이미 만들어진 자산)

근본 해결에 사용할 컨트롤타워 — **D110에서 이미 최적화 완료된 helper들**. 새로 만들지 말 것.

### 6-1. `utils/sms-queue.ts` (CT-04, MySQL 큐 컨트롤타워)

| 함수 | 시그니처 | 용도 |
|---|---|---|
| `getCompanySmsTablesWithLogs(companyId, userId?)` | → `string[]` | 회사 LIVE + 5월별 LOG 테이블 목록 |
| `getCampaignSmsTables(companyId, refDate, userId?)` | → `string[]` | **캠페인 단일 조회용 (D110 신설)** — refDate 기반 발송월 LOG만 포함 (성능 최적) |
| `smsBatchAggByGroup(tables, groupField, aggFields, ids[])` | → `Map<groupValue, Record<aggField, number>>` | **다중 campaign_id 배치 집계 (D110 핵심)** — UNION ALL + GROUP BY 단일쿼리. sync-results 루프 O(N²)→O(1) 최적화. |
| `smsCountAll`, `smsAggAll`, `smsSelectAll`, `smsGroupByAll` | 다양 | UNION ALL 단일쿼리. 회사 수와 무관하게 DB 왕복 1회. |
| `kakaoBatchAggByGroup(ids[])` | → `Map<requestUid, ...>` | 카카오 메시지 배치 집계 |

### 6-2. `utils/sms-result-map.ts` (status_code 매핑)
- `SUCCESS_CODES = [6, 1000, 1800]`
- `PENDING_CODES = [100, 104]`
- 실패 코드는 `NOT IN (success ∪ pending)`

### 6-3. 이미 정상 패턴인 `routes/billing.ts`
이걸 그대로 참고하여 stats-aggregation.ts 등 변경.

---

## § 7. 잠재 위험 + 대응

### 7-1. 슈퍼관리자 전체 조회 성능
- 67사 × 22 테이블 (LIVE 11 + LOG 11) UNION = 무거울 수 있음.
- **대응:** `smsBatchAggByGroup`이 이미 UNION ALL 단일쿼리로 최적화됨. 회사 수가 백 단위 넘으면 그때 캐시(Redis 등) 검토. 현 단계에선 불필요.
- 추가 최적화 필요 시: `getCampaignSmsTables(companyId, scheduled_at)` 사용해서 발송월 LOG만 한정.

### 7-2. 카카오 알림톡/브랜드메시지 카운트
- `IMC_BM_FREE_BIZ_MSG` / `IMC_BM_BASIC_BIZ_MSG` 테이블에 별도. SMS와 합산 필요.
- **대응:** `kakaoBatchAggByGroup` helper 사용. SMS 결과 + 카카오 결과 합산 표시.

### 7-3. campaign_runs (AI 캠페인 다중 run)
- AI 캠페인은 `campaign_runs` 테이블에 run별 카운트 보관.
- **대응:** `cr.sent_count` SUM 대신 MySQL에서 `campaign_id` (= cr.campaign_id) 기준 카운트. campaign_runs 데이터는 메타로만 사용.

### 7-4. 직접발송 즉시 표시 (UX)
- 발송 직후 사용자가 화면 새로고침했을 때 MySQL Agent가 아직 처리 못 했으면 카운트 0.
- **대응:** PG에 캐시값(target_count, 또는 발송 직후 INSERT한 sent_count)을 fallback으로 표시 + MySQL 카운트가 더 큰 경우 그것 우선. 또는 "발송 중" UI로 명확히 표시.

### 7-5. 폐기 검토 — fire-and-forget 호출
- `Dashboard.tsx:1138-1141`, `ResultsModal.tsx:108-112`의 `POST /api/campaigns/sync-results` fire-and-forget.
- 근본 해결 후 불필요. 그러나 **폐기 시 backend 라우트 + frontend 호출 둘 다 동시 제거** 필요. 한쪽만 제거하면 404 발생.

---

## § 8. 작업 Phase (5/6 세션에서 결정 완료)

### Phase 0 — 정밀 grep + 매트릭스 100% 완성 (코드 변경 0)
- ai.ts / analysis.ts / customers.ts / sync.ts / admin-sync.ts 정밀 grep
- 매트릭스 § 5-2 #11~#14 항목 확정
- Harold 컨펌

### Phase 1 — `stats-aggregation.ts` querySendStats 리팩터
- 가장 영향 큰 슈퍼관리자 발송통계 + 고객사 발송통계 동시 정상화
- 응답 키 그대로 유지 → frontend 변경 0
- 영향 검증: 슈퍼관리자 화면 + 고객사 화면 둘 다 정상 표시 확인

### Phase 2 — `routes/admin.ts` 5곳 적용
- 전체 캠페인 탭, 사용자별, 회사별 통계
- Phase 1과 동일 패턴

### Phase 3 — `routes/results.ts` 적용
- 발송결과 모달 합계 + 캠페인 목록 + 차트

### Phase 4 — `routes/ai.ts`, `analysis.ts` 등 (Phase 0 결과 따라)

### Phase 5 — 정리 + 폐기
- `sync-results-worker.ts` 삭제 + app.ts 롤백
- `syncCampaignResults` + fire-and-forget 호출 폐기 (검토 후)
- frontend `Dashboard.tsx`, `ResultsModal.tsx` fire-and-forget 호출 제거

---

## § 9. 다음 세션 시작 절차

### 9-1. 필수 정독 (이 순서)
1. **이 문서 (D144-STATS-REALTIME-REFACTOR.md) 끝까지** ← 지금 보고 있는 것
2. `CLAUDE.md` (특히 § 0 끌로드원칙, § 4 운영 원칙, § 7-1 컨트롤타워 수정 시 필수 프로세스)
3. `status/STATUS.md` (D144 § 잔여 별건 + 본 리팩터 위치)
4. `memory/project_d144_view_and_stats_fix.md` (5/6 D144 종합 마감 — SMSQ_SEND VIEW 정체 + 통계 음수 + 무료체험 BULK 부여)
5. 본 매트릭스 § 5의 backend 파일들 직접 read (코드가 변경됐을 수 있음 — 라인 번호 grep 재확인)

### 9-2. 시작 전 검증 (절대 위반 금지)
- [ ] **현재 PG `campaigns` 카운트 컬럼 사용 라인 grep 다시 실행** → § 5-2 매트릭스 라인 번호 검증
- [ ] **billing.ts 정상 패턴 직접 read** ([packages/backend/src/routes/billing.ts](../packages/backend/src/routes/billing.ts)) — 60-101 등
- [ ] **`smsBatchAggByGroup` helper 시그니처 직접 read** ([packages/backend/src/utils/sms-queue.ts](../packages/backend/src/utils/sms-queue.ts) 367 부근)
- [ ] **§ 3에 적힌 임시 시도들이 코드/배포 상태에 그대로 남아있는지 확인** (sync-results-worker.ts 파일 존재? app.ts import 살아있음? syncCampaignResults `($1::int + $2::int)` 그대로?)

### 9-3. Harold 컨펌 받기 (CLAUDE.md § 4-1)
다음을 정리하여 Harold에게 보고:
1. 본 문서의 § 4-3 결정 — 옵션 B (PG 카운트 deprecate, MySQL 직접) — 컨펌 재확인
2. § 5 매트릭스 — Phase 0 grep 결과 + 라인 번호 최종 확인
3. § 8 Phase 1부터 시작 — 시작 OK?
4. 운영 영향 — 각 Phase 배포 시 운영 끊김 (1~3초 PM2 reload), 발송 자체 영향 0

### 9-4. 코드 수정 시 절대 원칙 (CLAUDE.md 7-1)
- [ ] **수정 전 grep 전수 리스트업** → Harold 보고
- [ ] **컨트롤타워 우선** — 인라인 SQL 작성 금지. `smsBatchAggByGroup`, `getCampaignSmsTables` 등 helper 사용.
- [ ] **수정 후 grep 재확인** — 잔존 패턴 0건 확인
- [ ] **표시 경로 전수 확인** — 슈퍼관리자, 고객사, 캘린더, AI 결과 등 모든 화면에서 정상 표시 검증
- [ ] **TypeScript 빌드 0 error** ≠ 완료. 실데이터로 화면 검증까지

### 9-5. 절대 금지
- 추측으로 답하기 (CLAUDE.md § 0)
- 컨펌 없이 코드 작성 (§ 4-1)
- 운영 중 무단 배포 (Harold가 명시한 안전 시점만)
- 끌로드원칙 7-1 단계 건너뛰기
- "TS 빌드 통과 = 완료"로 보고

---

## § 10. 참고 — 5/6 운영 데이터 (다음 세션 검증용)

### 10-1. 5/6 발송 회사 + 캠페인 목록 (PG에서 도출됨)
| 회사 | company_id | 캠페인 수 | 비고 |
|---|---|---|---|
| 폴라초이스코리아 | `d67bb301-0fb3-459e-a42f-f58fb5d6f0bb` | 14df97e7 외 | 16,106명 11:00 발송 |
| 자연인 (이소이) | `697c7905-3165-47cf-a140-4f1cd369242a` | 73d1133e 외 | 4,900명 LMS |
| (주)한국시세이도 | `3e7ec67b-f093-4b41-91c0-1eb284d8bfef` | 1건 | 1,274명 sending |
| 캐럿글로벌 | `e8f0ffa7-2e59-4e2c-ad9f-b762c1d81f98` | 16건 | 5/6 07:00 14건 + 추가 |
| 라프레리 | `df63bcb0-3900-4a1c-8ad0-93c6b5a1db04` | 다수 | D-Day 이관 70건 + 신규 |
| 이새에프앤씨 | (PG에서 확인) | 1건 | 5,300명 18:30 예약 |
| 수스_대행 | (PG에서 확인) | 1건 | 513명 11:40 예약 |
| 베네통, 아난티, 태영_엘렌실라, 인비토 | (PG에서 확인) | 각 소량 | 테스트 발송 |

### 10-2. 5/6 11시 시점 MySQL 카운트 (참고치)
| 캠페인 | success | pending | fail | total |
|---|---|---|---|---|
| 자연인 73d1133e | 4728 | 139 | 22 | 4889 |
| 폴라 14df97e7 | 15275 | 648 | 183 | 16106 |
| 캐럿 9d56b7a1 (5/6 07:00) | 14 | 0 | 0 | 14 |
| 그 외 17건 | (대부분 100% 성공) | | | |

### 10-3. 임시 처리 상태
- **자연인/캐럿 19건 PG UPDATE 완료** (BEGIN/COMMIT 트랜잭션, 5/6에 Harold 직접 실행)
- **폴라초이스 14df97e7 PG UPDATE 안 함** (MySQL 카운트만 받음)
- **다른 5/6 캠페인 (이새/수스/한국시세이도/라프레리 등) PG UPDATE 안 함** (모두 sent_count=0 또는 부분)

→ **근본 해결 적용 시 화면이 MySQL 직접 읽으므로 PG 잔여 0값은 무관.** 정리 SQL 따로 안 돌려도 됨.

---

## § 11. 잔여 별건 (본 리팩터와 분리)

다음 세션에서 본 리팩터와 별도 진행 또는 종결 처리:

### 11-1. 잔액 정합성 (직원 비교)
- 비즈웹 vs 한줄로AI 잔액 1~30원 ~ 백단위 차이.
- **Harold 결정: "직원에게 적당히 처리하라고 했다" — 종결.**
- 추후 정밀 진단 필요 시 별도 세션.

### 11-2. 폴라초이스 5번 등록 (UX)
- 사용자가 "예약" 버튼 5번 눌러서 동일 캠페인 5번 생성, 4번 취소.
- UX 개선 후보: 동일 캠페인 중복 등록 confirm/방지.
- 우선순위 낮음. 별건.

### 11-3. PG `campaigns.cancelled_at` UTC/KST 변환 잠재 버그
- 5/6에 cancelled_at(5/5 14:41) < created_at(5/6) 시간 역전 발견.
- 본 리팩터와 무관. 별건.

### 11-4. SMSQ_SEND_12 base table 존재 (env 미포함)
- D144 조사 중 발견. 운영 무관.

---

## § 12. 마무리 — 다음 세션 첫 메시지 권장 (Harold가 받을 메시지 형태)

```
이 문서를 정독 완료했습니다 (status/D144-STATS-REALTIME-REFACTOR.md).

확인:
1. § 4-3 옵션 B (PG 카운트 deprecate, MySQL 직접) 진행 컨펌 재확인 부탁드립니다.
2. § 9-2 시작 전 검증 4건 진행하고 결과 보고 후 Phase 0 시작하겠습니다.
3. 추측·임의 행동 일절 안 합니다. 끌로드원칙 7-1 단계 그대로.

§ 9-2 시작 전 검증부터 진행할까요?
```

---

> **이 문서를 정독하고 § 9 절차를 따르면 다음 세션에서 5/6에 했던 헛소리·땜질 시도를 반복하지 않을 수 있다.**
> **Harold의 분노는 정당했다. 추측·컨펌 없이 코드 수정·운영 중 배포 권한·핵심 못 짚고 통계만 운운한 것 모두 잘못. 다음 세션에서는 이 문서 그대로 따라가서 처음부터 옳게 진행한다.**
