/**
 * ★ 2026-11-05 인앱 포스터 재구성 §3-9 — 예시 갤러리 표 CT(가상 업체 · 실제 생성 · 실제 렌더)
 *   설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §3-9.
 *
 *   예시 하나 = 편집기 시작 상태(seed = 메시지 저장 칸 그대로) + 장마다 그림 만들 재료(스튜디오 템플릿 · 그림에 그릴 글 · 누끼).
 *   그림 = 서버 스크립트(scripts/inapp-examples.ts)가 미리 만든다(같은 엔진 · 같은 프롬프트 함수). 화면은 공개 그림 주소로 받는다.
 *   글 = 사람이 쓴 표에서만(혜택 숫자 · 혜택 낱말 · 줄표 · 가운뎃점 · 모델명 0 = 계약 시험 CT-IA3).
 *   혜택이 있어야 말이 되는 자리(쿠폰 · 남은 시간)와 이동 주소는 채울 자리로 둔다 → 그대로 게시 · 생성하면 기존 판정이 막는다.
 *   ⛔ 커머스 업체(§10-2 · 이름 · 누끼 미정)는 Harold 확정 뒤 표에 더한다(지어낸 이름 금지).
 */
import fs from 'fs';
import path from 'path';
import { BENEFIT_PLACEHOLDER, INAPP_EXAMPLE_IMAGE_PREFIX } from './inapp-message';
import type { IndustryCode } from './industry-codes';

export type InAppExampleIndustry = 'beauty' | 'fashion' | 'commerce' | 'cafe';
export const INAPP_EXAMPLE_INDUSTRIES: readonly InAppExampleIndustry[] = ['beauty', 'fashion', 'commerce', 'cafe'];

/** 이동 주소 · 쿠폰 코드 채울 자리(기존 게시 판정 findAiFillPlaceholder · 화면 publishDefectOf 가 막는 꼴) */
export const EXAMPLE_LINK_PLACEHOLDER = '[이동할 주소: 직접 입력해주세요]';
export const EXAMPLE_DM_PLACEHOLDER = '[DM 참여 페이지: 직접 입력해주세요]';
export const EXAMPLE_COUPON_PLACEHOLDER = '[쿠폰 코드: 직접 입력해주세요]';

export interface InAppExampleSlide {
  /** 스튜디오 템플릿 id(image-studio-templates) — 예시 그림 · 「AI로 내 그림 만들기」가 같은 템플릿을 쓴다 */
  studioTemplateId: string;
  /** 그림에 그릴 글(통짜) · 비우면 글 없는 판(글 얹기 = 렌더러가 글을 그린다) */
  texts: { label?: string; title?: string; subtitle?: string };
  /** 누끼 파일 이름(backend/assets/inapp-examples/) · 없으면 제품 없이 */
  product?: string;
}

export interface InAppExample {
  id: string;
  industry: InAppExampleIndustry;
  brand: string;
  /** 카드 이름 */
  title: string;
  /** 편집기 시작 상태(장 그림 주소는 표가 채운다 · inAppExampleSeed) */
  seed: Record<string, any>;
  slides: InAppExampleSlide[];
}

const cta = (label: string, url: string = EXAMPLE_LINK_PLACEHOLDER) => ({ label, action_url: url });

