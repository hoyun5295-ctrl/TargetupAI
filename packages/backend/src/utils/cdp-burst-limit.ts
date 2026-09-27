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
/** 방문자 단위 창은 수가 많다 — 이 수를 넘으면 창이 비었거나 끝난 키를 치운다 */
const WINDOW_PRUNE_AT = 20_000;

/**
 * ★ 2026-09-27 한줄로 V2 R179 — keyOf로 무엇 단위로 셀지 고른다(없으면 회사 단위 = 종전).
 *   브라우저 SDK 적재(/ingest)는 쇼핑객 전원이 한 회사로 합산돼 50건/10초에 막혀 행동 이벤트가 429로 버려졌다 → 방문자 단위로 센다.
 */
export function cdpBurstLimit(maxPerWindow: number, windowMs: number, keyOf?: (req: Request, companyId: string) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // requireCdpApiKey는 req.cdpAuth, requireCdpBrowserOrigin은 req.cdp에 companyId를 둔다(둘 다 수용).
    const companyId = ((req as any).cdpAuth?.companyId || (req as any).cdp?.companyId) as string | undefined;
    if (!companyId) { next(); return; }
    const key = keyOf ? keyOf(req, companyId) : companyId;
    const now = Date.now();
    if (companyWindows.size > WINDOW_PRUNE_AT) {
      for (const [k, ts] of companyWindows) if (ts.length === 0 || ts[ts.length - 1] <= now - windowMs) companyWindows.delete(k);
    }
    const state: BurstWindowState = { timestamps: companyWindows.get(key) || [] };
    const { allowed, retained } = evaluateBurst(state, now, windowMs, maxPerWindow);
    companyWindows.set(key, retained);
    if (!allowed) {
      res.status(429).json({ success: false, error: '요청이 너무 빠릅니다. 잠시 후 다시 시도해주세요.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}
