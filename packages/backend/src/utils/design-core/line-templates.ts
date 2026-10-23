/**
 * ★ CT design-core/line-templates.ts — 한 줄 템플릿 캠페인 4종 (2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md)
 *
 * "최소한의 완벽한 퀄리티는 템플릿 배치가 보장한다 · AI 는 문구 칸만 쓴다."
 *   - 이 파일 = 순수 데이터 + 추천 규칙. 조립(장 · 섹션)은 `utils/line-template-compose.ts`, 문구 AI 는 `utils/line-template-copy.ts`.
 *   - 기존 `CORE_GOLDEN_TEMPLATES` · `compileTemplateFor*`(자리표시 컴파일러)는 쓰지도 고치지도 않는다(이메일 갤러리 · 인앱 화면이 읽는다).
 *   - 문구 칸 기본값(fallback) = 숫자 0 · 혜택 0 · 줄표 0(AI 가 실패하거나 지어낸 숫자를 쓰면 이 값으로 바뀐다).
 *   - 예시 = 가상 업체(실존 브랜드 0) · 사진 = 저장소에 이미 커밋된 정물 사진(frontend/public/diagnosis-examples/assets · 사람 얼굴 0).
 */

export type LineTemplateId = 'new-launch' | 'big-sale' | 'season' | 'special-event';
export const LINE_TEMPLATE_IDS: readonly LineTemplateId[] = ['big-sale', 'new-launch', 'special-event', 'season'];
export type LineChannel = 'dm' | 'email' | 'inapp';
export type LineLayout = 'slides' | 'page';

export type LineCopyKey =
  | 'cover_tag' | 'cover_headline' | 'cover_sub'
  | 'story_headline' | 'story_body'
  | 'closing_headline' | 'closing_body' | 'cta_label'
  | 'email_subject' | 'email_preheader'
  | 'inapp_title' | 'inapp_body';

export interface LineCopyField {
  key: LineCopyKey;
  /** 글자 수 상한(공백 포함) */
  max: number;
  /** AI 가 실패 · 숫자 · 혜택을 지어내면 쓰는 문구(숫자 0) */
  fallback: string;
  /** AI 에 주는 칸 설명 */
  hint: string;
}

/** 재료가 어디 들어가는가(화면 「필요한 재료」 줄 · 단계 판정이 읽는다) */
export interface LineTemplateNeeds {
  /** 혜택: required = 없으면 묻는다 · optional = 행사 의도가 있으면 묻는다 · none = 묻지 않는다 */
  benefit: 'required' | 'optional' | 'none';
  /** 기간(DM · 이메일): required = 기간 낱말이 없으면 날짜를 묻는다 */
  period: 'required' | 'none';
  /** 상품 개수(채널별 상한) · min = 1 이면 상품이 필수 */
  products: { min: number; max: Record<LineChannel, number> };
  /** 대표 사진을 묻는가(사진 표지 템플릿) */
  hero: 'ask' | 'none';
}

export interface LineExampleProduct { name: string; price: number; discount_price?: number; image_url: string }
export interface LineTemplateExample {
  company: string;
  industry: '뷰티' | '의류' | '요식업' | '커머스';
  line: string;
  hero: string | null;
  products: LineExampleProduct[];
  benefit: string | null;
  /** 오늘부터 며칠 뒤 마감(예시 렌더 때 날짜로 바꾼다 · null = 기간 없음) */
  periodDays: number | null;
  copy: Record<LineCopyKey, string>;
}

export interface LineTemplateDesign {
  primary: string;
  accent: string;
  /** 인앱 테마 · 형태(SDK 가 아는 값만) */
  inappTheme: 'editorial' | 'bold-sale' | 'paper' | 'festive';
}

export interface LineTemplate {
  id: LineTemplateId;
  label: string;
  /** 고르기 카드 한 줄 설명 */
  desc: string;
  /** 기승전결 4줄(화면) */
  story: Array<{ role: '기' | '승' | '전' | '결'; text: string }>;
  needs: LineTemplateNeeds;
  /** 추천 규칙(한 줄 낱말) — 걸린 글자를 이유로 보여 준다 */
  match: RegExp;
  copy: LineCopyField[];
  design: LineTemplateDesign;
  example: LineTemplateExample;
}

const EX = '/diagnosis-examples/assets';

