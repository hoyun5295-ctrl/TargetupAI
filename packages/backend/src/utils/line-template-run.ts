/**
 * line-template-run.ts — 템플릿 캠페인 생성 한 벌(DM · 이메일 · 인앱 공용 · ★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §2)
 *
 * 라우트의 돈 순서(같은 시도 판정 → 금액 확정 → 몰 재조회 → 잔액 확인 → **생성** → 1회 차감)는 1017 그대로 두고,
 * 「생성」 자리만 이 함수로 바꾼다: 재료 확정(순수) → 문구 AI 1회(묶음 안 · 안쪽 차감 0) → 템플릿 조립 → 품질 관문.
 * ⛔ 구조 · 가격 · 사진 · 링크 · 혜택 원문은 AI 를 지나지 않는다. 혜택 · 마감일 = 사람이 확인한 답만(한 줄 값은 단계에 미리 채움 · 여기서 다시 뽑지 않는다).
 * ⛔ 대표 사진 = 올린 사진 → 이벤트 페이지 표지 사진 → 없음(상품 사진을 표지로 끌어오지 않는다 · 1017 대체 규칙을 쓰지 않는다).
 * ⛔ 품질 관문에 걸리면 던진다(호출부 = 차감 전 실패 · 500). 관문은 조립 함수의 계약이라 걸리면 코드 결함이다.
 */
import { randomUUID } from 'crypto';
import { formatLinePeriodEnd } from './one-line-steps';
import { getBrandBasicInfo } from './brand-basic-info';
import { sanitizeLineUrl } from './one-line-steps';
import type { LineMallCard } from './line-mall-cards';
import type { LinePageMaterial } from './line-template-page';
import type { LineTemplate, LineLayout, LineChannel, LineCopyKey } from './design-core/line-templates';
import { composeLineDm, composeLineEmail, composeLineInapp, lineTemplateGate, type LineMaterials, type LineCopy, type LineDmResult, type LineInAppMessage } from './line-template-compose';
import { fillLineTemplateCopy, type LineCopyGround } from './line-template-copy';
import { withoutBenefitSpans } from './copy-benefit-detector';
import { pickOutreachExemplarsDetail } from './sales-outreach-exemplars';
import { loadOutreachExemplarSource } from './sales-outreach-examples';
import type { Section } from './dm/dm-section-registry';
import type { LineStepsManualProduct } from './one-line-steps';

/**
 * 템플릿 생성 실패(문구 AI 응답 없음 · 품질 관문) — 라우트가 이 상태 · 코드 · 문장 그대로 돌려준다(차감 전 · 영어 코드 노출 0).
 *   AI = 503(잠시 뒤 다시) · 관문 = 500(조립 결함 · 로그에 사유).
 */
export class LineTemplateError extends Error {
  constructor(public status: number, public code: 'LINE_TEMPLATE_AI_FAILED' | 'LINE_TEMPLATE_GATE', message: string, public detail = '') { super(message); }
}

/**
 * (순수) 템플릿 직접 상품 — 사진이 있으면 카드(가격은 있으면 · 템플릿 카드는 가격 없이도 놓인다) · 사진이 없으면 글로 소개.
 *   1017 나누기(`splitLineManualProducts` = 사진 + 가격이어야 카드)는 그대로 두고 템플릿만 이 규칙을 쓴다.
 *   사진 주소는 요청 준비(`prepareLineStepsRequest`)가 이 회사 경로인지 이미 확인했다.
 */
export function lineTemplateManual(rows: readonly LineStepsManualProduct[]): { cards: LineMallCard[]; textProducts: Array<{ name: string; price?: number }> } {
  const cards: LineMallCard[] = [];
  const textProducts: Array<{ name: string; price?: number }> = [];
  for (const r of rows) {
    if (r.image) cards.push({ name: r.name, price: r.price ?? 0, image_url: r.image, ...(r.url ? { link_url: r.url } : {}) });
    else textProducts.push(r.price ? { name: r.name, price: r.price } : { name: r.name });
  }
  return { cards, textProducts };
}

export interface LineTemplateRunInput {
  template: LineTemplate;
  channel: LineChannel;
  companyId: string;
  /** 사용자가 친 한 줄(사진 조각 면허 적용 뒤 · 숫자 근거 글) */
  line: string;
  brandName: string;
  logoUrl: string | null;
  csPhone: string | null;
  /** 회사가 저장한 주색(흰 글자와 읽히게 보정한 값) — 있으면 템플릿 주색 대신 */
  pinnedPrimary: string | null;
  cards: readonly LineMallCard[];
  textProducts: ReadonlyArray<{ name: string; price?: number }>;
  heroUpload: string | null;
  /** ★ 2026-10-21 올린 대표 사진 = 스튜디오 헤드라인 포스터(글자 박힘 → 표지가 덮지 않고 원본 비율 + 아래 제목) */
  heroAsIs?: boolean;
  /** ★ 2026-10-21 고객 후기(단계 답 · 없으면 빈 배열) */
  proof?: ReadonlyArray<{ body: string; author: string; rating: number }>;
  page: LinePageMaterial | null;
  /** 혜택 단계 답(undefined = 묻지 않음 · null = 건너뜀) */
  benefitAnswer: string | null | undefined;
  periodEnd: string | null;
  link: string | null;
}

