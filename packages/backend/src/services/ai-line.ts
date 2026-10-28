/**
 * services/ai-line.ts — AI 한줄로 대상 찾기 · 재집계 · 만들기 · 꾸미기 · 진행 (★ 2026-10-18)
 *
 * 설계서 = docs/2026-10-18-ai-line-design.md §5 · §6
 * 돈 순서(모든 진입점 같음): 이미 냈는지 원장에 먼저 묻는다 → 잔액 확인 → AI(묶음 = 안쪽 차감 0) → 결과 검증 → 성공 뒤 차감.
 *   - 대상 = 승인 발송과 같은 몸통(허브 범위 CT · 수신동의 CT · 안전 필터 · 같은 해석기). 빈 조건 = 전체 선언일 때만 전체.
 *   - 기본 2 = 대상 1명 이상일 때 · 같은 날(어제 키 포함) 같은 한 줄이면 0.
 *   - 문안 = 2 × 실제로 나온 종류 수(한 행) · 꾸미기 = 1(글이 실제로 바뀌었을 때만).
 * ⛔ 모델명 · 줄표를 사용자 문장에 쓰지 않는다.
 */
import { query } from '../config/database';
import { recommendTarget, generateMessages, extractVarCatalog, filterVarCatalogByData } from './ai';
import { buildFilterWhereClauseCompat } from '../utils/customer-filter';
import { buildAudienceWhere } from '../utils/operator-recipients';
import { resolveHubStoreScope } from '../utils/store-scope';
import { viewerConsentSql, viewerBrandConsent } from '../utils/mall-consent';
import { isEmptyFilters } from '../utils/all-customers-signal';
import { analyzeAudienceFieldFill } from '../utils/company-data-profile';
import { mapSampleCustomerRow, SAMPLE_CUSTOMER_COLUMNS } from '../utils/sample-customer';
import { loadHubCompanyContext } from '../utils/hub-company-context';
import { getColumnFields, getFieldByKey } from '../utils/standard-field-map';
import { runInCreditBundle } from '../utils/ai-credit-context';
import { hasCreditForStrict, chargedAmountByKey, settleCreditAfterSuccess, InsufficientCreditError } from '../utils/ai-credit';
import { getCreditCost } from '../utils/ai-credit-calc';
import { buildMemoryPromptContext as buildCompanyMemoryPromptContext } from '../utils/company-memory';
import { buildMessageObjective } from '../utils/season-context';
import { buildLineEventText } from '../utils/one-line-facts';
import { formatLinePeriodEnd, lineFpLockKey } from '../utils/one-line-steps';
import { acquireInflightWait, releaseInflight } from '../utils/inflight-lock';
import { lineJudgeCovered } from '../utils/line-steps-context';
import { decorateOperatorMessages } from '../utils/operator-message-decorator';
import { enrichWithCustomFields } from '../utils/messageUtils';
import { getBrandVoiceFit, getBrandVoiceSnapshot, voiceStatusOfSnapshot } from '../utils/brand-voice-prompt';
import type { VoiceStatus } from '../utils/brand-voice-state';
import { COPY_CONTENT_TYPES, COPY_CONTENT_TYPE_LABEL, isCopyContentType, kindOfContentType, type CopyContentType } from '../utils/copy-content-type';
import { variantNamesFor } from '../utils/copy-house-rules';
import {
  AI_LINE_SOURCE, AI_LINE_TYPE_BY_VARIANT, AI_LINE_TYPE_LABEL, AI_LINE_COLUMN_EXCLUDE, AI_LINE_FILL_LOCK, AI_LINE_MAX_AUDIENCE,
  aiLineBaseKey, aiLineBaseKeys, aiLineCopyKey, aiLineDecoKey, aiLineComposeCost, filterChipText, quoteInLine, styleToType, maskName,
  lineMentionsAllCustomers, aiLineLineFp, sanitizeAiAsks, mergeLineAsks, lineAnswersLicense, lineAnswersContext, missingLineVars, lineVoiceKind,
  type AiLineCopyType, type AiLineAsk, type AiLineAnswer,
} from '../utils/ai-line';

export interface AiLineViewer {
  companyId: string;
  userId: string | null;
  userType: string | null;
}

/** 사용자에게 그대로 보이는 실패(코드 · 문장 · 상태) — 차감 전에 던진다 */
export class AiLineError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = 'AiLineError';
  }
}

const isPlainObject = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);

// ─────────────── 대상(승인 발송과 같은 몸통) ───────────────

export interface HubAudience {
  blocked: boolean;
  /** 조건이 비었는데 전체 선언이 없다(= 옮기지 못함) */
  unresolved: boolean;
  /** 조건 없음(전체 선언이면 전체 고객) */
  empty: boolean;
  where: string;
  params: any[];
}

/** 조건 → 승인 발송과 같은 WHERE(허브 범위 · 수신동의 · 안전 필터 · 같은 해석기). */
export async function compileHubAudience(v: AiLineViewer, filters: unknown, allCustomers: boolean): Promise<HubAudience> {
  const scope = await resolveHubStoreScope(v.companyId, v.userId, v.userType);
  if (scope.blocked) return { blocked: true, unresolved: false, empty: false, where: '', params: [] };
  const safe = isPlainObject(filters) ? filters : {};
  const compiled = buildFilterWhereClauseCompat(safe, scope.baseParams.length + 1, await viewerBrandConsent(v.companyId, { userId: v.userId, userType: v.userType }));
  const empty = !compiled.sql.trim();
  // 빈 WHERE 를 전체로 여는 것은 「진짜 빈 조건 + 전체 선언」뿐(preview-recipients 와 같은 판정)
  if (empty && !(allCustomers === true && isEmptyFilters(safe))) {
    return { blocked: false, unresolved: true, empty: true, where: '', params: [] };
  }
  const params = [...scope.baseParams, ...compiled.params];
  const consentTrue = (await viewerConsentSql(v.companyId, { userId: v.userId, userType: v.userType }, 'c')).isTrue;
  const where = buildAudienceWhere(params, compiled.sql, scope.storeFilter, { consentTrue });
  return { blocked: false, unresolved: false, empty, where, params };
}

