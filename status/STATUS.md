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

### 🟢 2026-07-12 (4) — 인앱메시지 일괄 강화 P0-1~P2-2 (코드완료 — 배포 대기 / 실측 5건 = 직원 테스트)
> SoT=[specs/2026-07-12-inapp-full-reinforcement-design.md](../docs/superpowers/specs/2026-07-12-inapp-full-reinforcement-design.md) 전 항목 구현: **P0** ①트리거 임계값 검증 — SDK 자동 트리거 발화 시 실측값 동봉(scrollPercent·timeOnPageSeconds)+순수 passesTriggerThresholds(기본 50%/10초·미전달 통과·cart_value 기존 유지)+편집기 임계 입력칸(scroll %·체류 초·장바구니 금액)+직접 trigger() 호출 시 실측 보강(Codex 1R — 콘솔 우회 차단) ②SDK 버튼 4곳 safeNavigate 스킴 화이트리스트(javascript:/data: 차단 — new URL 파싱 후 protocol 판정)+서버 저장 3경로 sanitizeActionUrl 무해화(cta_group 포함·camel/snake 양쪽 수용[Codex 2R]·placeholder 보존) ③track 소유 검증(trackImpression 초입 SELECT+uuid 형식 → 400) ④중복 렌더 가드(같은 data-hanjullo-msg DOM 잔존 시 skip — always 의미 보존) **P1** 부분 PUT presence flag 원자 병합(CASE WHEN $32~$37 — 선조회 병합은 동시 PUT 경합이라 폐기[Codex 1R]·action_url 명시 삭제/위험 스킴 클리어 지원)·새벽 시간대 amber 경고(차단 아님 — 법 판정 §0)·stats 파라미터 bind 버그 1줄 수리·variant 6컬럼 상속(content_blocks=replaceBlockTexts 사본+theme/accent/card_style/badge/channel — quickActionAIRefine 동일 경로 해소)·레거시/토스트 (광고) 자동 표기+AI 프롬프트 080 거짓 서술 삭제 **P2** 블록 드래그앤드롭+복제(@dnd-kit 이식·uid는 블록 객체 참조 reconcile[Codex 1R]·commit 패턴으로 편집 중 포커스 보존)·상품 블록 가격 구조화(price/discount_price — SDK+BlockPreview+에디터 3면, 할인가 accent 800+정가 취소선, meta는 가격 미입력 시만=하위호환). Codex 적대 3라운드(gpt-5.5·xhigh): 1R 3건+추가 1건 정정 → 2R 잔존 1건 정정 → 3R "잔존 결함·새 회귀 없음 — 배포 가능". 검증 BE tsc0·vitest 53파일 455(신규 18)·SDK tsc0·vitest 141(신규 10)·FE tsc0·금지패턴0·DDL 0. **SDK 번들 재빌드 → company-frontend/public/sdk v0.3.8·v0.3.9 제자리 갱신(md5 3경로 동일 — 설치 몰 재설치 불필요)**. **잔여 = 배포(tp-push + build:safe frontend·company-frontend·backend + pm2 reload) + 실측 5건(직원 — 스크롤 70% 임계 동작 / javascript: URL 저장→무해화 / 블록 부모 A/B variant 동일 디자인 / 드래그 순서 변경·복제 / 상품 블록 가격 표시).** 상세 [[project_2026_0712_inapp_full_reinforcement]]

