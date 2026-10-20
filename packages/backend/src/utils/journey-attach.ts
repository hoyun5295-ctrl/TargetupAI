/**
 * journey-attach.ts — 기존 여정 뒤에 붙이기 · 붙기 전 점검 · 떼기(★ 2026-10-20 여정 V.3 §18 · Harold 「기존 여정 뒤에 붙일 방법 · 붙을 수 있는지 점검」)
 *
 * 붙이기 = 뒤 여정(B)의 시작을 「앞 여정(A)을 마치면」으로 바꾼다(시작 사건 journey.after · trigger_filters 의 after_root · after_outcome).
 *   진입은 진입 감시가 A 계보에서 그 결과로 끝난 실행을 읽어 B 의 같은 추출 · 같은 넣기 함수로 넣는다(동의 · 범위 · 조건 · 상한 · 재진입 그대로).
 *   붙이기 전 시작은 attach_prev 에 남겨 [떼기]가 되돌린다.
 *
 * 점검(judgeAttach)은 순수 함수 하나 — 후보 목록 · 붙이기 저장(잠금 안 다시 점검)이 같은 함수를 쓴다.
 * 켜진 B 도 그 자리에서 바뀐다: 시작은 새로 들어오는 고객에게만 영향(진행 중 고객은 칸을 끝까지 받는다 · V.3 시작 조건 그 자리와 같다).
 */
import { query, pool } from '../config/database';
import { AFTER_JOURNEY_EVENT, triggerLabel } from './journey-trigger-capability';
import { lineageColumnsReady, lockLineage } from './journey-lineage';
import { dbAcceptsTriggerEvent, JourneyMigrationPendingError } from './journey-trigger-db';
import { seedBaselineForJourney, seedGradeStateForJourney } from './journey-entry-ledger';
import { AFTER_OUTCOMES, AFTER_OUTCOME_LABEL, readAfterConfig, startGenOf, type AfterOutcome } from './journey-after-config';

export { AFTER_OUTCOMES, AFTER_OUTCOME_LABEL, readAfterConfig, type AfterOutcome } from './journey-after-config';

export interface AttachJourneyRow {
  id: string;
  name: string;
  status: string;
  triggerEvent: string;
  startKind: string;
  filters: Record<string, any>;
  /** 계보 뿌리(lineage_id · 없으면 자기 id) — 소문자 */
  root: string;
  entryClosed: boolean;
  archived: boolean;
  goalExitEnabled: boolean;
  /** 알림톡 변수가 사건 값(주문번호 · 상품명 등)을 쓰는가 — 앞 여정을 마친 고객에게는 그 값이 없다. */
  usesEventFields?: boolean;
}

/**
 * 사건이 실어 주는 값 중 고객 칸이 없는 것(화면 카탈로그 eventFields 의 key · 매장명은 고객 칸 store_name 이 있어 제외).
 *   붙인 여정은 앞 여정을 마친 고객으로 들어와 이 값이 비어 나간다 → 이 값을 쓰는 여정은 붙이지 않는다(값만 빈 발송 0).
 */
export const EVENT_ONLY_FIELD_KEYS = ['order_no', 'product_name', 'total_amount', 'tracking_no', 'carrier', 'reservation_no', 'reservation_date'];

const RANK: Record<string, number> = { active: 0, paused: 1, draft: 2, ended: 3 };

/** 계보 대표(지도 카드 · 이름) — 진입이 열린 판 중 켜짐 > 멈춤 > 초안 > 끝남 · 보관 제외. */
export function representativeOf(rows: AttachJourneyRow[], root: string): AttachJourneyRow | null {
  const r = rows.filter((x) => x.root === root && !x.archived);
  const open = r.filter((x) => !x.entryClosed);
  const pick = (open.length > 0 ? open : r).slice().sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9));
  return pick[0] || null;
}

