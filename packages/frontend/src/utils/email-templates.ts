// email-templates.ts — 이메일 비주얼 빌더 템플릿 갤러리 프리셋
// 즉시·무료로 완성 골격을 비주얼 에디터에 불러온다(AI 생성과 별개, 크레딧 0).
// 혜택(% / 원 / 쿠폰 등)은 절대 임의 생성하지 않고 [직접 작성해주세요] placeholder로 둔다.
import { ShoppingCart, Moon, Crown, Package, Cake, Newspaper, type LucideIcon } from 'lucide-react';
import type { Section, SectionType } from './dm-section-defaults';

const PH = '[직접 작성해주세요]';

let _seq = 0;
function mk(type: SectionType, props: Record<string, any>): Section {
  return { id: `tpl-${type}-${_seq++}`, type, order: 0, visible: true, props: props as any };
}
function ordered(sections: Section[]): Section[] {
  return sections.map((s, i) => ({ ...s, order: i }));
}

export interface EmailTemplate {
  key: string;
  label: string;
  hint: string;
  industry?: string[];     // 추천 매칭용 업종 키워드(없으면 일반)
  icon: LucideIcon;
  gradient: string;
  sections: Section[];
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    key: 'cart',
    label: '장바구니 리마인드',
    hint: '결제 미완료 고객 재유도',
    icon: ShoppingCart,
    gradient: 'from-rose-500 to-pink-500',
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '담아두신 상품, 아직 기다리고 있어요', sub_copy: '장바구니 속 상품을 잊지 않으셨나요?', align: 'center' }),
      mk('text_card', { tag: '리마인드', headline: '지금 마음에 드셨던 그 상품', body: PH, align: 'left' }),
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
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '오랜만이에요, 다시 만나 반가워요', sub_copy: '그동안 새로워진 모습을 소개할게요', align: 'center' }),
      mk('text_card', { tag: 'WELCOME BACK', headline: '돌아오신 분께 드리는 안내', body: PH, align: 'left' }),
      mk('cta', { buttons: [{ label: '지금 둘러보기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'vip',
    label: 'VIP 감사',
    hint: '우수 고객 전용 인사',
    industry: ['fashion', '의류', 'beauty', '뷰티', 'luxury'],
    icon: Crown,
    gradient: 'from-amber-500 to-orange-500',
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '늘 함께해 주셔서 감사합니다', sub_copy: '소중한 고객님께 전하는 특별한 마음', align: 'center' }),
      mk('text_card', { tag: 'VIP', headline: '고객님을 위한 안내', body: PH, align: 'left' }),
      mk('cta', { buttons: [{ label: '자세히 보기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'new',
    label: '신상품 안내',
    hint: '새 상품·서비스 소개',
    industry: ['fashion', '의류', 'beauty', '뷰티', 'food', '식품'],
    icon: Package,
    gradient: 'from-emerald-500 to-teal-500',
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '새로운 상품이 도착했어요', sub_copy: '가장 먼저 만나보세요', align: 'center' }),
      mk('text_card', { tag: 'NEW', headline: '이번 신상품의 포인트', body: PH, align: 'left' }),
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
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '생일 진심으로 축하드려요', sub_copy: '특별한 날, 좋은 일만 가득하길 바라요', align: 'center' }),
      mk('text_card', { tag: 'HAPPY BIRTHDAY', headline: '생일을 맞은 고객님께', body: PH, align: 'center' }),
      mk('cta', { buttons: [{ label: '선물 확인하기', url: '', style: 'primary' }] }),
      mk('footer', { notes: PH, cs_phone: '' }),
    ]),
  },
  {
    key: 'newsletter',
    label: '뉴스레터',
    hint: '브랜드 소식 정기 발송',
    icon: Newspaper,
    gradient: 'from-sky-500 to-indigo-500',
    sections: ordered([
      mk('header', { variant: 'logo', brand_name: '', align: 'center' }),
      mk('hero', { headline: '이번 달 소식을 전해드려요', sub_copy: '', align: 'center' }),
      mk('text_card', { tag: 'NEWS', headline: '첫 번째 이야기', body: PH, align: 'left' }),
      mk('text_card', { tag: 'NEWS', headline: '두 번째 이야기', body: PH, align: 'left' }),
      mk('cta', { buttons: [{ label: '더 보기', url: '', style: 'primary' }] }),
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
