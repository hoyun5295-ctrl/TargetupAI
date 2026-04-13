/**
 * ★ 전단AI: 전단지 CRUD API
 *
 * 마운트: /api/flyer/flyers
 * 권한: flyer_admin + flyer_staff (flyerAuthenticate 미들웨어)
 * ★ D112: 한줄로 authenticate → flyerAuthenticate 전환. store-scope 제거(전단AI는 회사 단위).
 */

import { Request, Response, Router } from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../config/database';
import { flyerAuthenticate } from '../../middlewares/flyer-auth';
// ★ D112: getStoreScope 제거. 전단AI는 store_code 없이 company_id 단위 격리.
import { generateProductImage, generateFlyerImages, getGeneratedImageUrl } from '../../utils/product-images';
import { LIMITS } from '../../config/defaults';
import { generatePdfFromHtml } from '../../utils/flyer/flyer-pdf';
import { renderFlyerPage } from './short-urls';
import { renderPricePop } from '../../utils/flyer/flyer-pop-templates';
import { classifyProducts } from '../../utils/flyer/flyer-category-classifier';

const PRODUCT_IMAGE_DIR = process.env.PRODUCT_IMAGE_PATH || path.resolve('./uploads/product-images');
const FLYER_PRODUCT_DIR = process.env.FLYER_PRODUCT_PATH || path.resolve('./uploads/flyer-products');

// ★ 전단AI 전용 MMS 이미지 저장 경로 (한줄로 uploads/mms/와 완전 분리)
const FLYER_MMS_DIR = process.env.FLYER_MMS_PATH || path.resolve('./uploads/flyer-mms');

// 상품 이미지 업로드용 multer 설정 (MMS 패턴 따라감)
const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 }, // 1MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext) &&
        ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mime)) {
      cb(null, true);
    } else {
      cb(new Error('JPG, PNG, WebP 이미지만 업로드 가능합니다.'));
    }
  },
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();

// ══════════════════════════════════════════
// 인증 불필요 (공개 엔드포인트 — authenticate 위에 배치)
// ══════════════════════════════════════════

// GET /flyer-products/:companyId/:filename — 직접 업로드 상품 이미지 서빙 (공개)
router.get('/flyer-products/:companyId/:filename', (req: Request, res: Response) => {
  try {
    const { companyId, filename } = req.params;
    if (!UUID_REGEX.test(companyId)) return res.status(400).json({ error: '잘못된 요청' });
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '잘못된 파일명' });
    }

    const filePath = path.join(FLYER_PRODUCT_DIR, companyId, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
    }

    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    res.setHeader('Content-Type', mimeMap[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: '이미지 로드 실패' });
  }
});

// GET /product-images/:filename — DALL-E/PRODUCT_MAP 기본 이미지 서빙 (공개)
router.get('/product-images/:filename', (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    // ★ D100: jpg/png 양쪽 지원 (Pixabay 이미지는 jpg)
    const decodedFilename = decodeURIComponent(filename);
    const filePath = path.join(PRODUCT_IMAGE_DIR, decodedFilename);

    if (!fs.existsSync(filePath)) {
      // 인코딩된 파일명으로 재시도
      const encodedFilename = encodeURIComponent(decodedFilename);
      const filePath2 = path.join(PRODUCT_IMAGE_DIR, encodedFilename);
      if (!fs.existsSync(filePath2)) {
        return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
      }
      const ext2 = path.extname(encodedFilename).toLowerCase();
      const mimeMap2: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
      res.setHeader('Content-Type', mimeMap2[ext2] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(filePath2).pipe(res);
    }

    const ext = path.extname(decodedFilename).toLowerCase();
    const mimeMap3: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    res.setHeader('Content-Type', mimeMap3[ext] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: '이미지 로드 실패' });
  }
});

