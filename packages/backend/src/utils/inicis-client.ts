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
import { TIMEOUTS } from '../config/defaults';
import { sendSystemAlert } from './system-alert';

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

/**
 * ★ 2026-09-27 한줄로 V2 R338·A-03 — 결제 콜백 서명값(주문번호별).
 * 결제창 실패·닫기 콜백과 승인 실패 뒤 실패 기록은 인증 없는 공개 경로라, 주문번호만 알면 남의 대기 주문을 실패·취소로 바꿀 수 있었다.
 * 주문을 만들 때 서버 비밀(signKey)로 주문번호의 HMAC을 만들어 닫기 URL(cb 쿼리)·merchantData(cb=)에 싣고,
 * 콜백이 돌려준 값이 맞을 때만 상태를 바꾼다(payments.ts failTrustedCallback). 성공 확정은 승인 + 주문번호·금액 대조가 증명한다.
 */
export function signInicisCallback(orderId: string): string {
  return crypto.createHmac('sha256', getInicisConfig().signKey).update(`inicis-callback:${orderId}`, 'utf-8').digest('hex').slice(0, 32);
}

export function verifyInicisCallback(orderId: string, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== 32 || !orderId) return false;
  const expected = Buffer.from(signInicisCallback(orderId), 'utf-8');
  const given = Buffer.from(token, 'utf-8');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** 콜백 본문·쿼리에서 서명값을 읽는다 — merchantData 'cb=값' 또는 cb 칸. 없으면 '' */
export function readInicisCallbackToken(src: Record<string, any> | null | undefined): string {
  if (!src) return '';
  const direct = typeof src.cb === 'string' ? src.cb : '';
  if (direct) return direct.trim();
  const md = typeof src.merchantData === 'string' ? src.merchantData : '';
  const m = md.match(/(?:^|&)cb=([0-9a-f]{32})(?:&|$)/);
  return m ? m[1] : '';
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
  /** ★ 2026-09-27 R338·A-03 콜백 서명값 — 이니시스가 리턴 콜백에 그대로 돌려준다 */
  merchantData: string;
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

  // ★ 2026-09-27 R338·A-03 콜백 서명값 — 닫기 URL 쿼리와 merchantData에 싣는다(서명 대상 필드가 아니라 결제 서명은 그대로)
  const cb = signInicisCallback(orderId);
  const closeUrl = `${input.closeUrl}${input.closeUrl.includes('?') ? '&' : '?'}cb=${cb}`;

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
    closeUrl,
    merchantData: `cb=${cb}`,
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
  /** ★ 2026-09-27 m006 승인 응답의 주문번호(MOID) — 확정 때 우리 주문번호와 대조한다(실결제 pg_response 실측으로 칸 이름 확인) */
  moid?: string;
  raw: Record<string, any>;
}

/**
 * 콜백으로 받은 호출 주소(authUrl·netCancelUrl)가 이니시스 주소인가.
 * ★ 2026-09-25 한줄로 전수점검 C-14: `/inicis/return`은 로그인 없는 공개 경로라 콜백 본문을 누구나 만들 수 있다.
 *   주소를 검사하지 않으면 자기 서버를 authUrl로 넣고 resultCode '0000'만 돌려줘 결제 없이 잔액을 올릴 수 있었다.
 *   이니시스 매뉴얼 = 승인 API가 이니시스 제공 주소인지 확인 · 도메인은 *.inicis.com.
 *   ⛔ 센터 코드(idc_name)별 주소 경로 전체는 매뉴얼에 없어 경로·센터로는 막지 않는다(정상 결제가 깨질 수 있다).
 */
export function isTrustedInicisUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  return parsed.hostname.toLowerCase().endsWith('.inicis.com');
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

  // 승인 호출 주소 검사(C-14) — 이니시스 주소가 아니면 호출하지 않는다
  if (!isTrustedInicisUrl(callback.authUrl)) {
    console.error(`[inicis-client] 이니시스가 아닌 authUrl 거절: order=${callback.orderNumber} authUrl=${String(callback.authUrl).slice(0, 200)}`);
    return {
      success: false,
      resultCode: 'UNTRUSTED_AUTH_URL',
      resultMsg: '승인 주소가 이니시스 주소가 아닙니다',
      raw: callback as any,
    };
  }
  // 센터 코드와 호스트가 어긋나면 기록만 한다(매뉴얼에 경로 전체가 없어 막지 않는다)
  const authHost = new URL(callback.authUrl).hostname.toLowerCase();
  if (callback.idc_name && !authHost.startsWith(`${String(callback.idc_name).toLowerCase()}stdpay.`)) {
    console.warn(`[inicis-client] authUrl 호스트와 idc_name 불일치(통과): order=${callback.orderNumber} idc=${callback.idc_name} host=${authHost}`);
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
      // ★ 2026-09-27 m008 시간 제한 — 넘으면 아래 catch = 승인 실패 → 호출부가 망취소
      signal: AbortSignal.timeout(TIMEOUTS.inicisApi),
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
    moid: json.MOID || json.moid,
    raw: json,
  };
}

// 결제 취소 영역 (사용자가 결제창을 닫거나 인증 실패 시 netCancelUrl 호출)
export async function netCancelInicisPayment(netCancelUrl: string, callback: InicisCallbackBody): Promise<boolean> {
  // 망취소 주소 검사(C-14) — 이니시스 주소가 아니면 호출하지 않는다(authToken·서명을 밖으로 보내지 않는다)
  if (!isTrustedInicisUrl(netCancelUrl)) {
    console.error(`[inicis-client] 이니시스가 아닌 netCancelUrl 거절: order=${callback.orderNumber} url=${String(netCancelUrl).slice(0, 200)}`);
    alertNetCancelFail(callback, '이니시스가 아닌 망취소 주소');
    return false;
  }
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
      signal: AbortSignal.timeout(TIMEOUTS.inicisApi),   // ★ 2026-09-27 m008
    });
    const text = await response.text();
    console.log('[inicis-client] netCancel response:', text);
    // ★ 2026-09-27 PAY Codex 1R — 성공 = 본문 resultCode '0000'(이니시스 매뉴얼 · 요청 format=JSON). HTTP 200만으로는 성공이 아니다.
    let code = '';
    try { code = String(JSON.parse(text)?.resultCode ?? ''); } catch { /* JSON 아님 = 실패 */ }
    const ok = response.ok && code === '0000';
    if (!ok) alertNetCancelFail(callback, `응답 ${response.status} · resultCode ${code || '(없음)'}`);
    return ok;
  } catch (err: any) {
    console.error('[inicis-client] netCancel 호출 실패:', err.message || err);
    alertNetCancelFail(callback, String(err?.message || err));
    return false;
  }
}

/**
 * ★ 2026-09-27 한줄로 V2 m007 — 망취소 실패 경보. 승인·확정 실패 뒤 망취소까지 실패하면 카드는 결제됐는데 잔액은 그대로이고
 * 결제 행은 failed라 아무도 모른다. 호출부가 반환값을 버려도 알 수 있게 망취소 CT 안에서 알린다. 경보 실패가 흐름을 막지 않는다.
 */
function alertNetCancelFail(callback: InicisCallbackBody, reason: string): void {
  void sendSystemAlert({
    dedupKey: `inicis-netcancel-fail:${callback.orderNumber}`,
    message: `카드결제 망취소 실패 — 주문 ${callback.orderNumber} (${reason.slice(0, 120)}). 이니시스 관리자에서 거래 취소 여부를 확인해 주세요(카드 결제만 되고 충전은 안 된 상태일 수 있음).`,
  }).catch(() => undefined);
}
