/**
 * ★ 2026-10-17 한 줄 → 템플릿 캠페인 계약 테스트
 * 설계서 = docs/2026-10-17-line-template-campaign-design.md §6 (품질 증명 가)
 *
 * 렌더된 결과물(진짜 조립 + 진짜 렌더러)을 본다: 자리표시 0 · 같은 사진 0 · 장마다 버튼 ≤ 1 · 슬라이드 모든 장 채움/가운데 ·
 * 이메일 = 렌더러가 아는 섹션 · 인앱 = SDK 가 아는 블록 · 숫자 = 근거 글에서만 · 단계 판정 · 요청 검증 · 화면 몸통 짝 · 라우트 순서.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { LINE_TEMPLATES, getLineTemplate, validateLineTemplate, rankLineTemplates, type LineTemplate, type LineChannel } from '../design-core/line-templates';
import { composeLineDm, composeLineEmail, composeLineInapp, lineTemplateGate, planProductPages, dedupeLinePhotos, type LineMaterials, type LineCard } from '../line-template-compose';
import { sanitizeLineCopy, lineExampleCopy, lineCopyGroundText } from '../line-template-copy';
import { lineExampleMaterials, renderLineTemplateExample } from '../line-template-example';
import { buildLineTemplatePlan } from '../line-template-plan';
import { lineMaterialFromPage, lineBannerOf } from '../line-template-page';
import { lineTemplateMaterials } from '../line-template-run';
import { sanitizeLineStepsBody, LINE_STEPS_MAX, type LineStepsPlanInput } from '../one-line-steps';
import { lineBenefitPrefill } from '../one-line-facts';
import { lineEndDatePrefill } from '../one-line-steps';
import { renderDmViewerHtml } from '../dm/dm-viewer';
import { renderEmailSections } from '../email/email-section-renderer';
import { isEmailRenderable } from '../email/email-blocks';
import { INAPP_TEMPLATE_ALLOWED_BLOCKS } from '../inapp-message';
import type { PageReadResult } from '../brand-page-reader';

const NOW = Date.parse('2026-10-17T03:00:00Z');   // KST 2026-10-17 12:00 (토)
let seq = 0;
const newId = () => `id${++seq}`;
const PH = /추가해주세요|직접 작성|직접 입력|입력해주세요|\[URL|자세히 보기|dm-mood-slot/;
/** 본문만(뷰어 기본 CSS · 참여 스크립트의 안내 문장은 결과물 글이 아니다) */
const content = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
const imgs = (html: string) => Array.from(html.matchAll(/<img[^>]+src="([^"]+)"/g)).map((m) => m[1].split('?')[0]);

/** 상품 n개(사진 · 가격 · 링크 다름) */
const cards = (n: number): LineCard[] => Array.from({ length: n }, (_, i) => ({ name: `상품 ${String.fromCharCode(65 + i)}`, price: 10000 + i * 1000, image_url: `/api/dm/v/images/c/p${i}.jpg`, link_url: `https://shop.example/p${i}` }));

/** 재료 상황 — 풍부(예시) · 상품 1 · 사진 0 · 상품 n */
function situation(t: LineTemplate, kind: 'rich' | 'one' | 'nophoto' | number): LineMaterials {
  const m = lineExampleMaterials(t, NOW);
  if (kind === 'rich') return m;
  if (kind === 'one') return { ...m, products: cards(1) };
  if (kind === 'nophoto') return { ...m, hero: null, products: cards(2) };
  return { ...m, hero: null, products: cards(kind) };
}

function renderDm(t: LineTemplate, layout: 'slides' | 'page', m: LineMaterials) {
  const r = composeLineDm(t, layout, m, lineExampleCopy(t), newId);
  const html = renderDmViewerHtml({ title: 't', store_name: m.brandName, layout_mode: r.layoutMode, pages: r.pages, sections: r.sections, brand_kit: { primary_color: t.design.primary, accent_color: t.design.accent }, short_code: '' } as any, '');
  return { r, html };
}