// ============================================================
// GET /flyer-mms/:companyId/:filename — 전단AI MMS 이미지 서빙 (공개 — 미리보기용)
// ★ 한줄로 uploads/mms/와 완전 분리된 경로 (uploads/flyer-mms/)
// ============================================================
router.get('/flyer-mms/:companyId/:filename', (req: Request, res: Response) => {
  const { companyId, filename } = req.params;
  if (!UUID_REGEX.test(companyId)) return res.status(400).json({ error: '잘못된 요청' });
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: '잘못된 파일명' });
  }
  const filePath = path.join(FLYER_MMS_DIR, companyId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '이미지를 찾을 수 없습니다' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.resolve(filePath));
});

// ══════════════════════════════════════════
// 이하 모든 라우트는 인증 필요
// ══════════════════════════════════════════
router.use(flyerAuthenticate);

// ============================================================
// ★ 전단AI 전용 MMS 이미지 업로드 (한줄로 MMS 보관함과 완전 분리)
// POST /mms-upload — 최대 3장, JPG만, 300KB 이하
// 저장 경로: uploads/flyer-mms/{companyId}/
// ============================================================
const flyerMmsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: LIMITS.mmsImageSize, files: LIMITS.mmsImageCount },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if ((ext === '.jpg' || ext === '.jpeg') && (mime === 'image/jpeg' || mime === 'image/jpg')) {
      cb(null, true);
    } else {
      cb(new Error('JPG 파일만 업로드 가능합니다.'));
    }
  },
});

router.post('/mms-upload', (req: any, res: any) => {
  const uploadHandler = flyerMmsUpload.array('images', 3);
  uploadHandler(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '이미지 크기는 300KB 이하여야 합니다' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: '이미지는 최대 3개까지 첨부 가능합니다' });
      return res.status(400).json({ error: err.message || '이미지 업로드 실패' });
    }
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: '이미지 파일을 선택해주세요' });

    const companyId = req.flyerUser!.companyId;
    if (!companyId) return res.status(400).json({ error: '회사 정보를 찾을 수 없습니다' });

    try {
      const companyDir = path.join(FLYER_MMS_DIR, companyId);
      if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true });

      const results: { serverPath: string; url: string; filename: string; size: number }[] = [];
      for (const file of files) {
        if (file.size > LIMITS.mmsImageSize) {
          return res.status(400).json({ error: `${file.originalname}: 300KB 초과 (${(file.size / 1024).toFixed(0)}KB)` });
        }
        const filename = `${uuidv4()}.jpg`;
        const filePath = path.join(companyDir, filename);
        fs.writeFileSync(filePath, file.buffer);
        results.push({
          serverPath: path.resolve(filePath),
          url: `/api/flyer/flyers/flyer-mms/${companyId}/${filename}`,
          filename,
          size: file.size,
        });
      }
      console.log(`[전단AI MMS] 이미지 ${results.length}개 업로드 완료 (company: ${companyId})`);
      return res.json({ success: true, images: results });
    } catch (error) {
      console.error('[전단AI MMS] 이미지 업로드 실패:', error);
      return res.status(500).json({ error: '이미지 업로드 중 오류가 발생했습니다' });
    }
  });
});

// DELETE /mms-image — 전단AI MMS 이미지 삭제
router.delete('/mms-image', (req: any, res: any) => {
  const { serverPath } = req.body;
  if (!serverPath || typeof serverPath !== 'string') return res.status(400).json({ error: '삭제할 이미지 경로가 필요합니다' });

  // 보안: flyer-mms 디렉토리 내의 파일만 삭제 허용
  const resolved = path.resolve(serverPath);
  const mmsBase = path.resolve(FLYER_MMS_DIR);
  if (!resolved.startsWith(mmsBase)) return res.status(403).json({ error: '접근 권한 없음' });

  if (fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
    console.log(`[전단AI MMS] 이미지 삭제: ${resolved}`);
  }
  return res.json({ success: true });
});

