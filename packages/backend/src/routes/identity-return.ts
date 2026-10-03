/**
 * 본인확인 인증 창 복귀 라우트 (★2026-10-03) — 판정 · 화면은 `utils/identity-return.ts` 가 소유한다.
 *
 * ⚠ app.ts 에서 helmet **앞**에 건다(창 격리 정책이 붙으면 부모 창과 끊긴다). 전역 본문 파서보다도 앞이라
 *   폼 본문 파서를 여기서 직접 건다. 인증 없이 열려 있으므로 DB를 건드리지 않고 세션도 만들지 않는다.
 */
import { Request, Response, Router, urlencoded } from 'express';
import rateLimit from 'express-rate-limit';
import { collectIdentityReturnFields, renderIdentityReturnPage } from '../utils/identity-return';

const router = Router();

// 정상 사용은 인증 한 번에 한 건이다. 같은 출발지에서 몰아치는 호출만 막는다
const returnLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

function respond(req: Request, res: Response) {
  const page = renderIdentityReturnPage(collectIdentityReturnFields(req.query, (req as any).body));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', page.contentSecurityPolicy);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.status(200).send(page.html);
}

router.get('/', returnLimiter, respond);
router.post('/', returnLimiter, urlencoded({ extended: false, limit: '64kb', parameterLimit: 60 }), respond);

export default router;
