# 전송자격인증 현장 실사 전 수정 묶음 설계안 (2026-10-21)

> 근거 = 2026-10-21 모의 실사(15개 질의 · Harold 운영 실행 출력) · 결함 대장 = `docs/transmission-cert/resubmit-1006/evidence/make_inspection_commands_xlsx.py` `DEFECTS`.
> 목표 = 2026-10-22 현장 실사 트집거리 0(Harold). 이 문서는 **코드 수정분**의 설계와 **운영 조치 목록**을 함께 적는다.
> 상태 = **설계안 · Harold 동의 전(코드 변경 0)**.

## 0. 범위

| 묶음 | 결함 | 한 줄 |
|---|---|---|
| S1 | D-03 · D-24 (+ 2.1 등록 · 변경) | 발신번호 · 배정 · 계정 · 수신거부 · 주소록의 등록 · 변경 · 삭제를 감사 기록에 남긴다 |
| S2 | D-01 · D-02 | 서버 관리 스크립트(시연 · 시험 회사 생성 · 정리)가 실행자와 삭제를 감사 기록에 남긴다 |
| S3 | D-25 · D-34 | 고객사 해지를 한 경로로 모은다(사유 필수 · 계정 잠금 · 세션 끊기 · 담당자 고지 · 기록) |
| S4 | D-17 | 입금 명의 보류 건을 고객사 소명 없이 승인하면 「확인 근거」를 반드시 받는다 |
| S5 | D-28 | DB 로그에 몇 분마다 찍히는 「컬럼 없음」 오류 두 가지를 없앤다(동작 불변) |

뺀 것: D-04 코드 수정(10/07 당일 끝남 · 일괄 교체 경로 삭제 = `status/OPS.md` 2-2-F) · D-22 · D-23 · D-30 · D-33(Harold 10-21 반박으로 결정).

## 1. S1 — 2.1 · 4.2 변경 이력 감사 기록

### 뿌리
등록 · 변경 · 삭제 경로가 표만 바꾸고 감사 기록을 남기지 않는다. 지금 2.1 발신번호 이력은 「등록 신청 · 심사 표」와 「현재 배정 상태」뿐이라, 직접 등록 · 수정 · 삭제 · 배정 해제가 이력에 없다. 계정 삭제 · 수신거부 삭제 · 주소록 삭제도 같다.

### 처방
기존 감사 기록 CT `utils/audit-log.ts` `recordAuditLog`(실패해도 본 동작에 영향 없음 · try/catch)를 각 쓰기 자리에서 부른다. 새 헬퍼는 만들지 않는다(같은 CT · 기록 종류 이름만 새로). 화면 라벨은 `frontend/src/constants/audit-action-labels.ts` 에 함께 넣는다(라벨 계약 테스트 `utils/__tests__/audit-action-labels.test.ts` 가 강제).

| 새 기록 종류 | 화면 라벨 | 쓰는 자리(파일:줄 · 10-21 기준) |
|---|---|---|
| `callback_number_created` | 발신번호 등록 | `routes/admin.ts:2550` POST /callback-numbers · `routes/manage-callbacks.ts:89` POST / · `utils/sender-registration.ts:367` approveRegistration |
| `callback_number_updated` | 발신번호 수정 | `routes/admin.ts:2628` PUT /callback-numbers/:id · `routes/manage-callbacks.ts:174` PUT /:id |
| `callback_number_default_changed` | 기본 발신번호 변경 | `routes/admin.ts:2719` · `routes/manage-callbacks.ts:247` |
| `callback_number_deleted` | 발신번호 삭제 | `routes/admin.ts:2701` · `routes/manage-callbacks.ts:215` |
| `callback_assignment_changed` | 발신번호 배정 변경 | `utils/sender-registration.ts` updateAssignmentScope(485) · assignUsersToCallback(501) · unassignUserFromCallback(543) · replaceAssignments(598) |
| `user_account_deleted` | 계정 삭제 | `routes/admin.ts:500` DELETE /users/:id · `routes/manage-users.ts:225` DELETE /:id |
| `unsubscribe_deleted` | 수신거부 삭제 | `routes/unsubscribes.ts:529` · `utils/unsubscribe-helper.ts` deleteIsolatedUnsubscribes(215) · deleteUserUnsubscribes(553) · `routes/sync.ts:310` reconcileSyncUnsubscribes(지운 건수 > 0 일 때만) |
| `address_book_deleted` | 주소록 그룹 삭제 | `routes/address-books.ts:332` |

기록 내용: 처리자 · 고객사 · 대상(발신번호는 번호 그대로 · 수신거부 번호는 `maskPhone` 가림 · 계정은 아이디) · 변경 전후(수정이면 `diffFields`) · 건수 · 경로(관리자 · 고객사 · 신청 승인 · 동기화).

