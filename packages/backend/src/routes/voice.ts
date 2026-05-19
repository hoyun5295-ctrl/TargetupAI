/**
 * ★ 인바운드 AI 음성 응답 routes — D178 (2026-05-19)
 *
 * Endpoint:
 *   - POST /api/voice/webhook         : 통신사/SIP gateway → STT 박힌 후 호출 (별도 webhook_secret 검증)
 *   - GET  /api/voice/calls           : 회사 admin 통화 이력 조회 (트랜스크립트 사후 확인)
 *   - GET  /api/voice/status          : 회사 admin 활성/비활성 + Clova 환경변수 박힘 여부
 *   - POST /api/voice/toggle          : 회사 admin 활성/비활성 토글 (default OFF)
 *
 * ⛔ 영구 원칙
 *   - webhook: 통신사가 박은 webhook_secret 박음 검증 (인프라 외부 박음, 환경변수 VOICE_WEBHOOK_SECRET)
 *   - 회사 admin endpoint: authenticate
 */

import { Router, Request, Response, json } from 'express';
import { authenticate } from '../middlewares/auth';
import {
  handleInboundCall,
  listCallsByCompany,
  setVoiceInboundEnabled,
  getVoiceInboundStatus,
} from '../utils/voice-inbound';
import { createHmac, timingSafeEqual } from 'crypto';

const router = Router();

const VOICE_WEBHOOK_SECRET = process.env.VOICE_WEBHOOK_SECRET || '';

// ════════════════════════════════════════════════════════════════════
// Webhook receiver (통신사/SIP gateway 호출, 인증 미들웨어 전)
// ════════════════════════════════════════════════════════════════════

router.post(
  '/webhook',
  json({ limit: '2mb', verify: (req: any, _res, buf) => { req.rawBody = buf; } }),
  async (req: Request, res: Response) => {
    try {
      // 통신사 webhook 서명 검증 (VOICE_WEBHOOK_SECRET 환경변수 박힌 영역)
      const signature = req.headers['x-voice-signature'] as string | undefined;
      if (VOICE_WEBHOOK_SECRET) {
        const rawBody = (req as any).rawBody || JSON.stringify(req.body);
        const computed = createHmac('sha256', VOICE_WEBHOOK_SECRET).update(rawBody).digest('hex');
        if (!signature) {
          return res.status(401).json({ success: false, error: 'X-Voice-Signature 헤더가 누락되었습니다.' });
        }
        const sigBuf = Buffer.from(signature.trim());
        const compBuf = Buffer.from(computed);
        if (sigBuf.length !== compBuf.length || !timingSafeEqual(sigBuf, compBuf)) {
          return res.status(401).json({ success: false, error: '서명 검증에 실패했습니다.' });
        }
      }

      const { company_id, caller_phone, transcript, session_id, duration_ms } = req.body;
      if (!company_id || !caller_phone || !transcript) {
        return res.status(400).json({ success: false, error: 'company_id, caller_phone, transcript는 필수입니다.' });
      }

      const result = await handleInboundCall({
        companyId: String(company_id),
        callerPhone: String(caller_phone),
        transcript: String(transcript),
        sessionId: session_id ? String(session_id) : undefined,
        durationMs: duration_ms ? Number(duration_ms) : undefined,
      });

      // 응답: 텍스트 + 통신사에 박을 영역 (audio binary는 별도 endpoint 박음 — 통신사 SIP 규약 정합)
      return res.json({
        success: true,
        call_id: result.callId,
        response_text: result.responseText,
        customer_id: result.customerId,
        // audio binary는 본 응답에 박지 X (Base64 박힌 영역 사이즈 큼) — caller가 GET /api/voice/calls/:id/audio 박음
        has_audio: !!result.responseAudio,
      });
    } catch (err: any) {
      console.error('[Voice /webhook] 오류:', err);
      const status = err?.message?.includes('비활성') || err?.message?.includes('찾을 수 없') ? 403 : 500;
      return res.status(status).json({ success: false, error: err?.message || '음성 응답 처리 실패' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// 회사 admin endpoint (authenticate)
// ════════════════════════════════════════════════════════════════════

router.use(authenticate);

router.get('/status', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const status = await getVoiceInboundStatus(companyId);
    return res.json({ success: true, ...status });
  } catch (err: any) {
    console.error('[Voice /status] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

router.post('/toggle', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '음성 AI 활성/비활성 토글은 회사 관리자만 가능합니다.' });
    }
    const { enabled } = req.body;
    await setVoiceInboundEnabled(companyId, !!enabled);
    return res.json({ success: true, enabled: !!enabled });
  } catch (err: any) {
    console.error('[Voice /toggle] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '토글 실패' });
  }
});

router.get('/calls', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 200);
    const calls = await listCallsByCompany(companyId, limit);
    return res.json({ success: true, calls });
  } catch (err: any) {
    console.error('[Voice /calls] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

export default router;
