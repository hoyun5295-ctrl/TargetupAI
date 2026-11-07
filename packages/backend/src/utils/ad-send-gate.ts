/**
 * CT: ad-send-gate.ts — 광고 관문(전체 대조군 · 발송별 대조군 · 우선순위) 판정 · 원장 · 연결(★ 2026-11-06 C110 · ★ 2026-11-07 C113 두 길)
 *
 * 설계서 = docs/2026-11-06-c110-effect-proof-priority-design.md §3 · §4 · docs/2026-11-07-c113-structure-fix-design.md §2-P(D23).
 *  - 두 길: 입구마다 resolveAdGateMode 한 번 → 옛 길(legacy) = 그 입구의 HEAD 코드 그대로(관문 · 원장 0) · 관문 길(gate) = 요금제 씀 + 새 기능 켬,
 *    또는 그 묶음에 발송별 대조군 앞 배정이 있음 · 확인 못 함. 정책 조회 실패 = 옛 길 + 장애 줄 최선 노력(미리보기 dry = 장애 줄 0).
 *  - 관문은 피로도를 보지 않는다(피로도 = 입구마다 HEAD 피로도 블록 · fatigue-guard.ts 그대로).
 *  - 판정 순서(번호마다 처음 걸린 이유 하나) = 0 적격(적재 표 = 중복 · 수신거부 거름 뒤 번호만) → 1 전체 대조군 → 2 우선순위 →
 *    3 발송별 대조군(남은 번호에서 마지막 · 묶음당 한 번 추첨 · 받는 쪽도 원장).
 *  - 우선순위 = 판정과 예약이 한 트랜잭션 · 회사 · 날 advisory 잠금(날짜 오름차순) · 예약의 살아 있음 = 이어진 캠페인이 있고 취소가 아님,
 *    또는 이어지지 않은(이어진 캠페인이 없는) 줄의 2시간.
 *  - 관문 길 판정 실패 = 새 기능 없이 통과 + 장애 줄을 발송 전에 · 장애 줄도 못 쓰면 던짐(발송 멈춤 · 관문 길은 늘 새 기능 · 앞 배정이 걸린 길).
 */
import { pool, query } from '../config/database';
import { normalizePhone } from './normalize-phone';
import { UserFacingError } from './http-error';
import { ACTIVE_PAID_PLAN_WHERE } from './plan-guard';
import { parkStagingPhones } from './staging-sweeper';
import { uuidLockKey } from './keyed-lock';
import { parseSplitSetting, resolveSplitFirstSend, splitSendTime } from './send-time-util';
import {
  AdBranch, AdExcludeReason, AdGateCounts, emptyAdGateCounts, normalizePriorityOrder, normalizeHoldoutPct,
  higherBranches, campaignHoldoutDrawable, AD_RESERVATION_UNCONFIRMED_HOURS, kstDaysInSpan, buildAdGateSettingsUpdate,
} from './ad-send-gate-core';

export interface AdGatePolicy {
  companyId: string;
  globalPct: number;
  campaignPct: number;
  priority: AdBranch[] | null;
  /** C110-DDL-1 이 다 있고 요금제를 쓰는가(★ C113 D1 · 거짓 = 새 기능 꺼짐 · 새 표 접근 0) */
  ready: boolean;
}

/** 관문 장애 줄도 못 쓴 발송 = 멈춤(돈 0) · 공용 사용자 오류(503 · 고정 문장 · respondUserError 가 그대로 돌려준다) */
export const AD_GATE_UNAVAILABLE_TEXT = '광고 발송 확인을 마치지 못해 이번 발송을 멈췄습니다. 잠시 뒤 다시 시도해 주세요.';
export class AdGateUnavailableError extends UserFacingError {
  constructor() { super(503, 'AD_GATE_UNAVAILABLE', AD_GATE_UNAVAILABLE_TEXT); this.name = 'AdGateUnavailableError'; }
}

// ── 스키마 준비 판정(5분 기억) ───────────────────────────────────────────

let readyCache: { at: number; ok: boolean } | null = null;
let lastNotReadyWarn = 0;
const READY_TTL_MS = 5 * 60 * 1000;

/**
 * C110-DDL-1 의 회사 네 칸 · 원장 · 장애 표가 다 있는가(★ C113 구현 1R #8) — 있음 · 없음만 5분 기억 · 조회 오류 = 던짐(기억 0).
 *   판정 · 원장 쓰기가 부른다(오류를 「없음」으로 읽어 관문을 5분 끄는 길 0 · 오류는 부르는 곳의 장애 갈래로).
 */
async function schemaState(): Promise<'ready' | 'absent'> {
  if (readyCache && Date.now() - readyCache.at < READY_TTL_MS) return readyCache.ok ? 'ready' : 'absent';
  const r = await query(
    `SELECT (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = current_schema() AND table_name = 'companies'
                 AND column_name IN ('global_holdout_pct', 'global_holdout_since', 'campaign_holdout_pct', 'send_priority_order'))::int AS cols,
            (SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = current_schema() AND table_name IN ('ad_send_marks', 'ad_gate_failures'))::int AS tabs`,
  );
  const ok = Number(r.rows[0]?.cols) === 4 && Number(r.rows[0]?.tabs) === 2;
  readyCache = { at: Date.now(), ok };
  if (!ok && Date.now() - lastNotReadyWarn > READY_TTL_MS) {
    lastNotReadyWarn = Date.now();
    console.warn('[ad-send-gate] C110-DDL-1 전 — 대조군 · 우선순위 꺼짐 · 피로도만 판정');
  }
  return ok ? 'ready' : 'absent';
}

/** 화면 · 설정 저장이 읽는 준비 여부 — 조회 오류 = 거짓(기억 0 · 경고 · 다음 호출이 다시 본다) */
export async function adGateSchemaReady(): Promise<boolean> {
  try {
    return (await schemaState()) === 'ready';
  } catch (e: any) {
    console.warn('[ad-send-gate] 스키마 확인 실패(이번 조회만 꺼짐):', e?.message);
    return false;
  }
}

/** 시험 · 배포 직후 다시 보게 */
export function resetAdGateSchemaCache(): void { readyCache = null; }

type PolicyRead = { ok: true; policy: AdGatePolicy } | { ok: false; err: unknown };

