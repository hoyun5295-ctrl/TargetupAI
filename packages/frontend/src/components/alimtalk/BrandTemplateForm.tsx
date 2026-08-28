/**
 * 브랜드메시지 템플릿 등록/수정/상세 — 8종 전면 (★2026-08-28 재작성)
 *
 * 무엇이 바뀌었나 (옛 판 대비)
 *   1. **규격 숫자를 화면이 갖지 않는다.** 전부 `constants/brand-message-spec.ts`(백엔드 CT 사본)에서 읽는다.
 *      옛 판은 maxLength를 손으로 적어 두어 백엔드와 갈라져 있었다 — 아이템 4/5, 캐러셀 6/10·11, 버튼명 14 고정.
 *   2. **규격 밖 키를 보내던 것 3건 정정.** `video:{url}`→`{video_url}` · 커머스 `discount_rate`·`discount_fixed` 신설 ·
 *      아이템 `url_mobile`(규격 필수) 신설. 옛 판으로 등록한 템플릿은 발송 검사를 통과할 수 없었다
 *      (등록 API는 규격을 검사하지 않고 IMC로 넘기므로 조용히 저장됐다).
 *   3. 캐러셀 3단(인트로 head · 카드 list · 더보기 tail) · 쿠폰 · 실시간 카운터(글자·줄바꿈·변수) 신설.
 *   4. 모달 → 전체 화면. 캐러셀 카드 6장을 편집하면서 결과를 봐야 해서 좌 편집 / 우 미리보기로 나눴다.
 *
 * ⛔ 규격 숫자를 이 파일에 적지 마라 — 백엔드를 고치고 사본을 다시 뽑는다. 어긋나면 파리티 테스트가 깨진다.
 * ⛔ `opened === false`인 유형은 등록만 되고 발송 화면에는 나오지 않는다. 그 사실을 화면이 먼저 말한다.
 *
 * 백엔드:
 *   POST /api/alimtalk/brand-templates                 (등록 — company_admin)
 *   PUT  /api/alimtalk/brand-templates/:templateKey    (수정)
 *   POST /api/alimtalk/images/brand/{default|wide|wide-list/first|wide-list|carousel-feed|carousel-commerce}
 */

import { useState, useMemo, type ReactNode } from 'react';
import { X, Plus, Copy, Trash2, Check, AlertCircle, Info } from 'lucide-react';
import {
  BRAND_SPEC,
  BRAND_TYPE_ORDER,
  BRAND_COUPON_TITLE_FORMS,
  type BrandSpec,
} from '../../constants/brand-message-spec';
import {
  CUI_BTN_OUTLINE,
  CUI_BTN_PRIMARY,
  CUI_INPUT,
  CUI_LABEL,
  CUI_REQUIRED,
  CUI_SELECT,
  CUI_TEXTAREA,
} from '../../utils/console-ui';

// ────────────────────────────────────────────────────────────
// 타입
// ────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  profile_key: string;
  profile_name: string;
}

interface BrandTemplate {
  id?: string;
  template_key?: string;
  manage_name?: string;
  chat_bubble_type?: string;
  status?: string;
  profile_id?: string;
  profile_key?: string | null;
  profile_name?: string | null;
  custom_template_code?: string | null;
  content?: string | null;
  header?: string | null;
  additional_content?: string | null;
  buttons?: any[] | null;
  attachment_json?: any;
  carousel_json?: any;
  coupon?: any;
  adult?: 'Y' | 'N' | null;
}

type ButtonType = 'WL' | 'AL' | 'BK' | 'MD' | 'AC' | 'BF';

interface BrandButton {
  name: string;
  type: ButtonType;
  url_mobile?: string;
  url_pc?: string;
  scheme_android?: string;
  scheme_ios?: string;
}

interface ItemState {
  title: string;
  img_url: string;
  url_mobile: string;
  url_pc: string;
}

interface CardState {
  header: string;
  message: string;
  additional_content: string;
  img_url: string;
  img_link: string;
  /** 커머스 카드 전용 */
  title: string;
  regular_price: number | '';
  discount_price: number | '';
  discount_rate: number | '';
  discount_fixed: number | '';
  buttons: BrandButton[];
}

interface FormState {
  profileId: string;
  templateKey: string;
  customTemplateCode: string;
  manageName: string;
  chatBubbleType: string;
  adult: 'Y' | 'N';
  header: string;
  content: string;
  additionalContent: string;
  image: { img_url: string; img_link: string } | null;
  itemList: ItemState[];
  video: { video_url: string; thumbnail_url: string };
  commerce: {
    title: string;
    regular_price: number | '';
    discount_price: number | '';
    discount_rate: number | '';
    discount_fixed: number | '';
  };
  introOn: boolean;
  intro: { header: string; content: string; image_url: string; url_mobile: string; url_pc: string };
  cards: CardState[];
  tailOn: boolean;
  tail: { url_mobile: string; url_pc: string };
  buttons: BrandButton[];
  couponOn: boolean;
  coupon: { title: string; description: string; url_mobile: string };
}

const BUTTON_TYPE_OPTIONS: { value: ButtonType; label: string }[] = [
  { value: 'WL', label: '웹링크' },
  { value: 'AL', label: '앱링크' },
  { value: 'BK', label: '봇키워드' },
  { value: 'MD', label: '메시지 디자이너' },
  { value: 'AC', label: '채널 추가' },
  { value: 'BF', label: '비즈폼' },
];

/**
 * 이미지 업로드 엔드포인트 — **경로와 multer 필드 형태를 한 쌍으로 묶는다.**
 *
 * ⛔ 둘을 따로 들고 다니면 반드시 어긋난다. 실제로 0828 자체 점검에서 세 자리가 어긋나 있었다
 *   (배열 엔드포인트에 `image` 한 장을 보내 카드·아이템 이미지 업로드가 전부 실패하는 상태였다).
 *   그래서 호출부는 필드명을 고르지 않는다 — `uploadImage`가 `multi`를 보고 정한다.
 *
 * 백엔드 = `routes/alimtalk.ts` `/images/brand/*` (single('image') / array('images')).
 */
interface ImageEndpoint { url: string; multi: boolean }

const IMG_EP = {
  default:          { url: '/api/alimtalk/images/brand/default',         multi: false },
  wide:             { url: '/api/alimtalk/images/brand/wide',            multi: false },
  wideListFirst:    { url: '/api/alimtalk/images/brand/wide-list/first', multi: false },
  wideList:         { url: '/api/alimtalk/images/brand/wide-list',       multi: true  },
  carouselFeed:     { url: '/api/alimtalk/images/brand/carousel-feed',   multi: true  },
  carouselCommerce: { url: '/api/alimtalk/images/brand/carousel-commerce', multi: true },
} as const satisfies Record<string, ImageEndpoint>;

/** 유형별 기본 이미지 엔드포인트 */
function imageEndpointFor(type: string): ImageEndpoint {
  if (type === 'WIDE') return IMG_EP.wide;
  if (type === 'CAROUSEL_FEED') return IMG_EP.carouselFeed;
  if (type === 'CAROUSEL_COMMERCE') return IMG_EP.carouselCommerce;
  return IMG_EP.default;
}

function getToken(): string {
  return localStorage.getItem('token') || '';
}

const emptyCard = (): CardState => ({
  header: '', message: '', additional_content: '', img_url: '', img_link: '',
  title: '', regular_price: '', discount_price: '', discount_rate: '', discount_fixed: '',
  buttons: [],
});

function initialFormState(template: BrandTemplate | null | undefined): FormState {
  const t = template || {};
  const att = t.attachment_json || {};
  const car = t.carousel_json || {};
  const com = att.commerce || {};
  const head = car.head || null;
  return {
    profileId: t.profile_id || '',
    templateKey: t.template_key || '',
    customTemplateCode: t.custom_template_code || '',
    manageName: t.manage_name || '',
    chatBubbleType: t.chat_bubble_type || 'TEXT',
    adult: (t.adult as 'Y' | 'N') || 'N',
    header: t.header || '',
    content: t.content || '',
    additionalContent: t.additional_content || '',
    image: att.image ? { img_url: att.image.img_url || '', img_link: att.image.img_link || '' } : null,
    itemList: (att.item?.list || []).map((it: any) => ({
      title: it.title || '', img_url: it.img_url || '',
      url_mobile: it.url_mobile || '', url_pc: it.url_pc || '',
    })),
    // ★ 규격 키는 `video_url`이다. 옛 판이 `url`로 저장한 값도 읽어 준다(마이그레이션 없이 화면에서 흡수).
    video: {
      video_url: att.video?.video_url || att.video?.url || '',
      thumbnail_url: att.video?.thumbnail_url || '',
    },
    commerce: {
      title: com.title || '',
      regular_price: com.regular_price ?? '',
      discount_price: com.discount_price ?? '',
      discount_rate: com.discount_rate ?? '',
      discount_fixed: com.discount_fixed ?? '',
    },
    introOn: !!head,
    intro: {
      header: head?.header || '', content: head?.content || '',
      image_url: head?.image_url || '', url_mobile: head?.url_mobile || '', url_pc: head?.url_pc || '',
    },
    cards: (car.list || []).map((c: any) => ({
      ...emptyCard(),
      header: c.header || '', message: c.message || '', additional_content: c.additional_content || '',
      img_url: c.attachment?.image?.img_url || '', img_link: c.attachment?.image?.img_link || '',
      title: c.attachment?.commerce?.title || '',
      regular_price: c.attachment?.commerce?.regular_price ?? '',
      discount_price: c.attachment?.commerce?.discount_price ?? '',
      discount_rate: c.attachment?.commerce?.discount_rate ?? '',
      discount_fixed: c.attachment?.commerce?.discount_fixed ?? '',
      buttons: c.attachment?.button || [],
    })),
    tailOn: !!car.tail,
    tail: { url_mobile: car.tail?.url_mobile || '', url_pc: car.tail?.url_pc || '' },
    buttons: (t.buttons as BrandButton[]) || [],
    couponOn: !!(t.coupon || att.coupon),
    coupon: {
      title: (t.coupon || att.coupon)?.title || '',
      description: (t.coupon || att.coupon)?.description || '',
      url_mobile: (t.coupon || att.coupon)?.url_mobile || '',
    },
  };
}