/**
 * 붙기 전 점검(순수) — 막음(blocks)이 하나라도 있으면 붙이지 않는다 · 알림(warns)은 붙이되 보여 준다.
 *   a = 앞 여정(지금 고른 판) · b = 뒤 여정 · rows = 회사 여정 전체(고리 · 이름 판정).
 */
export function judgeAttach(a: AttachJourneyRow, b: AttachJourneyRow, outcome: AfterOutcome, rows: AttachJourneyRow[]): { blocks: string[]; warns: string[] } {
  const blocks: string[] = [];
  const warns: string[] = [];
  if (!AFTER_OUTCOMES.includes(outcome)) blocks.push('어떤 고객을 넘길지 골라 주세요.');
  if (a.root === b.root) blocks.push('같은 여정끼리는 붙일 수 없어요.');
  if (a.archived || a.status === 'ended') blocks.push('앞 여정이 끝났거나 보관돼 넘겨줄 고객이 없어요.');
  if (b.archived || b.status === 'ended') blocks.push('끝났거나 보관된 여정은 붙일 수 없어요.');
  if (b.entryClosed) blocks.push('옛 모양으로 마무리 중인 여정이라 새 고객을 받지 않아요.');
  if (b.startKind === 'date_anchor' || b.startKind === 'one_shot') blocks.push('날짜에 맞춰 보내는 여정은 날짜가 시작이라 뒤에 붙일 수 없어요.');
  if (b.usesEventFields) {
    blocks.push('이 여정 알림톡이 주문번호 · 상품명 같은 사건 값을 써서 앞 여정을 마친 고객에게는 빈 값으로 나가요. 그 값을 빼고 붙여 주세요.');
  }
  if (outcome === 'goal_met' && !a.goalExitEnabled) {
    blocks.push('앞 여정이 「목표 달성하면 끝내기」를 꺼 둬서 목표를 이뤄 마치는 고객이 없어요. 앞 여정에서 켜거나 다른 결과를 고르세요.');
  }
  // 고리 — 계보 단위 연결(앞 여정 계보 → 붙은 계보)에서 뒤 여정 계보로부터 앞 여정 계보에 닿으면 붙이는 순간 고리가 된다.
  //   ★ Codex 적대 A 2R — 대표 판 하나만 따라가면 같은 계보의 다른 판(복제 초안 · 멈춘 판)에 걸린 연결을 못 봐, 그 판이 켜지며 고리가 됐다.
  //   진입이 열린 · 끝나지 않은 · 보관 안 한 모든 판의 연결을 센다(지금 바꾸는 판 b 자신의 연결은 빼고 · 덜 붙이는 방향).
  {
    const children = new Map<string, Set<string>>();
    for (const x of rows) {
      if (x.id === b.id || x.archived || x.status === 'ended' || x.entryClosed || x.triggerEvent !== AFTER_JOURNEY_EVENT) continue;
      const cfg = readAfterConfig(x.filters);
      if (!cfg) continue;
      if (!children.has(cfg.root)) children.set(cfg.root, new Set());
      children.get(cfg.root)!.add(x.root);
    }
    const seen = new Set<string>([b.root]);
    const queue = [b.root];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === a.root) { blocks.push('뒤 여정을 따라가면 앞 여정이 다시 나와 고리가 생겨요.'); break; }
      for (const nx of children.get(cur) || []) if (!seen.has(nx)) { seen.add(nx); queue.push(nx); }
    }
  }
  const curAfter = b.triggerEvent === AFTER_JOURNEY_EVENT ? readAfterConfig(b.filters) : null;
  if (curAfter && curAfter.root === a.root && curAfter.outcome === outcome) blocks.push('이미 이 여정 뒤에 같은 고객으로 붙어 있어요.');
  if (blocks.length > 0) return { blocks, warns };

  if (curAfter) {
    const prevA = representativeOf(rows, curAfter.root);
    if (curAfter.root !== a.root) warns.push(`지금 「${prevA?.name || '다른 여정'}」 뒤에 붙어 있어요. 이 여정 뒤로 옮겨요.`);
  } else {
    warns.push(`붙이면 원래 시작(${triggerLabel(b.triggerEvent) || '정한 사건'}) 대신 앞 여정을 마친 고객만 받아요. 진행 중 고객은 끝까지 받고, [떼기]로 되돌릴 수 있어요.`);
  }
  if (a.status !== 'active') warns.push('앞 여정이 꺼져 있어 켜기 전까지는 넘어오는 고객이 없어요.');
  if (b.status === 'draft') warns.push('이 여정은 초안이라 켠 뒤부터 받아요.');
  else if (b.status === 'paused') warns.push('이 여정은 멈춰 있어 다시 켠 뒤부터 받아요.');
  else if (b.status === 'active') warns.push('켜진 여정이라 붙이는 즉시 이 길로 받아요.');
  return { blocks, warns };
}

