import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';

const router = Router();

// 모든 라우트에 인증 적용
router.use(authenticate);

// 템플릿 목록 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '권한이 없습니다.' });

    const result = await query(
      `SELECT id, template_name, message_type, subject, content, created_at
       FROM sms_templates
       WHERE company_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [companyId, userId]
    );

    return res.json({ success: true, templates: result.rows });
  } catch (error: any) {
    console.error('템플릿 목록 조회 에러:', error);
    return res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

// 템플릿 저장
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '권한이 없습니다.' });

    const { templateName, messageType, subject, content } = req.body;

    if (!templateName || !content) {
      return res.status(400).json({ error: '템플릿명과 내용은 필수입니다.' });
    }

    // 동일 이름 중복 체크
    const existing = await query(
      `SELECT id FROM sms_templates WHERE company_id = $1 AND user_id = $2 AND template_name = $3`,
      [companyId, userId, templateName]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: '같은 이름의 템플릿이 이미 존재합니다.' });
    }

    const result = await query(
      `INSERT INTO sms_templates (id, company_id, user_id, template_name, message_type, subject, content, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id, template_name, message_type, subject, content, created_at`,
      [companyId, userId, templateName, messageType || 'SMS', subject || null, content]
    );

    return res.json({ success: true, template: result.rows[0], message: '템플릿이 저장되었습니다.' });
  } catch (error: any) {
    console.error('템플릿 저장 에러:', error);
    return res.status(500).json({ error: '저장 중 오류가 발생했습니다.' });
  }
});

// 템플릿 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '권한이 없습니다.' });

    const { id } = req.params;

    const result = await query(
      `DELETE FROM sms_templates WHERE id = $1 AND company_id = $2 AND user_id = $3 RETURNING id`,
      [id, companyId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
    }

    return res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error: any) {
    console.error('템플릿 삭제 에러:', error);
    return res.status(500).json({ error: '삭제 중 오류가 발생했습니다.' });
  }
});

export default router;
