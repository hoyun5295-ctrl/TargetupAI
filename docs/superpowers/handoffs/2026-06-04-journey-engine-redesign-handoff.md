# 2026-06-04 핸드오프 — 톤28 504 실증 완료 + 여정 엔진 전면 재설계

## 다음 세션 진입
1. 이 핸드오프 정독 + CLAUDE.md + status/lessons/LESSONS_BACKEND.md
2. 여정은 부분 패치 금지 — "조건 맞는 타겟을 정확·실수 없이 추출해 보낸다"가 최우선(Harold 명시)
3. superpowers: brainstorming → writing-plans 순으로 설계 문서부터, 승인 후 구현

## 0. 이번 세션 완료(검증·실증)
- **톤28 504 근본 fix 실증**: commit이 정제 DELETE를 안 하고 COUNT 3개만 수행(`countStagingFiltered` campaigns.ts:1280~1302). hoyun 더미 10만 측정 = 9.155 + 36.818 + 220.234 = **266ms**. 정제(중복제거 ctid+ROW_NUMBER)도 BEGIN/ROLLBACK 측정 107ms(self-join 240초 대비). commit 즉시 202 = nginx 60초 타임아웃 안 걸림 = 504 원천 차단 확정.
  - nginx 실측: 08:13/08:21/08:34(KST) `POST /api/campaigns/direct-send/commit 504` + `upstream timed out`. 백엔드 error.log엔 commit 예외 0(완주). = "백엔드 정상, nginx만 504" 확정.
- **톤28 cancelled 2건 정정**: 6965e1ea(948)·5d3cac25(939)를 status='completed'로 UPDATE(Harold 실행). 통계가 MySQL 집계(stats-aggregation은 cancelled 제외)라 completed면 948/939 잡힘. 톤28=후불이라 환불 무관.
- **아이디룩**: 5/29 18~19시 에러로 발송 못 함 = 톤28과 동일 뿌리(대량 발송 시 백엔드 응답 불가 → 프론트가 HTML을 JSON 파싱 "Unexpected token <"). 톤28 fix(commit 즉시 202 + worker 청크 + staging 적재로 메모리 안 올림)가 OOM/타임아웃 둘 다 커버. 추가 조사 안 함(Harold 확정).

## 1. 여정 결함(확정, 라인 근거)
### 진입(타겟 추출) — 최우선
1. **자유여정(custom) 진입 경로 부재** [CRITICAL] — activateJourney(journey-builder.ts:685)는 status active + snapshot + 알림스케줄만, journey_executions INSERT 0건. ai.ts:2541 activate도 크레딧만. trigger-watcher.ts:71 `template_code != 'custom'`으로 제외. → 자유여정 활성화해도 진입·발송 0. 사용자가 제일 많이 쓰는 타입이 안 돎.
2. **신규가입 created_at 재업로드 취약** [CRITICAL] — extractor.ts:41 `created_at >= NOW() - N시간`. 고객DB 전체 재업로드 시 created_at이 전부 갱신 → 전원 "신규" 오인. 실측: hoyun에 2만명이 06-04 05:35:41~43(2초) 일괄 업로드 → 전체 매칭 → LIMIT 500만 발송됨(500 campaign + 500 차감). 진짜 신규(업로드/CSV 갱신과 구분) 판정 필요.
3. **LIMIT 500** [HIGH] — trigger-watcher.ts:113 `selectJourneyTargetCustomerIds(..., 500)`. 포인트소멸 등 조건 10만이면 500만 발송, 나머지 누락. LIMIT 제거 필요(단 묶음 발송 동반 필수, 아래 8번).
4. **cdp trigger opt-out/is_active 필터 누락** [CRITICAL] — extractor.ts:97(cart_abandon)·152(selectCdpEvent: purchase/reservation): customer_conditions 없으면 customers JOIN 스킵 → sms_opt_in/is_active 필터 미적용 → 수신거부 고객에게 발송.
5. **is_invalid(무효번호) 필터 전 trigger 누락** [HIGH] — extractor 어디에도 is_invalid 체크 없음.
6. **미리보기(LIMIT 30) vs 실발송(LIMIT 500) 규모 불일치** [MEDIUM].