describe('템플릿 원장 — 등록 관문 · 추천 · 스위치', () => {
  it('네 템플릿 모두 관문 통과(기본 문구 숫자 0 · 상한 · 필수 ≤ 3 · 기승전결 4줄)', () => {
    for (const t of LINE_TEMPLATES) expect(validateLineTemplate(t), t.id).toEqual([]);
  });
  it('예시 사진 파일이 저장소에 있다(가상 업체 예시 = 이미 커밋된 정물 사진)', () => {
    const pub = resolve(__dirname, '../../../../frontend/public');
    for (const t of LINE_TEMPLATES) for (const u of [t.example.hero, ...t.example.products.map((p) => p.image_url)].filter(Boolean) as string[]) {
      expect(existsSync(resolve(pub, `.${u}`)), u).toBe(true);
    }
  });
  it('추천 = 빅세일 > 신상품 > 특별 이벤트 > 계절 · 걸린 낱말이 이유 · 안 걸리면 배지 없음', () => {
    const r = rankLineTemplates('가을 신상 니트 30% 세일');
    expect(r.find((x) => x.recommended)?.id).toBe('big-sale');
    expect(r.find((x) => x.id === 'big-sale')!.reasons).toEqual(expect.arrayContaining(['세일']));
    expect(rankLineTemplates('가을 메뉴 소개').find((x) => x.recommended)?.id).toBe('season');
    expect(rankLineTemplates('매장 안내').some((x) => x.recommended)).toBe(false);
  });
});

describe('렌더된 결과 — 4 템플릿 × 배치 × 재료 상황', () => {
  const kinds: Array<'rich' | 'one' | 'nophoto' | number> = ['rich', 'one', 'nophoto', 0, 2, 3, 4, 5, 8];
  for (const t of LINE_TEMPLATES) {
    for (const kind of kinds) {
      it(`${t.id} · ${kind} · DM 슬라이드 = 장마다 채움/가운데 · 버튼 ≤ 1 · 자리표시 0 · 같은 사진 0 · 한 섹션 상품 ≤ 3`, () => {
        const { r, html } = renderDm(t, 'slides', situation(t, kind));
        expect(lineTemplateGate(r.sections)).toEqual([]);
        expect(content(html)).not.toMatch(PH);
        const pics = imgs(html);
        expect(new Set(pics).size).toBe(pics.length);
        const pages = html.split('<section class="dm-page').slice(1);
        expect(pages.length).toBe(r.layout === 'slides' ? r.pages.length : 1);
        if (r.layout === 'slides') {
          expect(r.pages.length).toBeGreaterThanOrEqual(3);
          for (const pg of pages) {
            expect(pg).toMatch(/^ dm-page--fill/);
            expect((pg.match(/class="dm-section dm-cta-section"/g) || []).length).toBeLessThanOrEqual(1);
          }
        }
        for (const s of r.sections) if (s.type === 'product_carousel') expect(((s.props as any).products as unknown[]).length).toBeLessThanOrEqual(3);
      });
      it(`${t.id} · ${kind} · DM 한 페이지 · 이메일 · 인앱`, () => {
        const m = situation(t, kind);
        const page = renderDm(t, 'page', m);
        expect(page.r.layoutMode).toBe('scroll');
        expect(page.html).not.toMatch(/dm-page--fill/);   // 한 페이지형 = 장 채움 CSS 0(표식은 남아도 출력 무변화)
        expect(content(page.html)).not.toMatch(PH);
        const em = composeLineEmail(t, m, lineExampleCopy(t), newId);
        expect(lineTemplateGate(em.sections)).toEqual([]);
        for (const s of em.sections) expect(isEmailRenderable(s.type), s.type).toBe(true);
        expect(em.sections.every((s) => s.tpl_slot === undefined && (s as any).fit === undefined)).toBe(true);
        const emHtml = renderEmailSections(em.sections, { brandKit: { primary_color: t.design.primary } as any, storeName: m.brandName });
        expect(content(emHtml)).not.toMatch(PH);
        const ia = composeLineInapp(t, m, lineExampleCopy(t));
        const allowed = INAPP_TEMPLATE_ALLOWED_BLOCKS[ia.template];
        for (const b of ia.content_blocks) expect(allowed.has(String(b.type)), String(b.type)).toBe(true);
        expect(ia.content_blocks.filter((b) => b.type === 'product').length).toBeLessThanOrEqual(1);
        expect(ia.title && ia.body && ia.buttons.length === 1).toBeTruthy();
      });
    }
  }
  it('받은 상품은 채널 상한까지 모두(카드 + 글 합계) · 인앱 사진 없는 상품 = 목록 블록(Codex 1R)', () => {
    const t = getLineTemplate('big-sale')!;
    const text8 = Array.from({ length: 8 }, (_, i) => ({ name: `글상품${i + 1}`, price: 1000 * (i + 1) }));
    const m = { ...lineExampleMaterials(t, NOW), hero: null, products: [], textProducts: text8 };
    const { html } = renderDm(t, 'slides', m);
    for (let i = 1; i <= 8; i++) expect(content(html)).toContain(`글상품${i}`);
    const em = renderEmailSections(composeLineEmail(t, m, lineExampleCopy(t), newId).sections, { brandKit: {} as any, storeName: 'x' });
    expect(content(em)).toContain('글상품6');
    expect(content(em)).not.toContain('글상품7');
    const ia = composeLineInapp(t, { ...m, textProducts: text8.slice(0, 2) }, lineExampleCopy(t));
    expect(ia.content_blocks.find((b) => b.type === 'bullets')).toMatchObject({ items: [{ text: '글상품1 1,000원' }] });
    const iaCard = composeLineInapp(t, { ...m, products: cards(1), textProducts: text8.slice(0, 2) }, lineExampleCopy(t));
    expect(iaCard.content_blocks.some((b) => b.type === 'bullets')).toBe(false);
  });
  it('상품 장 나누기 — DM 2개 = 큰 카드 둘 · 5~8 = 두 장 · 한 섹션 ≤ 2(3 = focus) · 이메일 2 = 두 칸', () => {
    expect(planProductPages(2, 'dm')).toEqual([[1, 1]]);
    expect(planProductPages(2, 'email')).toEqual([[2]]);
    expect(planProductPages(4, 'dm')).toEqual([[2, 2]]);
    expect(planProductPages(6, 'dm')).toEqual([[2, 2], [1, 1]]);
    expect(planProductPages(8, 'dm')).toEqual([[2, 2], [2, 2]]);
    for (let n = 1; n <= 8; n++) for (const pg of planProductPages(n, 'dm')) for (const k of pg) expect(k).toBeLessThanOrEqual(3);
  });
  it('같은 사진은 한 번만(원래 주소 기준) · 대표 사진과 같은 상품 사진이면 상품 쪽을 뺀다', () => {
    const m = lineExampleMaterials(getLineTemplate('new-launch')!, NOW);
    const dup = dedupeLinePhotos({ ...m, hero: { url: '/x.jpg' }, products: [{ ...cards(1)[0], image_url: '/x.jpg' }, cards(2)[1]] });
    expect(dup.products.map((p) => p.image_url)).not.toContain('/x.jpg');
  });
  it('예시 렌더(라우트가 쓰는 함수) = DM html · 이메일 html · 인앱 메시지', () => {
    for (const t of LINE_TEMPLATES) {
      expect(renderLineTemplateExample(t, 'dm', 'slides', NOW)).toHaveProperty('html');
      expect(renderLineTemplateExample(t, 'email', 'page', NOW)).toHaveProperty('html');
      expect(renderLineTemplateExample(t, 'inapp', 'page', NOW)).toHaveProperty('message');
    }
  });
});

