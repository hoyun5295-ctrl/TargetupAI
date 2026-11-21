/**
 * ask-segments.ts — 「한 줄로 묻기」 고객 묶음 · 대상 한 문장 · 예산 자르기 (★ 2026-11-21 C151 · 설계서 docs/2026-11-21-c151-ask-entry-design.md §2 S1)
 *
 * 칸 = 마지막 구매(한국 날짜 기준 지난 일수) 5줄 × 구매 횟수 3칸 + 「구매 기록 없음」. 칸 판정 = askCellSql 한 곳(세기 · 명단이 같은 식).
 * 대상 = §2-1 한 문장(번호 하나 = 한 사람 · 요청 순서의 앞 행이 대표) · 세기 = 그 문장의 수 · 명단 = 같은 문장 + LIMIT.
 * 수신 가능 조건 · 주인 범위 = product-signal 과 같은 CT(sendableCustomerSql · getOwnerCustomerScopeSql) · 시간 제한 = 같은 boundedRead.
 * ⛔ 모델명 · 검사 방식 낱말 0(이름 · 설명은 화면에 그대로 나간다).
 */
import { query } from '../config/database';
import { sendableCustomerSql, boundedRead, kstDayAgoSql, AUDIENCE_LIST_MAX, type AudienceList } from './product-signal';
import { getOwnerCustomerScopeSql } from './store-scope';
import { resolveChargeUnitPriceDetailed } from './unit-price';

export type AskGroupKey = 'leave' | 'rest' | 'fade' | 'next' | 'loyal' | 'new' | 'nobuy';
export type AskOrder = 'recent' | 'count';

/** 줄 = 마지막 구매(지난 일수 상한 · 마지막 줄 = 그 밖) · 칸 = 구매 횟수(상한) */
export const ASK_ROW_DAYS = [30, 90, 180, 365] as const;
export const ASK_COL_COUNTS = [1, 3] as const;
export const ASK_NOBUY = 'nobuy';

/** 묶음(목업 순서 = 화면 순서) · cells = 칸 키 'r{줄}c{칸}' */
export const ASK_GROUPS: ReadonlyArray<{ key: AskGroupKey; name: string; desc: string; purpose: string; cells: readonly string[] }> = [
  { key: 'leave', name: '떠나는 단골', desc: '네 번 이상 사고 반년 넘게 안 오신 분', purpose: '오래 안 오신 단골께 안부를 전하며 다시 찾아 주시길 권하는 문자', cells: ['r3c2', 'r4c2'] },
  { key: 'rest', name: '오래 쉰 고객', desc: '세 번까지 사고 반년 넘게 안 오신 분', purpose: '오랜만에 안부를 전하며 다시 찾아 주시길 권하는 문자', cells: ['r3c0', 'r3c1', 'r4c0', 'r4c1'] },
  { key: 'fade', name: '뜸해지는 중', desc: '마지막 구매가 3~6달 전인 분', purpose: '다시 찾아 주시길 권하는 문자', cells: ['r2c0', 'r2c1', 'r2c2'] },
  { key: 'next', name: '다음 구매 차례', desc: '한 번 사고 1~3달이 지난 분', purpose: '다음 구매를 권하는 문자', cells: ['r1c0'] },
  { key: 'loyal', name: '요즘 단골', desc: '석 달 안에 사셨고 두 번 이상 산 분', purpose: '자주 찾아 주셔서 고마운 마음을 전하는 문자', cells: ['r0c1', 'r0c2', 'r1c1', 'r1c2'] },
  { key: 'new', name: '첫 구매 직후', desc: '한 달 안에 처음 산 분', purpose: '첫 구매에 고마운 마음을 전하고 다시 찾아 주시길 권하는 문자', cells: ['r0c0'] },
  { key: 'nobuy', name: '구매 기록 없음', desc: '구매 기록이 아직 올라오지 않은 분', purpose: '첫 구매를 권하는 문자', cells: [ASK_NOBUY] },
];
const GROUP_BY_KEY = new Map(ASK_GROUPS.map((g) => [g.key, g]));
const GROUP_OF_CELL = new Map(ASK_GROUPS.flatMap((g) => g.cells.map((c) => [c, g.key] as const)));

