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
import * as path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
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
import { createDm, publishDm, updateDm } from './dm/dm-builder';
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
import { applyOutreachLook, buildOutreachBrandKit, outreachArtDirection, lookStatsOf, accessiblePrimaryOf, heroEligible, LANDSCAPE_RATIO, OUTREACH_DM_LAYOUT_MODE, OUTREACH_NEUTRAL_PRIMARY, type LookImageDims, type OutreachLookStats } from './sales-outreach-look';
/** ★ 0905(5) 헤더 로고 실물 게이트 — 폭 60 이상 · 비율 0.5~8(정사각 아이콘 ~ 가로 워드마크) · 300KB 이하 · 흰 로고 제외 */
const LOGO_MAX_BYTES = 300_000;
import { splitSectionsIntoPages } from './dm/dm-page-split';
import { applyOutreachMediaSelection, applySectionOverrides, type OutreachMediaSelection, type SectionOverride } from './sales-outreach-review';
import { kstDateTag } from './ai-credit-calc';
import {
  pickOutreachExemplarsDetail, OUTREACH_GENERATION_RULES,
  OUTREACH_EMAIL_SECTION_CONTRACT, OUTREACH_DM_TYPES, OUTREACH_EMAIL_TYPES,
  // ★ v3 입구별 DM 계약·허용 타입(함수 · 아웃리치 = gallery 0 · 고객 = 현행)
  dmSectionContract, dmAllowedTypes,
} from './sales-outreach-exemplars';
import {
  collectProductsFromLinks, fetchProductPageGuarded, measureAndStoreImage, pickStoredImagesDetail, productKey, readImageSize, pngLooksWhite, pngHasAlpha,
  OUTREACH_GALLERY_MIN_WIDTH, OUTREACH_PRODUCT_MIN_WIDTH, OUTREACH_CTA_KEYWORDS, OUTREACH_GALLERY_DEADLINE_MS,
  type OutreachProduct, type StoredImage,
} from './sales-outreach-media';
// ★ 2026-09-06 S3 — 스튜디오 문구 게이트(hasBenefitPattern) · 합성 타이포 타입 · DM 캡처(렌더 워커)
import { hasBenefitPattern, findTemplateSample, type ComposeTypography } from './image-studio';
import { renderPageGuarded } from './sales-outreach-render';
// ★ 2026-09-06 S5 조립 엔진(결정 구간 공용) — 엔진은 이 파일을 모른다(deps 주입 · 순환 0)
import { assembleDmCampaign, type EngineDeps, type EngineGenInput, type EngineMaterials, type EngineChannel, type EngineEntry, type EngineEventCard } from './campaign-engine';
// ★ 2026-09-05 실물 예시 원천 = DB(베스트 구성에서 올린 실물 · 5분 캐시) + seed. async에서 읽어 순수 프롬프트 빌더에 주입한다(pickOutreachStructure와 같은 형태).
import { loadOutreachExemplarSource } from './sales-outreach-examples';

export type ExemplarSource = Record<string, readonly string[]>;

// ===== ★ 2026-09-06 v3 관측(설계서 §7-9 · 불변 38) — 아웃리치 축 AI 호출을 스스로 센다(companyId 주입 0 · recordAiCall 직접 호출 0 · 토큰은 별건) =====

export interface OutreachAiCost { calls: number; bySource: Record<string, number>; ms: number }
const aiMeterStore = new AsyncLocalStorage<OutreachAiCost>();

/** 잡 실행 구간을 계수기와 함께 돈다(runProduction · runOutreachJob 이 감싼다). 구간 밖의 호출은 세지 않는다(계약: 잡에 속하지 않는 호출은 없다). */
export function withOutreachAiMeter<T>(meter: OutreachAiCost, fn: () => Promise<T>): Promise<T> {
  return aiMeterStore.run(meter, fn);
}
export function newOutreachAiCost(): OutreachAiCost { return { calls: 0, bySource: {}, ms: 0 }; }
/** 두 계수 합(순수) — stage_results.ai_cost 누적 */
export function addOutreachAiCost(a: Partial<OutreachAiCost> | null | undefined, b: OutreachAiCost): OutreachAiCost {
  const out: OutreachAiCost = { calls: (Number(a?.calls) || 0) + b.calls, bySource: { ...(a?.bySource && typeof a.bySource === 'object' ? a.bySource : {}) }, ms: (Number(a?.ms) || 0) + b.ms };
  for (const [k, v] of Object.entries(b.bySource)) out.bySource[k] = (Number(out.bySource[k]) || 0) + v;
  return out;
}
/** 아웃리치 축의 유일한 AI 진입점 — 공용 호출기 그대로(반환 문자열 · 옵션 무변경) + 호출 수·source·소요를 현재 잡 계수기에 더한다. */
export async function callOutreachAi(params: Parameters<typeof callAIWithFallback>[0]): Promise<string> {
  const meter = aiMeterStore.getStore();
  const t0 = Date.now();
  try {
    return await callAIWithFallback(params);
  } finally {
    if (meter) {
      meter.calls++;
      const src = String(params.source || 'unknown');
      meter.bySource[src] = (meter.bySource[src] || 0) + 1;
      meter.ms += Date.now() - t0;
    }
  }
}

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
    const raw = await callOutreachAi({
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
  /** 폭 ≥ 600 통과 · 문서 순서(홈 첫 배너가 앞) · 최대 8장(우리 사본 URL) */
  gallery: StoredImage[];
  /** ★ 0905(5) 헤더 로고 사본(Harold 결재 · 불변 11 개정) · 못 찾으면 null(브랜드명 글자만) · 옛 기록에는 없다 */
  logo?: StoredImage | null;
  /** 이미지 폭 ≥ 400 통과 상품 · 최대 6개 */
  products: OutreachMediaProduct[];
  collectedAt: string;
  stats: {
    galleryCandidates: number; galleryPassed: number; productLinks: number; productsFound: number; productsPassed: number;
    /** ★ 0905(3) C3-2 순차 fetch 시도 수 · 벽시계 예산 초과 여부 · 수집 소요(ms) — 옛 기록에는 없다 */
    galleryTried?: number; galleryTimedOut?: boolean; elapsedMs?: number;
    /** ★ 0905(5) 헤더 로고 확보 여부 */
    logoFound?: boolean;
    /** ★ v3 상품 상세 1홉이 벽시계 예산에 걸려 남은 링크를 보지 못했는가 · 카드 배너 사본 시도·통과 수 */
    productsTimedOut?: boolean;
    cardBannersTried?: number; cardBannersPassed?: number;
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
  /** ★ 2026-09-06(2) 배너 원 URL → alt(홈페이지 문구) · 사본에 정리본을 붙인다(캡션·설명 카드 원천) */
  imageAlts?: Record<string, string>;
  productLinks: string[];
  listProducts: OutreachProduct[];
  /** ★ 0905(5) 크롤이 뽑은 로고 후보(순수 · extractLogoCandidates) */
  logoCandidates?: string[];
  /** ★ v3 이벤트 카드 배너 원 URL(전용 예산으로 사본 · 폭 ≥400 · 최대 6 · 갤러리 뒤에 붙는다 · srcUrl 로 되찾는다) */
  cardBannerUrls?: string[];
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
  // ★ 2026-09-06(2) 홈페이지 배너 문구(alt)를 사본에 붙인다 — 정리본만(파일명·"배너"류 잡음·업체명 단독은 버림)
  const homeGallery = galleryPick.images.map((g) => {
    const caption = cleanBannerCaption(input.imageAlts?.[g.srcUrl], input.listProducts.length ? undefined : undefined);
    return caption ? { ...g, alt: caption } : g;
  });
  // ★ v3 카드 배너 전용 예산(리뷰 #2) — 홈 배너가 시도 상한(24)·통과 상한(8)을 다 먹으면 꼬리의 카드 배너는 영영 안 받아진다 → 따로 받아 갤러리 뒤에 붙인다(홈 첫 배너 = galleryAll[0] 규칙 유지)
  const cardUrls = (input.cardBannerUrls || []).filter((u) => u && !homeGallery.some((g) => g.srcUrl === u)).slice(0, OUTREACH_CARD_BANNER_MAX);
  const cardPick = cardUrls.length
    ? await pickStoredImagesDetail(cardUrls, OUTREACH_CARD_BANNER_MAX, OUTREACH_CARD_BANNER_MIN_WIDTH, fetcher, store, { deadlineMs: 20_000, maxTries: cardUrls.length })
    : { images: [] as StoredImage[], tried: 0, timedOut: false };
  const gallery = [...homeGallery, ...cardPick.images];
  // ★ 0905(5) 헤더 로고 — 후보 순서대로 받아 크기·비율·흰 로고를 거른 첫 장을 사본으로. 실패 = null(글자 워드마크)
  let logo: StoredImage | null = null;
  for (const u of input.logoCandidates || []) {
    try {
      const img = await fetcher(u);
      if (!img || img.buffer.length > LOGO_MAX_BYTES) continue;
      const size = readImageSize(img.buffer);
      if (!size || size.width < 60 || size.width / size.height < 0.5 || size.width / size.height > 8) continue;
      if (img.ext === 'png' && pngLooksWhite(img.buffer)) continue;
      const stored = store(img.buffer, { ext: img.ext, mime: img.mime, width: size.width, height: size.height });
      if (!stored) continue;
      logo = { url: stored, width: size.width, height: size.height, bytes: img.buffer.length, srcUrl: u };
      break;
    } catch { /* 다음 후보 */ }
  }

  const fromPages = host ? await collectProductsFromLinks(input.productLinks, host, 6, { deadlineMs: PRODUCT_DETAIL_BUDGET_MS }) : { products: [], timedOut: false };
  const pageKeys = new Set(fromPages.products.map(productKey));
  const merged: OutreachProduct[] = [...fromPages.products];
  // ★ v3 P0(검증 B6) — 상세 1홉 파서는 5키만 돌려주고 상세가 먼저 채워지므로, 목록 카드가 가진 4키(뱃지·평점·리뷰수·할인율)를 같은 productKey 의 상세 상품에 덧입힌다
  const listByKey = new Map<string, OutreachProduct>();
  for (const p of input.listProducts) { const k = productKey(p); if (!listByKey.has(k)) listByKey.set(k, p); }
  for (const p of input.listProducts) {
    const k = productKey(p);
    if (pageKeys.has(k)) continue;
    pageKeys.add(k);
    merged.push(p);
    if (merged.length >= 10) break;
  }
  const products: OutreachMediaProduct[] = [];
  const fromPageSet = new Set(fromPages.products);
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
    products.push({
      name, price, discount_price: discount, link_url: p.link_url, image_url: info.url, srcImageUrl: info.srcUrl, width: info.width, height: info.height,
      // 4키 + 어워즈 — 자기 것 → 같은 키의 목록 상품 것(있는 키만 · 없으면 키 자체가 없다)
      ...productFactKeys(listByKey.get(productKey(p))), ...productFactKeys(p),
    });
  }
  return {
    gallery,
    logo,
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
      logoFound: !!logo,
      productsTimedOut: fromPages.timedOut,
      cardBannersTried: cardPick.tried,
      cardBannersPassed: cardPick.images.length,
    },
  };
}

/** ★ v3 카드 배너 사본 예산 — 카드 ≤6 · 폭 ≥400(목록 카드 썸네일은 홈 배너보다 작다 · 히어로 자격은 비율로 따로 본다) */
export const OUTREACH_CARD_BANNER_MAX = 6;
export const OUTREACH_CARD_BANNER_MIN_WIDTH = 400;

/** ★ v3 상품 상세 1홉 벽시계 예산(홉 상한 6 × 요청 타임아웃 10초의 절반 · 초과 = 수집분 전진 · 미검증 값 = 실측 뒤 조정) */
export const PRODUCT_DETAIL_BUDGET_MS = 30_000;

/** 상품의 사실 키(카드 원문에 문자열로 있던 것만)를 있는 것만 골라 낸다 — 스프레드 한 줄이 undefined 키를 만들지 않게 */
export function productFactKeys(p: Partial<OutreachProduct> | null | undefined): Pick<OutreachProduct, 'badges' | 'rating' | 'review_count' | 'discount_rate' | 'awards'> {
  const out: Pick<OutreachProduct, 'badges' | 'rating' | 'review_count' | 'discount_rate' | 'awards'> = {};
  if (!p) return out;
  if (Array.isArray(p.badges) && p.badges.length) out.badges = p.badges;
  if (typeof p.rating === 'number' && p.rating > 0) out.rating = p.rating;
  if (typeof p.review_count === 'number' && p.review_count > 0) out.review_count = p.review_count;
  if (typeof p.discount_rate === 'number' && p.discount_rate > 0 && p.discount_rate < 100) out.discount_rate = p.discount_rate;
  if (Array.isArray(p.awards) && p.awards.length) out.awards = p.awards;
  return out;
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
  /** ★ 2026-09-06 S3 포스터 문구 3칸(코드가 찍은 것 · 비운 칸은 null) · 누끼 경로 · 유출 검사 · 16:9 배너 */
  posterTexts: OutreachPosterTexts;
  cutoutSource: 'alpha_png' | 'rembg' | null;
  posterScore: PosterScore | null;
  posterRegenerated: boolean;
  bannerUrl: string | null;
  bannerSize: { width: number; height: number } | null;
}

// ===== ★ 2026-09-06 S3 포스터 문구 3칸(순수 · 회의 수렴안 D5) =====

export interface OutreachPosterTexts { label: string | null; title: string | null; subtitle: string | null; dropped: string[] }

/** 행사 성격 라벨 — 인용문에 그 낱말이 있을 때만(사실). 없으면 업종 라벨(사실) · 그것도 없으면 null. */
const POSTER_CATEGORY_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/기획전/, '기획전'], [/페스티벌|페스타/, '페스티벌'], [/멤버십/, '멤버십'], [/감사/, '고객 감사'], [/오픈|런칭|출시/, '신규 오픈'],
  [/신상|신제품/, '신상품'], [/선물|기프트/, '선물 기획'], [/세일|특가|할인/, '세일'], [/이벤트/, '이벤트'], [/데이(?![a-z가-힣])|\bday\b/i, '데이'], [/클래스|체험/, '체험'],
];
export function posterCategoryLabel(quote: string | null | undefined, industry: string | null | undefined): string | null {
  const q = String(quote || '');
  for (const [re, label] of POSTER_CATEGORY_WORDS) if (q && re.test(q)) return label;
  return isIndustryCode(industry) ? industryLabel(industry) : null;
}