describe('문구 — 숫자 · 혜택은 근거 글에서만', () => {
  const t = getLineTemplate('big-sale')!;
  const ground = lineCopyGroundText({ line: '니트 30% 세일 이번 주말까지', benefit: '전 상품 30%', periodLabel: null, brandName: '소목', productNames: ['울 니트'], pageText: null });
  it('지어낸 숫자 · 혜택 = 그 칸만 기본 문구 · 줄표 · 따옴표 정리 · 상한 자르기', () => {
    const { copy, replaced } = sanitizeLineCopy(t, { cover_headline: '최대 50% 할인', cover_sub: '“지금”—바로 만나 보세요', story_headline: '무료 배송까지', cta_label: 'x'.repeat(40) }, ground);
    expect(replaced).toEqual(expect.arrayContaining(['cover_headline', 'story_headline']));
    expect(copy.cover_headline).toBe(t.copy.find((f) => f.key === 'cover_headline')!.fallback);
    expect(copy.cover_sub).not.toMatch(/[—“”]/);
    expect(copy.cta_label.length).toBeLessThanOrEqual(t.copy.find((f) => f.key === 'cta_label')!.max);
  });
  it('근거 글에 있는 숫자는 그대로 둔다', () => {
    const { copy, replaced } = sanitizeLineCopy(t, { cover_headline: '시즌오프 30% 세일' }, ground);
    expect(copy.cover_headline).toBe('시즌오프 30% 세일');
    expect(replaced).not.toContain('cover_headline');
  });
  it('혜택 미리 채움 = 한 줄에 혜택 값이 하나 · 부정 · 조건이 어디에도 없을 때만(Codex 1R high · 2R · 3R) · 연속된 원래 글자', () => {
    expect(lineBenefitPrefill('니트 코트 시즌오프 최대 30% 할인 이번주까지')).toBe('최대 30% 할인');
    expect(lineBenefitPrefill('구매 고객 전원 텀블러 증정')).toBe('텀블러 증정');
    expect(lineBenefitPrefill('최대 추가 10% 할인 이벤트')).toBe('최대 추가 10% 할인');
    expect(lineBenefitPrefill('가을 맞이 3천원 쿠폰')).toBe('3천원 쿠폰');
    expect(lineBenefitPrefill('1+1 행사')).toBe('1+1');
    // 모호 = 비운다(사람이 적는다 · 허용 꼴 밖 · 둘 이상 · 부정 · 좁히는 말 · 수식어가 떨어져 있음)
    for (const line of ['첫 구매 5천원 쿠폰 드려요', '이번 세일은 무료배송 제외, 10% 할인', '5만원 이상 구매 시 무료배송', '무료배송 제외', '무료배송 없음, 10% 할인',
      '선착순 100명 20% 할인', '선착순 10명, 20% 할인', '무료배송, 제주 지역 제외', '10% 할인 그리고 무료배송', 'VIP 고객만 20% 할인',
      '최대로 드리는 30% 할인', '사은품 드려요', '텀블러 구매하면 머그컵 증정', '20% 할인 종료 안내']) expect(lineBenefitPrefill(line), line).toBeNull();
    expect(lineBenefitPrefill('1.5만원 할인')).toBe('1.5만원 할인');   // 금액 중간부터 맞추지 않는다(5R)
    expect(lineBenefitPrefill('1만5천원 할인')).toBe('1만5천원 할인');   // 복합 금액 전체(6R)
    expect(lineBenefitPrefill('15,000원 쿠폰')).toBe('15,000원 쿠폰');
    expect(lineBenefitPrefill('1만 5,000원 쿠폰')).toBeNull();   // 공백 낀 복합 금액 = 뒷부분만 맞추지 않는다(7R)
    expect(lineBenefitPrefill('1천 500원 할인')).toBeNull();
    expect(lineBenefitPrefill('가을 맞이 3천원 쿠폰')).toBe('3천원 쿠폰');
    expect(lineBenefitPrefill('신상 앰플 출시')).toBeNull();
    for (const line of ['니트 코트 시즌오프 최대 30% 할인', '1+1 행사', '무료 배송 이벤트']) {
      const p = lineBenefitPrefill(line);
      expect(p && line.includes(p)).toBeTruthy();
    }
  });
  it('마감 날짜 미리 채움 = 한 줄의 날짜(기간의 끝) · 금액을 날짜로 읽지 않음 · 지난 날 = 없음(연말에 적은 1~3월만 내년)', () => {
    expect(lineEndDatePrefill('10월 31일까지 10% 할인', NOW)).toBe('2026-10-31');
    expect(lineEndDatePrefill('10월 31일(토)까지 세일', NOW)).toBe('2026-10-31');
    expect(lineEndDatePrefill('10월 20일부터 소진 시까지 세일', NOW)).toBeNull();   // 시작일 = 마감이 아니다(4R)
    expect(lineEndDatePrefill('10월 20일~31일까지 세일', NOW)).toBeNull();
    expect(lineEndDatePrefill('10월 31일 오픈', NOW)).toBeNull();   // 끝이라는 표지가 없다
    expect(lineEndDatePrefill('행사는 상시 진행하며 상품은 10월 31일까지 배송됩니다', NOW)).toBeNull();   // 행사 끝이 아닌 기한(5R)
    expect(lineEndDatePrefill('내년 10월 31일까지 행사 진행', NOW)).toBeNull();
    expect(lineEndDatePrefill('27년 10월 31일까지 행사 진행', NOW)).toBeNull();
    expect(lineEndDatePrefill('2027년도 10월 31일까지 할인 행사', NOW)).toBeNull();   // 읽지 못한 연도 = 제안 없음(6R)
    expect(lineEndDatePrefill('세일 ~10/24', NOW)).toBeNull();   // 숫자만 있는 꼴 = 모호 = 채우지 않음
    expect(lineEndDatePrefill('10.20~10.31 시즌오프', NOW)).toBeNull();
    expect(lineEndDatePrefill('티셔츠 1~1.5만원 특가', NOW)).toBeNull();
    expect(lineEndDatePrefill('2026.11.02까지', NOW)).toBe('2026-11-02');
    expect(lineEndDatePrefill('2027년 11월 1일까지 10% 할인', NOW)).toBe('2027-11-01');   // 연도 보존(겹치는 「11월 1일」을 다시 읽지 않음)
    expect(lineEndDatePrefill('10월 20일부터 10월 31일까지', NOW)).toBeNull();   // 날짜 둘 = 모호
    expect(lineEndDatePrefill('세일 2026.10.20~10.31까지', NOW)).toBeNull();   // 끝을 못 읽으면 시작일로 대신하지 않는다
    expect(lineEndDatePrefill('10월 31일까지 1~1.5만원 특가', NOW)).toBeNull();
    expect(lineEndDatePrefill('1.5만원 할인', NOW)).toBeNull();
    expect(lineEndDatePrefill('1월 5일까지', NOW)).toBe('2027-01-05');
    expect(lineEndDatePrefill('10월 1일까지', NOW)).toBeNull();
    expect(lineEndDatePrefill('이번 주말까지', NOW)).toBeNull();
  });
});

