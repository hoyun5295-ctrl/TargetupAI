# 여정 자동화(AI Operator) 재설계 — 경량화 · 모던화 · 모달화 · 기능 강화

작성일: 2026-06-29 · 승인: Harold (방향 + 구현 착수 명시)
대상 파일: `packages/frontend/src/pages/JourneysPage.tsx` (2718줄), `packages/frontend/src/components/journey/InfoAlertJourneyBuilder.tsx`

## 배경 / 불만 (Harold 명시)
- 상단 `마케팅 여정` / `정보 알림` 두 카드가 절반 폭만 쓰고 우측이 비어 보임 → 빈 공간 싫음.
- 전체 메뉴를 보려면 아래로 스크롤해야 함 → 경량화 필요.
- 며칠째 이어온 흐름: 경량화 + 디자인 모던화 + 버튼 클릭 모달화.
- 정보 알림 화면: `다음 — 흐름 검토` 버튼과 여정 목록이 마진 0으로 붙어 어색함.

## Harold 4대 지시
1. 자연어 입력 시 제대로 된 여정 구성이 나올 것(생성 품질) + 자연어 입력은 크게 유지. 왼쪽=자연어 입력, 오른쪽=마케팅/정보알림 두 버튼(위아래).
2. 전체 모던화 + 경량화 + 기능 나열이 아닌 클릭 시 모달화 + 빠른 시작 버튼 중앙정렬.
3. 브레이즈를 넘는 압도적 편리함 기능 추가(마케팅 기획자 관점 제안).
4. 각 여정 설계 화면의 편리함 + 난잡함 제거.

## 현황 요약 (실측)
- 메인 뷰(`view==='main'`): 두 목적 카드(`grid-cols-2`, 1158) → `purpose` 토글로 인라인 분기. marketing이면 큰 자연어 카드(1188) + 빠른 시작 7카드(1216), info-alert면 `InfoAlertJourneyBuilder` 인라인(1176). 그 아래 여정 목록(1243).
- `purpose` 사용처: 421(state), 1161/1168(토글 class), 1175(분기), `handleInfoAlertBuild`가 빌드 후 `setPurpose('marketing'); setView('review')`(939).
- 검토 뷰(`view==='review'`, 1896~): AI 근거 배너 + 기본설정 2×2 + step 세로 타임라인(1954~). 각 step 카드가 wait(대기 방식 3종)·condition(타입 3종, 다중 select)·message(채널/광고토글/원본·미리보기 토글/textarea/바이트/경고/다듬기/A·B)를 인라인으로 쌓아 무거움(난잡함의 실체). 하단 sticky 저장/활성화 바(2547).
- 모달 패턴: `ConfirmModal`(createPortal, z-[2000]) / `JourneyPauseLogsModal`(z-50 content modal). 다크 톤 = `bg-slate-900 border-white/10 rounded-2xl shadow-2xl`.

## 변경 설계

### Phase 1 — 메인 화면 재구성 (지시 1·2, 정보 알림 모달화)
- 상단을 좌우 2단 그리드(`lg:grid-cols-[1.7fr_1fr]`, 모바일 1단)로:
  - 좌: 자연어 입력 카드 확대(textarea rows≈3, Enter 전송 / Shift+Enter 줄바꿈) + 큰 `AI 생성` 버튼. 우측 빈칸 제거 + 세로 압축.
  - 우: `마케팅 여정`(기본 활성) / `정보 알림` 두 버튼 위아래.
- `정보 알림` 클릭 → 인라인 페이지 교체 폐기, **모달**(createPortal, 다크 톤, z-50)로 `InfoAlertJourneyBuilder`를 띄움. → `다음 — 흐름 검토` 버튼이 여정 목록과 붙던 문제 자연 해소.
- 빠른 시작 7개 → 중앙정렬 칩(`flex flex-wrap justify-center`, pill).
- 결과: 여정 목록이 한 화면 위로 올라옴.
- `purpose` state 유지(최소 변경). info-alert이면 모달 렌더. 닫기·뒤로·빌드 완료 시 `setPurpose('marketing')`.
- `InfoAlertJourneyBuilder`에 `embedded?: boolean` 추가 — 모달 안에서는 자체 헤더(뒤로 화살표+제목) 숨김(모달 헤더가 대신).

### Phase 2 — 검토(설계) 화면 난잡함 제거 (지시 4)
- 각 step = 한 줄 요약 카드(순번 · 유형 · 채널 · 타이밍 · 본문 1줄). `편집` 버튼 → step 편집 모달에서 wait/condition/message/A·B/알림톡 상세 처리.
- 기본 설정(이름·회신·예산)도 요약 + 편집 모달 또는 접이식.
- 상단에 흐름 다이어그램 한 눈.
- 신규 컴포넌트 `JourneyStepEditModal`로 인라인 편집기 이전(컨트롤타워 인라인 중복 금지 — 편집 로직은 모달 컴포넌트 1곳).

### Phase 3 — 플래그십 "오늘의 여정 기회" (지시 3)
- 랜딩 최상단에 AI가 회사 실데이터를 훑어 돈이 새는 지점을 수치와 함께 제시 + 1클릭 생성.
  - 예: 장바구니 이탈 N명 회복 여정 없음 / 신규 N명 환영 여정 없음 / VIP N명 90일 무구매 이탈 위험.
- 수치는 회사 실데이터로만 산출. 데이터 부족 시 `insufficient_data` 정직 표시(임의 상수 금지 — feedback_no_arbitrary_constants).
- 신규 backend endpoint 필요(집계). **SQL 작성 전 information_schema로 컬럼/테이블 실존 검증 의무**(db_column_verify_before_code) — Harold에게 검증 SQL 먼저 제공 후 코드 작성. DB ALTER 미실행 케이스 catch에 `column does not exist` 503 분기(db_alter_safety_net).

### 이후 — 뒷받침 기능(토대 존재, 끌어올리기)
- 대화형 여정 수정(생성 후 자연어로 흐름 수정).
- 켜기 전 30일 성과 예측(simulate 강화).
- 자가 최적화 알림(step-diagnosis·성과학습 토대 → 목록/기회 카드로 노출).

## 진행 순서 / 위험
- Phase 1·2 = 프론트만, 발송·돈 무관, 위험 낮음. tsc 0 + 모델명/native dialog/박-단어 grep 0건 자가 검증.
- Phase 3 = backend 신규, 발송 아님이나 DB 집계 → information_schema 검증 게이트 선행. 별도 설계서로 분리.
- 발송·돈 경로 무변경(저장 body·검증·발송 흐름 그대로). 검토 화면은 표시/편집 UX만 재구성, 저장 payload(`aiPkg.steps`) 동일.

## 검증 시나리오
- Phase 1: 메인 진입 시 좌우 히어로 + 중앙 칩 + 목록 한 화면. 정보 알림 클릭 → 모달. 빌드 → 검토 뷰 진입. 모바일 1단 스택.
- Phase 2: 검토 진입 시 step 요약 카드. 편집 클릭 → 모달. 저장 payload 동일(발송 형태 불변).
