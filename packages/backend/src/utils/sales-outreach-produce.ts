/**
 * ★ 2026-08-24 AI 영업 아웃리치 — 제작 단계 헬퍼 (이미지·재료·DM·브랜드 이메일·제안 메일 조립)
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15-5·§15-6 · ★2026-09-05 개정 = docs/2026-09-05-ai-sales-outreach-refinement-design.md
 * 상태 전이는 sales-outreach-jobs가 소유하고 이 파일은 산출물 하나를 만드는 작업 함수만 둔다(성공 반환 또는 throw — 판정·기록은 호출부).
 *
 * 규율:
 * - 회사 컨텍스트 = OUTREACH_COMPANY_ID/OUTREACH_USER_ID(ENV 고정). 미설정 = 정직 거절(자동 폴백 금지).
 * - DM 발행 = CT 직접 호출(라우트 미경유 = 미차감 · dm.ts:765 주석 확정). 발행 전 회사 자기 확인(H14).
 * - 이미지 fetch도 SSRF 가드(https 강제·DNS 사설 차단·redirect 거부·image/*·10MB) — routes/image-studio.ts
 *   /ingest-product의 가드 규약과 동일(공용 라우트는 고객 축이라 손대지 않고 이 축 CT로 둔다 · 통합 = 별도 과제).
 * - vision 인물 판정 = 보조 신호. 'person' 확정만 제외(Harold 보강 ①), 판정 불능은 사람 선택을 존중.
 * - 메일 본문 = 전달용 완성본 한 벌. 내부 URL·토큰을 이 파일 함수의 인자로 받지 않는다(H2 — 손에 없으면 샐 수 없다).
 * - ★0905 샘플 학습 층: DM·브랜드 이메일 섹션은 직원 실물 예시(few-shot · sales-outreach-exemplars)로 직접 생성한다.
 *   재료(상품·이미지·딥링크·법정 표기)는 코드가 채우고, 면허 밖 혜택 수치는 sanitizeDmCopyBenefits가 기계로 걷어낸다(불변 22).
 * - ★0905 조립 함수 분할(A-2): 순수 조립(buildProposalEmailSections · 한글 리터럴 0 · 문구는 style.emailCopy) ↔ AI 호출(generateSubjectIntro)
 *   ↔ 진입점(assembleProposalEmail = 조립 + 렌더 + 평문 + placeholder 합산).
 */
import * as fs from 'fs';
import * as net from 'net';
import * as dns from 'dns';
import * as https from 'https';
import { callAIWithFallback } from '../services/ai';
import { stripUnauthorizedBenefits, BENEFIT_PLACEHOLDER } from './copy-benefit-detector';
import { getActiveStyleGuide, type OutreachStyleGuide } from './sales-outreach-style';
import {
  isStudioReady, writeTempBuffer, allocTempPath, writeTempMeta, findTempFile, moveTempToPermanent,
  removeBackground, composeImage, generatePoster, buildPosterPrompt, resolvePreset,
  companyTempUsageBytes, STUDIO_TEMP_CAP_BYTES,
} from './image-studio';
import { STUDIO_TEMPLATES, type StudioTemplate, type TemplateCategory } from './image-studio-templates';
import { extractJson, DM_EDITABLE_TEXT_KEYS } from './dm/dm-ai';
import { createDm, publishDm } from './dm/dm-builder';
import { renderEmailSections, EMAIL_FOOTER_SLOT } from './email/email-section-renderer';
import { getDefaultProps, type Section, type SectionType } from './dm/dm-section-registry';
import { industryLabel, isIndustryCode, INDUSTRY_CODES, type IndustryCode } from './industry-codes';
import type { EventCandidate } from './sales-outreach-jobs';
// ★ 2026-09-03 참조 골격(설계서 §6-3) — 아웃리치 파일이 읽고 감산해 구성 힌트로 넘긴다(공용 CT는 아웃리치 사정을 모른다 · 불변 20)
import { getStructureSkeleton } from './best-copy-assets';
import { pickVariant, resolveStructure, seedDateKey, type Avail } from './dm/dm-structure-resolve';
import { OUTREACH_SEED_SKELETON_ID, outreachSeedSkeleton } from './sales-outreach-skeleton-seed';
import { pruneEmptyDmSections, rebuildDmPages } from './dm/dm-section-prune';
// ★ 2026-09-05(3) 브레인스토밍 수렴안 — 룩 배정(C1)·검수 축(C4) 순수 CT. 룩은 섹션 최상위에 코드가 입히고, 사람 편집(재료 선택·섹션 숨김)은 override 데이터로 재적용한다.
import { applyOutreachLook, buildOutreachBrandKit, outreachArtDirection, lookStatsOf, accessiblePrimaryOf, LANDSCAPE_RATIO, OUTREACH_DM_LAYOUT_MODE, type LookImageDims, type OutreachLookStats } from './sales-outreach-look';
import { splitSectionsIntoPages } from './dm/dm-page-split';
import { applyOutreachMediaSelection, applySectionOverrides, type OutreachMediaSelection, type SectionOverride } from './sales-outreach-review';
import { kstDateTag } from './ai-credit-calc';
import {
  pickOutreachExemplarsDetail, OUTREACH_GENERATION_RULES,
  OUTREACH_DM_SECTION_CONTRACT, OUTREACH_EMAIL_SECTION_CONTRACT, OUTREACH_DM_TYPES, OUTREACH_EMAIL_TYPES,
} from './sales-outreach-exemplars';
import {
  collectProductsFromLinks, fetchProductPageGuarded, measureAndStoreImage, pickStoredImagesDetail, productKey,
  OUTREACH_GALLERY_MIN_WIDTH, OUTREACH_PRODUCT_MIN_WIDTH, OUTREACH_CTA_KEYWORDS, OUTREACH_GALLERY_DEADLINE_MS,
  type OutreachProduct, type StoredImage,
} from './sales-outreach-media';
// ★ 2026-09-05 실물 예시 원천 = DB(베스트 구성에서 올린 실물 · 5분 캐시) + seed. async에서 읽어 순수 프롬프트 빌더에 주입한다(pickOutreachStructure와 같은 형태).
import { loadOutreachExemplarSource } from './sales-outreach-examples';

export type ExemplarSource = Record<string, readonly string[]>;

// ===== 회사 컨텍스트 (ENV 고정 — §15-6) =====

export function getOutreachContext(): { companyId: string; userId: string } | null {
  const companyId = (process.env.OUTREACH_COMPANY_ID || '').trim();
  const userId = (process.env.OUTREACH_USER_ID || '').trim();
  return companyId && userId ? { companyId, userId } : null;
}

export const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');

/** 공개 샘플 페이지 수명(일) — 기산점은 메일 발송 성공 시각(H15). 상수 1곳 소유. */
export const OUTREACH_PREVIEW_DAYS = 30;

// ===== 이미지 수급 (SSRF 가드 fetch — H8) =====

function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6(::ffff:x.y.z.w)는 IPv4로 환원해 같은 판정기를 태운다 — prefix 몇 개만 나열하면
  // ::ffff:169.254.* 등 누락 범위가 그대로 통과한다(Codex 1R high).
  const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const low = ip.toLowerCase();
  return low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
}

/** 가드 이미지 다운로드 — 실패는 null(사유 로그만). 리다이렉트는 SSRF 우회 경로라 거부.
 *  검증한 DNS 주소를 **연결에 고정**한다(host=검증 IP · servername/Host=원 호스트) — 검사 때 공인 IP,
 *  연결 때 사설 IP를 돌려주는 DNS 재해석(rebinding) 차단(Codex 2R high · dm-brand-extractor requestPinned와 같은 규약).
 *  타이머·누적 상한은 본문 소비가 끝날 때까지 유지한다(Codex 1R high).
 *  ★ 2026-09-05 referer 옵션: 핫링크를 막는 CDN에 사이트 주소를 Referer로 준다(프로토 실측 · 재료 이미지 수집 경로). */
export async function fetchImageGuarded(rawUrl: string, opts?: { referer?: string }): Promise<{ buffer: Buffer; mime: string; ext: string } | null> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;

  const host = parsed.hostname.toLowerCase();
  let pinnedIp: string;
  try {
    const addrs = net.isIP(host) ? [host] : (await dns.promises.lookup(host, { all: true })).map((a) => a.address);
    if (addrs.length === 0 || addrs.some((ip) => isPrivateIp(ip))) return null;
    pinnedIp = addrs[0];
  } catch (err: any) {
    console.log('[sales-outreach] 이미지 호스트 해석 실패:', err?.message);
    return null;
  }

  const MAX_BYTES = 10 * 1024 * 1024;
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: { buffer: Buffer; mime: string; ext: string } | null) => {
      if (!settled) { settled = true; clearTimeout(wall); resolve(v); }
    };
    const req = https.request({
      host: pinnedIp,               // 연결은 검증된 IP로 고정
      servername: host,             // TLS SNI = 원 호스트(인증서 검증 유지)
      port: parsed.port ? Number(parsed.port) : 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        Host: host,
        'User-Agent': 'Mozilla/5.0 (compatible; HanjulBot/1.0)',
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        ...(opts?.referer ? { Referer: opts.referer } : {}),
      },
      timeout: 10_000,              // 소켓 유휴 타임아웃
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 || status < 200) { res.resume(); req.destroy(); done(null); return; } // 리다이렉트 포함 거부
      const ctype = String(res.headers['content-type'] || '').toLowerCase();
      if (!ctype.startsWith('image/')) { res.resume(); req.destroy(); done(null); return; }
      const clen = Number(res.headers['content-length'] || 0);
      if (clen && clen > MAX_BYTES) { res.resume(); req.destroy(); done(null); return; }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > MAX_BYTES) { req.destroy(); done(null); return; } // 누적 상한 — 초과 즉시 끊는다
        chunks.push(c);
      });
      res.on('end', () => {
        const mime = ctype.split(';')[0].trim();
        const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpeg';
        done({ buffer: Buffer.concat(chunks), mime, ext });
      });
      res.on('error', () => done(null));
    });
    // 벽시계 마감 — 유휴 타임아웃만으로는 느리게 흐르는 응답을 못 끊는다
    const wall = setTimeout(() => { req.destroy(); done(null); }, 20_000);
    req.on('timeout', () => { req.destroy(); done(null); });
    req.on('error', (err) => { console.log('[sales-outreach] 이미지 다운로드 실패:', err?.message); done(null); });
    req.end();
  });
}

