# D219+ Wizard + 슈퍼관리자 1-click 체험 부여 — 다음 세션 진입 핸드오프

> **본 세션 종결일**: 2026-05-26
> **다음 세션 진입 목적**: spec [docs/superpowers/specs/2026-05-26-onboarding-wizard-trial-design.md](../specs/2026-05-26-onboarding-wizard-trial-design.md) Phase 1~7 진행
> **본 세션 처리 영역**: Phase 0 만 = AI 다듬기 팝업 다크 톤 정정 (DirectSendAiRefinePopup + AiRefineModal + AiRefineLockedModal)

---

## 1. 본 세션 종결 매트릭스 (Phase 0)

| 영역 | 결과 | 파일 |
|------|------|------|
| DirectSendAiRefinePopup 다크 톤 정정 | 본 세션 종결 의무 | `packages/frontend/src/components/DirectSendAiRefinePopup.tsx` |
| AiRefineModal 다크 톤 + violet 액센트 변환 | 본 세션 종결 의무 | `packages/frontend/src/components/AiRefineModal.tsx` |
| AiRefineLockedModal 정합 확인 | 본 세션 종결 의무 | `packages/frontend/src/components/AiRefineLockedModal.tsx` |
| 자가 검증 + 메모리 갱신 + 배포 명령어 안내 | 본 세션 종결 의무 | - |

---

## 2. 다음 세션 진입 영역 (Phase 1~7)

spec [docs/superpowers/specs/2026-05-26-onboarding-wizard-trial-design.md](../specs/2026-05-26-onboarding-wizard-trial-design.md) 그대로 진행. 옛 spec 영역 안 § 3 5 핵심 분류 + § 4 컴포넌트 + § 5 데이터 흐름 7 단계 + § 6 에러 7 카테고리 + § 8 Phase 매핑 모두 정합 보존.

### Phase 1 — DB 인프라 + CT 4건 신규 (5~6h)

**신규 컨트롤타워 4건**:
- CT-95 `packages/backend/src/utils/onboarding-wizard.ts` — wizard step 상태 관리
- CT-96 `packages/backend/src/utils/ai-column-mapper.ts` — Excel/CSV 컬럼 AI 자동 매핑
- CT-97 `packages/backend/src/utils/ai-segment-generator.ts` — 자연어 → segment
- CT-98 `packages/backend/src/utils/daily-insight-mailer.ts` — 매일 9시 인사이트 메일

