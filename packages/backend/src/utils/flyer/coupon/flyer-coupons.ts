/**
 * ★ CT-F15 — 전단AI QR 쿠폰 컨트롤타워
 *
 * 쿠폰 캠페인 CRUD + QR 생성 + 수령(claim) + 사용(redeem) + 통계
 *
 * 설계: FLYER-QR-COUPON-DESIGN.md
 * 의존: CT-F08(sendFlyerCampaign), CT-F03(billing), CT-F01(sms-queue)
 */

import crypto from 'crypto';
import QRCode from 'qrcode';
import { query } from '../../../config/database';
import { normalizePhone } from '../../normalize-phone';

// ============================================================
// 인터페이스
// ============================================================

export interface CreateCouponCampaignParams {
  companyId: string;
  createdBy: string;
  flyerId?: string;
  campaignId?: string;
  couponName: string;
  couponType: 'fixed' | 'percent' | 'free_item';
  discountValue: number;
  discountDescription?: string;
  minPurchase?: number;
  maxIssues?: number;
  expiresAt?: string; // ISO date
}

export interface CouponCampaign {
  id: string;
  company_id: string;
  coupon_name: string;
  coupon_type: string;
  discount_value: number;
  discount_description: string | null;
  min_purchase: number;
  qr_code: string;
  qr_url: string;
  qr_data_url: string;
  max_issues: number | null;
  issued_count: number;
  redeemed_count: number;
  expires_at: string | null;
  status: string;
  created_at: string;
}

export interface ClaimResult {
  ok: boolean;
  couponCode?: string;
  expiresAt?: string;
  error?: string;
}

export interface RedeemResult {
  ok: boolean;
  discount?: string;
  customerPhone?: string;
  customerName?: string;
  error?: string;
}

export interface CouponStats {
  issuedCount: number;
  redeemedCount: number;
  conversionRate: number;
  totalDiscountAmount: number;
  avgPurchaseAmount: number | null;
  scanCount: number;
}

// ============================================================
// QR 코드 생성
// ============================================================

const COUPON_DOMAIN = process.env.FLYER_COUPON_DOMAIN || 'https://hanjul-flyer.kr';

/** QR 코드 6자리 영숫자 생성 (중복 방지 최대 5회 재시도) */
export async function generateQrCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomBytes(4).toString('base64url').slice(0, 6).toUpperCase();
    const exists = await query('SELECT 1 FROM flyer_coupon_campaigns WHERE qr_code = $1', [code]);
    if (exists.rows.length === 0) return code;
  }
  // 5회 충돌 시 8자리로 확장
  return crypto.randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
}

/** 개인 쿠폰 코드 4자리 생성 (중복 방지) */
export async function generateCouponCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(3).toString('base64url').slice(0, 4).toUpperCase();
    const exists = await query('SELECT 1 FROM flyer_coupons WHERE coupon_code = $1', [code]);
    if (exists.rows.length === 0) return code;
  }
  return crypto.randomBytes(4).toString('base64url').slice(0, 6).toUpperCase();
}

