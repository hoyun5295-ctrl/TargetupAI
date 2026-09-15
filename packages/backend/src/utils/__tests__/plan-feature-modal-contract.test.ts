/**
 * 요금제 공통 안내 창 계약 (★ 2026-09-15 Harold 지시 · 목업 승인)
 *
 * 경위: AI Operator 메뉴가 미가입 회사에 잠겨 있었고, 잠긴 기능을 누르면 뜨는 옛 안내 창은 기능 7개만 설명해
 *   목록에 없는 기능(예: AI Operator)을 누르면 다른 기능("AI 문구 추천") 설명이 나왔다.
 *
 * 못 박는 것:
 *   1. 창에 나오는 크레딧 숫자 = 백엔드 CREDIT_COST_MAP. 손으로 적은 숫자가 단가표와 갈리면 실패한다.
 *   2. AI Operator 허브 카드마다 안내 항목이 있다(카드를 추가하고 설명을 빠뜨리면 실패).
 *   3. 화면이 여는 기능 id는 전부 원장에 있다(없는 id = 빈 창).
 *   4. 문안 금칙어 0 — 모델명·이모지·줄표·"Modal"·내부 코드명·문장 속 크레딧 숫자.
 *   5. 대시보드는 AI Operator를 요금제와 상관없이 연다(진입 확인·진단 분기·안내 모달 분기 0). 옛 안내 창 파일은 없다.
 *   6. AI Operator 허브는 서버 판정으로 카드 이동과 [생성]을 막고 공통 안내 창을 연다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CREDIT_COST_MAP } from '../ai-credit-calc';

const FRONT = join(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(join(FRONT, p), 'utf8');
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
}

const INTROS = stripComments(read('constants/plan-feature-intros.ts'));
const MODULES = read('constants/ai-operator-modules.ts');
const DASH = stripComments(read('pages/Dashboard.tsx'));
const HUB = stripComments(read('pages/AiOperatorPage.tsx'));
const DIRECT = stripComments(read('components/DirectSendPanel.tsx'));
const BRAND = stripComments(read('components/BrandSendModal.tsx'));
const MODAL = stripComments(read('components/PlanFeatureModal.tsx'));

const introIds = new Set([...INTROS.matchAll(/\bid:\s*'([a-z-]+)'/g)].map((m) => m[1]));
const introPaths = new Set([...INTROS.matchAll(/\bpath:\s*'([^']+)'/g)].map((m) => m[1]));

describe('요금제 공통 안내 창 — 원장', () => {
  it('크레딧 칩 숫자는 백엔드 단가표와 같다', () => {
    const costs = [...INTROS.matchAll(/source:\s*'([^']+)',\s*credits:\s*(\d+)/g)].map((m) => ({ source: m[1], credits: Number(m[2]) }));
    expect(costs.length, '크레딧 칩 추출이 0이면 이 게이트가 죽은 것이다').toBeGreaterThanOrEqual(20);
    const bad = costs.filter((c) => CREDIT_COST_MAP[c.source] !== c.credits).map((c) => `${c.source}: 화면 ${c.credits} · 단가표 ${CREDIT_COST_MAP[c.source]}`);
    expect(bad).toEqual([]);
  });

  it('AI Operator 허브 카드마다 안내 항목이 있다', () => {
    const cardPaths = [...MODULES.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(cardPaths.length).toBeGreaterThanOrEqual(10);
    expect(cardPaths.filter((p) => !introPaths.has(p))).toEqual([]);
  });

  it('화면이 여는 기능 id는 전부 원장에 있다', () => {
    const used = [
      ...[...DASH.matchAll(/openPlanFeature\('([a-z-]+)'\)/g)].map((m) => m[1]),
      ...[...HUB.matchAll(/setPlanFeatureId\('([a-z-]+)'\)/g)].map((m) => m[1]),
      ...[...DIRECT.matchAll(/onLockedFeature\('([a-z-]+)'\)/g)].map((m) => m[1]),
      ...[...BRAND.matchAll(/onLockedFeature\('([a-z-]+)'\)/g)].map((m) => m[1]),
    ];
    expect(used.length).toBeGreaterThanOrEqual(9);
    expect(used.filter((id) => !introIds.has(id))).toEqual([]);
    // 옛 형태(기능명 문자열 + 요금제 문자열 두 값)가 남아 있으면 창과 다시 어긋난다
    expect(DIRECT).not.toMatch(/onLockedFeature\('[^']*',\s*'/);
    expect(BRAND).not.toMatch(/onLockedFeature\('[^']*',\s*'/);
  });

  it('문안 금칙어 0 — 모델명·이모지·줄표·Modal·내부 코드명·문장 속 크레딧 숫자', () => {
    const strings = [...INTROS.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]).join('\n');
    const rules: [string, RegExp][] = [
      ['모델명', /opus|sonnet|haiku|gpt|claude|anthropic/i],
      ['이모지', /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u],
      ['줄표', /—/],
      ['Modal', /Modal/],
      ['내부 코드명', /\bD\d{2,3}\b|CT-\d+/],
      ['문장 속 크레딧 숫자', /\d+\s*크레딧/],
      ['효과 수치', /\d+\s*%\s*(상승|증가|향상)/],
    ];
    const hits = rules.flatMap(([name, re]) => (re.test(strings) ? [`${name}: ${strings.match(re)?.[0]}`] : []));
    expect(hits).toEqual([]);
    expect(MODAL).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(MODAL).not.toMatch(/opus|sonnet|haiku|gpt|claude|anthropic/i);
  });
});

describe('대시보드 — AI Operator는 요금제와 상관없이 연다', () => {
  it('진입 확인·진단 분기·안내 모달 분기가 없고 바로 이동한다', () => {
    expect(DASH).not.toMatch(/\/api\/ai\/operator\/access/);
    expect(DASH).not.toMatch(/AiOperatorWalkthroughModal/);
    expect(DASH).not.toMatch(/setPlanUpgradeFeature\('AI Operator'\)/);
    expect((DASH.match(/navigate\('\/ai-operator'\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('옛 안내 창은 파일째 없고 공통 안내 창 하나만 쓴다', () => {
    expect(existsSync(join(FRONT, 'components/PlanUpgradeModal.tsx'))).toBe(false);
    expect(DASH).not.toMatch(/PlanUpgradeModal|setShowPlanUpgradeModal|planUpgradeRequired/);
    expect(DASH).toMatch(/<PlanFeatureModal featureId=\{planFeatureId\}/);
  });
});

describe('AI Operator 허브 — 서버 판정으로 막고 공통 안내 창을 연다', () => {
  it('서버 판정을 읽는다', () => {
    expect(HUB).toMatch(/fetch\('\/api\/ai\/operator\/access'/);
    expect(HUB).toMatch(/setPlanLocked\(d\.allowed === false\)/);
  });

  it('카드는 잠겨 있으면 이동하지 않고 그 기능의 안내를 연다', () => {
    const start = HUB.indexOf('{SUB_MODULE_CARDS');
    expect(start, '허브 카드 렌더 자리를 못 찾으면 이 게이트가 죽은 것이다').toBeGreaterThan(-1);
    const tiles = HUB.slice(start, start + 4000);
    expect(tiles).toMatch(/const featureId = planFeatureIdForPath\(card\.path\);\s*if \(planLocked && featureId\) \{ setPlanFeatureId\(featureId\); return; \}\s*navigate\(card\.path\);/);
  });

  it('[생성]은 잠겨 있으면 제안 요청을 보내지 않는다', () => {
    const submit = HUB.slice(HUB.indexOf('const handleSubmit'), HUB.indexOf("fetch('/api/ai/operator/propose'"));
    expect(submit).toMatch(/if \(planLocked\) \{ setPlanFeatureId\('ai-operator'\); return; \}/);
    expect(HUB).toMatch(/<PlanFeatureModal featureId=\{planFeatureId\}/);
  });
});
