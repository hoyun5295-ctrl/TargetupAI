import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// MMS 이미지 저장 경로 (환경변수 또는 기본값)
const MMS_IMAGE_BASE = process.env.MMS_IMAGE_PATH || path.resolve('./uploads/mms');

// JWT 인증 미들웨어 (기존 auth 미들웨어와 동일한 방식)
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '인증 필요' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: '인증 만료' });
  }
}

// multer 설정: 메모리에 임시 저장 후 검증 → 디스크 저장
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 300 * 1024, // 300KB 제한
    files: 3,             // 최대 3개
  },
  fileFilter: (req, file, cb) => {
    // JPG/JPEG만 허용
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    if ((ext === '.jpg' || ext === '.jpeg') && (mime === 'image/jpeg' || mime === 'image/jpg')) {
      cb(null, true);
    } else {
      cb(new Error('JPG 파일만 업로드 가능합니다. (PNG, GIF 등은 이통사에서 거절될 수 있습니다)'));
    }
  },
});

// ─────────────────────────────────────────
// POST /api/mms-images/upload — MMS 이미지 업로드 (최대 3장)
// ─────────────────────────────────────────
router.post('/upload', authMiddleware, (req: any, res: any) => {
  const uploadHandler = upload.array('images', 3);

  uploadHandler(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '이미지 크기는 300KB 이하여야 합니다' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: '이미지는 최대 3개까지 첨부 가능합니다' });
      }
      return res.status(400).json({ error: err.message || '이미지 업로드 실패' });
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: '이미지 파일을 선택해주세요' });
    }

    const companyId = req.user.companyId;
    if (!companyId) {
      return res.status(400).json({ error: '회사 정보를 찾을 수 없습니다' });
    }

    try {
      // 회사별 디렉토리 생성
      const companyDir = path.join(MMS_IMAGE_BASE, companyId);
      if (!fs.existsSync(companyDir)) {
        fs.mkdirSync(companyDir, { recursive: true });
      }

      const results: { serverPath: string; url: string; filename: string; size: number }[] = [];

      for (const file of files) {
        // 파일 크기 재검증 (안전장치)
        if (file.size > 300 * 1024) {
          return res.status(400).json({ error: `${file.originalname}: 300KB 초과 (${(file.size / 1024).toFixed(0)}KB)` });
        }

        // 고유 파일명 생성
        const filename = `${uuidv4()}.jpg`;
        const filePath = path.join(companyDir, filename);

        // 디스크에 저장
        fs.writeFileSync(filePath, file.buffer);

        // 절대경로 (QTmsg Agent가 접근할 경로)
        const absolutePath = path.resolve(filePath);

        results.push({
          serverPath: absolutePath,
          url: `/api/mms-images/${companyId}/${filename}`,
          filename: filename,
          size: file.size,
        });
      }

      console.log(`[MMS] 이미지 ${results.length}개 업로드 완료 (company: ${companyId})`);

      return res.json({
        success: true,
        images: results,
      });
    } catch (error) {
      console.error('[MMS] 이미지 업로드 실패:', error);
      return res.status(500).json({ error: '이미지 업로드 중 오류가 발생했습니다' });
    }
  });
});

// ─────────────────────────────────────────
// GET /api/mms-images/:companyId/:filename — 이미지 서빙 (미리보기용)
// ─────────────────────────────────────────
router.get('/:companyId/:filename', (req: any, res: any) => {
  const { companyId, filename } = req.params;

  // 보안: 경로 탈출 방지
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: '잘못된 파일명' });
  }

  const filePath = path.join(MMS_IMAGE_BASE, companyId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '이미지를 찾을 수 없습니다' });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.resolve(filePath));
});

// ─────────────────────────────────────────
// DELETE /api/mms-images/:companyId/:filename — 이미지 삭제
// ─────────────────────────────────────────
router.delete('/:companyId/:filename', authMiddleware, (req: any, res: any) => {
  const { companyId, filename } = req.params;

  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).json({ error: '잘못된 파일명' });
  }

  if (req.user.companyId !== companyId && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: '접근 권한 없음' });
  }

  const filePath = path.join(MMS_IMAGE_BASE, companyId, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`[MMS] 이미지 삭제: ${filePath}`);
  }

  return res.json({ success: true });
});

export default router;
