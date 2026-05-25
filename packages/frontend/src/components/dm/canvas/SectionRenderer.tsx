/**
 * SectionRenderer — 섹션 타입에 따라 해당 컴포넌트로 디스패치
 * 에디터 캔버스에서 섹션 1개를 그릴 때 SectionFrame과 함께 사용.
 *
 * D126 V2: onEdit 콜백을 받아 인라인 편집 지원.
 */
import type { Section, SectionProps } from '../../../utils/dm-section-defaults';
import SectionFrame from './SectionFrame';
import HeaderSection from './HeaderSection';
import HeroSection from './HeroSection';
import CouponSection from './CouponSection';
import CountdownSection from './CountdownSection';
import TextCardSection from './TextCardSection';
import CtaSection from './CtaSection';
import VideoSection from './VideoSection';
import StoreInfoSection from './StoreInfoSection';
import SnsSection from './SnsSection';
import PromoCodeSection from './PromoCodeSection';
import FooterSection from './FooterSection';
// ★ D216+ 신규 16 섹션 컴포넌트 통합
import {
  ProductCarouselSection, GallerySection, SlideshowSection, TabCardsSection,
  PollSection, SurveySection, EmailCaptureSection, ClickRewardsSection,
  LuckyDrawSection, RouletteSection, InstantCouponSection, LimitedQuantitySection,
  YoutubeEmbedSection, InstagramEmbedSection, MapStoreLocatorSection, ReviewsSection,
} from './NewSections';

export type EditHandler = (patch: Partial<SectionProps>) => void;

export type SectionRendererProps = {
  section: Section;
  storeName?: string;
  selected?: boolean;
  hovered?: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** 편집 모드 비활성 (뷰어처럼 렌더링) */
  readOnly?: boolean;
  /** 인라인 편집 적용 (D126 V2) — readOnly=false 일 때만 활성 */
  onEditSection?: (id: string, patch: Partial<SectionProps>) => void;
};

export default function SectionRenderer({
  section, storeName, selected, hovered, onSelect, onHover, readOnly, onEditSection,
}: SectionRendererProps) {
  if (!section.visible && readOnly) return null;

  const onEdit: EditHandler | undefined = readOnly || !onEditSection
    ? undefined
    : (patch) => onEditSection(section.id, patch);

  const inner = (() => {
    switch (section.type) {
      case 'header':     return <HeaderSection props={section.props as any} storeName={storeName} onEdit={onEdit} />;
      case 'hero':       return <HeroSection props={section.props as any} onEdit={onEdit} />;
      case 'coupon':     return <CouponSection props={section.props as any} onEdit={onEdit} />;
      case 'countdown':  return <CountdownSection props={section.props as any} onEdit={onEdit} />;
      case 'text_card':  return <TextCardSection props={section.props as any} onEdit={onEdit} />;
      case 'cta':        return <CtaSection props={section.props as any} onEdit={onEdit} />;
      case 'video':      return <VideoSection props={section.props as any} onEdit={onEdit} />;
      case 'store_info': return <StoreInfoSection props={section.props as any} onEdit={onEdit} />;
      case 'sns':        return <SnsSection props={section.props as any} />;
      case 'promo_code': return <PromoCodeSection props={section.props as any} onEdit={onEdit} />;
      case 'footer':     return <FooterSection props={section.props as any} onEdit={onEdit} />;
      // ★ D216+ 신규 16 섹션 — 카테고리 A. 시각 카드형
      case 'product_carousel':  return <ProductCarouselSection props={section.props as any} />;
      case 'gallery':           return <GallerySection props={section.props as any} />;
      case 'slideshow':         return <SlideshowSection props={section.props as any} />;
      case 'tab_cards':         return <TabCardsSection props={section.props as any} />;
      // 카테고리 B. 인터랙션 수집형
      case 'poll':              return <PollSection props={section.props as any} />;
      case 'survey':            return <SurveySection props={section.props as any} />;
      case 'email_capture':     return <EmailCaptureSection props={section.props as any} />;
      case 'click_rewards':     return <ClickRewardsSection props={section.props as any} />;
      // 카테고리 C. 참여형 이벤트
      case 'lucky_draw':        return <LuckyDrawSection props={section.props as any} />;
      case 'roulette':          return <RouletteSection props={section.props as any} />;
      case 'instant_coupon':    return <InstantCouponSection props={section.props as any} />;
      case 'limited_quantity':  return <LimitedQuantitySection props={section.props as any} />;
      // 카테고리 D. 외부 임베드 + 매장 안내
      case 'youtube_embed':     return <YoutubeEmbedSection props={section.props as any} />;
      case 'instagram_embed':   return <InstagramEmbedSection props={section.props as any} />;
      case 'map_store_locator': return <MapStoreLocatorSection props={section.props as any} />;
      case 'reviews':           return <ReviewsSection props={section.props as any} />;
      default:                  return null;
    }
  })();

  if (readOnly) return <>{inner}</>;

  return (
    <SectionFrame
      id={section.id}
      type={section.type}
      variant={section.style_variant}
      selected={selected}
      hovered={hovered}
      hidden={!section.visible}
      onSelect={onSelect}
      onHover={onHover}
    >
      {inner}
    </SectionFrame>
  );
}
