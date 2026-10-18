/**
 * routes/autosend-stop-public.ts — 자동마케팅 예고 문자 멈춤 링크(★2026-10-18 · 무인증 · 설계서 docs/2026-10-18-planner-v2-design.md §3-8)
 *
 *   GET  /api/autosend-stop/view   — 토큰 검증 + 화면 재료(자동마케팅 이름 · 보낼 시각 · 받는 사람 수 · 문안 · 멈출 수 있는가)
 *   POST /api/autosend-stop/skip   — 이번 회차 건너뛰기(로그인 화면 [정지]와 같은 CT `adminStopProposal`)
 *   POST /api/autosend-stop/pause  — 자동마케팅 일시정지(같은 CT `updateOperator({status:'paused'})` = 예약 발송 동반 취소)
 *
 * ⛔ 토큰은 헤더(X-Autosend-Stop-Token)로만 · 무효는 전부 같은 404 · 멈추는 일만(승인 · 재개 없음) · 인증번호 없음(멈추는 쪽) ·
 *   확인 창은 화면 · 담당자 전원 통보 · 감사 원장 기록.
 */
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { AUTOSEND_STOP_TOKEN_HEADER, loadAutosendStopView, verifyAutosendStopToken, type AutosendStopPayload } from '../utils/autosend-stop-link';
import { adminStopProposal, mapRowToOperator, notifyOperatorAdmins, updateOperator } from '../utils/continuous-operator';
import { recordAuditLog } from '../utils/audit-log';

const router = Router();
const NOT_FOUND = { success: false, error: '유효하지 않거나 만료된 주소입니다.' };

function tokenOf(req: Request): AutosendStopPayload | null {
  return verifyAutosendStopToken(String(req.headers[AUTOSEND_STOP_TOKEN_HEADER] || ''));
}

/** 담당자 전원 통보(fire-and-forget · 실패해도 멈춤은 유효) */
async function notifyAll(p: AutosendStopPayload, title: string, body: string): Promise<void> {
  try {
    const r = await query(`SELECT * FROM continuous_operators WHERE id = $1::uuid AND company_id = $2::uuid`, [p.operatorId, p.companyId]);
    if (!r.rows[0]) return;
    await notifyOperatorAdmins(mapRowToOperator(r.rows[0]), title, body);
  } catch (e: any) {
    console.warn('[autosend-stop] 전원 통보 실패:', e?.message);
  }
}

router.get('/view', async (req: Request, res: Response) => {
  try {
    const p = tokenOf(req);
    if (!p) return res.status(404).json(NOT_FOUND);
    const view = await loadAutosendStopView(p);
    if (!view) return res.status(404).json(NOT_FOUND);
    return res.json({ success: true, view });
  } catch (err: any) {
    console.error('[autosend-stop] 조회 실패:', err?.message || err);
    return res.status(500).json({ success: false, error: '내용을 불러오지 못했습니다.' });
  }
});

router.post('/skip', async (req: Request, res: Response) => {
  try {
    const p = tokenOf(req);
    if (!p) return res.status(404).json(NOT_FOUND);
    const view = await loadAutosendStopView(p);
    if (!view) return res.status(404).json(NOT_FOUND);
    if (!view.canSkip) return res.status(409).json({ success: false, code: 'NOT_ALLOWED', error: '이번 회차는 이미 나갔거나 멈춘 상태예요.', view });
    const ok = await adminStopProposal(p.companyId, p.proposalId, { reason: 'no_send', detail: '담당자 링크로 이번 회차 건너뛰기' });
    if (!ok) {
      const now = await loadAutosendStopView(p);
      return res.status(409).json({ success: false, code: 'STATE_CHANGED', error: '그 사이 발송이 시작됐거나 이미 멈췄어요.', ...(now ? { view: now } : {}) });
    }
    void recordAuditLog({ action: 'autosend_link_skip', targetType: 'operator_proposal', targetId: p.proposalId, details: { operatorId: p.operatorId }, req });
    void notifyAll(p, '[AI 자동마케팅] 이번 회차 건너뜀', `'${view.operatorName}' 이번 회차 발송을 문자 속 주소에서 건너뛰었습니다. 다음 회차는 그대로 진행합니다. 본인이나 동료가 한 일이 아니면 한줄로 담당자에게 알려 주세요.`);
    // ★ Codex C 1R — 멈춤은 끝났다. 화면 재조회가 실패해도 성공으로 답한다(view = null 이면 화면은 옛 재료 그대로 · 결과 문장만)
    return res.json({ success: true, view: await loadAutosendStopView(p).catch(() => null) });
  } catch (err: any) {
    console.error('[autosend-stop] 건너뛰기 실패:', err?.message || err);
    return res.status(500).json({ success: false, error: '건너뛰지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

router.post('/pause', async (req: Request, res: Response) => {
  try {
    const p = tokenOf(req);
    if (!p) return res.status(404).json(NOT_FOUND);
    const view = await loadAutosendStopView(p);
    if (!view) return res.status(404).json(NOT_FOUND);
    if (!view.canPause) return res.status(409).json({ success: false, code: 'NOT_ALLOWED', error: '자동마케팅이 이미 꺼져 있어요.', view });
    const updated = await updateOperator(p.companyId, p.operatorId, { status: 'paused' });
    if (!updated) return res.status(404).json(NOT_FOUND);
    void recordAuditLog({ action: 'autosend_link_pause', targetType: 'continuous_operator', targetId: p.operatorId, details: { proposalId: p.proposalId }, req });
    void notifyAll(p, '[AI 자동마케팅] 일시정지', `'${view.operatorName}' 자동마케팅을 문자 속 주소에서 일시정지했습니다. 예약된 발송도 함께 취소했습니다. 다시 켜려면 한줄로 > 자동마케팅에서 켜 주세요. 본인이나 동료가 한 일이 아니면 한줄로 담당자에게 알려 주세요.`);
    return res.json({ success: true, view: await loadAutosendStopView(p).catch(() => null) });
  } catch (err: any) {
    console.error('[autosend-stop] 일시정지 실패:', err?.message || err);
    return res.status(500).json({ success: false, error: '일시정지하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
