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

### 🟡 2026-07-10 — 여정 "목표 달성 시 자동 종료"(전환 이탈) + 옵션 UI 2단 재편 (코드완료 / 배포 대기)
> 기원=시세이도 시연 질문("여정 중 구매한 고객이 내일 독려 문자를 또 받는 게 맞나"). **여정별 토글 goal_exit_enabled**(DDL Harold 실행·실측): executor 매 tick 최상단(전 step 유형·차감 전)에서 "진입 이후 구매"(customers.recent_purchase_date>진입일 KST ∨ cdp purchase occurred_at>진입시각 — 컬럼 타입 실측) 판정 → **execution status 'goal_met'**(성과 지표·completed_at 동반) 종료. 판정 오류=통과(여정 불중단). status 축 소비처 전수 grep: 재진입 워커=completed 동급 포함(auto-reentry 구멍 차단)·EXECUTION_STATUSES 화이트리스트·stats goalMet·safety-filter=entered_at 기준이라 무영향·완주 통지=completed 유지(의도). 옵션 경로: validator+PATCH(**active 중 goalExitEnabled만 변경 허용** — 일시정지 3단계 불편 제거)+create 체인 관통+listJourneys goal_met_count 서브쿼리. UI: JourneyOptionsEditor 2단 재편(상단 목표 토글 즉시저장+하단 고급 접기)·AI 생성 검토=구매 독려형(repeat/cart/dormant) 기본 켜짐 제안·활성화 모달 on/off 뱃지·카드 "목표 달성 N" 뱃지·통계/상세 지표+필터+라벨. **Codex 적대 리뷰 5건 정정**(P1 날짜 경계 `>=`→`>` — 구매 트리거 여정 첫 tick 전원 이탈 차단 / 재진입 쿨다운0 goal_met 제외 / 실행목록 endpoint 자체 화이트리스트 2곳 goal_met / 토글 stale=상세 캐시 force 갱신+prop 재동기화 / 상세 overview 목표 카드). 검증 BE/FE tsc0·vitest399·verify15·금지패턴0. 설계 SoT=[docs/superpowers/specs/2026-07-10-journey-goal-exit-design.md](../docs/superpowers/specs/2026-07-10-journey-goal-exit-design.md) · [[project_2026_0710_journey_goal_exit]]. (별도 과제 제안: JourneysPage 3,113줄 분리 리팩토링)

### 🟢 2026-07-09 (8) — CRM 캠페인 대행 접수 웹 폼 전환 + 이미지 자동 입력 (★배포완료 2026-07-10 — Harold build·pm2 실행 / 운영 실측 = Harold)
> Harold 지시: "엑셀 다운로드·업로드는 잘못된 접수 방식" → **웹 폼(풀화면급 모달) + 행사 이미지 ≤5장(장당 5MB·jpg/png/webp)** 접수로 전면 교체. 고객사 CampaignAgencyPage 재작성(CTA→폼 모달→이력 상세 모달·갤러리) + 슈퍼관리자 AdminCampaignAgencyPage 재작성(상태 칩·목록→상세 모달: 갤러리·라이트박스·보정 폼·[분석 실행]·PDF / 직접 설계도 폼화) + 공용 AgencyRequestForm(다크/화이트 테마). backend: /template 삭제·폼 접수(payload+images multipart·매직바이트 sniffImageMediaType·INSERT 실패 시 전 이미지 unlink)·이미지 인증 스트림 4 endpoint·**분석 축4 = 행사 이미지 vision 전사(기존 event-image-extract CT 재사용·무과금 번들)**·혜택 출구가드에 전사 허용 텍스트 추가·PDF 재디자인(표지 밴드·플랜 스트립·이미지 임베드 jpeg/png·페이지 번호 bufferPages). **DDL 2건 Harold 실행완료**(image_paths jsonb ADD·request_file_path DROP NOT NULL — information_schema 실측). crm-agency-template.ts+왕복 테스트 삭제·**exceljs 의존성 제거**(소비처 1곳 grep 실증, 서버 npm install 권장). legacy xlsx 행 보존(파일 있는 행만 다운로드 노출). **+이미지 자동 입력(Harold 추가 승인)**: 폼 이미지 섹션 최상단 이동 + [AI로 자동 입력] 1클릭 = 구조화 전사(analyze-images 2 endpoint·무과금·저장 없음) → 빈 필드만 채움·상품 추가·날짜 ISO 가드. **Codex 적대 리뷰 2차 3건 정정**(혜택 가드 %/원 단위 스왑 차단·저장 mime 폴백 제거·이미지 부분 저장 시 정리). 검증 FE/BE tsc0·vitest399·금지패턴0·잔존참조0. 상세 [docs/2026-07-09-crm-campaign-agency-implementation.md](../docs/2026-07-09-crm-campaign-agency-implementation.md) · [[project_2026_0709_crm_agency_webform_redesign]].