/** QR 코드 Data URL 이미지 생성 */
export async function generateQrDataUrl(qrCode: string): Promise<string> {
  const url = `${COUPON_DOMAIN}/q/${qrCode}`;
  return QRCode.toDataURL(url, {
    width: 200,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

// ============================================================
// 캠페인 CRUD
// ============================================================

/** 쿠폰 캠페인 생성 */
export async function createCouponCampaign(params: CreateCouponCampaignParams): Promise<CouponCampaign> {
  const qrCode = await generateQrCode();
  const qrUrl = `${COUPON_DOMAIN}/q/${qrCode}`;
  const qrDataUrl = await generateQrDataUrl(qrCode);

  const result = await query(
    `INSERT INTO flyer_coupon_campaigns
       (company_id, created_by, flyer_id, campaign_id,
        coupon_name, coupon_type, discount_value, discount_description,
        min_purchase, max_issues, expires_at,
        qr_code, qr_url, qr_data_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      params.companyId, params.createdBy,
      params.flyerId || null, params.campaignId || null,
      params.couponName, params.couponType,
      params.discountValue, params.discountDescription || null,
      params.minPurchase || 0, params.maxIssues || null,
      params.expiresAt || null,
      qrCode, qrUrl, qrDataUrl,
    ]
  );
  return result.rows[0];
}

/** 쿠폰 캠페인 목록 조회 */
export async function listCouponCampaigns(companyId: string): Promise<CouponCampaign[]> {
  const result = await query(
    `SELECT *
     FROM flyer_coupon_campaigns
     WHERE company_id = $1
     ORDER BY created_at DESC`,
    [companyId]
  );
  return result.rows;
}

/** 쿠폰 캠페인 상세 조회 */
export async function getCouponCampaign(id: string, companyId: string): Promise<CouponCampaign | null> {
  const result = await query(
    `SELECT * FROM flyer_coupon_campaigns WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  return result.rows[0] || null;
}

/** 쿠폰 캠페인 수정 */
export async function updateCouponCampaign(
  id: string,
  companyId: string,
  updates: Partial<Pick<CreateCouponCampaignParams, 'couponName' | 'discountValue' | 'discountDescription' | 'minPurchase' | 'maxIssues' | 'expiresAt'>>
): Promise<CouponCampaign | null> {
  const sets: string[] = [];
  const vals: any[] = [];
  let idx = 3;

  if (updates.couponName !== undefined) { sets.push(`coupon_name = $${idx++}`); vals.push(updates.couponName); }
  if (updates.discountValue !== undefined) { sets.push(`discount_value = $${idx++}`); vals.push(updates.discountValue); }
  if (updates.discountDescription !== undefined) { sets.push(`discount_description = $${idx++}`); vals.push(updates.discountDescription); }
  if (updates.minPurchase !== undefined) { sets.push(`min_purchase = $${idx++}`); vals.push(updates.minPurchase); }
  if (updates.maxIssues !== undefined) { sets.push(`max_issues = $${idx++}`); vals.push(updates.maxIssues); }
  if (updates.expiresAt !== undefined) { sets.push(`expires_at = $${idx++}`); vals.push(updates.expiresAt); }

  if (sets.length === 0) return getCouponCampaign(id, companyId);

  sets.push('updated_at = NOW()');
  const result = await query(
    `UPDATE flyer_coupon_campaigns SET ${sets.join(', ')} WHERE id = $1 AND company_id = $2 RETURNING *`,
    [id, companyId, ...vals]
  );
  return result.rows[0] || null;
}

/** 쿠폰 캠페인 비활성화 */
export async function disableCouponCampaign(id: string, companyId: string): Promise<boolean> {
  const result = await query(
    `UPDATE flyer_coupon_campaigns SET status = 'disabled', updated_at = NOW() WHERE id = $1 AND company_id = $2`,
    [id, companyId]
  );
  return (result.rowCount ?? 0) > 0;
}

// ============================================================
// 쿠폰 수령 (공개 — 고객이 QR 스캔 후)
// ============================================================

/** QR 코드로 캠페인 조회 (공개) */
export async function getCampaignByQrCode(qrCode: string): Promise<CouponCampaign | null> {
  const result = await query(
    `SELECT cc.*,
            fc.company_name as store_name,
            fc.owner_phone as store_phone
     FROM flyer_coupon_campaigns cc
     JOIN flyer_companies fc ON fc.id = cc.company_id
     WHERE cc.qr_code = $1`,
    [qrCode]
  );
  return result.rows[0] || null;
}

/** 쿠폰 수령 처리 */
export async function claimCoupon(qrCode: string, phone: string, name?: string): Promise<ClaimResult> {
  const normalized = normalizePhone(phone);
  if (!normalized) return { ok: false, error: '올바른 전화번호를 입력해주세요.' };

  const campaign = await getCampaignByQrCode(qrCode);
  if (!campaign) return { ok: false, error: '쿠폰을 찾을 수 없습니다.' };
  if (campaign.status !== 'active') return { ok: false, error: '종료된 쿠폰입니다.' };

  // 만료 체크
  if (campaign.expires_at && new Date(campaign.expires_at) < new Date()) {
    return { ok: false, error: '쿠폰 기한이 만료되었습니다.' };
  }

  // 발급 한도 체크
  if (campaign.max_issues && campaign.issued_count >= campaign.max_issues) {
    return { ok: false, error: '쿠폰이 모두 소진되었습니다.' };
  }

  // 중복 수령 체크 (같은 캠페인 + 같은 전화번호)
  const dup = await query(
    `SELECT 1 FROM flyer_coupons WHERE campaign_id = $1 AND customer_phone = $2`,
    [campaign.id, normalized]
  );
  if (dup.rows.length > 0) {
    return { ok: false, error: '이미 쿠폰을 받으셨습니다.' };
  }

  // 쿠폰 코드 생성 + INSERT
  const couponCode = await generateCouponCode();
  await query(
    `INSERT INTO flyer_coupons (campaign_id, company_id, customer_phone, customer_name, coupon_code)
     VALUES ($1, $2, $3, $4, $5)`,
    [campaign.id, campaign.company_id, normalized, name || null, couponCode]
  );

  // 캠페인 발급수 증가
  await query(
    `UPDATE flyer_coupon_campaigns SET issued_count = issued_count + 1, updated_at = NOW() WHERE id = $1`,
    [campaign.id]
  );

  return {
    ok: true,
    couponCode,
    expiresAt: campaign.expires_at || undefined,
  };
}

// ============================================================
// 쿠폰 사용 처리 (매장 사장님)
// ============================================================

/** 쿠폰 코드로 사용 처리 */
export async function redeemCoupon(
  couponCode: string,
  companyId: string,
  redeemedBy: string,
  purchaseAmount?: number
): Promise<RedeemResult> {
  const result = await query(
    `SELECT c.*, cc.coupon_name, cc.discount_value, cc.discount_description, cc.coupon_type
     FROM flyer_coupons c
     JOIN flyer_coupon_campaigns cc ON cc.id = c.campaign_id
     WHERE c.coupon_code = $1 AND c.company_id = $2 AND c.status = 'issued'`,
    [couponCode.toUpperCase(), companyId]
  );

  if (result.rows.length === 0) {
    return { ok: false, error: '유효한 쿠폰을 찾을 수 없습니다.' };
  }

  const coupon = result.rows[0];

  // 사용 처리
  await query(
    `UPDATE flyer_coupons SET status = 'redeemed', redeemed_at = NOW(), redeemed_by = $2, purchase_amount = $3
     WHERE id = $1`,
    [coupon.id, redeemedBy, purchaseAmount || null]
  );

  // 캠페인 사용수 + 할인액 업데이트
  await query(
    `UPDATE flyer_coupon_campaigns
     SET redeemed_count = redeemed_count + 1,
         total_redemption_amount = total_redemption_amount + $2,
         updated_at = NOW()
     WHERE id = $1`,
    [coupon.campaign_id, coupon.discount_value]
  );

  return {
    ok: true,
    discount: coupon.discount_description || `${coupon.discount_value.toLocaleString()}원 할인`,
    customerPhone: coupon.customer_phone,
    customerName: coupon.customer_name,
  };
}

/** 전화번호로 미사용 쿠폰 조회 */
export async function lookupCouponsByPhone(phone: string, companyId: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];

  const result = await query(
    `SELECT c.*, cc.coupon_name, cc.discount_value, cc.discount_description,
            cc.coupon_type, cc.expires_at as campaign_expires_at
     FROM flyer_coupons c
     JOIN flyer_coupon_campaigns cc ON cc.id = c.campaign_id
     WHERE c.customer_phone = $1 AND c.company_id = $2 AND c.status = 'issued'
     ORDER BY c.issued_at DESC`,
    [normalized, companyId]
  );
  return result.rows;
}

// ============================================================
// 통계
// ============================================================

/** 쿠폰 캠페인 통계 */
export async function getCouponStats(campaignId: string, companyId: string): Promise<CouponStats | null> {
  const result = await query(
    `SELECT
       cc.issued_count,
       cc.redeemed_count,
       cc.total_redemption_amount,
       CASE WHEN cc.issued_count > 0
         THEN ROUND(cc.redeemed_count::numeric / cc.issued_count * 100, 1)
         ELSE 0 END as conversion_rate,
       (SELECT AVG(purchase_amount) FROM flyer_coupons WHERE campaign_id = $1 AND status = 'redeemed' AND purchase_amount IS NOT NULL) as avg_purchase
     FROM flyer_coupon_campaigns cc
     WHERE cc.id = $1 AND cc.company_id = $2`,
    [campaignId, companyId]
  );

  if (result.rows.length === 0) return null;
  const r = result.rows[0];

  return {
    issuedCount: r.issued_count,
    redeemedCount: r.redeemed_count,
    conversionRate: Number(r.conversion_rate),
    totalDiscountAmount: r.total_redemption_amount,
    avgPurchaseAmount: r.avg_purchase ? Number(r.avg_purchase) : null,
    scanCount: 0, // TODO: url_clicks 연동
  };
}

/** 캠페인의 발급된 쿠폰 목록 */
export async function listCoupons(campaignId: string, companyId: string) {
  const result = await query(
    `SELECT * FROM flyer_coupons
     WHERE campaign_id = $1 AND company_id = $2
     ORDER BY issued_at DESC`,
    [campaignId, companyId]
  );
  return result.rows;
}

// ============================================================
// 공개 페이지 HTML 렌더링
// ============================================================

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** QR 쿠폰 공개 페이지 HTML */
export function renderCouponPage(campaign: any): string {
  const discountText = campaign.coupon_type === 'percent'
    ? `${campaign.discount_value}% 할인`
    : campaign.coupon_type === 'free_item'
      ? (campaign.discount_description || '증정')
      : `${Number(campaign.discount_value).toLocaleString()}원 할인`;

  const minText = campaign.min_purchase > 0
    ? `${Number(campaign.min_purchase).toLocaleString()}원 이상 구매 시`
    : '';

  const expiresText = campaign.expires_at
    ? (() => {
        const d = new Date(campaign.expires_at);
        return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일까지`;
      })()
    : '';

  const remaining = campaign.max_issues
    ? `${Math.max(0, campaign.max_issues - campaign.issued_count)} / ${campaign.max_issues}`
    : '';

  const storeName = campaign.store_name || '';
  const storePhone = campaign.store_phone || '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>${escapeHtml(campaign.coupon_name)} - ${escapeHtml(storeName)}</title>
<meta name="qr-code" content="${escapeHtml(campaign.qr_code)}">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Noto Sans KR', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
  .card { background: #fff; border-radius: 24px; max-width: 380px; width: 100%; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  .header { background: linear-gradient(135deg, #ff6b6b, #ee5a24); padding: 28px 24px; text-align: center; color: #fff; }
  .header .store { font-size: 13px; opacity: 0.9; letter-spacing: 1px; margin-bottom: 4px; }
  .header .title { font-size: 20px; font-weight: 700; }
  .coupon-box { margin: -16px 20px 0; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); text-align: center; position: relative; z-index: 1; border: 2px dashed #e0e0e0; }
  .discount { font-size: 32px; font-weight: 700; color: #ee5a24; margin-bottom: 4px; }
  .condition { font-size: 14px; color: #888; }
  .expires { font-size: 13px; color: #aaa; margin-top: 8px; }
  .remaining { font-size: 12px; color: #999; margin-top: 4px; }
  .body { padding: 20px 24px 24px; }
  .form-group { margin-bottom: 16px; }
  .form-group label { display: block; font-size: 13px; color: #666; margin-bottom: 6px; font-weight: 500; }
  .form-group input { width: 100%; padding: 14px 16px; border: 2px solid #e8e8e8; border-radius: 12px; font-size: 16px; font-family: inherit; transition: border-color 0.2s; outline: none; }
  .form-group input:focus { border-color: #ee5a24; }
  .btn { width: 100%; padding: 16px; background: linear-gradient(135deg, #ff6b6b, #ee5a24); color: #fff; border: none; border-radius: 12px; font-size: 16px; font-weight: 600; font-family: inherit; cursor: pointer; transition: opacity 0.2s; }
  .btn:hover { opacity: 0.9; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .footer { padding: 16px 24px 20px; text-align: center; border-top: 1px solid #f0f0f0; }
  .footer .store-info { font-size: 12px; color: #999; line-height: 1.8; }
  .msg { padding: 20px; text-align: center; }
  .msg.success { color: #27ae60; }
  .msg.error { color: #e74c3c; }
  .coupon-code { font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #333; margin: 12px 0; }
  .success-desc { font-size: 14px; color: #888; line-height: 1.6; }
  #claimForm, #resultArea { display: none; }
  #claimForm.active, #resultArea.active { display: block; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    ${storeName ? `<div class="store">${escapeHtml(storeName)}</div>` : ''}
    <div class="title">${escapeHtml(campaign.coupon_name)}</div>
  </div>

  <div class="coupon-box">
    <div class="discount">${escapeHtml(discountText)}</div>
    ${minText ? `<div class="condition">${escapeHtml(minText)}</div>` : ''}
    ${expiresText ? `<div class="expires">${escapeHtml(expiresText)}</div>` : ''}
    ${remaining ? `<div class="remaining">남은 수량: ${remaining}</div>` : ''}
  </div>

  <div class="body">
    <div id="claimForm" class="active">
      <div class="form-group">
        <label>전화번호</label>
        <input type="tel" id="phoneInput" placeholder="010-0000-0000" maxlength="13" inputmode="tel" autocomplete="tel">
      </div>
      <button class="btn" id="claimBtn" onclick="handleClaim()">쿠폰 받기</button>
    </div>

    <div id="resultArea">
      <div id="resultContent"></div>
    </div>
  </div>

  <div class="footer">
    <div class="store-info">
      ${storeName ? escapeHtml(storeName) : ''}
      ${storePhone ? `<br>${escapeHtml(storePhone)}` : ''}
    </div>
  </div>
</div>

<script>
  const phoneInput = document.getElementById('phoneInput');
  phoneInput.addEventListener('input', function() {
    let v = this.value.replace(/[^0-9]/g, '');
    if (v.length > 3 && v.length <= 7) v = v.slice(0,3) + '-' + v.slice(3);
    else if (v.length > 7) v = v.slice(0,3) + '-' + v.slice(3,7) + '-' + v.slice(7,11);
    this.value = v;
  });

  async function handleClaim() {
    const phone = phoneInput.value.replace(/[^0-9]/g, '');
    if (phone.length < 10) { alert('전화번호를 입력해주세요.'); return; }

    const btn = document.getElementById('claimBtn');
    btn.disabled = true; btn.textContent = '처리 중...';

    try {
      const res = await fetch('/api/flyer/q/' + document.querySelector('meta[name="qr-code"]').content + '/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();

      document.getElementById('claimForm').classList.remove('active');
      const resultArea = document.getElementById('resultArea');
      resultArea.classList.add('active');

      if (data.ok) {
        resultArea.innerHTML = '<div class="msg success">' +
          '<div style="font-size:48px;margin-bottom:12px">&#10003;</div>' +
          '<div style="font-size:18px;font-weight:700;margin-bottom:8px">쿠폰이 발급되었습니다!</div>' +
          '<div class="coupon-code">' + data.couponCode + '</div>' +
          '<div class="success-desc">매장 방문 시 이 코드를 보여주세요.<br>SMS로도 코드가 발송되었습니다.</div>' +
          '</div>';
      } else {
        resultArea.innerHTML = '<div class="msg error">' +
          '<div style="font-size:48px;margin-bottom:12px">&#33;</div>' +
          '<div style="font-size:16px">' + (data.error || '오류가 발생했습니다.') + '</div>' +
          '</div>';
      }
    } catch (e) {
      btn.disabled = false; btn.textContent = '쿠폰 받기';
      alert('네트워크 오류. 다시 시도해주세요.');
    }
  }
</script>
</body>
</html>`;
}

// ============================================================
// 쿠폰 대시보드 통계 (전체 집계 + 7일 추이 + 캠페인별 실적)
// ============================================================

export interface CouponDashboardData {
  summary: { totalCampaigns: number; totalIssued: number; totalRedeemed: number; conversionRate: number };
  trend: Array<{ date: string; issued: number; redeemed: number }>;
  campaigns: Array<{ id: string; coupon_name: string; coupon_type: string; discount_value: number; issued_count: number; redeemed_count: number; conversion_rate: number; created_at: string }>;
}

export async function getCouponDashboard(companyId: string): Promise<CouponDashboardData> {
  const [aggResult, trendResult, campaignResult] = await Promise.all([
    query(
      `SELECT COUNT(*) AS total_campaigns, SUM(issued_count) AS total_issued, SUM(redeemed_count) AS total_redeemed,
              CASE WHEN SUM(issued_count) > 0 THEN ROUND(SUM(redeemed_count)::numeric / SUM(issued_count) * 100, 1) ELSE 0 END AS conversion_rate
       FROM flyer_coupon_campaigns WHERE company_id = $1`,
      [companyId]
    ),
    query(
      `SELECT TO_CHAR(c.issued_at, 'YYYY-MM-DD') AS date, COUNT(*) AS issued,
              COUNT(CASE WHEN c.status = 'redeemed' THEN 1 END) AS redeemed
       FROM flyer_coupons c JOIN flyer_coupon_campaigns cc ON cc.id = c.campaign_id
       WHERE cc.company_id = $1 AND c.issued_at >= NOW() - INTERVAL '7 days'
       GROUP BY TO_CHAR(c.issued_at, 'YYYY-MM-DD') ORDER BY date`,
      [companyId]
    ),
    query(
      `SELECT id, coupon_name, coupon_type, discount_value, issued_count, redeemed_count,
              CASE WHEN issued_count > 0 THEN ROUND(redeemed_count::numeric / issued_count * 100, 1) ELSE 0 END AS conversion_rate,
              TO_CHAR(created_at, 'YYYY-MM-DD') AS created_at
       FROM flyer_coupon_campaigns WHERE company_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [companyId]
    ),
  ]);

  const agg = aggResult.rows[0] || {};
  return {
    summary: {
      totalCampaigns: Number(agg.total_campaigns) || 0,
      totalIssued: Number(agg.total_issued) || 0,
      totalRedeemed: Number(agg.total_redeemed) || 0,
      conversionRate: Number(agg.conversion_rate) || 0,
    },
    trend: trendResult.rows,
    campaigns: campaignResult.rows,
  };
}

/** 쿠폰 수령 완료 SMS 메시지 생성 */
export function buildCouponSmsMessage(
  storeName: string,
  couponCode: string,
  discountDesc: string,
  expiresAt?: string
): string {
  const lines = [
    `[${storeName}] 쿠폰이 발급되었습니다!`,
    `코드: ${couponCode}`,
    `할인: ${discountDesc}`,
  ];
  if (expiresAt) {
    const d = new Date(expiresAt);
    lines.push(`유효기간: ~${d.getMonth() + 1}/${d.getDate()}`);
  }
  lines.push('매장 방문 시 이 코드를 보여주세요.');
  return lines.join('\n');
}
