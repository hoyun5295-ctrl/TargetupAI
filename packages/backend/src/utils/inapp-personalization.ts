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
import { getColumnFields } from './standard-field-map';
import type { GeneratedInAppMessage, SegmentConditions } from './inapp-ai-generator';
import { matchCustomersBySegment, isEmptySegment } from './inapp-segment-matcher';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface PreviewCustomer {
  id: string;
  /** '타겟'(세그먼트 최상단 실고객) / 'VIP' / '일반' / '신규' */
  label: string;
  customer: Record<string, any>;
  /** true = 실고객이 아닌 가상 예시 (고객 DB 0건 회사 폴백) — UI에 "가상 예시" 표기 의무 */
  is_sample?: boolean;
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

// ★ 2026-07-09: 하드코딩 %변수% 맵 폐기 — FIELD_MAP(standard-field-map) displayName + aliases 단일 소스에서 파생.
//   AI Operator·여정·인앱이 모두 displayName 토큰(%고객등급%·%등록매장정보% 등)을 emit하므로, 인앱 %변수% 치환도 동일 소스로 인식해야 빈칸 방지.
//   특수: name은 '고객' fallback / recent_purchase_store는 store_name 폴백 / phone은 브라우저 노출 최소화로 %전화%(옛 호환)만 유지.
const LEGACY_VARIABLE_MAP: Record<string, (c: any) => string> = (() => {
  const map: Record<string, (c: any) => string> = {};
  for (const f of getColumnFields()) {
    if (f.fieldKey === 'sms_opt_in' || f.fieldKey === 'phone') continue;
    const col = f.columnName;
    const fieldKey = f.fieldKey;
    const getter = (c: any) => {
      const v = c[col];
      if (fieldKey === 'name') return String(v || '고객');
      if (fieldKey === 'recent_purchase_store') return String(v || c.store_name || '');
      return v == null ? '' : String(v);
    };
    map[`%${f.displayName}%`] = getter;
    for (const a of f.aliases || []) map[`%${a}%`] = getter;
  }
  // 옛 호환 별칭 (FIELD_MAP alias 밖) — 인앱 옛 패턴 보존
  map['%전화%'] = (c) => String(c.phone || '');
  return map;
})();

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

  // ★ 2026-07-08 빈 변수 치환 뒤처리 — 익명·미식별에서 빈 값이 남긴 이중 공백 / 구두점 앞 공백 /
  //   줄 앞뒤 잔여 공백 정리. 변수 문법이 있던 텍스트에만 적용(직접 입력 텍스트 무손상). 개행은 보존.
  if (/\{\{|%[가-힣A-Za-z]/.test(text)) {
    out = out
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([,.!?)\]])/g, '$1')
      .replace(/^[ \t]+/gm, '')
      .replace(/[ \t]+$/gm, '');
  }

  return { rendered: out, errors };
}

/**
 * ★ 2026-07-08 블록 메시지 텍스트 서버 사전 치환.
 * /inapp/active가 익명·미식별 방문자에도 변수 공백이 안 나오게, 블록 텍스트 필드
 * (text / name / meta / label + items[].text + buttons[].label)만 renderTextForCustomer로 렌더한다.
 * 구조·비텍스트 필드(이미지·색 등)는 그대로. 문자열(JSON)·배열 입력 모두 지원.
 */
