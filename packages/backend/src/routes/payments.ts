// routes/payments.ts — 이니시스 표준결제 라우트
// SoT: status/legacy-payment-migration.md §6-3
// CT-41 inicis-client + CT-42 payment-processor 통합
//
// D224+ closeUrl V023 사고 fix (2026-05-27 Harold 신고):
//   기존 = process.env.PUBLIC_BASE_URL 정적 baseUrl → 사용자 진입 origin (hanjul.ai) ≠ closeUrl domain (app.hanjul.ai) 불일치
//   정정 = utils/inicis-client.ts getInicisCallbackUrls(req) helper 활용 = 동적 baseUrl (req.get('host') 정합)

import { demoBlock } from '../utils/demo-company';   // ★ 2026-10-09 시연 회사 = 사람이 누르는 발송·돈 입구 거절(설계서 docs/2026-10-09-demo-company-design.md §3)
import { Router, Request, Response, urlencoded } from 'express';
import { pool } from '../config/database';
import { parseWonAmount } from '../utils/normalize';
import { sendSystemAlert } from '../utils/system-alert';
import { authenticate } from '../middlewares/auth';
import {
  prepareInicisPayment,
  approveInicisPayment,
  netCancelInicisPayment,
  generateOrderId,
  getInicisCallbackUrls,
  verifyInicisCallback,
  readInicisCallbackToken,
  type InicisCallbackBody,
} from '../utils/inicis-client';
import {
  createPendingPayment,
  finalizePaymentSuccess,
  finalizePaymentFailure,
  readInicisPaymentState,
  type FinalizePaymentFailureInput,
  type FinalizePaymentFailureResult,
} from '../utils/payment-processor';
// ★ 2026-09-26 한줄로 V2 F03·F25 — 같은 주문의 리턴 콜백 직렬화(프로세스 안 키별 잠금 CT)
import { withKeyedLock } from '../utils/keyed-lock';

const router = Router();

// 이니시스 callback form POST는 application/x-www-form-urlencoded
const inicisFormParser = urlencoded({ extended: true, limit: '1mb' });

// ── 공용 helper: 결제 결과 HTML 응답 ────────────────────────

function renderResultHtml(
  status: 'success' | 'failed' | 'cancelled',
  data: Record<string, any>,
  baseUrl: string,
): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
  const safeStatus = escape(status);
  // ★2026-09-02 inline script 안의 JSON은 HTML 파서가 먼저 읽는다. JSON.stringify는 '<'를 이스케이프하지
  //   않아 값에 </script>가 들어오면 스크립트가 그 자리에서 닫히고 뒤가 새 스크립트로 실행된다
  //   (이 페이지 CSP는 script-src 'unsafe-inline'이라 막지 못한다). resultCode·resultMsg는 callback
  //   본문에서 온 외부 입력이고, finalizePaymentFailure는 pending 행이 없어도 예외를 던지지 않아
  //   존재하지 않는 orderId로도 이 렌더에 도달한다(Codex 1R high). \u 이스케이프는 JS 파서가 원문자로
  //   되돌리므로 화면에 보이는 값은 그대로다. U+2028·U+2029는 JSON에서 살아남지만 JS에서는 줄바꿈이라
  //   스크립트를 깨뜨리므로 함께 막는다.
  const dataJson = JSON.stringify({ type: 'INICIS_PAYMENT_RESULT', status, ...data })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
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

// ★ D227+ (2026-05-28): 결제 결과 페이지 CSP 완화 helper
//   renderResultHtml = inline <script>(자동 window.close + opener/parent.postMessage + location.replace) 포함.
//   helmet 전역 CSP(script-src 'self')가 inline script 차단 → 자동 close X + 결제 전 복귀 X 사고.
//   본 4개 callback 결과 페이지만 CSP override (정적 결제결과 + 자동 close 스크립트 = unsafe-inline 위험 낮음).
function setResultPageCsp(res: Response) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' 'self'",
  );
}

