/**
 * ★ CT design-core/template-compilers.ts — 골든 템플릿 채널 컴파일러 (디자인 4.0 M4, 2026-07-14)
 *
 * 뿌리(채널 중립 GoldenTemplate) → 가지(채널 산출물) 번역. 전부 순수 함수(DB import 0).
 *   - DM     : Section[] + brand_kit 패치 (구도·배경 큐레이션 동승)
 *   - 이메일 : Section[] + campaign design (이메일 안전 구도만 — fail-closed는 렌더러가 재검증)
 *   - 인앱   : content_blocks + theme/card_style/design (SDK 허용 블록만)
 *
 * 원칙:
 *   - 혜택 수치 0 — 카피는 코어 정의의 placeholder 그대로 전달(여기서 창작 금지)
 *   - 능력표(CHANNEL_CAPABILITIES) 밖 요소는 채널 대체(이메일 카운트다운=정적, 인앱 후기=인용 압축)
 *   - 구도 값은 각 채널 허용표 안 값만 산출 — 최종 검증은 채널 fail-closed 해석기가 이중 수행
 */
import type { Section } from '../dm/dm-section-registry';
import type { DmBrandKit } from '../dm/dm-tokens';
import type { EmailDesign } from '../email/email-tokens';
import { getCorePalette, type CorePalette } from './palette';
import { BENEFIT_PLACEHOLDER, type CoreGoldenTemplate, type StoryBlock } from './template-registry';

/** 브랜드 프로필 연결점 — 고객센터 등 실값 주입(미전달 = placeholder 골격 그대로) */
export interface CompileOpts {
  contact?: { phone?: string; email?: string; website?: string };
  brandName?: string;
}

const INAPP_CTA_URL = '[URL — 회사 admin 수정]';

function mk(tplId: string, type: string, i: number, props: Record<string, unknown>, extra: Partial<Section> = {}): Section {
  return { id: `g4-${tplId}-${type}-${i}`, type, order: i, visible: true, props, ...extra } as unknown as Section;
}

// ────────────── DM 가지 ──────────────

export interface DmCompiled {
  sections: Section[];
  brandKitPatch: Partial<DmBrandKit>;
}

export function compileTemplateForDm(t: CoreGoldenTemplate, opts: CompileOpts = {}): DmCompiled {
  const pal = getCorePalette(t.design.palette)!;
  const urgent = t.purpose === 'urgency';
  const sections: Section[] = [];
  let i = 0;
  sections.push(mk(t.id, 'header', i++, { variant: 'logo', brand_name: opts.brandName || '' }));
  let firstText = true;
  for (const b of t.story.blocks) {
    switch (b.kind) {
      case 'headline':
        sections.push(mk(t.id, 'hero', i++, {
          ...(b.copy?.tag ? { tag: b.copy.tag } : {}),
          headline: b.copy?.headline || '',
          sub_copy: b.copy?.body || '',
        }, { treatment: pal.artDirection.typeScale === 'editorial' ? 'typographic' : 'classic' }));
        break;
      case 'text':
        sections.push(mk(t.id, 'text_card', i++, {
          tag: b.copy?.tag || '', headline: b.copy?.headline || '', body: b.copy?.body || '',
        }, { treatment: firstText ? 'lead' : 'classic' }));
        firstText = false;
        break;
      case 'guide':
        sections.push(mk(t.id, 'text_card', i++, {
          tag: b.copy?.tag || '', headline: b.copy?.headline || '', body: b.copy?.body || '',
        }, { treatment: 'framed' }));
        break;
      case 'product_live':
        sections.push(mk(t.id, 'product_carousel', i++, { title: '', products: [] }, { treatment: 'focus', background: 'soft' } as Partial<Section>));
        break;
      case 'coupon':
        sections.push(mk(t.id, 'coupon', i++, { discount_label: b.copy?.headline || BENEFIT_PLACEHOLDER, coupon_code: '' },
          { treatment: pal.background !== '#ffffff' ? 'spotlight' : 'ticket' }));
        break;
      case 'countdown':
        sections.push(mk(t.id, 'countdown', i++, { end_datetime: '', show_days: true, show_hours: true, show_minutes: true, show_seconds: false }, { treatment: 'banner' }));
        break;
      case 'social_proof':
        sections.push(mk(t.id, 'reviews', i++, { reviews: [], show_average_rating: true }, { treatment: 'quote' }));
        break;
      case 'cta':
        sections.push(mk(t.id, 'cta', i++, { buttons: [{ label: b.cta?.label || '자세히 보기', url: '', style: 'primary' }] },
          { treatment: urgent ? 'sticky' : 'bar' }));
        break;
    }
  }
  sections.push(mk(t.id, 'footer', i++, { notes: '', cs_phone: opts.contact?.phone || '' }));
  return {
    sections,
    brandKitPatch: {
      primary_color: pal.primary,
      accent_color: pal.accent,
      background_color: pal.background,
      ...(pal.fontDisplay ? { font_display: pal.fontDisplay } : {}),
      art_direction: { theme: pal.id, ...pal.artDirection },
    },
  };
}