// ===== vision 인물 판정 (보조 신호 — 4값 · H6) =====

export type PersonJudge = 'person' | 'none' | 'undetermined' | 'unavailable';

async function judgePersonInImage(base64: string, mime: string): Promise<PersonJudge> {
  try {
    const raw = await callAIWithFallback({
      system: '이미지에 실존 인물(사람의 얼굴이나 신체)이 보이는지만 판정한다. 마네킹·일러스트·조각상은 인물이 아니다. 답은 person, none, undetermined 세 단어 중 정확히 하나만 출력한다.',
      userMessage: '판정해라.',
      maxTokens: 10,
      temperature: 0,
      source: 'sales-outreach-person-check',
      images: [{ media_type: mime, data: base64 }],
    });
    const t = raw.trim().toLowerCase();
    if (t.includes('person')) return 'person';
    if (t.includes('none')) return 'none';
    return 'undetermined';
  } catch (err: any) {
    console.log('[sales-outreach] 인물 판정 불가(장애):', err?.message);
    return 'unavailable'; // 장애는 "판정 못함"과 다른 값 — 사람 선택을 존중하고 배지만
  }
}

// ===== 템플릿 선택 (★ A-4 업종 15종 매핑 · 결정적 — 같은 (jobId, seq) = 같은 결과) =====

/** 업종 → {제품(누끼 있음) 카테고리, 행사(누끼 없음) 카테고리}. 초안 표(설계서 A-4 · 시장 판단은 Harold). 이름은 TemplateCategory 유니온과 글자 단위 일치. */
export const INDUSTRY_TEMPLATE_MAP: Record<IndustryCode, { product: TemplateCategory[]; event: TemplateCategory[] }> = {
  fashion: { product: ['패션'], event: ['시즌·명절 행사'] },
  beauty:  { product: ['뷰티'], event: ['멤버십·고객감사'] },
  food:    { product: ['카페·음료', '신메뉴·팝'], event: ['팝업·페스티벌'] },
  health:  { product: ['미니멀'], event: ['멤버십·고객감사'] },
  home:    { product: ['미니멀'], event: ['시즌·명절 행사'] },
  digital: { product: ['세일·이벤트'], event: ['오픈·기념일'] },
  baby:    { product: ['시즌'], event: ['데이·기념일'] },
  pet:     { product: ['세일·이벤트'], event: ['데이·기념일'] },
  edu:     { product: ['미니멀'], event: ['클래스·체험'] },
  travel:  { product: ['시즌'], event: ['시즌·명절 행사'] },
  sports:  { product: ['세일·이벤트'], event: ['팝업·페스티벌'] },
  culture: { product: ['미니멀'], event: ['클래스·체험'] },
  finance: { product: ['미니멀'], event: ['멤버십·고객감사'] },
  service: { product: ['세일·이벤트'], event: ['오픈·기념일'] },
  etc:     { product: ['세일·이벤트'], event: ['팝업·페스티벌'] },
};

/** 모듈 로드 시 1회 파생. 빈 풀 판정은 계약 테스트가 소유한다(import 시점 throw 금지 — app 부팅 체인). */
export const TEMPLATE_POOLS: Record<IndustryCode, { product: StudioTemplate[]; event: StudioTemplate[] }> = Object.fromEntries(
  INDUSTRY_CODES.map((code) => [code, {
    product: STUDIO_TEMPLATES.filter((t) => (t.kind ?? 'product') === 'product' && INDUSTRY_TEMPLATE_MAP[code].product.includes(t.category)),
    event: STUDIO_TEMPLATES.filter((t) => t.kind === 'event' && INDUSTRY_TEMPLATE_MAP[code].event.includes(t.category)),
  }]),
) as Record<IndustryCode, { product: StudioTemplate[]; event: StudioTemplate[] }>;

