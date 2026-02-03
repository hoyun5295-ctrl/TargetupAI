import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { generateToken, JwtPayload } from '../middlewares/auth';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { loginId, password, userType } = req.body;

    if (!loginId || !password) {
      return res.status(400).json({ error: 'ID and password required' });
    }

    if (userType === 'super_admin') {
      const result = await query(
        'SELECT * FROM super_admins WHERE login_id = $1 AND is_active = true',
        [loginId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const admin = result.rows[0];
      const validPassword = await bcrypt.compare(password, admin.password_hash);

      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

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

    const result = await query(
      `SELECT u.*, u.must_change_password, c.name as company_name, c.id as company_code
       FROM users u
       JOIN companies c ON u.company_id = c.id
       WHERE u.login_id = $1 AND u.is_active = true`,
      [loginId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    
    console.log('User found:', user.login_id);
    console.log('Password hash from DB:', user.password_hash);
    
    const validPassword = await bcrypt.compare(password, user.password_hash);
    
    console.log('Password valid:', validPassword);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    const payload: JwtPayload = {
      userId: user.id,
      companyId: user.company_id,
      userType: user.user_type === 'admin' ? 'company_admin' : 'company_user',
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
        mustChangePassword: user.must_change_password || false,
        storeCodes: user.store_codes || [],
        company: {
          id: user.company_id,
          name: user.company_name,
          code: user.company_code,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/register-super-admin', async (req: Request, res: Response) => {
  try {
    const { loginId, password, name, email } = req.body;

    const existing = await query('SELECT COUNT(*) FROM super_admins');

    if (parseInt(existing.rows[0].count) > 0) {
      return res.status(403).json({ error: 'Super admin already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO super_admins (login_id, password_hash, name, email, role)
       VALUES ($1, $2, $3, $4, 'super')
       RETURNING id, login_id, name, email`,
      [loginId, passwordHash, name, email]
    );

    return res.status(201).json({
      message: 'Super admin created',
      admin: result.rows[0],
    });
  } catch (error: any) {
    console.error('Register error:', error);
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Login ID already exists' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

// 비밀번호 변경 (최초 로그인 시)
router.post('/change-password', async (req: Request, res: Response) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: '필수 정보가 누락되었습니다.' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
    }

    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await query(
      'UPDATE users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, userId]
    );

    return res.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (error) {
    console.error('비밀번호 변경 오류:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

export default router;
