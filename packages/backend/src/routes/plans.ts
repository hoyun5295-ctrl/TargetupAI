import { Router, Request, Response } from 'express';
import { query } from '../config/database';

const router = Router();

// GET /api/plans - 요금제 목록 (인증 불필요)
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM plans WHERE is_active = true ORDER BY monthly_price ASC`
    );

    return res.json({ plans: result.rows });
  } catch (error) {
    console.error('요금제 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

export default router;
