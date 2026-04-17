/**
 * ★ 인쇄전단 V2 (D129) — 슬롯 필러
 *
 * 역할 1(서버): manifest + 입력 데이터 → 정규화된 SlotData 반환
 *   - fallback 적용
 *   - selection 규칙 적용 (highest_discount, manual, featured 등)
 *   - category.mode='auto' + prefer 순서로 카테고리 할당
 *
 * 역할 2(브라우저 런타임): FILL_RUNTIME 상수로 JS 문자열 export
 *   - Puppeteer 페이지에 injectScript로 주입
 *   - window.__SLOT_DATA 를 읽어 DOM 바인딩 수행
 *   - 완료 시 window.__SLOTS_FILLED = true 신호
 *
 * 의존성: cheerio/jsdom 없음 (브라우저가 DOM 엔진 담당)
 */

import type { TemplateManifest, SlotDefinition } from './template-registry';

// ============================================================
// 타입
// ============================================================

export interface RawProduct {
  productName: string;
  originalPrice?: number;
  salePrice: number;
  unit?: string;
  category?: string;
  imageUrl?: string;
  promoType?: 'main' | 'sub' | 'general';
  featured?: boolean;
  aiCopy?: string;
  origin?: string;
}

export interface RawStoreInfo {
  name?: string;
  address?: string;
  phone?: string;
  hours?: string;
  deliveryHours?: string;
  logoUrl?: string;
  mapUrl?: string;
}

export interface RawQrInfo {
  title?: string;
  subtitle?: string;
  imageUrl?: string;
  targetUrl?: string;
}

export interface RawFlyerInput {
  store?: RawStoreInfo;
  qr?: RawQrInfo;
  heroTitle?: string;
  heroSubcopy?: string;
  products: RawProduct[];
  /** 슬롯별 직접 오버라이드 (텍스트/배너 라벨 등) */
  slotOverrides?: Record<string, any>;
}

/** 슬롯 ID → 해당 슬롯의 resolved 값 */
export type SlotData = Record<string, any>;

// ============================================================
// 유틸
// ============================================================

function formatNumber(n: number | undefined | null): string {
  if (n === null || n === undefined || isNaN(n as number)) return '';
  return Number(n).toLocaleString('ko-KR');
}

function discountRate(p: RawProduct): number {
  if (!p.originalPrice || p.originalPrice <= 0) return 0;
  if (p.salePrice >= p.originalPrice) return 0;
  return Math.round((1 - p.salePrice / p.originalPrice) * 100);
}

function matchCategory(p: RawProduct, prefer: string[] | undefined): boolean {
  if (!prefer || prefer.length === 0) return false;
  const cat = (p.category || '').trim();
  if (!cat) return false;
  return prefer.some(k => cat.includes(k) || k.includes(cat));
}

/**
 * 할인율 → 리본 텍스트 자동 선택 (메인 카드용)
 */
function ribbonTextByRate(rate: number, isTopItem: boolean): string {
  if (isTopItem && rate >= 40) return '한정특가';
  if (rate >= 50) return '파격세일';
  if (rate >= 40) return 'BEST특가';
  if (rate >= 30) return '오늘특가';
  if (rate >= 20) return '알뜰세일';
  if (rate > 0) return '할인';
  return '';
}

/**
 * 할인율 → 서브 카드 뱃지 (색상 분기용 kind + text)
 */
function badgeByRate(rate: number, index: number): { kind: string; text: string } {
  if (rate >= 45) return { kind: 'hot', text: 'HOT' };
  if (rate >= 35) return { kind: 'best', text: 'BEST' };
  if (rate >= 25) return { kind: 'pick', text: 'PICK' };
  if (rate >= 15) return { kind: 'new', text: '추천' };
  return { kind: '', text: ['BEST', 'PICK', 'HOT', '추천'][index % 4] };
}

/**
 * 상품을 카드용 뷰모델로 변환
 * (브라우저 runtime에서 data-bind 키로 참조)
 */
function toCardViewModel(p: RawProduct, index = 0) {
  const hasOriginal = typeof p.originalPrice === 'number' && p.originalPrice > 0 && p.originalPrice !== p.salePrice;
  const rate = discountRate(p);
  const isTop = index === 0;
  const badge = badgeByRate(rate, index);
  return {
    productName: p.productName || '',
    unit: p.unit || '',
    imageUrl: p.imageUrl || '',
    salePriceNumber: formatNumber(p.salePrice),
    originalPrice: hasOriginal ? formatNumber(p.originalPrice) + '원' : '',
    discountRate: rate > 0 ? rate : '',
    ribbonText: ribbonTextByRate(rate, isTop),
    badgeKind: badge.kind,
    badgeText: badge.text,
    aiCopy: p.aiCopy || '',
    origin: p.origin || '',
  };
}