export async function countHubAudience(a: HubAudience): Promise<number> {
  if (a.blocked || a.unresolved) return 0;
  const r = await query(`SELECT COUNT(*)::int AS count FROM customers c WHERE ${a.where}`, a.params);
  return Number(r.rows[0]?.count) || 0;
}

/** 대상 판정 실패를 사용자 문장으로(차감 전) */
function assertAudienceOpen(a: HubAudience): void {
  if (a.blocked) throw new AiLineError('SCOPE_BLOCKED', '담당 매장이 지정되지 않아 보낼 고객을 정할 수 없어요. 관리자에게 매장 배정을 요청해 주세요.');
  if (a.unresolved) throw new AiLineError('TARGET_FILTER_EMPTY', '조건이 모두 빠졌어요. 조건을 하나 이상 켜거나 「전체 고객에게 보내기」를 골라 주세요.');
}

/**
 * ★ 2026-10-19 Codex B1 high — 보내는 조건의 칸마다 SQL 이 실제로 나와야 한다. 해석기가 버리는 칸이 있으면 대상이 넓어진다.
 * 화면 상태(직접 고른 조건 · 다시 세기 실패)와 무관하게 돈 · 발송 입구(만들기 · 진행 · 알림톡 기본)에서 막는다.
 */
function assertFiltersTranslated(filters: unknown): void {
  const bad = describeLineFilters('', isPlainObject(filters) ? filters : {}, undefined).untranslated;
  if (bad.length > 0) {
    throw new AiLineError('TARGET_FILTER_UNTRANSLATED', `「${bad.map((u) => u.text).join(' · ')}」 조건은 받는 사람 계산에 쓸 수 없어요. 그 조건을 빼고 다시 시도해 주세요.`);
  }
}

function assertCountSendable(count: number): void {
  if (count <= 0) throw new AiLineError('TARGET_ZERO', '조건에 맞는 고객이 0명이에요. 조건을 바꿔 다시 시도해 주세요. 크레딧은 빠지지 않았어요.');
  if (count > AI_LINE_MAX_AUDIENCE) {
    throw new AiLineError('TARGET_TOO_MANY', `받는 사람이 ${count.toLocaleString()}명이에요. 한 번에 ${AI_LINE_MAX_AUDIENCE.toLocaleString()}명까지 보낼 수 있어요. 조건을 좁혀 주세요.`);
  }
}

/** 칩 라벨 — FIELD_MAP 표시 이름(커스텀 칸은 회사 라벨을 모르면 키) */
function labelForFilterKey(key: string): string {
  const k = key.startsWith('custom_fields.') ? key.slice('custom_fields.'.length) : key;
  if (k === 'minAge' || k === 'min_age' || k === 'maxAge' || k === 'max_age') return '나이';
  return getFieldByKey(k)?.displayName || k;
}

/** (순수에 가까움) 조건 객체 → 칩 목록. 칸마다 SQL 이 실제로 나오는지 따로 본다(안 나오면 「옮기지 못한 조건」). */
export function describeLineFilters(line: string, filters: Record<string, any>, quotes: Record<string, string> | undefined): {
  conditions: Array<{ key: string; label: string; text: string; origin: 'line' | 'ai' }>;
  untranslated: Array<{ key: string; text: string; origin: 'line' | 'ai' }>;
} {
  const conditions: Array<{ key: string; label: string; text: string; origin: 'line' | 'ai' }> = [];
  const untranslated: Array<{ key: string; text: string; origin: 'line' | 'ai' }> = [];
  for (const [key, cond] of Object.entries(filters || {})) {
    const label = labelForFilterKey(key);
    const text = filterChipText(key, cond, label);
    const origin: 'line' | 'ai' = quoteInLine(line, quotes?.[key]) ? 'line' : 'ai';
    if (buildFilterWhereClauseCompat({ [key]: cond }, 2).sql.trim()) conditions.push({ key, label, text, origin });
    else untranslated.push({ key, text, origin });
  }
  return { conditions, untranslated };
}

// ─────────────── 원장(기본 납부) ───────────────

/**
 * 오늘 · 어제 키 중 하나라도 원장에 있으면 냈다. 조회 실패는 던진다(호출부 503 · 모르는 납부를 0으로 접지 않는다).
 * ★ 2026-10-22 같은 한 줄로 오늘 · 어제 콘텐츠 완성(판단 몫 포함 · 채널 무관)을 냈어도 냈다 — 잔액 확인 · 견적 · intake · 정산이 모두 이 판정 하나(Codex CT R2 · R3).
 */
export async function aiLineBasePaid(companyId: string, line: string, now: Date): Promise<boolean> {
  try {
    // ★ 2026-10-23 판단 몫 판정 한 벌(설계서 docs/2026-10-23-oneline-ct-complete-design.md A5) — 콘텐츠 입구 판단 정산과 같은 함수(같은 키 · 같은 완성 조회)
    return await lineJudgeCovered(companyId, aiLineLineFp(line), now.getTime());
  } catch (err: any) {
    console.error('[ai-line] 원장 조회 실패:', err?.message);
    throw new AiLineError('CREDIT_LEDGER_UNAVAILABLE', '크레딧 내역을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.', 503);
  }
}

/** 이 키로 낸 금액(없으면 null) — 조회 실패는 503(모르는 납부를 0 으로 접지 않는다) */
async function paidAmountOf(companyId: string, key: string): Promise<number | null> {
  try {
    return await chargedAmountByKey(companyId, key);
  } catch (err: any) {
    console.error('[ai-line] 원장 조회 실패:', err?.message);
    throw new AiLineError('CREDIT_LEDGER_UNAVAILABLE', '크레딧 내역을 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.', 503);
  }
}

