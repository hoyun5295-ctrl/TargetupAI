/**
 * SectionPropsEditor — 선택된 섹션의 타입에 따라 해당 에디터 컴포넌트로 분기.
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

export type EditorProps<P> = {
  props: P;
  onUpdate: (patch: Partial<P>) => void;
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
    case 'cta':        return <CtaEditor        props={section.props as any} onUpdate={onUpdate} />;
    case 'video':      return <VideoEditor      props={section.props as any} onUpdate={onUpdate} />;
    case 'store_info': return <StoreInfoEditor  props={section.props as any} onUpdate={onUpdate} />;
    case 'sns':        return <SnsEditor        props={section.props as any} onUpdate={onUpdate} />;
    case 'promo_code': return <PromoCodeEditor  props={section.props as any} onUpdate={onUpdate} />;
    case 'footer':     return <FooterEditor     props={section.props as any} onUpdate={onUpdate} />;
    default:           return null;
  }
}
