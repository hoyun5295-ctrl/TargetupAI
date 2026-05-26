# D219+ Part 2 — Wizard + AI 오퍼레이션 30일 무료체험 분리 흐름 (다음 세션 진입 핸드오프)

> **본 세션 종결일**: 2026-05-26
> **본 세션 처리 영역**: Phase 0 = AI 다듬기 팝업 3건 다크 톤 정정 + AI 오퍼레이션 게이팅 원복 (hoyun → ENT)
> **다음 세션 진입 목적**: Wizard + AI 오퍼레이션 30일 무료체험 별도 흐름 통합 진행
> **Harold 명시 (2026-05-26)**: "Wizard 강압 X + 오늘 하루 보지 않기 + 슈퍼관리자 30일 AI 오퍼레이션 무료체험 분리 흐름 (BASIC 사용자도 부여 가능)"

---

## 1. 본 세션 종결 매트릭스 (Part 1)

### Phase 0 — AI 다듬기 팝업 다크 톤 정정 (3 파일)

| 영역 | 결과 | 파일 |
|------|------|------|
| DirectSendAiRefinePopup 다크 톤 + 풍성 Before/After | ✓ 종결 | `packages/frontend/src/components/DirectSendAiRefinePopup.tsx` |
| AiRefineModal 다크 톤 + violet 액센트 변환 | ✓ 종결 | `packages/frontend/src/components/AiRefineModal.tsx` |
| AiRefineLockedModal 다크 톤 정합 + 풍성 Before/After | ✓ 종결 | `packages/frontend/src/components/AiRefineLockedModal.tsx` |
| frontend tsc 0 errors + 박-단어 + 모델명 + native dialog grep 0건 | ✓ 종결 | - |
| memory/project_d219_part1_completed.md 신설 | ✓ 종결 | `memory/project_d219_part1_completed.md` |

### 추가 진행 영역 (본 세션 사고 정정 + 진단)

| 영역 | 결과 |
|------|------|
| AI 오퍼레이션 게이팅 원복 (hoyun → ENT 자동 진입) | ✓ 종결 (`AI_OPERATOR_ALLOWED_USERS=` env 비우기 + pm2 restart) |
| monitor-dist.sh 자동 복구 작동 검증 | ✓ 5/26 23:24:01 자동 복구 + SMS 알림 (제 안내 명령어 영향) |
| 사용자 도메인 매핑 진단 | ✓ `hanjul.ai` = packages/frontend = 회사 admin 진입 영역 / `app.hanjul.ai` = company-frontend = 별도 단순 영역 |
| nginx 캐시 정책 진단 | ✓ Cache-Control X + ETag = vite hash 매트릭스 정합 = PC 껐다 켜면 자동 갱신 ✓ |
| 메모리 영구 룰 강화 — "옛" 단어 0건 절대 의무 | ✓ `memory/feedback_no_bakkeum_usage.md § D219+ Part 1` 신설 |

### 본 세션 사고 정합 (재발 차단 의무)

1. **"옛" 단어 자기 강화 루프 사고** — 박-단어 + 진정 + 영영과 동일 패턴 (5회+ 누적) → `memory/feedback_no_bakkeum_usage.md § D219+ Part 1` 영구 룰 신설
2. **잘못된 도메인 매핑 추정 사고** — `app.hanjul.ai` = 회사 admin으로 잘못 추정 → 진짜 회사 admin = `hanjul.ai` 진입 영역 정합
3. **강제 재빌드 명령어 위험 측정 X 사고** — `rm -rf dist` 안내 → monitor-dist.sh 자동 복구 발화 + SMS 알림. 향후 안내 시 monitor cron 영역 사전 명시 의무

---

## 2. 다음 세션 진입 영역 (Part 2)

### Phase 1 — AI 오퍼레이션 30일 무료체험 분리 흐름 (4~5h)

**기존 PRO 무료체험 흐름 evidence 정합**:
- `packages/backend/src/routes/companies.ts:1318~` CT-17 영역
- `POST /api/companies/:id/grant-trial` (슈퍼관리자 전용) — plan_id = TRIAL + 30일
- `POST /api/companies/:id/revoke-trial` — plan_id = FREE
- `utils/trial-downgrade-worker.ts` — 매일 04:00 KST 자동 강등 cron
- `utils/plan-guard.ts` — subscription_status + trial_expires_at 게이팅
- `frontend/src/pages/AdminDashboard.tsx` — 부여 UI 영역

**분리 흐름 매트릭스 (Harold 명시 2026-05-26)**:

| 영역 | 기존 PRO 무료체험 | 신규 AI 오퍼레이션 무료체험 |
|------|-----------------|-------------------------|
| 컬럼 | `plan_id` (TRIAL plan) + `trial_expires_at` | `companies.ai_operator_trial_started_at` + `ai_operator_trial_until` (별도) |
| 영향 범위 | 전체 PRO 기능 무료 | **AI 오퍼레이션만 무료** (기존 plan_code 유지) |
| 게이팅 | plan_code = PRO/BUSINESS/ENT/TRIAL | `isAiOperatorAllowed = ENT 플랜 OR ai_operator_trial_until > NOW()` |
| 자동 종결 cron | trial-downgrade-worker.ts | `ai-operator-trial-expire-worker.ts` (신설) |
| 부여 UI | AdminDashboard.tsx 기존 버튼 | AdminDashboard.tsx 별도 버튼 추가 |

**DB ALTER (Harold 직접 PG 실행 의무)**:

```sql
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS ai_operator_trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_operator_trial_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_companies_ai_operator_trial_until
  ON companies(ai_operator_trial_until)
  WHERE ai_operator_trial_until IS NOT NULL;
```

**신규 endpoint 2건** (기존 grant-trial 패턴 미러):

```typescript
// POST /api/companies/:id/grant-ai-operator-trial — 30일 부여
router.post('/:id/grant-ai-operator-trial', requireUuidId, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const days = Math.max(1, Math.min(Number(req.body?.days) || 30, 365));
  const updated = await query(
    `UPDATE companies
        SET ai_operator_trial_started_at = NOW(),
            ai_operator_trial_until = NOW() + ($1::int || ' days')::interval,
            updated_at = NOW()
      WHERE id = $2
    RETURNING id, ai_operator_trial_started_at, ai_operator_trial_until`,
    [days, id],
  );
  return res.json({ success: true, message: `${days}일 AI 오퍼레이션 무료체험 부여 완료`, company: updated.rows[0] });
});

// POST /api/companies/:id/revoke-ai-operator-trial — 즉시 종료
router.post('/:id/revoke-ai-operator-trial', requireUuidId, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const updated = await query(
    `UPDATE companies
        SET ai_operator_trial_until = NOW(),
            updated_at = NOW()
      WHERE id = $1 AND ai_operator_trial_until > NOW()
    RETURNING id, ai_operator_trial_until`,
    [id],
  );
  if (updated.rows.length === 0) return res.status(400).json({ error: '활성 무료체험이 없습니다.' });
  return res.json({ success: true, message: 'AI 오퍼레이션 무료체험 취소 완료' });
});
```

**isAiOperatorAllowed 게이팅 정정 (`utils/plan-guard.ts`)**:

```typescript
export function isAiOperatorAllowed(planCtx: PlanContext, user?: AuthUser): boolean {
  // 1. 슈퍼관리자 / 직원 분기 (기존 정합)
  if (user?.userType === 'super_admin') return true;
  // 2. 환경변수 화이트리스트 (디버깅/베타 영역)
  const envAllowed = (process.env.AI_OPERATOR_ALLOWED_USERS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (envAllowed.length > 0 && user?.loginId && envAllowed.includes(user.loginId)) return true;
  // 3. ENT 플랜 = 자동 진입
  if (planCtx.planCode === 'ENT' || planCtx.planCode === 'ENTERPRISE') return true;
  // 4. AI 오퍼레이션 무료체험 부여 + 미만료 = 진입 가능 (신규)
  if (planCtx.aiOperatorTrialUntil && new Date(planCtx.aiOperatorTrialUntil) > new Date()) return true;
  return false;
}
```

**AdminDashboard.tsx UI 추가**:

기존 "PRO 무료체험 부여" 버튼 옆에 "AI 오퍼레이션 무료체험 부여" 버튼 추가. 동일 UX 패턴 유지.

**자동 종결 cron (`utils/ai-operator-trial-expire-worker.ts` 신설)**:

`trial-downgrade-worker.ts` 패턴 미러. 매일 04:00 KST 실행. `ai_operator_trial_until < NOW()` 검출 → 별도 SET 의무 없음 (게이팅 함수가 NOW() 비교로 자동 차단).

### Phase 2 — Wizard 컴포넌트 + "오늘 하루 보지 않기" 옵션 (4~6h)