/**
 * ★ 2026-09-27 한줄로 V2 R338·A-03 — 인증 없는 결제 콜백의 실패·취소 기록은 **서명값이 맞을 때만** 한다.
 * 결제창 실패·닫기 콜백과 승인·확정 실패 뒤 기록은 공개 경로라, 주문번호만 알면(또는 자기 결제의 인증 토큰에 남의 주문번호를 붙이면)
 * 남의 대기 주문을 실패·취소로 바꿀 수 있었다. 서명값 = 주문을 만들 때 signKey로 만든 주문번호 HMAC(inicis-client signInicisCallback)
 * — 닫기 URL의 cb 쿼리, 리턴 콜백의 merchantData(cb=)로 돌아온다. 없거나 틀리면 상태를 건드리지 않고 null(화면만 보여 준다).
 */
async function failTrustedCallback(
  orderId: string, token: string, input: Omit<FinalizePaymentFailureInput, 'orderId'>,
): Promise<FinalizePaymentFailureResult | null> {
  if (!verifyInicisCallback(orderId, token)) {
    console.warn(`[payments] 결제 콜백 서명값 불일치 — 상태 변경 안 함: orderId=${orderId} result=${input.resultCode}`);
    return null;
  }
  return await finalizePaymentFailure({ orderId, ...input });
}

// ────────────────────────────────────────────────────────────
// 1) 이니시스 callback 라우트 (인증 X — 이니시스 측 form POST)
// ────────────────────────────────────────────────────────────