export function renderBlocksForCustomer(blocksRaw: any, customer: Record<string, any>): any {
  let blocks = blocksRaw;
  let wasString = false;
  if (typeof blocks === 'string') {
    try { blocks = JSON.parse(blocks); wasString = true; } catch { return blocksRaw; }
  }
  if (!Array.isArray(blocks)) return blocksRaw;
  const r = (t: any) => (typeof t === 'string' ? renderTextForCustomer(t, customer).rendered : t);
  const out = blocks.map((b: any) => {
    if (!b || typeof b !== 'object') return b;
    const nb: any = { ...b };
    if (typeof nb.text === 'string') nb.text = r(nb.text);
    if (typeof nb.name === 'string') nb.name = r(nb.name);
    if (typeof nb.meta === 'string') nb.meta = r(nb.meta);
    if (typeof nb.label === 'string') nb.label = r(nb.label);
    if (Array.isArray(nb.items)) {
      nb.items = nb.items.map((it: any) => (it && typeof it === 'object' && typeof it.text === 'string' ? { ...it, text: r(it.text) } : it));
    }
    if (Array.isArray(nb.buttons)) {
      nb.buttons = nb.buttons.map((bt: any) => (bt && typeof bt === 'object' && typeof bt.label === 'string' ? { ...bt, label: r(bt.label) } : bt));
    }
    return nb;
  });
  return wasString ? JSON.stringify(out) : out;
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

/**
 * 편집 미리보기용 실고객 샘플 — 하드코딩 샘플 영구 대체 (2026-07-07(2)).
 * - segment_conditions가 있으면 CT-78로 타겟 최상단(최근 활동순) 실고객 1건을 '타겟' 라벨 최우선 배치
 * - 이어서 등급별 실고객 샘플 (buildPreviewCustomers — 없을 때만 가상 폴백 + is_sample 표기)
 * - 세그먼트 조회 실패 = 등급 샘플만 (미리보기가 죽지 않게 폴백)
 */
export async function buildEditorPreviewCustomers(
  companyId: string,
  segmentConditions?: SegmentConditions | null
): Promise<PreviewCustomer[]> {
  const base = await buildPreviewCustomers(companyId);
  if (!companyId || !segmentConditions || isEmptySegment(segmentConditions)) return base;

  try {
    const ids = await matchCustomersBySegment(companyId, segmentConditions, 1);
    if (ids.length === 0) return base; // 타겟 0건 = 등급 샘플만 (자동 완화 X — 카운트 UI가 0건을 별도 표시)
    const r = await query(
      `SELECT id, name, grade, phone, points, region, recent_purchase_store, recent_purchase_date,
              total_purchase_amount, purchase_count, last_activity_at, cart_add_count_30d
       FROM customers
       WHERE company_id = $1::uuid AND id = $2::uuid LIMIT 1`,
      [companyId, ids[0]]
    );
    if (r.rows.length === 0) return base;
    const target: PreviewCustomer = {
      id: String(r.rows[0].id),
      label: '타겟',
      customer: enrichCustomerForPreview(r.rows[0]),
    };
    return [target, ...base.filter((b) => b.id !== target.id)].slice(0, 4);
  } catch {
    return base;
  }
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
      is_sample: true,
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
      is_sample: true,
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
      is_sample: true,
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

// 변수 → 근원 customers 컬럼 (CT-58 실측 프로필로 노출 필터링용). 파생 변수는 근원 컬럼 기준.
// cart_count(cart_add_count_30d)는 CT-58 분석 대상 밖이라 항상 노출.
const VAR_BASE_COLUMN: Record<string, string> = {
  '{{ customer.name }}': 'name',
  '{{ customer.grade }}': 'grade',
  '{{ customer.points }}': 'points',
  '{{ customer.region }}': 'region',
  '{{ customer.recent_product }}': 'recent_purchase_store',
  '{{ customer.last_purchase_days_ago }}': 'recent_purchase_date',
  '{{ customer.purchase_count }}': 'purchase_count',
  '{{ customer.total_purchase_amount }}': 'total_purchase_amount',
  '%고객명%': 'name',
  '%등급%': 'grade',
  '%포인트%': 'points',
};

/**
 * 사용 가능 변수 목록.
 * ★ 2026-07-02 Harold 지시 — 하드코딩 노출 금지: companyId 전달 시 CT-58 실측 프로필로
 *   데이터가 사실상 없는(채워짐 30% 미만 = blocked) 필드를 숨긴다. (인앱 렌더는 빈 값 fallback이
 *   있어 30~70% conditional은 유지 — 이메일 칩의 safe 70%+ 기준보다 완화.)
 */
export async function listAvailableVariables(companyId?: string): Promise<AvailableVariable[]> {
  const all: AvailableVariable[] = [
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
  if (!companyId) return all;
  try {
    const { getCompanyDataProfile } = await import('./company-data-profile');
    const profile = await getCompanyDataProfile(companyId);
    const blocked = new Set(profile.blockedFields.map((f) => f.field));
    return all.filter((v) => {
      const base = VAR_BASE_COLUMN[v.key];
      return !base || !blocked.has(base);
    });
  } catch (err: any) {
    console.log('[inapp-personalization] 변수 필터 프로필 조회 오류 — 전체 목록 반환:', err?.message);
    return all;
  }
}
