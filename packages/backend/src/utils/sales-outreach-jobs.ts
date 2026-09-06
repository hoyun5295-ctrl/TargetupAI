/**
 * ★ 2026-08-24 AI 영업 아웃리치 v2 — 잡 상태머신 CT
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15 (테이블 §15-7 · 착수 전 실측 = information_schema 0건 확인 완료 2026-08-24)
 * ★ 2026-09-05 개정 = docs/2026-09-05-ai-sales-outreach-refinement-design.md (재료 유입 A-1 · 1홉 A-11 · 계측 A-13 · 잠금 B-1 · 재생성 B-3 ·
 *   실패 사유 B-4(fail_detail 컬럼 · 배포 전 ALTER) · 되돌리기 단일 함수 B-7 · 중복 B-6 · 제목 편집 B-9 · 발송 보강 B-11 · 검수 테스트 B-15)
 *
 * 규율(LESSONS_BACKEND 핵심 원칙):
 * - 게이트는 효과를 만드는 함수 안(0819) — 라우트 검사와 별개로 이 파일의 효과 함수가 스스로 판정한다. fail-closed.
 * - 소유권 = lock_token(uuid) CAS. 타임스탬프를 fencing 토큰으로 쓰지 않는다(마이크로초/밀리초 왕복 불일치).
 *   lock_at은 좀비 판정용 heartbeat 전용.
 * - 단계 결과는 3값 ok|no_event|unavailable — 의존 장애(unavailable)를 내용 판정(no_event)으로 접지 않는다. 제작 4단계도 같다(불변 10 개정).
 * - 스탬프는 성공 분기 안에서만 찍는다. 실패는 그 단계에서 정직하게 멈춘다(자동 완화 0). 실패 종결은 markFailed 한 함수만(sweeper 포함).
 * - 행사(이벤트)는 AI가 서술하지 않는다 — 인용 구조체로만 받고 서버가 크롤 원문과 문자열 재대조(원문별 · 출처 URL 기록).
 *   부정·종료·조건 표현이 섞인 인용은 이벤트째 폐기. 종료일이 실재하고 미래일 때만 혜택 수치 면허.
 * - 실패 사유는 DB에 남긴다(불변 21) — catch가 console에만 두고 고정 문구를 넣는 형태 금지.
 * - jsonb 파라미터는 반드시 JSON.stringify(드라이버가 배열을 PG 배열 리터럴로 직렬화하는 사고 방지).
 * - 되돌리기(retry·recrawl·regenerate·rebuild)는 resetJobTo 하나가 CAS·키 초기화·락 규율을 소유한다.
 */
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { fetchHtmlGuarded } from './dm/dm-brand-extractor';
import { buildOutreachEventMaterial } from './sales-outreach-extract';
import { stripUnauthorizedBenefits, BENEFIT_PLACEHOLDER } from './copy-benefit-detector';
import { getActiveStyleGuide, type OutreachStyleGuide } from './sales-outreach-style';
import { isSalesOutreachOperator } from './audit-log';
import { isIndustryCode, industryLabel } from './industry-codes';
import {
  getOutreachContext, produceOutreachImage, produceOutreachDm, produceOutreachBrandEmail, collectOutreachMedia, fetchImageGuarded,
  generateSubjectIntro, assembleProposalEmail, countBenefitPlaceholders, captureAndScoreDm,
  PUBLIC_BASE, OUTREACH_PREVIEW_DAYS, type OutreachMedia,
} from './sales-outreach-produce';
// ★ 2026-09-05(3) 브레인스토밍 수렴안 C4 — 재료 재선택·섹션 숨김 override·품질 경고(순수 CT · 잠금 0)
import {
  validateOutreachMediaSelection, applyOutreachMediaSelection, validateSectionOverride, applySectionOverrides, assessOutreachQuality,
  assessMaterialSufficiency, factQuoteOf,
  classifyViewerUa, mergePreviewView, summarizeOutreachViews, OUTREACH_UNREAD_DAYS, type PreviewViews, type DmViewAgg, type OutreachViewSummary,
  type OutreachMediaSelection, type SectionOverride, type MaterialGate,
} from './sales-outreach-review';
import {
  sendOutreachProposalMail, sendOutreachTestMail as mailerSendTest, isOutreachMailerReady, outreachMailTo,
  outreachTestMailDomains, isAllowedTestRecipient,
} from './outreach-mailer';
import {
  extractProducts, extractImageCandidates, discoverProductLinks, buildCtaLinkMap, extractLegal, resolveBrandColorGuarded, extractLogoCandidates,
  OUTREACH_FETCH_OPTS, type OutreachProduct,
} from './sales-outreach-media';
import { stopDm } from './dm/dm-builder';
// ★ 2026-09-06 S1 렌더 승격 — 워커 클라이언트(127.0.0.1) + 순수 계측·합집합·재료 v2
import {
  renderPageGuarded, countMaterials, shouldEscalateToRender, unionStrings, unionProducts, unionImageDetails, mergeCtaLinks, buildMaterialsV2, bannersOf,
  type RenderResult, type MaterialSource,
} from './sales-outreach-render';
import { isSameSite } from './sales-outreach-render-guard';
// ★ 2026-09-06 S4 파기 공용(sweeper 와 같은 본문)
import { purgeOutreachJobArtifacts } from './sales-outreach-purge';

// ===== 타입 =====

export type OutreachStage =
  | 'queued' | 'crawling' | 'analyzing' | 'awaiting_confirm'
  | 'producing_copy' | 'producing_image' | 'producing_dm' | 'producing_email'
  | 'ready' | 'sent' | 'failed';

export type StageOutcome = 'ok' | 'no_event' | 'unavailable';

export type RegenKind = 'copy' | 'image' | 'dm' | 'email';
export const REGEN_KINDS: readonly RegenKind[] = ['copy', 'image', 'dm', 'email'];
/** 잡당 kind별 재생성 상한(요청 기준 · §14 #10) */
export const REGEN_MAX_PER_KIND = 5;

export interface EventCandidate {
  /** 크롤 원문에 실재함을 서버가 확인한 인용문(재대조 통과분만 저장) */
  quote: string;
  sourceUrl: string;
  startDate: string | null;
  endDate: string | null;
  /** 종료일이 실재(YYYY-MM-DD)하고 미래일 때만 true — 혜택 수치 인용 면허 */
  benefitLicensed: boolean;
  /** 'crawl' = 자동 추출·재대조 통과 / 'manual' = Harold 직접 붙여넣기 */
  origin: 'crawl' | 'manual';
}

export interface OutreachSelection {
  /** event_quote.candidates 배열 인덱스. null = 행사 없음(일반형) */
  eventIndex: number | null;
  /** 봇 차단 등 크롤 실패 시 직접 붙여넣는 행사 원문(있으면 eventIndex 무시) */
  manualEventText?: string;
  /** 선택 이미지 URL. null = 이미지 없이 진행 */
  imageUrl: string | null;
  /** 크롤 판정과 다르면 바꿔 넣는 업종 코드 */
  industryCategory?: string;
}

