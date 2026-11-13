# C132 접수 넷 = 이메일 대행 문안 그대로 · 발신번호 사용 범위 · 발송ID 브랜드 비친구 단가 · 비토 통계 성공 판정 — 설계서

> 1113 Harold 「전부 제대로 진행하도록 하자」(판정 · 설계 방향 보고 뒤). 원칙 = 디버깅 접수는 결함 / 실측 차이 / 개선 판정 먼저 · 결함은 뿌리 + 같은 문제 자리 전수(memory `feedback_staff_report_triage_then_root`).
> 저장소 둘 = 한줄로(targetup) · 비토엔진(bito-gateway · 규칙 = 그 저장소 CODEX.md).

## §0 판정

| # | 접수 | 판정 | 근거(실측 · 코드) |
|---|---|---|---|
| ① | 서수란 cmwbrl9s4190wjnscz0v8uyh8 · 에이전트 통계 콜비서 전부 성공 | **결함** | .65 실측(1113): V0011(agent 경로) DONE + 실패 코드 = 11-10 LMS 1 · 11-11 SMS 275 → 통계 성공. 11월 누적 = 실패 471 · 코드 없음 88(V0003 코드 없음 2) · 10월 0. 원인 = PAY 통계 적재기(`bito-gateway/internal/gateway/paystats/reporter.go` collectQuery)가 `norm_status IN ('DELIVERED','DONE')` 를 성공으로 셈 · agent 경로의 DONE = 「Agent 에 결과 전달 완료」(model/message.go) = 성공 · 실패 무관. 콘솔 · 관리 API 는 결과 코드로 판정(`web/api/services/result-code.js` finalSuccessSql). API 경로(랩디 V0001)는 실패 = FAILED 라 정상. |
| ② | 서수란 cmwd74m3u1d94jnsc397ty8bx · 발신번호 관리에 사용 범위 | 개선(데이터 있음) | `callback_numbers.assignment_scope`(all · assigned) + `callback_number_assignments` · 슈퍼관리자 목록(`routes/admin.ts` GET /callback-numbers)만 안 보임 |
| ③ | 서수란 cmwbrqgnd19eojnscjynhf3fo · 발송ID 브랜드 친구 · 비친구 단가 | 개선 | 웹 = BRAND · BRAND_NF 둘(`billing-types.ts`) · 발송ID = `cost_per_brand` 하나 · 비토 적재기 = 브랜드 전부 `G`(payMsgType) · 비토에 친구 판정 함수 `brand_targeting_is_friend` 있음(dispatch_batcher 매입 단가) |
| ④ | 서 팀장(C130 접수 cmwd36hnr1corjnscq7xlnim1) · 이메일 대행 자동 (광고) · 080 제거 | 개선(요청 원문 그대로) | 1113 Harold 「책임도 지들이 지는 거야」 · 「해 달라 하는 대로 수정해라」 |

랩디 질문(①-1) 답 = 코드 기준 직원 이해가 맞다: 대체발송이 만들어진 알림톡 원본은 알림톡 줄에서 빠지고(reporter `fallback_request_id IS NULL`) 「LMS(대체발송)」(KS · KL) 줄에 따로 잡힌다 · 대체 없이 실패한 알림톡은 알림톡 줄 실패.

## §1 미가입 · 직접발송 변화 0 (맨 앞 기준)

| 바뀌는 것 | 미가입 · 직접발송이 지나는가 | 증명(계약 시험) |
|---|---|---|
| ④ 광고 표기 판정 | 직접발송 · 캠페인 · DM · 플래너는 `send_config.adText` 를 쓰지 않는다(키 없음 = 종전 = adEnabled) · 대행 이메일 접수만 `adText: false` 를 싣는다 | T4-5 = 대행 밖 호출부는 새 칸을 넘기지 않는다(구문 트리) · T4-6 = 키 없는 send_config 의 조립 결과 = 종전 글자 그대로 |
| ② 슈퍼관리자 목록 칸 | 읽기 화면만 · 발송 판정(callback-filter) 글 무변경(같은 조각을 공유만) | T2-1 |
| ③ 발송ID 단가 · 비토 GN | 웹 단가 · 회사 청구 경로 무변경 · 발송ID 행만 | T3-1 · T3-3 |
| ① 비토 적재기 | 한줄로 코드 0 · 비토 발송 · 과금 경로 무변경(적재기 SELECT 만) | T1-1 |

