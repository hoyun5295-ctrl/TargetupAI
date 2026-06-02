# 크레딧 재매핑 + 성과 리포트 PDF + 예측 온오프 + 여정 수정 — 다음 세션 핸드오프

> 작성 2026-06-02. **다음 세션의 비토가 이 문서만 읽고 작업2~5를 빈틈없이 완료**하도록 작성. spec: `docs/superpowers/specs/2026-06-02-credit-remap-and-features.md`.
> 진입 순서: ① 이 문서 정독 → ② LESSONS_DB 정독(돈 작업) → ③ '미확정 — 1단계 확인' 4건 코드/SQL 확인 → ④ 작업2~5 하나씩 구현·검증 → ⑤ 통합 배포.

## 0. 절대 기준 (Harold 토론 확정 — 변경 금지)

- 1크레딧 = 500원. `CREDIT_UNIT_PRICE = 500`.
- **작업당 크레딧(협의 확정, 금액표 자체는 불변)**: 풀분석 300 / 여정 설계 150 / 자동 마케팅 200 / 모바일 DM 30 / 인앱 15 / 문안·분석 5 / 다듬기·질문 1. 이 표는 바꾸지 않는다. 바뀌는 건 '어느 기능이 어느 항목에 매핑되냐'뿐.
- **플랜 월 크레딧(실 화면값, SCHEMA.md 옛값 무시)**: 스타터 300(15만원) / 베이직 750(35만원) / 프로 2,400(100만원) / 비즈 7,800(300만원) / 엔터 16,500(550만원). ⚠️ SCHEMA.md `ai_credits_per_month`(스타터50 등)는 stale — 절대 신뢰 금지. 실제는 plans row(SQL)로 확정.
- backend `CREDIT_COST_MAP`(ai-credit-calc.ts:70) ↔ frontend `credit.ts`(CREDIT_TASK_COSTS:21 / CREDIT_SOURCE_LABELS:72) **1:1 동기화 의무** — 한쪽만 바꾸지 말 것.
- 돈 작업 원칙(LESSONS_DB): checkCredit 사전 차단 + deductCreditSafe 성공 후 차감 + idempotent + 트랜잭션. SCHEMA 추측 금지(information_schema/실 row 확인).

## 1. 이번 세션 완료 (배포 전, 통합 배포 예정)

### 1-A. 여정 미리보기 타겟 연동 (별 작업, 이미 검증 완료)
- 신규 `packages/backend/src/utils/journey-target-extractor.ts` (selectJourneyTargetCustomerIds + buildJourneyPreviewSamples)
- journey-trigger-watcher.ts(공유 함수 호출, 발송 동작 보존), ai.ts(sample-customer/preview-samples/preview-target-samples), JourneysPage.tsx, LiquidPreviewModal.tsx, highlightVars.tsx
- backend·frontend tsc 0. 상세는 `docs/superpowers/plans/2026-06-02-journey-preview-target-fix.md`.

### 1-B. 작업1 — 한줄 입력(orchestrate) 풀분석 300 → 문안·분석 5 (완료·검증)
- `ai-credit-calc.ts:70 CREDIT_COST_MAP`에 `'ai-operator-propose': 5` 추가 (orchestrate 300은 성과 리포트용으로 유지).
- `frontend credit.ts CREDIT_SOURCE_LABELS`에 `'ai-operator-propose': '문안·분석'` 추가.
- `ai.ts` propose endpoint(약 1168): `orchestratorFn(ctx, { source: 'ai-operator-propose', cost: 5 })`.
- 검증: backend·frontend tsc 0, ai-credit-calc.verify.ts 전체 ok, 박-단어/모델명 0.

## 2. 확인된 코드 위치 (빠른 진입용)

