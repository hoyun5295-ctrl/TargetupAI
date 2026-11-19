# C145 공개 페이지 세션 끊김 닫기 + 공개 페이지 방문 기록 — 흐름 표(결함 절차 1 · 2단계)

> 절차 = `status/DEFECT-PLAYBOOK.md` §1. 이 문서 = 1단계 흐름 표 + 2단계 판정. **Harold 확인 전 설계 · 처방 · 코드 0.**
> 접수(1119 Harold 원문) = ① 「JBN 전용사이트에 누가 보고있을때 그 사이트를 다른 사람이 들어오면 다른곳에서 접속했다고 하면서 끊어지는거 같은데 이게 뭔지 정확하게 파악이 안돼」 ② 「그 페이지 누가누가 들어왔었나 알아보는 방법은 없나?」 ③ 「전부 제대로 닫아 그리고 누가 봤는지 어떤 IP 가 들어와서 얼마나 머물렀는지 체킹하는거 만들어야겠다」

## 0. 판 대조(서버 지금 = 로컬)

- 원장 머리 a7426275(1114) 뒤 이 흐름의 파일 변경 = `pages/LoginPage.tsx` 만(03e5d93 C135 · 50b50da1 C136 · 둘 다 배포됨) · 나머지 여섯(`api/client.ts` · `hooks/useSessionGuard.ts` · `hooks/useSessionTimeout.ts` · `stores/authStore.ts` · `middlewares/auth.ts` · `utils/session-manager.ts`) 변경 0 · 미커밋 0(`git status --short` 빈 출력) · `App.tsx` = C144 8bfd3637(1118 배포)까지. → 서버 지금 = 로컬.

## 1. 실측(접수 시각의 일)

| 근거 | 본 것 |
|---|---|
| nginx 기록(Harold 실행 · 1119 09:30 ~ 10:59) | 10:02:23 `180.226.236.94` GET `/api/public/jbn/plans` 200(= JBN 페이지 열림) → 10:02:52 같은 IP GET `/api/auth/session-check` **401 · 103바이트** · 참조 `https://hanjul.ai/jbn` · 같은 구간 JBN 페이지를 연 IP = 이 하나 |
| 응답 크기 대조(node 실행) | 103바이트 = `{"error":"다른 곳에서 로그인되어 현재 세션이 종료되었습니다.","forceLogout":true}` · 93 = 「세션이 만료되었습니다…」 · 29 = `No token provided` |
| 같은 IP 의 다른 줄 | 09:52:07 `sys.hanjullo.com/admin` 세션 확인 401 · 103 / 10:18:14 `hanjul.ai/continuous-operator` 401 · 93 · 이 IP = 슈퍼관리자 `suran` 세션 IP(user_sessions · 1119 10:15:55 로그인) |
| 다른 브라우저 | `222.106.27.126` 이 `/login` 에 있으면서 10:09 ~ 10:59 30 ~ 60초마다 세션 확인 401 · 29(토큰 없이) |
| 로그인 안 한 브라우저(내 실행 · 운영 hanjul.ai/jbn) | 40초 넘게 요청 = `/api/send-policy` · `/api/public/jbn/plans` 둘뿐 · 세션 확인 0 · 끊김 창 0 |
| 미검증 | 180.226.236.94 브라우저에 남아 있던 한줄로 계정 · 그 세션을 끈 원인(같은 계정의 다른 로그인 · 계정 · 회사 단위 종료 중 무엇인지) |

## 2. 흐름 표 F — 세션이 끝나는 흐름(공개 페이지 · 로그인 페이지 공통)

뽑은 패턴(소스 grep · 손 목록 아님):
- 세션 행을 끄는 쓰기 = `grep -rn "user_sessions" packages/backend/src --include=*.ts | grep -i -E "is_active\s*=\s*false|DELETE FROM user_sessions"` + 함수 호출 `invalidate(App|Company|User)Sessions\(`
- 서버 401 = `middlewares/auth.ts` `authenticate` 의 `status(401)` 전부
- 화면 401 받는 자리 = `grep -rn -E "=== 401" packages/frontend/src` · 로그인 화면으로 보내는 자동 이동 = `grep -rn -E "href = '/login'|navigate\('/login'" packages/frontend/src`(누르는 단추 제외)
- 로그인 상태를 보는 전역 부품 = `App.tsx` 라우트 밖 부품(`SessionGuard` · `SessionTimeoutGuard` · `PageViewTracker` · `HelpDock` · `SecurityNoticeCard` · `DemoCompanyBanner`)
- 공개 경로 = `App.tsx` `<Route path=` 중 `PrivateRoute` 없는 줄 18: `/login` `/pricing` `/privacy` `/terms` `/cafe24/launch` `/payment/result` `/manager-board` `/journey-pause` `/journey-pause/:token` `/diagnosis` `/intro` `/jbn` `/proposal` `/agency-approve` `/charge-approve` `/planner-confirm` `/planner-recheck` `/autosend-stop`

