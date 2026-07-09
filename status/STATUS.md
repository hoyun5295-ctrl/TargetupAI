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
| 레거시 서버(27.102.203.143) 폐기 | docs/레거시서버_폐기_플랜.md | 전체 (SoT — 진행 시 갱신) |
| 인앱메시지 설계 | docs/인앱메세지전용.md | 해당 절 |
| 장기 로드맵·비전 | docs/한줄로_BEYOND_BRAZE_비전.md | 해당 절 |
| 옛 설계서·핸드오프·디버그노트 | archive/DESIGNS/ (archive/INDEX.md 경유) | grep 적중 문서만 |

---

## 2) CURRENT_TASK (활성 작업만)

> **회전 룰:** 완료(★배포완료) 엔트리는 원문을 archive/TASKS_YYYY-MM.md로 이동 + INDEX 등재하고, 아래 "최근 완료 인덱스"에 1줄만 남긴다. 30KB 초과 = 회전 미이행 — 즉시 회전.

### 🟢 2026-07-09 (2~4) — AI Operator MMS + 모바일 DM 신고 4건 + 여정 전환오류 + 하드코딩 뒤로가기 전수 (★배포완료 2026-07-09 — Harold 선언 / 운영 실측 = Harold)
> **① AI Operator MMS**(임은지): 추천 채널 MMS 유형변경(SMS/LMS/MMS 세그먼트+AI배지)+이미지 첨부 모달+비용 실단가 재계산(companies/settings) / 직접발송 MmsUploadModal 다크 재디자인(createPortal·z-[2000]·onConfirm 일반화) / MMS업로드 `hooks/useMmsUpload` 공용화(Dashboard 인라인 이관). handleApprove에 mmsImagePaths+MMS0장/SMS90byte 사전차단. backend 무수정·DDL없음.
> **② 모바일 DM 신고 4건**(임은지): A 즉시쿠폰·쿠폰 사용조건 줄바꿈 pre-wrap(캔버스+SSR) / B 구도(treatment) 캔버스 미러 4섹션(hero5·coupon3·textcard3·cta3, 신규 `utils/dm-treatment.ts`+SectionRenderer 전달, split=상단 --dm-primary 블록, classic 골든보존) / C 카운트다운 배경색·글씨색(CountdownProps+Editor+canvas+SSR, DM JSON prop·DDL없음) / D 헤더 줄바꿈=코드 이미 라이브(Ctrl+F5 재확인).
> **③ 여정 페이지 전환오류**(남지현): JourneyStats 뒤로가기가 `navigate('/ai-journeys/:id')`(여정상세) 하드코딩→stats↔상세 루프 → `goBackOr` 수정.
> **④ 하드코딩 뒤로가기 전수 감사**(Harold): 동일 패턴 9곳(JourneyStats+MarketingCalendar·Performance·Predictive·Push·Voice·QuickCampaign·JourneysPage·ContinuousOperator) → goBackOr 통일. 대시보드/메인 종료·정방향 이동은 관례상 유지. B(라벨맵=0709단일화완료)·C(임의상수0)·E(회사ID·전화 env fallback·라인 config) 추가위반 없음.
> 검증 frontend tsc0·backend tsc0·금지패턴0·DDL없음. 별건 isae 생일자 문의(3883vs3550)=3계층 실측 우리결백 종결(원인 isae Oracle 생일 미전송). 상세 [[project_2026_0709_ai_operator_mms_channel_change]]·[[project_2026_0709_mobile_dm_canvas_ssr_mirror]]·[[project_2026_0709_hardcoding_audit]]·[[reference_isae_sync_birthday_reconciliation]].

### 🟢 2026-07-09 — 직접시점선택 모달화 + 추출타겟 리스트 공용화 + DM 정렬 전수 일관화 + 개인화 변수 단일소스 통일 (★배포완료 — Harold 선언 / 운영 실측 = Harold)
> ① 직접시점선택 공용 DateTimeField 모달화(6곳 반영·z-[2000]) ② 추출타겟 공용 모달 TargetRecipientsModal(신규 엔드포인트 targets/recipients·ai/target-recipients, SELECT·DDL없음) ③ DM 섹션 정렬 전수 일관화(하드코딩 center 제거→래퍼 text-align 상속/`--dm-section-justify`, 헤더 로고형 column+align-items, front canvas+백엔드 SSR 미러) ④ 개인화 변수 발송빈칸 근본수정(FIELD_MAP 밖 하드코딩 라벨 3중→displayName 단일소스+`applyFieldDisplayNames`).
> 검증 frontend/backend tsc0·vitest382·DDL없음. 잔여=Harold 실측·Codex. 상세 [[project_2026_0709_datetime_target_dm_var_unify]].

