/**
 * ai-build.ts — AI 자동제작(재료만 넣으면 완성본까지) 화면 공통 로직 CT (2026-09-14 T5 · 설계서 docs/2026-09-14-ai-auto-build-design.md §4·§5·§6-1·§13 T4 응답 계약)
 *
 * 화면 상태 → 서버 재료 계약(materials v1) 조립 · 칩 재료 유무(서버 규칙의 화면 거울 · 판정 원천은 서버) · 오류 코드 → 고객 문구 ·
 * 로컬 초안 보관(새로고침 복구) · 편집기로 넘기는 결과(결과 바). AI 호출 0 · 금액 0(금액은 서버 견적만).
 * ⛔ 모델명 0 · native dialog 0 · 하드코딩 금액 0.
 */
import { useEffect, useState } from 'react';

export type BuildChannel = 'dm' | 'email';
export type BuildImageRole = 'hero' | 'photo' | 'logo' | 'unknown';

export interface BuildImageValue {
  /** 이 회사 서빙 경로(업로드 즉시 받은 값) */
  url: string;
  width: number | null;
  height: number | null;
  /** 서버 판정(견적 응답 image_roles) · 화면은 읽기 전용 배지로만 */
  role?: BuildImageRole;
}

export interface BuildCardValue {
  id: string;
  title: string;
  text: string;
  link: string;
  licensed: boolean;
  images: BuildImageValue[];
}

export interface BuildProductValue {
  /** 화면 키(몰 = provider:code · 수동 = manual:이름) */
  key: string;
  source: 'mall' | 'manual';
  provider: string | null;
  code: string | null;
  name: string;
  price: number | null;
  salePrice: number | null;
  discountRate: number | null;
  url: string | null;
  imageUrl: string | null;
}

export interface BuildFeatureDef { key: string; label: string; hint: string }
/** 기능 칩 4종 — 서버 허용 목록(AI_AUTO_BUILD_FEATURES)과 같은 키·같은 순서 */
export const AI_BUILD_FEATURES: readonly BuildFeatureDef[] = [
  { key: 'product_carousel', label: '상품 카드', hint: '몰에서 불러온 상품(이미지 있음) 1개 이상' },
  { key: 'countdown', label: '카운트다운', hint: '"그대로 씁니다"를 체크한 카드에 연도가 있는 종료일' },
  { key: 'coupon', label: '쿠폰', hint: '"그대로 씁니다"를 체크한 카드에 할인·증정 문구' },
  { key: 'gallery', label: '갤러리', hint: '한 카드에 사진 2장 이상' },
];

export const AI_BUILD_DRAFT_KEY = 'hj_ai_build_draft';
export const AI_BUILD_RESULT_KEY = 'hj_ai_build_result';
/** 새로고침 복구는 하루만(오래된 초안이 남의 화면처럼 나타나지 않게) */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface BuildDraftState {
  channel: BuildChannel;
  isAd: boolean;
  cards: BuildCardValue[];
  products: BuildProductValue[];
  /** null = "AI가 알아서"(서버 후처리 no-op) */
  features: string[] | null;
  savedAt: number;
}

