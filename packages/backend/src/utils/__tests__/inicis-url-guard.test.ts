/**
 * 이니시스 승인·망취소 호출 주소 검사 계약 (★2026-09-25 한줄로 전수점검 C-14)
 *
 * 왜 있나
 *   `/api/payments/inicis/return`은 로그인이 없는 공개 경로이고, 승인 호출 주소(authUrl)와
 *   망취소 주소(netCancelUrl)를 콜백 본문에서 받는다. 주소를 검사하지 않으면 누구나 자기 서버를
 *   authUrl로 넣어 resultCode '0000'을 돌려주는 것만으로 결제 없이 잔액을 올릴 수 있었다.
 *   이니시스 매뉴얼: 승인 API가 이니시스 제공 주소인지 확인 · 도메인은 *.inicis.com.
 *
 * 못 박는 것
 *   1. https + 호스트가 `.inicis.com`으로 끝나는 주소만 통과한다(뒤에 다른 도메인을 붙인 주소·http·비슷한 이름은 거절).
 *   2. 검사를 통과하지 못한 authUrl로는 fetch를 부르지 않고 승인 실패로 돌려준다.
 *   3. 검사를 통과하지 못한 netCancelUrl로는 fetch를 부르지 않는다.
 *   4. 정상 주소는 종전처럼 호출된다(정상 결제 동작 불변).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isTrustedInicisUrl, approveInicisPayment, netCancelInicisPayment, getInicisConfig } from '../inicis-client';
import type { InicisCallbackBody } from '../inicis-client';

function callbackWith(over: Partial<InicisCallbackBody>): InicisCallbackBody {
  return {
    resultCode: '0000',
    resultMsg: '성공',
    mid: getInicisConfig().mid,
    orderNumber: 'HJ-1-TEST',
    authToken: 'token',
    authUrl: 'https://fcstdpay.inicis.com/api/payAuth',
    netCancelUrl: 'https://fcstdpay.inicis.com/api/netCancel',
    idc_name: 'fc',
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isTrustedInicisUrl', () => {
  it('이니시스 도메인 https 주소는 통과한다', () => {
    expect(isTrustedInicisUrl('https://fcstdpay.inicis.com/api/payAuth')).toBe(true);
    expect(isTrustedInicisUrl('https://ksstdpay.inicis.com/api/payAuth')).toBe(true);
    expect(isTrustedInicisUrl('https://stgstdpay.inicis.com/api/payAuth')).toBe(true);
    expect(isTrustedInicisUrl('https://FCSTDPAY.INICIS.COM/api/payAuth')).toBe(true);
  });

  it('이니시스가 아닌 주소는 거절한다', () => {
    expect(isTrustedInicisUrl('https://evil.com/api/payAuth')).toBe(false);
    expect(isTrustedInicisUrl('https://stdpay.inicis.com.evil.com/api/payAuth')).toBe(false);
    expect(isTrustedInicisUrl('https://evilinicis.com/api/payAuth')).toBe(false);
    expect(isTrustedInicisUrl('https://inicis.com.evil.com/')).toBe(false);
    expect(isTrustedInicisUrl('https://evil.com#.inicis.com')).toBe(false);
    expect(isTrustedInicisUrl('https://evil.com/?x=.inicis.com')).toBe(false);
    expect(isTrustedInicisUrl('https://fcstdpay.inicis.com@evil.com/')).toBe(false);
  });

  it('https가 아니거나 주소가 아니면 거절한다', () => {
    expect(isTrustedInicisUrl('http://fcstdpay.inicis.com/api/payAuth')).toBe(false);
    expect(isTrustedInicisUrl('ftp://fcstdpay.inicis.com/')).toBe(false);
    expect(isTrustedInicisUrl('')).toBe(false);
    expect(isTrustedInicisUrl(undefined)).toBe(false);
    expect(isTrustedInicisUrl(null)).toBe(false);
    expect(isTrustedInicisUrl('not a url')).toBe(false);
    expect(isTrustedInicisUrl(['https://fcstdpay.inicis.com/'] as any)).toBe(false);
  });
});

describe('approveInicisPayment 주소 검사', () => {
  it('이니시스가 아닌 authUrl이면 호출하지 않고 승인 실패', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await approveInicisPayment(callbackWith({ authUrl: 'https://evil.com/approve' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.success).toBe(false);
    expect(r.resultCode).toBe('UNTRUSTED_AUTH_URL');
  });

  it('이니시스 authUrl이면 종전처럼 호출하고 응답으로 판정한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ resultCode: '0000', resultMsg: '정상', tid: 'T1', TotPrice: '10000' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await approveInicisPayment(callbackWith({}));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://fcstdpay.inicis.com/api/payAuth');
    expect(r.success).toBe(true);
    expect(r.tid).toBe('T1');
  });
});

describe('netCancelInicisPayment 주소 검사', () => {
  it('이니시스가 아닌 netCancelUrl이면 호출하지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const ok = await netCancelInicisPayment('https://evil.com/cancel', callbackWith({}));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it('이니시스 netCancelUrl이면 호출한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
    const ok = await netCancelInicisPayment('https://fcstdpay.inicis.com/api/netCancel', callbackWith({}));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });
});
