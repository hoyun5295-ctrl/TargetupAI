# D130 알림톡/브랜드메시지 IMC 연동 — 세션 핸드오프 문서

> **작성일:** 2026-04-18 (Day 1 + Day 2 연속 세션 완료)
> **다음 세션 착수 전:** `CLAUDE.md` → `status/ALIMTALK-DESIGN.md` → **본 문서** 순서로 읽기.
> **핵심:** Day 2까지 승인 워크플로우 + 템플릿 소유자 체크 전부 완료. 배포 대기 상태.

---

## 1. 전체 진행 상태 요약

| 영역 | 상태 | 비고 |
|------|------|------|
| DB 스키마 (기본) | ✅ 서버 적용 완료 | 19/40 컬럼 + 9 테이블 (2026-04-18 오전) |
| DB 추가 ALTER (승인·소유자) | ✅ 서버 적용 완료 | `kakao_sender_profiles` 24컬럼 / `kakao_templates` 41컬럼 (2026-04-18 Day 2) |
| CT-16 / CT-17 / CT-18 + jobs | ✅ 완료, tsc 0 | Phase 0 수령 전 no-op 가드 포함 |
| routes/alimtalk.ts | ✅ 완료, tsc 0 | 승인/반려 엔드포인트 + `created_by` INSERT/GET 필터 + `requireTemplateAccess` 컨트롤타워 신설 |
| 프론트 중복 메뉴 정리 | ✅ 완료 | 헤더 "알림톡" 메뉴 제거, `/alimtalk-templates` 라우트 제거 |
| KakaoRcsPage 알림톡 탭 교체 | ✅ 완료 | `<AlimtalkManagementSection />` 단일 렌더 |
| AlimtalkManagementSection 승인 배지 | ✅ 완료 | 승인대기/승인/반려 배지 + 안내 문구 |
| AlimtalkSendersPage 승인/반려 UI | ✅ Day 2 완료 | 4탭(전체/승인대기/승인완료/반려) + 카운트 배지 + 반려 사유 모달 + 재승인 |
| AlimtalkTemplateFormV2 드롭다운 필터 | ✅ Day 2 완료 | 승인된 프로필만 노출 + 미등록/미승인 안내 + select 비활성화 |
| AlimtalkManagementSection 등록자 표시 | ✅ Day 2 완료 | 목록 테이블 "등록자" 컬럼 신설 (이름 + login_id) |
| 배포 (tp-deploy-full) | ⏳ Harold님 대기 | `tp-push` → `tp-deploy-full` 실행 필요 |

---

## 2. Harold님 확정 정책 (2026-04-18 세션 종료 시점)

### 2-1. 발신프로필 (카카오 채널 = **회사 자산**)

| 구분 | 정책 |
|------|------|
| **등록 요청** | **`company_admin` 또는 `super_admin`만** (일반 `company_user`는 등록 불가) |
| **승인** | **`super_admin`만** 승인/반려 가능 |
| **사용 범위** | 승인 완료된 프로필은 **회사 전체 공유** (같은 company_id 내 모든 user가 사용) |
| **080 수신거부 설정** | `company_admin` + `super_admin` |
| **assigned_user_id** | ❌ **추가하지 않음** (회사 공유 자산이므로 사용자별 배정 불필요) |

### 2-2. 알림톡 템플릿 (**개인 자산**)

| 구분 | 정책 |
|------|------|
| **등록** | **모든 로그인 사용자** (company_admin + company_user 둘 다) |
| **조회** | `company_user`: **본인이 등록한 것만** / `company_admin`: 회사 내 전체 / `super_admin`: 전체 |
| **수정·삭제** | 본인 소유 + `company_admin` |
| **검수요청·취소** | 본인 소유 + `company_admin` |
| **created_by** | ✅ **추가 필요** (`kakao_templates.created_by uuid FK → users(id)`) |

### 2-3. 브랜드메시지 (Phase 3)
- 오늘 범위 아님. 설계서 §6 기준 Phase 3에서 확장.

---

## 3. Day 2 완료 내역 (2026-04-18 연속 세션)

### Step A — DB ALTER ✅ (Harold님 서버 psql 실행 완료)

