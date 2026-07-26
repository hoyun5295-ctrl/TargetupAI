import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { queryPayAgentBalances } from '../utils/pay-stats';
import { parseAgentChargeOrder } from '../utils/agent-charge-orders';

/**
 * ★ 2026-07-27 §5-4 — 에이전트 충전 요청 (고객사 창구)
 *
 * 흐름: 고객사가 발송ID·금액·입금자명으로 요청 등록(pending)
 *      → 슈퍼관리자 충전 관리 화면에 "요청 대기"로 뜨고, [실행] 1클릭으로 §5-3 폼이 채워짐
 *      → 게이트웨이 반영(RsApplyFlag='Y') 확인 후에만 fulfilled.
 *
 * ⛔ 이 라우트는 잔액을 절대 건드리지 않는다. 증액 경로는 §5-3(POST /api/admin/agent-charges) 하나뿐.
 */

const router = Router();

router.use(authenticate);

const PAGE_SIZE_MAX = 50;

/** 요청 자격 = usage_type agent/both 회사 + billing_type='prepaid' 발송ID 보유 */
async function loadEligibleSendIds(companyId: string): Promise<string[]> {
  const r = await query(
    `SELECT cai.agent_send_id
       FROM company_agent_ids cai
       JOIN companies c ON c.id = cai.company_id
      WHERE cai.company_id = $1
        AND cai.billing_type = 'prepaid'
        AND c.usage_type IN ('agent','both')
      ORDER BY cai.agent_send_id ASC`,
    [companyId]
  );
  return r.rows.map((x: any) => String(x.agent_send_id));
}

// GET /api/agent-charge-orders/targets — 내 회사의 선불 발송ID + 게이트웨이 잔액(기준일 동반)
//   잔액은 저장하지 않고 게이트웨이 실값을 읽는다(6원칙 ③ 이중 진실 금지).
//   기준일(asOfDate)을 반드시 함께 내린다 — 최근 발송이 없는 ID는 값이 stale일 수 있고,
//   기준일 없이 숫자만 보여주면 오래된 값을 현재 잔액으로 읽는다(§8-1).
router.get('/targets', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '고객사 권한이 필요합니다.' });

    const sendIds = await loadEligibleSendIds(companyId);

    let balances: Array<{ agentSendId: string; remAmt: number | null; asOfDate: string | null }> = [];
    if (sendIds.length > 0) {
      try {
        const rows = await queryPayAgentBalances(companyId);
        balances = rows.map((b: any) => ({
          agentSendId: String(b.agent_send_id),
          remAmt: b.rem_amt,
          asOfDate: b.as_of_date,
        }));
      } catch (balErr) {
        // 잔액 조회 실패는 요청 등록을 막지 않는다 — 요청은 잔액과 무관한 접수 행위다.
        console.warn('[agent-charge-orders] 잔액 조회 실패(요청 화면은 계속):', balErr);
      }
    }

    res.json({ sendIds, balances });
  } catch (error: any) {
    console.error('충전 요청 대상 조회 실패:', error);
    if (handleDbMigrationError(error, res, 'company_agent_ids')) return;
    res.status(500).json({ error: '충전 요청 대상 조회 실패' });
  }
});

// GET /api/agent-charge-orders — 내 회사 요청 이력
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '고객사 권한이 필요합니다.' });

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));
    const offset = (page - 1) * limit;

    const cnt = await query(`SELECT COUNT(*)::int AS n FROM agent_charge_orders WHERE company_id = $1`, [companyId]);
    const total = Number(cnt.rows[0]?.n || 0);

    const r = await query(
      `SELECT id, agent_send_id, amount, depositor_name, expected_at, memo,
              status, reject_reason, created_at, resolved_at
         FROM agent_charge_orders
        WHERE company_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [companyId, limit, offset]
    );

    res.json({
      rows: r.rows.map((x: any) => ({
        id: String(x.id),
        agentSendId: String(x.agent_send_id),
        amount: Number(x.amount),
        depositorName: x.depositor_name,
        expectedAt: x.expected_at ? String(x.expected_at).slice(0, 10) : null,
        memo: x.memo,
        status: String(x.status),
        rejectReason: x.reject_reason,
        createdAt: x.created_at,
        resolvedAt: x.resolved_at,
      })),
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      page,
    });
  } catch (error: any) {
    console.error('충전 요청 이력 조회 실패:', error);
    if (handleDbMigrationError(error, res, 'agent_charge_orders')) return;
    res.status(500).json({ error: '충전 요청 이력 조회 실패' });
  }
});

// POST /api/agent-charge-orders — 충전 요청 등록
router.post('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '고객사 권한이 필요합니다.' });

    const parsed = parseAgentChargeOrder(req.body);
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    // 발송ID 소유·선불 검증 — 프론트 목록을 신뢰하지 않는다(다른 회사 ID를 직접 POST하는 경로 차단)
    const eligible = await loadEligibleSendIds(companyId);
    if (eligible.length === 0) {
      return res.status(400).json({
        error: '선불로 지정된 발송ID가 없습니다. 담당자에게 선불 지정을 요청해 주세요.',
      });
    }
    if (!eligible.includes(parsed.agentSendId)) {
      return res.status(400).json({ error: '선택할 수 없는 발송ID입니다.' });
    }

    // 중복 접수 차단 — 같은 발송ID·같은 금액이 10분 내 대기 중이면 이중 등록으로 본다.
    // (같은 금액을 반복 입금하는 업체가 실제로 있어 영구 차단은 하지 않는다)
    const dup = await query(
      `SELECT id FROM agent_charge_orders
        WHERE company_id = $1 AND agent_send_id = $2 AND amount = $3
          AND status = 'pending' AND created_at > NOW() - INTERVAL '10 minutes'`,
      [companyId, parsed.agentSendId, parsed.amount]
    );
    if (dup.rows.length > 0) {
      return res.status(400).json({ error: '동일 금액의 충전 요청이 이미 접수되어 있습니다.' });
    }

    const requestedBy = String((req as any).user?.userId || '');
    const ins = await query(
      `INSERT INTO agent_charge_orders
         (company_id, agent_send_id, amount, depositor_name, expected_at, memo, status, requested_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING id, agent_send_id, amount, status, created_at`,
      [
        companyId,
        parsed.agentSendId,
        parsed.amount,
        parsed.depositorName,
        parsed.expectedAt,
        parsed.memo,
        requestedBy || null,
      ]
    );

    console.log(
      `[에이전트 충전요청] ${parsed.agentSendId} ${parsed.amount.toLocaleString()}원 / 입금자 ${parsed.depositorName}`
    );

    res.status(201).json({
      message: '충전 요청이 접수되었습니다. 입금 확인 후 처리됩니다.',
      order: {
        id: String(ins.rows[0].id),
        agentSendId: String(ins.rows[0].agent_send_id),
        amount: Number(ins.rows[0].amount),
        status: String(ins.rows[0].status),
        createdAt: ins.rows[0].created_at,
      },
    });
  } catch (error: any) {
    console.error('충전 요청 등록 실패:', error);
    if (handleDbMigrationError(error, res, 'agent_charge_orders')) return;
    res.status(500).json({ error: '충전 요청 등록 실패' });
  }
});

export default router;