/** 라우트가 안전 문구로 변환할 수 있는 분류 오류 — err.message 원문을 사용자에게 내리지 않기 위한 축. details = 응답에 함께 실을 구조 값(B-6 existingJobId 등). */
export class OutreachError extends Error {
  constructor(
    public code: 'FORBIDDEN' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'NOT_READY',
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** 테이블 미생성(마이그레이션 전) 판정 — 라우트 catch에서 503 DB_MIGRATION_PENDING 분기용 */
export function isOutreachMigrationPending(err: any): boolean {
  const msg = String(err?.message || '');
  return err?.code === '42P01'
    || (/does not exist/i.test(msg) && /(relation|column|table)/i.test(msg));
}

export type SendLockReason = 'SENDER_NOT_CONFIGURED' | 'UNSUB_NOTICE_MISSING' | 'NO_EMAIL' | 'PLACEHOLDER_REMAINS' | 'UNSUB_NOT_APPLIED'
  /** ★ 2026-09-06 S2 — 재료 게이트 thin(상품·배너·행사 중 둘 이상 미달) · 사람이 해제(material_override)하면 풀린다 */
  | 'MATERIAL_THIN';

export interface SendLock { locked: boolean; reasons: SendLockReason[] }

/** 발송 잠금 판정에 넘기는 재료 게이트 요약(stage_results.material + material_override) · null·undefined = 옛 잡(재료 축 없음) */
export interface SendLockMaterial { verdict?: string | null; overridden?: boolean }

/** 발송 잠금 6종(순수 · 불변 3 개정 · ★S2 6번째 = MATERIAL_THIN) — 발송 함수(효과)와 조회 응답(표시)이 같은 함수를 부른다. stage·in-flight·CAS는 효과 함수의 DB 축. */
export function computeSendLock(
  env: { mailerReady: boolean; unsub: string },
  emailAsset: { html?: string; subject?: string; placeholderCount?: number } | null,
  material?: SendLockMaterial | null,
): SendLock {
  const reasons: SendLockReason[] = [];
  if (!env.mailerReady) reasons.push('SENDER_NOT_CONFIGURED');
  if (material && material.verdict === 'thin' && !material.overridden) reasons.push('MATERIAL_THIN');
  if (!String(env.unsub || '').trim()) reasons.push('UNSUB_NOTICE_MISSING');
  if (!emailAsset || !emailAsset.html || !emailAsset.subject) {
    reasons.push('NO_EMAIL');
    return { locked: true, reasons };
  }
  const placeholders = typeof emailAsset.placeholderCount === 'number'
    ? emailAsset.placeholderCount
    : countBenefitPlaceholders(String(emailAsset.html) + '\n' + String(emailAsset.subject)); // 구 asset 폴백(필드 없음)
  if (placeholders > 0) reasons.push('PLACEHOLDER_REMAINS');
  const unsub = String(env.unsub || '').trim();
  if (unsub && !String(emailAsset.html).includes(unsub)) reasons.push('UNSUB_NOT_APPLIED');
  return { locked: reasons.length > 0, reasons };
}

function sendLockEnv(): { mailerReady: boolean; unsub: string } {
  return { mailerReady: isOutreachMailerReady(), unsub: (process.env.OUTREACH_UNSUB_NOTICE || '').trim() };
}

/** stage_results → 발송 잠금 재료 요약(순수). material 키가 없는 옛 잡은 null(재료 축 없음). */
export function sendLockMaterialOf(sr: Record<string, any> | null | undefined): SendLockMaterial | null {
  const m = sr?.material;
  if (!m || typeof m !== 'object') return null;
  return { verdict: typeof m.verdict === 'string' ? m.verdict : null, overridden: !!sr?.material_override };
}

// ===== 게이트 (효과를 만드는 모든 함수의 첫 줄) =====

async function assertOperator(operatorSuperAdminId: string | null | undefined): Promise<void> {
  if (!(await isSalesOutreachOperator(operatorSuperAdminId))) {
    throw new OutreachError('FORBIDDEN', '이 기능을 사용할 권한이 없습니다.');
  }
}

// ===== 순수 헬퍼 (export = 행동 테스트 대상) =====

/** 부정·종료·조건 표현 — 인용에 섞이면 이벤트째 폐기(애매하면 폐기 쪽) */
const DISQUALIFYING_MARKERS = [
  '종료', '마감되었', '마감됐', '지난 이벤트', '지난이벤트', '완료된', '당첨자 발표',
  '품절', 'sold out', '이벤트가 끝', '아쉽게도', '제외', '한정 인원 마감', '예정입니다',
];

export function normalizeQuoteText(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
const norm = normalizeQuoteText;

export function hasDisqualifyingMarker(text: string): boolean {
  const low = String(text || '').toLowerCase();
  return DISQUALIFYING_MARKERS.some((k) => low.includes(k.toLowerCase()));
}

export function isFutureDate(yyyymmdd: string | null | undefined, now: Date = new Date()): boolean {
  if (!yyyymmdd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return false;
  const d = new Date(yyyymmdd + 'T23:59:59+09:00');
  return !Number.isNaN(d.getTime()) && d.getTime() >= now.getTime();
}

/** 연·월·일이 전부 있는 날짜 표기만(YYYY-MM-DD · YYYY.MM.DD · YYYY/MM/DD · YYYY년 M월 D일 · 뒤에 시각이 붙어도 무시). 연도 없는 표기는 잡지 않는다(작년 행사 부활 차단). */
const FULL_DATE_RE = /(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})(?!\d)/g;

function isoDateOf(y: string, m: string, d: string): string | null {
  const yy = Number(y), mm = Number(m), dd = Number(d);
  if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31)) return null;
  const iso = `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const t = new Date(iso + 'T00:00:00+09:00');
  return Number.isNaN(t.getTime()) ? null : iso;
}

/**
 * ★ 2026-09-06 S2 기간 파서(순수 · 회의 수렴안 D3) — 원문 문자열에서 종료일을 읽는다.
 *  두 날짜 이상 = 앞이 시작 · 뒤가 종료("2026.08.31 ~ 2026-09-18 08:59:59" 좌우 형식 혼합 허용) · 날짜 하나 = 바로 뒤에 '부터'면 시작만, 그 밖은 종료(까지·마감·~ 문맥 또는 단독).
 *  연도가 원문에 없으면 null(올해로 보정하면 작년 행사가 미래로 부활한다).
 */
export function parseLicensedEndDate(raw: string | null | undefined): { start: string | null; end: string | null } {
  const text = String(raw || '');
  const found: Array<{ iso: string; idx: number; end: number }> = [];
  for (const m of text.matchAll(FULL_DATE_RE)) {
    const iso = isoDateOf(m[1], m[2], m[3]);
    if (iso) found.push({ iso, idx: m.index || 0, end: (m.index || 0) + m[0].length });
  }
  if (found.length === 0) return { start: null, end: null };
  if (found.length === 1) {
    const only = found[0];
    const after = text.slice(only.end, only.end + 6);
    if (/^\s*(일\s*)?부터/.test(after)) return { start: only.iso, end: null };
    return { start: null, end: only.iso };
  }
  const sorted = [...found].sort((a, b) => a.iso.localeCompare(b.iso));
  return { start: sorted[0].iso, end: sorted[sorted.length - 1].iso };
}

/** 인용문 주변(앞 200자·뒤 400자)에서 기간 표기를 찾는다 — 행사 제목과 "기간 :" 줄이 떨어져 있는 몰 형태 대응. 인용 자체에 없을 때만 부른다. */
export function findPeriodNear(text: string, quote: string): { start: string | null; end: string | null } {
  const t = String(text || '');
  const q = String(quote || '');
  if (!t || !q) return { start: null, end: null };
  const idx = t.indexOf(q);
  if (idx < 0) return { start: null, end: null };
  // 인용 바로 뒤 400자에서 "A ~ B" 범위를 먼저 찾고(가장 가까운 것), 없으면 첫 단일 날짜(종료) · 그것도 없으면 인용 앞 200자 폴백
  const after = t.slice(idx + q.length, Math.min(t.length, idx + q.length + 400));
  const range = after.match(/(20\d{2}\s*[.\-\/년]\s*\d{1,2}\s*[.\-\/월]\s*\d{1,2})(?:\s*일)?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?\s*[~\-–]\s*(20\d{2}\s*[.\-\/년]\s*\d{1,2}\s*[.\-\/월]\s*\d{1,2})/);
  if (range) {
    const a = parseLicensedEndDate(range[1]);
    const b = parseLicensedEndDate(range[2]);
    const sd = a.end || a.start;
    const ed = b.end || b.start;
    if (sd && ed) return { start: sd <= ed ? sd : ed, end: sd <= ed ? ed : sd };
  }
  const single = parseLicensedEndDate(after);
  if (single.end || single.start) return single.end ? { start: null, end: single.end } : single;
  return parseLicensedEndDate(t.slice(Math.max(0, idx - 200), idx));
}

/** AI가 준 날짜 문자열 정규화(YYYY-MM-DD 만 통과 · 그 밖 형식은 파서로 한 번 더) */
function normalizeAiDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  const p = parseLicensedEndDate(v);
  return p.end || p.start;
}

/** 프롬프트 재료 앞자르기의 유일한 소유자(A-1) — 전량 우선 · 발췌 폴백 · 예산 절단 */
export function materialText(eventTextFull: string | null | undefined, excerpt: string | null | undefined, budget: number): string {
  const src = String(eventTextFull || '').trim() || String(excerpt || '').trim();
  return src.slice(0, Math.max(0, budget));
}

/** 프롬프트 재료에서 면허 밖 혜택 자리를 지운다(모델이 애초에 보지 않게 · placeholder 발생률 원천 감소) */
export function stripMaterialForPrompt(material: string, licensedQuote: string): string {
  if (!material) return '';
  return stripUnauthorizedBenefits(material, licensedQuote || '').split(BENEFIT_PLACEHOLDER).join('').replace(/[ \t]{2,}/g, ' ').trim();
}

export interface CopyPromptInput {
  companyName: string;
  industry: string | null;
  selected: EventCandidate | null;
  promptMaterial: string;
  extraNotes?: string | null;
}

/** 문안(LMS) 프롬프트(순수 · A-7) */
export function buildCopyPrompt(guide: OutreachStyleGuide, input: CopyPromptInput): { system: string; user: string } {
  const system = [
    '너는 SMS/LMS 마케팅 문안 작성기다. 아래 규칙을 지켜 문안 1건만 출력한다(설명·머리말 없이 본문만).',
    `구성: ${guide.copy.structure.join(' → ')}`,
    `톤: ${guide.copy.tone}`,
    `길이: ${guide.copy.maxLength}자 이내.`,
    '모바일 DM 링크 자리는 {{DM_LINK}} 토큰 그대로 둔다(마지막 줄).',
    '혜택 수치(퍼센트·금액·쿠폰)는 [홈페이지에서 읽은 내용]에 글자 그대로 있는 것만 쓴다. 없으면 수치 없이 쓴다.',
    '상품명·행사명은 [홈페이지에서 읽은 내용]에 있는 것만 쓴다. 지어내지 마라. 이모지 0 · 줄표 0.',
    ...guide.prohibitions.map((p) => `금지: ${p}`),
  ].join('\n');
  const user = [
    `브랜드: ${input.companyName} (업종: ${industryLabel(input.industry)})`,
    input.selected
      ? `진행 중 행사(원문 인용 · 이 안의 사실만 쓴다):\n"${input.selected.quote}"`
      : '확인된 행사 없음: 행사 언급 없이 브랜드 일반형으로 쓴다.',
    input.promptMaterial ? `[홈페이지에서 읽은 내용]\n${input.promptMaterial}` : '',
    input.extraNotes ? `[담당자 추가 정보]\n${String(input.extraNotes).slice(0, 2000)}` : '',
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/** 등록 중복 키(B-6) — 호스트(소문자 · www. 제거) + 첫 경로 세그먼트 */
/** 여러 입점몰이 한 호스트를 나누는 플랫폼 — 여기서만 첫 경로 세그먼트가 상점 이름이다 */
const SHARED_SHOP_HOSTS = new Set(['smartstore.naver.com', 'm.smartstore.naver.com', 'brand.naver.com', 'm.brand.naver.com', 'shopping.naver.com', 'blog.naver.com', 'm.blog.naver.com', 'cafe.naver.com', 'instagram.com', 'facebook.com', 'youtube.com', 'litt.ly', 'linktr.ee', 'notion.site']);

/**
 * 중복 판정 키 — ★ 2026-09-06 S4 호스트만(www 제거). 옛 키(호스트 + 첫 세그먼트)는 `/kr/ko` 같은 언어 경로가 다르면 같은 업체를 새 건으로 받았다.
 * 공유 호스트(스마트스토어 등)만 첫 세그먼트를 유지한다(그곳에서는 세그먼트가 상점이다).
 */
export function normalizeHomepageKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (!SHARED_SHOP_HOSTS.has(host)) return host;
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    return seg ? `${host}/${seg.toLowerCase()}` : host;
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

/** 키의 호스트 부분(SQL 사전 필터용 · 키가 URL 이 아니면 그대로) */
function hostOfKey(key: string): string { return key.split('/')[0]; }

/** 홈 HTML에서 행사 상세 링크 1개(같은 호스트 · href 또는 텍스트가 행사성 · 홈과 다른 URL) — A-11 */
const EVENT_LINK_RE = /event|promotion|sale|이벤트|기획전|행사|프로모션/i;
export function findEventPageLink(html: string, homeUrl: string): string | null {
  let host = '';
  let homeKey = '';
  try { const h = new URL(homeUrl); host = h.hostname; homeKey = h.origin + h.pathname.replace(/\/+$/, ''); } catch { return null; }
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].replace(/&amp;/g, '&').trim();
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!EVENT_LINK_RE.test(href) && !EVENT_LINK_RE.test(text)) continue;
    if (/^(javascript:|mailto:|tel:)/i.test(href)) continue;
    let abs: URL;
    try { abs = new URL(href, homeUrl); } catch { continue; }
    if (!/^https?:$/.test(abs.protocol) || abs.hostname !== host) continue;
    if (abs.origin + abs.pathname.replace(/\/+$/, '') === homeKey) continue;
    if (/\/(login|join|cart|mypage|member)/i.test(abs.pathname)) continue;
    return abs.toString();
  }
  return null;
}

export interface QuoteFilterMeta {
  rawCandidates: number;
  matched: number;
  shortDropped: number;
  mismatched: number;
  markerDropped: number;
}

/** AI 인용 후보 → 재대조(원문별 · 출처 URL) + 계측(A-13). 합본이 아니라 원문 각각과 대조한다. */
export function filterQuoteCandidates(
  parsed: unknown,
  texts: { home: string; sub?: string | null },
  urls: { home: string; sub?: string | null },
  now: Date = new Date(),
): { candidates: EventCandidate[]; meta: QuoteFilterMeta } {
  const meta: QuoteFilterMeta = { rawCandidates: 0, matched: 0, shortDropped: 0, mismatched: 0, markerDropped: 0 };
  const candidates: EventCandidate[] = [];
  if (!Array.isArray(parsed)) return { candidates, meta };
  const normHome = norm(texts.home);
  const normSub = texts.sub ? norm(texts.sub) : '';
  for (const c of parsed.slice(0, 3)) {
    meta.rawCandidates++;
    const quote = norm(String((c as any)?.quote || ''));
    if (!quote || quote.length < 8) { meta.shortDropped++; continue; }
    const sourceUrl = normHome.includes(quote) ? urls.home : (normSub && normSub.includes(quote) && urls.sub) ? urls.sub : null;
    if (!sourceUrl) { meta.mismatched++; continue; } // 원문 재대조 실패 = 폐기(환각 차단)
    if (hasDisqualifyingMarker(quote)) { meta.markerDropped++; continue; }
    meta.matched++;
    // ★ 2026-09-06 S2 종료일 = AI 값 → 인용문 안 기간 표기 → 인용문 주변 "기간 :" 줄 순(전부 연·월·일 명시분만 · 면허 판정은 isFutureDate 하나)
    const src = sourceUrl === urls.home ? normHome : normSub;
    const inQuote = parseLicensedEndDate(quote);
    const near = inQuote.end ? { start: null, end: null } : findPeriodNear(src, quote);
    const startDate = normalizeAiDate((c as any)?.start_date) || inQuote.start || near.start;
    const endDate = normalizeAiDate((c as any)?.end_date) || inQuote.end || near.end;
    candidates.push({ quote, sourceUrl, startDate, endDate, benefitLicensed: isFutureDate(endDate, now), origin: 'crawl' });
  }
  return { candidates, meta };
}

/** 오류 원문 정제본(DB 저장용 · 300자) */
export function detailOf(err: any): string {
  return String(err?.message || err || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** 검수 테스트 발송 이력 갱신(순수) — 최대 20건 · 최신이 뒤 */
export function appendTestSend(list: unknown, entry: { to: string; outcome: string; at: string; by: string | null }, cap = 20): Array<Record<string, unknown>> {
  const cur = Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>> : [];
  return [...cur, entry].slice(-cap);
}

// ===== 등록 =====

export interface EnqueueInput {
  companyName: string;
  industryCategory?: string | null;
  homepageUrl: string;
  /** ★ B-15 담당자 추가 정보(≤2000자 · 사람이 쓴 사실 = 인용 면허 없음) */
  extraNotes?: string | null;
  /** ★ B-6 중복이어도 새로 만든다 */
  force?: boolean;
}

function normalizeHomepageUrl(raw: string): string {
  let homepageUrl = String(raw || '').trim();
  if (!homepageUrl) throw new OutreachError('VALIDATION', '홈페이지 주소를 입력해주세요.');
  if (!/^https?:\/\//i.test(homepageUrl)) homepageUrl = 'https://' + homepageUrl;
  try {
    void new URL(homepageUrl);
  } catch {
    throw new OutreachError('VALIDATION', '홈페이지 주소 형식이 올바르지 않습니다.');
  }
  return homepageUrl;
}

function normalizeExtraNotes(raw: unknown): string | null {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (v.length > 2000) throw new OutreachError('VALIDATION', '추가 정보는 2000자 이내로 입력해주세요.');
  return v;
}

/** 같은 키의 미파기 잡(최신 1건) — 중복 등록 판정(B-6). ★ S4 LIMIT 300 제거(301번째부터 중복을 못 보던 자리) · 호스트 ILIKE 사전 필터 뒤 키 대조 */
async function findDuplicateJob(homepageUrl: string): Promise<{ id: string; stage: string } | null> {
  const key = normalizeHomepageKey(homepageUrl);
  const r = await query(
    `SELECT id, stage, homepage_url FROM sales_outreach_jobs
      WHERE purged_at IS NULL AND homepage_url ILIKE $1
      ORDER BY created_at DESC`,
    [`%${hostOfKey(key)}%`],
  );
  const hit = r.rows.find((row: any) => normalizeHomepageKey(String(row.homepage_url || '')) === key);
  return hit ? { id: String(hit.id), stage: String(hit.stage) } : null;
}

export async function enqueueOutreachJob(
  input: EnqueueInput,
  operatorSuperAdminId: string | null | undefined,
): Promise<{ id: string }> {
  await assertOperator(operatorSuperAdminId);
  if (!getOutreachContext()) {
    // §15-6 — 내부 전용 회사·사용자 ENV 미설정 = 기능 전체를 정직하게 거절(자동 폴백 금지)
    throw new OutreachError('NOT_READY', '준비가 되지 않았습니다: OUTREACH_COMPANY_ID·OUTREACH_USER_ID 설정이 필요합니다.');
  }

  const companyName = String(input.companyName || '').trim();
  if (!companyName || companyName.length > 100) {
    throw new OutreachError('VALIDATION', '업체명을 확인해주세요(1~100자).');
  }
  const homepageUrl = normalizeHomepageUrl(input.homepageUrl);
  const extraNotes = normalizeExtraNotes(input.extraNotes);
  const industry = input.industryCategory && isIndustryCode(input.industryCategory)
    ? input.industryCategory : null;

  if (!input.force) {
    const dup = await findDuplicateJob(homepageUrl);
    if (dup) {
      throw new OutreachError('CONFLICT', '이미 등록된 업체입니다.', { reason: 'DUPLICATE', existingJobId: dup.id, existingStage: dup.stage });
    }
  }

  const result = await query(
    `INSERT INTO sales_outreach_jobs (company_name, industry_category, homepage_url, stage, created_by, brand_profile)
     VALUES ($1, $2, $3, 'queued', $4, $5::jsonb)
     RETURNING id`,
    [companyName, industry, homepageUrl, operatorSuperAdminId, JSON.stringify(extraNotes ? { extraNotes } : {})],
  );
  const id = result.rows[0].id as string;

  // best-effort 실행 — 실패해도 등록 응답에는 영향 없음(sweeper·재시도가 회수 축)
  runOutreachJob(id).catch((err: any) => {
    console.error('[sales-outreach] 파이프라인 실행 실패:', id, err?.message);
    markFailed(id, 'crawling', '분석 시작에 실패했습니다. 다시 시도해주세요.', { detail: detailOf(err) }).catch(() => {});
  });

  return { id };
}

// ===== 수집 → 분석 → 확정 대기 =====

/** 큐 선점 → 크롤(홈 + 행사 상세 1홉) → 재료 추출 → AI 인용 → 서버 재대조 → awaiting_confirm 정지. 전이는 전부 lock_token CAS. */
export async function runOutreachJob(jobId: string): Promise<void> {
  const lockToken = randomUUID();
  const claimed = await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'crawling', lock_token = $2, lock_at = NOW()
      WHERE id = $1 AND stage = 'queued'
      RETURNING company_name, homepage_url, industry_category, brand_profile`,
    [jobId, lockToken],
  );
  if (claimed.rows.length === 0) return; // 다른 실행이 선점 — 아무것도 바꾸지 않는다
  const job = claimed.rows[0];
  const keepNotes: string | null = job.brand_profile?.extraNotes ? String(job.brand_profile.extraNotes) : null;

  // --- 크롤 (가드 경로만 — extractBrandFromUrl 사용 금지) ---
  // ★ 2026-08-26 소스 1개로 되돌림 — HTML을 한 번만 받아 행사 텍스트와 이미지 후보를 함께 뽑는다(같은 URL 두 번 금지).
  // ★ 2026-09-05 A-11 — 같은 호스트의 행사 상세 링크 1개는 별 소스로 허용(실패 격리 · 3값 별도 기록 · 호스트 이탈 시 폐기).
  let page: { html: string; baseUrl: string; finalUrl: string } | null = null;
  let crawlDetail: string | null = null;
  try {
    // ★ 0905 본문 상한 800KB(공용 기본 200KB는 og 메타용 · 상품·갤러리가 잘린다)
    page = await fetchHtmlGuarded(job.homepage_url, OUTREACH_FETCH_OPTS);
    if (!page) crawlDetail = '응답 없음(접속 차단·시간 초과·리다이렉트 거부 중 하나)';
  } catch (err: any) {
    console.error('[sales-outreach] 크롤 예외:', jobId, err?.message);
    crawlDetail = detailOf(err);
  }
  // ★ 2026-09-06 S1 렌더 승격 — 정적 재료가 얇으면(상품 4 미만 · 이미지 후보 2 미만 · 본문 1,500자 미만 · 혜택가 쌍 0 중 하나) 렌더 워커에 1회 요청한다.
  //   워커 부재(ECONNREFUSED)·점유(409)·차단·시간 초과는 즉시 정적으로 전진(대기 0 · 사유는 rendering 3값 별 키). 렌더 대기 구간은 5초 heartbeat 로 lock_at 갱신(sweeper 좀비 15분 대비).
  //   SPA 몰(아이소이 정적 = 텍스트 385자 · 상품 0)은 반드시 승격되고, 서버 렌더 대형몰은 정적으로 끝난다(큐 점유 0).
  const staticUrl = page?.finalUrl || job.homepage_url;
  const staticCounts = page ? countMaterials(page.html, staticUrl) : null;
  const escalation = shouldEscalateToRender(staticCounts);
  let rendered: RenderResult | null = null;
  let renderingOutcome: 'ok' | 'no_content' | 'unavailable' | null = null;
  let renderingDetail: string | null = null;
  let renderMeta: Record<string, unknown> | null = null;
  if (escalation.escalate) {
    const hb = startLockHeartbeat(jobId, lockToken, 'crawling');
    try {
      const r = await renderPageGuarded(job.homepage_url, { deadlineMs: 25_000, screenshot: false });
      if (r.ok) {
        renderMeta = { ...r.result.meta, reasons: escalation.reasons };
        if (r.result.html.length >= 2_000 && r.result.meta.textChars > 0) { rendered = r.result; renderingOutcome = 'ok'; }
        else { renderingOutcome = 'no_content'; renderingDetail = `렌더 본문 없음(html ${r.result.html.length}자 · 텍스트 ${r.result.meta.textChars}자)`; }
      } else {
        renderingOutcome = 'unavailable';
        renderingDetail = `${r.failure.reason}: ${r.failure.detail}`.slice(0, 300);
        renderMeta = { reasons: escalation.reasons, failure: r.failure.reason };
      }
    } catch (err: any) {
      renderingOutcome = 'unavailable';
      renderingDetail = detailOf(err);
    } finally {
      hb.stop();
    }
  }
  // 소스 확정 — 렌더가 앞 · 정적이 뒤(합집합). 둘 다 없으면 크롤 unavailable.
  const hasSource = !!(rendered || page);
  const finalUrl = rendered?.finalUrl || staticUrl;
  const materialSource: MaterialSource = rendered && page ? 'mixed' : rendered ? 'render' : 'static';
  const renderedMaterial = rendered ? buildOutreachEventMaterial(rendered.html) : null;
  const staticMaterial = page ? buildOutreachEventMaterial(page.html) : null;
  const homeMaterial = renderedMaterial && renderedMaterial.text ? renderedMaterial : (staticMaterial || { text: null, structuredBlocks: 0 });
  const homeText: string | null = homeMaterial.text;

