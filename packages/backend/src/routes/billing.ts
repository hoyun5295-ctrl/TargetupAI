import { Router, Request, Response } from 'express';
import nodemailer from 'nodemailer';
import { authenticate, requireSuperAdmin } from '../middlewares/auth';
import pool, { mysqlQuery } from '../config/database';
import { SUCCESS_CODES_SQL } from '../utils/sms-result-map';
import { INVITO_INFO } from '../config/defaults';
import { CREDIT_UNIT_PRICE } from '../utils/ai-credit-calc';
// ★ 2026-07-25 사용량 집계 CT — 청구서(이 파일)와 발송통계 엑셀이 같은 집계를 쓴다(정산 정합).
//   미리보기(/preview)도 여기를 거친다 — 미리보기와 발행 금액이 갈라지지 않게 하는 유일한 장치다.
import {
  buildCompanyUsageByDay, buildBillingTotals, selectBillingRunIds, resolveBillingUnitPrices,
  getTablesForBillingPeriod, getBillingCompanyTables, MSG_TYPE_TO_USAGE_KEY, logUnbillableUsageKeys,
} from '../utils/send-usage-aggregation';

// SMTP transporter (재사용)
const getTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hiworks.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function smsAggByRunAndType(tables: string[], whereClause: string, params: any[]): Promise<any[]> {
  const allRows: any[] = [];
  for (const t of tables) {
    const rows = await mysqlQuery(
      `SELECT app_etc1 as run_id, msg_type,
              COUNT(*) as total_count,
              SUM(CASE WHEN status_code IN (${SUCCESS_CODES_SQL}) THEN 1 ELSE 0 END) as success_count
       FROM ${t} WHERE ${whereClause}
       GROUP BY app_etc1, msg_type`,
      params
    ) as any[];
    allRows.push(...rows);
  }
  return allRows;
}

const router = Router();

// ============================================================
//  정산(Billing) API — 슈퍼관리자 전용
//  마운트: /api/admin/billing
// ============================================================

// ★ 전체 라우트에 인증 + 슈퍼관리자 권한 적용
router.use(authenticate, requireSuperAdmin);

// ============================================================
//  정산(Billing) CRUD
// ============================================================

