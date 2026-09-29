/**
 * journey-lineage.ts — 여정 새 판 · 계보 · 진입 닫기 CT (★ 2026-09-30 여정 V2 5차 · 설계서 §8)
 *
 * 켜진 여정의 구조를 바꾸려면 [새 판으로 고치기] → 복제 초안(lineage_id = 원 여정 계보) → 새 판을 켜면
 * 같은 트랜잭션에서 옛 판 entry_closed_at = NOW()(새 고객 안 받음 · 진행 중 고객만 마무리).
 *   - 진입 워커 · 재진입 워커 · 날짜 예약 스케줄러는 entry_closed_at IS NULL 인 여정만 받는다.
 *   - 재진입 판정은 계보 단위(옛 판 진행 중 고객이 새 판에 이중 진입 0).
 *
 * ⛔ DDL(journeys.lineage_id · entry_closed_at) 전에는 전부 옛 동작 그대로다 — 컬럼 확인이 참이 되기 전에는
 *    이 CT 가 돌려주는 조각 · 목록이 비어 있거나 자기 자신뿐이다(발송 워커가 42703 으로 멈추지 않게).
 */
import { randomUUID } from 'crypto';
import { query, pool } from '../config/database';
import { JourneyInputError } from './journey-step-limits';

let ready = false;
let absentUntil = 0;
let checking: Promise<boolean> | null = null;
const RECHECK_MS = 5 * 60 * 1000;

/**
 * lineage_id · entry_closed_at 두 컬럼이 있는가. 참은 기억하고, 거짓은 5분 뒤 다시 본다(DDL 직후 곧 열린다).
 * ★ 0930 Codex 1R — ①조회 중에 들어온 호출은 같은 조회를 기다린다(조회가 끝나기 전에 거짓을 돌려주면 컬럼이 있어도
 *   진입 닫힘 · 계보 판정이 빠진다) ②"없다"는 조회가 성공했을 때만 기억한다. 조회 오류는 던진다 — 모르는 것을 DDL 전으로 접지 않는다.
 */
export async function lineageColumnsReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() < absentUntil) return false;
  if (!checking) {
    checking = (async () => {
      try {
        const r = await query(
          `SELECT COUNT(*)::int AS n FROM information_schema.columns
            WHERE table_name = 'journeys' AND column_name IN ('lineage_id', 'entry_closed_at')`,
        );
        const ok = Number(r.rows[0]?.n || 0) === 2;
        if (ok) ready = true;
        else absentUntil = Date.now() + RECHECK_MS;
        return ok;
      } finally {
        checking = null;
      }
    })();
  }
  return checking;
}

/** 테스트 전용. */
export function resetLineageCache(value?: boolean): void {
  ready = value === true;
  absentUntil = value === false ? Date.now() + RECHECK_MS : 0;
  checking = null;
}

export interface LineageEntryState {
  /** 이 판이 지금 새 고객을 받는가(진입이 닫혔거나 여정이 없으면 false). */
  open: boolean;
  /** 잠금 뒤 다시 읽은 같은 계보 여정 id(자기 포함 · DDL 전 = [자기]). */
  lineageIds: string[];
}

/**
 * ★ 0930 Codex 2R · 3R — 진입 잠금. 같은 계보(DDL 전 = 같은 여정)에 고객을 넣는 트랜잭션(진입 워커 두 문 · 재진입 워커 · 새 판 활성화)이
 *   **호출부 트랜잭션 안에서** 이것을 먼저 잡는다(트랜잭션 끝에 풀림). 열쇠 = 계보 뿌리(COALESCE(lineage_id, id)) —
 *   새 판을 만들어도 뿌리 id 는 그대로다(createNewVersion 이 원 여정 lineage_id = id).
 *   잠금을 잡은 **뒤** 같은 연결로 진입 상태 · 계보를 다시 읽어 돌려준다 — 잠금 전에 읽어 둔 목록은 그사이 새 판이 켜졌으면 낡았다.
 *   호출부는 open 이 false 면 넣지 않고(롤백) 계보는 돌려받은 목록을 쓴다. 잠금 뒤 판정(쿨다운 · 진행 중 · 교체 닫기)은 문장마다 커밋된 것을 다시 읽는다.
 */
