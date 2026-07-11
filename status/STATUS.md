# 한줄로 — 관제탑 (STATUS)

> **상시 로드 문서. 30KB 상한.** 룰의 원천은 CLAUDE.md — 이 문서는 "현재 상태"와 "라우팅"만 담는다.
> 재설계 전(2026-07-03 관제탑 재설계 v2) 전체 원본은 git 이력에 보존 — `_backup-20260703-관제탑재설계전/` 폴더는 2026-07-07 삭제(git 이력에서 복구 가능). 필요 시 `git log --all -- 'status/_backup-20260703-*'`로 해당 커밋 조회.
> 사용법: 상황이 생기면 아래 라우팅 표에서 문서를 찾아 **지시된 범위만** 읽는다. 문서 전체 로드 금지. 아카이브는 archive/INDEX.md grep 경유로만.

---

## 1) 라우팅 표 — 이런 경우엔 이 문서

| 상황 | 참조 문서 | 읽는 범위 |
|------|-----------|-----------|
| DB 쿼리 작성 / 스키마 확인 | SCHEMA.md | 대상 테이블 절만 |
| DB·돈·환불·마이그레이션 작업 | lessons/LESSONS_DB.md | 도메인 전체 |
| Frontend·UI·모달 작업 | lessons/LESSONS_FRONTEND.md | 도메인 전체 |
| Backend·API·발송·AI 작업 | lessons/LESSONS_BACKEND.md | 도메인 전체 |
| 배포·빌드·SSH·의존성 | lessons/LESSONS_DEPLOY.md + OPS.md | 도메인 전체 / 해당 절 |
| 매 답변 직전 | lessons/LESSONS_META.md | 전체 (경량 유지) |
| 컨트롤타워·도메인 흐름 | lessons/LESSONS_ARCHITECTURE.md | 해당 CT |
| 시스템 구조 파악 | ARCHITECTURE.md | 해당 절만 |
| 자사몰 연동·CDP·커넥터 작업 | INTEGRATIONS.md | 해당 provider 카드 / CDP 공통 절 |
| 버그 수정 | BUGS.md | 해당 버그 항목 (해결분은 archive/BUGS_RESOLVED.md) |
| 과거 작업 조회·회귀 의심 | archive/INDEX.md → TASKS_YYYY-MM.md | grep 적중 항목만 |
| 의사결정 배경 확인 | DECISIONS.md | 해당 ADR |
| 리스크 전체 확인 | RISKS.md | 전체 |
| 싱크에이전트 이슈 진단 | SYNC-AGENT-TROUBLESHOOTING.md | 해당 증상 절 |
| 싱크에이전트 isae 현장(완료 이력) | archive/SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md | grep 적중 절만 (2026-07-07 archive 이동) |
| AI Operator·CDP·Provider | docs/AI_OPERATOR_기능정의서.md + ai_operator_progress.md | 해당 절 |
| CRM 캠페인 대행(설계 대행) 기능 | docs/2026-07-09-crm-campaign-agency-implementation.md | 전체 |
| 레거시 서버(27.102.203.143) 폐기 | docs/레거시서버_폐기_플랜.md | 전체 (SoT — 진행 시 갱신) |
| 인앱메시지 설계 | docs/인앱메세지전용.md | 해당 절 |
| 장기 로드맵·비전 | docs/한줄로_BEYOND_BRAZE_비전.md | 해당 절 |
| 옛 설계서·핸드오프·디버그노트 | archive/DESIGNS/ (archive/INDEX.md 경유) | grep 적중 문서만 |

---

## 2) CURRENT_TASK (활성 작업만)

> **회전 룰:** 완료(★배포완료) 엔트리는 원문을 archive/TASKS_YYYY-MM.md로 이동 + INDEX 등재하고, 아래 "최근 완료 인덱스"에 1줄만 남긴다. 30KB 초과 = 회전 미이행 — 즉시 회전.

