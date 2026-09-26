# 한줄로 소스 전수점검 장부 (2026-09-25 ~)

> 호출어 **한줄로 전수점검**. 이 문서가 점검 결과의 SoT다. 고치는 일은 여기서 하지 않는다: 건마다 별도 트랙 · Harold 승인 뒤 하나씩.
> 1차 탐색 후보(미검증 434건) = [2026-09-25-hanjul-source-audit-candidates.md](2026-09-25-hanjul-source-audit-candidates.md).

## 0. 목적과 방식

- **관점 6:** 속도 저해 · 숨은 결함 · 헛도는 작업 · 데이터 낭비 · 개선 여지(메모) · 올드한 디자인(메모)
- **순서(Harold 0925 승인):** ① 전수점검(읽기 전용, 코드 수정 0) → ② 운영 측정(읽기 전용 명령 하나씩) → ③ 점검 결과 + 측정값을 입력으로 브레인스토밍 → ④ 결함·개선 건마다 별도 트랙
- **점검 방식(Harold 0925 결정):** 에이전트 대량 투입을 멈추고 부분을 나눠 **직접 점검**한다. 장부의 "확정"은 내가 코드를 직접 읽어 확인한 것만.
- **부분 순서:** ① 발송·돈 핵심 → ② 고객사 격리·보안 → ③ 워커·주기 작업 → ④ 데이터 적재·보존 → ⑤ 나머지 백엔드 → ⑥ 프론트 성능·올드 디자인
- **범위:** packages/backend/src(비테스트 약 23.2만 줄) · packages/frontend/src(약 17만 줄) · sync-agent · sdk-js · pos-agent. flyer-frontend(한줄전단)는 제외.
- **올드 디자인 판정:** 흰 배경만으로는 올드 아님(서비스 화면 다수가 라이트 체계 · 0925 bg-white 사용 파일 278). 옛 단순 입력 양식 · 꾸밈 없는 기본 표 · native dialog · 모바일 대응 없음 · 자매 화면과 어긋난 옛 모양처럼 구체 표식이 있을 때만 메모.

## 1. 진행표

| 부분 | 상태 | 비고 |
|---|---|---|
| 1차 탐색 critical 16건 직접 확인 | 완료 0925 | 16건 모두 코드상 성립 · 같은 뿌리 묶으면 14건(§2) |
| ① 발송·돈 핵심 | 탐색·확인 완료 0926 · 수정 대기 | §2-2 · 확인된 결함 약 36건(부분 확인 1 · 조건부 3 포함) · 내 회귀 F22·F23만 수정 |
| ② 고객사 격리·보안 | 점검 완료 0926(직접) · 수정 대기 | §2-3 · 새 결함 3건(S2-01 발신프로필 조회 격리 · S2-02 비밀번호 변경 무제한 · S2-03 팝빌 키 선택) |
| ③ 워커·주기 작업 | 점검 완료 0926(직접) · 수정 대기 | §2-4 · S3-01 취소 큐 7일 매분 재집계 · S3-02 만료 대기 매분 전체 COUNT · S3-03 겹침 방지 없음(낮음) |
| ④ 데이터 적재·보존 | 점검 완료 0926(직접) · M-09 반영(로그성은 작다 · 스테이징 863MB 격상) · M-12 대기 | §2-5 · S4-01 로그성 14종 정리 장치 없음(낮음으로 조정) · S4-02 렌더 크롬 프로필 잔존(낮음) · 발견 1건은 §2-3 S2-04 |
| ⑤ 나머지 백엔드 | 점검 완료 0926(직접 · 위험 유형 전수 검색 방식) · 수정 대기 | §2-6 · S5-01 AI 문안마다 고객 전체 스캔 · S5-02 채널 분포 고객 id 전량 전송 · S5-03 전체 분석 고객 전량 메모리 · S5-04 타겟·DM 매장 범위 없음 · S5-05 광고에서 수신거부 제외 해제 가능(결정 재확인) · S5-06 쿼리 시간 상한 없음 |
| ⑥ 프론트 성능·올드 디자인 | 점검 완료 0926(직접) · 수정 대기 | §2-7 · S6-01 진행률 폴링 무한(예약·취소·화면 이탈) · S6-02 대시보드 청크 gzip 360KB · 톤 7갈래는 §4 메모 |
| 1차 후보 high·critical | 확인 완료 0926(직접) · 수정 대기 | §2-8 · 75건 중 원장 기존 판정 26 · 남은 49건 전부 판정(이미 수정 2 · 기존 ID 병합 7 · 새로 성립 37 · 부분 성립 3) + 확인 중 새 발견 1 |

## 2. 확정 결함 (코드 직접 확인)

> "확정" = 코드상 성립을 직접 확인했다는 뜻. 운영에서 실제로 일어났는지·몇 건인지는 §3 측정으로 확인한다.

| ID | 뿌리 | 위치 | 내용 | 측정 |
|---|---|---|---|---|
| C-01 | 수신거부 | routes/customers.ts:1416 | 고객 전체삭제(고객사 관리자·슈퍼관리자)가 `unsubscribes`를 회사 단위로 전부 지운다. 080 ARS 수신거부(unsubscribe-helper.ts:387 `'080_ars'`)도 이 표에 있고, 발송 대상 제외는 이 표로 한다(campaigns.ts:638·889·2234·3072·3084). 전체삭제 뒤 같은 번호를 다시 올리면 080 거부 번호가 대상에 들어간다 | M-01 |
| C-02 | SQL 조립 | routes/companies.ts:956·1407 | 매장 코드(`users.store_codes`)를 따옴표로만 감싸 SQL에 이어 붙인다. 저장(manage-users.ts:170-187)에 검증이 없고 store-scope.ts는 원본을 그대로 돌려준다. 고객사 관리자가 넣은 코드로 SQL 조작이 가능하고, 따옴표 하나만 들어가도 500 | |
| C-03 | SQL 조립 | routes/campaigns.ts:2199-2210 | 직접발송 `targetFilter`의 키를 `c.${key}`로 SQL에 그대로 넣는다. 키 이름에 amount·purchase·금액이 하나라도 있으면 실행된다. 로그인 사용자면 API로 닿는다 | |
| C-04 | SQL 조립 | routes/campaigns.ts:3383-3388 | 예약 문안 수정이 MySQL UPDATE를 작은따옴표 이중화만 하고 문자열로 조립한다(`mysqlQuery(updateQuery, [])`). 화면에서 여는 곳은 없고 API로만 닿는다. 백슬래시가 따옴표를 닫는지는 MySQL `sql_mode`에 달렸다 | M-02 |
| C-05 | 환불 누락 | routes/campaigns.ts:3126-3165 | 예약 수신자 개별 삭제가 큐 행을 지우고 `target_count`만 줄인다. 환불 호출이 없다. 환불 산식(refund-calc.ts:63)은 max(sent_count, 성공+실패+대기)라 적재 때 기록된 sent_count가 그대로면 미적재가 0으로 나와 정리 워커도 메우지 못한다 | |
| C-06 | 격리 누락 | routes/dm.ts:2636 · 2570 · 2680 | DM 원클릭 개선(quick-action)·자가진단·다음 섹션 제안이 `dm_pages`를 id만으로 조회하고, quick-action은 id만으로 UPDATE한다(dm-quick-action.ts:120·169·237·307·316 · dm-self-diagnosis.ts · dm-section-suggester.ts:76). 회사·소유 확인이 없다. 조건: 대상 DM id를 알아야 한다 | |
| C-07 | 발송 누락 | routes/ai.ts:1441 · utils/operator-recipients.ts:114-117 | AI 운영자 승인 발송이 preview-recipients 결과(ORDER BY 없이 LIMIT 10000)를 그대로 직접발송에 싣는다(AiOperatorPage.tsx:731-828). 대상이 1만 명을 넘으면 임의 1만 명만 나간다 | M-03 |
| C-08 | 이중 청구 | utils/ai-credit-tx.ts:95 | 월 리셋이 billing_type 구분 없이 음수 base를 다음 달 기본분에서 뺀다. 후불 초과분은 billing-issue.ts:536-549가 overage_credits로 현금 청구한다. 같은 초과분이 두 번 빠진다 | M-04 |
| C-09 | 격리 누락 | utils/customer-timeline.ts:791-803 | 고객 360 이메일 원천이 이메일 주소만으로 `email_events`를 찾고 회사 조건이 없다. 같은 주소가 다른 고객사 메일을 받은 적이 있으면 그 캠페인 이름·클릭 URL이 보인다 | |
| C-10 | 환불 누락 | utils/direct-send-worker.ts:365-371 · campaign-lifecycle.ts:242-243 | 예약 직접발송을 적재 도중 취소하면 취소는 그 순간 큐 대기 행만 환불하고, 워커는 취소를 감지하면 미적재분 환불 없이 끝난다. cancelled는 정리 워커 대상 밖(campaign-sweep-scope.ts:26). 선차감된 미적재분이 환불되지 않는다 | |
| C-11 | 복구 없음 | utils/direct-send-worker.ts:281 | 적재 중 서버가 재시작되면 `send_phase='processing'`을 되돌리는 코드가 없다(저장소 grep 1곳 · SIGTERM 처리도 없음). 워커는 queued만 집는다. 나머지 미발송 · 미적재분 미환불 · 화면 "발송 중" 고정 | M-05 |
| C-12 | 적재 누락 | utils/cdp-idempotency.ts:26 · 58-63 | 카페24 웹훅 멱등 키에 `event_no`를 전송 고유값으로 쓴다. 그런데 cafe24-client.ts:753-756은 event_no를 이벤트 종류 번호로 쓴다. 같은 종류 웹훅은 회사마다 첫 1건 뒤 전부 duplicate로 처리 없이 반환된다(routes/cafe24.ts ON CONFLICT DO NOTHING) | M-06 |
| C-13 | SQL 조립 | utils/enabled-fields.ts:105-109 · 492 | `custom_fields` 키(jsonb_object_keys로 수집 · 검증 없음)를 SQL 문자열에 그대로 넣는다. CDP identify(cdp.ts:223-239 → cdp-identity.ts:411)가 외부에서 온 키를 그대로 병합한다. 결과가 고객DB 현황 응답으로 나간다 | |
| C-14 | 결제 위조 | utils/inicis-client.ts:239 | 결제 승인 호출 주소(authUrl)를 콜백 본문 값 그대로 호출하고 주소 검사가 없다. 응답 resultCode='0000'이면 승인이고, 금액 대조(payment-processor.ts:137)도 그 응답의 totPrice와 한다. 콜백 경로(payments.ts `/inicis/return`)는 로그인이 없다 | M-07 |

**같은 뿌리 묶음(고칠 때 전수 grep 대상):** SQL 문자열 조립 C-02·03·04·13 · 고객사 격리 누락 C-06·09 · 환불 누락 C-05·10·11.

### 2-1. 수정 기록 (2026-09-25 밤 · Harold 지시 「크리티컬 전체 한 번에 수정 → Codex」 · 미배포)

| ID | 수정 | 테스트 |
|---|---|---|
| C-14 | inicis-client.ts `isTrustedInicisUrl`(https + 호스트 `.inicis.com`) · 승인·망취소 둘 다 검사 · 센터 코드 불일치는 로그만(매뉴얼에 경로 전체 없음) | inicis-url-guard 7 |
| C-02 | store-scope.ts `buildCustomerStoreFilterLiteral`(pg escapeLiteral) · companies.ts 2곳 | store-scope +3 |
| C-13 | safe-field-name.ts `customFieldRef`(escapeLiteral) · enabled-fields 2곳 · services/ai.ts 1곳. 나머지 조립 5곳은 화이트리스트(custom_1~15·FIELD_MAP) 통과 키라 대상 아님, admin.ts:3597은 내부 표(standard_fields) 키 | sql-assembly-invariants 6 |
| C-03 | 금액필터 키 = 표준 필드 맵 숫자 컬럼만 · 모르면 400(건너뛰면 걸러야 할 수신자까지 발송) | 〃 |
| C-04 | 예약 문안 수정 MySQL UPDATE를 `?` 자리표시자로. 같은 형태 전수 grep = 이 1곳뿐 | 〃 |
| C-06 | dm.ts 3라우트 `canAccessDm` 가드. 가드 없는 나머지 :id 라우트 13곳은 회사 조건 CT 경유라 대상 아님 | tenant-isolation-invariants 4 |
| C-09 | 고객 360 이메일 = email_campaigns INNER JOIN + company_id(SCHEMA 0903 information_schema 실측 컬럼) | 〃 |
| C-05 | 수신자 삭제 시 sent_count를 지운 문자 행 수만큼 감소 → 선불 sweeper가 발송 뒤 미적재로 환불 · 마지막 1명 삭제는 400(산식이 처리 0이면 환불 안 함 → 예약 취소로) | 없음(라우트) |
| C-08 | 음수 상계는 billing_type='prepaid'만 | ai-credit-reset-carry 4 |
| C-10 | 워커 루프 취소 감지 = break → 종결 블록(NOT_LOADED) + 취소 분기 CANCEL 정산(적재 수 − 남은 행) · 취소된 queued도 집음 | direct-send-worker-cancel-recover 7 |
| C-11 | 10분 넘게 멈춘 processing = recover 모드 재선점 · 적재 없이 MySQL 실측(생성·예약월 로그)으로 종결 · 이미 취소면 NOT_LOADED 생략 + CANCEL 목표 = 차감 − 남은 행 | 〃 |
| C-12 | 멱등 키 전송 고유값에서 `event_no` 제외 | cdp-idempotency-cafe24 4 · verify 스크립트 정정 |
| C-01 | 전체삭제가 unsubscribes를 지우지 않음 · 확인 창 문구 2곳 정정(「수신거부 목록은 그대로 남습니다」) | 없음 |
| C-07 | 결함(조용한 잘림)만 닫음: 미리보기가 실제 대상 수를 싣고 화면은 초과면 발송 거부. **근본(서버 적재 전환)은 추가 과제 A-01** | 없음 |

**Codex 1R(adversarial · high 5) 처리 — 같은 뿌리 판정:** 지적 1·3·4·5는 「취소·삭제 환불을 원인별 항아리에 나눠 지급 → 중단·재시도·순서에 따라 합이 어긋남」 한 뿌리. 건별로 때우지 않고 구조를 바꿨다.
- `prepaidRefund` keepCount 옵션 = 캠페인 전체 기준 목표(차감 − 남는 건 · refund-calc 무료 규칙) · 모든 원인 누적과 비교 · 기록은 넘긴 원인 키. 테스트 prepaid-keep-count 6.
- 워커 취소 분기 = 큐 삭제 → keepCount 정산 → 성공해야만 sent 표시(실패 시 processing 유지 → recover 재정산 · 재시도 의무 기록 제거). 이미 취소면 NOT_LOADED 생략(선점 시 + 환불 직전 재조회).
- 수신자 삭제 = 삭제 직후 keepCount(NOT_LOADED 키) 즉시 환불 → 뒤이은 취소와 합이 차감에 맞음.
- 지적 2(크레딧): C-08과 같은 뿌리(옛 환불이 초과분을 purchased로 넣고 다음 달 상계로 상쇄하던 구조). 비선불·미청구 초과분 환불 = 부채 취소 · 같은 주기면 base 되메움 · 리셋 지났으면 크레딧 가산 없음. 테스트 +3.
- 남는 위험(기록): 취소는 큐 삭제 뒤 상태를 바꾼다(campaign-lifecycle 292→396행). 그 몇 초 안에 recover가 같은 캠페인 적재 수를 재면 취소가 지운 몫을 미적재로 한 번 더 환불할 수 있다(멈춘 캠페인 + 그 순간 사용자 취소가 겹칠 때만).

**Codex 2R(adversarial · 2라운드 상한 도달 · high 3 미처리 → Harold 보고):**
- R2-1 전체 목표 정산(keepCount)과 원인별 지급(NOT_LOADED·FAIL)이 섞여 과다 지급 가능 — ①위 「남는 위험」과 같은 경로(취소가 삭제 뒤 상태 기록 → recover가 그 틈에 실측) ②취소 뒤 진행 중이던 결과 동기화의 FAIL 지급과 겹침. 뿌리 = 환불 경로마다 목표 기준이 다름 → 전 경로 목표 통일은 별도 트랙.
- R2-2 워커 취소 분기의 MySQL 큐 삭제가 예외를 던지면 바깥 catch가 send_phase='failed'로 바꿔(direct-send-worker 306~311행 확인) recover가 다시 보지 않는다 → 취소 분기 전체를 한 오류 경계로 묶고 실패 시 processing 유지(소규모).
- R2-3 수신자 삭제 환불 실패 시 경보만 남고 재시도 의무가 없다 → 뒤이어 취소하면 삭제분 영구 미환불. retryPendingRefunds는 상태와 무관하게 refundPending을 다시 도므로(127행) 의무 기록에 keepCount를 싣고 재시도가 keepCount로 부르게 하면 닫힌다(소규모).

**2R 처리(Harold 0926 새벽 「R2-2·R2-3 고치고 3R 1회 · R2-1 별도 트랙」):**
- R2-2 → 워커 취소 종결(큐 삭제 → 전체 목표 정산 → sent 표시)을 한 try로 묶고 실패 시 processing 유지 · 바깥 최후 안전망은 취소 캠페인을 failed로 바꾸지 않음(`status IS DISTINCT FROM 'cancelled'`).
- R2-3 → 수신자 삭제 = 캠페인 단위 잠금 → **삭제 뒤 상태 기준 환불 먼저** → 성공해야 큐 삭제(환불 실패면 503 · 아무것도 지우지 않음). 환불 뒤 삭제 실패는 경보(그 번호 발송 가능 · 고객 쪽 이득).
- Codex 3R(high 1) = R2-3 첫 구현이 advisory 잠금 연결을 쥔 채 prepaidRefund가 연결을 또 빌려 풀 고갈 가능 → 기존 CT `inflight-lock`(프로세스 안 · pm2 fork 1개 전제 · DM·이메일이 이미 사용)으로 교체 · DB 연결을 쥐지 않음. **이 교체분은 4R 미실행**(Harold 승인 범위 = 3R 1회).
- 테스트: recipient-delete-refund 5 · direct-send-worker-cancel-recover 9 · prepaid-keep-count 6 · 전체 373파일 5,723건 · tsc 0 · frontend build:safe 통과(산출물 문구 반영 확인).

**추가 과제 A-04 환불 목표 기준 통일(R2-1 · 별도 트랙):** 취소·삭제 정산은 캠페인 전체 목표(keepCount · 모든 원인 누적과 비교)인데 cancelCampaign(CANCEL)·sweeper(NOT_LOADED·FAIL)·워커 미적재는 원인별 누적이라, 순서가 엇갈리면 과다 지급이 남는다(취소가 큐 삭제 뒤 상태를 기록하는 틈 · 이미 일부 발송된 예약 취소 뒤 결과 동기화의 FAIL 지급). 전 경로를 같은 목표 기준으로 맞추는 설계가 필요.

**배포 영향(측정 필요):** C-10·C-11로 배포 직후 과거에 멈춘 캠페인(`queued`+취소 · 10분 넘은 `processing`)이 자동 정리·환불된다. 배포 전에 대상 수를 잰다(M-08).

**추가 과제(범위 밖 · 기록만):**
- A-01 AI 운영자 승인 발송을 서버 적재(buildSendableStagingInsertSql → direct-send commit)로 전환 · commit이 sendType·캠페인명을 받게.
- A-02 예약 수신자 삭제의 excluded_phones 경로(큐 적재 전): 직접발송 staging 워커·코어가 excluded_phones를 읽지 않는다(grep 0) → 적재 전 삭제한 번호가 그대로 발송될 수 있고 target_count만 줄어 미적재 환불 산식도 어긋난다. 미검증(코드 확인만) · AI 캠페인 적재 경로는 미확인.
- A-03 결제 콜백이 남의 pending 주문을 failed로 뒤집는 문제(B-0902-2 추가 과제② 기등재).

## 2-2. 부분 ① 발송·돈 (2026-09-26 · Harold 승인 「에이전트 16개까지 · 에이전트 탐색 + 직접 확정」)

