/**
 * 뿌리 대장 계약 시험 (★ 2026-10-24 · 원장 = docs/ROOT-LEDGER.md · 번호 = 대장의 R 번호)
 *
 * Harold 「두 번(10/4 · 10/18)이나 했는데도 결함이 남아 있는 게 문제다」 — 뿌리를 한 기능에서만 고쳐 다른 기능에 남았고,
 * 막은 것을 지키는 기계 장치가 없었다. 그래서 이 시험은 **대상을 소스에서 기계로 뽑는다**(주소 · 호출 · 화면 파일).
 * 표에 적은 예외만 통과하고, 새 주소 · 새 호출 · 새 화면은 분류 없이 들어오면 실패한다(손으로 등재한 표 = 등재한 것만 지킨다 · LESSONS_BACKEND 1014).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const BE = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const be = (rel: string) => read(join(BE, rel));

/** 소스 파일 전수(시험 · 빌드 산출물 제외) */
function sourceFiles(root: string, ext: RegExp): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => ext.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.(test|spec|verify)\.tsx?$/.test(f) && !/(^|\/)(dist|dist-old|node_modules)\//.test(f));
}

/** 주석을 걷는다(줄 주석 · 블록 주석 · JSX 주석). 문자열 속 '//'(주소)도 걷히지만 찾는 쪽이 줄기만 한다(놓치는 쪽 아님). */
function stripComments(src: string): string {
  return src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** 라우터 파일 → 주소 블록(방법 · 경로 · 본문 = 다음 주소 또는 맨 앞 칸 선언 직전까지 · 주소 사이 도우미 함수가 앞 주소 본문에 섞이지 않게 · 1024) */
interface RouteBlock { method: string; path: string; body: string; at: number }
const TOP_DECL = /\n(?:export\s+)?(?:async\s+)?function\s|\nconst\s|\nlet\s|\ninterface\s|\ntype\s/;
function routeBlocks(src: string): RouteBlock[] {
  const re = /\b(\w+)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  const hits: Array<{ at: number; method: string; path: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) hits.push({ at: m.index, method: m[2].toUpperCase(), path: m[3] });
  return hits.map((h, i) => {
    const raw = src.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : undefined);
    const cut = raw.search(TOP_DECL);
    return { ...h, body: cut > 0 ? raw.slice(0, cut) : raw };
  });
}
const key = (b: { method: string; path: string }) => `${b.method} ${b.path}`;

