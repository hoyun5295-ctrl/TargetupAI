// ============================================================
// campaign-agency.ts — CRM 캠페인 대행 (비즈니스+ 전용 특별 서비스)
// ============================================================
// 스펙: docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md
// 고객사(app.hanjul.ai): 접수만 — 양식 다운로드 · 요청서 업로드 · 내 이력 (isBetaAccessAllowed 게이트)
// 슈퍼관리자(sys.hanjullo.com): 접수함 · 파싱 보정 · 분석 실행(제안서 PDF) · 다운로드 (requireSuperAdmin)
// 컨펌·예약 대행 = 시스템 밖(운영). 제안서 생성 = 무과금(엔진이 runInCreditBundle로 보장).
import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { loadPlanContext, isBetaAccessAllowed, isSubscriptionBlocked } from '../utils/plan-guard';
import { buildRequestTemplateRows, parseRequestSheet, AgencyRequestParsed } from '../utils/crm-agency-request';
import { generateAgencyProposal } from '../utils/crm-agency-proposal';
import { renderAgencyProposalPdf } from '../utils/crm-agency-pdf-render';
import { sendSystemAlert } from '../utils/system-alert';

const router = Router();
router.use(authenticate);

const REQUEST_BASE = path.resolve('./uploads/agency-requests');
const PROPOSAL_BASE = path.resolve('./uploads/agency-proposals');
const STATUS_WHITELIST = ['received', 'designing', 'delivered', 'done', 'on_hold'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  // ★ Codex 적대 리뷰 fix (2026-07-09): .xls 제거 — 양식이 xlsx라 legacy 포맷을 받을 이유 0.
  fileFilter: (_req, file, cb) => {
    const ok = /\.xlsx$/i.test(file.originalname || '');
    if (ok) cb(null, true);
    else cb(new Error('xlsx 파일만 업로드할 수 있습니다.'));
  },
});

// ★ Codex 적대 리뷰 fix: 확장자만 믿지 않음 — xlsx(zip) 매직 바이트 'PK' 검증. rename 업로드 차단.
function isXlsxBuffer(buf: Buffer | undefined): boolean {
  return !!buf && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

// 신규 테이블 미생성(DDL 대기) 안전망 — db_alter_safety_net
function missingRelationResponse(res: Response, err: any): boolean {
  const msg = String(err?.message || '');
  if (msg.includes('does not exist') && (msg.includes('relation') || msg.includes('column'))) {
    res.status(503).json({
      success: false,
      error: 'DB 마이그레이션 필요 — 운영자에게 campaign_agency_requests 생성 실행을 요청해 주세요.',
      code: 'DB_MIGRATION_PENDING',
    });
    return true;
  }
  return false;
}

/** ★ 자격 단일 소스 (Codex 적대 리뷰 fix): 비즈니스+ AND 구독 활성(expired/suspended 차단 — canUseFeature 전 기능 차단 기준과 동일).
 *  고객사 접수·admin 업체 목록·design 실행이 전부 이 기준을 공유한다. */
async function isCompanyEligible(companyId: string): Promise<boolean> {
  const planCtx = await loadPlanContext(companyId);
  if (!planCtx) return false;
  if (isSubscriptionBlocked(planCtx).blocked) return false;
  return isBetaAccessAllowed(planCtx);
}

async function checkEligibility(companyId: string, user: any): Promise<boolean> {
  if (user?.userType === 'super_admin') return true;
  return isCompanyEligible(companyId);
}

function parseUploadedWorkbook(buf: Buffer): AgencyRequestParsed | null {
  try {
    const wb = XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyles: false, cellDates: false, raw: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return null;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as any[][];
    return parseRequestSheet(rows);
  } catch {
    return null;  // 파싱 실패 = 접수는 성공, 슈퍼관리자에서 직원 보정
  }
}

function saveBufferTo(base: string, companyId: string, filename: string, buf: Buffer): string {
  const dir = path.join(base, companyId);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, filename);
  fs.writeFileSync(full, buf);
  return full;
}

// ════════════════════════════════════════════════════════════
// 고객사 — 접수 (비즈니스+ 게이트)
// ════════════════════════════════════════════════════════════

/** 메뉴 노출 판단 — 프론트 이중 게이트용 */
router.get('/eligibility', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.json({ success: true, eligible: false });
    const eligible = await checkEligibility(companyId, req.user);
    return res.json({ success: true, eligible });
  } catch (err: any) {
    console.error('[캠페인대행 eligibility] 오류:', err);
    return res.json({ success: true, eligible: false });
  }
});

