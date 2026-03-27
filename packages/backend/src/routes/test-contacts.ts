import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { getUserTestContacts, addTestContact, deleteTestContact } from '../utils/test-contact-helper';

const router = Router();

router.use(authenticate);

// GET /api/test-contacts — 담당자 목록 조회 (CT-11 컨트롤타워)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    if (!companyId || !userId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const contacts = await getUserTestContacts(companyId, userId);
    res.json({ success: true, contacts, mode: 'personal' });
  } catch (error) {
    console.error('담당자 목록 조회 에러:', error);
    res.status(500).json({ success: false, error: '조회 실패' });
  }
});

// POST /api/test-contacts — 담당자 추가 (CT-11 컨트롤타워)
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const { name, phone } = req.body;

    if (!companyId || !userId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, error: '전화번호는 필수입니다' });
    }

    const result = await addTestContact(companyId, userId, name, phone);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    res.json({ success: true, contact: result.contact });
  } catch (error) {
    console.error('담당자 추가 에러:', error);
    res.status(500).json({ success: false, error: '추가 실패' });
  }
});

// DELETE /api/test-contacts/:id — 담당자 삭제 (CT-11 컨트롤타워)
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = (req as any).user?.companyId;
    const userId = (req as any).user?.userId;
    const { id } = req.params;

    if (!companyId || !userId) {
      return res.status(401).json({ success: false, error: '인증 필요' });
    }

    const result = await deleteTestContact(id, companyId, userId);
    if (!result.success) {
      const status = result.error === '담당자를 찾을 수 없습니다' ? 404 : 403;
      return res.status(status).json({ success: false, error: result.error });
    }
    res.json({ success: true, message: '삭제되었습니다' });
  } catch (error) {
    console.error('담당자 삭제 에러:', error);
    res.status(500).json({ success: false, error: '삭제 실패' });
  }
});

export default router;
