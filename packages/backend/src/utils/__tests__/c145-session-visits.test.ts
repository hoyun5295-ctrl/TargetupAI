// replaces: none
/**
 * C145 — 공개 페이지 세션 끊김 닫기 + 공개 페이지 방문 기록(★ 2026-11-19 · 설계서 docs/2026-11-19-c145-public-session-visits-design.md §4)
 *   K1 공개 경로 목록 = App.tsx 의 PrivateRoute 없는 화면 경로(양쪽)
 *   K2 로그인 끝 처리 한 곳(토큰 지우기 = authStore · 사유 · 나눈 원인 적기 = session-end · 통로는 보낼 때 고정한 값으로 판정)
 *   K3 App.tsx 라우트 밖 전역 부품 중 로그인 상태를 읽는 것 = 공개 경로 판정을 부른다(면제 = 이유 있음)
 *   K4 세션을 끄는 SQL = session-manager 의 endSessions 하나
 *   K5 끈 원인 목록 = DDL CHECK = 문구 표 · 인증 미들웨어에 글자 문구 0
 *   K6 'login_takeover' 기록 = 밀려난 IP(takenOverIp)
 *   K7 방문 기록 배선(등록 페이지마다 그 화면이 훅을 부름 · JBN 신청이 방문을 실음 · 신청 경로가 잇기를 부름)
 *   B1 프론트 로그인 끝 처리 행동(session-end + authStore 를 직접 불러 · 가짜 저장소)
 *   단위 = 기기 · 앱 판별 · 값 거름 · 원인 문구 · 24시간 만료 안내
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import jwt from 'jsonwebtoken';

vi.hoisted(() => { if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'test-only-not-a-secret'; });
const q = vi.hoisted(() => vi.fn());
vi.mock('../../config/database', () => ({ query: q, pool: { query: q, connect: vi.fn() } }));

import { scanSources } from './source-scan';
import { SESSION_END_REASONS, sessionEndMessage, SESSION_END_UNKNOWN_MESSAGE, SESSION_TOKEN_EXPIRED_MESSAGE } from '../session-manager';
import { authenticate } from '../../middlewares/auth';
import { describeVisitorAgent, parseVisitStart, parseVisitBeat, PUBLIC_VISIT_PAGES } from '../public-visits';
import { PUBLIC_PATHS, isPublicPath } from '../../../../frontend/src/utils/public-paths';
import {
  decideSessionEnd, endClientSession, SESSION_END_SHARED_KEY, SESSION_END_SHARED_TTL_MS, SESSION_NOTICE_EVENT,
} from '../../../../frontend/src/utils/session-end';
import { useAuthStore } from '../../../../frontend/src/stores/authStore';

const PKG = resolve(__dirname, '../../../..');
const FRONT = join(PKG, 'frontend/src');
const BACK = join(PKG, 'backend/src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const APP = read(join(FRONT, 'App.tsx'));

// ─────────────────────────────────────────────
// K1 공개 경로 목록
// ─────────────────────────────────────────────

/** App.tsx <Routes> 안의 <Route 를 하나씩 = 경로 · 로그인 필요 · 화면 없이 이동만 */
function appRoutes(): Array<{ path: string; isPrivate: boolean; redirectOnly: boolean }> {
  const body = APP.slice(APP.indexOf('<Routes>'), APP.indexOf('</Routes>'));
  return body.split(/<Route\b/).slice(1).map((chunk) => {
    const m = /path=(?:"([^"]+)"|\{`?([^`}]+)`?\})/.exec(chunk);
    const comps = [...chunk.matchAll(/<([A-Z][A-Za-z0-9]*)/g)].map((x) => x[1]).filter((n) => n !== 'Navigate');
    return { path: (m?.[1] ?? m?.[2] ?? '').trim(), isPrivate: chunk.includes('PrivateRoute'), redirectOnly: comps.length === 0 };
  });
}

