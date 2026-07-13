// email-templates.ts — 이메일 비주얼 빌더 골든 템플릿 12종 (★ 2026-07-13 디자인 3.0 격상)
// 즉시·무료로 완성 골격을 비주얼 에디터에 불러온다(AI 생성과 별개, 크레딧 0).
// 옛 6종(빈 골격) → 아트디렉션 완성형 12종 — 기존 6개 key 유지(하위호환) + 신규 6종.
// 각 템플릿 = 섹션(구도/배경/정렬 패치 동승) + design(테마·아트디렉션 — EMAIL_DESIGN_THEMES 재사용).
// 혜택(% / 원 / 쿠폰 등)은 절대 임의 생성하지 않고 [직접 작성해주세요] placeholder로 둔다.
import {
  Cake, Crown, IdCard, MessageSquareHeart, Moon, Newspaper, Package, PackageCheck,
  PartyPopper, ShoppingCart, Store, Tag, type LucideIcon,
} from 'lucide-react';
import type { Section, SectionType } from './dm-section-defaults';
import { EMAIL_DESIGN_THEMES, type EmailDesign } from './email-themes';

const PH = '[직접 작성해주세요]';

let _seq = 0;
/** 섹션 생성 — extra = 섹션 레벨 스타일 패치(treatment/background/align). */
function mk(type: SectionType, props: Record<string, any>, extra: Partial<Section> = {}): Section {
  return { id: `tpl-${type}-${_seq++}`, type, order: 0, visible: true, props: props as any, ...extra } as Section;
}
function ordered(sections: Section[]): Section[] {
  return sections.map((s, i) => ({ ...s, order: i }));
}
/** 테마 프리셋의 design 재사용(단일 진실 — email-themes.ts). 미등록 id = 기본 룩. */
function themeDesign(id: string): EmailDesign | undefined {
  const t = EMAIL_DESIGN_THEMES.find((x) => x.id === id);
  return t ? { ...t.design } : undefined;
}

