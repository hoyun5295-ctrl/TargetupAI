// utils/inicis-client.ts (CT-41)
// 이니시스 표준결제 (INIStdPay v2.x) Node.js HTTP API 영역
// SoT: status/legacy-payment-migration.md §3-3 + §6-2
// 레거시 invitobiz.com /home/pay/ Tomcat6 INIpay50 Java SDK → Node.js 직접 호출 본질
//
// 흐름:
//  1) prepareInicisPayment(input) → mid/orderId/timestamp/signature/verification/mKey 응답
//  2) Frontend → form 데이터로 INIStdPay.pay('form_id') 호출 → 이니시스 결제창 팝업
//  3) 이니시스 결제 처리 후 P_NEXT_URL(/api/payments/inicis/return)로 form POST
//  4) approveInicisPayment(callback) → authUrl POST + signature → 승인 응답 (resultCode='0000' = 성공)
//  5) processPaymentSuccess(payment-processor.ts) → payments INSERT + balance 증가

import crypto from 'crypto';
import type { Request } from 'express';

// 이니시스 표준 테스트 영역 (이니시스 공식 매뉴얼 표준 영역)
const INICIS_TEST_MID = 'INIpayTest';
const INICIS_TEST_SIGN_KEY = 'SU5JTElURV9UUklQTEVERVNfS0VZU1RS';
const INICIS_TEST_STDPAY_URL = 'https://stgstdpay.inicis.com/stdjs/INIStdPay.js';
const INICIS_PROD_STDPAY_URL = 'https://stdpay.inicis.com/stdjs/INIStdPay.js';

export interface InicisConfig {
  mid: string;
  signKey: string;
  stdpayUrl: string;
  isProduction: boolean;
}

export function getInicisConfig(): InicisConfig {
  const mode = (process.env.INICIS_MODE || 'test').toLowerCase();
  const isProduction = mode === 'production';

  if (isProduction) {
    const mid = process.env.INICIS_MID;
    const signKey = process.env.INICIS_SIGN_KEY;
    if (!mid || !signKey) {
      throw new Error('[inicis-client] INICIS_MID / INICIS_SIGN_KEY 환경변수 미설정');
    }
    return {
      mid,
      signKey,
      stdpayUrl: INICIS_PROD_STDPAY_URL,
      isProduction: true,
    };
  }

  return {
    mid: process.env.INICIS_MID_TEST || INICIS_TEST_MID,
    signKey: process.env.INICIS_SIGN_KEY_TEST || INICIS_TEST_SIGN_KEY,
    stdpayUrl: INICIS_TEST_STDPAY_URL,
    isProduction: false,
  };
}

// 이니시스 표준결제 v2.x signature 영역 (SHA256 hex)
function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

// orderId 영역 생성 (한줄로 영역 prefix + timestamp + random hex)
export function generateOrderId(): string {
  const ts = Date.now();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `HJ-${ts}-${rand}`;
}

// ── 결제창 호출 영역 ──────────────────────────────────────

export interface PrepareInicisInput {
  orderId: string;          // 외부에서 박은 orderId (payment-processor의 createPendingPayment 영역 정합)
  companyId: string;
  userId: string | null;
  amount: number;
  productName: string;
  buyerName: string;
  buyerEmail: string;
  buyerTel: string;
  returnUrl: string;
  closeUrl: string;
}

export interface PrepareInicisOutput {
  mid: string;
  orderId: string;
  amount: number;
  productName: string;
  buyerName: string;
  buyerEmail: string;
  buyerTel: string;
  timestamp: string;
  signature: string;
  verification: string;
  mKey: string;
  returnUrl: string;
  closeUrl: string;
  stdpayUrl: string;
  currency: 'WON';
  gopaymethod: 'Card';
  acceptmethod: string;
  isProduction: boolean;
}

export function prepareInicisPayment(input: PrepareInicisInput): PrepareInicisOutput {
  const config = getInicisConfig();
  const timestamp = String(Date.now());
  const orderId = input.orderId;

  // 결제창 호출 signature 영역 (이니시스 v2.x 표준)
  const signature = sha256(`oid=${orderId}&price=${input.amount}&timestamp=${timestamp}`);

  // verification 영역 (signKey 포함)
  const verification = sha256(`oid=${orderId}&price=${input.amount}&signKey=${config.signKey}&timestamp=${timestamp}`);

  // mKey 영역 (signKey의 SHA256)
  const mKey = sha256(config.signKey);

  return {
    mid: config.mid,
    orderId,
    amount: input.amount,
    productName: input.productName,
    buyerName: input.buyerName,
    buyerEmail: input.buyerEmail,
    buyerTel: input.buyerTel,
    timestamp,
    signature,
    verification,
    mKey,
    returnUrl: input.returnUrl,
    closeUrl: input.closeUrl,
    stdpayUrl: config.stdpayUrl,
    currency: 'WON',
    gopaymethod: 'Card',
    // 카드결제만 + 할부 0/2/3/6개월 + 무이자 X + 신용카드만(체크카드 포함)
    acceptmethod: 'HPP(1):below1000:va_receipt:no_receipt',
    isProduction: config.isProduction,
  };
}

// ── 이니시스 callback URL 동적 helper (V023 사고 차단 — 사용자 진입 origin 정합) ────────────────────

export interface InicisCallbackUrls {
  baseUrl: string;
  returnUrl: string;
  closeUrl: string;
}

