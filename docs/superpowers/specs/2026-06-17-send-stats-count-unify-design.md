# 전송건수·대기 통계 정합 근본 통일 — 설계서 (2026-06-17)

> 디버깅1(에이스 대기 666) + 디버깅2(시세이도 전송 1,613) 통합 근본 수정.
> 원칙: 단편 수정 종결. 카운트 계산을 한 곳으로 모으고, 캐시↔실측 자동 대조 안전망을 둔다.
> 발송·정산에 닿으므로 dev_process 6원칙(쓰기 경로 전수 grep + 효과 검증 잔존 0 + 캐시↔MySQL 안전망 + 실측 1건) 적용.

---

## 1. 배경 — 같은 버그 3회 재발

- **D233+ (6/9)**: 발송통계 성공→실패 오분류 + 미도래 예약 대기 집계
- **6/15 (버그3)**: 전송 ≠ 성공+실패 — `reconcileSentCount`를 results.ts에만 적용, 슈퍼관리자 캠페인관리·CSV 누락
- **6/16~17**: 디버깅1(에이스 대기 666) + 디버깅2(시세이도 전송 1,613) 재오픈

**재발 이유**: 전송·대기 카운트 산식이 9개+ 표면(backend 6 + frontend 4 + CSV)에 흩어져 매번 한두 곳만 고침. 특히 **대기는 어느 표면도 backend 진실을 안 쓰고 frontend가 `sent − success − fail`로 자체 파생**.

## 2. 확정된 근본 원인 (SQL + 코드 + 캡쳐 증거)

- **디버깅1 에이스 666**: PG 캐시 `fail_count=899`, MySQL 실측 1,565(캡쳐02 상세). 완료(`result_final=true`) 조기 확정으로 캐시에 실패 666 누락. `reconcileSentCount`(전송=max(적재, 성공+실패))만으론 안 풀림 — 적재(47,846) > 캐시 성공+실패(47,180)라 차액 666이 대기로 둔갑. **캐시 정정이 필수.**
- **디버깅2 시세이도 1,613**: `admin.ts:1769` 캠페인관리 목록이 `result_final`에서 `total_sent = sent_count`(reconcile 누락). 적재 1,613 < 성공+실패 1,646. → admin에 reconcile 적용으로 전송 1,646 정합.
- **시세이도 2 (status 104)**: 라이브 큐에 결과대기 잔존인데 완료 확정(MySQL 확인 = status_code 104 × 2). 통신사 결과 미수신.

## 3. 표면 전수 (grep 증거)

### 전송(sent) reconcile 적용 여부
- **적용**: results.ts 요약(152)/목록(321,337)/차트(644), stats-aggregation `getCampaignResultCounts`(449,466), 통계 `querySendStats` 경유(manage-stats)
- **누락**: `admin.ts:1769` (캠페인관리 목록), `results.ts:466,474` (CSV 엑셀)

### 대기(pending) 자체 파생 — backend 진실 없음
- frontend: `AdminDashboard.tsx:4019`(캠페인관리), `:4097`(통계 요약), `ResultsModal.tsx:487`(상세), `CampaignDetailModal.tsx:49`(상세)
- backend: `results.ts:474` (CSV)

### 전송 표시 (sent_count || target_count 직접)
- `ResultsModal.tsx:381,484,578` / `CampaignDetailModal.tsx:80` / `StatsTab.tsx(manage):313` / `StatsTab-company.tsx:311` / `company-frontend StatsTab.tsx:306`

## 4. 설계 — 계산은 한 곳에서만

### A. backend 단일 진입점 + 대기 진실 반환
- `getCampaignResultCounts` 반환을 `{ sent, success, fail, pending }`로 확장
- **완료(`result_final`)**: `pending = 0` (정의 — 완료 캠페인은 대기가 없음), `sent = reconcileSentCount(...)`
- **진행중**: `pending = 실측`(MySQL status 100/104 + 카카오 대기), `sent = reconcileSentCount(...)`
- `admin.ts:1769` 인라인 산식 제거 → `getCampaignResultCounts` 사용 (디버깅2 해결, no_inline_duplication 정합)
- `results.ts:461~474` CSV도 `getCampaignResultCounts` 통일
- `querySendStats` summary에 `total_pending` 추가 (통계 요약이 backend 대기 사용)

