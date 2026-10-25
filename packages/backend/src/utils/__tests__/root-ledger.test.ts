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
  // ★ 2026-10-25 R2 전 라우터
  'planner-recheck-public.ts POST /edit': '휴대폰 링크 고치기 = PC 와 같다(고친 문안 다시 검사 · 우리 부담 AI · 발송은 [보내기] 문이 지킨다)',
  'planner-recheck-public.ts POST /defer': '휴대폰 링크 미루기 = 끄기 쪽(PC 와 같다)',
  'campaigns.ts POST /test-send': '직접 발송 축 = 전 요금제 기본 기능(요금제 표 FREE 「문자 직접 발송」) · 통제 = 선불 잔액',
  'campaigns.ts POST /direct-send': '직접 발송 축 = 전 요금제 기본 기능 · 통제 = 선불 잔액',
  'campaigns.ts POST /direct-send/commit': '직접 발송 축 = 전 요금제 기본 기능 · 통제 = 선불 잔액',
  'campaigns.ts POST /brand-send': '직접 발송 축(브랜드 메시지) = 요금제 문 대상 아님 · 통제 = 선불 잔액 · 채널 등록',
  'spam-filter.ts POST /test': '스팸 검사 = 요금제 칸(spam_filter_enabled)을 주소 안에서 판정 · 없는 요금제 = 체험 횟수',
  'event-campaigns.ts POST /extract-image': '사진 판독 = 입력칸 공용(AI 한줄로 · DM · 이메일 · 인앱) · 크레딧 확인 뒤 성공 때만 걷는다(원장 §4-G 결함 아님)',
  'event-campaigns.ts POST /materials/quote': '견적 = 금액 계산 · 잔액 읽기만(돈을 쓰지 않는다)',
  'mall-products.ts POST /cards': '몰 상품 조회만(AI 0 · 차감 0) · 기계 추적이 같은 이름(lookupMall)을 돈 함수로 본다',
  'mall-products.ts POST /line-candidates': '몰 후보 조회만(AI 0 · 차감 0) · 기계 추적이 같은 이름(search)을 돈 함수로 본다',
};

/** 서버 요금제 문(공용 CT 하나 · 문 도우미는 안에서 같은 함수를 부른다 — 아래 시험이 그 사실을 확인한다) · 도우미를 { plan: false } 로 부르면 문이 아니다 */
const AI_ZONE_GATE = /\baiZonePlanBlocked(?:For)?\(|\b(?:journeyGate|operatorGate|ensureEmailAccess|ensureEmailAdmin|lineGate)\((?![^)]*plan:\s*false)/;
/**
 * ★ 2026-10-25 R2 전 라우터 — 서버 요금제 문의 꼴 전부: AI 존 문 · 기능 칸 문(requirePlanFeature 미들웨어 · canUseFeature) · 유료 판정(isActivePaidPlan) ·
 *   대행 계약 판정(requireAgencySend · 캠페인 대행 자격) · AI 체험 판정(requireAiOperatorTrialActive). 전부 plan-guard 의 판정 함수를 부른다.
 */
const PLAN_GATE = new RegExp(`${AI_ZONE_GATE.source}|\\b(?:requirePlanFeature|canUseFeature|isActivePaidPlan|requireAgencySend|requireAgencySendMw|checkEligibility|isCompanyEligible|requireAiOperatorTrialActive)\\b`);
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
  lineGate: 'routes/ai-line.ts',
};
/**
 * ★ 2026-10-25 원장 R2 · #55 — 대상 = 전 라우터(공개 링크 포함 · 화면 PlanGate 손 표는 지웠다 · 옛: 표에 오른 라우터만 봐서 플래너 공개 링크가 밖이었다).
 *   요금제 문 대상이 아닌 라우터는 이유와 함께 아래 면제(라우터 단위). 그 밖은 돈 · 발송 · AI 함수에 닿는 주소마다 문을 먼저 지난다.
 */
