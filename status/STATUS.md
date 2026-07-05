# 한줄로 — 관제탑 (STATUS)

> **상시 로드 문서. 30KB 상한.** 룰의 원천은 CLAUDE.md — 이 문서는 "현재 상태"와 "라우팅"만 담는다.
> 재설계 전 전체 원본 백업: `status/_backup-20260703-관제탑재설계전/` (2026-07-03 관제탑 재설계 v2)
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
| 버그 수정 | BUGS.md | 해당 버그 항목 (해결분은 archive/BUGS_RESOLVED.md) |
| 과거 작업 조회·회귀 의심 | archive/INDEX.md → TASKS_YYYY-MM.md | grep 적중 항목만 |
| 의사결정 배경 확인 | DECISIONS.md | 해당 ADR |
| 리스크 전체 확인 | RISKS.md | 전체 |
| 싱크에이전트 이슈 진단 | SYNC-AGENT-TROUBLESHOOTING.md | 해당 증상 절 |
| 싱크에이전트 isae 현장 | SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md | 전체 |
| AI Operator·CDP·Provider | docs/AI_OPERATOR_기능정의서.md + ai_operator_progress.md | 해당 절 |
| 레거시 서버(27.102.203.143) 폐기 | docs/레거시서버_폐기_플랜.md | 전체 (SoT — 진행 시 갱신) |
| 인앱메시지 설계 | docs/인앱메세지전용.md | 해당 절 |
| 장기 로드맵·비전 | docs/한줄로_BEYOND_BRAZE_비전.md | 해당 절 |
| 옛 설계서·핸드오프·디버그노트 | archive/DESIGNS/ (archive/INDEX.md 경유) | grep 적중 문서만 |

---

## 2) CURRENT_TASK (활성 작업만)

> **회전 룰:** 완료(★배포완료) 엔트리는 원문을 archive/TASKS_YYYY-MM.md로 이동 + INDEX 등재하고, 아래 "최근 완료 인덱스"에 1줄만 남긴다. 30KB 초과 = 회전 미이행 — 즉시 회전.

### 🟢 2026-07-05 (2) — 여정 재점검: 3버그 + 발송 피로도 보호 + 계절감 제거 (전부 ★배포완료) — 상세 [[project_2026_0705_journey_reinforcement]]
> **① 여정 3버그 (a903f880)**: 네비 "대시보드로 돌아가기" goBackOr→`navigate('/dashboard')`(최상위 이탈, 부모복귀 13곳 유지) / (광고)이중부착=생성·refine·대화형수정 stripAdParts 순수화 + dedup 반각·전각 정규화 `/^\s*[(（]\s*광고\s*[)）]/` 전수(messageUtils·formatDate·프리뷰3·email·spam-filter) / 매장번호 `callback_mode='store'` 미등록 자동실패(callback-filter `isCallbackRegistered`/`getRegisteredCallbackSet` 추출·미차감·여정계속) + /activate `callbackConfirmRequired` 활성화 모달 경고.
> **② 발송 피로도 보호 (83b85674+DDL)**: 회사 opt-in "N일 광고 M건" 전역 게이트(캠페인·여정·자동마케팅·직접발송 5경로 차감 이전). `fatigue-guard(-core).ts`+`send_fatigue_daily`(company+phone+day KST)+`companies.fatigue_cap_days/max`(42P01/42703 폴백=비활성). Settings 체크박스+프리셋. 광고성만·정보성/수동/시스템 제외. → LESSONS_BACKEND.
> **③ 계절감 제거**: 여정=상시발송이라 계절 박제 금지 — journey-ai-generator 시즌주입 3지점+SEASON_BY_MONTH 삭제→시간불문 감성·few-shot 재작성, editor 동일. 목표문 명시 시만 반영. 즉시발송(캠페인/자동/DM/인앱) 유지. 기존 초안=AI 다시생성.
> **로드맵·잔여**: 여정 보완 ②~⑦(목표 즉시이탈·분기·홀드아웃·wait-until-event·채널폴백·STO) 미착수(UI 안 복잡·신규페이지0 원칙) / daily_limit·duplicate_prevention_days=死설정 후속 / 매뉴얼 stale 미수정 / 아임웹 심사대기.

---

