/**
 * line-template-outreach.ts — AI 영업에 템플릿 조립을 꽂는 adapter (★ 2026-10-18 · 설계서 docs/2026-10-18-outreach-line-template-design.md)
 *
 * AI 영업 DM · 브랜드 이메일은 재료(상품 · 행사)가 있으면 코드 표준 조립(`composeOutreachStandard`)을 공용 엔진의 preset 자리로 넘긴다.
 * 스위치(`OUTREACH_LINE_TEMPLATES`)를 켜면 그 자리에 템플릿 조립을 먼저 넣고, 고를 템플릿이 없거나 품질 관문이 실패하면 지금 표준 조립 그대로.
 *
 * 흐름 = ① 코드가 재료로 고를 수 있는 템플릿을 거른다(자격) ② AI 가 이벤트 페이지 · 고객사 페이지 글 · 업종을 읽고 그중 하나와
 *        칸마다 문구를 업종 문구 묶음에서 고른다(추천) ③ 코드가 조립한다(값 = 재료 그대로). AI 실패 = 자격 1순위 + 기본 문구.
 *
 * ⛔ 불변
 *   - AI 는 고르기만 한다 — 문구를 쓰지 않는다(Codex R1~R3: AI 자유 문장의 값 · 혜택 결합은 사후 검사로 닫히지 않는다). 고른 값은 번호로 받아 자격 · 결 · 마감 근거를 다시 본다.
 *   - 값이 필요한 자리(면허 혜택 원문 · 기간 · 가격 · 행사 제목 · 표지 그림)는 코드가 재료에서 그대로 놓는다(표준 조립과 같은 원칙).
 *   - 혜택 = 첫 면허 행사 카드 제목 원문(30자 넘으면 없음 · 뽑거나 줄이지 않는다). 빅세일 = 그 혜택에 세일 · 할인 말이 있을 때만(% · 적립만으로는 아님 · R4).
 *   - 표지 그림(포스터 · 홈 배너 · 행사 배너)은 글자가 박힌 그림이라 덮지 않는다(asIs).
 *   - 섹션 id 에 부분을 싣는다(`so-tpl-<부분>-n` · 표지 = `so-tpl-cover-<종류>-n`) — 학습 레시피 · 판정 카드가 id 로 출처를 읽는다(Section 은 공용 닫힌 타입).
 */
import { getLineTemplate, type LineTemplate, type LineTemplateId, type LineCopyKey } from './design-core/line-templates';
import { composeLineDm, composeLineEmail, lineTemplateGate, type LineMaterials, type LineCopy, type NewId } from './line-template-compose';
import { OUTREACH_COPY_BANK, OUTREACH_TONE_LABEL, outreachBankUsable, outreachBankText, outreachToneOf, type OutreachTone, type OutreachFills } from './line-template-outreach-bank';
import { formatLinePeriodEnd, isValidLinePeriodEnd } from './one-line-steps';
import { extractJsonFromAiText } from './ai-json';
import type { Section } from './dm/dm-section-registry';

/** AI 영업 템플릿 스위치(영업 샘플 전용 축 · 고객 스위치와 따로) */
export function outreachLineTemplatesEnabled(env: string | undefined = process.env.OUTREACH_LINE_TEMPLATES): boolean {
  return /^(1|true|on)$/i.test(String(env || '').trim());
}

/** 표준 재료(`standardMaterialsOf` 결과)에서 쓰는 모양 — 순환 import 를 피해 구조만 받는다 */
export interface OutreachStdLike {
  hero: { url: string; kind: 'poster' | 'banner' | 'card'; linkUrl: string } | null;
  products: ReadonlyArray<{ name: string; image_url: string; link_url: string; price: number | null; discount_price: number | null }>;
  events: ReadonlyArray<{ title: string; periodLine: string; imageUrl: string | null; linkUrl: string; slices?: ReadonlyArray<{ url: string }>; text?: string; ctaLabel?: string }>;
  ctaUrl: string;
}

/** 행사 카드 중 쓰는 칸(엔진 카드 모양) — text = 면허 카드 본문(구매 조건 같은 원문) */
export interface OutreachCardLike { title: string; endDate: string | null; licensed: boolean; text?: string | null }