// ============================================================
// 슬롯 타입별 resolver
// ============================================================

function resolveTextSlot(slot: SlotDefinition, input: RawFlyerInput): any {
  const ov = input.slotOverrides?.[slot.id];
  if (typeof ov === 'string' && ov.length > 0) return { value: ov };

  // id 매핑 예약어
  if (slot.id === 'hero_title' && input.heroTitle) return { value: input.heroTitle };
  if (slot.id === 'hero_subcopy' && input.heroSubcopy) return { value: input.heroSubcopy };

  return { value: slot.fallback || '' };
}

function resolveSectionBanner(slot: SlotDefinition, input: RawFlyerInput): any {
  const ov = input.slotOverrides?.[slot.id];
  return {
    label: (ov && ov.label) || slot.label || slot.fallback || '',
    sublabel: (ov && ov.sublabel) || slot.sublabel || '',
  };
}

function resolveStoreHeader(slot: SlotDefinition, input: RawFlyerInput): any {
  const s = input.store || {};
  const q = input.qr || {};
  return {
    store: {
      name: s.name || '',
      address: s.address || '',
      phone: s.phone || '',
      hours: s.hours || '',
      deliveryHours: s.deliveryHours || '',
      logoUrl: s.logoUrl || '',
      mapUrl: s.mapUrl || '',
    },
    qr: {
      title: q.title || '',
      subtitle: q.subtitle || '',
      imageUrl: q.imageUrl || '',
    },
  };
}

function resolveProductGrid(slot: SlotDefinition, input: RawFlyerInput): any {
  const selection = (slot as any).selection || { mode: 'highest_discount' };
  const minItems = (slot as any).minItems || 0;
  const maxItems = (slot as any).maxItems || (slot as any).cols * (slot as any).rows || 99;
  const filterPromo = selection.filter?.promoType;

  let pool = input.products.slice();

  if (filterPromo) {
    pool = pool.filter(p => p.promoType === filterPromo);
  }

  switch (selection.mode) {
    case 'highest_discount':
      pool.sort((a, b) => discountRate(b) - discountRate(a));
      break;
    case 'featured':
      pool = pool.filter(p => p.featured);
      break;
    case 'manual':
      // 사용자 수동 선택 — 입력 순서 유지
      break;
    case 'random':
      pool.sort(() => Math.random() - 0.5);
      break;
  }

  const items = pool.slice(0, maxItems).map((p, i) => toCardViewModel(p, i));

  return {
    items,
    minItems,
    maxItems,
    underfilled: items.length < minItems,
  };
}

function resolveCategoryGrid(slot: SlotDefinition, input: RawFlyerInput, usedCategories: Set<string>): any {
  const cfg = (slot as any).category || { mode: 'auto' };
  const cols = (slot as any).cols || 3;
  const rows = (slot as any).rows || 3;
  const maxItems = cols * rows;

  let pool: RawProduct[] = [];
  let categoryLabel = '';

  if (cfg.mode === 'fixed' && cfg.name) {
    categoryLabel = cfg.name;
    pool = input.products.filter(p => (p.category || '') === cfg.name);
  } else {
    // auto — prefer 순서대로 시도
    for (const cat of cfg.prefer || []) {
      if (usedCategories.has(cat)) continue;
      const matched = input.products.filter(p => matchCategory(p, [cat]));
      if (matched.length > 0) {
        pool = matched;
        categoryLabel = cat;
        usedCategories.add(cat);
        break;
      }
    }
    // prefer에서 못 찾았으면 나머지 카테고리 중 사용 안 한 것 첫 번째
    if (!categoryLabel) {
      const seen = new Set<string>();
      for (const p of input.products) {
        const c = (p.category || '').trim();
        if (!c || seen.has(c) || usedCategories.has(c)) continue;
        seen.add(c);
      }
      for (const c of seen) {
        const matched = input.products.filter(p => (p.category || '') === c);
        if (matched.length > 0) {
          pool = matched;
          categoryLabel = c;
          usedCategories.add(c);
          break;
        }
      }
    }
  }

  pool.sort((a, b) => discountRate(b) - discountRate(a));
  const items = pool.slice(0, maxItems).map((p, i) => toCardViewModel(p, i));

  return {
    items,
    categoryLabel: categoryLabel || (slot.fallback || ''),
    cols,
    rows,
  };
}

