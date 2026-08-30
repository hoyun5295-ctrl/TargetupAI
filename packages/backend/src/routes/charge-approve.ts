/**
 * routes/charge-approve.ts — 충전 승인 링크 (★2026-08-28(3) 신설 · 무인증)
 *
 * 승인 안내 문자의 주소가 여는 공개 endpoint다(선례 = agency-approve.ts: 토큰 검증 + 정보 GET + 실행 POST).
 *
 *   GET  /api/charge-approve/info    — 토큰 검증 + 승인 화면 재료 반환 (인증 X)
 *   POST /api/charge-approve/approve — 승인 실행 (인증 X · 효과는 축별 CT 한 벌이 소유)
 *
 * ⛔ 토큰은 헤더(X-Charge-Approve-Token)로만 받는다 — URL에 실으면 요청 로그에 승인권이 평문으로 남는다.
 * ⛔ 권한 = 서명 토큰(종류+대상 id+번호) 소지 + 그 번호가 **지금도** ENV 수신 목록에 있을 것.
 *   무효는 전부 같은 404(무엇이 틀렸는지 알려주지 않는다). ENV에서 번호를 빼면 나간 링크도 즉시 죽는다.
 * ⛔ 승인 효과는 화면 입구와 같은 CT를 지난다: 무통장입금 = approveDepositRequestTx(FOR UPDATE ·
 *   이중 승인 차단) / 에이전트 = executeAgentChargeBatch(멱등키 `order:id` = 재클릭 자연 멱등 ·
 *   uncertain 게이트·일 한도·발송ID 검증 전부 코어가 집행).
 * ⛔ 링크가 못 하는 것 셋(관리 화면 전용): 거절 · 명의 확인 보류(held) 건 승인 · uncertain 해소.
 * ⛔ 노출 최소: 고객사명·금액·입금자·발송ID까지만. 잔액·내부 식별자·다른 요청 목록은 내보내지 않는다.
 */
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import {
  CHARGE_APPROVE_TOKEN_HEADER, getChargeApprovalPhones, verifyChargeApproveToken,
  CHARGE_KIND_LABEL, oneLineField, notifyChargeApproved, type ChargeApproveKind,
} from '../utils/charge-approve-link';
import { approveDepositRequestTx } from '../utils/deposit-approve';
import { executeAgentChargeBatch } from '../utils/agent-charge-core';
import { recordAuditLog } from '../utils/audit-log';

const router = Router();

const isMissingRelation = (err: any) => {
  const msg = String(err?.message || '');
  return msg.includes('relation') && msg.includes('does not exist');
};

interface ResolvedTarget {
  kind: ChargeApproveKind;
  phone: string;
  row: any;
}

/** 헤더 토큰 검증 + 번호가 지금도 ENV 목록에 있는지 + 대상 행 조회. 무효는 전부 null(같은 404) */
async function resolveToken(req: Request): Promise<ResolvedTarget | null> {
  const token = String(req.headers[CHARGE_APPROVE_TOKEN_HEADER] || '');
  const payload = verifyChargeApproveToken(token);
  if (!payload) return null;
  if (!getChargeApprovalPhones().includes(payload.phone)) return null;
  if (payload.kind === 'deposit') {
    const r = await query(
      `SELECT dr.id, dr.company_id, dr.amount, dr.depositor_name, dr.status, dr.held_reason,
              dr.confirmed_at, dr.created_at, c.company_name
         FROM deposit_requests dr LEFT JOIN companies c ON c.id = dr.company_id
        WHERE dr.id = $1`,
      [payload.targetId],
    );
    if (r.rows.length === 0) return null;
    return { kind: 'deposit', phone: payload.phone, row: r.rows[0] };
  }
  const r = await query(
    `SELECT o.id, o.company_id, o.agent_send_id, o.amount, o.depositor_name, o.status,
            o.reject_reason, o.resolved_at, o.created_at, c.company_name
       FROM agent_charge_orders o LEFT JOIN companies c ON c.id = o.company_id
      WHERE o.id = $1::uuid`,
    [payload.targetId],
  );
  if (r.rows.length === 0) return null;
  return { kind: 'agent_order', phone: payload.phone, row: r.rows[0] };
}

