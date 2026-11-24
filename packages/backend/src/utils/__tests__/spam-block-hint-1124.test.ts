/**
 * 의심 부분 고르기(A) · 확인 판 만들기 · 대행 갈래 — 순수 핵심 (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §5 · §6-1 · §7 · §11)
 *
 * 고정값 = 폴라초이스 꼴의 합성 글(실제 고객 글이 아니다 · 구조만 같다): 광고 첫 줄 · 단축 주소 두 줄 · ■ 혜택 줄 · 수신거부 줄.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenizeSpamText, rankSuspects, pickBaseline, makeDiagVariant, classifyDiag, DIAG_BASELINE_MIN_SIMILARITY,
} from '../spam-block-hint';

const V1 = [
  '(광고) 하늘몰 겨울 대축제가 시작됩니다.',
  '',
  '■ 한정 보습크림 20% 더블 기획',
  '>https://tinyurl.example/aaa111',
  '',
  '[겨울 대축제 혜택]',
  '■ 최대 35% 할인',
  '■ 본품 구매 시 최대 50% 용량 SIZE UP',
  '>https://tinyurl.example/bbb222',
  '',
  '하늘몰',
  '무료 수신거부 : 080-000-0000',
].join('\n');

// 같은 글의 고친 판(첫 줄 · 소제목 · SIZE UP 만 바뀜) — 이것도 막혔다
const V2 = V1
  .replace('겨울 대축제가 시작됩니다.', '겨울 대축제 행사가 열립니다.')
  .replace('[겨울 대축제 혜택]', '[공식몰 단독 혜택]')
  .replace('SIZE UP', '사이즈업');

// 같은 번호로 도착했던 지난 글 — 광고가 아닌 감사 인사(안 닮음)
const PASSED_THANKS = ['안녕하세요, 하늘몰입니다.', '어제 행사에 함께해 주셔서 감사합니다!', 'https://tinyurl.example/zzz999'].join('\n');

describe('조각 나누기', () => {
  it('주소는 통째 · 낱말은 앞뒤 기호를 떼고 영문 소문자 · 법정 줄(광고 첫 줄 · 수신거부 줄)은 법정 표시', () => {
    const t = tokenizeSpamText(V1);
    const tokens = t.tokens.map((x) => x.token);
    expect(tokens).toContain('https://tinyurl.example/aaa111');
    expect(tokens).toContain('size');
    expect(tokens).toContain('20%');
    expect(t.tokens.filter((x) => x.legal).map((x) => x.token)).toEqual(expect.arrayContaining(['(광고)', '080-000-0000']));
    expect(t.lines[0].legal).toBe(true);
    expect(t.lines[11].legal).toBe(true);
  });
});

describe('의심 부분 순서(rankSuspects)', () => {
  it('고친 판이 막혔던 조각은 지우지 않고 뒤로 민다 · 주소가 맨 앞 · 닮은 지난 글 없음 · 법정 조각 0', () => {
    const r = rankSuspects({ sentText: V2, templateText: V2, passedTexts: [{ text: PASSED_THANKS, at: '2026-11-16' }], blockedSiblings: [V1], ruleTokens: [], confirmedNotSole: [] });
    expect(r.baseline).toBeNull();
    expect(r.suspects[0].kind).toBe('url');
    expect(r.suspects[1].kind).toBe('url');
    const demoted = r.suspects.filter((s) => s.demoted).map((s) => s.token);
    // V2 에만 있는 조각(고친 판 V1 에는 없음) = V1 이 그것 없이도 막혔다 → 뒤로
    expect(demoted).toEqual(expect.arrayContaining(['행사가', '열립니다', '공식몰', '단독', '사이즈업']));
    expect(r.suspects.some((s) => s.token === '(광고)' || s.token === '080-000-0000')).toBe(false);
    // 지우지 않는다
    expect(r.suspects.some((s) => s.token === '사이즈업')).toBe(true);
  });

  it('변수 값(보낸 글에만 있고 원문에 없는 조각)은 후보에 안 나온다', () => {
    const sent = '(광고) 홍길동님 겨울 혜택\n무료 수신거부 : 080-000-0000';
    const template = '(광고) %이름%님 겨울 혜택\n무료 수신거부 : 080-000-0000';
    const r = rankSuspects({ sentText: sent, templateText: template, passedTexts: [], blockedSiblings: [], ruleTokens: [], confirmedNotSole: [] });
    expect(r.suspects.some((s) => s.token.includes('홍길동'))).toBe(false);
  });

  it('닮은 지난 통과 글이 있으면 그 글에 없던 조각을 주소 다음에 둔다(new_vs_passed)', () => {
    const passed = V1.replace('■ 최대 35% 할인\n', '').replace('>https://tinyurl.example/bbb222\n', '');
    const r = rankSuspects({ sentText: V1, templateText: V1, passedTexts: [{ text: passed, at: '2026-11-20' }], blockedSiblings: [], ruleTokens: [], confirmedNotSole: [] });
    expect(r.baseline?.at).toBe('2026-11-20');
    const kinds = r.suspects.map((s) => `${s.kind}:${s.token}`);
    expect(kinds).toEqual(expect.arrayContaining(['new_vs_passed:35%', 'new_vs_passed:할인']));
  });

  it('확인 판으로 「빼도 막힘」이 확정된 조각은 표시 · 다음 판 고르기에서 빠진다', () => {
    const r = rankSuspects({ sentText: V1, templateText: V1, passedTexts: [], blockedSiblings: [], ruleTokens: [], confirmedNotSole: ['https://tinyurl.example/aaa111', 'https://tinyurl.example/bbb222'] });
    const url = r.suspects.filter((s) => s.kind === 'url');
    expect(url.every((s) => s.confirmedNotSole)).toBe(true);
  });

  it('닮음 문턱 = 시작값 0.5(구현 0단계에서 실제 글로 맞춘다)', () => {
    expect(DIAG_BASELINE_MIN_SIMILARITY).toBe(0.5);
    expect(pickBaseline(V1, [{ text: PASSED_THANKS, at: 'x' }])).toBeNull();
    expect(pickBaseline(V1, [{ text: V2, at: 'y' }])?.at).toBe('y');
  });
});

describe('확인 판 만들기(makeDiagVariant)', () => {
  it('판 ① = 주소 조각만 뺀다(> 만 남는 줄은 줄째) · 나머지 글자 그대로 · 법정 줄 보존', () => {
    const v = makeDiagVariant(V1, 1, [])!;
    expect(v.text).not.toContain('tinyurl');
    expect(v.text).toContain('■ 최대 35% 할인');
    expect(v.text).toContain('(광고) 하늘몰 겨울 대축제가 시작됩니다.');
    expect(v.text).toContain('무료 수신거부 : 080-000-0000');
    expect(v.text.split('\n').some((l) => l.trim() === '>')).toBe(false);
    expect(v.removedTokens).toEqual(['https://tinyurl.example/aaa111', 'https://tinyurl.example/bbb222']);
  });

  it('★ 배포 2 Codex 1R 판 ① = 주소를 실제로 뺀 줄 밖은 원문 그대로(구분 줄 · 기호 줄 보존) · (광고) 첫 줄의 주소는 건드리지 않는다', () => {
    const text = ['(광고) 하늘몰 https://a.example/top', '■■■■■■', '>https://b.example/x', '혜택 안내', '무료 수신거부 080-000-0000'].join('\n');
    const v = makeDiagVariant(text, 1, [])!;
    expect(v.text).toBe(['(광고) 하늘몰 https://a.example/top', '■■■■■■', '혜택 안내', '무료 수신거부 080-000-0000'].join('\n'));
    expect(v.removedTokens).toEqual(['https://b.example/x']);
  });

  it('주소가 없으면 판 ① 없음', () => {
    expect(makeDiagVariant('(광고) 겨울 혜택\n■ 최대 35% 할인\n무료 수신거부 : 080-000-0000', 1, [])).toBeNull();
  });

  it('판 ② = 표시한 줄(지난 글에 없던 조각이 든 줄) · 후보가 없으면 숫자 든 줄 · 법정 줄 · 주소 줄은 안 뺀다', () => {
    const v = makeDiagVariant(V1, 2, [])!;
    expect(v.text).not.toContain('■ 최대 35% 할인');
    expect(v.text).not.toContain('20% 더블 기획');
    expect(v.text).toContain('(광고) 하늘몰 겨울 대축제가 시작됩니다.');
    expect(v.text).toContain('무료 수신거부 : 080-000-0000');
    expect(v.text).toContain('tinyurl.example/aaa111');
    const withSuspect = makeDiagVariant(V1, 2, [{ token: '할인', kind: 'new_vs_passed', line: 6 }])!;
    expect(withSuspect.text).not.toContain('■ 최대 35% 할인');
    expect(withSuspect.text).toContain('■ 한정 보습크림 20% 더블 기획');
  });

  it('남는 줄이 법정 줄뿐이면 판 없음', () => {
    expect(makeDiagVariant('(광고) 50% 할인\n무료 수신거부 : 080-000-0000', 2, [])).toBeNull();
  });
});

describe('대행 갈래(classifyDiag) — 확정 결과만', () => {
  it('막힌 통신사 전부 판 ① 도착 = 4a', () => {
    expect(classifyDiag({ blockedCarriers: ['KT'], checks: { KT: { v1: 'arrived' } } }).branch).toBe('4a');
  });
  it('두 통신사 결과가 갈리면 4a 아님(KT 도착 · LGU 빼도 막힘 → 판 ② 자격이 있으면 대기)', () => {
    const r = classifyDiag({ blockedCarriers: ['KT', 'LGU'], checks: { KT: { v1: 'arrived' }, LGU: { v1: 'blocked' } } });
    expect(r.branch).not.toBe('4a');
  });
  it('판 ② 도착 = 4b · 보존 값(주소 · 숫자 · 번호)은 avoid 에 안 들어간다', () => {
    const r = classifyDiag({ blockedCarriers: ['KT'], checks: { KT: { v1: 'blocked', v2: 'arrived', v2Removed: ['최대', '35%', '할인', 'https://x.example/a'] } } });
    expect(r.branch).toBe('4b');
    expect(r.avoid).toEqual(['최대', '할인']);
  });
  it('대기 · 확인 중이 남으면 대기 · 확인 못 함 · 빼도 막힘뿐이면 4c', () => {
    expect(classifyDiag({ blockedCarriers: ['KT'], checks: { KT: { v1: 'checking' } } }).branch).toBe('wait');
    expect(classifyDiag({ blockedCarriers: ['KT'], checks: { KT: { v1: 'unknown' } } }).branch).toBe('4c');
    expect(classifyDiag({ blockedCarriers: ['KT'], checks: { KT: { v1: 'blocked', v2: 'blocked' } } }).branch).toBe('4c');
    expect(classifyDiag({ blockedCarriers: ['KT'], checks: {} }).branch).toBe('4c');
  });
});
