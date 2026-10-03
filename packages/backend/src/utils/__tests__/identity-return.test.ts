/**
 * 본인확인 인증 창 복귀 통로 계약 (★2026-10-03 한국모바일인증 연동 준비)
 *
 * 왜 있나
 *   인증기관 창은 팝업에서 우리 복귀 주소로 돌아온다. 그 주소는 인증 없이 열려 있고 누구나 아무 값이나 보낼 수 있다.
 *   여기서 한 칸이 틀어지면 ①받은 값이 스크립트로 실행되거나(화면 탈취) ②다른 사이트 · 다른 창이 남의 인증 결과를
 *   끼워 넣거나 ③복귀 창이 부모 창과 끊겨 인증이 끝나지 않는다.
 *
 * 못 박는 것
 *   1. 받은 값은 걸러서(문자열 · 평범한 이름 · 길이 제한) 스크립트 밖으로 못 나오는 JSON 으로만 싣는다.
 *   2. 넘기는 대상은 같은 출처의 부모 창뿐이다(`'*'` 금지). 응답은 자기 스크립트 하나만 허용한다.
 *   3. 이 통로는 DB · 세션을 건드리지 않는다.
 *   4. 라우트는 helmet 앞에 걸린다(창 격리 정책이 붙으면 부모 창과 끊긴다).
 *   5. 화면은 보낸 창 · 출처 · 종류 셋을 모두 확인하고, 창은 버튼 누름 순간에 먼저 연다.
 *   6. 인증 요청 주소는 https 만 받는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  IDENTITY_RETURN_PATH, IDENTITY_RETURN_MESSAGE_TYPE,
  collectIdentityReturnFields, renderIdentityReturnPage, buildPopupFormStart,
} from '../identity-return';

const be = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const fe = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');

describe('돌아온 값 고르기', () => {
  it('문자열만, 이름이 평범한 것만 넘긴다 — 본문이 주소 뒤 값보다 우선', () => {
    const out = collectIdentityReturnFields(
      { certNum: 'from-query', only_query: 'q' },
      { certNum: 'from-body', rec_cert: 'ABCDEF0123', 'bad key': 'x', arr: ['a', 'b'], obj: { a: 1 }, num: 5 },
    );
    expect(out).toEqual({ certNum: 'from-body', rec_cert: 'ABCDEF0123', only_query: 'q' });
  });

  it('너무 긴 값 · 너무 많은 값 · 위험한 이름은 버린다', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 80; i += 1) many[`k${i}`] = 'v';
    expect(Object.keys(collectIdentityReturnFields({}, many))).toHaveLength(40);
    expect(collectIdentityReturnFields({}, { big: 'x'.repeat(16_385), ok: 'y' })).toEqual({ ok: 'y' });
    const hostile = JSON.parse('{"__proto__":"a","constructor":"b","prototype":"c","safe":"d"}');
    const picked = collectIdentityReturnFields({}, hostile);
    expect(Object.keys(picked)).toEqual(['safe']);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('본문이 없거나 객체가 아니어도 죽지 않는다', () => {
    expect(collectIdentityReturnFields(undefined, undefined)).toEqual({});
    expect(collectIdentityReturnFields('x', ['a'])).toEqual({});
  });
});

describe('복귀 화면', () => {
  // 스크립트 안에서 줄바꿈으로 읽히는 두 글자 — 소스에 글자 그대로 두지 않는다
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);

  it('받은 값이 스크립트 밖으로 나오지 못한다', () => {
    const page = renderIdentityReturnPage({
      rec_cert: '</script><script>alert(1)</script>',
      note: '<img src=x onerror=alert(2)>&\u2028\u2029',
    });
    // 스크립트를 닫는 태그는 우리가 쓴 한 개뿐이다
    expect(page.html.split('</script>')).toHaveLength(2);
    expect(page.html).not.toContain('<script>alert(1)');
    expect(page.html).not.toContain('<img src=x');
    expect(page.html).toContain('\\u003c/script\\u003e');
    expect(page.html).not.toContain('\u2028');
    expect(page.html).not.toContain('\u2029');
  });

  it('넘긴 값은 그대로 복원된다(바꾸지 않는다)', () => {
    const fields = { rec_cert: 'A1B2', tricky: '</script>&<>"\'' };
    const page = renderIdentityReturnPage(fields);
    const m = page.html.match(/postMessage\((\{.*\}), window\.location\.origin\);/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1])).toEqual({ type: IDENTITY_RETURN_MESSAGE_TYPE, fields });
  });

  it('넘기는 대상은 같은 출처뿐이고, 응답은 자기 스크립트 하나만 허용한다', () => {
    const page = renderIdentityReturnPage({ a: 'b' });
    expect(page.html).toContain(', window.location.origin);');
    expect(page.html).not.toMatch(/postMessage\([^)]*,\s*['"]\*['"]\)/);
    const nonce = page.html.match(/<script nonce="([^"]+)">/);
    expect(nonce).not.toBeNull();
    expect(page.contentSecurityPolicy).toContain(`script-src 'nonce-${nonce![1]}'`);
    expect(page.contentSecurityPolicy).toContain("default-src 'none'");
    expect(page.contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(page.contentSecurityPolicy).not.toContain("'unsafe-inline'; script");
    // 응답마다 nonce 가 다르다
    expect(renderIdentityReturnPage({ a: 'b' }).contentSecurityPolicy).not.toBe(page.contentSecurityPolicy);
  });

  it('고객에게 보이는 글에 줄표가 없다', () => {
    expect(renderIdentityReturnPage({}).html).not.toContain('—');
  });
});

describe('인증 요청 만들기', () => {
  it('https 주소만 받는다', () => {
    const start = buildPopupFormStart('https://provider.invalid/req', { tr_cert: 'X' }, { charset: 'euc-kr' });
    expect(start).toEqual({ mode: 'popup_form', action: 'https://provider.invalid/req', fields: { tr_cert: 'X' }, charset: 'euc-kr' });
    expect(() => buildPopupFormStart('http://provider.invalid/req', {})).toThrow('IDENTITY_START_INSECURE_ACTION');
    expect(() => buildPopupFormStart('javascript:alert(1)', {})).toThrow('IDENTITY_START_INSECURE_ACTION');
    expect(() => buildPopupFormStart('not a url', {})).toThrow('IDENTITY_START_INVALID_ACTION');
  });

  it('문자열이 아닌 값은 받지 않는다', () => {
    expect(() => buildPopupFormStart('https://provider.invalid/req', { n: 1 as any })).toThrow('IDENTITY_START_NON_STRING_FIELD');
  });
});

describe('배선', () => {
  it('복귀 라우트는 helmet 앞에 걸린다', () => {
    const app = be('app.ts');
    const mount = app.indexOf('app.use(IDENTITY_RETURN_PATH, identityReturnRoutes);');
    const helmet = app.indexOf('app.use(helmet());');
    expect(mount).toBeGreaterThan(0);
    expect(helmet).toBeGreaterThan(mount);
    expect(IDENTITY_RETURN_PATH).toBe('/api/auth/identity/return');
  });

  it('복귀 통로는 DB · 세션 · 로그인 발급을 건드리지 않는다', () => {
    for (const src of [be('routes', 'identity-return.ts'), be('utils', 'identity-return.ts')]) {
      expect(src).not.toContain("from '../config/database'");
      expect(src).not.toContain('issueUserLogin');
      expect(src).not.toContain('rotateUserSession');
      expect(src).not.toContain('completeIdentityVerification');
    }
    const route = be('routes', 'identity-return.ts');
    expect(route).toContain("res.setHeader('Content-Security-Policy', page.contentSecurityPolicy);");
    expect(route).toContain("res.setHeader('Cache-Control', 'no-store');");
    expect(route).toContain("urlencoded({ extended: false, limit: '64kb', parameterLimit: 60 })");
  });

  it('화면은 보낸 창 · 출처 · 종류를 모두 확인한다', () => {
    const launcher = fe('utils', 'identityProvider.ts');
    expect(launcher).toContain('if (event.source !== win) return;');
    expect(launcher).toContain('if (event.origin !== window.location.origin) return;');
    expect(launcher).toContain('data.type !== RETURN_MESSAGE_TYPE');
    expect(launcher).toContain(`const RETURN_MESSAGE_TYPE = '${IDENTITY_RETURN_MESSAGE_TYPE}';`);
    expect(launcher).not.toContain("'*'");
  });

  it('★(Codex 1R) 폼 전송은 원형의 메서드로 한다 — 값 이름이 submit 이어도 요청이 나간다', () => {
    const launcher = fe('utils', 'identityProvider.ts');
    const fn = launcher.slice(launcher.indexOf('function submitToWindow'), launcher.indexOf('export async function launchIdentityProvider'));
    expect(fn).toContain('HTMLFormElement.prototype.submit.call(form);');
    expect(fn).toContain('Node.prototype.appendChild.call(form, input);');
    expect(fn).toContain('document.body.removeChild(form);');
    expect(fn).not.toContain('form.submit()');
    expect(fn).not.toContain('form.remove()');
    expect(fn).not.toContain('form.appendChild(');
    // 주소 · 방식 · 대상 창은 입력칸을 붙이기 전에 정한다
    expect(fn.indexOf('form.target = win.name;')).toBeLessThan(fn.indexOf('Node.prototype.appendChild.call(form, input);'));
    expect(fn.indexOf('form.action = String(start.action);')).toBeLessThan(fn.indexOf('Node.prototype.appendChild.call(form, input);'));
  });

  it('인증 창은 서버 응답을 기다리기 전에 연다(팝업 차단 회피) — 맡기지 않은 창은 닫는다', () => {
    const modal = fe('components', 'IdentityVerifyModal.tsx');
    const begin = modal.slice(modal.indexOf('const begin = async () => {'), modal.indexOf('const submitStub'));
    const open = begin.indexOf('const win = openIdentityWindow();');
    const firstAwait = begin.indexOf('await ');
    expect(open).toBeGreaterThan(0);
    expect(firstAwait).toBeGreaterThan(open);
    expect(begin).toContain('await launchIdentityProvider(s.provider, s.start, win);');
    expect(begin).toContain('if (!handedOver && win && !win.closed) win.close();');
  });
});

describe('복귀 라우트 실제 응답', () => {
  async function withServer<T>(run: (base: string) => Promise<T>): Promise<T> {
    const express = (await import('express')).default;
    const router = (await import('../../routes/identity-return')).default;
    const app = express();
    app.use(IDENTITY_RETURN_PATH, router);
    const server = app.listen(0);
    try {
      const port = (server.address() as any).port;
      return await run(`http://127.0.0.1:${port}${IDENTITY_RETURN_PATH}`);
    } finally {
      await new Promise((done) => server.close(() => done(null)));
    }
  }

  it('폼 본문(POST)을 받아 화면과 정책 머리를 돌려준다 — 값은 스크립트 밖으로 못 나온다', async () => {
    await withServer(async (url) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'rec_cert=ABC123&certNum=N-1&evil=%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E',
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('content-security-policy')).toContain("script-src 'nonce-");
      // helmet 이 붙이는 창 격리 머리가 없어야 부모 창과 이어진다
      expect(res.headers.get('cross-origin-opener-policy')).toBeNull();
      const html = await res.text();
      expect(html.split('</script>')).toHaveLength(2);
      const m = html.match(/postMessage\((\{.*\}), window\.location\.origin\);/);
      expect(JSON.parse(m![1]).fields).toEqual({
        rec_cert: 'ABC123', certNum: 'N-1', evil: '</script><script>alert(1)</script>',
      });
    });
  });

  it('주소 뒤 값(GET)으로 돌아와도 받는다 · 값이 없어도 화면은 뜬다', async () => {
    await withServer(async (url) => {
      const withQuery = await (await fetch(`${url}?rec_cert=Q1`)).text();
      expect(JSON.parse(withQuery.match(/postMessage\((\{.*\}), window\.location\.origin\);/)![1]).fields).toEqual({ rec_cert: 'Q1' });
      const empty = await fetch(url);
      expect(empty.status).toBe(200);
      expect(JSON.parse((await empty.text()).match(/postMessage\((\{.*\}), window\.location\.origin\);/)![1]).fields).toEqual({});
    });
  });
});