/** 승인 화면이 그릴 것만. 잔액·내부 식별자는 내보내지 않는다 */
function toApprovalView(t: ResolvedTarget) {
  const { kind, row } = t;
  const processed = kind === 'deposit' ? row.status !== 'pending' : row.status !== 'pending';
  return {
    kind,
    kindLabel: CHARGE_KIND_LABEL[kind],
    companyName: row.company_name || '(회사 미상)',
    amount: Number(row.amount || 0),
    depositorName: row.depositor_name || '',
    agentSendId: kind === 'agent_order' ? String(row.agent_send_id || '') : null,
    status: String(row.status || ''),
    processed,
    createdAt: row.created_at,
  };
}

/** 지금 링크로 승인할 수 있는가. 아니면 사람이 읽을 사유를 만든다 */
function approvalBlock(t: ResolvedTarget): string | null {
  const { kind, row } = t;
  if (kind === 'deposit') {
    if (row.status === 'confirmed') return '이미 승인이 끝난 요청입니다.';
    if (row.status === 'rejected') return '이미 거절 처리된 요청입니다.';
    if (row.status !== 'pending') return '이미 처리된 요청입니다.';
    // 명의 확인 보류 = 소명 확인 절차(전송자격인증 2.3)가 필요하다 — 문자 한 번으로 건너뛰지 않는다
    if (row.held_reason) return '입금자명 확인이 필요한 요청입니다. 소명 확인 후 관리 화면에서 처리해 주세요.';
    return null;
  }
  if (row.status === 'fulfilled') return '이미 충전이 끝난 요청입니다.';
  if (row.status === 'processing') return '이미 충전 처리 중인 요청입니다.';
  if (row.status === 'rejected') return '이미 반려된 요청입니다.';
  if (row.status !== 'pending') return '이미 처리된 요청입니다.';
  return null;
}

router.get('/info', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });
    const blockReason = approvalBlock(resolved);
    return res.json({
      success: true,
      request: toApprovalView(resolved),
      approvable: !blockReason,
      blockReason,
    });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[charge-approve] 조회 실패:', err);
    return res.status(500).json({ success: false, error: '내용을 불러오지 못했습니다.' });
  }
});