  // 행사 상세 1홉
  let subUrl: string | null = null;
  let subText: string | null = null;
  let crawlSub: 'ok' | 'no_content' | 'unavailable' = 'no_content';
  if (hasSource) {
    const link = (rendered ? findEventPageLink(rendered.html, finalUrl) : null) || (page ? findEventPageLink(page.html, staticUrl) : null);
    if (link) {
      let host = '';
      try { host = new URL(finalUrl).hostname; } catch { host = ''; }
      // ★ 2026-09-06 홈을 렌더로 읽었으면 행사 상세도 렌더 우선(아이소이 행사 페이지 정적 = 6.9KB 껍데기 · 기간 문자열은 렌더 뒤에만 있다)
      let subHtml: string | null = null;
      let subFinal: string | null = null;
      let subSameHost = false;
      if (rendered) {
        const hb = startLockHeartbeat(jobId, lockToken, 'crawling');
        try {
          const rs = await renderPageGuarded(link, { deadlineMs: 20_000, screenshot: false });
          if (rs.ok && rs.result.html.length >= 2_000) {
            subHtml = rs.result.html; subFinal = rs.result.finalUrl;
            let subHost = ''; try { subHost = new URL(subFinal).hostname; } catch { subHost = ''; }
            subSameHost = !!host && isSameSite(host, subHost);
          }
        } catch (err: any) {
          console.error('[sales-outreach] 행사 상세 렌더 예외(정적 폴백):', jobId, err?.message);
        } finally {
          hb.stop();
        }
      }
      if (!subHtml) {
        try {
          const sub = await fetchHtmlGuarded(link, OUTREACH_FETCH_OPTS);
          if (sub) {
            subHtml = sub.html; subFinal = sub.finalUrl;
            let subHost = ''; try { subHost = new URL(sub.finalUrl).hostname; } catch { subHost = ''; }
            subSameHost = !!host && subHost === host;
          }
        } catch (err: any) {
          console.error('[sales-outreach] 행사 상세 1홉 예외:', jobId, err?.message);
        }
      }
      if (!subHtml || !subFinal || !subSameHost) {
        crawlSub = 'unavailable';
      } else {
        const t = buildOutreachEventMaterial(subHtml).text;
        if (t) { subUrl = subFinal; subText = t.slice(0, 2000); crawlSub = 'ok'; } else { crawlSub = 'no_content'; }
      }
    }
  }
  // 재료 합류 = 상세 앞에 싣고 총량 6000 유지
  let eventTextFull: string | null = null;
  if (homeText || subText) {
    const subBlock = subText && subUrl ? `[행사 페이지 ${subUrl}]\n${subText}` : '';
    const homeBudget = Math.max(0, 6000 - subBlock.length - (subBlock ? 1 : 0));
    eventTextFull = [subBlock, (homeText || '').slice(0, homeBudget)].filter(Boolean).join('\n') || null;
  }

  const crawlOutcome: StageOutcome = hasSource ? 'ok' : 'unavailable';
  const primaryHtml = rendered?.html || page?.html || '';
  const titleMatch = primaryHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  // ★ 2026-09-06 추출기는 두 소스에 각각 돌려 합집합(렌더 앞 · 정적 뒤 · 키 = productKey/URL). 정적 0건이면 결과는 렌더만, 렌더 0건이면 옛 방식과 같다.
  const listProducts: OutreachProduct[] = unionProducts(
    rendered ? extractProducts(rendered.html, finalUrl, 12) : [],
    page ? extractProducts(page.html, staticUrl, 12) : [],
    12,
  );
  const banners = unionImageDetails(rendered ? bannersOf(rendered.html, finalUrl, 24) : [], page ? bannersOf(page.html, staticUrl, 24) : [], 24);
  // ★ 0905(4) 브랜드 색 — theme-color·TileColor → 아이콘 PNG 지배색(색 1개만 · 로고 픽셀은 산출물에 쓰지 않는다 · 불변 11). 실패 = null(기본 토큰)
  //   메타는 정적 <head>가 먼저(렌더 HTML 은 그 뒤 폴백)
  const colorHtml = page?.html || rendered?.html || null;
  const brandColorRes = colorHtml
    ? await resolveBrandColorGuarded(colorHtml, finalUrl, (u) => fetchImageGuarded(u, { referer: finalUrl })).catch(() => ({ color: null, source: null }))
    : { color: null, source: null };
  const brandProfile = {
    siteTitle: titleMatch ? norm(titleMatch[1]).slice(0, 120) : null,
    excerpt: homeText ? homeText.slice(0, 600) : null,
    // 홈페이지에서 읽은 행사 텍스트 전량(구조화 블록 + 본문 · 최대 6000자) — 문안·DM·이메일 제작 재료(A-1)
    eventTextFull,
    // ★ 0905(3) C3-1 후보 24 — 순수 함수 기본값(24)과 호출부(12)가 어긋나 핫픽스가 운영에서 작동하지 않던 자리. 갤러리 8장 확보 = 시도 n×3(24)과 같은 축.
    //   ★ 2026-09-06 배너 상세(alt·순서)의 url 투영 — 제작 단계 소비처(collectOutreachMedia) 무변경
    imageCandidates: banners.map((b) => b.url),
    selectedImageUrl: null as string | null,
    crawledAt: new Date().toISOString(),
    finalUrl: hasSource ? finalUrl : null,
    brand: { primaryColor: brandColorRes.color, colorSource: brandColorRes.source },
    subPageUrl: subUrl,
    structuredBlocks: homeMaterial.structuredBlocks,
    // ★ 2026-09-05 재료(순수 추출 · 네트워크 0) — 제작 단계가 실측·사본 저장에 쓴다
    productLinks: unionStrings(rendered ? discoverProductLinks(rendered.html, finalUrl, 10) : [], page ? discoverProductLinks(page.html, staticUrl, 10) : [], 10),
    // ★ 0905(5) 헤더 로고 후보(순수 · 실물 판정은 제작 단계 collectOutreachMedia)
    logoCandidates: unionStrings(rendered ? extractLogoCandidates(rendered.html, finalUrl) : [], page ? extractLogoCandidates(page.html, staticUrl) : [], 4),
    listProducts,
    ctaLinks: mergeCtaLinks(rendered ? buildCtaLinkMap(rendered.html, finalUrl) : {}, page ? buildCtaLinkMap(page.html, staticUrl) : {}),
    legal: homeText ? extractLegal(homeText) : null,
    extraNotes: keepNotes,
    // ★ 2026-09-06 재료 v2(DDL 0 · jsonb 키) — 계측·배너 alt·사회적 증거·승격 기록. 화면 재료 카드와 S2 게이트의 원천.
    materials: hasSource
      ? buildMaterialsV2({
        source: materialSource,
        products: listProducts,
        banners,
        text: [homeText || '', subText || '', rendered?.text || ''].filter(Boolean).join('\n'),
        staticCounts,
        escalation: { attempted: escalation.escalate, reasons: escalation.reasons },
      })
      : null,
  };
  // 렌더 3값 별 키(시도했을 때만) + 읽기 방식
  const renderKeys: Record<string, unknown> = { crawl_engine: hasSource ? materialSource : 'none' };
  if (renderingOutcome) { renderKeys.rendering = renderingOutcome; renderKeys.rendering_detail = renderingDetail; renderKeys.render_meta = renderMeta; }

  if (crawlOutcome === 'unavailable') {
    // 봇 차단·타임아웃 — 행사 후보 없이 확정 대기로(화면에서 직접 붙여넣기 폴백). "확인 실패"를 "행사 없음"으로 접지 않는다.
    await query(
      `UPDATE sales_outreach_jobs
          SET stage = 'awaiting_confirm',
              brand_profile = $2::jsonb,
              event_quote = $3::jsonb,
              stage_results = COALESCE(stage_results, '{}'::jsonb) || $4::jsonb,
              lock_at = NOW()
        WHERE id = $1 AND stage = 'crawling' AND lock_token = $5`,
      [jobId, JSON.stringify(brandProfile), JSON.stringify({ candidates: [] }),
       JSON.stringify({ crawling: 'unavailable', crawling_detail: [crawlDetail || '응답 없음', renderingDetail ? `렌더 ${renderingDetail}` : ''].filter(Boolean).join(' · ').slice(0, 300), crawling_sub: 'no_content', ...renderKeys }), lockToken],
    );
    return;
  }

  const toAnalyzing = await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'analyzing',
            brand_profile = $2::jsonb,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $3::jsonb,
            lock_at = NOW()
      WHERE id = $1 AND stage = 'crawling' AND lock_token = $4
      RETURNING id`,
    [jobId, JSON.stringify(brandProfile), JSON.stringify({ crawling: 'ok', crawling_sub: crawlSub, ...renderKeys }), lockToken],
  );
  if (toAnalyzing.rows.length === 0) return; // 소유권 상실 — 이후 쓰기 전부 중단

  // --- 분석: AI는 인용만, 판정은 서버가 ---
  let analyzeOutcome: StageOutcome = 'no_event';
  let analyzeDetail: string | null = null;
  let candidates: EventCandidate[] = [];
  let meta: Record<string, unknown> = { rawCandidates: 0, matched: 0, shortDropped: 0, mismatched: 0, markerDropped: 0, structuredBlocks: homeMaterial.structuredBlocks, materialChars: (eventTextFull || '').length };
  if (eventTextFull) {
    try {
      const raw = await callAIWithFallback({
        system: [
          '너는 웹페이지 본문에서 "지금 진행 중인 행사·이벤트·프로모션"을 찾아 인용하는 분석기다.',
          '규칙:',
          '- 본문에 실제로 있는 문장을 글자 그대로(띄어쓰기 포함 원문 그대로) 인용한다. 요약·의역·창작 금지.',
          '- 진행 중인지 불분명하거나 종료된 행사는 제외한다.',
          '- 날짜는 본문에 명시된 것만 YYYY-MM-DD로 적고, 없으면 null.',
          '- 최대 3개. 없으면 빈 배열.',
          '- 출력은 JSON 배열 하나만: [{"quote":"...","start_date":null,"end_date":null}]',
        ].join('\n'),
        userMessage: eventTextFull,
        maxTokens: 1200,
        temperature: 0.2,
        source: 'sales-outreach-analyze',
      });
      const block = raw.match(/\[[\s\S]*\]/);
      const parsed = block ? JSON.parse(block[0]) : [];
      const filtered = filterQuoteCandidates(parsed, { home: homeText || '', sub: subText }, { home: job.homepage_url, sub: subUrl });
      candidates = filtered.candidates;
      meta = { ...meta, ...filtered.meta };
      analyzeOutcome = candidates.length > 0 ? 'ok' : 'no_event';
    } catch (err: any) {
      // AI 장애는 내용 판정이 아니다 — unavailable로 남겨 재시도 대상으로(발송 대상 아님)
      console.error('[sales-outreach] 분석 실패:', jobId, err?.message);
      analyzeOutcome = 'unavailable';
      analyzeDetail = detailOf(err);
      candidates = [];
    }
  }

  // ★ 2026-09-06 S2 재료 게이트 — 별 키(3값 무변경) · 제작은 계속 · 발송 잠금 6번째 사유의 원천 · 화면 확인 대기 배너. 해제 키(material_override)는 재크롤 시 resetJobTo 가 지운다(키 삭제는 그 함수 안에만).
  const materialGate: MaterialGate = assessMaterialSufficiency({ products: listProducts.length, banners: banners.length, events: candidates.length });
  await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'awaiting_confirm',
            event_quote = $2::jsonb,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $3::jsonb,
            lock_at = NOW()
      WHERE id = $1 AND stage = 'analyzing' AND lock_token = $4`,
    [jobId, JSON.stringify({ candidates, generatedAt: new Date().toISOString() }),
     JSON.stringify({ analyzing: analyzeOutcome, analyzing_meta: meta, material: materialGate, ...(analyzeDetail ? { analyzing_detail: analyzeDetail } : {}) }), lockToken],
  );
}

// ===== 확정(사람 게이트) → 제작 =====

