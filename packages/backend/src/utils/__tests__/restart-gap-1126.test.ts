// replaces: none
/**
 * 재시작 공백 때 화면이 0 으로 남는 결함 — 뿌리 R109 계약 시험(★ 2026-11-26 · 설계서 docs/2026-11-26-restart-gap-reread-design.md §5)
 *   판정(nginx 가 백엔드에 못 닿을 때 = 502 · 503 · 504 + JSON 아님) · 비어 있는 표시 값 다시 채우기 고리 · 대시보드 붙임 자리 · 직접발송 확정 문장.
 *   프론트 러너가 없어 순수 함수는 여기서 직접 import 한다(선례 agency-ad-subject-display.test.ts) · 배선은 소스 계약(기계 추출).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  isRestartGap, isRestartGapAxiosError, refillWhenServerBack, jsonRefillRead, RestartGapError, RESTART_GAP_SEND_ERROR,
} from '../../../../frontend/src/lib/restart-gap';

const FE = join(__dirname, '../../../../frontend/src');
const fe = (p: string) => readFileSync(join(FE, p), 'utf8');

afterEach(() => { vi.useRealTimers(); });

describe('isRestartGap — nginx 가 백엔드에 못 닿을 때만', () => {
  it('502 · 503 · 504 + JSON 아님 = 참 · JSON(서버가 스스로 낸 실패) · 그 밖의 상태 = 거짓', () => {
    for (const st of [502, 503, 504]) {
      expect(isRestartGap(st, 'text/html')).toBe(true);
      expect(isRestartGap(st, null)).toBe(true);
      expect(isRestartGap(st, undefined)).toBe(true);
      expect(isRestartGap(st, 'application/json; charset=utf-8')).toBe(false);
      expect(isRestartGap(st, 'Application/JSON')).toBe(false);
    }
    for (const st of [200, 304, 401, 404, 500, 0, undefined]) expect(isRestartGap(st as any, 'text/html')).toBe(false);
  });
  it('axios 오류도 같은 표(응답 없음 = 거짓)', () => {
    expect(isRestartGapAxiosError({ response: { status: 502, headers: { 'content-type': 'text/html' } } })).toBe(true);
    expect(isRestartGapAxiosError({ response: { status: 502, headers: { 'content-type': 'application/json' } } })).toBe(false);
    expect(isRestartGapAxiosError({ response: { status: 401, headers: {} } })).toBe(false);
    expect(isRestartGapAxiosError({ message: 'Network Error' })).toBe(false);
    expect(isRestartGapAxiosError(null)).toBe(false);
  });
});

/** 시도마다 정해 둔 결과를 그 시각에 돌려주는 가짜 read(가짜 시계) */
function scriptedRead(steps: Array<{ after: number; out: any; ignoreAbort?: boolean }>) {
  const calls: Array<{ token: string | null; signal: AbortSignal; at: number }> = [];
  const read = (token: string | null, signal: AbortSignal) => {
    const step = steps[Math.min(calls.length, steps.length - 1)];
    calls.push({ token, signal, at: Date.now() });
    return new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => resolve(step.out), step.after);
      if (!step.ignoreAbort) signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
    });
  };
  return { read, calls };
}

