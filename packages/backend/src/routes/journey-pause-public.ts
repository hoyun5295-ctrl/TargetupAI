// packages/backend/src/routes/journey-pause-public.ts
// D218+ (2026-05-26) Public 정지 페이지 endpoint
//   GET  /journey-pause/:token — 토큰 검증 + 정지 정보 반환 (인증 X)
//   POST /journey-pause/:token — 정지 실행 (인증 X)
// Harold 명시 — 사용자 친화 우선 (인증 X) + race condition 안전망 + 기록 보존

import express, { Request, Response } from 'express';
import { verifyPauseToken, executePause } from '../utils/journey-pause-handler';
import { query } from '../config/database';

const router = express.Router();

// GET /journey-pause/:token — 토큰 검증 + 정지 정보 반환
router.get('/journey-pause/:token', async (req: Request, res: Response) => {
  try {
    const payload = await verifyPauseToken(req.params.token);
    if (!payload) {
      return res.status(404).json({ success: false, error: 'token_invalid_or_expired' });
    }

    // snapshot + 발송 정보 반환 (Frontend 미리보기)
    const snapRes = await query(
      `SELECT s.message_body, s.message_subject, s.channel, s.confidence_score,
              j.name AS journey_name, jstep.step_order
         FROM journey_step_snapshots s
         JOIN journeys j ON j.id = s.journey_id
         JOIN journey_steps jstep ON jstep.id = s.step_id
        WHERE s.step_id = $1 AND s.journey_id = $2
        ORDER BY s.created_at DESC LIMIT 1`,
      [payload.step_id, payload.journey_id],
    );
    if (snapRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'snapshot_not_found' });
    }

    const snap = snapRes.rows[0];
    return res.json({
      success: true,
      journey_name: snap.journey_name,
      step_order: snap.step_order,
      channel: snap.channel,
      message_subject: snap.message_subject,
      message_body: snap.message_body,
      confidence_score: snap.confidence_score,
    });
  } catch (err: any) {
    console.error('[journey-pause GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// POST /journey-pause/:token — 정지 실행
router.post('/journey-pause/:token', async (req: Request, res: Response) => {
  try {
    const pausedPhone = String(req.body?.paused_phone || '').replace(/\D/g, '');
    const result = await executePause(req.params.token, pausedPhone, 'manager_link');
    if (!result.ok) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[journey-pause POST] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '정지 실패' });
  }
});

export default router;