export async function confirmOutreachSelection(
  jobId: string,
  selection: OutreachSelection,
  operatorSuperAdminId: string | null | undefined,
): Promise<{ warnings: string[] }> {
  await assertOperator(operatorSuperAdminId);

  const cur = await query(
    `SELECT stage, event_quote, brand_profile FROM sales_outreach_jobs WHERE id = $1`,
    [jobId],
  );
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'awaiting_confirm') {
    throw new OutreachError('CONFLICT', '지금은 확정할 수 있는 상태가 아닙니다. 화면을 새로고침해주세요.');
  }

  const eventQuote = cur.rows[0].event_quote || { candidates: [] };
  const allCandidates: EventCandidate[] = Array.isArray(eventQuote.candidates) ? eventQuote.candidates : [];
  const warnings: string[] = [];

  let selected: EventCandidate | null = null;
  const manual = norm(String(selection.manualEventText || ''));
  if (manual) {
    if (manual.length > 2000) throw new OutreachError('VALIDATION', '직접 입력 행사 원문은 2000자 이내로 입력해주세요.');
    // 사람이 붙여넣은 원문 = 사실 확인 책임이 사람에게 있는 인용. 날짜 검증이 없으므로 혜택 수치 면허는 없다.
    selected = { quote: manual, sourceUrl: 'manual', startDate: null, endDate: null, benefitLicensed: false, origin: 'manual' };
    if (hasDisqualifyingMarker(manual)) warnings.push('직접 입력한 행사 원문에 종료·마감·제외 같은 표현이 있습니다. 진행 중인 행사가 맞는지 확인해주세요.');
  } else if (selection.eventIndex !== null && selection.eventIndex !== undefined) {
    const idx = Number(selection.eventIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= allCandidates.length) {
      throw new OutreachError('VALIDATION', '행사 선택이 올바르지 않습니다.');
    }
    selected = allCandidates[idx];
  }

  const profile = cur.rows[0].brand_profile || {};
  let selectedImageUrl: string | null = null;
  if (selection.imageUrl) {
    const candidates: string[] = Array.isArray(profile.imageCandidates) ? profile.imageCandidates : [];
    if (!candidates.includes(selection.imageUrl)) {
      throw new OutreachError('VALIDATION', '이미지 선택이 올바르지 않습니다(후보 목록에 없는 주소).');
    }
    selectedImageUrl = selection.imageUrl;
  }
  const industry = selection.industryCategory && isIndustryCode(selection.industryCategory)
    ? selection.industryCategory : null;

  const lockToken = randomUUID();
  const updated = await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'producing_copy',
            event_quote = $2::jsonb,
            brand_profile = $3::jsonb,
            industry_category = COALESCE($4, industry_category),
            lock_token = $5, lock_at = NOW()
      WHERE id = $1 AND stage = 'awaiting_confirm'
      RETURNING id`,
    [jobId,
     JSON.stringify({ candidates: allCandidates, selected, confirmedBy: operatorSuperAdminId, confirmedAt: new Date().toISOString() }),
     JSON.stringify({ ...profile, selectedImageUrl }),
     industry, lockToken],
  );
  if (updated.rows.length === 0) {
    throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  }

  runProduction(jobId, lockToken).catch((err: any) => {
    console.error('[sales-outreach] 제작 실행 실패:', jobId, err?.message);
    markFailed(jobId, 'producing_copy', '제작을 시작하지 못했습니다. 다시 시도해주세요.', { lockToken, detail: detailOf(err) }).catch(() => {});
  });
  return { warnings };
}

// ===== 제작 파이프라인 (producing_copy → image → dm → email → ready · 단계별 재개 가능) =====

/** 최신 산출물 1건 조회(재개 시 앞 단계 결과를 DB에서 읽는다 — 메모리 전달 없음 = 단계별 재시도 성립 근거) */
async function latestAsset(jobId: string, kind: string): Promise<any | null> {
  const r = await query(
    `SELECT payload FROM sales_outreach_assets WHERE job_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`,
    [jobId, kind],
  );
  return r.rows[0]?.payload || null;
}

/** 산출물 INSERT를 소유권 검증과 **한 문장으로 결속**(Codex 3R high) — 검증 후 INSERT로 나누면
 *  그 사이에 소유권을 잃은 느린 워커가 나중에 자산을 남겨, 검토된 최신본을 잃은 실행의 산출물이
 *  덮을 수 있다(latestAsset은 created_at 최신을 읽는다). 0행 = 소유권 상실(호출부는 즉시 중단).
 *  regenCount = 그 시점의 재생성 순번(죽은 컬럼이 카운터가 된다 · B-3). */
async function insertAssetOwned(
  jobId: string, kind: string, payload: unknown, stage: string, lockToken: string, regenCount = 0,
): Promise<boolean> {
  const r = await query(
    `INSERT INTO sales_outreach_assets (job_id, kind, payload, regen_count)
     SELECT $1, $2, $3::jsonb, $6
      WHERE EXISTS (SELECT 1 FROM sales_outreach_jobs WHERE id = $1 AND stage = $4 AND lock_token = $5)
     RETURNING id`,
    [jobId, kind, JSON.stringify(payload), stage, lockToken, regenCount],
  );
  return r.rows.length > 0;
}

/** brand_profile 부분 갱신(소유권 조건) — 제작 단계가 수집한 재료를 남긴다 */
async function mergeBrandProfileOwned(jobId: string, lockToken: string, patch: Record<string, unknown>): Promise<boolean> {
  const r = await query(
    `UPDATE sales_outreach_jobs
        SET brand_profile = COALESCE(brand_profile, '{}'::jsonb) || $2::jsonb, lock_at = NOW()
      WHERE id = $1 AND lock_token = $3
      RETURNING id`,
    [jobId, JSON.stringify(patch), lockToken],
  );
  return r.rows.length > 0;
}

function regenSeqOf(stageResults: any, kind: RegenKind | 'materials' | 'sections'): number {
  const v = Number(stageResults?.regen_seq?.[kind]);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** 옛 DM 중지 — 새 email_html이 선 뒤 최신 1건을 제외한 dm 자산 전부(B-3 · 멱등 · 실패는 로그 + 계속) */
async function stopSupersededDms(jobId: string, companyId: string): Promise<void> {
  const r = await query(
    `SELECT payload FROM sales_outreach_assets WHERE job_id = $1 AND kind = 'dm' ORDER BY created_at DESC`,
    [jobId],
  );
  const olds = r.rows.slice(1);
  for (const row of olds) {
    const dmId = String(row.payload?.dmId || '');
    if (!dmId) continue;
    try {
      const res = await stopDm(dmId, companyId);
      if (res.block && res.block !== 'not_published') console.error('[sales-outreach] 옛 DM 중지 실패:', jobId, dmId, res.block);
    } catch (err: any) {
      console.error('[sales-outreach] 옛 DM 중지 예외:', jobId, dmId, err?.message);
    }
  }
}

/** 현재 stage 하나를 처리하고 다음 stage로 CAS 전이. 소유권 상실 = false(즉시 중단). */
async function runProduction(jobId: string, lockToken: string): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    const cur = await query(
      `SELECT stage, company_name, industry_category, event_quote, brand_profile, preview_code, stage_results, homepage_url
         FROM sales_outreach_jobs WHERE id = $1 AND lock_token = $2`,
      [jobId, lockToken],
    );
    if (cur.rows.length === 0) return; // 소유권 상실
    const job = cur.rows[0];
    const stage: string = job.stage;
    if (!String(stage).startsWith('producing_')) return; // ready·failed 등 — 여기 소관 아님
    const selected: EventCandidate | null = job.event_quote?.selected || null;
    const bp: any = job.brand_profile || {};
    const sr: any = job.stage_results || {};
    const regenFrom: string | null = sr.regen?.from || null;
    const licensedQuote = selected && selected.benefitLicensed ? selected.quote : '';
    // ★ 2026-09-06 S2 근거 원문 = 면허 인용문 + 재료에서 그대로 뽑은 사실 수치(가격). 면허(benefitLicensed) 판정은 licensedQuote 로만 · 차단기 originalBody 만 넓힌다(공용 CT 무변경 · 불변 20).
    const quoteBasis = [licensedQuote, factQuoteOf({ products: Array.isArray(bp.materials?.products) ? bp.materials.products : (Array.isArray(bp.listProducts) ? bp.listProducts : []), proof: bp.materials?.proof || null })].filter(Boolean).join('\n');
    const proof = bp.materials?.proof && typeof bp.materials.proof === 'object' ? { ...bp.materials.proof, collectedAt: bp.materials.collectedAt || null } : null;
    const brandColor: string | null = bp.brand?.primaryColor || null;
    const homepageUrl: string = String(bp.finalUrl || job.homepage_url);

    try {
      if (stage === 'producing_copy') {
        const guide = getActiveStyleGuide();
        const material = materialText(bp.eventTextFull, bp.excerpt, 3000);
        const promptMaterial = stripMaterialForPrompt(material, quoteBasis);
        const prompt = buildCopyPrompt(guide, { companyName: job.company_name, industry: job.industry_category, selected, promptMaterial, extraNotes: bp.extraNotes || null });
        const aiText = await callAIWithFallback({
          system: prompt.system, userMessage: prompt.user, maxTokens: 1000, temperature: 0.7, source: 'sales-outreach-copy',
        });
        // 혜택 수치 게이트 — 면허(검증 통과 + 종료일 미래) 있는 인용만 원본으로 인정. 나머지는 전부 placeholder.
        // 상품명이 든 줄은 대상 밖(상품명 안 숫자 오염 방지 · 재료 상품 목록 기준).
        const productNames: string[] = Array.isArray(bp.media?.products) ? bp.media.products.map((p: any) => String(p.name || '').slice(0, 12)).filter((s: string) => s.length >= 4) : [];
        const lines = aiText.replace(/^\[Web발신\]\s*/i, '').trim().split('\n')
          .map((l) => (productNames.some((n) => l.includes(n)) ? l : stripUnauthorizedBenefits(l, quoteBasis)));
        let body = lines.join('\n').trim();
        if (!body) throw new Error('AI가 빈 문안을 반환했습니다');
        if (!/^\(광고\)/.test(body)) body = `(광고) ${body}`;
        const placeholders = countBenefitPlaceholders(body);
        if (!(await insertAssetOwned(jobId, 'copy', {
          body,
          benefitLicensed: !!licensedQuote,
          styleGuideVersion: guide.version,
          sampleTrained: guide.sampleTrained,
          placeholders,
          materialChars: material.length,
          regenCount: regenSeqOf(sr, 'copy'),
        }, 'producing_copy', lockToken, regenSeqOf(sr, 'copy')))) return;
        const next = regenFrom === 'copy' ? 'producing_email' : 'producing_image';
        if (!(await advanceStage(jobId, lockToken, 'producing_copy', next))) return;

      } else if (stage === 'producing_image') {
        const ctx = getOutreachContext();
        if (!ctx) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
        // ★ A-10b 재료 이미지 실측·사본(최초 1회 · 이미지 재생성 때 다시) — 실패는 격리(재료 없음 = 산출물 감산 · 단계 실패 아님)
        let media: OutreachMedia | null = bp.media || null;
        let mediaError: string | null = null;
        if (!media || regenFrom === 'image') {
          try {
            media = await collectOutreachMedia({
              companyId: ctx.companyId,
              homepageUrl,
              imageCandidates: Array.isArray(bp.imageCandidates) ? bp.imageCandidates : [],
              productLinks: Array.isArray(bp.productLinks) ? bp.productLinks : [],
              listProducts: Array.isArray(bp.listProducts) ? bp.listProducts : [],
              logoCandidates: Array.isArray(bp.logoCandidates) ? bp.logoCandidates : [],
            });
            // 재수집 = 사본 URL이 전부 바뀐다 → 검토에서 고른 재료 선택은 함께 지운다(무효 선택이 재료를 0으로 만들지 않게)
            if (!(await mergeBrandProfileOwned(jobId, lockToken, { media, mediaSelection: null }))) return;
          } catch (err: any) {
            console.error('[sales-outreach] 재료 이미지 수집 실패(격리):', jobId, err?.message);
            mediaError = detailOf(err);
            media = null;
          }
        }
        const img = await produceOutreachImage({
          jobId,
          companyName: job.company_name,
          industry: job.industry_category,
          selectedImageUrl: bp.selectedImageUrl || null,
          regenSeq: regenSeqOf(sr, 'image'),
          brandColor,
          // ★ 2026-09-06 S3 문구 3칸 재료 · 실측 배너 0장이면 16:9 배너 1장
          eventQuote: selected?.quote || null,
          products: media?.products?.length ? media.products : (Array.isArray(bp.listProducts) ? bp.listProducts : []),
          siteTitle: bp.siteTitle || null,
          wantBanner: !(media && Array.isArray(media.gallery) && media.gallery.length > 0),
        });
        if (!(await insertAssetOwned(jobId, 'studio_image', {
          url: img.publicUrl, usedCutout: img.usedCutout, personJudge: img.personJudge,
          skippedReason: img.skippedReason, width: img.width, height: img.height,
          templateId: img.templateId, category: img.category, kind: img.kind,
          media: media ? media.stats : null, mediaError,
          // ★ S3 근거 패널·이메일 히어로 폴백
          posterTexts: img.posterTexts, cutoutSource: img.cutoutSource, posterScore: img.posterScore, posterRegenerated: img.posterRegenerated,
          bannerUrl: img.bannerUrl, bannerSize: img.bannerSize,
          regenCount: regenSeqOf(sr, 'image'),
        }, 'producing_image', lockToken, regenSeqOf(sr, 'image')))) return;
        if (!(await advanceStage(jobId, lockToken, 'producing_image', 'producing_dm'))) return;

      } else if (stage === 'producing_dm') {
        const ctx = getOutreachContext();
        if (!ctx) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
        const material = materialText(bp.eventTextFull, bp.excerpt, 6000);
        const promptMaterial = [
          selected ? `[확인된 행사] ${selected.quote}` : '',
          stripMaterialForPrompt(material, quoteBasis),
        ].filter(Boolean).join('\n\n') || `${job.company_name} 브랜드 안내`;
        const imageAsset = await latestAsset(jobId, 'studio_image');
        // ★ C4-3 섹션 숨김 재실행 = 저장된 섹션(override 적용 전)을 그대로 재발행(AI 0)
        const prevDm = regenFrom === 'sections_dm' ? await latestAsset(jobId, 'dm') : null;
        const presetSections = prevDm && Array.isArray(prevDm.sectionsBase || prevDm.sections) ? (prevDm.sectionsBase || prevDm.sections) : null;
        const dm = await produceOutreachDm({
          companyName: job.company_name,
          industry: job.industry_category,
          homepageUrl,
          siteTitle: bp.siteTitle || null,
          material: promptMaterial,
          extraNotes: bp.extraNotes || null,
          companyId: ctx.companyId, userId: ctx.userId,
          benefitLicensed: !!licensedQuote,
          licensedQuote: quoteBasis,
          proof,
          posterUrl: imageAsset?.url ? String(imageAsset.url) : null,
          posterSize: imageAsset?.width && imageAsset?.height ? { width: Number(imageAsset.width), height: Number(imageAsset.height) } : null,
          bannerUrl: imageAsset?.bannerUrl ? String(imageAsset.bannerUrl) : null,
          bannerSize: imageAsset?.bannerSize && typeof imageAsset.bannerSize === 'object' ? imageAsset.bannerSize : null,
          media: bp.media || null,
          mediaSelection: bp.mediaSelection || null,
          sectionOverride: sr.section_overrides?.dm || null,
          presetSections,
          ctaLinks: bp.ctaLinks && typeof bp.ctaLinks === 'object' ? bp.ctaLinks : {},
          legal: bp.legal || null,
          brandColor,
        });
        // 소유권을 잃은 실행의 DM 발행(외부 효과)은 결속으로 못 막는다 — 내부 전용 회사의 draft DM 1개 잔존이
        // 전부이고(과금 0·고객 무관) 자산 결속이 화면·메일 사용을 차단하므로 위험 수용(Codex 3R 판단 기록).
        // 섹션 숨김 재발행(preset · AI 0)은 근거(참조 골격·실물 예시 수·혜택 정제 수)를 새로 만들 수 없다 → 직전 자산 값을 승계(이메일 축 선례)
        const carry = presetSections && prevDm ? prevDm : null;
        // ★ 2026-09-06 S3 발행 DM 375폭 캡처 → vision 8항목 2값(경고 · 잠금 아님 · 워커·모델 부재 = null). 숨김 재실행은 직전 값 승계.
        const dmVision = carry ? (carry.visionScore || null) : await captureAndScoreDm(dm.viewerUrl).catch(() => null);
        if (!(await insertAssetOwned(jobId, 'dm', {
          dmId: dm.dmId, dmUrl: dm.dmUrl, viewerUrl: dm.viewerUrl,
          structureRef: carry ? (carry.structureRef ?? null) : dm.structureRef,
          benefitStripped: carry ? (Number(carry.benefitStripped) || 0) : dm.benefitStripped,
          // ★ 2026-09-06 S2 헤드라인 업체명 대체 여부(품질 경고 HERO_FALLBACK 의 원천 · 경고 · 잠금 아님)
          heroFallback: carry ? (carry.heroFallback === true) : dm.heroFallback,
          visionScore: dmVision,
          sectionTypes: dm.sectionTypes,
          exemplarCount: carry ? (Number(carry.exemplarCount) || 0) : dm.exemplarCount,
          exemplarTotal: carry ? (Number(carry.exemplarTotal) || 0) : dm.exemplarTotal,
          // ★ 0905(3) 검토 화면(iframe·섹션 숨김)·품질 경고·전후 대조가 읽는다. sectionsBase = override 적용 전(다음 숨김의 기준)
          sections: dm.sections, sectionsBase: dm.sectionsBase, look: dm.look, hiddenApplied: dm.hiddenApplied, hiddenMissed: dm.hiddenMissed, hiddenSkipped: dm.hiddenSkipped,
          regenCount: regenSeqOf(sr, 'dm'),
        }, 'producing_dm', lockToken, regenSeqOf(sr, 'dm')))) return;
        if (!(await advanceStage(jobId, lockToken, 'producing_dm', 'producing_email'))) return;

      } else if (stage === 'producing_email') {
        const ctx = getOutreachContext();
        if (!ctx) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
        const copyAsset = await latestAsset(jobId, 'copy');
        const dmAsset = await latestAsset(jobId, 'dm');
        const imageAsset = await latestAsset(jobId, 'studio_image');
        const prevEmail = await latestAsset(jobId, 'email_html');
        if (!copyAsset?.body || !dmAsset?.dmUrl) {
          throw new Error('앞 단계 산출물이 없어 메일을 조립할 수 없습니다.');
        }
        // 공개 샘플 코드 — 최초 1회만 발급(재조립해도 URL 불변). 내부 URL·토큰은 메일 조립에 넘기지 않는다(H2).
        let previewCode: string = job.preview_code || '';
        if (!previewCode) {
          previewCode = randomUUID().replace(/-/g, '').slice(0, 10);
          const codeSet = await query(
            `UPDATE sales_outreach_jobs SET preview_code = $2
              WHERE id = $1 AND lock_token = $3 AND preview_code IS NULL RETURNING preview_code`,
            [jobId, previewCode, lockToken],
          );
          if (codeSet.rows.length === 0) {
            const re = await query(`SELECT preview_code FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
            previewCode = re.rows[0]?.preview_code || previewCode;
          }
        }
        const guide = getActiveStyleGuide();
        const material = materialText(bp.eventTextFull, bp.excerpt, 6000);
        const promptMaterial = stripMaterialForPrompt(material, licensedQuote);
        // ★ B-2 재조립은 제목·서두·브랜드 시안을 다시 만들지 않는다(사람 편집분 보존 · AI 0회).
        // ★ 0905(3) 두 축으로 나눈다 — 제목·서두 = kind 'email'뿐 · 브랜드 시안 = 'email' + 재료 재선택('materials'). 섹션 숨김('sections_email')은 AI 0.
        const regenIntro = regenFrom === 'email' || !prevEmail;
        const regenBrand = regenFrom === 'email' || regenFrom === 'materials' || !prevEmail;
        let subject: string; let intro: string;
        if (regenIntro) {
          const si = await generateSubjectIntro(guide, { companyName: job.company_name, industry: job.industry_category, selectedEvent: selected, promptMaterial: promptMaterial.slice(0, 2000) });
          subject = si.subject; intro = si.intro;
        } else {
          subject = String(prevEmail.subject || guide.emailCopy.subjectDefault(job.company_name));
          intro = String(prevEmail.intro || guide.emailCopy.introDefault(job.company_name));
        }
        let brandSectionsBase: any[]; let brandSubject: string; let brandStripped: number; let exemplarCount: number; let exemplarTotal: number; let brandLook: any;
        if (regenBrand) {
          const brand = await produceOutreachBrandEmail({
            companyName: job.company_name, industry: job.industry_category, homepageUrl, siteTitle: bp.siteTitle || null,
            material: promptMaterial, extraNotes: bp.extraNotes || null, benefitLicensed: !!licensedQuote, licensedQuote: quoteBasis, proof,
            posterUrl: imageAsset?.url ? String(imageAsset.url) : null,
            posterSize: imageAsset?.width && imageAsset?.height ? { width: Number(imageAsset.width), height: Number(imageAsset.height) } : null,
            bannerUrl: imageAsset?.bannerUrl ? String(imageAsset.bannerUrl) : null,
            bannerSize: imageAsset?.bannerSize && typeof imageAsset.bannerSize === 'object' ? imageAsset.bannerSize : null,
            media: bp.media || null, mediaSelection: bp.mediaSelection || null,
            ctaLinks: bp.ctaLinks && typeof bp.ctaLinks === 'object' ? bp.ctaLinks : {}, legal: bp.legal || null, brandColor,
          });
          brandSectionsBase = brand.sections; brandSubject = brand.subject; brandStripped = brand.benefitStripped; exemplarCount = brand.exemplarCount; exemplarTotal = brand.exemplarTotal; brandLook = brand.look;
        } else {
          brandSectionsBase = Array.isArray(prevEmail.brandSectionsBase) ? prevEmail.brandSectionsBase : (Array.isArray(prevEmail.brandSections) ? prevEmail.brandSections : []);
          brandSubject = String(prevEmail.brandSubject || ''); brandStripped = Number(prevEmail.brandStripped) || 0; exemplarCount = Number(prevEmail.exemplarCount) || 0; exemplarTotal = Number(prevEmail.exemplarTotal) || 0; brandLook = prevEmail.brandLook || null;
        }
        // ★ C4-3 사람이 숨긴 시안 블록은 override 데이터로 재적용(같은 조립 경로 · 불변 16)
        const brandApplied = applySectionOverrides(brandSectionsBase, (sr.section_overrides?.email as SectionOverride | undefined) || null);
        const brandSections: any[] = brandApplied.sections;
        const email = assembleProposalEmail({
          companyName: job.company_name,
          industry: job.industry_category,
          selectedEvent: selected,
          copyBody: String(copyAsset.body),
          posterUrl: imageAsset?.url || null,
          dmUrl: String(dmAsset.dmUrl),
          previewUrl: `${PUBLIC_BASE}/api/outreach/v/${previewCode}`,
          unsubscribeNotice: (process.env.OUTREACH_UNSUB_NOTICE || '').trim(),
          brandSections,
          brandColor,
          subject,
          intro,
        });
        if (!(await insertAssetOwned(jobId, 'email_html', {
          subject: email.subject, intro: email.intro, html: email.html, text: email.text, placeholderCount: email.placeholderCount,
          brandSections, brandSectionsBase, brandSubject, brandStripped, exemplarCount, exemplarTotal, brandLook,
          hiddenApplied: brandApplied.applied, hiddenMissed: brandApplied.missed, hiddenSkipped: brandApplied.skipped === true,
          ...(prevEmail?.subjectEditedAt && !regenIntro ? { subjectEditedAt: prevEmail.subjectEditedAt, subjectEditedBy: prevEmail.subjectEditedBy || null } : {}),
          regenCount: regenSeqOf(sr, 'email'),
        }, 'producing_email', lockToken, regenSeqOf(sr, 'email')))) return;
        // ★ B-3 새 메일이 선 뒤 옛 DM을 내린다(옛 dmUrl은 새 email_html 전까지 최신 메일·공개 샘플에 살아 있다)
        await stopSupersededDms(jobId, ctx.companyId);
        if (!(await advanceStage(jobId, lockToken, 'producing_email', 'ready'))) return;
        return; // 파이프라인 종점

      } else {
        return;
      }
    } catch (err: any) {
      console.error(`[sales-outreach] ${stage} 실패:`, jobId, err?.message);
      const reasonMap: Record<string, string> = {
        producing_copy: 'AI 문안 생성에 실패했습니다. 다시 시도해주세요.',
        producing_image: '대표 이미지 제작에 실패했습니다. 다시 시도해주세요.',
        producing_dm: '모바일 DM 제작에 실패했습니다. 다시 시도해주세요.',
        producing_email: '제안 메일 조립에 실패했습니다. 다시 시도해주세요.',
      };
      await markFailed(jobId, stage, reasonMap[stage] || '제작에 실패했습니다.', { lockToken, detail: detailOf(err) });
      return;
    }
  }
}