### 🟢 2026-07-08(3) — AI Operator 0건 크레딧 미차감 + 직원 디버깅 4건 근본수정 (★배포완료 — Harold 선언 / 운영 실측 = Harold)
> **① AI Operator 0건 크레딧 미차감**: orchestrate/orchestrateWithAI가 impl 성공 후 0건 여부 무관 무조건 5크레딧 차감 → 문안 생성 시(`result.messages.length>0`)만 차감 게이트(ai-orchestrator.ts 326·618, checkCredit 유지) + 프론트 0건 = 빈 제안서 대신 "조건에 맞는 고객 없음" 안내 카드(AiOperatorPage isZeroTarget=messages.length===0, 판정=백엔드 차감 게이트 동일 신호).
> **② 직원 디버깅 4건**: ①개인화 변수 발송 빈칸=FIELD_MAP grade/points에 aliases('등급'/'포인트') 누락(name의 '이름'/'성함' 선례 동일, standard-field-map.ts) — 미리보기(하드코딩 라벨)만 매칭·발송 사전(displayName '고객등급'/'보유포인트')엔 없어 빈칸 / ②하위계정 DB현황 N/A=브랜드 체계 있는데 하위 user store_codes 미할당→getStoreScope blocked. 회사 옵션 `allow_user_full_access`(폴백 catch)로 회사별 켜고끄기. **DDL: `ALTER TABLE companies ADD COLUMN IF NOT EXISTS allow_user_full_access boolean NOT NULL DEFAULT false;` + 이새(682956b7) UPDATE true** / ③DM헤더 우측정렬=HeaderProps.align 타입 'right' 누락(dm-section-defaults.ts·dm-section-registry.ts) + renderHeader/HeaderSection center 외 무조건 space-between(좌측 고정). align별 flex-start/flex-end(백엔드+프론트 미러) / ④타겟 건수 상이=**[2026-07-09 오판 철회·전량 원복]** 코드 버그 아니라 인비토 가상데이터 sync 수신거부 잔존(sms_opt_in=true인데 source='sync' 미해제 5명·**운영 회사 전원 0**). 성급히 조회 수신거부 기준을 user_id→company_id로 뒤집었다가(B17-01 역행) Harold 지적으로 실데이터 확인→전량 원복. 진짜=인비토 재sync로 reconcileSyncUnsubscribes 자동 해제(조회·발송 둘 다 664).
> **④ 후속(2026-07-09)**: ①②③만 유효 배포, ④는 코드 무변경(원복). 인비토 데이터 정리(재sync)로 해결. CT-03 발송 경로 user_id 수신거부 vs manual/upload 회사 수신거부 차이는 ④와 **별개·미확정**(운영 sync 잔존 0) — 필요 시 별도 영향표. 상세 lessons/LESSONS_BACKEND.md 2026-07-09.
> **검증**: backend/frontend tsc 0 · 금지패턴 0 · customers.ts 수신거부 잔존 0. **잔여**: 운영 실측(재발송 %등급%/%포인트% · 이새 하위계정 DB현황 · DM 헤더 우측 · 인비토 동의조회 660) + Codex /codex:review. 상세 [[project_2026_0708_operator_credit_and_staff_debug]].