/** 정책 읽기 한 곳(★ C113 D1 · 읽기만) — 스키마 없음 · 요금제 안 씀(미가입 · FREE · 만료 · 정지) = 꺼짐 · 조회 오류 = ok 거짓 */
async function readPolicy(companyId: string): Promise<PolicyRead> {
  const off: AdGatePolicy = { companyId, globalPct: 0, campaignPct: 0, priority: null, ready: false };
  try {
    // ① 요금제 = 옛 칸만(미가입 · FREE · 만료 · 정지 = 이 조회 하나로 옛 길 · 스키마 · 새 칸 조회 0 · ★ C113 구현 2R #1)
    const plan = await query(
      `SELECT COALESCE((SELECT ${ACTIVE_PAID_PLAN_WHERE} FROM plans p WHERE p.id = c.plan_id), false) AS paid FROM companies c WHERE c.id = $1::uuid`,
      [companyId],
    );
    if (plan.rows[0]?.paid !== true) return { ok: true, policy: off };
    // ② 요금제 씀 = 새 칸 · 표가 있나(5분 기억) → 네 칸
    if ((await schemaState()) !== 'ready') return { ok: true, policy: off };
    const r = await query(
      `SELECT global_holdout_pct, global_holdout_since, campaign_holdout_pct, send_priority_order FROM companies WHERE id = $1::uuid`,
      [companyId],
    );
    const row = r.rows[0];
    if (!row) return { ok: true, policy: off };
    return {
      ok: true,
      policy: {
        companyId, ready: true,
        globalPct: row.global_holdout_since ? normalizeHoldoutPct(row.global_holdout_pct, 10) : 0,
        campaignPct: normalizeHoldoutPct(row.campaign_holdout_pct, 30),
        priority: normalizePriorityOrder(row.send_priority_order),
      },
    };
  } catch (err) {
    return { ok: false, err };
  }
}

/**
 * 요금제 · 구독 상태 쓰기 바로 뒤(같은 연결 · 같은 트랜잭션) — 그 순간 요금제를 안 쓰면 대조군 · 우선순위 네 칸을 비운다(★ C113 D2).
 *   옛 시작일 · 비율이 유료 복구 때 살아나는 길 0 · 관문은 읽기만. 스키마 없음 = 무동작 · 저장점 안 · 실패 = 저장점으로 되돌리고 경고(요금제 쓰기는 그대로).
 */
export async function endAdGateIfUnpaid(client: { query: (text: string, params?: any[]) => Promise<any> }, companyId: string): Promise<void> {
  if ((await schemaState().catch(() => 'ready' as const)) !== 'ready') return;   // 확인 오류 = 비우기를 해 본다(저장점 안 · 칸이 없으면 되돌림 · 구현 1R #8)
  const sql = `UPDATE companies c
                  SET global_holdout_pct = NULL, global_holdout_since = NULL, campaign_holdout_pct = NULL, send_priority_order = NULL
                WHERE c.id = $1::uuid
                  AND NOT COALESCE((SELECT ${ACTIVE_PAID_PLAN_WHERE} FROM plans p WHERE p.id = c.plan_id), false)
                  AND (c.global_holdout_pct IS NOT NULL OR c.global_holdout_since IS NOT NULL OR c.campaign_holdout_pct IS NOT NULL OR c.send_priority_order IS NOT NULL)`;
  let savepoint = false;
  try {
    await client.query('SAVEPOINT end_ad_gate');
    savepoint = true;
  } catch { /* 트랜잭션 밖 = 저장점 없이 한 문장 */ }
  try {
    await client.query(sql, [companyId]);
    if (savepoint) await client.query('RELEASE SAVEPOINT end_ad_gate');
  } catch (err: any) {
    if (savepoint) await client.query('ROLLBACK TO SAVEPOINT end_ad_gate').catch(() => undefined);
    console.warn(`[ad-send-gate] 요금제 끝 대조군 · 우선순위 비우기 실패 company=${companyId} (요금제 쓰기는 그대로):`, err?.message || err);
  }
}

/** 화면 · 효과 증명이 읽는 정책(조회 오류 = 꺼짐) */
export async function loadAdGatePolicy(companyId: string): Promise<AdGatePolicy> {
  const r = await readPolicy(companyId);
  if (r.ok) return r.policy;
  console.warn(`[ad-send-gate] 정책 읽기 실패 company=${companyId} (꺼짐):`, (r.err as any)?.message);
  return { companyId, globalPct: 0, campaignPct: 0, priority: null, ready: false };
}

function policyHasNew(p: AdGatePolicy): boolean {
  return p.ready && (p.globalPct > 0 || p.campaignPct > 0 || p.priority !== null);
}

/** 그 묶음에 발송별 대조군 배정이 이미 있나(설정을 꺼도 첫 배정은 지킨다 · 구현 1R #6) · 조회 오류 = 던짐(호출부가 장애 처리 · 구현 2R #6) */
async function hasPriorArms(p: AdGatePolicy, batchId: string): Promise<boolean> {
  if (!p.ready) return false;
  const r = await query(
    `SELECT 1 FROM ad_send_marks WHERE batch_id = $1::uuid AND company_id = $2::uuid AND kind IN ('campaign_holdout', 'campaign_treated') LIMIT 1`,
    [batchId, p.companyId],
  );
  return r.rows.length > 0;
}

/** 그 묶음에 원장 줄이 이미 있나(장애 갈래의 잇기 판단 · 판정 성공 여부와 분리 · ★ 구현 7R) · 조회 실패 = 거짓(그 DB 로는 잇기도 못 한다) */
async function batchHasMarks(p: AdGatePolicy, batchId: string): Promise<boolean> {
  if (!p.ready) return false;
  try {
    const r = await query(`SELECT 1 FROM ad_send_marks WHERE batch_id = $1::uuid AND company_id = $2::uuid LIMIT 1`, [batchId, p.companyId]);
    return r.rows.length > 0;
  } catch {
    return false;
  }
}

/** 정책 조회 실패 = 장애 줄 최선 노력(그 기간 측정 보류 · 못 써도 발송 계속 = 옛 길 · ★ C113 D5 · D23) */
async function recordPolicyFailure(companyId: string, err: unknown): Promise<void> {
  console.warn(`[ad-send-gate] 정책 조회 실패 company=${companyId} — 옛 길로 진행:`, (err as any)?.message || err);
  try {
    await query(`INSERT INTO ad_gate_failures (company_id, branch, error) VALUES ($1::uuid, 'policy', $2)`, [companyId, String((err as any)?.message || err).slice(0, 200)]);
  } catch (e: any) {
    console.error(`[ad-send-gate] 정책 장애 줄 기록 실패 company=${companyId}:`, e?.message || e);
  }
}

export type AdGateMode = { mode: 'legacy' } | { mode: 'gate'; policy: AdGatePolicy };