/** 한 번에 넘기는 최대 인원 = 직접발송 명단 상한(product-signal 과 같은 값) */
export const ASK_AUDIENCE_MAX = AUDIENCE_LIST_MAX;
export const ASK_BUDGET_MIN = 1_000;
export const ASK_BUDGET_MAX = 100_000_000;

/**
 * 칸 키 SQL(한 곳) — 'nobuy' · 'r0c0' ~ 'r4c2'.
 *   지난 일수 = 한국 날짜 오늘 − 마지막 구매일(미래 날짜 = 음수 = 0줄) · 구매 횟수 NULL · 0 = 1번 이하(날짜가 있으니 한 번은 산 분).
 */
export function askCellSql(a: string): string {
  const d = `(${kstDayAgoSql('0')} - ${a}.recent_purchase_date)`;
  const row = `CASE ${ASK_ROW_DAYS.map((n, i) => `WHEN ${d} <= ${n} THEN ${i}`).join(' ')} ELSE ${ASK_ROW_DAYS.length} END`;
  const col = `CASE WHEN COALESCE(${a}.purchase_count, 0) <= ${ASK_COL_COUNTS[0]} THEN 0 WHEN ${a}.purchase_count <= ${ASK_COL_COUNTS[1]} THEN 1 ELSE 2 END`;
  return `(CASE WHEN ${a}.recent_purchase_date IS NULL THEN '${ASK_NOBUY}' ELSE 'r' || (${row})::text || 'c' || (${col})::text END)`;
}

/** 순서 칸(대표 행 고르기 · 명단 순서 · 예산 자르기가 같은 식) */
export function askOrderSql(a: string, order: AskOrder): string {
  return order === 'count'
    ? `${a}.purchase_count DESC NULLS LAST, ${a}.recent_purchase_date DESC NULLS LAST`
    : `${a}.recent_purchase_date DESC NULLS LAST`;
}

/**
 * §2-1 대상 한 문장 — 고른 칸 전체에서 번호 하나 = 한 사람(칸끼리 같은 번호 = 한 번 · 요청 순서의 앞 행이 대표).
 *   $1 회사 · $2 칸 키들. 세기 · 명단 · 예산 자르기가 이 CTE 하나를 쓴다.
 */
export function askAudienceSql(sendable: string, order: AskOrder): string {
  return `WITH picked AS (
      SELECT DISTINCT ON (TRIM(c.phone)) c.id, TRIM(c.phone) AS phone, c.name, c.recent_purchase_date, c.purchase_count, ${askCellSql('c')} AS cell
        FROM customers c
       WHERE c.company_id = $1::uuid AND ${sendable} AND NULLIF(TRIM(c.phone), '') IS NOT NULL AND ${askCellSql('c')} = ANY($2::text[])
       ORDER BY TRIM(c.phone), ${askOrderSql('c', order)}, c.id
    )`;
}

// ── 입력 ──

export interface AskPlanInput { groups: AskGroupKey[]; mode: 'all' | 'budget'; budget: number | null; order: AskOrder }

/** 입력 검사 한 곳 — 아는 묶음만 · 1개 이상 · 예산 = 1,000 ~ 1억 원 정수 · 틀리면 null */
export function readAskPlan(raw: unknown): AskPlanInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.groups) || r.groups.length === 0 || r.groups.length > ASK_GROUPS.length) return null;
  if (!r.groups.every((g) => typeof g === 'string' && GROUP_BY_KEY.has(g as AskGroupKey))) return null;
  const picked = new Set(r.groups as AskGroupKey[]);
  const groups = ASK_GROUPS.filter((g) => picked.has(g.key)).map((g) => g.key);   // 정렬 = 묶음 표 순서(같은 고르기 = 같은 값)
  const mode = r.mode === 'budget' ? 'budget' : r.mode === 'all' ? 'all' : null;
  if (!mode) return null;
  const order: AskOrder | null = r.order === undefined || r.order === 'recent' ? 'recent' : r.order === 'count' ? 'count' : null;
  if (!order) return null;
  if (mode === 'all') return { groups, mode, budget: null, order };
  const b = r.budget;
  if (typeof b !== 'number' || !Number.isInteger(b) || b < ASK_BUDGET_MIN || b > ASK_BUDGET_MAX) return null;
  return { groups, mode, budget: b, order };
}

