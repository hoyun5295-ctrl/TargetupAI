/**
 * line-materials.ts — 한 줄 단계 모달에서 받은 재료를 결과물에 놓는 CT (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §3-6 · §3-8 · §3-9)
 *
 * ⛔ 불변
 *   - **재료는 AI 를 지나지 않는다** — 생성이 끝난 뒤(DM 은 장 나누기 전) 코드가 제자리에 놓는다(가격 · 링크 · 사진 · 10-10 불변 그대로).
 *   - 직접 넣은 상품 사진 = **이 회사 업로드 경로만**(Harold 결정 H3 · `isCompanyImageUrl`). 다른 주소는 거절한다.
 *   - 사진 + 가격이 있는 직접 상품만 카드다. 그 밖은 원문 `[상품]` 줄(글로 소개 · 빈 사진 카드 껍데기 금지).
 *   - 버튼 주소는 **비어 있을 때만** 채운다(AI · 브리프가 원문 주소로 이미 채운 것을 덮지 않는다).
 */
import type { Section } from './dm/dm-section-registry';
import type { LineMallCard } from './line-mall-cards';
import type { LineStepsManualProduct } from './one-line-steps';

/**
 * 「이 회사 사진인가」 판정 — 라우트가 `isCompanyImageUrl(url, companyId)`(ai-auto-build-materials CT)를 넘긴다.
 * 이 파일은 런타임 import 0 이다(DM 생성기가 import 하므로 생성기 → 재료 엔진 순환을 만들지 않는다).
 */
export type IsCompanyImage = (url: string) => boolean;

/** (순수) 이 회사 사진인가 — 아니면 'invalid'(조용히 버리지 않는다) · 빈 값 = null */
export function sanitizeLineCompanyImage(url: string | null | undefined, isCompanyImage: IsCompanyImage): string | null | 'invalid' {
  const s = String(url ?? '').trim();
  if (!s) return null;
  return isCompanyImage(s) ? s : 'invalid';
}

/**
 * (순수) 직접 넣은 상품 → 카드(사진 + 가격) · 글줄(그 밖). 사진은 이 회사 경로만(아니면 'invalid').
 * 카드 순서 = 넣은 순서 · 링크는 사람이 적은 주소만.
 * images · urls = 카드가 되지 못한 상품까지 **모든** 직접 상품의 사진 · 주소(넣은 순서) — 대표 사진 · 버튼 주소 재료(Codex 1017 1R:
 *   가격 없이 사진 · 주소만 넣은 상품이 화면에서는 대표 사진 · 주소 단계를 건너뛰게 했는데 서버는 카드만 봐 재료가 사라졌다).
 */
export function splitLineManualProducts(rows: readonly LineStepsManualProduct[], isCompanyImage: IsCompanyImage): { cards: LineMallCard[]; textProducts: Array<{ name: string; price?: number }>; images: string[]; urls: string[] } | 'invalid' {
  const cards: LineMallCard[] = [];
  const textProducts: Array<{ name: string; price?: number }> = [];
  const images: string[] = [];
  const urls: string[] = [];
  for (const r of rows) {
    const img = sanitizeLineCompanyImage(r.image, isCompanyImage);
    if (img === 'invalid') return 'invalid';
    if (img) images.push(img);
    if (r.url) urls.push(r.url);
    if (img && r.price && r.price > 0) {
      cards.push({ name: r.name, price: r.price, image_url: img, ...(r.url ? { link_url: r.url } : {}) });
    } else {
      textProducts.push(r.price ? { name: r.name, price: r.price } : { name: r.name });
    }
  }
  return { cards, textProducts, images, urls };
}

/**
 * (순수) 버튼이 갈 주소 — 사람이 적은 답 → 한 줄 주소 → 첫 확정 상품 링크 → 직접 넣은 상품 주소 → 회사 홈페이지 → 연동 몰 첫 화면. 없으면 null.
 */
export function resolveLineLink(input: { answer?: string | null; lineUrl?: string | null; cards: readonly LineMallCard[]; manualUrls?: readonly string[]; website?: string | null; mallHome?: string | null }): string | null {
  const first = input.cards.find((c) => c.link_url)?.link_url;
  return input.answer || input.lineUrl || first || input.manualUrls?.[0] || input.website || input.mallHome || null;
}

/**
 * (순수) 첫 히어로에 대표 사진을 놓는다. 히어로가 없으면 머리 뒤(없으면 맨 앞)에 사진만 있는 히어로 하나를 넣는다.
 * 순서(order)는 다시 매긴다 · 입력은 바꾸지 않는다 · 주소 없으면 그대로.
 */
export function placeLineHero(sections: readonly Section[], url: string | null | undefined, makeHero: (order: number) => Section): Section[] {
  if (!url) return sections as Section[];
  const idx = sections.findIndex((s) => s.type === 'hero');
  let out: Section[];
  if (idx >= 0) {
    out = sections.map((s, i) => (i === idx ? { ...s, props: { ...(s.props as Record<string, unknown>), image_url: url } as Section['props'] } : s));
  } else {
    const headerIdx = sections.findIndex((s) => s.type === 'header');
    const at = headerIdx >= 0 ? headerIdx + 1 : 0;
    const base = makeHero(at);
    const hero = { ...base, props: { ...(base.props as Record<string, unknown>), image_url: url } as Section['props'] };
    out = [...sections.slice(0, at), hero, ...sections.slice(at)];
  }
  return out.map((s, i) => ({ ...s, order: i }));
}