describe('재료 확정 — 답 · 한 줄 · 페이지 순서', () => {
  const t = getLineTemplate('special-event')!;
  const base = {
    template: t, channel: 'dm' as LineChannel, companyId: 'c', line: '회원의 날 텀블러 증정', brandName: '하루곳간', logoUrl: null, csPhone: null,
    pinnedPrimary: null, cards: [], textProducts: [], heroUpload: null, page: null, benefitAnswer: undefined, periodEnd: null, link: null,
  };
  it('혜택 = 확인한 답만(한 줄에서 다시 뽑지 않는다) · 대표 사진 = 올린 사진 → 페이지 표지 → 없음(상품 사진 대체 0) · 회사 주색이 템플릿 주색을 바꾼다', () => {
    expect(lineTemplateMaterials(base).materials.benefit).toBeNull();
    expect(lineTemplateMaterials({ ...base, benefitAnswer: '전원 사은품' }).materials.benefit).toBe('전원 사은품');
    const page = { url: 'https://a.co/e', banner: '/api/cdp/inapp/image/c/b.jpg', licensedText: null };
    expect(lineTemplateMaterials({ ...base, page }).materials.hero?.url).toBe(page.banner);
    expect(lineTemplateMaterials({ ...base, page, heroUpload: '/api/dm/v/images/c/h.jpg' }).materials.hero?.url).toBe('/api/dm/v/images/c/h.jpg');
    expect(lineTemplateMaterials({ ...base, cards: [{ name: 'p', price: 1000, image_url: '/p.jpg' }] }).materials.hero).toBeNull();
    expect(lineTemplateMaterials({ ...base, pinnedPrimary: '#123456' }).t.design.primary).toBe('#123456');
    expect(lineTemplateMaterials({ ...base, cards: [{ name: 'p', price: 0, image_url: '/p.jpg' }] }).materials.products[0].price).toBeNull();
  });
});