/** 고른 묶음 → 칸 키들 */
export function askCellsOf(groups: readonly AskGroupKey[]): string[] {
  return groups.flatMap((k) => [...(GROUP_BY_KEY.get(k)?.cells || [])]);
}

/** 문안 대상 글(묶음 이름 · 설명) */
export function askAudienceText(groups: readonly AskGroupKey[]): string {
  return groups.map((k) => GROUP_BY_KEY.get(k)!).map((g) => `${g.name}(${g.desc})`).join(' · ');
}

/** 한 줄이 없을 때 근거 글 = 묶음 문장(혜택 · 금액 없음) */
export function askGroupLine(groups: readonly AskGroupKey[]): string {
  const gs = groups.map((k) => GROUP_BY_KEY.get(k)!);
  if (gs.length === 1) return `${gs[0].name} 고객에게 보내는 ${gs[0].purpose}`;
  return `${gs.map((g) => g.name).join(' · ')} 고객에게 보내는 안부와 다시 찾아 주시길 권하는 문자`;
}

const ASK_RETRY_CONTEXT = '[다시 쓰기]\n앞 문안이 통신사 스팸 검사에서 막혔다. 같은 사실로 광고 냄새가 강한 표현(과장 · 강한 권유 · 특수문자 남용)을 줄여 다시 쓴다.';

/**
 * (순수) 혜택 세 갈래 → 근거 글(한 갈래만) · 혜택 · 참고 글(설계서 §2 S3).
 *   line = 근거 = 사람의 한 줄(없으면 묶음 문장) · custom = 근거 = 묶음 문장 + 혜택 칸 · none = 근거 = 묶음 문장 · 혜택 없음.
 *   custom · none 에서 사람의 한 줄은 참고 글로만(그 속 혜택이 근거가 되지 않는다 · R33) · 다시 고침 = 참고 글 한 줄.
 */
export function askComposeLicense(line: string | null, plan: AskPlanInput, mode: 'line' | 'custom' | 'none', benefit: string | null, retry: boolean): {
  licenseLine: string; benefit: string | null; extraContext: string | undefined;
} {
  const refs: string[] = [];
  if (mode !== 'line' && line) {
    refs.push(`[담당자가 적은 한 줄 · 참고만]\n${line}\n${mode === 'custom' ? '혜택은 [혜택] 칸에 적힌 것만 쓴다. 이 한 줄 속 혜택 · 금액 · 기간은 쓰지 않는다.' : '혜택 · 할인 · 쿠폰 · 금액은 쓰지 않는다.'}`);
  }
  if (retry) refs.push(ASK_RETRY_CONTEXT);
  return {
    licenseLine: mode === 'line' && line ? line : askGroupLine(plan.groups),
    benefit: mode === 'custom' ? benefit : null,
    extraContext: refs.length > 0 ? refs.join('\n\n') : undefined,
  };
}

// ── 단가 · 예산(순수) ──

export interface AskPrice { lms: number; unset: boolean }

/** 회사 장문 단가(부가세 포함 · 차감과 같은 CT) · 미설정 = 예산 잠김 */
export async function readAskPrice(companyId: string): Promise<AskPrice> {
  const r = await query('SELECT cost_per_lms, unit_price_basis FROM companies WHERE id = $1', [companyId]);
  const p = resolveChargeUnitPriceDetailed(r.rows[0] || null, 'LMS');
  return { lms: p.price, unset: p.unset || !r.rows[0] };
}

const cents = (won: number): number => Math.round(won * 100);