router.post('/approve', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });

    const blockReason = approvalBlock(resolved);
    if (blockReason) {
      return res.status(409).json({ success: false, error: blockReason, request: toApprovalView(resolved) });
    }

    if (resolved.kind === 'deposit') {
      // 최종 재검증(held·pending 여부)은 CT가 FOR UPDATE 잠금 아래에서 한 번 더 한다
      const outcome = await approveDepositRequestTx({
        depositRequestId: String(resolved.row.id),
        adminId: null,
        adminNote: `링크 승인(${resolved.phone})`,
        via: 'link',
        linkPhone: resolved.phone,
      });
      if (!outcome.ok) {
        const friendly = outcome.code === 'HOLD_CONFIRMATION_REQUIRED'
          ? '입금자명 확인이 필요한 요청입니다. 소명 확인 후 관리 화면에서 처리해 주세요.'
          : outcome.error;
        return res.status(outcome.status >= 500 ? outcome.status : 409).json({ success: false, error: friendly });
      }
      console.log(`[charge-approve] 무통장입금 링크 승인 request=${resolved.row.id} phone=${resolved.phone} +${Number(resolved.row.amount).toLocaleString()}원`);
      // ★2026-08-30 보안 보강 A1·A2 — 수신 목록 전원 통보 + 감사 원장 기록(ip·ua). 실패해도 승인은 유효.
      void notifyChargeApproved({
        kind: 'deposit', companyName: resolved.row.company_name || '',
        amount: Number(resolved.row.amount || 0), approvedByPhone: resolved.phone,
      });
      void recordAuditLog({
        action: 'charge_link_approved',
        targetType: 'deposit_request',
        targetId: String(resolved.row.id),
        details: { phone: resolved.phone, companyName: resolved.row.company_name || '', amount: Number(resolved.row.amount || 0), kind: 'deposit' },
        req,
      });
      return res.json({
        success: true,
        message: `${Number(resolved.row.amount).toLocaleString()}원이 충전되었습니다.`,
        request: { ...toApprovalView(resolved), status: 'confirmed', processed: true },
      });
    }

    // 에이전트 축 — 화면의 "담기 + 충전 실행"을 한 번에.
    // ★2026-08-29 Codex 2R critical 정정 — 주문 선점·연결·원복을 **코어가 예약과 한 트랜잭션으로** 소유한다.
    //   이 라우트가 따로 선점하던 옛 코드는 제거했다: 링크만 선점하면 화면 입구(랜덤 멱등키)는 그대로
    //   선점 없이 들어가 같은 주문을 두 번 충전할 수 있었다. 입구가 아니라 효과 자리에 게이트를 둔다.
    //   멱등키 = 주문 고정(재클릭·문자 재사용 = 중복 차단).
    const outcome = await executeAgentChargeBatch({
      idempotencyKey: `order:${resolved.row.id}`,
      chargesInput: { charges: [{ agentSendId: String(resolved.row.agent_send_id), amount: Number(resolved.row.amount) }] },
      reason: `충전 요청 링크 승인 (입금자: ${oneLineField(resolved.row.depositor_name, 20) || '미상'} · ${resolved.phone})`,
      requestedBy: `link:${resolved.phone}`,
      orderIds: [String(resolved.row.id)],
    });

    if (outcome.kind === 'ok') {
      console.log(`[charge-approve] 에이전트 링크 승인 order=${resolved.row.id} phone=${resolved.phone} req=${outcome.requestId}`);
      // ★2026-08-30 보안 보강 A1·A2 — 수신 목록 전원 통보 + 감사 원장 기록(ip·ua). 실패해도 승인은 유효.
      void notifyChargeApproved({
        kind: 'agent_order', companyName: resolved.row.company_name || '',
        amount: Number(resolved.row.amount || 0), approvedByPhone: resolved.phone,
      });
      void recordAuditLog({
        action: 'charge_link_approved',
        targetType: 'agent_charge_order',
        targetId: String(resolved.row.id),
        details: { phone: resolved.phone, companyName: resolved.row.company_name || '', amount: Number(resolved.row.amount || 0), kind: 'agent_order' },
        req,
      });
      return res.json({
        success: true,
        message: '충전을 등록했습니다. 게이트웨이 반영은 잠시 후 자동 확인됩니다.',
        request: { ...toApprovalView(resolved), status: 'processing', processed: true },
      });
    }
    if (outcome.kind === 'duplicated') {
      // ★Codex 1R 수용 — 재전송은 실상태(requestStatus)로 가른다. registered만 성공이다.
      if (outcome.requestStatus === 'registered') {
        return res.json({
          success: true,
          message: '이미 승인된 요청입니다(중복 충전 차단).',
          request: { ...toApprovalView(resolved), status: 'processing', processed: true },
        });
      }
      if (outcome.requestStatus === 'not_applied') {
        // 이전 시도가 "미반영 확인"으로 해소된 건 — 새 실행은 관리 화면에서(멱등키가 같아 링크로는 다시 못 넣는다)
        return res.status(409).json({ success: false, error: '이전 승인 시도가 미반영으로 확인된 요청입니다. 관리 화면에서 처리해 주세요.' });
      }
      // uncertain·reserved = 반영 불확실. 사실대로 알린다(주문 상태는 코어가 소유)
      return res.status(502).json({
        success: false,
        error: '이전 승인 시도의 반영 여부가 불확실합니다. 다시 누르지 마시고 관리 화면에서 이력을 확인해 주세요.',
      });
    }
    if (outcome.kind === 'uncertain') {
      // 커밋 응답 유실 — 실제 반영됐을 수 있다. 주문은 코어가 processing으로 잠가 둔 상태다(재클릭 차단)
      return res.status(502).json({
        success: false,
        error: '충전 반영 여부가 불확실합니다. 다시 누르지 마시고 관리 화면에서 이력을 확인해 주세요.',
      });
    }
    if (outcome.kind === 'uncertain_pending') {
      return res.status(409).json({
        success: false,
        error: '반영이 불확실한 이전 충전이 남아 있어 지금은 링크로 승인할 수 없습니다. 관리 화면에서 해소 후 처리해 주세요.',
      });
    }
    // 검증·한도·선점 실패 = 게이트웨이 미진입 확정(코어가 예약까지 롤백했다 — 주문은 원래 상태 그대로)
    return res.status(outcome.status >= 500 ? outcome.status : 409).json({ success: false, error: outcome.error });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[charge-approve] 승인 실패:', err);
    return res.status(500).json({ success: false, error: '승인하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
