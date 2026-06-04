# 2026-06-04 핸드오프 — 여정 엔진 재설계 Phase 9만 남음

## 다음 세션 진입
1. 이 핸드오프 + CLAUDE.md + `status/lessons/LESSONS_BACKEND.md`(D232+) 정독
2. 설계서 `docs/superpowers/specs/2026-06-04-journey-engine-redesign-design.md` §10·§13 정독
3. Phase 9(미리보기 실발송 일치 + step 시점·조건 UI)만 남음 — 큰 변경이라 brainstorming/writing-plans 진입

## 완료 — Phase 1~8 (전부 배포)
| Phase | 내용 | 상태 |
|---|---|---|
| 1~5 | 공통 안전필터·진입 원장·이벤트 커서·자유여정·묶음 발송 | 배포 + 마이그레이션 적용 완료 |
| 7 | 조건평가 안전분기 — met/not_met/error, DB오류=발송 보류+재시도(발송 X) | 이번 세션 배포 |
| 6A | step1 진입 시점도 calculateNextRunAt(specific_hour·next_business_day 적용) | 이번 세션 배포 |
| 6B | 발송 2시간 전 스팸테스트 스캐너 + 걸리면 1회 재생성(1크레딧)+재테스트, 깨진 notifier 뿌리째 교체 | 이번 세션 배포 |
| 8 | 포인트 소멸 trigger(points 임계 + 미사용 / 연 소멸일 D-N) | 이번 세션 배포 |

## 이번 세션 신규 파일/CT (Phase 9가 알아야 할 구조)
- `utils/journey-condition.ts` — customer_field 순수 평가(Phase 7)
- `utils/journey-pretest-scan.ts` — groupPretestBundles 순수 코어(Phase 6B)
- `utils/journey-points-trigger.ts` — resolvePointsExpiringConfig 순수(Phase 8)
- `utils/journey-pause-handler.ts` — pauseJourney 공용 추가(Phase 6B)
- `utils/journey-pretest-validator.ts` — runStepSpamTest 공용 추출(활성화 검증 + 스캐너 공유)
- `utils/journey-ai-generator.ts` — regenerateStepAvoidingSpam(스팸 회피 재생성, source `journey-ai-refine`=1크레딧 자동)
- `utils/journey-pretest-notifier.ts` — scanAndPretest로 재작성(예측 스케줄링 `predictNextSendTimes`·`scheduleNotificationsForActivation` 폐기)
- `utils/send-time-util.ts` — calculateNextRunAt(now 인자 추가 → 순수 테스트 가능)
- 순수 테스트 5종: journey-condition(16)·journey-send-time(5)·journey-pretest-scan(10)·journey-points-trigger(16)·journey-safety-filter(8) = 55 단언 GREEN

## 남은 것 — Phase 9 (다음 세션)

### 9-1. 미리보기 = 실발송 일치 (설계 §10)
- `journey-simulator.ts`의 matchTriggerCustomers(cdp 30일 EXISTS·custom 전체 추정)를 폐기.
- 추출 단일 진입점 `selectJourneyTargetCustomerIds`(journey-target-extractor) + 공통 안전필터를 미리보기·시뮬레이터·실발송이 함께 쓰게 통일.
- 미리보기 = LIMIT 없이 전체 count + 샘플 N명(현재 미리보기 30 vs 발송 500 불일치 해소).
- 시뮬레이터 임의 상수(잔존율 0.85·객단가 5만·클릭 0.15 등) = 그 회사 실데이터 도출 또는 "추정치" 명시(feedback_no_arbitrary_constants 룰 — 등급별 실측 1순위, 부족 시 insufficient_data 정직 안내).

### 9-2. step 시점·조건 UI (설계 §13)
- step 타임라인 뷰: step별 발송 시점(절대/상대 배지) + 조건 칩 + 채널 + 예상 묶음 수를 한 줄에.
- 미리보기 카드 = 실제 추출과 같은 함수의 전체 count + 샘플.
- 다크 톤 + violet 액센트, ConfirmModal/useToast(네이티브 다이얼로그 0). AI 여정 빌더(`/ai-journeys`) 동급 디자인.
- 포인트 소멸 trigger(Phase 8) 설정 UI도 여기서 — points_min·inactive_days·expiry_mode(inactivity/annual_date)·expiry_month_day(MM-DD)·days_before 입력. annual_date인데 소멸일 미설정 시 발송 0 안내.

## 배포 (이번 세션 — Harold)
- 신규 마이그레이션 0 (7·6·8은 기존 컬럼만 사용).
- `tp-push "여정 엔진 Phase 7·6·8 ..."` → 서버 git pull → backend `npm run build:safe` → `pm2 restart all`.

## 핵심 사실/주의 (Phase 9)
- 미리보기·시뮬레이터·발송이 같은 추출 함수를 쓰는 게 9-1 핵심 — `selectJourneyTargetCustomerIds`가 이미 발송·트리거 워처가 쓰는 단일 진입점. simulator만 거기로 합치면 됨.
- 6B 스캐너: 2시간 전 재테스트가 (step,날짜)당 하루 1회 — "본문 변경 시에만" 게이팅은 옵션 후속(Harold 미결).
- Phase 8 trigger 설정은 현재 백엔드만 — 회사가 UI로 N·일수·소멸일을 넣는 화면은 9-2에서.
