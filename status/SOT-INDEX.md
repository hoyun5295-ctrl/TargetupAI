# 프로젝트·트랙 SoT 색인

> **상시 로드 아님.** STATUS.md 라우팅 표에서 한 행으로 넘어오는 2차 색인이다.
> 프로젝트가 늘어도 상시 로드는 늘지 않게 하려고 분리했다 — 신규 프로젝트 SoT는 **STATUS 라우팅 표가 아니라 여기**에 등재한다.
> 현재 상태·잔여·금지 조건은 STATUS §2 카드가 소유한다. 여기엔 **어디를 읽을지**만 적는다.

## 0) 기능 상설 SoT — 기능 이름을 부르면 여기

> 프로젝트(시점 작업)와 다르다. **기능은 끝나지 않는다** — 재설계가 종결돼 트랙이 archive로 가도 기능 문서는 남아
> 그 기능의 구조·불변 원칙·이력 색인을 계속 소유한다. 착수 전 필독 순서도 여기서 지시한다.

| 기능 | 호출어 | 문서 | 읽는 범위 |
|---|---|---|---|
| **여정(Journey)** — 트리거 자동화 | **여정** | [FEATURE-JOURNEY.md](../docs/FEATURE-JOURNEY.md) | §2 불변 원칙(필독) → §3 구조 → §4 트리거 현황. 이력·로드맵 = §6 |
| **싱크에이전트(Sync Agent)** — 고객사 DB 동기화 | **싱크에이전트** | [FEATURE-SYNC-AGENT.md](../docs/FEATURE-SYNC-AGENT.md) | §2 불변 원칙(필독) → §4 커서 규약 → §3 구조. 검증·출고 = 런북, 증상 진단 = TROUBLESHOOTING |
| **자동마케팅(Continuous Operator)** — 목표 자연어 → 주기 자동발송 | **자동마케팅** | [FEATURE-AUTOMARKETING.md](../docs/FEATURE-AUTOMARKETING.md) | §2 불변 원칙(필독) → §4 대상 판정 계약 → §3 구조. 리마인드 = §5, 뒤집힌 판단 = §8 |
| **알림톡 템플릿** — 템플릿·발신프로필 관리와 IMC 이관 | **템플릿** | [FEATURE-ALIMTALK-TEMPLATE.md](../docs/FEATURE-ALIMTALK-TEMPLATE.md) | §2 불변 원칙(필독) → §3 구조 → 이관이면 §4 절차. 이력 = §6·§8, 뒤집힌 판단 = §7 |
| **정산** — 청구서 발행·컨펌·세금계산서·특례 | **정산** | [FEATURE-BILLING.md](../docs/FEATURE-BILLING.md) | §2 불변 원칙(필독·13개) → §3 구조 → 작업 축별 §4~§6. 남은 것 = §7, 이력 = §8, **시점별 설계서 6종 = §9** |
| **이미지 스튜디오** — 템플릿 포스터 생성·소재 라이브러리 | **이미지 스튜디오** | [FEATURE-IMAGE-STUDIO.md](../docs/FEATURE-IMAGE-STUDIO.md) | §2 불변 원칙(필독) → 템플릿 추가면 **§4만** · 생성 흐름이면 §3 · 예시 배치면 §5. 남은 것 = §8, 뒤집힌 판단 = §9 |
| **자사몰 연동** — 6종 provider·CDP 적재·연동 화면 | **자사몰 연동** | [FEATURE-CDP-INTEGRATION.md](../docs/FEATURE-CDP-INTEGRATION.md) | §2 불변 원칙(필독·8개 — **§2-8 "자동 수집"은 도는 워커가 있을 때만·소급 적재 발송 금지**) → §4 provider 현황 → §3 구조. 화면이면 §5, 남은 것 = §7, 뒤집힌 판단 = §6-2, 권한 격리 = §6-4. API 스펙은 `INTEGRATIONS.md`, 화면 분해는 §8 링크가 소유 |

