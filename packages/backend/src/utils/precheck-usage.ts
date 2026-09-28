/**
 * ★ CT: 스팸 검사·맞춤법 사용 현황 (★2026-09-26 Harold 지시 · 슈퍼관리자 ceo 전용 · 읽기 전용)
 *
 * 0925 배포한 발송 전 점검(스팸 검사 무료 체험 3회 · 맞춤법 무료 월 5회)을 어느 업체가 언제 썼는지 본다.
 * 원천 = 이미 쌓이는 세 곳(새 칸 0 · 모두 운영 코드가 쓰는 칸만 읽는다):
 *   - `spam_filter_tests` — source: manual·NULL = 유료 · trial = 무료 체험 · auto_ai·auto_ai_free = 자동(구분 = spam-trial CT)
 *   - `spell_check_uses` — 직접발송 맞춤법(source = DIRECT_SPELL_SOURCE · status done/failed/reserved · issue_count)
 *   - `agency_send_events` kind 'spell_checked' — 대행 맞춤법(테스트 문자 뒤 자동 검사 · payload {count, failed})
 * 무료 한도 표시는 고객 화면(`/api/send-checks/status`)과 **같은 함수**로 계산한다 — 화면 숫자와 실제 차단 기준이 갈리지 않게:
 *   스팸 체험 = `readSpamTrialStatus`(평생 3회 · 요금제에 스팸 검사가 없는 회사만) · 맞춤법 = `loadPlanContext`+`isActivePaidPlan`
 *   (유료면 무제한) + `readSpellUsage`(이번 달).
 * 게이트(ceo 전용)는 라우트가 `isPrecheckUsageViewer`(audit-log.ts)로 건다.
 */
import { query } from '../config/database';
import { isUuid } from './normalize';
import { mapWithConcurrency } from './concurrency';
import { SPAM_TRIAL_SOURCE, isAutoSpamSource, readSpamTrialStatus } from './spam-trial';
import { DIRECT_SPELL_SOURCE, SPELL_FREE_MONTHLY_LIMIT, readSpellUsage } from './spell-check-quota';
import { AGENCY_SPELL_EVENT, readAgencySpell } from './agency-send-spell';
import { isActivePaidPlan, loadPlanContext } from './plan-guard';
import { getSpamResultLabel, getSpamResultType } from './sms-result-map';
import type { SpellIssue } from './spell-check';

export type PrecheckPeriod = 'today' | '7d' | 'month';
export type PrecheckKind = 'all' | 'spam' | 'spell';
export const PRECHECK_PAGE_SIZE = 10;
/** 업체별 무료 한도 조회 동시 수(업체마다 조회 3개) */
const PRECHECK_COMPANY_CONCURRENCY = 4;

export interface PrecheckUsageQuery {
  period: PrecheckPeriod;
  kind: PrecheckKind;
  companyId: string | null;
  page: number;
}

/** 조회 조건 정규화 — 모르는 값은 기본값(오늘 · 전체 · 1쪽) · 회사 id는 uuid만 */
export function parsePrecheckUsageQuery(q: any): PrecheckUsageQuery {
  const period = (['today', '7d', 'month'] as const).find((p) => p === q?.period) ?? 'today';
  const kind = (['all', 'spam', 'spell'] as const).find((k) => k === q?.kind) ?? 'all';
  const companyId = isUuid(q?.companyId) ? String(q.companyId) : null;
  const n = Math.floor(Number(q?.page));
  return { period, kind, companyId, page: Number.isFinite(n) && n >= 1 ? n : 1 };
}

/** 기간 시작(한국 시각 자정 기준 · SQL 조각) — 최근 7일 = 오늘 포함 7일 */
export function precheckPeriodStartSql(period: PrecheckPeriod): string {
  const day = `date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul')`;
  if (period === '7d') return `(${day} - INTERVAL '6 days') AT TIME ZONE 'Asia/Seoul'`;
  if (period === 'month') return `(date_trunc('month', NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul'`;
  return `(${day}) AT TIME ZONE 'Asia/Seoul'`;
}