export interface OutreachLineInput {
  companyName: string;
  siteTitle: string | null;
  /** 업종 코드(industry-codes) — 문구 결 */
  industry: string | null;
  logoUrl: string | null;
  legal: { legal: string | null; csPhone: string | null } | null;
  /** 사람이 고른 순서 그대로 */
  eventCards: ReadonlyArray<OutreachCardLike>;
  /** 접근성 보정 주색 · 없으면 무채색(아웃리치 규칙 그대로) */
  primary: string;
  /** 쇼핑몰 주소(표준 조립의 갤러리 링크 규칙) — 신상품 근거가 없을 때 · 계절 안내의 버튼 목적지 */
  shopUrl: string;
}

/** 템플릿 재료 + AI 영업 몫(버튼 목적지 근거) */
export interface OutreachLineMaterials extends LineMaterials {
  /** 혜택 카드(첫 면허 카드)의 행사 주소 — 빅세일 · 특별 이벤트 버튼 목적지 */
  benefitLink: string | null;
  shopUrl: string | null;
}

/** 혜택 띠 글자 상한 — 넘으면 띠를 만들지 않는다(자르면 뜻이 바뀐다 · 1017 Codex 원칙) */
export const OUTREACH_BENEFIT_MAX = 30;

/** (순수) 혜택 = 첫 면허 행사 카드 제목 원문(30자 이하) · 마감 = 그 카드의 종료일(달력에 있고 오늘 전날 ~ 400일 안) */
export function outreachBenefitOf(cards: ReadonlyArray<OutreachCardLike>, nowMs: number): { benefit: string | null; periodEnd: string | null; note: string | null; index: number } {
  // 표준 재료(standardMaterialsOf)와 같은 거르기(제목 있는 카드) — 순번이 표준 행사 목록과 같다
  const titled = cards.filter((c) => c && String(c.title || '').trim());
  const index = titled.findIndex((c) => c.licensed);
  if (index < 0) return { benefit: null, periodEnd: null, note: null, index: -1 };
  const card = titled[index];
  const title = String(card.title).trim();
  const note = String(card.text || '').replace(/\s+/g, ' ').trim();
  return {
    benefit: title.length <= OUTREACH_BENEFIT_MAX ? title : null,
    periodEnd: card.endDate && isValidLinePeriodEnd(card.endDate, nowMs) ? card.endDate : null,
    note: note || null,
    index,
  };
}

/** (순수) 표준 재료 → 템플릿 재료 */
export function outreachLineMaterials(input: OutreachLineInput, std: OutreachStdLike, nowMs: number): OutreachLineMaterials {
  const { benefit, periodEnd, note, index } = outreachBenefitOf(input.eventCards, nowMs);
  return {
    brandName: input.companyName,
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
    ...(input.legal?.csPhone ? { csPhone: input.legal.csPhone } : {}),
    ...(input.legal?.legal ? { legal: input.legal.legal } : {}),
    // 표지 링크 = 그 그림이 가리키는 곳(첫 행사 상세 · 없으면 홈) — 결과물 대표 링크(마지막 행사)와 다를 수 있다
    hero: std.hero ? { url: std.hero.url, asIs: true, ...(std.hero.linkUrl ? { linkUrl: std.hero.linkUrl } : {}) } : null,
    products: std.products.map((p) => ({
      name: String(p.name).trim().slice(0, 60),
      price: p.price !== null && p.price > 0 ? p.price : null,
      ...(p.discount_price !== null && p.discount_price > 0 ? { discount_price: p.discount_price } : {}),
      image_url: p.image_url,
      link_url: p.link_url,
    })),
    textProducts: [],
    benefit,
    // 조건 글은 혜택이 실릴 때만(혜택 없는 조건 글 = 뜻이 없다)
    benefitNote: benefit ? note : null,
    periodEnd,
    periodLabel: periodEnd ? `${formatLinePeriodEnd(periodEnd)}까지` : null,
    link: std.ctaUrl || null,
    events: std.events.map((e) => ({
      title: e.title,
      periodLabel: e.periodLine || null,
      image_url: e.imageUrl,
      link_url: e.linkUrl,
      ...(e.text ? { text: e.text } : {}),
      ...(e.ctaLabel ? { cta_label: e.ctaLabel } : {}),
      slices: (e.slices || []).map((s) => ({ url: s.url })),
    })),
    benefitLink: benefit && index >= 0 ? std.events[index]?.linkUrl || null : null,
    shopUrl: input.shopUrl || null,
  };
}