### 🟢 2026-07-05 — 자동마케팅 4수정(배포완료) + 비토 Agent v1.0.8/MMS + 레거시 템플릿 이관 조사
> **① 자동마케팅 전수점검 4수정 (★배포완료, 커밋 38c06ea8)**: 발송 상한(LIMIT 10000) 제거 = 서버사이드 staging INSERT(operator-recipients `buildSendableStagingInsertSql`·customer-send-stats `recordCustomerSendsByFilter`, 상한 없음) / 크레딧 차감 유실 차단('sent' 전환을 차감 성공에 종속→reconcile 재차감) / approve 라우트 `isAiOperatorAllowed` 게이트 / non-ad→광고 라벨. 통제선=고객 예산·선불 잔액(우리 강제상한 0). tsc0·순수17.
> **② 비토 Agent v1.0.8 MMS (Agent 배포완료·Gateway v135 대기)**: 라인13 MMS 이미지 누락 진단(앱 정상, Agent가 파일 미독) → 조언문서 → 자비스 당일 v135/v1.0.8. Agent v1.0.5→1.0.7→1.0.8 교체 + `mms:` config. **Gateway v135(139.150.81.213) 반영 + E2E 미실측 대기**. OPS.md §6-2 갱신. 상세 [[project_2026_0705_bito_agent_v108_mms]].
> **③ 레거시 카카오 템플릿 이관 조사·핸드오프 (서팀장 회의 대기)**: event-admin(4519 템플릿) → 한줄로. 확정19/신규34/A-B(IMC 계정) 미확정. SoT=docs/2026-07-05-legacy-template-migration-handoff.md. 상세 [[project_2026_0705_legacy_template_migration]].

---

### 🟢 2026-07-04 (2) — 모달/토스트 UX + 베스트 문안 재설계·진화 + 발송결과 집계 근본수정 + 스크롤 복원 + 직접발송 정리
> **① 모달 배경클릭 닫힘 전면 제거 (★배포완료)**: 전 모달(frontend 약60 + company-frontend 2)에서 오버레이 백드롭 닫힘(onClick/onMouseDown/currentTarget) 제거 — X·취소·ESC만. `ModalBase closeOnBackdrop` 기본 false. 드롭다운/캔버스/이미지라이트박스 판별 제외, 잔존 0 재grep.
> **② 크레딧·피드백 토스트 z-index (★배포완료)**: `credit:used` 토스트(ToastProvider) + 로컬 코너 토스트 13곳을 z-[10000]로 상향(모달 z-[9999] 위, 세션만료 99999만 최상위). 모달 뒤로 깔려 안 보이던 문제 해소.
> **③ 베스트 문안 재설계 (코드완료·tsc0·vitest·미배포)**: 학습(ceo전용) 분리 → 슈퍼관리자 공용 '베스트 문안' 메뉴(`/admin/best-copy`). 휴리스틱 채굴(최근300·정보성 기본값→예약안내 오뽑) 폐기 → AI 전수 채굴(`best-copy-miner`, 전건 배치판정·is_ad 라벨 불신) + 직원 직접 입력(핸드폰 목업 좌액정/우기능). `gateSeedText` 단일 저장 게이트. 상세 [[project_2026_0704_best_copy_curation_evolution]].
> **④ 학습 루프 진화 (코드완료·미배포·★DB 대기)**: 시드 성과 환류(best_copy_seed_usage) + 업종 승리공식 증류(best_copy_assets·`industry-formula`) + 사용자 스타일 갤러리(원문의 벽·jaccard 가드·`/api/ai/style-gallery`) + Tier1 반응신호(`ai_training_logs.click_count/conversion_count` — DM·이메일 클릭 환류 + 랭커/검색기 클릭 우선 정렬) + 회사 메모리→문안 생성 주입(composeCopyBrain) + 거부 제안 '피할것' 증류. SoT=specs/2026-07-04-best-copy-evolution-design.md.
> **⑤ 발송결과 집계 근본수정 (코드완료·tsc0·테스트·미배포)**: 라인13 비토 게이트웨이(SMSQ_SEND_13) 요약 성공 0 = LIVE 대기전용 집계 + LOG(_YYYYMM) 미생성(제자리 status 갱신)이 겹친 구조 결함(상세는 raw라 정상). `classifyResultTables`(sms-table-split CT) — "LOG 짝 없는 LIVE는 결과까지 집계"(이중카운트 구조적 불가). `smsCampaignCountsSafe`+엑셀 집계 통일(요약·6h워커·정산환불·라이프사이클 5소비처 자동 정합). 실데이터 확정 후 수정. → LESSONS_BACKEND.
> **⑥ 스크롤 복원 전역 통일 (코드완료·tsc0·미배포)**: BrowserRouter(비-데이터 라우터)라 직접 구현 — `ScrollManager`(POP=이전 위치 복원 / PUSH=top, 6/28 '메뉴=최상단' 유지) + 뒤로가기 버튼 14곳 `goBackOr(navigate, fallback)`(앱 히스토리 있으면 navigate(-1)=POP). 옛 `ScrollToTop` 폐기. [[feedback_scroll_restoration_convention]]. → LESSONS_FRONTEND.
> **⑦ 직접발송 정리 (코드완료·tsc0·미배포)**: 브랜드링크(BrandLinkChips) 직접발송에서만 제거(유료 3곳=브랜드보이스·직접타겟발송·에디터 유지) + 스팸필터·AI다듬기 미가입 게이팅을 표준 `PlanUpgradeModal`로 통일(구식 SpamFilterLockModal·AiRefineLockedModal 삭제).
> **잔여**: ③④⑤⑥⑦ tp-push + frontend `build:safe` / backend(③④⑤) `pm2 restart all` / **★서버 psql 2세트: best_copy_seed_usage·best_copy_assets(CREATE) + ai_training_logs.click_count·conversion_count(ADD)** — 코드 42P01/42703 폴백이라 순서 자유(SCHEMA.md 등재). 배포 후 실측(라인13 요약 성공 3·베스트문안 채굴→승인 E2E·스크롤 뒤로가기 복원·직접발송 게이팅 모달).