describe('이벤트 페이지 — 다시 읽은 결과와 지문 대조', () => {
  const r = {
    readId: 'r', finalUrl: 'https://a.co/e', host: 'a.co', logoUrl: null, brandColor: null, products: [], rendered: false, mallDomain: false, cached: true,
    cards: [
      { id: 'read1', title: '가을 세일 20%', text: '기간 10.20까지', periodRaw: null, imageUrl: '/api/cdp/inapp/image/c/s.jpg', imageWidth: 500, imageHeight: 500, link: 'https://a.co/e', hash: 'aaaaaaaaaaaaaaaa' },
      { id: 'read2', title: '회원 쿠폰', text: '', periodRaw: null, imageUrl: '/api/cdp/inapp/image/c/w.jpg', imageWidth: 1200, imageHeight: 800, link: 'https://a.co/e', hash: 'bbbbbbbbbbbbbbbb' },
    ],
    images: [{ url: '/api/cdp/inapp/image/c/tall.jpg', width: 800, height: 1600 }],
  } as PageReadResult;
  it('표지 = 폭 600 이상 · 가로/세로 0.8 이상(작은 카드 사진 · 세로로 긴 사진 제외)', () => {
    expect(lineBannerOf(r)).toBe('/api/cdp/inapp/image/c/w.jpg');
    expect(lineBannerOf({ cards: [], images: r.images })).toBeNull();
  });
  it('그대로 쓰기 켠 카드가 없으면 PAGE_CHANGED · 있으면 그 문구만 근거 글로', () => {
    expect(lineMaterialFromPage(r, 'https://a.co/e', ['cccccccccccccccc'])).toMatchObject({ status: 409, code: 'PAGE_CHANGED' });
    expect(lineMaterialFromPage(r, 'https://a.co/e', ['aaaaaaaaaaaaaaaa'])).toMatchObject({ url: 'https://a.co/e', licensedText: '가을 세일 20%\n기간 10.20까지' });
    expect(lineMaterialFromPage(r, 'https://a.co/e', [])).toMatchObject({ licensedText: null });
  });
});

