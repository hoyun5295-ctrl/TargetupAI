# 풀분석 비동기 Job 백엔드 구현 Plan (Plan 1/3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 기존 동기 `report-pdf`를 비동기 job으로 전환 — 사용자 클릭 시 즉시 jobId 반환, 백그라운드에서 단계별 분석·PDF 생성, 상태 폴링·다운로드. (진행도 모달의 실제 진행 토대 + D231 응답전-무거운작업 504 회피)

**Architecture:** `full_analysis_jobs` 테이블에 job 상태(단계/진행률) 기록 → `start` endpoint가 job 생성 후 `setImmediate`로 백그라운드 러너 기동(즉시 202) → 러너가 단계마다 진행 UPDATE → 완료 시 PDF를 서버 파일로 저장 → `status` 폴링, `download`로 파일 서빙. 분석·PDF 로직은 기존 [ai.ts:1345 report-pdf](packages/backend/src/routes/ai.ts:1345)에서 이식.

**Tech Stack:** Express + TypeScript, PostgreSQL(`pg`), pdfkit, 기존 `utils/ai-credit.ts`(checkCredit/deductCreditSafe), `buildPerformanceSnapshotV2` 등 기존 분석 함수.

---

## File Structure

- Create: `packages/backend/src/utils/full-analysis-job.ts` — job 상태 CT(생성/조회/진행갱신/완료/실패) + 순수 단계 정의
- Create: `packages/backend/src/utils/full-analysis-runner.ts` — 백그라운드 러너(단계별 분석 → PDF 파일 저장)
- Create: `packages/backend/src/utils/__tests__/full-analysis-job.verify.ts` — 순수 단계 로직 테스트
- Modify: `packages/backend/src/routes/ai.ts` — start/status/download endpoint 추가(기존 report-pdf는 Plan 2에서 정리)
- Migration(수동): `full_analysis_jobs` 테이블 CREATE

---

### Task 1: full_analysis_jobs 테이블

**Files:**
- Migration SQL (Harold 실행): 신규 테이블

- [ ] **Step 1: 신규 테이블이라 information_schema에 없음을 확인**

Harold 실행:
```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'full_analysis_jobs';
```
Expected: 0 rows (신규)

- [ ] **Step 2: 테이블 생성 (Harold 실행)**

```sql
CREATE TABLE full_analysis_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  created_by    uuid,
  period        varchar(8)  NOT NULL,          -- 7d/14d/30d/90d
  purpose       varchar(16) NOT NULL DEFAULT 'overall', -- overall/revenue/retention/channel
  report_title  varchar(200),
  status        varchar(16) NOT NULL DEFAULT 'queued',  -- queued/running/done/failed
  current_step  int  NOT NULL DEFAULT 0,
  total_steps   int  NOT NULL DEFAULT 9,
  step_label    varchar(64),
  pdf_path      text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_faj_company_created ON full_analysis_jobs(company_id, created_at DESC);
```

- [ ] **Step 3: 생성 확인 (Harold 실행)**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'full_analysis_jobs' ORDER BY ordinal_position;
```
Expected: 위 13개 컬럼

---

### Task 2: job 상태 CT + 순수 단계 정의

**Files:**
- Create: `packages/backend/src/utils/full-analysis-job.ts`
- Test: `packages/backend/src/utils/__tests__/full-analysis-job.verify.ts`

- [ ] **Step 1: 순수 단계 정의 + 진행률 계산 테스트 작성**

```ts
// full-analysis-job.verify.ts
import assert from 'node:assert';
import { ANALYSIS_STEPS, stepProgress, stepLabel } from '../full-analysis-job';

assert.equal(ANALYSIS_STEPS.length, 9);
assert.equal(stepProgress(0), 0);
assert.equal(stepProgress(9), 100);
assert.equal(Math.round(stepProgress(3)), 33);
assert.equal(stepLabel(1), '성과 진단');
assert.equal(stepLabel(99), 'PDF 생성'); // 범위 밖이면 마지막
console.log('full-analysis-job pure: PASS');
```

- [ ] **Step 2: 실패 확인**

Run: `cd packages/backend && npx ts-node src/utils/__tests__/full-analysis-job.verify.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 순수 부분 + DB CRUD 구현**

