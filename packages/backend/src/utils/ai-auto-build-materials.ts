/**
 * ★ 2026-09-14 AI 자동제작 재료 순수 코어 (설계서 docs/2026-09-14-ai-auto-build-design.md §6-1 · §6-3 · §6-4 · §6-7 · T1)
 *
 * 재료 스키마 v1(materials.version === 1) → 정규화 · 재료 지문 · 최소 재료 게이트 · 이미지 역할 판정 · 노출 스위치.
 * 이 파일은 DB·AI·네트워크·파일시스템에 닿지 않는다(순수). 조립·차감·라우트는 campaign-quick.ts · routes 가 소유한다.
 *
 * 불변(설계서 §2):
 *  - origin · licensed · source 는 클라이언트 주장이 아니라 여기서 판정한다(5). 텍스트가 있으면 user · 비면 empty. 판독본(vision)은 이 경로로 들어오지 않는다(판독→생성을 서버가 한 번에 잇는다 · §5).
 *  - 가격·링크·할인율은 정수·원문 그대로 통과한다(2). 계산(정가 대비 할인율)은 카드에 싣는 단계(T3) 몫이라 여기서는 하지 않는다.
 *  - 상품 이미지 = 몰 이미지만(5). 수동 상품의 imageUrl 은 버린다.
 *  - 이미지 URL 은 이 회사의 서빙 경로만(계약 7): DM 업로드 `/api/dm/v/images/{companyId}/` + 소재 라이브러리 `/api/cdp/inapp/image/{companyId}/`(utils/assets.ts storeAssetFile 이 만드는 접두어).
 *  - 노출 스위치 AI_AUTO_BUILD_COMPANY_IDS 는 비면 미노출(13). 현행 CAMPAIGN_MATERIALS_COMPANY_IDS(비면 전 회사)와 반대 의미라 공유하지 않는다.
 *  - 이미지 역할 지정 UI 없음(6): 순서가 기본 역할, 자격 미달은 강등, 다음 자격자 승격. 로고 판정 수치(가로세로 3:1)는 표본 실측 전 "추정"(§11) · 투명 PNG 판정은 버퍼가 있는 업로드 시점 몫이라 여기 없다.
 *
 * 상한(카드 3 · 카드당 이미지 3 · 상품 12)은 campaign-quick.ts 의 QUICK_* 와 같은 값이어야 한다. 그 파일이 T3 에서 이 파일을 import 하므로(순환 방지) 여기서는 import 하지 않고 값을 따로 둔다 · 계약 테스트가 동치를 건다.
 */
import { createHash } from 'crypto';
import { normalizeEventText } from './event-brief';
import { heroEligible, type LookImageDims } from './sales-outreach-look';
import { extractMallProductNo } from './mall-product-normalize';

/** 기능 칩 4종 = 엔진(dmAllowedTypes('customer'))이 만들 수 있는 것만(불변 7). 순서 = 화면 칩 순서. */
export const AI_AUTO_BUILD_FEATURES: readonly string[] = ['product_carousel', 'countdown', 'coupon', 'gallery'];
/** 최소 재료 게이트: 사용자 텍스트 글자 수 하한(§6-4 · 계측 뒤 조정 대상 §11) */
export const AI_AUTO_BUILD_MIN_TEXT_CHARS = 40;
export const AI_AUTO_BUILD_CARDS_MAX = 3;
export const AI_AUTO_BUILD_CARD_IMAGES = 3;
export const AI_AUTO_BUILD_PRODUCTS_MAX = 12;
/** 로고 추정 하한(폭/높이) — 미검증 수치(§11) · 화면은 "추정" 배지 */
export const AI_AUTO_BUILD_LOGO_MIN_RATIO = 3;

