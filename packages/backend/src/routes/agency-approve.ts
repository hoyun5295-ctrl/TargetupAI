/**
 * routes/agency-approve.ts — 대행발송 담당자 링크 승인 (★ 2026-08-25 신설 · 무인증)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §16. 담당자 안내 문자의 주소가 여는 공개 endpoint다
 * (선례 = journey-pause-public.ts: 토큰 검증 + 정보 GET + 실행 POST).
 *
 *   GET  /api/agency-approve/info    — 토큰 검증 + 승인 화면 재료 반환 (인증 X)
 *   POST /api/agency-approve/approve — 승인 실행 (인증 X · 효과는 승인 CT 하나가 소유)
 *
 * ⛔ 토큰은 **헤더**(X-Agency-Approve-Token)로만 받는다(★Codex 적대 1R) — URL에 실으면 morgan·
 *   느린 요청 로그에 bearer가 평문으로 남아, 로그를 본 사람이 승인권을 얻는다.
 * ⛔ 권한 = 서명 토큰(접수 id + 담당자 번호 + 문안 버전) 소지. 단 그 번호가 **지금도** 담당자
 *   목록에 있어야 하고(판정 = agencyManagerPhones 한 벌), 문안 버전이 지금 것과 같아야 한다.
 *   무효는 전부 같은 404로 답한다(무엇이 틀렸는지 알려주지 않는다). 최종 재검증은 승인 CT가
 *   잠금 아래에서 한 번 더 한다.
 * ⛔ 이 경로가 노출하는 것은 문안·시각·건수·발신번호뿐이다. 수신자 명단·변수 매핑·회사 내부
 *   식별자는 내보내지 않는다(링크가 흘러도 새는 것은 마케팅 문안뿐).
 * ★2026-10-18 축 2 — 링크 조작 = 승인 · 취소 · 시각 변경(승인 전 + 미발송 재개) · 맞춤법 제안 적용(설계서 docs/2026-10-16-agency-send-mobile-control-design.md §2).
 *   허용 · 사유 = `agencyActions('link', row)` 한 벌(info 의 actions{} 와 각 POST 가드가 같은 함수) · 효과 = 로그인 화면과 같은 CT.
 *   취소 · 시각 변경 · 고치기는 인증번호 없이 + 담당자 전원 통보 + 이력(via · 번호 · ip · ua) + 감사 원장(취소는 멈추는 쪽 · 시각 · 고치기는 다시 승인을 지난다).
 * ⛔ 자유 문안 수정은 로그인 화면 소유 — 이 경로에 만들지 않는다.
 * ★2026-10-16 링크는 **승인 계정이 있는 번호**에서만 산다(토큰 번호 = 접수 계정 또는 관리자 한 명의 MFA 번호 · `resolveLinkApprovers`).
 *   승인은 그 계정으로 발신 인증(3.5) 인증번호를 받는다 — 확인은 `POST /sender-auth/verify`(토큰 헤더 · 로그인 경로와 같은 응답 CT).
 *   설계서 = docs/2026-10-16-agency-send-mobile-control-design.md §2 축 0.
 */
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { loadAgencyCallbackKinds } from '../utils/agency-send-intake';
import {
  AGENCY_APPROVE_TOKEN_HEADER, agencyManagerPhones, verifyAgencyApproveToken, resolveLinkApprovers, linkCancelReason,
} from '../utils/agency-send-link';
import {
  verifySenderAuthChallenge, senderAuthVerifyResponse, senderAuthRejection, isSenderAuthSchemaMissing,
} from '../utils/sender-auth';
import { approveAgencyRequestTx } from '../utils/agency-send-approve';
import { notifyManager, sendAgencyApprovalRequest } from '../utils/agency-send-worker';
import { buildLinkActionNotify, buildLinkApprovedNotify, formatWhen } from '../utils/agency-send-notify';
import { agencyActions } from '../utils/agency-send-actions';
import { editAgencyContentTx, rescheduleAgencyRequestTx } from '../utils/agency-send-change';
import { cancelAgencyRequestTx } from '../utils/agency-send-cancel';
import { logEvent } from '../utils/agency-send-intake';
import { recordAuditLog } from '../utils/audit-log';
import { readAgencySpell } from '../utils/agency-send-spell';

const router = Router();

const isMissingRelation = (err: any) => {
  const msg = String(err?.message || '');
  return msg.includes('relation') && msg.includes('does not exist');
};

/**
 * 헤더 토큰을 검증하고 접수 행까지 찾아 돌려준다. 무효는 전부 null(같은 404).
 * ★2026-10-16 그 번호의 **승인 계정**도 지금 판정한다(없으면 무효 · 강등·비활성·번호 변경 뒤 옛 링크가 죽는다).
 */