/**
 * ★ Codex 1R high — 낸 결과 기억(같은 시도 재요청 = 같은 결과 · 응답 유실 대비). 키 = 원장 멱등키(회사 · 시도 · 입력 지문).
 * ponytail: 프로세스 메모리(단일 프로세스 · 24시간 · 최대 500) — 재시작 뒤 재요청은 다시 만들되 낸 종류 수까지만 · 다시 걷지 않는다.
 */
const PAID_RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const PAID_RESULT_MAX = 500;
const paidResults = new Map<string, { at: number; value: unknown }>();
function rememberPaid(key: string, value: unknown): void {
  paidResults.delete(key);
  paidResults.set(key, { at: Date.now(), value });
  while (paidResults.size > PAID_RESULT_MAX) {
    const oldest = paidResults.keys().next().value;
    if (oldest === undefined) break;
    paidResults.delete(oldest);
  }
}
/**
 * ★ Codex 2R high — 같은 원장 키의 요청은 한 줄로 세운다(생성 · 정산 · 결과 확정이 겹치지 않게).
 *   뒤 요청은 앞 요청이 끝난 뒤 원장 · 기억을 다시 읽는다 → 이미 냈으면 같은 결과.
 * ponytail: 프로세스 안 잠금(PM2 instances 1) — 여러 프로세스로 늘리면 DB 잠금으로 바꾼다.
 */
const keyLocks = new Map<string, Promise<unknown>>();
async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  keyLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (keyLocks.get(key) === tail) keyLocks.delete(key);
  }
}

function recallPaid<T>(key: string): T | null {
  const hit = paidResults.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > PAID_RESULT_TTL_MS) { paidResults.delete(key); return null; }
  return hit.value as T;
}

async function assertCreditFor(companyId: string, cost: number, source: string): Promise<void> {
  if (cost <= 0) return;
  if (!(await hasCreditForStrict(companyId, cost, source))) throw new InsufficientCreditError(cost, 0);
}

async function settleBase(v: AiLineViewer, line: string, now: Date): Promise<void> {
  await settleCreditAfterSuccess({
    companyId: v.companyId, cost: getCreditCost(AI_LINE_SOURCE.intake), source: AI_LINE_SOURCE.intake,
    idempotencyKey: aiLineBaseKey(v.companyId, line, now), createdBy: v.userId,
  });
}

/**
 * ★ 2026-10-19 Codex B2 high — 기본 정산은 한 자리. 네 입구(대상 찾기 · 진행 · 만들기 · 알림톡 매칭)가 모두 여기로 온다.
 * 같은 회사 · 같은 한 줄의 정산을 키 잠금으로 한 줄에 세우고, 잠금 안에서 **정산하는 순간의** 오늘 · 어제 키를 다시 본다
 * (자정을 끼고 두 입구가 겹쳐도 한 번만 · 요청 시작 때 잡은 날짜로 걷지 않는다). 돌려줌 = 이번에 걷었는가.
 */
async function settleBaseOnce(v: AiLineViewer, line: string): Promise<boolean> {
  return withKeyLock(`aio-base-settle:${v.companyId}:${aiLineLineFp(line)}`, async () => {
    // ★ 2026-10-22 한줄 CT — 콘텐츠 입구 판단(2) · 결과물 생성과 같은 한 줄 잠금(날짜 · 채널 없음)을 기다렸다 잡는다(Codex CT R1 · 자정을 낀 이중 판단 과금)
    const lock = lineFpLockKey(v.companyId, aiLineLineFp(line));
    if (!(await acquireInflightWait(lock))) throw new AiLineError('IN_FLIGHT', '같은 한 줄을 지금 다른 화면에서 처리하는 중이에요. 잠시 뒤 다시 시도해 주세요.', 409);
    try {
      const at = new Date();
      if (await aiLineBasePaid(v.companyId, line, at)) return false;
      await settleBase(v, line, at);
      return true;
    } finally {
      releaseInflight(lock);
    }
  });
}

// ─────────────── intake ───────────────

/** ★ 2026-10-20 custom = 회사가 올린 칼럼(customer_field_definitions · 발송 치환과 같은 출처) */
export interface LineColumn { token: string; label: string; value: string | number | null; fill: number; locked: boolean; recommended: boolean; custom: boolean }

/** 한 대상 화면에 싣는 칼럼 상한(표준 · 회사 칼럼 각각 · 채움 높은 순) */
const LINE_COLUMNS_MAX = 10;

/**
 * ★ 2026-10-20 회사 칼럼 = 발송 치환과 같은 출처(enrichWithCustomFields · 라벨 → custom_fields 키).
 * 표준 칼럼 이름과 겹치는 라벨은 발송 때 표준이 이기므로 뺀다. 조회 실패 = 빈 목록(표준 칼럼만 · 발송 치환과 같은 판단).
 */
async function companyCustomColumns(companyId: string): Promise<Array<{ label: string; key: string }>> {
  const map: Parameters<typeof enrichWithCustomFields>[0] = {};
  await enrichWithCustomFields(map, companyId);
  const standard = new Set(getColumnFields().map((f) => f.displayName));
  return Object.entries(map)
    .filter(([label, e]) => e.storageType === 'custom_fields' && !!e.column && !standard.has(label))
    .map(([label, e]) => ({ label, key: e.column }));
}

/** 만들기 · 꾸미기에서 받을 수 있는 칼럼 이름 = 표준(제외 목록 밖) + 이 회사 회사 칼럼 */
export async function aiLineVarTokensFor(companyId: string): Promise<Set<string>> {
  const out = aiLineVarTokens();
  for (const c of await companyCustomColumns(companyId)) out.add(c.label);
  return out;
}

