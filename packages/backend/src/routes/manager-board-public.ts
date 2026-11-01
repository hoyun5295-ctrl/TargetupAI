// packages/backend/src/routes/manager-board-public.ts
// ★ 2026-11-02 엔진 재설계 E5-2 — 담당자 상황판(로그인 없음 · 읽기 전용)
//   GET /api/manager-board/view — 토큰(헤더 X-Manager-Board-Token) 검증 + 상황판 한 장
//
// ⛔ 토큰은 헤더로만(주소 경로 · 쿼리 0 · 접근 로그 · Referer 로 새지 않게 · 정지 링크와 같은 규칙).
// ⛔ 무효는 전부 같은 404(무엇이 틀렸는지 알려주지 않는다) · 원문 오류는 로그에만 · 바꾸는 일 0(멈추기 · 승인은 각 링크 화면).

import express, { Request, Response } from 'express';
import { respondUserError } from '../utils/http-error';
import { MANAGER_BOARD_TOKEN_HEADER, loadManagerBoard } from '../utils/manager-board';

const router = express.Router();

router.get('/view', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const view = await loadManagerBoard(String(req.headers[MANAGER_BOARD_TOKEN_HEADER] || ''));
    if (!view) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다. 가장 최근에 받으신 안내 문자의 주소로 다시 열어 주세요.' });
    return res.json({ success: true, ...view });
  } catch (err: any) {
    console.error('[manager-board view] 오류:', err?.message || err);
    if (respondUserError(res, err)) return;
    return res.status(500).json({ success: false, error: '상황판을 불러오지 못했습니다. 잠시 후 다시 열어 주세요.' });
  }
});

export default router;
