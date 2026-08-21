import { describe, it, expect } from 'vitest';
import {
  sanitizeActionUrl,
  sanitizeButtonsActionUrls,
  sanitizeContentBlocks,
  patchPresence,
  resolveActionUrlPatch,
} from './inapp-message';
import { replaceBlockTexts } from './inapp-variant-optimizer';

/**
 * ★ 2026-07-12 인앱 강화 고정 테스트 (SoT: specs/2026-07-12-inapp-full-reinforcement-design.md)
 * - P0-2 sanitizeActionUrl/sanitizeButtonsActionUrls: 저장 시 위험 스킴 null 무해화 (SDK와 2중)
 * - P1-1 patchPresence: 부분 PUT 병합 신호 (undefined=유지 / null=비우기 / 값=교체 — SQL CASE WHEN flag와 한 세트)
 * - P1-4 replaceBlockTexts: variant 블록 상속 — 첫 headline/body 텍스트만 교체, 구조 유지
 */

describe('sanitizeActionUrl (P0-2 저장 무해화)', () => {
  it('javascript:/data:/vbscript: = null 무해화', () => {
    expect(sanitizeActionUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeActionUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(sanitizeActionUrl('java\tscript:alert(1)')).toBeNull();
    expect(sanitizeActionUrl('data:text/html,x')).toBeNull();
    expect(sanitizeActionUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('https/http/상대경로 = 원문 그대로 보존', () => {
    expect(sanitizeActionUrl('https://shop.example.com/sale')).toBe('https://shop.example.com/sale');
    expect(sanitizeActionUrl('http://shop.example.com')).toBe('http://shop.example.com');
    expect(sanitizeActionUrl('/event/summer')).toBe('/event/summer');
  });

  it('placeholder([...]) = 저장 보존 (SDK가 이동 차단)', () => {
    expect(sanitizeActionUrl('[URL: 회사 admin 수정]')).toBe('[URL: 회사 admin 수정]');
  });

  it('빈 값/null/undefined = null', () => {
    expect(sanitizeActionUrl('')).toBeNull();
    expect(sanitizeActionUrl('   ')).toBeNull();
    expect(sanitizeActionUrl(null)).toBeNull();
    expect(sanitizeActionUrl(undefined)).toBeNull();
  });
});

describe('sanitizeButtonsActionUrls + sanitizeContentBlocks cta_group (P0-2)', () => {
  it('buttons 배열 안 위험 스킴만 null, 정상 URL·placeholder 보존', () => {
    const out = sanitizeButtonsActionUrls([
      { id: 'a', label: 'A', action_url: 'javascript:alert(1)' },
      { id: 'b', label: 'B', action_url: 'https://ok.example.com' },
      { id: 'c', label: 'C', action_url: '[URL: 회사 admin 수정]' },
    ]);
    expect(out[0].action_url).toBeNull();
    expect(out[1].action_url).toBe('https://ok.example.com');
    expect(out[2].action_url).toBe('[URL: 회사 admin 수정]');
  });

  it('배열 아님 = []', () => {
    expect(sanitizeButtonsActionUrls(null)).toEqual([]);
    expect(sanitizeButtonsActionUrls('x')).toEqual([]);
  });

  it('cta_group 블록 버튼도 저장 정규화에서 무해화', () => {
    const out = sanitizeContentBlocks([
      { type: 'headline', text: 'A' },
      { type: 'cta_group', layout: 'stack', buttons: [{ id: 'x', label: 'GO', action_url: 'javascript:alert(1)' }] },
    ]);
    expect(out[1].buttons[0].action_url).toBeNull();
    expect(out[1].layout).toBe('stack');
  });
});

describe('patchPresence (P1-1 부분 PUT 병합 신호)', () => {
  it('undefined = 기존값 유지 (set:false)', () => {
    expect(patchPresence(undefined)).toEqual({ set: false, value: null });
  });
  it('null = 비우기 의도 존중 (set:true, null)', () => {
    expect(patchPresence(null)).toEqual({ set: true, value: null });
  });
  it('값 = 교체 (set:true, 값 — 0도 유효값)', () => {
    expect(patchPresence(10)).toEqual({ set: true, value: 10 });
    expect(patchPresence(0)).toEqual({ set: true, value: 0 });
  });
});

describe('resolveActionUrlPatch (P0-2 Codex 2R — camel/snake 양쪽 수용)', () => {
  it('snake_case action_url 위험 스킴 = set:true + null 클리어', () => {
    expect(resolveActionUrlPatch({ action_url: 'javascript:alert(1)' })).toEqual({ set: true, value: null });
  });
  it('snake_case 명시 null = 비우기', () => {
    expect(resolveActionUrlPatch({ action_url: null })).toEqual({ set: true, value: null });
  });
  it('camelCase 우선 + 정상 URL 보존', () => {
    expect(resolveActionUrlPatch({ actionUrl: 'https://a.example', action_url: 'https://b.example' })).toEqual({ set: true, value: 'https://a.example' });
    expect(resolveActionUrlPatch({ action_url: 'https://b.example' })).toEqual({ set: true, value: 'https://b.example' });
  });
  it('양쪽 다 미제공 = 기존값 유지(set:false)', () => {
    expect(resolveActionUrlPatch({ title: 'x' })).toEqual({ set: false, value: null });
  });
});

describe('replaceBlockTexts (P1-4 variant 블록 상속)', () => {
  const parent = [
    { type: 'eyebrow', text: 'NEW' },
    { type: 'media', variant: 'image', url: '/uploads/a.png' },
    { type: 'headline', text: '부모 제목', size: 'lg' },
    { type: 'body', text: '부모 본문' },
    { type: 'body', text: '두 번째 본문' },
    { type: 'cta_group', buttons: [{ id: 'btn', label: '보기', action_url: 'https://x.example' }] },
  ];

  it('첫 headline/body 텍스트만 variant 문안으로 교체, 나머지 구조 유지', () => {
    const out = replaceBlockTexts(parent, '변형 제목', '변형 본문');
    expect(out[2]).toMatchObject({ type: 'headline', text: '변형 제목', size: 'lg' });
    expect(out[3]).toMatchObject({ type: 'body', text: '변형 본문' });
    expect(out[4]).toMatchObject({ type: 'body', text: '두 번째 본문' });
    expect(out[0]).toMatchObject({ type: 'eyebrow', text: 'NEW' });
    expect(out[1]).toMatchObject({ type: 'media', url: '/uploads/a.png' });
    expect(out[5].buttons[0].action_url).toBe('https://x.example');
  });

  it('부모 원본 불변(사본 반환)', () => {
    replaceBlockTexts(parent, 'X', 'Y');
    expect(parent[2].text).toBe('부모 제목');
    expect(parent[3].text).toBe('부모 본문');
  });

  it('빈 문안은 부모 텍스트 유지(빈 값으로 덮지 않음)', () => {
    const out = replaceBlockTexts(parent, '', '  ');
    expect(out[2].text).toBe('부모 제목');
    expect(out[3].text).toBe('부모 본문');
  });

  it('블록 없는 레거시 부모 = [] (레거시 렌더 그대로)', () => {
    expect(replaceBlockTexts(null, 'A', 'B')).toEqual([]);
    expect(replaceBlockTexts([], 'A', 'B')).toEqual([]);
  });
});
