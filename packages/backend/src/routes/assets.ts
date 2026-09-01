/**
 * routes/assets.ts — 에셋 라이브러리 API (2026-07-18 P3)
 *
 * GET    /api/assets          — 목록 + 사용량/한도 (?q= 검색)
 * POST   /api/assets/upload   — 이미지 업로드 + 자동 등재 (★2026-09-01 브랜드 편집기)
 * DELETE /api/assets/:id      — 행 삭제 (회사 admin, 실물 파일은 유지 — 발행물 참조 보호)
 *
 * cdp_assets 테이블 미생성 환경 = 503 DB_MIGRATION_PENDING (db_alter_safety_net 미러 — 500 노출 금지).
 */
import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate } from '../middlewares/auth';
import { resolveOwnerScope } from '../utils/owner-scope';
import { listAssets, deleteAsset, getStorageUsage, isAssetsTableMissing, storeAssetFile } from '../utils/assets';

export const assetsRouter = Router();
assetsRouter.use(authenticate);

// 업로드 한도·형식 = 인앱 업로드(routes/cdp.ts inappImageUpload)와 동일 규격.
// 단 이쪽은 요금제 게이트가 없다 — 브랜드 메시지 발송이 요금제 무관(발신프로필만 전제)이라
// 편집기 업로드도 같은 기준이어야 죽은 버튼이 안 생긴다. 규모 통제는 플랜별 저장 한도가 담당.
const assetImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedExts.includes(ext) && allowedMimes.includes(mime)) cb(null, true);
    else cb(new Error('이미지 파일 (jpg/png/gif/webp)만 업로드 가능합니다.'));
  },
});

function respondMigrationPending(res: Response): void {
  res.status(503).json({
    success: false,
    error: '이미지 보관함을 준비 중입니다. 잠시 후 다시 시도해 주세요.',
    code: 'DB_MIGRATION_PENDING',
  });
}

// 목록 + 사용량
assetsRouter.get('/', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const [assets, usage] = await Promise.all([listAssets(companyId, q, resolveOwnerScope(req)), getStorageUsage(companyId)]);
    return res.json({ success: true, assets, usage });
  } catch (err: any) {
    if (isAssetsTableMissing(err)) return respondMigrationPending(res);
    console.error('[assets list] 오류:', err?.message);
    return res.status(500).json({ success: false, error: '라이브러리를 불러오지 못했습니다.' });
  }
});

// 업로드 + 자동 등재 — 브랜드 편집기 등 발송 화면 공용. 응답 url은 상대 경로(공개 서빙).
assetsRouter.post('/upload', (req: any, res: Response) => {
  assetImageUpload.single('image')(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: '이미지 크기는 2MB 이하여야 합니다.' });
      }
      return res.status(400).json({ success: false, error: err.message || '이미지 업로드 실패' });
    }
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, error: '이미지 파일이 필요합니다.' });
    try {
      // 플랜별 저장 한도 — ★Codex 1R H2 수용: 조회 실패를 무시하고 저장하면(fail-open) 한도가
      // 장애 동안 무력화되고 등재 없는 고아 파일이 쌓인다. 테이블 미생성 = 503(픽커·목록과 동일 안내),
      // 그 외 조회 실패 = 500으로 물러난다. 인앱 업로드 라우트의 기존 동작은 여기서 손대지 않는다.
      try {
        const usage = await getStorageUsage(companyId);
        if (usage.usedBytes + file.size > usage.limitBytes) {
          return res.status(400).json({
            success: false,
            error: `저장 공간이 가득 찼습니다 (${(usage.usedBytes / 1024 / 1024).toFixed(0)}MB / ${(usage.limitBytes / 1024 / 1024).toFixed(0)}MB). 라이브러리에서 안 쓰는 소재를 정리하거나 플랜을 올려주세요.`,
            code: 'ASSET_STORAGE_FULL',
          });
        }
      } catch (usageErr: any) {
        if (isAssetsTableMissing(usageErr)) return respondMigrationPending(res);
        console.error('[assets upload] 용량 확인 실패:', usageErr?.message);
        return res.status(500).json({ success: false, error: '저장 공간을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.' });
      }
      const stored = await storeAssetFile({
        companyId, userId, buffer: file.buffer, originalName: file.originalname, origin: 'brand',
      });
      return res.json({ success: true, url: stored.url, filename: stored.filename, size: stored.bytes, assetId: stored.assetId });
    } catch (e: any) {
      console.error('[assets upload] 오류:', e?.message);
      return res.status(500).json({ success: false, error: '이미지를 저장하지 못했습니다.' });
    }
  });
});

// 삭제 (회사 admin만)
assetsRouter.delete('/:id', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userType = req.user?.userType;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (userType !== 'company_admin') return res.status(403).json({ success: false, error: '회사 관리자 권한이 필요합니다.' });
  try {
    const result = await deleteAsset(companyId, String(req.params.id));
    if (result.inUse) {
      return res.status(409).json({ success: false, error: '발행된 인앱 메시지가 사용 중인 소재라 삭제할 수 없습니다. 해당 메시지를 먼저 수정/보관해주세요.', code: 'ASSET_IN_USE' });
    }
    if (!result.deleted) return res.status(404).json({ success: false, error: '이미 삭제됐거나 없는 소재입니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    if (isAssetsTableMissing(err)) return respondMigrationPending(res);
    console.error('[assets delete] 오류:', err?.message);
    return res.status(500).json({ success: false, error: '삭제하지 못했습니다.' });
  }
});
