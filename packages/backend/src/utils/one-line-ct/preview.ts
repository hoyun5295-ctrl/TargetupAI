/**
 * one-line-ct/preview.ts — 재료 판 미리보기(구성 + 지금 재료 · 기본 문구 · 빈 칸 = 점선 자리 · AI 0 · 0원)
 *   설계서 docs/2026-10-22-oneline-ct-design.md §11-5 · ★ 2026-10-23 docs/2026-10-23-oneline-ct-complete-design.md A1 · A1-b.
 *   받는 것 = **만들기 요청과 같은 본문**(같은 검증 `sanitizeLineStepsBody` · 같은 재료 변환 `lineCookMaterials` · 같은 진단 `diagnoseComposition`).
 *   만들기와 다른 것 둘뿐: 몰 상품은 재조회 대신 화면이 가진 사진 목록 · 페이지 표지는 화면이 읽어 둔 값(둘 다 미리보기 전용 · 결과물엔 서버가 다시 읽은 값).
 *   ⛔ 점선 자리(고스트)는 미리보기에만 있다 — 요리 경로(`composeRichDm`)는 이 함수를 거치지 않는다.
 */
import { randomUUID } from 'crypto';
import { renderDmViewerHtml } from '../dm/dm-viewer';
import { renderEmailSections } from '../email/email-section-renderer';
import type { DmBrandKit } from '../dm/dm-tokens';
import type { Section } from '../dm/dm-section-registry';
import type { LineStepsBody } from '../one-line-steps';
import type { LineMallCard } from '../line-mall-cards';
import type { LinePageMaterial } from '../line-template-page';
import {
  composeRichDm, composeRichEmail, composeRichInapp, compositionFallbackCopy, diagnoseComposition, diagnosisMissing,
  type LineComposition, type LineRichMaterials, type LineRichCopy, type LineSlotDiagnosis,
} from '../line-compositions';
import type { LineInAppMessage } from '../line-template-compose';
import { lineCookManual, lineCookMaterials } from './index';

const URL_MAX = 500;
/** 미리보기 사진 주소 — http(s) 또는 이 서버 경로('/…' · '//' 제외) · 따옴표 · 공백 0 */
export function previewUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > URL_MAX || /[\s"'<>]/.test(s)) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  return /^https?:\/\//i.test(s) ? s : null;
}
const str = (raw: unknown, max: number): string => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** (순수) 화면이 가진 몰 상품 사진 목록 → 카드(틀린 칸은 버린다 · 미리보기라 거절 대신 빈 칸 · 12개) */
export function previewCards(raw: unknown): LineMallCard[] {
  return (Array.isArray(raw) ? raw : []).slice(0, 12).map((p: any): LineMallCard | null => {
    const image = previewUrl(p?.image_url);
    const name = str(p?.name, 60);
    if (!image || !name) return null;
    const price = Number(p?.price);
    const disc = Number(p?.discount_price);
    return { name, price: Number.isFinite(price) && price > 0 ? Math.round(price) : 0, ...(Number.isFinite(disc) && disc > 0 ? { discount_price: Math.round(disc) } : {}), image_url: image };
  }).filter((c): c is LineMallCard => !!c);
}

/** 점선 자리(빈 칸마다 한 줄 · 결과물엔 없다) */
function ghostSections(missing: readonly LineSlotDiagnosis[]): Section[] {
  return missing.map((s, i) => ({
    id: `ghost-${i}-${randomUUID().slice(0, 6)}`, type: 'text_card', order: 0, visible: true, treatment: 'framed',
    props: { tag: s.level === 'block' ? '꼭 필요해요' : s.level === 'suggest' ? '넣으면 좋아요' : '있으면 생겨요', headline: s.ask, body: s.why, align: 'center', image_position: 'top' },
  } as Section));
}