export interface LineIntakeResult {
  /** ★ 2026-10-28 AI 메모리 설계 K4-4 · K13-7 — 문자 종류(사실 읽기 판정 · 모르면 null) · 칩 라벨(서버가 내린다) */
  contentType: CopyContentType | null;
  contentTypes: Array<{ key: CopyContentType; label: string }>;
  /** ★ 2026-10-28 K3-2 목소리 회사 = 안 이름(서버 variantNamesFor · 키는 그대로) · 아니면 null(화면 기본 이름) */
  typeNames: Record<'emo' | 'benefit' | 'mz', string> | null;
  filters: Record<string, any>;
  allCustomers: boolean;
  conditions: Array<{ key: string; label: string; text: string; origin: 'line' | 'ai' }>;
  untranslated: Array<{ key: string; text: string; origin: 'line' | 'ai' }>;
  count: number;
  /** 0명 사유 — none(1명 이상) · zero(조건 0명) · unresolved(옮기지 못함) · scope(매장 미배정) */
  zeroReason: 'none' | 'zero' | 'unresolved' | 'scope';
  reasoning: string;
  top: { id: string; name: string } | null;
  /** 결과 미리보기 치환용(고객명은 가린 값) */
  sampleCustomer: Record<string, string | number | null> | null;
  columns: LineColumn[];
  recommend: { type: AiLineCopyType; reason: string } | null;
  channel: 'SMS' | 'LMS' | 'MMS';
  isAd: boolean;
  recommendedTime: string;
  suggestedName: string;
  rejectNumber: string | null;
  base: { paid: boolean; charged: boolean; cost: number };
  /**
   * ★ 2026-10-19 한 줄에서 받는 사람 조건을 하나도 못 읽었다(「전체 고객」이라고도 안 했다) — 화면이 「누구에게 보낼까요?」를 먼저 묻는다.
   * 이때는 기본을 걷지 않는다(답한 뒤 만들기 · 진행에서 미납이면 걷는다 · 같은 키).
   */
  needAudience: boolean;
  /** ★ 2026-10-20 묻는 목록 한 자리(AI 가 한 줄을 읽고 판단 + 규칙 안전망 · 설계서 §17) — 비면 묻지 않고 다음 */
  asks: AiLineAsk[];
  /** ★ 2026-10-20 브랜드 말투를 배웠는가(성격별) — 모르면 null(안내 줄을 그리지 않는다) */
  voice: { learned: boolean; marketing: boolean; notice: boolean; status: VoiceStatus } | null;
  /** ★ 2026-10-21 추천 칼럼(대상 상세와 분리 · 처음 대상이 0명이어도 남는다 · 칩을 끈 뒤 칼럼 단계가 미리 체크에 쓴다) */
  recommendedVars: string[];
}

/** 대상 1위 고객(고객명 가림) · 칼럼 채움(이 대상 안) — 대상 찾기와 직접 고른 대상 다시 세기가 같은 계산을 쓴다 */
async function audienceDetail(companyId: string, audience: HubAudience, count: number, recommendedVars: readonly string[]): Promise<{
  top: LineIntakeResult['top']; sampleCustomer: LineIntakeResult['sampleCustomer']; columns: LineColumn[];
}> {
  if (count <= 0) return { top: null, sampleCustomer: null, columns: [] };
  const customs = await companyCustomColumns(companyId);
  let top: LineIntakeResult['top'] = null;
  let sampleCustomer: LineIntakeResult['sampleCustomer'] = null;
  const tr = await query(
    `SELECT c.id, c.custom_fields, ${SAMPLE_CUSTOMER_COLUMNS} FROM customers c WHERE ${audience.where}
      ORDER BY COALESCE(c.ltv_score, 0) DESC, COALESCE(c.total_purchase_amount, 0) DESC, c.id ASC LIMIT 1`,
    audience.params,
  );
  const row = tr.rows[0];
  if (row) {
    const mapped = mapSampleCustomerRow(row);
    sampleCustomer = mapped.sampleCustomer;
    const nameKey = getFieldByKey('name')?.displayName || '고객명';
    if (sampleCustomer[nameKey] != null) sampleCustomer[nameKey] = maskName(sampleCustomer[nameKey]);
    top = { id: String(row.id), name: String(sampleCustomer[nameKey] ?? '') };
    // 회사 칼럼 값 = 미리보기 치환이 라벨로 찾는다(발송 치환과 같은 라벨)
    const cf = row.custom_fields && typeof row.custom_fields === 'object' ? row.custom_fields as Record<string, unknown> : {};
    for (const c of customs) {
      const val = cf[c.key];
      if (val !== undefined && val !== null && String(val).trim() !== '') sampleCustomer[c.label] = typeof val === 'number' ? val : String(val);
    }
  }
  const fill = await analyzeAudienceFieldFill(audience.where, audience.params);
  const keyByColumn = new Map(getColumnFields().map((f) => [f.columnName, f.fieldKey]));
  const recommended = new Set(recommendedVars.map((x) => String(x).replace(/%/g, '').trim()));
  const columns: LineColumn[] = fill.fields
    .filter((f) => !AI_LINE_COLUMN_EXCLUDE.has(keyByColumn.get(f.field) || f.field) && f.fillRate > 0)
    .sort((a, b) => b.fillRate - a.fillRate)
    .slice(0, LINE_COLUMNS_MAX)
    .map((f) => ({
      token: f.percentVar,
      label: f.label,
      value: sampleCustomer ? sampleCustomer[f.label] ?? null : null,
      fill: f.fillRate,
      locked: f.fillRate < AI_LINE_FILL_LOCK,
      recommended: recommended.has(f.percentVar) || recommended.has(f.label),
      custom: false,
    }));
  // ★ 2026-10-20 회사 칼럼 채움(이 대상 안 · 같은 WHERE 한 번 · 키는 매개변수로)
  if (customs.length > 0) {
    const base = audience.params.length;
    const counts = customs.map((_, i) => `COUNT(*) FILTER (WHERE COALESCE(c.custom_fields->>$${base + i + 1}, '') <> '') AS cnt_${i}`);
    const cr = await query(
      `SELECT COUNT(*)::int AS total_n, ${counts.join(', ')} FROM customers c WHERE ${audience.where}`,
      [...audience.params, ...customs.map((c) => c.key)],
    );
    const cRow = cr.rows[0] || {};
    const total = Number(cRow.total_n) || 0;
    const customCols: LineColumn[] = customs
      .map((c, i) => {
        const fillRate = total > 0 ? Math.round(((Number(cRow[`cnt_${i}`]) || 0) / total) * 100) : 0;
        return {
          token: c.label,
          label: c.label,
          value: sampleCustomer ? sampleCustomer[c.label] ?? null : null,
          fill: fillRate,
          locked: fillRate < AI_LINE_FILL_LOCK,
          recommended: recommended.has(c.label),
          custom: true,
        };
      })
      .filter((c) => c.fill > 0)
      .sort((a, b) => b.fill - a.fill)
      .slice(0, LINE_COLUMNS_MAX);
    columns.push(...customCols);
  }
  return { top, sampleCustomer, columns };
}