/** 단계 전이 CAS + 성공 스탬프(성공 분기 안에서만) — 0행 = 소유권 상실.
 *  to='ready'면 regen 키를 지우고 lock_token을 놓는다(B-3 · 그 외 전이는 현행 SQL). */
async function advanceStage(jobId: string, lockToken: string, from: string, to: string): Promise<boolean> {
  const r = to === 'ready'
    ? await query(
      `UPDATE sales_outreach_jobs
          SET stage = $3,
              stage_results = (COALESCE(stage_results, '{}'::jsonb) || $4::jsonb) - 'regen',
              lock_token = NULL,
              lock_at = NOW()
        WHERE id = $1 AND stage = $2 AND lock_token = $5
        RETURNING id`,
      [jobId, from, to, JSON.stringify({ [from]: 'ok' }), lockToken],
    )
    : await query(
      `UPDATE sales_outreach_jobs
          SET stage = $3,
              stage_results = COALESCE(stage_results, '{}'::jsonb) || $4::jsonb,
              lock_at = NOW()
        WHERE id = $1 AND stage = $2 AND lock_token = $5
        RETURNING id`,
      [jobId, from, to, JSON.stringify({ [from]: 'ok' }), lockToken],
    );
  return r.rows.length > 0;
}

// ===== 렌더 대기 heartbeat (★ 2026-09-06 S1) =====

/**
 * 렌더 워커 대기 구간의 lock_at heartbeat(5초). 소유권(lock_token)과 stage 조건을 동반해 UPDATE 하고, 0행(소유권 상실·단계 이동)이면 스스로 멈춘다.
 * 이후 쓰기는 전부 CAS 라 소유권을 잃은 실행이 자산을 남기지 못한다. sweeper 의 좀비 판정(15분)은 lock_at 기준이므로 렌더 2회(최대 65초)가 임계에 닿지 않게 한다.
 */
function startLockHeartbeat(jobId: string, lockToken: string, stage: OutreachStage, intervalMs = 5_000): { stop: () => void } {
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    query(`UPDATE sales_outreach_jobs SET lock_at = NOW() WHERE id = $1 AND lock_token = $2 AND stage = $3 RETURNING id`, [jobId, lockToken, stage])
      .then((r) => { if (r.rows.length === 0) { stopped = true; clearInterval(timer); } })
      .catch((e: any) => console.error('[sales-outreach] heartbeat 실패(계속):', jobId, e?.message));
  }, intervalMs);
  return { stop: () => { stopped = true; clearInterval(timer); } };
}

// ===== 되돌리기 단일 함수 (★ B-7) =====

const RESETTABLE_KEYS = ['regen', 'crawling', 'analyzing', 'crawling_sub', 'analyzing_meta', 'crawling_detail', 'analyzing_detail', 'section_overrides',
  // ★ 2026-09-06 S1 렌더 3값 별 키 · S2 재료 게이트
  'rendering', 'rendering_detail', 'render_meta', 'crawl_engine', 'material', 'material_override'] as const;
type ResettableKey = (typeof RESETTABLE_KEYS)[number];

/**
 * 조건부 UPDATE 1문: stage 되돌림 + stage_results 키 초기화 + 락 + 실패 필드 정리. retry·recrawl·regenerate·rebuild 다섯 진입점이 전부 이것을 쓴다.
 * 0행 = CONFLICT(호출부가 그대로 거절). lock_at = NOW()를 찍어 방금 되돌린 건이 stale로 오판되지 않는다(B-5).
 */
async function resetJobTo(jobId: string, opts: {
  expect: string[];
  to: string;
  /** 새 lock_token(uuid) · null = 미선점(queued) */
  lockToken: string | null;
  clear: readonly ResettableKey[];
  set?: { stageResults?: Record<string, unknown>; homepageUrl?: string; clearProfile?: boolean; keepNotes?: string | null; brandProfilePatch?: Record<string, unknown> };
}): Promise<boolean> {
  const clearExpr = opts.clear.filter((k) => (RESETTABLE_KEYS as readonly string[]).includes(k)).map((k) => ` - '${k}'`).join('');
  const params: unknown[] = [jobId, opts.to, JSON.stringify(opts.set?.stageResults || {}), opts.lockToken, opts.expect];
  const extra: string[] = [];
  if (opts.set?.homepageUrl) { params.push(opts.set.homepageUrl); extra.push(`homepage_url = $${params.length}`); }
  if (opts.set?.clearProfile) {
    params.push(JSON.stringify(opts.set.keepNotes ? { extraNotes: opts.set.keepNotes } : {}));
    extra.push(`event_quote = NULL`, `brand_profile = $${params.length}::jsonb`);
  } else if (opts.set?.brandProfilePatch) {
    // ★ 0905(3) C4-2 최상위 키 얕은 병합(mediaSelection) — media 안을 건드리지 않는다
    params.push(JSON.stringify(opts.set.brandProfilePatch));
    extra.push(`brand_profile = COALESCE(brand_profile, '{}'::jsonb) || $${params.length}::jsonb`);
  }
  const r = await query(
    `UPDATE sales_outreach_jobs
        SET stage = $2,
            stage_results = (COALESCE(stage_results, '{}'::jsonb)${clearExpr}) || $3::jsonb,
            lock_token = $4, lock_at = NOW(),
            fail_stage = NULL, fail_reason = NULL, fail_detail = NULL
            ${extra.length ? ', ' + extra.join(', ') : ''}
      WHERE id = $1 AND stage = ANY($5) AND purged_at IS NULL AND mail_result IS DISTINCT FROM 'sending'
      RETURNING id`,
    params,
  );
  return r.rows.length > 0;
}

// ===== 실패 종결 (★ B-4 단일 소유자 · sweeper 포함) =====

/**
 * 실패 종결 — 유일한 소유자. SET = failed + fail_stage/reason/detail + stage_results[failStage]='unavailable' + lock_token NULL.
 * WHERE: lockToken이면 소유권 조건 + 종결 상태 제외 · allowStages면 stage = ANY · 둘 다 없으면 미선점(queued) 행만.
 * 무조건 WHERE id로 쓰면 발송 완료·타 실행 소유 건까지 덮는다.
 */
export async function markFailed(
  jobId: string, failStage: string, reason: string,
  opts: { lockToken?: string; detail?: string | null; allowStages?: string[] } = {},
): Promise<boolean> {
  const detail = opts.detail ? String(opts.detail).replace(/\s+/g, ' ').slice(0, 300) : null;
  const params: unknown[] = [jobId, failStage, reason, detail, JSON.stringify({ [failStage]: 'unavailable' })];
  let where: string;
  if (opts.lockToken) {
    params.push(opts.lockToken);
    where = `lock_token = $${params.length} AND stage NOT IN ('ready','sent','failed')`;
  } else if (opts.allowStages && opts.allowStages.length) {
    params.push(opts.allowStages);
    where = `stage = ANY($${params.length})`;
  } else {
    where = `stage = 'queued' AND lock_token IS NULL`;
  }
  const r = await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'failed', fail_stage = $2, fail_reason = $3, fail_detail = $4,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $5::jsonb,
            lock_token = NULL
      WHERE id = $1 AND ${where}
      RETURNING id`,
    params,
  );
  return r.rows.length > 0;
}

// ===== 발송 (사람 클릭이 유일 경로 — 워커·스케줄러 호출 불가 구조) =====

/** 발송 중복 클릭 방지(프로세스 내) — 최종 방어는 DB WHERE 조건 */
const mailInFlight = new Set<string>();

async function recordMailLast(jobId: string, entry: { outcome: string; detail: string; rejected: string[]; at: string; test?: boolean }): Promise<void> {
  await query(
    `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [jobId, JSON.stringify({ mail_last: entry })],
  ).catch((err: any) => console.error('[sales-outreach] mail_last 기록 실패:', jobId, err?.message));
}