### 🟢 2026-07-10 (5) — 직원 리포트 3건: 여정 엔터 줄바꿈 + MDM 단축 URL 신기능(hlj.kr·100크레딧) + DM 히어로 버튼색·상품가격 하단고정 (★배포완료 2026-07-10 — Harold 선언 / 운영 실측 = Harold)
> ① **여정 자연어 엔터**(박성용): 멀티라인 textarea가 Enter 즉시 실행이라 줄바꿈 불가 → 메인 오퍼레이터와 동일 Ctrl/Cmd+Enter 실행으로 통일(JourneysPage:1444 1곳 — 전수 grep 결과 타 Enter 핸들러는 한 줄 input 표준/["Enter로 생성" 명시] 의도 UX라 무변경). ② **고객사 자체 URL 단축 신기능**(박성용, Harold 100크레딧 확정): 외부 MDM URL→hlj.kr/<code>. 신규 CT 2(dm-custom-short-link-core 순수 검증=오픈 리다이렉터 차단[스킴/자기도메인/IP·내부망/userinfo — hlj.kr 평판=전체 DM 도달률 보호]+DB CT 3축 코드 충돌 확인)·/s/:code 3순위 조회(기존 2축 무변경)·발급/목록/토글 라우트(발급 성공 후 멱등 차감·일일 상한 50=INSERT 단문 결합[TOCTOU 정정]·503 안전망)·크레딧 3점 세트(map 100+CONFIRM+CreditConfirmModal)·DM 빌더 헤더 [단축 URL] 버튼+발급/관리 모달. **DDL 1건 실행완료**(dm_custom_short_links CREATE). Codex 적대 리뷰: TOCTOU 정정 반영 / 크레딧 원자성=전사 정책([CREDIT][MISS] 수동 재차감·효과물 회수 없음 — DM 발행 동일) 수정 불요 / 우회 벡터=파서 정규화 실측으로 전부 기차단(공격면 테스트 4건 고정). ③ **DM 2건**(임은지): 히어로 오버랩 카드가 "버튼 색"(accent_color→--dm-primary) 미소비(흰 카드 하드코딩) → 래퍼가 강조 면 변수 3종(--dm-accent-surface/-fg/-sub) 동반 정의+카드 폴백 소비(미지정 발행물 무변화·캔버스/SSR 미러) / 상품 슬라이드 가격 줄=카드 flex column+margin-top:auto 하단 고정(제품명 길이 무관·양쪽 미러). 검증 BE tsc0·vitest428(신규 14)·FE tsc0·금지패턴0. 상세 [[project_2026_0710_staff_reports_shortlink_dm]].

### 🟢 2026-07-10 (4) — 비토 게이트웨이 API 직접연동 테스트 통과 (LMS 3건 왕복 완주)
> HANJULLO-API-TEST 계정으로 /account 인증→LMS 3건(01052958517·01030635257·01055775868) 접수→DONE+실수신 확인. lms_mms route·발신번호(1800-8125)·결과 회수 검증 완료(SMS 라인 미연결이라 LMS만 — 원래 핵심 검증 축). **다음 = 한줄로 발송 경로 DB큐(SMSQ_SEND_13)→API 전환 검토**(발송 파이프라인 절대 보호 대상 — 설계 검토부터). 상세 [[project_2026_0710_bito_api_direct_test]].

