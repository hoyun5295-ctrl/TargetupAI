/**
 * ★ D112: 전단AI 슈퍼관리자 통합 라우트
 * 마운트: /api/admin/flyer
 *
 * 전단AI 모드에서의 회사/사용자/캠페인/결제/POS Agent 관리.
 * flyer_* 테이블만 조회. 한줄로 companies/users 무접촉.
 */

import { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../../config/database';
import { authenticate, requireSuperAdmin } from '../../middlewares/auth';
import { requireService } from '../../middlewares/super-service-guard';

const router = Router();

router.use(authenticate);
router.use(requireSuperAdmin);
router.use(requireService('flyer'));

// ══════════════════════════════════════════
// 대시보드 통계
// ══════════════════════════════════════════
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const [companies, users, campaigns, customers] = await Promise.all([
      query(`SELECT COUNT(*)::int AS cnt FROM flyer_companies WHERE deleted_at IS NULL`),
      query(`SELECT COUNT(*)::int AS cnt FROM flyer_users WHERE deleted_at IS NULL`),
      query(`SELECT
               COUNT(*)::int AS total,
               COALESCE(SUM(sent_count), 0)::int AS total_sent,
               COALESCE(SUM(success_count), 0)::int AS total_success
             FROM flyer_campaigns WHERE status IN ('completed','sending')`),
      query(`SELECT COUNT(*)::int AS cnt FROM flyer_customers WHERE deleted_at IS NULL`),
    ]);

    return res.json({
      activeCompanies: companies.rows[0]?.cnt || 0,
      totalUsers: users.rows[0]?.cnt || 0,
      totalCampaigns: campaigns.rows[0]?.total || 0,
      totalSent: campaigns.rows[0]?.total_sent || 0,
      totalSuccess: campaigns.rows[0]?.total_success || 0,
      totalCustomers: customers.rows[0]?.cnt || 0,
    });
  } catch (error: any) {
    console.error('[admin/flyer] dashboard error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// 회사 관리 (flyer_companies)
// ══════════════════════════════════════════
router.get('/companies', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string || '';
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = 20;
    const offset = (page - 1) * limit;

    let where = `deleted_at IS NULL`;
    const params: any[] = [];
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (company_name ILIKE $${params.length} OR owner_name ILIKE $${params.length})`;
    }

    const countRes = await query(`SELECT COUNT(*)::int AS cnt FROM flyer_companies WHERE ${where}`, params);
    params.push(limit, offset);
    const listRes = await query(
      `SELECT id, company_name, business_type, owner_name, owner_phone,
              plan_type, monthly_fee, payment_status, pos_type, pos_last_sync_at,
              created_at
       FROM flyer_companies WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({ items: listRes.rows, total: countRes.rows[0]?.cnt || 0, page, pageSize: limit });
  } catch (error: any) {
    console.error('[admin/flyer] companies list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/companies', async (req: Request, res: Response) => {
  try {
    const {
      company_name, business_type, business_number, owner_name, owner_phone,
      address, store_hours, pos_type,
      admin_login_id, admin_password, admin_name, admin_email,
    } = req.body;

    if (!company_name || !admin_login_id || !admin_password) {
      return res.status(400).json({ error: '회사명, 관리자 아이디, 비밀번호는 필수입니다' });
    }

    // 1. 회사 생성
    const companyRes = await query(
      `INSERT INTO flyer_companies
         (id, company_name, business_type, business_number, owner_name, owner_phone,
          address, store_hours, pos_type, plan_type, monthly_fee, payment_status,
          plan_started_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8,
               'flyer_basic', 150000, 'active', CURRENT_DATE, NOW())
       RETURNING id`,
      [company_name, business_type || 'mart', business_number || null,
       owner_name || null, owner_phone || null, address || null,
       store_hours || null, pos_type || null]
    );
    const companyId = companyRes.rows[0].id;

    // 2. 관리자 사용자 생성 (login_id 기반)
    const hash = await bcrypt.hash(admin_password, 10);
    await query(
      `INSERT INTO flyer_users (id, company_id, login_id, email, password_hash, name, role, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'flyer_admin', NOW())`,
      [companyId, admin_login_id, admin_email || null, hash, admin_name || owner_name || '관리자']
    );

    return res.status(201).json({ id: companyId, company_name });
  } catch (error: any) {
    console.error('[admin/flyer] company create error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 이메일입니다' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/companies/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await query(`SELECT * FROM flyer_companies WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const users = await query(
      `SELECT id, email, name, role, last_login_at, created_at
       FROM flyer_users WHERE company_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
      [id]
    );

    const customers = await query(
      `SELECT COUNT(*)::int AS cnt FROM flyer_customers WHERE company_id = $1 AND deleted_at IS NULL`,
      [id]
    );

    return res.json({
      ...result.rows[0],
      users: users.rows,
      customerCount: customers.rows[0]?.cnt || 0,
    });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/companies/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const fields = req.body;
    const allowed = [
      'company_name', 'business_type', 'business_number', 'owner_name', 'owner_phone',
      'address', 'store_hours', 'pos_type', 'monthly_fee', 'payment_status',
      'opt_out_080_number', 'sms_unit_price', 'lms_unit_price', 'mms_unit_price',
    ];

    const sets: string[] = [];
    const params: any[] = [id];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        params.push(fields[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    sets.push(`updated_at = NOW()`);
    await query(`UPDATE flyer_companies SET ${sets.join(', ')} WHERE id = $1`, params);
    return res.json({ message: '수정되었습니다' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/companies/:id', async (req: Request, res: Response) => {
  try {
    await query(`UPDATE flyer_companies SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    return res.json({ message: '삭제되었습니다' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// 사용자 관리 (flyer_users)
// ══════════════════════════════════════════
router.get('/users', async (req: Request, res: Response) => {
  try {
    const companyId = req.query.companyId as string;
    const where = companyId
      ? `u.company_id = $1 AND u.deleted_at IS NULL`
      : `u.deleted_at IS NULL`;
    const params = companyId ? [companyId] : [];

    const result = await query(
      `SELECT u.id, u.email, u.name, u.role, u.last_login_at, u.created_at,
              c.company_name
       FROM flyer_users u
       JOIN flyer_companies c ON c.id = u.company_id
       WHERE ${where}
       ORDER BY u.created_at DESC
       LIMIT 100`,
      params
    );
    return res.json(result.rows);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users', async (req: Request, res: Response) => {
  try {
    const { company_id, login_id, email, password, name, role } = req.body;
    if (!company_id || !login_id || !password) {
      return res.status(400).json({ error: '회사, 아이디, 비밀번호 필수' });
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO flyer_users (id, company_id, login_id, email, password_hash, name, role, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, login_id, name, role`,
      [company_id, login_id, email || null, hash, name || null, role || 'flyer_staff']
    );
    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    if (error.code === '23505') return res.status(400).json({ error: '이미 존재하는 아이디' });
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users/:id/reset-password', async (req: Request, res: Response) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await query(`UPDATE flyer_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, req.params.id]);
    return res.json({ message: '비밀번호가 초기화되었습니다' });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// POS Agent 모니터링 (flyer_pos_agents)
// ══════════════════════════════════════════
router.get('/pos-agents', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT pa.*, c.company_name
       FROM flyer_pos_agents pa
       JOIN flyer_companies c ON c.id = pa.company_id
       ORDER BY pa.last_heartbeat DESC NULLS LAST`
    );
    return res.json(result.rows);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/pos-agents/generate-key', async (req: Request, res: Response) => {
  try {
    const { company_id, pos_type } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id 필수' });

    const crypto = await import('crypto');
    const agentKey = `FPA-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const result = await query(
      `INSERT INTO flyer_pos_agents (id, company_id, agent_key, pos_type, sync_status, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'disconnected', NOW())
       RETURNING id, agent_key`,
      [company_id, agentKey, pos_type || null]
    );

    // flyer_companies에도 agent_key/pos_type 업데이트
    await query(
      `UPDATE flyer_companies SET pos_agent_key = $1, pos_type = COALESCE($2, pos_type) WHERE id = $3`,
      [agentKey, pos_type, company_id]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════
// 결제/과금 (flyer_billing_history)
// ══════════════════════════════════════════
router.get('/billing', async (req: Request, res: Response) => {
  try {
    const companyId = req.query.companyId as string;
    const where = companyId ? `bh.company_id = $1` : `1=1`;
    const params = companyId ? [companyId] : [];

    const result = await query(
      `SELECT bh.*, c.company_name
       FROM flyer_billing_history bh
       JOIN flyer_companies c ON c.id = bh.company_id
       WHERE ${where}
       ORDER BY bh.billing_month DESC
       LIMIT 100`,
      params
    );
    return res.json(result.rows);
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
