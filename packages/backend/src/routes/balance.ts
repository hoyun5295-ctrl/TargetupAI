import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { queryPayAgentBalances, getAgentCustNameMap } from '../utils/pay-stats';
import { resolveChargeUnitPrice } from '../utils/unit-price';
import { judgePayerName } from '../utils/fraud-review';
import { notifyChargeApprovers } from '../utils/charge-approve-link';

const router = Router();

router.use(authenticate);

// GET /api/balance - 현재 잔액 + 요금 정보 조회
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const result = await query(
      `SELECT billing_type, balance, unit_price_basis,
              cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao
       FROM companies WHERE id = $1`,
      [companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }

    const c = result.rows[0];
    // ★ 2026-07-26 화면이 이 단가로 "잔액으로 몇 건 보낼 수 있나"를 계산한다.
    //   실제 차감은 부가세 포함가이므로 여기도 포함가여야 한다 — 공급가를 내리면 발송 가능 건수가 10% 과대 표시된다.
    res.json({
      billingType: c.billing_type,
      balance: Number(c.balance),
      costPerSms: resolveChargeUnitPrice(c, 'SMS'),
      costPerLms: resolveChargeUnitPrice(c, 'LMS'),
      costPerMms: resolveChargeUnitPrice(c, 'MMS'),
      costPerKakao: resolveChargeUnitPrice(c, 'KAKAO'),
    });
  } catch (error: any) {
    // ★ 2026-07-26 db_alter_safety_net — 이 endpoint는 신규 컬럼(unit_price_basis)을 읽는다.
    //   ALTER가 빠진 환경에서 고객 잔액 화면이 통째로 500이 되지 않게 사유를 드러낸다.
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요: 운영자에게 companies.unit_price_basis ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('잔액 조회 실패:', error);
    res.status(500).json({ error: '잔액 조회 실패' });
  }
});

// GET /api/balance/agent - 에이전트(게이트웨이) 선불 발송ID별 잔액 (★ 2026-07-24 §5-2)
// 잔액은 저장하지 않고 게이트웨이 일별 통계의 최신 RemAmt를 조회만 한다. 빈 배열 = 화면 미노출.
router.get('/agent', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const balances = await queryPayAgentBalances(companyId);
    // ★ 2026-07-27 발급명 동반 — 고객사는 내부 코드(D0078)가 아니라 자기 발급명(런소프트)으로 계정을 안다.
    const nameMap = await getAgentCustNameMap();
    res.json({
      balances: balances.map((b) => ({
        agentSendId: b.agent_send_id,
        custName: nameMap.get(String(b.agent_send_id)) || null,
        remAmt: b.rem_amt,
        // ★ 2026-07-27 asOfDate 폐기 — 원장 실시간 잔액이라 기준일이 없다(통계 스냅샷 시절의 축).
        unknownReason: b.unknown_reason,
      })),
    });
  } catch (error: any) {
    const msg = error?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요: 운영자에게 company_agent_ids ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('에이전트 잔액 조회 실패:', error);
    res.status(500).json({ error: '잔액 조회 실패' });
  }
});

// GET /api/balance/transactions - 잔액 변동 이력 (페이지네이션)
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;
    const type = req.query.type as string; // charge, deduct, refund 등 필터
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    let where = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let paramIdx = 2;

    if (type) {
      where += ` AND type = $${paramIdx++}`;
      params.push(type);
    }
    if (startDate) {
      where += ` AND created_at >= $${paramIdx++}::date`;
      params.push(startDate);
    }
    if (endDate) {
      where += ` AND created_at < ($${paramIdx++}::date + INTERVAL '1 day')`;
      params.push(endDate);
    }

    // 총 건수
    const countResult = await query(
      `SELECT COUNT(*) FROM balance_transactions ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // 이력 조회
    const result = await query(
      `SELECT id, type, amount, balance_after, description, reference_type, reference_id, created_at
       FROM balance_transactions ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset]
    );

    res.json({
      transactions: result.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error('잔액 이력 조회 실패:', error);
    res.status(500).json({ error: '잔액 이력 조회 실패' });
  }
});

// GET /api/balance/summary - 월별 충전/차감/환불 요약
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const months = parseInt(req.query.months as string) || 6;

    const result = await query(
      `SELECT
         TO_CHAR(created_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') as month,
         SUM(CASE WHEN type IN ('charge', 'deposit_charge', 'admin_charge') THEN amount ELSE 0 END) as total_charged,
         SUM(CASE WHEN type = 'deduct' THEN amount ELSE 0 END) as total_deducted,
         SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END) as total_refunded,
         SUM(CASE WHEN type = 'admin_deduct' THEN amount ELSE 0 END) as total_admin_deducted,
         COUNT(*) as transaction_count
       FROM balance_transactions
       WHERE company_id = $1
         AND created_at >= NOW() - ($2 || ' months')::INTERVAL
       GROUP BY month
       ORDER BY month DESC`,
      [companyId, months]
    );

    res.json({ summary: result.rows });
  } catch (error) {
    console.error('잔액 요약 조회 실패:', error);
    res.status(500).json({ error: '잔액 요약 조회 실패' });
  }
});

