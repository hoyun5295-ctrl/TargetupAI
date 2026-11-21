// replaces: none
/**
 * C151 한 줄로 묻기 — 계약 시험(★ 2026-11-21 · 설계서 docs/2026-11-21-c151-ask-entry-design.md §5)
 *   K1 묶음 표 = 목업 격자(기계 추출) · 칸 15 + 구매 기록 없음이 한 번씩 · 경계 상수
 *   K2 askPlan · askLimit(모두 · 예산 · 단가 0 · 미설정 · 예산 < 단가 · 5만 상한) · 세기 · 명단이 같은 함수
 *   K3 readAskLine 낱말 표 · 예산 · 혜택 유무 · 못 읽음 = 기본
 *   K4 runLineCompose — ask 없는 갈래 = 옛 문장 순서 그대로 · ask = 기본료 0 · 키 = keyInput 만 · 혜택 세 갈래의 근거 글
 *   K5 새 주소 = 같은 요금제 관문(읽기만 로그인) · benefitHole = 직접발송 길목 판정 한 곳
 *   K6 대시보드 = ask 일 때만 문안 칸을 채운다 · 옛 kind 갈래 그대로
 *   K7 넘기기 = 계정 · 10분 · 응답 뒤 계정 재확인 · 문안 지문 결속 · 자리표 잠김(화면 순수 함수)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import {
  ASK_GROUPS, ASK_ROW_DAYS, ASK_COL_COUNTS, ASK_AUDIENCE_MAX, askLimit, askPlan, readAskPlan, readAskLine, askComposeLicense, askGroupLine,
} from '../ask-segments';
import { aiLineCopyKey } from '../ai-line';
import { findUneditedSendPlaceholder } from '../send-placeholder-gate';
import { BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';
import {
  askBenefitMode, askInputFp, askTakeBlock, askParts, askBudgetOf, askBudgetValid,
} from '../../../../frontend/src/utils/ai-ask';
import { stashAudience, takeAudience, askOwnerMatches, ASK_HANDOFF_MAX_AGE_MS, audienceLoadedText } from '../../../../frontend/src/utils/product-insight';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const BE = join(__dirname, '..', '..');
const FE = join(ROOT, 'packages', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** 함수 선언 본문 글(구문 트리 · 이름으로) */
function fnBody(path: string, name: string): string {
  const src = read(path);
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true);
  let out = '';
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body) out = n.body.getText(sf);
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) out = n.initializer.getText(sf);
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
/** 라우터 주소 한 곳의 글(그 줄부터 다음 router. 앞까지) */
function routeBlock(src: string, method: string, path: string): string {
  const at = src.indexOf(`router.${method}('${path}'`);
  if (at < 0) return '';
  const next = src.indexOf('\nrouter.', at + 1);
  return src.slice(at, next < 0 ? undefined : next);
}

const PRICE = { lms: 30, unset: false };
const ALL = { groups: ['leave' as const], mode: 'all' as const, budget: null, order: 'recent' as const };
const BUDGET = (b: number) => ({ groups: ['leave' as const], mode: 'budget' as const, budget: b, order: 'recent' as const });

