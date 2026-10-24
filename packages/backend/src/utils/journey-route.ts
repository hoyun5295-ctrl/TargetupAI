/**
 * journey-route.ts — 여정 주소의 문 · 오류 매핑 한 곳 (★ 2026-10-23 여정 결함 0)
 *
 * 왜 있나
 *   여정 주소 55개가 회사 · 요금제 · 운영 권한 문 10줄과 오류 매핑을 각자 썼다. 그래서 미리보기 주소엔 운영 권한 문이 없었고,
 *   500 에 오류 원문을 내보내는 곳이 33곳, DB 준비 전 오류(23514 · 준비 전 오류형)를 503 으로 바꾸는 곳은 두 곳뿐이었다.
 *   주인 확인도 없어 담당자가 다른 사람이 만든 여정을 열고 고치고 켜고 지웠다(캠페인 · 자동발송은 담당자 = 자기 것만).
 *   → 모든 여정 주소가 journeyGate · journeyError 를 지난다(짝 시험 journey-zero-defect-1023 이 새 주소의 우회를 막는다).
 *
 * 주인 원칙(캠페인 campaigns.ts · 자동발송 auto-campaigns.ts 와 같다): 관리자 = 회사 전체 · 담당자(company_user) = 자기가 만든 여정만.
 */
import type { Request, Response } from 'express';
import { query } from '../config/database';
import { loadPlanContext, isAiOperatorAllowed } from './plan-guard';
import { InsufficientCreditError } from './ai-credit';
import { JourneyInputError } from './journey-step-limits';
import { JourneyStepGateError } from './journey-builder';
import { AlimtalkFallbackError } from './alimtalk-fallback';
import { AttachBlockedError } from './journey-attach';
import { ReshapeInputError } from './journey-reshape';
import { JourneyMigrationPendingError } from './journey-trigger-db';
import { isUuid } from './normalize';

export { journeyViewerOf, journeyOwnerSql, canAccessJourney, type JourneyViewer } from './journey-access';
import { journeyViewerOf, canAccessJourney, type JourneyViewer } from './journey-access';

/** 주소의 자원(여정 · 칸 · 변이)이 속한 여정 id. 자원이 없으면 null(=찾을 수 없음). 자원 주소가 아니면 undefined. */
async function journeyIdOfParams(req: Request, companyId: string): Promise<string | null | undefined> {
  const p = req.params || {};
  const jid = p.id || p.journeyId;
  if (jid) return isUuid(String(jid)) ? String(jid) : null;
  if (p.stepId) {
    if (!isUuid(String(p.stepId))) return null;
    const r = await query(`SELECT s.journey_id FROM journey_steps s JOIN journeys j ON j.id = s.journey_id WHERE s.id = $1::uuid AND j.company_id = $2::uuid`, [p.stepId, companyId]);
    return r.rows[0] ? String(r.rows[0].journey_id) : null;
  }
  if (p.variantId) {
    if (!isUuid(String(p.variantId))) return null;
    const r = await query(
      `SELECT s.journey_id FROM journey_step_variants v JOIN journey_steps s ON s.id = v.step_id JOIN journeys j ON j.id = s.journey_id
        WHERE v.id = $1::uuid AND j.company_id = $2::uuid`,
      [p.variantId, companyId],
    );
    return r.rows[0] ? String(r.rows[0].journey_id) : null;
  }
  return undefined;
}

/**
 * 여정 주소 문 — 회사 · 요금제 · 운영 권한 · (자원 주소면) 주인. 막히면 응답을 보내고 null.
 * 자원 주소에서 남의 여정 = 404(있는지도 알리지 않는다 · 캠페인과 같다).
 */
export async function journeyGate(req: Request, res: Response): Promise<(JourneyViewer & { userId: string | null }) | null> {
  const viewer = journeyViewerOf(req);
  if (!viewer) { res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' }); return null; }
  const planCtx = await loadPlanContext(viewer.companyId);
  if (!planCtx) { res.status(404).json({ success: false, error: '회사 정보를 찾을 수 없습니다.' }); return null; }
  if (!isAiOperatorAllowed(planCtx, req.user)) {
    res.status(403).json({ success: false, error: 'AI Operator 진입 권한이 없습니다.', code: 'AI_OPERATOR_GATED' });
    return null;
  }
  const jid = await journeyIdOfParams(req, viewer.companyId);
  if (jid === null || (jid !== undefined && !(await canAccessJourney(viewer, jid)))) {
    res.status(404).json({ success: false, error: '여정을 찾을 수 없습니다.' });
    return null;
  }
  return viewer;
}

/**
 * 여정 주소 오류 매핑 한 벌. 원문은 로그에만(500 에 원문 0).
 *   402 크레딧 · 400 입력 · 409 상태(칸 관문 · 붙이기 막음) · 503 DB 준비 전(CHECK 23514 · 표 42P01 · 칸 없음 · 준비 전 오류형).
 */
export function journeyError(res: Response, err: any, label: string, fallback: string) {
  if (err instanceof InsufficientCreditError) return res.status(402).json({ success: false, error: err.message || '크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' });
  if (err instanceof JourneyInputError) return res.status(400).json({ success: false, error: err.message, code: err.code, ...(err.journeyId ? { journeyId: err.journeyId } : {}) });
  if (err instanceof ReshapeInputError || err instanceof AlimtalkFallbackError) return res.status(400).json({ success: false, error: err.message });
  if (err instanceof JourneyStepGateError) return res.status(409).json({ success: false, error: err.message, code: err.code });
  if (err instanceof AttachBlockedError) return res.status(409).json({ success: false, error: err.message, code: err.code, blocks: err.blocks });
  if (err instanceof JourneyMigrationPendingError) return res.status(503).json({ success: false, error: err.message, code: err.code });
  const msg = String(err?.message || '');
  if (err?.code === '23514') return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요: 운영자에게 journeys 시작 사건 목록(CHECK) 갱신 요청', code: 'DB_MIGRATION_PENDING' });
  if (err?.code === '42P01' || err?.code === '42703' || (msg.includes('does not exist') && (msg.includes('column') || msg.includes('relation')))) {
    console.error(`[Journeys ${label}] DB 준비 전:`, msg);
    return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요: 운영자에게 여정 표 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
  }
  console.error(`[Journeys ${label}] 오류:`, err);
  return res.status(500).json({ success: false, error: fallback });
}