---

### 🟢 2026-07-03 — 관제탑 재설계 v2 + 사용구분 게이팅 + 전 채널 학습 루프 + 레거시 SSL 무료전환
> **① 관제탑 재설계 v2 (★완료·문서만·tp-push 대기)**: STATUS 736KB→16.7KB, 상시 로드=CLAUDE.md+STATUS.md 둘뿐(doc_routing/doc_ownership 룰 신설). 3계층 라우팅+archive/INDEX.md(증상어 177행). `scripts/harness-check.sh` 기계 검증 7종 + PostToolUse 훅 등록(.claude/settings.json, BOM 제거 완료). 백업=`status/_backup-20260703-관제탑재설계전/`. 상세 [[project_2026_0703_control_tower_redesign]].
> **② 사용구분 게이팅 (코드완료·배포 진행)**: `companies.usage_type`(web/agent/both)+`company_agent_ids` DDL 실행완료. 에이전트 전용 계정=카카오 템플릿 관리만(4경로 게이팅: 라우트 회수/랜딩/app 403/알림톡 탭). 슈퍼관리자 사용구분 UI+발송ID 매핑. 상세 [[project_2026_0703_legacy_server_decommission]].
> **③ 전 채널 학습 루프 Phase1~4 (코드완료·tsc0·테스트16/16·배포 진행)**: P1 DM(두뇌주입+발송기록+열람환류) / P2 KAKAO(insertAlimtalkQueue+브랜드 CT-12, **중복 가드 fix 재배포 필요**) / P3=Gap5 2층(cold-start 클릭횟수 반영 v1.1-cold + customer_send_stats 분모 — TS·벌크 SQL 두 벌 동일 의무) / P4 검색기 타사원문 차단. **Gap4(예측→타겟)는 영구 금지** [[feedback_prediction_never_selects_target]]. 상세 [[project_2026_0703_all_channel_learning_loop]].
> **④ 레거시 event-admin SSL 유료→무료 ZeroSSL 자동갱신 (★검증완료)**: 연 99,000원 절감. 가비아 인증서 환불 문의 잔여(2일차 미사용). 상세 [[reference_event_admin_invitobiz_cert_token]].
> **⑤ 성과리포트 고객 축(코드완료·tsc0·미배포)**: 등급×전채널 성과 표 + 수신 고객 정밀 attribution(여정·DM customer_id) + EMAIL/DM 채널 합류 + explain audience 주입 + PDF 절 2개. 신규 CT `performance-customer-axis(-core)` + endpoint `customer-axis`. 설계=docs/superpowers/specs/2026-07-03-performance-customer-axis-design.md. dm_recipient_tokens SCHEMA.md 실측 등재.
> **⑥ 카페24 공식 앱 — 심사요청 완료 ★**: 앱 등록·수신부(X-API-Key+event_no)·금액 fix(firstPositiveAmount)·gyunoo83 실주문(앞 세션) + 이번 세션 심사 완주 A~E — 앱 실행 랜딩 `/cafe24/launch`(**App URL=hanjul.ai/cafe24/launch, app.hanjul.ai 아님 — nginx hanjul.ai=frontend·app.hanjul.ai=company-frontend**) + FREE 계정 OAuth 연동 허용 + scripttags 자동삽입(cafe24-scripttag CT; **API버전 2026-03-01·src CORS는 backend `/api/cafe24/sdk/:version` 서빙·display_location ALL 수용**) + SDK `?k=` v0.3.8 + `/status` active-only fix + 판매정보/결제(무료)/고시 → 심사요청 클릭. 잔여: Privacy 권한 문의(spec §F)·page_view 몰 도메인 cdp_allowed_origins 자동허용 후속. 상세 [[project_2026_0703_cafe24_review_godo_integration]]·[[project_2026_0703_cafe24_app_store_integration]].
> **⑧ 고도몰(NHN커머스) Open API 주문 연동 — 실증 완료 ★배포완료**: partner_key(제휴사=팝폰, env `GODO_PARTNER_KEY` 세팅완료)+key(쇼핑몰별 사용자키) 둘 다 필수. gyunoo8321 사용자키로 **연결 검증(Order_Search) 통과·active**(로그 00:09 credentials/connect/status 200 — 깡통 테스트몰이라 주문 0은 정상). 연동상태 검증 fix(save=pending·verify 성공만 active+connected_at, 6원칙②) + 고도몰 카드 SDK 블록(치환코드 {=gSess.memNo} 복붙) + provider 그리드 브랜드아이콘 재디자인 배포. 고도몰=스크립트삽입 API 없어 SDK는 스킨 수동삽입. **이연(실 고객사 시 처리)**: 고도몰 SDK(행동·회원) 실측 + turnkey gap(고도몰 카드 공개키발급·수집허용도메인 UI — 미등록 시 page_view 403). 상세 [[project_2026_0703_cafe24_review_godo_integration]].
> **⑦ isae 싱크에이전트 완결 (★배포·백필 완료)**: 에이전트 1.5.7 원격 교체(서팀장 원격 1회) + custom 매핑 15/15(update_config, custom_14=최종접속일시 가설 적중) + 클린 재적재(고객 137,267/구매 1,854,706, 중복 370만 정리) + 구매이력 화면 **두 앱**(app.hanjul.ai CustomersTab·hanjul.ai/manage ManageCustomersTab 사본 2곳) + 고객목록 등록일 fix + custom 날짜 ISO 표시 정정(`formatIfIsoDate` CT) + 고객DB 현황 성능(CT-18 타입감지 조기종료+결과캐시 5분·degraded 가드+filter-options 단일스캔) + **구매요약 집계 CT**(customer-purchase-aggregates: 배치 훅 재계산, 웹훅 `revenue_applied` 이중진실 가드, NULLS LAST — 백필 126,099명 완료). **updater 자기교체 결함 = v1.6.0에서 해결**(2026-07-03, SYNC-AGENT-TROUBLESHOOTING §2-6). 상세 [[project_2026_0703_isae_157_mapping_purchase_summary]].
> **잔여**: ②③⑤ tp-push+build+pm2 재배포(KAKAO 중복 가드 포함) / 실측(KAKAO 1행·customer_send_stats·⑤ 고객등급 모달 1건 — v1.1-cold는 07-03 실측 확인 완료) / 레거시 폐기 프로젝트 = 서팀장 5문항 회신 대기(docs/레거시서버_폐기_플랜.md SoT) / updater 자기교체 v1.6.0 완료(tp-push + 서버 릴리즈 잔여 — sync_releases 등록은 1.6.1부터·isae 보호).