/**
 * 사용자 진입 origin (req.get('host')) 활용하여 closeUrl/returnUrl 동적 생성.
 * 이니시스 V023 에러 ("closeUrl의 domain이 요청페이지의 domain과 다름") 차단 의무.
 * trust proxy 'loopback' 정합 (app.ts L111) → req.protocol 자동 X-Forwarded-Proto 인식.
 */
export function getInicisCallbackUrls(req: Request): InicisCallbackUrls {
  const xfProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim();
  // 운영 환경 = HTTPS 강제 fallback (이니시스 결제 = HTTPS 의무).
  // nginx 안 X-Forwarded-Proto header 누락 시 req.protocol = 'http' (nginx → backend 내부 HTTP)
  // → closeUrl/returnUrl HTTP protocol 활용 시 = 이니시스 V023 사고 발생 (HTTP vs HTTPS 불일치)
  const proto = xfProto || 'https';
  const host = req.get('host') || 'app.hanjul.ai';
  const baseUrl = `${proto}://${host}`;
  return {
    baseUrl,
    returnUrl: `${baseUrl}/api/payments/inicis/return`,
    closeUrl: `${baseUrl}/api/payments/inicis/close`,
  };
}

// ── 이니시스 callback 영역 (P_NEXT_URL form POST) ─────────

export interface InicisCallbackBody {
  resultCode: string;
  resultMsg: string;
  mid: string;
  orderNumber: string;
  authToken: string;
  authUrl: string;
  netCancelUrl: string;
  checkAckUrl?: string;
  charset?: string;
  merchantData?: string;
  idc_name?: string;
}

export interface InicisApprovalResult {
  success: boolean;
  resultCode: string;
  resultMsg: string;
  tid?: string;
  applNum?: string;
  applDate?: string;
  applTime?: string;
  payMethod?: string;
  cardName?: string;
  cardQuota?: string;
  totPrice?: string;
  raw: Record<string, any>;
}

// authUrl POST 호출 = 결제 승인 영역
export async function approveInicisPayment(callback: InicisCallbackBody): Promise<InicisApprovalResult> {
  const config = getInicisConfig();

  // callback resultCode 1차 확인
  if (callback.resultCode !== '0000') {
    return {
      success: false,
      resultCode: callback.resultCode,
      resultMsg: callback.resultMsg,
      raw: callback as any,
    };
  }

  // mid 영역 정합 검증
  if (callback.mid !== config.mid) {
    return {
      success: false,
      resultCode: 'MID_MISMATCH',
      resultMsg: `mid 불일치 (callback=${callback.mid}, config=${config.mid})`,
      raw: callback as any,
    };
  }

  const timestamp = String(Date.now());
  const signature = sha256(`authToken=${callback.authToken}&timestamp=${timestamp}`);
  const verification = sha256(`authToken=${callback.authToken}&signKey=${config.signKey}&timestamp=${timestamp}`);

  // authUrl POST 호출
  const params = new URLSearchParams();
  params.append('mid', callback.mid);
  params.append('authToken', callback.authToken);
  params.append('timestamp', timestamp);
  params.append('signature', signature);
  params.append('verification', verification);
  params.append('charset', 'UTF-8');
  params.append('format', 'JSON');

  let json: Record<string, any> = {};
  try {
    const response = await fetch(callback.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString(),
    });
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw_text: text };
    }
  } catch (err: any) {
    return {
      success: false,
      resultCode: 'NETWORK_ERROR',
      resultMsg: `authUrl 호출 실패: ${err.message || err}`,
      raw: { callback, error: String(err) },
    };
  }

  const approved = json.resultCode === '0000';
  return {
    success: approved,
    resultCode: json.resultCode || callback.resultCode,
    resultMsg: json.resultMsg || callback.resultMsg,
    tid: json.tid || json.TID,
    applNum: json.applNum || json.ApplNum,
    applDate: json.applDate || json.ApplDate,
    applTime: json.applTime || json.ApplTime,
    payMethod: json.payMethod || json.PayMethod,
    cardName: json.CARD_Name || json.cardName || json.cardCorpName,
    cardQuota: json.CARD_Quota || json.cardQuota,
    totPrice: json.TotPrice || json.totPrice,
    raw: json,
  };
}

// 결제 취소 영역 (사용자가 결제창을 닫거나 인증 실패 시 netCancelUrl 호출)
export async function netCancelInicisPayment(netCancelUrl: string, callback: InicisCallbackBody): Promise<boolean> {
  const config = getInicisConfig();
  const timestamp = String(Date.now());
  const signature = sha256(`authToken=${callback.authToken}&timestamp=${timestamp}`);
  const verification = sha256(`authToken=${callback.authToken}&signKey=${config.signKey}&timestamp=${timestamp}`);

  const params = new URLSearchParams();
  params.append('mid', callback.mid);
  params.append('authToken', callback.authToken);
  params.append('timestamp', timestamp);
  params.append('signature', signature);
  params.append('verification', verification);
  params.append('charset', 'UTF-8');
  params.append('format', 'JSON');

  try {
    const response = await fetch(netCancelUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params.toString(),
    });
    const text = await response.text();
    console.log('[inicis-client] netCancel response:', text);
    return response.ok;
  } catch (err: any) {
    console.error('[inicis-client] netCancel 호출 실패:', err.message || err);
    return false;
  }
}
