/**
 * ★ 전단AI 고객 관리 라우트
 * 마운트: /api/flyer/customers
 *
 * flyer_customers 테이블만 조회/수정. 한줄로 customers 테이블 무접촉.
 * 엑셀 업로드 + POS Agent 자동 싱크(D113~) 대응.
 */

import { Request, Response, Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { query } from '../../config/database';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
import {
  buildFlyerCustomerFilter,
  countFlyerCustomers,
  selectFlyerCustomers,
  FlyerFilterInput,
} from '../../utils/flyer/flyer-customer-filter';
import { normalizePhone } from '../../utils/normalize-phone';

const router = Router();

router.use(flyerAuthenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

/**
 * GET / — 고객 목록 (페이지네이션 + 필터)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(500, Math.max(1, parseInt(String(req.query.pageSize || '50'), 10)));
    const search = req.query.search as string | undefined;

    const filter: FlyerFilterInput = { search };
    const total = await countFlyerCustomers(companyId, filter);
    const items = await selectFlyerCustomers(companyId, filter, { limit: pageSize, offset: (page - 1) * pageSize });

    return res.json({ items, total, page, pageSize });
  } catch (error: any) {
    console.error('[flyer/customers] list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /count — 필터 결과 수만 조회 (발송 대상 미리보기)
 */
router.get('/count', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const filter: FlyerFilterInput = parseFilterFromQuery(req.query);
    const total = await countFlyerCustomers(companyId, filter);
    return res.json({ total });
  } catch (error: any) {
    console.error('[flyer/customers] count error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST / — 고객 단건 추가
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const { name, phone, gender, birth_date, email, address, sms_opt_in } = req.body;

    if (!phone) return res.status(400).json({ error: '전화번호는 필수입니다' });
    const normalized = normalizePhone(phone);
    if (!normalized) return res.status(400).json({ error: '유효하지 않은 전화번호입니다' });

    const result = await query(
      `INSERT INTO flyer_customers
         (id, company_id, name, phone, gender, birth_date, email, address, sms_opt_in, source, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'manual', NOW())
       ON CONFLICT (company_id, phone) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, flyer_customers.name),
         gender = COALESCE(EXCLUDED.gender, flyer_customers.gender),
         birth_date = COALESCE(EXCLUDED.birth_date, flyer_customers.birth_date),
         email = COALESCE(EXCLUDED.email, flyer_customers.email),
         address = COALESCE(EXCLUDED.address, flyer_customers.address),
         updated_at = NOW()
       RETURNING id`,
      [companyId, name || null, normalized, gender || null, birth_date || null, email || null, address || null, sms_opt_in !== false]
    );
    return res.status(201).json({ id: result.rows[0].id });
  } catch (error: any) {
    console.error('[flyer/customers] create error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /upload-parse — 엑셀 파싱 미리보기 (저장 안 함, 데이터만 반환)
 */
router.post('/upload-parse', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return res.json({
      headers,
      totalRows: rows.length,
      data: req.query.includeData === 'true' ? rows.slice(0, 500) : [],
      preview: rows.slice(0, 5),
    });
  } catch (error: any) {
    console.error('[flyer/customers] upload-parse error:', error);
    return res.status(500).json({ error: 'Server error', detail: error?.message });
  }
});

/**
 * POST /upload — 엑셀 업로드 (간단 매핑)
 * 기대 헤더: 이름, 전화번호, 성별, 생일, 이메일, 주소 (없어도 동작)
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다' });
    const companyId = req.flyerUser!.companyId;

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const phoneRaw = row['전화번호'] || row['연락처'] || row['phone'] || row['Phone'];
      if (!phoneRaw) { skipped++; continue; }
      const phone = normalizePhone(String(phoneRaw));
      if (!phone) { skipped++; continue; }

      const name = row['이름'] || row['성명'] || row['name'] || null;
      const gender = normalizeGender(row['성별'] || row['gender']);
      const birthDate = parseDateValue(row['생일'] || row['생년월일'] || row['birth_date']);
      const email = row['이메일'] || row['email'] || null;
      const address = row['주소'] || row['address'] || null;

      try {
        await query(
          `INSERT INTO flyer_customers
             (id, company_id, name, phone, gender, birth_date, email, address, source, created_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'excel', NOW())
           ON CONFLICT (company_id, phone) DO UPDATE SET
             name = COALESCE(EXCLUDED.name, flyer_customers.name),
             gender = COALESCE(EXCLUDED.gender, flyer_customers.gender),
             birth_date = COALESCE(EXCLUDED.birth_date, flyer_customers.birth_date),
             email = COALESCE(EXCLUDED.email, flyer_customers.email),
             address = COALESCE(EXCLUDED.address, flyer_customers.address),
             updated_at = NOW()`,
          [companyId, name, phone, gender, birthDate, email, address]
        );
        inserted++;
      } catch (e: any) {
        errors.push(`${phone}: ${e.message}`);
      }
    }

    return res.json({ inserted, skipped, errors: errors.slice(0, 10), totalRows: rows.length });
  } catch (error: any) {
    console.error('[flyer/customers] upload error:', error);
    return res.status(500).json({ error: 'Server error', detail: error?.message });
  }
});

/**
 * DELETE /:id — 고객 삭제 (soft)
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const { id } = req.params;
    await query(
      `UPDATE flyer_customers SET deleted_at = NOW() WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    return res.json({ message: '삭제되었습니다' });
  } catch (error: any) {
    console.error('[flyer/customers] delete error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /preview-filter — 필터로 수신자 목록 미리보기 (발송 전)
 */
router.post('/preview-filter', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser!.companyId;
    const filter: FlyerFilterInput = req.body.filter || {};
    const limit = Math.min(100, req.body.limit || 10);
    const total = await countFlyerCustomers(companyId, filter);
    const sample = await selectFlyerCustomers(companyId, filter, { limit });
    return res.json({ total, sample });
  } catch (error: any) {
    console.error('[flyer/customers] preview-filter error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ────────────────── helpers ──────────────────

function parseFilterFromQuery(q: any): FlyerFilterInput {
  const f: FlyerFilterInput = {};
  if (q.gender === 'M' || q.gender === 'F') f.gender = q.gender;
  if (q.age_min) f.age_min = Number(q.age_min);
  if (q.age_max) f.age_max = Number(q.age_max);
  if (q.rfm_segment) f.rfm_segment = String(q.rfm_segment).split(',');
  if (q.pos_grade) f.pos_grade = String(q.pos_grade).split(',');
  if (q.sms_opt_in === 'true') f.sms_opt_in = true;
  if (q.sms_opt_in === 'false') f.sms_opt_in = false;
  if (q.search) f.search = String(q.search);
  return f;
}

function normalizeGender(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (s === '남' || s === '남자' || s === 'M' || s === 'm' || s === 'male') return 'M';
  if (s === '여' || s === '여자' || s === 'F' || s === 'f' || s === 'female') return 'F';
  return null;
}

function parseDateValue(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const match = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return null;
}

export default router;