/** (순수) 재료 확정 + 문구 근거 — 회사 주색이 있으면 템플릿 주색을 바꾼 사본을 돌려준다 */
export function lineTemplateMaterials(input: LineTemplateRunInput): { t: LineTemplate; materials: LineMaterials; ground: LineCopyGround } {
  const t = input.pinnedPrimary ? { ...input.template, design: { ...input.template.design, primary: input.pinnedPrimary } } : input.template;
  const benefit = typeof input.benefitAnswer === 'string' ? input.benefitAnswer.trim() : '';
  const hero = input.heroUpload || input.page?.banner || null;
  const periodLabel = input.periodEnd ? `${formatLinePeriodEnd(input.periodEnd)}까지` : null;
  const materials: LineMaterials = {
    brandName: input.brandName,
    ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
    ...(input.csPhone ? { csPhone: input.csPhone } : {}),
    hero: hero ? { url: hero, ...(input.heroAsIs && hero === input.heroUpload ? { asIs: true } : {}) } : null,
    products: input.cards.map((c) => ({
      name: c.name, price: c.price > 0 ? c.price : null,
      ...(c.discount_price ? { discount_price: c.discount_price } : {}),
      image_url: c.image_url, ...(c.link_url ? { link_url: c.link_url } : {}),
    })),
    textProducts: input.textProducts.map((p) => ({ ...p })),
    benefit: benefit || null,
    periodEnd: input.periodEnd,
    periodLabel,
    link: input.link,
    ...(input.proof && input.proof.length > 0 ? { proof: input.proof.map((r) => ({ ...r })) } : {}),
  };
  const ground: LineCopyGround = {
    line: input.line, benefit: materials.benefit, periodLabel, brandName: input.brandName,
    productNames: [...input.cards.map((c) => c.name), ...input.textProducts.map((p) => p.name)],
    pageText: input.page?.licensedText ?? null,
  };
  return { t, materials, ground };
}

/** 회사 이름 · 로고 · 고객센터(헤더 · 푸터 재료) — 실패 = 빈 값(생성은 막지 않는다) */
export async function lineTemplateBrand(companyId: string, kitRaw: Record<string, unknown> | null): Promise<{ brandName: string; logoUrl: string | null; csPhone: string | null }> {
  let brandName = '';
  try {
    const b = await getBrandBasicInfo(companyId);
    brandName = String(b.brand_name || b.company_name || '').trim().slice(0, 30);
  } catch { brandName = ''; }
  const contact = kitRaw && typeof kitRaw.contact === 'object' && kitRaw.contact ? kitRaw.contact as Record<string, unknown> : {};
  const logo = kitRaw && typeof kitRaw.logo_url === 'string' ? kitRaw.logo_url.trim() : '';
  const phone = String(contact.cs_phone || contact.phone || '').trim().slice(0, 30);
  // 로고 = 이 서버 경로('/…' · '//' 로 시작하는 바깥 주소 제외) 또는 http(s) 주소만
  const logoOk = !!logo && ((logo.startsWith('/') && !logo.startsWith('//')) || !!sanitizeLineUrl(logo));
  return { brandName, logoUrl: logoOk ? logo : null, csPhone: phone || null };
}

export interface LineTemplateDraft {
  t: LineTemplate;
  materials: LineMaterials;
  copy: LineCopy;
  replaced: LineCopyKey[];
}

/**
 * 문구 AI 1회(호출부가 `runInCreditBundle` 안에서 부른다 · 실패 = 던짐 · 차감 전)
 * ★ 2026-10-18 `opts.factsOnly`(플래너 v2-1 · 설계서 docs/2026-10-18-planner-v2-design.md §3-4) — AI 근거에서 혜택 · 기간 · 페이지 글을 뺀다.
 *   AI 문구에는 숫자 · 혜택이 실릴 수 없고(근거에 없으면 검사가 기본 문구로 바꾼다), 혜택 원문 · 마감 · 행사명은 코드가 재료로 놓는다
 *   (B-1018-1 혜택 교차 조합이 생기지 않는다). 생략 = 지금 그대로(1017 고객 경로 · AI 영업).
 */
