/**
 * ★ 2026-10-06 한국모바일인증 인증기관 구현(`identity-provider-kmc.ts`) — 범용 개발가이드 v2.0 · NodeJS 예제와 같은 순서인가,
 *   남의 인증 결과 · 위조 결과 · 실패 코드를 거절하는가. 암호화 모듈은 표로 흉내 내고(모드 · 입력 → 결과), 서버끼리 통신은 fetch 를 바꿔 끼운다.
 *   응답 칸 이름(result_cd · apiRecCert · apiCertNum)과 결과 18칸 순서는 KMC 예제 `kmcis_web_sample_main.js` 원문 그대로다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';

const cryptoTable = new Map<string, string>();
const cryptoCalls: Array<[string, string]> = [];
vi.mock('../kmc-crypto', async (orig) => {
  const real = await orig<typeof import('../kmc-crypto')>();
  return {
    ...real,
    kmcCrypto: vi.fn(async (_cmd: any, mode: string, input: string) => {
      cryptoCalls.push([mode, input]);
      return cryptoTable.get(`${mode}:${input}`) ?? '';
    }),
  };
});
vi.mock('../../config/database', () => {
  const pool = { connect: vi.fn() };
  return { query: vi.fn(), mysqlQuery: vi.fn(), pool, default: pool };
});

import {
  kmcProvider, kmcConfig, kstStamp, kmcCertNumOf, kmcTrCertPlain, KMC_REQUEST_URL, KMC_TOKEN_API_URL,
} from '../identity-provider-kmc';
import { resolveIdentityProvider, registerIdentityProvider } from '../identity-verify';

const VERIFICATION_ID = '6f1c2b3a-4d5e-4f60-8a9b-0c1d2e3f4a5b';
const EXPECTED = '6f1c2b3a4d5e4f608a9b0c1d2e3f4a5b';
const TOKEN_PLAIN = 'a'.repeat(64);
// 형식만 맞는 도달 불가 값(010-0000-0000) · 시험용 이름
const RESULT_FIELDS = [EXPECTED, '20261006120000', 'CIENC', '01000000000', 'SKT', '19800101', '0', '0', '홍길동', 'Y', 'M', '203.0.113.10', '', '', '', '', '', 'DIENC'];
const REQ: any = { ip: '203.0.113.10', headers: {} };
const ENV_KEYS = ['KMC_CP_ID', 'KMC_URL_CODE', 'KMC_CRYPTO_PATH', 'HANJUL_BASE_URL', 'IDENTITY_VERIFY_PROVIDER'];
const saved: Record<string, string | undefined> = {};

function seedVerify(fields: string[] = RESULT_FIELDS) {
  cryptoTable.set('dec:TOKENENC', TOKEN_PLAIN);
  cryptoTable.set('dec:CERTENC', EXPECTED);
  cryptoTable.set('dec:RECCERT', 'INNER/MACVAL');
  cryptoTable.set('msg:INNER', 'MACVAL');
  cryptoTable.set('dec:INNER', fields.join('/'));
  cryptoTable.set('dec:DIENC', 'DIPLAIN');
}
function stubTokenApi(body: any, init: { ok?: boolean; status?: number } = {}) {
  const fn = vi.fn(async () => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const verify = (payload: any = { apiToken: 'TOKENENC', certNum: 'CERTENC' }) => kmcProvider.verify(payload, { verificationId: VERIFICATION_ID, req: REQ });

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.KMC_CP_ID = 'TEST1001';
  process.env.KMC_URL_CODE = '001001';
  process.env.KMC_CRYPTO_PATH = process.execPath; // 실제로 있는 실행 파일(설정 판정용 · 실행하지 않는다)
  process.env.HANJUL_BASE_URL = 'https://hanjul.ai';
  delete process.env.IDENTITY_VERIFY_PROVIDER;
  registerIdentityProvider(null);
  cryptoTable.clear();
  cryptoCalls.length = 0;
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
});

describe('KMC 설정 판정 — 다 있고 실행 파일이 있을 때만 인증기관', () => {
  it('설정이 다 있으면 인증기관 = kmc · 결과 수신 주소 = 서비스 주소 + 복귀 통로', () => {
    expect(kmcConfig()).toEqual({ cpId: 'TEST1001', urlCode: '001001', cryptoPath: process.execPath, returnUrl: 'https://hanjul.ai/api/auth/identity/return' });
    expect(resolveIdentityProvider()?.name).toBe('kmc');
  });
  it('하나라도 없거나 이상하면 null — 아무도 본인인증을 요구받지 않는다', () => {
    process.env.KMC_URL_CODE = '1234';
    expect(kmcConfig()).toBeNull();
    expect(resolveIdentityProvider()).toBeNull();
    process.env.KMC_URL_CODE = '001001';
    process.env.KMC_CP_ID = 'AB/CD'; // tr_cert 칸 구분자가 섞이면 요청이 깨진다
    expect(kmcConfig()).toBeNull();
    process.env.KMC_CP_ID = 'TEST1001';
    process.env.KMC_CRYPTO_PATH = `${process.execPath}.no-such-file`;
    expect(kmcConfig()).toBeNull();
    // ★ Codex 1R — 폴더 경로(압축 푼 폴더를 잘못 넣음)는 실행 파일이 아니다
    process.env.KMC_CRYPTO_PATH = tmpdir();
    expect(kmcConfig()).toBeNull();
    expect(resolveIdentityProvider()).toBeNull();
  });
});

describe('KMC 요청 만들기(buildStart)', () => {
  it('한국 시각 yyyyMMddHHmmss · 요청번호 = 인증 건 번호 32자', () => {
    expect(kstStamp(new Date('2026-10-06T15:30:05Z'))).toBe('20261007003005');
    expect(kstStamp(new Date('2026-12-31T15:00:00Z'))).toBe('20270101000000');
    expect(kmcCertNumOf(VERIFICATION_ID)).toBe(EXPECTED);
    expect(() => kmcCertNumOf('not-a-uuid')).toThrow('KMC_BAD_VERIFICATION_ID');
  });

  it('tr_cert 평문 = 예제의 조립식과 글자 하나까지 같다(구분자 12개)', () => {
    const cpId = 'TEST1001', urlCode = '001001', certNum = EXPECTED, date = '20261006120000', certMet = 'M', plusInfo = '', extendVar = '0000000000000000';
    const sample = cpId + '/' + urlCode + '/' + certNum + '/' + date + '/' + certMet + '///////' + plusInfo + '/' + extendVar;
    const mine = kmcTrCertPlain({ cpId, urlCode }, certNum, date);
    expect(mine).toBe(sample);
    expect(mine.split('/').length - 1).toBe(12);
  });

  it('암호화 → 위변조 검사값 → 2차 암호화 → 팝업 폼(kmcisReq.jsp · V2 · iframe 아님)', async () => {
    cryptoTable.set('msg:ENC1', 'MAC1');
    cryptoTable.set('enc:ENC1/MAC1/0000000000000000', 'KMC000002-ENC2');
    const { kmcCrypto } = await import('../kmc-crypto');
    (kmcCrypto as any).mockImplementationOnce(async (_c: any, mode: string, input: string) => { cryptoCalls.push([mode, input]); return 'ENC1'; });
    const start: any = await kmcProvider.buildStart({ verificationId: VERIFICATION_ID, req: REQ });
    expect(cryptoCalls[0][0]).toBe('enc');
    const date = cryptoCalls[0][1].split('/')[3];
    expect(date).toMatch(/^\d{14}$/);
    expect(cryptoCalls[0][1]).toBe(kmcTrCertPlain({ cpId: 'TEST1001', urlCode: '001001' }, EXPECTED, date));
    expect(cryptoCalls.slice(1)).toEqual([['msg', 'ENC1'], ['enc', 'ENC1/MAC1/0000000000000000']]);
    expect(start).toEqual({
      mode: 'popup_form',
      action: KMC_REQUEST_URL,
      fields: { tr_cert: 'KMC000002-ENC2', tr_url: 'https://hanjul.ai/api/auth/identity/return', tr_ver: 'V2', tr_add: 'N' },
    });
  });

  it('암호화 결과가 비면 요청을 만들지 않는다', async () => {
    await expect(kmcProvider.buildStart({ verificationId: VERIFICATION_ID, req: REQ })).rejects.toThrow('KMC_CRYPTO_EMPTY_ENC1');
  });
});

describe('KMC 결과 확인(verify)', () => {
  it('정상 — 토큰 확인(서버끼리) → 위변조 대조 → 이름 · 휴대폰 · DI · 거래 번호 · CI 는 풀지 않는다', async () => {
    seedVerify();
    const api = stubTokenApi({ result_cd: 'APR01', apiRecCert: 'RECCERT', apiCertNum: EXPECTED });
    const got = await verify();
    expect(got).toEqual({ name: '홍길동', phone: '01000000000', dupKey: 'DIPLAIN', providerTxId: EXPECTED });
    const [url, init] = api.mock.calls[0] as any;
    expect(url).toBe(KMC_TOKEN_API_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/json' });
    const sent = JSON.parse(init.body);
    expect(sent.apiToken).toBe(TOKEN_PLAIN);
    expect(sent.apiDate).toMatch(/^\d{14}$/);
    expect(cryptoCalls.some(([, input]) => input === 'CIENC')).toBe(false);
  });

  it('★ 남의 인증 결과 — 세 자리(복귀 certNum · 응답 apiCertNum · 결과 kCertNum) 중 하나라도 이 건이 아니면 거절', async () => {
    seedVerify();
    cryptoTable.set('dec:CERTENC', 'ffffffffffffffffffffffffffffffff');
    stubTokenApi({ result_cd: 'APR01', apiRecCert: 'RECCERT', apiCertNum: EXPECTED });
    await expect(verify()).rejects.toThrow('KMC_CERTNUM_MISMATCH_RETURN');

    seedVerify();
    stubTokenApi({ result_cd: 'APR01', apiRecCert: 'RECCERT', apiCertNum: 'ffffffffffffffffffffffffffffffff' });
    await expect(verify()).rejects.toThrow('KMC_CERTNUM_MISMATCH_API');

    seedVerify(['ffffffffffffffffffffffffffffffff', ...RESULT_FIELDS.slice(1)]);
    stubTokenApi({ result_cd: 'APR01', apiRecCert: 'RECCERT', apiCertNum: EXPECTED });
    await expect(verify()).rejects.toThrow('KMC_CERTNUM_MISMATCH_RESULT');
  });

  it('★ 위변조 검사값이 다르면 결과를 풀지 않고 거절', async () => {
    seedVerify();
    cryptoTable.set('msg:INNER', 'OTHERMAC');
    stubTokenApi({ result_cd: 'APR01', apiRecCert: 'RECCERT', apiCertNum: EXPECTED });
    await expect(verify()).rejects.toThrow('KMC_TAMPERED');
    expect(cryptoCalls.some(([m, i]) => m === 'dec' && i === 'INNER')).toBe(false);
  });

  it('인증 실패(N) · 토큰 실패 코드(APR02~06) · 통신 실패는 거절', async () => {
    seedVerify(RESULT_FIELDS.map((v, i) => (i === 9 ? 'N' : v)));
    stubTokenApi({ result_cd: 'APR01', apiRecCert: 'RECCERT', apiCertNum: EXPECTED });
    await expect(verify()).rejects.toThrow('KMC_NOT_VERIFIED');

    for (const code of ['APR02', 'APR03', 'APR04', 'APR05', 'APR06']) {
      seedVerify();
      stubTokenApi({ result_cd: code });
      await expect(verify()).rejects.toThrow(`KMC_TOKEN_${code}`);
    }
    seedVerify();
    stubTokenApi({}, { ok: false, status: 502 });
    await expect(verify()).rejects.toThrow('KMC_TOKEN_API_HTTP_502');
  });

  it('복귀 값이 없거나 모양이 이상하면 모듈에 넘기지 않고 거절(줄바꿈 끼워 넣기 차단)', async () => {
    stubTokenApi({ result_cd: 'APR01' });
    await expect(verify({})).rejects.toThrow('KMC_RESULT_MISSING');
    await expect(verify({ apiToken: 'TOKENENC\ndec:1^*X', certNum: 'CERTENC' })).rejects.toThrow('KMC_RESULT_MISSING');
    await expect(verify({ apiToken: 'TOKENENC', certNum: ['CERTENC'] })).rejects.toThrow('KMC_RESULT_MISSING');
    expect(cryptoCalls).toEqual([]);
  });

  it('★ 1006 실측 — 이름이 URL 인코딩으로 오면 풀어서 돌려준다(그대로 저장 금지) · 못 풀면 거절', async () => {
    seedVerify(RESULT_FIELDS.map((v, i) => (i === 8 ? '%ED%99%8D%EA%B8%B8%EB%8F%99' : v)));
    stubTokenApi({ result_cd: 'APR01', apiRecCert: 'RECCERT', apiCertNum: EXPECTED });
    expect((await verify()).name).toBe('홍길동');
    seedVerify(RESULT_FIELDS.map((v, i) => (i === 8 ? 'JOHN+SMITH' : v)));
    expect((await verify()).name).toBe('JOHN SMITH');
    seedVerify(RESULT_FIELDS.map((v, i) => (i === 8 ? '%ED%99%8D%EA' : v)));
    await expect(verify()).rejects.toThrow('KMC_RESULT_SHAPE');
  });

  it('결과 칸 수가 모자라면 거절(18칸)', async () => {
    seedVerify(RESULT_FIELDS.slice(0, 12));
    stubTokenApi({ result_cd: 'APR01', apiRecCert: 'RECCERT', apiCertNum: EXPECTED });
    await expect(verify()).rejects.toThrow('KMC_RESULT_SHAPE');
  });
});
