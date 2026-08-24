/**
 * 기능 카탈로그 불변식 7종 (★ 2026-08-22 신설) — docs/FEATURE-HELP-CATALOG.md §5
 *
 * 이 파일이 잠그는 것: "코드가 강제하지 못하는 정의는 만들지 않는다."
 *   1. 경로 실존 — 모든 entry.path가 App.tsx 라우트에 있다(추출 40건 미만이면 게이트가 죽은 것 → 실패)
 *   2. 역방향 커버리지 — 고객 라우트·AI 모듈 카드·헤더 메뉴·요금제 키가 각각 최소 1개 작업에 나온다
 *   3. 금칙어 0 — 모델명·이모지·줄표·내부 코드명·테이블명·"Modal"
 *   4. 요금제 키 유효 — planKey가 타입에 있고 판정 코드가 실존
 *   5. 크레딧 키 실존 + 숫자·요금제 이름 금지
 *   6. 치수 — goal 40자 · steps 3~6 · blockers 3 이하 · keywords 5 이상
 *   7. stub 만료 — stubUntil이 있고 아직 안 지났다
 *   + 관련 작업 id 실존 · id 유일
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { FEATURE_CATALOG, NOT_DOCUMENTED_ROUTES, JOB_GROUPS, STUB_UNTIL } from '../../content/feature-catalog';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const APP_TSX = readFileSync(resolve(FRONT, 'App.tsx'), 'utf8');
const MODULES_TS = readFileSync(resolve(FRONT, 'constants/ai-operator-modules.ts'), 'utf8');
const HEADER_TSX = readFileSync(resolve(FRONT, 'components/DashboardHeader.tsx'), 'utf8');
const PLAN_GUARD = readFileSync(resolve(__dirname, '../plan-guard.ts'), 'utf8');
const CREDIT_CALC = readFileSync(resolve(__dirname, '../ai-credit-calc.ts'), 'utf8');

const routes = new Set([...APP_TSX.matchAll(/path="([^"]+)"/g)].map((m) => m[1]));
const ids = new Set(FEATURE_CATALOG.map((j) => j.id));
const allText = FEATURE_CATALOG.map((j) => [j.title, j.goal, ...j.keywords, ...j.steps, ...j.blockers.flatMap((b) => [b.symptom, b.fix]), j.entry.via].join('\n')).join('\n');

describe('기능 카탈로그 불변식', () => {
  it('0. id는 유일하고 related는 실존하는 id만 가리킨다', () => {
    expect(ids.size).toBe(FEATURE_CATALOG.length);
    const bad = FEATURE_CATALOG.flatMap((j) => j.related.filter((r) => !ids.has(r)).map((r) => `${j.id} → ${r}`));
    expect(bad).toEqual([]);
    const grouped = JOB_GROUPS.flatMap((g) => g.jobs);
    expect(grouped.filter((id) => !ids.has(id))).toEqual([]);
    expect(FEATURE_CATALOG.map((j) => j.id).filter((id) => !grouped.includes(id))).toEqual([]);
  });

  it('1. 모든 entry.path가 실제 라우트다(추출이 죽으면 그 자체로 실패)', () => {
    expect(routes.size).toBeGreaterThanOrEqual(40);
    const bad = FEATURE_CATALOG.filter((j) => !routes.has(j.entry.path)).map((j) => `${j.id}: ${j.entry.path}`);
    expect(bad).toEqual([]);
  });

  it('2. 역방향 커버리지 — 고객 라우트·AI 모듈 카드·헤더 메뉴·요금제 키가 빠짐없이 정의에 나온다', () => {
    const documented = new Set(FEATURE_CATALOG.map((j) => j.entry.path));
    const uncovered = [...routes].filter((r) => !documented.has(r) && !(r in NOT_DOCUMENTED_ROUTES));
    expect(uncovered, 'stub이라도 등재하거나 NOT_DOCUMENTED_ROUTES에 사유를 적어라').toEqual([]);

    const cardPaths = [...MODULES_TS.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(cardPaths.length).toBeGreaterThanOrEqual(10);
    expect(cardPaths.filter((p) => !documented.has(p))).toEqual([]);

    const menuLabels = [...HEADER_TSX.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]).filter((l) => l !== '로그아웃' && l !== 'AI Operator 소개');
    expect(menuLabels.length).toBeGreaterThanOrEqual(5);
    const missingMenu = menuLabels.filter((l) => !allText.includes(l));
    expect(missingMenu, '헤더 메뉴 이름이 어느 작업의 문장에도 없다').toEqual([]);

    const keyUnion = PLAN_GUARD.slice(PLAN_GUARD.indexOf('export type FeatureKey'), PLAN_GUARD.indexOf('export type SubscriptionStatus'));
    const featureKeys = [...keyUnion.matchAll(/^\s*\|\s*'([a-z_]+)'/gm)].map((m) => m[1]);
    expect(featureKeys.length).toBeGreaterThanOrEqual(10);
    const usedKeys = new Set(FEATURE_CATALOG.map((j) => j.planKey).filter(Boolean));
    expect(featureKeys.filter((k) => !usedKeys.has(k as any)), '요금제 키마다 최소 1개 작업이 있어야 한다').toEqual([]);
  });

  it('3. 금칙어 0 — 모델명·이모지·줄표·내부 코드명·테이블명·Modal', () => {
    const rules: [string, RegExp][] = [
      ['모델명', /opus|sonnet|haiku|gpt|claude|anthropic/i],
      ['이모지', /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
      ['줄표', /—/],
      ['내부 코드명', /\bD\d{2,3}\b|CT-\d+/],
      ['Modal', /Modal/],
      ['DB 용어', /MySQL|PostgreSQL|\bPG\b|SMSQ|_logs?\b|_state\b/],
    ];
    const hits = rules.flatMap(([name, re]) => (re.test(allText) ? [`${name}: ${allText.match(re)?.[0]}`] : []));
    expect(hits).toEqual([]);
  });

  it('4. planKey는 plan-guard가 판정하는 키만 쓴다', () => {
    const keys = FEATURE_CATALOG.map((j) => j.planKey).filter(Boolean) as string[];
    const bad = keys.filter((k) => !new RegExp(`case '${k}'`).test(PLAN_GUARD) && !new RegExp(`'${k}'`).test(PLAN_GUARD));
    expect(bad).toEqual([]);
  });

  it('5. creditSource는 CREDIT_COST_MAP에 실존하고, 문장에 크레딧 숫자·요금제 이름이 없다', () => {
    const mapBody = CREDIT_CALC.slice(CREDIT_CALC.indexOf('CREDIT_COST_MAP'));
    const bad = FEATURE_CATALOG.map((j) => j.creditSource).filter(Boolean).filter((k) => !mapBody.includes(`'${k}'`));
    expect(bad).toEqual([]);
    expect(/\d+\s*크레딧/.test(allText), '크레딧 숫자는 getCreditCost가 만든다').toBe(false);
    expect(/\b(FREE|STARTER|BASIC|PRO|BUSINESS|ENTERPRISE|TRIAL)\b/.test(allText), '요금제 이름은 canUseFeature가 만든다').toBe(false);
    expect(/프로 요금제|스타터|베이직|비즈니스 요금제|엔터프라이즈/.test(allText)).toBe(false);
  });

  it('6. 치수 — goal 40자 · ready는 steps 3~6 · blockers 3 이하 · keywords 5 이상 · title 14자', () => {
    const bad: string[] = [];
    for (const j of FEATURE_CATALOG) {
      if (j.title.length > 14) bad.push(`${j.id}: title ${j.title.length}자`);
      if (j.goal.length > 40) bad.push(`${j.id}: goal ${j.goal.length}자`);
      if (j.keywords.length < 5) bad.push(`${j.id}: keywords ${j.keywords.length}`);
      if (j.blockers.length > 3) bad.push(`${j.id}: blockers ${j.blockers.length}`);
      if (j.related.length > 3) bad.push(`${j.id}: related ${j.related.length}`);
      if (j.status === 'ready' && (j.steps.length < 3 || j.steps.length > 6)) bad.push(`${j.id}: steps ${j.steps.length}`);
      if (j.status === 'stub' && j.steps.length > 0) bad.push(`${j.id}: stub인데 steps가 있다(ready로 올려라)`);
    }
    expect(bad).toEqual([]);
  });

  it('7. stub은 만료일을 갖고, 그 날짜가 지나면 실패한다(유예를 주석이 아니라 날짜로 건다)', () => {
    const today = new Date().toISOString().slice(0, 10);
    const bad: string[] = [];
    for (const j of FEATURE_CATALOG) {
      if (j.status === 'stub') {
        if (!j.stubUntil) bad.push(`${j.id}: stubUntil 없음`);
        else if (j.stubUntil < today) bad.push(`${j.id}: stub 만료(${j.stubUntil}) — 본문을 채우거나 날짜를 옮겨라`);
      } else if (j.stubUntil) bad.push(`${j.id}: ready인데 stubUntil이 있다`);
    }
    expect(bad).toEqual([]);
    expect(STUB_UNTIL >= today).toBe(true);
  });

  /**
   * ★ 2026-08-24 신설 — 접수 cmt6qjoqs00umjnot0xph8v2g(남지현) "이 화면 열기가 홈페이지만 띄운다".
   * 40개 중 10개가 시작 지점이 `/dashboard`인데 실물은 그 위의 모달이라, 경로 이동만으로는 아무 일도 없었다.
   * 그래서 `entry.open`(모달 열쇠)을 뒀다. 이 게이트가 잠그는 것은 **열쇠가 화면에 실존하는가** 하나다.
   */
  it('9. entry.open 열쇠는 대시보드가 실제로 처리한다(카탈로그가 없는 열쇠를 지어내지 못한다)', () => {
    const dash = readFileSync(resolve(FRONT, 'pages/Dashboard.tsx'), 'utf8');
    const bad: string[] = [];
    for (const j of FEATURE_CATALOG) {
      const open = j.entry.open;
      if (!open) continue;
      // 열쇠는 이 화면 위의 모달을 여는 것이라, 그 화면이 대시보드가 아니면 처리기가 없다
      if (j.entry.path !== '/dashboard') { bad.push(`${j.id}: ${j.entry.path}에는 open 처리기가 없다`); continue; }
      const [key, value] = open.split('=');
      if (!key || !value) { bad.push(`${j.id}: open 형식이 key=value가 아니다(${open})`); continue; }
      if (!dash.includes(`searchParams.get('${key}')`)) bad.push(`${j.id}: 대시보드가 '${key}' 파라미터를 읽지 않는다`);
      if (key === 'open' && !dash.includes(`=== '${value}'`)) bad.push(`${j.id}: 대시보드에 '${value}' 분기가 없다`);
    }
    expect(bad).toEqual([]);
  });

  /**
   * ⛔ `entry.path`에 쿼리를 붙이면 두 곳이 함께 깨진다: 불변식 1(라우트 실존)과
   * `jobsForPath`(현재 경로와 **문자열 비교**). 후자가 깨지면 그 작업이 "이 화면 목록"에서 통째로 사라진다.
   */
  it('10. entry.path는 순수 라우트다(쿼리·해시를 붙이지 않는다 — 붙일 것은 entry.open이다)', () => {
    const bad = FEATURE_CATALOG
      .filter((j) => /[?#]/.test(j.entry.path))
      .map((j) => `${j.id}: ${j.entry.path}`);
    expect(bad).toEqual([]);
  });

  it('8. 내부 필드(sourceFile)는 응답 타입에서 잘려 나간다(소스 계약)', () => {
    const src = readFileSync(resolve(__dirname, '../../content/feature-catalog.ts'), 'utf8');
    expect(/Omit<FeatureJob,\s*'sourceFile'/.test(src)).toBe(true);
    const route = readFileSync(resolve(__dirname, '../../routes/help.ts'), 'utf8');
    expect(/sourceFile/.test(route.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))).toBe(false);
  });
});
