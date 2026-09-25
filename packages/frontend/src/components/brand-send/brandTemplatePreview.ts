/**
 * brandTemplatePreview — 등록된 브랜드메시지 템플릿 한 건 → 받는 화면 미리보기 값 (★2026-09-25)
 *
 * 원천 = `GET /api/alimtalk/brand-templates`(회사 · 사용 중 · `brand_message_templates.*`).
 * 칸 이름은 실제 표를 따른다: `attachment`·`carousel`(jsonb · SCHEMA 등재 · 등록 INSERT `routes/alimtalk.ts`).
 *   예전 이름(`attachment_json`·`carousel_json`)으로 온 값도 읽어 준다 — 어느 쪽이든 받는 화면이 빈칸이 되지 않게.
 * 구조 = 등록 화면(`alimtalk/BrandTemplateForm.tsx` initialFormState)이 읽는 모양과 같다:
 *   attachment.image.img_url · attachment.item.list[] · attachment.video.thumbnail_url · attachment.commerce ·
 *   carousel.head / carousel.list[].attachment.{image,commerce,button} / carousel.tail
 */
import type { PreviewCommerce, PreviewRich } from '../BrandMessagePreview';

export interface BrandTemplateRow {
  id: string;
  template_key: string;
  manage_name: string;
  chat_bubble_type: string;
  profile_key?: string | null;
  profile_name?: string | null;
  custom_template_code?: string | null;
  header?: string | null;
  content?: string | null;
  additional_content?: string | null;
  buttons?: any[] | null;
  attachment?: any;
  carousel?: any;
  coupon?: any;
  variables?: string[] | null;
  updated_at?: string;
  [k: string]: any;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

function commerceOf(c: any): PreviewCommerce | undefined {
  if (!c || typeof c !== 'object') return undefined;
  return { title: str(c.title), regular: str(c.regular_price), discount: str(c.discount_price), rate: str(c.discount_rate) };
}

/** 받는 화면 미리보기(BrandMessagePreview) 값. isAd = 지금 창의 광고 표기(템플릿에는 광고 여부가 없다) */
export function brandTemplatePreviewProps(t: BrandTemplateRow, isAd: boolean) {
  const att = t.attachment ?? t.attachment_json ?? {};
  const car = t.carousel ?? t.carousel_json ?? null;
  const cards: any[] = Array.isArray(car?.list) ? car.list : [];
  const rich: PreviewRich = {
    additional: t.additional_content || undefined,
    items: Array.isArray(att?.item?.list)
      ? att.item.list.map((it: any) => ({ imageUrl: it?.img_url || undefined, title: str(it?.title) }))
      : undefined,
    video: att?.video ? { thumbUrl: att.video.thumbnail_url || undefined } : undefined,
    commerce: cards.length === 0 ? commerceOf(att?.commerce) : undefined,
    carousel: cards.length > 0 ? {
      intro: car?.head
        ? { imageUrl: car.head.image_url || undefined, header: str(car.head.header), content: str(car.head.content) }
        : undefined,
      cards: cards.map((c: any) => ({
        imageUrl: c?.attachment?.image?.img_url || undefined,
        header: str(c?.header),
        message: str(c?.message),
        additional: str(c?.additional_content),
        commerce: commerceOf(c?.attachment?.commerce),
        buttons: Array.isArray(c?.attachment?.button) ? c.attachment.button.map((b: any) => str(b?.name)) : [],
      })),
      tail: !!car?.tail,
    } : undefined,
  };
  const coupon = t.coupon || att?.coupon;
  return {
    bubbleType: t.chat_bubble_type || 'TEXT',
    message: t.content || undefined,
    header: cards.length === 0 ? (t.header || undefined) : undefined,
    imageUrl: att?.image?.img_url || undefined,
    buttons: Array.isArray(t.buttons) ? t.buttons.map((b: any) => ({ name: str(b?.name), type: str(b?.type), url_mobile: b?.url_mobile })) : undefined,
    couponTitle: coupon?.title || undefined,
    isAd,
    profileName: t.profile_name || undefined,
    rich,
  };
}
