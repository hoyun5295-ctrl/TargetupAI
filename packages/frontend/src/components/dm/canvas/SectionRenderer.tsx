/**
 * SectionRenderer — 섹션 타입에 따라 해당 컴포넌트로 디스패치
 * 에디터 캔버스에서 섹션 1개를 그릴 때 SectionFrame과 함께 사용.
 */
import type { Section } from '../../../utils/dm-section-defaults';
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

export type SectionRendererProps = {
  section: Section;
  storeName?: string;
  selected?: boolean;
  hovered?: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** 편집 모드 비활성 (뷰어처럼 렌더링) */
  readOnly?: boolean;
};

export default function SectionRenderer({
  section, storeName, selected, hovered, onSelect, onHover, readOnly,
}: SectionRendererProps) {
  if (!section.visible && readOnly) return null;

  const inner = (() => {
    switch (section.type) {
      case 'header':     return <HeaderSection props={section.props as any} storeName={storeName} />;
      case 'hero':       return <HeroSection props={section.props as any} />;
      case 'coupon':     return <CouponSection props={section.props as any} />;
      case 'countdown':  return <CountdownSection props={section.props as any} />;
      case 'text_card':  return <TextCardSection props={section.props as any} />;
      case 'cta':        return <CtaSection props={section.props as any} />;
      case 'video':      return <VideoSection props={section.props as any} />;
      case 'store_info': return <StoreInfoSection props={section.props as any} />;
      case 'sns':        return <SnsSection props={section.props as any} />;
      case 'promo_code': return <PromoCodeSection props={section.props as any} />;
      case 'footer':     return <FooterSection props={section.props as any} />;
      default:           return null;
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
