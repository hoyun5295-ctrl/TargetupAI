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

**등재 규칙** — 기능 문서는 상태·잔여를 쓰지 않는다(STATUS §2 카드 소유). 시점별 경위·근거는 설계서 소유, 여기엔 링크만.

## 1) 활성 트랙 (STATUS §2에 카드가 있는 것)

| 트랙 | SoT 문서 | 읽는 범위 | 호출어 |
|---|---|---|---|
| **여정 재설계 — 트리거 재정의·데이터 게이트·커서 축·연동 배선** (기능 상설 = §0) | [2026-08-01-journey-redesign-design.md](../docs/2026-08-01-journey-redesign-design.md) | **다음 = §12(예약·날짜축·중단)** → 그 다음 §13(화면). 둘 다 착수 가능 수준 완성. 구현 결과 = §11-A~§11-D-7 · 트리거 정의 = §3 | **여정 예약 착수**(§12) · 여정 재설계 이어가자(전체) |
| 정산 — 청구서 5항목·발행 단위·요금제 일할·에이전트 축 | [2026-07-26-billing-scope-and-corrections-design.md](../docs/2026-07-26-billing-scope-and-corrections-design.md) | §0-A(현재 상태·실측 확정값) → §9(이월) · 속도 결론 = **§9-9**. 0725 착수 기록 = [2026-07-25-billing-restructure-handoff.md](../docs/2026-07-25-billing-restructure-handoff.md) | — |
| 거래내역서 일괄발급·컨펌·세금계산서(팝빌) | [2026-07-28-bulk-invoice-confirm-taxbill-design.md](../docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md) | §9(종결 상태·이월) · §7-0(팝빌 API 요지) · §8(구현 순서) | — |
| 브랜드메시지 청구·발송 개방 + 청구 유형 축 CT | [2026-07-29-brand-message-billing-design.md](../docs/2026-07-29-brand-message-billing-design.md) | §7(오픈 전 남은 것) · 구조 이유는 §1~§5 | — |
| 정산 특례 — 추가 청구(080·부가서비스·최소과금)·발행 그룹 | [2026-07-30-billing-extras-and-groups-design.md](../docs/2026-07-30-billing-extras-and-groups-design.md) | §9(남은 것) → §7(확인 5건) · 착수 시 §6(발행 그룹) · 구조 근거 = §2-3·§3 | — |
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
| DM 편집기 AI 퍼스트 재개편 | [2026-07-16-dm-editor-ai-first-redesign.md](../docs/2026-07-16-dm-editor-ai-first-redesign.md) | 전체 (Harold 검토 대기) |
| 인앱메시지 | [인앱메세지전용.md](../docs/인앱메세지전용.md) | 해당 절 |
| AI 규제 대응(고영향 판단·생성물 표시) | [compliance/](../docs/compliance/) | 해당 문서 (고영향AI 사전검토서 = 법 제31조 이행 기록) |
| 장기 로드맵·비전 | [한줄로_BEYOND_BRAZE_비전.md](../docs/한줄로_BEYOND_BRAZE_비전.md) | 해당 절 |
| 한줄로 미러링(62→59 복제·HA) | 미착수 — 설계 없음 | `memory/project_hanjul_mirroring.md` · 호출어 **한줄로 미러링 프로젝트** |

## 등재 규칙

- 신규 프로젝트 SoT는 **여기에만** 등재한다. STATUS 라우팅 표(12행 상설)는 도메인 문서 전용이라 늘리지 않는다.
- 트랙이 종결되면 이 표에서 지우고 `archive/INDEX.md` 경유로 넘긴다.
- 상태·잔여·⛔ 금지 조건을 여기 쓰지 않는다 — STATUS §2 카드가 소유한다(doc_ownership).
