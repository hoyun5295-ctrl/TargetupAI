# 2026-06-15 발송/싱크/알림톡 5건 버그 일괄 수정 — 다음 세션 핸드오프

> 이번 세션 컨텍스트 과다로 **수정은 다음 세션에서 일괄 진행**. 본 문서가 진입점(SoT).
> 원칙: 하나씩(no_parallel), 버그별 grep → 원인 확정 → Harold 컨펌 → 수정. 발송·돈 닿는 건은 dev_process 6원칙(쓰기 경로까지 전수 grep + 효과 검증 + 실측 1건). 추측 SQL 금지, information_schema 검증.
> 접수자: 직원(서수란 등) 버그 리포트 + 캡처. 캡처 원본은 Harold 다운로드 폴더.

---

## 버그 1 — 발송일시 "상세"가 리포트 수신시간으로 출력 (재발, P1)

**현상**: 발송결과/캠페인 **목록**의 발송일시는 정상(예: 06.11 19:46)인데, **상세(행 단위)** 발송일시가 결과 늦게 온 건만 다음날(리포트 수신시간)로 찍힘. 결과대기 건은 빈칸.
**근거(캡처)**: 톤28(toun28) 6/11 19:46 발송 7,520건 — 상세 7·8행 발송일시 `06.12 10:32/10:43`, 6행(결과대기) 빈칸. 시세이도1/3도 일부 행만 `06.12`. 목록은 `06.11 19:46`.
**적용 범위**: 슈퍼관리자>캠페인관리 상세 + 사용자>발송결과 상세 둘 다.
**의심 원인**: 상세 행 발송일시가 SMSQ_SEND의 `mobsend_time`/`repmsg_recvtm`(통신사 리포트 시간, OPS상 UTC 저장)을 표시. 목록/통계는 D233+에서 `COALESCE(scheduled_at, sent_at)`로 통일했으나 **상세 행 단위엔 그 통일이 안 닿음**.
**체크할 곳**: `routes/results.ts`(발송결과 상세 행별 발송일시 컬럼 SELECT), `routes/admin.ts` `GET /campaigns/:id/sms-detail`, `utils/sms-result-map.ts getQueueRowStatus`. 상세가 어느 컬럼(sendreq_time/mobsend_time/repmsg_recvtm)을 "발송일시"로 출력하는지 확정.
**수정 방향(가설)**: 상세 행 발송일시 = `sendreq_time`(발송요청=예약/즉시 일관) 또는 목록과 동일 기준으로. 결과대기도 빈칸 대신 sendreq_time. 3표면(목록·상세·엑셀) 동일 산출.

---

## 버그 2 — 싱크에이전트: 기존 고객 변경분 미반영 (재오픈/재발, P1)

**현상**: 고객 DB의 **기존 row 변경**(수신동의 거부→동의)이 동기화해도 한줄로에 반영 안 됨. 신규 INSERT는 됨.
**근거(캡처)**: 고객 MSSQL `UPDATE SyncTest SET Agreed='동의' WHERE Name='인비토02'`(1행, 06-12 14:04) → 고객DB 동의 ✓. 싱크 로그 `updated_at 컬럼 없음 → 전체 동기화 대체`(v1.5.5 fallback 정상), `전체 정규화 total:1504 success:1503 fail:1`. 그런데 한줄로 인비토02 = `false(거부)` 유지.
**부가**: fail 1건 = 전화번호 `18008125000`(1800 대표번호) 정규화 실패(별개). `sync_failed 74회 연속`은 그 1건 누적 알림(별개).
**의심 원인**: 한줄로 서버 upsert(ON CONFLICT)의 **UPDATE 절에서 수신동의(sms_opt_in) 필드 제외**(신규만 set, 기존 보존) 또는 `'동의'/'거부' → sms_opt_in(boolean)` 매핑 누락.
**체크할 곳**: `utils/customer-upsert.ts`(buildBatch의 ON CONFLICT DO UPDATE SET 절 — 어느 컬럼이 갱신 대상인지), `utils/standard-field-map.ts`(수신동의 매핑), `utils/normalize.ts`(동의/거부→boolean), `routes/sync.ts`. ★ sms_opt_in이 UPDATE 절에 있는지 / 신규 기본 false 정책과 충돌하는지.
**수정 방향(가설)**: UPDATE 절에 수신동의 포함. 단 "신규 기본 false"(CDP 정책)와 "고객DB 변경 반영"의 균형 — 싱크 소스값이 권위면 덮어쓰기. [[feedback_db_column_verify_before_code]] 정합으로 sms_opt_in 컬럼 실재 확인.