| 대상 | 위치 |
|------|------|
| CREDIT_COST_MAP | `packages/backend/src/utils/ai-credit-calc.ts:70` |
| frontend 단가/라벨 | `packages/frontend/src/constants/credit.ts` (CREDIT_TASK_COSTS:21, CREDIT_SOURCE_LABELS:72) |
| orchestrate 차감(진입1회) | `services/ai-orchestrator.ts:293`(orchestrate), `:560`대(orchestrateWithAI). source/cost creditOpts |
| 여정 생성(돌려보기) 차감 | `utils/journey-ai-generator.ts:498`(source 'journey-ai-generate'), `utils/journey-builder.ts:425`(source 'journey-builder-custom') — callAIWithFallback에 source 넘겨 차감 |
| 여정 활성화(저장) | `utils/journey-builder.ts:474 activateJourney`, endpoint `routes/ai.ts:2349 POST /operator/journeys/:id/activate`. 차감 없음 |
| activateJourney status 가드 | journey-builder.ts:497 — `draft`/`paused`만 활성화(active 재활성화 차단). **paused→active 재개는 통과** |
| 예측 배치 | `utils/predictive-worker.ts` — 1시간 cron, 대상 BUSINESS/ENTERPRISE OR 최근30일 cdp_events, **차감 없음(무료)** |
| 연동 판별 | 싱크에이전트 `sync_agents` 테이블 / SDK `cdp_events.source='custom_sdk'` (SCHEMA 1071/1508) |
| 여정 수정 버튼 | `JourneysPage.tsx:1204`(상세), `:1207`(통계)만 — 수정 진입 없음 |
| checkCredit / deductCreditSafe | `utils/ai-credit.ts:66 / :120` (InsufficientCreditError throw / SKIP) |
| 멱등키 메커니즘 | ai-credit.ts:134 — aiCallLogId 있으면 그걸로, 없으면 `fallback:...:Date.now()`(**호출마다 달라 중복 차단 안 됨**) |
| 크레딧 단위검증 | `utils/__tests__/ai-credit-calc.verify.ts` (ts-node --transpile-only로 실행) |
| 성과 리포트 페이지 | `frontend PerformancePage.tsx`, endpoint `ai.ts:1549 /operator/self-diagnosis` 등 (작업5에서 정확 위치 확정) |

## 3. 미확정 — 다음 세션 1단계에서 반드시 확인 (추측 금지)

1. **deductCredit 내부 aiCallLogId가 ai_call_logs FK인지**: `ai-credit.ts deductCredit` 본문(약 78~110) 읽기. FK면 journeyId를 aiCallLogId에 넣으면 안 됨 → 대신 deductCredit에 idempotencyKey 직접 받는 경로가 있는지 확인. 멱등키를 `journey-activate:${journeyId}`로 고정해야 paused→active 재개 시 중복 차감 0.
2. **성과 리포트 분석 endpoint 정확 위치 + 현재 차감 유무**: PerformancePage가 호출하는 분석 endpoint(self-diagnosis 또는 기간 성과 endpoint). 거기에 orchestrate source 300 차감이 붙는지/붙일 자리.
3. **활성 여정 수정 정책**: 활성(active) 여정을 수정하면 진행 중 journey_executions에 영향. 수정 = draft 사본 저장 후 재활성화 방식인지, 활성 채로 step만 교체인지 — Harold에게 질의 or 가장 안전한 'draft 복제' 채택.
4. **100만원 플랜 = 프로(2,400) 확정**: plans.price SQL로 최종 확인(선택). 프로 2,400 = 매주 풀분석(월 1,200) 쓰고 1,200 잔여 — Harold '널널' 일치 확인됨.

## 4. 남은 작업 상세

### 작업2 — 여정 돌려보기 3 + 저장 150 분리
**파일**: ai-credit-calc.ts, frontend credit.ts, ai.ts(activate endpoint)
- `CREDIT_COST_MAP`: `'journey-ai-generate': 150 → 3`, `'journey-builder-custom': 150 → 3`, **신규 `'journey-activate': 150`**.
- `frontend credit.ts CREDIT_SOURCE_LABELS`: `'journey-ai-generate'`/`'journey-builder-custom'` → `'여정 생성'`, 신규 `'journey-activate': '여정 설계'`.
- `ai.ts` 상단 import 신설: `import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../utils/ai-credit';` + `import { getCreditCost } from '../utils/ai-credit-calc';` (현재 ai.ts에 credit import 0건).
- `ai.ts` activate endpoint(2349~2367) — **최초 활성화(draft)만** 차감:
  ```ts
  // 최초 활성화(draft→active)만 저장 150 차감. paused→active 재개는 차감 X. 멱등키=journeyId.
  const stRow = await query(`SELECT status FROM journeys WHERE id=$1::uuid AND company_id=$2::uuid`, [req.params.id, companyId]);
  const firstActivation = stRow.rows[0]?.status === 'draft';
  if (firstActivation) await checkCredit(companyId, getCreditCost('journey-activate'));
  const result = await activateJourney(companyId, req.params.id, userId);
  if (!result.ok) return res.status(400).json({ success: false, error: result.reason || '활성화 실패' });
  if (firstActivation) {
    await deductCreditSafe({ companyId, cost: getCreditCost('journey-activate'), source: 'journey-activate', createdBy: userId, /* 멱등키: 미확정#1 확인 후 journeyId 고정 */ });
  }
  return res.json({ success: true });
  ```
  - catch에 `if (err instanceof InsufficientCreditError) return res.status(402).json({ success:false, error:'여정 저장에 필요한 크레딧이 부족합니다.', code:'INSUFFICIENT_CREDIT' });` 추가.