---

### 🟢 2026-07-03 — 싱크에이전트 updater 자기교체 근본수정 v1.6.0 (★코드·5티어빌드·티어 E2E 게이트 완료 / git push·서버 릴리즈만 잔여)
> updater 교체가 자기 job(Win)·cgroup(Linux)을 자살시켜 무선 교체 실패(isae 실측) → Win=별도 일회성 작업(SyncAgentUpdate, job 밖)+원자 스왑(move /y), Linux=`systemd-run` transient 서비스(--scope 아님=ProtectSystem 상속 회피)+원자 mv + checksum 필수화·빈버전 가드·self-heal·restart 근본수정·old Windows→CLI 설치 라우팅. tsc 0, 유닛 60 GREEN, win-legacy 실 2008R2 VM E2E + linux Docker E2E PASS. 서버: download_url 티어 인코딩+`upload:releases`(5티어 무선). **★배포안전: 1.5.x→1.6.0 무선 불가(깨진 updater)→win-legacy active 등록 금지(isae 깨짐), 등록은 1.6.1부터. 파일 업로드는 안전(sync_releases만 트리거)**. 세션종료 상태: upload 완료 / tp-push·sync_releases 등록 미완(등록 보류) / isae 무손 1.5.7 가동. 상세 [[project_2026_0703_sync_agent_updater_selfreplace]].

