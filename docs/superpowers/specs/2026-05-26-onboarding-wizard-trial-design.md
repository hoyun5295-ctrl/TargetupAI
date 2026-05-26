# D219+ AI 오퍼레이션 무료체험 온보딩 wizard + 다듬기 팝업 정정 — 설계 문서

> **작성일**: 2026-05-26
> **세션**: D219+ brainstorming 종결 → writing-plans → executing-plans
> **목적**: 영업 미팅 후 AI 오퍼레이션 체험 부여 사용자가 30분 안 첫 발송 도달 + ROI 측정 흐름 진입 = 가치 증명 흐름. 추가 = AI 다듬기 팝업 다크 톤 정정 (옛 무료체험 사용자 0건 사용 사고 영구 차단).
> **Harold 명시**: "거의 다 왔다 X — 부족한 게 많다 / 운영 검증 = 당연 / 본질 = 무료체험 한 달 받고 실제 만족할 흐름" + "다듬기 팝업 = AI 오퍼레이션처럼 멋지게 + 다크 톤 + violet 액센트"

---

## 1. 배경 + 목적

### 옛 부족 영역 (D170~D218+ 코드 압도 정합 후)

- 옛 D170~D218+ = Braze/Salesforce 한국 시장 압도 정합
- 단 옛 사용자 첫 30분 흐름 = "어디부터 시작하지" 직관 X = 무료체험 사용자 첫 30분 fail = 즉시 이탈 위험
- 옛 Dashboard / Settings / ManagePage = 옛 단순 form / table view = D215+ design_quality 정합 X
- 옛 customer DB 업로드 = AddressBookModal 단순 form = AI 자동 매핑 X
- 옛 segment 만들기 = 옛 form 30번 클릭 매트릭스 = 자연어 입력 X
- 옛 ROI 측정 = D190/D197 backend 정합 / 단 사용자 인지 흐름 X

### 본 작업 목적

옛 영업 미팅 후 AI 오퍼레이션 체험 부여 사용자가 30분 안 첫 발송 도달 + ROI 측정 활성 흐름:

1. 영업 미팅 후 = Harold + 직원이 슈퍼관리자 영역 안 1-click 체험 부여
2. 옛 사용자 다음 로그인 시 = wizard 자동 진입 (강압적 X / skip 가능)
3. wizard 7 step = 각 5분 안 완성 의무
4. 옛 첫 발송 도달 = 가치 증명 즉시
5. 옛 정식 customer 발송 = 발신번호 검수 통과 직후 진입 가능
6. 옛 매일 9시 자동 인사이트 메일 = 한 달 안 30번 가치 증명

---

## 2. 의문 13건 + Harold 확정 default

| # | 의문 | 확정 |
|---|------|------|
| 1 | 스코프 | 한 spec + 한 plan 통합 진입 |
| 2 | wizard step 구조 | 7 step 완전 자동 |
| 3 | 진입 흐름 | skip 자유 (강제 X) |
| 4 | AI 자동 매핑 | AI 매핑 + 샘플 5건 + 사용자 confirm |
| 5 | AI segment | 자연어 + 매칭 수 + confirm + saved_segments INSERT |
| 6 | 샘플 발송 대상 | admin 본인 phone (인증 라인) |
| 7 | 발신번호 흐름 | 등록 신청 + Harold 즉시 검수 + 인증 라인 우선 |
| 8 | AI 본문 제안 | 자연어 → 즉시 본문 1건 + 편집 모드 |
| 9 | ROI 자동 측정 | 매일 9시 자동 인사이트 메일 기본 ON |
| 10 | wizard 진입 시점 | 영업 미팅 후 AI 오퍼레이션 체험 부여 사용자만 자동 진입 |
| 11 | 체험 부여 방법 | 슈퍼관리자 1-click + 30일 자동 종결 |
| 12 | AI 다듬기 팝업 톤 | 다크 톤 + violet 액센트 (AI 오퍼레이션 본질 일관성) |
| 13 | 다듬기 backend 알고리즘 | 정정 X (옛 refineDirectMessage system prompt 이미 충분 — 도입부 매력 + 마무리 CTA + 105~130% 길이) |