/**
 * 두 길 판정(★ C113 D23) — 입구마다 한 번.
 *   정책 조회 실패 · 요금제 안 씀 · 스키마 없음 = 옛 길 · 새 기능 켬 = 관문 길 ·
 *   끔 + priorArmsPossible + 묶음 = 앞 배정 조회(있음 · 확인 못 함 = 관문 길 · 없음 = 옛 길).
 *   dry = 읽기만 하는 미리보기(정책 조회 실패에 장애 줄 0 · 5R #2 · 길 판정은 같다).
 */
export async function resolveAdGateMode(
  companyId: string,
  opts: { batchId?: string | null; priorArmsPossible?: boolean; dry?: boolean } = {},
): Promise<AdGateMode> {
  const read = await readPolicy(companyId);
  if (!read.ok) {
    if (!opts.dry) void recordPolicyFailure(companyId, read.err);   // 기다리지 않음(옛 길 = 시간까지 그대로 · 던지지 않는 함수 · 구현 1R)
    return { mode: 'legacy' };
  }
  const policy = read.policy;
  if (!policy.ready) return { mode: 'legacy' };
  if (policyHasNew(policy)) return { mode: 'gate', policy };
  if (!opts.priorArmsPossible || !opts.batchId) return { mode: 'legacy' };
  try {
    return (await hasPriorArms(policy, opts.batchId)) ? { mode: 'gate', policy } : { mode: 'legacy' };
  } catch {
    return { mode: 'gate', policy };   // 확인 못 함 = 관문 길(첫 배정을 지키지 못하면 판정 · 장애 줄로 · ★ 3R #4)
  }
}

// ── 판정 ────────────────────────────────────────────────────────────────

export interface AdGateInput {
  branch: AdBranch;
  /** 나가는 날(KST 'YYYY-MM-DD') — 분할 · 예약이면 첫날 ~ 마지막 날 · 없으면 오늘 */
  span?: { from: string; to: string } | null;
  /** 발송별 대조군 추첨 열쇠(없으면 발송별 대조군 안 걸림 · 여정) */
  holdoutKey?: string | null;
  /** 원장 묶음(uuid) */
  batchId: string;
  /** 통과 번호 예약(우선순위 켠 회사만 · 확정 판정 = true · 미리보기 · 한줄로 적재 = false) */
  reserve: boolean;
  /**
   * 분할 발송 = 통과 인원으로 예약 날을 다시 계산한다(★ 구현 2R #5 · 판정은 관문 전 인원의 span = 넓거나 같다 = 덜 보내는 쪽 ·
   * 예약은 실제로 나갈 날에만). 없으면 span 그대로.
   */
  spanForCount?: (passedCount: number) => { from: string; to: string };
  /**
   * spanForCount 에 넘길 수 = 실제 적재 · 차감 수(★ 구현 3R) — 배열 경로 = 호출부가 통과 번호로 원본 행을 센다(중복 제거를 끈 발송 = 행 수) ·
   * 없으면 통과 번호 수. 적재 표 경로는 gateStaging 의 countRows 가 정한다.
   */
  sendCountOf?: (passedPhones: string[]) => number | Promise<number>;
  /** 빠짐 줄을 원장에 쓰나(기본 참 · 여정 = 거짓 = 예약만 · ★ C113 D13 · R1) */
  recordExclusions?: boolean;
}

export interface AdGateResult {
  /** 빠진 번호(정규화) → 이유 */
  excluded: Map<string, AdExcludeReason>;
  counts: AdGateCounts;
  /** 판정이 실패해 새 기능 없이 통과시킨 경우(장애 줄 남김) */
  degraded: boolean;
  /**
   * 이번 판정이 원장 줄을 썼나(빠짐 · 받는 쪽 · 예약 · ★ 1106 Harold 「미가입자는 관계가 없어야」) — 거짓이면 호출부는 원장 잇기를 하지 않는다
   * = 대조군 · 우선순위를 안 쓰는 회사의 발송은 잇기 UPDATE 를 타지 않는다(그 UPDATE 의 실패가 그 회사 발송을 멈추지 않는다).
   */
  marked: boolean;
  /** 적재 표 경로 = 빠진 번호의 적재 행 수(같은 번호 여러 행 포함 · 중복 제거를 끈 미리보기가 쓴다 · 구현 1R #7) */
  excludedRows?: number;
  /** 보관 칸 판정에서 판정 대상이 전부 빠졌다(행을 옮기지 않음 · 호출부 = 바로 「대상 없음」 · ★ C113 구현 1R #6) */
  allExcluded?: boolean;
}

const toKstDay = (d: Date): string => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

/**
 * 직접 발송 배관의 나가는 날 span(★ 구현 1R #5) — 분할이면 첫 차수 ~ 마지막 차수(총 건수 기준)의 날 · 아니면 예약일(없으면 오늘).
 *   분할 시각 계산 = send-time-util 한 곳(동기 /direct-send · commit · 처리기와 같은 함수).
 */
export function directSendSpanFor(
  input: { scheduled?: unknown; scheduledAt?: string | Date | null; splitEnabled?: unknown; splitCount?: unknown; splitIntervalMinutes?: unknown },
): (count: number) => { from: string; to: string } {
  return (count: number) => directSendSpanOf(input, count);
}

export function directSendSpanOf(
  input: { scheduled?: unknown; scheduledAt?: string | Date | null; splitEnabled?: unknown; splitCount?: unknown; splitIntervalMinutes?: unknown },
  total: number,
): { from: string; to: string } {
  const parsed = parseSplitSetting(input.splitEnabled, input.splitCount, input.splitIntervalMinutes);
  const split = parsed.ok ? parsed.split : null;
  if (!split) return sendSpanOf(input.scheduled ? (input.scheduledAt as any) : null);
  const first = resolveSplitFirstSend({ scheduled: input.scheduled, scheduledAt: input.scheduledAt ?? null, split });
  const base = first.scheduled && first.scheduledAt ? new Date(first.scheduledAt) : new Date();
  return sendSpanOf(splitSendTime(base, 0, split), splitSendTime(base, Math.max(0, total - 1), split));
}

/** 나가는 날(KST) span — 첫 발송 시각(예약 · 없거나 지난 시각이면 지금) ~ 마지막(분할 끝 · 없으면 첫날) */
export function sendSpanOf(firstAt?: Date | string | null, lastAt?: Date | string | null): { from: string; to: string } {
  const now = new Date();
  const f = firstAt ? new Date(firstAt) : now;
  const first = Number.isNaN(f.getTime()) || f < now ? now : f;
  const l = lastAt ? new Date(lastAt) : first;
  const last = Number.isNaN(l.getTime()) || l < first ? first : l;
  return { from: toKstDay(first), to: toKstDay(last) };
}

