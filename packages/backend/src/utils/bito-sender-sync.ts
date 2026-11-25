/**
 * 발신번호 → 비토엔진 허용 발신번호 거울(★ 2026-11-24 · B-1124-3 · 설계서 docs/2026-11-24-callback-bito-sync-design.md §3)
 *
 * 한줄로 = 진실 한 곳. 비토 관리 API 가 60초마다 V 발송ID 회사의 등록 번호를 당겨 가 「넣기만」 하고(지우기 · 끄기 0),
 * 번호마다 결과를 돌려준다. 이 파일 = V 판정 · 목록 · 입구 인증 · 결과 저장 · 화면 상태 판정 한 곳(라우트는 부르기만).
 * ⛔ 번호 집합은 다시 만들지 않는다 = 한줄로 회사 단위 판정 getRegisteredCallbackSet(companyId) 그대로(원장 ∪ 발신번호 표 · 저장 원문 규격).
 */
import pool, { query } from '../config/database';
import { getRegisteredCallbackSet, registeredDigits } from './callback-filter';
import { parseIpAllowlist, isIpAllowed } from './ip-allowlist';
import { timingSafeEqualUtf8 } from './secret-hash';

/** 비토엔진 업체 = 한줄로 발송ID 가 V 로 시작(2026-08-20 Harold 접두 V 확정 · 비토 발급 규칙 /^V\d{4}$/ 보다 넓게 받아 비토가 거른다) */
export function isBitoAgentSendId(id: unknown): boolean {
  return typeof id === 'string' && /^V[0-9]+$/.test(id);
}

/** 결과가 이 시간보다 오래되면 「확인 지연」(비토 회차 60초 · 결과 POST 실패가 이어지면 여기서 드러난다) */
export const BITO_SYNC_STALE_MS = 5 * 60 * 1000;

/** 비토가 돌려주는 번호 결과(설계 §3 비토 2 · 3 · 4 · 5) · 앞일수록 나쁘다(한 번호 · 여러 V = 가장 나쁜 것) */
export const BITO_SYNC_OUTCOMES = [
  'mapping_conflict', 'sync_error', 'unmapped', 'agent_inactive', 'customer_inactive', 'invalid',
  'manual_blocked', 'blocked_in_bito', 'manual_ok', 'registered',
] as const;
export type BitoSyncOutcome = (typeof BITO_SYNC_OUTCOMES)[number];

export interface BitoSenderCompany { companyId: string; agentSendIds: string[]; numbers: string[] }

/** 회사 → V 발송ID 목록(판정 = isBitoAgentSendId 한 곳) · companyIds 가 있으면 그 회사들만 */
export async function loadBitoAgentIds(companyIds?: string[]): Promise<Map<string, string[]>> {
  const r = companyIds
    ? await query(`SELECT company_id, agent_send_id FROM company_agent_ids WHERE company_id = ANY($1::uuid[]) ORDER BY company_id, agent_send_id`, [companyIds])
    : await query(`SELECT company_id, agent_send_id FROM company_agent_ids ORDER BY company_id, agent_send_id`);
  const out = new Map<string, string[]>();
  for (const row of r.rows as any[]) {
    if (!isBitoAgentSendId(row.agent_send_id)) continue;
    const k = String(row.company_id);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(String(row.agent_send_id));
  }
  return out;
}

/** 비토가 당겨 가는 목록 = V 회사 전부(번호 0 인 회사도) · 번호 = 한줄로 회사 단위 판정 집합(숫자) */
export async function listBitoSenderCompanies(): Promise<BitoSenderCompany[]> {
  const out: BitoSenderCompany[] = [];
  for (const [companyId, agentSendIds] of await loadBitoAgentIds()) {
    out.push({ companyId, agentSendIds, numbers: [...(await getRegisteredCallbackSet(companyId))].sort() });
  }
  return out;
}

/** 입구 판정 = 토큰 ENV 없음 503(꺼짐이 기본) · 출발지 밖 403 · 토큰 틀림 401(내부 경보 입구와 같은 CT) */
export function checkBitoSyncCaller(token: unknown, ip: string | null | undefined, env: NodeJS.ProcessEnv = process.env): { ok: true } | { ok: false; status: 401 | 403 | 503 } {
  const want = String(env.BITO_SENDER_SYNC_TOKEN || '');
  if (!want) return { ok: false, status: 503 };
  if (!isIpAllowed(ip, parseIpAllowlist(env.BITO_SENDER_SYNC_IPS))) return { ok: false, status: 403 };
  if (typeof token !== 'string' || !timingSafeEqualUtf8(token, want)) return { ok: false, status: 401 };
  return { ok: true };
}

