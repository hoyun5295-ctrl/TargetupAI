import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { saveSegment, getSegments, deleteSegment, updateSegment, touchSegment } from '../utils/saved-segments';
// ★ D220+ (2026-05-27 Task 6): 자연어 변환 + 매칭 미리보기 (CT-97 + CT-01)
import {
  generateSegmentFromNaturalLanguage,
  previewMatching,
  SegmentGenerationError,
} from '../utils/ai-segment-generator';
import { requirePlanFeature } from '../utils/plan-guard';
import { query } from '../config/database';

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

    // ★ D171 영구 원칙: autoRelax 무시 (request body에 와도 false 고정). feedback_no_target_auto_relax.md
    // ★ D220+ Task 6: filter (CT-01 호환 structured filter) 추가 — 자연어 변환 결과 저장
    const { name, emoji, segmentType, prompt, selectedFields, briefing, url, channel, isAd, filter } = req.body;

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
      name, emoji, segmentType, prompt, selectedFields, briefing, url, channel, isAd, filter,
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

// 수정
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 없습니다.' });

    // ★ D171 영구 원칙: autoRelax 무시 (request body에 와도 UPDATE 적용 X). feedback_no_target_auto_relax.md
    // ★ D220+ Task 6: filter 추가
    const { name, emoji, segmentType, prompt, selectedFields, briefing, url, channel, isAd, filter } = req.body;

    const segment = await updateSegment(req.params.id, companyId, userId, {
      name, emoji, segmentType, prompt, selectedFields, briefing, url, channel, isAd, filter,
    });
    if (!segment) {
      return res.status(404).json({ error: '세그먼트를 찾을 수 없습니다.' });
    }
    return res.json({ success: true, segment, message: '수정되었습니다.' });
  } catch (error: any) {
    console.error('세그먼트 수정 에러:', error);
    return res.status(500).json({ error: '수정 중 오류가 발생했습니다.' });
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

// ============================================================
// ★ D220+ (2026-05-27 Task 6): 일반 segment 관리 메뉴 강화 endpoint 2건
//   - POST /generate-from-text — 자연어 → CT-97 → filter JSONB 변환 (ai_messaging BASIC+)
//   - POST /:id/preview — saved segment 매칭 수 + 샘플 5건 미리보기 (인증 단일)
// ============================================================

/**
 * POST /api/saved-segments/generate-from-text
 * body: { naturalLanguage: string, customFieldKeys?: string[] }
 * 응답: { filter, explanation, matchCount, samples }
 */
router.post(
  '/generate-from-text',
  requirePlanFeature('ai_messaging'),
  async (req: Request, res: Response) => {
    try {
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(401).json({ success: false, error: '인증 필요' });

      const { naturalLanguage, customFieldKeys } = req.body as {
        naturalLanguage: string;
        customFieldKeys?: string[];
      };
      if (!naturalLanguage?.trim()) {
        return res.status(400).json({ success: false, error: '자연어 입력 필수' });
      }

      const result = await generateSegmentFromNaturalLanguage({
        companyId,
        naturalLanguage,
        customFieldKeys: Array.isArray(customFieldKeys) ? customFieldKeys : undefined,
      });
      return res.json({ success: true, ...result });
    } catch (err: any) {
      if (err instanceof SegmentGenerationError) {
        return res.status(400).json({ success: false, code: err.code, error: err.message });
      }
      console.error('[saved-segments/generate-from-text] 실패:', err);
      return res.status(500).json({ success: false, error: 'AI 세그먼트 생성 실패' });
    }
  },
);

/**
 * POST /api/saved-segments/:id/preview
 * 저장된 세그먼트의 매칭 수 + 샘플 5건 미리보기.
 * filter_jsonb 컬럼 있으면 CT-01 호환 SQL 빌더 활용 / 없으면 prompt 기반 segment = 안내만.
 */
router.post('/:id/preview', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한 없음' });

    const res1 = await query(
      `SELECT id, name, filter_jsonb, segment_type
         FROM saved_segments
        WHERE id = $1 AND company_id = $2 AND user_id = $3`,
      [req.params.id, companyId, userId],
    );
    if (res1.rows.length === 0) {
      return res.status(404).json({ success: false, error: '세그먼트를 찾을 수 없습니다.' });
    }
    const seg = res1.rows[0];

    if (!seg.filter_jsonb) {
      return res.json({
        success: true,
        matchCount: null,
        samples: [],
        message: '본 세그먼트는 자연어 프롬프트 기반입니다 — 매칭 수는 AI 한줄로 발송 시점에 확정됩니다.',
      });
    }

    const result = await previewMatching(companyId, seg.filter_jsonb);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[saved-segments/preview] 실패:', err);
    return res.status(500).json({ success: false, error: '미리보기 실패' });
  }
});

export default router;