function spanDays(span: AdGateInput['span']): { from: string; to: string; days: string[] } {
  const today = toKstDay(new Date());
  const from = span?.from && /^\d{4}-\d{2}-\d{2}$/.test(span.from) ? span.from : today;
  const to = span?.to && /^\d{4}-\d{2}-\d{2}$/.test(span.to) && span.to >= from ? span.to : from;
  return { from, to, days: kstDaysInSpan(from, to) };
}

/** 32비트 해시 칸(0 ~ 9999) — SQL 하나(holdoutBucketSql)로만 계산한다 */
export function holdoutBucketSql(saltExpr: string, phoneExpr: string): string {
  return `((('x' || substr(md5(${saltExpr} || ':' || ${phoneExpr}), 1, 8))::bit(32)::bigint) % 10000)`;
}

export type Run = (text: string, params?: any[]) => Promise<any>;

/**
 * 핵심 판정(트랜잭션 안) — 후보 번호(정규화 · 중복 없음)마다 이유 하나 · 발송별 추첨 · 원장 · 예약.
 * write = false 면 원장 · 예약을 쓰지 않는다(미리보기).
 */
async function judge(run: Run, policy: AdGatePolicy, input: AdGateInput, phones: string[], exempt: Set<string>, write: boolean)
  : Promise<{ excluded: Map<string, AdExcludeReason>; treated: string[]; passed: string[]; marked: boolean }> {
  const { from, days } = spanDays(input.span);
  const higher = policy.priority ? higherBranches(policy.priority, input.branch) : [];
  // 1 전체 대조군 · 2 우선순위 + 발송별 해시 칸 — 한 문장(피로도 = 입구의 HEAD 블록 · ★ C113 D23)
  const r = await run(
    `WITH co AS (
       SELECT id::text || ':' || to_char(global_holdout_since AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS') AS salt FROM companies WHERE id = $1::uuid
     ), cand AS (
       SELECT u.phone, u.phone = ANY($3::text[]) AS exempt FROM unnest($2::text[]) AS u(phone)
     )
     SELECT c.phone,
            CASE
              WHEN $4::int > 0 AND co.salt IS NOT NULL AND ${holdoutBucketSql('co.salt', 'c.phone')} < $4::int * 100 THEN 'global_holdout'
              WHEN NOT c.exempt AND cardinality($5::text[]) > 0 AND EXISTS (
                     SELECT 1 FROM ad_send_marks rv
                      WHERE rv.company_id = $1::uuid AND rv.kind = 'reserved' AND rv.phone = c.phone
                        AND rv.send_day = ANY($6::date[]) AND rv.branch = ANY($5::text[])
                        AND ((rv.campaign_id IS NOT NULL AND EXISTS (SELECT 1 FROM campaigns lc WHERE lc.id = rv.campaign_id AND lc.status <> 'cancelled'))
                             OR ((rv.campaign_id IS NULL OR NOT EXISTS (SELECT 1 FROM campaigns lo WHERE lo.id = rv.campaign_id))
                                 AND rv.created_at > NOW() - make_interval(hours => $7::int)))) THEN 'priority'
            END AS reason,
            CASE WHEN $8::text IS NOT NULL THEN ${holdoutBucketSql('$8::text', 'c.phone')} END AS cbucket
       FROM cand c LEFT JOIN co ON true`,
    [
      policy.companyId, phones, [...exempt],
      policy.ready ? policy.globalPct : 0,
      policy.ready ? higher : [], days, AD_RESERVATION_UNCONFIRMED_HOURS,
      policy.ready && input.holdoutKey ? String(input.holdoutKey) : null,
    ],
  );
  const excluded = new Map<string, AdExcludeReason>();
  const remaining: Array<{ phone: string; bucket: number }> = [];
  for (const row of r.rows as any[]) {
    if (row.reason) excluded.set(String(row.phone), row.reason as AdExcludeReason);
    else remaining.push({ phone: String(row.phone), bucket: row.cbucket == null ? -1 : Number(row.cbucket) });
  }

  // 4 발송별 대조군 — 묶음당 한 번(이미 뽑은 표시가 있으면 지금 설정과 무관하게 그대로 · Codex 설계 2R #4 · 구현 1R #6)
  //   현재 비율 · 추첨 하한(D11)은 첫 추첨 때만 쓴다(비율을 꺼도 이미 뽑힌 대조군은 계속 뺀다)
  let treated: string[] = [];
  if (policy.ready && input.holdoutKey) {
    const prior = await run(
      `SELECT phone, kind FROM ad_send_marks WHERE batch_id = $1::uuid AND company_id = $2::uuid AND kind IN ('campaign_holdout', 'campaign_treated')`,
      [input.batchId, policy.companyId],
    );
    if (prior.rows.length > 0) {
      const arm = new Map<string, string>(prior.rows.map((x: any) => [String(x.phone), String(x.kind)]));
      for (const x of remaining) {
        if (arm.get(x.phone) === 'campaign_holdout') excluded.set(x.phone, 'campaign_holdout');
      }
      // 첫 추첨 뒤 새로 들어온 번호 = 보내되 원장에 안 적는다(측정 무리 밖)
    } else if (policy.campaignPct > 0 && campaignHoldoutDrawable(remaining.length, policy.campaignPct)) {
      for (const x of remaining) {
        if (x.bucket >= 0 && x.bucket < policy.campaignPct * 100) excluded.set(x.phone, 'campaign_holdout');
        else treated.push(x.phone);
      }
    }
  }
  const passed = phones.filter((p) => !excluded.has(p));
  if (!write) return { excluded, treated, passed, marked: false };

  // 원장 — 빠짐 · 받는 쪽 · 예약(우선순위 켠 회사만 · 날마다)
  const day0 = days[0] || from;
  const marks: Array<[string, string, string]> = [];
  if (input.recordExclusions !== false) for (const [phone, reason] of excluded) marks.push([phone, reason, day0]);
  for (const phone of treated) marks.push([phone, 'campaign_treated', day0]);
  if (input.reserve && policy.ready && policy.priority) {
    const sendCount = input.sendCountOf ? await input.sendCountOf(passed) : passed.length;
    const reserveDays = input.spanForCount ? spanDays(input.spanForCount(sendCount)).days : days;
    for (const phone of passed) for (const d of reserveDays) marks.push([phone, 'reserved', d]);
  }
  const CHUNK = 10000;
  for (let i = 0; i < marks.length; i += CHUNK) {
    const part = marks.slice(i, i + CHUNK);
    await run(
      `INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day)
       SELECT $1::uuid, $2::uuid, $3, m.kind, m.phone, m.day
         FROM unnest($4::text[], $5::text[], $6::date[]) AS m(phone, kind, day)
       ON CONFLICT DO NOTHING`,
      [policy.companyId, input.batchId, input.branch, part.map((m) => m[0]), part.map((m) => m[1]), part.map((m) => m[2])],
    );
  }
  // 이번에 쓴 줄이 없어도 그 묶음에 앞 시도(한줄로 적재 load · 재시도)의 줄이 있으면 잇는다
  if (marks.length > 0) return { excluded, treated, passed, marked: true };
  const any = await run(`SELECT 1 FROM ad_send_marks WHERE batch_id = $1::uuid AND company_id = $2::uuid LIMIT 1`, [input.batchId, policy.companyId]);
  return { excluded, treated, passed, marked: any.rows.length > 0 };
}

