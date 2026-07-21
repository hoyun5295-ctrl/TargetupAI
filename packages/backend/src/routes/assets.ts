/**
 * routes/assets.ts — 에셋 라이브러리 API (2026-07-18 P3)
 *
 * GET    /api/assets          — 목록 + 사용량/한도 (?q= 검색)
 * DELETE /api/assets/:id      — 행 삭제 (회사 admin, 실물 파일은 유지 — 발행물 참조 보호)
 *
 * cdp_assets 테이블 미생성 환경 = 503 DB_MIGRATION_PENDING (db_alter_safety_net 미러 — 500 노출 금지).
 */
import { Router, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { resolveOwnerScope } from '../utils/owner-scope';
import { listAssets, deleteAsset, getStorageUsage, isAssetsTableMissing } from '../utils/assets';

export const assetsRouter = Router();
assetsRouter.use(authenticate);

function respondMigrationPending(res: Response): void {
  res.status(503).json({
    success: false,
    error: 'DB 마이그레이션 필요 — 운영자에게 cdp_assets 테이블 생성 실행 요청 의무',
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