/** 성격별 브랜드 말투 학습 여부(확인 판 안내 줄) — 조회 실패 = null(안내를 그리지 않는다 · 생성은 그대로) */
async function lineVoiceFit(companyId: string): Promise<LineIntakeResult['voice']> {
  try {
    const [m, n, snap] = await Promise.all([getBrandVoiceFit(companyId, 'marketing'), getBrandVoiceFit(companyId, 'notice'), getBrandVoiceSnapshot(companyId)]);
    // ★ 2026-10-28 K13-7 · K7-5 — 칩 상태(학습 미완 = [다시 배우기 · 6] · 확인 대기 · 견본 미완) = AI 메모리와 같은 판정
    return { learned: m.learned, marketing: m.kindLearned, notice: n.kindLearned, status: voiceStatusOfSnapshot(snap) };
  } catch (err: any) {
    console.warn('[ai-line] 브랜드 말투 조회 실패:', err?.message);
    return null;
  }
}

export async function runLineIntake(v: AiLineViewer, line: string, now: Date = new Date()): Promise<LineIntakeResult> {
  const baseCost = getCreditCost(AI_LINE_SOURCE.intake);
  const basePaid = await aiLineBasePaid(v.companyId, line, now);
  if (!basePaid) await assertCreditFor(v.companyId, baseCost, AI_LINE_SOURCE.intake);

  const { companyInfo, customerStats } = await loadHubCompanyContext(v.companyId, v.userId, { userId: v.userId, userType: v.userType });
  const target = await runInCreditBundle(() => recommendTarget(v.companyId, line, customerStats, companyInfo, { model: 'opus', lineIntake: true }));
  const filters: Record<string, any> = isPlainObject(target.filters) ? target.filters : {};
  const allCustomers = target.all_customers === true && isEmptyFilters(filters);
  const { conditions, untranslated } = describeLineFilters(line, filters, target.filter_quotes);

  const audience = await compileHubAudience(v, filters, allCustomers);
  const count = await countHubAudience(audience);
  const zeroReason: LineIntakeResult['zeroReason'] = audience.blocked ? 'scope' : audience.unresolved ? 'unresolved' : count === 0 ? 'zero' : 'none';

  // ★ 2026-10-20 추천 칼럼 = 대상 AI 가 이 한 줄에 맞게 고른 것(copy_vars) · 「개인화」 낱말로 고른 것도 함께
  //   ★ 2026-10-21 대상 상세(1위 고객 · 칼럼)와 떼어 응답 한 칸으로도 준다(대상이 0명이면 칼럼이 비어 추천이 사라졌다)
  const recommendedVars = [...new Set([...(target.copy_vars || []), ...(target.personalization_vars || [])]
    .map((x) => String(x || '').replace(/%/g, '').trim()).filter(Boolean))];
  const { top, sampleCustomer, columns } = await audienceDetail(v.companyId, audience, count, recommendedVars);
  // ★ 2026-10-20 묻는 목록 = AI 가 한 줄을 읽고 판단한 질문 + 규칙 안전망(한 자리 · 설계서 §17)
  const asks = mergeLineAsks(line, sanitizeAiAsks(target.copy_questions, line));
  const voice = await lineVoiceFit(v.companyId);

  // ★ 2026-10-19 받는 사람을 한 줄에서 못 읽음 = 「누구에게」를 먼저 묻는다 · 그동안 기본을 걷지 않는다
  const needAudience = !conditions.some((c) => c.origin === 'line') && !lineMentionsAllCustomers(line);
  let charged = false;
  let paidNow = basePaid;
  if (count > 0 && !basePaid && !needAudience) {
    charged = await settleBaseOnce(v, line);
    paidNow = true;   // 이번에 걷었거나 · 겹친 다른 입구가 이미 걷었다
  }
  const rt = styleToType(target.recommended_style);
  const ch = String(target.recommended_channel || 'LMS').toUpperCase();
  // ★ 2026-10-28 AI 메모리 설계 K4-4 · K13-7 — 종류 = 사실 읽기 판정(화면 칩 · 1클릭 바꾸기 · 광고 칩과 독립)
  const contentType = isCopyContentType(target.content_type) ? target.content_type : null;
  return {
    contentType,
    contentTypes: COPY_CONTENT_TYPES.map((key) => ({ key, label: COPY_CONTENT_TYPE_LABEL[key] })),
    typeNames: voice?.learned ? (([a, b, c]) => ({ emo: a, benefit: b, mz: c }))(variantNamesFor(true, '')) : null,
    filters, allCustomers, conditions, untranslated, count, zeroReason,
    reasoning: String(target.reasoning || ''),
    top, sampleCustomer, columns,
    recommend: rt ? { type: rt, reason: String(target.style_reason || '') } : null,
    channel: ch === 'SMS' || ch === 'MMS' ? ch : 'LMS',
    isAd: target.is_ad !== false,
    recommendedTime: String(target.recommended_time || ''),
    suggestedName: String(target.suggested_campaign_name || ''),
    rejectNumber: companyInfo?.reject_number ? String(companyInfo.reject_number) : null,
    base: { paid: paidNow, charged, cost: baseCost },
    needAudience,
    asks,
    voice,
    recommendedVars,
  };
}

// ─────────────── 재집계(0크레딧) ───────────────

