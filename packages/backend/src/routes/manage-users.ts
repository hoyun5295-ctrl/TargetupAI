import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireCompanyAdmin } from '../middlewares/auth';
import pool, { mysqlQuery } from '../config/database';

const router = Router();

// ============================================================
//  사용자 관리 API — 공용 (슈퍼관리자 + 고객사관리자)
//  마운트: /api/manage/users
//  슈퍼관리자: 전체 회사 사용자 관리
//  고객사관리자: 자사 사용자만 관리
// ============================================================

router.use(authenticate, requireCompanyAdmin);

function getCompanyScope(req: Request): string | null {
  const { userType, companyId } = (req as any).user!;
  if (userType === 'super_admin') return (req.query.companyId as string) || null;
  return companyId!;
}

// GET / - 사용자 목록 조회 (+ storeCodeList 포함)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyScope = getCompanyScope(req);

    let sql = `
      SELECT 
        u.id, u.login_id, u.name, u.email, u.phone, u.department,
        u.user_type, u.status, u.company_id, u.last_login_at, u.created_at,
        u.store_codes,
        c.company_name, c.store_code_list
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
    `;
    const params: any[] = [];

    if (companyScope) {
      sql += ' WHERE u.company_id = $1';
      params.push(companyScope);
    }

    sql += ' ORDER BY u.created_at DESC';

    const result = await pool.query(sql, params);

    // storeCodeList 추출 (첫 번째 사용자의 회사 기준, 또는 companyScope로 별도 조회)
    let storeCodeList: string[] = [];
    if (companyScope) {
      const companyResult = await pool.query(
        'SELECT store_code_list FROM companies WHERE id = $1',
        [companyScope]
      );
      storeCodeList = companyResult.rows[0]?.store_code_list || [];
    } else if (result.rows.length > 0) {
      // 슈퍼관리자: 각 사용자별 회사의 store_code_list는 이미 JOIN으로 포함
    }

    const users = result.rows.map(u => ({
      ...u,
      store_codes: u.store_codes ? (Array.isArray(u.store_codes) ? u.store_codes.join(', ') : u.store_codes) : '',
    }));

    res.json({ users, storeCodeList });
  } catch (error) {
    console.error('사용자 목록 조회 실패:', error);
    res.status(500).json({ error: '사용자 목록 조회 실패' });
  }
});

