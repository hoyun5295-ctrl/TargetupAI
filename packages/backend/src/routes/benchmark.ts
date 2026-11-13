/**
 * ★ 2026-11-13 C133 F3 — 성과리포트 「업종 평균」 비교의 서버 길(설계서 docs/2026-11-13-hanjul-v3-design.md §4).
 *
 * 판정 · SQL = utils/performance-benchmark.ts 한 곳(여기는 관문과 응답 꼴만).
 * 관문 = 로그인 → **회사 관리자** → 단계 개방(v3Live 'benchmark' · 요금제가 먼저). 그 밖 = live: false 한 줄(화면은 비교 줄을 그리지 않는다).
 *   내 값(성공률 · 스팸 검사 차단율)은 회사 전체 값이다. 담당자는 발송결과 · 스팸 검사에서 자기 것만 본다(「사용자는 자기 것」) → 담당자에게는 닫는다.
 * 응답 = 내 값 · 평균 · 차이뿐 — 다른 회사 값 · 회사 수는 싣지 않는다. 표가 없으면(DDL 전) 503 DB_MIGRATION_PENDING.
 */
import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { respondUserError } from '../utils/http-error';
import { v3Live } from '../utils/v3-stage';
import { readBenchmark, BENCH_MIN_PEERS, BENCH_WINDOW_DAYS } from '../utils/performance-benchmark';

const router = Router();
router.use(authenticate);

// GET /summary — 성공률 · 통신사별 스팸 검사 차단율의 업종 평균 비교
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    res.setHeader('Cache-Control', 'private, no-store');
    if (!companyId || req.user?.userType !== 'company_admin' || !(await v3Live('benchmark', companyId))) {
      return res.json({ success: true, live: false });
    }
    const view = await readBenchmark(companyId);
    return res.json({ success: true, live: true, minPeers: BENCH_MIN_PEERS, windowDays: BENCH_WINDOW_DAYS, ...view });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'benchmark_company_daily')) return;
    if (respondUserError(res, err)) return;
    console.error('[benchmark/summary] 실패:', err?.message);
    return res.status(500).json({ success: false, error: '업종 평균을 불러오지 못했습니다.' });
  }
});

export default router;