// ────────────── 이메일 가지 ──────────────

export interface EmailCompiled {
  sections: Section[];
  design: EmailDesign;
}

export function compileTemplateForEmail(t: CoreGoldenTemplate, opts: CompileOpts = {}): EmailCompiled {
  const pal = getCorePalette(t.design.palette)!;
  const sections: Section[] = [];
  let i = 0;
  sections.push(mk(t.id, 'header', i++, { variant: 'logo', brand_name: opts.brandName || '', align: 'center' }));
  let firstText = true;
  for (const b of t.story.blocks) {
    switch (b.kind) {
      case 'headline':
        sections.push(mk(t.id, 'hero', i++, {
          headline: b.copy?.headline || '', sub_copy: b.copy?.body || '', align: 'center',
        }, { treatment: pal.artDirection.typeScale === 'editorial' ? 'typographic' : 'classic' }));
        break;
      case 'text':
        sections.push(mk(t.id, 'text_card', i++, {
          tag: b.copy?.tag || '', headline: b.copy?.headline || '', body: b.copy?.body || '', align: 'left',
        }, { treatment: firstText ? 'lead' : 'classic' }));
        firstText = false;
        break;
      case 'guide':
        sections.push(mk(t.id, 'text_card', i++, {
          tag: b.copy?.tag || '', headline: b.copy?.headline || '', body: b.copy?.body || '', align: 'left',
        }, { treatment: 'framed' }));
        break;
      case 'product_live':
        sections.push(mk(t.id, 'product_carousel', i++, { title: '', products: [] }, { treatment: 'focus', background: 'soft' } as Partial<Section>));
        break;
      case 'coupon':
        sections.push(mk(t.id, 'coupon', i++, { discount_label: b.copy?.headline || BENEFIT_PLACEHOLDER, coupon_code: '' },
          { treatment: pal.background !== '#ffffff' ? 'spotlight' : 'classic' }));
        break;
      case 'countdown':
        // 이메일 = 정적 D-day 렌더(EMAIL_INCOMPATIBLE 'static') — 렌더러가 텍스트 대체
        sections.push(mk(t.id, 'countdown', i++, { end_datetime: '', show_days: true, show_hours: true, show_minutes: true, show_seconds: false }));
        break;
      case 'social_proof':
        sections.push(mk(t.id, 'reviews', i++, { reviews: [], show_average_rating: true }));
        break;
      case 'cta':
        sections.push(mk(t.id, 'cta', i++, { buttons: [{ label: b.cta?.label || '자세히 보기', url: '', style: 'primary' }] }, { treatment: 'bar' }));
        break;
    }
  }
  sections.push(mk(t.id, 'footer', i++, { notes: '', cs_phone: opts.contact?.phone || '' }));
  return {
    sections,
    design: {
      theme: pal.id,
      palette: { primary: pal.primary, accent: pal.accent, background: pal.background },
      ...(pal.fontDisplay ? { font_display: pal.fontDisplay } : {}),
      art_direction: {
        typeScale: pal.artDirection.typeScale,
        spacingDensity: pal.artDirection.spacingDensity,
        accentMotif: pal.artDirection.accentMotif,
        sectionDivider: pal.artDirection.sectionDivider,
      },
    },
  };
}

// ────────────── 인앱 가지 ──────────────

export interface InappCompiled {
  template: 'center_modal' | 'slide_in' | 'toast' | 'floating_button';
  card_style: 'classic' | 'bubble' | 'ticket' | 'poster';
  theme: string;
  design: Record<string, unknown>;
  is_ad: boolean;
  content_blocks: Array<Record<string, unknown>>;
}