// ============================================================
// POST /product-image — 상품 이미지 업로드 (1장)
// ⚠️ /:id 라우트보다 앞에 배치
// ============================================================
router.post('/product-image', (req: Request, res: Response) => {
  const uploadHandler = productImageUpload.single('image');

  uploadHandler(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '이미지 크기는 1MB 이하여야 합니다.' });
      }
      return res.status(400).json({ error: err.message || '이미지 업로드 실패' });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: '이미지 파일을 선택해주세요.' });
    }

    const companyId = req.flyerUser?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '회사 정보가 없습니다.' });
    }

    try {
      const companyDir = path.join(FLYER_PRODUCT_DIR, companyId);
      if (!fs.existsSync(companyDir)) {
        fs.mkdirSync(companyDir, { recursive: true });
      }

      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const filename = `${uuidv4()}${ext}`;
      const filePath = path.join(companyDir, filename);

      fs.writeFileSync(filePath, file.buffer);

      const url = `/api/flyer/flyers/flyer-products/${companyId}/${filename}`;
      console.log(`[전단AI] 상품 이미지 업로드: ${file.originalname} → ${filename}`);

      return res.json({ url, filename, size: file.size });
    } catch (error: any) {
      console.error('[전단AI] 상품 이미지 업로드 실패:', error.message);
      return res.status(500).json({ error: '이미지 업로드 중 오류가 발생했습니다.' });
    }
  });
});

// ============================================================
// DELETE /product-image — 상품 이미지 삭제
// ============================================================
router.delete('/product-image', async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 정보가 없습니다.' });

    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: '삭제할 이미지 URL이 필요합니다.' });
    }

    // URL에서 파일 경로 추출: /api/flyer/flyers/flyer-products/{companyId}/{filename}
    const match = url.match(/\/flyer-products\/([^/]+)\/([^/]+)$/);
    if (!match || match[1] !== companyId) {
      return res.status(403).json({ error: '권한이 없습니다.' });
    }

    const filename = match[2];
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '잘못된 파일명' });
    }

    const filePath = path.join(FLYER_PRODUCT_DIR, companyId, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[전단AI] 상품 이미지 삭제: ${filename}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[전단AI] 상품 이미지 삭제 실패:', err.message);
    res.status(500).json({ error: '이미지 삭제에 실패했습니다.' });
  }
});

// ── 단축URL 코드 생성 (nanoid 대신 crypto) ──
function generateShortCode(length = 7): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

// ── company_id 필수 체크 ──
// ★ D112: req.flyerUser 기반으로 전환. req.user 미사용.
function requireCompanyId(req: Request, res: Response): string | null {
  const companyId = req.flyerUser?.companyId;
  if (!companyId) {
    res.status(403).json({ error: '회사 정보가 없습니다.' });
    return null;
  }
  return companyId;
}

// ★ D112: store-scope 제거. 전단AI는 company_id 단위 격리만 사용.
// 기존 applyStoreScope 호출부는 no-op으로 처리.