### 🟢 2026-07-09 (7) — 요금제 정책 정비 + AI 사용량 메뉴 이동 + Brand Voice 초기화/저장 (★배포완료 2026-07-09 — Harold 선언 / 운영 실측 = Harold)
> ① **발송결과 캘린더 FREE 개방**(ResultsModal): customerDbEnabled===false 차단 제거 — 미가입도 캘린더 진입(구독 만료/정지 잠금만 유지). ② **요금제 게이팅 감사**: 진실 원천=plans 플래그(코드 아님). 유료 간 차별 4플래그(ai_premium·mobile_dm·auto_spam_test·cdp)+STARTER ai_calls=0(AI 전멸) → **plans UPDATE 4줄 Harold 실행완료**(유료 전 플랜 기능 통일·크레딧이 통제). ③ **BETA_GATE 문구 24곳 정정**: 실제 게이트=유료 전체 개방(FREE만 차단)인데 문구가 "비즈니스·엔터프라이즈 전용"(오도) → "본 기능은 요금제 가입 후 이용 가능합니다"(ai.ts 22+프론트 2). 카카오&RCS ENT 게이트=**의도 유지**(출시 마무리 중·내부 테스트). ④ **AI 사용량 헤더 메뉴 제거→AI 학습 메모리 상단 서브메뉴**(미가입 다수 헤더서 퇴출). ⑤ **Brand Voice 가이드라인 모달 초기화·저장 버튼**: 초기화=AI 가이드라인 1행만 삭제(대표문안 유지→재추출 가능, DELETE /brand-voice/guideline 신설·회사관리자·잔존0 검증)+저장=편집분 반영. 검증 FE/BE tsc0. 상세 [[project_2026_0709_plan_gating_audit]].

### 🟢 2026-07-09 (6) — CRM 캠페인 대행 신설 (비즈니스+ 전용 컨설팅 상품 — ★배포완료 2026-07-09 — Harold 선언 / 운영 실측 = Harold)
> Harold 신사업: 고객사 캠페인대행요청서(xlsx) 접수→슈퍼관리자 "캠페인 대행 설계"에서 **그 업체 단일 스코프**(프로필·AI메모리·캠페인이력) 분석→"한줄로 마케팅 제안서" PDF→오프라인 컨펌→직원 예약 대행(운영). **무과금**(runInCreditBundle). 신규: CT 5(crm-agency-request/template/proposal-core/proposal/pdf-render)+routes/campaign-agency+고객사·슈퍼관리자 페이지+메뉴 게이팅. 혜택=요청서 기입값만(출구가드)·타겟=recommendTarget+countFilteredCustomers 실측·503 DDL 안전망. **Codex 적대 리뷰 5건 실증 후 정정**(고아파일 unlink·자격=isSubscriptionBlocked·design 재검증·xlsx 매직바이트·빈 필터). **요청서 양식 exceljs 재작성**(옛 SheetJS 서식 미지원→맨 텍스트 사고, 양식↔파서 왕복 테스트). DDL·배포 완료. **exceljs 신규 의존성**(배포 시 npm install). 검증 tsc0·vitest396·금지패턴0. **구현 상세 문서=docs/2026-07-09-crm-campaign-agency-implementation.md** · SoT=specs/2026-07-09-crm-campaign-agency-design.md · [[project_2026_0709_crm_campaign_agency]].