export type SpamBucket = 'paid' | 'trial' | 'auto';
/** 스팸 검사 구분 — 표시값 없는 옛 행 = manual = 유료(청구 판정 CT와 같은 규칙) */
export function spamSourceBucket(source: string | null | undefined): SpamBucket {
  if (source === SPAM_TRIAL_SOURCE) return 'trial';
  if (isAutoSpamSource(source)) return 'auto';
  return 'paid';
}

export function precheckSubLabel(kind: string, sub: string | null | undefined): string {
  if (kind === 'spam') {
    const b = spamSourceBucket(sub);
    return b === 'trial' ? '무료 체험' : b === 'auto' ? '자동' : '유료';
  }
  return sub === 'agency' ? '대행' : '직접발송';
}

export function precheckResultLabel(r: { kind: string; status: string | null; issues: number | null; blocked: boolean | null }): string {
  if (r.kind === 'spam') {
    if (r.status === 'active') return '진행 중';
    return r.blocked ? '차단 있음' : '완료';
  }
  if (r.status === 'failed') return '실패';
  if (r.status === 'reserved') return '진행 중';
  const n = Number(r.issues) || 0;
  return n > 0 ? `고칠 곳 ${n}` : '고칠 곳 없음';
}

/** 사용 기록 한 벌(세 원천 합치기) — $1 = 직접발송 맞춤법 source · $2 = 대행 맞춤법 이력 kind */
function eventsSql(startSql: string): string {
  return `
    SELECT 'spam'::text AS kind, COALESCE(t.source, 'manual')::text AS sub, t.company_id, t.user_id, t.created_at,
           t.status::text AS status, NULL::int AS issues, t.id::text AS ref_id
      FROM spam_filter_tests t
     WHERE t.created_at >= ${startSql}
    UNION ALL
    SELECT 'spell', 'direct', u.company_id, u.user_id, u.created_at, u.status::text, u.issue_count, u.id::text
      FROM spell_check_uses u
     WHERE u.source = $1 AND u.created_at >= ${startSql}
    UNION ALL
    SELECT 'spell', 'agency', r.company_id, r.created_by, e.created_at,
           CASE WHEN e.payload->>'failed' = 'true' THEN 'failed' ELSE 'done' END,
           CASE WHEN e.payload->>'failed' = 'true' THEN 0
                WHEN jsonb_typeof(e.payload->'count') = 'number' THEN (e.payload->>'count')::int ELSE 0 END,
           e.request_id::text
      FROM agency_send_events e
      JOIN agency_send_requests r ON r.id = e.request_id
     WHERE e.kind = $2 AND e.created_at >= ${startSql}`;
}

export interface PrecheckGroupRow {
  company_id: string;
  kind: string;
  sub: string;
  status: string;
  cnt: number;
  last_at: string;
}

export interface PrecheckSummary {
  total: number;
  spam: { total: number; paid: number; trial: number; auto: number };
  spell: { total: number; direct: number; agency: number; failed: number };
}

/** (순수) 요약 — 종류별·구분별 합 · 맞춤법 실패 */
export function summarizePrecheckGroups(rows: readonly PrecheckGroupRow[]): PrecheckSummary {
  const s: PrecheckSummary = {
    total: 0,
    spam: { total: 0, paid: 0, trial: 0, auto: 0 },
    spell: { total: 0, direct: 0, agency: 0, failed: 0 },
  };
  for (const r of rows) {
    const n = Number(r.cnt) || 0;
    s.total += n;
    if (r.kind === 'spam') {
      s.spam.total += n;
      s.spam[spamSourceBucket(r.sub)] += n;
    } else {
      s.spell.total += n;
      if (r.sub === 'agency') s.spell.agency += n; else s.spell.direct += n;
      if (r.status === 'failed') s.spell.failed += n;
    }
  }
  return s;
}

export interface PrecheckCompanyRow {
  companyId: string;
  spamPaid: number;
  spamTrial: number;
  spamAuto: number;
  spellDirect: number;
  spellAgency: number;
  lastAt: string;
}