/** 캠페인대행요청서 양식 다운로드 (xlsx — 코드가 단일 진실) */
router.get('/template', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId || !(await checkEligibility(companyId, req.user))) {
      return res.status(403).json({ success: false, error: '본 기능은 비즈니스·엔터프라이즈 요금제 전용입니다.', code: 'BETA_GATE' });
    }
    const ws = XLSX.utils.aoa_to_sheet(buildRequestTemplateRows());
    ws['!cols'] = [{ wch: 56 }, { wch: 44 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '캠페인대행요청서');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="hanjul_campaign_agency_request.xlsx"`);
    return res.send(buf);
  } catch (err: any) {
    console.error('[캠페인대행 template] 오류:', err);
    return res.status(500).json({ success: false, error: '양식 생성 실패' });
  }
});

/** 요청서 접수 (파일 업로드) — 파싱 실패해도 접수는 성공(직원 보정 흐름) */
router.post('/requests', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !(await checkEligibility(companyId, req.user))) {
      return res.status(403).json({ success: false, error: '본 기능은 비즈니스·엔터프라이즈 요금제 전용입니다.', code: 'BETA_GATE' });
    }
    if (!req.file?.buffer) return res.status(400).json({ success: false, error: '요청서 파일을 첨부해 주세요.' });
    if (!isXlsxBuffer(req.file.buffer)) return res.status(400).json({ success: false, error: 'xlsx 파일이 아닙니다. 양식을 내려받아 작성한 파일을 올려주세요.' });
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ success: false, error: '행사명을 입력해 주세요.' });
    const memo = String(req.body?.memo || '').trim() || null;

    const parsed = parseUploadedWorkbook(req.file.buffer);
    const filePath = saveBufferTo(REQUEST_BASE, companyId, `${randomUUID()}.xlsx`, req.file.buffer);

    // ★ Codex 적대 리뷰 fix: INSERT 실패(테이블 미생성 포함) 시 저장 파일 정리 — 고아 파일 차단.
    let ins;
    try {
      ins = await query(
        `INSERT INTO campaign_agency_requests
           (company_id, created_by, title, memo, request_file_path, request_file_name, parsed_json)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
         RETURNING id`,
        [companyId, userId || null, title.slice(0, 200), memo, filePath, req.file.originalname || null,
         parsed ? JSON.stringify(parsed) : null],
      );
    } catch (insErr) {
      try { fs.unlinkSync(filePath); } catch { /* 정리 실패는 무시 — 원 에러 우선 */ }
      throw insErr;
    }

    // 운영자 통지 (실패해도 접수 성공 — fire-and-forget)
    sendSystemAlert({
      dedupKey: `agency-request:${ins.rows[0].id}`,
      message: `[캠페인 대행] 새 요청 접수 — 행사명: ${title}. 슈퍼관리자 > 캠페인 대행 설계에서 확인해 주세요.`,
    }).catch((e: any) => console.log('[캠페인대행] 접수 통지 생략:', e?.message || e));

    return res.json({ success: true, id: ins.rows[0].id });
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 접수] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '접수 실패' });
  }
});

/** 내 접수 이력 (상태 읽기 전용) */
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId || !(await checkEligibility(companyId, req.user))) {
      return res.status(403).json({ success: false, error: '본 기능은 비즈니스·엔터프라이즈 요금제 전용입니다.', code: 'BETA_GATE' });
    }
    const r = await query(
      `SELECT id, title, memo, status, created_at, designed_at
         FROM campaign_agency_requests
        WHERE company_id = $1::uuid
        ORDER BY created_at DESC LIMIT 100`,
      [companyId],
    );
    return res.json({ success: true, requests: r.rows });
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 이력] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════
// 슈퍼관리자 — 캠페인 대행 설계
// ════════════════════════════════════════════════════════════

/** 비즈니스+ 업체 목록 (★ 리스트 자체가 비즈니스+ 만 — Harold 불변식) */
router.get('/admin/companies', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    // ★ Codex 적대 리뷰 fix: 구독 만료/정지 제외 — plan-guard ACTIVE_PAID_PLAN_WHERE와 동일 기준.
    const r = await query(
      `SELECT c.id, c.company_name, UPPER(p.plan_code) AS plan_code
         FROM companies c
         JOIN plans p ON c.plan_id = p.id
        WHERE UPPER(p.plan_code) IN ('BUSINESS', 'ENTERPRISE')
          AND COALESCE(c.subscription_status, '') NOT IN ('expired', 'suspended')
        ORDER BY c.company_name ASC`,
    );
    return res.json({ success: true, companies: r.rows });
  } catch (err: any) {
    console.error('[캠페인대행 admin companies] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

/** 접수함 — 전 업체 요청 목록 */
router.get('/admin/requests', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status || '').trim();
    const params: any[] = [];
    let where = '';
    if (status && STATUS_WHITELIST.includes(status)) { params.push(status); where = `WHERE r.status = $1`; }
    const r = await query(
      `SELECT r.id, r.company_id, c.company_name, r.title, r.memo, r.status, r.staff_note,
              r.request_file_name, r.parsed_json, r.proposal_pdf_path IS NOT NULL AS has_proposal,
              r.designed_at, r.created_at
         FROM campaign_agency_requests r
         JOIN companies c ON c.id = r.company_id
         ${where}
        ORDER BY r.created_at DESC LIMIT 200`,
      params,
    );
    return res.json({ success: true, requests: r.rows });
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 접수함] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

/** 요청서 원본 다운로드 */
router.get('/admin/requests/:id/file', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const r = await query(`SELECT request_file_path, request_file_name FROM campaign_agency_requests WHERE id = $1::uuid`, [req.params.id]);
    const row = r.rows[0];
    if (!row?.request_file_path || !fs.existsSync(row.request_file_path)) {
      return res.status(404).json({ success: false, error: '요청서 파일을 찾을 수 없습니다.' });
    }
    return res.download(row.request_file_path, row.request_file_name || 'request.xlsx');
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    return res.status(500).json({ success: false, error: '다운로드 실패' });
  }
});

/** 상태·직원 메모·파싱 보정 */
router.patch('/admin/requests/:id', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const sets: string[] = [];
    const params: any[] = [req.params.id];
    const { status, staff_note, parsed } = req.body || {};
    if (status !== undefined) {
      if (!STATUS_WHITELIST.includes(String(status))) return res.status(400).json({ success: false, error: '허용되지 않는 상태값입니다.' });
      params.push(status); sets.push(`status = $${params.length}`);
    }
    if (staff_note !== undefined) { params.push(String(staff_note || '') || null); sets.push(`staff_note = $${params.length}`); }
    if (parsed !== undefined && parsed !== null && typeof parsed === 'object') {
      params.push(JSON.stringify(parsed)); sets.push(`parsed_json = $${params.length}::jsonb`);
    }
    if (sets.length === 0) return res.status(400).json({ success: false, error: '변경할 값이 없습니다.' });
    sets.push(`updated_at = NOW()`);
    const r = await query(
      `UPDATE campaign_agency_requests SET ${sets.join(', ')} WHERE id = $1::uuid RETURNING id`,
      params,
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: '요청을 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 PATCH] 오류:', err);
    return res.status(500).json({ success: false, error: '수정 실패' });
  }
});

/** 공유 설계 실행 코어 — 요청 행 기준 분석→PDF 저장→효과 검증(6원칙 ②) 후 기록. design·design-adhoc 공유. */
async function executeDesignForRequest(requestId: string): Promise<
  { ok: true; summary: any } | { ok: false; status: number; error: string }
> {
  const r = await query(
    `SELECT id, company_id, title, parsed_json FROM campaign_agency_requests WHERE id = $1::uuid`,
    [requestId],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, status: 404, error: '요청을 찾을 수 없습니다.' };
  const parsed: AgencyRequestParsed | null = row.parsed_json || null;
  if (!parsed) return { ok: false, status: 400, error: '요청서 파싱 결과가 없습니다. 내용을 입력(보정)한 후 실행해 주세요.' };
  if (Array.isArray(parsed.missingRequired) && parsed.missingRequired.length > 0) {
    return { ok: false, status: 400, error: `필수 항목 누락: ${parsed.missingRequired.join(' / ')} — 보정 후 실행해 주세요.` };
  }
  // ★ Codex 적대 리뷰 fix: 실행 시점 자격 재검증 — 다운그레이드·만료된 업체의 과거 접수 건 실행 차단.
  if (!(await isCompanyEligible(row.company_id))) {
    return { ok: false, status: 400, error: '현재 비즈니스·엔터프라이즈 활성 구독 업체가 아닙니다. 요금제·구독 상태 확인 후 진행해 주세요.' };
  }

  // ★ 업체 단일 스코프 — 요청 행의 company_id 하나만 엔진에 전달
  const result = await generateAgencyProposal(row.company_id, parsed);

  // PDF 생성 → 파일 저장 (스트림 완료 대기)
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const pdfDir = path.join(PROPOSAL_BASE, row.company_id);
  fs.mkdirSync(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, `${row.id}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(pdfPath);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.pipe(out);
    renderAgencyProposalPdf(doc, { result, request: parsed });
    doc.end();
  });
  // 효과 검증 — 파일이 실제로 생성됐는지 확인 후에만 성공 기록
  if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
    return { ok: false, status: 500, error: '제안서 PDF 생성이 완료되지 않았습니다. 다시 실행해 주세요.' };
  }
  await query(
    `UPDATE campaign_agency_requests SET proposal_pdf_path = $2, designed_at = NOW(), updated_at = NOW() WHERE id = $1::uuid`,
    [row.id, pdfPath],
  );
  return {
    ok: true,
    summary: {
      requestId: row.id,
      plans: result.plans.map((p) => ({ title: p.title, channel: p.channel, targetCount: p.targetCount, estimatedCost: p.estimatedCost })),
      dataNotes: result.dataNotes,
    },
  };
}