// POST /api/payments/inicis/return — 결제 완료 callback (P_NEXT_URL)
router.post('/inicis/return', inicisFormParser, async (req: Request, res: Response) => {
  const body: Record<string, any> = req.body || {};
  const { baseUrl } = getInicisCallbackUrls(req);
  setResultPageCsp(res); // ★ D227+ inline script 자동 close/복귀 스크립트 CSP 차단 사고 정정
  console.log('[payments] /inicis/return callback:', {
    resultCode: body.resultCode,
    orderNumber: body.orderNumber,
    mid: body.mid,
    requestHost: req.get('host'),
  });

  const orderId = String(body.orderNumber || body.MOID || '').trim();
  if (!orderId) {
    res.status(400).send(renderResultHtml('failed', { resultMsg: 'orderNumber 누락' }, baseUrl));
    return;
  }
  const callbackToken = readInicisCallbackToken(body);   // ★ 2026-09-27 R338·A-03 merchantData(cb=)

  // ★ 2026-09-26 한줄로 V2 F03·F25 — 같은 주문의 리턴 콜백은 주문번호 단위 잠금 안에서 한 번에 하나씩 처리한다
  //   (동시 이중 제출이 둘 다 승인을 부르고 뒤의 실패가 앞 거래를 망취소하지 않게). 잠금은 DB 연결을 쥐지 않는다(keyed-lock CT).
  await withKeyedLock('inicis-return', orderId, async () => {
  try {
    // resultCode 0000 X = 결제창 단계 실패
    if (body.resultCode !== '0000') {
      const fail = await failTrustedCallback(orderId, callbackToken, {
        resultCode: String(body.resultCode || 'UNKNOWN'),
        resultMsg: String(body.resultMsg || '결제창 처리 실패'),
        rawResponse: body,
        status: 'failed',
      });
      res.status(200).send(renderResultHtml('failed', {
        paymentId: fail?.paymentId ?? null,
        resultCode: body.resultCode,
        resultMsg: body.resultMsg,
      }, baseUrl));
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

    // ★ 2026-09-26 F03·F25 — 승인 전에 결제 상태를 본다. 이미 completed면 승인·망취소 없이 성공 화면(재전송) ·
    //   pending이 아니면(실패·취소로 끝남) 승인·망취소 없이 실패 화면. 행이 없거나 pending이면 종전 흐름.
    //   ⛔ 이 경로는 인증 앞 공개 경로다 — 재전송 응답에는 완료 여부만 싣는다(잔액·금액·결제 id를 싣지 않는다 · Codex 5차 1R high).
    //   완료 화면의 금액·잔액은 첫 콜백이 이미 보여 줬고, 충전 화면은 인증된 조회로 잔액을 다시 읽는다.
    const state = await readInicisPaymentState(orderId);
    if (state && state.status === 'completed') {
      console.log(`[payments] /inicis/return 재전송 — 이미 완료된 결제(승인·망취소 생략): orderId=${orderId}`);
      res.status(200).send(renderResultHtml('success', { alreadyProcessed: true }, baseUrl));
      return;
    }
    if (state && state.status !== 'pending') {
      console.log(`[payments] /inicis/return 재전송 — 이미 종료된 결제(status=${state.status} · 승인·망취소 생략): orderId=${orderId}`);
      res.status(200).send(renderResultHtml('failed', {
        resultMsg: '이미 종료된 결제입니다. 결제를 다시 진행해 주세요.',
      }, baseUrl));
      return;
    }

    const approval = await approveInicisPayment(callback);

    // ★ 2026-09-27 한줄로 V2 PAY(Codex 1R · 이니시스 매뉴얼 "승인결과 전문 처리 중 예외발생 시 망취소") — 망취소는
    //   **이 주문의 거래가 승인됐는데 우리 처리가 실패**한 한 곳(아래 확정 실패)에서만 한다.
    //   승인 실패 응답은 승인된 거래가 없어 망취소 대상이 아니다. 승인 결과를 못 받은 경우(NETWORK_ERROR)는 자동 망취소하지 않는다 —
    //   이 공개 경로에서는 인증 주소·망취소 주소·토큰을 요청자가 정할 수 있어, 자기의 완료 거래 토큰을 다른 주문번호로 보내
    //   이미 충전된 결제를 취소시키는 데 쓰일 수 있다(잔액은 남고 카드 대금만 취소).
    if (!approval.success && approval.unknown) {
      // 승인됐을 수도 있다 — 주문은 대기로 두고, 서명값이 맞는 실제 대기 주문일 때만 사람이 확인하도록 알린다(무인증 경보 남발 방지).
      console.error(`[payments] /inicis/return 승인 불명(미수신·해석 불가) — 자동 망취소 안 함: orderId=${orderId}`, approval.resultCode, approval.resultMsg);
      if (state && state.status === 'pending' && verifyInicisCallback(orderId, callbackToken)) {
        void sendSystemAlert({
          dedupKey: `inicis-approve-unknown:${orderId}`,
          message: `카드결제 승인 결과를 받지 못했습니다 — 주문 ${orderId}. 이니시스 관리자에서 승인 여부를 확인해 주세요(승인됐다면 카드 대금만 있고 충전은 안 된 상태).`,
        }).catch(() => undefined);
      }
      res.status(200).send(renderResultHtml('failed', {
        resultMsg: '결제 결과를 확인하지 못했습니다. 잠시 후 충전 내역을 확인해 주세요.',
      }, baseUrl));
      return;
    }

    if (!approval.success) {
      // 승인 실패 응답 — 승인된 거래가 없다(망취소 대상 아님 · 매뉴얼)
      const fail = await failTrustedCallback(orderId, callbackToken, {
        resultCode: approval.resultCode,
        resultMsg: approval.resultMsg,
        rawResponse: approval.raw,
        status: 'failed',
      });
      res.status(200).send(renderResultHtml('failed', {
        paymentId: fail?.paymentId ?? null,
        resultCode: approval.resultCode,
        resultMsg: approval.resultMsg,
      }, baseUrl));
      return;
    }

    // ★ 2026-09-27 PAY(Codex 1R) — 승인된 거래의 주문번호(MOID)가 이 주문이 아니면 다른 주문의 토큰이다.
    //   확정·망취소·상태 변경을 모두 하지 않는다(망취소하면 그 다른 주문의 이미 충전된 결제가 취소된다).
    if (String(approval.moid ?? '').trim() !== orderId) {
      console.error(`[payments] /inicis/return 승인 주문번호 불일치 — 확정·망취소 안 함: orderId=${orderId} moid=${String(approval.moid ?? '') || '(없음)'}`);
      res.status(200).send(renderResultHtml('failed', { resultMsg: '결제 정보가 주문과 맞지 않습니다.' }, baseUrl));
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
      }, baseUrl));
    } catch (finalErr: any) {
      // 이 주문의 승인 거래인데 우리 처리가 실패 = 망취소(매뉴얼) · 실패는 망취소 CT가 경보
      console.error('[payments] /inicis/return finalize 실패:', finalErr.message || finalErr);
      // ★ 2026-09-27 PAY Codex 2R(범위 밖 수용) — 망취소 전에 상태를 다시 읽는다. 확정 커밋은 됐는데 응답만 유실된 경우
      //   망취소하면 충전은 남고 카드 대금만 취소된다. completed = 확정됨(망취소 안 함 · 성공 화면) ·
      //   다시 읽기 실패 = 알 수 없음(망취소 안 함 · 경보 · 사람이 확인) · 그 밖 = 확정 안 됨(망취소).
      let after: { status: string } | null = null;
      let rereadFailed = false;
      try { after = await readInicisPaymentState(orderId); } catch { rereadFailed = true; }
      if (after && after.status === 'completed') {
        console.warn(`[payments] /inicis/return 확정 오류였으나 결제는 completed — 망취소 안 함: orderId=${orderId}`);
        res.status(200).send(renderResultHtml('success', { alreadyProcessed: true }, baseUrl));
        return;
      }
      if (!after) {
        void sendSystemAlert({
          dedupKey: `inicis-finalize-unknown:${orderId}`,
          message: `카드결제 확정 결과를 확인하지 못했습니다 — 주문 ${orderId}${rereadFailed ? '(상태 조회 실패)' : '(결제 행 없음)'}. 망취소하지 않았습니다. 충전·카드 승인 상태를 확인해 주세요.`,
        }).catch(() => undefined);
        res.status(200).send(renderResultHtml('failed', {
          resultMsg: '결제 결과를 확인하지 못했습니다. 잠시 후 충전 내역을 확인해 주세요.',
        }, baseUrl));
        return;
      }
      // 빈 망취소 주소도 CT로 넘긴다 — CT가 거절하며 경보한다(PAY Codex 2R medium · 카드 승인만 남는 경우를 놓치지 않게)
      const cancelled = await netCancelInicisPayment(callback.netCancelUrl || '', callback);
      await failTrustedCallback(orderId, callbackToken, {
        resultCode: 'FINALIZE_ERROR',
        resultMsg: `결제 확정 실패: ${finalErr.message || finalErr}`,
        rawResponse: { approval: approval.raw, error: String(finalErr) },
        status: 'failed',
      });
      res.status(200).send(renderResultHtml('failed', {
        resultMsg: cancelled
          ? '결제를 확정하지 못해 결제를 취소했습니다. 다시 시도해 주세요.'
          : '결제를 확정하지 못했습니다. 결제 취소 여부를 확인 중이니 잠시 후 충전 내역을 확인해 주세요.',
      }, baseUrl));
    }
  } catch (err: any) {
    console.error('[payments] /inicis/return 처리 실패:', err.message || err);
    res.status(200).send(renderResultHtml('failed', { resultMsg: '결제 처리 중 오류' }, baseUrl));
  }
  });
});