describe('재료 단계 판정 — 템플릿이 묻는 것만 · 필수는 미루지 않는다', () => {
  const input = (line: string, over: Partial<LineStepsPlanInput> = {}): LineStepsPlanInput => ({
    judged: line, line, typed: line, channel: 'dm', mall: true, inappBlocked: false, upload: true,
    website: null, mallHome: null, cost: { generate: 5, complete: 10, total: 15 }, lineFp: 'abcdefabcdef', ...over,
  });
  const keysOf = (t: string, line: string, over: Partial<LineStepsPlanInput> = {}) => buildLineTemplatePlan(getLineTemplate(t)!, input(line, over)).steps.map((s) => s.key);
  it('빅세일 · 혜택 숫자 없음 = 혜택(필수) · 기간(필수) · ★1021 상한 없음(미루는 단계 0) · 첫 화면 = 맨 끝', () => {
    const p = buildLineTemplatePlan(getLineTemplate('big-sale')!, input('니트 세일 해요'));
    expect(p.steps.filter((s) => s.required).map((s) => s.key)).toEqual(expect.arrayContaining(['benefit', 'period']));
    expect(p.later).toEqual([]);
    expect(p.steps[p.steps.length - 1].key).toBe('hero_photo');
  });
  it('혜택 · 마감(표지 · 띠에 크게 실리는 값) = 늘 확인 단계 · 한 줄 값은 미리 채움 · 한 줄 주소 = 이벤트 페이지 미리 채움 + 버튼 주소', () => {
    const q = buildLineTemplatePlan(getLineTemplate('big-sale')!, input('니트 30% 세일 10월 31일까지'), NOW);
    expect(q.steps.find((s) => s.key === 'benefit')).toMatchObject({ required: true, suggest: '30% 세일' });
    expect(q.steps.find((s) => s.key === 'period')).toMatchObject({ required: true, suggest: '2026-10-31' });
    expect(buildLineTemplatePlan(getLineTemplate('big-sale')!, input('니트 30% 세일 이번 주말까지'), NOW).steps.find((s) => s.key === 'period')!.suggest).toBeUndefined();
    expect(keysOf('new-launch', '앰플 출시')).not.toContain('benefit');
    expect(buildLineTemplatePlan(getLineTemplate('new-launch')!, input('앰플 출시 10% 할인')).steps.find((s) => s.key === 'benefit')).toMatchObject({ suggest: '10% 할인' });
    const p = buildLineTemplatePlan(getLineTemplate('big-sale')!, input('세일 https://a.co/e 30%'));
    expect(p.steps.find((s) => s.key === 'event_page')?.url).toBe('https://a.co/e');
    expect(p.filled.link).toBe('https://a.co/e');
  });
  it('상품 = 한 단계 · 낱말 탭 · 채널 상한 · 신상품 = 필수 · 인앱 = 1개 · 기간은 인앱에서 묻지 않는다', () => {
    const p = buildLineTemplatePlan(getLineTemplate('new-launch')!, input('니트랑 코트 신상 출시'));
    const s = p.steps.find((x) => x.key === 'products')!;
    expect(s).toMatchObject({ required: true, min: 1, max: 8 });
    expect(s.terms!.map((t) => t.item)).toEqual(['니트', '코트']);
    expect(buildLineTemplatePlan(getLineTemplate('new-launch')!, input('니트 출시', { channel: 'inapp' })).steps.find((x) => x.key === 'products')!.max).toBe(1);
    expect(keysOf('big-sale', '니트 세일', { channel: 'inapp' })).not.toContain('period');
  });
  it('계절 = 혜택을 묻지 않는다 · ★1021 첫 화면 = 모든 템플릿(페이지 표지가 있어도 헤드라인을 고른다) · 인앱 표시 불가 = 막음', () => {
    expect(keysOf('season', '가을 메뉴 소개')).not.toContain('benefit');
    for (const id of ['big-sale', 'new-launch', 'special-event', 'season']) expect(keysOf(id, '가을 메뉴')).toContain('hero_photo');
    expect(buildLineTemplatePlan(getLineTemplate('season')!, input('가을 메뉴')).steps.find((s) => s.key === 'hero_photo')?.skip_if).toBeUndefined();
    expect(buildLineTemplatePlan(getLineTemplate('season')!, input('가을 메뉴', { channel: 'inapp', inappBlocked: true })).block).toBe('INAPP_DISPLAY_UNAVAILABLE');
  });
});