### 🟢 2026-07-10 (3) — 싱크에이전트 원격 관리 개편 P0+P1+P2 (★배포완료 2026-07-10 — Harold 선언 / 잔여 = 1.6.1 exe 업로드·릴리즈 등록·왕복 실측)
> §4 A~G 전수 실측 완료(SoT 스펙 §4·§4-1에 기록 — A=소스 위치 `targetup/sync-agent/`·B=매핑 타겟 단위 통째 교체·C=heartbeat 60분 하드코딩·GET /config 미사용 죽은 endpoint·E=PUT 설정 column_mapping은 에이전트 미소비 죽은 데이터·F=운영 에이전트 이새 1대 1.5.7뿐·G=1.6.1 미등록). 구현: **에이전트 v1.6.1**(heartbeat 자기 보고 appliedMapping·sourceColumns·configVersion + 명령 ACK 파일 영속·멱등 + boost + 진단 3종 report_logs/test_connection/mapping_dryrun[마스킹] + state 원자 저장) + **서버**(agent-protocol 순수 CT vitest15 — At-Least-Once·5회 만료·용량 가드 / heartbeat ACK 반영→조건부 UPDATE·충돌 재계산 + admin 명령 원자 append[Codex config 경쟁 FAIL 정정] / 구버전<1.6.1=At-Most-Once 불변=이새 비범위 준수·진단 명령 400 게이트) + **슈퍼관리자**(매핑 모달 reported 프리필+소스 컬럼 드롭다운+custom 슬롯 카운터+"전체 교체" 확인+구버전 저장 차단[D1 함정 봉쇄]+dry-run / 명령 모달 진단 2종 / 상세=자기 보고·대기 명령·명령 결과 로그 뷰어). DDL 0(전부 config jsonb). **1.6.1 전 티어 빌드 완료**(manifest 1.6.1·zip 20·sha256 세션 로그). 검증 agent tsc0·vitest60 / BE tsc0·vitest414 / FE tsc0. ★릴리즈 등록 시 이새(win-legacy)가 매시간 자동 수령 — 등록 시점 Harold 판단(2달 뒤 재연동 직전 가능·서버는 구버전 공존). 상세 [[project_2026_0710_sync_agent_remote_admin_audit]] · SoT=[specs/2026-07-10-sync-agent-remote-admin-audit.md](../docs/superpowers/specs/2026-07-10-sync-agent-remote-admin-audit.md).

### 🟢 2026-07-10 (2) — 발송 대상 [타겟확인]: 자동마케팅 추천 카드 + AI 오퍼레이터 메인 (★배포완료 2026-07-10 — Harold 선언 / 운영 실측 = Harold)
> 설계서(§0-5 회의 결론 — 여정 보류) 그대로 구현: **자동마케팅** = POST /operator/proposals/:id/recipients(승인 라우트와 동일 소유자 scope+isAiOperatorAllowed+storeScope 미러·**발송 추출과 동일 WHERE** 합성=신규 순수 헬퍼 buildSendableRecipientsTopSql[LIMIT 100·ORDER BY c.id ASC·COUNT/OFFSET 없음]·dispatch와 동일 인자 excludeClickedSince/fatigueCap·시점 정직 라벨) + ProposalDecisionCard [타겟확인] 버튼(승인/거부 왼쪽·1회 로드 캐시·클라 페이징). **오퍼레이터 메인**(Harold 추가 지시) = POST /operator/target-recipients(preview-recipients와 동일 WHERE — 이 발송 경로는 피로도 게이트 미적용 실측이라 의도적 미포함=명단·실발송 일치)·리스트 로더 전량(최대 1만행) 적재→LIMIT 100 교체·발송 2-step 무변경. **조건 필드 동적 컬럼** = resolveConditionColumns(FIELD_MAP 주입 화이트리스트·displayName 라벨)+TargetRecipientsModal extraColumns prop(미전달=기존 6곳 렌더 불변). §3-1③ operator expected-recipients는 스펙 규칙대로 보류(operator 본체=target_hint 자연어뿐·구조화 필터 없음 실측). WHERE 조각=발송 추출과 문자 동일 verify 테스트 고정(총 28). Codex 2회: scope·주입·훅 PASS / storeScope 차이·totalCount=스펙 확정 판정. 검증 BE/FE tsc0·vitest399·verify28·금지패턴0. SoT=[specs/2026-07-10-send-target-list-three-phase-design.md](../docs/superpowers/specs/2026-07-10-send-target-list-three-phase-design.md) · [[project_2026_0710_send_target_list_three_phase]].