- **주의**: 멱등키(미확정#1) 확정 전엔 deductCreditSafe 기본 멱등키가 Date.now()라 재개 시 중복 차감. firstActivation 가드 + journeyId 멱등키 둘 다 걸 것.
- 검증: backend·frontend tsc 0 + verify ok + grep.

### 작업3 — 여정 수정 버튼
**파일**: JourneysPage.tsx (+ 필요 시 backend 여정 조회/수정 endpoint)
- 저장 여정 목록(1204/1207 버튼 옆)에 '수정' 진입 버튼 추가.
- 편집 화면: review 단계 step 편집 UI 재사용(editingStepIdx 등). 저장 여정 → review 모드로 로드.
- 활성 여정 수정 정책(미확정#3) 확정 후 구현: 안전책은 'draft 사본 생성 → 편집 → 재활성화'.
- native dialog 금지(ConfirmModal/useToast), 모델명 0.

### 작업4 — 예측 자동: 연동 회사만 매일 3 + 온/오프
**파일**: predictive-worker.ts, companies ALTER, 예측/성과 페이지 UI
- predictive-worker: 1시간 → **매일 1회(오전 9시 KST)** + 대상 = 연동 회사만(`sync_agents` 등록 OR `cdp_events.source='custom_sdk'` 존재). 정밀화(최근24h 신규데이터)는 추후.
- 매일 3크레딧 차감: 회사+YYYYMMDD 멱등키(하루 1회 보장). predictive_enabled=false면 skip + 차감 X.
- **DB ALTER**: `companies.predictive_enabled BOOLEAN DEFAULT true` 신설. SQL은 Harold 실행(information_schema 검증 후). endpoint catch에 `column does not exist` → 503 `DB_MIGRATION_PENDING` 분기(LESSONS_DB D214+).
- UI: 성과 리포트/예측 페이지에 온/오프 토글(ConfirmModal). 모델명 0(추상 표기 '자율 예측').

### 작업5 — 풀분석 300 = 성과 리포트 + PDF 보고서
**파일**: 성과 리포트 endpoint(ai.ts), 신규 PDF endpoint(pdfkit), PerformancePage.tsx
- 성과 리포트(기간 7/14/30/90 성과분석) 실행에 source 'orchestrate'(300) 차감 신설(idempotent: 회사+기간+날짜 키). 정확 endpoint는 미확정#2 확인.
- PDF 분석보고서: pdfkit(이미 설치)으로 매출·ROI·채널·시간대·AI 진단 보고서 PDF 생성 endpoint + 다운로드 버튼.
- 작업당 크레딧 카드 '풀분석 300'은 이 성과 리포트를 가리키게 정합(라벨은 유지, 매핑만).

## 5. 검증·배포 (전 작업 공통)
- 각 작업: backend·frontend `node packages\\<pkg>\\node_modules\\typescript\\bin\\tsc --noEmit --project ...` EXIT 0 + ai-credit-calc.verify.ts ok + 자가 grep(박-단어/모델명/native dialog 0).
- 통합 배포(작업1~5 + 여정 미리보기 묶음): `tp-push "..."` → 서버 `ssh administrator@58.227.193.62` → `cd /home/administrator/targetup-app && git pull` → backend `cd packages/backend && npm run build:safe` + `pm2 restart all` → frontend `cd packages/frontend && npm run build:safe`. company-frontend 변경 없으면 제외.
- DB ALTER(작업4 predictive_enabled)는 Harold가 SQL 직접 실행 — 배포 전 안내.
