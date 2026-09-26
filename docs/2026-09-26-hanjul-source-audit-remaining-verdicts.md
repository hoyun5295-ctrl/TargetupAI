# 한줄로 소스 전수점검 · 남은 후보 직접 판정 (2026-09-26 밤)

> 장부 = [2026-09-25-hanjul-source-audit.md](2026-09-25-hanjul-source-audit.md) §2-11(요약·묶음표·실행 순서). 이 파일은 **남은 후보를 코드로 직접 연 판정표**다.
> Harold 지시(0926 밤): 「전체 결함을 다 체크하고 나서 묶어서 할 것들 따로 정리하고 한다」 → 판정 전부 뒤 묶음 정리 → 승인 → 실행.
> 판정 = 성립(등급·근거) · 불성립 · 이미 고침·해소(V2 ID) · 중복 · 정책(결정 필요) · 판정 보류 · 개선 여지(기록) · 기록(올드 디자인·죽은 경로 등).
> 묶음 약어의 뜻·실행 순서는 장부 §2-11 묶음표가 소유한다. 줄 번호는 판정 시점(0926 밤 · 커밋 a39613c2 기준 작업 트리) 기준.
> 에이전트 없이 직접 확인(전수점검 = 에이전트 금지 원칙).

## A. 부분 ① minor 140건 (원본 = [sec1 부록](2026-09-26-hanjul-source-audit-sec1-findings.md) "medium 이하 한 줄 목록" · m001~m140)

