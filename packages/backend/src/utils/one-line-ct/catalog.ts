/**
 * one-line-ct/catalog.ts — 구성 5종 고르기 목록 · 예시(가상 업체 · 진짜 조립 + 진짜 렌더러 · ★ 2026-10-22)
 *   마케팅플래너 · 고르기 화면이 옛 템플릿 목록과 같은 모양으로 받는다(설계서 docs/2026-10-22-oneline-ct-design.md §5 · C4).
 *   순수 · AI 0 · DB 0 · 날짜만 nowMs(마감 예시).
 */
import { randomUUID } from 'crypto';
import { renderDmViewerHtml } from '../dm/dm-viewer';
import { renderEmailSections } from '../email/email-section-renderer';
import type { DmBrandKit } from '../dm/dm-tokens';
import { formatLinePeriodEnd } from '../one-line-steps';
import { kstDatePlus } from '../line-template-example';
import {
  LINE_COMPOSITIONS, composeRichDm, composeRichEmail, composeRichInapp, compositionFallbackCopy, compositionChannelSlots,
  type LineComposition, type LineRichMaterials,
} from '../line-compositions';
import type { LineInAppMessage } from '../line-template-compose';

const A = '/diagnosis-examples/assets';

/** 고르기 목록 한 줄(옛 템플릿 목록과 같은 모양 · 화면 부품을 그대로 쓴다) */
export function compositionCatalog(): Array<{
  id: string; label: string; desc: string;
  story: Array<{ role: string; text: string }>;
  needs: { benefit: 'required' | 'optional' | 'none'; period: 'required' | 'none'; products: { min: number; max: { dm: number; email: number; inapp: number } }; hero: 'ask' | 'none' };
  example: { company: string; industry: string; line: string };
  design: { primary: string; accent: string };
}> {
  return LINE_COMPOSITIONS.map((c) => {
    // ★ 1024 필요 칸 = 채널 칸 규칙 한 곳(옛: 이메일 상품 6 · 인앱 1 을 여기서 따로 셌다 · 한 줄 CT 구조체크 ⑦)
    const dmSlots = compositionChannelSlots(c, 'dm');
    const slot = (k: string) => dmSlots.find((s) => s.key === k);
    const prodMax = (ch: 'dm' | 'email' | 'inapp') => compositionChannelSlots(c, ch).find((s) => s.key === 'products')?.max ?? 0;
    const prod = slot('products');
    const ben = slot('benefit');
    const ex = EXAMPLES[c.id];
    return {
      id: c.id, label: c.label, desc: c.desc,
      story: c.slots.slice(0, 4).map((s, i) => ({ role: ['기', '승', '전', '결'][i], text: s.ask })),
      needs: {
        benefit: ben ? (ben.level === 'block' ? 'required' : 'optional') : 'none',
        period: slot('periodEnd')?.level === 'block' ? 'required' : 'none',
        products: { min: prod?.level === 'block' ? prod.min : 0, max: { dm: prodMax('dm'), email: prodMax('email'), inapp: prodMax('inapp') } },
        hero: 'ask',
      },
      example: { company: ex.company, industry: ex.industry, line: ex.line },
      design: { primary: c.primary, accent: c.accent },
    };
  });
}

interface Example { company: string; industry: string; line: string; m: (nowMs: number) => LineRichMaterials }
const base = (company: string): Omit<LineRichMaterials, 'products'> => ({
  brandName: company, poster: null, points: [], steps: [], mood: [], proof: [], benefit: null, periodEnd: null, periodLabel: null, link: 'https://example.com/event',
});
const until = (nowMs: number, days: number) => { const d = kstDatePlus(nowMs, days); return { periodEnd: d, periodLabel: `${formatLinePeriodEnd(d)}까지` }; };