### 🟡 진행중 — 레거시 PAY 사이트 한줄로 흡수 (Track D, ★원격 접속 로직 검증완료(established 수정·139 실접속 OPEN) — 강문희 발송서버 실 공인 IP 회신 대기)
> 서팀장 2차 회신 전부 반영. **수신 DB 구축완료(2026-07-07)**: invito `pay-ingest-db`(MariaDB 10.11, --sql-mode="") — 143 dump 3테이블 82MB 복원(934,232/730/7,026 일치)·SysId 백필(B/C/D=54/57/58)·계정(sales×3 IP host·root@% 제거)·방화벽 systemd `pay-ingest-fw`. **★2026-07-09 원격 접속 사고 근본해결**: 강문희 실측 54/57/58→62:23388 접속 불가(^C). 재점검 결과 근본 = **DOCKER-USER에 리턴(ESTABLISHED) 허용 룰 누락** → SYN은 ACCEPT 통과해도 DB 응답(SYN-ACK)이 `0.0.0.0/0 DROP`에 걸려 **어떤 IP도 접속 불가**(로컬 127.0.0.1은 FORWARD 미경유 OPEN 착시·tcpdump SYN-ACK 0 확인). 비토 게이트웨이(139.150.81.213) 화이트리스트+established 추가로 **동일 환경 실측→OPEN 확인**, systemd에 established+139 영속화. 부수 발견: "서버명 옥텟=공인 IP" 추정 폐기(우리 게이트웨이도 이름≠실 IP 139). **다음 = 강문희 발송서버 실 아웃바운드 공인 IP 회신 → 계정 host+iptables 반영 → 발주 → 전환일 → 유입 검증(§7-4) → Phase 2.** 강문희 정정 메일(established 수정·실접속 확인·실 IP 요청) 발송 대기. SoT=[docs/레거시서버_폐기_플랜.md](docs/레거시서버_폐기_플랜.md) · 런북=[docs/2026-07-07-pay-absorption-track-d-design.md](docs/2026-07-07-pay-absorption-track-d-design.md) §7. 교훈=[[feedback_verify_in_same_env_before_external_request]].

### 🔵 다음 세션 (예정)
> ⓪ **비토 API 발송 경로 전환 검토(선택 후보 — 확정 과제 아님)** — LMS 왕복 테스트 통과로 개시 가능 상태. 한줄로 발송을 DB큐(SMSQ_SEND_13)→게이트웨이 API로 전환할지 설계 검토(발송 파이프라인 절대 보호 — 영향표부터). [[project_2026_0710_bito_api_direct_test]].
> ⓪-2 싱크에이전트 1.6.1 = **업로드·릴리즈 등록 완료(2026-07-10 Harold) — 종결.** 이새 박스(1.5.7)는 updater 자기교체 결함으로 **원격 자동 업데이트 불가(현장 재설치 필요)** → 그대로 두고 **2달 뒤 타 업체 ERP 전환 때 새 에이전트(1.6.1+)로 신규 배포**(Harold 확정 2026-07-10). 그때까지 1.5.7 유지가 정상 상태(슈퍼관리자 매핑 모달=구버전 안내·저장 차단 동작).
> ① **누적 0707 배포** — tp-push + build:safe(frontend·company-frontend·backend) + pm2 reload + Codex /codex:review(플러그인 미로드분). ② **PAY Track D** — 강문희 발주 → 전환 → 유입 검증 → Phase 2 설계(조회+정산+거래내역서 웹/Agent 구분 일괄). ③ **템플릿관리자 흡수(Track B+C)** = 레거시 폐기 최대 잔여 — ★2026-07-10 방향 정리: 이관 = 레거시 DB 복사 X, **senderKey 연결 + IMC 원본 pull**(개발 실체 = 슈퍼관리자 import 2종 신설·같은 IMC 계정 개연성 4,849 실측 근거·재검수 쟁점은 같은 계정 확정 시 소멸). **서팀장 사전 체크 12문항 회신 대기(폐기플랜 §4-3)** → 회신 후 재토의 → 아난티 getSender 실측 → import 2종 설계. 강문희 질의는 그 후 잔여분만.
> (보류) 팝폰 SDK 검증(자체 서비스 SDK 실측 베드) = C:\Users\ceo\projects\poppon-workspace 정독 후 별도. 상세 [[project_2026_0618_selfhosted_mall_app_collection]].

---