실행한 DDL:
```sql
BEGIN;
ALTER TABLE kakao_sender_profiles
  ADD COLUMN IF NOT EXISTS approval_status        varchar(20) DEFAULT 'PENDING_APPROVAL',
  ADD COLUMN IF NOT EXISTS approval_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at            timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by            uuid,
  ADD COLUMN IF NOT EXISTS reject_reason          text;
CREATE INDEX IF NOT EXISTS idx_ksp_approval_status
  ON kakao_sender_profiles(company_id, approval_status);
ALTER TABLE kakao_templates
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_kt_created_by
  ON kakao_templates(company_id, created_by);
COMMIT;
```

**검증 결과:** `\d kakao_sender_profiles` 24컬럼 / `\d kakao_templates` 41컬럼 / 기존 프로필 2건은 테스트 데이터(테스트계정2/인비토, yellow_id 없음)로 PENDING_APPROVAL 상태.

### Step B — 백엔드 ✅ (tsc 0)

**컨트롤타워 신설 (CLAUDE.md 7-1 프로세스 준수):**
- `resolveTemplateContext(companyId, templateCode, user?)` — user.userType === 'company_user'이면 created_by 체크 → 불일치 시 `'forbidden'` 반환
- `requireTemplateAccess(req, res)` — companyId 확보 + resolveTemplateContext + 404/403 응답을 단일 함수로 통합. 13개 호출부의 2단계 반복 패턴을 1단계로 축약

**라우트 수정 10건:**
| 라우트 | 미들웨어 | 소유자 체크 | 기타 변경 |
|--------|----------|-------------|-----------|
| POST `/templates` | `requireCompanyAdmin` 제거 (모든 사용자) | INSERT에 `created_by` | 승인되지 않은 발신프로필 400 차단 |
| GET `/templates` | — | company_user → `WHERE created_by` | users LEFT JOIN + `created_by_name`/`created_by_login_id` 응답 |
| GET `/templates/:templateCode` | — | `requireTemplateAccess` | 응답 쿼리에도 users LEFT JOIN |
| PUT `/templates/:templateCode` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | — |
| DELETE `/templates/:templateCode` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | — |
| POST `/templates/:code/inspect` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | — |
| POST `/templates/:code/inspect-with-file` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | — |
| PUT `/templates/:code/cancel-inspect` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | — |
| PUT `/templates/:code/release` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | — |
| PATCH `/templates/:code/custom-code` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | body 검증 선행 |
| PATCH `/templates/:code/exposure` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | body 검증 선행 |
| PATCH `/templates/:code/service-mode` | `requireCompanyAdmin` 제거 | `requireTemplateAccess` | body 검증 선행 |

**잔존 인라인 패턴 검증:** `grep "resolveTemplateContext" routes/alimtalk.ts` → 정의부 + `requireTemplateAccess` 내부 1곳만 (호출부 0건). 컨트롤타워 흡수 완료.

### Step C — 프론트 ✅ (tsc 0)

**C-1. `pages/AlimtalkSendersPage.tsx`**
- `Sender` 인터페이스에 approval 5컬럼 추가
- 승인 상태 4탭 (전체/승인대기/승인완료/반려) + 카운트 배지
- 상단 테이블에 "승인" 컬럼 추가 (PENDING_APPROVAL=노랑/APPROVED=초록/REJECTED=빨강 배지)
- 승인대기: "승인" + "반려" 버튼. 반려: "재승인" 버튼 추가.
- 반려 사유 모달 (3자 이상, 최대 500자, 실시간 카운트). **window.confirm/alert 미사용 원칙 준수** (커스텀 모달)
- 반려된 프로필은 인라인으로 `reject_reason` 표시

**C-2. `components/alimtalk/AlimtalkTemplateFormV2.tsx`**
- Props의 `profiles` 타입에 `approval_status?: string | null` 추가 (Profile interface와 호환)
- 드롭다운을 `approval_status === 'APPROVED'` 로 필터링
- 미등록 프로필 → "등록된 발신프로필이 없습니다. 슈퍼관리자에게 등록을 요청해주세요." (빨강)
- 미승인 프로필 → "승인된 발신프로필이 없습니다. 슈퍼관리자 승인 후 사용할 수 있습니다." (노랑)
- 두 경우 모두 select `disabled`

