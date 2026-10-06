import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { readPlanFreeQuotas } from '../utils/free-messaging';
import { authenticate } from '../middlewares/auth';
import { parseFeatureSeen, recordFeatureSeen, FEATURE_SEEN_RATE } from '../utils/feature-interest';

const router = Router();

// GET /api/plans - 요금제 목록 (인증 불필요)
//   ★ 2026-09-03 planQuotas 동반 — 비로그인 요금제 안내(/pricing 방문자 모드)가 "포함된 무료 메시지"를
//     그리려면 로그인 전용 /companies/my-free-messaging 없이도 요금제별 수량이 필요하다.
//     같은 CT(readPlanFreeQuotas · plans.free_*_qty 파생)를 쓰므로 진실은 여전히 plans 한 곳이다.
//     DDL 미실행이면 CT가 {}를 돌려주고, 그 밖의 실패도 목록 자체는 막지 않는다(키 추가라 기존 소비처 무영향).
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT * FROM plans WHERE is_active = true ORDER BY monthly_price ASC`
    );

    let planQuotas: Record<string, Record<string, number>> = {};
    try {
      planQuotas = await readPlanFreeQuotas();
    } catch (err) {
      console.error('요금제 무료 수량 조회 실패(목록은 계속):', err);
    }

    return res.json({ plans: result.rows, planQuotas });
  } catch (error) {
    console.error('요금제 목록 조회 에러:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// ★ 2026-10-06 기능 안내 창 열람 · 「요금제 보기」 기록(로그인 필수 · 고객사 사용자만) — 슈퍼관리자 「기능 관심 업체」의 원천.
//   기록 실패는 화면에 영향이 없다(recordAuditLog 가 삼킨다) · 모르는 값은 기록하지 않고 204.
// ★ Codex 1R — 사용자당 호출 상한(공용 audit_logs 가 반복 호출로 불어나지 않게 · 넘으면 INSERT 전에 429 · 화면은 결과를 보지 않는다)
const featureSeenLimiter = rateLimit({
  ...FEATURE_SEEN_RATE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `feature-seen:${req.user?.userId || 'anon'}`,
  message: { success: false, error: '요청이 너무 잦습니다.', code: 'RATE_LIMITED' },
});

router.post('/feature-seen', authenticate, featureSeenLimiter, async (req: Request, res: Response) => {
  const input = parseFeatureSeen(req.body);
  if (input) await recordFeatureSeen(req, input);
  return res.status(204).end();
});

export default router;
