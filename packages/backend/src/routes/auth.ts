import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { generateToken, JwtPayload } from '../middlewares/auth';

const router = Router();

// POST /api/auth/login - 로그인
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { loginId, password, userType } = req.body;

    if (!loginId || !password) {
      return res.status(400).json({ error: '로그인 ID와 비밀번호를 입력하세요.' });
    }

    // 슈퍼관리자 로그인
    if (userType === 'super_admin') {
      const result = await query(
        'SELECT * FROM super_admins WHERE login_id = $1 AND is_active = true',
        [loginId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
      }

      const admin = result.rows[0];
      const validPassword = await bcrypt.compare(password, admin.password_hash);

      if (!validPassword) {
        return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
      }

      // 마지막 로그인 시간 업데이트
      await query(
        'UPDATE super_admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
        [admin.id]
      );

      const payload: JwtPayload = {
        userId: admin.id,
        userType: 'super_admin',
        loginId: admin.login_id,
      };

      const token = generateToken(payload);

      return res.json({
        token,
        user: {
          id: admin.id,
          loginId: admin.login_id,
          name: admin.name,
          email: admin.email,
          userType: 'super_admin',
        },
      });
    }

    // 고객사 사용자 로그인
    const result = await query(
      `SELECT u.*, c.company_name, c.company_code, c.status as company_status
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE u.login_id = $1 AND u.is_active = true`,
      [loginId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const user = result.rows[0];

    // 회사 상태 확인
    if (user.company_status === 'suspended' || user.company_status === 'terminated') {
      return res.status(403).json({ error: '이용이 정지된 계정입니다. 관리자에게 문의하세요.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    // 마지막 로그인 시간 업데이트
    await query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    const payload: JwtPayload = {
      userId: user.id,
      companyId: user.company_id,
      userType: user.role === 'admin' ? 'company_admin' : 'company_user',
      loginId: user.login_id,
    };

    const token = generateToken(payload);

    return res.json({
      token,
      user: {
        id: user.id,
        loginId: user.login_id,
        name: user.name,
        email: user.email,
        userType: payload.userType,
        company: {
          id: user.company_id,
          name: user.company_name,
          code: user.company_code,
        },
      },
    });
  } catch (error) {
    console.error('로그인 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/auth/register-super-admin - 슈퍼관리자 생성 (초기 설정용)
router.post('/register-super-admin', async (req: Request, res: Response) => {
  try {
    const { loginId, password, name, email } = req.body;

    // 이미 슈퍼관리자가 있는지 확인
    const existing = await query('SELECT COUNT(*) FROM super_admins');
    
    // 첫 번째 슈퍼관리자만 자유롭게 생성 가능
    if (parseInt(existing.rows[0].count) > 0) {
      return res.status(403).json({ error: '이미 슈퍼관리자가 존재합니다.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO super_admins (login_id, password_hash, name, email, role)
       VALUES ($1, $2, $3, $4, 'super')
       RETURNING id, login_id, name, email`,
      [loginId, passwordHash, name, email]
    );

    return res.status(201).json({
      message: '슈퍼관리자가 생성되었습니다.',
      admin: result.rows[0],
    });
  } catch (error: any) {
    console.error('슈퍼관리자 생성 에러:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: '이미 존재하는 로그인 ID입니다.' });
    }
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