/** 스튜디오 공용 혜택 패턴이 안 보는 아웃리치 혜택어(면허 없는 판촉 낱말) — 이미지 글자 게이트 전용 */
const POSTER_EXTRA_REJECT_RE = /특가|핫딜/;
/** ★ 0906(3) 포스터 배경 지시 — 브랜드 팔레트 톤 + 깨끗한 스튜디오(히어로 밴드 · 카드 · CTA 와 한 색 체계) · 문구 자리는 비워 둔다(서버 타이포) */
export function posterStyleHint(brandColor: string | null): string {
  return [
    brandColor ? `brand accent color ${brandColor}, backdrop tinted softly toward this color` : 'neutral soft backdrop in warm off-white',
    'clean studio lighting, minimal props, no text, keep the top 30% calm and uncluttered for typography',
  ].join(' · ');
}

/** ★ 0906(3) 제안 메일 "5분 투자" 대비 이미지 — 업종에 맞는 스튜디오 템플릿 중 실샘플 파일이 있는 첫 장(공개 라우트 · 없으면 null) */
export function pickShowcaseExampleUrl(industry: string | null | undefined, finder: (id: string) => unknown = findTemplateSample): string | null {
  const code = isIndustryCode(industry) ? industry : null;
  const pool = code
    ? STUDIO_TEMPLATES.filter((t) => (t.kind ?? 'product') === 'product' && INDUSTRY_TEMPLATE_MAP[code].product.includes(t.category))
    : STUDIO_TEMPLATES.filter((t) => (t.kind ?? 'product') === 'product');
  const ordered = [...pool, ...STUDIO_TEMPLATES.filter((t) => !pool.includes(t))];
  for (const t of ordered) {
    try { if (finder(t.id)) return `${PUBLIC_BASE}/api/image-studio/template-sample/${t.id}`; } catch { /* 다음 */ }
  }
  return null;
}

/** 쇼핑몰 옵션·SKU 낱말 — 포스터 subtitle 로 쓰지 않는다 */
const POSTER_SUBTITLE_NOISE_RE = /옵션|선택|택\s*\d|단품|더블|기획세트|리필용|본품|증정/;
/** 숫자 앞 절단 뒤 매달리는 수식어·조사 제거(순수) — 남는 마지막 낱말이 2자 이상일 때만 조사를 뗀다("사과"의 과는 보존) */
export function trimDanglingTail(text: string): string {
  let t = String(text || '').trim();
  for (let i = 0; i < 3; i++) {
    const n = t.replace(/\s*(최대|최소|단|총|무려|오직|단돈|약|평균|까지|부터|및|또는|그리고|에서|대비)$/, '').trim();
    if (n === t) break;
    t = n;
  }
  const m = t.match(/([가-힣]+)$/);
  if (m && m[1].length >= 3 && /[을를은는의와과]$/.test(m[1])) t = t.slice(0, -1).trim();
  return t.replace(/[\s.·!。:,]+$/g, '').trim();
}

/** 이미지 안 글자 게이트 — 혜택 패턴 0 · 숫자 0(발송 잠금이 이미지 글자를 못 보므로 조립기 안에서 거부 · 회의 수렴안 D5) · 2자 이상 */
function posterTextOk(v: string | null | undefined): v is string {
  return !!v && v.trim().length >= 2 && !hasBenefitPattern(v) && !POSTER_EXTRA_REJECT_RE.test(v) && !/\d/.test(v);
}

/**
 * 포스터 3칸 = label(행사 성격/업종 라벨) · title(면허 행사명의 부분 문자열 · 첫 구분자 앞 · 숫자 앞까지 · 40자) · subtitle(상품군 이름 또는 사이트 제목).
 * 세 칸 모두 원문 대조본만 · 근거를 못 찾은 칸은 null(채우려고 지어내지 않는다) · title 이 비면 업체명(사실).
 */
export function buildOutreachPosterTexts(input: {
  companyName: string; industry: string | null; eventQuote: string | null; products: ReadonlyArray<Pick<OutreachProduct, 'name'>>; siteTitle: string | null;
}): OutreachPosterTexts {
  const dropped: string[] = [];
  const quote = String(input.eventQuote || '').replace(/\s+/g, ' ').trim();
  let title: string | null = null;
  if (quote) {
    const seg = quote.split(/[~·|,/\n]|\s-\s|\s–\s/)[0].replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
    // ★ 2026-09-06(2) 숫자 앞에서 잘랐으면 매달린 수식어("혜택 최대")와 조사를 걷는다(아이소이 실측 "풍성한 한가위 보름달 혜택 최대")
    const cutRaw = seg.replace(/\s*\d[\s\S]*$/, '').trim();
    const cut = cutRaw !== seg ? trimDanglingTail(cutRaw) : cutRaw;
    const cand = posterTextOk(cut) ? cut : (posterTextOk(seg) ? seg : null);
    if (cand && cand.length <= 40 && quote.includes(cand)) title = cand; else dropped.push('title');
  }
  if (!title) title = input.companyName;
  let label = posterCategoryLabel(quote || null, input.industry);
  if (label && !posterTextOk(label)) { dropped.push('label'); label = null; }
  // ★ 2026-09-06(2) subtitle 후보에서 쇼핑몰 옵션 낱말(옵션·선택·택1·단품·더블)을 거르고 짧은 이름을 앞세운다(실측 "올세라 탄력 옵션 선택")
  const prodNames = (input.products || []).map((p) => String(p.name || '').replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim())
    .filter((n) => posterTextOk(n) && n.length <= 30 && !POSTER_SUBTITLE_NOISE_RE.test(n));
  const prod = prodNames.slice().sort((a, b) => a.length - b.length).find((n) => n.length <= 14) || prodNames[0] || null;
  const site = input.siteTitle ? String(input.siteTitle).replace(/\s+/g, ' ').trim() : '';
  let subtitle: string | null = prod || (posterTextOk(site) && site !== input.companyName && site.length <= 40 ? site : null);
  if (subtitle && subtitle === title) subtitle = null;
  if (!subtitle) dropped.push('subtitle');
  return { label, title, subtitle, dropped };
}

/** 서버 합성 타이포(순수) — 문구는 코드가 찍는다(모델 한글 렌더 실패·오철자 0). 위치 = zone(top 포스터 · bottom 16:9 배너) · 크기는 높이 비율. */
export function buildPosterTypography(texts: OutreachPosterTexts, opts: { brandColor: string | null; zone: 'top' | 'bottom'; fontPath: string | null }): ComposeTypography[] {
  const out: Array<ComposeTypography & { role?: string; badgeColor?: string; weight?: string }> = [];
  const top = opts.zone === 'top';
  const title = texts.title || '';
  // ★ 2026-09-06(2) 폭 맞춤 — 한글 한 글자 폭 ≈ size×H 이므로 글자수×size×H ≤ 0.9×W 가 되게 상한(포스터 3:4 · 배너 16:9). 실측 17자가 포스터 양끝을 넘었다.
  const wh = top ? 1792 / 2400 : 16 / 9;
  const fit = (base: number, len: number) => Math.max(0.02, Math.min(base, (0.9 * wh) / Math.max(1, len)));
  const titleSize = fit(top ? (title.length > 14 ? 0.052 : title.length > 9 ? 0.062 : 0.072) : (title.length > 14 ? 0.09 : 0.12), title.length);
  if (texts.label) out.push({ text: texts.label, fontPath: opts.fontPath, size: top ? 0.022 : 0.045, color: '#ffffff', align: 'center', x: 0.5, y: top ? 0.065 : 0.60, role: 'badge', badgeColor: opts.brandColor || '#111111', weight: 'bold' });
  if (title) out.push({ text: title, fontPath: opts.fontPath, size: titleSize, color: '#111111', align: 'center', x: 0.5, y: top ? 0.115 : 0.69, weight: 'bold' });
  if (texts.subtitle) out.push({ text: texts.subtitle, fontPath: opts.fontPath, size: fit(top ? 0.03 : 0.055, texts.subtitle.length), color: '#333333', align: 'center', x: 0.5, y: top ? (0.115 + titleSize + 0.035) : 0.86, weight: 'bold' });
  return out as ComposeTypography[];
}

/** 합성 폰트 — 저장소 fonts/malgunbd.ttf(굵은 한글) 우선 · STUDIO_FONT_DIR · 없으면 null(py 기본 폴백) */
export function outreachPosterFontPath(): string | null {
  const cands = [
    path.resolve('./fonts/malgunbd.ttf'),
    path.resolve(__dirname, '../../fonts/malgunbd.ttf'),
    path.join(process.env.STUDIO_FONT_DIR || path.resolve('./uploads/fonts'), 'malgunbd.ttf'),
  ];
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch { /* 다음 */ } }
  return null;
}

// ===== ★ 2026-09-06 S3 vision 채점 (보조 신호 · 잠금 아님 · 장애 = unavailable) =====

export interface PosterScore { outcome: 'ok' | 'undetermined' | 'unavailable'; digits: boolean | null; headlineVisible: boolean | null }