### 🟢 2026-07-12 (3) — 이메일마케팅 종합 검증 + 법적 준수·편집기 일괄 강화 (★배포완료 2026-07-12 — Harold 선언 / 실측 4건 = 직원 테스트)
> 전수 정독(라우트 1,358·CT 8종·프론트 4종 — 발송 3경로=즉시/예약 sweeper/재발송 단일 파이프라인, 여정·자동마케팅 이메일 발송 경로 없음 실측·크레딧 정합 통과) 후 Harold "전체 완벽하게 법적으로 문제없고 편집기도 문제없게 한번에 끝까지" 지시로 일괄 구현: **법 준수** ①광고 수신거부 footer 부착 판정 = 본문 단어('수신거부') 휴리스틱 폐기 → 실링크(UNSUB_URL_MARKER·/api/email/u/) 판정 + 전송자 명칭·연락처(fromEmail) 표기(§50④) ②List-Unsubscribe + One-Click(RFC 8058) 헤더(광고만 — POST /u/:token 본문 없이 호환) ③무인증 POST /webhook 410 폐기(토큰 payload 평문이라 campaign uuid 추출→이벤트 위조·타인 수신거부 조작 표면이던 SendGrid 잔재) ④직접 입력(list) 수신자 수신거부·반송·무효 제외(excludeOptedOutEmails CT 신설 — 즉시+예약 sweeper, 고객DB 밖 이메일은 통과·제외 건수 토스트 안내) ⑤**야간 가드 판정 = 이메일은 법적 예외 매체**(§50③ 단서+시행령 §61조의2)라 D-2 복제 불요 — 거짓 주석("08~21 KST")만 정정 **기능 봉합** ⑥예약 취소 신설(cancel-schedule, WHERE status='scheduled' 원자 = sweeper claim 경합 안전 + 카드 [예약 취소] 버튼·예약 시각 표시 — 취소 수단 부재였음) ⑦placeholder 가드 3중(엔진 초입[재발송 커버]+sweeper 발송 직전+재발송 제목 400) ⑧발송 엔진 초입 실패 즉시 failed(30분 정체 대기 제거) ⑨재시도 멱등(delivered 기왕 기록 스킵+sent_count 누적 유지 — 기록 실패 시 중복 1통 가능성은 발송 우선 정책 수용 판정) ⑩{{이름}} fallback('고객')+잔존 {{...}} 토큰 최종 제거 ⑪정산서 이메일 stub 거짓 success 제거(502+프론트 분기 — emailed_at 거짓 기록 차단) **편집기** ⑫렌더러가 headline/body/sub_copy_size 소비(fsPx 10~64 clamp — 죽은 크기 셀렉터 복구)+section.align 주입(hero/header/text_card)+section.accent_color 블록 단위 브랜드 재해석 ⑬EmailVisualEditor 블록 스타일 컨트롤(정렬 좌/중/우·강조색 — 렌더러 소비 타입만 노출=죽은 컨트롤 0) ⑭프리헤더 거짓 입력 제거·spamreport↔spam_report 표기 통일. Codex 적대 2라운드(gpt-5.5·xhigh — 1R 지적 4건 전부 정정 → 2R ①②④ 완결·③ 잔여=정책 수용 판정·PASS 5축[footer 3경로/필터 오제외 0/취소 경합/렌더러 회귀 0/One-Click]). 검증 BE tsc0·vitest 52파일 437(신규 고정 4)·FE tsc0·금지패턴0. DDL 없음. **잔여 = 배포(tp-push+build:safe frontend·backend+pm2 reload) + 실측 4건(광고 발송 1건 수신함 footer·헤더 확인 / 예약→취소→재발송 / 직접 입력에 수신거부 이메일 섞어 제외 확인 / 편집기 정렬·크기·강조색 미리보기 반영).** 상세 [[project_2026_0712_email_marketing_audit]]

