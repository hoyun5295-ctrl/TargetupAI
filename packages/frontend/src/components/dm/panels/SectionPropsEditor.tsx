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
};

export default function SectionPropsEditor({
  section, onUpdate,
}: {
  section: Section;
  onUpdate: (patch: Record<string, any>) => void;
}) {
  switch (section.type) {
    case 'header':     return <HeaderEditor     props={section.props as any} onUpdate={onUpdate} />;
    case 'hero':       return <HeroEditor       props={section.props as any} onUpdate={onUpdate} />;
    case 'coupon':     return <CouponEditor     props={section.props as any} onUpdate={onUpdate} />;
    case 'countdown':  return <CountdownEditor  props={section.props as any} onUpdate={onUpdate} />;
    case 'text_card':  return <TextCardEditor   props={section.props as any} onUpdate={onUpdate} />;
    case 'cta':        return <CtaEditor        props={section.props as any} onUpdate={onUpdate} treatment={section.treatment} />;
    case 'video':      return <VideoEditor      props={section.props as any} onUpdate={onUpdate} />;
    case 'store_info': return <StoreInfoEditor  props={section.props as any} onUpdate={onUpdate} />;
    case 'sns':        return <SnsEditor        props={section.props as any} onUpdate={onUpdate} />;
    case 'promo_code': return <PromoCodeEditor  props={section.props as any} onUpdate={onUpdate} />;
    case 'footer':     return <FooterEditor     props={section.props as any} onUpdate={onUpdate} />;
    // D216+ 신규 16
    case 'product_carousel':  return <ProductCarouselEditor  props={section.props as any} onUpdate={onUpdate} />;
    case 'gallery':           return <GalleryEditor          props={section.props as any} onUpdate={onUpdate} />;
    case 'slideshow':         return <SlideshowEditor        props={section.props as any} onUpdate={onUpdate} />;
    case 'tab_cards':         return <TabCardsEditor         props={section.props as any} onUpdate={onUpdate} />;
    case 'poll':              return <PollEditor             props={section.props as any} onUpdate={onUpdate} />;
    case 'survey':            return <SurveyEditor           props={section.props as any} onUpdate={onUpdate} />;
    case 'email_capture':     return <EmailCaptureEditor     props={section.props as any} onUpdate={onUpdate} />;
    case 'click_rewards':     return <ClickRewardsEditor     props={section.props as any} onUpdate={onUpdate} />;
    case 'lucky_draw':        return <LuckyDrawEditor        props={section.props as any} onUpdate={onUpdate} />;
    case 'roulette':          return <RouletteEditor         props={section.props as any} onUpdate={onUpdate} />;
    case 'instant_coupon':    return <InstantCouponEditor    props={section.props as any} onUpdate={onUpdate} />;
    case 'limited_quantity':  return <LimitedQuantityEditor  props={section.props as any} onUpdate={onUpdate} />;
    case 'youtube_embed':     return <YoutubeEmbedEditor     props={section.props as any} onUpdate={onUpdate} />;
    case 'instagram_embed':   return <InstagramEmbedEditor   props={section.props as any} onUpdate={onUpdate} />;
    case 'map_store_locator': return <MapStoreLocatorEditor  props={section.props as any} onUpdate={onUpdate} />;
    case 'reviews':           return <ReviewsEditor          props={section.props as any} onUpdate={onUpdate} />;
    default:                  return null;
  }
}