- 대상 92파일 · 약 4.6만 줄(발송·차감·환불·정산·충전·카카오·예약·대행·결과 동기화). 1차 탐색에서 69파일이 이미 읽혀 있어, 에이전트 14개 = 미독 청크 2 + 흐름 추적 6 + 횡단 6(워크플로 `wf_d2ad0d24-907`).
- **1차 후보 중 부분 ① high 11건 — 직접 코드 확인(0926):**

| ID | 위치 | 확인 결과 |
|---|---|---|
| S1-H01 | routes/billing.ts:2042 | 성립. 수량 조정 DELETE가 발행 반영(applied) 여부를 안 본다 → 되돌린 뒤 재조정하면 기준 수량이 틀어져 재발행 수량 오차(슈퍼관리자 정산 화면) |
| S1-H02 | routes/manage-callbacks.ts:158-180 | 성립. PUT /:id가 POST·DELETE와 달리 자체등록 허용 검사·정규화·중복·회선 상한 없이 phone을 덮어쓴다 → API로 등록 안 된 번호로 바꿔 발송 가능(발신번호 사전등록 우회) · 화면은 이 API를 안 부름 |
| S1-H03 | routes/agency-send.ts:341 | 성립(속도). 원스텝 미리보기·확정이 업로드 엑셀을 요청 경로에서 동기 파싱 → 큰 파일이면 단일 프로세스가 그동안 멈춤. 처리 시간 미측정 |
| S1-H04 | routes/agency-send.ts:584 | 성립(속도·용량). 재접수용 수신자 목록 SELECT에 LIMIT 없음 → 큰 명단 전량 JSON |
| S1-H05 | routes/alimtalk.ts:1670-1690 | 성립. 템플릿 수정이 PG를 COALESCE로만 갱신 → 지운 강조 타이틀·대표링크·부가정보가 PG에 남아 발송에 실린다 |
| S1-H06 | routes/campaigns.ts:451 | 성립. 담당자 테스트 발송의 브랜드 행이 app_etc1 = testBillId('test' 아님) → 테스트 청구 집계·테스트 통계에서 빠짐 |
| S1-H07 | routes/campaigns.ts:957-990 | 성립(코드). 캠페인 발송 중복 방지가 조회 뒤 삽입(잠금·선점 없음) → 동시 요청 둘 다 통과 가능. **campaign_runs 유일 제약 유무 미확인**(SCHEMA에 제약 기재 없음) — 있으면 두 번째는 500으로 끝난다. **→ 0926 수정: 캠페인 발송 시작 잠금(§2-10 F09 행)** |
| S1-H08 | routes/campaigns.ts:1662 | 성립. /direct-send/stage 적재분이 확인 창 취소·commit 실패 시 정리되지 않음(정리 DELETE는 commit·워커·대행·플래너 경로뿐) → 전화번호·이름 행 무기한 누적 |
| S1-H09 | routes/spam-filter.ts:23 | 성립(코드). SPAM_APP_TOKEN 미설정이면 소스의 기본 토큰이 인증 → 테스트폰 등록·결과 위조. **운영 ENV 설정 여부 미확인** · 처방(기본값 제거 · 미설정이면 거부)은 어느 쪽이든 같다 |
| S1-H10 | utils/alimtalk-jobs.ts:240-248 | 성립. 검수 폴링 ORDER BY 없이 LIMIT 100 + IMC 오류 행 last_synced_at 미갱신 → 검수중 템플릿이 밀릴 수 있음 |
| S1-H11 | utils/agency-send-worker.ts:369-371 | 성립 · **기등재 B-0823-1**(스팸 검사 실패·시간초과를 통과로 읽음) 그대로 |

- **에이전트 14개 결과(0926 · critical 7 · high 42 · minor 140) — 직접 확인 판정.** 상세(시나리오·근거) = [부록](2026-09-26-hanjul-source-audit-sec1-findings.md). 중복은 한 줄로 묶었다.

| 판정 | ID | 요약 |
|---|---|---|
| **수정 완료(내 회귀)** | F22·F23 | 0925 C-05 수신자 삭제가 적재 중(preparing·queued·processing) 캠페인에서 미적재분까지 환불 → 적재 중 삭제 409로 차단(0926) · 테스트 추가 |
| 성립 · 돈 | F01·F04 | 직접발송 알림톡이 LMS 단가로 선불 차감(Dashboard.tsx:626이 알림톡 msgType을 'LMS'로 강제 → 서버가 그 유형으로 차감). **0926 한줄로 V2 재확인(직접 · 코드):** ①차감 = `resolveRefundAxes`(billing-types.ts:147)에 알림톡 분기가 없어 문자 유형 축 · direct-send-core.ts:100 주석이 "alimtalk/sms=message_type"을 계약으로 적었지만 결정 기록은 없다(0817 RCS 설계서 §10 "의도 미확인 · 돈 축이라 실측 없이 건드리지 않았다") ②환불 = 정산 스위퍼(mysql-refund-sweeper.ts:237~329)는 차감 원장 단가로 **실패·미적재만** 환불하고 카카오 성공분의 단가 차액을 돌려주는 경로가 없다(cost_per_kakao는 설정·표시에서만 읽힌다) ③같은 부류 경로 전수 = 알림톡 창 `/direct-send/commit`(LMS 고정) · 직접 타겟 `/direct-send`(campaigns.ts:2566 · 화면 유형) · 마케팅 플래너(planner-executor.ts:730 · LMS 고정) · **자동발송 알림톡(auto-campaign-worker.ts:856 · `ac.message_type` · 캠페인 행에 send_channel을 안 적어 auto_campaigns.channel로만 식별)** · 정상 = 여정(journey-executor.ts:1025 KAKAO). 후불은 청구서가 SMSQ `K`를 KAKAO 단가로 매긴다 → **선불만 알림톡이 문자 단가로 확정된다.** 요금제 무료 제공도 알림톡 몫이 아니라 문자 몫이 깎인다. 대체 발송(카카오 실패 → 문자)은 문자 단가가 맞으므로 정확한 과다액 = 카카오 성공 × (차감 단가 − 알림톡 단가). 운영 영향 = M-27 |
| 성립 · 돈 | F05·F06·F11 | 여정 발송 선불 차감(reference 'journey')에 환불 경로 없음 → 통신사 실패분 영구 과금(journey-executor에 prepaidRefund 0 · sweeper는 campaign만) |
| 성립 · 돈 | F07 | 후불 청구 집계가 여정 발송을 담지 않음(send-usage-aggregation에 journey 0) → 후불 여정 무료 |
| 성립 · 돈 | F02·F37 | 직접발송 워커 적재 루프 밖(브랜드 preflight · 테이블 조회 · 정제 · 종결 UPDATE)의 예외 → 바깥 catch가 failed로 굳혀 선차감 미환불(B-0727-1 잔여). 취소 캠페인은 0925 R2-2로 제외됨 |
| 성립 · 돈 | F09 | AI 캠페인 발송 catch가 적재 여부와 무관하게 status='failed' → 적재된 예약분은 취소 게이트에서 빠진 채 예약 시각에 발송 · "자동 환불" 안내 |
| 성립 · 돈 | F10·F31·F32 | 대행 취소(queueOnly)가 상태를 안 바꿔 적재 워커가 계속 적재 · 뒤 조각 환불 부족 · 적재 전 취소는 "이미 발송"으로 거절되고 예약이 그대로 나감(campaignMayHaveSent가 queued도 참) |
| 성립 · 돈 | F15·F17 | 테스트 발송 환불이 고정 zero-uuid + TEST 누적 항아리 → 회사별 두 번째 실패부터 환불 0원 |
| 성립 · 돈 | F30 | 유료 스팸 검사가 테스트 문자 적재 실패 시 선불 차감을 되돌리지 않음(spam-filter.ts prepaidRefund import만) |
| 성립 · 돈 | F36 | 재대조 워커가 현재 라인 기준 집계로 sent_count를 하향 덮어씀 → 라인 재배정 캠페인은 sweeper가 과환불 |
| 성립 · 돈 | F38 | /direct-send/stage가 커밋된 stagingId에도 덧붙임 허용 + 워커 청크 LIMIT이 total을 넘을 수 있음 → API로 차감 없는 발송 가능 |
| 성립 · 돈 | F14 | 최소과금 일괄 발행 대상 조회에 해지·수동 정산 조건 없음 |
| 성립 · 돈 | F49 | 자동 스팸 검사(auto_ai)가 선불은 무료(skipPrepaid)인데 후불 정산은 청구 |
| 성립 · 조건부 | F34 | 달 중간 선불↔후불 전환 시 그 달 청구 이중·누락(발행 시점 billing_type 하나로 판정) |
| 성립 · 조건부 | F08 | AI 캠페인 차감 커밋 뒤 첫 적재 전 프로세스 중단 시 복구 경로 없음 |
| 성립(코드) · 영향은 이니시스 동작에 달림 | F03·F25 | 결제 리턴 콜백 재전송 시 결제 상태를 보지 않고 재승인 → 실패면 망취소 → 충전은 남고 카드 대금만 취소될 수 있음 |
| 부분 확인 | F12 | 카카오 실패 대체발송(k_oriseq 자식행) 집계·환불 단가 — 매뉴얼·코드 대조를 끝까지 하지 못함 |
| **수정 완료 0926** · 법·발송 | F43·F44 | 분할발송 시각 계산이 자정을 넘긴 회차를 이월하지 않음(21시 이후만 처리) → 광고 문자 00~07시 발송 |
| **수정 완료 0926** · 법·발송 | F20 | 동기 /direct-send 경로에 야간 광고 차단 없음(campaigns.ts에 isSendableHourKst 호출 0) |
| 성립 · 발송 | F19 | 대량 직접발송 commit이 개별 회신번호 모드면 등록 여부 검사를 건너뜀 |
| 성립 · 발송 | F24 | 예약 문안 수정이 적재 전·중 직접발송에 반영 안 됨(워커는 send_config.message 스냅샷) → 옛 문안 발송 |
| 성립 · 발송 | F35 | 예약 시각이 지난 뒤(상태 전환 전) 취소 허용(isGhostSchedule 계산만) → 나간 분 후불 청구 누락 등 |
| 성립 · 발송 | F40·F41 | 여정 문자 적재 반환값 무시 → 적재 실패도 발송 기록·차감 |
| 성립 · 발송 | F45·F46·F47·F48 | 스팸 검사 큐: active 1건이면 stale 정리 도달 불가(큐 전체 정지) · 시간 초과를 등록 시각 기준으로 재 거짓 BLOCKED · 판정 대기 통신사를 버려 한 곳만 통과해도 pass |
| 성립 · 격리 | F27 | 발송내역 조회(/campaigns/:id/messages)가 캠페인 소유 확인 없이 계속 조회 → 라인 공유 시 다른 회사 수신번호·본문(대상 UUID를 알아야 함) |
| 성립 · 조회 | F26 | 발송결과 상세·내역·엑셀이 당월·전월 이력만 봄 → 두 달 이전 캠페인 0건 |
| 성립 · 속도 | F21·F28·F39 | 예약 수신자 목록 페이지마다 전 대기 행 실체화 · 내역 CSV 청크마다 전체 UNION 재정렬 · 여정 실행기 5분 100건 전사 공유 |
| 성립 · 헛도는 작업 | F13·F42 | 학습 누적이 클릭 0 캠페인을 24시간 동안 30초마다 재선택해 cdp_events 전수 COUNT |
| 기존 확인분과 동일 | F16=S1-H06 · F18=S1-H08 · F29=S1-H09 · F33=S1-H11(B-0823-1) | |


- **0926 수정(Harold 승인 「야간 광고 2건 먼저」):** F43·F44 = `calcSplitSendTime`을 발송 가능 시간 안에서만 흐르는 계산으로 교체(KST 수학 · 서버 시간대 무관 · 21시 전 기준 이월은 옛 결과와 같음 · 달라진 점 = 새벽에 떨어지던 회차 이월, 기준 시각이 창 밖이면 첫 회차 08:00(옛 22시 기준 → 09시 · 새벽 기준 → 그대로)). 테스트 send-time-util +4. F20 = 판정을 CT `nightAdRestrictionMessage`(autosend-policy)로 올려 직접발송 코어·동기 /direct-send 공용 · 동기 경로는 차감 전 400. 테스트 night-ad-restriction 7. 전체 374파일 5,735건 · tsc 0. Codex 미실행(발송 시각 경로 · 돈·DB 경로 아님).
- **0926 Harold 지시: 이후 점검은 에이전트 금지 · 직접 확인.**

## 2-3. 부분 ② 고객사 격리·보안 (2026-09-26 · 에이전트 없이 직접 점검)

**본 범위와 방법**
- 라우트 인증 전수: routes 75파일마다 라우터 단 인증·엔드포인트별 인증 집계 → 인증 없는 11파일·일부 누락 3파일(mms-images·auth·spam-filter)을 하나씩 읽음.
- id 단독 쿼리(IDOR) 전수: routes에서 회사 조건 없이 `WHERE id = $1`인 80곳을 핸들러마다 앞선 소유 확인과 대조. utils는 고객사 테이블을 id만으로 읽는 16파일의 라우트 호출 경로 확인.
- SQL 조립 전수: 정렬·LIMIT·컬럼 자리에 문자열로 들어가는 곳(ai.ts·campaigns.ts·results.ts·customer-filter·admin.ts) 출처 확인.
- 공개 토큰 라우트(충전 승인·대행 승인·여정 정지·청구서·아웃리치·단축 URL·마케팅 진단) · 웹훅(알림톡·팝빌·자사몰) · 내부 알림 · SSRF(사용자 주소로 서버가 요청) · 업로드 경로 탈출 · 인증 미들웨어(서명·세션·권한).

**새로 확인된 결함**

| ID | 위치 | 판정 |
|---|---|---|
| S2-01 | routes/alimtalk.ts:850 · 1077 | 성립. 발신프로필 단건 조회(`GET /senders/:id`)와 브랜드 타기팅 확인(`GET /senders/:id/brand-targeting-check`)이 회사 조건 없이 id로 읽는다 → 로그인한 다른 회사가 발신키(profile_key)·080 인증번호를 읽고 그 키로 IMC 조회. 대상 UUID를 알아야 닿음. 같은 파일의 수정 라우트는 슈퍼관리자 전용·템플릿 라우트는 requireTemplateAccess로 안전 |
| S2-02 | routes/auth.ts:689 | 성립(낮음). `/change-password`가 로그인·요청 제한 없이 userId + 현재 비밀번호만으로 변경 → 알려진 userId에 대한 비밀번호 대입. userId가 UUID라 실노출은 좁다 |
| S2-03 | routes/popbill-webhook.ts:25 | 설계상 선택(낮음). POPBILL_WEBHOOK_API_KEY가 없으면 검증 없이 받음(방화벽 화이트리스트 의존 · 운영 ENV·방화벽 미확인). 할 수 있는 일 = 세금계산서 상태 재확인 트리거 정도 |
| S2-04 | middlewares/auth.ts:100-108 | 성립(중간 · 부분 ④ 중 발견). API 요청이 5분 넘게 간격을 두고 오면 세션 만료를 **회사 설정과 무관하게 지금+30분**으로 되돌린다. 회사 설정(슈퍼관리자 화면 5~480분 · `companies.session_timeout_minutes`)은 로그인과 연장 버튼(`/auth/extend-session`) 때만 쓰인다 → 설정이 30분보다 긴 회사도 API 호출 없이 30분이 지나면 서버가 끊는다. 프론트 타이머(hooks/useSessionTimeout.ts)는 마우스·키 입력만으로 연장하고 서버에 알리지 않아, 긴 글을 쓰는 동안 서버만 만료되고 저장 순간 강제 로그아웃될 수 있다. 화면별 주기 호출(폴링)이 있으면 가려진다(미확인) |
| S2-05 | utils/session-manager.ts:104 | 성립(보안·낭비 · M-14·M-15 중 발견). 로그인할 때마다 JWT **원문**을 `user_sessions.session_token`에 저장하는데 이 값을 읽는 코드가 0곳이다(인증은 세션 id로 대조). DB가 새면 유효한 로그인 토큰(24시간)이 그대로 나간다. 인덱스 15MB와 행 폭(46MB · 2.2만 행)의 원인. 처방 = 저장 중단 + 인덱스 삭제. ⛔ **0926 배포 전 발견(M-19): 이 컬럼은 NOT NULL에 더해 UNIQUE(`user_sessions_session_token_key`)다** — 처음 설계대로 빈 문자열을 넣었으면 두 번째 로그인부터 23505로 **150개 업체 로그인이 전부 막혔다.** M-14가 유일 인덱스를 빼고 봐서 놓쳤다(값을 바꾸는 쓰기는 그 컬럼의 제약 전수부터 · 메모리 교훈 재발). 정정 = **세션 id를 넣는다**(세션마다 유일 · 서명된 JWT 없이 인증 불가). 한줄전단(같은 PG)은 user_sessions를 id로만 읽고 session_token을 쓰지 않는다(0926 hanjulDM 코드 확인). 테스트 = 세션 id 저장 + 세션마다 값이 다름. 기존 행의 토큰은 24시간 안에 만료되므로 운영 UPDATE는 하지 않는다 |

**확인했고 문제없던 것:** sync(API 키 미들웨어 전역) · mms-images 공개 조회(UUID 파일명 · 경로 탈출 차단) · register-super-admin(슈퍼관리자 1명 이상이면 차단) · 슈퍼관리자 TOTP·초기 비밀번호(단명 서명 토큰) · 토큰 링크 4종(JWT 서명+만료 또는 1회성 랜덤 토큰 + 요청 제한) · 알림톡 웹훅(HMAC) · 내부 알림(localhost · trust proxy loopback) · SSRF(임의 주소는 사설 주소 차단 · 자사몰 몰 ID 정규식 · 날씨 고정 주소 · **0926 정정: DM 브랜드 추출 `extractBrandFromUrl`은 가드를 안 탄다 = B-0824-2 Open · §2-8 R1-28**) · 업로드 원본 파일명은 메타데이터로만 · 인증 미들웨어(서명 · sessionId 필수 · 세션 활성·만료 대조 · jsonwebtoken 9.0.3은 none 거절) · SQL 조립(정렬 화이트리스트 · 숫자 변환 · customer-filter 필드 화이트리스트).
**죽은 코드:** routes/results.ts `smsUnionSelect`(정렬 문자열 조립 · 호출 0).
**부분 ①에서 이미 잡힌 격리·보안 건(중복 제외):** F27 발송내역 소유 확인 · S1-H02 발신번호 PUT · S1-H09 스팸 토큰 기본값.

## 2-4. 부분 ③ 워커·주기 작업 (2026-09-26 · 직접 점검)

**기동 워커 전수 = app.ts 43개.** 주기: 3초(스팸 검사 큐) · 5초(직접발송) · 30초(선불 정리 · SNS 게시) · 1분(자동발송 · 대행 메일 · 예약 정리 · 취소 큐 정리 · 만료 대기 정리 · 이메일 정리 · DM 추첨) · 5~10분(결과 재대조 · 대행 · 충전 대조 · 여정 사전검사 · 템플릿 매핑 · 무료 제공 · 웹훅 재시도 · 프로필 재계산 · 모니터 · 세금계산서 · 플래너 · 아웃리치 · 결제 적재 감시) · 30분~24시간(나머지). 겹침 방지가 없는 18개 중 일·시간 단위 13개는 겹칠 일이 없고, 세금계산서는 발행 함수 안 잠금으로 막힘(0730 Codex 5R).

| ID | 위치 | 판정 |
|---|---|---|
| S3-01 | utils/cancelled-queue-sweeper.ts | 성립(헛도는 작업). 매분 최근 7일 취소 캠페인 **전부**에 MySQL 집계 2회 이상(대기·픽업잔존) — 이미 정리된 캠페인도 7일 동안 매분 다시 본다. 정리 완료 표시가 없다 |
| S3-02 | utils/expired-pending-sweeper.ts | 성립(속도·조건부). 매분 전 발송 라인 라이브 큐에 `rsv1·status·mobsend_time·sendreq_time` 조건 COUNT — 인덱스를 못 타는 조건이라 라이브 큐가 쌓이면 매분 전체 스캔. 라이브 큐 크기·인덱스 미확인 |
| S3-03 | utils/scheduled-cleanup-worker.ts | 성립(낮음). 1분 setInterval에 겹침 방지 없음 — 한 번이 1분을 넘기면 겹쳐 돈다. 하는 일은 상태 확정 갱신이라 결과는 같다 |

