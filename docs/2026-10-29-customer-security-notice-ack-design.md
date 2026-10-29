# 고객 보안 점검 공지 · 확인 현황 설계서 (B 카드 + C 점검 기록 + D 공지 확인 현황)

- 작성 2026-10-29 · 상태 = **구현 · Codex 구현 1R 2 → 2R 1 → 3R approve → 4R approve(문구) · 1차 5264fa99 배포(구현 1R 수정본) · 후속 프론트 배포 대기(원장 C83-S2) · 운영 실행 계획 확인 대기(C83-S1)** · 설계 = §4 결정 5개 Harold 동의(1029 「추천대로」) · Codex 설계 3R approve(18:15)
- 구현 1R 수정 = 세 사건 모두 엄격 쓰기 한 길(1R 지적 1 · 설계 1R 과 같은 뿌리) · 확인 성공을 로그인 세대에 알림(지적 2) · 표식은 누른 순간의 로그인(자가 검토) / 2R = 확인 성공을 읽는 자리 한 곳(구독 뒤 표식 읽기 · 같은 뿌리) · 열람 기록 503 재시도 / 4R = C 문구를 실측(health · ready · 실행 판)까지로 정정
- 공용 CT 소비처(구현 전 · workflow 7-1 ①): `recordAuditLog` = 운영 코드 20 파일 58 호출 · 시험 10 파일 · 동작은 바꾸지 않고 본문만 `recordAuditLogStrict` 로 옮김 / `internal-company.ts` = 3 파일(system-alert `isInternalCompany` · 대행 메일 · CDP 재시도 `soleCompanyId`) · 새 함수만 더함
- Codex 설계 1R = 지적 6(높음 1 · 중간 5) 전부 수용 → ack 가짜 성공 · 에이전트 경로 · 사건 주인 · 사내 시험 회사 · 로그인 세대 · 판정 쿼리 비용을 §2 · §3 · §5 · §6 에 반영
- Codex 설계 2R = 지적 1(중간 · 판정 비용 · 1R 6번과 같은 뿌리) → 점검 조건을 늘리지 않고 쿼리 범위를 `startsAt` 으로 묶는 구조로 고침 · 확인 판정 4개(동시 중복 무해 · strict 꼴 · 토큰은 로그인 때만 · 끝 슬래시) 반영
- 목업 = 세션 scratchpad `security-notice-mockups.html`(A~D · Harold 선택 B + C + D)
- 관련 = 메모리 `project_2026_1029_kmc_notice_node_security_check` · 서버 처방(.65 · .66 Node 보안판)은 같은 세션 진행 중

## 0. 접수 원문과 축 대조표

| 접수(1029 Harold) | 이 축이 없으면 닫히는가 | 닫는 곳 |
|---|---|---|
| 「서버 두 군데 처방은 다른 세션으로 내리고 거기서 안전 팝업까지」 | 안 닫힘 | §2-3 B 카드 · C 점검 기록 |
| 「목업 좀 신경쓰자 · 디자인부터 고급스럽고 제대로 개발하는 기업이라는 느낌」 | 안 닫힘 | §2-3 시각 언어 = 목업 그대로 |
| 「그걸 확인한 업체가 누군지 체크할 수 있도록 보안인증 메뉴에 하나 추가」 | 안 닫힘 | §2-1 기록 3종 · §2-3 D |
| 「B + C + D 설계」 | 범위 확정 | 이 문서 |

빠진 축 0. A(로그인 공지 창)는 쓰지 않는다(전송자격인증 공지 창과 같은 자리에서 겹침).

## 1. 사실 (근거 = 실행 출력 · 코드)