function countOf(excluded: Map<string, AdExcludeReason>): AdGateCounts {
  const c = emptyAdGateCounts();
  for (const r of excluded.values()) c[r]++;
  return c;
}

/** 같은 회사 · 날 잠금(날짜 오름차순 · 우선순위 켠 회사만) */
async function lockDays(run: Run, policy: AdGatePolicy, input: AdGateInput): Promise<void> {
  if (!(policy.ready && policy.priority)) return;
  for (const d of spanDays(input.span).days) {
    await run(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`adgate:${policy.companyId}:${d}`]);
  }
}

/** 장애 줄 — 발송을 계속하기 전에 쓴다 · 못 쓰면 던진다(기록 없는 우회 발송 0 · Codex 설계 2R #5) */
async function recordGateFailure(policy: AdGatePolicy, branch: AdBranch, err: any): Promise<void> {
  try {
    await query(
      `INSERT INTO ad_gate_failures (company_id, branch, error) VALUES ($1::uuid, $2, $3)`,
      [policy.companyId, branch, String(err?.message || err).slice(0, 200)],
    );
  } catch (e: any) {
    console.error(`[ad-send-gate] 장애 줄 기록 실패 company=${policy.companyId} — 발송 멈춤:`, e?.message);
    throw new AdGateUnavailableError();
  }
  console.warn(`[ad-send-gate] 판정 실패 company=${policy.companyId} branch=${branch} — 새 기능 없이 진행:`, err?.message);
}

const passAll = (degraded: boolean): AdGateResult => ({ excluded: new Map(), counts: emptyAdGateCounts(), degraded, marked: false, excludedRows: 0 });

/**
 * 배열 경로(AI 캠페인 · 직접 동기 · 자동 캠페인 · 여정 · 브랜드) — 호출부가 이미 거른 번호 목록 · 관문 길(resolveAdGateMode 의 gate)에서만 부른다.
 * exemptPhones = 우선순위 면제(직접 동기 · 브랜드의 고객 DB id 없는 번호 · D12).
 */
export async function gatePhones(policy: AdGatePolicy, input: AdGateInput, rawPhones: string[], exemptPhones?: Iterable<string>): Promise<AdGateResult> {
  const phones = Array.from(new Set(rawPhones.map((p) => normalizePhone(String(p || ''))).filter(Boolean)));
  const exempt = new Set(Array.from(exemptPhones || []).map((p) => normalizePhone(String(p || ''))).filter(Boolean));
  if (phones.length === 0) return passAll(false);
  try {
    const client = await pool.connect();
    let broken: Error | undefined;
    try {
      await client.query('BEGIN');
      const run: Run = (t, p) => client.query(t, p);
      await lockDays(run, policy, input);
      const out = await judge(run, policy, input, phones, exempt, true);
      await client.query('COMMIT');
      return { excluded: out.excluded, counts: countOf(out.excluded), degraded: false, marked: out.marked };
    } catch (e) {
      await client.query('ROLLBACK').catch((x: Error) => { broken = x; });
      throw e;
    } finally {
      client.release(broken);
    }
  } catch (err: any) {
    await recordGateFailure(policy, input.branch, err);
    return { ...passAll(true), marked: await batchHasMarks(policy, input.batchId) };
  }
}

export type StagingGateMode = 'dry' | 'load' | 'commit';

/** 적재 표의 적격 번호(중복 = 번호 하나 · 광고 = 수신거부 거름 · countStagingFiltered 와 같은 기준 · Codex 설계 1R #5) */
async function eligibleStagingPhones(run: Run, stagingId: string, companyId: string, unsubUserId: string): Promise<string[]> {
  const r = await run(
    `SELECT DISTINCT regexp_replace(s.phone, '[^0-9]', '', 'g') AS phone
       FROM campaign_send_staging s
      WHERE s.staging_id = $1::uuid AND s.company_id = $2::uuid
        AND regexp_replace(COALESCE(s.phone, ''), '[^0-9]', '', 'g') <> ''
        AND NOT EXISTS (SELECT 1 FROM unsubscribes u WHERE u.user_id = $3 AND u.phone = s.phone)`,
    [stagingId, companyId, unsubUserId],
  );
  return r.rows.map((x: any) => String(x.phone));
}

/** 빠진 번호들의 적재 행 수 */
async function countStagingPhones(run: Run, stagingId: string, companyId: string, phones: string[]): Promise<number> {
  if (phones.length === 0) return 0;
  const r = await run(
    `SELECT COUNT(*)::int AS n FROM campaign_send_staging
      WHERE staging_id = $1::uuid AND company_id = $2::uuid AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($3::text[])`,
    [stagingId, companyId, phones],
  );
  return Number(r.rows[0]?.n || 0);
}

async function deleteStagingPhones(run: Run, stagingId: string, companyId: string, phones: string[]): Promise<void> {
  if (phones.length === 0) return;
  await run(
    `DELETE FROM campaign_send_staging
      WHERE staging_id = $1::uuid AND company_id = $2::uuid AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($3::text[])`,
    [stagingId, companyId, phones],
  );
}

/**
 * 적재 표 경로(서버 적재 확정 · 한줄로 적재 · 연속 운영자 · 플래너 · 대행 · DM · 건수 미리보기) · 관문 길에서만 부른다.
 * dry = 세기만 · load = 지우고 원장(예약 0) · commit = load + 통과 번호 예약. batch = stagingId(재시도 = 같은 묶음).
 * 광고일 때만 부른다(정보성은 관문 밖 · D1).
 */