export async function sendOutreachMailForJob(
  jobId: string,
  operatorSuperAdminId: string | null | undefined,
): Promise<{ outcome: string; detail: string }> {
  await assertOperator(operatorSuperAdminId); // 승인 컨텍스트 — 이 함수를 부를 수 있는 것은 사람 라우트뿐
  const cur = await query(
    `SELECT stage, mail_sent_at, stage_results FROM sales_outreach_jobs WHERE id = $1`, [jobId],
  );
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'sent' && cur.rows[0].stage !== 'ready') {
    throw new OutreachError('CONFLICT', '발송할 수 있는 상태가 아닙니다(제작 완료 후 가능).');
  }
  if (cur.rows[0].stage === 'sent') {
    throw new OutreachError('CONFLICT', '이미 발송된 건입니다.');
  }
  const emailAsset = await latestAsset(jobId, 'email_html');
  // ★ B-1 잠금 6종 = 순수 함수 하나(조회 응답도 같은 함수) — reason → 코드 · ★S2 재료 게이트는 stage_results 에서 읽는다
  const lock = computeSendLock(sendLockEnv(), emailAsset, sendLockMaterialOf(cur.rows[0].stage_results));
  if (lock.locked) {
    const messages: Record<SendLockReason, string> = {
      SENDER_NOT_CONFIGURED: '영업 발신 계정(OUTREACH_SMTP_USER/PASS)이 설정되지 않아 발송이 잠겨 있습니다.',
      UNSUB_NOTICE_MISSING: '수신거부 안내 문구(OUTREACH_UNSUB_NOTICE)가 확정되지 않아 발송이 잠겨 있습니다.',
      NO_EMAIL: '조립된 메일이 없습니다. 메일 재조립 후 발송해주세요.',
      PLACEHOLDER_REMAINS: '직접 채울 자리(혜택 안내)가 남아 있습니다. 문안을 수정하고 메일을 재조립한 뒤 발송할 수 있습니다.',
      UNSUB_NOT_APPLIED: '수신거부 문구가 반영되기 전의 메일입니다. 메일 재조립 후 발송해주세요.',
      MATERIAL_THIN: '홈페이지에서 읽은 재료가 얇아(상품·배너·행사 중 둘 이상 부족) 발송이 잠겨 있습니다. 산출물을 확인한 뒤 화면에서 해제할 수 있습니다.',
    };
    const first = lock.reasons[0];
    throw new OutreachError(first === 'NO_EMAIL' ? 'CONFLICT' : 'NOT_READY', messages[first], { reasons: lock.reasons });
  }
  if (mailInFlight.has(jobId)) {
    throw new OutreachError('CONFLICT', '발송이 진행 중입니다.');
  }
  mailInFlight.add(jobId);
  try {
    // SMTP 호출 **전** DB CAS 선점(Codex 3R high) — mailInFlight는 프로세스 내 한정이라 다중 프로세스가
    // 같은 ready를 각자 통과하면 메일이 두 번 나간다. 선점된 요청만 발송한다. lock_at = 선점 시각(끊긴 sending은 sweeper가 unknown으로 복구).
    // ★ B-11 선점 CAS는 원복 try **밖** — 선점 0행 CONFLICT가 남의 sending을 덮는 경로 차단.
    const claimed = await query(
      `UPDATE sales_outreach_jobs
          SET mail_result = 'sending', lock_at = NOW()
        WHERE id = $1 AND stage = 'ready' AND mail_sent_at IS NULL
          AND (mail_result IS NULL OR mail_result IN ('rejected','unknown'))
        RETURNING id`,
      [jobId],
    );
    if (claimed.rows.length === 0) {
      throw new OutreachError('CONFLICT', '발송이 이미 진행 중이거나 상태가 바뀌었습니다. 잠시 후 화면을 새로고침해주세요.');
    }

    try {
      const result = await sendOutreachProposalMail({
        subject: String(emailAsset.subject), html: String(emailAsset.html),
        ...(emailAsset.text ? { text: String(emailAsset.text) } : {}),
      });
      const at = new Date().toISOString();
      if (result.outcome === 'sent') {
        const done = await query(
          `UPDATE sales_outreach_jobs
              SET stage = 'sent', mail_sent_at = NOW(), mail_result = 'sent'
            WHERE id = $1 AND stage = 'ready' AND mail_result = 'sending' AND mail_sent_at IS NULL
            RETURNING id`,
          [jobId],
        );
        if (done.rows.length === 0) {
          // 메일은 나갔는데 상태 기록이 어긋났다(발송 중 상태 변경) — 성공으로 답하지 않는다(0행 = sent 금지).
          console.error('[sales-outreach] 발송 후 상태 기록 0행:', jobId);
          await recordMailLast(jobId, { outcome: 'unknown', detail: '발송됐으나 상태 기록이 어긋났습니다.', rejected: result.rejected, at });
          return { outcome: 'unknown', detail: '메일은 발송됐으나 상태 기록이 어긋났습니다. 수신함과 목록 상태를 확인해주세요.' };
        }
      } else {
        // rejected·unknown은 성공으로 접지 않는다 — 상태는 ready 유지, 결과만 기록(재발송 가능)
        const upd = await query(
          `UPDATE sales_outreach_jobs SET mail_result = $2 WHERE id = $1 AND mail_result = 'sending' RETURNING id`,
          [jobId, result.outcome],
        );
        if (upd.rows.length === 0) console.error('[sales-outreach] 발송 결과 기록 0행:', jobId, result.outcome);
      }
      await recordMailLast(jobId, { outcome: result.outcome, detail: result.detail, rejected: result.rejected, at });
      console.log('[sales-outreach] 발송 결과:', jobId, result.outcome, '→', outreachMailTo());
      return { outcome: result.outcome, detail: result.detail };
    } catch (err: any) {
      // 선점 이후 구간의 DB 예외 — sending을 남기면 버튼이 영구 잠긴다. unknown으로 원복 후 재throw(발송 여부는 모른다 = 정직).
      await query(
        `UPDATE sales_outreach_jobs SET mail_result = 'unknown' WHERE id = $1 AND mail_result = 'sending'`,
        [jobId],
      ).catch(() => {});
      throw err;
    }
  } finally {
    mailInFlight.delete(jobId);
  }
}

/**
 * ★ B-15 검수 테스트 발송 — 우리 담당자에게 먼저 보내 검수. 수신 주소는 허용 도메인 안에서만(외부 주소 = VALIDATION).
 * 제목 앞 접두 · 본문은 발송본과 같은 조립 결과(불변 16) · stage·mail_result 무변경(검수는 발송이 아니다) ·
 * 잠금 5종 중 SENDER_NOT_CONFIGURED·NO_EMAIL만 적용(수신거부 문구·placeholder는 검수 단계에서 보려는 것).
 */
export async function sendOutreachTestMail(
  jobId: string,
  to: string,
  operatorSuperAdminId: string | null | undefined,
): Promise<{ outcome: string; detail: string; to: string }> {
  await assertOperator(operatorSuperAdminId);
  const addr = String(to || '').trim();
  const domains = outreachTestMailDomains();
  if (!isAllowedTestRecipient(addr, domains)) {
    throw new OutreachError('VALIDATION', `검수 메일은 허용된 도메인(${domains.join(', ')})의 주소로만 보낼 수 있습니다.`);
  }
  const cur = await query(`SELECT stage, stage_results FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'ready' && cur.rows[0].stage !== 'sent') {
    throw new OutreachError('CONFLICT', '제작이 끝난 뒤에 검수 메일을 보낼 수 있습니다.');
  }
  const emailAsset = await latestAsset(jobId, 'email_html');
  const lock = computeSendLock(sendLockEnv(), emailAsset);
  if (lock.reasons.includes('NO_EMAIL')) throw new OutreachError('CONFLICT', '조립된 메일이 없습니다. 메일 재조립 후 보내주세요.');
  if (lock.reasons.includes('SENDER_NOT_CONFIGURED')) throw new OutreachError('NOT_READY', '영업 발신 계정(OUTREACH_SMTP_USER/PASS)이 설정되지 않아 발송이 잠겨 있습니다.');
  const guide = getActiveStyleGuide();
  const result = await mailerSendTest({
    to: addr,
    subject: `${guide.emailCopy.testSubjectPrefix}${String(emailAsset.subject)}`,
    html: String(emailAsset.html),
    ...(emailAsset.text ? { text: String(emailAsset.text) } : {}),
  });
  const at = new Date().toISOString();
  const list = appendTestSend(cur.rows[0].stage_results?.test_sends, { to: addr, outcome: result.outcome, at, by: operatorSuperAdminId || null });
  await query(
    `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [jobId, JSON.stringify({ test_sends: list })],
  ).catch((err: any) => console.error('[sales-outreach] test_sends 기록 실패:', jobId, err?.message));
  console.log('[sales-outreach] 검수 발송:', jobId, result.outcome, '→', addr);
  return { outcome: result.outcome, detail: result.detail, to: addr };
}

