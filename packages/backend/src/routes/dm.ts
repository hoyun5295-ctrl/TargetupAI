/**
 * dm.ts — 모바일 DM 빌더 라우트
 *
 * 마운트:
 *   공개: /api/dm/v  (뷰어 + 추적 — helmet 전 마운트)
 *   인증: /api/dm    (CRUD + 이미지 — 한줄로 authenticate)
 *
 * 한줄로 AI 프로 요금제 이상.
 */

import { Request, Response, Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import {
  createDm, updateDm, deleteDm, getDmList, getDmDetail, getDmByCode,
  publishDm, trackDmView, getDmStats,
} from '../utils/dm/dm-builder';
import { renderDmViewerHtml, renderDmErrorHtml } from '../utils/dm/dm-viewer';

const DM_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'dm-images');

// ============================================================
//  공개 라우터 (인증 불필요 — app.ts에서 helmet 전 마운트)
// ============================================================

export const dmPublicRouter = Router();

// DM 이미지 서빙
dmPublicRouter.get('/images/:companyId/:filename', (req: Request, res: Response) => {
  const { companyId, filename } = req.params;
  const filePath = path.join(DM_IMAGE_DIR, companyId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// DM 뷰어 — 공개 페이지
dmPublicRouter.get('/:code', async (req: Request, res: Response) => {
  try {
    const dm = await getDmByCode(req.params.code);
    if (!dm) return res.status(404).send(renderDmErrorHtml('존재하지 않는 DM입니다.'));

    // 초기 추적 (phone 파라미터가 있으면)
    const phone = (req.query.p as string) || null;
    const pages = Array.isArray(dm.pages) ? dm.pages : JSON.parse(dm.pages || '[]');
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;
    trackDmView(dm.id, dm.company_id, phone, 1, pages.length, 0, ip, ua).catch(() => {});

    const html = renderDmViewerHtml(dm, '/api/dm/v');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('[DM뷰어] 오류:', err.message);
    res.status(500).send(renderDmErrorHtml('일시적 오류가 발생했습니다.'));
  }
});

// 열람 추적 API
dmPublicRouter.post('/:code/track', async (req: Request, res: Response) => {
  try {
    const dm = await getDmByCode(req.params.code);
    if (!dm) return res.status(404).json({ error: 'Not found' });

    const { phone, page_reached, total_pages, duration } = req.body;
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;

    await trackDmView(
      dm.id, dm.company_id,
      phone || null,
      page_reached || 1,
      total_pages || 0,
      duration || 0,
      ip, ua
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[DM추적] 오류:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================
//  인증 라우터 (한줄로 authenticate)
// ============================================================

export const dmRouter = Router();
dmRouter.use(authenticate);

// 이미지 업로드 (2MB, JPG/PNG/WebP)
const dmImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(ext) && allowedMime.includes(mime)) {
      cb(null, true);
    } else {
      cb(new Error('JPG, PNG, WebP 파일만 업로드 가능합니다.'));
    }
  },
});

// POST /api/dm/upload-image
dmRouter.post('/upload-image', (req: any, res: any) => {
  const upload = dmImageUpload.array('images', 5);
  upload(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '파일 크기는 2MB 이하만 가능합니다.' });
      return res.status(400).json({ error: err.message || '업로드 실패' });
    }
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: '파일이 없습니다.' });

    const companyDir = path.join(DM_IMAGE_DIR, companyId);
    if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true });

    const results: any[] = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const filename = `${uuidv4()}${ext}`;
      const filePath = path.join(companyDir, filename);
      fs.writeFileSync(filePath, file.buffer);
      results.push({
        url: `/api/dm/images/${companyId}/${filename}`,
        filename,
        size: file.size,
      });
    }
    return res.json({ success: true, images: results });
  });
});

// DELETE /api/dm/delete-image
dmRouter.delete('/delete-image', (req: any, res: any) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url 필요' });

  const m = url.match(/\/api\/dm\/images\/([^/]+)\/([^/]+)$/);
  if (!m || m[1] !== companyId) return res.status(403).json({ error: '접근 권한 없음' });

  const filePath = path.join(DM_IMAGE_DIR, m[1], m[2]);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return res.json({ success: true });
});

// GET /api/dm — 목록
dmRouter.get('/', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const list = await getDmList(companyId);
    return res.json(list);
  } catch (err: any) {
    console.error('[DM목록] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/dm — 생성
dmRouter.post('/', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 필요합니다.' });
    if (!req.body.title?.trim()) return res.status(400).json({ error: '제목을 입력해주세요.' });
    const dm = await createDm(companyId, userId, req.body);
    return res.json(dm);
  } catch (err: any) {
    console.error('[DM생성] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// GET /api/dm/:id — 상세
dmRouter.get('/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json(dm);
  } catch (err: any) {
    console.error('[DM상세] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// PUT /api/dm/:id — 수정
dmRouter.put('/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const updated = await updateDm(req.params.id, companyId, req.body);
    if (!updated) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json(updated);
  } catch (err: any) {
    console.error('[DM수정] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// DELETE /api/dm/:id — 삭제
dmRouter.delete('/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const ok = await deleteDm(req.params.id, companyId);
    if (!ok) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[DM삭제] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/dm/:id/publish — 발행
dmRouter.post('/:id/publish', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const result = await publishDm(req.params.id, companyId);
    if (!result) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json({
      short_code: result.short_code,
      short_url: `https://hanjul-flyer.kr/d/${result.short_code}`,
    });
  } catch (err: any) {
    console.error('[DM발행] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// GET /api/dm/:id/stats — 통계
dmRouter.get('/:id/stats', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const stats = await getDmStats(req.params.id, companyId);
    return res.json(stats);
  } catch (err: any) {
    console.error('[DM통계] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});
