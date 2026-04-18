# D130 알림톡/브랜드메시지 IMC 연동 — 세션 핸드오프 문서

> **작성일:** 2026-04-18 (Day 1 + Day 2 + Day 3 연속 세션 완료 — 알림톡 발송창 전구간 포함)
> **다음 세션 착수 전:** `CLAUDE.md` → `status/ALIMTALK-DESIGN.md` → **본 문서** 순서로 읽기.
> **핵심:** Day 3까지 승인 워크플로우 + 템플릿 소유자 체크 + **발송창 3경로(직접/타겟/자동) 공용 컨트롤타워 `AlimtalkChannelPanel`** + 백엔드 발송 분기 전부 완료. `auto_campaigns` DB ALTER 실행 후 배포 가능.

---

## 1. 전체 진행 상태 요약

| 영역 | 상태 | 비고 |
|------|------|------|
| DB 스키마 (기본) | ✅ 서버 적용 완료 | 19/40 컬럼 + 9 테이블 (2026-04-18 오전) |
| DB 추가 ALTER (승인·소유자) | ✅ 서버 적용 완료 | `kakao_sender_profiles` 24컬럼 / `kakao_templates` 41컬럼 (2026-04-18 Day 2) |
| **DB `auto_campaigns` 알림톡 컬럼 7종** | ⏳ **배포 전 ALTER 필수** | channel + alimtalk_* 6개 + idx (아래 §3-D에 SQL) |
| CT-16 / CT-17 / CT-18 + jobs | ✅ 완료, tsc 0 | Phase 0 수령 전 no-op 가드 포함 |
| routes/alimtalk.ts | ✅ 완료 | 승인/반려 + created_by + requireTemplateAccess 컨트롤타워 |
| 프론트 중복 메뉴 정리 | ✅ 완료 | 헤더 "알림톡" 메뉴 제거, `/alimtalk-templates` 라우트 제거 |
| AdminDashboard 상단 "알림톡 발신프로필" 버튼 | ✅ Day 3 제거 | 발송 관리 탭 내부 AlimtalkSendersSection으로 통합 |
| **AdminDashboard 레거시 발신프로필 섹션** | ✅ Day 3 제거 | Sender Key 수동 입력 방식 전부 삭제 |
| **AlimtalkSendersSection 신규** | ✅ Day 3 완료 | AlimtalkSendersPage 본체를 섹션화 → AdminDashboard 임베드 |
| KakaoRcsPage 알림톡 탭 | ✅ 완료 | `<AlimtalkManagementSection />` 단일 렌더 |
| AlimtalkManagementSection (승인 배지 + 등록자 컬럼) | ✅ Day 2 완료 | |
| AlimtalkSendersPage 승인/반려 UI | ✅ Day 2 완료 | 4탭 + 반려 사유 모달 + 재승인 |
| AlimtalkTemplateFormV2 드롭다운 필터 | ✅ Day 2 완료 | 승인된 프로필만 노출 |
| SenderRegistrationWizard 고객사 UX | ✅ Day 3 개선 | `/companies/me` 제거, `useAuthStore` 사용, 단일 회사면 드롭다운 숨김 |
| **AlimtalkChannelPanel 신규 (설계서 §6-3-D)** | ✅ Day 3 완료 | 발신프로필/템플릿/변수 자동매핑/부달 N·S·L·A·B/대체문구/미리보기. 단가 제외 |
| **DirectSendPanel 알림톡 블록 Panel 교체** | ✅ Day 3 완료 | |
| **TargetSendModal 알림톡 블록 Panel 교체 + sendChannel 매핑 버그 수정** | ✅ Day 3 완료 | `'kakao'` → `'alimtalk'` |
| **AutoSendFormModal 알림톡 탭 신규** | ✅ Day 3 완료 | 🔔 탭 + Panel + handleSubmit body 확장 |
| **campaigns.ts /direct-send 알림톡 파라미터 확장** | ✅ Day 3 완료 | profileId/variableMap/nextContents + 승인 이중 가드 + senderkey etcJson |
| **auto-campaigns.ts POST/PUT 알림톡 저장** | ✅ Day 3 완료 | channel/alimtalk_* 7개 컬럼 |
| **auto-campaign-worker.ts 알림톡 분기** | ✅ Day 3 완료 | executeAutoCampaign에서 channel='alimtalk'이면 insertAlimtalkQueue |
| 배포 (tp-deploy-full) | ⏳ Harold님 대기 | DB ALTER → `tp-push` → `tp-deploy-full` |

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

