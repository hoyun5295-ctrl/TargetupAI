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
| Codex 등 외부 에이전트 온보딩·리뷰 판정 기준 | AGENTS.md (레포 루트) | 전체 (경량 유지 — 룰 원천은 CLAUDE.md, 여긴 축약판) |

---

## 2) CURRENT_TASK (활성 작업만)

> **회전 룰:** 완료(★배포완료) 엔트리는 원문을 archive/TASKS_YYYY-MM.md로 이동 + INDEX 등재하고, 아래 "최근 완료 인덱스"에 1줄만 남긴다. 30KB 초과 = 회전 미이행 — 즉시 회전.

### 🟢 2026-07-14 (2) — 디자인 4.0: 코어 통합 + 정예 10종 + 브랜드 학습 + 행사 자동 완성 (코드완료 — 배포 대기 / DDL 0)
> **SoT(전 상세·실행 결과)=[specs/2026-07-14-design-4-core.md](../specs/2026-07-14-design-4-core.md).** M0~M5 전체 1세션 구현(Harold 전부 승인). design-core CT 8파일 신설 + backend 3채널 값 무변 전환(M0 스냅샷 39 불변 통과) + 미러 동기 테스트 11(FE·SDK 기계 대조) + 정예 10종(게이트 기계 판정)·조회 API·3편집기 픽커 + 행사→템플릿 결정적 힌트 + **브랜드 학습**(AiMemoryPage BrandStudioCard — 저장=기존 brand_kit, 인앱 생성기 Brand Voice 주입 구멍 메움). 검증 = 3패키지 tsc 0 · vitest 567+168(컴파일→실렌더/저장 게이트 왕복 9 + 붙여넣기 형식 2) · 금지 grep 0 · 발송 6파일 무접촉. **후속(Harold 0714)**: 옛 템플릿 노출 제거(정예만·상수 보존) · 이메일 편집기 행사·상품 붙여넣기(기존 3크레딧 경로) · 상품 붙여넣기 파서(이메일·DM 공용 편집기 — 크레딧 0·결정적) · 정예 적용 비파괴(콘텐츠 있으면 룩·구도만) · 브랜드 학습 로고 업로드+추출 피드백 · DM 도구 드롭다운 클리핑 정정. 상세=SoT·메모리. **잔여 = ①배포(tp-push+build:safe(backend·frontend)+pm2) ②Harold 시각 승인(게이트 7 — 반려 템플릿만 제거) ③실측(직원): 브랜드 학습→3채널 반영·정예 적용·행사 힌트.** Codex 재실행 = Harold 명시 면제(2026-07-14 — 신규 DB 쓰기·돈·외부 표면 0 + 기계 게이트(스냅샷 39·미러 11)로 갈음, 자체 적대 재검토 수행분).