describe('K1 공개 경로 목록 = App.tsx 의 로그인 없이 여는 화면', () => {
  it('PrivateRoute 없는 화면 경로 집합과 PUBLIC_PATHS 가 같다(양쪽)', () => {
    const routes = appRoutes();
    expect(routes.length).toBeGreaterThan(50);
    const extracted = routes.filter((r) => !r.isPrivate && !r.redirectOnly && r.path !== '*').map((r) => r.path).sort();
    expect(extracted).toEqual([...PUBLIC_PATHS].sort());
  });
  it('판정 — 끝 슬래시 · 자리 표시 조각 · 로그인 필요 경로', () => {
    expect(isPublicPath('/jbn')).toBe(true);
    expect(isPublicPath('/jbn/')).toBe(true);
    expect(isPublicPath('/journey-pause/abc')).toBe(true);
    expect(isPublicPath('/journey-pause/')).toBe(true);   // = /journey-pause
    expect(isPublicPath('/dashboard')).toBe(false);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/jbnx')).toBe(false);
    expect(isPublicPath('/jbn/extra')).toBe(false);
  });
});

// ─────────────────────────────────────────────
// K2 끝 처리 한 곳
// ─────────────────────────────────────────────

describe('K2 로그인 끝 처리 = utils/session-end 하나', () => {
  const files = scanSources(FRONT).filter((f) => !f.rel.includes('__tests__'));
  const rel = (f: { rel: string }) => f.rel.replace(/\\/g, '/');
  it("localStorage 'token' 을 지우는 파일 = stores/authStore.ts 하나", () => {
    expect(files.filter((f) => /removeItem\(\s*['"]token['"]\s*\)/.test(f.src)).map(rel)).toEqual(['stores/authStore.ts']);
  });
  it('forceLogoutReason · hanjul.sessionEnd 를 적는 파일 = utils/session-end.ts 하나', () => {
    expect(files.filter((f) => /setItem\(\s*['"]forceLogoutReason['"]/.test(f.src)).map(rel)).toEqual(['utils/session-end.ts']);
    expect(files.filter((f) => f.src.includes("'hanjul.sessionEnd'")).map(rel)).toEqual(['utils/session-end.ts']);
  });
  it('API 통로 = 보낼 때 실은 토큰 · 탭 토큰을 고정하고 401 은 그 값으로만 끝 처리를 부른다', () => {
    const c = read(join(FRONT, 'api/client.ts'));
    expect(c).toContain('(config as any).sessionAtSend = { sentToken: token || null, sentTabToken: useAuthStore.getState().token };');
    const onError = c.slice(c.indexOf('api.interceptors.response.use('), c.indexOf('// Auth API'));
    expect(onError).toContain('endedToken: sent.sentToken ?? sent.sentTabToken ?? null,');
    expect(onError).not.toMatch(/useAuthStore\.getState\(\)|localStorage\.(getItem|removeItem)|location\.href/);
  });
  it('세션 감시 훅은 401 을 다시 판정하지 않는다(창 갈래 0) · 다른 창 로그인 바뀜 = 옛 값을 끝난 토큰으로', () => {
    const h = read(join(FRONT, 'hooks/useSessionGuard.ts'));
    expect(h).not.toMatch(/forceLogout|status === 401/);
    expect(h).toContain('endClientSession({ endedToken: e.oldValue })');
  });
});

// ─────────────────────────────────────────────
// K3 전역 부품
// ─────────────────────────────────────────────

/** 공개 경로 판정이 필요 없는 전역 부품(이유) */
const K3_EXEMPT: Record<string, string> = {
  PageViewTracker: '로그인 사용자의 공개 페이지 접속도 접속 기록 대상 · 화면에 그리지 않는다',
};

function componentSource(name: string): string | null {
  const local = APP.indexOf(`\nfunction ${name}(`);
  if (local >= 0) {
    const rest = APP.slice(local + 1);
    const end = rest.slice(1).search(/\n(function |export |const [A-Z])/);
    return end >= 0 ? rest.slice(0, end + 1) : rest;
  }
  const imp = new RegExp(`import (?:${name}|\\{[^}]*\\b${name}\\b[^}]*\\}) from '(\\.[^']+)'`).exec(APP);
  if (!imp) return null;
  for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
    const p = resolve(FRONT, imp[1] + ext);
    if (existsSync(p)) return read(p);
  }
  return null;
}

describe('K3 로그인 상태를 읽는 라우트 밖 전역 부품 = 공개 경로에서 그리지 않는다', () => {
  it('App.tsx 의 BrowserRouter 안 · Routes 밖 부품마다', () => {
    const inside = APP.slice(APP.indexOf('<BrowserRouter>'), APP.indexOf('</BrowserRouter>'));
    const outside = inside.slice(0, inside.indexOf('<Routes>')) + inside.slice(inside.indexOf('</Routes>'));
    const names = [...new Set([...outside.matchAll(/<([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
    expect(names).toEqual(expect.arrayContaining(['SessionGuard', 'DemoCompanyBanner', 'PageViewTracker', 'SessionTimeoutGuard', 'HelpDock', 'SecurityNoticeCard']));
    const readsLogin: string[] = [];
    for (const n of names) {
      const src = componentSource(n);
      if (!src || !/useAuthStore|localStorage\.getItem\(['"]token['"]\)/.test(src)) continue;
      readsLogin.push(n);
      if (K3_EXEMPT[n]) continue;
      expect(src, `${n} = 로그인 상태를 읽는 전역 부품 · 공개 경로 판정이 없다`).toContain('isPublicPath(');
    }
    expect(readsLogin).toEqual(expect.arrayContaining(['DemoCompanyBanner', 'SessionTimeoutGuard', 'HelpDock', 'SecurityNoticeCard']));
  });
});

// ─────────────────────────────────────────────
// K4 · K5 · K6 서버
// ─────────────────────────────────────────────

describe('K4 세션을 끄는 SQL = session-manager 의 endSessions 하나', () => {
  it('백엔드 src 전수', () => {
    const hits = scanSources(BACK).filter((f) => !f.rel.includes('__tests__'))
      .filter((f) => /UPDATE\s+user_sessions[\s\S]{0,160}?is_active\s*=\s*false/i.test(f.src))
      .map((f) => f.rel.replace(/\\/g, '/'));
    expect(hits).toEqual(['utils/session-manager.ts']);
    const sm = read(join(BACK, 'utils/session-manager.ts'));
    const fn = sm.slice(sm.indexOf('export async function endSessions('), sm.indexOf('export async function readSessionEndReason('));
    expect((sm.match(/is_active\s*=\s*false/g) || []).length).toBe((fn.match(/is_active\s*=\s*false/g) || []).length);
    // 원인을 쓰는 SQL · 칸이 없을 때 SQL 둘 다 활성 행만(이미 꺼진 행의 첫 원인을 덮지 않는다)
    expect(fn.match(/UPDATE user_sessions[\s\S]*?WHERE is_active = true AND \(\$\{where\}\)/g) || []).toHaveLength(2);
    expect((fn.match(/WHERE /g) || []).length).toBe(2);
    expect(fn).toContain("CASE WHEN expires_at <= NOW() THEN 'expired'");
  });
});

describe('K5 끈 원인 = DDL CHECK = 문구 표', () => {
  it('원장 C145-DDL-1 CHECK 목록과 같다 · 원인마다 서로 다른 문구 · 모르는 원인 = 「다른 곳」이 아닌 문구', () => {
    const ledger = read(join(PKG, '../status/DEPLOY-LEDGER.md'));
    const block = ledger.slice(ledger.indexOf('```sql ddl:C145-DDL-1'), ledger.indexOf('```', ledger.indexOf('```sql ddl:C145-DDL-1') + 10));
    const list = /ended_reason IN \(([^)]+)\)/.exec(block)![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect([...list].sort()).toEqual([...SESSION_END_REASONS].sort());
    const msgs = SESSION_END_REASONS.map(sessionEndMessage);
    expect(new Set(msgs).size).toBe(SESSION_END_REASONS.length);
    expect(msgs).not.toContain(SESSION_END_UNKNOWN_MESSAGE);
    expect(sessionEndMessage(null)).toBe(SESSION_END_UNKNOWN_MESSAGE);
    expect(sessionEndMessage('bogus')).toBe(SESSION_END_UNKNOWN_MESSAGE);
    expect(SESSION_END_UNKNOWN_MESSAGE).not.toMatch(/다른 곳/);
  });
  it('인증 미들웨어에 끝 문구 글자 0 · 원인 CT 를 부른다', () => {
    const a = read(join(BACK, 'middlewares/auth.ts'));
    expect(a).not.toMatch(/다른 곳에서 로그인|세션이 만료되었습니다/);
    expect(a).toContain('error: sessionEndMessage(reason),');
  });
});

describe("K6 'login_takeover' 기록 = 밀려난 IP", () => {
  it('넣는 문장 전부 takenOverIp', () => {
    const sites: string[] = [];
    for (const f of scanSources(BACK).filter((x) => !x.rel.includes('__tests__'))) {
      for (const m of f.src.matchAll(/'login_takeover'/g)) {
        const around = f.src.slice(m.index!, m.index! + 400);
        if (!/INSERT|VALUES/.test(f.src.slice(Math.max(0, m.index! - 200), m.index!))) continue;
        sites.push(f.rel);
        expect(around, `${f.rel} 의 login_takeover 기록`).toContain('takenOverIp');
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────
// K7 방문 기록 배선
// ─────────────────────────────────────────────

describe('K7 방문 기록 배선', () => {
  it('등록 페이지마다 그 화면이 usePublicVisit 을 부른다', () => {
    const files = scanSources(FRONT);
    for (const page of PUBLIC_VISIT_PAGES) {
      expect(files.some((f) => f.src.includes(`usePublicVisit('${page}')`)), page).toBe(true);
    }
  });
  it('관리자 방문 기록 칸 = 고른 기간과 같은 자료만 그린다 · 빈 상태는 그 기간 조회가 성공했을 때만(Codex 구현 1R)', () => {
    const t = read(join(FRONT, 'components/admin/JbnMembersTab.tsx'));
    const sec = t.slice(t.indexOf('function VisitsSection('), t.indexOf('function DetailModal('));
    expect(sec).toContain('const shown = data && data.days === days ? data : null;');
    expect(sec).not.toMatch(/\{data(\?\.| &&)/);   // 그리는 자리는 전부 shown
    expect(sec).toContain('{shown && !loading && !error && shown.rows.length === 0 && (');
  });
  it('JBN 신청 본문이 방문 · 브라우저 열쇠를 싣고 신청 경로가 잇기를 부른다', () => {
    expect(read(join(FRONT, 'pages/JbnPage.tsx'))).toContain('visitId: visit.visitId, browserKey: visit.browserKey,');
    const r = read(join(BACK, 'routes/jbn-public.ts'));
    // 신청을 넣은 바로 다음 문장이 조건 없이 잇기를 부른다(막힌 호출 · 다른 자리 = 빨간불)
    expect(r).toMatch(/await insertJbnApplication\(parsed\.value, req\.ip \|\| null\);\n(?:\s*\/\/[^\n]*\n)*\s*await linkVisitApplication\(\{\s*visitId: req\.body\?\.visitId, browserKey: req\.body\?\.browserKey, applicationId: parsed\.value\.id, page: 'jbn',/);
  });
});

// ─────────────────────────────────────────────
// B1 프론트 로그인 끝 처리 행동
// ─────────────────────────────────────────────

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const A = 'header.payload.tokenA-aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'header.payload.tokenB-bbbbbbbbbbbbbbbbbbbbbbbb';
const USER = { id: 'u1', loginId: 'test', name: '시험', email: '', userType: 'company_user' as const };
const g = globalThis as any;

function setWindow(path: string) {
  const events: any[] = [];
  g.window = { location: { pathname: path, href: '' }, dispatchEvent: (e: any) => { events.push(e); return true; } };
  return events;
}
function login(token: string) {
  g.localStorage.setItem('token', token);
  g.localStorage.setItem('user', JSON.stringify(USER));
}

describe('B1 로그인 끝 처리 행동(session-end + authStore)', () => {
  beforeEach(() => {
    g.localStorage = new MemStorage();
    g.sessionStorage = new MemStorage();
    g.fetch = vi.fn(async () => ({}));
    useAuthStore.setState({ user: null, token: null, isAuthenticated: false });
  });
  afterEach(() => { delete g.window; });

  it('① 끝난 로그인 = 공유 토큰 · 사용자 지움 그리고 탭 메모리 isAuthenticated false · token null · user null', () => {
    setWindow('/dashboard');
    login(A);
    useAuthStore.getState().loadFromStorage();
    g.localStorage.setItem('sns-compose:v1:c1:u1', JSON.stringify({ text: '쓰던 글', at: Date.now() }));
    endClientSession({ endedToken: A, serverReason: '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.' });
    expect(g.localStorage.getItem('token')).toBeNull();
    expect(g.localStorage.getItem('user')).toBeNull();
    expect(g.localStorage.getItem('sns-compose:v1:c1:u1')).toBeNull();   // 이 브라우저의 로그인을 지울 때는 같이 쓰는 자료도
    const s = useAuthStore.getState();
    expect([s.isAuthenticated, s.token, s.user]).toEqual([false, null, null]);
  });

  it('② 공개 경로 = 이동 0 · 사유 0 · 나눈 원인은 적힘', () => {
    const ev = setWindow('/jbn');
    login(A);
    useAuthStore.getState().loadFromStorage();
    const d = endClientSession({ endedToken: A, serverReason: '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.' });
    expect(d.navigate).toBeNull();
    expect(g.window.location.href).toBe('');
    expect(g.sessionStorage.getItem('forceLogoutReason')).toBeNull();
    expect(ev).toHaveLength(0);
    expect(JSON.parse(g.localStorage.getItem(SESSION_END_SHARED_KEY)).reason).toBe('다른 곳에서 로그인되어 현재 세션이 종료되었습니다.');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('③ 로그인 필요 경로 = 사유 + 로그인 화면', () => {
    setWindow('/dashboard');
    login(A);
    useAuthStore.getState().loadFromStorage();
    endClientSession({ endedToken: A, serverReason: '계정 사용이 중지되어 로그인이 끝났습니다. 담당자에게 문의해 주세요.' });
    expect(g.sessionStorage.getItem('forceLogoutReason')).toBe('계정 사용이 중지되어 로그인이 끝났습니다. 담당자에게 문의해 주세요.');
    expect(g.window.location.href).toBe('/login');
  });

  it('④ 늦게 닿은 실패(끝난 A ≠ 지금 공유 B) = 공유 B 그대로 · 탭 B 그대로 · 이동 0', () => {
    setWindow('/dashboard');
    login(B);
    useAuthStore.getState().loadFromStorage();
    const d = endClientSession({ endedToken: A, serverReason: '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.' });
    expect(d).toMatchObject({ clearShared: false, tab: 'keep', navigate: null });
    expect(g.localStorage.getItem('token')).toBe(B);
    expect(useAuthStore.getState().token).toBe(B);
  });

  it('⑤ 공개 탭이 먼저 지운 뒤 로그인 필요 탭의 토큰 없는 401 = 나눈 원인으로 사유', () => {
    setWindow('/jbn');
    login(A);
    useAuthStore.getState().loadFromStorage();
    endClientSession({ endedToken: A, serverReason: '다른 곳에서 로그인되어 현재 세션이 종료되었습니다.' });
    // 다른 탭(메모리 A 그대로) — 공유 저장소는 비었다 · 토큰 없는 확인 요청의 401(서버 문구 없음)
    useAuthStore.setState({ user: USER as any, token: A, isAuthenticated: true });
    setWindow('/dashboard');
    endClientSession({ endedToken: A, serverReason: null });
    expect(g.sessionStorage.getItem('forceLogoutReason')).toBe('다른 곳에서 로그인되어 현재 세션이 종료되었습니다.');
    expect(g.window.location.href).toBe('/login');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('⑥ 10분 지난 나눈 원인 · 다른 토큰의 원인 = 쓰지 않음', () => {
    const now = Date.now();
    const base = { path: '/dashboard', endedToken: A, sharedToken: null, tabToken: A, serverReason: null, now };
    expect(decideSessionEnd({ ...base, sharedEnd: { t: A.slice(-24), reason: 'x', at: now - SESSION_END_SHARED_TTL_MS - 1 } }).reason).toBeNull();
    expect(decideSessionEnd({ ...base, sharedEnd: { t: B.slice(-24), reason: 'x', at: now } }).reason).toBeNull();
    expect(decideSessionEnd({ ...base, sharedEnd: { t: A.slice(-24), reason: 'x', at: now } }).reason).toBe('x');
  });

  it('⑦ 토큰 없는 요청(보낼 때 탭 A 고정) → (가) 같은 탭 B 로그인 (나) 다른 창 B 따름 → 옛 401 = B 그대로', () => {
    setWindow('/dashboard');
    for (const step of ['same-tab', 'adopted'] as const) {
      g.localStorage.clear();
      login(B);
      if (step === 'same-tab') useAuthStore.getState().login(USER as any, B);
      else useAuthStore.getState().loadFromStorage();
      const d = endClientSession({ endedToken: A, serverReason: null });   // = sentToken null ?? sentTabToken A
      expect(d.clearShared, step).toBe(false);
      expect(g.localStorage.getItem('token'), step).toBe(B);
      expect(useAuthStore.getState().token, step).toBe(B);
      expect(d.navigate, step).toBeNull();
    }
  });

  it('⑧ 탭 메모리 A · 다른 창이 B 로 로그인(이벤트 옛 값 A) = B 그대로 · 탭은 B 를 따름 · 안내 후 새로 불러오기', () => {
    const ev = setWindow('/dashboard');
    login(A);
    useAuthStore.getState().loadFromStorage();
    login(B);   // 다른 창의 로그인
    const d = endClientSession({ endedToken: A });
    expect(d).toMatchObject({ clearShared: false, tab: 'adopt', navigate: 'reload' });
    expect(g.localStorage.getItem('token')).toBe(B);
    expect(useAuthStore.getState().token).toBe(B);
    expect(ev.map((e) => e.type)).toEqual([SESSION_NOTICE_EVENT]);
    expect(g.window.location.href).toBe('');
  });

  it('⑧-2 다른 창 로그인을 따를 때 = 옛 계정의 탭 자료(AI 한줄로 진행)는 지우고 · 브라우저가 같이 쓰는 새 로그인의 SNS 쓰던 글은 둔다(Codex 구현 1R · 2R)', () => {
    setWindow('/jbn');
    login(A);
    useAuthStore.getState().loadFromStorage();
    g.sessionStorage.setItem('ai_line_run_v1:u1', '{}');
    login(B);
    g.localStorage.setItem('sns-compose:v1:c1:u1', JSON.stringify({ text: '새 로그인 창에서 쓴 글', at: Date.now() }));   // B 로그인 뒤 다른 창이 쓴 글
    const d = endClientSession({ endedToken: A });
    expect(d.tab).toBe('adopt');
    expect(g.localStorage.getItem('sns-compose:v1:c1:u1')).not.toBeNull();
    expect(g.sessionStorage.getItem('ai_line_run_v1:u1')).toBeNull();
    expect(g.localStorage.getItem('token')).toBe(B);
    expect(useAuthStore.getState().token).toBe(B);
  });

  it('⑨ 끝난 것이 이 탭 로그인이 아니고 공유도 그대로 = 아무것도 안 함', () => {
    const d = decideSessionEnd({ path: '/dashboard', endedToken: 'other-token-zzzzzzzzzzzzzzzzzzzzzzz', sharedToken: A, tabToken: A, serverReason: null, sharedEnd: null, now: Date.now() });
    expect(d).toMatchObject({ clearShared: false, tab: 'keep', navigate: null, reason: null });
  });

  it('자동 로그아웃(서버 세션 살아 있음) = 서버도 끊고 지움 · 공개 경로면 이동 0', () => {
    setWindow('/pricing');
    login(A);
    useAuthStore.getState().loadFromStorage();
    endClientSession({ endedToken: A, serverReason: '장시간 활동이 없어 자동 로그아웃되었습니다.', serverAlive: true });
    expect(g.fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    expect(g.localStorage.getItem('token')).toBeNull();
    expect(g.window.location.href).toBe('');
  });
});

// ─────────────────────────────────────────────
// 단위
// ─────────────────────────────────────────────

describe('기기 · 앱 판별', () => {
  const T: Array<[string, string, string]> = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.0', '휴대폰', '카카오톡'],
    ['Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.5.10)', '휴대폰', '네이버 앱'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36', '휴대폰', '브라우저'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', '태블릿', '브라우저'],
    ['Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', '태블릿', '브라우저'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36', 'PC', '브라우저'],
    ['', '알 수 없음', '알 수 없음'],
  ];
  it.each(T)('%s', (ua, device, app) => { expect(describeVisitorAgent(ua)).toEqual({ device, app }); });
});

describe('방문 값 거름', () => {
  const ID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607';
  const BK = '0a1b2c3d-4e5f-4a6b-9c7d-8e9fa0b1c2d3';
  it('start — 꼴 · 등록 페이지 · src · 들어온 곳', () => {
    expect(parseVisitStart({ id: ID, browserKey: BK, page: 'jbn', src: 'band-0', referrerHost: 'M.Band.US' }))
      .toEqual({ id: ID, page: 'jbn', browserKey: BK, src: 'band-0', referrerHost: 'm.band.us' });
    expect(parseVisitStart({ id: 'x', browserKey: BK, page: 'jbn' })).toBeNull();
    expect(parseVisitStart({ id: ID, browserKey: BK, page: 'intro' })).toBeNull();
    expect(parseVisitStart({ id: ID, browserKey: BK, page: 'jbn', src: '<script>', referrerHost: 'a b' })).toMatchObject({ src: null, referrerHost: null });
  });
  it('beat — 0 ~ 60 초로 자름 · 숫자 아님 = 버림', () => {
    expect(parseVisitBeat({ id: ID, browserKey: BK, page: 'jbn', seconds: 999 })?.seconds).toBe(60);
    expect(parseVisitBeat({ id: ID, browserKey: BK, page: 'jbn', seconds: -5 })?.seconds).toBe(0);
    expect(parseVisitBeat({ id: ID, browserKey: BK, page: 'jbn', seconds: 'abc' })).toBeNull();
  });
});

describe('인증 미들웨어 — 끝난 세션은 원인대로 · 24시간 끝 = 안내', () => {
  const run = async (token: string) => {
    const out: any = {};
    const res: any = { status: (c: number) => { out.status = c; return res; }, json: (b: any) => { out.body = b; return res; } };
    await authenticate({ headers: { authorization: `Bearer ${token}` } } as any, res, () => { out.next = true; });
    return out;
  };
  beforeEach(() => q.mockReset());

  it('세션 행 꺼짐 + 원인 account_stopped = 그 문구 · 강제 표식', async () => {
    q.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ended_reason: 'account_stopped' }] });
    const t = jwt.sign({ userId: 'u1', userType: 'company_user', loginId: 'x', sessionId: 's1' }, process.env.JWT_SECRET!);
    const out = await run(t);
    expect(out.status).toBe(401);
    expect(out.body).toMatchObject({ forceLogout: true, code: 'SESSION_ENDED', reason: 'account_stopped', error: sessionEndMessage('account_stopped') });
  });
  it('원인 칸 없음(읽기 실패) = 원인 없음 문구', async () => {
    q.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(Object.assign(new Error('column "ended_reason" does not exist'), { code: '42703' }));
    const t = jwt.sign({ userId: 'u1', userType: 'company_user', loginId: 'x', sessionId: 's1' }, process.env.JWT_SECRET!);
    const out = await run(t);
    expect(out.body.error).toBe(SESSION_END_UNKNOWN_MESSAGE);
  });
  it('JWT 만료 = 「로그인 시간이 끝났습니다」 · 서명 틀림 = 지금 그대로', async () => {
    const expired = jwt.sign({ userId: 'u1', userType: 'company_user', loginId: 'x', sessionId: 's1' }, process.env.JWT_SECRET!, { expiresIn: -10 });
    expect((await run(expired)).body).toEqual({ error: SESSION_TOKEN_EXPIRED_MESSAGE, forceLogout: true, code: 'TOKEN_EXPIRED' });
    const forged = jwt.sign({ userId: 'u1', userType: 'company_user', loginId: 'x', sessionId: 's1' }, 'other-secret');
    expect((await run(forged)).body).toEqual({ error: 'Invalid token' });
  });
});

void dirname;