/** (순수) 업체별 한 줄 — 최근 사용 순 */
export function buildPrecheckCompanyRows(rows: readonly PrecheckGroupRow[]): PrecheckCompanyRow[] {
  const acc = new Map<string, PrecheckCompanyRow>();
  for (const r of rows) {
    const n = Number(r.cnt) || 0;
    const row = acc.get(r.company_id) ?? {
      companyId: r.company_id, spamPaid: 0, spamTrial: 0, spamAuto: 0, spellDirect: 0, spellAgency: 0, lastAt: r.last_at,
    };
    if (r.kind === 'spam') {
      const b = spamSourceBucket(r.sub);
      if (b === 'trial') row.spamTrial += n; else if (b === 'auto') row.spamAuto += n; else row.spamPaid += n;
    } else if (r.sub === 'agency') row.spellAgency += n;
    else row.spellDirect += n;
    if (new Date(r.last_at).getTime() > new Date(row.lastAt).getTime()) row.lastAt = r.last_at;
    acc.set(r.company_id, row);
  }
  return [...acc.values()].sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

export async function loadPrecheckUsage(q: PrecheckUsageQuery) {
  const startSql = precheckPeriodStartSql(q.period);
  const params: any[] = [DIRECT_SPELL_SOURCE, AGENCY_SPELL_EVENT];
  let where = 'WHERE 1=1';
  if (q.kind !== 'all') { params.push(q.kind); where += ` AND ev.kind = $${params.length}`; }
  if (q.companyId) { params.push(q.companyId); where += ` AND ev.company_id = $${params.length}::uuid`; }
  const ev = `(${eventsSql(startSql)}) ev`;

  const grouped = await query(
    `SELECT ev.company_id, ev.kind, ev.sub, ev.status, COUNT(*)::int AS cnt, MAX(ev.created_at) AS last_at
       FROM ${ev} ${where}
      GROUP BY ev.company_id, ev.kind, ev.sub, ev.status`,
    params,
  );
  const groups: PrecheckGroupRow[] = grouped.rows;
  const summary = summarizePrecheckGroups(groups);
  const baseRows = buildPrecheckCompanyRows(groups);

  // 업체 이름 + 무료 한도(고객 화면과 같은 함수)
  const ids = baseRows.map((r) => r.companyId);
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const nr = await query(`SELECT id, company_name FROM companies WHERE id = ANY($1::uuid[])`, [ids]);
    for (const r of nr.rows as any[]) names.set(String(r.id), r.company_name);
  }
  const companies = await mapWithConcurrency(baseRows, PRECHECK_COMPANY_CONCURRENCY, async (r) => {
    const [ctx, trial, spell] = await Promise.all([
      loadPlanContext(r.companyId), readSpamTrialStatus(r.companyId), readSpellUsage(r.companyId),
    ]);
    const paid = isActivePaidPlan(ctx);
    return {
      ...r,
      companyName: names.get(r.companyId) || '(삭제된 고객사)',
      planName: ctx?.planName || '-',
      spamTrialEligible: trial.eligible,
      spamTrialUsed: trial.used,
      spamTrialLimit: trial.limit,
      spellUnlimited: paid,
      spellUsedThisMonth: spell.usedThisMonth,
      spellMonthlyLimit: paid ? null : SPELL_FREE_MONTHLY_LIMIT,
    };
  });

  const offset = (q.page - 1) * PRECHECK_PAGE_SIZE;
  const list = await query(
    `SELECT ev.kind, ev.sub, ev.status, ev.issues, ev.created_at, ev.ref_id, c.company_name, u.name AS user_name, u.login_id AS user_login,
            CASE WHEN ev.kind = 'spam' THEN EXISTS (
              SELECT 1 FROM spam_filter_test_results x WHERE x.test_id = ev.ref_id::uuid AND x.result = 'blocked'
            ) END AS blocked
       FROM ${ev}
       JOIN companies c ON c.id = ev.company_id
       LEFT JOIN users u ON u.id = ev.user_id
      ${where}
      ORDER BY ev.created_at DESC
      LIMIT ${PRECHECK_PAGE_SIZE} OFFSET ${offset}`,
    params,
  );
  const recent = (list.rows as any[]).map((r) => ({
    createdAt: r.created_at,
    companyName: r.company_name,
    userName: r.user_name || null,
    userLogin: r.user_login || null,
    kind: r.kind as 'spam' | 'spell',
    kindLabel: r.kind === 'spam' ? '스팸 검사' : '맞춤법',
    subLabel: precheckSubLabel(r.kind, r.sub),
    trial: r.kind === 'spam' && spamSourceBucket(r.sub) === 'trial',
    resultLabel: precheckResultLabel({ kind: r.kind, status: r.status, issues: r.issues, blocked: r.blocked }),
    // ★ 2026-09-28 상세 창 — 어느 원천의 몇 번 기록인가(스팸 = 검사 id · 직접발송 = 기록 id · 대행 = 접수 id)
    detailType: precheckDetailType(r.kind, r.sub),
    ref: r.ref_id ? String(r.ref_id) : null,
  }));

  return {
    period: q.period,
    summary,
    trialExhausted: companies.filter((c) => c.spamTrialEligible && c.spamTrialUsed >= c.spamTrialLimit).length,
    spellExhausted: companies.filter((c) => c.spellMonthlyLimit != null && c.spellUsedThisMonth >= c.spellMonthlyLimit).length,
    companies,
    recent,
    total: summary.total,
    page: q.page,
    totalPages: Math.max(1, Math.ceil(summary.total / PRECHECK_PAGE_SIZE)),
  };
}

