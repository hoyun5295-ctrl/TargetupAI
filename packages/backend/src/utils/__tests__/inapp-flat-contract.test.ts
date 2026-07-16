/**
 * ★ 2026-07-16 인앱 범용 보장 계약 테스트 — blocks → flat 합성 (composeFlatFromBlocks)
 *
 * 근본: 편집기·서버·웹SDK는 블록 기반인데 flat(title·body·image_url·buttons·badge)만 읽는
 * 소비자(고객사 앱)가 존재 — 블록에만 넣은 이미지·버튼이 flat 미동기로 소실되던 사고를
 * "블록이 있으면 blocks가 진실 → flat 합성"으로 영구 차단한다. 이 테스트가 그 계약을 고정한다.
 */

import { describe, it, expect } from 'vitest';
import {
  composeFlatFromBlocks,
  synthesizeButtonsFromActionUrl,
  sanitizeContentBlocks,
} from '../inapp-message';

describe('composeFlatFromBlocks — 범용 보장 계약 합성', () => {
  it('media 블록 첫 이미지 → imageUrl', () => {
    const flat = composeFlatFromBlocks([
      { type: 'headline', text: '제목' },
      { type: 'media', variant: 'image', url: '/api/cdp/inapp/image/co/1.jpg' },
      { type: 'media', variant: 'image', url: '/api/cdp/inapp/image/co/2.jpg' },
    ]);
    expect(flat.imageUrl).toBe('/api/cdp/inapp/image/co/1.jpg');
  });

  it('variant 없는 media(구버전)도 url 있으면 이미지로 인정, url 빈 media는 무시', () => {
    expect(composeFlatFromBlocks([{ type: 'media', url: '/x.png' }]).imageUrl).toBe('/x.png');
    expect(composeFlatFromBlocks([{ type: 'media', variant: 'image', url: '  ' }]).imageUrl).toBeNull();
  });

  it('cta_group 버튼 → buttons (action_url 보존 — 링크 실동작 축)', () => {
    const flat = composeFlatFromBlocks([
      { type: 'cta_group', layout: 'stack', buttons: [
        { id: 'btn_primary', label: '자세히 보기', action_url: 'https://mall.example/event', style: 'primary' },
        { id: 'btn_2', label: '나중에', action_url: null, style: 'secondary' },
      ] },
    ]);
    expect(flat.buttons).toHaveLength(2);
    expect(flat.buttons[0]).toMatchObject({ id: 'btn_primary', label: '자세히 보기', action_url: 'https://mall.example/event', style: 'primary' });
    expect(flat.buttons[1].action_url).toBeNull();
  });

  it('버튼 최대 3개 + label 없는 버튼 제외 + 미허용 style은 primary/secondary 폴백', () => {
    const flat = composeFlatFromBlocks([
      { type: 'cta_group', buttons: [
        { label: 'a', action_url: '/a', style: 'weird' },
        { label: '' },
        { label: 'b', action_url: '/b' },
        { label: 'c', action_url: '/c' },
        { label: 'd', action_url: '/d' },
      ] },
    ]);
    expect(flat.buttons).toHaveLength(3);
    expect(flat.buttons.map((b: any) => b.label)).toEqual(['a', 'b', 'c']);
    expect(flat.buttons[0].style).toBe('primary');
    expect(flat.buttons[1].style).toBe('secondary');
  });

  it('camelCase actionUrl(변형 입력)도 흡수한다', () => {
    const flat = composeFlatFromBlocks([
      { type: 'cta_group', buttons: [{ label: '이동', actionUrl: 'https://mall.example/p' }] },
    ]);
    expect(flat.buttons[0].action_url).toBe('https://mall.example/p');
  });

  it('headline → title, body 블록 → body (body 없으면 headline 폴백)', () => {
    const flat = composeFlatFromBlocks([
      { type: 'headline', text: ' 봄맞이 신상 ' },
      { type: 'body', text: '본문입니다' },
    ]);
    expect(flat.title).toBe('봄맞이 신상');
    expect(flat.body).toBe('본문입니다');
    const only = composeFlatFromBlocks([{ type: 'headline', text: '헤드라인만' }]);
    expect(only.body).toBe('헤드라인만');
  });

  it('eyebrow → badgeText', () => {
    expect(composeFlatFromBlocks([{ type: 'eyebrow', text: 'NEW' }]).badgeText).toBe('NEW');
  });

  it('빈 블록/비블록 입력 = 전부 null·빈 배열 (합성 없음)', () => {
    const flat = composeFlatFromBlocks([]);
    expect(flat).toEqual({ title: null, body: null, imageUrl: null, buttons: [], badgeText: null });
    expect(composeFlatFromBlocks(null as any).buttons).toEqual([]);
  });

  it('블록에 media·cta가 없으면 imageUrl/buttons 비움 — 편집기 표시와 일치(블록이 진실)', () => {
    const flat = composeFlatFromBlocks([{ type: 'headline', text: 'x' }]);
    expect(flat.imageUrl).toBeNull();
    expect(flat.buttons).toEqual([]);
  });

  it('sanitizeContentBlocks 통과분과 왕복 — 위험 스킴 버튼은 무해화된 채 합성', () => {
    const blocks = sanitizeContentBlocks([
      { type: 'cta_group', buttons: [{ id: 'b', label: '클릭', action_url: 'javascript:alert(1)' }] },
    ]);
    const flat = composeFlatFromBlocks(blocks);
    expect(flat.buttons[0].action_url).toBeNull();
  });

  it('placeholder URL("[URL — 회사 admin 수정]")은 보존 — SDK/앱이 이동만 차단', () => {
    const flat = composeFlatFromBlocks([
      { type: 'cta_group', buttons: [{ label: '자세히', action_url: '[URL — 회사 admin 수정]' }] },
    ]);
    expect(flat.buttons[0].action_url).toBe('[URL — 회사 admin 수정]');
  });
});

describe('synthesizeButtonsFromActionUrl — 옛 단일 CTA 승격(앱 채널 응답)', () => {
  it('actionUrl → primary 버튼 1개 (라벨 기본 "자세히 보기")', () => {
    expect(synthesizeButtonsFromActionUrl('https://mall.example/e', null)).toEqual([
      { id: 'btn_primary', label: '자세히 보기', action_url: 'https://mall.example/e', style: 'primary' },
    ]);
    expect(synthesizeButtonsFromActionUrl('/event', '보러가기')[0].label).toBe('보러가기');
  });

  it('빈/공백 actionUrl = 빈 배열', () => {
    expect(synthesizeButtonsFromActionUrl(null)).toEqual([]);
    expect(synthesizeButtonsFromActionUrl('  ')).toEqual([]);
  });
});
