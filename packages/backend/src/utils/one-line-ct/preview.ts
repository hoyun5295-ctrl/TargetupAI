/**
 * one-line-ct/preview.ts — 재료 판 미리보기(구성 + 지금 재료 · 기본 문구 · 빈 칸 = 점선 자리 · AI 0 · DB 0 · 0원)
 *   설계서 docs/2026-10-22-oneline-ct-design.md §11-5. 결과물과 같은 조립 함수 · 같은 렌더러(보이는 것 = 나오는 것).
 *   ⛔ 점선 자리(고스트)는 미리보기에만 있다 — 요리 경로(`composeRichDm`)는 이 함수를 거치지 않는다.
 */
import { randomUUID } from 'crypto';
import { renderDmViewerHtml } from '../dm/dm-viewer';
import { renderEmailSections } from '../email/email-section-renderer';
import type { DmBrandKit } from '../dm/dm-tokens';
import type { Section } from '../dm/dm-section-registry';
import { formatLinePeriodEnd, sanitizeLineRichBody, isValidLinePeriodEnd } from '../one-line-steps';
import {
  composeRichDm, composeRichEmail, composeRichInapp, compositionMissing, compositionFallbackCopy,
  type LineComposition, type LineRichMaterials, type LineRichCopy, type LineRichProduct,
} from '../line-compositions';
import type { LineInAppMessage } from '../line-template-compose';

const URL_MAX = 500;
/** 미리보기 사진 주소 — http(s) 또는 이 서버 경로('/…' · '//' 제외) · 따옴표 · 공백 0 */
function previewUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > URL_MAX || /[\s"'<>]/.test(s)) return null;
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  return /^https?:\/\//i.test(s) ? s : null;
}
const str = (raw: unknown, max: number): string => (typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** (순수) 화면이 보낸 재료 → 미리보기 재료(틀린 칸은 버린다 · 미리보기라 거절 대신 빈 칸) */
export function previewMaterials(raw: unknown, nowMs: number): LineRichMaterials {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, any> : {};
  const products: LineRichProduct[] = (Array.isArray(o.products) ? o.products : []).slice(0, 12).map((p: any) => {
    const image = previewUrl(p?.image_url);
    const name = str(p?.name, 60);
    if (!image || !name) return null;
    const price = Number(p?.price);
    const disc = Number(p?.discount_price);
    return {
      name, price: Number.isFinite(price) && price > 0 ? Math.round(price) : null,
      ...(Number.isFinite(disc) && disc > 0 ? { discount_price: Math.round(disc) } : {}),
      image_url: image, category: str(p?.category, 20) || null,
    };
  }).filter(Boolean) as LineRichProduct[];
  const rich = sanitizeLineRichBody(o.rich ?? null, []);
  const r = rich && rich !== 'invalid' ? rich : { points: [], usage: [], mood: [], couponCode: null, store: null, benefitNote: null, categories: [] };
  const pt = (p: { title: string; body: string; image: string | null }) => ({ title: p.title, body: p.body, ...(previewUrl(p.image) ? { image_url: previewUrl(p.image)! } : {}) });
  const posterUrl = previewUrl(o.poster?.url);
  const periodEnd = typeof o.period_end === 'string' && isValidLinePeriodEnd(o.period_end, nowMs) ? o.period_end : null;
  const proof = (Array.isArray(o.proof) ? o.proof : []).slice(0, 3).map((x: any) => ({ body: str(x?.body, 300), author: str(x?.author, 20) || '구매 고객', rating: Math.min(5, Math.max(1, Math.round(Number(x?.rating) || 5))) })).filter((x: any) => x.body.length >= 2);
  return {
    brandName: str(o.brand_name, 30),
    poster: posterUrl ? { url: posterUrl, ...(o.poster?.as_is === true ? { asIs: true } : {}) } : null,
    products,
    points: r.points.map(pt),
    steps: r.usage.map(pt),
    mood: r.mood.map(previewUrl).filter((u): u is string => !!u),
    proof,
    benefit: str(o.benefit, 300) || null,
    benefitNote: r.benefitNote,
    couponCode: r.couponCode,
    periodEnd,
    periodLabel: periodEnd ? `${formatLinePeriodEnd(periodEnd)}까지` : null,
    link: 'https://example.com',
    store: r.store,
  };
}

/** 점선 자리(빈 칸마다 한 줄 · 결과물엔 없다) */
function ghostSections(comp: LineComposition, m: LineRichMaterials): Section[] {
  return compositionMissing(comp, m).map((s, i) => ({
    id: `ghost-${i}-${randomUUID().slice(0, 6)}`, type: 'text_card', order: 0, visible: true, treatment: 'framed',
    props: { tag: s.level === 'block' ? '꼭 필요해요' : s.level === 'suggest' ? '넣으면 좋아요' : '있으면 생겨요', headline: s.ask, body: s.why, align: 'center', image_position: 'top' },
  } as Section));
}

/** 미리보기 한 벌 — DM · 이메일 = html · 인앱 = 메시지 JSON · 빈 칸 수 */
export function renderCompositionPreview(comp: LineComposition, channel: 'dm' | 'email' | 'inapp', m: LineRichMaterials, copy?: LineRichCopy): { html?: string; message?: LineInAppMessage; missing: number } {
  const c = copy ?? compositionFallbackCopy(comp);
  const missing = compositionMissing(comp, m).length;
  if (channel === 'inapp') return { message: composeRichInapp(comp, m, c), missing };
  const kit = { primary_color: comp.primary, accent_color: comp.accent } as DmBrandKit;
  if (channel === 'email') {
    const r = composeRichEmail(comp, m, c, () => randomUUID());
    const ghosts = ghostSections(comp, m);
    const sections = [...r.sections.slice(0, -1), ...ghosts, ...r.sections.slice(-1)].map((s, i) => ({ ...s, order: i }));
    return { html: renderEmailSections(sections, { brandKit: kit, storeName: m.brandName }), missing };
  }
  const r = composeRichDm(comp, m, c, () => randomUUID());
  // 점선 자리 = 마무리(문구 · 버튼 · 꼬리) 앞
  const tailAt = Math.max(0, r.sections.length - 3);
  const sections = [...r.sections.slice(0, tailAt), ...ghostSections(comp, m), ...r.sections.slice(tailAt)].map((s, i) => ({ ...s, order: i }));
  const dm = { title: `${m.brandName || comp.label} 미리보기`, store_name: m.brandName, layout_mode: 'scroll', pages: [{ id: 'p', name: '1장', sections }], sections, brand_kit: { ...kit, ...r.brandKitPatch }, short_code: '' };
  return { html: renderDmViewerHtml(dm, ''), missing };
}