const matchWords = (re: RegExp, text: string): string[] => {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  return Array.from(new Set(Array.from(String(text || '').matchAll(g)).map((m) => m[0].trim()).filter(Boolean))).slice(0, 3);
};

/**
 * 자격 말 — 문구가 고정이라 고르기가 재료와 어긋나면 안 된다(R4). 고객 템플릿의 고르기 말보다 좁다:
 *   세일 = 세일 · 할인 말(숫자 % · 적립 · 감사제만으로는 아님) / 신상 = 새로 나온 것을 말하는 말(재입고 · 컬렉션 · renew 같은 영문 조각 제외).
 */
const OUTREACH_SALE_WORDS = /세일|할인|특가|블프|블랙\s*프라이데이|시즌\s*오프|클리어런스|가격\s*인하/;
const OUTREACH_NEW_WORDS = /신상|신제품|신메뉴|출시|런칭|론칭|새로\s*나온|첫\s*선|(?<![A-Za-z])NEW(?![A-Za-z])/;

/** 자격 하나 — 템플릿 · 이유(재료 낱말) · 버튼 목적지(그 템플릿이 말하는 대상의 주소 · 버튼 글과 목적지를 같은 대상에 묶는다 · R5) */
export interface OutreachEligible { id: LineTemplateId; reasons: string[]; link: string | null }

/** 고른 기록 — 템플릿 · 자격 이유(재료 낱말) · 누가 골랐나 · 칸마다 고른 문구 번호(묶음 번호) */
export interface OutreachLineTemplateRecord {
  id: LineTemplateId;
  reasons: string[];
  /** ai = AI 가 고름 · best = AI 실패 → 학습 베스트(승격 레시피) · rule = 자격 1순위 + 기본 문구 */
  by: 'ai' | 'best' | 'rule';
  copy: Partial<Record<LineCopyKey, number>>;
}

/** 업종 결의 학습 베스트 = 승격 레시피의 템플릿 선택 집계(원문 0) — 템플릿별 횟수 · 템플릿 · 칸별 문구 번호 횟수 */
export interface OutreachBest {
  total: number;
  templates: Partial<Record<LineTemplateId, number>>;
  copy: Partial<Record<LineTemplateId, Partial<Record<LineCopyKey, Record<number, number>>>>>;
}

/** 학습 베스트를 규칙으로 쓰는 최소 횟수(1건짜리 하나가 전부를 끌고 가지 않게) · 프롬프트 힌트는 1건부터(횟수를 그대로 보여 준다) */
export const OUTREACH_BEST_MIN = 2;

/**
 * (순수) 승격 레시피의 lineTemplate 행들 → 집계. 모양이 틀린 행 · 모르는 템플릿 · 묶음에 없는 번호는 버린다.
 * 기록의 copy 는 기본(0번)이 아닌 칸만 싣으므로, 묶음에 있는 칸에서 빠진 칸 = 0번으로 센다. 0건 = null.
 */
export function outreachBestOf(rows: readonly unknown[]): OutreachBest | null {
  const best: OutreachBest = { total: 0, templates: {}, copy: {} };
  for (const raw of rows) {
    const rec = outreachLineTemplateRecordOf(raw);
    if (!rec) continue;
    best.total += 1;
    best.templates[rec.id] = (best.templates[rec.id] || 0) + 1;
    const slots = (best.copy[rec.id] ||= {});
    for (const key of Object.keys(OUTREACH_COPY_BANK[rec.id]) as LineCopyKey[]) {
      const n = rec.copy[key] ?? 0;
      if (!OUTREACH_COPY_BANK[rec.id][key]?.[n]) continue;
      const byIndex = (slots[key] ||= {});
      byIndex[n] = (byIndex[n] || 0) + 1;
    }
  }
  return best.total > 0 ? best : null;
}

