/**
 * brandRich — 브랜드메시지 자유형 5종(와이드 리스트·프리미엄 동영상·커머스·캐러셀 2종)의
 * 입력 상태 · 사전 검사 · 발송 payload 투영 (★ 2026-09-20 신설)
 *
 * 화면(`BrandRichSections`)과 분리해 순수 함수로 둔다 — 편집기가 같은 상태로 검사·미리보기·발송을 모두 한다.
 *
 * 규격 숫자는 여기 적지 않는다. 전부 `constants/brand-message-spec.ts`(백엔드 CT-12 사본)에서 읽는다.
 * 여기 검사는 **입력을 미리 막아주는 거울**이고 최종 판정자는 백엔드 조립기다(assertBrandContentSpec).
 * payload 키는 백엔드 `BrandMessageParams` 계약 그대로다 — 고칠 때는 양쪽을 같이 고친다.
 */
import { BRAND_SPEC } from '../../constants/brand-message-spec';
import { ratioLabel, sameRatio } from './brandImageSpec';

/**
 * 이미지 한 자리 — 라이브러리·업로드에서 고른 우리 자산. 발송 직전 서버가 카카오에 올려 준다.
 * `w`·`h` = 고를 때 잰 실제 크기(useBrandImageGuard). 캐러셀의 「카드끼리 같은 비율」 검사에 쓴다.
 */
export interface SlotImage { url: string; assetId: string; kind: string; name: string; w?: number; h?: number }
export interface RichButton { name: string; type: string; url_mobile?: string }
/** 가격은 입력 문자열 그대로 들고 있다가 보낼 때 숫자로 바꾼다(입력을 고쳐 쓰지 않는다) */
export interface CommerceState { title: string; regular: string; discount: string; rate: string }
export interface ItemState { image: SlotImage | null; title: string; urlMobile: string }
export interface CardState {
  image: SlotImage | null; imgLink: string;
  header: string; message: string; additional: string;
  commerce: CommerceState; buttons: RichButton[];
}
export interface RichState {
  header: string;
  additional: string;
  items: ItemState[];
  video: { url: string; thumb: SlotImage | null };
  commerce: CommerceState;
  introOn: boolean;
  intro: { header: string; content: string; image: SlotImage | null; urlMobile: string };
  cards: CardState[];
  tailOn: boolean;
  tailUrl: string;
}

export const emptyCommerce = (): CommerceState => ({ title: '', regular: '', discount: '', rate: '' });
export const emptyItem = (): ItemState => ({ image: null, title: '', urlMobile: '' });
export const emptyCard = (): CardState => ({
  image: null, imgLink: '', header: '', message: '', additional: '', commerce: emptyCommerce(), buttons: [],
});

/** 유형을 고르면 그 유형의 최소 구성을 미리 깔아 준다 — 빈 화면에서 시작하면 무엇을 해야 할지 모른다 */
export function initialRich(code: string): RichState {
  const s = BRAND_SPEC[code];
  return {
    header: '', additional: '',
    items: s && s.maxItems > 0 ? Array.from({ length: s.minItems }, emptyItem) : [],
    video: { url: '', thumb: null },
    commerce: emptyCommerce(),
    introOn: false,
    intro: { header: '', content: '', image: null, urlMobile: '' },
    cards: s?.carousel ? Array.from({ length: s.carousel.listMin }, emptyCard) : [],
    tailOn: false, tailUrl: '',
  };
}

/** 코드포인트 글자 수 — 백엔드 charLen과 같은 자(이모지 서로게이트 쌍 = 1자) */
export const cpLen = (s: string): number => [...String(s || '')].length;
export const nlCount = (s: string): number => (String(s || '').match(/\n/g) || []).length;