/** 예시 표 — 순서 = 갤러리 순서. id = 파일 이름(영문 소문자 · 숫자 · -). */
export const INAPP_EXAMPLES: readonly InAppExample[] = [
  {
    id: 'kyeolon-baked-sheet', industry: 'beauty', brand: '결온', title: '신제품 포스터 한 장',
    seed: {
      template: 'full_image', design: { poster_text: 'baked', dismiss_mode: 'snooze_day' },
      poster_slides: [{ eyebrow: 'KYEOLON', title: '촉촉함이 오래가는 세럼', body: '결온 앰버 세럼', cta: cta('자세히 보기') }],
    },
    slides: [{ studioTemplateId: 'beauty-autumn-amber', texts: { label: 'KYEOLON', title: '촉촉함이 오래가는 세럼', subtitle: '결온 앰버 세럼' }, product: 'cut-kyeolon.png' }],
  },
  {
    id: 'kyeolon-baked-card-coupon', industry: 'beauty', brand: '결온', title: '멤버 코드 카드',
    seed: {
      template: 'full_image', accent_color: '#7c2d12',
      design: { poster_text: 'baked', poster_frame: 'card', dismiss_mode: 'snooze_day', poster_strip: { type: 'coupon', code: EXAMPLE_COUPON_PLACEHOLDER, label: '결온 멤버 코드' } },
      poster_slides: [{ eyebrow: 'MEMBERS ONLY', title: '결온 멤버를 위한 코드', body: BENEFIT_PLACEHOLDER, cta: cta('지금 쓰러 가기') }],
    },
    slides: [{ studioTemplateId: 'event-mem-velvet', texts: { label: 'MEMBERS ONLY', title: '결온 멤버를 위한 코드', subtitle: '가입해 주신 분께 드려요' } }],
  },
  {
    id: 'kyeolon-live-sheet', industry: 'beauty', brand: '결온', title: '하루 세 단계 넘겨 보기',
    seed: {
      template: 'full_image', design: { dismiss_mode: 'snooze_day' },
      poster_slides: [
        { eyebrow: 'MORNING', title: '아침의 첫 단계', body: '가볍게 스며드는 토너로 시작해요', cta: cta('토너 보기') },
        { eyebrow: 'DAY', title: '낮에는 촉촉하게', body: '물방울처럼 맺히는 수분 크림', cta: cta('크림 보기') },
        { eyebrow: 'NIGHT', title: '밤에는 푹 쉬게', body: '자는 동안 채워 주는 슬리핑 팩', cta: cta('팩 보기') },
      ],
    },
    slides: [
      { studioTemplateId: 'beauty-toner-cotton-shelf', texts: {} },
      { studioTemplateId: 'beauty-hydra-water-ripple', texts: {} },
      { studioTemplateId: 'beauty-sleeping-pack-lamp', texts: {} },
    ],
  },
  {
    id: 'soyo-baked-card', industry: 'fashion', brand: '소요웨어', title: '컬렉션 두 장 카드',
    seed: {
      template: 'full_image', design: { poster_text: 'baked', poster_frame: 'card', dismiss_mode: 'snooze_day' },
      poster_slides: [
        { eyebrow: 'SOYO WEAR', title: '포근한 울 니트', body: '소요웨어 새 컬렉션', cta: cta('니트 보러 가기') },
        { eyebrow: 'SOYO WEAR', title: '가볍게 걸치는 코트', body: '매일 입기 좋은 핏', cta: cta('코트 보러 가기') },
      ],
    },
    slides: [
      { studioTemplateId: 'fashion-knit-texture', texts: { label: 'SOYO WEAR', title: '포근한 울 니트', subtitle: '소요웨어 새 컬렉션' }, product: 'cut-soyo.png' },
      { studioTemplateId: 'fashion-coat-wall-hook', texts: { label: 'SOYO WEAR', title: '가볍게 걸치는 코트', subtitle: '매일 입기 좋은 핏' } },
    ],
  },
  {
    id: 'soyo-baked-sheet-countdown', industry: 'fashion', brand: '소요웨어', title: '마감까지 남은 시간',
    seed: {
      template: 'full_image', accent_color: '#111827',
      design: { poster_text: 'baked', dismiss_mode: 'snooze_day', poster_strip: { type: 'countdown', label: '위크 마감까지' } },
      poster_slides: [{ eyebrow: 'BRAND WEEK', title: '소요웨어 브랜드 위크', body: BENEFIT_PLACEHOLDER, cta: cta('위크 상품 보기') }],
    },
    slides: [{ studioTemplateId: 'sale-brand-week', texts: { label: 'BRAND WEEK', title: '소요웨어 브랜드 위크', subtitle: '새로 들어온 옷을 먼저 만나요' } }],
  },
  {
    id: 'soyo-event-card', industry: 'fashion', brand: '소요웨어', title: '이벤트 카드 넘겨 보기',
    seed: {
      template: 'full_image', design: { poster_layout: 'event_card', dismiss_mode: 'snooze_day' },
      poster_slides: [
        { eyebrow: 'NEW IN', title: '이번 주 새로 들어온 셔츠', body: '깔끔한 핏 그대로 매일 입어요', cta: cta('셔츠 보기') },
        { eyebrow: 'STYLING', title: '한 벌로 끝내는 셋업', body: '위아래 맞춰 입는 날', cta: cta('셋업 보기') },
      ],
    },
    slides: [
      { studioTemplateId: 'fashion-white-shirt-sheer', texts: {} },
      { studioTemplateId: 'fashion-setup-double-hanger', texts: {} },
    ],
  },
  {
    id: 'ohudam-baked-card', industry: 'cafe', brand: '오후담', title: '시즌 메뉴 카드',
    seed: {
      template: 'full_image', design: { poster_text: 'baked', poster_frame: 'card', dismiss_mode: 'snooze_day' },
      poster_slides: [{ eyebrow: 'OHUDAM', title: '부드러운 크림 라떼', body: '오후담 시즌 메뉴', cta: cta('메뉴 보기') }],
    },
    slides: [{ studioTemplateId: 'cafe-cream-latte', texts: { label: 'OHUDAM', title: '부드러운 크림 라떼', subtitle: '오후담 시즌 메뉴' }, product: 'cut-ohudam.png' }],
  },
  {
    id: 'ohudam-baked-sheet-countdown', industry: 'cafe', brand: '오후담', title: '생일 달 남은 시간',
    seed: {
      template: 'full_image', accent_color: '#9a3412',
      design: { poster_text: 'baked', dismiss_mode: 'snooze_day', poster_strip: { type: 'countdown', label: '이번 달 마감까지' } },
      poster_slides: [{ eyebrow: 'HAPPY BIRTHDAY', title: '생일 축하해요', body: BENEFIT_PLACEHOLDER, cta: cta('매장 찾기') }],
    },
    slides: [{ studioTemplateId: 'event-mem-birthday', texts: { label: 'HAPPY BIRTHDAY', title: '생일 축하해요', subtitle: '오후담이 함께 축하해요' } }],
  },
  {
    id: 'ohudam-live-sheet', industry: 'cafe', brand: '오후담', title: '오늘의 디저트 넘겨 보기',
    seed: {
      template: 'full_image', design: { dismiss_mode: 'snooze_day' },
      poster_slides: [
        { title: '매일 아침 굽는 스콘', body: '잼을 곁들이면 더 맛있어요', cta: cta('디저트 보기') },
        { title: '햇살이 드는 창가 자리', body: '오후 한때를 천천히 보내요', cta: cta('매장 찾기') },
      ],
    },
    slides: [
      { studioTemplateId: 'cafe-scone-jam', texts: {} },
      { studioTemplateId: 'cafe-window-bar', texts: {} },
    ],
  },
];