/** (순수) 첫 CTA 섹션의 첫 버튼 주소가 비어 있으면 채운다(이미 있는 주소는 덮지 않는다) */
export function placeLineLink(sections: readonly Section[], url: string | null | undefined): Section[] {
  if (!url) return sections as Section[];
  const idx = sections.findIndex((s) => s.type === 'cta');
  if (idx < 0) return sections as Section[];
  const props = (sections[idx].props || {}) as Record<string, unknown>;
  const buttons = Array.isArray(props.buttons) ? props.buttons as Array<Record<string, unknown>> : [];
  if (buttons.length === 0 || String(buttons[0]?.url ?? '').trim()) return sections as Section[];
  const nextButtons = buttons.map((b, i) => (i === 0 ? { ...b, url } : b));
  return sections.map((s, i) => (i === idx ? { ...s, props: { ...props, buttons: nextButtons } as Section['props'] } : s));
}

/** 인앱 메시지에서 이 함수가 만지는 칸만 */
export interface LineInAppMessage {
  template: string;
  image_url: string | null;
  title?: string;
  body?: string;
  buttons: Array<Record<string, unknown>>;
  content_blocks: Array<Record<string, unknown>>;
}

/**
 * (순수) 인앱 메시지에 재료를 놓는다.
 *   - 사진: 평면 `image_url` + 블록이 진실인 메시지를 위해 media 블록(맨 앞 · 템플릿이 허용할 때만)
 *   - 상품(확정 카드 1개): product 블록(첫 product 블록 교체 · 없으면 머리글 뒤 · 허용할 때만)
 *   - 버튼 주소: 첫 평면 버튼 · cta_group 첫 버튼(비어 있을 때만)
 *   - **사진이 없으면 full_image(포스터) 템플릿을 쓰지 않는다** — 게시 관문이 사진을 요구해 막힌다(`inapp-message.ts` 게시 조건).
 *     이때는 center_modal 로 바꾸고, 블록이 비었으면 평면 제목 · 본문 · 버튼으로 기본 블록을 만든다.
 */
export function placeInAppLineMaterials(
  message: LineInAppMessage,
  m: { imageUrl?: string | null; linkUrl?: string | null; card?: LineMallCard | null },
  allowed: (template: string, blockType: string) => boolean,
): LineInAppMessage {
  const out: LineInAppMessage = { ...message, buttons: [...(message.buttons || [])], content_blocks: [...(message.content_blocks || [])] };
  const image = m.imageUrl || m.card?.image_url || null;

  if (out.template === 'full_image' && !image) {
    out.template = 'center_modal';
    if (out.content_blocks.length === 0) {
      const blocks: Array<Record<string, unknown>> = [];
      if (String(out.title || '').trim()) blocks.push({ type: 'headline', text: String(out.title).trim(), size: 'lg' });
      if (String(out.body || '').trim()) blocks.push({ type: 'body', text: String(out.body).trim() });
      if (out.buttons.length > 0) {
        blocks.push({ type: 'cta_group', layout: 'stack', buttons: out.buttons.slice(0, 3).map((b, i) => ({ id: String(b.id || `btn_${i}`), label: String(b.label || '자세히 보기'), action_url: b.action_url ?? null, style: i === 0 ? 'primary' : 'secondary' })) });
      }
      out.content_blocks = blocks;
    }
  }

  if (image) {
    out.image_url = image;
    if (allowed(out.template, 'media')) {
      const mediaIdx = out.content_blocks.findIndex((b) => b && b.type === 'media');
      const media = { type: 'media', variant: 'image', url: image };
      if (mediaIdx >= 0) out.content_blocks = out.content_blocks.map((b, i) => (i === mediaIdx ? { ...b, ...media } : b));
      else out.content_blocks = [media, ...out.content_blocks];
    }
  }

  if (m.card && allowed(out.template, 'product')) {
    const c = m.card;
    const block = { type: 'product', name: c.name, price: c.price, ...(c.discount_price ? { discount_price: c.discount_price } : {}), image: c.image_url, ...(c.link_url ? { link_url: c.link_url } : {}) };
    const pIdx = out.content_blocks.findIndex((b) => b && b.type === 'product');
    if (pIdx >= 0) {
      out.content_blocks = out.content_blocks.map((b, i) => (i === pIdx ? block : b)).filter((b, i) => b.type !== 'product' || i === pIdx);
    } else {
      const head = out.content_blocks.findIndex((b) => b && b.type === 'headline');
      const at = head >= 0 ? head + 1 : out.content_blocks.length;
      out.content_blocks = [...out.content_blocks.slice(0, at), block, ...out.content_blocks.slice(at)];
    }
  }

  const link = m.linkUrl || null;
  if (link) {
    if (out.buttons.length > 0 && !String(out.buttons[0]?.action_url ?? '').trim()) {
      out.buttons = out.buttons.map((b, i) => (i === 0 ? { ...b, action_url: link } : b));
    }
    out.content_blocks = out.content_blocks.map((b) => {
      if (!b || b.type !== 'cta_group' || !Array.isArray(b.buttons) || b.buttons.length === 0) return b;
      const btns = b.buttons as Array<Record<string, unknown>>;
      if (String(btns[0]?.action_url ?? '').trim()) return b;
      return { ...b, buttons: btns.map((x, i) => (i === 0 ? { ...x, action_url: link } : x)) };
    });
  }
  return out;
}