// ─────────────── ★ 2026-09-28 사용 기록 상세 (Harold 지시 · ceo 전용 · 읽기만) ───────────────
// 목록 한 줄 → 그 기록의 문안과 결과. 스팸 검사 = 통신사별 결과 · 맞춤법 = 고칠 곳(검사가 제안한 내용).
// ⛔ 직접발송 맞춤법의 문안·고칠 곳은 0928부터 저장한다(`recordSpellDetail`) — 그 전 기록은 개수만 있다(stored=false).

export type PrecheckDetailType = 'spam' | 'spell_direct' | 'spell_agency';

/** (순수) 목록 줄의 종류·구분 → 상세 종류 */
export function precheckDetailType(kind: string, sub: string | null | undefined): PrecheckDetailType {
  if (kind === 'spam') return 'spam';
  return sub === 'agency' ? 'spell_agency' : 'spell_direct';
}

/** (순수) 상세 조회 조건 — 스팸·대행 = uuid · 직접발송 = 숫자 id. 그 밖은 null(라우트가 400) */
export function parsePrecheckDetailQuery(q: any): { type: PrecheckDetailType; ref: string } | null {
  const type = (['spam', 'spell_direct', 'spell_agency'] as const).find((t) => t === q?.type);
  const ref = typeof q?.ref === 'string' ? q.ref : '';
  if (!type || !ref) return null;
  if (type === 'spell_direct') return /^\d{1,18}$/.test(ref) ? { type, ref } : null;
  return isUuid(ref) ? { type, ref } : null;
}

export interface SpamResultCell { label: string; tone: 'pass' | 'blocked' | 'fail' | 'pending'; receivedAt: string | null }
export interface SpamResultGrid {
  types: string[];
  rows: { carrier: string; cells: Record<string, SpamResultCell | null> }[];
  total: number;
  pass: number;
  blocked: number;
}

const SPAM_CARRIER_ORDER = ['SKT', 'KT', 'LGU'];
const SPAM_TYPE_ORDER = ['SMS', 'LMS'];
const orderOf = (list: string[], v: string) => { const i = list.indexOf(v); return i < 0 ? list.length : i; };