async function resolveToken(req: Request): Promise<{ row: any; phone: string; contentVersion: number; approverUserId: string } | null> {
  const token = String(req.headers[AGENCY_APPROVE_TOKEN_HEADER] || '');
  const payload = verifyAgencyApproveToken(token);
  if (!payload) return null;
  const r = await query(`SELECT * FROM agency_send_requests WHERE id = $1::uuid`, [payload.requestId]);
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (!agencyManagerPhones(row).includes(payload.phone)) return null;
  if (Number(row.content_version) !== Number(payload.contentVersion)) return null;
  const approverUserId = (await resolveLinkApprovers(row)).get(payload.phone);
  if (!approverUserId) return null;
  return { row, phone: payload.phone, contentVersion: payload.contentVersion, approverUserId };
}

/** 승인 화면이 그릴 것만 내보낸다. toPublic(로그인 화면용)보다 좁다 */
function toApprovalView(row: any) {
  return {
    label: row.file_name || String(row.current_content || '').slice(0, 24),
    status: row.status,
    messageType: row.message_type,
    subject: row.subject,
    content: row.current_content,
    isAd: !!row.is_ad,
    callbackNumber: row.callback_number,
    requestedAt: row.requested_at,
    recipientCount: Number(row.recipient_count || 0),
    imageCount: Array.isArray(row.mms_image_paths) ? row.mms_image_paths.length : 0,
    revision: Number(row.revision),
    approvedAt: row.approved_at,
    // ★2026-09-25 맞춤법 확인 목록(문안에서 나온 것뿐이라 노출 규칙 안) · ★2026-10-18 고르면 링크에서 고친다(축 3 · 잠긴 제안 = blocked)
    spellIssues: readAgencySpell(row),
    // ★2026-10-18 이 링크로 할 수 있는 조작 · 승인 마감(서버 판정 한 벌)
    actions: agencyActions('link', row),
  };
}

/**
 * 고객별 회신번호 종류 수(★2026-09-13 적대검토). 승인 화면이 대표 번호 하나만 보여 주면
 * 승인자는 다른 번호로도 나간다는 것을 모른 채 승인한다. 번호 목록은 내보내지 않는다(건수만).
 * 실패해도 승인 화면·승인 결과를 막지 않는다(0 = 표시 안 함).
 * ★2026-09-13(3) 규칙·조회는 CT(`loadAgencyCallbackKinds`)로 올렸다(목록·상세·운영 화면과 한 벌 · 빈 번호 = 대표 번호 규칙 그대로).
 */
async function loadCallbackKinds(row: any): Promise<{ callbackKinds: number; callbackSole: string | null }> {
  return (await loadAgencyCallbackKinds([row])).get(row.id) ?? { callbackKinds: 0, callbackSole: null };
}

router.get('/info', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });
    const { row } = resolved;
    // ★2026-10-18 승인 가능 판정 = 조작 정책 한 벌(24시간 승인 대기 포함 · 승인 CT 와 같은 checkApproval)
    const actions = agencyActions('link', row);
    return res.json({
      success: true,
      request: { ...toApprovalView(row), ...(await loadCallbackKinds(row)) },
      approvable: actions.approve.ok,
      blockReason: actions.approve.ok ? null : actions.approve.reason,
    });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[agency-approve] 조회 실패:', err);
    return res.status(500).json({ success: false, error: '내용을 불러오지 못했습니다.' });
  }
});