**DB 신설 SQL** (Harold 직접 PG 실행 의무):
```sql
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ai_operator_trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_operator_trial_until timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_progress JSONB DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_companies_ai_operator_trial_until ON companies(ai_operator_trial_until) WHERE ai_operator_trial_until IS NOT NULL;

CREATE TABLE onboarding_wizard_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  current_step int NOT NULL DEFAULT 1,
  completed_steps int[] NOT NULL DEFAULT ARRAY[]::int[],
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

### Phase 2 — Backend endpoint + 슈퍼관리자 1-click (4~5h)

**신규 endpoint**:
- POST `/api/super-admin/companies/:id/grant-ai-operator-trial` — 1-click 부여
- DELETE `/api/super-admin/companies/:id/revoke-ai-operator-trial` — 수동 종결
- GET `/api/onboarding/state` — wizard 진행률 조회
- POST `/api/onboarding/import-analyze` — CT-96 컬럼 매핑 미리보기
- POST `/api/onboarding/import-confirm` — customer 본격 import
- POST `/api/onboarding/segment-generate` — CT-97 자연어 → segment
- POST `/api/onboarding/segment-confirm` — saved_segments INSERT
- POST `/api/onboarding/draft-message` — 자연어 → 본문 생성
- POST `/api/onboarding/sample-send` — admin 본인 phone 발송
- POST `/api/onboarding/complete` — wizard 종결 + ROI 메일 활성

**옛 영역 강화**:
- `routes/super-admin.ts` — 1-click 체험 부여 endpoint 신설
- `routes/auth.ts` — 로그인 직후 wizard 자동 진입 분기 추가
- `routes/onboarding.ts` (신규) — wizard 7 step endpoint 통합
- `utils/sender-registration.ts` — 신청 시점 Harold 즉시 알림 강화
- `app.ts` — daily-insight-mailer + daily-trial-expiry-worker 등록

### Phase 3 — Frontend OnboardingWizard + 7 step 컴포넌트 (8~10h)

**신규 컴포넌트 8건**:
1. `pages/OnboardingWizardPage.tsx` — 메인 wizard 페이지 (7 step 진행률 카드 + Step 라우팅 + 다크 톤 + sticky 헤더 + skip 버튼)
2. `components/onboarding/OnboardingStep1Welcome.tsx` — 환영
3. `components/onboarding/OnboardingStep2Sender.tsx` — 발신번호 + 서류 업로드
4. `components/onboarding/OnboardingStep3Import.tsx` — customer 임포트 + AI 매핑
5. `components/onboarding/OnboardingStep4Segment.tsx` — 세그먼트 자연어
6. `components/onboarding/OnboardingStep5Draft.tsx` — 본문 자연어 + 편집
7. `components/onboarding/OnboardingStep6Sample.tsx` — 샘플 발송
8. `components/onboarding/OnboardingStep7Roi.tsx` — ROI 자동 측정 안내

**옛 강화**:
- `Dashboard.tsx` — OnboardingCard (skip 사용자 재진입 카드) 추가
- `App.tsx` — `/onboarding` 라우트 신설 + 로그인 직후 자동 redirect
- `sys.hanjullo.com` 슈퍼관리자 안 1-click 체험 부여 컴포넌트 신설

### Phase 4 — Worker + 알림 강화 (2~3h)

- daily-insight-mailer 1시간 cron (9시 정각만 발화) + 옛 D215+ CT-85 SMTP relay 활용
- daily-trial-expiry-worker 1시간 cron (30일 종결 자동 정리)
- sender-registration.ts 신청 시 슈퍼관리자(Harold) 즉시 알림톡/SMS 발송 강화

### Phase 5 — 자가 검증 (1~2h)

- backend + frontend tsc 0 errors
- 박-단어 / "진정" / "영영" / 모델명 / native dialog grep 0건
- 7-1 컨트롤타워 grep — CT-95/96/97/98 인라인 잔존 0건

### Phase 6 — Harold 직접 배포

```
tp-push "D219+ Phase 1~5 종결 — Wizard + 슈퍼관리자 1-click 체험 부여 + AI 자동 컬럼 매핑 + 자연어 segment + 매일 9시 인사이트 메일"
```

```bash
cd ~/targetup-app && git pull
cd ~/targetup-app/packages/backend && npm run build:safe
cd ~/targetup-app/packages/frontend && npm run build:safe
pm2 restart all
```

DB SQL (Harold 직접 PG 실행 의무) = 위 Phase 1 영역 정합.

### Phase 7 — 영구 룰 + 메모리 갱신

- `memory/project_d219_session_full_completed.md` 신설 (Phase 0 + Phase 1~7 통합 매트릭스)
- `memory/MEMORY.md` Hot Project D219+ 1번 위로 갱신
- `status/STATUS.md` CURRENT_TASK D220+ 진입 가이드 신설

---

## 3. 다음 세션 진입 명령어 (첫 메시지 — 즉시 복사 가능)

```
status/STATUS.md CURRENT_TASK § D220+ 진입 가이드 정독 + docs/superpowers/specs/2026-05-26-onboarding-wizard-trial-design.md 정독 + docs/superpowers/handoffs/2026-05-26-d219-wizard-next-session-handoff.md 정독 + memory/feedback_no_bakkeum_usage.md 정독 (박-단어 / "진정" / "영영" / "옛" 단어 0건 절대 의무) + memory/feedback_default_superpowers_workflow.md 정독 + memory/feedback_cto_mandate_for_vito.md 정독 + memory/project_d219_part1_completed.md 정독 → D219+ Phase 1~7 진행 (DB SQL 3건 + CT 4건 신규 + endpoint 10건 + Frontend OnboardingWizard 8 컴포넌트 + Dashboard 카드 + 슈퍼관리자 1-click 부여 + worker 2건 + 자가 검증 + 배포 + 메모리 갱신)
```

---

## 4. 다음 세션 영구 룰 정합 매트릭스

- `cto_mandate_for_vito` — CTO 사명감 + 정합성 100%
- `marketing_user_ux_priority` — 1-click 정합 (7 step 각 5분 안)
- `ai_no_arbitrary_benefit` — AI 본문 placeholder 잔존 차단
- `no_target_auto_relax` — segment 0건 자동 완화 X
- `no_native_browser_dialog` — ConfirmModal + useToast
- `design_quality_minimum_journey_level` — 다크 톤 + violet 액센트 + Source caption + 모바일 반응형
- `no_operation_verification_by_ai` — Manual Test = Harold + 직원 직접
- `feedback_no_bakkeum_usage § D218+` — 박-단어 / "진정" / "영영" / "옛" 단어 0건
- `feedback_no_preview_verification` — preview MCP 도구 0건 사용
- `feedback_default_superpowers_workflow` — brainstorming → writing-plans → executing-plans
- `ai_operator_user_gating` — AI_OPERATOR_ALLOWED_USERS 정합 + 체험 부여 흐름
- `ai_operator_model_isolation` — wizard AI 호출 = Opus 4.7 (`model: 'opus'`)
- `feedback_jondaetmal_to_harold` — Harold 대상 존댓말 절대
- `feedback_push_and_deploy_commands` — 절대 경로 매트릭스 (`cd ~/targetup-app/packages/backend`)

---

## 5. 다음 세션 진입 시점 의무 흐름

1. 본 핸드오프 문서 정독 (위 매트릭스 전수)
2. spec 문서 정독 (`docs/superpowers/specs/2026-05-26-onboarding-wizard-trial-design.md`)
3. 영구 룰 5건 정독 (`memory/feedback_no_bakkeum_usage.md` + 4건)
4. MANDATORY_CHECKLIST 자가 출력 + 자가진단 종결
5. Phase 1 진입 — DB SQL 안내 + CT-95/96/97/98 신규
6. Phase 2 진입 — Backend endpoint 10건 + 슈퍼관리자 1-click
7. Phase 3 진입 — Frontend OnboardingWizard + 7 step + Dashboard 카드
8. Phase 4 진입 — Worker 2건 + sender-registration 알림 강화
9. Phase 5 자가 검증 종결 (backend + frontend tsc 0 errors + 광범위 grep 0건)
10. Phase 6 배포 명령어 안내 (Harold 직접)
11. Phase 7 영구 룰 + 메모리 갱신 (배포 종결 후)

---

> 본 문서 = D219+ Phase 1~7 진입 의무 매트릭스 종결. 다음 세션 첫 메시지 = 위 § 3 명령어 복사 진입.