export async function lockLineageEntry(run: { query: (text: string, params?: any[]) => Promise<any> }, journeyId: string): Promise<LineageEntryState> {
  const ready = await lineageColumnsReady();
  const root = ready ? 'COALESCE(lineage_id, id)' : 'id';
  await run.query(
    `SELECT pg_advisory_xact_lock(hashtext('journey-entry'), hashtext((${root})::text)) FROM journeys WHERE id = $1::uuid`,
    [journeyId],
  );
  if (!ready) {
    const e = await run.query(`SELECT 1 FROM journeys WHERE id = $1::uuid`, [journeyId]);
    return { open: e.rows.length > 0, lineageIds: [journeyId] };
  }
  const r = await run.query(
    `SELECT j.entry_closed_at,
            ARRAY(SELECT j2.id::text FROM journeys j2
                   WHERE j.lineage_id IS NOT NULL AND j2.lineage_id = j.lineage_id AND j2.company_id = j.company_id) AS lineage
       FROM journeys j WHERE j.id = $1::uuid`,
    [journeyId],
  );
  if (r.rows.length === 0) return { open: false, lineageIds: [journeyId] };
  const ids = Array.isArray(r.rows[0].lineage) ? r.rows[0].lineage.map((x: any) => String(x)) : [];
  return { open: !r.rows[0].entry_closed_at, lineageIds: [...new Set([journeyId, ...ids])] };
}

/** 여정 목록 WHERE 에 붙이는 "진입 열림" 조각. DDL 전이면 빈 문자열(옛 동작). alias 없으면 컬럼 이름만. */
export async function entryOpenClause(alias = ''): Promise<string> {
  if (!(await lineageColumnsReady())) return '';
  return ` AND ${alias ? `${alias}.` : ''}entry_closed_at IS NULL`;
}

/** 같은 계보의 여정 id(자기 포함). 계보가 없거나 DDL 전이면 [자기]. */
export async function lineageJourneyIds(journeyId: string): Promise<string[]> {
  if (!(await lineageColumnsReady())) return [journeyId];
  const r = await query(
    `SELECT j2.id FROM journeys j1
       JOIN journeys j2 ON j2.lineage_id = j1.lineage_id AND j2.company_id = j1.company_id
      WHERE j1.id = $1::uuid AND j1.lineage_id IS NOT NULL`,
    [journeyId],
  );
  const ids = r.rows.map((x: any) => String(x.id));
  return [...new Set([journeyId, ...ids])];
}

/**
 * ★ 0930 Codex 3R — 새 판이 **처음** 켜질 때(커서 둘 다 비어 있음) 같은 계보의 켜진 옛 판(같은 시작 사건 · 아직 진입 열림)의 커서를 이어받는다.
 *   옛 판은 닫히는 순간부터 워커가 읽지 않는다. 이어받지 않으면 옛 판이 마지막으로 읽은 뒤 ~ 새 판이 켜진 순간 사이의 사건이
 *   어느 판에도 들어가지 않는다(매장 원장 문은 하루 단위라 최대 하루치). 멈춘 옛 판은 이어받지 않는다(멈춤 동안 밀린 사건을 새 판이 소급하지 않게).
 *   닫기(CLOSE_OTHER_VERSIONS_ENTRY_SQL) **전에** 같은 트랜잭션에서 부른다. 커서가 없는 시작 사건은 NULL 을 옮길 뿐이다(뒤의 NOW 초기화가 그대로 채운다).
 * ★ 0930 Codex 4R — 이어받을 판이 **정확히 하나**일 때만 옮긴다. 둘 이상(비정상 · 새 판을 켜면 옛 판은 닫힌다)이면 어느 커서를 골라도
 *   누락이나 재처리가 생긴다 → 옮기지 않고 sources 를 돌려준다. 호출부(activateJourney)는 sources > 1 이면 활성화 전체를 되돌린다.
 *   결과 = { sources, inherited } 한 행.
 */