// 예시 사진 = 저장소 정적 파일(frontend/public/diagnosis-examples/assets) · ★ 상품 이름과 사진이 맞는 것만(1022 시연 지적 · 이어폰을 크림으로 쓰지 않는다)
const EXAMPLES: Record<string, Example> = {
  spotlight: {
    company: '온결', industry: '뷰티', line: '진정 앰플 신제품 출시 · 출시 기념 20%',
    m: (now) => ({
      ...base('온결'), poster: { url: `${A}/beauty-dm-hero.png` },
      products: [{ name: '온결 진정 앰플 30ml', price: 38000, discount_price: 30400, image_url: `${A}/beauty-inapp.png` }],
      points: [
        { title: '자극 없이 진정', body: '민감 피부도 편하게', image_url: `${A}/beauty-email-hero.png` },
        { title: '빠른 흡수', body: '끈적임 없이 스며들어요' },
        { title: '하루 종일 촉촉', body: '당김 없이 편안하게' },
      ],
      steps: [{ title: '토너로 정돈', body: '결을 먼저 정돈해요' }, { title: '앰플 두 방울', body: '얼굴 전체에 가볍게' }, { title: '크림으로 마무리', body: '보습막을 씌워요' }],
      proof: [{ body: '끈적임 없이 수분이 꽉 차요', author: '김**', rating: 5 }, { body: '민감한 피부인데 편안해요', author: '이**', rating: 5 }],
      benefit: '출시 기념 20% 할인', ...until(now, 9),
    }),
  },
  showcase: {
    company: '소목', industry: '의류', line: '가을 시즌오프 최대 30% · 니트 재킷 가방',
    m: (now) => ({
      ...base('소목'), poster: { url: `${A}/fashion-dm-hero.png` },
      products: [
        { name: '케이블 울 니트', price: 59000, discount_price: 41300, image_url: `${A}/fashion-p1.png`, category: '의류' },
        { name: '울 블렌드 재킷', price: 129000, discount_price: 90300, image_url: `${A}/fashion-p2.png`, category: '의류' },
        { name: '플리츠 롱 원피스', price: 79000, discount_price: 55300, image_url: `${A}/fashion-p3.png`, category: '의류' },
        { name: '레더 숄더백', price: 99000, discount_price: 69300, image_url: `${A}/fashion-p4.png`, category: '잡화' },
        { name: '클래식 스니커즈', price: 89000, discount_price: 62300, image_url: `${A}/fashion-p5.png`, category: '잡화' },
      ],
      benefit: '가을 시즌오프 최대 30%', couponCode: 'FALL10', ...until(now, 5),
    }),
  },
  lookbook: {
    company: '소목', industry: '의류', line: 'FW 신상 입고 · 가을을 입는 새로운 결',
    m: () => ({
      ...base('소목'), poster: { url: `${A}/fashion-dm-hero.png` },
      mood: [`${A}/fashion-email-hero.png`, `${A}/fashion-inapp.png`],
      products: [
        { name: '케이블 울 니트', price: 59000, image_url: `${A}/fashion-p1.png`, category: '여성' },
        { name: '플리츠 롱 원피스', price: 79000, image_url: `${A}/fashion-p3.png`, category: '여성' },
        { name: '울 블렌드 재킷', price: 129000, image_url: `${A}/fashion-p2.png`, category: '남성' },
        { name: '클래식 스니커즈', price: 89000, image_url: `${A}/fashion-p5.png`, category: '남성' },
      ],
      points: [{ title: '니트 + 롱 원피스', body: '부드럽게 겹쳐 가을 무드로' }, { title: '재킷 + 숄더백', body: '격식은 재킷, 포인트는 가방으로', image_url: `${A}/fashion-p4.png` }],
    }),
  },
  menu: {
    company: '한상', industry: '외식', line: '가을 신메뉴 파스타 · 샐러드 출시 · 첫 주 음료 무료',
    m: () => ({
      ...base('한상'), poster: { url: `${A}/fnb-dm-hero.png` },
      mood: [`${A}/fnb-email-hero.png`],
      points: [{ title: '가을 한정', body: '' }, { title: '매일 만드는 생면', body: '' }, { title: '제철 채소', body: '' }],
      products: [
        { name: '트러플 크림 파스타', price: 18000, image_url: `${A}/fnb-p1.png` },
        { name: '리코타 제철 샐러드', price: 14000, image_url: `${A}/fnb-p2.png` },
        { name: '딸기 생크림 케이크', price: 7500, image_url: `${A}/fnb-inapp.png` },
      ],
      proof: [{ body: '파스타 소스가 진하고 면이 쫄깃해요', author: '박**', rating: 5 }],
      store: { address: '서울 마포구 한줄로 12', business_hours: '매일 11:00 ~ 22:00', phone: '02-000-0000' },
      benefit: '첫 주 음료 무료',
    }),
  },
  event: {
    company: '온결', industry: '뷰티', line: '회원의 날 3일간 15% 쿠폰',
    m: (now) => ({
      ...base('온결'), poster: { url: `${A}/ecommerce-dm-hero.png` },
      points: [{ title: '앱에서 회원 가입', body: '30초면 끝나요' }, { title: '쿠폰 받기', body: '쿠폰함에 바로 들어와요' }, { title: '결제할 때 쓰기', body: '모든 상품에 쓸 수 있어요' }],
      products: [{ name: '온결 진정 앰플', price: 38000, discount_price: 32300, image_url: `${A}/beauty-inapp.png` }],
      benefit: '회원의 날 15% 쿠폰', couponCode: 'MEMBER15', ...until(now, 3),
    }),
  },
};

/** 예시 한 벌 — DM · 이메일 = html · 인앱 = 메시지(옛 예시 경로와 같은 모양) */
export function renderCompositionExample(comp: LineComposition, channel: 'dm' | 'email' | 'inapp', layout: 'slides' | 'page', nowMs: number): { html: string; layout: 'slides' | 'page' } | { message: LineInAppMessage } {
  const ex = EXAMPLES[comp.id];
  const m = ex.m(nowMs);
  const c = compositionFallbackCopy(comp);
  const kit = { primary_color: comp.primary, accent_color: comp.accent } as DmBrandKit;
  if (channel === 'inapp') return { message: composeRichInapp(comp, m, c) };
  if (channel === 'email') {
    const r = composeRichEmail(comp, m, c, () => randomUUID());
    return { html: renderEmailSections(r.sections, { brandKit: kit, storeName: m.brandName }), layout: 'page' };
  }
  const r = composeRichDm(comp, m, c, () => randomUUID());
  const slides = layout === 'slides' && r.pages.length >= 3;
  const dm = { title: `${m.brandName} 예시`, store_name: m.brandName, layout_mode: slides ? 'slides' : 'scroll', pages: slides ? r.pages.map((secs, i) => ({ id: `p${i}`, name: `${i + 1}장`, sections: secs })) : [{ id: 'p0', name: '1장', sections: r.sections }], sections: r.sections, brand_kit: { ...kit, ...r.brandKitPatch }, short_code: '' };
  return { html: renderDmViewerHtml(dm, ''), layout: slides ? 'slides' : 'page' };
}
