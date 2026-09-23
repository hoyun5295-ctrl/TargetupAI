/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 공개 샘플 페이지 (L2 · 무인증)
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-5.
 *
 * - 발송본 HTML 그대로 렌더(동일 조립 결과) — 내부 정보·내부 식별자·개발 용어 0(H1 · B-0821-5 부류 차단).
 * - noindex + private 캐시(검색엔진·중간 캐시 차단 전례 = email.ts:167·invoice-public.ts).
 * - 수명 = 발송 성공 시각 기준 상수(OUTREACH_PREVIEW_DAYS) · 만료·파기 건은 404와 동일한 안내(존재 추측 차단).
 * - 열람 로그(시각·IP) = 영업 신호.
 */
import express, { Router, Request, Response } from 'express';
import { getPublicOutreachHtml, recordOutreachPreviewView } from '../utils/sales-outreach-jobs';
import { resolveOutreachUnsubscribe, recordOutreachUnsubscribe } from '../utils/sales-outreach-direct-jobs';
import { renderUnsubscribePage } from '../utils/sales-outreach-direct';
import { isOutreachMigrationPending } from '../utils/sales-outreach-jobs';
import { outreachPublicPageCsp } from '../utils/sales-outreach-produce';

const router = Router();

// ★ 2026-09-09 이 라우터는 app.ts 에서 helmet 뒤에 마운트되어 SPA 용 CSP(img-src 'self')를 물려받는다.
//   이미지는 PUBLIC_BASE 절대 주소라 다른 호스트(sys 관리자 미리보기)에서 열면 전부 차단됐다 → img-src 에 PUBLIC_BASE 추가.
router.use(outreachPublicPageCsp());

router.get('/:code', async (req: Request, res: Response) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const html = await getPublicOutreachHtml(req.params.code);
    if (!html) {
      return res.status(404).send('<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>안내</title></head><body style="font-family:sans-serif;padding:40px;text-align:center;color:#333"><p>페이지를 찾을 수 없거나 열람 기간이 지났습니다.</p></body></html>');
    }
    console.log('[sales-outreach] 샘플 열람:', req.params.code, req.ip);
    // ★ 2026-09-06 S4 열람 기록(식별자 0 · UA 3분류 · 응답을 막지 않는다)
    recordOutreachPreviewView(req.params.code, req.headers['user-agent'] || null).catch(() => {});
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

/**
 * ★ 2026-09-23 담당자 직접 발송 수신거부(공개 · 무인증 · noindex · 설계서 §5 · 불변 48)
 * - GET = 확인 페이지만(기업 메일 보안 스캐너의 사전 열람이 해지를 만들지 않게) · POST = 기록.
 * - List-Unsubscribe-Post 원클릭(본문 List-Unsubscribe=One-Click)은 바로 기록 · 범위 = 그 회사 전체.
 * - 무효 토큰 = 같은 안내(존재 추측 차단) · 응답에 내부 식별자 0.
 */
export const unsubscribeRouter = Router();
unsubscribeRouter.use(express.urlencoded({ extended: false, limit: '8kb' }));

unsubscribeRouter.get('/:token', async (req: Request, res: Response) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const t = await resolveOutreachUnsubscribe(req.params.token);
    if (!t) return res.status(404).send(renderUnsubscribePage({ state: 'invalid' }));
    return res.send(renderUnsubscribePage({ state: 'confirm', companyName: t.companyName, actionUrl: `/api/outreach/u/${req.params.token}` }));
  } catch (err: any) {
    console.error('[sales-outreach] 수신거부 페이지 오류:', err?.message);
    return res.status(isOutreachMigrationPending(err) ? 503 : 500).send(renderUnsubscribePage({ state: 'invalid' }));
  }
});

unsubscribeRouter.post('/:token', async (req: Request, res: Response) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  const oneClick = String(req.body?.['List-Unsubscribe'] || '') === 'One-Click';
  try {
    const ok = await recordOutreachUnsubscribe(req.params.token, {
      companyWide: oneClick || String(req.body?.company || '') === '1',
      notContact: !oneClick && String(req.body?.not_contact || '') === '1',
    });
    if (oneClick) return res.status(ok ? 200 : 404).json({ ok });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(ok ? 200 : 404).send(renderUnsubscribePage({ state: ok ? 'done' : 'invalid' }));
  } catch (err: any) {
    console.error('[sales-outreach] 수신거부 기록 오류:', err?.message);
    if (oneClick) return res.status(500).json({ ok: false });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(renderUnsubscribePage({ state: 'invalid' }));
  }
});