### 조건 평가
7. **evaluateCondition default pass=true** [HIGH] — executor.ts:1014(null), 1029(cdp_event_exists DB오류), 1039(journey_step_clicked DB오류), 1043(미지원 type), 1078(미지원 operator) 전부 return true. 런타임 DB 실패 시 조건 무시 발송. 활성화 시 형식검증(journey-builder 556~621)은 있으나 런타임 오류는 못 막음.

### step 발송 시점
8. **step 시점 = 매칭 순간 + delay** [HIGH] — trigger-watcher.ts:145 `shiftToSendableHour(now + delay_hours)`. Harold 명세: step1은 "전일 대상 묶어 다음날 지정 시각", step2=step1+72h, step3=step2+168h 등 절대/상대 지정이어야. 현재는 매칭되는 순간부터 상대시간뿐.

### 발송 구조
9. **고객당 개별 campaign(묶음 없음)** [CRITICAL] — executor.ts:630 processExecution이 고객 1명당 campaigns INSERT(target_count=1, status='sending') + 차감(587, reference=journey_id) + 큐 1행(702). 500명=500 campaign+500 차감+발송결과 500행 → 조회 폭주. Harold 명세: 같은 step·같은 시점 대상은 캠페인 하나 + %고객명% 치환으로 묶여야.

### 긍정(이미 있음)
- 발송 2시간 전 담당자 알림 스케줄: journey-builder.ts:679 scheduleNotificationsForActivation + journey-pretest-notifier. 스팸필터 2h 전 요구의 토대.

## 2. 재설계 방향(Harold 명세 종합)
1. **진입**: 조건 맞는 전체(LIMIT 제거). 신규가입은 진짜 신규만(업로드/재업로드 제외 — 가입일 컬럼 또는 업로드 시 created_at 보존). is_invalid·opt-out·is_active를 전 trigger 공통 필터로. 자유여정(custom) 진입 worker 신설.
2. **발송**: 같은 step·같은 발송시각 대상을 캠페인 하나 + campaign_send_staging + 청크(직접발송 worker 구조 차용) + %고객명% 치환. executor의 고객당 개별 campaign 폐기.
3. **시점**: step별 절대 시각/상대(+N시간) 지정. step1 = 조건 충족 후 N일 + 지정 시각(전일 대상 묶어 다음날 09시 등). step2~ = 직전 step +시간.
4. **스팸필터**: 발송 2h 전 스팸필터 테스트 → 통과 발송 / 걸리면 정지 + 담당자 안내(토대 있음, 발송 묶음에 연결).
5. **조건평가**: DB 오류 시 default pass → 안전 분기(조건 미충족 취급 = skip/정지, 무조건 발송 X).
6. **trigger 종류 확장**: 포인트소멸(customers.points) 등 Harold가 예로 든 trigger 추가.
7. **UI**: step 시점·조건을 한눈에 보이게(AI 여정 빌더 동급 디자인).

## 3. 다음 세션 시작점(미확정 — Harold 입력 대기)
- **신규가입 판정 기준**: 고객 CSV/연동에 가입일 컬럼이 있나? 진짜 신규는 어떻게 유입되나(연동 실시간 / CSV 가입일)? → 업로드 제외 기준 확정.
- 그 답 후: brainstorming으로 (진입 worker + 발송 묶음 + step 시점 + 스팸필터 + 조건평가 안전분기 + UI) 설계 문서 작성 → 승인 → 단계별 구현.

## 4. 점검에서 거른 오진(주의)
- 점검 agent가 "region·birth_month_day 컬럼 없음"이라 했으나 실제 customers에는 둘 다 존재(Harold 컬럼 덤프 확인). 구버전 schema.sql을 본 오진. 재설계 시 실DB 컬럼(53개) 기준으로.