```ts
// full-analysis-job.ts
import { query } from '../config/database';

// §5-3 spec 단계(데이터 수집은 step0 진입 전)
export const ANALYSIS_STEPS = [
  '성과 진단', '원인 분석', '세그먼트', '다차원 비교',
  '채널·캠페인', '메시지 분석', '예측', '액션 플랜', 'PDF 생성',
] as const;

export function stepLabel(step: number): string {
  if (step < 1) return ANALYSIS_STEPS[0];
  return ANALYSIS_STEPS[Math.min(step, ANALYSIS_STEPS.length) - 1];
}
export function stepProgress(step: number): number {
  const clamped = Math.max(0, Math.min(step, ANALYSIS_STEPS.length));
  return (clamped / ANALYSIS_STEPS.length) * 100;
}

export interface AnalysisJob {
  id: string; company_id: string; created_by: string | null;
  period: string; purpose: string; report_title: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  current_step: number; total_steps: number; step_label: string | null;
  pdf_path: string | null; error: string | null;
}

export async function createJob(o: {
  companyId: string; createdBy: string | null; period: string;
  purpose: string; reportTitle?: string | null;
}): Promise<AnalysisJob> {
  const r = await query(
    `INSERT INTO full_analysis_jobs (company_id, created_by, period, purpose, report_title, total_steps)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [o.companyId, o.createdBy, o.period, o.purpose, o.reportTitle ?? null, ANALYSIS_STEPS.length],
  );
  return r.rows[0];
}
export async function getJob(id: string, companyId: string): Promise<AnalysisJob | null> {
  const r = await query(`SELECT * FROM full_analysis_jobs WHERE id=$1 AND company_id=$2`, [id, companyId]);
  return r.rows[0] ?? null;
}
export async function updateProgress(id: string, step: number): Promise<void> {
  await query(
    `UPDATE full_analysis_jobs SET status='running', current_step=$2, step_label=$3, updated_at=now() WHERE id=$1`,
    [id, step, stepLabel(step)],
  );
}
export async function completeJob(id: string, pdfPath: string): Promise<void> {
  await query(
    `UPDATE full_analysis_jobs SET status='done', current_step=total_steps, pdf_path=$2, updated_at=now() WHERE id=$1`,
    [id, pdfPath],
  );
}
export async function failJob(id: string, err: string): Promise<void> {
  await query(`UPDATE full_analysis_jobs SET status='failed', error=$2, updated_at=now() WHERE id=$1`, [id, String(err).slice(0, 500)]);
}
```

- [ ] **Step 4: 순수 테스트 통과 확인**

Run: `cd packages/backend && npx ts-node src/utils/__tests__/full-analysis-job.verify.ts`
Expected: `full-analysis-job pure: PASS`

- [ ] **Step 5: 커밋**

```bash
git add packages/backend/src/utils/full-analysis-job.ts packages/backend/src/utils/__tests__/full-analysis-job.verify.ts
git commit -m "feat(full-analysis): job 상태 CT + 순수 단계 정의"
```

---

### Task 3: 백그라운드 분석 러너

**Files:**
- Create: `packages/backend/src/utils/full-analysis-runner.ts`

- [ ] **Step 1: 러너 구현 — 기존 report-pdf 로직 이식 + 단계별 진행 기록**

기존 [ai.ts:1365-1595](packages/backend/src/routes/ai.ts:1365)의 데이터 수집·PDF 생성 코드를 그대로 이식하되: (1) `res.pipe(res)` 대신 `doc.pipe(fs.createWriteStream(pdfPath))`로 파일 저장 (2) 각 데이터 수집 직후 `await updateProgress(jobId, n)` (3) 크레딧은 Task 5에서 시작 시 차감하므로 러너에선 차감 제거 (4) 벤치마크 섹션은 Plan 3에서 제거 — 이 Plan에선 기존대로 유지.

```ts
// full-analysis-runner.ts (골격 — PDF 본문은 ai.ts:1390-1595 이식)
import * as fs from 'fs';
import * as path from 'path';
import { updateProgress, completeJob, failJob } from './full-analysis-job';
import { buildPerformanceSnapshotV2, buildPerformanceSnapshot, explainPerformance,
         buildCohortRetention, buildBenchmark, buildCampaignAttribution } from './<기존 정의 모듈>';