export const INHERIT_ENTRY_CURSORS_SQL =
  `WITH src AS (
     SELECT o.last_event_cursor, o.last_event_cursor_id, o.last_purchase_cursor, o.last_purchase_cursor_id
       FROM journeys n
       JOIN journeys o ON o.lineage_id = n.lineage_id AND o.company_id = n.company_id AND o.id <> n.id
      WHERE n.id = $1::uuid AND n.lineage_id IS NOT NULL AND n.entry_closed_at IS NULL
        AND n.last_event_cursor IS NULL AND n.last_purchase_cursor IS NULL
        AND o.status = 'active' AND o.entry_closed_at IS NULL AND o.trigger_event = n.trigger_event
   ), upd AS (
     UPDATE journeys t SET last_event_cursor = s.last_event_cursor, last_event_cursor_id = s.last_event_cursor_id,
                           last_purchase_cursor = s.last_purchase_cursor, last_purchase_cursor_id = s.last_purchase_cursor_id
       FROM src s
      WHERE t.id = $1::uuid AND (SELECT COUNT(*) FROM src) = 1
      RETURNING t.id
   )
   SELECT (SELECT COUNT(*) FROM src)::int AS sources, (SELECT COUNT(*) FROM upd)::int AS inherited`;

/**
 * 새 판을 켤 때 같은 계보의 다른 판(켜짐 · 멈춤)의 진입을 닫는다 — 호출부 트랜잭션 안에서(run).
 * ★ 0930 Codex 1R — 켜는 판 자신의 진입이 열려 있을 때만(진입이 닫힌 옛 판을 다시 켜는 것은 진행 중 고객 마무리일 뿐 · 현재 판을 닫지 않는다).
 */
export const CLOSE_OTHER_VERSIONS_ENTRY_SQL =
  `UPDATE journeys o SET entry_closed_at = NOW(), updated_at = NOW()
     FROM journeys n
    WHERE n.id = $1::uuid AND n.lineage_id IS NOT NULL AND n.entry_closed_at IS NULL
      AND o.lineage_id = n.lineage_id AND o.company_id = n.company_id AND o.id <> n.id
      AND o.entry_closed_at IS NULL AND o.status IN ('active', 'paused')`;

// 복제 때 상태로 되돌리는(비우는) 칸. 이름 규칙으로 고른다(stats_* = 0 · *cursor* = NULL) — 없는 칸은 무시된다.
const RESET_NULL = ['archived_at', 'paused_at', 'pause_reason', 'approved_by', 'approved_at', 'last_pretest_passed_at', 'entry_closed_at', 'entry_baseline_at'];

export interface NewVersionResult { journeyId: string; existing: boolean; stepsCopied: number; variantsNotCopied: number }

/**
 * 새 판 만들기 — 켜짐 · 멈춤 여정만. 같은 계보에 이미 초안 새 판이 있으면 그것을 돌려준다(두 번 누름).
 * 여정 행 · 칸 행을 그대로 복제(상태 · 통계 · 커서 · 승인은 비움) · "이 칸 링크를 눌렀나" 조건은 새 칸 id 로 다시 잇는다.
 * A/B 변형은 옮기지 않는다(반응 통계가 판마다 따로여야 한다) — 개수를 돌려줘 화면이 알린다.
 */
