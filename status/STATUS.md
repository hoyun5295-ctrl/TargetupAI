# 한줄로 — 관제탑 (STATUS)

> **상시 로드 문서. 30KB 상한.** 룰의 원천은 CLAUDE.md — 이 문서는 "현재 상태"와 "라우팅"만 담는다.
> 재설계 전(2026-07-03 관제탑 재설계 v2) 전체 원본은 git 이력에 보존 — `_backup-20260703-관제탑재설계전/` 폴더는 2026-07-07 삭제(git 이력에서 복구 가능). 필요 시 `git log --all -- 'status/_backup-20260703-*'`로 해당 커밋 조회.
> 사용법: 상황이 생기면 아래 라우팅 표에서 문서를 찾아 **지시된 범위만** 읽는다. 문서 전체 로드 금지. 아카이브는 archive/INDEX.md grep 경유로만.

---

## 1) 라우팅 표 — 이런 경우엔 이 문서

| 상황 | 참조 문서 | 읽는 범위 |
|------|-----------|-----------|
| DB 쿼리 작성 / 스키마 확인 | SCHEMA.md | 대상 테이블 절만 |
| 도메인 작업 착수 전 사고 이력 (룰 원천=CLAUDE.md `read_lessons_first`) | lessons/LESSONS_{DB,FRONTEND,BACKEND,DEPLOY,ARCHITECTURE,META}.md | 해당 도메인 전체. DB·돈·환불=DB / UI·모달=FRONTEND / API·발송·AI=BACKEND / 배포·빌드·SSH=DEPLOY+OPS.md 해당 절 / 컨트롤타워=ARCHITECTURE / **매 답변 직전=META** |
| **Harold님이 "브레인스토밍"이라고 말했을 때** · superpowers 스킬 선택 · Codex 라운드 운영 | **COLLAB.md** | 브레인스토밍 = §1 전체 정독 후 그대로 진행(의무) / 그 외 = 해당 절만 |
| **정산 재구성(청구서 5항목·에이전트 축·일할계산) 재개** | **docs/2026-07-25-billing-restructure-handoff.md** | 전체 (SoT — 단독 재개용. §0 배포상태 → §4 남은 작업 순서) |
| 시스템 구조 파악 | ARCHITECTURE.md | 해당 절만 |
| 자사몰 연동·CDP·커넥터 작업 | INTEGRATIONS.md | 해당 provider 카드 / CDP 공통 절 |
| 버그 수정 | BUGS.md | 해당 버그 항목 (해결분은 archive/BUGS_RESOLVED.md) |
| 과거 작업 조회·회귀 의심 | archive/INDEX.md → TASKS_YYYY-MM.md | grep 적중 항목만 |
| 의사결정 배경 확인 | DECISIONS.md | 해당 ADR |
| 리스크 전체 확인 | RISKS.md | 전체 |
| 싱크에이전트 이슈 진단 | SYNC-AGENT-TROUBLESHOOTING.md | 해당 증상 절 (isae 현장 완료 이력 = archive/SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md grep) |
| AI Operator·CDP·Provider | docs/AI_OPERATOR_기능정의서.md + ai_operator_progress.md | 해당 절 |
| CRM 캠페인 대행(설계 대행) 기능 | docs/2026-07-09-crm-campaign-agency-implementation.md | 전체 |
| 레거시 서버(27.102.203.143) 폐기 | docs/레거시서버_폐기_플랜.md | 전체 (SoT — 진행 시 갱신). **하위 트랙 = 에이전트 선불 충전·잔액 축 흡수: docs/2026-07-24-agent-prepaid-charge-design.md** (서버 실측 원문 포함·다음 세션 단독 재개용) |
| 인앱메시지 설계 | docs/인앱메세지전용.md | 해당 절 |
| DM 편집기 AI 퍼스트 재개편 | docs/2026-07-16-dm-editor-ai-first-redesign.md | 전체 (SoT — Harold 검토 대기) |
| 장기 로드맵·비전 | docs/한줄로_BEYOND_BRAZE_비전.md | 해당 절 |
| 옛 설계서·핸드오프·디버그노트 | archive/DESIGNS/ (archive/INDEX.md 경유) | grep 적중 문서만 |
| Codex 등 외부 에이전트 온보딩·리뷰 판정 기준 | AGENTS.md (레포 루트) | 전체 (경량 유지 — 룰 원천은 CLAUDE.md, 여긴 축약판) |
| 0718 프론트 스플리팅 사고 후속(B-0718-1)·성능 최적화 재개 | docs/2026-07-18-frontend-splitting-incident-handoff.md | 전체 (SoT — §4 작업 순서) |
| 아임웹 앱스토어 등록·제출물(한줄로AI) | docs/imweb-appstore/app-intro-copy.md + deliverables/ | 전체 (SoT — 문구 원고·산출물. 연동 스펙은 INTEGRATIONS.md 아임웹 카드) |
| AI 규제 대응(고영향 판단·생성물 표시) | docs/compliance/ | 해당 문서 (고영향AI 사전검토서 = 법 제31조 이행 기록) |