### 최근 완료 인덱스 (원문 = 링크의 월별 아카이브)

- 🟢 2026-07-10 — 여정 "목표 달성 시 자동 종료"(goal_met)+옵션 UI 2단 (★배포완료, STATUS→archive 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0710_journey_goal_exit]]
- 🟢 2026-07-09(8) — CRM 대행 접수 웹 폼 전환+이미지 자동 입력 (★배포완료, 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0709_crm_agency_webform_redesign]]
- 🟢 2026-07-09(7) — 요금제 정책 정비+AI 사용량 메뉴 이동+Brand Voice 초기화/저장 (★배포완료, 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0709_plan_gating_audit]]
- 🟢 2026-07-09(6) — CRM 캠페인 대행 신설(비즈니스+ 컨설팅) (★배포완료, 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0709_crm_campaign_agency]]
- 🟢 2026-07-09(5) — 자동마케팅 3건(노출scope·문안3안·사전알림 발신번호) (★배포완료, 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0709_automarketing_scope_permission_variant_notice]]
- 🟢 2026-07-09(2~4) — AI Operator MMS+모바일 DM 4건+여정 전환오류+뒤로가기 전수 (★배포완료, 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-09 — 직접시점 모달화+타겟 리스트 공용화+DM 정렬 일관화+개인화 라벨 단일소스 (★배포완료, 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0709_datetime_target_dm_var_unify]]
- 🟢 2026-07-07(9) — 뱃지 라벨 3단 정책 정리 (배포완료 0709 게이팅 정비에 포함, 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-07 — 알림톡 강조표기형 3관문 종결 (★배포완료 716074dc, 회전 2026-07-10) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0707_bito_agent_7300_senderkey]]
- 🟢 2026-07-08(3) — AI Operator 0건 크레딧 미차감 + 직원 디버깅 4건(개인화 라벨·하위계정 DB현황·DM헤더우측·타겟건수 오판철회) (★배포완료) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0708_operator_credit_and_staff_debug]]
- 🟢 2026-07-08(2) — 원클릭 캠페인(이미지 판독·초안DB) + 이미지로 문안 + 연동몰 상품 자동채움(카페24·네이버) + 예약 UI (★배포완료) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0708_mall_product_autofill_dm]] · [[project_2026_0708_event_campaign_image_and_draft_persistence]]
- 🟢 2026-07-08 — 행사 상품 구조 추출 + 인앱 SDK 서빙 공용화·팝폰 복구 + 인앱 익명 fallback + 로그인 문의·DM 2열 (★배포완료) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0708_event_campaign_product_extraction]] · [[reference_inapp_sdk_serving]]
- 🟢 2026-07-07 — 인앱/이메일/DM 대개편 6종 + hlj.kr 단축링크 + 인앱 디자인 2.0~2.1 + 형태 4종 + 이메일·DM 2.0 + 행사 캠페인 (★DDL 6컬럼·hlj.kr 라이브 / frontend·SDK·backend build+deploy 잔여) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0707_inapp_email_dm_overhaul]]
- 🟢 2026-07-07(6) — 마케팅 캘린더 완비: 통지·출구·타겟 축 구멍 4건 근본수정 (★배포완료) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0705_marketing_calendar_overhaul]]
- 🟢 2026-07-06 — 운영 버그 5건 근본수정 (★배포완료 / **잔여: Harold 운영검증** — 복구 UPDATE 897 재실행·5건 실측·.env CLAUDE_MAPPING_MODEL 확인) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0706_pending_fail_freeze_rootfix]]
- 🟢 2026-07-05 — 자동마케팅 4수정(★배포완료) + 비토 Agent v1.0.8 MMS(**잔여: Gateway v135 E2E 실측 대기**) + 레거시 템플릿 이관 조사(**잔여: 서팀장 회의**) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0705_bito_agent_v108_mms]] · [[project_2026_0705_legacy_template_migration]]
- 🟢 2026-07-05 (4) — 카페24 심사 반려 3건 대응 + 마케팅 캘린더 헛점 12건 근본 수정 (★배포완료·DDL 2건 포함) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0705_marketing_calendar_overhaul]] · [[project_2026_0703_cafe24_review_godo_integration]]
- 🟢 2026-07-05 (2) — 여정 재점검: 3버그 + 발송 피로도 보호 + 계절감 제거 (★전부 배포완료) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0705_journey_reinforcement]]
- 🟢 2026-07-04 (2) — 모달/토스트 UX(★배포완료) + 베스트 문안 재설계·진화 + 발송결과 집계 근본수정 + 스크롤 복원 + 직접발송 정리 (**잔여: ③④⑤⑥⑦ tp-push+build:safe+pm2 재배포 + 서버 psql 2세트(best_copy_seed_usage·best_copy_assets CREATE / ai_training_logs.click_count·conversion_count ADD)**) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-04 — 문안 퀄리티 엔진(cold-start, GPT 차별화·fix분 재배포 대기) + 비토 자체게이트웨이 라인13 E2E 완주 + 메모리 관제탑 정리 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-03 — 관제탑 v2 + 사용구분 게이팅 + 전채널 학습루프 + 레거시 SSL + 카페24/고도몰/isae 완결 (**잔여: 학습루프 ②③⑤ 재배포+실측 / 레거시 폐기 서팀장 5문항 회신 대기**) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0703_control_tower_redesign]] · [[project_2026_0703_all_channel_learning_loop]]
- 🟢 2026-07-03 — 싱크에이전트 updater 자기교체 근본수정 v1.6.0 (**잔여: tp-push·sync_releases 서버 릴리즈 등록 — win-legacy active 등록은 1.6.1부터**) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0703_sync_agent_updater_selfreplace]]
- 🟢 2026-07-02 (6) — 자동마케팅 완성: 발송 전 흐름 스펙 + 일일 분석 엔진(오늘의 추천) + 회고·ROI·캘린더·D-2 준비 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (5) — DM 추적 근본 수리(본문 파서) + 상세 추적/버튼 단위 + AI 학습 메모리 자동 전송 + 디자인 v2 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (4) — DM·이메일 전면 정비 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (3) — 모바일DM 수신자별 추적 근본 수정: 토큰 1급 키 + 열람 깊이/섹션/클릭 + 추적 화면 격상 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (2) — 이메일 마케팅 종결: 크레딧 모델 개편 + 개인화 동적화 + 링크/쿠폰/서식/페이징 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (1) — 브랜드보이스 형태 추출 강화 + 브랜드 링크 + 문안 편집기 모달 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-01 (이어서 3) — 서버 상태 점검 후 코드 수정: 42P08 + PG 부팅 연결 재시도 + CORS 안내 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-01 (이어서 2) — 예측 일일차감 eligibility 재정의 + 슈퍼관리자 화이트 모던화 + 이메일 placeholder 발송 UX → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-01 (이어서) — 비-문자 개인화+타겟추출 전체(이메일·인앱·DM) + DM 수신자별 토큰 발송/추적/편집기 + 발행 주소복사 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-01 — AI 모델 전환: 문안=Sonnet 5 / 오퍼레이터 정밀=Opus 4.8 + 검수 thinking·오탐차단 + 브랜드보이스 톤 강화 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)

