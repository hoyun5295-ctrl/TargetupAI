/**
 * utils/image-studio-templates.ts — P4 이미지 스튜디오 템플릿 = 은닉 프롬프트 스캐폴드 카탈로그 (2026-07-19 v3 · 36종)
 *
 * ★ 재정의(Harold 2026-07-19): 템플릿 = "미리 정교하게 짜둔 이미지 생성 프롬프트".
 *   고객사는 템플릿(예시 스타일) 선택 + 원본 이미지 + 간단 문구만 입력하면,
 *   생성 AI가 [누끼 제품 + 어울리는 배경 + 지정 문구의 고급 타이포]를 한 장의 완성 포스터로 렌더한다.
 *
 * 원칙:
 *  - scaffold(장면 지시)·textStyle(타이포 지시)은 서버 은닉 — listTemplatesPublic에 절대 미포함.
 *  - 문구는 고객사 지정 텍스트를 verbatim 렌더 — AI가 혜택·수치를 지어내지 않는다(금지 지시는 엔진이 부착).
 *  - 템플릿 추가 = 데이터만(코드 무수정). 각 항목은 장면·타이포가 실제로 다른 아트 디렉션이어야 한다(숫자 채우기 금지 — Harold).
 *  - 채널 사이즈(인앱 3:4 / DM 1:1 / 이메일 16:9)는 템플릿과 독립.
 *  - 브랜드 실명·혜택 수치를 카탈로그에 넣지 않는다. 세일류 기본 문구 = [혜택은 직접 입력해주세요].
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
  /** 시즌 컨텍스트 주입 여부(자동 시즌 템플릿만 true). */
  useSeason?: boolean;
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  // ══ 뷰티 (6) ══════════════════════════════════════════
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
  {
    id: 'beauty-aqua-fresh', name: '워터 프레시', category: '뷰티',
    desc: '물결·이슬의 수분 세럼 무드', accent: '#7fb8c9',
    scaffold: 'A hydration-focused skincare scene: crystal clear water surface with gentle ripples, dewy droplets on glass, soft aqua and pale blue tones, fresh morning light refracting through water, a wet stone or glass platform for the product. Clean, dewy, ultra-fresh moisture feeling.',
    textStyle: 'Light airy typography in white with a subtle watery glow, thin elegant headline, small tracking-wide label. Fresh and clean placement in the upper area.',
    defaultTexts: { label: 'HYDRATION', title: '{productName}', subtitle: '{salePrice}' },
  },
  {
    id: 'beauty-spa-natural', name: '스파 내추럴', category: '뷰티',
    desc: '돌·타월·그린의 스파 릴랙스 무드', accent: '#8a9a83',
    scaffold: 'A serene spa scene: smooth river stones, a rolled cream towel, eucalyptus branches, warm neutral tones with sage green accents, soft steam in the air, natural bamboo or stone surface. Calm wellness sanctuary atmosphere, gentle diffused light.',
    textStyle: 'Calm organic typography in deep sage or warm gray, lowercase-feeling softness, generous breathing room. Quiet spa-menu elegance in the upper area.',
    defaultTexts: { label: 'RELAX & CARE', title: '{productName}', subtitle: '' },
  },
  {
    id: 'beauty-glow-gold', name: '글로우 골드', category: '뷰티',
    desc: '골드 시머·보케의 홀리데이 럭스', accent: '#b98d4f',
    scaffold: 'A glamorous holiday luxury scene: shimmering gold bokeh lights in the background, champagne-gold silk fabric draped on the surface, subtle sparkle particles in the air, warm golden hour glow. Festive premium gift-season atmosphere, opulent but tasteful.',
    textStyle: 'Glamorous typography in bright gold with subtle shine, refined serif-feeling headline, delicate letter-spaced label. Festive luxury placement in the upper area.',
    defaultTexts: { label: 'HOLIDAY EDITION', title: '{productName}', subtitle: '' },
  },
  {
    id: 'beauty-pastel-makeup', name: '파우더 파스텔', category: '뷰티',
    desc: '파우더 번짐의 색조 메이크업 팝', accent: '#e3aab8',
    scaffold: 'A playful color cosmetics scene: soft pastel powder bursts frozen mid-air (blush pink, peach, lavender), a clean pastel seamless backdrop, subtle shimmer dust, smooth acrylic platform for the product. Fresh makeup-brand energy, bright and feminine.',
    textStyle: 'Chic modern typography in deep rose, playful but polished, medium headline with a cute small label. Placed in the upper area with balanced whitespace.',
    defaultTexts: { label: 'NEW COLOR', title: '{productName}', subtitle: '{salePrice}' },
  },

  // ══ 카페·음료 (6) ═════════════════════════════════════
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
  {
    id: 'cafe-deep-roast', name: '딥 로스트', category: '카페·음료',
    desc: '에스프레소·원두의 진한 다크 무드', accent: '#4a3227',
    scaffold: 'A rich dark coffee scene: scattered roasted coffee beans, deep espresso brown tones, dramatic side lighting with warm highlights, slow steam rising, dark slate or walnut surface. Intense artisan roastery atmosphere, moody and premium.',
    textStyle: 'Strong confident typography in warm cream on the dark background, bold headline with tight kerning, small caps label. Roastery craft-brand feel in the upper area.',
    defaultTexts: { label: 'DEEP ROAST', title: '{productName}', subtitle: '{salePrice}' },
  },
  {
    id: 'cafe-brunch-morning', name: '브런치 모닝', category: '카페·음료',
    desc: '아침광 테이블의 밝은 브런치 무드', accent: '#d9b98a',
    scaffold: 'A bright weekend brunch scene: white marble or light oak table, morning sunlight with soft long shadows, fresh flowers in a small vase, croissant and linen at the edges, airy and cheerful. Fresh morning-cafe lifestyle atmosphere.',
    textStyle: 'Light cheerful typography in soft charcoal, friendly rounded feel, medium headline with a small welcoming label. Bright morning-menu placement in the upper area.',
    defaultTexts: { label: 'MORNING SET', title: '{productName}', subtitle: '{salePrice}' },
  },
  {
    id: 'cafe-dessert-sweet', name: '디저트 스위트', category: '카페·음료',
    desc: '베이커리 쇼케이스의 달콤한 무드', accent: '#c98a6d',
    scaffold: 'A sweet bakery dessert scene: warm caramel and cream tones, soft powdered sugar dust in the air, elegant cake stand or wooden board, blurred bakery showcase lights in the background. Tempting patisserie atmosphere, warm and indulgent.',
    textStyle: 'Sweet inviting typography in chocolate brown and cream, slightly rounded headline, dainty small label. Patisserie-menu charm in the upper area.',
    defaultTexts: { label: 'SWEET PICK', title: '{productName}', subtitle: '{salePrice}' },
  },
  {
    id: 'cafe-winter-cozy', name: '윈터 코지', category: '카페·음료',
    desc: '니트·온기의 겨울 시즌 음료', accent: '#8c5a4f',
    scaffold: 'A cozy winter cafe scene: chunky knit fabric and warm plaid at the edges, gentle snowfall visible through a window behind, warm string lights bokeh, rising steam, cinnamon sticks and pine sprigs as subtle props. Heartwarming winter-holiday cafe atmosphere.',
    textStyle: 'Warm cozy typography in cream with a soft glow, gentle rounded headline, festive small label. Comforting winter-menu placement in the upper area.',
    defaultTexts: { label: '겨울 한정', title: '{productName}', subtitle: '{salePrice}' },
  },

  // ══ 신메뉴·팝 (5) ═════════════════════════════════════
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
  {
    id: 'pop-neon-night', name: '네온 나이트', category: '신메뉴·팝',
    desc: '네온사인·야간의 야식·배달 무드', accent: '#c33fa0',
    scaffold: 'A vibrant neon night scene: dark urban background with glowing neon sign shapes (pink, cyan, purple), wet street light reflections, late-night delivery-food energy, electric and appetizing. Bold nightlife promotional atmosphere.',
    textStyle: 'Neon-glow typography — bright pink or cyan with luminous edges on the dark background, energetic bold headline, small glowing label. Night-market sign energy.',
    defaultTexts: { label: '야식 추천', title: '{productName}', subtitle: '' },
  },
  {
    id: 'pop-comic-burst', name: '코믹 팝', category: '신메뉴·팝',
    desc: '만화 효과·하프톤의 유쾌한 팝', accent: '#e8b23a',
    scaffold: 'A comic-book style promotional scene: halftone dot patterns, dynamic burst and starburst shapes, bold primary colors (yellow, red, blue), speech-bubble energy, playful cartoon action feel. Fun and loud pop-art composition.',
    textStyle: 'Comic display typography — chunky headline with thick outline like a cartoon sound effect, tilted for energy, badge label in a burst shape. Loud and playful.',
    defaultTexts: { label: 'WOW!', title: '{productName}', subtitle: '' },
  },
  {
    id: 'pop-vintage-print', name: '빈티지 인쇄 광고', category: '신메뉴·팝',
    desc: '옛 신문·전단 감성의 레트로 인쇄', accent: '#c9b78a',
    scaffold: 'A vintage Korean print-advertisement scene: aged cream paper texture, retro ornamental border frames, muted ink tones (faded red, navy, sepia), old-fashioned promotional flyer layout energy, nostalgic charm of decades-old newspaper ads.',
    textStyle: 'Vintage print typography — classic serif-feeling headline like old letterpress, decorative small label inside a simple ornament frame, slightly imperfect ink texture.',
    defaultTexts: { label: '오늘의 추천', title: '{productName}', subtitle: '{salePrice}' },
  },

  // ══ 세일·이벤트 (6) ═══════════════════════════════════
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
  {
    id: 'sale-black-gold', name: '블랙 & 골드 특가', category: '세일·이벤트',
    desc: '블랙 배경·골드 대형 숫자의 특가', accent: '#1a1a1a',
    scaffold: 'A premium black-sale campaign scene: deep matte black background, dramatic gold light rays and fine gold particle dust, sleek reflective black surface for the product, high-tension shopping event atmosphere like a year-end mega sale.',
    textStyle: 'Massive metallic-gold typography on black — the offer headline is the hero, tight bold letters with a subtle metallic sheen, small white label above. Maximum contrast and prestige.',
    defaultTexts: { label: 'BLACK SALE', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
  },
  {
    id: 'sale-festa-gift', name: '쇼핑 페스타', category: '세일·이벤트',
    desc: '선물상자·풍선·콘페티의 축제 무드', accent: '#d94f7e',
    scaffold: 'A festive shopping-festival scene: colorful gift boxes with ribbons stacked at the edges, floating balloons, falling confetti, bright celebratory pastel-vivid palette, joyful department-store event energy.',
    textStyle: 'Festive bouncy typography — bright white headline with a colorful drop shadow, ribbon-like label banner, celebratory and generous. Joyful event-poster placement.',
    defaultTexts: { label: 'SHOPPING FESTA', title: '{productName}', subtitle: '[혜택은 직접 입력해주세요]' },
  },
  {
    id: 'sale-time-urgent', name: '타임 세일', category: '세일·이벤트',
    desc: '시계·사선 스트라이프의 긴박한 특가', accent: '#e8842e',
    scaffold: 'An urgent flash-sale scene: bold diagonal warning stripes (orange and black) at the edges, a subtle large clock face motif in the background, spotlight beam on the product area, high-urgency limited-time energy.',
    textStyle: 'Urgent condensed typography — tall bold headline slightly italicized for speed, stopwatch-feeling small label, strong white-on-orange contrast. Countdown tension.',
    defaultTexts: { label: '오늘만', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
  },
  {
    id: 'sale-thanks-warm', name: '단골 감사제', category: '세일·이벤트',
    desc: '리본·따뜻한 톤의 고객 감사 이벤트', accent: '#b0714f',
    scaffold: 'A warm customer-appreciation scene: soft terracotta and cream tones, a gentle satin ribbon across the lower edge, warm side light like late afternoon, small heartfelt props (a handwritten-style card, dried flowers). Sincere thank-you event atmosphere.',
    textStyle: 'Warm sincere typography in deep brown, gentle serif-feeling headline, handwritten-warmth small label. Grateful and personal, placed with calm balance.',
    defaultTexts: { label: '고객 감사제', title: '{productName}', subtitle: '[혜택은 직접 입력해주세요]' },
  },

  // ══ 패션 (5) ═════════════════════════════════════════
  {
    id: 'fashion-studio-clean', name: '스튜디오 클린', category: '패션',
    desc: '뉴트럴 배경의 미니멀 스튜디오컷', accent: '#9a9a9a',
    scaffold: 'A clean fashion campaign scene: neutral gray seamless studio backdrop, soft directional light with gentle shadow, minimal modern styling, premium lookbook atmosphere.',
    textStyle: 'Modern sans-serif typography in white or black depending on contrast, small tracking-wide label, confident medium headline. Fashion lookbook restraint.',
    defaultTexts: { label: 'COLLECTION', title: '{productName}', subtitle: '' },
  },
  {
    id: 'fashion-street-urban', name: '스트리트 어반', category: '패션',
    desc: '콘크리트·도시 그림자의 스트리트 무드', accent: '#6b6f75',
    scaffold: 'An urban streetwear scene: raw concrete wall with hard sunlight and sharp diagonal shadows, asphalt texture below, city atmosphere with a hint of chain-link or metal edge, cool tones with one warm light accent. Bold street-culture energy.',
    textStyle: 'Street-style typography — heavy condensed headline like stencil or poster paste-up, small tag-like label, high contrast white or black. Raw and confident.',
    defaultTexts: { label: 'STREET', title: '{productName}', subtitle: '' },
  },
  {
    id: 'fashion-magazine-serif', name: '매거진 에디토리얼', category: '패션',
    desc: '화이트 지면·대형 세리프의 잡지 표지', accent: '#e8e6e1',
    scaffold: 'A high-fashion magazine editorial scene: clean off-white studio space like a magazine page, one dramatic soft shadow, minimal styling with a single elegant prop (a chair edge or fabric drape), sophisticated whitespace-driven composition.',
    textStyle: 'Editorial masthead typography — very large elegant serif headline like a fashion magazine cover, tiny caption-style label and subtitle, black ink on white. The type IS the design.',
    defaultTexts: { label: 'EDITION', title: '{productName}', subtitle: '' },
  },
  {
    id: 'fashion-season-lookbook', name: '시즌 룩북', category: '패션',
    desc: '계절 소재·텍스처 배경의 룩북 컷', accent: '#a8917a',
    scaffold: 'A seasonal fashion lookbook scene: natural seasonal textures as the backdrop (linen and rattan for warm seasons, wool and knit for cold seasons), soft natural light, styled flat-lay props at the edges, warm organic fashion-catalog atmosphere.',
    textStyle: 'Lookbook typography — medium refined headline with wide letter-spaced season label, warm neutral ink tones, catalog-page balance in the upper area.',
    defaultTexts: { label: 'SEASON LOOK', title: '{productName}', subtitle: '{salePrice}' },
  },
  {
    id: 'fashion-boutique-spot', name: '부티크 스포트라이트', category: '패션',
    desc: '벨벳·스포트라이트의 럭셔리 부티크', accent: '#5a3a4a',
    scaffold: 'A luxury boutique display scene: deep burgundy velvet drapery, a single dramatic spotlight from above creating a circle of light, dark surroundings, museum-display prestige, subtle dust particles in the light beam.',
    textStyle: 'Prestige typography — slim elegant headline in champagne white, wide-spaced uppercase label, placed inside the calm dark area. Quiet couture confidence.',
    defaultTexts: { label: 'BOUTIQUE', title: '{productName}', subtitle: '' },
  },

  // ══ 미니멀 (4) ═══════════════════════════════════════
  {
    id: 'minimal-stone', name: '스톤 미니멀', category: '미니멀',
    desc: '돌 단상·여백의 정제된 미니멀', accent: '#d8d2c8',
    scaffold: 'A minimal product scene: a single travertine stone pedestal on a soft warm gradient backdrop, generous negative space, subtle glow behind the pedestal, gallery-like stillness.',
    textStyle: 'Quiet minimal typography in warm dark gray, small headline, lots of breathing room — the emptiness is the design.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '{salePrice}' },
  },
  {
    id: 'email-wide-hero', name: '와이드 히어로', category: '미니멀',
    desc: '이메일 상단용 가로 히어로 (16:9 추천)', accent: '#6b7d8a',
    scaffold: 'A wide premium hero banner scene: product placed on one side on an elegant surface, warm ambient interior softly blurred behind, generous empty space on the other side reserved for the headline. Sophisticated e-commerce hero banner.',
    textStyle: 'Left-aligned editorial typography in the empty side: small label, strong headline, light sub-headline. Balanced against the product.',
    defaultTexts: { label: 'ONLINE STORE', title: '{productName}', subtitle: '{salePrice}' },
  },
  {
    id: 'minimal-mono-shadow', name: '모노크롬 롱섀도', category: '미니멀',
    desc: '단색 배경·긴 그림자의 조형적 미니멀', accent: '#c9c3b8',
    scaffold: 'A sculptural minimal scene: one single muted color filling the entire background and floor seamlessly, hard low-angle sunlight casting one long dramatic shadow from the product, nothing else. Architectural stillness, bold emptiness.',
    textStyle: 'Ultra-minimal typography — small precise headline in a darker shade of the background color, tiny label, positioned off-center with deliberate asymmetry.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '' },
  },
  {
    id: 'minimal-paper-geo', name: '페이퍼 지오메트리', category: '미니멀',
    desc: '종이 질감·기하 도형의 아트 미니멀', accent: '#d9cdbf',
    scaffold: 'A paper-art minimal scene: layered paper textures in soft neutral tones, simple geometric shapes (an arch, a circle, a folded plane) composing the backdrop, delicate paper shadows, craft-gallery sophistication.',
    textStyle: 'Graphic minimal typography — clean geometric sans headline, small label aligned to a shape edge, muted ink tone. Design-studio poise.',
    defaultTexts: { label: 'OBJECT', title: '{productName}', subtitle: '{salePrice}' },
  },

  // ══ 시즌 (4) ═════════════════════════════════════════
  {
    id: 'season-auto', name: '이번 시즌 무드', category: '시즌',
    desc: '지금 계절 감성을 자동 반영', accent: '#7ba05b',
    scaffold: 'A seasonal marketing scene that matches the current Korean season, with tasteful seasonal props and atmosphere at the edges, warm commercial styling, product area kept clean.',
    textStyle: 'Seasonal friendly typography with good readability, headline in the upper area, colors harmonized with the seasonal palette.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '{salePrice}' },
    useSeason: true,
  },
  {
    id: 'season-korean-holiday', name: '명절 선물세트', category: '시즌',
    desc: '보자기·전통 문양의 명절 선물 무드', accent: '#a5433d',
    scaffold: 'A Korean traditional holiday gift scene: elegant silk bojagi wrapping cloth in deep red and jade tones, subtle traditional Korean patterns (norigae tassel, dancheong-inspired accents) at the edges, warm hanok wood surface, refined and respectful gift-set atmosphere for Seollal or Chuseok.',
    textStyle: 'Graceful typography with a calligraphic-brush feeling for the headline, deep charcoal or gold ink, small refined label. Traditional yet premium placement in the upper area.',
    defaultTexts: { label: '명절 선물', title: '{productName}', subtitle: '' },
  },
  {
    id: 'season-yearend-festive', name: '연말 페스티브', category: '시즌',
    desc: '트리 라이트·레드&골드의 연말 무드', accent: '#7a2e35',
    scaffold: 'A year-end festive scene: warm bokeh of tree lights in deep green and red, gold ornament accents and pine branches at the edges, soft falling snow hints, cozy celebratory glow, elegant holiday-season retail atmosphere.',
    textStyle: 'Festive elegant typography — warm gold headline with a soft glow, classic small label, celebratory but refined. Holiday-card warmth in the upper area.',
    defaultTexts: { label: 'YEAR END', title: '{productName}', subtitle: '' },
  },
  {
    id: 'season-spring-blossom', name: '벚꽃 스프링', category: '시즌',
    desc: '벚꽃잎·봄빛의 화사한 시즌 무드', accent: '#e6b7c6',
    scaffold: 'A spring cherry-blossom scene: soft pink petals drifting in the air, blurred blossom branches framing the edges, gentle warm spring sunlight, fresh pastel sky tones, light and hopeful new-season atmosphere.',
    textStyle: 'Fresh spring typography — soft deep-rose headline, delicate small label, airy spacing. Light romantic placement in the upper area.',
    defaultTexts: { label: '봄 시즌', title: '{productName}', subtitle: '{salePrice}' },
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
