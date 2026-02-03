import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

// GET /api/unsubscribe - 나래인터넷 080 콜백 (인증 없음)
router.get('/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { cid, fr } = req.query;
    
    if (!cid || !fr) {
      return res.send('0');
    }
    
    const phone = String(cid).replace(/\D/g, '');
    const rejectNumber = String(fr).replace(/\D/g, '');
    
    // 080번호로 회사 찾기 (callback_numbers 또는 companies.reject_number)
    const companyResult = await query(
      `SELECT c.id FROM companies c
       LEFT JOIN callback_numbers cb ON cb.company_id = c.id
       WHERE REPLACE(c.reject_number, '-', '') = $1
          OR REPLACE(cb.phone, '-', '') = $1
       LIMIT 1`,
      [rejectNumber]
    );
    
    if (companyResult.rows.length === 0) {
      console.log(`080 수신거부: 회사 못찾음 - fr=${fr}`);
      return res.send('0');
    }
    
    const companyId = companyResult.rows[0].id;
    
    // 수신거부 등록 (중복 무시)
    await query(
      `INSERT INTO unsubscribes (company_id, phone, source)
       VALUES ($1, $2, 'api')
       ON CONFLICT (company_id, phone) DO NOTHING`,
      [companyId, phone]
    );
    
    console.log(`080 수신거부 등록: ${phone} (회사: ${companyId})`);
    return res.send('1');
  } catch (error) {
    console.error('080 수신거부 에러:', error);
    return res.send('0');
  }
});

// 아래부터는 인증 필요
router.use(authenticate);

// GET /api/unsubscribes - 수신거부 목록 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { page = 1, limit = 20, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    
    if (search) {
      whereClause += ` AND phone LIKE $2`;
      params.push(`%${search}%`);
    }
    
    const countResult = await query(
      `SELECT COUNT(*) FROM unsubscribes ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);
    
    const result = await query(
      `SELECT id, phone, source, created_at
       FROM unsubscribes
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Number(limit), offset]
    );
    
    return res.json({
      success: true,
      unsubscribes: result.rows,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('수신거부 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/unsubscribes - 직접 추가
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { phone } = req.body;
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: '올바른 전화번호를 입력하세요.' });
    }
    
    await query(
      `INSERT INTO unsubscribes (company_id, phone, source)
       VALUES ($1, $2, 'manual')
       ON CONFLICT (company_id, phone) DO NOTHING`,
      [companyId, cleanPhone]
    );
    
    return res.json({ success: true, message: '등록되었습니다.' });
  } catch (error) {
    console.error('수신거부 추가 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/unsubscribes/upload - 엑셀 업로드
router.post('/upload', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { phones } = req.body; // 배열로 받음
    
    if (!phones || !Array.isArray(phones) || phones.length === 0) {
      return res.status(400).json({ error: '전화번호 목록이 필요합니다.' });
    }
    
    let insertCount = 0;
    let skipCount = 0;
    
    for (const phone of phones) {
      const cleanPhone = String(phone).replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        const result = await query(
          `INSERT INTO unsubscribes (company_id, phone, source)
           VALUES ($1, $2, 'upload')
           ON CONFLICT (company_id, phone) DO NOTHING
           RETURNING id`,
          [companyId, cleanPhone]
        );
        if (result.rows.length > 0) {
          insertCount++;
        } else {
          skipCount++;
        }
      }
    }
    
    return res.json({
      success: true,
      message: `${insertCount}건 등록, ${skipCount}건 중복 제외`,
      insertCount,
      skipCount,
    });
  } catch (error) {
    console.error('수신거부 업로드 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// DELETE /api/unsubscribes/:id - 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }
    
    const { id } = req.params;
    
    await query(
      `DELETE FROM unsubscribes WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    
    return res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error) {
    console.error('수신거부 삭제 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});
// POST /api/unsubscribes/check - 수신거부 체크 (발송 전 확인용)
router.post('/check', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { phones } = req.body;
    if (!phones || !Array.isArray(phones)) {
      return res.json({ unsubscribeCount: 0, unsubscribePhones: [] });
    }

    const cleanPhones = phones.map((p: string) => p.replace(/\D/g, ''));
    const result = await query(
      `SELECT phone FROM unsubscribes WHERE company_id = $1 AND phone = ANY($2)`,
      [companyId, cleanPhones]
    );

    return res.json({
      unsubscribeCount: result.rows.length,
      unsubscribePhones: result.rows.map((r: any) => r.phone),
    });
  } catch (error) {
    console.error('수신거부 체크 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

export default router;