describe('refillWhenServerBack — 비어 있는 표시 값 다시 채우기 고리', () => {
  it('공백 두 번 뒤 값 = 채우기 1회 · 읽기 3번 · 1초 간격 · 처음 토큰만 싣는다', async () => {
    vi.useFakeTimers();
    const { read, calls } = scriptedRead([{ after: 10, out: { gap: true } }, { after: 10, out: { gap: true } }, { after: 10, out: { gap: false, value: 29 } }]);
    const filled: number[] = [];
    const p = refillWhenServerBack({ token: 'tk-a', read, fill: (v) => filled.push(v), ok: () => true });
    await vi.advanceTimersByTimeAsync(5_000);
    await p;
    expect(filled).toEqual([29]);
    expect(calls.length).toBe(3);
    expect(calls.map((c) => c.token)).toEqual(['tk-a', 'tk-a', 'tk-a']);
    expect(calls[1].at - calls[0].at).toBe(1_010);
  });

  it('마감(20초)까지 공백 = 채우기 0 · 마감 뒤 읽기 0', async () => {
    vi.useFakeTimers();
    const { read, calls } = scriptedRead([{ after: 0, out: { gap: true } }]);
    const filled: number[] = [];
    const p = refillWhenServerBack({ token: 't', read, fill: (v: number) => filled.push(v), ok: () => true });
    await vi.advanceTimersByTimeAsync(30_000);
    await p;
    expect(filled).toEqual([]);
    const n = calls.length;
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThanOrEqual(20);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls.length).toBe(n);
  });

  it('마감 직전에 시작한 시도는 남은 시간에 실제로 끊기고 마감 뒤 성공은 채우지 않는다', async () => {
    vi.useFakeTimers();
    // 1 ~ 18초 공백 → 19초에 시작한 시도는 3초 뒤 성공(마감 20초를 넘김 → 남은 1초에 끊겨야 한다)
    const steps: any[] = [];
    for (let i = 0; i < 18; i++) steps.push({ after: 0, out: { gap: true } });
    steps.push({ after: 3_000, out: { gap: false, value: 1 } });
    const { read, calls } = scriptedRead(steps);
    const filled: number[] = [];
    const p = refillWhenServerBack({ token: 't', read, fill: (v: number) => filled.push(v), ok: () => true });
    await vi.advanceTimersByTimeAsync(40_000);
    await p;
    expect(filled).toEqual([]);
    const last = calls[calls.length - 1];
    expect(last.signal.aborted).toBe(true);
  });

  it('취소 타이머가 늦게 돌아 5초를 넘긴 응답이 전체 마감 전에 끝나도 채우지 않는다(시각으로 다시 본다)', async () => {
    vi.useFakeTimers();
    const { read } = scriptedRead([{ after: 6_000, out: { gap: false, value: 7 }, ignoreAbort: true }, { after: 0, out: { gap: true } }]);
    const filled: number[] = [];
    const p = refillWhenServerBack({ token: 't', read, fill: (v: number) => filled.push(v), ok: () => true });
    await vi.advanceTimersByTimeAsync(40_000);
    await p;
    expect(filled).toEqual([]);
  });

  it('시도 하나가 5초 넘게 멈추면 그 시도만 버리고 다음 시도', async () => {
    vi.useFakeTimers();
    const { read, calls } = scriptedRead([{ after: 60_000, out: { gap: false, value: 1 } }, { after: 10, out: { gap: false, value: 2 } }]);
    const filled: number[] = [];
    const p = refillWhenServerBack({ token: 't', read, fill: (v: number) => filled.push(v), ok: () => true });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(filled).toEqual([2]);
    expect(calls[0].signal.aborted).toBe(true);
  });

  it('값 없는 응답(401 · 500 등) = 채우기 0 · 읽기 1', async () => {
    vi.useFakeTimers();
    const { read, calls } = scriptedRead([{ after: 0, out: { gap: false } }]);
    const filled: number[] = [];
    const p = refillWhenServerBack({ token: 't', read, fill: (v: number) => filled.push(v), ok: () => true });
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(filled).toEqual([]);
    expect(calls.length).toBe(1);
  });

  it('기다리는 중 화면이 내려가거나 로그인이 바뀌면(ok 거짓) 읽기 0 · 값을 받은 뒤 ok 거짓이면 채우기 0', async () => {
    vi.useFakeTimers();
    let alive = true;
    const a = scriptedRead([{ after: 0, out: { gap: false, value: 1 } }]);
    const filled: number[] = [];
    const p1 = refillWhenServerBack({ token: 't', read: a.read, fill: (v: number) => filled.push(v), ok: () => alive });
    alive = false;
    await vi.advanceTimersByTimeAsync(5_000);
    await p1;
    expect(a.calls.length).toBe(0);

    let ok = true;
    const b = scriptedRead([{ after: 500, out: { gap: false, value: 2 } }]);
    const p2 = refillWhenServerBack({ token: 't', read: b.read, fill: (v: number) => filled.push(v), ok: () => ok });
    await vi.advanceTimersByTimeAsync(1_100);
    ok = false;
    await vi.advanceTimersByTimeAsync(5_000);
    await p2;
    expect(b.calls.length).toBe(1);
    expect(filled).toEqual([]);
  });

  it('고리 둘은 서로를 막지 않는다(모듈 상태 0)', async () => {
    vi.useFakeTimers();
    const a = scriptedRead([{ after: 0, out: { gap: false, value: 1 } }]);
    const b = scriptedRead([{ after: 0, out: { gap: false, value: 2 } }]);
    const filled: number[] = [];
    const p = Promise.all([
      refillWhenServerBack({ token: 't', read: a.read, fill: (v: number) => filled.push(v), ok: () => true }),
      refillWhenServerBack({ token: 't', read: b.read, fill: (v: number) => filled.push(v), ok: () => true }),
    ]);
    await vi.advanceTimersByTimeAsync(3_000);
    await p;
    expect(filled.sort()).toEqual([1, 2]);
  });
});