| 사실 | 근거 |
|---|---|
| Node.js 2026-10-21 보안 공지 = 10건(고위험 4 · 중간 3 · 낮음 3) · 해결 판 24.22.1 · 22.23.4 · 26.12.1 | nodejs.org 공지 · `dist/index.json` (가) |
| 공지 문구의 사실은 서버 처방이 끝나야 참이 된다(.65 관리 API = Node 18.19.1 실행 중 · 1029 17:3x 기준) | Harold 출력 (나) |
| 고객 행동을 audit_logs 에 남기고 슈퍼관리자가 업체별로 보는 선례 = `utils/feature-interest.ts`(새 칸 · 새 테이블 0) | 코드 (가) |
| 슈퍼관리자 「보안 · 인증」 묶음 = `AdminDashboard.tsx` 2768 · 권한 원장 = `utils/admin-role.ts` · ENV 허용 목록 = `audit-log.ts` `isSuperAdminAllowed` | 코드 (가) |
| 로그인 뒤 첫 화면 = 일반 회사 `/dashboard` · 에이전트 전용 회사 `/kakao-rcs` · 카페24 복귀 → **대시보드에만 붙이면 에이전트 전용 회사는 못 본다** | `LoginPage.tsx` 125~135 (가) |
| 전역 도움말 버튼(HelpDock) = 오른쪽 아래 · App 라우트 밖 하나 · `data-interrupt-open` 표식이 켜지면 숨는다 · 숨김 경로 = `isHelpHiddenPath` | `HelpDock.tsx` · `lib/surface-flags.ts` (가) |
| 로그인 직후 자동 창 = 요금제 변경 알림 · AI Operator 소개 창(`z-[70]` 가운데) | `Dashboard.tsx` 262 · `AiOperatorLoginPromo.tsx` (가) |
| 사내 회사 판정 = `utils/internal-company.ts`(시연 `is_demo` + ENV `INTERNAL_TEST_COMPANY_IDS`) · 전역 집계 제외는 CT 가 준 id 목록으로(`listDemoCompanyIds`) | 코드 · SCHEMA.md 107 (가) |
| `users.user_type` = `admin` · `user` · `system`(사람 아님) · `companies.status` NULL = 활성 | SCHEMA.md (가 · 문서) · 코드에 쓰기 전 information_schema 확인 |
| audit_logs 를 action 으로 읽는 곳 = 8 파일, 전부 action 값 고정 거름 · 감사 로그 화면만 전체를 보여 주고 라벨은 `constants/audit-action-labels.ts` 가 소유 | grep (가) |

## 2. 설계

### 2-1 CT `utils/customer-notice.ts` (새 파일 · 판정 · 기록 · 집계 한 곳 · R1)

- **공지 원장** `CUSTOMER_NOTICES` = `[{ id: '2026-10-security-check', startsAt: '2026-10-29', showUntil: '2026-11-30' }]`. 지금은 하나. 날짜는 KST 글자로 비교한다(R16). `startsAt` 은 이 공지의 사건이 생길 수 있는 첫날이다. 판정 · 집계 쿼리는 모두 `created_at >= startsAt(KST 0시)` 로 읽는 범위를 묶는다.
- **기록 3종**(audit_logs · target_type `customer_notice` · details `{ noticeId, companyId }`)

  | 사건 | action | 남기는 순간 |
  |---|---|---|
  | 카드가 떴다 | `customer_notice_shown` | B 카드가 화면에 나올 때(한 화면에서 한 번) |
  | 점검 기록을 열었다 | `customer_notice_report` | C 화면을 열 때 |
  | 확인했다 | `customer_notice_ack` | 「확인했습니다」 |

  남기는 사람 = 고객사의 사람 계정만(슈퍼관리자 · 회사 없는 토큰 · `system` 계정 제외). 호출 상한 = 기능 관심 업체와 같은 1분 30회.
- **사건의 주인은 그 순간 값으로 남긴다(Codex 설계 1R)**: details = `{ noticeId, companyId, loginId }` 를 서버가 토큰에서 채운다. 집계는 `details.companyId` 로 회사에 붙이고, 확인한 계정 표시는 `details.loginId` 로 한다. 계정이 지워지거나 회사를 옮겨도 과거 확인은 그 회사 · 그 계정 이름으로 남는다.
- **쓰기 규칙(Codex 설계 1R)**
  - `ack` = 확인 상태의 원장이다. 실패를 삼키지 않는다(6원칙 ② 효과 검증 뒤 성공). `audit-log.ts` 의 지금 본문(NULL 기본값 · details JSON 직렬화 · req 에서 IP · User-Agent 추출 · INSERT)을 실패를 던지는 `recordAuditLogStrict` 로 옮기고, 기존 `recordAuditLog` 는 그것을 부르고 catch 하는 한 줄이 된다(갈라질 자리 0 · Codex 설계 2R). CT 는 ack 에 strict 를 쓴다. 같은 계정 · 회사 · 공지의 ack 가 이미 있으면 새로 쓰지 않고 성공. 저장도 기존 기록도 확인되지 않으면 실패 응답. 동시 요청 두 개가 행 두 개를 만들 수 있으나 판정 · 집계가 EXISTS · MIN 만 써서 무해하다(Codex 설계 2R 확인).
  - `shown` = 계정 · 회사 · 공지마다 처음 한 번만 남긴다(있으면 건너뜀). 화면도 한 로그인에 한 번만 보낸다. 집계에 횟수가 필요 없어서 쌓을 이유가 없다.
  - `report` = 여는 순간 기록 · 실패는 삼킨다(상태가 아니라 참고 기록).
