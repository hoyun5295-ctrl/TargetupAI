# 한줄로 — 관제탑 (STATUS)

> **상시 로드 문서. 8KB 상한(★1105 · 트랙 목록 = STATUS-FEED §0). 룰 원천 = CLAUDE.md**(`doc_routing`) — 여기는 "라우팅"과 피더 문서로 가는 한 줄만. 상황이 생기면 아래 라우팅 표에서 문서를 찾아 **지시된 범위만** 읽는다. 아카이브는 archive/INDEX.md grep 경유로만(07-03 재설계 전 원본 복구 경로도 INDEX 상단).
>
> **한줄로와 무관한 개인 건(라우팅 표 밖)**: Harold님이 「아버지소송」을 말하면 `C:\Users\ceo\OneDrive\바탕 화면\아버지소송\STATUS.md`(상태·할 일·일지) → 같은 폴더 `CLAUDE.md`(규칙)를 읽는다. 그 폴더에는 한줄로 규칙을 적용하지 않는다.

---

## 1) 라우팅 표 — 이런 경우엔 이 문서

| 상황 | 참조 문서 | 읽는 범위 |
|------|-----------|-----------|
| DB 쿼리 작성 / 스키마 확인 | SCHEMA.md | 대상 테이블 절만 |
| 도메인 작업 착수 전 사고 이력 | lessons/LESSONS_{DB,FRONTEND,BACKEND,DEPLOY,ARCHITECTURE,META}.md | **도메인↔파일 매핑은 CLAUDE.md `read_lessons_first`가 소유**(여기 재서술 금지). 읽는 범위 = 해당 도메인 전체 · 배포는 OPS.md 해당 절 동반 |
| **Harold님이 "브레인스토밍"이라고 말했을 때** · 스킬 선택(mattpocock 한줄로 적용판) · Codex 라운드 운영·수용 판단 | **COLLAB.md** | 브레인스토밍 = §1 전체 정독 후 그대로 진행(의무) / 그 외 = 해당 절만 |
| **Codex 리뷰를 돌릴 때** — 실행 절차·요청문 규격·멈춤 판정·복구 | **[CODEX-RUNBOOK.md](CODEX-RUNBOOK.md)** | 착수 전 §1·§2(의무) / 20분 무응답이면 §3·§4. 리뷰를 띄우기 전에 반드시 읽는다 — 같은 멈춤을 다섯 번 반복했다 |
| **기능 이름을 부를 때** — 그 기능의 구조·불변 원칙·이력 | **[SOT-INDEX.md §0 기능 상설 SoT](SOT-INDEX.md)** | 해당 기능 행 → 그 기능 문서(목록은 §0이 소유). 기능 문서가 이력을 소유하고 STATUS는 참조만(신규 기능도 이 형태로 등재) |
| **프로젝트·트랙 SoT 문서·호출어를 찾을 때** | **[SOT-INDEX.md](SOT-INDEX.md)** | 해당 트랙 행만. **신규 프로젝트 SoT는 이 라우팅 표가 아니라 SOT-INDEX.md에 등재한다**(이 표는 도메인 문서 전용 상설) |
| 시스템 구조 파악 · **서버 사양·용도·리스크**(어느 서버에서 실행하나 / 자원 여유 / 무재부팅·노출 위험) | ARCHITECTURE.md · **[SERVERS.md](SERVERS.md)** | 구조 = 해당 절만 / 서버 = 해당 서버 절 + §3 리스크. **접속 절차·운영 명령은 OPS.md가 소유**(중복 금지) |
| 자사몰 연동·CDP·커넥터 작업 | INTEGRATIONS.md | 해당 provider 카드 / CDP 공통 절 |
| 버그 수정 · **결함 없애기 · 오류접수 · 구조체크** | BUGS.md · **[DEFECT-PLAYBOOK.md](DEFECT-PLAYBOOK.md)** | 버그 = 해당 항목(해결분 archive/BUGS_RESOLVED.md) / 결함 = 피더 전체(순서 · 닫기 칸 · 직원 지시문) |
| 과거 작업 조회·회귀 의심 | archive/INDEX.md → TASKS_YYYY-MM.md | grep 적중 항목만 |
| 의사결정 배경 확인 | DECISIONS.md | 해당 ADR |
| 리스크 전체 확인 | RISKS.md | 전체 |
| 싱크에이전트 **증상별 진단**(구조·원칙은 위 기능 문서) | SYNC-AGENT-TROUBLESHOOTING.md | 해당 증상 절 (isae 현장 완료 이력 = archive/SYNC-AGENT-ISAE-2026-06-30-HANDOFF.md grep) |
| 옛 설계서·핸드오프·디버그노트 | archive/DESIGNS/ (archive/INDEX.md 경유) | grep 적중 문서만 |
| Codex 등 외부 에이전트 온보딩·리뷰 판정 기준 | AGENTS.md (레포 루트) | 전체 (경량 유지 — 룰 원천은 CLAUDE.md, 여긴 축약판) |

---

## 2) CURRENT_TASK (활성 작업만)

> **트랙 목록(C · N · TODO) · 카드 원문 = [STATUS-FEED.md](STATUS-FEED.md)**(목록 = §0 · ★2026-11-05 여기서 글자 그대로 옮김 · 상시 로드 감축).
> **호출어 · C번호 · 작업 이름이 나오면 첫 명령 = `grep -n "<호출어>" status/STATUS-FEED.md` → 그 카드만 읽는다.** 새 트랙 = FEED §0 한 줄 + 카드 · 여기에는 목록 줄을 더하지 않는다.
> **배포 대기 · 배포 때 할 것 = [DEPLOY-LEDGER.md](DEPLOY-LEDGER.md)**(1027 · 「배포 시작하자」 때 먼저 연다 · 카드의 배포 상태는 원장 계산값).

---

## 3) 진행 예정 작업 (TODO)

> 목록 = [STATUS-FEED.md §0](STATUS-FEED.md#s0)(★2026-11-05 옮김 · 완료분 원문 = archive/DONE_LOG_2026.md).
> **기능 추가 우선순위(다음에 무엇을 만들까) = [ROADMAP.md](ROADMAP.md)**(★1108 정리 = 5순위 + 다음 세션 「압도 무기」 메모 §W · 1 ~ 4순위 · V2 = 끝 · 원문 = archive/ROADMAP-2026-11-08). 새 기능 착수 · 「다음 할 일」 · 「이 기능 있냐」 질문 때 먼저 연다.

---

## 4) 리스크·결정·완료 이력 — 전용 문서가 소유(★0814 §4~6 폐지)

> 리스크 = [RISKS.md](RISKS.md)(행동 지시는 CLAUDE.md 「개발 안전」) · 결정 = [DECISIONS.md](DECISIONS.md)(⚠ 2026-03-16 이후분 미등재 — 소급 등재 별도 과제) · 완료 이력 = [archive/DONE_LOG_2026.md](archive/DONE_LOG_2026.md) · 월별 [archive/INDEX.md](archive/INDEX.md) → TASKS_YYYY-MM.md grep