function resolveFooterNotice(slot: SlotDefinition, input: RawFlyerInput): any {
  const ov = input.slotOverrides?.[slot.id];
  const text = (ov && ov.text) || slot.fallback || '';
  return { text };
}

// ============================================================
// Public API: 서버측 resolve
// ============================================================

export function resolveSlotData(manifest: TemplateManifest, input: RawFlyerInput): SlotData {
  const out: SlotData = {};
  const usedCategories = new Set<string>();

  for (const slot of manifest.slots) {
    switch (slot.type) {
      case 'text':
      case 'rich_text':
      case 'typography':
        out[slot.id] = resolveTextSlot(slot, input);
        break;
      case 'section_banner':
        out[slot.id] = resolveSectionBanner(slot, input);
        break;
      case 'store_header':
        out[slot.id] = resolveStoreHeader(slot, input);
        break;
      case 'product_grid':
        out[slot.id] = resolveProductGrid(slot, input);
        break;
      case 'category_grid':
        out[slot.id] = resolveCategoryGrid(slot, input, usedCategories);
        break;
      case 'footer_notice':
        out[slot.id] = resolveFooterNotice(slot, input);
        break;
      case 'image':
      case 'qr':
      case 'map':
      case 'product_card':
      case 'decoration':
      default:
        out[slot.id] = {};
        break;
    }
  }

  return out;
}

// ============================================================
// 브라우저 런타임 (문자열로 export) — Puppeteer.evaluate()로 주입
// ============================================================

/**
 * 브라우저에서 실행될 슬롯 바인딩 스크립트.
 * - window.__SLOT_DATA 를 읽어 DOM 조작.
 * - data-slot / data-bind / data-bind-src / data-bind-bg / data-slot-meta 속성 인식.
 * - 그리드 슬롯은 <template data-role="card">를 복제하여 자식 삽입.
 * - 완료 시 window.__SLOTS_FILLED = true.
 */
