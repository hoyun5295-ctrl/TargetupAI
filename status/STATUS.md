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

### 🟢 2026-07-07 — 인앱/이메일/DM 대개편 6종 + hlj.kr 단축링크 라이브 + 인앱 디자인 2.0~2.1 + 행사 캠페인 (★DDL 6컬럼 실행완료·hlj.kr 라이브 / frontend·SDK build+deploy 잔여)
> **① 이메일 미수신자 재발송**: "미오픈 SMS"→"미수신자 재발송"(이메일 무료 primary + SMS 유료 secondary). 자식 캠페인(원본 통계 무손상·완성게이트 우회로 크레딧 재부과 0)·재발송 1회 한도·수신거부/반송 제외·자식은 카피학습 코퍼스 skip(이중계상 방지). DDL `email_campaigns.parent_campaign_id·resend_generation`.
> **② 요금제 변경 반복노출 근본수정**: 접속마다 "베이직 변경" 모달 재발 = localStorage 비교 방식 취약 → 서버 `companies.plan_notified_code`(DDL) + my-plan pending 판정(NULL=조용히 초기화) + POST /plan-change/ack. 계정당 1회·브라우저 무관. Dashboard localStorage 효과 폐기.
> **③ 인앱 표시 가능성 게이트**: 네이버 스마트스토어=폐쇄형이라 인앱 영구 미지원(데이터 연동만) 명확 안내 + 표시 가능 채널 0이면 생성/게시/AI생성 크레딧 차감 전 차단(INAPP_DISPLAY_UNAVAILABLE). CT `inapp-display-eligibility`(company_integrations active + cdp_events sdk 30일 신호). 메이크샵·아임웹 SDK 설치 가이드 추가. 인앱=company+channel 단위(몰별 타겟팅 없음).
> **④ hlj.kr DM 단축링크 (★서버 배선 라이브)**: 개인화 URL 75자→`hlj.kr/<8자>` 22자(SMS 90byte 유지=LMS 승격 방지 원가절감). 302 겉껍질(추적·개인화·발송 무변경)+발급 실패 시 긴 링크 폴백. DDL `dm_recipient_tokens.short_code`. 서버 DNS(A=58.227.193.62)+nginx(/api/dm/v/s)+certbot SSL+.env DM_SHORT_LINK_BASE 라이브(https 302 실측). GET /api/dm/v/s/:code.
> **⑤ DM 추적 강화 5건 + 인앱 통계 절충안 + CSV 3종**: 구매전환(7일 purchases)·미열람자 재발송·재열람/기기 공유신호(dm_views open_count·seen_anon_ids DDL)·열람시간대·섹션이탈 / 인앱 절충안=식별고객 목록+익명 합산(buildIdentifiedViewers, GET /inapp/viewers) / 공용 CT `csv-download`(BOM)로 이메일 이력·DM 추적·인앱 CSV. 전부 격리 try/catch.
> **⑥ 인앱 디자인 2.0 (SDK v0.3.9·브레이즈급)**: 타이포(Pretendard 700/800)·그라데이션 면+3중그림자+링·글래스 백드롭blur·스프링 모션·CTA/쿠폰티켓/카운트다운 세그먼트/SVG닫기/플로팅·safe-area. 렌더러+빌더 미리보기 1:1. v0.3.9 신설+v0.3.8 제자리 갱신(설치 몰 자동 반영·재설치 불필요), 스니펫 7곳 갱신. shadeHex/accentSoft/surfaceBg/ring 토큰 추가(기존 의미 불변).
> **⑦ 인앱 디자인 언어 2.1 + 실고객 샘플 + 브랜드 강조색(0707(2))**: 테마 6종=색깔놀이 지적 → 구조·타이포·장식 토큰 11종 추가(brand=흰 캔버스+브랜드 밴드 쇼케이스·minimal=모노 에디토리얼·dark=글로우 등, SDK+미리보기 1:1). 이서연 하드코딩 삭제 → 실고객 조회(buildEditorPreviewCustomers, 타겟 최상단+등급별, 0명만 "가상 예시"). AI 강조색 임의 hex → companies.brand_kit 실설정 강제(getCompanyBrandKitRaw). 신규 DDL 0.
> **⑧ 인앱 형태 4종 + 카운트다운 실측화 + 시간입력 교체 + 블록 편집기(0707(3))**: card_style DDL(classic/bubble/ticket/poster, 구버전=classic 폴백). 미리보기 카운트다운 고정목업(23:59:59)→실시간 계산. datetime-local 6곳→공용 DateTimeField(날짜 캘린더+오전/오후+시·분 직접입력). 블록 팔레트 카테고리·아이콘·설명 + IconGrid·Seg·StarInput·CTA 카드화·상품 이미지칸.
> **⑨ 행사 캠페인 자동생성 + DM 문안 품질 3건(0707(4))**: 행사 1입력→DM·이메일·인앱 선택 생성(그리드 12 유지·AI Operator 칩+캘린더 버튼·슬롯별 크레딧·선택분만 과금·인앱 게이트 잠금·이어서 만들기). CT event-brief(원문 기재 혜택만 통과=benefitMatchesEventText, 환각 탈락). DM→문안 16섹션 요약·SMS 90byte 옵션·브랜드보이스 확인.
> **검증**: SDK 123/123·backend 317/317·sdk/backend/frontend tsc 0·금지패턴 0. **DDL 6컬럼 서버 실행완료(⑦0·⑧card_style 1·원 6종 5)**. **잔여**: tp-push + frontend·company-frontend `build:safe`(새 SDK/프론트 dist) + `pm2 reload targetup-backend` / **Codex 이중검증=플러그인 미로드로 이 세션 불가 → 다음 세션 /codex:review 1순위**. 배포후 실측(재발송·요금제 모달·인앱 게이트·hlj.kr·CSV·테마6/형태4 실차이·카운트다운·시간입력 6곳·행사 3채널·SMS 문안). 상세 [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · [[project_2026_0707_inapp_email_dm_overhaul]].

---

### 🔴 활성 블로커 — 알림톡 강조표기형 7300 (대표링크 게이트웨이 매핑 대기, 서팀장)
> 원문·해법·잔여 전문 = [BUGS.md](BUGS.md) §2 (2026-07-07 소유 이관 — 버그 상세는 BUGS.md가 소유). 요지: 대표링크 템플릿의 ATTACHMENT.link 미동봉이 근본 — ①서팀장 게이트웨이 etcJson→IMC link 매핑 추가 → ②한줄로 발송 4경로 etcJson link 합성(buildAlimtalkEtcJson 확장) → ③CT-87 R 차단 해제 묶음(Harold 동의 대기).

### 🔵 다음 세션 (예정) — 이메일 & 모바일 DM 퀄리티 끌어올리기 (Harold 지시 2026-07-07)
> 인앱 디자인 2.0~2.1(SDK v0.3.9)에 이어 이메일 템플릿/렌더 + 모바일 DM 빌더·발행물 디자인 퀄리티를 브레이즈급으로. brainstorming→설계→동의→구현.
> (보류) 팝폰 SDK 검증(자체 서비스 SDK 실측 베드) = C:\Users\ceo\projects\poppon-workspace 정독 후 별도. 상세 [[project_2026_0618_selfhosted_mall_app_collection]].

---

### 최근 완료 인덱스 (원문 = 링크의 월별 아카이브)

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
