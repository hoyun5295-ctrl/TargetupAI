/**
 * ★ 2026-11-14 C133 F5 답장 상담 — 수신 입구(통신 배선이 들어온 문자 한 건을 넘기는 자리 · 로그인 없음)
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §7-2 · §18 「배포 D」 흐름 표 1 ~ 4)
 *
 * 열쇠 = 머리 x-inbound-key 가 ENV INBOUND_SMS_KEY 와 같을 때만(길이가 같고 timingSafeEqual). ENV 가 비어 있으면 이 주소는 없다(404).
 * 하는 일 = 저장뿐(utils/inbound-sms receiveInbound) — 회사 정하기 · 판정 · 답장은 그 CT 와 워커가 한다.
 * 표가 없으면(DDL 전) 503 DB_MIGRATION_PENDING.
 */
import { Router, Request, Response } from 'express';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { respondUserError } from '../utils/http-error';
import { receiveInbound } from '../utils/inbound-sms';
import { inboundKeyMatches } from '../utils/inbound-sms-rules';

const router = Router();

// POST /receive — 들어온 문자 한 건 { from, to, text, receivedAt, providerMsgId }
router.post('/receive', async (req: Request, res: Response) => {
  const expected = String(process.env.INBOUND_SMS_KEY || '');
  if (!expected) return res.status(404).json({ success: false });
  if (!inboundKeyMatches(req.headers['x-inbound-key'], expected)) return res.status(401).json({ success: false });
  try {
    const b = req.body || {};
    const out = await receiveInbound({ from: b.from, to: b.to, text: b.text, receivedAt: b.receivedAt, providerMsgId: b.providerMsgId });
    return res.json({ success: true, stored: out.stored });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'inbound_messages')) return;
    if (respondUserError(res, err)) return;
    console.error('[inbound-sms/receive] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '받지 못했습니다. 잠시 뒤 다시 보내 주세요.' });
  }
});

export default router;