export function newAttemptToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // 폴백(구형 브라우저) — 서버는 uuid 형식만 받는다
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${h()}${h()}-${h()}-4${h().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${h().slice(1)}-${h()}${h()}${h()}`;
}

export function newCardId(): string {
  return (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : `c${Date.now().toString(36)}`;
}

export function newBuildCard(): BuildCardValue {
  return { id: newCardId(), title: '', text: '', link: '', licensed: false, images: [] };
}

/** 사용자 텍스트(제목+내용 · 공백 접음) 글자 수 — 서버 textChars 와 같은 셈법 */
export function userTextCharsOf(cards: readonly BuildCardValue[]): number {
  return cards.flatMap((c) => [c.title, c.text]).join(' ').replace(/\s+/g, ' ').trim().length;
}

export function cardIsFilled(c: BuildCardValue): boolean {
  return c.images.length > 0 || c.text.trim().length > 0 || c.title.trim().length > 0;
}

/** 서버 재료 계약 v1 — 견적은 expectedTotal 0 · 생성은 서버 견적 합계 */
export function buildMaterialsPayload(state: Pick<BuildDraftState, 'channel' | 'isAd' | 'cards' | 'products' | 'features'>, attemptToken: string, expectedTotal: number) {
  return {
    version: 1,
    attemptToken,
    expectedTotal,
    channel: state.channel,
    isAd: state.channel === 'email' ? state.isAd : null,
    eventCards: state.cards.filter(cardIsFilled).map((c) => ({
      id: c.id,
      title: c.title.trim(),
      text: c.text.trim(),
      link: c.link.trim() || null,
      licensed: c.licensed && (c.text.trim().length > 0 || c.title.trim().length > 0),
      images: c.images.map((im) => ({ url: im.url, width: im.width, height: im.height })),
    })),
    products: state.products.map((p) => ({
      source: p.source, provider: p.provider, code: p.code, name: p.name,
      price: p.price, salePrice: p.salePrice, discountRate: p.discountRate, url: p.url, imageUrl: p.imageUrl,
    })),
    features: state.features,
    brandName: null,
  };
}

/** 서버 규칙의 화면 거울(판정 원천은 서버 · 여기는 칩을 회색으로 두는 사유만) */
const FULL_DATE_RE = /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})(?!\d)/;
const BENEFIT_TOKEN_RE = /\d[\d.,]*\s*(?:%|퍼센트|원|만원|천원)|1\s*\+\s*1|무료\s*배송|무료|쿠폰|사은품|적립/;

export interface FeatureAvailability { ok: boolean; reason: string | null }
export function featureAvailability(state: Pick<BuildDraftState, 'cards' | 'products'>, channel: BuildChannel): Record<string, FeatureAvailability> {
  const licensedText = state.cards.filter((c) => c.licensed).map((c) => `${c.title}\n${c.text}`).join('\n');
  const mallWithImage = state.products.filter((p) => p.source === 'mall' && !!p.imageUrl).length;
  const galleryOk = state.cards.some((c) => c.images.length >= 2);
  return {
    product_carousel: mallWithImage >= 1 ? { ok: true, reason: null } : { ok: false, reason: '이미지가 있는 몰 상품이 있어야 해요' },
    countdown: channel === 'email'
      ? { ok: false, reason: '이메일에는 넣을 수 없어요' }
      : (FULL_DATE_RE.test(licensedText) ? { ok: true, reason: null } : { ok: false, reason: '"그대로 씁니다"를 체크한 카드에 연도가 있는 종료일(예: 2026.10.15)이 있어야 해요' }),
    coupon: BENEFIT_TOKEN_RE.test(licensedText) ? { ok: true, reason: null } : { ok: false, reason: '"그대로 씁니다"를 체크한 카드에 할인·증정 문구가 있어야 해요' },
    gallery: galleryOk ? { ok: true, reason: null } : { ok: false, reason: '한 카드에 사진이 2장 이상 있어야 해요' },
  };
}

/** 서버 오류 코드 → 화면 문구(서버가 준 문구가 있으면 그대로 · 코드별 보조 안내만) */
export function buildErrorMessage(code: string | undefined, serverMessage: string | undefined, fallback: string): string {
  const base = (serverMessage || '').trim();
  switch (code) {
    case 'INSUFFICIENT_CREDIT': return base || '크레딧이 부족합니다. 충전 후 이용해주세요.';
    case 'QUOTE_CHANGED': return '견적이 바뀌어 금액을 다시 계산했어요. 확인 후 다시 눌러 주세요.';
    case 'IN_FLIGHT': return base || '지금 만드는 중이에요. 완성되면 이어서 진행해 주세요.';
    case 'MATERIAL_THIN': return base || '재료가 부족해요. 행사 내용 40자 이상 또는 첫 화면이 될 사진 1장을 넣어 주세요.';
    case 'SMTP_REQUIRED': return base || '이메일 발신 설정이 먼저 필요해요.';
    case 'FEATURE_DISABLED': return base || '이 기능은 아직 열리지 않았습니다.';
    case 'CREDIT_LOOKUP_UNAVAILABLE': return base || '크레딧 잔액을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.';
    case 'DB_MIGRATION_PENDING': return '잠시 준비 중이에요. 몇 분 뒤 다시 시도해 주세요.';
    default: return base || fallback;
  }
}

// ===== 로컬 초안(새로고침 복구 · 이미지는 url 만 · EventCampaignModal 초안 키와 같은 방식) =====

export function loadBuildDraft(): BuildDraftState | null {
  try {
    const raw = localStorage.getItem(AI_BUILD_DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as BuildDraftState;
    if (!d || typeof d !== 'object' || !Array.isArray(d.cards)) return null;
    if (!d.savedAt || Date.now() - d.savedAt > DRAFT_TTL_MS) { localStorage.removeItem(AI_BUILD_DRAFT_KEY); return null; }
    return {
      channel: d.channel === 'email' ? 'email' : 'dm',
      isAd: d.isAd !== false,
      cards: d.cards.map((c) => ({ id: String(c.id || newCardId()), title: String(c.title || ''), text: String(c.text || ''), link: String(c.link || ''), licensed: c.licensed === true, images: Array.isArray(c.images) ? c.images.filter((im) => im && typeof im.url === 'string').map((im) => ({ url: im.url, width: im.width ?? null, height: im.height ?? null })) : [] })),
      products: Array.isArray(d.products) ? d.products.filter((p) => p && typeof p.name === 'string') : [],
      features: Array.isArray(d.features) ? d.features.map(String) : null,
      savedAt: d.savedAt,
    };
  } catch {
    return null;
  }
}

export function saveBuildDraft(state: Omit<BuildDraftState, 'savedAt'>): void {
  try {
    localStorage.setItem(AI_BUILD_DRAFT_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
  } catch { /* 저장 실패 = 복구만 못 한다 */ }
}

export function clearBuildDraft(): void {
  try { localStorage.removeItem(AI_BUILD_DRAFT_KEY); } catch { /* 없음 */ }
}

// ===== 편집기로 넘기는 결과(결과 바) — 생성 응답의 materials 계측 그대로 · 세션 한정 =====

export interface BuildResultHandoff {
  channel: BuildChannel;
  draftId: string;
  /** 서버 응답 data.materials(materialsMeta) 그대로 */
  materials: Record<string, any>;
  quoteTotal: number;
  heroFallback: boolean;
  benefitStripped: number;
  createdAt: number;
}

export function saveBuildResult(r: BuildResultHandoff): void {
  try { sessionStorage.setItem(AI_BUILD_RESULT_KEY, JSON.stringify(r)); } catch { /* 결과 바만 못 띄운다 */ }
}

export function peekBuildResult(draftId: string): BuildResultHandoff | null {
  try {
    const raw = sessionStorage.getItem(AI_BUILD_RESULT_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as BuildResultHandoff;
    if (!r || r.draftId !== draftId) return null;
    return r;
  } catch {
    return null;
  }
}

export function clearBuildResult(): void {
  try { sessionStorage.removeItem(AI_BUILD_RESULT_KEY); } catch { /* 없음 */ }
}

/** 결과 바의 "미반영" 목록 — 서버 계측에서 사실만 뽑는다(문구 생성 0) */
export function unappliedItemsOf(r: BuildResultHandoff): string[] {
  const m = r.materials || {};
  const out: string[] = [];
  const skipped: Array<{ type: string; reason: string }> = Array.isArray(m.features?.skipped) ? m.features.skipped : [];
  for (const s of skipped) {
    const label = AI_BUILD_FEATURES.find((f) => f.key === s.type)?.label || s.type;
    out.push(`${label}: ${s.reason}`);
  }
  const excluded: Array<{ name: string; reason: string }> = Array.isArray(m.excluded) ? m.excluded : [];
  for (const e of excluded) out.push(`상품 "${e.name}" 제외: ${e.reason}`);
  // ★ 2026-09-15 고객 채우기 사유(링크 없는 카드 · 자리가 없어 뺀 상품) · 서버 문장 그대로
  const notes: string[] = Array.isArray(m.notes) ? m.notes : [];
  for (const n of notes) out.push(String(n));
  const unverified: string[] = Array.isArray(m.mallUnverified) ? m.mallUnverified : [];
  if (m.mallFailed) out.push('몰 상품 가격을 확인하지 못해 불러온 값을 그대로 썼어요');
  else if (unverified.length > 0) out.push(`상품 ${unverified.length}개는 몰에서 다시 확인하지 못해 불러온 값을 그대로 썼어요`);
  if (Number(m.imagesDropped) > 0) out.push(`이미지 ${Number(m.imagesDropped)}장은 파일을 찾지 못해 뺐어요`);
  if (r.benefitStripped > 0) out.push(`혜택 수치 ${r.benefitStripped}곳은 "그대로 씁니다" 체크가 없어 비웠어요`);
  if (r.heroFallback) out.push('행사 제목이 없어 첫 화면 제목을 브랜드명으로 두었어요');
  if (Number(m.images) === 0) out.push('사진 없음: 문안형으로 만들었어요. 이미지를 추가하면 첫 화면이 살아나요');
  return out;
}

// ===== 노출 스위치(신규 ENV) — 서버가 정한다 · 화면은 묻기만(카드띠 · 패널 링크 · 페이지 분기 공용) =====

let autoBuildFlagPromise: Promise<boolean> | null = null;
export function fetchAiAutoBuildEnabled(): Promise<boolean> {
  if (!autoBuildFlagPromise) {
    autoBuildFlagPromise = (async () => {
      try {
        const r = await fetch('/api/event-campaigns/materials/quote?images=0&has_text=1', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const d = await r.json().catch(() => ({}));
        return r.ok && d?.auto_build_enabled === true;
      } catch {
        return false;
      }
    })();
    // 실패는 캐시하지 않는다(다음 화면이 다시 묻는다)
    autoBuildFlagPromise.then((v) => { if (!v) autoBuildFlagPromise = null; });
  }
  return autoBuildFlagPromise;
}

/** null = 아직 모름(그리지 않는다) · true = 카드띠·링크 노출 · false = 미노출 */
export function useAiAutoBuildEnabled(): boolean | null {
  const [flag, setFlag] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetchAiAutoBuildEnabled().then((v) => { if (alive) setFlag(v); });
    return () => { alive = false; };
  }, []);
  return flag;
}