- **띄울지 판정** `noticeForUser(user)` = 기간 안 공지 중 `user_id` · `details.companyId` · `details.noticeId` 가 모두 같은 ack 가 없는 것. 모르면(조회 오류) 띄우지 않는다. 한 로그인에 한 번만 부른다(카드가 로그인 세대마다 한 번 불러온다).
- **판정 비용은 구조로 묶는다(Codex 설계 1R · 2R · 같은 뿌리)**: 1R 에는 「색인이 있는가」 확인으로 답했는데, 색인을 타도 그 계정의 감사 기록 전체를 읽으며 거를 수 있어 비용이 계정 이력에 비례한다는 점이 남았다(2R). 그래서 쿼리 자체를 `user_id = $1 AND created_at >= startsAt` 로 묶어 색인 `idx_audit_logs_user (user_id, created_at DESC)` 의 범위 읽기가 되게 한다. 읽는 행 = 그 계정이 공지 시작 뒤 남긴 감사 기록뿐이고, 공지 기간(약 한 달)이 상한이다. §5 실행 계획 확인은 이 상한을 숫자로 재는 단계다.
- **집계** `loadNoticeAck(noticeId)` (슈퍼관리자 D 전용)
  - 대상 회사 = `status` 가 NULL 또는 `active` · 사내 회사 아님 · 사람 계정(`admin` · `user` · 활성) 1개 이상.
  - 사내 회사 제외(Codex 설계 1R): `listDemoCompanyIds` 는 시연 회사만 준다. `internal-company.ts` 에 시연 ∪ `INTERNAL_TEST_COMPANY_IDS` 합집합을 주는 `listInternalCompanyIds()` 를 더하고, SQL 에는 `NOT (c.id = ANY($n::uuid[]))` 로 묶어 넘긴다(R25 · 판정 한 곳).
  - 회사 상태 = 확인함(계정 하나라도 ack) > 보기만 함(shown 또는 report 만) > 아직 안 봄(기록 0). 상태는 사건이 정한다(R20 · 기본값으로 만들지 않음).
  - 시각 = 사건 시각(R18): 처음 본 시각 = shown MIN · 확인 시각 = ack MIN · 확인한 계정 = 그 ack 의 `details.loginId`.
  - 회사별 계정 상세(계정 · 본 시각 · 기록 열람 · 확인 시각 · 마지막 로그인)를 같은 응답에 싣는다(D 상세 창용 · 추가 호출 0).
  - 수는 SQL 묶음으로 전부 센다(기능 관심 업체 Codex 1R 교훈 · 행을 읽어 JS 로 세지 않음). 정렬 = 아직 안 봄 → 보기만 함 → 확인함, 안에서는 마지막 로그인 최근 순.

### 2-2 경로 (R15 · 주소마다 부르는 화면 있음)

| 경로 | 쓰는 화면 | 응답 |
|---|---|---|
| `GET /api/companies/notice/current` | B 카드 | `{ notice: { id } \| null }` |
| `POST /api/companies/notice/event` `{ noticeId, event }` | B 카드 · C 화면 | 204 · 모르는 값 · 원장에 없는 id 400 · ack 저장 실패 503(`code: NOTICE_ACK_NOT_SAVED` · 원문 0) · 기간이 끝난 공지는 report 만 받는다 |
| `GET /api/admin/customer-notice-ack/access` | D 메뉴 노출 | `{ allowed }` |
| `GET /api/admin/customer-notice-ack?noticeId=` | D 화면 | 집계 |

- 고객 경로는 `routes/companies.ts`(요금제 변경 확인 `plan-change/ack` 옆 · 새 라우터 마운트 0).
- 관리자 경로는 `routes/admin.ts` 의 기능 관심 업체 경로 옆(다른 세션이 고치는 sync-keys · geo 구간과 떨어진 자리).
- 5xx 응답에 오류 원문 0(R10).