// POST /api/payments/inicis/close — 결제창 닫기 callback (P_CLOSE_URL)
router.post('/inicis/close', inicisFormParser, async (req: Request, res: Response) => {
  const body: Record<string, any> = req.body || {};
  const { baseUrl } = getInicisCallbackUrls(req);
  setResultPageCsp(res); // ★ D227+ inline script 자동 close/복귀 스크립트 CSP 차단 사고 정정
  const orderId = String(body.orderNumber || body.MOID || body.oid || '').trim();
  console.log('[payments] /inicis/close callback:', { orderId, body, requestHost: req.get('host') });

  if (orderId) {
    // ★ 2026-09-27 R338·A-03 닫기 URL의 cb 쿼리(주문을 만들 때 실음) — 본문 merchantData도 본다
    await failTrustedCallback(orderId, readInicisCallbackToken(req.query as Record<string, any>) || readInicisCallbackToken(body), {
      resultCode: 'USER_CANCELLED',
      resultMsg: '사용자가 결제창을 닫았습니다',
      rawResponse: body,
      status: 'cancelled',
    });
  }
  res.status(200).send(renderResultHtml('cancelled', { orderId }, baseUrl));
});

// ★ D226+ (2026-05-29): GET fallback — 이니시스 SDK 일부 흐름 안 closeUrl GET redirect 사고 차단
//   (사용자 결제 취소 직후 별 탭 = JSON raw "No token provided" 노출 사고 정정)
//   POST 표준 흐름 보존 + GET 호출 시 = HTML 응답 (자동 close + postMessage 흐름 동일)
router.get('/inicis/close', async (req: Request, res: Response) => {
  const { baseUrl } = getInicisCallbackUrls(req);
  setResultPageCsp(res); // ★ D227+ inline script 자동 close/복귀 스크립트 CSP 차단 사고 정정
  const orderId = String(req.query.orderNumber || req.query.MOID || req.query.oid || '').trim();
  console.log('[payments] /inicis/close GET fallback:', { orderId, query: req.query, requestHost: req.get('host') });

  if (orderId) {
    try {
      await failTrustedCallback(orderId, readInicisCallbackToken(req.query as Record<string, any>), {
        resultCode: 'USER_CANCELLED_GET',
        resultMsg: '사용자가 결제창을 닫았습니다 (GET fallback)',
        rawResponse: req.query as Record<string, any>,
        status: 'cancelled',
      });
    } catch (err: any) {
      console.error('[payments] /inicis/close GET fallback finalize 사고:', err.message || err);
    }
  }
  res.status(200).send(renderResultHtml('cancelled', { orderId }, baseUrl));
});

