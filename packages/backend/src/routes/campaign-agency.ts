// ============================================================
// campaign-agency.ts — CRM 캠페인 대행 (비즈니스+ 전용 특별 서비스)
// ============================================================
// 스펙: docs/superpowers/specs/2026-07-09-crm-agency-webform-redesign-design.md (웹 폼 전환)
//       원 설계 = docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md
// 고객사(app.hanjul.ai): 웹 폼 + 행사 이미지(≤5장) 접수 · 내 이력 (isCompanyEligible 게이트)
// 슈퍼관리자(sys.hanjullo.com): 요청 목록 · 상세 모달(이미지·보정) · 분석 실행(제안서 PDF) (requireSuperAdmin)
// 컨펌·예약 대행 = 시스템 밖(운영). 제안서 생성 = 무과금(엔진이 runInCreditBundle로 보장).
// ★ 2026-07-09 웹 폼 전환(Harold): xlsx 양식 다운로드/업로드/파싱 폐지. 폼 값 = parsed_json 직접 저장.
//   기존 xlsx 접수 행은 보존 — request_file_path 있는 행만 원본 다운로드 노출(null 가드).
import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import { loadPlanContext, isBetaAccessAllowed, isSubscriptionBlocked } from '../utils/plan-guard';
import { buildParsedFromForm, AgencyRequestParsed } from '../utils/crm-agency-request';
import { generateAgencyProposal, analyzeAgencyIntakeImages } from '../utils/crm-agency-proposal';
import { renderAgencyProposalPdf } from '../utils/crm-agency-pdf-render';
import {
  sniffImageMediaType, ALLOWED_IMAGE_MEDIA_TYPES, MAX_EVENT_IMAGES, EventImageInput,
} from '../utils/event-image-extract';
// ★ 2026-08-20 상태 전이·고객 제안서 접근 판정 CT — 라우트 인라인 판정 금지(단일 문).
import { nextStatusAfterDesign, canCustomerDownloadProposal } from '../utils/crm-agency-access';
import { sendSystemAlert } from '../utils/system-alert';

const router = Router();
router.use(authenticate);

const REQUEST_BASE = path.resolve('./uploads/agency-requests');
const PROPOSAL_BASE = path.resolve('./uploads/agency-proposals');
const STATUS_WHITELIST = ['received', 'designing', 'delivered', 'done', 'on_hold'];

interface AgencyImageMeta { path: string; name: string; mime: string }

// 행사 이미지 업로드 — event-campaigns imageUpload 미러(메모리 저장, 5MB×5장, jpg/png/webp)
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_EVENT_IMAGES },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) cb(null, true);
    else cb(new Error('JPG, PNG, WebP 이미지만 업로드 가능합니다.'));
  },
});

// 테이블/컬럼 미생성(DDL 대기) 안전망 — db_alter_safety_net
function missingRelationResponse(res: Response, err: any): boolean {
  const msg = String(err?.message || '');
  if (msg.includes('does not exist') && (msg.includes('relation') || msg.includes('column'))) {
    res.status(503).json({
      success: false,
      error: 'DB 마이그레이션 필요 — 운영자에게 campaign_agency_requests 반영 실행을 요청해 주세요.',
      code: 'DB_MIGRATION_PENDING',
    });
    return true;
  }
  return false;
}

/** ★ 자격 단일 소스: 비즈니스+ AND 구독 활성(expired/suspended 차단 — canUseFeature 전 기능 차단 기준과 동일).
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

const MIME_EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/** 업로드 이미지 전수 매직바이트 검증 → 저장. 하나라도 위장 파일이면 저장 전에 실패(부분 저장 없음). */
function validateAndSaveImages(companyId: string, files: Express.Multer.File[]): AgencyImageMeta[] {
  const metas: Array<{ buf: Buffer; name: string; mime: string }> = [];
  for (const f of files) {
    const sniffed = sniffImageMediaType(f.buffer);
    if (!sniffed || !MIME_EXT[sniffed]) {
      throw Object.assign(new Error(`이미지 파일이 아닙니다: ${f.originalname || '이름 없음'} — JPG/PNG/WebP만 가능합니다.`), { statusCode: 400 });
    }
    metas.push({ buf: f.buffer, name: (f.originalname || 'image').slice(0, 200), mime: sniffed });
  }
  const dir = path.join(REQUEST_BASE, companyId);
  fs.mkdirSync(dir, { recursive: true });
  const saved: AgencyImageMeta[] = [];
  // 중간 저장 실패 시 앞서 저장한 파일 정리 후 rethrow — 고아 파일 차단(Codex 2차 리뷰 정정)
  try {
    for (const m of metas) {
      const full = path.join(dir, `${randomUUID()}${MIME_EXT[m.mime]}`);
      fs.writeFileSync(full, m.buf);
      saved.push({ path: full, name: m.name, mime: m.mime });
    }
  } catch (writeErr) {
    unlinkImages(saved);
    throw writeErr;
  }
  return saved;
}