---

## 버그 3 — 통계: 대상건수 = 성공+실패 ≠ 전송건수 (재발, P1 돈/정산)

**현상**: 성공+실패 합이 전송건수보다 많음(= 대상건수와 같음). 대상 > 전송인 업체(무효번호·수신거부 등 제외 발생)에서만 드러남.
**근거(캡처)**: shiseido4 — 엑셀 원본 `대상 1650 / 전송 1617 / 성공 1590 / 실패 60` → 1590+60=1650=**대상**. 전송 1617 = 대상−33. 라프레리(160/157), 에이스하드웨어(47848/46852), 최선어학원(367/365)도 동일(성공+실패=대상). 정상 업체(고운세상 2/2)는 대상=전송이라 안 보임. 상세 모달 내 상단(1,646) vs 캠페인정보(1,613) 두 숫자 공존.
**의심 원인**: 성공/실패 집계는 **큐 전체(대상) 기준**, 전송건수는 **실제 송출(제외 후) 기준** — 서로 다른 소스. 무효번호/수신거부로 전송 제외된 건이 성공/실패 집계엔 포함됨. (또는 라이브↔이력 중복, 대체발송 원본+대체 중복 — toun28 7171 vs 7520 건과 같은 계열 [[project_2026_0611_debug_p0_p1_done]] smsCampaignCountsSafe)
**체크할 곳**: `utils/sms-queue.ts smsCampaignCountsSafe`, `routes/results.ts`(요약 total/success/fail + 상세 total), `utils/stats-aggregation.ts`, `utils/sms-queue.ts getCampaignResultCounts`. 전송건수 산식 ↔ 성공/실패 산식의 소스/제외조건 대조.
**수정 방향(가설)**: 수량 3층(대상/전송/결과) 정의 통일 — 전송 = 성공+실패+대기가 되도록, 제외건은 결과 집계에서 빼거나 전송 정의에 일관 반영. 목록·상세·엑셀 3표면 동일 헬퍼.

---

## 버그 4 — 알림톡 대표링크 k_etc_json 동봉 (신규 요청, 0611 7300 후속)

**요청**: 부가기능 "대표링크"를 발송테이블 `k_etc_json`에 `attachment_link`로 동봉.
형식: `{"attachment_link":{"url_pc":..,"url_mobile":..,"scheme_android":..,"scheme_ios":..}}` (각 text 1000자).
**배경**: 0611 강조형 7300 최종 원인이 "대표링크(represent_link) 미동봉". `kakao_templates.represent_link`는 저장만 하고 발송 경로 소비 0건이었음.
**참고**: 미리보기 메시지·보안템플릿은 카카오가 템플릿 등록값으로 자동 처리(JSON 불요). 다중버튼(템플릿키 전송 오류)은 버그5와 동일 뿌리(박과장 별도 리포트).
**체크할 곳**: `utils/messageUtils.ts`(buildAlimtalkEtcJson 등 k_etc_json 생성), `utils/sms-queue.ts`(insertAlimtalkQueue k_etc_json 적재), `kakao_templates.represent_link` 저장값, IMC v1 link 스펙 ↔ 비토 게이트웨이 `attachment_link` 규격 차이(어느 게이트웨이로 나가는지에 따라 키 다름).
**수정 방향(가설)**: k_etc_json 생성 시 represent_link → attachment_link 동봉. ★ 단 IMC 경유인지 비토 게이트웨이(SMSQ_SEND_13) 경유인지에 따라 키/형식 확정 후. 외부 응답/스펙은 [[feedback_external_api_response_verification]] 정합(추측 X).

---

## 버그 5 — 승인된 템플릿코드 출력 오류 (재발)