router.post('/approve', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });

    // 감사 재료(Harold 2026-08-25 "승인한 핸드폰번호로 감사로그"): 어느 번호의 링크가, 어디서 눌렀나.
    // 기록은 승인 CT가 승인과 **한 트랜잭션**으로 남긴다(이력이 못 적히면 승인도 없던 일).
    // ★2026-10-16 승인 계정은 승인 CT 가 토큰 번호로 다시 판정해 approved_by 에 남기고, 그 계정으로 발신 인증(3.5)을 건다
    const outcome = await approveAgencyRequestTx({
      requestId: resolved.row.id,
      revision: Number(req.body?.revision),
      approvedBy: null,
      via: 'link',
      req: { ip: req.ip, headers: req.headers },
      link: {
        phone: resolved.phone,
        contentVersion: resolved.contentVersion,
        ip: String(req.ip || ''),
        ua: String(req.headers['user-agent'] || ''),
      },
    });
    if (!outcome.ok) {
      if (outcome.senderAuth) return res.status(403).json(senderAuthRejection(outcome.senderAuth));
      return res.status(outcome.status).json({ success: false, error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) });
    }
    console.log(`[agency-approve] 링크 승인 request=${resolved.row.id} phone=${resolved.phone}`);

    // ★2026-08-30 보안 보강 A1 — 승인 실행을 담당자 전원에게 즉시 통보(fire-and-forget · 실패해도 승인은 유효).
    //   링크가 새서 남이 승인했다면 이 문자가 유일한 발각 경로다. 본인 승인에게는 영수증이 된다.
    const approved = outcome.row;
    void notifyManager({
      companyId: String(approved.company_id),
      requestId: String(approved.id),
      phones: agencyManagerPhones(approved),
      callback: String(approved.callback_number || ''),
      title: '[대행발송] 승인 완료',
      text: buildLinkApprovedNotify({
        label: String(approved.file_name || approved.current_content || ''),
        whenText: approved.requested_at ? formatWhen(new Date(approved.requested_at)) : undefined,
        approvedTail: resolved.phone.slice(-4),
      }),
    }).catch(() => {});
    // ★2026-08-30 보안 보강 A2 — 링크 승인을 감사 원장에도 남긴다(시스템 관리 감사 화면 노출 · ip·ua 포함)
    void recordAuditLog({
      action: 'agency_link_approved',
      targetType: 'agency_send_request',
      targetId: String(approved.id),
      details: { phone: resolved.phone, label: String(approved.file_name || '').slice(0, 40), contentVersion: resolved.contentVersion },
      req,
    });

    return res.json({ success: true, request: { ...toApprovalView(outcome.row), ...(await loadCallbackKinds(outcome.row)) } });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[agency-approve] 승인 실패:', err);
    return res.status(500).json({ success: false, error: '승인하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// ── ★2026-10-18 축 2 · 3 · 4 링크 조작(취소 · 시각 변경 · 맞춤법 적용) ─────────────────────────────

/** 링크 조작 공통 뒤처리 — 이력(via · 번호 · ip · ua) · 감사 원장 · 담당자 전원 통보(fire-and-forget · 실패해도 조작은 유효) */
function afterLinkAction(req: Request, resolved: { row: any; phone: string; contentVersion: number }, op: 'cancel' | 'reschedule' | 'spell', row: any, extra: Record<string, unknown> = {}): void {
  const actor = { via: 'link', phone: resolved.phone, ip: String(req.ip || ''), ua: String(req.headers['user-agent'] || '').slice(0, 200) };
  void logEvent(String(row.id), `link_${op}`, { ...actor, ...extra }).catch(() => {});
  void recordAuditLog({
    action: `agency_link_${op}`, targetType: 'agency_send_request', targetId: String(row.id),
    details: { phone: resolved.phone, label: String(row.file_name || '').slice(0, 40), contentVersion: resolved.contentVersion, ...extra },
    req,
  });
  // ★ Codex D 3R — 워커 F 가 먼저 확정한 취소는 결과 문자도 워커가 보냈다(cancel_reason 표지) · 여기서 또 보내지 않는다
  if (extra.finalizedElsewhere === true) return;
  void notifyManager({
    companyId: String(row.company_id), requestId: String(row.id), phones: agencyManagerPhones(row), callback: String(row.callback_number || ''),
    title: op === 'cancel' ? '[대행발송] 취소 안내' : op === 'reschedule' ? '[대행발송] 시각 변경 안내' : '[대행발송] 문안 고침 안내',
    text: buildLinkActionNotify({
      label: String(row.file_name || row.current_content || ''), action: op, tail: resolved.phone.slice(-4),
      whenText: row.requested_at ? formatWhen(new Date(row.requested_at)) : undefined,
      spellCount: Number(extra.spellCount || 0),
      pending: extra.pending === true,
    }),
  }).catch(() => {});
}

const actorOf = (req: Request, phone: string) => ({ phone, ip: String(req.ip || ''), ua: String(req.headers['user-agent'] || '').slice(0, 200) });

router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });
    const allowed = agencyActions('link', resolved.row).cancel;
    if (!allowed.ok) return res.status(409).json({ success: false, code: 'NOT_ALLOWED', error: allowed.reason });
    const out = await cancelAgencyRequestTx({
      requestId: resolved.row.id, companyId: String(resolved.row.company_id), reason: linkCancelReason(resolved.phone),
      ownerUserId: null, cancelledBy: null, cancelledByType: 'agency_link', revision: Number(req.body?.revision),
    });
    if (!out.ok) {
      return res.status(out.status).json({
        success: false, error: out.error, ...(out.code ? { code: out.code } : {}), ...(out.tooLate ? { tooLate: true } : {}),
        ...(out.current ? { request: { ...toApprovalView(out.current), ...(await loadCallbackKinds(out.current)) } } : {}),
      });
    }
    afterLinkAction(req, resolved, 'cancel', out.row, { pending: out.pending, ...(out.finalizedElsewhere ? { finalizedElsewhere: true } : {}) });
    // 워커가 먼저 확정했으면 화면도 「결과를 문자로 알려 드립니다」 쪽(이 요청이 문자를 보내지 않았다)
    const pending = out.pending || !!out.finalizedElsewhere;
    return res.status(pending ? 202 : 200).json({ success: true, pending, request: { ...toApprovalView(out.row), ...(await loadCallbackKinds(out.row)) } });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[agency-approve] 링크 취소 실패:', err?.message || err);
    return res.status(500).json({ success: false, error: '취소하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

router.post('/reschedule', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });
    const allowed = agencyActions('link', resolved.row).reschedule;
    if (!allowed.ok) return res.status(409).json({ success: false, code: 'NOT_ALLOWED', error: allowed.reason });
    const out = await rescheduleAgencyRequestTx({
      requestId: resolved.row.id, companyId: String(resolved.row.company_id), ownerUserId: null,
      revision: req.body?.revision, requestedAt: req.body?.requestedAt, via: 'link', actor: actorOf(req, resolved.phone),
    });
    if (!out.ok) {
      return res.status(out.status).json({
        success: false, error: out.error, ...(out.code ? { code: out.code } : {}),
        ...(out.current ? { request: { ...toApprovalView(out.current), ...(await loadCallbackKinds(out.current)) } } : {}),
      });
    }
    afterLinkAction(req, resolved, 'reschedule', out.row, { status: out.backTo, timeShifted: !!out.timeShifted });
    if (out.backTo === 'awaiting_approval') void sendAgencyApprovalRequest(String(out.row.id));
    return res.json({ success: true, request: { ...toApprovalView(out.row), ...(await loadCallbackKinds(out.row)) }, ...(out.timeShifted ? { timeShifted: true } : {}) });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[agency-approve] 링크 시각 변경 실패:', err?.message || err);
    return res.status(500).json({ success: false, error: '시각을 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

router.post('/spell-fix', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });
    const allowed = agencyActions('link', resolved.row).spellFix;
    if (!allowed.ok) return res.status(409).json({ success: false, code: 'NOT_ALLOWED', error: allowed.reason });
    const ids = (Array.isArray(req.body?.issueIds) ? req.body.issueIds : []).map(String).slice(0, 50);
    const out = await editAgencyContentTx({
      requestId: resolved.row.id, companyId: String(resolved.row.company_id), ownerUserId: null, revision: req.body?.revision,
      change: { kind: 'spell', issueIds: ids }, via: 'link', actor: actorOf(req, resolved.phone),
    });
    if (!out.ok) {
      return res.status(out.status).json({
        success: false, error: out.error, ...(out.code ? { code: out.code } : {}),
        ...(out.current ? { request: { ...toApprovalView(out.current), ...(await loadCallbackKinds(out.current)) } } : {}),
      });
    }
    afterLinkAction(req, resolved, 'spell', out.row, { spellCount: ids.length });
    // 문안 버전이 올라 이 링크는 닫힌다 — 다시 검사한 뒤 새 테스트 문자 · 새 승인 문자가 간다(화면은 「새 문자 대기」)
    return res.json({ success: true, awaitingNewMessage: true });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[agency-approve] 링크 맞춤법 적용 실패:', err?.message || err);
    return res.status(500).json({ success: false, error: '고치지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

/**
 * ★2026-10-16 링크 승인의 발신 인증(3.5) 인증번호 확인 — 로그인 경로(`/api/auth/sender-auth/verify`)의 토큰판.
 * 판정·기록·응답 문구는 전부 CT(`verifySenderAuthChallenge` · `senderAuthVerifyResponse`) — 여기서 조건을 다시 조립하지 않는다.
 * 확인 계정 = 토큰 번호의 승인 계정(인증번호를 받은 그 계정). 통과하면 화면이 눌렀던 승인을 다시 보낸다.
 */
router.post('/sender-auth/verify', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });
    const { challengeId, code } = req.body || {};
    if (!challengeId || !code) return res.status(400).json({ success: false, error: '인증번호를 입력해주세요.' });
    const verdict = await verifySenderAuthChallenge({
      challengeId: String(challengeId), userId: resolved.approverUserId, code: String(code), req,
    });
    const out = senderAuthVerifyResponse(verdict);
    return res.status(out.status).json(out.body);
  } catch (err: any) {
    if (isSenderAuthSchemaMissing(err)) {
      return res.status(503).json({ success: false, code: 'DB_MIGRATION_PENDING', error: 'DB 마이그레이션 필요: sender_auth_challenges 생성 요청' });
    }
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[agency-approve] 인증번호 확인 실패:', err?.code || err?.name || 'unknown');
    return res.status(500).json({ success: false, error: '인증 처리 중 오류가 발생했습니다.' });
  }
});

export default router;