export async function runLineRecount(v: AiLineViewer, filters: unknown, allCustomers: boolean): Promise<{ count: number; empty: boolean; blocked: boolean; unresolved: boolean }> {
  const a = await compileHubAudience(v, filters, allCustomers);
  return { count: await countHubAudience(a), empty: a.empty, blocked: a.blocked, unresolved: a.unresolved };
}

/**
 * ★ 2026-10-19 대상을 바꿨을 때(직접 타겟 선택 · 「전체 고객」 답) — 다시 세기 + 칩 · 1위 고객 · 칼럼(0크레딧).
 * 칩 = 칸마다 SQL 이 실제로 나오는지 따로 본다(안 나오면 untranslated · 화면이 막는다 = 조건을 버려 대상이 넓어지는 일 없음).
 */
export async function runLineRetarget(v: AiLineViewer, filters: unknown, allCustomers: boolean): Promise<{
  count: number; empty: boolean; blocked: boolean; unresolved: boolean;
  conditions: Array<{ key: string; label: string; text: string }>;
  untranslated: Array<{ key: string; text: string }>;
  top: LineIntakeResult['top']; sampleCustomer: LineIntakeResult['sampleCustomer']; columns: LineColumn[];
}> {
  const safe = isPlainObject(filters) ? filters : {};
  const d = describeLineFilters('', safe, undefined);
  const a = await compileHubAudience(v, safe, allCustomers);
  const count = await countHubAudience(a);
  const detail = d.untranslated.length > 0 ? { top: null, sampleCustomer: null, columns: [] } : await audienceDetail(v.companyId, a, count, []);
  return {
    count, empty: a.empty, blocked: a.blocked, unresolved: a.unresolved,
    conditions: d.conditions.map(({ key, label, text }) => ({ key, label, text })),
    untranslated: d.untranslated.map(({ key, text }) => ({ key, text })),
    ...detail,
  };
}

// ─────────────── 진행(직접입력만 · 알림톡) — 기본만 ───────────────

export async function runLineProceed(v: AiLineViewer, line: string, filters: unknown, allCustomers: boolean, now: Date = new Date()): Promise<{ count: number; charged: boolean }> {
  assertFiltersTranslated(filters);
  const a = await compileHubAudience(v, filters, allCustomers);
  assertAudienceOpen(a);
  const count = await countHubAudience(a);
  assertCountSendable(count);
  if (await aiLineBasePaid(v.companyId, line, now)) return { count, charged: false };
  await assertCreditFor(v.companyId, getCreditCost(AI_LINE_SOURCE.intake), AI_LINE_SOURCE.intake);
  return { count, charged: await settleBaseOnce(v, line) };
}

/**
 * ★ 2026-10-19 알림톡 템플릿 고르기(Codex B1 medium) — 「누구에게」를 물어 기본을 아직 안 낸 경우,
 * 확정 대상(칸 확인 · 1명 이상 · 상한)과 잔액을 확인하고 → 매칭(묶음 = 안쪽 차감 0) → 성공 뒤 기본(같은 키 · 진행에서 다시 걷지 않음).
 */
export async function runLineAlimtalkMatch<T>(
  v: AiLineViewer, line: string, filters: unknown, allCustomers: boolean, match: () => Promise<T>,
  /** ★ Codex B2 high — 고를 수 있는 템플릿이 나왔는가(없음 · 실패 결과에는 걷지 않는다) */
  usable: (r: T) => boolean,
  now: Date = new Date(),
): Promise<{ result: T; charged: boolean; paid: boolean }> {
  if (await aiLineBasePaid(v.companyId, line, now)) return { result: await runInCreditBundle(match), charged: false, paid: true };
  assertFiltersTranslated(filters);
  const a = await compileHubAudience(v, filters, allCustomers);
  assertAudienceOpen(a);
  assertCountSendable(await countHubAudience(a));
  await assertCreditFor(v.companyId, getCreditCost(AI_LINE_SOURCE.intake), AI_LINE_SOURCE.intake);
  const result = await runInCreditBundle(match);
  if (!usable(result)) return { result, charged: false, paid: false };
  return { result, charged: await settleBaseOnce(v, line), paid: true };
}

// ─────────────── 만들기 ───────────────

export interface LineComposeInput {
  line: string;
  /** ★ 2026-10-20 answers = AI 가 물은 그 밖 질문의 답(있을 때만 · 없으면 옛 모양 = 원장 키 지문 무변) */
  facts: { benefit: string | null; periodEnd: string | null; answers?: AiLineAnswer[] };
  filters: Record<string, any>;
  allCustomers: boolean;
  types: AiLineCopyType[];
  vars: string[];
  channel: 'SMS' | 'LMS' | 'MMS';
  isAd: boolean;
  attemptToken: string;
  /** ★ 2026-10-28 K4-4 화면 종류 칩(사람이 고른 것 = 입력 종류 · 없으면 광고 여부로 성격) */
  contentType?: CopyContentType | null;
}

export interface LineComposeCard { type: AiLineCopyType; label: string; body: string; subject: string; byteCount: number }

/** 문안 변수로 고를 수 있는 칼럼 표시 이름(FIELD_MAP 컬럼 · 제외 목록 밖) */
export function aiLineVarTokens(): Set<string> {
  return new Set(getColumnFields().filter((f) => !AI_LINE_COLUMN_EXCLUDE.has(f.fieldKey)).map((f) => f.displayName));
}