/** (순수) 통신사 × 종류 결과표. 이름표·색 = 결과 CT(`getSpamResultLabel`·`getSpamResultType`) 그대로 */
export function buildSpamResultGrid(results: readonly any[]): SpamResultGrid {
  const types = [...new Set(results.map((r) => String(r.message_type)))]
    .sort((a, b) => orderOf(SPAM_TYPE_ORDER, a) - orderOf(SPAM_TYPE_ORDER, b) || a.localeCompare(b));
  const carriers = [...new Set(results.map((r) => String(r.carrier)))]
    .sort((a, b) => orderOf(SPAM_CARRIER_ORDER, a) - orderOf(SPAM_CARRIER_ORDER, b) || a.localeCompare(b));
  const rows = carriers.map((carrier) => {
    const cells: Record<string, SpamResultCell | null> = {};
    for (const t of types) {
      const hit = results.find((r) => String(r.carrier) === carrier && String(r.message_type) === t);
      cells[t] = hit
        ? { label: getSpamResultLabel(hit.result), tone: getSpamResultType(hit.result), receivedAt: hit.received_at ?? null }
        : null;
    }
    return { carrier, cells };
  });
  return {
    types,
    rows,
    total: results.length,
    pass: results.filter((r) => getSpamResultType(r.result) === 'pass').length,
    blocked: results.filter((r) => getSpamResultType(r.result) === 'blocked').length,
  };
}

/** (순수) 저장된 고칠 곳(jsonb) → 표시할 항목. 배열이 아니면 null · 모양이 틀린 항목은 뺀다 */
export function readStoredSpellIssues(raw: unknown): SpellIssue[] | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!Array.isArray(v)) return null;
  return v.filter((i: any) => i && typeof i === 'object'
    && typeof i.before === 'string' && typeof i.after === 'string'
    && Number.isInteger(i.start) && Number.isInteger(i.end)) as SpellIssue[];
}

/** 상세 한 건. 없는 기록 = null. 직접발송 칸이 아직 없으면(ALTER 전) 42703 을 던진다 → 라우트가 503 */
export async function loadPrecheckDetail(q: { type: PrecheckDetailType; ref: string }) {
  if (q.type === 'spam') {
    const t = await query(
      `SELECT callback_number, message_content_sms, message_content_lms, subject, status
         FROM spam_filter_tests WHERE id = $1::uuid`,
      [q.ref],
    );
    const test = t.rows[0];
    if (!test) return null;
    const r = await query(
      `SELECT carrier, message_type, received, received_at, result
         FROM spam_filter_test_results WHERE test_id = $1::uuid`,
      [q.ref],
    );
    return {
      type: 'spam' as const,
      callbackNumber: test.callback_number || null,
      sms: test.message_content_sms || null,
      lms: test.message_content_lms || null,
      subject: test.subject || null,
      status: String(test.status || ''),
      grid: buildSpamResultGrid(r.rows),
    };
  }

  if (q.type === 'spell_direct') {
    const u = await query(
      `SELECT status, issue_count, checked_text, issues
         FROM spell_check_uses WHERE id = $1::bigint AND source = $2`,
      [q.ref, DIRECT_SPELL_SOURCE],
    );
    const row = u.rows[0];
    if (!row) return null;
    const text: string | null = typeof row.checked_text === 'string' ? row.checked_text : null;
    return {
      type: 'spell_direct' as const,
      status: String(row.status || ''),
      issueCount: Number(row.issue_count) || 0,
      stored: text != null,
      text,
      issues: text != null ? readStoredSpellIssues(row.issues) : null,
    };
  }

  const a = await query(
    `SELECT message_type, subject, current_content, content_version, spell_check
       FROM agency_send_requests WHERE id = $1::uuid`,
    [q.ref],
  );
  const req = a.rows[0];
  if (!req) return null;
  // 결과를 쓸 수 있는지는 대행 CT(`readAgencySpell`)가 정한다. 못 쓰면 그 이유만 여기서 가른다(표시용).
  const issues = readAgencySpell(req);
  const raw: any = req.spell_check;
  const state: 'ok' | 'changed' | 'failed' | 'missing' = issues
    ? 'ok'
    : !raw || typeof raw !== 'object' ? 'missing' : raw.failed === true ? 'failed' : 'changed';
  return {
    type: 'spell_agency' as const,
    messageType: String(req.message_type || ''),
    subject: req.subject || null,
    text: String(req.current_content ?? ''),
    state,
    issues,
    checkedAt: raw && typeof raw === 'object' && typeof raw.checkedAt === 'string' ? raw.checkedAt : null,
  };
}
