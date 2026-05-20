// routes/payments.ts — 이니시스 표준결제 라우트
// SoT: status/legacy-payment-migration.md §6-3
// CT-41 inicis-client + CT-42 payment-processor 통합

import { Router, Request, Response, urlencoded } from 'express';
import { pool } from '../config/database';
import { authenticate } from '../middlewares/auth';
import {
  prepareInicisPayment,
  approveInicisPayment,
  netCancelInicisPayment,
  generateOrderId,
  type InicisCallbackBody,
} from '../utils/inicis-client';
import {
  createPendingPayment,
  finalizePaymentSuccess,
  finalizePaymentFailure,
} from '../utils/payment-processor';

const router = Router();

// 이니시스 callback form POST는 application/x-www-form-urlencoded
const inicisFormParser = urlencoded({ extended: true, limit: '1mb' });

// ── 공용 helper: 결제 결과 HTML 응답 영역 ────────────────────────

function renderResultHtml(status: 'success' | 'failed' | 'cancelled', data: Record<string, any>): string {
  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://app.hanjul.ai';
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
  const safeStatus = escape(status);
  const dataJson = JSON.stringify({ type: 'INICIS_PAYMENT_RESULT', status, ...data });
  const statusLabel = status === 'success' ? '완료' : (status === 'cancelled' ? '취소' : '실패');
  const iconColor = status === 'success' ? '#10b981' : (status === 'cancelled' ? '#6b7280' : '#ef4444');
  const icon = status === 'success' ? '✓' : (status === 'cancelled' ? '–' : '×');
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>결제 ${statusLabel}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Apple SD Gothic Neo', sans-serif; background:#f9fafb; margin:0; padding:0; min-height:100vh; display:flex; align-items:center; justify-content:center; color:#1f2937; }
.box { background:#fff; border-radius:16px; box-shadow:0 8px 32px rgba(0,0,0,0.08); padding:40px 32px; text-align:center; max-width:360px; width:90%; }
.icon { width:64px; height:64px; border-radius:50%; background:${iconColor}1a; color:${iconColor}; font-size:36px; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-weight:bold; }
.title { font-size:18px; font-weight:600; margin-bottom:8px; }
.desc { font-size:14px; color:#6b7280; line-height:1.5; }
.hint { font-size:12px; color:#9ca3af; margin-top:20px; }
</style>
</head>
<body>
<div class="box">
<div class="icon">${icon}</div>
<div class="title">결제가 ${statusLabel}되었습니다</div>
<div class="desc">이 창은 자동으로 닫힙니다.</div>
<div class="hint">자동으로 닫히지 않으면 창을 닫아주세요.</div>
</div>
<script>
(function() {
  var data = ${dataJson};
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(data, '*');
    }
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(data, '*');
    }
  } catch (e) {}
  setTimeout(function() {
    try { window.close(); } catch (e) {}
    setTimeout(function() {
      window.location.replace('${baseUrl}/payment/result?status=${safeStatus}');
    }, 800);
  }, 1500);
})();
</script>
</body>
</html>`;
}

// ────────────────────────────────────────────────────────────
// 1) 이니시스 callback 라우트 (인증 X — 이니시스 측 form POST 본질)
// ────────────────────────────────────────────────────────────

// POST /api/payments/inicis/return — 결제 완료 callback (P_NEXT_URL)
router.post('/inicis/return', inicisFormParser, async (req: Request, res: Response) => {
  const body: Record<string, any> = req.body || {};
  console.log('[payments] /inicis/return callback:', {
    resultCode: body.resultCode,
    orderNumber: body.orderNumber,
    mid: body.mid,
  });

  const orderId = String(body.orderNumber || body.MOID || '').trim();
  if (!orderId) {
    res.status(400).send(renderResultHtml('failed', { resultMsg: 'orderNumber 누락' }));
    return;
  }

  try {
    // resultCode 0000 X = 결제창 단계 실패
    if (body.resultCode !== '0000') {
      const fail = await finalizePaymentFailure({
        orderId,
        resultCode: String(body.resultCode || 'UNKNOWN'),
        resultMsg: String(body.resultMsg || '결제창 처리 실패'),
        rawResponse: body,
        status: 'failed',
      });
      res.status(200).send(renderResultHtml('failed', {
        paymentId: fail.paymentId,
        resultCode: body.resultCode,
        resultMsg: body.resultMsg,
      }));
      return;
    }

    // authUrl POST 호출 → 결제 승인
    const callback: InicisCallbackBody = {
      resultCode: body.resultCode,
      resultMsg: body.resultMsg,
      mid: body.mid,
      orderNumber: body.orderNumber,
      authToken: body.authToken,
      authUrl: body.authUrl,
      netCancelUrl: body.netCancelUrl,
      checkAckUrl: body.checkAckUrl,
      charset: body.charset,
      merchantData: body.merchantData,
      idc_name: body.idc_name,
    };

    const approval = await approveInicisPayment(callback);

    if (!approval.success) {
      // 승인 실패 → netCancel 호출 (이니시스 거래 망취소)
      if (callback.netCancelUrl) {
        await netCancelInicisPayment(callback.netCancelUrl, callback);
      }
      const fail = await finalizePaymentFailure({
        orderId,
        resultCode: approval.resultCode,
        resultMsg: approval.resultMsg,
        rawResponse: approval.raw,
        status: 'failed',
      });
      res.status(200).send(renderResultHtml('failed', {
        paymentId: fail.paymentId,
        resultCode: approval.resultCode,
        resultMsg: approval.resultMsg,
      }));
      return;
    }

    // 결제 성공 확정
    try {
      const result = await finalizePaymentSuccess({ orderId, approval });
      res.status(200).send(renderResultHtml('success', {
        paymentId: result.paymentId,
        amount: result.amount,
        newBalance: result.newBalance,
        alreadyProcessed: result.alreadyProcessed,
      }));
    } catch (finalErr: any) {
      // finalize 실패 시 netCancel 호출 (이니시스 측 망취소)
      console.error('[payments] /inicis/return finalize 실패 → netCancel 호출:', finalErr.message || finalErr);
      if (callback.netCancelUrl) {
        await netCancelInicisPayment(callback.netCancelUrl, callback);
      }
      await finalizePaymentFailure({
        orderId,
        resultCode: 'FINALIZE_ERROR',
        resultMsg: `결제 확정 실패: ${finalErr.message || finalErr}`,
        rawResponse: { approval: approval.raw, error: String(finalErr) },
        status: 'failed',
      });
      res.status(200).send(renderResultHtml('failed', {
        resultMsg: '결제 확정 실패 (망취소 처리됨)',
      }));
    }
  } catch (err: any) {
    console.error('[payments] /inicis/return 처리 실패:', err.message || err);
    res.status(200).send(renderResultHtml('failed', { resultMsg: '결제 처리 중 오류' }));
  }
});

// POST /api/payments/inicis/close — 결제창 닫기 callback (P_CLOSE_URL)
router.post('/inicis/close', inicisFormParser, async (req: Request, res: Response) => {
  const body: Record<string, any> = req.body || {};
  const orderId = String(body.orderNumber || body.MOID || body.oid || '').trim();
  console.log('[payments] /inicis/close callback:', { orderId, body });

  if (orderId) {
    await finalizePaymentFailure({
      orderId,
      resultCode: 'USER_CANCELLED',
      resultMsg: '사용자가 결제창을 닫았습니다',
      rawResponse: body,
      status: 'cancelled',
    });
  }
  res.status(200).send(renderResultHtml('cancelled', { orderId }));
});

// ────────────────────────────────────────────────────────────
// 2) 회사 admin/사용자 인증 라우트
// ────────────────────────────────────────────────────────────

router.use(authenticate);

// POST /api/payments/inicis/prepare — 결제창 호출 영역
router.post('/inicis/prepare', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { amount, productName, buyerName, buyerEmail, buyerTel } = req.body || {};

    const amountNum = Number(amount);
    if (!amountNum || amountNum < 1000) {
      return res.status(400).json({ error: '1,000원 이상 입력해주세요.' });
    }
    if (amountNum > 100_000_000) {
      return res.status(400).json({ error: '1억원 이하 입력해주세요.' });
    }
    if (!buyerName || typeof buyerName !== 'string' || !buyerName.trim()) {
      return res.status(400).json({ error: '구매자명을 입력해주세요.' });
    }

    // 회사 영역 + 선불 영역 확인
    const companyResult = await pool.query(
      'SELECT id, billing_type, company_name FROM companies WHERE id = $1',
      [companyId]
    );
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: '회사 정보를 찾을 수 없습니다.' });
    }
    if (companyResult.rows[0].billing_type !== 'prepaid') {
      return res.status(400).json({ error: '선불 요금제 고객사만 카드결제 충전이 가능합니다.' });
    }

    const orderId = generateOrderId();
    const productNameSafe = (String(productName || '').trim() || `한줄로 잔액 충전 ${amountNum.toLocaleString()}원`).slice(0, 100);
    const buyerNameSafe = buyerName.trim().slice(0, 50);
    const buyerEmailSafe = String(buyerEmail || '').trim().slice(0, 100);
    const buyerTelSafe = String(buyerTel || '').replace(/[^0-9]/g, '').slice(0, 20);

    // pending payment INSERT
    const { paymentId } = await createPendingPayment({
      companyId,
      userId: userId || null,
      orderId,
      amount: amountNum,
      productName: productNameSafe,
      buyerName: buyerNameSafe,
      buyerEmail: buyerEmailSafe,
      buyerTel: buyerTelSafe,
    });

    // 이니시스 결제창 form 데이터
    const baseUrl = process.env.PUBLIC_BASE_URL || 'https://app.hanjul.ai';
    const form = prepareInicisPayment({
      orderId,
      companyId,
      userId: userId || null,
      amount: amountNum,
      productName: productNameSafe,
      buyerName: buyerNameSafe,
      buyerEmail: buyerEmailSafe,
      buyerTel: buyerTelSafe,
      returnUrl: `${baseUrl}/api/payments/inicis/return`,
      closeUrl: `${baseUrl}/api/payments/inicis/close`,
    });

    res.json({
      paymentId,
      form,
    });
  } catch (err: any) {
    console.error('[payments] /inicis/prepare 실패:', err.message || err);
    res.status(500).json({ error: '결제 준비 실패' });
  }
});

// GET /api/payments — 결제 이력 조회 (회사 admin)
router.get('/', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const status = (req.query.status as string) || '';
    const method = (req.query.method as string) || '';

    let where = 'WHERE company_id = $1';
    const params: any[] = [companyId];
    let idx = 2;

    if (status) {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }
    if (method) {
      where += ` AND payment_method = $${idx++}`;
      params.push(method);
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM payments ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT id, payment_method, pg_provider, pg_payment_key, pg_order_id,
              amount, status, card_company, card_quota,
              result_code, result_msg, buyer_name, product_name,
              paid_at, cancelled_at, created_at
       FROM payments ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    );

    res.json({
      payments: result.rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err: any) {
    console.error('[payments] GET / 실패:', err.message || err);
    res.status(500).json({ error: '결제 이력 조회 실패' });
  }
});

// GET /api/payments/:id — 결제 상세 조회
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: '잘못된 결제 ID' });
    }

    const result = await pool.query(
      `SELECT * FROM payments WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '결제 정보를 찾을 수 없습니다.' });
    }

    res.json({ payment: result.rows[0] });
  } catch (err: any) {
    console.error('[payments] GET /:id 실패:', err.message || err);
    res.status(500).json({ error: '결제 상세 조회 실패' });
  }
});

export default router;