### 2-3 화면

**B 카드** `components/SecurityNoticeCard.tsx`
- App 전역(HelpDock 옆 · 세션 가드 안)에 하나. 대시보드 · 카카오&RCS · 그 밖 어느 첫 화면이든 뜬다. 로그인 · 관리자 · 캔버스 화면은 `isHelpHiddenPath` 를 그대로 써서 띄우지 않는다.
- 떠 있는 동안 `useBodyFlag('data-interrupt-open')` 로 도움말 버튼을 숨긴다(같은 자리 겹침 0 · 새 장치 0). 겹침 순서는 자동 창(`z-[70]`)보다 낮다(R27 · 창이 닫히면 보인다).
- 버튼 = 「점검 기록 보기」(C 로 이동) · 「확인했습니다」(서버가 204 를 준 뒤에만 사라짐 · 실패하면 카드를 그대로 두고 「저장하지 못했습니다. 다시 눌러 주세요」 알림) · ✕(이번 로그인 동안 닫힘 · 다음 로그인에 다시). 휴대폰 = 화면 아래 좌우 12px 꽉 찬 카드.
- 로그인 단위 격리(Codex 설계 1R): 전역 자리(`SessionTimeoutGuard` 안)는 로그아웃해도 자식을 유지한다. 그래서 카드를 로그인 표식(계정 id + 토큰 끝부분) `key` 로 감싸 계정이 바뀌면 새로 그린다. 불러오기와 기록 요청은 그 로그인 세대에 묶어 세대가 바뀌면 늦게 온 응답을 버린다. 「닫힘」 · 「shown 보냄」 표식도 그 로그인 표식 아래에 둔다. 시험 = 로그인 A(카드 닫음) → 로그아웃 → 로그인 B(카드 뜸) · A 의 늦은 응답이 B 에 안 들어감.
- 역할 = `role="status"`(일을 막지 않는 알림 · 포커스를 빼앗지 않음).

**C 점검 기록** `pages/SecurityReportPage.tsx` · 경로 `/security-report`(로그인 필요)
- 목업 C 그대로: 인장 · 판정 띠(조치 완료 · 고객사 할 일 없음) · 진행 기록 4단 · 점검 항목 4줄 · 고위험 4건 표 · 「확인했습니다」.
- 문구 · 날짜 · CVE 목록 = 프론트 상수 하나(`constants/security-report.ts`). 서버가 아는 것은 공지 id 뿐이다.
- 연 순간 `report` 기록. 확인 뒤에도 다시 볼 입구 = §4 결정 3.
- 에이전트 전용 회사(Codex 설계 1R): `App.tsx` `AGENT_ALLOWED_PATHS` 가 `/kakao-rcs` · `/manage` 만 열어서 그대로 두면 「점검 기록 보기」가 `/kakao-rcs` 로 되돌려진다. `/security-report` 를 허용 목록에 더한다(읽기 전용 정적 화면 · 다른 메시징 업체에 보여 줄 대시보드 내용 0). 링크는 언제나 정확한 경로로 건다. 손으로 끝에 `/` 를 붙여 들어오면 기존 허용 경로들과 같이 `/kakao-rcs` 로 돌아간다(기존 동작 · Codex 설계 2R 확인). 다시 볼 입구는 설정 화면을 못 여는 에이전트 회사용으로 `/kakao-rcs` 화면에도 한 줄 링크를 둔다.

**D 공지 확인 현황** `components/admin/CustomerNoticeAckTab.tsx` · 「보안 · 인증」 묶음 끝 · 키 `noticeAck`
- 목업 D 그대로: 숫자 칸 4(사용 중 · 확인함 · 보기만 함 · 아직 안 봄 · 비율 띠) · 걸러보기(`아직 안 봄` 기본) · 표(정렬 · 빈 상태 · 휴대폰은 표 안에서만 가로 밀림).
- 행을 누르면 계정별 상세 창(커스텀 모달 · native dialog 0). 목업의 「업체 보기」는 회사 상세 창이 상태 묶음 70여 개를 받아야 열려서 빼고 이 창으로 바꾼다.
- 공지 고르기 칸은 공지가 둘 이상일 때만 보인다.

