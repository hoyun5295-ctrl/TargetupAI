# 🐛 BUGS.md — 한줄로 버그 트래커


> **활성(열린) 버그만 이 문서에 둔다.** 종결 버그·과거 현황 원문 = [archive/BUGS_RESOLVED.md](archive/BUGS_RESOLVED.md) (grep 진입은 archive/INDEX.md 경유).

## 1) 버그 처리 프로토콜

### 1-1. 심각도 기준

| 등급 | 기호 | 기준 | 예시 |
|------|------|------|------|
| Blocker | 🔴🔴 | 핵심 기능 완전 불능, 데이터 손실 위험 | 발송 안 됨, 다른 문안 저장 |
| Critical | 🔴 | 주요 기능 오동작, 보안 위험 | 미등록 회신번호 차단 안 됨, 제목 머지 미적용 |
| Major | 🟠 | 기능 일부 오동작, 사용자 불편 | 스팸테스트 결과 오판정, 성공모달 정보 불일치 |
| Minor | 🟡 | UI 표시 오류, 사소한 불편 | 날짜 형식, 발송일시 표시 |

### 1-2. 상태 정의

| 상태 | 의미 |
|------|------|
| 🔵 Open | 발견됨, 미수정 |
| 🟡 수정완료-검증대기 | 코드 수정 완료, 교차검증 미실시 |
| ✅ Closed | 교차검증 2단계 모두 통과 |
| 🔄 Reopened | 교차검증 실패 또는 재발 |

### 1-3. 교차검증 프로토콜 (Closed 조건)

버그가 "해결됨"이 되려면 반드시 아래 **2단계를 모두 통과**해야 한다.

**1단계 — 코드 검증 (Claude):**
- 수정 코드가 관련 경로 **전부**에 일관 적용되었는지 확인
- 발송 관련이면 5개 경로 전수 점검 매트릭스 필수
- AI 관련이면 한줄로 + 맞춤한줄 양쪽 확인
- TypeScript 타입 체크 통과 근거 제시

**2단계 — 실동작 검증 (Harold님):**
- 실서비스(app.hanjul.ai)에서 점검 방법대로 실행
- 기대 결과와 실제 결과 일치 확인
- 스크린샷/로그 등 증거 확보 (가능한 경우)

**판정:**
- 2단계 모두 통과 → ✅ Closed
- 하나라도 실패 → 🔄 Reopened + 실패 원인 분석 → 재수정

### 1-4. 에러 대응 프로토콜 (신규 버그 발생 시)

1. **증상 기록:** 기대 결과 / 실제 결과 / 재현 절차 / 환경
2. **원인 특정:** 3줄 이내로 근본 원인 요약
3. **해결 옵션:** 2가지 이상 제시 (장단점/리스크/소요) → Harold님 선택
4. **최소 수정:** 선택된 옵션으로 수정 + 관련 경로 전수 점검
5. **교차검증:** 1-3의 2단계 프로토콜 실행

---


## 2) 활성 버그