export async function gateStaging(
  policy: AdGatePolicy,
  input: Omit<AdGateInput, 'batchId' | 'reserve' | 'holdoutKey' | 'sendCountOf'> & {
    stagingId: string; unsubUserId: string; mode: StagingGateMode;
    /** 중복 제거를 끈 발송 = 예약 날 계산 수 = 통과 번호의 적재 행 수(countStagingFiltered 와 같은 기준 · 구현 3R) */
    countRows?: boolean;
    /** 빠진 번호의 행을 지우지 않고 보관 칸으로(서버 적재 확정 라우트 한 곳 · 실패 = 라우트가 되돌림 · ★ C113 D10) */
    parkExcluded?: boolean;
  },
): Promise<AdGateResult> {
  const { stagingId, unsubUserId, mode } = input;
  const gateIn: AdGateInput = { branch: input.branch, span: input.span, holdoutKey: stagingId, batchId: stagingId, reserve: mode === 'commit', spanForCount: input.spanForCount };
  try {
    const client = await pool.connect();
    let broken: Error | undefined;
    try {
      await client.query('BEGIN');
      const run: Run = (t, p) => client.query(t, p);
      if (mode !== 'dry') await lockDays(run, policy, gateIn);
      const phones = await eligibleStagingPhones(run, stagingId, policy.companyId, unsubUserId);
      if (input.countRows) gateIn.sendCountOf = (passed) => countStagingPhones(run, stagingId, policy.companyId, passed);
      const out = await judge(run, policy, gateIn, phones, new Set(), mode !== 'dry');
      const excludedRows = await countStagingPhones(run, stagingId, policy.companyId, [...out.excluded.keys()]);
      // ★ C113 구현 1R #6 — 보관 칸 판정에서 전원이 빠지면 옮기지 않는다(원본 0 행 = 끊긴 뒤 재시도가 되돌리기 전에 「적재된 수신자 없음」으로 막힘 · 호출부가 바로 「대상 없음」)
      const allExcluded = !!input.parkExcluded && phones.length > 0 && out.excluded.size >= phones.length;
      if (mode !== 'dry' && !allExcluded) {
        if (input.parkExcluded) await parkStagingPhones(stagingId, policy.companyId, [...out.excluded.keys()], run);
        else await deleteStagingPhones(run, stagingId, policy.companyId, [...out.excluded.keys()]);
      }
      await client.query(mode === 'dry' ? 'ROLLBACK' : 'COMMIT');
      return { excluded: out.excluded, counts: countOf(out.excluded), degraded: false, excludedRows, marked: mode !== 'dry' && out.marked, allExcluded };
    } catch (e) {
      await client.query('ROLLBACK').catch((x: Error) => { broken = x; });
      throw e;
    } finally {
      client.release(broken);
    }
  } catch (err: any) {
    if (mode === 'dry') return passAll(true);   // 미리보기는 장애 줄을 쓰지 않는다(확정 때 다시 판정)
    await recordGateFailure(policy, input.branch, err);
    return { ...passAll(true), marked: await batchHasMarks(policy, stagingId) };   // ★ 구현 7R — 앞 시도(load) 원장은 잇는다
  }
}

// ── 연결(확정 표식) ──────────────────────────────────────────────────────

/** 차감 · 큐 앞 — 묶음의 원장 줄을 캠페인에 잇는다 · 실패 = 던짐(그 경로의 실패 갈래 · 한 통도 안 나감) */
export async function linkAdMarks(companyId: string, batchId: string, campaignId: string, onlyPhones?: string[]): Promise<void> {
  if ((await schemaState()) !== 'ready') return;   // 확인 오류 = 던짐(부르는 곳의 장애 줄 · 구현 1R #8)
  // onlyPhones = 여정처럼 단위마다 큐에 실린 번호만 확정할 때(실리지 않은 번호의 예약은 2시간 뒤 저절로 죽음 · 설계서 §3-4)
  const phones = onlyPhones ? onlyPhones.map((p) => normalizePhone(String(p || ''))).filter(Boolean) : null;
  if (phones && phones.length === 0) return;
  // 차례 = 캠페인 행 → 원장 줄(예약 변경 트랜잭션과 같은 차례 · 교착 0) · 한 트랜잭션(표시 없이 이어진 줄 0)
  await withTx(async (run) => {
    await run(
      `UPDATE campaigns SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{${AD_GATE_LINKED_FLAG}}', 'true'::jsonb)
        WHERE id = $2::uuid AND company_id = $1::uuid AND COALESCE((send_config->>'${AD_GATE_LINKED_FLAG}')::boolean, false) = false`,
      [companyId, campaignId],
    );
    await run(
      `UPDATE ad_send_marks m SET campaign_id = $3::uuid
        WHERE m.batch_id = $2::uuid AND m.company_id = $1::uuid
          AND (m.campaign_id IS NULL OR NOT EXISTS (
                SELECT 1 FROM campaigns lc WHERE lc.id = m.campaign_id
                  AND lc.status <> 'failed' AND COALESCE(lc.send_phase, '') <> 'failed'))   -- ★ C113 D11 ④: 예약도 failed 캠페인이면 재시도가 넘겨받음
          AND ($4::text[] IS NULL OR m.phone = ANY($4::text[]))`,
      [companyId, batchId, campaignId, phones],
    );
  });
}

/**
 * 관문 길로 이어진 캠페인 표시(★ C113 구현 1R #1) — 잇기가 같은 트랜잭션에 쓴다 · 예약 변경 · 수신자 삭제가 원장에 손대는지 = 이 표시 하나
 *   (지금 요금제가 아니라 발송 당시의 길 · 표시 없는 캠페인 = HEAD 흐름 그대로 · 원장 접근 0 · 잇기 실패 = 표시 0 · 그 예약은 2시간 뒤 저절로 죽음)
 */
export const AD_GATE_LINKED_FLAG = 'adGateLinked';
export function campaignAdGateLinked(campaign: { send_config?: any } | null | undefined): boolean {
  return campaign?.send_config?.[AD_GATE_LINKED_FLAG] === true;
}

/** 큐 편집 잠금 열쇠(★ C113 구현 1R #2) — uuid 표기(대소문자 · 하이픈 · 중괄호)가 달라도 같은 캠페인 = 같은 열쇠(uuidLockKey) */
export function queueEditKey(campaignId: string): string {
  return `queue-edit:${uuidLockKey(campaignId)}`;
}

/**
 * 관문 길 한 시도의 예약 소유(★ C113 D10 · 구현 1R #3 ~ #5 구조) — 입구마다 손으로 적던 쥠 · 넘김 · 해제를 한 곳에.
 *   take = 판정이 원장을 쓴 순간 그 묶음을 쥔다 · handoff = 나갈 수 있는 단계(큐 적재 · 발송 CT) 바로 앞 · 채널 갈래가 있으면 갈래마다 그 큐 바로 앞(소유를 내려놓고 잇는다 · 잇기는 한 번 · 실패 = 장애 줄 · 계속) ·
 *   pass = 공용 입구에 넘김(그 함수가 이어받아 활성화 문장 앞에서 내려놓음) · 소유를 잃은 것이 확인된 출구(대행) = 해제 0 ·
 *   settle = 판정을 감싸는 바깥 finally · 쥔 채 끝났으면 이어지지 않은 예약을 지운다(keep = 큐에 실렸거나 결과를 모르는 번호 · 실패 = 경고 · 2시간 뒤 저절로 죽음).
 *   넘긴 뒤 · 잃은 뒤 출구 = 해제 0(나갔을 수 있다).
 */