### 🟢 2026-07-09 (5) — 자동마케팅 디버깅 3건: 노출범위+발송권한 소유자기준 · 오늘의 추천 문안3안 선택+편집 · 담당자 사전알림 발신번호 대표번호 (★배포완료 2026-07-09 — Harold 선언 / 운영 실측 = Harold)
> **① 노출범위+권한**(임은지): listOperators/listProposals에 소유자 scope(비관리자=`created_by` 본인·관리자=전체) + run-now/approve/reject 게이트를 `userType!=='company_admin'` 하드차단→"관리자 OR operator.created_by===userId"(approve/reject는 proposal→operator JOIN 소유검증). 생성/수정/삭제는 이미 2026-06-19 사용자 허용이라 발송·실행만 막히던 비대칭 해소. 요금제·예산·080·스팸 안전망 불변. 프론트 무변경.
> **② 문안3안 선택+편집**(임은지): ProposalDecisionCard 3안 클릭 선택("발송 선택됨")+문안 편집 textarea. approve payload{variantIndex,body,subject}→proposal_json.userSelection 병합(jsonb_set)→dispatchProposalSend가 userSelection 우선(없으면 Bandit=자동 스케줄 무변경). 편집 본문>90byte SMS는 LMS 자동승격. 옛 UI가 "고른 변형으로 발송" 표기했으나 선택 UI 부재=거짓 표기였음. DDL 없음.
> **③ 사전알림 발신번호**(남지현+임은지): notifyOperatorAdmins call_back을 수신자 본인 번호→한줄로 대표번호(`getPlatformNoticeCallback`=SYSTEM_SMS_CALLBACK||18008125, sms-queue CT 신설). 발신=수신 동일→번호도용차단 가입 담당자 미수신이 근본. 단일 길목이라 사전알림·추천·승인대기·정지·D-2·보류 전건 해결. 동일 결함 journey-pretest-notifier(여정 2h전) 동시 수정. system-alert(내부) 범위 밖 유지.
> 검증 backend tsc0·frontend tsc0·vitest382·금지패턴0·DDL없음. **Codex 리뷰 완료(CLI 0.121→0.143 업그레이드 후)**: P3(미조작 승인이 변형A 강제=Bandit 우회) fix — 선택/편집 시에만 selection 전송(ProposalDecisionCard) / P2(편집 문안 스팸 재검증)=수정 불요 판정(직접발송 정합 — 사용자 작성 문안 동급·(광고)/080/placeholder 가드는 파이프라인 적용). 잔여=P3 fix 재배포+운영 실측. 상세 [[project_2026_0709_automarketing_scope_permission_variant_notice]].