| **AI 학습 · 자기 개선 루프** — 성과 환류로 문안·시각이 스스로 나아지는 축 | **자기 개선 루프** / **AI 학습** | [FEATURE-AI-LEARNING.md](../docs/FEATURE-AI-LEARNING.md) | **§2 정체성(필독 — 우리는 아직 모델을 학습시키지 않는다)** → §3 불변 원칙 → §4 구조(**§4-1 `source_ref` 축은 경로마다 다르다**). 단계·착수 원장 = §6, 뒤집힌 판단 = §8 |
| **마케팅 플래너(AX 월간 대행)** — 월간 행사 계획 → 결재 → 무인 제작·실행 | **마케팅 플래너** | [FEATURE-MARKETING-PLANNER.md](../docs/FEATURE-MARKETING-PLANNER.md) | **§2 정체성(세 번째 시계 = 달력)** → §3 불변 원칙 8개 → §4 구조. 요금 = §5 · 단계 = §6 · 남은 것 = §8 · 뒤집힌 판단 = §9. **근거·실측 원장은 시점 설계서**(§10 링크)가 소유 |
| **AI 마케팅 진단** — 분기형 문진(6축 게이트+심화) → 스토리형 진단서 → FREE는 TRIAL 7일 자동 지급 / 잠재고객은 리드 | **마케팅 진단** | [FEATURE-MARKETING-DIAGNOSIS.md](../docs/FEATURE-MARKETING-DIAGNOSIS.md) | **§2 정체성(리포트가 본체·설문은 문진)** → §3 불변 원칙 8개(**3-1 화면은 게이트가 아니다 · 3-3 1회 한정은 DB가 강제**) → §4 구조 → **§12 v3~v5 원칙**(분기·관문 사다리·홍보 위치 계약). **문항·분기를 바꾸면 §5 버저닝 = `scripts/sql/` seed 파일**(코드 아님·터미널 붙여넣기 금지) · **리포트 문장은 `utils/marketing-diagnosis-copy.ts` 원장** · 문구·운영 §6 · 목업 §7 · 함정 §9. 시점 근거 = §10 링크(v3 설계서 = 회의 수렴·검증, **v6 설계서 = 다음 착수분 전량**) |
| **비토 게이트웨이** — 발송 마지막 구간(자비스 개발·실사용 0) · Agent 3대 전환 완료 | **비토 게이트웨이** | [FEATURE-BITO-GATEWAY.md](../docs/FEATURE-BITO-GATEWAY.md) | **§2 읽기 규약(필독 — ★0815 개정: 그쪽 CODEX·STATUS는 우리 관리, 나머지 편집 금지)** → §2-1 작업 규율 → §9 스포크 6종(`docs/bito-gateway/` — 0815 전수점검 축별 피더). 결함 관문 = §4 · Agent 현황 = §6 · 남은 것 = §8. **소스 = `C:\Users\ceo\projects\bito-gateway` (★0815 git 도입 — 수정은 Harold 승인 + 커밋 단위)** |
| **오퍼레이터 표면 단계(OUI)** — 허브 보라 무접촉 · 메뉴 안 작업면 slate-950 단색 + 바이올렛 액센트, 값 = `operator-ui.ts` | **오퍼레이터 표면 단계** | [2026-08-21-operator-surface-tier-design.md](../docs/2026-08-21-operator-surface-tier-design.md) | §3 체계 → §4 구현 → §6 불변식 → §7 별건 → §8 회의록 |

**등재 규칙** (★2026-08-03 Harold 확정 — 앞으로 모든 기능이 이 형태)
- **기능 하나 = .md 하나.** 그 문서가 자기 **이력**(§이력 색인)과 구조·불변 원칙·계약을 소유하고, STATUS는 **참조만** 한다. 트랙이 archive로 가도 기능 문서는 남는다.
- 신규 기능 작업이 생기면 먼저 이 표에 등재하고 문서를 만든다 — STATUS 카드에 경위를 쌓지 않는다(카드는 제목·링크·⛔·잔여 4줄).
- 기능 문서는 **상태·잔여를 쓰지 않는다**(STATUS §2 카드 소유). 시점별 설계 근거는 설계서, 절차는 런북/OPS가 소유하고 여기엔 링크만 — 정보 하나는 소유 문서 하나.

