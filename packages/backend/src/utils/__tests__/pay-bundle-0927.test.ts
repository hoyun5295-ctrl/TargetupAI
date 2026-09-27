/**
 * 결제·잔액 입력 검증 · 결제 콜백 (★ 2026-09-27 한줄로 V2 차수 1 PAY 묶음 — m006 m007 m008 m010 m011 m012 m067 R338 A-03)
 *
 * m006 승인 응답에 금액(TotPrice)이 없거나 0이면 금액 대조를 건너뛰었다(fail-open) · 주문번호(MOID) 대조 없음
 *      → 없거나 다르면 실패(망취소). 칸 이름은 실결제 3건 pg_response 실측으로 확인(MOID·TotPrice 있음 · 주문번호·금액 일치 · Harold 0927).
 * m007 망취소 실패(false)를 버리고 경보가 없었다 → 망취소 CT 안에서 경보.
 * m008 승인·망취소 fetch에 시간 제한이 없었다 → AbortSignal 시간 제한(넘으면 기존 실패 흐름 = 망취소).
 * m010·m011 금액 정수·형식·상한 검증 없음 → 금액 CT(parseWonAmount) 하나로.
 * m012 관리자 수동 잔액 조정: 문자열 금액 연결 · 잔액 UPDATE와 원장 INSERT가 트랜잭션 밖 → 숫자 검사 + 한 트랜잭션.
 * m067 환불 한도(loadDeductLedger)는 브랜드 축에도 빈 유형(NULL) 행을 더하고 스위퍼는 뺐다 → 유형 판정 CT 하나(ledgerMessageTypeSql).
 * R338·A-03 인증 없는 결제 콜백(결제창 실패·닫기 · 승인 실패)이 주문번호만으로 남의 대기 주문을 실패·취소로 바꿨다
 *      → 주문을 만들 때 서버 비밀(signKey)로 주문번호 서명값을 만들어 닫기 URL(cb)·merchantData(cb=)에 싣고,
 *        서명값이 맞을 때만 상태를 바꾼다. 없거나 틀리면 상태를 건드리지 않고 화면만 보여 준다(성공 확정은 승인 + m006이 증명한다).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const alertMock = vi.fn(async (..._a: any[]) => undefined);
vi.mock('../system-alert', () => ({ sendSystemAlert: (...a: any[]) => (alertMock as any)(...a) }));

const txLog: string[] = [];
const state = { pending: null as any };
const client = {
  query: vi.fn(async (sql: string, _p?: any[]) => {
    const s = String(sql).trim();
    txLog.push(s.split(/\s+/).slice(0, 3).join(' '));
    if (s.includes('FROM payments') && s.includes('FOR UPDATE')) return { rows: state.pending ? [state.pending] : [] };
    // ★ 0927 BT m009 — 확정 전 회사 행 잠금 · 선불 재확인(bt-billing-type-0927.test.ts가 후불 거절을 본다)
    if (s.includes('FROM companies') && s.includes('FOR UPDATE')) return { rows: [{ billing_type: 'prepaid' }] };
    if (s.startsWith('UPDATE payments')) return { rows: [{ id: 'p1' }] };
    if (s.startsWith('UPDATE companies')) return { rows: [{ balance: 11000 }] };
    return { rows: [] };
  }),
  release: vi.fn(),
};
vi.mock('../../config/database', () => ({
  default: { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [] })) },
  pool: { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [] })) },
  query: vi.fn(async () => ({ rows: [] })),
}));

import { approveInicisPayment, netCancelInicisPayment, getInicisConfig, prepareInicisPayment, signInicisCallback, verifyInicisCallback, readInicisCallbackToken } from '../inicis-client';
import type { InicisCallbackBody } from '../inicis-client';
import { finalizePaymentSuccess } from '../payment-processor';
import { parseWonAmount } from '../normalize';
import { ledgerMessageTypeSql } from '../deduct-reference';

function callbackWith(over: Partial<InicisCallbackBody> = {}): InicisCallbackBody {
  return {
    resultCode: '0000', resultMsg: '성공', mid: getInicisConfig().mid, orderNumber: 'HJ-1-TEST',
    authToken: 'token', authUrl: 'https://fcstdpay.inicis.com/api/payAuth',
    netCancelUrl: 'https://fcstdpay.inicis.com/api/netCancel', idc_name: 'fc', ...over,
  };
}
const approval = (over: Record<string, any> = {}) => ({
  success: true, resultCode: '0000', resultMsg: '정상', tid: 'T1', totPrice: '10000', moid: 'HJ-1-TEST', raw: {}, ...over,
}) as any;

beforeEach(() => {
  alertMock.mockClear(); txLog.length = 0; client.query.mockClear();
  state.pending = { id: 'p1', company_id: 'c1', user_id: 'u1', amount: '10000', status: 'pending', pg_payment_key: null };
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('m008 이니시스 호출 시간 제한', () => {
  it('승인·망취소 fetch에 시간 제한 신호를 싣는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ resultCode: '0000', tid: 'T1', TotPrice: '10000', MOID: 'HJ-1-TEST' }) });
    vi.stubGlobal('fetch', fetchMock);
    await approveInicisPayment(callbackWith());
    await netCancelInicisPayment('https://fcstdpay.inicis.com/api/netCancel', callbackWith());
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('승인 불명 분류 (PAY Codex 2R high · 매뉴얼 "승인결과 수신 실패")', () => {
  const approveWith = async (resp: any) => {
    vi.stubGlobal('fetch', typeof resp === 'function' ? resp : vi.fn().mockResolvedValue(resp));
    return approveInicisPayment(callbackWith());
  };
  it('명시 결과코드가 오면 불명이 아니다(성공·거절)', async () => {
    expect((await approveWith({ ok: true, text: async () => JSON.stringify({ resultCode: '0000', MOID: 'HJ-1-TEST', TotPrice: '10000' }) })).unknown).toBe(false);
    const r = await approveWith({ ok: true, text: async () => JSON.stringify({ resultCode: 'V013', resultMsg: '거절' }) });
    expect(r.success).toBe(false);
    expect(r.unknown).toBe(false);
    expect(r.resultCode).toBe('V013');
  });
  it.each([
    ['JSON 아님', { ok: true, text: async () => '<html>err</html>' }],
    ['빈 본문', { ok: true, text: async () => '' }],
    ['결과코드 없는 JSON', { ok: true, text: async () => '{}' }],
    ['HTTP 오류 + 결과코드 없음', { ok: false, status: 502, text: async () => 'bad gateway' }],
  ])('%s → 승인 불명(콜백의 0000을 결과로 빌려 쓰지 않는다)', async (_n, resp) => {
    const r = await approveWith(resp);
    expect(r.success).toBe(false);
    expect(r.unknown).toBe(true);
    expect(r.resultCode).toBe('APPROVAL_UNKNOWN');
  });
  it('R201(같은 인증 데이터로 재승인) = 승인 불명 — 이전 승인이 살아 있거나 망취소됐을 수 있다(이니시스 FAQ · PAY Codex 3R high)', async () => {
    const r = await approveWith({ ok: true, text: async () => JSON.stringify({ resultCode: 'R201', resultMsg: '중복 승인 요청' }) });
    expect(r.success).toBe(false);
    expect(r.unknown).toBe(true);
    expect(r.resultCode).toBe('R201');
  });
  it('호출이 던지면(시간 제한 포함) 승인 불명', async () => {
    const r = await approveWith(vi.fn().mockRejectedValue(new Error('timeout')));
    expect(r.unknown).toBe(true);
    expect(r.resultCode).toBe('NETWORK_ERROR');
  });
});

describe('m006 승인 응답 주문번호 · 금액 대조', () => {
  it('승인 결과에 응답의 주문번호(MOID)를 싣는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ resultCode: '0000', tid: 'T1', TotPrice: '10000', MOID: 'HJ-1-TEST' }) }));
    const r = await approveInicisPayment(callbackWith());
    expect(r.moid).toBe('HJ-1-TEST');
  });
  it('금액·주문번호가 맞으면 확정한다', async () => {
    const r = await finalizePaymentSuccess({ orderId: 'HJ-1-TEST', approval: approval() });
    expect(r.amount).toBe(10000);
    expect(txLog).toContain('COMMIT');
  });
  it.each([
    ['금액 없음', { totPrice: undefined }],
    ['금액 0', { totPrice: '0' }],
    ['금액 다름', { totPrice: '9000' }],
    ['금액 숫자 아님', { totPrice: 'abc' }],
    ['주문번호 없음', { moid: undefined }],
    ['주문번호 다름', { moid: 'HJ-2-OTHER' }],
  ])('%s → 확정하지 않고 던진다(호출부가 망취소 · 실패 기록)', async (_n, over) => {
    await expect(finalizePaymentSuccess({ orderId: 'HJ-1-TEST', approval: approval(over) })).rejects.toThrow();
    expect(txLog).toContain('ROLLBACK');
    expect(txLog).not.toContain('COMMIT');
  });
});

describe('m007 망취소 실패 경보 · 성공 판정 = 본문 resultCode 0000 (PAY Codex 1R high · 이니시스 매뉴얼)', () => {
  it('HTTP 200이어도 본문이 성공 코드가 아니면 실패 + 경보', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ resultCode: 'V801', resultMsg: '망취소 불가' }) }));
    expect(await netCancelInicisPayment('https://fcstdpay.inicis.com/api/netCancel', callbackWith())).toBe(false);
    expect(alertMock).toHaveBeenCalledTimes(1);
  });
  it('본문이 JSON이 아니거나 비어 있으면 실패 + 경보', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' }));
    expect(await netCancelInicisPayment('https://fcstdpay.inicis.com/api/netCancel', callbackWith())).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<html>' }));
    expect(await netCancelInicisPayment('https://fcstdpay.inicis.com/api/netCancel', callbackWith())).toBe(false);
    expect(alertMock).toHaveBeenCalledTimes(2);
  });
  it('응답이 실패면 경보', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => 'err' }));
    const ok = await netCancelInicisPayment('https://fcstdpay.inicis.com/api/netCancel', callbackWith());
    expect(ok).toBe(false);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(String((alertMock.mock.calls[0] as any)[0].dedupKey)).toBe('inicis-netcancel-fail:HJ-1-TEST');
  });
  it('호출이 던져도 경보', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    expect(await netCancelInicisPayment('https://fcstdpay.inicis.com/api/netCancel', callbackWith())).toBe(false);
    expect(alertMock).toHaveBeenCalledTimes(1);
  });
  it('성공이면 경보 없음', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ resultCode: '0000' }) }));
    expect(await netCancelInicisPayment('https://fcstdpay.inicis.com/api/netCancel', callbackWith())).toBe(true);
    expect(alertMock).not.toHaveBeenCalled();
  });
});

describe('R338·A-03 콜백 서명값', () => {
  it('주문번호마다 다르고 같은 주문번호는 같다 · 맞을 때만 통과', () => {
    const a = signInicisCallback('HJ-1-TEST');
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(signInicisCallback('HJ-1-TEST')).toBe(a);
    expect(signInicisCallback('HJ-2-TEST')).not.toBe(a);
    expect(verifyInicisCallback('HJ-1-TEST', a)).toBe(true);
    expect(verifyInicisCallback('HJ-2-TEST', a)).toBe(false);
    expect(verifyInicisCallback('HJ-1-TEST', '')).toBe(false);
    expect(verifyInicisCallback('HJ-1-TEST', undefined)).toBe(false);
    expect(verifyInicisCallback('HJ-1-TEST', a.slice(0, 31))).toBe(false);
  });
  it('merchantData(cb=)·닫기 쿼리(cb)에서 서명값을 읽는다', () => {
    const t = signInicisCallback('HJ-1-TEST');
    expect(readInicisCallbackToken({ merchantData: `cb=${t}` })).toBe(t);
    expect(readInicisCallbackToken({ cb: t })).toBe(t);
    expect(readInicisCallbackToken({})).toBe('');
  });
  it('결제창 폼: 닫기 URL에 cb 쿼리 · merchantData에 cb= 를 싣는다', () => {
    const f = prepareInicisPayment({
      orderId: 'HJ-1-TEST', companyId: 'c1', userId: 'u1', amount: 10000, productName: 'p', buyerName: 'b', buyerEmail: '', buyerTel: '',
      returnUrl: 'https://hanjul.ai/api/payments/inicis/return', closeUrl: 'https://hanjul.ai/api/payments/inicis/close',
    } as any);
    const t = signInicisCallback('HJ-1-TEST');
    expect(f.closeUrl).toBe(`https://hanjul.ai/api/payments/inicis/close?cb=${t}`);
    expect(f.merchantData).toBe(`cb=${t}`);
    expect(f.returnUrl).toBe('https://hanjul.ai/api/payments/inicis/return');
  });
});

describe('m010·m011·m012 금액 CT', () => {
  it('정수 원 · 하한 · 상한 · 형식', () => {
    expect(parseWonAmount(10000, { min: 1000, max: 100_000_000 })).toBe(10000);
    expect(parseWonAmount('10000', { min: 1000, max: 100_000_000 })).toBe(10000);
    expect(parseWonAmount(999, { min: 1000, max: 100_000_000 })).toBeNull();
    expect(parseWonAmount(100_000_001, { min: 1000, max: 100_000_000 })).toBeNull();
    expect(parseWonAmount(1000.5, { min: 1000, max: 100_000_000 })).toBeNull();
    expect(parseWonAmount('1e4', { min: 1000, max: 100_000_000 })).toBeNull();
    expect(parseWonAmount('10,000', { min: 1000, max: 100_000_000 })).toBeNull();
    expect(parseWonAmount(null, { min: 1000, max: 100_000_000 })).toBeNull();
    expect(parseWonAmount(NaN, { min: 1000, max: 100_000_000 })).toBeNull();
    expect(parseWonAmount(true as any, { min: 1000, max: 100_000_000 })).toBeNull();
  });
  it('관리자 조정은 소수 둘째 자리까지 허용한다(단가가 소수 · 환불 조정)', () => {
    expect(parseWonAmount(27.5, { min: 0.01, max: 100_000_000, decimals: 2 })).toBe(27.5);
    expect(parseWonAmount('27.55', { min: 0.01, max: 100_000_000, decimals: 2 })).toBe(27.55);
    expect(parseWonAmount(27.555, { min: 0.01, max: 100_000_000, decimals: 2 })).toBeNull();
    expect(parseWonAmount(0, { min: 0.01, max: 100_000_000, decimals: 2 })).toBeNull();
    // 부동소수 곱셈 오차로 정상 금액을 거절하지 않는다(PAY Codex 1R · 131072.02 × 100 = 13107201.999999998)
    expect(parseWonAmount(131072.02, { min: 0.01, max: 100_000_000, decimals: 2 })).toBe(131072.02);
    expect(parseWonAmount('131072.02', { min: 0.01, max: 100_000_000, decimals: 2 })).toBe(131072.02);
    expect(parseWonAmount(0.1 + 0.2, { min: 0.01, max: 100_000_000, decimals: 2 })).toBeNull();
  });
});

describe('m067 원장 유형 판정 CT', () => {
  it('브랜드 축은 빈 유형 행을 빼고 그 밖은 더한다', () => {
    expect(ledgerMessageTypeSql('BRAND', '$3')).toBe('message_type = $3');
    expect(ledgerMessageTypeSql('LMS', '$3')).toBe('(message_type = $3 OR message_type IS NULL)');
    expect(ledgerMessageTypeSql('KAKAO', '$3')).toBe('(message_type = $3 OR message_type IS NULL)');
  });
});

describe('배선', () => {
  const route = readFileSync(join(__dirname, '..', '..', 'routes', 'payments.ts'), 'utf8');
  const balance = readFileSync(join(__dirname, '..', '..', 'routes', 'balance.ts'), 'utf8');
  const admin = readFileSync(join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf8');
  const prepaid = readFileSync(join(__dirname, '..', 'prepaid.ts'), 'utf8');
  const sweeper = readFileSync(join(__dirname, '..', 'mysql-refund-sweeper.ts'), 'utf8');
  const client = readFileSync(join(__dirname, '..', 'inicis-client.ts'), 'utf8');
  const fe = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'BalanceModals.tsx'), 'utf8');

  it('결제 콜백의 실패·취소 기록은 모두 서명값 확인 뒤에만 — 리턴 3곳 · 닫기 POST·GET', () => {
    // 콜백 라우트(인증 앞)의 finalizePaymentFailure 호출은 전부 서명값 확인 헬퍼를 거친다
    const pub = route.slice(0, route.indexOf('router.use(authenticate);'));
    // 공개 구역의 실패 기록 호출은 서명값 확인 헬퍼 안 1건뿐
    expect(pub.split('await finalizePaymentFailure(').length - 1).toBe(1);
    expect(pub.split('await failTrustedCallback(').length - 1).toBe(5);
    const helper = route.slice(route.indexOf('async function failTrustedCallback('), route.indexOf('async function failTrustedCallback(') + 1200);
    expect(helper).toMatch(/if \(!verifyInicisCallback\(orderId, token\)\) \{[\s\S]*?return null;/);
    expect(helper).toContain('await finalizePaymentFailure(');
  });

  it('망취소는 "이 주문의 거래가 승인됐는데 우리 처리가 실패"한 한 곳에서만 — 매뉴얼(승인결과 처리 중 예외) · 재사용 토큰 차단 (PAY Codex 1R)', () => {
    const h = route.slice(route.indexOf("router.post('/inicis/return'"), route.indexOf("router.post('/inicis/close'"));
    expect(h.split('netCancelInicisPayment(').length - 1).toBe(1);
    const iApprove = h.indexOf('const approval = await approveInicisPayment(callback);');
    const iFinalize = h.indexOf('await finalizePaymentSuccess({ orderId, approval })');
    const iCancel = h.indexOf('netCancelInicisPayment(');
    expect(iCancel).toBeGreaterThan(iFinalize);   // 확정 실패 catch 안
    // 승인 실패 응답 = 망취소 없음
    const failSeg = h.slice(iApprove, h.indexOf('// 결제 성공 확정'));
    expect(failSeg).not.toContain('netCancelInicisPayment(');
    // 승인 불명(미수신·해석 불가) = 자동 망취소·상태 변경 없음 · 서명값이 맞는 실제 대기 주문일 때만 경보 (2R high)
    expect(failSeg).toMatch(/if \(!approval\.success && approval\.unknown\) \{[\s\S]*?verifyInicisCallback\(orderId, callbackToken\)[\s\S]*?sendSystemAlert\([\s\S]*?return;/);
    expect(failSeg).not.toContain("approval.resultCode === 'NETWORK_ERROR'");
    // 승인 응답 주문번호가 이 주문과 다르면 확정·망취소·상태 변경 없음
    expect(h).toMatch(/if \(String\(approval\.moid \?\? ''\)\.trim\(\) !== orderId\) \{[\s\S]*?return;\s*\}\s*\n\s*\/\/ 결제 성공 확정/);
  });

  it('확정 실패 뒤: 상태를 다시 읽어 completed면 망취소 없이 성공 · 다시 읽기 실패면 망취소 없이 경보 · 그 밖은 망취소(빈 주소도 CT로 넘겨 경보) (2R medium · 범위 밖)', () => {
    const h = route.slice(route.indexOf("router.post('/inicis/return'"), route.indexOf("router.post('/inicis/close'"));
    const c = h.slice(h.indexOf('} catch (finalErr: any) {'));
    const iReread = c.indexOf('await readInicisPaymentState(orderId)');
    const iCancel = c.indexOf('netCancelInicisPayment(');
    expect(iReread).toBeGreaterThan(-1);
    expect(iReread).toBeLessThan(iCancel);
    expect(c).toMatch(/after\.status === 'completed'\) \{[\s\S]*?renderResultHtml\('success'[\s\S]*?return;/);
    expect(c).toMatch(/if \(!after\) \{[\s\S]*?sendSystemAlert\([\s\S]*?return;/);
    expect(c).toContain("await netCancelInicisPayment(callback.netCancelUrl || '', callback)");
  });

  it('금액 CT를 쓴다 — 카드 준비·무통장 요청(정수 1,000~1억) · 관리자 조정(소수 둘째 자리)', () => {
    expect(route).toContain('parseWonAmount(amount, { min: 1000, max: 100_000_000 })');
    expect(balance).toContain('parseWonAmount(req.body?.amount, { min: 1000, max: 100_000_000 })');
    expect(admin).toContain('parseWonAmount(req.body?.amount, { min: 0.01, max: 100_000_000, decimals: 2 })');
  });

  it('관리자 조정은 잔액 변경과 원장 기록이 한 트랜잭션', () => {
    const at = admin.indexOf("const txType = type === 'charge' ? 'admin_charge' : 'admin_deduct';");
    const seg = admin.slice(at, admin.indexOf('} catch (error)', at));
    expect(seg).toContain("await client.query('BEGIN');");
    expect(seg.split("await client.query('COMMIT');").length - 1).toBeGreaterThanOrEqual(1);
    expect(seg).not.toMatch(/await query\(\s*['`]UPDATE companies SET balance/);
    expect(seg).not.toMatch(/await query\(\s*`INSERT INTO balance_transactions/);
    // 연결 획득도 try 안(실패해도 500 응답) · 잔액 부족 뒤 회사 조회도 잡은 연결로(두 번째 연결을 기다리지 않는다) (PAY Codex 1R)
    const route2 = admin.slice(admin.indexOf("router.post('/companies/:id/balance-adjust'"), admin.indexOf('// 회사별 잔액 이력 조회 (슈퍼관리자용)'));
    expect(route2).toMatch(/let client: PoolClient \| null = null;\s*try \{\s*client = await pool\.connect\(\);/);
    expect(route2).toContain("const co = await client.query('SELECT balance, company_name FROM companies WHERE id = $1', [id]);");
    expect(route2).toMatch(/\} finally \{\s*client\?\.release\(\);\s*\}/);
  });

  it('원장 유형 판정은 CT 하나 — prepaid 4곳 · 스위퍼', () => {
    expect(prepaid).not.toContain('AND (message_type = $3 OR message_type IS NULL)');
    expect(prepaid.split('${ledgerMessageTypeSql(messageType').length - 1).toBe(4);
    expect(sweeper).toContain('ledgerMessageTypeSql(axisType,');
  });

  it('망취소 경보는 CT 안(효과가 만들어지는 자리)', () => {
    const fn = client.slice(client.indexOf('export async function netCancelInicisPayment('));
    expect(fn).toContain('inicis-netcancel-fail:');
  });

  it('프론트 결제 폼이 merchantData를 싣는다', () => {
    expect(fe).toContain("merchantData: form.merchantData || ''");
  });
});