type Runner = { query: (text: string, params?: any[]) => Promise<any> };

/**
 * ★ Codex 적대 A 1R — 회사 단위 붙이기 잠금(붙이기 · 떼기가 줄을 선다). 뒤 여정 계보만 잠그면 반대 방향 두 붙이기(B→A · A→B)가
 *   서로 다른 잠금을 잡고 같은 스냅숏으로 고리 검사를 통과했다. 순서 = 이 잠금 → 뒤 여정 계보 잠금 → 행 잠금(켜기 · 감시는 계보 잠금만 잡아 교착 0).
 */
export async function lockAttachGraph(run: Runner, companyId: string): Promise<void> {
  await run.query(`SELECT pg_advisory_xact_lock(hashtext('journey-attach'), hashtext($1::text))`, [companyId]);
}

/** 회사 여정 전체(점검용 · 계보 컬럼 없으면 자기 id 가 뿌리). */
export async function loadAttachRows(run: Runner, companyId: string): Promise<AttachJourneyRow[]> {
  const lineage = await lineageColumnsReady();
  const r = await run.query(
    `SELECT id, name, status, trigger_event, COALESCE(start_kind, 'event') AS start_kind, trigger_filters,
            goal_exit_enabled, archived_at${lineage ? ', lineage_id, entry_closed_at' : ''}
       FROM journeys WHERE company_id = $1::uuid`,
    [companyId],
  );
  const ids = (r.rows as any[]).map((x) => String(x.id));
  // 사건 값을 쓰는 여정(칸 · A/B 변형의 알림톡 변수 연결 @@키@@) — 회사 여정 전체를 한 번에.
  const ev = ids.length === 0 ? { rows: [] } : await run.query(
    `SELECT DISTINCT s.journey_id FROM journey_steps s
       LEFT JOIN journey_step_variants v ON v.step_id = s.id
      WHERE s.journey_id = ANY($1::uuid[])
        AND (COALESCE(s.alimtalk_variable_map::text, '') ~ $2 OR COALESCE(v.alimtalk_variable_map::text, '') ~ $2)`,
    [ids, `@@(${EVENT_ONLY_FIELD_KEYS.join('|')})@@`],
  );
  const usesEvent = new Set((ev.rows as any[]).map((x) => String(x.journey_id)));
  return (r.rows as any[]).map((x) => ({
    id: String(x.id),
    name: String(x.name || ''),
    status: String(x.status || ''),
    triggerEvent: String(x.trigger_event || ''),
    startKind: String(x.start_kind || 'event'),
    filters: (x.trigger_filters || {}) as Record<string, any>,
    root: String(x.lineage_id || x.id).toLowerCase(),
    entryClosed: !!x.entry_closed_at,
    archived: !!x.archived_at,
    goalExitEnabled: x.goal_exit_enabled === true,
    usesEventFields: usesEvent.has(String(x.id)),
  }));
}