const ALL_ROUTERS = sourceFiles(join(BE, 'routes'), /\.ts$/).filter((f) => !/\.(test|verify)\.ts$/.test(f));
const R2_ROUTER_EXEMPT: Record<string, string> = {
  'admin.ts': '슈퍼관리자 전용(/api/admin · 고객 요금제 대상 아님)',
  'billing.ts': '슈퍼관리자 정산(/api/admin/billing · 고객 요금제 대상 아님)',
  'sales-outreach.ts': '직원 영업 도구(router.use requireSuperAdmin · 회사 크레딧 0)',
  'agency-approve.ts': '대행발송 승인 링크(토큰 + 인증번호 · 요금제가 아니라 대행 계약 · 계약 판정은 접수 때 requireAgencySend)',
};
const ROUTER_LEVEL_GATE = /\.use\(\s*requirePlanFeature\(/;

describe('R2 화면에만 있는 문 — PlanGate 화면의 돈 · 발송 주소 = 서버 요금제 문', () => {
  it('돈 · 발송 · AI 함수에 닿는 주소는(유틸까지 따라가 뽑는다) 그 호출보다 먼저 서버 요금제 문을 지난다', () => {
    const bad: string[] = [];
    const seen = new Set<string>();
    const traced = moneyCallRe();
    const usedExempt = new Set<string>();
    for (const file of ALL_ROUTERS) {
      if (R2_ROUTER_EXEMPT[file]) continue;
      const src = stripComments(be(`routes/${file}`));
      if (ROUTER_LEVEL_GATE.test(src)) continue;
      for (const b of routeBlocks(src)) {
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
    for (const file of ALL_ROUTERS) {
      const src = stripComments(be(`routes/${file}`));
      for (const m of src.matchAll(/\.use\(\s*requirePlanFeature\(([^)]*\))?[^;]*;/g)) {
        heads++;
        if (!/requirePlanFeature\(\s*'[^']+'\s*,\s*\{\s*except:\s*is(?:Plan|Dm)ControlRequest\s*\}\s*\)/.test(m[0])) bare.push(`${file}: ${m[0].slice(0, 90)}`);
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
    for (const file of ALL_ROUTERS) {
      if (R2_ROUTER_EXEMPT[file]) continue;
      const src = stripComments(be(`routes/${file}`));
      for (const b of routeBlocks(src)) {
        if (CONTROL_ROUTE(b) && AI_ZONE_GATE.test(b.body)) bad.push(`${file} ${key(b)}`);
      }
    }
    expect(Array.from(new Set(bad))).toEqual([]);
  });
  it('본문으로 끄는 주소(자동 재진입 · 옵션) = 끄기일 때만 문을 연다 · 메일 도우미의 요금제 판정 전체가 plan 표시 아래(Codex 1024 2R)', async () => {
    const ai = stripComments(be('routes/ai.ts'));
    expect(ai).not.toContain("router.patch('/operator/journeys/:id/auto-reentry'");   // ★1025 R15 — 화면 호출 0 · 옵션 주소 한 길
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
    const at = src.indexOf('export async function aiZonePlanBlockedFor(');
    expect(src.slice(at, src.indexOf('\n}\n', at))).toMatch(/try \{\s*plan = ctx === undefined \? await loadPlanContext\(companyId\) : ctx;\s*\} catch/);
    // 로그인판은 회사 id 판(공개 링크와 같은 함수)을 부른다 — 두 벌 0
    const w = src.slice(src.indexOf('export async function aiZonePlanBlocked('));
    expect(w.slice(0, w.indexOf('\n}\n'))).toContain('return aiZonePlanBlockedFor(companyId, (req as any).user, res, ctx);');
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
    // ★ 2026-10-25 — 호출 인자로 넘긴 객체의 콜백 속성(runChargedAi({ run: () => … }) 꼴)은 그 자리에서 도는 바깥 단위의 몸통이다(위 설계 · 이름 없는 콜백과 같다)
    else if (ts.isPropertyAssignment(node) && isFn(node.initializer) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
      && !(ts.isObjectLiteralExpression(node.parent) && ts.isCallExpression(node.parent.parent))) push(`${node.name.text}@${lineOf(node)}`, node.name.text, node);
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
  'utils/ai-column-mapper.ts#suggestVarColumnsWithAi': '변수 컬럼 매핑',
  'utils/ai-column-mapper.ts#mapColumnsWithAiWithAi': '컬럼 매핑(★1025 성공 뒤 차감 감싸기로 안쪽 이름)',
  'utils/ai-mapping.ts#callAiMapping': '컬럼 매핑',
  'utils/ai-memory-accumulator-worker.ts#accumulateAvoidPatterns': '회사 메모리 학습(피할 표현 목록)',
  'utils/ai-segment-generator.ts#convertNaturalLanguageToFilterWithAi': '자연어 → 필터 변환(★1025 성공 뒤 차감 감싸기로 안쪽 이름)',
  'utils/best-copy-miner.ts#judgeBatch': '문안 판정 점수(글을 쓰지 않는다)',
  'utils/billing-080.ts#extractKtStatement': '청구서 값 뽑기',
  'utils/biz-registration-extract.ts#extractBizRegistration': '사업자등록증 값 뽑기',
  'utils/company-daily-brief.ts#generateCompanyDailyBrief': '회사 관리자 일보(직원 화면 · 고객 발송 아님)',
  'utils/email-ai.ts#analyzeSpamRisk': '스팸 위험 진단(화면 · 고치기는 사람이)',
  'utils/email-ai.ts#buildPerformanceInsight': '성과 인사이트(화면)',
  'utils/email-ai.ts#buildEmailAccountInsight': '계정 인사이트(화면)',
  'utils/help-answer.ts#answerHelpQuestion': '도움말 답(사용 안내)',
  'utils/inapp-explainer.ts#explainInAppMessage': '인앱 성과 설명(화면)',
  'utils/industry-formula.ts#distillIndustryFormula': '업종 공식 학습(내부)',
  'utils/journey-trigger-suggest.ts#suggestJourneyTrigger': '여정 시작 신호 추천(값)',
  'utils/multi-goal-decisioning.ts#analyzeGoalConflicts': '목표 충돌 분석(화면)',
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
    expect(ai.length).toBeGreaterThanOrEqual(80);   // ★1025 죽은 AI 함수 지움(묶음 F · 실측 84) · (라) 1024 실측 95(구문 트리 단위 · 안쪽 함수 포함)
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

// ════════════════════════════════════════════════════════════════════
// ★ 2026-10-25 여정 구조체크 2차(설계서 docs/2026-10-25-journey-structure-check-2-design.md §4 · 재발 방지 설계 docs/2026-10-25-no-recurrence-system-design.md)
//   기계 시험이 덮던 뿌리(R2 · R4 · R7 · R9 · R10 · R13)는 2차에서 결함 0 · 안 덮던 R1 · R6 · R8 · R12 · R11 에서 결함이 나왔다 → 여정까지 넓힌다.
//   대상은 소스에서 기계로 뽑는다(손 등재 표 0) · 면제 = 이유 필수 · 낡은 면제 = 실패.
// ════════════════════════════════════════════════════════════════════
const BE_FILES = sourceFiles(BE, /\.ts$/);
const JOURNEY_UTILS = BE_FILES.filter((f) => /^utils\/journey-[\w-]+\.ts$/.test(f));
/** SQL 글(백틱 안) 전부 · 줄 번호 */
function sqlTemplates(src: string): Array<{ sql: string; line: number }> {
  const out: Array<{ sql: string; line: number }> = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ sql: m[1], line: src.slice(0, m.index).split('\n').length });
  return out;
}

// ── R15 죽은 주소(새 · 세 번째: 1023 여정 #13 · 1024 자동 마케팅 13 · 1025 여정 #10) ──
describe('R15 죽은 주소 — 여정 주소마다 화면 · SDK 호출이 있다', () => {
  const SDK = join(BE, '..', '..', 'sdk-js', 'src');
  const callers = [
    ...sourceFiles(FE, /\.(ts|tsx)$/).map((f) => read(join(FE, f))),
    ...sourceFiles(SDK, /\.ts$/).map((f) => read(join(SDK, f))),
  ].map(stripComments).join('\n');
  const ai = stripComments(be('routes/ai.ts'));
  const routes = routeBlocks(ai).filter((b) => /^\/operator\/(journeys|preview-target-samples|grade-ranks)/.test(b.path));
  const urlRe = (path: string) => new RegExp('/api/ai' + path.split(/(:\w+)/).map((p) => (p.startsWith(':') ? "(?:\\$\\{[^}]+\\}|[^/'\"`?]+)" : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('') + "(?=['\"`?]|\\$\\{)");
  // 작업대 동작 메뉴 = `/${mode}` 로 부른다(모드 = JourneyActionMode · 지우기 = DELETE 여정 주소)
  const ws = read(join(FE, 'components/journey/workspace/JourneyWorkspace.tsx'));
  const modes = ((read(join(FE, 'components/journey/JourneyActionConfirmModal.tsx')).match(/export type JourneyActionMode = ([^;]+);/) || [])[1] || '')
    .split('|').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  const dynamicAction = (path: string) => {
    const m = /^\/operator\/journeys\/:id\/(\w+)$/.exec(path);
    return !!m && modes.includes(m[1]) && ws.includes("`/api/ai/operator/journeys/${journeyId}${mode === 'delete' ? '' : `/${mode}`}`");
  };
  it('여정 주소를 뽑았다(뽑기가 죽지 않았다)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(50);
    expect(modes).toEqual(expect.arrayContaining(['archive', 'unarchive', 'end', 'pause']));
  });
  it('주소마다 화면 · SDK 에서 부르는 곳이 있다(없으면 지운다 · 남기면 같은 일을 하는 다른 길과 두 벌)', () => {
    const dead = routes.filter((b) => !urlRe(b.path).test(callers) && !dynamicAction(b.path)).map(key);
    expect(dead).toEqual([]);
  });
});

// ── R16 DB 날짜 칸 = 글자(새 · 세 번째: 0726 발송통계 · 1020 마지막 날 · 1025 날짜축 하루 앞당김) ──
describe('R16 DB 날짜 칸을 시각으로 읽음 — 날짜축 기준일은 글자(YYYY-MM-DD)로 읽고 글자로 계산한다', () => {
  it('날짜 함수 셋은 글자(AnchorDay)만 받는다 · 날짜축 워커는 ::text 로 읽는다 · Date 를 넘기는 부르기 0', () => {
    const st = be('utils/send-time-util.ts');
    expect(st).toContain('export type AnchorDay = string;');
    expect(st).toMatch(/export function computeAnchorStepRunAt\(\s*anchorDay: AnchorDay,/);
    expect(st).toMatch(/export function computeNextAnchor\([\s\S]{0,120}current: AnchorDay,/);
    expect(st).toMatch(/export function isAnchorCycleComplete\([\s\S]{0,80}anchorDay: AnchorDay,/);
    expect(be('utils/journey-anchor-scheduler.ts')).toContain('anchor_date::text AS anchor_day');
    const bad: string[] = [];
    for (const f of BE_FILES) {
      const src = stripComments(be(f));
      for (const m of src.matchAll(/(?<!function\s)\b(computeAnchorStepRunAt|computeNextAnchor|isAnchorCycleComplete)\(([^;]*?)\)/g)) {
        if (/\.anchor_date\b|new Date\(/.test(m[2])) bad.push(`${f} ${m[1]}(${m[2].slice(0, 60)})`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('DB 모양(글자) 기준일 = 그날 보낸다 · 연 반복은 같은 날', async () => {
    const { computeAnchorStepRunAt, computeNextAnchor } = await import('../send-time-util');
    expect(computeAnchorStepRunAt('2026-10-30', 0, 10).toISOString()).toBe('2026-10-30T01:00:00.000Z');
    expect(computeAnchorStepRunAt('2026-10-30', 7, 10).toISOString()).toBe('2026-10-23T01:00:00.000Z');
    expect(computeNextAnchor('yearly', null, '2026-10-30')).toBe('2027-10-30');
  });
});

// ── R1 같은 사실 두 벌 — 여정 실행 넣는 곳 · 진입 뒤 구매 · 조건 칸 목록 ──
describe('R1 여정 — 실행 넣는 곳마다 같은 진입 규칙 · 같은 판정 한 곳', () => {
  const inserters = BE_FILES.filter((f) => /INSERT INTO journey_executions/.test(stripComments(be(f))));
  it('실행 넣는 파일을 뽑았다', () => {
    expect(inserters).toEqual(expect.arrayContaining(['utils/journey-trigger-watcher.ts', 'utils/journey-reentry-worker.ts', 'utils/journey-anchor-scheduler.ts']));
  });
  it('넣는 곳마다 상한 판정(entryCapExceeded) · 작성자 범위 · 첫 칸 보낼 시각(재진입 = 옛 결함: 셋 다 없었다)', () => {
    const bad: string[] = [];
    for (const f of inserters) {
      const src = stripComments(be(f));
      if (!/\bentryCapExceeded\(/.test(src)) bad.push(`${f} 상한 판정 없음`);
      if (!/\bgetJourneyOwnerScopeSql\(/.test(src)) bad.push(`${f} 작성자 범위 없음`);
      if (!/\b(calculateNextRunAt|computeAnchorStepRunAt)\(/.test(src)) bad.push(`${f} 보낼 시각 없음`);
    }
    expect(bad).toEqual([]);
    // ★ Codex 1R — 넣기는 같은 계보 잠금 안에서 「지금도 켜짐」을 다시 본 뒤에만(관문 lockEntryIfActive · 감시 = 잠금 + startStillSame) ·
    //   하루 몫을 쓰는 곳은 잠금 안에서 다시 센다(dailyRoomInLock) · 함수 단위(넣는 함수마다)
    const gateBad: string[] = [];
    const fnStart = (src: string, at: number) => Math.max(src.lastIndexOf('\nasync function ', at), src.lastIndexOf('\nexport async function ', at));
    for (const f of inserters) {
      const src = stripComments(be(f));
      // 넣는 자리 = 넣기 SQL 이 든 함수 · 맨 위 상수(공용 넣기 SQL)면 그 상수를 쓰는 자리마다
      const sites: number[] = [];
      for (const m of src.matchAll(/INSERT INTO journey_executions/g)) {
        const head = src.slice(src.lastIndexOf('\n', src.lastIndexOf('`', m.index!)) + 1, m.index!);
        const konst = /^const (\w+) =\s*$/.exec(head.split('`')[0].trim() + ' ') || /^const (\w+) =/.exec(src.slice(src.lastIndexOf('\nconst ', m.index!) + 1, m.index!));
        if (konst && fnStart(src, m.index!) < src.lastIndexOf('\nconst ' + konst[1], m.index!)) {
          for (const u of src.matchAll(new RegExp(`\\b${konst[1]}\\b(?!\\s*=)`, 'g'))) sites.push(u.index!);
        } else sites.push(m.index!);
      }
      for (const at of sites) {
        const body = src.slice(fnStart(src, at), at);
        const gated = /\blockEntryIfActive\(/.test(body) || (/\blockLineageEntry\(/.test(body) && /\bstartStillSame\(/.test(body));
        if (!gated) gateBad.push(`${f}:${src.slice(0, at).split('\n').length} 넣기 관문 없음`);
      }
      // 하루 몫을 쓰는 파일 = 잠금 뒤 다시 센다
      if (/\bbackfillPerDayOf\(/.test(src)) {
        const recount = src.search(/\bdailyRoomInLock\(/);
        if (recount < 0) gateBad.push(`${f} 하루 몫을 잠금 안에서 다시 세지 않음`);
        else {
          const body = src.slice(fnStart(src, recount), recount);
          if (!/\block(EntryIfActive|LineageEntry)\(/.test(body)) gateBad.push(`${f} 하루 몫 재셈이 잠금 앞`);
        }
      }
    }
    expect(gateBad).toEqual([]);
    // 상한 판정 자체를 따로 적은 곳 0(옛 = 네 벌)
    const inline = BE_FILES.filter((f) => /threshold_recipients_per_step[\s\S]{0,400}\bids\.length\s*>\s*(Number\()?cap\b/.test(stripComments(be(f))));
    expect(inline).toEqual([]);
  });
  it('「진입 뒤 구매했나」 = journey-goal-purchase 한 곳(실행기 목표 · 조건 칸 · 지도 숫자)', () => {
    const copies = BE_FILES.filter((f) => f !== 'utils/journey-goal-purchase.ts' && /recent_purchase_date\s*>\s*\(\s*[\w$]+\.entered_at/.test(stripComments(be(f))));
    expect(copies).toEqual([]);
    for (const f of ['utils/journey-executor.ts', 'utils/journey-lifecycle-map.ts']) expect(be(f), f).toMatch(/from '\.\/journey-goal-purchase'/);
  });
  it('조건 칸 고객 정보 목록 = 대상 조건 CT 와 같은 표(검토 화면 손 목록 0)', () => {
    const page = stripComments(read(join(FE, 'pages/JourneysPage.tsx')));
    expect(page).toContain('{COND_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}');
    expect(page).not.toMatch(/<option value="(recent_purchase_amount|recent_purchase_date|birth_date)">/);
  });
});

// ── R6 닫히지 않는 상태 — 여정 실행 ──
describe('R6 여정 실행 상태 — 쓰는 값은 아는 값만 · 멈춤은 되살릴 수 있는 사유만', () => {
  const KNOWN = new Set(['active', 'paused', 'completed', 'goal_met', 'ended', 'failed', 'holdout']);
  const writes: Array<{ f: string; line: number; at: number; status: string }> = [];
  for (const f of BE_FILES) {
    const src = stripComments(be(f));
    for (const m of src.matchAll(/\b(UPDATE|INSERT INTO)\s+journey_executions\b/g)) {
      const rest = src.slice(m.index!, src.indexOf('`', m.index!));
      const head = rest.split(/\bWHERE\b|\bRETURNING\b/)[0];
      const line = src.slice(0, m.index!).split('\n').length;
      for (const x of head.matchAll(/(?<![\w.])status\s*=\s*'(\w+)'|THEN\s+'(\w+)'/g)) writes.push({ f, line, at: m.index!, status: x[1] || x[2] });
      if (m[1] === 'INSERT INTO') for (const x of head.matchAll(/'(\w+)'/g)) if (KNOWN.has(x[1])) writes.push({ f, line, at: m.index!, status: x[1] });
    }
  }
  it('뽑았다', () => { expect(writes.length).toBeGreaterThanOrEqual(10); });
  it('실행 상태로 쓰는 값 = 아는 값(끝 · 되살림 · 진행 분류가 있는 값)만', () => {
    expect(writes.filter((w) => !KNOWN.has(w.status)).map((w) => `${w.f}:${w.line} ${w.status}`)).toEqual([]);
  });
  it('실행을 paused 로 쓰는 곳 = autoPauseExecution 하나 · 그 사유 = 다시 켤 때 되살리는 사유만(옛: 번호 오류 멈춤 = 영원히 멈춤)', () => {
    const paused = writes.filter((w) => w.status === 'paused');
    const ph = stripComments(be('utils/journey-pause-handler.ts'));
    // 함수 단위 — 같은 파일의 다른 함수(그날 정지 등)가 paused 를 쓰면 실패(★1025 변이 확인에서 파일 단위가 놓쳤다)
    const fnAt = ph.indexOf('export async function autoPauseExecution(');
    const fnEnd = ph.indexOf('\n}\n', fnAt);
    expect(fnAt).toBeGreaterThan(-1);
    expect(paused.length).toBeGreaterThan(0);
    expect(paused.filter((w) => w.f !== 'utils/journey-pause-handler.ts' || w.at < fnAt || w.at > fnEnd).map((w) => `${w.f}:${w.line}`)).toEqual([]);
    const sig = (ph.match(/export async function autoPauseExecution\([\s\S]*?pauseReason:\s*([^;]+);/) || [])[1] || '';
    const reasons = Array.from(sig.matchAll(/'(\w+)'/g)).map((m) => m[1]).sort();
    const revive = Array.from((be('utils/journey-resume.ts').match(/export const RESUME_REVIVE_REASONS = \[([^\]]+)\]/) || [])[1]?.matchAll(/'(\w+)'/g) || []).map((m) => m[1]).sort();
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons).toEqual(revive);
  });
});

// ── R7 넓힘 — 낮은 층 검사 결과 함수도 공용 판정으로 ──
describe('R7 넓힘 — 스팸 검사 결과를 직접 읽는 파일도 공용 판정(통과 · 차단 · 검사 장애)', () => {
  it('getSpamTestBatchResults 를 부르는 파일은 spamVerdictOf · batchVerdictOf 로 읽는다(옛: 여정 검사만 낮은 층을 직접 읽어 장애 = 차단)', () => {
    const users = BE_FILES.filter((f) => /\bgetSpamTestBatchResults\(/.test(stripComments(be(f))));
    expect(users).toContain('utils/journey-pretest-validator.ts');
    expect(users.filter((f) => !/\b(spamVerdictOf|batchVerdictOf)\(/.test(stripComments(be(f))))).toEqual([]);
    const pn = stripComments(be('utils/journey-pretest-notifier.ts'));
    expect(pn).toMatch(/verdict === 'error'|\.verdict === 'error'/);
  });
});

// ── R8 넓힘 — 여정 재시도 상한 ──
describe('R8 넓힘 — 여정 실행 · 재검사의 재시도에 상한', () => {
  it('error_count 를 올리는 SQL 은 상한 판정과 함께 있다(같은 문장에서 failed 로 닫거나 · 앞에서 횟수를 본다)', () => {
    const bad: string[] = [];
    for (const f of JOURNEY_UTILS) {
      const src = stripComments(be(f));
      for (const m of src.matchAll(/error_count\s*=\s*COALESCE\(error_count,\s*0\)\s*\+\s*1/g)) {
        const at = m.index!;
        const stmt = src.slice(src.lastIndexOf('`', at), src.indexOf('`', at));
        const before = src.slice(Math.max(0, at - 900), at);
        if (!/THEN 'failed'/.test(stmt) && !/if \(errorCount < \d+\)/.test(before)) bad.push(`${f}:${src.slice(0, at).split('\n').length}`);
      }
    }
    expect(bad).toEqual([]);
    expect(be('utils/journey-executor.ts')).toMatch(/const EXECUTION_ERROR_MAX = \d+;/);
  });
  it('2시간 전 재검사의 검사 장애 = 같은 날 상한(PRETEST_CHECK_ERROR_MAX) 뒤 멈춤 · 고친 문안 검사 장애도 같은 상한', () => {
    const pn = stripComments(be('utils/journey-pretest-notifier.ts'));
    expect(pn).toMatch(/const PRETEST_CHECK_ERROR_MAX = \d+;/);
    expect((pn.match(/if \(n < PRETEST_CHECK_ERROR_MAX\) continue;/g) || []).length).toBe(2);
  });
});

// ── R12 LIMIT 뒤 거름 — 여정 ──
describe('R12 넓힘 — 여정 SQL 의 묶음 LIMIT 은 순서가 정해져 있다 · 2시간 전 재검사 거름은 LIMIT 앞', () => {
  it('여정 파일의 LIMIT(1 아닌 것)은 ORDER BY 와 함께(순서 없는 LIMIT 0 · 옛: 재검사 2,000행 순서 없음)', () => {
    const bad: string[] = [];
    for (const f of JOURNEY_UTILS) {
      for (const t of sqlTemplates(stripComments(be(f)))) {
        const lm = /\bLIMIT\s+(\S+)/.exec(t.sql);
        if (lm && /\bSELECT\b/.test(t.sql) && lm[1] !== '1' && !/ORDER BY|\$\{order\w*\}/.test(t.sql)) bad.push(`${f}:${t.line}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('재검사 후보 = 그날 처리 거름 · 묶음 하나 = 한 행이 LIMIT 앞(SQL)', () => {
    const pn = stripComments(be('utils/journey-pretest-notifier.ts'));
    const sql = pn.slice(pn.indexOf('SELECT DISTINCT ON (je.journey_id, s.id'), pn.indexOf('LIMIT ${PRETEST_SCAN_BUNDLE_LIMIT}'));
    expect(sql).toContain('FROM journey_pretest_schedules ps');
    expect(sql).toContain('ORDER BY b.next_run_at ASC');
  });
});

// ── R11 넓힘 — 여정 화면 · 거절 문장 ──
describe('R11 넓힘 — 여정 화면 · 서버 거절 문장에 내부 표 · 칸 이름 · 개발 용어 0', () => {
  const JARGON = /영역|정합|매트릭스|의무|본질|Thompson|journey_(executions|steps|step_logs|step_variants)\b/;
  it('여정 화면 글(주석 밖)에 개발 용어 · 내부 표 이름 0', () => {
    const files = sourceFiles(FE, /\.tsx$/).filter((f) => /^components\/journey\//.test(f) || /^pages\/Journey\w*\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(30);
    const bad: string[] = [];
    for (const f of files) {
      stripComments(read(join(FE, f))).split('\n').forEach((ln, i) => { if (JARGON.test(ln)) bad.push(`${f}:${i + 1} ${ln.trim().slice(0, 60)}`); });
    }
    expect(bad).toEqual([]);
  });
  it('여정 서버가 고객에게 돌려주는 문장(reason · 입력 · 상태 오류)에 칸 이름 · 개발 용어 0', () => {
    const MSG = /(?:reason:\s*|new (?:JourneyInputError|JourneyStepGateError)\()(['`"])((?:(?!\1).)*)\1/g;
    const INTERNAL = /영역|정합|의무|매트릭스|\bstep \$\{|\b(anchor_date|anchor_offset_days|condition_jsonb|target_hour_kst|delay_mode|within_days|step_order|one_shot|customer_field|cdp_event_exists|journey_step_clicked)\b|회사 admin/;
    const bad: string[] = [];
    for (const f of JOURNEY_UTILS) {
      const src = stripComments(be(f));
      for (const m of src.matchAll(MSG)) if (INTERNAL.test(m[2])) bad.push(`${f}: ${m[2].slice(0, 60)}`);
    }
    expect(bad).toEqual([]);
  });
});

// ── R10 넓힘 — 여정 CT 가 던지는 오류 종류 ──
/** 일반 Error 로 두는 이유(사람이 고칠 입력이 아니다) — 키 = 파일 + 문장 앞 · 이 밖의 한국어 일반 Error = 입력 · 상태 오류를 500 으로 묻는다 */
const JOURNEY_PLAIN_ERROR_OK: Record<string, string> = {
  'utils/journey-ai-generator.ts|추천 칸 수(': 'AI 응답 실패(계획보다 적게 설계)',
  'utils/journey-executor.ts|SMS 큐 적재 0건': '발송 큐 내부 실패(실행기가 잡아 재시도 · 상한)',
  'utils/journey-identity-signals.ts|안전하지 않은 테이블 alias': '내부 불변식(코드가 넘기는 별칭)',
  'utils/journey-intake-grace.ts|안전하지 않은 테이블 alias': '내부 불변식',
  'utils/journey-pause-handler.ts|JOURNEY_PAUSE_TOKEN_SECRET 미설정': '서버 설정 누락(운영 경보 대상)',
  'utils/journey-send-claim.ts|단계 캠페인을 찾지 못해': '발송 표식 내부 불변식',
  'utils/journey-send-claim.ts|발송 테이블을 찾지 못해': '발송 표식 내부 불변식',
};
describe('R10 넓힘 — 여정 CT 의 입력 · 상태 오류 = JourneyInputError(400) · JourneyStepGateError(409)', () => {
  const found: string[] = [];
  for (const f of JOURNEY_UTILS) {
    for (const m of stripComments(be(f)).matchAll(/throw new Error\((['`"])((?:(?!\1).)*[가-힣](?:(?!\1).)*)\1/g)) found.push(`${f}|${m[2]}`);
  }
  it('한국어 일반 Error 는 면제(이유 있음)뿐 · 낡은 면제 0', () => {
    const keys = Object.keys(JOURNEY_PLAIN_ERROR_OK);
    expect(found.filter((x) => !keys.some((k) => x.startsWith(k)))).toEqual([]);
    expect(keys.filter((k) => !found.some((x) => x.startsWith(k)))).toEqual([]);
  });
});

// ── R3 범위 — 여정 추천 판정(D1 = A) ──
describe('R3 넓힘 — 여정 추천(AI 진단 · 기회 · 한 줄 묻기) = 보는 사람 판정 · 요청 키에 보는 사람', () => {
  it('판정 SQL 이 범위 조각(journeyCoverSql)을 붙이고 · 부르는 곳이 보는 사람을 넘긴다', () => {
    const op = stripComments(be('utils/journey-opportunities.ts'));
    expect((op.match(/\$\{(?:cover|productCover)\.where\}/g) || []).length).toBe(3);
    expect(stripComments(be('utils/one-line-ask.ts'))).toContain('${cover.where}');
    const bad: string[] = [];
    for (const f of BE_FILES) {
      const src = stripComments(be(f));
      for (const m of src.matchAll(/\b(buildJourneyDiagnosis|nonActiveJourneyTriggers)\(\s*companyId\s*\)/g)) bad.push(`${f} ${m[0]}`);
      for (const m of src.matchAll(/\brecoRequestId\(\s*companyId\s*,\s*plan\s*\)/g)) bad.push(`${f} ${m[0]}`);
    }
    expect(bad).toEqual([]);
    expect(stripComments(be('utils/journey-product-create.ts'))).toContain('`journey-product:${input.companyId}:${input.userId}:${input.requestId}`');
  });
});

// ── R17 tsc 가 못 보는 SQL 모양 — 자리표($n) ↔ 바인드 배열(★2026-10-25 Codex 2R · 여정 재진입 후보 조회가 쓰지 않는 $1 바인드로 매번 42P18) ──
//   대상 = 여정 utils · routes/ai.ts 의 query(글, [배열 글자]) 전부(펼침 없는 배열만 · 글 = 끼운 식의 소스 · 같은 파일에서 그 이름에 넣은 글까지 풀어 센다).
//   결함 = 식 없는 글이면 자리표 ≠ 1..n · 식을 끼운 글이면 넘침(max > n) 또는 앞 번호 빈칸(쓰지 않는 앞 바인드 = 식이 설명 못 함).
//   한계(알고 둠) = 식을 끼운 글에서 맨 뒤 바인드가 남는 꼴은 식이 그 번호를 채울 수 있어 못 잡는다(변이 확인 = 앞 빈칸 · 식 없는 글 넘침 · 없는 번호는 잡음).
//   여정 밖 라우터 = 측정만(1025 = 3,135 개 중 이 규칙 오탐 3 · 모두 이웃 함수가 자리표를 만드는 꼴 · 결함 0).
function bindMismatches(rel: string): string[] {
  const text = be(rel);
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const names = new Map<string, string>();
  const add = (k: string, v: string) => names.set(k, `${names.get(k) || ''} ${v}`);
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) add(n.name.text, n.initializer.getText(sf));
    if (ts.isBinaryExpression(n) && ts.isIdentifier(n.left) && (n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken || n.operatorToken.kind === ts.SyntaxKind.EqualsToken)) add(n.left.text, n.right.getText(sf));
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2 && /(^|\.)query$/.test(node.expression.getText(sf))) {
      const [a0, a1] = node.arguments;
      if (ts.isArrayLiteralExpression(a1) && !a1.elements.some(ts.isSpreadElement)) {
        let lit: string | null = null;
        let opaque = false;
        if (ts.isNoSubstitutionTemplateLiteral(a0) || ts.isStringLiteral(a0)) lit = a0.text;
        else if (ts.isTemplateExpression(a0)) {
          const parts = [a0.head.text, ...a0.templateSpans.map((s) => s.literal.text)];
          if (!parts.slice(0, -1).some((t) => /\$$/.test(t))) {   // $${식} = 자리 번호를 식으로 만든다 → 셀 수 없음
            const subs = a0.templateSpans.map((s) => {
              const e = s.expression;
              if (ts.isIdentifier(e) && names.has(e.text)) return names.get(e.text)!;
              if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
              opaque = true;
              return e.getText(sf);
            });
            lit = `${parts.join(' ')} ${subs.join(' ')}`;
          }
        } else if (ts.isIdentifier(a0) && names.has(a0.text)) lit = names.get(a0.text)!;
        if (lit != null) {
          const used = new Set(Array.from(lit.matchAll(/\$(\d+)/g)).map((m) => Number(m[1])));
          const n = a1.elements.length;
          const max = used.size ? Math.max(...used) : 0;
          const unused: number[] = [];
          for (let k = 1; k <= n; k++) if (!used.has(k)) unused.push(k);
          const gap = unused.some((k) => k < max);
          if (max > n || (unused.length > 0 && (!opaque || gap))) out.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} 바인드 ${n} · 최대 $${max} · 안 쓰는 [${unused.join(',')}]`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
describe('R17 tsc 가 못 보는 SQL 모양 — 자리표 = 바인드(여정)', () => {
  const files = [...JOURNEY_UTILS, 'routes/ai.ts'];
  it('대상을 뽑았다', () => { expect(files.length).toBeGreaterThan(60); });
  it('쓰지 않는 바인드 · 없는 바인드 0', () => {
    expect(files.flatMap(bindMismatches)).toEqual([]);
  });
});

// ── R1 단가 두 벌 (★ 2026-10-25 한 줄 전 기능 구조체크 · 원장 Z2 · Z3 · #91 · #105 · #116) ─────────
//   단가는 서버 CREDIT_COST_MAP 한 곳이다. 서버 코드 · 화면 문장에 숫자로 다시 적으면 한쪽만 바뀐 날 표시 ≠ 차감이 된다
//   (옛: 단축 URL 100 → 20 을 서버만 바꿔 요금 요약표가 100 · DM 발행 100 인데 충전 창이 30 으로 나눴다).
const FRONT_CREDIT = read(join(FE, 'constants', 'credit.ts'));
/** 이름 뒤 첫 `{` 부터 짝이 맞는 `}` 까지 */
function objectBodyOf(src: string, anchor: string): string {
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error(`앵커 없음: ${anchor}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`닫는 괄호 없음: ${anchor}`);
}
const pairsOf = (body: string) => Array.from(stripComments(body).matchAll(/'([a-zA-Z][\w-]*)'\s*:\s*(\d+)/g), (m) => [m[1], Number(m[2])] as const);
/** 서버 단가 숫자 박기 — 단가는 getCreditCost(키) 로만 읽는다 */
const SERVER_PRICE_LITERAL: Array<[string, RegExp]> = [
  ['creditCost: 숫자', /\bcreditCost\s*:\s*[1-9]/],
  ['checkCredit(회사, 숫자)', /\bcheckCredit\(\s*[^,()]+,\s*[1-9]\d*\s*\)/],
  ['차감 · 정산 호출의 cost: 숫자', /\b(?:deductCredit\w*|settleCreditAfterSuccess|runChargedAi|refundCredit)\(\s*\{[^}]*?\bcost\s*:\s*[1-9]\d*\s*[,}]/],
  ['const cost = 숫자', /\bconst\s+cost\s*=\s*[1-9]\d*\s*;/],
];
describe('R1 단가 두 벌 — 단가 = 서버 단가표 한 곳 · 화면은 단가표 · 견적에서만 읽는다', () => {
  it('서버 코드에 단가 숫자를 박지 않는다(getCreditCost(키) 로 읽는다)', () => {
    const hits: string[] = [];
    for (const dir of ['routes', 'utils', 'services']) {
      for (const rel of sourceFiles(join(BE, dir), /\.ts$/)) {
        if (rel === 'ai-credit-calc.ts') continue;   // 단가표 자신
        const src = stripComments(be(`${dir}/${rel}`));
        for (const [name, re] of SERVER_PRICE_LITERAL) if (re.test(src)) hits.push(`${dir}/${rel} · ${name}`);
      }
    }
    expect(hits).toEqual([]);
  });
  it('화면 단가표 두 벌(작은 생성 · 확인 창) 금액 = 서버 단가표 금액(값까지)', async () => {
    const { CREDIT_COST_MAP } = await import('../ai-credit-calc');
    const pairs = [...pairsOf(objectBodyOf(FRONT_CREDIT, 'export const AI_GENERATE_COSTS')), ...pairsOf(objectBodyOf(FRONT_CREDIT, 'export const CONFIRM_CREDIT_COSTS'))];
    expect(pairs.length).toBeGreaterThan(30);
    expect(pairs.filter(([k, v]) => CREDIT_COST_MAP[k] !== v).map(([k, v]) => `${k} 화면 ${v} · 서버 ${CREDIT_COST_MAP[k]}`)).toEqual([]);
  });
  it('요금 요약표 줄마다 서버 단가 키가 있고 금액이 같다', async () => {
    const { CREDIT_COST_MAP } = await import('../ai-credit-calc');
    const body = stripComments(FRONT_CREDIT.slice(FRONT_CREDIT.indexOf('export const CREDIT_TASK_COSTS'), FRONT_CREDIT.indexOf('];', FRONT_CREDIT.indexOf('export const CREDIT_TASK_COSTS'))));
    const rows = Array.from(body.matchAll(/\{\s*key:\s*'([^']+)'[^}]*\}/g), (m) => m[0]);
    expect(rows.length).toBeGreaterThan(10);
    const bad = rows.map((r) => {
      const cost = Number((r.match(/cost:\s*(\d+)/) || [])[1]);
      const source = (r.match(/source:\s*'([^']+)'/) || [])[1];
      return !source ? `${r.slice(0, 40)} · source 없음` : CREDIT_COST_MAP[source] !== cost ? `${source} 화면 ${cost} · 서버 ${CREDIT_COST_MAP[source]}` : '';
    }).filter(Boolean);
    expect(bad).toEqual([]);
  });
  it('화면 문장 · 버튼에 「N크레딧」 숫자 0 · 단가표 키에 숫자 대체 값 0(단가표 · 견적 변수만)', () => {
    const hits: string[] = [];
    for (const rel of sourceFiles(FE, /\.tsx?$/)) {
      const src = stripComments(read(join(FE, rel)));
      const lines = src.split('\n');
      lines.forEach((ln, i) => {
        if (/[1-9]\d*\s?크레딧/.test(ln)) hits.push(`${rel}:${i + 1} 문장 숫자`);
        if (/COSTS\[[^\]]*\]\s*(?:\?\?|\|\|)\s*[1-9]/.test(ln) || /\b\w*Cost\s*\?\?\s*[1-9]/.test(ln) || /\bcosts\??\.\w+\s*\?\?\s*[1-9]\d*\b(?!\.)/.test(ln) && !/perSms|perLms|perMms|perKakao/.test(ln)) hits.push(`${rel}:${i + 1} 숫자 대체 값`);
      });
    }
    expect(hits).toEqual([]);
  });
  it('화면이 부르는 단가 키(creditText · creditCost)는 화면 단가표와 서버 단가표에 있다(없으면 0크레딧으로 보인다)', async () => {
    const { CREDIT_COST_MAP } = await import('../ai-credit-calc');
    const front = new Set([...pairsOf(objectBodyOf(FRONT_CREDIT, 'export const AI_GENERATE_COSTS')), ...pairsOf(objectBodyOf(FRONT_CREDIT, 'export const CONFIRM_CREDIT_COSTS'))].map(([k]) => k));
    const used = new Set<string>();
    for (const rel of sourceFiles(FE, /\.tsx?$/)) {
      for (const m of read(join(FE, rel)).matchAll(/\bcredit(?:Text|Cost)\(\s*'([^']+)'\s*\)/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(15);
    expect([...used].filter((k) => !front.has(k) || !(k in CREDIT_COST_MAP))).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ★ 2026-10-25 한 줄 전 기능 구조체크 — 덮음표(§3) 빈칸 → 시험(원장 docs/2026-10-25-oneline-all-structure-check.md §8-3)
//   대상 = 소스에서 뽑는다 · 면제 = 줄(키)마다 이유 · 낡은 면제(쓰이지 않는 키) = 실패
// ═════════════════════════════════════════════════════════════════════════════════════════════
const SERVER_SRC = ['routes', 'utils', 'services'].flatMap((d) => sourceFiles(join(BE, d), /\.ts$/).map((f) => `${d}/${f}`));
/** 문자열 리터럴(따옴표 · 백틱) · 줄 번호 — 주석은 부르는 쪽이 먼저 걷는다 */
function stringLiterals(src: string): Array<{ text: string; line: number; at: number }> {
  const out: Array<{ text: string; line: number; at: number }> = [];
  const re = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ text: m[0].slice(1, -1), line: src.slice(0, m.index).split('\n').length, at: m.index });
  return out;
}
const unusedKeys = (table: Record<string, string>, used: Set<string>) => Object.keys(table).filter((k) => !used.has(k));

/**
 * 라우터 분류 = 전수(새 라우터는 둘 중 하나에 들어와야 통과) — 12기능 라우터는 아래 R10 · R11 · R15 를 0 으로 지킨다.
 *   축 밖 라우터 = 이번 구조체크(한 줄 프롬프트 12기능) 밖 · 다음 축에서 같은 시험을 켠다(원장 §7 추가 과제).
 */
const ONE_LINE_ROUTERS = new Set([
  'ai.ts', 'ai-line.ts', 'dm.ts', 'email.ts', 'cdp.ts', 'sns.ts', 'event-campaigns.ts', 'image-studio.ts', 'marketing-planner.ts',
  'planner-recheck-public.ts', 'autosend-stop-public.ts', 'journey-pause-public.ts', 'mall-products.ts', 'assets.ts', 'line-templates.ts',
  'send-policy.ts', 'targets.ts', 'saved-segments.ts',
]);
const OUT_OF_AXIS = (reason: string, files: string[]) => Object.fromEntries(files.map((f) => [f, reason]));
const OUT_OF_AXIS_ROUTERS: Record<string, string> = {
  ...OUT_OF_AXIS('슈퍼관리자 · 직원 도구', ['admin.ts', 'admin-ops-records.ts', 'admin-sync.ts', 'admin/login-blocks.ts', 'billing.ts', 'gateway-templates.ts', 'pay-mappings.ts', 'marketing-diagnosis-admin.ts', 'sales-outreach.ts']),
  ...OUT_OF_AXIS('결제 · 정산 · 요금제', ['payments.ts', 'balance.ts', 'charge-approve.ts', 'agent-charge-orders.ts', 'plans.ts', 'plan-term.ts', 'invoice-public.ts', 'popbill-webhook.ts']),
  ...OUT_OF_AXIS('문자 · 알림톡 직접 발송 축', ['campaigns.ts', 'results.ts', 'alimtalk.ts', 'sms-templates.ts', 'spam-filter.ts', 'send-checks.ts', 'mms-images.ts', 'unsubscribes.ts', 'test-contacts.ts', 'manage-scheduled.ts', 'auto-campaigns.ts', 'sender-registration.ts', 'manage-callbacks.ts', 'short-url.ts']),
  ...OUT_OF_AXIS('대행(계약 기능)', ['agency-send.ts', 'agency-approve.ts', 'campaign-agency.ts']),
  ...OUT_OF_AXIS('고객 DB · 쇼핑몰 연동', ['customers.ts', 'upload.ts', 'address-books.ts', 'sync.ts', 'cafe24.ts', 'imweb.ts', 'woocommerce.ts', 'naver-commerce.ts', 'makeshop.ts', 'godo.ts', 'analysis.ts', 'insight.ts']),
  ...OUT_OF_AXIS('계정 · 회사 · 관리 · 도움말', ['auth.ts', 'companies.ts', 'manage-users.ts', 'manage-stats.ts', 'identity-return.ts', 'onboarding.ts', 'help.ts', 'internal-alert.ts', 'design-templates.ts', 'ai-memory.ts', 'ai-usage.ts']),
  ...OUT_OF_AXIS('공개 소개 · 진단 · 영업 표본', ['intro-public.ts', 'outreach-public.ts', 'marketing-diagnosis-public.ts', 'marketing-diagnosis.ts']),
};
describe('라우터 분류 전수(1025) — 12기능 라우터 · 축 밖 라우터(이유) 둘 중 하나', () => {
  it('모든 라우터 파일이 분류에 있고 · 겹치지 않고 · 없는 파일이 분류에 없다', () => {
    const all = ALL_ROUTERS;
    expect(all.length).toBeGreaterThan(60);
    expect(all.filter((f) => !ONE_LINE_ROUTERS.has(f) && !OUT_OF_AXIS_ROUTERS[f])).toEqual([]);
    expect(all.filter((f) => ONE_LINE_ROUTERS.has(f) && OUT_OF_AXIS_ROUTERS[f])).toEqual([]);
    expect([...ONE_LINE_ROUTERS, ...Object.keys(OUT_OF_AXIS_ROUTERS)].filter((f) => !all.includes(f))).toEqual([]);
  });
});

// ── R1 넓힘 ──
describe('R1 넓힘(1025) — 서버 고객 문장의 단가 · 발송 시각 = 단가표 · 설정 한 곳 · 플래너 발송일 = 서버 식', () => {
  it('서버 문장에 「N크레딧」 숫자 0(단가는 getCreditCost · 문장은 ${} 로 싣는다)', () => {
    const hits: string[] = [];
    for (const f of SERVER_SRC) {
      if (f === 'utils/ai-credit-calc.ts') continue;
      for (const s of stringLiterals(stripComments(be(f)))) {
        const t = s.text.replace(/\$\{[^}]*\}/g, '');
        if (/[가-힣]/.test(t) && /(?<![\w.])[1-9][\d,]*\s?크레딧/.test(t)) hits.push(`${f}:${s.line} ${t.slice(0, 40)}`);
      }
    }
    expect(hits).toEqual([]);
  });
  it('브랜드메시지 발송 창 문장 = brandSendWindowError 한 곳(분 값으로 만든다 · 두 파일 글자 0)', () => {
    for (const f of ['utils/brand-message.ts', 'routes/campaigns.ts']) {
      const src = stripComments(be(f));
      expect(src, f).not.toMatch(/오전 8시부터|8시 50분/);
      expect(src, f).toMatch(/brandSendWindowError\(\)/);
    }
  });
  it('플래너 발송일 화면 함수 = 서버 식(같은 입력 · 같은 답 · 화면만 빈 칸 = null)', async () => {
    const { computeTouchpointDate } = await import('../marketing-planner');
    const { plannerSendDateOf } = await import('../../../../frontend/src/utils/planner-dates');
    const rules: any[] = [
      { anchor: 'start' }, { anchor: 'end' }, { anchor: 'before_start' }, { anchor: 'before_start', offsetDays: 3 },
      { anchor: 'before_start', offsetDays: 1 }, { anchor: 'start', on: '2026-11-07' }, { anchor: 'end', on: '2026-12-31' }, {},
    ];
    const spans: Array<[string, string]> = [['2026-11-03', '2026-11-09'], ['2026-03-01', '2026-03-01'], ['2027-01-01', '2027-01-31']];
    let n = 0;
    for (const r of rules) for (const [s, e] of spans) { expect(plannerSendDateOf(r, s, e), JSON.stringify([r, s, e])).toBe(computeTouchpointDate(r, s, e)); n++; }
    expect(n).toBe(24);
    expect(plannerSendDateOf({ anchor: 'start' }, '', '2026-11-09')).toBeNull();
  });
});

// ── R3 넓힘 ──
describe('R3 넓힘(1025) — 회사 전체 수치를 사람에게 보내는 문자 = 관리자 연락처(만든 사람 아무나 0)', () => {
  it('회사 전체 범위(null)로 만든 월 결과를 보내는 자리는 만든 사람 대신 null(관리자 순 · 공용 연락처 CT)', () => {
    const hits: string[] = [];
    let seen = 0;
    for (const f of SERVER_SRC.filter((x) => x.startsWith('utils/'))) {
      const src = stripComments(be(f));
      for (const m of src.matchAll(/loadMonthlyResult\(\s*\w+\s*,\s*\w+\s*,\s*null\s*\)/g)) {
        seen++;
        const tail = src.slice(m.index ?? 0, (m.index ?? 0) + 3000);
        const call = tail.match(/notifyPlanner\(\s*([^,]+),\s*([^,]+),/);
        if (!call || call[2].trim() !== 'null') hits.push(`${f} · ${call ? call[2].trim() : '보내는 자리 없음'}`);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});

// ── R4 ──
/** 차감 원장 직접 호출 허용(발송 · 정산 · 등록 · 공용 CT) — 그 밖 AI 결과는 runChargedAi(성공 뒤 차감 한 규칙 D1 = A) */
const DIRECT_DEDUCT_OK: Record<string, string> = {
  'utils/ai-credit.ts': '원장 CT 자신(settleCreditAfterSuccess · runChargedAi 가 이것을 부른다)',
  'services/ai-orchestrator.ts': '풀분석 묶음 진입 1회 정산(runInCreditBundle 묶음의 주인)',
  'utils/campaign-quick.ts': '만들기 v1 돈 순서(견적 결박 → 시도 토큰 키 차감 → 실패 시 만든 행 회수 · BuildDeps 계약 시험)',
  'utils/continuous-operator.ts': '자동마케팅 저장 · 회차 발송 크레딧(발송 · 등록)',
  'utils/journey-activation.ts': '여정 켜기 크레딧(등록)',
  'utils/journey-ai-generator.ts': '여정 다듬기(잔액 부족 = 던짐 · 결과 전 차감)',
  'utils/journey-draft-save.ts': '여정 초안 저장 크레딧(등록)',
  'utils/journey-executor.ts': '여정 발송 크레딧(발송)',
  'utils/one-line-ct/index.ts': '한 줄 판정 크레딧(한 줄 주문 CT · 성공 뒤)',
  'utils/planner-executor.ts': '플래너 당일 문안비(발송 접수 뒤)',
  'utils/predictive-worker.ts': '예측 일 갱신(회사 + 날짜 멱등 · 정산)',
  'routes/ai.ts': '풀분석 진입 정산(라우트가 묶음 주인 · orchestrate)',
};
describe('R4 넓힘(1025) — 원장 직접 차감 = 허용 목록 · 회사 AI 호출 = 묶음 안', () => {
  it('deductCreditOutcome · deductCreditSafe 를 직접 부르는 파일 = 허용 목록(이유)', () => {
    const files = SERVER_SRC.filter((f) => /\b(?:deductCreditOutcome|deductCreditSafe)\(/.test(stripComments(be(f))));
    const used = new Set(files.filter((f) => DIRECT_DEDUCT_OK[f]));
    expect(files.filter((f) => !DIRECT_DEDUCT_OK[f])).toEqual([]);
    expect(unusedKeys(DIRECT_DEDUCT_OK, used)).toEqual([]);
  });
});

// ── R4 짝(1026 · Codex 1R 돈 묶음) — ① 만든 것을 걷기 전에 내놓은 자리 = settleOrUndo 한 벌 ② 쓸 결과 판정 = 최종 결과 기준 ──
/** accept 가 늘 참인 자리(쓸 수 없는 결과면 run 이 던진다) */
const ACCEPT_ALWAYS_OK: Record<string, string> = {
  'utils/ai-segment-generator.ts': '조건 변환은 쓸 수 없는 결과면 던진다(빈 조건 · 형식 오류 · 검증 실패 = SegmentGenerationError)',
  'services/ai.ts': '타겟 추천 = 형식 오류면 던지고 · 조건이 비어도 채널 · 시각 · 변수 추천이 결과다',
};
describe('R4 짝(1026) — 걷기 전 내놓은 결과는 한 함수로 되돌리고 · 쓸 결과는 최종 결과로 판정한다', () => {
  it('정산을 try 로 감싸 손으로 되돌리는 꼴 0(되돌리기 실패 = 경보가 있는 settleOrUndo 한 벌)', () => {
    const bad = SERVER_SRC.filter((f) => /try\s*\{\s*await settleCreditAfterSuccess\(/.test(stripComments(be(f))));
    expect(bad).toEqual([]);
    const ct = stripComments(be('utils/ai-credit.ts'));
    const so = ct.slice(ct.indexOf('export async function settleOrUndo('), ct.indexOf('export async function settleCreditInTx('));
    expect(so).toContain("tag: 'ORPHAN'");
    expect(so).toContain('throw err;');
  });
  it('accept 가 늘 참인 자리 = 면제(이유)뿐 · 낡은 면제 0', () => {
    const found = SERVER_SRC.filter((f) => /accept:\s*\(\s*\w*\s*\)\s*=>\s*true\b/.test(stripComments(be(f))));
    expect(found.filter((f) => !ACCEPT_ALWAYS_OK[f])).toEqual([]);
    expect(Object.keys(ACCEPT_ALWAYS_OK).filter((k) => !found.includes(k))).toEqual([]);
  });
  // ★ 1026 Codex 2R — AI JSON 칸 = 글일 때만(aiStr) · String(parsed.x || …) 는 객체 칸을 「[object Object]」 글로 만들어 화면에 내고 「쓸 결과」로 셌다
  it('AI JSON 을 읽는 파일 = String(parsed.칸 || …) 0(aiStr 한 벌)', () => {
    const bad = SERVER_SRC.filter((f) => { const s = stripComments(be(f)); return /extractJsonFromAiText\(/.test(s) && /String\(parsed\??\.\w+\s*\|\|/.test(s); });
    expect(bad).toEqual([]);
    expect(stripComments(be('utils/ai-json.ts'))).toContain('export function aiStr(v: unknown, fallback = \'\'): string {');
  });
  it('저장 트랜잭션 안의 차감 = settleCreditInTx(같은 연결) · 다른 연결 정산 0(브랜드 보이스)', () => {
    const mem = stripComments(be('routes/ai-memory.ts'));
    const i = mem.indexOf('await settleCreditInTx(client, {');
    expect(i).toBeGreaterThan(-1);
    expect(mem.lastIndexOf("await client.query('BEGIN');", i)).toBeGreaterThan(-1);
    expect(mem.indexOf("await client.query('COMMIT');", i)).toBeGreaterThan(i);
    expect(mem).not.toContain('settleCreditAfterSuccess(');
  });
});

// ── R5 넓힘 ──
describe('R5 넓힘(1025) — 보인 글 = 나가는 글(자리마다 같은 함수)', () => {
  it('#88 테스트 메일 = 실발송과 같은 껍데기(composeCampaignShell) · (광고) 붙이기는 그 함수 한 곳', () => {
    const route = stripComments(be('routes/email.ts'));
    const t = route.indexOf("router.post('/campaigns/:id/test-send'");
    expect(t).toBeGreaterThan(-1);
    expect(route.slice(t, t + 4000)).toContain('composeCampaignShell(');
    const eng = stripComments(be('utils/email-channel.ts'));
    expect(eng).toContain('const shell = composeCampaignShell(campaign, adFooter);');
    expect((eng.match(/\(광고\) \$\{subject\}/g) || []).length).toBe(1);   // 메일 제목 (광고) = composeCampaignShell 한 곳(미오픈자 SMS 문장은 다른 채널)
    expect((route.match(/\(광고\) \$\{/g) || []).length).toBe(0);
  });
  it('#28 멈춤 링크 화면 · 담당자 정지 = 나가는 문안 함수(loadProposalFinalCopy) · #29 화면 검사 = 발송 조립(operatorFinalCopyAt)', () => {
    expect(stripComments(be('utils/autosend-stop-link.ts'))).toContain('loadProposalFinalCopy(');
    const op = stripComments(be('utils/continuous-operator.ts'));
    const a = op.indexOf('export async function adminStopProposal(');
    expect(op.slice(a, op.indexOf('\n}\n', a))).toContain('loadProposalFinalCopy(');
    const r = op.indexOf('export async function startProposalSpamRetest(');
    expect(op.slice(r, op.indexOf('\n}\n', r))).toContain('operatorFinalCopyAt(');
    expect(SERVER_SRC.filter((f) => /\bresolveRetestCopy\b/.test(stripComments(be(f))))).toEqual([]);
  });
});

// ── R7 넓힘(함수 단위) ──
const SPAM_RUNNER = /\b(?:autoSpamTestWithRegenerate|runPlannerSpamTest|getSpamTestBatchResults|autoSpamTest)\(/;
const SPAM_VERDICT = /\b(?:spamVerdictOf|spamVerdictWithRetry|batchVerdictOf|spamCheckPlannerVerdict|testCopyVariantsUntilPass)\(/;
describe('R7 넓힘(1025) — 스팸 결과를 읽는 함수 = 공용 판정 셋(함수 단위)', () => {
  it('검사를 부르고 결과(spamResult · passedVariantId)를 읽는 단위는 공용 판정을 부른다', () => {
    const { units } = scanSources();
    const bad = units.filter((u) => !u.file.endsWith('spam-test-queue.ts') && SPAM_RUNNER.test(u.body)
      && /\.spamResult\b|\.passedVariantId\b/.test(u.body) && !SPAM_VERDICT.test(u.body)).map((u) => u.key);
    expect(bad).toEqual([]);
  });
  it('원값 비교(spamResult === \'pass\')로 통과를 정하지 않는다(공용 판정 파일 밖 0)', () => {
    const hits = SERVER_SRC.filter((f) => !f.endsWith('spam-test-queue.ts'))
      .flatMap((f) => stripComments(be(f)).split('\n').map((l, i) => [f, i + 1, l] as const))
      .filter(([, , l]) => /spamResult\s*===\s*'pass'|spamResult\s*!==\s*'pass'/.test(l) && !/spamVerdictOf\(/.test(l)
        && !/spamResult\s*!==\s*'pass'\s*\?\s*[\w?.]+\.spamResult\s*:\s*'failed'/.test(l))   // 판정 뒤 기록 글자(통과 아닌 원값 그대로 · 아니면 failed)
      .map(([f, n]) => `${f}:${n}`);
    expect(hits).toEqual([]);
  });
  it('#46 고친 문안 검사 = 판정 셋(막힘 · 장애를 한 값으로 접지 않는다)', () => {
    const src = stripComments(be('utils/planner-copy.ts'));
    expect(src).not.toMatch(/\.then\(\s*\(r\)\s*=>\s*!!r\s*\)/);
    expect(src).not.toMatch(/export async function spamCheckPlannerCopy\(/);
  });
});

// ── R10 넓힘 ──
/** 유틸 · 서비스의 한국어 일반 Error — 사람이 고칠 입력 · 상태가 아닌 것(내부 · 설정 · 외부 원문 · AI 해석 · DB 마이그레이션 안내) · 키 = 파일|문장 앞머리 */
const PLAIN_ERROR_OK: Record<string, string> = {
  "utils/account-action.ts|SYSTEM_SMS_CALLBACK 환경변수": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/agency-send-intake.ts|수신자 적재 불일치: 기대 … 실제 …": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/agency-send-link.ts|JWT_SECRET 미설정: 승인 토큰을 서": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/agent-charge-core.ts|주문 원복 불일치: …/…": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/ai-json.ts|extractJsonFromAiText: 빈": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "utils/alimtalk-api.ts|[IMC] 환경변수가 설정되지 않았습니다: ": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/auto-campaign-worker.ts|발송 대상 조건이 비어 있음 (조건 없는 전": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/autosend-stop-link.ts|JWT_SECRET 미설정: 자동마케팅 멈춤": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/basic-trial.ts|무료체험 요금제가 존재하지 않습니다.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/basic-trial.ts|고객사를 찾을 수 없습니다.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/batch-ai.ts|ANTHROPIC_API_KEY 환경변수가 ": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/batch-ai.ts|requests 배열은 1건 이상 필요합니다": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/batch-ai.ts|Anthropic Batch API 1회 한": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|서명 비밀키가 설정되지 않았습니다.": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/billing-080.ts|정규형 불가, 비정수 금액": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|KT 명세서에서 080 번호별 금액을 읽지 ": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/billing-080.ts|대상월 형식이 올바르지 않습니다 (YYYY-": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|항목 내용을 입력해주세요.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|건당 금액(공급가)을 1원 이상 정수로 입력": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|수량은 1~100 사이로 입력해주세요.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|회사를 선택해주세요.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|그 달 정산이 이미 발행돼 있어 항목을 추가": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|그 달 전체가 이미 발행된 정산 기간(또는 ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|판독 결과 서명이 유효하지 않습니다. 명세서": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-080.ts|명세서 검산에 실패해 반영할 수 없습니다: ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-bulk.ts|발급 대상에서 제외됨: 대기 중 수동 정산 ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-issue.ts|청구 상세 적재 수량이 맞지 않습니다 (적재": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-lock.ts|정산 잠금 대상 중 실재하지 않는 고객사가 ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-recipients.ts|수신자 이메일 형식이 올바르지 않습니다: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/billing-recipients.ts|알 수 없는 문서 유형입니다: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/biz-registration-extract.ts|판독할 파일이 없습니다. jpg/png/we": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/biz-registration-extract.ts|사업자등록증에서 정보를 읽지 못했습니다. 글": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/brand-message.ts|object 아님": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/cafe24-client.ts|CAFE24_CLIENT_ID / CAFE2": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/cafe24-client.ts|카페24 OAuth 환경변수가 설정되지 않았": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/cafe24-client.ts|카페24 토큰 교환 실패 (…): …": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/cafe24-client.ts|카페24 API 호출 실패 (…): …": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/campaign-sync-worker.ts|여정 결과 안내 적재 0건": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/cdp-member-token.ts|회원 토큰 서명 키가 없습니다(서버 설정).": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/channel-eligibility.ts|안전하지 않은 테이블 alias: …": "내부 불변식(SQL 조각 안전)",
  "utils/charge-approve-link.ts|JWT_SECRET 미설정: 승인 토큰을 서": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/citations.ts|ANTHROPIC_API_KEY 환경변수가 ": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/citations.ts|Citations 사용할 documents ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/company-merge.ts|파생할 수 없는 FK 서명: …": "내부 불변식(SQL 조각 안전)",
  "utils/company-merge.ts|허용되지 않는 테이블명: …": "내부 불변식(SQL 조각 안전)",
  "utils/company-merge.ts|허용되지 않는 컬럼명: …": "내부 불변식(SQL 조각 안전)",
  "utils/company-smtp-client.ts|암호화할 비밀번호 필수": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/company-smtp-client.ts|복호화할 비밀번호 필수": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/company-smtp-client.ts|companyId 필수": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/company-smtp-client.ts|companyId + toEmail 필수": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/company-smtp-client.ts|회사 SMTP 설정 조회 실패": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/company-smtp-client.ts|companyId + to + subject": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/continuous-operator.ts|DB 마이그레이션 필요: continuous": "DB 마이그레이션 안내(운영자 503 · db_alter_safety_net)",
  "utils/continuous-operator.ts|스팸 검사 결과를 저장할 제안 행이 없습니다": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/continuous-operator.ts|발송 시도 표식 실패(제안 상태 변경)": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/continuous-operator.ts|발송 크레딧 차감을 확인하지 못함": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/crm-agency-proposal-core.ts|AI가 유효한 캠페인 플랜을 생성하지 못했습": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "utils/crm-agency-proposal.ts|회사를 찾을 수 없습니다.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/custom-self-hosted-adapter.ts|자체 호스팅 자사몰은 OAuth 흐름이 없습": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/custom-self-hosted-adapter.ts|자체 호스팅 자사몰은 OAuth code 교": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/custom-self-hosted-adapter.ts|자체 호스팅 자사몰은 token refres": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/demo-data.ts|합성 데이터 키가 시연 회사·허용 목록 회사": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/demo-data.ts|옛 방식으로 만든 시연 회사입니다. 새 시연": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/direct-send-core.ts|중화 UPDATE rowCount=…": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/direct-send-core.ts|queued 전환 rowCount=…": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/email-channel.ts|email_campaigns.design c": "DB 마이그레이션 안내(운영자 503 · db_alter_safety_net)",
  "utils/email-tracking.ts|EMAIL_TRACKING_SECRET / ": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/event-brief.ts|JSON 없음": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "utils/fk-delete-plan.ts|… 지운 수(…)가 센 수(…)와 달라 멈춥": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/gateway-template-mapping.ts|GATEWAY_TMPL_API_TOKEN 미": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/godo-adapter.ts|고도몰은 폴링 연동입니다. 한줄로 관리자 →": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/godo-adapter.ts|고도몰은 OAuth code 교환이 없습니다": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/godo-adapter.ts|고도몰은 token refresh가 없습니다": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/godo-adapter.ts|고도몰은 webhook을 사용하지 않습니다(": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/imweb-client.ts|IMWEB_CLIENT_ID / IMWEB_": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/imweb-client.ts|아임웹 OAuth 환경변수가 설정되지 않았습": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/imweb-client.ts|아임웹 API 호출 실패 (…): …": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/imweb-client.ts|아임웹 API 호출 실패(재시도 소진)": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/inapp-ai-generator.ts|AI 응답 JSON 파싱 실패: …\\n응답 ": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "utils/inapp-explainer.ts|companyId + messageId 필수": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/inapp-funnel-stats.ts|companyId + messageId 필수": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/inapp-funnel-stats.ts|companyId 필수": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/inapp-message.ts|cdp_inapp_messages.desig": "DB 마이그레이션 안내(운영자 503 · db_alter_safety_net)",
  "utils/inapp-message.ts|cdp_inapp_messages.image": "DB 마이그레이션 안내(운영자 503 · db_alter_safety_net)",
  "utils/inapp-message.ts|cdp_inapp_messages.poste": "DB 마이그레이션 안내(운영자 503 · db_alter_safety_net)",
  "utils/inapp-quick-action.ts|companyId + messageId 필수": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/inapp-segment-matcher.ts|companyId는 필수입니다.": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/inapp-variant-optimizer.ts|companyId + parentMessag": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/inicis-client.ts|[inicis-client] INICIS_M": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/invoice-confirm.ts|정산 행을 찾지 못했습니다": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/journey-ai-generator.ts|추천 칸 수(…)보다 적게 설계됐습니다(…)": "AI 응답 실패(계획보다 적게 설계 · 다시 시도)",
  "utils/journey-executor.ts|SMS 큐 적재 0건(배치 INSERT 실패": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/journey-identity-signals.ts|안전하지 않은 테이블 alias: …": "내부 불변식(SQL 조각 안전)",
  "utils/journey-intake-grace.ts|안전하지 않은 테이블 alias: …": "내부 불변식(SQL 조각 안전)",
  "utils/journey-pause-handler.ts|JOURNEY_PAUSE_TOKEN_SECR": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/journey-send-claim.ts|단계 캠페인을 찾지 못해 적재 여부를 확인할": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/journey-send-claim.ts|발송 테이블을 찾지 못해 적재 여부를 확인할": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/liquid-templating.ts|Tag 미종결 (position …)": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|Output 미종결 (position …)": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|assign 문법 오류 (position …": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|미지원 tag: … (position …)": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|if 분기 토큰 오류": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|if 미종결: 예상치 못한 tag: …": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|for 문법 오류 (position …)": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|for 미종결": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|case 미종결: 예상치 못한 tag: …": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/liquid-templating.ts|comment 미종결": "템플릿 파서 안쪽(검증 함수가 받아 칸 번호 문장으로 바꾼다 · #119)",
  "utils/makeshop-client.ts|메이크샵 토큰 발급 응답에 access_to": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/makeshop-client.ts|메이크샵 API 호출 실패 (…): …": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/makeshop-client.ts|메이크샵은 OAuth 리다이렉트가 아니라 애": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/makeshop-client.ts|메이크샵은 authorize code 교환을": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/makeshop-client.ts|메이크샵 자격(client_id/secret": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/mall-consent.ts|consentSql: 고객 id 열은 표(별": "내부 불변식(SQL 조각 안전)",
  "utils/mall-consent.ts|consentCountTrue: 전화 열은 ": "내부 불변식(SQL 조각 안전)",
  "utils/mfa.ts|SYSTEM_SMS_CALLBACK 환경변수": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/multi-goal-decisioning.ts|AI 응답에서 JSON 찾을 수 없음": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "utils/naver-commerce-client.ts|네이버 커머스 토큰 발급 응답에 access": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/naver-commerce-client.ts|네이버 커머스 API 호출 실패 (…): …": "외부 연동 · 조회 실패 원문(로그 · 고객에게는 라우트 안내 문장)",
  "utils/naver-commerce-client.ts|네이버 스마트스토어는 OAuth 리다이렉트가": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/naver-commerce-client.ts|네이버 스마트스토어는 authorize co": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/onboarding-wizard.ts|잘못된 step 번호: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/payment-processor.ts|[payment-processor] 결제 금": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/payment-processor.ts|[payment-processor] 결제 승": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/payment-processor.ts|[payment-processor] pend": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/payment-processor.ts|[payment-processor] 결제 주": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/payment-processor.ts|[payment-processor] 회사 영": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/payment-processor.ts|[payment-processor] 선불 회": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/payment-processor.ts|[payment-processor] paym": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/plan-feature-intros-serve.ts|JWT_SECRET 없음: 영상 주소를 서명": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/plan-recommend.ts|answers 검증 미통과: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/planner-executor.ts|문안비 차감을 확인하지 못해 보내지 않았습니": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/planner-review.ts|쌍 생략이 일부만 적용됐습니다": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/planner-review.ts|쌍 재확인 진입이 일부만 적용됐습니다": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/prepaid.ts|company_id=… 잔액 갱신 실패": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/sales-outreach-catalog.ts|카탈로그 DM 발행 주소를 만들지 못했습니다": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-jobs.ts|AI가 빈 문안을 반환했습니다": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-jobs.ts|OUTREACH_COMPANY_ID·OUTR": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-jobs.ts|앞 단계 산출물이 없어 메일을 조립할 수 없": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|OUTREACH_COMPANY_ID·OUTR": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|이미지 생성 서비스가 준비되지 않았습니다.": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|임시 저장소 기록에 실패했습니다.": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|포스터 임시 저장에 실패했습니다.": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|이미지 저장에 실패했습니다.": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|AI가 섹션을 돌려주지 않았습니다.": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|면허 인용에 출처 없는 배너 전사문이 섞였습": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|내부 발행은 내부 전용 회사 계정으로만 가능": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|모바일 DM 발행 주소를 만들지 못했습니다.": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-produce.ts|이메일 버튼 라벨은 8자 이내여야 합니다: ": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/sales-outreach-purge.ts|DM 중지 실패(…): …": "직원 영업 도구(슈퍼관리자 화면)",
  "utils/send-usage-aggregation.ts|에이전트 발송 통계를 조회하지 못했습니다(P": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/sender-auth.ts|JWT_SECRET 미설정: 기기 증명을 만": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/sender-registration.ts|승인 대기 상태의 담당자를 찾을 수 없습니다": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|먼저 담당자 등록 및 위임장 승인을 완료해주": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|이미 동일 번호로 승인 대기 중인 신청이 있": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|이미 등록된 발신번호입니다.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|승인 대기 상태의 신청을 찾을 수 없습니다.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|이미 등록된 발신번호입니다. 신청을 반려 처": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|… 신청을 반려해주세요.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|… 상한을 조정한 뒤 승인해주세요.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|해당 발신번호를 찾을 수 없습니다.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/sender-registration.ts|같은 회사에 속하지 않는 사용자가 포함되어 ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/short-url.ts|companyId는 필수입니다.": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/short-url.ts|단축 URL 생성 실패 (hash 충돌 3회": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/sms-queue.ts|MMS는 이미지 첨부가 필수입니다 (inse": "내부 불변식(코드가 넘기는 값 · 사람이 고칠 입력 아님)",
  "utils/spam-test-queue.ts|환불 미완(… …건)": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/spam-test-queue.ts|환불 미완(…)": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/staging-sweeper.ts|JWT_SECRET 미설정: 발송 준비 보관": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/taxbill-popbill.ts|작성일자 형식 오류: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|uuid 형식 오류: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|문서번호 규격 위반: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|수정발행은 modifyCode와 당초 국세청": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|지원하지 않는 수정사유 코드: … (지원 =": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|…이(가) 정수가 아닙니다: …, 원 미만 ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|합계 불일치: 공급가액 … + 세액 … ≠ ": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/taxbill-popbill.ts|원본 계산서에 음수 금액: 공급가액 … / ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|부호가 섞인 장: 공급가액 … / 세액 …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|수정 장의 합계가 0원. 바꿀 것이 없는 수": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|사유 …(해제·이중발급)는 음(-) 문서만 ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|공급받는자 사업자번호가 없거나 형식 오류: ": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|공급자(인비토) 사업자번호 형식 오류: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/taxbill-popbill.ts|참조 재전송 테이블(taxbill_email": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/totp.ts|JWT_SECRET 미설정: 2FA 등록 토": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/web-push.ts|Web Push 발송 환경이 준비되지 않았습": "서버 설정 누락(운영 설정 · 고객에게는 라우트 안내 문장)",
  "utils/woocommerce-adapter.ts|우커머스는 token refresh 가 없습": "연동 방식 불변식(부르지 않는 길 · 코드 잘못)",
  "utils/woocommerce-adapter.ts|우커머스 연동이 없는 몰입니다: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/woocommerce-plugin-zip.ts|플러그인 소스가 없습니다: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/zip-store.ts|zip 항목 이름이 올바르지 않습니다: …": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/zip-store.ts|zip 항목이 없습니다.": "축 밖 모듈(정산 · 결제 · 연동 · 관리) · 다음 구조체크에서 사용자 조건을 가른다",
  "utils/dm/dm-ab-test.ts|short_code 발급 실패": "내부 처리 실패(로그 · 경보 · 고객에게는 라우트 안내 문장)",
  "utils/dm/dm-ai.ts|빈 응답": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "utils/dm/dm-ai.ts|JSON 형식이 아닙니다: ": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "utils/dm/dm-ai.ts|JSON 파싱 실패: …, raw: …": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "utils/dm/dm-ai.ts|JSON 배열 형식이 아닙니다": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "services/ai-orchestrator.ts|OrchestratorAI: target_a": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
  "services/ai-orchestrator.ts|OrchestratorAI: message_": "AI 응답 해석 실패(다시 시도 · 고객에게는 라우트 안내 문장)",
};
describe('R10 넓힘(1025) — 사용자 조건 = 오류 종류(UserFacingError) · 라우트 catch = 공용 응답', () => {
  const found: string[] = [];
  for (const f of SERVER_SRC.filter((x) => !x.startsWith('routes/'))) {
    for (const m of stripComments(be(f)).matchAll(/throw new Error\(\s*(['`"])((?:(?!\1).)*?[가-힣](?:(?!\1).)*?)\1/g)) {
      found.push(`${f}|${m[2].replace(/\$\{[^}]*\}/g, '…').slice(0, 24)}`);
    }
    // ★ 1025 빈틈 — 「값 || '한국어'」 꼴도 같은 결함(옛 시험은 글 머리만 봐 operator-audience 두 자리를 놓쳤다)
    for (const m of stripComments(be(f)).matchAll(/throw new Error\(\s*[^'`"\s)][^;\n]*?\|\|\s*(['`"])((?:(?!\1).)*?[가-힣](?:(?!\1).)*?)\1/g)) {
      found.push(`${f}|${m[2].replace(/\$\{[^}]*\}/g, '…').slice(0, 24)}`);
    }
  }
  it('한국어 일반 Error = 면제(이유)뿐 · 낡은 면제 0', () => {
    expect(found.filter((x) => !PLAIN_ERROR_OK[x])).toEqual([]);
    expect(Object.keys(PLAIN_ERROR_OK).filter((k) => !found.includes(k))).toEqual([]);
  });
  // ★ 1026 Codex 1R — 공용 응답이 다른 if(DB 마이그레이션 등) 안에 갇히면 일반 길에서 안 불린다(40곳 · 위 시험은 「앞에 있다」만 봐 통과했다)
  it('12기능 라우터의 5xx catch 는 공용 응답(respondUserError)을 먼저 부른다 · catch 바닥 높이(일반 길) · 안쪽은 「오류 종류면」 블록만 · throw 뒤 0', () => {
    const bad: string[] = [];
    for (const file of ALL_ROUTERS.filter((f) => ONE_LINE_ROUTERS.has(f))) {
      const src = stripComments(be(`routes/${file}`));
      for (const m of src.matchAll(/catch\s*\(\s*(\w+)(?:\s*:\s*\w+)?\s*\)\s*\{/g)) {
        const start = (m.index ?? 0) + m[0].length;
        let i = start, depth = 1;
        const opens: number[] = [];
        let topLevelCall = false, ufeBlockCall = false;
        let lastTop5xx = -1, firstTopCall = -1;
        while (i < src.length && depth) {
          const ch = src[i];
          if (ch === '{') { depth++; opens.push(i); }
          else if (ch === '}') { depth--; opens.pop(); }
          else if (src.startsWith('respondUserError(', i) || src.startsWith('userErrorResponse(', i)) {
            if (depth === 1) { topLevelCall = true; if (firstTopCall < 0) firstTopCall = i; }
            else {
              const opener = src.slice(src.lastIndexOf('\n', opens[opens.length - 1]) + 1, opens[opens.length - 1]);
              if (/instanceof UserFacingError/.test(opener)) ufeBlockCall = true;
              else bad.push(`${file}:${src.slice(0, i).split('\n').length} 갇힘`);
            }
            const before = src.slice(src.lastIndexOf(';', src.lastIndexOf('\n', i)) - 40, src.lastIndexOf('\n', i));
            if (/\bthrow \w+;\s*$/.test(before)) bad.push(`${file}:${src.slice(0, i).split('\n').length} throw 뒤`);
          } else if (depth === 1 && lastTop5xx < 0 && src.startsWith('res.status(', i) && /^res\.status\(\s*5\d\d/.test(src.slice(i, i + 20))) lastTop5xx = i;   // 첫 바닥 5xx
          i++;
        }
        if (lastTop5xx >= 0 && !ufeBlockCall && (!topLevelCall || firstTopCall > lastTop5xx)) bad.push(`${file}:${src.slice(0, m.index).split('\n').length} 일반 길 없음`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('라우트가 오류 글자로 상태를 짐작하지 않는다(필수 · 0건 · 미완료 · 찾을 수 없 · 허용 → 400 꼴 0 · 12기능)', () => {
    const bad: string[] = [];
    for (const file of ALL_ROUTERS.filter((f) => ONE_LINE_ROUTERS.has(f))) {
      stripComments(be(`routes/${file}`)).split('\n').forEach((l, i) => {
        if (/message\??\.includes\('(?:필수|0건|미완료|허용|올바르지|초과|찾을 수 없)/.test(l) && /\?\s*4\d\d\s*:\s*5\d\d|status\(4\d\d\)/.test(l + ' ')) bad.push(`${file}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

// ── R11 넓힘 ──
const R11_ALLOWED_WORDS = /(?<![A-Za-z])(?:DM|SMS|LMS|MMS|RCS|URL|ID|CSV|SMTP|AI|API|SNS|PDF|HTML|QR|PC|VIP|SDK|KB|MB|GB|OK|DB|CDP|KT|SKT|LGU|JPG|JPEG|PNG|GIF|WebP|WEBP|MP4|MOV|jpg|jpeg|png|gif|webp|xlsx|xls|csv|txt|Push|Web|In-app|Email|ROI|CTR|KISA|YouTube|Instagram|Kakao|Gmail|Naver|Google|Cafe24|WooCommerce|A|B|C|D|N|X|D-Day|ALTER|https?|www|com|kr|co|app)(?![A-Za-z])/g;
/** 개발자 연동 주소(SDK · 웹훅 · 수집) — 받는 쪽이 개발자라 칸 이름이 맞다 */
const R11_DEV_API_ROUTES: Record<string, string> = {
  'cdp.ts POST /ingest': 'SDK 수집(개발자 API · 칸 이름 = 문서의 칸)', 'cdp.ts POST /identify': 'SDK(개발자 API)', 'cdp.ts POST /event': 'SDK(개발자 API)',
  'cdp.ts POST /order': 'SDK(개발자 API)', 'cdp.ts POST /journey-variants/:variantId/track': 'SDK(개발자 API)', 'cdp.ts POST /inapp/track': 'SDK(개발자 API)',
  'cdp.ts POST /webhook/custom': '자사몰 웹훅(개발자 API · 헤더 이름 = 문서)', 'cdp.ts POST /push/subscribe': 'SDK 웹 푸시(개발자 API)',
  'cdp.ts POST /push/unsubscribe': 'SDK 웹 푸시(개발자 API)', 'cdp.ts POST /bulk-import': '대량 가져오기(개발자 API)', 'cdp.ts POST /member-token': 'SDK 회원 토큰(개발자 API)',
  'cdp.ts GET /push/vapid-public-key': 'SDK 웹 푸시(개발자 API)',
};
describe('R11 넓힘(1025) — 고객 문장에 칸 이름 · 개발 용어 0 · 업로드 원문 0 · 남의 오류 원문 붙이기 0 · 화면 요약 내부 키 0', () => {
  it('12기능 라우터가 돌려주는 고객 문장(error · message)에 칸 이름 · 영어 0(개발자 API 주소는 이유)', () => {
    const bad: string[] = [];
    const used = new Set<string>();
    for (const file of ALL_ROUTERS.filter((f) => ONE_LINE_ROUTERS.has(f))) {
      for (const b of routeBlocks(stripComments(be(`routes/${file}`)))) {
        const id = `${file} ${key(b)}`;
        for (const m of b.body.matchAll(/\b(?:error|message)\s*:\s*(['`"])((?:(?!\1).)*?)\1/g)) {
          const s = m[2];
          if (!/[가-힣]/.test(s) || /DB 마이그레이션/.test(s)) continue;
          const t = s.replace(/\$\{[^}]*\}/g, '').replace(/https?:\/\/\S+/g, '').replace(/\b[a-z]+(?:\.[a-z]+){1,}\b/g, '').replace(R11_ALLOWED_WORDS, '');
          if (!/[A-Za-z]{2,}/.test(t) && !/컬럼|admin|의무\b/.test(t)) continue;
          if (R11_DEV_API_ROUTES[id]) { used.add(id); continue; }
          bad.push(`${id} · ${s.slice(0, 50)}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(unusedKeys(R11_DEV_API_ROUTES, used)).toEqual([]);
  });
  it('업로드 오류 = uploadErrorText(전 라우터 · multer 원문 0)', () => {
    const bad: string[] = [];
    for (const file of ALL_ROUTERS) {
      const src = stripComments(be(`routes/${file}`));
      for (const m of src.matchAll(/\.(?:single|array|fields|any)\([^)]*\)\(\s*req[^,]*,\s*res[^,]*,\s*(?:async\s*)?\(\s*(\w+)/g)) {
        const tail = src.slice(m.index ?? 0, (m.index ?? 0) + 600);
        if (new RegExp(`\\b${m[1]}\\??\\.message\\s*\\|\\|`).test(tail)) bad.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('다른 모듈 오류 원문을 고객 문장에 붙이지 않는다(errors.map(e => e.message).join 꼴을 reason · error 에 0)', () => {
    const bad: string[] = [];
    for (const f of SERVER_SRC) {
      stripComments(be(f)).split('\n').forEach((l, i) => {
        if (/\.map\(\s*\(?\w+\)?\s*=>\s*\w+\.message\s*\)\.join\(/.test(l) && /reason|error\s*:|throw new/.test(l) && !/console\./.test(l)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
  it('화면 요약 · 목록 글에 내부 키(template · card_style · section_type · layout_mode) 원값 0', () => {
    const bad: string[] = [];
    for (const rel of sourceFiles(FE, /\.tsx$/)) {
      stripComments(read(join(FE, rel))).split('\n').forEach((l, i) => {
        if (/\bconst \w*[Kk]ey\s*=/.test(l)) return;   // 비교용 키 글자(화면에 안 나간다)
        if (/\$\{[\w.?]+\.(?:template|card_style|section_type)\s*(?:\|\|[^}]*)?\}/.test(l) || />\s*\{[\w.?]+\.(?:section_type|card_style)\}\s*</.test(l)) bad.push(`${rel}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

// ── R11 짝(1025) — 문장 = 표시 · 판정 = 키 ──
//   경위 = 검수 문장을 사람 말로 다듬자 화면(make-flow)이 옛 문장 글자 정규식으로 알아보던 「버튼 주소 없음 → [넣기]」 ·
//   「꼬리 블록 없음 → 그대로 보낼 수 있어요」가 조용히 꺼졌다 · 예측 근거 주소는 '회사 격리' 글자로 403 을 고르다 500 이 됐다.
//   대상 = 화면 전부 + 12기능 라우터 + utils · services(축 밖 라우터 = 다음 구조체크 · 원장 추가 과제).
const TEXT_JUDGE_OK: Record<string, string> = {
  "components/admin/tabs/PlanRequestsTab.tsx|message.startsWith('[무료체험]')": '요금제 요청 글의 머리표(서버가 붙이는 표식 · 오류 문장 아님)',
  "routes/dm.ts|msg.includes('%DM링크%')": '문안 안의 변수 자리(오류 문장 아님)',
};
describe('R11 짝(1025) — 화면 · 서버가 오류 · 검수 문장을 글자로 판정하지 않는다(판정 = 고정 키 · 오류 종류)', () => {
  const PATS = [
    /\b(?:message|error|reason|msg)\??\.(?:includes|startsWith|endsWith)\(\s*(['"`])[^'"`]*[가-힣][^'"`]*\1\)/,
    /\b(?:message|error|reason|msg)\s*\|\|\s*(['"`])\1\s*\)\.(?:includes|startsWith|endsWith)\(\s*(['"`])[^'"`]*[가-힣]/,   // (err?.message || '').includes('…')
    /\/[^/\n]*[가-힣][^/\n]*\/[gimsuy]*\.test\(\s*[\w.?]+\.(?:message|error|reason)\b/,
    /\b[A-Z][A-Z0-9_]*_RE\.test\(\s*[\w.?]+\.(?:message|error|reason)\s*\)/,
    /\b(?:message|error|msg|reason)\s*===\s*(['"`])[^'"`]*[가-힣]/,
  ];
  const files: Array<[string, string]> = [
    ...sourceFiles(FE, /\.(ts|tsx)$/).filter((f) => !/\.test\./.test(f)).map((f) => [f, read(join(FE, f))] as [string, string]),
    ...SERVER_SRC.filter((f) => !f.startsWith('routes/') || ONE_LINE_ROUTERS.has(f.slice('routes/'.length))).map((f) => [f, be(f)] as [string, string]),
  ];
  it('글자 판정 = 면제(이유)뿐 · 낡은 면제 0', () => {
    const found: string[] = [];
    for (const [rel, src] of files) {
      for (const l of stripComments(src).split('\n')) {
        for (const p of PATS) {
          const m = l.match(p);
          if (m) { found.push(`${rel}|${m[0].slice(0, 60)}`); break; }
        }
      }
    }
    expect(found.filter((x) => !TEXT_JUDGE_OK[x])).toEqual([]);
    expect(Object.keys(TEXT_JUDGE_OK).filter((k) => !found.includes(k))).toEqual([]);
  });
});

// ── R12 넓힘 ──
/** 묶음 SELECT LIMIT(1 아님)에 순서가 없어도 되는 자리 — 키 = 파일|LIMIT 값|FROM 표 */
const LIMIT_NO_ORDER_OK: Record<string, string> = {
  'routes/admin-sync.ts|LIMIT 5|jsonb_array_elements': '실패 행 상세 앞 5건(배열 순서 · 화면이 앞 5건 + 총수를 보인다)',
  'routes/campaigns.ts|LIMIT 0|?': '칸 확인(행 0 · 컬럼 존재 확인)',
  'routes/companies.ts|LIMIT 0|callback_numbers': '칸 확인(행 0)',
  'routes/gateway-templates.ts|LIMIT 3|companies': '같은 이름 회사 몇 곳 경고(존재 확인 · 슈퍼관리자)',
  'routes/manage-callbacks.ts|LIMIT 0|callback_numbers': '칸 확인(행 0)',
  'utils/callback-filter.ts|LIMIT 0|callback_numbers': '칸 확인(행 0)',
  'utils/cdp-webhook-retry-worker.ts|LIMIT 1000|cdp_webhook_deliveries': '지우는 묶음(처리한 행은 조건에서 빠진다 · 순서 무관)',
  'utils/cdp-webhook-retry-worker.ts|LIMIT 500|cdp_webhook_deliveries': '비우는 묶음(처리한 행은 조건에서 빠진다 · 순서 무관)',
  'utils/enabled-fields.ts|LIMIT 200|customers': '표본(값 꼴 판정 · 어느 행이든 같다)',
  'utils/enabled-fields.ts|LIMIT 20|customers': '표본(값 꼴 판정 · 어느 행이든 같다)',
  'utils/enabled-fields.ts|LIMIT 10|customers': '표본(전화 꼴 칸 찾기 · 어느 행이든 같다)',
  'utils/geo-access.ts|LIMIT 2|users': '같은 이름 두 개 확인(1개 · 2개 이상만 가른다)',
  'utils/geo-access.ts|LIMIT 2|companies': '같은 이름 두 개 확인(1개 · 2개 이상만 가른다)',
  'utils/operator-recipients.ts|LIMIT ${SENDABLE_RECIPIENTS_LIMIT}|customers': '발송 대상 목록 상한(실제 대상 수 total 을 함께 내고 초과면 화면이 보내지 않는다 · C-07)',
  'utils/retention-sweeper.ts|LIMIT ${RETENTION_BATCH}|?': '보관 기간 지난 행 지우기 묶음(지운 행은 빠진다 · 순서 무관)',
};
describe('R12 넓힘(1025) — 전 파일 묶음 SELECT 의 LIMIT 에 순서 · 목록 상한 = 잘림 칸', () => {
  it('순서 없는 LIMIT = 면제(이유)뿐 · 낡은 면제 0', () => {
    const found: string[] = [];
    for (const f of SERVER_SRC) {
      for (const { sql } of sqlTemplates(stripComments(be(f)))) {
        const s = sql.replace(/--[^\n]*/g, '');
        if (!/\bSELECT\b/i.test(s)) continue;
        for (const lm of s.matchAll(/\bLIMIT\s+(\$\{[^}]+\}|\$\d+|\d+)/gi)) {
          if (lm[1] === '1') continue;
          const before = s.slice(Math.max(0, (lm.index ?? 0) - 600), lm.index);
          const sel = before.toUpperCase().lastIndexOf('SELECT');
          if (/\bORDER\s+BY\b/i.test(sel >= 0 ? before.slice(sel) : before)) continue;
          const table = ((sel >= 0 ? before.slice(sel) : before).match(/\bFROM\s+([\w.]+)/i) || [])[1] || '?';
          found.push(`${f}|LIMIT ${lm[1]}|${table}`);
        }
      }
    }
    expect(found.filter((x) => !LIMIT_NO_ORDER_OK[x])).toEqual([]);
    expect(Object.keys(LIMIT_NO_ORDER_OK).filter((k) => !found.includes(k))).toEqual([]);
  });
  it('#80 · #86 · #100 목록 상한 = 잘림 칸(truncated · hasMore)을 응답에 싣는다', () => {
    const ab = stripComments(be('utils/dm/dm-ab-test.ts'));
    expect(ab).toMatch(/export async function listAbTests\([^)]*\)[^{]*\{[\s\S]*?truncated/);
    const dm = stripComments(be('routes/dm.ts'));
    expect(dm).toContain('batchesTruncated');
    const em = stripComments(be('utils/email-channel.ts'));
    expect(em).toMatch(/export async function listEmailCampaigns\([\s\S]*?hasMore/);
    const ev = stripComments(be('routes/event-campaigns.ts'));
    const d = ev.indexOf("get('/drafts'");
    expect(d).toBeGreaterThan(-1);
    expect(ev.slice(d, d + 2500)).toContain('truncated');
  });
});

// ── R14 넓힘 ──
describe('R14 넓힘(1025) — 미정산 알림 = 공용 함수(reportCreditMiss) · 직접 로그 0', () => {
  it('[CREDIT][MISS] 글자는 원장 CT 한 곳', () => {
    expect(SERVER_SRC.filter((f) => f !== 'utils/ai-credit.ts' && /\[CREDIT\]\[MISS\]/.test(stripComments(be(f))))).toEqual([]);
    expect(stripComments(be('utils/ai-credit.ts'))).toMatch(/export (?:async )?function reportCreditMiss\(/);
  });
});

// ── R15 넓힘 ──
/** 12기능 라우터의 외부 호출 주소(화면 · SDK 원본이 아니라 밖에서 부른다) */
const R15_EXTERNAL: Record<string, string> = {
  'email.ts POST /webhook': '메일 발송사 웹훅', 'email.ts GET /t/o/:token': '받은 메일 열람 픽셀', 'email.ts GET /t/c/:token': '받은 메일 클릭 추적',
  'email.ts GET /u/:token': '받은 메일 수신거부 링크', 'email.ts POST /u/:token': '받은 메일 수신거부 한 번 누르기(RFC 8058)',
  'cdp.ts POST /ingest': 'SDK 수집(고객사 사이트)', 'cdp.ts POST /member-token': 'SDK 회원 토큰(고객사 서버)', 'cdp.ts POST /identify': 'SDK(고객사 사이트)',
  'cdp.ts POST /event': 'SDK(고객사 사이트)', 'cdp.ts POST /order': 'SDK(고객사 서버)', 'cdp.ts POST /journey-variants/:variantId/track': 'SDK(고객사 사이트)',
  'cdp.ts POST /webhook/custom': '자사몰 웹훅', 'cdp.ts GET /push/vapid-public-key': 'SDK 웹 푸시', 'cdp.ts POST /push/subscribe': 'SDK 웹 푸시',
  'cdp.ts POST /push/unsubscribe': 'SDK 웹 푸시', 'cdp.ts POST /bulk-import': '대량 가져오기(고객사 서버)',
  'sns.ts GET /m/:token': 'SNS 플랫폼이 게시 사진 · 영상을 가져가는 주소', 'sns.ts GET /auth/callback/:platform': 'SNS 로그인 콜백(OAuth)',
  'sns.ts POST /deauthorize/:platform': 'SNS 플랫폼 연결 해제 웹훅',
  'marketing-planner.ts GET /participate/:token': '고객이 받은 문자의 참여 링크', 'marketing-planner.ts GET /approval/:token': '옛 결재 문자 링크 착지(달만 정한다)',
  // ★ 1025 앞부분 규칙을 좁히자 드러난 공개 DM 주소(받은 사람 · 서버가 그린 뷰어 HTML 이 부른다 · 화면 소스에 글자가 없다)
  'dm.ts GET /fonts/:file': 'DM 뷰어 · 메일 글꼴(fonts.css 의 @font-face 가 부른다)', 'dm.ts GET /s/:code': '받은 사람이 여는 DM 단축 주소',
  'dm.ts POST /:code/track': 'DM 뷰어 열람 기록(뷰어 HTML 스크립트 TRACK_URL)', 'dm.ts GET /ab/:code': '받은 사람이 여는 A/B DM 주소(화면은 주소를 보여 줄 뿐)',
  'dm.ts POST /ab/:code/track': 'A/B DM 뷰어 열람 기록(뷰어 HTML 스크립트)', 'dm.ts POST /:code/event-response': 'DM 뷰어 참여 응답(뷰어 HTML 스크립트)',
};
describe('R15 넓힘(1025) — 12기능 라우터 주소마다 화면 · SDK 원본 호출(정확 대조 · 기준 주소 함수 · ${} 조각 · 자리 표)', () => {
  // app.ts 는 줄 주석만 걷는다(stripComments 는 '/*' 꼴 문자열을 블록 주석 시작으로 읽어 import 를 지운다)
  const APP = be('app.ts').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const ident2file = new Map<string, string>();
  for (const m of APP.matchAll(/import\s+(\w+)?\s*,?\s*(\{[^}]*\})?\s*from\s+'\.\/routes\/([\w/-]+)'/g)) {
    if (m[1]) ident2file.set(m[1], `${m[3]}.ts`);
    for (const part of (m[2] || '').replace(/[{}]/g, '').split(',')) { const local = part.split(' as ').pop()!.trim(); if (local) ident2file.set(local, `${m[3]}.ts`); }
  }
  const mounts = new Map<string, Set<string>>();
  for (const m of APP.matchAll(/app\.use\(\s*'([^']+)'\s*,([^;]*?)\)\s*;/g)) {
    for (const id of m[2].match(/\b\w+\b/g) || []) { const f = ident2file.get(id); if (f) { if (!mounts.has(f)) mounts.set(f, new Set()); mounts.get(f)!.add(m[1]); } }
  }
  const SRC_ROOTS = [FE, join(BE, '..', '..', 'company-frontend', 'src'), join(BE, '..', '..', 'flyer-frontend', 'src'), join(BE, '..', '..', 'sdk-js', 'src')];
  const cands = new Set<string>();
  const norm = (u: string) => u.replace(/\?.*$/, '').replace(/\$\{[^}]*\}/g, '\u0001');
  for (const root of SRC_ROOTS) {
    let files: string[] = [];
    try { files = sourceFiles(root, /\.(ts|tsx|js|jsx)$/); } catch { continue; }
    for (const rel of files) {
      const t = stripComments(read(join(root, rel)));
      for (const m of t.matchAll(/[`'"](\/api\/[^`'"\s]*)[`'"]/g)) cands.add(norm(m[1]));
      // 앞부분 후보 = 꼬리 전체가 `${}` 하나일 때만(글 끝 · 질의 앞). ★1025 빈틈: 옛 규칙은 `/api/dm/${id}/무엇` 의 앞부분을 받아
      //   DM `/:id/…` 주소 전부를 「부르는 곳 있음」으로 셌다(화면을 지운 /:id/render-sample 이 통과).
      for (const m of t.matchAll(/`(\/api\/[^`$]*)\$\{[^}`]*\}(?=`|\?)/g)) cands.add(norm(m[1]) + '\u0002');
      // 질의만 동적인 글(`/api/x?name=${…}`) = 「?」 앞 경로 그대로
      for (const m of t.matchAll(/`(\/api\/[^`$?\s]*)\?/g)) cands.add(norm(m[1]));
      // 앞부분을 이름에 담아 잇는 글(const base = `/api/…`; `${base}/${kind}`) = 이어 붙인 경로
      const baseVars = new Map(Array.from(t.matchAll(/\bconst (\w+) = [`'"](\/api\/[^`'"\s]*)[`'"]/g), (m) => [m[1], m[2]] as [string, string]));
      for (const m of t.matchAll(/`\$\{(\w+)\}(\/[^`\s]*)`/g)) { const b = baseVars.get(m[1]); if (b) cands.add(norm(b + m[2])); }
      const bases = Array.from(t.matchAll(/`(\/api\/[\w\-/]*?)\$\{\s*\w+\s*\}`/g), (m) => m[1]);
      const rels = Array.from(t.matchAll(/\b\w+\(\s*[`'"](\/[^`'"\s]*)[`'"]/g), (m) => m[1]);
      for (const b of bases) for (const r of rels) cands.add(norm(b + r));
      if (/axios\.create\(\{\s*baseURL:\s*'\/api'/.test(t) || /from\s+'[./]*api\/client'/.test(t)) {
        for (const m of t.matchAll(/\bapi\.(?:get|post|put|patch|delete)\(\s*[`'"](\/[^`'"\s]*)[`'"]/g)) cands.add(norm('/api' + m[1]));
      }
      // 자리 표 — 편집기 사진 올리기 주소(ImageUploadEndpointContext · axios baseURL '/api')
      for (const m of t.matchAll(/ImageUploadEndpointContext\.Provider value="(\/[^"]+)"/g)) cands.add(norm('/api' + m[1]));
    }
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const called = (full: string) => {
    const x = full.replace(/:\w+/g, 'X');
    for (const c of cands) {
      if (c.endsWith('\u0002')) { if (new RegExp('^' + esc(c.slice(0, -1)).replace(/\u0001/g, '[^/]*')).test(x)) return true; continue; }
      if (new RegExp('^' + esc(full).replace(/:\w+/g, '[^/]+') + '/?$').test(c.replace(/\u0001/g, 'X'))) return true;
      if (new RegExp('^' + esc(c).replace(/\u0001/g, '[^/]+') + '/?$').test(x)) return true;
    }
    return false;
  };
  it('화면 · SDK 주소 글자를 뽑았다 · 마운트를 읽었다(뽑기가 죽지 않았다)', () => {
    expect(cands.size).toBeGreaterThan(300);
    expect(mounts.get('dm.ts')?.has('/api/dm')).toBe(true);
    expect(mounts.get('sns.ts')?.has('/api/sns')).toBe(true);
  });
  it('주소마다 부르는 곳이 있다(외부 호출 주소 = 이유) · 낡은 면제 0', () => {
    const dead: string[] = [];
    const used = new Set<string>();
    for (const file of ALL_ROUTERS.filter((f) => ONE_LINE_ROUTERS.has(f))) {
      for (const b of routeBlocks(stripComments(be(`routes/${file}`)))) {
        const id = `${file} ${key(b)}`;
        const ok = [...(mounts.get(file) || [])].some((base) => called(base.replace(/\/$/, '') + (b.path === '/' ? '' : b.path)));
        if (ok) continue;
        if (R15_EXTERNAL[id]) { used.add(id); continue; }
        dead.push(id);
      }
    }
    expect(dead).toEqual([]);
    expect(unusedKeys(R15_EXTERNAL, used)).toEqual([]);
  });
});

// ── R16 넓힘 ──
describe('R16 넓힘(1025) — 날짜 칸 = 글자로 읽는다 · DM 렌더러 날짜 = 한국 시각', () => {
  it('자동마케팅 사전 안내 날짜 칸(prep_reminder_sent_for)은 ::text 로 읽는다', () => {
    const src = stripComments(be('utils/operator-prep-reminder.ts'));
    expect(src).toContain('prep_reminder_sent_for::text AS prep_reminder_sent_for');
    expect(src).not.toMatch(/new Date\(row\.prep_reminder_sent_for\)/);
  });
  it('DM 렌더러 · 뷰어의 날짜 표시는 시간대를 정한다(서버 로컬 0) · D-day = 한국 날짜 셈 한 곳', () => {
    const bad: string[] = [];
    for (const f of SERVER_SRC.filter((x) => /^utils\/dm\/dm-(section-renderer|viewer|render-primitives)\.ts$/.test(x))) {
      stripComments(be(f)).split('\n').forEach((l, i) => {
        if (/new Date\([^)]*\)\.(?:toLocaleString|toLocaleDateString|toLocaleTimeString)\((?![^)]*timeZone)/.test(l)) bad.push(`${f}:${i + 1} 시간대 없는 표시`);
        if (/\.get(?:FullYear|Month|Date|Hours|Day)\(\)/.test(l)) bad.push(`${f}:${i + 1} 서버 로컬 날짜 칸`);
        if (/Math\.ceil\(\(\w+\.getTime\(\) - Date\.now\(\)\) \/ 86400000\)/.test(l)) bad.push(`${f}:${i + 1} UTC 자정 D-day`);
      });
    }
    expect(bad).toEqual([]);
  });
});

// ── R1 넓힘 ② 화면 발송 정책 시각 ──
describe('R1 넓힘(1025) ② — 화면 문장의 발송 정책 시각 · 기본 추천 시각 = 설정 응답 · 추천 함수 한 곳', () => {
  it('화면 문장에 발송 정책 시각(8 · 20 · 21시) 숫자 0(send-policy 설정 응답 값만)', () => {
    const hits: string[] = [];
    for (const rel of sourceFiles(FE, /\.tsx?$/)) {
      if (rel === 'utils/send-policy.ts') continue;
      stripComments(read(join(FE, rel))).split('\n').forEach((l, i) => {
        for (const m of l.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`|>[^<>{}]+</g)) {
          const s = m[0].replace(/\$\{[^}]*\}/g, '');
          if (/[가-힣]/.test(s) && /(?<![\d:])(?:0?8|2[01])\s?시(?!간)/.test(s)) hits.push(`${rel}:${i + 1} ${s.slice(0, 40)}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
  it('기본 추천 시각 글자(「내일 오전 10시」) = send-time-recommend 한 곳', () => {
    const hits = sourceFiles(FE, /\.tsx?$/).filter((rel) => rel !== 'utils/send-time-recommend.ts' && /내일 오전 10시/.test(stripComments(read(join(FE, rel)))));
    expect(hits).toEqual([]);
  });
});

// ── R4 넓힘 ② 회사 AI 호출 = 묶음 안 ──
describe('R4 넓힘(1025) ② — 회사 크레딧 AI 호출 = 묶음 안이거나 · 묶음 밖이면 AI 호출 함수가 성공 뒤 차감 한 규칙(D1 = A)', () => {
  it('AI 호출 함수의 묶음 밖 차감 = settleCreditAfterSuccess(원장 실패 = 결과 안 줌 · 너그러운 차감 0)', () => {
    const src = stripComments(be('services/ai.ts'));
    const at = src.indexOf('export async function callAIWithFallback(');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    // ★ 1026 Codex 1R — 정산 = 응답을 받은 뒤 한 곳(finishPaidCall · 공급자 try 밖 · 두 갈래가 같은 함수)
    expect((body.match(/settleCreditAfterSuccess\(/g) || []).length).toBe(1);
    // 별칭으로 다른 함수를 들여 이름만 같게 하는 꼴 0(가져오기 = 그 이름 그대로)
    expect((body.match(/const \{ settleCreditAfterSuccess \} = await import\('\.\.\/utils\/ai-credit'\);/g) || []).length).toBe(1);
    expect(body).toContain('if (claudeOut) return finishPaidCall(claudeOut);');
    expect(body).toContain('return finishPaidCall(gptOut);');
    expect(body).not.toMatch(/deductCredit(?:Safe|Outcome)\(/);
    expect(body).toMatch(/isInCreditBundle\(\) \? 0 :/);   // 묶음 안 = 단가 0(묶음 주인이 한 번 걷는다)
  });
});

// ── R6 넓힘 닫는 자리 표 ──
const R6_SCOPE_FILE = /^(?:utils\/(?:continuous-operator|operator-|planner-|dm\/|email-|inapp-|sns|journey-|campaign-quick|event-|image-studio|line-|one-line|ai-line|autosend|automarketing)|services\/ai-line)/;
const R6_TERMINAL = /^(?:sent|completed?|done|cancell?ed|failed|expired|rejected|skipped|archived|closed|stopped|admin_stopped|deleted|ended|finished|succeeded|success|refunded|voided?|inactive|error|blocked|purged|dismissed|revoked|disabled|superseded|merged|aborted|fulfilled|registered|approved|confirmed|verified|published|terminated|dormant|accepted|missed|goal_met|exited|APPROVED|REJECTED|DELETED|NORMAL)$/;
/** 비종결 상태 → 닫는 자리(파일 · 그 파일 SQL 에 그 상태가 있다) 또는 「사람이 바꾸는 살아 있는 상태」(이유) */
const R6_CLOSERS: Record<string, { file?: string; has?: RegExp; why: string }> = {
  'cdp_inapp_messages|active': { why: '사람이 켜고 끄는 노출 상태(끝 = 보관)' },
  'cdp_inapp_messages|paused': { why: '사람이 멈춘 노출(다시 켜거나 보관)' },
  'continuous_operators|active': { why: '사람이 켠 자동 마케팅(끄기 · 보관 = 사람)' },
  'continuous_operators|paused': { why: '사람이 멈춘 자동 마케팅' },
  'continuous_operators|paused_no_credit': { why: '잔액 멈춤(충전 뒤 사람이 다시 켠다)' },
  'dm_ab_tests|running': { why: '사람이 시작하고 끝낸다(complete)' },
  'dm_ab_tests|paused': { why: '사람이 멈춘 비교' },
  'email_campaigns|scheduled': { file: 'utils/email-send-sweeper.ts', has: /WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW\(\)/, why: '예약 시각이 되면 집어 보낸다(집은 뒤 sending)' },
  'email_campaigns|sending': { file: 'utils/email-send-sweeper.ts', why: '30분 정체 = 실패 종결' },
  'journey_executions|active': { why: '여정 실행 상태 = R6 여정 시험이 값 · 멈춤 사유를 덮는다' },
  'journey_executions|paused': { why: '여정 실행 상태 = R6 여정 시험이 덮는다' },
  'journeys|active': { why: '사람이 켜고 끄는 여정' },
  'journeys|draft': { why: '사람이 만드는 중인 여정(켜기 전)' },
  'journeys|paused': { why: '사람이 멈춘 여정' },
  'kakao_templates|REG': { file: 'utils/alimtalk-jobs.ts', has: /status IN \('REQUESTED','REVIEWING','REG'/, why: '검수 동기화 워커가 카카오 응답 값으로 바꾼다' },
  'kakao_templates|REQUESTED': { file: 'utils/alimtalk-jobs.ts', has: /status IN \('REQUESTED'/, why: '검수 동기화 워커가 카카오 응답 값으로 바꾼다' },
  'operator_proposals|admin_review': { file: 'utils/continuous-operator.ts', why: '검토 제안도 7일 만료(#20 · 승인 대기와 같은 판정)' },
  'operator_proposals|scheduled': { file: 'utils/continuous-operator.ts', has: /WHERE status = 'scheduled' AND scheduled_send_at IS NOT NULL AND scheduled_send_at <= NOW\(\)/, why: '예약 시각에 발송 패스가 집는다' },
  'operator_proposals|sending': { file: 'utils/continuous-operator.ts', has: /WHERE status = 'sending'[\s\S]{0,400}reviewed_at < NOW\(\) - \(\$1 \|\| ' minutes'\)::interval/, why: '멈춘 발송 = reconcileStuckSending 마감' },
  'planner_events|briefed': { file: 'utils/planner-reconcile.ts', has: /MISSED_EVENT_STATUS = \[[^\]]*'briefed'/, why: '지난 행사 = 놓친 실행 정리가 닫는다' },
  'planner_events|draft': { file: 'utils/planner-reconcile.ts', has: /MISSED_EVENT_STATUS = \[[^\]]*'draft'/, why: '지난 행사 = 놓친 실행 정리가 닫는다' },
  'planner_touchpoints|planned': { file: 'utils/planner-reconcile.ts', has: /fromStatuses: \['planned', 'ready'/, why: '지난 날 놓친 실행 = 정리가 닫는다' },
  'planner_touchpoints|ready': { file: 'utils/planner-reconcile.ts', has: /fromStatuses: \['planned', 'ready'/, why: '지난 날 놓친 실행 = 정리가 닫는다' },
  'planner_touchpoints|producing': { file: 'utils/planner-reconcile.ts', has: /statuses: \['producing'\]/, why: '멈춘 제작 = 회수(recoverStale)' },
  'sns_post_targets|claimed': { file: 'utils/sns-reconcile-worker.ts', why: '선점 뒤 정체 = 대조 워커 확인 · 포기 시계' },
  'sns_post_targets|scheduled': { file: 'utils/sns-publish-worker.ts', why: '예약 시각에 올린다 · 지난 예약 = 실패 종결 + 통지' },
  'sns_post_targets|submitted': { file: 'utils/sns-reconcile-worker.ts', has: /SET verify_gave_up_at = NOW\(\)[\s\S]{0,300}WHERE status = 'submitted'[\s\S]{0,200}COALESCE\(claimed_at, updated_at\) < NOW\(\)/, why: '대조 워커 게시 확인 · 포기 시계 종결 표식(#97)' },
  'sns_accounts|pending': { file: 'utils/sns-accounts.ts', has: /SNS_PENDING_STUCK_MINUTES/, why: '계정 고르기 대기 · 오래된 대기 = 연결 화면이 「멈춤」으로 보이고 다시 연결' },
};
describe('R6 넓힘(1025) — 12기능 모듈이 쓰는 비종결 상태마다 닫는 자리(파일) 또는 살아 있는 상태 이유', () => {
  const writes = new Set<string>();
  for (const f of SERVER_SRC.filter((x) => R6_SCOPE_FILE.test(x))) {
    for (const { sql } of sqlTemplates(stripComments(be(f)))) {
      const s = sql.replace(/--[^\n]*/g, '');
      const ins = s.match(/\bINSERT\s+INTO\s+([\w.]+)[\s\S]*?\bDO\s+UPDATE\b/i);
      const um = ins ? [ins[0], ins[1]] as unknown as RegExpMatchArray : s.match(/\bUPDATE\s+([\w.]+)/i);
      if (!um) continue;
      const head = (ins ? s.slice(s.search(/\bDO\s+UPDATE\b/i)) : s).split(/\bWHERE\b/i)[0];
      const vals = new Set<string>();
      for (const m of head.matchAll(/\bstatus\s*=\s*'(\w+)'/g)) vals.add(m[1]);
      for (const m of head.matchAll(/\b(?:THEN|ELSE)\s+'(\w+)'/g)) vals.add(m[1]);
      for (const v of vals) if (!R6_TERMINAL.test(v)) writes.add(`${um[1]}|${v}`);
    }
  }
  it('쓰는 비종결 상태를 뽑았다', () => { expect(writes.size).toBeGreaterThan(5); });
  it('상태마다 닫는 자리 · 이유가 있고 · 닫는 파일 SQL 에 그 상태가 있다 · 낡은 줄 0', () => {
    expect([...writes].filter((k) => !R6_CLOSERS[k]).sort()).toEqual([]);
    expect(Object.keys(R6_CLOSERS).filter((k) => !writes.has(k))).toEqual([]);
    // 자동 닫기 = 그 파일 SQL 중 WHERE 에 그 상태 + 시간 조건이 있는 것(사람 손 닫기는 세지 않는다 · #20 만료를 빼면 빨개진다) · 배열 상수로 닫는 곳 = has
    const bad: string[] = [];
    for (const [k, c] of Object.entries(R6_CLOSERS)) {
      if (!c.file) continue;
      const v = k.split('|')[1];
      const src = stripComments(be(c.file));
      if (c.has) { if (!c.has.test(src)) bad.push(`${k} → ${c.file}`); continue; }
      // 닫는 SQL = 상태를 다른 값으로 바꾸고(SET status = 'y' · y ≠ v) · WHERE 에 그 상태 · 시각이 지났는가(< NOW · < 바인드) — 「아직 안 지났나(> NOW)」인 승인 SQL 은 세지 않는다
      const ok = sqlTemplates(src).some(({ sql }) => {
        const q = sql.replace(/--[^\n]*/g, '');
        const parts = q.split(/\bWHERE\b/i);
        if (parts.length < 2 || !/\bUPDATE\b/i.test(parts[0])) return false;
        const sets = Array.from(parts[0].matchAll(/\bstatus\s*=\s*'(\w+)'/g), (m) => m[1]);
        const w = parts.slice(1).join(' ');
        return sets.some((y) => y !== v) && new RegExp(`'${v}'`).test(w) && /<=?\s*(?:NOW\(\)|\$\d+|\(NOW\(\))/i.test(w);
      });
      if (!ok) bad.push(`${k} → ${c.file}`);
    }
    expect(bad).toEqual([]);
  });
});

// ── R8 넓힘 주기 작업 실패 갈래 ──
/** 주기 작업 파일의 「행마다 도는 반복 안 catch」에서 횟수 · 다음 시각을 안 올려도 되는 자리(이유) — 키 = 파일:catch 앞 30자 */
const R8_CATCH_OK: Record<string, string> = {
  "utils/continuous-operator.ts:uuid`, [row.id], ); }": "회차 정산 표식 = try 앞 stampMetaAttempt(10분 뒤 · 미시도 우선 · #2)",
  "utils/continuous-operator.ts:패스 재시도([CREDIT] 로그 확인)`); } }": "발송 크레딧 표식 = try 앞 stampMetaAttempt(chargeAttemptAt · #2)",
  "utils/continuous-operator.ts:id, row.company_id], ); }": "멈춘 발송 판정 조회 실패 = 다음 패스(읽기만 · 상태 안 바꿈)",
  "utils/continuous-operator.ts:indowSummary(op.id, since)); }": "승인 기간 요약 집계 실패 = 0 으로 이어 간다(재시도 아님)",
  "utils/email-send-sweeper.ts:get_spec) : row.target_spec; }": "예약 조건 값 해석 실패 = 빈 조건(아래가 실패 종결 + 통지)",
  "utils/email-send-sweeper.ts:[campaignId], ); }": "실패 종결 기록 실패 = 30분 정체 정리가 다시 닫는다",
  "utils/journey-anchor-scheduler.ts:mary.enqueued += r.enqueued; }": "여정 하나 실패 = 다음 주기 다시(실행 넣기만 · 실행마다 상한 = 실행기 error_count)",
  "utils/journey-executor.ts:() => undefined); } }": "실패 기록의 기록 실패(로그) · 실행 상한 = error_count(R8 여정 시험)",
  "utils/journey-executor.ts:).catch(() => undefined); } }": "적재 표식 정리 실패(로그) · 다음 주기 같은 판정",
  "utils/journey-reentry-worker.ts:wait client.query('COMMIT'); }": "재진입 묶음 되돌림(그 여정 이번 주기 건너뜀 · 다음 주기 같은 기준)",
  "utils/journey-reentry-worker.ts:t; journeysProcessed++; }": "재진입 여정 하나 실패 = 다음 주기(발송 0 · 실행 넣기만)",
  "utils/journey-trigger-watcher.ts:y.skipped += result.skipped; }": "신호 읽기 실패 = 다음 주기(발송 0 · 실행 넣기만)",
  "utils/planner-reconcile.ts:; inserted += res.inserted; }": "성공 · 실패 모두 catch 뒤에서 차례 표식(join_swept_at · #10)",
  "utils/sns-publish-worker.ts:{ await handleTarget(row); }": "선점 행 = 대조 워커 포기 시계(claimed_at · #97)가 닫는다",
  "utils/sns-reconcile-worker.ts:[row.id], ); } }": "플랫폼 삭제 확인(읽기) 실패 = 다음 주기 · 상태 안 바꿈",
};
describe('R8 넓힘(1025) — 주기 작업의 행마다 실패 갈래 = 횟수 · 다음 시각 표식(무한 재시도 0)', () => {
  it('setInterval 워커 파일의 for-of 안 catch 는 표식(시도 · 실패 · 다음 시각 · 종결)을 남긴다(이유 있는 면제만)', () => {
    const found: string[] = [];
    for (const f of SERVER_SRC.filter((x) => R6_SCOPE_FILE.test(x))) {
      const src = stripComments(be(f));
      if (!/\bsetInterval\(|\bstart\w*(?:Worker|Scheduler|Sweeper)\b/.test(src)) continue;
      for (const loop of src.matchAll(/for\s*\(\s*const\s+\w+\s+of\s+[^)]+\)\s*\{/g)) {
        let i = (loop.index ?? 0) + loop[0].length, depth = 1;
        while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
        const body = src.slice((loop.index ?? 0) + loop[0].length, i);
        for (const c of body.matchAll(/catch\s*(?:\(\s*\w+(?:\s*:\s*\w+)?\s*\))?\s*\{/g)) {
          let j = (c.index ?? 0) + c[0].length, d2 = 1;
          while (j < body.length && d2) { if (body[j] === '{') d2++; else if (body[j] === '}') d2--; j++; }
          const cb = body.slice((c.index ?? 0) + c[0].length, j);
          if (/UPDATE\s|attempt|Attempt|failures|Failures|fail\w*Count|nextAt|next_\w+_at|_at'|stamp\w*\(|mark\w*\(|note\w*\(|bump\w*\(|close\w*\(|sendSystemAlert\(|notify\w*\(/.test(cb)) continue;
          const before = body.slice(Math.max(0, (c.index ?? 0) - 40), c.index).replace(/\s+/g, ' ').trim().slice(-30);
          found.push(`${f}:${before}`);
        }
      }
    }
    expect(found.filter((k) => !R8_CATCH_OK[k])).toEqual([]);
    expect(Object.keys(R8_CATCH_OK).filter((k) => !found.includes(k))).toEqual([]);
  });
  it('#47 플래너 보내기 전 실패 = 시도 상한 · #71 추첨 실패 = 횟수 표식 + 통지', () => {
    const ex = stripComments(be('utils/planner-executor.ts'));
    expect(ex).toMatch(/PRE_SEND_FAIL_LIMIT\s*=\s*3/);
    expect(ex).toContain('pre_send_failures');
    const dw = stripComments(be('utils/dm/dm-draw-worker.ts'));
    expect(dw).toMatch(/drawFails/);
    expect(dw).toMatch(/sendSystemAlert\(/);
  });
});