const MALL_PROVIDERS: readonly string[] = ['cafe24', 'naver'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_FILENAME_RE = /^[A-Za-z0-9._-]+$/;
const CARD_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const PRODUCT_CODE_RE = /^[A-Za-z0-9_-]{1,60}$/;
const TITLE_MAX = 40;
const BRAND_MAX = 60;
const PRODUCT_NAME_MAX = 120;
const URL_MAX = 500;

/** ENV 회사 목록 — 비면 **미노출**(false). 카드띠 노출 + materials v1 분기 3곳(DM 생성·이메일 생성·견적)이 같은 함수를 쓴다(§6-7). */
export function aiAutoBuildEnabled(companyId: string | null | undefined, env: string | undefined = process.env.AI_AUTO_BUILD_COMPANY_IDS): boolean {
  const list = String(env || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return false;
  return !!companyId && list.includes(String(companyId));
}

/** 요청이 v1 재료인가(version === 1). 아니면 현행 경로(옛 요청) 그대로. */
export function isBuildMaterialsV1(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).version === 1;
}

/** 이 회사의 이미지 서빙 접두어 2종(DM 업로드 · 소재 라이브러리) */
export function companyImagePrefixes(companyId: string): string[] {
  return [`/api/dm/v/images/${companyId}/`, `/api/cdp/inapp/image/${companyId}/`];
}

/** 이미지 URL 이 이 회사의 서빙 경로인가(접두어 + 파일명 문자 제한 · 다른 회사·외부·절대 URL 거부) */
export function isCompanyImageUrl(url: unknown, companyId: string): boolean {
  const s = String(url ?? '').trim();
  for (const prefix of companyImagePrefixes(companyId)) {
    if (s.startsWith(prefix)) return IMAGE_FILENAME_RE.test(s.slice(prefix.length));
  }
  return false;
}

export interface BuildImage { url: string; width: number | null; height: number | null }
export interface BuildEventCard {
  id: string;
  title: string;
  text: string;
  /** 사용자가 "그대로 씁니다" 체크 + 문구(제목 또는 내용)가 있을 때만 true */
  licensed: boolean;
  images: BuildImage[];
  link: string | null;
}
export type BuildProductSource = 'mall' | 'manual';
export type BuildMallProvider = 'cafe24' | 'naver';
export interface BuildProduct {
  source: BuildProductSource;
  provider: BuildMallProvider | null;
  /** 몰 상품번호(병합·재조회 키 · 불변 4) · manual 은 null */
  code: string | null;
  name: string;
  price: number | null;
  salePrice: number | null;
  discountRate: number | null;
  url: string | null;
  /** 몰 이미지만(불변 5) · manual 은 항상 null */
  imageUrl: string | null;
}
export type BuildChannel = 'dm' | 'email';
export interface BuildMaterials {
  version: 1;
  /** 돈 단위(불변 9) · uuid 소문자 */
  attemptToken: string;
  /** 견적 결박(§5 · 서버 견적과 다르면 409) */
  expectedTotal: number;
  channel: BuildChannel;
  /** 이메일 광고 여부 · 요청에 boolean 이 없으면 null(회사 기본값은 라우트 몫) */
  isAd: boolean | null;
  eventCards: BuildEventCard[];
  products: BuildProduct[];
  /** 허용 4종 교집합 · null = "AI가 알아서"(후처리 no-op) · [] = 전부 OFF */
  features: string[] | null;
  brandName: string | null;
  /** 서버 판정: 사용자 텍스트가 있으면 user · 비면 empty */
  origin: 'user' | 'empty';
  /** 카드 제목+내용을 합쳐 공백을 접은 사용자 텍스트(게이트·지문의 기준) */
  userText: string;
  textChars: number;
}
export type BuildNormalizeField = 'version' | 'attemptToken' | 'expectedTotal' | 'channel';
export type BuildNormalizeResult =
  | { ok: true; materials: BuildMaterials }
  | { ok: false; field: BuildNormalizeField; error: string };

function collapseWs(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}

function httpUrlOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString().slice(0, URL_MAX);
  } catch {
    return null;
  }
}

/** 양의 정수 가격(원문 그대로 · 0·음수·NaN·문자열은 null) */
function priceOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v);
}

function rateOrNull(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 100) return null;
  return Math.round(v);
}

function dimOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function normalizeImages(raw: unknown, companyId: string, max: number): BuildImage[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BuildImage[] = [];
  for (const im of list) {
    const url = String((im as Record<string, unknown> | null)?.url ?? '').trim();
    if (!isCompanyImageUrl(url, companyId)) continue;
    const r = im as Record<string, unknown>;
    out.push({ url, width: dimOrNull(r.width), height: dimOrNull(r.height) });
    if (out.length >= max) break;
  }
  return out;
}