describe('요청 검증 — 템플릿 · 페이지 칸', () => {
  const body = (over: Record<string, unknown>) => ({ steps: { v: 1 }, facts: {}, manual_products: [], expected_cost: 15, ...over });
  it('템플릿 · 배치 · 페이지(주소 + 지문 ≤ 3)를 받는다 · 템플릿이면 직접 상품 8개까지', () => {
    const ok = sanitizeLineStepsBody(body({ template: { id: 'big-sale', layout: 'slides' }, page: { url: 'https://a.co/e', licensed_hashes: ['aaaaaaaaaaaaaaaa'] }, manual_products: Array.from({ length: 8 }, (_, i) => ({ name: `p${i}` })) }), NOW);
    expect(ok).toMatchObject({ template: { id: 'big-sale', layout: 'slides' }, page: { url: 'https://a.co/e', licensedHashes: ['aaaaaaaaaaaaaaaa'] } });
    expect(sanitizeLineStepsBody(body({}), NOW)).toMatchObject({ template: null, page: null });
  });
  it('모르는 템플릿 · 배치 · 템플릿 없는 페이지 · 지문 형식 · 템플릿 없이 직접 상품 4개 = invalid', () => {
    expect(sanitizeLineStepsBody(body({ template: { id: 'x', layout: 'slides' } }), NOW)).toBe('invalid');
    expect(sanitizeLineStepsBody(body({ template: { id: 'season', layout: 'grid' } }), NOW)).toBe('invalid');
    expect(sanitizeLineStepsBody(body({ page: { url: 'https://a.co', licensed_hashes: [] } }), NOW)).toBe('invalid');
    expect(sanitizeLineStepsBody(body({ template: { id: 'season', layout: 'page' }, page: { url: 'https://a.co', licensed_hashes: ['zz'] } }), NOW)).toBe('invalid');
    expect(sanitizeLineStepsBody(body({ manual_products: Array.from({ length: 4 }, (_, i) => ({ name: `p${i}` })) }), NOW)).toBe('invalid');
  });
});