1. ✅ 백엔드 `npx tsc --noEmit` 0 에러
2. ✅ 프론트 `npx tsc --noEmit` 0 에러
3. Day 3 DB ALTER 실행 (아래 §3-D)
4. `tp-push "0418 D130 Day 3 알림톡 발송창 전구간 + AlimtalkSendersSection 통합"`
5. `tp-deploy-full`
6. 배포 후 검증:
   - AdminDashboard → 발송 관리 탭 → AlimtalkSendersSection 노출 + 테스트 데이터 2건 승인/반려 flow
   - 고객사 계정 직접발송 → 🔔 알림톡 탭 → 발신프로필/템플릿 드롭다운 + 변수 매핑 + 부달 A/B
   - 자동발송 생성 → Step 5에서 🔔 알림톡 탭 선택 가능

---

## 3-D. Day 3 — 알림톡 발송창 전구간 완성 (2026-04-18 야간)

### D-1. 전제 확인 (Harold님 지시)
- 휴머스온 IMC 발송 API 별도 호출 **없음**. QTmsg Agent가 기존 `SMSQ_SEND` 테이블에 `msg_type='K'`로 INSERT하면 자동 발송
- QTmsg 매뉴얼 ver4.0 §5 (`/home/invitoMsg/doc/QTmsg-사용자메뉴얼ver4.0.pdf`) + `sample_insert.sql` 검증 완료
- `k_template_code` / `k_next_type` (N/S/L/A/B) / `k_next_contents` / `k_button_json` / `k_etc_json`(senderkey, title) 전부 INSERT에 포함
- **Phase 0 수령 없이도 발송 자체는 가동 가능** (IMC는 템플릿 등록/검수만 필요)

### D-2. 슈퍼관리자 UI 통합
- `AdminDashboard.tsx` 상단 "알림톡 발신프로필" 별도 버튼 제거 (쌩뚱맞게 헤더에 있던 문제)
- 발송 관리 탭 내부 레거시 발신프로필 섹션(Sender Key 수동 입력) + 등록 모달 + state (`showProfileForm`/`profileForm`/`profileSaving`/`adminProfiles`) + `loadAdminProfiles` 함수 전부 제거
- 신규 `components/alimtalk/AlimtalkSendersSection.tsx` — 기존 `AlimtalkSendersPage`의 main + 모든 모달을 섹션으로 추출 → AdminDashboard 임베드. `AlimtalkSendersPage`는 header+Section wrapper로 축소.

### D-3. SenderRegistrationWizard UX 수정
- 존재하지 않던 `/api/companies/me` 호출 제거 → `useAuthStore.user.company` 직접 참조
- `companies.length === 1`이면 귀속 회사 드롭다운 자체 숨김 (고객사 admin은 본인 회사 자동 고정)
- `companies.length >= 2`(슈퍼관리자)만 드롭다운 노출
- 카테고리 캐시 비어있을 때 안내 문구를 모드별 분기 — 고객사 admin에게는 "관리자에게 문의" 메시지

### D-4. 공용 컨트롤타워 `AlimtalkChannelPanel` 신설 (설계서 §6-3-D 반영)
파일: `packages/frontend/src/components/alimtalk/AlimtalkChannelPanel.tsx`

반영 항목:
1. 발신프로필 드롭다운 — 승인된 것만 (`approval_status === 'APPROVED'`), 1개면 자동 고정
2. 템플릿 드롭다운 — 프로필 매칭 + APPROVED/APR/A/approved 호환
3. 변수 자동 매핑 — `#{...}` 추출 + 고객 필드 드롭다운 + `@@fieldKey@@` 치환 placeholder
4. 부달 5종 (N/S/L/A/B) + A/B일 때만 대체 문구 입력 (SMS 90자/LMS 2000자)
5. 미리보기 (원본/치환 토글, 강조 타이틀 + 본문 + 버튼)
6. **단가 표시 제외** (Harold님 지시 — 후불 위주라 불필요)