### 🔵 다음 세션 (예정) — 팝폰(Poppon) SDK 검증용 코드 분석
> **목표**: 한줄로 SDK(v0.3.6)를 한줄로가 자체 운영하는 팝폰(www.poppon.co.kr)에 연동·테스트할 수 있는지 판정 + 단계 설계. 자체 서비스라 SDK 전 흐름(수집·identify·인앱) 실측 최적 베드(고객사 의존 0).
> **팝폰 현황(2026-06-18 사이트 확인)**: 딜·쿠폰 정보 중개 플랫폼(전자상거래 X — 직접 판매·장바구니·결제 없음, 구매는 외부 브랜드). 회원 로그인·마이페이지(`/me`) 있음. Next.js SPA(`/_next`, 동적 라우팅 `/d/[id]`·`/c/[category]`). gtag/dataLayer는 노출 HTML엔 안 보임(프로덕션 확인 필요).
> **로컬 코드**: `C:\Users\ceo\projects\poppon-workspace` (별개 프로젝트 — 이번 세션 미정독, 컨텍스트 절약 위해 다음 세션에서).
> **할 일**: poppon-workspace 정독 → ① 스택·라우팅·로그인 흐름 ② SDK(v0.3.6) 삽입 지점(Next.js `<head>`·`data-hjl-key`) ③ identify 배선(로그인 시 externalId) ④ 추적할 행동(딜 조회=product_view/click·쿠폰 클릭=custom) ⑤ 인앱 메시지 테스트 가능 여부 ⑥ 연동 테스트 가능 여부 판정 + 단계. Harold 계정 실연동 전제. brainstorming→설계→동의→구현.
> 상세 [[project_2026_0618_selfhosted_mall_app_collection]].

---

### 🔴 2026-06-11 — 알림톡 강조표기형 7300 **최종 근본 확정 = 대표링크(ATTACHMENT.link) 미동봉** — 게이트웨이 매핑 추가 대기(서팀장)
> **최종 근본(휴머스온 답변+실측 5회 확정)**: 79738만 `kakao_templates.represent_link` 등록(`{"urlPc","urlMobile"}` — 정상 발송 5개 템플릿은 전부 미등록, PG 실측)인데 **발송 요청에 link 미동봉 → 카카오 템플릿 불일치 거부**. 한줄로는 represent_link를 저장만 하고 발송 경로 소비 0건(grep). 옛 가설 2개 폐기 — ① sender_code concat(부차: 가드 수정 완료, 식별코드 301170011 엔진 자동삽입) ② imc_template_status R 차단(휴머스온 정의 **S=중지/A=정상/R=발송 전 대기, 첫 발송 시 자동 A** — R은 차단 사유 아님, CT-87 R 차단은 신규 템플릿 첫 발송 영구 차단 역효과라 정정 의무).
> **운반 구간 실측(LINKTEST1~6, Harold 번호 2개)**: etcJson snake/camel link·btnJson link객체·btnJson 버튼형식(name 유/무) 전부 7300. 게이트웨이(인비토 자체, mmsr3/ngen) 로그 = **etcJson의 link가 게이트웨이까지 온전 도달** + 휴머스온 "IMC 접수에 ATTACHMENT 없음" → **막히는 지점 = 게이트웨이 엔진이 etcJson에서 title만 IMC로 옮기고 link 미전달**. 타업체 성공 사례는 전부 대표링크 없는 템플릿(etcJson title만 — 전달 모양 한줄로와 동일). deliver 전문 필드=title/btnJson/etcJson뿐(link 전용 자리 없음). btnJson 버튼형식은 button으로 변환됨(채널추가 1800 실증 — 버튼 통로 정상).
> **해법(확정·진행 대기)**: ① 서팀장 — 게이트웨이 엔진에 etcJson 안 `link` 객체 → IMC 요청 최상위 `link`(urlMobile/urlPc) 매핑 추가. ② 한줄로 — 발송 4경로에서 대표링크 템플릿이면 etcJson에 `{"title":…,"link":{"urlMobile":…,"urlPc":…}}` 합성(공통 CT, buildAlimtalkEtcJson 확장) — ① 완료 통보 후 구현+실측 1건. ③ 어제 배포완료분 정정 묶음 = CT-87 R 차단 해제(S/D만)+화면 "발송불가" 뱃지 문구+SCHEMA.md imc_template_status 주석 — Harold 동의 대기.
> **잔여**: 진단로그 `[ALIMTALK-DEBUG2]`(direct-send-processor) 제거 의무(종결 시). LINKTEST1~6 테스트 행 = SMSQ_SEND_1_202606 app_etc1 LIKE 'LINKTEST%' (정산 집계 시 제외 식별 가능). IMC v1 스펙 제약 = link 포함 시 버튼 최대 2개. 5월 79955 버튼 발송 url1_1 빈 값 92 건은 CT(convertButtonsToQTmsg) 도입 전 경로 — 현행 CT는 urlMobile 정상 처리.
> 상세=`memory/project_2026_0609_alimtalk_emphasize_etcjson_diagnosis.md`(2026-06-11 갱신)+IMC v1 스펙=Developer Portal(link 최상위 camelCase·강조형 link 허용).

