/**
 * ★ 전단AI: 전단지 CRUD API
 *
 * 마운트: /api/flyer/flyers
 * 권한: company_admin + company_user (authenticate 미들웨어)
 * 기존 컨트롤타워 재활용: store-scope.ts (브랜드 격리)
 */

import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import { query } from '../../config/database';
import { authenticate } from '../../middlewares/auth';
import { getStoreScope } from '../../utils/store-scope';

const router = Router();

router.use(authenticate);

// ── 단축URL 코드 생성 (nanoid 대신 crypto) ──
function generateShortCode(length = 7): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// ── company_id 필수 체크 ──
function requireCompanyId(req: Request, res: Response): string | null {
  const companyId = req.user?.companyId;
  if (!companyId) {
    res.status(403).json({ error: '회사 정보가 없습니다.' });
    return null;
  }
  return companyId;
}

// ── 브랜드 격리 헬퍼 ──
async function applyStoreScope(companyId: string, userId: string, userType: string) {
  if (userType === 'super_admin' || userType === 'admin') return { blocked: false, storeFilter: '', storeParams: [] as string[] };

  const scope = await getStoreScope(companyId, userId);
  if (scope.type === 'blocked') return { blocked: true, storeFilter: '', storeParams: [] };
  if (scope.type === 'filtered' && scope.storeCodes.length > 0) {
    const placeholders = scope.storeCodes.map((_, i) => `$${i + 1}`).join(',');
    return { blocked: false, storeFilter: `AND store_code IN (${placeholders})`, storeParams: scope.storeCodes };
  }
  return { blocked: false, storeFilter: '', storeParams: [] };
}

// ============================================================
// POST / — 전단지 생성
// ============================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { userId } = req.user!;
    const { title, store_name, period_start, period_end, categories, template, logo_url, store_code } = req.body;

    if (!title) {
      return res.status(400).json({ error: '행사명(title)은 필수입니다.' });
    }

    const result = await query(
      `INSERT INTO flyers (company_id, user_id, store_code, title, store_name, period_start, period_end, categories, template, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [companyId, userId, store_code || null, title, store_name || null, period_start || null, period_end || null,
       JSON.stringify(categories || []), template || 'grid', logo_url || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[전단AI] 전단지 생성 실패:', err.message);
    res.status(500).json({ error: '전단지 생성에 실패했습니다.' });
  }
});

// ============================================================
// GET / — 전단지 목록 조회
// ============================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { userId, userType } = req.user!;

    const scope = await applyStoreScope(companyId, userId, userType);
    if (scope.blocked) return res.status(403).json({ error: '접근 권한이 없습니다.' });

    const params: any[] = [companyId, ...scope.storeParams];
    const result = await query(
      `SELECT f.*, s.code as short_code,
              (SELECT COUNT(*) FROM url_clicks uc JOIN short_urls su ON su.id = uc.short_url_id WHERE su.flyer_id = f.id) as click_count
       FROM flyers f
       LEFT JOIN short_urls s ON s.flyer_id = f.id
       WHERE f.company_id = $1 ${scope.storeFilter.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + 1}`)}
       ORDER BY f.created_at DESC`,
      params
    );

    res.json(result.rows);
  } catch (err: any) {
    console.error('[전단AI] 전단지 목록 조회 실패:', err.message);
    res.status(500).json({ error: '전단지 목록 조회에 실패했습니다.' });
  }
});

// ============================================================
// GET /:id — 전단지 상세 조회
// ============================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    const result = await query(
      `SELECT f.*, s.code as short_code,
              (SELECT COUNT(*) FROM url_clicks uc JOIN short_urls su ON su.id = uc.short_url_id WHERE su.flyer_id = f.id) as click_count
       FROM flyers f
       LEFT JOIN short_urls s ON s.flyer_id = f.id
       WHERE f.id = $1 AND f.company_id = $2`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[전단AI] 전단지 상세 조회 실패:', err.message);
    res.status(500).json({ error: '전단지 상세 조회에 실패했습니다.' });
  }
});