/**
 * (순수) 재료로 고를 수 있는 템플릿(앞 = 규칙 1순위 · Harold 1018 Q4):
 *   면허 혜택 있음 → 빅세일(혜택에 세일 · 할인 말) · 특별 이벤트 / 혜택 없음 + 상품 있음 → 신상품 공개(신상 근거) · 계절 안내 / 둘 다 없음 = [](표준 조립).
 *   혜택이 있으면 혜택을 싣는 두 템플릿만(신상품 · 계절은 혜택 칸을 표지에 두지 않는다). 마감일은 자격이 아니다(없으면 마감 띠 · 마감 문구만 빠진다).
 *   신상 근거 = 보여 줄 행사 제목 · 상품 이름에 든 말만(사이트 이름 「New Balance」 같은 것은 근거가 아니다 · R5). 버튼 목적지 = 그 근거의 주소.
 */
export function eligibleOutreachTemplates(m: OutreachLineMaterials, signal: string): OutreachEligible[] {
  if (m.benefit) {
    const sale = matchWords(OUTREACH_SALE_WORDS, m.benefit);
    const link = m.benefitLink || m.link;
    return [
      ...(sale.length > 0 ? [{ id: 'big-sale' as const, reasons: sale, link }] : []),
      { id: 'special-event', reasons: matchWords(getLineTemplate('special-event')!.match, `${m.benefit} ${signal}`), link },
    ];
  }
  if (m.products.length > 0) {
    const freshEvent = (m.events || []).slice(0, 3).find((e) => OUTREACH_NEW_WORDS.test(e.title));
    const freshProduct = freshEvent ? null : m.products.find((p) => OUTREACH_NEW_WORDS.test(p.name));
    const fresh = freshEvent ? matchWords(OUTREACH_NEW_WORDS, freshEvent.title) : freshProduct ? matchWords(OUTREACH_NEW_WORDS, freshProduct.name) : [];
    const shop = m.shopUrl || m.link || null;
    return [
      ...(fresh.length > 0 ? [{ id: 'new-launch' as const, reasons: fresh, link: (freshEvent ? freshEvent.link_url : freshProduct!.link_url) || null }] : []),
      { id: 'season', reasons: matchWords(getLineTemplate('season')!.match, signal), link: shop },
    ];
  }
  return [];
}

/** 채움 값 — 브랜드 이름 · 대표 상품 이름(재료 원문) */
export function outreachFillsOf(companyName: string, m: Pick<LineMaterials, 'products'>): OutreachFills {
  return { brand: companyName, product: m.products[0]?.name || null };
}

/** (순수) 고르기 신호 글 — 행사 제목 · 사이트 제목 · 상품 이름(표준 재료가 면허 밖 숫자를 이미 걷은 글) */
export function outreachSignalOf(input: Pick<OutreachLineInput, 'siteTitle'>, std: OutreachStdLike): string {
  return [...std.events.map((e) => e.title), input.siteTitle || '', ...std.products.map((p) => p.name)].filter(Boolean).join(' · ');
}

const slotMax = (id: LineTemplateId, key: LineCopyKey): number => getLineTemplate(id)!.copy.find((f) => f.key === key)?.max ?? 0;

/** 칸마다 지금 쓸 수 있는 문구(번호 · 채운 글) — 결 · 마감 근거 · 채움 값 · 칸 상한 */
function usableLines(id: LineTemplateId, key: LineCopyKey, tone: OutreachTone, hasDeadline: boolean, fills: OutreachFills): Array<{ i: number; text: string }> {
  const max = slotMax(id, key);
  return (OUTREACH_COPY_BANK[id][key] || []).flatMap((l, i) => {
    if (!outreachBankUsable(l, tone, hasDeadline)) return [];
    const text = outreachBankText(l, fills, max);
    return text ? [{ i, text }] : [];
  });
}

/** AI 가 읽는 재료(값은 고르기 근거로만 보여 준다 · 결과물에는 코드가 재료 원문을 놓는다) */
export interface OutreachPickContext {
  companyName: string;
  industry: string | null;
  /** 이벤트 페이지 · 고객사 페이지에서 읽은 글(면허 밖 혜택은 이미 걷은 글) */
  pageText: string;
  siteTitle: string | null;
}

/** (순수) 추천 프롬프트 — 고를 수 있는 템플릿과 칸마다 고를 수 있는 문구(번호)만 보여 준다 */
/** 칸마다 학습에서 가장 많이 오른, 지금 쓸 수 있는 번호(횟수 내림 · 같으면 앞 번호) */
function bestIndexOf(best: OutreachBest, id: LineTemplateId, key: LineCopyKey, usable: readonly number[], min: number): { i: number; n: number } | null {
  const counts = best.copy[id]?.[key] || {};
  const ranked = Object.entries(counts).map(([i, n]) => ({ i: Number(i), n })).filter((x) => x.n >= min && usable.includes(x.i)).sort((a, b) => b.n - a.n || a.i - b.i);
  return ranked[0] || null;
}

