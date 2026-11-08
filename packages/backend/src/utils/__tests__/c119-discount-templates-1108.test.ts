/**
 * ★ 2026-11-08 C119 할인 · 혜택 8 → 24 — 계약 시험(설계서 docs/2026-11-08-c119-discount-templates-20-design.md §4 T1 ~ T6)
 *   Harold 「보편적으로 쓸 수 있는 템플릿 · 2+1 이면 2+1 · 할인이면 할인」 「얼마나 깔끔하냐 · 왜 단순하게만」 「브랜드명 빼 · 제품 들어가는 공간만」
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { STUDIO_TEMPLATES, listTemplatesPublic, getTemplate } from '../image-studio-templates';
import { buildPosterPrompt, resolvePreset } from '../image-studio';
import { readDiscountOffer, discountPromptLines, discountFixedLayoutLine } from '../studio-discount';
import { INAPP_CONTENT_SAFE } from '../image-fit-spec';

const ROOT = path.join(__dirname, '..', '..', '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, ...p.split('/')), 'utf8');
const D = STUDIO_TEMPLATES.filter((t) => t.kind === 'discount');

/** 설계서 D2 · D2-b · D3 표(독립 출처) */
const TABLE: Array<[string, 'price' | 'nplus' | 'set', 'stack' | 'side']> = [
  ['discount-price-cream', 'price', 'stack'], ['discount-price-black', 'price', 'stack'], ['discount-price-cafe', 'price', 'stack'],
  ['discount-nplus-coral', 'nplus', 'stack'], ['discount-nplus-sky', 'nplus', 'stack'], ['discount-period-navy', 'price', 'stack'],
  ['discount-set-beige', 'set', 'stack'], ['discount-set-white', 'set', 'stack'],
  ['discount-price-bold-red', 'price', 'side'], ['discount-price-minimal-white', 'price', 'stack'], ['discount-price-vivid-yellow', 'price', 'stack'],
  ['discount-price-gradient', 'price', 'side'], ['discount-period-orange', 'price', 'stack'], ['discount-nplus-neon', 'nplus', 'side'],
  ['discount-nplus-mint', 'nplus', 'stack'], ['discount-nplus-lavender', 'nplus', 'stack'], ['discount-nplus-charcoal', 'nplus', 'side'],
  ['discount-set-black-gold', 'set', 'side'], ['discount-set-pale-blue', 'set', 'stack'], ['discount-set-sage', 'set', 'side'],
  ['discount-price-basic-gray', 'price', 'stack'], ['discount-price-basic-blue', 'price', 'stack'], ['discount-nplus-basic-white', 'nplus', 'stack'],
  ['discount-set-basic-gray', 'set', 'stack'],
];

describe('T1 할인 24 · 혜택 꼴 · 배치', () => {
  it('표 그대로(id · offer · layout) · 개수 = price 11 · nplus 7 · set 6 · side 6', () => {
    expect(D.map((t) => [t.id, t.offer, t.layout])).toEqual(TABLE);
    const count = (k: string) => D.filter((t) => t.offer === k).length;
    expect([count('price'), count('nplus'), count('set')]).toEqual([11, 7, 6]);
    expect(D.filter((t) => t.layout === 'side').length).toBe(6);
    expect(new Set(STUDIO_TEMPLATES.map((t) => t.id)).size).toBe(STUDIO_TEMPLATES.length);
  });
  it('배치 = 할인만 · 공개 목록 = 할인 stack · side · 그 밖 null', () => {
    expect(STUDIO_TEMPLATES.filter((t) => t.kind !== 'discount' && t.layout).map((t) => t.id)).toEqual([]);
    const pub = listTemplatesPublic();
    expect(pub.find((t) => t.id === 'discount-set-sage')!.layout).toBe('side');
    expect(pub.find((t) => t.id === 'discount-price-cream')!.layout).toBe('stack');
    expect(pub.find((t) => t.id === 'beauty-clean-bright')!.layout).toBeNull();
    expect(pub.every((t) => !('scaffold' in t) && !('textStyle' in t))).toBe(true);
  });
});

