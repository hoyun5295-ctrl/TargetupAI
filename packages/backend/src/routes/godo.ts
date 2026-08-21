/**
 * 고도몰(NHN커머스) BYO-키 연동 라우트 — 2026-06-18
 *
 * Endpoint (전부 회사 admin 인증):
 *   - POST   /api/godo/credentials : 쇼핑몰 인증키(key) 저장
 *   - POST   /api/godo/connect     : 연결 확인(1콜) + 과거 주문 백필 시작(백그라운드)
 *   - GET    /api/godo/status      : 연동 상태
 *   - DELETE /api/godo/disconnect  : 연동 해제
 *
 * 인증 2종: partner_key=한줄로 제휴사키(운영자 env GODO_PARTNER_KEY) / key=고객 쇼핑몰키(본 라우트로 저장).
 * OAuth/Webhook 없음 — key 기반 폴링이라 callback 라우터 불필요.
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { isCdpEnabledForPlan } from '../utils/cdp-auth';
import {
  saveGodoCredentials,
  getGodoCredentials,
  getGodoStatus,
  verifyGodoConnection,
  backfillGodoOrders,
  disconnectGodo,
  GodoApiError,
} from '../utils/godo-client';

const router = Router();
router.use(authenticate);

/** 회사 admin 게이트 — 통과 시 companyId 반환, 아니면 응답 전송 후 null. */
function gateAdmin(req: Request, res: Response): string | null {
  const companyId = req.user?.companyId;
  const userType = req.user?.userType;
  if (!companyId) {
    res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    return null;
  }
  if (userType !== 'company_admin') {
    res.status(403).json({ success: false, error: '고도몰 연동은 회사 관리자만 가능합니다.' });
    return null;
  }
  return companyId;
}

/** GodoApiError를 사용자 친화 상태코드로 변환. */
function sendGodoError(res: Response, err: unknown): void {
  if (err instanceof GodoApiError) {
    // 996(IP 미허용)·partner_key 미설정 = 운영자 조치 필요 → 503, 그 외 = 400
    const opsCode = err.code === '996' || err.code === 'partner_key';
    res.status(opsCode ? 503 : 400).json({ success: false, error: err.message, code: `GODO_${err.code}` });
    return;
  }
  const msg = (err as any)?.message || '';
  res.status(500).json({ success: false, error: msg || '고도몰 처리 중 오류가 발생했습니다.' });
}

/**
 * POST /api/godo/credentials
 * → 고객이 입력한 쇼핑몰 인증키(key) 저장.
 */
router.post('/credentials', async (req: Request, res: Response) => {
  try {
    const companyId = gateAdmin(req, res);
    if (!companyId) return;
    if (!(await isCdpEnabledForPlan(companyId))) {
      return res.status(403).json({ success: false, error: '고도몰 연동은 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    }
    const key = String(req.body?.key || '').trim();
    if (!key) {
      return res.status(400).json({ success: false, error: '고도몰 쇼핑몰 인증키(key)를 입력해주세요.' });
    }
    await saveGodoCredentials(companyId, key);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Godo /credentials] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '인증키 저장 실패' });
  }
});

/**
 * POST /api/godo/connect
 * → 연결 확인(최근 1일 1콜)으로 partner_key·key·IP 유효성 검증 후, 과거 주문 백필을 백그라운드로 시작.
 */
router.post('/connect', async (req: Request, res: Response) => {
  try {
    const companyId = gateAdmin(req, res);
    if (!companyId) return;
    if (!(await isCdpEnabledForPlan(companyId))) {
      return res.status(403).json({ success: false, error: '고도몰 연동은 유료 요금제 가입 후 이용 가능합니다.', code: 'PLAN_FEATURE_LOCKED' });
    }
    const creds = await getGodoCredentials(companyId);
    if (!creds?.key) {
      return res.status(400).json({ success: false, error: '먼저 쇼핑몰 인증키를 저장해주세요.' });
    }

    // 1콜 연결 확인 — 실패(키/IP/기간/partner_key)는 친화 메시지로 즉시 반환
    await verifyGodoConnection(companyId);

    // 과거 주문 백필은 시간이 걸려 백그라운드로 (요청은 즉시 응답). 실패는 로그.
    void backfillGodoOrders(companyId).catch((e) => console.error('[Godo backfill]', e));

    return res.json({ success: true, message: '연동 확인 완료. 과거 주문을 가져오는 중입니다. 잠시 후 상태를 확인해주세요.' });
  } catch (err) {
    console.error('[Godo /connect] 오류:', err);
    return sendGodoError(res, err);
  }
});

/**
 * GET /api/godo/status
 * → 연동 상태(CdpSettingsPage 표시).
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const status = await getGodoStatus(companyId);
    return res.json({ success: true, ...status });
  } catch (err: any) {
    console.error('[Godo /status] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '상태 조회 실패' });
  }
});

/**
 * DELETE /api/godo/disconnect
 * → 연동 해제(status='revoked').
 */
router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const companyId = gateAdmin(req, res);
    if (!companyId) return;
    await disconnectGodo(companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Godo /disconnect] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '연동 해제 실패' });
  }
});

export default router;
