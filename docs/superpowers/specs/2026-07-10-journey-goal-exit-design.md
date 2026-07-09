# 여정 목표 달성 자동 종료(전환 이탈) + 여정 옵션 인터페이스 개선 — 설계 (2026-07-10)

> 기원: 시세이도 시연 질문 — "여정 중간에 구매한 고객이 예정대로 다음 독려 문자를 받는 게 맞나?"
> Harold 방향 확정(2026-07-10): 여정별 옵션 "목표 달성 시 자동 종료" + 인터페이스 편의 개선. 본 문서 = 상세 설계(구현 전 SoT).

## 0. 현황 실측 (2026-07-10 코드 정독)

- 전환 이탈 축 부재: journey-executor에 exit/conversion 코드 0. 발송 직전 게이트 스택(정지 재확인→발송시간→고객 재조회→안전필터→수신거부→라인그룹→회신번호→피로도)에 "목표 달성" 검사가 없음
- execution status 실사용 값: active/completed/paused/failed + 'ended'(condition 미충족 종료, executor:318) — 신규 값 추가 선례 있음
- 여정 옵션 UI = JourneyOptionsEditor(178줄): 한도·예산·재진입·위험도 숫자 나열, draft/paused만 편집 가능(운영 중 변경 전면 불가)
- JourneysPage 3,113줄 + useState 약 60개 + 인라인 확장 상세(맵 상태 12종) — 이번 범위 밖(별도 과제 제안)

## 1. 정책 (Harold 확정 대기 항목 포함)

| 항목 | 결정 |
|------|------|
| 옵션명 | "목표 달성 시 자동 종료" — 1차 목표 = 구매 |
| 기본값 | 꺼짐(발송 대상 규칙 = 회사 명시 선택 — 피로도 가드 원칙). 기존 활성 여정 무변경 |
| AI 생성 추천 | 구매 독려형(재구매·장바구니·휴면 등 marketing 목적)이면 검토 화면에서 기본 켜짐 제안(끌 수 있음) |
| 운영 중 변경 | 이 토글만 활성(active) 중에도 변경 허용 — 발송을 줄이는 안전 방향. 그 외 옵션은 기존 규칙(draft/paused) 유지 |
| 이탈의 의미 | 실패가 아니라 성과 — 상태값 'goal_met', 통계에 "목표 달성 종료 N명" 별도 노출 |

## 2. 판정 규칙

**"여정 진입 이후 구매 발생" — execution.entered_at 기준 비교 (단순 최근 N일 구매 금지 — 재구매 유도 여정 전원 오이탈 함정)**

- 신호 1 (전 회사): `customers.recent_purchase_date > (entered_at AT TIME ZONE 'Asia/Seoul')::date` **(엄격 초과 — Codex P1 정정 2026-07-10)**
  - 같은 날 포함(>=)이면 구매가 진입 사유인 여정(cdp.purchase 트리거 등)이 첫 tick에 전원 즉시 이탈해 여정이 죽는다. 당일 정밀 판정은 신호 2가 담당, 프로필만 있는 회사는 다음 날 tick부터 이탈
- 신호 2 (연동몰): cdp_events 구매 이벤트 `occurred_at > entered_at` (시각 정밀 — 컬럼명은 구현 시 journey-target-extractor 실코드와 동일 소스 재사용)
- 둘 중 하나면 converted. 한계 정직: ERP 싱크 회사는 싱크 반영분까지만(옵션 설명문에 명기)

## 3. 엔진 배선 (backend)

1. **worker 조회 SELECT**(runJourneyExecutor)에 `j.goal_exit_enabled`, `e.entered_at` 동반
2. **processExecution 최상단 게이트**(정지 재확인 직후·step 분기 전) — message/wait/condition 전 step 유형 공통:
   - goal_exit_enabled AND 판정 충족 → `UPDATE journey_executions SET status='goal_met', completed_at=NOW() WHERE id=$1 AND status='active'`(멱등) → outcome 'exited_goal'
   - 판정 쿼리 실패 = 발송 차단이 아니라 통과(이탈은 보너스 — 오류로 여정을 멈추지 않음, console.log 기록)
3. **발송 경로 전수(영향표)**: ① executor tick(위 게이트) ② date_anchor 단발 경로(journey_anchor_dispatch) — 구현 시 실코드로 발송 지점 확인 후 동일 게이트(단, 생일/기념일 단발은 구매 독려형이 아니라 옵션 자체를 끄는 게 보통 — UI 설명) ③ pretest 스캐너 = 무변경(발송 시점 게이트가 최종 차단)
4. **재진입/중복 진입 검사** — status IN ('completed',...) 패턴 전수 grep 후 'goal_met'을 completed 동급으로 포함(빠지면 목표 달성자가 즉시 재진입하는 구멍)

## 4. status 축 신설 = 소비처 전수 (구현 시 grep 증거 의무 — 6원칙 ④)

`journey_executions.status` 읽는 전 경로: executor(WHERE active — 무영향) · journey-stats 집계 · 재진입/중복 검사 · live positions · 회고/결과 통지(result_notified_at) · simulator · JourneysPage 라벨/필터 · JourneyStatsPage. `grep -rn "journey_executions" + status` 전수 리스트업 후 영향표 보고.

## 5. DB (Harold 서버 psql — 검증 SQL 선행)

```sql
-- 검증 1: 신규 컬럼 충돌 없음 확인
SELECT column_name FROM information_schema.columns WHERE table_name='journeys' AND column_name='goal_exit_enabled';
-- 검증 2: 판정 컬럼 타입 실측
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='customers' AND column_name IN ('recent_purchase_date','purchase_count');
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='cdp_events' ORDER BY ordinal_position;
-- DDL (검증 후)
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS goal_exit_enabled boolean NOT NULL DEFAULT false;
```
컬럼 1개(YAGNI — 목표 유형 확장은 필요 시 별도). 신규 컬럼 catch = 503 안전망 룰 적용.

## 6. 인터페이스 (frontend) — "편해야 한다"

1. **JourneyOptionsEditor 2단 재편**: 상단 = 자주 쓰는 토글(★목표 달성 시 자동 종료 — 설명 1줄 "여정 진입 후 구매가 확인된 고객은 남은 메시지를 받지 않고 '목표 달성'으로 종료됩니다. ERP 연동사는 데이터 반영분까지 인식") / 하단 = 고급(한도·예산·위험도·재진입) 접기. 목표 토글은 active 중에도 저장 가능
2. **AI 생성 검토 화면**: marketing 목적 + 구매 독려형이면 토글 기본 켜짐 제안 카드(끌 수 있음)
3. **활성화 확인 모달**: 목표 종료 on/off 한 줄 표시(마지막 확인 지점)
4. **여정 카드/상세**: "목표 달성 N명" emerald 뱃지 · 상태 라벨에 goal_met("목표 달성 종료")
5. **JourneyStatsPage**: 목표 달성 종료 지표 + Source caption
6. (별도 과제 제안 — 범위 밖) JourneysPage 3,113줄 인라인 확장 구조 분리 리팩토링

## 7. backend API·검증

- PATCH /journeys/:id/options: goalExitEnabled 수용(validator 확장) + active 상태에서 이 키만 허용
- 순수 코어(판정 함수)는 DB-free 분리 + vitest / 나머지 tsc + 소비처 grep 증거
- 운영 검증 시나리오(실측 1건): 테스트 여정 활성화 → 진입 → recent_purchase_date를 진입 이후로 갱신(테스트 계정) → 다음 tick에서 goal_met 종료·미발송 확인
