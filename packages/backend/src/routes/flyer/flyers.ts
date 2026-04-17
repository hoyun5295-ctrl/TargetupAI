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
import { generatePdfFromHtml } from '../../utils/flyer/product/flyer-pdf';
import { renderPrintFlyer, getAvailableThemes, getThemeByName, PrintProduct } from '../../utils/flyer/product/flyer-print-renderer';
// ★ D129 인쇄전단 V2 — 2절 + Line B 신규 렌더러 + 템플릿 레지스트리 + 이미지 파이프라인
import { renderFlyerPdf } from '../../utils/flyer/product/print/renderer/paged-pdf';
import { listTemplates } from '../../utils/flyer/product/print/renderer/template-registry';
import { processProductImages } from '../../utils/flyer/product/print/pipeline/image-pipeline';
import { mapFlyerExcelHeaders, applyFlyerMapping, getFlyerMappingFields } from '../../utils/flyer/product/flyer-excel-mapper';
import { renderFlyerPage } from './short-urls';
import { renderPricePop, renderMultiPop, renderPromoPop } from '../../utils/flyer/product/flyer-pop-templates';
import { classifyProducts } from '../../utils/flyer/product/flyer-category-classifier';
import { resolveProductImageUrl } from '../../utils/product-images';

/**
 * ★ 이미지 없는 상품에 이미지 자동 매칭
 * 우선순위: ① 카탈로그 저장 이미지 → ② Pixabay 기본 이미지(PRODUCT_MAP)
 */
async function fillMissingImages(items: any[], companyId: string): Promise<void> {
  for (const item of items) {
    if (item.imageUrl || !item.name?.trim()) continue;
    try {
      // 1순위: 카탈로그에 사장님이 저장한 이미지
      const r = await query(
        `SELECT image_url FROM flyer_catalog WHERE company_id = $1 AND product_name = $2 AND image_url IS NOT NULL AND image_url != '' ORDER BY usage_count DESC LIMIT 1`,
        [companyId, item.name.trim()]
      );
      if (r.rows[0]?.image_url) { item.imageUrl = r.rows[0].image_url; continue; }
    } catch {}
    // 2순위: Pixabay 기본 이미지 (product-images PRODUCT_MAP)
    const pixabayUrl = resolveProductImageUrl(item.name);
    if (pixabayUrl) item.imageUrl = pixabayUrl;
  }
}

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
    const { userId } = req.flyerUser!;
    // ★ D120: user_id 기반 격리 — 같은 총판 내 매장별 전단 분리
    const result = await query(
      `SELECT f.*,
              TO_CHAR(f.period_start, 'YYYY-MM-DD') as period_start,
              TO_CHAR(f.period_end, 'YYYY-MM-DD') as period_end,
              s.code as short_code,
              (SELECT COUNT(*) FROM url_clicks uc JOIN short_urls su ON su.id = uc.short_url_id WHERE su.flyer_id = f.id) as click_count
       FROM flyers f
       LEFT JOIN short_urls s ON s.flyer_id = f.id
       WHERE f.company_id = $1 AND f.user_id = $2
       ORDER BY f.created_at DESC`,
      [companyId, userId]
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

    const { item, storeName, colorTheme, popTemplate } = req.body;
    if (!item || !item.name || item.salePrice == null) {
      return res.status(400).json({ error: '상품 정보(name, salePrice)가 필요합니다.' });
    }

    await fillMissingImages([item], companyId);

    const paperSize = req.body.paperSize || 'A4';
    const landscape = req.body.landscape || false;

    const html = renderPricePop(item, { storeName, colorTheme, popTemplate, paperSize, landscape });
    const pdfBuffer = await generatePdfFromHtml(html, { format: paperSize, landscape });

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

// ══════════════════════════════════════════
// POST /multi-pop — 다분할 POP PDF
// ══════════════════════════════════════════
router.post('/multi-pop', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;

    const { items, splits, storeName, colorTheme } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '상품 목록이 필요합니다.' });
    }
    const validSplits = [2, 4, 8, 16, 21, 35].includes(splits) ? splits : 4;

    const paperSize = req.body.paperSize || 'A4';
    const landscape = req.body.landscape || false;

    await fillMissingImages(items, companyId);
    const html = renderMultiPop(items, validSplits, { storeName, colorTheme, paperSize, landscape });
    const pdfBuffer = await generatePdfFromHtml(html, { format: paperSize, landscape });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="multi_pop_${validSplits}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[전단AI] 다분할 POP 실패:', err.message);
    res.status(500).json({ error: '다분할 POP 생성에 실패했습니다.' });
  }
});