**Wizard 진입 흐름 (Harold 명시 2026-05-26)**:
- AI 오퍼레이션 무료체험 부여된 사용자 = 다음 로그인 시 Wizard 자동 진입
- **강압 X** = 닫기 자유
- **"오늘 하루 보지 않기"** 옵션 = 24h localStorage cooldown

**닫기 흐름 매트릭스**:

| 사용자 액션 | localStorage 동작 | 다음 진입 시 노출 여부 |
|-----------|------------------|---------------------|
| X 닫기 | `onboarding_wizard_seen = Date.now()` | 다음 로그인 시 즉시 재노출 |
| **"오늘 하루 보지 않기"** | `onboarding_wizard_dismissed_until = Date.now() + 24h` | 24h 안 미노출 + 24h 경과 후 자동 재노출 |
| "지금 시작" → step 진행 | onboarding_wizard_state 테이블에 진행률 저장 | 진행률 이어서 노출 |
| Wizard step 7 완료 | onboarding_wizard_state.completed_at = NOW() | 영구 미노출 (단 admin 영역 "다시 진입" 카드 활용) |

**Wizard 7 step 본질 (기존 spec 정합)**:

| step | 영역 | 5분 안 완성 의무 |
|------|------|----------------|
| 1 | 환영 + 회사 정보 확인 | ✓ |
| 2 | 발신번호 + 서류 업로드 (Harold 즉시 검수 + 인증 라인 우선) | ✓ |
| 3 | customer 임포트 + AI 자동 매핑 + confirm | ✓ |
| 4 | 세그먼트 자연어 + 매칭 수 + saved_segments INSERT | ✓ |
| 5 | 본문 자연어 → 즉시 본문 생성 + 편집 모드 | ✓ |
| 6 | 샘플 발송 (admin 본인 phone + 인증 라인 무료) | ✓ |
| 7 | 매일 9시 자동 인사이트 메일 기본 ON | ✓ |

### Phase 3 — 자가 검증 + 메모리 갱신 (1h)

- backend + frontend tsc 0 errors
- 박-단어 + "옛" + "진정" + "영영" + 모델명 + native dialog grep 0건 (영구 룰 강화 본 시점)
- 메모리 갱신 (`memory/project_d219_part2_completed.md` 신설)
- 핸드오프 다음 세션 (D220+ 진입 가이드) 작성

### 다음 세션 총 분량

| Phase | 영역 | 분량 |
|-------|------|------|
| 1 | AI 오퍼레이션 30일 무료체험 분리 흐름 (DB + endpoint + UI + 게이팅 + cron) | 4~5h |
| 2 | Wizard 7 step + "오늘 하루 보지 않기" + CT-95/96/97/98 신규 + Dashboard 카드 | 4~6h |
| 3 | 자가 검증 + 메모리 갱신 + 배포 + 영구 룰 갱신 | 1~2h |
| **총** | | **9~13h** (단일 세션 가능) |

---

## 3. 다음 세션 진입 명령어 (첫 메시지 — 즉시 복사 가능)

```
status/STATUS.md CURRENT_TASK § D219+ Part 2 진입 가이드 정독 + docs/superpowers/specs/2026-05-26-onboarding-wizard-trial-design.md 정독 + docs/superpowers/handoffs/2026-05-26-d219-wizard-next-session-handoff.md 정독 + memory/feedback_no_bakkeum_usage.md § D219+ Part 1 정독 ("옛" 단어 + 박-단어 + 진정 + 영영 0건 절대 의무) + memory/project_d219_part1_completed.md 정독 + memory/feedback_default_superpowers_workflow.md 정독 + memory/feedback_cto_mandate_for_vito.md 정독 + memory/feedback_ai_operator_user_gating.md 정독 → D219+ Part 2 진행 (Phase 1 AI 오퍼레이션 30일 무료체험 분리 흐름 DB ALTER 2 컬럼 + endpoint 2건 신설 + AdminDashboard UI 추가 + plan-guard 게이팅 정정 + ai-operator-trial-expire-worker 신설 / Phase 2 Wizard 7 step + 오늘 하루 보지 않기 옵션 + CT-95/96/97/98 신규 + Dashboard 진입 카드 / Phase 3 자가 검증 + 메모리 갱신 + 배포)
```

---

## 4. 다음 세션 영구 룰 정합 매트릭스 (자가 grep 의무)

매 답변 출력 직전 자가 grep 의무:

