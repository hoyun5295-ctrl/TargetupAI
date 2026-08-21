# 협업 규격 (COLLAB)

> **상시 로드 아님.** 아래 상황에서만 이 문서를 읽는다.
> - Harold님이 **"브레인스토밍"**이라고 말했을 때 → §1 전체 정독 후 그대로 진행 (의무)
> - 큰 작업 진입 직전 "어떤 skill을 써야 하나" 자문할 때 → §2
> - Codex 검증 라운드 운영·설치가 필요할 때 → §3
>
> 룰의 원천은 CLAUDE.md다. 이 문서는 **절차와 조회표**만 담는다. 여기 있는 내용이 CLAUDE.md 지시와 어긋나면 CLAUDE.md가 이긴다.

---

## 1) 에이전트 브레인스토밍 회의 (Harold 지시 2026-07-25)

### 1-1. 발동 조건

**목표 = 전원 합의로 최선의 안 1개를 도출한다**(★2026-08-21 Harold 명시 "전원합의체로 가장 베스트 아이디어를 도출하는 게 목표"). 의견 나열이 아니라 수렴이 산출물이다.

**Harold님이 "브레인스토밍"이라고 명시할 때만 연다.** AI가 임의로 소집하지 않는다.
그 외 모든 작업은 CLAUDE.md `no_parallel_tasks`대로 단독·순차 진행한다.

발동 시 즉시 이 문서 §1을 정독하고, 아래 절차를 건너뛰지 않는다.

### 1-2. 역할 소환표 — 업무 종류로 정하고, 해당 담당은 전원 부른다

| 업무 | 소환 역할 |
|------|-----------|
| 신규 화면·페이지 신설 / 전면 재작성 | 기획 · 프론트엔드 · 디자이너 · 백엔드 · 회의론자 |
| 백엔드·API·데이터·집계 | 기획 · 백엔드 · 회의론자 (표시 소비처가 있으면 프론트엔드 추가) |
| 발송·정산·돈 | 기획 · 백엔드 · 회의론자 (디자이너 제외) |
| 전면 개편 · 신규 트랙 | 전원 |

- **취사선택 금지**: 해당 칸의 역할은 빠짐없이 부른다.
- **무관한 역할은 애초에 부르지 않는다**: 데이터 배선 작업에 디자이너를 부르면 일반론만 나와 회의가 의례가 된다.
- **회의론자는 모든 회의에 고정**이다. 나머지 역할은 만드는 쪽이고, 부수는 자리가 없으면 낙관이 걸러지지 않는다.

### 1-3. 에이전트 타입 — 읽기 전용 강제

역할 에이전트는 **반드시 `Explore` 타입으로 소환한다.** Explore는 Edit/Write 도구 자체가 없어 파일을 수정할 수 없다.
지시로 "읽기만 하라"고 하는 것과 도구가 없는 것은 다르다. 도구 수준에서 막는다.

### 1-4. 역할별 정독 의무 — 근거 없는 의견은 채택하지 않는다

각 역할은 아래를 읽고 온 뒤에만 의견을 낸다. 읽지 않고 낸 일반론("여백을 일관되게", "로딩 상태 추가")은 주재자가 폐기한다.

| 역할 | 정독 대상 |
|------|-----------|
| 기획 | STATUS.md CURRENT_TASK + 요구사항 원문(티켓·접수 내용) |
| 프론트엔드 | lessons/LESSONS_FRONTEND.md + 대상 컴포넌트 실파일 |
| 백엔드 | lessons/LESSONS_BACKEND.md + 대상 컨트롤타워·라우트 실파일 |
| 디자이너 | lessons/LESSONS_FRONTEND.md 디자인 최소 기준 절 + 기준 화면(`/ai-journeys`) 실파일 |
| 회의론자 | lessons/LESSONS_META.md + 해당 도메인 LESSONS의 사고 이력 |

### 1-5. 출력 형식 고정 (4항목)

각 역할은 아래 4항목으로만 답한다. 산문 뭉치를 금지하는 이유는 주재자가 비교해야 하기 때문이다.

1. **제안** — 무엇을 어떻게 할 것인가
2. **위험** — 이 방식이 깨지는 지점
3. **우리 코드 근거** — 파일·행 번호. 근거 없으면 그 의견은 폐기 대상
4. **반박** — 다른 역할 의견 중 동의하지 않는 지점과 이유 (2라운드에서 채움)

### 1-6. 진행 절차 (주재자 = 본 AI)

1. **현황 파악** — 소환 전에 주재자가 먼저 한다. 안건이 흐리면 회의를 열지 않는다.
2. **안건 배포 + 소환** — 소환표대로 Explore 에이전트를 동시에 띄운다. 각 프롬프트에 §1-4 정독 대상과 §1-5 출력 형식을 명시한다.
3. **1차 의견 수집**
4. **교차 반박 1라운드** — 수집한 의견을 각 역할에 되돌려 반박을 받는다. 1라운드로 끝낸다.
5. **회의론자 최종 검증** — 수렴안을 회의론자에게 보내 "이대로 하면 어디서 깨지는가"를 받는다.
6. **주재자 수렴** — 정답 1개로 좁혀 Harold님께 제시한다.
7. **승인 후** 설계문서 `docs/YYYY-MM-DD-<주제>-design.md` 작성 → 자가 검토(빈칸·모순·범위·중의성) → Harold님 검토 → 구현.
8. **구현은 주재자 단독·순차.** 에이전트는 구현에 관여하지 않는다.