### 🟢 2026-07-08(2) — 원클릭 캠페인(이미지 판독·초안 DB 보관) + 이미지로 문안 전 화면 + 연동 몰 상품 자동채우기(카페24·네이버) + 예약 시점 UI 정비 (★배포완료 — Harold 선언 / 운영 실측 = Harold)
> **① 원클릭 캠페인(옛 "행사 캠페인" 타일 승격)**: 이미지 업로드→vision 판독(`callAIWithFallback` optional images·cache 우회, additive)으로 상품명·정가·할인가 전사(노이즈 리뷰·별점·10ml당·[네이버단독] 제외, `event-image-extract` CT)→행사 내용 자동 채움. 3채널 생성 초안 DB 임시 보관(`event_campaign_drafts` DDL 실행완료 — 소멸 방지·EventCampaignResumeBar 재개). AI Operator 쌩뚱맞은 알약 제거 → SUB_MODULE_CARDS 'AI 사용량' 슬롯을 **'원클릭 캠페인'**(/quick-campaign·QuickCampaignPage) 타일로 승격, AI 사용량은 DashboardHeader 유틸 nav로 이전.
> **② 이미지로 문안 생성 전 화면**: 공용 `ImageToCopyModal`/`ImageToCopyButton`(createPortal body — 입력창 backdrop-filter 조상에 갇히던 fixed 버그 fix) → "이미지" 버튼을 AI Operator·DM·이메일·인앱 생성 입력칸에 배선.
> **③ 연동 몰 상품 자동 채우기(DM 상품 슬라이드)**: products 테이블엔 이미지·링크·할인 없음(주문만 sync) → 몰 상품 API 신규(카페24 `GET /products` scope mall.read_product / 네이버 `POST /products/search` representativeImage — hoyun 실측 확정). 정규화 CT `MallProduct`(mall-product-normalize) + `routes/mall-products`(/preview 실측·/search·/providers·/match). ProductCarouselEditor "연동 몰에서 상품 불러오기" 피커. **자동 이름매칭**: `matchMallProductByName`(정규화 정확일치만)+`attachMallImagesToProductCarousels` 후처리를 DM one-shot·이메일 generate-sections에 배선(빈값만·실패skip·**발송 코어 무수정**).
> **④ 예약 시점 UI 정비**: 공용 `DateTimeField` 2행 클린 레이아웃(캘린더/시계 아이콘+rounded-xl) — 이메일·인앱·마케팅캘린더·AI Operator 예약 전부 반영.
> **검증**: backend/frontend tsc 0 · 금지패턴(모델명·native dialog·박-단어) 0. **잔여**: Harold 운영 실측(원클릭 캠페인 이미지·소멸0·상품 자동채움·예약 UI) + 네이버 상품링크 슬러그 + 몰 이미지 재호스팅 판단 + 메이크샵·고도몰·아임웹 상품 API 확장 + `/codex:review`. 상세 [[project_2026_0708_mall_product_autofill_dm]] · [[project_2026_0708_event_campaign_image_and_draft_persistence]].

### 🟢 2026-07-08 — 행사 캠페인 상품 구조 추출 + 인앱 SDK 서빙 공용화·팝폰 복구 + 인앱 개인화 익명 fallback + 로그인 문의·DM 2열그리드 (★배포완료 — Harold 선언 / 운영 실측 = Harold)
> **① 행사 캠페인 상품 구조 추출(DM+이메일)**: 행사 원문의 상품명·정가·할인가를 product_carousel에 자동 주입(dm-ai `extractEventProducts` sonnet temp0) + 원문 실존 기계검증(`validateProductsAgainstEventText` — 환각 가격 탈락, event-brief CT). DM 문안 요약에 "이름 정가→할인가" 동반 + 대표 1~3개 가격 프롬프트. 구분선 정규화 CT `normalizeSmsSeparatorLines`(구분문자만 4자+ 줄→하이픈10, **DM 문안 경로에만** 적용). 이메일 AI 스키마 discount_price 추가.
> **② 인앱 SDK 서빙 공용화(CT `sdk-serve.ts`)**: 정적 `/sdk/` 경로가 SPA index.html로 fallback돼 깨짐(팝폰 v0.3.6 인앱 정지) → backend가 `/sdk/`·`/api/cdp/sdk/`를 CORS+CORP+**버전폴백**(요청 버전 파일 없으면 최신)으로 서빙. cafe24 인라인 라우트 공용화. **nginx `location ^~ /sdk/`→backend:3000**(OPS 갱신, 팝폰 레거시 경로 복구용). 수동 스니펫 4곳 `/api/cdp/sdk/`로. 팝폰 웹(Vercel Next.js `poppon-workspace/poppon`) layout.tsx SDK v0.3.6→v0.3.9.
> **③ 인앱 개인화 익명 fallback**: 미식별 방문자에게 `{{customer.name}}`·`%등급%`가 공백("님, 회원님") → `/inapp/active` **서버 사전치환**(SDK 무변경): 이름 없으면 "고객" + 빈변수 공백정리(이중공백·구두점앞·줄앞뒤). `renderTextForCustomer` 공백정리 + `renderBlocksForCustomer`(블록 text/label/items) 신설(CT-79). 식별 회원 실값 그대로(회귀 0).
> **④ 로그인 문의 + DM 2열 그리드**: 로그인 페이지 "서비스 이용신청 문의" 버튼+모던 모달(기존 `/api/companies/inquiry` 재사용 — 발신 SMTP_USER·수신 SMTP_TO, 좌 그린패널+우 모바일 양쪽). product_carousel 좌우 스크롤→flex-wrap 2열 justify-center(홀수 마지막 중앙, 발송 렌더러+빌더 미리보기 일관).
> **검증**: backend tsc 0·vitest 382/382·frontend tsc 0·금지패턴 0. 커밋 a5ea765e·1ba70066·ce67f7c4·a7625642·83a7802d + 개인화 fallback. **잔여**: Harold 운영 실측(행사 3채널 상품 반영·팝폰 인앱 블록/익명 "고객님"·발행 모달 hlj.kr) + `/codex:review`. **후속**: 구분선 정규화 타 AI문안 경로 6곳(services/ai.ts·journey-ai-generator·variant-generator 등, 발송 보호영역 별도 승인). 상세 [[project_2026_0708_event_campaign_product_extraction]] · [[reference_inapp_sdk_serving]].