/** 예시 그림 저장 폴더(서버 · 스크립트와 라우트가 같은 값) */
export function inAppExampleDir(): string {
  return process.env.INAPP_EXAMPLE_PATH || path.resolve('./uploads/inapp-examples');
}

/** 누끼 폴더(저장소 안 · 배포본에 들어간다) */
export function inAppExampleAssetDir(): string {
  return path.resolve(__dirname, '../../assets/inapp-examples');
}

export function findInAppExample(id: string): InAppExample | null {
  return INAPP_EXAMPLES.find((e) => e.id === id) ?? null;
}

const EX_EXTS = ['jpg', 'png', 'webp'] as const;
/** 예시 그림 파일(없으면 null) · v = 수정 시각(주소 꼬리 · 긴 캐시) */
export function findInAppExampleImage(id: string, slide: number): { absPath: string; mime: string; v: number } | null {
  const ex = findInAppExample(id);
  if (!ex || !Number.isInteger(slide) || slide < 0 || slide >= ex.slides.length) return null;
  for (const ext of EX_EXTS) {
    const p = path.join(inAppExampleDir(), `${id}-${slide}.${ext}`);
    try {
      const st = fs.statSync(p);
      return { absPath: p, mime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg', v: Math.floor(st.mtimeMs) };
    } catch { /* 이 확장자 없음 */ }
  }
  return null;
}

/** 예시 그림 공개 주소(상대 · v 꼬리) */
export function inAppExampleImageUrl(id: string, slide: number, v?: number): string {
  return `${INAPP_EXAMPLE_IMAGE_PREFIX}${id}/${slide}${v ? `?v=${v}` : ''}`;
}

/** 예시 한 장 저장 — 임시 파일에 쓰고 옮긴다(반쪽 파일이 「있음」으로 세지지 않게) */
export function saveInAppExampleImage(id: string, slide: number, img: { base64: string; mime: string }): string {
  const dir = inAppExampleDir();
  fs.mkdirSync(dir, { recursive: true });
  const ext = img.mime.includes('png') ? 'png' : img.mime.includes('webp') ? 'webp' : 'jpg';
  const out = path.join(dir, `${id}-${slide}.${ext}`);
  const tmp = path.join(dir, `.tmp-${id}-${slide}-${Date.now()}`);
  fs.writeFileSync(tmp, Buffer.from(img.base64, 'base64'));
  fs.renameSync(tmp, out);
  return out;
}

/** 편집기 시작 상태 — seed 에 장마다 예시 그림 주소를 채운다(그림 칸 = 예시 그림 · 게시 판정이 막는다) */
export function inAppExampleSeed(ex: InAppExample, versions: Array<number | undefined> = []): Record<string, any> {
  const slides = (Array.isArray(ex.seed.poster_slides) ? ex.seed.poster_slides : []).map((s: any, i: number) => ({
    ...s,
    image_url: inAppExampleImageUrl(ex.id, i, versions[i]),
  }));
  return { ...ex.seed, poster_slides: slides };
}

/**
 * 회사 업종 코드(companies.industry_code · industry-codes.ts INDUSTRY_CODES) → 예시 업종. 표 = 스튜디오 「우리 업종 먼저」와 같은 셋
 *   (뷰티 · 의류 · 요식 = studioIndustryCategories) · 그 밖 · 없음 = null = 전체(추측 0).
 */
const EXAMPLE_INDUSTRY_OF_CODE: Partial<Record<IndustryCode, InAppExampleIndustry>> = { beauty: 'beauty', fashion: 'fashion', food: 'cafe' };
export function inAppExampleIndustry(code: string | null | undefined): InAppExampleIndustry | null {
  return EXAMPLE_INDUSTRY_OF_CODE[String(code || '').trim() as IndustryCode] ?? null;
}

/** 갤러리 목록(그림이 다 준비된 예시만 · 업종 = 회사 업종) */
export function listInAppExamplesForGallery(companyIndustryCode: string | null | undefined): {
  industry: InAppExampleIndustry | null;
  examples: Array<{ id: string; industry: InAppExampleIndustry; brand: string; title: string; seed: Record<string, any>; studio: InAppExampleSlide[] }>;
} {
  const out: Array<{ id: string; industry: InAppExampleIndustry; brand: string; title: string; seed: Record<string, any>; studio: InAppExampleSlide[] }> = [];
  for (const ex of INAPP_EXAMPLES) {
    const files = ex.slides.map((_, i) => findInAppExampleImage(ex.id, i));
    if (files.some((f) => !f)) continue;   // 그림 미준비 = 목록에서 뺀다(빈 틀 0)
    out.push({
      id: ex.id, industry: ex.industry, brand: ex.brand, title: ex.title,
      seed: inAppExampleSeed(ex, files.map((f) => f?.v)),
      studio: ex.slides.map((s) => ({ studioTemplateId: s.studioTemplateId, texts: { ...s.texts } })),
    });
  }
  return { industry: inAppExampleIndustry(companyIndustryCode), examples: out };
}
