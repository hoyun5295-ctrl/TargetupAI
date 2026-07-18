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
| DM 편집기 AI 퍼스트 재개편 | docs/2026-07-16-dm-editor-ai-first-redesign.md | 전체 (SoT — Harold 검토 대기) |
| 장기 로드맵·비전 | docs/한줄로_BEYOND_BRAZE_비전.md | 해당 절 |
| 옛 설계서·핸드오프·디버그노트 | archive/DESIGNS/ (archive/INDEX.md 경유) | grep 적중 문서만 |
| Codex 등 외부 에이전트 온보딩·리뷰 판정 기준 | AGENTS.md (레포 루트) | 전체 (경량 유지 — 룰 원천은 CLAUDE.md, 여긴 축약판) |
| 0718 프론트 스플리팅 사고 후속(B-0718-1)·성능 최적화 재개 | docs/2026-07-18-frontend-splitting-incident-handoff.md | 전체 (SoT — §4 작업 순서) |

---

## 2) CURRENT_TASK (활성 작업만)

> **회전 룰:** 완료(★배포완료) 엔트리는 원문을 archive/TASKS_YYYY-MM.md로 이동 + INDEX 등재하고, 아래 "최근 완료 인덱스"에 1줄만 남긴다. 30KB 초과 = 회전 미이행 — 즉시 회전.

### 🟡 진행중 — 레거시 PAY 사이트 한줄로 흡수 (Track D, ★0715 54 병행 적재 개시·개시일 실측 통과 — 익일 143 마감 대조 → 57·58 순차)
> 서팀장 2차 회신 전부 반영. **수신 DB 구축완료(2026-07-07)**: invito `pay-ingest-db`(MariaDB 10.11, --sql-mode="") — 143 dump 3테이블 82MB 복원(934,232/730/7,026 일치)·SysId 백필(B/C/D=54/57/58)·계정(sales×3 IP host·root@% 제거)·방화벽 systemd `pay-ingest-fw`. **★2026-07-09 원격 접속 사고 근본해결**: 강문희 실측 54/57/58→62:23388 접속 불가(^C). 재점검 결과 근본 = **DOCKER-USER에 리턴(ESTABLISHED) 허용 룰 누락** → SYN은 ACCEPT 통과해도 DB 응답(SYN-ACK)이 `0.0.0.0/0 DROP`에 걸려 **어떤 IP도 접속 불가**(로컬 127.0.0.1은 FORWARD 미경유 OPEN 착시·tcpdump SYN-ACK 0 확인). 비토 게이트웨이(139.150.81.213) 화이트리스트+established 추가로 **동일 환경 실측→OPEN 확인**, systemd에 established+139 영속화. 부수 발견: "서버명 옥텟=공인 IP" 추정 폐기(우리 게이트웨이도 이름≠실 IP 139). **★0715(2) "적용 시작 OK" 발신 → 당일 54 병행 적재 개시 실측 통과(288행 실시간·SysId '54'·한글 무결·깨짐 0). 다음 = 익일 143 마감 대조(§7-4) → 강문희 공유+57(golang)→58 → 최종 전환일 직전 dump 재복원+재백필 → Phase 2.** SoT=[docs/레거시서버_폐기_플랜.md](docs/레거시서버_폐기_플랜.md) · 런북=[docs/2026-07-07-pay-absorption-track-d-design.md](docs/2026-07-07-pay-absorption-track-d-design.md) §7. 교훈=[[feedback_verify_in_same_env_before_external_request]].

