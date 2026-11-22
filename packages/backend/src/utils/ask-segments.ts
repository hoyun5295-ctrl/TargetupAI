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
/** ★ 2026-11-22 C157 — 한 줄로 묻기에서 고르는 문자 종류(없으면 LMS = 옛 요청 그대로) */
export type AskChannel = 'SMS' | 'LMS' | 'MMS';
export const ASK_CHANNELS: readonly AskChannel[] = ['SMS', 'LMS', 'MMS'];

/** 줄 = 마지막 구매(지난 일수 상한 · 마지막 줄 = 그 밖) · 칸 = 구매 횟수(상한) */
export const ASK_ROW_DAYS = [30, 90, 180, 365] as const;
export const ASK_COL_COUNTS = [1, 3] as const;
export const ASK_NOBUY = 'nobuy';

/** 묶음(목업 순서 = 화면 순서) · cells = 칸 키 'r{줄}c{칸}' */
export const ASK_GROUPS: ReadonlyArray<{ key: AskGroupKey; name: string; desc: string; cells: readonly string[] }> = [
  { key: 'leave', name: '떠나는 단골', desc: '네 번 이상 사고 반년 넘게 안 오신 분', cells: ['r3c2', 'r4c2'] },
  { key: 'rest', name: '오래 쉰 고객', desc: '세 번까지 사고 반년 넘게 안 오신 분', cells: ['r3c0', 'r3c1', 'r4c0', 'r4c1'] },
  { key: 'fade', name: '뜸해지는 중', desc: '마지막 구매가 3~6달 전인 분', cells: ['r2c0', 'r2c1', 'r2c2'] },
  { key: 'next', name: '다음 구매 차례', desc: '한 번 사고 1~3달이 지난 분', cells: ['r1c0'] },
  { key: 'loyal', name: '요즘 단골', desc: '석 달 안에 사셨고 두 번 이상 산 분', cells: ['r0c1', 'r0c2', 'r1c1', 'r1c2'] },
  { key: 'new', name: '첫 구매 직후', desc: '한 달 안에 처음 산 분', cells: ['r0c0'] },
  { key: 'nobuy', name: '구매 기록 없음', desc: '구매 기록이 아직 올라오지 않은 분', cells: [ASK_NOBUY] },
];
const GROUP_BY_KEY = new Map(ASK_GROUPS.map((g) => [g.key, g]));
const GROUP_OF_CELL = new Map(ASK_GROUPS.flatMap((g) => g.cells.map((c) => [c, g.key] as const)));
/** 칸 키 → 묶음(표에 없는 칸 = null) — ★ 2026-11-22 C154 굴린 칸 합계를 묶음으로 접을 때 같은 표를 쓴다 */
export const askGroupOfCell = (cell: string): AskGroupKey | null => GROUP_OF_CELL.get(cell) ?? null;

/** 한 번에 넘기는 최대 인원 = 직접발송 명단 상한(product-signal 과 같은 값) */
export const ASK_AUDIENCE_MAX = AUDIENCE_LIST_MAX;
export const ASK_BUDGET_MIN = 1_000;
export const ASK_BUDGET_MAX = 100_000_000;

/**
 * 칸 키 SQL(한 곳) — 'nobuy' · 'r0c0' ~ 'r4c2'.
 *   지난 일수 = 한국 날짜 오늘 − 마지막 구매일(미래 날짜 = 음수 = 0줄) · 구매 횟수 NULL · 0 = 1번 이하(날짜가 있으니 한 번은 산 분).
 */
export function askCellSql(a: string): string {
  return askCellOfSql(kstDayAgoSql('0'), `${a}.recent_purchase_date`, `${a}.purchase_count`);
}

