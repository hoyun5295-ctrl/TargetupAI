/**
 * ★ CT-79: In-app Message Personalization — D215+ (2026-05-25)
 *
 * 🎯 목적
 *   인앱 메시지 안 Liquid 변수 ({{ customer.name }} 등) + 옛 %고객명% 변수 치환.
 *   - renderInAppMessage: message 객체 (title + body + buttons[].label) 전체 변수 치환
 *   - renderTextForCustomer: 단일 텍스트 변수 치환
 *   - buildPreviewCustomers: 미리보기용 샘플 customer 3건 (VIP / 일반 / 신규)
 *   - listAvailableVariables: 사용 가능 변수 매핑 (Frontend UI 드롭다운용)
 *
 * 🔗 옛 CT-50 (utils/liquid-templating.ts) 재사용
 *   - renderLiquid + flattenCustomerForLiquid + detectLiquidSyntax
 *
 * ⛔ 영구 원칙
 *   - 변수 치환 실패 시 = 원본 텍스트 유지 (발송 차단 X — Liquid 룰 정합)
 *   - 알려지지 않은 변수 = "" 빈 문자열 fallback (회사 admin 안내)
 *   - 회사 격리 (company_id 의무)
 */

import { renderLiquid, flattenCustomerForLiquid, detectLiquidSyntax } from './liquid-templating';
import { query } from '../config/database';
import type { GeneratedInAppMessage } from './inapp-ai-generator';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface PreviewCustomer {
  id: string;
  label: '신규' | '일반' | 'VIP';
  customer: Record<string, any>;
}

export interface AvailableVariable {
  key: string;
  label: string;
  hint: string;
  sampleValue: string;
}

export interface RenderResult {
  title: string;
  body: string;
  buttons: Array<{ id: string; label: string; action_url: string | null; style: string; background_color: string; text_color: string }>;
  errors: string[];
}

// ════════════════════════════════════════════════════════════════════
// 옛 %변수% 치환 (Backward compat) — D191 옛 패턴 정합
// ════════════════════════════════════════════════════════════════════

const LEGACY_VARIABLE_MAP: Record<string, (c: any) => string> = {
  '%고객명%':           (c) => String(c.name || '고객'),
  '%이름%':             (c) => String(c.name || '고객'),
  '%등급%':             (c) => String(c.grade || ''),
  '%전화%':             (c) => String(c.phone || ''),
  '%포인트%':           (c) => String(c.points ?? ''),
  '%지역%':             (c) => String(c.region || ''),
  '%최근구매매장%':     (c) => String(c.recent_purchase_store || c.store_name || ''),
};