export async function runLineCompose(v: AiLineViewer, input: LineComposeInput, now: Date = new Date()): Promise<{
  cards: LineComposeCard[]; channel: 'SMS' | 'LMS' | 'MMS'; count: number; charged: { base: number; copies: number };
}> {
  assertFiltersTranslated(input.filters);
  const audience = await compileHubAudience(v, input.filters, input.allCustomers);
  assertAudienceOpen(audience);
  const count = await countHubAudience(audience);
  assertCountSendable(count);

  // 칼럼을 넣으면 SMS 는 LMS 로 올린다(치환 뒤 길이 · 지금 허브 규칙과 같다)
  const channel: 'SMS' | 'LMS' | 'MMS' = input.vars.length > 0 && input.channel === 'SMS' ? 'LMS' : input.channel;
  const copyKey = aiLineCopyKey(v.companyId, input.attemptToken, {
    line: input.line, facts: input.facts, filters: input.filters, allCustomers: input.allCustomers,
    types: input.types, vars: input.vars, channel, isAd: input.isAd,
    ...(input.contentType ? { contentType: input.contentType } : {}),   // 종류 없음 = 옛 모양(같은 시도 재요청 키 무변)
  });
  return withKeyLock(copyKey, async () => {
  // ★ Codex 1R high — 같은 시도를 이미 냈으면: 기억한 결과 그대로 · 없으면 다시 만들되 낸 종류 수까지만 · 잔액 확인 · 차감 0
  const paidCopies = await paidAmountOf(v.companyId, copyKey);
  if (paidCopies !== null) {
    const remembered = recallPaid<{ cards: LineComposeCard[]; channel: 'SMS' | 'LMS' | 'MMS' }>(copyKey);
    if (remembered) return { ...remembered, count, charged: { base: 0, copies: 0 } };
  }
  // ★ Codex 2R — 기본료 납부는 기본 키로만 판정한다(문안료 원장은 기본료 납부를 증명하지 않는다 · 이미 낸 갈래는 아무것도 걷지 않는다)
  const basePaid = paidCopies !== null ? true : await aiLineBasePaid(v.companyId, input.line, now);
  const quote = aiLineComposeCost(paidCopies !== null ? 0 : input.types.length, basePaid);
  if (paidCopies === null) await assertCreditFor(v.companyId, quote.total, AI_LINE_SOURCE.compose);
  const { conditions } = describeLineFilters(input.line, input.filters, undefined);
  const audienceText = input.allCustomers && conditions.length === 0 ? '전체 고객' : conditions.map((c) => c.text).join(' · ');
  const periodLine = input.facts.periodEnd ? `\n[기간] ${formatLinePeriodEnd(input.facts.periodEnd)}까지` : '';
  // ★ 2026-10-20 AI 가 물은 그 밖 질문의 답 = 근거 글의 「확인한 사실」(사람이 적은 답만 · 묻고 답하지 않은 것은 쓰지 않는다)
  //   ★ Codex R1 high — 질문 글(AI 가 씀)은 근거 글에 넣지 않고 참고 글로만(질문 속 혜택이 근거가 되지 않게)
  const answers = input.facts.answers || [];
  const licenseText = `${buildLineEventText(input.line, { benefit: input.facts.benefit })}${periodLine}${lineAnswersLicense(answers)}`;

  const generated = await runInCreditBundle(async () => {
    const { companyInfo, customerStats } = await loadHubCompanyContext(v.companyId, v.userId, { userId: v.userId, userType: v.userType });
    const { fieldMappings: varCatalog, availableVars } = extractVarCatalog(companyInfo.customer_schema);
    await filterVarCatalogByData(varCatalog, availableVars, v.companyId);
    // ★ 2026-10-20 고른 회사 칼럼 = 변수 표에 싣는다(표에 없으면 생성기가 「목록 밖 변수」로 피한다 · 발송 치환과 같은 출처)
    await enrichWithCustomFields(varCatalog, v.companyId);
    for (const t of input.vars) if (varCatalog[t] && !availableVars.includes(t)) availableVars.push(t);
    const memory = await buildCompanyMemoryPromptContext(v.companyId, 20).catch(() => '');
    const audienceBlock = `[실제 발송 대상: 이 대상에게 맞게 쓴다]\n${audienceText}\n목표 문장과 대상이 다르면 대상을 따른다. 다른 고객군을 지칭하지 않는다.`;
    return generateMessages(
      buildMessageObjective(licenseText, [audienceBlock, lineAnswersContext(answers), memory].filter(Boolean).join('\n\n')),
      {
        total_count: count,
        avg_purchase_count: parseFloat(customerStats?.avg_purchase_count) || 0,
        avg_total_spent: parseFloat(customerStats?.avg_total_spent) || 0,
      } as any,
      {
        brandName: companyInfo.brand_name || companyInfo.company_name,
        brandSlogan: companyInfo.brand_slogan,
        brandDescription: companyInfo.brand_description,
        brandTone: companyInfo.brand_tone,
        channel,
        isAd: input.isAd,
        rejectNumber: companyInfo.reject_number,
        availableVarsCatalog: varCatalog,
        availableVars,
        model: 'sonnet',
        companyId: v.companyId,
        licenseText,
        exactVars: input.vars,
        // ★ 2026-10-20 문자 성격(광고 여부 하나) = 그 성격의 브랜드 보이스 가이드라인 · 대표 문안만
        // ★ 2026-10-28 K4-4 — 사람이 고른 종류가 있으면 성격은 종류에서(광고 여부는 법 축만)
        voiceKind: input.contentType ? kindOfContentType(input.contentType) : lineVoiceKind(input.isAd),
        ...(input.contentType ? { contentType: input.contentType } : {}),
      },
    );
  });

  // ★ Codex 1R high — AI 호출 · 파싱 실패의 기본 골격에는 걷지 않는다(차감 전 거절)
  if ((generated as any).fallback === true) {
    throw new AiLineError('AI_UNAVAILABLE', '지금은 문안을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요. 크레딧은 빠지지 않았어요.', 502);
  }
  const byType = new Map<AiLineCopyType, any>();
  for (const variant of generated.variants || []) {
    const t = AI_LINE_TYPE_BY_VARIANT[String((variant as any).variant_id || '').toUpperCase()];
    if (t) byType.set(t, variant);
  }
  const cards: LineComposeCard[] = [];
  for (const t of input.types) {
    const vv = byType.get(t);
    const body = String(vv?.message_text || '').trim();
    if (!body) continue;
    // ★ 2026-10-28 K3-2 목소리 회사 = 서버 이름(우리 문자처럼 · 혜택 먼저 · 짧게) · 아니면 지금 이름
    const label = (generated as any).voice_mode === true && vv?.variant_name ? String(vv.variant_name) : AI_LINE_TYPE_LABEL[t];
    cards.push({ type: t, label, body, subject: String(vv?.subject || '').trim(), byteCount: Number(vv?.byte_count) || 0 });
  }
  if (cards.length === 0) throw new AiLineError('COMPOSE_EMPTY', '문안을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요. 크레딧은 빠지지 않았어요.', 502);

  // ★ 2026-10-20 고른 칼럼은 문안마다 들어가야 한다(Harold 「고른 칼럼을 활용해서 문안을 만들어야」) — 빠진 문안만 같은 묶음 안에서
  //   꾸미기(추가 차감 0)로 넣는다. 그래도 빠진 칼럼은 카드가 지금 본문으로 바로 알린다(직접 고친 뒤에도 맞게). 꾸미기 실패 = 원문 그대로.
  if (input.vars.length > 0) {
    const short = cards.filter((c) => missingLineVars(c.body, input.vars).length > 0 && c.body.length >= 5);
    if (short.length > 0) {
      try {
        const fixed = await runInCreditBundle(() => decorateOperatorMessages({
          companyId: v.companyId,
          messages: short.map((c) => c.body),
          selectedVars: input.vars,
          channel: channel.toLowerCase() as 'sms' | 'lms' | 'mms',
          isAd: input.isAd,
          userId: v.userId || undefined,
        }));
        short.forEach((c, i) => {
          const next = String(fixed?.messages?.[i] || '').trim();
          if (next && missingLineVars(next, input.vars).length < missingLineVars(c.body, input.vars).length) c.body = next;
        });
      } catch (err: any) {
        console.warn('[ai-line] 고른 칼럼 넣기 실패 · 원문 그대로:', err?.message);
      }
    }
  }

  // 이미 낸 시도(기억이 사라진 뒤 재요청) = 낸 종류 수까지만 돌려주고 걷지 않는다
  if (paidCopies !== null) {
    const unit = getCreditCost(AI_LINE_SOURCE.compose);
    const paidCards = cards.slice(0, unit > 0 ? Math.floor(paidCopies / unit) : cards.length);
    if (paidCards.length === 0) throw new AiLineError('COMPOSE_EMPTY', '문안을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.', 502);
    rememberPaid(copyKey, { cards: paidCards, channel });
    return { cards: paidCards, channel, count, charged: { base: 0, copies: 0 } };
  }

  // 성공 뒤 차감 — 기본(아직이면) → 문안(나온 종류 수 · 한 행). 잔액 부족은 402(결과를 내주지 않는다).
  let baseCharged = 0;
  if (!basePaid && await settleBaseOnce(v, input.line)) baseCharged = quote.base;
  const unit = getCreditCost(AI_LINE_SOURCE.compose);
  const copyCost = cards.length * unit;
  await settleCreditAfterSuccess({
    companyId: v.companyId, cost: copyCost, source: AI_LINE_SOURCE.compose, createdBy: v.userId,
    idempotencyKey: copyKey,
  });
  // ★ Codex 2R high — 정산 뒤 원장이 진실: 같은 키가 이미 더 적게 냈으면(중복 정산 = 차감 생략) 낸 종류 수까지만 돌려주고 기억한다.
  //   ★ 2026-10-25 원장 쓰기 실패는 settleCreditAfterSuccess 가 던진다(503 · 결과 안 줌 · 성공 뒤 차감 한 규칙 D1 A).
  const ledger = await paidAmountOf(v.companyId, copyKey);
  const finalCards = ledger !== null && unit > 0 ? cards.slice(0, Math.floor(ledger / unit)) : cards;
  if (finalCards.length === 0) throw new AiLineError('COMPOSE_EMPTY', '문안을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.', 502);
  rememberPaid(copyKey, { cards: finalCards, channel });
  const charged = ledger !== null && ledger < copyCost ? 0 : copyCost;
  return { cards: finalCards, channel, count, charged: { base: baseCharged, copies: charged } };
  });
}

