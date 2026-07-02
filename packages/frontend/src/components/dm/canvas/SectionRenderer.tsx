/**
 * SectionRenderer — 섹션 타입에 따라 해당 컴포넌트로 디스패치
 * 에디터 캔버스에서 섹션 1개를 그릴 때 SectionFrame과 함께 사용.
 *
 * D126 V2: onEdit 콜백을 받아 인라인 편집 지원.
 */
import type { CSSProperties } from 'react';
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

  // 공통 정렬(section.align)을 단일 소스로 — hero/header/text_card가 자체 props.align을 읽으므로 우선 주입(미설정 시 각 섹션 기본 유지 = 하위호환)
  const withAlign = (p: any) => (section.align ? { ...p, align: section.align } : p);

  const inner = (() => {
    switch (section.type) {
      case 'header':     return <HeaderSection props={withAlign(section.props)} storeName={storeName} onEdit={onEdit} />;
      case 'hero':       return <HeroSection props={withAlign(section.props)} onEdit={onEdit} />;
      case 'coupon':     return <CouponSection props={section.props as any} onEdit={onEdit} />;
      case 'countdown':  return <CountdownSection props={section.props as any} onEdit={onEdit} />;
      case 'text_card':  return <TextCardSection props={withAlign(section.props)} onEdit={onEdit} />;
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

  // 섹션 공통 정렬·액센트색 → 텍스트/버튼/플렉스가 참조하는 CSS 변수로 주입 (전 섹션 일괄)
  const sAlign = section.align || 'center';
  // ★ 2026-07-02(2) 섹션 공통 텍스트 크기 — 발행물 SSR(renderSection wrap)과 동일하게 폰트 토큰 override
  const fsVarPx = (v: unknown): number | null => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 10 && n <= 80 ? n : null;
  };
  const titleN = fsVarPx(section.title_size);
  const textN = fsVarPx(section.text_size);
  const styleVars = {
    textAlign: sAlign,
    ['--dm-section-justify']: sAlign === 'left' ? 'flex-start' : sAlign === 'right' ? 'flex-end' : 'center',
    // 액센트색 = 이 섹션 한정으로 --dm-primary 덮어쓰기 → 브랜드색 쓰던 모든 버튼이 자동 적용
    ...(section.accent_color ? { ['--dm-primary']: section.accent_color } : {}),
    ...(titleN ? {
      ['--dm-fs-hero']: `${titleN}px`, ['--dm-fs-h1']: `${titleN}px`,
      ['--dm-fs-h2']: `${titleN}px`, ['--dm-fs-h3']: `${titleN}px`,
    } : {}),
    ...(textN ? { ['--dm-fs-body']: `${textN}px`, ['--dm-fs-small']: `${textN}px` } : {}),
  } as CSSProperties;

  if (readOnly) return <div style={styleVars}>{inner}</div>;

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
      <div style={styleVars}>{inner}</div>
    </SectionFrame>
  );
}