### F1 세션 행이 꺼지는 자리(쓰기)

| 칸 | 쓰는 쪽 | 언제 | 판정 |
|---|---|---|---|
| F1-1 | `utils/session-manager.ts:46-54` `invalidateAppSessions` ← `rotateUserSession` `:433` | 같은 계정 · 같은 앱 새 로그인(살아 있는 세션이 있으면 「이미 사용 중」 동의 뒤 · 30분 넘게 움직임 없으면 묻지 않고) | 정상(1계정 1접속 규칙) |
| F1-2 | `session-manager.ts:62-76` `invalidateCompanySessions` ← `utils/company-terminate.ts:79` | 계약 해지 · 정지 | 정상(끊는 것 자체) |
| F1-3 | `session-manager.ts:81-87` `invalidateUserSessions` ← `routes/admin.ts:1438 · 1440` · `utils/account-action.ts:71` | 계정 정지 · 잠금 | 정상(끊는 것 자체) |
| F1-4 | `routes/auth.ts:467` | 그 세션 스스로 로그아웃 | 정상 |
| F1-5 | `middlewares/auth.ts:90` | 만료 시각이 지난 세션으로 요청 | 정상 |
| F1-6 | 슈퍼관리자 인계 기록 `routes/auth.ts:236-238` | 슈퍼관리자 새 로그인이 밀어냄 | **결함 후보** — 밀려난 쪽 IP 를 남기지 않는다(고객사 경로 `utils/login-issue.ts:141-146` 은 `takenOverIp` 를 남김) · 이번 조사에서 밀려난 자리를 기록으로 못 찾았다 |

### F2 서버 판정 — `middlewares/auth.ts` `authenticate`(세션 확인 `routes/auth.ts:952` 포함 모든 로그인 API)

| 칸 | 자리 | 들어오는 값 | 응답 | 판정 |
|---|---|---|---|---|
| F2-1 | `:42-44` | 토큰 없음 | 401 `No token provided`(29B · 강제 표식 없음) | 정상 |
| F2-2 | `:55-57` · `:68-70` | 토큰 꼴이 아님 · 세션 id 없음 | 401 `Invalid token` | 정상 |
| F2-3 | `:73-81` | 세션 행이 꺼짐 · 없음(F1-1 ~ F1-4 전부) | 401 `forceLogout` 「다른 곳에서 로그인되어 현재 세션이 종료되었습니다.」(103B) | **결함 후보(값 범위)** — F1-2 계약 해지 · F1-3 계정 정지도 같은 「다른 곳에서 로그인」 문구(F1-4 같은 브라우저 다른 탭 로그아웃은 토큰이 함께 지워져 F2-1 로 간다) |
| F2-4 | `:84-95` | 만료 | 401 `forceLogout` 「세션이 만료되었습니다…」(93B) | 정상 |
| F2-5 | `:119-121` | 서명 틀림 · JWT 만료(24시간) | 401 `Invalid token`(강제 표식 없음) | 정상(서버) · 화면 쪽은 F3-1 |

### F3 화면 — 401 · 세션 끝을 받는 자리