export class AdHold {
  private batchId: string | null = null;
  private held = false;
  private linked = false;
  constructor(private readonly companyId: string) {}
  take(marked: boolean, batchId: string | null | undefined): void {
    if (marked && batchId) { this.batchId = batchId; this.held = true; }
  }
  get holding(): boolean { return this.held; }
  async handoff(campaignId: string): Promise<void> {
    this.held = false;
    if (!this.batchId || this.linked) return;   // 잇기 = 한 번(갈래마다 큐 바로 앞에서 불러도 됨 · 구현 2R #2)
    this.linked = true;
    await linkAdMarksSafe(this.companyId, this.batchId, campaignId);
  }
  pass(): void { this.held = false; }
  async settle(keep?: string[] | null): Promise<void> {
    if (!this.held || !this.batchId) return;
    this.held = false;
    await releaseUnlinkedReservations(this.companyId, this.batchId, keep);
  }
}

/**
 * 대조군 · 우선순위 설정 저장(★ C113 구현 1R #7) — 요금제 판정을 쓰는 문장 안에서(강등과 같은 회사 행 잠금 뒤 다시 판정 · 늦은 저장이 비운 칸을 되살리는 길 0)
 *   'none' = 바꿀 칸 없음 · 'unpaid' = 0 행(요금제 아님) · 'saved'
 */
export async function saveAdGateSettings(companyId: string, body: Parameters<typeof buildAdGateSettingsUpdate>[1]): Promise<'saved' | 'unpaid' | 'none'> {
  const upd = buildAdGateSettingsUpdate(companyId, body, `COALESCE((SELECT ${ACTIVE_PAID_PLAN_WHERE} FROM plans p WHERE p.id = c.plan_id), false)`);
  if (!upd) return 'none';
  const r = await query(upd.sql, upd.params as any[]);
  return (r.rowCount || 0) > 0 ? 'saved' : 'unpaid';
}


/**
 * 발송 입구가 부르는 잇기(★ 1107 Harold) — 실패해도 던지지 않는다 = 발송은 계속.
 *   실패 = 장애 줄(ad_gate_failures · 갈래 'link') + 경고 → 효과 측정은 그 기간을 「보류」로(§3-6 limited) · 그 발송의 예약은 확정되지 않아 2시간 뒤 사라진다(D7 ④ 와 같은 덜 막는 쪽).
 *   장애 줄 쓰기까지 실패 = console.error 만(발송은 그래도 계속 · 측정 보류 표시가 빠질 수 있다 = 기록된 한계).
 */
export async function linkAdMarksSafe(companyId: string, batchId: string, campaignId: string, onlyPhones?: string[]): Promise<void> {
  try {
    await linkAdMarks(companyId, batchId, campaignId, onlyPhones);
  } catch (err: any) {
    console.warn(`[ad-send-gate] 원장 잇기 실패 · 발송은 계속 company=${companyId} batch=${batchId} campaign=${campaignId}:`, err?.message || err);
    try {
      await query(`INSERT INTO ad_gate_failures (company_id, branch, error) VALUES ($1::uuid, 'link', $2)`, [companyId, String(err?.message || err).slice(0, 200)]);
    } catch (e2: any) {
      console.error(`[ad-send-gate] 잇기 장애 줄 기록 실패 company=${companyId}:`, e2?.message || e2);
    }
  }
}

// ── 주인 해제 · 수신자 해제(★ C113 D10 · D11 ③) ─────────────────────────

/**
 * 나간 것 0 으로 끝난 시도의 예약 = 그 묶음의 주인이 이어지지 않은 예약을 지운다(★ C113 D10 · 실패 = 경고 · 그 예약은 2시간 뒤 저절로 죽음).
 * keepPhones = 여정처럼 큐에 실렸거나 결과를 모르는 번호(지우지 않음).
 */
export async function releaseUnlinkedReservations(companyId: string, batchId: string, keepPhones?: string[] | null): Promise<void> {
  try {
    if ((await schemaState()) !== 'ready') return;
    const keep = keepPhones ? keepPhones.map((p) => normalizePhone(String(p || ''))).filter(Boolean) : null;
    await query(
      `DELETE FROM ad_send_marks
        WHERE company_id = $1::uuid AND batch_id = $2::uuid AND kind = 'reserved' AND campaign_id IS NULL
          AND ($3::text[] IS NULL OR NOT (phone = ANY($3::text[])))`,
      [companyId, batchId, keep],
    );
  } catch (err: any) {
    console.warn(`[ad-send-gate] 예약 해제 실패 company=${companyId} batch=${batchId} (2시간 뒤 저절로 죽음):`, err?.message || err);
  }
}

/** 수신자 삭제 = 그 캠페인에 이어진 그 번호의 예약 줄을 지운다(한 트랜잭션 · 예약 잠금 · ★ C113 D11 ③ · 실패 = 던짐 → 호출부 경고 + 장애 줄) */
export async function releaseCampaignPhoneReservation(companyId: string, campaignId: string, phone: string): Promise<void> {
  if ((await schemaState()) !== 'ready') return;   // 확인 오류 = 던짐(부르는 곳의 장애 줄 · 구현 1R #8)
  const p = normalizePhone(String(phone || ''));
  if (!p) return;
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`adgate-camp:${campaignId}`]);
    await client.query(
      `DELETE FROM ad_send_marks WHERE company_id = $1::uuid AND campaign_id = $2::uuid AND kind = 'reserved' AND phone = $3`,
      [companyId, campaignId, p],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch((x: Error) => { broken = x; });
    throw e;
  } finally {
    client.release(broken);
  }
}

/** 수신자 삭제가 부르는 해제(★ C113 D11 ③) — 실패해도 던지지 않는다(삭제 응답 그대로 · 경고 + 장애 줄 · 그 예약은 그날 판정에 남음) */
export async function releaseCampaignPhoneReservationSafe(companyId: string, campaignId: string, phone: string): Promise<void> {
  try {
    await releaseCampaignPhoneReservation(companyId, campaignId, phone);
  } catch (err: any) {
    console.warn(`[ad-send-gate] 수신자 예약 해제 실패 company=${companyId} campaign=${campaignId}:`, err?.message || err);
    try {
      await query(`INSERT INTO ad_gate_failures (company_id, branch, error) VALUES ($1::uuid, 'release', $2)`, [companyId, String(err?.message || err).slice(0, 200)]);
    } catch (e2: any) {
      console.error(`[ad-send-gate] 수신자 예약 해제 장애 줄 기록 실패 company=${companyId}:`, e2?.message || e2);
    }
  }
}