**C-3. `components/alimtalk/AlimtalkManagementSection.tsx`**
- Template 인터페이스에 `created_by/_name/_login_id` 3개 필드 추가
- 테이블 헤더에 "등록자" 컬럼 신설 (프로필 ↔ 유형 사이)
- 행 렌더: `created_by_name` 굵게 + `created_by_login_id` 작은 회색(monospace)

### Step D — 배포 ⏳ (Harold님 실행 대기)

1. ✅ 백엔드 `npx tsc --noEmit` 0 에러 (이번 세션 확인)
2. ✅ 프론트 `npx tsc --noEmit` 0 에러 (이번 세션 확인)
3. `tp-push "0418 D130 Day 2 승인 워크플로우 + 템플릿 소유자 체크 완료"`
4. `tp-deploy-full` (한 줄 쌍따옴표 방식, backend npm install + flyer-frontend 빌드 포함)
5. 배포 후 슈퍼관리자 계정으로 `/admin/alimtalk-senders` 접속 → 테스트 데이터 2건 승인/반려 flow 검증

---

## 4. 배포 인프라 이슈 정리

### 4-1. SSH `Connection closed by port 22` 사고 (2026-04-18)

- **원인 추정:** 제가 수정한 `tp-deploy-full`의 PowerShell `$cmds = @(...) -join " && "` 배열 방식이 긴 체인 전달 시 서버 sshd에 이상 트리거. `bito-deploy-full`은 동일 패턴이지만 체인 길이가 짧아서 문제 없었을 가능성.
- **현 상태:** 한 줄 쌍따옴표 방식으로 롤백 완료. `C:\Users\ceo\OneDrive\문서\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
- **검증:** Harold님 `ssh administrator@58.227.193.62 "echo OK"` → 성공 확인. 서버 정상.

### 4-2. 현재 `tp-deploy-full` 정의 (롤백된 안전 버전)

```powershell
function tp-deploy-full {
  ssh administrator@58.227.193.62 "cd /home/administrator/targetup-app && git pull && cd packages/backend && npm install && npm run build && cd ../frontend && npm run build && cd ../flyer-frontend && npm run build && pm2 restart all"
}
```

이전 버전 대비 추가된 것:
- `npm install` (backend만 — 의존성 변경 잦음)
- `cd ../flyer-frontend && npm run build` (전단AI 빌드)

제거된 것:
- `pm2 status` (불필요한 verbose)
- `cd ../..` (pm2는 어디서든 동작)

### 4-3. node_modules tracked 이슈 (별도 과제)

- 오늘 배포 로그에 `packages/backend/node_modules/.package-lock.json`이 tracked 상태로 push됨 (113줄 +)
- `.gitignore` 점검 필요 — 일반적으로 `node_modules/`는 ignore 대상
- **다음 세션 별도 분리 작업** (긴급도 낮음)

---

## 5. 다음 세션 착수 체크리스트 (Phase 2 대비)

**Day 2 완료. 다음 세션은 월요일(2026-04-21) Phase 0 수령 후 Phase 2.**

- [ ] 본 문서(`D130-SESSION-HANDOFF.md`) 먼저 정독
- [ ] `CLAUDE.md` 절대원칙 재확인 (SSH/git push/DB 실행 금지)
- [ ] Phase 0 수령 확인: `IMC_API_KEY` + `IMC_BASE_URL_STG` + `IMC_WEBHOOK_ALLOWED_IPS` + `IMC_WEBHOOK_HMAC_SECRET`
- [ ] `packages/backend/.env` 주입 + 서버 `pm2 restart all`
- [ ] 샌드박스 E2E: 카테고리 조회 → 발신프로필 token 요청 → 인증번호 입력 → createSender → 슈퍼관리자 승인 → 템플릿 등록 → 검수요청 → 승인 → 발송
- [ ] Phase 2 착수: `campaigns.ts` 5경로에 `channel='alimtalk'` 분기 추가
  - AI 캠페인 생성 / 발송 / 직접발송 / 테스트발송 / 예약발송
  - 발송 직전 `WHERE approval_status = 'APPROVED'` 체크 (발신프로필 가드)

---

## 6. 월요일(2026-04-21) Phase 0 수령 후 즉시 할 것

휴머스온에서 받아야 할 것:
- [ ] `IMC_API_KEY` (운영) / `IMC_API_KEY_SANDBOX` (공개용 `APIKEY-HUMUSON-0001`로 우선 테스트 가능)
- [ ] `IMC_BASE_URL_STG` 내부망 접근 (`10.147.1.109:28000`) — VPN 필요 여부 확인
- [ ] `IMC_WEBHOOK_ALLOWED_IPS` 휴머스온 송신 IP 목록
- [ ] `IMC_WEBHOOK_HMAC_SECRET` 시크릿

`packages/backend/.env`에 위 7개 채움 → 서버 `pm2 restart all` → 연동테스트 시작.

---

## 7. Day 1 + Day 2 커밋/배포 대기 중인 변경

**백엔드 (tsc 0):**
- `packages/backend/.env.example` — IMC 환경변수 7종 예시 추가
- `packages/backend/package.json` — axios + form-data 의존성
- `packages/backend/src/app.ts` — `/api/alimtalk` 라우트 등록 + webhook raw body parser + scheduler
- `packages/backend/src/utils/alimtalk-api.ts` — 신규 CT-16 (39 IMC 함수, Lazy init)
- `packages/backend/src/utils/alimtalk-result-map.ts` — 신규 CT-17 (응답/리포트 코드 맵)
- `packages/backend/src/utils/alimtalk-webhook-handler.ts` — 신규 CT-18 (HMAC + idempotency)
- `packages/backend/src/utils/alimtalk-jobs.ts` — 신규 배치 3종
- `packages/backend/src/routes/alimtalk.ts` — 신규 33 엔드포인트 + 승인/반려 + `created_by` 소유자 체크 + `requireTemplateAccess` 컨트롤타워
- `packages/backend/src/routes/companies.ts` — deprecated 주석만 (전 세션 커밋됨)

**프론트 (tsc 0):**
- `packages/frontend/src/App.tsx` — `/alimtalk-templates` 라우트 제거
- `packages/frontend/src/components/DashboardHeader.tsx` — 중복 "알림톡" 메뉴 제거
- `packages/frontend/src/components/alimtalk/AlimtalkManagementSection.tsx` — 신규 + 승인 배지 + 등록자 컬럼(Day 2)
- `packages/frontend/src/components/alimtalk/AlimtalkTemplateFormV2.tsx` — 신규 + 승인된 프로필 필터(Day 2)
- `packages/frontend/src/components/alimtalk/SenderRegistrationWizard.tsx` — 신규
- `packages/frontend/src/components/alimtalk/UnsubscribeSettingModal.tsx` — 신규
- `packages/frontend/src/components/alimtalk/AlarmUserManager.tsx` — 신규
- `packages/frontend/src/components/alimtalk/ButtonEditor.tsx` / `QuickReplyEditor.tsx` / `ItemListEditor.tsx` / `KakaoChannelImageUpload.tsx` / `AlimtalkPreview.tsx` — 신규
- `packages/frontend/src/pages/AlimtalkSendersPage.tsx` — 신규 + 승인/반려 UI + 4탭 + 반려 사유 모달(Day 2)
- `packages/frontend/src/pages/KakaoRcsPage.tsx` — 알림톡 탭 교체
- `packages/frontend/src/pages/AdminDashboard.tsx` — "알림톡 발신프로필" 버튼

**삭제:**
- `packages/frontend/src/pages/AlimtalkTemplatesPage.tsx` — Section 컴포넌트로 전환

**문서:**
- `status/STATUS.md` — D130 Day 2 완료 반영
- `status/D130-SESSION-HANDOFF.md` — 본 문서, Day 2 내역 업데이트
- `status/BUGS.md` / `status/OPS.md` — 기존 변경분

**프로필 (로컬만, 커밋 대상 아님):**
- `C:\Users\ceo\OneDrive\문서\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` — `tp-deploy-full` 한 줄 구조 + npm install / flyer-frontend 추가

**배포 권장:** Day 2 완성으로 승인 UI까지 포함. `tp-push "0418 D130 Day 2 승인 워크플로우 + 소유자 체크"` → `tp-deploy-full` 1회 배포로 완결. Harold님 판단으로 진행.