/** 모든 템플릿이 쓰는 이메일 · 인앱 문구 칸(같은 상한) */
const CHANNEL_COPY = (subject: string, pre: string, title: string, body: string): LineCopyField[] => [
  { key: 'email_subject', max: 40, fallback: subject, hint: '이메일 제목 · 받은편지함에서 열고 싶게' },
  { key: 'email_preheader', max: 60, fallback: pre, hint: '이메일 미리보기 문장 · 제목을 보완' },
  { key: 'inapp_title', max: 20, fallback: title, hint: '앱 · 쇼핑몰 화면 팝업 제목' },
  { key: 'inapp_body', max: 50, fallback: body, hint: '팝업 본문 한두 문장' },
];

export const LINE_TEMPLATES: readonly LineTemplate[] = [
  {
    id: 'big-sale',
    label: '빅세일 안내',
    desc: '혜택을 첫 화면에 크게 · 세일 상품 · 마감으로 마무리',
    story: [
      { role: '기', text: '혜택을 표지에 크게 보여 줘요' },
      { role: '승', text: '세일 상품을 사진 · 가격으로 보여 줘요' },
      { role: '전', text: '놓치면 안 되는 조건을 짚어 줘요' },
      { role: '결', text: '마감과 버튼으로 마무리해요' },
    ],
    needs: { benefit: 'required', period: 'required', products: { min: 0, max: { dm: 8, email: 6, inapp: 1 } }, hero: 'none' },
    match: /세일|할인|특가|블프|블랙\s*프라이데이|감사제|시즌\s*오프|클리어런스|가격\s*인하|\d+\s*%|퍼센트/,
    copy: [
      { key: 'cover_tag', max: 12, fallback: 'SALE', hint: '표지 위 짧은 꼬리표(예: SEASON OFF)' },
      { key: 'cover_headline', max: 18, fallback: '시즌 세일을 시작합니다', hint: '세일 이름 한 줄' },
      { key: 'cover_sub', max: 30, fallback: '놓치기 전에 확인하세요', hint: '표지 아래 보조 문장' },
      { key: 'story_headline', max: 18, fallback: '지금 담아 두세요', hint: '세일 상품 묶음 제목' },
      { key: 'story_body', max: 70, fallback: '인기 상품부터 빠르게 마감될 수 있어요. 원하는 상품을 먼저 확인해 보세요', hint: '서두르면 좋은 이유(숫자 금지)' },
      { key: 'closing_headline', max: 18, fallback: '세일은 곧 끝나요', hint: '마지막 장 제목' },
      { key: 'closing_body', max: 60, fallback: '원하는 상품을 지금 담아 두세요', hint: '마지막 장 한두 문장' },
      { key: 'cta_label', max: 10, fallback: '세일 상품 보기', hint: '버튼 글자' },
      ...CHANNEL_COPY('시즌 세일이 시작됐어요', '원하는 상품을 지금 확인하세요', '세일이 시작됐어요', '원하는 상품을 지금 확인해 보세요'),
    ],
    design: { primary: '#b91c1c', accent: '#111827', inappTheme: 'bold-sale' },
    example: {
      company: '소목',
      industry: '의류',
      line: '시즌오프 최대 30% 할인 · 니트 코트 가방 신발',
      hero: null,
      products: [
        { name: '울 라운드 니트', price: 89000, discount_price: 62300, image_url: `${EX}/fashion-p1.png` },
        { name: '카멜 싱글 블레이저', price: 159000, discount_price: 111300, image_url: `${EX}/fashion-p2.png` },
        { name: '소프트 레더 호보백', price: 129000, discount_price: 90300, image_url: `${EX}/fashion-p4.png` },
        { name: '클래식 레더 스니커즈', price: 99000, discount_price: 69300, image_url: `${EX}/fashion-p5.png` },
      ],
      benefit: '시즌오프 최대 30%',
      periodDays: 7,
      copy: {
        cover_tag: 'SEASON OFF', cover_headline: '소목 시즌오프', cover_sub: '올해 가장 좋은 가격으로 만나 보세요',
        story_headline: '지금 담아 두세요', story_body: '인기 사이즈부터 빠르게 마감될 수 있어요. 원하는 상품을 먼저 확인해 보세요',
        closing_headline: '세일은 곧 끝나요', closing_body: '마감 전에 원하는 상품을 담아 두세요', cta_label: '세일 상품 보기',
        email_subject: '소목 시즌오프 최대 30%가 시작됐어요', email_preheader: '니트부터 신발까지 지금 가장 좋은 가격으로',
        inapp_title: '시즌오프 최대 30%', inapp_body: '니트부터 신발까지 지금 확인해 보세요',
      },
    },
  },
  {
    id: 'new-launch',
    label: '신상품 공개',
    desc: '새 상품을 첫 화면 가득 · 사진과 가격으로 바로 보여 주기',
    story: [
      { role: '기', text: '새로 나온 상품을 첫 화면 가득 보여 줘요' },
      { role: '승', text: '상품 사진 · 가격을 크게 보여 줘요' },
      { role: '전', text: '함께 나온 상품을 이어서 보여 줘요' },
      { role: '결', text: '소개 한 줄 · 혜택 · 버튼으로 마무리해요' },
    ],
    needs: { benefit: 'optional', period: 'none', products: { min: 1, max: { dm: 8, email: 6, inapp: 1 } }, hero: 'ask' },
    match: /신상|신제품|신메뉴|출시|입고|런칭|론칭|컬렉션|NEW|새로\s*나온|첫\s*선/i,
    copy: [
      { key: 'cover_tag', max: 12, fallback: 'NEW', hint: '표지 위 짧은 꼬리표' },
      { key: 'cover_headline', max: 18, fallback: '새로운 상품을 소개합니다', hint: '신상품을 알리는 첫 줄' },
      { key: 'cover_sub', max: 30, fallback: '지금 가장 먼저 만나 보세요', hint: '표지 아래 보조 문장' },
      { key: 'story_headline', max: 18, fallback: '이번에 새로 나왔어요', hint: '상품 장 제목' },
      { key: 'story_body', max: 70, fallback: '오래 고민해서 만든 새 상품이에요. 자세한 내용은 상품 페이지에서 확인해 보세요', hint: '상품을 소개하는 한두 문장(성분 · 효과 단정 금지)' },
      { key: 'closing_headline', max: 18, fallback: '지금 바로 만나 보세요', hint: '마지막 장 제목' },
      { key: 'closing_body', max: 60, fallback: '새로 나온 상품을 가장 먼저 확인해 보세요', hint: '마지막 장 한두 문장' },
      { key: 'cta_label', max: 10, fallback: '신상품 보러 가기', hint: '버튼 글자' },
      ...CHANNEL_COPY('새로운 상품을 소개합니다', '지금 가장 먼저 만나 보세요', '새 상품이 나왔어요', '지금 가장 먼저 만나 보세요'),
    ],
    design: { primary: '#1f2937', accent: '#b45309', inappTheme: 'editorial' },
    example: {
      company: '온결',
      industry: '뷰티',
      line: '진정 앰플 신상 출시 · 출시 기념 10% 할인',
      hero: `${EX}/beauty-email-hero.png`,
      products: [{ name: '온결 진정 앰플 30ml', price: 32000, discount_price: 28800, image_url: `${EX}/beauty-inapp.png` }],
      benefit: '출시 기념 10% 할인',
      periodDays: null,
      copy: {
        cover_tag: 'NEW', cover_headline: '온결 진정 앰플 출시', cover_sub: '예민한 날에도 편안한 데일리 케어',
        story_headline: '이번에 새로 나왔어요', story_body: '가볍게 스며드는 진정 앰플이에요. 자세한 내용은 상품 페이지에서 확인해 보세요',
        closing_headline: '지금 바로 만나 보세요', closing_body: '출시 기념 혜택은 상품 페이지에서 확인할 수 있어요', cta_label: '앰플 보러 가기',
        email_subject: '온결 진정 앰플이 새로 나왔어요', email_preheader: '출시 기념 10% 할인을 함께 확인해 보세요',
        inapp_title: '진정 앰플 출시', inapp_body: '출시 기념 10% 할인을 확인해 보세요',
      },
    },
  },
  {
    id: 'special-event',
    label: '특별 이벤트',
    desc: '초대장처럼 · 무엇을 드리는지 · 언제까지 · 참여 버튼',
    story: [
      { role: '기', text: '초대장처럼 이벤트를 알려요' },
      { role: '승', text: '무엇을 드리는지 크게 보여 줘요' },
      { role: '전', text: '함께 볼 상품을 이어서 보여 줘요' },
      { role: '결', text: '마감과 참여 버튼으로 마무리해요' },
    ],
    needs: { benefit: 'required', period: 'required', products: { min: 0, max: { dm: 4, email: 4, inapp: 1 } }, hero: 'ask' },
    match: /이벤트|증정|사은품|경품|추첨|팝업|오픈|참여|기념|초대|래플|당첨|선물/,
    copy: [
      { key: 'cover_tag', max: 12, fallback: 'EVENT', hint: '표지 위 짧은 꼬리표' },
      { key: 'cover_headline', max: 18, fallback: '특별한 이벤트에 초대합니다', hint: '이벤트 이름 한 줄' },
      { key: 'cover_sub', max: 30, fallback: '함께해 주세요', hint: '표지 아래 보조 문장' },
      { key: 'story_headline', max: 18, fallback: '이렇게 드려요', hint: '혜택 장 제목' },
      { key: 'story_body', max: 70, fallback: '자세한 참여 방법은 아래 버튼에서 확인해 주세요', hint: '참여를 돕는 한두 문장(조건 · 숫자 지어내기 금지)' },
      { key: 'closing_headline', max: 18, fallback: '놓치지 마세요', hint: '마지막 장 제목' },
      { key: 'closing_body', max: 60, fallback: '이벤트가 끝나기 전에 참여해 주세요', hint: '마지막 장 한두 문장' },
      { key: 'cta_label', max: 10, fallback: '참여하기', hint: '버튼 글자' },
      ...CHANNEL_COPY('특별한 이벤트에 초대합니다', '함께해 주세요', '이벤트에 초대해요', '자세한 내용을 확인해 보세요'),
    ],
    design: { primary: '#4338ca', accent: '#db2777', inappTheme: 'festive' },
    example: {
      company: '하루곳간',
      industry: '커머스',
      line: '회원의 날 이벤트 · 구매 고객 전원 텀블러 증정',
      hero: null,
      products: [
        { name: '노이즈캔슬링 무선 이어폰', price: 129000, image_url: `${EX}/ecommerce-p1.png` },
        { name: '휴대용 블루투스 스피커', price: 79000, image_url: `${EX}/ecommerce-p6.png` },
      ],
      benefit: '구매 고객 전원 텀블러 증정',
      periodDays: 5,
      copy: {
        cover_tag: 'MEMBERS DAY', cover_headline: '하루곳간 회원의 날', cover_sub: '회원님께만 드리는 선물이 있어요',
        story_headline: '이렇게 드려요', story_body: '이벤트 기간에 구매하시면 선물을 함께 보내 드려요. 자세한 내용은 버튼에서 확인해 주세요',
        closing_headline: '놓치지 마세요', closing_body: '회원의 날이 끝나기 전에 참여해 주세요', cta_label: '이벤트 보기',
        email_subject: '하루곳간 회원의 날에 초대합니다', email_preheader: '구매 고객 전원 텀블러를 드려요',
        inapp_title: '회원의 날 이벤트', inapp_body: '구매 고객 전원 텀블러를 드려요',
      },
    },
  },
  {
    id: 'season',
    label: '계절 안내',
    desc: '계절 인사 · 계절 이야기 · 추천 상품으로 이어지는 흐름',
    story: [
      { role: '기', text: '계절 분위기로 첫 화면을 열어요' },
      { role: '승', text: '이 계절에 어울리는 이야기를 해요' },
      { role: '전', text: '계절 추천 상품을 보여 줘요' },
      { role: '결', text: '혜택 · 버튼으로 마무리해요' },
    ],
    needs: { benefit: 'none', period: 'none', products: { min: 1, max: { dm: 6, email: 6, inapp: 1 } }, hero: 'ask' },
    match: /봄|여름|가을|겨울|환절기|장마|연말|연초|명절|추석|설날|크리스마스|성탄|어버이날|발렌타인|화이트데이|시즌/,
    copy: [
      { key: 'cover_tag', max: 12, fallback: 'SEASON', hint: '표지 위 짧은 꼬리표(계절 이름)' },
      { key: 'cover_headline', max: 18, fallback: '이 계절에 어울리는 제안', hint: '계절 인사 한 줄' },
      { key: 'cover_sub', max: 30, fallback: '계절을 담은 추천을 모았어요', hint: '표지 아래 보조 문장' },
      { key: 'story_headline', max: 18, fallback: '계절이 바뀌는 지금', hint: '계절 이야기 제목' },
      { key: 'story_body', max: 70, fallback: '이 계절에 잘 어울리는 것들을 골라 담았어요. 천천히 둘러보세요', hint: '계절 이야기 한두 문장(숫자 금지)' },
      { key: 'closing_headline', max: 18, fallback: '지금 만나 보세요', hint: '마지막 장 제목' },
      { key: 'closing_body', max: 60, fallback: '계절이 지나기 전에 확인해 보세요', hint: '마지막 장 한두 문장' },
      { key: 'cta_label', max: 10, fallback: '추천 보러 가기', hint: '버튼 글자' },
      ...CHANNEL_COPY('이 계절에 어울리는 제안', '계절을 담은 추천을 모았어요', '계절 추천', '이 계절에 어울리는 추천을 확인해 보세요'),
    ],
    design: { primary: '#7c4a2d', accent: '#c2410c', inappTheme: 'paper' },
    example: {
      company: '오븐레터',
      industry: '요식업',
      line: '가을 한정 메뉴 출시 · 브런치 신메뉴',
      hero: `${EX}/fnb-email-hero.png`,
      products: [
        { name: '트러플 크림 파스타', price: 18500, image_url: `${EX}/fnb-p1.png` },
        { name: '부라타 가든 샐러드', price: 14500, image_url: `${EX}/fnb-p2.png` },
        { name: '생딸기 생크림 케이크', price: 7800, image_url: `${EX}/fnb-inapp.png` },
      ],
      benefit: null,
      periodDays: null,
      copy: {
        cover_tag: 'AUTUMN', cover_headline: '오븐레터의 가을 식탁', cover_sub: '가을에만 만나는 한정 메뉴',
        story_headline: '선선해진 요즘', story_body: '따뜻하고 든든한 한 끼가 생각나는 계절이에요. 가을 재료로 새 메뉴를 준비했어요',
        closing_headline: '가을이 가기 전에', closing_body: '한정 메뉴는 계절이 지나면 바뀌어요', cta_label: '메뉴 보러 가기',
        email_subject: '오븐레터 가을 한정 메뉴가 나왔어요', email_preheader: '가을에만 만나는 브런치 신메뉴',
        inapp_title: '가을 한정 메뉴', inapp_body: '가을에만 만나는 브런치 신메뉴를 확인해 보세요',
      },
    },
  },
];