| # | 위치 | 판정 | 근거·묶음 |
|---|---|---|---|
| m001 | spam-test-queue.ts:185 | 성립(경합·낮음) | 검사 행을 'queued'로 먼저 커밋 → 3초 워커가 차감·결과 행 생성 전에 집어 발송할 수 있다(잔액 부족이면 무료 발송·결과 행 없으면 앱 보고 유실). 처방 = 결과 행·차감 뒤 마지막에 queued로. 묶음 SQ(스팸 큐 적재 순서) |
| m002 | spam-test-queue.ts:229 | 성립(돈·드묾) | 차감 뒤 결과 행 INSERT가 던지면 catch가 오류만 반환 · 환불 없음 · queued 행 잔존 → 나중에 일부 행으로 발송. 묶음 SQ |
| m003 | spam-test-queue.ts:398 | 성립(낮음) | 로그 테이블을 서버 현재 월 하나만 본다(435행) → 월말 1분 창 검사의 QTmsg 성공을 놓쳐 차단 판정 대신 timeout. 같은 모양 spam-filter.ts:331. 처방 = 전월 로그 함께. 묶음 SQ |
| m004 | sms-result-map.ts:132 | 성립 · 결정 필요(돈) | 7305(카카오 성공불확실 · 30일 대기)가 표시 표는 대기인데 PENDING_CODES(100·104)에 없어 집계·환불은 실패로 센다 → 즉시 FAIL 환불 · 뒤에 성공으로 바뀌면 회수 창(14일) 밖은 회수 안 됨. 대기로 옮기면 발행 대기 차단·환불 시점이 바뀐다 = 정책 결정. m049와 같은 건. 묶음 DECIDE |
| m005 | spam-test-queue.ts:517 | 성립(낮음) | 배치 결과가 변형마다 결과 조회(N+1 · 변형 2~3개) · 여정 사전검사가 끝날 때까지 반복 호출. 쿼리 3~4회/회 · 여정 사전검사 중에만. 묶음 PERF |
| m006 | payment-processor.ts:137 | 성립(방어 약함) | 승인 응답에 TotPrice가 없거나 0이면 금액 대조를 건너뛴다(fail-open) · MOID와 주문번호 대조 없음. 승인 주소는 C-14로 이니시스만 허용이라 위조 여지는 좁다. 처방 = 없으면 실패 · MOID 대조. m061과 같은 건. 묶음 PAY |
| m007 | payments.ts:201 | 성립(돈·드묾) | 승인 실패·확정 실패 뒤 망취소 반환값(false)을 버리고 경보가 없다 → 확정 실패 + 망취소 실패면 카드는 결제됐는데 잔액 0 · 행 failed · 아무도 모름. 처방 = 망취소 실패 시 시스템 경보. 묶음 PAY |
| m008 | inicis-client.ts:275 | 성립(낮음) | 승인·망취소 fetch에 시간 제한 없음 → 이니시스가 멈추면 리턴 요청이 매달림(주문 단위 잠금도 그동안 쥔다). 묶음 PAY |
| m009 | payment-processor.ts:173 | 성립(돈·드묾) | 결제 확정 때 billing_type을 다시 보지 않음 → 결제창 뒤 후불로 바뀐 회사에 잔액 적립. 묶음 BT(결제방식 전환 재확인: m009·m016·m035·F34) |
| m010 | balance.ts:196 | 성립(낮음) | 무통장입금 요청 금액의 타입·정수·상한 검증 없음(`amount < 1000`만). 관리자 확인 뒤 적립이라 피해는 좁다. 묶음 PAY |
| m011 | payments.ts:296 | 성립(낮음) | 카드결제 준비 금액 정수 검증 없음(1,000 이상·1억 이하만) → 소수 주문 생성 가능. 묶음 PAY |
| m012 | admin.ts:3721 | 성립(낮음·관리자) | 수동 잔액 조정: amount가 문자열이면 balance_before가 문자열 연결 · 잔액 UPDATE와 원장 INSERT가 트랜잭션 밖(INSERT 실패 시 원장 없는 잔액 변동). 묶음 PAY |
| m013 | agent-charge-reconciler.ts:43 | 성립(낮음·표시) | seqNo 없는 registered 요청은 대조에서 제외되고 다른 해소 경로가 없어 주문이 '처리 중'에 고착. 돈 이동은 이미 끝남. 묶음 AGC |
| m014 | agent-charge-reconciler.ts:48 | 성립(조건부) | 가장 오래된 20건 고정 → 게이트웨이에 끝내 반영 안 되는 요청 20건이 쌓이면 뒤 요청은 영영 확인 안 됨. 묶음 AGC |
| m015 | agent-charge-core.ts:52 | 성립(돈·드묾) | 링크 승인 때 발송ID가 지금도 주문 회사 소유인지 대조 없음(실존·선불만) → 매핑이 바뀌면 다른 회사 지갑 충전. 묶음 AGC |
| m016 | ai-credit-recharge.ts:153 | 성립(돈·드묾) | 후불 크레딧 승인이 billing_type 재확인 없음 → 요청 뒤 선불 전환 회사는 billed=false 크레딧이 발행 차단(선불)에 걸려 영구 미청구. m035와 같은 건. 묶음 BT |
| m017 | balance.ts:102 | 성립(낮음) | 잔액 이력 limit 상한 없음(자기 회사 이력만). 묶음 PERF |
| m018 | agency-send-mail-worker.ts:1066 | 성립(낮음) | 이메일 접수는 외부 트랜잭션 커밋 뒤 `kickFirstTest`를 부르지 않는다(화면 원스텝은 부름 · agency-send.ts:448) → 1차 검사가 다음 워커 주기(최대 5분)까지 밀려 승인 시간이 준다. 처방 = 커밋 뒤 건마다 kick. 묶음 AGC |
| m019 | agency-send-worker.ts:1323 | 불성립(의도) · 개선 여지 | 종결 접수의 살아 있는 캠페인을 30일 매 주기 다시 막는 것은 늦게 적재된 조각을 막기 위한 설계(주석). F10 적재 중단 표식 뒤로는 반복 필요가 줄었을 수 있다(대행 취소 건수만큼 · 부하 작음) |
| m020 | agency-send-worker.ts:1202 | 성립(낮음·부하) | 배관 거절(잔액 부족 등)·캠페인 없음이면 만료까지 매 주기 명단 전체를 staging에 다시 쓰고 지운다(0913 이후 지우기는 함). 거절 사유가 만료 안내에 실리는지는 미확인. 묶음 AGC |
| m021 | agency-send-worker.ts:1182 | 성립(데이터 잔존·드묾) | 활성화 실패로 failed가 된 캠페인의 staging은 purgeOrphanStaging(캠페인 없을 때만)도, 정리 워커(S1-H08 · 캠페인이 가리키지 않는 적재분만)도 지우지 않는다. 묶음 STG |
| m022 | agency-send.ts:801 | 이미 해소(S1-H08) | 고아가 된 staging(캠페인 없음)은 정리 워커가 24시간 뒤 지운다 |
| m023 | agency-send-campaign.ts:81 | 성립(낮음·안내) | failed를 '나갔을 수 있음'으로 보는 것은 의도(Codex 1R)지만 한 통도 적재 안 된 활성화 실패도 같게 보여 취소 안내가 "이미 발송"으로 틀릴 수 있다. 처방 = 적재 수 0이면 제외. 묶음 AGC |
| m024 | agency-send-worker.ts:1537 | 불성립(정책 일치) | 예약 시각이 지나면 발송 완료로 넘기는 것은 설계(주석) · 예약 시각 지난 취소 거절 규칙(F35)과 같은 축 |
| m025 | agency-send-worker.ts:447 | 성립(조건부·낮음) | 1차 검사 5건 순차 → 한 건이 6분 넘게 걸려야 뒤 행 lock_at 30분 초과 · 재실행으로 테스트 중복 발송. 지금 한 건 소요(스팸 60초 + 맞춤법 20초 상한)로는 도달 어려움. 묶음 AGC |
| m026 | agency-send-intake.ts:292 | 성립(보안·발송 배관 공통) | MMS 이미지 경로를 클라이언트 값 그대로 QTmsg file_name에 싣는다 · 회사 저장소(MMS_IMAGE_BASE/회사ID) 아래인지 검증 없음(validateMmsPayload는 개수만). 다른 회사 이미지(uuid를 알아야)·서버 파일 경로 지정 가능. 처방 = 검증 CT에 회사 경로 검사 · 전 발송 경로. 묶음 SEC-MMS |
| m027 | billing-issue.ts:190 | 성립(돈·운영 실수 시) | 일반 발행·일괄발급에 "끝나지 않은 기간" 차단이 없다(정액 발행 985행에만). 끝이 오늘 이후인 기간을 발행하면 발행 뒤~기간 끝 발송분은 집계에 없고, 다음 발행은 기간 겹침 차단 → 영구 미청구. 묶음 BILL |
| m028 | billing.ts:746 | 성립(세금계산서·관리자 경로) | 수정세금계산서 중복 검사가 진행 중(ready·submitted)만 본다 → 이미 발행된 전액 취소(사유 4·6)를 같은 당초 장에 또 만들 수 있고 누적 음수 검사 없음. 묶음 TAX |
| m029 | billing.ts:2632 | 성립(돈·관리자 경로) | 수정 재발행이 최소과금 정액 장도 삭제 뒤 issueBilling(사용량 발행)으로 다시 만든다(handleBillingDelete 재발행 분기 = 항상 issueBilling) → 정액보다 적게 청구. 묶음 BILL |
| m030 | billing-issue.ts:1183 | 성립(돈·조건부) | 최소과금 "사용량 ≤ 최소과금" 판정이 같은 기간 수량 조정(billing_qty_adjustments)을 반영하지 않는다(priced.items만). 묶음 BILL |
| m031 | billing-issue.ts:580 | 정책(드묾) | 080 고정료 근거 행 UNIQUE(period_month, kind, source_ref)가 전사 기준 → 달 중간 번호가 다른 회사로 옮겨 가면 새 회사의 그 달 고정료는 생기지 않는다. 한 번호 한 달 1회 청구로 보면 맞는 동작 · 이관 월 부담 주체는 정책 |
| m032 | billing.ts:2321 | 성립(낮음·관리자 감사) | 상태 변경이 paid·confirmed → draft 되돌림을 막지 않는다 → 되돌린 뒤 삭제는 사유 없이 통과(삭제 가드 = draft 아님일 때 사유 요구). 묶음 BILL |
| m033 | billing.ts:2699 | 성립(미리보기 금액 불일치) | 미리보기가 080·수기 추가 항목·080 고정료·수량 조정을 계산하지 않는다(요금제 + 사용량만) → 그런 달은 미리보기와 실제 발행 금액이 다르다. 묶음 BILL |
| m034 | send-usage-aggregation.ts:581 | 불성립 | AI 실행(이벤트 축)은 기간 조건 없이 실행 전체를 sent_at 달에 청구한다 → 월 경계를 넘긴 적재도 빠지는 행이 없다(그 달로 몰릴 뿐) |
| m035 | ai-credit-recharge.ts:139 | 중복(m016) | 같은 건 |
| m036 | campaigns.ts:1514 | 중복(기등재 B-0925-5) | 테스트 결과 화면 스팸 비용 = LIMIT 100 목록 합산 |
| m037 | admin.ts:3205 | 성립(낮음·표시) | 슈퍼관리자 테스트 상세의 스팸 목록이 무료 체험 행을 구분하지 않는다. 묶음 ADMIN |
| m038 | spam-filter.ts:85 | 성립(낮음) | 사용자 진행 중 검사 확인이 잠금 없이 조회 뒤 삽입 → 연타·동시 요청이면 검사 2건·차감 2번(체험 횟수는 잠금 안이라 안전). 묶음 SQ |
| m039 | spam-filter.ts:310 | 중복(m003) | 수동 검사 결과 조회도 당월 로그만(spam-filter.ts:331) |
| m040 | spam-filter.ts:36 | 성립(낮음) | 검사 발신번호가 회사 등록 회신번호인지 확인 없음. 받는 쪽이 우리 검사 단말뿐이라 피해는 좁다 · 미등록 번호면 통신사 반려로 유료 검사가 실패로 끝날 수 있다. 묶음 SQ |
| m041 | spam-filter.ts:526 | 성립(조건부) | 앱 보고가 결과 행을 통신사+유형으로만 갱신(89~93행) → 같은 통신사 단말이 2대가 되면 한 대의 수신이 두 행을 통과로 만든다. 지금 단말은 통신사마다 1대라 영향 0. 처방 = 번호까지. 묶음 SQ |
| m042 | send-usage-aggregation.ts:1872 | 정책(일관) | 스팸 검사 failed·timeout 행도 청구 성공으로 센다 — 선불도 차감 뒤 실패를 환불하지 않아 두 방식이 같은 규칙. 미전달 검사를 청구할지는 정책 |
| m043 | spam-test-queue.ts:216 | 이미 고침(F30) | 부분 적재 실패 = 나간 건수만 남기고 환불 |
| m044 | spam-filter.ts:759 | 성립(격리·상시 원칙) | 검사 단건 조회가 회사 조건만 → 같은 회사 다른 사용자(분류코드 다름)의 검사와 first_recipient(고객 정보)를 본다. 묶음 SCOPE(사용자 범위: S5-04와 함께) |
| m045 | monthly-usage.ts:105 | 성립(표시·사용금액 과소) | 사용금액 표시가 "프로 이상 테스트·스팸 무료" 규칙으로 비용을 뺀다 — 테스트 발송·수동 스팸 검사는 요금제와 무관하게 차감되므로 프로 이상 회사 화면이 실제 차감보다 적게 보인다. 묶음 BILL |
| m046 | campaigns.ts:1421 | 성립(낮음) | 테스트 결과 조회가 기간 안 테스트 행 전체를 LIMIT 없이 읽고 메모리 정렬. 묶음 PERF |
| m047 | campaigns.ts:489 | 이미 고침(F15·F17) | 테스트 발송 참조 요청마다 고유 |
| m048 | sms-queue.ts:1176 | 성립(발송 실패·조건부) | 알림톡 적재가 비토 라인(폭 8192)에서도 1024 상한을 하드코딩(1261행) → 제어 JSON + SENDER_KEY가 1024를 넘으면 키 없이 적재돼 9999 실패. 폭 CT `getEtcJsonCapacity`가 이미 있다. 묶음 KETC |
| m049 | direct-send-processor.ts:196 | 성립(발송 실패·조건부) | 브랜드 조립에 etcJsonMax를 안 넘기는 곳 3곳(direct-send-processor:196 · campaigns.ts:1118 AI · campaigns.ts:2600 직접) → 비토 라인에서도 1024 한도 · 캐러셀(최소 1,190자대)·큰 첨부는 조립 단계에서 던져 청크 전체 미적재. /brand-send만 폭을 넘긴다(brand-message.ts:1824). 묶음 KETC |
| m050 | campaigns.ts:3786 | 성립(예약 취소 불가) | /brand-send가 예약(reservedDate)이어도 적재 뒤 캠페인을 즉시 completed로 기록(3968행) → 취소 게이트(scheduled·draft)를 못 지나 예약 브랜드 발송을 취소할 수 없다. 묶음 KAKAO |
| m051 | alimtalk.ts:125 | 성립(설정 의존) | IMC 웹훅이 HMAC·IP 환경값이 없으면 검증 없이 받는다(10MB) · kakao_webhook_events 보존 정리 없음. 운영 env 설정 여부 미확인. 처방 = 미설정이면 거절(S1-H09와 같은 방식). 묶음 KAKAO |
| m052 | prepaid.ts:516 | 정책 | 과다 환불 회수가 잔액 하한 없이 빼서 음수 잔액이 생길 수 있다. 잘못 나간 돈의 회수라 음수 허용이 맞을 수 있다(차감은 잔액 확인) — 정책 |
| m053 | brand-message.ts:1929 | 성립(돈·프로세스 중단 시) | /brand-send 동기 경로에서 차감 커밋 뒤 첫 배치 적재 전 재시작 → 처리 수 0이라 정리 워커 산식이 건드리지 않아 영구 미환불. F08(AI 캠페인)과 같은 부류. 묶음 CRASH |
| m054 | sms-result-map.ts:132 | 중복(m004) | 7305 |
| m055 | alimtalk-webhook-handler.ts:199 | 불성립(의도) | IMC 리포트 웹훅은 저장만 한다 — 알림톡 결과의 진실은 SMSQ 경로(설계). 보존 정리 부재는 m051에 포함 |
| m056 | mysql-refund-sweeper.ts:426 | 성립(헛도는 조회·낮음) | '타임아웃 실패 환불' 행을 만드는 코드가 저장소에 없다(grep = 주석·조회뿐) → 회수 조회가 30초마다 balance_transactions를 헛돈다. 처방 = 제거. m081과 같은 건. 묶음 SWP |
| m057 | mysql-refund-sweeper.ts:172 | 성립(낮음·성능) | (회사, 사용자) 묶음마다 테이블 목록·UNION 집계를 따로 돈다 — 사용자 라인이 같으면 중복. 묶음 SWP(P-09와 함께) |
| m058 | sms-queue.ts:855 | 성립(돈·조건부) | 캠페인 집계 LOG가 당월·전월뿐 → 같은 캠페인 id를 두 달 넘게 지나 재발송하면 앞 회차 실패가 안 보여 새 회차 실패 환불이 누적 항아리(앞 회차 환불분)에 삼켜진다. 묶음 MULTIRUN(m070·m090) |
| m059 | scheduled-cleanup-worker.ts:23 | 중복(S3-03) | 겹침 방지 없음 · m079·m097 같은 건 |
| m060 | send-usage-aggregation.ts:782 | 정책 | 테스트 MMS가 테스트 LMS 단가로 청구(테스트 MMS 단가 칸이 없다 · S1-H06에서도 종전 유지). 단가를 따로 둘지는 요금 결정 |
| m061 | send-usage-aggregation.ts:778 | 이미 고침(S1-H06) | 브랜드 테스트 = 'test' + 테스트 브랜드 |
| m062 | send-usage-aggregation.ts:619 | 성립(돈·드묾) | 발송 완료 표시가 없는 직접발송(레거시·멈춘 phase)은 COALESCE(scheduled_at, sent_at) 달로만 후보가 되고 수량은 sendreq_time 기간으로 자른다 → 분할 발송이 월을 넘기면 다음 달 행은 어느 달에도 안 잡힌다(여정 F07처럼 후보 창을 넓혀야). 묶음 BILL |
| m063 | send-usage-aggregation.ts:170 | 성립(돈·조건부) | 청구 테이블 = 활성(is_active) 라인 그룹만(getAllBulkSmsTables·getBitoSmsTables) → 라인 그룹을 비활성화하면 그 라인의 과거 발송분(라이브·LOG)이 후불 청구에서 빠진다. 묶음 BILL |
| m064 | sms-queue.ts:1176 | 중복(m048) | |
| m065 | sms-queue.ts:249 | 성립(낮음) | 라인 그룹 캐시 무효화가 user:·company:만 지우고 all-bulk·all-bito·회사 사용자 키는 TTL까지 남는다 → 라인 변경 직후 집계·적재가 옛 테이블 목록 사용. P-11과 같은 축. 묶음 LINE |
| m066 | payment-processor.ts:137 | 중복(m006) | |
| m067 | prepaid.ts:49 | 성립(낮음·현재 영향 0) | 환불 상한(loadDeductLedger)은 브랜드 축에도 message_type NULL 행을 더하고 스위퍼는 브랜드에서 NULL을 뺀다 — 두 경로가 같은 칸을 다르게 읽는다. NULL은 0729 이전 세대라 정산 창 밖. 처방 = 한 판정으로. 묶음 PAY |
| m068 | message-sanitizer.ts:25 | 성립(고객 문안 변경) | 이모지 범위(0x2600~0x27BF)를 특수문자 치환보다 먼저 봐 ★☆✓☎♥ 등 EUC-KR로 보낼 수 있는 기호를 지운다 · 여정 실행기(journey-executor.ts:720)가 발송 때 이 정리기를 돌려 **사람이 쓴 여정 문안에서도 기호가 조용히 빠진다**. 처방 = 반려 인코더 기준 글자표로 범위 정정. 묶음 COPY |
| m069 | campaigns.ts:959 | 이미 고침(S1-H07 · F09 발송 시작 잠금) | |
| m070 | campaigns.ts:860 | 성립(돈·API 경로) | AI 발송 게이트가 'sending'만 막아 cancelled·failed·completed 캠페인을 API로 다시 보낼 수 있고, 환불 항아리(NOT_LOADED·CANCEL)가 캠페인 단위라 두 번째 실행의 환불이 앞 실행 누적에 삼켜진다. 묶음 MULTIRUN(m058·m071·m090) |
| m071 | campaigns.ts:1259 | 성립(낮음) | 완료 캠페인 재발송으로 대상 수가 바뀌면 protect_completed_target_count 트리거가 적재 뒤 UPDATE를 막는다(F09로 결말은 정상화 · 오류 응답만). 묶음 MULTIRUN |
| m072 | campaigns.ts:3297 | 성립(법·발송) | 예약 시각 변경이 새 시각의 야간 광고 제한·브랜드 발송 가능 시간(08:00~20:50)을 다시 검사하지 않는다(라우트 안 검사 0) → 광고를 야간으로 옮기면 그대로 나가고, 브랜드분은 금지 시각이면 카카오 3022로 폐기. 묶음 NIGHT |
| m073 | campaigns.ts:3594 | 이미 고침(F09 초안 삭제 가드 DRAFT_HAS_SEND) | |
| m074 | campaign-lifecycle.ts:521 | 성립(경합·돈) | AI 결과 동기화가 campaigns.status를 현재 상태 조건 없이 completed/failed로 덮는다(606행 WHERE id만) → 실행 행이 남은 취소 캠페인을 되살릴 수 있다. m096과 같은 뿌리(상태 갱신에 현재 상태 조건 없음). 묶음 STATE |
| m075 | campaigns.ts:1133 | 성립(낮음·안내) | 차감 실패를 모두 402 insufficientBalance로 응답 — DB 오류('차감 처리 중 오류')도 화면이 잔액 부족으로 안내(1158·1196·2640·2677·테스트 402 같은 모양). 묶음 WORDING |
| m076 | campaigns.ts:1221 | 성립(낮음·옵트인 기능) | 피로도 카운터가 적재 결과와 무관하게 대상 전원을 오늘 날짜로 기록 · 취소해도 되돌리지 않음 → 받지 않은 고객이 다른 광고에서 제외. direct-send-processor.ts:350도 같음(m106). 묶음 FAT |
| m077 | sms-queue.ts:1444 | 성립(드묾·수렴) | 배치 INSERT 오류를 그 배치 미적재로 센다 — 시간 초과 뒤 서버에서 커밋되면 발송과 환불이 함께 일어나고 30분 뒤 회수로 수렴(A-05 부류). 묶음 RES |
| m078 | mysql-refund-sweeper.ts:320 | 중복(P-09) | |
| m079 | scheduled-cleanup-worker.ts:23 | 중복(S3-03) | |
| m080 | alimtalk-jobs.ts:730 | 부분 해소(P-04 설계안 B) | 종결 템플릿 IMC 재조회 제거 · 알림 6시간 주기. 타이머 겹침 방지 없음은 남음(검수 중 100건 × 단건 GET이라 5분 안에 끝남 · 낮음) |
| m081 | mysql-refund-sweeper.ts:428 | 중복(m056) | |
| m082 | direct-send-worker.ts:244 | 이미 고침(F35 결말 CT · 남은 행 = 라이브 비대기 + 이력 실측) | |
| m083 | direct-send-worker.ts:273 | 성립(지연·낮음) | 끊긴 적재 복구 조건 updated_at < 10분을 정산 스위퍼의 결과 갱신이 계속 밀어 결과가 안정될 때까지 미적재 환불이 늦어진다(빠지지는 않음). 묶음 WORKER |
| m084 | cancelled-queue-sweeper.ts:39 | 불성립(대기 행) · 정책 1건 | 상태를 바꾸는 취소는 F35 결말 CT가 '차감 − 시작 행(status_code != 100 · cancel-settle.ts:60)'으로 정산해 뒤늦게 적재된 대기 행은 이미 환불 몫이다. 대행(queueOnly)은 상태를 cancelled로 바꾸지 않아 이 스위퍼 대상(status='cancelled')이 아니다. 남는 쟁점 = 스위퍼가 9999로 막는 픽업 잔존 행은 시작 행으로 세어 환불되지 않는다(전달 여부 불확정 · 정책 판단) |
| m085 | agent-charge-reconciler.ts:39 | 중복(m014) | |
| m086 | direct-send-worker.ts:46 | 중복(P-01 · 인덱스 A가 덮음) | |
| m087 | campaign-sync-worker.ts:304 | 성립(낮음·중복 안내) | 여정 결과 LMS 적재 뒤 markNotified가 실패하면 다음 주기에 같은 안내가 다시 나간다. 묶음 JRN |
| m088 | auto-campaign-worker.ts:1125 | 성립(돈·자동발송 재가동 시) | 차감(858행) 뒤 예외는 바깥 catch가 markFailed만 한다 — 환불·의무 기록 없음 · 적재 0이라 스위퍼도 미환불. m108과 같은 건. 묶음 CRASH |
| m089 | auto-campaign-worker.ts:1072 | 성립(돈·조건부) | 차감은 customers.length(858행), 미적재 환불은 filteredCustomers.length − 적재(1076행) → 개별 회신번호로 걸러진 고객분은 적재가 1건 이상이면 스위퍼가, **0건이면 아무도** 환불하지 않는다. 묶음 CRASH |
| m090 | campaigns.ts:1161 | 중복(m070 · MULTIRUN) | |
| m091 | spam-test-queue.ts:494 | 이미 고침(F30) | 큐 검사 실행 실패 = 나간 건수만 남기고 환불 |
| m092 | mysql-refund-sweeper.ts:352 | 이미 고침(F05·F06·F11) | 여정 차감 참조 = 단계 캠페인 · 원장 정산으로 거짓 경보 원인 제거 · m098 같은 건 |
| m093 | journey-executor.ts:950 | 성립(발송 계약 위반 · 결과는 sql_mode에 달림) | 여정 문자 적재 행 msg_type에 'SMS'·'LMS'·'MMS' 원문을 넣고(1006행) 적재 CT(bulkInsertSmsQueue)는 변환하지 않는다 → QTmsg 칸(S/L/M)에 3글자. 엄격 모드면 INSERT 실패(=여정 문자 전면 실패 · F40 이후 재시도·정지), 느슨하면 잘려 들어가되 MMS 라인 분리(r[3]==='M')는 빗나간다. 운영 sql_mode 미확인(M-02). 처방 = toQtmsgType. m131 같은 건. 묶음 JRN |
| m094 | campaigns.ts:3182 | 이미 고침(F22·F23 적재 중 삭제 409) | |
| m095 | admin.ts:3708 | 중복(m012) | |
| m096 | campaign-lifecycle.ts:84 | 성립(경합·돈) | 예약 정리가 scheduled 후보를 고른 뒤 캠페인마다 MySQL을 세고 WHERE id만으로 상태를 덮는다 → 그 사이 취소된 캠페인을 completed로 되돌림 → 스위퍼 미적재 환불 뒤 회수. 처방 = AND status='scheduled'. m074와 같은 뿌리. 묶음 STATE |
| m097 | scheduled-cleanup-worker.ts:23 | 중복(S3-03) | |
| m098 | mysql-refund-sweeper.ts:355 | 중복(m092 · 이미 고침) | |
| m099 | cancelled-queue-sweeper.ts:39 | 중복(m084) | |
| m100 | campaigns.ts:3305 | 이미 고침(F24 · send_config.scheduledAt 함께 · 적재 중 409) — 단 야간·브랜드 시간 재검사는 m072로 남음 | |
| m101 | campaigns.ts:3380 | 이미 고침(F24) | |
| m102 | campaign-lifecycle.ts:219 | 성립(중지 수단 없음) | 슈퍼관리자 취소 라우트(admin.ts:2412)도 status='scheduled'만 받는다 → 첫 회차 뒤 completed가 된 분할 예약은 사용자·슈퍼관리자 누구도 남은 회차를 멈출 수 없다(별도 비상 정지 라우트 없음). m050과 같은 뿌리(completed = 막을 수 없음). 처방 = 슈퍼관리자 경로에 queueOnly 취소(큐 중화·검증·환불 그대로 · 상태 유지). 묶음 KAKAO(m050과 함께) |
| m103 | campaigns.ts:2960 | 성립(격리·상시 원칙) | POST /:id/cancel에 company_user 본인 캠페인 확인이 없다(cancelCampaign도 created_by 대조 없음) → 같은 회사 다른 사용자의 예약을 취소할 수 있다. 묶음 SCOPE |
| m104 | continuous-operator.ts:1688 | 성립(드묾·중복 발송) | 캠페인 생성 커밋 뒤 campaign_id 표식 전에 죽으면 30분 뒤 admin_review로 내려가고 재승인 시 같은 대상에게 두 번 발송. 묶음 CRASH |
| m105 | journey-executor.ts:1017 | 성립(드묾) | 큐 적재 커밋 뒤 step_log 'sent' 기록 전 재시작 → 멱등 가드가 비어 재발송·재차감(좁은 창). 묶음 CRASH |
| m106 | direct-send-processor.ts:350 | 중복(m076 · FAT) | |
| m107 | continuous-operator.ts:1419 | 성립(지연·조건부) | 자율 발송 패스(runAutoSendPass)가 운영자 최대 100건의 제안 생성(AI·스팸 실검사)을 순차로 끝낸 뒤에야 돈다 → 예약 발송 시각이 밀린다. 묶음 OPS |
| m108 | auto-campaign-worker.ts:1127 | 중복(m088) | |
| m109 | journey-executor.ts:1092 | 성립(낮음·설정 불일치) | 여정 발송 시간이 8~21 하드코딩(1147행) — SEND_HOURS(ENV) 기본값과 같아 지금은 차이 없음 · ENV를 바꾸면 갈린다. 묶음 NIGHT |
| m110 | results.ts:724 | 중복(F27 추가 과제 · SCOPE) | 사용자 단위 발송내역·엑셀 제한 없음 |
| m111 | results.ts:718 | 이미 고침(F26) | |
| m112 | results.ts:710 | 성립(낮음·가용성) | /messages limit 상한 없음 · 숫자 아니면 LIMIT NaN(SQL 오류). m137 같은 건. 묶음 RES |
| m113 | results.ts:251 | 성립(낮음·가용성) | /campaigns limit 상한 없음 → 한 요청이 수천 캠페인 MySQL 집계. 묶음 RES |
| m114 | results.ts:101 | 성립(낮음·표시) | 요약 기본 월이 toISOString(UTC) → KST 매월 1일 00~09시 전월 표시(87행). 묶음 RES |
| m115 | campaign-sync-worker.ts:259 | 성립(안내 누락) | 여정 결과 알림 후보 조회 창이 완료 2시간 이내(`completed_at >= NOW()-2h`)라 "2시간 지나면 대기 포함 발송" 분기에 도달하지 못한다 → 대기가 2시간 넘게 남는 단계는 알림이 영영 안 간다. 묶음 ALERT |
| m116 | sms-result-map.ts:132 | 중복(m004) | |
| m117 | campaign-sync-worker.ts:415 | 성립(헛도는 작업·낮음) | 재대조 0건 보류는 시각만 찍고 result_final을 안 바꿔 72시간 갈래(하한 없음)에 영구히 남아 매시간 MySQL 재집계. 묶음 WORKER |
| m118 | campaign-lifecycle.ts:84 | 성립(돈·조건부) | 예약 정리가 기록된 적재 테이블(sentTables)이 아니라 회사 활성 라인으로 센다 → 라인 재배정 뒤 0건 → 10분 뒤 failed·sent_count 0 → 후불 청구 제외(B-0914-1 잔여). F36은 재대조 워커만 고쳤다. 묶음 LINE(m063·m065·m136) |
| m119 | campaigns.ts:1707 | 성립(검사 불일치·API 경로) | 대량 직접발송 확정(commit)에 카카오 사용 여부·MMS 이미지 필수(validateMmsPayload)·본문 링크 결함 검사가 없다(동기 경로는 있음 · 화면은 막음). m127과 함께. 묶음 GATE |
| m120 | direct-send-processor.ts:154 | 중복(m026 · SEC-MMS) | |
| m121 | direct-send-worker.ts:630 | 성립(표시·낮음) | 적재가 0건·일부로 끝난 예약 캠페인이 'scheduled'로 남아 나머지가 안 나간다는 사실이 화면에 없다(미적재 환불은 됨). 묶음 RES |
| m122 | direct-send-worker.ts:286 | 성립(지연·설계) | 단일 워커가 전 회사 캠페인을 순차 적재 → 대형 적재 중 다른 회사 즉시발송·대행이 수 분 대기. 묶음 PERF |
| m123 | campaigns.ts:2551 | 성립(돈·프로세스 중단 시) | 동기 /direct-send가 차감 뒤 첫 적재 전 재시작되면 전액 미환불(처리 수 0 · status sending 고정). C-11은 워커 경로만 복구. 묶음 CRASH |
| m124 | campaigns.ts:2940 | 이미 고침(F09) | |
| m125 | direct-send-core.ts:46 | 성립(낮음·사후 보정) | 중복제거 끔 + 수신거부 번호 중복이면 확인 창·차감 건수가 실제보다 크다(미적재 환불로 보정). 묶음 GATE |
| m126 | direct-send-core.ts:90 | 성립(법·조건부) | 야간 광고 게이트가 시작 시각만 본다 → 20:5x에 확정한 대량 즉시 광고의 뒤 청크가 21시 넘어 NOW()로 적재·발송. 묶음 NIGHT |
| m127 | campaigns.ts:1778 | 성립(API 경로·낮음) | commit 알림톡에서 개별 회신번호 사용 + 회신번호 빈 값이면 검증 없이 빈 회신번호로 적재(대체문자 실패). 묶음 GATE |
| m128 | campaigns.ts:1692 | 성립(격리·낮음) | 스테이징 집계의 중복·수신거부 수 쿼리에 company_id 조건이 없다(총수만 있음) → 남의 stagingId(UUID)를 알면 그 명단의 중복 수·내 수신거부와 겹치는 수가 보인다. 묶음 SCOPE |
| m129 | direct-send-worker.ts:286 | 중복(P-01) | |
| m130 | campaigns.ts:1393 | 성립(가용성·인증 사용자) | test-stats가 날짜 형식 검증 없이 월 루프 → 0001~9999면 수십만 번 `SELECT 1 FROM 로그표` 순차 실행. 묶음 PERF |
| m131 | journey-executor.ts:950 | 중복(m093) | |
| m132 | campaign-sync-worker.ts:304 · system-alert.ts:175 | 성립(안내·경보 유실) | 적재 결과(bulkInsertSmsQueue 반환)를 안 보고 알림 완료·쿨다운을 찍는다 → MySQL 장애 중이면 여정 안내 유실 · **돈 불변식 경보가 쿨다운 동안 억제**. 묶음 ALERT |
| m133 | campaigns.ts:3297 | 중복(m100 · 이미 고침) | |
| m134 | campaigns.ts:3229 | 이미 해소(F22·F23 적재 중 삭제 409) | |
| m135 | sms-queue.ts:700 | 성립(조건부·드묾) | 캠페인 테이블 CT가 sent_at(직접발송 = 적재 시각) ±1개월 LOG만 본다 → 두 달 넘게 앞선 예약 직접발송은 발송 뒤 결과·엑셀이 0행. 취소 CT처럼 기준 날짜를 여럿(적재·예약)으로. 묶음 RES |
| m136 | journey-executor.ts:898 | 성립(드묾) | 공유 단계 캠페인의 sentTables를 실행마다 현재 라인으로 덮어써 당일 라인 재배정 시 앞 행의 라인이 결과 조회에서 빠진다. 처방 = 합치기. 묶음 LINE |
| m137 | results.ts:710 | 중복(m112) | |
| m138 | expired-pending-sweeper.ts:35 | 중복(S3-02) | |
| m139 | sms-queue.ts:476 | 판정 보류(성능 · MySQL digest 필요) | smsBatchAggByGroup의 app_etc1 IN 집계에 인덱스 힌트가 없다 — 정산에서 실측한 풀스캔 조건이 스위퍼에도 성립하는지는 M-25(digest)로만 가린다 |
| m140 | campaigns.ts:3011 | 성립(낮음·표시) | 예약 수신자 페이지 정렬 키 seqno가 테이블마다 독립 → 여러 라인 캠페인은 동률에서 페이지 경계 중복·누락 · 음수 offset이면 SQL 오류(3079행 parseInt). 묶음 RES |