---

---

### 최근 완료 인덱스 (원문 = 링크의 월별 아카이브)

- 🟢 2026-07-04 — 문안 퀄리티 엔진(cold-start, GPT 차별화·fix분 재배포 대기) + 비토 자체게이트웨이 라인13 E2E 완주 + 메모리 관제탑 정리 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)

- 🟢 2026-07-02 (6) — 자동마케팅 완성: 발송 전 흐름 스펙 + 일일 분석 엔진(오늘의 추천) + 회고·ROI·캘린더·D-2 준비 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (5) — DM 추적 근본 수리(본문 파서) + 상세 추적/버튼 단위 + AI 학습 메모리 자동 전송 + 디자인 v2 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (4) — DM·이메일 전면 정비 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (3) — 모바일DM 수신자별 추적 근본 수정: 토큰 1급 키 + 열람 깊이/섹션/클릭 + 추적 화면 격상 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (2) — 이메일 마케팅 종결: 크레딧 모델 개편 + 개인화 동적화 + 링크/쿠폰/서식/페이징 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-02 (1) — 브랜드보이스 형태 추출 강화 + 브랜드 링크 + 문안 편집기 모달 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-01 (이어서 3) — 서버 상태 점검 후 코드 수정: 42P08(시스템 sync user INSERT 타입충돌) + PG 부팅 연결 재시도 + CORS 안내 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-01 (이어서 2) — 예측 일일차감 eligibility 요금제기반 재정의 + 슈퍼관리자 화이트 모던화 + 이메일 placeholder 발송 UX → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-01 (이어서) — 비-문자 개인화+타겟추출 전체(이메일·인앱·DM) + DM 수신자별 토큰 발송/추적/편집기 + 발행 주소복사 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-07-01 — AI 모델 전환: 문안=Sonnet 5 / 오퍼레이터 정밀=Opus 4.8 + 검수 thinking·오탐차단 + 브랜드보이스 톤 강화 → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md)
- 🟢 2026-06-30 (이어서3) — 알림톡 흰글씨 fix + 싱크에이전트 페이지네이션 전면 견고화 + 자동마케팅 중복 정정 + 비-문자 개인화 설계서 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-30 (이어서2) — 여정 일반화 전체 구현 + 빌더 정정 + AI Operator fallback 근본 정정 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-30 (이어서) — 문안 퀄리티/브랜드보이스 강화 + AI Operator 정정 + 발송현황 카드 (★배포완료) + 여정 일반화 설계서 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-30 — 크레딧 모델 v2 (코드완료·검증) + 메인 대시보드 카드 + 문안 퀄리티/브랜드보이스 설계서 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-29 — 여정 자동화 재설계 + 오늘의 여정 기회(분석 엔진) + 대화형 수정 + AI Operator 소개 PPT 뷰어 + 제안화면 강화 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-28(이어서2) — 이메일 마케팅 마무리 + Phase 2-A 분석 대시보드 + 후속 UX → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-28(이어서) — 인앱 진입 재설계 + 이메일 브레이즈급 Phase 1 + AiMemory 모달화 + 버그 2건 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-28 — 문안 두뇌(7천건 RAG) 배포완료 + AI 학습/브랜드보이스 화면 밀도 개선 + 다음 설계서 2건 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-27 — 인앱 메시지 렌더 격상(블록+테마+모션) + 인앱 콘솔 슬레이트 리디자인 + 제안서 보강 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)
- 🟢 2026-06-26 — 자동마케팅 Phase 1~3 + 운영 디버깅 + 고객사 관리자 페이지 모던 리디자인 → [archive/TASKS_2026-06.md](archive/TASKS_2026-06.md)