export interface BitoSyncResult { companyId: string; phone: string; agentSendId: string; customerId: number | null; outcome: BitoSyncOutcome; reason: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** (순수) 결과 POST 몸통 검사 · 틀린 꼴 = null(400) */
export function parseBitoSyncResults(body: any): { roundAt: Date; results: BitoSyncResult[] } | null {
  const roundAt = new Date(String(body?.roundAt ?? ''));
  if (!Number.isFinite(roundAt.getTime())) return null;
  if (roundAt.getTime() > Date.now() + 5 * 60 * 1000) return null;   // 앞날 회차 = 저장 기준을 밀어 올려 뒤 회차를 막는다
  if (!Array.isArray(body?.results) || body.results.length > 100_000) return null;
  const results: BitoSyncResult[] = [];
  for (const r of body.results) {
    const outcome = String(r?.outcome ?? '') as BitoSyncOutcome;
    if (!UUID.test(String(r?.companyId ?? '')) || !/^[0-9]{8,20}$/.test(String(r?.phone ?? ''))
      || !isBitoAgentSendId(r?.agentSendId) || !BITO_SYNC_OUTCOMES.includes(outcome)) return null;
    const customerId = r?.customerId == null ? null : Number(r.customerId);
    if (customerId !== null && !Number.isInteger(customerId)) return null;
    results.push({ companyId: String(r.companyId), phone: String(r.phone), agentSendId: String(r.agentSendId), customerId, outcome, reason: r?.reason == null ? null : String(r.reason).slice(0, 500) });
  }
  return { roundAt, results };
}

/**
 * 결과 저장 = 한 트랜잭션 · 마지막으로 받은 회차 한 행을 잠그고 그보다 새 회차만(빈 회차도 회차 시각은 올린다 · 같은 회차 재전송 = stale)
 *   늦게 닿은 옛 회차 = 저장 0(설계 5R #2) · 지우기 0(넣기만 · 옛 번호 결과는 화면이 찾지 않는다).
 */
export async function saveBitoSyncResults(roundAt: Date, results: BitoSyncResult[]): Promise<'saved' | 'stale'> {
  const client = await pool.connect();
  let done = false;
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO bito_sender_sync_round (id, round_at) VALUES (1, '-infinity') ON CONFLICT (id) DO NOTHING`);
    // 비교 · 올림 = UPDATE 한 문장(행 잠금 · 동시 POST 는 뒤 쪽이 앞 쪽 커밋 뒤 조건을 다시 본다)
    const up = await client.query(`UPDATE bito_sender_sync_round SET round_at = $1 WHERE id = 1 AND round_at < $1`, [roundAt]);
    if ((up.rowCount || 0) === 0) {
      await client.query('ROLLBACK'); done = true;
      return 'stale';
    }
    if (results.length > 0) {
      await client.query(
        `INSERT INTO bito_sender_sync (company_id, phone, agent_send_id, customer_id, outcome, reason, round_at)
         SELECT c, p, a, cu, o, r, $7 FROM unnest($1::uuid[], $2::text[], $3::text[], $4::int[], $5::text[], $6::text[]) AS x(c, p, a, cu, o, r)
         ON CONFLICT (company_id, phone, agent_send_id) DO UPDATE
           SET customer_id = EXCLUDED.customer_id, outcome = EXCLUDED.outcome, reason = EXCLUDED.reason,
               round_at = EXCLUDED.round_at, saved_at = NOW()`,
        [results.map((x) => x.companyId), results.map((x) => x.phone), results.map((x) => x.agentSendId),
          results.map((x) => x.customerId), results.map((x) => x.outcome), results.map((x) => x.reason), roundAt],
      );
    }
    await client.query('COMMIT'); done = true;
    return 'saved';
  } finally {
    if (!done) await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    client.release();
  }
}

export type BitoSyncStatus = BitoSyncOutcome | 'checking' | 'delayed';
export interface BitoSyncView {
  status: BitoSyncStatus;
  /** 이어진 V 결과 중 가장 오래된 확인 시각(없으면 null) */
  checkedAt: string | null;
  perV: Array<{ agentSendId: string; outcome: BitoSyncOutcome | null; reason: string | null; roundAt: string | null }>;
}

/**
 * (순수) 한 번호의 화면 상태 = **지금 이어진 V(connectedV) 결과만**(끊긴 V 의 옛 행은 쓰지 않는다 · 설계 6R #1)
 *   결과 빠진 V 있음 = checking · 하나라도 5분 넘음 = delayed · 아니면 가장 나쁜 결과(BITO_SYNC_OUTCOMES 순서).
 */
export function bitoSyncStatusOf(rows: Array<{ agent_send_id: string; outcome: string; reason: string | null; round_at: Date | string }>, connectedV: string[], now: Date = new Date()): BitoSyncView {
  const perV = connectedV.map((v) => {
    const r = rows.find((x) => x.agent_send_id === v);
    return { agentSendId: v, outcome: (r?.outcome as BitoSyncOutcome) ?? null, reason: r?.reason ?? null, roundAt: r ? new Date(r.round_at).toISOString() : null };
  });
  const times = perV.filter((p) => p.roundAt).map((p) => new Date(p.roundAt!).getTime());
  const checkedAt = times.length ? new Date(Math.min(...times)).toISOString() : null;
  if (perV.length === 0 || perV.some((p) => !p.outcome)) return { status: 'checking', checkedAt, perV };
  if (times.some((t) => now.getTime() - t > BITO_SYNC_STALE_MS)) return { status: 'delayed', checkedAt, perV };
  const rank = (o: BitoSyncOutcome | null) => (o ? BITO_SYNC_OUTCOMES.indexOf(o) : -1);
  const worst = perV.reduce((a, b) => (rank(b.outcome) < rank(a.outcome) ? b : a));
  return { status: worst.outcome as BitoSyncOutcome, checkedAt, perV };
}

/**
 * 화면용 = 번호 행마다 비토 상태(V 회사 번호만 · 표가 없으면 빈 지도 = 지금 화면 그대로 · 목록을 막지 않는다).
 *   번호 찾기 = 지금 번호의 숫자(규격 판정 CT registeredDigits 와 같은 숫자) · 규격 위반 번호 = 한줄로가 보내지 않으니 invalid.
 */
export async function loadBitoSyncViews(rows: Array<{ id: string; company_id: string | null; phone: string }>, now: Date = new Date()): Promise<Map<string, BitoSyncView>> {
  const out = new Map<string, BitoSyncView>();
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter((v): v is string => !!v))];
  if (companyIds.length === 0) return out;
  const vMap = await loadBitoAgentIds(companyIds);
  if (vMap.size === 0) return out;
  let saved: any[];
  try {
    saved = (await query(
      `SELECT company_id, phone, agent_send_id, outcome, reason, round_at FROM bito_sender_sync WHERE company_id = ANY($1::uuid[])`,
      [[...vMap.keys()]],
    )).rows;
  } catch (err: any) {
    if (err?.code === '42P01') return out;   // DDL-1 전 = 칸 없음(지금 화면 그대로)
    throw err;
  }
  const byKey = new Map<string, any[]>();
  for (const s of saved) {
    const k = `${s.company_id}|${s.phone}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(s);
  }
  for (const r of rows) {
    const vs = r.company_id ? vMap.get(r.company_id) : undefined;
    if (!vs) continue;
    const digits = [...registeredDigits([r.phone])][0];
    if (!digits) {
      out.set(r.id, { status: 'invalid', checkedAt: null, perV: vs.map((v) => ({ agentSendId: v, outcome: 'invalid', reason: '한줄로 발신번호 규격 위반', roundAt: null })) });
      continue;
    }
    out.set(r.id, bitoSyncStatusOf(byKey.get(`${r.company_id}|${digits}`) || [], vs, now));
  }
  return out;
}

/** 이 회사가 비토엔진 업체인가(승인 창 · 승인 완료 안내 한 줄) */
export async function isBitoCompany(companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  return (await loadBitoAgentIds([companyId])).size > 0;
}