## B. 1차 후보 medium·low 375건 (R060~R434 · high·critical은 장부 §2-8에서 판정 끝)

| # | 위치 | 판정 | 근거·묶음 |
|---|---|---|---|
| R060 | address-books.ts:60 | 성립(낮음) | 그룹 '조회'가 그룹 전체(최대 10만)를 받아 상위 10건만 표시(화면 검색이 전체 목록을 쓰는 구조) · 서버 검색·상한으로 줄일 여지. 묶음 PERF |
| R061 | address-books.ts:105 | 성립(낮음·관리자) | 그룹 이름을 만들 때는 사용자 단위, 관리자 조회·추가·삭제는 회사 단위(user 필터 없음) → 다른 사용자의 같은 이름 그룹이 섞여 보이고 함께 지워진다. 묶음 SCOPE |
| R062 | address-books.ts:116 | 이미 고침(R1-01) | 주소록 저장 = 한 문장 unnest |
| R063 | admin-sync.ts:175 | 성립(표시) | 배치 기록(sync.ts:894·1161)은 started_at 없이 적재 → 오늘 건수·24시간 오류 집계(started_at 기준)에서 빠진다. 묶음 ADMIN |
| R064 | admin-sync.ts:251 | 성립(낮음·전송량) | 에이전트 상세가 로그 20건의 failures jsonb 전체를 내려보내고 매핑 창은 한 값 때문에 이를 부른다. 묶음 ADMIN |
| R065 | admin-sync.ts:600 | 성립(낮음·관리자) | 삭제 방지 기준 30분 고정 · 하트비트 설정 기본 60(sync.ts:278) → 정상 에이전트가 경고 없이 삭제될 수 있다. 묶음 ADMIN |
| R066 | admin.ts:110 | 성립(낮음·성능) | 사용자 목록마다 customers 전체를 uploaded_by로 GROUP BY(+ unsubscribes 전체 GROUP BY). 묶음 PERF |
| R067 | admin.ts:2492 | 성립(낮음·관리자) | 발신번호 등록이 대표번호를 먼저 전부 해제한 뒤 회선 상한을 검사 → 거절되면 회사에 대표번호가 없다(테스트 발송 등 NO_DEFAULT_CALLBACK). 처방 = 순서 바꿈·트랜잭션. 묶음 CB |
| R068 | admin.ts:2788 | 성립(경합·낮음) | 요금제 신청 승인이 pending 확인 뒤 잠금 없이 처리하고 마지막 UPDATE는 id만 → 동시 두 번 승인이면 둘 다 통과. 묶음 ADMIN |
| R069 | admin.ts:3708 | 중복(m012) | |
| R070 | admin.ts:5500 | 성립(낮음) | 감사 로그 조회마다 audit_logs 전체 DISTINCT action(ceo 전용 화면). 묶음 PERF |
| R071 | admin.ts:5971 | 성립(기능 고장) | 슈퍼관리자 알림톡 템플릿 수동 등록(`POST /kakao-templates/manual` · AdminDashboard 사용)이 status 'approved'(소문자)로 INSERT → 대문자 CHECK(D143)에 항상 걸려 실패. 처방 = 'APPROVED'. 묶음 ADMIN |
| R072 | ai-memory.ts:999 | 성립(드묾) | 브랜드 링크 라벨 충돌 루프가 -2~-8만 확인하고 끝에 -9를 확인 없이 쓴다 → 같은 라벨 9개째면 기존 -9 링크를 덮어쓴다. 묶음 AI |
| R073 | ai-usage.ts:57 | 성립(낮음·정보 노출) | 'Cache 히트율'이 프로세스 전역 누적(ai-cache getCacheStats)이라 모든 고객사에 같은 숫자와 전사 호출 규모가 보인다. 묶음 STATS-FAKE |
| R074 | ai-usage.ts:75 | 성립(표시) | 일평균 = 호출 있는 날만 나눔(부풀림) · 전월 대비 = 이번 달 누계 vs 지난달 전체 → 예측·비교가 틀린다. 묶음 ANAL |
| R075 | ai-usage.ts:403 | 성립(기능 없음) | 한도 알림 설정은 저장·표시만 되고 그 값을 읽어 알림을 보내는 코드가 없다(소비처 = 이 파일 조회뿐). 묶음 AI |
| R076 | ai.ts:280 | 중복(S5-01) | |
| R077 | ai.ts:1085 | 중복(R1-23 · deductCreditSafe 후차감 공통 설계) | 문안 다듬기가 사전 확인 없이 AI 호출 뒤 차감 → 잔액 0이어도 결과를 받는다 |
| R078 | ai.ts:1348 | 성립(AI 입력 결함) | 고객 평균을 custom_fields->>'purchase_count'·'total_spent'에서 읽는다 — 실제는 표준 컬럼 purchase_count·total_purchase_amount(standard-field-map) → AI 프롬프트·ROI 추정이 늘 0. 하드코딩 매핑 금지 위반. 묶음 AI |
| R079 | ai.ts:1798 | 성립(돈·크레딧) | 전체 분석 = 끝에 orchestrate 300 차감 + 안의 성과 설명(explainPerformance)이 별도 5크레딧(ai-credit-calc 'performance-explainer') → 안내 300보다 5 더 · 분석이 뒤에서 실패해도 5는 빠진다. 묶음 AI |
| R080 | ai.ts:2542 | 성립(격리·상시 원칙) | 자동마케팅 수정·보관이 회사 단위만 확인 → 같은 회사 다른 사용자의 자동마케팅을 바꿀 수 있다. status 값은 타입 선언만. 묶음 SCOPE |
| R081 | ai.ts:3023 | 성립(경합) | 담당자 정지(adminStopProposal)가 상태를 확인한 뒤 WHERE id만으로 admin_stopped로 덮는다 → 사이에 발송 패스가 'sending'으로 선점하면 화면은 '정지됨'인데 실제 발송. 처방 = 조건부 UPDATE + rowCount. 묶음 STATE |
| R082 | ai.ts:3284 | 성립(기능 고장 + 과금 없음) | AI 근거 질의(AiExplainPage가 부름)가 없는 컬럼(campaigns.name · campaign_runs.status_code — citations.ts:96)을 조회해 늘 500 · 고쳐지면 크레딧·한도 없이 고급 모델을 부른다(callAIWithCitations에 차감·한도 없음). 묶음 AI |
| R083 | ai.ts:4832 | 불성립(이미 반영) | 목록 CT가 page → OFFSET을 쓴다(journey-stats.ts:501·581 · D210+ Phase 3) |
| R084 | ai.ts:5070 | 성립(안내 ≠ 실제) | 예측 1클릭 액션이 "N명에게" 목표 문장을 만들지만 자동마케팅 프리필에는 대상 조건이 없다(PredictiveDashboardPage:419) → 만든 자동마케팅의 실제 대상은 N명과 무관. ⛔ 처방 방향 = 예측을 대상 선정에 쓰지 않는다(메모리 원칙) → 약속 문장에서 인원수를 빼는 쪽. 묶음 AI |
| R085 | alimtalk.ts:136 | 중복(m051) | |
| R086 | alimtalk.ts:852 | 중복(S2-01) | |
| R087 | alimtalk.ts:1166 | 성립(속도·낭비) | 템플릿 목록·엑셀이 `SELECT t.*`로 검수 증빙 바이너리(inspection_evidence_data · 행당 최대 5MB)까지 읽고 JS에서 버린다(1180행). 처방 = 칼럼 명시. 묶음 PERF |
| R088 | alimtalk.ts:1795 | 성립(상태 불일치) | 템플릿 삭제가 IMC 응답 코드와 무관하게 PG를 DELETED로 바꾸고 응답만 success=false(1822~1827행) · 검수취소·휴면해제·코드변경도 같은 모양. 묶음 KAKAO |
| R089 | alimtalk.ts:2320 | 성립(표시) | 브랜드 기본형 템플릿 수정이 IMC에만 반영되고 PG는 updated_at만 → 목록·미리보기·재수정 폼이 옛 내용. S1-H05와 같은 처방(수정 뒤 IMC 재조회로 맞춤). 묶음 KAKAO |
| R090 | analysis.ts:601 | 성립(표시 결함) | 캐시 조회가 `SELECT id, insights, created_at`이라 collected_data가 늘 undefined → 캐시 적중 시 화면 차트가 전부 사라진다. 처방 = 칼럼 추가. 묶음 ANAL |
| R091 | analysis.ts:690 | 성립(분석 왜곡) | 최적 발송 시간·요일·히트맵이 EXTRACT(HOUR/DOW FROM sent_at)를 UTC 세션에서 계산 → 한국 시각과 9시간(요일도) 어긋남. 묶음 ANAL |
| R092 | analysis.ts:791 | 성립(개인정보) | AI 분석이 이탈 위험 고객 20명의 이름·전화번호를 외부 AI 프롬프트에 넣고(196행) analysis_results에 저장하며 화면에 돌려준다. 처방 = 가림 뒤 전달·저장. 묶음 PRIV |
| R093 | analysis.ts:839 | 성립(분석 왜곡) | 구매 전환·추정 ROI가 수신자와 무관한 회사 전체 구매(발송 뒤 7일)를 캠페인 성과로 잡는다. 묶음 ANAL |
| R094 | analysis.ts:867 | 성립(낮음·속도) | 비즈니스 분석이 서로 독립인 AI 두 턴을 순차로 기다린다. 묶음 PERF |
| R095 | billing.ts:2492 | 성립(낮음·관리자) | 수정 재발행이 삭제를 커밋한 뒤 발행을 시도 — 발행 차단(겹침 등)을 미리 보지 않아 "삭제됐지만 재발행 실패"가 날 수 있다(안내 문구는 있음). 처방 = 발행 사전 점검 뒤 삭제. 묶음 BILL |
| R096 | billing.ts:2770 | 중복(m033) | |
| R097 | billing.ts:3284 | 성립(올드 디자인·브랜드) | 개별 정산서 메일이 발신자 "INVITO 정산"·제목 "[INVITO]"·이모지·그라데이션 옛 모양 — 일괄발급 메일(한줄로)과 문서명·모양이 다르다. 고객 대외 문서. 묶음 MAIL |
| R098 | cafe24.ts:75 | 성립(조건부) | 몰 ID로 회사를 `LIMIT 1`(정렬 없음)로 고른다(cafe24-client.ts:277) → 같은 몰이 여러 회사에 active면 웹훅이 임의 한 회사로만 간다. 묶음 CDP |
| R099 | campaigns.ts:886 | 개선 여지(기록) | AI 캠페인 발송이 요청 안에서 대상 전량 동기 처리(직접발송 워커 합류 여지) |
| R100 | campaigns.ts:3653 | 성립(보안·발신 프로필 도용) | /brand-send가 카카오 사용 여부와 발신 프로필 키 소유를 확인하지 않는다(라우트·CT 검사 0) → 남의 senderKey를 알면 그 프로필로 발송(S2-01이 키 노출 경로). 묶음 SEC-KAKAO(S2-01과 함께) |
| R101 | cdp.ts:638 | 이미 고침(R1-49 회원 토큰) | |
| R102 | cdp.ts:888 | 성립(속도·조건부) | 설치 상태 조회마다 회사 cdp_events 전 기간을 두 번 집계(MIN·COUNT) — 이벤트 많은 회사에서 설정 화면이 무겁다. 묶음 PERF |
| R103 | cdp.ts:1163 | 성립(중복 발송·조건부) | 웹 푸시가 HTTP 요청 안에서 구독자 전원에 순차 배치 발송(web-push.ts:215) · 요청마다 새 캠페인 INSERT · 멱등키 없음 → 타임아웃 뒤 재클릭이면 중복. 묶음 CDP |
| R104 | cdp.ts:1189 | 성립(낮음·속도) | 인앱 목록이 메시지마다 노출 통계 쿼리(N+1). 묶음 PERF |
| R105 | companies.ts:94 | 성립(보안) | 공개 문의 메일 본문에 방문자 입력(전화·이메일·요금제·내용)을 이스케이프 없이 HTML로 넣는다 → 직원 메일함으로 가짜 링크·HTML 주입. 묶음 SEC |
| R106 | companies.ts:965 | 성립(반복 부하) | 대시보드 진입마다 캐시 없이 고객 전수 집계(FILTER 30여 개) + COUNT(customers 939MB · 큰 회사일수록 무거움). S5-01 계열. 묶음 PERF |
| R107 | companies.ts:2916 | 성립(낮음·RCS) | RCS 템플릿 폼의 brandId·brandName이 INSERT 칼럼에 없어 버려진다. 묶음 RCS |
| R108 | companies.ts:2942 | 성립(낮음·RCS) | RCS 템플릿 수정(PUT)은 링크 결함 검사를 건너뛴다(등록은 함). 묶음 RCS |
| R109 | content-interview.ts:386 | 불성립(이미 반영) | 결과를 세션에 최종화하고(UPDATE · attempt 소유) 차감 결말(deducted·duplicate)로 재과금 방지 |
| R110 | customers.ts:161 | 성립(속도) | 고객 목록 페이지마다 중복 접기 뷰(customers_unified)를 COUNT와 목록으로 두 번 계산. 묶음 PERF |
| R111 | customers.ts:747 | 성립(시한 결함) | 연령대 통계가 올해 연도 2026 하드코딩(`2026 - birth_year`) → 2027-01-01부터 한 살씩 어긋남. 처방 = KST 현재 연도. 묶음 YEAR |
| R112 | customers.ts:1057 | 성립(속도·개인정보 전송 · 설계) | 직접 타겟 추출이 조건에 맞는 고객 전체를 LIMIT 없이 JSON으로 브라우저에 보낸다(B-D75-04 설계 결정) → 큰 회사면 응답·메모리 폭증. 서버 적재(스테이징) 설계 필요. 묶음 PERF |
| R113 | customers.ts:1779 | 성립(격리·상시 원칙) | 고객 상세·360 타임라인이 회사 조건만(분류코드 격리 없음) → 매장 제한 사용자가 id로 다른 매장 고객을 본다. 묶음 SCOPE |
| R114 | dm.ts:255 | 성립(속도·반복) | 공개 DM 뷰어가 쪽마다 resolveSections → prepareFieldMappings(DB 조회)를 다시 부른다(dm-viewer.ts:1107) → 열람 1번에 쪽 수 × 조회. 처방 = 한 번. 묶음 PERF |
| R115 | dm.ts:284 | 성립(반복 부하) | 열람 비콘(15초)이 getDmByCode = `SELECT *`(pages·sections JSON 포함)로 DM 전체를 읽는다 → 동시 열람이 많을수록 무겁다. 처방 = 필요한 칼럼만. 묶음 PERF |
| R116 | dm.ts:389 | 성립(데이터 잔존·낮음) | DM·재료·카탈로그 이미지는 올린 뒤 지우는 경로가 없다(delete-image 라우트 호출처 없음 · 정리 작업 없음). 묶음 FILES |
| R117 | dm.ts:1209 | 성립(격리·상시 원칙) | DM 소유 가드(canAccessDm)가 publish·stats·send-to-target·추적·수신자 상세·copy 생성·test-send·승인·validate·responses 등에 없다(회사 조건만) → 같은 회사 다른 사용자의 DM을 발송·수정. 묶음 SCOPE |
| R118 | dm.ts:1360 | 성립(속도·설계) | DM 타겟 발송이 대상 고객 전체를 Node로 가져와 토큰을 만들고 한 문장 UNNEST로 적재(요청 안 동기). 묶음 PERF |
| R119 | dm.ts:1394 | 성립(추적 수치 과대) | 수신자 토큰을 수신거부·중복 필터(스테이징 집계) **전에** 전원 발급 → 실제로 안 나간 사람도 추적에서 '발송'으로 잡힌다. 묶음 DM |
| R120 | dm.ts:2508 | 성립(A/B 판정 무력) | A/B 공개 뷰어가 추적 주소를 '/api/dm/v'(일반 DM)로 그려(2550·2552행) 체류·완독·클릭 비콘이 A/B 기록(/ab/:code/track)으로 가지 않는다 → A/B dm_views는 첫 조회(1쪽·0초)만 · 승자 판정이 사실상 방문 수. 묶음 DM |
| R121 | email.ts:217 | 성립(속도·큰 캠페인) | 오픈 픽셀마다 그 캠페인 이벤트를 COUNT(email-channel.ts:633 · 인덱스는 campaign_id 선두라 캠페인 전체 스캔) + 확인 뒤 증가라 동시 오픈이면 고유 오픈 수가 빠진다. 묶음 MAIL |
| R122 | email.ts:453 | 성립(낮음·속도) | 이메일 캠페인 목록마다 회사 AI 크레딧 거래를 idempotency_key LIKE로 훑는다. 묶음 PERF |
| R123 | email.ts:723 | 성립(중복 발송·경합) | 이메일 발송이 status !== 'sending' 확인 뒤 WHERE id만으로 sending 선점 → 동시 요청 둘 다 통과해 같은 메일 두 번. 미오픈 재발송도 같은 모양. 묶음 STATE |
| R124 | godo.ts:100 | 성립(해제 무시·경합) | 백필 끝에서 조건 없이 status='active'(godo-client.ts:181) → 백필 도중 연동 해제하면 되살아나 수집 재개. 묶음 CDP |
| R125 | image-studio.ts:194 | 성립(데이터·낮음) | 임시 보관 상한(200MB)은 /generate에만(194행) — 가져오기·업로드·누끼 등 다른 임시 쓰기(281·350·375·391행)는 상한 없음(보관 기한 정리는 있음). 묶음 STUDIO |
| R126 | image-studio.ts:335 | 성립(보안·SSRF) | 상품 이미지 가져오기가 DNS 조회 뒤 fetch를 다시 해석(재바인딩 창) · 사설 판정이 기존 CT(resolvePublicAddress·pinnedLookup)보다 약하다. 처방 = R1-28처럼 CT로. 묶음 SEC |
| R127 | image-studio.ts:489 | 성립(유료 산출물 유실·조건부) | MMS 저장이 원본 임시 파일을 지운 뒤(489행) 용량 한도를 검사 → 한도 초과면 화면이 든 옛 id로는 다시 저장할 수 없다(새 합성본은 다른 id로 남음). 처방 = 검사 먼저. 묶음 STUDIO |
| R128 | imweb.ts:77 | 이미 고침(R1-02) | |
| R129 | insight.ts:30 | 성립(표시·가짜 실적) | 일일 인사이트의 어제 발송·성공이 0 고정(daily-insight-mailer.ts:89 "향후 통합") → 화면·메일이 0을 실적처럼 보인다. 묶음 MAIL |
| R130 | manage-callbacks.ts:126 | 성립(낮음) | 고객사 쪽 발신번호 등록도 대표번호를 먼저 해제한 뒤 상한 검사(R067과 같은 뿌리). 묶음 CB |
| R131 | manage-stats.ts:144 | 성립(표시 누락) | 발송통계 '테스트' 탭이 테스트 라인 LIVE 테이블만 본다 → LOG로 옮겨진 완료 테스트가 빠진다. 묶음 RES |
| R132 | manage-users.ts:216 | 성립(권한 검사 무력) | 관리자 계정 삭제 차단이 DB user_type을 'company_admin'과 비교(DB 값은 'admin' — SCHEMA 1508행) → 항상 통과 · 회사 관리자가 다른 관리자를 지울 수 있다. 묶음 SCOPE |
| R133 | mms-images.ts:83 | 중복(S4-01 계열 · 보존 정책) | MMS 업로드 정리 주기 없음(설계상 사용자가 지울 때만 삭제 · 참조 중 삭제 막음 — 부분 ④ 기록) |
| R134 | pay-mappings.ts:25 | 성립(보안·계정 탈취 위험) | PAY 일괄 생성 계정이 소스에 박힌 같은 초기 비밀번호 · 최초 로그인 뒤 변경 강제는 화면 흐름뿐 → 아직 로그인 안 한 계정은 그 값을 아는 누구나 먼저 들어가 비밀번호를 정할 수 있다. 처방 = 계정마다 무작위 초기값·전달 또는 미사용 계정 잠금. 묶음 SEC |
| R135 | results.ts:731 | 이미 고침(F27) | |
| R136 | results.ts:1016 | 중복(F28 보류) | |
| R137 | short-url.ts:96 | 중복(S4-01 보존 기한) | |
| R138 | spam-filter.ts:263 | 이미 고침(F30) | |
| R139 | sync.ts:894 | 중복(S4-01) | |
| R140 | sync.ts:897 | 중복(S4-01) | 실패 목록(전화번호 포함) jsonb 상한 없음은 보존 정책과 함께 |
| R141 | unsubscribes.ts:73 | 성립(속도·동기 파싱) | 최대 20MB 엑셀을 요청 안에서 동기 파싱하고 파싱·등록 두 단계에서 두 번. 대행 엑셀은 S1-H03으로 별도 프로세스 — 같은 CT로 옮길 여지. R1-06·R1-11과 같은 뿌리. 묶음 XLSX |
| R142 | unsubscribes.ts:197 | 성립(낮음·성능) | 목록 CT(unsubscribe-helper.ts:471~481)가 DISTINCT ON(phone)으로 대상 전체를 받아 JS에서 created_at 정렬·slice로 20건을 자른다. 처방 = 서브쿼리 DISTINCT ON 뒤 SQL ORDER BY·LIMIT/OFFSET. 묶음 PERF |
| R143 | upload.ts:494 | 성립(낮음·재시작 시) | 백그라운드 고객 업로드가 재시작 복구 없음 → 진행률 'processing'이 TTL까지 남아 화면이 계속 폴링. 묶음 XLSX |
| R144 | upload.ts:539 | 성립(조건부·무헤더 파일) | 백그라운드 처리가 헤더 판정(isFirstRowHeaderRow)과 무관하게 `rows = data.slice(1)`(540행) → 무헤더 파일은 첫 고객이 빠지고 헤더 이름 매핑이 어긋난다. 묶음 XLSX |
| R145 | upload.ts:869 | 성립(데이터 타입 덮어쓰기) | 타입 자동 감지가 배열 행(sheet_to_json header:1)에 헤더 이름으로 접근(`r[header]`)해 표본이 늘 비어 field_type 미정 → 정의 저장 CT가 매 업로드 VARCHAR로 덮어쓴다(ON CONFLICT field_type = EXCLUDED). 싱크가 넣은 DATE·INT가 초기화. 묶음 XLSX |
| R146 | voice.ts:41 | 해소(음성 AI 제거) | |
| R147 | woocommerce.ts:121 | 이미 고침(R1-02) | |
| R148 | access-log.ts:61 | 중복(S4-01 · 보존 기한) | |
| R149 | agency-send-intake.ts:744 | 성립(낮음·메모리) | 원스텝 분석이 수신자 객체를 두 벌(allRecipients · groups[].recipients) 만들고 groups[].recipients는 쓰는 곳이 없다(응답은 toAnalysisView로 걸러짐) — 큰 명단에서 메모리 두 배. 묶음 PERF |
| R150 | agency-send-mail-worker.ts:1067 | 중복(m018) | |
| R151 | agency-send-mail-worker.ts:1230 | 성립(낮음·누적 부하) | 메일함(DELE 0)과 처리 원장이 무기한 쌓이고 매분 전체 UIDL·LIST와 전량 대조가 함께 커진다. 묶음 AGC |
| R152 | agency-send-worker.ts:1048 | 중복(S4-01 · R1-13 병합) | |
| R153 | agency-send-worker.ts:1323 | 중복(m019 · 의도) | |
| R154 | agent-build-tiers.ts:278 | 성립(에이전트 업데이트 호환·조건부) | 자동 업데이트 티어 판별이 6.2(Windows 8·Server 2012 비R2)를 win-mid로 보낸다 — 설치 티어표는 2012 비R2를 win-legacy(node12)로 둔다(93~95행) → 그 서버에 node16 빌드가 내려갈 수 있다. 묶음 ADMIN |
| R155 | ai-mapping.ts:440 | 성립(낮음) | AI 응답 파싱 실패 시 전부 null 매핑을 성공으로 반환 · 쿼터는 차감 · 로컬 폴백 없음. 묶음 AI |
| R156 | ai-memory-accumulator-worker.ts:78 | 성립(반복 부하) | 여정 학습이 매시간 실행 건마다 cdp_events를 JOIN해 훑는다(멱등 없음). 묶음 WORKER |
| R157 | ai-memory-accumulator-worker.ts:136 | 성립(반복 부하) | 등급 인사이트 대상 선정이 매시간 회사별 customers 전체 집계. 묶음 WORKER |
| R158 | ai-memory-accumulator-worker.ts:233 | 성립(반복 부하) | DM 학습 후보를 매시간 dm_recipient_tokens 전체 DISTINCT로 뽑는다. 묶음 WORKER |
| R159 | ai-memory-accumulator-worker.ts:242 | 성립(헛도는 작업) | DM·이메일 학습의 20시간 멱등 조건이 회사당 한 행(247·321행) → 대상마다 매시간 재계산. 묶음 WORKER |
| R160 | ai-memory-accumulator-worker.ts:254 | 이미 고침(R1-18 · 추적 CT 전체 기준 · 학습 워커도 전체) | |
| R161 | ai-segment-generator.ts:149 | 성립(낮음·AI 입력) | 자연어 타겟 변환 프롬프트에 오늘 날짜(KST)가 없고 예시 날짜만 UTC toISOString으로 계산 → 상대 날짜 요청이 어긋날 수 있다. 묶음 AI |
| R162 | ai-self-diagnosis.ts:158 | 성립(속도 + 전환 0) | 자가진단이 cdp_events를 기간 조건 없이 훑고(FILTER만 30일) 독립 조회를 순차로 기다린다 · 주문 이벤트를 'order'로 세 늘 0(저장 이름은 'purchase' — R1-43과 같은 결함). 묶음 ANAL |
| R163 | alimtalk-jobs.ts:245 | 이미 고침(P-04 설계안 B) | |
| R164 | automarketing-roi.ts:70 | 성립(속도) | ROI 매출이 회사 전 기간 구매 이벤트를 훑고 CDP 보유 확인도 COUNT(*) 전수. 묶음 ANAL |
| R165 | automarketing-roi.ts:76 | 성립(분석 과대) | '자동마케팅이 만든 매출' = 발송 뒤 7일 창의 회사 전체 구매 합계(수신자 무관 · R093과 같은 뿌리). 묶음 ANAL |
| R166 | bandit-optimizer.ts:455 | 성립(쓰기 부하·낮음) | 여정 변이 보상을 수신자 한 명마다 같은 행에 UPDATE(+조회·로그) → 대량 여정에서 한 행 경합. 묶음 PERF |
| R167 | best-copy-assets.ts:53 | 성립(낮음·데이터) | best_copy_seed_usage가 생성마다 쌓이기만 하고 집계는 전 기간을 훑는다. 묶음 RETAIN |
| R168 | best-copy-miner.ts:76 | 성립(속도·AI 비용) | 베스트 문안 채굴이 업종 학습 로그 전건을 LIMIT 없이 올리고(76행 주석 "전수 조회") 매번 전부 AI로 다시 판정(이미 판정한 것 건너뜀 없음). 묶음 AI |
| R169 | billing-issue.ts:269 | 개선 여지(기록) | 발행의 두 사용량 집계(일자축·상세축)가 서로 독립인데 순차 await |
| R170 | brand-basic-info.ts:54 | 성립(권한·세금계산서 데이터) | 브랜드 학습 기본정보 저장(PUT /dm/brand-basic-info)이 관리자 확인 없이 companies의 상호·사업자번호 등을 덮어쓴다(형식 검증 없음) — 세금계산서 공급받는자 정보. 묶음 SCOPE |
| R171 | brand-message.ts:1594 | 성립(낮음·속도) | 브랜드 발송마다 그 계정의 수신거부 전량을 LIMIT 없이 읽는다. 묶음 PERF |
| R172 | brand-voice-validator.ts:35 | 성립(AI 재생성 낭비·품질) | 이모지 패턴에 FE0F(변형 선택자)·200D(ZWJ)가 독립 문자로 들어 있어 ❤️ 같은 허용 이모지도 위반 판정 → 매번 AI 재생성. 묶음 AI |
| R173 | campaign-lifecycle.ts:84 | 중복(m096) | |
| R174 | campaign-lifecycle.ts:249 | 이미 고침(F35) | 떠난 행 = status_code != 100(cancel-settle.ts:60) → 비토 라인 제자리 결과도 발송으로 셈 |
| R175 | campaign-lifecycle.ts:597 | 성립(헛도는 작업) | 결과 동기화 대상 조건이 target_count(정제 전) > 성공+실패(533·686행) → 수신거부·중복 제외가 있는 캠페인은 7일 동안 5분마다 재동기화. 처방 = sent_count와 비교. 묶음 WORKER |
| R176 | campaign-quick.ts:115 | 성립(데이터 잔존·낮음) | AI 자동제작 재료 이미지 사본이 uploads/dm-images에 무기한 누적. 묶음 FILES |
| R177 | campaign-response-attribution.ts:130 | 성립(속도) | 반응 매트릭스가 창 3개마다 고객 전체 × 캠페인 EXISTS와 전 기간 구매 × 캠페인 EXISTS를 반복. 묶음 ANAL |
| R178 | campaign-sync-worker.ts:265 | 중복(m115) | |
| R179 | cdp-burst-limit.ts:37 | 성립(데이터 유실·트래픽 있는 몰) | 버스트 제한(50건/10초)이 회사 단위라 브라우저 SDK /ingest(쇼핑객 전원 합산)가 막혀 행동 이벤트가 429로 버려진다. 처방 = /ingest는 방문자(익명 id) 단위. 묶음 CDP |
| R180 | cdp-diagnostics.ts:85 | 성립(속도) | 자사몰 진단의 이벤트 누적 COUNT에 기간 하한이 없어 회사 전 기간 cdp_events 스캔. 묶음 CDP |
| R181 | cdp-events.ts:209 | 성립(이중 작업) | 이벤트 1건마다 프로필 즉시 재계산 + 5분 워커가 같은 고객 재계산. 묶음 CDP |
| R182 | cdp-events.ts:413 | 성립(신호 누락) | 고객 행 신호 반영(fuseEventToCustomer)은 서버 trackEvent(216행)에서만 부른다. 브라우저 SDK 적재(ingestBrowserEvents)는 cdp_events에만 넣어 last_cart_add_at·장바구니 횟수·페이지 조회가 고객 행에 안 쌓인다 → 여정 기회·추천의 장바구니 신호에서 빠진다. 묶음 CDP |
| R183 | cdp-fusion-explainer.ts:157 | 성립(가짜 결과 표시) | 자사몰 AI 진단이 모든 오류를 삼키고 '건강도 50점'을 실제 결과처럼 반환 → 크레딧 부족·한도 초과도 가려진다. 묶음 AI |
| R184 | cdp-identity.ts:309 | 개선 여지(기록) | 회원 1명 식별에 쿼리 10여 개 + 백그라운드 재계산 |
| R185 | cdp-orders.ts:101 | 중복(P-05 · 인덱스 A5) | |
| R186 | cdp-profile-recompute-worker.ts:59 | 성립(세그먼트 오염) | 30일 장바구니·위시 카운터 감쇠 함수(decayInactiveCounters · customer-cdp-fusion.ts:111)를 부르는 곳이 없다 → 오래전에 담은 고객이 인앱 세그먼트에 계속 든다. R201 같은 건. 묶음 CDP |
| R187 | cdp-webhook-retry-worker.ts:28 | 성립(누적·반복 부하) | 웹훅 수신 기록이 지워지지 않고 재처리 워커가 5분마다 회사 조건 없이 세 번 훑는다. 묶음 CDP |
| R188 | cdp-webhook-retry-worker.ts:55 | 성립(재처리 무력·아임웹) | 원래 경로는 `body.data`를 먼저 꺼내는데(imweb.ts:61) 재처리는 `payload.resource || payload`(55행) → 아임웹 실패 웹훅은 재처리해도 같은 모양으로 또 실패. 묶음 CDP |
| R189 | citations.ts:96 | 중복(R082) | |
| R190 | company-smtp-client.ts:260 | 개선 여지(기록) | 수신자마다 SMTP 연결·TLS·인증 새로 · 설정 매번 조회(R225와 같은 건) |
| R191 | connected-content.ts:176 | 이미 고침(R1-35 · 모르는 날씨는 지어내지 않는다) | |
| R192 | continuous-operator.ts:692 | 성립(자동 재개 불가 + 매분 헛선택) | 크레딧 부족 정지(paused_no_credit)는 매분 재선택(1428행)되지만 제안 생성의 운영자 로더가 `status='active'`만 읽어(699행) null로 끝난다 → 자동 재개 코드(883행)에 영영 닿지 않는다 · 충전해도 자동마케팅이 스스로 살아나지 않는다. 묶음 OPS |
| R193 | continuous-operator.ts:795 | 성립(AI 입력 결함) | 고객 평균 구매횟수·금액을 custom_fields->>'purchase_count'·'total_spent'에서 읽는다(825행) — R078과 같은 뿌리 · 늘 0. 묶음 AI |
| R194 | continuous-operator.ts:1009 | 성립(리마인드 조용히 만료·조건부) | 다음 회차 생성이 같은 운영자의 pending·admin_review 전부를 만료(1039행) → 스팸 미통과로 승인 대기(admin_review)에 있던 리마인드가 알림 없이 사라진다. 묶음 OPS |
| R195 | continuous-operator.ts:1439 | 성립(반복 부하) | 매분 operator_proposals를 여러 번 훑고 두 번은 proposal_json을 풀어 비교(인덱스 없음). 묶음 OPS |
| R196 | continuous-operator.ts:1642 | 성립(쓰기 부하·낮음) | 크레딧 부족 회사의 미정산 제안서마다 매 패스 시도 시각을 proposal_json에 다시 쓴다(stampChargeAttempt). 묶음 OPS |
| R197 | continuous-operator.ts:1757 | 성립(예산 창 어긋남) | 운영자 일·월 예산 합계가 CURRENT_DATE(UTC 세션)로 창을 자른다(694행 등) → KST 00~09시 발송은 전날 예산으로 셈. 묶음 OPS |
| R198 | continuous-operator.ts:2061 | 성립(예산 집계) | 실측 수량·비용 기록(2153·2159)은 autoPath 분기 안에만 있다(2091행). 수동 승인 발송은 제안 시점 추정치가 그대로 남아 운영자 일·월 예산 합계가 실제와 어긋난다. 처방 = 기록 UPDATE를 분기 밖으로(검사는 자율만 · 기록은 둘 다). 묶음 OPS |
| R199 | copy-context.ts:89 | 성립(시한 결함·2027년부터) | 명절·공휴일 표가 2026년 날짜만(55~57행) · 설·추석 창 MM-DD 고정(2026 기준) → 2027년부터 명절 문맥이 틀린다. 묶음 YEAR(R111과 함께) |
| R200 | customer-cdp-fusion.ts:63 | 성립(쓰기 부하) | page_view 이벤트마다 customers 행 UPDATE → 고객 테이블 죽은 튜플 증가. 묶음 CDP |
| R201 | customer-cdp-fusion.ts:111 | 중복(R186) | |
| R202 | customer-filter.ts:265 | 성립(낮음·타겟 조건) | days_within 기준일을 UTC toISOString 날짜로 잘라 KST 00~09시에 하루가 더 포함. 묶음 TZ |
| R203 | customer-filter.ts:660 | 성립(로그 개인정보·낭비) | 필터 호환 래퍼가 호출마다 입력 필터·SQL·파라미터를 DEBUG로 console.log(검색값 포함). 묶음 PRIV |
| R204 | customer-timeline.ts:995 | 성립(더 보기 불가) | 원천별로 limit+1을 받지만 runSource가 limit으로 잘라(261행) 합친 결과가 정확히 limit이면 nextBefore를 만들지 않는다(968행). 원천 하나만 결과를 내면 화면은 "아래 더 보기로 이어집니다"라고 안내하면서 버튼이 없다. 처방 = 어느 원천이든 truncated면 커서 생성. 묶음 CDP |
| R205 | customer-upsert.ts:121 | 정책(D214+ 설계) | 싱크·업로드마다 last_activity_at = NOW()(주석: 싱크도 활동 시각) → 인앱 '최근 N일 활동' 세그먼트와 의미가 충돌. 활동 정의는 결정 필요 |
| R206 | customer-upsert.ts:191 | 성립(쓰기 부하) | 고객 업서트 ON CONFLICT DO UPDATE에 값 변화 조건(IS DISTINCT FROM)이 없어 full 싱크마다 전 행 재작성(customers 939MB · 죽은 튜플). 묶음 PERF |
| R207 | daily-insight-mailer.ts:89 | 중복(R129) | |
| R208 | direct-send-worker.ts:537 | 중복(P-01 · 인덱스 A) | |
| R209 | dm-ab-test.ts:378 | 중복(R120) | |
| R210 | dm-ai.ts:983 | 성립(브랜드 무시) | 비주얼 디렉터 유일 호출(1000행)이 brandKit 자리에 undefined를 넘긴다 → 회사 브랜드킷 대표 색이 프롬프트에 들어가지 않아 생성 DM 색이 브랜드와 무관. 묶음 DM |
| R211 | dm-ai.ts:1079 | 불성립 | CTA 섹션은 aiAware이고 기본 props에 buttons가 있어(dm-section-registry.ts:542) 생성 카피 첫 헤드라인이 buttons[0].label로 들어간다(1096행). 버려지지 않는다 |
| R212 | dm-brand-kit.ts:38 | 성립(드묾·조용한 무시) | brand_kit 칼럼 확인이 한 번 실패하면 false를 영구 캐시 → 재시작 전까지 브랜드킷 저장이 조용히 무시. 묶음 DM |
| R213 | dm-builder.ts:488 | 성립(낮음·성능) | DM 목록이 페이지 없이 회사(또는 본인) 전체 DM의 sections·brand_kit·settings JSON 전체를 매번 받아 요약만 쓴다. 묶음 PERF |
| R214 | dm-builder.ts:578 | 중복(R115) | |
| R215 | dm-builder.ts:836 | 이미 고침(R1-18) | |
| R216 | dm-builder.ts:902 | 성립(쓰기 부하·낮음) | 열람 하트비트마다 dm_views에 추가 UPDATE(값 불변이어도). 묶음 PERF |
| R217 | dm-interaction.ts:308 | 성립(조건부·중복) | 중복 방지가 ON CONFLICT (response_id) WHERE response_id IS NOT NULL뿐이라, 섹션 미지정이거나 참여 응답과 매칭되지 않는 당첨자(response_id NULL)는 같은 엑셀을 다시 올리면 그대로 한 번 더 들어간다. 묶음 DM |
| R218 | dm-interaction.ts:408 | 중복(P-06 보류) | |
| R219 | dm-interaction.ts:474 | 성립(추첨 누락·드묾) | 마감 추첨이 실행 권리(claimDrawRun)를 먼저 커밋하고 당첨자 INSERT·집계를 트랜잭션 밖에서 → 중간 실패면 다시 돌지 않는다. 묶음 DM |
| R220 | dm-quick-action.ts:315 | 이미 고침(R1-26) | |
| R221 | dm-recipient-token.ts:104 | 중복(S4-01) | |
| R222 | dm-viewer.ts:1099 | 중복(R114) | |
| R223 | email-channel.ts:143 | 성립(법정 표기 부정확) | 발신자 이름이 비면 광고 메일 법정 footer의 전송자 명칭이 '한줄로AI'로 찍힌다(143행 기본값). 묶음 MAIL-LAW |
| R224 | email-channel.ts:423 | 중복(R123) | 발송 선점 비원자 |
| R225 | email-channel.ts:459 | 개선 여지(기록) | R190과 같은 건 |
| R226 | email-channel.ts:499 | 성립(법정 표기 불일치) | 캠페인에서 지정한 발신자 이름·주소가 실제 From에 반영되지 않는다 — From은 회사 SMTP 설정(company-smtp-client.ts:342) · footer는 캠페인 값 → 둘이 다를 수 있다. 묶음 MAIL-LAW |
| R227 | email-channel.ts:504 | 성립(법·광고 표기) | text/plain 파트가 campaign.textBody 원문 그대로(개인화·변수 제거·광고 표기 없음) → 텍스트로 여는 수신자에게 {{변수}}가 보이고 광고 표기가 빠진다. 묶음 MAIL-LAW |
| R228 | email-channel.ts:517 | 성립(낮음·발송 평판) | SMTP 거부(반송)를 기록하지 않아 반송율 0 · 무효 주소에 계속 발송. 묶음 MAIL |
| R229 | email-channel.ts:609 | 중복(S4-01) | |
| R230 | email-channel.ts:632 | 중복(R121) | |
| R231 | email-send-sweeper.ts:104 | 성립(드묾·예약 누락) | 예약 선점 뒤 수신자 해석이 예외면 sending에 멈췄다가 30분 뒤 failed · 재시도 없음. 묶음 MAIL |
| R232 | enabled-fields.ts:158 | 성립(Redis 부하) | 캐시 무효화마다 redis.keys(pattern) = 전체 키 공간 스캔(블로킹) · 싱크 배치마다 호출. 처방 = SCAN 또는 키 목록 보관. 묶음 PERF |
| R233 | forecast.ts:24 | 성립(분석 왜곡) | 입력 시계열(full-analysis-collect.ts:105)이 발송 있는 날만 GROUP BY → 빈 날이 빠진 채 순번을 x로 회귀하고 "다음 동일 기간"도 발송일 수만큼만 투영. R074와 같은 뿌리(빈 날 0 채우기 누락). 묶음 ANAL |
| R234 | free-messaging.ts:73 | 성립(속도·조건부) | 무료 잔량 식이 billing_items를 company_id로 거른다 — 인덱스는 (billing_id, channel)뿐(SCHEMA 1805) → 선불 발송마다 두 번 전체 스캔(billing_items가 클수록). 묶음 FREE |
| R235 | free-messaging.ts:222 | 성립(돈 경로·발송 실패 연쇄) | 표시용 시도 카운터(recordFreeAttempt)를 선불 차감 트랜잭션 안(prepaid.ts:199 client)에서 SAVEPOINT 없이 실행 → 이 UPDATE가 실패하면 JS가 잡아도 PG 트랜잭션이 aborted라 차감 전체가 실패(주석의 "발송을 막지 않는다"와 반대). 처방 = SAVEPOINT 또는 트랜잭션 밖. 묶음 FREE |
| R236 | full-analysis-runner.ts:84 | 성립(데이터 잔존·낮음) | 풀분석 PDF가 서버 디스크에 쌓이기만 한다. 묶음 FILES |
| R237 | gateway-template-mapping-worker.ts:124 | 성립(조건부·적체) | 54 게이트 꺼짐이면 54 행을 건너뛰기만 하고 updated_at을 안 바꿔, 오래된 54 pending이 50건(PUSH_BATCH_LIMIT) 이상이면 매 패스 같은 50건만 뽑혀 58 행이 영영 푸시되지 않는다. 처방 = 조회에서 게이트 꺼진 서버를 제외. 묶음 GW |
| R238 | godo-sync-worker.ts:153 | 성립(헛도는 작업) | 30분마다 최근 약 3일 주문 전부를 다시 처리(주문 1건당 UPDATE 여러 번). 묶음 CDP |
| R239 | grade-conversion-stats.ts:72 | 성립(분석 왜곡) | 분모 SUM(sent_count)가 cdp_events LEFT JOIN 뒤라 구매 이벤트 수만큼 부풀어 전환율 과소. 묶음 ANAL |
| R240 | image-serve.ts:143 | 성립(낮음·성능) | 캐시 미스 때 동기 fs 읽기·쓰기 + 같은 이미지 동시 요청이 각자 sharp 변환(한 번만 변환하도록 묶는 장치 없음). 묶음 PERF |
| R241 | image-studio.ts:189 | 성립(내부 프롬프트 노출) | 숨긴 템플릿 골격을 붙인 최종 프롬프트가 cdp_assets.prompt에 그대로 저장되고 소재 조회 API가 그 칸을 내려보낸다. 묶음 STUDIO |
| R242 | image-studio.ts:214 | 성립(과금 · 고객 산출물) | 화면이 세일 템플릿 자리표시 문구를 미리 채워 두고 서버에 막는 장치가 없어, 바꾸지 않으면 자리표시 문구가 포스터에 그려진 채 2크레딧 차감. 묶음 STUDIO |
| R243 | imweb-client.ts:57 | 개선 여지(기록) | 아임웹 초기 백필 없음 |
| R244 | imweb-client.ts:231 | 성립(조건부) | 같은 siteCode가 여러 회사 active면 웹훅이 임의 한 곳으로(R098과 같은 뿌리). 묶음 CDP |
| R245 | imweb-client.ts:438 | 성립(적재 누락) | 비회원 주문은 회원 식별값이 빈 문자열 → syncOrder가 externalId 빈 값으로 예외 → 주문이 적재되지 않는다. 묶음 CDP |
| R246 | inapp-ai-generator.ts:702 | 성립(과금) | AI 응답 파싱이 실패해도 크레딧은 이미 차감되고, 깨진 응답이 5분 캐시에 남아 같은 요청을 다시 해도 같은 실패. 묶음 INAPP |
| R247 | inapp-ai-generator.ts:759 | 성립(노출 조건) | 플래너 제작 경로(planner-production.ts:414)는 triggerEvent를 넘기지 않아 trigger_event가 page_load로 저장되고, 서빙 조건이 `trigger_event = $2 OR trigger_conditions->>event = $2`라 AI가 고른 트리거와 무관하게 모든 페이지 로드에 노출된다(화면 저장은 600행에서 맞춰 줌). 처방 = createInAppMessage에서 trigger_conditions.event를 기본값으로. 묶음 INAPP |
| R248 | inapp-display-eligibility.ts:87 | 성립(낮음·성능) | 생존 신호 MAX(occurred_at)를 기간 제한 없이 cdp_events 전체에서 구한다. 묶음 PERF |
| R249 | inapp-explainer.ts:227 | 성립(낮음·AI 근거) | 진단 프롬프트에 출처 없는 CTR 효과 수치와 200~400자 기준이 들어가 다른 길이 규칙과 충돌. 묶음 AI |
| R250 | inapp-funnel-stats.ts:127 | 성립(분석 왜곡) | 24시간 귀속 매출 JOIN이 노출 1건당 구매를 곱해 같은 주문 금액이 여러 번 합산된다. 묶음 ANAL |
| R251 | inapp-funnel-stats.ts:134 | 성립(분석 왜곡) | 구매 귀속 비교가 날짜 자정 기준이라 당일 노출 전 구매까지 귀속된다. 묶음 ANAL |
| R252 | inapp-funnel-stats.ts:289 | 성립(가짜 지표) | 기기 분포가 실측 없이 전체 수치를 모바일 70 · PC 30으로 나눈 값(주석 "단순 추정") — 화면에 통계처럼 나간다. 목업 지표 금지 위반. 묶음 STATS-FAKE(R129와 함께) |
| R253 | inapp-funnel-stats.ts:402 | 불성립 | 개요 CTR 조회는 30·60일로 기간이 묶여 있다 |
| R254 | inapp-message.ts:1016 | 중복(R104) | |
| R255 | inapp-message.ts:1239 | 성립(식별 오매칭) | 외부 ID → 고객 매핑이 source를 보지 않고 LIMIT 1 → 몰 두 곳에서 같은 회원번호면 다른 고객으로 매칭(세그먼트·개인화 오적용). 묶음 CDP |
| R256 | inapp-personalization.ts:415 | 성립(치환 누락) | 등급·포인트 인식이 '%등급%'·'%포인트%'만 봐서 표준 표기(%고객등급%·%보유포인트%)는 치환되지 않은 채 노출. 묶음 INAPP |
| R257 | inapp-variant-optimizer.ts:117 | 성립(과금·낮음) | 부모 조회가 parent_message_id를 보지 않아 변형을 부모로 삼을 수 있다. 서빙은 parent_message_id IS NULL만 후보라 손자 변형은 절대 노출되지 않는데, 빠른 다듬기(inapp-quick-action.ts)는 3크레딧을 차감한다. 처방 = 부모가 변형이면 거절. 묶음 INAPP |
| R258 | inapp-variant-optimizer.ts:404 | 성립(노출 중단) | 승자 선언의 패자 목록에 부모 행이 들어간다(listVariantsWithStats가 부모 포함). 변형이 이기면 부모가 paused → 서빙 후보 조건(부모 status=active)에서 빠져 승자 변형까지 전부 노출 중단. 처방 = 부모 행은 정지 대상에서 빼고 variant_weight만 0으로(부모는 노출 입구라 꺼지면 안 된다). 묶음 INAPP |
| R259 | journey-ai-generator.ts:926 | 성립(AI 임의 혜택 · 절대 원칙) | 날짜축 여정 문안 생성(913~914행)만 혜택 차단기(stripUnauthorizedBenefits)를 거치지 않는다 — 다른 여정 경로(636·836행)는 거침. 묶음 AI-BENEFIT |
| R260 | journey-ai-generator.ts:960 | 성립(과금·속도) | 오프셋 최대 8개를 AI 1건씩 순차 호출하고 호출마다 1크레딧 차감. 중간에 실패하거나 크레딧이 모자라면 앞서 차감한 크레딧은 남고 결과는 하나도 돌려주지 않는다(402·500). 처방 = 진입에서 N크레딧 사전 확인 → runInCreditBundle 안에서 병렬(상한) 생성 → 전부 성공 뒤 1회 차감. 묶음 AI |
| R261 | journey-anchor-scheduler.ts:162 | 성립(낮음·헛도는 작업) | 발송일에 발송 시각이 지나면 그날 남은 30분 틱마다 대상 전체(상한+1 또는 JOURNEY_COUNT_CAP)를 다시 추출하고 ON CONFLICT로 버린다. 같은 날 대상이 늘어 상한을 넘으면 이미 보낸 뒤에 여정이 정지되는 부작용도 있다. 처방 = (여정·스텝·발송일) 처리 완료 표시 뒤 재추출 생략. 묶음 WORKER |
| R262 | journey-stats.ts:233 | 이미 고침(R1-43 · 'order' → 'purchase') | |
| R263 | journey-stats.ts:313 | 성립(성능·집계) | 실행 1건당 한 행을 전부 받아 행마다 cdp_events 상관 서브쿼리 2개. 같은 고객의 실행이 여러 건이면(날짜축 반복) 클릭이 실행 수만큼 중복 합산. 묶음 PERF |
| R264 | journey-stats.ts:742 | 성립(표시) | 실행기는 다음 스텝을 current_step_order + 1로 찾는다(journey-executor.ts:311) = 이 값은 마지막으로 끝낸 스텝. 실시간 위치는 이를 현재 스텝으로 세어 1단계 대기 고객(0)은 안 보이고 나머지는 한 칸 앞 스텝에 표시. 묶음 JRN |
| R265 | journey-target-extractor.ts:821 | 성립(낮음·성능) | 미리보기(ai.ts:4025~4026)가 표본 추출과 인원 추출을 따로 돌고 인원은 최대 상한까지 UUID를 Node로 받았다가 다시 DB로 보낸다. 대상 확인(4071)도 같은 추출 두 번. 처방 = COUNT·등급 분포를 SQL 한 번으로. 묶음 PERF |
| R266 | journey-trigger-watcher.ts:212 | 성립(낮음·성능) | 생일·휴면·포인트처럼 날짜 단위로만 바뀌는 상태형 트리거도 5분 틱마다 회사 고객 전체를 안티조인 추출. 장바구니·등급 변경처럼 잦은 확인이 필요한 트리거와 주기를 나누면 된다. 묶음 PERF |
| R267 | kakao-template-sync-worker.ts:49 | 성립(낮음·헛도는 작업) | Tm% 키가 남은 템플릿이 하나라도 있으면(코드 미발급 반려 건은 영구히 남는다) 30분마다 syncTemplateCodes와 syncTemplateStatuses가 IMC 전체 목록을 각각 페이지 순회하고 페이지마다 로그. 처방 = 한 사이클에 목록 1회 조회를 두 함수가 공유. 묶음 WORKER |
| R268 | login-block.ts:104 | 판정 보류(인덱스 유무) | audit_logs의 (action, ip_address, created_at) 계열 인덱스 존재를 SCHEMA.md로 알 수 없다. 인덱스 A 착수 때 pg_indexes 확인 1줄에 합류해 판정. 묶음 PERF |
| R269 | messageUtils.ts:158 | 성립(고객 문안 훼손 · 발송 파이프라인) | 잔여 변수 제거 정규식 `/%[가-힣A-Za-z_][^%\s]{0,19}%/g`가 replaceVariables(모든 발송 치환 CT)에서 돌아 '30%할인+10%적립' → '30적립', '50%OFF+5%' 같은 공백 없는 퍼센트 문구를 발송 때 지운다. 고객 문안 무단 변경. 처방 = 알려진 변수 이름만 제거(허용 목록). 묶음 COPY(m068과 함께) |
| R270 | voice-inbound.ts:126 | 해소(음성 AI 제거) | |
| R271 | AdminDashboard.tsx:13226 | 성립(관리자·설정 덮어씀) | [설정] 버튼이 목록 행에 이미 있는 현재 주기(sync_interval_customers_min 등) 대신 60/30 고정값으로 창을 열고(13243행), 저장하면 그 값이 실제 주기를 덮는다. 묶음 ADMIN |
| R272 | Dashboard.tsx:1225 | 개선 여지(기록) | 첫 로딩 API 5개 순차 await |
| R273 | JourneysPage.tsx:900 | 성립(표시 누락·헛도는 작업) | /stats 응답은 { success, stats }(ai.ts:5208)인데 화면은 data.steps를 읽어 저장 조건이 늘 거짓 → 스텝 통계가 화면에 안 나오고, 캐시도 안 되어 펼칠 때마다 무거운 통계를 다시 돈다. 묶음 JRN |
| R274 | admin-sync.ts:165 | 성립(표시) | '오늘' 동기화 건수가 started_at >= CURRENT_DATE. DB 세션 TimeZone = Etc/UTC(SCHEMA.md 0803 실측) → KST 00~09시 분이 빠진다. R197과 같은 뿌리. 묶음 TZ |
| R275 | admin-sync.ts:357 | 성립(낮음·검증 우회) | 화면은 column_mapping을 보내지 않는데 PUT /config가 검증 없이 받아 config에 넣고, 이 값은 에이전트 설정 응답(sync.ts:1375)으로 내려간다. 매핑 전용 경로의 검증을 우회하는 입구. 묶음 ADMIN |
| R276 | admin-sync.ts:362 | 성립(경합·낮음) | 읽은 config 전체를 다시 쓰는 방식 → 그 사이 heartbeat의 명령 큐 갱신·관리자 명령 append가 끼면 되돌린다(heartbeat는 조건부 UPDATE인데 이 경로는 무조건). 처방 = jsonb_set로 두 키만. 묶음 ADMIN |
| R277 | admin-sync.ts:559 | 성립(낮음·운영) | 릴리즈 등록이 exe 존재 확인 없이 활성을 먼저 해제하고 트랜잭션 없이 INSERT → INSERT 실패 시 그 티어에 활성 릴리즈가 없다. 묶음 ADMIN |
| R278 | admin-sync.ts:675 | 성립(죽은 경로·기록) | 화면 호출 없음. 되살리면 ORDER BY started_at DESC가 NULL을 맨 위로(R063 적재분). 묶음 ADMIN |
| R279 | admin.ts:1446 | 성립(낮음·관리자 입력) | toLimit이 0·음수·비숫자를 오류 없이 null(= 제한 없음)로 저장. 처방 = 400. 묶음 ADMIN |
| R280 | admin.ts:2533 | 성립(발신번호 형식) | 화면(AdminDashboard.tsx:4365)이 쓰는 수정 API가 등록 때의 정규화·중복·회선 상한 검사 없이 phone을 그대로 저장. 묶음 ADMIN |
| R281 | admin.ts:2962 | 성립(낮음·성능) | 페이지마다 기간 전체 집계 뒤 JS slice. 묶음 PERF |
| R282 | admin.ts:2971 | 성립(낮음·헛도는 작업) | 슈퍼관리자 발송통계가 회사 지정 시 테스트 통계(MySQL 집계)를 계산하지만 슈퍼관리자 화면은 testSummary를 쓰지 않는다(StatsTab은 고객사 관리 화면). 묶음 PERF |
| R283 | admin.ts:5351 | 성립(낮음·성능) | AI 학습 현황이 쿼리 7개를 순차 await. 묶음 PERF |
| R284 | admin.ts:5914 | 성립(죽은 라우트) | adminId = user?.id(존재하지 않는 키) → reviewed_by 항상 NULL. 같은 라우트군의 수동 등록은 소문자 'approved'라 CHECK 위반(R071). 주석이 frontend 미사용(dead)이라 명시. 처방 = 라우트 폐기. 묶음 ADMIN |
| R285 | agency-send.ts:217 | 성립(낮음·매달림) | Express 4(package.json ^4.18.2)에서 try 밖 requireAgencySend(loadPlanContext)가 던지면 응답 없이 unhandledRejection 로그만 남고 요청이 매달린다. requireAgencySendMw도 같다. 묶음 CRASH |
| R286 | agency-send.ts:227 | 성립(낮음·표시 상한) | 목록 SQL LIMIT 100 고정 · 페이징은 화면에서만. 101번째 이후 접수는 볼 수 없다. 묶음 AGC |
| R287 | agency-send.ts:499 | 성립(낮음·저장소 누적) | 화면 접수 이미지 업로드 파일을 접수 미완료·취소·만료 때 지우는 경로가 없다(삭제는 mms-images.ts 사용자 [X]뿐). 묶음 FILES |
| R288 | ai-memory.ts:214 | 성립(낮음·표시 품질) | 질문 앞 20자 전체가 키·값에 그대로 들어 있어야 가점 → 사실상 중요도 상위 5건. 묶음 AI |
| R289 | ai-usage.ts:335 | 개선 여지(기록) | 사용량·메모리 자연어 질문이 opus + 고객 한도 차감 |
| R290 | ai.ts:180 | 성립(낮음·중복 조회) | router.use(authenticate) 뒤 라우트 7곳이 authenticate를 또 걸어 세션 조회(auth.ts:71~105)가 요청당 두 번. 묶음 PERF |
| R291 | ai.ts:314 | 성립(AI 입력 품질) | '최근 발송 성공 문안' few-shot이 ORDER BY content(가나다순) LIMIT 10 — 최근순이 아니다. 1056행도 같다. 묶음 AI |
| R292 | ai.ts:900 | 개선 여지(기록) | 대상 수·수신거부 수 같은 조건 두 번 스캔 |
| R293 | ai.ts:1707 | 성립(죽은 라우트·기록) | /operator/performance/report-pdf 등 화면 호출 없음(snapshot-v2만 사용). 묶음 DEAD |
| R294 | ai.ts:1809 | 성립(낮음·멈춤 표시) | 풀분석이 setImmediate로만 돌아 재시작 시 job이 running으로 남는다(차감은 성공 뒤라 돈 영향 없음). 처방 = 부팅 시 오래된 running → failed. 묶음 WORKER |
| R295 | ai.ts:3031 | 성립(문구) | 사용자에게 가는 오류 문구에 '영역' 은어 21곳(예: '제안 영역 안 찾을 수 없습니다'). DB 마이그레이션 503 문구는 룰(db_alter_safety_net) 소유라 제외. 묶음 WORDING |
| R296 | ai.ts:3642 | 성립(낮음·표시) | 매장번호 미등록 사전 확인이 대상 앞 1,000명만 본다 → 실패 예정 인원을 적게 말하거나 놓친다. 묶음 JRN |
| R297 | ai.ts:4054 | 중복(R265) | |
| R298 | ai.ts:4146 | 성립(규칙 우회) | 자동 재진입 토글이 상태(draft·paused) 확인도, 사전검사 무효화(last_pretest_passed_at = NULL · 4243행 규칙)도 없이 운영 중 여정의 재진입 구성을 바꾼다. 묶음 JRN |
| R299 | ai.ts:5168 | 성립(낮음·과금 순서) | 전체 재계산을 요청 경로에서 동기로 끝낸 뒤 차감(deductCreditSafe) — 사전 잔액 확인 없음. 묶음 AI |
| R300 | ai.ts:5392 | 성립(타사 합산 노출) | /usage의 cache = getCacheStats() 프로세스 전역값 → 회사 화면에 전 회사 합산 적중 수와 그로 계산한 절감액이 나간다. 묶음 STATS-FAKE |
| R301 | alimtalk.ts:534 | 성립(낮음·정책 불일치) | 프로필 가져오기의 같은 회사·채널 중복 검사는 is_active를 안 보고, 신규 등록(225행)은 활성만 본다 → 사용 중지된 옛 프로필이 있으면 가져오기만 409. 묶음 KAKAO |
| R302 | alimtalk.ts:1299 | 성립(죽은 분기) | templateCode가 로컬 templateKey로 항상 채워져(1293행) 4014 복구 조건(!templateCode)이 절대 참이 아니다 → "IMC 등록 · DB 누락" 복구가 동작하지 않는다(사용자가 키를 직접 지정한 재등록에서만 4014가 난다). 묶음 KAKAO |
| R303 | analysis.ts:960 | 성립(낮음·파일 누적) | 분석 PDF를 pdfs/analysis_<id8>.pdf로 쓰고 보낸 뒤 지우지 않는다. 같은 분석 동시 요청은 한 파일에 겹쳐 쓴다. 묶음 FILES |
| R304 | analysis.ts:1133 | 기록(올드 디자인) | |
| R305 | auto-campaigns.ts:997 | 정책(봉인 기능 정리) | 자동발송은 생성 410 봉인 상태이고 화면(AutoSendFormModal)이 아직 조회·미리보기를 부른다. 라우트 정리 범위는 봉인 정책 결정 사항 |
| R306 | balance.ts:216 | 성립(낮음·알림 남용) | 무통장입금 요청마다 승인 담당자 전원에게 LMS, 중복 방지는 같은 금액·10분뿐 → 금액만 바꿔 반복하면 담당자 문자가 계속 나간다. 묶음 ALERT |
| R307 | billing.ts:2730 | 개선 여지(기록) | 미리보기 SMSQ 집계 중복 |
| R308 | billing.ts:3020 | 기록(죽은 라우트) | 묶음 DEAD |
| R309 | billing.ts:3247 | 성립(낮음·파일 잔존) | 개별 정산서 메일이 검사 전에 PDF를 만들고 발송하지 않는 경로에서 지우지 않는다. 묶음 FILES |
| R310 | cafe24.ts:162 | 성립(낮음·임시 경로 잔존) | 실측용 launch-log가 무인증으로 받은 값을 로그에 남긴다(16kb · 필드 13개 × 200자). 묶음 DEAD |
| R311 | cafe24.ts:459 | 기록(올드 디자인) | |
| R312 | campaigns.ts:513 | 성립(헛도는 작업) | 테스트 발송 실패 기록이 campaign_runs.campaign_id에 testBillId(캠페인이 아닌 값)를 넣어 매번 실패하고 console.error만 남는다. 실패 기록은 한 번도 저장되지 않았다. 묶음 DEAD |
| R313 | campaigns.ts:867 | 기록(디버그 로그) | |
| R314 | campaigns.ts:3362 | 중복(m072) | |
| R315 | campaigns.ts:3444 | 성립(화면 미사용 API·치환 원천) | 080은 캠페인 소유자 기준이라 맞다. 다만 치환 원천이 customers 테이블뿐(3559행)이라 파일·주소록 변수로 보낸 예약을 이 API로 고치면 그 변수가 비거나 고객 DB 값으로 바뀐다. 주석상 화면에서 여는 곳 0. 처방 = 폐기. 묶음 DEAD |
| R316 | campaigns.ts:3950 | 성립(상태 고착) | 브랜드 발송이 캠페인을 'sending'으로 만든 뒤 sendBrandMessage가 던지면 catch(3991행)가 상태를 되돌리지 않아 영구 sending. 묶음 STATE |
| R317 | cdp.ts:371 | 성립(낮음·통계 부풀림) | 공개 키·브랜드 출처로 부르는 변이 클릭·전환 기록에 중복 방지·호출 제한이 없다 → 같은 방문자가 반복 호출하면 밴딧 보상이 그대로 늘어난다. 묶음 ANAL |
| R318 | cdp.ts:587 | 개선 여지(기록) | |
| R319 | cdp-auth.ts:426 | 성립(낮음·한도 오집계) | 월 CDP 한도가 cdp_api_call_log의 call_count를 상태 구분 없이 합산 → 400·500 호출까지 고객사 한도를 먹는다. 묶음 CDP |
| R320 | companies.ts:66 | 기록(올드 디자인) | |
| R321 | companies.ts:125 | 개선 여지(기록) | |
| R322 | companies.ts:735 | 개선 여지(기록) | |
| R323 | content-interview.ts:131 | 성립(낮음·보관 기한 없음) | 인터뷰 세션 테이블에 DELETE 경로가 없다. 묶음 RETAIN |
| R324 | customers.ts:450 | 기록(죽은 라우트) | 묶음 DEAD |
| R325 | customers.ts:1224 | 성립(낮음·부분 삭제) | 개별·전체 삭제가 purchases → consents → customers를 트랜잭션 없이 차례로 지워, 중간 실패 시 고객은 남고 구매·동의 이력만 사라진다. 묶음 TX |
| R326 | dm.ts | 불성립(격리) · 기록(죽은 라우트) | 75개 라우트 중 회사 확인이 없는 3곳은 코드 내장 카탈로그(templates 2곳)와 사설 주소 차단이 있는 URL 추출(dm-brand-extractor.ts:276~328)뿐. 호출처 없는 라우트 정리는 DEAD 기록 |
| R327 | dm.ts:1310 | 성립(과금 순서) | send-to-target이 발행비 차감(1326)·발행(1335)을 080 등록·발신번호·대상 0명 검사(1343~1389)보다 먼저 한다 → 검사에 걸려 발송은 안 되는데 발행과 과금은 된다. 처방 = 싼 검사 먼저. 묶음 DM(돈 경로 · Codex) |
| R328 | dm.ts:1446 | 해소(S1-H08 스테이징 정리 워커) | |
| R329 | dm.ts:1474 | 불성립(현행) | 서버 시간대가 Asia/Seoul(OPS.md:588)이라 지금은 KST로 찍힌다. 환경 의존만 남는다 |
| R330 | email.ts:147 | 기록(올드 디자인) | |
| R331 | event-campaigns.ts:187 | 성립(낮음·보관 기한 없음) | email_events·event_campaign_drafts에 DELETE 경로 없음. 묶음 RETAIN |
| R332 | event-campaigns.ts:256 | 개선 여지(기록) | |
| R333 | imweb.ts:64 | 성립(낮음·보관 기한 없음) | cdp_webhook_deliveries는 oauth_state만 지우고 수신 행은 payload만 30일 뒤 NULL. 묶음 RETAIN |
| R334 | invoice-public.ts:169 | 기록(올드 디자인) | |
| R335 | manage-callbacks.ts:45 | 개선 여지(기록) | |
| R336 | manage-scheduled.ts:31 | 성립(낮음·상한 없음) | limit = Number(query) 또는 50, 상한 없음. 묶음 PERF |
| R337 | mms-images.ts:163 | 성립(낮음·막히는 방향) | req.user.role은 없는 필드(JWT는 userType) → 슈퍼관리자도 다른 회사 이미지를 못 지운다(열리는 방향 아님). 묶음 ADMIN |
| R338 | payments.ts:245 | 성립(낮음·무인증 상태 변경) | 결제창 닫기 콜백이 무인증으로 주문번호만 받아 pending → cancelled. 주문번호는 시각 + 난수 4바이트(inicis-client.ts:61)라 추측 난도가 높다. 묶음 PAY |
| R339 | results.ts:678 | 개선 여지(기록) | |
| R340 | saved-segments.ts:111 | 성립(낮음·스코프) | touchSegment가 id만으로 UPDATE(회사·사용자 조건 없음) — 바뀌는 값은 last_used_at뿐. 묶음 SCOPE |
| R341 | sender-registration.ts:85 | 성립(낮음·개인정보 파일 잔존) | multer가 위임장을 저장한 뒤 이름·전화 누락 400이면 파일을 지우지 않는다. 묶음 FILES |
| R342 | sender-registration.ts:115 | 성립(재승인 우회) | 담당자 수정이 상태 확인 없이 승인된 담당자의 이름·전화를 바꾼다(화면 소비처 없음). 처방 = 라우트 폐기 또는 승인 건 수정 시 재승인. 묶음 SEC |
| R343 | sns.ts:179 | 성립(낮음·보관 기한 없음) | sns_oauth_states는 콜백 성공 때만 지운다. 끝내지 않은 연결의 PKCE verifier 행이 남는다. 묶음 RETAIN |
| R344 | sns.ts:1093 | 기록(올드 디자인) | |
| R345 | sync.ts:533 | 성립(조건부) | heartbeat는 변경이 있을 때만 쓰지만 reported가 오면 변경으로 본다 → 에이전트가 매번 reported를 보내면 매번 config 전체를 다시 쓴다. 묶음 WORKER |
| R346 | sync.ts:1087 | 성립(데이터) | 싱크 구매의 quantity·unit_price·total_amount가 falsy 폴백(or null)이라 0이 NULL로 바뀐다. 묶음 CDP |
| R347 | unsubscribes.ts:609 | 성립(낮음·미리보기 불일치) | 발송 전 수신거부 수가 숫자만 남긴 번호(+82 형식 미변환)와 user_id 축으로 센다 → 실제 제외 수와 어긋날 수 있다. 묶음 GATE |
| R348 | upload.ts:187 | 개선 여지(기록) | |
| R349 | upload.ts:265 | 개선 여지(기록) | |
| R350 | upload.ts:962 | 성립(헛도는 작업) | 업로드마다 회사 전체 4회 스캔으로 customer_schema를 genders·grades·custom_field_keys·store_codes로 통째로 덮어쓰는데 이 키를 읽는 곳이 없다(변수 목록은 field_mappings·available_vars를 읽음). 묶음 PERF |
| R351 | woocommerce.ts:108 | 중복(R333) | |
| R352 | woocommerce.ts:254 | 기록(올드 디자인) | |
| R353 | account-action.ts:89 | 성립(낮음·감사 기록) | 관리자 경로(admin.ts:249)는 상태를 먼저 바꾼 뒤 restrictAccount를 불러 account_restricted 기록의 before가 조치 뒤 값이다(같은 요청의 user_update 기록은 정확). 묶음 ADMIN |
| R354 | agency-send-mail-worker.ts:989 | 성립(낮음·파일 잔존) | 묶음 FILES |
| R355 | agency-send-worker.ts:501 | 성립(낮음·헛도는 발송) | 스팸 통과 뒤 발송 예정 시각이 이미 지났는지 보지 않고 담당자 테스트 문자를 먼저 보낸다(기한 판정은 1117행 뒤 단계). 묶음 AGC |
| R356 | agency-send-worker.ts:1312 | 개선 여지(기록) | |
| R357 | agent-protocol.ts:76 | 성립(낮음·크기) | 명령 결과를 config jsonb에 크게 두고 heartbeat 갱신 때 통째로 다시 쓴다. R345와 같은 뿌리. 묶음 WORKER |
| R358 | ai-mapping.ts:130 | 성립(낮음·경합) | 쿼터 확인과 증가 사이 잠금이 없다. 묶음 AI |
| R359 | ai-rate-limit.ts:157 | 개선 여지(기록) | |
| R360 | alimtalk-ai-matcher.ts:327 | 성립(낮음·추천 품질) | AI 실패 폴백이 캠페인 유형이 없으면 전 키워드를 쓰고, 목표에 없는 키워드라도 템플릿에 있으면 +5 → '확인'·'결제'·'쿠폰'이 든 무관한 템플릿이 점수를 얻는다. 묶음 KAKAO |
| R361 | alimtalk-jobs.ts:700 | 성립(조건부) | 발신프로필 상태 동기화가 ORDER BY 없이 LIMIT 200 → 프로필이 200개를 넘으면 뒤쪽이 계속 갱신되지 않을 수 있다. 묶음 KAKAO |
| R362 | alimtalk-webhook-handler.ts:180 | 성립(낮음·보관 기한 없음) | 묶음 RETAIN |
| R363 | auto-campaign-worker.ts:921 | 정책(봉인 경로) | 자동발송 봉인 상태. 해제 시 선불 환불 결함으로 함께 본다(R305와 같은 결정) |
| R364 | auto-campaign-worker.ts:1487 | 정책(봉인 경로) | R305와 같은 결정 |
| R365 | bandit-optimizer.ts:296 | 성립(분석 왜곡) | 누적 추천(continuous-operator.ts:1866 사용)이 운영자 전체 변이(현재 제안 포함)를 합친 뒤 현재 제안 변이에 또 더해 이번 제안 성과가 두 번 들어간다. 묶음 OPS |
| R366 | batch-ai.ts:79 | 기록(죽은 코드) | 묶음 DEAD |
| R367 | best-copy-assets.ts:141 | 성립(데이터 소실) | 예시 교체가 트랜잭션 없는 DELETE → INSERT이고, 호출부(industry-formula.ts:95~108)는 AI JSON이 깨져 예시가 0건이어도 그대로 교체 → 기존 예시가 전부 사라진다. 묶음 AI |
| R368 | billing-issue.ts:107 | 성립(표시) | pg가 date(1082)를 JS Date로 파싱(database.ts는 1114만 설정) → String(Date).slice(0,10) = 'Wed Jul 01'. 정산 기간 충돌 안내에 연도 없는 영문이 나간다. 묶음 BILL |
| R369 | billing-pdf.ts:227 | 성립(낮음·파일 누적) | 묶음 FILES |
| R370 | billing-pdf.ts:658 | 기록(죽은 코드) | 묶음 DEAD |
| R371 | billing-recipients.ts:78 | 성립(낮음·오판) | 거부 판정이 includes(부분 문자열) → 참조 주소가 대표 주소를 포함하면(예: ba@x.com ⊃ a@x.com) 대표 수신자 거부로 오판. 처방 = 주소 추출 뒤 완전 일치. 묶음 MAIL |
| R372 | cafe24-client.ts:518 | 성립(낮음) | 구형 웹훅 HMAC을 === 로 비교(비상수 시간). 처방 = timingSafeEqual. 묶음 SEC |
| R373 | callback-filter.ts:155 | 개선 여지(기록) | |
| R374 | campaign-quick.ts:903 | 성립(낮음·메모리 누적) | buildVisionCache는 같은 키 재조회 때만 만료를 지운다(446행) → 프로세스 수명 동안 커진다. 묶음 PERF |
| R375 | campaign-sms-export.ts:97 | 개선 여지(기록) | |
| R376 | campaign-sync-worker.ts:430 | 개선 여지(기록) | |
| R377 | cancelled-queue-sweeper.ts:26 | 개선 여지(기록) | |
| R378 | cdp-auth.ts:218 | 개선 여지(기록) | |
| R379 | cdp-auth.ts:426 | 중복(R319) | |
| R380 | cdp-events.ts:224 | 개선 여지(기록) | |
| R381 | cdp-events.ts:488 | 개선 여지(기록) | |
| R382 | cdp-profile-recompute-worker.ts:24 | 성립(조건부·누락) | 증분 대상이 '최근 6분 이벤트' LIMIT 2000 → 한 주기에 2천 명을 넘으면 남은 고객은 다음 주기 창에서 빠진다(주석의 '다음 주기에 이어서'가 안 됨). 묶음 CDP |
| R383 | company-data-profile.ts:212 | 개선 여지(기록) | |
| R384 | connected-content.ts:262 | 기록(미완 기능) | 재고·가격·신상품 연결 콘텐츠가 빈 껍데기 |
| R385 | continuous-operator.ts:986 | 성립(낮음·보관 기한 없음) | 묶음 RETAIN |
| R386 | copy-label-sweeper.ts:36 | 개선 여지(기록) | |
| R387 | crm-agency-pdf-render.ts:36 | 기록(올드 디자인) | |
| R388 | crm-agency-proposal.ts:114 | 개선 여지(기록) | |
| R389 | customer-timeline.ts:1003 | 개선 여지(기록) | |
| R390 | daily-insight-mailer.ts:109 | 기록(올드 디자인) | |
| R391 | daily-insight-mailer.ts:219 | 성립(메일 수신 거부 안내 오류) | 대상이 (회사, 사용자) 단위라 같은 회사에서 둘이 켜면 같은 날 중복 발송. 본문 '대시보드 → 설정 → 알림 메뉴'(146행)는 존재하지 않고 끄는 곳은 온보딩 마법사(Step7Roi)뿐. sent_date = CURRENT_DATE도 UTC. 묶음 MAIL-LAW |
| R392 | dashboard-card-pool.ts:35 | 기록(올드 디자인) | |
| R393 | design-core/brand-profile.ts:36 | 개선 여지(기록) | |
| R394 | design-core/template-registry.ts:105 | 기록(디자인 게이트) | |
| R395 | dm/dm-builder.ts:295 | 개선 여지(기록) | 버전 행 섹션 3중 저장 |
| R396 | dm/dm-sample-customer.ts:56 | 개선 여지(기록) | |
| R397 | dm/dm-viewer.ts:40 | 기록(올드 디자인) | |
| R398 | dm/dm-viewer.ts:742 | 기록(올드 디자인) | |
| R399 | dm/dm-viewer.ts:817 | 성립(낮음·표시) | 복수 선택 해제가 인라인 background·borderColor를 ''로 지워 원래 카드 배경·테두리까지 사라진다. 처방 = 선택 전 값 보관 후 복원. 묶음 DM |
| R400 | dm/dm-viewer.ts:1113 | 기록(올드 디자인) | |
| R401 | email-channel.ts:217 | 개선 여지(기록) | |
| R402 | email-channel.ts:217 | 중복(R401) | |
| R403 | email-channel.ts:321 | 기록(올드 디자인) | |
| R404 | email-channel.ts:476 | 성립(치환 누락·조건부) | 섹션 없는 직접 작성 HTML은 substitutions와 {{이름}}만 치환하고, 남은 {{ customer.X }}는 497행에서 지운다 → 고객 데이터가 있어도 문장이 끊긴 채 나간다(섹션 경로는 recipient.customer로 렌더). 처방 = 직접 HTML도 renderEmailText(cust)로 치환 뒤 잔여만 제거. 묶음 MAIL |
| R405 | email/email-tokens.ts:322 | 기록(올드 디자인) | |
| R406 | expired-pending-sweeper.ts:20 | 개선 여지(기록) | |
| R407 | full-analysis-collect.ts:39 | 개선 여지(기록) | |
| R408 | full-analysis-runner.ts:84 | 중복(R236) | |
| R409 | gateway-template-mapping.ts:419 | 개선 여지(기록) | |
| R410 | geo-access.ts:297 | 개선 여지(기록) | |
| R411 | help-answer.ts:224 | 성립(낮음·일 한도 기준) | 도움말 일 한도가 toISOString().slice(0,10)(UTC 날짜) → KST 09시에 초기화. 묶음 TZ |
| R412 | image-serve.ts:139 | 성립(낮음·파일 잔존) | 묶음 FILES |
| R413 | image-studio.ts:44 | 개선 여지(기록) | |
| R414 | inapp-ai-generator.ts:207 | 기록(올드 디자인) | |
| R415 | inapp-explainer.ts:177 | 성립(낮음·분석) | 메시지 CTR은 전 기간(135행), 회사 평균은 최근 30일(152행) → 기간이 다른 값을 비교해 진단한다. 묶음 INAPP |
| R416 | inapp-funnel-stats.ts:276 | 개선 여지(기록) | |
| R417 | inapp-funnel-stats.ts:547 | 성립(표시) | identifiedTotal = LIMIT 500으로 자른 행 수 → 500명 이상이면 500명으로 표시. 묶음 INAPP |
| R418 | inapp-segment-matcher.ts:287 | 불성립 | 빈 세그먼트 판정(285행)과 SQL 생성(58~78행 typeof number) 모두 0을 조건으로 본다 · 기준이 같다 |
| R419 | inapp-trigger-engine.ts:221 | 개선 여지(기록) | |
| R420 | integration-scope.ts:103 | 개선 여지(기록) | |
| R421 | invoice-confirm.ts:332 | 기록(올드 디자인) | |
| R422 | invoice-confirm.ts:363 | 성립(낮음·파일 누적) | 묶음 FILES |
| R423 | journey-step-campaign.ts:127 | 개선 여지(기록) | |
| R424 | journey-step-diagnosis.ts:131 | 성립(AI 입력·표시) | 진단 여정 조회(268행)가 objective를 SELECT하지 않아 프롬프트 목표가 항상 '재구매 유도'. 완주율은 홀드아웃을 분모에 넣어 통계 화면(journey-stats.ts:192 · 홀드아웃 제외)과 다르다. 묶음 JRN |
| R425 | journey-target-extractor.ts:336 | 성립(낮음) | 생일 비교가 MM-DD 일치뿐이라 02-29생은 평년에 진입하지 못한다. CURRENT_DATE도 UTC. 묶음 JRN |
| R426 | journey-trigger-watcher.ts:357 | 개선 여지(기록) | |
| R427 | kakao-template-sync.ts:51 | 성립(조건부) | IMC 목록 순회가 100쪽(1만 건)에서 조용히 끊긴다 → 그 뒤 템플릿은 코드·상태 동기화가 안 된다. 처방 = 상한 도달 시 경보. 묶음 KAKAO |
| R428 | liquid-templating.ts:461 | 성립(낮음·의미 차이) | evaluate가 호출마다 scope 사본을 만들어 if·for·case 안 assign이 블록 밖으로 전달되지 않는다. 묶음 JRN |
| R429 | makeshop-client.ts:243 | 개선 여지(기록) | |
| R430 | AddressBookModal.tsx:646 | 기록(올드 디자인) | |
| R431 | BrandVoiceCard.tsx:333 | 기록(올드 디자인·NEW 배지 잔존) | |
| R432 | AdminDashboard.tsx:2838 | 개선 여지(기록) | |
| R433 | AiUsagePage.tsx:474 | 기록(올드 디자인·원시 DB 이름 노출) | |
| R434 | DmBuilderPage.tsx:691 | 기록(올드 디자인) | |
