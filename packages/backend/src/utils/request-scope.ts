/**
 * request-scope.ts — 요청의 소유 범위 판정 CT (★ 2026-08-13)
 *
 * 고객사 스코프 확인은 모든 고객사 라우트의 첫 줄이다. 라우트마다 인라인으로 다시 쓰면
 * 한 곳이 빠졌을 때 그 엔드포인트만 남의 회사 자원을 연다(개방 기능의 aux 엔드포인트에서 반복된 부류).
 *
 * ⚠ 추가 과제(이번 범위 밖) — `routes/alimtalk.ts:89`·`routes/marketing-planner.ts:107`에
 *   같은 함수가 인라인으로 남아 있다. 신규 라우트부터 이 CT를 쓰고, 기존 둘의 통합은 별건으로 분리한다.
 */
import type { Request, Response } from 'express';

/** 고객사 스코프 — 없으면 403을 응답하고 null을 돌려준다(호출부는 즉시 return). */
export function requireCompany(req: Request, res: Response): string | null {
  const companyId = req.user?.companyId;
  if (!companyId) {
    res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    return null;
  }
  return companyId;
}
