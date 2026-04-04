import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { saveSegment, getSegments, deleteSegment, touchSegment } from '../utils/saved-segments';

const router = Router();

router.use(authenticate);

// 목록 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 없습니다.' });

    const segments = await getSegments(companyId, userId);
    return res.json({ success: true, segments });
  } catch (error: any) {
    console.error('세그먼트 목록 조회 에러:', error);
    return res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

// 저장
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 없습니다.' });

    const { name, emoji, segmentType, prompt, autoRelax, selectedFields, briefing, url, channel, isAd } = req.body;

    if (!name || !segmentType) {
      return res.status(400).json({ error: '세그먼트명과 유형은 필수입니다.' });
    }
    if (segmentType !== 'hanjullo' && segmentType !== 'custom') {
      return res.status(400).json({ error: '유형은 hanjullo 또는 custom이어야 합니다.' });
    }
    if (segmentType === 'hanjullo' && !prompt) {
      return res.status(400).json({ error: 'AI 한줄로 세그먼트는 프롬프트가 필수입니다.' });
    }

    const segment = await saveSegment(companyId, userId, {
      name, emoji, segmentType, prompt, autoRelax, selectedFields, briefing, url, channel, isAd,
    });
    return res.json({ success: true, segment, message: '세그먼트가 저장되었습니다.' });
  } catch (error: any) {
    if (error.message?.includes('최대')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('세그먼트 저장 에러:', error);
    return res.status(500).json({ error: '저장 중 오류가 발생했습니다.' });
  }
});

// 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 없습니다.' });

    const deleted = await deleteSegment(req.params.id, companyId, userId);
    if (!deleted) {
      return res.status(404).json({ error: '세그먼트를 찾을 수 없습니다.' });
    }
    return res.json({ success: true, message: '삭제되었습니다.' });
  } catch (error: any) {
    console.error('세그먼트 삭제 에러:', error);
    return res.status(500).json({ error: '삭제 중 오류가 발생했습니다.' });
  }
});

// 사용 시각 갱신
router.post('/:id/touch', async (req: Request, res: Response) => {
  try {
    await touchSegment(req.params.id);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('세그먼트 touch 에러:', error);
    return res.status(500).json({ error: '갱신 중 오류가 발생했습니다.' });
  }
});

export default router;