## §2 ④ 이메일 대행 = 고객 문안 그대로

**정책은 접수 때 행에 고정한다**(Codex 설계 1R #2): DDL C132-DDL-2 `agency_send_requests.ad_text boolean NULL` · 접수 코어가 넣는 값 = `source !== 'email'`(이메일 = false · 화면 · 원스텝 = true) · 옛 행 = NULL = 종전(표기). 판정 CT 하나 = `agencyAdTextApplies({ isAd, adText })` = `!!isAd && adText !== false`(agency-send-optout.ts). 접수 전 분석(analyzeOneStep · 원스텝 미리보기)은 행이 없어 입구가 같은 규칙으로 값을 넘긴다(메일 = false). 그래서 배포 전에 들어온 이메일 접수(NULL)는 승인 · 미리보기 · 테스트 · 발송이 모두 종전 표기 그대로이고, 배포 뒤 이메일 접수는 처음부터 끝까지 표기 없음 = 승인한 글과 나가는 글이 언제나 같다.

### 흐름 표 — 대행 글에 (광고) · 080 이 붙는 자리 전수(기계 추출 = 대행 파일의 prepareSendMessage · buildAdMessage · isAd 인자)

| 자리 | 파일:줄 | 지금 | 처방 |
|---|---|---|---|
| D1 분석 바이트(메일 · 화면 원스텝) | agency-send-intake analyzeOneStep → measureAgencyMaxSmsBytes(isAd) | form.isAd | 부르는 쪽 source 를 받아 CT 값(메일 = 'email') |
| D2 접수 코어 바이트 | createRequestCore → measureAgencyMaxSmsBytes | isAd | CT(isAd, source) |
| D3 표본 · 담당자 테스트 문자 · 미리보기 | agency-send-preview loadRenderCtx · renderOne | row.is_ad | CT(row) · 080 도 CT 일 때만 |
| D4 스팸 검사(대행 표본) | agency-send-worker runSpamRound → autoSpamTestWithRegenerate(isAd · rejectNumber) | row.is_ad | CT(row) · rejectNumber 도 |
| D5 발송 캠페인 만들기 | agency-send-worker dispatch → createDirectSendCampaign spec | adEnabled | adEnabled 그대로 + `adTextApplies: CT(row)` |
| D6 발송 전 스팸 차단 글 | direct-send-core composeSpamCheckText(isAd) · 대체 문구 | spec.adEnabled | `adEnabled && adTextApplies !== false` |
| D7 발송 조립 | direct-send-worker(747 finalIsAd · opt080) → processor 151 prepareSendMessage · 197 브랜드 대체 | cfg.adEnabled | 표기 = `cfg.adEnabled && cfg.adText !== false` · 080 도 그때만 |
| D8 예약 캠페인 문안 고치기 | routes/campaigns.ts PUT /:id/message(4176) | campaign.is_ad | 같은 식(send_config 를 SELECT) |
| D9 C130 겹침 안내 9자리 | intake 608 · change 196 · routes 342 · 586 · admin 6751 · mail-worker 재시도 · worker 876 · 1036 · 1372 · 2319 | isAd | CT 값(이메일 = 안내 0 · 겹칠 일 없음) |

저장 = `send_config.adText` 는 **false 일 때만** 싣는다(대행 이메일). 다른 모든 캠페인의 send_config 는 글자 하나 안 바뀐다.

### 그대로 두는 것(광고 여부의 다른 쓰임 · Harold 1113 추천 수용)

| 자리 | 이유 |
|---|---|
| K1 광고 야간 발송 창(loadSendWindow · core nightAdRestriction) | 표기만 빼는 요청 · 시간 규칙은 별개 |
| K2 080 수신거부 명단 제외(countStagingFiltered · unsubFilterEnabled) | 받는 사람 권리 |
| K3 광고 관문(C110 · adGateBatchId) · K4 피로도 집계(processor 362) | 광고 빈도 규칙 |
| K5 campaigns.is_ad · 학습 기록 isAd | 광고 발송 사실 그대로 |
| K6 브랜드 페이로드 isAd(processor 210) | 카카오 측 광고 표식(글 꼬리 아님) · 대행은 문자만 |

### 값 범위 · 경계

- 배포 전 접수(ad_text NULL) = 처음부터 끝까지 종전 표기(Codex 설계 1R #2 · 전환 시점 어긋남 0) · 배포 뒤 이메일 접수 = 처음부터 끝까지 표기 없음.
- 칸이 없는 판(DDL 전) = 넣기에서 그 칸을 빼고(기존 extraCols 갈래 · hasAgencyColumn) 읽기는 NULL = 종전 → DDL 은 배포 앞(원장 C132-DDL-2).

## §3 ② 발신번호 사용 범위 칸

| 자리 | 처방 |
|---|---|
| 판정 조각(공유) | callback-filter.ts 의 「전체」 조건 `cn.assignment_scope = 'all' OR cn.assignment_scope IS NULL` 을 상수 하나로(발송 판정 · 화면이 같은 글) |
| 슈퍼관리자 GET /api/admin/callback-numbers | 행마다 `usage_scope`(all · assigned) · `assignees`(이름 · 아이디 · 최대 전원) · `via_sender_ledger`(같은 회사 sender_numbers 활성에 같은 번호 = 사용 범위 무관 전원 · callback-filter 158 과 같은 규칙) · 한 SQL(LATERAL · N+1 0) |
| CallbacksTab.tsx | 대표 ↔ 등록일 사이 「사용 범위」 칸 = 「전체」 · 「지정 N명」(누르면 사용자 목록 창 · 관리자는 항상 사용 가능 안내) · 원장 번호 = 「전체(발신번호 원장)」 |

기록만 = 규격 이전에 등록된 위반 표기 번호도 발송에서 빠진다(callback-filter 186 checkCallbackSpec) — 이번 범위 밖.

## §4 ③ 발송ID 브랜드 친구 · 비친구 단가

| 자리 | 처방 |
|---|---|
| DDL C132-DDL-1(배포 앞) | `company_agent_ids ADD COLUMN cost_per_brand_nonfriend numeric NULL` |
| billing-types BRAND_NF | `agentPriceColumn: 'cost_per_brand_nonfriend'` · `agentCode: 'GN'` → SELECT · 지문 · 미설정 가드가 표에서 자동 확장 |
| priceBillingRows(발송ID 행) | BRAND · BRAND_NF 는 `pickBrandPriceRaw(발송ID 행, targeting)` = 비친구 칸이 비면 친구 단가(웹과 같은 순서표) |
| 발송ID 단가 저장 · 화면(admin.ts · CompanyBasicTab) | 「브랜드(친구)」 · 「브랜드(비친구)」 두 칸 · 비친구 비우면 친구 단가 안내 |
| pay-stats 라벨 | 'GN' = 브랜드메시지(비친구)(표에서 파생) |
| 비토 reporter | collectQuery 에 브랜드일 때만 `brand_targeting_is_friend(mr.kakao_payload)` · payMsgType = 친구 G · 비친구 GN |

⛔ 키 이동 안전(reporter 주석 = UPSERT 는 빠진 키를 안 지운다 → 옛 G 행이 남아 두 번 청구): 브랜드 묶음은 **G · GN 두 키를 늘 함께** 내고(없는 쪽 = 0,0,0) **한 문장(2행 INSERT … ON DUPLICATE KEY UPDATE)으로 함께 쓴다**(Codex 설계 1R #1 · 행마다 따로 쓰면 G 만 실패할 때 옛 G + 새 GN = 두 번 청구). 둘 중 하나라도 바뀌면 둘 다 쓰고 · 실패는 둘 다 실패로 기억에서 지운다(다음 주기 재시도). 배포 순서 = 한줄로(GN 을 아는 판) 먼저 → 비토.

## §5 ① 비토 통계 성공 판정

| 자리 | 처방 |
|---|---|
| reporter collectQuery 카운터 셋 | 콘솔 판정과 같은 식: ok = (DONE 또는 정착한 REPORTED) AND 결과 코드 성공 · fail = FAILED · SEND_FAILED 또는 (DONE · 정착 REPORTED AND 결과 코드 실패) · ready = 나머지(진행 중 · 코드 없음) · 대체발송 원본 0 은 그대로 |
| 성공 코드 목록 | Go `internal/common/resultcode` 가 소유 · reporter SQL 은 그 목록에서 만든다(손 복사 0) |
| 정착 REPORTED | result-code.js settledReportedSql 과 같은 조건(재전달 상한 = grpc_server 의 reportReplayMaxRetries · reportReplayGiveUpAge 상수 공유) |
| 11월 바로잡기 | 배포 때 `GW_PAY_STATS_LOOKBACK_DAYS` 를 11-01 까지 덮는 값으로 한 번 → **원복 조건 = 게이트웨이 로그 「PAY 통계 적재 완료」 한 줄이 full=true · since=2026-11-01 · failed=0**(복구 기간 전 행을 한 주기에 다 썼다는 증거 · Codex 설계 1R #1) → 원래 값(3) |

같은 뿌리 전수(DONE 을 세는 22자리) = 성공으로 세는 곳은 reporter 하나 · 콘솔 pipeline.js 233 · server.js 764 는 상태 칸 「완료」 표시(구현 때 화면 문구 확인 · 성공으로 쓰면 같은 처방).

## §6 계약 시험

| 번호 | 시험 |
|---|---|
| T4-1 | CT 값 범위(isAd × adText true · false · NULL) · 접수 코어가 넣는 값(source 4종 → ad_text) |
| T4-2 | 대행 자리 D1 ~ D9 전부 CT 를 지난다(구문 트리 · prepareSendMessage · buildAdMessage · measureAgencyMaxSmsBytes · autoSpamTestWithRegenerate · agencyOptOut* 의 isAd 인자 = CT 결과) |
| T4-3 | 동작: email 행 renderOne = 문안 그대로 · screen 행 = 종전(스냅숏) |
| T4-4 | 동작: send_config adText false → 조립 글 표기 0 · 키 없음 → 종전 글자 그대로 |
| T4-5 | 대행 밖 createDirectSendCampaign 호출부는 adTextApplies 를 넘기지 않는다 |
| T2-1 | 화면 칸 판정 조각 = 발송 판정 조각(같은 상수) · 실 PG = 전체 · 지정 · 원장 번호 세 갈래 |
| T3-1 | BRAND_NF 발송ID 단가 = 비친구 칸 → 비면 친구 칸 · 둘 다 비면 미설정 막음 |
| T3-2 | 실 PG = C132-DDL-1 얹은 사본에서 청구 SELECT |
| T3-3(Go) | payMsgType 브랜드 친구 · 비친구 · 브랜드 묶음은 G · GN 둘 다 산출 · 쌍 쓰기 = 한 문장(가짜 실행기로 문장 수 · 실패 주입 = 쌍 둘 다 실패로 기억 지움 · 한쪽만 바뀌어도 둘 다 씀) |
| T1-1(Go) | reporter 카운터 = 콘솔 판정 표(DONE 성공 코드 · DONE 실패 코드 · DONE 코드 없음 · REPORTED 정착 · FAILED · SEND_FAILED · DELIVERED · 대체 원본) · 성공 코드 = resultcode 목록 |

## §7 직원 지시문 초안(배포 뒤 · 테스트계정 · 도달 불가 번호)

1. 이메일로 광고 문안(「(광고)」 없이 · 끝에 「수신거부 080-…」) 요청서를 보낸다 → 담당자 테스트 문자 · 상세 문안에 (광고) · 무료수신거부가 **붙지 않는다** · 수신거부 줄 안내 상자 없음.
2. 같은 문안을 화면 원스텝으로 접수 → 종전대로 (광고) · 무료수신거부가 붙고 안내 상자가 보인다.
3. 슈퍼관리자 → 발신번호 관리 → 「사용 범위」 칸이 전체 · 지정 N명으로 보이고 지정을 누르면 사용자 목록.
4. 슈퍼관리자 → 고객사 상세 → 발송ID 단가에 브랜드(친구) · 브랜드(비친구) 두 칸.
5. 콜비서 11월 에이전트 통계 = 비토 콘솔과 같은 성공 · 실패(다시 적재 뒤).

## §8 배포 순서

1. P1(읽기) = 칸 존재(1113 확인 끝) · 발송ID 브랜드 사용 실적(.65).
2. 한줄로 = C132-DDL-1 · C132-DDL-2(배포 앞) → 커밋 · push → pull · build:safe 둘 · 적재 0 일 때 재시작.
3. 비토 = C131 과 한 번에(게이트웨이 바이너리) · 런북 scripts/gw · 뒤에 LOOKBACK 일시 확대 → 확인 → 원복.

## §8-1 구현 중 정한 것(1113)

- ⛔ 화면 접수 입구(`POST /api/agency-send`)가 요청 본문의 source 를 그대로 코어에 넘기고 있었다 — 경로가 표기 정책을 정하게 된 뒤로는 화면이 'email' 을 보내 (광고) 를 끌 수 있다 → 입구가 source = 'screen' 으로 고정(시험 T4-2).
- 조립기 판정 = `adTextOn(finalIsAd, adText)`(광고이고 끔 표식이 아닐 때만) — `adText ?? finalIsAd` 로 쓰면 광고 아닌 캠페인에 true 가 오면 (광고) 를 붙인다(동작 시험이 잡음).
- 원스텝 미리보기의 겹침 안내도 CT 를 지난다(one_step = 표기 있음 · agencyAdTextForSource).
- 재는 값 · 넣는 값 · 안내 = `agencyAdTextValue(연결, source)` 한 곳(칸이 없으면 null = 종전) · 바깥 트랜잭션 입구는 그 연결로(풀을 다시 기다리지 않게).
- 메일 재시도 회신의 안내 = 행의 ad_text 를 읽는다(칸이 있을 때만 SELECT 에 · DDL 전 재시도 패스 멈춤 0).
- ② 사용 범위 판정(Codex 구현 1R) = SQL 추정(숫자만 비교)을 지우고 발송 판정과 같은 부품으로: `registeredDigits`(규격 통과 원문 → 숫자 · 발송 판정 getRegisteredCallbackSet 도 이 함수) · `callbackScopeIsAll` · `describeCallbackUsage`(원장 · 전체 · 지정 · **발송 불가(규격)**). 규격 위반 원장 행은 근거가 아니고 · 번호 자체가 규격 위반이면 「발송 불가」(관리자 포함 아무도 못 씀 = 화면이 거짓을 말하지 않게). 실 PG 시험 = 사용자마다 「칸이 쓸 수 있다고 한 번호」 = 발송 판정 집합 대조.
- ② 옛 스키마(칸 · 배정 표 없음 · Codex 구현 2R) = 범위 없는 SELECT 로 한 번 더(= 발송 판정의 칸 없음 갈래와 같은 답 「전체」) · 그래도 없으면 503 DB_MIGRATION_PENDING.

## §9 기록만

- 발신번호 규격 위반 표기 번호 = 등록돼 있어도 발송 불가(②와 별개 원인).
- reporter 의 DELIVERED 성공 처리로 결과가 끝내 안 온 건이 과거에 성공 청구됐을 수 있음 = 실측 2 의 ok_no_code(11월 V0011 88 · V0003 2)가 그 몫 · 다시 적재로 대기로 바뀐다.