---

## 3) 진행 예정 작업 (TODO)

### 🟡 잔여 — 직원 버그리포트 실동작 검증 (코드 수정 전체 완료)
- [ ] **8차 B8-01~B8-13: 직원 실서비스 테스트** (app.hanjul.ai)
- [ ] **9차 S9-04/S9-08: 발송결과 조회 성능 + sent_at 정확성 확인**
- [ ] **D39 세션2 실동작 검증: 필터 UI + AI 보유필드 확인**

### ✅ 완료 — 표준 필드 아키텍처 통합 (D39)
- [x] 세션 0: DDL + standard-field-map.ts 재정의 (필수17+커스텀15)
- [x] 세션 1: upload.ts + normalize.ts 입구 정상화
- [x] 세션 2: customers.ts + Dashboard.tsx + ai.ts + AiCustomSendFlow.tsx 조회+AI 정상화

### 대시보드 리팩토링 Phase 3 (추후)
- [x] 직접 타겟 설정 모달 분리 — ✅ D43-3a DirectTargetFilterModal.tsx (729줄)
- [x] 직접 타겟 발송 모달 분리 — ✅ D43-3c TargetSendModal.tsx (901줄)
- Dashboard.tsx 누적 감소: 8,039줄 → 3,910줄 (총 4,129줄 감소)

### AI 맞춤한줄 Phase 2 (발송 연결) — ✅ 구현 완료 (문서 미갱신이었음, 2026-03-05 코드 검증)
- [x] 발송 확정 → AiCustomSendFlow.tsx Step 4 onConfirmSend 콜백으로 variant+targetFilters 전달
- [x] AiCampaignSendModal 연결 → Dashboard.tsx handleAiCustomSend에서 campaignsApi.create+send 호출
- [x] 전체 플로우 코드 구현 완료 (Step4 → 모달 → 캠페인생성 → targetFilter기반 고객조회 → 개인화치환 → MySQL INSERT)
- [ ] 실서비스 통합 테스트 (실제 발송 확인) — Harold님 검증 대기

