/**
 * ★ CT: 080 무료수신거부 번호 청구 (2026-07-30 신설)
 *
 * 기원 = 서수란 0729 "정산 관련 체크 사항" + KT 명세서 실측(Harold 제공 PDF).
 * KT는 인비토 명의로 월 1장을 청구한다 — 080 번호마다 부가서비스이용료(고정)+통화료(변동)+VAT.
 * 지금까지는 명세서에 손글씨로 번호↔업체를 적어 수작업 분할 청구했다. 이 CT가 그 흐름을 시스템으로 옮긴다:
 *   ① 번호↔회사 매핑(billing_080_numbers — 모달 등록, 향후 번호 추가 가능)
 *   ② KT 명세서 PDF 업로드 → vision 판독(biz-registration-extract 미러) → **코드 검산**(번호별 소계 합=080 소계)
 *   ③ 사람이 결과 확인 후 [반영] → billing_extra_items(월별 항목) 생성 → 발행 코어가 항목줄로 얹음
 *
 * 원칙:
 *  - 금액은 전부 **공급가 저장**(VAT는 청구서가 파생 — 0726 단가=공급가 원칙).
 *    이용료 9,900(부가세포함)=9,000 / KT 부가서비스 4,400=4,000 / 통화료=명세서 공급가 그대로.
 *  - **돈이라 자동 반영 금지** — 판독 결과는 화면 확인 후 [반영]으로만 저장(6원칙 ②⑤).
 *  - 검산은 AI가 아니라 코드가 한다. 명세서 자체의 080 소계와 어긋나면 fail-closed(반영 불가).
 *  - creditCost 0 — 슈퍼관리자 내부 운영 기능(biz-registration-extract와 동일).
 */

import { createHmac, timingSafeEqual } from 'crypto';
import pool from '../config/database';
// ★ 2026-08-05 회사 단위 정산 잠금 CT — 발행과 **같은 두 겹**을 잡아야 반영·취소가 발행을 막는다.
import { lockCompanyForBilling } from './billing-lock';
import { callAIWithFallback } from '../services/ai';
import type { EventImageInput } from './event-image-extract';

// ============================================================
//  매핑 (billing_080_numbers)
// ============================================================

export interface Billing080Number {
  id: string;
  number: string;            // 숫자만 (0802841300)
  company_id: string;
  company_name?: string;
  /** 청구 귀속 계정 — NULL이면 고객사 전체(공통 장). 발행이 이 값을 읽는다(복사하지 않는다) */
  user_id: string | null;
  label: string | null;      // 부서/브랜드 (시세이도 Nars 등)
  monthly_fee_supply: number; // 080 이용료 공급가 (인비토 관리료 — VAT 포함 9,900)
  kt_fee_supply: number;      // KT 부가서비스 실비 공급가 (VAT 포함 4,400)
  charge_call_fee: boolean;
  is_active: boolean;
  memo: string | null;
}

/** 번호 표기 정규화 — 숫자만. 080 국번 검증은 화면 몫(수기 특수 케이스 여지). */
/** 'YYYY-MM-DD' → 일수(정수 달력 산술 — 성분 UTC라 서버 TZ 무관) */
const dayNum = (d: string): number => {
  const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number);
  if (!y || !m || !dd) return NaN;
  return Date.UTC(y, m - 1, dd) / 86400000;
};

/** ★ 2026-08-20 재오픈 정정(Codex high 수용) — 그 달이 발행 기간들로 **전부** 덮였는가.
 *  귀속 축이 청구월=정산월이 되면서, 그 달 라벨 정산 없이 기간만 전부 덮인 달(연속 중간정산이
 *  6월·8월 라벨로 7월을 덮는 형태)에 항목을 반영하면 실릴 정산을 영영 못 만든다(새 그 달 라벨
 *  정산은 기간 중복 검사에 걸린다). 그 상태의 반영을 거부하는 판정 — 조용한 미청구 금지. */
export function monthFullyCovered(
  monthFirstDay: string,
  periods: Array<{ start: string; end: string }>,
): boolean {
  const [y, m] = String(monthFirstDay).slice(0, 7).split('-').map(Number);
  if (!y || !m) return false;
  const monthStart = Date.UTC(y, m - 1, 1) / 86400000;
  const monthEnd = Date.UTC(y, m, 0) / 86400000; // 그 달 말일
  const sorted = periods
    .map((p) => ({ s: dayNum(p.start), e: dayNum(p.end) }))
    .filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e) && p.e >= p.s)
    .sort((a, b) => a.s - b.s);
  let cursor = monthStart; // 아직 안 덮인 첫 날
  for (const p of sorted) {
    if (p.s > cursor) return false; // 틈 — 그 구간의 라벨 정산이 아직 가능하다
    if (p.e + 1 > cursor) cursor = p.e + 1;
    if (cursor > monthEnd) return true;
  }
  return cursor > monthEnd;
}