### 🟢 2026-07-07(6) — 마케팅 캘린더 완비: 등록 200크레딧의 통지·출구·타겟 축 구멍 4건 근본수정 (★배포완료 — DDL 2건+리뷰 정정 2건 포함, Harold 선언 / 운영 실측 = Harold)
> **구멍(전 경로 실측)**: ①캘린더 등록이 담당자 번호를 안 담아 notifyOperatorAdmins가 조용히 return — 2h 예고·승인 대기·D-2·완료/보류 통지 전멸 ②자율발송 OFF(기본) 회사는 pending 7일 만료로 연 1회 캠페인이 소리 없이 무산 + 늦은 승인=즉시 발송 ③오퍼레이터 발송에만 혜택 placeholder 출구 가드 부재(이메일·인앱·여정엔 있음) — "[혜택 내용을 입력해주세요]" 실고객 노출 가능 ④타겟 확인 지점 0(발송 당일 AI 자유 해석).
> **수정**: ①createOperator 담당자 기본값=등록 계정 users.phone + notifyOperatorAdmins 폴백(등록 계정→company_admin — CT 1곳, 기존 등록분 포함 전 통지 수혜) + 캘린더 크레딧 모달 extraContent 연락처 입력(선택) ②만료 D-3 리마인드(operator-prep-reminder에 sendPendingExpiryReminders, predictive 9시 사이클 합류, 멱등=expiry_reminder_sent_at) + scheduled_send_at pending에도 저장(발송 패스 status='scheduled' 게이트라 무영향, 소비처 17곳 전수) + 예정일 경과 승인 경고 모달 ③dispatchProposalSend 발송 직전 applyBenefitToBody 재치환(제안 생성 후 입력분 반영) + hasUneditedBenefitPlaceholder 검출 시 admin_review 강등(자동·수동·리마인드 3경로 공유 1곳) ④targetHint 축(TARGET_HINTS 화이트리스트 6종 — 명확 규칙만, 예측 축 금지) = 캘린더 설계 JSON→카드 select→등록 payload→continuous_operators.target_hint→recommendTarget 고정 지시 + 카드 혜택 입력칸.
> **배포 2026-07-07 완료(Harold)**: DDL 2건(target_hint·expiry_reminder_sent_at) + 본체(e6c7f62d) + 코드리뷰 정정 2건(혜택 치환 $ 특수패턴 함수 치환 교체 / 통지 폴백 is_active·is_system 필터 — /engineering:code-review로 이중 검증, vitest 347/347). **잔여 = Harold 운영 실측 1건**: 캘린더 등록(대상 축·연락처)→발송일 08:00 생성→통지 수신→혜택 미입력 admin_review 보류 확인→혜택 입력 후 승인 발송(run-now로 단축 가능). 상세 [[project_2026_0705_marketing_calendar_overhaul]] 갱신분.

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

- 🟢 2026-07-07 — 인앱/이메일/DM 대개편 6종 + hlj.kr 단축링크 + 인앱 디자인 2.0~2.1 + 형태 4종 + 이메일·DM 2.0 + 행사 캠페인 (★DDL 6컬럼·hlj.kr 라이브 / frontend·SDK·backend build+deploy 잔여) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0707_inapp_email_dm_overhaul]]
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
