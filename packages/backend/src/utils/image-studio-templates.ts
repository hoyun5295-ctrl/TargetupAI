/**
 * utils/image-studio-templates.ts — P4 이미지 스튜디오 템플릿 = 은닉 프롬프트 스캐폴드 카탈로그 (2026-07-19 v2)
 *
 * ★ 재정의(Harold 2026-07-19): 템플릿 = "미리 정교하게 짜둔 이미지 생성 프롬프트".
 *   고객사는 템플릿(예시 스타일) 선택 + 원본 이미지 + 간단 문구만 입력하면,
 *   생성 AI가 [누끼 제품 + 어울리는 배경 + 지정 문구의 고급 타이포]를 한 장의 완성 포스터로 렌더한다.
 *   (실증: 시세이도 얼티뮨 세트 — "ONLINE EXCLUSIVE / 얼티뮨 세트 30% 할인 / 한정 300명 특별 혜택"이
 *    이미지 안에 정제 타이포로 새겨진 완성본. Harold 직접 실측 2026-07-19.)
 *
 * 원칙:
 *  - scaffold(장면 지시)·textStyle(타이포 지시)은 서버 은닉 — 고객사 응답(listTemplatesPublic)에 절대 미포함.
 *  - 문구는 고객사가 지정한 텍스트를 verbatim 렌더 — AI가 혜택·수치를 지어내지 않는다(그 외 텍스트 금지 지시는 엔진이 부착).
 *  - 템플릿 추가 = 이 카탈로그에 데이터만 추가(코드 무수정) → 지속 확장.
 *  - 채널 사이즈(인앱 3:4 / DM 1:1 / 이메일 16:9 / MMS 1K)는 템플릿과 독립 — 같은 템플릿으로 채널별 각각 생성.
 */

export type TemplateCategory = '뷰티' | '카페·음료' | '신메뉴·팝' | '세일·이벤트' | '패션' | '미니멀' | '시즌';