describe('화면 ↔ 서버 짝 — 화면이 만든 템플릿 몸통을 서버가 그대로 받는다 · 배치 전환 = 장 키', () => {
  it('buildLineTemplateBody → sanitizeLineStepsBody 통과 · 몰 + 직접 합쳐 상한까지', async () => {
    const fe = await import('../../../../frontend/src/utils/one-line');
    const plan = buildLineTemplatePlan(getLineTemplate('big-sale')!, {
      judged: '니트 세일', line: '니트 세일', typed: '니트 세일', channel: 'inapp', mall: true, inappBlocked: false, upload: true,
      website: null, mallHome: null, cost: { generate: 5, complete: 10, total: 15 }, lineFp: 'abcdefabcdef',
    });
    const cand = { provider: 'cafe24', no: '12', name: '울 니트', price: 39000, salePrice: 29000, imageUrl: '/i.jpg', exact: false };
    const a = { ...fe.emptyLineStepsAnswers(), benefit: '전 상품 30%', picks: [cand], manualList: [{ name: '코트', price: '99,000', image: null }], page: { url: 'https://a.co/e', host: 'a.co', banner: null, cards: [{ hash: 'aaaaaaaaaaaaaaaa', title: 't', text: '' }], licensed: ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb'] } };
    const b = fe.buildLineTemplateBody(plan as any, a, plan.steps as any, 15, { id: 'big-sale', layout: 'page' });
    expect(b).toMatchObject({ template: { id: 'big-sale', layout: 'page' }, products: [{ provider: 'cafe24', no: '12' }], manual_products: [] });
    if (plan.steps.some((s) => s.key === 'event_page')) expect((b as any).page.licensed_hashes).toEqual(['aaaaaaaaaaaaaaaa']);
    expect(sanitizeLineStepsBody(b, NOW)).not.toBe('invalid');
  });
  it('장 키로 다시 묶기 — 키 없는 섹션은 앞 섹션의 장 · 키가 없으면 null · 서버 조립의 장과 같다', async () => {
    const fe = await import('../../../../frontend/src/utils/one-line');
    const t = getLineTemplate('big-sale')!;
    const r = composeLineDm(t, 'slides', lineExampleMaterials(t, NOW), lineExampleCopy(t), newId);
    const flat = r.sections.slice();
    flat.splice(2, 0, { id: 'user', type: 'text_card', order: 0, visible: true, props: {} } as any);
    const groups = fe.regroupLineTemplatePages(flat)!;
    expect(groups.length).toBe(r.pages.length);
    expect(groups.map((g) => g.filter((s) => s.id !== 'user').map((s) => s.id))).toEqual(r.pages.map((p) => p.sections.map((s) => s.id)));
    expect(groups[0].some((s) => s.id === 'user')).toBe(true);
    expect(fe.regroupLineTemplatePages([{ id: 'a' } as any])).toBeNull();
    expect(fe.isLineTemplateDm('line:big-sale')).toBe(true);
    expect(fe.isLineTemplateDm('catalog')).toBe(false);
  });
});

describe('라우트 소스 계약 — 템플릿 분기도 같은 돈 순서', () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
  const at = (src: string, needle: string) => { const i = src.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i; };
  it('DM — 금액 확정 → 페이지 다시 읽기 → 생성(템플릿 | 범용) → 초안 표식 → 차감(★ 2026-10-21 스위치 삭제)', () => {
    const src = read('../../routes/dm.ts');
    expect(src).not.toContain('lineTemplatesEnabled');
    const settle = at(src, "await settleLineStepsPrice(steps, companyId, 'dm', stepsNow)");
    const page = at(src, 'const pg = await resolveLinePage(companyId, steps.body.page);');
    const gen = at(src, 'const r = tplDef ? await generateTemplateDm() : await oneShotGenerate({');
    const marker = at(src, '...(tplDef ? { template_id: lineTemplateDmMarker(tplDef.id) } : {}),');
    const deduct = at(src, 'outcome = await deductCreditOutcome({ companyId, cost: genCost, source: genSource');
    for (const [a, b] of [[settle, page], [page, gen], [gen, marker], [marker, deduct]]) expect(a).toBeLessThan(b);
    expect(src).toContain('...(tplSel ? { template: tplSel, page: steps.body.page } : {})');
  });
  it('이메일 — 금액 확정 → 템플릿 한 벌(페이지 다시 읽기 → 생성(묶음 안) → 차감 → 낸 것만) → 그 뒤가 범용 경로(바이트 그대로)', () => {
    const src = read('../../routes/email.ts');
    const settle = at(src, "await settleLineStepsPrice(steps, auth.companyId, 'email', stepsNow)");
    const branch = at(src, 'if (tplDef && steps && stepsCharge) {');
    const page = at(src, 'const pg = await resolveLinePage(auth.companyId, steps.body.page);');
    const gen = at(src, 'const draft = await runInCreditBundle(() => draftLineTemplate({');
    const deduct = at(src, 'const tplOutcome = await deductCreditOutcome({ companyId: auth.companyId, cost: tplCost, source: stepsCharge.source');
    const collected = at(src, 'if (!lineStepsCollected(tplOutcome)) {');
    const generic = at(src, 'const result = await generateEmailSections({ companyId: auth.companyId, userId: auth.userId, prompt: genPrompt, scenario, isAd, eventText });');
    for (const [a, b] of [[settle, branch], [branch, page], [page, gen], [gen, deduct], [deduct, collected], [collected, generic]]) expect(a).toBeLessThan(b);
  });
  it('인앱 — 페이지 다시 읽기 → 템플릿 생성(묶음 안) · 1017 끼우기는 범용 쪽만 → 차감', () => {
    const src = read('../../routes/cdp.ts');
    const page = at(src, 'const pg = await resolveLinePage(auth.companyId, steps.body.page);');
    const gen = at(src, "const draft = await runInCreditBundle(() => draftLineTemplate({");
    const deduct = at(src, 'const outcome = await deductCreditOutcome({ companyId: auth.companyId, cost: price.cost, source: price.source');
    expect(page).toBeLessThan(gen);
    expect(gen).toBeLessThan(deduct);
    expect(src).not.toContain('lineTemplatesEnabled');
  });
  it('판정 · 목록 · 예시 · 페이지 읽기 = 전 회사(★ 2026-10-21 스위치 삭제)', () => {
    expect(read('../../routes/ai.ts')).toContain('templatesEnabled = true;');
    expect(read('../../routes/line-templates.ts')).toContain('const isOpen = (companyId: string | undefined) => !!companyId;');
    expect(read('../../routes/event-campaigns.ts')).not.toContain('lineTemplatesEnabled');
    expect(read('../../app.ts')).toContain("app.use('/api/line-templates', lineTemplatesRouter);");
  });
});