/** (순수) 학습 힌트 — 자격 템플릿 · 지금 쓸 수 있는 번호만 · 횟수 그대로(참고) · 없으면 '' */
export function outreachBestHint(best: OutreachBest | null, eligible: ReadonlyArray<{ id: LineTemplateId }>, tone: OutreachTone, hasDeadline: boolean, fills: OutreachFills): string {
  if (!best) return '';
  const lines: string[] = [];
  const counted = eligible.filter((e) => (best.templates[e.id] || 0) > 0);
  if (counted.length === 0) return '';
  lines.push(`[이 업종 결에서 운영자가 학습에 올린 선택 · ${best.total}건 · 참고만 · 이 페이지와 맞을 때 따르세요]`);
  lines.push(`  템플릿: ${counted.map((e) => `${e.id} ${best.templates[e.id]}`).join(' · ')}`);
  for (const e of counted) {
    const picks = (Object.keys(OUTREACH_COPY_BANK[e.id]) as LineCopyKey[]).flatMap((key) => {
      const top = bestIndexOf(best, e.id, key, usableLines(e.id, key, tone, hasDeadline, fills).map((l) => l.i), 1);
      return top ? [`${key} [${top.i}]×${top.n}`] : [];
    });
    if (picks.length > 0) lines.push(`  ${e.id} 칸별 많이 오른 번호: ${picks.join(' · ')}`);
  }
  return lines.join('\n');
}

/**
 * (순수) 규칙 — 학습 베스트가 자격 안에서 같은 템플릿 2건 이상이면 그 템플릿(by 'best') + 칸마다 2회 이상 오른 쓸 수 있는 번호,
 * 아니면 자격 1순위 + 기본 문구(by 'rule'). AI 실패 · 시간 초과 · 해석 실패 때 쓴다.
 */
export function outreachRuleOf(eligible: ReadonlyArray<OutreachEligible>, best: OutreachBest | null, tone: OutreachTone, hasDeadline: boolean, fills: OutreachFills): OutreachLineTemplateRecord {
  const ranked = best
    ? eligible.map((e, k) => ({ e, k, n: best.templates[e.id] || 0 })).filter((x) => x.n >= OUTREACH_BEST_MIN).sort((a, b) => b.n - a.n || a.k - b.k)
    : [];
  if (!best || ranked.length === 0) return { id: eligible[0].id, reasons: eligible[0].reasons, by: 'rule', copy: {} };
  const pick = ranked[0].e;
  const copy: Partial<Record<LineCopyKey, number>> = {};
  for (const key of Object.keys(OUTREACH_COPY_BANK[pick.id]) as LineCopyKey[]) {
    const top = bestIndexOf(best, pick.id, key, usableLines(pick.id, key, tone, hasDeadline, fills).map((l) => l.i), OUTREACH_BEST_MIN);
    if (top && top.i !== 0) copy[key] = top.i;
  }
  return { id: pick.id, reasons: pick.reasons, by: 'best', copy };
}

