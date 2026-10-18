// packages/backend/src/routes/journey-pause-public.ts
// D218+ (2026-05-26) Public 정지 페이지 endpoint · ★ 2026-10-18 정지 링크 결함 정정(설계서 docs/2026-10-18-planner-v2-design.md §3-1)
//   GET  /api/journey-pause/info          — 토큰 검증 + 정지 화면 재료(인증 X)
//   POST /api/journey-pause/pause         — [이 발송 정지] 그 여정 · 그 단계 · 그날 active 실행 전부(인증 X)
//   POST /api/journey-pause/pause-journey — [여정 전체 일시정지](인증 X)
//
// ⛔ 토큰은 **헤더**(X-Journey-Pause-Token)로만 받는다 — 옛 `/journey-pause/:token` 은 주소 경로라 접근 로그 · Referer 에
//   정지권이 평문으로 남았고, 같은 경로가 화면 라우트와 겹쳐(nginx 는 /api/ 만 백엔드로 넘긴다) 화면이 화면 HTML 을 받을 수 있었다.
// ⛔ 무효는 전부 같은 404(무엇이 틀렸는지 알려주지 않는다) · 원문 오류는 로그에만.
// ⛔ 멈추는 쪽 동작이라 인증번호 없이 연다(Harold 0526 「사용자 친화 우선」 · 1018 링크 규칙 = 멈추는 행동은 확인 창 + 기록).

import express, { Request, Response } from 'express';
import {
  JOURNEY_PAUSE_TOKEN_HEADER, loadPauseView, pauseStepForDay, pauseJourneyByToken,
} from '../utils/journey-pause-handler';

const router = express.Router();

const tokenOf = (req: Request) => String(req.headers[JOURNEY_PAUSE_TOKEN_HEADER] || '');
const INVALID = { success: false, error: '유효하지 않거나 만료된 주소입니다. 가장 최근에 받으신 안내 문자의 주소로 다시 열어 주세요.' };

router.get('/info', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const view = await loadPauseView(tokenOf(req));
    if (!view) return res.status(404).json(INVALID);
    return res.json({ success: true, ...view });
  } catch (err: any) {
    console.error('[journey-pause info] 오류:', err?.message || err);
    return res.status(500).json({ success: false, error: '내용을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.' });
  }
});

router.post('/pause', async (req: Request, res: Response) => {
  try {
    const r = await pauseStepForDay(tokenOf(req), 'manager_link');
    if (!r.ok) return res.status(404).json(INVALID);
    return res.json({ success: true, paused: r.paused, startedCount: r.startedCount, sendDate: r.sendDate });
  } catch (err: any) {
    console.error('[journey-pause pause] 오류:', err?.message || err);
    return res.status(500).json({ success: false, error: '정지하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

router.post('/pause-journey', async (req: Request, res: Response) => {
  try {
    const r = await pauseJourneyByToken(tokenOf(req));
    if (!r.ok) return res.status(404).json(INVALID);
    return res.json({ success: true, changed: r.changed });
  } catch (err: any) {
    console.error('[journey-pause pause-journey] 오류:', err?.message || err);
    return res.status(500).json({ success: false, error: '여정을 멈추지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