**시각 언어** = 목업 그대로(깊은 남색 + 에메랄드 하나 · 직접 그린 방패 인장 · 날짜와 CVE 는 고정폭 글꼴 · 칩 3종). 고객 문구에 가운뎃점 · 줄표 · 모델명 0.

### 2-4 권한

- 권한 원장 `admin-role.ts` 에 `noticeAck` = `{ super: 'R', lead: 'R', support: 'NONE' }`(보안 · 인증 묶음 규칙 = 대표 · 지원팀장).
- ENV `NOTICE_ACK_VIEWER_IDS`(기본 `ceo,suran`) AND 권한 원장 = `audit-log.ts` `isNoticeAckViewer`(기존 `isSuperAdminAllowed` 재사용).
- 읽기만 한다. 쓰기 · 지우기 경로 없음.

## 3. 영향표

| 대상 | 영향 | 처리 |
|---|---|---|
| audit_logs 를 action 으로 읽는 8 파일(admin.ts · billing-type-history · feature-interest · identity-status · intro-leads · login-block · ops-records · watch-alert) | action 고정 거름이라 새 값 3개는 안 잡힌다 | 없음 |
| 감사 로그 화면(전체 목록) | 새 action 3개가 보인다 | `audit-action-labels.ts` 에 라벨 3개 |
| HelpDock | 카드가 떠 있는 동안 숨는다 · 열린 도움말 창은 닫힌다 | 의도 · 카드는 로그인 직후에 뜨므로 실사용 겹침은 드물다 |
| 요금제 변경 알림 · AI Operator 소개 창 | 카드가 그 뒤에 깔린다 | 창이 닫히면 보인다 |
| 에이전트 전용 회사(`/kakao-rcs`) | 전역 마운트라 본다 | 대시보드 한정이면 영원히 「아직 안 봄」 |
| 슈퍼관리자 · system 계정 | 카드 없음 · 기록 없음 | CT 판정 |
| 시연 회사 · 사내 시험 회사 | 카드는 뜬다 · 집계에서 빠진다 | §4 결정 4 |
| 관리자 메뉴 계약 시험 `admin-security-menu-1003.test.ts` | 새 메뉴 키 | 목록에 `noticeAck` |
| `App.tsx` `AGENT_ALLOWED_PATHS` | 에이전트 전용 회사에 경로 1개가 더 열린다 | `/security-report` 만 · 정적 공지 화면 |
| `audit-log.ts` | 지금 본문을 `recordAuditLogStrict` 로 옮기고 `recordAuditLog` 는 그것을 부르고 삼키는 꼴로 바뀐다 · 공용 CT 라 호출부 전수 grep(workflow 7-1) | 바꾸기 전 동작 캡처 시험(NULL 기본값 · JSON · IP · UA · 실패 삼킴 · 반환값)을 먼저 두고 같은 결과를 확인 |
| `internal-company.ts` | 합집합 목록 함수 하나 추가 · 기존 `isInternalCompany` 동작 그대로 | 판정 원천(시연 CT · ENV) 재사용 |
| `KakaoRcsPage.tsx` · `Settings.tsx` | 다시 보기 링크 한 줄씩 | 화면 다른 부분 무접촉 |
| SCHEMA.md audit_logs action 줄 | 새 값 3개 | 문서 한 줄 |
| DB | 새 칸 · 새 테이블 0 · 쓰는 칸 = companies(status · company_name · is_demo 는 CT 경유) · users(id · company_id · login_id · user_type · is_active · last_login_at) · audit_logs | 코드 쓰기 전 information_schema 확인(시험 DB `t_tpl_closed` 조회 또는 Harold 실행) |

뿌리 대장: 새 뿌리 없음. 닿는 줄 = R1(판정 한 곳) · R10(오류 원문) · R11(화면 하한) · R15(죽은 주소) · R18(사건 시각) · R20(상태 = 사건) · R25(사내 회사 제외) · R27(겹침 순서).

## 4. 결정 (추천 포함)