export function buildOutreachPickPrompt(ctx: OutreachPickContext, m: LineMaterials, eligible: ReadonlyArray<{ id: LineTemplateId }>, best: OutreachBest | null = null): { system: string; user: string } {
  const tone = outreachToneOf(ctx.industry);
  const hasDeadline = !!m.periodEnd;
  const fills = outreachFillsOf(ctx.companyName, m);
  const hint = outreachBestHint(best, eligible, tone, hasDeadline, fills);
  const system = [
    '당신은 한국 브랜드의 모바일 DM 기획자입니다. 브랜드 페이지 글과 업종을 읽고, 주어진 템플릿 중 가장 잘 맞는 하나와 칸마다 이 브랜드에 가장 잘 맞는 문구 번호를 고릅니다.',
    '고르는 기준: 페이지가 실제로 말하는 행사 · 상품의 성격, 업종의 말투, 칸끼리 같은 말이 겹치지 않는 흐름.',
    '문구를 새로 쓰지 않습니다. 반드시 보기의 번호만 고릅니다.',
    '출력은 JSON 객체 하나만: {"template":"<템플릿 id>","copy":{"<칸>":<번호>, ...}} (설명 · 코드블록 금지).',
  ].join('\n');
  const options = eligible.map((e) => {
    const t = getLineTemplate(e.id)!;
    const slots = (Object.keys(OUTREACH_COPY_BANK[e.id]) as LineCopyKey[]).map((key) =>
      `  ${key}: ${usableLines(e.id, key, tone, hasDeadline, fills).map((l) => `[${l.i}] ${l.text}`).join(' / ')}`);
    return [`[템플릿 ${e.id}] ${t.label} · ${t.desc}`, ...slots].join('\n');
  });
  const user = [
    `[브랜드] ${ctx.companyName} (업종: ${OUTREACH_TONE_LABEL[tone]})`,
    ctx.siteTitle ? `[사이트 제목] ${ctx.siteTitle}` : '',
    `[진행 중인 행사] ${(m.events || []).map((e) => e.title).filter(Boolean).slice(0, 3).join(' / ') || '없음'}`,
    `[대표 상품] ${m.products.map((p) => p.name).slice(0, 6).join(' / ') || '없음'}`,
    m.benefit ? `[확인된 혜택 원문] ${m.benefit}` : '[확인된 혜택] 없음',
    `[마감일] ${hasDeadline ? '있음' : '없음'}`,
    ctx.pageText ? `[페이지 글]\n${ctx.pageText.slice(0, 1500)}` : '',
    hint,
    '',
    '[고를 수 있는 템플릿과 칸별 문구]',
    ...options,
  ].filter((l) => l !== '').join('\n');
  return { system, user };
}

