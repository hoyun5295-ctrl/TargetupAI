import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';

const router = Router();

router.use(authenticate);

// GET /api/test-contacts - 담당자 목록 조회 (모드에 따라 필터링)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;

    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    // 회사의 test_contact_mode 조회
    const companyResult = await query(
      'SELECT test_contact_mode FROM companies WHERE id = $1',
      [companyId]
    );
    const mode = companyResult.rows[0]?.test_contact_mode || 'shared';

    let contacts;
    
    if (mode === 'shared') {
      // 회사 공용만 (user_id가 NULL인 것)
      const result = await query(
        `SELECT id, name, phone, user_id, created_at 
         FROM test_contacts 
         WHERE company_id = $1 AND user_id IS NULL
         ORDER BY created_at ASC`,
        [companyId]
      );
      contacts = result.rows;
    } else if (mode === 'personal') {
      // 본인 것만
      const result = await query(
        `SELECT id, name, phone, user_id, created_at 
         FROM test_contacts 
         WHERE company_id = $1 AND user_id = $2
         ORDER BY created_at ASC`,
        [companyId, userId]
      );
      contacts = result.rows;
    } else {
      // 'both': 회사 공용 + 본인 것
      const result = await query(
        `SELECT tc.id, tc.name, tc.phone, tc.user_id, tc.created_at,
                CASE WHEN tc.user_id IS NULL THEN 'shared' ELSE 'personal' END as type,
                u.name as owner_name
         FROM test_contacts tc
         LEFT JOIN users u ON tc.user_id = u.id
         WHERE tc.company_id = $1 AND (tc.user_id IS NULL OR tc.user_id = $2)
         ORDER BY tc.user_id NULLS FIRST, tc.created_at ASC`,
        [companyId, userId]
      );
      contacts = result.rows;
    }

    res.json({ success: true, contacts, mode });
  } catch (error) {
    console.error('담당자 목록 조회 에러:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/test-contacts - 담당자 추가
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const { name, phone, isShared } = req.body;

    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    if (!phone) {
      return res.status(400).json({ success: false, error: '전화번호는 필수입니다' });
    }

    // 회사의 test_contact_mode 조회
    const companyResult = await query(
      'SELECT test_contact_mode FROM companies WHERE id = $1',
      [companyId]
    );
    const mode = companyResult.rows[0]?.test_contact_mode || 'shared';

    // 모드에 따라 user_id 결정
    let contactUserId = null;
    if (mode === 'personal') {
      contactUserId = userId;
    } else if (mode === 'both') {
      contactUserId = isShared ? null : userId;
    }
    // mode === 'shared'면 무조건 null

    // 중복 체크
    const duplicateCheck = await query(
      `SELECT id FROM test_contacts 
       WHERE company_id = $1 AND phone = $2 AND (user_id = $3 OR (user_id IS NULL AND $3::uuid IS NULL))`,
      [companyId, phone.replace(/-/g, ''), contactUserId]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ success: false, error: '이미 등록된 번호입니다' });
    }

    const result = await query(
      `INSERT INTO test_contacts (company_id, user_id, name, phone)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [companyId, contactUserId, name, phone.replace(/-/g, '')]
    );

    res.json({ success: true, contact: result.rows[0] });
  } catch (error) {
    console.error('담당자 추가 에러:', error);
    res.status(500).json({ success: false, error: '추가 실패' });
  }
});

// DELETE /api/test-contacts/:id - 담당자 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!companyId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    // 회사의 test_contact_mode 조회
    const companyResult = await query(
      'SELECT test_contact_mode FROM companies WHERE id = $1',
      [companyId]
    );
    const mode = companyResult.rows[0]?.test_contact_mode || 'shared';

    // 삭제 권한 체크
    const contactResult = await query(
      'SELECT user_id FROM test_contacts WHERE id = $1 AND company_id = $2',
      [id, companyId]
    );

    if (contactResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: '담당자를 찾을 수 없습니다' });
    }

    const contactUserId = contactResult.rows[0].user_id;

    // personal 모드에서는 본인 것만 삭제 가능
    if (mode === 'personal' && contactUserId !== userId) {
      return res.status(403).json({ success: false, error: '삭제 권한이 없습니다' });
    }

    // both 모드에서 공용(user_id=null)은 admin만 삭제 가능
    if (mode === 'both' && contactUserId === null) {
      const userResult = await query(
        'SELECT user_type FROM users WHERE id = $1',
        [userId]
      );
      if (userResult.rows[0]?.user_type !== 'admin') {
        return res.status(403).json({ success: false, error: '공용 담당자는 관리자만 삭제할 수 있습니다' });
      }
    }

    await query('DELETE FROM test_contacts WHERE id = $1', [id]);

    res.json({ success: true, message: '삭제되었습니다' });
  } catch (error) {
    console.error('담당자 삭제 에러:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

export default router;