describe('jsonRefillRead — 주소 하나를 읽어 판정', () => {
  const res = (status: number, ct: string, body: any) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? ct : null) }, json: async () => body });
  it('공백 = gap · 성공 = 고른 값 · 그 밖 = 값 없음 · 실은 토큰 · signal', async () => {
    const seen: any[] = [];
    const mk = (r: any) => jsonRefillRead('/api/customers/stats', (b: any) => b.stats, (async (url: string, init: any) => { seen.push({ url, init }); return r; }) as any);
    const signal = new AbortController().signal;
    expect(await mk(res(502, 'text/html', null))('tk', signal)).toEqual({ gap: true });
    expect(await mk(res(200, 'application/json', { stats: { monthly_total: 29 } }))('tk', signal)).toEqual({ gap: false, value: { monthly_total: 29 } });
    expect(await mk(res(401, 'application/json', { error: 'x' }))('tk', signal)).toEqual({ gap: false });
    expect(await mk(res(502, 'application/json', { error: 'ai' }))('tk', signal)).toEqual({ gap: false });
    // ★ Codex 구현 1R — 200 인데 깨진 JSON = 값 없음(다시 읽기 끝) · 본문 읽기가 시도 제한으로 끊김 = 그 시도만 실패(던짐 → 다음 시도)
    const broken = { ...res(200, 'application/json', null), json: async () => { throw new SyntaxError('Unexpected token <'); } };
    expect(await mk(broken)('tk', signal)).toEqual({ gap: false });
    const cut = { ...res(200, 'application/json', null), json: async () => { throw new DOMException('aborted', 'AbortError'); } };
    await expect(mk(cut)('tk', signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen[0].url).toBe('/api/customers/stats');
    expect(seen[0].init.headers.Authorization).toBe('Bearer tk');
    expect(seen[0].init.signal).toBe(signal);
  });
});