export const FILL_RUNTIME = String.raw`
(function(){
  var data = window.__SLOT_DATA || {};

  function setByPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function fillBindings(root, context) {
    // data-bind-show="field" → 값이 비어 있으면 숨김 (먼저 처리)
    var showEls = root.querySelectorAll('[data-bind-show]');
    for (var i = 0; i < showEls.length; i++) {
      var el = showEls[i];
      var v = setByPath(context, el.getAttribute('data-bind-show'));
      if (v === undefined || v === null || v === '' || v === 0 || v === '0') {
        el.style.display = 'none';
      }
    }
    // data-bind-class-suffix="field" → field 값을 클래스 접미사로 추가
    var clsEls = root.querySelectorAll('[data-bind-class-suffix]');
    for (var i = 0; i < clsEls.length; i++) {
      var el = clsEls[i];
      var v = setByPath(context, el.getAttribute('data-bind-class-suffix'));
      if (v) el.classList.add(String(v));
    }
    // data-bind="field" → textContent
    var textEls = root.querySelectorAll('[data-bind]');
    for (var i = 0; i < textEls.length; i++) {
      var el = textEls[i];
      var v = setByPath(context, el.getAttribute('data-bind'));
      if (v !== undefined && v !== null && v !== '') {
        el.textContent = String(v);
      }
    }
    // data-bind-src="field" → img.src
    var srcEls = root.querySelectorAll('[data-bind-src]');
    for (var i = 0; i < srcEls.length; i++) {
      var el = srcEls[i];
      var v = setByPath(context, el.getAttribute('data-bind-src'));
      if (v) el.setAttribute('src', String(v));
      else el.classList.add('empty');
    }
    // data-bind-bg="field" → background-image
    var bgEls = root.querySelectorAll('[data-bind-bg]');
    for (var i = 0; i < bgEls.length; i++) {
      var el = bgEls[i];
      var v = setByPath(context, el.getAttribute('data-bind-bg'));
      if (v) {
        el.style.backgroundImage = "url('" + String(v).replace(/'/g, "\\'") + "')";
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      }
    }
  }

  function fillTextSlot(slotEl, value) {
    if (!value) return;
    if (typeof value === 'string') slotEl.textContent = value;
    else if (value.value != null) slotEl.textContent = String(value.value);
  }

  function fillSectionBanner(slotEl, value) {
    if (!value) return;
    fillBindings(slotEl, value);
  }

  function fillStoreHeader(slotEl, value) {
    if (!value) return;
    fillBindings(slotEl, value);
  }

  function fillFooterNotice(slotEl, value) {
    if (!value) return;
    if (value.text) slotEl.textContent = value.text;
  }

  function fillGrid(slotEl, value) {
    if (!value || !Array.isArray(value.items)) return;
    // <template data-role="card"> 추출
    var tmpl = slotEl.querySelector('template[data-role="card"]');
    if (!tmpl) return;
    // 기존 자식(템플릿 외) 제거
    var clones = slotEl.querySelectorAll(':scope > :not(template)');
    for (var c = 0; c < clones.length; c++) clones[c].remove();
    // 각 아이템별 복제 삽입
    for (var i = 0; i < value.items.length; i++) {
      var item = value.items[i];
      var frag = tmpl.content.cloneNode(true);
      // 복제된 조각 안에서 data-bind* 처리
      var wrapper = document.createElement('div');
      wrapper.appendChild(frag);
      fillBindings(wrapper, item);
      // wrapper 내용을 slotEl에 이동
      while (wrapper.firstChild) slotEl.appendChild(wrapper.firstChild);
    }
    // ★ 복제 완료 후 template 엘리먼트 제거 — nth-child 레이아웃 계산 방해 방지
    if (tmpl.parentNode === slotEl) {
      slotEl.removeChild(tmpl);
    }
  }

  function fillCategoryGrid(slotEl, value) {
    fillGrid(slotEl, value);
    // data-slot-meta="slotId.categoryLabel" 요소가 있으면 카테고리 라벨 주입
  }

  // 카테고리 라벨을 data-slot-meta 기반으로 처리
  var metaEls = document.querySelectorAll('[data-slot-meta]');
  for (var m = 0; m < metaEls.length; m++) {
    var metaEl = metaEls[m];
    var spec = metaEl.getAttribute('data-slot-meta');
    if (!spec) continue;
    var dot = spec.indexOf('.');
    if (dot < 0) continue;
    var slotId = spec.slice(0, dot);
    var field = spec.slice(dot + 1);
    var slotValue = data[slotId];
    if (slotValue && slotValue[field]) {
      metaEl.textContent = String(slotValue[field]);
    }
  }

  // 각 슬롯 ID별로 채우기 (v2 — Line B 클래스명 인식)
  var slotEls = document.querySelectorAll('[data-slot]');
  for (var i = 0; i < slotEls.length; i++) {
    var el = slotEls[i];
    var id = el.getAttribute('data-slot');
    var value = data[id];
    if (value === undefined) continue;

    // ── 그리드 계열 (product_grid / category_grid) ──
    if (el.classList.contains('main-grid') ||
        el.classList.contains('recommend-grid') ||
        el.classList.contains('fresh-grid')) {
      fillGrid(el, value);
    }
    // ── 푸터 유의사항 ──
    else if (el.classList.contains('footer-notice')) {
      fillFooterNotice(el, value);
    }
    // ── 마스트헤드 (매장 헤더) ──
    else if (el.classList.contains('masthead')) {
      fillStoreHeader(el, value);
    }
    // ── 히어로 타이틀 / 히어로 기간 / 히어로 서브카피 / 푸터 브랜드 (단일 텍스트) ──
    else if (el.classList.contains('hero-title') ||
             el.classList.contains('hero-period') ||
             el.classList.contains('hero-subcopy') ||
             el.classList.contains('footer-brand')) {
      fillTextSlot(el, value);
    }
    // ── 섹션 헤더 (v2: 번호+타이틀+서브라벨 구조) ──
    else if (el.classList.contains('section-main-header') ||
             el.classList.contains('section-recommend-header') ||
             el.classList.contains('section-fresh-header') ||
             el.classList.contains('section-banner-main') ||
             el.classList.contains('section-banner-recommend') ||
             el.classList.contains('section-banner-fresh')) {
      fillSectionBanner(el, value);
    }
    // ── fallback: data-bind 기반 텍스트 바인딩 ──
    else {
      fillTextSlot(el, value);
    }
  }

  window.__SLOTS_FILLED = true;
})();
`;