### 🟢 2026-07-09 (2~4) — AI Operator MMS + 모바일 DM 신고 4건 + 여정 전환오류 + 하드코딩 뒤로가기 전수 (★배포완료 2026-07-09 — Harold 선언 / 운영 실측 = Harold)
> **① AI Operator MMS**(임은지): 추천 채널 MMS 유형변경(SMS/LMS/MMS 세그먼트+AI배지)+이미지 첨부 모달+비용 실단가 재계산(companies/settings) / 직접발송 MmsUploadModal 다크 재디자인(createPortal·z-[2000]·onConfirm 일반화) / MMS업로드 `hooks/useMmsUpload` 공용화(Dashboard 인라인 이관). handleApprove에 mmsImagePaths+MMS0장/SMS90byte 사전차단. backend 무수정·DDL없음.
> **② 모바일 DM 신고 4건**(임은지): A 즉시쿠폰·쿠폰 사용조건 줄바꿈 pre-wrap(캔버스+SSR) / B 구도(treatment) 캔버스 미러 4섹션(hero5·coupon3·textcard3·cta3, 신규 `utils/dm-treatment.ts`+SectionRenderer 전달, split=상단 --dm-primary 블록, classic 골든보존) / C 카운트다운 배경색·글씨색(CountdownProps+Editor+canvas+SSR, DM JSON prop·DDL없음) / D 헤더 줄바꿈=코드 이미 라이브(Ctrl+F5 재확인).
> **③ 여정 페이지 전환오류**(남지현): JourneyStats 뒤로가기가 `navigate('/ai-journeys/:id')`(여정상세) 하드코딩→stats↔상세 루프 → `goBackOr` 수정.
> **④ 하드코딩 뒤로가기 전수 감사**(Harold): 동일 패턴 9곳(JourneyStats+MarketingCalendar·Performance·Predictive·Push·Voice·QuickCampaign·JourneysPage·ContinuousOperator) → goBackOr 통일. 대시보드/메인 종료·정방향 이동은 관례상 유지. B(라벨맵=0709단일화완료)·C(임의상수0)·E(회사ID·전화 env fallback·라인 config) 추가위반 없음.
> 검증 frontend tsc0·backend tsc0·금지패턴0·DDL없음. 별건 isae 생일자 문의(3883vs3550)=3계층 실측 우리결백 종결(원인 isae Oracle 생일 미전송). 상세 [[project_2026_0709_ai_operator_mms_channel_change]]·[[project_2026_0709_mobile_dm_canvas_ssr_mirror]]·[[project_2026_0709_hardcoding_audit]]·[[reference_isae_sync_birthday_reconciliation]].

### 🟢 2026-07-09 — 직접시점선택 모달화 + 추출타겟 리스트 공용화 + DM 정렬 전수 일관화 + 개인화 변수 단일소스 통일 (★배포완료 — Harold 선언 / 운영 실측 = Harold)
> ① 직접시점선택 공용 DateTimeField 모달화(6곳 반영·z-[2000]) ② 추출타겟 공용 모달 TargetRecipientsModal(신규 엔드포인트 targets/recipients·ai/target-recipients, SELECT·DDL없음) ③ DM 섹션 정렬 전수 일관화(하드코딩 center 제거→래퍼 text-align 상속/`--dm-section-justify`, 헤더 로고형 column+align-items, front canvas+백엔드 SSR 미러) ④ 개인화 변수 발송빈칸 근본수정(FIELD_MAP 밖 하드코딩 라벨 3중→displayName 단일소스+`applyFieldDisplayNames`).
> 검증 frontend/backend tsc0·vitest382·DDL없음. 잔여=Harold 실측·Codex. 상세 [[project_2026_0709_datetime_target_dm_var_unify]].

---

### 🟢 2026-07-07(9) — 뱃지 라벨 3단 정책 정리 (Harold 확정 / 코드완료·tsc 0 / 미배포)
> BETA 남발 정리: 정가 과금 코어=무라벨 / 갓 출시=NEW(4~6주 유효기간) / 실험만="실험실". frontend 20파일 — 코어 BETA 뱃지 22곳 제거(대시보드·AI Operator 허브+하위 카드·자동마케팅·캘린더·DM·이메일·인앱·성과·세그먼트·CDP·온보딩·AI 캠페인 모달 3종·메모리·사용이력) + "AI Operator 소개" NEW 만료 제거 + 실험 5종(예측·푸시·음성·Batch·설명) "실험실" 전환. backend BETA_GATE 문구 21곳 "엔터프라이즈 베타 운영 중"→"비즈니스·엔터프라이즈 요금제 전용"(코드값 BETA_GATE는 불변 — FE 분기 사용). 유지=카카오&RCS 베타테스트 안내(실검증 중 사실)·슈퍼관리자 내부 3곳. CLAUDE.md 디자인 룰 "BETA badge 의무" 폐지 갱신(재발 차단). 배포 = frontend+backend build:safe + pm2 reload.