/** 포스터 유출 검사 1순위 = 요청하지 않은 숫자·퍼센트·원 표기(모델 배경이 지어낸 글자) · 2순위 = 헤드라인 문자 존재(폰트 부재 검출). */
export async function scoreOutreachPoster(base64: string, mime: string): Promise<PosterScore> {
  try {
    const raw = await callOutreachAi({
      system: '마케팅 포스터 이미지를 검사한다. JSON 하나만 출력: {"digits": true|false, "headline": true|false}. digits = 이미지 안에 숫자·퍼센트(%)·원(₩) 표기가 하나라도 보이면 true. headline = 큰 한글 헤드라인 글자가 또렷하게 읽히면 true. 설명 금지.',
      userMessage: '검사해라.',
      maxTokens: 40,
      temperature: 0,
      source: 'sales-outreach-poster-check',
      images: [{ media_type: mime, data: base64 }],
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { outcome: 'undetermined', digits: null, headlineVisible: null };
    const j = JSON.parse(m[0]);
    const digits = typeof j.digits === 'boolean' ? j.digits : null;
    const headline = typeof j.headline === 'boolean' ? j.headline : null;
    return { outcome: digits === null && headline === null ? 'undetermined' : 'ok', digits, headlineVisible: headline };
  } catch (err: any) {
    console.log('[sales-outreach] 포스터 채점 불가(장애):', err?.message);
    return { outcome: 'unavailable', digits: null, headlineVisible: null };
  }
}

export type DmVisionItem = 'hero_image_full' | 'price_pair_visible' | 'cta_bar_visible' | 'no_duplicate_image' | 'text_readable' | 'gray_box_zero' | 'number_leak_zero' | 'sections_enough'
  /** ★ v3 채점 12항목(설계서 §7-7 · 불변 36) — 설명 없는 이미지 0 · 첫 화면 헤드라인 · 브랜드 색 일관 · 글자 잘림 0 */
  | 'uncaptioned_image_zero' | 'first_screen_has_headline' | 'brand_color_consistent' | 'text_clipping_zero';
export interface DmVisionScore { outcome: 'ok' | 'undetermined' | 'unavailable'; items: Partial<Record<DmVisionItem, boolean>> | null; at: string }

/** 채점 항목 12(★ v3) — review.ts VISION_WARNING_OF 키 · 프론트 QUALITY_LABEL 과 파리티 테스트로 결속 */
export const DM_VISION_ITEMS: readonly DmVisionItem[] = [
  'hero_image_full', 'price_pair_visible', 'cta_bar_visible', 'no_duplicate_image', 'text_readable', 'gray_box_zero', 'number_leak_zero', 'sections_enough',
  'uncaptioned_image_zero', 'first_screen_has_headline', 'brand_color_consistent', 'text_clipping_zero',
];
/** 자동 재조립(1회) 트리거 항목 — false 면 조립만 다시(설계서 §7-8) */
export const DM_VISION_RETRY_ITEMS: readonly DmVisionItem[] = ['uncaptioned_image_zero', 'first_screen_has_headline', 'text_clipping_zero'];

/**
 * 발행된 DM 을 렌더 워커가 375폭으로 캡처해 디자이너 8항목을 2값으로 채점한다(회의 수렴안 D5 · 실물 기준값). 워커 부재·장애 = null(채점 없음 · 발송 무영향).
 * 자동 재생성은 하지 않는다(사람 [다시 만들기] · 품질 경고로만).
 */
export async function captureAndScoreDm(viewerUrl: string, opts: { companyId?: string | null } = {}): Promise<{ score: DmVisionScore | null; captureUrl: string | null }> {
  const shot = await renderPageGuarded(viewerUrl, { screenshot: true, screenshotViewport: true, viewportWidth: 375, deadlineMs: 20_000, requestTimeoutMs: 40_000 });
  if (!shot.ok) return { score: null, captureUrl: null };
  // ★ 0906(3) 첫 화면 캡처(375×900)를 공개 사본으로 저장 — 제안 메일이 "자동으로 만든 모바일 DM" 을 실물 그대로 보여준다
  const companyId = opts.companyId || getOutreachContext()?.companyId || null;
  const captureUrl = shot.result.screenshotViewportBase64 ? await storeViewportCapture(shot.result.screenshotViewportBase64, companyId) : null;
  if (!shot.result.screenshotBase64) return { score: null, captureUrl };
  const score = await scoreDmCapture(shot.result.screenshotBase64);
  return { score, captureUrl };
}

/** ★ v3 뷰포트 캡처(JPEG base64) → 공개 사본 URL(우리 저장소 · 파기 시 함께 삭제) · 회사 컨텍스트 없음·실패 = null(계속) — DM 캡처·홈 첫 화면 캡처가 같은 함수 */
export async function storeViewportCapture(base64: string, companyId: string | null | undefined): Promise<string | null> {
  if (!base64 || !companyId) return null;
  try {
    const buf = Buffer.from(base64, 'base64');
    const size = readImageSize(buf);
    const tempId = writeTempBuffer(companyId, buf, { kind: 'source', ext: 'jpeg', mime: 'image/jpeg', width: size?.width || 375, height: size?.height || 900 });
    const moved = moveTempToPermanent(companyId, tempId);
    return moved ? PUBLIC_BASE + moved.url : null;
  } catch (err: any) {
    console.log('[sales-outreach] 캡처 저장 실패(계속):', err?.message);
    return null;
  }
}

async function scoreDmCapture(screenshotBase64: string): Promise<DmVisionScore> {
  try {
    const raw = await callOutreachAi({
      system: [
        '모바일 마케팅 페이지 전체 캡처를 검사한다. 각 항목을 true/false 로만 답하고 JSON 하나만 출력한다(설명 금지).',
        '{"hero_image_full": 첫 화면(머리말 다음 1~2번째 블록)에 폭 100% 이미지가 있다,',
        ' "price_pair_visible": 상품 카드에 취소선 정가와 판매가 쌍이 보인다(상품 카드가 없으면 false),',
        ' "cta_bar_visible": 브랜드 색 풀폭 버튼이 하나 이상 보인다,',
        ' "no_duplicate_image": 같은 이미지가 두 번 이상 나오지 않는다,',
        ' "text_readable": 이미지 위 글자가 배경과 대비되어 읽힌다,',
        ' "gray_box_zero": 회색 빈 상자(이미지 자리 비움)가 하나도 없다,',
        ' "number_leak_zero": 생성 이미지 안에 숫자·퍼센트·원 표기가 없다(상품 카드의 가격 텍스트는 제외),',
        ' "sections_enough": 구획(섹션)이 9개 이상 13개 이하다,',
        ' "uncaptioned_image_zero": 설명 글자(제목 또는 한 줄 문구)가 하나도 붙지 않은 이미지 블록이 없다(상품 카드·첫 화면 이미지는 제외),',
        ' "first_screen_has_headline": 첫 화면(스크롤 전)에 읽을 수 있는 헤드라인 글자가 있다,',
        ' "brand_color_consistent": 버튼·밴드·태그에 쓰인 강조색이 한 계열이다(서로 다른 강조색이 섞이지 않는다),',
        ' "text_clipping_zero": 잘리거나 겹쳐서 끝이 보이지 않는 글자가 없다}',
      ].join('\n'),
      userMessage: '검사해라.',
      maxTokens: 300,
      temperature: 0,
      source: 'sales-outreach-dm-vision',
      images: [{ media_type: 'image/jpeg', data: screenshotBase64 }],
    });
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { outcome: 'undetermined', items: null, at: new Date().toISOString() };
    const j = JSON.parse(m[0]);
    const items: Partial<Record<DmVisionItem, boolean>> = {};
    for (const k of DM_VISION_ITEMS) if (typeof j[k] === 'boolean') items[k] = j[k];
    return { outcome: Object.keys(items).length ? 'ok' : 'undetermined', items: Object.keys(items).length ? items : null, at: new Date().toISOString() };
  } catch (err: any) {
    console.log('[sales-outreach] DM 채점 불가(장애):', err?.message);
    return { outcome: 'unavailable', items: null, at: new Date().toISOString() };
  }
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
  /** ★ 2026-09-06 S3 문구 3칸 재료 — 선택 행사 인용(면허 무관 · 숫자·혜택어는 칸에서 거부) · 상품명 · 사이트 제목 */
  eventQuote?: string | null;
  products?: ReadonlyArray<Pick<OutreachProduct, 'name'>>;
  siteTitle?: string | null;
  /** ★ S3 실측 배너가 0장일 때만 16:9 배너 1장을 더 만든다(회의 수렴안 · 원가 = 그때만) */
  wantBanner?: boolean;
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
    let cutoutPath: string | null = null;
    let cutoutSource: 'alpha_png' | 'rembg' | null = null;
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
        } else if (img.ext === 'png' && pngHasAlpha(img.buffer)) {
          // ★ S3 몰이 준 누끼 PNG — rembg(단일 워커) 우회 · 해상도 게이트만
          const size = readImageSize(img.buffer);
          if (!size || Math.min(size.width, size.height) < 300) {
            skippedReason = '이미지 해상도가 낮아 생성 이미지로만 제작했습니다.';
          } else {
            const cut = allocTempPath(ctx.companyId, 'png');
            fs.writeFileSync(cut.absPath, img.buffer);
            writeTempMeta(ctx.companyId, cut.tempId, { kind: 'cutout', ext: 'png', mime: 'image/png', width: size.width, height: size.height });
            cutout = { base64: img.buffer.toString('base64'), mime: 'image/png' };
            cutoutPath = cut.absPath;
            cutoutSource = 'alpha_png';
          }
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
            cutoutPath = cut.absPath;
            cutoutSource = 'rembg';
          }
        }
      }
    }

    // ★ S3 문구 3칸(원문 대조본만 · 숫자·혜택어 0) — 프롬프트에는 문구를 넘기지 않고(배경만 생성 · 상단 문구 구역 확보) 서버 합성이 코드로 찍는다(오철자 0 · 잠금이 못 보는 면에 글자를 코드가 보증)
    const posterTexts = buildOutreachPosterTexts({
      companyName: input.companyName, industry: input.industry, eventQuote: input.eventQuote || null, products: input.products || [], siteTitle: input.siteTitle || null,
    });
    const fontPath = outreachPosterFontPath();
    const template = pickTemplate(input.industry, `${input.jobId}:${input.regenSeq || 0}`, !!cutout);
    const preset = resolvePreset('poster');
    const buildPrompt = (seedSuffix: string) => buildPosterPrompt({
      template: seedSuffix ? pickTemplate(input.industry, `${input.jobId}:${input.regenSeq || 0}:${seedSuffix}`, !!cutout) : template,
      preset,
      texts: {},
      hasProduct: !!cutout,
      userHint: posterStyleHint(input.brandColor || null),
      textPosition: 'top',
    });
    void cutoutPath;

    const renderPoster = async (prompt: string): Promise<{ absPath: string; tempId: string; composed: { width: number; height: number } }> => {
      const poster = await generatePoster(prompt, preset, cutout);
      const posterExt = poster.mime.includes('png') ? 'png' : 'jpeg';
      const posterTempId = writeTempBuffer(ctx.companyId, Buffer.from(poster.base64, 'base64'),
        { kind: 'poster', ext: posterExt, mime: poster.mime, prompt, presetKey: 'poster', channelSpec: 'poster', width: null, height: null });
      const posterFile = findTempFile(ctx.companyId, posterTempId);
      if (!posterFile) throw new Error('포스터 임시 저장에 실패했습니다.');
      // 이메일 삽입은 JPEG만(알파 PNG 직삽 금지 — 다크 클라이언트 흰 프린지·용량) · 문구는 서버 타이포(코드 보증)
      const out = allocTempPath(ctx.companyId, 'jpeg');
      const composed = await composeImage({
        bgPath: posterFile.absPath, cutoutPath: null, outPath: out.absPath, format: 'jpeg',
        typography: buildPosterTypography(posterTexts, { brandColor: input.brandColor || null, zone: 'top', fontPath }),
      });
      writeTempMeta(ctx.companyId, out.tempId, { kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', width: composed.width, height: composed.height });
      return { absPath: out.absPath, tempId: out.tempId, composed };
    };

    let made = await renderPoster(buildPrompt(''));
    // ★ S3 유출 검사(1순위 숫자·%·원) — 걸리면 배경만 1회 다시 만든다(기존 재생성 상한과 별개 · 자동 1회)
    let posterScore: PosterScore | null = null;
    let posterRegenerated = false;
    try {
      posterScore = await scoreOutreachPoster(fs.readFileSync(made.absPath).toString('base64'), 'image/jpeg');
      if (posterScore.digits === true) {
        const retry = await renderPoster(buildPrompt('retry'));
        const again = await scoreOutreachPoster(fs.readFileSync(retry.absPath).toString('base64'), 'image/jpeg');
        posterRegenerated = true;
        if (again.digits !== true) { made = retry; posterScore = again; }
      }
    } catch (err: any) {
      console.log('[sales-outreach] 포스터 유출 검사 건너뜀:', err?.message);
    }
    const moved = moveTempToPermanent(ctx.companyId, made.tempId);
    if (!moved) throw new Error('이미지 저장에 실패했습니다.');

    // ★ S3 16:9 배너 — 실측 배너 0장일 때만(첫 화면 폴백 · 이메일 히어로) · 실패는 격리(포스터 결과에 영향 0)
    let bannerUrl: string | null = null;
    let bannerSize: { width: number; height: number } | null = null;
    if (input.wantBanner) {
      try {
        const bPreset = resolvePreset('email-hero');
        const bTemplate = pickTemplate(input.industry, `${input.jobId}:${input.regenSeq || 0}:banner`, !!cutout);
        const bPrompt = buildPosterPrompt({ template: bTemplate, preset: bPreset, texts: {}, hasProduct: !!cutout, userHint: posterStyleHint(input.brandColor || null), textPosition: 'bottom' });
        const b = await generatePoster(bPrompt, bPreset, cutout);
        const bExt = b.mime.includes('png') ? 'png' : 'jpeg';
        const bTempId = writeTempBuffer(ctx.companyId, Buffer.from(b.base64, 'base64'), { kind: 'poster', ext: bExt, mime: b.mime, prompt: bPrompt, presetKey: 'email-hero', channelSpec: 'email', width: null, height: null });
        const bFile = findTempFile(ctx.companyId, bTempId);
        if (bFile) {
          const bOut = allocTempPath(ctx.companyId, 'jpeg');
          const bComposed = await composeImage({
            bgPath: bFile.absPath, cutoutPath: null, outPath: bOut.absPath, format: 'jpeg',
            typography: buildPosterTypography(posterTexts, { brandColor: input.brandColor || null, zone: 'bottom', fontPath }),
          });
          writeTempMeta(ctx.companyId, bOut.tempId, { kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', width: bComposed.width, height: bComposed.height });
          const bMoved = moveTempToPermanent(ctx.companyId, bOut.tempId);
          if (bMoved) { bannerUrl = PUBLIC_BASE + bMoved.url; bannerSize = { width: bComposed.width, height: bComposed.height }; }
        }
      } catch (err: any) {
        console.log('[sales-outreach] 16:9 배너 생성 실패(격리):', err?.message);
      }
    }

    return {
      publicUrl: PUBLIC_BASE + moved.url,
      usedCutout: !!cutout,
      personJudge,
      skippedReason,
      width: made.composed.width,
      height: made.composed.height,
      templateId: template.id,
      category: template.category,
      kind: template.kind === 'event' ? 'event' : 'product',
      posterTexts,
      cutoutSource,
      posterScore,
      posterRegenerated,
      bannerUrl,
      bannerSize,
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
  /** ★ 2026-09-06(2) 홈페이지 배너 문구(정리본) — 갤러리 앞 설명 카드는 이 목록 안에서만 */
  bannerCaptions?: readonly string[] | null;
  /** ★ v3 입구(필수 · 설계서 §7-2) — 아웃리치 = gallery 0 계약 · 고객 = 현행 계약. 옛 테스트 호출(값 없음)은 customer 로 읽힌다. */
  entry: EngineEntry;
  /** ★ v3 행사 카드(제목·기간 원문 · ≤3) — 프롬프트 [진행 중 행사] 블록(이 안의 말만) */
  eventCards?: readonly EngineEventCard[] | null;
}

// ===== ★ 2026-09-06(2) 배너 문구(alt) 정리 — 갤러리 캡션·설명 카드의 사실 원천(순수) =====

const BANNER_ALT_NOISE_RE = /^(main|top|sub|pc|mobile|mo|banner|bnr|slide|img|image|visual|kv|배너|메인|비주얼|슬라이드|이미지|사진)?[\s_\-\d.]*$|\.(jpe?g|png|webp|gif|svg)$|^(banner|bnr|slide|img|kv|main)[\s_\-\d]*$/i;

/** alt 원문 → 캡션 정리본. 4자 미만 · 파일명 · "배너1"류 · 업체명 단독 · 글자(한글·영문) 없음 = null. 60자 상한. */
export function cleanBannerCaption(raw: string | null | undefined, companyName?: string): string | null {
  const t = String(raw || '').replace(/\s+/g, ' ').replace(/[\u200b\u00a0]/g, ' ').trim();
  if (!t || t.length < 4 || t.length > 200) return null;
  if (BANNER_ALT_NOISE_RE.test(t)) return null;
  // 잡음 낱말·숫자만으로 이뤄진 문구("메인 비주얼 2")도 버린다
  if (t.split(/[\s_\-.]+/).filter(Boolean).every((w) => /^(main|top|sub|pc|mobile|mo|banner|bnr|slide|img|image|visual|kv|배너|메인|비주얼|슬라이드|이미지|사진|\d+)$/i.test(w))) return null;
  if (!/[가-힣A-Za-z]{2,}/.test(t)) return null;
  if (companyName && t.replace(/\s+/g, '') === String(companyName).replace(/\s+/g, '')) return null;
  return t.slice(0, 60).replace(/[\s.·!。:]+$/g, '').trim() || null;
}

/** 크롤 재료 v2(materials.banners[{url, alt}]) → url → alt 사전(수집 단계 입력) */
export function bannerAltMapOf(materials: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const banners = (materials as any)?.banners;
  if (!Array.isArray(banners)) return out;
  for (const b of banners) {
    const url = String(b?.url || '').trim();
    const alt = String(b?.alt || '').trim();
    if (url && alt && !out[url]) out[url] = alt;
  }
  return out;
}

/** 사용자 메시지(순수) — 재료 블록 + 재료 용량. */
export function buildOutreachMaterialBlock(i: OutreachGenInput, want: string, channel: 'DM' | 'EMAIL'): string {
  // 상품 묶음 = 한 묶음에 최대 6개(직원 실물 = 6개 카드 스와이프) · 8개 이상일 때만 2묶음 · 갤러리 = 배너 2장씩(히어로 1장 제외)
  // ★ v3 아웃리치 DM 은 gallery 0(이미지 블록은 코드가 행사 카드로 세운다) · 상품 6개 = 2+4 두 묶음(설계서 §5-3)
  const isOutreachDm = i.entry === 'outreach' && channel === 'DM';
  const carousels = isOutreachDm
    ? (i.products.length >= 6 ? 2 : i.products.length >= 2 ? 1 : 0)
    : (i.products.length >= 8 ? 2 : i.products.length >= 2 ? 1 : 0);
  const perGallery = channel === 'DM' ? 2 : 2;
  const galleries = isOutreachDm ? 0 : Math.min(2, Math.floor(Math.max(0, i.galleryCount - 1) / perGallery));
  const hasDiscount = i.products.some((p) => p.discount_price);
  const fmt = (n: number | null) => (n === null || n === undefined ? '' : `${Number(n).toLocaleString()}원`);
  const cards = (i.eventCards || []).filter((c) => c && String(c.title || '').trim());
  return [
    `[대상 업체] ${i.companyName} (업종: ${industryLabel(i.industry)}) · 홈페이지: ${i.homepageUrl}${i.siteTitle ? ` · 사이트 제목: ${i.siteTitle}` : ''}`,
    cards.length
      ? `[진행 중 행사 ${cards.length}건 · 홈페이지 이벤트 목록의 제목·기간 원문 · hero 와 text_card 는 이 안의 말만 · 순서 = 이 순서]\n${cards.map((c, n) => `${n + 1}. ${c.title}${c.periodRaw ? ` (기간: ${c.periodRaw})` : ''}`).join('\n')}`
      : '',
    `[홈페이지에서 읽은 내용]\n${(i.material || '').slice(0, 6000)}`,
    i.extraNotes ? `[담당자 추가 정보]\n${i.extraNotes.slice(0, 2000)}` : '',
    i.products.length
      ? `[수집한 상품 ${i.products.length}개 · 이름은 이 목록에서만]\n${i.products.map((p, n) => `${n + 1}. ${p.name} (${p.discount_price ? `${fmt(p.discount_price)} · 정가 ${fmt(p.price)}` : fmt(p.price)})`).join('\n')}`
      : '[수집한 상품] 없음(product_carousel은 넣지 마라)',
    isOutreachDm
      ? `[재료 용량] 이미지 블록(gallery)은 넣지 마라: 행사 배너·상품 사진은 코드가 채운다 · 상품 ${i.products.length}개 → product_carousel 최대 ${carousels}개(2개 이상일 때 · 첫 묶음 2개 · 둘째 묶음 4개) · cta는 2~3개(첫 상품 묶음 뒤 1개 · 마지막 1개) · ${hasDiscount ? '상품에 혜택가가 있다' : '상품 혜택가를 확보하지 못했다: 할인율·최대혜택 같은 표현을 헤드라인에 쓰지 마라'}`
      : `[재료 용량] 실측 통과 이미지 ${i.galleryCount}장 → gallery 최대 ${galleries}개 · 상품 ${i.products.length}개 → product_carousel 최대 ${carousels}개(각 2개 이상 · 한 묶음 최대 6개) · cta는 2~3개(첫 상품 묶음 뒤 1개 · 마지막 1개) · ${hasDiscount ? '상품에 혜택가가 있다' : '상품 혜택가를 확보하지 못했다: 할인율·최대혜택 같은 표현을 헤드라인에 쓰지 마라'}`,
    i.bannerCaptions && i.bannerCaptions.length
      ? `[배너 문구 · 홈페이지 배너에 적힌 글 그대로 · gallery 바로 앞 text_card 의 headline·body 는 이 안의 말과 홈페이지 본문에서만]\n${i.bannerCaptions.map((c, n) => `${n + 1}. ${c}`).join('\n')}`
      : '',
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
    // ★ v3 입구별 계약 — 아웃리치 = gallery 0(코드가 행사 카드로 이미지 블록을 세운다) · 고객 = 현행
    dmSectionContract(i.entry),
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

export async function generateSections(prompt: { system: string; user: string }, allowedTypes: readonly string[], source: string, idPrefix: string): Promise<{ sections: Section[]; raw: any }> {
  const text = await callOutreachAi({
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

export interface OutreachFillImage { url: string; width?: number; height?: number; /** 배너 문구 정리본(캡션) */ alt?: string; /** ★ v3 고객 재료 카드 묶음(행사별 이미지) */ group?: string }

export interface OutreachFillMedia {
  posterUrl: string | null;
  /** ★ 2026-09-06 S3 실측 배너가 0장일 때만 만든 16:9 생성 배너(히어로 폴백 · 갤러리가 있으면 쓰지 않는다) */
  bannerUrl?: string | null;
  bannerSize?: { width: number; height: number } | null;
  /** 포스터 실측 크기(갤러리 두 번째 비주얼 · 비율 표) */
  posterSize?: { width: number; height: number } | null;
  /** ★ 2026-09-06(2) 포스터 캡션(3칸 title · 숫자 0) · 면허 인용(캡션 혜택 차단 기준 · 없으면 '') */
  posterCaption?: string | null;
  licensedQuote?: string;
  /** ★ 0905(5) 헤더 로고 사본 URL(없으면 브랜드명 글자만) */
  logoUrl?: string | null;
  /** ★ v3 행사 카드(선택 순서 · ≤3 · bannerUrl 은 사본) — 아웃리치 entry 에서 hero·text_card+cta 의 원천 */
  eventCards?: EngineEventCard[] | null;
  /** 실측 통과 사본(폭·높이 동승 — 비율 군 분류·룩 배정에 쓴다). 문자열 배열도 받는다(비율 미상 = square 취급). */
  gallery: Array<OutreachFillImage | string>;
  products: OutreachProduct[];
  ctaLinks: Record<string, string>;
  homepageUrl: string;
  legal: { legal: string | null; csPhone: string | null } | null;
  companyName: string;
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
    // 할인가는 정가보다 낮을 때만(같으면 같은 가격이 두 번 찍힌다 · 이니스프리 첫 실측)
    ...(x.discount_price && x.price && x.discount_price < x.price ? { discount_price: x.discount_price } : {}),
    // ★ 2026-09-06 S2 카드 원문에 있던 할인율(문자열)만 — 렌더러 computeDmDiscountRate 가 수동값 우선 · 없으면 가격 쌍으로 계산(공용 규칙 그대로)
    // ★ v3 정정(이니스프리 첫 실측 "28% 19,200원 19,200원"): 할인가 쌍이 없는 상품에 목록 할인율만 덧입히면 같은 가격이 두 번 찍힌다 → 할인가가 있을 때만
    ...(x.discount_price && x.price && x.discount_price < x.price && typeof x.discount_rate === 'number' && x.discount_rate > 0 && x.discount_rate < 100 ? { discount_rate: x.discount_rate } : {}),
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
  /** ★ v3 입구(마지막 인자 · 기본 customer = 옛 3인자 호출 무변경) — outreach 는 gallery 0 · 행사 카드 → hero/text_card+cta */
  entry: EngineEntry = 'customer',
): { sections: Section[]; filled: number } {
  if (entry === 'outreach') return fillOutreachDmMediaV3(sections, media, channel);
  // ★ v3 고객 입구에 행사 카드가 있으면(설계서 §10) 같은 표준으로 짜고, 카드에 묶인 나머지 이미지는 카드 제목을 캡션으로 단 갤러리로 뒤따른다(고객 계약은 gallery 허용)
  if (Array.isArray(media.eventCards) && media.eventCards.length > 0) return fillOutreachDmMediaV3(sections, media, channel, { groupGallery: true });
  const galleryAll = (media.gallery || []).map(toFillImage);
  // ★ S3 실측 배너 0장 → 생성 배너(16:9)가 첫 화면(히어로)을 맡는다 · 배너가 있으면 생성물은 뒤로(불변 26 히어로 = 실물 우선)
  if (galleryAll.length === 0 && media.bannerUrl) galleryAll.push({ url: media.bannerUrl, ...(media.bannerSize || {}) });
  // ★ 0905(5) 히어로 = 홈 첫 배너(그 브랜드 디자이너의 실물 · 문서 순서 첫 장) → 없으면 포스터 → 상품. 포스터는 두 번째 비주얼(첫 갤러리 첫 장).
  const heroImage = galleryAll[0]?.url || media.posterUrl || media.products[0]?.image_url || '';
  const remaining: OutreachFillImage[] = galleryAll.filter((g) => g.url !== heroImage);
  // ★ 2026-09-06(2) 포스터(3:4)는 16:9 배너 갤러리에 섞지 않는다 — hero 가 있으면 그 다음 자기 블록(캡션 1줄)으로 코드가 넣는다(아래 posterBlock) · hero 가 없는 조각이면 옛 자리(첫 갤러리 첫 장)
  const posterAsBlock = !!media.posterUrl && heroImage !== media.posterUrl && sections.some((s) => s && typeof s === 'object' && s.type === 'hero');
  if (media.posterUrl && heroImage !== media.posterUrl && !posterAsBlock) remaining.unshift({ url: media.posterUrl, ...(media.posterSize || {}) });
  const quoteForCaption = media.licensedQuote || '';
  const captionOf = (alt: string | null | undefined): string | null => {
    const c = cleanBannerCaption(alt, media.companyName);
    if (!c) return null;
    const t = stripUnauthorizedBenefits(c, quoteForCaption);
    return t.includes(BENEFIT_PLACEHOLDER) ? null : t.trim() || null;
  };
  // 갤러리 = 배너 통째 목록(list_1xN)이라 비율 군 분류가 필요 없다 — 문서 순서대로 잘라 넣는다(2장 미만이면 비움)
  const takeGallery = (n: number): OutreachFillImage[] => (remaining.length >= 2 ? remaining.splice(0, n) : []);
  const galleryLink = galleryLinkOf(media);
  // ★ 0905(3) 이미지 잘림 정정(Harold 접수 · 공개 샘플 4dbf85c91c) — 렌더러의 고정 높이 박스는 cover가 기본이라 세로형(0.86) 상품 사진이 37~47% 잘렸다.
  //   상품 캐러셀은 항상 contain(상품이 통째로 보여야 한다 · 두 렌더러가 image_fit을 읽는다) · 히어로는 세로형(비율 < 1)일 때만 contain. 공용 렌더러 무변경(불변 20).
  const heroDims = galleryAll.find((g) => g.url === heroImage) || (media.posterUrl && heroImage === media.posterUrl && media.posterSize ? { url: heroImage, ...media.posterSize } : null);
  const heroRatio = heroDims && heroDims.width && heroDims.height ? heroDims.width / heroDims.height : null;
  const heroPortrait = heroRatio !== null && heroRatio < 1;
  const heroLandscape = heroRatio !== null && heroRatio >= LANDSCAPE_RATIO;
  const heroIsPoster = !!media.posterUrl && heroImage === media.posterUrl;
  const usedCta = new Set<string>();
  let prodCursor = 0;
  // ★ 0905(4) 갤러리 = 홈페이지 배너를 통째로(1열 · 원본 비율 · 2장씩) — 격자 썸네일은 배너 속 글씨가 읽히지 않아 "썸네일 덤프"가 된다(직원 실물은 배너를 섹션처럼 쓴다)
  const perGallery = 2;
  const perCarousel = 6;
  // ★ 2026-09-06 S2 CTA 라벨 = 목적지 이름형(직원 실물 15개 중 8자 이하 1개 · 평균 13자) · DM 16자 · EMAIL 8자 유지(VML 버튼 폭)
  const maxLabel = channel === 'DM' ? 16 : 8;
  const stripTrailingPunct = (t: unknown) => String(t || '').replace(/[\s.·!。:]+$/g, '').trim();
  let filled = 0;
  let heroDone = false;
  const out = sections.flatMap((s): Section[] => {
    if (!s || typeof s !== 'object') return [s];
    const p: any = { ...((s.props as any) || {}) };
    switch (s.type) {
      case 'header':
        p.brand_name = media.companyName;
        // ★ 0905(5) 헤더 로고 사본(Harold 결재 · 불변 11 개정) — 있으면 로고 + 브랜드명, 없으면 워드마크 글자 크게
        if (channel === 'EMAIL') { p.variant = 'logo'; p.align = 'left'; } else { p.variant = 'logo'; p.align = 'center'; p.brand_size = 'lg'; }
        if (media.logoUrl) { p.logo_url = media.logoUrl; p.logo_size = 'md'; }
        return [{ ...s, props: p } as Section];
      case 'hero':
        if (!heroDone && heroImage) {
          p.image_url = heroImage; heroDone = true; filled++;
          // DM = 룩이 split(브랜드 색 밴드 + 이미지 전체 · 고정 박스 없음)이라 맞춤 불필요 · EMAIL = 고정 박스라 항상 contain(배너 속 글씨를 자르지 않는다) · 가로형은 낮은 박스(md)+classic
          if (channel === 'EMAIL') { p.image_fit = 'contain'; }
          else if (!heroIsPoster && heroPortrait) p.image_fit = 'contain';
        }
        if (channel === 'EMAIL') { p.height = heroLandscape ? 'md' : 'lg'; p.align = 'center'; }
        return [{ ...s, props: p } as Section];
      case 'gallery': {
        const g = takeGallery(perGallery);
        // ★ 2026-09-06(2) 이미지별 캡션 = 홈페이지 배너 문구(사실 · 면허 밖 혜택 수치는 차단) — 렌더러가 caption 을 그린다
        p.images = g.length >= 2 ? g.map((img) => { const caption = captionOf(img.alt); return { url: img.url, alt: caption || `${media.companyName} 이미지`, link_url: galleryLink, ...(caption ? { caption } : {}) }; }) : [];
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
  // ★ 2026-09-06(2) 포스터 블록 — 히어로 다음 두 번째 비주얼(히어로가 포스터면 없음) · 캡션 = 포스터 title(숫자 0)
  if (posterAsBlock && media.posterUrl) {
    const heroIdx = out.findIndex((s) => s.type === 'hero');
    const headerIdx = out.findIndex((s) => s.type === 'header');
    const at = heroIdx >= 0 ? heroIdx + 1 : headerIdx >= 0 ? headerIdx + 1 : 0;
    const caption = media.posterCaption ? captionOf(media.posterCaption) : null;
    const posterBlock = {
      id: `so-poster-${out.length}-gallery`, type: 'gallery', order: 0, visible: true,
      props: { ...((getDefaultProps('gallery' as SectionType) as unknown as Record<string, unknown>) || {}), images: [{ url: media.posterUrl, alt: caption || media.companyName, link_url: galleryLink, ...(caption ? { caption } : {}) }], layout: 'list_1xN', title: '' },
    } as unknown as Section;
    out.splice(at, 0, posterBlock);
    filled++;
  }
  // ★ 2026-09-06(2) 갤러리 앞 설명 카드 — 모델이 안 넣었고 캡션(사실)이 있으면 코드가 배너 문구로 채운다(실물 DM = 비주얼 블록 앞에 한 줄 헤드라인)
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.type !== 'gallery' || String((s as any).id || '').startsWith('so-poster-')) continue;
    const caps = (Array.isArray((s.props as any)?.images) ? (s.props as any).images : []).map((im: any) => String(im?.caption || '').trim()).filter(Boolean);
    if (caps.length === 0) continue;
    const prev = out[i - 1];
    if (prev && prev.type === 'text_card') continue;
    const lead = {
      id: `so-lead-${i}-text_card`, type: 'text_card', order: 0, visible: true,
      props: { ...((getDefaultProps('text_card' as SectionType) as unknown as Record<string, unknown>) || {}), tag: posterCategoryLabel(caps.join(' '), null) || '', headline: caps[0].slice(0, 28), body: caps.slice(1).join(' · ') },
    } as unknown as Section;
    out.splice(i, 0, lead);
    i++;
    filled++;
  }
  // ★ 0905(4) CTA 2개 보장 — 모델이 1개만 내면 첫 상품 묶음(없으면 첫 갤러리) 뒤에 코드가 1개 끼운다(직원 실물 = CTA 2~3회)
  const ctaCount = out.filter((s) => s.type === 'cta').length;
  if (ctaCount < 2) {
    const anchorIdx = out.findIndex((s) => s.type === 'product_carousel' && Array.isArray((s.props as any)?.products) && (s.props as any).products.length > 0);
    const galleryIdx = out.findIndex((s) => s.type === 'gallery' && !String((s as any).id || '').startsWith('so-poster-') && Array.isArray((s.props as any)?.images) && (s.props as any).images.length > 0);
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

// ===== ★ 2026-09-06 v3 아웃리치 DM 채우기(entry outreach · 설계서 §7 블록 표준 13행 · 불변 35) =====

/** 섹션 상한(증거 카드 포함) · 절단 순서 = 증거 카드(insertProofCard 가 스스로 건너뛴다) → 둘째 상품 묶음 → 둘째 행사 카드(+cta) → 모델 text_card */
export const OUTREACH_SECTION_MAX = 13;
export const OUTREACH_TRIM_ORDER = ['proof', 'carousel#2', 'event#2', 'model_text'] as const;
/** 상품 6개 = 2 + 4(첫 묶음 focus · 둘째 묶음 classic 2열) · 홀수 금지 */
export const OUTREACH_CAROUSEL_FOCUS = 2;
export const OUTREACH_CAROUSEL_CLASSIC = 4;

/** 면허 없는 카드 제목에서 걷어낼 수치와 수치 수식어(차단기가 prop 째 비우기 전에 코드가 먼저 정리한다 · 검증 B7). "세일·할인" 같은 낱말은 수치가 아니라 남긴다(차단기도 걷지 않는다). */
const CARD_BENEFIT_TOKEN_RE = /~?\s*\d[\d,.]*\s*(?:%|원|만원|천원|퍼센트)\s*~?|\d\s*\+\s*\d|(?:^|\s)(?:최대|단돈|무려|최저|OFF|off|~)(?=\s|$)/g;

/**
 * 행사 카드 → 헤드라인(순수). 면허 있음 = 제목 원문 18자 · 없음 = 수치·판촉 낱말을 뺀 앞머리 18자 · 6자 미만이면 강등(demoted · 호출자가 hero 대신 text_card 로 내리거나 카드를 생략).
 * 면허 없는 "최대 50% 기획전" 을 원문으로 실으면 차단기가 headline 을 prop 째 비워 업체명이 대체된다(HERO_FALLBACK 상시) — 그 자리를 막는다.
 */
/** 연도 없는 날짜·기간 조각("9.1(화) ~ 9.6(일)" · "~ 9/30") — 제목·라벨에서 걷는다(이니스프리 첫 실측: 카드 첫 줄이 날짜라 헤드라인·버튼이 날짜가 됐다) */
const CARD_DATE_TOKEN_RE = /(?:\d{1,2}\s*[./]\s*\d{1,2}|\d{1,2}월\s*\d{1,2}일)(?:\s*\([월화수목금토일]\))?(?:\s*[~\-–]\s*(?:\d{1,2}\s*[./]\s*\d{1,2}|\d{1,2}월\s*\d{1,2}일)(?:\s*\([월화수목금토일]\))?)?|\([월화수목금토일]\)/g;

/** 낱말 경계에서 자른다(n자 안에서 마지막 공백 · 공백이 앞 절반 안에 없으면 그냥 자른다) */
function cutAtWord(s: string, n: number): string {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp >= Math.floor(n / 2) ? cut.slice(0, sp) : cut).replace(/[\s~·\-–:,]+$/g, '').trim();
}

export function headlineFromCard(card: { title: string } | null | undefined, licensed: boolean): { headline: string; demoted: boolean } {
  // 날짜 조각은 면허와 무관하게 제목이 아니다(기간은 sub_copy·body 가 따로 든다)
  const raw = String(card?.title || '').replace(CARD_DATE_TOKEN_RE, ' ').replace(/^[\s~·\-–:,]+|[\s~·\-–:,]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!raw || !/[가-힣A-Za-z]{2,}/.test(raw)) return { headline: '', demoted: true };
  if (licensed) return { headline: cutAtWord(raw, 18), demoted: false };
  const base = raw.replace(CARD_BENEFIT_TOKEN_RE, ' ').replace(/^[\s~·\-–:,]+|[\s~·\-–:,]+$/g, '').replace(/\s+/g, ' ').trim();
  const head = cutAtWord(base, 18);
  if (head.length < 6 || !/[가-힣A-Za-z]{2,}/.test(head)) return { headline: '', demoted: true };
  return { headline: head, demoted: false };
}

/** 행사 CTA 라벨(목적지 이름형 · ≤maxLabel) — 날짜·수치를 뺀 제목 앞머리(낱말 경계) + " 보기" · 못 만들면 "행사 보기" */
export function eventCtaLabel(card: { title: string }, maxLabel = 16): string {
  // 수치가 든 라벨은 차단기가 '자세히 보기' 로 바꾼다 — 처음부터 수치 없는 제목만 쓴다
  const base = headlineFromCard(card, false).headline;
  const head = cutAtWord(base, Math.max(4, maxLabel - 3));
  return (head && /[가-힣A-Za-z]{2,}/.test(head) ? `${head} 보기` : '행사 보기').slice(0, maxLabel);
}

/** 상품 CTA 라벨 — 앞머리 대괄호 꼬리표("[대용량]")를 떼고 낱말 경계 12자 + " 보기" */
export function productCtaLabel(name: string, maxLabel = 16): string {
  const base = String(name || '').replace(/^\s*(?:\[[^\]]{1,12}\]\s*)+/, '').replace(/\s+/g, ' ').trim();
  const head = cutAtWord(base, Math.max(4, maxLabel - 3));
  return (head ? `${head} 보기` : '상품 보기').slice(0, maxLabel);
}

/** 블록 최소 요건(경고만 · 삭제 0 · 설계서 §7-6) — 임계는 미검증이라 상수 1곳 · 375폭 캡처 3건 뒤 조정 */
export const OUTREACH_BLOCK_MINIMA: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  hero: { headline: 6 },
  text_card: { headline: 4 },
  cta: { label: 4 },
  product_carousel: { products: 2 },
};
export interface BlockMinimaResult { short: Array<{ type: string; field: string; len: number }>; kept: number }

/** 블록 최소 요건 검사(순수 · 삭제 0). short = 미달 목록 · kept = 검사한 섹션 수 */
export function assertBlockMinima(sections: readonly Section[], minima: Readonly<Record<string, Readonly<Record<string, number>>>> = OUTREACH_BLOCK_MINIMA): BlockMinimaResult {
  const short: BlockMinimaResult['short'] = [];
  let kept = 0;
  for (const s of Array.isArray(sections) ? sections : []) {
    if (!s || typeof s !== 'object') continue;
    const rule = minima[String(s.type)];
    if (!rule) continue;
    kept++;
    const p: any = s.props || {};
    for (const [field, min] of Object.entries(rule)) {
      if (field === 'label') {
        const labels: string[] = Array.isArray(p.buttons) ? p.buttons.map((b: any) => String(b?.label || '')) : [];
        for (const l of labels) if (l.trim().length < min) short.push({ type: String(s.type), field, len: l.trim().length });
      } else if (field === 'products') {
        const n = Array.isArray(p.products) ? p.products.length : 0;
        if (n < min) short.push({ type: String(s.type), field, len: n });
      } else {
        const len = String(p[field] || '').trim().length;
        if (len < min) short.push({ type: String(s.type), field, len });
      }
    }
  }
  return { short, kept };
}

/**
 * ★ v3 아웃리치 채우기 — 모델 조각(header · hero 문구 · text_card 0~2 · coupon · countdown 문구 · cta 라벨 · footer)을 재료로 받아 표준 순서(설계서 §7-1)를 코드가 짠다.
 *  1 header · 2 hero(카드1 배너 · 제목 · 기간) · [카드1 강등 text_card] · [포스터 text_card] · 3 cta(카드1) · [모델 text_card#1] · 4·5 스포트라이트+cta · 6 carousel focus(2) ·
 *  (증거 카드는 엔진이 뒤에 넣는다) · 8 carousel classic(4) · 9·10 카드2 text_card+cta · [모델 text_card#2] · coupon · 11 countdown · 12 cta(대표 목적지) · 13 footer.
 *  gallery 0 · 설명 없는 이미지 0 · 이미지 있는 text_card 는 classic(룩) · 상한 13(절단 순서 OUTREACH_TRIM_ORDER).
 */
function fillOutreachDmMediaV3(sections: readonly Section[], media: OutreachFillMedia, channel: 'DM' | 'EMAIL', v3opts: { groupGallery?: boolean } = {}): { sections: Section[]; filled: number } {
  const galleryAll = (media.gallery || []).map(toFillImage);
  if (galleryAll.length === 0 && media.bannerUrl) galleryAll.push({ url: media.bannerUrl, ...(media.bannerSize || {}) });
  const cards: EngineEventCard[] = (media.eventCards || []).filter((c) => c && String(c.title || '').trim()).slice(0, 3);
  const dims: LookImageDims = {};
  for (const g of galleryAll) if (g.width && g.height) dims[g.url] = { width: g.width, height: g.height };
  for (const c of cards) if (c.bannerUrl && c.bannerSize && c.bannerSize.width > 0 && c.bannerSize.height > 0) dims[c.bannerUrl] = { width: c.bannerSize.width, height: c.bannerSize.height };
  if (media.posterUrl && media.posterSize && media.posterSize.width > 0) dims[media.posterUrl] = { ...media.posterSize };
  for (const p of media.products) if ((p as OutreachMediaProduct).width && (p as OutreachMediaProduct).height) dims[p.image_url] = { width: (p as OutreachMediaProduct).width, height: (p as OutreachMediaProduct).height };
  const quoteForCaption = media.licensedQuote || '';
  const captionOf = (alt: string | null | undefined): string | null => {
    const c = cleanBannerCaption(alt, media.companyName);
    if (!c) return null;
    const t = stripUnauthorizedBenefits(c, quoteForCaption);
    return t.includes(BENEFIT_PLACEHOLDER) ? null : t.trim() || null;
  };
  const maxLabel = channel === 'DM' ? 16 : 8;
  const stripTrailingPunct = (t: unknown) => String(t || '').replace(/[\s.·!。:]+$/g, '').trim();
  const galleryLink = galleryLinkOf(media);
  const usedCta = new Set<string>();

  // --- 모델 조각 수거(순서는 코드가 정한다) ---
  const model: { header: Section | null; hero: Section | null; textCards: Section[]; carousels: Section[]; coupon: Section | null; countdown: Section | null; ctas: Section[]; footer: Section | null } =
    { header: null, hero: null, textCards: [], carousels: [], coupon: null, countdown: null, ctas: [], footer: null };
  for (const s of sections) {
    if (!s || typeof s !== 'object') continue;
    switch (s.type) {
      case 'header': if (!model.header) model.header = s; break;
      case 'hero': if (!model.hero) model.hero = s; break;
      case 'text_card': if (model.textCards.length < 2 && !(s.props as any)?.image_url) model.textCards.push(s); break;
      case 'product_carousel': model.carousels.push(s); break;
      case 'coupon': if (!model.coupon) model.coupon = s; break;
      case 'countdown': if (!model.countdown) model.countdown = s; break;
      case 'cta': model.ctas.push(s); break;
      case 'footer': if (!model.footer) model.footer = s; break;
      default: break; // gallery 등 계약 밖 = 버린다(설명 없는 이미지 블록 0)
    }
  }

  const out: Section[] = [];
  let filled = 0;
  const mk = (type: string, props: Record<string, unknown>, tagId: string): Section => ({
    id: `so-v3-${tagId}-${type}`, type, order: 0, visible: true,
    props: { ...((getDefaultProps(type as SectionType) as unknown as Record<string, unknown>) || {}), ...props },
  } as unknown as Section);
  const ctaOf = (label: string, url: string, tagId: string): Section => {
    usedCta.add(url);
    return mk('cta', { buttons: [{ label: label.slice(0, maxLabel), url, style: 'primary' }] }, tagId);
  };
  const priceLine = (p: OutreachProduct): string => {
    const fmt = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? `${Math.round(n).toLocaleString('ko-KR')}원` : '');
    return p.discount_price && p.price && p.discount_price < p.price ? `${fmt(p.discount_price)} · 정가 ${fmt(p.price)}` : fmt(p.price);
  };
  /** 행사 카드 → text_card(이미지 위 · 제목 · 기간) · 제목을 못 만들면 null(설명 없는 이미지 0) */
  const eventCardSection = (card: EngineEventCard, tagId: string): Section | null => {
    const h = headlineFromCard(card, card.licensed);
    if (h.demoted) return null;
    // 기간 원문은 면허와 무관하게 싣는다(목록 페이지의 진행 중 카드 원문 · 날짜는 혜택 수치가 아니다) · 면허(종료일 검증)는 countdown 만 가른다
    const period = card.periodRaw ? `기간 ${String(card.periodRaw).replace(/\s+/g, ' ').trim()}`.slice(0, 60) : '';
    return mk('text_card', {
      tag: posterCategoryLabel(card.title, null) || '이벤트',
      headline: h.headline,
      // 고객 입구 카드 본문(사용자가 쓴 행사 내용 · 200자) · 아웃리치 = 기간
      body: [period, card.text ? String(card.text).replace(/\s+/g, ' ').trim().slice(0, 200) : ''].filter(Boolean).join('\n'),
      align: 'left',
      ...(card.bannerUrl ? { image_url: card.bannerUrl, image_position: 'top' } : {}),
    }, tagId);
  };
  /** ★ 고객 입구 — 카드에 묶인 나머지 이미지(배너 제외 · ≤2)를 카드 제목 캡션의 갤러리로(설명 없는 이미지 0 · 고객 계약은 gallery 허용) */
  const groupGalleryOf = (card: EngineEventCard, tagId: string): Section | null => {
    if (!v3opts.groupGallery || !card.group) return null;
    const rest = galleryAll.filter((g) => g.group === card.group && g.url !== card.bannerUrl).slice(0, 2);
    if (rest.length === 0) return null;
    const caption = headlineFromCard(card, card.licensed).headline || media.companyName;
    return mk('gallery', { images: rest.map((g) => ({ url: g.url, alt: caption, caption, link_url: card.detailUrl || galleryLink })), layout: 'list_1xN', title: '' }, tagId);
  };

  // 1 header — 업체명 · 로고 사본(있으면)
  {
    const p: any = { ...((model.header?.props as any) || {}) };
    p.brand_name = media.companyName;
    if (channel === 'EMAIL') { p.variant = 'logo'; p.align = 'left'; } else { p.variant = 'logo'; p.align = 'center'; p.brand_size = 'lg'; }
    if (media.logoUrl) { p.logo_url = media.logoUrl; p.logo_size = 'md'; }
    out.push(model.header ? ({ ...model.header, props: p } as Section) : mk('header', p, 'header'));
  }

  // 2 hero — 이미지 = 카드1 배너(비율 ≥ 0.8) → 홈 첫 배너 → 포스터 → 상품 · 헤드라인 = 카드1 제목(면허 없으면 수치 제거) · 부제 = 기간
  const card1 = cards[0] || null;
  const card1Hero = !!(card1 && card1.bannerUrl && heroEligible(card1.bannerUrl, dims));
  // 폴백 히어로는 카드가 이미 가진 배너를 피한다(같은 이미지가 히어로와 카드에 두 번 = 채점 no_duplicate_image false · 리뷰 #9)
  const cardBannerSet = new Set(cards.map((c) => c.bannerUrl).filter((u): u is string => !!u));
  const heroImage = card1Hero ? String(card1!.bannerUrl) : (galleryAll.find((g) => !cardBannerSet.has(g.url))?.url || media.posterUrl || media.products[0]?.image_url || '');
  const heroDims = heroImage ? dims[heroImage] : undefined;
  const heroRatio = heroDims && heroDims.width && heroDims.height ? heroDims.width / heroDims.height : null;
  const heroIsPoster = !!media.posterUrl && heroImage === media.posterUrl;
  {
    const p: any = { ...((model.hero?.props as any) || {}) };
    if (card1) {
      const h = headlineFromCard(card1, card1.licensed);
      if (!h.demoted) p.headline = h.headline;
      if (card1.periodRaw) p.sub_copy = `기간 ${String(card1.periodRaw).replace(/\s+/g, ' ').trim()}`.slice(0, 60);
    }
    if (heroImage) {
      p.image_url = heroImage; filled++;
      if (channel === 'EMAIL') p.image_fit = 'contain';
      else if (!heroIsPoster && heroRatio !== null && heroRatio < 1) p.image_fit = 'contain';
    }
    if (channel === 'EMAIL') { p.height = heroRatio !== null && heroRatio >= LANDSCAPE_RATIO ? 'md' : 'lg'; p.align = 'center'; }
    out.push(model.hero ? ({ ...model.hero, props: p } as Section) : mk('hero', p, 'hero'));
  }
  // 2b 카드1 강등 — 배너가 있는데 히어로 비율 미달(세로형) → 이미지 위 text_card · (고객) 카드1 본문이 있으면 히어로 아래 글자 카드로
  if (card1 && ((card1.bannerUrl && !card1Hero) || (card1Hero && card1.text))) {
    const s = eventCardSection(card1, 'event1');
    if (s) {
      if (card1Hero) { const p: any = { ...(s.props as any) }; delete p.image_url; delete p.image_position; out.push({ ...s, props: p } as Section); }
      else out.push(s);
      filled++;
    }
  }
  { const g1 = card1 ? groupGalleryOf(card1, 'group1') : null; if (g1) { out.push(g1); filled++; } }
  // 2c 포스터 — 히어로가 포스터가 아니면 이미지 위 text_card(캡션 = 포스터 title · 숫자 0)
  if (media.posterUrl && !heroIsPoster) {
    const caption = media.posterCaption ? captionOf(media.posterCaption) : null;
    out.push(mk('text_card', { tag: posterCategoryLabel(caption || '', null) || '', headline: caption || media.companyName, body: '', align: 'left', image_url: media.posterUrl, image_position: 'top' }, 'poster'));
    filled++;
  }
  // 3 cta(카드1 상세 링크)
  if (card1) out.push(ctaOf(eventCtaLabel(card1, maxLabel), card1.detailUrl || galleryLink, 'cta-event1'));
  // 4 모델 text_card #1(이미지 없음 · lead)
  if (model.textCards[0]) out.push(model.textCards[0]);
  // 5 스포트라이트 — 수상·순위 문구가 잡힌 상품 1개(캐러셀 풀에서 뺀다 · 같은 이미지 2회 방지)
  const spot = media.products.find((p) => Array.isArray(p.awards) && p.awards.length > 0) || null;
  const pool = media.products.filter((p) => p !== spot);
  if (spot) {
    out.push(mk('text_card', { tag: String(spot.awards![0]).slice(0, 20), headline: cutAtWord(String(spot.name || ''), 28), body: priceLine(spot), align: 'left', image_url: spot.image_url, image_position: 'left' }, 'spot'));
    out.push(ctaOf(productCtaLabel(String(spot.name || ''), maxLabel), spot.link_url || galleryLink, 'cta-spot'));
    filled++;
  }
  // 6 carousel focus(2 · 정확히 3개 남으면 3) · 8 carousel classic(4 · 아니면 2 · 홀수 금지)
  const first = pool.length === 3 ? pool.slice(0, 3) : pool.slice(0, OUTREACH_CAROUSEL_FOCUS);
  const rest = pool.slice(first.length);
  const second = rest.length >= OUTREACH_CAROUSEL_CLASSIC ? rest.slice(0, OUTREACH_CAROUSEL_CLASSIC) : rest.length >= 2 ? rest.slice(0, 2) : [];
  const carouselOf = (ps: OutreachProduct[], n: number): Section => {
    const base = model.carousels[n];
    const p: any = { ...((base?.props as any) || {}) };
    p.products = toProductItems(ps);
    p.image_fit = 'contain';
    p.title = stripTrailingPunct(p.title) || (n === 0 ? '추천 상품' : '더 많은 상품');
    filled++;
    return base ? ({ ...base, props: p } as Section) : mk('product_carousel', p, `carousel${n + 1}`);
  };
  let carousel2: Section | null = null;
  if (first.length >= 2) out.push(carouselOf(first, 0));
  if (second.length >= 2) { carousel2 = carouselOf(second, 1); out.push(carousel2); }
  // CTA 2개 보장(행사·스포트라이트 CTA 가 하나도 없으면 첫 상품 묶음 뒤 코너 링크 1개)
  if (usedCta.size === 0 && first.length >= 2) {
    const kw = [...GALLERY_LINK_KEYS, ...OUTREACH_CTA_KEYWORDS].find((k) => media.ctaLinks[k]);
    const url = kw ? media.ctaLinks[kw] : media.homepageUrl;
    const idx = out.findIndex((s) => s.type === 'product_carousel');
    out.splice(idx + 1, 0, ctaOf((kw ? `${kw} 보기` : '전체 상품 보기'), url, 'cta-auto'));
  }
  // 9·10 카드2(이미지 위 text_card + cta)
  let event2: Section[] = [];
  if (cards[1]) {
    const s = eventCardSection(cards[1], 'event2');
    if (s) {
      const g2 = groupGalleryOf(cards[1], 'group2');
      event2 = [s, ...(g2 ? [g2] : []), ctaOf(eventCtaLabel(cards[1], maxLabel), cards[1].detailUrl || galleryLink, 'cta-event2')];
      out.push(...event2); filled++;
    }
  }
  // 모델 text_card #2
  if (model.textCards[1]) out.push(model.textCards[1]);
  // coupon(모델 · 면허 밖 수치는 차단기가 걷는다)
  if (model.coupon) out.push(model.coupon);
  // 11 countdown — 카드1 면허 종료일이 채운다(모델 문구는 유지) · 실재하는 미래 날짜가 없으면 없음
  {
    const p: any = { ...((model.countdown?.props as any) || {}) };
    const fromCard = card1 && card1.licensed && card1.endDate && /^\d{4}-\d{2}-\d{2}$/.test(card1.endDate) ? `${card1.endDate}T23:59:59` : '';
    const raw = fromCard || String(p.end_datetime || '');
    if (/^\d{4}-\d{2}-\d{2}/.test(raw) && new Date(raw).getTime() > Date.now()) {
      p.end_datetime = raw;
      p.urgency_text = String(p.urgency_text || '').trim() || '행사 마감까지';
      out.push(model.countdown ? ({ ...model.countdown, props: p } as Section) : mk('countdown', p, 'countdown'));
    }
  }
  // 12 대표 목적지 CTA — 3번째 행사 링크 → 코너 딥링크 → 홈(이미 쓴 URL 은 건너뛴다)
  {
    const card3 = cards[2] || null;
    const corner = [...GALLERY_LINK_KEYS, ...OUTREACH_CTA_KEYWORDS].map((k) => [k, media.ctaLinks[k]] as const).find(([, u]) => !!u && !usedCta.has(u)) || null;
    let url: string; let label: string;
    if (card3 && card3.detailUrl && !usedCta.has(card3.detailUrl)) { url = card3.detailUrl; label = eventCtaLabel(card3, maxLabel); }
    else if (corner) { url = corner[1]; label = `${corner[0]} 보기`; }
    else { url = media.homepageUrl; label = `${media.companyName} 바로가기`; }
    const modelLast = model.ctas.length ? model.ctas[model.ctas.length - 1] : null;
    const modelLabel = modelLast ? String(((modelLast.props as any)?.buttons || [])[0]?.label || '').trim() : '';
    // 목적지가 홈이면 모델의 목적지 이름형 라벨을 살린다(코드 라벨은 목적지가 정해졌을 때만)
    if (url === media.homepageUrl && modelLabel) label = modelLabel;
    out.push(ctaOf(label, url, 'cta-final'));
  }
  // 13 footer
  {
    const p: any = { ...((model.footer?.props as any) || {}) };
    p.notes = p.notes || '';
    if (media.legal?.legal && /사업자|대표|통신판매|고객센터|d{2,4}-d{3,4}-d{4}/.test(String(p.notes))) p.notes = '';
    if (media.legal?.legal) p.legal_text = media.legal.legal;
    if (media.legal?.csPhone) p.cs_phone = media.legal.csPhone;
    p.show_unsubscribe_link = channel === 'DM';
    out.push(model.footer ? ({ ...model.footer, props: p } as Section) : mk('footer', p, 'footer'));
  }

  // 상한 13(증거 카드 자리 1 포함 = 채우기 결과는 12까지) · 절단 순서 = 둘째 상품 묶음 → 둘째 행사 카드(+cta) → 모델 text_card
  const cap = OUTREACH_SECTION_MAX - 1;
  const drop = (s: Section | null) => { if (!s) return; const i = out.indexOf(s); if (i >= 0) out.splice(i, 1); };
  if (out.length > cap) drop(carousel2);
  if (out.length > cap) for (const s of event2) drop(s);
  if (out.length > cap) drop(model.textCards[1] || null);
  if (out.length > cap) drop(model.textCards[0] || null);
  return { sections: out.map((s, i) => ({ ...s, order: i })), filled };
}

// ===== ★ 2026-09-06 v3 배너 전사 폴백(카드 0건일 때만 · 설계서 §5-2 · 불변 34) =====

/** 전사 줄 게이트(순수) — 숫자 없는 줄 통과 · 숫자 있는 줄은 크롤 원문에 정규화 포함될 때만(재대조) · 아니면 폐기 */
export function licensedLineOf(line: string, crawlText: string): string | null {
  const t = String(line || '').replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2 || t.length > 60) return null;
  if (!/\d/.test(t)) return t;
  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  return normalize(crawlText || '').includes(normalize(t)) ? t : null;
}

/**
 * 면허 인용의 **출처** 가드(불변 34) — 전사 줄(수치)이 licensedQuote 안에 있는데 정당한 출처(선택 후보 인용문 · 사실 수치)에는 없으면 throw.
 * 단순 겹침은 정상이다(전사 줄은 크롤 원문 재대조를 통과한 것이라 면허 인용과 겹치는 게 보통 · 리뷰 #1). 출처를 안 넘기면 겹침 = 위반(테스트 형태).
 */
export function assertLicensedQuoteSources(licensedQuote: string, bannerLines: readonly string[], sources: readonly string[] = []): void {
  const normalize = (s: unknown) => String(s || '').replace(/\s+/g, '');
  const q = normalize(licensedQuote);
  if (!q) return;
  const src = sources.map(normalize).filter(Boolean);
  for (const l of bannerLines) {
    const n = normalize(l);
    if (!n || !/\d/.test(n) || !q.includes(n)) continue;
    if (!src.some((s) => s.includes(n))) throw new Error(`면허 인용에 출처 없는 배너 전사문이 섞였습니다: ${String(l).slice(0, 40)}`);
  }
}

/**
 * 배너 1장 → 글줄(vision · companyId 0 · 레이트리밋·크레딧 결합 0 · 공용 판독기 extractEventsFromImages 는 고객 입구 전용). 실패 = [].
 * 인물이 보이면 'person' 표식 한 줄만 돌려준다(호출자가 그 배너를 버린다).
 */
export async function transcribeBannerLines(image: { base64: string; mime: string }): Promise<{ lines: string[]; person: boolean }> {
  try {
    const raw = await callOutreachAi({
      system: [
        '광고 배너 이미지에 적힌 글자를 줄 단위로 그대로 옮긴다(요약·의역·창작 금지 · 이미지에 없는 말 금지).',
        '실존 인물(얼굴·신체)이 보이면 첫 줄에 PERSON 만 쓴다.',
        '출력은 JSON 하나만: {"lines":["...","..."]} · 최대 6줄 · 글자가 없으면 {"lines":[]}',
      ].join('\n'),
      userMessage: '옮겨라.',
      maxTokens: 300,
      temperature: 0,
      source: 'sales-outreach-banner-read',
      images: [{ media_type: image.mime, data: image.base64 }],
    });
    const m = raw.match(/\{[\s\S]*\}/);
    const j = m ? JSON.parse(m[0]) : {};
    const lines: string[] = Array.isArray(j.lines) ? j.lines.map((x: unknown) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6) : [];
    const person = lines.some((l) => /^person$/i.test(l));
    return { lines: lines.filter((l) => !/^person$/i.test(l)), person };
  } catch (err: any) {
    console.log('[sales-outreach] 배너 전사 불가(계속):', err?.message);
    return { lines: [], person: false };
  }
}

/**
 * 실측 배너 상위 n장을 전사해 폴백 행사 카드로 만든다(카드 0건일 때만 호출) — 제목 = 게이트 통과 첫 줄 · 부제 = 나머지 통과 줄 ' · ' · 면허 0 · 링크 = 코너 딥링크.
 * 전사 0줄·인물 = 그 배너를 싣지 않는다. 반환 bannerLines 는 그 회차 지역 변수(저장 0 · 가드 assertLicensedQuoteSources 의 입력).
 */
export async function bannerCardsFromTranscripts(
  gallery: ReadonlyArray<{ url: string; width: number; height: number }>, crawlText: string, linkUrl: string,
  opts: { max?: number; fetcher?: (url: string) => Promise<{ buffer: Buffer; mime: string } | null> } = {},
): Promise<{ cards: EngineEventCard[]; bannerLines: string[] }> {
  const fetcher = opts.fetcher || ((u: string) => fetchImageGuarded(u));
  const cards: EngineEventCard[] = [];
  const bannerLines: string[] = [];
  for (const g of gallery.slice(0, opts.max ?? 2)) {
    const img = await fetcher(g.url).catch(() => null);
    if (!img) continue;
    const r = await transcribeBannerLines({ base64: img.buffer.toString('base64'), mime: img.mime });
    if (r.person) continue;
    const passed = r.lines.map((l) => licensedLineOf(l, crawlText)).filter((l): l is string => !!l);
    if (passed.length === 0) continue;
    bannerLines.push(...passed);
    cards.push({
      title: passed[0].slice(0, 80),
      periodRaw: passed.length > 1 ? passed.slice(1).join(' · ').slice(0, 60) : null,
      endDate: null,
      bannerUrl: g.url,
      bannerSize: g.width > 0 && g.height > 0 ? { width: g.width, height: g.height } : null,
      detailUrl: linkUrl,
      licensed: false,
    });
  }
  return { cards, bannerLines };
}

// ===== DM 카피 혜택 기계 차단 (★ A-8 · 불변 22) =====

const LONG_TEXT_PROPS: ReadonlySet<string> = new Set(['body', 'description', 'instructions', 'conditions', 'usage_instructions', 'notes', 'content', 'question']);

export function dropPlaceholderSentences(text: string): string {
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
): { sections: Section[]; stripped: number; removed: SectionType[]; heroFallback: boolean } {
  let stripped = 0;
  let heroFallback = false;
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
    // ★ 2026-09-06 S2 대체는 유지하되 사실을 남긴다(HERO_FALLBACK 품질 경고 · 실물 표본에 업체명 단독 헤드라인 0건)
    if (s.type === 'hero' && !String(p.headline || '').trim()) { p.headline = companyName; heroFallback = true; }
    if (s.type === 'text_card' && !String(p.tag || '').trim() && !String(p.headline || '').trim() && !String(p.body || '').trim()) {
      removed.push('text_card');
      continue;
    }
    out.push({ ...s, props: p } as Section);
  }
  return { sections: out, stripped, removed, heroFallback };
}

// ===== ★ 2026-09-06 S2 코드가 채우는 블록 2종(순수) — 사회적 증거 카드 · 카운트다운 위치 =====

export interface OutreachProofInput { reviewTotal?: number | null; rating?: number | null; rankLabel?: string | null; collectedAt?: string | null }

function kstDateOf(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const t = Number.isNaN(d.getTime()) ? new Date() : d;
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t);
  const get = (k: string) => parts.find((p) => p.type === k)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * 사회적 증거 카드 1장(회의 수렴안 D4) — reviews 타입은 허용하지 않는다(렌더러가 후기 본문 없으면 placeholder · 발송 잠금). 코드가 채우는 text_card 로 낸다.
 * 값은 재료 원문 문자열(리뷰 총수·평점·1위 표기)만 · 수집 시각 병기 · 프롬프트 계약에 노출하지 않는다(모델이 채울 칸이 없다).
 * **applySectionOverrides 뒤**에 넣는다(사람이 숨긴 `type#n` 순번이 밀리지 않게) · treatment 는 섹션 최상위(룩 뒤라 코드가 직접 싣는다).
 * 위치 = 첫 상품 묶음(상품 있는 것) 직후 → 없으면 hero 직후 → 없으면 header 직후.
 */
export function insertProofCard(sections: readonly Section[], proof: OutreachProofInput | null | undefined, companyName: string): { sections: Section[]; inserted: boolean } {
  const list = (Array.isArray(sections) ? sections : []).filter((s) => s && typeof s === 'object');
  const total = typeof proof?.reviewTotal === 'number' && proof.reviewTotal >= 100 ? Math.round(proof.reviewTotal) : null;
  const rating = typeof proof?.rating === 'number' && proof.rating >= 1 && proof.rating <= 5 ? proof.rating : null;
  const rank = proof?.rankLabel ? String(proof.rankLabel).trim().slice(0, 40) : '';
  if (!total && !rating) return { sections: list.slice(), inserted: false };
  if (list.some((s) => String((s as any).id || '') === 'so-proof-card')) return { sections: list.slice(), inserted: false };
  // ★ v3 섹션 상한 — 증거 카드는 절단 순서 1순위(OUTREACH_TRIM_ORDER[0]) · 이미 상한이면 넣지 않는다
  if (list.length >= OUTREACH_SECTION_MAX) return { sections: list.slice(), inserted: false };
  // ★ 0906(3) 모델이 같은 사실(리뷰 수·평점·순위)로 만든 text_card 는 뺀다 — 증거 카드 하나가 그 자리다(아이소이 실측: "455,093개의 리얼 리뷰" 카드가 증거 카드 아래 또 섰다)
  const dupIdx = new Set<number>();
  list.forEach((s, i) => {
    if (s.type !== 'text_card' || String((s as any).id || '') === 'so-proof-card') return;
    const p: any = s.props || {};
    const text = [p.tag, p.headline, p.body].map((v) => String(v || '')).join(' ');
    if (/리뷰|후기|평점|누적\s*판매|판매\s*1위|review/i.test(text) && /\d/.test(text)) dupIdx.add(i);
  });
  const base = dupIdx.size ? list.filter((_, i) => !dupIdx.has(i)) : list;
  // ★ 2026-09-06(2) 숫자만 나열하지 않고 한 문장으로(실측 "리뷰 455,089건 / 평점 4.9 / 기준일" 이 설명 없이 섰다)
  const facts = [total ? `리뷰 ${total.toLocaleString('ko-KR')}건` : '', rating ? `평점 ${rating}` : ''].filter(Boolean);
  const tag = rank || '고객 후기';
  const headline = facts.join(' · ');
  const body = `고객이 남긴 리뷰와 평점입니다 · ${kstDateOf(proof?.collectedAt)} ${companyName} 홈페이지 기준`;
  const card = {
    id: 'so-proof-card', type: 'text_card', order: 0, visible: true, treatment: 'framed',
    props: { ...((getDefaultProps('text_card' as SectionType) as unknown as Record<string, unknown>) || {}), tag, headline, body },
  } as unknown as Section;
  const carIdx = base.findIndex((s) => s.type === 'product_carousel' && Array.isArray((s.props as any)?.products) && (s.props as any).products.length > 0);
  const heroIdx = base.findIndex((s) => s.type === 'hero');
  const headerIdx = base.findIndex((s) => s.type === 'header');
  const at = carIdx >= 0 ? carIdx + 1 : heroIdx >= 0 ? heroIdx + 1 : headerIdx >= 0 ? headerIdx + 1 : 0;
  const out = base.slice();
  out.splice(at, 0, card);
  return { sections: out.map((s, i) => ({ ...s, order: i })), inserted: true };
}

/** 카운트다운은 마지막 CTA 직전(실물 6건 중 끝에서 두 번째 2 · 중간 3 · 앞 1 → 은닉 없이 위치만 보정). cta 가 없으면 그대로. */
export function moveCountdownBeforeLastCta(sections: readonly Section[]): Section[] {
  const list = (Array.isArray(sections) ? sections : []).filter((s) => s && typeof s === 'object');
  const cd = list.findIndex((s) => s.type === 'countdown');
  const lastCta = list.reduce((acc, s, i) => (s.type === 'cta' ? i : acc), -1);
  if (cd < 0 || lastCta < 0 || lastCta === cd + 1) return list.slice();
  const out = list.slice();
  const [item] = out.splice(cd, 1);
  const target = out.reduce((acc, s, i) => (s.type === 'cta' ? i : acc), -1);
  out.splice(target, 0, item);
  return out.map((s, i) => ({ ...s, order: i }));
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
  /** ★ 2026-09-06 S2 사회적 증거(재료 v2 proof · 원문 문자열) · 없으면 카드 없음 */
  proof?: OutreachProofInput | null;
  /** ★ 2026-09-06 S3 생성 배너(실측 배너 0장일 때만 존재) */
  bannerUrl?: string | null;
  bannerSize?: { width: number; height: number } | null;
  /** ★ 2026-09-06(2) 포스터 캡션(studio_image.posterTexts.title · 숫자 0) */
  posterCaption?: string | null;
  /** ★ v3 입구(필수 · 기본값 0 = tsc 가 누락을 잡는다) — jobs 'outreach' · campaign-quick 'customer' */
  entry: EngineEntry;
  /** ★ v3 행사 카드(선택 순서 · ≤3 · bannerUrl 은 사본으로 되찾은 값) */
  eventCards?: EngineEventCard[] | null;
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
  /** ★ 2026-09-06 S2 헤드라인이 비어 업체명으로 대체됐는가(품질 경고 원천) */
  heroFallback: boolean;
  /** ★ 2026-09-06 S2 사회적 증거 카드가 실렸는가 */
  proofInserted: boolean;
  /** ★ v3 블록 최소 요건 검사(경고만 · 발행본 기준) */
  blockGate: BlockMinimaResult;
}

/** 룩 배정·비율 판정에 쓰는 이미지 크기 표(우리 사본 URL → 폭·높이). */
function buildLookDims(gallery: readonly OutreachFillImage[], products: readonly OutreachMediaProduct[], posterUrl: string | null, posterSize?: { width: number; height: number } | null): LookImageDims {
  const dims: LookImageDims = {};
  for (const g of gallery) if (g.width && g.height) dims[g.url] = { width: g.width, height: g.height };
  for (const p of products) if (p.width && p.height) dims[p.image_url] = { width: p.width, height: p.height };
  if (posterUrl && posterSize && posterSize.width > 0 && posterSize.height > 0) dims[posterUrl] = { width: posterSize.width, height: posterSize.height };
  return dims;
}

/**
 * ★ 2026-09-06 S5 엔진 의존 묶음(아웃리치 구현) — 생성기(few-shot · 예시 원천 DB+seed) · 채우기 · 차단 · 정리 · 룩 · 숨김 · 증거 카드 · 페이지.
 * 고객 재료 입구(campaign-quick.ts)도 이 묶음을 그대로 쓴다(규칙이 갈라지지 않는다 · entry 는 생성기 힌트로만 전달).
 */
export function outreachEngineDeps(): EngineDeps<OutreachLookStats, LookImageDims, SectionOverride> {
  return {
    async generate(engineInput: EngineGenInput) {
      const genInput: OutreachGenInput = {
        companyName: engineInput.companyName, industry: engineInput.industry, homepageUrl: engineInput.homepageUrl, siteTitle: engineInput.siteTitle,
        material: engineInput.material, extraNotes: engineInput.extraNotes, products: engineInput.products, galleryCount: engineInput.galleryCount, skeletonTypes: engineInput.skeletonTypes,
        bannerCaptions: engineInput.bannerCaptions, entry: engineInput.entry, eventCards: engineInput.eventCards || null,
      };
      const exemplarSource = await loadOutreachExemplarSource();
      const dmPrompt = buildDmSectionsPrompt(genInput, exemplarSource);
      const exemplars = dmPrompt.exemplars;
      // ★ v3 허용 타입도 입구별(아웃리치 = gallery 제외 · 계약 문자열과 한 쌍)
      const gen = await generateSections(dmPrompt, dmAllowedTypes(engineInput.entry), engineInput.entry === 'customer' ? 'campaign-materials-dm-sections' : 'sales-outreach-dm-sections', engineInput.entry === 'customer' ? 'qc-dm' : 'so-dm');
      return { sections: gen.sections, exemplars };
    },
    buildDims: (gallery, products, posterUrl, posterSize) => buildLookDims(gallery, products as unknown as readonly OutreachMediaProduct[], posterUrl, posterSize),
    fill: (sections, m, channel: EngineChannel, entry: EngineEntry) => fillOutreachDmMedia(sections, {
      posterUrl: m.posterUrl, posterSize: m.posterSize, bannerUrl: m.bannerUrl, bannerSize: m.bannerSize, logoUrl: m.logoUrl, gallery: m.gallery,
      products: m.products as unknown as OutreachMediaProduct[], ctaLinks: m.ctaLinks, homepageUrl: m.homepageUrl, legal: m.legal, companyName: m.companyName,
      posterCaption: m.posterCaption || null, licensedQuote: m.licensedQuote, eventCards: m.eventCards || null,
    }, channel, entry),
    sanitize: (sections, licensedQuote, companyName) => sanitizeDmCopyBenefits(sections, licensedQuote, companyName),
    prune: (sections) => pruneEmptyDmSections([...sections]),
    orderCountdown: (sections) => moveCountdownBeforeLastCta([...sections]),
    applyLook: (sections, channel, dims) => applyOutreachLook(sections, channel, dims),
    lookStats: (sections) => lookStatsOf([...sections]),
    applyOverride: (sections, override) => applySectionOverrides([...sections], override),
    insertProof: (sections, proof, companyName) => insertProofCard([...sections], (proof as OutreachProofInput | null) || null, companyName),
    rebuild: (sections) => rebuildDmPages([...sections]),
    splitPages: (sections, layoutMode) => splitSectionsIntoPages([...sections], layoutMode as typeof OUTREACH_DM_LAYOUT_MODE),
  };
}

/** ★ v3 조립 결과(DB 0 · 발행 0) — publishOutreachDm / updateOutreachDm 의 입력 · 자동 재조립은 이것을 2회 만들고 발행은 1회(설계서 §7-8 · 불변 37) */
export interface AssembledDm {
  structureRef: OutreachStructureRef | null;
  sections: Section[];
  sectionsBase: Section[];
  pages: unknown[];
  look: OutreachLookStats;
  benefitStripped: number;
  heroFallback: boolean;
  proofInserted: boolean;
  exemplars: { picked: number; total: number };
  hidden: { applied: number; missed: string[]; skipped: boolean };
  blockGate: BlockMinimaResult;
  /** brand_kit(주색 = 접근성 보정본 · 없으면 무채색) */
  brandKit: ReturnType<typeof buildOutreachBrandKit>;
}

function assertOutreachPublisher(input: Pick<ProduceDmInput, 'companyId' | 'userId'>): void {
  const envCompanyId = (process.env.OUTREACH_COMPANY_ID || '').trim();
  const envUserId = (process.env.OUTREACH_USER_ID || '').trim();
  if (!envCompanyId || !envUserId) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
  if (String(input.companyId) !== envCompanyId || String(input.userId) !== envUserId) {
    throw new Error('내부 발행은 내부 전용 회사 계정으로만 가능합니다.');
  }
}

/** ★ v3 조립만(AI 생성 + 결정 구간 · DB 0) — 발행과 분리(검증 B7: createDm·publishDm 재호출 = 공개 주소 2개) */
export async function assembleOutreachDm(input: ProduceDmInput): Promise<AssembledDm> {
  assertOutreachPublisher(input);
  // ★ C4-2 사람이 고른 재료만(선택이 없거나 재수집으로 전부 무효면 전량)
  const media = applyOutreachMediaSelection(input.media, input.mediaSelection || null);
  const products = media?.products || [];
  const gallery: OutreachFillImage[] = (media?.gallery || []).map((g) => ({ url: g.url, width: g.width, height: g.height, ...(g.alt ? { alt: g.alt } : {}) }));

  // 아웃리치 전용 = 참조 골격(베스트 구성 서빙 · seed) · 엔진에는 순서 힌트만 넘긴다
  let structureRef: OutreachStructureRef | null = null;
  if (!(input.presetSections && input.presetSections.length > 0)) {
    structureRef = await pickOutreachStructure({
      companyName: input.companyName,
      eventText: input.material,
      benefitLicensed: input.benefitLicensed,
    });
  }
  // ★ 2026-09-06 S5 결정 구간(채우기 → 차단 → 정리 → 카운트다운 → 룩 → 숨김 → 증거 카드 → 페이지)은 공용 엔진 1곳 — 고객 재료 입구와 같은 순서(campaign-engine.ts)
  const engineMaterials: EngineMaterials = {
    companyName: input.companyName, industry: input.industry, homepageUrl: input.homepageUrl, siteTitle: input.siteTitle, material: input.material, extraNotes: input.extraNotes || null,
    products, gallery, logoUrl: media?.logo?.url || null,
    posterUrl: input.posterUrl, posterSize: input.posterSize || null, bannerUrl: input.bannerUrl || null, bannerSize: input.bannerSize || null,
    ctaLinks: input.ctaLinks, legal: input.legal, licensedQuote: input.licensedQuote, proof: input.proof || null,
    posterCaption: input.posterCaption || null,
    eventCards: input.eventCards || undefined,
  };
  const engine = await assembleDmCampaign(engineMaterials, {
    entry: input.entry, channel: 'DM',
    skeletonTypes: structureRef ? structureRef.sectionTypes.filter((t) => dmAllowedTypes(input.entry).includes(t)) : null,
    sectionOverride: input.sectionOverride || null,
    presetSections: input.presetSections || null,
    // ★ 아웃리치 DM = 세로 한 페이지(OUTREACH_DM_LAYOUT_MODE) — slides 확장이 갤러리 구도·링크를 버리고 sandbox 미리보기가 첫 장에서 멈춘다
    layoutMode: OUTREACH_DM_LAYOUT_MODE,
  }, outreachEngineDeps());
  if (structureRef && engine.generated) structureRef.pruned = engine.removed as SectionType[];
  // ★ 0905(4) 브랜드 색 = 접근성 보정본(대비 미달이면 명도만 낮춰 통과시킨다 · 실패 시 null = 기본 토큰)
  // ★ 0906(3) 브랜드 색을 못 뽑았으면 기본 보라 토큰이 아니라 무채색 주색(어느 브랜드에도 "남의 색"이 아니다)
  const primary = accessiblePrimaryOf(input.brandColor) || OUTREACH_NEUTRAL_PRIMARY;
  return {
    structureRef,
    sections: engine.sections,
    sectionsBase: engine.sectionsBase,
    pages: engine.pages,
    look: engine.look,
    benefitStripped: engine.benefitStripped,
    heroFallback: engine.heroFallback,
    proofInserted: engine.proofInserted,
    exemplars: engine.exemplars,
    hidden: engine.hidden,
    blockGate: assertBlockMinima(engine.sections),
    // ★ C1-3 brand_kit은 항상(art_direction 그릇) · 대비 미달이면 색만 뺀다 · logo_url은 어떤 경우에도 없다(불변 11)
    brandKit: buildOutreachBrandKit(primary, input.industry),
  };
}

export interface PublishedDmRef { dmId: string; dmUrl: string; viewerUrl: string }

/** ★ v3 발행(createDm + publishDm · 1회) — H14 자기 확인 · CT 직접 호출(라우트 미경유 = 미차감) */
export async function publishOutreachDm(a: AssembledDm, input: Pick<ProduceDmInput, 'companyId' | 'userId' | 'companyName' | 'material'>): Promise<PublishedDmRef> {
  assertOutreachPublisher(input);
  const dm = await createDm(input.companyId, input.userId, {
    title: `[영업] ${input.companyName}`.slice(0, 200),
    sections: a.sections,
    pages: a.pages,
    layout_mode: OUTREACH_DM_LAYOUT_MODE,
    brand_kit: a.brandKit,
    ai_prompt: input.material.slice(0, 2000),
    approval_status: 'draft',
  } as any);
  const published = await publishDm(String(dm.id), input.companyId);
  if (!published?.short_code) throw new Error('모바일 DM 발행 주소를 만들지 못했습니다.');
  const shortBase = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
  const dmUrl = shortBase ? `${shortBase}/${published.short_code}` : `${PUBLIC_BASE}/api/dm/v/dm-${published.short_code}`;
  return { dmId: String(dm.id), dmUrl, viewerUrl: `${PUBLIC_BASE}/api/dm/v/dm-${published.short_code}` };
}

/** ★ v3 자동 재조립 2회차 — 같은 dmId 의 섹션·페이지만 갈아끼운다(createDm·publishDm 재호출 0 · short_code 유지 · updateDm 은 status 를 건드리지 않는다) */
export async function updateOutreachDm(dmId: string, a: AssembledDm, input: Pick<ProduceDmInput, 'companyId' | 'userId'>): Promise<boolean> {
  assertOutreachPublisher(input);
  const row = await updateDm(dmId, input.companyId, { sections: a.sections, pages: a.pages as any, brand_kit: a.brandKit } as any);
  return !!row;
}

/** 조립 + 발행(옛 계약 유지 · 호출부 = 테스트·외부) */
export async function produceOutreachDm(input: ProduceDmInput): Promise<ProduceDmResult> {
  const a = await assembleOutreachDm(input);
  const pub = await publishOutreachDm(a, input);
  return produceResultOf(a, pub);
}

/** 조립 결과 + 발행 참조 → 옛 결과 모양(asset payload 가 읽는 키 무변경) */
export function produceResultOf(a: AssembledDm, pub: PublishedDmRef): ProduceDmResult {
  return {
    dmId: pub.dmId,
    dmUrl: pub.dmUrl,
    structureRef: a.structureRef,
    benefitStripped: a.benefitStripped,
    sectionTypes: a.sections.map((s) => String(s.type)),
    exemplarCount: a.exemplars.picked,
    exemplarTotal: a.exemplars.total,
    sections: a.sections,
    sectionsBase: a.sectionsBase,
    viewerUrl: pub.viewerUrl,
    look: a.look,
    hiddenApplied: a.hidden.applied,
    hiddenMissed: a.hidden.missed,
    hiddenSkipped: a.hidden.skipped === true,
    heroFallback: a.heroFallback,
    proofInserted: a.proofInserted,
    blockGate: a.blockGate,
  };
}

/** ★ v3 자동 재조립 트리거(순수) — 채점 항목 중 DM_VISION_RETRY_ITEMS 가 false 인 것 · 채점 없음 = [] */
export function autoRetryReasons(score: DmVisionScore | null | undefined): DmVisionItem[] {
  const items = score?.items || null;
  if (!items) return [];
  return DM_VISION_RETRY_ITEMS.filter((k) => items[k] === false);
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
  const gallery: OutreachFillImage[] = (media?.gallery || []).map((g) => ({ url: g.url, width: g.width, height: g.height, ...(g.alt ? { alt: g.alt } : {}) }));
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
    bannerCaptions: gallery.map((g) => g.alt || '').filter(Boolean),
    entry: input.entry,
    eventCards: input.eventCards || null,
  };
  const exemplarSource = await loadOutreachExemplarSource();
  const emailPrompt = buildEmailSectionsPrompt(genInput, exemplarSource);
  // ★ v3 아웃리치 브랜드 이메일도 gallery 0(설명 없는 이미지 블록 0 · 불변 35) · 고객 입구 이메일은 현행 유지
  const gen = await generateSections(emailPrompt, input.entry === 'outreach' ? OUTREACH_EMAIL_TYPES.filter((t) => t !== 'gallery') : OUTREACH_EMAIL_TYPES, 'sales-outreach-email-sections', 'so-brand');
  const filled = fillOutreachDmMedia(gen.sections, {
    posterUrl: input.posterUrl, posterSize: input.posterSize || null, bannerUrl: input.bannerUrl || null, bannerSize: input.bannerSize || null, logoUrl: media?.logo?.url || null, gallery, products, ctaLinks: input.ctaLinks, homepageUrl: input.homepageUrl, legal: input.legal, companyName: input.companyName,
    posterCaption: input.posterCaption || null, licensedQuote: input.licensedQuote, eventCards: input.eventCards || null,
  }, 'EMAIL', input.entry);
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
    const raw = await callOutreachAi({
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
  /** ★ 0906(3) 자동으로 만든 모바일 DM 첫 화면 캡처(375×900 공개 사본) · 없으면 캡처 블록 생략 */
  dmCaptureUrl?: string | null;
  /** ★ 0906(3) "5분 투자" 대비 이미지(이미지 스튜디오 실샘플 · 공개 라우트) · 없으면 대비 카드만 */
  showcaseImageUrl?: string | null;
  /** ★ v3 담당자 홈 첫 화면 캡처(375×900 공개 사본 · brand_profile.homeCaptureUrl) · 없으면 대조 왼쪽 카드 생략 */
  homeCaptureUrl?: string | null;
  /** ★ v3 회신 유도 문장(검토 화면 편집분 · 없으면 emailCopy.reply) */
  replyLine?: string | null;
}

function kstDateDash(d: Date): string {
  const t = kstDateTag(d);
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

/** ★ v3 회신 문장 — 편집분(60자 · 공백 정리) 우선 · 비면 기본 문구 */
export const OUTREACH_REPLY_LINE_MAX = 60;
export function replyLineOf(input: Pick<ProposalEmailInput, 'replyLine'>, c: OutreachStyleGuide['emailCopy']): string {
  const t = String(input.replyLine || '').replace(/\s+/g, ' ').trim().slice(0, OUTREACH_REPLY_LINE_MAX);
  return t || c.reply;
}

/** 순수 섹션 조립 — 한글 리터럴 0(문구 전부 guide.emailCopy). 렌더는 호출부. */
export function buildProposalEmailSections(guide: OutreachStyleGuide, input: ProposalEmailInput): Section[] {
  const c = guide.emailCopy;
  // ★ 0906(3) 자리표시자 노출 0 — 면허가 안 난 혜택 문장은 메일·공개 페이지에서 빼고 조립한다(검토 화면의 문안 원본은 그대로 · 편집용)
  const copyForEmail = dropPlaceholderSentences(input.copyBody.replace(/\{\{DM_LINK\}\}/g, input.dmUrl));
  const copyOk = copyForEmail.length >= 20 && !copyForEmail.includes(BENEFIT_PLACEHOLDER);
  const introClean = dropPlaceholderSentences(input.intro) || c.introDefault(input.companyName);
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
        introClean,
        input.selectedEvent ? `${c.lead.quoteLabel}: "${input.selectedEvent.quote}"` : '',
      ].filter(Boolean).join('\n\n'),
      align: 'left', image_position: 'top',
    }, { treatment: 'lead' }),
    // ★ 0906(3) 스토리 1 — 홈페이지 주소 하나로 자동으로 이만큼(기술력) + 모바일 DM 캡처 · 대표 이미지
    sec('text_card', {
      tag: c.story.auto.tag,
      headline: c.story.auto.headline,
      body: c.story.auto.body(input.companyName),
      align: 'left', image_position: 'top',
    }, { background: 'soft' }),
    // ★ v3 대조 카드(설계서 §8 · gallery 0) — 왼쪽 = 홈 첫 화면 캡처(있을 때만) · 오른쪽 = DM 첫 화면 캡처 · 포스터. 세로 캡처는 image_position left(220px 열) · 캡처 위 글자 0
    ...(input.homeCaptureUrl ? [sec('text_card', {
      tag: c.story.capture.title,
      headline: c.story.capture.homeHeadline(input.companyName),
      body: c.story.capture.homeBody,
      align: 'left', image_url: input.homeCaptureUrl, image_position: 'left',
    })] : []),
    ...(input.dmCaptureUrl ? [sec('text_card', {
      ...(input.homeCaptureUrl ? {} : { tag: c.story.capture.title }),
      headline: c.story.capture.dmHeadline,
      body: c.story.capture.dmBody(input.companyName),
      align: 'left', image_url: input.dmCaptureUrl, image_position: 'left',
    })] : []),
    ...(input.dmCaptureUrl && input.posterUrl ? [sec('text_card', {
      headline: c.story.capture.posterHeadline,
      body: c.story.capture.posterBody,
      align: 'left', image_url: input.posterUrl, image_position: 'left',
    }, { background: 'soft' })] : []),
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
    ...(copyOk ? [sec('text_card', {
      tag: c.showcase.tag,
      headline: c.showcase.headline,
      body: copyForEmail,
      align: 'left', image_position: 'top',
    })] : []),
    // ★ 0906(3) 스토리 2 — 자사몰 연동 · 이미지 몇 장이면 훨씬 위(대비 카드 + 이미지 스튜디오 실샘플)
    sec('text_card', {
      tag: c.story.compare.tag,
      headline: c.story.compare.headline,
      body: c.story.compare.body(input.companyName),
      align: 'left', image_position: 'top',
    }, { background: 'soft' }),
    // ★ v3 실샘플도 이미지 위 text_card(gallery 0)
    ...(input.showcaseImageUrl ? [sec('text_card', {
      headline: c.story.compare.imageTitle,
      body: c.story.compare.imageCaption,
      align: 'left', image_url: input.showcaseImageUrl, image_position: 'top',
    })] : []),
    // ★ 0906(3) 스토리 3 — 5분이면 브로마이드급(features 3칸)
    sec('text_card', {
      tag: c.features.tag,
      headline: c.features.headline(input.companyName),
      body: c.features.body,
      align: 'left', image_position: 'top',
    }),
    ...c.features.items.map((f) => sec('text_card', {
      tag: f.tag,
      headline: f.headline(!!input.posterUrl),
      body: f.body(input.companyName),
      align: 'left', image_position: 'top',
    }, { background: 'soft' })),
    sec('cta', {
      layout: 'stack',
      buttons: [
        { label: assertButtonLabel(c.cta.primary), url: input.previewUrl, style: 'primary' },
        { label: assertButtonLabel(c.cta.secondary), url: input.dmUrl, style: 'outline' },
      ],
    }, { treatment: 'bar' }),
    sec('text_card', {
      headline: c.service.headline,
      // ★ v3 회신 유도 1문장 = 마지막 카드 body 마지막 줄(검토 화면 편집분 우선)
      body: `${c.service.body}\n\n${replyLineOf(input, c)}`,
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
  const copyForEmail = dropPlaceholderSentences(input.copyBody.replace(/\{\{DM_LINK\}\}/g, input.dmUrl));
  const copyOk = copyForEmail.length >= 20 && !copyForEmail.includes(BENEFIT_PLACEHOLDER);
  return [
    input.subject,
    '',
    dropPlaceholderSentences(input.intro) || c.introDefault(input.companyName),
    input.selectedEvent ? `${c.lead.quoteLabel}: "${input.selectedEvent.quote}"` : '',
    '',
    `${c.story.auto.tag} ${c.story.auto.headline}`,
    c.story.auto.body(input.companyName),
    input.homeCaptureUrl ? c.story.capture.homeHeadline(input.companyName) : '',
    input.dmCaptureUrl ? `${c.story.capture.dmCaption}: ${input.dmUrl}` : '',
    '',
    ...(copyOk ? [`${c.showcase.tag}:`, copyForEmail, ''] : []),
    `${c.story.compare.tag} ${c.story.compare.headline}`,
    c.story.compare.body(input.companyName),
    '',
    `${c.cta.primary}: ${input.previewUrl}`,
    `${c.cta.secondary}: ${input.dmUrl}`,
    '',
    `${c.features.tag}: ${c.features.headline(input.companyName)}`,
    ...c.features.items.map((f) => `- ${f.tag}: ${f.headline(!!input.posterUrl)} ${f.body(input.companyName)}`),
    '',
    c.service.body,
    replyLineOf(input, c),
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
  const primary = accessiblePrimaryOf(input.brandColor) || OUTREACH_NEUTRAL_PRIMARY;
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