> 2026-06-30 이하 완료분 = [archive/INDEX.md](archive/INDEX.md) 카탈로그 경유 (날짜·증상어 grep).

---

## 3) 진행 예정 작업 (TODO)

> 완료분(D39·대시보드 리팩토링·AI 맞춤한줄 완료분·080·Sync Agent 완료분·보안 완료분·인비토AI 완료분) 원문 = [archive/DONE_LOG_2026.md](archive/DONE_LOG_2026.md) "STATUS §3 TODO 완료분 회전 (2026-07-07)" 절로 무손실 이동.

### 🟡 잔여 — 직원 버그리포트 실동작 검증 (코드 수정 전체 완료)
- [ ] **8차 B8-01~B8-13: 직원 실서비스 테스트** (app.hanjul.ai)
- [ ] **9차 S9-04/S9-08: 발송결과 조회 성능 + sent_at 정확성 확인**
- [ ] **D39 세션2 실동작 검증: 필터 UI + AI 보유필드 확인**

### AI 맞춤한줄 Phase 2 (잔여)
- [ ] 실서비스 통합 테스트 (실제 발송 확인) — Harold님 검증 대기

### 카카오 알림톡 템플릿 관리 (Humuson API v2.1.1)
- [ ] 고객사 관리자(app.hanjul.ai) 템플릿 CRUD + 검수 프로세스 + 발신프로필 조회 + 관리 UI
- [ ] 슈퍼관리자(sys.hanjullo.com) 고객사별 Humuson 연동 설정 (humuson_user_id, uuid)
- [ ] 서비스 사용자(hanjul.ai) 캠페인 발송 시 APR 상태 템플릿만 선택
- [ ] 기술: 백엔드 프록시 /api/kakao-templates/*, DB kakao_templates 확장, 상태 전이 규칙
- [ ] Phase 2: 이미지 업로드, 알림 수신자 관리, 발신프로필 그룹

### 선불 요금제 Phase 1-B~2
- [ ] Phase 1-B: KCP PG 연동 (카드결제만, 가상계좌 제외)
- [ ] Phase 2: 입금감지 API 자동화

### Sync Agent (잔여)
- [x] v1.6.1 빌드+업로드+릴리즈 등록 — **2026-07-10 완료(Harold) — 종결**. 이새(1.5.7)=자기교체 결함으로 원격 업데이트 불가 → 2달 뒤 타 ERP 전환 때 새 에이전트 신규 배포(그때까지 1.5.7 유지가 정상)

### 보안 (잔여)
- [ ] 슈퍼관리자 IP 화이트리스트 설정
- [ ] SSH 키 인증 전용 전환 (비밀번호 로그인 비활성화) — 선택

### 인비토AI (잔여)
- [ ] 데이터 충분히 축적 후 모델 학습 파이프라인 설계
- [ ] 이용약관 제14조(데이터 활용) 배포 후 서비스 공지 (조항 신설은 2026-07-03 완료)

---

## 4) 가정 목록 (ASSUMPTION LEDGER)

(아직 없음)

---

## 5) 활성 리스크 상위 (1줄 요약 — 전체는 RISKS.md)

- R1 타입 에러 배포 → 서버 크래시 (확률2·영향5) — 배포 전 tsc --noEmit 필수
- R2 DB 파괴적 작업 데이터 유실 (확률2·영향5) — pg_dump 백업 후 작업
- R23 Docker 재생성 시 0.0.0.0 바인딩 실수 (확률2·영향5) — 반드시 127.0.0.1 확인 (OPS.md 안전 명령)
- 그 외 등재 리스크는 전부 ✅ 해결 상태 — 상세·이력은 RISKS.md

---

## 6) 최근 결정 5건 (1줄 요약 — 전체는 DECISIONS.md)

- D78 (03-16) 프로 자동 스팸필터 테스트 + CT-09 spam-test-queue — 차단 시 자동 재생성(최대 2회)
- D73 (03-14) 무료체험 PRO 게이팅 + 수신거부 브랜드 자동배정(CT-03) + 커스텀 라벨 UPSERT(CT-07)
- D69 (03-12) 자동발송 기능 기초 설계 — auto_campaigns + PM2 워커 + D-1 사전알림
- D68 (03-12) 대시보드 UI 4건 + AI 생일 타겟팅 + 테스트 비용 합산
- D67 (03-12) 080 콜백 진단 + 수신동의 변형 13종 + 사용자별 고객DB 삭제
- ※ 2026-03-16 이후 결정은 DECISIONS.md 미등재(TASKS·memory에 산재) — 소급 등재는 별도 작업으로.

---

## 7) DONE LOG

> 최근 완료는 §2 "최근 완료 인덱스"가 담당한다. 과거 DONE LOG(3월 이전 31건) + STATUS §3 완료분 회전(2026-07-07) 원문 = [archive/DONE_LOG_2026.md](archive/DONE_LOG_2026.md).