// ============================================================
// POST / — 전단지 생성
// ============================================================
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { userId } = req.flyerUser!;
    const { title, store_name, period_start, period_end, categories, template, logo_url, store_code, extra_data } = req.body;

    if (!title) {
      return res.status(400).json({ error: '행사명(title)은 필수입니다.' });
    }

    const result = await query(
      `INSERT INTO flyers (company_id, user_id, store_code, title, store_name, period_start, period_end, categories, template, logo_url, extra_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [companyId, userId, store_code || null, title, store_name || null, period_start || null, period_end || null,
       JSON.stringify(categories || []), template || 'grid', logo_url || null, JSON.stringify(extra_data || {})]
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[전단AI] 전단지 생성 실패:', err.message);
    res.status(500).json({ error: '전단지 생성에 실패했습니다.' });
  }
});

// ============================================================
// GET / — 전단지 목록 조회
// ============================================================
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    // ★ D112: store-scope 제거. company_id만으로 격리.
    const result = await query(
      `SELECT f.*,
              TO_CHAR(f.period_start, 'YYYY-MM-DD') as period_start,
              TO_CHAR(f.period_end, 'YYYY-MM-DD') as period_end,
              s.code as short_code,
              (SELECT COUNT(*) FROM url_clicks uc JOIN short_urls su ON su.id = uc.short_url_id WHERE su.flyer_id = f.id) as click_count
       FROM flyers f
       LEFT JOIN short_urls s ON s.flyer_id = f.id
       WHERE f.company_id = $1
       ORDER BY f.created_at DESC`,
      [companyId]
    );

    res.json(result.rows);
  } catch (err: any) {
    console.error('[전단AI] 전단지 목록 조회 실패:', err.message);
    res.status(500).json({ error: '전단지 목록 조회에 실패했습니다.' });
  }
});

// ============================================================
// POST /generate-images — 전단지 상품 이미지 일괄 생성 (DALL-E 3)
// ⚠️ /:id 라우트보다 앞에 위치해야 Express가 올바르게 매칭
// ============================================================
router.post('/generate-images', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;

    const { categories } = req.body;
    if (!categories || !Array.isArray(categories)) {
      return res.status(400).json({ error: '카테고리 정보가 필요합니다.' });
    }

    // 즉시 응답 (백그라운드 생성)
    res.json({ status: 'generating', message: '이미지 생성이 시작되었습니다. 잠시 후 자동으로 반영됩니다.' });

    // 백그라운드에서 이미지 생성
    generateFlyerImages(categories).then(results => {
      const count = Object.keys(results).length;
      console.log(`[전단AI] 이미지 일괄 생성 완료: ${count}개 상품`);
    }).catch(err => {
      console.error('[전단AI] 이미지 일괄 생성 실패:', err.message);
    });
  } catch (err: any) {
    console.error('[전단AI] 이미지 생성 요청 실패:', err.message);
    res.status(500).json({ error: '이미지 생성에 실패했습니다.' });
  }
});

// ============================================================
// POST /generate-image — 단일 상품 이미지 생성 (DALL-E 3)
// ============================================================
router.post('/generate-image', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;

    const { productName } = req.body;
    if (!productName) {
      return res.status(400).json({ error: '상품명이 필요합니다.' });
    }

    // 이미 생성된 이미지가 있으면 즉시 반환
    const existing = getGeneratedImageUrl(productName);
    if (existing) {
      return res.json({ imageUrl: existing, cached: true });
    }

    // DALL-E 생성
    const filePath = await generateProductImage(productName);
    if (filePath) {
      const imageUrl = `/api/flyer/flyers/product-images/${encodeURIComponent(productName)}.png`;
      return res.json({ imageUrl, cached: false });
    }

    res.json({ imageUrl: null, error: '이미지 생성에 실패했습니다.' });
  } catch (err: any) {
    console.error('[전단AI] 단일 이미지 생성 실패:', err.message);
    res.status(500).json({ error: '이미지 생성에 실패했습니다.' });
  }
});

// (product-images 서빙은 authenticate 위로 이동됨 — 공개 접근 필요)

// ============================================================
// GET /product-image-status — 상품별 이미지 생성 상태 조회
// ============================================================
router.get('/product-image-status', async (req: Request, res: Response) => {
  try {
    const names = (req.query.names as string || '').split(',').filter(Boolean);
    const status: Record<string, string | null> = {};
    for (const name of names) {
      status[name] = getGeneratedImageUrl(name);
    }
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: '상태 조회 실패' });
  }
});

// ============================================================
// GET /:id — 전단지 상세 조회
// ============================================================
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    const result = await query(
      `SELECT f.*,
              TO_CHAR(f.period_start, 'YYYY-MM-DD') as period_start,
              TO_CHAR(f.period_end, 'YYYY-MM-DD') as period_end,
              s.code as short_code,
              (SELECT COUNT(*) FROM url_clicks uc JOIN short_urls su ON su.id = uc.short_url_id WHERE su.flyer_id = f.id) as click_count
       FROM flyers f
       LEFT JOIN short_urls s ON s.flyer_id = f.id
       WHERE f.id = $1 AND f.company_id = $2`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[전단AI] 전단지 상세 조회 실패:', err.message);
    res.status(500).json({ error: '전단지 상세 조회에 실패했습니다.' });
  }
});

// ============================================================
// PUT /:id — 전단지 수정
// ============================================================
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;
    const { title, store_name, period_start, period_end, categories, template, logo_url, extra_data } = req.body;

    const existing = await query('SELECT id, status FROM flyers WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    const result = await query(
      `UPDATE flyers SET
        title = COALESCE($3, title),
        store_name = COALESCE($4, store_name),
        period_start = COALESCE($5, period_start),
        period_end = COALESCE($6, period_end),
        categories = COALESCE($7, categories),
        template = COALESCE($8, template),
        logo_url = COALESCE($9, logo_url),
        extra_data = COALESCE($10, extra_data),
        updated_at = now()
       WHERE id = $1 AND company_id = $2
       RETURNING *`,
      [id, companyId, title || null, store_name || null, period_start || null, period_end || null,
       categories ? JSON.stringify(categories) : null, template || null, logo_url || null,
       extra_data ? JSON.stringify(extra_data) : null]
    );

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[전단AI] 전단지 수정 실패:', err.message);
    res.status(500).json({ error: '전단지 수정에 실패했습니다.' });
  }
});

// ============================================================
// DELETE /:id — 전단지 삭제
// ============================================================
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    // 연관 데이터 삭제 (클릭 로그 → 단축URL → 전단지)
    await query(
      `DELETE FROM url_clicks WHERE short_url_id IN (SELECT id FROM short_urls WHERE flyer_id = $1 AND company_id = $2)`,
      [id, companyId]
    );
    await query('DELETE FROM short_urls WHERE flyer_id = $1 AND company_id = $2', [id, companyId]);
    const result = await query('DELETE FROM flyers WHERE id = $1 AND company_id = $2 RETURNING id', [id, companyId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[전단AI] 전단지 삭제 실패:', err.message);
    res.status(500).json({ error: '전단지 삭제에 실패했습니다.' });
  }
});

// ============================================================
// POST /:id/publish — 전단지 발행 (단축URL 발급)
// ============================================================
router.post('/:id/publish', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    const flyer = await query('SELECT id, status FROM flyers WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (flyer.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    // 이미 단축URL이 있으면 반환
    const existingUrl = await query('SELECT code FROM short_urls WHERE flyer_id = $1', [id]);
    if (existingUrl.rows.length > 0) {
      await query("UPDATE flyers SET status = 'published', updated_at = now() WHERE id = $1", [id]);
      return res.json({
        short_code: existingUrl.rows[0].code,
        short_url: `https://hanjul-flyer.kr/${existingUrl.rows[0].code}`
      });
    }

    // 단축URL 코드 생성 (충돌 시 재시도)
    let code: string;
    let attempts = 0;
    do {
      code = generateShortCode();
      const dup = await query('SELECT id FROM short_urls WHERE code = $1', [code]);
      if (dup.rows.length === 0) break;
      attempts++;
    } while (attempts < 10);

    if (attempts >= 10) {
      return res.status(500).json({ error: '단축URL 생성에 실패했습니다. 다시 시도해주세요.' });
    }

    // 90일 만료
    await query(
      `INSERT INTO short_urls (code, flyer_id, company_id, expires_at)
       VALUES ($1, $2, $3, now() + interval '90 days')`,
      [code, id, companyId]
    );

    await query("UPDATE flyers SET status = 'published', updated_at = now() WHERE id = $1", [id]);

    res.json({
      short_code: code,
      short_url: `https://hanjul-flyer.kr/${code}`
    });
  } catch (err: any) {
    console.error('[전단AI] 전단지 발행 실패:', err.message);
    res.status(500).json({ error: '전단지 발행에 실패했습니다.' });
  }
});