### 🟢 2026-07-12 (2) — 모바일 DM 종합 연구 + 강화 D-1~D-4 (★배포완료 2026-07-12 — Harold 선언 / 실측 3건 = 직원 테스트)
> 전수 연구(발행·발송·뷰어·추적·이벤트 라우트 70개+토큰·추적 CT 정독 — 코어 견고 확인, 실결함 2건뿐) 후 일괄 구현: **D-1 발행비 정합** — 발행비(멱등키 dm-publish:dmId) 미납+실발송 이력(dm_recipient_tokens) 없음+크레딧제 적용 회사면 send-to-target 402 PUBLISH_FEE_REQUIRED → 프론트 CreditConfirmModal 확인 → confirmPublishFee 재요청 시 서버 인라인 확정(/publish와 동일 멱등키 — Codex 402 루프 High 지적으로 /publish 왕복 재시도 폐기 재설계). 과거 실발송 DM 소급 면제·무과금 회사 면제·판정 실패=발송 우선. 테스트 발행(무과금)·API 직행 우회 차단. **D-2 야간 광고 가드 공통화** — createDirectSendCampaign(직접발송·DM·자율발송 단일 길목) adEnabled+발송 시각(즉시/예약) KST 창(SEND_HOURS 8~21) 밖=NIGHT_AD_RESTRICTED 400 + DM 발송 모달 사전 안내. ★직접발송 야간 광고도 이제 차단(정책 변화 — 운영 공지 검토 필요). **D-3 재타겟 1클릭** — 미열람 재발송을 세그먼트 4종(미열람/열람·무반응/클릭/응모)으로 일반화(백엔드 무변경 — resendCustomerIds 재사용·자격/수신거부 서버 재적용). **D-4** 발송 추적 구매 전환 소스 라벨(매장·ERP purchases ≠ 자사몰 cdp 정직 표기). Codex 적대 2라운드(402 루프 정정→PASS: 멱등·플래그 결합·순서 정합 확인). 검증 BE/FE tsc0·vitest 433·금지패턴0. DDL 없음. **잔여 = 실측 3건(직원 테스트 — 발행비 402→확인→발송 / 야간 광고 400 / 세그먼트 재발송).** 상세 [[project_2026_0712_dm_reinforcement]]

### 🟢 2026-07-10 (4) — 비토 게이트웨이 API 직접연동 테스트 통과 (LMS 3건 왕복 완주)
> HANJULLO-API-TEST 계정으로 /account 인증→LMS 3건(01052958517·01030635257·01055775868) 접수→DONE+실수신 확인. lms_mms route·발신번호(1800-8125)·결과 회수 검증 완료(SMS 라인 미연결이라 LMS만 — 원래 핵심 검증 축). **다음 = 한줄로 발송 경로 DB큐(SMSQ_SEND_13)→API 전환 검토**(발송 파이프라인 절대 보호 대상 — 설계 검토부터). 상세 [[project_2026_0710_bito_api_direct_test]].

### 🟡 진행중 — 레거시 PAY 사이트 한줄로 흡수 (Track D, ★원격 접속 로직 검증완료(established 수정·139 실접속 OPEN) — 강문희 발송서버 실 공인 IP 회신 대기)
> 서팀장 2차 회신 전부 반영. **수신 DB 구축완료(2026-07-07)**: invito `pay-ingest-db`(MariaDB 10.11, --sql-mode="") — 143 dump 3테이블 82MB 복원(934,232/730/7,026 일치)·SysId 백필(B/C/D=54/57/58)·계정(sales×3 IP host·root@% 제거)·방화벽 systemd `pay-ingest-fw`. **★2026-07-09 원격 접속 사고 근본해결**: 강문희 실측 54/57/58→62:23388 접속 불가(^C). 재점검 결과 근본 = **DOCKER-USER에 리턴(ESTABLISHED) 허용 룰 누락** → SYN은 ACCEPT 통과해도 DB 응답(SYN-ACK)이 `0.0.0.0/0 DROP`에 걸려 **어떤 IP도 접속 불가**(로컬 127.0.0.1은 FORWARD 미경유 OPEN 착시·tcpdump SYN-ACK 0 확인). 비토 게이트웨이(139.150.81.213) 화이트리스트+established 추가로 **동일 환경 실측→OPEN 확인**, systemd에 established+139 영속화. 부수 발견: "서버명 옥텟=공인 IP" 추정 폐기(우리 게이트웨이도 이름≠실 IP 139). **다음 = 강문희 발송서버 실 아웃바운드 공인 IP 회신 → 계정 host+iptables 반영 → 발주 → 전환일 → 유입 검증(§7-4) → Phase 2.** 강문희 정정 메일(established 수정·실접속 확인·실 IP 요청) 발송 대기. SoT=[docs/레거시서버_폐기_플랜.md](docs/레거시서버_폐기_플랜.md) · 런북=[docs/2026-07-07-pay-absorption-track-d-design.md](docs/2026-07-07-pay-absorption-track-d-design.md) §7. 교훈=[[feedback_verify_in_same_env_before_external_request]].