function replaceLegacyVariables(text: string, customer: Record<string, any>): string {
  let out = text;
  for (const [pattern, getter] of Object.entries(LEGACY_VARIABLE_MAP)) {
    if (out.includes(pattern)) {
      out = out.split(pattern).join(getter(customer));
    }
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// 핵심 — 텍스트 변수 치환 (Liquid + 옛 %% 양쪽 지원)
// ════════════════════════════════════════════════════════════════════

/**
 * 단일 텍스트 변수 치환.
 * - Liquid 문법 ({{ }} / {% %}) = renderLiquid
 * - 옛 %변수% 패턴 = replaceLegacyVariables
 * @returns 치환된 텍스트 + 오류 배열 (발송 차단 X)
 */
export function renderTextForCustomer(
  text: string,
  customer: Record<string, any>
): { rendered: string; errors: string[] } {
  if (!text) return { rendered: '', errors: [] };

  // Step 1: 옛 %변수% 치환 먼저
  let out = replaceLegacyVariables(text, customer);

  // Step 2: Liquid 치환 (있는 경우만)
  const errors: string[] = [];
  if (detectLiquidSyntax(out)) {
    const flatCustomer = flattenCustomerForLiquid(customer);
    const liquidResult = renderLiquid(out, { customer: flatCustomer });
    out = liquidResult.rendered;
    if (liquidResult.errors.length > 0) {
      liquidResult.errors.forEach((e) => errors.push(e.message));
    }
  }

  return { rendered: out, errors };
}

/**
 * 인앱 메시지 전체 변수 치환 (title + body + buttons[].label).
 */
export function renderInAppMessage(
  message: GeneratedInAppMessage,
  customer: Record<string, any>
): RenderResult {
  const errors: string[] = [];

  const titleResult = renderTextForCustomer(message.title || '', customer);
  if (titleResult.errors.length > 0) errors.push(...titleResult.errors.map((e) => `title: ${e}`));

  const bodyResult = renderTextForCustomer(message.body || '', customer);
  if (bodyResult.errors.length > 0) errors.push(...bodyResult.errors.map((e) => `body: ${e}`));

  const renderedButtons = (message.buttons || []).map((btn) => {
    const labelResult = renderTextForCustomer(btn.label || '', customer);
    if (labelResult.errors.length > 0) errors.push(...labelResult.errors.map((e) => `button[${btn.id}].label: ${e}`));
    return {
      id: btn.id,
      label: labelResult.rendered,
      action_url: btn.action_url,
      style: btn.style,
      background_color: btn.background_color,
      text_color: btn.text_color,
    };
  });

  return {
    title: titleResult.rendered,
    body: bodyResult.rendered,
    buttons: renderedButtons,
    errors,
  };
}

// ════════════════════════════════════════════════════════════════════
// 미리보기용 샘플 customer 3건 (VIP / 일반 / 신규)
// ════════════════════════════════════════════════════════════════════

/**
 * 회사별 미리보기 샘플 customer 3건 (등급별).
 * 실제 customers 테이블에서 등급별 1건씩 SELECT — 없으면 가상 샘플 fallback.
 */
export async function buildPreviewCustomers(companyId: string): Promise<PreviewCustomer[]> {
  if (!companyId) return buildFallbackPreviewCustomers();

  const samples: PreviewCustomer[] = [];

  // VIP 등급 샘플
  const vipResult = await query(
    `SELECT id, name, grade, phone, points, region, recent_purchase_store, recent_purchase_date,
            total_purchase_amount, purchase_count, last_activity_at, cart_add_count_30d
     FROM customers
     WHERE company_id = $1::uuid AND grade ILIKE 'VIP%' AND is_active = true
     ORDER BY last_activity_at DESC NULLS LAST LIMIT 1`,
    [companyId]
  ).catch(() => ({ rows: [] }));

  if (vipResult.rows.length > 0) {
    samples.push({
      id: String(vipResult.rows[0].id),
      label: 'VIP',
      customer: enrichCustomerForPreview(vipResult.rows[0]),
    });
  }

  // 일반 등급 샘플
  const normalResult = await query(
    `SELECT id, name, grade, phone, points, region, recent_purchase_store, recent_purchase_date,
            total_purchase_amount, purchase_count, last_activity_at, cart_add_count_30d
     FROM customers
     WHERE company_id = $1::uuid AND (grade IS NULL OR grade NOT ILIKE 'VIP%') AND is_active = true
     ORDER BY purchase_count DESC NULLS LAST LIMIT 1`,
    [companyId]
  ).catch(() => ({ rows: [] }));

  if (normalResult.rows.length > 0) {
    samples.push({
      id: String(normalResult.rows[0].id),
      label: '일반',
      customer: enrichCustomerForPreview(normalResult.rows[0]),
    });
  }

  // 신규 등급 샘플 (가입 30일 안)
  const newResult = await query(
    `SELECT id, name, grade, phone, points, region, recent_purchase_store, recent_purchase_date,
            total_purchase_amount, purchase_count, last_activity_at, cart_add_count_30d
     FROM customers
     WHERE company_id = $1::uuid AND is_active = true
       AND created_at >= NOW() - INTERVAL '30 days'
     ORDER BY created_at DESC LIMIT 1`,
    [companyId]
  ).catch(() => ({ rows: [] }));

  if (newResult.rows.length > 0) {
    samples.push({
      id: String(newResult.rows[0].id),
      label: '신규',
      customer: enrichCustomerForPreview(newResult.rows[0]),
    });
  }

  // 부족분 fallback
  if (samples.length === 0) return buildFallbackPreviewCustomers();
  if (samples.length < 3) {
    const fallback = buildFallbackPreviewCustomers();
    const existingLabels = new Set(samples.map((s) => s.label));
    fallback.forEach((f) => {
      if (!existingLabels.has(f.label) && samples.length < 3) samples.push(f);
    });
  }

  return samples;
}

function enrichCustomerForPreview(row: any): Record<string, any> {
  const lastPurchase = row.recent_purchase_date ? new Date(row.recent_purchase_date) : null;
  const daysAgo = lastPurchase ? Math.floor((Date.now() - lastPurchase.getTime()) / (1000 * 60 * 60 * 24)) : 999;

  return {
    id: row.id,
    name: row.name || '고객',
    grade: row.grade || '일반',
    phone: row.phone || '',
    points: Number(row.points || 0),
    region: row.region || '',
    recent_product: row.recent_purchase_store || '',
    recent_purchase_store: row.recent_purchase_store || '',
    last_purchase_days_ago: daysAgo,
    cart_count: Number(row.cart_add_count_30d || 0),
    total_purchase_amount: Number(row.total_purchase_amount || 0),
    purchase_count: Number(row.purchase_count || 0),
  };
}

function buildFallbackPreviewCustomers(): PreviewCustomer[] {
  return [
    {
      id: 'preview-vip',
      label: 'VIP',
      customer: {
        name: '김민수',
        grade: 'VIP',
        phone: '010-0000-0001',
        points: 12000,
        region: '서울',
        recent_product: '강남점',
        recent_purchase_store: '강남점',
        last_purchase_days_ago: 7,
        cart_count: 3,
        total_purchase_amount: 1500000,
        purchase_count: 24,
      },
    },
    {
      id: 'preview-normal',
      label: '일반',
      customer: {
        name: '이서연',
        grade: '일반',
        phone: '010-0000-0002',
        points: 2300,
        region: '경기',
        recent_product: '판교점',
        recent_purchase_store: '판교점',
        last_purchase_days_ago: 45,
        cart_count: 1,
        total_purchase_amount: 230000,
        purchase_count: 4,
      },
    },
    {
      id: 'preview-new',
      label: '신규',
      customer: {
        name: '정지훈',
        grade: '신규',
        phone: '010-0000-0003',
        points: 0,
        region: '인천',
        recent_product: '',
        recent_purchase_store: '',
        last_purchase_days_ago: 999,
        cart_count: 0,
        total_purchase_amount: 0,
        purchase_count: 0,
      },
    },
  ];
}

// ════════════════════════════════════════════════════════════════════
// T3 (2026-06-11) — SDK 자동 기동 개인화: 메시지가 실제 쓰는 변수만 추출 + 브라우저 동봉
//   /inapp/active 응답에 customer 객체를 동봉해 자동 기동 시에도 {{ customer.X }}·%변수%가
//   진짜 값으로 치환되게 한다. 개인정보 최소화 — 화이트리스트 교차 변수만 SELECT·동봉.
// ════════════════════════════════════════════════════════════════════

/**
 * 브라우저 응답 동봉 허용 변수 화이트리스트.
 * phone 등 연락처 식별 정보는 의도적으로 제외 (브라우저 노출 차단).
 * enrichCustomerForPreview 출력 키와 1:1 — 신규 키 추가 시 양쪽 동시 갱신.
 */
export const INAPP_BROWSER_VAR_WHITELIST: string[] = [
  'name', 'grade', 'points', 'region',
  'recent_product', 'recent_purchase_store',
  'last_purchase_days_ago', 'cart_count',
  'total_purchase_amount', 'purchase_count',
];

/** 옛 %변수% 토큰 → customer 객체 키 매핑 (%전화%는 브라우저 동봉 차단으로 의도적 제외) */
const LEGACY_TOKEN_TO_VAR: Record<string, string> = {
  '%고객명%': 'name',
  '%이름%': 'name',
  '%등급%': 'grade',
  '%포인트%': 'points',
  '%지역%': 'region',
  '%최근구매매장%': 'recent_purchase_store',
};

interface UsedVarsMessageLike {
  title?: string | null;
  body?: string | null;
  buttons?: Array<{ label?: string | null }> | null;
  personalizationVars?: string[] | null;
  // ★ D230+ — 블록 메시지: 블록 텍스트도 변수 스캔 대상 (서버 동봉 customer가 블록 변수도 채우도록)
  contentBlocks?: any[] | null;
}

/**
 * 메시지들이 실제 사용하는 개인화 변수 추출 (화이트리스트 교차 + 중복 제거).
 * 스캔 대상: personalization_vars 배열 + title/body/buttons[].label의
 * {{ customer.X }} (| default: 필터 동반 포함) 및 옛 %변수% 토큰.
 */
export function extractUsedInAppVariables(messages: UsedVarsMessageLike[]): string[] {
  const whitelist = new Set(INAPP_BROWSER_VAR_WHITELIST);
  const used = new Set<string>();

  const scanText = (text: string | null | undefined) => {
    if (!text) return;
    const liquidRe = /\{\{\s*customer\.([a-zA-Z_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = liquidRe.exec(text)) !== null) {
      if (whitelist.has(m[1])) used.add(m[1]);
    }
    for (const [token, varName] of Object.entries(LEGACY_TOKEN_TO_VAR)) {
      if (text.includes(token) && whitelist.has(varName)) used.add(varName);
    }
  };

  // 블록 안 텍스트 필드 스캔 (eyebrow/headline/body/benefit/footer + bullets.items[].text + product.name/meta + cta_group.buttons[].label)
  const scanBlocks = (blocks: any[] | null | undefined) => {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      scanText(b.text);
      scanText(b.name);
      scanText(b.meta);
      scanText(b.label);
      if (Array.isArray(b.items)) b.items.forEach((it: any) => scanText(it?.text));
      if (Array.isArray(b.buttons)) b.buttons.forEach((bt: any) => scanText(bt?.label));
    }
  };

  for (const msg of messages || []) {
    (msg.personalizationVars || []).forEach((v) => {
      if (whitelist.has(v)) used.add(v);
    });
    scanText(msg.title);
    scanText(msg.body);
    (msg.buttons || []).forEach((b) => scanText(b?.label));
    scanBlocks(msg.contentBlocks);
  }

  return Array.from(used);
}

/**
 * 브라우저 동봉용 customer 객체 조회 — identity 매핑된 회원만, usedVars 키만 추려서 반환.
 * 미식별/미매핑/변수 0개면 null (응답에 customer 키 자체를 생략).
 */
export async function getInAppCustomerForBrowser(
  companyId: string,
  externalId: string,
  usedVars: string[]
): Promise<Record<string, any> | null> {
  if (!companyId || !externalId || !usedVars || usedVars.length === 0) return null;

  const linkR = await query(
    `SELECT customer_id FROM cdp_identity_links
     WHERE company_id = $1::uuid AND external_id = $2 AND customer_id IS NOT NULL
     LIMIT 1`,
    [companyId, externalId]
  );
  if (linkR.rows.length === 0) return null;
  const customerId = String(linkR.rows[0].customer_id);

  // buildPreviewCustomers와 동일 컬럼 집합 (운영 검증된 SELECT — 신규 컬럼 참조 0)
  const custR = await query(
    `SELECT id, name, grade, phone, points, region, recent_purchase_store, recent_purchase_date,
            total_purchase_amount, purchase_count, last_activity_at, cart_add_count_30d
     FROM customers
     WHERE id = $1::uuid AND company_id = $2::uuid
     LIMIT 1`,
    [customerId, companyId]
  );
  if (custR.rows.length === 0) return null;

  const enriched = enrichCustomerForPreview(custR.rows[0]);
  const out: Record<string, any> = {};
  for (const v of usedVars) {
    if (INAPP_BROWSER_VAR_WHITELIST.includes(v) && enriched[v] !== undefined) {
      out[v] = enriched[v];
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ════════════════════════════════════════════════════════════════════
// Frontend UI 드롭다운용 — 사용 가능 변수 매핑
// ════════════════════════════════════════════════════════════════════

export function listAvailableVariables(): AvailableVariable[] {
  return [
    { key: '{{ customer.name }}',                     label: '회원명',              hint: '회원의 실제 이름 (없으면 "고객")',   sampleValue: '김민수' },
    { key: '{{ customer.grade }}',                    label: '등급',                hint: 'VIP / 일반 / 신규 등',                sampleValue: 'VIP' },
    { key: '{{ customer.points }}',                   label: '적립 포인트',         hint: '현재 적립금 (숫자)',                  sampleValue: '12000' },
    { key: '{{ customer.region }}',                   label: '지역',                hint: '회원 지역 (서울 / 경기 등)',          sampleValue: '서울' },
    { key: '{{ customer.recent_product }}',           label: '직전 본 상품/매장',   hint: '직전 방문 상품 또는 매장명',          sampleValue: '강남점' },
    { key: '{{ customer.cart_count }}',               label: '장바구니 항목 수',    hint: '현재 장바구니 안 항목 수',            sampleValue: '3' },
    { key: '{{ customer.last_purchase_days_ago }}',   label: '마지막 구매 N일 전',  hint: '직전 구매일 N일 전 (숫자)',           sampleValue: '7' },
    { key: '{{ customer.purchase_count }}',           label: '총 구매 횟수',        hint: '누적 구매 횟수',                       sampleValue: '24' },
    { key: '{{ customer.total_purchase_amount }}',    label: 'LTV (총 구매액)',     hint: '누적 구매 금액 (원)',                  sampleValue: '1500000' },
    // 옛 %% 패턴 (Backward compat)
    { key: '%고객명%',                                label: '회원명 (옛 패턴)',    hint: '옛 %변수% 패턴 — Liquid 권장',       sampleValue: '김민수' },
    { key: '%등급%',                                  label: '등급 (옛 패턴)',      hint: '옛 %변수% 패턴 — Liquid 권장',       sampleValue: 'VIP' },
    { key: '%포인트%',                                label: '포인트 (옛 패턴)',    hint: '옛 %변수% 패턴 — Liquid 권장',       sampleValue: '12000' },
  ];
}