export function normalize080Number(v: any): string {
  return String(v ?? '').replace(/\D/g, '');
}

/** 표시용 080-XXX-XXXX (10자리 기준, 그 외 길이는 원문 유지) */
export function format080Number(digits: string): string {
  const d = normalize080Number(digits);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  return d;
}

export async function list080Numbers(): Promise<Billing080Number[]> {
  const r = await pool.query(
    // ★ 2026-07-31 귀속 계정 표시 — 목록에서 "고객사 전체"인지 "누구 앞"인지 바로 보여야 한다.
    `SELECT b.*, c.company_name, u.name AS user_name, u.login_id AS user_login_id
       FROM billing_080_numbers b
       JOIN companies c ON c.id = b.company_id
       LEFT JOIN users u ON u.id = b.user_id
      ORDER BY c.company_name, b.number`,
  );
  return r.rows.map((row: any) => ({
    ...row,
    monthly_fee_supply: Number(row.monthly_fee_supply) || 0,
    kt_fee_supply: Number(row.kt_fee_supply) || 0,
  }));
}

// ============================================================
//  KT 명세서 판독 (vision) + 검산 (코드)
// ============================================================

export interface KtStatementEntry {
  number: string;        // 숫자만
  call_fee: number;      // 통화료 공급가 (없으면 0)
  svc_fee: number;       // 부가서비스이용료 공급가
  vat: number;           // 부가가치세
  subtotal: number;      // 번호별 소계 (call+svc+vat)
}

export interface KtStatementParse {
  usage_period: string;        // 명세서 이용기간 표기 (예: "6.1 ~ 6.30") — 대상월 선택 참고용
  count_080: number;           // 명세서의 080 서비스번호 수
  total_080: number;           // 명세서의 080 서비스 소계 (VAT 포함)
  entries: KtStatementEntry[];
}

const KT_SYSTEM_PROMPT = `당신은 KT 전화요금 명세서(스캔 이미지 PDF)의 "이용상세내역"에서 080 서비스 번호별 금액을 "그대로 옮겨 적는" 전사 담당입니다.

[출력 — 반드시 아래 JSON 형식만. 다른 텍스트·코드펜스·설명 금지]
{"usage_period":"","count_080":0,"total_080":0,"entries":[{"number":"","call_fee":0,"svc_fee":0,"vat":0,"subtotal":0}]}

[규칙]
- entries에는 상품명이 "080서비스"인 서비스번호만 넣습니다. 일반전화(02 등)는 제외합니다.
- number = 서비스번호를 보이는 그대로 (예: 080-284-1300).
- call_fee = 그 번호의 통화료(예: "이동전화에 건 통화료"). 통화료 줄이 없으면 0.
- svc_fee = 부가서비스이용료. vat = 부가가치세. subtotal = 그 번호의 소계.
- count_080 = 080서비스 소계 줄의 서비스번호 수 (예: "서비스번호수 18대"의 18).
- total_080 = 080서비스 전체 소계 금액(납부금액 열). 일반전화 제외.
- usage_period = 이용기간 표기 (예: "6.1 ~ 6.30").
- 금액은 쉼표 없는 정수(원)로 적습니다. 이미지에 실제로 보이는 값만 적고, 안 보이면 0. 지어내지 않습니다.
- 손글씨 메모는 무시합니다.`;

/** 방어 파싱 — 형식 위반 시 null(호출측이 사용자 안내). 순수 함수(테스트 대상). */
export function parseKtStatementJson(raw: string): KtStatementParse | null {
  try {
    let t = String(raw ?? '').trim();
    const fence = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
    if (fence) t = fence[1].trim();
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    const obj = JSON.parse(t.slice(s, e + 1));
    const toInt = (v: any) => {
      const n = Number(String(v ?? '').replace(/[,\s원]/g, ''));
      return Number.isFinite(n) ? Math.round(n) : NaN;
    };
    const entries: KtStatementEntry[] = (Array.isArray(obj?.entries) ? obj.entries : [])
      .map((r: any) => ({
        number: normalize080Number(r?.number),
        call_fee: toInt(r?.call_fee),
        svc_fee: toInt(r?.svc_fee),
        vat: toInt(r?.vat),
        subtotal: toInt(r?.subtotal),
      }))
      .filter((r: KtStatementEntry) => r.number.length > 0);
    if (entries.length === 0) return null;
    return {
      usage_period: String(obj?.usage_period ?? '').slice(0, 40),
      count_080: toInt(obj?.count_080) || 0,
      total_080: toInt(obj?.total_080) || 0,
      entries,
    };
  } catch {
    return null;
  }
}

export interface KtValidation { ok: boolean; errors: string[] }