export interface CompositionPreviewInput {
  comp: LineComposition;
  channel: 'dm' | 'email' | 'inapp';
  body: LineStepsBody;
  /** 화면이 가진 몰 상품(사진 · 이름 · 가격) */
  mallCards: readonly LineMallCard[];
  /** 화면이 읽어 둔 페이지 표지 사진 */
  pageBanner: string | null;
  brand: { brandName: string; logoUrl: string | null; csPhone: string | null };
  pinnedPrimary: string | null;
  companyId: string;
}

/** (순수) 미리보기 재료 — 만들기와 같은 변환(사진 주소만 미리보기 규칙으로 거른다) */
export function previewMaterialsOf(input: CompositionPreviewInput): { comp: LineComposition; materials: LineRichMaterials } {
  const b = input.body;
  const okImg = (u: string | null | undefined) => previewUrl(u) ?? undefined;
  const manual = lineCookManual(b.manual.map((m) => ({ ...m, image: okImg(m.image) })), b.rich.categories);
  const cards = [...input.mallCards, ...manual.cards];
  const categories = [...input.mallCards.map(() => null), ...manual.categories];
  const pt = (p: LineStepsBody['rich']['points'][number]) => ({ ...p, image: previewUrl(p.image) });
  const banner = previewUrl(input.pageBanner);
  return lineCookMaterials({
    composition: input.comp, channel: input.channel, companyId: input.companyId, line: '',
    ...input.brand, pinnedPrimary: input.pinnedPrimary,
    cards: input.channel === 'inapp' ? cards.slice(0, 1) : cards, cardCategories: input.channel === 'inapp' ? [] : categories,
    heroUpload: previewUrl(b.heroImage), heroAsIs: b.heroPoster, proof: b.proof,
    page: banner ? ({ url: '', banner, licensedText: null } satisfies LinePageMaterial) : null,
    benefitAnswer: b.facts.benefit, periodEnd: b.facts.periodEnd ?? null, link: b.facts.link ?? 'https://example.com',
    rich: { ...b.rich, points: b.rich.points.map(pt), usage: b.rich.usage.map(pt), mood: b.rich.mood.map((u) => previewUrl(u)).filter((u): u is string => !!u) },
  });
}

/** 미리보기 한 벌 — DM · 이메일 = html · 인앱 = 메시지 JSON · 빈 칸 수 · 칸 판정(화면이 이 판정을 그린다) */
export function renderCompositionPreview(comp: LineComposition, channel: 'dm' | 'email' | 'inapp', m: LineRichMaterials, copy?: LineRichCopy): { html?: string; message?: LineInAppMessage; missing: number; slots: LineSlotDiagnosis[] } {
  const c = copy ?? compositionFallbackCopy(comp);
  const slots = diagnoseComposition(comp, m, channel);
  const empty = diagnosisMissing(slots);
  if (channel === 'inapp') return { message: composeRichInapp(comp, m, c), missing: empty.length, slots };
  const kit = { primary_color: comp.primary, accent_color: comp.accent } as DmBrandKit;
  if (channel === 'email') {
    const r = composeRichEmail(comp, m, c, () => randomUUID());
    const sections = [...r.sections.slice(0, -1), ...ghostSections(empty), ...r.sections.slice(-1)].map((s, i) => ({ ...s, order: i }));
    return { html: renderEmailSections(sections, { brandKit: kit, storeName: m.brandName }), missing: empty.length, slots };
  }
  const r = composeRichDm(comp, m, c, () => randomUUID());
  // 점선 자리 = 마무리(문구 · 버튼 · 꼬리) 앞
  const tailAt = Math.max(0, r.sections.length - 3);
  const sections = [...r.sections.slice(0, tailAt), ...ghostSections(empty), ...r.sections.slice(tailAt)].map((s, i) => ({ ...s, order: i }));
  const dm = { title: `${m.brandName || comp.label} 미리보기`, store_name: m.brandName, layout_mode: 'scroll', pages: [{ id: 'p', name: '1장', sections }], sections, brand_kit: { ...kit, ...r.brandKitPatch }, short_code: '' };
  return { html: renderDmViewerHtml(dm, ''), missing: empty.length, slots };
}