// ══════════════════════════════════════════
// POST /promo-pop — 홍보POP (코너 안내판) PDF
// ══════════════════════════════════════════
router.post('/promo-pop', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;

    const { category, items, storeName, storeAddress, colorTheme } = req.body;
    if (!category || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: '카테고리명과 상품 목록이 필요합니다.' });
    }

    const html = renderPromoPop(category, items, { storeName, storeAddress, colorTheme });
    const pdfBuffer = await generatePdfFromHtml(html, { format: 'A4' });

    const safeCat = category.replace(/[^가-힣a-zA-Z0-9_-]/g, '_').slice(0, 20);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeCat)}_promo_pop.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[전단AI] 홍보POP 실패:', err.message);
    res.status(500).json({ error: '홍보POP 생성에 실패했습니다.' });
  }
});

// ══════════════════════════════════════════
// POST /:id/pop-all — 전단 전체 상품 POP 일괄 PDF
// ══════════════════════════════════════════
router.post('/:id/pop-all', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;

    const result = await query(
      `SELECT categories, store_name FROM flyers WHERE id = $1 AND company_id = $2`,
      [req.params.id, companyId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: '전단지를 찾을 수 없습니다.' });

    const cats = typeof result.rows[0].categories === 'string'
      ? JSON.parse(result.rows[0].categories)
      : (result.rows[0].categories || []);
    const sName = result.rows[0].store_name || '';

    // 모든 상품을 개별 POP으로 생성 후 연결
    const allItems: any[] = [];
    for (const cat of cats) {
      for (const item of (cat.items || [])) {
        if (item.name?.trim()) allItems.push(item);
      }
    }
    if (allItems.length === 0) return res.status(400).json({ error: '상품이 없습니다.' });

    // ★ 카탈로그 저장 이미지 우선 매칭
    await fillMissingImages(allItems, companyId);

    const { colorTheme } = req.body;
    // 8개 이하면 다분할 POP 1장, 아니면 개별 POP 연결
    if (allItems.length <= 8) {
      const splits = allItems.length <= 2 ? 2 : allItems.length <= 4 ? 4 : 8;
      const html = renderMultiPop(allItems, splits as 2 | 4 | 8, { storeName: sName, colorTheme });
      const pdfBuffer = await generatePdfFromHtml(html, { format: 'A4' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="all_pop.pdf"');
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    }

    // 8개 초과: 8개씩 다분할로 나눠서 생성
    const pages: string[] = [];
    for (let i = 0; i < allItems.length; i += 8) {
      const chunk = allItems.slice(i, i + 8);
      const splits = chunk.length <= 2 ? 2 : chunk.length <= 4 ? 4 : 8;
      pages.push(renderMultiPop(chunk, splits as 2 | 4 | 8, { storeName: sName, colorTheme }));
    }
    // 첫 페이지만 PDF로 (다중 페이지 puppeteer 제한)
    const pdfBuffer = await generatePdfFromHtml(pages[0], { format: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="all_pop.pdf"');
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[전단AI] POP 일괄 실패:', err.message);
    res.status(500).json({ error: 'POP 일괄 생성에 실패했습니다.' });
  }
});

// ══════════════════════════════════════════
// POST /:id/copy — 전단지 복사 (기존 → 새 전단)
// ══════════════════════════════════════════
router.post('/:id/copy', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const { userId } = req.flyerUser!;

    const orig = await query(
      `SELECT title, store_name, categories, template, logo_url, extra_data FROM flyers WHERE id = $1 AND company_id = $2`,
      [req.params.id, companyId]
    );
    if (orig.rows.length === 0) return res.status(404).json({ error: '원본 전단지를 찾을 수 없습니다.' });

    const o = orig.rows[0];
    const result = await query(
      `INSERT INTO flyers (company_id, user_id, title, store_name, categories, template, logo_url, extra_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [companyId, userId, `${o.title} (복사)`, o.store_name, JSON.stringify(o.categories || []),
       o.template || 'grid', o.logo_url, JSON.stringify(o.extra_data || {})]
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    console.error('[전단AI] 전단지 복사 실패:', err.message);
    res.status(500).json({ error: '전단지 복사에 실패했습니다.' });
  }
});

// ══════════════════════════════════════════
// ★ Phase 2: POST /print-flyer — 인쇄용 전단 생성 (CSV → HTML → PDF)
// ══════════════════════════════════════════
router.post('/print-flyer', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompanyId(req, res);
    if (!companyId) return;
    const userId = (req as any).flyerUser?.userId;

    const { title, period, products, paperSize, templateCode, storeName, autoRembg, autoMatchImage } = req.body;

    if (!title || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: '제목과 상품 목록이 필요합니다' });
    }

    // 매장 정보 조회
    const storeResult = await query(
      `SELECT fu.store_name, fu.business_address, fu.phone,
              fc.store_hours, fc.address as company_address
       FROM flyer_users fu
       LEFT JOIN flyer_companies fc ON fc.id = fu.company_id
       WHERE fu.id = $1`,
      [userId]
    );
    const storeInfo = storeResult.rows[0] || {};

    // ★ D129: V2 렌더러 (Paged.js + Puppeteer)
    // templateCode(프론트 전달) → templateId 매핑. 유효성 검증 후 없으면 mart_spring_v1 폴백.
    const VALID_TEMPLATES = new Set(['mart_spring_v1', 'mart_hot_v1', 'mart_premium_v1', 'mart_weekend_v1']);
    const incomingTpl = typeof templateCode === 'string' && templateCode ? templateCode : 'mart_spring_v1';
    const resolvedTemplateId = VALID_TEMPLATES.has(incomingTpl) ? incomingTpl : 'mart_spring_v1';

    const rawProducts = (products as PrintProduct[]).map(p => ({
      productName: p.productName,
      originalPrice: p.originalPrice,
      salePrice: p.salePrice,
      unit: p.unit,
      category: p.category,
      imageUrl: p.imageUrl,
      promoType: p.promoType || 'general',
      aiCopy: p.aiCopy,
      origin: p.origin,
    }));

    // ★ D129 V2 이미지 파이프라인 — 기존 자산만 재사용
    //   1) PRODUCT_MAP(getProductDisplay) → 2) 네이버 쇼핑 → 3) rembg 배경제거
    //   옵션 둘 다 false면 no-op 반환 (원본 그대로)
    const processedProducts = await processProductImages(rawProducts, {
      autoRembg: autoRembg === true,
      autoMatchImage: autoMatchImage === true,
      companyId,
    }).catch(err => {
      console.warn('[print-flyer] image-pipeline 실패, 원본 사용:', err?.message || err);
      return rawProducts;
    });

    const renderResult = await renderFlyerPdf({
      templateId: resolvedTemplateId,
      input: {
        store: {
          name: storeName || storeInfo.store_name || '',
          address: storeInfo.business_address || storeInfo.company_address || '',
          phone: storeInfo.phone || '',
          hours: storeInfo.store_hours || '',
        },
        heroTitle: title,
        slotOverrides: {
          hero_period: period ? { value: period } : undefined,
        },
        products: processedProducts,
      },
      timeoutMs: 90000,
    });
    const pdfBuffer = renderResult.pdf;
    // paperSize는 manifest가 용지(2절/A3/B4 등) 결정 → 호환성 위해 파라미터 유지만 함
    void paperSize;

    // flyers에 레코드 생성 (인쇄용)
    const flyerResult = await query(
      `INSERT INTO flyers (company_id, user_id, title, store_name, template, categories, status)
       VALUES ($1, $2, $3, $4, 'print', $5, 'print_draft')
       RETURNING id`,
      [companyId, userId, title, storeName || storeInfo.store_name || '', JSON.stringify(products)]
    );
    const flyerId = flyerResult.rows[0].id;

    // PDF 파일 저장
    const fs = require('fs');
    const path = require('path');
    const pdfDir = path.join(process.cwd(), 'uploads', 'print-flyers');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfPath = path.join(pdfDir, `${flyerId}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);

    return res.json({
      flyerId,
      pdfUrl: `/api/flyer/flyers/print-flyer/${flyerId}/pdf`,
    });
  } catch (err: any) {
    console.error('[전단AI] 인쇄 전단 생성 실패:', err.message);
    res.status(500).json({ error: '인쇄 전단 생성에 실패했습니다.' });
  }
});