## 1) 활성 트랙 (STATUS §2에 카드가 있는 것)

| 트랙 | SoT 문서 | 읽는 범위 | 호출어 |
|---|---|---|---|
| **고객 360 타임라인 — 고객 1명 기준 발송·반응·구매·동의·자동화·문의 시간순 뷰** (AI CRM 1축 · 다음 = 인바운드 대화) | [2026-08-22-customer-360-timeline-design.md](../docs/2026-08-22-customer-360-timeline-design.md) | 착수 전 **§1 확정 사실(PG `messages`는 죽은 테이블 · 발송 진실 = MySQL) + §1-A 미검증 6건** → **§2 불변 원칙 8개(⛔1 발송은 MySQL만 · ⛔2 식별 = company+phone 펼침 · ⛔3 원천별 상한+truncated)** → §3 구조(카탈로그 §3-1 · API §3-3). **§5 확인 SQL 7건을 받기 전 코드 금지** · 성능 §4 · 단계 §6 · **격리 결함 §6-R-2** · 인바운드 접점 §9. **v2(2열 작업면 · 검색·기간 · 반복 접기) = [2026-08-22-customer-360-v2-design.md](../docs/2026-08-22-customer-360-v2-design.md)**(불변 §2 · 계약 §3-2 · 접기 §4 · 게이트 §5) | **고객 360** |
| **RCS 연동 — 대행사 모델 개통·젬텍 발송·대체문자·과금** | [2026-08-17-rcs-integration-design.md](../docs/2026-08-17-rcs-integration-design.md) | 착수 전 **§1 확정 사실(규격 실독 — 추측 0)** → §7 티켓 순서(7+선행 1) → 담당 축(게이트웨이 §3 · 한줄로 §4 · 화면 §5 · 결과 §6). **§8 실측 게이트를 먼저 본다**(성공 리포트 코드 미확정이면 그 코드를 쓰지 않는다) · 뒤집힌 판단 = §11 · T0 구현 결과·실행 SQL = §9 | **RCS 연동** |
| **AX 마케팅 플래너 시점 설계서** — 확정 경위·실측 근거 (기능 상설 = §0 **마케팅 플래너**) | [2026-08-12-ax-marketing-planner-design.md](../docs/2026-08-12-ax-marketing-planner-design.md) | 구조·불변 원칙·이력은 **기능 문서**가 소유 — 여기는 근거만: 확정 원장 §1 · 품질 전제 §4 · 요금 산정표 §3-3 · **실측 종결 원장 §9** · 뒤집힌 판단 §11 | **마케팅 플래너** |
| **마케팅 플래너 Phase 3·4 인계** — 실행 배선·깔때기 착수 원장 (기능 상설 = §0 **마케팅 플래너**) | [2026-08-13-planner-phase34-handoff.md](../docs/2026-08-13-planner-phase34-handoff.md) | 착수 시 전체(짧다) — 확정 실측 §1(재검증 불요) · 예정 DDL §2 · **재사용 실물 표 §3**(새로 만들지 마라) · 순서 §4 · **첫 grep 3건 §6**(코드 쓰기 전) | **마케팅 플래너 3,4** |
| **콘솔 화면 톤 통일 — 라이트 + 인디고** (카카오&RCS · 발송결과 · 수신거부 · 회사설정) | [2026-08-18-console-ui-unification.md](../docs/2026-08-18-console-ui-unification.md) | 화면 손대기 전 **§2 불변 원칙 6개(필독 — ⛔3 모달 껍데기에 backdrop-filter·transform 금지)** → §3 무엇이 어디를 소유하나. 이력 §4 · 남은 것 §5 · 뒤집힌 판단 §6. 값 자체는 `utils/console-ui.ts`가 소유 | **콘솔 톤** |
| **AI Operator 표면 개편 — 0821 Harold 판정 기각·종결**(라이트·단색·2차 C/B 전부 "기존이 낫다") | [2026-08-21-ai-operator-surface-design.md](../docs/2026-08-21-ai-operator-surface-design.md) | **§13 판정·종결만** 읽는다(다시 같은 안을 내지 않기 위한 기록). 실측 §2는 재사용 가능 | **AI Operator 표면** |
| **오퍼레이터 발송 축 — 출처(send_type) · 타겟(filters)** | [2026-08-18-operator-send-axis.md](../docs/2026-08-18-operator-send-axis.md) | 착수 전 **§1 확정 사실(재검증 불요)** → **§2 불변 원칙 7개(⛔1 'ai' 재사용 금지 = 이중 환불 · ⛔2 축을 늘리면 읽는 곳을 같이 늘려라)** → §3 구조. 이력·Codex 2R §4 · 남은 것 §5 · 뒤집힌 판단 §6 | **오퍼레이터 발송 축** |
| **전송자격인증제 — 인증기준 대조·개발 원장** | [2026-08-18-transmission-qualification-cert.md](../docs/2026-08-18-transmission-qualification-cert.md) | 착수 전 **§3 항목별 대조표**(코드 실측 — 무엇이 있고 없는지) → **§4 개발 8건**(규모순) → **§6 심사 위험**(23388 포트). 근거 문서 3종 절대경로 = 머리말. Harold 확인 4건 = §7 | **전송자격인증** |
| **접속 인계 — 이미 접속 중인 아이디로 로그인할 때** | [2026-08-18-session-takeover.md](../docs/2026-08-18-session-takeover.md) | 착수 전 **§1 확정 사실(재검증 불요)** → **§2 불변 원칙 8개(⛔1 동의 없으면 세션 쓰기 0 · ⛔4 인계 티켓은 API 인증 토큰이 아니다)** → §3 구조. 이력 §4 · 남은 것 §5 · 뒤집힌 판단 §6 | **접속 인계** |
| **싱크에이전트 사전 질의서** — 신규 고객 출고 게이트 (기능 상설 = §0 **싱크에이전트**) | [PREINSTALL-QUESTIONNAIRE.md](../sync-agent/PREINSTALL-QUESTIONNAIRE.md) | §1 고객 질문(전달본과 1:1) · **§2 회신→판정 매핑**(각 항목이 무엇을 결정하고 어겼을 때 어떤 사고였는지) · 출고 판정. 절차 소유 = 기능 문서 §8 출고 0단계 | **사전 질의서** |
| **보안 체계 — 방어 아키텍처·노출면 축소·WireGuard** | [2026-08-09-security-architecture-design.md](../docs/2026-08-09-security-architecture-design.md) | 착수 전 §4 설계 원칙(필독) → §5 단계별 순서(롤백 포함). 실측 현황 = §3 · 확인 과제 = §6. **추측 기재 금지 — 각 항목은 측정/문서/미확인 표기** | **보안** |
| **자사몰 연동 화면 재설계 — 상태 대시보드·3단계 흐름·개발자 전달** | [2026-08-09-cdp-integration-redesign-design.md](../docs/2026-08-09-cdp-integration-redesign-design.md) | 착수 전 §3 원칙 → §5 화면 흐름 → §7 단계별 순서(롤백). 현황 실측 = §2 · 착수 전 확인 4건 = §9. `install-status` 실측 신호 재사용이 핵심 | **자사몰 연동 재설계** |
| **자사몰 연동 화면 파일 분해(Phase 5)** — 2,499→1,491줄(40%↓) (기능 상설 = §0 **자사몰 연동**) | [2026-08-10-cdp-page-decomposition.md](../docs/2026-08-10-cdp-page-decomposition.md) | 또 가르기 전 **§2 분해 규약(필독 6개)** → 차수별 결과 §3 · **이 작업이 만든 사고 §4**(헬퍼 재작성 2회·죽은 코드·부재 단정 오선정) · 계약 9건 §5 | **자사몰 화면 분해** |
| **자동마케팅 타겟팅 재설계** — 세그먼트 계약·결정성·행동 축 확장 (기능 상설 = §0 **자동마케팅**) | [2026-08-03-automarketing-targeting-redesign-design.md](../docs/2026-08-03-automarketing-targeting-redesign-design.md) | 구조·불변 원칙·이력은 **기능 문서**가 소유 — 여기는 시점 설계 근거만(진단 §2 · 목표 구조 §4 · 착수 순서 §5) | **자동마케팅** |
| **여정 재설계 — 트리거 재정의·데이터 게이트·커서 축·연동 배선** (기능 상설 = §0) | [2026-08-01-journey-redesign-design.md](../docs/2026-08-01-journey-redesign-design.md) | 구현 결과 = §11-A~§11-D-7·§13-A·§14 · 트리거 정의 = §3 · 접은 예약 설계 = §12 | 여정 재설계 이어가자 |
| **여정 이어달리기(다음 수 추천)** — 배포완료·실측 대기 (기능 상설 = §0 여정) | [2026-08-08-journey-succession-design.md](../docs/2026-08-08-journey-succession-design.md) | 확정 사실(실측) §1 → 구조 결정 §2 → **구현 결과 §9-A**. 간선 계약 = §3, 함정 = §11 | **여정 이어달리기** |
| 정산 — 청구서 5항목·발행 단위·요금제 일할·에이전트 축 | [2026-07-26-billing-scope-and-corrections-design.md](../docs/2026-07-26-billing-scope-and-corrections-design.md) | §0-A(현재 상태·실측 확정값) → §9(이월) · 속도 결론 = **§9-9**. 0725 착수 기록 = [2026-07-25-billing-restructure-handoff.md](../docs/2026-07-25-billing-restructure-handoff.md) | — |
| 거래내역서 일괄발급·컨펌·세금계산서(팝빌) | [2026-07-28-bulk-invoice-confirm-taxbill-design.md](../docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md) | §9(종결 상태·이월) · §7-0(팝빌 API 요지) · §8(구현 순서) | — |
| 브랜드메시지 청구·발송 개방 + 청구 유형 축 CT | [2026-07-29-brand-message-billing-design.md](../docs/2026-07-29-brand-message-billing-design.md) | §7(오픈 전 남은 것) · 구조 이유는 §1~§5 | — |
| 정산 특례 — 추가 청구(080·부가서비스·최소과금)·발행 그룹 | [2026-07-30-billing-extras-and-groups-design.md](../docs/2026-07-30-billing-extras-and-groups-design.md) | §9(남은 것) → §7(확인 5건) · 착수 시 §6(발행 그룹) · 구조 근거 = §2-3·§3 | — |
| **0807 세션 인계 — 접수 4건 + 정산 점검** ✔**2026-08-08 종결**(착수 항목 소진·전량 배포) | [2026-08-07-session-handoff.md](../docs/2026-08-07-session-handoff.md) | 남은 것만 = **실측 3건**(§0 하단) · **별건 §3**(착수 판단 = Harold). §1 착수 항목은 전부 닫혔다 — 다시 진입하지 않는다 | (종결 — 재진입 없음) |
| 거래내역서 상세 구분 칸(웹 계정명·에이전트 발송ID) — 처리 완료 + 다음 세션 별건 5 | [2026-07-31-billing-detail-storeid-handoff.md](../docs/2026-07-31-billing-detail-storeid-handoff.md) | 전체(짧다). 결론 → 다음 세션 과제 5건(아이디룩 미발송 7,701건이 1순위) | **거래내역서 구분 칸** |
| 브랜드메시지 발송 경로 재구축(QTmsg Agent) | [2026-07-29-brand-message-qtmsg-agent-design.md](../docs/2026-07-29-brand-message-qtmsg-agent-design.md) | §5(착수 전 확정 4건) → §7(순서). 스펙 = §1·§2 | **브랜드메시지 발송경로 재구축** |
| 레거시 서버(27.102.203.143) 폐기 | [레거시서버_폐기_플랜.md](../docs/레거시서버_폐기_플랜.md) | 전체 (진행 시 갱신) | — |
| └ 하위: 에이전트 선불 충전·잔액 축 | [2026-07-24-agent-prepaid-charge-design.md](../docs/2026-07-24-agent-prepaid-charge-design.md) | 단독 재개용 — §5 충전 · §11 진단 · §12 백필 · §13 표시명 · §14 잔액 | — |
| 템플릿관리자 흡수 (Track B+C) | [2026-07-14-template-migration-track-bc-design.md](../docs/2026-07-14-template-migration-track-bc-design.md) | §1·§4(계약·이관 이력) | — |
| 싱크에이전트 빌드 산출물 검증·아난티 발송 | [2026-07-28-sync-agent-build-verification-runbook.md](../docs/2026-07-28-sync-agent-build-verification-runbook.md) | 전체 (실행 지시서) | **싱크에이전트 빌드 검증 이어가자** |
| 선불 자동충전 (기업은행 입금 감지) | [2026-07-28-auto-charge-ibk-design.md](../docs/2026-07-28-auto-charge-ibk-design.md) | 전체 (문안 2종·IBK 실측·착수 전 확인 2건) | **자동충전 개발재개** |
| 0718 프론트 스플리팅 사고 후속·성능 최적화 | [2026-07-18-frontend-splitting-incident-handoff.md](../docs/2026-07-18-frontend-splitting-incident-handoff.md) | §4(작업 순서) | 한줄로 최적화 이어가자 |
| 아임웹 앱스토어 등록·제출물(한줄로AI) | [imweb-appstore/app-intro-copy.md](../docs/imweb-appstore/app-intro-copy.md) + `deliverables/` | 전체 (연동 스펙은 INTEGRATIONS.md 아임웹 카드) | — |