/** 분석 실행 — 제안서 PDF 생성 (멱등: 재실행 = 덮어씀) */
router.post('/admin/requests/:id/design', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const out = await executeDesignForRequest(req.params.id);
    if (!out.ok) return res.status(out.status).json({ success: false, error: out.error });
    return res.json({ success: true, summary: out.summary });
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 design] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '분석 실행 실패' });
  }
});

/** 직행 — 업체 선택 + 양식 업로드 → 접수 행 생성 + 즉시 분석 (Harold 흐름: 1단계) */
router.post('/admin/design-adhoc', requireSuperAdmin, upload.single('file'), async (req: Request, res: Response) => {
  try {
    const companyId = String(req.body?.companyId || '').trim();
    if (!companyId) return res.status(400).json({ success: false, error: '업체를 선택해 주세요.' });
    // 서버 재검증 — 활성 비즈니스+ 만 (프론트 목록 우회 차단, 구독 만료/정지 포함 검사)
    if (!(await isCompanyEligible(companyId))) {
      return res.status(400).json({ success: false, error: '비즈니스·엔터프라이즈 활성 구독 업체만 가능합니다.' });
    }
    if (!req.file?.buffer) return res.status(400).json({ success: false, error: '요청서 파일을 첨부해 주세요.' });
    if (!isXlsxBuffer(req.file.buffer)) return res.status(400).json({ success: false, error: 'xlsx 파일이 아닙니다. 양식 파일인지 확인해 주세요.' });
    const parsed = parseUploadedWorkbook(req.file.buffer);
    if (!parsed) return res.status(400).json({ success: false, error: '요청서 파싱에 실패했습니다. 양식 파일인지 확인해 주세요.' });

    const filePath = saveBufferTo(REQUEST_BASE, companyId, `${randomUUID()}.xlsx`, req.file.buffer);
    // ★ Codex 적대 리뷰 fix: INSERT 실패 시 저장 파일 정리 — 고아 파일 차단(접수 endpoint와 동일).
    let ins;
    try {
      ins = await query(
        `INSERT INTO campaign_agency_requests
           (company_id, title, memo, request_file_path, request_file_name, parsed_json, status)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, 'designing')
         RETURNING id`,
        [companyId, (parsed.title || req.file.originalname || '직접 등록').slice(0, 200), '슈퍼관리자 직접 등록',
         filePath, req.file.originalname || null, JSON.stringify(parsed)],
      );
    } catch (insErr) {
      try { fs.unlinkSync(filePath); } catch { /* 정리 실패는 무시 — 원 에러 우선 */ }
      throw insErr;
    }
    const out = await executeDesignForRequest(ins.rows[0].id);
    if (!out.ok) return res.status(out.status).json({ success: false, error: out.error, requestId: ins.rows[0].id });
    return res.json({ success: true, summary: out.summary });
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 adhoc] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '실행 실패' });
  }
});

/** 제안서 PDF 다운로드 */
router.get('/admin/requests/:id/proposal', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const r = await query(`SELECT proposal_pdf_path, title FROM campaign_agency_requests WHERE id = $1::uuid`, [req.params.id]);
    const row = r.rows[0];
    if (!row?.proposal_pdf_path || !fs.existsSync(row.proposal_pdf_path)) {
      return res.status(404).json({ success: false, error: '제안서가 아직 생성되지 않았습니다.' });
    }
    return res.download(row.proposal_pdf_path, `한줄로_마케팅제안서_${String(row.title || '').slice(0, 40) || 'proposal'}.pdf`);
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    return res.status(500).json({ success: false, error: '다운로드 실패' });
  }
});

export default router;
