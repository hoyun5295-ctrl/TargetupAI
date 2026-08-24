/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 공개 샘플 페이지 (L2 · 무인증)
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-5.
 *
 * - 발송본 HTML 그대로 렌더(동일 조립 결과) — 내부 정보·내부 식별자·개발 용어 0(H1 · B-0821-5 부류 차단).
 * - noindex + private 캐시(검색엔진·중간 캐시 차단 전례 = email.ts:167·invoice-public.ts).
 * - 수명 = 발송 성공 시각 기준 상수(OUTREACH_PREVIEW_DAYS) · 만료·파기 건은 404와 동일한 안내(존재 추측 차단).
 * - 열람 로그(시각·IP) = 영업 신호.
 */
import { Router, Request, Response } from 'express';
import { getPublicOutreachHtml } from '../utils/sales-outreach-jobs';
import { isOutreachMigrationPending } from '../utils/sales-outreach-jobs';

const router = Router();

router.get('/:code', async (req: Request, res: Response) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const html = await getPublicOutreachHtml(req.params.code);
    if (!html) {
      return res.status(404).send('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>안내</title></head><body style="font-family:sans-serif;padding:40px;text-align:center;color:#333"><p>페이지를 찾을 수 없거나 열람 기간이 지났습니다.</p></body></html>');
    }
    console.log('[sales-outreach] 샘플 열람:', req.params.code, req.ip);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err: any) {
    if (isOutreachMigrationPending(err)) {
      return res.status(503).send('준비 중입니다.');
    }
    console.error('[sales-outreach] 샘플 페이지 오류:', err?.message);
    return res.status(500).send('일시적인 오류가 발생했습니다.');
  }
});

export default router;