### 🔵 다음 세션 (예정)
> ⓪ **비토 API 발송 경로 전환 검토(선택 후보 — 확정 과제 아님)** — LMS 왕복 테스트 통과로 개시 가능 상태. 한줄로 발송을 DB큐(SMSQ_SEND_13)→게이트웨이 API로 전환할지 설계 검토(발송 파이프라인 절대 보호 — 영향표부터). [[project_2026_0710_bito_api_direct_test]].
> ⓪-2 싱크에이전트 1.6.1 = **업로드·릴리즈 등록 완료(2026-07-10 Harold) — 종결.** 이새 박스(1.5.7)는 updater 자기교체 결함으로 **원격 자동 업데이트 불가(현장 재설치 필요)** → 그대로 두고 **2달 뒤 타 업체 ERP 전환 때 새 에이전트(1.6.1+)로 신규 배포**(Harold 확정 2026-07-10). 그때까지 1.5.7 유지가 정상 상태(슈퍼관리자 매핑 모달=구버전 안내·저장 차단 동작).
> ① **누적 0707 배포** — tp-push + build:safe(frontend·company-frontend·backend) + pm2 reload + Codex /codex:review(플러그인 미로드분). ② **PAY Track D** — 강문희 발주 → 전환 → 유입 검증 → Phase 2 설계(조회+정산+거래내역서 웹/Agent 구분 일괄). ③ **템플릿관리자 흡수(Track B+C)** = 레거시 폐기 최대 잔여 — ★2026-07-10 방향 정리: 이관 = 레거시 DB 복사 X, **senderKey 연결 + IMC 원본 pull**(개발 실체 = 슈퍼관리자 import 2종 신설·같은 IMC 계정 개연성 4,849 실측 근거·재검수 쟁점은 같은 계정 확정 시 소멸). **서팀장 사전 체크 12문항 회신 대기(폐기플랜 §4-3)** → 회신 후 재토의 → 아난티 getSender 실측 → import 2종 설계. 강문희 질의는 그 후 잔여분만.
> (보류) 팝폰 SDK 검증(자체 서비스 SDK 실측 베드) = C:\Users\ceo\projects\poppon-workspace 정독 후 별도. 상세 [[project_2026_0618_selfhosted_mall_app_collection]].

---

### 최근 완료 인덱스 (원문 = 링크의 월별 아카이브)

- 🟢 2026-07-12 — 자동마케팅 종합 강화 C-1~C-5 (★배포완료·DDL 완료, 회전 2026-07-12 / 잔여=실측 5건 직원) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0712_automarketing_full_reinforcement]]
- 🟢 2026-07-11 (2) — 여정 전수점검 일괄 강화 9건 (★배포완료 0db38480·DDL 6건 적용, 회전 2026-07-12 / 잔여=실측 5건 직원) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0711_journey_full_reinforcement]]
- 🟢 2026-07-11 — 직원 디버깅 2건 + AI Operator 소개 페이지 11장 개편 (★배포완료 ece2f4a8, 회전 2026-07-12) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0710_staff_debug2_intro_page]]
- 🟢 2026-07-10(2) — 발송 대상 [타겟확인] 자동마케팅 카드+오퍼레이터 메인 (★배포완료, 회전 2026-07-12) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0710_send_target_list_three_phase]]
- 🟢 2026-07-10(5) — 직원 리포트 3건: 여정 엔터·MDM 단축 URL(hlj.kr)·DM 히어로/가격 (★배포완료, 회전 2026-07-12) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0710_staff_reports_shortlink_dm]]
- 🟢 2026-07-10(3) — 싱크에이전트 원격 관리 개편 P0~P2·v1.6.1 (★배포완료·릴리즈 등록 완료·트랙 종결, 회전 2026-07-12) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0710_sync_agent_remote_admin_audit]]
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