## 2) 설계·정의 문서 (착수 대기·참조)

| 주제 | SoT 문서 | 읽는 범위 |
|---|---|---|
| AI Operator·CDP·Provider | [AI_OPERATOR_기능정의서.md](../docs/AI_OPERATOR_기능정의서.md) + [ai_operator_progress.md](ai_operator_progress.md) | 해당 절 |
| AI 영업 아웃리치(슈퍼관리자·ceo 전용) | [2026-07-31-ai-sales-outreach-design.md](../docs/2026-07-31-ai-sales-outreach-design.md) | 전체 — 착수 전 확정 = §13, 재사용 맵 = §6-1 |
| CRM 캠페인 대행(설계 대행) | [2026-07-09-crm-campaign-agency-implementation.md](../docs/2026-07-09-crm-campaign-agency-implementation.md) | 전체 |
| 요금제 무료 메시징(월 제공량·소진·정산 제외) | [2026-08-05-plan-free-messaging-design.md](../docs/2026-08-05-plan-free-messaging-design.md) | 전체 — 확정 대기 = §9 (Harold 확정 전 착수 금지) |
| DM 편집기 AI 퍼스트 재개편 | [2026-07-16-dm-editor-ai-first-redesign.md](../docs/2026-07-16-dm-editor-ai-first-redesign.md) | 전체 (Harold 검토 대기) |
| **원스텝 AI 컨텐츠 생성**(인터뷰형 마스터프롬프트 · 1차 = DM) | [2026-08-13-one-step-content-interview-design.md](../docs/2026-08-13-one-step-content-interview-design.md) | 전체 — 판정 원장 §0 · 질문표 §2 · 확정 원장 §6 · **착수 원장 §8** · 호출어 **원스텝 생성** |
| 인앱메시지 | [인앱메세지전용.md](../docs/인앱메세지전용.md) | 해당 절 |
| AI 규제 대응(고영향 판단·생성물 표시) | [compliance/](../docs/compliance/) | 해당 문서 (고영향AI 사전검토서 = 법 제31조 이행 기록) |
| 장기 로드맵·비전 | [한줄로_BEYOND_BRAZE_비전.md](../docs/한줄로_BEYOND_BRAZE_비전.md) | 해당 절 |
| 한줄로 미러링(62→59 복제·HA) | 미착수 — 설계 없음 | `memory/project_hanjul_mirroring.md` · 호출어 **한줄로 미러링 프로젝트** |

## 등재 규칙

- 신규 프로젝트 SoT는 **여기에만** 등재한다. STATUS 라우팅 표(12행 상설)는 도메인 문서 전용이라 늘리지 않는다.
- 트랙이 종결되면 이 표에서 지우고 `archive/INDEX.md` 경유로 넘긴다.
- 상태·잔여·⛔ 금지 조건을 여기 쓰지 않는다 — STATUS §2 카드가 소유한다(doc_ownership).
