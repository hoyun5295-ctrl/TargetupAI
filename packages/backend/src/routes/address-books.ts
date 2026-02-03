import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// GET /api/address-books/groups - 그룹 목록 조회
router.get('/groups', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const result = await query(
      `SELECT group_name, COUNT(*) as count, MAX(created_at) as created_at
       FROM address_books
       WHERE company_id = $1
       GROUP BY group_name
       ORDER BY MAX(created_at) DESC`,
      [companyId]
    );

    return res.json({ success: true, groups: result.rows });
  } catch (error) {
    console.error('주소록 그룹 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// GET /api/address-books/:groupName - 그룹 연락처 조회
router.get('/:groupName', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { groupName } = req.params;

    const result = await query(
      `SELECT id, phone, name, extra1, extra2, extra3
       FROM address_books
       WHERE company_id = $1 AND group_name = $2
       ORDER BY created_at`,
      [companyId, groupName]
    );

    return res.json({ success: true, contacts: result.rows });
  } catch (error) {
    console.error('주소록 연락처 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/address-books - 주소록 저장
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { groupName, contacts } = req.body;

    if (!groupName || !contacts || !Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: '그룹명과 연락처가 필요합니다.' });
    }

    // 기존 그룹명 중복 체크
    const existCheck = await query(
      `SELECT COUNT(*) FROM address_books WHERE company_id = $1 AND group_name = $2`,
      [companyId, groupName]
    );
    if (parseInt(existCheck.rows[0].count) > 0) {
      return res.status(400).json({ error: '이미 존재하는 그룹명입니다.' });
    }

    let insertCount = 0;
    for (const contact of contacts) {
      const phone = String(contact.phone || '').replace(/\D/g, '');
      if (phone.length >= 10) {
        await query(
          `INSERT INTO address_books (company_id, group_name, phone, name, extra1, extra2, extra3)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [companyId, groupName, phone, contact.name || '', contact.extra1 || '', contact.extra2 || '', contact.extra3 || '']
        );
        insertCount++;
      }
    }

    return res.json({ success: true, message: `${insertCount}건 저장 완료`, insertCount });
  } catch (error) {
    console.error('주소록 저장 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// DELETE /api/address-books/:groupName - 그룹 삭제
router.delete('/:groupName', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '권한이 필요합니다.' });
    }

    const { groupName } = req.params;

    await query(
      `DELETE FROM address_books WHERE company_id = $1 AND group_name = $2`,
      [companyId, groupName]
    );

    return res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error) {
    console.error('주소록 삭제 에러:', error);
    return res.status(500).json({ error: '서버 오류' });
  }
});

export default router;