### 1-7. superpowers:brainstorming 스킬 접목

발동 시 `superpowers:brainstorming` 스킬을 호출해 그 체크리스트를 따른다. 단 아래 두 지점은 CLAUDE.md가 우선이므로 조정해서 쓴다.

| 스킬 기본 | 우리 적용 | 근거 |
|-----------|-----------|------|
| "2~3개 접근안을 제시" | **발산은 회의 안에서만.** Harold님께는 정답 1개만 올린다 | CLAUDE.md `no_option_recommend` |
| Visual Companion(브라우저 목업) | **비활성** | preview 도구 금지 (LESSONS_META) |
| 스펙 경로 `docs/superpowers/specs/...` | `docs/YYYY-MM-DD-<주제>-design.md` | 프로젝트 관례. 스킬도 "사용자 선호가 우선"이라 명시 |

스킬의 HARD-GATE(설계 제시·승인 전 구현 착수 금지)와 "질문은 한 번에 하나"는 그대로 지킨다. CLAUDE.md `workflow_4_1`과 같은 취지다.

### 1-8. 경계 — 넘지 않는 선

- 에이전트는 **읽기만** 한다. 파일 수정·승인권 없음.
- **코드 수정과 배포 판단은 주재자 단독.** 회의 결과는 입력이지 결정이 아니다.
- 회의는 **설계 단계에서 끝난다.** 구현 중 재소환 금지(범위가 늘어난다).
- 회의를 열었다고 CLAUDE.md 절차가 면제되지 않는다. 영향 검토·전수 grep·컨펌·Codex 검증 전부 그대로다.

---

## 2) superpowers 스킬 매핑 (조회표)

CLAUDE.md `superpowers_workflow_default`의 자가 질의("어떤 skill 호출 의무?")에 답할 때 참조한다.

| 상황 | 스킬 |
|------|------|
| 큰 작업 진입 직전(의도·요구사항 탐색) | `superpowers:brainstorming` — 우리는 §1 회의 규격과 함께 쓴다 |
| 다단계 작업 설계 | `superpowers:writing-plans` |
| 계획 실행 | `superpowers:executing-plans` (별도 세션) / `superpowers:subagent-driven-development` (본 세션 분할) |
| 신규 기능·버그 수정 | `superpowers:test-driven-development` (RED-GREEN-REFACTOR) |
| 완료 보고 직전 | `superpowers:verification-before-completion` — 실제 검증 명령 실행 + 증거 출력 의무 |
| 디버깅·원인 불명 | `superpowers:systematic-debugging` |
| 독립 과제 2건 이상 | `superpowers:dispatching-parallel-agents` — **단 우리는 쓰기 병렬 금지. 읽기·조사에만 해당** |
| 작업 공간 격리 | `superpowers:using-git-worktrees` |
| 작업 종결·머지/PR | `superpowers:finishing-a-development-branch` |
| 코드 리뷰 요청·수용 | `superpowers:requesting-code-review` / `receiving-code-review` |
| 신규 스킬 작성 | `superpowers:writing-skills` |

---

## 3) Codex 이중 검증 운영

호출 의무 단계와 면제 범위는 CLAUDE.md `codex_review_after_code_change`가 소유한다. 여기는 운영 방법만 담는다.

- **라운드 운영**: 본 AI 작성 → tsc 0 + 자가 grep → **본 AI 적대 검토** → Codex 호출 → 정정 → 재검증. **최대 2라운드**(★2026-08-04 5→2). `critical`·`high` 0이면 종료, `medium` 이하는 SoT 등재만. 범위·종료 조건의 원천 = CLAUDE.md `codex_review_after_code_change`.
- **지적 수용 원칙**: 무조건 수용하지 않는다. `superpowers:receiving-code-review`대로 실무 위험 기준으로 취사한다. 과한 처방(예: 연결 강제 종료)은 거부하고 단순한 대안으로 대체한 전례가 있다.
- **같은 스레드 이어가기**: 후속 라운드는 `SendMessage`로 기존 에이전트에 이어 붙인다. 새로 띄우면 앞 맥락이 사라진다.
- **설치**(최초 1회, Harold님 직접): `/plugin marketplace add openai/codex-plugin-cc` → `/plugin install codex@openai-codex` → `/reload-plugins` → `/codex:setup`

### 3-1. 실행 실무

**[CODEX-RUNBOOK.md](CODEX-RUNBOOK.md)가 소유한다** — 실행 순서(§1) · 요청문 규격 4항(§2) · 살아 있는지 판정(§3) · 멈췄을 때(§4) · 실패 이력(§5).
리뷰를 띄우기 **전에** §1·§2를 읽는다. 여기에 복사해 두면 둘이 갈라지고, 갈라진 쪽을 읽은 세션이 같은 멈춤을 다시 겪는다.