// ★ D226+ (2026-05-29): /inicis/return GET fallback — 안전망 (POST 표준 흐름 보존)
router.get('/inicis/return', async (req: Request, res: Response) => {
  const { baseUrl } = getInicisCallbackUrls(req);
  setResultPageCsp(res); // ★ D227+ inline script 자동 close/복귀 스크립트 CSP 차단 사고 정정
  const orderId = String(req.query.orderNumber || req.query.MOID || req.query.oid || '').trim();
  console.log('[payments] /inicis/return GET fallback:', { orderId, query: req.query, requestHost: req.get('host') });
  res.status(200).send(renderResultHtml('failed', {
    orderId,
    resultMsg: '결제 결과 확인 실패 (GET fallback). 결제 진행 여부는 발송결과 영역 안 확인 의무',
  }, baseUrl));
});

// ────────────────────────────────────────────────────────────
// 2) 회사 admin/사용자 인증 라우트
// ────────────────────────────────────────────────────────────

router.use(authenticate);

// POST /api/payments/inicis/prepare — 결제창 호출
router.post('/inicis/prepare', demoBlock, async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) {
      return res.status(403).json({ error: '고객사 권한이 필요합니다.' });
    }

    const { amount, productName, buyerName, buyerEmail, buyerTel } = req.body || {};

    // ★ 2026-09-27 한줄로 V2 m011 — 정수 원 · 1,000원 ~ 1억 원(금액 CT · 소수 주문이 만들어지던 것을 막는다)
    const amountNum = parseWonAmount(amount, { min: 1000, max: 100_000_000 });
    if (amountNum === null) {
      return res.status(400).json({ error: '1,000원 이상 1억원 이하의 원 단위 금액을 입력해주세요.' });
    }
    if (!buyerName || typeof buyerName !== 'string' || !buyerName.trim()) {
      return res.status(400).json({ error: '구매자명을 입력해주세요.' });
    }

    // 회사 + 선불 요금제 확인
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

    // ★ V023 fix — 사용자 진입 origin (req.get('host')) 정합 closeUrl/returnUrl 동적 생성
    const { returnUrl, closeUrl } = getInicisCallbackUrls(req);
    console.log('[payments] /inicis/prepare callback URLs:', { returnUrl, closeUrl, requestHost: req.get('host') });

    // 이니시스 결제창 form 데이터
    const form = prepareInicisPayment({
      orderId,
      companyId,
      userId: userId || null,
      amount: amountNum,
      productName: productNameSafe,
      buyerName: buyerNameSafe,
      buyerEmail: buyerEmailSafe,
      buyerTel: buyerTelSafe,
      returnUrl,
      closeUrl,
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