/**
 * 칸 식의 몸통(한 곳) — 기준 날짜 · 마지막 구매일 · 구매 횟수를 식으로 받는다.
 *   ★ 2026-11-22 C154 — 발송 원장 굴리기가 「발송 시점의 칸」을 되짚을 때 같은 식을 발송 날짜 · 그때의 구매일 · 횟수로 부른다
 *   (설계서 docs/2026-11-22-c154-send-ledger-rollup-design.md S4 · 칸 판정이 둘이 되지 않게). 지금 쓰임 = askCellSql(오늘 · 요약 칸).
 */
export function askCellOfSql(dayExpr: string, recentExpr: string, countExpr: string): string {
  const d = `(${dayExpr} - ${recentExpr})`;
  const row = `CASE ${ASK_ROW_DAYS.map((n, i) => `WHEN ${d} <= ${n} THEN ${i}`).join(' ')} ELSE ${ASK_ROW_DAYS.length} END`;
  const col = `CASE WHEN COALESCE(${countExpr}, 0) <= ${ASK_COL_COUNTS[0]} THEN 0 WHEN ${countExpr} <= ${ASK_COL_COUNTS[1]} THEN 1 ELSE 2 END`;
  return `(CASE WHEN ${recentExpr} IS NULL THEN '${ASK_NOBUY}' ELSE 'r' || (${row})::text || 'c' || (${col})::text END)`;
}

/** 순서 칸(대표 행 고르기 · 명단 순서 · 예산 자르기가 같은 식) */
export function askOrderSql(a: string, order: AskOrder): string {
  return order === 'count'
    ? `${a}.purchase_count DESC NULLS LAST, ${a}.recent_purchase_date DESC NULLS LAST`
    : `${a}.recent_purchase_date DESC NULLS LAST`;
}

/** ★ 2026-11-22 C157 — (SQL) 고객의 번호를 숫자만 남긴 값(발송 적재 · 일꾼의 고객 찾기가 쓰는 꼴 · 적재 표 칸 폭 20) */
export const askPhoneSql = (a: string): string => `regexp_replace(COALESCE(${a}.phone, ''), '[^0-9]', '', 'g')`;

/** (SQL) 대상 조건 — $1 회사 · $2 칸 키들 · 별칭 c. 보낼 수 있는 고객 · 숫자가 든 번호(1 ~ 20자) · 고른 칸 */
export function askAudienceWhere(sendable: string): string {
  return `c.company_id = $1::uuid AND ${sendable} AND length(${askPhoneSql('c')}) BETWEEN 1 AND 20 AND ${askCellSql('c')} = ANY($2::text[])`;
}

/**
 * §2-1 대상 한 문장 — 고른 칸 전체에서 번호 하나 = 한 사람(칸끼리 같은 번호 = 한 번).
 *   $1 회사 · $2 칸 키들. 세기 · 적재 · 표본 · 옛 명단 · 예산 자르기가 이 CTE 하나를 쓴다.
 *   ★ 2026-11-22 C157 D11 — 번호 = **숫자만 남긴 값**(옛: TRIM = 꼴만 다른 같은 번호를 두 명으로 세고 적재 뒤 한 명이 됐다) ·
 *     같은 번호의 행이 여럿이면 대표 = 저장된 번호가 숫자 꼴인 행 먼저(발송 일꾼이 `phone = 번호` 로 칼럼 값을 찾는 바로 그 행) → 요청 순서 → id.
 *   칸: plain = 저장된 번호가 숫자 꼴인가(아니면 일꾼이 그 고객의 칼럼 값을 찾지 못한다) · store_phone = 그 고객의 매장 번호(개별 회신).
 */
export function askAudienceSql(sendable: string, order: AskOrder): string {
  const phone = askPhoneSql('c');
  return `WITH picked AS (
      SELECT DISTINCT ON (${phone}) c.id, ${phone} AS phone, c.name, c.recent_purchase_date, c.purchase_count, ${askCellSql('c')} AS cell,
             (c.phone = ${phone}) AS plain, NULLIF(btrim(COALESCE(c.store_phone, '')), '') AS store_phone
        FROM customers c
       WHERE ${askAudienceWhere(sendable)}
       ORDER BY ${phone}, (c.phone = ${phone}) DESC, ${askOrderSql('c', order)}, c.id
    )`;
}

