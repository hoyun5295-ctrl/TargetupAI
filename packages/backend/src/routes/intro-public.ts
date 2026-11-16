/**
 * 공개 소개 페이지(/intro) 무인증 경로 (★2026-10-07 Harold) — 방문 기록 · 시연 요청. 저장 · 정규화 소유 = utils/intro-leads.ts
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { INTRO_RATE, parseDemoRequest, recordDemoRequest, recordIntroView } from '../utils/intro-leads';

const router = Router();

const limiter = (cfg: { windowMs: number; max: number }) => rateLimit({
  ...cfg,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' },
});

// 방문 기록 — 응답은 언제나 204(기록 실패 · 한도 초과가 화면을 막지 않는다)
router.post('/view', limiter(INTRO_RATE.view), async (req: Request, res: Response) => {
  await recordIntroView(req, req.body);
  res.status(204).end();
});

router.post('/demo-request', limiter(INTRO_RATE.request), async (req: Request, res: Response) => {
  // 사람 눈에 안 보이는 칸이 채워져 오면 자동 입력으로 보고 저장하지 않는다(문의 창과 같은 규약 · 성공처럼 답한다)
  if (req.body?.website) return res.json({ success: true });
  const parsed = parseDemoRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
  try {
    await recordDemoRequest(req, parsed.value);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[intro] 시연 요청 저장 실패:', err?.message);
    return res.status(500).json({ success: false, error: '요청을 받지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