/** 명단 상한(번호 수와 무관 · 예산 인원과 5만 중 작은 쪽) · 예산인데 단가 미설정 = null */
export function askLimit(price: AskPrice, plan: AskPlanInput): number | null {
  if (plan.mode === 'all') return ASK_AUDIENCE_MAX;
  if (price.unset) return null;
  const unit = cents(price.lms);
  if (unit <= 0) return ASK_AUDIENCE_MAX;   // 0원 계약 = 예산이 인원을 줄이지 않는다
  return Math.min(Math.floor(cents(plan.budget || 0) / unit), ASK_AUDIENCE_MAX);
}

/**
 * (순수) 보낼 인원 planned = min(보낼 수 있는 번호 수, 예산 인원(모두면 무한), 5만) · 금액 = planned × 장문 단가.
 *   capped = 5만에 걸림 · 예산인데 단가 미설정 = null. 세기 · 명단 주소가 이 함수 하나로 planned 를 정한다.
 */
export function askPlan(sendable: number, price: AskPrice, plan: AskPlanInput): { planned: number; amount: number; capped: boolean; want: number } | null {
  const limit = askLimit(price, plan);
  if (limit === null) return null;
  const n = Math.max(0, Math.floor(sendable));
  const planned = Math.min(n, limit);
  const unit = cents(price.lms);
  // want = 5만에 자르기 전 인원(모두 = 번호 수 · 예산 = 번호 수와 예산 인원 중 작은 쪽)
  const want = plan.mode === 'all' || unit <= 0 ? n : Math.min(n, Math.floor(cents(plan.budget || 0) / unit));
  return { planned, amount: Math.round((planned * unit) / 100), capped: want > ASK_AUDIENCE_MAX, want };
}

// ── 세기 · 명단 ──

/** spendSum · spendN = 그 칸의 보낼 수 있는 고객 가운데 누적 구매액이 있는(0보다 큰) 고객의 합 · 수(★ C152 C · 화면이 묶음으로 합쳐 「1인 평균 구매」) */
export interface AskCellNumbers { total: number; sendable: number; spendSum: number; spendN: number }
export interface AskCell extends AskCellNumbers { key: string; row: number; col: number; group: AskGroupKey }
const NO_NUMBERS: AskCellNumbers = { total: 0, sendable: 0, spendSum: 0, spendN: 0 };
/** 평균 구매액을 보이는 최소 고객 수(그보다 적으면 한두 사람의 구매액이 드러난다) */
export const ASK_SPEND_MIN_N = 5;
/** (순수) 칸들의 1인 평균 구매액(원 · 반올림) — 구매액이 있는 고객이 ASK_SPEND_MIN_N 명 미만이면 null */
export function askSpendAvg(cells: ReadonlyArray<Pick<AskCellNumbers, 'spendSum' | 'spendN'>>): number | null {
  const n = cells.reduce((a, c) => a + c.spendN, 0);
  return n >= ASK_SPEND_MIN_N ? Math.round(cells.reduce((a, c) => a + c.spendSum, 0) / n) : null;
}

/** 칸마다 고른 범위 안 활성 고객 수 · 그중 보낼 수 있는 번호 수(안내용 · 칸 안에서 번호 하나 = 한 번) — 한 문장 */
export async function countAskCells(companyId: string, viewerUserId: string | null | undefined): Promise<{ cells: AskCell[]; nobuy: AskCellNumbers }> {
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  const scope = await getOwnerCustomerScopeSql(companyId, viewerUserId, 'c');
  const rows = await boundedRead(
    `SELECT x.cell, COUNT(*)::int AS total, COUNT(DISTINCT x.sphone)::int AS sendable,
            COALESCE(SUM(x.spend), 0)::float8 AS spend_sum, COUNT(x.spend)::int AS spend_n
       FROM (SELECT ${askCellSql('c')} AS cell, CASE WHEN ${sendable} THEN NULLIF(TRIM(c.phone), '') END AS sphone,
                    CASE WHEN ${sendable} AND c.total_purchase_amount > 0 THEN c.total_purchase_amount END AS spend
               FROM customers c
              WHERE c.company_id = $1::uuid AND c.is_active = true${scope}) x
      GROUP BY x.cell`,
    [companyId],
  );
  const by = new Map<string, AskCellNumbers>(rows.map((x: any) => [String(x.cell), {
    total: Number(x.total) || 0, sendable: Number(x.sendable) || 0, spendSum: Number(x.spend_sum) || 0, spendN: Number(x.spend_n) || 0,
  }]));
  const cells: AskCell[] = [];
  for (let row = 0; row <= ASK_ROW_DAYS.length; row++) {
    for (let col = 0; col <= ASK_COL_COUNTS.length; col++) {
      const key = `r${row}c${col}`;
      cells.push({ key, row, col, group: GROUP_OF_CELL.get(key)!, ...(by.get(key) || NO_NUMBERS) });
    }
  }
  return { cells, nobuy: by.get(ASK_NOBUY) || NO_NUMBERS };
}