describe('소스 계약 — R109 붙임 자리(기계 추출 · 설계서 §5-4 · §5-5)', () => {
  const dash = fe('pages/Dashboard.tsx');
  const between = (src: string, a: string, b: string) => { const i = src.indexOf(a); const j = src.indexOf(b, i + a.length); expect(i).toBeGreaterThan(-1); expect(j).toBeGreaterThan(i); return src.slice(i, j); };

  it('① 전역 감싸기 0 = window.fetch 대입은 크레딧 감싸기 한 곳뿐', () => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && /window\.fetch\s*=(?!=)/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(FE.length + 1).replace(/\\/g, '/')); } };
    walk(FE);
    expect(hits).toEqual(['lib/credit-interceptor.ts']);
  });

  it('② restart-gap 을 부르는 파일 = 대시보드 · dashboard-live 둘뿐 · 직접발송 설정 · 직접발송 패널 0', () => {
    const users: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name) && !p.endsWith('restart-gap.ts') && /lib\/restart-gap['"]/.test(readFileSync(p, 'utf8'))) users.push(p.slice(FE.length + 1).replace(/\\/g, '/')); } };
    walk(FE);
    expect(users.sort()).toEqual(['pages/Dashboard.tsx', 'utils/dashboard-live.ts']);
    expect(fe('components/DirectSendPanel.tsx')).not.toMatch(/restart-gap|refill/i);
    expect(between(dash, 'const loadCompanySettings = async', '// SMS 템플릿 로드')).not.toMatch(/refill|isRestartGap/);
  });

  it('③ 다시 채우는 값 = 셋뿐(발송 현황 · DB 현황 · AI 크레딧) · 채우기는 비어 있을 때만 · 요금제 · 잔액 · 알림 · 새로고침 0', () => {
    const calls = [...dash.matchAll(/refillShown(?:<[^>]*>)?\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect([...new Set(calls)].sort()).toEqual(['/api/companies/dashboard-cards', '/api/companies/my-credit', '/api/customers/stats']);
    const fills = between(dash, '// ★ 2026-11-26 R109 재시작 공백 다시 채우기(설계서', '// ★ 2026-11-26 R109 끝');
    expect(fills).toMatch(/setStats\(\(prev\) => prev \?\?/);
    expect(fills).toMatch(/setDashboardCards\(\(prev\) => prev \?\?/);
    expect(fills).toMatch(/setCreditInfo\(\(prev: any\) => prev \?\?/);
    expect(fills).not.toMatch(/setPlanInfo|setBalanceInfo|setShowPlanApproval|setPlanChange|location\.reload|loadStats\(|loadDashboardCards\(|loadCredit\(/);
    expect(fills).toMatch(/useRef\(new Set<string>\(\)\)/);
  });

  it('④ 예약 자리 — loadStats 는 stats 가 던진 catch 안에서만(stats · dashboard-cards) · 카드 · 크레딧은 r.gap 갈래에서만', () => {
    const ls = between(dash, 'const loadStats = async () => {', '// D41 대시보드 동적 카드 조회 — ★ 2026-10-10 함수로 뺐다');
    const ci = ls.indexOf('} catch (error) {');
    expect(ci).toBeGreaterThan(-1);
    expect(ls.slice(0, ci)).not.toMatch(/refill/);
    expect(ls.slice(ci)).toMatch(/if \(isRestartGapAxiosError\(error\)\) \{\s*refillStats\(sentToken\);\s*refillCards\(sentToken\);\s*\}/);
    const cards = between(dash, 'const loadDashboardCards = useRef(serialRunner(async () => {', '})).current;');
    expect(cards).toMatch(/if \(!r\.ok \|\| !r\.body\) \{ if \(r\.gap\) refillCards\(sentToken\); return; \}/);
    const credit = between(dash, 'const loadCredit = useRef(serialRunner(async () => {', '})).current;');
    expect(credit).toMatch(/if \(!r\.ok \|\| !d \|\| d\.success === false\) \{ if \(r\.gap\) refillCredit\(sentToken\); return; \}/);
  });

  it('⑤ loadStats 원래 차례 · 기다림 꼴 그대로(stats → my-plan → balance → balance/agent(기다리지 않음) → 카드(기다림) → 승인 상태)', () => {
    const ls = between(dash, 'const loadStats = async () => {', '// D41 대시보드 동적 카드 조회 — ★ 2026-10-10 함수로 뺐다');
    const order = ['await customersApi.stats()', "await fetch('/api/companies/my-plan'", "await fetch('/api/balance', {", "fetch('/api/balance/agent'", 'await loadDashboardCards()', "await fetch('/api/companies/plan-request/status'"].map((t) => ls.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(ls).not.toMatch(/await fetch\('\/api\/balance\/agent'/);
    const mid = ls.slice(ls.indexOf("await fetch('/api/companies/my-plan'"), ls.indexOf('await loadDashboardCards()'));
    // my-plan · balance 갈래 = 오늘 글자 그대로 · loadStats 본문 깊이(6칸)의 return · throw 0(에이전트 잔액 .then 안의 return 은 그 콜백 것) · 다시 채우기 0
    expect(mid).toContain('if (planRes.ok) {\n        const planData = await planRes.json();\n        setPlanInfo(planData);\n      }');
    expect(mid).toContain('if (balanceRes.ok) {\n        const balanceData = await balanceRes.json();\n        setBalanceInfo(balanceData);\n      }');
    expect(mid).not.toMatch(/^ {6}(?:return|throw)\b/m);
    expect(mid).not.toMatch(/refill/);
  });

  it('⑥ 직접발송 · 직접 타겟 발송 확정 — 판정 줄이 같은 try 안 res.json() 바로 앞 · catch 문장만 갈래', () => {
    // ★ Codex 구현 1R — 문자만(알림톡 확정은 오늘 그대로 · 설계 §8)
    const gate = "if (!isAlimtalk && isRestartGap(res.status, res.headers.get('content-type'))) throw new RestartGapError();";
    const gate2 = "if (!isTargetAlimtalk && isRestartGap(res.status, res.headers.get('content-type'))) throw new RestartGapError();";
    const b1 = between(dash, "const res = await fetch('/api/campaigns/direct-send/commit', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },", "if (res.status === 402 && data.insufficientBalance)");
    expect(b1).toMatch(new RegExp(`${gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*const data = await res\\.json\\(\\);`));
    expect(dash).toContain("message: err instanceof RestartGapError ? RESTART_GAP_SEND_ERROR : `발송 실패: ${errMsg.substring(0, 120)}`");
    expect(dash).toContain("message: err instanceof RestartGapError ? RESTART_GAP_SEND_ERROR : '발송 실패'");
    expect(dash.split(gate).length - 1).toBe(1);
    expect(dash.split(gate2).length - 1).toBe(1);
    expect(dash.match(/isRestartGap\(res\.status/g)?.length).toBe(2);
    const b2 = between(dash, 'const executeTargetSend = async', '\n  };\n');
    expect(b2).toMatch(new RegExp(`${gate2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*const data = await res\\.json\\(\\);`));
    expect(b2.indexOf("const isTargetAlimtalk = targetSendChannel === 'kakao_alimtalk';")).toBeLessThan(b2.indexOf(gate2));
  });

  it('⑦ fetchJson 본문 읽기 · 제한 줄 그대로 + gap 은 본문 읽기 전 판정', () => {
    const live = fe('utils/dashboard-live.ts');
    const fj = between(live, 'export async function fetchJson(url: string, timeoutMs = 10_000): Promise<Fetched> {', '\n}\n');
    expect(fj).toContain('const timer = setTimeout(() => ctl.abort(), timeoutMs);');
    expect(fj).toContain("const r = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, signal: ctl.signal });");
    // 머리 없는 가짜 응답(다른 시험의 fetch 대역)도 오늘처럼 읽혀야 한다 = 선택 연결로 읽는다(★ 단위 전체 c136 · c138 이 잡음)
    expect(fj).toMatch(/const gap = isRestartGap\(r\.status, r\.headers\?\.get\?\.\('content-type'\)\);[^\n]*\s*return \{ ok: r\.ok, status: r\.status, body: r\.ok \? await r\.json\(\) : null, \.\.\.\(gap \? \{ gap \} : \{\}\) \};/);
  });

  it('⑧ 고객 문장 = 줄표 · 가운뎃점 · 모델명 0 · 우리 쪽 원인 단정 0', () => {
    expect(RESTART_GAP_SEND_ERROR).not.toMatch(/[—–·]|Claude|GPT|서버|장비|재시작/);
    expect(new RestartGapError()).toBeInstanceOf(Error);
  });
});