export 함수:
- `createEmptyAlimtalkState()` — 초기 state 팩토리
- `convertButtonsToQTmsg(buttons)` — QTmsg `{"name1","type1","url1_1","url1_2",...}` 포맷 변환 (type 코드 DS=1/WL=2/AL=3/BK=4/MD=5/AC=6)

### D-5. 3경로 발송창 Panel 적용
**`DirectSendPanel.tsx` (직접발송)**
- 기존 인라인 알림톡 블록(템플릿 목록 + 변수 매핑 + 대체발송 + 미리보기) 전체 제거 → `<AlimtalkChannelPanel>` 1개로 교체
- Props 확장: `alimtalkSenders`, `alimtalkProfileId/setAlimtalkProfileId`, `alimtalkNextContents/setAlimtalkNextContents`, `customerFieldOptions` (선택)
- `alimtalkFallback` 타입 확장 `'N'|'S'|'L'` → `'N'|'S'|'L'|'A'|'B'`
- `handleAlimtalkSend` 상태 체크를 대문자 호환 배열로

**`TargetSendModal.tsx` (직접타겟발송)**
- 동일 패턴 — 알림톡 블록 Panel 교체 + Props 확장
- **버그 수정**: `Dashboard.tsx:540` 타겟발송 body `sendChannel: 'kakao'` → `'alimtalk'` (백엔드 `directChannel === 'alimtalk'` 체크와 정합)

**`AutoSendFormModal.tsx` (자동발송) — 알림톡 탭 신규 추가**
- `channel: 'sms' | 'alimtalk'` state 추가
- Step 5 탭에 🔔 알림톡 버튼 추가 (SMS/LMS/MMS 옆)
- `channel === 'alimtalk'`이면 AI 문안 생성 + 본문 + 제목 + MMS 업로드 UI 전체 숨김 + Panel 임베드 + 폴백용 발신번호 드롭다운
- `alimtalkSenders`/`alimtalkTemplates` 로드 추가 (기존 useEffect에 병합)
- `handleSave` 검증: 프로필/템플릿 필수, A/B 타입이면 대체문구 필수
- `submitWithForce` body에 `channel`/`alimtalk_profile_id`/`alimtalk_template_id`/`alimtalk_template_code`/`alimtalk_variable_map`/`alimtalk_next_type`/`alimtalk_next_contents` 포함

### D-6. 백엔드
**`campaigns.ts POST /direct-send` 알림톡 분기 확장**
- 파라미터 확장: `alimtalkProfileId`, `alimtalkTemplateId`, `alimtalkVariableMap`, `alimtalkNextContents`
- 승인 이중 가드: `kakao_templates.status ∈ {APPROVED/APR/A}` + `kakao_sender_profiles.approval_status = 'APPROVED'` 조회. 불일치 시 400 차단
- `k_etc_json`에 `senderkey`(profile_key) 자동 주입
- 프론트 `variableMap`을 백엔드 `#{key}` 치환 루프로 적용 (`@@fieldKey@@` placeholder는 customer 필드 자동 치환)
- `k_next_contents` 필드 지원 (nextType A/B일 때만)

**`auto-campaigns.ts POST + PUT` — 알림톡 컬럼 저장**
- 두 라우트 모두 `channel` + `alimtalk_*` 7개 컬럼 INSERT/UPDATE (`alimtalk_variable_map`은 jsonb)

**`auto-campaign-worker.ts executeAutoCampaign`**
- `channel === 'alimtalk'` 분기 추가
- 승인 가드 — `kakao_templates` + `kakao_sender_profiles` JOIN, 미승인 시 run을 `failed` 처리
- `insertAlimtalkQueue(companyTables, alimRows)` 호출
- `alimtalk_variable_map`에서 `@@fieldKey@@`는 customer 필드로 자동 치환, 직접값은 그대로 사용
- `k_etc_json`에 senderkey 포함

### D-D. Day 3 DB ALTER (배포 전 Harold님 서버 psql 실행 필수)

