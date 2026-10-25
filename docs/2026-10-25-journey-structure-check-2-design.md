# 여정 구조체크 2차 · 설계안 (2026-10-25)

> **원래 안건(Harold 1025):** 「진짜 궁금해서 한번 더 해보자 여정 구조체크 해봐 이번에도 결함 나오면 진짜」
> 1차 = [2026-10-23 여정 결함 0](2026-10-23-journey-zero-defect-design.md)(17건 닫음 · Codex 5R approve).
> 상태 = 설계안 제시 · Harold 동의 대기 · 코드 수정 0 · DDL 0(새 상태값 없음 · `ended` 는 실행기가 이미 쓴다).

## §1 결과 = 16건(1차 보고 12 + 덮음표 읽기에서 4)

| # | 등급 | 결함 | 증거 | 생긴 때 | 1차에서 안 잡힌 이유 | 뿌리 |
|---|---|---|---|---|---|---|
| 1 | 높음 | A/B 변이 칸 = 켜기 검사 · 2시간 전 재검사 · 실발송이 서로 다른 글을 본다. 켜기 검사는 변이 본문을 **칸의** 채널 · 제목으로 검사, 재검사는 변이를 안 보고 칸 스냅샷만 검사(자동 고친 문안은 변이가 덮어 안 나감), 실발송은 **변이의** 본문 · 채널 · 제목 | `journey-pretest-validator.ts:101-157` · `journey-pretest-notifier.ts:62-96` · `journey-executor.ts:711-722` · 화면 `JourneyVariantsEditor.tsx:755 · 833`(변이마다 채널 · 제목 바꿈) | 0521 변이 · 0526 검사 · 0604 재검사 | 1차는 문안 렌더 한 곳(#1)을 고쳤고, 변이는 렌더 앞 단계(어느 글을 고르나)라 범위 밖 | R5 |
| 2 | 높음 | 2시간 전 재검사 스캐너 = 실행 2,000행 `LIMIT`(순서 없음) 뒤에 「그날 처리함」 거름. 큰 여정 하나(같은 칸 2,000명+)가 행을 다 차지하면 다른 여정(다른 회사 포함)은 2시간 동안 검사 · 안내를 못 받고, 고친 문안은 검사를 못 받아 발송이 계속 미뤄진다 | `journey-pretest-notifier.ts:31-50 · 72-81` | 0604 | R12 점검표는 1024 신설 · 기계 범위 = 플래너만 | R12 |
| 3 | 중간 | 실행기 처리 예외 = 다음 실행 시각을 그대로 두고 오류 수만 올림 → 5분마다 상한 없이 다시 돌고 `error_log` 가 하루 288줄씩 끝없이 늘어남(실행 후보 맨 앞자리 차지) | `journey-executor.ts:276-300 · 230-257` | 0727 | R8 = 1024 신설 · 기계 범위 = 플래너만 | R8 |
| 4 | 중간 | 닫히지 않는 실행 셋 = 「이 발송 정지」 링크 · 번호 오류 자동 멈춤(둘 다 다시 켜도 되살리지 않음) · 끝낸 여정의 진행 중 실행. 영원히 `paused` · `active` 로 남아 「진행 중 고객」으로 셈 → 멈춘 여정 칸 고치기 잠김 · 갈림 여정 칸 넣기 · 빼기 잠김 · 지도 숫자 부풀림 | `journey-pause-handler.ts:211 · 309` · `journey-resume.ts:18`(되살림 사유 셋만) · `journey-executor.ts:1046-1062 · 1479-1486`(멈춘 채 전진) · `journey-builder.ts:1756-1762 · 1259 · 1925-1933` · `journey-lifecycle-map.ts:644` | 0523 끝내기 · 0526 자동 멈춤 · 1018 그날 정지 | R6 = 1024 신설 · 기계 범위 = 플래너만 | R6 |
| 5 | 높음 | 끝내기 = 지금 판만 · 멈추기 = 계보 전체. 「새 모양」으로 고친 여정을 끝내도 옛 판이 진행 중 고객에게 계속 보낸다. 화면은 「종료하면 발송이 멈추고」라고 약속 | `journey-builder.ts:1925-1933` vs `journey-lineage.ts:306-330` · `JourneyActionConfirmModal.tsx:167` | 1020(멈추기만 계보로 고침) | 뿌리 1번 = 새 규칙(계보 멈춤)을 생긴 자리에서만 고침 | R1 |
| 6 | 높음 | 재진입 워커(6시간마다 완료 고객 다시 넣기) = 진입 규칙 셋 없이 넣는다. ①상한(대량 진입 멈춤) 없음 · 1회 1,000명 ②첫 칸 보낼 시각(대기 · 시각 지정) 무시 = 지금 바로 ③작성자 범위(담당자 매장) 미적용 | `journey-reentry-worker.ts:105-139` vs 감시 `journey-trigger-watcher.ts:289-298 · 329 · 334-344 · 564` | 0523(그 뒤 0927 범위 · 0801 상한 원칙이 감시에만 들어감) | 같은 사실(누가 언제 들어오나)을 두 곳이 계산 · 1차는 감시 쪽만 봄 | R1 |
| 7 | 높음 | 날짜축(기준 날짜 D-N) 발송이 **하루 앞당겨진다**. DB 날짜 칸을 로컬 자정 시각으로 받아 UTC 날짜로 읽음 → 10/30 기준 D-0 이 10/29 · D-7 이 10/22. 연 반복은 해마다 하루씩 당겨짐 | `journey-anchor-scheduler.ts:104 · 124 · 141` · `send-time-util.ts:374-440` · 실행 확인 = 실제 함수에 DB 모양 날짜(10/30 00:00 KST)를 넣어 D-0 = 10/29 10:00 출력(로컬 · 프로세스 KST) · 서버 프로세스 KST = `send-usage-aggregation.ts:448` 0726 서버 실측 기록 | 0630 | 시험은 UTC 자정 날짜를 넣어 통과 · 같은 부류(DB 날짜 = 시각) 세 번째(0726 발송통계 · 1020 마지막 날) | 새 R16 |
| 8 | 높음 | 날짜축 시각 고르기에 21시가 있는데 발송 창은 21시 **전**까지 → 21시를 고르면 모든 단계가 다음 날 08시로 밀리고, 반복 없음 여정의 D-0 은 자정 자동 멈춤에 걸려 **안 나간다** | `DateAnchorJourneyBuilder.tsx:75`(8~21시) · `config/defaults.ts:307-312` · `journey-anchor-scheduler.ts:141-160 · 190` | 0630 | 화면 선택지와 발송 창을 대조한 점검 없음 | R1 |
| 9 | 중간 | AI 진단 추천 = 회사 단위 판정 · 회사 단위 요청 키. 담당자 B 는 A 의 여정 · 초안 때문에 그 구간 추천을 못 받고, 이유는 「만들어 둔 초안이 있어요. 켜기 전 점검에서 확인하고 켜 주세요」(B 목록 · 지도에 없는 초안) | `journey-opportunities.ts:546-555 · 598-605` · `routes/ai.ts:3493` · `JourneyDiagnosisPanel.tsx:179-197` vs 지도 `journey-lifecycle-map.ts:591` | 1009 추천 · 1023 D2(담당자 = 자기 여정)와 부딪힘 | 1차 F7~F9 는 지도 · 머리 요약 · 캐시 키만 보는 사람 범위로 바꿈 | R3 |
| 10 | 중간 | 죽은 주소 3 = `GET journeys/:id/preview-samples` · `PATCH journeys/:id/auto-reentry` · `POST journeys/variants/:id/track`(화면 · SDK 호출 0 · track 은 부를 때마다 클릭 · 전환을 올려 A/B 승자 판정을 바꿀 수 있음 · SDK 는 `/api/cdp/journey-variants/:id/track` 따로) | `routes/ai.ts:4030 · 4140 · 3979` · 전 패키지 grep 호출 0 | 0521~0523 | 같은 부류 세 번째(1023 여정 #13 · 1024 자동 마케팅 결함 13) · 지키는 기계 시험 없음 | 새 R15 |
| 11 | 낮음 | 영구 삭제 확인 창에 내부 표 이름(`journey_executions` · `journey_step_logs` · `journey_step_variants`)이 고객 화면에 그대로 | `JourneyActionConfirmModal.tsx:182-184` | 0523 | R11 시험 = 출처 · native dialog · 모델명만 | R11 |
| 12 | 낮음 | 시뮬레이션이 상한 · 하루 몫을 안 본다 → 「예상 발송 N건 · 비용」인데 실제는 대량 진입 자동 멈춤 · 문구 「실제 발송 때는 전체가 대상입니다」 | `journey-simulator.ts:81-100` | 0523 | 숫자 안내와 진입 규칙 대조 점검 없음 | R5 |

| 13 | 중간 | 가입 묶음 구매 판정(1019 B-1009-4)이 실행기 목표에만 있다. 지도 카드 문장은 매장 문 회사에 「같은 날 가입하고 산 고객은 환영 문자와 첫 구매 문자를 둘 다 받아요」(옛 동작) · 지도 「곧 마칠 예정」 숫자 · 조건 칸 「들어온 뒤 구매했나」는 옛 세 신호 | `journey-lifecycle-map.ts:279-287 · 329-363` · `journey-executor.ts:1606 · 1834` | 1019 | 판정을 고친 자리(실행기 목표)만 고침 · 같은 판정의 복사본 셋을 안 찾음 | R1 |
| 14 | 높음 | 여정 스팸 검사(켜기 · 2시간 전 재검사)가 검사 장애(시간 초과 · 통신사 결과 실패)를 「차단」으로 읽는다. 켜기 = 「통신사 차단: timeout」으로 막힘 · 재검사 = AI 재생성(1크레딧)으로 고객 문안을 바꾸거나 여정을 멈춤 | `journey-pretest-validator.ts:214-253 · 158-176` · `journey-pretest-notifier.ts:99-153` vs 공용 판정 `spam-test-queue.ts:977 spamVerdictOf` | 0526 · 0604 | R7 기계 시험 대상 뽑기 = `autoSpamTestWithRegenerate` 호출 파일만 · 여정은 낮은 층 함수(`getSpamTestBatchResults`)를 직접 불러 빠짐 | R7 |
| 15 | 중간 | 조건 칸 「고객 정보」 판정이 대상 조건 CT 밖. 검토 화면 칸 목록이 손 목록이고 실행기는 JS 문자열 비교 → 성별 「여성」으로 넣으면 DB 값 「F」와 영영 안 맞음(늘 미충족) · 생일 달 · 마지막 구매 뒤 지난 날은 판정 불가 | `JourneysPage.tsx:2195-2207` · `journey-condition.ts` vs `journey-condition-fields.ts` | 0521(조건 칸) · 1023(CT 는 대상 조건만) | 1차 #2 가 대상 조건(SQL)만 한 표로 모음 · 조건 칸(JS)은 다른 판정기라 안 봄 | R1 |
| 16 | 중간 | 입력 · 상태 오류 9곳이 일반 `Error` → 500 「여정 생성 실패」 같은 묶은 문구(사람이 이유를 모름) · 예: 지원 안 하는 시작 사건 · 회신번호 없음 · 켜진 여정 변이 수정 | `journey-builder.ts:300 · 303 · 306 · 372 · 1268` · `bandit-optimizer.ts:538 · 544 · 599` · `journey-ai-editor.ts:130` | 0521~0802 | 1차 #12 는 주소의 오류 매핑을 한 벌로 했지만 CT 가 던지는 오류 종류는 안 봄 | R10 |

11번 넓힘(덮음표 읽기) = 켜기 거절 문장에 내부 칸 이름(`anchor_date` · `delay_mode` · `target_hour_kst` · `condition_jsonb` · `within_days` 등 · `journey-builder.ts:792-980`) · A/B 변이 편집기(「Bandit · Thompson Sampling · Monte Carlo · Traffic Weight · Funnel」 · 표 이름 `kakao_templates.template_code` · 알림톡 변수 JSON 직접 입력 · 이모지 · `JourneyVariantsEditor.tsx`) · 통계 화면 「매트릭스 · Thompson Sampling posterior」 · 검토 화면 · 켜기 창 · 보관 창의 「영역 · 정합 · 의무」.

부수(결함 아님 · 기록) = 지도 주인 판정(`ownsOnlyOwnJourneys` · DB `user_type`)과 문 판정(`resolveOwnerScope` · 토큰)이 두 벌. 갈리는 값은 `system` 계정뿐이고 로그인 차단(`routes/auth.ts:295`)이라 결과는 같다.

## §2 왜 또 나왔나

- 12건 중 10건이 **0521~0727 옛 코드**(변이 · 재진입 · 끝내기 · 자동 멈춤 · 검사 · 재검사 · 날짜축 · 실행기 예외). 1차와 그 뒤 Codex 는 바뀐 줄만 봤다(뿌리 대장 「왜」 2번).
- R6 · R8 · R12 점검표는 1024 에 생겼고 기계 시험은 플래너만 덮는다 → 여정 워커 다섯(실행기 · 감시 · 재진입 · 날짜축 · 재검사)은 이 세 기준으로 한 번도 안 봤다.
- 나머지 2건은 새 규칙이 옛 코드와 부딪힌 자리(1020 계보 멈춤 ↔ 끝내기 · 1023 D2 ↔ 1009 추천).

## §3 처방 (결함마다 하나 · 뿌리마다 기계 시험)

| # | 처방 |
|---|---|
| 1 | 「이 칸이 실제로 보낼 수 있는 판 목록」 CT 하나(변이 있으면 변이마다 본문 · 채널 · 제목 · 알림톡 값을 칸 값과 병합 · 없으면 스냅샷). 실행기 고르기 · 켜기 검사 · 2시간 전 재검사가 이 목록만 돈다. 재검사에서 변이가 걸리면 자동 고치지 않고 여정을 멈추고 알린다(켜진 여정 변이는 사람이 못 고치는 칸이라 덜 보내는 방향) |
| 2 | 거름을 SQL 로: 그날 처리한 (여정 · 칸)은 `NOT EXISTS`(재검사 전 판은 예외) · (여정 · 칸)마다 한 행(`DISTINCT ON` · 가장 이른 발송) · `ORDER BY next_run_at` 뒤 `LIMIT` |
| 3 | 처리 예외 3회 = 그 실행 `failed` 로 닫고 사유 기록 · 운영 경보 1회(여정마다 쿨다운) · `error_log` 최근 20줄만 |
| 4 | 되살리지 않는 멈춤(그날 정지 · 번호 오류)은 `ended` + 사유로 바로 닫는다 · 끝내기는 진행 중 실행을 같은 문장에서 `ended`. 「진행 중」 = `active` + 되살릴 수 있는 `paused` 만 |
| 5 | 끝내기 = 계보 전체(멈추기와 같은 계보 잠금 · 같은 함수 모양) + #4 닫기 |
| 6 | 실행 넣기 CT 하나(상한 판정 · 첫 칸 보낼 시각 · 대조군 · 진입 합계). 재진입 워커는 후보만 뽑고(작성자 범위 조각 포함) 이 CT 로 넣는다. 날짜축 · 1회 발송 넣기도 같은 CT |
| 7 | 날짜축은 기준 날짜를 글자(`anchor_date::text`)로 읽고, 날짜 함수 셋(보낼 시각 · 사이클 끝 · 다음 기준일)은 `YYYY-MM-DD` 글자만 받게 타입을 바꾼다(호출부 전부 tsc 가 잡는다) |
| 8 | 시각 고르기 = 발송 창 안(8~20시 · 창 값을 서버가 내려 화면이 그린다) · 서버 저장도 같은 범위 검사(400) |
| 9 | 결정 D1(아래) |
| 10 | 세 주소 삭제(SDK 기록 길 `/api/cdp/journey-variants/:id/track` 은 그대로) |
| 11 | 「모든 단계 정의 · 진입한 고객 기록 · 발송 기록 · A/B 문안」 쉬운 말로 |
| 12 | 시뮬레이션이 상한 · 하루 몫을 같은 판정으로 읽어 「상한을 넘어 켜면 바로 멈춰요」 경고 · 문구 고침 |
| 13 | 「진입 뒤 구매」 판정 CT 하나(가입 묶음 포함) = 실행기 목표 · 조건 칸 · 지도 숫자가 같은 함수 · 카드 문장 = 그 판정 그대로(매장 문도 첫 구매 여정이 맞이) |
| 14 | 여정 검사 결과 = 공용 `spamVerdictOf`(통과 · 차단 · 검사 장애). 장애 = 켜기 「검사를 못 했어요 · 잠시 뒤 다시」 · 재검사 = 고치지 않고 다음 회차 · 같은 날 3번 장애면 멈추고 알림(상한) |
| 15 | 조건 칸 판정 = 대상 조건 CT 의 칸 규칙(성별 코드 · 생일 달 · 마지막 구매 뒤 지난 날) · 검토 화면 칸 목록 = CT 와 같은 목록(짝 시험) |
| 16 | 입력 오류 = `JourneyInputError`(400) · 상태 오류 = `JourneyStepGateError`(409) · 내부 불변식만 일반 `Error` |

### 결정 D1 (#9 · 추천 판정 범위)

| 안 | 내용 | 트레이드오프 |
|---|---|---|
| **A(추천)** | 판정 = 보는 사람 여정(담당자 = 자기 것) + 관리자가 만든 여정(회사 전체 고객 대상이라 겹치면 같은 고객에게 두 통) · 요청 키에 보는 사람 id · 관리자 여정이 막으면 「관리자가 켠 여정이 이 구간을 맡고 있어요」 | 담당자끼리 매장이 겹치면 같은 구간 여정이 둘 생길 수 있다(지금도 직접 만들기로는 가능 · 켜기 겹침 확인이 회사 전체로 잡는다) |
| B | 회사 단위 유지 · 문구만 「다른 담당자가 만든 여정이 이 구간을 맡고 있어요」 | 담당자는 그 구간 추천을 영영 못 받는다 · 요청 키가 회사 단위라 지운 초안도 다시 못 만든다 |

## §4 뿌리 대장 · 기계 시험

- **R15 죽은 주소(새 · 세 번째)** = 고객 쪽 라우터의 주소마다 화면 · SDK 호출이 있거나 면제(이유). 착수 첫 단계 = 전 라우터 측정 → 숫자 보고(여정 밖 죽은 주소가 나오면 같은 묶음에 닫을지 Harold 판단).
- **R16 DB 날짜 칸 = 글자(새 · 세 번째)** = 날짜 함수 입력 타입 = 글자 · DB 모양(로컬 자정) 입력 시험.
- **R1 실행 넣는 곳마다 같은 진입 규칙** = `INSERT INTO journey_executions` 가 있는 파일을 기계로 뽑아, 파일마다 상한 판정(`entryCapExceeded` 한 함수) · 작성자 범위 · 첫 칸 보낼 시각이 있는지 본다(짝 시험).
  넣기를 CT 하나로 모으는 길은 원문 계약 시험 다수를 깨고 넣는 곳마다 다른 잠금 · 트랜잭션을 한 함수로 묶어야 해 이번 묶음에서 택하지 않았다(구현 1025).
- **R6 여정 실행 상태** = 코드가 쓰는 `journey_executions.status` 값을 기계로 뽑아 「끝 · 되살림 · 진행」 분류표에 없으면 실패.
- R5 #1 · R8 #3 · R12 #2 = 짝 시험(변이 판 목록 = 검사 목록 = 발송 후보 · 3회 닫힘 · 큰 여정 + 작은 여정 둘 다 검사됨).
- R11 = 화면 글에 내부 표 이름(snake_case 표 이름) 0 · 착수 때 전 화면 측정.

### §4-1 구현 뒤 기계 시험이 더 찾은 것(1025)

| # | 결함 | 뿌리 | 처리 |
|---|---|---|---|
| 17 | 통계 화면 대조군 비교가 「진입 뒤 구매」를 네 번째로 따로 적음(「목표 판정과 동일 신호」라 적고 가입 묶음 빠짐 · `journey-stats.ts` 대조군 SQL) | R1 | `purchasedSinceEntrySql` 로 바꿈 |
| 18 | 호출 0 주소 네 번째 `PATCH journeys/:id/callback`(회신번호는 옵션 · 새 모양 길로만 바꾼다) | R15 | 삭제 |
| 19 | 날짜축 워커 두 곳의 상한 판정이 따로 적힘(같은 값이지만 다섯 번째 벌) | R1 | `entryCapExceeded` |
| 20 | 작업대 칸 진단 문장 · A/B 통계 표(칸 = 내부 id 앞 8자리 · α β 값)의 개발 용어 | R11 | 쉬운 말 · 칸 번호 |
| 21 | (Codex 1R) 원 문안 차단 + 고친 문안 검사 장애 동안 차단된 원 문안이 나갈 수 있음 · 상한 1,000 이상 재진입 넘침을 못 봄 · 감시와 재진입이 하루 몫을 함께 씀 · 변이 조회 실패 = 검사 안 한 칸 본문 · 끝낸 직후 재진입 · 날짜축 · 1회 발송 넣기 | R5 · R12 · R7 | 보류(0) · cap + 1 · 넣기 관문 `lockEntryIfActive` · 잠금 안 재셈 `dailyRoomInLock` · 조회 실패 = 처리 예외 |
| 22 | (Codex 2R) 재진입 후보 조회에 쓰지 않는 $1 바인드(#6 고치며 생김 · 매번 42P18) | 새 R17 | 자리표 당김 · 자리표 = 바인드 기계 시험 |

변이 확인 = 소스를 옛 결함 모양으로 되돌려 시험이 실패하는지 15건(R1 둘 · R3 · R6 둘 · R8 · R10 · R11 둘 · R12 · R15 · R16 · #14 · #15) 전부 잡음. R6 은 처음에 파일 단위라 같은 파일 다른 함수의 되돌림을 놓쳐 함수 단위로 고쳤다.

## §7 덮음표 (1025 · 파일 × 기준)

판정 기준 = R1 같은 사실 두 벌 · R3 범위 · R5 본 것 ≠ 나가는 것 · R6 닫히지 않는 상태 · R7 판정 못 함 · R8 상한 없는 재시도 · R11 화면 하한 · R12 LIMIT 뒤 거름 · R15 죽은 주소 · R16 DB 날짜.
기계 시험이 이미 덮는 기준(R2 · R4 · R10 · R13)은 칸에서 뺀다(시험 통과 = 증거).

| 묶음 | 파일 | 방법 | 나온 결함 |
|---|---|---|---|
| 주소 | `routes/ai.ts` 여정 주소 전부(3179~5253) · `journey-route` · `journey-access` · `owner-scope` | 정독 | 9 · 10 · 16 |
| 발송 · 진입 워커 | `journey-executor` · `journey-trigger-watcher` · `journey-reentry-worker` · `journey-anchor-scheduler` · `journey-pretest-notifier` · `journey-pretest-scan` · `journey-pretest-validator` · `journey-operation-release` | 정독(전 줄) | 1 · 2 · 3 · 4 · 6 · 7 · 8 · 14 |
| 상태 · 멈춤 · 계보 | `journey-pause-handler` · `journey-resume` · `journey-lineage` · `journey-reshape` · `journey-activation` · `journey-send-claim` · `journey-step-campaign` | 정독 | 4 · 5 |
| 만들기 · 고치기 | `journey-builder`(전 줄) · `journey-target-extractor`(전 줄) · `journey-draft-save` · `bandit-optimizer`(변이 쓰기) · `send-time-util`(날짜축) | 정독 | 1 · 7 · 11 · 16 |
| 지도 · 추천 · 숫자 | `journey-lifecycle-map`(전 줄) · `journey-opportunities`(진단 · 추천 키) · `one-line-ask`(여정) · `journey-simulator` | 정독 | 9 · 12 · 13 |
| 작은 CT | `journey-condition` · `journey-safety-filter` · `journey-step-limits` · `journey-intake-grace` · `journey-start-kind` · `journey-pause-reason` · `journey-entry-replace` · `journey-activation-cost` · `journey-ad-policy` · `journey-list-filter` · `journey-trigger-db` · `journey-condition-fields` | 정독 | 15 |
| 그 밖 백엔드 23 | `journey-ai-generator` · `journey-ai-editor` · `journey-interview(-ai)` · `journey-product(-create)` · `journey-attach` · `journey-graph` · `journey-identity-signals` · `journey-cdp-cursor` · `journey-entry-ledger` · `journey-purchase-ledger` · `journey-step-format` · `journey-step-edit-policy` · `journey-options-validator` · `journey-credit-forecast` · `journey-trigger-capability` · `journey-trigger-suggest` · `journey-simulator-core` · `journey-step-diagnosis` · `journey-stats` · `journey-points-trigger` · `journey-after-config` · `journey-message-render` | 기준 검사만(LIMIT 뒤 거름 · 상태 쓰기 · 일반 Error · 내부 이름 · DB 날짜) · 1020 V.3 · 1023 결함 0 Codex 범위 | 16(ai-editor) |
| 화면 정독 | `JourneysPage`(검토 화면 · 저장 · 조건 칸) · `JourneyVariantsEditor` · `JourneyActionConfirmModal` · `JourneyActivationConfirmModal`(켜기 · 겹침) · `JourneyDiagnosisPanel` · `JourneyWorkspace`(칸 도구) · `DateAnchorJourneyBuilder`(시각) · `useJourneyActions`(겹침) | 정독 | 1 · 8 · 9 · 11 · 15 |
| 화면 그 밖 37 | `components/journey/**` · `pages/Journey*.tsx` 나머지 | 기준 검사만(내부 이름 · 개발 용어 · 겹침 · 날짜 · 화면 호출 주소) | 11 |

덮음 = 백엔드 61 중 정독 38 · 기준 검사 23 / 화면 45 중 정독 8 · 기준 검사 37. **미검증 칸 = 기준 검사만 한 60개 파일의 R1 · R5 판정**(같은 사실을 따로 계산하는가 · 본 것과 나가는 것이 같은가는 패턴으로 못 잡는다). 이 칸은 「결함 0」이 아니라 미검증이다. 아래 §4 기계 시험이 R6 · R7 · R8 · R11 · R12 · R15 · R16 은 이 파일들까지 덮는다.

## §5 이번에 읽지 않은 범위 (정직 표기)

여정 생성 · 칸 수정 · 켜기 본문(`journey-builder.ts` 대부분) · 추출기(`journey-target-extractor.ts`) · 지도 · 통계 본문 · AI 생성 · 질문표 · 붙이기 · 새 모양 · 화면 작업대. 이 범위는 1020 V.3 · 1023 결함 0 의 주 범위(Codex 5R · 6R)다. 위 R6 · R1 · R15 · R16 기계 시험은 이 범위까지 덮는다.

## §6 배포 · 실측

- 다른 세션 작업 · 1025 렌더 검사 수정과 **한 번에** 푸시 · 배포(DDL 0).
- 배포 전 조회(읽기만) = 날짜축 실제 발송일 대조(`journey_anchor_dispatch.send_date` 와 `anchor_date - anchor_offset_days` 차이 · -1 = 하루 앞당김 실제 발생) · 반복 없음 여정만.
- 배포 뒤 실측 1건 = 시험 회사 날짜축 여정(기준 = 모레 · D-1 · 10시) → `journey_anchor_dispatch.send_date` = 내일.
- 배포 때 낼 것(메모 · 「배포 시작하자」 때 SCHEMA · information_schema 대조 뒤 명령 하나씩 · 지금은 내지 않는다):
  1. 날짜축 하루 앞당김 실제 발생 수(위 조회).
  2. 닫히지 않은 옛 실행 수 = 끝난 여정의 진행 중 · 멈춘 실행 · 그날 정지 · 번호 오류로 멈춘 실행(새 코드는 새로 생기는 것만 닫는다 · 옛 행 정리 SQL 은 수를 본 뒤).
  3. 칸 채널과 다른 채널의 A/B 변이 · 알림톡 칸의 변이 수(새 코드는 실행기가 칸 채널로 보낸다 · 수가 있으면 그 여정 담당자 안내).
  4. 배포 뒤 실측 = 위 날짜축 1건 + 재진입 여정 1건(첫 칸 보낼 시각 = next_run_at · 상한 넘으면 멈춤 사유).