---

## 3. 아키텍처 (Architecture)

### 5 핵심 분류

**1) AI 오퍼레이션 체험 부여 + 게이팅**
- 옛 슈퍼관리자 영역 (sys.hanjullo.com) 안 1-click 체험 부여 버튼
- 옛 `companies.ai_operator_trial_started_at` + `ai_operator_trial_until` 컬럼 활용
- 옛 사용자 로그인 시 = 체험 진입 가능 여부 검증 + 옛 wizard 자동 진입
- 옛 30일 자동 종결 = 옛 daily-trial-expiry-worker 1시간 cron 자동 정리

**2) Wizard 7 step 흐름 + 진행률 저장**
- 옛 `onboarding_wizard_state` 테이블 신설 (옛 step별 상태 + 데이터 영구 저장)
- 옛 사용자가 wizard 종료 시 = 옛 state 저장 + 다음 진입 시 재진입 가능
- 옛 진행률 카드 Dashboard 상단 표시 (skip 사용자 재진입 가능)

**3) AI 자동 매핑 + 자연어 segment**
- 옛 CT-96 `ai-column-mapper.ts` = Excel/CSV 첫 5건 + 컬럼 명 → Opus 4.7 자동 매핑
- 옛 CT-97 `ai-segment-generator.ts` = 자연어 → Opus 4.7 → saved_segments 자동 생성
- 옛 customer-filter CT-01 활용 = 매칭 customer 수 즉시 표시

**4) 매일 9시 자동 인사이트 메일**
- 옛 CT-98 `daily-insight-mailer.ts` = 1시간 cron worker (9시 정각 발화)
- 옛 회사별 옛 발송 결과 + ROI + AI 인사이트 자동 생성
- 옛 company_admin email 발송 (옛 D215+ Email SMTP relay CT-85 활용)

**5) AI 다듬기 팝업 다크 톤 정정** (D215+ design_quality 정합)
- 옛 `DirectSendAiRefinePopup.tsx` (진입 안내 24h 1회 노출) = 흰 톤 → 다크 톤 변환 + Before/After 풍성한 예시 정정 (옛 단순 "★ 추가" 예시 폐기)
- 옛 `AiRefineModal.tsx` (본체 다듬기 모달) = 흰 톤 + emerald → 다크 톤 (bg-slate-900) + violet 액센트 변환
- 옛 `AiRefineLockedModal.tsx` (요금제 게이팅) = 다크 톤 정합 의무 (호출 위치 일관성)
- backend `refineDirectMessage` (services/ai.ts:2936) = 정정 X (옛 system prompt + Sonnet 4.6 호출 이미 충분)
- 옛 Before/After 강조 표시 = bg-emerald-100 → bg-violet-500/30 변환 + violet 형광 영역
- 옛 모든 AI 다듬기 호출 위치 (Dashboard / DirectSendPanel / JourneysPage / DmBuilderPage / InAppMessagesPage / AiOperatorPage / PricingPage) = 톤 일관성 유지

### 신뢰 + 가치 증명 5 영역

**A. 옛 sender-registration 정합** (옛 영역 정합)
- 옛 사용자 wizard step 2 안 발신번호 + 서류 업로드
- 옛 Harold 영역 안 즉시 알림 발생 (옛 알림톡 또는 SMS — sender-registration 안 옛 흐름 정합)
- 옛 Harold 즉시 검수 = 옛 1시간 이내 승인 가능

**B. 옛 인증 라인 활용 (샘플 발송)**
- 옛 wizard step 6 = admin 본인 phone 발송
- 옛 sms_line_groups.group_type = 'auth' 활용 = 검수 통과 별도 라인 = 옛 사용자 발신번호 영역 차단 영역 X
- 옛 무료체험 잔액 차감 X = 옛 admin 본인 phone 인증 라인 발송

