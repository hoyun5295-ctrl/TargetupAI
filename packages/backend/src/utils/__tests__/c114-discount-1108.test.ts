/**
 * ★ 2026-11-08 C114 할인 포스터 · 글자 바닥(설계서 docs/2026-11-08-c114-roadmap-v2-design.md §3 B · D · E · §5)
 *   CT-V5 할인 CT(사례 표 = 손 계산 · 회의 합의 §B) · CT-V6 할인형 길 제외(기계 추출) · CT-V7 글자 바닥 줄 · 라우트 검사 자리
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  readDiscountOffer, discountRate, wonText, discountDrawnTexts, discountCheckLine, discountPromptLines, discountFixedLayoutLine,
  discountBrandColor, DISCOUNT_MAX_WON,
} from '../studio-discount';
import { buildPosterPrompt, resolvePreset, POSTER_LEGIBILITY_FLOOR } from '../image-studio';
import { STUDIO_TEMPLATES, getTemplate, listTemplatesPublic } from '../image-studio-templates';
import { INAPP_EXAMPLES } from '../inapp-examples';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const between = (s: string, a: string, b: string) => { const i = s.indexOf(a); const j = s.indexOf(b, i + a.length); return i >= 0 && j > i ? s.slice(i, j) : ''; };

describe('CT-V5 할인율 · 금액 글(손 계산 사례 표)', () => {
  it('정수 내림 · 1 미만 = 없음 · 판매가 ≥ 할인 전 = 없음', () => {
    expect(discountRate(562000, 494000)).toBe(12);
    expect(discountRate(1000, 800)).toBe(20);
    expect(discountRate(250000, 217510)).toBe(12);
    expect(discountRate(38000, 29900)).toBe(21);
    expect(discountRate(129000, 89000)).toBe(31);
    expect(discountRate(10000, 9950)).toBeNull();
    expect(discountRate(1000, 1000)).toBeNull();
    expect(discountRate(1000, 0)).toBeNull();
  });
  it('원 = 쉼표 고정 · 만원 줄임 없음', () => {
    expect(wonText(38000)).toBe('38,000원');
    expect(wonText(1249000)).toBe('1,249,000원');
    expect(wonText(100000000)).toBe('100,000,000원');
    expect(wonText(500)).toBe('500원');
  });
});

describe('CT-V5 입력 검사(생성 · 차감 전 400 + 칸 이름)', () => {
  const bad = (raw: unknown, kind: any) => { const r = readDiscountOffer(raw, kind); return r.ok ? null : r.field; };
  it('가격 할인', () => {
    expect(readDiscountOffer({ before: 38000, sale: 29900 }, 'price')).toEqual({ ok: true, offer: { kind: 'price', before: 38000, sale: 29900, period: null, gift: null } });
    expect(bad({ before: 1000, sale: 1000 }, 'price')).toBe('sale');
    expect(bad({ before: 1000, sale: 1200 }, 'price')).toBe('sale');
    expect(bad({ before: '38000', sale: 29900 }, 'price')).toBe('before');
    expect(bad({ before: 38000.5, sale: 29900 }, 'price')).toBe('before');
    expect(bad({ before: DISCOUNT_MAX_WON + 1, sale: 1 }, 'price')).toBe('before');
    expect(bad({ before: 1000, sale: -1 }, 'price')).toBe('sale');
    expect(bad(null, 'price')).toBe('offer');
  });
  it('N+M', () => {
    expect(readDiscountOffer({ n: 2, m: 1, unit: 38000 }, 'nplus').ok).toBe(true);
    expect(bad({ n: 0, m: 1, unit: 1 }, 'nplus')).toBe('n');
    expect(bad({ n: 1, m: 10, unit: 1 }, 'nplus')).toBe('m');
    expect(bad({ n: 9, m: 9, unit: 10_000_000 }, 'nplus')).toBe('unit');
  });
  it('세트(Codex 설계 1R ④ = 양의 정수 · 합 상한 · 0 < 세트가 < 합)', () => {
    expect(readDiscountOffer({ items: ['세럼', '크림'], prices: [38000, 24000], sale: 59000 }, 'set').ok).toBe(true);
    expect(bad({ items: ['세럼'], prices: [1], sale: 1 }, 'set')).toBe('items');
    expect(bad({ items: ['a', 'b'], prices: [0, 0], sale: -1 }, 'set')).toBe('prices');
    expect(bad({ items: ['a', 'b'], prices: [1, 1], sale: 2 }, 'set')).toBe('sale');
    expect(bad({ items: ['a', 'b'], prices: [60_000_000, 60_000_000], sale: 1 }, 'set')).toBe('prices');
    expect(bad({ items: ['a', 'b'], prices: [1000], sale: 1 }, 'set')).toBe('prices');
    expect(bad({ items: ['30% 세럼', 'b'], prices: [1000, 1000], sale: 1 }, 'set')).toBe('items');
  });
  it('자유 글(기간 · 증정) = 금액 · % · N+M 꼴 400 · 날짜 · 시각 · 용량 허용 · 길이 상한', () => {
    expect(readDiscountOffer({ before: 2, sale: 1, period: '11.10 ~ 11.16', gift: '미니 50ml' }, 'price').ok).toBe(true);
    expect(bad({ before: 2, sale: 1, period: '오늘 50% 더' }, 'price')).toBe('period');
    expect(bad({ before: 2, sale: 1, gift: '1+1 쿠폰' }, 'price')).toBe('gift');
    expect(bad({ before: 2, sale: 1, gift: '5,000원 상품권' }, 'price')).toBe('gift');
    expect(bad({ before: 2, sale: 1, period: 'x'.repeat(21) }, 'price')).toBe('period');
  });
  it('템플릿 혜택 꼴 없음 = 400', () => {
    expect(bad({ before: 2, sale: 1 }, undefined)).toBe('offer');
  });
});

describe('CT-V5 그릴 글자 · 확인 줄 · 프롬프트 줄(1108 샘플과 같은 숫자)', () => {
  it('가격 할인', () => {
    const o = (readDiscountOffer({ before: 38000, sale: 29900 }, 'price') as any).offer;
    expect(discountDrawnTexts(o)).toEqual(['38,000원', '21%', '29,900원']);
    expect(discountCheckLine(o)).toBe('38,000원 → 21% 29,900원');
    expect(discountPromptLines(o).join('\n')).toContain('"38,000원" in smaller muted gray with one diagonal strike line');
  });
  it('N+M · 세트 · 기간 · 증정', () => {
    const n = (readDiscountOffer({ n: 1, m: 1, unit: 6500 }, 'nplus') as any).offer;
    expect(discountDrawnTexts(n)).toEqual(['1+1', '2개', '13,000원', '6,500원']);
    expect(discountCheckLine(n)).toBe('1+1, 2개 13,000원 → 6,500원');
    const s = (readDiscountOffer({ items: ['앰버 세럼', '케이블 니트'], prices: [38000, 129000], sale: 139000, period: '11.10 ~ 11.16', gift: '울 머플러' }, 'set') as any).offer;
    expect(discountDrawnTexts(s)).toEqual(['11.10 ~ 11.16', '앰버 세럼 + 케이블 니트', '따로 사면', '167,000원', '16%', '세트가', '139,000원', '증정', '울 머플러']);
    expect(discountCheckLine(s)).toBe('따로 사면 167,000원 → 16% 세트가 139,000원 (기간 11.10 ~ 11.16, 증정 울 머플러)');
    expect(discountCheckLine(s)).not.toContain('·');
    expect(discountFixedLayoutLine(s)).toContain('the date pill at the very top');
    expect(discountFixedLayoutLine(s)).toContain('The gift tag alone sits at the very bottom edge');
  });
  it('브랜드 강조색 = primary → accent · 6자리 hex 만', () => {
    expect(discountBrandColor({ primary_color: '#112233', accent_color: '#445566' })).toBe('#112233');
    expect(discountBrandColor({ primary_color: 'red', accent_color: '#445566' })).toBe('#445566');
    expect(discountBrandColor({ primary_color: '#123' })).toBeNull();
    expect(discountBrandColor(null)).toBeNull();
    const o = (readDiscountOffer({ before: 2, sale: 1 }, 'price') as any).offer;
    expect(discountPromptLines(o, '#112233').some((l) => l.includes('#112233'))).toBe(true);
    expect(discountPromptLines(o, 'javascript:x').some((l) => l.includes('brand color'))).toBe(false);
  });
});

describe('카탈로그 · 프롬프트', () => {
  const discount = STUDIO_TEMPLATES.filter((t) => t.kind === 'discount');
  it('할인 템플릿 24(★ C119) · 카테고리 하나 · 혜택 꼴 있음 · 공개 목록에 offer', () => {
    expect(discount.length).toBe(24);   // ★ C119 8 → 24(설계서 docs/2026-11-08-c119-discount-templates-20-design.md)
    expect(new Set(discount.map((t) => t.category))).toEqual(new Set(['할인·혜택']));
    expect(discount.every((t) => t.offer === 'price' || t.offer === 'nplus' || t.offer === 'set')).toBe(true);
    const pub = listTemplatesPublic().find((t) => t.id === 'discount-set-beige')!;
    expect(pub.offer).toBe('set');
    expect(STUDIO_TEMPLATES.filter((t) => t.kind !== 'discount').every((t) => !t.offer)).toBe(true);
  });
  it('할인 프롬프트 = 혜택 줄이 마지막 금지 줄 앞 · 고정 틀이 맨 끝 · 글자 바닥 1', () => {
    const t = getTemplate('discount-price-cream')!;
    const o = (readDiscountOffer({ before: 38000, sale: 29900 }, 'price') as any).offer;
    const p = buildPosterPrompt({ template: t, preset: resolvePreset('poster'), hasProduct: true, texts: { title: '결온 앰버 세럼' }, offer: o }).split('\n');
    const iPrice = p.findIndex((l) => l.startsWith('- Price row'));
    const iFloor = p.indexOf(POSTER_LEGIBILITY_FLOOR);
    const iLast = p.findIndex((l) => l.startsWith('Use ONLY the text given above'));
    expect(iPrice).toBeGreaterThan(-1);
    expect(iPrice).toBeLessThan(iLast);
    expect(iFloor).toBeLessThan(iLast);
    expect(p[p.length - 1].startsWith('FIXED TEMPLATE LAYOUT')).toBe(true);
    expect(p.filter((l) => l === POSTER_LEGIBILITY_FLOOR).length).toBe(1);
  });
  it('CT-V7 글자 바닥 = 글 있는 모든 포스터 1줄 · 글 없는 포스터 0 · 다른 템플릿에 혜택 · 틀 줄 0', () => {
    const t = getTemplate('beauty-clean-bright')!;
    const pre = resolvePreset('poster');
    const withText = buildPosterPrompt({ template: t, preset: pre, hasProduct: true, texts: { title: '맑게' } });
    expect(withText.split('\n').filter((l) => l === POSTER_LEGIBILITY_FLOOR).length).toBe(1);
    expect(withText).not.toContain('FIXED TEMPLATE LAYOUT');
    expect(withText).not.toContain('- Price row');
    const textless = buildPosterPrompt({ template: t, preset: pre, hasProduct: true, texts: {} });
    expect(textless).not.toContain(POSTER_LEGIBILITY_FLOOR);
  });
});

describe('CT-V6 할인형 길 제외 · 라우트 검사 자리', () => {
  it('인앱 예시 시작본 = 할인 템플릿 0', () => {
    const ids = INAPP_EXAMPLES.flatMap((e: any) => (e.slides || []).map((s: any) => s.studioTemplateId)).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(getTemplate(id)?.kind, id).not.toBe('discount');
  });
  it('AI 영업 · 한 줄 후보 풀 = kind product · event 고정(할인 0)', () => {
    const src = read('backend/src/utils/sales-outreach-produce.ts');
    expect(src).toContain("product: STUDIO_TEMPLATES.filter((t) => (t.kind ?? 'product') === 'product'");
    expect(src).toContain("event: STUDIO_TEMPLATES.filter((t) => t.kind === 'event'");
    expect(src).toContain("pool = STUDIO_TEMPLATES.filter((t) => (t.kind ?? 'product') === wantKind)");
  });
  it('예시 일괄 스크립트 = 할인 뺌 · 할인 예시 = 샘플 스크립트 --save', () => {
    const src = read('backend/scripts/studio-samples.ts');
    expect(src.match(/STUDIO_TEMPLATES\.filter\(\(t\) => t\.kind !== 'discount'\)/g)?.length).toBe(2);
    expect(read('backend/scripts/discount-template-samples.ts')).toContain('saveTemplateSample(p.t.id, img)');
  });
  it('(Codex 구현 1R ③) 할인형 = 제품명 + 템플릿 기본 라벨만(숨긴 라벨 · 부제 0) · 화면 · 서버 둘 다', () => {
    const r = read('backend/src/routes/image-studio.ts');
    expect(r).toContain("? { label: template.defaultTexts?.label || '', title: texts?.title, subtitle: '' }");
    const mk = read('frontend/src/components/studio/StudioMake.tsx');
    expect(mk).toContain("discountKind ? { label: template.defaultTexts?.label || '', title: texts.title, subtitle: '' }");
  });
  it('/generate = 할인 검사가 크레딧 확인 · 생성보다 앞 · 시도 키에 offer · 한 줄 헤드라인 = 할인 400', () => {
    const r = read('backend/src/routes/image-studio.ts');
    const gen = between(r, "imageStudioRouter.post('/generate'", 'releaseGenerateLock(companyId);');
    const iCheck = gen.indexOf('readDiscountOffer(offerRaw, template.offer)');
    expect(iCheck).toBeGreaterThan(-1);
    expect(iCheck).toBeLessThan(gen.indexOf('await checkCredit('));
    expect(iCheck).toBeLessThan(gen.indexOf('await generatePoster('));
    expect(gen).toContain('textPosition, offer: offerRaw });');
    expect(gen).toContain('discountCheck: discountOffer ? discountCheckLine(discountOffer) : null');
    expect(r).toContain("if (template.kind === 'discount') return res.status(400).json({ success: false, error: '할인 포스터는 이미지 스튜디오의");
  });
});