// ── 예약 변경이 예약 날을 큐와 같이 옮긴다(★ C113 D11 ② · 요금제 쓰는 회사 · 큐 편집 잠금 안에서만 부른다) ─────────

/** 그 캠페인의 예약 줄 = 이어진 줄 + 아직 이어지지 않은 그 캠페인 묶음 줄(캠페인 id · staging_id) */
const CAMPAIGN_RESERVED_REST = `kind = 'reserved' AND (campaign_id = $2::uuid OR (campaign_id IS NULL AND batch_id = ANY($3::uuid[])))`;   // 앞 = company_id = $1::uuid

/** 예약 줄이 있나 · 스키마 없음 = 없음 확정 · 조회 오류 = 던짐(호출부 = 바뀐 것 0 · 500) */
export async function campaignHasReservations(companyId: string, campaignId: string, batchIds: string[]): Promise<boolean> {
  if ((await schemaState()) !== 'ready') return false;   // 확인 오류 = 던짐(바뀐 것 0 · 500)
  const r = await query(`SELECT 1 FROM ad_send_marks WHERE company_id = $1::uuid AND ${CAMPAIGN_RESERVED_REST} LIMIT 1`, [companyId, campaignId, batchIds]);
  return r.rows.length > 0;
}

async function withTx<T>(fn: (run: Run) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const out = await fn((t, p) => client.query(t, p));
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch((x: Error) => { broken = x; });
    throw e;
  } finally {
    client.release(broken);
  }
}

/** 예약 잠금(adgate-camp:<캠페인>) → 날 잠금(옛 ∪ 새 · 오름차순 · 관문 판정과 같은 열쇠) */
async function lockCampaignReservations(run: Run, companyId: string, campaignId: string, batchIds: string[], newDays: string[]): Promise<void> {
  await run(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`adgate-camp:${campaignId}`]);
  const old = await run(`SELECT DISTINCT to_char(send_day, 'YYYY-MM-DD') AS d FROM ad_send_marks WHERE company_id = $1::uuid AND ${CAMPAIGN_RESERVED_REST}`, [companyId, campaignId, batchIds]);
  const days = [...new Set([...old.rows.map((x: any) => String(x.d)), ...newDays])].sort();
  for (const d of days) await run(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`adgate:${companyId}:${d}`]);
}

/** 새 날 줄 넣기(번호 · 묶음 · 갈래 · 이은 캠페인 · 처음 만든 시각 그대로) */
async function insertReservedDays(run: Run, companyId: string, campaignId: string, batchIds: string[], newDays: string[]): Promise<void> {
  if (newDays.length === 0) return;
  await run(
    `INSERT INTO ad_send_marks (company_id, batch_id, branch, kind, phone, send_day, campaign_id, created_at)
     SELECT m.company_id, m.batch_id, m.branch, 'reserved', m.phone, d.day, m.campaign_id, MIN(m.created_at)
       FROM ad_send_marks m CROSS JOIN unnest($4::date[]) AS d(day)
      WHERE m.company_id = $1::uuid AND m.kind = 'reserved' AND (m.campaign_id = $2::uuid OR (m.campaign_id IS NULL AND m.batch_id = ANY($3::uuid[])))
      GROUP BY m.company_id, m.batch_id, m.branch, m.phone, d.day, m.campaign_id
     ON CONFLICT DO NOTHING`,
    [companyId, campaignId, batchIds, newDays],
  );
}

async function deleteReservedOutside(run: Run, companyId: string, campaignId: string, batchIds: string[], keepDays: string[]): Promise<void> {
  await run(`DELETE FROM ad_send_marks WHERE company_id = $1::uuid AND ${CAMPAIGN_RESERVED_REST} AND NOT (send_day = ANY($4::date[]))`, [companyId, campaignId, batchIds, keepDays]);
}

/**
 * 적재 전(queued) 예약 변경 = 한 트랜잭션(예약 · 날 잠금 → 새 날 줄 → 캠페인 조건부 UPDATE → 옛 날 줄 지움) · 큐 0.
 * updateCampaign 이 0행(그 사이 처리기가 선점) = 되돌리고 거짓.
 */
export async function rescheduleQueuedReservations(
  companyId: string, campaignId: string, batchIds: string[], newDays: string[], updateCampaign: (run: Run) => Promise<number>,
): Promise<boolean> {
  return withTx(async (run) => {
    await lockCampaignReservations(run, companyId, campaignId, batchIds, newDays);
    await insertReservedDays(run, companyId, campaignId, batchIds, newDays);
    if ((await updateCampaign(run)) === 0) throw new RescheduleNotQueued();
    await deleteReservedOutside(run, companyId, campaignId, batchIds, newDays);
    return true;
  }).catch((e) => { if (e instanceof RescheduleNotQueued) return false; throw e; });
}
class RescheduleNotQueued extends Error {}

/** 적재 뒤 넓히기 = 새 날 줄 넣기(옛 날 줄 그대로 · 큐를 밀기 전 · 짧은 트랜잭션 · PG 안에서 큐를 기다리지 않음) */
export async function expandCampaignReservations(companyId: string, campaignId: string, batchIds: string[], newDays: string[]): Promise<void> {
  await withTx(async (run) => {
    await lockCampaignReservations(run, companyId, campaignId, batchIds, newDays);
    await insertReservedDays(run, companyId, campaignId, batchIds, newDays);
  });
}

/** 적재 뒤 좁히기 = 캠페인 시각 UPDATE + 새 기간 밖 줄 지움(한 트랜잭션 · 큐를 민 뒤) */
export async function contractCampaignReservations(
  companyId: string, campaignId: string, batchIds: string[], keepDays: string[], updateCampaign: (run: Run) => Promise<unknown>,
): Promise<void> {
  await withTx(async (run) => {
    await lockCampaignReservations(run, companyId, campaignId, batchIds, keepDays);
    await updateCampaign(run);
    await deleteReservedOutside(run, companyId, campaignId, batchIds, keepDays);
  });
}

// ★ 2026-11-07 C113 K15 · D16 — 보존(400일 · 연결 안 된 줄 3일 · 장애 400일)은 보관 기한 CT(retention-sweeper RETENTION_RULES)가
//   하루 한 번 · 5,000행씩 · 표마다 실패 격리로 지운다(옛 pruneAdSendMarks = 부르는 곳 0 이라 지움).