**C. 옛 placeholder 잔존 자동 차단** (옛 D187-fix2 정합)
- 옛 AI 본문 자동 생성 시 = `[직접 작성해주세요]` placeholder 자동 차단
- 옛 사용자가 placeholder 안 둔 채 샘플 발송 = 옛 활성화 차단 (옛 hasUneditedPlaceholder 정합)

**D. 옛 segment 매칭 0건 안전망** (옛 D171 no_target_auto_relax 정합)
- 옛 AI segment 매칭 0건 = "조건 정정" 안내만 = 자동 완화 X
- 옛 사용자 자연어 refine 의무

**E. 옛 wizard 종결 후 재진입 가능**
- 옛 사용자 skip 시 = 옛 onboarding_progress JSONB 저장
- 옛 Dashboard 상단 "wizard 다시 진입" 카드 표시
- 옛 30일 체험 안 자유 재진입 가능

---

## 4. 컴포넌트 (Components)

### Backend (`packages/backend/src`)

**신규 컨트롤타워 4건**

1. **CT-95 `onboarding-wizard.ts`** — wizard step 상태 관리
   - `getOnboardingState(companyId, userId)` — 옛 진행률 + 옛 step별 데이터 조회
   - `saveOnboardingStep(companyId, userId, stepNum, data)` — 옛 step 데이터 저장
   - `completeOnboardingStep(companyId, userId, stepNum)` — 옛 step 완성 표시
   - `isAiOperatorTrialActive(companyId)` — 옛 체험 활성 여부 검증

2. **CT-96 `ai-column-mapper.ts`** — Excel/CSV 컬럼 AI 자동 매핑
   - `analyzeFileColumns(fileBuffer, fileType)` — 옛 첫 5건 + 컬럼 명 추출
   - `mapColumnsWithAi(columns, samples, companyId)` — Opus 4.7 호출 → 자동 매핑
   - 반환 = `{ mappings: [...], confidenceScore, samplePreview }`

3. **CT-97 `ai-segment-generator.ts`** — 자연어 → segment 자동 생성
   - `generateSegmentFromText(naturalLanguage, companyId)` — Opus 4.7 → filter JSONB
   - `previewSegmentMatchCount(filter, companyId)` — 옛 customer-filter CT-01 호출
   - `saveSegmentFromWizard(companyId, userId, segmentInput)` — saved_segments INSERT

4. **CT-98 `daily-insight-mailer.ts`** — 매일 9시 인사이트 메일
   - `runDailyInsightTick()` — 1시간 cron 9시 정각 발화 검증
   - `buildInsightForCompany(companyId)` — 옛 영역 ROI + 인사이트 생성
   - `sendInsightEmail(companyId, content)` — 옛 D215+ CT-85 company-smtp-client 활용

**옛 영역 강화**
- `routes/super-admin.ts` — 옛 1-click 체험 부여 endpoint 신설
- `routes/auth.ts` — 옛 로그인 직후 wizard 자동 진입 분기 추가
- `routes/onboarding.ts` (신규) — wizard 7 step endpoint 통합
- `utils/sender-registration.ts` — 옛 신청 시점 Harold 즉시 알림 강화
- `app.ts` — 옛 daily-insight-mailer + daily-trial-expiry-worker 등록

**Frontend 다듬기 정정 (3 파일)**
- `components/DirectSendAiRefinePopup.tsx` — 흰 톤 + emerald → 다크 톤 + violet 변환 + Before/After 풍성한 예시 정정 (옛 "내일 신상품 입고됩니다!" → "내일 신상품이 입고됩니다 ★" 단순 예시 폐기 + 옛 첨부 캡처 본보기 정합 풍성 카피 적용)
- `components/AiRefineModal.tsx` — 흰 톤 + emerald → 다크 톤 + violet 변환 + 강조 부분 bg-emerald-100 → bg-violet-500/30 + 첨부 캡처 본보기 정합 (3 column 레이아웃 유지 + 톤 선택 2 카드 + 적용 → 버튼)
- `components/AiRefineLockedModal.tsx` — 요금제 게이팅 다크 톤 정합 의무

