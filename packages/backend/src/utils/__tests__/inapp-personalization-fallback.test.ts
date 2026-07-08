import { describe, it, expect } from 'vitest';
import { renderTextForCustomer, renderBlocksForCustomer } from '../inapp-personalization';

/**
 * ★ 2026-07-08 인앱 개인화 fallback — 익명·미식별 방문자의 변수 공백("님,"/"회원님") 방지.
 * 이름 없으면 "고객"(호출부 세팅), 빈 변수는 공백 정리. 식별 회원은 실값 그대로(회귀 0).
 */
describe('renderTextForCustomer — 개인화 fallback + 공백 정리', () => {
  const TEMPLATE = '{{ customer.name }}님, %등급% 회원님을 위한 시세이도 인기 라인 15% 할인 소식이에요.';

  it('식별 회원 = 실제 이름·등급 그대로 (회귀 0)', () => {
    const { rendered } = renderTextForCustomer(TEMPLATE, { name: '유호윤', grade: 'VIP' });
    expect(rendered).toBe('유호윤님, VIP 회원님을 위한 시세이도 인기 라인 15% 할인 소식이에요.');
  });

  it('★ 익명(이름 고객 + 등급 공백) = "고객님, 회원님" (이중 공백 정리)', () => {
    const { rendered } = renderTextForCustomer(TEMPLATE, { name: '고객' });
    expect(rendered).toBe('고객님, 회원님을 위한 시세이도 인기 라인 15% 할인 소식이에요.');
    expect(rendered).not.toContain('  ');
    expect(rendered).not.toContain('님,  ');
  });

  it('변수가 줄 맨 앞 = 잔여 앞 공백 제거', () => {
    expect(renderTextForCustomer('%등급% 회원 혜택', { name: '고객' }).rendered).toBe('회원 혜택');
  });

  it('직접 입력 텍스트(변수 없음) = 무손상 (이중 공백도 보존)', () => {
    const plain = '여름  세일  안내';
    expect(renderTextForCustomer(plain, {}).rendered).toBe(plain);
  });

  it('개행 보존 + 각 줄 잔여 공백만 정리', () => {
    const { rendered } = renderTextForCustomer('{{ customer.name }}님\n%등급% 안내', { name: '고객' });
    expect(rendered).toBe('고객님\n안내');
  });
});

describe('renderBlocksForCustomer — 블록 텍스트 서버 사전 치환', () => {
  const customer = { name: '고객' };

  it('블록 text/label/items 치환 + 비텍스트 필드 보존', () => {
    const blocks = [
      { type: 'headline', text: '{{ customer.name }}님 반가워요' },
      { type: 'hero', image_url: 'https://x/y.png', accent: '#4f46e5' },
      { type: 'bullets', items: [{ icon: 'tag', text: '%등급% 회원 혜택' }] },
      { type: 'cta_group', buttons: [{ label: '{{ customer.name }}님 보기', action_url: 'https://x' }] },
    ];
    const out = renderBlocksForCustomer(blocks, customer) as any[];
    expect(out[0].text).toBe('고객님 반가워요');
    expect(out[1].image_url).toBe('https://x/y.png');
    expect(out[1].accent).toBe('#4f46e5');
    expect(out[2].items[0].text).toBe('회원 혜택');
    expect(out[2].items[0].icon).toBe('tag');
    expect(out[3].buttons[0].label).toBe('고객님 보기');
    expect(out[3].buttons[0].action_url).toBe('https://x');
  });

  it('JSON 문자열 입력 = 치환 후 문자열 반환', () => {
    const s = JSON.stringify([{ type: 'body', text: '{{ customer.name }}님' }]);
    const out = renderBlocksForCustomer(s, customer);
    expect(typeof out).toBe('string');
    expect(JSON.parse(out as string)[0].text).toBe('고객님');
  });

  it('비배열/깨진 입력 = 원본 그대로', () => {
    expect(renderBlocksForCustomer(null, customer)).toBe(null);
    expect(renderBlocksForCustomer('not-json', customer)).toBe('not-json');
  });
});