### 카카오 알림톡 템플릿 관리 (Humuson API v2.1.1)
- [ ] 고객사 관리자(app.hanjul.ai) 템플릿 CRUD + 검수 프로세스 + 발신프로필 조회 + 관리 UI
- [ ] 슈퍼관리자(sys.hanjullo.com) 고객사별 Humuson 연동 설정 (humuson_user_id, uuid)
- [ ] 서비스 사용자(hanjul.ai) 캠페인 발송 시 APR 상태 템플릿만 선택
- [ ] 기술: 백엔드 프록시 /api/kakao-templates/*, DB kakao_templates 확장, 상태 전이 규칙
- [ ] Phase 2: 이미지 업로드, 알림 수신자 관리, 발신프로필 그룹

### 080 수신거부 (✅ 나래인터넷 콜백 연동 완료 — 2026-03-05)
- [x] 콜백 엔드포인트 구현 (고객사별 080번호 자동 매칭)
- [x] 토큰 검증 제거 — Nginx IP 화이트리스트(나래 6개 IP)로 보안 대체
- [x] Nginx 080callback 경로 나래 IP 화이트리스트 적용
- [x] D43-4 양방향 동기화: opt_out_auto_sync DDL + syncCustomerOptIn 헬퍼 + 4곳 적용
- [x] D43-4 프론트: 080번호 동적 표시 + 연동테스트 버튼 (auto_sync=true 조건부)
- [x] curl 로컬 테스트 정상 확인 (서버 `1` 반환)
- [x] 나래 담당자 콜백 URL 등록 확인 완료 (2026-03-05)
- [x] 실제 080 ARS 수신거부 테스트 — 나래 IP(183.98.207.13) 콜백 수신 + 수신거부 DB 등록 정상 확인
- [x] 기존 누적 수신거부 목록 — 한줄로 이관 시 수동 처리 예정 (벌크 동기화 불필요)

### 선불 요금제 Phase 1-B~2
- [ ] Phase 1-B: KCP PG 연동 (카드결제만, 가상계좌 제외)
- [ ] Phase 2: 입금감지 API 자동화

### Sync Agent
- [x] Sync Agent 코어 완성 (비토 v1.3.0 개발 완료)
- [x] 슈퍼관리자 SyncAgent API Key 관리 UI — ✅ D60 (2026-03-08): 고객사 편집 모달 9번째 탭. API Key/Secret 조회·재발급·비활성화, use_db_sync 토글. 백엔드 3개 엔드포인트 신규.
- [ ] sync_releases에 v1.3.0 릴리스 레코드 등록 (비토 최종 빌드 후)

### 보안
- [x] 소스 보호: 우클릭/F12/개발자도구/드래그 차단 (3개 도메인 전체 적용)
- [x] 🔴 MySQL 랜섬웨어 대응 (2026-02-28, D49): 외부 차단+비밀번호 강화+권한분리+fail2ban+포트차단 — 상세 내용 D43 안건#6 참조
- [x] 프론트엔드 난독화 — ✅ D61 (2026-03-08): vite-plugin-javascript-obfuscator 적용, production 빌드 시 stringArray+base64+disableConsoleOutput. frontend+company-frontend 양쪽 적용.
- [ ] 슈퍼관리자 IP 화이트리스트 설정
- [x] 외부 자동 백업 구축 — ✅ 2026-03-05 완료: pg_dump+mysqldump → 59번 서버(58.227.193.59) SCP 전송, SSH 키 인증, crontab 매일 03:00 KST, 7일 로컬 보관. 스크립트: /home/administrator/backups/backup.sh
- [x] 웹 애플리케이션 SQL Injection 점검 — ✅ D56 테이블명 화이트리스트 + D57-C4 sendTime 파라미터화 + D59 custom_fields JSONB 키 화이트리스트(3파일) + dateFilter 파라미터화 완료 (SSRF 별도)
- [ ] SSH 키 인증 전용 전환 (비밀번호 로그인 비활성화) — 선택

### 인비토AI (메시징 특화 모델)
- [x] ai_training_logs 테이블 + training-logger.ts + campaigns.ts 연결
- [x] 이용약관에 비식별 데이터 활용 조항 추가 — 2026-07-03 제14조(데이터의 활용) 신설 + 부칙 3항(공지 후 7일 시행). TermsPage.tsx. 배포 후 서비스 공지 필요
- [ ] 데이터 충분히 축적 후 모델 학습 파이프라인 설계

---

---

## 4) 가정 목록 (ASSUMPTION LEDGER)

(아직 없음)

---

---

## 5) 활성 리스크 상위 (1줄 요약 — 전체는 RISKS.md)

- R1 타입 에러 배포 → 서버 크래시 (확률2·영향5) — 배포 전 tsc --noEmit 필수
- R2 DB 파괴적 작업 데이터 유실 (확률2·영향5) — pg_dump 백업 후 작업
- R23 Docker 재생성 시 0.0.0.0 바인딩 실수 (확률2·영향5) — 반드시 127.0.0.1 확인 (OPS.md 안전 명령)
- 그 외 등재 리스크는 전부 ✅ 해결 상태 — 상세·이력은 RISKS.md

---

## 6) 최근 결정 5건 (1줄 요약 — 전체는 DECISIONS.md)

- D49 (02-28) MySQL 랜섬웨어 긴급 대응 — 127.0.0.1 바인딩+권한 분리+fail2ban
- D48 (02-27) 수신거부 양방향 동기화 — unsubscribes=SoT
- D47 (02-27) 직접 타겟 발송 모달 분리 + 하드코딩 동적화
- D46 (02-27) 직접 타겟 설정 전면 리팩토링 — 필드 선택 사용자 위임
- D45 (02-27) AI 한줄로 3종 개선 — 개인화 파싱+미리보기+이모지 제거

---

## 7) DONE LOG

> 최근 완료는 §2 "최근 완료 인덱스"가 담당한다. 과거 DONE LOG(3월 이전 31건) 원문 = [archive/DONE_LOG_2026.md](archive/DONE_LOG_2026.md).