// ============================================================
// PUT /:id — 전단지 수정
// ============================================================
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;
    const { title, store_name, period_start, period_end, categories, template, logo_url } = req.body;

    const existing = await query('SELECT id, status FROM flyers WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    const result = await query(
      `UPDATE flyers SET
        title = COALESCE($3, title),
        store_name = COALESCE($4, store_name),
        period_start = COALESCE($5, period_start),
        period_end = COALESCE($6, period_end),
        categories = COALESCE($7, categories),
        template = COALESCE($8, template),
        logo_url = COALESCE($9, logo_url),
        updated_at = now()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [id, companyId, title || null, store_name || null, period_start || null, period_end || null,
       categories ? JSON.stringify(categories) : null, template || null, logo_url || null]
    );

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[전단AI] 전단지 수정 실패:', err.message);
    res.status(500).json({ error: '전단지 수정에 실패했습니다.' });
  }
});

// ============================================================
// DELETE /:id — 전단지 삭제
// ============================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    // 연관 데이터 삭제 (클릭 로그 → 단축URL → 전단지)
    await query(
      `DELETE FROM url_clicks WHERE short_url_id IN (SELECT id FROM short_urls WHERE flyer_id = $1 AND company_id = $2)`,
      [id, companyId]
    );
    await query('DELETE FROM short_urls WHERE flyer_id = $1 AND company_id = $2', [id, companyId]);
    const result = await query('DELETE FROM flyers WHERE id = $1 AND company_id = $2 RETURNING id', [id, companyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[전단AI] 전단지 삭제 실패:', err.message);
    res.status(500).json({ error: '전단지 삭제에 실패했습니다.' });
  }
});

// ============================================================
// POST /:id/publish — 전단지 발행 (단축URL 발급)
// ============================================================
router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    const flyer = await query('SELECT id, status FROM flyers WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (flyer.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    // 이미 단축URL이 있으면 반환
    const existingUrl = await query('SELECT code FROM short_urls WHERE flyer_id = $1', [id]);
    if (existingUrl.rows.length > 0) {
      await query("UPDATE flyers SET status = 'published', updated_at = now() WHERE id = $1", [id]);
      return res.json({
        short_code: existingUrl.rows[0].code,
        short_url: `https://hanjul-flyer.kr/${existingUrl.rows[0].code}`
      });
    }

    // 단축URL 코드 생성 (충돌 시 재시도)
    let code: string;
    let attempts = 0;
    do {
      code = generateShortCode();
      const dup = await query('SELECT id FROM short_urls WHERE code = $1', [code]);
      if (dup.rows.length === 0) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return res.status(500).json({ error: '단축URL 생성에 실패했습니다. 다시 시도해주세요.' });
    }

    // 90일 만료
    await query(
      `INSERT INTO short_urls (code, flyer_id, company_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '90 days')`,
      [code, id, companyId]
    );

    await query("UPDATE flyers SET status = 'published', updated_at = now() WHERE id = $1", [id]);

    res.json({
      short_code: code,
      short_url: `https://hanjul-flyer.kr/${code}`
    });
  } catch (err: any) {
    console.error('[전단AI] 전단지 발행 실패:', err.message);
    res.status(500).json({ error: '전단지 발행에 실패했습니다.' });
  }
});

// ============================================================
// GET /:id/stats — 클릭 통계
// ============================================================
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    // 전단지 존재 확인
    const flyer = await query('SELECT id FROM flyers WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (flyer.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    // 총 클릭수
    const total = await query(
      `SELECT COUNT(*) as total_clicks
       FROM url_clicks uc
       JOIN short_urls su ON su.id = uc.short_url_id
       WHERE su.flyer_id = $1`,
      [id]
    );

    // 일별 클릭수 (최근 30일)
    const daily = await query(
      `SELECT DATE(uc.clicked_at AT TIME ZONE 'Asia/Seoul') as date, COUNT(*) as clicks
       FROM url_clicks uc
       JOIN short_urls su ON su.id = uc.short_url_id
       WHERE su.flyer_id = $1 AND uc.clicked_at >= now() - interval '30 days'
       GROUP BY date ORDER BY date DESC`,
      [id]
    );

    res.json({
      total_clicks: parseInt(total.rows[0].total_clicks),
      daily_clicks: daily.rows
    });
  } catch (err: any) {
    console.error('[전단AI] 클릭 통계 조회 실패:', err.message);
    res.status(500).json({ error: '클릭 통계 조회에 실패했습니다.' });
  }
});

export default router;