/** 수신함 도착 확인(사람) — 자동 종결 금지 축(R7). sent 상태에서만. */
export async function confirmOutreachMailArrived(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const r = await query(
    `UPDATE sales_outreach_jobs SET mail_confirmed_at = NOW()
      WHERE id = $1 AND stage = 'sent' AND mail_confirmed_at IS NULL RETURNING id`,
    [jobId],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', '수신 확인할 수 있는 상태가 아닙니다.');
}

/** "업체에 전달함" 표시(사람) — 공개 샘플 페이지 수명 연장 트리거(H15) + 중복 방지 축(R15). */
export async function markOutreachForwarded(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const r = await query(
    `UPDATE sales_outreach_jobs SET forwarded_at = NOW()
      WHERE id = $1 AND stage = 'sent' AND forwarded_at IS NULL RETURNING id`,
    [jobId],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', '전달 표시할 수 있는 상태가 아닙니다.');
}

/** 문안 수정(사람 편집 = 사람 책임) → 메일 재조립 필요 상태로. placeholder 해소 경로. */
export async function editOutreachCopy(jobId: string, body: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const text = String(body || '').trim();
  if (!text || text.length > 2000) throw new OutreachError('VALIDATION', '문안은 1~2000자로 입력해주세요.');
  const cur = await query(`SELECT stage FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'ready') throw new OutreachError('CONFLICT', '제작 완료 상태에서만 문안을 수정할 수 있습니다.');
  const inserted = await query(
    `INSERT INTO sales_outreach_assets (job_id, kind, payload)
     SELECT $1, 'copy', $2::jsonb
      WHERE EXISTS (SELECT 1 FROM sales_outreach_jobs WHERE id = $1 AND stage = 'ready')
     RETURNING id`,
    [jobId, JSON.stringify({ body: text, editedBy: operatorSuperAdminId, editedAt: new Date().toISOString(), placeholders: countBenefitPlaceholders(text) })],
  );
  if (inserted.rows.length === 0) {
    throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  }
  await rebuildOutreachEmail(jobId, operatorSuperAdminId);
}

/** ★ B-9 메일 제목 편집(1~40자) — 최신 email_html payload를 복사해 subject만 바꾼 새 asset. 낙관 잠금(읽은 asset id 결속). */
export async function editOutreachSubject(jobId: string, subject: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const text = String(subject || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 40) throw new OutreachError('VALIDATION', '제목은 1~40자로 입력해주세요.');
  const cur = await query(`SELECT stage, mail_result, purged_at FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'ready' || cur.rows[0].mail_result === 'sending' || cur.rows[0].purged_at) {
    throw new OutreachError('CONFLICT', '제작 완료 상태에서만 제목을 수정할 수 있습니다.');
  }
  const latest = await query(
    `SELECT id, payload FROM sales_outreach_assets WHERE job_id = $1 AND kind = 'email_html' ORDER BY created_at DESC LIMIT 1`,
    [jobId],
  );
  if (latest.rows.length === 0) throw new OutreachError('CONFLICT', '조립된 메일이 없습니다. 메일 재조립 후 수정해주세요.');
  const prev = latest.rows[0].payload || {};
  const html = String(prev.html || '');
  const payload = {
    ...prev,
    subject: text,
    placeholderCount: countBenefitPlaceholders(text) + countBenefitPlaceholders(html),
    subjectEditedAt: new Date().toISOString(),
    subjectEditedBy: operatorSuperAdminId || null,
  };
  const inserted = await query(
    `INSERT INTO sales_outreach_assets (job_id, kind, payload, regen_count)
     SELECT $1, 'email_html', $2::jsonb, $3
      WHERE EXISTS (SELECT 1 FROM sales_outreach_jobs WHERE id = $1 AND stage = 'ready' AND mail_result IS DISTINCT FROM 'sending')
        AND (SELECT id FROM sales_outreach_assets WHERE job_id = $1 AND kind = 'email_html' ORDER BY created_at DESC LIMIT 1) = $4
     RETURNING id`,
    [jobId, JSON.stringify(payload), Number(prev.regenCount) || 0, latest.rows[0].id],
  );
  if (inserted.rows.length === 0) {
    throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  }
}

/** 메일 재조립(ready → producing_email 재실행) — 수신거부 문구 반영·문안 수정 반영 경로. 제목·서두·브랜드 시안은 보존(B-2). */
export async function rebuildOutreachEmail(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const lockToken = randomUUID();
  // 발송 선점(sending) 중에는 재조립 금지 — SMTP가 나가는 동안 stage를 바꾸면 발송 후 기록이 어긋난다(Codex 3R).
  const ok = await resetJobTo(jobId, { expect: ['ready'], to: 'producing_email', lockToken, clear: ['regen'] });
  if (!ok) throw new OutreachError('CONFLICT', '재조립할 수 있는 상태가 아닙니다(발송 진행 중일 수 있습니다).');
  runProduction(jobId, lockToken).catch((err: any) => {
    console.error('[sales-outreach] 메일 재조립 실패:', jobId, err?.message);
    markFailed(jobId, 'producing_email', '메일 재조립에 실패했습니다.', { lockToken, detail: detailOf(err) }).catch(() => {});
  });
}

/** ★ B-3 산출물별 재생성 — 잡당 kind별 5회 · 카운터는 요청 시점 · 의존 순서 = copy→email / image→dm→email / dm→email / email 단독 */
export async function regenerateOutreachAsset(jobId: string, kind: string, operatorSuperAdminId: string | null | undefined): Promise<{ seq: number }> {
  await assertOperator(operatorSuperAdminId);
  if (!REGEN_KINDS.includes(kind as RegenKind)) throw new OutreachError('VALIDATION', '다시 만들 산출물 종류가 올바르지 않습니다.');
  const k = kind as RegenKind;
  const cur = await query(`SELECT stage, stage_results FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'ready') throw new OutreachError('CONFLICT', '제작 완료 상태에서만 다시 만들 수 있습니다.');
  const sr: any = cur.rows[0].stage_results || {};
  const seq = regenSeqOf(sr, k) + 1;
  if (seq > REGEN_MAX_PER_KIND) throw new OutreachError('CONFLICT', `이 산출물은 최대 ${REGEN_MAX_PER_KIND}회까지 다시 만들 수 있습니다.`);
  const lockToken = randomUUID();
  const ok = await resetJobTo(jobId, {
    expect: ['ready'],
    to: `producing_${k}`,
    lockToken,
    // 이미지 재생성 = 재료 재수집 → 사본 URL·섹션 구성이 바뀐다 → 저장된 블록 숨김도 지운다(불변 27 · 재료 선택은 producing_image가 지운다)
    clear: k === 'image' ? ['regen', 'section_overrides'] : ['regen'],
    set: { stageResults: { regen: { from: k, at: new Date().toISOString() }, regen_seq: { ...(sr.regen_seq || {}), [k]: seq } } },
  });
  if (!ok) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  runProduction(jobId, lockToken).catch((err: any) => {
    console.error('[sales-outreach] 재생성 실행 실패:', jobId, k, err?.message);
    markFailed(jobId, `producing_${k}`, '다시 만들기를 시작하지 못했습니다.', { lockToken, detail: detailOf(err) }).catch(() => {});
  });
  return { seq };
}

/**
 * ★ 0905(3) C4-2 재료 다시 고르기 — 검토(ready)에서 상품·갤러리를 빼거나 순서를 바꾼 뒤 이미지 단계 없이 DM·이메일 시안을 다시 만든다.
 * 값은 실측 통과 사본 URL 화이트리스트(confirm의 imageUrl 선례) · 저장 = brand_profile.mediaSelection(최상위 키 얕은 병합) ·
 * 상한 = 같은 표(regen_seq.materials · 5회). 제목·서두는 보존(producing_email regenIntro=false).
 */
export async function selectOutreachMaterials(jobId: string, raw: unknown, operatorSuperAdminId: string | null | undefined): Promise<{ products: number; gallery: number; seq: number }> {
  await assertOperator(operatorSuperAdminId);
  const cur = await query(`SELECT stage, brand_profile, stage_results FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'ready') throw new OutreachError('CONFLICT', '제작 완료 상태에서만 재료를 다시 고를 수 있습니다.');
  const bp: any = cur.rows[0].brand_profile || {};
  const v = validateOutreachMediaSelection(bp.media || null, raw);
  if (!v.ok) {
    const msg = v.reason === 'NO_MEDIA' ? '실측한 재료가 없어 다시 고를 수 없습니다.'
      : v.reason === 'EMPTY' ? '상품 또는 사진을 하나 이상 남겨주세요.'
      : v.reason === 'UNKNOWN_ITEM' ? '재료 선택이 올바르지 않습니다(실측 목록에 없는 항목).'
      : '재료 선택 형식이 올바르지 않습니다.';
    throw new OutreachError('VALIDATION', msg);
  }
  const sr: any = cur.rows[0].stage_results || {};
  const seq = regenSeqOf(sr, 'materials') + 1;
  if (seq > REGEN_MAX_PER_KIND) throw new OutreachError('CONFLICT', `재료 다시 고르기는 최대 ${REGEN_MAX_PER_KIND}회까지 할 수 있습니다.`);
  const selection: OutreachMediaSelection = { ...v.selection, selectedAt: new Date().toISOString(), selectedBy: operatorSuperAdminId || null };
  const lockToken = randomUUID();
  const ok = await resetJobTo(jobId, {
    expect: ['ready'],
    to: 'producing_dm',
    lockToken,
    clear: ['regen'],
    set: {
      stageResults: { regen: { from: 'materials', at: selection.selectedAt }, regen_seq: { ...(sr.regen_seq || {}), materials: seq } },
      brandProfilePatch: { mediaSelection: selection },
    },
  });
  if (!ok) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  runProduction(jobId, lockToken).catch((err: any) => {
    console.error('[sales-outreach] 재료 재선택 실행 실패:', jobId, err?.message);
    markFailed(jobId, 'producing_dm', '고른 재료로 다시 만들기를 시작하지 못했습니다.', { lockToken, detail: detailOf(err) }).catch(() => {});
  });
  return { products: selection.products.length, gallery: selection.gallery.length, seq };
}

/**
 * ★ 0905(3) C4-3 섹션 숨기기 — 검토(ready)에서 DM·이메일 시안의 블록을 뺀다. 저장 = stage_results.section_overrides[kind].hidden(`type#n` 키 · override 데이터)
 * → DM은 저장된 섹션을 그대로 재발행(AI 0) · 이메일은 재조립(AI 0). 다음 재생성 뒤에도 같은 순번에 재적용된다(같은 조립 경로 · 불변 16).
 * 줄이는 방향만(숨기기) · header·footer는 못 숨긴다 · 3섹션 미만으로는 못 줄인다.
 */
export async function hideOutreachSections(jobId: string, input: { kind: string; hidden: unknown }, operatorSuperAdminId: string | null | undefined): Promise<{ hidden: number }> {
  await assertOperator(operatorSuperAdminId);
  const kind = input.kind === 'dm' || input.kind === 'email' ? input.kind : null;
  if (!kind) throw new OutreachError('VALIDATION', '숨길 산출물 종류가 올바르지 않습니다.');
  const cur = await query(`SELECT stage, stage_results FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'ready') throw new OutreachError('CONFLICT', '제작 완료 상태에서만 블록을 숨길 수 있습니다.');
  const asset = await latestAsset(jobId, kind === 'dm' ? 'dm' : 'email_html');
  const base: any[] = kind === 'dm'
    ? (Array.isArray(asset?.sectionsBase) ? asset.sectionsBase : Array.isArray(asset?.sections) ? asset.sections : [])
    : (Array.isArray(asset?.brandSectionsBase) ? asset.brandSectionsBase : Array.isArray(asset?.brandSections) ? asset.brandSections : []);
  if (base.length === 0) throw new OutreachError('CONFLICT', '숨길 수 있는 블록 정보가 없습니다. 산출물을 다시 만든 뒤 시도해주세요.');
  const v = validateSectionOverride({ hidden: input.hidden }, base);
  if (!v.ok) {
    const msg = v.reason === 'PROTECTED' ? '머리말·꼬리말은 숨길 수 없습니다.'
      : v.reason === 'TOO_FEW_REMAIN' ? '블록은 3개 이상 남겨야 합니다.'
      : v.reason === 'UNKNOWN_KEY' ? '숨길 블록이 현재 산출물에 없습니다. 화면을 새로고침해주세요.'
      : '숨김 형식이 올바르지 않습니다.';
    throw new OutreachError('VALIDATION', msg);
  }
  const sr: any = cur.rows[0].stage_results || {};
  // 상한 — AI 0이지만 DM 재발행·메일 재조립이 자산을 쌓는다(다른 조작 4종과 같은 표 · 숨김은 두 배)
  const seq = regenSeqOf(sr, 'sections') + 1;
  if (seq > REGEN_MAX_PER_KIND * 2) throw new OutreachError('CONFLICT', `블록 숨김 반영은 최대 ${REGEN_MAX_PER_KIND * 2}회까지 할 수 있습니다.`);
  const at = new Date().toISOString();
  const overrides = { ...(sr.section_overrides && typeof sr.section_overrides === 'object' ? sr.section_overrides : {}), [kind]: { ...v.override, updatedAt: at, updatedBy: operatorSuperAdminId || null } };
  const lockToken = randomUUID();
  const ok = await resetJobTo(jobId, {
    expect: ['ready'],
    to: kind === 'dm' ? 'producing_dm' : 'producing_email',
    lockToken,
    clear: ['regen'],
    set: { stageResults: { regen: { from: kind === 'dm' ? 'sections_dm' : 'sections_email', at }, regen_seq: { ...(sr.regen_seq || {}), sections: seq }, section_overrides: overrides } },
  });
  if (!ok) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  runProduction(jobId, lockToken).catch((err: any) => {
    console.error('[sales-outreach] 섹션 숨김 실행 실패:', jobId, kind, err?.message);
    markFailed(jobId, kind === 'dm' ? 'producing_dm' : 'producing_email', '블록 숨김 반영을 시작하지 못했습니다.', { lockToken, detail: detailOf(err) }).catch(() => {});
  });
  return { hidden: v.override.hidden.length };
}

/** ★ B-7 주소 수정·재분석 — awaiting_confirm·failed에서 수집부터 다시(재료 초기화 · 추가 정보는 보존) */
export async function recrawlOutreachJob(jobId: string, input: { homepageUrl?: string | null }, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const homepageUrl = input.homepageUrl ? normalizeHomepageUrl(input.homepageUrl) : undefined;
  const cur = await query(`SELECT brand_profile FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  const keepNotes: string | null = cur.rows[0].brand_profile?.extraNotes ? String(cur.rows[0].brand_profile.extraNotes) : null;
  const ok = await resetJobTo(jobId, {
    expect: ['awaiting_confirm', 'failed'],
    to: 'queued',
    lockToken: null,
    clear: RESETTABLE_KEYS,
    set: { homepageUrl, clearProfile: true, keepNotes },
  });
  if (!ok) throw new OutreachError('CONFLICT', '다시 읽을 수 있는 상태가 아닙니다.');
  runOutreachJob(jobId).catch((err: any) => {
    console.error('[sales-outreach] 재분석 실행 실패:', jobId, err?.message);
    markFailed(jobId, 'crawling', '다시 읽기를 시작하지 못했습니다.', { detail: detailOf(err) }).catch(() => {});
  });
}

/** ★ B-13 실패 건 숨기기(뱃지에서 제외 · 목록에는 회색으로 남는다 · 삭제 아님) */
// ===== ★ 2026-09-06 S4 삭제(사람) · 열람 =====

/** 삭제 불가 = 진행 중(크롤·분석·제작 · 워커가 쓰는 중) 또는 발송 선점(sending). awaiting_confirm 은 크롤 lock_token 이 남아 있어 토큰이 아니라 stage 로 가른다. */
const UNDELETABLE_STAGES = ['queued', 'crawling', 'analyzing', 'producing_copy', 'producing_image', 'producing_dm', 'producing_email'];

/**
 * 사람 삭제 — 만료 파기와 같은 파기 본문(purgeOutreachJobArtifacts) · 스탬프 선점 → 파기 → 실패 시 롤백 + CONFLICT.
 * purged_at 스탬프(공개 페이지 즉시 404) + stage_results.deleted_at(사람 삭제 · 만료 파기와 구분 · 목록 제외). 행은 남는다(감사 · 중복 판정에서는 빠진다).
 * sent 도 허용(보낸 메일은 회수되지 않는다 · 링크만 닫힌다 · 화면 문구가 그렇게 말한다).
 */
export async function deleteOutreachJob(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<{ dmsStopped: number; filesDeleted: number }> {
  await assertOperator(operatorSuperAdminId);
  const ctx = getOutreachContext();
  if (!ctx) throw new OutreachError('NOT_READY', '준비가 되지 않았습니다: OUTREACH_COMPANY_ID·OUTREACH_USER_ID 설정이 필요합니다.');
  const cur = await query(`SELECT stage, mail_result, purged_at, stage_results FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  const row = cur.rows[0];
  if (row.purged_at) {
    if (row.stage_results?.deleted_at) throw new OutreachError('CONFLICT', '이미 삭제된 건입니다.');
    throw new OutreachError('CONFLICT', '열람 기간이 끝나 이미 정리된 건입니다.');
  }
  if (UNDELETABLE_STAGES.includes(String(row.stage))) throw new OutreachError('CONFLICT', '진행 중인 건은 삭제할 수 없습니다. 끝나거나 실패한 뒤 삭제해주세요.');
  if (row.mail_result === 'sending') throw new OutreachError('CONFLICT', '발송이 진행 중인 건은 삭제할 수 없습니다. 잠시 후 다시 시도해주세요.');
  const stamp = { deleted_at: new Date().toISOString(), deleted_by: operatorSuperAdminId || null };
  const claimed = await query(
    `UPDATE sales_outreach_jobs
        SET purged_at = NOW(), stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
      WHERE id = $1 AND purged_at IS NULL AND stage <> ALL($3) AND mail_result IS DISTINCT FROM 'sending'
      RETURNING id`,
    [jobId, JSON.stringify(stamp), UNDELETABLE_STAGES],
  );
  if (claimed.rows.length === 0) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  try {
    const r = await purgeOutreachJobArtifacts(jobId, ctx.companyId);
    console.log('[sales-outreach] 삭제:', jobId, `DM ${r.dmsStopped} · 파일 ${r.filesDeleted}`);
    return r;
  } catch (err: any) {
    // 파기 실패 = 스탬프 롤백(키 삭제는 resetJobTo 계약 밖이라 null 로 덮는다 · ->> 는 JSON null 을 SQL NULL 로 읽는다)
    console.error('[sales-outreach] 삭제 파기 실패(롤백):', jobId, err?.message);
    await query(
      `UPDATE sales_outreach_jobs SET purged_at = NULL, stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [jobId, JSON.stringify({ deleted_at: null, deleted_by: null })],
    ).catch(() => {});
    throw new OutreachError('CONFLICT', '링크를 닫는 데 실패해 삭제를 되돌렸습니다. 잠시 후 다시 시도해주세요.');
  }
}

/** 목록 다중 삭제 — 건별로 같은 함수 · sent 는 제외(보낸 건은 상세에서만 · 실수 방지) · 최대 100 · 실패 건은 사유와 함께 돌려준다 */
export async function deleteOutreachJobsBulk(ids: unknown, operatorSuperAdminId: string | null | undefined): Promise<{ deleted: string[]; skipped: Array<{ id: string; reason: string }>; dmsStopped: number; filesDeleted: number }> {
  await assertOperator(operatorSuperAdminId);
  const list = Array.isArray(ids) ? ids.map((v) => String(v || '').trim()).filter((v) => /^[0-9a-f-]{36}$/i.test(v)) : [];
  if (list.length === 0) throw new OutreachError('VALIDATION', '삭제할 건을 선택해주세요.');
  if (list.length > 100) throw new OutreachError('VALIDATION', '한 번에 100건까지 삭제할 수 있습니다.');
  const deleted: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  let dmsStopped = 0; let filesDeleted = 0;
  const stages = await query(`SELECT id, stage FROM sales_outreach_jobs WHERE id = ANY($1::uuid[])`, [list]);
  const stageOf = new Map<string, string>(stages.rows.map((r: any) => [String(r.id), String(r.stage)]));
  for (const id of list) {
    if (stageOf.get(id) === 'sent') { skipped.push({ id, reason: '발송된 건은 상세 화면에서만 삭제할 수 있습니다.' }); continue; }
    try {
      const r = await deleteOutreachJob(id, operatorSuperAdminId);
      deleted.push(id); dmsStopped += r.dmsStopped; filesDeleted += r.filesDeleted;
    } catch (err: any) {
      skipped.push({ id, reason: err instanceof OutreachError ? err.message : '처리에 실패했습니다.' });
    }
  }
  return { deleted, skipped, dmsStopped, filesDeleted };
}

/**
 * 산출물 페이지 열람 기록 — stage_results.views_preview(새 테이블 0 · 식별자 0 · UA 3분류 · 60초 합산 · 항목 50).
 * 총계 CAS(직전 total 일치 조건) 1회 재시도 · 실패는 조용히(열람 기록이 페이지 응답을 막지 않는다). 파기 건은 기록하지 않는다.
 */
export async function recordOutreachPreviewView(code: string, userAgent: string | null | undefined): Promise<void> {
  const c = String(code || '').trim();
  if (!/^[0-9a-f]{10}$/i.test(c)) return;
  const ua = classifyViewerUa(userAgent);
  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await query(`SELECT id, stage_results->'views_preview' AS vp FROM sales_outreach_jobs WHERE preview_code = $1 AND purged_at IS NULL`, [c]);
    if (cur.rows.length === 0) return;
    const prev = (cur.rows[0].vp || null) as PreviewViews | null;
    const prevTotal = Number(prev?.total) || 0;
    const next = mergePreviewView(prev, { at: new Date().toISOString(), ua });
    const r = await query(
      `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
        WHERE id = $1 AND COALESCE((stage_results->'views_preview'->>'total')::int, 0) = $3 RETURNING id`,
      [cur.rows[0].id, JSON.stringify({ views_preview: next }), prevTotal],
    );
    if (r.rows.length > 0) return;
  }
}

/**
 * DM 열람 집계 SQL 조각 — assets kind='dm' 의 전 dmId(재생성 이력 포함) 로 dm_views 를 잇는다. **company_id 항상 동반**(아웃리치 회사 · 계약 테스트).
 * 열람자 1인 = dm_views 1행(뷰어 UPSERT) · open_count = 재열람 · after_forward = 전달 표시 뒤 활동.
 */
const DM_VIEW_AGG_SQL = (jobAlias: string, companyParam: string) => `
  SELECT COUNT(*)::int AS viewers,
         COALESCE(SUM(v.open_count), 0)::int AS opens,
         MIN(v.viewed_at) AS first_at,
         MAX(v.last_active_at) AS last_at,
         COALESCE(SUM(v.duration_seconds), 0)::int AS seconds,
         MAX(v.max_scroll_pct)::int AS scroll,
         COUNT(*) FILTER (WHERE ${jobAlias}.forwarded_at IS NOT NULL AND COALESCE(v.last_active_at, v.viewed_at) >= ${jobAlias}.forwarded_at)::int AS after_forward
    FROM sales_outreach_assets a
    JOIN dm_views v ON v.dm_id = (a.payload->>'dmId')::uuid AND v.company_id = ${companyParam}::uuid
   WHERE a.job_id = ${jobAlias}.id AND a.kind = 'dm' AND (a.payload->>'dmId') ~* '^[0-9a-f-]{36}$'`;

function dmAggOf(row: any): DmViewAgg | null {
  if (!row || row.viewers === null || row.viewers === undefined) return null;
  return {
    viewers: Number(row.viewers) || 0, opens: Number(row.opens) || 0,
    firstAt: row.first_at ? new Date(row.first_at).toISOString() : null, lastAt: row.last_at ? new Date(row.last_at).toISOString() : null,
    seconds: Number(row.seconds) || 0, scroll: row.scroll === null || row.scroll === undefined ? null : Number(row.scroll), afterForward: Number(row.after_forward) || 0,
  };
}

function viewSummaryOf(job: any, dmRow: any): OutreachViewSummary {
  const pv = job?.stage_results?.views_preview && typeof job.stage_results.views_preview === 'object' ? job.stage_results.views_preview as PreviewViews : null;
  return summarizeOutreachViews({ dm: dmAggOf(dmRow), preview: pv, forwardedAt: job?.forwarded_at ? new Date(job.forwarded_at).toISOString() : null, stage: String(job?.stage || '') });
}

export async function dismissOutreachJob(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const r = await query(
    `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
      WHERE id = $1 AND stage = 'failed' RETURNING id`,
    [jobId, JSON.stringify({ dismissed_at: new Date().toISOString() })],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', '실패한 건만 숨길 수 있습니다.');
}

/**
 * ★ 2026-09-06 S2 재료 부족 잠금 해제 — 사람이 산출물을 확인한 뒤 화면 2클릭으로 푼다(감사 로그는 라우트). ready 에서만 · 재크롤·재분석이 material 을 다시 쓰면 해제도 지워진다(analyzing 종료 UPDATE 가 material_override 를 뺀다).
 */
export async function overrideOutreachMaterialGate(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<{ overridden: boolean }> {
  await assertOperator(operatorSuperAdminId);
  const cur = await query(`SELECT stage, stage_results FROM sales_outreach_jobs WHERE id = $1 AND purged_at IS NULL`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'ready') throw new OutreachError('CONFLICT', '제작이 끝난(검토 대기) 건에서만 해제할 수 있습니다.');
  const m = sendLockMaterialOf(cur.rows[0].stage_results);
  if (!m || m.verdict !== 'thin') throw new OutreachError('CONFLICT', '재료 부족 잠금이 걸린 건이 아닙니다.');
  const r = await query(
    `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
      WHERE id = $1 AND stage = 'ready' RETURNING id`,
    [jobId, JSON.stringify({ material_override: { by: operatorSuperAdminId || null, at: new Date().toISOString() } })],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  return { overridden: true };
}

/** ★ B-13 메뉴 뱃지 = 숨기지 않은 실패 + 수신 미확인 발송 */
export async function countOutreachBadge(operatorSuperAdminId: string | null | undefined): Promise<number> {
  await assertOperator(operatorSuperAdminId);
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM sales_outreach_jobs
      WHERE purged_at IS NULL
        AND ((stage = 'failed' AND (stage_results->>'dismissed_at') IS NULL)
          OR (stage = 'sent' AND mail_confirmed_at IS NULL))`,
    [],
  );
  return Number(r.rows[0]?.n) || 0;
}

// ===== 공개 샘플 페이지 (L2 — 무인증·noindex·만료. 산출물 렌더만, 내부 정보 0 = H1) =====

export async function getPublicOutreachHtml(code: string): Promise<string | null> {
  const c = String(code || '').trim();
  if (!/^[0-9a-f]{10}$/i.test(c)) return null;
  const r = await query(
    `SELECT id, mail_sent_at, forwarded_at, purged_at, created_at
       FROM sales_outreach_jobs WHERE preview_code = $1`,
    [c],
  );
  if (r.rows.length === 0) return null;
  const job = r.rows[0];
  if (job.purged_at) return null;
  // 수명 기산 = 발송 성공 시각(없으면 생성 시각) · 전달 표시는 연장 트리거(H15) — 늦은 기산점을 쓴다
  const basis = job.forwarded_at || job.mail_sent_at || job.created_at;
  const basisMs = new Date(basis).getTime();
  if (Number.isFinite(basisMs) && Date.now() > basisMs + OUTREACH_PREVIEW_DAYS * 24 * 60 * 60 * 1000) {
    return null;
  }
  const emailAsset = await latestAsset(job.id, 'email_html');
  return emailAsset?.html ? String(emailAsset.html) : null;
}

// ===== 재시도·조회 =====

/** 실패 건 재시도 — 실패한 그 단계부터 다시(§15-3). 자동 재시도는 없다 — 이 함수의 호출자는 사람 라우트뿐. */
export async function retryOutreachJob(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const cur = await query(
    `SELECT stage, fail_stage FROM sales_outreach_jobs WHERE id = $1`, [jobId],
  );
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'failed') throw new OutreachError('CONFLICT', '재시도할 수 있는 상태가 아닙니다.');
  const failStage: string = cur.rows[0].fail_stage || 'crawling';

  if (failStage.startsWith('producing_')) {
    // 제작 단계 실패 = 그 단계부터 재개(앞 단계 산출물은 DB에 있다)
    const lockToken = randomUUID();
    const ok = await resetJobTo(jobId, { expect: ['failed'], to: failStage, lockToken, clear: [] });
    if (!ok) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다.');
    runProduction(jobId, lockToken).catch((err: any) => {
      console.error('[sales-outreach] 재시도 실행 실패:', jobId, err?.message);
      markFailed(jobId, failStage, '재시도 시작에 실패했습니다.', { lockToken, detail: detailOf(err) }).catch(() => {});
    });
    return;
  }

  // 수집·분석·대기(queued) 실패 = 수집부터 다시
  const ok = await resetJobTo(jobId, { expect: ['failed'], to: 'queued', lockToken: null, clear: ['crawling', 'analyzing', 'crawling_sub', 'analyzing_meta', 'crawling_detail', 'analyzing_detail', 'rendering', 'rendering_detail', 'render_meta', 'crawl_engine', 'material', 'material_override'] });
  if (!ok) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다.');
  runOutreachJob(jobId).catch((err: any) => {
    console.error('[sales-outreach] 재시도 실행 실패:', jobId, err?.message);
    markFailed(jobId, 'crawling', '재시도 시작에 실패했습니다.', { detail: detailOf(err) }).catch(() => {});
  });
}

export async function getOutreachJob(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<any> {
  await assertOperator(operatorSuperAdminId);
  const job = await query(`SELECT * FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (job.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  const assets = await query(
    `SELECT id, kind, payload, regen_count, created_at FROM sales_outreach_assets WHERE job_id = $1 ORDER BY created_at`,
    [jobId],
  );
  // ★ C-5 lock_token은 내부 소유권 축 — 응답에서 뺀다(컬럼 목록 고정 금지 · ALTER와 배포 순서를 결합시키지 않는다)
  const { lock_token: _lockToken, ...rest } = job.rows[0];
  void _lockToken;
  const emailRows = assets.rows.filter((a: any) => a.kind === 'email_html');
  const emailAsset = emailRows.length ? emailRows[emailRows.length - 1].payload : null;
  const dmRows = assets.rows.filter((a: any) => a.kind === 'dm');
  const dmAsset = dmRows.length ? dmRows[dmRows.length - 1].payload : null;
  // ★ 0905(3) C4-4 품질 경고 — 세면 보이는 결함을 코드가 센다. 잠금 5종(computeSendLock)과 별도 축 · 발송을 막지 않는다.
  const bp: any = rest.brand_profile || {};
  const quality = assessOutreachQuality({
    dmSections: Array.isArray(dmAsset?.sections) ? dmAsset.sections : null,
    brandSections: emailAsset ? (Array.isArray(emailAsset.brandSections) ? emailAsset.brandSections : []) : null,
    media: applyOutreachMediaSelection(bp.media || null, bp.mediaSelection || null),
    legal: bp.legal || null,
    homepageUrl: String(bp.finalUrl || rest.homepage_url || ''),
    lookAssigned: dmAsset?.look && typeof dmAsset.look === 'object' ? (Number(dmAsset.look.treatments) || 0) + (Number(dmAsset.look.backgrounds) || 0) : undefined,
    heroFallback: typeof dmAsset?.heroFallback === 'boolean' ? dmAsset.heroFallback : undefined,
    dmVision: dmAsset?.visionScore && typeof dmAsset.visionScore === 'object' ? dmAsset.visionScore : null,
  });
  // ★ 2026-09-06 S4 열람(DM = dm_views 조인 · 산출물 페이지 = stage_results.views_preview) · 문장은 서버 완성
  const ctx = getOutreachContext();
  let dmRow: any = null;
  if (ctx) {
    try {
      const v = await query(`SELECT * FROM (${DM_VIEW_AGG_SQL('j', '$2')}) t, sales_outreach_jobs j WHERE j.id = $1`.replace('WHERE a.job_id = j.id', 'WHERE a.job_id = $1'), [jobId, ctx.companyId]);
      dmRow = v.rows[0] || null;
    } catch (err: any) {
      console.log('[sales-outreach] 열람 집계 건너뜀:', err?.message);
    }
  }
  const views = viewSummaryOf(rest, dmRow);
  return { ...rest, assets: assets.rows, sendLock: computeSendLock(sendLockEnv(), emailAsset, sendLockMaterialOf(rest.stage_results)), quality, views };
}

export async function getLatestOutreachJob(operatorSuperAdminId: string | null | undefined): Promise<any | null> {
  await assertOperator(operatorSuperAdminId);
  const job = await query(
    `SELECT id, company_name, industry_category, homepage_url, stage, fail_stage, fail_reason, mail_result, created_at
       FROM sales_outreach_jobs WHERE (stage_results->>'deleted_at') IS NULL ORDER BY created_at DESC LIMIT 1`,
    [],
  );
  return job.rows[0] || null;
}

export type OutreachListGroup = 'active' | 'awaiting_confirm' | 'ready' | 'sent' | 'failed';
const ACTIVE_STAGES = ['queued', 'crawling', 'analyzing', 'producing_copy', 'producing_image', 'producing_dm', 'producing_email'];

/** 진행 목록(이력) — ★ B-8 검색·상태 그룹·커서(created_at < before) · LIMIT 상한 100. 목록 행이 산출물 링크·발송 상태·chain까지 들고 간다. */
export async function listOutreachJobs(
  operatorSuperAdminId: string | null | undefined,
  filter: { q?: string | null; group?: string | null; limit?: number | null; before?: string | null; view?: string | null } = {},
): Promise<any[]> {
  await assertOperator(operatorSuperAdminId);
  // ★ 2026-09-06 S4 사람이 삭제한 건은 목록에서 빠진다(만료 파기 건은 남는다 · 링크만 닫힘)
  const where: string[] = [`(j.stage_results->>'deleted_at') IS NULL`];
  const params: unknown[] = [];
  const ctx = getOutreachContext();
  params.push(ctx ? ctx.companyId : null);
  const companyParam = `$${params.length}`;
  const q = String(filter.q || '').trim();
  if (q) { params.push(`%${q}%`); where.push(`(j.company_name ILIKE $${params.length} OR j.homepage_url ILIKE $${params.length})`); }
  const group = String(filter.group || '').trim();
  if (group === 'active') { params.push(ACTIVE_STAGES); where.push(`j.stage = ANY($${params.length})`); }
  else if (['awaiting_confirm', 'ready', 'sent', 'failed'].includes(group)) { params.push(group); where.push(`j.stage = $${params.length}`); }
  // ★ S4 열람 보조 필터 — viewed(열람 신호 1 이상) · unread3d(전달 표시 3일 경과 + 전달 뒤 신호 0 = 재접촉 후보)
  const view = String(filter.view || '').trim();
  const previewAfterForwardSql = `EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(j.stage_results->'views_preview'->'entries', '[]'::jsonb)) e
      WHERE e->>'ua' <> 'bot' AND (COALESCE(e->>'last', e->>'at'))::timestamptz >= j.forwarded_at)`;
  if (view === 'viewed') where.push(`(COALESCE(dv.viewers, 0) > 0 OR COALESCE((j.stage_results->'views_preview'->>'human')::int, 0) > 0)`);
  else if (view === 'unread3d') where.push(`(j.forwarded_at IS NOT NULL AND j.forwarded_at < NOW() - INTERVAL '${OUTREACH_UNREAD_DAYS} days' AND COALESCE(dv.after_forward, 0) = 0 AND NOT ${previewAfterForwardSql})`);
  const before = String(filter.before || '').trim();
  if (before && !Number.isNaN(new Date(before).getTime())) { params.push(new Date(before).toISOString()); where.push(`j.created_at < $${params.length}::timestamptz`); }
  const limit = Math.min(100, Math.max(1, Number(filter.limit) || 50));
  params.push(limit);
  const r = await query(
    `SELECT j.id, j.company_name, j.industry_category, j.homepage_url, j.stage, j.fail_stage, j.fail_reason,
            j.preview_code, j.mail_result, j.mail_sent_at, j.mail_confirmed_at, j.forwarded_at, j.purged_at, j.created_at,
            j.stage_results,
            dv.viewers, dv.opens, dv.first_at, dv.last_at, dv.seconds, dv.scroll, dv.after_forward
       FROM sales_outreach_jobs j
       LEFT JOIN LATERAL (${DM_VIEW_AGG_SQL('j', companyParam)}) dv ON TRUE
       WHERE ${where.join(' AND ')}
       ORDER BY j.created_at DESC LIMIT $${params.length}`,
    params,
  );
  // ★ S4 같은 주소 N건(중복 안내) — 키는 JS 한 곳(normalizeHomepageKey) · 미파기 전량을 한 번 읽어 센다(표 규모 = 수백 · 페이지 밖 중복도 보인다)
  const keyCount = new Map<string, number>();
  try {
    const all = await query(`SELECT homepage_url FROM sales_outreach_jobs WHERE purged_at IS NULL`, []);
    for (const row of all.rows) { const k = normalizeHomepageKey(String(row.homepage_url || '')); keyCount.set(k, (keyCount.get(k) || 0) + 1); }
  } catch (err: any) {
    console.log('[sales-outreach] 중복 수 계산 건너뜀:', err?.message);
  }
  return r.rows.map((row: any) => {
    const { viewers, opens, first_at, last_at, seconds, scroll, after_forward, ...rest } = row;
    const dmRow = ctx ? { viewers, opens, first_at, last_at, seconds, scroll, after_forward } : null;
    const dupCount = rest.purged_at ? 0 : Math.max(0, (keyCount.get(normalizeHomepageKey(String(rest.homepage_url || ''))) || 1) - 1);
    return { ...rest, views: viewSummaryOf(rest, dmRow), dup_count: dupCount };
  });
}

// ===== 대량 등록 (0824 Harold 지시 — 엑셀 일괄 · 실행은 순차) =====

export interface BulkEnqueueInput {
  companyName: string;
  homepageUrl: string;
  industryCategory: string | null;
}

/**
 * 일괄 등록 — 전 행을 queued로 넣고, 실행은 **순차 체인**(한 건이 확인 대기·실패에 닿으면 다음 건 시작).
 * 이유: 이미지 파이프라인 동시 1건 제한 + 상대 홈페이지 크롤 예의. 발송은 여기서 절대 일어나지 않는다(건별 사람 클릭).
 * 체인이 겹쳐 떠도 runOutreachJob의 queued CAS 선점이 이중 실행을 막는다(두 번째는 0행 무시).
 * ★ B-5 stage_results.chain = { batch, index, total } · ★ B-6 중복은 rejected로 건너뛴다.
 */
export async function enqueueOutreachJobsBulk(
  rows: BulkEnqueueInput[],
  operatorSuperAdminId: string | null | undefined,
): Promise<{ acceptedIds: string[]; rejected: Array<{ companyName: string; reason: string }> }> {
  await assertOperator(operatorSuperAdminId);
  if (!getOutreachContext()) {
    throw new OutreachError('NOT_READY', '준비가 되지 않았습니다: OUTREACH_COMPANY_ID·OUTREACH_USER_ID 설정이 필요합니다.');
  }

  const acceptedIds: string[] = [];
  const rejected: Array<{ companyName: string; reason: string }> = [];
  const batch = randomUUID();
  const total = rows.length;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const companyName = String(row.companyName || '').trim();
    let homepageUrl = String(row.homepageUrl || '').trim();
    if (!/^https?:\/\//i.test(homepageUrl)) homepageUrl = 'https://' + homepageUrl;
    try {
      void new URL(homepageUrl);
    } catch {
      rejected.push({ companyName: companyName || '(이름 없음)', reason: '홈페이지 주소 형식이 올바르지 않습니다.' });
      continue;
    }
    const industry = row.industryCategory && isIndustryCode(row.industryCategory) ? row.industryCategory : null;
    try {
      if (await findDuplicateJob(homepageUrl)) {
        rejected.push({ companyName, reason: '이미 등록된 업체입니다.' });
        continue;
      }
      const r = await query(
        `INSERT INTO sales_outreach_jobs (company_name, industry_category, homepage_url, stage, created_by, stage_results)
         VALUES ($1, $2, $3, 'queued', $4, $5::jsonb) RETURNING id`,
        [companyName, industry, homepageUrl, operatorSuperAdminId, JSON.stringify({ chain: { batch, index: i + 1, total } })],
      );
      acceptedIds.push(r.rows[0].id as string);
    } catch (err: any) {
      console.error('[sales-outreach] 일괄 등록 실패:', companyName, err?.message);
      rejected.push({ companyName, reason: '등록에 실패했습니다.' });
    }
  }

  // 순차 체인 — 각 건은 awaiting_confirm(사람 게이트)·failed에서 멈추므로 이 체인은 발송·확정을 절대 넘지 않는다.
  if (acceptedIds.length > 0) {
    (async () => {
      for (const id of acceptedIds) {
        try {
          await runOutreachJob(id);
        } catch (err: any) {
          console.error('[sales-outreach] 일괄 체인 실행 실패:', id, err?.message);
          await markFailed(id, 'crawling', '분석 시작에 실패했습니다. 재시도해주세요.', { detail: detailOf(err) }).catch(() => {});
        }
      }
    })().catch((err: any) => console.error('[sales-outreach] 일괄 체인 예외:', err?.message));
  }

  return { acceptedIds, rejected };
}