### 🟢 2026-07-14 — 인앱메시지 디자인 3.0 대개편 + 행사 상품 링크·이미지 자동 매핑 (코드완료 — 배포 대기 / DDL 1건 실행완료)
> ⓪-B 실행. SoT=[specs/2026-07-14-inapp-design-3-prep.md](../specs/2026-07-14-inapp-design-3-prep.md). **영속화 = `cdp_inapp_messages.design` jsonb 1컬럼(0 rows 검증 → Harold ALTER 실행완료 2026-07-14)** — 스키마 {font_display/treatment/motion/backdrop} 전 키 옵셔널·sanitizeInAppDesign 화이트리스트·쓰기 전 선확인(이메일 규약 미러)·INSERT/UPDATE 동적 절(design 미제공 = 컬럼 무참조). **SDK 렌더러 3.0**(sdk-js): 시그니처 테마 7종(editorial·luxury-dark·bold-sale·soft-pastel·paper·city-night·festive — 아트디렉션 내장: 서체 페어링/배율/밀도/모티프, 다크 면 리터럴 원칙) + 서체 실로딩(카탈로그 6종 화이트리스트 Google Fonts link·중복 가드) + 모션 2.0(`hjl-` 접두 keyframes 1회 주입 — CTA 맥동·쿠폰 샤인·초침 팝 + reduced-motion JS·미디어쿼리 이중 가드) + 구도 INAPP_TREATMENTS fail-closed(framed/typographic/spotlight — 카드형 classic 조합만) + 백드롭 딤 3단·블러 토글(center_modal) + product 블록 link_url 클릭(추적+safeNavigate 단일 길목) + 헤드라인 마커/밑줄(블록 emphasis). **미설정 = 현행 렌더 그대로(기존 발행물 회귀 0 — 테스트 고정)**. **에디터**: 골든 템플릿 12종(1클릭 — 트리거/타겟 무접촉·혜택 placeholder 강제) + 시그니처 테마 그리드 + 구도/모션/서체/딤·블러/헤드라인 강조 픽커(소비 조합만 노출) + 미리보기 4파일 미러 동기(blockTheme·BlockPreview·InAppMessagePreview). **AI**: 결정적 디자인 추천(모션 2.0+시나리오 구도 — 임의 산식 0) + 행사 원문 상품 자동 매핑(validateProductsAgainstEventText 가격·URL verbatim 검증 + fetchProductOgImages og:image 채움 — 비행사 경로는 가격/링크 삭제로 환각 차단). **SDK v0.3.10**(VERSION 상수·banner·package.json 어긋남 동시 정정, 번들 69.5→78.7KB, v0.3.8/9 동일 번들 덮어쓰기 관행 유지). 검증 = BE/FE/SDK tsc 0 · sdk-js vitest 161(신규 17) · backend vitest 499(신규 18) · 금지 패턴 grep 0. **Codex 적대 리뷰 = 미완(런타임 결함 — 기본 모델 'CLI 구버전 거부'·spark 스레드 압축 단계 강제 종료, 3회+재개 실패. 고위험 축은 자체 적대 재검토로 대체: SQL 파라미터 인덱스 $33/$38·회귀 가드·XSS 표면·fail-closed 폴백 — 결함 0).** **잔여 = ①배포(tp-push + build:safe(backend·frontend·company-frontend) + pm2 reload) ②실측(직원·Harold): 팝폰 베드 — 형태×시그니처 테마 전환·모션·reduced-motion·구버전 스니펫 폴백·행사 원문 상품 매핑.** Codex 재실행 = Harold 취소(2026-07-14 — 4.0 승격으로 실익 없음 판단. 중단 전 부분 결과: SQL $33/$38 축 approve·중대 발견 없음). 상세 [[project_2026_0714_inapp_design_3]]