/**
 * (순수) 명세서 자체 검산 — 판독이 명세서와 일치하는가를 명세서 안의 합계로 확인한다.
 *  ① 번호별 call+svc+vat === subtotal (행 내부 일관성 — 판독 오독 검출)
 *  ② VAT === floor((call+svc) × 0.1) ±1 (KT 실측 전 행 이 규칙 — call↔vat 오분류 검출)
 *  ③ 부가서비스가 0인데 통화료·VAT가 있으면 차단 + 전 행 최빈값 이탈 차단 (call↔svc 오분류 검출 — Codex 1R 수용:
 *     call=4672·svc=0으로 읽으면 ①·Σ은 그대로 통과하는데 반영은 매핑 부가서비스료를 따로 더해 이중 가산된다)
 *  ④ Σ subtotal === total_080 · 행 수 === count_080 — **둘 다 필수**(0 = 판독 실패 = 불합격.
 *     "안 보이면 0" 폴백이 검산을 여는 fail-open이었다 — Codex 1R 수용)
 *  ⑤ 번호 중복 없음
 * 하나라도 어긋나면 반영 불가(fail-closed) — 돈은 틀린 숫자보다 미확정이 낫다.
 */
export function validateKtStatement(p: KtStatementParse): KtValidation {
  const errors: string[] = [];
  const seen = new Set<string>();
  // ★ 3행 미만 = 반영 불가(Codex 2R F4 수용) — call↔svc 스왑 검출은 최빈값(통계 축)에 기대는데 표본이
  //   3행 미만이면 성립하지 않는다. 매핑 kt_fee_supply와의 대조는 그 축이 청구 정책값(리스킨 무료=0)이라
  //   실비 검증에 쓸 수 없어 불수용. 실측 명세서는 18행이라 운영 영향 0 — 소수 행은 수동 처리로.
  if ((p.entries || []).length < 3) {
    errors.push(`판독된 080 번호가 ${(p.entries || []).length}대뿐 — 검산 표본이 부족해 자동 반영할 수 없습니다. 명세서 전체가 판독됐는지 확인하거나 수동으로 처리해주세요.`);
  }
  // ③ 최빈값 — KT 부가서비스이용료는 전 번호 동일(실측 4,000). 요금 개정으로 값이 바뀌어도 "전 행 동일"은 유지된다.
  const svcCounts = new Map<number, number>();
  for (const e of p.entries) if (Number.isFinite(e.svc_fee)) svcCounts.set(e.svc_fee, (svcCounts.get(e.svc_fee) || 0) + 1);
  const svcMode = Array.from(svcCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

  for (const e of p.entries) {
    const disp = format080Number(e.number);
    if (!Number.isFinite(e.call_fee) || !Number.isFinite(e.svc_fee) || !Number.isFinite(e.vat) || !Number.isFinite(e.subtotal)) {
      errors.push(`${disp}: 금액 판독 불가`);
      continue;
    }
    if (e.call_fee < 0 || e.svc_fee < 0 || e.vat < 0 || e.subtotal < 0) {
      errors.push(`${disp}: 음수 금액`);
    }
    if (e.call_fee + e.svc_fee + e.vat !== e.subtotal) {
      errors.push(`${disp}: 통화료 ${e.call_fee.toLocaleString()} + 부가서비스 ${e.svc_fee.toLocaleString()} + VAT ${e.vat.toLocaleString()} ≠ 소계 ${e.subtotal.toLocaleString()}`);
    }
    // ② VAT 비율 — KT는 (통화료+부가서비스)의 10%를 원 미만 내림으로 부과한다(2026-07 명세서 18행 전수 실측). ±1 여유.
    const expectVat = Math.floor((e.call_fee + e.svc_fee) * 0.1);
    if (Math.abs(e.vat - expectVat) > 1) {
      errors.push(`${disp}: VAT ${e.vat.toLocaleString()}이 (통화료+부가서비스)의 10%(${expectVat.toLocaleString()})와 다름 — 오분류 판독 가능`);
    }
    // ③ 부가서비스 0 행 — 실측상 전 번호에 부가서비스 줄이 있다. 0이면 통화료에 섞여 읽혔을 가능성.
    if (e.svc_fee <= 0 && (e.call_fee > 0 || e.vat > 0)) {
      errors.push(`${disp}: 부가서비스이용료가 0으로 판독됨 — 통화료에 섞였을 수 있어 반영 불가`);
    } else if (svcMode !== undefined && e.svc_fee !== svcMode && p.entries.length >= 3) {
      errors.push(`${disp}: 부가서비스이용료 ${e.svc_fee.toLocaleString()}이 다른 번호(${Number(svcMode).toLocaleString()})와 다름 — 오분류 판독 가능`);
    }
    if (seen.has(e.number)) errors.push(`${disp}: 번호 중복 판독`);
    seen.add(e.number);
  }
  // ④ 합계·행 수 — 필수. 0(미판독)도 불합격.
  const sum = p.entries.reduce((s, e) => s + (Number.isFinite(e.subtotal) ? e.subtotal : 0), 0);
  if (!(p.total_080 > 0) || sum !== p.total_080) {
    errors.push(`번호별 소계 합 ${sum.toLocaleString()}원 ≠ 명세서 080 소계 ${(p.total_080 || 0).toLocaleString()}원 — 소계 미판독이거나 행 누락·오독`);
  }
  if (!(p.count_080 > 0) || p.entries.length !== p.count_080) {
    errors.push(`판독된 번호 ${p.entries.length}대 ≠ 명세서 서비스번호수 ${p.count_080 || 0}대 — 번호수 미판독이거나 행 누락`);
  }
  return { ok: errors.length === 0, errors };
}

// ============================================================
//  판독 결과 서버 결속 (HMAC 서명 — Codex 2R F2 수용)
// ============================================================
// [반영]은 /parse가 돌려준 전문을 되보내는데, 검산은 "전문 안에서의 일관성"만 본다 — 일관되게 조작한
// 전문은 통과한다. 그래서 /parse가 정규화된 전문에 서버 서명을 붙이고, /apply는 서명이 맞는 전문만 받는다.
// 판독을 거치지 않은 금액은 서명이 없어 반영될 수 없다(세션 저장 없이 결속 — Codex 제시 대안 채택).

const KT_SIGN_TTL_MS = 6 * 60 * 60 * 1000; // 업로드 후 6시간 안에 반영 — 지난 판독의 재사용 차단

function ktSignSecret(): string {
  const s = process.env.JWT_SECRET || '';
  if (!s) throw new Error('서명 비밀키가 설정되지 않았습니다.'); // auth.ts가 기동 차단하므로 실제로는 도달 불가
  return s;
}

/**
 * (순수) 엄격 정수 — **숫자 타입의 안전한 정수만** 인정, 그 외(null·NaN·문자열·무한대·소수)는 NaN.
 * `Number(null)=0` 같은 JS 강제 변환이 "판독 불가"를 "0원"으로 뭉개는 것을 막는다(Codex 3R 수용).
 * 반올림하지 않는다(Codex 4R 수용) — 671.6을 672로 살려주면 손상된 전문이 정상으로 통과한다.
 * 판독 시점의 반올림은 parseKtStatementJson 몫이고, 서명 이후 경로는 원본 그대로여야 fail-closed다.
 */
export function toStrictInt(v: any): number {
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : NaN;
}

/** (순수) 서명 대상 정규형 — 번호 정렬·정수 고정. 비정수 금액이 하나라도 있으면 **throw**(정규형 자체가 성립하지 않는다). */
export function canonicalKtStatement(p: Pick<KtStatementParse, 'count_080' | 'total_080' | 'entries'>): string {
  const req = (v: any): number => {
    const n = toStrictInt(v);
    if (!Number.isSafeInteger(n)) throw new Error('정규형 불가 — 비정수 금액');
    return n;
  };
  const entries = [...(p.entries || [])]
    .map((e) => ({
      n: normalize080Number(e.number),
      c: req(e.call_fee), s: req(e.svc_fee), v: req(e.vat), t: req(e.subtotal),
    }))
    .sort((a, b) => a.n.localeCompare(b.n));
  return JSON.stringify({ c: req(p.count_080), t: req(p.total_080), e: entries });
}

/** 판독 직후 서명 — `ts.hmac` 형식. */
export function signKtStatement(p: KtStatementParse): string {
  const ts = Date.now();
  const mac = createHmac('sha256', ktSignSecret()).update(`${ts}.${canonicalKtStatement(p)}`).digest('hex');
  return `${ts}.${mac}`;
}

/** 반영 전 서명 검증 — 위조·변조·만료·비정수 금액(정규형 불가) 전부 false. */
export function verifyKtStatementSignature(p: Pick<KtStatementParse, 'count_080' | 'total_080' | 'entries'>, signature: string): boolean {
  const m = String(signature || '').match(/^(\d{10,16})\.([0-9a-f]{64})$/);
  if (!m) return false;
  const ts = Number(m[1]);
  if (!Number.isFinite(ts) || Date.now() - ts > KT_SIGN_TTL_MS || ts > Date.now() + 60_000) return false;
  let canonical: string;
  try {
    canonical = canonicalKtStatement(p);
  } catch {
    return false; // null·NaN·문자열 금액 = 정규형 자체가 성립하지 않는 전문 — 서명 이전에 거부
  }
  const expect = createHmac('sha256', ktSignSecret()).update(`${ts}.${canonical}`).digest('hex');
  const a = Buffer.from(expect, 'hex');
  const b = Buffer.from(m[2], 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** KT 명세서 PDF/이미지 → 번호별 금액. 판독·검산 실패 시 throw(호출측이 사용자 안내). */
export async function extractKtStatement(params: { image: EventImageInput; adminId?: string | null }): Promise<KtStatementParse> {
  const raw = await callAIWithFallback({
    system: KT_SYSTEM_PROMPT,
    userMessage: '이 KT 명세서의 이용상세내역에서 080 서비스 번호별 금액만 규칙대로 JSON으로 옮겨 적어줘. 보이는 값만 적고 지어내지 마.',
    maxTokens: 3000,
    temperature: 0,
    source: 'kt-statement-extract',
    creditCost: 0, // 슈퍼관리자 내부 기능 — 고객사 크레딧 미차감
    userId: params.adminId || undefined,
    images: [params.image],
  });
  const parsed = parseKtStatementJson(raw);
  if (!parsed) throw new Error('KT 명세서에서 080 번호별 금액을 읽지 못했습니다. 글자가 선명한 파일로 다시 시도해주세요.');
  return parsed;
}

// ============================================================
//  반영 (billing_extra_items 생성)
// ============================================================

export interface KtReconcileRow {
  number: string;             // 숫자만
  display_number: string;     // 080-XXX-XXXX
  call_fee: number;           // 통화료 공급가 (명세서)
  mapped: boolean;
  company_id?: string;
  company_name?: string;
  label?: string | null;
  monthly_fee_supply?: number;
  kt_fee_supply?: number;
  charge_call_fee?: boolean;
}

/** 판독 결과 × 매핑 조인 — 화면 확인 표의 원천. 미매핑 번호는 보류로 표시된다(시세이도 등). */
export async function reconcileKtStatement(entries: KtStatementEntry[]): Promise<KtReconcileRow[]> {
  const mappings = await list080Numbers();
  const byNumber = new Map(mappings.filter((m) => m.is_active).map((m) => [m.number, m]));
  return entries.map((e) => {
    const m = byNumber.get(e.number);
    return {
      number: e.number,
      display_number: format080Number(e.number),
      call_fee: e.call_fee,
      mapped: !!m,
      ...(m ? {
        company_id: m.company_id,
        company_name: m.company_name,
        label: m.label,
        monthly_fee_supply: m.monthly_fee_supply,
        kt_fee_supply: m.kt_fee_supply,
        charge_call_fee: m.charge_call_fee,
      } : {}),
    };
  });
}

// ============================================================
//  부가서비스 수기 항목 (kind='manual' — ★2026-07-30 Harold 확정: 시세이도 단축 URL 장당 5만 등
//  "직접 입력해놓으면 거래내역서에 부가서비스 항목으로 추가")
// ============================================================

/**
 * 수기 항목 추가 — 단가×수량을 **수량만큼의 행**으로 넣는다(행당 supply_amount=단가).
 * 청구서 항목줄(buildInvoiceLines)이 같은 단가를 합쳐 "부가서비스 N건 × 단가"로 참 산식을 인쇄한다.
 * 발행과 같은 회사 잠금 + 그 달 발행 존재 시 409(굳은 청구서에 안 실리는 항목을 만들지 않는다 — 080 반영과 동일 계약).
 */
export async function addManualExtraItems(params: {
  companyId: string;
  /** ★ 2026-07-31 귀속 계정 — null이면 고객사 전체(공통 장), 값이 있으면 그 계정 장으로 청구된다. */
  userId?: string | null;
  periodMonth: string;   // 'YYYY-MM-01'
  label: string;         // 항목 내용 (예: 단축 URL 제작)
  unitSupply: number;    // 건당 공급가
  qty: number;           // 1~100
  adminId?: string | null;
}): Promise<{ inserted: number; supplyTotal: number }> {
  const periodMonth = String(params.periodMonth || '');
  if (!/^\d{4}-\d{2}-01$/.test(periodMonth)) throw new Error('대상월 형식이 올바르지 않습니다 (YYYY-MM-01).');
  const label = String(params.label || '').trim().slice(0, 180);
  if (!label) throw new Error('항목 내용을 입력해주세요.');
  const unit = params.unitSupply;
  if (!(typeof unit === 'number' && Number.isSafeInteger(unit)) || unit <= 0) {
    throw new Error('건당 금액(공급가)을 1원 이상 정수로 입력해주세요.');
  }
  const qty = params.qty;
  if (!(typeof qty === 'number' && Number.isSafeInteger(qty)) || qty < 1 || qty > 100) {
    throw new Error('수량은 1~100 사이로 입력해주세요.');
  }
  if (!params.companyId) throw new Error('회사를 선택해주세요.');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockCompanyForBilling(client, String(params.companyId));
    // ★ 2026-08-20 판정 축 = 청구월 = 정산월(발행 항목 선택과 같은 축 — 겹침이면 중간정산 이웃 달 오탐)
    const billed = await client.query(
      `SELECT id FROM billings WHERE company_id = $1
         AND make_date(billing_year, billing_month, 1) = $2::date LIMIT 1`,
      [params.companyId, periodMonth],
    );
    if (billed.rows.length > 0) {
      throw new Error('그 달 정산이 이미 발행돼 있어 항목을 추가할 수 없습니다. 다음 달에 청구하거나 발행을 삭제한 뒤 추가해주세요.');
    }
    // ★ Codex high 수용 — 그 달 라벨 정산은 없는데 발행 기간이 그 달을 전부 덮은 상태(연속 중간정산이
    //   이웃 달 라벨로 덮은 형태)면, 지금 반영해도 실릴 정산을 만들 수 없다. 조용한 미청구 대신 거부.
    //   ★ 2R 수용 — 수동 정산완료 기간도 같은 이유로 합쳐 판정한다(수동완료 겹침은 발행을 409로 막는다).
    const cover = await client.query(
      `SELECT billing_start::text AS s, billing_end::text AS e FROM billings
        WHERE company_id = $1
          AND billing_start <= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date
          AND billing_end >= $2::date
       UNION ALL
       SELECT period_start::text, period_end::text FROM billing_manual_completions
        WHERE company_id = $1
          AND period_start <= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date
          AND period_end >= $2::date`,
      [params.companyId, periodMonth],
    );
    if (monthFullyCovered(periodMonth, cover.rows.map((r: any) => ({ start: r.s, end: r.e })))) {
      throw new Error('그 달 전체가 이미 발행된 정산 기간(또는 수동 정산완료)에 덮여 있어 지금 추가하면 어느 청구서에도 실리지 못합니다. 해당 기간 정산 삭제 또는 수동 정산완료 해제 후 추가해주세요.');
    }
    let inserted = 0;
    for (let i = 0; i < qty; i++) {
      const r = await client.query(
        `INSERT INTO billing_extra_items (company_id, user_id, period_month, kind, label, supply_amount, source_ref, created_by)
         VALUES ($1, $6::uuid, $2::date, 'manual', $3, $4, NULL, $5)`,
        [params.companyId, periodMonth, label, unit, params.adminId || null, params.userId || null],
      );
      inserted += r.rowCount || 0;
    }
    await client.query('COMMIT');
    return { inserted, supplyTotal: unit * qty };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* release가 파기 */ }
    throw err;
  } finally {
    client.release();
  }
}

/** 수기/080 항목 개별 삭제 — **미소비(billed_billing_id IS NULL)만**. 소비된 행은 발행 삭제로만 되돌린다. */
export async function deleteExtraItem(id: string): Promise<boolean> {
  const r = await pool.query(
    `DELETE FROM billing_extra_items WHERE id = $1 AND billed_billing_id IS NULL`,
    [id],
  );
  return (r.rowCount || 0) > 0;
}

export interface KtApplyResult {
  /** `call_supply` = 이번 반영으로 확정된 **통화료 합**. 이용료·부가서비스는 매핑 원장이 소유하므로
   *  실제 청구액은 반영 현황 탭이 원장과 함께 계산해 보여준다(여기서 따로 더하면 두 계산이 갈라진다). */
  applied: Array<{ company_id: string; company_name: string; numbers: number; call_supply: number }>;
  skipped: Array<{ company_id?: string; company_name?: string; number?: string; reason: string }>;
}

/**
 * [반영] — 매핑된 번호의 그 달 청구 항목을 만든다.
 *
 * ★ 입력 = **판독 결과 전문**(entries + total_080 + count_080)이고 서버가 검산을 **다시 실행**한다(Codex 1R 수용 —
 *   반영 API가 클라이언트가 보낸 임의 금액을 신뢰하면 /parse의 검산이 장식이 된다. 변조·invalid 재사용·
 *   다른 명세서 짜깁기 전부 여기서 다시 막힌다). 검산 실패 = 전체 거부.
 *
 * 회사 단위로 독립 반영(일괄발급 부분 실패 허용과 같은 원칙):
 *  - **발행과 같은 회사 잠금**(pg_advisory_xact_lock(company, 'billing'))을 잡고 발행 존재를 재검사한다(Codex 1R 수용 —
 *    잠금 없이 조회만 하면 발행 트랜잭션과 엇갈려 "발행엔 안 실렸는데 반영은 커밋"되는 고아 항목이 생긴다)
 *
 * ★ 2026-08-04 저장하는 것은 **번호당 1행**(`kind='080_call'`, 그 달 그 번호의 통화료)뿐이다(서수란 0803 접수).
 *   그전에는 이용료·KT 부가서비스·통화료 청구 여부·귀속 계정까지 매핑 원장에서 복사해 3행으로 굳혔고,
 *   그래서 매핑을 고쳐도 청구서가 옛 값으로 나갔다. 계약값은 원장이 소유하고 발행이 그때 읽는다
 *   (`buildExtraBillingItems` — 이용료·부가서비스·통화료를 파생). 통화료만 명세서에서 오는 사실이라 남긴다.
 *   통화료 0원인 번호도 행을 만든다 — "그 달 그 번호가 반영됐다"가 발행이 그 번호를 싣는 근거다.
 *
 *   이미 반영된 번호는 `ON CONFLICT DO NOTHING`으로 **그 번호만** 건너뛴다. 그전에는 23505가
 *   회사 트랜잭션 전체를 롤백해서, 번호가 1개에서 4개로 늘어난 회사는 새 번호 3개까지 함께 죽었다.
 */
export async function applyKtStatement(params: {
  periodMonth: string;         // 'YYYY-MM-01'
  statement: KtStatementParse; // 판독 결과 전문 — 서버 재검산 대상
  signature: string;           // /parse가 발급한 서명 — 판독을 거치지 않은 금액 차단(Codex 2R F2)
  adminId?: string | null;
}): Promise<KtApplyResult> {
  const periodMonth = String(params.periodMonth || '');
  if (!/^\d{4}-\d{2}-01$/.test(periodMonth)) throw new Error('대상월 형식이 올바르지 않습니다 (YYYY-MM-01).');

  // ★ 서명 검증 — /parse가 돌려준 전문 그대로인가(위조·변조·만료 차단). 검산보다 먼저 본다.
  if (!verifyKtStatementSignature(params.statement || ({} as any), params.signature)) {
    throw new Error('판독 결과 서명이 유효하지 않습니다. 명세서를 다시 판독한 뒤 반영해주세요(판독 후 6시간 안에만 반영할 수 있습니다).');
  }

  // ★ 서버 재검산 — /parse와 같은 함수. 실패 = 전체 거부(부분 반영 없음).
  //   정규화는 toStrictInt(숫자 타입 유한값만) — `Number(null)=0` 강제 변환이 "판독 불가"를
  //   "0원"으로 살려내던 구멍 차단(Codex 3R). 비정수는 NaN으로 남아 검산(금액 판독 불가)에 걸린다.
  const entries = (params.statement?.entries || []).map((e) => ({
    number: normalize080Number(e.number),
    call_fee: toStrictInt(e.call_fee),
    svc_fee: toStrictInt(e.svc_fee),
    vat: toStrictInt(e.vat),
    subtotal: toStrictInt(e.subtotal),
  }));
  const revalidated = validateKtStatement({
    usage_period: String(params.statement?.usage_period || ''),
    count_080: toStrictInt(params.statement?.count_080),
    total_080: toStrictInt(params.statement?.total_080),
    entries,
  });
  if (!revalidated.ok) {
    throw new Error(`명세서 검산에 실패해 반영할 수 없습니다: ${revalidated.errors.slice(0, 3).join(' / ')}`);
  }

  const mappings = await list080Numbers();
  const byNumber = new Map(mappings.filter((m) => m.is_active).map((m) => [m.number, m]));

  // 회사별로 묶는다 — 반영 단위 = 회사(시세이도류 여러 번호 = 한 회사 한 트랜잭션)
  const byCompany = new Map<string, Array<{ m: Billing080Number; call_fee: number }>>();
  const skipped: KtApplyResult['skipped'] = [];
  for (const r of entries) {
    const m = byNumber.get(r.number);
    if (!m) { skipped.push({ number: format080Number(r.number), reason: '매핑 없음 — 번호 관리에서 회사를 등록해주세요' }); continue; }
    if (!byCompany.has(m.company_id)) byCompany.set(m.company_id, []);
    byCompany.get(m.company_id)!.push({ m, call_fee: r.call_fee });
  }

  const applied: KtApplyResult['applied'] = [];

  for (const [companyId, list] of byCompany.entries()) {
    const companyName = list[0].m.company_name || '';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ★ 발행 코어와 **같은 회사 잠금**(CT 하나) — 발행·반영·취소가 한 축으로 직렬화된다.
      await lockCompanyForBilling(client, String(companyId));

      // 그 달 정산이 이미 있으면 이 회사는 반영하지 않는다 — 굳은 청구서에 안 실리는 항목을 만들지 않는다.
      //   ★ 2026-08-20 판정 축 = 청구월 = 정산월(발행 항목 선택과 같은 축). 잠금 획득 후 재검사라 발행과 엇갈리지 않는다.
      //   ★ Codex high 수용 — 라벨 정산은 없어도 그 달 전체가 발행 기간에 덮였으면(연속 중간정산) 같은 이유로 거부.
      const billed = await client.query(
        `SELECT id FROM billings WHERE company_id = $1
           AND make_date(billing_year, billing_month, 1) = $2::date LIMIT 1`,
        [companyId, periodMonth],
      );
      // ★ 2R 수용 — 수동 정산완료 기간도 같은 이유로 합쳐 판정(수동완료 겹침은 발행을 409로 막는다).
      const kCover = billed.rows.length > 0 ? null : await client.query(
        `SELECT billing_start::text AS s, billing_end::text AS e FROM billings
          WHERE company_id = $1
            AND billing_start <= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date
            AND billing_end >= $2::date
         UNION ALL
         SELECT period_start::text, period_end::text FROM billing_manual_completions
          WHERE company_id = $1
            AND period_start <= ($2::date + INTERVAL '1 month' - INTERVAL '1 day')::date
            AND period_end >= $2::date`,
        [companyId, periodMonth],
      );
      if (billed.rows.length > 0
        || monthFullyCovered(periodMonth, (kCover?.rows || []).map((r: any) => ({ start: r.s, end: r.e })))) {
        await client.query('ROLLBACK');
        skipped.push({
          company_id: companyId, company_name: companyName,
          reason: billed.rows.length > 0
            ? '그 달 정산이 이미 발행됨 — 발행 삭제 후 반영하거나 다음 달에 청구'
            : '그 달 전체가 발행된 정산 기간(또는 수동 정산완료)에 덮임 — 반영해도 실릴 청구서가 없어 건너뜀',
        });
        continue;
      }

      // ★ 2026-08-04 **잠금을 잡은 뒤 원장을 다시 읽는다**(Codex 2R high 수용).
      //   매핑 목록은 잠금 밖에서 한 번 읽어 회사별로 묶는다. 그 사이 매핑 회사·번호가 옮겨지면
      //   (추가 청구 관리의 이관 트랜잭션) 이 반복문은 잠금을 얻고도 **옛 회사로 행을 만든다.**
      //   어느 직렬 순서로도 나올 수 없는 고아 행이고, 그 회사 발행이 통째로 막힌다.
      const fresh = await client.query(
        `SELECT number FROM billing_080_numbers
          WHERE company_id = $1::uuid AND number = ANY($2::text[]) AND is_active`,
        [companyId, list.map((x) => x.m.number)],
      );
      const stillMine = new Set<string>(fresh.rows.map((row: any) => String(row.number)));

      let numbers = 0;
      let callSupply = 0;
      const already: string[] = [];
      for (const { m, call_fee } of list) {
        const disp = format080Number(m.number);
        if (!stillMine.has(m.number)) {
          skipped.push({ company_id: companyId, company_name: companyName, number: disp, reason: '반영 도중 그 번호의 매핑이 바뀌었습니다(회사 이관·중지) — 다시 판독해 반영해주세요' });
          continue;
        }
        const callFee = Math.max(0, Number(call_fee) || 0);
        const r = await client.query(
          // 라벨은 화면 표시용이고 청구서 항목명은 유형키(EXTRA_080_*)가 소유한다 — 여기에 계약 금액을
          // 적어 넣지 않는다(적으면 그것이 또 하나의 죽은 복사본이 된다).
          `INSERT INTO billing_extra_items (company_id, period_month, kind, label, supply_amount, source_ref, created_by)
           VALUES ($1, $2::date, '080_call', $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [companyId, periodMonth, `080 (${disp})`, callFee, m.number, params.adminId || null],
        );
        if ((r.rowCount || 0) === 0) {
          // ★ UNIQUE(period_month, kind, source_ref)는 **전사 하나**다 — 충돌 상대가 다른 회사일 수 있다.
          //   그것을 "이미 반영"으로 뭉개면 번호가 재배정된 달에 우리 회사 청구가 조용히 사라진다.
          const owner = await client.query(
            `SELECT company_id FROM billing_extra_items
              WHERE period_month = $1::date AND kind = '080_call' AND source_ref = $2`,
            [periodMonth, m.number],
          );
          const ownerId = String(owner.rows[0]?.company_id || '');
          if (ownerId && ownerId !== String(companyId)) {
            skipped.push({ company_id: companyId, company_name: companyName, number: disp, reason: '그 달 그 번호가 다른 고객사로 이미 반영돼 있습니다 — 번호 매핑을 확인해주세요' });
          } else {
            already.push(disp);
          }
          continue;
        }
        numbers += 1;
        callSupply += callFee;
      }
      await client.query('COMMIT');
      if (numbers > 0) applied.push({ company_id: companyId, company_name: companyName, numbers, call_supply: callSupply });
      for (const disp of already) {
        skipped.push({ company_id: companyId, company_name: companyName, number: disp, reason: '이미 반영된 번호 — 중복 반영 차단(반영 현황에서 취소 후 다시 반영 가능)' });
      }
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { /* release가 파기 */ }
      // ★ 2026-08-20(2) Codex 3R·4R 수용 — 스키마 부재(테이블 42P01·컬럼 42703)는 회사별 skipped로
      //   삼키지 않는다. 삼키면 "0개사 반영 완료" 성공 응답으로 위장돼 조용한 미청구가 된다. 라우트가 503으로 올린다.
      if (err?.code === '42P01' || err?.code === '42703') throw err;
      skipped.push({ company_id: companyId, company_name: companyName, reason: `반영 실패: ${String(err?.message || err).slice(0, 200)}` });
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}