// POST / - 사용자 추가 (계정 발급)
router.post('/', async (req: Request, res: Response) => {
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;
  const { companyId, loginId, password, name, email, phone, department, userType, storeCodes } = req.body;

  // 고객사관리자는 자사에만 사용자 생성 가능
  const targetCompanyId = callerType === 'super_admin' ? companyId : callerCompanyId;

  if (!targetCompanyId || !loginId || !password || !name) {
    return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
  }

  // 고객사관리자는 company_admin/super_admin 타입 생성 불가
  if (callerType === 'company_admin' && userType && ['super_admin', 'company_admin'].includes(userType)) {
    return res.status(403).json({ error: '관리자 계정은 생성할 수 없습니다.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE login_id = $1', [loginId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: '이미 사용중인 로그인 ID입니다.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // 고객사관리자가 생성하면 user_type은 'user' 고정
    const finalUserType = callerType === 'super_admin' ? (userType || 'user') : 'user';

    // storeCodes: 배열 또는 콤마 문자열 → 배열로 변환
    let storeCodesArr = null;
    if (storeCodes) {
      if (Array.isArray(storeCodes)) {
        storeCodesArr = storeCodes;
      } else if (typeof storeCodes === 'string') {
        storeCodesArr = storeCodes.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }

    const result = await pool.query(`
      INSERT INTO users (company_id, login_id, password_hash, name, email, phone, department, user_type, status, must_change_password, store_codes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', true, $9)
      RETURNING id, login_id, name, email, user_type, status, created_at, store_codes
    `, [targetCompanyId, loginId, passwordHash, name, email || null, phone || null, department || null, finalUserType, storeCodesArr]);

    res.status(201).json({ user: result.rows[0], message: '사용자가 생성되었습니다.' });
  } catch (error) {
    console.error('사용자 생성 실패:', error);
    res.status(500).json({ error: '사용자 생성 실패' });
  }
});

// PUT /:id - 사용자 수정
router.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;
  const { name, email, phone, department, userType, status, storeCodes } = req.body;

  try {
    // 고객사관리자: 자사 사용자만 수정 가능
    if (callerType === 'company_admin') {
      const check = await pool.query('SELECT company_id FROM users WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
      if (check.rows[0].company_id !== callerCompanyId) {
        return res.status(403).json({ error: '자사 사용자만 수정할 수 있습니다.' });
      }
    }

    // 고객사관리자는 user_type 변경 불가
    const finalUserType = callerType === 'super_admin' ? userType : undefined;

    // storeCodes: 배열 또는 콤마 문자열 → 배열로 변환
    let storeCodesArr = null;
    if (storeCodes) {
      if (Array.isArray(storeCodes)) {
        storeCodesArr = storeCodes;
      } else if (typeof storeCodes === 'string') {
        storeCodesArr = storeCodes.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }

    const result = await pool.query(`
      UPDATE users 
      SET name = COALESCE($1, name),
          email = COALESCE($2, email),
          phone = COALESCE($3, phone),
          department = COALESCE($4, department),
          user_type = COALESCE($5, user_type),
          status = COALESCE($6, status),
          store_codes = $7,
          updated_at = NOW()
      WHERE id = $8
      RETURNING id, login_id, name, email, user_type, status, store_codes
    `, [name, email, phone, department, finalUserType, status, storeCodesArr, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    res.json({ user: result.rows[0], message: '수정되었습니다.' });
  } catch (error) {
    console.error('사용자 수정 실패:', error);
    res.status(500).json({ error: '사용자 수정 실패' });
  }
});

// DELETE /:id - 사용자 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;

  try {
    if (callerType === 'company_admin') {
      const check = await pool.query('SELECT company_id, user_type FROM users WHERE id = $1', [id]);
      if (check.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
      if (check.rows[0].company_id !== callerCompanyId) {
        return res.status(403).json({ error: '자사 사용자만 삭제할 수 있습니다.' });
      }
      if (check.rows[0].user_type === 'company_admin') {
        return res.status(403).json({ error: '관리자 계정은 삭제할 수 없습니다.' });
      }
    }

    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, login_id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    res.json({ message: '삭제되었습니다.' });
  } catch (error) {
    console.error('사용자 삭제 실패:', error);
    res.status(500).json({ error: '사용자 삭제 실패' });
  }
});

// POST /:id/reset-password - 비밀번호 초기화
router.post('/:id/reset-password', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userType: callerType, companyId: callerCompanyId } = (req as any).user!;

  try {
    const userResult = await pool.query('SELECT id, login_id, name, phone, company_id FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }
    const user = userResult.rows[0];

    if (callerType === 'company_admin' && user.company_id !== callerCompanyId) {
      return res.status(403).json({ error: '자사 사용자만 비밀번호를 초기화할 수 있습니다.' });
    }

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let tempPassword = '';
    for (let i = 0; i < 8; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await pool.query(`
      UPDATE users 
      SET password_hash = $1, must_change_password = true, updated_at = NOW()
      WHERE id = $2
    `, [passwordHash, id]);

    let smsSent = false;
    if (user.phone) {
      try {
        const phone = user.phone.replace(/-/g, '');
        const message = `[Target-UP] 임시 비밀번호: ${tempPassword}\n최초 로그인 시 비밀번호 변경이 필요합니다.`;

        await mysqlQuery(
          `INSERT INTO SMSQ_SEND (dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1) VALUES (?, ?, ?, 'S', NOW(), 100, '1')`,
          [phone, '18008125', message]
        );
        smsSent = true;
      } catch (smsError) {
        console.error('SMS 발송 실패:', smsError);
      }
    }

    res.json({
      tempPassword,
      message: '비밀번호가 초기화되었습니다.',
      user: { id: user.id, login_id: user.login_id, name: user.name },
      smsSent,
      phone: user.phone ? user.phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-****-$3') : null
    });
  } catch (error) {
    console.error('비밀번호 초기화 실패:', error);
    res.status(500).json({ error: '비밀번호 초기화 실패' });
  }
});

export default router;
