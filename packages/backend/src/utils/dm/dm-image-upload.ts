/**
 * dm-image-upload.ts — 편집기 사진 업로드 처리기(★ 2026-10-19 B-1017-1④ · routes/dm.ts 에서 옮김 · 동작 그대로)
 *
 * 저장 = uploads/dm-images/{회사}/{uuid}.{ext} · 주소 = /api/dm/v/images/{회사}/{파일}(공개 서빙 · DM · 이메일 공용).
 * 입구는 둘 = /api/dm/upload-image(모바일 DM 요금제 문) · /api/email/upload-image(이메일 요금제 문).
 * 옛: 이메일 편집기도 DM 입구를 써서 이메일만 쓰는 요금제 회사는 편집기에서 사진을 못 올렸다.
 */
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

export const DM_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'dm-images');

const dmImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
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

/** POST 업로드 처리기 — 회사 권한 · 요금제 문은 부르는 입구가 먼저 본다 */
export function handleDmImageUpload(req: any, res: any): void {
  const upload = dmImageUpload.array('images', 5);
  upload(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '파일 크기는 5MB 이하만 가능합니다.' });
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
        // ★ 2026-06-14 fix: 실제 서빙 경로(dmPublicRouter /api/dm/v/images)로 반환 — 기존 flyer 경로는 서빙 라우트 없어 캔버스/editor 이미지 전부 깨짐
        url: `/api/dm/v/images/${companyId}/${filename}`,
        filename,
        size: file.size,
      });
    }
    return res.json({ success: true, images: results });
  });
}