// POST /generate - 정산 데이터 생성 (월별 집계)
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { company_id, user_id, billing_start, billing_end } = req.body;
    const adminId = (req as any).user?.userId;

    if (!company_id || !billing_start || !billing_end) {
      return res.status(400).json({ error: '필수: company_id, billing_start, billing_end' });
    }

    if (billing_start > billing_end) {
      return res.status(400).json({ error: '시작일이 종료일보다 늦을 수 없습니다' });
    }

    const startDate = new Date(billing_start);
    const billing_year = startDate.getFullYear();
    const billing_month = startDate.getMonth() + 1;

    // 1) 중복 체크 (기간 겹침)
    const existCheck = await pool.query(
      `SELECT id, status, billing_start, billing_end FROM billings
       WHERE company_id = $1
         AND COALESCE(user_id, '00000000-0000-0000-0000-000000000000') = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')
         AND billing_start <= $4::date AND billing_end >= $3::date`,
      [company_id, user_id || null, billing_start, billing_end]
    );
    if (existCheck.rows.length > 0) {
      const ex = existCheck.rows[0];
      return res.status(409).json({
        error: `해당 기간과 겹치는 정산이 이미 존재합니다 (${String(ex.billing_start).slice(0,10)} ~ ${String(ex.billing_end).slice(0,10)})`,
        existing_id: ex.id,
        existing_status: ex.status
      });
    }

    // 2) 고객사 단가 조회 (스냅샷)
    const companyResult = await pool.query(
      `SELECT company_name, billing_type,
              cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
              cost_per_test_sms, cost_per_test_lms
       FROM companies WHERE id = $1`,
      [company_id]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다' });
    }
    const co = companyResult.rows[0];

    // ★ 2026-07-25 선불 회사 이중 청구 차단.
    //   선불은 발송하는 순간 잔액에서 빠진다(prepaid.ts prepaidDeduct — 후불이면 그냥 통과한다).
    //   이미 받은 돈을 월 정산서로 또 청구하면 그대로 이중 청구다.
    //   화면은 선불·후불을 한 목록에 섞어 보여주고 회사를 하나씩 골라 뽑는 방식이라 오선택이 실제로 가능하다.
    if (co.billing_type === 'prepaid') {
      return res.status(400).json({
        error: `${co.company_name || '해당 고객사'}는 선불 고객사입니다. 발송 시점에 잔액에서 이미 차감되었으므로 월 정산서를 발행하면 이중 청구가 됩니다.`,
        code: 'PREPAID_COMPANY_NOT_BILLABLE',
        billing_type: co.billing_type,
      });
    }

    // ★ 2026-07-25 단가 해석을 CT로 — 0원 설정이 `|| 일반단가` 폴백에 먹히던 결함 정정.
    const prices = resolveBillingUnitPrices(co);

    // 3~6) 사용량 집계 — ★ 2026-07-25 컨트롤타워로 이동(utils/send-usage-aggregation.ts).
    //   발송통계 엑셀이 청구서와 **같은 함수**를 호출하게 하려고 뺐다. 로직을 복사하면 언젠가 갈라져
    //   "엑셀 유형 ≠ 청구 유형"이 되고 그러면 정산 대조가 성립하지 않는다.
    const dayData = await buildCompanyUsageByDay({
      companyId: company_id,
      startDate: billing_start,
      endDate: billing_end,
      userId: user_id || undefined,
    });

    // 7) 합산 — ★ 2026-07-25 미리보기와 같은 함수로(금액 불일치 차단)
    const totals = buildBillingTotals(dayData);
    // 청구가 못 읽는 유형키가 섞여 있으면 그 유형은 조용히 0원이 된다 — 발행 시점에 로그로 드러낸다.
    logUnbillableUsageKeys(dayData, `정산생성 company=${company_id} ${billing_start}~${billing_end}`);
    const totalSms = totals.SMS, totalLms = totals.LMS, totalMms = totals.MMS, totalKakao = totals.KAKAO;
    const totalTestSms = totals.TEST_SMS, totalTestLms = totals.TEST_LMS;
    const totalSpamSms = totals.SPAM_SMS, totalSpamLms = totals.SPAM_LMS;

    // 스팸필터 단가 = 일반 단가와 동일 (D16 결정)
    const spamSmsCost = prices.SMS;
    const spamLmsCost = prices.LMS;

    // ★ 2026-07-25 7~9) 정산 쓰기를 단일 트랜잭션으로 묶는다.
    //   기존에는 billings INSERT → ai_credit_requests.billed=true → billing_items INSERT가 각각 따로 커밋됐다.
    //   중간에 실패하면 헤더만 남고 위 기간 중복검사(1번)가 재발행을 막는다.
    //   더 나쁜 쪽은 회복 경로다 — 화면 안내대로 "삭제 후 재생성"을 하면 billed=true는 되돌아오지 않아
    //   그 후불 크레딧 충전분이 영구 미청구가 된다(billed_invoice_id는 FK가 아니라 삭제에 반응하지 않는다).
    //   무거운 사용량 집계(MySQL 멀티테이블)는 트랜잭션 밖에 두고, 쓰기와 그 근거가 되는 PG 조회만 안에 넣는다.
    //   ※ config/database.ts의 `query`는 pool.query라 BEGIN/COMMIT이 서로 다른 커넥션에 나뉜다 — 반드시 client 고정.
    const client = await pool.connect();
    let billing: any;
    let itemsCount = 0;
    let aiCreditCount = 0, aiCreditSupply = 0;
    let subtotal = 0, vat = 0, totalAmount = 0;
    try {
      await client.query('BEGIN');

      // 같은 (회사, 사용자) 정산을 동시에 생성하면 위 1번 중복검사를 양쪽 다 통과할 수 있다 — 직렬화한다.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))`,
        [String(company_id), String(user_id || '')]
      );

      // 잠금을 기다리는 동안 다른 요청이 먼저 만들었을 수 있다 — 잠금 획득 후 재검사.
      const dupInTx = await client.query(
        `SELECT id, status, billing_start, billing_end FROM billings
         WHERE company_id = $1
           AND COALESCE(user_id, '00000000-0000-0000-0000-000000000000') = COALESCE($2::uuid, '00000000-0000-0000-0000-000000000000')
           AND billing_start <= $4::date AND billing_end >= $3::date`,
        [company_id, user_id || null, billing_start, billing_end]
      );
      if (dupInTx.rows.length > 0) {
        await client.query('ROLLBACK');
        const ex = dupInTx.rows[0];
        return res.status(409).json({
          error: `해당 기간과 겹치는 정산이 이미 존재합니다 (${String(ex.billing_start).slice(0,10)} ~ ${String(ex.billing_end).slice(0,10)})`,
          existing_id: ex.id,
          existing_status: ex.status
        });
      }

      // ★ D229+ 후불 AI 크레딧 충전 합산 — 이 기간 승인·미청구분(supply=공급가 VAT 별도)을 정산서에 합산.
      //   선불 충전은 status='completed'(즉시 결제)라 미포함 — 후불(status='approved')만 월말 청구 대상.
      //   FOR UPDATE = 합산에 넣은 행과 아래 billed 처리 대상 행이 같음을 보장(그 사이 상태 변경 차단).
      //
      // ★ 2026-07-25 사용자 지정 정산에서는 크레딧을 청구하지 않는다.
      //   발송 사용량은 `created_by`로 그 사용자 것만 거르는데 크레딧 조회는 `company_id`만 봤다.
      //   축이 어긋나 한 사용자의 청구서에 회사 전체 크레딧이 붙었고, 더 나쁜 건 그 행에 billed=true가 찍혀
      //   정작 회사 정산에서는 그만큼 빠져 버린 점이다(한 번 찍히면 되돌아오지 않는다).
      //   크레딧 충전은 회사 단위 행위라 사용자별로 나눌 근거 자체가 없다 — 회사 정산에서만 청구한다.
      let creditChargeRes: { rows: any[] } = { rows: [] };
      if (!user_id) {
        creditChargeRes = await client.query(
          `SELECT id, credits, supply_amount FROM ai_credit_requests
            WHERE company_id = $1::uuid AND status = 'approved' AND billed = false
              AND processed_at::date >= $2 AND processed_at::date <= $3
            FOR UPDATE`,
          [company_id, billing_start, billing_end]
        );
      }
      const chargeSupply = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0);
      const chargeCount = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.credits || 0), 0);
      // ★ #3 후불 overage(기본 크레딧 초과해 한도 음수로 쓴 분)도 같은 기간 합산 — 솔루션 이용요금 통합(단가 동일 2,000원)
      //   이중 방지: 위 기간 겹침 중복 차단(409)으로 월 1회만 생성 → created_at 기간 집계가 다음 달과 안 겹침.
      let overageCount = 0;
      if (!user_id) {
        const overageRes = await client.query(
          `SELECT COALESCE(SUM(overage_credits), 0) AS oc FROM ai_credit_transactions
            WHERE company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
              AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
          [company_id, billing_start, billing_end]
        );
        overageCount = Number(overageRes.rows[0]?.oc) || 0;
      }
      aiCreditCount = chargeCount + overageCount;                       // 충전 + 초과사용 크레딧 수량
      aiCreditSupply = chargeSupply + overageCount * CREDIT_UNIT_PRICE; // 공급가(크레딧×단가=공급가 일관)

      subtotal =
        (totalSms * prices.SMS) + (totalLms * prices.LMS) +
        (totalMms * prices.MMS) + (totalKakao * prices.KAKAO) +
        (totalTestSms * prices.TEST_SMS) + (totalTestLms * prices.TEST_LMS) +
        (totalSpamSms * spamSmsCost) + (totalSpamLms * spamLmsCost) +
        aiCreditSupply;
      vat = Math.round(subtotal * 0.1);
      totalAmount = subtotal + vat;

      // 8) billings INSERT
      const billingResult = await client.query(
        `INSERT INTO billings (
          company_id, user_id, billing_year, billing_month, billing_start, billing_end,
          sms_success, lms_success, mms_success, kakao_success,
          sms_unit_price, lms_unit_price, mms_unit_price, kakao_unit_price,
          test_sms_count, test_lms_count, test_sms_unit_price, test_lms_unit_price,
          spam_filter_sms_count, spam_filter_lms_count, spam_filter_sms_unit_price, spam_filter_lms_unit_price,
          subtotal, vat, total_amount, ai_credit_count, ai_credit_supply, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
        RETURNING *`,
        [
          company_id, user_id || null, billing_year, billing_month, billing_start, billing_end,
          totalSms, totalLms, totalMms, totalKakao,
          prices.SMS, prices.LMS, prices.MMS, prices.KAKAO,
          totalTestSms, totalTestLms, prices.TEST_SMS, prices.TEST_LMS,
          totalSpamSms, totalSpamLms, spamSmsCost, spamLmsCost,
          subtotal, vat, totalAmount, aiCreditCount, aiCreditSupply, adminId
        ]
      );
      billing = billingResult.rows[0];

      // ★ D229+ 합산한 후불 크레딧 충전 행을 billed 처리 (id 배열로 정확히 — 중복 청구 차단)
      if (creditChargeRes.rows.length > 0) {
        await client.query(
          `UPDATE ai_credit_requests SET billed = true, billed_invoice_id = $1::uuid WHERE id = ANY($2::uuid[])`,
          [billing.id, creditChargeRes.rows.map((r: any) => r.id)]
        );
      }

      // 9) billing_items INSERT (일자별 상세)
      const itemValues: any[][] = [];
      const allPrices: Record<string, number> = { ...prices, SPAM_SMS: spamSmsCost, SPAM_LMS: spamLmsCost };
      Object.entries(dayData).forEach(([dateStr, types]) => {
        Object.entries(types).forEach(([msgType, counts]) => {
          const up = allPrices[msgType] || 0;
          itemValues.push([
            billing.id, company_id, user_id || null, null,
            dateStr, msgType,
            counts.total, counts.success, counts.fail, counts.pending,
            up, counts.success * up
          ]);
        });
      });

      if (itemValues.length > 0) {
        const ph = itemValues.map((_, i) => {
          const b = i * 12;
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12})`;
        }).join(',');

        await client.query(
          `INSERT INTO billing_items (
            billing_id, company_id, user_id, agent_id,
            item_date, message_type,
            total_count, success_count, fail_count, pending_count,
            unit_price, amount
          ) VALUES ${ph}`,
          itemValues.flat()
        );
      }
      itemsCount = itemValues.length;

      await client.query('COMMIT');
    } catch (txError: any) {
      try { await client.query('ROLLBACK'); } catch (rbError: any) {
        console.error('정산 생성 롤백 실패:', rbError?.message || rbError);
      }
      throw txError;
    } finally {
      client.release();
    }

    return res.json({
      billing,
      items_count: itemsCount,
      summary: { totalSms, totalLms, totalMms, totalKakao, totalTestSms, totalTestLms, totalSpamSms, totalSpamLms, subtotal, vat, totalAmount }
    });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — ai_credit_transactions.overage_credits 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /list - 정산 목록
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { company_id, year, status } = req.query;
    let sql = `SELECT b.*, c.company_name, u.name as user_name
               FROM billings b
               JOIN companies c ON c.id = b.company_id
               LEFT JOIN users u ON u.id = b.user_id
               WHERE 1=1`;
    const params: any[] = [];

    if (company_id) { params.push(company_id); sql += ` AND b.company_id = $${params.length}`; }
    if (year) { params.push(year); sql += ` AND b.billing_year = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND b.status = $${params.length}`; }
    sql += ' ORDER BY b.billing_year DESC, b.billing_month DESC, b.created_at DESC';

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (error: any) {
    console.error('정산 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /company-users/:companyId - 고객사 사용자 목록
router.get('/company-users/:companyId', async (req: Request, res: Response) => {
  try {
    // ★ D131 후속: billing 고객사 사용자 목록에서 system 가상 계정 제외
    const result = await pool.query(
      `SELECT id, name, login_id, department, role
       FROM users WHERE company_id = $1 AND is_active = true AND COALESCE(is_system, false) = false
       ORDER BY name`,
      [req.params.companyId]
    );
    return res.json(result.rows);
  } catch (error: any) {
    console.error('사용자 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  정산 파라미터 라우트 (/:id — 리터럴 라우트 뒤에 배치)
// ============================================================

// GET /:id/items - 정산 일자별 상세
router.get('/:id/items', async (req: Request, res: Response) => {
  try {
    const billing = await pool.query(
      `SELECT b.*, c.company_name, u.name as user_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (billing.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    const items = await pool.query(
      `SELECT * FROM billing_items WHERE billing_id = $1 ORDER BY item_date ASC, message_type ASC`,
      [req.params.id]
    );

    return res.json({ billing: billing.rows[0], items: items.rows });
  } catch (error: any) {
    console.error('정산 상세 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /:id/status - 정산 상태 변경
router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'confirmed', 'paid'].includes(status)) {
      return res.status(400).json({ error: '유효한 상태: draft, confirmed, paid' });
    }
    const result = await pool.query(
      `UPDATE billings SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('정산 상태 변경 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /:id - 정산 삭제
router.delete('/:id', async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    // ★ 2026-07-25 삭제와 후불 크레딧 billed 되돌림을 한 트랜잭션으로.
    //   billed_invoice_id는 FK가 아니라 정산이 지워져도 billed=true가 그대로 남는다.
    //   화면은 기간 겹침 409에서 "삭제 후 재생성"을 안내하는데, 그대로 두면 재생성 시
    //   `billed = false` 필터에 걸려 그 충전분이 영구히 청구되지 않는다(정상 운영 동작에서 돈이 샌다).
    await client.query('BEGIN');

    const check = await client.query('SELECT id FROM billings WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (check.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }

    const restored = await client.query(
      `UPDATE ai_credit_requests
          SET billed = false, billed_invoice_id = NULL
        WHERE billed_invoice_id = $1::uuid
        RETURNING id`,
      [req.params.id]
    );

    // billing_items는 ON DELETE CASCADE로 자동 삭제 (billing_items_billing_id_fkey confdeltype='c' 실측)
    await client.query('DELETE FROM billings WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    if (restored.rowCount) {
      console.log(`[정산삭제] billing=${req.params.id} 후불 크레딧 충전 ${restored.rowCount}건 미청구 상태로 복구`);
    }
    return res.json({ success: true, restored_credit_requests: restored.rowCount || 0 });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch (rbError: any) {
      console.error('정산 삭제 롤백 실패:', rbError?.message || rbError);
    }
    console.error('정산 삭제 오류:', error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ============================================================
//  정산 PDF 생성
//  TODO: PDF 렌더링 로직을 services/pdfService.ts로 분리
// ============================================================

// GET /:id/pdf - 정산 PDF (2페이지: 요약 + 일자별 상세)
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    // 1) 정산 + 회사 정보
    const result = await pool.query(
      `SELECT b.*, c.company_name, c.business_number, c.ceo_name, c.address,
              c.contact_name, c.contact_phone, c.contact_email,
              c.business_type, c.business_category,
              u.name as user_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const bil = result.rows[0];

    // 2) 일자별 상세
    const itemsResult = await pool.query(
      `SELECT * FROM billing_items WHERE billing_id = $1 ORDER BY item_date ASC, message_type ASC`,
      [req.params.id]
    );
    const items = itemsResult.rows;

    // 3) PDF 생성
    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const pdfDir = path.join(__dirname, '../../pdfs');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const pdfFilename = `billing_${bil.id.slice(0, 8)}_${bil.billing_year}_${String(bil.billing_month).padStart(2, '0')}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
    const primary = '#4338ca';
    const dark = '#1f2937';
    const gray = '#6b7280';
    const n = (v: any) => Number(v) || 0;

    // ============================
    // PAGE 1 — 요약
    // ============================
    setFont(true);
    doc.fontSize(22).fillColor(primary).text('정산서', 50, 50);
    setFont(false);
    doc.fontSize(9).fillColor(gray).text('BILLING STATEMENT', 50, 78);

    const rightX = 350;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('정산번호:', rightX, 50, { continued: true });
    setFont(true);
    doc.fillColor(dark).text(`  BIL-${bil.id.slice(0, 8).toUpperCase()}`);
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('발행일:', rightX, 65, { continued: true });
    doc.fillColor(dark).text(`  ${new Date().toISOString().slice(0, 10)}`);
    const fmtDate = (d: any) => d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
    doc.text('정산기간:', rightX, 80, { continued: true });
    doc.fillColor(dark).text(`  ${fmtDate(bil.billing_start)} ~ ${fmtDate(bil.billing_end)}`);

    if (bil.user_name) {
      setFont(false);
      doc.fontSize(9).fillColor(gray);
      doc.text('사용자:', rightX, 98, { continued: true });
      doc.fillColor(dark).text(`  ${bil.user_name}`);
    }

    doc.moveTo(50, bil.user_name ? 118 : 115).lineTo(545, bil.user_name ? 118 : 115).strokeColor('#e5e7eb').stroke();

    // 공급자 / 공급받는자
    let y = 130;
    setFont(true);
    doc.fontSize(10).fillColor(primary).text('공급자', 50, y);
    setFont(false);
    doc.fontSize(9).fillColor(dark);
    y += 18;
    doc.text(`상호: ${INVITO_INFO.companyName}`, 50, y); y += 14;
    doc.text(`대표: ${INVITO_INFO.ceoName}`, 50, y); y += 14;
    doc.text(`사업자번호: ${INVITO_INFO.bizNumber}`, 50, y); y += 14;
    doc.text(`업태/종목: ${INVITO_INFO.bizType}`, 50, y); y += 14;
    doc.text(`주소: ${INVITO_INFO.address}`, 50, y); y += 14;
    doc.text(`연락처: ${INVITO_INFO.phone} / ${INVITO_INFO.email}`, 50, y);

    y = 130;
    setFont(true);
    doc.fontSize(10).fillColor(primary).text('공급받는자', rightX, y);
    setFont(false);
    doc.fontSize(9).fillColor(dark);
    y += 18;
    doc.text(`상호: ${bil.company_name || '-'}`, rightX, y); y += 14;
    doc.text(`대표: ${bil.ceo_name || '-'}`, rightX, y); y += 14;
    doc.text(`사업자번호: ${bil.business_number || '-'}`, rightX, y); y += 14;
    doc.text(`업태/종목: ${bil.business_type || '-'} / ${bil.business_category || '-'}`, rightX, y); y += 14;
    doc.text(`주소: ${bil.address || '-'}`, rightX, y); y += 14;
    doc.text(`연락처: ${bil.contact_phone || '-'} / ${bil.contact_email || '-'}`, rightX, y);

    doc.moveTo(50, 245).lineTo(545, 245).strokeColor('#e5e7eb').stroke();

    // 내역 테이블
    y = 260;
    doc.rect(50, y, 495, 25).fill(primary);
    setFont(true);
    doc.fontSize(9).fillColor('white');
    doc.text('항목', 60, y + 7);
    doc.text('수량', 250, y + 7, { width: 80, align: 'right' });
    doc.text('단가', 340, y + 7, { width: 80, align: 'right' });
    doc.text('금액', 430, y + 7, { width: 105, align: 'right' });
    y += 25;

    const drawRow = (label: string, count: number, price: number, amount: number, bg = 'white') => {
      if (count <= 0) return;
      if (bg !== 'white') doc.rect(50, y, 495, 22).fill(bg);
      setFont(false);
      doc.fontSize(9).fillColor(dark);
      doc.text(label, 60, y + 6);
      doc.text(count.toLocaleString(), 250, y + 6, { width: 80, align: 'right' });
      doc.text(`₩${price.toLocaleString()}`, 340, y + 6, { width: 80, align: 'right' });
      setFont(true);
      doc.text(`₩${amount.toLocaleString()}`, 430, y + 6, { width: 105, align: 'right' });
      y += 22;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
    };

    drawRow('SMS', n(bil.sms_success), n(bil.sms_unit_price), n(bil.sms_success) * n(bil.sms_unit_price));
    drawRow('LMS', n(bil.lms_success), n(bil.lms_unit_price), n(bil.lms_success) * n(bil.lms_unit_price));
    drawRow('MMS', n(bil.mms_success), n(bil.mms_unit_price), n(bil.mms_success) * n(bil.mms_unit_price));
    drawRow('카카오', n(bil.kakao_success), n(bil.kakao_unit_price), n(bil.kakao_success) * n(bil.kakao_unit_price));
    drawRow('테스트 SMS', n(bil.test_sms_count), n(bil.test_sms_unit_price), n(bil.test_sms_count) * n(bil.test_sms_unit_price), '#fefce8');
    drawRow('테스트 LMS', n(bil.test_lms_count), n(bil.test_lms_unit_price), n(bil.test_lms_count) * n(bil.test_lms_unit_price), '#fefce8');
    drawRow('스팸필터 SMS', n(bil.spam_filter_sms_count), n(bil.spam_filter_sms_unit_price), n(bil.spam_filter_sms_count) * n(bil.spam_filter_sms_unit_price), '#fef3c7');
    drawRow('스팸필터 LMS', n(bil.spam_filter_lms_count), n(bil.spam_filter_lms_unit_price), n(bil.spam_filter_lms_count) * n(bil.spam_filter_lms_unit_price), '#fef3c7');
    drawRow('AI 크레딧', n(bil.ai_credit_count), n(bil.ai_credit_count) > 0 ? Math.round(n(bil.ai_credit_supply) / n(bil.ai_credit_count)) : 0, n(bil.ai_credit_supply), '#f5f3ff');

    // 합계
    y += 15;
    const summaryX = 340;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('공급가액:', summaryX, y, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(bil.subtotal).toLocaleString()}`, 430, y, { width: 105, align: 'right' });
    y += 18;
    setFont(false);
    doc.fillColor(gray);
    doc.text('부가세 (10%):', summaryX, y, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(bil.vat).toLocaleString()}`, 430, y, { width: 105, align: 'right' });
    y += 22;

    doc.rect(summaryX - 10, y - 2, 225, 28).fill('#eef2ff');
    setFont(true);
    doc.fontSize(11).fillColor(primary);
    doc.text('합계:', summaryX, y + 5, { width: 80, align: 'right' });
    doc.fontSize(13).text(`₩${n(bil.total_amount).toLocaleString()}`, 430, y + 3, { width: 105, align: 'right' });

    if (bil.notes) {
      y += 50;
      setFont(true);
      doc.fontSize(9).fillColor(gray).text('비고:', 50, y);
      setFont(false);
      doc.fillColor(dark).text(bil.notes, 50, y + 15, { width: 495 });
    }

    doc.fontSize(8).fillColor(gray);
    doc.text('본 정산서는 INVITO Target-UP 시스템에서 자동 생성되었습니다.', 50, 770, { align: 'center', width: 495 });

    // ============================
    // PAGE 2+ — 일자별 상세
    // ============================
    if (items.length > 0) {
      doc.addPage();

      setFont(true);
      doc.fontSize(14).fillColor(primary).text('일자별 상세 내역', 50, 50);
      setFont(false);
      doc.fontSize(9).fillColor(gray).text(
        `${bil.company_name} | ${bil.billing_year}년 ${bil.billing_month}월${bil.user_name ? ' | ' + bil.user_name : ''}`,
        50, 72
      );

      doc.moveTo(50, 90).lineTo(545, 90).strokeColor('#e5e7eb').stroke();

      // 테이블 헤더
      const cols = [
        { label: '일자', x: 50, w: 75, align: 'left' as const },
        { label: '유형', x: 125, w: 60, align: 'left' as const },
        { label: '전송', x: 185, w: 55, align: 'right' as const },
        { label: '성공', x: 240, w: 55, align: 'right' as const },
        { label: '실패', x: 295, w: 55, align: 'right' as const },
        { label: '대기', x: 350, w: 55, align: 'right' as const },
        { label: '단가', x: 405, w: 65, align: 'right' as const },
        { label: '금액', x: 470, w: 75, align: 'right' as const },
      ];

      let iy = 95;
      const rowH = 18;
      const pageBottom = 760;

      const drawDetailHeader = () => {
        doc.rect(50, iy, 495, 22).fill('#f3f4f6');
        setFont(true);
        doc.fontSize(8).fillColor(gray);
        cols.forEach(c => doc.text(c.label, c.x + 4, iy + 6, { width: c.w - 8, align: c.align }));
        iy += 22;
      };

      drawDetailHeader();

      const typeLabel: Record<string, string> = {
        SMS: 'SMS', LMS: 'LMS', MMS: 'MMS', KAKAO: '카카오',
        TEST_SMS: '테스트SMS', TEST_LMS: '테스트LMS',
        SPAM_SMS: '스팸SMS', SPAM_LMS: '스팸LMS'
      };

      let detailSubtotal = 0;
      items.forEach((item: any, idx: number) => {
        // 페이지 넘김 체크
        if (iy + rowH > pageBottom) {
          setFont(false);
          doc.fontSize(8).fillColor(gray).text('(다음 페이지에 계속)', 50, iy + 5, { align: 'center', width: 495 });
          doc.addPage();
          iy = 50;
          setFont(true);
          doc.fontSize(10).fillColor(primary).text('일자별 상세 내역 (계속)', 50, iy);
          iy += 25;
          drawDetailHeader();
        }

        const isTest = item.message_type.startsWith('TEST');
        const isSpam = item.message_type.startsWith('SPAM');
        if (isSpam) doc.rect(50, iy, 495, rowH).fill('#fef3c7');
        else if (isTest) doc.rect(50, iy, 495, rowH).fill('#fefce8');
        else if (idx % 2 === 0) doc.rect(50, iy, 495, rowH).fill('#fafafa');

        setFont(false);
        doc.fontSize(8).fillColor(dark);
        const dateStr = item.item_date instanceof Date
          ? item.item_date.toISOString().slice(5, 10)
          : String(item.item_date).slice(5, 10);
        doc.text(dateStr, cols[0].x + 4, iy + 5, { width: cols[0].w - 8 });
        doc.text(typeLabel[item.message_type] || item.message_type, cols[1].x + 4, iy + 5, { width: cols[1].w - 8 });
        doc.text(n(item.total_count).toLocaleString(), cols[2].x + 4, iy + 5, { width: cols[2].w - 8, align: 'right' });
        doc.text(n(item.success_count).toLocaleString(), cols[3].x + 4, iy + 5, { width: cols[3].w - 8, align: 'right' });

        if (n(item.fail_count) > 0) doc.fillColor('#dc2626');
        doc.text(n(item.fail_count).toLocaleString(), cols[4].x + 4, iy + 5, { width: cols[4].w - 8, align: 'right' });
        doc.fillColor(dark);

        doc.text(n(item.pending_count).toLocaleString(), cols[5].x + 4, iy + 5, { width: cols[5].w - 8, align: 'right' });
        doc.text(`₩${n(item.unit_price).toLocaleString()}`, cols[6].x + 4, iy + 5, { width: cols[6].w - 8, align: 'right' });
        setFont(true);
        doc.text(`₩${n(item.amount).toLocaleString()}`, cols[7].x + 4, iy + 5, { width: cols[7].w - 8, align: 'right' });

        detailSubtotal += n(item.amount);
        iy += rowH;
        doc.moveTo(50, iy).lineTo(545, iy).strokeColor('#eeeeee').stroke();
      });

      // 합계 행
      iy += 4;
      doc.rect(50, iy, 495, 22).fill('#eef2ff');
      setFont(true);
      doc.fontSize(9).fillColor(primary);
      doc.text('합계', cols[0].x + 4, iy + 6);
      doc.text(`₩${detailSubtotal.toLocaleString()}`, cols[7].x + 4, iy + 6, { width: cols[7].w - 8, align: 'right' });
    }

    doc.end();
    await new Promise<void>((resolve) => stream.on('finish', resolve));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('정산 PDF 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});


// ============================================================
//  거래내역서(Invoice) API
// ============================================================

// GET /preview - 정산 미리보기 = 발행 드라이런
//   ★ 2026-07-25 전면 재작성. 자체 SQL을 전부 버리고 발행(`POST /generate`)과 **같은 함수**를 호출한다.
//   기존 미리보기는 발행과 네 축이 달라 같은 기간인데 금액이 어긋났다:
//     ① campaign_runs 상태조건 없음(발행은 status='completed'만) → 미완료 발송까지 셈
//     ② 일반발송에 sendreq_time 기간조건을 덧붙임(발행은 run 집합으로만 기간을 정함)
//     ③ 브랜드메시지 REQUEST_DATE 기간조건 없음(발행은 있음)
//     ④ 후불 AI 크레딧 미포함(발행은 청구에 합산)
//   미리보기가 실제 청구액과 다르면 그걸 보고 발행하는 사람이 틀린 금액을 승인하게 된다.
//   여기서는 계산만 하고 아무것도 쓰지 않는다 — billed 플래그는 발행에서만 바뀐다.
router.get('/preview', async (req: Request, res: Response) => {
  try {
    const { company_id, start, end, type = 'combined', user_id } = req.query;

    if (!company_id || !start || !end) {
      return res.status(400).json({ error: '필수 파라미터: company_id, start, end' });
    }
    const companyId = String(company_id);
    const startDate = String(start);
    const endDate = String(end);
    const userId = user_id ? String(user_id) : undefined;

    // 1) 회사 단가 — 발행과 같은 해석(명시된 0원 보존)
    const companyResult = await pool.query(
      `SELECT company_name, billing_type,
              cost_per_sms, cost_per_lms, cost_per_mms, cost_per_kakao,
              cost_per_test_sms, cost_per_test_lms, service_type
       FROM companies WHERE id = $1`,
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '고객사를 찾을 수 없습니다' });
    }
    const company = companyResult.rows[0];
    const prices = resolveBillingUnitPrices(company);
    // 미리보기는 계산만 하므로 선불 회사도 막지 않는다. 대신 발행이 차단된다는 사실을 함께 돌려준다.
    const billable = company.billing_type !== 'prepaid';

    // 2) 사용량 — 발행과 완전히 같은 집계(일반·테스트·스팸·브랜드메시지 전부 포함)
    const dayData = await buildCompanyUsageByDay({ companyId, startDate, endDate, userId });
    const totals = buildBillingTotals(dayData);
    const unbillable = logUnbillableUsageKeys(dayData, `미리보기 company=${companyId} ${startDate}~${endDate}`);

    // 3) 후불 AI 크레딧 — 발행과 같은 기준. 읽기만 하고 billed는 건드리지 않는다.
    //    사용자 지정이면 발행이 크레딧을 청구하지 않으므로 미리보기도 0으로 둔다(금액 일치).
    let chargeSupply = 0, chargeCount = 0, overageCount = 0;
    if (!userId) {
      const creditChargeRes = await pool.query(
        `SELECT credits, supply_amount FROM ai_credit_requests
          WHERE company_id = $1::uuid AND status = 'approved' AND billed = false
            AND processed_at::date >= $2 AND processed_at::date <= $3`,
        [companyId, startDate, endDate]
      );
      chargeSupply = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0);
      chargeCount = creditChargeRes.rows.reduce((s: number, r: any) => s + Number(r.credits || 0), 0);
      const overageRes = await pool.query(
        `SELECT COALESCE(SUM(overage_credits), 0) AS oc FROM ai_credit_transactions
          WHERE company_id = $1::uuid AND type = 'deduct' AND overage_credits > 0
            AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
        [companyId, startDate, endDate]
      );
      overageCount = Number(overageRes.rows[0]?.oc) || 0;
    }
    const aiCreditCount = chargeCount + overageCount;
    const aiCreditSupply = chargeSupply + overageCount * CREDIT_UNIT_PRICE;

    // 4) 금액 — 발행과 같은 식
    const subtotal =
      (totals.SMS * prices.SMS) + (totals.LMS * prices.LMS) +
      (totals.MMS * prices.MMS) + (totals.KAKAO * prices.KAKAO) +
      (totals.TEST_SMS * prices.TEST_SMS) + (totals.TEST_LMS * prices.TEST_LMS) +
      (totals.SPAM_SMS * prices.SPAM_SMS) + (totals.SPAM_LMS * prices.SPAM_LMS) +
      aiCreditSupply;
    const vat = Math.round(subtotal * 0.1);
    const totalAmount = subtotal + vat;

    const test = {
      test_sms: totals.TEST_SMS,
      test_lms: totals.TEST_LMS,
      test_sms_amount: totals.TEST_SMS * prices.TEST_SMS,
      test_lms_amount: totals.TEST_LMS * prices.TEST_LMS,
    };
    const spam = {
      spam_sms: totals.SPAM_SMS,
      spam_lms: totals.SPAM_LMS,
      spam_sms_amount: totals.SPAM_SMS * prices.SPAM_SMS,
      spam_lms_amount: totals.SPAM_LMS * prices.SPAM_LMS,
    };
    const ai_credit = { count: aiCreditCount, supply_amount: aiCreditSupply };
    const amounts = { subtotal, vat, total_amount: totalAmount };
    // 발행 가능 여부를 미리보기에서 먼저 알린다 — 선불 회사는 발행이 400으로 막힌다.
    const billing_guard = {
      billable,
      billing_type: company.billing_type || null,
      reason: billable ? null : '선불 고객사 — 발송 시점에 잔액에서 이미 차감되어 월 정산서 발행 시 이중 청구',
      unbillable_types: unbillable,
    };

    if (type === 'brand') {
      // 매장(발신번호) 축은 청구 집계에 없다. 그래서 **같은 run 집합·같은 테이블·같은 where**를 매장별로
      // 나누기만 한다 — 그러면 매장 합계가 아래 combined 합계와 항상 일치한다.
      // (기간조건을 덧붙이면 그 순간 두 숫자가 갈라진다. 그게 이번에 고친 결함이다.)
      const runIds = await selectBillingRunIds({ companyId, startDate, endDate, userId });
      const brandMap: Record<string, any> = {};
      const ensureStore = (code: string, name: string) => {
        if (!brandMap[code]) {
          brandMap[code] = { store_code: code, store_name: name, sms_success: 0, lms_success: 0, mms_success: 0, kakao_success: 0 };
        }
        return brandMap[code];
      };

      let queueKakao = 0;
      if (runIds.length > 0) {
        const storeRes = await pool.query(
          `SELECT cr.id AS run_id, cb.store_code, cb.store_name
             FROM campaign_runs cr
             JOIN campaigns c ON c.id = cr.campaign_id
             LEFT JOIN callback_numbers cb ON cb.phone = c.callback_number AND cb.company_id = c.company_id
            WHERE cr.id = ANY($1::uuid[])
            UNION
           SELECT c2.id AS run_id, cb2.store_code, cb2.store_name
             FROM campaigns c2
             LEFT JOIN callback_numbers cb2 ON cb2.phone = c2.callback_number AND cb2.company_id = c2.company_id
            WHERE c2.id = ANY($1::uuid[])`,
          [runIds]
        );
        const storeMap: Record<string, { store_code: string; store_name: string }> = {};
        storeRes.rows.forEach((r: any) => {
          storeMap[r.run_id] = { store_code: r.store_code || 'default', store_name: r.store_name || '본사' };
        });

        const companyTables = await getBillingCompanyTables(companyId);
        const billingTables = await getTablesForBillingPeriod(companyTables, startDate, endDate);
        const ph = runIds.map(() => '?').join(',');
        const rows = await smsAggByRunAndType(billingTables, `app_etc1 IN (${ph})`, runIds);
        rows.forEach((row: any) => {
          const store = storeMap[row.run_id] || { store_code: 'default', store_name: '본사' };
          const b = ensureStore(store.store_code, store.store_name);
          const n = Number(row.success_count) || 0;
          switch (MSG_TYPE_TO_USAGE_KEY[row.msg_type]) {
            case 'SMS': b.sms_success += n; break;
            case 'LMS': b.lms_success += n; break;
            case 'MMS': b.mms_success += n; break;
            case 'KAKAO': b.kakao_success += n; queueKakao += n; break;
          }
        });
      }

      // 브랜드메시지(IMC)는 매장 축이 없다 — 큐에서 센 알림톡을 뺀 차액을 본사로 몰아 합계를 맞춘다.
      const imcKakao = Math.max(0, totals.KAKAO - queueKakao);
      if (imcKakao > 0) ensureStore('default', '본사').kakao_success += imcKakao;

      const brands = Object.values(brandMap).map((b: any) => ({
        ...b,
        sms_amount: b.sms_success * prices.SMS,
        lms_amount: b.lms_success * prices.LMS,
        mms_amount: b.mms_success * prices.MMS,
        kakao_amount: b.kakao_success * prices.KAKAO,
      }));

      return res.json({ type: 'brand', brands, test, spam, ai_credit, amounts, billing_guard });
    }

    const summary = {
      sms_success: totals.SMS,
      lms_success: totals.LMS,
      mms_success: totals.MMS,
      kakao_success: totals.KAKAO,
      sms_amount: totals.SMS * prices.SMS,
      lms_amount: totals.LMS * prices.LMS,
      mms_amount: totals.MMS * prices.MMS,
      kakao_amount: totals.KAKAO * prices.KAKAO,
    };

    return res.json({ type: 'combined', summary, test, spam, ai_credit, amounts, billing_guard });
  } catch (error: any) {
    const emsg = error?.message || '';
    if (emsg.includes('column') && emsg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — ai_credit_transactions.overage_credits 컬럼 ALTER 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('정산 미리보기 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ※ 옛 buildTestSummary·buildSpamSummary는 삭제했다(2026-07-25).
//   테스트·스팸 수량도 발행과 같은 집계(buildCompanyUsageByDay의 TEST_*/SPAM_* 유형키)에서 나온다.
//   같은 숫자를 두 군데서 따로 세면 언젠가 갈라진다.

// POST /invoices - 거래내역서 생성
router.post('/invoices', async (req: Request, res: Response) => {
  try {
    const {
      company_id, store_code, store_name, billing_start, billing_end,
      invoice_type = 'combined', billing_id,
      sms_success_count = 0, sms_unit_price = 0,
      lms_success_count = 0, lms_unit_price = 0,
      mms_success_count = 0, mms_unit_price = 0,
      kakao_success_count = 0, kakao_unit_price = 0,
      test_sms_count = 0, test_sms_unit_price = 0,
      test_lms_count = 0, test_lms_unit_price = 0,
      spam_filter_count = 0, spam_filter_unit_price = 0,
      notes, created_by
    } = req.body;

    if (!company_id || !billing_start || !billing_end) {
      return res.status(400).json({ error: '필수: company_id, billing_start, billing_end' });
    }

    const subtotal =
      (sms_success_count * sms_unit_price) +
      (lms_success_count * lms_unit_price) +
      (mms_success_count * mms_unit_price) +
      (kakao_success_count * kakao_unit_price) +
      (test_sms_count * test_sms_unit_price) +
      (test_lms_count * test_lms_unit_price) +
      (spam_filter_count * spam_filter_unit_price);
    const vat = Math.round(subtotal * 0.1);
    const total_amount = subtotal + vat;

    const result = await pool.query(
      `INSERT INTO billing_invoices (
        company_id, store_code, store_name, billing_start, billing_end, invoice_type, billing_id,
        sms_success_count, sms_unit_price, lms_success_count, lms_unit_price,
        mms_success_count, mms_unit_price, kakao_success_count, kakao_unit_price,
        test_sms_count, test_sms_unit_price, test_lms_count, test_lms_unit_price,
        spam_filter_count, spam_filter_unit_price,
        subtotal, vat, total_amount, status, notes, created_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'draft',$25,$26
      ) RETURNING *`,
      [
        company_id, store_code || null, store_name || null, billing_start, billing_end, invoice_type, billing_id || null,
        sms_success_count, sms_unit_price, lms_success_count, lms_unit_price,
        mms_success_count, mms_unit_price, kakao_success_count, kakao_unit_price,
        test_sms_count, test_sms_unit_price, test_lms_count, test_lms_unit_price,
        spam_filter_count, spam_filter_unit_price,
        subtotal, vat, total_amount, notes || null, created_by || null
      ]
    );

    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('거래내역서 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /invoices - 거래내역서 목록
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    const { company_id, status } = req.query;
    // ★ 수정: c.name → c.company_name (companies 테이블 컬럼명 일치)
    let sql = `SELECT bi.*, c.company_name
               FROM billing_invoices bi
               JOIN companies c ON c.id = bi.company_id
               WHERE 1=1`;
    const params: any[] = [];

    if (company_id) { params.push(company_id); sql += ` AND bi.company_id = $${params.length}`; }
    if (status) { params.push(status); sql += ` AND bi.status = $${params.length}`; }
    sql += ' ORDER BY bi.created_at DESC';

    const result = await pool.query(sql, params);
    return res.json(result.rows);
  } catch (error: any) {
    console.error('거래내역서 목록 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /invoices/:id - 거래내역서 상세
router.get('/invoices/:id', async (req: Request, res: Response) => {
  try {
    // ★ 수정: c.name → c.company_name
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.business_number, c.ceo_name, c.address
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('거래내역서 상세 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /invoices/:id/status - 상태 변경
router.put('/invoices/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['draft', 'confirmed', 'paid'].includes(status)) {
      return res.status(400).json({ error: '유효한 상태: draft, confirmed, paid' });
    }
    const result = await pool.query(
      `UPDATE billing_invoices SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    return res.json(result.rows[0]);
  } catch (error: any) {
    console.error('상태 변경 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  거래내역서 PDF
//  TODO: 정산 PDF와 공통 렌더링 로직을 services/pdfService.ts로 분리
// ============================================================

// GET /invoices/:id/pdf - PDF 거래내역서 생성 & 다운로드
router.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.business_number, c.ceo_name, c.address,
              c.contact_name, c.contact_phone, c.contact_email, c.business_type, c.business_category
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    const inv = result.rows[0];

    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');

    const fontPath = path.join(__dirname, '../../fonts/malgun.ttf');
    const fontBoldPath = path.join(__dirname, '../../fonts/malgunbd.ttf');
    const hasFont = fs.existsSync(fontPath);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const pdfDir = path.join(__dirname, '../../pdfs');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    const bStart = inv.billing_start instanceof Date ? inv.billing_start.toISOString().slice(0, 10) : String(inv.billing_start).slice(0, 10);
    const bEnd = inv.billing_end instanceof Date ? inv.billing_end.toISOString().slice(0, 10) : String(inv.billing_end).slice(0, 10);
    const pdfFilename = `invoice_${inv.id.slice(0, 8)}_${bStart}_${bEnd}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const setFont = (bold = false) => { if (hasFont) doc.font(bold ? fontBoldPath : fontPath); };
    const primary = '#4338ca';
    const dark = '#1f2937';
    const gray = '#6b7280';

    // 헤더
    setFont(true);
    doc.fontSize(22).fillColor(primary).text('거래내역서', 50, 50);
    setFont(false);
    doc.fontSize(9).fillColor(gray).text('INVOICE', 50, 78);

    const rightX = 350;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('내역서 번호:', rightX, 50, { continued: true });
    setFont(true);
    doc.fillColor(dark).text(`  INV-${inv.id.slice(0, 8).toUpperCase()}`);
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('발행일:', rightX, 65, { continued: true });
    doc.fillColor(dark).text(`  ${new Date().toISOString().slice(0, 10)}`);
    doc.text('정산기간:', rightX, 80, { continued: true });
    doc.fillColor(dark).text(`  ${bStart} ~ ${bEnd}`);

    doc.moveTo(50, 105).lineTo(545, 105).strokeColor('#e5e7eb').stroke();

    // 공급자 / 공급받는자
    let iy = 120;
    setFont(true);
    doc.fontSize(10).fillColor(primary).text('공급자', 50, iy);
    setFont(false);
    doc.fontSize(9).fillColor(dark);
    iy += 18;
    doc.text(`상호: ${INVITO_INFO.companyName}`, 50, iy); iy += 14;
    doc.text(`대표: ${INVITO_INFO.ceoName}`, 50, iy); iy += 14;
    doc.text(`사업자번호: ${INVITO_INFO.bizNumber}`, 50, iy); iy += 14;
    doc.text(`업태/종목: ${INVITO_INFO.bizType}`, 50, iy); iy += 14;
    doc.text(`주소: ${INVITO_INFO.address}`, 50, iy); iy += 14;
    doc.text(`연락처: ${INVITO_INFO.phone} / ${INVITO_INFO.email}`, 50, iy);

    iy = 120;
    setFont(true);
    doc.fontSize(10).fillColor(primary).text('공급받는자', rightX, iy);
    setFont(false);
    doc.fontSize(9).fillColor(dark);
    iy += 18;
    doc.text(`상호: ${inv.company_name || '-'}`, rightX, iy); iy += 14;
    doc.text(`대표: ${inv.ceo_name || '-'}`, rightX, iy); iy += 14;
    doc.text(`사업자번호: ${inv.business_number || '-'}`, rightX, iy); iy += 14;
    doc.text(`업태/종목: ${inv.business_type || '-'} / ${inv.business_category || '-'}`, rightX, iy); iy += 14;
    doc.text(`주소: ${inv.address || '-'}`, rightX, iy); iy += 14;
    doc.text(`연락처: ${inv.contact_phone || '-'} / ${inv.contact_email || '-'}`, rightX, iy);

    doc.moveTo(50, 230).lineTo(545, 230).strokeColor('#e5e7eb').stroke();

    iy = 240;
    if (inv.store_name && inv.invoice_type === 'brand') {
      setFont(false);
      doc.fontSize(9).fillColor(gray).text(`브랜드: ${inv.store_name} (${inv.store_code || ''})`, 50, iy);
      iy += 20;
    }

    // 내역 테이블
    doc.rect(50, iy, 495, 25).fill(primary);
    setFont(true);
    doc.fontSize(9).fillColor('white');
    doc.text('항목', 60, iy + 7);
    doc.text('수량', 250, iy + 7, { width: 80, align: 'right' });
    doc.text('단가', 340, iy + 7, { width: 80, align: 'right' });
    doc.text('금액', 430, iy + 7, { width: 105, align: 'right' });
    iy += 25;

    const drawInvRow = (label: string, count: number, price: number, amount: number, bg = 'white') => {
      if (count <= 0) return;
      if (bg !== 'white') doc.rect(50, iy, 495, 22).fill(bg);
      setFont(false);
      doc.fontSize(9).fillColor(dark);
      doc.text(label, 60, iy + 6);
      doc.text(count.toLocaleString(), 250, iy + 6, { width: 80, align: 'right' });
      doc.text(`₩${price.toLocaleString()}`, 340, iy + 6, { width: 80, align: 'right' });
      setFont(true);
      doc.text(`₩${amount.toLocaleString()}`, 430, iy + 6, { width: 105, align: 'right' });
      iy += 22;
      doc.moveTo(50, iy).lineTo(545, iy).strokeColor('#e5e7eb').stroke();
    };

    const n = (v: any) => Number(v) || 0;
    drawInvRow('SMS', n(inv.sms_success_count), n(inv.sms_unit_price), n(inv.sms_success_count) * n(inv.sms_unit_price));
    drawInvRow('LMS', n(inv.lms_success_count), n(inv.lms_unit_price), n(inv.lms_success_count) * n(inv.lms_unit_price));
    drawInvRow('MMS', n(inv.mms_success_count), n(inv.mms_unit_price), n(inv.mms_success_count) * n(inv.mms_unit_price));
    drawInvRow('카카오', n(inv.kakao_success_count), n(inv.kakao_unit_price), n(inv.kakao_success_count) * n(inv.kakao_unit_price));
    drawInvRow('테스트 SMS', n(inv.test_sms_count), n(inv.test_sms_unit_price), n(inv.test_sms_count) * n(inv.test_sms_unit_price), '#fefce8');
    drawInvRow('테스트 LMS', n(inv.test_lms_count), n(inv.test_lms_unit_price), n(inv.test_lms_count) * n(inv.test_lms_unit_price), '#fefce8');
    drawInvRow('스팸필터', n(inv.spam_filter_count), n(inv.spam_filter_unit_price), n(inv.spam_filter_count) * n(inv.spam_filter_unit_price), '#fef3c7');

    // 합계
    iy += 15;
    const invSummaryX = 340;
    setFont(false);
    doc.fontSize(9).fillColor(gray);
    doc.text('공급가액:', invSummaryX, iy, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(inv.subtotal).toLocaleString()}`, 430, iy, { width: 105, align: 'right' });
    iy += 18;
    setFont(false);
    doc.fillColor(gray);
    doc.text('부가세 (10%):', invSummaryX, iy, { width: 80, align: 'right' });
    setFont(true);
    doc.fillColor(dark).text(`₩${n(inv.vat).toLocaleString()}`, 430, iy, { width: 105, align: 'right' });
    iy += 22;

    doc.rect(invSummaryX - 10, iy - 2, 225, 28).fill('#eef2ff');
    setFont(true);
    doc.fontSize(11).fillColor(primary);
    doc.text('합계:', invSummaryX, iy + 5, { width: 80, align: 'right' });
    doc.fontSize(13).text(`₩${n(inv.total_amount).toLocaleString()}`, 430, iy + 3, { width: 105, align: 'right' });

    if (inv.notes) {
      iy += 50;
      setFont(true);
      doc.fontSize(9).fillColor(gray).text('비고:', 50, iy);
      setFont(false);
      doc.fillColor(dark).text(inv.notes, 50, iy + 15, { width: 495 });
    }

    doc.fontSize(8).fillColor(gray);
    doc.text('본 거래내역서는 INVITO Target-UP 시스템에서 자동 생성되었습니다.', 50, 770, { align: 'center', width: 495 });

    doc.end();
    await new Promise<void>((resolve) => stream.on('finish', resolve));

    await pool.query(
      'UPDATE billing_invoices SET pdf_path = $1, updated_at = now() WHERE id = $2',
      [pdfPath, req.params.id]
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(pdfFilename)}"`);
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);

  } catch (error: any) {
    console.error('PDF 생성 오류:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ============================================================
//  정산서 메일 발송
// ============================================================

// POST /:id/send-email - 정산서 PDF 메일 발송
router.post('/:id/send-email', async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');

    // 1) 정산 + 회사 정보 조회
    const result = await pool.query(
      `SELECT b.*, c.company_name, c.contact_email, c.contact_name
       FROM billings b
       JOIN companies c ON c.id = b.company_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '정산을 찾을 수 없습니다' });
    }
    const bil = result.rows[0];

    if (!bil.contact_email) {
      return res.status(400).json({ error: '고객사 담당자 이메일이 등록되어 있지 않습니다.' });
    }

    // 2) PDF 파일 확인 — 없으면 생성 요청
    const pdfDir = path.join(__dirname, '../../pdfs');
    const pdfFilename = `billing_${bil.id.slice(0, 8)}_${bil.billing_year}_${String(bil.billing_month).padStart(2, '0')}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);

    if (!fs.existsSync(pdfPath)) {
      return res.status(400).json({ error: 'PDF가 아직 생성되지 않았습니다. 먼저 PDF를 다운로드해주세요.' });
    }

    const n = (v: any) => Number(v) || 0;
    const bStart = bil.billing_start instanceof Date ? bil.billing_start.toISOString().slice(0,10) : String(bil.billing_start).slice(0,10);
    const bEnd = bil.billing_end instanceof Date ? bil.billing_end.toISOString().slice(0,10) : String(bil.billing_end).slice(0,10);

    // 3) 메일 발송
    const htmlBody = `
      <div style="font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #4338ca, #6366F1); padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">📊 정산서 안내</h2>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${bil.company_name} | ${bil.billing_year}년 ${bil.billing_month}월</p>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E5E7EB; border-top: none;">
          <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">
            안녕하세요, ${bil.contact_name || bil.company_name} 담당자님.<br/>
            <strong>${bStart} ~ ${bEnd}</strong> 기간 정산서를 안내드립니다.
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">SMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(bil.sms_success).toLocaleString()}건 × ₩${n(bil.sms_unit_price).toLocaleString()}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(bil.sms_success) * n(bil.sms_unit_price)).toLocaleString()}</td>
            </tr>
            <tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">LMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(bil.lms_success).toLocaleString()}건 × ₩${n(bil.lms_unit_price).toLocaleString()}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(bil.lms_success) * n(bil.lms_unit_price)).toLocaleString()}</td>
            </tr>
            ${n(bil.mms_success) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">MMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(bil.mms_success).toLocaleString()}건 × ₩${n(bil.mms_unit_price).toLocaleString()}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(bil.mms_success) * n(bil.mms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(bil.test_sms_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #FFFBEB;">
              <td style="padding: 8px 0; color: #6B7280;">테스트 SMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(bil.test_sms_count).toLocaleString()}건 × ₩${n(bil.test_sms_unit_price).toLocaleString()}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(bil.test_sms_count) * n(bil.test_sms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(bil.test_lms_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #FFFBEB;">
              <td style="padding: 8px 0; color: #6B7280;">테스트 LMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(bil.test_lms_count).toLocaleString()}건 × ₩${n(bil.test_lms_unit_price).toLocaleString()}</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(bil.test_lms_count) * n(bil.test_lms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${(n(bil.spam_filter_sms_count) + n(bil.spam_filter_lms_count)) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #FEF3C7;">
              <td style="padding: 8px 0; color: #6B7280;">스팸필터</td>
              <td style="padding: 8px 0; text-align: right;">SMS ${n(bil.spam_filter_sms_count).toLocaleString()}건 + LMS ${n(bil.spam_filter_lms_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(bil.spam_filter_sms_count) * n(bil.spam_filter_sms_unit_price) + n(bil.spam_filter_lms_count) * n(bil.spam_filter_lms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(bil.ai_credit_supply) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #F5F3FF;">
              <td style="padding: 8px 0; color: #6B7280;">AI 크레딧</td>
              <td style="padding: 8px 0; text-align: right;">${n(bil.ai_credit_count).toLocaleString()} 크레딧</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${n(bil.ai_credit_supply).toLocaleString()}</td>
            </tr>` : ''}
          </table>
          <div style="background: #EEF2FF; padding: 16px; border-radius: 8px; text-align: right;">
            <span style="font-size: 13px; color: #6B7280;">공급가액 ₩${n(bil.subtotal).toLocaleString()} + VAT ₩${n(bil.vat).toLocaleString()}</span><br/>
            <span style="font-size: 20px; font-weight: 700; color: #4338CA;">합계 ₩${n(bil.total_amount).toLocaleString()}</span>
          </div>
          <p style="font-size: 13px; color: #9CA3AF; margin-top: 16px;">
            상세 내역은 첨부된 PDF를 확인해주세요.<br/>
            문의사항이 있으시면 ${INVITO_INFO.phone}로 연락 부탁드립니다.
          </p>
        </div>
        <div style="padding: 16px; text-align: center; font-size: 11px; color: #9CA3AF; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; background: #F9FAFB;">
          본 메일은 INVITO 한줄로 시스템에서 자동 발송되었습니다.
        </div>
      </div>
    `;

    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"INVITO 정산" <${process.env.SMTP_USER}>`,
      to: bil.contact_email,
      bcc: process.env.SMTP_BCC || '',
      subject: `[INVITO] ${bil.company_name} ${bil.billing_year}년 ${bil.billing_month}월 정산서`,
      html: htmlBody,
      attachments: [{ filename: pdfFilename, path: pdfPath }],
    });

    // 4) 발송 기록
    await pool.query(
      'UPDATE billings SET email_sent_at = now(), updated_at = now() WHERE id = $1',
      [req.params.id]
    );

    return res.json({ message: '정산서 메일이 발송되었습니다.', sent_to: bil.contact_email });
  } catch (error: any) {
    console.error('정산서 메일 발송 오류:', error);
    return res.status(500).json({ error: '메일 발송에 실패했습니다: ' + error.message });
  }
});

// ============================================================
//  거래내역서 메일 발송 (리터럴 라우트 — /:id 보다 먼저!)
// ============================================================

// POST /invoices/:id/send-email - 거래내역서 PDF 메일 발송
router.post('/invoices/:id/send-email', async (req: Request, res: Response) => {
  try {
    const fs = require('fs');
    const path = require('path');

    // 1) 거래내역서 + 회사 정보 조회
    const result = await pool.query(
      `SELECT bi.*, c.company_name, c.contact_email, c.contact_name
       FROM billing_invoices bi
       JOIN companies c ON c.id = bi.company_id
       WHERE bi.id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래내역서를 찾을 수 없습니다' });
    }
    const inv = result.rows[0];

    if (!inv.contact_email) {
      return res.status(400).json({ error: '고객사 담당자 이메일이 등록되어 있지 않습니다.' });
    }

    // 2) PDF 파일 확인
    const pdfDir = path.join(__dirname, '../../pdfs');
    const bStart = inv.billing_start instanceof Date ? inv.billing_start.toISOString().slice(0,10) : String(inv.billing_start).slice(0,10);
    const bEnd = inv.billing_end instanceof Date ? inv.billing_end.toISOString().slice(0,10) : String(inv.billing_end).slice(0,10);
    const pdfFilename = `invoice_${inv.id.slice(0, 8)}_${bStart}_${bEnd}.pdf`;
    const pdfPath = path.join(pdfDir, pdfFilename);

    if (!fs.existsSync(pdfPath)) {
      return res.status(400).json({ error: 'PDF가 아직 생성되지 않았습니다. 먼저 PDF를 다운로드해주세요.' });
    }

    const n = (v: any) => Number(v) || 0;

    // 3) 메일 발송
    const htmlBody = `
      <div style="font-family: 'Apple SD Gothic Neo', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #4338ca, #6366F1); padding: 24px; border-radius: 12px 12px 0 0;">
          <h2 style="color: white; margin: 0; font-size: 20px;">📋 거래내역서 안내</h2>
          <p style="color: rgba(255,255,255,0.8); margin: 8px 0 0; font-size: 14px;">${inv.company_name}${inv.store_name ? ` / ${inv.store_name}` : ''} | ${bStart} ~ ${bEnd}</p>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #E5E7EB; border-top: none;">
          <p style="font-size: 14px; color: #374151; margin: 0 0 16px;">
            안녕하세요, ${inv.contact_name || inv.company_name} 담당자님.<br/>
            <strong>${bStart} ~ ${bEnd}</strong> 기간 거래내역서를 안내드립니다.
          </p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
            ${n(inv.sms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">SMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.sms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.sms_success_count) * n(inv.sms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.lms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">LMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.lms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.lms_success_count) * n(inv.lms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.mms_success_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6;">
              <td style="padding: 8px 0; color: #6B7280;">MMS</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.mms_success_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.mms_success_count) * n(inv.mms_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
            ${n(inv.spam_filter_count) > 0 ? `<tr style="border-bottom: 1px solid #F3F4F6; background: #FEF3C7;">
              <td style="padding: 8px 0; color: #6B7280;">스팸필터</td>
              <td style="padding: 8px 0; text-align: right;">${n(inv.spam_filter_count).toLocaleString()}건</td>
              <td style="padding: 8px 0; text-align: right; font-weight: 600;">₩${(n(inv.spam_filter_count) * n(inv.spam_filter_unit_price)).toLocaleString()}</td>
            </tr>` : ''}
          </table>
          <div style="background: #EEF2FF; padding: 16px; border-radius: 8px; text-align: right;">
            <span style="font-size: 13px; color: #6B7280;">공급가액 ₩${n(inv.subtotal).toLocaleString()} + VAT ₩${n(inv.vat).toLocaleString()}</span><br/>
            <span style="font-size: 20px; font-weight: 700; color: #4338CA;">합계 ₩${n(inv.total_amount).toLocaleString()}</span>
          </div>
          <p style="font-size: 13px; color: #9CA3AF; margin-top: 16px;">
            상세 내역은 첨부된 PDF를 확인해주세요.<br/>
            문의사항이 있으시면 ${INVITO_INFO.phone}로 연락 부탁드립니다.
          </p>
        </div>
        <div style="padding: 16px; text-align: center; font-size: 11px; color: #9CA3AF; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; background: #F9FAFB;">
          본 메일은 INVITO 한줄로 시스템에서 자동 발송되었습니다.
        </div>
      </div>
    `;

    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"INVITO 정산" <${process.env.SMTP_USER}>`,
      to: inv.contact_email,
      bcc: process.env.SMTP_BCC || '',
      subject: `[INVITO] ${inv.company_name}${inv.store_name ? ` (${inv.store_name})` : ''} 거래내역서 (${bStart} ~ ${bEnd})`,
      html: htmlBody,
      attachments: [{ filename: pdfFilename, path: pdfPath }],
    });

    // 4) 발송 기록
    await pool.query(
      'UPDATE billing_invoices SET email_sent_at = now(), updated_at = now() WHERE id = $1',
      [req.params.id]
    );

    return res.json({ message: '거래내역서 메일이 발송되었습니다.', sent_to: inv.contact_email });
  } catch (error: any) {
    console.error('거래내역서 메일 발송 오류:', error);
    return res.status(500).json({ error: '메일 발송에 실패했습니다: ' + error.message });
  }
});

export default router;
