/**
 * C156 유입 경로 — 문자 링크로 들어온 방문 가리기(★ 2026-11-22 · 설계서 docs/2026-11-22-c156-message-link-inflow-design.md §5)
 *   기대값 = 설계서의 판정표 · 손으로 적은 주소(코드가 만드는 방식으로 다시 만들지 않는다).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  INFLOW_MARK, INFLOW_MARK_KEY, INFLOW_TAG_ENV, INFLOW_ORIGIN_STALE_MS, INFLOW_ORIGIN_REFRESH_MS,
  inflowTagOrigin, inflowTaggedUrl, inflowRedirectUrl, allowedOriginsNow, refreshInflowOrigins,
} from '../short-url';
import { normOrigin } from '../mall-origins';
import { inflowOwnSql, inflowChannelSql, INFLOW_OWN_LABEL, INFLOW_SQL } from '../inflow-channel';

const SHOP = ['https://shop.example'];
const CO = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

describe('I1 붙여도 되는 꼴 — 판정표(설계서 S1 가)', () => {
  it('단순한 주소 = Origin(정규화한 값)', () => {
    expect(inflowTagOrigin('https://shop.example/product/detail.html?product_no=123&cate_no=24')).toBe('https://shop.example');
    expect(inflowTagOrigin('https://WWW.Shop.Example/')).toBe('https://shop.example');
    expect(inflowTagOrigin('https://shop.example:8443/a')).toBe('https://shop.example:8443');
    expect(inflowTagOrigin('http://shop.example/a?')).toBe('http://shop.example');
    expect(inflowTagOrigin('https://shop.example/a?x=1&')).toBe('https://shop.example');
  });
  it('① 읽지 못하는 주소 · 다른 스킴 · 사용자 정보 · 너무 긴 주소', () => {
    for (const u of ['', 'shop.example/a', 'javascript:alert(1)', 'intent://shop.example/a', 'ftp://shop.example/a', 'https://user:pw@shop.example/a', `https://shop.example/${'a'.repeat(2000)}`]) {
      expect(inflowTagOrigin(u), u.slice(0, 40)).toBeNull();
    }
  });
  it('② 담당자 링크 ③ 조각이 있는 주소', () => {
    expect(inflowTagOrigin('https://hanjul.ai/charge-approve#tok')).toBeNull();
    expect(inflowTagOrigin('https://hanjul.ai/journey-pause')).toBeNull();
    expect(inflowTagOrigin('https://shop.example/a#review')).toBeNull();
    expect(inflowTagOrigin('https://shop.example/#/product/1')).toBeNull();
  });
  it('④ 칸 8개까지 · 9개부터 원문', () => {
    const q = (n: number) => Array.from({ length: n }, (_, i) => `k${i}=v`).join('&');
    expect(inflowTagOrigin(`https://shop.example/a?${q(8)}`)).toBe('https://shop.example');
    expect(inflowTagOrigin(`https://shop.example/a?${q(9)}`)).toBeNull();
  });
  it('⑤ 값 24자까지 · 25자부터 원문 · 값에 / = : 가 있으면 원문 · = 없는 칸 · 이상한 이름', () => {
    expect(inflowTagOrigin(`https://shop.example/a?v=${'a'.repeat(24)}`)).toBe('https://shop.example');
    expect(inflowTagOrigin(`https://shop.example/a?v=${'a'.repeat(25)}`)).toBeNull();
    expect(inflowTagOrigin('https://shop.example/a?v=0123456789abcdef0123456789abcdef')).toBeNull();   // 32자 16진(해시 꼴)
    expect(inflowTagOrigin('https://shop.example/a?returnUrl=https://o.example/x')).toBeNull();
    expect(inflowTagOrigin('https://shop.example/a?v=YWJj=')).toBeNull();
    expect(inflowTagOrigin('https://shop.example/a?flag')).toBeNull();
    expect(inflowTagOrigin('https://shop.example/a?x=1&&y=2')).toBeNull();
    expect(inflowTagOrigin('https://shop.example/a?na me=1')).toBeNull();
    expect(inflowTagOrigin('https://shop.example/a?q=%EC%9B%90%ED%94%BC%EC%8A%A4')).toBeNull();   // 한글 검색어(27자) = 길어서 원문
    expect(inflowTagOrigin('https://shop.example/a?opt[0]=red&size=M,L')).toBe('https://shop.example');
  });
  it('⑥ 고객이 단 utm_source · 이미 붙은 표식 · 서명 인증류 이름(같은 이름 · 앞 글자 · 끝 글자) — 닮은 다른 이름은 지난다', () => {
    for (const bad of ['utm_source=sms', 'UTM_SOURCE=sms', `${INFLOW_MARK}`, 'code=AB12', 'token=abc', 'accessToken=abc', 'sig=ab12', 'X-Amz-Expires=300', 'x-goog-date=1', 'my_sig=1', 'state=1', 'sid=7', 'exp=1']) {
      expect(inflowTagOrigin(`https://shop.example/a?${bad}`), bad).toBeNull();
    }
    for (const ok of ['xcode=001&mcode=002', 'tokyo=1', 'utm_medium=sms', 'branduid=12345&type=X', 'signal=1', 'expand=1', 'page=2']) {
      expect(inflowTagOrigin(`https://shop.example/a?${ok}`), ok).toBe('https://shop.example');
    }
  });
});

describe('I2 넘겨줄 주소 — 등록 Origin 일 때만 뒤에 붙인다(설계서 S1 가 · D2)', () => {
  it('붙이는 꼴 셋: 쿼리 없음 · 있던 쿼리 뒤 · 물음표나 & 로 끝난 주소 — 있던 글자는 그대로', () => {
    expect(INFLOW_MARK).toBe('hanjul_link=1');
    expect(INFLOW_MARK_KEY).toBe('hanjul_link');
    expect(inflowTaggedUrl('https://shop.example/event', SHOP)).toBe('https://shop.example/event?hanjul_link=1');
    expect(inflowTaggedUrl('https://shop.example/p?product_no=12&A=%20b', SHOP)).toBe('https://shop.example/p?product_no=12&A=%20b&hanjul_link=1');
    expect(inflowTaggedUrl('https://shop.example/p?', SHOP)).toBe('https://shop.example/p?hanjul_link=1');
    expect(inflowTaggedUrl('https://shop.example/p?x=1&', SHOP)).toBe('https://shop.example/p?x=1&hanjul_link=1');
    const src = 'https://Shop.Example/P/%EA%B0%80?b=2&a=1';
    expect(inflowTaggedUrl(src, SHOP).startsWith(src)).toBe(true);   // 대소문자 · 인코딩 · 칸 순서를 다시 쓰지 않는다
  });
  it('Origin 비교 = 스킴 · 호스트 · 포트 전체 · www 만 같은 사이트', () => {
    expect(inflowTaggedUrl('http://shop.example/a', SHOP)).toBe('http://shop.example/a');               // 스킴
    expect(inflowTaggedUrl('https://shop.example:8443/a', SHOP)).toBe('https://shop.example:8443/a');   // 포트
    expect(inflowTaggedUrl('https://m.shop.example/a', SHOP)).toBe('https://m.shop.example/a');         // 따로 등록해야 한다
    expect(inflowTaggedUrl('https://evilshop.example/a', SHOP)).toBe('https://evilshop.example/a');
    expect(inflowTaggedUrl('https://www.shop.example/a', SHOP)).toBe('https://www.shop.example/a?hanjul_link=1');
    expect(inflowTaggedUrl('https://SHOP.example/a', SHOP)).toBe('https://SHOP.example/a?hanjul_link=1');
    expect(inflowTaggedUrl('https://shop.example/a', [' https://WWW.shop.example/ '])).toBe('https://shop.example/a?hanjul_link=1');   // 등록 값도 같은 정규화
    expect(inflowTaggedUrl('https://shop.example/a', [])).toBe('https://shop.example/a');
  });
  it('걸리는 주소 = 받은 그대로(조각 · 이미 붙은 표식 · 고객 꼬리표 · 담당자 링크)', () => {
    for (const u of ['https://shop.example/a#x', 'https://shop.example/a?hanjul_link=1', 'https://shop.example/a?utm_source=sms', 'https://shop.example/charge-approve#t']) {
      expect(inflowTaggedUrl(u, SHOP)).toBe(u);
    }
  });
  it('정규화 한 곳: 수집 판정(cdp-auth)이 같은 함수를 쓴다(안에 따로 식이 없다)', () => {
    expect(normOrigin(' HTTPS://WWW.Shop.Example// ')).toBe('https://shop.example');
    expect(normOrigin('https://m.shop.example')).toBe('https://m.shop.example');
    const auth = fs.readFileSync(path.join(__dirname, '..', 'cdp-auth.ts'), 'utf8');
    expect(auth).toContain("import { normOrigin } from './mall-origins';");
    expect(auth).toContain('const norm = normOrigin;');
    expect(auth).not.toMatch(/replace\(\/\^\(https\?/);
  });
});

describe('I3 등록 Origin 기억 — 넘겨주기 길은 기억만 본다(설계서 S1 나)', () => {
  const ENV = { [INFLOW_TAG_ENV]: `${CO},${OTHER}` };
  beforeEach(async () => { await refreshInflowOrigins({}); });   // 명단 빔 = 기억 비움

  it('채우기 전 = null · 채운 뒤 = 목록(등록 없는 회사 = 빈 목록) · 5분 지나면 null', async () => {
    expect([INFLOW_ORIGIN_REFRESH_MS, INFLOW_ORIGIN_STALE_MS]).toEqual([60_000, 300_000]);
    expect(allowedOriginsNow(CO)).toBeNull();
    const T = 1_000_000;
    expect(await refreshInflowOrigins(ENV, async () => [{ id: CO, origins: SHOP }], () => T)).toBe('filled');
    expect(allowedOriginsNow(CO, T + 1)).toEqual(SHOP);
    expect(allowedOriginsNow(OTHER, T + 1)).toEqual([]);
    expect(allowedOriginsNow(CO, T + INFLOW_ORIGIN_STALE_MS)).toEqual(SHOP);
    expect(allowedOriginsNow(CO, T + INFLOW_ORIGIN_STALE_MS + 1)).toBeNull();
  });
  it('명단이 비면 조회를 하지 않고 기억을 비운다 · 명단 → 조회 인자(전 회사인가 · 회사 id 만)', async () => {
    let calls = 0;
    await refreshInflowOrigins(ENV, async () => [{ id: CO, origins: SHOP }], () => Date.now());
    expect(await refreshInflowOrigins({}, async () => { calls++; return []; })).toBe('empty');
    expect(calls).toBe(0);
    expect(allowedOriginsNow(CO)).toBeNull();
    const seen: Array<[boolean, string[]]> = [];
    await refreshInflowOrigins({ [INFLOW_TAG_ENV]: ` *, ${CO} , not-a-uuid ` }, async (all, ids) => { seen.push([all, ids]); return []; });
    expect(seen).toEqual([[true, [CO]]]);
  });
  it('앞 채우기가 끝나지 않았으면 다음 차례는 조회를 시작하지 않는다(동시 조회 하나) · 실패 = 옛 기억 유지', async () => {
    const T = 5_000_000;
    await refreshInflowOrigins(ENV, async () => [{ id: CO, origins: SHOP }], () => T);
    let release: (v: Array<{ id: string; origins: string[] }>) => void = () => {};
    let started = 0;
    const slow = refreshInflowOrigins(ENV, () => { started++; return new Promise((r) => { release = r; }); }, () => T + 10);
    expect(await refreshInflowOrigins(ENV, async () => { started++; return []; })).toBe('skipped');
    expect(started).toBe(1);
    release([{ id: CO, origins: ['https://new.example'] }]);
    expect(await slow).toBe('filled');
    expect(allowedOriginsNow(CO, T + 11)).toEqual(['https://new.example']);
    expect(await refreshInflowOrigins(ENV, async () => { throw new Error('연결 끊김'); })).toBe('failed');
    expect(allowedOriginsNow(CO, T + 12)).toEqual(['https://new.example']);
    expect(await refreshInflowOrigins(ENV, async () => [], () => T + 20)).toBe('filled');   // 실패 뒤에도 다음 차례는 돈다
  });
});

describe('I4 넘겨주기 차례 — 명단 → 붙여도 되는 꼴 → 기억 → 붙이기(설계서 S1 다)', () => {
  const ENV = { [INFLOW_TAG_ENV]: CO };
  beforeEach(async () => {
    await refreshInflowOrigins({});
    await refreshInflowOrigins({ [INFLOW_TAG_ENV]: `${CO},${OTHER}` }, async () => [{ id: CO, origins: SHOP }, { id: OTHER, origins: SHOP }]);
  });
  const url = 'https://shop.example/p?product_no=1';

  it('명단에 든 회사 · 등록 Origin · 단순한 주소 = 표식 · 그 밖은 원문', () => {
    expect(inflowRedirectUrl({ companyId: CO, fullUrl: url }, ENV)).toBe(`${url}&hanjul_link=1`);
    expect(inflowRedirectUrl({ companyId: OTHER, fullUrl: url }, ENV)).toBe(url);        // 명단 밖 회사(기억에는 있어도)
    expect(inflowRedirectUrl({ companyId: CO, fullUrl: url }, {})).toBe(url);            // 명단 빔 = 닫힘
    expect(inflowRedirectUrl({ companyId: CO, fullUrl: `${url}#x` }, ENV)).toBe(`${url}#x`);
    expect(inflowRedirectUrl({ companyId: CO, fullUrl: 'https://blog.example/post' }, ENV)).toBe('https://blog.example/post');
    expect(inflowRedirectUrl({ companyId: CO, fullUrl: url }, { [INFLOW_TAG_ENV]: '*' })).toBe(`${url}&hanjul_link=1`);
  });
  it('기억이 없으면(채우기 전 · 오래됨) 원문', async () => {
    await refreshInflowOrigins({});
    expect(inflowRedirectUrl({ companyId: CO, fullUrl: url }, ENV)).toBe(url);
  });
  it('소스 계약: 넘겨주기 함수는 동기 · DB 를 읽지 않는다 · 주소는 그 함수의 값으로 넘기고 기록은 원래 주소', () => {
    const ct = fs.readFileSync(path.join(__dirname, '..', 'short-url.ts'), 'utf8');
    const fn = ct.slice(ct.indexOf('export function inflowRedirectUrl('), ct.indexOf('let originTimer'));
    expect(fn).not.toMatch(/\bawait\b|\bquery\(|async /);
    const at = (needle: string) => { const i = fn.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
    expect(at('companyListAllows(r.companyId')).toBeLessThan(at('inflowTagOrigin(r.fullUrl)'));
    expect(at('inflowTagOrigin(r.fullUrl)')).toBeLessThan(at('allowedOriginsNow(r.companyId)'));
    expect(at('allowedOriginsNow(r.companyId)')).toBeLessThan(at('inflowTaggedUrl(r.fullUrl, allowed)'));
    const now = ct.slice(ct.indexOf('export function allowedOriginsNow('), ct.indexOf('async function loadInflowOrigins('));
    expect(now).not.toMatch(/\bawait\b|\bquery\(/);

    const route = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'short-url.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    expect(route.match(/res\.redirect\(302, inflowRedirectUrl\(resolved\)\);/g)?.length).toBe(1);
    const between = route.slice(route.indexOf('await resolveShortUrl(hash)'), route.indexOf('res.redirect(302, inflowRedirectUrl(resolved));'));
    expect(between.match(/\bawait\b/g)?.length).toBe(1);                 // resolveShortUrl 하나뿐(더해진 대기 0)
    expect(route).not.toMatch(/FROM companies|cdp_allowed_origins/);     // 넘겨주기 파일이 회사 표를 읽지 않는다
    // 누름 기록 · 담당자 링크 판정 · 자사몰 인지 = 원래 주소
    expect(route).toContain('if (isManagerLinkUrl(resolved.fullUrl)) {');
    expect(route).toContain('detectKoreanEcommerce(resolved.fullUrl)');
    expect(route).toContain('full_url: resolved.fullUrl,');
    expect(route.match(/inflowRedirectUrl\(/g)?.length).toBe(1);
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.ts'), 'utf8');
    expect(app).toContain('startInflowOriginRefresher();');
  });
});

describe('I5 갈래 SQL — 표식은 첫 물음표 뒤의 쿼리에서만 · 세션의 가장 이른 시각의 줄들만(설계서 S2)', () => {
  it('붙이는 글자와 읽는 글자가 같은 상수 · 조각을 떼고 첫 물음표 뒤만 본다', () => {
    expect(inflowOwnSql('v.url')).toBe("COALESCE(substring(split_part(v.url, '#', 1) from '[?](.*)$') ~ '(^|&)hanjul_link=1(&|$)', false)");
    expect(inflowOwnSql('x')).toContain(INFLOW_MARK);
    expect(INFLOW_OWN_LABEL).toBe('한줄로 메시지 링크');
  });
  it('세션 갈래 = 가장 이른 시각의 줄들 가운데 표식이 있으면 새 줄 · 여섯 갈래 식은 그대로(고객이 단 hanjul 꼬리표를 새 줄로 보내지 않는다)', () => {
    expect(INFLOW_SQL).toContain('COALESCE(BOOL_OR(p.own) FILTER (WHERE p.occurred_at = p.first_at), false) AS own');
    expect(INFLOW_SQL).toContain('MIN(v.occurred_at) OVER (PARTITION BY v.session_id) AS first_at');
    expect(INFLOW_SQL).toContain(`(CASE WHEN s.own THEN '한줄로 메시지 링크' ELSE ${inflowChannelSql('s.url', 's.ref')} END) AS channel`);
    expect(inflowChannelSql('u', 'r')).not.toContain('hanjul');
    expect(inflowChannelSql('u', 'r')).not.toContain('한줄로');
  });
});