---

## 2) CURRENT_TASK (활성 작업만)

> **회전 룰:** 완료(★배포완료)면서 남은 일이 없으면 STATUS에서 **지운다**(원문 = archive/TASKS_YYYY-MM.md + memory). 남은 일이 있으면 아래 "완료분 잔여"에 **한 줄**만. 경위·수치·함정을 여기 재서술하지 않는다(doc_ownership). 30KB 초과 = 회전 미이행.

### 🟡 진행중 — 레거시 PAY 흡수 (Track D)
> SoT = [docs/2026-07-07-pay-absorption-track-d-design.md](docs/2026-07-07-pay-absorption-track-d-design.md)(통계·인프라) · [docs/2026-07-24-agent-prepaid-charge-design.md](docs/2026-07-24-agent-prepaid-charge-design.md)(충전·잔액, 단독 재개 가능) · [[project_2026_0724_agent_prepaid_charge]] · [[project_2026_0723_pay_agent_stats_tabs]]
> **충전·잔액 축 잔여**: 서수란 선불 발송ID·단가 자료 수령 → 지정 → 충전 왕복 실측 / §5-4 충전 요청 / §5-5 고아 대조 워커 / 컷오버(143 SeqNo>7042 백필 — **RsApplyFlag 'Y' 그대로**, 'N'이면 이중 증액) + 강문희 143 연동 종료 통지 / §8-2·8-8 실측.
> **★0725 ★배포완료(d19f48fd) — 서수란 6건 + 첫 청구서 발행 전 정산 결함 9건 + xlsx 전환·정합성 5건.** 배포 실측: HEAD=origin/main · exceljs 설치 · `dist/utils/{xlsx-writer,stats-period}.js` 실존 · 프론트 청크 해시 전량 교체 + `개 회사`(발신번호 페이징) 서빙 번들 실존 확인.
> **추가 5건(d19f48fd)**: 발송통계 3경로 CSV→**.xlsx**(exceljs·`utils/xlsx-writer.ts` CT 신설 — 행빌더 공유로 CSV=xlsx 보장, 수량 숫자형·헤더고정·자동필터) · 알림톡 라벨 통일(웹 '카카오'→'카카오알림톡', 에이전트와 한 컬럼에서 두 줄로 갈리던 것) · 월 확장 `utils/stats-period.ts` CT 단일화(**웹 행만 미확장이라 월별에서 하루치가 한 달로 라벨링되던 과소집계**) · 엑셀 폴백 제거+날짜검증 전건화(청구 축 아닌 숫자가 조용히 나가던 경로) · 슈퍼 엑셀 유형 빈칸→'(유형 미상)'.
> **서수란 접수 2건(웹 유형 NULL·발신번호 페이징) = 코드·배포 모두 완료** — 남은 건 화면 실측뿐. 접수대기였던 이유는 **프론트 미배포**였다(브레인스토밍 회의론자 지적이 실측으로 확인됨).
> (이하 0725 1차분) MMS 308,043건 0원 청구(msg_type M·K 미변환) 수정에 이어, 같은 날 2세션에서 ①preview≠발행(자체 SQL 폐기·발행 드라이런으로 재작성) ②정산 생성 비트랜잭션(+`billed` 되돌림 — `billed_invoice_id`는 FK 아님이라 "삭제 후 재생성"에서 크레딧이 영구 미청구되던 경로) ③테스트단가 0원 폴백 ④사용자별 정산 크레딧 축 불일치 ⑤선불 회사 이중 청구 가드 ⑥집계 유형키 누락 자동 감지 ⑦IMC 부재 500 방어 ⑧**월 경계 누락(6월 LOG에 앉은 7/1 발송 385건이 6·7월 어디에도 안 잡히던 구조 — LOG 스캔 ±1개월)** 완료. **7월 청구 금액을 바꾸는 미해결 항목 없음.** Codex 적대검증 4건 중 3건은 실측으로 기각(브랜드메시지는 `IMC%` 테이블 전 스키마 0개 + `campaigns.name` 컬럼 부재로 발송 자체가 비가동 — 별건 분리). tsc 0·1,033 테스트 통과. **발행은 대기 소진 후 8/4 이후, 검증 1건 = 거래내역서에 MMS 308,043건.** 62 원장 07-05~07 + C서버 6일 복구 완료. 상세=[[project_2026_0725_settlement_mms_gap_and_seo_tickets]].
> (구) 서수란 접수 6건 착수 기록 — 순서 = ①발급명 병기 ②대상ID 출력 ③웹 발송유형 NULL ④알림톡 부달 B0061 귀속 ⑤7/6~7 불일치 진단 ⑥슈퍼 발신번호 페이징. ③ 착수 시 근본 = 웹 통계 소스(querySendStats)에 유형 축이 없어 CSV만 고쳐선 안 됨. 상세·함정 = [[project_2026_0725_pay_stats_custnm_storeid]].
> **별건(미해결)**: 피케이포유 대상ID 인코딩 손상 — 같은 매장이 정상 UTF-8과 EUC-KR 이중인코딩 두 벌(hex 실측 확정). 게이트웨이 ingest 손상이라 복원은 별도 과제. 상세 = Track D SoT §2-4.

