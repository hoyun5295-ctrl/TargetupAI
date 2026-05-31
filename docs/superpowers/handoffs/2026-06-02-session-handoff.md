# 2026-06-02 세션 핸드오프 — AI Operator 성과 추정 완전 데이터 기반 재설계 구현

> 직전 세션(D227+ 2026-05-31) = 장바구니 리커버리 토대 + 본문 0 bytes 정정 + 3원칙 룰 배포 완료. 성과 추정 산식은 임의 상수 잔존(미배포) → 이번 세션에 spec 기반 완전 재설계.

---

## 1. 최우선 작업 — 성과 추정 재설계 (핵심 BM)

**왜**: AI Operator 예상 성과가 임의 상수로 비현실 수치("VIP 1301명 매출 50만" → 정정 시도 → "클릭 1900" → "ROI 38950%"). Harold 명시 "AI 마케팅 오퍼레이션인데 제대로 된 근거 안 주면 아무도 안 쓴다 + 무조건 하드코딩 금지 + 실제 고객 데이터로 등급별 계산".

**설계도**: `docs/superpowers/specs/2026-06-01-operator-performance-data-driven-redesign.md` (정독 필수, **구현 완료 후 삭제**).

**핵심 구조 (3계층)**:
1. 등급별 과거 실측 (`cdp_events.purchase` + `customers.grade` JOIN + `campaigns.target_filter` 역추적) — 상수 0
2. 개인별 구매주기 (`created_at` ÷ `purchase_count` → 포아송 자연구매확률) — 실측 부족 시
3. insufficient_data — 둘 다 부족 시 "데이터 넣어야 정확" 정직 안내 (가짜 숫자 X)

**구현 순서**: spec §10 Task 0~7. Task 0 = 컬럼 검증 SQL(Harold 실행) 먼저.

**현재 로컬 상태(미배포, 전면 대체 예정)**:
- `packages/backend/src/utils/operator-performance-estimator.ts` — 구매력 모델(임의 상수 CVR상한10%/uplift1.4/window3일 잔존). spec 구현 시 전면 재작성.
- `packages/backend/src/utils/__tests__/operator-performance-estimator.manual-test.ts` — 테스트(7건). 재설계에 맞게 갱신.
- `packages/backend/src/services/ai-orchestrator.ts` — calculateCostROI 제거 + estimatePerformance 2곳(L379·L802) 연결. **이건 유지 가능** (estimatePerformance 인터페이스만 맞추면).
- `packages/frontend/src/pages/AiOperatorPage.tsx` — performance.basis/avgRevenue/roi 표시 추가됨. basis.level 4종으로 확장 필요.

## 2. 영구 룰 (이번 세션 신설 — 반드시 정독)

- `memory/feedback_no_arbitrary_constants_use_real_data.md` — 추정 산식 임의 상수 금지. **추정 숫자 작성 전 "실데이터냐 추측이냐" 자가 질의 의무.** 직전 세션 한 세션에 임의 상수 3회 반복 위반.
- `memory/feedback_three_principles_default.md` — 3원칙(자가진단 + 클로드 원칙 + 슈퍼파워즈).

## 3. 배포 완료된 것 (건드리지 말 것)

- SDK 장바구니 리커버리 토대 + 본문 0 bytes 파싱 정정 = 배포 완료. `utils/ai-json.ts` 안전 파서, `cdp-events.ts` ingestBrowserEvents, SDK auto-init 등.

## 4. 미해결 (별도 트랙)

- Cafe24 회원 식별 = 사업자 인증완료(접수완료 상태) 후 v0.4.5 앱(Service Key) 트랙.
- ltv_score 전 고객 0 = 워커 미가동 (성과 재설계에선 사용 금지, 별도 트랙).
- (직전 핸드오프 잔여) 발송결과 속도 batch2 = stats-aggregation getCampaignResultCounts CT + admin.ts (미배포).

## 5. 다음 세션 진입 명령어 (Harold 복붙)

```
docs/superpowers/specs/2026-06-01-operator-performance-data-driven-redesign.md 정독 + docs/superpowers/handoffs/2026-06-02-session-handoff.md 정독 + memory/feedback_no_arbitrary_constants_use_real_data.md 정독 + memory/feedback_three_principles_default.md 정독 + status/lessons/LESSONS_DB.md 정독 → AI Operator 성과 추정 완전 데이터 기반 재설계 구현: Task 0 컬럼 검증 SQL(campaigns.target_filter / cdp_events.customer_id+purchase / customers.grade·created_at) 제시 → grade-conversion-stats.ts 등급별 실측 + fetchTargetProfile 구매주기 + computeEstimate 3계층(임의 상수 0) + 프론트 basis 4종 + ROI 절대액 → TDD 각 단계 → 구현 완료 후 spec 파일 삭제 → tp-push 배포
```