// ── R2 화면에만 있는 문 ─────────────────────────────────────────────
/** 돈 · 발송 효과(호출 이름 · 단어 경계) — 이 호출이 든 주소는 서버 요금제 문을 먼저 지난다 */
// ★ 2026-10-24 세 채널 구조체크 ⑦ — 발송 · 새로 켜기 효과(푸시 발송 · 인앱 변형 만들기 · 켜기)도 문 앞이어야 한다
const MONEY_CALL = /\b(checkCredit|deductCredit\w*|orchestrate|generateFromBuildMaterials|runPlannerBuild|approvePlannerEvent|approvePlannerPairTx|createDirectSendCampaign|sendEmailCampaign|publishDmCore|completeEmailCampaignCore|callAIWithFallback|generateMessages|prepaidDeduct|runInCreditBundle|chargeOrchestrate|sendPushCampaign|createVariant|setVariantStatus|activateInAppMessage)\(/;
/**
 * ★ 1024 돈 · AI 함수 기계 추적 — 원장 차감 · 잔액 확인 · AI 호출(묶음 밖이면 회사 크레딧) · 발송 생성을 부르는 함수와, 그것을 부르는 함수를 끝까지(유틸 · 서비스).
 *   옛 MONEY_CALL 손 목록은 주소 본문에 적힌 이름만 봐서 runLineCookOrder · generateInAppMessagePackage · updateOperator 같은 길을 놓쳤다.
 */
const MONEY_SEED = /\b(deductCredit\w*|checkCredit|settleCreditAfterSuccess|callAIWithFallback|prepaidDeduct|createDirectSendCampaign)\(/;
const DECL_RE = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/gm;
let moneyCache: RegExp | null = null;
function moneyCallRe(): RegExp {
  if (moneyCache) return moneyCache;
  const bodies = new Map<string, string>();
  for (const dir of ['utils', 'services']) {
    for (const rel of sourceFiles(join(BE, dir), /\.ts$/)) {
      const src = stripComments(be(`${dir}/${rel}`));
      const decls = Array.from(src.matchAll(DECL_RE));
      decls.forEach((m, i) => {
        const name = m[1] || m[2];
        const body = src.slice(m.index ?? 0, i + 1 < decls.length ? decls[i + 1].index : undefined);
        bodies.set(name, (bodies.get(name) || '') + body);
      });
    }
  }
  const money = new Set(Array.from(bodies.entries()).filter(([, b]) => MONEY_SEED.test(b)).map(([n]) => n));
  for (let changed = true; changed;) {
    changed = false;
    for (const [n, b] of bodies) {
      if (money.has(n)) continue;
      const calls = Array.from(b.matchAll(/\b(\w+)\(/g), (x) => x[1]);
      if (calls.some((c) => c !== n && money.has(c))) { money.add(n); changed = true; }
    }
  }
  moneyCache = new RegExp(`\\b(?:${Array.from(money).sort((a, b) => b.length - a.length).join('|')})\\(`);
  return moneyCache;
}
/**
 * 돈 · AI 함수에 닿지만 문을 걸지 않는 주소(이유 필수 · 늘리면 이유를 적는다 · CLAUDE.md root_ledger 2)
 *   끄기 · 멈추기 쪽은 CONTROL_ROUTE 가 따로 지킨다.
 */
const MONEY_ROUTE_EXEMPT: Record<string, string> = {
  'marketing-planner.ts POST /build-quote': '견적 = 금액 계산 · 잔액 읽기만(돈을 쓰지 않는다)',
  'marketing-planner.ts POST /events/:id/build-quote': '견적 = 금액 계산 · 잔액 읽기만(돈을 쓰지 않는다)',
  'marketing-planner.ts PUT /events/:id/copy': '고친 문안 다시 검사 · 우리 부담 AI(묶음 안 · 고객 차감 0) · 발송은 승인 · 실행 문이 지킨다',
  'marketing-planner.ts POST /touchpoints/:id/recheck/edit': '고친 문안 다시 검사 · 우리 부담 AI(묶음 안 · 고객 차감 0)',
  'marketing-planner.ts POST /touchpoints/:id/recheck/defer': '미루기 = 끄기 쪽(만료 뒤에도 연다)',
};

/** 서버 요금제 문(공용 CT 하나 · 문 도우미는 안에서 같은 함수를 부른다 — 아래 시험이 그 사실을 확인한다) · 도우미를 { plan: false } 로 부르면 문이 아니다 */
const PLAN_GATE = /\baiZonePlanBlocked\(|\b(?:journeyGate|operatorGate|ensureEmailAccess|ensureEmailAdmin)\((?![^)]*plan:\s*false)/;
/**
 * 끄기 · 멈추기 · 취소 · 지우기 주소(만료 뒤에도 열어 둔다 · Codex 1024 1R)
 * ★ 2026-10-24 세 채널 구조체크 ③ — 목록은 요금제 문(plan-guard PLAN_CONTROL_PATH)의 식을 그대로 읽는다(시험과 문이 다른 목록을 갖지 않게).
 */
const PLAN_CONTROL_SRC = (be('utils/plan-guard.ts').match(/export const PLAN_CONTROL_PATH = \/(.+)\/;\n/) || [])[1] || '';
const CONTROL_PATH_RE = new RegExp(PLAN_CONTROL_SRC);
const CONTROL_ROUTE = (b: { method: string; path: string }) => b.method === 'DELETE' || CONTROL_PATH_RE.test(b.path);
/** 문 도우미 → 정의가 있는 파일 */
const GATE_HELPERS: Record<string, string> = {
  journeyGate: 'utils/journey-route.ts', operatorGate: 'utils/operator-route.ts',
  ensureEmailAccess: 'routes/email.ts', ensureEmailAdmin: 'routes/email.ts',
};
/**
 * 화면 PlanGate 기능 → 그 화면의 서버 주소(라우터 · 경로 앞머리). 화면에 PlanGate 가 새로 생기면 여기 없어서 실패한다.
 * 공용 채널 라우터(dm · sns)는 라우터 전체가 기능 문(requirePlanFeature)을 지난다 — 아래 ROUTER_LEVEL_GATE.
 */
const PLAN_SCREEN_ROUTERS: Record<string, Array<{ file: string; prefix?: string }>> = {
  'connect-shop': [{ file: 'cdp.ts', prefix: '/inapp' }],
  'inapp-message': [{ file: 'cdp.ts', prefix: '/inapp' }, { file: 'ai.ts', prefix: '/one-line' }, { file: 'line-templates.ts' }],
  performance: [{ file: 'ai.ts', prefix: '/operator/performance' }],
  predictive: [{ file: 'ai.ts', prefix: '/operator/predictive' }],
  'auto-marketing': [{ file: 'ai.ts', prefix: '/operator/' }],
  journeys: [{ file: 'ai.ts', prefix: '/operator/journeys' }],
  'marketing-planner': [{ file: 'marketing-planner.ts' }],
  'image-studio': [{ file: 'image-studio.ts' }],
  'email-campaign': [{ file: 'email.ts' }, { file: 'ai.ts', prefix: '/one-line' }, { file: 'line-templates.ts' }],
  'ai-memory': [{ file: 'ai-memory.ts' }, { file: 'ai.ts', prefix: '/operator/memory' }],
  'quick-campaign': [{ file: 'dm.ts' }, { file: 'email.ts' }, { file: 'content-interview.ts' }],
  'mobile-dm': [{ file: 'dm.ts' }, { file: 'content-interview.ts' }, { file: 'ai.ts', prefix: '/one-line' }, { file: 'line-templates.ts' }],
  sns: [{ file: 'sns.ts' }],
  // ★ 2026-10-24 세 채널 구조체크 ⑦ — 푸시 발송 화면은 PlanGate 가 아니라 관리자 입구(PrivateRoute)지만 발송 효과라 같은 서버 문을 본다
  'push(관리자 화면 · PlanGate 없음)': [{ file: 'cdp.ts', prefix: '/push' }],
};
const ROUTER_LEVEL_GATE = /\.use\(\s*requirePlanFeature\(/;

describe('R2 화면에만 있는 문 — PlanGate 화면의 돈 · 발송 주소 = 서버 요금제 문', () => {
  it('화면 PlanGate 기능이 전부 표에 있다(새 PlanGate 화면 = 서버 주소를 등재해야 통과)', () => {
    const app = read(join(FE, 'App.tsx'));
    const ids = Array.from(new Set(Array.from(app.matchAll(/PlanGate featureId="([^"]+)"/g)).map((m) => m[1])));
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.filter((id) => !PLAN_SCREEN_ROUTERS[id])).toEqual([]);
  });
  it('돈 · 발송 · AI 함수에 닿는 주소는(유틸까지 따라가 뽑는다) 그 호출보다 먼저 서버 요금제 문을 지난다', () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    const traced = moneyCallRe();
    const usedExempt = new Set<string>();
    for (const list of Object.values(PLAN_SCREEN_ROUTERS)) {
      for (const { file, prefix } of list) {
        const src = stripComments(be(`routes/${file}`));
        if (ROUTER_LEVEL_GATE.test(src)) continue;
        for (const b of routeBlocks(src)) {
          if (prefix && !b.path.startsWith(prefix)) continue;
          const id = `${file} ${key(b)}`;
          if (seen.has(id)) continue;
          seen.add(id);
          if (CONTROL_ROUTE(b)) continue;
          const at = [b.body.search(MONEY_CALL), b.body.search(traced)].filter((x) => x >= 0);
          if (at.length === 0) continue;
          if (MONEY_ROUTE_EXEMPT[id]) { usedExempt.add(id); continue; }
          const gate = b.body.search(PLAN_GATE);
          if (gate < 0 || gate > Math.min(...at)) bad.push(id);
        }
      }
    }
    expect(bad).toEqual([]);
    // 면제 목록에 쓰지 않는 줄이 남으면(주소가 사라짐 · 문이 생김) 지운다 — 죽은 면제가 새 주소의 우회로가 되지 않게
    expect(Object.keys(MONEY_ROUTE_EXEMPT).filter((k) => !usedExempt.has(k))).toEqual([]);
  });
  it('끄기 목록 = 요금제 문이 쓰는 식 그대로(빈 식이면 시험이 아무것도 안 본다)', () => {
    expect(PLAN_CONTROL_SRC.length).toBeGreaterThan(20);
    expect(CONTROL_ROUTE({ method: 'POST', path: '/:id/stop' })).toBe(true);
    expect(CONTROL_ROUTE({ method: 'POST', path: '/:id/publish' })).toBe(false);
  });
  it('라우터 머리 문은 끄기 요청을 연다(except · 세 채널 구조체크 ③ — 옛: DM · SNS 머리 문이 중지 · 삭제 · 예약 취소까지 막았다)', () => {
    const bare: string[] = [];
    let heads = 0;
    for (const list of Object.values(PLAN_SCREEN_ROUTERS)) {
      for (const { file } of list) {
        const src = stripComments(be(`routes/${file}`));
        for (const m of src.matchAll(/\.use\(\s*requirePlanFeature\(([^)]*\))?[^;]*;/g)) {
          heads++;
          if (!/requirePlanFeature\(\s*'[^']+'\s*,\s*\{\s*except:\s*is(?:Plan|Dm)ControlRequest\s*\}\s*\)/.test(m[0])) bare.push(`${file}: ${m[0].slice(0, 90)}`);
        }
      }
    }
    expect(heads).toBeGreaterThanOrEqual(2);
    expect(Array.from(new Set(bare))).toEqual([]);
    // DM 끄기 판정은 공용 끄기 판정을 품는다(DM 만의 끄기 = A/B 종료 · 단축 링크 끄기)
    expect(be('utils/dm-access.ts')).toMatch(/export function isDmControlRequest[\s\S]*?return isPlanControlRequest\(req\)/);
    // 문이 except 를 맨 먼저 본다(요금제 조회 앞)
    const g = be('utils/plan-guard.ts');
    const f = g.slice(g.indexOf('export function requirePlanFeature('));
    expect(f.indexOf('if (opts?.except?.(req)) return next();')).toBeLessThan(f.indexOf('loadPlanContext('));
  });
  it('기계 추적이 살아 있다 — 한 줄 요리 · 인앱 AI · 자동 마케팅 고치기를 돈 함수로 본다', () => {
    const traced = moneyCallRe();
    for (const fn of ['runLineCookOrder(', 'runLineJudge(', 'generateInAppMessagePackage(', 'quickActionAIRefine(', 'explainInAppMessage(', 'updateOperator(', 'resumePlannerTouchpoint(', 'pickLineHeadlines(']) {
      expect(traced.test(fn), fn).toBe(true);
    }
    expect(traced.test('loadPlannerEvent(')).toBe(false);
  });
  it('끄기 · 멈추기 · 취소 · 지우기 주소는 요금제 문을 지나지 않는다(만료 뒤에도 고객이 멈출 수 있다)', () => {
    const bad: string[] = [];
    for (const list of Object.values(PLAN_SCREEN_ROUTERS)) {
      for (const { file, prefix } of list) {
        const src = stripComments(be(`routes/${file}`));
        for (const b of routeBlocks(src)) {
          if (prefix && !b.path.startsWith(prefix)) continue;
          if (CONTROL_ROUTE(b) && PLAN_GATE.test(b.body)) bad.push(`${file} ${key(b)}`);
        }
      }
    }
    expect(Array.from(new Set(bad))).toEqual([]);
  });
  it('본문으로 끄는 주소(자동 재진입 · 옵션) = 끄기일 때만 문을 연다 · 메일 도우미의 요금제 판정 전체가 plan 표시 아래(Codex 1024 2R)', async () => {
    const ai = stripComments(be('routes/ai.ts'));
    expect(ai).toContain("const gate = await journeyGate(req, res, { plan: !!req.body?.enabled });");
    expect(ai).toContain('const gate = await journeyGate(req, res, { plan: !journeyOptionsOffOnly(req.body) });');
    // 자동 마케팅 고치기 = 꺼진 것을 다시 켤 때만 문(저장된 상태와 대조 · 한 줄 CT 구조체크 ② · Codex 1R)
    expect(ai).toContain('const gate = await operatorGate(req, res, { plan: reactivating });');
    expect(ai).toContain('await isOperatorReactivation(req.user.companyId, String(req.params.id), req.body?.status).catch(() => true)');
    // 판정 뒤 정지가 끼어도 저장 한 문장이 다시 켜지 않는다(Codex 2R) — 요금제 문을 지난 요청만 allowReactivate
    expect(ai).toContain('allowReactivate: reactivating,');
    expect(be('utils/continuous-operator.ts')).toContain(`: "status = CASE WHEN status <> 'active' AND $7::text = 'active' THEN status ELSE COALESCE($7::text, status) END,"}`);
    const { journeyOptionsOffOnly } = await import('../journey-route');
    expect(journeyOptionsOffOnly({ autoReentryEnabled: false })).toBe(true);
    expect(journeyOptionsOffOnly({ autoReentryEnabled: false, dryRun: true })).toBe(true);
    expect(journeyOptionsOffOnly({ autoReentryEnabled: true })).toBe(false);
    expect(journeyOptionsOffOnly({ autoReentryEnabled: false, goalKind: 'product' })).toBe(false);
    expect(journeyOptionsOffOnly({})).toBe(false);
    const email = stripComments(be('routes/email.ts'));
    for (const name of ['ensureEmailAdmin', 'ensureEmailAccess']) {
      const at = email.indexOf(`async function ${name}(`);
      const body = email.slice(at, email.indexOf('\n}\n', at));
      expect(body.indexOf('if (opts.plan) {'), name).toBeGreaterThan(-1);
      expect(body.indexOf('if (opts.plan) {'), name).toBeLessThan(body.indexOf('isCdpEnabledForPlan('));
    }
  });
  it('공용 서버 문은 요금제 조회 실패도 스스로 응답한다(호출부가 try 밖이어도 매달리지 않게)', () => {
    const src = stripComments(be('utils/plan-guard.ts'));
    const at = src.indexOf('export async function aiZonePlanBlocked(');
    expect(src.slice(at, src.indexOf('\n}\n', at))).toMatch(/try \{\s*plan = ctx === undefined \? await loadPlanContext\(companyId\) : ctx;\s*\} catch/);
  });
  it('문 도우미는 안에서 공용 서버 문(aiZonePlanBlocked)을 지난다', () => {
    for (const [name, rel] of Object.entries(GATE_HELPERS)) {
      const src = stripComments(be(rel));
      const at = src.search(new RegExp(`async function ${name}\\(`));
      expect(at, name).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf('\n}\n', at));
      expect(body, name).toMatch(/\baiZonePlanBlocked\(/);
    }
  });
  it('요금제 판정은 공용 CT 한 곳 — 라우터 · 문 함수가 isAiOperatorAllowed 를 따로 부르지 않는다(세 벌 → 한 벌)', () => {
    const owners = new Set(['utils/plan-guard.ts']);
    const routeAccess = (rel: string, src: string) => rel === 'routes/ai.ts' && /router\.get\('\/operator\/access'/.test(src);
    const bad = sourceFiles(BE, /\.ts$/)
      .filter((rel) => !owners.has(rel))
      .filter((rel) => {
        const src = stripComments(be(rel));
        if (!/\bisAiOperatorAllowed\(/.test(src)) return false;
        // 화면이 묻는 진입 판정 주소(/operator/access)와 그 판정 전용 응답은 판정 CT 를 그대로 부른다
        const outside = src.replace(/router\.get\('\/operator\/access'[\s\S]*?\n\}\);/, '');
        return routeAccess(rel, src) ? /\bisAiOperatorAllowed\(/.test(outside) : true;
      });
    expect(bad).toEqual([]);
  });
});

// ── R3 사용자 범위 ───────────────────────────────────────────────────
/** 플래너 주소 중 주인 범위가 필요 없는 것(사유) — 그 밖은 resolveOwnerScope 를 지난다 */
const PLANNER_SCOPE_EXEMPT: Record<string, string> = {
  'GET /participate/:token': '고객 참여 착지(토큰 · 인증 전)',
  'GET /approval/:token': '옛 결재 링크 착지(토큰 · 인증 전 · 달만 정한다)',
  'POST /confirm-view': '휴대폰 확인 화면(토큰 · 인증 전 · 읽기 전용)',
  'GET /availability': '회사 채널 준비 판정(주인 없는 회사 자원)',
  'POST /line-read': '한 줄 읽기(순수 · DB 0)',
  'GET /audience/products': '회사 상품 목록(주인 없는 회사 자원)',
  'POST /build-quote': '저장 전 견적(행사 없음 · 차감 0)',
  'POST /line-start': '새 행사 만들기(주인 = 요청 계정)',
};
describe('R3 사용자 범위 — 플래너 주소 = 관리자 전체 · 담당자 자기 것', () => {
  it('플래너 모든 주소가 주인 범위를 지나거나 사유가 있다', () => {
    const src = stripComments(be('routes/marketing-planner.ts'));
    // saveEvent = 같은 파일의 저장 도우미(안에서 resolveOwnerScope · 아래 단언이 그 사실을 확인한다)
    const bad = routeBlocks(src).filter((b) => !PLANNER_SCOPE_EXEMPT[key(b)] && !/\bresolveOwnerScope\(|\brecheckActor\(|\bvoid saveEvent\(/.test(b.body)).map(key);
    const helper = src.slice(src.indexOf('async function saveEvent('), src.indexOf('async function saveEvent(') + 2500);
    expect(helper).toContain('ownerId: resolveOwnerScope(req)');
    expect(bad).toEqual([]);
  });
  it('이달 결과 집계는 주인 범위를 받는다(관리자 = 회사 전체)', () => {
    const r = be('utils/planner-report.ts');
    expect(r).toMatch(/export async function loadMonthlyResult\(companyId: string, planMonth: string, ownerId: string \| null\)/);
    expect(r).toContain('created_by::text = $3::text');
  });
});

// ── R4 효과 뒤 비엄격 차감 ───────────────────────────────────────────
describe('R4 효과 뒤 비엄격 차감 — 발송 크레딧 = 보내기 전 엄격하게 잡는다', () => {
  /** 상수 이름 → 값(export const X = 'v') */
  const constants = new Map<string, string>();
  for (const rel of sourceFiles(BE, /\.ts$/)) {
    for (const m of be(rel).matchAll(/export const (\w+)\s*=\s*'([^']+)'/g)) constants.set(m[1], m[2]);
  }
  const sourceOf = (call: string): string | null => {
    const m = call.match(/\bsource:\s*(?:'([^']+)'|(\w+))/);
    if (!m) return null;
    return m[1] ?? constants.get(m[2]) ?? null;
  };
  const calls = (src: string, fn: string) => Array.from(src.matchAll(new RegExp(`\\b${fn}\\(\\s*(?:\\w+\\s*,\\s*)?\\{[\\s\\S]*?\\}\\s*(?:,\\s*[^)]*)?\\)`, 'g'))).map((m) => m[0]);

  it('SEND_CREDIT_SOURCES 가 발송 크레딧 source 의 유일한 목록이다', async () => {
    const { SEND_CREDIT_SOURCES } = await import('../ai-credit-calc');
    expect([...SEND_CREDIT_SOURCES].sort()).toEqual(['continuous-operator-send', 'journey-operation', 'planner-touchpoint-send']);
  });
  it('발송 크레딧을 비엄격(deductCreditSafe)으로 걷는 파일은 같은 source 를 보내기 전에 엄격하게 잡는다', async () => {
    const { SEND_CREDIT_SOURCES } = await import('../ai-credit-calc');
    const bad: string[] = [];
    for (const rel of sourceFiles(BE, /\.ts$/)) {
      const src = stripComments(be(rel));
      if (!/\bdeductCreditSafe\(/.test(src)) continue;
      for (const c of calls(src, 'deductCreditSafe')) {
        const s = sourceOf(c);
        if (!s || !SEND_CREDIT_SOURCES.has(s)) continue;
        const strict = calls(src, 'deductCreditOutcome').some((x) => sourceOf(x) === s && /throwOnInsufficient:\s*true/.test(x))
          || calls(src, '_deductWithClient').some((x) => sourceOf(x) === s);
        if (!strict) bad.push(`${rel} ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('플래너 미발송 되돌림은 시도 기록이 그 묶음을 들고 있는 동안(보내는 중 · 보낸 여부 모름) 되돌리지 않는다(상태 무관 · Codex 1024 1R)', () => {
    const x = be('utils/planner-executor.ts');
    const fn = x.slice(x.indexOf('export async function releaseUnsentPlannerSendCharges('));
    expect(fn).toContain("AND p.exec_meta ? 'send_started_at' AND p.exec_meta->>'staging_id' = split_part(t.idempotency_key, ':', 3))");
    expect(fn.slice(0, fn.indexOf('LIMIT 20'))).not.toMatch(/p\.status = 'producing'/);
  });
});

// ── R5 본 것 ≠ 나가는 것 ─────────────────────────────────────────────
describe('R5 본 것 ≠ 나가는 것 — 사람 승인 지문이 회신번호 · 080 까지 덮는다', () => {
  it('자동마케팅 = 지문 한 함수에 회신번호 · 080', () => {
    const f = be('utils/operator-final-copy.ts');
    expect(f).toMatch(/export function copyFingerprint\(p: \{ callback: string; opt080: string; msgType: string; subject: string; body: string \}\)/);
  });
  it('플래너 = 승인 때 번호를 각인하고 발송 직전에 같은 함수로 대조한다(각인 없는 옛 승인 = 통과)', () => {
    const c = be('utils/planner-confirm.ts');
    expect(c).toContain('export async function plannerSendNumbers(');
    expect(c).toContain('export function plannerNumbersMatch(');
    const a = be('utils/planner-approve.ts');
    expect(a).toContain('const numbers = await plannerSendNumbers(ev.companyId, ev.createdBy);');
    expect(a).toContain('const stampNumbers = { numbers };');
    const x = be('utils/planner-executor.ts');
    expect(x).toContain('plannerNumbersMatch(');
  });
  it('화면이 본 지문에 번호가 든다 — 확인 화면 · 승인 · 쌍 재확인이 한 번 읽은 같은 번호로 대조하고 각인한다(Codex 1024 1R)', () => {
    expect(be('utils/planner-confirm.ts')).toContain('const fingerprint = eventFingerprint(ev, fps, plannerNumbersOf(sendNo));');
    expect(be('utils/planner-approve.ts')).toContain('if (eventFingerprint(ev, fps, numbers) !== String(input.seenHash');
    const r = be('utils/planner-recheck.ts');
    expect(r).toContain('seen: `${c}:${d || \'\'}:${p.recheck.round}:${numbers.cb}:${numbers.o80}`');
    expect(r.match(/pairHashFor\(p, \w+\)/g) ?? []).toEqual([]);
    // 번호는 한 번 읽어 그리기(080) · 지문 · 대조 · 발송에 같은 값(Codex 1024 2R) — 숫자 꼴 규칙도 한 곳
    const c = be('utils/planner-confirm.ts');
    expect(c).toContain('Promise.resolve(sendNo.opt080),');
    expect(c).not.toMatch(/getOpt080Number\(ev\.createdBy/);
    expect(r).toContain('const numbers = plannerNumbersOf(sendNo);');
    expect(r).toContain('const opt080 = sendNo.opt080;');
    const x = stripComments(be('utils/planner-executor.ts'));
    expect(x).toContain('const sendNo = await plannerSendNumberTexts(tp.companyId, tp.createdBy);');
    expect(x).toContain('const nowNumbers = plannerNumbersOf(sendNo);');
  });
  it('플래너 한 줄 = 화면이 본 질문 창과 담을 때 다시 만든 창이 같아야 저장한다(다르면 409 다시 묻기 · 답을 조용히 버리지 않음)', () => {
    const route = be('routes/marketing-planner.ts');
    const start = route.slice(route.indexOf("router.post('/line-start'"));
    expect(start).toContain("if (String(req.body?.askKey || '') !== ask.askKey) {");
    expect(start.indexOf('ask.askKey')).toBeLessThan(start.indexOf('plannerLineEventBody('));
  });
});

// ── R6 닫히지 않는 상태 ──────────────────────────────────────────────
describe('R6 닫히지 않는 상태 — 지난 날의 보류 · 잠금(발송 시도 없음)도 닫는다', () => {
  it('놓친 실행 정리가 planned · ready · hold_credit · locked 를 본다 · 보냈는지 모르는 행은 사람 판정으로 남긴다', () => {
    const r = be('utils/planner-reconcile.ts');
    expect(r).toContain("statuses: ['planned', 'ready', 'hold_credit', 'locked']");
    expect(r).toContain('if (tp.execMeta?.send_started_at && !tp.execRef) continue;');
  });
});

// ── R7 판정 못 함을 반대로 읽음 ─────────────────────────────────────
describe('R7 판정 못 함을 반대로 읽음 — 스팸 검사 결과는 공용 판정으로만 읽는다', () => {
  it('검사 함수를 부르는 파일은 결과를 spamVerdictOf 로 읽는다(「차단이 아니면 통과」 0)', () => {
    const bad: string[] = [];
    for (const rel of sourceFiles(BE, /\.ts$/)) {
      if (rel === 'utils/spam-test-queue.ts') continue;
      const src = stripComments(be(rel));
      if (/spamResult\s*!==\s*['"]blocked['"]/.test(src)) bad.push(`${rel} 「!== blocked」`);
      if (/\bautoSpamTestWithRegenerate\(/.test(src) && !/\bspamVerdictOf\(/.test(src)) bad.push(`${rel} 공용 판정 없음`);
    }
    expect(bad).toEqual([]);
  });
  it('검사 큐가 통신사 결과가 빈 「완료」를 통과로 넘기지 않는다(판정 자리 한 곳)', () => {
    const q = be('utils/spam-test-queue.ts');
    expect(q).toContain('export function spamVerdictOf(');
    expect(q).toContain('const settled = spamVerdictOf(');
  });
  it('대행 발송 검사 단계가 던진 예외도 검사 장애(같은 기록 · 대기 · 상한 · Codex 1024 1R)', () => {
    const w = stripComments(be('utils/agency-send-worker.ts'));
    const fn = w.slice(w.indexOf('async function runSpamRound('), w.indexOf('async function settleSpamCheckError('));
    expect(fn).toMatch(/\} catch \(err: any\) \{[\s\S]*?return \{ verdict: 'error', passed: false, finalContent: original, rounds, detail \};/);
  });
});

// ── R8 상한 없는 재시도 ──────────────────────────────────────────────
describe('R8 상한 없는 재시도 — 플래너 문안 자동 재생성 상한 · 거름은 LIMIT 앞', () => {
  it('문안 패스 후보 SQL 이 상한에 닿은 행사를 LIMIT 앞에서 뺀다', () => {
    const c = be('utils/planner-copy.ts');
    const pass = c.slice(c.indexOf('export async function runPlannerCopyPass('));
    expect(pass).toContain("COALESCE((meta->'copyFailures'->>'count')::int, 0) < $");
    expect(pass.indexOf('copyFailures')).toBeLessThan(pass.indexOf('LIMIT $'));
  });
});

// ── R9 한 줄 + 모자란 것만 질문 ─────────────────────────────────────
/** 공용 묻기 경로를 **쓰는** 꼴(부르기 · 그리기 — 정의 · 가져오기만으로는 통과하지 않는다) */
const ASK_PATH = /\bfetchOneLineGaps\(|\buseLineAsk\(|\blineAsk\.route\(|<ZoneQuestion\b|<InterviewModal\b|<OperatorPreviewModal\b/;
/** 기능별로 더 인정하는 묻기 경로 — 만들기 = 재료 판(엔진 견적의 모자란 재료를 그 자리에서 받는다 · 1022 한줄 CT 재료 판) */
const ASK_PATH_EXTRA: Record<string, RegExp> = { make: /\bquote\.gate\.missing\b|\bgate\.missing\b/ };
describe('R9 한 줄 + 모자란 것만 질문 — 한 줄 입구가 있는 기능은 공용 묻기 경로를 지난다', () => {
  const modules = read(join(FE, 'constants', 'ai-operator-modules.ts'));
  const ids = Array.from(modules.matchAll(/id: '([\w-]+)',\s*\n\s*oneLine:/g)).map((m) => m[1]);
  const pages = sourceFiles(FE, /\.tsx$/).filter((f) => f.startsWith('pages/'));
  /** 화면 + 그 화면이 같은 저장소에서 가져오는 부품(한 단계) */
  const withImports = (rel: string) => {
    const src = read(join(FE, rel));
    const dir = rel.split('/').slice(0, -1).join('/');
    // 부품(components/)만 따라간다 — 공용 모듈(utils/)은 묻기 함수를 **정의**하는 곳이라 따라가면 쓰지 않는 화면도 통과한다
    const deps = Array.from(src.matchAll(/from '(\.{1,2}\/[^']*components\/[^']+)'/g)).map((m) => m[1]);
    const parts = deps.flatMap((d) => {
      const base = join(FE, dir, d);
      for (const ext of ['.tsx', '.ts', '/index.tsx']) { try { return [read(base + ext)]; } catch { /* 다음 */ } }
      return [];
    });
    return [src, ...parts].join('\n');
  };
  it('한 줄 입구 기능을 찾았다(표 없이 소스에서)', () => {
    expect(ids).toEqual(expect.arrayContaining(['journeys', 'auto-marketing', 'planner', 'dm', 'email']));
  });
  for (const id of ['journeys', 'auto-marketing', 'planner', 'dm', 'email', 'inapp', 'make', 'sns']) {
    it(`${id} — 한 줄 입구 화면이 공용 묻기 경로를 지난다`, () => {
      expect(ids).toContain(id);
      // 한 줄 입구를 그리는 화면 = 그 기능의 oneLine 설정을 읽는 화면(같은 기능 다른 화면 · 허브가 묻기 경로를 가져도 이 화면 대신이 되지 않는다)
      const owners = pages.filter((p) => new RegExp(`zoneModule\\('${id}'\\)[^;\\n]*\\.oneLine|${id.replace(/-/g, '')}OneLine|oneLine.*zoneModule\\('${id}'\\)`).test(read(join(FE, p)))
        || (new RegExp(`zoneModule\\('${id}'\\)`).test(read(join(FE, p))) && /\.oneLine\b/.test(read(join(FE, p)))));
      expect(owners.length).toBeGreaterThan(0);
      expect(owners.every((p) => {
        const src = stripComments(withImports(p));
        return ASK_PATH.test(src) || !!ASK_PATH_EXTRA[id]?.test(src);
      })).toBe(true);
    });
  }
  it('플래너 한 줄 읽기는 공용 듣기 CT(listenLine)를 부른다', () => {
    expect(be('utils/planner-line-read.ts')).toMatch(/import \{[^}]*\blistenLine\b[^}]*\} from '\.\/one-line-ct\/listen'/);
  });
});

// ── R1 규칙은 CT 에 · 라우트는 부르기만(점검 시험 · 나머지는 docs/ROOT-LEDGER.md 점검표) ──────────
describe('R1 라우트는 부르기만 — 플래너 라우터에 쓰기 SQL 0', () => {
  it('한 줄 입구 라우트는 혜택 빈칸 판정을 직접 부르지 않는다(듣기 CT listenLine 하나 · 1024 한 줄 CT 구조체크 ⑥)', () => {
    const bad = sourceFiles(join(BE, 'routes'), /\.ts$/).filter((rel) => /\boneLineGaps\(/.test(stripComments(be(`routes/${rel}`))));
    expect(bad).toEqual([]);
  });
  it('한 줄 시도 잠금 키 = 세 채널 한 함수(라우트 안 글자 0 · ⑤)', () => {
    const routes = sourceFiles(join(BE, 'routes'), /\.ts$/).map((rel) => stripComments(be(`routes/${rel}`))).join('\n');
    expect(routes).not.toMatch(/['"`]oneline(?:-steps)?:\$\{/);
    for (const ch of ['dm', 'email', 'inapp']) expect(routes).toMatch(new RegExp(`oneLineInflightKey\\([^)]*'${ch}'`));
  });
  it('구성 고르기 목록의 필요 칸 = 채널 칸 규칙 한 곳(⑦)', async () => {
    const { compositionCatalog } = await import('../one-line-ct/catalog');
    const { LINE_COMPOSITIONS, compositionChannelSlots } = await import('../line-compositions');
    for (const c of LINE_COMPOSITIONS) {
      const row = compositionCatalog().find((r) => r.id === c.id)!;
      for (const ch of ['dm', 'email', 'inapp'] as const) {
        expect(row.needs.products.max[ch], `${c.id} ${ch}`).toBe(compositionChannelSlots(c, ch).find((s) => s.key === 'products')?.max ?? 0);
      }
    }
  });
  it('marketing-planner 라우터는 INSERT · UPDATE · DELETE 를 직접 쓰지 않는다(쓰기 = planner-* CT)', () => {
    const src = stripComments(be('routes/marketing-planner.ts'));
    expect(src.match(/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/gi) ?? []).toEqual([]);
  });
});

// ── R10 내부 오류 원문 노출 ──────────────────────────────────────────
/** 고객이 보지 않는 라우터(슈퍼관리자 · 정산 · 내부) */
const STAFF_ROUTERS = new Set(['admin.ts', 'billing.ts', 'admin-sync.ts', 'login-blocks.ts', 'admin-ops-records.ts', 'marketing-diagnosis-admin.ts', 'plan-term-admin.ts', 'internal-alert.ts', 'sales-outreach.ts']);
describe('R10 내부 오류 원문 노출 — 고객 쪽 5xx 응답에 오류 원문 0', () => {
  it('고객 쪽 라우터의 5xx 응답(json · send = HTML 안내 포함)에 잡은 오류의 원문(.message)이 없다(공용 publicErrorText 를 쓴다)', () => {
    const bad: string[] = [];
    for (const rel of sourceFiles(join(BE, 'routes'), /\.ts$/)) {
      if (STAFF_ROUTERS.has(rel)) continue;
      const src = stripComments(be(`routes/${rel}`));
      // 잡은 오류 이름(catch (err) · .catch((e) => …)) · 5xx 를 담은 상태 변수(const status = … ? 400 : 500)
      const caught = new Set([...src.matchAll(/catch\s*\(\s*(\w+)/g), ...src.matchAll(/\.catch\(\s*(?:async\s*)?\(?\s*(\w+)/g)].map((m) => m[1]));
      const fiveIds = new Set([...src.matchAll(/\b(?:const|let)\s+(\w+)\s*=[^;]*?\b5\d\d\b[^;]*;/g)].map((m) => m[1]));
      if (caught.size === 0) continue;
      const alt = [...caught].join('|');
      const rawSrc = `(?:\\b(?:${alt})\\s*\\??|\\(\\s*(?:${alt})\\s+as\\s+\\w+\\s*\\)\\s*\\??)\\.message\\b`;
      const raw = new RegExp(rawSrc);
      // 별칭 — 원문을 변수에 담아 싣는 꼴(const msg = err.message → error: msg) · 판정에만 쓰는 값(.includes 등)은 제외
      const aliases = [...src.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(\\w+)\\s*(?::\\s*\\w+\\s*)?=[^;\\n]*?${rawSrc}[^;\\n]*;`, 'g'))]
        .filter((m) => !/\.(?:includes|test|startsWith|match)\(/.test(m[0])).map((m) => m[1]);
      const aliasUse = aliases.length > 0 ? new RegExp(`(?<![.\\w])(?:${aliases.join('|')})\\b(?!\\s*\\??\\.(?:includes|test|startsWith|match)\\b)`) : null;
      for (const m of src.matchAll(/\.status\(\s*([^;{}]*?)\s*\)\s*\.(?:json|send)\(([\s\S]*?)\)\s*;/g)) {
        const five = /\b5\d\d\b/.test(m[1]) || fiveIds.has(m[1].trim());
        if (five && (raw.test(m[2]) || aliasUse?.test(m[2]))) bad.push(`${rel}: ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('잡은 오류를 4xx 로 돌려줄 때도 오류 종류를 확인한 갈래에서만 원문(.message)을 싣는다 · 배열에 담아 싣는 꼴도 0(세 채널 구조체크 ⑩)', () => {
    const bad: string[] = [];
    for (const rel of sourceFiles(join(BE, 'routes'), /\.ts$/)) {
      if (STAFF_ROUTERS.has(rel)) continue;
      const src = stripComments(be(`routes/${rel}`));
      for (const c of src.matchAll(/catch\s*\(\s*(\w+)[^)]*\)\s*\{/g)) {
        const v = c[1];
        let i = (c.index ?? 0) + c[0].length;
        let d = 1;
        while (i < src.length && d > 0) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
        const body = src.slice((c.index ?? 0) + c[0].length, i - 1);
        const raw = new RegExp(`\\b${v}\\s*\\??\\.message\\b`);
        // 배열 · 목록에 원문을 담는 꼴(나중에 응답에 실린다)
        if (new RegExp(`\\.push\\(\\{[^}]*\\berror:\\s*${v}\\s*\\??\\.message`).test(body)) bad.push(`${rel}: push(${v}.message)`);
        for (const m of body.matchAll(/\.status\(\s*([^;{}]*?)\s*\)\s*\.(?:json|send)\(([\s\S]*?)\)\s*;/g)) {
          if (!/\b4\d\d\b|httpStatus|\.status\b/.test(m[1]) || !raw.test(m[2])) continue;
          // 바로 앞 if 가 오류 종류(instanceof · .code · .name · .status · 판정 함수)를 보고, 그 if 의 몸통 안이어야 한다
          const before = body.slice(0, m.index ?? 0);
          const lastIf = before.lastIndexOf('if (');
          const tail = lastIf >= 0 ? before.slice(lastIf) : '';
          const condEnd = (() => { let k = 3, dd = 0; for (; k < tail.length; k++) { if (tail[k] === '(') dd++; else if (tail[k] === ')') { dd--; if (dd === 0) return k + 1; } } return -1; })();
          const cond = condEnd > 0 ? tail.slice(0, condEnd) : '';
          const after = condEnd > 0 ? tail.slice(condEnd) : '';
          const typed = /instanceof|\.code\b|\.name\b|\.status\b|\bis\w+\(|includes\(/.test(cond);
          const opens = (after.match(/\{/g) || []).length;
          const closes = (after.match(/\}/g) || []).length;
          const inside = after.trimStart().startsWith('{') ? opens > closes : !after.includes(';');
          if (!(typed && inside)) bad.push(`${rel}: ${m[0].replace(/\s+/g, ' ').slice(0, 90)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
  it('공용 응답 CT — 원문은 로그 · 고객에게는 허용 꼴(우리가 쓴 한국어 문장)만', async () => {
    const { publicErrorText } = await import('../http-error');
    expect(publicErrorText(new Error('column "x" does not exist'), '불러오지 못했어요')).toBe('불러오지 못했어요');
    expect(publicErrorText(new Error('Invalid login: 535 5.7.8'), 'SMTP 설정을 확인해 주세요')).toBe('SMTP 설정을 확인해 주세요');
    expect(publicErrorText(new Error('발신번호를 먼저 등록해 주세요.'), '실패')).toBe('발신번호를 먼저 등록해 주세요.');
    expect(publicErrorText(new Error('모바일 DM을 찾을 수 없습니다.'), '실패')).toBe('모바일 DM을 찾을 수 없습니다.');
    expect(publicErrorText(null, '실패')).toBe('실패');
    // 우리 안내 문장의 파일 · 통신사 낱말은 지나가고, 설정 이름 · 모델 공급사 원문은 막힌다
    expect(publicErrorText(new Error('이미지 파일 (jpg/png/gif/webp)만 업로드 가능합니다.'), '실패')).toBe('이미지 파일 (jpg/png/gif/webp)만 업로드 가능합니다.');
    expect(publicErrorText(new Error('AI 매핑 호출 실패: ANTHROPIC_API_KEY 미설정'), '맞추지 못했어요')).toBe('맞추지 못했어요');
    expect(publicErrorText(new Error('GODO_PARTNER_KEY 환경변수가 설정되지 않았습니다.'), '연동 문제')).toBe('연동 문제');
  });
});

// ── R11 화면 하한 ────────────────────────────────────────────────────
describe('R11 화면 하한 — 출처 줄 0 · native dialog 0 · 모델명 0(화면 전수)', () => {
  const files = sourceFiles(FE, /\.tsx$/);
  it('출처(Data source) 줄을 그리지 않는다', () => {
    const bad = files.filter((f) => {
      const src = stripComments(read(join(FE, f)));
      return /\{[^{}]*\bdataSource\s*\}/.test(src) || /(출처\s*[:：]|Data source)/.test(src);
    });
    expect(bad).toEqual([]);
  });
  it('native dialog(alert · confirm · prompt)를 부르지 않는다', () => {
    const bad = files.filter((f) => {
      const src = stripComments(read(join(FE, f)));
      const local = new Set(Array.from(src.matchAll(/\b(?:const|let|function)\s+(alert|confirm|prompt)\b/g)).map((m) => m[1]));
      return Array.from(src.matchAll(/(?<![.\w$])(?:window\.)?(alert|confirm|prompt)\s*\(/g)).some((m) => !local.has(m[1]) || /window\./.test(m[0]));
    });
    expect(bad).toEqual([]);
  });
  it('모델명을 화면 글로 내보내지 않는다', () => {
    const bad = files.filter((f) => /['"`>][^'"`<>]*\b(Opus|Sonnet|Haiku|Claude|Anthropic)\b[^'"`<>]*['"`<]/.test(stripComments(read(join(FE, f)))));
    expect(bad).toEqual([]);
  });
});

// ── R13 고객 글 생산자 출구 = 혜택 · 숫자 · 효능 거름 짝(★ 2026-10-24 세 채널 구조체크 ② · 설계서 docs/2026-10-24-efficacy-guard-design.md §7) ──
//   옛: 효능 판정은 문자 생성 · 한 줄 CT 에만 걸려 DM · 이메일 · 인앱 · AI 영업 · 형제 생산자 출구는 효능을 거르지 않았다(혜택 · 숫자만).
//   대상은 소스에서 기계로 뽑는다(함수 단위 · 라우터는 파일 단위) · 면제 = 이유 필수 · 낡은 면제 = 실패.
const EFFICACY_CT = ['claimsEfficacy', 'claimsInventedEfficacy', 'dropInventedEfficacy\\w*', 'pairClaimsInventedEfficacy', 'rewriteAddsFacts', 'headlineClaimsEfficacy', 'guardReadingSequence'];
const BENEFIT_CT = ['findInventedBenefits', 'replaceInventedBenefits\\w*', 'copyFactsExistInText', 'stripUnauthorizedBenefits', 'findNewNumbers'];
interface FnUnit { key: string; file: string; name: string | null; body: string; start: number; end: number }
const RAW_AI_RE = /\bcallAIWithFallback\(|\bmessages(?:\s+as\s+any\))?\.(?:batches\.)?create\(/;
const RAW_AI_CALLEE_RE = /^(?:callAIWithFallback|.*\bmessages(?:\s+as\s+any\))?\)?\.(?:batches\.)?create)$/;
/**
 * ★ 1024 ② Codex 1R — 단위 = **구문 트리**로 뽑는다(정규식 선언 자르기는 클래스 메서드 · 이름 없는 기본 내보내기를 앞 함수에 섞었고 라우터는 파일째였다).
 *   이름 있는 함수 · 변수에 담은 함수 · 클래스 메서드 · 객체 속성 함수 · 기본 내보내기 · 라우터 주소 처리기(파일:방법 경로).
 * ★ Codex 2R — 단위의 글 = **자기 몸통**(안쪽 단위의 글을 뺀다). 안쪽 함수의 검사 · AI 호출이 바깥 단위를 통과시키지 않고,
 *   AI 호출은 그것을 품은 가장 안쪽 단위에 귀속한다. 인자로 넘긴 이름 없는 콜백은 그 자리에서 도는 바깥 단위의 몸통이다.
 */
type ImportMap = Map<string, { file: string; name: string }>;
/** 상대 경로 import → 파일 키(utils/x.ts · 폴더면 index.ts) */
function importTarget(file: string, spec: string): string {
  const parts = file.split('/').slice(0, -1);
  for (const seg of spec.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');   // 확장자 없는 키 · resolve 가 .ts · /index.ts 를 붙여 찾는다
}
function unitsOfSource(file: string, text: string): { units: FnUnit[]; aiCalls: number[]; wrapperRefs: Array<{ name: string; pos: number }>; imports: ImportMap } {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const units: FnUnit[] = [];
  const aiCalls: number[] = [];
  const wrapperRefs: Array<{ name: string; pos: number }> = [];
  const imports: ImportMap = new Map();
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const push = (key: string, name: string | null, node: ts.Node) => units.push({ key: `${file}#${key}`, file, name, body: '', start: node.getStart(sf), end: node.getEnd() });
  const isFn = (n: ts.Node | undefined): boolean => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  const visit = (node: ts.Node): void => {
    // ★ Codex 4R — import 바인딩(별칭 포함 · 상대 경로만 · 이름 풀이가 실제 바인딩을 따른다)
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')
      && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const target = importTarget(file, node.moduleSpecifier.text);
      for (const el of node.importClause.namedBindings.elements) imports.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text });
    }
    if (ts.isFunctionDeclaration(node) && node.body) push(node.name ? node.name.text : `default@${lineOf(node)}`, node.name ? node.name.text : null, node);
    else if ((ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node)) && node.body) {
      const owner = ts.isClassLike(node.parent) && node.parent.name ? node.parent.name.text : `object@${lineOf(node)}`;
      push(`${owner}.${node.name.getText(sf)}`, node.name.getText(sf), node);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFn(node.initializer)) push(node.name.text, node.name.text, node);
    else if (ts.isPropertyAssignment(node) && isFn(node.initializer) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) push(`${node.name.text}@${lineOf(node)}`, node.name.text, node);
    else if (ts.isExportAssignment(node) && isFn(node.expression)) push(`default@${lineOf(node)}`, null, node);
    else if (file.startsWith('routes/') && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && /^(get|post|put|patch|delete)$/.test(node.expression.name.text) && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0])) {
      push(`${node.expression.name.text.toUpperCase()} ${node.arguments[0].text}`, null, node);
    }
    if (ts.isCallExpression(node) && RAW_AI_CALLEE_RE.test(node.expression.getText(sf).replace(/\s+/g, ' '))) aiCalls.push(node.getStart(sf));
    // 래퍼 참조(부르기 · 값으로 넘기기) 후보 — 선언 이름 · import · export · 타입 자리는 아니다(래퍼 집합과는 scanSources 가 대조)
    if (ts.isIdentifier(node) && /^call[A-Z]\w*$/.test(node.text)
      && !(ts.isFunctionDeclaration(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isImportSpecifier(node.parent) || ts.isExportSpecifier(node.parent) || ts.isTypeQueryNode(node.parent))) {
      wrapperRefs.push({ name: node.text, pos: node.getStart(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // 자기 몸통 = 제 범위에서 안쪽 단위 범위를 뺀 글(겹친 범위는 합친다)
  for (const u of units) {
    const inner = units.filter((o) => o !== u && o.start >= u.start && o.end <= u.end && (o.start > u.start || o.end < u.end)).sort((a, b) => a.start - b.start);
    let pos = u.start;
    let own = '';
    for (const o of inner) {
      if (o.start < pos) { pos = Math.max(pos, o.end); continue; }
      own += text.slice(pos, o.start);
      pos = o.end;
    }
    own += text.slice(pos, u.end);
    u.body = stripComments(own);
  }
  return { units, aiCalls, wrapperRefs, imports };
}
interface SourceScan { units: FnUnit[]; uncovered: string[]; imports: Map<string, ImportMap> }
let scanCache: SourceScan | null = null;
/** 전 소스 단위 + 어느 단위에도 덮이지 않은 AI 호출(파일:줄 · 0 이어야 한다) */
function scanSources(): SourceScan {
  if (scanCache) return scanCache;
  const units: FnUnit[] = [];
  const importsByFile = new Map<string, ImportMap>();
  const pending: Array<{ file: string; text: string; units: FnUnit[]; aiCalls: number[]; wrapperRefs: Array<{ name: string; pos: number }> }> = [];
  for (const dir of ['utils', 'services', 'routes']) {
    for (const rel of sourceFiles(join(BE, dir), /\.ts$/)) {
      const file = `${dir}/${rel}`;
      const text = be(file);
      const r = unitsOfSource(file, text);
      units.push(...r.units);
      importsByFile.set(file, r.imports);
      pending.push({ file, text, ...r });
    }
  }
  const wrappers = wrappersOf(units);
  const uncovered: string[] = [];
  for (const p of pending) {
    for (const pos of [...p.aiCalls, ...p.wrapperRefs.filter((r) => wrappers.has(r.name)).map((r) => r.pos)]) {
      if (p.units.some((u) => u.start <= pos && pos < u.end)) continue;
      uncovered.push(`${p.file}:${p.text.slice(0, pos).split('\n').length}`);
    }
  }
  scanCache = { units, uncovered, imports: importsByFile };
  return scanCache;
}
/** 래퍼 = 이름이 call 로 시작하고 날 AI 호출을 품은 함수(callOutreachAi · callAnthropic 꼴 · 참조로 넘겨도 잡는다) */
function wrappersOf(units: FnUnit[]): Set<string> {
  return new Set(units.filter((u) => u.name && /^call[A-Z]/.test(u.name) && RAW_AI_RE.test(u.body)).map((u) => u.name!));
}
/** 판정 이름 + 별칭(`const x = findNewNumbers` 꼴 · 부르기 전에 이름을 바꿔 시험을 비켜 가지 않게) */
function ctCallRe(names: string[], units: FnUnit[]): RegExp {
  const base = new RegExp(`^(?:${names.join('|')})$`);
  const aliases = new Set<string>();
  for (const u of units) for (const m of u.body.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*(\w+)\s*[;,)]/g)) if (base.test(m[2])) aliases.add(m[1]);
  return new RegExp(`\\b(?:${[...names, ...aliases].join('|')})\\(`);
}
/** (나) 분류 — AI 를 부르는 단위 중 효능 판정에 닿지 않는 것(그 단위 · 아래로 닫힘 · 부르는 쪽) */
function unclassifiedAiUnits(units: FnUnit[], all: FnUnit[], wrappers: Set<string>, imports: Map<string, ImportMap> = new Map()): { ai: FnUnit[]; unclassified: string[] } {
  const effRe = ctCallRe(EFFICACY_CT, all);
  const aiRe = new RegExp(`${wrappers.size ? `\\b(?:${[...wrappers].join('|')})\\b|` : ''}\\bmessages(?:\\s+as\\s+any\\))?\\.(?:batches\\.)?create\\(`);
  // ★ Codex 3R — 단위 = 파일 + 이름으로 푼다(이름만으로 합치면 다른 파일의 같은 이름 속성 함수가 도달을 빌려 준다).
  //   부른 이름 → 같은 파일의 그 이름 단위가 먼저 · 없으면 다른 파일의 선언(함수 · 변수 함수 · 메서드)만 · 객체 속성 함수 이름은 파일 밖으로 풀지 않는다.
  const isProp = (u: FnUnit) => /@\d+$/.test(u.key);
  const sameFile = new Map<string, FnUnit[]>();
  const globalDecl = new Map<string, FnUnit[]>();
  for (const u of all) {
    if (!u.name) continue;
    const k = `${u.file}\u0000${u.name}`;
    sameFile.set(k, [...(sameFile.get(k) || []), u]);
    if (!isProp(u)) globalDecl.set(u.name, [...(globalDecl.get(u.name) || []), u]);
  }
  // ★ Codex 4R — import 로 바인딩이 정해진 이름 = 그 파일의 그 선언만(별칭 따라감) · 같은 파일 → 다른 파일 선언 순
  const resolve = (file: string, name: string): FnUnit[] => {
    const imp = imports.get(file)?.get(name);
    if (imp) return (sameFile.get(`${imp.file}.ts\u0000${imp.name}`) ?? sameFile.get(`${imp.file}/index.ts\u0000${imp.name}`) ?? []).filter((u) => !isProp(u));
    return sameFile.get(`${file}\u0000${name}`) ?? globalDecl.get(name) ?? [];
  };
  // ★ Codex 5R — 부름 = 이름 + 속성 호출인가(x.y( · x?.y( ). 속성 호출에는 import 바인딩을 붙이지 않는다(받는 객체가 다르다) ·
  //   같은 파일의 그 이름 단위 → 없으면 다른 파일의 클래스 메서드만 · 그 밖은 풀지 않는다(검사 없는 것으로 남는다 = fail-closed).
  type Call = { name: string; prop: boolean };
  const isMethod = (u: FnUnit) => (u.key.split('#')[1] || '').includes('.');
  const calls = new Map<FnUnit, Call[]>(all.map((u) => {
    const seen = new Map<string, Call>();
    for (const m of u.body.matchAll(/(\.\s*)?\b(\w+)\s*\(/g)) { const c = { name: m[2], prop: !!m[1] }; if (c.name !== u.name) seen.set(`${c.prop ? '.' : ''}${c.name}`, c); }
    return [u, Array.from(seen.values())];
  }));
  const resolveCall = (file: string, c: Call): FnUnit[] => (c.prop
    ? (sameFile.get(`${file}\u0000${c.name}`) ?? (globalDecl.get(c.name) || []).filter(isMethod))
    : resolve(file, c.name));
  const reach = new Set<FnUnit>(all.filter((u) => effRe.test(u.body)));
  for (let changed = true; changed;) {
    changed = false;
    for (const u of all) {
      if (reach.has(u)) continue;
      // 같은 이름이 여럿으로 풀리면(바인딩을 확정 못 함) **전부** 검사에 닿아야 닿은 것이다(하나가 안전하다고 통과시키지 않는다)
      if ((calls.get(u) || []).some((c) => { const ts2 = resolveCall(u.file, c); return ts2.length > 0 && ts2.every((t) => reach.has(t)); })) { reach.add(u); changed = true; }
    }
  }
  const ai = units.filter((u) => !(u.name && wrappers.has(u.name)) && aiRe.test(u.body));
  const unclassified = ai.filter((u) => {
    if (reach.has(u)) return false;
    // 부르는 쪽 = 그 이름을 불러 이 단위로 풀리는 단위(같은 규칙)
    //   바인딩이 이 단위 하나로 정해지는 호출만 부르는 쪽이다(같은 이름 여럿이면 어느 쪽인지 모른다)
    const callers = u.name ? all.filter((v) => v !== u && (calls.get(v) || []).some((c) => { if (c.name !== u.name) return false; const ts2 = resolveCall(v.file, c); return ts2.length === 1 && ts2[0] === u; })) : [];
    return !callers.some((v) => reach.has(v));
  }).map((u) => u.key);
  return { ai, unclassified: Array.from(new Set(unclassified)) };
}
/** 혜택 · 숫자 판정을 부르지만 고객 글 판정이 아닌 쓰임(이유 필수 · 늘리면 이유를 적는다) */
const R13_PAIR_EXEMPT: Record<string, string> = {
  'utils/event-brief.ts#copyFactsExistInText': '혜택 판정의 정의(판정 함수 자체)',
  'utils/sales-outreach-exemplar-mask.ts#maskExemplarText': 'AI 영업 예시 가리기(프롬프트 재료 · 고객에게 나가지 않는다)',
  'utils/sales-outreach-jobs.ts#stripMaterialForPrompt': '프롬프트 재료 정리(모델이 면허 밖 혜택을 보지 않게 · 고객에게 나가지 않는다)',
};
/** AI 를 부르지만 고객에게 나가는 글을 만들지 않는 자리(이유 필수 · 새 AI 호출은 분류 전까지 실패) */
const R13_AI_NOT_COPY: Record<string, string> = {
  'routes/ai-memory.ts#POST /search-natural': '회사 메모리 검색 답(관리 화면)',
  'routes/ai-memory.ts#POST /brand-voice/extract-guideline': '브랜드 보이스 지침 추출(설정 값 · 고객 글 아님)',
  'routes/ai-usage.ts#POST /search-natural': '사용량 검색 답(관리 화면)',
  'routes/ai.ts#POST /operator/marketing-calendar/generate': '연간 기획 달력(회사 화면 · 캠페인 문안은 생성기가 따로 만든다)',
  'routes/ai.ts#POST /operator/marketing-calendar/regenerate-month': '연간 기획 달력 한 달 다시 만들기(회사 화면)',
  'routes/ai.ts#POST /operator/explain': '판단 설명(화면)',
  'routes/analysis.ts#POST /run': '분석 인사이트(화면 설명)',
  'routes/upload.ts#POST /mapping': '업로드 컬럼 매핑',
  'services/ai.ts#parseBriefing': '브리핑 해석(값 뽑기)',
  'services/ai.ts#recommendNextCampaign': '다음 캠페인 추천(대상 · 시각 · 채널 · 목표 한 줄 · 문안은 생성기가 만든다)',
  'utils/ai-column-mapper.ts#suggestVarColumnsWithAi': '변수 컬럼 매핑',
  'utils/ai-column-mapper.ts#mapColumnsWithAi': '컬럼 매핑',
  'utils/ai-mapping.ts#callAiMapping': '컬럼 매핑',
  'utils/ai-memory-accumulator-worker.ts#accumulateAvoidPatterns': '회사 메모리 학습(피할 표현 목록)',
  'utils/ai-segment-generator.ts#convertNaturalLanguageToFilter': '자연어 → 필터 변환',
  'utils/best-copy-miner.ts#judgeBatch': '문안 판정 점수(글을 쓰지 않는다)',
  'utils/billing-080.ts#extractKtStatement': '청구서 값 뽑기',
  'utils/biz-registration-extract.ts#extractBizRegistration': '사업자등록증 값 뽑기',
  'utils/company-daily-brief.ts#generateCompanyDailyBrief': '회사 관리자 일보(직원 화면 · 고객 발송 아님)',
  'utils/dm/dm-event-recommender.ts#recommendEventType': '행사 종류 추천(값)',
  'utils/dm/dm-self-diagnosis.ts#deriveTopInsight': '진단 설명(화면)',
  'utils/email-ai.ts#analyzeSpamRisk': '스팸 위험 진단(화면 · 고치기는 사람이)',
  'utils/email-ai.ts#buildPerformanceInsight': '성과 인사이트(화면)',
  'utils/email-ai.ts#buildEmailAccountInsight': '계정 인사이트(화면)',
  'utils/email-ai.ts#recommendSendTime': '발송 시각 추천(값)',
  'utils/help-answer.ts#answerHelpQuestion': '도움말 답(사용 안내)',
  'utils/inapp-explainer.ts#explainInAppMessage': '인앱 성과 설명(화면)',
  'utils/industry-formula.ts#distillIndustryFormula': '업종 공식 학습(내부)',
  'utils/journey-trigger-suggest.ts#suggestJourneyTrigger': '여정 시작 신호 추천(값)',
  'utils/multi-goal-decisioning.ts#analyzeGoalConflicts': '목표 충돌 분석(화면)',
  'utils/next-action-advisor.ts#recommendNextAction': '다음 행동 추천(대상 · 채널 · 목표 한 줄 · 문안은 생성기가 만든다)',
  'utils/performance-quick-action.ts#generateQuickAction': '성과 빠른 조치 제안(목표 · 말투 · 시각 · 문안은 생성기가 만든다)',
  'utils/sales-outreach-produce.ts#transcribeBannerLines': '배너 글 전사(원문 읽기 · 면허 출처 검사가 따로 본다)',
  'utils/sales-outreach-produce.ts#scoreOutreachPoster': '포스터 점수 판정(글을 쓰지 않는다)',
  'utils/alimtalk-ai-matcher.ts#matchAlimtalkTemplate': '알림톡 승인 템플릿 고르기(승인된 글 그대로 · 새 글을 쓰지 않는다)',
  'utils/cdp-fusion-explainer.ts#explainCdpDiagnostics': '고객 데이터 진단 설명(화면)',
  'utils/crm-agency-proposal.ts#analyzeAgencyIntakeImages': '대행 접수 이미지 판독(원문 읽기 · 제안서 문안 거름은 normalizeProposal)',
  'utils/journey-interview-ai.ts#parseJourneyIntent': '여정 의도 해석(값 뽑기)',
  'utils/performance-explainer.ts#explainPerformance': '성과 설명(화면)',
  'utils/sales-outreach-jobs.ts#runCrawlAndAnalyzeMetered': '홈페이지 행사 인용 분석(원문 글자 그대로 · 서버가 부분 문자열 대조)',
  'utils/sales-outreach-produce.ts#classifyOutreachImages': '이미지 분류 판정',
  'utils/sales-outreach-produce.ts#judgePersonInImage': '이미지 인물 판정',
  'utils/sales-outreach-produce.ts#scoreDmCapture': 'DM 화면 점수 판정',
  'services/ai.ts#suggestSegmentForObjective': '세그먼트 조건 제안',
  'services/ai.ts#translateObjectiveToConditions': '목표 → 조건 변환',
  'utils/event-image-extract.ts#extractEventsFromImages': '행사 이미지 값 뽑기(원문 읽기 · 생성기 근거는 사람이 확인한 원문)',
  'utils/spell-check.ts#runSpellCheck': '맞춤법 교정 후보(변경 20자 · 편집 거리 상한 · 사람이 하나씩 누를 때만 고친다)',
};
describe('R13 고객 글 생산자 출구 = 혜택 · 숫자 · 효능 거름 짝', () => {
  const { units: allUnits, uncovered } = scanSources();
  const units = allUnits.filter((u) => u.file !== 'utils/copy-benefit-detector.ts');
  const wrappers = wrappersOf(allUnits);
  it('단위 뽑기 계약 — 클래스 메서드 · 이름 없는 기본 내보내기 · 라우터 주소마다 · 덮이지 않은 AI 호출 0', () => {
    expect(uncovered, '어느 단위에도 덮이지 않은 AI 호출').toEqual([]);
    const sample = [
      "import { callAIWithFallback } from '../services/ai';",
      'class Gen { async make() { return callAIWithFallback({}); } }',
      'export default async () => callAIWithFallback({});',
      "router.post('/a', async (req: any, res: any) => { const t = await callAIWithFallback({}); res.json(claimsInventedEfficacy(t, '')); });",
      "router.post('/b', async (req: any, res: any) => { const t = await callAIWithFallback({}); res.json(t); });",
      "export function mkProbeDeps() { return { checkProbe: (t: string) => claimsInventedEfficacy(t, ''), makeProbeCopy: async () => callAIWithFallback({}) }; }",
    ].join('\n');
    const fx = unitsOfSource('routes/fixture.ts', sample);
    expect(fx.units.map((u) => u.key)).toEqual(expect.arrayContaining(['routes/fixture.ts#Gen.make', 'routes/fixture.ts#default@3', 'routes/fixture.ts#POST /a', 'routes/fixture.ts#POST /b']));
    const r = unclassifiedAiUnits(fx.units, [...allUnits, ...fx.units], wrappers);
    expect(r.unclassified.sort()).toEqual(['routes/fixture.ts#Gen.make', 'routes/fixture.ts#POST /b', 'routes/fixture.ts#default@3', 'routes/fixture.ts#makeProbeCopy@6']);
    expect(fx.aiCalls.length).toBe(5);
    // 자기 몸통 — 바깥 함수 글에 안쪽 속성 함수의 검사 · 호출이 섞이지 않는다
    expect(fx.units.find((u) => u.key === 'routes/fixture.ts#mkProbeDeps')!.body).not.toMatch(/claimsInventedEfficacy|callAIWithFallback/);
    // ★ Codex 3R — 다른 파일의 같은 이름 속성 함수가 도달을 빌려 주지 않는다(파일 + 이름 풀이)
    const fa = unitsOfSource('utils/fixture-a.ts', 'const rawDeps = {\n  sanitize: (x: string) => x,\n  generateProbeA: async () => rawDeps.sanitize(await callAIWithFallback({})),\n};');
    const fb = unitsOfSource('utils/fixture-b.ts', "const safeDeps = { sanitize: (x: string) => claimsInventedEfficacy(x, '') };");
    const two = unclassifiedAiUnits(fa.units, [...allUnits, ...fa.units, ...fb.units], wrappers);
    expect(two.unclassified).toEqual(['utils/fixture-a.ts#generateProbeA@3']);
    // ★ Codex 4R — 같은 파일의 같은 이름 둘(하나만 안전) · import 별칭(as sanitize)은 실제 바인딩을 따른다
    const same = unitsOfSource('utils/fixture-c.ts', "const rawDeps = {\n  sanitize: (x: string) => x,\n  generateProbeC: async () => rawDeps.sanitize(await callAIWithFallback({})),\n};\nconst safeDeps = { sanitize: (x: string) => claimsInventedEfficacy(x, '') };");
    expect(unclassifiedAiUnits(same.units, [...allUnits, ...same.units], wrappers).unclassified).toEqual(['utils/fixture-c.ts#generateProbeC@3']);
    const fd = unitsOfSource('utils/fixture-d.ts', 'export const pass = (x: string) => x;');
    const fe = unitsOfSource('utils/fixture-e.ts', "import { pass as sanitize } from './fixture-d';\nexport async function generateProbeE() { return sanitize(await callAIWithFallback({})); }");
    const imp = new Map([['utils/fixture-e.ts', fe.imports]]);
    expect(unclassifiedAiUnits(fe.units, [...allUnits, ...fd.units, ...fe.units], wrappers, imp).unclassified).toEqual(['utils/fixture-e.ts#generateProbeE']);
    // ★ Codex 5R — 안전한 함수를 import 한 파일의 같은 이름 속성 호출(rawDeps.sanitize)은 그 import 로 풀리지 않는다
    const fs1 = unitsOfSource('utils/fixture-safe.ts', "export function sanitize(x: string) { return claimsInventedEfficacy(x, ''); }");
    const fg = unitsOfSource('utils/fixture-g.ts', "import { sanitize } from './fixture-safe';\nconst rawDeps = {\n  sanitize: (x: string) => x,\n  generateProbeG: async () => rawDeps.sanitize(await callAIWithFallback({})),\n};\nexport const use = (t: string) => sanitize(t);");
    const imp2 = new Map([['utils/fixture-g.ts', fg.imports]]);
    expect(unclassifiedAiUnits(fg.units, [...allUnits, ...fs1.units, ...fg.units], wrappers, imp2).unclassified).toEqual(['utils/fixture-g.ts#generateProbeG@4']);
  });
  it('(가) 혜택 · 숫자 판정을 부르는 단위는 효능 판정(또는 rewriteAddsFacts · 어댑터)도 부른다', () => {
    const effRe = ctCallRe(EFFICACY_CT, allUnits);
    const benefitRe = ctCallRe(BENEFIT_CT, allUnits);
    const cand = Array.from(new Set(units.filter((u) => benefitRe.test(u.body) && !effRe.test(u.body)).map((u) => u.key)));
    expect(cand.filter((k) => !(k in R13_PAIR_EXEMPT))).toEqual([]);
    expect(Object.keys(R13_PAIR_EXEMPT).filter((k) => !cand.includes(k)), '낡은 면제').toEqual([]);
    // (라) 바닥값 — 뽑기가 깨져 0개로 초록 통과하지 않게
    expect(units.filter((u) => benefitRe.test(u.body)).length).toBeGreaterThanOrEqual(25);   // 1024 실측 28(구문 트리 · 자기 몸통 단위)
  });
  it('(나) AI 를 부르는 단위 = 효능 판정에 닿거나(그 단위 · 아래로 · 부르는 쪽) 「고객 글 아님」 면제', () => {
    const { ai, unclassified } = unclassifiedAiUnits(units, allUnits, wrappers, scanSources().imports);
    expect(unclassified.filter((k) => !(k in R13_AI_NOT_COPY))).toEqual([]);
    expect(Object.keys(R13_AI_NOT_COPY).filter((k) => !unclassified.includes(k)), '낡은 면제').toEqual([]);
    expect(wrappers.has('callOutreachAi') && wrappers.has('callAnthropic'), '래퍼 뽑기').toBe(true);
    expect(ai.length).toBeGreaterThanOrEqual(90);   // (라) 1024 실측 95(구문 트리 단위 · 안쪽 함수 포함)
  });
  it('(마) 고객 글을 만드는 생성 프롬프트는 효능 상수를 품는다(같은 문안은 한 곳) · AI 영업 예시에 효능 문장 0', async () => {
    const effRe = ctCallRe(EFFICACY_CT, allUnits);
    // 효능 판정을 직접 부르는 AI 호출 단위의 파일 = 고객 글 생산자 파일 · 그 파일은 상수를 쓴다(그림 헤드라인 한 줄 지시 · 한 줄 CT 는 자기 지시문을 소유)
    const own: Record<string, string> = {
      'utils/line-headline.ts': '그림 헤드라인 한 줄 전용 지시(16자 · 혜택 말 금지와 한 문장 · 판정은 claimsEfficacy)',
      'utils/one-line-ct/ai.ts': '한 줄 CT 지시문(효능 금지 줄 소유 · 1023 설계서) · 판정은 같은 CT',
    };
    const aiFiles = new Set(units.filter((u) => /\bcall(?:AIWithFallback|OutreachAi|Anthropic)\b/.test(u.body)).map((u) => u.file));
    const files = new Set(units.filter((u) => aiFiles.has(u.file) && effRe.test(u.body)).map((u) => u.file));
    const bad = [...files].filter((f) => !(f in own) && !/\bEFFICACY_(?:PROMPT_RULES|REWRITE_RULE|RETRY_HINT)\b/.test(be(f)));
    expect(bad).toEqual([]);
    expect(files.size).toBeGreaterThanOrEqual(15);
    const { OUTREACH_EXEMPLAR_SEED } = await import('../sales-outreach-exemplar-seed');
    const { claimsEfficacy } = await import('../copy-benefit-detector');
    const lines = Object.values(OUTREACH_EXEMPLAR_SEED).flat().flatMap((t) => String(t).split('\n').map((l) => l.replace(/^\s*[a-z_]+:\s*/, '')));
    expect(lines.filter((l) => claimsEfficacy(l))).toEqual([]);
    expect(be('utils/sales-outreach-exemplars.ts')).toMatch(/\bEFFICACY_PROMPT_RULES,/);
  });
});

// ── R14 감지했는데 사람에게 안 닿음 ─────────────────────────────────
// ★ 2026-10-25 hanjul03 멈춤: 65번이 10분 만에 잡고도 화면에만 적었고, 운영자 문자는 16번 라인 → 65번 한 길이었다.
//   운영 스크립트의 경보는 공용 입구 scripts/ops-alert.sh(문자 + 메일 두 길) 하나로만 나간다.
//   대상 = scripts/ 아래 셸 · JS 전수(소스에서 기계로 뽑는다 · 주석 줄 제외).
const SCRIPTS = join(BE, '..', '..', '..', 'scripts');
/** 경보 명령을 직접 실행하는 꼴($ALERT_CMD · ${ALERT_CMD} · localhost 알림 주소) */
const DIRECT_ALERT = /\$\{?ALERT_CMD\b|\/api\/internal\/(?:dist-)?alert\b/;
const R14_OWNER = 'ops-alert.sh';
describe('R14 감지했는데 사람에게 안 닿음 — 운영 경보 = 공용 입구(문자 + 메일)', () => {
  const files = (readdirSync(SCRIPTS, { recursive: true }) as string[])
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => /\.(sh|js|mjs)$/.test(f) && !/(^|\/)tests\//.test(f));
  it('대상이 비어 있지 않다(뽑기가 죽지 않았다)', () => {
    expect(files).toEqual(expect.arrayContaining(['backup.sh', 'backup-monitor.sh', 'monitor-dist.sh', 'ops-alert.sh', 'agent-watchdog/agent-watchdog.js']));
  });
  it('공용 입구 밖에서 경보 명령을 직접 부르지 않는다', () => {
    const bad = files.filter((f) => f !== R14_OWNER).flatMap((f) => {
      const src = read(join(SCRIPTS, f));
      const code = /\.sh$/.test(f)
        ? src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')
        : stripComments(src);
      return DIRECT_ALERT.test(code) ? [f] : [];
    });
    expect(bad).toEqual([]);
  });
  it('공용 입구는 두 길(문자 · 메일)을 각각 시도하고 한 길 실패가 다른 길을 막지 않는다', () => {
    const src = read(join(SCRIPTS, R14_OWNER));
    expect(src).toMatch(/send_sms && sms_ok=1\nsend_mail && mail_ok=1/);
    expect(src).toMatch(/curl -K -/); // 비밀번호는 명령 인자에 싣지 않는다
    expect(src).not.toMatch(/--user\s/);
  });
  it('경보를 내는 스크립트는 공용 입구를 부른다', () => {
    for (const f of ['backup.sh', 'backup-monitor.sh', 'monitor-dist.sh']) expect(read(join(SCRIPTS, f)), f).toMatch(/OPS_ALERT=.*ops-alert/);
    expect(read(join(SCRIPTS, 'agent-watchdog', 'agent-watchdog.js'))).toMatch(/OPS_ALERT: '\/usr\/local\/bin\/ops-alert'/);
  });
});