export async function createNewVersion(companyId: string, journeyId: string): Promise<NewVersionResult> {
  if (!(await lineageColumnsReady())) {
    throw new JourneyInputError('새 판 기능이 아직 준비되지 않았어요(운영자 DB 갱신 대기).');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const src = await client.query(
      `SELECT id, name, status, archived_at, lineage_id, entry_closed_at FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE`,
      [journeyId, companyId],
    );
    if (src.rows.length === 0) throw new JourneyInputError('여정을 찾을 수 없어요.');
    const s = src.rows[0];
    if (s.archived_at) throw new JourneyInputError('보관한 여정은 새 판을 만들 수 없어요.');
    if (s.status !== 'active' && s.status !== 'paused') throw new JourneyInputError('초안은 그대로 고치면 돼요. 새 판은 켜짐 · 멈춤 여정에서 만듭니다.');
    if (s.entry_closed_at) throw new JourneyInputError('옛 판에서는 새 판을 만들 수 없어요. 지금 새 고객을 받는 판에서 만들어 주세요.');
    const lineage = String(s.lineage_id || s.id);
    if (!s.lineage_id) await client.query(`UPDATE journeys SET lineage_id = id WHERE id = $1::uuid AND lineage_id IS NULL`, [journeyId]);

    const draft = await client.query(
      `SELECT id FROM journeys WHERE company_id = $1::uuid AND lineage_id = $2::uuid AND status = 'draft' AND archived_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [companyId, lineage],
    );
    if (draft.rows.length > 0) {
      await client.query('COMMIT');
      return { journeyId: String(draft.rows[0].id), existing: true, stepsCopied: 0, variantsNotCopied: 0 };
    }

    const cols = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'journeys'`,
    );
    const now = new Date().toISOString();
    const newId = randomUUID();
    const override: Record<string, unknown> = {
      id: newId, status: 'draft', lineage_id: lineage, created_at: now, updated_at: now,
      name: `${String(s.name || '여정').replace(/ \(새 판\)$/, '').slice(0, 90)} (새 판)`,
    };
    for (const c of cols.rows as Array<{ column_name: string; data_type: string }>) {
      const n = c.column_name;
      if (RESET_NULL.includes(n) || n.includes('cursor')) override[n] = null;
      else if (n.startsWith('stats_')) override[n] = 0;
    }
    await client.query(
      `INSERT INTO journeys SELECT (jsonb_populate_record(NULL::journeys, to_jsonb(j) || $2::jsonb)).* FROM journeys j WHERE j.id = $1::uuid`,
      [journeyId, JSON.stringify(override)],
    );
    const steps = await client.query(
      `INSERT INTO journey_steps
       SELECT (jsonb_populate_record(NULL::journey_steps,
                 to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'journey_id', $2::uuid, 'created_at', NOW(), 'updated_at', NOW()))).*
         FROM journey_steps s WHERE s.journey_id = $1::uuid
       RETURNING id, step_order`,
      [journeyId, newId],
    );
    // "이 칸 링크를 눌렀나" — 옛 칸 id → 같은 번호의 새 칸 id.
    const oldSteps = await client.query(`SELECT id, step_order FROM journey_steps WHERE journey_id = $1::uuid`, [journeyId]);
    const orderOfOld = new Map(oldSteps.rows.map((x: any) => [String(x.id), Number(x.step_order)]));
    const newIdOfOrder = new Map(steps.rows.map((x: any) => [Number(x.step_order), String(x.id)]));
    const conds = await client.query(
      `SELECT id, condition_jsonb FROM journey_steps WHERE journey_id = $1::uuid AND step_type = 'condition' AND condition_jsonb->>'type' = 'step_link_clicked'`,
      [newId],
    );
    for (const c of conds.rows as any[]) {
      const oldRef = String(c.condition_jsonb?.step_id || '');
      const mapped = newIdOfOrder.get(orderOfOld.get(oldRef) ?? -1);
      const next = { ...(c.condition_jsonb || {}), step_id: mapped || null };
      await client.query(`UPDATE journey_steps SET condition_jsonb = $2::jsonb WHERE id = $1::uuid`, [c.id, JSON.stringify(next)]);
    }
    await client.query('COMMIT');
    // 트랜잭션 밖에서 센다(실패해도 새 판은 이미 만들어졌다 · 알림용 숫자일 뿐).
    const variants = await query(
      `SELECT COUNT(*)::int AS n FROM journey_step_variants v JOIN journey_steps s ON s.id = v.step_id WHERE s.journey_id = $1::uuid`,
      [journeyId],
    ).catch(() => ({ rows: [{ n: 0 }] }));
    return { journeyId: newId, existing: false, stepsCopied: steps.rows.length, variantsNotCopied: Number(variants.rows[0]?.n || 0) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * 진입이 닫혔고 진행 중 고객이 모두 끝난 옛 판을 끝남(ended)으로 — 진입 워커 회차 끝에서 부른다. DDL 전이면 0.
 * 멈춘(paused) 옛 판은 건드리지 않는다(담당자가 멈춘 것 · 진행 중 고객이 남아 있을 수 있다).
 */
export async function endDrainedVersions(): Promise<number> {
  if (!(await lineageColumnsReady())) return 0;
  const r = await query(
    `UPDATE journeys j SET status = 'ended', updated_at = NOW()
      WHERE j.status = 'active' AND j.entry_closed_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM journey_executions e WHERE e.journey_id = j.id AND e.status = 'active')
      RETURNING j.id`,
  );
  return r.rows.length;
}