// ★ 2026-10-19 B-1018-1 — 고객 경로(한 줄 템플릿 DM · 이메일 · 인앱)도 factsOnly 로 부른다(교차 조합 「5% 할인」 이 생길 자리가 없다 · 값 = 코드).
//   subjectBenefit = 이메일 제목 앞에 사람이 확인한 혜택 원문을 코드가 붙인다(값이 빠진 제목으로 품질이 깎이지 않게 · 40자 안일 때만).
export async function draftLineTemplate(input: LineTemplateRunInput, ai: { userId?: string; source: string }, opts?: { factsOnly?: boolean; subjectBenefit?: boolean }): Promise<LineTemplateDraft> {
  const { t, materials, ground: g0 } = lineTemplateMaterials(input);
  // factsOnly = 한 줄 원문의 혜택 자리도 뺀다(F1b · 근거에 혜택이 하나도 없어야 교차 조합이 값 대조를 못 지난다)
  const ground: LineCopyGround = opts?.factsOnly ? { ...g0, line: withoutBenefitSpans(g0.line), benefit: null, periodLabel: null, pageText: null } : g0;
  let filled: Awaited<ReturnType<typeof fillLineTemplateCopy>>;
  try {
    filled = await fillLineTemplateCopy(t, ground, { companyId: input.companyId, userId: ai.userId, source: ai.source, exemplars: await lineCopyExemplars(input.companyId, input.channel) });
  } catch (err: any) {
    throw new LineTemplateError(503, 'LINE_TEMPLATE_AI_FAILED', '문구를 만들지 못했어요. 크레딧은 쓰지 않았어요. 잠시 뒤 다시 만들어 주세요.', String(err?.message || ''));
  }
  const copy = { ...filled.copy };
  const benefit = String(materials.benefit || '').trim();
  if (opts?.subjectBenefit && benefit) {
    const withBenefit = `[${benefit}] ${copy.email_subject}`.trim();
    if (withBenefit.length <= LINE_SUBJECT_MAX) copy.email_subject = withBenefit;
  }
  return { t, materials, copy, replaced: filled.replaced };
}

/**
 * ★ 2026-10-21 문구 AI 참고 예시 = 같은 업종 직원 실물(DB 실물 + seed · 가린 글) · 리듬 · 길이만(설계서 §3-5) · 실패 = 없음(생성은 막지 않는다).
 *   인앱 = 이메일 예시(짧은 제목 · 본문 결이 가깝다).
 */
async function lineCopyExemplars(companyId: string, channel: LineChannel): Promise<string | null> {
  try {
    const basic = await getBrandBasicInfo(companyId).catch(() => null);
    const source = await loadOutreachExemplarSource();
    const r = pickOutreachExemplarsDetail(channel === 'dm' ? 'DM' : 'EMAIL', String(basic?.industry_code || '') || null, { source, max: 3, budget: 2400 });
    return r.text || null;
  } catch { return null; }
}

/** 이메일 제목 상한(템플릿 칸 상한과 같다) */
const LINE_SUBJECT_MAX = 40;

/** DM 조립 + 품질 관문(걸리면 던짐) */
export function buildLineTemplateDm(d: LineTemplateDraft, layout: LineLayout): LineDmResult {
  const r = composeLineDm(d.t, layout, d.materials, d.copy, () => randomUUID());
  const bad = lineTemplateGate(r.sections);
  if (bad.length > 0) throw new LineTemplateError(500, 'LINE_TEMPLATE_GATE', '완성본을 조립하지 못했어요. 크레딧은 쓰지 않았어요.', `${d.t.id}: ${bad.join(' · ')}`);
  return r;
}

/** 이메일 조립 + 품질 관문 */
export function buildLineTemplateEmail(d: LineTemplateDraft): { sections: Section[]; subject: string; preheader: string } {
  const r = composeLineEmail(d.t, d.materials, d.copy, () => randomUUID());
  const bad = lineTemplateGate(r.sections);
  if (bad.length > 0) throw new LineTemplateError(500, 'LINE_TEMPLATE_GATE', '완성본을 조립하지 못했어요. 크레딧은 쓰지 않았어요.', `${d.t.id}: ${bad.join(' · ')}`);
  return r;
}

/** 인앱 조립(메시지 한 장) */
export function buildLineTemplateInapp(d: LineTemplateDraft): LineInAppMessage {
  return composeLineInapp(d.t, d.materials, d.copy);
}

/** 템플릿 DM 표식(편집 화면이 카탈로그 보기 · 장 추가를 숨기고 배치 전환을 장 키로 다시 묶는다) */
export const lineTemplateDmMarker = (id: string): string => `line:${id}`;