/** 업로드 버퍼 → vision 입력(base64) — 매직바이트 검증, 저장 없음(폼 자동 입력 전용) */
function toVisionInputs(files: Express.Multer.File[]): EventImageInput[] {
  const inputs: EventImageInput[] = [];
  for (const f of files) {
    const sniffed = sniffImageMediaType(f.buffer);
    if (!sniffed || !MIME_EXT[sniffed]) {
      throw Object.assign(new Error(`이미지 파일이 아닙니다: ${f.originalname || '이름 없음'} — JPG/PNG/WebP만 가능합니다.`), { statusCode: 400 });
    }
    inputs.push({ media_type: sniffed, data: f.buffer.toString('base64') });
  }
  return inputs;
}

function unlinkImages(images: AgencyImageMeta[]): void {
  for (const im of images) {
    try { fs.unlinkSync(im.path); } catch { /* 정리 실패는 무시 — 원 에러 우선 */ }
  }
}

/** 클라이언트 응답용 이미지 목록 — 서버 FS 경로는 절대 내보내지 않는다(name만) */
function toClientImages(imagePaths: any): Array<{ name: string }> {
  return (Array.isArray(imagePaths) ? imagePaths : []).map((im: any) => ({ name: String(im?.name || 'image') }));
}

/** 인증 이미지 스트림 — image_paths[idx]를 Content-Type과 함께 전송 */
function streamAgencyImage(res: Response, imagePaths: any, idxRaw: any): void {
  const list = Array.isArray(imagePaths) ? imagePaths : [];
  const idx = Number(idxRaw);
  const im = Number.isInteger(idx) && idx >= 0 ? list[idx] : null;
  if (!im?.path || !fs.existsSync(im.path)) {
    res.status(404).json({ success: false, error: '이미지를 찾을 수 없습니다.' });
    return;
  }
  res.setHeader('Content-Type', im.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(im.path).pipe(res);
}

/** multer 배열 업로드 래퍼 — 장수/용량 초과를 400으로 (event-campaigns 패턴 미러) */
function withImageUpload(handler: (req: any, res: Response) => Promise<any>) {
  return (req: any, res: Response) => {
    imageUpload.array('images', MAX_EVENT_IMAGES)(req, res, async (uploadErr: any) => {
      if (uploadErr) {
        const msg = uploadErr?.code === 'LIMIT_FILE_SIZE' ? '이미지는 장당 5MB 이하만 가능합니다.'
          : uploadErr?.code === 'LIMIT_FILE_COUNT' || uploadErr?.code === 'LIMIT_UNEXPECTED_FILE' ? `이미지는 최대 ${MAX_EVENT_IMAGES}장까지 올릴 수 있습니다.`
          : uploadErr?.message || '이미지 업로드 오류';
        return res.status(400).json({ success: false, error: msg });
      }
      try { await handler(req, res); } catch (err: any) {
        if (missingRelationResponse(res, err)) return;
        if (err?.name === 'AiRateLimitExceeded') {
          return res.status(429).json({ success: false, error: err.message });
        }
        console.error('[캠페인대행 업로드 핸들러] 오류:', err?.message || err);
        return res.status(err?.statusCode === 400 ? 400 : 500).json({ success: false, error: err?.message || '처리 실패' });
      }
    });
  };
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

/** 이미지 → 접수 폼 자동 입력 (저장 없음 · 무과금) — 폼 최상단 [AI로 자동 입력] 버튼 */
router.post('/requests/analyze-images', withImageUpload(async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId || !(await checkEligibility(companyId, req.user))) {
    return res.status(403).json({ success: false, error: '본 기능은 비즈니스·엔터프라이즈 요금제 전용입니다.', code: 'BETA_GATE' });
  }
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) return res.status(400).json({ success: false, error: '이미지를 1장 이상 올려주세요.' });
  const parsed = await analyzeAgencyIntakeImages(companyId, toVisionInputs(files));
  return res.json({ success: true, form: parsed });
}));

