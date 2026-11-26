/**
 * 의심 부분 고르기(A) — 순수 핵심 (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §5 · §11)
 *   ★ 2026-11-26 C164 — 「의심 부분을 뺀 글」 판 · 그 결과로 가르던 옛 대행 갈래는 없앴다. 새 판 계약 = spam-rewrite-pure-1126.test.ts
 *
 * 고정값 = 폴라초이스 꼴의 합성 글(실제 고객 글이 아니다 · 구조만 같다): 광고 첫 줄 · 단축 주소 두 줄 · ■ 혜택 줄 · 수신거부 줄.
 */
import { describe, it, expect } from 'vitest';
import {
  tokenizeSpamText, rankSuspects, pickBaseline, DIAG_BASELINE_MIN_SIMILARITY,
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
    const r = rankSuspects({ sentText: V2, templateText: V2, passedTexts: [{ text: PASSED_THANKS, at: '2026-11-16' }], blockedSiblings: [V1], ruleTokens: [] });
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
    const r = rankSuspects({ sentText: sent, templateText: template, passedTexts: [], blockedSiblings: [], ruleTokens: [] });
    expect(r.suspects.some((s) => s.token.includes('홍길동'))).toBe(false);
  });

  it('닮은 지난 통과 글이 있으면 그 글에 없던 조각을 주소 다음에 둔다(new_vs_passed)', () => {
    const passed = V1.replace('■ 최대 35% 할인\n', '').replace('>https://tinyurl.example/bbb222\n', '');
    const r = rankSuspects({ sentText: V1, templateText: V1, passedTexts: [{ text: passed, at: '2026-11-20' }], blockedSiblings: [], ruleTokens: [] });
    expect(r.baseline?.at).toBe('2026-11-20');
    const kinds = r.suspects.map((s) => `${s.kind}:${s.token}`);
    expect(kinds).toEqual(expect.arrayContaining(['new_vs_passed:35%', 'new_vs_passed:할인']));
  });

  it('닮음 문턱 = 시작값 0.5(구현 0단계에서 실제 글로 맞춘다)', () => {
    expect(DIAG_BASELINE_MIN_SIMILARITY).toBe(0.5);
    expect(pickBaseline(V1, [{ text: PASSED_THANKS, at: 'x' }])).toBeNull();
    expect(pickBaseline(V1, [{ text: V2, at: 'y' }])?.at).toBe('y');
  });
});
