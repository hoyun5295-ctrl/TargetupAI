/**
 * ★ CDP 버스트 rate limit — 2026-06-25 (gap 6)
 *   월 한도(cdp-auth)만으론 초당/분당 폭주 방어 불가. 회사별 슬라이딩 윈도우(프로세스 메모리) 1차 방어.
 *   evaluateBurst는 순수(시간 주입). 미들웨어는 회사별 Map으로 상태 보관.
 *   - 메모리 기반이라 pm2 인스턴스별 — 분산 공유는 범위 밖(1차 방어로 충분).
 *   - bulk-import는 제외(이미 월 한도 + 1000건 캡).
 */
import { Request, Response, NextFunction } from 'express';

export interface BurstWindowState { timestamps: number[]; }

/** 순수 — 윈도우 밖 만료 후 max 미만이면 now push & 허용. 초과면 차단(retained 그대로). */
export function evaluateBurst(
  state: BurstWindowState, now: number, windowMs: number, maxPerWindow: number,
): { allowed: boolean; retained: number[] } {
  const cutoff = now - windowMs;
  const retained = state.timestamps.filter((t) => t > cutoff);
  if (retained.length >= maxPerWindow) {
    return { allowed: false, retained };
  }
  retained.push(now);
  return { allowed: true, retained };
}

/**
 * 회사별 버스트 미들웨어 팩토리. req.cdpAuth.companyId 기준.
 * 초과 시 429 RATE_LIMITED. companyId 없으면 통과(인증 미들웨어가 앞단에서 차단).
 */
const companyWindows = new Map<string, number[]>();

export function cdpBurstLimit(maxPerWindow: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // requireCdpApiKey는 req.cdpAuth, requireCdpBrowserOrigin은 req.cdp에 companyId를 둔다(둘 다 수용).
    const companyId = ((req as any).cdpAuth?.companyId || (req as any).cdp?.companyId) as string | undefined;
    if (!companyId) { next(); return; }
    const now = Date.now();
    const state: BurstWindowState = { timestamps: companyWindows.get(companyId) || [] };
    const { allowed, retained } = evaluateBurst(state, now, windowMs, maxPerWindow);
    companyWindows.set(companyId, retained);
    if (!allowed) {
      res.status(429).json({ success: false, error: '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}