/** 요청 접수 — 웹 폼(payload JSON) + 행사 이미지(≤5장). 필수 누락 = 400(폼이 완결 입력을 보장). */
router.post('/requests', withImageUpload(async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId || !(await checkEligibility(companyId, req.user))) {
    return res.status(403).json({ success: false, error: '본 기능은 비즈니스·엔터프라이즈 요금제 전용입니다.', code: 'BETA_GATE' });
  }
  let payloadRaw: any;
  try { payloadRaw = JSON.parse(String(req.body?.payload || '{}')); } catch {
    return res.status(400).json({ success: false, error: '요청 내용 형식이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.' });
  }
  const parsed = buildParsedFromForm(payloadRaw);
  if (parsed.missingRequired.length > 0) {
    return res.status(400).json({ success: false, error: `필수 항목을 입력해 주세요: ${parsed.missingRequired.join(' / ')}` });
  }

  const files = (req.files as Express.Multer.File[]) || [];
  const images = validateAndSaveImages(companyId, files);  // 위장 파일 = 400 throw(저장 전)

  // INSERT 실패(컬럼 미반영 포함) 시 저장 이미지 정리 — 고아 파일 차단
  let ins;
  try {
    ins = await query(
      `INSERT INTO campaign_agency_requests
         (company_id, created_by, title, memo, parsed_json, image_paths)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::jsonb)
       RETURNING id`,
      [companyId, userId || null, parsed.title.slice(0, 200), parsed.note || null,
       JSON.stringify(parsed), JSON.stringify(images)],
    );
  } catch (insErr) {
    unlinkImages(images);
    throw insErr;
  }

  // 운영자 통지 (실패해도 접수 성공 — fire-and-forget)
  sendSystemAlert({
    dedupKey: `agency-request:${ins.rows[0].id}`,
    message: `[캠페인 대행] 새 요청 접수 — 행사명: ${parsed.title}. 슈퍼관리자 > 캠페인 대행 설계에서 확인해 주세요.`,
  }).catch((e: any) => console.log('[캠페인대행] 접수 통지 생략:', e?.message || e));

  return res.json({ success: true, id: ins.rows[0].id });
}));

/** 내 접수 이력 (상태 읽기 전용 + 상세 모달용 parsed·이미지 목록) */
router.get('/requests', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId || !(await checkEligibility(companyId, req.user))) {
      return res.status(403).json({ success: false, error: '본 기능은 비즈니스·엔터프라이즈 요금제 전용입니다.', code: 'BETA_GATE' });
    }
    const r = await query(
      `SELECT id, title, memo, status, parsed_json, image_paths, created_at, designed_at,
              proposal_pdf_path IS NOT NULL AS has_pdf
         FROM campaign_agency_requests
        WHERE company_id = $1::uuid
        ORDER BY created_at DESC LIMIT 100`,
      [companyId],
    );
    return res.json({
      success: true,
      requests: r.rows.map((row: any) => ({
        id: row.id, title: row.title, memo: row.memo, status: row.status,
        parsed_json: row.parsed_json, images: toClientImages(row.image_paths),
        created_at: row.created_at, designed_at: row.designed_at,
        // ★ 2026-08-20 고객 다운로드 가능 여부 — 다운로드 endpoint와 같은 CT 판정(전달 이후 + PDF 실존).
        //   설계 중 내부 산출물은 has_proposal도 false — 버튼 자체가 안 그려진다.
        has_proposal: canCustomerDownloadProposal(String(row.status || ''), !!row.has_pdf),
      })),
    });
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 이력] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

/** 내 제안서 다운로드 — 본 회사 행 + 전달된 상태(delivered/done) + PDF 실존일 때만(CT 단일 판정).
 *  ★ 2026-08-20 신설 — 그전에는 제안서가 슈퍼관리자 전용이라 고객 전달이 시스템 밖(오프라인)이었다. */