export class AttachBlockedError extends Error {
  readonly code = 'ATTACH_BLOCKED';
  constructor(readonly blocks: string[]) { super(blocks[0] || '붙일 수 없어요.'); this.name = 'AttachBlockedError'; }
}

export interface AttachCandidates {
  after: { id: string; name: string; status: string; goalExitEnabled: boolean };
  outcomes: Array<{ key: AfterOutcome; label: string; available: boolean; reason: string | null; finished30d: number }>;
  candidates: Array<{ id: string; name: string; status: string; triggerLabel: string; attachedAfterName: string | null; blocks: string[]; warns: string[] }>;
  /** DB 시작 사건 목록이 아직 「앞 여정을 마치면」을 받지 않는다(DDL 전) — 붙이기 버튼을 막고 이유를 보인다. */
  migrationPending: boolean;
}

/** 앞 여정(afterId) 뒤에 붙일 수 있는 여정 목록 + 결과별 가능 여부 · 최근 30일 그 결과로 마친 고객 수. 앞 여정이 없으면 null. */
export async function attachCandidates(companyId: string, afterId: string, outcome: AfterOutcome): Promise<AttachCandidates | null> {
  const rows = await loadAttachRows({ query }, companyId);
  const asked = rows.find((x) => x.id === afterId && !x.archived);
  if (!asked) return null;
  // ★ Codex 적대 A 1R — 앞 여정은 계보의 대표 판(진입이 열린 판)으로 판정한다(옛 판 id 로 고리 검사를 피하지 못하게).
  const a = representativeOf(rows, asked.root) || asked;
  const lineage = await lineageColumnsReady();
  const fin = await query(
    `SELECT e.status, COUNT(*)::int AS n
       FROM journey_executions e
       JOIN journeys aj ON aj.id = e.journey_id
      WHERE aj.company_id = $1::uuid AND ${lineage ? 'COALESCE(aj.lineage_id, aj.id)' : 'aj.id'} = $2::uuid
        AND e.status IN ('goal_met', 'completed') AND e.completed_at > NOW() - INTERVAL '30 days'
      GROUP BY e.status`,
    [companyId, a.root],
  );
  const count = (st: string) => Number((fin.rows as any[]).find((x) => x.status === st)?.n || 0);
  const outcomes = AFTER_OUTCOMES.map((key) => {
    const blocked = key === 'goal_met' && !a.goalExitEnabled;
    return {
      key,
      label: AFTER_OUTCOME_LABEL[key],
      available: !blocked,
      reason: blocked ? '앞 여정이 「목표 달성하면 끝내기」를 꺼 둬서 이 결과로 마치는 고객이 없어요.' : null,
      finished30d: key === 'any' ? count('goal_met') + count('completed') : count(key),
    };
  });
  // 후보 = 계보마다 대표 한 판(옛 판 · 보관 · 끝남은 목록에 올리지 않는다 · 앞 여정 계보 제외).
  const roots = [...new Set(rows.filter((x) => !x.archived && x.status !== 'ended' && x.root !== a.root).map((x) => x.root))];
  const candidates = roots
    .map((root) => representativeOf(rows, root))
    .filter((b): b is AttachJourneyRow => !!b && b.status !== 'ended')
    .map((b) => {
      const v = judgeAttach(a, b, outcome, rows);
      const cur = b.triggerEvent === AFTER_JOURNEY_EVENT ? readAfterConfig(b.filters) : null;
      return {
        id: b.id,
        name: b.name,
        status: b.status,
        triggerLabel: cur ? '앞 여정을 마치면' : (triggerLabel(b.triggerEvent) || '정한 사건'),
        attachedAfterName: cur ? (representativeOf(rows, cur.root)?.name || null) : null,
        blocks: v.blocks,
        warns: v.warns,
      };
    })
    .sort((x, y) => (x.blocks.length > 0 ? 1 : 0) - (y.blocks.length > 0 ? 1 : 0) || (RANK[x.status] ?? 9) - (RANK[y.status] ?? 9));
  return {
    after: { id: a.id, name: a.name, status: a.status, goalExitEnabled: a.goalExitEnabled },
    outcomes,
    candidates,
    migrationPending: !(await dbAcceptsTriggerEvent(AFTER_JOURNEY_EVENT)),
  };
}