// ── 입력 ──

/** channel = 사람이 고른 문자 종류 — LMS(기본)이면 칸을 두지 않는다(옛 요청과 같은 값 = 문안 과금 키가 그대로) */
export interface AskPlanInput { groups: AskGroupKey[]; mode: 'all' | 'budget'; budget: number | null; order: AskOrder; channel?: AskChannel }
/** 그 계획의 문자 종류(없으면 LMS) */
export const askChannelOf = (plan: Pick<AskPlanInput, 'channel'>): AskChannel => plan.channel ?? 'LMS';

/** 입력 검사 한 곳 — 아는 묶음만 · 1개 이상 · 예산 = 1,000 ~ 1억 원 정수 · 문자 종류 = 셋 가운데 하나(없으면 LMS) · 틀리면 null */
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
  if (r.channel !== undefined && !(ASK_CHANNELS as readonly unknown[]).includes(r.channel)) return null;
  const ch = r.channel !== undefined && r.channel !== 'LMS' ? { channel: r.channel as AskChannel } : {};
  if (mode === 'all') return { groups, mode, budget: null, order, ...ch };
  const b = r.budget;
  if (typeof b !== 'number' || !Number.isInteger(b) || b < ASK_BUDGET_MIN || b > ASK_BUDGET_MAX) return null;
  return { groups, mode, budget: b, order, ...ch };
}

/** 고른 묶음 → 칸 키들 */
export function askCellsOf(groups: readonly AskGroupKey[]): string[] {
  return groups.flatMap((k) => [...(GROUP_BY_KEY.get(k)?.cells || [])]);
}

/** 문안 대상 글(묶음 이름 · 설명) */
export function askAudienceText(groups: readonly AskGroupKey[]): string {
  return groups.map((k) => GROUP_BY_KEY.get(k)!).map((g) => `${g.name}(${g.desc})`).join(' · ');
}

const ASK_RETRY_CONTEXT = '[다시 쓰기]\n앞 문안이 통신사 스팸 검사에서 막혔다. 같은 사실로 광고 냄새가 강한 표현(과장 · 강한 권유 · 특수문자 남용)을 줄여 다시 쓴다.';

// ── ★ 2026-11-22 C153 내용은 사람이 정한다(설계서 docs/2026-11-22-c153-ask-step3-redesign-design.md §2 S1 · S2) ──

/** 오실 곳 — 사람이 고른 사실(none = 적지 않음 = 문안이 매장 · 온라인 어느 쪽도 말하지 않는다) */
export type AskPlace = 'none' | 'store' | 'online';
/** 오실 곳 답의 질문 글(서버 상수 · 목소리 꼴 칸 질문 글 · 링크 질문 글과 다른 글이어야 그 밖 답 = 「확인한 사실」로 간다) */
export const ASK_PLACE_Q = '고객이 오실 곳';
export const ASK_PLACE_ANSWER: Readonly<Record<Exclude<AskPlace, 'none'>, string>> = { store: '매장 방문', online: '온라인몰' };
/** 입력 검사 — 없음 = 적지 않음 · 모르는 값 = null */
export function readAskPlace(raw: unknown): AskPlace | null {
  if (raw === undefined || raw === null || raw === 'none') return 'none';
  return raw === 'store' || raw === 'online' ? raw : null;
}

/**
 * 쓰는 범위(언제나 붙는 참고 블록) — 사람이 주지 않은 내용을 보태지 않게 한다.
 *   Harold 1122 「저런 이벤트는 누가 말해서 하는거냐」 · 「매장인지 온라인인지 체크도 안하고」.
 */
