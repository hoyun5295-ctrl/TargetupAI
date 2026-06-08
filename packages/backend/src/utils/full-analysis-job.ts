// 풀분석 job 상태 컨트롤타워 — full_analysis_jobs 테이블 CRUD.
// 순수 단계 로직은 full-analysis-steps.ts(DB-free)에서 import.
import { query } from '../config/database';
import { ANALYSIS_STEPS, stepLabel } from './full-analysis-steps';

export interface AnalysisJob {
  id: string;
  company_id: string;
  created_by: string | null;
  period: string;
  purpose: string;
  report_title: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  current_step: number;
  total_steps: number;
  step_label: string | null;
  pdf_path: string | null;
  error: string | null;
}

export async function createJob(o: {
  companyId: string;
  createdBy: string | null;
  period: string;
  purpose: string;
  reportTitle?: string | null;
}): Promise<AnalysisJob> {
  const r = await query(
    `INSERT INTO full_analysis_jobs (company_id, created_by, period, purpose, report_title, total_steps)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [o.companyId, o.createdBy, o.period, o.purpose, o.reportTitle ?? null, ANALYSIS_STEPS.length],
  );
  return r.rows[0] as AnalysisJob;
}

export async function getJob(id: string, companyId: string): Promise<AnalysisJob | null> {
  const r = await query(
    `SELECT * FROM full_analysis_jobs WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return (r.rows[0] as AnalysisJob) ?? null;
}

export async function updateProgress(id: string, step: number): Promise<void> {
  await query(
    `UPDATE full_analysis_jobs SET status = 'running', current_step = $2, step_label = $3, updated_at = now() WHERE id = $1`,
    [id, step, stepLabel(step)],
  );
}

export async function completeJob(id: string, pdfPath: string): Promise<void> {
  await query(
    `UPDATE full_analysis_jobs SET status = 'done', current_step = total_steps, pdf_path = $2, updated_at = now() WHERE id = $1`,
    [id, pdfPath],
  );
}

export async function failJob(id: string, err: string): Promise<void> {
  await query(
    `UPDATE full_analysis_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
    [id, String(err).slice(0, 500)],
  );
}