// ─────────────── 꾸미기(문안 1개 · 1) ───────────────

export async function runLineDecorate(v: AiLineViewer, input: { body: string; vars: string[]; channel: 'SMS' | 'LMS' | 'MMS'; isAd: boolean; attemptToken: string }): Promise<{ body: string; changed: boolean; charged: number }> {
  const cost = getCreditCost(AI_LINE_SOURCE.decorate);
  const decoKey = aiLineDecoKey(v.companyId, input.attemptToken, { body: input.body, vars: input.vars, channel: input.channel, isAd: input.isAd });
  return withKeyLock(decoKey, async () => {
  // ★ Codex 1R high — 같은 시도를 이미 냈으면 기억한 결과 · 없으면 다시 꾸미되 잔액 확인 · 차감 0
  const paid = (await paidAmountOf(v.companyId, decoKey)) !== null;
  if (paid) {
    const remembered = recallPaid<{ body: string }>(decoKey);
    if (remembered) return { body: remembered.body, changed: true, charged: 0 };
  } else {
    await assertCreditFor(v.companyId, cost, AI_LINE_SOURCE.decorate);
  }
  const { messages: [decorated] } = await runInCreditBundle(() => decorateOperatorMessages({
    companyId: v.companyId,
    messages: [input.body],
    selectedVars: input.vars,
    channel: input.channel.toLowerCase() as 'sms' | 'lms' | 'mms',
    isAd: input.isAd,
    userId: v.userId || undefined,
  }));
  const out = String(decorated || '').trim();
  // 꾸미기가 원문을 그대로 돌려줬으면(파싱 실패 · 사실 추가 검출) 걷지 않는다 — 검증 통과 뒤 정산
  if (!out || out === input.body.trim()) return { body: input.body, changed: false, charged: 0 };
  if (!paid) {
    await settleCreditAfterSuccess({ companyId: v.companyId, cost, source: AI_LINE_SOURCE.decorate, createdBy: v.userId, idempotencyKey: decoKey });
  }
  rememberPaid(decoKey, { body: out });
  return { body: out, changed: true, charged: paid ? 0 : cost };
  });
}