| 단어 | 의무 |
|------|------|
| **"옛"** | **0건 절대 의무 (D219+ Part 1 영구 룰 신설)** |
| 박-단어 (박음/박힘/박는/박지/박을/박혀/박힌/박혔/박힐/박았) | 0건 |
| "진정" | 0건 (D218+ 영구 룰) |
| "영영" | 0건 (D217+ 영구 룰) |
| 모델명 (Opus/Sonnet/Haiku/GPT/Claude/Anthropic) | UI 노출 0건 |
| native dialog (alert/confirm/prompt) | Frontend 0건 |
| sudo / tp-deploy-full / ssh administrator | 안내 0건 |
| 떠넘기기 (부탁드립니다/컨펌 부탁/진행 부탁) | 0건 |

### 영구 룰 11건 정합 매트릭스

- `cto_mandate_for_vito` — CTO 사명감 + 정합성 100%
- `marketing_user_ux_priority` — 1-click 정합 (Wizard 각 step 5분 안)
- `ai_no_arbitrary_benefit` — AI 본문 placeholder 잔존 차단
- `no_target_auto_relax` — segment 0건 자동 완화 X
- `no_native_browser_dialog` — ConfirmModal + useToast 활용
- `design_quality_minimum_journey_level` — 다크 톤 + violet 액센트 + Source caption + 모바일 반응형
- `no_operation_verification_by_ai` — Manual Test = Harold + 직원 직접
- `feedback_no_bakkeum_usage § D219+ Part 1` — 박-단어 + "진정" + "영영" + "옛" 0건 절대 의무
- `feedback_no_preview_verification` — Claude_Preview MCP 도구 0건 사용
- `feedback_jondaetmal_to_harold` — Harold 대상 존댓말 절대
- `feedback_ai_operator_user_gating` — AI 오퍼레이션 게이팅 흐름 정합 (ENT 플랜 + 무료체험 부여 + ENV 화이트리스트)

---

## 5. 다음 세션 진입 시점 의무 흐름

1. 본 핸드오프 문서 정독 (위 매트릭스 전수)
2. spec 문서 정독 (`docs/superpowers/specs/2026-05-26-onboarding-wizard-trial-design.md`)
3. `feedback_no_bakkeum_usage § D219+ Part 1` 영구 룰 정독 ("옛" 단어 절대 0건 의무)
4. `feedback_ai_operator_user_gating` 영구 룰 정독 (AI 오퍼레이션 게이팅 정합)
5. MANDATORY_CHECKLIST 자가 출력 + 자가진단 종결
6. Phase 1 진입 — DB ALTER 2 컬럼 안내 + endpoint 2건 신설 + AdminDashboard UI 추가
7. Phase 2 진입 — plan-guard 게이팅 정정 + ai-operator-trial-expire-worker 신설
8. Phase 3 진입 — Wizard 7 step + "오늘 하루 보지 않기" + CT-95/96/97/98 신규
9. Phase 4 자가 검증 종결 (backend + frontend tsc 0 errors + 광범위 grep 0건)
10. Harold 직접 배포 명령어 안내
11. 영구 룰 + 메모리 갱신 (배포 종결 후)

---

## 6. 배포 명령어 (Part 2 종결 직후)

```
tp-push "D219+ Part 2 종결 — AI 오퍼레이션 30일 무료체험 분리 흐름 (DB ALTER 2 컬럼 + endpoint 2건 + AdminDashboard UI + plan-guard 게이팅 정정 + ai-operator-trial-expire-worker) + Wizard 7 step + 오늘 하루 보지 않기 옵션 + CT-95/96/97/98 신규"
```

서버 SSH 진입 후:

```bash
cd ~/targetup-app && git pull
cd ~/targetup-app/packages/backend && npm run build:safe
cd ~/targetup-app/packages/frontend && npm run build:safe
pm2 restart all
```

DB SQL (Harold 직접 PG 실행 의무):
1. `ALTER TABLE companies ADD COLUMN ai_operator_trial_started_at timestamptz`
2. `ALTER TABLE companies ADD COLUMN ai_operator_trial_until timestamptz`
3. `CREATE INDEX idx_companies_ai_operator_trial_until ON companies(ai_operator_trial_until) WHERE ai_operator_trial_until IS NOT NULL`
4. (Wizard 영역) `CREATE TABLE onboarding_wizard_state ...` (spec 정합)
5. (Wizard 영역) `CREATE TABLE daily_insight_email_log ...` (spec 정합)
6. (Wizard 영역) `ALTER TABLE companies ADD COLUMN onboarding_progress JSONB`

---

> 본 문서 = D219+ Part 2 진입 의무 매트릭스 종결. 다음 세션 첫 메시지 = 위 § 3 명령어 복사 진입.
