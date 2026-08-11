import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { queryPayAgentBalances, getAgentCustNameMap, listAgentCharges, countAgentCharges, isPayStatsConfigured } from '../utils/pay-stats';
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

/**
 * ★ 2026-08-11 — 충전 내역 열람 범위 = **회사 소유 발송ID 전부**(선불 지정과 무관).
 *
 * 이력은 이미 일어난 사실이라 지금의 선불/후불 지정이 바뀌었다고 과거 충전이 사라지면 안 된다.
 * `loadEligibleSendIds`(요청 등록 자격 = prepaid만)와 일부러 다른 함수로 둔다 — 한쪽 조건을
 * 고치다 다른 쪽이 같이 바뀌면 "요청은 되는데 내역이 빈다"거나 그 반대가 된다.
 */
async function loadOwnedSendIds(companyId: string): Promise<string[]> {
  const r = await query(
    `SELECT cai.agent_send_id
       FROM company_agent_ids cai
       JOIN companies c ON c.id = cai.company_id
      WHERE cai.company_id = $1
        AND c.usage_type IN ('agent','both')
      ORDER BY cai.agent_send_id ASC`,
    [companyId]
  );
  return r.rows.map((x: any) => String(x.agent_send_id));
}

// GET /api/agent-charge-orders/targets — 내 회사의 선불 발송ID + 게이트웨이 잔액
//   잔액은 저장하지 않고 게이트웨이 원장(RSRM_SalesMst.RemAmt) 실값을 읽는다(6원칙 ③ 이중 진실 금지).
//   ★ 2026-07-27 기준일(asOfDate) 폐기 — 옛 소스였던 일별 통계 스냅샷의 축이다.
//   원장 값은 발송이 나가는 대로 실시간으로 깎이므로 기준일이 없고, 미확정은 숫자 대신 사유로 내린다.
router.get('/targets', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '고객사 권한이 필요합니다.' });

    const sendIds = await loadEligibleSendIds(companyId);

    let balances: Array<{ agentSendId: string; remAmt: number | null; unknownReason: string | null }> = [];
    if (sendIds.length > 0) {
      try {
        const rows = await queryPayAgentBalances(companyId);
        balances = rows.map((b) => ({
          agentSendId: String(b.agent_send_id),
          remAmt: b.rem_amt,
          unknownReason: b.unknown_reason,
        }));
      } catch (balErr) {
        // 잔액 조회 실패는 요청 등록을 막지 않는다 — 요청은 잔액과 무관한 접수 행위다.
        console.warn('[agent-charge-orders] 잔액 조회 실패(요청 화면은 계속):', balErr);
      }
    }

    // ★ 2026-07-27 발급명(게이트웨이 원장) 동반 — 고객사 화면도 "발송ID / 발급명" 같은 규칙으로 보여준다.
    const nameMap = await getAgentCustNameMap();
    const custNames: Record<string, string> = {};
    for (const id of sendIds) {
      const nm = nameMap.get(id);
      if (nm) custNames[id] = nm;
    }

    res.json({ sendIds, custNames, balances });
  } catch (error: any) {
    console.error('충전 요청 대상 조회 실패:', error);
    if (handleDbMigrationError(error, res, 'company_agent_ids')) return;
    res.status(500).json({ error: '충전 요청 대상 조회 실패' });
  }
});

/**
 * GET /api/agent-charge-orders/ledger — 내 회사 발송ID의 **충전 내역**(게이트웨이 원장)
 *
 * ★ 2026-08-11 접수(런소프트): "업체가 신청한 건만 이력에 남고, 계좌이체 후 담당자가 직접 충전한 건은
 * 안 보인다. 담당자가 충전·차감한 내역도 남아야 한다."
 *
 * 원인 = 아래 `GET /`(요청 이력)은 `agent_charge_orders`(신청 원장)만 읽는다. 담당자 직접 충전은
 * 게이트웨이 원장 `RSRM_FillAmtHist`에만 들어가고 신청 행을 만들지 않아 고객사 화면에서 사라졌다.
 * 그래서 원장을 직접 읽는 창구를 따로 연다. 요청 이력은 그대로 둔다 — 접수 대기·반려는 원장에 없는 상태다.
 *
 * ⛔ 열람 범위는 **서버가 다시 조회한** 소유 발송ID로만 건다(프론트 값 신뢰 금지).
 *    소유 0건이면 `agentSendIds: []` → CT가 `1 = 0`으로 막는다. 조건을 빼면 전 고객사 원장이 열린다.
 * ⛔ **원장을 못 읽은 것을 "내역 없음"으로 내리지 않는다**(★ 2026-08-11 Codex 1R-1).
 *    PAY 미설정·조회 실패는 503 `PAY_LEDGER_UNAVAILABLE` — 화면이 빈 목록과 다른 문구를 띄운다.
 */
router.get('/ledger', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '고객사 권한이 필요합니다.' });

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, parseInt(String(req.query.limit || '10'), 10) || 10));

    const ownedIds = await loadOwnedSendIds(companyId);
    const filter = { agentSendIds: ownedIds };

    // 게이트웨이 읽기만 따로 감싼다 — 위 PG 조회 실패까지 "원장 조회 불가"로 뭉뚱그리면 원인을 못 가른다.
    let rows: Awaited<ReturnType<typeof listAgentCharges>>;
    let total: number;
    try {
      if (!isPayStatsConfigured()) throw new Error('PAY_STATS_DB_NOT_CONFIGURED');
      [rows, total] = await Promise.all([
        listAgentCharges({ ...filter, limit, offset: (page - 1) * limit }),
        countAgentCharges(filter),
      ]);
    } catch (payErr: any) {
      console.error('[agent-charge-orders] 충전 원장 조회 불가:', payErr?.message || payErr);
      return res.status(503).json({
        error: '충전 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
        code: 'PAY_LEDGER_UNAVAILABLE',
      });
    }

    // 발급명 동반 — 고객사는 내부 코드(D0078)가 아니라 자기 발급명(런소프트)으로 계정을 안다.
    const nameMap = await getAgentCustNameMap();
    res.json({
      rows: rows.map((r) => ({
        seqNo: r.seqNo,
        agentSendId: r.agentSendId,
        custName: nameMap.get(String(r.agentSendId)) || null,
        // 음수 = 담당자 상계 차감. 부호를 지우면 접수가 요구한 "차감 내역"이 충전처럼 보인다.
        amount: r.amount,
        filledAt: r.filledAt,
        applied: r.applied,
        appliedAt: r.appliedAt,
      })),
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      page,
    });
  } catch (error: any) {
    console.error('충전 내역 조회 실패:', error);
    if (handleDbMigrationError(error, res, 'company_agent_ids')) return;
    res.status(500).json({ error: '충전 내역 조회 실패' });
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

    const nameMap = await getAgentCustNameMap();
    res.json({
      rows: r.rows.map((x: any) => ({
        id: String(x.id),
        agentSendId: String(x.agent_send_id),
        custName: nameMap.get(String(x.agent_send_id)) || null,
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