// POST /api/balance/deposit-request - 무통장입금 요청
router.post('/deposit-request', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { amount, depositorName } = req.body;

    if (!amount || amount < 1000) {
      return res.status(400).json({ error: '1,000원 이상 입력해주세요.' });
    }
    if (!depositorName || depositorName.trim() === '') {
      return res.status(400).json({ error: '입금자명을 입력해주세요.' });
    }

    // 선불 고객사인지 확인 + 명의 대조 대상(전송자격인증 2.3 — 2026-08-19 information_schema 실측 컬럼)
    const companyResult = await query(
      'SELECT billing_type, company_name, name, ceo_name FROM companies WHERE id = $1',
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }
    if (companyResult.rows[0].billing_type !== 'prepaid') {
      return res.status(400).json({ error: '선불 요금제 고객사만 이용 가능합니다.' });
    }

    // 중복 요청 방지 (같은 회사, 같은 금액, 10분 이내 pending 요청)
    const duplicateCheck = await query(
      `SELECT id FROM deposit_requests 
       WHERE company_id = $1 AND amount = $2 AND status = 'pending' 
         AND created_at > NOW() - INTERVAL '10 minutes'`,
      [companyId, amount]
    );
    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ error: '동일 금액의 입금 요청이 이미 접수되어 있습니다. 잠시 후 다시 시도해주세요.' });
    }

    // ★ 2026-08-19 전송자격인증 2.3 — 결제정보↔계정 명의 대조.
    //   ⛔ 자동 거절하지 않는다. 상태는 'pending' 그대로 두고 **보류 사유만** 단다 —
    //      상태 축을 늘리면 뱃지·목록·중복판정·승인/반려 게이트 4곳이 함께 깨진다(영향표 실측).
    //   판정 CT = utils/fraud-review.ts (세 값: match·mismatch·unknown)
    const holderVerdict = judgePayerName(depositorName, {
      companyName: companyResult.rows[0].company_name,
      tradeName: companyResult.rows[0].name,
      ceoName: companyResult.rows[0].ceo_name,
    });
    const heldReason = holderVerdict.result === 'mismatch' ? holderVerdict.holdReason || null : null;

    // deposit_requests에 저장
    const result = await query(
      `INSERT INTO deposit_requests (company_id, amount, depositor_name, status, held_reason, held_at, created_at)
       VALUES ($1, $2, $3, 'pending', $4, CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END, NOW())
       RETURNING id, amount, depositor_name, status, held_reason, created_at`,
      [companyId, amount, depositorName.trim(), heldReason]
    );

    const companyName = companyResult.rows[0].company_name;
    console.log(
      `[무통장입금요청] ${companyName}: ${Number(amount).toLocaleString()}원 / 입금자: ${depositorName.trim()}` +
      (heldReason ? ' / 명의 확인 필요' : '')
    );

    // ★2026-08-28(3) 담당자 승인 안내 문자(Harold 지시) — 접수는 이미 끝났다. 발송 실패가 응답을 막지 않는다.
    //   명의 확인 보류 건은 링크로 승인할 수 없으므로(소명 확인 = 관리 화면) 문자를 보내지 않는다.
    if (!heldReason) {
      notifyChargeApprovers({
        kind: 'deposit', targetId: String(result.rows[0].id), companyId,
        companyName, amount: Number(amount), depositorName: depositorName.trim(),
      }).catch(() => { /* CT가 이미 로그를 남긴다 */ });
    }

    res.status(201).json({
      // 보류 사유 원문은 내려주지 않는다 — 명의 판정 기준이 그대로 노출되면 우회를 돕는다
      message: heldReason
        ? '입금 확인 요청이 접수되었습니다. 입금자명 확인이 필요해 담당자 확인 후 처리됩니다.'
        : '입금 확인 요청이 접수되었습니다.',
      reviewRequired: Boolean(heldReason),
      request: result.rows[0],
    });
  } catch (error: any) {
    // ★ DB ALTER 안전망 — 마이그레이션 전이면 500이 아니라 503으로 정확히 알린다
    const msg = String(error?.message || '');
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요: deposit_requests ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('무통장입금 요청 실패:', error);
    res.status(500).json({ error: '무통장입금 요청 실패' });
  }
});

/**
 * POST /api/balance/deposit-request/:id/explanation — 소명 제출 (전송자격인증 2.3)
 *
 * 명의 확인이 필요한 건에 고객사가 사유를 적어 낸다. 상태는 바꾸지 않는다 —
 * 처리(승인·반려)는 사람이 하고, 이 글은 그 판단의 근거로만 남는다.
 */
router.post('/deposit-request/:id/explanation', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '고객사 권한이 필요합니다.' });

    const note = String(req.body?.note || '').trim();
    if (!note) return res.status(400).json({ error: '소명 내용을 입력해주세요.' });

    // 소유·상태 조건을 UPDATE에 직접 건다 — 조회 게이트는 장벽이 아니다
    const result = await query(
      `UPDATE deposit_requests
          SET explanation_note = $1
        WHERE id = $2 AND company_id = $3 AND status = 'pending' AND held_reason IS NOT NULL
        RETURNING id`,
      [note.slice(0, 1000), req.params.id, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '소명할 수 있는 요청이 아닙니다.' });
    }
    return res.json({ message: '소명이 접수되었습니다. 담당자 확인 후 처리됩니다.' });
  } catch (error: any) {
    const msg = String(error?.message || '');
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        error: 'DB 마이그레이션 필요: deposit_requests ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    console.error('소명 접수 실패:', error);
    return res.status(500).json({ error: '소명 접수 실패' });
  }
});

export default router;