// ============================================================
// GET /:id/stats — 클릭 통계
// ============================================================
router.get('/:id/stats', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    // 전단지 존재 확인
    const flyer = await query('SELECT id FROM flyers WHERE id = $1 AND company_id = $2', [id, companyId]);
    if (flyer.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    // 총 클릭수
    const total = await query(
      `SELECT COUNT(*) as total_clicks
       FROM url_clicks uc
       JOIN short_urls su ON su.id = uc.short_url_id
       WHERE su.flyer_id = $1`,
      [id]
    );

    // 일별 클릭수 (최근 30일)
    const daily = await query(
      `SELECT DATE(uc.clicked_at AT TIME ZONE 'Asia/Seoul') as date, COUNT(*) as clicks
       FROM url_clicks uc
       JOIN short_urls su ON su.id = uc.short_url_id
       WHERE su.flyer_id = $1 AND uc.clicked_at >= now() - interval '30 days'
       GROUP BY date ORDER BY date DESC`,
      [id]
    );

    res.json({
      total_clicks: parseInt(total.rows[0].total_clicks),
      daily_clicks: daily.rows
    });
  } catch (err: any) {
    console.error('[전단AI] 클릭 통계 조회 실패:', err.message);
    res.status(500).json({ error: '클릭 통계 조회에 실패했습니다.' });
  }
});