function normalizeEventCards(raw: unknown, companyId: string): BuildEventCard[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BuildEventCard[] = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const title = collapseWs(r.title).slice(0, TITLE_MAX);
    const text = normalizeEventText(r.text);
    const images = normalizeImages(r.images, companyId, AI_AUTO_BUILD_CARD_IMAGES);
    if (!title && !text && images.length === 0) continue;
    const idRaw = String(r.id ?? '').trim();
    out.push({
      id: CARD_ID_RE.test(idRaw) ? idRaw : `card${out.length + 1}`,
      title,
      text,
      licensed: r.licensed === true && !!(text || title),
      images,
      link: httpUrlOrNull(r.link),
    });
    if (out.length >= AI_AUTO_BUILD_CARDS_MAX) break;
  }
  return out;
}

function normalizeProducts(raw: unknown): BuildProduct[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: BuildProduct[] = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const name = collapseWs(r.name).slice(0, PRODUCT_NAME_MAX);
    if (!name) continue;
    const providerRaw = String(r.provider ?? '').trim().toLowerCase();
    const codeRaw = String(r.code ?? '').trim();
    const isMall = MALL_PROVIDERS.includes(providerRaw) && PRODUCT_CODE_RE.test(codeRaw);
    out.push({
      source: isMall ? 'mall' : 'manual',
      provider: isMall ? (providerRaw as BuildMallProvider) : null,
      code: isMall ? codeRaw : null,
      name,
      price: priceOrNull(r.price),
      salePrice: priceOrNull(r.salePrice),
      discountRate: rateOrNull(r.discountRate),
      url: httpUrlOrNull(r.url),
      imageUrl: isMall ? httpUrlOrNull(r.imageUrl) : null,
    });
    if (out.length >= AI_AUTO_BUILD_PRODUCTS_MAX) break;
  }
  return out;
}

