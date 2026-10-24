/**
 * operator-route.ts — 자동 마케팅 주소의 문 · 오류 매핑 한 곳(★ 2026-10-24 결함 2 · 3 · 4 · 여정 journey-route 와 같은 모양)
 *
 * 왜 있나
 *   자동 마케팅 주소가 회사 · 요금제 · 주인 문을 각자 썼다. 수정 · 보관 · 담당자 정지 · 검사 결과 · 안 목록 다섯 주소엔 주인 확인이 없었고,
 *   500 에 오류 원문을 내보내는 곳이 19곳, 주인 판정도 세 가지(관리자 아님 · 담당자만 · 토큰 없음)로 갈렸다.
 *   → 모든 자동 마케팅 주소가 operatorGate · operatorError 를 지난다(짝 시험 automarketing-oneline-1024 가 우회를 막는다).
 *
 * 주인 원칙 = 여정과 같은 한 함수(journey-access · owner-scope): 관리자 = 회사 전체 · 담당자 = 자기가 만든 자동 마케팅만 · 남의 것 = 404.
 * 요금제 문 = 돈이 나가거나 발송이 시작되는 주소만(plan: true). 조회 · 거부 · 정지 · 보관은 요금제가 잠겨도 열어 둔다(남은 예약을 멈출 수 있게 · 기존 계약).
 */
import type { Request, Response } from 'express';
import { query } from '../config/database';
import { aiZonePlanBlocked } from './plan-guard';
import { journeyViewerOf, type JourneyViewer } from './journey-access';
import { InsufficientCreditError } from './ai-credit';
import { isUuid } from './normalize';
import { OperatorCallbackError } from './continuous-operator';
import { operatorSaveErrorResponse, PreviewBusyError, PreviewInputError, PreviewStaleError } from './automarketing-preview';

export type OperatorViewer = JourneyViewer;

/** 담당자면 자기가 만든 자동 마케팅만 — 목록 SQL 조각(관리자 = 빈 조각) */
export function operatorOwnerSql(viewer: OperatorViewer, params: any[], alias = 'o'): string {
  if (!viewer.ownOnly) return '';
  params.push(viewer.userId);
  return ` AND ${alias}.created_by::text = $${params.length}::text`;
}

/** 이 사람이 이 자동 마케팅(또는 그 제안)을 볼 · 고칠 수 있는가 */
export async function canAccessOperatorResource(viewer: OperatorViewer, kind: 'operator' | 'proposal', id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const params: any[] = [id, viewer.companyId];
  const sql = kind === 'operator'
    ? `SELECT 1 FROM continuous_operators o WHERE o.id = $1::uuid AND o.company_id = $2::uuid${operatorOwnerSql(viewer, params)}`
    : `SELECT 1 FROM operator_proposals p JOIN continuous_operators o ON o.id = p.operator_id
        WHERE p.id = $1::uuid AND p.company_id = $2::uuid${operatorOwnerSql(viewer, params)}`;
  const r = await query(sql, params);
  return r.rows.length > 0;
}

/**
 * 자동 마케팅 주소 문 — 회사 · (plan) 요금제 · (자원 주소면) 주인. 막히면 응답을 보내고 null.
 *   자원 = 주소의 :id — /operator/proposals/:id… = 제안 · /operator/continuous/:id… = 자동 마케팅. 남의 것 = 404(있는지도 알리지 않는다).
 */
export async function operatorGate(req: Request, res: Response, opts: { plan: boolean }): Promise<(OperatorViewer & { userId: string }) | null> {
  const viewer = journeyViewerOf(req);
  if (!viewer || !viewer.userId) { res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' }); return null; }
  // ★ 2026-10-24 요금제 = AI 존 서버 문 한 곳(뿌리 대장 R2 · 화면 PlanGate 와 같은 판정 · 거절 코드 한 벌)
  if (opts.plan && (await aiZonePlanBlocked(req, res))) return null;
  const rid = req.params?.id;
  if (rid !== undefined) {
    const kind = String(req.route?.path || '').startsWith('/operator/proposals') ? 'proposal' : 'operator';
    if (!(await canAccessOperatorResource(viewer, kind, String(rid)))) {
      res.status(404).json({ success: false, error: kind === 'proposal' ? '제안서를 찾을 수 없습니다.' : '자동 마케팅을 찾을 수 없습니다.' });
      return null;
    }
  }
  return viewer as OperatorViewer & { userId: string };
}

/**
 * 자동 마케팅 주소 오류 매핑 한 벌. 원문은 로그에만(500 에 원문 0).
 *   402 크레딧 · 400 입력 · 409 처리 중 · 판 다름 · 409/503 등록(키 충돌 · 차감 확인 실패) · 503 DB 준비 전.
 */
export function operatorError(res: Response, err: any, label: string, fallback: string) {
  if (err instanceof PreviewStaleError) return res.status(409).json({ success: false, error: err.message, code: 'PREVIEW_STALE', current: err.current });
  if (err instanceof PreviewBusyError) return res.status(409).json({ success: false, error: err.message, code: 'PREVIEW_BUSY' });
  if (err instanceof PreviewInputError) return res.status(400).json({ success: false, error: err.message, code: 'PREVIEW_INPUT' });
  if (err instanceof OperatorCallbackError) return res.status(400).json({ success: false, error: err.message, code: 'CALLBACK_NOT_REGISTERED' });
  if (err instanceof InsufficientCreditError) return res.status(402).json({ success: false, error: '크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' });
  const mapped = operatorSaveErrorResponse(err);   // 대상 · 회신번호 · 등록 키 · 차감 확인 · DB 준비 전(등록 · 시작 공용)
  if (mapped) return res.status(mapped.status).json(mapped.body);
  const msg = String(err?.message || '');
  if (err?.code === '42P01' || err?.code === '42703' || (msg.includes('does not exist') && (msg.includes('column') || msg.includes('relation')))) {
    console.error(`[Operator ${label}] DB 준비 전:`, msg);
    return res.status(503).json({ success: false, error: 'DB 마이그레이션 필요: 운영자에게 자동 마케팅 표 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
  }
  console.error(`[Operator ${label}] 오류:`, err);
  return res.status(500).json({ success: false, error: fallback });
}
