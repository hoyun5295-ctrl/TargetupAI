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

**등재 규칙** (★2026-08-03 Harold 확정 — 앞으로 모든 기능이 이 형태)
- **기능 하나 = .md 하나.** 그 문서가 자기 **이력**(§이력 색인)과 구조·불변 원칙·계약을 소유하고, STATUS는 **참조만** 한다. 트랙이 archive로 가도 기능 문서는 남는다.
- 신규 기능 작업이 생기면 먼저 이 표에 등재하고 문서를 만든다 — STATUS 카드에 경위를 쌓지 않는다(카드는 제목·링크·⛔·잔여 4줄).
- 기능 문서는 **상태·잔여를 쓰지 않는다**(STATUS §2 카드 소유). 시점별 설계 근거는 설계서, 절차는 런북/OPS가 소유하고 여기엔 링크만 — 정보 하나는 소유 문서 하나.

## 1) 활성 트랙 (STATUS §2에 카드가 있는 것)

| 트랙 | SoT 문서 | 읽는 범위 | 호출어 |
|---|---|---|---|
| **AX 마케팅 플래너 — 월간 마케팅 대행(캘린더 기입→브리핑→승인 1000크레딧→실데이터 대행 제작→무인 실행)** | [2026-08-12-ax-marketing-planner-design.md](../docs/2026-08-12-ax-marketing-planner-design.md) | 착수 전 §1 확정 원장 → **§4 품질 전제(본체 — 실데이터 조립 계약)** → §3 요금 → §5 구조. 단계 = §8 · **미확인 9건 = §9(해소 전 착수 금지)** · 뒤집힌 판단 = §11 | **마케팅 플래너** |
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
| 인앱메시지 | [인앱메세지전용.md](../docs/인앱메세지전용.md) | 해당 절 |
| AI 규제 대응(고영향 판단·생성물 표시) | [compliance/](../docs/compliance/) | 해당 문서 (고영향AI 사전검토서 = 법 제31조 이행 기록) |
| 장기 로드맵·비전 | [한줄로_BEYOND_BRAZE_비전.md](../docs/한줄로_BEYOND_BRAZE_비전.md) | 해당 절 |
| 한줄로 미러링(62→59 복제·HA) | 미착수 — 설계 없음 | `memory/project_hanjul_mirroring.md` · 호출어 **한줄로 미러링 프로젝트** |

## 등재 규칙

- 신규 프로젝트 SoT는 **여기에만** 등재한다. STATUS 라우팅 표(12행 상설)는 도메인 문서 전용이라 늘리지 않는다.
- 트랙이 종결되면 이 표에서 지우고 `archive/INDEX.md` 경유로 넘긴다.
- 상태·잔여·⛔ 금지 조건을 여기 쓰지 않는다 — STATUS §2 카드가 소유한다(doc_ownership).