**현상**: 알림톡 템플릿 목록에서 **"버튼 3개"(부가 정보형, 팝폰 프로필) 템플릿만 템플릿코드가 `Tmq7e6bseqjd6i7j8w3`(템플릿키 형식)**. 나머지는 `B_IV_013_02_80287`/`B_XX_018_02_79965`(IMC 정상 코드).
**기대**: 기존 IMC 연동 템플릿코드(B_ 형식) 출력.
**의심 원인**: IMC templateCode 동기화 시 **부가 정보형/다중버튼 템플릿만 templateCode 대신 templateKey가 저장**됨. D217+ templateList 동기화(`templateList` 필드)의 부가정보형 응답 구조에서 코드 추출이 어긋남. 버그4의 "다중버튼=템플릿키 전송 실패"와 동일 뿌리.
**체크할 곳**: `utils/kakao-template-sync.ts`(templateList item에서 templateCode 추출 — 부가정보형일 때 templateCode 필드가 비고 templateKey만 오는지), `routes/alimtalk.ts`(getAlimtalkTemplate 저장), 부가정보형 IMC 응답 raw(첫 동기화 디버그 로그로 templateCode vs templateKey 필드 확인).
**수정 방향(가설)**: 부가정보형도 templateCode(B_) 정확히 추출·저장. raw 응답 키 확인 후([[feedback_external_api_response_verification]]).

---

## 공통 관통 패턴 (왜 재발하나)
1. **수량/시각 집계가 다중 소스**(기록↔실측, 대상↔전송↔결과, 라이브↔이력, 발송시각↔리포트시각) → 경계마다 불일치. 단편 수정(목록만/통계만)이 상세·행 단위에 안 닿음.
2. **알림톡 부가요소(대표링크·버튼·템플릿코드)가 저장만 되고 발송/표시 경로 미연결** 또는 외부(IMC) 응답 구조 추측.
→ 수정 시 "3표면(목록/상세/엑셀) 동일 헬퍼" + "외부 응답 raw 직접 확인" 원칙.

---

## 이번 세션(2026-06-15) 완료 작업 — 배포 상태
- **슈퍼관리자 캠페인관리**: 진입 시 당일 기본조회(`utils/formatDate.ts kstTodayStr` 신설 + AdminDashboard 날짜 초기값) + **예약 캠페인 예약시간 빠른순 정렬**(admin.ts `/campaigns/scheduled` ORDER BY scheduled_at ASC, id ASC). backend+frontend tsc 0. 배포완료.
- **싱크에이전트 인비토 node16 레거시 빌드**: 인비토 PC=Server 2008 R2라 node20 exe가 0xC0000139로 실행 불가 → `build:exe-legacy`(express4/mssql10 --no-save + esbuild --target=node16 + **vercel/pkg@5.8.1**, @yao-pkg node16 prelude 버그 우회) → `sync-agent/release/sync-agent-legacy.exe`(--version v1.5.5 로컬 OK). 인비토 PC 적용 대기. 상세 [[project_2026_0615_invito_legacy_node16_build]].
- **Bito 게이트웨이 연동(SMSQ_SEND_13)**: 자체 게이트웨이로 발송하는 13번 라인. 완료=MySQL `SMSQ_SEND_13`(LIKE 12)·PG sms_line_groups 비토 라인그룹(group_type 'bito')·코드 BULK_ONLY 격리(sms-queue.ts:22). 명세 `docs/bito-gateway-integration-spec.md`(비토 측 전달). 남은=env `SMS_TABLES`+SMSQ_SEND_13·비토 Agent MySQL 계정(IP/PW)·backend 배포. 비토 측이 Agent를 싱크에이전트식 AI 매핑으로 재설계 중.

---

## 다음 세션 진입
1. 본 문서 정독 → CLAUDE.md + 도메인 LESSONS(LESSONS_BACKEND/FRONTEND/DB) 정독
2. 버그 1번부터 하나씩: grep으로 의심 지점 확정 → Harold 컨펌 → 수정 → tsc/검증
3. 발송·돈(1·3) = dev_process 6원칙 적용, 실측 1건 시나리오 포함