### 🔵 다음 세션 (예정)
> **0716~17 배포완료 4건 archive 회전 완료(2026-07-17)** — DM 편집기 AI퍼스트(M1~M5)·인앱 범용보장계약·서체 자가호스팅·**0717 인앱 중앙정렬 근본수정+전층 전수점검+앱 통합 계약(5커밋)**. 잔여 실측 = 최근 완료 인덱스 참조. (`public/about-ai-operator-v5.html`·`v6.html`=소개 실험·반려·미커밋=폐기.)
> **★인앱 잔여(0718~)**: **팝폰 1.0.2 심사 중** — 출시 후 실측 3종(재실행 재표시=세션당 1회 / 닫기 억제 / 다시 보지 않기) = **B-0717-2 해소 확인**(BUGS.md). 1.0.2부터 EAS Update 런타임 성립(이후 JS 수정=검수 없이 OTA). 웹 실측 = 쿠폰·CTA 정렬·허용표·AI 생성 1건. 0717 직원 디버깅분(수신거부·DM #1~3·이메일)=코드완료·미검증.
> **별건 잔여**: 인앱/DM M3 네이버 후보 env 키(NAVER_CLIENT_ID/SECRET) 등록 시 활성 · DM M6 이메일·인앱 이식(별도 설계).
> **★0717 대시보드 성능 1~4차(★배포완료·실측 종결)** — 이새(13.7만) 지연: ①MySQL (app_etc1,sendreq_time) 커버링 90 ALTER **root 재실행으로 실적용**(어제 "실행 완료" 기록은 smsuser 권한 거부로 미반영이 진실) → sendTimes 3~8초→13~36ms ②stats·campaigns 집계 = 캠페인 실적재 라인 축 축소(27→24테이블·mysqlUnion 823→324ms) ③stats·enabled-fields SWR 캐시(재진입 SLOW 0 실측) — Codex 5라운드(수용 8·기각 5)+신규 테스트 14 ④customers 중복 유니크 DROP 2건 실행 완료(19:24 백업 후) **⑤(0717 밤·확장성 지시) 대시보드 2라우트를 getCampaignResultCounts CT 합류** — 확정 캠페인=PG 캐시·진행 중만 MySQL(발송결과·발송통계·관리자와 동일 소스 통일)+CT 내 SMS·카카오 병렬 복원. **⑤ 배포·실측 종결(0717 20:30 — 이새 진입 SLOW = enabled-fields 콜드 1줄뿐, stats·campaigns·mysqlUnion 소멸)** ⑥**관측 인프라 가동**: PG pg_stat_statements+MySQL slow_query_log(0.5s) + **MySQL 버퍼풀 128MB(기본값 방치 — 누적 디스크 읽기 36.9TB가 증거)→2GB 온라인 확장(SET PERSIST)** + OPS.md §0-1 DB 설정 기준선 신설 ⑦(밤·배포) enabled-fields 워밍(backend — **라이브·정상**) + 축 A M1 프론트 스플리팅 — **★0718 00시 사고(B-0718-1): 난독화 stringArray×동적 import 비결정 빌드로 서버 빌드에 Dashboard 등 청크 미생성 → 전 고객 오류 화면 → 프론트만 f8ac12f6 롤백(정상 복구·외부 실측). 서버 git dirty·재발 방지 게이트 미구현.** **다음 세션 1순위 = 사고 후속 §4 순서(git 정합→safe-build 산출물 게이트→난독화 상호작용 제거→재시도는 Harold 판단) — SoT=docs/2026-07-18-frontend-splitting-incident-handoff.md. 그 후 = ⑦ 백엔드분 이새 SLOW 실측·화~수 관측 상위 20 사이클·M2/M3/롤업.** 상세=[[project_2026_0717_dashboard_performance]].
> **★0717 비토 라인 14·15(★배포·라인설정·E2E 왕복 전부 통과 = 트랙 종결)** — Harold 실측: 자비스가 Agent `hanjul02`·`hanjul03` 활성화 → 발송 + 결과 리포트 수신까지 확인. **잔여 미결 4건**: ①배정 화면 게이팅 범위(라인그룹 CRUD만 ceo·admin, 고객사/사용자 **배정**은 슈퍼관리자 공용 — "라인설정"에 배정 포함 여부 Harold 미확인) ②라인그룹 DELETE가 `users.line_group_id`를 안 봐 배정을 무경고 해제(FK ON DELETE SET NULL) ③`expired-pending-sweeper`·`system-monitor-worker`가 아직 bulk만(`getAllBulkSmsTables`) = 비토 라인 사각(0717 status 100 48h+ 잔존의 정체) ④Codex 리뷰 결과 미수령(`task-mrosv2qq-oyccte` — `/codex:status`→`/codex:result`는 Harold 직접. **Codex 통과 아님**). 별건 = `SMSQ_SEND_12` 유휴 잔재(더미 8행) 폐기. 상세=[[project_2026_0717_bito_line14_15_lineadmin]].
> ★ **1순위 = 템플릿관리자 흡수(Track B+C)** — ★0715~16 진행: 관문 1·2 전부 통과(import 2종 배포·아난티 847 pull·강문희 스펙 회신 해소). **Track C 착수 대기 = 강문희 답신 발신(삭제 불요·upsert 키·착수 시기) → 착수 회신 오면 M2(매핑 CT+아웃박스+효과검증+대조 워커) 설계·구현.** 병행 = M4 실발송 1건 · 497 기준 서팀장 · M5(B-3 계정·Bill_ID) · 브랜드 스코프(B-2) · 다우 2사 senderKey 이관 실측. SoT=설계문서 §1 · [[project_2026_0705_legacy_template_migration]].
> ② **PAY Track D** — ★0715 54 병행 적재 개시. 다음 = 익일 143 마감 대조(§7-4) → 57(golang)→58 → 최종 전환일 dump 재복원 → Phase 2.
> ③ **Local AI Ops Hub(비토 24시간화)** — 미래 대비. 설계 3부작 완료(docs/2026-07-15-local-ai-ops-hub-{design·agents-design·jarvis-spec}.md). Harold 결정(H-2 M0 착수) 대기. **현재 실무(①②)보다 후순위.** [[project_2026_0715_local_ai_ops_hub]].
> (지속) ⓪ 비토 API 발송 경로 전환 검토(선택) [[project_2026_0710_bito_api_direct_test]] · ⓪-2 싱크에이전트 1.5.7 유지(종결) · (보류) 팝폰 SDK 검증.

---

### 최근 완료 인덱스 (원문 = 링크의 월별 아카이브)

- 🟢 2026-07-17 (2) — 비토 라인 14·15 신설(자비스 요청) + 슈퍼관리자 `발송 라인 설정` 탭 신설(ceo·admin 전용) + 정산 bito 라인 포함 (★배포완료 · MySQL DDL 2건 실행완료 · 라인설정 완료 · **E2E 발송+리포트 왕복 Harold 실측 통과 = 트랙 종결** / 잔여 = 미결 4건) → 상세 [[project_2026_0717_bito_line14_15_lineadmin]]
- 🟢 2026-07-17 — 인앱 중앙정렬 근본수정(SDK 버전 폴더 동기화 누락)+전층 전수점검(허용표 3면 통일)+앱 네이티브 통합 계약 2면 (★배포완료 5커밋·DDL 0 / B-0717-1 종결(Harold 실측) · B-0717-2=팝폰 1.0.2 심사 중 / 잔여=웹 실측(쿠폰정렬·허용표)+앱 출시 후 실측 3종, 회전 2026-07-17) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0717_inapp_debug_session_incomplete]]
- 🟢 2026-07-16 (3) — DM 편집기 AI 퍼스트 재개편 M1~M5 (★배포완료 3d40dfb1 / 잔여=직원 모바일 DM 실측+M3 네이버 env 키+M6 이메일·인앱 이식, 회전 2026-07-17) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0716_dm_editor_ai_first_redesign]]
- 🟢 2026-07-16 (2) — 인앱 범용 안전 편집기(블록→flat 합성·다시 보지 않기·SDK v0.3.11) (★배포완료·DDL 0 / 잔여=팝폰 앱 커밋·빌드(Harold 직접)+실기기 실측, 회전 2026-07-17) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0716_inapp_universal_safe_editor]]
- 🟢 2026-07-16 — DM·이메일 서체 자가호스팅+무료글꼴 12종(궁서체 해소) (★배포완료 e1e3c61b·24b4e9e8 / 잔여=직원 실측, 회전 2026-07-17) → 상세 [[project_2026_0716_dm_email_font_selfhosting]]
- 🟢 2026-07-15 (3) — 템플릿관리자 흡수 Track B: import 2종+아난티 847 pull (★배포완료·DDL 0 / 관문 1·2 통과 / 잔여=답신 발신→M2 매핑 CT·M4 실발송·다우 2사 이관, 회전 2026-07-16) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0705_legacy_template_migration]]
- 🟢 2026-07-15 (4) — 모바일 DM 직원 신고 3파트: 완성이미지 풀화면(full_bleed)·색표시 5건9항목(연결부 그라데이션·버튼색·헤더 제목색/브랜드토글·상품 배경/글씨공간/이미지높이)·섹션추가 메뉴 신규 11종 편입 (DDL 0·3면 미러+계약테스트 / full_bleed·5건9항목 ★배포완료 / **섹션메뉴(c3cd455e) frontend build:safe 잔여** / 직원 실측, 회전 2026-07-16) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0715_mobile_dm_bugfix_5]]
- 🟢 2026-07-15 (2) — AI Operator 소개 v4 스펙터클 (★배포완료, 회전 2026-07-15 / 잔여=Harold 시각 확인) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0713_operator_intro_effects]]
- 🟢 2026-07-15 — 모바일 DM 한글 주소(hlj.kr/반짝세일_07)+추적 2원화 (★배포완료, 회전 2026-07-15 / 잔여=DDL 3건 확인+실측(단말 문자 링크 인식=성패 축·직원)+Codex 합류) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0715_dm_korean_alias]]
- 🟢 2026-07-14 (2) — 디자인 4.0: 코어 통합+정예 10종+브랜드 학습+행사 자동 완성 (★배포완료, 회전 2026-07-15 / 잔여=Harold 시각 승인(게이트 7)+실측 3건(직원)) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · SoT=[specs/2026-07-14-design-4-core.md](../specs/2026-07-14-design-4-core.md)
- 🟢 2026-07-14 — 인앱 디자인 3.0 대개편+행사 상품 매핑 (★배포완료·DDL 1 실행완료·SDK v0.3.10, 회전 2026-07-15 / 잔여=실측(팝폰 베드·직원·Harold)) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0714_inapp_design_3]]
- 🟢 2026-07-13 (5) — 이메일 디자인 3.0+제품 링크 자동 매핑 (★배포완료, 회전 2026-07-15 / 잔여=ALTER design jsonb 실행 확인+실측 4건(직원)) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0713_email_design_3]]
- 🟢 2026-07-14 (3) — 모바일 DM 직원 신고 8건 + 재발 방지 게이트 2종(속성 계약·동작 불변식·pre-push 훅) (★대부분 배포완료·DDL 0, 회전 2026-07-15 / 잔여=DB로그 정리 push+직원 실측 8건) → [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md) · 상세 [[project_2026_0714_mobile_dm_bugfix_6]]
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