export function getLineTemplate(id: unknown): LineTemplate | null {
  return LINE_TEMPLATES.find((t) => t.id === id) ?? null;
}

// ★ 2026-10-23 한 줄 → 옛 템플릿 추천(rankLineTemplates) 삭제 — 입구가 구성 5종만 쓴다(설계서 docs/2026-10-23-oneline-ct-complete-design.md A3)

// ★ 2026-10-21 템플릿 캠페인 회사 명단 스위치 삭제 — 전 회사 같은 흐름(설계서 docs/2026-10-21-oneline-content-design.md §3-1)

/**
 * 등록 관문(테스트가 부른다) — 칸마다 기본 문구에 숫자 0 · 상한 안 · 물을 수 있는 필수 칸 3개 이하 · 예시 문구가 상한 안 · 추천 규칙 존재.
 * 실패 = 사유 목록(빈 배열 = 통과).
 */
export function validateLineTemplate(t: LineTemplate): string[] {
  const out: string[] = [];
  const keys = new Set(t.copy.map((c) => c.key));
  for (const c of t.copy) {
    if (/\d/.test(c.fallback)) out.push(`${t.id}.${c.key}: 기본 문구에 숫자`);
    if (c.fallback.length > c.max) out.push(`${t.id}.${c.key}: 기본 문구가 상한 초과`);
    if (/[—–]/.test(c.fallback)) out.push(`${t.id}.${c.key}: 줄표`);
    const ex = t.example.copy[c.key];
    if (typeof ex !== 'string' || !ex) out.push(`${t.id}.${c.key}: 예시 문구 없음`);
    else if (ex.length > c.max) out.push(`${t.id}.${c.key}: 예시 문구 상한 초과`);
  }
  for (const k of ['cover_headline', 'cta_label', 'email_subject', 'inapp_title', 'inapp_body'] as LineCopyKey[]) if (!keys.has(k)) out.push(`${t.id}: 문구 칸 ${k} 없음`);
  const askable = [t.needs.benefit === 'required', t.needs.period === 'required', t.needs.products.min > 0].filter(Boolean).length;
  if (askable > 3) out.push(`${t.id}: 물을 수 있는 필수 칸 3개 초과`);
  if (t.story.length !== 4) out.push(`${t.id}: 기승전결 4줄`);
  return out;
}