router.get('/requests/:id/proposal', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId || !(await checkEligibility(companyId, req.user))) {
      return res.status(403).json({ success: false, error: '본 기능은 비즈니스·엔터프라이즈 요금제 전용입니다.', code: 'BETA_GATE' });
    }
    const r = await query(
      `SELECT status, proposal_pdf_path, title FROM campaign_agency_requests
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId],
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ success: false, error: '요청을 찾을 수 없습니다.' });
    const hasPdf = !!row.proposal_pdf_path && fs.existsSync(row.proposal_pdf_path);
    if (!canCustomerDownloadProposal(String(row.status || ''), hasPdf)) {
      // 거절도 로그를 남긴다 — "눌러도 안 된다" 접수가 오면 화면 문구로 추측하지 않게(LESSONS_BACKEND).
      console.log(`[캠페인대행 고객 제안서] 거절 — request=${req.params.id} status=${row.status} hasPdf=${hasPdf}`);
      return res.status(404).json({ success: false, error: '전달된 제안서가 없습니다. 제안서가 전달되면 이 자리에서 받을 수 있습니다.' });
    }
    return res.download(row.proposal_pdf_path, `한줄로_마케팅제안서_${String(row.title || '').slice(0, 40) || 'proposal'}.pdf`);
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 고객 제안서] 오류:', err?.message || err);
    return res.status(500).json({ success: false, error: '다운로드 실패' });
  }
});

/** 내 접수 이미지 보기 — 본 회사 행만 (상세 모달 갤러리) */
router.get('/requests/:id/images/:idx', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId || !(await checkEligibility(companyId, req.user))) {
      return res.status(403).json({ success: false, error: '본 기능은 비즈니스·엔터프라이즈 요금제 전용입니다.', code: 'BETA_GATE' });
    }
    const r = await query(
      `SELECT image_paths FROM campaign_agency_requests WHERE id = $1::uuid AND company_id = $2::uuid`,
      [req.params.id, companyId],
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: '요청을 찾을 수 없습니다.' });
    return streamAgencyImage(res, r.rows[0].image_paths, req.params.idx);
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    return res.status(500).json({ success: false, error: '이미지 조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════
// 슈퍼관리자 — 캠페인 대행 설계
// ════════════════════════════════════════════════════════════

/** 상위 등급 업체 목록 (★ 리스트 자체가 자격 업체만 — Harold 불변식. 구독 만료/정지 제외)
 *  ★ 2026-08-20 판정을 접수 게이트(isCompanyEligible)와 같은 축으로 — plans.advanced_access_enabled.
 *  그전에는 plan_code IN ('BUSINESS','ENTERPRISE') 하드코딩이라, 플래그를 켠 임직원 요금제(STAFF 활성
 *  4개사 실측)가 접수 API는 통과하는데 이 목록에만 안 떴다. 요금제 코드 비교 금지(plan-guard 0728 원칙). */
router.get('/admin/companies', requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT c.id, c.company_name, UPPER(p.plan_code) AS plan_code
         FROM companies c
         JOIN plans p ON c.plan_id = p.id
        WHERE p.advanced_access_enabled = true
          AND COALESCE(c.subscription_status, '') NOT IN ('expired', 'suspended')
        ORDER BY c.company_name ASC`,
    );
    return res.json({ success: true, companies: r.rows });
  } catch (err: any) {
    console.error('[캠페인대행 admin companies] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

/** 요청 목록 — 전 업체 (상태 필터) */
router.get('/admin/requests', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status || '').trim();
    const params: any[] = [];
    let where = '';
    if (status && STATUS_WHITELIST.includes(status)) { params.push(status); where = `WHERE r.status = $1`; }
    const r = await query(
      `SELECT r.id, r.company_id, c.company_name, r.title, r.memo, r.status, r.staff_note,
              r.request_file_name, r.parsed_json, r.image_paths, r.proposal_pdf_path IS NOT NULL AS has_proposal,
              r.designed_at, r.created_at
         FROM campaign_agency_requests r
         JOIN companies c ON c.id = r.company_id
         ${where}
        ORDER BY r.created_at DESC LIMIT 200`,
      params,
    );
    return res.json({
      success: true,
      requests: r.rows.map((row: any) => {
        const { image_paths, ...rest } = row;
        return { ...rest, images: toClientImages(image_paths) };
      }),
    });
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    console.error('[캠페인대행 접수함] 오류:', err);
    return res.status(500).json({ success: false, error: '조회 실패' });
  }
});