### B. frontend 자체 파생 제거
- `AdminDashboard.tsx:4019, 4097` / `ResultsModal.tsx:487` / `CampaignDetailModal.tsx:49` → backend가 준 `pending` 그대로 표시
- 전송도 backend `sent`(reconcile 값) 사용 — `sent_count || target_count` 직접 표시 제거

### C. 완료 캠페인 캐시 정합 (디버깅1 + 근본 차단)
- **확정 조건 엄격화**: campaign-sync-worker가 `result_final=true` 굳히는 조건을 "라이브 대기(100/104) 0건 + 성공+실패 = 적재"일 때만으로. 미달이면 진행중 유지.
- **이미 굳은 캠페인 재동기화**: `smsCampaignCountsSafe` 실측으로 PG `success_count`/`fail_count` 갱신 (에이스 899→1,565). 1회 배치 + 주기 안전망 워커.
- **시세이도 2 (status 104 미수신)**: 발송 후 충분 경과(기준 Harold 확정 필요) + 104 잔존 → 실패 전환 또는 `result_final` 해제. 정책 결정 항목.
- dev_process 6원칙: `UPDATE campaigns` 쓰기 경로 전수 grep + 정정 후 잔존 0 재집계 + 실측 1건.

## 5. 효과 검증 (실측 1건)

- **에이스(5a663d64)**: 캐시 재동기화 후 `success + fail = 47,846 = 전송`, 대기 0 (재집계로 확인)
- **시세이도 1,613(shiseido4)**: admin reconcile 후 전송 1,646 = 성공+실패
- **4표면 교차**: 캠페인관리 / 통계 / 상세 모달 / CSV 엑셀 동일값 확인

## 6. 테스트 (TDD)

- 순수 함수: `reconcileSentCount` + 완료/진행중 `pending` 산식 단위 (RED → GREEN)
- 캐시 정합: 불일치 캠페인 탐지 + 정정 후 `성공+실패+대기 = 적재` 검증
- 회귀: 정합 캠페인(대상=전송) no-op 확인

## 7. 범위 밖 (별건)

- 취소(cancelled) 캠페인 `sent_count` 잔존 표시 (캡쳐03 취소행 sent_count=1234 vs MySQL 0) — 본 건과 무관, 후속

## 8. 배포 후 운영 검증·후속 수정 (2026-06-17)

- **시세이도 2건 미발송 근본** = QTmsg Agent가 `rsv1='3'`(서버전송요청완료, 매뉴얼 p.6) 마킹 후 중계서버 미수신 = 전송 유실(엔진에 없음). 신규 `expired-pending-sweeper`(1분)가 `rsv1=3 + status 100/104 + mobsend NULL + 48h(매뉴얼 SMS·LMS 최장 2일) 초과` → `status 4000`(전송시간초과=실패) 자동 마킹(절대 안 나감). `rsv1=1·2`(정상 예약) 절대 보존. `smsCampaignCountsSafe` liveAgg에 lf(라이브 만료 fail) 추가. → 실측 status 104→4000 확인.
- **에이스 666 reconcile 폭증** = reconcile 재대조 윈도우를 24h→7일로 넓힌 게 대상을 1,779건으로 폭증시킴(실 불일치 1건). BATCH 50 + send_base ASC라 최근 에이스(6/13)가 차례 안 옴. fix = `reconcileFinalizedCampaigns` completed 분기에 불일치(`success_count + fail_count < sent_count`) 조건 추가 → 대상 1,779→1. → reconcile 5분 주기(INTERVAL_MS)로 에이스 fail 899→1,565·대기 666→0·result_synced_at 갱신 실측 해결.
- 라인 커버: `getCompanySmsTablesWithLogs`는 회사 전 사용자 라인 + 당월 이력 포함(0610 수정)이라 정상 — 라인 누락 아님.
- 교훈: reconcile 윈도우 확대는 대상 폭증을 부르므로 "캐시 불일치(success+fail<sent_count)" 한정이 정답. 시간 윈도우만 넓히면 BATCH·정렬에 막혀 최근 건이 영원히 안 잡힌다.