function normalizeFeatures(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const f of raw) {
    const s = String(f ?? '').trim();
    if (AI_AUTO_BUILD_FEATURES.includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * 요청 재료(v1) 정규화 — 한 곳(순수). 골격(version·attemptToken·channel·expectedTotal)이 틀리면 ok:false(400 재료) ·
 * 그 밖의 항목은 거부 대신 조용히 빠진다(응답의 개수·materialsMeta 로 드러난다 · 현행 normalizeQuickMaterials 규약).
 */
export function normalizeBuildMaterials(raw: unknown, companyId: string): BuildNormalizeResult {
  if (!isBuildMaterialsV1(raw)) return { ok: false, field: 'version', error: '요청 형식이 맞지 않아요. 화면을 새로고침한 뒤 다시 시도해 주세요.' };
  const r = raw as Record<string, unknown>;
  const tokenRaw = String(r.attemptToken ?? '').trim();
  if (!UUID_RE.test(tokenRaw)) return { ok: false, field: 'attemptToken', error: '시도 토큰이 없거나 형식이 맞지 않습니다.' };
  const channelRaw = String(r.channel ?? '').trim().toLowerCase();
  if (channelRaw !== 'dm' && channelRaw !== 'email') return { ok: false, field: 'channel', error: '채널은 모바일 DM 또는 이메일만 고를 수 있습니다.' };
  const total = r.expectedTotal;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) return { ok: false, field: 'expectedTotal', error: '견적 금액이 없거나 형식이 맞지 않습니다.' };

  const eventCards = normalizeEventCards(r.eventCards, companyId);
  const userText = collapseWs(eventCards.flatMap((c) => [c.title, c.text]).join(' '));
  return {
    ok: true,
    materials: {
      version: 1,
      attemptToken: tokenRaw.toLowerCase(),
      expectedTotal: total,
      channel: channelRaw,
      isAd: typeof r.isAd === 'boolean' ? r.isAd : null,
      eventCards,
      products: normalizeProducts(r.products),
      features: normalizeFeatures(r.features),
      brandName: collapseWs(r.brandName).slice(0, BRAND_MAX) || null,
      origin: userText ? 'user' : 'empty',
      userText,
      textChars: userText.length,
    },
  };
}

/** 카드 순서대로 편 전체 이미지(역할 판정·게이트·지문의 입력) */
export function buildImagesOf(m: Pick<BuildMaterials, 'eventCards'>): BuildImage[] {
  return m.eventCards.flatMap((c) => c.images);
}

export type BuildImageRole = 'hero' | 'photo' | 'logo' | 'unknown';
export interface BuildImageRoleJudgement {
  url: string;
  role: BuildImageRole;
  /** 히어로 자격(heroEligible 계열 · 비율 0.8 이상 · 치수 미상 = false) */
  heroEligible: boolean;
  /** 표본 실측 전 추정 판정(화면 배지 "추정") */
  estimated: true;
}

/**
 * 이미지 역할 판정(§6-3 · 순수) — 순서 = 기본(첫 자격자 = 히어로 1장) · 가로세로 3:1 이상 = 로고 추정(강등) ·
 * 치수 미상 = unknown(자격 없음 · fail-closed) · 나머지 = photo. 응답 materialsMeta.imageRoles 의 단일 출처.
 */
export function judgeImageRoles(images: readonly BuildImage[]): BuildImageRoleJudgement[] {
  const dims: LookImageDims = {};
  for (const im of images) if (im.width && im.height) dims[im.url] = { width: im.width, height: im.height };
  let heroTaken = false;
  return images.map((im): BuildImageRoleJudgement => {
    const d = dims[im.url];
    if (!d) return { url: im.url, role: 'unknown', heroEligible: false, estimated: true };
    if (d.width / d.height >= AI_AUTO_BUILD_LOGO_MIN_RATIO) return { url: im.url, role: 'logo', heroEligible: false, estimated: true };
    const eligible = heroEligible(im.url, dims);
    if (eligible && !heroTaken) {
      heroTaken = true;
      return { url: im.url, role: 'hero', heroEligible: true, estimated: true };
    }
    return { url: im.url, role: 'photo', heroEligible: eligible, estimated: true };
  });
}

/**
 * 재료 지문(§5 견적 결박 전용 · 멱등키 아님) = 정규화 텍스트 + 상품 목록(상품번호 정렬 · 수동은 이름·가격) + 이미지 역할·순서.
 * 이미지 URL(uuid 파일명)·attemptToken·expectedTotal 은 들어가지 않는다(계약 3).
 */
export function buildMaterialsHash(m: BuildMaterials, roles: readonly BuildImageRoleJudgement[]): string {
  const products = m.products
    .map((p) => (p.source === 'mall' ? `mall:${p.provider}:${p.code}` : `manual:${p.name}:${p.price ?? ''}:${p.salePrice ?? ''}:${p.discountRate ?? ''}`))
    .sort();
  const payload = { text: m.userText, products, roles: roles.map((r) => r.role) };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export type BuildMissing = 'text' | 'hero';
export type BuildGateResult = { ok: true } | { ok: false; missing: BuildMissing[] };

/**
 * 최소 재료 게이트(§6-4 · 차감 앞) — 통과 = 사용자 텍스트 40자 이상 **또는** 히어로 후보 1장 이상(= 이미지 1장 이상).
 * 미달 = 부족 항목 목록(400 + { missing } 한 줄 · 402 아님).
 */
export function checkMinimumMaterials(m: Pick<BuildMaterials, 'textChars'>, roles: readonly BuildImageRoleJudgement[]): BuildGateResult {
  const textOk = m.textChars >= AI_AUTO_BUILD_MIN_TEXT_CHARS;
  const heroOk = roles.some((r) => r.role === 'hero');
  if (textOk || heroOk) return { ok: true };
  const missing: BuildMissing[] = [];
  if (!textOk) missing.push('text');
  if (!heroOk) missing.push('hero');
  return { ok: false, missing };
}

// ===== ★ T3 돈 단위 키 · 오류 형식 · 상품 병합(순수) =====

/** 라우트가 그대로 응답하는 오류 — status(400·403·409·503) · code(화면 분기 키) · extra(missing · quote · field). 402 는 InsufficientCreditError 가 맡는다. */
export class AiAutoBuildError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown> | null;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'AiAutoBuildError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** AiAutoBuildError → 라우트 응답(status · body = success false · error · code · extra 펼침) · 그 밖의 오류 = null(호출부가 402 · 503 · 500 을 잇는다) */
export function aiAutoBuildErrorResponse(err: unknown): { status: number; body: Record<string, unknown> } | null {
  if (!(err instanceof AiAutoBuildError)) return null;
  return { status: err.status, body: { success: false, error: err.message, code: err.code, ...(err.extra || {}) } };
}

/** 동시 생성 잠금 키 = 회사 단위(§6-5 · 채널 무관 · 같은 회사가 DM·이메일을 동시에 만들지 않는다) · 잠금 배관 = utils/inflight-lock.ts */
export function buildInflightKey(companyId: string): string {
  return `ai-auto-build:${companyId}`;
}

/**
 * 돈 단위 = 시도 토큰(불변 9) + **과금 지문**(★Codex 1R·2R 0914 high 수용 · `buildBillingHash`) — 원장 멱등키.
 * 토큰만 키로 쓰면 결제한 토큰으로 재료를 바꿔 보내는 요청이 duplicate(무료)로 통과한다. 정규화 입력 전체의 지문 16자를 키에 결박해
 * "같은 재료 재시도 = 1행 · 다른 재료(이미지·면허·칩 하나라도) = 새 차감"을 원장이 지킨다(DDL 0). 초안 행 id 는 결과 참조일 뿐 키가 아니다. varchar(150) 안(102).
 */
export function buildIdempotencyKey(companyId: string, channel: BuildChannel, attemptToken: string, billingHash: string): string {
  return `quick:${companyId}:${channel}:${attemptToken}:${String(billingHash).slice(0, 16)}`;
}

/**
 * 과금용 지문(★Codex 2R 0914 high 수용) — 견적용 지문(`buildMaterialsHash` · uuid 불변 · 세 요소)과 **분리**한다.
 * 생성 결과에 영향을 주는 정규화 입력 전체(채널 · 광고 · 카드의 제목·내용·링크·면허·이미지 URL·치수 · 상품 전부 · 칩 · 브랜드명)를 넣고
 * attemptToken · expectedTotal · 카드 id(클라이언트 임의값)는 뺀다. 같은 토큰으로 이미지·면허·칩만 바꿔 보내면 다른 키 = 새 차감.
 */
export function buildBillingHash(m: BuildMaterials): string {
  const payload = {
    channel: m.channel,
    isAd: m.isAd,
    cards: m.eventCards.map((c) => ({ title: c.title, text: c.text, link: c.link, licensed: c.licensed, images: c.images.map((im) => [im.url, im.width, im.height]) })),
    products: m.products.map((p) => [p.source, p.provider, p.code, p.name, p.price, p.salePrice, p.discountRate, p.url, p.imageUrl]),
    features: m.features,
    brandName: m.brandName,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** 이미지 조합 지문(순서·중복 무관) — 판독 캐시 키·판독비 멱등키의 재료 */
export function imagesHashOf(urls: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(Array.from(new Set(urls)).sort())).digest('hex');
}

/**
 * 판독비(이미지 글자 읽기 3) 멱등키 = 회사 · 시도 토큰 · 이미지 조합 지문(★Codex 1R 0914 high 수용) — 판독은 크레딧 묶음 안에서 돌리고(AI 호출의 자체 차감 0)
 * 초안이 생긴 뒤 이 키로 원장에 차감한다. 같은 시도의 재요청은 캐시 만료·프로세스 재시작 뒤에도 duplicate(재차감 0). varchar(150) 안(11+36+1+36+1+16 = 101).
 */
export function buildReadIdempotencyKey(companyId: string, attemptToken: string, imagesHash: string): string {
  return `quick-read:${companyId}:${attemptToken}:${String(imagesHash).slice(0, 16)}`;
}

/** 몰 상품의 재조회·병합 키 = 상품번호(불변 4) — 링크에서 뽑은 번호 → 없으면 숫자 code → 없으면 null(수동 취급). */
export function mallProductNoOf(p: BuildProduct): string | null {
  if (p.source !== 'mall') return null;
  const fromUrl = extractMallProductNo(p.url);
  if (fromUrl) return fromUrl;
  return p.code && /^\d+$/.test(p.code) ? p.code : null;
}

export interface BuildMallLookupHit { status: 'ok'; name: string; price: number; salePrice: number; discountRate: number; imageUrl: string | null; productUrl: string | null }
export interface BuildMallLookupMiss { status: 'unavailable'; reason: string }
/** provider 한 곳의 재조회 결과 — failed = 몰 장애(전 항목 "가격 확인 못함") · byCode 에 없음 = 못 찾음(피커 값 유지) */
export interface BuildMallLookup { failed: boolean; byCode: Record<string, BuildMallLookupHit | BuildMallLookupMiss> }

/** 엔진 상품 카드(EngineProduct 호환 + 출처·검증 표식) — 몰 이미지가 있는 몰 상품만 카드가 된다(불변 5) */
export interface BuildProductCard {
  name: string;
  price: number | null;
  discount_price: number | null;
  image_url: string;
  link_url?: string;
  discount_rate?: number;
  source: 'mall';
  code: string;
  verified: boolean;
}
export interface ResolvedBuildProducts {
  cards: BuildProductCard[];
  /** 카드가 못 되는 상품(수동 · 이미지 없음 · 상품번호 없음)의 재료 글줄(사용자 입력 = 면허) */
  textLines: string[];
  /** 재조회로 확인 못 한 상품번호(카드에 "가격 확인 못함" 표시 · §6-5) */
  mallUnverified: string[];
  /** 품절·미전시로 제외한 상품(결과 바 사유 1줄) */
  excluded: Array<{ code: string; name: string; reason: string }>;
  mallFailed: boolean;
}

function productLineOf(name: string, price: number | null, salePrice: number | null): string {
  const fmt = (n: number) => `${n.toLocaleString('ko-KR')}원`;
  if (salePrice && price && salePrice < price) return `- ${name} ${fmt(salePrice)} (정가 ${fmt(price)})`;
  const one = salePrice || price;
  return one ? `- ${name} ${fmt(one)}` : `- ${name}`;
}

/**
 * 상품 병합(순수 · 계약 2·15) — 몰 상품은 상품번호로 1개(중복 제거) · 재조회 값이 피커 값을 덮는다(못 찾음 = 피커 값 + unverified · 품절 = 제외 + 사유 · 몰 장애 = 전 항목 unverified) ·
 * 수동·상품번호 없는 몰 상품·이미지 없는 몰 상품 = 카드 없이 글줄. 가격은 정수 원문 그대로(할인율은 원문에 있을 때만 · 없으면 렌더러가 정가 대비 계산).
 */
export function resolveBuildProducts(products: readonly BuildProduct[], lookups: Record<string, BuildMallLookup | undefined>): ResolvedBuildProducts {
  const cards: BuildProductCard[] = [];
  const textLines: string[] = [];
  const mallUnverified: string[] = [];
  const excluded: Array<{ code: string; name: string; reason: string }> = [];
  let mallFailed = false;
  const seenNo = new Set<string>();
  const seenName = new Set<string>();
  for (const p of products) {
    const no = mallProductNoOf(p);
    if (p.source === 'mall' && p.provider && no) {
      const key = `${p.provider}:${no}`;
      if (seenNo.has(key)) continue;
      seenNo.add(key);
      const lookup = lookups[p.provider];
      if (lookup?.failed) mallFailed = true;
      const hit = lookup && !lookup.failed ? lookup.byCode[no] : undefined;
      if (hit && hit.status === 'unavailable') { excluded.push({ code: no, name: p.name, reason: hit.reason }); continue; }
      const ok = hit && hit.status === 'ok' ? hit : null;
      if (!ok) mallUnverified.push(no);
      const name = ok ? ok.name : p.name;
      const price = ok ? ok.price : p.price;
      const salePrice = ok ? ok.salePrice : p.salePrice;
      const discountRate = ok ? (ok.discountRate > 0 ? ok.discountRate : null) : p.discountRate;
      const imageUrl = ok ? ok.imageUrl : p.imageUrl;
      const url = ok ? (ok.productUrl || p.url) : p.url;
      if (!imageUrl) { textLines.push(productLineOf(name, price, salePrice)); continue; }
      cards.push({
        name,
        price: price ?? salePrice ?? null,
        discount_price: price && salePrice && salePrice < price ? salePrice : null,
        image_url: imageUrl,
        ...(url ? { link_url: url } : {}),
        ...(discountRate ? { discount_rate: discountRate } : {}),
        source: 'mall',
        code: no,
        verified: !!ok,
      });
      continue;
    }
    // 수동 · 상품번호 없는 몰 상품 = 글줄(카드 X · 이름 기준 중복 제거)
    const nameKey = p.name.toLowerCase().replace(/\s+/g, '');
    if (seenName.has(nameKey)) continue;
    seenName.add(nameKey);
    textLines.push(productLineOf(p.name, p.price, p.salePrice));
  }
  return { cards, textLines, mallUnverified, excluded, mallFailed };
}