describe('T2 보편(업종 0) · 제품 자리 · 예시 제목', () => {
  const BANNED = ['뷰티', '화장품', '스킨케어', '기초', '의류', '패션', '카페', '디저트', '음료', '커피', '메뉴', '생활용품', '간식',
    'cosmetic', 'skincare', 'fashion', 'cafe', 'coffee', 'cup', 'dessert', 'menu', 'apparel', 'garment', 'appetizing'];
  for (const t of D) {
    it(`${t.id} = 이름 · desc · useCase · 장면 · textStyle 에 업종 말 0 · 장면 = plain + 제품 자리 · 예시 제목 「상품명」`, () => {
      const text = [t.name, t.desc, t.useCase, t.scaffold, t.textStyle].join(' | ').toLowerCase();
      expect(BANNED.filter((w) => text.includes(w.toLowerCase()))).toEqual([]);
      expect(t.scaffold).toMatch(/plain/);
      expect(t.scaffold).toMatch(t.offer === 'set' ? /holding all the products/ : /for the product/);
      expect(t.sample).toEqual({ title: '상품명' });
    });
  }
});

describe('T3 배치 문장 = CT 한 곳 · stack = 지금 그대로', () => {
  const price = (readDiscountOffer({ before: 59000, sale: 29900, period: '11.10 ~ 11.16', gift: '사은품' }, 'price') as any).offer;
  const set = (readDiscountOffer({ items: ['상품 A', '상품 B'], prices: [38000, 129000], sale: 139000 }, 'set') as any).offer;
  const np = (readDiscountOffer({ n: 2, m: 1, unit: 12000 }, 'nplus') as any).offer;
  it('stack = 기본값과 글자 같음 · centered · very top · very bottom(인앱 아님)', () => {
    for (const o of [price, set, np]) {
      expect(discountPromptLines(o, null, null, 'stack')).toEqual(discountPromptLines(o));
      expect(discountFixedLayoutLine(o, null, 'stack')).toBe(discountFixedLayoutLine(o));
      expect(discountPromptLines(o).join('\n')).not.toContain('left-aligned');
    }
    expect(discountFixedLayoutLine(price)).toContain('all inside the upper 40% of the poster');
  });
  it('side = left-aligned · centered 0 · 왼쪽 55% 한 기둥 · 제품 오른쪽 아래 · 증정 왼쪽 아래', () => {
    for (const o of [price, set, np]) {
      const lines = discountPromptLines(o, null, null, 'side').join('\n');
      expect(lines).toContain('left-aligned');
      expect(lines).not.toContain('centered');
      const fixed = discountFixedLayoutLine(o, null, 'side');
      expect(fixed).toContain('one left-aligned text column inside the left 55% of the poster');
      expect(fixed).toContain('The product sits large in the lower right of the poster');
      expect(fixed).toContain('may extend toward the right and bottom edges');
      expect(fixed).not.toContain('upper 40%');
    }
    expect(discountPromptLines(price, null, null, 'side').join('\n')).toContain('Date pill at the top of the left text column');
    expect(discountFixedLayoutLine(price, null, 'side')).toContain('The gift tag alone sits small at the bottom left');
  });
  it('side + 인앱 = 바깥 띠 · 제품도 가운데 80% · 가장자리 걸치기 0 · 프롬프트 = 왼쪽 글 · 오른쪽 아래 주제 · 지점 문장 0', () => {
    const fixed = discountFixedLayoutLine(price, INAPP_CONTENT_SAFE, 'side');
    expect(fixed).toContain('that outer 10% band on every side is background only');
    expect(fixed).not.toContain('may extend toward');
    const t = getTemplate('discount-nplus-neon')!;
    const p = buildPosterPrompt({ template: t, preset: resolvePreset('use-inapp'), hasProduct: false, texts: { title: '상품명' }, textPosition: 'bottom', offer: np });
    expect(p).toContain('The left part of the square is a natural, color-matched calm continuation');
    expect(p).toContain('Place the main subject and props in the lower right part');
    expect(p).not.toMatch(/upper third|lower third|vertical center/);
    expect(p).toContain('left-aligned');
    // stack 할인 + 인앱 = 지금(위)
    const s = buildPosterPrompt({ template: getTemplate('discount-price-cream')!, preset: resolvePreset('use-inapp'), hasProduct: false, texts: { title: '상품명' }, textPosition: 'bottom', offer: price });
    expect(s).toContain('The upper part of the square is a natural');
    expect(s).toContain('at the upper third of the frame');
  });
  it('조립 = 템플릿 배치를 CT 에 넘김(side 템플릿 · 인앱 아님)', () => {
    const p = buildPosterPrompt({ template: getTemplate('discount-set-sage')!, preset: resolvePreset('poster'), hasProduct: false, texts: { title: '상품명' }, offer: set });
    expect(p).toContain('Set composition line directly below the headline, left-aligned');
    expect(p.split('\n').pop()).toContain('one left-aligned text column inside the left 55%');
  });
});