export interface StudioTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** 갤러리 카드 한 줄 설명(고객 노출). */
  desc: string;
  /** 갤러리 카드 대표색(고객 노출). */
  accent: string;
  /** 예시 이미지 URL(운영 중 실제 생성 샘플로 채움 — 없으면 카드 스타일 목업 표시). */
  exampleUrl?: string | null;
  /** ★ 은닉 — 장면·무드·배경 지시(제품 보존·문구 렌더·금지 지시는 엔진이 부착). */
  scaffold: string;
  /** ★ 은닉 — 문구 타이포 방향 지시. */
  textStyle: string;
  /** 문구 기본값(토큰 {productName}/{salePrice} = 몰 실데이터 치환, 프론트 자동 채움). */
  defaultTexts: { label?: string; title?: string; subtitle?: string };
  /** 시즌 컨텍스트 주입 여부(시즌 카테고리만 true — 나머지는 불필요한 계절 소품 방지). */
  useSeason?: boolean;
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  // ── 뷰티 ─────────────────────────────────────────────
  {
    id: 'beauty-lux-dark', name: '프리미엄 다크 럭셔리', category: '뷰티',
    desc: '어두운 우드·대리석 위 고급 브랜드 무드', accent: '#3d2b22',
    scaffold: 'A luxurious premium cosmetics campaign scene: dark wood paneled interior, polished black marble vanity counter, warm ambient lamp glow, tasteful props at the edges (a silk scarf, a slim flower vase with a single lily, art books, a small perfume bottle). High-end department store campaign atmosphere, sophisticated and calm, cinematic warm lighting.',
    textStyle: 'Elegant refined typography in warm cream/champagne tone, generous letter spacing for the small label, a large serif-feeling headline, understated sub-headline. Text placed in the upper area with luxury-brand restraint.',
    defaultTexts: { label: 'ONLINE EXCLUSIVE', title: '{productName}', subtitle: '' },
  },
  {
    id: 'beauty-clean-bright', name: '클린 브라이트 뷰티', category: '뷰티',
    desc: '밝은 베이지·드라이플라워 에디토리얼', accent: '#cbb9a7',
    scaffold: 'A bright high-end cosmetics editorial scene: soft beige seamless backdrop, warm diffuse daylight, delicate dried florals and small ceramic vases at the edges, a clean fabric-textured pedestal surface. Airy, minimal, magazine-quality styling.',
    textStyle: 'Minimal editorial typography in deep warm brown, small uppercase label, medium-weight headline, light sub-headline. Clean placement in the upper third.',
    defaultTexts: { label: 'SIGNATURE', title: '{productName}', subtitle: '{salePrice}' },
  },
  // ── 카페·음료 ─────────────────────────────────────────
  {
    id: 'cafe-wood-natural', name: '우드 내추럴 카페', category: '카페·음료',
    desc: '원목·자연광의 따뜻한 카페 무드', accent: '#8a6d52',
    scaffold: 'A cozy specialty cafe scene: warm wooden table, soft natural window light from the front, subtle green plant and linen napkin at the edges, gentle steam or freshness in the air. Inviting artisan coffee shop atmosphere.',
    textStyle: 'Warm friendly typography in cream white with a soft shadow for readability, hand-crafted cafe menu feel, headline prominent in the upper area.',
    defaultTexts: { label: 'NEW DRINK', title: '{productName}', subtitle: '{salePrice}' },
  },
  {
    id: 'cafe-summer-pool', name: '시원한 섬머 블루', category: '카페·음료',
    desc: '물결·청량감의 여름 음료 포스터', accent: '#3aa7d9',
    scaffold: 'A refreshing summer beverage scene: sparkling clear water surface with sunlight caustics, bright sky blue tones, ice cubes and a splash of freshness, maybe watermelon or citrus slices floating at the edges. Cool, thirst-quenching, vibrant summer energy.',
    textStyle: 'Playful bold typography in white and deep blue with strong contrast, energetic summer-sale poster feel, headline large in the upper area.',
    defaultTexts: { label: '여름 한정', title: '{productName}', subtitle: '{salePrice}' },
  },
  // ── 신메뉴·팝 ─────────────────────────────────────────
  {
    id: 'pop-retro-block', name: '레트로 팝 색블록', category: '신메뉴·팝',
    desc: '체커보드·원색 대비의 임팩트 팝', accent: '#2b2f77',
    scaffold: 'A bold retro pop-art promotional scene: strong flat color blocks (deep blue, warm red, yellow), checkerboard pattern accents at the edges, diagonal banner energy, playful vintage Korean street poster vibe. High contrast, fun, eye-catching.',
    textStyle: 'Thick bold display typography with strong outlines, mixed scale composition like a retro Korean poster, badge-like small label. Text is a main design element.',
    defaultTexts: { label: '신메뉴 등장!', title: '{productName}', subtitle: '' },
  },
  {
    id: 'pop-cute-pastel', name: '파스텔 큐트 팝', category: '신메뉴·팝',
    desc: '파스텔 톤의 귀엽고 산뜻한 팝', accent: '#f5a8c0',
    scaffold: 'A cute pastel promotional scene: soft pink and cream color background with simple rounded shapes, small confetti or sticker-like accents, sweet dessert-shop energy, clean and adorable.',
    textStyle: 'Rounded friendly typography in deep rose and white, cute badge label, cheerful and approachable feel.',
    defaultTexts: { label: 'NEW', title: '{productName}', subtitle: '{salePrice}' },
  },
  // ── 세일·이벤트 ───────────────────────────────────────
  {
    id: 'sale-bold-impact', name: '볼드 세일 임팩트', category: '세일·이벤트',
    desc: '큰 숫자·강한 대비의 세일 포스터', accent: '#e2483d',
    scaffold: 'A high-impact sale campaign scene: bold red and deep blue color energy, dynamic diagonal composition, celebratory confetti or percent-tag graphic accents around the edges, urgent shopping-festival atmosphere.',
    textStyle: 'Very large ultra-bold sale typography as the hero element, white with red accents and strong outline, the discount headline dominates the composition.',
    defaultTexts: { label: '기간 한정', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
  },
  {
    id: 'sale-elegant-event', name: '엘레강트 이벤트', category: '세일·이벤트',
    desc: '고급스러운 절제된 프로모션', accent: '#b9a06b',
    scaffold: 'An elegant premium promotion scene: deep charcoal background with subtle gold light streaks, refined celebratory mood without clutter, luxury gift atmosphere, soft spotlight on the product area.',
    textStyle: 'Refined gold-tone typography, generous spacing, understated luxury promotion feel — quiet confidence rather than loud sale energy.',
    defaultTexts: { label: 'SPECIAL OFFER', title: '{productName}', subtitle: '[혜택은 직접 입력해주세요]' },
  },
  // ── 패션 ─────────────────────────────────────────────
  {
    id: 'fashion-studio-clean', name: '스튜디오 클린 패션', category: '패션',
    desc: '뉴트럴 배경의 미니멀 스튜디오컷', accent: '#9a9a9a',
    scaffold: 'A clean fashion campaign scene: neutral gray seamless studio backdrop, soft directional light with gentle shadow, minimal modern styling, premium lookbook atmosphere.',
    textStyle: 'Modern sans-serif typography in white or black depending on contrast, small tracking-wide label, confident medium headline. Fashion lookbook restraint.',
    defaultTexts: { label: 'COLLECTION', title: '{productName}', subtitle: '' },
  },
  // ── 미니멀 ────────────────────────────────────────────
  {
    id: 'minimal-stone', name: '스톤 미니멀', category: '미니멀',
    desc: '돌 단상·여백의 정제된 미니멀', accent: '#d8d2c8',
    scaffold: 'A minimal product scene: a single travertine stone pedestal on a soft warm gradient backdrop, generous negative space, subtle glow behind the pedestal, gallery-like stillness.',
    textStyle: 'Quiet minimal typography in warm dark gray, small headline, lots of breathing room — the emptiness is the design.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '{salePrice}' },
  },
  // ── 시즌 ─────────────────────────────────────────────
  {
    id: 'season-auto', name: '이번 시즌 무드', category: '시즌',
    desc: '지금 계절 감성을 자동 반영', accent: '#7ba05b',
    scaffold: 'A seasonal marketing scene that matches the current Korean season, with tasteful seasonal props and atmosphere at the edges, warm commercial styling, product area kept clean.',
    textStyle: 'Seasonal friendly typography with good readability, headline in the upper area, colors harmonized with the seasonal palette.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '{salePrice}' },
    useSeason: true,
  },
  // ── 이메일 히어로(와이드 추천) ─────────────────────────
  {
    id: 'email-wide-hero', name: '와이드 히어로', category: '미니멀',
    desc: '이메일 상단용 가로 히어로 (16:9 추천)', accent: '#6b7d8a',
    scaffold: 'A wide premium hero banner scene: product placed on one side on an elegant surface, warm ambient interior softly blurred behind, generous empty space on the other side reserved for the headline. Sophisticated e-commerce hero banner.',
    textStyle: 'Left-aligned editorial typography in the empty side: small label, strong headline, light sub-headline. Balanced against the product.',
    defaultTexts: { label: 'ONLINE STORE', title: '{productName}', subtitle: '{salePrice}' },
  },
];

export function getTemplate(id: string): StudioTemplate | undefined {
  return STUDIO_TEMPLATES.find((t) => t.id === id);
}

/** 갤러리용 공개 목록 — ★scaffold·textStyle(은닉 프롬프트) 절대 미포함. */
export function listTemplatesPublic() {
  return STUDIO_TEMPLATES.map((t) => ({
    id: t.id, name: t.name, category: t.category, desc: t.desc, accent: t.accent,
    exampleUrl: t.exampleUrl || null, defaultTexts: t.defaultTexts,
  }));
}

/** {productName}/{salePrice} 토큰 치환 — 몰 실데이터(사용자 수정 가능·임의 혜택 아님). */
export function fillTextTokens(text: string, data: { productName?: string | null; salePrice?: string | null }): string {
  return (text || '')
    .replace(/\{productName\}/g, (data.productName || '').trim())
    .replace(/\{salePrice\}/g, (data.salePrice || '').trim());
}