**신규 endpoint 매트릭스**
- POST `/api/super-admin/companies/:id/grant-ai-operator-trial` (옛 1-click 부여)
- DELETE `/api/super-admin/companies/:id/revoke-ai-operator-trial` (옛 수동 종결)
- GET `/api/onboarding/state` (옛 wizard 진행률 조회)
- POST `/api/onboarding/import-analyze` (옛 CT-96 컬럼 매핑 미리보기)
- POST `/api/onboarding/import-confirm` (옛 customer 본격 import)
- POST `/api/onboarding/segment-generate` (옛 CT-97 자연어 → segment)
- POST `/api/onboarding/segment-confirm` (옛 saved_segments INSERT)
- POST `/api/onboarding/draft-message` (옛 자연어 → 본문 생성)
- POST `/api/onboarding/sample-send` (옛 admin 본인 phone 발송)
- POST `/api/onboarding/complete` (옛 wizard 종결 + ROI 메일 활성)

### Frontend (`packages/frontend/src`)

**신규 컴포넌트 8건** (옛 D215+ design_quality 표준 정합)

1. **`pages/OnboardingWizardPage.tsx`** — 메인 wizard 페이지
   - 옛 7 step 진행률 카드 + Step 컴포넌트 라우팅
   - 옛 다크 톤 (bg-slate-950 + violet 액센트) + sticky 헤더
   - 옛 skip 버튼 + 종결 후 Dashboard 진입

2. **`components/onboarding/OnboardingStep1Welcome.tsx`** — 환영
3. **`components/onboarding/OnboardingStep2Sender.tsx`** — 발신번호 + 서류 업로드
4. **`components/onboarding/OnboardingStep3Import.tsx`** — customer 임포트 + AI 매핑
5. **`components/onboarding/OnboardingStep4Segment.tsx`** — 세그먼트 자연어
6. **`components/onboarding/OnboardingStep5Draft.tsx`** — 본문 자연어 + 편집
7. **`components/onboarding/OnboardingStep6Sample.tsx`** — 샘플 발송
8. **`components/onboarding/OnboardingStep7Roi.tsx`** — ROI 자동 측정 안내

**옛 영역 강화**
- `Dashboard.tsx` — 옛 OnboardingCard (skip 사용자 재진입 카드) 추가
- `App.tsx` — 옛 `/onboarding` 라우트 신설 + 옛 로그인 직후 자동 redirect
- `sys.hanjullo.com` 슈퍼관리자 영역 안 옛 1-click 체험 부여 컴포넌트 신설

### DB 신규

```sql
-- 1. companies ALTER — AI 오퍼레이션 체험 영역
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ai_operator_trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_operator_trial_until timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_progress JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_companies_ai_operator_trial_until ON companies(ai_operator_trial_until) WHERE ai_operator_trial_until IS NOT NULL;

-- 2. onboarding_wizard_state 신규
CREATE TABLE onboarding_wizard_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  current_step int NOT NULL DEFAULT 1,
  completed_steps int[] NOT NULL DEFAULT ARRAY[]::int[],
  -- step별 데이터
  sender_registration_id uuid,
  imported_customer_count int DEFAULT 0,
  import_column_mapping JSONB,
  saved_segment_id uuid,
  drafted_message_template text,
  drafted_message_subject text,
  sample_sent_at timestamptz,
  sample_sent_to_phone varchar(20),
  daily_insight_enabled BOOLEAN DEFAULT true,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_ows_company_user ON onboarding_wizard_state(company_id, user_id);
CREATE INDEX idx_ows_current_step ON onboarding_wizard_state(current_step) WHERE completed_at IS NULL;

-- 3. daily_insight_email_log 신규 — 매일 9시 메일 발송 추적 (중복 발송 차단)
CREATE TABLE daily_insight_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  sent_date date NOT NULL,
  recipient_email varchar(255) NOT NULL,
  send_status varchar(20) NOT NULL,
  insight_summary text,
  error_message text,
  sent_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX idx_diel_company_date ON daily_insight_email_log(company_id, sent_date);
```

