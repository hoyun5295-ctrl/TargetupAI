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
  getOutreachContext, produceOutreachImage, produceOutreachDm, produceOutreachBrandEmail, collectOutreachMedia,
  generateSubjectIntro, assembleProposalEmail, countBenefitPlaceholders,
  PUBLIC_BASE, OUTREACH_PREVIEW_DAYS, type OutreachMedia,
} from './sales-outreach-produce';
import {
  sendOutreachProposalMail, sendOutreachTestMail as mailerSendTest, isOutreachMailerReady, outreachMailTo,
  outreachTestMailDomains, isAllowedTestRecipient,
} from './outreach-mailer';
import {
  extractProducts, extractImageCandidates, discoverProductLinks, buildCtaLinkMap, extractLegal, parseThemeColorFromHtml,
  type OutreachProduct,
} from './sales-outreach-media';
import { stopDm } from './dm/dm-builder';

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

export type SendLockReason = 'SENDER_NOT_CONFIGURED' | 'UNSUB_NOTICE_MISSING' | 'NO_EMAIL' | 'PLACEHOLDER_REMAINS' | 'UNSUB_NOT_APPLIED';

export interface SendLock { locked: boolean; reasons: SendLockReason[] }

/** 발송 잠금 5종(순수 · 불변 3 개정) — 발송 함수(효과)와 조회 응답(표시)이 같은 함수를 부른다. stage·in-flight·CAS는 효과 함수의 DB 축. */
export function computeSendLock(
  env: { mailerReady: boolean; unsub: string },
  emailAsset: { html?: string; subject?: string; placeholderCount?: number } | null,
): SendLock {
  const reasons: SendLockReason[] = [];
  if (!env.mailerReady) reasons.push('SENDER_NOT_CONFIGURED');
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
export function normalizeHomepageKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    return seg ? `${host}/${seg.toLowerCase()}` : host;
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

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
    const startDate = typeof (c as any)?.start_date === 'string' ? (c as any).start_date : null;
    const endDate = typeof (c as any)?.end_date === 'string' ? (c as any).end_date : null;
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

/** 같은 키의 미파기 잡(최신 1건) — 중복 등록 판정(B-6) */
async function findDuplicateJob(homepageUrl: string): Promise<{ id: string; stage: string } | null> {
  const key = normalizeHomepageKey(homepageUrl);
  const r = await query(
    `SELECT id, stage, homepage_url FROM sales_outreach_jobs WHERE purged_at IS NULL ORDER BY created_at DESC LIMIT 300`,
    [],
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
    page = await fetchHtmlGuarded(job.homepage_url);
    if (!page) crawlDetail = '응답 없음(접속 차단·시간 초과·리다이렉트 거부 중 하나)';
  } catch (err: any) {
    console.error('[sales-outreach] 크롤 예외:', jobId, err?.message);
    crawlDetail = detailOf(err);
  }
  const finalUrl = page?.finalUrl || job.homepage_url;
  const homeMaterial = page ? buildOutreachEventMaterial(page.html) : { text: null, structuredBlocks: 0 };
  const homeText: string | null = homeMaterial.text;

  // 행사 상세 1홉
  let subUrl: string | null = null;
  let subText: string | null = null;
  let crawlSub: 'ok' | 'no_content' | 'unavailable' = 'no_content';
  if (page) {
    const link = findEventPageLink(page.html, finalUrl);
    if (link) {
      try {
        const sub = await fetchHtmlGuarded(link);
        let host = '';
        try { host = new URL(finalUrl).hostname; } catch { host = ''; }
        let subHost = '';
        try { subHost = sub ? new URL(sub.finalUrl).hostname : ''; } catch { subHost = ''; }
        if (!sub || !host || subHost !== host) {
          crawlSub = 'unavailable';
        } else {
          const t = buildOutreachEventMaterial(sub.html).text;
          if (t) { subUrl = sub.finalUrl; subText = t.slice(0, 2000); crawlSub = 'ok'; } else { crawlSub = 'no_content'; }
        }
      } catch (err: any) {
        console.error('[sales-outreach] 행사 상세 1홉 예외:', jobId, err?.message);
        crawlSub = 'unavailable';
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

  const crawlOutcome: StageOutcome = page ? 'ok' : 'unavailable';
  const titleMatch = page?.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const listProducts: OutreachProduct[] = page ? extractProducts(page.html, finalUrl, 12) : [];
  const brandProfile = {
    siteTitle: titleMatch ? norm(titleMatch[1]).slice(0, 120) : null,
    excerpt: homeText ? homeText.slice(0, 600) : null,
    // 홈페이지에서 읽은 행사 텍스트 전량(구조화 블록 + 본문 · 최대 6000자) — 문안·DM·이메일 제작 재료(A-1)
    eventTextFull,
    imageCandidates: page ? extractImageCandidates(page.html, finalUrl, 12) : [],
    selectedImageUrl: null as string | null,
    crawledAt: new Date().toISOString(),
    finalUrl: page ? finalUrl : null,
    brand: { primaryColor: page ? parseThemeColorFromHtml(page.html) : null },
    subPageUrl: subUrl,
    structuredBlocks: homeMaterial.structuredBlocks,
    // ★ 2026-09-05 재료(순수 추출 · 네트워크 0) — 제작 단계가 실측·사본 저장에 쓴다
    productLinks: page ? discoverProductLinks(page.html, finalUrl, 10) : [],
    listProducts,
    ctaLinks: page ? buildCtaLinkMap(page.html, finalUrl) : {},
    legal: homeText ? extractLegal(homeText) : null,
    extraNotes: keepNotes,
  };

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
       JSON.stringify({ crawling: 'unavailable', crawling_detail: crawlDetail || '응답 없음', crawling_sub: 'no_content' }), lockToken],
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
    [jobId, JSON.stringify(brandProfile), JSON.stringify({ crawling: 'ok', crawling_sub: crawlSub }), lockToken],
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

  await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'awaiting_confirm',
            event_quote = $2::jsonb,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $3::jsonb,
            lock_at = NOW()
      WHERE id = $1 AND stage = 'analyzing' AND lock_token = $4`,
    [jobId, JSON.stringify({ candidates, generatedAt: new Date().toISOString() }),
     JSON.stringify({ analyzing: analyzeOutcome, analyzing_meta: meta, ...(analyzeDetail ? { analyzing_detail: analyzeDetail } : {}) }), lockToken],
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

function regenSeqOf(stageResults: any, kind: RegenKind): number {
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
    const brandColor: string | null = bp.brand?.primaryColor || null;
    const homepageUrl: string = String(bp.finalUrl || job.homepage_url);

    try {
      if (stage === 'producing_copy') {
        const guide = getActiveStyleGuide();
        const material = materialText(bp.eventTextFull, bp.excerpt, 3000);
        const promptMaterial = stripMaterialForPrompt(material, licensedQuote);
        const prompt = buildCopyPrompt(guide, { companyName: job.company_name, industry: job.industry_category, selected, promptMaterial, extraNotes: bp.extraNotes || null });
        const aiText = await callAIWithFallback({
          system: prompt.system, userMessage: prompt.user, maxTokens: 1000, temperature: 0.7, source: 'sales-outreach-copy',
        });
        // 혜택 수치 게이트 — 면허(검증 통과 + 종료일 미래) 있는 인용만 원본으로 인정. 나머지는 전부 placeholder.
        // 상품명이 든 줄은 대상 밖(상품명 안 숫자 오염 방지 · 재료 상품 목록 기준).
        const productNames: string[] = Array.isArray(bp.media?.products) ? bp.media.products.map((p: any) => String(p.name || '').slice(0, 12)).filter((s: string) => s.length >= 4) : [];
        const lines = aiText.replace(/^\[Web발신\]\s*/i, '').trim().split('\n')
          .map((l) => (productNames.some((n) => l.includes(n)) ? l : stripUnauthorizedBenefits(l, licensedQuote)));
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
            });
            if (!(await mergeBrandProfileOwned(jobId, lockToken, { media }))) return;
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
        });
        if (!(await insertAssetOwned(jobId, 'studio_image', {
          url: img.publicUrl, usedCutout: img.usedCutout, personJudge: img.personJudge,
          skippedReason: img.skippedReason, width: img.width, height: img.height,
          templateId: img.templateId, category: img.category, kind: img.kind,
          media: media ? media.stats : null, mediaError,
          regenCount: regenSeqOf(sr, 'image'),
        }, 'producing_image', lockToken, regenSeqOf(sr, 'image')))) return;
        if (!(await advanceStage(jobId, lockToken, 'producing_image', 'producing_dm'))) return;

      } else if (stage === 'producing_dm') {
        const ctx = getOutreachContext();
        if (!ctx) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
        const material = materialText(bp.eventTextFull, bp.excerpt, 6000);
        const promptMaterial = [
          selected ? `[확인된 행사] ${selected.quote}` : '',
          stripMaterialForPrompt(material, licensedQuote),
        ].filter(Boolean).join('\n\n') || `${job.company_name} 브랜드 안내`;
        const imageAsset = await latestAsset(jobId, 'studio_image');
        const dm = await produceOutreachDm({
          companyName: job.company_name,
          industry: job.industry_category,
          homepageUrl,
          siteTitle: bp.siteTitle || null,
          material: promptMaterial,
          extraNotes: bp.extraNotes || null,
          companyId: ctx.companyId, userId: ctx.userId,
          benefitLicensed: !!licensedQuote,
          licensedQuote,
          posterUrl: imageAsset?.url ? String(imageAsset.url) : null,
          media: bp.media || null,
          ctaLinks: bp.ctaLinks && typeof bp.ctaLinks === 'object' ? bp.ctaLinks : {},
          legal: bp.legal || null,
          brandColor,
        });
        // 소유권을 잃은 실행의 DM 발행(외부 효과)은 결속으로 못 막는다 — 내부 전용 회사의 draft DM 1개 잔존이
        // 전부이고(과금 0·고객 무관) 자산 결속이 화면·메일 사용을 차단하므로 위험 수용(Codex 3R 판단 기록).
        if (!(await insertAssetOwned(jobId, 'dm', {
          dmId: dm.dmId, dmUrl: dm.dmUrl, structureRef: dm.structureRef,
          benefitStripped: dm.benefitStripped, sectionTypes: dm.sectionTypes, exemplarCount: dm.exemplarCount, exemplarTotal: dm.exemplarTotal,
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
        const regenerateAll = regenFrom === 'email' || !prevEmail;
        // ★ B-2 재조립은 제목·서두·브랜드 시안을 다시 만들지 않는다(사람 편집분 보존 · AI 0회). 새로 뽑는 경로 = 재생성 kind='email'뿐.
        let subject: string; let intro: string;
        let brandSections: any[]; let brandSubject: string; let brandStripped: number; let exemplarCount: number; let exemplarTotal: number;
        if (regenerateAll) {
          const si = await generateSubjectIntro(guide, { companyName: job.company_name, industry: job.industry_category, selectedEvent: selected, promptMaterial: promptMaterial.slice(0, 2000) });
          subject = si.subject; intro = si.intro;
          const brand = await produceOutreachBrandEmail({
            companyName: job.company_name, industry: job.industry_category, homepageUrl, siteTitle: bp.siteTitle || null,
            material: promptMaterial, extraNotes: bp.extraNotes || null, benefitLicensed: !!licensedQuote, licensedQuote,
            posterUrl: imageAsset?.url ? String(imageAsset.url) : null, media: bp.media || null,
            ctaLinks: bp.ctaLinks && typeof bp.ctaLinks === 'object' ? bp.ctaLinks : {}, legal: bp.legal || null, brandColor,
          });
          brandSections = brand.sections; brandSubject = brand.subject; brandStripped = brand.benefitStripped; exemplarCount = brand.exemplarCount; exemplarTotal = brand.exemplarTotal;
        } else {
          subject = String(prevEmail.subject || guide.emailCopy.subjectDefault(job.company_name));
          intro = String(prevEmail.intro || guide.emailCopy.introDefault(job.company_name));
          brandSections = Array.isArray(prevEmail.brandSections) ? prevEmail.brandSections : [];
          brandSubject = String(prevEmail.brandSubject || ''); brandStripped = Number(prevEmail.brandStripped) || 0; exemplarCount = Number(prevEmail.exemplarCount) || 0; exemplarTotal = Number(prevEmail.exemplarTotal) || 0;
        }
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
          brandSections, brandSubject, brandStripped, exemplarCount, exemplarTotal,
          ...(prevEmail?.subjectEditedAt && !regenerateAll ? { subjectEditedAt: prevEmail.subjectEditedAt, subjectEditedBy: prevEmail.subjectEditedBy || null } : {}),
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

// ===== 되돌리기 단일 함수 (★ B-7) =====

const RESETTABLE_KEYS = ['regen', 'crawling', 'analyzing', 'crawling_sub', 'analyzing_meta', 'crawling_detail', 'analyzing_detail'] as const;
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
  set?: { stageResults?: Record<string, unknown>; homepageUrl?: string; clearProfile?: boolean; keepNotes?: string | null };
}): Promise<boolean> {
  const clearExpr = opts.clear.filter((k) => (RESETTABLE_KEYS as readonly string[]).includes(k)).map((k) => ` - '${k}'`).join('');
  const params: unknown[] = [jobId, opts.to, JSON.stringify(opts.set?.stageResults || {}), opts.lockToken, opts.expect];
  const extra: string[] = [];
  if (opts.set?.homepageUrl) { params.push(opts.set.homepageUrl); extra.push(`homepage_url = $${params.length}`); }
  if (opts.set?.clearProfile) {
    params.push(JSON.stringify(opts.set.keepNotes ? { extraNotes: opts.set.keepNotes } : {}));
    extra.push(`event_quote = NULL`, `brand_profile = $${params.length}::jsonb`);
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
    `SELECT stage, mail_sent_at FROM sales_outreach_jobs WHERE id = $1`, [jobId],
  );
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'sent' && cur.rows[0].stage !== 'ready') {
    throw new OutreachError('CONFLICT', '발송할 수 있는 상태가 아닙니다(제작 완료 후 가능).');
  }
  if (cur.rows[0].stage === 'sent') {
    throw new OutreachError('CONFLICT', '이미 발송된 건입니다.');
  }
  const emailAsset = await latestAsset(jobId, 'email_html');
  // ★ B-1 잠금 5종 = 순수 함수 하나(조회 응답도 같은 함수) — reason → 코드
  const lock = computeSendLock(sendLockEnv(), emailAsset);
  if (lock.locked) {
    const messages: Record<SendLockReason, string> = {
      SENDER_NOT_CONFIGURED: '영업 발신 계정(OUTREACH_SMTP_USER/PASS)이 설정되지 않아 발송이 잠겨 있습니다.',
      UNSUB_NOTICE_MISSING: '수신거부 안내 문구(OUTREACH_UNSUB_NOTICE)가 확정되지 않아 발송이 잠겨 있습니다.',
      NO_EMAIL: '조립된 메일이 없습니다. 메일 재조립 후 발송해주세요.',
      PLACEHOLDER_REMAINS: '직접 채울 자리(혜택 안내)가 남아 있습니다. 문안을 수정하고 메일을 재조립한 뒤 발송할 수 있습니다.',
      UNSUB_NOT_APPLIED: '수신거부 문구가 반영되기 전의 메일입니다. 메일 재조립 후 발송해주세요.',
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
    clear: ['regen'],
    set: { stageResults: { regen: { from: k, at: new Date().toISOString() }, regen_seq: { ...(sr.regen_seq || {}), [k]: seq } } },
  });
  if (!ok) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  runProduction(jobId, lockToken).catch((err: any) => {
    console.error('[sales-outreach] 재생성 실행 실패:', jobId, k, err?.message);
    markFailed(jobId, `producing_${k}`, '다시 만들기를 시작하지 못했습니다.', { lockToken, detail: detailOf(err) }).catch(() => {});
  });
  return { seq };
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
export async function dismissOutreachJob(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const r = await query(
    `UPDATE sales_outreach_jobs SET stage_results = COALESCE(stage_results, '{}'::jsonb) || $2::jsonb
      WHERE id = $1 AND stage = 'failed' RETURNING id`,
    [jobId, JSON.stringify({ dismissed_at: new Date().toISOString() })],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', '실패한 건만 숨길 수 있습니다.');
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
  const ok = await resetJobTo(jobId, { expect: ['failed'], to: 'queued', lockToken: null, clear: ['crawling', 'analyzing', 'crawling_sub', 'analyzing_meta', 'crawling_detail', 'analyzing_detail'] });
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
  return { ...rest, assets: assets.rows, sendLock: computeSendLock(sendLockEnv(), emailAsset) };
}

export async function getLatestOutreachJob(operatorSuperAdminId: string | null | undefined): Promise<any | null> {
  await assertOperator(operatorSuperAdminId);
  const job = await query(
    `SELECT id, company_name, industry_category, homepage_url, stage, fail_stage, fail_reason, mail_result, created_at
       FROM sales_outreach_jobs ORDER BY created_at DESC LIMIT 1`,
    [],
  );
  return job.rows[0] || null;
}

export type OutreachListGroup = 'active' | 'awaiting_confirm' | 'ready' | 'sent' | 'failed';
const ACTIVE_STAGES = ['queued', 'crawling', 'analyzing', 'producing_copy', 'producing_image', 'producing_dm', 'producing_email'];

/** 진행 목록(이력) — ★ B-8 검색·상태 그룹·커서(created_at < before) · LIMIT 상한 100. 목록 행이 산출물 링크·발송 상태·chain까지 들고 간다. */
export async function listOutreachJobs(
  operatorSuperAdminId: string | null | undefined,
  filter: { q?: string | null; group?: string | null; limit?: number | null; before?: string | null } = {},
): Promise<any[]> {
  await assertOperator(operatorSuperAdminId);
  const where: string[] = [];
  const params: unknown[] = [];
  const q = String(filter.q || '').trim();
  if (q) { params.push(`%${q}%`); where.push(`(company_name ILIKE $${params.length} OR homepage_url ILIKE $${params.length})`); }
  const group = String(filter.group || '').trim();
  if (group === 'active') { params.push(ACTIVE_STAGES); where.push(`stage = ANY($${params.length})`); }
  else if (['awaiting_confirm', 'ready', 'sent', 'failed'].includes(group)) { params.push(group); where.push(`stage = $${params.length}`); }
  const before = String(filter.before || '').trim();
  if (before && !Number.isNaN(new Date(before).getTime())) { params.push(new Date(before).toISOString()); where.push(`created_at < $${params.length}::timestamptz`); }
  const limit = Math.min(100, Math.max(1, Number(filter.limit) || 50));
  params.push(limit);
  const r = await query(
    `SELECT id, company_name, industry_category, homepage_url, stage, fail_stage, fail_reason,
            preview_code, mail_result, mail_sent_at, mail_confirmed_at, forwarded_at, purged_at, created_at,
            stage_results
       FROM sales_outreach_jobs
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return r.rows;
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