### 영향
- 동작 변경 0 — 쓰기 뒤 기록 한 줄을 더할 뿐이고, 기록 실패는 본 동작을 막지 않는다.
- 발송 경로: 발신번호 · 배정은 발송 때 읽히지만 이 수정은 쓰는 자리만 건드린다(읽기 · 판정 무변경).
- 감사 기록 증가: 사람 조작 단위라 적다. 동기화 수신거부 정리는 지운 건수가 있을 때만 남긴다.

### 시험
라벨 계약 테스트(새 종류 누락 시 실패) · 쓰기 자리마다 「기록이 남는다 · 기록 실패가 응답을 바꾸지 않는다」 단위 테스트 · 전체 vitest.

## 2. S2 — 서버 관리 스크립트 감사 기록

| 자리 | 지금 | 바꾼 뒤 |
|---|---|---|
| `scripts/setup-demo-company.ts` · `scripts/create-noplan-account.ts` | 발급 기록의 경로가 `super_admin`(운영자 발급)인데 발급자가 비어 있다 | 경로를 `script` 로(라벨 「서버 관리 스크립트」) · 상세에 스크립트 이름 · 실행 OS 계정 |
| `scripts/purge-retired-demo-company.ts` | 회사 행과 데이터를 지우고 감사 기록이 없다 | 같은 트랜잭션 안에서 `company_purged`(라벨 「시연 회사 완전 삭제」) · 회사 이름 · 표별 지운 수 · 스크립트 · OS 계정 |

`AccountIssueChannel` 에 `script` 추가(`utils/account-issue.ts`) · 라벨 CT 에 `script` · `company_purged`. 지난 기록은 바꾸지 않는다.

## 3. S3 — 고객사 해지 한 경로

### 뿌리
해지 길이 둘이다. ① 해지 버튼 `routes/admin.ts:2153` DELETE /companies/:id = 계정 잠금 · 세션 끊기 · 기록(사유 · 고지 없음) ② 회사 수정 `routes/admin.ts:1580` PUT /companies/:id 의 `status = COALESCE($5, status)` = 상태만 바뀐다(잠금 · 세션 · 기록 · 고지 모두 없음 · 화면 `CompanyBasicTab` 선택지 「해지」). 10-21 실측 = 해지 회사 21곳 중 해지 기록 2곳 · 마트테스트 계정 2개 안 잠김.

### 처방
- 새 CT `utils/company-terminate.ts` `terminateCompany({ companyId, reason, note, actorUserId, req })` — **한 트랜잭션**에서 상태 해지 · 소속 계정 잠금 · 세션 끊기(`invalidateCompanySessions(id, client)` · 연결 인자 추가) · 감사 기록 `company_terminated`(사유 · 메모 · 변경 전 상태 · 잠근 계정 수 · 끊은 세션 수). 커밋 뒤 고객사 관리자 계정 번호로 문자 고지 → 결과 = 별도 기록 `company_termination_notice`(성공 수 · 실패 사유 · 실패 흡수). ★10-21 Codex 1R high 수용 = 해지됐는데 기록이 없는 상태가 생기지 않게 기록 · 세션을 트랜잭션 안으로.
- 고지 문구 · 발송은 기존 계정 조치 CT `utils/account-action.ts` 의 사유 문구표와 안내 문자 함수를 내보내 함께 쓴다(같은 인증 라인 · 운영 발송 라인 점유 안 함). 고지 실패는 해지를 되돌리지 않는다(같은 원칙).
- 해지 버튼 라우트는 이 CT 만 부르고 `reason`(contract_end · spam_report · admin_action) 필수 · 메모 선택. 화면 `CompaniesTab` 해지 확인 창에 사유 고르기 칸.
- 회사 수정 라우트는 상태를 「해지」로 바꾸는 요청을 400 으로 거부(「해지는 회사 목록의 해지 버튼으로 처리합니다」). 화면 `CompanyBasicTab` 상태 선택에서 「해지」 를 뺀다(이미 해지인 회사는 표시만).

### 영향
- 소비처: 해지 버튼 · 회사 수정 두 곳 · `companies.status='terminated'` 를 읽는 곳(`company-access.ts` 로그인 차단 · `billing-bulk.ts` · `billing-issue.ts` · `plan-term.ts` · `company-merge.ts`)은 읽기만 하므로 무변경.
- 고지 = 문자 발송(인증 라인 MySQL 적재) → 6원칙 ⑤ 실측 1건(당사 시험 회사 해지 → 담당 번호 수신 · 기록 확인 → 시험 회사 복구는 SQL 이 아니라 기존 화면 경로).
- 회사 병합(`company-merge.ts`)은 「옛 회사가 이미 해지」를 요구한다 — 병합 전 해지를 해지 버튼으로 하면 고지가 나간다. 병합용 해지는 사유 `contract_end` 로 고지 문구가 맞다(⚠ Harold 확인).

## 4. S4 — 입금 보류 승인 확인 근거

