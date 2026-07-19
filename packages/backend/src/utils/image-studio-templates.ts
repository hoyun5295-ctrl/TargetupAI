/**
 * utils/image-studio-templates.ts — P4 이미지 스튜디오 템플릿 = 은닉 프롬프트 스캐폴드 카탈로그 (2026-07-19 v5 · 58종 — 계절 22종 확장)
 *
 * ★ 재정의(Harold 2026-07-19): 템플릿 = "미리 정교하게 짜둔 이미지 생성 프롬프트".
 *   고객사는 템플릿(예시 스타일) 선택 + 원본 이미지 + 간단 문구만 입력하면,
 *   생성 AI가 [누끼 제품 + 어울리는 배경 + 지정 문구의 고급 타이포]를 한 장의 완성 포스터로 렌더한다.
 *
 * 원칙:
 *  - scaffold(장면 지시)·textStyle(타이포 지시)은 서버 은닉 — listTemplatesPublic에 절대 미포함.
 *  - 문구는 고객사 지정 텍스트를 verbatim 렌더 — AI가 혜택·수치를 지어내지 않는다(금지 지시는 엔진이 부착).
 *  - 템플릿 추가 = 데이터만(코드 무수정). 각 항목은 장면·타이포가 실제로 다른 아트 디렉션이어야 한다(숫자 채우기 금지 — Harold).
 *  - sample = 갤러리 카드 예시 카피(고객 노출 — 템플릿 무드별 실카피, 브랜드 실명·혜택 수치 금지).
 *  - 채널 사이즈(인앱 3:4 / DM 1:1 / 이메일 16:9)는 템플릿과 독립.
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
  /** 갤러리 카드 목업 예시 카피(고객 노출 — 무드별 실카피). */
  sample: { title: string; subtitle?: string };
  /** 시즌 컨텍스트 주입 여부(자동 시즌 템플릿만 true). */
  useSeason?: boolean;
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  // ══ 뷰티 (10) ══════════════════════════════════════════
  {
    id: 'beauty-lux-dark', name: '프리미엄 다크 럭셔리', category: '뷰티',
    desc: '어두운 우드·대리석 위 고급 브랜드 무드', accent: '#3d2b22',
    scaffold: 'A luxurious premium cosmetics campaign scene: dark wood paneled interior, polished black marble vanity counter, warm ambient lamp glow, tasteful props at the edges (a silk scarf, a slim flower vase with a single lily, art books, a small perfume bottle). High-end department store campaign atmosphere, sophisticated and calm, cinematic warm lighting.',
    textStyle: 'Elegant refined typography in warm cream/champagne tone, generous letter spacing for the small label, a large serif-feeling headline, understated sub-headline. Text placed in the upper area with luxury-brand restraint.',
    defaultTexts: { label: 'ONLINE EXCLUSIVE', title: '{productName}', subtitle: '' },
    sample: { title: '깊어지는 밤의 리추얼', subtitle: '프리미엄 케어 컬렉션' },
  },
  {
    id: 'beauty-clean-bright', name: '클린 브라이트 뷰티', category: '뷰티',
    desc: '밝은 베이지·드라이플라워 에디토리얼', accent: '#cbb9a7',
    scaffold: 'A bright high-end cosmetics editorial scene: soft beige seamless backdrop, warm diffuse daylight, delicate dried florals and small ceramic vases at the edges, a clean fabric-textured pedestal surface. Airy, minimal, magazine-quality styling.',
    textStyle: 'Minimal editorial typography in deep warm brown, small uppercase label, medium-weight headline, light sub-headline. Clean placement in the upper third.',
    defaultTexts: { label: 'SIGNATURE', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '맑게, 더 가볍게', subtitle: '데일리 스킨 루틴' },
  },
  {
    id: 'beauty-aqua-fresh', name: '워터 프레시', category: '뷰티',
    desc: '물결·이슬의 수분 세럼 무드', accent: '#7fb8c9',
    scaffold: 'A hydration-focused skincare scene: crystal clear water surface with gentle ripples, dewy droplets on glass, soft aqua and pale blue tones, fresh morning light refracting through water, a wet stone or glass platform for the product. Clean, dewy, ultra-fresh moisture feeling.',
    textStyle: 'Light airy typography in white with a subtle watery glow, thin elegant headline, small tracking-wide label. Fresh and clean placement in the upper area.',
    defaultTexts: { label: 'HYDRATION', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '수분을 머금다', subtitle: '워터 세럼 라인' },
  },
  {
    id: 'beauty-spa-natural', name: '스파 내추럴', category: '뷰티',
    desc: '돌·타월·그린의 스파 릴랙스 무드', accent: '#8a9a83',
    scaffold: 'A serene spa scene: smooth river stones, a rolled cream towel, eucalyptus branches, warm neutral tones with sage green accents, soft steam in the air, natural bamboo or stone surface. Calm wellness sanctuary atmosphere, gentle diffused light.',
    textStyle: 'Calm organic typography in deep sage or warm gray, lowercase-feeling softness, generous breathing room. Quiet spa-menu elegance in the upper area.',
    defaultTexts: { label: 'RELAX & CARE', title: '{productName}', subtitle: '' },
    sample: { title: '쉼이 필요한 피부에게', subtitle: '홈 스파 컬렉션' },
  },
  {
    id: 'beauty-glow-gold', name: '글로우 골드', category: '뷰티',
    desc: '골드 시머·보케의 홀리데이 럭스', accent: '#b98d4f',
    scaffold: 'A glamorous holiday luxury scene: shimmering gold bokeh lights in the background, champagne-gold silk fabric draped on the surface, subtle sparkle particles in the air, warm golden hour glow. Festive premium gift-season atmosphere, opulent but tasteful.',
    textStyle: 'Glamorous typography in bright gold with subtle shine, refined serif-feeling headline, delicate letter-spaced label. Festive luxury placement in the upper area.',
    defaultTexts: { label: 'HOLIDAY EDITION', title: '{productName}', subtitle: '' },
    sample: { title: '빛나는 계절의 선물', subtitle: '홀리데이 리미티드' },
  },
  {
    id: 'beauty-pastel-makeup', name: '파우더 파스텔', category: '뷰티',
    desc: '파우더 번짐의 색조 메이크업 팝', accent: '#e3aab8',
    scaffold: 'A playful color cosmetics scene: soft pastel powder bursts frozen mid-air (blush pink, peach, lavender), a clean pastel seamless backdrop, subtle shimmer dust, smooth acrylic platform for the product. Fresh makeup-brand energy, bright and feminine.',
    textStyle: 'Chic modern typography in deep rose, playful but polished, medium headline with a cute small label. Placed in the upper area with balanced whitespace.',
    defaultTexts: { label: 'NEW COLOR', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '봄빛 새 컬러 출시', subtitle: '파우더 블러셔 라인' },
  },

  {
    id: 'beauty-spring-garden', name: '스프링 가든', category: '뷰티',
    desc: '새싹·튤립 정원의 봄 생기 무드', accent: '#9fc98c',
    scaffold: 'A fresh spring garden skincare scene: young green sprouts and tulip stems around the edges, morning dew on leaves, soft pale-green and butter-yellow light, a clean stone or glass platform among the greenery. Vitamin-fresh new-season vitality, airy and hopeful.',
    textStyle: 'Fresh spring typography in deep leaf green, light clean headline, small uppercase label with wide tracking. Lively but calm placement in the upper area.',
    defaultTexts: { label: 'SPRING CARE', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '봄이 먼저 닿는 피부', subtitle: '스프링 케어 라인' },
  },
  {
    id: 'beauty-summer-cooling', name: '아이스 쿨링', category: '뷰티',
    desc: '얼음 결정·쿨민트의 여름 쿨링 무드', accent: '#6fc6d9',
    scaffold: 'A summer cooling skincare scene: crushed ice and frosted ice cubes scattered on a chilled surface, cool mint and icy blue tones, bright hard summer sunlight with crisp highlights, a frozen acrylic pedestal for the product, tiny frost vapor in the air. Instant-cooling suncare energy, crisp and invigorating.',
    textStyle: 'Crisp cool typography in icy white with a subtle frost edge, bold clean headline, small chilled-blue label. High-summer freshness in the upper area.',
    defaultTexts: { label: 'SUMMER COOLING', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '한여름의 쿨링 처방', subtitle: '서머 쿨링 라인' },
  },
  {
    id: 'beauty-autumn-amber', name: '어텀 앰버', category: '뷰티',
    desc: '앰버·팜파스의 포근한 가을 보습 무드', accent: '#a9683b',
    scaffold: 'A warm autumn skincare scene: amber and terracotta tones, dried pampas grass and cinnamon-toned leaves at the edges, soft knit fabric draped on the surface, low golden dusk light with long gentle shadows. Deep-moisture comfort of the season, cozy and mature.',
    textStyle: 'Warm autumn typography in deep amber brown, serif-feeling medium headline, small letter-spaced label. Calm seasonal warmth in the upper area.',
    defaultTexts: { label: 'AUTUMN CARE', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '깊어지는 계절의 보습', subtitle: '어텀 케어 라인' },
  },
  {
    id: 'beauty-winter-frost', name: '윈터 프로스트', category: '뷰티',
    desc: '성에·설원 실버블루의 겨울 리페어 무드', accent: '#9db4c9',
    scaffold: 'A winter repair skincare scene: frosted glass panel with delicate ice crystal patterns, fine snow dust on a pale surface, cool silver-blue and soft white tones, quiet overcast winter light, a single frozen branch at the edge. Protective calm against the cold, serene and pristine.',
    textStyle: 'Serene winter typography in cool deep slate blue, thin elegant headline, tiny frost-white label. Quiet pristine placement in the upper area.',
    defaultTexts: { label: 'WINTER REPAIR', title: '{productName}', subtitle: '' },
    sample: { title: '혹한에도 무너지지 않게', subtitle: '윈터 리페어 라인' },
  },

  // ══ 카페·음료 (8) ═════════════════════════════════════
  {
    id: 'cafe-wood-natural', name: '우드 내추럴 카페', category: '카페·음료',
    desc: '원목·자연광의 따뜻한 카페 무드', accent: '#8a6d52',
    scaffold: 'A cozy specialty cafe scene: warm wooden table, soft natural window light from the front, subtle green plant and linen napkin at the edges, gentle steam or freshness in the air. Inviting artisan coffee shop atmosphere.',
    textStyle: 'Warm friendly typography in cream white with a soft shadow for readability, hand-crafted cafe menu feel, headline prominent in the upper area.',
    defaultTexts: { label: 'NEW DRINK', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '갓 내린 시그니처 라떼', subtitle: '오늘부터 만나보세요' },
  },
  {
    id: 'cafe-summer-pool', name: '시원한 섬머 블루', category: '카페·음료',
    desc: '물결·청량감의 여름 음료 포스터', accent: '#3aa7d9',
    scaffold: 'A refreshing summer beverage scene: sparkling clear water surface with sunlight caustics, bright sky blue tones, ice cubes and a splash of freshness, maybe watermelon or citrus slices floating at the edges. Cool, thirst-quenching, vibrant summer energy.',
    textStyle: 'Playful bold typography in white and deep blue with strong contrast, energetic summer-sale poster feel, headline large in the upper area.',
    defaultTexts: { label: '여름 한정', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '청량하게 여름 나기', subtitle: '시원한 신메뉴 3종' },
  },
  {
    id: 'cafe-deep-roast', name: '딥 로스트', category: '카페·음료',
    desc: '에스프레소·원두의 진한 다크 무드', accent: '#4a3227',
    scaffold: 'A rich dark coffee scene: scattered roasted coffee beans, deep espresso brown tones, dramatic side lighting with warm highlights, slow steam rising, dark slate or walnut surface. Intense artisan roastery atmosphere, moody and premium.',
    textStyle: 'Strong confident typography in warm cream on the dark background, bold headline with tight kerning, small caps label. Roastery craft-brand feel in the upper area.',
    defaultTexts: { label: 'DEEP ROAST', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '진하게 내린 한 잔', subtitle: '스페셜티 원두 블렌드' },
  },
  {
    id: 'cafe-brunch-morning', name: '브런치 모닝', category: '카페·음료',
    desc: '아침광 테이블의 밝은 브런치 무드', accent: '#d9b98a',
    scaffold: 'A bright weekend brunch scene: white marble or light oak table, morning sunlight with soft long shadows, fresh flowers in a small vase, croissant and linen at the edges, airy and cheerful. Fresh morning-cafe lifestyle atmosphere.',
    textStyle: 'Light cheerful typography in soft charcoal, friendly rounded feel, medium headline with a small welcoming label. Bright morning-menu placement in the upper area.',
    defaultTexts: { label: 'MORNING SET', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '주말 아침의 브런치', subtitle: '모닝 세트 출시' },
  },
  {
    id: 'cafe-dessert-sweet', name: '디저트 스위트', category: '카페·음료',
    desc: '베이커리 쇼케이스의 달콤한 무드', accent: '#c98a6d',
    scaffold: 'A sweet bakery dessert scene: warm caramel and cream tones, soft powdered sugar dust in the air, elegant cake stand or wooden board, blurred bakery showcase lights in the background. Tempting patisserie atmosphere, warm and indulgent.',
    textStyle: 'Sweet inviting typography in chocolate brown and cream, slightly rounded headline, dainty small label. Patisserie-menu charm in the upper area.',
    defaultTexts: { label: 'SWEET PICK', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '오늘의 달콤한 한 조각', subtitle: '시즌 디저트 신메뉴' },
  },
  {
    id: 'cafe-winter-cozy', name: '윈터 코지', category: '카페·음료',
    desc: '니트·온기의 겨울 시즌 음료', accent: '#8c5a4f',
    scaffold: 'A cozy winter cafe scene: chunky knit fabric and warm plaid at the edges, gentle snowfall visible through a window behind, warm string lights bokeh, rising steam, cinnamon sticks and pine sprigs as subtle props. Heartwarming winter-holiday cafe atmosphere.',
    textStyle: 'Warm cozy typography in cream with a soft glow, gentle rounded headline, festive small label. Comforting winter-menu placement in the upper area.',
    defaultTexts: { label: '겨울 한정', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '따뜻함을 담은 겨울 메뉴', subtitle: '시즌 음료 출시' },
  },

  {
    id: 'cafe-spring-blossom-terrace', name: '벚꽃 테라스', category: '카페·음료',
    desc: '벚꽃 가지 아래 봄 테라스 무드', accent: '#dfa8b6',
    scaffold: 'A spring cafe terrace scene: an outdoor pastel table under blooming cherry-blossom branches, a few petals resting on the table, soft spring breeze feeling, warm afternoon light through the blossoms, blurred park greenery behind. First-warm-day terrace atmosphere, romantic and light.',
    textStyle: 'Light spring typography in soft rose-brown, gentle rounded headline, petal-delicate small label. Airy placement in the upper area.',
    defaultTexts: { label: '봄 시즌', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '벚꽃 아래 첫 모금', subtitle: '스프링 시즌 메뉴' },
  },
  {
    id: 'cafe-autumn-maple', name: '단풍 어텀 카페', category: '카페·음료',
    desc: '단풍·담요·라떼 스팀의 가을 카페 무드', accent: '#c07840',
    scaffold: 'An autumn cafe scene: maple and ginkgo leaves in deep red and gold scattered at the edges, a plaid wool blanket folded on a wooden bench-table, warm latte steam rising, golden late-afternoon sunlight, crisp autumn-air clarity. Sweater-weather cafe comfort, rich and nostalgic.',
    textStyle: 'Cozy autumn typography in warm chestnut brown on cream, medium friendly headline, small leaf-toned label. Comforting seasonal-menu placement in the upper area.',
    defaultTexts: { label: '가을 한정', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '가을을 마시는 시간', subtitle: '어텀 시즌 메뉴' },
  },

  // ══ 신메뉴·팝 (9) ═════════════════════════════════════
  {
    id: 'pop-retro-block', name: '레트로 팝 색블록', category: '신메뉴·팝',
    desc: '체커보드·원색 대비의 임팩트 팝', accent: '#2b2f77',
    scaffold: 'A bold retro pop-art promotional scene: strong flat color blocks (deep blue, warm red, yellow), checkerboard pattern accents at the edges, diagonal banner energy, playful vintage Korean street poster vibe. High contrast, fun, eye-catching.',
    textStyle: 'Thick bold display typography with strong outlines, mixed scale composition like a retro Korean poster, badge-like small label. Text is a main design element.',
    defaultTexts: { label: '신메뉴 등장!', title: '{productName}', subtitle: '' },
    sample: { title: '역대급 신메뉴 출시', subtitle: '지금 바로 만나보세요' },
  },
  {
    id: 'pop-cute-pastel', name: '파스텔 큐트 팝', category: '신메뉴·팝',
    desc: '파스텔 톤의 귀엽고 산뜻한 팝', accent: '#f5a8c0',
    scaffold: 'A cute pastel promotional scene: soft pink and cream color background with simple rounded shapes, small confetti or sticker-like accents, sweet dessert-shop energy, clean and adorable.',
    textStyle: 'Rounded friendly typography in deep rose and white, cute badge label, cheerful and approachable feel.',
    defaultTexts: { label: 'NEW', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '귀여움 가득 신상', subtitle: '달콤한 새 메뉴' },
  },
  {
    id: 'pop-neon-night', name: '네온 나이트', category: '신메뉴·팝',
    desc: '네온사인·야간의 야식·배달 무드', accent: '#c33fa0',
    scaffold: 'A vibrant neon night scene: dark urban background with glowing neon sign shapes (pink, cyan, purple), wet street light reflections, late-night delivery-food energy, electric and appetizing. Bold nightlife promotional atmosphere.',
    textStyle: 'Neon-glow typography — bright pink or cyan with luminous edges on the dark background, energetic bold headline, small glowing label. Night-market sign energy.',
    defaultTexts: { label: '야식 추천', title: '{productName}', subtitle: '' },
    sample: { title: '오늘 밤은 이 메뉴', subtitle: '늦은 밤에도 배달' },
  },
  {
    id: 'pop-comic-burst', name: '코믹 팝', category: '신메뉴·팝',
    desc: '만화 효과·하프톤의 유쾌한 팝', accent: '#e8b23a',
    scaffold: 'A comic-book style promotional scene: halftone dot patterns, dynamic burst and starburst shapes, bold primary colors (yellow, red, blue), speech-bubble energy, playful cartoon action feel. Fun and loud pop-art composition.',
    textStyle: 'Comic display typography — chunky headline with thick outline like a cartoon sound effect, tilted for energy, badge label in a burst shape. Loud and playful.',
    defaultTexts: { label: 'WOW!', title: '{productName}', subtitle: '' },
    sample: { title: '이 맛에 다들 놀람', subtitle: '신메뉴 강력 추천' },
  },
  {
    id: 'pop-vintage-print', name: '빈티지 인쇄 광고', category: '신메뉴·팝',
    desc: '옛 신문·전단 감성의 레트로 인쇄', accent: '#c9b78a',
    scaffold: 'A vintage Korean print-advertisement scene: aged cream paper texture, retro ornamental border frames, muted ink tones (faded red, navy, sepia), old-fashioned promotional flyer layout energy, nostalgic charm of decades-old newspaper ads.',
    textStyle: 'Vintage print typography — classic serif-feeling headline like old letterpress, decorative small label inside a simple ornament frame, slightly imperfect ink texture.',
    defaultTexts: { label: '오늘의 추천', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '옛날 그 맛 그대로', subtitle: '전통의 인기 메뉴' },
  },

  {
    id: 'pop-strawberry-season', name: '딸기 시즌 팝', category: '신메뉴·팝',
    desc: '딸기 레드·크림의 상큼한 시즌 팝', accent: '#e25864',
    scaffold: 'A strawberry-season promotional scene: fresh strawberry red and soft cream color blocks, playful strawberry and cream-swirl graphic shapes bouncing around the edges, tiny seed-dot pattern accents, juicy and adorable dessert-season energy. Bright, sweet, irresistible.',
    textStyle: 'Juicy playful typography — bold rounded headline in cream white with a strawberry-red outline, cute fruit-badge label. Sweet and punchy composition.',
    defaultTexts: { label: '딸기 시즌', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '새콤달콤 시즌 오픈', subtitle: '딸기 신메뉴 모음' },
  },
  {
    id: 'pop-tropical-sunset', name: '트로피컬 썸머 팝', category: '신메뉴·팝',
    desc: '야자수·선셋 그라디언트의 여름 팝', accent: '#f08a3c',
    scaffold: 'A retro tropical summer promotional scene: bold sunset gradient background (coral orange to pink to violet), black palm-leaf silhouettes framing the corners, retro sun rays and tiny pineapple or citrus graphic accents, 80s beach-resort poster energy. Vibrant vacation excitement.',
    textStyle: 'Retro summer typography — thick display headline in warm white with a sunset-pink shadow, wave-shaped small label. Holiday-poster boldness.',
    defaultTexts: { label: '여름 한정', title: '{productName}', subtitle: '' },
    sample: { title: '한 입의 바캉스', subtitle: '트로피컬 신메뉴' },
  },
  {
    id: 'pop-halloween-night', name: '핼러윈 팝', category: '신메뉴·팝',
    desc: '펌킨 오렌지·바이올렛의 유쾌한 핼러윈 팝', accent: '#8a4fc9',
    scaffold: 'A playful halloween promotional scene: deep violet night background with pumpkin-orange accents, cute sticker-style bats, pumpkins and candy shapes floating around the edges, a mischievous crescent moon glow, spooky-cute trick-or-treat energy — fun, never scary.',
    textStyle: 'Spooky-fun typography — chunky headline in pumpkin orange with a wobbly hand-drawn feel, small bat-badge label in violet. Mischievous party energy.',
    defaultTexts: { label: 'HALLOWEEN', title: '{productName}', subtitle: '' },
    sample: { title: '오싹하게 맛있는 밤', subtitle: '핼러윈 한정 메뉴' },
  },
  {
    id: 'pop-christmas-toy', name: '크리스마스 토이 팝', category: '신메뉴·팝',
    desc: '캔디케인·진저브레드의 신나는 성탄 팝', accent: '#cf4436',
    scaffold: 'A cheerful christmas toy-shop promotional scene: bright flat red and pine green color blocks, playful candy canes, gingerbread and gift-box sticker graphics tumbling around the edges, white snow-dot confetti, jolly cartoon holiday-market energy. Loud, warm and merry.',
    textStyle: 'Merry bouncy typography — bold headline in snow white with a christmas-red outline, ribbon-tag small label in green. Festive toy-package fun.',
    defaultTexts: { label: '크리스마스', title: '{productName}', subtitle: '' },
    sample: { title: '메리 딜리셔스', subtitle: '홀리데이 신메뉴' },
  },

  // ══ 세일·이벤트 (10) ═══════════════════════════════════
  {
    id: 'sale-bold-impact', name: '볼드 세일 임팩트', category: '세일·이벤트',
    desc: '큰 숫자·강한 대비의 세일 포스터', accent: '#e2483d',
    scaffold: 'A high-impact sale campaign scene: bold red and deep blue color energy, dynamic diagonal composition, celebratory confetti or percent-tag graphic accents around the edges, urgent shopping-festival atmosphere.',
    textStyle: 'Very large ultra-bold sale typography as the hero element, white with red accents and strong outline, the discount headline dominates the composition.',
    defaultTexts: { label: '기간 한정', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
    sample: { title: '놓치면 후회할 특가', subtitle: '이번 주만 이 가격' },
  },
  {
    id: 'sale-elegant-event', name: '엘레강트 이벤트', category: '세일·이벤트',
    desc: '고급스러운 절제된 프로모션', accent: '#b9a06b',
    scaffold: 'An elegant premium promotion scene: deep charcoal background with subtle gold light streaks, refined celebratory mood without clutter, luxury gift atmosphere, soft spotlight on the product area.',
    textStyle: 'Refined gold-tone typography, generous spacing, understated luxury promotion feel — quiet confidence rather than loud sale energy.',
    defaultTexts: { label: 'SPECIAL OFFER', title: '{productName}', subtitle: '[혜택은 직접 입력해주세요]' },
    sample: { title: '특별한 혜택의 시간', subtitle: '프리미엄 프로모션' },
  },
  {
    id: 'sale-black-gold', name: '블랙 & 골드 특가', category: '세일·이벤트',
    desc: '블랙 배경·골드 대형 숫자의 특가', accent: '#1a1a1a',
    scaffold: 'A premium black-sale campaign scene: deep matte black background, dramatic gold light rays and fine gold particle dust, sleek reflective black surface for the product, high-tension shopping event atmosphere like a year-end mega sale.',
    textStyle: 'Massive metallic-gold typography on black — the offer headline is the hero, tight bold letters with a subtle metallic sheen, small white label above. Maximum contrast and prestige.',
    defaultTexts: { label: 'BLACK SALE', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
    sample: { title: '일 년에 단 한 번', subtitle: '최대 혜택의 밤' },
  },
  {
    id: 'sale-festa-gift', name: '쇼핑 페스타', category: '세일·이벤트',
    desc: '선물상자·풍선·콘페티의 축제 무드', accent: '#d94f7e',
    scaffold: 'A festive shopping-festival scene: colorful gift boxes with ribbons stacked at the edges, floating balloons, falling confetti, bright celebratory pastel-vivid palette, joyful department-store event energy.',
    textStyle: 'Festive bouncy typography — bright white headline with a colorful drop shadow, ribbon-like label banner, celebratory and generous. Joyful event-poster placement.',
    defaultTexts: { label: 'SHOPPING FESTA', title: '{productName}', subtitle: '[혜택은 직접 입력해주세요]' },
    sample: { title: '설레는 쇼핑 축제', subtitle: '선물 같은 혜택 가득' },
  },
  {
    id: 'sale-time-urgent', name: '타임 세일', category: '세일·이벤트',
    desc: '시계·사선 스트라이프의 긴박한 특가', accent: '#e8842e',
    scaffold: 'An urgent flash-sale scene: bold diagonal warning stripes (orange and black) at the edges, a subtle large clock face motif in the background, spotlight beam on the product area, high-urgency limited-time energy.',
    textStyle: 'Urgent condensed typography — tall bold headline slightly italicized for speed, stopwatch-feeling small label, strong white-on-orange contrast. Countdown tension.',
    defaultTexts: { label: '오늘만', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
    sample: { title: '단 하루, 타임 세일', subtitle: '마감 전 서두르세요' },
  },
  {
    id: 'sale-thanks-warm', name: '단골 감사제', category: '세일·이벤트',
    desc: '리본·따뜻한 톤의 고객 감사 이벤트', accent: '#b0714f',
    scaffold: 'A warm customer-appreciation scene: soft terracotta and cream tones, a gentle satin ribbon across the lower edge, warm side light like late afternoon, small heartfelt props (a handwritten-style card, dried flowers). Sincere thank-you event atmosphere.',
    textStyle: 'Warm sincere typography in deep brown, gentle serif-feeling headline, handwritten-warmth small label. Grateful and personal, placed with calm balance.',
    defaultTexts: { label: '고객 감사제', title: '{productName}', subtitle: '[혜택은 직접 입력해주세요]' },
    sample: { title: '고마운 마음을 담아', subtitle: '단골님께 드리는 혜택' },
  },

  {
    id: 'sale-spring-renewal', name: '봄맞이 세일', category: '세일·이벤트',
    desc: '꽃잎 콘페티·파스텔의 새단장 세일', accent: '#8fbf6f',
    scaffold: 'A spring renewal sale scene: fresh pastel green and blossom-pink palette, flower-petal confetti drifting down, light ribbon streamers at the top corners, bright clean daylight, new-beginning shopping energy. Cheerful seasonal refresh atmosphere.',
    textStyle: 'Bright spring sale typography — bold friendly headline in deep green with white highlights, petal-badge small label. Energetic but fresh, dominating the upper area.',
    defaultTexts: { label: '봄맞이 특가', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
    sample: { title: '새 계절, 새 단장 세일', subtitle: '봄맞이 특별 혜택' },
  },
  {
    id: 'sale-summer-splash', name: '썸머 스플래시 세일', category: '세일·이벤트',
    desc: '물보라·파라솔 그래픽의 시원한 특가', accent: '#1f86c9',
    scaffold: 'A splashy summer sale scene: dynamic clear-water splash frozen mid-air, bold cool blue with coral accents, playful parasol and watermelon-slice graphic elements at the edges, strong beach-festival sale energy, bright high-noon light. Refreshing and loud.',
    textStyle: 'Splash-bold typography — very large tilted headline in white with a deep blue outline and water-drop accents, sunburst small label. Maximum summer impact.',
    defaultTexts: { label: '여름 특가', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
    sample: { title: '뜨거운 여름, 시원한 가격', subtitle: '서머 빅세일' },
  },
  {
    id: 'sale-season-off', name: '시즌 오프', category: '세일·이벤트',
    desc: '행잉랙·택 모티프의 시즌오프 클리어런스', accent: '#8c7a5f',
    scaffold: 'A season-off clearance scene: warm neutral studio backdrop with a minimalist clothing rack silhouette and kraft-paper hang tags as graphic motifs, soft editorial light, calm sophisticated end-of-season mood with a clear promotional focus. Understated but urgent.',
    textStyle: 'Editorial sale typography — large refined headline in deep charcoal, a kraft-tag shaped small label, generous spacing. Fashion-outlet elegance with clear sale intent.',
    defaultTexts: { label: 'SEASON OFF', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
    sample: { title: '이번 시즌 마지막 기회', subtitle: '시즌 오프 클리어런스' },
  },
  {
    id: 'sale-winter-ice', name: '윈터 아이스 세일', category: '세일·이벤트',
    desc: '얼음 결정·아이스블루의 겨울 파이널 세일', accent: '#5b8fc9',
    scaffold: 'A winter clearance sale scene: crisp ice-blue palette with frost crystal patterns creeping from the corners, a frozen-glass price-tag motif, cool white spotlight on the product area, sharp wintry sparkle in the air. Cold colors, hot deal tension.',
    textStyle: 'Frozen-bold typography — massive headline in icy white with a frosted blue edge, snowflake-accent small label. Strong winter-sale contrast in the upper area.',
    defaultTexts: { label: '겨울 특가', title: '[혜택은 직접 입력해주세요]', subtitle: '' },
    sample: { title: '꽁꽁 얼린 겨울 가격', subtitle: '윈터 파이널 세일' },
  },

  // ══ 패션 (9) ═════════════════════════════════════════
  {
    id: 'fashion-studio-clean', name: '스튜디오 클린', category: '패션',
    desc: '뉴트럴 배경의 미니멀 스튜디오컷', accent: '#9a9a9a',
    scaffold: 'A clean fashion campaign scene: neutral gray seamless studio backdrop, soft directional light with gentle shadow, minimal modern styling, premium lookbook atmosphere.',
    textStyle: 'Modern sans-serif typography in white or black depending on contrast, small tracking-wide label, confident medium headline. Fashion lookbook restraint.',
    defaultTexts: { label: 'COLLECTION', title: '{productName}', subtitle: '' },
    sample: { title: '새 계절의 실루엣', subtitle: '신상 컬렉션 공개' },
  },
  {
    id: 'fashion-street-urban', name: '스트리트 어반', category: '패션',
    desc: '콘크리트·도시 그림자의 스트리트 무드', accent: '#6b6f75',
    scaffold: 'An urban streetwear scene: raw concrete wall with hard sunlight and sharp diagonal shadows, asphalt texture below, city atmosphere with a hint of chain-link or metal edge, cool tones with one warm light accent. Bold street-culture energy.',
    textStyle: 'Street-style typography — heavy condensed headline like stencil or poster paste-up, small tag-like label, high contrast white or black. Raw and confident.',
    defaultTexts: { label: 'STREET', title: '{productName}', subtitle: '' },
    sample: { title: '거리를 입다', subtitle: '스트리트 신상 드롭' },
  },
  {
    id: 'fashion-magazine-serif', name: '매거진 에디토리얼', category: '패션',
    desc: '화이트 지면·대형 세리프의 잡지 표지', accent: '#e8e6e1',
    scaffold: 'A high-fashion magazine editorial scene: clean off-white studio space like a magazine page, one dramatic soft shadow, minimal styling with a single elegant prop (a chair edge or fabric drape), sophisticated whitespace-driven composition.',
    textStyle: 'Editorial masthead typography — very large elegant serif headline like a fashion magazine cover, tiny caption-style label and subtitle, black ink on white. The type IS the design.',
    defaultTexts: { label: 'EDITION', title: '{productName}', subtitle: '' },
    sample: { title: 'The New Classic', subtitle: '에디토리얼 컬렉션' },
  },
  {
    id: 'fashion-season-lookbook', name: '시즌 룩북', category: '패션',
    desc: '계절 소재·텍스처 배경의 룩북 컷', accent: '#a8917a',
    scaffold: 'A seasonal fashion lookbook scene: natural seasonal textures as the backdrop (linen and rattan for warm seasons, wool and knit for cold seasons), soft natural light, styled flat-lay props at the edges, warm organic fashion-catalog atmosphere.',
    textStyle: 'Lookbook typography — medium refined headline with wide letter-spaced season label, warm neutral ink tones, catalog-page balance in the upper area.',
    defaultTexts: { label: 'SEASON LOOK', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '계절을 담은 룩북', subtitle: '이번 시즌 스타일링' },
  },
  {
    id: 'fashion-boutique-spot', name: '부티크 스포트라이트', category: '패션',
    desc: '벨벳·스포트라이트의 럭셔리 부티크', accent: '#5a3a4a',
    scaffold: 'A luxury boutique display scene: deep burgundy velvet drapery, a single dramatic spotlight from above creating a circle of light, dark surroundings, museum-display prestige, subtle dust particles in the light beam.',
    textStyle: 'Prestige typography — slim elegant headline in champagne white, wide-spaced uppercase label, placed inside the calm dark area. Quiet couture confidence.',
    defaultTexts: { label: 'BOUTIQUE', title: '{productName}', subtitle: '' },
    sample: { title: '단 하나의 순간을 위해', subtitle: '프리미엄 라인' },
  },

  {
    id: 'fashion-spring-outing', name: '스프링 아우팅', category: '패션',
    desc: '꽃핀 정원길·봄 햇살의 야외 화보 무드', accent: '#c5d3a0',
    scaffold: 'A spring outdoor fashion editorial scene: a garden path with blooming shrubs and soft green haze, gentle warm sunlight with a light lens glow, fresh air feeling, natural depth of field like an outdoor lookbook shoot. Light, breezy new-season romance.',
    textStyle: 'Breezy editorial typography — light serif-feeling headline in deep moss green, small airy label with wide tracking. Natural catalog placement in the upper area.',
    defaultTexts: { label: 'S/S', title: '{productName}', subtitle: '' },
    sample: { title: '봄바람을 걸치다', subtitle: 'S/S 컬렉션' },
  },
  {
    id: 'fashion-summer-resort', name: '썸머 리조트', category: '패션',
    desc: '백사장·터쿼이즈 바다의 바캉스 화보 무드', accent: '#4fb8c4',
    scaffold: 'A summer resort fashion scene: white sand beach with a turquoise sea horizon, sharp midday sun and clean shadows, a hint of palm shade at one edge, minimal resort-hotel elegance like a vacation campaign shoot. Sun-soaked freedom, premium vacance mood.',
    textStyle: 'Resort typography — clean white headline with strong legibility against the bright scene, tiny nautical-spaced label. Effortless luxury in the upper area.',
    defaultTexts: { label: 'VACANCE', title: '{productName}', subtitle: '' },
    sample: { title: '여름의 목적지', subtitle: '리조트 컬렉션' },
  },
  {
    id: 'fashion-autumn-city', name: '어텀 시티', category: '패션',
    desc: '은행나무 가로수길·트렌치 무드의 가을 화보', accent: '#b8863f',
    scaffold: 'An autumn city fashion scene: a tree-lined avenue with golden ginkgo leaves, fallen leaves on the pavement, warm low afternoon sun flaring softly between buildings, trench-coat-weather atmosphere like a street-style editorial. Cinematic urban autumn.',
    textStyle: 'City editorial typography — confident medium serif headline in dark espresso, small classic label. Timeless autumn-campaign placement in the upper area.',
    defaultTexts: { label: 'F/W', title: '{productName}', subtitle: '' },
    sample: { title: '가을의 온도를 입다', subtitle: 'F/W 컬렉션' },
  },
  {
    id: 'fashion-winter-snow', name: '윈터 스노우 시티', category: '패션',
    desc: '눈 내리는 저녁 거리·가로등 불빛의 겨울 화보', accent: '#7d8ba0',
    scaffold: 'A winter city fashion scene: softly falling snow on a quiet evening street, warm streetlamp glow against cool blue dusk, faint breath-fog in the cold air, wool-coat season atmosphere like a winter campaign film still. Elegant, cinematic warmth in the cold.',
    textStyle: 'Winter campaign typography — slim elegant headline in warm ivory glowing gently against the dusk, small refined label. Quiet cinematic placement in the upper area.',
    defaultTexts: { label: 'WINTER', title: '{productName}', subtitle: '' },
    sample: { title: '겨울을 입는 방법', subtitle: '윈터 컬렉션' },
  },

  // ══ 미니멀 (8) ═══════════════════════════════════════
  {
    id: 'minimal-stone', name: '스톤 미니멀', category: '미니멀',
    desc: '돌 단상·여백의 정제된 미니멀', accent: '#d8d2c8',
    scaffold: 'A minimal product scene: a single travertine stone pedestal on a soft warm gradient backdrop, generous negative space, subtle glow behind the pedestal, gallery-like stillness.',
    textStyle: 'Quiet minimal typography in warm dark gray, small headline, lots of breathing room — the emptiness is the design.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '본질에 집중하다', subtitle: '미니멀 컬렉션' },
  },
  {
    id: 'email-wide-hero', name: '와이드 히어로', category: '미니멀',
    desc: '이메일 상단용 가로 히어로 (16:9 추천)', accent: '#6b7d8a',
    scaffold: 'A wide premium hero banner scene: product placed on one side on an elegant surface, warm ambient interior softly blurred behind, generous empty space on the other side reserved for the headline. Sophisticated e-commerce hero banner.',
    textStyle: 'Left-aligned editorial typography in the empty side: small label, strong headline, light sub-headline. Balanced against the product.',
    defaultTexts: { label: 'ONLINE STORE', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '새로워진 컬렉션', subtitle: '지금 만나보세요' },
  },
  {
    id: 'minimal-mono-shadow', name: '모노크롬 롱섀도', category: '미니멀',
    desc: '단색 배경·긴 그림자의 조형적 미니멀', accent: '#c9c3b8',
    scaffold: 'A sculptural minimal scene: one single muted color filling the entire background and floor seamlessly, hard low-angle sunlight casting one long dramatic shadow from the product, nothing else. Architectural stillness, bold emptiness.',
    textStyle: 'Ultra-minimal typography — small precise headline in a darker shade of the background color, tiny label, positioned off-center with deliberate asymmetry.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '' },
    sample: { title: '단순함의 힘' },
  },
  {
    id: 'minimal-paper-geo', name: '페이퍼 지오메트리', category: '미니멀',
    desc: '종이 질감·기하 도형의 아트 미니멀', accent: '#d9cdbf',
    scaffold: 'A paper-art minimal scene: layered paper textures in soft neutral tones, simple geometric shapes (an arch, a circle, a folded plane) composing the backdrop, delicate paper shadows, craft-gallery sophistication.',
    textStyle: 'Graphic minimal typography — clean geometric sans headline, small label aligned to a shape edge, muted ink tone. Design-studio poise.',
    defaultTexts: { label: 'OBJECT', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '형태가 말하는 것', subtitle: '디자인 컬렉션' },
  },

  {
    id: 'minimal-spring-branch', name: '블로썸 브랜치', category: '미니멀',
    desc: '여백 속 벚꽃 가지 하나의 봄 미니멀', accent: '#e3c3cb',
    scaffold: 'A minimal spring scene: one single cherry-blossom branch entering the frame from a corner, vast warm-white negative space, a few petals resting near the product, soft even daylight. Serene spring stillness — the emptiness holds the season.',
    textStyle: 'Delicate minimal typography — small precise headline in muted rose-gray, generous emptiness around the text. Whisper-quiet spring elegance.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '봄의 한 조각' },
  },
  {
    id: 'minimal-summer-pool', name: '풀사이드 미니멀', category: '미니멀',
    desc: '풀 타일·물그림자의 정적인 여름 미니멀', accent: '#8fc4cf',
    scaffold: 'A minimal summer poolside scene: pale aqua pool tiles with rippling water-light caustics dancing across the surface, one clean shadow edge, nothing else but sun and stillness. Silent summer noon, architectural calm.',
    textStyle: 'Still minimal typography — small clean headline in deep teal, positioned in a calm corner of light. Quiet as a summer noon.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '고요한 여름' },
  },
  {
    id: 'minimal-autumn-leaf', name: '어텀 리프', category: '미니멀',
    desc: '낙엽 한 장·긴 그림자의 가을 미니멀', accent: '#c9a06b',
    scaffold: 'A minimal autumn scene: a single perfect dry leaf resting on a warm beige paper-textured surface, one long low-sun shadow, faint kraft warmth in the light, everything else empty. The whole season in one leaf.',
    textStyle: 'Warm minimal typography — small serif-feeling headline in deep umber, asymmetric quiet placement. Contemplative autumn restraint.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '' },
    sample: { title: '가을의 결' },
  },
  {
    id: 'minimal-winter-still', name: '스노우 스틸니스', category: '미니멀',
    desc: '눈 입자·프로스트의 고요한 겨울 미니멀', accent: '#c3ccd6',
    scaffold: 'A minimal winter scene: a field of fine untouched snow grain in pale gray-blue, one delicate frost crystal detail near the product, hushed overcast light, absolute stillness. Winter reduced to its quietest essence.',
    textStyle: 'Hushed minimal typography — tiny precise headline in cool graphite, floating in the pale emptiness. Snow-silence elegance.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '' },
    sample: { title: '겨울의 고요' },
  },

  // ══ 시즌 (4) ═════════════════════════════════════════
  {
    id: 'season-auto', name: '이번 시즌 무드', category: '시즌',
    desc: '지금 계절 감성을 자동 반영', accent: '#7ba05b',
    scaffold: 'A seasonal marketing scene that matches the current Korean season, with tasteful seasonal props and atmosphere at the edges, warm commercial styling, product area kept clean.',
    textStyle: 'Seasonal friendly typography with good readability, headline in the upper area, colors harmonized with the seasonal palette.',
    defaultTexts: { label: '', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '지금 계절의 제안', subtitle: '시즌 추천' },
    useSeason: true,
  },
  {
    id: 'season-korean-holiday', name: '명절 선물세트', category: '시즌',
    desc: '보자기·전통 문양의 명절 선물 무드', accent: '#a5433d',
    scaffold: 'A Korean traditional holiday gift scene: elegant silk bojagi wrapping cloth in deep red and jade tones, subtle traditional Korean patterns (norigae tassel, dancheong-inspired accents) at the edges, warm hanok wood surface, refined and respectful gift-set atmosphere for Seollal or Chuseok.',
    textStyle: 'Graceful typography with a calligraphic-brush feeling for the headline, deep charcoal or gold ink, small refined label. Traditional yet premium placement in the upper area.',
    defaultTexts: { label: '명절 선물', title: '{productName}', subtitle: '' },
    sample: { title: '마음을 전하는 선물', subtitle: '명절 선물세트' },
  },
  {
    id: 'season-yearend-festive', name: '연말 페스티브', category: '시즌',
    desc: '트리 라이트·레드&골드의 연말 무드', accent: '#7a2e35',
    scaffold: 'A year-end festive scene: warm bokeh of tree lights in deep green and red, gold ornament accents and pine branches at the edges, soft falling snow hints, cozy celebratory glow, elegant holiday-season retail atmosphere.',
    textStyle: 'Festive elegant typography — warm gold headline with a soft glow, classic small label, celebratory but refined. Holiday-card warmth in the upper area.',
    defaultTexts: { label: 'YEAR END', title: '{productName}', subtitle: '' },
    sample: { title: '한 해의 마무리 선물', subtitle: '연말 스페셜' },
  },
  {
    id: 'season-spring-blossom', name: '벚꽃 스프링', category: '시즌',
    desc: '벚꽃잎·봄빛의 화사한 시즌 무드', accent: '#e6b7c6',
    scaffold: 'A spring cherry-blossom scene: soft pink petals drifting in the air, blurred blossom branches framing the edges, gentle warm spring sunlight, fresh pastel sky tones, light and hopeful new-season atmosphere.',
    textStyle: 'Fresh spring typography — soft deep-rose headline, delicate small label, airy spacing. Light romantic placement in the upper area.',
    defaultTexts: { label: '봄 시즌', title: '{productName}', subtitle: '{salePrice}' },
    sample: { title: '봄, 새로움이 피다', subtitle: '스프링 컬렉션' },
  },
];

export function getTemplate(id: string): StudioTemplate | undefined {
  return STUDIO_TEMPLATES.find((t) => t.id === id);
}

/** 갤러리용 공개 목록 — ★scaffold·textStyle(은닉 프롬프트) 절대 미포함. */
export function listTemplatesPublic() {
  return STUDIO_TEMPLATES.map((t) => ({
    id: t.id, name: t.name, category: t.category, desc: t.desc, accent: t.accent,
    exampleUrl: t.exampleUrl || null, defaultTexts: t.defaultTexts, sample: t.sample,
  }));
}

/** {productName}/{salePrice} 토큰 치환 — 몰 실데이터(사용자 수정 가능·임의 혜택 아님). */
export function fillTextTokens(text: string, data: { productName?: string | null; salePrice?: string | null }): string {
  return (text || '')
    .replace(/\{productName\}/g, (data.productName || '').trim())
    .replace(/\{salePrice\}/g, (data.salePrice || '').trim());
}