```sql
BEGIN;

ALTER TABLE auto_campaigns
  ADD COLUMN IF NOT EXISTS channel                 varchar(20) DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS alimtalk_profile_id     uuid REFERENCES kakao_sender_profiles(id),
  ADD COLUMN IF NOT EXISTS alimtalk_template_id    uuid REFERENCES kakao_templates(id),
  ADD COLUMN IF NOT EXISTS alimtalk_template_code  varchar(50),
  ADD COLUMN IF NOT EXISTS alimtalk_variable_map   jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS alimtalk_next_type      varchar(1) DEFAULT 'L',
  ADD COLUMN IF NOT EXISTS alimtalk_next_contents  text;

CREATE INDEX IF NOT EXISTS idx_auto_campaigns_channel
  ON auto_campaigns(company_id, channel);

COMMIT;
```

검증: `\d auto_campaigns` → 신규 7개 컬럼 + idx 확인. 롤백은 동일 컬럼 DROP + `DROP INDEX idx_auto_campaigns_channel`.

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

## 5. 다음 세션 착수 체크리스트

**Day 3까지 발송창 전구간 완료. 남은 것은 Harold님 DB ALTER + 배포 + Phase 0 수령 후 E2E.**

- [ ] 본 문서(`D130-SESSION-HANDOFF.md`) 먼저 정독
- [ ] `CLAUDE.md` 절대원칙 재확인 (SSH/git push/DB 실행 금지)
- [ ] §3-D Day 3 DB ALTER 실행 (auto_campaigns 7개 컬럼) — Harold님 서버 psql 직접
- [ ] `tp-push "0418 D130 Day 3 알림톡 발송창 전구간 완성"` → `tp-deploy-full`
- [ ] Phase 0 수령 확인: `IMC_API_KEY` + `IMC_BASE_URL_STG` + `IMC_WEBHOOK_ALLOWED_IPS` + `IMC_WEBHOOK_HMAC_SECRET`
- [ ] `packages/backend/.env` 주입 + 서버 `pm2 restart all`
- [ ] 샌드박스 E2E: 카테고리 동기화 → 발신프로필 token 요청 → 인증번호 입력 → createSender → 슈퍼관리자 승인 → 템플릿 등록 → 검수요청 → 승인 → 각 경로(직접/타겟/자동) 실발송 테스트
- [ ] 발송 검증 포인트: `SMSQ_SEND`에 `msg_type='K'` + `k_template_code` + `k_etc_json.senderkey` 값 확인, QTmsg Agent가 카카오로 포워드 성공 여부
- [ ] Phase 2(남은 범위 — 선택) — AI 캠페인 생성/발송/테스트발송/예약발송 경로는 현재 알림톡 미지원 (Harold님 지시로 3경로만 구현)

---

## 6. 월요일(2026-04-21) Phase 0 수령 후 즉시 할 것

휴머스온에서 받아야 할 것:
- [ ] `IMC_API_KEY` (운영) / `IMC_API_KEY_SANDBOX` (공개용 `APIKEY-HUMUSON-0001`로 우선 테스트 가능)
- [ ] `IMC_BASE_URL_STG` 내부망 접근 (`10.147.1.109:28000`) — VPN 필요 여부 확인
- [ ] `IMC_WEBHOOK_ALLOWED_IPS` 휴머스온 송신 IP 목록
- [ ] `IMC_WEBHOOK_HMAC_SECRET` 시크릿

`packages/backend/.env`에 위 7개 채움 → 서버 `pm2 restart all` → 연동테스트 시작.

---

## 7. Day 1 + Day 2 + Day 3 커밋/배포 대기 중인 변경

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
- **Day 3:** `packages/backend/src/routes/campaigns.ts` — `/direct-send` 알림톡 분기 확장 (profileId/variableMap/nextContents + 승인 이중 가드 + senderkey etcJson)
- **Day 3:** `packages/backend/src/routes/auto-campaigns.ts` — POST/PUT에 channel + alimtalk_* 7개 컬럼 저장
- **Day 3:** `packages/backend/src/utils/auto-campaign-worker.ts` — `executeAutoCampaign`에 알림톡 분기 (`channel === 'alimtalk'` → `insertAlimtalkQueue`)