export interface EmailTemplate {
  key: string;
  label: string;
  hint: string;
  industry?: string[];     // 추천 매칭용 업종 키워드(없으면 일반)
  icon: LucideIcon;
  gradient: string;
  sections: Section[];
  /** ★ 2026-07-13 — 템플릿 추천 테마(캠페인 design으로 동승). 없으면 기본 룩. */
  design?: EmailDesign;
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    key: 'cart',
    label: '장바구니 리마인드',
    hint: '결제 미완료 고객 재유도',
    icon: ShoppingCart,
    gradient: 'from-rose-500 to-pink-500',
    design: themeDesign('minimal'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '담아두신 상품, 아직 기다리고 있어요', sub_copy: '장바구니 속 상품을 잊지 않으셨나요?', align: 'center' }),
      mk('text_card', { tag: '리마인드', headline: '지금 마음에 드셨던 그 상품', body: PH, align: 'left' }, { treatment: 'lead' }),
      mk('cta', { buttons: [{ label: '장바구니 보러가기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'dormant',
    label: '휴면 재활성',
    hint: '오랜만에 다시 부르기',
    icon: Moon,
    gradient: 'from-indigo-500 to-violet-500',
    design: themeDesign('soft-pastel'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '오랜만이에요, 다시 만나 반가워요', sub_copy: '그동안 새로워진 모습을 소개할게요', align: 'center' }),
      mk('text_card', { tag: 'WELCOME BACK', headline: '돌아오신 분께 드리는 안내', body: PH, align: 'left' }, { background: 'soft' }),
      mk('cta', { buttons: [{ label: '지금 둘러보기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'vip',
    label: 'VIP 감사',
    hint: '우수 고객 전용 인사 — 프라이빗 다크',
    industry: ['fashion', '의류', 'beauty', '뷰티', 'luxury'],
    icon: Crown,
    gradient: 'from-amber-500 to-orange-500',
    design: themeDesign('luxury-dark'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '늘 함께해 주셔서 감사합니다', sub_copy: '소중한 고객님께 전하는 특별한 마음', align: 'center' }, { treatment: 'typographic' }),
      mk('text_card', { tag: 'VIP', headline: '고객님을 위한 안내', body: PH, align: 'left' }, { treatment: 'quote' }),
      mk('coupon', { discount_label: PH, coupon_code: '' }, { treatment: 'spotlight' }),
      mk('cta', { buttons: [{ label: '자세히 보기', url: '', style: 'primary' }] }, { treatment: 'ghost' }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'new',
    label: '신상품 안내',
    hint: '새 상품·서비스 소개 — 에디토리얼',
    industry: ['fashion', '의류', 'beauty', '뷰티', 'food', '식품'],
    icon: Package,
    gradient: 'from-emerald-500 to-teal-500',
    design: themeDesign('editorial'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '새로운 상품이 도착했어요', sub_copy: '가장 먼저 만나보세요', align: 'center' }, { treatment: 'typographic' }),
      mk('text_card', { tag: 'NEW', headline: '이번 신상품의 포인트', body: PH, align: 'left' }, { treatment: 'lead' }),
      mk('product_carousel', { title: '이번 신상품', products: [] }, { treatment: 'focus', background: 'soft' }),
      mk('cta', { buttons: [{ label: '신상품 보러가기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'birthday',
    label: '생일 축하',
    hint: '생일 고객 축하 인사',
    icon: Cake,
    gradient: 'from-fuchsia-500 to-pink-500',
    design: themeDesign('soft-pastel'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '생일 진심으로 축하드려요', sub_copy: '특별한 날, 좋은 일만 가득하길 바라요', align: 'center' }),
      mk('text_card', { tag: 'HAPPY BIRTHDAY', headline: '생일을 맞은 고객님께', body: PH, align: 'center' }, { background: 'tint' }),
      mk('coupon', { discount_label: PH, coupon_code: '' }),
      mk('cta', { buttons: [{ label: '선물 확인하기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'newsletter',
    label: '뉴스레터',
    hint: '브랜드 소식 정기 발송 — 매거진 조판',
    icon: Newspaper,
    gradient: 'from-sky-500 to-indigo-500',
    design: themeDesign('editorial'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '이번 달 소식을 전해드려요', sub_copy: '', align: 'center' }, { treatment: 'typographic' }),
      mk('text_card', { tag: 'NEWS', headline: '첫 번째 이야기', body: PH, align: 'left' }, { treatment: 'lead' }),
      mk('text_card', { tag: 'NEWS', headline: '두 번째 이야기', body: PH, align: 'left' }),
      mk('cta', { buttons: [{ label: '더 보기', url: '', style: 'outline' }] }, { treatment: 'ghost' }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  // ── ★ 2026-07-13 신규 6종 ──
  {
    key: 'season-sale',
    label: '시즌 세일',
    hint: '기간 한정 세일 — 임팩트 조판',
    industry: ['fashion', '의류', 'beauty', '뷰티'],
    icon: Tag,
    gradient: 'from-zinc-700 to-zinc-900',
    design: themeDesign('bold-sale'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '시즌 세일이 시작됐어요', sub_copy: PH, align: 'center' }, { treatment: 'typographic' }),
      mk('countdown', { end_datetime: '', urgency_text: '마감까지 얼마 남지 않았어요' }),
      mk('coupon', { discount_label: PH, coupon_code: '' }),
      mk('product_carousel', { title: '세일 추천', products: [] }, { treatment: 'list' }),
      mk('cta', { buttons: [{ label: '세일 전체 보기', url: '', style: 'primary' }] }, { treatment: 'bar' }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'event-invite',
    label: '이벤트 초대',
    hint: '팝업·행사 초대장',
    icon: PartyPopper,
    gradient: 'from-rose-500 to-amber-500',
    design: themeDesign('festive'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '특별한 자리에 초대합니다', sub_copy: PH, align: 'center' }),
      mk('text_card', { tag: 'INVITATION', headline: '이런 순서로 준비했어요', body: PH, align: 'left' }, { treatment: 'framed' }),
      mk('store_info', { address: '', phone: '', business_hours: '' }),
      mk('cta', { buttons: [{ label: '참여 신청하기', url: '', style: 'primary' }] }, { treatment: 'bar' }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'restock',
    label: '재입고 알림',
    hint: '품절 상품 재입고 소식',
    industry: ['fashion', '의류', 'beauty', '뷰티', 'food', '식품'],
    icon: PackageCheck,
    gradient: 'from-emerald-500 to-lime-500',
    design: themeDesign('minimal'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '기다리시던 상품이 다시 들어왔어요', sub_copy: '늦기 전에 확인해보세요', align: 'center' }),
      mk('product_carousel', { title: '재입고 상품', products: [] }, { treatment: 'focus' }),
      mk('cta', { buttons: [{ label: '지금 확인하기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'review-showcase',
    label: '후기 소개',
    hint: '고객 후기로 신뢰 쌓기',
    icon: MessageSquareHeart,
    gradient: 'from-violet-500 to-fuchsia-500',
    design: themeDesign('paper'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '고객님들이 남겨주신 이야기', sub_copy: '', align: 'center' }, { treatment: 'typographic' }),
      mk('reviews', { title: '생생한 후기', reviews: [] }, { background: 'soft' }),
      mk('text_card', { tag: 'STORY', headline: '이런 점이 좋았대요', body: PH, align: 'left' }, { treatment: 'quote' }),
      mk('cta', { buttons: [{ label: '후기 더 보기', url: '', style: 'outline' }] }, { treatment: 'ghost' }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'membership',
    label: '멤버십 안내',
    hint: '등급·적립 제도 소개',
    icon: IdCard,
    gradient: 'from-cyan-500 to-sky-500',
    design: themeDesign('city-night'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '멤버십 혜택을 안내드려요', sub_copy: PH, align: 'center' }),
      mk('text_card', { tag: 'MEMBERSHIP', headline: '등급별로 이렇게 달라져요', body: PH, align: 'left' }, { treatment: 'framed' }),
      mk('text_card', { tag: 'GUIDE', headline: '이용 방법', body: PH, align: 'left' }, { background: 'soft' }),
      mk('cta', { buttons: [{ label: '내 등급 확인하기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'store-open',
    label: '매장 소식',
    hint: '오픈·리뉴얼·운영 안내',
    industry: ['food', '식품', 'cafe', '카페'],
    icon: Store,
    gradient: 'from-orange-500 to-amber-500',
    design: themeDesign('paper'),
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '매장의 새 소식을 전해드려요', sub_copy: PH, align: 'center' }),
      mk('text_card', { tag: 'NOTICE', headline: '무엇이 달라졌나요', body: PH, align: 'left' }, { treatment: 'lead' }),
      mk('store_info', { address: '', phone: '', business_hours: '' }),
      mk('cta', { buttons: [{ label: '오시는 길 보기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
];

/**
 * 회사 업종 신호로 어울리는 템플릿 key를 추천(앞쪽 우선 노출용).
 * 신호가 없거나 매칭 0이면 빈 배열(호출부는 전체를 그대로 노출 — 추측 추천 금지).
 */
export function recommendTemplateKeys(industry?: string | null): string[] {
  if (!industry) return [];
  const i = String(industry).toLowerCase();
  const out: string[] = [];
  for (const t of EMAIL_TEMPLATES) {
    if (t.industry && t.industry.some((kw) => i.includes(kw.toLowerCase()))) out.push(t.key);
  }
  return out;
}