function hashSeed(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function pickTemplate(industry: string | null | undefined, seed: string, needProduct: boolean): StudioTemplate {
  const code: IndustryCode = isIndustryCode(industry) ? industry : 'etc';
  const wantKind = needProduct ? 'product' : 'event';
  let pool = TEMPLATE_POOLS[code][wantKind];
  if (pool.length === 0) pool = STUDIO_TEMPLATES.filter((t) => (t.kind ?? 'product') === wantKind);
  if (pool.length === 0) pool = STUDIO_TEMPLATES;
  return pool[hashSeed(seed) % pool.length];
}

// ===== 재료 수집 (★ A-10b 이미지 실측·격상·사본 — 프로토 실측으로 확정된 규칙) =====

export interface OutreachMediaProduct extends OutreachProduct {
  /** 사본 폭·높이(실측) */
  width: number;
  height: number;
  /** 원 출처 이미지 URL(고지·근거) — image_url은 우리 사본 */
  srcImageUrl: string;
}

export interface OutreachMedia {
  /** 폭 ≥ 600 통과 · 면적 큰 순 · 최대 8장(우리 사본 URL) */
  gallery: StoredImage[];
  /** 이미지 폭 ≥ 400 통과 상품 · 최대 6개 */
  products: OutreachMediaProduct[];
  collectedAt: string;
  stats: {
    galleryCandidates: number; galleryPassed: number; productLinks: number; productsFound: number; productsPassed: number;
    /** ★ 0905(3) C3-2 순차 fetch 시도 수 · 벽시계 예산 초과 여부 · 수집 소요(ms) — 옛 기록에는 없다 */
    galleryTried?: number; galleryTimedOut?: boolean; elapsedMs?: number;
  };
}

/**
 * 후보를 서버가 직접 받아 폭·높이를 읽고(갤러리 ≥600 · 상품 ≥400 미만 탈락), 상품은 목록 썸네일 대신 상세 페이지 og:image로 격상하고,
 * 통과분을 우리 저장소에 사본으로 저장한다(핫링크 0 · 파기 시 함께 삭제). 네트워크는 순차(상대 사이트 예의).
 */
export async function collectOutreachMedia(input: {
  companyId: string;
  homepageUrl: string;
  imageCandidates: string[];
  productLinks: string[];
  listProducts: OutreachProduct[];
}): Promise<OutreachMedia> {
  const referer = input.homepageUrl;
  const fetcher = (u: string) => fetchImageGuarded(u, { referer });
  const store = (buffer: Buffer, meta: { ext: string; mime: string; width: number; height: number }): string | null => {
    const tempId = writeTempBuffer(input.companyId, buffer, { kind: 'source', ext: meta.ext, mime: meta.mime, width: meta.width, height: meta.height });
    const moved = moveTempToPermanent(input.companyId, tempId);
    return moved ? PUBLIC_BASE + moved.url : null;
  };
  let host = '';
  try { host = new URL(input.homepageUrl).hostname; } catch { host = ''; }

  const t0 = Date.now();
  // ★ 0905(3) C3-2 후보가 24개로 늘면 순차 fetch가 최대 24회 → 벽시계 예산 + 시도 수를 함께 기록한다(잡 CT 상한 12→24 정정과 한 커밋)
  const galleryPick = await pickStoredImagesDetail(input.imageCandidates, 8, OUTREACH_GALLERY_MIN_WIDTH, fetcher, store, { deadlineMs: OUTREACH_GALLERY_DEADLINE_MS });
  const gallery = galleryPick.images;

  const fromPages = host ? await collectProductsFromLinks(input.productLinks, host, 6) : [];
  const pageKeys = new Set(fromPages.map(productKey));
  const merged: OutreachProduct[] = [...fromPages];
  for (const p of input.listProducts) {
    const k = productKey(p);
    if (pageKeys.has(k)) continue;
    pageKeys.add(k);
    merged.push(p);
    if (merged.length >= 10) break;
  }
  const products: OutreachMediaProduct[] = [];
  const fromPageSet = new Set(fromPages);
  for (const p of merged) {
    if (products.length >= 6) break;
    let info = await measureAndStoreImage(p.image_url, OUTREACH_PRODUCT_MIN_WIDTH, fetcher, store);
    let name = p.name; let price = p.price; let discount = p.discount_price;
    if (!info && !fromPageSet.has(p) && host) {
      // 목록 썸네일이 저해상 → 상세 og:image로 격상(1홉)
      const pg = await fetchProductPageGuarded(p.link_url, host);
      if (pg && pg.image_url !== p.image_url) {
        info = await measureAndStoreImage(pg.image_url, OUTREACH_PRODUCT_MIN_WIDTH, fetcher, store);
        if (info) { name = pg.name || name; price = pg.price ?? price; discount = pg.discount_price ?? discount; }
      }
    }
    if (!info) continue;
    products.push({ name, price, discount_price: discount, link_url: p.link_url, image_url: info.url, srcImageUrl: info.srcUrl, width: info.width, height: info.height });
  }
  return {
    gallery,
    products,
    collectedAt: new Date().toISOString(),
    stats: {
      galleryCandidates: input.imageCandidates.length,
      galleryPassed: gallery.length,
      productLinks: input.productLinks.length,
      productsFound: merged.length,
      productsPassed: products.length,
      galleryTried: galleryPick.tried,
      galleryTimedOut: galleryPick.timedOut,
      elapsedMs: Date.now() - t0,
    },
  };
}

// ===== 대표 이미지 제작 (수급→인물 보조판정→누끼→포스터→JPEG 공개 URL) =====

// rembg py 서비스가 단일 워커라 아웃리치는 동시 1건만(고객 스튜디오와 경합 최소화 — 회의 확정)
let imageInFlight = false;

export interface OutreachImageResult {
  publicUrl: string;      // 절대 URL(이메일 임베드용)
  usedCutout: boolean;
  personJudge: PersonJudge | null;
  skippedReason: string | null; // 선택 이미지를 못 쓴 사유(있으면 화면 표시)
  width: number;
  height: number;
  /** ★ A-4 근거 패널·실측 수단 */
  templateId: string;
  category: string;
  kind: 'product' | 'event';
}

export async function produceOutreachImage(input: {
  jobId: string;
  companyName: string;
  industry: string | null;
  selectedImageUrl: string | null;
  /** ★ B-3 재생성 순번(최초 0) — 같은 (jobId, seq) = 같은 템플릿 · 다시 만들면 다른 템플릿 */
  regenSeq?: number;
  /** ★ A-3(5) 브랜드 색 힌트(미검증 · 실측 1건 뒤 유지 결정) */
  brandColor?: string | null;
}): Promise<OutreachImageResult> {
  const ctx = getOutreachContext();
  if (!ctx) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
  if (!isStudioReady()) throw new Error('이미지 생성 서비스가 준비되지 않았습니다.');
  if (imageInFlight) throw new Error('다른 이미지 제작이 진행 중입니다. 잠시 후 재시도해주세요.');
  // ★ C-7 임시 저장 용량 게이트 — 락 교체는 하지 않는다
  if (companyTempUsageBytes(ctx.companyId) > STUDIO_TEMP_CAP_BYTES) {
    throw new Error('이미지 임시 저장 용량이 가득 찼습니다. 잠시 후 다시 시도해주세요.');
  }
  imageInFlight = true;
  try {
    let cutout: { base64: string; mime: string } | null = null;
    let personJudge: PersonJudge | null = null;
    let skippedReason: string | null = null;

    if (input.selectedImageUrl) {
      const img = await fetchImageGuarded(input.selectedImageUrl);
      if (!img) {
        skippedReason = '선택한 이미지를 내려받지 못해 생성 이미지로만 제작했습니다.';
      } else {
        personJudge = await judgePersonInImage(img.buffer.toString('base64'), img.mime);
        if (personJudge === 'person') {
          // Harold 보강 ① — 인물 확정만 기계가 제외한다(마네킹·일러스트 오탐은 none으로 통과)
          skippedReason = '인물이 포함된 것으로 판정되어 해당 이미지는 사용하지 않았습니다.';
        } else {
          const srcTempId = writeTempBuffer(ctx.companyId, img.buffer, { kind: 'source', ext: img.ext, mime: img.mime, width: null, height: null });
          const src = findTempFile(ctx.companyId, srcTempId);
          if (!src) throw new Error('임시 저장소 기록에 실패했습니다.');
          const cut = allocTempPath(ctx.companyId, 'png');
          const { width, height } = await removeBackground(src.absPath, cut.absPath);
          if (Math.min(width, height) < 300) {
            // 해상도 게이트 — 저해상 누끼를 포스터 히어로로 쓰면 뭉갠다(디자이너 R9)
            skippedReason = '이미지 해상도가 낮아 생성 이미지로만 제작했습니다.';
          } else {
            writeTempMeta(ctx.companyId, cut.tempId, { kind: 'cutout', ext: 'png', mime: 'image/png', width, height });
            cutout = { base64: fs.readFileSync(cut.absPath).toString('base64'), mime: 'image/png' };
          }
        }
      }
    }

    const template = pickTemplate(input.industry, `${input.jobId}:${input.regenSeq || 0}`, !!cutout);
    const preset = resolvePreset('poster');
    const prompt = buildPosterPrompt({
      template,
      preset,
      texts: { title: input.companyName }, // 사실 문구(업체명)만 verbatim — 혜택 수치 렌더 금지 축
      hasProduct: !!cutout,
      userHint: input.brandColor ? `brand accent color ${input.brandColor}` : null,
    });
    const poster = await generatePoster(prompt, preset, cutout);

    const posterExt = poster.mime.includes('png') ? 'png' : 'jpeg';
    const posterTempId = writeTempBuffer(ctx.companyId, Buffer.from(poster.base64, 'base64'),
      { kind: 'poster', ext: posterExt, mime: poster.mime, prompt, presetKey: 'poster', channelSpec: 'poster', width: null, height: null });
    const posterFile = findTempFile(ctx.companyId, posterTempId);
    if (!posterFile) throw new Error('포스터 임시 저장에 실패했습니다.');

    // 이메일 삽입은 JPEG만(알파 PNG 직삽 금지 — 다크 클라이언트 흰 프린지·용량)
    const out = allocTempPath(ctx.companyId, 'jpeg');
    const composed = await composeImage({ bgPath: posterFile.absPath, cutoutPath: null, outPath: out.absPath, format: 'jpeg' });
    writeTempMeta(ctx.companyId, out.tempId, { kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', width: composed.width, height: composed.height });
    const moved = moveTempToPermanent(ctx.companyId, out.tempId);
    if (!moved) throw new Error('이미지 저장에 실패했습니다.');

    return {
      publicUrl: PUBLIC_BASE + moved.url,
      usedCutout: !!cutout,
      personJudge,
      skippedReason,
      width: composed.width,
      height: composed.height,
      templateId: template.id,
      category: template.category,
      kind: template.kind === 'event' ? 'event' : 'product',
    };
  } finally {
    imageInFlight = false;
  }
}

// ===== placeholder 계수 (★ A-7 세는 곳은 이 함수 하나 — 게이트·화면은 숫자만 읽는다) =====

export function countBenefitPlaceholders(text: string | null | undefined): number {
  const s = String(text || '');
  if (!s) return 0;
  return s.split(BENEFIT_PLACEHOLDER).length - 1;
}

// ===== DM·브랜드 이메일 섹션 생성 (★0905 샘플 few-shot · 재료 용량 · 규칙) =====

export interface OutreachGenInput {
  companyName: string;
  industry: string | null;
  homepageUrl: string;
  siteTitle: string | null;
  /** 프롬프트 재료(면허 밖 혜택 자리를 지운 본문 · 최대 6000) */
  material: string;
  /** 담당자 추가 정보(사람이 쓴 사실 · 인용 면허 없음) */
  extraNotes?: string | null;
  products: Array<Pick<OutreachProduct, 'name' | 'price' | 'discount_price'>>;
  /** 실측 통과 갤러리 이미지 수 */
  galleryCount: number;
  /** 참조 골격이 준 구성 순서 힌트(없으면 예시 리듬) */
  skeletonTypes?: readonly string[] | null;
}

/** 사용자 메시지(순수) — 재료 블록 + 재료 용량. */
export function buildOutreachMaterialBlock(i: OutreachGenInput, want: string, channel: 'DM' | 'EMAIL'): string {
  // 상품 묶음 = 한 묶음에 최대 6개(직원 실물 = 6개 카드 스와이프) · 8개 이상일 때만 2묶음 · 갤러리 = 배너 2장씩(히어로 1장 제외)
  const carousels = i.products.length >= 8 ? 2 : i.products.length >= 2 ? 1 : 0;
  const perGallery = channel === 'DM' ? 2 : 2;
  const galleries = Math.min(2, Math.floor(Math.max(0, i.galleryCount - 1) / perGallery));
  const hasDiscount = i.products.some((p) => p.discount_price);
  const fmt = (n: number | null) => (n === null || n === undefined ? '' : `${Number(n).toLocaleString()}원`);
  return [
    `[대상 업체] ${i.companyName} (업종: ${industryLabel(i.industry)}) · 홈페이지: ${i.homepageUrl}${i.siteTitle ? ` · 사이트 제목: ${i.siteTitle}` : ''}`,
    `[홈페이지에서 읽은 내용]\n${(i.material || '').slice(0, 6000)}`,
    i.extraNotes ? `[담당자 추가 정보]\n${i.extraNotes.slice(0, 2000)}` : '',
    i.products.length
      ? `[수집한 상품 ${i.products.length}개 · 이름은 이 목록에서만]\n${i.products.map((p, n) => `${n + 1}. ${p.name} (${p.discount_price ? `${fmt(p.discount_price)} · 정가 ${fmt(p.price)}` : fmt(p.price)})`).join('\n')}`
      : '[수집한 상품] 없음(product_carousel은 넣지 마라)',
    `[재료 용량] 실측 통과 이미지 ${i.galleryCount}장 → gallery 최대 ${galleries}개 · 상품 ${i.products.length}개 → product_carousel 최대 ${carousels}개(각 2개 이상 · 한 묶음 최대 6개) · cta는 2~3개(첫 상품 묶음 뒤 1개 · 마지막 1개) · ${hasDiscount ? '상품에 혜택가가 있다' : '상품 혜택가를 확보하지 못했다: 할인율·최대혜택 같은 표현을 헤드라인에 쓰지 마라'}`,
    i.skeletonTypes && i.skeletonTypes.length ? `[참고 구성 순서] ${i.skeletonTypes.join(' → ')} (재료가 없는 섹션은 빼도 된다)` : '',
    want,
  ].filter(Boolean).join('\n\n');
}

export interface SectionsPrompt { system: string; user: string; exemplars: { picked: number; total: number } }

/** DM 프롬프트(순수). source 미지정 = seed. exemplars.picked = 실제로 실린 예시 수(근거 문구는 이 값). */
export function buildDmSectionsPrompt(i: OutreachGenInput, source?: ExemplarSource): SectionsPrompt {
  const ex = pickOutreachExemplarsDetail('DM', i.industry, source ? { source } : undefined);
  const system = [
    '너는 국내 브랜드의 모바일 DM(모바일 랜딩 페이지) 기획자다. 아래 예시는 실제 마케터가 만든 실물의 구성과 문구다(브랜드·상품·혜택·링크는 〔〕로 가려져 있다).',
    OUTREACH_DM_SECTION_CONTRACT,
    OUTREACH_GENERATION_RULES,
    '[출력] {"sections":[{"type":"header","props":{...}}, ...]} · 섹션 7~11개 · 순서는 예시의 리듬을 따르되 재료가 없는 섹션은 넣지 않는다.',
    ex.text ? `[예시]\n${ex.text}` : '',
  ].filter(Boolean).join('\n\n');
  return { system, user: buildOutreachMaterialBlock(i, '위 업체의 모바일 DM 섹션 구성을 JSON으로 설계하라.', 'DM'), exemplars: { picked: ex.picked, total: ex.total } };
}

/** 브랜드 이메일 프롬프트(순수). source 미지정 = seed. */
export function buildEmailSectionsPrompt(i: OutreachGenInput, source?: ExemplarSource): SectionsPrompt {
  const ex = pickOutreachExemplarsDetail('EMAIL', i.industry, source ? { source } : undefined);
  const system = [
    '너는 국내 브랜드의 비주얼 이메일 기획자다. 아래 예시는 실제 마케터가 만든 실물의 블록 구성·제목·문구다(브랜드·상품·혜택·링크는 〔〕로 가려져 있다).',
    OUTREACH_EMAIL_SECTION_CONTRACT,
    OUTREACH_GENERATION_RULES,
    '[출력] {"subject":"제목(30자 이내)","preheader":"수신함 미리보기(40자 이내)","sections":[{"type":"header","props":{...}}, ...]} · 블록 6~10개 · header로 시작.',
    ex.text ? `[예시]\n${ex.text}` : '',
  ].filter(Boolean).join('\n\n');
  return { system, user: buildOutreachMaterialBlock(i, '위 업체의 이메일 블록 구성과 제목을 JSON으로 설계하라.', 'EMAIL'), exemplars: { picked: ex.picked, total: ex.total } };
}

function mkSection(type: string, props: Record<string, unknown>, order: number, idPrefix: string): Section {
  return {
    id: `${idPrefix}-${order}-${type}`,
    type,
    order,
    visible: true,
    props: { ...((getDefaultProps(type as SectionType) as unknown as Record<string, unknown>) || {}), ...props },
  } as unknown as Section;
}

/** AI 응답 JSON → 허용 타입만 남긴 Section[] (순수). */
export function sectionsFromAiJson(json: unknown, allowedTypes: readonly string[], idPrefix: string): Section[] {
  const list = Array.isArray((json as any)?.sections) ? (json as any).sections : [];
  return list
    .filter((s: any) => s && typeof s === 'object' && allowedTypes.includes(String(s.type)))
    .map((s: any, i: number) => mkSection(String(s.type), (s.props && typeof s.props === 'object') ? s.props : {}, i, idPrefix));
}

async function generateSections(prompt: { system: string; user: string }, allowedTypes: readonly string[], source: string, idPrefix: string): Promise<{ sections: Section[]; raw: any }> {
  const text = await callAIWithFallback({
    system: prompt.system,
    userMessage: prompt.user,
    maxTokens: 3500,
    temperature: 0.6,
    source,
  });
  const raw = extractJson<any>(text);
  const sections = sectionsFromAiJson(raw, allowedTypes, idPrefix);
  if (sections.length === 0) throw new Error('AI가 섹션을 돌려주지 않았습니다.');
  return { sections, raw };
}

// ===== 재료 채우기 (순수) =====

export interface OutreachFillImage { url: string; width?: number; height?: number }

export interface OutreachFillMedia {
  posterUrl: string | null;
  /** 포스터 실측 크기(히어로 비율 판정 · 세로형이면 contain) */
  posterSize?: { width: number; height: number } | null;
  /** 실측 통과 사본(폭·높이 동승 — 비율 군 분류·룩 배정에 쓴다). 문자열 배열도 받는다(비율 미상 = square 취급). */
  gallery: Array<OutreachFillImage | string>;
  products: OutreachProduct[];
  ctaLinks: Record<string, string>;
  homepageUrl: string;
  legal: { legal: string | null; csPhone: string | null } | null;
  companyName: string;
}

/** 갤러리 이미지 비율 군 — 같은 군끼리 한 묶음(직원 실물 갤러리가 균일한 이유 · 수렴안 C2-3). 비율 미상 = square. */
export type AspectClass = 'landscape' | 'portrait' | 'square';
export function aspectClassOf(img: OutreachFillImage): AspectClass {
  if (!(img.width && img.height)) return 'square';
  const r = img.width / img.height;
  if (r >= LANDSCAPE_RATIO) return 'landscape';
  if (r <= 1 / LANDSCAPE_RATIO) return 'portrait';
  return 'square';
}
const toFillImage = (x: OutreachFillImage | string): OutreachFillImage => (typeof x === 'string' ? { url: x } : x);

/** 갤러리 이미지 링크(수렴안 C2-1) — 코너 딥링크(기획전·이벤트·컬렉션·신상·베스트·룩북·세일 순) 없으면 홈. 두 렌더러가 link_url을 이미 읽는다. */
const GALLERY_LINK_KEYS: readonly string[] = ['기획전', '이벤트', '컬렉션', '신상', '베스트', '룩북', '세일'];
export function galleryLinkOf(media: Pick<OutreachFillMedia, 'ctaLinks' | 'homepageUrl'>): string {
  for (const k of GALLERY_LINK_KEYS) if (media.ctaLinks[k]) return media.ctaLinks[k];
  return media.homepageUrl;
}

/**
 * CTA 채우기 — 라벨 키워드 → 딥링크, 없으면 홈. ★ 0905(3) C2-2 같은 URL 재바인딩: 앞 CTA(또는 같은 CTA의 앞 버튼)가 이미 쓴 URL이면
 * 남은 딥링크로 바꾸고, 남은 것이 없으면 그 버튼을 뺀다(섹션은 남긴다 · cta는 ALWAYS_KEEP). 첫 버튼은 중복이어도 남긴다(빈 CTA 금지).
 */
function fillCta(buttons: unknown, media: OutreachFillMedia, maxLabel: number, used: Set<string>): Array<{ label: string; url: string; style: string }> {
  const list = Array.isArray(buttons) && buttons.length ? buttons : [{ label: '자세히 보기' }];
  const out: Array<{ label: string; url: string; style: string }> = [];
  for (const b of list.slice(0, 2)) {
    const label = String((b as any)?.label || '자세히 보기').slice(0, maxLabel);
    const kw = OUTREACH_CTA_KEYWORDS.find((k) => label.includes(k));
    const deep = kw ? media.ctaLinks[kw] || null : null;
    let url = deep || media.homepageUrl;
    let finalLabel = deep || !kw ? label : `${media.companyName} 바로가기`.slice(0, maxLabel);
    if (used.has(url)) {
      const alt = Object.entries(media.ctaLinks).find(([, u]) => !!u && !used.has(u));
      if (alt) { url = alt[1]; finalLabel = `${alt[0]} 보기`.slice(0, maxLabel); }
      else if (!used.has(media.homepageUrl)) { url = media.homepageUrl; finalLabel = `${media.companyName} 바로가기`.slice(0, maxLabel); }
      else if (out.length > 0) continue;
    }
    used.add(url);
    out.push({ label: finalLabel, url, style: 'primary' });
  }
  return out;
}

function toProductItems(ps: OutreachProduct[]) {
  return ps.map((x) => ({
    image_url: x.image_url, name: x.name, price: x.price || 0,
    ...(x.discount_price ? { discount_price: x.discount_price } : {}),
    link_url: x.link_url,
  }));
}

/**
 * ★ 2026-09-05 DM·이메일 재료 채우기(순수) — header 업체명 · hero 이미지(DM = 포스터 → 가로형 갤러리 → 첫 장 · EMAIL = 가로형 갤러리 → 첫 장 → 포스터) ·
 * 갤러리(같은 비율 군끼리 · 묶음마다 다른 사진 · link_url · 2장 미만이면 비움) · 상품 묶음(3개씩 · 2개 미만이면 비움) · CTA 딥링크(같은 URL 재바인딩) ·
 * countdown 날짜 형식 검증 · footer 법정 표기. 비운 자리는 prune이 지운다.
 * 이미지 원천 = 우리 생성 이미지 + 실측 통과 사본(불변 11 개정 A-10b · 인물 판정은 선택 이미지에만).
 */
export function fillOutreachDmMedia(
  sections: readonly Section[],
  media: OutreachFillMedia,
  channel: 'DM' | 'EMAIL',
): { sections: Section[]; filled: number } {
  const galleryAll = (media.gallery || []).map(toFillImage);
  const firstLandscape = galleryAll.find((g) => aspectClassOf(g) === 'landscape') || null;
  const heroImage = channel === 'DM'
    ? (media.posterUrl || firstLandscape?.url || galleryAll[0]?.url || media.products[0]?.image_url || '')
    : (firstLandscape?.url || galleryAll[0]?.url || media.posterUrl || media.products[0]?.image_url || '');
  // 히어로에 쓴 사진은 묶음에서 뺀다 · 남은 사진은 비율 군으로 나눠 묶음마다 같은 군에서 채운다(큰 군부터 · 어느 군도 2장이 안 되면 합친다)
  const remaining = galleryAll.filter((g) => g.url !== heroImage);
  const groups: OutreachFillImage[][] = (['landscape', 'square', 'portrait'] as AspectClass[])
    .map((c) => remaining.filter((g) => aspectClassOf(g) === c))
    .filter((g) => g.length > 0)
    .sort((a, b) => b.length - a.length);
  const takeGallery = (n: number): OutreachFillImage[] => {
    for (const g of groups) if (g.length >= 2) return g.splice(0, n);
    const flat = groups.flat();
    groups.length = 0;
    if (flat.length >= 2) { groups.push(flat); return flat.splice(0, n); }
    return [];
  };
  const galleryLink = galleryLinkOf(media);
  // ★ 0905(3) 이미지 잘림 정정(Harold 접수 · 공개 샘플 4dbf85c91c) — 렌더러의 고정 높이 박스는 cover가 기본이라 세로형(0.86) 상품 사진이 37~47% 잘렸다.
  //   상품 캐러셀은 항상 contain(상품이 통째로 보여야 한다 · 두 렌더러가 image_fit을 읽는다) · 히어로는 세로형(비율 < 1)일 때만 contain. 공용 렌더러 무변경(불변 20).
  const heroDims = galleryAll.find((g) => g.url === heroImage) || (media.posterUrl && heroImage === media.posterUrl && media.posterSize ? { url: heroImage, ...media.posterSize } : null);
  const heroPortrait = !!(heroDims && heroDims.width && heroDims.height && heroDims.width / heroDims.height < 1);
  const heroIsPoster = !!media.posterUrl && heroImage === media.posterUrl;
  const usedCta = new Set<string>();
  let prodCursor = 0;
  // ★ 0905(4) 갤러리 = 홈페이지 배너를 통째로(1열 · 원본 비율 · 2장씩) — 격자 썸네일은 배너 속 글씨가 읽히지 않아 "썸네일 덤프"가 된다(직원 실물은 배너를 섹션처럼 쓴다)
  const perGallery = 2;
  const perCarousel = 6;
  const maxLabel = channel === 'DM' ? 12 : 8;
  const stripTrailingPunct = (t: unknown) => String(t || '').replace(/[\s.·!。:]+$/g, '').trim();
  let filled = 0;
  let heroDone = false;
  const out = sections.flatMap((s): Section[] => {
    if (!s || typeof s !== 'object') return [s];
    const p: any = { ...((s.props as any) || {}) };
    switch (s.type) {
      case 'header':
        p.brand_name = media.companyName;
        // 로고 픽셀은 못 쓰니(불변 11) 워드마크는 크게(직원 실물 헤더 = 브랜드명 대형)
        if (channel === 'EMAIL') { p.variant = 'logo'; p.align = 'left'; } else { p.variant = 'logo'; p.align = 'center'; p.brand_size = 'lg'; }
        return [{ ...s, props: p } as Section];
      case 'hero':
        if (!heroDone && heroImage) {
          p.image_url = heroImage; heroDone = true; filled++;
          // 세로형 사진 = contain(고정 박스에서 잘리지 않게). 우리 포스터는 세로형이라 룩이 split(밴드 + 이미지 전체)을 고르므로 맞춤 불필요
          if (!heroIsPoster && heroPortrait) p.image_fit = 'contain';
        }
        if (channel === 'EMAIL') { p.height = 'lg'; p.align = 'center'; }
        return [{ ...s, props: p } as Section];
      case 'gallery': {
        const g = takeGallery(perGallery);
        p.images = g.length >= 2 ? g.map((img) => ({ url: img.url, alt: `${media.companyName} 이미지`, link_url: galleryLink })) : [];
        p.layout = 'list_1xN';
        p.title = ''; // 모델은 이미지를 못 본다 — 지어낸 갤러리 제목("제품 사용 컷")이 배너와 어긋난다
        if (g.length >= 2) filled++;
        return [{ ...s, props: p } as Section];
      }
      case 'product_carousel': {
        const ps = media.products.slice(prodCursor, prodCursor + perCarousel);
        prodCursor += ps.length;
        p.products = ps.length >= 2 ? toProductItems(ps) : [];
        p.image_fit = 'contain';
        p.title = stripTrailingPunct(p.title);
        if (ps.length >= 2) filled++;
        return [{ ...s, props: p } as Section];
      }
      case 'cta':
        p.buttons = fillCta(p.buttons, media, maxLabel, usedCta);
        return [{ ...s, props: p } as Section];
      case 'countdown': {
        // 실재하는 미래 종료일이 없으면 섹션째 뺀다 — 빈 값은 00:00으로 렌더된다(0905 이니스프리 실측 결함)
        const raw = String(p.end_datetime || '');
        const ok = /^\d{4}-\d{2}-\d{2}/.test(raw) && new Date(raw).getTime() > Date.now();
        return ok ? [{ ...s, props: p } as Section] : [];
      }
      case 'footer':
        p.notes = p.notes || '';
        // 모델이 notes에 법정 표기를 옮겨 적으면 legal_text·cs_phone과 같은 줄이 세 번 찍힌다(이니스프리 육안) → 겹치면 비운다
        if (media.legal?.legal && /사업자|대표|통신판매|고객센터|d{2,4}-d{3,4}-d{4}/.test(String(p.notes))) p.notes = '';
        if (media.legal?.legal) p.legal_text = media.legal.legal;
        if (media.legal?.csPhone) p.cs_phone = media.legal.csPhone;
        p.show_unsubscribe_link = channel === 'DM';
        return [{ ...s, props: p } as Section];
      default:
        return [s];
    }
  });
  // ★ 0905(4) CTA 2개 보장 — 모델이 1개만 내면 첫 상품 묶음(없으면 첫 갤러리) 뒤에 코드가 1개 끼운다(직원 실물 = CTA 2~3회)
  const ctaCount = out.filter((s) => s.type === 'cta').length;
  if (ctaCount < 2) {
    const anchorIdx = out.findIndex((s) => s.type === 'product_carousel' && Array.isArray((s.props as any)?.products) && (s.props as any).products.length > 0);
    const galleryIdx = out.findIndex((s) => s.type === 'gallery' && Array.isArray((s.props as any)?.images) && (s.props as any).images.length > 0);
    const at = anchorIdx >= 0 ? anchorIdx : galleryIdx;
    if (at >= 0) {
      // 코너(기획전·이벤트·컬렉션…) 링크를 쿠폰류보다 먼저 — 삽입 CTA는 "둘러보기" 성격
      const kw = [...GALLERY_LINK_KEYS, ...OUTREACH_CTA_KEYWORDS].find((k) => media.ctaLinks[k] && !usedCta.has(media.ctaLinks[k]));
      const url = kw ? media.ctaLinks[kw] : media.homepageUrl;
      const label = (kw ? `${kw} 보기` : '전체 상품 보기').slice(0, maxLabel);
      usedCta.add(url);
      const inserted = { id: `so-auto-${out.length}-cta`, type: 'cta', order: 0, visible: true, props: { ...((getDefaultProps('cta' as SectionType) as unknown as Record<string, unknown>) || {}), buttons: [{ label, url, style: 'primary' }] } } as unknown as Section;
      out.splice(at + 1, 0, inserted);
      filled++;
    }
  }
  return { sections: out.map((s, i) => ({ ...s, order: i })), filled };
}

// ===== DM 카피 혜택 기계 차단 (★ A-8 · 불변 22) =====

const LONG_TEXT_PROPS: ReadonlySet<string> = new Set(['body', 'description', 'instructions', 'conditions', 'usage_instructions', 'notes', 'content', 'question']);

function dropPlaceholderSentences(text: string): string {
  const parts = text.split(/(?<=[.!?。])\s+|\n/);
  const kept = parts.filter((x) => !x.includes(BENEFIT_PLACEHOLDER)).map((x) => x.trim()).filter(Boolean);
  return kept.join(' ').trim();
}

/**
 * 면허(재대조 통과 + 미래 종료일) 인용 밖의 혜택 수치를 문장째(짧은 prop은 prop째) 제거한다. 대상 prop = DM_EDITABLE_TEXT_KEYS(손목록 금지).
 * 후처리: hero.headline이 비면 업체명 · text_card 세 prop이 전부 비면 섹션 제거(ALWAYS_KEEP이라 prune이 못 지운다).
 */
export function sanitizeDmCopyBenefits(
  sections: readonly Section[],
  licensedQuote: string,
  companyName: string,
): { sections: Section[]; stripped: number; removed: SectionType[] } {
  let stripped = 0;
  const removed: SectionType[] = [];
  const out: Section[] = [];
  for (const s of sections) {
    if (!s || typeof s !== 'object') continue;
    const keys = DM_EDITABLE_TEXT_KEYS[s.type as SectionType] || [];
    const p: any = { ...((s.props as any) || {}) };
    for (const k of keys) {
      if (k === 'buttons') {
        if (Array.isArray(p.buttons)) {
          p.buttons = p.buttons.map((b: any) => {
            const label = String(b?.label || '');
            const t = stripUnauthorizedBenefits(label, licensedQuote);
            if (t !== label) stripped++;
            return { ...b, label: t.includes(BENEFIT_PLACEHOLDER) ? '자세히 보기' : t };
          });
        }
        continue;
      }
      if (typeof p[k] !== 'string' || !p[k]) continue;
      const t = stripUnauthorizedBenefits(p[k], licensedQuote);
      if (t !== p[k]) stripped++;
      if (t.includes(BENEFIT_PLACEHOLDER)) {
        p[k] = LONG_TEXT_PROPS.has(k) ? dropPlaceholderSentences(t) : '';
      } else {
        p[k] = t;
      }
    }
    if (s.type === 'hero' && !String(p.headline || '').trim()) p.headline = companyName;
    if (s.type === 'text_card' && !String(p.tag || '').trim() && !String(p.headline || '').trim() && !String(p.body || '').trim()) {
      removed.push('text_card');
      continue;
    }
    out.push({ ...s, props: p } as Section);
  }
  return { sections: out, stripped, removed };
}

// ===== 모바일 DM 제작·발행 (CT 직접 = 미차감 · H14 자기 확인) =====

/** asset payload에 남기는 참조 골격 기록 — 근거 패널이 문구를 지어내지 않게(설계서 §6-3). 내부 id·타입명뿐, 문구 0. */
export interface OutreachStructureRef {
  skeletonId: string;
  chainIdx: number;
  variant: 'media' | 'catalog';
  /** 면허·임베드 규칙으로 뺀 섹션 타입(중복 제거) */
  removed: string[];
  /** 참조한 골격의 표본 수(화면 문구 "참조 골격 n건") */
  sampleCount: number;
  /** 정규화 전 전달 구성(계약: 공용 CT는 이 배열을 human 축으로 받는다) */
  sectionTypes: SectionType[];
  /** 골격 출처 — db = 베스트 구성에서 서빙 중인 골격 · builtin = 코드 내장 실물 10건 */
  source: 'db' | 'builtin';
  /** 생성 뒤 데이터가 비어 지운 섹션 타입(중복 제거) */
  pruned?: SectionType[];
}

/**
 * 아웃리치 골격 선택 — 베스트 구성에서 서빙 중인 general DM 골격이 있으면 그것, 없으면 코드 내장 실물 10건(seed).
 * avail: 상품은 unknown(감산 0 · 빈 상품 섹션은 생성 뒤 prune이 지운다) · 혜택은 면허 · 임베드·sns는 상시 absent.
 */
async function pickOutreachStructure(input: { companyName: string; eventText: string; benefitLicensed: boolean }): Promise<OutreachStructureRef | null> {
  const fromDb = await getStructureSkeleton('general', 'DM');
  const skeleton = fromDb
    ? { id: fromDb.id, meta: fromDb.meta, source: 'db' as const }
    : { id: OUTREACH_SEED_SKELETON_ID, meta: outreachSeedSkeleton(), source: 'builtin' as const };
  const avail: Avail = {
    products: 'unknown',
    benefit: input.benefitLicensed ? 'present' : 'absent',
    embeds: 'absent',
    social: 'absent',
  };
  const seed = `outreach:${input.companyName}:${input.eventText.slice(0, 40)}:${seedDateKey(new Date())}`;
  const variant = pickVariant(avail, seed);
  const picked = resolveStructure({ learned: skeleton.meta, variant, seed, avail });
  if (!picked.types || picked.chainIdx === null) return null;
  return {
    skeletonId: skeleton.id,
    chainIdx: picked.chainIdx,
    variant,
    removed: picked.removed,
    sampleCount: skeleton.meta.stats.n,
    sectionTypes: picked.types,
    source: skeleton.source,
  };
}

export interface ProduceDmInput {
  companyName: string;
  industry: string | null;
  homepageUrl: string;
  siteTitle: string | null;
  /** 프롬프트 재료(면허 밖 혜택 자리 제거본) */
  material: string;
  extraNotes?: string | null;
  /** H14 게이트 — 호출부가 명시적으로 넘긴 값이 내부 전용 회사(ENV)와 일치할 때만 발행한다.
   *  함수가 스스로 ENV를 읽어 ENV와 비교하면 항상 참인 공허 게이트가 된다(Codex 1R high). */
  companyId: string;
  userId: string;
  /** 혜택 수치 면허(재대조 통과 + 미래 종료일) — 없으면 참조 골격에서 countdown·coupon류를 뺀다(불변 3·4·5). */
  benefitLicensed: boolean;
  /** 면허 인용 원문(면허 없으면 '') — 카피 혜택 차단의 기준. eventText 전문을 넘기지 않는다(불변 5). */
  licensedQuote: string;
  posterUrl: string | null;
  media: OutreachMedia | null;
  ctaLinks: Record<string, string>;
  legal: { legal: string | null; csPhone: string | null } | null;
  /** 6자리 hex(정규화 통과값) · 접근성 통과 시에만 brand_kit에 싣는다 */
  brandColor?: string | null;
  /** ★ 0905(3) 포스터 실측 크기(studio_image asset) — 히어로 비율 판정(룩) */
  posterSize?: { width: number; height: number } | null;
  /** ★ 0905(3) C4-2 사람이 검토에서 고른 재료(brand_profile.mediaSelection) · 없으면 전량 */
  mediaSelection?: OutreachMediaSelection | null;
  /** ★ 0905(3) C4-3 섹션 숨김 override(stage_results.section_overrides.dm) · 재생성 뒤에도 재적용 */
  sectionOverride?: SectionOverride | null;
  /** ★ 0905(3) C4-3 저장된 최종 섹션(override 적용 전)으로 재발행 — AI 0 · 재료 채우기 0(섹션 숨김 재실행 전용) */
  presetSections?: Section[] | null;
}

export interface ProduceDmResult {
  dmId: string;
  dmUrl: string;
  structureRef: OutreachStructureRef | null;
  benefitStripped: number;
  sectionTypes: string[];
  /** 프롬프트에 실제로 실린 예시 수(근거 문구) · exemplarTotal = 그 채널 원천 전량(DB+seed) */
  exemplarCount: number;
  exemplarTotal: number;
  /** ★ 0905(3) 최종 섹션(override 적용 후 · 발행본) · sectionsBase = override 적용 전(다음 숨김의 기준) */
  sections: Section[];
  sectionsBase: Section[];
  /** 정규 공개 뷰어 URL(단축 도메인이 아니라 우리 호스트 · 검토 화면 iframe이 이것을 연다) */
  viewerUrl: string;
  look: OutreachLookStats;
  hiddenApplied: number;
  hiddenMissed: string[];
  /** 재적용 바닥(최소 잔존·cta 보존)에 걸려 저장된 숨김을 전부 건너뛰었는가 */
  hiddenSkipped: boolean;
}

/** 룩 배정·비율 판정에 쓰는 이미지 크기 표(우리 사본 URL → 폭·높이). */
function buildLookDims(gallery: readonly OutreachFillImage[], products: readonly OutreachMediaProduct[], posterUrl: string | null, posterSize?: { width: number; height: number } | null): LookImageDims {
  const dims: LookImageDims = {};
  for (const g of gallery) if (g.width && g.height) dims[g.url] = { width: g.width, height: g.height };
  for (const p of products) if (p.width && p.height) dims[p.image_url] = { width: p.width, height: p.height };
  if (posterUrl && posterSize && posterSize.width > 0 && posterSize.height > 0) dims[posterUrl] = { width: posterSize.width, height: posterSize.height };
  return dims;
}

export async function produceOutreachDm(input: ProduceDmInput): Promise<ProduceDmResult> {
  const envCompanyId = (process.env.OUTREACH_COMPANY_ID || '').trim();
  const envUserId = (process.env.OUTREACH_USER_ID || '').trim();
  if (!envCompanyId || !envUserId) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
  if (String(input.companyId) !== envCompanyId || String(input.userId) !== envUserId) {
    throw new Error('내부 발행은 내부 전용 회사 계정으로만 가능합니다.');
  }

  // ★ C4-2 사람이 고른 재료만(선택이 없거나 재수집으로 전부 무효면 전량)
  const media = applyOutreachMediaSelection(input.media, input.mediaSelection || null);
  const products = media?.products || [];
  const gallery: OutreachFillImage[] = (media?.gallery || []).map((g) => ({ url: g.url, width: g.width, height: g.height }));
  const dims = buildLookDims(gallery, products, input.posterUrl, input.posterSize);

  let structureRef: OutreachStructureRef | null = null;
  let exemplars = { picked: 0, total: 0 };
  let benefitStripped = 0;
  let sectionsBase: Section[];
  let look: OutreachLookStats;
  if (input.presetSections && input.presetSections.length > 0) {
    // ★ C4-3 섹션 숨김 재실행 — 저장된 최종 섹션(룩 이미 실림)을 그대로 다시 발행한다(AI 0 · 재료 채우기 0)
    sectionsBase = input.presetSections;
    look = lookStatsOf(sectionsBase);
  } else {
    structureRef = await pickOutreachStructure({
      companyName: input.companyName,
      eventText: input.material,
      benefitLicensed: input.benefitLicensed,
    });
    const genInput: OutreachGenInput = {
      companyName: input.companyName,
      industry: input.industry,
      homepageUrl: input.homepageUrl,
      siteTitle: input.siteTitle,
      material: input.material,
      extraNotes: input.extraNotes || null,
      products,
      galleryCount: gallery.length + (input.posterUrl ? 1 : 0),
      skeletonTypes: structureRef ? structureRef.sectionTypes.filter((t) => OUTREACH_DM_TYPES.includes(t)) : null,
    };
    const exemplarSource = await loadOutreachExemplarSource();
    const dmPrompt = buildDmSectionsPrompt(genInput, exemplarSource);
    exemplars = dmPrompt.exemplars;
    const gen = await generateSections(dmPrompt, OUTREACH_DM_TYPES, 'sales-outreach-dm-sections', 'so-dm');
    const filled = fillOutreachDmMedia(gen.sections, {
      posterUrl: input.posterUrl, posterSize: input.posterSize || null, gallery, products, ctaLinks: input.ctaLinks, homepageUrl: input.homepageUrl, legal: input.legal, companyName: input.companyName,
    }, 'DM');
    const sanitized = sanitizeDmCopyBenefits(filled.sections, input.licensedQuote, input.companyName);
    benefitStripped = sanitized.stripped;
    const pruned = pruneEmptyDmSections(sanitized.sections);
    if (structureRef) structureRef.pruned = Array.from(new Set([...sanitized.removed, ...pruned.removed]));
    // ★ C1 룩은 prune 뒤(최종 순서 확정 뒤) 코드가 섹션 최상위에 입힌다
    const looked = applyOutreachLook(pruned.sections, 'DM', dims);
    sectionsBase = looked.sections;
    look = looked.stats;
  }
  // ★ C4-3 사람이 숨긴 섹션은 override 데이터로 재적용(같은 조립 경로 · 불변 16)
  const overridden = applySectionOverrides(sectionsBase, input.sectionOverride || null);
  const rebuilt = rebuildDmPages(overridden.sections);
  // 발행본 기준 룩 통계(숨김으로 줄어든 뒤) — 화면·품질 경고가 읽는 값은 발행본과 같아야 한다
  look = lookStatsOf(rebuilt.sections);
  // ★ 아웃리치 DM = 세로 한 페이지(OUTREACH_DM_LAYOUT_MODE) — slides 확장이 갤러리 구도·링크를 버리고 sandbox 미리보기가 첫 장에서 멈춘다
  const pages = splitSectionsIntoPages(rebuilt.sections, OUTREACH_DM_LAYOUT_MODE);

  // ★ 0905(4) 브랜드 색 = 접근성 보정본(대비 미달이면 명도만 낮춰 통과시킨다 · 실패 시 null = 기본 토큰)
  const primary = accessiblePrimaryOf(input.brandColor);
  const dm = await createDm(input.companyId, input.userId, {
    title: `[영업] ${input.companyName}`.slice(0, 200),
    sections: rebuilt.sections,
    pages,
    layout_mode: OUTREACH_DM_LAYOUT_MODE,
    // ★ C1-3 brand_kit은 항상(art_direction 그릇) · 대비 미달이면 색만 뺀다 · logo_url은 어떤 경우에도 없다(불변 11)
    brand_kit: buildOutreachBrandKit(primary, input.industry),
    ai_prompt: input.material.slice(0, 2000),
    approval_status: 'draft',
  } as any);
  const published = await publishDm(String(dm.id), input.companyId);
  if (!published?.short_code) throw new Error('모바일 DM 발행 주소를 만들지 못했습니다.');
  const shortBase = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
  const dmUrl = shortBase
    ? `${shortBase}/${published.short_code}`
    : `${PUBLIC_BASE}/api/dm/v/dm-${published.short_code}`;
  return {
    dmId: String(dm.id),
    dmUrl,
    structureRef,
    benefitStripped,
    sectionTypes: rebuilt.sections.map((s) => String(s.type)),
    exemplarCount: exemplars.picked,
    exemplarTotal: exemplars.total,
    sections: rebuilt.sections,
    sectionsBase,
    viewerUrl: `${PUBLIC_BASE}/api/dm/v/dm-${published.short_code}`,
    look,
    hiddenApplied: overridden.applied,
    hiddenMissed: overridden.missed,
    hiddenSkipped: overridden.skipped === true,
  };
}

// ===== 브랜드 이메일 시안 (★0905 — 제안 메일 안에 쇼케이스로 실린다) =====

export interface BrandEmailResult {
  /** 룩까지 실린 시안 섹션(override 적용 전 · 호출부가 stage_results.section_overrides.email을 재적용한다) */
  sections: Section[];
  subject: string;
  preheader: string;
  benefitStripped: number;
  exemplarCount: number;
  exemplarTotal: number;
  look: OutreachLookStats;
}

export async function produceOutreachBrandEmail(input: Omit<ProduceDmInput, 'companyId' | 'userId' | 'sectionOverride' | 'presetSections'>): Promise<BrandEmailResult> {
  const media = applyOutreachMediaSelection(input.media, input.mediaSelection || null);
  const products = media?.products || [];
  const gallery: OutreachFillImage[] = (media?.gallery || []).map((g) => ({ url: g.url, width: g.width, height: g.height }));
  const dims = buildLookDims(gallery, products, input.posterUrl, input.posterSize);
  const genInput: OutreachGenInput = {
    companyName: input.companyName,
    industry: input.industry,
    homepageUrl: input.homepageUrl,
    siteTitle: input.siteTitle,
    material: input.material,
    extraNotes: input.extraNotes || null,
    products,
    galleryCount: gallery.length,
    skeletonTypes: null,
  };
  const exemplarSource = await loadOutreachExemplarSource();
  const emailPrompt = buildEmailSectionsPrompt(genInput, exemplarSource);
  const gen = await generateSections(emailPrompt, OUTREACH_EMAIL_TYPES, 'sales-outreach-email-sections', 'so-brand');
  const filled = fillOutreachDmMedia(gen.sections, {
    posterUrl: input.posterUrl, posterSize: input.posterSize || null, gallery, products, ctaLinks: input.ctaLinks, homepageUrl: input.homepageUrl, legal: input.legal, companyName: input.companyName,
  }, 'EMAIL');
  const sanitized = sanitizeDmCopyBenefits(filled.sections, input.licensedQuote, input.companyName);
  const pruned = pruneEmptyDmSections(sanitized.sections);
  const looked = applyOutreachLook(pruned.sections, 'EMAIL', dims);
  const subjectRaw = String(gen.raw?.subject || '').trim();
  const subject = stripUnauthorizedBenefits(subjectRaw, input.licensedQuote).split(BENEFIT_PLACEHOLDER).join('').trim().slice(0, 40);
  return {
    sections: looked.sections,
    subject,
    preheader: String(gen.raw?.preheader || '').slice(0, 60),
    benefitStripped: sanitized.stripped,
    exemplarCount: emailPrompt.exemplars.picked,
    exemplarTotal: emailPrompt.exemplars.total,
    look: looked.stats,
  };
}

// ===== 제안 메일 (★ A-2 분할: 제목·서두 AI → 순수 조립 → 진입점) =====

/** 이메일 버튼 라벨 — VML 버튼 폭 230px 하드코딩 대응, 8자 상한을 서버가 강제(디자이너 R5) */
function assertButtonLabel(label: string): string {
  if (label.length > 8) throw new Error(`이메일 버튼 라벨은 8자 이내여야 합니다: ${label}`);
  return label;
}

export interface SubjectIntroInput {
  companyName: string;
  industry: string | null;
  selectedEvent: EventCandidate | null;
  /** 면허 밖 혜택 자리를 지운 재료(2000자) */
  promptMaterial: string;
}

/** 제목·서두 프롬프트(순수). */
export function buildEmailIntroPrompt(guide: OutreachStyleGuide, input: SubjectIntroInput): { system: string; user: string } {
  const system = [
    '너는 B2B 제안 메일의 제목과 서두를 쓰는 카피라이터다.',
    `구성: ${guide.email.structure.join(' → ')}`,
    `톤: ${guide.email.tone}`,
    ...guide.prohibitions.map((p) => `금지: ${p}`),
    '서두는 그 업체 홈페이지에서 실제로 본 것 1~2가지를 구체적으로 언급한다(없는 것을 지어내지 않는다).',
    '출력은 JSON 하나만: {"subject":"...","intro":"..."} (subject 40자 이내 · intro 2~3문장)',
  ].join('\n');
  const user = [
    `업체: ${input.companyName} (업종: ${industryLabel(input.industry)})`,
    input.selectedEvent
      ? `그 업체 홈페이지에서 확인한 행사(원문 인용 · 이 안의 사실만 언급 가능):\n"${input.selectedEvent.quote}"`
      : '확인된 행사 없음: 브랜드 일반형 서두.',
    input.promptMaterial ? `[홈페이지에서 읽은 내용]\n${input.promptMaterial.slice(0, 2000)}` : '',
  ].filter(Boolean).join('\n');
  return { system, user };
}

/** 제목·서두 생성 — strip → 40자 규칙(placeholder 포함 또는 40자 초과면 기본 제목 · 절단 금지) → catch 기본값. */
export async function generateSubjectIntro(guide: OutreachStyleGuide, input: SubjectIntroInput): Promise<{ subject: string; intro: string; subjectPlaceholders: number; introPlaceholders: number; generated: boolean }> {
  const licensedQuote = input.selectedEvent && input.selectedEvent.benefitLicensed ? input.selectedEvent.quote : '';
  let subject = guide.emailCopy.subjectDefault(input.companyName);
  let intro = '';
  let generated = false;
  try {
    const prompt = buildEmailIntroPrompt(guide, input);
    const raw = await callAIWithFallback({
      system: prompt.system, userMessage: prompt.user, maxTokens: 500, temperature: 0.7, source: 'sales-outreach-email-intro',
    });
    const block = raw.match(/\{[\s\S]*\}/);
    const parsed = block ? JSON.parse(block[0]) : {};
    if (typeof parsed.subject === 'string' && parsed.subject.trim()) {
      const s = stripUnauthorizedBenefits(parsed.subject.trim(), licensedQuote);
      if (!s.includes(BENEFIT_PLACEHOLDER) && s.length <= 40) subject = s;
    }
    if (typeof parsed.intro === 'string' && parsed.intro.trim()) {
      intro = stripUnauthorizedBenefits(parsed.intro.trim().slice(0, 500), licensedQuote);
      generated = true;
    }
  } catch (err: any) {
    console.log('[sales-outreach] 제목·서두 생성 실패(기본값 사용):', err?.message);
  }
  if (!intro) intro = guide.emailCopy.introDefault(input.companyName);
  return { subject, intro, subjectPlaceholders: countBenefitPlaceholders(subject), introPlaceholders: countBenefitPlaceholders(intro), generated };
}

export interface ProposalEmailInput {
  companyName: string;
  industry: string | null;
  selectedEvent: EventCandidate | null;
  copyBody: string;        // {{DM_LINK}} 치환 전 문안
  posterUrl: string | null; // 절대 URL
  dmUrl: string;            // hlj.kr (업체에 도달 가능한 유일한 링크 축 L1)
  previewUrl: string;       // 공개 샘플 페이지(L2 — 만료·noindex 있는 공개 URL, Harold 0824 "외부 공개 가능 주소")
  /** 수신거부 문구(§10 확정 전 = 빈 값) — 빈 값이면 발송 게이트가 잠긴다(H19). 조립 자체는 슬롯을 실재시킨다. */
  unsubscribeNotice: string;
  /** 브랜드 이메일 시안 블록(생성·재료·차단 완료본) */
  brandSections: Section[];
  /** 6자리 hex(정규화 통과값) · 접근성 통과 시에만 palette.primary */
  brandColor?: string | null;
  /** 제목·서두(호출부가 넘긴다 = 재조립이 사람 편집분을 지우지 않는다 · B-2) */
  subject: string;
  intro: string;
  /** 푸터 기준일(테스트 주입용 · 기본 = 지금) */
  now?: Date;
}

function kstDateDash(d: Date): string {
  const t = kstDateTag(d);
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

/** 순수 섹션 조립 — 한글 리터럴 0(문구 전부 guide.emailCopy). 렌더는 호출부. */
export function buildProposalEmailSections(guide: OutreachStyleGuide, input: ProposalEmailInput): Section[] {
  const c = guide.emailCopy;
  const copyForEmail = input.copyBody.replace(/\{\{DM_LINK\}\}/g, input.dmUrl);
  let order = 0;
  const sec = (type: string, props: Record<string, unknown>, extra?: Record<string, unknown>): Section => ({
    id: `so-${order}-${type}`,
    type,
    order: order++,
    visible: true,
    props,
    ...(extra || {}),
  } as unknown as Section);

  const head: Section[] = [
    sec('header', { variant: 'logo', align: 'left', brand_name: c.senderBrandName, brand_size: 'sm', show_brand_name: true }),
    sec('hero', {
      image_url: input.posterUrl || undefined,
      headline: input.posterUrl ? c.hero.headline : c.hero.headlineNoImage(input.companyName),
      sub_copy: c.hero.subCopy,
      align: 'center', height: 'lg', image_fit: 'contain',
    }, { treatment: 'split' }),
    sec('text_card', {
      tag: c.lead.tag,
      headline: input.selectedEvent ? c.lead.headlineWithEvent : c.lead.headlineNoEvent,
      body: [
        input.intro,
        input.selectedEvent ? `${c.lead.quoteLabel}: "${input.selectedEvent.quote}"` : '',
      ].filter(Boolean).join('\n\n'),
      align: 'left', image_position: 'top',
    }, { treatment: 'lead' }),
  ];

  const showcase: Section[] = [];
  if (input.brandSections.length > 0) {
    showcase.push(sec('text_card', {
      tag: c.sample.tag,
      headline: c.sample.headline(input.companyName),
      body: c.sample.body,
      align: 'left', image_position: 'top',
    }, { background: 'soft' }));
    for (const s of input.brandSections) {
      showcase.push({ ...(s as any), id: `so-${order}-${s.type}`, order: order++ } as Section);
    }
  }

  const tail: Section[] = [
    sec('text_card', {
      tag: c.showcase.tag,
      headline: c.showcase.headline,
      body: copyForEmail,
      align: 'left', image_position: 'top',
    }),
    sec('cta', {
      layout: 'stack',
      buttons: [
        { label: assertButtonLabel(c.cta.primary), url: input.previewUrl, style: 'primary' },
        { label: assertButtonLabel(c.cta.secondary), url: input.dmUrl, style: 'outline' },
      ],
    }, { treatment: 'bar' }),
    sec('text_card', {
      headline: c.service.headline,
      body: c.service.body,
      align: 'left', image_position: 'top',
    }, { background: 'dark' }),
    sec('footer', {
      notes: [
        ...c.footer.notes,
        c.footer.basisLine(kstDateDash(input.now || new Date())),
        input.unsubscribeNotice, // §10 확정 전 빈 슬롯 — 발송 게이트(H19)는 호출부가 본다
      ].filter(Boolean).join('\n'),
      cs_phone: undefined,
      legal_text: c.footer.legal,
      show_unsubscribe_link: false,
    }),
  ];
  return [...head, ...showcase, ...tail];
}

/** 평문 대체본(★ C-1 · 공용 extractEmailText는 cta·footer를 못 읽는다) */
export function buildOutreachPlainText(guide: OutreachStyleGuide, input: ProposalEmailInput): string {
  const c = guide.emailCopy;
  const copyForEmail = input.copyBody.replace(/\{\{DM_LINK\}\}/g, input.dmUrl);
  return [
    input.subject,
    '',
    input.intro,
    input.selectedEvent ? `${c.lead.quoteLabel}: "${input.selectedEvent.quote}"` : '',
    '',
    `${c.showcase.tag}:`,
    copyForEmail,
    '',
    `${c.cta.primary}: ${input.previewUrl}`,
    `${c.cta.secondary}: ${input.dmUrl}`,
    '',
    ...c.footer.notes,
    c.footer.basisLine(kstDateDash(input.now || new Date())),
    input.unsubscribeNotice,
    c.footer.legal,
  ].filter((l) => l !== undefined && l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 진입점 — 조립 + 렌더 + 평문 + placeholder 합산. producing_email이 부르는 유일한 함수. */
export function assembleProposalEmail(input: ProposalEmailInput): { subject: string; intro: string; html: string; text: string; placeholderCount: number } {
  const guide = getActiveStyleGuide();
  const sections = buildProposalEmailSections(guide, input);
  const primary = accessiblePrimaryOf(input.brandColor);
  const html = renderEmailSections(sections, {
    design: {
      // ★ 0905(3) C1-4 업종군 표(DM brand_kit과 같은 원천) — 업체와 무관하게 같은 옷을 입던 하드코딩 한 벌 제거
      art_direction: outreachArtDirection(input.industry),
      preheader: guide.emailCopy.preheader(input.companyName),
      ...(primary ? { palette: { primary } } : {}),
    } as any,
    publicBase: PUBLIC_BASE,
  }).replace(EMAIL_FOOTER_SLOT, '');
  const text = buildOutreachPlainText(guide, input);
  return {
    subject: input.subject,
    intro: input.intro,
    html,
    text,
    placeholderCount: countBenefitPlaceholders(input.subject) + countBenefitPlaceholders(html),
  };
}
