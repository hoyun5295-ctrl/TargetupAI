# 2026-06-04 핸드오프 (세션2) — 여정 엔진 재설계 Phase 1~5 완료, Phase 6~9 남음

## 다음 세션 진입
1. 이 핸드오프 + CLAUDE.md + `status/lessons/LESSONS_BACKEND.md`(D232+) 정독
2. 설계서 `docs/superpowers/specs/2026-06-04-journey-engine-redesign-design.md` 정독
3. **Phase 7(조건평가 안전분기) 우선 권장** — 빠르고 "DB 오류 시 발송" 구멍을 막음. 이어서 6 → 8 → 9
4. superpowers brainstorming/writing-plans는 큰 변경(Phase 6·9)에서, 작은 변경(Phase 7·8)은 TDD로 바로

## 이번 세션(세션2) 완료 — Phase 1~5 코드·검증, 배포(Harold)
설계서·Plan·마이그레이션 모두 작성됨. 매 단계 tsc 0 / 순수 테스트(journey-safety-filter 8 + journey-entry-ledger 7) GREEN / 박-단어·모델명 0.

| Phase | 내용 | 파일 | 닫힌 결함 |
|---|---|---|---|
| 1 | 공통 안전필터(is_active·sms_opt_in·is_opt_out·is_invalid·unsubscribes 전 trigger 무조건) | `utils/journey-safety-filter.ts`(신규) + extractor 5분기 + simulator | #3·#8 |
| 2 | 신규가입 진입 원장(전에 본 적 없는 식별자만, 활성화 baseline, 대량 차단기) | `utils/journey-entry-ledger.ts`(신규) + journey-builder activateJourney + extractor customer.created + trigger-watcher 원자 진입 | #2 |
| 3 | cdp 이벤트 커서(구매·예약 누락 0·정확히 1회) + 장바구니 창 [N,N+24h] | extractor selectCdpEvent(커서/추정 모드) + activateJourney 커서=NOW + trigger-watcher processCdpCursorJourney | #6(cdp) |
| 4 | 자유여정 진입(audience=조건+안전필터, 미진입분만) | extractor custom 케이스 + trigger-watcher custom 포함 | #1 |
| 5 | 묶음 발송((journey,step,KST날짜)당 campaign 1건, 결과 1줄+전화번호 검색) | `utils/journey-step-campaign.ts`(신규) + executor 공유 campaign + app_etc1=campaignId 정정 | #5 |

## 핵심 사실/교훈 (다음 세션 필독)
- **고객 업로드 = customer-upsert upsert**(키=company_id+COALESCE(store_code,'__NONE__')+phone), id·created_at 보존. created_at 리셋은 전체삭제(`customers.ts:1533`)·업로더별삭제(`admin.ts:231`)만(드묾).
- **진입 원장 키 = 시스템 upsert 식별자(회사+매장코드+전화번호)** — created_at 의존 0. 활성화 시 그 시점 전체 고객을 baseline 1회 적재 → 이후 원장에 없는 식별자만 신규.
- **bulkInsertSmsQueue: app_etc1=row[6], app_etc2=row[7]**(`sms-queue.ts:942·944`). 여정 SMS가 뒤바뀌어 있었음(row[6]=company_id, row[7]=`journey:...`) → 여정 SMS 수신자 상세가 안 잡히던 원인. Phase 5에서 row[6]=campaignId로 정정.
- **여정 과금 = prepaidDeduct(발송 시, `executor:587`)**, campaign_runs 월정산 경로 밖(여정은 campaign_runs를 안 만듦) → app_etc1 변경이 billing에 영향 0.
- **results 상세 = `WHERE app_etc1=campaignId` + 전화번호 LIKE 검색**(`results.ts:578·587·703`). 직접발송과 동일 경로 → 여정도 app_etc1=campaignId면 그대로 작동.
- 직접발송 파이프라인(`direct-send-worker/processor`)·billing은 무수정(격리).

## 남은 것 — Phase 6~9 (다음 세션)
- **Phase 7 조건평가 안전분기 [권장 우선·빠름] (결함 #4)** — `journey-executor.ts` evaluateCondition: null(1014)/cdp DB오류(1029)/clicked DB오류(1039)/미지원 type(1043)/operator(1078)이 전부 `return true`(발송)다. DB 오류·미지원 = "미충족 취급(발송 안 함)"으로 안전 분기. 활성화 형식검증은 유지.
- **Phase 6 step 시점 + 스팸 2h (결함 #7)** — ① 진입(step1)도 `calculateNextRunAt(delay_mode)` 적용(현 trigger-watcher enqueue는 now+delay 고정, executor advanceOrComplete는 이미 delay_mode 지원). ② 스팸필터 발송 2h 전 테스트→통과 발송/걸리면 정지+담당자 안내. **깨진 notifier 뿌리째 고침** — `journey-pretest-notifier.predictNextSendTimes`가 `journey_executions.scheduled_at`·`step_id`(존재 안 하는 컬럼)를 조회 → 활성화 try/catch가 삼켜 2h 전 알림이 처음부터 안 돌고 있음(information_schema 확인됨: journey_executions에 그 두 컬럼 없음).
- **Phase 8 trigger 확장 (포인트 소멸)** — `customers.points`(정수)는 있으나 소멸일 컬럼 없음. 소멸일 출처(custom_fields / CDP 이벤트) Harold 확인 후 edge 정의.
- **Phase 9 미리보기 통일 + UI** — `journey-simulator.matchTriggerCustomers`(cdp 30일 EXISTS·custom 전체 추정)를 추출 단일 진입점으로 통일 + 임의 상수(잔존율 0.85·객단가 5만 등) 실데이터 교체. step 시점·조건 한눈 UI(AI 여정 빌더 동급).

## 배포 (이 세션 종료 시 — Harold)
1. **PG 마이그레이션 1회**: `docs/superpowers/plans/2026-06-04-journey-redesign.sql` 실행 (journey_entry_ledger · journey_step_campaigns · journeys.entry_baseline_at · journeys.last_event_cursor + 활성 여정 baseline/커서 백필).
2. `tp-push "여정 엔진 재설계 Phase 1-5"`
3. 서버: backend `npm run build:safe` + `pm2 restart all`

## 변경 파일 (Phase 1~5)
- 신규: `utils/journey-safety-filter.ts` · `utils/journey-entry-ledger.ts` · `utils/journey-step-campaign.ts` + `__tests__/journey-safety-filter.verify.ts` · `__tests__/journey-entry-ledger.verify.ts`
- 수정: `utils/journey-target-extractor.ts` · `utils/journey-trigger-watcher.ts` · `utils/journey-builder.ts` · `utils/journey-executor.ts` · `utils/journey-simulator.ts` · `routes/ai.ts`(preview-samples journeyId)
- 마이그레이션: `docs/superpowers/plans/2026-06-04-journey-redesign.sql`
- 설계/계획: specs/2026-06-04-journey-engine-redesign-design.md · plans/journey-phase1·phase2·phase5