describe('K1 묶음 표 = 목업 격자', () => {
  it('목업 CELLS 표(기계 추출)와 칸 → 묶음이 같다 · 칸 15 + 구매 기록 없음이 한 번씩', () => {
    const mock = read(join(ROOT, 'docs', 'mockups', '2026-11-21-ask-entry-flow-mockup.html'));
    const raw = /var CELLS=(\[[\s\S]*?\]\]);/.exec(mock)?.[1];
    expect(raw).toBeTruthy();
    const cells: Array<[number, number, number, string]> = JSON.parse(raw!.replace(/'/g, '"'));
    const fromMock = new Map(cells.map(([r, c, , g]) => [g === 'nobuy' ? 'nobuy' : `r${r}c${c}`, g]));
    const fromCode = new Map(ASK_GROUPS.flatMap((g) => g.cells.map((c) => [c, g.key] as const)));
    expect(Object.fromEntries(fromCode)).toEqual(Object.fromEntries(fromMock));
    const all = ASK_GROUPS.flatMap((g) => g.cells);
    expect(all).toHaveLength(16);
    expect(new Set(all).size).toBe(16);
  });

  it('경계 = 30 · 90 · 180 · 365일 · 1번 · 3번(설계서 §2 S1)', () => {
    expect([...ASK_ROW_DAYS]).toEqual([30, 90, 180, 365]);
    expect([...ASK_COL_COUNTS]).toEqual([1, 3]);
  });
});

describe('K2 인원 · 예산 · 5만 상한', () => {
  it('모두 = 번호 수(5만까지) · 금액 = 인원 × 단가', () => {
    expect(askPlan(120, PRICE, ALL)).toEqual({ planned: 120, amount: 3600, capped: false, want: 120 });
  });
  it('예산 = floor(예산 / 단가) · 번호 수가 적으면 번호 수 · 예산 < 단가 = 0명', () => {
    expect(askPlan(5000, PRICE, BUDGET(50_000))?.planned).toBe(1666);
    expect(askPlan(100, PRICE, BUDGET(50_000))?.planned).toBe(100);
    expect(askPlan(100, { lms: 2000, unset: false }, BUDGET(1_000))?.planned).toBe(0);
  });
  it('소수 단가도 원 단위로 정확히(1,000원 ÷ 3.3원 = 303명 · 29,700원 ÷ 29.7원 = 1,000명) · 금액은 예산을 넘지 않는다', () => {
    const p = askPlan(5000, { lms: 3.3, unset: false }, BUDGET(1_000))!;
    expect(p.planned).toBe(303);
    expect(p.amount).toBeLessThanOrEqual(1_000);
    expect(askLimit({ lms: 29.7, unset: false }, BUDGET(29_700))).toBe(1000);
  });
  it('단가 0원 계약 = 예산이 인원을 줄이지 않는다 · 미설정 = 예산 불가(null) · 모두는 미설정이어도 센다', () => {
    expect(askPlan(500, { lms: 0, unset: false }, BUDGET(10_000))).toEqual({ planned: 500, amount: 0, capped: false, want: 500 });
    expect(askPlan(500, { lms: 0, unset: true }, BUDGET(10_000))).toBeNull();
    expect(askPlan(500, { lms: 0, unset: true }, ALL)?.planned).toBe(500);
  });
  it('K2 넓힘 — 6만 명 · 모두 = 5만 · 금액 = 5만 × 단가 · capped · 예산이 5만을 넘어도 5만', () => {
    expect(askPlan(60_000, PRICE, ALL)).toEqual({ planned: ASK_AUDIENCE_MAX, amount: ASK_AUDIENCE_MAX * 30, capped: true, want: 60_000 });
    expect(askPlan(60_000, PRICE, BUDGET(3_000_000))).toMatchObject({ planned: 50_000, capped: true });
    expect(askPlan(60_000, PRICE, BUDGET(30_000))).toMatchObject({ planned: 1000, capped: false });
  });
  it('세기 · 명단 주소가 같은 함수(askLimit → SQL LIMIT · askPlan → planned)로 정한다', () => {
    const file = join(BE, 'utils', 'ask-segments.ts');
    for (const fn of ['countAskPlan', 'listAskAudience']) {
      const body = fnBody(file, fn);
      expect(body, fn).toMatch(/askLimit\(price, plan\)/);
      expect(body, fn).toMatch(/askPlan\(/);
      expect(body, fn).toMatch(/askAudienceSql\(sendable, plan\.order\)/);
      expect(body, fn).toMatch(/sendableCustomerSql\(companyId, viewerUserId\)/);
    }
  });
  it('입력 검사 = 아는 묶음만 · 순서 정렬 · 예산 범위', () => {
    expect(readAskPlan({ groups: ['rest', 'leave'], mode: 'all' })).toEqual({ groups: ['leave', 'rest'], mode: 'all', budget: null, order: 'recent' });
    expect(readAskPlan({ groups: ['x'], mode: 'all' })).toBeNull();
    expect(readAskPlan({ groups: [], mode: 'all' })).toBeNull();
    expect(readAskPlan({ groups: ['leave'], mode: 'budget', budget: 999 })).toBeNull();
    expect(readAskPlan({ groups: ['leave'], mode: 'budget', budget: 1000.5 })).toBeNull();
    expect(readAskPlan({ groups: ['leave'], mode: 'budget', budget: 1000, order: 'count' })).toMatchObject({ budget: 1000, order: 'count' });
  });
});

describe('K3 한 줄 읽기', () => {
  const g = (line: string) => readAskLine(line).groups;
  it('낱말 표', () => {
    expect(g('오래 안 온 단골에게 재구매 10% 쿠폰')).toEqual(['leave']);
    expect(g('이탈 고객 잡기')).toEqual(['leave']);
    expect(g('오래 쉰 고객에게 안부')).toEqual(['rest']);
    expect(g('뜸해진 분들께')).toEqual(['fade']);
    expect(g('첫 구매 고객 감사 문자')).toEqual(['new']);
    expect(g('요즘 단골께 감사')).toEqual(['loyal']);
    expect(g('다음 구매 권하기')).toEqual(['next']);
    expect(g('가입만 하고 안 산 적 있는 분')).toEqual(['nobuy']);
    expect(g('신상품 소식')).toEqual(['leave']);   // 못 읽음 = 먼저 챙길 분
  });
  it('예산 = 「예산 N원」 · 「N원으로 · 안에서」만 · 혜택 금액은 예산이 아니다', () => {
    expect(readAskLine('단골에게 5만 원으로 보내기').budget).toBe(50_000);
    expect(readAskLine('예산 30,000원 단골').budget).toBe(30_000);
    expect(readAskLine('단골에게 5천원 쿠폰').budget).toBeNull();
    expect(readAskLine('단골에게 3000원 할인').budget).toBeNull();
    expect(readAskLine('예산 500원').budget).toBeNull();   // 1,000원 아래
  });
  it('혜택 낱말 유무', () => {
    expect(readAskLine('10% 쿠폰').hasBenefit).toBe(true);
    expect(readAskLine('적립금 두 배').hasBenefit).toBe(true);
    expect(readAskLine('오래 안 온 분께 안부').hasBenefit).toBe(false);
  });
});

describe('K4 문안 갈래(runLineCompose)', () => {
  const svc = join(BE, 'services', 'ai-line.ts');
  const body = fnBody(svc, 'runLineCompose');
  it('ask 없는 갈래 = 옛 문장 순서 그대로(조건 확인 → 허브 대상 → 열림 확인 → 세기)', () => {
    const at = (s: string) => body.indexOf(s);
    const order = ['assertFiltersTranslated(input.filters)', 'compileHubAudience(v, input.filters, input.allCustomers)', 'assertAudienceOpen(audience)', 'countHubAudience(audience)', 'assertCountSendable(count)'];
    for (const s of order) expect(at(s), s).toBeGreaterThan(-1);
    for (let i = 1; i < order.length; i++) expect(at(order[i]), order[i]).toBeGreaterThan(at(order[i - 1]));
    // 옛 갈래 = else 안 · ask 갈래는 받은 수만
    expect(body).toMatch(/if \(ask\) \{\s*count = ask\.count;[^}]*\} else \{\s*assertFiltersTranslated/);
  });
  it('ask = 기본료 0 · 과금 키 = keyInput 만(옛 모양은 ask 없을 때 그대로)', () => {
    expect(body).toMatch(/const basePaid = \(paidCopies !== null \|\| ask\) \? true : await aiLineBasePaid\(v\.companyId, input\.line, now\)/);
    expect(body).toMatch(/aiLineCopyKey\(v\.companyId, input\.attemptToken, ask \? \{ ask: ask\.keyInput \} : \{\s*line: input\.line, facts: input\.facts, filters: input\.filters, allCustomers: input\.allCustomers,/);
    // 같은 사람 입력 = 같은 키(다시 센 수 · 묶음 글은 키에 없다)
    const k = { line: '', groups: ['leave'], mode: 'line', benefit: '', retry: false };
    expect(aiLineCopyKey('co', 'tok-12345678', { ask: k })).toBe(aiLineCopyKey('co', 'tok-12345678', { ask: { ...k } }));
    const route = read(join(BE, 'routes', 'ai-line.ts'));
    expect(routeBlock(route, 'post', '/ask/compose')).toMatch(/keyInput: \{ line: line \|\| '', groups: plan\.groups, mode, benefit: benefit \|\| '', retry \}/);
  });
  it('혜택 세 갈래 — 근거 글은 한 갈래만(custom · none = 사람의 한 줄은 참고 글로만)', () => {
    const plan = { groups: ['leave' as const], mode: 'all' as const, budget: null, order: 'recent' as const };
    const line = '오래 안 온 단골에게 재구매 10% 쿠폰';
    expect(askComposeLicense(line, plan, 'line', null, false)).toEqual({ licenseLine: line, benefit: null, extraContext: undefined });
    expect(askComposeLicense(null, plan, 'line', null, false).licenseLine).toBe(askGroupLine(['leave']));
    const custom = askComposeLicense(line, plan, 'custom', '적립금 5천 원', false);
    expect(custom.licenseLine).toBe(askGroupLine(['leave']));
    expect(custom.benefit).toBe('적립금 5천 원');
    expect(custom.extraContext).toContain(line);
    const none = askComposeLicense(line, plan, 'none', '무시', false);
    expect([none.licenseLine, none.benefit]).toEqual([askGroupLine(['leave']), null]);
    expect(none.extraContext).toMatch(/쓰지 않는다/);
    expect(askComposeLicense(null, plan, 'line', null, true).extraContext).toMatch(/다시 쓰기/);
    // 묶음 문장(근거 글)에는 혜택 · 금액 낱말이 없다
    for (const gg of ASK_GROUPS) expect(askGroupLine([gg.key])).not.toMatch(/%|쿠폰|할인|무료|증정|적립|\d/);
  });
  it('참고 글은 근거 글이 아니라 참고 블록에만 들어간다', () => {
    expect(body).toMatch(/buildMessageObjective\(licenseText, \[audienceBlock, lineAnswersContext\(answers\), ask\?\.extraContext\]/);
    expect(body).toMatch(/const licenseText = `\$\{buildLineEventText\(withLinkToken\(input\.line, humanLink\), \{ benefit: input\.facts\.benefit \}\)\}/);
  });
});

describe('K5 주소 · 관문 · 자리표 판정', () => {
  const route = read(join(BE, 'routes', 'ai-line.ts'));
  it('읽기(/ask/read)만 로그인 · 나머지 넷 = 같은 요금제 관문(lineGate)', () => {
    expect(routeBlock(route, 'post', '/ask/read')).toMatch(/viewerOf\(req\)/);
    expect(routeBlock(route, 'post', '/ask/read')).not.toMatch(/lineGate|query\(/);
    for (const [m, p] of [['get', '/ask/segments'], ['post', '/ask/count'], ['post', '/ask/audience'], ['post', '/ask/compose']] as const) {
      const b = routeBlock(route, m, p);
      expect(b, p).toMatch(/const v = await lineGate\(req, res\);\s*if \(!v\) return;/);
    }
  });
  it('benefitHole = 직접발송 길목과 같은 판정(findUneditedSendPlaceholder) · 혜택 감지 자리표를 잡는다', () => {
    expect(routeBlock(route, 'post', '/ask/compose')).toMatch(/benefitHole: findUneditedSendPlaceholder\(card\.body, card\.subject\) !== null/);
    expect(findUneditedSendPlaceholder(`오랜만이에요. ${BENEFIT_PLACEHOLDER}`, '')).not.toBeNull();
    expect(findUneditedSendPlaceholder('오랜만에 안부 전해요.', '다시 만나요')).toBeNull();
  });
  it('문안 = 한 안(혜택형) · 장문 · 광고 · 칼럼 0 · 대상 = §2-1 세기의 planned', () => {
    const b = routeBlock(route, 'post', '/ask/compose');
    expect(b).toMatch(/types: \['benefit'\], vars: \[\], channel: 'LMS', isAd: true/);
    expect(b).toMatch(/count: counted\.planned/);
  });
});

describe('K6 대시보드 넘기기', () => {
  const dash = read(join(FE, 'pages', 'Dashboard.tsx'));
  const body = fnBody(join(FE, 'pages', 'Dashboard.tsx'), 'loadPendingAudience');
  it('문안 · 제목 · 장문 · 광고 칸 = ask 일 때만 · 명단은 옛 kind 와 같은 더하기', () => {
    expect(body).toMatch(/if \(asked\.kind === 'ask'\) \{\s*setDirectMessage\(asked\.ask\.message\.body\);\s*setDirectSubject\(asked\.ask\.message\.subject\);\s*setDirectMsgType\(asked\.ask\.message\.msgType\);\s*setAdTextEnabled\(true\);\s*\}/);
    expect((body.match(/setDirectMessage\(/g) || []).length).toBe(1);
    expect(body).toMatch(/setDirectRecipients\(appendUpdater<any>\(rows, true, \(r\) => r\.phone, \(\) => undefined\)\)/);
    expect(body).toMatch(/asked\.kind === 'ask' \? await fetchAskAudience\(asked\.ask\.plan\) : await fetchAudience\(asked\.kind, asked\.value, asked\.kind === 'pair' \? asked\.other : undefined\)/);
  });
  it('받은 뒤 채우기 전에 지금 계정을 다시 본다(저장소의 지금 값)', () => {
    expect(body).toMatch(/useAuthStore\.getState\(\)\.user[\s\S]*askOwnerMatches\(asked\.ask, \{ userId: nowUser\?\.id, companyId: nowUser\?\.company\?\.id \}\)\) return;[\s\S]*setDirectRecipients/);
    expect(dash).toMatch(/takeAudience\(\{ userId: user\?\.id, companyId: user\?\.company\?\.id \}\)/);
  });
});

describe('K7 넘기기 값 · 문안 결속(화면 순수 함수)', () => {
  const me = { userId: 'u1', companyId: 'c1' };
  const askOf = (at: number, owner = { userId: 'u1', companyId: 'c1' }) => ({
    kind: 'ask' as const, label: '떠나는 단골', seen: 3,
    ask: { plan: { groups: ['leave' as const], mode: 'all' as const, budget: null, order: 'recent' as const }, message: { body: '본문', subject: '제목', msgType: 'LMS' as const }, owner, at },
  });
  it('같은 계정 · 10분 안 = 꺼냄 · 한 번 쓰면 비움', () => {
    const now = 1_000_000;
    stashAudience(askOf(now - 1000));
    expect(takeAudience(me, now)?.kind).toBe('ask');
    expect(takeAudience(me, now)).toBeNull();
  });
  it('다른 회사 · 다른 사용자 · 계정 모름 · 10분 지남 · 미래 시각 = 꺼내지 않음(값은 지워진다)', () => {
    const now = 5_000_000;
    for (const [a, who] of [
      [askOf(now, { userId: 'u1', companyId: 'c2' }), me], [askOf(now, { userId: 'u2', companyId: 'c1' }), me],
      [askOf(now), null], [askOf(now - ASK_HANDOFF_MAX_AGE_MS - 1), me], [askOf(now + 10), me],
    ] as const) {
      stashAudience(a);
      expect(takeAudience(who, now)).toBeNull();
      expect(takeAudience(me, now)).toBeNull();
    }
    expect(askOwnerMatches(askOf(now).ask, me)).toBe(true);
    expect(askOwnerMatches(askOf(now).ask, { userId: 'u1', companyId: 'c9' })).toBe(false);
  });
  it('옛 kind 둘 = 계정 · 시각을 보지 않는다(종전 그대로)', () => {
    stashAudience({ kind: 'product', value: 'P1', label: '수분 크림', seen: 2 });
    expect(takeAudience(null)?.kind).toBe('product');
    stashAudience({ kind: 'search', value: 'q', label: 'q', seen: 1 });
    expect(takeAudience()?.kind).toBe('search');
    expect(audienceLoadedText({ kind: 'product', value: 'P1', label: '수분 크림', seen: 2 }, { recipients: [{ phone: '1', name: '' }, { phone: '2', name: '' }], total: 2, truncated: false }))
      .toBe('「수분 크림」을 보고 안 산 고객 2명을 불러왔어요');
  });
  it('문안 = 입력 지문 결속 · 혜택 칸 · 묶음 · 한 줄이 바뀌면 잠김 · 예산 · 순서는 문안을 바꾸지 않는다', () => {
    const base = { line: '오래 안 온 단골', groups: ['leave' as const], mode: askBenefitMode(false, ''), benefit: '' };
    const fp = askInputFp(base);
    expect(askInputFp({ ...base, groups: ['leave'] })).toBe(fp);
    expect(askInputFp({ ...base, mode: askBenefitMode(false, '10% 쿠폰'), benefit: '10% 쿠폰' })).not.toBe(fp);
    expect(askInputFp({ ...base, groups: ['leave', 'rest'] })).not.toBe(fp);
    expect(askInputFp({ ...base, line: '다른 한 줄' })).not.toBe(fp);
    expect(askInputFp({ ...base, mode: askBenefitMode(true, '아무 글') })).not.toBe(fp);
    // 「혜택 없이」면 혜택 칸 글은 지문에 없다
    expect(askInputFp({ ...base, mode: 'none', benefit: 'a' })).toBe(askInputFp({ ...base, mode: 'none', benefit: 'b' }));
  });
  it('가져가기 잠금 = 만드는 중 · 문안 없음 · 지문 다름 · 자리표 남음 · 0명', () => {
    const ok = { making: false, cardFp: 'f', nowFp: 'f', benefitHole: false, planned: 3 };
    expect(askTakeBlock(ok)).toBeNull();
    expect(askTakeBlock({ ...ok, making: true })).toBe('making');
    expect(askTakeBlock({ ...ok, cardFp: null })).toBe('no-card');
    expect(askTakeBlock({ ...ok, nowFp: 'g' })).toBe('stale');
    expect(askTakeBlock({ ...ok, benefitHole: true })).toBe('hole');
    expect(askTakeBlock({ ...ok, planned: 0 })).toBe('zero');
  });
  it('내역 = 서버 칸 값의 합(지어낸 수 0) · 순서 축으로 묶음 · 예산 글', () => {
    const cells = [{ key: 'r4c2', n: 5, taken: 5 }, { key: 'r3c2', n: 4, taken: 1 }, { key: 'nobuy', n: 2, taken: 0 }];
    expect(askParts({ cells }, 'recent')).toEqual([
      { label: '6달~1년 전에 산 분', n: 4, taken: 1 }, { label: '1년 넘게 안 산 분', n: 5, taken: 5 }, { label: '구매 기록 없는 분', n: 2, taken: 0 },
    ]);
    expect(askParts({ cells }, 'count')).toEqual([{ label: '4번 이상 산 분', n: 9, taken: 6 }, { label: '구매 기록 없는 분', n: 2, taken: 0 }]);
    expect(askBudgetOf('5,0000원')).toBe(50_000);
    expect([askBudgetValid(999), askBudgetValid(1000), askBudgetValid(100_000_001)]).toEqual([false, true, false]);
  });
});

// ★ 2026-11-21 C151 2차 — 대시보드 상단 「한 줄로 묻기」 카드(Harold 「별도메뉴」 → 「미가입도 보이게 하고 클릭하면 메뉴 설명」)
describe('K8 대시보드 카드 · 소개 창', () => {
  const dash = read(join(FE, 'pages', 'Dashboard.tsx'));
  it('AI 카드 줄 = AI 한줄로 · 한 줄로 묻기 · AI 오퍼레이터 · 고객 DB 업로드 차례 · 요금제와 상관없이 보이고 잠김은 구독만', () => {
    const list = dash.slice(dash.indexOf('const dashboardActions: DashboardAction[] = hideAi'), dash.indexOf('// 모달용 데이터'));
    const keys = [...list.split(': [')[2].matchAll(/\{ key: '([a-z]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(['line', 'ask', 'operator', 'upload']);
    expect(list).toContain("{ key: 'ask', label: '한 줄로 묻기', desc: '고객 골라 보내기', icon: Users, tone: 'sky', locked: isSubscriptionLocked, onClick: () => { void openAiLine('/ai-ask', 'ask-entry'); } },");
  });
  it('누르면 AI 한줄로와 같은 판정 · 못 쓰면 그 기능 소개 창 · 기본값 = 옛 동작 그대로', () => {
    const body = fnBody(join(FE, 'pages', 'Dashboard.tsx'), 'openAiLine');
    expect(dash).toContain("const openAiLine = async (path: '/ai-line' | '/ai-ask' = '/ai-line', featureId = 'ai-line') => {");
    expect(body).toMatch(/if \(isSubscriptionLocked\) \{ setShowSubscriptionLock\(true\); return; \}\s*if \(\(await fetchAiOperatorAccess\(\)\) === false\) \{ openPlanFeature\(featureId\); return; \}\s*navigate\(path\);/);
  });
  it('소개 창 원장 ask-entry = 문안 크레딧은 한 줄로 묻기 문안과 같은 출처 · 허브 카드가 아니라 path 없음', async () => {
    const { PLAN_FEATURE_INTROS } = await import('../../content/plan-feature-intros');
    const f = PLAN_FEATURE_INTROS.find((x) => x.id === 'ask-entry');
    expect(f?.title).toBe('한 줄로 묻기');
    expect(f?.costs).toEqual([{ label: '문안 1안', source: 'ai-line-compose' }, { label: '질문에 답 받기', source: 'ai-operator-explain' }]);   // ★ C152 B 답 받기 줄
    expect(f?.path).toBeUndefined();
    expect(f?.video).toBeUndefined();
  });
});