---

## 5. 데이터 흐름 (Data Flow)

### 7 단계 + 외부 흐름

| # | 단계 | 사용자 입력 | backend 호출 | DB 영역 |
|---|------|------------|--------------|---------|
| 0 | 영업 미팅 후 | 슈퍼관리자 1-click | POST grant-ai-operator-trial | companies.ai_operator_trial_* SET |
| 1 | 환영 | 회사 정보 확인 | GET /onboarding/state | onboarding_wizard_state INSERT |
| 2 | 발신번호 | 번호 + 서류 업로드 | POST sender-registration + Harold 알림 | sender_registrations INSERT |
| 3 | 임포트 | Excel/CSV 업로드 + confirm | POST import-analyze + import-confirm | customers INSERT (batch) |
| 4 | 세그먼트 | 자연어 input + confirm | POST segment-generate + segment-confirm | saved_segments INSERT |
| 5 | 본문 | 자연어 1줄 + 편집 | POST draft-message | onboarding_wizard_state.drafted_* UPDATE |
| 6 | 샘플 | admin 본인 phone confirm | POST sample-send (옛 인증 라인) | onboarding_wizard_state.sample_sent_* UPDATE |
| 7 | ROI 안내 | 매일 9시 메일 ON confirm | POST complete | onboarding_wizard_state.completed_at + daily_insight_enabled |

### 외부 cron 영역

| cron | 주기 | 영역 |
|------|------|------|
| daily-insight-mailer | 1시간 (9시 정각만 발화) | 옛 회사별 ROI 메일 |
| daily-trial-expiry-worker | 1시간 | 옛 30일 종결 회사 자동 정리 |

---

## 6. 에러 처리 (Error Handling)

### 카테고리 7종

1. **AI 매핑 confidence 80% 이하** = 옛 사용자 수동 정합 경고 + 옛 매핑 dropdown 활성
2. **AI segment 매칭 0건** = "조건 정정" 안내만 (옛 no_target_auto_relax 정합) + 옛 자동 완화 X
3. **AI 본문 placeholder 잔존** = 옛 발송 차단 + "직접 작성해주세요 영역 정정 의무" 안내
4. **발신번호 검수 미통과** = 옛 정식 customer 발송 차단 + 인증 라인 한정 안내 + Harold 검수 진행 안내
5. **체험 만료 (30일 경과)** = 옛 wizard 진입 X + Dashboard 안 "체험 종결" 안내 + 유료 전환 흐름 안내
6. **매일 9시 메일 발송 실패** = daily_insight_email_log error_message 기록 + 다음 날 재시도
7. **샘플 발송 실패** = 옛 admin 본인 phone 무효 시 = "phone 정정" 안내 + 재발송 가능

### Graceful Degradation
- 옛 AI 매핑 호출 timeout = 옛 사용자 수동 매핑 dropdown fallback
- 옛 AI segment timeout = 옛 사용자 직접 segment form 진입 fallback
- 옛 매일 9시 메일 발송 실패 = 다음 1시간 cron tick 재시도

---

## 7. 테스트 (Testing)

### 6 분류 (옛 D218+ 영역 정합)

1. **Unit Test** — CT-95/96/97/98 각 단위 함수 테스트
2. **Integration Test** — 7 단계 흐름 종합 (옛 로그인 → wizard → 종결)
3. **E2E Test** — 옛 슈퍼관리자 1-click → 사용자 로그인 → wizard 7 step → ROI 메일 활성
4. **Stress Test** — 옛 100,000건+ customer 업로드 진행률 + 부분 사고 시 retry
5. **Edge Case** — 옛 AI 호출 timeout / 매칭 0건 / placeholder 잔존 / 30일 만료 / phone 무효
6. **Manual Test** — Harold + 직원 직접 (옛 no_operation_verification_by_ai 영구 룰 정합)

---