/** 붙이기 전 시작(되돌릴 값) — 이미 붙은 여정을 옮길 때는 처음 값을 그대로 둔다(떼기 = 맨 처음 시작으로). */
function attachPrevOf(b: { triggerEvent: string; startKind: string; filters: Record<string, any> }): Record<string, any> {
  if (b.triggerEvent === AFTER_JOURNEY_EVENT && b.filters.attach_prev) return b.filters.attach_prev;
  const { attach_prev: _drop, after_root: _r, after_outcome: _o, ...rest } = b.filters || {};
  return { trigger_event: b.triggerEvent, start_kind: b.startKind, trigger_filters: rest };
}

/**
 * 붙이기 — 뒤 여정 계보 잠금 + 행 잠금 안에서 다시 점검하고 바꾼다.
 *   켜진 여정 = 기준 시각 지금(붙인 뒤 마친 고객부터) · 그 밖 = 비움(켜는 순간이 기준 · 첫 켜기 커서 · 다시 켜기 보정).
 */
export async function attachJourney(companyId: string, journeyId: string, afterId: string, outcome: AfterOutcome): Promise<{ ok: true; warns: string[] }> {
  if (!(await dbAcceptsTriggerEvent(AFTER_JOURNEY_EVENT))) {
    throw new JourneyMigrationPendingError('DB 마이그레이션 필요: 운영자에게 journeys 시작 사건 목록(CHECK) 갱신 요청');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockAttachGraph(client, companyId);
    await lockLineage(client, journeyId);
    const lock = await client.query(`SELECT id FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`, [journeyId, companyId]);
    if (lock.rows.length === 0) { await client.query('ROLLBACK'); throw new AttachBlockedError(['여정을 찾을 수 없어요.']); }
    const rows = await loadAttachRows(client, companyId);
    const asked = rows.find((x) => x.id === afterId);
    const b = rows.find((x) => x.id === journeyId)!;
    if (!asked) { await client.query('ROLLBACK'); throw new AttachBlockedError(['앞 여정을 찾을 수 없어요.']); }
    const a = representativeOf(rows, asked.root) || asked;
    const v = judgeAttach(a, b, outcome, rows);
    if (v.blocks.length > 0) { await client.query('ROLLBACK'); throw new AttachBlockedError(v.blocks); }
    const f = b.filters || {};
    const next: Record<string, any> = {
      after_root: a.root,
      after_outcome: outcome,
      attach_prev: attachPrevOf(b),
      start_gen: startGenOf(f) + 1,   // 감시가 옛 설정으로 뽑은 후보 · 커서 · 멈춤을 쓰지 못하게(Codex 적대 A 3R)
    };
    if (Array.isArray(f.customer_conditions)) next.customer_conditions = f.customer_conditions;
    if (f.logic) next.logic = f.logic;
    await client.query(
      `UPDATE journeys SET trigger_event = $3, start_kind = 'event', trigger_filters = $4::jsonb,
              last_event_cursor = CASE WHEN status = 'active' THEN NOW() ELSE NULL END, last_event_cursor_id = NULL,
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [journeyId, companyId, AFTER_JOURNEY_EVENT, JSON.stringify(next)],
    );
    await client.query('COMMIT');
    return { ok: true, warns: v.warns };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 떼기 — 붙이기 전 시작으로 되돌린다(지금 고친 대상 조건은 유지). 켜진 여정은 쓰던 커서를 지금으로(떼는 사이 쌓인 사건 소급 0) ·
 *   신규 가입 · 등급 변동으로 돌아가면 바꾸기 전에 기준선을 다시 심는다(그동안 생긴 고객 · 바뀐 등급을 「새로」 보지 않게 · 켜기와 같은 재기준).
 */
export async function detachJourney(companyId: string, journeyId: string): Promise<{ ok: true; triggerEvent: string }> {
  // 기준선은 바꾸기 **전에** 심는다(켜기와 같은 순서 · 실패 = 떼지 않음). 멱등이고 상태와 무관하게 무해하다(덜 보내는 방향).
  const pre = await query(`SELECT trigger_filters->'attach_prev'->>'trigger_event' AS prev FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [journeyId, companyId]);
  const prevEvent = String(pre.rows[0]?.prev || '');
  if (prevEvent === 'customer.created') await seedBaselineForJourney(journeyId, companyId);
  if (prevEvent === 'customer.grade_changed') await seedGradeStateForJourney(journeyId, companyId);
  const client = await pool.connect();
  let restored = '';
  try {
    await client.query('BEGIN');
    await lockAttachGraph(client, companyId);
    await lockLineage(client, journeyId);
    const r = await client.query(
      `SELECT status, trigger_event, trigger_filters FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [journeyId, companyId],
    );
    const row = r.rows[0];
    if (!row) { await client.query('ROLLBACK'); throw new AttachBlockedError(['여정을 찾을 수 없어요.']); }
    if (row.trigger_event !== AFTER_JOURNEY_EVENT) { await client.query('ROLLBACK'); throw new AttachBlockedError(['다른 여정 뒤에 붙어 있지 않아요.']); }
    if (row.status === 'ended') { await client.query('ROLLBACK'); throw new AttachBlockedError(['끝난 여정은 바꿀 수 없어요.']); }
    const f = row.trigger_filters || {};
    const prev = f.attach_prev;
    if (!prev || typeof prev.trigger_event !== 'string' || !prev.trigger_event || prev.trigger_event === AFTER_JOURNEY_EVENT) {
      await client.query('ROLLBACK');
      throw new AttachBlockedError(['되돌릴 원래 시작이 없어요. 여정을 새로 만들어 주세요.']);
    }
    const back: Record<string, any> = { ...(prev.trigger_filters || {}) };
    if (Array.isArray(f.customer_conditions)) back.customer_conditions = f.customer_conditions;
    else delete back.customer_conditions;
    if (f.logic) back.logic = f.logic;
    back.start_gen = startGenOf(f) + 1;   // 떼기도 세대를 올린다(붙이기 전 이름으로 돌아와도 옛 후보는 쓰지 않는다)
    restored = String(prev.trigger_event);
    if (restored !== prevEvent && (restored === 'customer.created' || restored === 'customer.grade_changed')) {
      // 잠금 전에 읽은 값과 다르면(그사이 다시 붙임) 기준선 없이 바꾸지 않는다.
      await client.query('ROLLBACK');
      throw new AttachBlockedError(['여정이 방금 바뀌었어요. 다시 시도해 주세요.']);
    }
    await client.query(
      `UPDATE journeys SET trigger_event = $3, start_kind = $4, trigger_filters = $5::jsonb,
              last_event_cursor = CASE WHEN status = 'active' THEN NOW() ELSE NULL END, last_event_cursor_id = NULL,
              last_purchase_cursor = CASE WHEN status = 'active' AND last_purchase_cursor IS NOT NULL THEN NOW() ELSE last_purchase_cursor END,
              last_purchase_cursor_id = CASE WHEN status = 'active' AND last_purchase_cursor IS NOT NULL THEN NULL ELSE last_purchase_cursor_id END,
              updated_at = NOW()
        WHERE id = $1::uuid AND company_id = $2::uuid`,
      [journeyId, companyId, restored, String(prev.start_kind || 'event'), JSON.stringify(back)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { ok: true, triggerEvent: restored };
}