| 칸 | 자리 | 무엇을 하나 | 공개 경로에서 | 판정 |
|---|---|---|---|---|
| F3-1 | `api/client.ts:28-49` 공용 API 통로 | 모든 401 → `localStorage` 토큰 · 사용자 지움(**저장소 상태 `authStore` 는 안 지움**) · 강제 표식이면 사유 저장 · `/login` 이 아니면 `/login` 으로 이동 | 공개 페이지에서도 `/login` 으로 튕김 | **결함** |
| F3-2 | `hooks/useSessionGuard.ts:38-41` | `authStore.isAuthenticated` 이면 30초마다 세션 확인 | 로그인 흔적이 남은 브라우저면 공개 페이지에서도 돈다 | **결함(JBN 접수)** |
| F3-3 | `useSessionGuard.ts:44-49` | 탭이 다시 보이면 즉시 세션 확인 | 위와 같음 | **결함** |
| F3-4 | `useSessionGuard.ts:53-61` | 다른 탭에서 다른 토큰 저장 → 즉시 끊김 창 | 공개 페이지에서도 끊김 창 | **결함** |
| F3-5 | `App.tsx:164-181` `SessionGuard` | 끊김 창 → 「확인」 → `logout()` + `/login` | 공개 페이지에서 보던 화면(쓰던 신청서 포함)을 떠남 | **결함** |
| F3-6 | `App.tsx:252-260` + `hooks/useSessionTimeout.ts:97-129` | 1초마다 마지막 입력 뒤 시간 셈 → 기한(기본 480분 · `localStorage.sessionTimeoutMinutes` 남은 값이면 그 값)이 지나면 `logout()` + 사유 「장시간 활동이 없어 자동 로그아웃되었습니다」 + `/login` · **로그인 여부를 보지 않는다**(경고 창만 `isAuthenticated` 조건) | 로그인한 적 없는 방문자도 오래 두면 `/login` 으로 튕김 | **결함** |
| F3-7 | `stores/authStore.ts` `loadFromStorage` | 앱을 열 때 `localStorage` 토큰이 있으면 로그인 상태 | 서버에서 이미 꺼진 세션의 토큰도 「로그인」 → F3-2 를 켬 | 결함 사슬의 입구(F3-2 와 한 뿌리) |
| F3-8 | `App.tsx:225-249` `PageViewTracker` | 로그인 상태면 화면마다 `/api/auth/page-view`(직접 fetch · 401 무시) | 공개 페이지 접속도 「로그인 사용자 접속 기록」에 남음 | 정상(기록 대상 맞음) |
| F3-9 | `components/help/HelpDock.tsx:50` · `help-api.ts:42-47 · 88` | 토큰이 있고 숨김 경로가 아니면 도움말 봇 · 401 은 안 띄움 | 숨김 목록에 공개 경로 없음 → 살아 있는 로그인이면 JBN · 소개 · 요금 페이지에도 도움말 봇 | 판정 필요(아래 표 R) |
| F3-10 | `components/SecurityNoticeCard.tsx:79-81` | 로그인한 고객사 사용자면 보안 공지 카드 | 공개 페이지에도 뜸 | 판정 필요(아래 표 R) |
| F3-11 | `useSessionTimeout.ts:41-50` 세션 연장 | 입력이 이어지면 5분마다 연장(직접 fetch · 401 무시) | 공개 페이지에서도 연장 | 정상 |

### F4 로그인 화면

| 칸 | 자리 | 무엇을 하나 | 판정 |
|---|---|---|---|
| F4-1 | `pages/LoginPage.tsx:107-111 · 607` | 저장된 사유를 끊김 창으로 한 번 보여 주고 지움 | 정상 |
| F4-2 | F3-1 이 저장소 상태를 안 지움 + F3-2 | 로그인 화면에 와서도 「로그인 상태」라 세션 확인이 토큰 없이 계속 돈다(실측 222.106.27.126 · 50분 넘게 29B) | **결함** |

### 값 범위 축 — 브라우저 상태 × 경로

| 브라우저 상태 | 공개 경로 지금 | 로그인 필요 경로 지금 |
|---|---|---|
| v1 로그인한 적 없음 | 세션 확인 0 · 단 F3-6 기한이 지나면 `/login` | 들어가면 `/login`(정상) |
| v2 살아 있는 로그인 · 보는 중 다른 곳에서 같은 계정 로그인 | 끊김 창 → `/login` | 끊김 창 → `/login`(정상) |
| v3 이미 꺼진 세션의 토큰(JBN 접수) | 30초 안 · 탭을 다시 볼 때 끊김 창 → `/login` | 같음(정상) |
| v4 만료된 세션 | 「세션이 만료」 창 → `/login` | 같음(정상) |
| v5 JWT 만료(24시간) | 세션 확인 401(표식 없음) → F3-1 이 사유 없이 `/login` 으로 이동 | 같음(사유 없이 이동 = 판정 필요) |
| v6 F3-1 뒤 저장소만 로그인 상태 | 로그인 화면에서 확인 요청 반복(F4-2) | 같음 |
| v7 다른 탭에서 다른 계정 로그인 | 끊김 창 → `/login` | 같음(정상) |

### 화면 문구 축