describe('T4 화면 = 배치별 고정 표시(문구 한 곳)', () => {
  it('문구 CT · 고르기 창 · 편집기 안 스튜디오 창 · 화면 형식', () => {
    const picker = read('packages/frontend/src/components/studio/StudioUsePicker.tsx');
    expect(picker).toContain("'왼쪽에 글 · 이 템플릿은 글이 왼쪽, 제품이 오른쪽 아래로 정해져 있어요.'");
    expect(picker).toContain("'위쪽에 글 · 이 템플릿은 글이 위, 제품이 아래로 정해져 있어요.'");
    expect(picker).toContain('{discountZoneText(zoneLocked)}');
    expect(read('packages/frontend/src/pages/ImageStudioPage.tsx')).toContain("zoneLocked={make.discountKind ? (template?.layout === 'side' ? 'side' : 'stack') : null}");
    expect(read('packages/frontend/src/components/dm/build/StudioInsertModal.tsx')).toContain("{discountZoneText(template?.layout === 'side' ? 'side' : 'stack')}");
    expect(read('packages/frontend/src/components/studio/TemplatePicker.tsx')).toContain("layout?: 'stack' | 'side' | null;");
  });
});

describe('T5 예시 스크립트 = 제품 0 · 제목 카탈로그 · OpenAI 고정 · 저장 = openai 만', () => {
  const src = read('packages/backend/scripts/discount-template-samples.ts');
  it('엔진 고정 · 저장 조건 · 제품 사진 0 · 제목 칸 0 · 브랜드 0 · --only', () => {
    expect(src).toContain("const SAMPLE_ENGINE: StudioImageEngine = 'openai';");
    expect(src).toContain('const saved = SAVE && img.engine === SAMPLE_ENGINE ? saveTemplateSample(p.t.id, img) : null;');
    expect(src).toContain('await generatePoster(p.prompt, preset, null, { engine });');
    expect(src).toContain("const title = t.sample?.title || '상품명';");
    expect(src).not.toMatch(/studioImageEngine\(|groupProductCutouts|inapp-examples|cut-[a-z]+\.png|결온|소요|오후담|\btitle:\s*'/);
    expect(src).toContain("const onlyAt = args.indexOf('--only');");
    // (Codex 구현 1R ①) 값 없는 --only = 전체가 아니라 멈춤
    expect(src).toContain('if (onlyAt < 0) return null;');
    expect(src).toContain("const ids = raw && !raw.startsWith('--') ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];");
    expect(src).toContain("if (ids.length === 0) throw new Error('--only 다음에 템플릿 id 를 쉼표로 넣어 주세요(전체는 --only 를 빼고 실행)');");
  });
  it('할인 24 전부 예시 혜택 값 · 전부 검사 통과 · 세트 구성 = 상품 A · B · C', () => {
    const m = src.match(/const SAMPLE_OFFER[^=]*=\s*(\{[\s\S]*?\n\});/);
    expect(m).toBeTruthy();
    // eslint-disable-next-line no-new-func
    const offers = new Function(`return ${m![1]}`)() as Record<string, Record<string, unknown>>;
    expect(Object.keys(offers).sort()).toEqual(D.map((t) => t.id).sort());
    for (const t of D) {
      const r = readDiscountOffer(offers[t.id], t.offer);
      expect(r.ok, t.id).toBe(true);
      if (t.offer === 'set') expect((offers[t.id].items as string[]).every((x) => /^상품 [ABC]$/.test(x)), t.id).toBe(true);
    }
  });
});
