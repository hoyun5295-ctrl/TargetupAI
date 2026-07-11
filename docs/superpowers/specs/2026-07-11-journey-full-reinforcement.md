# 여정 전수점검 후속 — 일괄 강화 패키지 설계 (2026-07-11)

> Harold 지시: "한번에 끝까지 구현" — 전수점검(빈틈 4 + 강화 7 + 구조 3) 중 코드 대상 전 항목.
> 원칙: 발송 파이프라인 절대 보호 — executor 변경은 최소 분기·기존 경로 byte 불변 우선. 신규 컬럼 = `ADD COLUMN IF NOT EXISTS` + 코드 42703 가드. DDL 실행 = Harold.

## 구현 항목·설계 확정

| # | 항목 | 설계(정답 1개) | DDL |
|---|------|----------------|-----|
| A1 | 거짓 설정 정리 | Settings의 "고객당 일일 발송 한도"·"중복 방지 일수" 입력칸 제거(발송 소비처 0 실측 — routes 저장만). 피로도 보호가 실동작 대체임을 카드에 명시. AdminDashboard 표시 2필드 제거. BE 컬럼·라우트는 하위호환 유지(무DDL) | — |
| A2 | 여정 [타겟확인] | POST /operator/journeys/:id/target-recipients — start_kind별 추출 재사용(event/standing=selectJourneyTargetCustomerIds 표본·date_anchor=selectAnchorAudienceIds) LIMIT 100·ORDER BY c.id. 시점 정직 라벨("진입 조건 매칭 표본 — 실제 진입은 트리거 발생 시점"). FE=JourneysPage 카드에 [타겟확인]+공용 TargetRecipientsModal | — |
| A3 | 목표 종류 확장 | journeys.goal_kind('purchase'\|'click'\|'visit', default purchase). executor isGoalConvertedSinceEntry 분기 — click=이 execution 발송(journey_step_logs sent) 이후 cdp message_click / visit=entered_at 이후 page_view. UI=JourneyOptionsEditor 목표 토글 밑 종류 선택(캡션: click=발송 링크 클릭, visit=자사몰 SDK 필요) | journeys.goal_kind varchar(20) NOT NULL DEFAULT 'purchase' |
| B2 | 진짜 분기 | journey_steps.not_met_goto int NULL. condition not_met 시: NULL=현행 ended / N=step_order N으로 점프(전방만 — validator에서 goto>step_order 강제, 무한루프 차단). 점프 시 next_run_at=대상 step delay 계산(advance 재사용). 조건 3종 기존 그대로 활용(journey_step_clicked로 클릭 분기 완성) | journey_steps.not_met_goto integer |
| B1 | wait-until-event | wait step 확장: wait_event_name(cdp 이벤트명)+wait_timeout_hours. 최초 도달 시 journey_step_logs 'waiting_event' 마킹(앵커)→이후 tick마다 이벤트 EXISTS(anchor 이후) 검사: 발생=즉시 advance('event_arrived') / 미발생&기한 내=next_run_at=+15분 재폴링 / 타임아웃=advance('wait_timeout'). wait_event_name NULL=기존 시간 대기 byte 불변 | journey_steps.wait_event_name varchar(50), wait_timeout_hours integer |
| B3 | 활성 중 문안 수정 | PATCH steps의 active 차단 해제(명시 파라미터 allowActive) → 새 snapshot INSERT(executor 최신 snapshot 소비 기존 동작) + journey_pretest_schedules 해당 step dedup 삭제(2시간 전 자동 스팸 재검사 강제 — 기존 scanAndPretest 파이프라인 재사용, 신규 배관 0). FE=JourneyMessageEditModal active 허용+경고문 | — |
| C2 | 홀드아웃 대조군 | journeys.holdout_pct smallint 0(0~30 클램프). 진입 지점 전수(trigger-watcher·anchor-scheduler·one_shot·reentry)에서 rollHoldout → execution status='holdout' 생성(발송 tick은 active만 조회=자동 미발송). 소비처 전수: EXECUTION_STATUSES 추가·reentry IN에 'holdout' 추가·journey-stats 홀드아웃 수+전환 비교(goal 판정 재사용)·FE 라벨 | journeys.holdout_pct smallint NOT NULL DEFAULT 0 |
| C3 | send-time 개인화 | journeys.personal_send_time boolean false. advanceOrComplete에서 다음 step delay_mode='specific_hour'이고 옵션 on이면 고객 최근 90일 cdp(click/page_view/purchase) KST 시간대 최빈값(최소 3건·08~20 클램프)으로 target_hour 대체, 부족 시 기본 시각. 순수 pickPersonalHour TDD | journeys.personal_send_time boolean NOT NULL DEFAULT false |
| C1 | 채널 폴백 | 실측: alimtalk_next_*(대체발송) executor 배선 완료 — UI 노출 확인만, 코드 필요 시 최소 | — |

## DDL 패키지 (Harold 실행 — 전부 IF NOT EXISTS·기본값 무해·기존 행 영향 0)
```sql
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS goal_kind varchar(20) NOT NULL DEFAULT 'purchase';
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS holdout_pct smallint NOT NULL DEFAULT 0;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS personal_send_time boolean NOT NULL DEFAULT false;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS not_met_goto integer;
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS wait_event_name varchar(50);
ALTER TABLE journey_steps ADD COLUMN IF NOT EXISTS wait_timeout_hours integer;
```
- 사전 확인(각 0 rows = 신규 확정): `SELECT column_name FROM information_schema.columns WHERE table_name='journeys' AND column_name IN ('goal_kind','holdout_pct','personal_send_time');` / `SELECT column_name FROM information_schema.columns WHERE table_name='journey_steps' AND column_name IN ('not_met_goto','wait_event_name','wait_timeout_hours');`
- 코드 가드: SELECT는 COALESCE+42703 폴백(옵션 기능만 조용히 skip — 발송 본류 무영향).

## 미구현 확정(스코프 아웃 사유)
- 선호채널(고객별 채널 폴백)·JourneysPage 3,145줄 분리·매뉴얼 정비 = 별도 트랙(이 패키지는 엔진·기능 축).

## 검증 계획
- 순수 TDD: pickPersonalHour·rollHoldout 클램프·goto validator. tsc 0 + vitest 기존 스위트 회귀 0.
- 실측 1건 시나리오(발송 6원칙 ⑤, Harold): ①테스트 여정 goal_kind=click → 발송 링크 클릭 → 다음 tick goal_met ②condition not_met_goto=N 점프 ③wait_event_name=purchase 조기 진행 ④holdout_pct=50 두 명 진입 → 1명 홀드아웃 ⑤활성 중 문안 수정 → 2시간 전 재검사 로그.