| 문구 | 만드는 자리 | 그리는 화면 | 판정 |
|---|---|---|---|
| 「다른 곳에서 로그인되어 현재 세션이 종료되었습니다.」 | `middlewares/auth.ts:79` · `useSessionGuard.ts:29` · `client.ts:41` | `App.tsx` `SessionGuard` 창 · `LoginPage` 끊김 창 | **결함 후보** — F1-2 · F1-3 원인에도 같은 말(F2-3) |
| 「같은 계정이 다른 곳에서 로그인되어…」 | `useSessionGuard.ts:60` | `SessionGuard` 창 | 정상 |
| 「장시간 활동이 없어 자동 로그아웃되었습니다.」 | `App.tsx:258` | `LoginPage` 끊김 창 | **결함(v1)** — 로그인한 적 없는 방문자에게도 |
| 「이 아이디로 지금 다른 곳에서 사용 중입니다. 계속하면 그곳의 접속은 종료됩니다.」 | `session-manager.ts:419` | `LoginPage:564` | 정상 |

## 3. 흐름 표 V — 공개 페이지 방문 기록(지금)

| 칸 | 페이지 | 지금 남는 것 | 자리 | 머문 시간 | IP · 브라우저 |
|---|---|---|---|---|---|
| V-1 | `/intro` | 방문 1건(audit_logs `intro_view`) | `utils/intro-leads.ts:31` ← `routes/intro-public.ts:18` ← `IntroPage.tsx:146` | 없음 | 있음 |
| V-2 | `/proposal` | 로그인 뒤 열람(`/api/plans/proposal/view`) | C136 | 없음 | 있음(로그인 사용자) |
| V-3 | 로그인 필요 화면 전부 | `page_view`(로그인 사용자만) | `utils/access-log.ts:57` ← `routes/auth.ts:493` ← `App.tsx:225` | 없음 | 있음 |
| V-4 | 모바일 DM 뷰어 | 열람 · 머문 시간 증가분 · 스크롤(dm_views) | `utils/dm/dm-builder.ts:1029-1116` | **있음**(비콘 증가분 합산) | 있음 |
| V-5 | `/jbn` | **없음**(신청한 사람만 `jbn_applications` 에 닉네임 · IP) | `utils/jbn.ts:112` | 없음 | 신청자만 |
| V-6 | `/pricing` `/diagnosis` 등 나머지 공개 경로 | 없음 | — | 없음 | 없음 |
| V-7 | 서버 nginx 기록 | 모든 요청(시각 · IP · 경로 · 브라우저) | 서버 파일(셸로만 · 화면 0) | 없음(요청 시각뿐) | 있음 |

## 4. 결함 장부 요약(2단계 판정 · 처방은 Harold 확인 뒤 설계서에서)

| 번호 | 결함 | 칸 | 고객이 겪는 일 |
|---|---|---|---|
| D1 | 공개 페이지가 로그인 감시 · 끊김 창 · 로그인 화면 이동을 탄다 | F3-1 ~ F3-5 · F3-7 | 한줄로를 써 본 브라우저로 JBN · 요금 · 소개 · 승인 링크를 열면 보던 화면(쓰던 신청서)을 떠나 로그인 화면으로 |
| D2 | 자동 로그아웃 타이머가 로그인 여부를 안 본다 | F3-6 | 로그인한 적 없는 방문자도 오래 두면 로그인 화면 + 「자동 로그아웃」 안내 |
| D3 | 401 뒤 저장소 상태가 남아 로그인 화면에서 확인 요청이 계속 돈다 | F3-1 · F4-2 | 화면 영향 없음 · 서버에 쓸모없는 요청(실측 50분+) |
| D4 | 세션이 꺼진 이유와 상관없이 「다른 곳에서 로그인」 | F2-3 · 문구 축 | 계약 해지 · 계정 정지도 누가 들어온 것처럼 보임 |
| D5 | 슈퍼관리자 인계 때 밀려난 쪽 IP 미기록 | F1-6 | 끊김 조사 때 밀려난 자리를 못 찾음 |
| N1 | 공개 페이지 방문 기록 없음(JBN 포함) · 머문 시간은 어디에도 없음(DM 뷰어만) | V-5 · V-6 | 누가 봤는지 · 얼마나 봤는지 모름(새 기능) |

판정 필요(Harold) = F3-9 도움말 봇 · F3-10 보안 공지 카드가 공개 페이지에 뜨는 것 · v5 사유 없이 로그인 화면 이동.