export interface AskCount {
  /** 고른 칸 안 활성 고객 수(빼는 고객 한 줄용) */
  inScope: number;
  /** 보낼 수 있는 번호 수(§2-1 세기) */
  sendable: number;
  planned: number;
  amount: number;
  capped: boolean;
  /** 칸마다 대상 수 · 그중 이번에 들어가는 수(요청 순서 앞에서부터 planned 명) */
  cells: Array<{ key: string; n: number; taken: number }>;
}

/** §2-1 세기(2단계) · 예산인데 단가 미설정 = null */
export async function countAskPlan(companyId: string, viewerUserId: string | null | undefined, plan: AskPlanInput, price: AskPrice): Promise<AskCount | null> {
  const limit = askLimit(price, plan);
  if (limit === null) return null;
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  const scope = await getOwnerCustomerScopeSql(companyId, viewerUserId, 'c');
  const [r] = await boundedRead(
    `${askAudienceSql(sendable, plan.order)},
     ranked AS (SELECT p.cell, ROW_NUMBER() OVER (ORDER BY ${askOrderSql('p', plan.order)}, p.id) AS rn FROM picked p)
     SELECT (SELECT COUNT(*)::int FROM customers c WHERE c.company_id = $1::uuid AND c.is_active = true${scope} AND ${askCellSql('c')} = ANY($2::text[])) AS in_scope,
            COALESCE((SELECT json_agg(json_build_object('key', g.cell, 'n', g.n, 'taken', g.taken))
                        FROM (SELECT cell, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE rn <= $3::int)::int AS taken FROM ranked GROUP BY cell) g), '[]'::json) AS cells`,
    [companyId, askCellsOf(plan.groups), limit],
  );
  const cells = (Array.isArray(r?.cells) ? r.cells : []).map((x: any) => ({ key: String(x.key), n: Number(x.n) || 0, taken: Number(x.taken) || 0 }));
  const total = cells.reduce((s: number, x: { n: number }) => s + x.n, 0);
  const { planned, amount, capped } = askPlan(total, price, plan)!;
  return { inScope: Number(r?.in_scope) || 0, sendable: total, planned, amount, capped, cells };
}

/** §2-1 명단(지금 다시 셈 · 같은 문장 + LIMIT) · total = 5만을 자르기 전 인원 · 예산인데 단가 미설정 = null */
export async function listAskAudience(companyId: string, viewerUserId: string | null | undefined, plan: AskPlanInput, price: AskPrice): Promise<AudienceList | null> {
  const limit = askLimit(price, plan);
  if (limit === null) return null;
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  const rows = await boundedRead(
    `${askAudienceSql(sendable, plan.order)}
     SELECT p.phone, p.name, COUNT(*) OVER ()::int AS sendable FROM picked p ORDER BY ${askOrderSql('p', plan.order)}, p.id LIMIT $3::int`,
    [companyId, askCellsOf(plan.groups), limit],
  );
  const recipients = rows.map((x: any) => ({ phone: String(x.phone), name: String(x.name || '') }));
  const p = askPlan(Number(rows[0]?.sendable) || 0, price, plan)!;
  return { recipients, total: p.want, truncated: p.capped };
}