1. **카드를 내리는 날** = `showUntil` 2026-11-30(추천). 그 뒤에는 카드만 멈추고 C 와 D 는 남는다.
2. **D 의 분모(사용 중 고객사)** = 상태 활성 · 사내 아님 · 사람 계정 1개 이상(추천). 휴면 · 정지 회사는 로그인하지 않으므로 넣으면 「아직 안 봄」이 잡음으로 쌓인다.
3. **C 를 다시 볼 입구** = 설정 화면 계정 보안 칸 아래 한 줄 링크 + 에이전트 전용 회사용 `/kakao-rcs` 한 줄 링크(동의 1029 · 에이전트 줄은 Codex 설계 1R 로 더함). 입구가 없으면 C 의 「언제든 다시 볼 수 있음」이 거짓이 된다.
4. **시연 회사에도 카드** = 띄운다(추천). 시연에서도 「점검하는 회사」 신호가 되고, 집계에서는 빠진다.
5. **싱크에이전트** = 문구에 넣지 않는다(추천). 1.7.2 이하 Node 20 에이전트는 엠티 말고 아직 갱신 전이라 「모두 갱신」을 약속할 수 없다. 문구는 서버 범위만 말한다.

## 5. 출고 순서

1. .66 · .65 Node 보안판 재시작 + 실측(모든 Node 프로세스 해결 판 이상) · 한줄로 로그인 · 발송 · 결과 조회 정상 확인.
2. C 의 날짜(적용 완료일)를 실제 완료일로 채운다.
2-1. 판정 · 집계 쿼리 비용(Codex 설계 1R · 2R): 배포 전 Harold 님이 운영에서 한 번씩 돌린다(명령은 그 시각에 하나씩).
   ① 공지 시작 뒤 감사 기록이 가장 많은 사람 계정 하나를 찾는다(ack 없는 계정 · 행 수는 Harold 실행).
   ② 그 계정으로 판정 SQL 의 `EXPLAIN (ANALYZE, BUFFERS)`. 합격 = `idx_audit_logs_user` 의 Index Cond 에 user_id 와 created_at 이 함께 걸림 · 실행 50ms 이하.
   ③ D 집계 SQL 의 `EXPLAIN (ANALYZE, BUFFERS)`(슈퍼관리자가 열 때만 · 기능 관심 업체와 같은 꼴). 합격 = 실행 2초 이하.
   하나라도 넘으면 배포하지 않고 색인부터 설계한다.
3. 구현 · 시험 · Codex 적대 리뷰 approve.
4. 배포 = 백엔드 재시작 + 프론트 빌드(업무시간 밖 · 백엔드 먼저).

1 이 끝나기 전에는 배포하지 않는다(카드 문구가 사실이 아니게 된다).

## 6. 시험 (tdd 접합면)

- CT 단위: 기록 대상 판정(슈퍼관리자 · system · 회사 없음 거절) · 이벤트 파싱 · 띄울지 판정(ack 있음 = 안 띄움 · 다른 회사의 ack 는 안 셈 · 기간 밖 = 안 띄움 · 조회 오류 = 안 띄움) · ack 저장 실패 = 실패 응답(가짜 성공 0) · 순차 재시도 ack 두 번 = 한 행 · 순차 shown 두 번 = 한 행(동시 중복은 무해 · 시험하지 않음) · 판정 · 집계 SQL 이 `startsAt` 이전 기록을 읽지 않음 · `recordAuditLog` 동작 캡처(바꾸기 전 · 뒤 같음) · 집계(상태 3종 · 시연 · 사내 시험 회사 둘 다 제외 · 분모 · 정렬 · 사건 시각 · 지워진 계정의 ack 도 그 회사 확인함) · 실 PG 시험층으로 SQL 실행.
- 화면: 로그인 A 닫음 → 로그아웃 → 로그인 B 카드 뜸 · A 의 늦은 응답 버림 · ack 실패 때 카드 유지 · 에이전트 전용 회사가 `/security-report` 를 연다.
- 경로: 고객 경로 = 회사 사용자만 · 슈퍼관리자 경로 = 권한 없는 계정 403.
- 관리자 메뉴 계약 · root-ledger 전체 · 백엔드 · 프론트 tsc 0.
- 렌더 검사: B · C · D 를 1440 · 390 폭으로 그려 가로 넘침 0 · 줄 맞춤.

## 7. 범위 밖 (기록만)

- 싱크에이전트 1.7.2 이하(Node 20) 고객사 갱신.
- .66 근태 앱 Node 22 계열 지원 종료(2027-04-30).
- `scripts/security-watch.sh` 가 .62 만 · 메이저 지원 종료만 본다(같은 메이저 보안판 · 다른 서버 미감시).