### 🔴 진행중 — 정산 재구성 (0725 착수, 다음 세션 1순위)
> **SoT = [docs/2026-07-25-billing-restructure-handoff.md](docs/2026-07-25-billing-restructure-handoff.md)** — 단독 재개용. 대화 맥락 없이 그 문서만 읽으면 된다.
> **재개 첫 할 일 = 요금제 이력 배선 7파일 커밋·배포**(미커밋 상태. tsc 0·1,077 테스트·Codex 6건 정정 완료).
> Harold 정의 청구서 = ①요금제(일할) ②한줄로 웹(일자×계정×유형) ③에이전트(일자×발송ID×대상ID×유형) ④테스트(일자×계정) ⑤AI크레딧.
> **근본 문제 = 청구 집계가 에이전트(`sales.RSRM_SalesStts`)를 전혀 안 읽는다** → `usage_type='both'` 회사의 게이트웨이 발송분이 청구서에서 통째 누락(금강제화 정산서 지적의 원인).
> 준비 완료: `company_plan_changes` 테이블+141행 기준선 · `plan-change-log` CT(쓰기 9곳 전수 배선) · `billing_items` 축 ALTER(channel·store_id·agent_id FK).
> 남은 순서 = ①청구용 통합 집계 ②`/generate` 재작성 ③PDF 재구성 ④일할계산 순수함수 ⑤성능(1분+, 48테이블) ⑥금강제화 대상ID 실측.