// ══════════════════════════════════════════
// POST /:id/pdf — 전단지 PDF 다운로드
// ══════════════════════════════════════════
router.post('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { id } = req.params;

    // 전단지 조회 (short-urls.ts와 동일한 데이터 형식)
    const result = await query(
      `SELECT f.*,
              TO_CHAR(f.period_start, 'YYYY-MM-DD') as period_start,
              TO_CHAR(f.period_end, 'YYYY-MM-DD') as period_end
       FROM flyers f
       WHERE f.id = $1 AND f.company_id = $2`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });
    }

    const flyer = result.rows[0];

    // HTML 렌더링 (공개 페이지와 동일)
    const html = await renderFlyerPage(flyer);

    // PDF 변환
    const pdfBuffer = await generatePdfFromHtml(html, {
      format: 'A4',
    });

    const safeName = (flyer.title || 'flyer').replace(/[^가-힣a-zA-Z0-9_-]/g, '_').slice(0, 50);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[전단AI] PDF 생성 실패:', err.message);
    res.status(500).json({ error: 'PDF 생성에 실패했습니다.' });
  }
});

// ══════════════════════════════════════════
// POST /classify-products — 상품 자동 카테고리 분류
// ══════════════════════════════════════════
router.post('/classify-products', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;

    const { items, business_type } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '상품 목록이 필요합니다.' });
    }

    const classified = await classifyProducts(
      items.map((it: any) => ({ name: String(it.name || '').trim() })).filter((it: any) => it.name),
      business_type || 'mart',
      companyId
    );

    return res.json({ classified });
  } catch (err: any) {
    console.error('[전단AI] 자동 분류 실패:', err.message);
    return res.status(500).json({ error: '자동 분류에 실패했습니다.' });
  }
});

// ══════════════════════════════════════════
// POST /pop-pdf — 상품 1개 가격POP PDF 다운로드
// ══════════════════════════════════════════
router.post('/pop-pdf', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;

    const { item, storeName, colorTheme } = req.body;
    if (!item || !item.name || item.salePrice == null) {
      return res.status(400).json({ error: '상품 정보(name, salePrice)가 필요합니다.' });
    }

    const html = renderPricePop(item, { storeName, colorTheme });
    const pdfBuffer = await generatePdfFromHtml(html, { format: 'A4' });

    const safeName = (item.name || 'pop').replace(/[^가-힣a-zA-Z0-9_-]/g, '_').slice(0, 30);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}_POP.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[전단AI] POP PDF 생성 실패:', err.message);
    res.status(500).json({ error: 'POP PDF 생성에 실패했습니다.' });
  }
});

export default router;