// ────────────────────────────────────────────────────────────
// 검사 헬퍼 — 값은 전부 BRAND_SPEC에서 온다
// ────────────────────────────────────────────────────────────

const nlCount = (s: string) => (String(s || '').match(/\n/g) || []).length;
const varList = (s: string) => String(s || '').match(/#\{[^}]*\}/g) || [];
const MAX_VARS = 20;

/** 쿠폰 제목 5형식 — 백엔드 `COUPON_TITLE_FORMS`와 같은 규칙(사본이라 어긋나면 백엔드가 최종 판정한다) */
const COUPON_RE: RegExp[] = [
  /^([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)원 할인 쿠폰$/,
  /^([0-9]+)% 할인 쿠폰$/,
  /^배송비 할인 쿠폰$/,
  /^(.{1,7}) 무료 쿠폰$/,
  /^(.{1,7}) UP 쿠폰$/,
];
const isCouponTitleOk = (t: string) => COUPON_RE.some((r) => r.test(String(t || '').trim()));

// ────────────────────────────────────────────────────────────
// 본체
// ────────────────────────────────────────────────────────────

interface Props {
  mode: 'create' | 'edit' | 'view';
  template?: BrandTemplate | null;
  profiles: Profile[];
  onClose: () => void;
  onSuccess: () => void;
  setToast?: (t: { show: boolean; type: 'success' | 'error'; message: string }) => void;
}

export default function BrandTemplateForm({ mode, template, profiles, onClose, onSuccess, setToast }: Props) {
  const isView = mode === 'view';
  const isEdit = mode === 'edit';

  const [form, setForm] = useState<FormState>(() => initialFormState(template));
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 캐러셀 편집 위치 — 'intro' | 카드 index | 'tail' */
  const [activeCard, setActiveCard] = useState<'intro' | 'tail' | number>(0);

  const spec: BrandSpec = BRAND_SPEC[form.chatBubbleType] || BRAND_SPEC.TEXT;
  const carSpec = spec.carousel;
  const useIntro = !!(carSpec?.allowIntro && form.introOn);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const patchCard = (idx: number, partial: Partial<CardState>) =>
    setForm((prev) => ({
      ...prev,
      cards: prev.cards.map((c, i) => (i === idx ? { ...c, ...partial } : c)),
    }));

  // ── 업로드 (옛 판의 요청·응답 처리를 그대로 보존) ─────────
  //   배열 엔드포인트는 여러 장을 받는 자리이지만 **한 장만 올려도 된다.**
  //   카드는 저마다 제목·내용·버튼을 가지므로 카드별로 따로 올리는 것이 규격에 맞다.
  const uploadImage = async (file: File, ep: ImageEndpoint): Promise<string | null> => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append(ep.multi ? 'images' : 'image', file);
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || '이미지 업로드 실패');
      const url = ep.multi
        ? (data.images || data.imc?.data?.list || [])
            .map((it: any) => it.imageUrl || it.url || it.imgUrl).filter(Boolean)[0]
        : (data.imageUrl || data.imc?.data?.imageUrl);
      if (!url) throw new Error('이미지 URL을 찾을 수 없습니다');
      return url;
    } catch (e: any) {
      setError(e?.message || '이미지 업로드 중 오류');
      return null;
    } finally {
      setUploading(false);
    }
  };

  // ── 유형 전환 ────────────────────────────────────────────
  const changeType = (next: string) => {
    if (isView || isEdit) return;
    const nextSpec = BRAND_SPEC[next];
    setForm((prev) => ({
      ...initialFormState(null),
      profileId: prev.profileId,
      manageName: prev.manageName,
      customTemplateCode: prev.customTemplateCode,
      adult: prev.adult,
      chatBubbleType: next,
      // 캐러셀은 최소 카드 수를 미리 깔아 준다(빈 화면에서 시작하면 무엇을 해야 할지 모른다)
      cards: nextSpec?.carousel ? Array.from({ length: nextSpec.carousel.listMin }, emptyCard) : [],
    }));
    setActiveCard(nextSpec?.carousel?.allowIntro ? 'intro' : 0);
    setError(null);
  };

  // ── 검사 ─────────────────────────────────────────────────
  const problems = useMemo<string[]>(() => {
    const p: string[] = [];
    if (!form.profileId) p.push('발신프로필을 선택해 주세요');
    if (!form.manageName.trim()) p.push('템플릿 관리명을 입력해 주세요');

    // 본문
    if (spec.maxMessage > 0) {
      if (!form.content.trim() && spec.code !== 'PREMIUM_VIDEO') p.push('본문을 입력해 주세요');
      if (form.content.length > spec.maxMessage) p.push(`본문이 ${spec.maxMessage}자를 넘습니다`);
      if (nlCount(form.content) > spec.maxNewline) p.push(`본문 줄바꿈이 ${spec.maxNewline}회를 넘습니다`);
    }
    if (varList(form.content).length > MAX_VARS) p.push(`변수는 ${MAX_VARS}개까지입니다`);

    // 헤더
    if (spec.requireHeader && !form.header.trim()) p.push('헤더를 입력해 주세요');
    if (spec.maxHeader > 0) {
      if (form.header.length > spec.maxHeader) p.push(`헤더가 ${spec.maxHeader}자를 넘습니다`);
      if (nlCount(form.header) > 0) p.push('헤더에는 줄바꿈을 넣을 수 없습니다');
    }

    // 부가 정보
    if (form.additionalContent && spec.maxAdditional === 0) p.push('이 유형은 부가 정보를 쓰지 않습니다');
    if (spec.maxAdditional > 0 && form.additionalContent.length > spec.maxAdditional) {
      p.push(`부가 정보가 ${spec.maxAdditional}자를 넘습니다`);
    }

    // 첨부
    if (spec.requireImage && !form.image?.img_url) p.push('이미지를 올려 주세요');
    if (spec.requireVideo && !form.video.video_url.trim()) p.push('동영상 주소를 입력해 주세요');
    if (spec.requireCommerce && !carSpec) {
      if (!form.commerce.title.trim()) p.push('상품명을 입력해 주세요');
      if (form.commerce.title.length > spec.maxCommerceTitle) p.push(`상품명이 ${spec.maxCommerceTitle}자를 넘습니다`);
      if (form.commerce.regular_price === '') p.push('정상가를 입력해 주세요');
      if (form.commerce.discount_price !== '' && form.commerce.discount_rate === '' && form.commerce.discount_fixed === '') {
        p.push('할인가를 넣으면 할인율 또는 정액할인가가 필요합니다');
      }
    }

    // 아이템 리스트
    if (spec.maxItems > 0) {
      if (form.itemList.length < spec.minItems || form.itemList.length > spec.maxItems) {
        p.push(`아이템은 ${spec.minItems}~${spec.maxItems}개여야 합니다`);
      }
      form.itemList.forEach((it, i) => {
        if (!it.img_url) p.push(`${i + 1}번째 아이템 이미지가 없습니다`);
        if (!it.url_mobile.trim()) p.push(`${i + 1}번째 아이템 모바일 링크가 없습니다`);
        if (i > 0 && !it.title.trim()) p.push(`${i + 1}번째 아이템 제목이 없습니다`);
      });
    }

    // 캐러셀
    if (carSpec) {
      const min = useIntro ? carSpec.listMinWithIntro : carSpec.listMin;
      const max = useIntro ? carSpec.listMaxWithIntro : carSpec.listMax;
      if (form.cards.length < min || form.cards.length > max) p.push(`카드는 ${min}~${max}장이어야 합니다`);
      if (useIntro) {
        if (!form.intro.header.trim()) p.push('인트로 제목이 없습니다');
        if (form.intro.header.length > carSpec.introHeaderMax) p.push(`인트로 제목이 ${carSpec.introHeaderMax}자를 넘습니다`);
        if (!form.intro.content.trim()) p.push('인트로 내용이 없습니다');
        if (form.intro.content.length > carSpec.introContentMax) p.push(`인트로 내용이 ${carSpec.introContentMax}자를 넘습니다`);
        if (nlCount(form.intro.content) > carSpec.introContentNewline) p.push(`인트로 줄바꿈이 ${carSpec.introContentNewline}회를 넘습니다`);
        if (!form.intro.image_url) p.push('인트로 이미지가 없습니다');
      }
      form.cards.forEach((c, i) => {
        const at = `카드 ${i + 1}`;
        if (!c.img_url) p.push(`${at} 이미지가 없습니다`);
        if (carSpec.itemHeader === 'required') {
          if (!c.header.trim()) p.push(`${at} 제목이 없습니다`);
          if (c.header.length > carSpec.itemHeaderMax) p.push(`${at} 제목이 ${carSpec.itemHeaderMax}자를 넘습니다`);
        }
        if (carSpec.itemMessage === 'required') {
          if (!c.message.trim()) p.push(`${at} 내용이 없습니다`);
          if (c.message.length > carSpec.itemMessageMax) p.push(`${at} 내용이 ${carSpec.itemMessageMax}자를 넘습니다`);
          if (nlCount(c.message) > carSpec.itemMessageNewline) p.push(`${at} 줄바꿈이 ${carSpec.itemMessageNewline}회를 넘습니다`);
        }
        if (c.additional_content && carSpec.itemAdditional === 'forbidden') p.push(`${at}는 부가 정보를 쓰지 않습니다`);
        if (c.additional_content.length > carSpec.itemAdditionalMax) p.push(`${at} 부가 정보가 ${carSpec.itemAdditionalMax}자를 넘습니다`);
        if (spec.requireCommerce && !c.title.trim()) p.push(`${at} 상품명이 없습니다`);
        if (c.discount_price !== '' && c.discount_rate === '' && c.discount_fixed === '') {
          p.push(`${at}: 할인가를 넣으면 할인율 또는 정액할인가가 필요합니다`);
        }
        if (c.buttons.length > carSpec.itemButtonMax) p.push(`${at} 버튼이 ${carSpec.itemButtonMax}개를 넘습니다`);
        c.buttons.forEach((b) => {
          if (b.name.length > spec.maxButtonName) p.push(`${at} 버튼명이 ${spec.maxButtonName}자를 넘습니다`);
        });
      });
      if (form.tailOn) {
        if (!form.tail.url_mobile.trim()) p.push('더보기 모바일 링크가 없습니다');
        if ([form.tail.url_mobile, form.tail.url_pc].some((v) => v.includes('#{'))) {
          p.push('더보기 링크에는 변수를 쓸 수 없습니다');
        }
      }
    }

    // 버튼 (캐러셀은 카드별로 갖는다)
    if (!carSpec) {
      const maxBtn = form.couponOn ? spec.couponMaxButtons : spec.maxButtons;
      if (form.buttons.length > maxBtn) p.push(`버튼은 최대 ${maxBtn}개입니다`);
      if (form.buttons.length < spec.minButtons) p.push(`버튼이 최소 ${spec.minButtons}개 필요합니다`);
      form.buttons.forEach((b, i) => {
        if (!b.name.trim()) p.push(`${i + 1}번째 버튼명이 없습니다`);
        if (b.name.length > spec.maxButtonName) p.push(`${i + 1}번째 버튼명이 ${spec.maxButtonName}자를 넘습니다`);
        if (b.type === 'WL' && !b.url_mobile?.trim()) p.push(`${i + 1}번째 버튼 모바일 링크가 없습니다`);
      });
    }

    // 쿠폰
    if (form.couponOn) {
      if (!isCouponTitleOk(form.coupon.title)) p.push('쿠폰 이름이 정해진 형식이 아닙니다');
      if (!form.coupon.description.trim()) p.push('쿠폰 설명을 입력해 주세요');
      if (form.coupon.description.length > spec.couponDescMax) p.push(`쿠폰 설명이 ${spec.couponDescMax}자를 넘습니다`);
      if (!form.coupon.url_mobile.trim()) p.push('쿠폰 링크를 입력해 주세요');
    }

    return p;
  }, [form, spec, carSpec, useIntro]);

  // ── 저장 ─────────────────────────────────────────────────
  const submit = async () => {
    if (problems.length > 0) {
      setError(problems[0]);
      return;
    }
    setSubmitting(true);
    setError(null);

    const num = (v: number | '') => (v === '' ? undefined : Number(v));
    const payload: any = {
      profileId: form.profileId,
      manageName: form.manageName.trim(),
      chatBubbleType: form.chatBubbleType,
      adult: form.adult,
    };
    if (form.templateKey.trim()) payload.templateKey = form.templateKey.trim();
    if (form.customTemplateCode.trim()) payload.customTemplateCode = form.customTemplateCode.trim();
    if (form.header.trim()) payload.header = form.header.trim();
    if (spec.maxMessage > 0 && form.content.trim()) payload.content = form.content.trim();
    if (spec.maxAdditional > 0 && form.additionalContent.trim()) payload.additionalContent = form.additionalContent.trim();

    // ── ATTACHMENT (규격 키 그대로) ──
    const att: any = {};
    if (form.image?.img_url) {
      att.image = { img_url: form.image.img_url, ...(form.image.img_link && { img_link: form.image.img_link }) };
    }
    if (spec.maxItems > 0 && form.itemList.length > 0) {
      att.item = {
        list: form.itemList.map((it) => ({
          ...(it.title.trim() && { title: it.title.trim() }),
          img_url: it.img_url,
          url_mobile: it.url_mobile.trim(),
          ...(it.url_pc.trim() && { url_pc: it.url_pc.trim() }),
        })),
      };
    }
    // ★ 규격 키는 `video_url`이다(옛 판은 `url`로 보내 발송 검사를 통과할 수 없었다).
    if (spec.requireVideo && form.video.video_url.trim()) {
      att.video = {
        video_url: form.video.video_url.trim(),
        ...(form.video.thumbnail_url && { thumbnail_url: form.video.thumbnail_url }),
      };
    }
    if (spec.requireCommerce && !carSpec && form.commerce.title.trim()) {
      att.commerce = {
        title: form.commerce.title.trim(),
        regular_price: num(form.commerce.regular_price),
        ...(form.commerce.discount_price !== '' && { discount_price: num(form.commerce.discount_price) }),
        ...(form.commerce.discount_rate !== '' && { discount_rate: num(form.commerce.discount_rate) }),
        ...(form.commerce.discount_fixed !== '' && { discount_fixed: num(form.commerce.discount_fixed) }),
      };
    }
    if (!carSpec && form.buttons.length > 0) att.button = form.buttons;
    if (form.couponOn) {
      att.coupon = {
        title: form.coupon.title.trim(),
        description: form.coupon.description.trim(),
        url_mobile: form.coupon.url_mobile.trim(),
      };
    }
    if (Object.keys(att).length > 0) payload.attachment = att;
    if (!carSpec && form.buttons.length > 0) payload.buttons = form.buttons;

    // ── CAROUSEL (head · list · tail) ──
    if (carSpec) {
      const carousel: any = {};
      if (useIntro) {
        carousel.head = {
          header: form.intro.header.trim(),
          content: form.intro.content.trim(),
          image_url: form.intro.image_url,
          ...(form.intro.url_mobile.trim() && { url_mobile: form.intro.url_mobile.trim() }),
          ...(form.intro.url_pc.trim() && { url_pc: form.intro.url_pc.trim() }),
        };
      }
      carousel.list = form.cards.map((c) => {
        const cAtt: any = {};
        if (c.img_url) cAtt.image = { img_url: c.img_url, ...(c.img_link && { img_link: c.img_link }) };
        if (c.buttons.length > 0) cAtt.button = c.buttons;
        if (spec.requireCommerce && c.title.trim()) {
          cAtt.commerce = {
            title: c.title.trim(),
            regular_price: num(c.regular_price),
            ...(c.discount_price !== '' && { discount_price: num(c.discount_price) }),
            ...(c.discount_rate !== '' && { discount_rate: num(c.discount_rate) }),
            ...(c.discount_fixed !== '' && { discount_fixed: num(c.discount_fixed) }),
          };
        }
        return {
          ...(carSpec.itemHeader === 'required' && c.header.trim() && { header: c.header.trim() }),
          ...(carSpec.itemMessage === 'required' && c.message.trim() && { message: c.message.trim() }),
          ...(carSpec.itemAdditional === 'allowed' && c.additional_content.trim() && {
            additional_content: c.additional_content.trim(),
          }),
          ...(Object.keys(cAtt).length > 0 && { attachment: cAtt }),
        };
      });
      if (form.tailOn) {
        carousel.tail = {
          url_mobile: form.tail.url_mobile.trim(),
          ...(form.tail.url_pc.trim() && { url_pc: form.tail.url_pc.trim() }),
        };
      }
      payload.carousel = carousel;
    }

    try {
      const targetKey = isEdit ? form.templateKey || template?.template_key || '' : '';
      const url = isEdit
        ? `/api/alimtalk/brand-templates/${encodeURIComponent(targetKey)}`
        : '/api/alimtalk/brand-templates';
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) throw new Error(data.error || '저장에 실패했습니다');
      setToast?.({ show: true, type: 'success', message: isEdit ? '수정되었습니다' : '등록되었습니다' });
      onSuccess();
    } catch (e: any) {
      setError(e?.message || '저장 중 오류가 발생했습니다');
    } finally {
      setSubmitting(false);
    }
  };

  const profileName = profiles.find((p) => p.id === form.profileId)?.profile_name || '';
  const titleText = isView ? '템플릿 상세' : isEdit ? '템플릿 수정' : '브랜드메시지 템플릿 등록';

  // ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
      {/* 헤더 */}
      <div className="sticky top-0 z-30 bg-white border-b border-neutral-200">
        <div className="max-w-[1560px] mx-auto px-5 sm:px-6 py-3.5 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center text-white font-bold text-[15px] shrink-0">
            BM
          </div>
          <div className="min-w-0">
            <div className="text-[17px] font-bold tracking-[-0.2px] truncate">{titleText}</div>
            <div className="text-[12.5px] text-neutral-500">카카오 비즈메시지 · 8종 유형</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={onClose} className={CUI_BTN_OUTLINE}>
              {isView ? '닫기' : '목록으로'}
            </button>
            {!isView && (
              <button
                type="button"
                onClick={submit}
                disabled={submitting || uploading}
                className={CUI_BTN_PRIMARY}
              >
                {submitting ? '저장 중' : isEdit ? '수정 완료' : '등록'}
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="닫기"
              className="w-9 h-9 rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 flex items-center justify-center">
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1560px] mx-auto px-5 sm:px-6 py-6 pb-28 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_372px] gap-7">
        {/* ═══════ 좌: 편집 ═══════ */}
        <div>
          {/* 기본 설정 */}
          <Card n={1} title="기본 설정">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="발신프로필" required>
                <select value={form.profileId} onChange={(e) => set('profileId', e.target.value)}
                  disabled={isView || isEdit} className={CUI_SELECT}>
                  <option value="">선택</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.profile_name}</option>)}
                </select>
              </Field>
              <Field label="발신프로필명">
                <input className={CUI_INPUT} value={profileName} disabled readOnly
                  placeholder="발신프로필을 고르면 자동으로 채워집니다" />
              </Field>
            </div>
            {/*
              관리명 200 · 관리코드 30은 **메시지 규격이 아니라 시스템 관리용 필드**라 BRAND_SPEC에 없다.
              백엔드 규격 검사기(assertBrandContentSpec)도 이 둘을 보지 않는다. 그래서 여기 숫자가 남아 있다.
            */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="템플릿 관리명" required hint="최대 200자">
                <input className={CUI_INPUT} value={form.manageName} disabled={isView} maxLength={200}
                  onChange={(e) => set('manageName', e.target.value)} placeholder="가을 신상 기획전_2609" />
              </Field>
              <Field label="관리코드" hint="고객사 내부 코드">
                <input className={`${CUI_INPUT} font-mono`} value={form.customTemplateCode} disabled={isView}
                  maxLength={30} onChange={(e) => set('customTemplateCode', e.target.value)} placeholder="AUTUMN_2609" />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-neutral-700 cursor-pointer">
              <input type="checkbox" className="w-[15px] h-[15px] accent-indigo-600" disabled={isView}
                checked={form.adult === 'Y'} onChange={(e) => set('adult', e.target.checked ? 'Y' : 'N')} />
              연령 인증 설정
              <span className="text-[11.5px] text-neutral-400">
                체크하면 성인 인증을 거친 사용자만 볼 수 있습니다 (주류·성인물 등)
              </span>
            </label>
          </Card>

          {/* 유형 */}
          <Card n={2} title="메시지 유형"
            aside={!isView && !isEdit ? '유형을 바꾸면 아래 입력이 초기화됩니다' : '수정 시 유형은 바꿀 수 없습니다'}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {BRAND_TYPE_ORDER.map((code) => {
                const s = BRAND_SPEC[code];
                const on = form.chatBubbleType === code;
                return (
                  <button key={code} type="button" onClick={() => changeType(code)}
                    disabled={isView || isEdit}
                    className={`relative text-left rounded-xl border p-2.5 transition ${
                      on ? 'border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600' : 'border-neutral-200 hover:bg-neutral-50'
                    } ${isView || isEdit ? 'opacity-70 cursor-not-allowed' : ''}`}>
                    {!s.opened && (
                      <span className="absolute top-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                        발송 준비 중
                      </span>
                    )}
                    <div className={`text-[13px] font-bold ${on ? 'text-indigo-700' : 'text-neutral-800'}`}>{s.label}</div>
                    <div className="text-[11.5px] text-neutral-500 mt-0.5 leading-snug">{typeDesc(s)}</div>
                  </button>
                );
              })}
            </div>
            {!spec.opened && (
              <Note tone="warn">
                <b>발송 준비 중인 유형입니다.</b> 지금은 템플릿 등록만 되고 발송 화면에는 아직 나타나지 않습니다.
              </Note>
            )}
          </Card>

          {/* 캐러셀 카드 매니저 */}
          {carSpec && (
            <div className="sticky top-[69px] z-20 bg-white border border-neutral-200 rounded-xl p-2 mb-3.5 flex gap-1.5 overflow-x-auto">
              {carSpec.allowIntro && (
                <CardTab on={activeCard === 'intro'} onClick={() => setActiveCard('intro')}>인트로</CardTab>
              )}
              {form.cards.map((_, i) => (
                <CardTab key={i} on={activeCard === i} onClick={() => setActiveCard(i)}>카드 {i + 1}</CardTab>
              ))}
              {!isView && form.cards.length < (useIntro ? carSpec.listMaxWithIntro : carSpec.listMax) && (
                <button type="button"
                  onClick={() => { setForm((p) => ({ ...p, cards: [...p.cards, emptyCard()] })); setActiveCard(form.cards.length); }}
                  className="h-8 px-3 rounded-lg text-[12.5px] font-bold text-indigo-600 border border-dashed border-neutral-300 hover:bg-indigo-50 shrink-0 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> 카드
                </button>
              )}
              <CardTab on={activeCard === 'tail'} onClick={() => setActiveCard('tail')} className="ml-auto">더보기</CardTab>
            </div>
          )}

          {/* 동적 본문 */}
          {carSpec
            ? renderCarouselEditor()
            : (
              <Card n={3} title="템플릿 내용">
                {/* 헤더 */}
                {spec.maxHeader > 0 && (
                  <Field label="헤더" required={spec.requireHeader} hint={`최대 ${spec.maxHeader}자 · 줄바꿈 불가`}>
                    <input className={CUI_INPUT} value={form.header} disabled={isView}
                      onChange={(e) => set('header', e.target.value.replace(/\n/g, ''))} maxLength={spec.maxHeader} />
                    <Counter value={form.header} max={spec.maxHeader} maxNl={0} />
                  </Field>
                )}

                {/* 이미지 */}
                {spec.requireImage && (
                  <Field label="이미지" required hint="jpg · png · 최대 5MB">
                    <ImagePicker
                      disabled={isView || uploading}
                      url={form.image?.img_url || ''}
                      link={form.image?.img_link || ''}
                      onPick={async (file) => {
                        const url = await uploadImage(file, imageEndpointFor(form.chatBubbleType));
                        if (url) set('image', { img_url: url, img_link: form.image?.img_link || '' });
                      }}
                      onLink={(v) => set('image', { img_url: form.image?.img_url || '', img_link: v })}
                    />
                  </Field>
                )}

                {/* 동영상 */}
                {spec.requireVideo && (
                  <>
                    <Field label="동영상 주소" required hint="카카오TV에 먼저 올린 영상만 됩니다">
                      <input className={`${CUI_INPUT} font-mono`} value={form.video.video_url} disabled={isView}
                        onChange={(e) => set('video', { ...form.video, video_url: e.target.value })}
                        placeholder="https://tv.kakao.com/v/..." />
                      {form.video.video_url.trim() && !/^https?:\/\/(tv\.kakao\.com|kakaotv)/.test(form.video.video_url.trim()) && (
                        <Note tone="warn">카카오TV 주소가 아닙니다. 다른 주소는 카카오가 받지 않습니다.</Note>
                      )}
                    </Field>
                    <Field label="커버 이미지" hint="비워 두면 영상 첫 장면을 씁니다">
                      <ImagePicker disabled={isView || uploading} url={form.video.thumbnail_url}
                        onPick={async (file) => {
                          const url = await uploadImage(file, IMG_EP.default);
                          if (url) set('video', { ...form.video, thumbnail_url: url });
                        }} />
                    </Field>
                  </>
                )}

                {/* 커머스 */}
                {spec.requireCommerce && (
                  <>
                    <Field label="상품명" required hint={`최대 ${spec.maxCommerceTitle}자 · 줄바꿈 불가`}>
                      <input className={CUI_INPUT} value={form.commerce.title} disabled={isView}
                        maxLength={spec.maxCommerceTitle}
                        onChange={(e) => set('commerce', { ...form.commerce, title: e.target.value.replace(/\n/g, '') })} />
                      <Counter value={form.commerce.title} max={spec.maxCommerceTitle} maxNl={0} />
                    </Field>
                    <PriceRow disabled={isView} value={form.commerce}
                      onChange={(v) => set('commerce', { ...form.commerce, ...v })} />
                  </>
                )}

                {/* 본문 */}
                {spec.maxMessage > 0 && (
                  <Field label="본문" required={spec.code !== 'PREMIUM_VIDEO'}
                    hint={`최대 ${spec.maxMessage}자 · 줄바꿈 ${spec.maxNewline}회`}>
                    <textarea className={CUI_TEXTAREA} rows={spec.maxMessage > 400 ? 6 : 3} disabled={isView}
                      value={form.content} onChange={(e) => set('content', e.target.value)} />
                    <Counter value={form.content} max={spec.maxMessage} maxNl={spec.maxNewline} vars />
                    <VarChips onPick={(v) => set('content', form.content + v)} disabled={isView} />
                  </Field>
                )}

                {/* 부가 정보 */}
                {spec.maxAdditional > 0 && (
                  <Field label="부가 정보" hint={`최대 ${spec.maxAdditional}자 · 줄바꿈 ${spec.maxAdditionalNewline}회`}>
                    <input className={CUI_INPUT} value={form.additionalContent} disabled={isView}
                      maxLength={spec.maxAdditional}
                      onChange={(e) => set('additionalContent', e.target.value)} />
                    <Counter value={form.additionalContent} max={spec.maxAdditional} maxNl={spec.maxAdditionalNewline} />
                    <Note tone="info">무료배송 · 당일출고 · 한정수량처럼 핵심만 넣는 것이 좋습니다.</Note>
                  </Field>
                )}

                {/* 아이템 리스트 */}
                {spec.maxItems > 0 && renderItemList()}
              </Card>
            )}

          {/* 버튼 (캐러셀은 카드별) */}
          {!carSpec && (
            <Card n={4} title="버튼"
              aside={`${form.buttons.length}/${form.couponOn ? spec.couponMaxButtons : spec.maxButtons}개 · 버튼명 최대 ${spec.maxButtonName}자`}>
              <ButtonRows disabled={isView} buttons={form.buttons} maxName={spec.maxButtonName}
                max={form.couponOn ? spec.couponMaxButtons : spec.maxButtons}
                onChange={(b) => set('buttons', b)} />
              {form.couponOn && (
                <Note tone="info">쿠폰을 함께 쓰면 버튼 상한이 {spec.couponMaxButtons}개로 줄어듭니다.</Note>
              )}
            </Card>
          )}

          {/* 쿠폰 */}
          <Card n={carSpec ? 4 : 5} title="쿠폰 강조"
            right={
              <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700 cursor-pointer">
                <input type="checkbox" className="w-[15px] h-[15px] accent-indigo-600" disabled={isView}
                  checked={form.couponOn} onChange={(e) => set('couponOn', e.target.checked)} />
                사용
              </label>
            }>
            {form.couponOn && (
              <>
                <Field label="쿠폰 이름" required>
                  <input className={CUI_INPUT} value={form.coupon.title} disabled={isView}
                    onChange={(e) => set('coupon', { ...form.coupon, title: e.target.value })}
                    placeholder="10% 할인 쿠폰" />
                  <Note tone="info">
                    정해진 형식만 등록됩니다. {BRAND_COUPON_TITLE_FORMS.map((f, i) => (
                      <b key={f}>{i > 0 ? ' · ' : ''}{f}</b>
                    ))}
                  </Note>
                  {form.coupon.title.trim() && (
                    isCouponTitleOk(form.coupon.title)
                      ? <Note tone="ok">등록할 수 있는 형식입니다.</Note>
                      : <Note tone="error">이 형식은 카카오가 받지 않습니다. 위 다섯 가지 중 하나로 적어 주세요.</Note>
                  )}
                </Field>
                <Field label="쿠폰 설명" required hint={`최대 ${spec.couponDescMax}자`}>
                  <input className={CUI_INPUT} value={form.coupon.description} disabled={isView}
                    maxLength={spec.couponDescMax}
                    onChange={(e) => set('coupon', { ...form.coupon, description: e.target.value })} />
                  <Counter value={form.coupon.description} max={spec.couponDescMax} maxNl={0} />
                </Field>
                <Field label="쿠폰 클릭 시 이동할 주소" required>
                  <input className={`${CUI_INPUT} font-mono`} value={form.coupon.url_mobile} disabled={isView}
                    onChange={(e) => set('coupon', { ...form.coupon, url_mobile: e.target.value })}
                    placeholder="https://" />
                </Field>
              </>
            )}
          </Card>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[13px] p-3.5 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}
        </div>

        {/* ═══════ 우: 미리보기 ═══════ */}
        <div className="xl:sticky xl:top-[88px] xl:self-start">
          <div className="flex items-center gap-2 mb-2.5">
            <b className="text-[13px]">미리보기</b>
          </div>
          <Preview form={form} spec={spec} useIntro={useIntro} profileName={profileName} />
          <div className="text-[10px] text-black/30 italic mt-2 text-right">
            Data source: 입력값 실시간 반영 (실제 발송본과 서체는 다를 수 있습니다)
          </div>
        </div>
      </div>

      {/* 하단 상태 바 */}
      {!isView && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 px-5 sm:px-6 py-2.5 z-40">
          <div className="max-w-[1560px] mx-auto flex items-center gap-3">
            <div className="text-[12.5px] text-neutral-600 truncate">
              {problems.length > 0
                ? <><b className="text-rose-600">{problems.length}건</b> 확인이 필요합니다 · {problems[0]}</>
                : <><b className="text-emerald-700">규격 통과</b> · {spec.label} · 등록할 수 있습니다</>}
            </div>
            <div className="ml-auto flex gap-2 shrink-0">
              <button type="button" onClick={onClose} className={CUI_BTN_OUTLINE}>취소</button>
              <button type="button" onClick={submit} disabled={submitting || uploading} className={CUI_BTN_PRIMARY}>
                {submitting ? '저장 중' : isEdit ? '수정 완료' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // ────────────────────────────────────────────────────────
  // 아이템 리스트
  // ────────────────────────────────────────────────────────
  function renderItemList() {
    return (
      <Field label="아이템 리스트" required
        hint={`${form.itemList.length}/${spec.maxItems}개 · 최소 ${spec.minItems}개`}>
        <div className="border border-neutral-200 rounded-xl overflow-hidden">
          {form.itemList.map((it, i) => {
            const first = i === 0;
            const titleMax = first ? 25 : 30;
            return (
              <div key={i} className="p-3 border-b border-neutral-200 last:border-b-0 grid grid-cols-[34px_1fr_72px_30px] gap-2.5 items-start">
                <div className="pt-2">
                  <span className={`inline-flex items-center h-[23px] px-2 rounded-md text-[11px] font-bold ${
                    first ? 'bg-indigo-50 text-indigo-700' : 'bg-neutral-100 text-neutral-600'}`}>{i + 1}</span>
                </div>
                <div className="min-w-0">
                  <input className={`${CUI_INPUT} h-[34px]`} value={it.title} disabled={isView} maxLength={titleMax}
                    placeholder={first ? '메인 아이템 제목 (선택)' : '아이템 제목'}
                    onChange={(e) => setForm((p) => ({
                      ...p, itemList: p.itemList.map((x, j) => j === i ? { ...x, title: e.target.value } : x),
                    }))} />
                  <Counter value={it.title} max={titleMax} maxNl={1} />
                  <div className="grid grid-cols-2 gap-2 mt-1.5">
                    <input className={`${CUI_INPUT} h-8 font-mono`} value={it.url_mobile} disabled={isView}
                      placeholder="Mobile 링크 (필수)"
                      onChange={(e) => setForm((p) => ({
                        ...p, itemList: p.itemList.map((x, j) => j === i ? { ...x, url_mobile: e.target.value } : x),
                      }))} />
                    <input className={`${CUI_INPUT} h-8 font-mono`} value={it.url_pc} disabled={isView}
                      placeholder="PC 링크 (선택)"
                      onChange={(e) => setForm((p) => ({
                        ...p, itemList: p.itemList.map((x, j) => j === i ? { ...x, url_pc: e.target.value } : x),
                      }))} />
                  </div>
                  <div className="mt-1.5">
                    <ImagePicker compact disabled={isView || uploading} url={it.img_url}
                      onPick={async (file) => {
                        // 1번은 single('image'), 2번부터는 array('images') — 필드명이 다르다
                        const url = first
                          ? await uploadImage(file, IMG_EP.wideListFirst)
                          : await uploadImage(file, IMG_EP.wideList);
                        if (url) setForm((p) => ({
                          ...p, itemList: p.itemList.map((x, j) => j === i ? { ...x, img_url: url } : x),
                        }));
                      }} />
                  </div>
                </div>
                <div className="pt-2">
                  <span className="inline-flex items-center h-[23px] px-2 rounded-md text-[11px] font-bold bg-neutral-100 text-neutral-600">
                    {first ? '2:1' : '1:1'}
                  </span>
                </div>
                <div>
                  {!isView && !first && form.itemList.length > spec.minItems && (
                    <button type="button" aria-label="아이템 삭제"
                      onClick={() => setForm((p) => ({ ...p, itemList: p.itemList.filter((_, j) => j !== i) }))}
                      className="w-7 h-7 rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {form.itemList.length === 0 && (
            <div className="p-6 text-center text-[12.5px] text-neutral-400 bg-neutral-50">
              아이템이 없습니다. 최소 {spec.minItems}개가 필요합니다.
            </div>
          )}
        </div>
        {!isView && form.itemList.length < spec.maxItems && (
          <button type="button"
            onClick={() => setForm((p) => ({ ...p, itemList: [...p.itemList, { title: '', img_url: '', url_mobile: '', url_pc: '' }] }))}
            className="mt-2 h-[30px] px-3 rounded-lg border border-neutral-300 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-50 inline-flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> 아이템 추가
          </button>
        )}
        <Note tone="info">
          <b>1번 아이템은 2:1</b>, 나머지는 <b>1:1 정방형</b>입니다. 1번은 지울 수 없습니다.
        </Note>
      </Field>
    );
  }

  // ────────────────────────────────────────────────────────
  // 캐러셀 편집
  // ────────────────────────────────────────────────────────
  function renderCarouselEditor() {
    if (!carSpec) return null;

    if (activeCard === 'intro') {
      return (
        <Card n={3} title="캐러셀 인트로"
          right={carSpec.allowIntro ? (
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700 cursor-pointer">
              <input type="checkbox" className="w-[15px] h-[15px] accent-indigo-600" disabled={isView}
                checked={form.introOn} onChange={(e) => set('introOn', e.target.checked)} />
              사용
            </label>
          ) : undefined}>
          {!carSpec.allowIntro ? (
            <Note tone="warn">인트로는 <b>캐러셀 커머스</b>에서만 씁니다.</Note>
          ) : !form.introOn ? (
            <Note tone="info">
              인트로를 쓰지 않으면 카드는 <b>{carSpec.listMin}~{carSpec.listMax}장</b>입니다.
              쓰면 인트로 1장과 카드 {carSpec.listMinWithIntro}~{carSpec.listMaxWithIntro}장이 됩니다.
            </Note>
          ) : (
            <>
              <Field label="인트로 제목" required hint={`최대 ${carSpec.introHeaderMax}자 · 줄바꿈 불가`}>
                <input className={CUI_INPUT} value={form.intro.header} disabled={isView}
                  maxLength={carSpec.introHeaderMax}
                  onChange={(e) => set('intro', { ...form.intro, header: e.target.value.replace(/\n/g, '') })} />
                <Counter value={form.intro.header} max={carSpec.introHeaderMax} maxNl={0} />
              </Field>
              <Field label="인트로 내용" required
                hint={`최대 ${carSpec.introContentMax}자 · 줄바꿈 ${carSpec.introContentNewline}회`}>
                <textarea className={CUI_TEXTAREA} rows={2} value={form.intro.content} disabled={isView}
                  maxLength={carSpec.introContentMax}
                  onChange={(e) => set('intro', { ...form.intro, content: e.target.value })} />
                <Counter value={form.intro.content} max={carSpec.introContentMax} maxNl={carSpec.introContentNewline} vars />
              </Field>
              <Field label="인트로 이미지" required hint="이 비율이 모든 카드의 기준이 됩니다">
                <ImagePicker disabled={isView || uploading} url={form.intro.image_url}
                  onPick={async (file) => {
                    // 캐러셀 엔드포인트는 array('images')다
                    const url = await uploadImage(file, imageEndpointFor(form.chatBubbleType));
                    if (url) set('intro', { ...form.intro, image_url: url });
                  }} />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Mobile 링크">
                  <input className={`${CUI_INPUT} font-mono`} value={form.intro.url_mobile} disabled={isView}
                    onChange={(e) => set('intro', { ...form.intro, url_mobile: e.target.value })} placeholder="https://" />
                </Field>
                <Field label="PC 링크">
                  <input className={`${CUI_INPUT} font-mono`} value={form.intro.url_pc} disabled={isView}
                    onChange={(e) => set('intro', { ...form.intro, url_pc: e.target.value })} placeholder="https://" />
                </Field>
              </div>
              <Note tone="info">다른 링크를 넣으면 Mobile 링크가 반드시 있어야 합니다.</Note>
            </>
          )}
        </Card>
      );
    }

    if (activeCard === 'tail') {
      return (
        <Card n={3} title="캐러셀 더보기"
          right={
            <label className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700 cursor-pointer">
              <input type="checkbox" className="w-[15px] h-[15px] accent-indigo-600" disabled={isView}
                checked={form.tailOn} onChange={(e) => set('tailOn', e.target.checked)} />
              사용
            </label>
          }>
          <Note tone="info">
            카드를 모두 넘긴 <b>맨 마지막</b>에 고정으로 붙는 카드입니다. 브랜드 메인이나 전체 목록으로 보낼 때 씁니다.
          </Note>
          {form.tailOn && (
            <>
              <Field label="Mobile 링크" required>
                <input className={`${CUI_INPUT} font-mono`} value={form.tail.url_mobile} disabled={isView}
                  onChange={(e) => set('tail', { ...form.tail, url_mobile: e.target.value })} placeholder="https://" />
              </Field>
              <Field label="PC 링크">
                <input className={`${CUI_INPUT} font-mono`} value={form.tail.url_pc} disabled={isView}
                  onChange={(e) => set('tail', { ...form.tail, url_pc: e.target.value })} placeholder="https://" />
              </Field>
              <Note tone="warn">
                더보기 카드에는 <b>변수를 쓸 수 없습니다.</b> 치환이 일어나지 않아 주소에 그대로 남습니다.
              </Note>
            </>
          )}
        </Card>
      );
    }

    const i = activeCard as number;
    const card = form.cards[i];
    if (!card) return null;
    const minCards = useIntro ? carSpec.listMinWithIntro : carSpec.listMin;

    return (
      <Card n={3} title={`카드 ${i + 1}`}
        right={!isView ? (
          <div className="flex gap-1.5">
            <SmallBtn onClick={() => {
              setForm((p) => {
                const cards = [...p.cards];
                cards.splice(i + 1, 0, JSON.parse(JSON.stringify(card)));
                return { ...p, cards };
              });
              setActiveCard(i + 1);
            }}><Copy className="w-3.5 h-3.5" /> 복사</SmallBtn>
            <SmallBtn onClick={() => setForm((p) => ({
              ...p,
              cards: p.cards.map((c, j) => j === i ? c : {
                ...c, additional_content: card.additional_content, buttons: JSON.parse(JSON.stringify(card.buttons)),
              }),
            }))}>모든 카드에 적용</SmallBtn>
            {form.cards.length > minCards && (
              <SmallBtn danger onClick={() => {
                setForm((p) => ({ ...p, cards: p.cards.filter((_, j) => j !== i) }));
                setActiveCard(Math.max(0, i - 1));
              }}><Trash2 className="w-3.5 h-3.5" /> 삭제</SmallBtn>
            )}
          </div>
        ) : undefined}>
        <Field label="카드 이미지" required hint="첫 카드와 같은 비율이어야 합니다">
          <ImagePicker disabled={isView || uploading} url={card.img_url} link={card.img_link}
            onPick={async (file) => {
              // 캐러셀 엔드포인트는 array('images')다
              const url = await uploadImage(file, imageEndpointFor(form.chatBubbleType));
              if (url) patchCard(i, { img_url: url });
            }}
            onLink={(v) => patchCard(i, { img_link: v })} />
        </Field>

        {carSpec.itemHeader === 'required' ? (
          <Field label="제목" required hint={`최대 ${carSpec.itemHeaderMax}자 · 줄바꿈 불가`}>
            <input className={CUI_INPUT} value={card.header} disabled={isView} maxLength={carSpec.itemHeaderMax}
              onChange={(e) => patchCard(i, { header: e.target.value.replace(/\n/g, '') })} />
            <Counter value={card.header} max={carSpec.itemHeaderMax} maxNl={0} />
          </Field>
        ) : null}

        {carSpec.itemMessage === 'required' ? (
          <Field label="내용" required
            hint={`최대 ${carSpec.itemMessageMax}자 · 줄바꿈 ${carSpec.itemMessageNewline}회`}>
            <textarea className={CUI_TEXTAREA} rows={3} value={card.message} disabled={isView}
              maxLength={carSpec.itemMessageMax}
              onChange={(e) => patchCard(i, { message: e.target.value })} />
            <Counter value={card.message} max={carSpec.itemMessageMax} maxNl={carSpec.itemMessageNewline} vars />
          </Field>
        ) : (
          <Note tone="warn">
            캐러셀 커머스는 <b>제목과 내용을 쓰지 않습니다.</b> 상품명과 가격이 그 자리를 씁니다.
          </Note>
        )}

        {spec.requireCommerce && (
          <>
            <Field label="상품명" required hint={`최대 ${spec.maxCommerceTitle}자 · 줄바꿈 불가`}>
              <input className={CUI_INPUT} value={card.title} disabled={isView}
                maxLength={spec.maxCommerceTitle}
                onChange={(e) => patchCard(i, { title: e.target.value.replace(/\n/g, '') })} />
              <Counter value={card.title} max={spec.maxCommerceTitle} maxNl={0} />
            </Field>
            <PriceRow disabled={isView} value={card} onChange={(v) => patchCard(i, v)} />
          </>
        )}

        {carSpec.itemAdditional === 'allowed' && (
          <Field label="부가 정보"
            hint={`최대 ${carSpec.itemAdditionalMax}자 · 줄바꿈 ${carSpec.itemAdditionalNewline}회`}>
            <input className={CUI_INPUT} value={card.additional_content} disabled={isView}
              maxLength={carSpec.itemAdditionalMax}
              onChange={(e) => patchCard(i, { additional_content: e.target.value })} />
            <Counter value={card.additional_content} max={carSpec.itemAdditionalMax} maxNl={carSpec.itemAdditionalNewline} />
          </Field>
        )}

        <Field label="카드 버튼" hint={`카드당 최대 ${carSpec.itemButtonMax}개 · 버튼명 ${spec.maxButtonName}자`}>
          <ButtonRows disabled={isView} buttons={card.buttons} max={carSpec.itemButtonMax}
            maxName={spec.maxButtonName} onChange={(b) => patchCard(i, { buttons: b })} />
        </Field>
      </Card>
    );
  }
}

// ────────────────────────────────────────────────────────────
// 표시용 서브 컴포넌트
// ────────────────────────────────────────────────────────────

function typeDesc(s: BrandSpec): string {
  if (s.carousel) {
    return s.carousel.allowIntro
      ? `상품 카드 ${s.carousel.listMin}~${s.carousel.listMax}장`
      : `카드 ${s.carousel.listMin}~${s.carousel.listMax}장`;
  }
  if (s.maxItems > 0) return `헤더 + 아이템 ${s.minItems}~${s.maxItems}`;
  if (s.requireVideo) return '카카오TV + 텍스트';
  if (s.requireCommerce) return '상품 + 가격';
  if (s.requireImage) return `이미지 + 본문 ${s.maxMessage}자`;
  return `본문 ${s.maxMessage.toLocaleString()}자`;
}

function Card({ n, title, aside, right, children }: {
  n: number; title: string; aside?: string; right?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="border border-neutral-200 rounded-2xl bg-white mb-4 overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-200 bg-neutral-50 flex items-center gap-2.5">
        <span className="w-[19px] h-[19px] rounded-md bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          {n}
        </span>
        <b className="text-[13.5px]">{title}</b>
        {aside && <span className="text-[11.5px] text-neutral-400 ml-auto truncate">{aside}</span>}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, required, hint, children }: {
  label: string; required?: boolean; hint?: string; children: ReactNode;
}) {
  return (
    <div>
      <label className={`${CUI_LABEL} flex items-center gap-1.5`}>
        {label}
        {required && <span className={CUI_REQUIRED}>*</span>}
        {hint && <span className="text-[11.5px] text-neutral-400 font-normal ml-auto">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Counter({ value, max, maxNl, vars }: { value: string; max: number; maxNl?: number; vars?: boolean }) {
  const len = String(value || '').length;
  const nl = nlCount(value);
  const v = varList(value).length;
  return (
    <div className="flex gap-3 justify-end mt-1 text-[11.5px] text-neutral-400 tabular-nums">
      <span className={len > max ? 'text-rose-600 font-bold' : len > max * 0.9 ? 'text-amber-600 font-semibold' : ''}>
        {len}/{max}자
      </span>
      {maxNl !== undefined && (
        maxNl === 0
          ? <span className={nl > 0 ? 'text-rose-600 font-bold' : ''}>줄바꿈 불가</span>
          : <span className={nl > maxNl ? 'text-rose-600 font-bold' : ''}>줄바꿈 {nl}/{maxNl}</span>
      )}
      {vars && v > 0 && (
        <span className={v > MAX_VARS ? 'text-rose-600 font-bold' : ''}>변수 {v}/{MAX_VARS}</span>
      )}
    </div>
  );
}

function Note({ tone, children }: { tone: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode }) {
  const cls = {
    info: 'bg-indigo-50 text-indigo-800',
    warn: 'bg-amber-50 text-amber-800',
    error: 'bg-rose-50 text-rose-800',
    ok: 'bg-emerald-50 text-emerald-800',
  }[tone];
  const Icon = tone === 'ok' ? Check : tone === 'info' ? Info : AlertCircle;
  return (
    <div className={`rounded-lg px-3 py-2 text-[12px] leading-relaxed flex gap-2 items-start mt-2 ${cls}`}>
      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

function CardTab({ on, onClick, className, children }: {
  on: boolean; onClick: () => void; className?: string; children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`h-8 px-3.5 rounded-lg text-[12.5px] font-semibold whitespace-nowrap shrink-0 transition ${
        on ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
      } ${className || ''}`}>
      {children}
    </button>
  );
}

function SmallBtn({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`h-[30px] px-2.5 rounded-lg border border-neutral-300 text-[12.5px] font-semibold hover:bg-neutral-50 inline-flex items-center gap-1 ${
        danger ? 'text-rose-600' : 'text-neutral-700'}`}>
      {children}
    </button>
  );
}

function VarChips({ onPick, disabled }: { onPick: (v: string) => void; disabled?: boolean }) {
  const vars = ['#{이름}', '#{등급}', '#{포인트}'];
  if (disabled) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {vars.map((v) => (
        <button key={v} type="button" onClick={() => onPick(v)}
          className="h-[25px] px-2.5 rounded-md bg-indigo-50 text-indigo-700 text-[11.5px] font-bold font-mono hover:bg-indigo-100">
          {v}
        </button>
      ))}
    </div>
  );
}

function ImagePicker({ url, link, onPick, onLink, disabled, compact }: {
  url: string; link?: string; onPick: (f: File) => void; onLink?: (v: string) => void;
  disabled?: boolean; compact?: boolean;
}) {
  return (
    <div className={compact ? '' : 'flex gap-3 items-start'}>
      {!compact && (
        <div className="w-[104px] h-[78px] rounded-lg border border-neutral-200 bg-neutral-100 shrink-0 overflow-hidden">
          {url && <img src={url} alt="" className="w-full h-full object-cover" />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <input type="file" accept="image/jpeg,image/png" disabled={disabled}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.currentTarget.value = ''; }}
          className="block w-full text-[12.5px] text-neutral-600 file:mr-2.5 file:h-8 file:px-3 file:rounded-lg file:border-0 file:cursor-pointer file:text-[12.5px] file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
        {onLink && (
          <input className={`${CUI_INPUT} mt-2 font-mono`} value={link || ''} disabled={disabled}
            onChange={(e) => onLink(e.target.value)} placeholder="이미지 클릭 시 이동할 주소 (선택)" />
        )}
        {compact && url && (
          <div className="mt-1.5 w-full h-16 rounded-lg border border-neutral-200 overflow-hidden">
            <img src={url} alt="" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
    </div>
  );
}

/** 가격 4칸 + 자동 계산 — 정상가·할인가를 넣으면 할인율이 채워진다 */
function PriceRow({ value, onChange, disabled }: {
  value: { regular_price: number | ''; discount_price: number | ''; discount_rate: number | ''; discount_fixed: number | '' };
  onChange: (v: Partial<{ regular_price: number | ''; discount_price: number | ''; discount_rate: number | ''; discount_fixed: number | '' }>) => void;
  disabled?: boolean;
}) {
  const toNum = (s: string) => (s === '' ? '' : Number(s));
  const calcRate = (rp: number | '', dp: number | '') =>
    rp !== '' && dp !== '' && Number(rp) > 0 ? Math.round((1 - Number(dp) / Number(rp)) * 100) : '';

  return (
    <div>
      <label className={`${CUI_LABEL} flex items-center gap-1.5`}>
        가격 정보
        <span className="text-[11.5px] text-neutral-400 font-normal ml-auto">할인가를 넣으면 할인율이 자동 계산됩니다</span>
      </label>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <div>
          <div className="text-[11.5px] text-neutral-500 mb-1">정상가</div>
          <input type="number" className={CUI_INPUT} value={value.regular_price} disabled={disabled}
            onChange={(e) => {
              const rp = toNum(e.target.value);
              onChange({ regular_price: rp, discount_rate: calcRate(rp, value.discount_price) });
            }} />
        </div>
        <div>
          <div className="text-[11.5px] text-neutral-500 mb-1">할인가</div>
          <input type="number" className={CUI_INPUT} value={value.discount_price} disabled={disabled}
            onChange={(e) => {
              const dp = toNum(e.target.value);
              onChange({ discount_price: dp, discount_rate: calcRate(value.regular_price, dp) });
            }} />
        </div>
        <div>
          <div className="text-[11.5px] text-neutral-500 mb-1">할인율 %</div>
          <input type="number" className={CUI_INPUT} value={value.discount_rate} disabled={disabled}
            onChange={(e) => onChange({ discount_rate: toNum(e.target.value) })} />
        </div>
        <div>
          <div className="text-[11.5px] text-neutral-500 mb-1">정액할인가</div>
          <input type="number" className={CUI_INPUT} value={value.discount_fixed} disabled={disabled}
            onChange={(e) => onChange({ discount_fixed: toNum(e.target.value) })} />
        </div>
      </div>
      <Note tone="info">할인가를 넣으면 <b>할인율 또는 정액할인가 중 하나</b>가 반드시 있어야 합니다.</Note>
    </div>
  );
}

function ButtonRows({ buttons, max, maxName, onChange, disabled }: {
  buttons: BrandButton[]; max: number; maxName: number;
  onChange: (b: BrandButton[]) => void; disabled?: boolean;
}) {
  const patch = (i: number, p: Partial<BrandButton>) =>
    onChange(buttons.map((b, j) => (j === i ? { ...b, ...p } : b)));

  return (
    <div>
      <div className="border border-neutral-200 rounded-xl overflow-hidden">
        {buttons.length === 0 && (
          <div className="p-5 text-center text-[12.5px] text-neutral-400 bg-neutral-50">버튼이 없습니다</div>
        )}
        {buttons.map((b, i) => (
          <div key={i} className="p-2.5 border-b border-neutral-200 last:border-b-0 grid grid-cols-[110px_1fr_1fr_30px] gap-2 items-center">
            <select className={`${CUI_SELECT} h-8`} value={b.type} disabled={disabled}
              onChange={(e) => patch(i, { type: e.target.value as ButtonType })}>
              {BUTTON_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input className={`${CUI_INPUT} h-8`} value={b.name} disabled={disabled} maxLength={maxName}
              placeholder={`버튼명 (${maxName}자)`} onChange={(e) => patch(i, { name: e.target.value })} />
            <input className={`${CUI_INPUT} h-8 font-mono`} value={b.url_mobile || ''} disabled={disabled}
              placeholder="https://" onChange={(e) => patch(i, { url_mobile: e.target.value })} />
            <div>
              {!disabled && (
                <button type="button" aria-label="버튼 삭제"
                  onClick={() => onChange(buttons.filter((_, j) => j !== i))}
                  className="w-7 h-7 rounded-lg text-neutral-400 hover:bg-rose-50 hover:text-rose-600 flex items-center justify-center">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {!disabled && buttons.length < max && (
        <button type="button" onClick={() => onChange([...buttons, { name: '', type: 'WL', url_mobile: '' }])}
          className="mt-2 h-[30px] px-3 rounded-lg border border-neutral-300 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-50 inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> 버튼 추가
        </button>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// 미리보기
// ────────────────────────────────────────────────────────────

function Preview({ form, spec, useIntro, profileName }: {
  form: FormState; spec: BrandSpec; useIntro: boolean; profileName: string;
}) {
  const won = (n: number | '') => (n === '' ? '' : Number(n).toLocaleString('ko-KR'));
  const carSpec = spec.carousel;

  return (
    <div className="rounded-2xl p-3.5 min-h-[520px]" style={{ background: '#9bbbd4' }}>
      <div className="flex items-center gap-2 mb-3 px-0.5">
        <div className="w-[30px] h-[30px] rounded-full bg-[#fee500] flex items-center justify-center text-[13px] font-bold">
          {(profileName || 'B').slice(0, 1)}
        </div>
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-[#20303f] truncate">{profileName || '발신프로필'}</div>
          <div className="text-[10px] text-[#4a5b6b]">(광고) 브랜드메시지</div>
        </div>
      </div>

      {carSpec ? (
        <div className="flex gap-2 overflow-x-auto pb-1.5">
          {useIntro && (
            <div className="w-[172px] shrink-0 rounded-xl overflow-hidden shadow-sm"
              style={{ background: 'linear-gradient(150deg,#4f46e5,#7c3aed)' }}>
              <div className="h-24 bg-white/20">
                {form.intro.image_url && <img src={form.intro.image_url} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="px-3 pt-2.5 text-[14px] font-bold text-white">{form.intro.header || '인트로 제목'}</div>
              <div className="px-3 pb-3 pt-1 text-[12px] text-white/90 whitespace-pre-wrap break-all">
                {form.intro.content}
              </div>
            </div>
          )}
          {form.cards.map((c, i) => (
            <div key={i} className="w-[172px] shrink-0 bg-white rounded-xl overflow-hidden shadow-sm">
              <div className="h-24 bg-gradient-to-br from-blue-100 to-indigo-200">
                {c.img_url && <img src={c.img_url} alt="" className="w-full h-full object-cover" />}
              </div>
              {spec.requireCommerce ? (
                <div className="px-3 py-2.5">
                  <div className="text-[13px] font-bold text-[#191919] truncate">{c.title || '상품명'}</div>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    {c.discount_rate !== '' && <span className="text-[12px] font-extrabold text-[#ff3b30]">{c.discount_rate}%</span>}
                    <span className="text-[15px] font-extrabold text-[#191919]">{won(c.discount_price || c.regular_price)}원</span>
                  </div>
                  {c.discount_price !== '' && (
                    <div className="text-[11px] text-[#a0a0a0] line-through">{won(c.regular_price)}원</div>
                  )}
                  {c.additional_content && <div className="text-[11px] text-[#8b8b8b] mt-1">{c.additional_content}</div>}
                </div>
              ) : (
                <>
                  <div className="px-3 pt-2.5 text-[13px] font-bold text-[#191919]">{c.header || '제목'}</div>
                  <div className="px-3 pb-2 pt-1 text-[12px] text-[#191919] whitespace-pre-wrap break-all">{c.message}</div>
                </>
              )}
              {c.buttons.map((b, bi) => (
                <div key={bi} className="mx-2 mb-2 h-[30px] rounded bg-[#f5f5f5] flex items-center justify-center text-[11.5px] text-[#3d3d3d]">
                  {b.name || '버튼'}
                </div>
              ))}
            </div>
          ))}
          {form.tailOn && (
            <div className="w-[96px] shrink-0 rounded-xl bg-white/90 flex items-center justify-center text-[12px] font-bold text-indigo-600">
              더보기
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white max-w-[252px] shadow-sm" style={{ borderRadius: '4px 15px 15px 15px', overflow: 'hidden' }}>
          {spec.requireImage && (
            <div className={`${spec.code === 'WIDE' ? 'h-[88px]' : 'h-[118px]'} bg-gradient-to-br from-blue-100 to-indigo-200`}>
              {form.image?.img_url && <img src={form.image.img_url} alt="" className="w-full h-full object-cover" />}
            </div>
          )}
          {spec.requireVideo && (
            <div className="h-[118px] bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center text-white text-[11px] font-bold">
              {form.video.thumbnail_url
                ? <img src={form.video.thumbnail_url} alt="" className="w-full h-full object-cover" />
                : '동영상'}
            </div>
          )}
          {spec.maxHeader > 0 && form.header && (
            <div className="px-3.5 pt-3 text-[14px] font-bold text-[#191919]">{form.header}</div>
          )}
          {spec.maxItems > 0 && (
            <div className="px-3 pt-2.5 pb-1">
              {form.itemList.map((it, i) => (
                <div key={i} className={`flex gap-2 items-center py-1.5 ${i < form.itemList.length - 1 ? 'border-b border-neutral-100' : ''}`}>
                  <div className={`${i === 0 ? 'w-full h-[72px]' : 'w-10 h-10'} rounded bg-gradient-to-br from-blue-100 to-indigo-200 shrink-0 overflow-hidden`}>
                    {it.img_url && <img src={it.img_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  {i > 0 && <div className="text-[12px] text-[#191919] truncate">{it.title || '아이템'}</div>}
                </div>
              ))}
            </div>
          )}
          {spec.requireCommerce && (
            <div className="px-3.5 pt-3 pb-2">
              <div className="text-[13px] font-bold text-[#191919]">{form.commerce.title || '상품명'}</div>
              <div className="flex items-baseline gap-1.5 mt-1">
                {form.commerce.discount_rate !== '' && (
                  <span className="text-[12px] font-extrabold text-[#ff3b30]">{form.commerce.discount_rate}%</span>
                )}
                <span className="text-[16px] font-extrabold text-[#191919]">
                  {won(form.commerce.discount_price || form.commerce.regular_price)}원
                </span>
                {form.commerce.discount_price !== '' && (
                  <span className="text-[11.5px] text-[#a0a0a0] line-through">{won(form.commerce.regular_price)}원</span>
                )}
              </div>
              {form.additionalContent && <div className="text-[11px] text-[#8b8b8b] mt-1">{form.additionalContent}</div>}
            </div>
          )}
          {spec.maxMessage > 0 && form.content && (
            <div className="px-3.5 py-3 text-[12.5px] leading-relaxed text-[#191919] whitespace-pre-wrap break-all">
              {form.content}
            </div>
          )}
          {form.buttons.map((b, i) => (
            <div key={i} className="mx-2.5 mb-2.5 h-[33px] rounded bg-[#f5f5f5] flex items-center justify-center text-[12px] text-[#3d3d3d]">
              {b.name || '버튼'}
            </div>
          ))}
          {form.couponOn && (
            <div className="mx-2.5 mb-2.5 h-[38px] rounded border border-neutral-200 flex items-center px-3 gap-2">
              <div className="min-w-0">
                <div className="text-[11.5px] font-bold text-[#191919] truncate">{form.coupon.title || '쿠폰'}</div>
                <div className="text-[10px] text-[#8b8b8b] truncate">{form.coupon.description}</div>
              </div>
              <div className="ml-auto w-[22px] h-[22px] rounded bg-indigo-600 text-white text-[11px] flex items-center justify-center shrink-0">
                <Check className="w-3 h-3" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