## 8. 개발 순서 (Phase 매핑)

### 본 세션 영역 (Phase 0 만)

| Phase | 분류 | 분량 |
|-------|------|------|
| 0 | AI 다듬기 팝업 다크 톤 정정 (DirectSendAiRefinePopup + AiRefineModal + AiRefineLockedModal) + 자가 검증 + 메모리 갱신 | 2~3h |

### 다음 세션 영역 (Phase 1~7 — 핸드오프 .md 진입)

| Phase | 분류 | 분량 |
|-------|------|------|
| 1 | DB 인프라 + CT 4건 신규 (CT-95/96/97/98) | 5~6h |
| 2 | Backend endpoint + 슈퍼관리자 1-click + 옛 영역 정합 | 4~5h |
| 3 | Frontend OnboardingWizard + 7 step 컴포넌트 + Dashboard 카드 | 8~10h |
| 4 | daily-insight 9시 cron + daily-trial-expiry 1시간 cron + 옛 sender-registration 알림 강화 | 2~3h |
| 5 | 자가 검증 (tsc + grep 광범위 + 7-1 컨트롤타워 grep) | 1~2h |
| 6 | Harold 직접 배포 + 운영 검증 (Harold + 직원 직접) | 별도 |
| 7 | 영구 룰 + 메모리 갱신 | 종결 직후 |

**본 세션 총 분량**: Phase 0 = 2~3h
**다음 세션 총 분량**: Phase 1+2+3+4+5 = 20~26h (단일 세션 가능 / 옛 D218+ 분량 정합)

**Harold 명시 (2026-05-26)**: "여기 세션에서는 다듬기 팝업 교체만 빠르게 진행 / Wizard + 슈퍼관리자 1-click = 상세 .md 파일 핸드오프 진입 → 다음 세션 진행"

---

## 9. Braze/Salesforce 압도 차별화 표

| 영역 | Braze/Salesforce | 한줄로 D219+ |
|------|------------------|---------------|
| 신규 사용자 온보딩 | 영업 + 컨설팅 + 30일~ 셋업 | 30분 안 첫 발송 + ROI 메일 활성 (셀프) |
| customer 임포트 | 컬럼 직접 매핑 영역 form | Excel/CSV + AI 자동 컬럼 매핑 + confirm |
| 세그먼트 만들기 | 옛 filter form 30+ 클릭 | 자연어 1줄 → AI 자동 segment |
| 첫 발송 안내 | 옛 영업 직접 데모 | 옛 admin 본인 phone 인증 라인 즉시 발송 |
| ROI 측정 안내 | 옛 영업 대시보드 안내 | 매일 9시 자동 인사이트 메일 (한 달 30번) |
| AI 다듬기 UX | 단순 문법 정정 모달 (흰 톤) | 다크 톤 + violet 액센트 + Before/After 풍성 카피 + 강조 부분 형광 표시 + 톤 선택 2 카드 + LMS 바이트 배지 + 1-click 적용 |

---

## 10. 영구 룰 정합 매트릭스

- `cto_mandate_for_vito` — CTO 사명감 + 정합성 100% (옛 부족 영역 본질 root cause 해결)
- `marketing_user_ux_priority` — 사용자 클릭 수 최소 + 1-click 정합 (7 step 각 5분 안)
- `ai_no_arbitrary_benefit` — AI 본문 placeholder 잔존 차단
- `no_target_auto_relax` — segment 매칭 0건 자동 완화 X
- `no_native_browser_dialog` — ConfirmModal + useToast 활용 (옛 native dialog 0건)
- `design_quality_minimum_journey_level` — 다크 톤 + violet 액센트 + 6 sub-agent 시각 효과 + Source caption + 모바일 반응형
- `no_operation_verification_by_ai` — Manual Test = Harold + 직원 직접
- `no_bakkeum_usage § D218+` — "박-단어" + "진정" + "영영" 0건
- `feedback_no_preview_verification` — preview MCP 도구 X
- `feedback_default_superpowers_workflow` — brainstorming → writing-plans → executing-plans 흐름
- `ai_operator_user_gating` — AI_OPERATOR_ALLOWED_USERS 옛 영역 정합 + 옛 영업 미팅 후 체험 부여 흐름 정합
- `ai_operator_model_isolation` — wizard 안 AI 호출 = Opus 4.7 (옛 callAIWithFallback `model: 'opus'`)

