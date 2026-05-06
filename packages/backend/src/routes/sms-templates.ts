import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import { authenticate } from '../middlewares/auth';
import { query } from '../config/database';

const router = Router();

// ★ D144 P1 (2026-05-06): 보관함 MMS 이미지 깨짐 방지
//   원인: 사용자가 이미지를 삭제하면 실제 파일은 사라지지만 sms_templates.mms_image_paths의 path는 잔존
//   → 보관함 불러올 때 깨진 path 표시 + 발송 시 실패
//   해결: GET 응답 시 fs.existsSync로 실제 파일 존재 검증 → 사라진 path 자동 제거
function filterExistingImagePaths(rawPaths: any): any[] {
  if (!rawPaths) return [];
  let paths = rawPaths;
  if (typeof paths === 'string') {
    try { paths = JSON.parse(paths); } catch { return []; }
  }
  if (!Array.isArray(paths)) return [];
  return paths.filter((p: any) => {
    const filePath = typeof p === 'string' ? p : p?.path;
    if (!filePath || typeof filePath !== 'string') return false;
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });
}

// 모든 라우트에 인증 적용
router.use(authenticate);

// 템플릿 목록 조회
// ★ B1(0417 PDF #1): is_ad 컬럼 추가 — 저장 시점의 광고 ON/OFF 상태 복원용
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '권한이 없습니다.' });

    const result = await query(
      `SELECT id, template_name, message_type, subject, content, mms_image_paths, is_ad, created_at
       FROM sms_templates
       WHERE company_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 50`,
      [companyId, userId]
    );

    // ★ D144 P1: 각 템플릿의 mms_image_paths에서 실제 파일 없는 path 자동 제거 + DB 정리
    const templates = await Promise.all(result.rows.map(async (t: any) => {
      if (!t.mms_image_paths) return t;
      const validPaths = filterExistingImagePaths(t.mms_image_paths);
      const originalPaths = typeof t.mms_image_paths === 'string'
        ? (() => { try { return JSON.parse(t.mms_image_paths); } catch { return []; } })()
        : (Array.isArray(t.mms_image_paths) ? t.mms_image_paths : []);
      // 깨진 path가 있으면 DB도 정리 (백그라운드, 실패해도 응답에 영향 없음)
      if (validPaths.length !== originalPaths.length) {
        try {
          await query(
            `UPDATE sms_templates SET mms_image_paths = $1, updated_at = NOW() WHERE id = $2`,
            [validPaths.length > 0 ? JSON.stringify(validPaths) : null, t.id]
          );
        } catch (e) {
          console.warn('[sms-templates] mms_image_paths 정리 실패 (응답에는 정상 반영):', e);
        }
      }
      return { ...t, mms_image_paths: validPaths.length > 0 ? validPaths : null };
    }));

    return res.json({ success: true, templates });
  } catch (error: any) {
    console.error('템플릿 목록 조회 에러:', error);
    return res.status(500).json({ error: '조회 중 오류가 발생했습니다.' });
  }
});

// 템플릿 저장
// ★ B1(0417 PDF #1): isAd 필드 저장 — 프론트 adTextEnabled 상태를 DB에 왕복
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '권한이 없습니다.' });

    const { templateName, messageType, subject, content, mmsImagePaths, isAd } = req.body;

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

    // isAd 미전달 시 true (레거시 호환: 기존 템플릿은 전부 광고 ON으로 간주)
    const isAdValue = typeof isAd === 'boolean' ? isAd : true;

    const result = await query(
      `INSERT INTO sms_templates (id, company_id, user_id, template_name, message_type, subject, content, mms_image_paths, is_ad, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id, template_name, message_type, subject, content, mms_image_paths, is_ad, created_at`,
      [companyId, userId, templateName, messageType || 'SMS', subject || null, content, mmsImagePaths ? JSON.stringify(mmsImagePaths) : null, isAdValue]
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