export const ASK_SCOPE_RULE = '[쓰는 범위]\n위 근거 글과 확인한 사실에 있는 내용만 쓴다. 근거에 없는 신제품 · 행사 · 체험 · 상담 · 사은품 · 매장 방문 · 온라인몰 · 기간 · 수량을 지어내지 않는다. 오실 곳이 확인한 사실에 없으면 매장 · 온라인 어느 쪽도 쓰지 않는다. 쓸 내용이 적으면 짧게 쓴다(길이를 채우려고 내용을 보태지 않는다).';

/**
 * (순수) 목적 글 · 혜택 근거 · 혜택 · 참고 글 — 목적 글(무엇을 쓸지) = **사람이 적은 한 줄 전체**(세 갈래 모두 · 묶음마다 정해 둔 문장을 쓰지 않는다).
 *   혜택 근거(출구 검사 · 강조 지시가 보는 글 · benefitGround): line = 따로 두지 않는다(undefined = 한 줄 전체 · 한 줄 속 혜택 = 사람이 적은 혜택) ·
 *     custom = 혜택 칸 글만 · none = 빈 글(허가된 혜택 0) → 한 줄에 무엇이 적혀 있든 그 갈래에서는 혜택 근거가 아니다
 *     (한 줄에서 혜택 자리를 지우는 방식은 탐지가 놓치는 꼴 · 지나치게 지우는 꼴이 남아 버렸다 = Codex 설계 1R · 2R · 3R 같은 뿌리).
 *     생성기가 한 줄의 혜택을 되살려 쓰면 출구가 자리표로 바꾼다 → custom = 혜택 칸 글이 그 자리에 · none = 자리표가 남아 발송 길목이 막는다.
 *   날짜 · 사실의 근거는 언제나 사람이 적은 글 전부다(생성기 factText · runLineCompose 가 넘긴다).
 *   쓰는 범위(ASK_SCOPE_RULE)는 언제나 붙는다 · 다시 고침 = 참고 글 한 줄.
 */
export function askComposeLicense(line: string, mode: 'line' | 'custom' | 'none', benefit: string | null, retry: boolean): {
  licenseLine: string; benefitGround: string | undefined; benefit: string | null; extraContext: string;
} {
  const refs: string[] = [ASK_SCOPE_RULE];
  if (mode === 'custom') refs.push('[혜택]\n혜택은 [혜택] 칸에 적힌 것만 쓴다. 한 줄 속 다른 혜택 · 금액 · 기간은 쓰지 않는다.');
  if (mode === 'none') refs.push('[혜택]\n혜택 · 할인 · 쿠폰 · 금액은 쓰지 않는다.');
  if (retry) refs.push(ASK_RETRY_CONTEXT);
  const custom = mode === 'custom' ? benefit : null;
  return {
    licenseLine: line,
    benefitGround: mode === 'line' ? undefined : custom ? `[혜택] ${custom.trim()}` : '',
    benefit: custom,
    extraContext: refs.join('\n\n'),
  };
}

/** 안전망 낱말 — 사람이 주지 않았는데 문안에 자주 끼어드는 사실(막지 않는다 · 화면이 알린다) */
export const ASK_UNGROUNDED_WATCH = ['매장', '방문', '신제품', '신상', '체험', '상담', '이벤트', '행사', '사은품', '증정', '온라인몰', '홈페이지', '앱'] as const;
/** (순수) 문안에는 있고 근거(한 줄 · 혜택 · 오실 곳 답 · 링크)에는 없는 안전망 낱말 */
export function askUngroundedWords(text: string, ground: string): string[] {
  const t = String(text || '');
  const g = String(ground || '');
  return ASK_UNGROUNDED_WATCH.filter((w) => t.includes(w) && !g.includes(w));
}

// ── 단가 · 예산(순수) ──

/**
 * 1통 값 — `lms` 칸 = **그 계획의 문자 종류** 1통 값(칸 이름은 옛 화면 · 옛 응답과 같은 꼴을 지키려고 그대로 둔다 · 종류를 안 넘기면 LMS).
 */
export interface AskPrice { lms: number; unset: boolean }

