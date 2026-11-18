/**
 * 공개 JBN 전용 페이지(/jbn) 무인증 경로(★2026-11-18 C144) — 요금 보기 · 신청. 저장 · 정규화 소유 = utils/jbn.ts
 * 전역 express.json 뒤에 마운트한다(app.ts · 공개 라우터를 파서 앞에 두면 POST 본문이 빈다 = LESSONS_BACKEND 라우팅 절).
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { JBN_RATE, insertJbnApplication, loadJbnPlans, parseJbnApplication } from '../utils/jbn';
import { handleDbMigrationError } from '../utils/db-migration-error';

const router = Router();

const limiter = (cfg: { windowMs: number; max: number }) => rateLimit({
  ...cfg,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.', code: 'RATE_LIMITED' },
});

router.get('/plans', limiter(JBN_RATE.plans), async (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    return res.json({ success: true, plans: await loadJbnPlans() });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'plans.partner_code')) return;
    console.error('[jbn] 요금 읽기 실패:', err?.message);
    return res.status(500).json({ success: false, error: '요금 안내를 불러오지 못했습니다.' });
  }
});

router.post('/apply', limiter(JBN_RATE.apply), async (req: Request, res: Response) => {
  // 사람 눈에 안 보이는 칸이 채워져 오면 자동 입력으로 보고 저장하지 않는다(소개 페이지와 같은 규약 · 성공처럼 답한다)
  if (req.body?.website) return res.json({ success: true });
  try {
    const plans = await loadJbnPlans();
    const parsed = parseJbnApplication(req.body, plans.map((p) => p.code));
    if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
    await insertJbnApplication(parsed.value, req.ip || null);
    return res.json({ success: true });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'jbn_applications')) return;
    console.error('[jbn] 신청 저장 실패:', err?.message);
    return res.status(500).json({ success: false, error: '신청을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
});

export default router;
