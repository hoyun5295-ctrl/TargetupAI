// 풀분석 백그라운드 러너 — 단계별 진행 기록 후 PDF 파일 저장.
// 분석 데이터는 기존 함수 재사용, PDF 본문은 공통 renderPerformanceReportPdf(중복 제거).
// 크레딧 차감은 start endpoint(시작 시점)에서 수행 — 러너는 분석·PDF만.
import * as fs from 'fs';
import * as path from 'path';
import { query } from '../config/database';
import { updateProgress, completeJob, failJob } from './full-analysis-job';
import { buildPerformanceSnapshot, buildPerformanceSnapshotV2, type PerformancePeriod } from './next-action-advisor';
import { explainPerformance } from './performance-explainer';
import { buildCohortRetention } from './performance-cohort';
import { buildCampaignAttribution } from './campaign-response-attribution';
import { buildSegmentAnalysis } from './segment-analysis';
import { buildMultiDimComparison, buildMessageAnalysis, buildForecast } from './full-analysis-collect';
import { buildActionPlan } from './action-plan';
import { renderPerformanceReportPdf } from './performance-pdf-render';
import { deductCreditSafe } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';

const PDF_DIR = path.join(__dirname, '../../full-analysis-pdfs');

export async function runFullAnalysis(jobId: string, companyId: string, period: PerformancePeriod, createdBy: string | null): Promise<void> {
  try {
    if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });
    const days = ({ '7d': 7, '14d': 14, '30d': 30, '90d': 90 } as Record<string, number>)[period as string];

    await updateProgress(jobId, 1);
    const snapshot = await buildPerformanceSnapshotV2(companyId, period);
    const companyMeta = await query(
      `SELECT company_name, business_type, brand_name, brand_tone FROM companies WHERE id = $1::uuid`,
      [companyId],
    );
    const companyInfo = companyMeta.rows[0] || {};
    const companyName = companyInfo.company_name || '';

    await updateProgress(jobId, 2);
    let explanation: Awaited<ReturnType<typeof explainPerformance>> | null = null;
    try {
      const sn = await buildPerformanceSnapshot(companyId);
      explanation = await explainPerformance(companyId, sn, companyInfo);
    } catch (e: any) { console.log('[full-analysis] explain skip:', e?.message); }

    const nowMs = Date.now();

    await updateProgress(jobId, 3);
    let cohort: Awaited<ReturnType<typeof buildCohortRetention>> | null = null;
    try { cohort = await buildCohortRetention(companyId, 12); } catch (e: any) { console.log('[full-analysis] cohort skip:', e?.message); }
    let segment: Awaited<ReturnType<typeof buildSegmentAnalysis>> | null = null;
    try { segment = await buildSegmentAnalysis(companyId, nowMs); } catch (e: any) { console.log('[full-analysis] segment skip:', e?.message); }

    await updateProgress(jobId, 4);
    let multidim: Awaited<ReturnType<typeof buildMultiDimComparison>> | null = null;
    try { multidim = await buildMultiDimComparison(companyId, period, nowMs); } catch (e: any) { console.log('[full-analysis] multidim skip:', e?.message); }

    await updateProgress(jobId, 5);
    let attribution: Awaited<ReturnType<typeof buildCampaignAttribution>> | null = null;
    try { attribution = await buildCampaignAttribution(companyId, days); } catch (e: any) { console.log('[full-analysis] attribution skip:', e?.message); }

    await updateProgress(jobId, 6);
    let message: Awaited<ReturnType<typeof buildMessageAnalysis>> | null = null;
    try { message = await buildMessageAnalysis(companyId, period); } catch (e: any) { console.log('[full-analysis] message skip:', e?.message); }

    await updateProgress(jobId, 7);
    let forecast: Awaited<ReturnType<typeof buildForecast>> | null = null;
    try { forecast = await buildForecast(companyId, period, segment?.rfm.segments || []); } catch (e: any) { console.log('[full-analysis] forecast skip:', e?.message); }

    await updateProgress(jobId, 8);
    let actionPlan: ReturnType<typeof buildActionPlan> | null = null;
    try {
      const channels = snapshot.byChannelROI || [];
      const avgSr = channels.length ? channels.reduce((s, c) => s + (c.successRate || 0), 0) / channels.length : 0;
      const lowChannels = channels.filter((c) => (c.successRate || 0) < avgSr).map((c) => ({ label: c.channel, successRate: c.successRate || 0 }));
      actionPlan = buildActionPlan({
        aiRecommendation: explanation?.recommendation || null,
        atRiskCount: forecast?.missed.atRiskCount || 0,
        dormantCount: forecast?.missed.dormantCount || 0,
        lowPerformingChannels: lowChannels,
        newCustomerPct: multidim?.newVsExisting.newPct ?? null,
      });
    } catch (e: any) { console.log('[full-analysis] actionPlan skip:', e?.message); }

    await updateProgress(jobId, 9);
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const pdfPath = path.join(PDF_DIR, `${jobId}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);
    renderPerformanceReportPdf(doc, { snapshot, explanation, cohort, attribution, companyName, period, segment, multidim, message, forecast, actionPlan });
    doc.end();
    await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });

    // 분석·PDF 모두 성공 — 이 시점에만 차감(멱등 키=jobId). 앞 단계 실패 시 여기 도달 안 해 차감 0.
    await deductCreditSafe({ companyId, cost: getCreditCost('orchestrate'), source: 'orchestrate', createdBy, idempotencyKey: `full-analysis:${jobId}` });
    await completeJob(jobId, pdfPath);
    console.log(`[full-analysis] done job=${jobId} company=${companyId} period=${period}`);
  } catch (err: any) {
    console.log(`[full-analysis] FAIL job=${jobId} err=${err?.message}`);
    await failJob(jobId, err?.message || 'unknown');
    // Task 5: 시작 차감분 환불은 endpoint/Task 5에서 추가
  }
}
