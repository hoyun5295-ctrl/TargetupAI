// ============================================================
// internal-alert.ts — D145 (2026-05-07) 시스템 알림 internal endpoint
// ============================================================
// 목적: monitor-dist.sh cron이 빌드/dist 사고 감지 시 Harold님 휴대폰으로 즉시 SMS 발송.
//
// 보안: localhost 전용 (외부 차단). IP 검증으로 인증 secret 불필요.
// 호출자: 같은 서버의 monitor-dist.sh (curl http://127.0.0.1:3000/api/internal/dist-alert)
//
// 발송 라인: SMSQ_SEND_10 (사전테스트 라인 — Harold님 결정).
// 수신: 010-5295-8517 (환경변수 ADMIN_ALERT_PHONE으로 변경 가능)
// ============================================================

import { Router, Request, Response } from 'express';
import { getTestSmsTables, bulkInsertSmsQueue } from '../utils/sms-queue';

const router = Router();

const ADMIN_PHONE = (process.env.ADMIN_ALERT_PHONE || '01052958517').replace(/\D/g, '');
const SYSTEM_CALLBACK = (process.env.SYSTEM_SMS_CALLBACK || '18008125').replace(/\D/g, '');

/**
 * 시스템 알림 SMS 발송 (localhost 전용)
 * POST /api/internal/dist-alert
 * Body: { message: string }
 *
 * 외부에서 호출 불가 (IP 127.0.0.1만 허용).
 */
router.post('/dist-alert', async (req: Request, res: Response) => {
  try {
    // 1. localhost 검증 (외부 차단)
    const ip = String(req.ip || (req.socket as any)?.remoteAddress || '');
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip.endsWith('127.0.0.1');
    if (!isLocal) {
      console.warn('[internal-alert] 외부 IP 차단:', ip);
      return res.status(403).json({ error: 'Forbidden: localhost only' });
    }

    // 2. 메시지 검증
    const rawMessage = String(req.body?.message || '').trim();
    if (!rawMessage) {
      return res.status(400).json({ error: 'message required' });
    }
    const message = rawMessage.slice(0, 1500); // LMS 안전 한도

    // 3. 발송 라인 (사전테스트 = SMSQ_SEND_10)
    const tables = await getTestSmsTables();
    if (!tables || tables.length === 0) {
      console.error('[internal-alert] 테스트 SMS 라인 없음');
      return res.status(500).json({ error: 'no test sms tables configured' });
    }

    // 4. 메시지 본문 (LMS — 길이 안전)
    const ts = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const fullMsg = `[한줄로AI 시스템 알림]\n${ts}\n\n${message}\n\n즉시 SSH 확인 필요`;

    // 5. SMS row (msg_type='L' = LMS, title_str 필수)
    const row = [
      ADMIN_PHONE,                  // dest_no
      SYSTEM_CALLBACK,              // call_back
      fullMsg,                      // msg_contents
      'L',                          // msg_type (LMS)
      '한줄로AI 시스템 알림',       // title_str
      null,                         // sendTime (useNow=true로 무시)
      'system-dist-alert',          // app_etc1
      null,                         // app_etc2
      null,                         // file_name1
      null,                         // file_name2
      null,                         // file_name3
    ];

    // 6. 큐 INSERT (즉시발송)
    const sent = await bulkInsertSmsQueue(tables, [row], true);
    if (sent > 0) {
      console.log(`[internal-alert] 시스템 알림 발송 완료 → ${ADMIN_PHONE} (${sent}건)`);
      return res.json({ success: true, sentCount: sent });
    }
    return res.status(500).json({ error: 'sms insert returned 0' });
  } catch (err: any) {
    console.error('[internal-alert] dist-alert 에러:', err?.message || err);
    return res.status(500).json({ error: 'internal error' });
  }
});

export default router;