/** 요청 이미지 보기 — 상세 모달 갤러리·라이트박스 */
router.get('/admin/requests/:id/images/:idx', requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const r = await query(`SELECT image_paths FROM campaign_agency_requests WHERE id = $1::uuid`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, error: '요청을 찾을 수 없습니다.' });
    return streamAgencyImage(res, r.rows[0].image_paths, req.params.idx);
  } catch (err: any) {
    if (missingRelationResponse(res, err)) return;
    return res.status(500).json({ success: false, error: '이미지 조회 실패' });
  }
});

/** 요청서 원본 다운로드 — legacy xlsx 접수 행 전용(웹 폼 접수 행은 파일 없음 = null 가드) */
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

/** 상태·직원 메모·보정 저장 */
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
      params.push(JSON.stringify(buildParsedFromForm(parsed))); sets.push(`parsed_json = $${params.length}::jsonb`);
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

/** 저장된 행사 이미지 → vision 입력(base64). 개별 파일 실패는 건너뛴다(분석은 계속). */
function loadImageInputs(imagePaths: any): { inputs: EventImageInput[]; embeddablePaths: string[] } {
  const inputs: EventImageInput[] = [];
  const embeddablePaths: string[] = [];
  for (const im of (Array.isArray(imagePaths) ? imagePaths : [])) {
    try {
      if (!im?.path || !fs.existsSync(im.path)) continue;
      const buf = fs.readFileSync(im.path);
      // 저장 mime 폴백 금지 — 디스크에서 바뀐/깨진 파일이 vision·PDF로 새는 것 차단(Codex 2차 리뷰 정정)
      const mediaType = sniffImageMediaType(buf);
      if (!mediaType || !ALLOWED_IMAGE_MEDIA_TYPES.has(mediaType)) continue;
      inputs.push({ media_type: mediaType, data: buf.toString('base64') });
      embeddablePaths.push(im.path);
    } catch { /* 개별 이미지 실패 — 분석은 계속 */ }
  }
  return { inputs, embeddablePaths };
}

/** 공유 설계 실행 코어 — 요청 행 기준 분석→PDF 저장→효과 검증(6원칙 ②) 후 기록. design·design-adhoc 공유. */
async function executeDesignForRequest(requestId: string): Promise<
  { ok: true; summary: any } | { ok: false; status: number; error: string }
