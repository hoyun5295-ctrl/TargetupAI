import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { readPlanFreeQuotas } from '../utils/free-messaging';

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

export default router;