---

## 11. 변경 이력

- 2026-05-26: brainstorming 종결 + 설계 문서 작성 (의문 11건 + 11 섹션 + Phase 매핑 7 Phase + Braze 압도 차별화 5 영역)
- 2026-05-26 (갱신 1): Harold 명시 다듬기 팝업 정정 통합 — 의문 13건 + 핵심 분류 5건 + Phase 0 신설 + Braze 차별화 6 영역 + 다듬기 정정 3 frontend 파일 추가 (DirectSendAiRefinePopup + AiRefineModal + AiRefineLockedModal)
- 2026-05-26 (갱신 2, Part 1 종결 직후): Harold 명시 분리 흐름 + "오늘 하루 보지 않기" 옵션 통합. AI 오퍼레이션 30일 무료체험 = 기존 PRO TRIAL과 분리 (companies.ai_operator_trial_started_at + ai_operator_trial_until 별도 컬럼). Wizard 진입 시 "오늘 하루 보지 않기" 24h localStorage cooldown 옵션 추가. AdminDashboard.tsx 안 별도 부여 UI. plan-guard.ts isAiOperatorAllowed 게이팅 정정 (ENT OR ai_operator_trial_until > NOW()). ai-operator-trial-expire-worker.ts 신설 (trial-downgrade-worker.ts 패턴 미러).

## 12. AI 오퍼레이션 30일 무료체험 분리 흐름 (Harold 명시 2026-05-26 갱신)

### 기존 PRO 무료체험과 분리 본질

| 영역 | 기존 PRO 무료체험 (CT-17) | 신규 AI 오퍼레이션 무료체험 |
|------|---------------------------|-------------------------|
| 컬럼 | `plan_id` (TRIAL plan) + `trial_expires_at` | `companies.ai_operator_trial_started_at` + `ai_operator_trial_until` |
| 영향 범위 | 전체 PRO 기능 무료 | AI 오퍼레이션만 무료 (plan_code 유지) |
| 게이팅 | plan-guard.ts subscription_status + trial_expires_at | plan-guard.ts isAiOperatorAllowed = ENT OR ai_operator_trial_until > NOW() |
| 자동 종결 cron | trial-downgrade-worker.ts (매일 04:00) | ai-operator-trial-expire-worker.ts 신설 |
| 부여 endpoint | POST /api/companies/:id/grant-trial | POST /api/companies/:id/grant-ai-operator-trial |
| 취소 endpoint | POST /api/companies/:id/revoke-trial | POST /api/companies/:id/revoke-ai-operator-trial |
| 부여 UI | AdminDashboard.tsx 기존 버튼 | AdminDashboard.tsx 별도 버튼 추가 |

### Wizard 진입 흐름 (Harold 명시 — 강압 X)

| 사용자 액션 | localStorage 동작 | 다음 진입 시 노출 여부 |
|-----------|------------------|---------------------|
| X 닫기 | `onboarding_wizard_seen = Date.now()` | 다음 로그인 시 즉시 재노출 |
| **"오늘 하루 보지 않기"** | `onboarding_wizard_dismissed_until = Date.now() + 24h` | 24h 안 미노출 + 24h 경과 후 자동 재노출 |
| "지금 시작" → step 진행 | onboarding_wizard_state INSERT/UPDATE | 진행률 이어서 노출 |
| Wizard step 7 완료 | onboarding_wizard_state.completed_at = NOW() | 영구 미노출 (단 admin 영역 "다시 진입" 카드 활용) |

= 강압 X + 사용자 자유 닫기 + "오늘 하루 보지 않기" 옵션 (24h cooldown) 흐름 정합.