### 🟢 2026-07-07 — 알림톡 강조표기형 3관문 종결 (7300 대표링크 · 9999 senderkey · 3027 버튼) ★배포완료(716074dc)·전체 발송 정상
> 커밋 716074dc 배포(한줄로 SENDER_KEY 비토 라인 한정 주입·CT-04 insertAlimtalkQueue 단일 길목) → 79738 대표링크 Gateway report_code 0000. 버튼형 3027은 자비스가 Gateway 버튼 변환(btnJson→IMC attachment.button) 정정 → Harold "전체 발송 잘된다" 확인. 원문·전 과정 = [archive/BUGS_RESOLVED.md](archive/BUGS_RESOLVED.md) 최상단 · [[project_2026_0707_bito_agent_7300_senderkey]]. 잔여 별건 = 진단로그 [ALIMTALK-DEBUG2] 제거.

### 🟡 진행중 — 레거시 PAY 사이트 한줄로 흡수 (Track D, ★원격 접속 로직 검증완료(established 수정·139 실접속 OPEN) — 강문희 발송서버 실 공인 IP 회신 대기)
> 서팀장 2차 회신 전부 반영. **수신 DB 구축완료(2026-07-07)**: invito `pay-ingest-db`(MariaDB 10.11, --sql-mode="") — 143 dump 3테이블 82MB 복원(934,232/730/7,026 일치)·SysId 백필(B/C/D=54/57/58)·계정(sales×3 IP host·root@% 제거)·방화벽 systemd `pay-ingest-fw`. **★2026-07-09 원격 접속 사고 근본해결**: 강문희 실측 54/57/58→62:23388 접속 불가(^C). 재점검 결과 근본 = **DOCKER-USER에 리턴(ESTABLISHED) 허용 룰 누락** → SYN은 ACCEPT 통과해도 DB 응답(SYN-ACK)이 `0.0.0.0/0 DROP`에 걸려 **어떤 IP도 접속 불가**(로컬 127.0.0.1은 FORWARD 미경유 OPEN 착시·tcpdump SYN-ACK 0 확인). 비토 게이트웨이(139.150.81.213) 화이트리스트+established 추가로 **동일 환경 실측→OPEN 확인**, systemd에 established+139 영속화. 부수 발견: "서버명 옥텟=공인 IP" 추정 폐기(우리 게이트웨이도 이름≠실 IP 139). **다음 = 강문희 발송서버 실 아웃바운드 공인 IP 회신 → 계정 host+iptables 반영 → 발주 → 전환일 → 유입 검증(§7-4) → Phase 2.** 강문희 정정 메일(established 수정·실접속 확인·실 IP 요청) 발송 대기. SoT=[docs/레거시서버_폐기_플랜.md](docs/레거시서버_폐기_플랜.md) · 런북=[docs/2026-07-07-pay-absorption-track-d-design.md](docs/2026-07-07-pay-absorption-track-d-design.md) §7. 교훈=[[feedback_verify_in_same_env_before_external_request]].

### 🔵 다음 세션 (예정)
> ① **누적 0707 배포** — tp-push + build:safe(frontend·company-frontend·backend) + pm2 reload + Codex /codex:review(플러그인 미로드분). ② **PAY Track D** — 강문희 발주 → 전환 → 유입 검증 → Phase 2 설계(조회+정산+거래내역서 웹/Agent 구분 일괄). ③ **템플릿관리자 흡수(Track B+C)** = 레거시 폐기 최대 잔여 — 0705 이관 핸드오프 정독 + 발신프로필키 축(§5-③) 재검수 여부 카카오 검수팀 확인부터.
> (보류) 팝폰 SDK 검증(자체 서비스 SDK 실측 베드) = C:\Users\ceo\projects\poppon-workspace 정독 후 별도. 상세 [[project_2026_0618_selfhosted_mall_app_collection]].

---

### 최근 완료 인덱스 (원문 = 링크의 월별 아카이브)

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
- [ ] sync_releases에 v1.6.1 릴리스 레코드 등록 (updater 자기교체 fix 안정판 — 1.6.0 win-legacy 등록 금지, TASKS 2026-07-03 참조)

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
