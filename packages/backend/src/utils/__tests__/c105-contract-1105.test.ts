/**
 * C105 · 1105 범위 밖 다섯 — 계약 시험(★ 2026-11-05 설계서 docs/2026-11-05-c105-out-of-scope-five-design.md §5)
 *
 * 대상은 소스에서 기계로 뽑는다(손 등재 = 이유 붙은 허용 목록만) · 기대값은 손으로 쓴 값.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { linePeriodLabel, readLinePeriod } from '../one-line-steps';
import { individualCallbackOf } from '../callback-filter';
import { buildReentryAntiJoin } from '../journey-safety-filter';
import { parsePageParams, parseOffsetParam, parseQueryInt, sqlNumberParam, sqlNumericRawParam, sqlParseIntParam, QUERY_PAGE_MAX } from '../normalize';
import { periodLabel as fePeriodLabel, isLinePeriodPickValid } from '../../../../frontend/src/utils/line-period';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['__tests__', 'node_modules', 'dist'].includes(f)) walk(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
const load = (dir: string) => walk(join(PKG, dir)).map((p) => ({ rel: relative(PKG, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const backend = load('backend/src');
const frontend = load('frontend/src');
const read = (rel: string) => {
  const f = [...backend, ...frontend].find((x) => x.rel === rel);
  if (!f) throw new Error(`파일 없음 ${rel}`);
  return f.text;
};
const codeOnly = (t: string) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

const NOW = Date.parse('2026-11-05T12:00:00+09:00');

describe('K1 · K2 H1 혜택 기간 = 시작일(선택) + 마감일 · 읽기 CT · 글 CT', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
  afterAll(() => { vi.useRealTimers(); });
  it('서버 글(손으로 쓴 기대값) · 시작일 없음 = 옛 글 그대로', () => {
    expect(linePeriodLabel(null, '2026-11-30')).toBe('2026년 11월 30일(월)까지');
    expect(linePeriodLabel('2026-11-01', '2026-11-30')).toBe('2026년 11월 1일(일) ~ 11월 30일(월)');
    expect(linePeriodLabel('2026-12-28', '2027-01-05')).toBe('2026년 12월 28일(월) ~ 2027년 1월 5일(화)');
  });
  it('화면 글 = 짧은 꼴(올해 = 연도 없음)', () => {
    expect(fePeriodLabel('2026-11-30')).toBe('11월 30일(월)까지');
    expect(fePeriodLabel('2026-11-30', '2026-11-01')).toBe('11월 1일(일) ~ 11월 30일(월)');
    expect(fePeriodLabel('2027-01-05', '2026-12-28')).toBe('12월 28일(월) ~ 2027년 1월 5일(화)');
  });
  it('읽기 CT = 시작일은 마감이 있을 때만 · 시작 ≤ 마감 · 시작 = 오늘 −365일부터 · 마감 = 옛 검사', () => {
    expect(readLinePeriod('2026-11-01', '2026-11-30', NOW)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(readLinePeriod(undefined, '2026-11-30', NOW)).toEqual({ start: null, end: '2026-11-30' });
    expect(readLinePeriod(null, null, NOW)).toEqual({ start: null, end: null });
    expect(readLinePeriod('2026-11-01', null, NOW)).toBe('invalid');
    expect(readLinePeriod('2026-12-01', '2026-11-30', NOW)).toBe('invalid');
    expect(readLinePeriod('2025-11-04', '2026-11-30', NOW)).toBe('invalid');
    expect(readLinePeriod('2026-02-30', '2026-11-30', NOW)).toBe('invalid');
    expect(readLinePeriod(undefined, '2026-11-03', NOW)).toBe('invalid');
  });
  it('화면 고르기 범위 = 서버보다 좁다(마감 하한 = max(오늘, 시작))', () => {
    expect(isLinePeriodPickValid('2026-11-30', '2026-11-01')).toBe(true);
    expect(isLinePeriodPickValid('2026-11-03', '2026-11-01')).toBe(false);
    expect(isLinePeriodPickValid('2026-11-20', '2026-11-25')).toBe(false);
    expect(isLinePeriodPickValid(null, '2026-11-01')).toBe(false);
    expect(isLinePeriodPickValid(null, null)).toBe(true);
  });
  it('「…까지」 조립 = linePeriodLabel 안에만(백엔드 전 파일 · 소스 추출)', () => {
    const bad = backend.filter((f) => /formatLinePeriodEnd\([^)]*\)\}까지/.test(codeOnly(f.text)) && f.rel !== 'backend/src/utils/one-line-steps.ts').map((f) => f.rel);
    expect(bad).toEqual([]);
    const steps = read('backend/src/utils/one-line-steps.ts');
    expect((codeOnly(steps).match(/formatLinePeriodEnd\([^)]*\)\}까지/g) || []).length).toBe(1);   // linePeriodLabel 안 하나
  });
  it('화면 칩 · 글 함수 정의 = utils/line-period.ts 한 곳 · 두 창이 공용 입력을 쓴다', () => {
    const defs = frontend.filter((f) => /function (periodChips|periodLabel)\(/.test(f.text)).map((f) => f.rel);
    expect(defs).toEqual(['frontend/src/utils/line-period.ts']);
    for (const rel of ['frontend/src/components/ai-line/LineIntakeModal.tsx', 'frontend/src/components/zone/LineStepsModal.tsx']) {
      expect([rel, read(rel).includes('<LinePeriodPick ')]).toEqual([rel, true]);
    }
  });
  it('facts 를 읽는 두 서버 자리 = readLinePeriod · 재료 · 원문에 마감을 넘기는 자리마다 시작일도 넘긴다(소스 추출)', () => {
    expect(read('backend/src/routes/ai-line.ts')).toContain('const period = readLinePeriod(raw.period_start, raw.period_end, Date.now());');
    expect(read('backend/src/utils/one-line-steps.ts')).toContain('const period = readLinePeriod(f.period_start, f.period_end, nowMs);');
    const sites: string[] = [];
    for (const f of backend) {
      f.text.split('\n').forEach((l, i) => {
        if (/periodEnd: (steps\.body|b)\.facts\.periodEnd/.test(l)) sites.push(`${f.rel}:${i + 1}:${/periodStart: (steps\.body|b)\.facts\.periodStart/.test(l) ? 'ok' : '시작일 빠짐'}`);
      });
    }
    expect(sites.length).toBeGreaterThanOrEqual(6);
    expect(sites.filter((x) => !x.endsWith(':ok'))).toEqual([]);
  });
});

describe('K1b H1 진행 · 되살리기 · 기간 부품 상태(Codex 구현 1R)', () => {
  it('새 진행(runId) = 시작일도 비운다 · 기간 부품 = 시작일이 있으면 늘 범위 모드', () => {
    const m = read('frontend/src/components/ai-line/LineIntakeModal.tsx');
    const eff = m.slice(m.indexOf("setTemplates(null); setTplPick(null);"), m.indexOf('}, [run.runId]);'));
    expect(eff).toContain('setPeriodStart(null);');
    const pick = read('frontend/src/components/ai-line/LinePeriodPick.tsx');
    expect(pick).toContain('const range = rangePicked || !!start;');
    expect(pick).not.toMatch(/useState\(!!start\)/);
  });
});

describe('K5e H4 R59 숫자 거절 = 400(고객 라우트 · 사용자 조건 오류)', () => {
  it('customers.ts 에서 숫자 CT · 고객 필터를 부르는 처리기마다 catch 가 respondUserError 를 먼저 부른다(소스 추출)', () => {
    const t = read('backend/src/routes/customers.ts');
    const heads = [...t.matchAll(/^router\.(get|post|put|patch|delete)\(/gm)].map((m) => m.index!).concat(t.length);
    const bad: string[] = [];
    let n = 0;
    for (let i = 0; i < heads.length - 1; i++) {
      const body = t.slice(heads[i], heads[i + 1]);
      if (!/\b(sqlNumberParam|sqlParseIntParam|buildCustomerFilter|buildDynamicFilterCompat)\(/.test(body)) continue;
      n++;
      const c = body.lastIndexOf('catch (');
      if (c < 0 || !body.slice(c, c + 200).includes('respondUserError(res, error)')) bad.push(body.slice(0, 80).split('\n')[0]);
    }
    expect(n).toBeGreaterThanOrEqual(4);
    expect(bad).toEqual([]);
  });
});

describe('K3 H2 여정 개별회신번호 = 직접발송과 같은 CT', () => {
  /** 옛 filterByIndividualCallback 1단계 사진(C105 앞 · 동작 캡처) */
  const oldStep1 = (c: any, col?: string): string => {
    if (col) {
      let val = c[col];
      if (!val && c.custom_fields && col.startsWith('custom_')) val = c.custom_fields[col];
      let cb = val ? String(val).trim() : '';
      if (!cb && c.store_phone && c.store_phone.trim()) cb = c.store_phone;
      return cb;
    }
    let cb = c.callback;
    if ((!cb || !cb.trim()) && c.store_phone && c.store_phone.trim()) cb = c.store_phone;
    return cb ?? '';
  };
  it('CT = 옛 직접발송 1단계와 같은 값(동작 캡처 · 손으로 고른 경우)', () => {
    const cases: Array<[any, string | undefined]> = [
      [{ callback: '0212345678', store_phone: '0233334444' }, undefined],
      [{ callback: '', store_phone: '0233334444' }, undefined],
      [{ callback: '   ', store_phone: '0233334444' }, undefined],
      [{ callback: '없음', store_phone: '0233334444' }, undefined],
      [{ callback: null, store_phone: '' }, undefined],
      [{ callback: '0212345678', store_phone: null }, undefined],
      [{ phone2: ' 0244445555 ', store_phone: '0233334444' }, 'phone2'],
      [{ phone2: '', store_phone: '0233334444' }, 'phone2'],
      [{ custom_fields: { custom_3: '0255556666' }, store_phone: '0233334444' }, 'custom_3'],
    ];
    for (const [c, col] of cases) expect([JSON.stringify(c), col, individualCallbackOf({ ...c }, col)]).toEqual([JSON.stringify(c), col, oldStep1({ ...c }, col)]);
  });
  it('직접발송 · 여정 실행기 · 켜기 확인이 같은 CT 를 부른다 · 실행기 · 켜기 확인에 store_phone 직접 고르기 0', () => {
    const cf = read('backend/src/utils/callback-filter.ts');
    const filt = cf.slice(cf.indexOf('export async function filterByIndividualCallback('), cf.indexOf('\n}\n', cf.indexOf('export async function filterByIndividualCallback(')));
    expect(filt).toContain('for (const c of filtered) c.callback = individualCallbackOf(c, callbackColumn);');
    expect(codeOnly(filt)).not.toMatch(/\.store_phone\b/);   // 고르기 = CT 안(로그 글자 제외)
    const ex = codeOnly(read('backend/src/utils/journey-executor.ts'));
    expect(ex).toContain('const individualOf = (c: any): string => { const v = String(individualCallbackOf(c) || \'\').trim(); return normalizePhone(v) ? v : \'\'; };');
    expect(ex).not.toMatch(/\.store_phone\b/);
    const ext = read('backend/src/utils/journey-target-extractor.ts');
    const exp = ext.slice(ext.indexOf('export async function storeCallbackExposure('), ext.indexOf('\n}\n', ext.indexOf('export async function storeCallbackExposure(')));
    expect(exp).toContain('individualCallbackOf({ callback: r.callback, store_phone: r.store_phone })');
    expect(exp).toContain('if (!normalizePhone(v)) continue;');
  });
  it('여정 화면 · 서버 켜기 문구에 「매장번호」 0 · 이름 = 「개별회신번호」', () => {
    const files = ['frontend/src/components/journey/workspace/JourneyStartCard.tsx', 'frontend/src/components/journey/JourneyActivationConfirmModal.tsx', 'frontend/src/components/journey/workspace/JourneyWorkspace.tsx', 'backend/src/utils/journey-activation.ts'];
    for (const rel of files) {
      const strings = (codeOnly(read(rel)).match(/(['"`])(?:(?!\1).)*매장번호(?:(?!\1).)*\1|>[^<{]*매장번호[^<{]*</g) || []);
      expect([rel, strings]).toEqual([rel, []]);
    }
    expect(read('frontend/src/components/journey/workspace/JourneyStartCard.tsx')).toContain('label="개별회신번호로 보내기"');
    expect(read('frontend/src/pages/JourneysPage.tsx')).toContain('<span>개별회신번호로 발송 (회신번호 · 매장 전화번호가 없는 고객은 위 번호로)</span>');
  });
  it('배포 전 실측 스크립트 = 읽기만 · 같은 CT · 같은 등록 판정 · 성공해도 끝난다', () => {
    const s0 = readFileSync(join(PKG, 'backend', 'scripts', 'c105-s0-individual-callback-diff.ts'), 'utf8');
    expect(s0).toContain("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(s0).toContain('individualCallbackOf(c)');
    expect(s0).toContain('getRegisteredCallbackSet(String(j.company_id), j.created_by ? String(j.created_by) : undefined)');
    expect(s0).toContain('main().then(() => process.exit(0)');
    expect(s0).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});

describe('K4 H3 재진입 쿨다운 0 = 넣기 가드와 같은 집합', () => {
  it('허용 · 쿨다운 0 = 계보(없으면 지금 여정) 진행 중 제외', () => {
    const p1: any[] = [];
    expect(buildReentryAntiJoin('c', p1, 'J', true, 0)).toBe("AND NOT EXISTS (SELECT 1 FROM journey_executions je WHERE je.journey_id = $1::uuid AND je.customer_id = c.id AND je.status = 'active')");
    expect(p1).toEqual(['J']);
    const p2: any[] = [];
    buildReentryAntiJoin('c', p2, 'J', true, 0, ['J', 'OLD']);
    expect(p2).toEqual([['J', 'OLD']]);
  });
  it('넣기 가드 = 허용이면 같은 계보 · 지금 여정의 active 제외(소스)', () => {
    const w = read('backend/src/utils/journey-trigger-watcher.ts');
    expect(w).toContain("const reentryGuard = j.allow_reentry ? `AND je.status = 'active'` : ``;");
    expect(w).toContain('const journeyMatch = lineage ? `je.journey_id = ANY($6::uuid[])` : `je.journey_id = $1::uuid`;');
  });
});

// ── K5 H4 R59 — 주소 숫자 값 추출(설계서 §2-4 추출 v4 와 같은 규칙 · 키 이름 목록 없음 · 처리기 + 주소 값을 받는 도우미 두 층)
const CT_NAMES = ['parsePageParams', 'parseOffsetParam', 'parseQueryInt'];
const QREF = /req\.query(?:\?\.|\.)(\w+)|req\.query\??\.?\[['"](\w+)['"]\]/;
const NUMCALL = /\b(Number\.parseInt|Number|parseInt|parseFloat)\s*\(/g;
const argOf = (l: string, at: number): string => { let d = 1; let k = at; while (k < l.length && d > 0) { if (l[k] === '(') d++; else if (l[k] === ')') d--; k++; } return l.slice(at, k - 1); };
/** 처리기 · 함수 덩어리 하나에서 주소 값 숫자 쓰임 줄 */
export function queryNumberSites(lines: string[], names: Set<string>, startLine = 0): Array<{ line: number; text: string; ct: boolean }> {
  const out: Array<{ line: number; text: string; ct: boolean }> = [];
  lines.forEach((l, i) => {
    const st = l.trim();
    if (st.startsWith('//') || st.startsWith('*')) return;
    let hit = false;
    for (const m of l.matchAll(NUMCALL)) {
      const arg = argOf(l, m.index! + m[0].length);
      if (QREF.test(arg) || [...names].some((nm) => new RegExp(`(?<![\\w.])${nm}(?![\\w])`).test(arg))) { hit = true; break; }
    }
    if (!hit) hit = [...names].some((nm) => new RegExp(`(?<![\\w.'"])${nm}\\s*[*/%]|[*/%]\\s*${nm}(?![\\w])|(?<![\\w.'"])${nm}\\s*-\\s*\\d|\\$\\{\\s*${nm}\\s*\\}-`).test(l));
    if (hit) out.push({ line: startLine + i + 1, text: st, ct: CT_NAMES.some((c) => l.includes(c)) });
  });
  return out;
}
const HEAD = /^\s*router\.(get|post|put|patch|delete)\(|^(export )?(async )?function \w+/;
const namesIn = (lines: string[]): Set<string> => {
  const names = new Set<string>();
  for (const l of lines) {
    for (const m of l.matchAll(/const\s*\{([^}]*)\}\s*=\s*req\.query\b/g)) for (const part of m[1].split(',')) { const nm = part.split('=')[0].split(':').pop()!.trim(); if (/^\w+$/.test(nm)) names.add(nm); }
    for (const m of l.matchAll(/const\s+(\w+)\s*(?::[^=]+)?=\s*\(?\s*req\.query(?:\?\.|\.|\[)/g)) names.add(m[1]);
  }
  return names;
};
const ALLOW_Q: Record<string, string> = {
  'backend/src/routes/billing.ts#const monthNum = Number(month);': '정수 · 1 ~ 12 검사 뒤에만 씀(아니면 조건 0 = 옛 뜻)',
  'backend/src/routes/campaigns.ts#const total = Number(req.query.total);': '정수 · 0 ~ 1천만 검사 · 아니면 400(옛 그대로)',
  "backend/src/routes/email.ts#const daysRaw = parseInt(String(req.query.days || '30'), 10);": '허용 값 [7, 30, 90] 밖 = 30',
};
const SKIP_CALLEE = new Set(['Number', 'parseInt', 'parseFloat', 'String', 'Boolean', 'parsePageParams', 'parseOffsetParam', 'parseQueryInt', 'resolveTargetOwner', 'storeCodeForConnect', 'resolveSkeletonCompanyId', 'verifySnsState', 'isCdpMemberConfirmed', 'parseInAppClientCaps', 'loadNoticeAck', 'getOutreachWorkbench']);
function scanAllQuerySites() {
  const rows: Array<{ key: string; ct: boolean; text: string }> = [];
  const helpers = new Set<string>();
  for (const f of backend.filter((x) => x.rel.startsWith('backend/src/routes/'))) {
    const lines = f.text.split('\n');
    const heads = lines.map((l, i) => (HEAD.test(l) ? i : -1)).filter((i) => i >= 0).concat(lines.length);
    for (let h = 0; h < heads.length - 1; h++) {
      const chunk = lines.slice(heads[h], heads[h + 1]);
      for (const s of queryNumberSites(chunk, namesIn(chunk), heads[h])) rows.push({ key: `${f.rel}#${s.text}`, ct: s.ct, text: `${f.rel}:${s.line}` });
      for (const l of chunk) for (const m of l.matchAll(/\b([A-Za-z_]\w*)\s*\(([^()]*req\.query[^()]*)\)/g)) if (!SKIP_CALLEE.has(m[1])) helpers.add(m[1]);
    }
  }
  for (const name of helpers) {
    for (const f of backend) {
      const lines = f.text.split('\n');
      const i = lines.findIndex((l) => new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`).test(l));
      if (i < 0) continue;
      const params = (/\(([^)]*)\)/.exec(lines[i])?.[1] || '').split(',').map((p) => p.split(':')[0].split('=')[0].trim().replace(/^\{/, '').trim()).filter((p) => /^\w+$/.test(p));   // 매개변수 이름만(형 글자 제외)
      let end = i + 1; let d = (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      while (end < lines.length && d > 0) { d += (lines[end].match(/\{/g) || []).length - (lines[end].match(/\}/g) || []).length; end++; }
      for (const s of queryNumberSites(lines.slice(i, end), new Set(params), i)) rows.push({ key: `${f.rel}#${s.text}`, ct: s.ct, text: `${f.rel}:${s.line} (도우미 ${name})` });
      break;
    }
  }
  return rows;
}

describe('K5 H4 R59 주소 숫자 값 = CT(키 이름 목록 없음 · 처리기 + 도우미)', () => {
  const rows = scanAllQuerySites();
  it('뽑은 줄마다 같은 줄이 CT 안(허용 = 이유 붙은 셋) · 옮긴 자리 = 주소 값을 CT 로 읽는 호출 85 이상', () => {
    expect(rows.filter((r) => !r.ct && !ALLOW_Q[r.key]).map((r) => `${r.text} ${r.key.split('#')[1].slice(0, 90)}`)).toEqual([]);
    const ctReads = backend.filter((f) => f.rel.startsWith('backend/src/routes/')).reduce((n, f) => n + (f.text.match(/\b(parsePageParams|parseOffsetParam|parseQueryInt)\((req\.query|undefined)/g) || []).length, 0);
    expect(ctReads).toBeGreaterThanOrEqual(85);   // 1105 = 91 호출(page · limit 한 호출 = 1)
  });
  it('허용 목록은 실제로 쓰인다(죽은 허용 0)', () => {
    const keys = new Set(rows.map((r) => r.key));
    expect(Object.keys(ALLOW_Q).filter((k) => !keys.has(k))).toEqual([]);
  });
  it('반례 = 구조 분해 · 별칭 · ?. · 날짜 조립 · 대괄호 꼴은 잡는다(추출 자체의 시험)', () => {
    const chunk = [
      "const { page = 1, limit = 20, year, month } = req.query;",
      "const offset = (Number(page) - 1) * Number(limit);",
      "const lim = req.query?.limit;",
      "const n = Number(lim);",
      "const m = parseInt(req.query['days'] as string) || 3;",
      "const start = `${year}-${month}-01`;",
      "const ok = parsePageParams(req.query.page, req.query.limit, { defaultLimit: 1, maxLimit: 2 });",
    ];
    const s = queryNumberSites(chunk, namesIn(chunk));
    expect(s.map((x) => [x.line, x.ct])).toEqual([[2, false], [4, false], [5, false], [6, false]]);   // CT 줄(7) = 숫자 바꿈 없음 · 안 잡힘
  });
  it('0 기반 주소 두 자리 = pageBase 0', () => {
    expect(read('backend/src/routes/companies.ts')).toContain("const { page, limit, offset: cardOffset } = parsePageParams(req.query.page, req.query.limit, { defaultLimit: 20, maxLimit: 100, pageBase: 0 });");
    expect(read('backend/src/routes/alimtalk.ts')).toContain("const { page } = parsePageParams(req.query.page, undefined, { defaultLimit: 1, maxLimit: 1, pageBase: 0 });");
  });
});

describe('K5b · K5c · K5d H4 R59 SQL 직전 숫자 = CT(옛 값 그대로 · 거절만)', () => {
  it('SQL 매개변수 배열 push 안 Number( · parseInt( · parseFloat( = 0(백엔드 전 파일)', () => {
    const bad: string[] = [];
    for (const f of backend) {
      codeOnly(f.text).split('\n').forEach((l, i) => { if (/\b\w*[pP]arams\.push\([^;]*\b(Number|parseInt|parseFloat)\(/.test(l)) bad.push(`${f.rel}:${i + 1}`); });
    }
    expect(bad).toEqual([]);
  });
  it('반례 = params.push(Number(x)) 꼴은 잡는다', () => {
    expect(/\b\w*[pP]arams\.push\([^;]*\b(Number|parseInt|parseFloat)\(/.test('    topParams.push(limit, Number(x));')).toBe(true);
  });
  it('고객 필터 숫자식 비교 뒤 값 넣기 = bindNumber 또는 bindNumericRaw(원값 자리 둘만)', () => {
    const lines = read('backend/src/utils/customer-filter.ts').split('\n');
    const bad: string[] = [];
    let raw = 0;
    lines.forEach((l, i) => {
      if (!/sql \+= `[^`]*\$\{(ageExpr|ageExprMixed|numberRef|customNumberExpr\(cfCol\))\} (=|>=|<=|BETWEEN) \$/.test(l)) return;
      const rest = (l.split('`;')[1] || '') + '\n' + (lines[i + 1] || '');
      const m = /(bindNumber|bindNumericRaw)\(params/.exec(rest);
      if (!m) bad.push(`customer-filter.ts:${i + 1}`);
      else if (m[1] === 'bindNumericRaw') raw++;
    });
    expect(bad).toEqual([]);
    expect(raw).toBe(2);
    expect(read('backend/src/utils/customer-filter.ts')).not.toMatch(/params\.push\(Number\(/);
  });
  it('CT 기대값(손으로 쓴 값 · 옛 값 그대로 · 거절만)', () => {
    expect(sqlNumberParam('30.0')).toBe(30);
    expect(sqlNumberParam('+30')).toBe(30);
    expect(sqlNumberParam('')).toBe(0);
    expect(sqlNumberParam(null)).toBe(0);
    expect(sqlNumberParam(true)).toBe(1);
    for (const v of ['abc', 'NaN', 'Infinity', undefined]) expect(() => sqlNumberParam(v)).toThrow(expect.objectContaining({ status: 400, code: 'INVALID_NUMBER_INPUT' }));
    for (const v of ['9007199254740993', '9007199254740993e0', '1e-400', '1e 3', 'abc', 30]) expect(sqlNumericRawParam(v)).toBe(v);
    for (const v of ['NaN', ' nan ', 'Infinity', '-inf', '+Infinity', 'INF']) expect(() => sqlNumericRawParam(v)).toThrow(expect.objectContaining({ code: 'INVALID_NUMBER_INPUT' }));
    expect(sqlParseIntParam('7abc')).toBe(7);
    expect(() => sqlParseIntParam('abc')).toThrow(expect.objectContaining({ code: 'INVALID_NUMBER_INPUT' }));
    expect(parseQueryInt('abc', { fallback: 30, min: 7, max: 90, clamp: true })).toBe(30);
    expect(parseQueryInt('0', { fallback: 30, min: 7, max: 90, clamp: true })).toBe(30);
    expect(parseQueryInt('500', { fallback: 30, min: 7, max: 90, clamp: true })).toBe(90);
    expect(parseQueryInt('3', { fallback: 30, min: 7, max: 90, clamp: true })).toBe(7);
    expect(parseQueryInt('-2', { fallback: null, min: 1, max: 9 })).toBeNull();
    expect(parsePageParams('abc', '-5', { defaultLimit: 50, maxLimit: 200 })).toEqual({ page: 1, limit: 50, offset: 0 });
    expect(parsePageParams('1e20', '20', { defaultLimit: 50, maxLimit: 200 })).toEqual({ page: QUERY_PAGE_MAX, limit: 20, offset: (QUERY_PAGE_MAX - 1) * 20 });
    expect(parsePageParams('1', '20', { defaultLimit: 20, maxLimit: 100, pageBase: 0 })).toEqual({ page: 1, limit: 20, offset: 20 });
    expect(parsePageParams(undefined, undefined, { defaultLimit: 20, maxLimit: 100, pageBase: 0 })).toEqual({ page: 0, limit: 20, offset: 0 });
    expect(parseOffsetParam('-3')).toBe(0);
  });
});

describe('K6 H5 A/B 칸 스팸 검사 = 판마다', () => {
  it('상세 ab_variants 에 행 id · 점검 판 단추가 판 id 를 넘긴다 · 창 = 그 판 · 막기 = 그 판 나갈 글', () => {
    expect(read('backend/src/utils/journey-builder.ts')).toContain('ab_variants: (abByStep.get(String(s.id)) || []).map((v) => ({ id: v.id, variant_id: v.variant_id,');
    const panel = read('frontend/src/components/journey/workspace/JourneyCheckPanel.tsx');
    expect(panel).toContain('onClick={() => onSpamTest(t.variantId)}');
    const ws = read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx');
    expect(ws).toContain('journeyStep={{ journeyId, stepId: spamFor.stepId, variantId: spamFor.variantId }}');
    expect(ws).toContain("label: `${v.variant_id}안 검사`");
    expect(ws).toContain("const copies = abSendCopies(vs, selStudio?.messageTemplate ?? '', selStudio?.subject ?? '');");
  });
  it('점검 줄 판 이름 = 「(B안)」(행 id → variant_id · 켜기 검증 항목 · 스팸 상태 항목 같은 함수)', () => {
    const chk = read('backend/src/utils/journey-check.ts');
    expect(chk).toContain("for (const r of rows) abName.set(r.id, `${r.variant_id}안`);");
    expect(chk).toContain('itemOfFailure(f, states, abLabelOf)');
    expect(chk).toContain("const ab = s.variantId ? ` (${abLabelOf(s.variantId) ?? 'A/B 판'})` : '';");
  });
});