function inappCardStyle(t: CoreGoldenTemplate): InappCompiled['card_style'] {
  if (t.story.blocks.some((b) => b.kind === 'coupon')) return 'ticket';
  if (t.purpose === 'notice' && t.story.blocks.some((b) => b.kind === 'product_live')) return 'poster';
  if (t.purpose === 'first_purchase' || t.id === 'dormant-comeback' || t.id === 'post-purchase') return 'bubble';
  return 'classic';
}

export function compileTemplateForInapp(t: CoreGoldenTemplate): InappCompiled {
  const pal = getCorePalette(t.design.palette)!;
  const blocks: Array<Record<string, unknown>> = [];
  const headlineSize = pal.artDirection.typeScale === 'bold' ? 'xl' : 'lg';
  for (const b of t.story.blocks) {
    switch (b.kind) {
      case 'headline':
        if (b.copy?.tag) blocks.push({ type: 'eyebrow', text: b.copy.tag, tone: 'accent' });
        blocks.push({ type: 'headline', text: (b.copy?.headline || '').replace(/%고객명%/g, '{{ customer.name }}'), size: headlineSize });
        if (b.copy?.body) blocks.push({ type: 'body', text: b.copy.body.replace(/%고객명%/g, '{{ customer.name }}') });
        break;
      case 'countdown':
        blocks.push({ type: 'eyebrow', text: '마감 임박', tone: 'accent' });
        break;
      case 'text':
      case 'guide':
        if (b.copy?.tag && !blocks.some((x) => x.type === 'eyebrow')) blocks.push({ type: 'eyebrow', text: b.copy.tag, tone: 'accent' });
        blocks.push({ type: 'body', text: [b.copy?.headline, b.copy?.body].filter(Boolean).join('\n') });
        break;
      case 'product_live':
        blocks.push({ type: 'media', variant: 'image', url: '', aspect: '16:9' });
        break;
      case 'coupon':
        blocks.push({ type: 'benefit', text: b.copy?.headline || BENEFIT_PLACEHOLDER });
        break;
      case 'social_proof':
        blocks.push({ type: 'body', text: '“[대표 후기를 붙여넣어주세요]”' });
        break;
      case 'cta':
        blocks.push({
          type: 'cta_group', layout: 'stack',
          buttons: [{ id: 'btn_primary', label: b.cta?.label || '확인하기', action_url: INAPP_CTA_URL, style: 'primary' }],
        });
        break;
    }
  }
  return {
    template: 'center_modal',
    card_style: inappCardStyle(t),
    theme: pal.inapp.signature ? pal.id : 'minimal',
    design: {
      motion: 'rich',
      ...(pal.artDirection.typeScale === 'editorial' ? { treatment: 'framed' } : {}),
      ...(t.purpose === 'urgency' ? { treatment: 'typographic' } : {}),
    },
    is_ad: t.purpose === 'urgency' || t.story.blocks.some((b) => b.kind === 'coupon'),
    content_blocks: blocks,
  };
}

/** 스토리 블록에서 인앱 파생 제외 판단 등에 쓰는 공용 헬퍼 */
export function templateUsesKind(t: CoreGoldenTemplate, kind: StoryBlock['kind']): boolean {
  return t.story.blocks.some((b) => b.kind === kind);
}

// ────────────── 팔레트 → 채널 패치 (테마 1클릭 공용) ──────────────

/** 코어 팔레트 → DM brand_kit 패치 (FE dm-themes와 동일 결과 — M3 동기 테스트 대상) */
export function paletteToDmBrandKitPatch(pal: CorePalette): Partial<DmBrandKit> {
  return {
    primary_color: pal.primary,
    accent_color: pal.accent,
    background_color: pal.background,
    ...(pal.fontDisplay ? { font_display: pal.fontDisplay } : { font_display: undefined }),
    art_direction: { theme: pal.id, ...pal.artDirection },
  };
}

/** 코어 팔레트 → 이메일 campaign design (FE email-themes와 동일 결과 — M3 동기 테스트 대상) */
export function paletteToEmailDesign(pal: CorePalette): EmailDesign {
  return {
    theme: pal.id,
    palette: { primary: pal.primary, accent: pal.accent, background: pal.background },
    ...(pal.fontDisplay ? { font_display: pal.fontDisplay } : {}),
    art_direction: {
      typeScale: pal.artDirection.typeScale,
      spacingDensity: pal.artDirection.spacingDensity,
      accentMotif: pal.artDirection.accentMotif,
      sectionDivider: pal.artDirection.sectionDivider,
    },
  };
}