### 🔵 다음 세션 (예정)
> ① **템플릿관리자 흡수(Track B+C) — 1순위**: 다음 = 서팀장 점검표 회신(계정·코드 정정) → 컷오버. 병행 = M4 실발송 1건 · 497 기준 서팀장 · M5(B-3 계정·Bill_ID) · 브랜드 스코프(B-2) · 다우 2사 senderKey 이관 실측. 계약·이관 이력 전문 = 설계문서 §1·§4 · [[project_2026_0705_legacy_template_migration]].
> ② **0718 성능 후속(활성)**: 관측 사이클 1회전 — 1순위 campaigns 발송 단계 폴러 인덱스(EXPLAIN 후 처방) · 2순위 balance_transactions 잔액 SUM N+1(호출처 추적) · 그 후 M3/롤업. SoT = docs/2026-07-18-frontend-splitting-incident-handoff.md · [[project_2026_0717_dashboard_performance]].
> ③ **아임웹·아이디룩 시연(활성)**: 스토어 등록 확인 → 테스트 몰 OAuth 리허설(pm2 로그 + 회원가입 1건 webhook) → 아이디룩 시연. 스펙 = INTEGRATIONS.md 아임웹 카드 · [[project_2026_0719_imweb_appstore_idlook]].
> ④ **이미지 스튜디오 잔여**: 인앱 웹 디자인 탭 단순화 · 원샷 이식(인앱·이메일) · 판독 3축 확장 · 템플릿 exampleUrl 실샘플 · **미해결 = DM 상품 링크 입력 시 멈춤(재현 정보 대기)**. [[project_2026_0719_p4_image_studio]].
> ⑤ **비토 라인 14·15 미결 4건**: ①배정 화면 게이팅 범위(Harold 미확인) ②라인그룹 DELETE가 users.line_group_id 미체크(무경고 배정 해제) ③sweeper 2종 bulk-only 사각 ④Codex 결과 미수령. [[project_2026_0717_bito_line14_15_lineadmin]].
> ⑥ **인앱 잔여**: 웹 실측(쿠폰·CTA 정렬·허용표·AI 생성 1건) · 0717 직원 디버깅분(수신거부·DM #1~3·이메일) 코드완료·미검증 · M3 네이버 env 키(NAVER_CLIENT_ID/SECRET) 등록 시 활성 · M6 이메일·인앱 이식(별도 설계).
> ⑦ **Local AI Ops Hub** — 설계 3부작 완료·Harold 결정(H-2 M0 착수) 대기. 실무보다 후순위. [[project_2026_0715_local_ai_ops_hub]].
> (지속) 비토 API 발송 경로 전환 검토(선택) [[project_2026_0710_bito_api_direct_test]] · (보류) 팝폰 SDK 검증.

---

### 완료분 잔여 (실측·후속 대기만)

> 배포까지 끝나고 할 일이 없는 건은 여기 남기지 않는다. **아직 남은 것만** 적는다.
> 경위·함정·수치 원문 = 각 memory 파일 + [archive/TASKS_2026-07.md](archive/TASKS_2026-07.md). 여기에 재서술 금지(doc_ownership).
> 위 활성 트랙(진행중·다음 세션)에 이미 있는 잔여는 중복 기재하지 않는다.

| 건 | 남은 것 | 상세 |
|---|---|---|
| 0725 PAY 통계 발급명·대상ID | **배포 대기** + 커밋 시 신규파일 `packages/backend/src/utils/pay-stats.test.ts` git add | [[project_2026_0725_pay_stats_custnm_storeid]] |
| 0724 DM 테스트 무과금 차단 | 서수란 실측 · 기존 running A/B 미발행 variant 점검 SQL | [[project_2026_0724_dm_test_no_charge_bypass]] |
| 0723~24 PAY 에이전트 통계(발송ID·엑셀) | 서수란 실측 · 54/57 전환갭 확인 · billing 정산 반영 | [[project_2026_0723_pay_agent_stats_tabs]] |
| 0722 모바일 DM 편집≠단말 | Harold 실측 | [[project_2026_0722_mobile_dm_editor_publish_parity]] |
| 0722 카카오 템플릿 관리 | 화면 실측 (접수2 프론트 배포 대기) | [[project_2026_0722_kakao_template_mgmt_tickets]] |
| 0722 영업용 테스트발송/저장 | 실측 | [[project_2026_0722_sales_test_send]] |
| 0721 브랜드 학습 · DM 고아기능 배선 · 역할 격리+인앱 관리자 | **코드완료·배포 대기 3건** | [[project_2026_0721_brand_learning_consolidation]] · [[project_2026_0721_mobile_dm_feature_wiring]] · [[project_2026_0721_role_isolation_inapp_admin]] |
| 0721 인앱 포스터 캐러셀 | 실기기·왕복 실측 | [[project_2026_0721_inapp_poster_carousel]] |
| 0720~21 모바일 DM 제목 정합 | 실측(주황막대·노치·이벤트카드·인앱포스터) | [[project_2026_0720_mobile_dm_title_parity]] |
| 0719~20 계절 템플릿 | 의류 안내 1줄 커밋·배포 | [[project_2026_0719_p4_image_studio]] |
| 0717 인앱 중앙정렬 | 웹 실측(쿠폰정렬·허용표) + 앱 출시 후 실측 3종 | [[project_2026_0717_inapp_debug_session_incomplete]] |
| 0716 DM 편집기 AI퍼스트 | 직원 실측 · M3 네이버 env 키 · M6 이메일·인앱 이식 | [[project_2026_0716_dm_editor_ai_first_redesign]] |
| 0716 인앱 안전편집기 · 서체 자가호스팅 | 팝폰 앱 커밋·빌드(Harold) + 실기기 / 직원 실측 | [[project_2026_0716_inapp_universal_safe_editor]] · [[project_2026_0716_dm_email_font_selfhosting]] |
| 0715 DM 한글주소 · DM bugfix5 | DDL 3건 확인 + 단말 링크 인식 실측 / 섹션메뉴 build:safe + 직원 실측 | [[project_2026_0715_dm_korean_alias]] · [[project_2026_0715_mobile_dm_bugfix_5]] |
| 0713~15 디자인 3.0/4.0 · Operator 소개 v4 | Harold·직원 시각 실측 | [[project_2026_0713_operator_intro_effects]] |

> 잔여 없는 완료분 + 2026-07-09 이하 = [archive/INDEX.md](archive/INDEX.md) → TASKS_YYYY-MM.md grep.
> 회전 이력: 0721(07-01~09) · 0722(07-04~09) · **0725(완료 서술 전량 archive 위임 — STATUS에는 잔여만)**.

---

## 3) 진행 예정 작업 (TODO)

> 완료분 원문 = [archive/DONE_LOG_2026.md](archive/DONE_LOG_2026.md) "STATUS §3 TODO 완료분 회전 (2026-07-07)" 절.
> Sync Agent v1.6.1 = 2026-07-10 종결(이새 1.5.7 유지가 정상 — 자기교체 결함, 타 ERP 전환 때 신규 배포).

- [ ] **직원 버그리포트 실동작 검증**: 8차 B8-01~B8-13(app.hanjul.ai) · 9차 S9-04/S9-08(발송결과 성능 + sent_at 정확성) · D39 세션2(필터 UI + AI 보유필드)
- [ ] **AI 맞춤한줄 Phase 2**: 실서비스 통합 테스트(실제 발송) — Harold 검증 대기
- [ ] **카카오 알림톡 템플릿 관리(Humuson API v2.1.1)**: 고객사 CRUD+검수+발신프로필 UI · 슈퍼 고객사별 연동 설정(humuson_user_id·uuid) · 발송 시 APR 상태만 선택 · 백엔드 프록시 `/api/kakao-templates/*`+kakao_templates 확장+상태 전이 규칙 · Phase 2(이미지 업로드·알림 수신자·발신프로필 그룹)
- [ ] **선불 요금제**: Phase 1-B KCP PG 연동(카드결제만) → Phase 2 입금감지 API 자동화
- [ ] **보안**: 슈퍼관리자 IP 화이트리스트 · SSH 키 인증 전용 전환(선택)
- [ ] **인비토AI**: 데이터 축적 후 모델 학습 파이프라인 설계 · 이용약관 제14조 배포 후 서비스 공지(조항 신설 2026-07-03 완료)

---

## 4) 활성 리스크 상위 (1줄 요약 — 전체는 RISKS.md)

- R1 타입 에러 배포 → 서버 크래시 (확률2·영향5) — 배포 전 tsc --noEmit 필수
- R2 DB 파괴적 작업 데이터 유실 (확률2·영향5) — pg_dump 백업 후 작업
- R23 Docker 재생성 시 0.0.0.0 바인딩 실수 (확률2·영향5) — 반드시 127.0.0.1 확인 (OPS.md 안전 명령)
- 그 외 등재 리스크는 전부 ✅ 해결 상태 — 상세·이력은 RISKS.md

---

## 5) 최근 결정 5건 (1줄 요약 — 전체는 DECISIONS.md)

- D78 (03-16) 프로 자동 스팸필터 테스트 + CT-09 spam-test-queue — 차단 시 자동 재생성(최대 2회)
- D73 (03-14) 무료체험 PRO 게이팅 + 수신거부 브랜드 자동배정(CT-03) + 커스텀 라벨 UPSERT(CT-07)
- D69 (03-12) 자동발송 기능 기초 설계 — auto_campaigns + PM2 워커 + D-1 사전알림
- D68 (03-12) 대시보드 UI 4건 + AI 생일 타겟팅 + 테스트 비용 합산
- D67 (03-12) 080 콜백 진단 + 수신동의 변형 13종 + 사용자별 고객DB 삭제
- ※ 2026-03-16 이후 결정은 DECISIONS.md 미등재(TASKS·memory에 산재) — 소급 등재는 별도 작업으로.

---

## 6) DONE LOG

> 최근 완료는 §2 "완료분 잔여"가 담당한다. 과거 DONE LOG(3월 이전 31건) + STATUS §3 완료분 회전(2026-07-07) 원문 = [archive/DONE_LOG_2026.md](archive/DONE_LOG_2026.md).