import { query } from '../config/database';

const PDF_DIR = path.join(__dirname, '../../full-analysis-pdfs');

export async function runFullAnalysis(jobId: string, companyId: string, period: any): Promise<void> {
  try {
    if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
    await updateProgress(jobId, 1);
    const snapshot = await buildPerformanceSnapshotV2(companyId, period);
    const days = { '7d': 7, '14d': 14, '30d': 30, '90d': 90 }[period as string];
    // ... companyMeta 조회 (ai.ts:1367)
    await updateProgress(jobId, 2);
    let explanation = null; try { const sn = await buildPerformanceSnapshot(companyId); explanation = await explainPerformance(companyId, sn, companyInfo); } catch {}
    await updateProgress(jobId, 3);
    let cohort = null; try { cohort = await buildCohortRetention(companyId, 12); } catch {}
    await updateProgress(jobId, 4); // 다차원 비교(Plan 3에서 채움 — 지금은 통과)
    await updateProgress(jobId, 5);
    let attribution = null; try { attribution = await buildCampaignAttribution(companyId, days); } catch {}
    await updateProgress(jobId, 6);
    let benchmark = null; try { benchmark = await buildBenchmark(companyId, days); } catch {} // Plan 3에서 제거
    await updateProgress(jobId, 7);
    await updateProgress(jobId, 8);
    await updateProgress(jobId, 9);
    const pdfPath = path.join(PDF_DIR, `${jobId}.pdf`);
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(fs.createWriteStream(pdfPath));
    // === ai.ts:1403-1593 PDF 본문 그대로 이식 ===
    doc.end();
    await new Promise<void>((res2) => doc.on('end', () => res2()));
    await completeJob(jobId, pdfPath);
    console.log(`[full-analysis] done job=${jobId} company=${companyId}`);
  } catch (err: any) {
    console.log(`[full-analysis] FAIL job=${jobId} err=${err?.message}`);
    await failJob(jobId, err?.message || 'unknown');
  }
}
```

> 구현 주의: `buildPerformanceSnapshotV2` 등의 실제 정의 모듈 경로를 grep으로 확인해 import(`grep -rn "export.*buildPerformanceSnapshotV2" packages/backend/src`). PDF 본문은 ai.ts 원본을 1:1 이식해 회귀 0.

- [ ] **Step 2: tsc 통과 확인**

Run: `& "packages\backend\node_modules\.bin\tsc.cmd" --noEmit -p packages\backend\tsconfig.json`
Expected: exit 0

- [ ] **Step 3: 커밋**

```bash
git add packages/backend/src/utils/full-analysis-runner.ts
git commit -m "feat(full-analysis): 백그라운드 러너 — report-pdf 로직 이식 + 단계 진행"
```

---

### Task 4: start/status/download endpoint

**Files:**
- Modify: `packages/backend/src/routes/ai.ts` (기존 report-pdf 근처에 추가)

- [ ] **Step 1: endpoint 추가**

```ts
// POST /operator/performance/full-analysis/start
router.post('/operator/performance/full-analysis/start', async (req, res) => {
  const companyId = req.user?.companyId; const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한 필요' });
  const planCtx = await loadPlanContext(companyId);
  if (!planCtx || !isAiOperatorAllowed(planCtx, req.user)) return res.status(403).json({ success: false, code: 'BETA_GATE', error: '베타 운영 중' });
  const period = (['7d','14d','30d','90d'].includes(req.body?.period) ? req.body.period : '30d');
  const purpose = (['overall','revenue','retention','channel'].includes(req.body?.purpose) ? req.body.purpose : 'overall');
  const cost = getCreditCost('orchestrate'); // 300
  try { await checkCredit(companyId, cost); }
  catch (e: any) { if (e instanceof InsufficientCreditError) return res.status(402).json({ success: false, code: 'INSUFFICIENT_CREDIT', error: '크레딧이 부족합니다.' }); throw e; }
  // 시작 시 차감(멱등 키=jobId 생성 후) — Task 5
  const job = await createJob({ companyId, createdBy: userId, period, purpose, reportTitle: req.body?.reportTitle });
  await deductCreditSafe({ companyId, cost, source: 'orchestrate', createdBy: userId, idempotencyKey: `full-analysis:${job.id}` });
  setImmediate(() => { runFullAnalysis(job.id, companyId, period).catch((e) => console.log('[full-analysis] runner throw', e?.message)); });
  return res.json({ success: true, jobId: job.id, totalSteps: job.total_steps });
});