- 자리: `routes/admin.ts` 입금 승인(4200~4290 · `deposit_hold_resolved` 기록) · 화면 `components/admin/modals/DepositApproveModal.tsx`.
- 규칙: 보류(`held_reason` 있음)이고 고객사 소명(`explanation_note`)이 비었으면 승인 요청에 `confirmBasis`(확인 근거 · 10자 이상)가 있어야 한다. 없으면 400. 근거는 감사 기록 상세 `confirmBasis` 와 관리자 메모에 남긴다. 보류가 아니거나 소명이 있으면 지금과 같다.
- 돈 경로 · 승인 경로 → Codex 적대 검토 필수 · 시험 = 보류+소명 없음 근거 없음 400 / 근거 있음 승인 · 기록 / 비보류 승인 무변경 / 반려 무변경.

## 5. S5 — DB 오류 로그 두 가지(동작 불변)

| 오류 | 자리 | 처방 | 동작 |
|---|---|---|---|
| `cdp_push_subscriptions.is_active` 없음(몇 분마다) | `utils/source-aware-channel-selector.ts:132` · `utils/unified-customer-profile.ts:154` | 실제 컬럼 `status = 'active'` 로 고침(같은 표의 `utils/web-push.ts:218` 과 같은 조건) | 10-21 실측 활성 구독 0건 → 판정 결과 그대로(없음) |
| `kakao_templates.imc_template_status` 없음 | `utils/kakao-template-sync.ts:298` · `utils/kakao-template-guard.ts:38 · 52` · `utils/alimtalk-jobs.ts:333` · `routes/alimtalk.ts:1527` | **실제 「컬럼 없음」 실패가 난 뒤에만** 그 사실을 6시간 기억하고(실패 기반 캐시), 그동안은 그 컬럼을 넣은 SQL 을 보내지 않고 바로 지금의 대체 경로로 간다 · 사전 탐지(information_schema)는 쓰지 않는다 | 대체 경로(활성상태 가드 미적용 · 검수상태만 동기화)는 지금과 같다 → 동작 그대로 · 실패 SQL 이 몇 분마다 → 6시간에 한 번으로 |

기억 CT 는 `utils/kakao-template-guard.ts` 에 둔다(이미 「ALTER 전 안전 조회」를 소유). ⛔ 사전 탐지 캐시를 쓰지 않는 이유 = LESSONS_BACKEND 2026-09-12 「사전 탐지 캐시는 폴백을 구멍으로 바꾼다 · 폴백 갈래는 실제 실패로 판정한다」.

## 6. 공통 검증 · 배포

- 착수 전 = `status/lessons/LESSONS_BACKEND.md` · `LESSONS_DB.md` · `LESSONS_FRONTEND.md` 정독 · S1~S5 쓰는 컬럼 `information_schema` 확인(새 컬럼 · 표 0 · DDL 0).
- 검증 = BE tsc 0 · vitest 전체 · FE tsc 0 · FE `build:safe` · 모델명 노출 grep · Codex 적대 검토(지적 0 까지 · S4 · S3 는 돈 · 발송).
- 배포 = 오늘 밤 한 번(백엔드 재기동 1회 · 화면 빌드) — 같은 재기동에 D-16 한줄로 스위치(`ORIGIN_ALLOWLIST_ENFORCE_FROM`) 반영 · 게이트웨이 API 스위치는 게이트웨이 관리 API 재기동(환경 파일 위치 확인 뒤).
- 배포 뒤 실측 = S3 시험 회사 해지 1건(고지 수신 · 기록) · S1 시험 회사 발신번호 등록 → 삭제 기록 · S5 DB 로그 새 오류 0(`docker logs --since 30m`).

## 7. 운영 조치(코드 아님 · 실행 = Harold · 서수란 · 작성일 = 실제 날짜)

| # | 결함 | 할 일 | 누가 |
|---|---|---|---|
| O1 | D-04 · D-31 · D-19 · D-34 | 운영 기록 대장에 경위 기록(10/07 국내 대역 · 저널 개수 한도 · 출장 원격 접속망(진행 중) · 해지 기록 누락과 보완) | 서수란 작성 · 대표 확인 |
| O2 | D-05 | 테스트계정 유선 상한 지금 값 확인 · 1이면 화면에서 되돌림 | Harold |
| O3 | D-12 | 한줄로 `.env` 의 `GEO_BLOCK_ENFORCE_FROM` 중복 줄 하나 삭제 | Harold |
| O4 | D-15 | 이새 8/30 회사 API 범위 옛 예외를 화면에서 회수(⚠ 이새가 회사 API 를 안 쓰는지 확인 뒤) | Harold |
| O5 | D-16 | 연동 출발지 차단 스위치 두 개(배포 재기동 때) | Harold |
| O6 | D-26 | 불법스팸 금칙어 규칙 탐지 → 차단 전환(화면) | Harold |
| O7 | D-34 | 마트테스트(해지 · 시험 회사) 남은 계정 2개 잠금(화면) | Harold |
