/**
 * ★ 2026-09-23 AI 영업 직접 발송 — 판정 CT (순수 · DB 0 · 네트워크 0)
 * 설계 = docs/2026-09-23-outreach-direct-send-design.md (불변 44~51 · §5 잠금 · §6 단계 · §7 자동 확정 · §9 스토어)
 *
 * 이 파일은 "보내도 되는가"를 정하는 규칙만 소유한다. 효과(DB·SMTP)는 sales-outreach-direct-jobs.ts 가 이 함수들을 불러 판정한다.
 * 발송 함수(효과)와 조회 응답(화면)이 같은 함수를 부른다(불변 3 논법 · 화면에서 본 잠금 = 발송이 본 잠금).
 *
 * ⛔ 담당자 주소는 사람이 넣은 값만(불변 44) — 이 파일에 "문서에서 이메일을 찾는" 함수를 두지 않는다(계약 테스트).
 * ⛔ 원장에는 주소 원문을 두지 않는다(불변 49) — 해시는 비밀값 HMAC. 비밀값이 없으면 직접 발송 전체가 잠긴다.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { isSameSite, normalizeHost } from './sales-outreach-render-guard';
import { buildOutreachEventMaterial } from './sales-outreach-extract';
import type { SendLock, SendLockReason } from './sales-outreach-jobs';

// ===== 담당자 입력 정규화 =====

/** 형식 검사(실용 수준 · 로컬부 특수문자 일부 거절 · 도메인 라벨 형식) */
const CONTACT_EMAIL_RE = /^[^\s@<>(),;:"\[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** 담당자 이메일 정규화 — 앞뒤 공백 제거 · 도메인 소문자 · 형식 불량·254자 초과 = null */
export function normalizeContactEmail(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  if (!v || v.length > 254 || !CONTACT_EMAIL_RE.test(v)) return null;
  const at = v.lastIndexOf('@');
  return `${v.slice(0, at)}@${v.slice(at + 1).toLowerCase()}`;
}

/** 담당자명(선택) — 공백 정리 · 40자 · 비면 null */
export function normalizeContactName(raw: unknown): string | null {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.slice(0, 40);
}

/** 수신 근거 고정 선택지(엑셀 드롭다운 · 화면 선택) — 그 밖의 문장도 받는다(기타 · 직접 입력) */
export const CONTACT_BASIS_PRESETS = ['명함', '기존 대화', '제휴 문의 페이지', '기타'] as const;

/** 수신 근거 — 공백 정리 · 200자 · 비면 null(= 발송 잠금 NO_BASIS) */
export function normalizeContactBasis(raw: unknown): string | null {
  const v = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return null;
  return v.slice(0, 200);
}

// ===== 해시 · 수신거부 토큰 (불변 49) =====

/** 비밀값(32자 이상) — 없으면 null(= 직접 발송 잠금 HASH_SECRET_MISSING) */
export function outreachHashSecret(env: Record<string, string | undefined> = process.env): string | null {
  const v = String(env.OUTREACH_HASH_SECRET || '').trim();
  return v.length >= 32 ? v : null;
}

/** 주소 해시(원장 키) — HMAC-SHA256(비밀값, 'addr:' + 소문자 주소) hex */
export function outreachAddressHash(email: string, secret: string): string {
  return createHmac('sha256', secret).update(`addr:${String(email || '').trim().toLowerCase()}`).digest('hex');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 수신거부 서명(32자 hex) — 잡 id 와 그 잡이 보낸(보낼) 주소 해시에 결속 */
export function unsubscribeSigOf(jobId: string, toHash: string, secret: string): string {
  return createHmac('sha256', secret).update(`unsub:${jobId}:${toHash}`).digest('hex').slice(0, 32);
}

export function buildUnsubscribeToken(jobId: string, toHash: string, secret: string): string {
  return `${jobId}.${unsubscribeSigOf(jobId, toHash, secret)}`;
}

/** 토큰 형식 파싱(검증은 verifyUnsubscribeSig) — 형식 불량 = null */
export function parseUnsubscribeToken(token: unknown): { jobId: string; sig: string } | null {
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/i.exec(String(token ?? '').trim());
  if (!m || !UUID_RE.test(m[1])) return null;
  return { jobId: m[1].toLowerCase(), sig: m[2].toLowerCase() };
}

/** 서명 검증(상수 시간) */
export function verifyUnsubscribeSig(jobId: string, sig: string, toHash: string, secret: string): boolean {
  const expected = Buffer.from(unsubscribeSigOf(jobId, toHash, secret), 'utf8');
  const got = Buffer.from(String(sig || '').toLowerCase(), 'utf8');
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function unsubscribeUrlOf(publicBase: string, token: string): string {
  return `${String(publicBase || '').replace(/\/+$/, '')}/api/outreach/u/${token}`;
}

/** 그 잡이 지금 담당자에게 보낼 메일에 들어 있어야 할 수신거부 주소(조립과 잠금이 같은 함수) · 주소·비밀값 없음 = null */
export function directUnsubscribeUrlOf(publicBase: string, jobId: string, contactEmail: unknown, secret: string | null): string | null {
  const email = normalizeContactEmail(contactEmail);
  if (!email || !secret) return null;
  return unsubscribeUrlOf(publicBase, buildUnsubscribeToken(jobId, outreachAddressHash(email, secret), secret));
}

// ===== 도메인 3구분 =====

/** 무료메일(개인 메일) 도메인 — 등록은 받고 경고 · 묶음·자동 대상에서 빠진다 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'outlook.com', 'hotmail.com',
  'yahoo.com', 'yahoo.co.kr', 'icloud.com', 'live.com', 'me.com', 'msn.com', 'korea.com', 'hanmir.com',
]);

export type ContactDomainVerdict = 'same' | 'free' | 'other' | 'unknown';

/** 담당자 이메일 도메인 ↔ 홈페이지 등록 도메인. 판정기는 렌더 가드의 isSameSite(새 판정기 0). */
export function classifyContactDomain(email: string | null | undefined, homepageUrl: string | null | undefined): ContactDomainVerdict {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return 'unknown';
  const domain = normalizeHost(e.slice(at + 1));
  if (!domain) return 'unknown';
  if (FREE_MAIL_DOMAINS.has(domain)) return 'free';
  let host = '';
  try { host = new URL(/^https?:\/\//i.test(String(homepageUrl || '')) ? String(homepageUrl) : `https://${homepageUrl}`).hostname; } catch { host = ''; }
  if (!host) return 'unknown';
  return isSameSite(host, domain) ? 'same' : 'other';
}

// ===== 네이버 스토어 (불변 50 · fetch 0) =====

const STORE_HOSTS: Record<string, 'brand' | 'smartstore'> = {
  'brand.naver.com': 'brand', 'm.brand.naver.com': 'brand',
  'smartstore.naver.com': 'smartstore', 'm.smartstore.naver.com': 'smartstore',
};
/** 스토어 첫 경로 조각 중 slug 가 아닌 것 */
const STORE_RESERVED = new Set(['main', 'i', 'n', 'p', 'search', 'category', 'products', 'shoppingstory', 'profile', 'notice', 'best', 'event']);

/**
 * 스토어 주소 → 저장값 `brand:slug` · `smartstore:slug`(영문·숫자·_·- 2~40 · 소문자). 형식이 아니면 null.
 * 저장값은 fetch 가능한 주소가 아니다(이름이 계약이다 · §16-2-7 논법). 주소는 naverStoreUrlOf 가 코드 템플릿으로 만든다.
 */
export function parseNaverStoreSlug(raw: unknown): { value: string; kind: 'brand' | 'smartstore'; slug: string } | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { return null; }
  const kind = STORE_HOSTS[u.hostname.toLowerCase()];
  if (!kind) return null;
  const first = decodeURIComponent(u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  if (!/^[a-z0-9_-]{2,40}$/.test(first) || STORE_RESERVED.has(first)) return null;
  return { value: `${kind}:${first}`, kind, slug: first };
}

/** 저장값 → 표시용 주소(코드 템플릿) · 형식 불량 = null */
export function naverStoreUrlOf(value: string | null | undefined): string | null {
  const m = /^(brand|smartstore):([a-z0-9_-]{2,40})$/.exec(String(value || ''));
  if (!m) return null;
  return m[1] === 'brand' ? `https://brand.naver.com/${m[2]}` : `https://smartstore.naver.com/${m[2]}`;
}

// ===== 스토어 화면 문구(★0924 · 직원 브라우저 화면 가져오기 · 저장본 업로드 공용 · 네트워크 0) =====

/** 스토어 화면·저장본에서 뽑는 행사 문구 상한(직접 붙여넣기 칸과 같은 2000자) */
export const STORE_PAGE_TEXT_MAX = 2000;

/** 가져온 문구를 받을 수 있는 단계 = 확정 전(확정 뒤에는 쓰일 자리가 없다) */
export const STORE_GRAB_STAGES = ['queued', 'crawling', 'analyzing', 'awaiting_confirm'] as const;

/** 스토어 화면 HTML → 행사 문구. 홈페이지와 같은 추출기(새 추출 로직 0) · 빈 결과 = '' (호출부가 짧으면 거절) */
export function storePageTextOf(html: string): string {
  const m = buildOutreachEventMaterial(String(html || ''));
  return String(m.text || '').replace(/\n{3,}/g, '\n\n').trim().slice(0, STORE_PAGE_TEXT_MAX);
}

// ===== 제목 접두 (불변 47 · 발송 시점 변형은 이것 하나) =====

export const OUTREACH_AD_PREFIX = '(광고) ';

export function directSubjectOf(subject: string): string {
  const s = String(subject || '').trim();
  return /^\(광고\)/.test(s) ? s : `${OUTREACH_AD_PREFIX}${s}`;
}

// ===== 잠금 =====

export type DirectLockReason =
  | 'DIRECT_DISABLED' | 'HASH_SECRET_MISSING' | 'NO_CONTACT' | 'NO_BASIS' | 'DOMAIN_MISMATCH'
  | 'SUPPRESSED' | 'ALREADY_SENT_COMPANY' | 'DAILY_CAP' | 'NOT_REVIEWED' | 'UNSUB_LINK_STALE';

export interface DirectLockInput {
  /** 유효 단계(결재값과 데이터가 허락한 단계 중 작은 것) */
  stage: number;
  hashReady: boolean;
  contactEmail: string | null;
  contactBasis: string | null;
  domainVerdict: ContactDomainVerdict;
  domainAcked: boolean;
  suppressed: boolean;
  alreadySentCompany: boolean;
  todayAttempts: number;
  dailyCap: number;
  /** 사람 확인이 필요한 발송인가(단계 3 자동은 false · 사후 표본 확인) */
  requireReview: boolean;
  reviewedAssetId: string | null;
  latestAssetId: string | null;
  /**
   * 최신 판에 **현재 담당자 기준** 수신거부 주소가 들어 있는가(불변 47) · 판이 없으면 null(자사 잠금 NO_EMAIL 이 이미 잠근다).
   * 증거는 호출부가 고른다 — 발송 함수 = html 본문 포함 검사(unsubLinkInHtml) · 목록 화면 = 판에 기록한 주소 대조. 판정은 이 함수 하나.
   */
  unsubLinkOk: boolean | null;
}

/** 발송 함수의 증거 — 최신 판 html 에 현재 담당자 기준 수신거부 주소가 문자 그대로 있는가 */
export function unsubLinkInHtml(html: string | null | undefined, expectedUrl: string | null): boolean | null {
  if (!html) return null;
  return !!expectedUrl && String(html).includes(expectedUrl);
}

export interface DirectSendLock { locked: boolean; reasons: Array<SendLockReason | DirectLockReason> }

/** 직접 발송 잠금(순수) = 자사 발송 잠금 6종(base) + 직접 발송 10종. 발송 함수와 조회 응답이 같은 함수를 부른다. */
export function computeDirectSendLock(base: SendLock, input: DirectLockInput): DirectSendLock {
  const reasons: Array<SendLockReason | DirectLockReason> = [...base.reasons];
  if (input.stage < 1) reasons.push('DIRECT_DISABLED');
  if (!input.hashReady) reasons.push('HASH_SECRET_MISSING');
  const email = normalizeContactEmail(input.contactEmail);
  if (!email) reasons.push('NO_CONTACT');
  if (!normalizeContactBasis(input.contactBasis)) reasons.push('NO_BASIS');
  if (email && input.domainVerdict === 'other' && !input.domainAcked) reasons.push('DOMAIN_MISMATCH');
  if (input.suppressed) reasons.push('SUPPRESSED');
  if (input.alreadySentCompany) reasons.push('ALREADY_SENT_COMPANY');
  if (input.todayAttempts >= Math.max(0, input.dailyCap)) reasons.push('DAILY_CAP');
  if (input.requireReview && (!input.latestAssetId || input.reviewedAssetId !== input.latestAssetId)) reasons.push('NOT_REVIEWED');
  if (input.unsubLinkOk === false) reasons.push('UNSUB_LINK_STALE');
  return { locked: reasons.length > 0, reasons };
}

/** 사람에게 보여줄 잠금 문장(서버가 완성 · 화면은 그대로 쓴다) */
export const DIRECT_LOCK_MESSAGES: Record<DirectLockReason, string> = {
  DIRECT_DISABLED: '담당자 직접 발송이 아직 열리지 않았습니다(발송 단계 결재 전).',
  HASH_SECRET_MISSING: '발송 원장 비밀값(OUTREACH_HASH_SECRET)이 설정되지 않아 잠겨 있습니다.',
  NO_CONTACT: '담당자 이메일이 없거나 형식이 올바르지 않습니다.',
  NO_BASIS: '담당자 주소를 알게 된 근거(명함·기존 대화·제휴 문의 페이지 등)를 적어주세요.',
  DOMAIN_MISMATCH: '담당자 메일 도메인이 홈페이지와 다른 회사입니다. 근거를 확인한 뒤 해제할 수 있습니다.',
  SUPPRESSED: '수신거부한 주소(또는 회사)입니다. 보낼 수 없습니다.',
  ALREADY_SENT_COMPANY: '이 회사에는 이미 보낸 기록이 있습니다(마지막 발송 90일 뒤 다시 열 수 있습니다).',
  DAILY_CAP: '오늘 직접 발송 상한에 닿았습니다. 내일 다시 보낼 수 있습니다.',
  NOT_REVIEWED: '확인한 판과 최신 판이 다릅니다. 최신 메일을 확인(이 판으로 확인)한 뒤 보낼 수 있습니다.',
  UNSUB_LINK_STALE: '담당자 기준 수신거부 링크가 들어간 메일이 아닙니다. 메일 재조립 뒤 보낼 수 있습니다.',
};

// ===== 단계 판정 (§6) =====

/** 단계 규칙 한 곳(첫 기준값 · 실측으로 조정) */
export const DIRECT_STAGE_RULES = {
  stage2: { minSent: 30, maxHardBounce: 0, maxWrong: 0 },
  stage3: { minSent: 100, maxBounceRate: 0.02, maxUnsubRate: 0.01, recentWindow: 50, maxEditedRatio: 0.1, autoWindow: 30, maxAutoChanged: 0 },
  /** 사후 확인 표본 비율 · 최소 건수 */
  postReview: { ratio: 0.1, min: 1 },
  /** 자동 정지 트리거 */
  autoStop: { hardBounce: 1, dailyUnsub: 2, reviewWrong: 1 },
  /** 같은 회사 재접촉을 다시 열 수 있는 최소 경과일 */
  reopenDays: 90,
} as const;

export interface DirectStats {
  /** 외부 직접 발송 성공 누적 */
  sentTotal: number;
  /** 하드 반송(원장 rejected) 누적 */
  hardBounceTotal: number;
  /** 오발송 = 해지 사유 '담당자 아님' + 사후 확인 wrong */
  wrongTotal: number;
  /** 수신거부(사유 unsub) 누적 */
  unsubTotal: number;
  /** 최근 recentWindow 건 중 발송 전 사람 수정이 있었던 수 / 그 창의 건수 */
  recentEdited: number;
  recentCount: number;
  /** 최근 autoWindow 건의 자동 확정 발송 중 사람이 행사를 바꾼 수 */
  autoChanged: number;
  autoCount: number;
  /** 자동 정지 기록 */
  autoStopped: boolean;
}

export function directStageEnv(env: Record<string, string | undefined> = process.env): 0 | 1 | 2 | 3 {
  const n = Number(String(env.OUTREACH_DIRECT_STAGE || '0').trim());
  return n >= 3 ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0;
}

export function directDailyCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(String(env.OUTREACH_DIRECT_DAILY_CAP || '').trim());
  return Number.isFinite(n) && n >= 0 && String(env.OUTREACH_DIRECT_DAILY_CAP || '').trim() !== '' ? Math.floor(n) : 5;
}

/**
 * 유효 단계 = min(결재값, 데이터가 허락한 단계). blockers = 다음 단계가 왜 안 열리는지(화면 문장 · 서버 완성).
 */
export function evaluateDirectStage(envStage: number, s: DirectStats): { stage: 0 | 1 | 2 | 3; dataStage: 1 | 2 | 3; blockers: string[] } {
  const r2 = DIRECT_STAGE_RULES.stage2;
  const r3 = DIRECT_STAGE_RULES.stage3;
  const b2: string[] = [];
  if (s.sentTotal < r2.minSent) b2.push(`외부 발송 누적 ${s.sentTotal}/${r2.minSent}건`);
  if (s.hardBounceTotal > r2.maxHardBounce) b2.push(`하드 반송 ${s.hardBounceTotal}건`);
  if (s.wrongTotal > r2.maxWrong) b2.push(`오발송 ${s.wrongTotal}건`);
  const b3: string[] = [];
  if (s.sentTotal < r3.minSent) b3.push(`외부 발송 누적 ${s.sentTotal}/${r3.minSent}건`);
  const attempts = s.sentTotal + s.hardBounceTotal;
  if (attempts > 0 && s.hardBounceTotal / attempts >= r3.maxBounceRate) b3.push(`반송률 ${(100 * s.hardBounceTotal / attempts).toFixed(1)}%`);
  if (s.sentTotal > 0 && s.unsubTotal / s.sentTotal >= r3.maxUnsubRate) b3.push(`수신거부율 ${(100 * s.unsubTotal / s.sentTotal).toFixed(1)}%`);
  if (s.recentCount > 0 && s.recentEdited / s.recentCount > r3.maxEditedRatio) b3.push(`최근 ${s.recentCount}건 중 사람 수정 ${s.recentEdited}건`);
  if (s.autoChanged > r3.maxAutoChanged) b3.push(`자동 확정 뒤 행사 변경 ${s.autoChanged}건`);
  if (s.autoStopped) b3.push('자동 발송 정지 상태');
  if (s.wrongTotal > r2.maxWrong) b3.push(`오발송 ${s.wrongTotal}건`);
  const dataStage: 1 | 2 | 3 = b2.length ? 1 : b3.length ? 2 : 3;
  const stage = Math.max(0, Math.min(envStage, dataStage)) as 0 | 1 | 2 | 3;
  const blockers = stage >= 3 ? [] : stage === 2 ? b3 : stage === 1 ? b2 : [];
  return { stage, dataStage, blockers };
}

// ===== 자동 확정 (§7) =====

export interface AutoConfirmCandidate { benefitLicensed?: boolean; origin?: string }

/** 면허 있는 후보(카드·크롤 · 사람 입력 제외)를 후보 순서대로 앞 3개. 0개면 자동 확정하지 않는다. */
export function pickAutoConfirmIndexes(candidates: readonly AutoConfirmCandidate[] | null | undefined, max = 3): number[] {
  const out: number[] = [];
  (Array.isArray(candidates) ? candidates : []).forEach((c, i) => {
    if (out.length >= max) return;
    if (c && c.benefitLicensed === true && (c.origin === 'card' || c.origin === 'crawl')) out.push(i);
  });
  return out;
}

// ===== 단계 3 자동 발송 대상(건 조건 · §6) =====

export interface AutoSendFacts {
  /** 자동 발송(requireReview=false)으로 계산한 잠금 사유 */
  lockReasons: readonly string[];
  domainVerdict: ContactDomainVerdict;
  /** 확정 행사 중 종료일이 명시된 미래 면허가 있는가(홈 게시만의 면허 제외) */
  datedLicense: boolean;
  /** 확정 행사가 사람 붙여넣기·저장본인가 */
  manualEvent: boolean;
  /** DM 채점 두 항목(글자 잘림 0 · 첫 화면 헤드라인) — 채점 없음 = null */
  visionOk: boolean | null;
  /** 묶음 사전 승인 기록 */
  approved: boolean;
}

export function autoSendBlockers(f: AutoSendFacts): string[] {
  const out: string[] = [];
  if (!f.approved) out.push('묶음 자동 발송 승인 없음');
  if (f.lockReasons.length) out.push(`잠금 ${f.lockReasons.join(',')}`);
  if (f.domainVerdict !== 'same') out.push('담당자 도메인이 홈페이지와 같지 않음');
  if (!f.datedLicense) out.push('종료일이 명시된 진행 중 행사 없음');
  if (f.manualEvent) out.push('사람이 붙여넣은 행사');
  if (f.visionOk !== true) out.push(f.visionOk === null ? 'DM 채점 없음' : 'DM 채점 미달');
  return out;
}

/** DM 채점(visionScore) → 두 항목 통과 여부 · 채점 없음 = null */
export function visionTwoItemsOk(score: unknown): boolean | null {
  const items = score && typeof score === 'object' ? (score as any).items : null;
  if (!items || typeof items !== 'object') return null;
  return items.text_clipping_zero === true && items.first_screen_has_headline === true;
}

// ===== 사후 확인 표본 (§6) =====

/** n 건 중 표본 인덱스(비율 10% 올림 · 최소 1 · 중복 0) */
export function pickPostReviewIndexes(n: number, rand: () => number = Math.random): number[] {
  const total = Math.max(0, Math.floor(n));
  if (total === 0) return [];
  const k = Math.min(total, Math.max(DIRECT_STAGE_RULES.postReview.min, Math.ceil(total * DIRECT_STAGE_RULES.postReview.ratio)));
  const pool = Array.from({ length: total }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, k).sort((a, b) => a - b);
}

/** 같은 묶음이면 같은 표본(재시작·재계산에도 흔들리지 않게) — 씨앗 문자열 → [0,1) 난수열 */
export function seededRandom(seed: string): () => number {
  let buf = createHash('sha256').update(String(seed)).digest();
  let i = 0;
  return () => {
    if (i + 4 > buf.length) { buf = createHash('sha256').update(buf).digest(); i = 0; }
    const v = buf.readUInt32BE(i);
    i += 4;
    return v / 0x100000000;
  };
}

/** 묶음 안 이 건(1부터)이 사후 확인 표본인가 */
export function isPostReviewPick(batch: string | null | undefined, index: number, total: number): boolean {
  if (!batch || !Number.isInteger(index) || index < 1 || !Number.isInteger(total) || total < 1) return true; // 묶음 정보가 없으면 보수적으로 표본
  return pickPostReviewIndexes(total, seededRandom(batch)).includes(index - 1);
}

// ===== 수신거부 공개 페이지(불변 48 · GET = 확인 · POST = 기록) =====

const escPage = (s: string) => String(s || '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

/** 수신거부 페이지(서버 완성 · noindex · 내부 식별자 0) — confirm = 확인 폼 · done = 처리 완료 · invalid = 없는 링크(존재 추측 차단 문구) */
export function renderUnsubscribePage(input: { state: 'confirm' | 'done' | 'invalid'; companyName?: string | null; actionUrl?: string }): string {
  const head = '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>수신거부</title></head>';
  const wrap = (inner: string) => `${head}<body style="margin:0;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2937"><div style="max-width:440px;margin:48px auto;padding:28px 24px;background:#fff;border:1px solid #e5e7eb;border-radius:16px">${inner}</div></body></html>`;
  if (input.state === 'invalid') {
    return wrap('<h1 style="font-size:18px;margin:0 0 8px">링크를 확인할 수 없습니다</h1><p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0">주소가 올바르지 않거나 기간이 지난 링크입니다. 수신을 원하지 않으시면 이 메일에 회신으로 알려주세요.</p>');
  }
  if (input.state === 'done') {
    return wrap('<h1 style="font-size:18px;margin:0 0 8px">수신거부가 처리되었습니다</h1><p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0">앞으로 이 주소로 한줄로 제안 메일을 보내지 않습니다.</p>');
  }
  const company = input.companyName ? escPage(input.companyName) : '';
  return wrap(`<h1 style="font-size:18px;margin:0 0 8px">한줄로 제안 메일 수신거부</h1>`
    + `<p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 16px">아래 버튼을 누르면 수신거부가 처리됩니다.</p>`
    + `<form method="post" action="${escPage(input.actionUrl || '')}">`
    + `<label style="display:flex;gap:8px;align-items:flex-start;font-size:14px;margin:0 0 10px"><input type="checkbox" name="company" value="1" checked style="margin-top:3px">${company ? `${company} 앞으로 오는 안내 전체를 받지 않겠습니다` : '이 회사 앞으로 오는 안내 전체를 받지 않겠습니다'}</label>`
    + `<label style="display:flex;gap:8px;align-items:flex-start;font-size:14px;margin:0 0 18px"><input type="checkbox" name="not_contact" value="1" style="margin-top:3px">이 업무의 담당자가 아닙니다</label>`
    + `<button type="submit" style="width:100%;padding:12px;border:0;border-radius:10px;background:#111827;color:#fff;font-size:15px;font-weight:600;cursor:pointer">수신거부</button>`
    + `</form>`);
}

// ===== 날짜 =====

/** 한국 시각 오늘 0시(UTC ISO) — 일일 상한의 하루 경계 */
export function kstDayStartIso(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const start = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600 * 1000;
  return new Date(start).toISOString();
}
