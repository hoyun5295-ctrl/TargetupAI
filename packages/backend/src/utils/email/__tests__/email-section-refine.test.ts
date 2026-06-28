import { describe, it, expect } from 'vitest';
import { collectRefinableTexts, applyRefinedTexts, isRefinedTextSafe } from '../email-section-refine';
import type { Section } from '../../dm/dm-section-registry';

const sec = (over: Partial<Section>): Section =>
  ({ id: 'x', type: 'text_card', order: 0, visible: true, props: {} as any, ...over });

describe('collectRefinableTexts', () => {
  it('hero/text_card 텍스트 + cta 버튼 라벨을 순서대로 수집', () => {
    const sections = [
      sec({ id: 'h', type: 'hero', props: { headline: '여름 신상', sub_copy: '' } as any }),
      sec({ id: 't', type: 'text_card', order: 1, props: { tag: 'NEW', headline: '포인트', body: '본문' } as any }),
      sec({ id: 'c', type: 'cta', order: 2, props: { buttons: [{ label: '보러가기', url: '' }] } as any }),
    ];
    const { slots, texts } = collectRefinableTexts(sections);
    expect(texts).toEqual(['여름 신상', 'NEW', '포인트', '본문', '보러가기']);
    expect(slots.length).toBe(5);
  });

  it('숨김 섹션·빈 문자열·혜택/법적 필드는 제외', () => {
    const sections = [
      sec({ id: 'a', type: 'hero', visible: false, props: { headline: '숨김' } as any }),
      sec({ id: 'b', type: 'hero', order: 1, props: { headline: '보임', sub_copy: '   ' } as any }),
      // coupon/footer/store_info는 REFINABLE_FIELD_KEYS에 없어 수집 0
      sec({ id: 'c', type: 'coupon', order: 2, props: { discount_label: '20% 할인', usage_condition: '조건' } as any }),
      sec({ id: 'f', type: 'footer', order: 3, props: { legal_text: '법적 고지', notes: '메모' } as any }),
    ];
    const { texts } = collectRefinableTexts(sections);
    expect(texts).toEqual(['보임']);
  });
});

describe('isRefinedTextSafe', () => {
  it('빈 결과는 거부', () => {
    expect(isRefinedTextSafe('원본', '')).toBe(false);
    expect(isRefinedTextSafe('원본', '   ')).toBe(false);
  });
  it('변수 토큰 누락은 거부, 보존은 통과', () => {
    expect(isRefinedTextSafe('{{ customer.name }}님 안녕', '안녕하세요')).toBe(false);
    expect(isRefinedTextSafe('{{ customer.name }}님 안녕', '{{ customer.name }}님 반가워요')).toBe(true);
  });
  it('혜택 자리표시자 손실은 거부(두 표기 모두)', () => {
    expect(isRefinedTextSafe('지금 [직접 작성해주세요] 받기', '지금 받기')).toBe(false);
    expect(isRefinedTextSafe('지금 [직접 작성해주세요] 받기', '지금 [직접 작성해주세요] 받으세요')).toBe(true);
    expect(isRefinedTextSafe('[혜택을 직접 입력해주세요]', '더 나은 문구')).toBe(false);
  });
});

describe('applyRefinedTexts', () => {
  it('안전 통과분만 교체하고 원본은 불변', () => {
    const sections = [
      sec({ id: 'h', type: 'hero', props: { headline: '{{ customer.name }}님', sub_copy: '안내' } as any }),
    ];
    const { slots } = collectRefinableTexts(sections);
    // headline은 변수 누락(거부) / sub_copy는 통과
    const out = applyRefinedTexts(sections, slots, ['이름님', '반가운 안내']);
    expect((out[0].props as any).headline).toBe('{{ customer.name }}님');
    expect((out[0].props as any).sub_copy).toBe('반가운 안내');
    expect((sections[0].props as any).sub_copy).toBe('안내'); // 원본 불변
  });

  it('cta 버튼 라벨만 교체, url 등 보존', () => {
    const sections = [sec({ id: 'c', type: 'cta', props: { buttons: [{ label: '보러가기', url: 'u', style: 'primary' }] } as any })];
    const { slots } = collectRefinableTexts(sections);
    const out = applyRefinedTexts(sections, slots, ['지금 보러가기']);
    const btn = (out[0].props as any).buttons[0];
    expect(btn.label).toBe('지금 보러가기');
    expect(btn.url).toBe('u');
    expect(btn.style).toBe('primary');
  });
});