/** (순수) 추천 응답 → 기록. 템플릿이 자격 밖이면 null · 칸 번호는 지금 쓸 수 있는 것만(나머지 칸 = 기본) */
export function parseOutreachPick(raw: string, eligible: ReadonlyArray<{ id: LineTemplateId; reasons: string[] }>, tone: OutreachTone, hasDeadline: boolean, fills: OutreachFills): OutreachLineTemplateRecord | null {
  let o: any;
  try { o = extractJsonFromAiText(raw); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const hit = eligible.find((e) => e.id === o.template);
  if (!hit) return null;
  const copy: Partial<Record<LineCopyKey, number>> = {};
  const src = o.copy && typeof o.copy === 'object' && !Array.isArray(o.copy) ? o.copy as Record<string, unknown> : {};
  for (const key of Object.keys(OUTREACH_COPY_BANK[hit.id]) as LineCopyKey[]) {
    const n = src[key];
    if (typeof n === 'number' && Number.isInteger(n) && usableLines(hit.id, key, tone, hasDeadline, fills).some((l) => l.i === n)) copy[key] = n;
  }
  return { id: hit.id, reasons: hit.reasons, by: 'ai', copy };
}

/** 추천 AI 호출기(AI 영업 = 계측 호출기 callOutreachAi 주입) */
export type OutreachPickAi = (params: { system: string; userMessage: string; maxTokens: number; temperature: number; source: string }) => Promise<string>;

/** 추천 대기 상한 — 넘으면 규칙으로 바로 제작을 잇는다(DM 단계 15분 감시보다 훨씬 짧게 · 공용 호출기는 취소 인자가 없어 늦은 응답은 버린다) */
export const OUTREACH_PICK_TIMEOUT_MS = 20_000;

/** 학습 베스트 읽기 대기 상한(DB 한 번 · 넘으면 힌트 없이) */
export const OUTREACH_BEST_TIMEOUT_MS = 3_000;

/** 시간 상한 경주 — 넘으면 throw(늦은 결과 · 늦은 실패는 버린다 · 공용 호출기 · 풀 조회는 취소 인자가 없다) */
async function raceTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  p.catch(() => { /* 시간 초과 뒤 늦은 실패 = 버림 */ });
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 시간 초과 ${ms}ms`)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 학습 베스트 읽기(주입) — AI 영업 = 승격 레시피 집계(best-copy-assets · 문구 결 단위) */
export type OutreachBestLoader = () => Promise<OutreachBest | null>;

/**
 * 추천 = 자격 거르기 → 학습 베스트 읽기(있으면 · 3초 상한) → AI 1회(고르기 · 학습 힌트 · 20초 상한) → 검증.
 * 자격 0 = null(표준 조립 · DB · AI 0) · AI 실패 · 시간 초과 · 해석 실패 = 규칙(학습 베스트 2건 이상이면 그것 · 아니면 자격 1순위 + 기본 문구).
 * 학습 베스트 읽기 실패 = 힌트 없이 지금 동작.
 */
export async function pickOutreachLineTemplate(ctx: OutreachPickContext, m: OutreachLineMaterials, signal: string, call: OutreachPickAi, timeoutMs: number = OUTREACH_PICK_TIMEOUT_MS, loadBest?: OutreachBestLoader): Promise<OutreachLineTemplateRecord | null> {
  const eligible = eligibleOutreachTemplates(m, signal);
  if (eligible.length === 0) return null;
  const tone = outreachToneOf(ctx.industry);
  const fills = outreachFillsOf(ctx.companyName, m);
  let best: OutreachBest | null = null;
  if (loadBest) {
    try {
      best = await raceTimeout(loadBest(), OUTREACH_BEST_TIMEOUT_MS, '학습 베스트');
    } catch (err: any) {
      console.log(`[sales-outreach] 템플릿 학습 베스트 읽기 불가 → 힌트 없이 company=${ctx.companyName} err=${err?.message}`);
    }
  }
  const rule = outreachRuleOf(eligible, best, tone, !!m.periodEnd, fills);
  try {
    const p = buildOutreachPickPrompt(ctx, m, eligible, best);
    const raw = await raceTimeout(call({ system: p.system, userMessage: p.user, maxTokens: 300, temperature: 0, source: 'sales-outreach-line-template-pick' }), timeoutMs, '추천');
    const picked = parseOutreachPick(raw, eligible, tone, !!m.periodEnd, fills);
    if (picked) return picked;
    console.log(`[sales-outreach] 템플릿 추천 응답 해석 실패 → ${rule.by} company=${ctx.companyName} raw=${String(raw || '').replace(/\s+/g, ' ').slice(0, 120)}`);
  } catch (err: any) {
    console.log(`[sales-outreach] 템플릿 추천 불가 → ${rule.by} company=${ctx.companyName} err=${err?.message}`);
  }
  return rule;
}

/** 저장된 기록 읽기(DM 산출물 jsonb) — 모양만 거른다 · 문구 번호는 조립 때 다시 본다 · 모르는 템플릿 = null(표준 조립) */
export function outreachLineTemplateRecordOf(v: unknown): OutreachLineTemplateRecord | null {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  if (!o || typeof o.id !== 'string' || !getLineTemplate(o.id as LineTemplateId)) return null;
  const src = o.copy && typeof o.copy === 'object' && !Array.isArray(o.copy) ? o.copy as Record<string, unknown> : {};
  const copy: Partial<Record<LineCopyKey, number>> = {};
  for (const [k, n] of Object.entries(src)) if (typeof n === 'number' && Number.isInteger(n) && n >= 0) copy[k as LineCopyKey] = n;
  return {
    id: o.id as LineTemplateId,
    reasons: Array.isArray(o.reasons) ? o.reasons.filter((r): r is string => typeof r === 'string') : [],
    by: o.by === 'ai' || o.by === 'best' ? o.by : 'rule',
    copy,
  };
}

/** (순수) 기록 → 문구 — 칸마다 고른 번호가 지금 쓸 수 있으면(결 · 마감 근거 · 채움 · 상한) 그 문구 · 아니면 0번(기본) · 묶음에 없는 칸 = 템플릿 기본 문구 */
export function outreachCopyOf(t: LineTemplate, rec: Pick<OutreachLineTemplateRecord, 'copy'>, tone: OutreachTone, hasDeadline: boolean, fills: OutreachFills): LineCopy {
  const bank = OUTREACH_COPY_BANK[t.id];
  const out = {} as LineCopy;
  for (const f of t.copy) {
    const list = bank[f.key];
    if (!list || list.length === 0) { out[f.key] = f.fallback; continue; }
    const n = rec.copy[f.key];
    const picked = typeof n === 'number' && outreachBankUsable(list[n], tone, hasDeadline) ? outreachBankText(list[n], fills, f.max) : null;
    out[f.key] = picked ?? list[0].text;
  }
  return out;
}

/** 주색 = 아웃리치 규칙(브랜드 색 보정본 · 없으면 무채색) — 혜택 · 마감 띠가 이 색을 쓴다 */
const withPrimary = (t: LineTemplate, primary: string): LineTemplate => ({ ...t, design: { ...t.design, primary } });

/** 섹션 id = 부분을 싣는다(학습 레시피 · 판정 카드 출처) */
export function outreachTemplateIds(heroKind: 'poster' | 'banner' | 'card' | null): NewId {
  let n = 0;
  return (part?: string) => {
    n += 1;
    if (part === 'cover') return `so-tpl-cover-${heroKind || 'none'}-${n}`;
    return `so-tpl-${String(part || 'x').replace(/[^a-z-]/g, '')}-${n}`;
  };
}

export type OutreachTemplateComposed =
  | { ok: true; sections: Section[]; preheader: string }
  | { ok: false; bad: string[] };

/**
 * (순수) 기록 + 재료 → DM(세로 한 페이지) · 이메일 섹션(문구 = 묶음에서 고른 것 · AI 0).
 * 자격 밖 기록(재료가 바뀌어 지금은 고를 수 없는 템플릿) · 품질 관문 · 갈 길 없는 행사 = ok:false(호출부 = 표준 조립 · 로그).
 */
export function composeOutreachTemplate(rec: OutreachLineTemplateRecord, input: OutreachLineInput, m0: OutreachLineMaterials, signal: string, channel: 'DM' | 'EMAIL', heroKind: 'poster' | 'banner' | 'card' | null): OutreachTemplateComposed {
  const base = getLineTemplate(rec.id);
  if (!base) return { ok: false, bad: [`모르는 템플릿 ${String(rec.id)}`] };
  const el = eligibleOutreachTemplates(m0, signal).find((e) => e.id === rec.id);
  if (!el) return { ok: false, bad: [`지금 재료로 고를 수 없는 템플릿 ${rec.id}`] };
  // 버튼 글과 목적지 = 같은 대상(그 템플릿이 말하는 행사 · 상품 · 쇼핑몰)
  const m: LineMaterials = { ...m0, link: el.link || m0.link };
  const t = withPrimary(base, input.primary);
  const copy = outreachCopyOf(t, rec, outreachToneOf(input.industry), !!m.periodEnd, outreachFillsOf(input.companyName, m));
  const ids = outreachTemplateIds(heroKind);
  const sections = channel === 'DM' ? composeLineDm(t, 'page', m, copy, ids).sections : composeLineEmail(t, m, copy, ids).sections;
  const bad = [...lineTemplateGate(sections), ...outreachLostEvents(m, sections)];
  return bad.length > 0 ? { ok: false, bad } : { ok: true, sections, preheader: copy.email_preheader };
}

/**
 * (순수) 갈 길 없는 행사 — 결과물 어디에도(그림 링크 · 상품 링크 · 버튼) 그 행사 주소가 없으면 사유 1줄.
 * 템플릿은 버튼이 하나라 그림 없는 앞선 행사는 이동 수단이 없다 → 표준 조립(행사마다 버튼)으로 돌린다(R1-3).
 */
export function outreachLostEvents(m: Pick<LineMaterials, 'events'>, sections: readonly Section[]): string[] {
  const links = new Set<string>();
  for (const s of sections) {
    const p = (s.props || {}) as Record<string, any>;
    if (s.type === 'gallery') for (const im of p.images || []) if (im?.link_url) links.add(String(im.link_url));
    if (s.type === 'product_carousel') for (const it of p.products || []) if (it?.link_url) links.add(String(it.link_url));
    if (s.type === 'cta') for (const b of p.buttons || []) if (b?.url) links.add(String(b.url));
  }
  const lost = (m.events || []).slice(0, 3).filter((e) => e.link_url && !links.has(e.link_url));
  return lost.length > 0 ? [`갈 길 없는 행사 ${lost.length}`] : [];
}

/** 레시피(학습 원장 · 원문 0)에 싣는 요약 — 템플릿 · 누가 골랐나 · 칸 번호 · 결 */
export function outreachLineTemplateRecipe(rec: OutreachLineTemplateRecord | null | undefined, industry: string | null): Record<string, unknown> | null {
  return rec ? { id: rec.id, by: rec.by, copy: rec.copy, tone: outreachToneOf(industry) } : null;
}