// GET /print-flyer/:id/pdf — 인쇄용 PDF 다운로드
router.get('/print-flyer/:id/pdf', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const fs = require('fs');
    const path = require('path');
    const pdfPath = path.join(process.cwd(), 'uploads', 'print-flyers', `${id}.pdf`);
    if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: 'PDF를 찾을 수 없습니다' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="print-flyer-${id}.pdf"`);
    res.sendFile(pdfPath);
  } catch (err: any) {
    console.error('[전단AI] PDF 다운로드 실패:', err.message);
    res.status(500).json({ error: 'PDF 다운로드에 실패했습니다.' });
  }
});

// GET /print-flyer/themes — 사용 가능한 인쇄 테마 목록 (V1 legacy)
router.get('/print-flyer/themes', (_req: Request, res: Response) => {
  res.json(getAvailableThemes());
});

// ★ D129 GET /print-templates — V2 템플릿 목록 (mart_spring/hot/premium/weekend)
router.get('/print-templates', (_req: Request, res: Response) => {
  try {
    const all = listTemplates();
    // 프론트에 보여줄 메타 정보 보강 (한국어 라벨 + 추천 시즌 + 팔레트 hint)
    const enrich = (id: string) => {
      const base = all.find(t => t.id === id);
      if (!base) return null;
      const meta: Record<string, any> = {
        mart_spring_v1:   { label: '봄세일 (파스텔)',        mood: '부드러움',   palette: ['#4F46E5', '#FFB7D5', '#FFD33D'], recommended: '봄 · 시즌 행사' },
        mart_hot_v1:      { label: 'HOT특가 (레드핫)',       mood: '파격',      palette: ['#E8331F', '#FF8F2B', '#FFD33D'], recommended: '특가 · 파격 세일' },
        mart_premium_v1:  { label: '프리미엄 (다크+골드)',   mood: '엘레강스',   palette: ['#0B1428', '#C9A961', '#F7F3E9'], recommended: '한우 · 수입산 · 고급' },
        mart_weekend_v1:  { label: '주말대박 (일렉트릭)',    mood: '임팩트',     palette: ['#7C3AED', '#FDE047', '#EC4899'], recommended: '주말 · 금토일 한정' },
      };
      return { ...base, ...(meta[id] || {}) };
    };
    const result = all.map(t => enrich(t.id)).filter(Boolean);
    res.json(result);
  } catch (err: any) {
    console.error('[print-templates]', err);
    res.status(500).json({ error: err?.message || 'failed to list templates' });
  }
});

// ══════════════════════════════════════════
// ★ CT-F24: 엑셀 업로드 + AI 자동 매핑
// ══════════════════════════════════════════

/** POST /upload-excel — 엑셀 파일 업로드 → 헤더 추출 + AI 매핑 */
const excelUpload = multer({ dest: '/tmp/flyer-excel/', limits: { fileSize: 10 * 1024 * 1024 } });
router.post('/upload-excel', excelUpload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다' });

    const xlsx = require('xlsx');
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!jsonData || jsonData.length === 0) {
      return res.status(400).json({ error: '엑셀에 데이터가 없습니다' });
    }

    const headers = Object.keys(jsonData[0]);

    // AI 자동 매핑
    const mappingResult = await mapFlyerExcelHeaders(headers);

    // 임시 파일 삭제
    try { fs.unlinkSync(req.file.path); } catch {}

    return res.json({
      ...mappingResult,
      headers,
      preview: jsonData.slice(0, 5), // 미리보기 5행
      totalRows: jsonData.length,
      fields: getFlyerMappingFields(),
    });
  } catch (err: any) {
    console.error('[전단AI] 엑셀 업로드 실패:', err.message);
    res.status(500).json({ error: err.message || '엑셀 처리에 실패했습니다' });
  }
});

/** POST /apply-excel-mapping — 매핑 확정 → 상품 배열 반환 */
router.post('/apply-excel-mapping', excelUpload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다' });

    const mappingJson = req.body.mapping;
    if (!mappingJson) return res.status(400).json({ error: 'mapping 필수' });

    const mapping = typeof mappingJson === 'string' ? JSON.parse(mappingJson) : mappingJson;

    const xlsx = require('xlsx');
    const workbook = xlsx.readFile(req.file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const jsonData = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    const products = applyFlyerMapping(jsonData, mapping);

    try { fs.unlinkSync(req.file.path); } catch {}

    return res.json({
      success: true,
      products,
      totalRows: jsonData.length,
      mappedCount: products.length,
    });
  } catch (err: any) {
    console.error('[전단AI] 매핑 적용 실패:', err.message);
    res.status(500).json({ error: err.message || '매핑 적용에 실패했습니다' });
  }
});

/** GET /mapping-fields — 매핑 대상 필드 목록 (프론트 UI용) */
router.get('/mapping-fields', (_req: Request, res: Response) => {
  res.json(getFlyerMappingFields());
});

export default router;
