# 여정 Phase 5 — 묶음 발송 (결과 1줄 + 안에서 검색) Implementation Plan

> 상위 설계서: `docs/superpowers/specs/2026-06-04-journey-engine-redesign-design.md` (Phase 5).
> 배포는 마지막 1회. DDL은 `2026-06-04-journey-redesign.sql`에 누적.

**Goal:** 고객 1명당 campaign 1건(500명=500줄 폭주)을 폐기하고, **(journey, step, 발송날짜)당 campaign 1건을 공유**한다. 발송결과 목록은 step당 1줄, 상세는 기존 `app_etc1=campaignId + 전화번호 검색` 경로로 그 1줄 안에서 N명을 검색·표시. 개인화(Liquid·예측·variant·단축URL)는 고객별 렌더 그대로.

**Architecture:** executor의 "고객당 새 campaign INSERT"를 "find-or-create 공유 campaign"으로 교체. 큐 행 app_etc1을 `journey:id:step` → **공유 campaignId**로 변경(결과 상세가 그대로 작동). campaign.target_count/sent_count를 발송마다 +1 누적. staging/사전렌더 불요(executor는 5분마다 소량 처리 → OOM 위험 0, 톤28과 무관).

**검증 필요(코드 작성 전):** app_etc1을 campaignId로 바꿀 때 **billing 정산·알림톡 대체발송 결과 집계**가 안전한지(현재 `journey:id:step` 의존처) — T2에서 읽고 확정.

---

## 닿는 곳

| # | 닿는 곳 | 파일 | 무엇 |
|---|---|---|---|
| T1 | 스키마 | 마이그레이션 .sql | journey_step_campaigns(journey_id, step_id, send_date) PK → campaign_id |
| T2 | app_etc1 안전 확인 | billing.ts·results.ts grep/read | campaignId로 바꿔도 정산·집계 안전 검증(돈 경로) |
| T3 | 공유 campaign CT | `utils/journey-step-campaign.ts`(신규) | getOrCreateStepCampaign(race-safe) + bumpStepCampaignCount |
| T4 | executor 발송 | `utils/journey-executor.ts` | 개별 campaign INSERT → 공유 campaign + 큐 app_etc1=campaignId + step_log |
| T5 | 검증 | tsc + 결과상세 확인 + grep | 결과 상세 N명·전화번호 검색 작동, billing 무탈 |

---

## Task 1: 매핑 테이블 (마이그레이션 누적)

- [ ] **Step 1: `2026-06-04-journey-redesign.sql`에 추가**

```sql
-- ──────────────────────────────────────────────
-- Phase 5: 묶음 발송 — (journey, step, 발송날짜)당 campaign 1건 공유
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS journey_step_campaigns (
  journey_id  uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  step_id     uuid NOT NULL,
  send_date   date NOT NULL,                 -- KST 발송 날짜
  campaign_id uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (journey_id, step_id, send_date)
);
```

---

## Task 2: app_etc1 안전 확인 (돈 경로 — 코드 작성 전 의무)

- [ ] **Step 1:** `rg -n "app_etc1" packages/backend/src/routes/billing.ts packages/backend/src/routes/results.ts packages/backend/src/utils` 전수 — `journey:` 패턴 의존처 확인.
- [ ] **Step 2:** 알림톡 대체발송 결과 집계(D#4-c)가 app_etc1=`journey:id:step`에 의존하는지 확인. campaignId로 바꿔도 billing 정산이 campaign 기준이라 안전한지 확정.
- [ ] **Step 3:** 안전하면 T4에서 app_etc1=campaignId. 위험하면 app_etc1은 campaignId로 두되 정산 itemize는 campaign→journey 매핑으로 보강(대안 설계).

---

## Task 3: 공유 campaign 컨트롤타워

**Files:** Create `utils/journey-step-campaign.ts`

- [ ] **Step 1:** getOrCreateStepCampaign — (journey, step, sendDate) 매핑 SELECT → 없으면 campaign INSERT(target/sent 0, message=대표 본문) + 매핑 INSERT ON CONFLICT DO NOTHING; 경쟁 패배 시 orphan campaign DELETE 후 승자 사용.
- [ ] **Step 2:** bumpStepCampaignCount(campaignId) — `UPDATE campaigns SET target_count=target_count+1, sent_count=sent_count+1, updated_at=NOW() WHERE id=$1`.
- [ ] **Step 3:** 순수 검증 어려움(DB 의존) → mock client로 "기존 있으면 INSERT 안 함 / 없으면 campaign+매핑 / 경쟁 시 orphan 삭제" 순서 검증(ai-credit-tx.verify 패턴).

(정확한 SQL/컬럼은 executor 현재 campaign INSERT 재독 후 1:1 맞춰 작성 — message_content/subject/send_channel/kakao_template_id/mms_image_paths 등.)

---

## Task 4: executor — 공유 campaign 사용

**Files:** `utils/journey-executor.ts` (processExecution 발송 직전 campaign INSERT 구간 + 큐 app_etc1 + step_log)

- [ ] **Step 1:** 현재 campaign INSERT(target=1) 재독 후 → `const campaignId = await getOrCreateStepCampaign(...)`로 교체. 대표 본문 = snapshot/step template(variant 무관 1개).
- [ ] **Step 2:** 큐 INSERT의 app_etc1 = `journey:id:step` → **campaignId**(SMS/LMS/MMS bulkInsertSmsQueue 행 + 알림톡 insertAlimtalkQueue 인자). T2 결과 안전 확인 후.
- [ ] **Step 3:** 발송 성공 후 bumpStepCampaignCount(campaignId). step_log.campaign_id = campaignId(그대로).
- [ ] **Step 4:** tsc 0.

---

## Task 5: 검증

- [ ] tsc 0 + 순수 테스트 회귀 GREEN + 박-단어/모델명 grep 0.
- [ ] (배포 후 Harold) 발송결과: step당 1줄 + 열면 N명 + 전화번호 검색 작동. billing 정산 무탈.

## 비범위
- step 시점(절대/상대)·스팸 2h = Phase 6. 조건 안전분기 = Phase 7. Phase 5는 campaign 묶음만.