// GET /operator/performance/full-analysis/status/:id
router.get('/operator/performance/full-analysis/status/:id', async (req, res) => {
  const companyId = req.user?.companyId; if (!companyId) return res.status(403).json({ success: false });
  const job = await getJob(req.params.id, companyId);
  if (!job) return res.status(404).json({ success: false, error: 'job 없음' });
  return res.json({ success: true, status: job.status, currentStep: job.current_step, totalSteps: job.total_steps,
    stepLabel: job.step_label, progress: stepProgress(job.current_step), error: job.error });
});

// GET /operator/performance/full-analysis/download/:id
router.get('/operator/performance/full-analysis/download/:id', async (req, res) => {
  const companyId = req.user?.companyId; if (!companyId) return res.status(403).json({ success: false });
  const job = await getJob(req.params.id, companyId);
  if (!job || job.status !== 'done' || !job.pdf_path) return res.status(409).json({ success: false, error: '아직 준비되지 않았습니다.' });
  const fs = require('fs'); if (!fs.existsSync(job.pdf_path)) return res.status(404).json({ success: false, error: 'PDF 없음' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="full_analysis_${job.period}.pdf"`);
  fs.createReadStream(job.pdf_path).pipe(res);
});
```

- [ ] **Step 2: import 추가 (createJob/getJob/stepProgress/runFullAnalysis)** + tsc

Run: `& "packages\backend\node_modules\.bin\tsc.cmd" --noEmit -p packages\backend\tsconfig.json`
Expected: exit 0

- [ ] **Step 3: 커밋**

```bash
git add packages/backend/src/routes/ai.ts
git commit -m "feat(full-analysis): start/status/download endpoint"
```

---

### Task 5: 크레딧 정책 검증 (시작 차감·멱등·실패 안전)

- [ ] **Step 1: 정책 확인** — start endpoint(Task 4)에서 `checkCredit`(사전 402) → `createJob` → `deductCreditSafe({idempotencyKey: 'full-analysis:'+jobId})`로 시작 시 1회 차감. 같은 jobId 재요청 없음(매 클릭 신규 job)이라 중복 차감 0. 러너 실패는 차감 후이므로 환불 필요 — **단**, spec §7은 "실패 시 환불"이라 러너 catch에서 환불 추가.

```ts
// full-analysis-runner.ts catch 블록에 추가 (Task 3 보강)
} catch (err: any) {
  await failJob(jobId, err?.message || 'unknown');
  // 시작 차감분 환불 (멱등 — 같은 키 1회)
  try { await refundCredit({ companyId, cost: getCreditCost('orchestrate'), source: 'orchestrate', idempotencyKey: `full-analysis-refund:${jobId}` }); }
  catch (e: any) { console.log('[full-analysis] refund miss', e?.message); }
}
```

> 환불 함수는 기존 크레딧 CT에 있는지 grep 확인(`grep -rn "refund" packages/backend/src/utils/ai-credit*`). 없으면 `adjustCredit`(ai-credit.ts:219)로 purchased 가산. 멱등 키로 이중 환불 차단.

- [ ] **Step 2: tsc + 커밋**

```bash
git add packages/backend/src/utils/full-analysis-runner.ts
git commit -m "feat(full-analysis): 실패 시 시작차감 환불(멱등)"
```

---

## Self-Review 체크
- 단계 수(9) ↔ total_steps ↔ ANALYSIS_STEPS 일치
- 차감: 시작 1회(멱등 jobId) + 실패 환불(멱등) — spec §7 정합
- D231: start는 즉시 202, 무거운 분석은 setImmediate 백그라운드 — 504 회피
- 데이터 부족/AI 실패는 기존 report-pdf처럼 graceful(섹션 skip) — 러너 전체 실패 아님
- 벤치마크는 이 Plan에서 유지(Plan 3에서 제거)

## 다음 Plan
- Plan 2(프론트 3모달 + 폴링), Plan 3(보고서 보강 + 벤치마크 제거)