> {
  const r = await query(
    `SELECT id, company_id, title, parsed_json, image_paths, status FROM campaign_agency_requests WHERE id = $1::uuid`,
    [requestId],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, status: 404, error: '요청을 찾을 수 없습니다.' };
  const parsed: AgencyRequestParsed | null = row.parsed_json || null;
  if (!parsed) return { ok: false, status: 400, error: '요청 내용이 없습니다. 내용을 입력(보정)한 후 실행해 주세요.' };
  if (Array.isArray(parsed.missingRequired) && parsed.missingRequired.length > 0) {
    return { ok: false, status: 400, error: `필수 항목 누락: ${parsed.missingRequired.join(' / ')} — 보정 후 실행해 주세요.` };
  }
  // 실행 시점 자격 재검증 — 다운그레이드·만료된 업체의 과거 접수 건 실행 차단
  if (!(await isCompanyEligible(row.company_id))) {
    return { ok: false, status: 400, error: '현재 비즈니스·엔터프라이즈 활성 구독 업체가 아닙니다. 요금제·구독 상태 확인 후 진행해 주세요.' };
  }

  // ★ 업체 단일 스코프 — 요청 행의 company_id 하나만 엔진에 전달. 행사 이미지 = vision 전사 축(무과금 번들 안).
  const { inputs: imageInputs, embeddablePaths } = loadImageInputs(row.image_paths);
  const result = await generateAgencyProposal(row.company_id, parsed, imageInputs);

  // PDF 생성 → 파일 저장 (스트림 완료 대기). bufferPages = 페이지 번호 푸터용.
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
  const pdfDir = path.join(PROPOSAL_BASE, row.company_id);
  fs.mkdirSync(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, `${row.id}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(pdfPath);
    out.on('finish', () => resolve());
    out.on('error', reject);
    doc.pipe(out);
    renderAgencyProposalPdf(doc, { result, request: parsed, imagePaths: embeddablePaths });
    doc.end();
  });
  // 효과 검증 — 파일이 실제로 생성됐는지 확인 후에만 성공 기록
  if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
    return { ok: false, status: 500, error: '제안서 PDF 생성이 완료되지 않았습니다. 다시 실행해 주세요.' };
  }
  // ★ 2026-08-20 분석 성공 = 상태 전이(후퇴 금지 — CT가 판정). received·on_hold → designing,
  //   delivered·done은 유지(재실행 = PDF 덮어쓰기만). 그전에는 designed_at만 적혀 직원이 매번 손으로 바꿨다.
  await query(
    `UPDATE campaign_agency_requests
        SET proposal_pdf_path = $2, status = $3, designed_at = NOW(), updated_at = NOW()
      WHERE id = $1::uuid`,
    [row.id, pdfPath, nextStatusAfterDesign(String(row.status || ''))],
  );
  return {
    ok: true,
    summary: {
      requestId: row.id,
      plans: result.plans.map((p) => ({ title: p.title, channel: p.channel, targetCount: p.targetCount, estimatedCost: p.estimatedCost })),
      dataNotes: result.dataNotes,
      imageTranscript: result.imageTranscript || null,
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

/** 직접 설계용 이미지 → 폼 자동 입력 (저장 없음 · 무과금) — 업체 선택 후 사용 */
router.post('/admin/design-adhoc/analyze-images', requireSuperAdmin, withImageUpload(async (req: any, res: Response) => {
  const companyId = String(req.body?.companyId || '').trim();
  if (!companyId) return res.status(400).json({ success: false, error: '업체를 먼저 선택해 주세요.' });
  if (!(await isCompanyEligible(companyId))) {
    return res.status(400).json({ success: false, error: '비즈니스·엔터프라이즈 활성 구독 업체만 가능합니다.' });
  }
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) return res.status(400).json({ success: false, error: '이미지를 1장 이상 올려주세요.' });
  const parsed = await analyzeAgencyIntakeImages(companyId, toVisionInputs(files));
  return res.json({ success: true, form: parsed });
}));

/** 직행 — 업체 선택 + 웹 폼(+이미지) → 접수 행 생성 + 즉시 분석 (Harold 흐름: 1단계) */
router.post('/admin/design-adhoc', requireSuperAdmin, withImageUpload(async (req: any, res: Response) => {
  const companyId = String(req.body?.companyId || '').trim();
  if (!companyId) return res.status(400).json({ success: false, error: '업체를 선택해 주세요.' });
  // 서버 재검증 — 활성 비즈니스+ 만 (프론트 목록 우회 차단, 구독 만료/정지 포함 검사)
  if (!(await isCompanyEligible(companyId))) {
    return res.status(400).json({ success: false, error: '비즈니스·엔터프라이즈 활성 구독 업체만 가능합니다.' });
  }
  let payloadRaw: any;
  try { payloadRaw = JSON.parse(String(req.body?.payload || '{}')); } catch {
    return res.status(400).json({ success: false, error: '요청 내용 형식이 올바르지 않습니다.' });
  }
  const parsed = buildParsedFromForm(payloadRaw);
  if (parsed.missingRequired.length > 0) {
    return res.status(400).json({ success: false, error: `필수 항목을 입력해 주세요: ${parsed.missingRequired.join(' / ')}` });
  }

  const files = (req.files as Express.Multer.File[]) || [];
  const images = validateAndSaveImages(companyId, files);

  // INSERT 실패 시 저장 이미지 정리 — 고아 파일 차단(접수 endpoint와 동일)
  let ins;
  try {
    ins = await query(
      `INSERT INTO campaign_agency_requests
         (company_id, title, memo, parsed_json, image_paths, status)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5::jsonb, 'designing')
       RETURNING id`,
      [companyId, parsed.title.slice(0, 200), '슈퍼관리자 직접 등록', JSON.stringify(parsed), JSON.stringify(images)],
    );
  } catch (insErr) {
    unlinkImages(images);
    throw insErr;
  }
  const out = await executeDesignForRequest(ins.rows[0].id);
  if (!out.ok) return res.status(out.status).json({ success: false, error: out.error, requestId: ins.rows[0].id });
  return res.json({ success: true, summary: out.summary });
}));

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
