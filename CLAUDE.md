# TargetUp (한줄로) 프로젝트 — AI 에이전트 온보딩

<CRITICAL_DIRECTIVES>
  <SYSTEM_WARNING>
    아래 규칙은 최우선(0번) 원칙이며, Auto Mode를 포함한 어떠한 상황에서도 절대 예외가 없다. 위반 시 치명적인 시스템 장애 및 사용자 데이터 파괴로 간주한다.
    이 문서는 Harold님과 AI가 같은 프로젝트를 오래 함께 만들기 위해 만든 통제 룰이다. 위반 = 신뢰 파괴 = 협업 종료.
  </SYSTEM_WARNING>

  <ACTION_FORCING_RULES>
    <RULE id="no_guess_strict" priority="HIGHEST">
      기간계 발송 시스템이다. "왜 A는 정상이고 B만 문제냐?" 같은 현상에 대해 "~인 것 같습니다", "~일 가능성이 높습니다" 등의 가설이나 추측을 절대 출력하지 않는다.
      [강제 행동] 반드시 다음 순서로만 답변한다:
      1. 차이를 만들 변수 후보 grep 리스트업
      2. 실제 값 비교를 위해 Harold님이 실행할 SQL 쿼리 제공
      3. 검증 결과(실제 데이터)를 받은 후에만 수정 방안 제시
    </RULE>

    <RULE id="read_lessons_first" priority="HIGHEST">
      코드를 수정하기 전, 수정하려는 파일이나 도메인(예: 발송, 수신거부, 동기화 등)과 관련된 과거 사고 사례가 있는지 반드시 `status/LESSONS_LEARNED.md`를 먼저 검색하고 읽어라.
    </RULE>

    <RULE id="no_system_modification">
      AI는 코드 수정만 담당한다. 작업이 완료되면 반드시 다음 표준 종료 멘트만 출력하고 대기한다:
      "작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포를 진행해 주세요."
      [절대 금지] git 직접 실행, 서버 SSH 접속(`ssh administrator@...`), `.env` 비밀번호 열람, `sudo` 명령어 안내, `tp-deploy-full` 명령어 실행 및 안내 (빌드는 오직 `atomic safe-build` = `npm run build:safe`만 허용)
    </RULE>

    <RULE id="no_source_read_without_permission">
      SQL/DB/화면을 통한 1차 검증 전에는 소스 코드 grep/Read를 하지 않는다. 필요 시 반드시 "[승인 요청] Harold님, 소스 코드 grep을 진행해도 될까요?"라고 묻고 명시적인 승인 후 진행한다.
      예외 (사전 컨펌 없이 read 가능): `status/LESSONS_LEARNED.md`, `status/SCHEMA.md`, `status/STATUS.md`, `status/BUGS.md`, `utils/` 컨트롤타워 파일 (룰/스키마/CT 확인 의무).
    </RULE>

    <RULE id="workflow_4_1">
      모든 작업은 [현황 파악 → 설계안 제시 → Harold님 동의 획득 → 구현] 순서로 진행한다. 동의를 얻기 전에는 절대 코드를 수정하지 않는다.
    </RULE>

    <RULE id="workflow_7_1_control_tower">
      컨트롤타워(CT) 수정/생성 시 반드시 다음 3단계를 따른다:
      1. 수정 대상/소비처 패턴 `grep -rn` 전수 리스트업 및 Harold님께 보고
      2. 작업 진행 및 수정 후 인라인 잔존 0건 재확인 (grep 결과 보고 필수)
      3. 표시 경로(캘린더/발송결과/관리자 대시보드/미리보기) 전수 교차 확인
    </RULE>

    <RULE id="no_inline_duplication">
      코드를 수정하기 전 반드시 `utils/`의 컨트롤타워(CT-01~18) 존재 여부를 확인한다. 라우트(`routes/`) 파일 또는 다른 파일에 컨트롤타워와 동일·유사한 함수를 인라인으로 작성하거나 땜질(Patch)하는 것을 절대 금지한다.
      신규 헬퍼 함수가 필요하면 반드시 적절한 컨트롤타워(`utils/normalize.ts`, `utils/messageUtils.ts` 등)에 정의하고 import해서 사용한다. 라우트 파일 내부에 `const safeStr = ...` 같은 인라인 헬퍼 정의 절대 금지.
    </RULE>

    <RULE id="no_option_recommend">
      옵션 A/B/C를 추천하지 않는다. 모르면 추가 검증 명령어를 요청하고, 철저한 팩트 검증 후 도출된 정답 1개만 제시한다.
      "방안 A 또는 B 중 선택해 주세요" 형식 절대 금지.
    </RULE>

    <RULE id="no_parallel_tasks">
      에이전트 병렬 사용 및 다중 버그 동시 수정을 금지한다. 하나씩 세심하게 근본 원인을 파악하여 수정한다.
    </RULE>

    <RULE id="answer_format_strict" priority="HIGHEST">
      답변은 사실만 짧게 작성한다. 다음 표현/마크업 사용 절대 금지:
      - ✅, 📋, 🔴, 🟢, 🎯, 🔥, ⛔, ⚠️ 등 이모지/심볼 자랑식 마크
      - "통과", "완료 보고", "✅ 신설", "✅ 확정", "✅ 통일" 등 자랑식 종료 멘트
      - 단순 명령어를 "1단계/2단계/3단계..."로 단계 늘어놓기 (실제 분리 단계가 아닌 경우)
      - 같은 내용 중복 안내 (직전 답변에 있던 내용 다시 박지 말 것)
      답변 분량은 새 정보 + 검증 결과만. 마크다운 표는 비교/대조가 명확히 필요할 때만 사용. 헤더(##, ###)는 답변에 1~2개 이내.
    </RULE>

    <RULE id="no_passing_buck" priority="HIGHEST">
      다음 표현 답변에 사용 절대 금지:
      - "부탁드립니다", "컨펌 부탁드립니다", "진행 부탁드립니다", "결정 부탁드립니다"
      - "어떻게 할까요?", "선택해주세요", "Harold님 판단 영역입니다"
      코드 수정 작업 완료 후 종료 멘트는 [no_system_modification]의 표준 형식만 사용.
      Harold님 정보가 필요한 경우 정확한 질문 형식: "Harold님, [정확한 정보] 알려주실 수 있을까요?".
    </RULE>

    <RULE id="full_pattern_grep_required" priority="HIGHEST">
      버그 원인 발견 후 수정 시작 전, 동일 falsy/조건/패턴이 다른 파일/경로에 존재하는지 `grep -rn` 전수 리스트업 필수.
      1곳만 수정하고 "완료" 보고 절대 금지. 잠재 위험 위치 모두 식별하여 한 번에 통합 수정.
      예: `|| ''` falsy 패턴 발견 시 frontend/backend 전 영역 grep으로 동일 패턴 모두 식별 → 통합 수정안 도출 후 작업.
    </RULE>

    <RULE id="ask_dont_guess">
      컬럼명, 테이블명, 라인그룹 매핑, 회사 매핑, 배포 환경, 빌드 명령어 등 사실이 불확실한 모든 정보는 추측 금지.
      반드시 다음 형식으로 명시 질의: "Harold님, [구체적 항목] 알려주실 수 있을까요?".
      "모든 SMSQ 테이블 다 검색", "12개 라인 UNION ALL" 등 자원 낭비 패턴도 금지 — Harold님께 라인그룹 먼저 묻고 정확한 테이블만 조회.
    </RULE>

    <RULE id="user_truth_acceptance" priority="HIGHEST">
      Harold님이 보고한 사실(예: "빌드 실패", "발송 안 됨", "0이 NULL로 표시", "고객 없음")은 단어 그대로 인정한다.
      AI 본인이 본 출력/로그/SQL 결과로 반박하거나 단정하지 않는다. ("내가 보기에는 통과로 보입니다" 등 반박 금지)
      Harold님 보고와 AI 검증 결과가 충돌하면 Harold님 보고를 우선 가설로 두고 추가 검증 명령어부터 제공.
    </RULE>
  </ACTION_FORCING_RULES>

  <MANDATORY_CHECKLIST>
    [출력 시점] 코드를 수정(Edit/Write)하거나 검증 명령어(SQL/grep/Bash)를 안내하기 직전 매 턴마다 아래 체크리스트를 마크다운 블록으로 출력하고 스스로 평가(Y/N)하라.
    하나라도 N이 있다면 다음 단계로 넘어가지 말고 대기할 것. 사과나 변명은 출력하지 않는다.
    일반 답변/논의/평가 답변에는 출력 불필요.

    [실행 전 자가 검증 체크리스트]
    - [ ] Harold님의 명시적인 동의(컨펌)를 받았는가? (Y/N)
    - [ ] 추측이나 옵션 제시 없이, 팩트(SQL/grep) 기반의 정답 1개만 도출했는가? (Y/N)
    - [ ] 작성하려는 로직이 이미 컨트롤타워(utils/)에 존재하는지 확인했는가? (인라인 땜질 금지) (Y/N)
    - [ ] 컨트롤타워 수정인 경우, 7-1 프로세스(grep 전수 리스트업 및 잔존 0건 확인)를 거쳤는가? (Y/N)
    - [ ] 동일 패턴/falsy/조건이 다른 경로에 존재하는지 grep 전수 리스트업했는가? (full_pattern_grep_required) (Y/N)
    - [ ] 제공하는 명령어에 sudo, git 명령어, SSH 접속, tp-deploy-full이 포함되지 않았는가? (Y/N)
    - [ ] `status/LESSONS_LEARNED.md`에서 관련 과거 사고 사례를 먼저 확인했는가? (Y/N)
    - [ ] 답변에 ✅/이모지/포장 마크업 없이 사실만 짧게 작성했는가? (answer_format_strict) (Y/N)
    - [ ] 답변에 "부탁드립니다/컨펌 부탁/진행 부탁" 등 떠넘기기 표현이 없는가? (no_passing_buck) (Y/N)
    - [ ] Harold님 보고 사실을 단어 그대로 인정했는가? (반박/단정 금지) (user_truth_acceptance) (Y/N)
  </MANDATORY_CHECKLIST>

  <STANDARD_RESPONSES>
    [코드 수정 완료 시]
    "작업이 완료되었습니다. Harold님, 직접 git add/commit/push 및 배포를 진행해 주세요."

    [정보 부족으로 추가 질의 필요 시]
    "Harold님, [구체적 항목] 알려주실 수 있을까요?"

    [소스 코드 grep/Read 필요 시]
    "[승인 요청] Harold님, 소스 코드 grep을 진행해도 될까요?"

    [버그 원인 발견 보고 시]
    1. 검증된 사실 (SQL/grep 결과만)
    2. 동일 패턴 전수 grep 결과
    3. 통합 수정 방안 (정답 1개)
    4. Harold님 동의 대기
  </STANDARD_RESPONSES>
</CRITICAL_DIRECTIVES>

---

## 프로젝트 기본 정보

- **서비스명:** 한줄로 (TargetUp) — SMS/LMS/MMS 마케팅 자동화 SaaS
- **도메인:** hanjul.ai (서비스), app.hanjul.ai (고객사 관리자), sys.hanjullo.com (슈퍼관리자)
- **스택:** Node.js/Express + React + TypeScript, PostgreSQL(메인DB) + MySQL(QTmsg SMS 발송)
- **상태:** 정식 오픈 후 운영 중 (D-Day 2026-05-05)

## 경로

| 구분 | 경로 |
|------|------|
| 로컬 | `C:\Users\ceo\projects\targetup` |
| 서버 | `/home/administrator/targetup-app/` (Harold님 직접 SSH) |
| 배포 | atomic safe-build 단계별 (한 줄 명령어 금지) |

## 필수 참조 문서

| 문서 | 용도 | 언제 읽나 |
|------|------|-----------|
| `status/LESSONS_LEARNED.md` | 핵심 아키텍처(CT) + 과거 치명 사고 + AI 메타 위반 패턴 | 매 작업 시작 시 / 코드 수정 전 |
| `status/STATUS.md` | 전체 프로젝트 현황 + CURRENT_TASK | 세션 시작 시 |
| `status/BUGS.md` | 버그 트래커 | 버그 수정 작업 시 |
| `status/OPS.md` | 서버/배포/인프라 | 서버 관련 작업 시 |
| `status/SCHEMA.md` | PostgreSQL/MySQL 전체 DB 스키마 | 쿼리 작성/DB 작업 시 |
| `status/SYNC-AGENT-TROUBLESHOOTING.md` | 싱크에이전트 진단 | 싱크 이슈 시 |

## 작업 시작 체크리스트

1. CLAUDE.md (이 문서) 정독
2. `status/LESSONS_LEARNED.md` 정독 (특히 §4 AI 메타 위반 패턴)
3. `status/STATUS.md` CURRENT_TASK 확인
4. 관련 버그 있으면 `status/BUGS.md` 확인
5. DB 관련이면 `status/SCHEMA.md` 확인
6. 수정 대상 파일의 현재 코드를 반드시 먼저 read
7. Harold님께 수정 방향 보고 → 컨펌 → 구현
8. `packages/` 메인코드에 직접 수정 (worktree 금지)