### 🟢 2026-07-13 (5) — 이메일마케팅 디자인 3.0 + 제품 링크 자동 매핑 (코드완료 — 배포·DDL 1건 대기)
> 옛 ⓪-A 실행. SoT=[specs/2026-07-13-email-design-3-product-link-design.md](../specs/2026-07-13-email-design-3-product-link-design.md). **W0 제품 링크**: link_url 유실 지점(email-ai.ts .map 재조립) 정정 + og:image 자동 채움(fetchProductOgImages 공용) + AI 상품 스키마 link_url — 렌더러 끝단은 기소비라 무수정, 몰 자동 첨부는 빈 값 보충이라 충돌 0. **W1 렌더러·토큰 3.0**: 완전한 문서 출력(다크모드 meta·모바일 @media·프리헤더 명시 우선·EMAIL_FOOTER_SLOT 마커 — 광고 footer는 </body> 앞 치환, 무마커=append 폴백) + VML 불릿프루프 버튼 + 구도 5타입(EMAIL_TREATMENTS 단일 진실: hero split/typographic·text_card lead/framed/quote·cta bar/ghost·coupon spotlight·상품 focus/list) + 배경면 리듬(soft/tint/dark/gradient — dark=리터럴 #171717 재해석) + 아트디렉션(타입스케일·밀도·모티프·디바이더 리터럴 미러) + 다크 셸(WCAG 대비 판정 중립 반전) + 서체 이메일 폴백 스택 6종+@import + 헤드라인 마커. design 미설정=기존 산출 골격 유지(테스트 고정). **W2 영속·편집기**: email_campaigns.design jsonb(DDL 1 — information_schema 0 rows 검증됨) + 배관 5지점(생성/수정/재발송 복사/mapRow/렌더 4소비처) + 쓰기 전 컬럼 선확인(부분 상태 0) + 편집기(테마 8종 모달·프리헤더 입력·구도/배경/헤드라인 강조 픽커·AI preheader 회생·타이포 구도 이미지 주입 자동 전환) + 골든 템플릿 12종(기존 6 key 유지). **Codex 적대 5라운드(룰 상한) 전건 정정**: SSRF=검증 IP 연결 고정+스트리밍 200KB 상한+벽시계 마감(공용 CT — DM 동시 수혜)·VML href 클릭 추적 래핑·dark 배경면×라이트 테마 미가독·design 쓰기 원자성(수정=단문 동승/재발송=INSERT 동승/생성=scheduled 승격 불변식)·편집기 design 무변경=key 생략·컬럼 캐시 양성만. **후속 정정 2건(0714 Harold 실측 신고)**: ①발송 HTML 상품 카드 칸 불일치 — 이미지 고정 박스 200px cover+무이미지 placeholder+상품명 2줄 확보(min-height)로 등고(DM SSR은 고정 박스 기구현이라 이메일만 결함·인앱은 2열 그리드 없음) ②상품 편집기 "몰 이미지 자동 채우기"/"연동 몰에서 상품 불러오기" 버튼 글자 미표시 — text-emerald-100+워시 배경이 흰 아이템 카드 위에서 소실(이메일·DM 공용 ProductCarouselEditor 단일 정정 = 두 채널 동시 해소, 동일 패턴 전수 grep 결과 이 2곳뿐·타 text-emerald-100은 전부 다크 배경 정상). 검증 BE/FE tsc 0·vitest 492(신규 28)·금지패턴 0. **잔여 = ①서버 psql: `ALTER TABLE email_campaigns ADD COLUMN IF NOT EXISTS design jsonb;` → 배포(tp-push+build:safe+pm2) ②실측(직원): Gmail 라이트/다크+모바일·네이버 수신함 / 행사 원문(상품+URL)→링크·이미지 자동 매핑 / 테마 8종 전환·완성→발송 왕복.** 상세 [[project_2026_0713_email_design_3]]

### 🟡 진행중 — 레거시 PAY 사이트 한줄로 흡수 (Track D, ★원격 접속 로직 검증완료(established 수정·139 실접속 OPEN) — 강문희 발송서버 실 공인 IP 회신 대기)
> 서팀장 2차 회신 전부 반영. **수신 DB 구축완료(2026-07-07)**: invito `pay-ingest-db`(MariaDB 10.11, --sql-mode="") — 143 dump 3테이블 82MB 복원(934,232/730/7,026 일치)·SysId 백필(B/C/D=54/57/58)·계정(sales×3 IP host·root@% 제거)·방화벽 systemd `pay-ingest-fw`. **★2026-07-09 원격 접속 사고 근본해결**: 강문희 실측 54/57/58→62:23388 접속 불가(^C). 재점검 결과 근본 = **DOCKER-USER에 리턴(ESTABLISHED) 허용 룰 누락** → SYN은 ACCEPT 통과해도 DB 응답(SYN-ACK)이 `0.0.0.0/0 DROP`에 걸려 **어떤 IP도 접속 불가**(로컬 127.0.0.1은 FORWARD 미경유 OPEN 착시·tcpdump SYN-ACK 0 확인). 비토 게이트웨이(139.150.81.213) 화이트리스트+established 추가로 **동일 환경 실측→OPEN 확인**, systemd에 established+139 영속화. 부수 발견: "서버명 옥텟=공인 IP" 추정 폐기(우리 게이트웨이도 이름≠실 IP 139). **다음 = 강문희 발송서버 실 아웃바운드 공인 IP 회신 → 계정 host+iptables 반영 → 발주 → 전환일 → 유입 검증(§7-4) → Phase 2.** 강문희 정정 메일(established 수정·실접속 확인·실 IP 요청) 발송 대기. SoT=[docs/레거시서버_폐기_플랜.md](docs/레거시서버_폐기_플랜.md) · 런북=[docs/2026-07-07-pay-absorption-track-d-design.md](docs/2026-07-07-pay-absorption-track-d-design.md) §7. 교훈=[[feedback_verify_in_same_env_before_external_request]].

### 🔵 다음 세션 (예정)
> ⓪-A 이메일 3.0 · ⓪-B 인앱 3.0 · ⓪-C 디자인 4.0 = 전부 실행 완료 — 위 CURRENT_TASK 엔트리 참조 (⓪-C Codex 재실행 = Harold 면제).
> ⓪ **비토 API 발송 경로 전환 검토(선택 후보 — 확정 과제 아님)** — LMS 왕복 테스트 통과로 개시 가능 상태. 한줄로 발송을 DB큐(SMSQ_SEND_13)→게이트웨이 API로 전환할지 설계 검토(발송 파이프라인 절대 보호 — 영향표부터). [[project_2026_0710_bito_api_direct_test]].
> ⓪-2 싱크에이전트 1.6.1 = **업로드·릴리즈 등록 완료(2026-07-10 Harold) — 종결.** 이새 박스(1.5.7)는 updater 자기교체 결함으로 **원격 자동 업데이트 불가(현장 재설치 필요)** → 그대로 두고 **2달 뒤 타 업체 ERP 전환 때 새 에이전트(1.6.1+)로 신규 배포**(Harold 확정 2026-07-10). 그때까지 1.5.7 유지가 정상 상태(슈퍼관리자 매핑 모달=구버전 안내·저장 차단 동작).
> ① **누적 0707 배포** — tp-push + build:safe(frontend·company-frontend·backend) + pm2 reload + Codex /codex:review(플러그인 미로드분). ② **PAY Track D** — 강문희 발주 → 전환 → 유입 검증 → Phase 2 설계(조회+정산+거래내역서 웹/Agent 구분 일괄). ③ **템플릿관리자 흡수(Track B+C)** = 레거시 폐기 최대 잔여 — ★2026-07-10 방향 정리: 이관 = 레거시 DB 복사 X, **senderKey 연결 + IMC 원본 pull**(개발 실체 = 슈퍼관리자 import 2종 신설·같은 IMC 계정 개연성 4,849 실측 근거·재검수 쟁점은 같은 계정 확정 시 소멸). **서팀장 사전 체크 12문항 회신 대기(폐기플랜 §4-3)** → 회신 후 재토의 → 아난티 getSender 실측 → import 2종 설계. 강문희 질의는 그 후 잔여분만.
> (보류) 팝폰 SDK 검증(자체 서비스 SDK 실측 베드) = C:\Users\ceo\projects\poppon-workspace 정독 후 별도. 상세 [[project_2026_0618_selfhosted_mall_app_collection]].

---

### 최근 완료 인덱스 (원문 = 링크의 월별 아카이브)

- 🟢 2026-07-12 (2) — 모바일 DM 강화 D-1~D-4: 발행비 402·야간 광고 가드·재타겟 4종·전환 라벨 (★배포완료, 회전 2026-07-14 / 잔여=실측 3건 직원) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0712_dm_reinforcement]]
- 🟢 2026-07-10 (4) — 비토 게이트웨이 API 직접연동 테스트 통과 (LMS 3건 왕복, 회전 2026-07-14 / 다음=발송 경로 API 전환 검토) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0710_bito_api_direct_test]]
- 🟢 2026-07-13 (4) — DM 텍스트 넣기 상품 URL·이미지 자동 매핑 + 타이포 구도 함정 정정 (★배포완료·DDL 0, 회전 2026-07-13) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0713_dm_design_3]]
- 🟢 2026-07-13 (3) — 모바일 DM 디자인 3.0 대개편: 테마 8종·구도 10섹션·모션 2.0·서체 실로딩·골든 템플릿 12 (★배포완료·DDL 0, 회전 2026-07-13 / 잔여=실측 6건 직원) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0713_dm_design_3]]
- 🟢 2026-07-13 (2) — AI Operator 소개 v3 시네마틱 + 미체감 근본 원인 종결(휴리스틱 캐시→?v=3 버스터 3곳) (★배포완료, 회전 2026-07-13) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0713_operator_intro_effects]]
- 🟢 2026-07-12 (5) — AI 학습메모리 전수점검·일괄 강화 (★배포완료, 회전 2026-07-12 / Codex 4R·주입 5종 화이트리스트) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0712_ai_memory_full_reinforcement]]
- 🟢 2026-07-12 (4) — 인앱메시지 일괄 강화 P0-1~P2-2 (★배포완료·SDK v0.3.8/9 갱신, 회전 2026-07-12 / 잔여=실측 5건 직원) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0712_inapp_full_reinforcement]]
- 🟢 2026-07-12 (3) — 이메일마케팅 법 준수·편집기 일괄 강화 14건 (★배포완료, 회전 2026-07-12 / 잔여=실측 4건 직원) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0712_email_marketing_audit]]
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