/** '189,000' · '189000' → 189000. 그 밖은 null(입력을 고쳐 쓰지 않고 거절한다) */
export function parsePrice(raw: string): number | null {
  const v = String(raw || '').trim();
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(v)) return null;
  const n = Number(v.replace(/,/g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

/** 정상가·할인가로 할인율 자동 계산(정수 %). 계산할 수 없으면 빈 값 */
export function calcRate(regular: string, discount: string): string {
  const r = parsePrice(regular);
  const d = parsePrice(discount);
  if (r === null || d === null || r <= 0 || d > r) return '';
  return String(Math.round((1 - d / r) * 100));
}

/**
 * 링크 형식 — `http://` 또는 `https://`로 시작해야 한다. 변수(`#{...}`)로 시작하는 값은 치환 뒤에 정해지므로 통과.
 * ⛔ 자동으로 붙여 주지 않는다 — 고객이 넣은 주소를 우리가 바꾸지 않는다. 무엇을 고치면 되는지만 알려 준다.
 */
export const isWebLink = (raw: string): boolean => {
  const v = String(raw || '').trim();
  return /^https?:\/\/\S+$/i.test(v) || v.startsWith('#{');
};
/**
 * 링크 칸에서 포커스가 빠질 때의 정리 — `www.naver.com` 처럼 **도메인 형태인데 스킴이 없는 값**에만 `https://` 를 붙인다.
 * 규칙은 백엔드 `normalizeWebUrl`(utils/normalize.ts · 0702 이메일 링크 건)의 도메인 판정과 같다.
 * ⛔ 발송할 때 뒤에서 고치지 않는다. **칸에 보이는 값**을 바꾸므로 담당자가 나가는 주소를 그대로 본다.
 * 이미 `http(s)://` 로 시작하는 값 · 변수(`#{...}`)로 시작하는 값 · 도메인 형태가 아닌 값은 건드리지 않는다
 * (도메인 형태가 아닌 값은 아래 linkReason 이 사유와 함께 막는다).
 */
export const normalizeLinkInput = (raw: string): string => {
  const v = String(raw || '').trim();
  if (!v || /^https?:\/\//i.test(v) || v.startsWith('#{')) return v;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(v) ? `https://${v}` : v;
};

export const linkReason = (raw: string, at: string): string =>
  !String(raw || '').trim() || isWebLink(raw) ? '' : `${at} http:// 또는 https://로 시작해야 합니다 (예: https://www.example.com)`;

/** 프리미엄 동영상은 카카오TV 주소만 받는다(0920 실측 — 유튜브 주소는 카카오가 동영상 오류로 거절) */
export const isKakaoTvUrl = (raw: string): boolean => {
  try {
    const u = new URL(String(raw || '').trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.toLowerCase() === 'tv.kakao.com';
  } catch { return false; }
};

/** 가격 상한 — 카카오 규격 「정상가격·할인가격 (0 ~ 99,999,999)」 */
const PRICE_MAX = 99_999_999;

/** AI로 만든 이미지인가 — 5종의 이미지 자리는 안내 문구를 붙일 규칙이 없어 서버가 거절한다 */
const isGenerated = (img: SlotImage | null | undefined): boolean => !!img && img.kind === 'generated';
const AI_BLOCK_MSG = 'AI로 만든 이미지는 이 자리에 쓸 수 없습니다. 직접 올린 이미지를 사용해 주세요';

function commerceReason(c: CommerceState, at: string, titleMax: number): string {
  if (!c.title.trim()) return `${at} 상품명을 입력해 주세요`;
  if (cpLen(c.title.trim()) > titleMax) return `${at} 상품명은 최대 ${titleMax}자입니다`;
  if (!c.regular.trim()) return `${at} 정상가를 입력해 주세요`;
  if (parsePrice(c.regular) === null) return `${at} 정상가는 숫자로 입력해 주세요`;
  if ((parsePrice(c.regular) as number) > PRICE_MAX) return `${at} 정상가는 99,999,999원까지 입력할 수 있습니다`;
  if (c.discount.trim()) {
    const d = parsePrice(c.discount);
    if (d === null) return `${at} 할인가는 숫자로 입력해 주세요`;
    if (d > PRICE_MAX) return `${at} 할인가는 99,999,999원까지 입력할 수 있습니다`;
    if (d > (parsePrice(c.regular) as number)) return `${at} 할인가가 정상가보다 큽니다`;
    const rate = Number(c.rate);
    if (!c.rate.trim() || !Number.isInteger(rate) || rate < 0 || rate > 100) return `${at} 할인율을 0~100 사이로 입력해 주세요`;
  }
  return '';
}

function buttonsReason(buttons: RichButton[], at: string, max: number, nameMax: number, urlTypes: readonly string[]): string {
  if (buttons.length > max) return `${at} 버튼은 최대 ${max}개입니다`;
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (!b.name.trim()) return `${at} ${i + 1}번째 버튼의 버튼명을 입력해 주세요`;
    if (cpLen(b.name.trim()) > nameMax) return `${at} ${i + 1}번째 버튼명은 최대 ${nameMax}자입니다`;
    if (urlTypes.includes(b.type) && !(b.url_mobile || '').trim()) return `${at} ${i + 1}번째 버튼의 링크를 입력해 주세요`;
    const lr = urlTypes.includes(b.type) ? linkReason(b.url_mobile || '', `${at} ${i + 1}번째 버튼의 링크는`) : '';
    if (lr) return lr;
  }
  return '';
}

const ratioOf = (img: SlotImage | null | undefined): number | null => (img && img.w && img.h ? img.w / img.h : null);

/** 캐러셀의 비율 기준 — 인트로를 쓰면 인트로, 아니면 첫 카드. 화면(자리별 규격 안내)과 검사가 같은 기준을 쓴다 */
export function carouselRefRatio(st: RichState, useIntro: boolean): { ratio: number | null; name: string; isIntro: boolean } {
  if (useIntro && st.intro.image) return { ratio: ratioOf(st.intro.image), name: '인트로', isIntro: true };
  return { ratio: ratioOf(st.cards[0]?.image), name: '카드 1', isIntro: false };
}

/**
 * 보내기 전에 걸리는 것 — 첫 한 줄만. 빈 문자열이면 통과.
 * @param urlButtonTypes URL이 필요한 버튼 종류 코드(편집기 BUTTON_TYPES의 needUrl)
 */
export function richBlockReason(code: string, st: RichState, urlButtonTypes: readonly string[]): string {
  const s = BRAND_SPEC[code];
  if (!s) return '';

  // 헤더
  if (s.maxHeader > 0) {
    const h = st.header.trim();
    if (s.requireHeader && !h) return '헤더를 입력해 주세요';
    if (cpLen(h) > s.maxHeader) return `헤더는 최대 ${s.maxHeader}자입니다`;
    if (nlCount(h) > 0) return '헤더에는 줄바꿈을 넣을 수 없습니다';
  }

  // 와이드 리스트
  if (s.maxItems > 0) {
    if (st.items.length < s.minItems || st.items.length > s.maxItems) return `아이템은 ${s.minItems}~${s.maxItems}개여야 합니다`;
    for (let i = 0; i < st.items.length; i++) {
      const it = st.items[i];
      if (!it.image) return `${i + 1}번째 아이템의 이미지를 넣어 주세요`;
      if (isGenerated(it.image)) return AI_BLOCK_MSG;
      if (i > 0 && !it.title.trim()) return `${i + 1}번째 아이템의 제목을 입력해 주세요`;
      if (!it.urlMobile.trim()) return `${i + 1}번째 아이템의 링크를 입력해 주세요`;
      const lr = linkReason(it.urlMobile, `${i + 1}번째 아이템의 링크는`);
      if (lr) return lr;
    }
  }

  // 동영상
  if (s.requireVideo) {
    if (!st.video.url.trim()) return '동영상 주소를 입력해 주세요';
    if (!isKakaoTvUrl(st.video.url)) {
      return '동영상은 카카오TV 주소만 쓸 수 있습니다 (예: https://tv.kakao.com/v/123456789). 유튜브 등 다른 주소는 카카오가 받지 않습니다';
    }
    if (isGenerated(st.video.thumb)) return AI_BLOCK_MSG;
  }

  // 커머스(단일)
  if (s.requireCommerce && !s.carousel) {
    const r = commerceReason(st.commerce, '', s.maxCommerceTitle);
    if (r) return r.trim();
    const add = st.additional.trim();
    if (cpLen(add) > s.maxAdditional) return `부가 정보는 최대 ${s.maxAdditional}자입니다`;
    if (nlCount(add) > s.maxAdditionalNewline) return `부가 정보의 줄바꿈은 ${s.maxAdditionalNewline}개까지입니다`;
  }

  // 캐러셀
  const cs = s.carousel;
  if (cs) {
    const useIntro = cs.allowIntro && st.introOn;
    const min = useIntro ? cs.listMinWithIntro : cs.listMin;
    const max = useIntro ? cs.listMaxWithIntro : cs.listMax;
    if (st.cards.length < min || st.cards.length > max) {
      return useIntro ? `인트로를 쓰면 카드는 ${min}~${max}장입니다` : `카드는 ${min}~${max}장입니다`;
    }
    if (useIntro) {
      const ih = st.intro.header.trim();
      const ic = st.intro.content.trim();
      if (!ih) return '인트로 제목을 입력해 주세요';
      if (cpLen(ih) > cs.introHeaderMax) return `인트로 제목은 최대 ${cs.introHeaderMax}자입니다`;
      if (nlCount(ih) > 0) return '인트로 제목에는 줄바꿈을 넣을 수 없습니다';
      if (!ic) return '인트로 내용을 입력해 주세요';
      if (cpLen(ic) > cs.introContentMax) return `인트로 내용은 최대 ${cs.introContentMax}자입니다`;
      if (nlCount(ic) > cs.introContentNewline) return `인트로 내용의 줄바꿈은 ${cs.introContentNewline}개까지입니다`;
      if (!st.intro.image) return '인트로 이미지를 넣어 주세요';
      if (isGenerated(st.intro.image)) return AI_BLOCK_MSG;
      const ilr = linkReason(st.intro.urlMobile, '인트로 링크는');
      if (ilr) return ilr;
    }
    const ref = carouselRefRatio(st, useIntro);
    for (let i = 0; i < st.cards.length; i++) {
      const c = st.cards[i];
      const at = `카드 ${i + 1}:`;
      if (!c.image) return `${at} 이미지를 넣어 주세요`;
      if (isGenerated(c.image)) return AI_BLOCK_MSG;
      // 카드끼리 비율이 같아야 한다 — 기준 이미지를 나중에 바꾸면 이미 담긴 카드가 어긋난다
      const cr = ratioOf(c.image);
      if (ref.ratio && cr && !(i === 0 && !ref.isIntro) && !sameRatio(cr, ref.ratio)) {
        return `${at} 이미지 비율이 ${ref.name}과 다릅니다 (${ref.name} ${ratioLabel(ref.ratio)} · 이 카드 ${ratioLabel(cr)}). 이미지를 다시 선택하면 맞춰 드립니다`;
      }
      const clr = linkReason(c.imgLink, `${at} 이미지 링크는`);
      if (clr) return clr;
      if (cs.itemHeader === 'required') {
        if (!c.header.trim()) return `${at} 제목을 입력해 주세요`;
        if (cpLen(c.header.trim()) > cs.itemHeaderMax) return `${at} 제목은 최대 ${cs.itemHeaderMax}자입니다`;
        if (nlCount(c.header.trim()) > 0) return `${at} 제목에는 줄바꿈을 넣을 수 없습니다`;
      }
      if (cs.itemMessage === 'required') {
        if (!c.message.trim()) return `${at} 내용을 입력해 주세요`;
        if (cpLen(c.message.trim()) > cs.itemMessageMax) return `${at} 내용은 최대 ${cs.itemMessageMax}자입니다`;
        if (nlCount(c.message.trim()) > cs.itemMessageNewline) return `${at} 내용의 줄바꿈은 ${cs.itemMessageNewline}개까지입니다`;
      }
      if (cs.itemAdditional === 'allowed') {
        if (cpLen(c.additional.trim()) > cs.itemAdditionalMax) return `${at} 부가 정보는 최대 ${cs.itemAdditionalMax}자입니다`;
        if (nlCount(c.additional.trim()) > cs.itemAdditionalNewline) return `${at} 부가 정보의 줄바꿈은 ${cs.itemAdditionalNewline}개까지입니다`;
      }
      if (s.requireCommerce) {
        const r = commerceReason(c.commerce, at, s.maxCommerceTitle);
        if (r) return r;
      }
      const br = buttonsReason(c.buttons, at, cs.itemButtonMax, s.maxButtonName, urlButtonTypes);
      if (br) return br;
    }
    if (st.tailOn && !st.tailUrl.trim()) return '더보기 링크를 입력해 주세요';
    if (st.tailOn) {
      const tlr = linkReason(st.tailUrl, '더보기 링크는');
      if (tlr) return tlr;
    }
  }
  return '';
}

function toCommerce(c: CommerceState): Record<string, number | string> {
  const out: Record<string, number | string> = { title: c.title.trim(), regular_price: parsePrice(c.regular) ?? 0 };
  if (c.discount.trim()) {
    out.discount_price = parsePrice(c.discount) ?? 0;
    out.discount_rate = Number(c.rate);
  }
  return out;
}

const toImage = (img: SlotImage, link?: string) => ({
  img_url: img.url,
  ...(link && link.trim() ? { img_link: link.trim() } : {}),
  asset_id: img.assetId || undefined,   // AI 생성 판정용 — 카카오 전문에는 실리지 않는다
});

/** 발송 payload 중 5종이 더하는 부분 — 유형에 해당하는 값만 싣는다(화면에 없는 값이 따라 나가지 않게) */
export function richPayload(code: string, st: RichState): Record<string, any> {
  const s = BRAND_SPEC[code];
  if (!s) return {};
  const out: Record<string, any> = {};

  if (s.maxHeader > 0 && st.header.trim()) out.header = st.header.trim();
  if (s.maxAdditional > 0 && st.additional.trim()) out.additionalContent = st.additional.trim();

  if (s.maxItems > 0) {
    out.itemList = st.items.filter((it) => it.image).map((it) => ({
      ...(it.title.trim() ? { title: it.title.trim() } : {}),
      img_url: (it.image as SlotImage).url,
      url_mobile: it.urlMobile.trim(),
    }));
  }
  if (s.requireVideo) {
    out.video = {
      video_url: st.video.url.trim(),
      ...(st.video.thumb ? { thumbnail_url: st.video.thumb.url } : {}),
    };
  }
  if (s.requireCommerce && !s.carousel) out.commerce = toCommerce(st.commerce);

  const cs = s.carousel;
  if (cs) {
    if (cs.allowIntro && st.introOn && st.intro.image) {
      out.carouselHead = {
        header: st.intro.header.trim(),
        content: st.intro.content.trim(),
        image_url: st.intro.image.url,
        ...(st.intro.urlMobile.trim() ? { url_mobile: st.intro.urlMobile.trim() } : {}),
      };
    }
    out.carouselItems = st.cards.map((c) => ({
      ...(cs.itemHeader === 'required' ? { header: c.header.trim() } : {}),
      ...(cs.itemMessage === 'required' ? { message: c.message.trim() } : {}),
      ...(cs.itemAdditional === 'allowed' && c.additional.trim() ? { additional_content: c.additional.trim() } : {}),
      ...(c.image ? { image: toImage(c.image, c.imgLink) } : {}),
      ...(c.buttons.length > 0 ? { buttons: c.buttons.map((b) => ({ name: b.name.trim(), type: b.type, ...(b.url_mobile ? { url_mobile: b.url_mobile.trim() } : {}) })) } : {}),
      ...(s.requireCommerce ? { commerce: toCommerce(c.commerce) } : {}),
    }));
    if (st.tailOn && st.tailUrl.trim()) out.carouselTail = { url_mobile: st.tailUrl.trim() };
  }
  return out;
}