// ── 한 줄 읽기(순수 · AI 0) ──

const BENEFIT_WORDS = /%|쿠폰|할인|무료|증정|적립/;

/** 금액 글 → 원(「5만 원」 · 「30,000원」) */
function wonOf(num: string, man: boolean): number {
  const n = Number(num.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(man ? n * 10_000 : n) : NaN;
}

/**
 * ★ 2026-11-21 C152 B — (순수) 한 줄이 질문인가 보내기인가(설계서 docs/2026-11-21-c152-snap-gap-upgrade-design.md §2-B-1).
 *   ask = 물음 꼴(줄 끝 물음표 · 물음 낱말)이고 보내기 낱말이 없다 · 그 밖 = send(지금 흐름 그대로).
 *   틀리게 읽어도 길은 열려 있다: ask = 화면 확인 줄의 두 단추 · send = 처음 화면 상시 단추 「질문으로 물어보기」.
 */
export type AskIntent = 'ask' | 'send';
const ASK_QUESTION_WORDS = /[?？]\s*$|왜|얼마|몇\s*명|몇\s*건|어때|어떤|어느|알려|궁금|분석|비교|추이|현황/;
const ASK_SEND_WORDS = /보내|발송|문자|쿠폰|안내해|알림|홍보|메시지/;
export function askIntentOf(line: unknown): AskIntent {
  const t = typeof line === 'string' ? line.slice(0, 2000).trim() : '';
  return ASK_QUESTION_WORDS.test(t) && !ASK_SEND_WORDS.test(t) ? 'ask' : 'send';
}

/**
 * (순수) 한 줄 → 미리 고를 묶음 · 예산 · 혜택 낱말 유무. 못 읽으면 묶음 = 떠나는 단골(먼저 챙길 분).
 *   예산 = 「예산 N원」 또는 「N원으로 · 안에서 · 어치 · 까지 · 이내」만(「5천원 쿠폰」 같은 혜택 금액은 예산이 아니다).
 */
export function readAskLine(line: unknown): { groups: AskGroupKey[]; budget: number | null; hasBenefit: boolean; intent: AskIntent } {
  const t = typeof line === 'string' ? line.slice(0, 2000) : '';
  const found = new Set<AskGroupKey>();
  const lapsed = /오래|안\s*온|안\s*오|쉰|발길|떠나|이탈/.test(t);
  if (/구매\s*기록\s*없|안\s*산\s*적|가입만/.test(t)) found.add('nobuy');
  if (/떠나|이탈|발길/.test(t) || (lapsed && /단골/.test(t))) found.add('leave');
  else if (lapsed) found.add('rest');
  if (/뜸/.test(t)) found.add('fade');
  if (/첫\s*구매/.test(t)) found.add('new');
  if (/다음\s*구매/.test(t)) found.add('next');
  if (/단골/.test(t) && !lapsed) found.add('loyal');
  const groups = ASK_GROUPS.filter((g) => found.has(g.key)).map((g) => g.key);

  const AMT = '(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(만)?\\s*원';
  const m = t.match(new RegExp(`예산[^0-9]{0,6}${AMT}`)) || t.match(new RegExp(`${AMT}\\s*(?:으로|안에서|안|어치|까지|이내|내에서)`));
  const won = m ? wonOf(m[1], !!m[2]) : NaN;
  const budget = Number.isInteger(won) && won >= ASK_BUDGET_MIN && won <= ASK_BUDGET_MAX ? won : null;
  return { groups: groups.length > 0 ? groups : ['leave'], budget, hasBenefit: BENEFIT_WORDS.test(t), intent: askIntentOf(t) };
}

/** 화면에 내려 주는 묶음 표(이름 · 설명 = 서버 한 곳) */
export function askGroupMeta(): Array<{ key: AskGroupKey; name: string; desc: string; cells: string[] }> {
  return ASK_GROUPS.map((g) => ({ key: g.key, name: g.name, desc: g.desc, cells: [...g.cells] }));
}
