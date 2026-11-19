/**
 * 공개 페이지 방문 기록 무인증 경로(★ 2026-11-19 C145 · 설계서 docs/2026-11-19-c145-public-session-visits-design.md §3-2)
 * 저장 · 판정 소유 = utils/public-visits.ts · 이 파일은 거르고 부르기만. 응답 = 늘 204(기록 실패가 페이지를 막지 않는다) · 표 없음 = 503.
 * 전역 express.json 뒤에 마운트한다(app.ts · 공개 라우터를 파서 앞에 두면 POST 본문이 빈다 = LESSONS_BACKEND 라우팅 절).
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { PUBLIC_VISIT_RATE, parseVisitBeat, parseVisitStart, recordVisitBeat, recordVisitStart } from '../utils/public-visits';
import { verifyApiTokenSignature } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';

const router = Router();

const limiter = (cfg: { windowMs: number; max: number }) => rateLimit({
  ...cfg,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '요청이 너무 잦습니다.', code: 'RATE_LIMITED' },
});

const done = (res: Response) => res.status(204).end();

router.post('/start', limiter(PUBLIC_VISIT_RATE.start), async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const v = parseVisitStart(req.body);
  if (!v) return done(res);
  // 그 브라우저에 한줄로 로그인 흔적이 있으면 「누구 것」만 적는다(서명 · 만료만 봄 · 세션 생사는 안 봄)
  const auth = req.headers.authorization || '';
  const who = auth.startsWith('Bearer ') ? verifyApiTokenSignature(auth.slice(7)) : null;
  try {
    await recordVisitStart(v, { ip: req.ip || null, userAgent: req.headers['user-agent'], loginId: who?.loginId ?? null, userType: who?.userType ?? null });
    return done(res);
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'public_page_visits')) return;
    console.error('[public-visits] 방문 등록 실패:', err?.message);
    return done(res);
  }
});

router.post('/beat', limiter(PUBLIC_VISIT_RATE.beat), async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const v = parseVisitBeat(req.body);
  if (!v) return done(res);
  try {
    await recordVisitBeat(v);
    return done(res);
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'public_page_visits')) return;
    console.error('[public-visits] 머문 시간 기록 실패:', err?.message);
    return done(res);
  }
});

export default router;