**부분 ①에서 이미 잡힌 워커 결함:** F13·F42 학습 누적 30초 반복 · F39 여정 실행기 5분 100건 · F45~48 스팸 검사 큐 정지·판정 · F02·F37 직접발송 워커 루프 밖 예외 · F36 재대조 워커 sent_count 하향.

## 2-5. 부분 ④ 데이터 적재·보존 (2026-09-26 · 직접 점검)

**본 범위와 방법**
- 백엔드 코드의 INSERT 대상 164개 테이블과 DELETE·TRUNCATE 대상을 대조 → 삭제 코드가 없는 테이블 108개. 보존해야 하는 업무 원장(결제·잔액·정산·세금계산서·감사 로그·AI 크레딧 거래)과 설정성 테이블을 빼고, 한 행이 요청·이벤트·수신자 단위로 쌓이는 로그성 테이블만 적재 지점을 읽었다.
- 동적 테이블명 삭제(`DELETE FROM ${…}`) 0곳. migrations·database·scripts·OPS.md에도 아래 테이블을 정리하는 흔적이 없다(dm_views·user_sessions·sync_logs는 DDL 파일에 이름만 나온다).
- 업로드·임시 파일: 저장 폴더 전수와 파일 삭제 코드의 대상 폴더를 대조.

**S4-01 정리 장치가 없는 로그성 테이블 (성립 · 누적)**

| 테이블 | 한 행 = | 비고 |
|---|---|---|
| kakao_webhook_events | 알림톡 결과 보고 1건(메시지마다) | raw_payload jsonb 원문 보관 · 처리 뒤 다시 읽는 곳은 실패 건수·재처리뿐 |
| cdp_api_call_log | 자사몰 연동 API 호출 1회 | |
| ai_call_log | AI 호출 1회 | 요청 제한 판정용 |
| cdp_inapp_impressions | 인앱 메시지 노출·클릭 1회 | |
| dm_views | DM 열람 1회 | 전화번호·IP·user_agent 무기한 보관 |
| message_short_urls | 여정 발송은 수신자 × 본문 URL 1개 · AI 운영자·대행 승인·충전 승인 링크는 발송·요청마다 | expires_at이 있는데 지나도 지우지 않는다 |
| dm_recipient_tokens | DM 수신자 1명 | expires_at 있음 · 지우지 않는다 |
| user_sessions | 로그인 1회 | 만료 뒤 is_active=false만 · 행은 남는다 |
| mfa_challenges · sender_auth_challenges | 인증번호 발급 1회 | 만료 뒤 남는다 |
| sync_logs | 동기화 배치 1개 | failures jsonb |
| spam_block_hits | 스팸 규칙 적중 1회 | 본문 일부 보관 |
| journey_step_logs | 여정 단계 × 고객 1명 | |
| cdp_events | 자사몰 행동 이벤트 1건(page_view 등) | §2-8 R1-36 · 5분 재계산 워커가 매번 훑는다(R1-37) |
| agency_send_recipients | 대행발송 수신자 1명(전화번호 + 변수값) | §2-8 R1-13 · 접수당 3만 상한 해제 뒤 누적 속도 증가 |

판정: 이 14종은 코드·스크립트 어디에도 정리 장치가 없다. **어느 것부터 보존 기한을 둘지는 크기 측정(M-09) 뒤에 정한다.** PG 전체 4.1G(0922 실측) 중 차지하는 비중이 우선순위를 가른다. dm_views의 전화번호·IP는 크기와 별개로 보유 기간 정책이 필요하다.

**M-09 결과 반영(0926 Harold 실측 · 상위 25 합계 약 4.2GB)** — 로그성 14종은 지금 작다: cdp_events 50MB(3.7만 행) · user_sessions 46MB(2.2만 행) · agency_send_recipients 23MB(14만 행) · dm_views 7MB · cdp_api_call_log 2.7MB · sync_logs 1.6MB · 나머지는 상위 25 밖. → **S4-01은 낮음으로 내린다**(보존 기한은 개인정보 보유 정책 쪽 과제). 대신 **발송 스테이징 `campaign_send_staging`이 240만 행 · 863MB로 전체 2위**다. 발송이 끝나면 지워져야 하는 임시 테이블이라 사실상 전량이 잔존분이다(S1-H08). 어느 경로에서 남았는지 가르는 측정 = M-12 → **전량이 연결 캠페인 없는 적재분(발송 버튼마다 확인 창 전 적재 · 취소·재클릭분 잔존) · §3 M-12.** 정리 워커 설계에 필요한 시각 컬럼 유무 = M-13 → 있음(DDL 불필요).

**S1-H08 처방 (0926 Harold 동의 「기간계에 영향 없이」 → 구현 · 미배포)**
- 적재 뒤 캠페인까지의 간격: 자동 경로(플래너 planner-executor.ts:535→563 · AI 운영자 continuous-operator.ts:2055 · 대행 · DM)는 같은 흐름에서 곧바로 캠페인을 만든다(수 초~수 분). 사람이 끼는 곳은 직접발송·알림톡 확인 창 하나다.
- ① 정리 워커 `utils/staging-sweeper.ts`(안전망 · 6원칙 ③): 1시간 주기 · 겹침 방지 · **KST 01~03시만**(03시 백업 크론 전 · 같은 디스크) · 모든 행이 24시간 지났고 `campaigns.staging_id`로 가리키는 캠페인이 없는 적재분을 **통째로** 하나씩 지운다(고르기·지우기 두 문장 · 지우기 문장 안에서 조건 재확인) · 적재분 사이 200ms · 회차 상한 100만 행. 기존 240만 행 = 첫날 밤 2회차 + 다음 날 밤.
- ② commit 만료(`resolveStagingCommitState` · 같은 파일 소유): 건수 확정·차감 **전에** 행 0이거나 가장 오래된 행이 23시간을 넘으면 `STAGING_EXPIRED` 400 "발송 준비가 만료됐습니다. 발송을 다시 눌러 주세요." → 정리가 고르는 적재분(24시간+)은 결코 commit되지 않는다(1시간 여유).
- ③ 파일 크기: 지워도 863MB 파일은 줄지 않는다(이후 적재가 빈 공간을 재사용 · 더 커지지 않는다). **VACUUM FULL은 하지 않는다**(ACCESS EXCLUSIVE로 적재·워커를 막는다 · Codex 1R medium).
- Codex 1R(needs-attention · high 1 · medium 1): high = 행 단위 배치가 적재분을 반쯤 지운 채 남기면 그 적재분이 절반만 정상 발송된다 → 뿌리 = 정리와 commit이 만료를 다른 기준으로 봤다 → 위 ①통째 삭제 + ②commit 23시간 만료로 구조 수정. medium = VACUUM FULL 제외.
- 넣지 않는 것: 확인 창 취소 시 즉시 삭제 API(워커가 덮는다 · 범위 확장) · 적재 순서 변경(확인 창 숫자가 적재를 전제로 한다).
- Codex 2R(needs-attention · medium 1 · critical·high 0 → 규칙상 종료): 적재분끼리 id가 섞이면(A={1,6}·B={2,5}) 마지막 id 커서가 사이의 적재분을 건너뛰어 정리가 여러 밤 밀린다 → 내 코드의 결함이라 3라운드 없이 바로 고쳤다: 커서 제거(지운 적재분은 사라지므로 처음부터 다시 고른다) + 지우지 못한 적재분만 회차 제외 목록(`NOT (staging_id = ANY($2::uuid[]))`). 테스트 = 섞인 id 3건 한 회차 전부 삭제. 최종 = 새 테스트 3파일 21건 · backend tsc 0 · vitest 377파일 5,756건.
- 남는 것(기록만): 워커 바깥 catch로 failed 종결된 캠페인의 적재분은 캠페인이 가리키므로 정리 대상이 아니다(M-12 시점 0건).

| ID | 위치 | 판정 |
|---|---|---|
| S4-02 | workers/outreach-render-worker.ts:117 | 성립(낮음). 크롬을 띄울 때마다 임시 폴더에 프로필 폴더를 새로 만들고 지우지 않는다. 재기동 = 워커 프로세스 재시작 · 크롬 강제 종료(컨텍스트 종료 5초 초과) 때. 고아 크롬 프로세스는 수거하지만 폴더는 남는다. 쌓인 양은 미측정 |
| S4-03 | DB 인덱스(M-14) | 성립(쓰기 비용·공간 · 코드로 확정). 조회에 한 번도 안 쓰인 인덱스 중 큰 6개(약 260MB)는 **코드에 그 인덱스를 탈 수 있는 쿼리가 없다.** ① customers `custom_fields` GIN 153MB: 이 컬럼을 쓰는 36곳이 전부 `->>`(키 값 꺼내기)라 GIN이 쓰이지 않는다(`@>`·`?`는 다른 컬럼에만) · 고객 upsert마다 GIN 갱신 비용을 낸다 ② cdp_identity_links `(company_id, external_email)`·`(company_id, external_phone)` 64MB: 두 컬럼은 쓰기만 하고 WHERE로 읽는 곳 0 ③ purchases `product_code` 23MB: 조건 사용은 customer-timeline의 앞뒤 와일드카드 ILIKE뿐(btree 불가) ④ user_sessions `session_token` 15MB: 컬럼을 읽는 곳 0(S2-05) ⑤ customers `primary_source` 5MB: 조회·묶기만 · 조건 0. 처방 = `DROP INDEX CONCURRENTLY`(표 잠금 없음 · 되돌리기 = 같은 정의로 `CREATE INDEX CONCURRENTLY`) · 실행 전 M-16·M-17(DB 함수·트리거 사용 0). **실행: 0926 Harold · 6개 전부 삭제 완료**(시범 `idx_user_sessions_token` → 나머지 5개 한 번에 · remaining 0 · invalid 인덱스 0). Harold 우려 「통계·슈퍼관리자 통계·캠페인·메시지 상세가 느려지면 안 된다」 → 코드 재확인: 고객 필터 빌더(customer-filter.ts:319·576)는 `custom_fields->>'키'`만 만든다(GIN 불가) · 통계·결과 파일(stats-aggregation · send-usage-aggregation · results · admin · companies)에 삭제 컬럼 0 · product_code는 고객 타임라인 구매 조회의 앞뒤 와일드카드 검색뿐(주 조건 = 고객 id·전화) · primary_source는 활성 고객 목록 GROUP BY의 부속 열(고객 id가 선두). 운영 확인 = M-19 |

**확인했고 문제없던 것:** 고객 엑셀 업로드(처리 finally에서 삭제 + 1시간 넘은 잔존 파일 정리) · 수신거부 파일 업로드(30분 넘은 파일 정리 · 처리 뒤 삭제).
**설계상 보관(기록만):** MMS 이미지는 사용자가 지울 때만 삭제하고, 보관함·캠페인이 참조 중이면 삭제를 막는다.
**부분 ①에서 이미 잡힌 적재 건:** S1-H08 발송 스테이징 잔존.

## 2-6. 부분 ⑤ 나머지 백엔드 (2026-09-26 · 직접 점검)

**본 범위와 방법** — 미점검 청크 be-utils-023·028·030~039 + be-infra = 266파일(부분 ①이 이미 다룬 29파일 포함). 줄마다 읽지 않고 **위험 유형별 전수 검색 → 걸린 곳을 열어 판정**했다. 유형: SQL 템플릿 속 보간(164곳 · 출처 확인) · 반복문 안 쿼리(83곳) · LIMIT·단건 조건 없는 고객 테이블 조회 · 타임아웃 없는 외부 호출 · 서버 시간대 의존 날짜 계산 · DM 공개 페이지 HTML 이스케이프 · 인증 유틸(다중인증·TOTP·서명 링크·비밀 해시). 추가로 라우트 전체에서 **매장 범위(사용자는 분류코드로 자기 고객만) 적용 여부**를 고객 조회 핸들러마다 대조했다.

| ID | 위치 | 판정 |
|---|---|---|
| S5-01 | services/ai.ts:673 `filterVarCatalogByData` | 성립(속도·헛일). 활성 필드 CT(utils/enabled-fields.ts)가 5분 캐시로 이미 가진 "데이터가 있는 필드" 판정을 **캐시 없이** 회사 고객 전체에 COUNT FILTER로 다시 돈다(직접 컬럼 1회 + 커스텀 필드 1회). 호출 5곳 = AI 문안 생성(routes/ai.ts:280) · 오케스트레이터 2곳 · 자동발송 워커 2곳 → 문안 한 번 만들 때마다 고객 전체 스캔 2회 |
| S5-02 | utils/source-aware-channel-selector.ts:40 · routes/cdp.ts:2086 | 성립(속도·메모리·전송량). `GET /cdp/channel-distribution`이 회사 활성 고객 **전원의 id·phone·email**을 읽어 채널별 id 배열로 묶고 그 배열을 응답에 싣는다. 화면(CdpSettingsPage → CdpAnalyticsPanels)은 채널별 **인원수만** 쓴다. 자사몰 설정 화면을 열 때마다(loadAll 14개 병렬 호출 중 하나) 호출된다. 고객 100만 명이면 UUID 100만 개가 브라우저로 간다. 담당자(분류코드 사용자)에게도 회사 전체 분포가 나간다 |
| S5-03 | utils/segment-analysis.ts:21 | 성립(메모리·조건부). "전체 분석"(routes/ai.ts:1809 → full-analysis-runner)이 API 프로세스 안에서 회사 활성 고객 **전체 행**을 읽어 RFM·등급 분포·LTV 평균을 JS로 계산한다. 등급 분포·평균은 SQL 집계로 끝나는 값이다. 단일 PM2 프로세스라 큰 회사면 발송과 같은 프로세스의 메모리가 튄다(크기 미측정) |
| S5-04 | routes/targets.ts(전체) · routes/dm.ts:1363 | 성립(격리 · 상시 원칙 위반). 비문자 채널 타겟 추출(`/targets/extract`·`/count`·`/recipients` = 이메일·DM·인앱·카카오)과 DM 타겟 발송(`/dm/:id/send-to-target`)이 매장 범위(getStoreScope)를 거치지 않는다(buildCustomerFilter `storeCodeMode:'skip'`). 분류코드 사용자도 회사 전체 고객의 **이름·전화번호 목록을 보고, 그 전체에 DM을 보낸다.** 분류 체계가 있는데 미배정인 사용자(차단 대상)도 여기서는 전체가 열린다. 여정 대상 명단·추출(routes/ai.ts:4037 · utils/journey-target-extractor.ts)도 같다(§2-8 R1-19). 0918 실측(store-scope.ts 주석)으로는 배정 사용자 7명 전원이 분류 체계 없는 회사라 지금 행동이 바뀌는 운영 사용자는 없다 |
| S5-05 | routes/campaigns.ts:1722·1950·2249 · utils/direct-send-core.ts:43 | **결정 재확인 필요(법).** 직접발송·알림톡 창의 "수신거부제거" 체크박스(D102 · 2026-04-01 · 기본 켬·해제 가능)를 **광고 발송에서도** 끌 수 있고, 서버는 `unsubFilterEnabled=false`를 그대로 따라 수신거부(080) 번호를 빼지 않는다. D102 기록에는 광고 여부와의 관계가 없다. 수신 거부한 사람에게 광고를 보내는 구조가 열려 있다. DM 타겟 발송·대행·AI 운영자 경로는 서버가 항상 켠다 |
| S5-06 | config/database.ts:16 | 성립(버팀성 · 조건부). PG 연결 풀(최대 20 · API와 워커 43개 공용)에 쿼리 시간 상한(statement_timeout)이 없다. S5-01~03 같은 고객 전체 스캔이 오래 걸리면 연결을 쥔 채 풀을 비운다. DB 쪽 기본값이 걸려 있는지는 미확인(M-10). MySQL 발송 풀은 connectionLimit 10에 대기열 상한이 없다 |