/** 회사의 그 종류 단가(부가세 포함 · 차감과 같은 CT) · 미설정 = 예산 잠김 */
export async function readAskPrice(companyId: string, channel: AskChannel = 'LMS'): Promise<AskPrice> {
  return (await readAskPrices(companyId))[channel];
}

/** ★ 2026-11-22 C157 — 문자 종류 셋의 단가를 한 번에(2단계의 종류 칩 · 차감과 같은 CT resolveChargeUnitPriceDetailed) */
export async function readAskPrices(companyId: string): Promise<Record<AskChannel, AskPrice>> {
  const r = await query('SELECT cost_per_sms, cost_per_lms, cost_per_mms, unit_price_basis FROM companies WHERE id = $1', [companyId]);
  const row = r.rows[0] || null;
  const of = (channel: AskChannel): AskPrice => {
    const p = resolveChargeUnitPriceDetailed(row, channel);
    return { lms: p.price, unset: p.unset || !row };
  };
  return { SMS: of('SMS'), LMS: of('LMS'), MMS: of('MMS') };
}

/** (순수) n명에게 보내는 금액(원) — askPlan 과 같은 셈(전 단위로 곱해 반올림) */
export function askAmount(n: number, price: AskPrice): number {
  return Math.round((Math.max(0, Math.floor(n)) * Math.round(price.lms * 100)) / 100);
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
       FROM (SELECT ${askCellSql('c')} AS cell, CASE WHEN ${sendable} AND length(${askPhoneSql('c')}) BETWEEN 1 AND 20 THEN ${askPhoneSql('c')} END AS sphone,
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

/**
 * ★ 2026-11-22 C157 — 받는 분을 서버가 적재한다(화면은 명단을 받지 않는다 · 설계서 docs/2026-11-22-c157-ask-send-options-design.md §2 S2).
 *   세기(countAskPlan)와 같은 대상 문장 · 같은 순서 · 같은 상한. 적재 줄 = 번호(숫자만) · 이름(· 개별 회신이면 그 고객의 매장 번호).
 *   plainOnly = 고객 원장을 찾아야 채워지는 변수가 든 문안 — 대표 행의 저장 번호가 숫자 꼴이 아닌 고객(일꾼이 칼럼 값을 찾지 못한다)을 빼고
 *     남은 사람으로 상한을 채운다 · unfillable = 그래서 빠진 사람 수(빼지 않았다면 이번에 들어갔을 사람 가운데).
 *   $1 회사 · $2 칸 키들 · $3 상한 · $4 적재 id. 예산인데 단가 미설정 = null.
 */
export function askStagingInsertSql(sendable: string, order: AskOrder, opts: { callback: boolean; plainOnly: boolean }): string {
  const keep = opts.plainOnly ? 'p.plain' : 'true';
  const by = `${askOrderSql('p', order)}, p.id`;
  return `${askAudienceSql(sendable, order)},
    ranked AS (
      SELECT p.phone, p.name, p.store_phone, (${keep}) AS keep,
             ROW_NUMBER() OVER (ORDER BY ${by}) AS rn_all,
             SUM(CASE WHEN ${keep} THEN 1 ELSE 0 END) OVER (ORDER BY ${by} ROWS UNBOUNDED PRECEDING) AS rn_keep
        FROM picked p
    ),
    ins AS (
      INSERT INTO campaign_send_staging (staging_id, company_id, phone, name${opts.callback ? ', callback' : ''})
      SELECT $4::uuid, $1::uuid, r.phone, r.name${opts.callback ? ', r.store_phone' : ''}
        FROM ranked r WHERE r.keep AND r.rn_keep <= $3::int
       ORDER BY r.rn_all
      RETURNING 1
    )
    SELECT (SELECT COUNT(*)::int FROM ins) AS staged,
           (SELECT COUNT(*)::int FROM ranked r WHERE NOT r.keep AND r.rn_all <= $3::int) AS unfillable`;
}

export async function stageAskAudience(
  companyId: string, viewerUserId: string | null | undefined, plan: AskPlanInput, price: AskPrice,
  opts: { stagingId: string; individualCallback: boolean; plainOnly: boolean },
): Promise<{ staged: number; unfillable: number } | null> {
  const limit = askLimit(price, plan);
  if (limit === null) return null;
  if (limit <= 0) return { staged: 0, unfillable: 0 };
  const sendable = await sendableCustomerSql(companyId, viewerUserId);
  const [r] = await boundedRead(
    askStagingInsertSql(sendable, plan.order, { callback: opts.individualCallback, plainOnly: opts.plainOnly }),
    [companyId, askCellsOf(plan.groups), limit, opts.stagingId],
  );
  return { staged: Number(r?.staged) || 0, unfillable: Number(r?.unfillable) || 0 };
}

/** 적재 줄 지우기(0명 · 마감 실패 뒤 정리 · 그 회사의 그 묶음만) */
export async function dropAskStaging(companyId: string, stagingId: string): Promise<void> {
  await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1::uuid AND company_id = $2::uuid`, [stagingId, companyId]);
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

/**
 * ★ C153 — 그 준비분의 접수 상태(확정 응답을 못 받은 화면의 「다시 확인」 · 읽기만 · 회사 범위 · 적재 행이 지워진 뒤에도 답한다).
 *   accepted = 차감을 마치고 발송 가능 상태로 넘어간 캠페인이 있다(send_phase queued · processing · sent = direct-send-core 가 「전환이 실제로 됐다」로 보는 값) ·
 *   pending = 캠페인은 생겼는데 아직 차감 · 전환 전(preparing · 그 뒤 차감 실패로 지워지거나 failed 가 될 수 있다 = 접수됐다고 말하면 안 된다 · Codex 설계 3R) ·
 *   none = 없다(또는 failed 뿐) · 꼴이 틀리면 null.
 *   stuck = pending 이 ASK_PENDING_STUCK_SEC 넘게 풀리지 않는다(차감은 됐는데 전환 · 되돌리기가 모두 실패해 preparing 으로 남은 드문 경우 ·
 *     direct-send-core 가 그때 운영 경보 `direct-deduct-orphan` 을 낸다). 시간이 지났다고 none 으로 바꾸지 않는다(새로 보내게 두지 않는다 · Codex 설계 4R) —
 *     화면이 「오래 끝나지 않는다 · 확인 번호」를 알릴 뿐이다.
 */
export type AskSentState = 'accepted' | 'pending' | 'none';
export const ASK_PENDING_STUCK_SEC = 300;
export async function askStagingState(companyId: string, stagingId: unknown): Promise<{ state: AskSentState; stuck: boolean } | null> {
  if (typeof stagingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stagingId)) return null;
  const r = await query(
    `SELECT COALESCE(BOOL_OR(send_phase IN ('queued', 'processing', 'sent')), false) AS accepted,
            COALESCE(BOOL_OR(send_phase = 'preparing'), false) AS pending,
            COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE send_phase = 'preparing'))), 0)::int AS pending_sec
       FROM campaigns WHERE staging_id = $1::uuid AND company_id = $2::uuid`,
    [stagingId, companyId],
  );
  const state: AskSentState = r.rows[0]?.accepted === true ? 'accepted' : r.rows[0]?.pending === true ? 'pending' : 'none';
  return { state, stuck: state === 'pending' && (Number(r.rows[0]?.pending_sec) || 0) >= ASK_PENDING_STUCK_SEC };
}

/** 화면에 내려 주는 묶음 표(이름 · 설명 = 서버 한 곳) */
export function askGroupMeta(): Array<{ key: AskGroupKey; name: string; desc: string; cells: string[] }> {
  return ASK_GROUPS.map((g) => ({ key: g.key, name: g.name, desc: g.desc, cells: [...g.cells] }));
}