**프론트 (tsc 0):**
- `packages/frontend/src/App.tsx` — `/alimtalk-templates` 라우트 제거
- `packages/frontend/src/components/DashboardHeader.tsx` — 중복 "알림톡" 메뉴 제거
- `packages/frontend/src/components/alimtalk/AlimtalkManagementSection.tsx` — 신규 + 승인 배지 + 등록자 컬럼
- `packages/frontend/src/components/alimtalk/AlimtalkTemplateFormV2.tsx` — 신규 + 승인된 프로필 필터
- `packages/frontend/src/components/alimtalk/SenderRegistrationWizard.tsx` — 신규 (Day 3: useAuthStore 적용 + 단일 회사 드롭다운 숨김 + 카테고리 안내 분기)
- `packages/frontend/src/components/alimtalk/UnsubscribeSettingModal.tsx` — 신규
- `packages/frontend/src/components/alimtalk/AlarmUserManager.tsx` — 신규
- `packages/frontend/src/components/alimtalk/ButtonEditor.tsx` / `QuickReplyEditor.tsx` / `ItemListEditor.tsx` / `KakaoChannelImageUpload.tsx` / `AlimtalkPreview.tsx` — 신규
- `packages/frontend/src/pages/AlimtalkSendersPage.tsx` — 신규 + 승인/반려 UI (Day 3: Section wrapper로 축소)
- `packages/frontend/src/pages/KakaoRcsPage.tsx` — 알림톡 탭 교체
- **Day 3:** `packages/frontend/src/components/alimtalk/AlimtalkSendersSection.tsx` — 신규 공용 섹션 (AdminDashboard + AlimtalkSendersPage 공통)
- **Day 3:** `packages/frontend/src/components/alimtalk/AlimtalkChannelPanel.tsx` — 신규 공용 컨트롤타워 (설계서 §6-3-D, 3경로 공유)
- **Day 3:** `packages/frontend/src/components/DirectSendPanel.tsx` — 알림톡 블록 Panel 교체 + Props 확장
- **Day 3:** `packages/frontend/src/components/TargetSendModal.tsx` — 알림톡 블록 Panel 교체 + Props 확장
- **Day 3:** `packages/frontend/src/components/AutoSendFormModal.tsx` — 🔔 알림톡 탭 신규 + Panel + 알림톡 로드 + body 확장
- **Day 3:** `packages/frontend/src/pages/Dashboard.tsx` — 알림톡 state(`alimtalkProfileId`/`alimtalkNextContents`/`alimtalkSenders`) 추가 + `loadKakaoTemplates`에서 `/api/alimtalk/senders` 병렬 로드 + executeDirectSend/타겟발송 body에 알림톡 필드 + 타겟발송 `'kakao'→'alimtalk'` 매핑 버그 수정
- **Day 3:** `packages/frontend/src/pages/AdminDashboard.tsx` — 상단 "알림톡 발신프로필" 버튼 제거 + 발송 관리 탭 레거시 섹션/모달/state 제거 + `<AlimtalkSendersSection />` 임베드

**삭제:**
- `packages/frontend/src/pages/AlimtalkTemplatesPage.tsx` — Section 컴포넌트로 전환

**문서:**
- `status/STATUS.md` — D130 Day 3 완료 반영
- `status/D130-SESSION-HANDOFF.md` — 본 문서, Day 3 내역 업데이트
- `status/BUGS.md` / `status/OPS.md` — 기존 변경분
- `memory/project_d130.md` + `memory/MEMORY.md` — Day 3 갱신

**로컬 참조 파일 (커밋 대상 아님):**
- `qtmsg-manual.txt` — QTmsg 매뉴얼 텍스트 변환본 (PDF에서 pdftotext로 추출, 로컬 참조용)
- `C:\Users\ceo\OneDrive\문서\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` — `tp-deploy-full` 한 줄 구조 + npm install / flyer-frontend 추가

**배포 권장:** Day 3로 알림톡 발송창 전구간 완성. DB ALTER(§3-D) → `tp-push "0418 D130 Day 3 알림톡 발송창 전구간 + AlimtalkSendersSection"` → `tp-deploy-full` 1회로 완결.