**낮음(기록만):** AI 프롬프트용 회사 전체 집계(routes/ai.ts:283·290·608·1350 · analysis.ts:402·705 · marketing-diagnosis.ts:251)는 인원수·평균만 다뤄 매장 범위 밖 개인정보는 나가지 않는다. SNS 4종(utils/sns/*)·네이버 커머스 토큰 발급(utils/naver-commerce-client.ts:102)은 외부 호출에 타임아웃을 따로 두지 않고 Node 기본값에 맡긴다(게시 워커는 행 단위 잠금이라 겹쳐 돌아도 안전). 다중인증 검증(utils/mfa.ts:275)은 시도 횟수 검사와 증가가 분리돼 동시 요청이면 5회를 조금 넘길 수 있다(IP당 분당 10회 제한과 비밀번호 선행이 막아 실효 낮음). TOTP는 같은 코드를 유효 창(±30초) 안에서 재사용할 수 있다(슈퍼관리자 · 비밀번호 선행). 여정 실행기의 발송 시간 판정(utils/journey-executor.ts:1087)은 SEND_HOURS CT 대신 8·21을 직접 적었다(값은 같다 · CT 중복).
**야간 광고(F20) 같은 유형 전수:** 직접발송 코어·동기 /direct-send(0926 수정) · DM 타겟 발송·대행(직접발송 코어 경유) · 플래너·AI 운영자·자동발송(각자 SEND_HOURS 판정) · 여정(자체 판정) → 추가 결함 없음.
**전역 캐시 누수 전수(백엔드 전체):** 지우지 않는 전역 Map·Set 15곳의 키는 회사·지역·업종·테이블처럼 개수가 정해진 값이다. `campaigns.ts:1005 aiDeductedAxes`는 TypeScript 파서로 확인한 결과 요청 핸들러 안 지역 변수였다(누수·요청 간 섞임 없음).
**확인했고 문제없던 것:** SQL 보간 164곳 전부 상수·파라미터 번호·화이트리스트·검증된 빌더(주입 없음) · 반복문 안 쿼리는 워커의 소량 배치(LIMIT)·080 콜백 등 건수가 작은 곳뿐 · DM 렌더러는 값마다 escapeHtml, 링크는 허용 목록(`safeUrl`: http·https·tel·mailto·#·/) · 다중인증 코드 bcrypt·5회 잠금·재발송 쿨다운 · 서명 링크·비밀 해시는 timingSafeEqual · 요금제 일할 계산(utils/plan-proration.ts · Codex 7차 반영분) · 날짜 계산은 서버 Node TZ=Asia/Seoul 전제(docs/2026-07-26-billing-scope-and-corrections-design.md 실측 기록)와 맞는다 · 동기화 구매 적재 컬럼은 상수.

## 2-7. 부분 ⑥ 프론트 성능·올드 디자인 + 보조 패키지 (2026-09-26 · 직접 점검)

**본 범위와 방법** — frontend 전체를 유형별로: 라우트 코드 분할 · 빌드 산출물 청크 크기(0926 00:50 build:safe 산출물 · gzip 실측) · 주기 호출(setInterval 중 네트워크 17곳의 종료 조건·화면 이탈 정리) · 브라우저 기본 대화상자 · 화면 최상위 배경 톤. 보조 패키지 sdk-js(22파일)·pos-agent(10파일)는 HTML 삽입·주기 호출·TLS·비밀값만. sync-agent는 이 저장소에 없다.

| ID | 위치 | 판정 |
|---|---|---|
| S6-01 | pages/Dashboard.tsx:707 | 성립(헛도는 호출). 발송 접수 뒤 진행률 폴링(3초)이 `sent`·`failed`에서만 멈추고, 화면을 떠날 때 정리하지 않으며, 최대 시간이 없다. **예약 발송도 같은 폴링을 시작**하는데 예약분은 예약 시각까지 `queued`라 그동안 3초마다 호출한다(탭이 열려 있으면 시간당 1,200회 · 다른 메뉴로 옮겨도 계속). 발송 취소로 끝난 캠페인은 끝내 멈추지 않는다. 호출마다 인증 미들웨어의 세션 조회가 함께 돈다 |
| S6-02 | pages/Dashboard.tsx(정적 import 69개) | 개선(첫 화면 속도). 대시보드 청크 1,108KB(gzip 360KB)가 전체 청크 중 가장 크다. 클릭해야 열리는 창 20여 개(직접발송·결과·알림톡·AI 맞춤·타겟·분석·파일 매핑·주소록·고객DB 등 약 1만 8천 줄)를 정적으로 묶는다. 고객사 사용자의 첫 화면 JS = 공통 110 + vendor 68 + 대시보드 360(gzip KB). 창은 대부분 조건부로 그려 마운트 비용은 작고, 받는 양이 문제다 |

**확인했고 문제없던 것(⑥):** 라우트 코드 분할(App.tsx lazyPage 35개 페이지 · 청크 소실 복구 포함) · 브라우저 기본 대화상자 0곳(SnsAssetPicker의 `confirm()`은 같은 이름의 지역 함수) · 나머지 폴링 16곳은 종료 조건·5분 상한·화면 이탈 정리·숨김 탭 처리 중 하나 이상이 있다 · sdk-js는 HTML 문자열 삽입 0(요소 생성 방식) · 이벤트 묶음 전송(20건·주기 flush) · 카운트다운 타이머 정리 · pos-agent는 TLS 검증 해제·비밀값 하드코딩·무한 반복 없음.

## 2-8. 1차 후보 high·critical 판정 (2026-09-26 · 직접 확인)

**본 범위** — 중단된 1차 워크플로(청크 28개) 후보 중 high·critical 75건. 원장(§2·§2-2·부분 ① 발견 문서)의 파일:줄 ±15줄에 이미 판정이 있는 26건을 빼고 남은 49건을 코드로 하나씩 확인했다. 번호 R1-nn = 후보 목록 순번(scratchpad `r1_rest.json`).

**이미 처리 · 기존 ID로 병합 (9)** — R1-10 대시보드 카드 매장 필터 SQL 조립 · R1-38 커스텀 필드 키 SQL 조립 = §2 C 목록에서 수정 완료. R1-12 = S1-H02. R1-19 여정 대상·추출 매장 범위 없음 = S5-04에 병합. R1-04·33 cdp_api_call_log · R1-48 인앱 노출 로그 · R1-36 cdp_events · R1-13 대행 수신자 명단 = S4-01 표에 병합.

**높음 (6)**

| ID | 위치 | 판정 |
|---|---|---|
| R1-27 | utils/dm/dm-interaction.ts:90 · routes/dm.ts(`/api/dm/v/:code/event-response`) | 공개 응모 라우트에 요청 제한이 없고, 발송 토큰·등록 번호가 없으면 1인 1회 키가 클라이언트가 보내는 `anonymous_id`다. 값을 바꿔 가며 룰렛을 돌려 경품 재고(`dm_prizes.remaining`)를 비울 수 있다 |
| R1-31 | utils/cafe24-client.ts:359 · routes/cafe24.ts:90 · cafe24-client.ts:277 | 토큰 갱신이 **일시 장애로 한 번만** 실패해도 연동을 `token_expired`로 바꾼다. 웹훅은 `status='active'` 연동만 찾으므로 그 몰의 주문·회원 이벤트를 200으로 무시한다. 카페24는 재전송하지 않아 재연결 전까지 유실 |
| R1-41 | utils/dm/dm-viewer.ts:100(renderLegacySlidesHtml) · routes/dm.ts:739 | DM 저장(PUT)이 `pages`를 구조 검증 없이 저장하고, 섹션 구조가 없는 `pages`는 공개 뷰어가 옛 렌더러로 제목·문구·링크·버튼을 **이스케이프 없이** 그린다 → 고객사 사용자가 저장형 XSS를 게시할 수 있다. 뷰어가 API와 같은 출처(`/api/dm/v`)라 로그인한 사람이 열었을 때 토큰 노출 여부는 서빙 도메인 확인 필요(미확인) |
| R1-46 | utils/invoice-confirm.ts:180·289·325 | 거래내역서 메일 재시도(`retryUnsentConfirmations`)가 실패한 장을 **다시 보내지 못한다.** 1단계가 "추적행이 이미 있으면 건너뜀"으로 `claimed`에 넣지 않고 2단계는 `claimed`만 보낸다. 첫 시도에서 메일이 실패한 장은 추적행이 남아 있어 영원히 빠진다(주석의 "남은 행이 곧 재시도 목록"과 코드가 다르다) |
| R1-49 | routes/cdp.ts:591·641 · utils/inapp-personalization.ts:496 | `/cdp/inapp/active`가 `external_id`를 쿼리에서 그대로 받고 서명 확인이 없다. 몰 페이지의 공개키만 있으면 임의 회원 아이디로 이름·등급·포인트·구매액을 받는다(활성 인앱 메시지가 쓰는 변수만 · 조건부) |
| R1-02 | routes/cafe24.ts:113 | 중복 웹훅이 원래 행의 상태를 `duplicate`로 덮는다. 처리 실패로 재시도를 기다리던 `failed` 행이 5분 재처리 워커(cdp-webhook-retry-worker) 대상에서 빠진다. `processed` 기록도 사라진다(M-06 분포 해석에 영향) |

**중간 (25)**

| ID | 위치 | 판정 |
|---|---|---|
| R1-06·09·11 | routes/upload.ts:117·386·462·522 · utils/agency-send-form.ts:357 · routes/customers.ts:211 | **같은 뿌리: 엑셀을 단일 PM2 프로세스 안에서 동기로 처리.** 고객 업로드는 한 파일을 파싱·매핑검증·저장확인·백그라운드에서 4번 `XLSX.readFile`(최대 50MB). 대행 메일 접수는 첨부 명단을 동기 `XLSX.read`. 고객 다운로드는 LIMIT 없이 전량을 읽고 `XLSX.write` 동기. 도는 동안 API와 발송 워커가 멈춘다 |
| R1-03 | routes/cdp.ts:1297·1312 | 인앱 게시 과금(100)은 POST 게시 때만 `checkCredit`으로 잔액을 확인한다. 초안으로 만든 뒤 PUT으로 active 전환하면 잔액 확인 없이 게시되고 차감만 시도한다 |
| R1-05 | routes/voice.ts:40 | 음성 웹훅은 `VOICE_WEBHOOK_SECRET`이 없으면 서명 검증을 건너뛴다(OPS.md:895 "박지 X"). 음성 기능을 켠 회사가 있으면 회사 UUID만으로 AI 응답 비용 유발 + 전화번호로 고객 id 확인 가능(기본 꺼짐 · 조건부) |
| R1-07 | utils/agency-send-mail-worker.ts:1179 | `running = true` 뒤 `pool.connect()`가 try 밖이다. 연결을 한 번 못 얻으면 `running`이 풀리지 않아 이메일 대행 접수가 재시작 전까지 멈춘다 |
| R1-08 | utils/agency-send-intake.ts:797 | 원스텝·메일 대행 접수가 SMS/LMS를 **글자 수 45**로 가른다(바이트 아님 · 광고 표기·무료거부 줄 제외). 발송 배관에도 바이트 기준 교정이 없다 → 광고 문구가 붙어 90바이트를 넘는 SMS, 영문 위주 46자 이상은 LMS 과금 |
| R1-15 | routes/short-url.ts:78 · utils/cdp-events.ts:149 · utils/journey-executor.ts:1277·1550 | 단축 URL 클릭 이벤트의 `customer_id`는 identity link로만 채워지고, 알고 있는 고객 id는 properties에만 넣는다. 여정 클릭 분기·클릭 목표는 `cdp_events.customer_id`로 찾으므로 몰 연동 회원이 아닌 수신자는 클릭해도 참이 되지 않는다 |
| R1-16 | routes/sync.ts:969 | 싱크 에이전트 배치마다 회사 전체 수신거부 재대조(`reconcileSyncUnsubscribes` · 고객 전량 INSERT…SELECT·DELETE)를 다시 돈다. 전체 동기화 1회 = 배치 수만큼 반복 |
| R1-18 | utils/dm/dm-builder.ts:836 | DM 추적 CT(`getDmRecipientEngagementRows`)의 `LIMIT 1000`(고객 id 순). 1천 명 넘게 보낸 DM은 깔때기 수치·미열람 재발송 대상·AI 학습 워커가 임의 1천 명 기준 |
| R1-20 | routes/ai.ts:3106·3119 · utils/multi-goal-decisioning.ts:110 | 다중 목표 분석: 회사 조회 SELECT에 `id`가 없어 `companyInfo?.id`가 비고 월 AI 한도·통계가 빠진다. 크레딧 차감도 없다(고급 모델 호출) |
| R1-21 | utils/ai-segment-generator.ts:231 | AI가 조건을 못 뽑으면 입력 문장의 "전체·모든·모두·전부"만 보고 회사 전체 대상으로 넓힌다("서울 지역 모든 고객"도 전체). 발송 전 인원 확인은 있다. 0건 자동 완화 금지와 같은 부류 |
| R1-22 | utils/assets.ts:229 · frontend components/dm/panels/FormControls.tsx:387 | 소재 삭제가 인앱 메시지 참조만 확인하고 실물 파일을 지운다. DM은 고른 소재 주소를 그대로 쓰므로 발송된 DM의 이미지가 깨진다 |
| R1-25 | utils/continuous-operator.ts:527·559 | 자동 마케팅 수정에서 혜택 칸을 비우면 `''`→null→`COALESCE(null, 기존값)`이라 옛 혜택이 남아 계속 발송된다 |
| R1-26 | utils/dm/dm-quick-action.ts:296·316 · dm-builder.ts:64 | DM 원클릭 액션이 옛 `sections` 컬럼만 읽고 쓴다. D128 이후 DM은 `pages`가 우선이라 변경이 반영되지 않고 섹션마다 AI 호출만 소모 |
| R1-28 | utils/dm/dm-brand-extractor.ts:180 | B-0824-2(Open)와 같다. 같은 파일의 `fetchHtmlGuarded`와 달리 사설 주소 차단·본문 크기 제한이 없다 |
| R1-30 | utils/cafe24-scripttag.ts:62 · routes/cdp.ts:1962 | 스크립트태그는 `cdp_api_key`를 `?k=`로 싣는다. `/cdp/issue-key` 재발급으로 키가 바뀌어도 "이미 우리 태그가 있으면 끝"이라 옛 키를 계속 쓴다 → 몰 행동 수집 401 |
| R1-34 | utils/cdp-orders.ts:150·188 | 주문 매출(RFM)을 먼저 더하고 표식(`purchase` 이벤트 `revenue_applied`)은 뒤에 남기며 그 실패를 삼킨다. 같은 주문의 상태 변경 웹훅이 오면 매출이 다시 더해진다(조건부) |
| R1-35 | utils/connected-content.ts:384 · utils/journey-ai-generator.ts:371 | 실제 값은 `weather.today.summary·temperature`인데 AI 지시는 `weather.summary·temp·condition == 'Rain'`. 고객 지역 날씨 자리는 빈칸 · 분기 불일치(값도 한글). 매장 날씨는 정상 |
| R1-37 | utils/cdp-profile-recompute-worker.ts:23 | 5분마다 `cdp_events WHERE received_at >= NOW()-6분`. SCHEMA.md 인덱스 기록에 received_at이 없다(실측 M-11 필요) → 인덱스가 없으면 매번 전 회사 이벤트 전체 스캔 · S4-01로 계속 커진다 |
| R1-39 | utils/email-tracking.ts:117 · utils/email/email-section-renderer.ts:387 | 렌더러가 링크를 `esc()`로 넣어 `&`가 `&amp;`인데 클릭 추적이 그 문자열을 원본 주소로 서명·이동 → 파라미터 2개 이상 링크가 깨진다 |
| R1-43 | utils/journey-stats.ts:224·233·306 | 여정 통계 클릭 수 하위 쿼리가 회사 조건 없이 모든 회사의 `message_click`을 훑는다. **확인 중 새 발견:** 전환 수는 `event_name = 'order'`를 세는데 이벤트 CT는 표준 이름(`purchase` 등)과 `custom_*`만 저장한다 → 여정 전환 수는 항상 0 |
| R1-44 | utils/journey-ai-generator.ts:995 · utils/journey-pretest-notifier.ts:111·127 | 여정 스팸 사전검사에서 걸리면 AI 재작성문이 실발송 스냅샷 본문을 자동으로 바꾸는데(담당자 안내만), 출력에 혜택 차단 CT(`stripUnauthorizedBenefits`)를 적용하지 않는다(프롬프트 지시뿐) |
| R1-45 | utils/inapp-quick-action.ts:136 · utils/inapp-variant-optimizer.ts(createVariant `'active'`) | "AI 다듬기"가 만든 변형 3건이 검토 없이 `status='active'`로 바로 방문자에게 노출된다. 혜택 검사도 없다 |
| R1-47 | utils/inapp-message.ts:1330 | 방문자 페이지 조회마다 수신거부 여부를 회사 노출 이력 전체에서 찾는다(메시지 조건 없음). 노출 이력은 보존 기한이 없어(S4-01) 계속 느려진다 |

**낮음 · 부분 성립 (9)**

| ID | 위치 | 판정 |
|---|---|---|
| R1-01 | routes/address-books.ts:115 | 주소록 저장이 연락처마다 INSERT를 순차 대기 · 트랜잭션 없음(중간 실패 시 일부만 저장) |
| R1-14 | routes/analysis.ts:476 | 분석 미리보기 이탈 고객 수가 `GROUP BY cu.id`라 이탈 고객 1명당 1행을 Node로 가져온다(고객×구매 조인 · 창 열 때마다) |
| R1-17 | routes/unsubscribes.ts:479 | 수신거부 파일 등록이 번호마다 `registerUnsubscribe`를 순차 호출 |
| R1-24 | utils/continuous-operator.ts:960 | 생성 워커가 희망 시각이 지난 뒤 돌면(서버 재시작·지연) 다음 회차를 계산해 이번 회차를 말없이 건너뛴다. 기본 리드 120분이라 평소엔 없다 |
| R1-29 | utils/dm/dm-ai.ts:923·441 | 원스텝 생성이 섹션별 AI 호출을 순서대로 기다리고 섹션마다 같은 문안두뇌를 다시 조회(속도) |
| R1-42 | frontend pages/InAppMessagesPage.tsx:815 · utils/inapp-explainer.ts:281 | 통계 드릴다운을 열 때마다 AI 진단을 자동 호출해 1크레딧씩 빠진다 |
| R1-23·32·40 | full-analysis-runner.ts:91 · campaign-quick.ts:479 · email-channel.ts:656 | 부분 성립. 전체 분석은 시작 시 잔액을 확인하고 끝 차감 실패(DB 오류)만 무료 완료(`deductCreditSafe` 공통 설계). 자동제작 견적은 이미지마다 동기 `readFileSync`(개수 상한 미확인). 이메일 수신거부는 주소가 정확히 같은 행에만 기록(직접 명단 경로는 없음 · 대소문자만 다른 중복 행이 남는다) |

## 2-9. 서버 부하·조회 성능 (2026-09-26 · pg_stat_statements 70일 실측 M-20·M-21 → 코드 대조)

Harold 지시(0926): "조회는 빠르게, 서버 부하는 최소로, 불필요한 서버 사용·통신 사용 등 부하를 줄 수 있는 모든 것을 해결" + "최적화가 다른 결함을 만들어 150개 업체가 쓰는 기간계를 망가뜨리면 안 된다". 처방 원칙 = **코드를 건드리지 않는 인덱스(CONCURRENTLY · 되돌리기 준비)를 먼저**, 코드 변경은 발송·돈 경로 밖부터.

| ID | 출처(코드) | 70일 실측 | 판정 |
|---|---|---|---|
| P-01 | utils/direct-send-worker.ts:49 · 127 · 287 · 333 (5초 워커) | campaigns 전체 스캔 4종: 환불 대기(취소) 105만 회 × 28.9ms · 환불 대기 105만 × 27ms · 발송 대기 조회 123만 × 10.4ms · 멈춤 감시 100만 × 6.8ms = **DB 시간 약 21.7시간 · campaigns 전체 스캔 519만 회 · 1,022억 행** | 성립. 5초마다 74MB 테이블을 4번 통째로 읽는다(대상 행은 거의 0건). 처방 후보 = 조건 그대로의 부분 인덱스(코드 무변경) |
| P-02 | utils/prepaid.ts:47 · 491 · mysql-refund-sweeper.ts:256 · 262 | balance_transactions 캠페인별 합계 4종 약 6,600만 회 × 0.3ms · 매번 1.4만 행 전체 스캔 = **1,938만 회 전체 스캔 · 1,161억 행** | 성립. 캠페인 id로 찾는 인덱스가 없어 호출마다 통째로 읽는다. 처방 후보 = 인덱스 1개(코드 무변경) · 인덱스 현황 M-22 |
| P-03 | utils/cdp-identity.ts:176 | 이메일 매칭 54.6만 회 × **33.7ms** = 5.1시간 | 확인 중. `idx_customers_company_lower_email`은 쓰이는데(24.8만 회) 평균이 길다 → 인덱스 조건(부분 인덱스 등)과 쿼리 조건 불일치 의심 · 정의 M-22 |
| P-04 | utils/alimtalk-jobs.ts:232·313·372 (5분 검수 폴링) | kakao_templates UPDATE **119만 회**(= IMC 단건 GET 같은 수) | 성립(통신·쓰기 헛일). 대상에 "승인·반려됐지만 검수 알림 미발송" 템플릿이 들어가고, 알림 받을 번호가 없는 회사는 알림이 영원히 안 나가 **5분마다 IMC 재조회 + 무조건 UPDATE를 영구 반복**한다(D188의 늦은 등록 대비 재시도가 외부 호출까지 반복). 처방 후보 = 이미 종결된 템플릿은 IMC 재조회 없이 알림만 재시도 · 대상 규모 M-22 |
| P-05 | utils/cdp-orders.ts:101 | 주문 중복 확인 16.3만 회 × 14.7ms | 성립. `properties->>'order_id'` 인덱스가 없어 회사의 구매 이벤트를 훑는다(이벤트가 늘수록 느려짐). 처방 후보 = 표현식 부분 인덱스 |
| P-06 | utils/dm/dm-interaction.ts:410 (1분 추첨 워커) | 7.2만 회 × 8ms | 성립(낮음). 매분 dm_pages 전체를 텍스트로 풀어 LIKE |
| P-08 | utils/direct-send-worker.ts:273 (0925 C-11 · 미배포) | 신규 | 끊긴 적재 복구 스캔(`send_phase='processing' AND updated_at < NOW()-10분`)도 5초마다 campaigns 전체 스캔이 된다 → P-01 인덱스가 함께 덮는다 |
| P-09 | utils/prepaid.ts:285 `prepaidRefund` · :450 `prepaidReverseOverRefund` ← mysql-refund-sweeper.ts:320 (30초 · 캠페인마다) | M-26: **BEGIN 2,040만 · ROLLBACK 2,039만 · 회사 행 `FOR UPDATE` 1,478만+102만** · 잔액 거래 읽기 약 6,600만 | 성립(반복 헛일 · 기간계 경합). 두 함수는 부를 때마다 트랜잭션을 열고 **회사 행을 잠근 채** 원장·환불액을 계산하고, 대부분 "이미 충분히 환불됨"으로 되돌린다. 같은 회사의 발송 차감(prepaidDeduct)이 그 잠금을 기다린다. 처방 단계: ① A4 인덱스로 잠금 안의 잔액 거래 전체 스캔을 없애 잠금 시간을 줄인다(코드 무변경) ② 측정 뒤 잠금 없는 사전 판정(할 일이 있을 때만 잠금 · 잠금 안에서 재확인 · 스위퍼가 30초마다 다시 부르므로 건너뛰어도 수렴) — 돈 경로라 Codex 적대 필수 · 별도 동의 |
| P-10 | utils/gateway-template-mapping-worker.ts:177 | `UPDATE gateway_template_mappings SET last_seen_at = now()` 86만 회 | 성립(낮음 · 쓰기 헛일). 매 주기 매핑 5,592건 전부에 시각만 찍는다 |
| P-11 | 발송 라인 조회(`sms_line_groups` JOIN users/companies) | 327만 + 125만 + 124만 회 | 성립(낮음). 요청·적재마다 같은 라인 그룹을 다시 읽는다(각 0.01~0.04ms · 캐시 후보) |
| P-12 | utils/spam-test-queue.ts (3초 워커) | spam_filter_tests 조회 3종 각 203만 회 | 기록만(각 0.01~0.02ms · 작은 표 · 실비용 작음) |
| P-07 | utils/enabled-fields.ts:493 · routes/ai.ts:283 등 | DISTINCT custom_fields 1.6만 회 × 121ms · 고객 집계 1.2만 회 × 33.8ms | S5-01 계열(고객 전체 스캔). 캐시 확대·집계 통합은 브레인스토밍 안건 |

**M-22 사실(0926 Harold 실측):** balance_transactions 인덱스 = pkey · created_by · (company_id, created_at) → `reference_id`(uuid) 인덱스 없음. campaigns 인덱스 10개 중 `send_phase`·`send_config` 키 인덱스 없음. `idx_customers_company_lower_email` = (company_id, lower(email::text)) — 쿼리와 식이 맞다 → P-03은 같은 이메일 행 쏠림 의심(M-23). 검수 폴링 대상 = APPROVED·미알림 153 + KREJ·미알림 3 = **156건이 5분마다 영구 폴링**(LIMIT 100 · 하루 최대 약 2.9만 회 IMC 호출).

**처방 설계안 A — 인덱스만(코드 무변경 · 기간계 쿼리 그대로 · 되돌리기 = DROP INDEX CONCURRENTLY · Harold 동의 대기)**
- ⛔ 설계 제약: campaigns는 발송 중 `updated_at`이 계속 바뀐다 → 인덱스 키에 바뀌는 컬럼을 넣으면 모든 캠페인 UPDATE가 HOT를 잃고 기존 인덱스 10개를 매번 다시 쓴다. **키는 안 바뀌는 컬럼(id·created_at·reference_id)만.** 조건(술어)은 워커 SQL의 글자와 같게.
- A1 `idx_campaigns_rp_cancel ON campaigns (id) WHERE send_config ? 'refundPendingCancel'` — P-01 ①
- A2 `idx_campaigns_rp ON campaigns (id) WHERE send_config ? 'refundPending'` — P-01 ②
- A3 `idx_campaigns_phase_active ON campaigns (send_phase, created_at) WHERE send_phase IN ('queued','preparing','processing')` — P-01 ③④ + P-08(대상 행 = 진행 중 캠페인뿐 · 거의 0)
- A4 `idx_balance_tx_reference ON balance_transactions (reference_id)` — P-02 5종 전부(모두 `reference_id = $2`)
- A5 `idx_cdp_events_purchase_order ON cdp_events (company_id, source, (properties->>'order_id')) WHERE event_name = 'purchase'` — P-05
- 적용 직후 확인 = 워커 SQL(상수만 있어 그대로 실행 가능)의 `EXPLAIN`이 새 인덱스를 타는지 · 다음 날 campaigns·balance_transactions seq_scan 증가분이 급감했는지(M-19 기준값 대조) · pg_stat_statements 평균 시간 전후.
- **Codex 적대 1R(0926): approve · 실질 결함 없음.** A3의 `send_phase = 상수` → `IN (...)` 함의는 PG15 술어 증명으로 성립(분리 불필요). HOT: `updated_at`·카운터만 바꾸는 갱신은 영향 없음 · A1·A2는 `send_config` 값이 바뀔 때, A3는 `send_phase`가 바뀔 때만 HOT를 잃는다 → 적용 전후 `n_tup_hot_upd` 비율 관찰. 절차 권고 반영: 생성마다 `indisvalid`·`indisready` 확인 → 실패·취소면 남은 INVALID를 `DROP INDEX CONCURRENTLY`로 지우고 재시도. 적용 순서 = A4(효과 최대 · 작은 표) → A1·A2·A3 → A5.

**화면 조회 전수(0926 Harold 지시 「통계·캠페인 조회·예약 내역·메시지 조회 전부 — 그렇게 심플하지 않다」)** — 위 P-01~P-08은 백그라운드 워커 부하다. 사람이 여는 조회 화면은 PG와 **MySQL(QTmsg 라인별·월별 결과 테이블)**을 함께 읽으므로 pg_stat_statements만으로는 절반이 안 보인다. 방식: ① M-24 느린 API 로그(500ms+ · 70일)로 느린 화면 순위 → ② 그 API의 코드를 읽어 PG·MySQL 쿼리를 짚고 → ③ PG는 pg_stat_statements · MySQL은 M-25 digest로 원인 확정 → ④ 화면 × 쿼리 × 처방 표. 설계안 A(워커 인덱스)는 화면 쿼리와 같은 DB 자원을 다투는 헛일을 줄이므로 이 조사와 독립적으로 효과가 있다.

**처방 설계안 B — P-04 검수 폴링(코드 · alimtalk-jobs.ts · 발송·돈 경로 밖 · 0926 Harold 「반복 부하·불필요 소모를 없애자」 → 구현 · 미배포)**
- 이미 종결(승인·반려)된 템플릿은 IMC를 다시 부르지 않는다(결과가 이미 DB에 있다). 알림 재시도만 DB 값(status·reject_reason)으로 하고 주기를 5분 → 6시간으로 늦춘다(D188 "번호를 늦게 등록한 회사도 결국 알림을 받는다"는 보존). 검수 중 템플릿은 지금처럼 5분마다 IMC 조회.
- 효과 = 하루 최대 약 2.9만 회의 헛 IMC 호출과 같은 수의 UPDATE 제거.
- 구현(0926): `syncPendingTemplatesJob` = `pollInProgressTemplates`(검수 중 상태만 · 5분 · IMC 조회 그대로) + `retryTerminalTemplateAlarms`(종결·미알림 · 6시간 · IMC 호출 0 · DB의 status·reject_reason으로 알림 · 받을 번호 없으면 `last_synced_at`만 찍어 6시간 뒤). `last_synced_at`은 화면에 표시되지 않는다(타입 선언만). 테스트 5건(검수 중 조회 범위 · 6시간 간격 · 종결은 IMC 0 · 받을 사람 있으면 DB 결과로 알림+완료 표시 · 검수 중은 IMC 조회 유지) · backend tsc 0 · vitest 378파일 5,762건. Codex 대상 아님(발송·돈 경로 밖).

## 2-10. 한줄로 V2 돈 결함 수정 (2026-09-26 오후 · Harold 지시 「Agent 없이 직접 · 돈 리뷰는 닫힐 때까지 · 측정은 돌아오면 명령으로」 · 전부 미커밋·미배포)

| ID | 처방 | 검증 |
|---|---|---|
| F01·F04 | **선불 알림톡 결과별 정산.** ①알림톡 차감 3호출부(direct-send-core = 알림톡 창·마케팅 플래너 · campaigns.ts /direct-send = 직접 타겟 · auto-campaign-worker = 자동발송)가 `prepaidDeduct(…, { alimtalk: true })` → 같은 잠금 회사 행에서 알림톡·SMS·LMS 단가를 풀어 차감 설명 괄호 뒤에 `· 결과별 정산: 알림톡 X원 · SMS 대체 Y원 · LMS 대체 Z원`(하나라도 미설정이면 싣지 않음 = 종전) ②정산 스위퍼 4-2-A: 그 표시가 있는 캠페인만 `smsAlimtalkResultAgg`(이력 테이블만)로 성공을 결과별로 세고 차액 = Σ 과금 성공 × max(0, 차감 단가 − 결과 단가)를 `KAKAO_DIFF` 항아리에 **금액 목표**로 환불(무료분은 차액 작은 성공부터 덮음) ③회수(4-3) 정당 한도 += 차액 · 불변식(4-4)은 차액을 정당 환불로 봄 ④K행 7830/7831과 대체 행이 한 캠페인에 같이 있으면 판정 보류 + 경보(차액 0) ⑤실패·미적재 환불은 **종전 행 기준 유지** — sent_count가 4-1에서 대체 행 포함 적재수로 올라가 있어 실패만 수신자 기준으로 바꾸면 미적재가 줄어 미환불이 난다(승인안의 "수신자 기준 실패 집계·라이프사이클 수정"은 이 이유로 뺐다. 대체 성공 수신자의 K행 실패 환불 → 30분 뒤 회수 흐름은 **기존 동작 그대로 남음** = 추가 과제 A-05) ⑥과거 캠페인(표시 없음)은 동작 불변 — 이에스페이먼트 1건(≤22원)도 건드리지 않음 | 테스트 +29(prepaid-alimtalk-settle 14 · 스위퍼 배선 5 · 결과 집계 3 · 차감 경로 3 · refund-calc +11 · deduct-reference +10) · **Codex 적대 1R high 1**(무키 환불 공존 시 FAIL 누적 비교에 차액이 섞여 실패 환불 삼킴 → 뿌리 = 건수 항아리와 금액 항아리를 한 합계로 비교 → `counted`(차액 제외 누적)를 옛 단일 항아리·keepCount 비교 기준으로 · 상한은 전부 포함 유지) → **2R approve** |
| F40·F41 | 여정 문자 적재 반환값 확인 — 0건이면 throw → 기존 catch의 5분 뒤 재시도·자동 정지 분기(‘sent’ 기록 없음 · 차감분은 스위퍼 미적재 환불) | journey-sms-load-failure 2 · **2차 묶음 Codex 4R approve** |
| F02·F37 | 직접발송 워커 바깥 catch가 `send_phase='failed'`로 굳히던 것 제거(사유만 기록) → queued는 다음 주기 재선점 · processing은 10분 뒤 끊긴 적재 정리(recover)가 MySQL 실측 적재 수로 종결(적재분 발송 · 나머지 미적재 환불). recover가 막히지 않게 필드 매핑·080 번호는 적재할 때만 준비 | direct-send-worker-cancel-recover +2(기존 1건 계약 갱신) · **2차 묶음 Codex 4R approve** |
| F15·F17 | 담당자 테스트 발송 참조를 요청마다 `randomUUID()`(고정 zero-uuid 공유 → 회사 누적 환불이 두 번째 실패부터 삼킴) · 고정 참조에 기대던 월 사용량 테스트 비용은 `reference_type='test' OR 옛 zero-uuid`로 | test-send-refund-ref 2 · **2차 묶음 Codex 4R approve** |
| F05·F06·F11 | **여정 실패분 환불 경로.** ①여정 차감 참조 = 단계 캠페인 id(유형 journey 유지) ②새 단계 캠페인에 `send_config.journeyLedger` 표식 — 표식 있는 캠페인만 스위퍼가 (journey, 캠페인 id) 원장으로 정산(알림톡 단계 = KAKAO 축 · `resolveCampaignLedger`) ③**여정 차감을 적재 앞으로**(Codex 2R high: 적재 → 결과 → 차감이면 결과가 차감보다 먼저 보이는 틈에 회수가 정상 환불을 빼감 · MySQL·PG 시간 상한이 없어 날짜로 닫힘 증명 불가 · 06-06 J1이 뒤로 옮긴 이유 = 환불 경로 없음 → 이제 있음) · 차감 실패면 보내지 않고 정지(옛 "보내고 1건 회사 부담") ④여정 미적재는 5분 지난 차감만 ⑤불변식 경보는 하루 마감 뒤 ⑥**Codex 3R high:** 항아리 지급 누계 비교가 회수 뒤 정당 환불을 막음(여정 알림톡 대체 성공 → 실패 환불 → 회수 → 적재 실패) → 여정은 원인별 항아리 대신 **단일 목표를 순환불(환불 − 회수)과 비교**(`prepaidRefund` netTargetCount · 상한도 순환불 기준) · 목표 = min(자리 잡은 차감, 수신자 기준 실패 + 미적재) · 알림톡은 행 실패 − 대체 행(`smsCampaignSubRowCounts` · 행 집계와 같은 가시성) · 여정 발송 수는 실행기만 올린다(스위퍼 4-1이 대체 행으로 부풀리지 않게) · 지급 목표 ≤ 회수 한도가 식으로 성립해 요동 없음 | journey-refund-ledger · mysql-refund-sweeper-journey 12 · 순환불 모드 4 · 대체 행 집계 2 · **Codex 1R·2R·3R high 각 1 → 4R approve** |
| F30 | 유료 스팸 검사 적재 실패 = 나간 건수만 남기고 NOT_LOADED 환불(keepCount) · 수동 경로는 실패 회차 결과 행 삭제 + 0건이면 검사 종료 · 큐 경로도 같은 환불 · (3차 1R high) 환불 대상 회사를 호출부가 넘긴다(첫 조회 실패에도 환불) | spam-test-load-failure-refund 5 · **3차 묶음 Codex 3R approve** |
| F36 | 재대조 워커가 통계와 같은 테이블 해석 CT(`resolveCampaignTableGroups` — 기록된 sentTables + 그 라인 LOG · 기록 없으면 (회사, 작성자) 라인)를 쓴다 → 라인이 빠진 뒤 부분 실측으로 sent_count를 낮춰 덮던 것(→ 스위퍼 미적재 과환불) 차단 · 조회 테이블 수도 준다 | reconcile-recorded-tables 3 · **3차 묶음 Codex 3R approve** |
| F38 | `/direct-send/stage`: 커밋된 준비분 409 · 다른 회사 준비분 404 · 워커 청크 = min(청크, total − processed) · (3차 1R high) 검사와 INSERT 사이 commit 끼어듦 → 준비분 단위 잠금(`withStagingLock` · staging-sweeper.ts)으로 stage(이어 붙이기)와 commit(만료 확인 → 집계 → 캠페인 생성) 직렬화 · (3차 2R high 2) DB advisory 잠금 연결 + 본문 풀 연결 중첩 = 풀 교착 · UUID 표기 우회 → **프로세스 안 키별 뮤텍스**(DB 연결을 쥐지 않음 · 전제 = PM2 fork 단일 프로세스 `ecosystem.config.js` instances 1 · 클러스터로 바꾸면 이 함수만 교체) + 키 = UUID 16진수 32자리 소문자 | staging-append-after-commit 6 · staging-lock 2 · **3차 묶음 Codex 3R approve** |
| F10·F31·F32 | 대행 취소(queueOnly)가 적재 중(preparing·queued·processing)이면 `send_config.loadCancelled` 표식(CT `load-cancel.ts`) → 워커가 선점·루프·종결에서 취소로 보고 전체 정산 · 표식을 남긴 취소·앞선 표식이 있는 캠페인(`stoppedEarlier`)은 "이미 발송"이 아님 → 취소 마무리 워커가 정산 끝난 캠페인을 예약으로 되돌리지 않고, 대조 워커는 반복 회차를 기록하지 않음 · (3차 1R high) 표식은 처음 한 번만·`updated_at` 안 건드림(반복 중화가 끊긴 적재 복구를 미루지 않게) | agency-load-cancel 13 · 기존 계약 3건 갱신 · **3차 묶음 Codex 3R approve** |
| S1-H02 | 발신번호 수정 API(PUT /manage/callbacks/:id)는 번호를 바꾸지 않는다(라벨만 · 다른 번호면 400 `CALLBACK_PHONE_IMMUTABLE`) — 등록 절차(자체등록 허용·형식·중복·회선 상한) 우회 차단 · 화면은 이 API로 번호를 안 바꾼다(호출 0) | callback-put-no-phone-change 3 · 돈·DB 경로 아님(Codex 대상 외) |
| F27 | 발송내역(/results/campaigns/:id/messages)이 그 회사 캠페인이 아니면 404(상세·엑셀과 같게) — 다른 회사 수신번호·본문 노출 차단 · **추가 과제:** 일반 사용자가 같은 회사 다른 사용자의 발송내역·엑셀을 볼 수 있다(상세는 막는다 · 기준 불일치) | results-messages-owner 1 · Codex 대상 외 |
| F13·F42 | 캠페인 학습 누적: 한 번 평가한 캠페인은 다시 고르지 않음(프로세스 메모리 · DB 쓰기 없음 · 25시간 뒤 정리) + 10분 간격(옛: 30초마다 · 클릭 0 캠페인을 24시간 동안 2,880회 재선택하며 cdp_events 전수 COUNT · LIMIT 100 기아) | learning-accumulate-once 1 · Codex 대상 외 |
| F35 | **(Codex 4차 1R high 구조 정정)** 취소 결말을 **대기 삭제·잔존 0 검증 뒤의 사실**로 가르는 공용 CT `utils/cancel-settle.ts settleCancelOutcome` 신설 — 대기를 떠난 행(라이브 비대기 + 이력)이 있으면 취소로 표시하지 않고 발송 캠페인으로 넘김(completed · 적재 수 = 남은 행 실측 → 정산 스위퍼가 막은 몫을 미적재로 · 실패 · 초과 회수를 한 원장으로) · 없으면 취소 확정(예약·초안만) + 축마다 캠페인 전체 기준(차감 − 남는 행) CANCEL 환불. 옛: 삭제 전에 센 대기 수로 환불 + 무조건 cancelled(세고 지우는 사이 픽업분 과환불 · 청구 누락). 상태를 바꾸는 취소의 환불 의무는 건수 대신 정산 모드(`mode:'settle'`) · 대기 0이어도 남김(유령 예약 차감 환불) · 재시도 워커가 같은 CT로 다시 가름. 사용자 사전 거절 = 예약 시각 지남 + [적재 중(표식보다 먼저) · 대기를 떠난 행 — 이력 포함(분할 발송 앞 회차)]. 상태를 바꾸는 취소도 적재 중이면 적재 중단 표식(슈퍼관리자 비상 정지가 발송 캠페인 결말이어도 워커가 멈춤). 직접발송 워커의 정산 함수(countCampaignRows · settleCancelledLoadRefund)를 이 CT로 이동. 대행(queueOnly)은 종전(건수 의무·건수 환불). **남은 것(기록):** 발송 캠페인 결말 + 적재 중단 표식이 겹치면 워커 전체 기준 정산(실패 포함)과 스위퍼 실패 환불이 겹쳐 일시 초과 → 4-3 회수로 수렴(대행 적재 중 취소와 같은 모양 · A-05 부류). **(2R high 2건 · 같은 뿌리 = 다른 주체가 아직 바꾸는 사실을 한 시점으로 확정)** ①적재 중 + [예약 시각 지남 · 슈퍼관리자 취소]면 취소 CT는 표식·대기 삭제·의무 승격까지만 하고 `deferred` — 결말은 적재를 멈춘 워커 취소 분기가 같은 결말 CT로(아직 예약·초안인 캠페인만 · 취소 확정·대행은 종전 전체 기준 정산) · 재시도 워커는 적재 중엔 대기 · 슈퍼관리자 응답 문구 사실대로(admin.ts · manage-scheduled.ts) + 두 화면이 성공 시 서버 문구를 표시(AdminDashboard · manage ScheduledTab — 옛: 고정 문구) ②발송 캠페인 결말은 상태가 먼저 completed로 바뀌었어도 적재 수를 남은 행으로 반영(취소된 캠페인만 제외) · 반영 0행 = 경보 + 의무 유지. **(3R high 2건)** ①같은 부류 재발(2R) → 뿌리 = 한 취소 의무를 두 정산 방식(취소 항아리 전체 기준 · 스위퍼 원인별)이 나눠 가짐 → **정산 모드 의무는 누가 실행하든 결말 CT 하나로만**: 워커 취소 분기는 상태가 아니라 의무 표시로 가름 · 상태를 바꾸는 취소의 적재 중단 표식은 정산 의무와 같은 UPDATE(표식만 있고 의무 없는 상태 불가) · 결말 CT의 "아무것도 안 나감"은 동기화가 대기 행만 보고 completed로 바꿨어도 취소로 확정(2R에 넣은 모순 경보 장치는 걷음) ②적재 중 정산 의무가 재시도 LIMIT 20을 점유 → 후보 SELECT에서 한도 전에 제외(load-cancel `LOADING_SEND_PHASES_SQL`) · 루프 안 대기 걷음. **(4R high)** 배포 전 건수형 의무가 남은 캠페인의 재취소가 정산 모드로 안 바뀜 → "기존 의무 보존"은 건수로 환불하는 대행만 · 상태를 바꾸는 취소는 정산 모드로 덮는다. **(5R high)** 옛 의무를 읽은 재시도의 해제·연기가 새 의무를 지움 → 뿌리 = 의무를 쓰는 두 주체 비직렬 → 공용 잠금 CT에 캠페인 단위 취소 의무 잠금(`withCancelObligationLock`) · 취소 CT의 의무 기록과 재시도 워커의 캠페인별 처리(잠금 안 재조회 → `processCancelObligation` = 옛 루프 본문 그대로) | cancel-settle 8 · cancel-after-start 15 · **4차 묶음 Codex 6R approve** |
| F09 (+같은 모양) | AI 발송 catch·동기 직접발송 catch: 한 건이라도 적재됐으면 failed로 덮지 않고 성공 경로와 같은 종결(예약 = scheduled · 즉시 = completed · AI 실행 행도 같게) · 안내는 사실대로(`loadedSendFailureMessage` · direct-send-spec.ts) · 적재 0건은 종전 · 실행 행 종결 계약 테스트 갱신 1줄. **(Codex 4차 1R high)** 상태 기록까지 실패해 초안으로 남은 적재분을 초안 삭제(DELETE /:id)가 물리 삭제하던 길을 막음 — 실행 행이 있거나 큐에 행이 있으면 409 `DRAFT_HAS_SEND`(예약 취소로 안내). 남은 초안은 실행 행(sending·scheduled)을 통해 결과 동기화가 completed로 회복하고, 취소 CT는 초안을 받는다. **(2R high · 가드 ↔ 동시 발송 시작 경합)** 프로세스 안 키별 잠금 공용 CT `utils/keyed-lock.ts` 신설(준비분 잠금 뮤텍스를 옮기고 withStagingLock은 위임 · 동작 불변) — AI 발송 시작 [존재 재확인 → 중복 실행 행 확인 → 실행 행 생성]과 초안 삭제 [상태 재확인 → 가드 → status='draft' 조건 삭제]가 같은 캠페인 잠금 안(**S1-H07 동시 발송 중복 방지도 같은 잠금으로 닫힘**) · 실행 행 종결 계약 테스트 기준점 = 실행 행 확정 줄 | ai-send-catch-loaded 5 · draft-delete-guard 5 · keyed-lock 4 · **4차 묶음 Codex 6R approve** |
| F19 | 대량 직접발송 워커가 개별 회신번호 모드면 청크마다 `filterByIndividualCallback`(동기 경로와 같은 CT)로 번호 없음·미등록·미배정 행을 빼고 적재 · 걸러진 행은 미적재 환불 · `exclusions.callbackExcluded`. **(Codex 4차 1R high)** 관리자 발송에 사용자 배정 제한이 걸리던 것 → 배정 제한 대상 판정 CT `callbackAssignmentUserId`(callback-filter.ts · JWT super_admin·company_admin = DB admin은 제한 없음) 신설 · 동기 경로 인라인 2곳과 워커가 같이 씀(작성자 유형은 캠페인당 1회 조회) | worker-individual-callback 2 · **4차 묶음 Codex 6R approve** |
| F24 | 예약 문안·시각 수정: 적재 중(preparing·processing) 409 · 적재 전(queued)은 워커가 읽는 `send_config`(message·subject·scheduledAt)까지 함께 · `send_phase='queued'` 조건으로 워커 선점과 원자적(0행이면 409). **(Codex 4차 1R high)** 첫 청크가 보이면 큐 편집 경로로 새던 것 → 처음 읽은 상태가 queued면 수신자 수와 무관하게 큐 조회 전에 queued 분기(알림톡·브랜드는 채널로 거절 · 큐 기반 거절과 같은 규칙) | scheduled-edit-loading 4 · **4차 묶음 Codex 6R approve** |
| F26 | 발송결과 상세·발송내역·엑셀(+슈퍼관리자 엑셀)이 **그 캠페인의** 테이블(`getCampaignSmsTablesFor` = 관리자 상세와 같은 `getCampaignSmsTables` · 기록된 적재 테이블 또는 회사 전 라인 + 발송월 ±1 이력)을 읽는다 — 옛: "지금 기준 당월·전월" 회사 라인이라 전전월 이전 캠페인이 0건 · 조회 테이블 수는 종전과 비슷하거나 적다 | results-campaign-tables 5 · 조회 경로(Codex 대상 외) |
| F49 | 자동 스팸 검사 청구 제외: AI 자동발송의 검사는 선불 차감을 건너뛰는데(`skipPrepaid` · "프로 이상 무료") 표시값이 유료인 여정 사전 검사와 같은 `auto_ai`라 후불 정산·비용 표시가 무료 검사를 청구했다 → `enqueueSpamTest`가 'auto_ai' + skipPrepaid면 `auto_ai_free`로 적재(차감 건너뜀 한 곳에서 정해져 선불·후불이 갈라질 수 없다 · varchar(20) · CHECK 없음 = 0925 운영 확인) · 청구 제외 판정 CT(spam-trial.ts)가 체험과 함께 뺀다(`spamBillableTestSql` NOT IN · `isSpamTestBillable` · 정산 2곳·비용 표시 3곳) · 큐 워커 자동 판정 `isAutoSpamSource`(동작 불변). 과거 'auto_ai' 행(무료였던 것)은 그대로 청구 집계에 남는다(구분 불가 — 필요하면 variant·batch로 수동 판정) | spam-auto-free-billing 7 · precheck·spam-load 테스트 갱신 · **5차 묶음 Codex 2R approve** |
| F14 | 최소과금 정액 발행 CT(`issueMinimumChargeBilling`)가 해지(`companies.status='terminated'`)·수동 정산(`company_billing_settings.manual_billing`) 회사를 422로 거절(`MIN_CHARGE_TERMINATED` · `MIN_CHARGE_MANUAL_BILLING` · 원장 조회·트랜잭션 전) — 일괄 발행이 등록 회사 전부를 넘겨 해지 회사에 매달 정액 청구서가 나가고 수동 정산 회사는 이중 청구될 수 있었다. 일괄 결과엔 사유와 함께 "건너뜀". 일반 일괄발급과 같은 기준(두 칸 모두 그 조회가 이미 읽는 칸 · 새 칸 0). 해지 직전 달 미청구분은 정산 생성(단건) | min-charge-eligibility 5 · **5차 묶음 Codex 2R approve** |
| F03·F25 | 이니시스 리턴 콜백 재전송: 주문번호 단위 잠금(keyed-lock CT) 안에서 **승인 전에** 결제 상태를 읽는다(`readInicisPaymentState` · payment-processor CT) — completed = 성공 화면(이미 처리 · 승인·망취소 생략) · pending 아님 = 실패 화면(생략) · 행 없음·pending = 종전 흐름. 옛: 두 번째 콜백이 같은 인증 토큰으로 승인을 다시 부르고 실패하면 망취소 → 이미 충전된 첫 거래의 카드 대금만 취소될 수 있었다(이니시스 동작에 달린 영향 · 코드 경로는 성립) | inicis-return-replay 4 · **5차 묶음 Codex 2R approve**(1R high = 공개 경로 재전송 응답의 잔액·금액·id 노출 → 완료 여부만 · 상태 조회 CT는 status만) |
| S1-H10 | 알림톡 검수 중 폴링: 마지막 조회가 오래된 순(`ORDER BY last_synced_at NULLS FIRST`) 100건 · IMC가 결과를 주지 않은 행(오류 코드·빈 응답·상태 없음)도 조회 시각을 한 문장으로 찍어 5분 뒤로 — 옛: 그런 행이 매 주기 다시 집혀 100건을 넘으면 다른 회사 검수 중 템플릿이 영영 조회되지 않음(이 칸은 폴링 커서 · 화면 표시 없음) | alimtalk-poll-rotation 2 · 발송·돈 경로 밖(Codex 대상 외) |
| P-10 | 게이트웨이 매핑 대조: 일치·대기 행의 실존 확인 시각을 행마다 UPDATE(대조 1회 약 5,600번 왕복 · 70일 86만 회) → bill 대조 끝에 `id = ANY` 한 문장. 값의 의미(마지막 실존 확인 · 목록 API가 내보냄)는 그대로 | gateway-reconcile-seen-batch 2 · 경로 밖 |
| F21 | 예약 수신자 목록(`GET /campaigns/:id/recipients` 두 분기)이 페이지마다 일치 행 전체(본문 포함)를 모은 뒤 자르던 것 → 이미 운영 중인 페이지 전용 CT `smsSelectPagedAll`(테이블별 상위 limit+offset 선잘라내기 · 결과 동일 · 0613 예약 상세 10초 병목 처방과 같은 CT). 발송결과의 죽은 래퍼 `smsUnionSelect`(호출 0곳) 제거 | scheduled-recipients-paged 2 · 조회 경로 |
| 보류(측정·효과) | **P-06** DM 추첨 워커 = 분당 약 8ms(70일 7.2만 회 × 8ms) — 캐시 도입 위험 대비 효과 미미 · **P-11** 발송 라인 조회 캐시 = 라인 재배정 직후 옛 라인 적재 위험(발송 축) — 손대지 않음 · **F28** 발송내역 CSV 청크 재정렬 = 사용자가 누를 때만 도는 내보내기(반복 부하 아님) → M-35 대형 캠페인 내보내기 시간 측정 뒤 결정 · **F39** 여정 실행기 5분 100건 = 실제 적체가 있어야 처방 → M-34 | 측정 대기 |
| S1-H04 | **손대지 않음(설계 의도)**: 재접수 명단 전량 조회는 "서버 쪽 복제 경로를 만들지 않는다 · 화면이 전 명단을 다시 접수한다"(agency-send.ts 주석)의 일부 — LIMIT을 걸면 재접수가 잘린다. 수십만 명 재접수가 느리면 서버 복제 경로 설계가 필요(Harold 결정). S1-H03·S1-H05는 아래 0926 밤 행에서 닫음 | 기록 |
| R1-46 | **거래내역서 메일 재시도.** ①적재가 "살아 있는 추적행이면 건너뜀"이라 첫 메일이 실패한 장은 [메일 재시도]가 영영 못 보냈다 → 발송 표시 없음 + 추적행 manual_wait면 그 행을 다시 쓴다(토큰 유지 · 수신자·참조는 지금 설정으로 갱신) ②Codex 1~4R(같은 부류 = 보낸 뒤의 불확실이 발송 소유권을 다시 연다) → **구조 수정: 발송 소유권(발송 표시)을 SMTP 전에 커밋 · 발송은 트랜잭션 밖 · 확실한 미접수일 때만 우리가 찍은 값과 같을 때 해제**(판정 CT `isSmtpNotAccepted` · billing-recipients.ts = 명시적 4xx·5xx · 본문 전 명령 EHLO·HELO·LHLO·STARTTLS·MAIL FROM·RCPT TO·AUTH* · EAUTH·EDNS·EENVELOPE · 대표 수신자 거부. `CONN`은 본문 뒤 소켓 오류에도 붙어 제외) · 불확정은 표시 유지(수동 확인) · 전달 확정은 발송 뒤 따로. 덧댄 장치(표시 되살림 · markCommitted)는 사라짐. **남은 것(기록):** 선커밋 뒤 SMTP 전 프로세스 종료 · 불확정 건은 발송 표시가 남아 일반 재시도에서 빠진다(중복 대신 미발송 쪽 · 로그로만 드러남 · 상태 칸 없이는 화면 표시 불가) · 대표 수신자 거부 + 참조 전달 성공이면 재시도 때 참조 중복(종전 규칙) · 개별 발송 경로(billing.ts 정산서 메일)는 종전 구조 그대로 | invoice-retry-reuse 10 · billing-route-invariants 갱신 · **6차 묶음 Codex 5R approve** |
| R1-02 | 웹훅 중복 수신이 원래 전달 행 상태를 `duplicate`로 덮어 실패 행이 재처리(`failed`만 집음)에서 빠지던 것 → 5곳(cafe24·cdp·imweb·naver-commerce·woocommerce) 모두 **처리 완료(processed) 행만** 중복 표시 | webhook-duplicate-keeps-failed 5 · 경로 밖 |
| R1-31 | 쇼핑몰 연동 토큰 갱신이 어떤 오류든 `token_expired`로 바꿔 일시 장애 한 번에 웹훅이 유실되던 것(4곳 · 카페24·아임웹·메이크샵·네이버) → 판정 CT `utils/integration-token-error.ts`(`tokenHttpError`·`reconnectRequiredError`·`isDefinitiveTokenRejection` = 제공자 400·401·403 거절 · 자격 없음만 확정) · 토큰 요청이 상태코드를 오류에 싣고(문구 불변) 갱신 catch는 확정 실패일 때만 만료 표시 | integration-token-rejection 9 · 경로 밖 |
| R1-41 | **DM 공개 뷰어 저장형 XSS.** 옛 슬라이드 렌더러·머리말·꼬리말이 저장 값을 그대로 넣던 것 → 새 섹션 렌더러와 같은 CT(`escapeHtml`·`safeUrl`)로 모든 삽입값을 감싸고 색은 새 CT `safeColor`(dm-section-renderer.ts · #hex·rgb/hsl 숫자·이름만)로 · iframe·video 주소도 safeUrl · `<title>`·코드도 이스케이프. 평범한 값 표시는 불변(테스트) | dm-legacy-viewer-escape 5 · 보안 |
| R1-28 | DM 브랜드 추출 SSRF — `extractBrandFromUrl`만 일반 fetch로 리다이렉트를 따라가던 것 → 같은 파일의 `fetchHtmlGuarded`(사설·내부 주소 차단 · 홉마다 DNS 고정 · 200KB · 5초) · 상대 주소는 최종 도착 페이지 기준 | dm-brand-extract-guarded 3 · 보안 |
| R1-07 | 대행 메일 접수 워커가 DB 연결 획득 실패 시 `running`이 true로 남아 재시작 전까지 정지 → 연결 실패면 표시를 풀고 다음 주기 재시도 | agency-mail-tick-connect 1 |
| R1-03 | 인앱 메시지 PUT 게시가 잔액 확인 없이 먼저 active로 바뀌고 뒤에서 차감 시도(실패해도 게시 = 무료) → 게시 과금(멱등 `inapp-publish:{id}`)을 **전환 전에** · 실패면 게시 안 함(잔액 부족 402 · 그 밖 503) · 이미 과금된 재개·수정 = duplicate 통과. **남은 것(기록):** POST 게시는 잔액 확인 → 생성 → 차감이라 동시 소진 경합만 남음 | inapp-publish-charge-before 8 · **7차 묶음 Codex 3R approve**(1R high 2 = 과금 뒤 메시지 소멸 복구 불가 · URL id 원문 키 → **보상 순서**: 게시 → 정규 id 키로 과금 → 실패면 이전 상태로 되돌림 · 미과금이면 게시 전 잔액 확인 / 2R high 2 = 상태 생략 수정의 오판 과금·게시 중단(1R 회귀) · 동시 PUT 무과금 재게시 → 게시 판정은 active 요청 + 이전 상태 확정 조회일 때만 · 메시지 단위 잠금) |
| R1-25 | AI 자동마케팅 수정에서 혜택·리마인더 문안을 비우면 COALESCE로 옛 값이 남아 계속 발송 → 같은 UPDATE의 `copy_style` 모양(`'__keep__'` = 유지 · 빈 값 = NULL). 비면 발송 쪽이 안전하게 멈춘다(혜택 = [혜택…] 자리 잔존 → 출구 가드 · 리마인더 = 예약 안 함 + 관리자 알림) | operator-benefit-clear 2 |
| R1-20 | 다중 목표 충돌 분석: 회사 조회에 id가 없어 AI 관문의 회사별 월 호출 한도·캐시·통계가 꺼져 있던 것 → id 포함. **요금(0926 밤 Harold 결정 「단가표대로 5크레딧」):** 회사 id가 AI 관문에 전달되면서 단가표(고급 모델 5크레딧)가 이미 적용된다 — 코드 추가 없음 | multi-goal-company-id 1 |
| R1-39 | 이메일 클릭 추적이 속성의 `&amp;`를 그대로 원본 주소로 서명해 파라미터 2개 이상 링크(쿠폰·UTM)가 깨지던 것 → 추적 CT가 속성 엔티티를 풀어 서명(`decodeHrefAttribute`) | email-tracking-amp 2 |
| R1-43 | 여정 통계: 단계 클릭 수가 회사 조건 없이 전 회사 이벤트를 훑던 것 → 그 여정 회사만 · 전환 수가 저장되지 않는 이름 `order`를 세 항상 0이던 것 → 표준 이름 `purchase`(주문 저장 CT와 같은 이름 · 같은 파일의 요약 쿼리도 이미 purchase) | journey-stats-events 2 |
| R1-44 | 여정 스팸 사전검사 자동 재작성(사람 검토 없이 실발송 스냅샷 교체)이 원본에 없던 혜택을 만들면 버린다 — 대행 다듬기와 같은 혜택 차단 CT(`stripUnauthorizedBenefits`) · 버리면 자동 교체 없이 담당자 안내 | journey-refine-benefit-guard 2 |
| R1-45 | 인앱 AI 다듬기 3안 중 원본에 없던 혜택이 생긴 안은 변형으로 만들지 않는다(같은 CT). **(0926 밤 Harold 결정 「일시정지로 생성」)** 다듬기 변형은 `paused`로 만들고(검토 없이 노출 0) 사용자가 켠다 — 변형 상태 전환 CT `setVariantStatus`(회사·부모 확인) · `/cdp/inapp/variant` 'set_status' · 인앱 목록 행 [A/B 변형] 버튼 → 변형 검토 창(켜기·끄기) · 적용 안내 문구 갱신 | inapp-refine-benefit-guard 1 · inapp-variant-review 4 · 프론트 tsc 0 |
| R1-27 | **(0926 밤 Harold 결정 「발송 링크 수신자만」)** 재고가 걸린 룰렛 칸은 발송 토큰으로 확인된 수신자만 당첨(`pickRouletteForParticipant` · dm-interaction-core) · 공개 링크 참여는 재고 없는 칸에서만 뽑는다 · 결과에 `recipients_only` 기록 · 공개 뷰어 안내 문구. **범위 밖(기록):** lucky_draw 응모 풀도 공개 링크로 채울 수 있는 같은 부류 | roulette-recipient-only 5 |
| R1-49 | **(0926 밤 Harold 결정 「서명 없으면 비개인화」)** 회원 토큰 CT `cdp-member-token.ts`(`v1.payload.서명` · 서명 키 = JWT_SECRET에서 용도 분리 파생 · 기본 1시간 · 최대 24시간) · 발급 = `POST /api/cdp/member-token`(비밀키 인증 · 로그인 미들웨어 앞) · `/cdp/inapp/active`는 비밀키 서버 호출이거나 토큰이 이 회사·이 회원과 맞을 때만 개인화 값 · 그 밖 비개인화(노출 판정 불변) · SDK `memberToken` → `member_token` · 자동 수집은 body `data-hjl-member-token` | cdp-member-token 6 · SDK tsc·테스트 통과 · **SDK 배포 = build:all 체인(Harold)** |
| S1-H06 | **(0926 밤 Harold 결정 「브랜드 단가로 청구」)** 담당자 테스트 발송 브랜드 행 = `app_etc1 'test'` + bill_id(문자 테스트와 같은 자리 · `insertBrandQueue` 4번째 인자 · 안 넘기면 종전 구문) · 청구 유형 `TEST_BRAND`(전용 단가 칸 없음 · 브랜드 친구 단가 = 선불 차감과 같은 값 · 비면 미설정) · 두 집계 축 같은 판정 CT `testBillingTypeKey` · 발행 항등식 합류 · 라벨(유형 표 · PDF · 관리자 화면) · 테스트 결과 화면 3곳이 표시 CT(`getSendTypeLabel`·`getDisplayContents`)로 유형·본문 · 브랜드 금액 = 브랜드 단가. 과거 행(app_etc1 = 사용자 id)은 소급하지 않음 | billing-test-brand 10 · send-usage-aggregation 기대값 3건 갱신 · 백 6,160 통과 · **9차 Codex 1R critical·high 0** |
| R1-26 | DM 원클릭 3액션(AI 다듬기·디자인 맞춤·변수 정합)이 옛 `sections` 칸만 읽고 써서 요즘 DM(pages)에는 반영되지 않던 것 → 읽기 = `extractFlatSectionsFromDm`(pages 우선) · 쓰기 = 짝 CT `mapDmSections`(읽은 칸에 되쓰기 · 회사 조건 추가) | dm-quick-action-pages 6 |
| R1-15 | 단축 URL 클릭 이벤트의 `cdp_events.customer_id`가 몰 회원 연결로만 채워지던 것 → `trackEvent`에 `knownCustomerId`(발급 원장이 아는 수신 고객 · 단축 URL 라우트만 넘김) · 회원 연결이 못 채운 경우에만 INSERT 안 하위 조회로 그 회사 고객일 때만(지워진 고객 = NULL → FK 위반으로 이벤트를 잃지 않음) · 소비처(여정 클릭 분기·클릭 목표·미반응자 제외·예측 점수·고객 발송 통계) 전부 `customer_id` 축이라 함께 맞는다 | short-url-click-customer 5 |
| R1-22 | 소재 삭제 참조 판정을 **소재 주소를 그대로 저장하는 네 곳**으로(인앱 · DM pages·sections · 이메일 본문·편집기 섹션(M-39 대조 때 SCHEMA.md에서 `email_campaigns.sections` 발견 → 추가) · 끝나지 않은 카카오 브랜드 발송 첨부) — 파일명(uuid) 기준 한 조회 · 조회 실패 = 지우지 않음 · 거부 문구 갱신. MMS·SNS·이벤트 캠페인은 사본으로 옮겨 써 대상 아님(화면 18곳 전수 확인) · **배포 전 M-39** | asset-delete-references 4 |
| R1-34 | 주문 매출(RFM) **표식 먼저, 매출 나중** — 기존 이벤트는 조건부 UPDATE로 반영·차감 표식 선점(0행 = 더하거나 빼지 않음) · 새 주문은 표식을 실은 이벤트 기록이 먼저(실패 = 매출 미반영 + 오류 → 웹훅 재시도) · 매출 반영 실패 = 표식을 명시 false로 되돌리고 오류(키 삭제는 옛 데이터 호환 규칙이 "반영됨"으로 읽어 금지) · 같은 주문은 공용 잠금 CT로 한 줄 | cdp-order-revenue-once 8 · 기존 store-code 2 |
| R1-35 | 날씨 값에 `temp`·`condition`(영문 상태) 추가 · `weather.summary·temp·condition` = 고객 지역 값(AI 지시문·이미 저장된 여정 문안이 쓰는 이름 → 값 쪽을 맞춤) · **모르는 날씨는 지어내지 않는다**: API 키 없음·호출 실패·상태 없음·못 알아본 지역이면 null(옛 '맑음'·'서울' 기본값 제거 — 이름만 맞추면 가짜 맑음이 문자에 실리므로 함께) · 매장 날씨도 같은 함수라 함께 · **M-40** | connected-weather-vars 6 |
| R1-21 | AI 타겟 추출 "전체"는 **조건이 비었고 입력이 조건 없는 전체 요청일 때만**(허용 목록 `isPlainAllCustomersRequest` = 전체를 뜻하는 말·채움말을 지우고 남는 것이 없어야) · AI가 조건을 뽑았으면 플래그와 모순이어도 조건이 이긴다(옛: 조건까지 버리고 전체) · 그 밖의 빈 조건 = EMPTY_FILTER(되묻기) | ai-segment-all-guard 17 |
| R1-30 | 카페24 스크립트태그가 지금 주소(키·SDK 판)와 다르면 **새 태그 먼저 올리고 옛 태그 삭제**(올리기 실패 시 옛 태그 유지 = 수집 안 끊김 · 옛 키 태그는 폐기된 키라 겹쳐도 이중 수집 없음) · CDP 키 재발급 직후 그 회사 카페24 몰 전부 재맞춤(격리 · 응답 무영향) | cafe24-scripttag-rekey 5 |
| R1-05 | ~~음성 웹훅 서명 판정~~ → **음성 AI 기능 자체를 제거(0926 Harold 결정 「음성 AI는 필요 없다 · 제거」)** · 근거 = M-41(켠 회사 0 · 통화 이력 0 · 메뉴 없는 실험실 화면) · 제거 = routes/voice.ts · utils/voice-inbound.ts · utils/naver-clova-client.ts(다른 사용처 0) · `/api/voice` 등록 · 단가 'voice-inbound' · 기능 안내 항목 · 프론트 VoiceInboundPage·`/voice-inbound` 경로 · 고객 타임라인 '문의' 종류(음성 통화 테이블만 읽던 칩 · 12 → 11종) · 운영 문서 환경변수 절. 남김 = 빈 테이블·컬럼(DB 삭제는 별도 과제) · 프론트 크레딧 라벨 '음성 분석'(과거 사용 내역 표시 전용) | voice-inbound-removed 5 · customer-timeline 종류 수 11로 갱신 · 백 6,084 통과 |
| R1-42 | 인앱 통계 드릴다운을 열 때마다 유료 AI 진단(1크레딧) 자동 호출 → **"AI로 분석하기" 버튼 1클릭**(단가 = 원장 `AI_GENERATE_COSTS` · 다른 메시지로 옮기면 늦은 응답 버림). 같은 패턴 전수: 자사몰 설정 "데이터 분석" 창의 자동 진단(5크레딧) 제거(창 안 시작 버튼 유지) · 성과 페이지 "AI 자율 진단" 창은 이름 그대로 진단 요청 카드이고 한 번 받은 뒤 다시 부르지 않아 유지 | inapp-drilldown-explain-on-click 4 · 프론트 tsc 0 |
| R1-01 | 주소록 저장·추가 = 적재 CT(`insertAddressBookContacts`) unnest 한 문장(전부 저장 또는 전부 안 함 · 왕복 1번) · 옛: 연락처마다 INSERT 대기 · 트랜잭션 없음 | address-book-bulk-insert 3 · 기존 address-books 5(추출만 배열 펼치기로) |
| R1-14 | 분석 미리보기 이탈 위험 고객 수 = NOT EXISTS 카운트 한 행(같은 뜻) · 옛: 이탈 고객 1명당 1행을 가져와 rows.length. 같은 파일의 이탈 상위 20명 조회는 목록이라 대상 아님 | analysis-churn-count 2 |
| R1-29 | (반복 부하분) 원스텝 DM 생성이 섹션마다 문안두뇌(회사 RAG·브랜드 키트)를 다시 읽던 것 → 루프 앞 한 번(`resolveDmCopyBrainSuffix`) · 다른 호출부는 동작 불변. **남은 것:** 섹션별 AI 호출 병렬화는 공급사 동시 호출 한도 영향이 있어 소요 시간 실측(M-43) 뒤 | dm-oneshot-brain-once 3 |
| R1-40 | 이메일 bounce·스팸 신고·수신거부 자동 처리가 주소가 정확히 같은 고객 행만 거부하던 것 → `lower(email) = lower($2)`(직접 명단 경로 읽기와 같은 판정) | email-unsub-case 1 |
| R1-18 | (0926 저녁 Harold 「유료 사용 업체 0 · 확정 결함은 측정 없이 미리 수정」 → 측정 없이 처리) DM 추적 CT 고정 `LIMIT 1000` 제거(선택 상한만) · 요약·세그먼트 수는 서버가 **전체 수신자**로 · 화면 목록만 1천(응답·렌더 크기 종전과 같음) + 전체 수·잘림 표시 · CSV는 잘렸으면 `full=1`로 전체 · 후속 발송은 화면이 id 대신 **세그먼트 키**를 보내고 서버가 발송 시점에 같은 판정 CT(`classifyDmRecipientSegments`)로 전체에서 다시 뽑는다(옛 id 지정은 옛 화면 번들 호환) · AI 학습 워커도 전체 기준 | dm-tracking-all-recipients 6 · 프론트 tsc 0 |
| R1-16 | **보류(설계).** 싱크 배치마다 회사 전체 수신거부 재대조 — 법정 경로다. 배치 뒤로 미루는 방식(디바운스)은 재대조 전 창에 직접발송(수신거부 표만 보는 경로)이 거부 번호로 나갈 수 있어 쓰지 않는다. 배치 번호로 좁히려면 CT-03(`registerBulkCompanyUserUnsubscribes`) 번호 한정판이 필요 → 컨트롤타워 변경 절차(workflow_7_1)로 별도 | 착수 전 설계 |
| F07 | 후불 청구 대상 선택이 여정 단계 캠페인(campaign_runs 없음 · 직접 배관 아님)을 어느 축에도 담지 않아 후불 여정 발송이 0원이던 것 → 여정 단계 캠페인을 **기간 조건 축(periodCampaignIds)** 으로(큐 app_etc1 = 단계 캠페인 id · 문자·알림톡 공통) · 후보는 생성일 앞뒤 하루(자정 경계) · 수량은 큐 sendreq_time 기간이 정해 이웃 달 이중 계상 없음 · 선불은 발행 대상 아님(billable) | billing-journey-axis 4 · 기존 send-usage-aggregation 전부 통과 · **8차 Codex 1R 지적 0** |
| R1-08 | 대행 접수 SMS/LMS를 **실제 문장 바이트**로 — 조립 CT(`measureAgencyMaxSmsBytes` · `prepareSendMessage` · 광고 표기·무료거부 줄·실제 080 · 변수 값 가중 상위 5명 실제 조합)로 가장 긴 문장을 잰다. 원스텝·메일 = 분석이 바이트로 유형 결정 · **화면 접수 = 'AUTO'로 보내 접수 코어가 실제 넣을 수신자(중복 제거 뒤)로 확정**(한도 안 = SMS · 넘으면 제목 필요 = `SUBJECT_REQUIRED_LONG` 반려 · 명시 SMS 초과 = `SMS_TOO_LONG`) · 화면은 막지 않는 안내만(`/sms-bytes` · 후보 20 · 번호 정규화 = 코어 미러 `normalizeAgencyPhoneFront`) | agency-sms-bytes 13 · 기존 agency-dispatch-callback-guards 통과 · **8차 Codex 1R·2R·3R high 각 1(모두 "화면 판단이 유형을 정함" 같은 뿌리 → 구조를 단계적으로 끊음: 수신자 조합 유지 → 코어 확정 AUTO → 제목 강제 제거·정규화 일치) → 4R approve** |
| R1-24 | 생성 워커가 희망 시각이 지난 뒤 돌면 이번 회차를 말없이 건너뛰던 것 → 동작(늦게 보내지 않음)은 그대로 · 건너뛴 사실을 담당자에게 운영 알림(무과금 인증 라인 · 같은 회차 1번 · `detectMissedOperatorRound` 순수 판정) | operator-missed-round 4 |
| F39 | 여정 실행기 5분 100건(전사 공유) → 한 주기 안에서 시간 예산 4분 동안 100건 묶음 반복 · 묶음마다 회사당 25 상한(큰 회사 독차지 방지) · 이번 주기에 집은 실행은 다시 집지 않음(실패 행 반복 방지 · 재시도는 다음 주기) | journey-executor-drain 4 |
| R1-29 | (속도분) 원스텝 DM 섹션 카피 AI 호출을 동시 3개로(입력 순서 보존 CT `mapWithConcurrency` · 실패 격리 종전 그대로) | dm-oneshot-brain-once +1 |
| R1-35 후속 | 날씨 연결(키)이 없으면 AI 지시문이 날씨 변수를 쓰게 하지 않는다 — 지시 블록을 날씨 CT가 소유(`buildWeatherPromptBlock` · `buildWeatherRefineRule` · 원문 이동) · 키가 있으면 종전 글 그대로 | weather-prompt-gate 3 |
| R1-17 | 수신거부 파일 등록 = 같은 등록 CT를 동시 5건으로(번호끼리 독립 · 판정 불변 · 결과는 입력 순서) | unsub-upload-concurrency 2 |
| R1-27·R1-45·R1-49·S1-H06·R1-20 | **0926 밤 Harold 결정으로 전부 닫음** — 처방은 위 각 행 | 닫힘 |
| S1-H09 | **(0926 밤 · 앱 소스 C:\spam 확인: 첫 화면 "API 토큰" 칸 · [등록] = 저장 후 기기 재등록)** 소스 기본 토큰 제거 · 판정 CT `spam-app-auth.ts`(`SPAM_APP_TOKEN` 현재 + `SPAM_APP_TOKEN_PREV` 교체 기간 · 상수시간 비교 · 둘 다 없으면 503 `SPAM_APP_TOKEN_UNCONFIGURED` + 서버 오류 로그) · `/report`·`/devices` 적용. **배포 순서(운영):** 새 토큰 + PREV = 옛 기본값으로 .env 설정 → 배포 → 폰마다 앱 토큰 칸 교체·[등록] → PREV 삭제·재시작 | spam-app-token 4 |
| S1-H05 | 템플릿 수정 성공 직후 IMC 단건 재조회 → 보낸 값(본문·버튼 수·강조 제목·보조 문구·부가정보·헤더·이미지·대표 링크 모바일)이 응답에 모두 같을 때만 발송 항목을 IMC 값으로 맞춤(CT `alimtalk-template-mirror.ts` · 역변환 = 이관 경로 `fromImcButtons`·`fromImcRepresentLink`) · 어긋나거나 재조회 실패 = 종전 동작 + 로그. IMC가 빠진 키를 지우든 두든 맞는 구조(추측 없이 · Harold 「임의로 수정해 볼 수 없다」 → 측정 없이 닫음) · 컬럼 = 기존 수정 UPDATE가 쓰는 것만 | alimtalk-template-mirror 4 |
| S1-H03 | **(0926 밤 Harold 결정 「별도 프로세스에서 읽기」)** 대행 요청서·명단 파싱을 자식 프로세스로(CT `agency-send-parse-isolated.ts` · 진입 `workers/agency-parse-child.ts` · 요청 1건 = 프로세스 1개 · 준비 신호 뒤 버퍼 전달 · 결과 = 종전 파서 값 그대로) · 원스텝 분석(넘겨받지 않은 파일만)·메일 워커 적용 · 자식을 못 띄우면(ts-node 등록 모듈 없음 · 준비 전 종료) 종전처럼 이 프로세스 · 준비 뒤 죽음·시간 초과(120초) = 읽지 못함 반려(같은 파일을 여기서 다시 읽지 않음) · 자식은 DB 설정 모듈을 연결 없는 빈 모듈로 채운 뒤 파서를 불러 DB 연결 0. 실측(로컬): 20만 행 자식 2.1초 · 본 프로세스 최대 멈춤 29ms(옛 = 파싱 시간 전부) · 작은 파일은 기동 약 0.6초 추가 | agency-parse-isolated 6 · 대행 테스트 9파일 131 통과 |
| F28·R1-32 | **보류(사유).** F28 = 라이브·로그 테이블을 가로지르는 고유 정렬 키가 없고(알림톡 대체 행이 번호·시각 공유) 한 번에 스트리밍하면 발송과 같이 쓰는 MySQL 연결을 붙잡는다 · R1-32 = 로컬 이미지 동기 읽기(짧음) 대비 견적·생성 인터페이스 전면 비동기화 | 기록 |
| R1-17·R1-23·R1-32·R1-37·R1-47 | **이번 범위에서 변경 없음.** R1-17 수신거부 파일 등록 순차 호출 = 법적 경로 CT(registerUnsubscribe) 일괄화는 별도 설계 · R1-23 전체 분석 끝 차감 실패 무료 완료 = `deductCreditSafe` 공통 설계 · R1-32 자동제작 견적 이미지 동기 읽기 = 개수 상한 확인 뒤 · R1-37·R1-47 = M-11로 낮음(보존 기한과 함께) | 기록만 |

- **배포 전 필수 측정 = M-28**(차감 설명이 길어지고 새 환불 키가 들어간다 — 컬럼 길이·제약 확인) · **M-39**(R1-22 참조 판정·R1-01 적재가 읽고 쓰는 컬럼) · **M-41**(R1-05 음성 웹훅).
- **배포 뒤 실측 1건(F01·F04):** 선불 테스트 회사로 알림톡 2건(1건 성공 · 1건 없는 번호로 대체 LMS) → ①차감이력 설명에 `결과별 정산:` 문구 ②30초 뒤 환불 `알림톡 결과별 단가 차액 환불 (LMS N원)` = 성공 1 × (LMS − 알림톡) ③30분 뒤 `초과 환불 reverse`가 차액을 빼가지 않는지 ④pm2 로그 `[불변식위반]` 0.
- **추가 과제 A-06(9차 Codex 범위 밖 · 코드 확인 성립):** 담당자 테스트 발송(campaigns.ts `/test-send`)에서 선불 차감 뒤 `getTestSendTable`·`getOpt080Number`가 던지면 바깥 catch로 빠져 환불 루프를 건너뛴다(차감만 남음). **A-07:** 최소과금 정액 발행(billing-issue.ts `issueMinimumChargeBilling`)이 후불 판정을 원장 조회·회사 잠금 전에 한 번만 해, 그 사이 선불 전환이 커밋되면 통과할 수 있다.
- **추가 과제 A-05:** 알림톡·브랜드 대체발송 성공 수신자의 부모 행 실패 환불 → 30분 뒤 회수(flip-flop). 최종 금액은 맞지만 고객 이력에 환불·회수가 함께 남는다. 고치려면 sent_count(대체 행 포함) 축부터 바꿔야 한다.

## 3. 측정 대기 (읽기 전용 · 하나씩)

| ID | 확인할 것 | 대상 |
|---|---|---|
| **M-28** | **(배포 전 필수 · F01·F04)** balance_transactions의 description·refund_key 타입·길이 · CHECK 제약 · 현재 최장 설명 길이 — 알림톡 차감 설명이 약 60자 길어지고 새 환불 키 `kakao_diff`(10자)가 들어간다 | **Harold 실측 0926: 통과.** description = text(길이 제한 없음) · refund_key = varchar(32)(코드 키 최장 10자) · reference_type varchar(30) · message_type varchar(10) · 제약 = pkey·FK 2개(company_id·created_by)뿐 · CHECK·UNIQUE 없음 → 새 키·긴 설명 저장에 막힘 없음 |
| M-29 | (F02·F37 과거분) 워커 바깥 catch가 `failed`로 굳힌 직접발송 캠페인 — 선차감이 남았을 수 있는 건수·회사·금액(배포해도 과거 failed는 자동으로 안 풀린다) | **Harold 실측 0926: 0행**(선불 회사 · send_phase='failed' · 차감 > 0) → 옛 catch가 굳힌 과거 미환불 없음 · 소급 조치 불필요 |
| M-30 | (F05·F06·F11 규모) 선불 회사 여정 발송 차감 건수·금액(최근 90일) — 환불 경로 신설 전 과거 미환불 규모 | **Harold 실측 0926: 0행(전 기간)** → 선불 회사 여정 차감 이력 자체가 없다 · 과거 미환불 없음 · 소급 조치 불필요 |
| M-31 | (F07 결정용) 후불 회사 여정 발송 성공 건수 | **불필요(0926 저녁)** — 유료 사용 업체 0 · F07은 측정 없이 결함으로 수정 |
| M-32 | (S1-H09 착수 판정) 운영 백엔드 프로세스에 SPAM_APP_TOKEN이 설정돼 있는가 — **값은 출력하지 않고 개수(0/1)만**. 0이면 기본값 제거 = 테스트폰 앱 인증 전부 실패라 ENV 설정이 먼저다 | pm2 env(targetup-backend) |
| M-33 | (F35 배포 전) 옛 건수형 취소 환불 의무가 남은 캠페인 수·상태 — 배포 뒤 정산 모드와 섞이는 대상(재취소 없이 남은 것은 옛 경로로 처리된다) | **Harold 실측 0926: 0행** → 배포 뒤 옛 경로로 처리될 잔존 의무 없음 · 대조 불필요 |
| M-34 | (F39 착수 판정) 여정 실행 적체 | **불필요(0926 저녁)** — F39 측정 없이 수정 |
| M-35 | (F28) CSV 내보내기 소요 시간 | **불필요** — F28은 설계 사유로 보류(§2-10) |
| M-36 | (S1-H05) 테스트 템플릿 1건에서 강조 제목·대표링크를 지우고 수정 → IMC 단건 조회 원문에 그 항목이 남는가(빠진 키 = 삭제인지 유지인지) | 화면 수정 1회 + pm2 로그의 IMC 응답 |
| M-37 | (S1-H03) 대행 명단 행 수 | **불필요** — S1-H03은 배포 구조 사유로 보류(§2-10) |
| M-38 | (R1-18) DM 수신자 수 분포 | **불필요(0926 저녁)** — R1-18 측정 없이 전체 기준으로 수정 |
| **M-39** | **(배포 전 · R1-22·R1-01)** 참조 판정·적재가 쓰는 컬럼 실측 — dm_pages(pages·sections·company_id) · email_campaigns(html_body·sections·company_id) · campaigns(kakao_attachment_json·kakao_carousel_json·status·company_id) · address_books(phone·name·extra1~3·user_id 타입) | **Harold 실측 0926: 통과(18행 전부 존재).** 반영 2건 = ①`email_campaigns.sections` 참조 추가(대조 중 발견) ②`campaigns.status` NULL 허용 → `COALESCE(k.status, '')`로 NULL을 끝나지 않은 발송으로 판정. 주소록 = phone varchar(20) · name 50 · extra1~3 100 · group_name 100 → 한도를 넘는 값이 있으면 옛날처럼 앞쪽만 저장되지 않고 전체가 저장되지 않는다(오류 응답은 같다) |
| M-40 | (R1-35) 날씨 키 설정 여부 | **불필요(0926 저녁)** — 코드가 키 유무로 AI 지시문을 스스로 가른다(R1-35 후속) |
| **M-41** | **(배포 전 · R1-05)** 음성 기능을 켠 회사 수 · 최근 30일 음성 통화 수 · VOICE_WEBHOOK_SECRET 설정 여부(**개수만**). 켠 회사·통화가 있는데 비밀값이 없으면 배포하면 음성 응답이 멈춘다 → 비밀값·게이트웨이 서명 먼저 | **Harold 실측 0926: 켠 회사 0 · 최근 30일 통화 0 · 통화 이력 자체 없음 → 배포해도 멈출 음성 응답이 없다. 비밀값 확인 불필요(결과가 결정을 바꾸지 않음).** → 이 결과로 음성 AI 기능 자체를 제거(R1-05 행) |
| M-42 | (R1-16) 싱크 재대조 비용 | **불필요** — R1-16은 법정 경로 설계 사유로 보류(§2-10) |
| M-43 | (R1-29) 원스텝 소요 시간 | **불필요(0926 저녁)** — 동시 3으로 바로 개선 |
| M-01 | 고객 전체삭제 실행 이력 수와 시점 | audit_logs action='customer_delete_all' |
| M-02 | MySQL 서버 sql_mode에 NO_BACKSLASH_ESCAPES가 있는가 | MySQL `@@GLOBAL.sql_mode` |
| M-03 | AI 운영자 승인 발송 중 수신자 1만 명에 닿은 건 | campaigns(AI 운영자 경로) target_count |
| M-04 | 후불 회사에 overage_credits>0 거래가 있는가 | ai_credit_transactions × companies.billing_type |
| M-05 | processing으로 오래 남은 직접발송 캠페인 수 | campaigns send_phase='processing' |
| M-06 | 카페24 웹훅 status별 건수(duplicate 비율) | cdp_webhook_deliveries source='cafe24' |
| M-09 | 테이블별 크기 상위 25(행 수 · 전체 크기) — S4-01 보존 기한 우선순위 | **Harold 실측 0926:** customers 939MB · **campaign_send_staging 863MB(240만 행)** · purchases 647MB · cdp_customer_predictions 444MB · unsubscribes 299MB · send_fatigue_daily 253MB · cdp_identity_links 251MB · 로그성 14종은 모두 50MB 이하 → S4-01 낮음 · S1-H08 격상(§2-5 반영) |
| M-12 | 스테이징 잔존 240만 행이 어느 경로에서 남았나(연결 캠페인 없음 / 캠페인 상태·단계별) — S1-H08 처방 결정 | **Harold 실측 0926: 전량(1,218건 · 2,401,096행)이 연결 캠페인 없음.** 발송까지 간 스테이징은 워커가 지우고 있다 → 남은 것은 전부 "적재만 하고 보내지 않은" 분량. 원인 = 직접발송·알림톡 창이 발송 버튼마다 확인 창 **전에** 수신자 전체를 새 stagingId로 적재(frontend DirectSendPanel.tsx:664 `stageAndConfirm` · AlimtalkSendModal.tsx:557) → 확인 창 취소·재클릭·청크 도중 실패분이 남는다. 전화번호·이름 무기한 보관 |
| M-13 | campaign_send_staging 실제 컬럼·인덱스(시각 컬럼 유무) — 정리 워커 설계(DDL 필요 여부) | **Harold 실측 0926:** `created_at timestamptz DEFAULT now()` 있음 · 인덱스 = pkey(id) · (staging_id, id) · (company_id, created_at) · (staging_id, phone) → **정리 워커에 DDL 불필요.** 시각 컬럼·인덱스는 0530 대량 발송 설계서(docs/superpowers/plans/2026-05-30-bulk-send-pipeline.md:40·43)가 만들었지만 정리 작업은 끝내 만들지 않았다(코드에서 created_at으로 읽는 곳 0) |
| M-10 | PG 서버·사용자 수준 statement_timeout 기본값 — S5-06 처방 여부 | **Harold 실측 0926: `0`(상한 없음)** → S5-06 성립 확정. 처방(API·워커 구분 상한)은 브레인스토밍 안건 |
| M-11 | cdp_events·cdp_inapp_impressions 실제 인덱스 — R1-37·R1-47 처방 여부 | **Harold 실측 0926:** cdp_events 인덱스 9개 · received_at은 `(trust_level, received_at)`의 둘째 칸뿐이라 R1-37 조회(received_at만)는 못 탄다 = 전체 스캔 확정. 다만 지금 3.7만 행이라 비용 작음 → R1-37·R1-47 낮음으로 조정(보존 기한과 함께) |
| M-14 | 한 번도 안 쓰인 인덱스(유일 인덱스 제외)와 크기 · 통계 기준 시각 — 쓰기마다 비용만 내는 인덱스 정리 후보 | **Harold 실측 0926:** `stats_reset` 비어 있음(관찰 기간 확정 불가 → 판정은 코드로) · 0회 인덱스 30개 중 큰 것 6개 = customers `idx_customers_custom_fields`(GIN) 153MB · cdp_identity_links `_email` 35MB · `_phone` 29MB · purchases `idx_purchases_product` 23MB · user_sessions `idx_user_sessions_token` 15MB · customers `idx_customers_primary_source` 5MB → §2-5 S4-03. 나머지 24개는 각 16~120kB(flyer_* 11개 = 한줄전단 테이블 · 건드리지 않는다) |
| M-15 | 죽은 행이 많은 테이블(부풀림) — autovacuum 조정·정리 후보 | **Harold 실측 0926:** staging 15만(정리 워커로 해소) · send_fatigue_daily 11만 · customer_stores 10만(18%) · 나머지 10% 미만 → autovacuum 기본 기준(20%) 안이라 조정 불필요. user_sessions 46MB는 죽은 행(3.8천)이 아니라 행 폭(JWT 원문 저장) + 미사용 인덱스 15MB 때문(§2-3 S2-05) |
| M-17 | 인덱스 삭제 전 DB 안 사용처: 삭제 대상 6개 컬럼을 본문에 쓰는 public 함수 · 대상 4개 테이블의 사용자 트리거(Codex 1R next step · 코드로 볼 수 없는 부분) | **Harold 실측 0926:** 해당 컬럼을 쓰는 함수 0 · 트리거 = customers에 BEFORE UPDATE 2개(`tr_customers_updated` → `update_timestamp()` · `update_customers_updated_at` → `update_updated_at_column()`) · 두 함수 본문에도 대상 컬럼 없음(같은 검색 0행) → **S4-03 삭제 안전.** 트리거 2개가 같은 일(updated_at 갱신)을 겹쳐 하는지 = M-18 |
| M-19 | S4-03 삭제 뒤 느려진 화면이 없는지 — DB 가동 시간(=idx_scan 관찰 기간) · 같은 테이블 다른 인덱스 사용량 · 전체 스캔 기준값(0926) → 다음 날 같은 쿼리로 seq_scan 증가분 대조 | **Harold 실측 0926:** 가동 70일(2026-07-17~) · 같은 테이블 다른 인덱스는 수만~수천만 회(customers phone 3,260만 · pkey 2,941만 · purchases customer 84만 · user_sessions pkey 92만) → 삭제한 6개가 70일 동안 0회였다는 것은 어떤 화면도 이 인덱스를 쓰지 않았다는 뜻 · 실행 계획 불변. **기준값(2026-09-26 00:13 UTC):** customers seq_scan 47,974 / seq_tup_read 5,264,253,918 · purchases 170,163 / 208,452,781 · cdp_identity_links 388 / 4,863,963 · user_sessions 80 / 1,353,980 → 다음 날 같은 명령으로 증가분 대조. ⛔ **새 단서: customers 전체 스캔이 70일에 약 4.8만 회(하루 약 685회 · 평균 11만 행) · 52억 행 읽음** = 조회 성능 개선의 1순위 후보(S5-01·02·03 같은 고객 전체 스캔) → M-20. 추가 발견: user_sessions `user_sessions_session_token_key`(UNIQUE) → S2-05 정정 |
| M-20 | 조회 성능 1순위 찾기 — pg_stat_statements 사용 가능 여부 · 전체 스캔으로 읽은 행이 많은 테이블 순위 | **Harold 실측 0926:** pg_stat_statements 1.10 켜져 있음(shared_preload_libraries). 전체 스캔 읽은 행 순위(70일): ① **balance_transactions 1.4만 행인데 1,938만 번(초당 약 3.2번) · 1,161억 행** ② **campaigns 2.6만 행 · 519만 번(하루 약 7.4만) · 1,022억 행** ③ customers 4.8만 번 · 52억 ④ campaign_runs 29만 번 · 11억 ⑤ users(316행) 260만 번 · 6.9억 ⑥ cdp_inapp_impressions 67만 번 · 4.3억(R1-47) ⑦ purchases 17만 번 · 2억 ⑧ sync_logs 3.8만 번 · 1.7억 ⑨ kakao_templates 3.4만 번 · 0.8억. → ①② 두 작은 테이블을 쉬지 않고 통째로 읽는 것이 DB 헛일의 대부분(초당 약 3.6만 행). 어떤 SQL인지 = M-21 |
| M-21 | 전체 스캔을 일으키는 SQL — pg_stat_statements 누적 시간 상위 · balance_transactions·campaigns를 읽는 SQL 호출 수 상위 | **Harold 실측 0926** → §2-9 P-01~P-07 |
| M-23 | P-03 이메일 매칭이 느린 이유 — 이메일 인덱스 식의 값 쏠림(값은 출력하지 않고 빈도만) | **Harold 실측 0926:** null 66% · 나머지는 거의 전부 서로 다름 · 몰린 값 없음 → 쏠림이 아니다. 남은 가설 = `ORDER BY created_at LIMIT 1` 때문에 플래너가 이메일 인덱스 대신 생성일 순으로 회사 고객을 훑는 경우(미확인 · 실행 계획으로 확정) |
| M-27 | **F01·F04 선불 알림톡 과다 차감 운영 영향(1단계 · PG 상한)** — 선불 업체의 알림톡 캠페인(`send_channel='alimtalk'` 또는 자동발송 `auto_campaigns.channel='alimtalk'`) 업체·경로·유형별 캠페인 수 · 성공 · 차감액 · 환불액 · 현재 단가. 성공에는 문자 대체 발송분이 섞여 있어 상한이다 → 금액이 있으면 2단계(MySQL 결과 테이블에서 카카오 성공·대체 분리) | **Harold 실측 0926: 선불 알림톡 전 기간 1건** — (주)이에스페이먼트 · direct · LMS · 2026-09-14 · 성공 1 · 차감 28원(LMS 25원 VAT 포함) · 알림톡 단가 5원(VAT 포함 5.5원) → **과다 차감 최대 약 22원**(그 1건이 문자 대체 발송이었으면 0). 2단계 측정 불필요. 결함은 선불 알림톡 사용이 늘기 전에 고친다 · 정책 결정 필요 |
| M-24 | **화면 조회 전수(Harold 0926: 통계·캠페인 조회·예약 내역·메시지 조회 전부)** — 7/17부터 쌓인 `[SLOW Nms]` API 로그(500ms+ · app.ts:369)를 경로별로 모아 건수·평균·최대 순위 | **0926 실행 결과 출력 없음** — `~/.pm2/logs/`에 `targetup-api-out*` 파일이 없다(로그 파일 이름·위치 미확인). Harold 0926 「지금도 속도는 나쁘지 않다 · 반복 부하와 불필요 소모를 없애자」 → 후순위 |
| M-26 | **반복 작업 전체 목록** — pg_stat_statements 호출 수 상위 40(주기 작업이 호출 수로 드러난다) → 워커 43개와 대조해 헛도는 것 전수 | **Harold 실측 0926** → §2-9 P-09(정산 스위퍼의 헛 트랜잭션·회사 행 잠금 약 2,000만 회) · P-10 · P-11 · P-12. P-04(검수 폴링)가 부르던 3종(UPDATE 119만 · 템플릿코드 조회 119만 · 알림 수신자 조회 118만)도 확인 → 설계안 B로 제거 |
| M-25 | 메시지 조회·통계·예약 화면이 읽는 MySQL(QTmsg 라인별·월별 결과 테이블) 쿼리 부하 — pg_stat_statements의 MySQL판 | `performance_schema.events_statements_summary_by_digest` |
| M-22 | P-01~P-05 처방 전 사실: campaigns·balance_transactions·customers(이메일)·kakao_templates·cdp_events 현재 인덱스 정의 · balance_transactions 조회 컬럼 타입 · 검수 폴링 대상 템플릿 분포(상태 × 알림 여부) | `pg_indexes` · `information_schema.columns` · kakao_templates 집계 |
| M-18 | customers 트리거 두 함수의 본문 — 겹치면 고객 갱신마다 트리거 1개분 헛일(S4-04 후보) | `pg_proc.prosrc` (update_timestamp · update_updated_at_column) |
| M-16 | 인덱스 정리 전 확인: 6개 인덱스의 실제 정의(되돌리기 DDL) · `user_sessions.session_token` NULL 허용 여부 · jsonb 포함 연산자를 쓰는 DB 뷰 유무 · PG 버전 | **Harold 실측 0926:** 정의 6개 확보(되돌리기 = 아래 정의 그대로 `CREATE INDEX CONCURRENTLY`) — `cdp_identity_links(company_id, external_email) WHERE external_email IS NOT NULL` · `cdp_identity_links(company_id, external_phone) WHERE external_phone IS NOT NULL` · `customers USING gin (custom_fields)` · `customers(company_id, primary_source) WHERE primary_source IS NOT NULL` · `purchases(product_code)` · `user_sessions(session_token)`. `session_token` = **NOT NULL** varchar. jsonb 포함 연산자 쓰는 뷰 0. PostgreSQL 15.15 |
| M-08 | 배포 뒤 워커가 자동 정리·환불할 과거 캠페인 수(`queued`+취소 · 10분 넘은 `processing`) | **Harold 실측 0926 새벽: 0행** → 배포 직후 소급 정리·환불 대상 없음(측정 시점 기준) |
| M-07 | 운영에서 이니시스 카드 결제가 켜져 있는가 | **Harold 확인 0925: 운영 중(건수 적음)** → C-14는 지금 열려 있다. 완료 결제 36건(2026-05-28 ~ 09-23 KST · 합계 8,714,600원) 조회 0925: tid 36건 모두 `Stdpay{CARD\|ISP_}usomsms001{KST 시각}` 형식 · tid 시각이 paid_at보다 0~5초 앞(어긋남 0). 형식은 위조로도 만들 수 있어 확정은 이니시스 가맹점 관리자 승인 내역(건수·합계) 대조로. **Harold 대조 0925: 이니시스 8,734,600원 = DB 완료분보다 20,000원 많다** → 이니시스 승인분 중 DB에 completed로 없는 돈 추적 중. DB 비완료 54건(pending 43 · failed 9 · cancelled 2) 모두 pg_payment_key(tid) 없음 → 우리 DB만으로는 특정 불가 · 이니시스 쪽 주문번호로 대조 필요 |


> 명령은 SCHEMA.md 대조 후 접속 명령과 함께 하나씩 드린다.

## 4. 메모 (개선 여지 · 올드 디자인)

**올드 디자인·톤 불일치 (0926 · 코드 기준 · 화면 실측 아님)**
- 페이지 최상위 배경이 7갈래로 갈린다. 밝은 회색 `gray-50·100`(Dashboard · CalendarPage · PricingPage · PushCampaignsPage · AlimtalkSendersPage · PaymentResultPage · AdminCampaignAgencyPage · OutreachGrabPage) / 연한 중립 `neutral-50`(Settings · Unsubscribes · AgencySendPage · AgencyApprovePage · ChargeApprovePage) / 연한 그라데이션 `slate-50→`(AutoSendPage · AiBatchesPage · AiExplainPage · VoiceInboundPage · 약관·개인정보) / `slate-50`(ManagePage · AdminDashboard) / 보라 그라데이션 `violet-900→`(AiOperatorPage · SegmentsPage · OnboardingWizardPage · JourneyPausePage) / 어두운 `slate-950`(CampaignAgencyPage · DiagnosisPage · BestLayoutPage · AiTrainingDataPage · BestCopyPage · Cafe24LaunchPage). 메뉴를 옮길 때마다 톤이 바뀐다. 신규 화면 하한은 다크 slate-950(design_quality 룰)이라 밝은 쪽이 옛 화면이다.
- 밝은 톤 클래스가 어두운 톤보다 많은 파일 61개. 고객이 자주 여는 것 중 비중이 큰 순서: AiCustomSendFlow(91/22) · AutoSendFormModal(90/14) · AnalysisModal(71/23) · manage/StatsTab(66/7) · manage/CallbacksTab(57/12) · ResultsModal(55/23) · CustomerDBModal(52/7) · BalanceModals(49/15) · StatsTab-company(39/5) · CardDetailModal(36/16) · ManageCustomersTab(36/9) · ScheduledCampaignModal(35/13) · CalendarPage(30/2). 관리자 화면 AdminDashboard는 14,548줄에 밝은 톤 1,261곳.
- 0925에 개편한 발송 창(직접발송·알림톡·브랜드·직접입력)과 그 창을 여는 대시보드 본체의 톤이 다르다(대시보드 = gray-100).
- 판단(어느 톤으로 통일할지 · 어느 화면부터)은 디자인 결정이다. 브레인스토밍 안건으로 넘긴다.

**성능 개선 여지**
- 빌드 난독화(vite.config.ts `stringArrayEncoding: ['base64']`)가 문자열을 base64 배열로 바꿔 청크 부피와 실행 시 복호 비용을 키운다. 보안 목적의 결정이라 기록만 한다. S6-02와 함께 판단한다.

## 5. 기록

- 2026-09-25 워크플로(run `wf_989a4dfe-7d5`)로 청크 76 + 횡단 12 + 흐름 9 탐색을 시작했다. 청크 28개 완료 시점에 발견 450건(critical 16 · high 59 · medium 214 · low 161) → 전체 약 1,500건 · 검증 에이전트가 상한 1,000을 넘는 규모로 추정돼 Harold 지적으로 중단. 이어 Harold 결정으로 직접 점검으로 전환.