### 🔴 2026-06-11 — 알림톡 강조표기형 7300 **최종 근본 확정 = 대표링크(ATTACHMENT.link) 미동봉** — 게이트웨이 매핑 추가 대기(서팀장)
> (2026-07-07 STATUS→BUGS 원문 이관 — 버그 상세의 소유 문서는 여기. STATUS에는 활성 1줄만.)
> **최종 근본(휴머스온 답변+실측 5회 확정)**: 79738만 `kakao_templates.represent_link` 등록(`{"urlPc","urlMobile"}` — 정상 발송 5개 템플릿은 전부 미등록, PG 실측)인데 **발송 요청에 link 미동봉 → 카카오 템플릿 불일치 거부**. 한줄로는 represent_link를 저장만 하고 발송 경로 소비 0건(grep). 옛 가설 2개 폐기 — ① sender_code concat(부차: 가드 수정 완료, 식별코드 301170011 엔진 자동삽입) ② imc_template_status R 차단(휴머스온 정의 **S=중지/A=정상/R=발송 전 대기, 첫 발송 시 자동 A** — R은 차단 사유 아님, CT-87 R 차단은 신규 템플릿 첫 발송 영구 차단 역효과라 정정 의무).
> **운반 구간 실측(LINKTEST1~6, Harold 번호 2개)**: etcJson snake/camel link·btnJson link객체·btnJson 버튼형식(name 유/무) 전부 7300. 게이트웨이(인비토 자체, mmsr3/ngen) 로그 = **etcJson의 link가 게이트웨이까지 온전 도달** + 휴머스온 "IMC 접수에 ATTACHMENT 없음" → **막히는 지점 = 게이트웨이 엔진이 etcJson에서 title만 IMC로 옮기고 link 미전달**. 타업체 성공 사례는 전부 대표링크 없는 템플릿(etcJson title만 — 전달 모양 한줄로와 동일). deliver 전문 필드=title/btnJson/etcJson뿐(link 전용 자리 없음). btnJson 버튼형식은 button으로 변환됨(채널추가 1800 실증 — 버튼 통로 정상).
> **해법(확정·진행 대기)**: ① 서팀장 — 게이트웨이 엔진에 etcJson 안 `link` 객체 → IMC 요청 최상위 `link`(urlMobile/urlPc) 매핑 추가. ② 한줄로 — 발송 4경로에서 대표링크 템플릿이면 etcJson에 `{"title":…,"link":{"urlMobile":…,"urlPc":…}}` 합성(공통 CT, buildAlimtalkEtcJson 확장) — ① 완료 통보 후 구현+실측 1건. ③ 어제 배포완료분 정정 묶음 = CT-87 R 차단 해제(S/D만)+화면 "발송불가" 뱃지 문구+SCHEMA.md imc_template_status 주석 — Harold 동의 대기.
> **진행(2026-07-07 — 게이트웨이 담당 자비스 서버 실측)**: hanjul01 Agent(v1.0.8, line13 SMSQ_SEND_13·비토 자체 게이트웨이 139.150.81.213→IMC) `agent-config.yaml` field_map에 **k_etc_json 미매핑 확인**(k_template_code/k_button_json만 있음) = 이 경로 강조표기 미전달 원인 확정. 자비스가 `field_map`에 `kakao_payload: "k_etc_json"` 추가 진행. **★ 우리 ②는 이미 구현·배선 완료**(위 "② 대기"는 정정 — `alimtalk-emphasize.ts buildAlimtalkEtcJson`이 대표링크 시 `attachment_link`(snake: url_mobile/url_pc/scheme_ios/scheme_android) 합성, 발송 4경로 배선). **남은 건 게이트웨이 엔진이 k_etc_json의 `attachment_link` 객체를 꺼내 IMC ATTACHMENT.link(urlMobile/urlPc)로 추출·변환**하는 것 — 키가 `link` 아닌 `attachment_link`임을 자비스에 명시(핸드오프 [docs/2026-07-07-hanjul01-agent-check-result.md](../docs/2026-07-07-hanjul01-agent-check-result.md) §5). E2E 검증 = 79738 대표링크 템플릿 line13 발송 → 1800 기대(7300이면 엔진 추출 미반영). 부수 관찰: 같은 Agent에 `reportDBFailures:2502`+대기 1건(07-05 이후 정지, 리포트 write-back 실패 1건) — 자비스 원인 회신 대기.
> **진행2(2026-07-07 13:36 — config 반영 완료)**: `agent-config.yaml` field_map에 `kakao_payload: "k_etc_json"` 추가 + `doctor` PASS12/FAIL0 + 재기동. 재기동 로그 "필드 매핑 엔진 초기화" 컬럼에 **k_etc_json 포함 확인** = Agent가 이제 k_etc_json을 게이트웨이로 kakao_payload 전달. **아직 절반** — 게이트웨이 엔진이 payload의 `attachment_link`(snake)→IMC ATTACHMENT.link 추출하는지는 **미검증**. 남은 판정 = E2E 79738 line13 발송 → status_code 1800(성공)/7300(엔진 추출 미반영). 발송 후 대조 SQL(smsdb.SMSQ_SEND_13 최근행 k_etc_json·status_code) 준비. activeClaims:1(07-05 대기건) 재기동 후 복원 — reportDBFailures 원인은 자비스 회신 대기(별건).
> **진행3(2026-07-07 — v1.0.10 회신·fix 위치 확정)**: 자비스 회신 — **attachment_link→IMC ATTACHMENT.link 변환은 Agent가 아니라 Gateway IMC connector v149+에서 처리**(Agent v1.0.10=k_etc_json 누락 없이 전달만). **config 마이그레이션 불필요 확정** — `field_map.kakao_payload: "k_etc_json"` 유지가 정답(통짜 JSON 컬럼은 kakao_payload_map.attachment 아님, 하위호환 O). 옛 "kakao_payload_map으로 옮겨야" 우려는 철회. **★남은 전제 = 현재 Gateway(139.150.81.213)가 v149 이상인지 확인**(미만이면 Agent 교체해도 7300 그대로) → 질의 [docs/2026-07-07-gateway-v149-version-check-request.md](../docs/2026-07-07-gateway-v149-version-check-request.md). 순서: **①Gateway v149+ 확인 → ②Agent v1.0.10 교체+config(kakao_payload 유지·failover 2줄 옵션) → ③E2E 79738 line13 → DONE/정상(7300 재발 X)**. 우리 측 코드 변경 없음(payload 이미 정확, buildAlimtalkEtcJson이 attachment_link를 top-level 합성). v1.0.10 마이그레이션 질의 상세 = docs/2026-07-07-agent-v1.0.10-migration-request.md.
> **진행4(2026-07-07 16:22~ — Agent v1.0.10 교체 + E2E → senderkey 관문 발견)**: Agent v1.0.10 교체 완료(doctor PASS13·RuntimeWrite PASS=UPDATE 권한 정상→reportDBFailures 2502는 07-05 누적치·현재 0·권한 무관). Gateway v149 확인(단 checksum 578a9100=패키지/7a7935=binary·route bind provider humuson_imc·account invito11·connector_ready=true 정상). **★E2E 79738 line13 6건 실측 = status_code 9999**(7300 아님). Agent 로그 근본 = `"필드 매핑 실패 … kakao_sender_key 필수"` → **발송 전 막힘**(게이트웨이 도달 X). **7300(대표링크)은 사실상 해결**: k_etc_json 합성 완벽(title+attachment_link, represent_link=invitocorp.com 정확 일치·top-level). **유일 관문 = 발신프로필키(senderkey)** — 표준 QTmsg 중계서버는 템플릿코드로 자동 도출(한줄로 미전송에도 강조표기 정상)했으나 Agent v1.0.10은 명시 요구. **결정(Harold 2026-07-07): 게이트웨이가 표준처럼 senderkey 자동 도출하게 변경 요청** = 한줄로 발송경로 무변경(빠름) → 질의 [docs/2026-07-07-gateway-auto-senderkey-request.md](../docs/2026-07-07-gateway-auto-senderkey-request.md). **대안(자동도출 불가 시)**: 한줄로 buildAlimtalkEtcJson에 SENDER_KEY 추가(값=kakao_sender_profiles.profile_key) — 발송 4경로+캠페인 staging 배관 7지점(SendChunkParams에 alimtalkSenderKey 신설, p.kakaoSenderKey는 브랜드메시지용이라 알림톡엔 빈값). **다음 세션**: 자비스 회신(자동도출 가부) → 무변경 또는 7지점 구현 → 79738 line13 재발송 DONE 확인.
> **진행5(2026-07-07 — Harold 결정 변경 + 한줄로 SENDER_KEY 주입 구현 완료·미배포)**: 자비스 회신 = 자동 도출은 v1.0.10에 없음·Agent/Gateway 동시 보강(v1.0.11 매핑 저장소) 필요 = "빠름" 아님. **Harold 재검토 결정 = 한줄로가 주입**(근거: template→senderkey 매핑 원본 소유자=한줄로 PG, 게이트웨이 복제 저장소=이중 진실·6원칙③ 위반 형태 / QTmsg 자동도출은 폐기 대상 레거시 relay의 편의 재구현 / 브랜드메시지도 이미 senderkey 명시 패턴). **구현 = 비토 라인 한정 주입**: CT-04 `insertAlimtalkQueue`(단일 길목 — 알림톡 4경로 전부 경유, 우회 INSERT 0건 grep 확정)가 INSERT 대상 테이블이 `sms_line_groups group_type='bito'` 목록(`getBitoSmsTables` 캐시, DB가 진실)일 때만 `withSenderKey`(CT alimtalk-emphasize, vitest 6)로 k_etc_json에 SENDER_KEY 병합. 값 = `kakao_templates(company_id,template_code)→profile_id→kakao_sender_profiles.profile_key`(운영 gate·resolveTemplateContext와 동일 조인, 신규 컬럼 0). **표준 QTmsg 라인 payload 바이트 불변**(D234+ select_sql 합성과 상호작용 0) + varchar(1024) 초과 가드(원본 유지) + 도출 실패 시 미주입+에러 로그(fail-fast 유지, 자동완화 X). 옛 "senderkey 제외" 주석 6곳 갱신(잔존 0 grep). vitest 353/tsc 0. 자비스 자동도출 요청 철회 통지 = docs/2026-07-07-senderkey-decision-notice.md. **다음 = 배포 → E2E 79738 line13(1800 기대) + 표준 라인 1건(SENDER_KEY 없음 확인)**.
> **잔여**: 진단로그 `[ALIMTALK-DEBUG2]`(direct-send-processor) 제거 의무(종결 시). LINKTEST1~6 테스트 행 = SMSQ_SEND_1_202606 app_etc1 LIKE 'LINKTEST%' (정산 집계 시 제외 식별 가능). IMC v1 스펙 제약 = link 포함 시 버튼 최대 2개. 5월 79955 버튼 발송 url1_1 빈 값 92 건은 CT(convertButtonsToQTmsg) 도입 전 경로 — 현행 CT는 urlMobile 정상 처리.
> 상세=`memory/project_2026_0609_alimtalk_emphasize_etcjson_diagnosis.md`(2026-06-11 갱신)+IMC v1 스펙=Developer Portal(link 최상위 camelCase·강조형 link 허용).

