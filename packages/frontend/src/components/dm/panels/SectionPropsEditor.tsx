/**
 * SectionPropsEditor — 선택된 섹션의 타입에 따라 해당 에디터 컴포넌트로 분기.
 * 27 섹션(기존 11 + D216+ 신규 16) 전부 우측 속성 패널 편집 가능.
 */
import type { Section } from '../../../utils/dm-section-defaults';
import HeaderEditor from './editors/HeaderEditor';
import HeroEditor from './editors/HeroEditor';
import CouponEditor from './editors/CouponEditor';
import CountdownEditor from './editors/CountdownEditor';
import TextCardEditor from './editors/TextCardEditor';
import CtaEditor from './editors/CtaEditor';
import VideoEditor from './editors/VideoEditor';
import StoreInfoEditor from './editors/StoreInfoEditor';
import SnsEditor from './editors/SnsEditor';
import PromoCodeEditor from './editors/PromoCodeEditor';
import FooterEditor from './editors/FooterEditor';
// D216+ 신규 16
import ProductCarouselEditor from './editors/ProductCarouselEditor';
import GalleryEditor from './editors/GalleryEditor';
import SlideshowEditor from './editors/SlideshowEditor';
import TabCardsEditor from './editors/TabCardsEditor';
import PollEditor from './editors/PollEditor';
import SurveyEditor from './editors/SurveyEditor';
import EmailCaptureEditor from './editors/EmailCaptureEditor';
import ClickRewardsEditor from './editors/ClickRewardsEditor';
import LuckyDrawEditor from './editors/LuckyDrawEditor';
import RouletteEditor from './editors/RouletteEditor';
import InstantCouponEditor from './editors/InstantCouponEditor';
import LimitedQuantityEditor from './editors/LimitedQuantityEditor';
import YoutubeEmbedEditor from './editors/YoutubeEmbedEditor';
import InstagramEmbedEditor from './editors/InstagramEmbedEditor';
import MapStoreLocatorEditor from './editors/MapStoreLocatorEditor';
import ReviewsEditor from './editors/ReviewsEditor';

export type EditorProps<P> = {
  props: P;
  onUpdate: (patch: Partial<P>) => void;
  /**
   * ★ 2026-09-04 섹션 구도. 구도마다 소비하는 속성이 달라 **컨트롤 표시 여부**를 가르는 편집기만 받는다
   * (선택 속성이라 안 쓰는 편집기는 무영향). 지금 소비처 = CtaEditor 배치.
   */
  treatment?: string;
  /**
   * ★ 2026-09-16 이 채널에서 감출 필드인가. 이 패널은 모바일 DM과 이메일이 **함께 쓰는데**
   * 채널마다 쓰는 값이 다르다 — 한쪽 렌더러가 안 읽는 값은 그쪽 화면에서 "눌러도 안 바뀌는 칸"이 되고,
   * 채널 전용 컨트롤과 같은 값을 노출하면 한 화면에 같은 것이 두 번 나온다(남지현 접수 2건).
   * 미지정이면 아무것도 감추지 않는다 = 기존 호출부(DM) 화면 무변화.
   */
  hidden?: (field: string) => boolean;
};

export default function SectionPropsEditor({
  section, onUpdate, hiddenFields,
}: {
  section: Section;
  onUpdate: (patch: Record<string, any>) => void;
  /** ★ 2026-09-16 채널이 감추는 필드 목록. 원장 = 백엔드 `email-property-contract.EMAIL_HIDDEN_EDITOR_FIELDS`. */
  hiddenFields?: readonly string[];
}) {
  // 전 에디터 공통 인자 — 감춤 판정을 한 곳에서 만든다(에디터마다 배열을 다시 훑지 않도록).
  const common = {
    props: section.props as any,
    onUpdate,
    hidden: (field: string) => !!hiddenFields && hiddenFields.includes(field),
  };
  switch (section.type) {
    case 'header':     return <HeaderEditor     {...common} />;
    case 'hero':       return <HeroEditor       {...common} />;
    case 'coupon':     return <CouponEditor     {...common} />;
    case 'countdown':  return <CountdownEditor  {...common} />;
    case 'text_card':  return <TextCardEditor   {...common} />;
    case 'cta':        return <CtaEditor        {...common} treatment={section.treatment} />;
    case 'video':      return <VideoEditor      {...common} />;
    case 'store_info': return <StoreInfoEditor  {...common} />;
    case 'sns':        return <SnsEditor        {...common} />;
    case 'promo_code': return <PromoCodeEditor  {...common} />;
    case 'footer':     return <FooterEditor     {...common} />;
    // D216+ 신규 16
    case 'product_carousel':  return <ProductCarouselEditor  {...common} />;
    case 'gallery':           return <GalleryEditor          {...common} />;
    case 'slideshow':         return <SlideshowEditor        {...common} />;
    case 'tab_cards':         return <TabCardsEditor         {...common} />;
    case 'poll':              return <PollEditor             {...common} />;
    case 'survey':            return <SurveyEditor           {...common} />;
    case 'email_capture':     return <EmailCaptureEditor     {...common} />;
    case 'click_rewards':     return <ClickRewardsEditor     {...common} />;
    case 'lucky_draw':        return <LuckyDrawEditor        {...common} />;
    case 'roulette':          return <RouletteEditor         {...common} />;
    case 'instant_coupon':    return <InstantCouponEditor    {...common} />;
    case 'limited_quantity':  return <LimitedQuantityEditor  {...common} />;
    case 'youtube_embed':     return <YoutubeEmbedEditor     {...common} />;
    case 'instagram_embed':   return <InstagramEmbedEditor   {...common} />;
    case 'map_store_locator': return <MapStoreLocatorEditor  {...common} />;
    case 'reviews':           return <ReviewsEditor          {...common} />;
    default:                  return null;
  }
}
