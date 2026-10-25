// packages/backend/src/utils/journey-pause-handler.ts
// CT-94: 즉시 정지 token 발급 + 정지 실행 + 기록 보존 (D218+ 신설)
//   - HMAC-SHA256 token 발급 (24h TTL)
//   - 정지 페이지 진입 시 token 검증
//   - 확인 버튼 1 클릭 → DB 트랜잭션 (status + cancel + 기록)
//   - journey_step_pause_logs 영구 보존 — Harold + admin 직접 분석 영역
//
// ★ 2026-10-18 정지 링크 결함 5 정정(설계서 docs/2026-10-18-planner-v2-design.md §3-1)
//   ① [이 발송 정지] = 누르는 순간 그 여정 · 그 단계 · 그날(KST) · active 실행 **전부**를 잠그고 멈춘다(옛: 대표 1건뿐)
//   ② 서명 키 기본값 삭제 — 미설정이면 발급 throw · 검증 null(저장소 문자열로 위조되지 않는다) · 비교는 상수 시간
//   ③ 토큰은 주소 # 뒤 · API 는 헤더(X-Journey-Pause-Token)로만(옛: 주소 경로 = 접근 로그 · Referer 로 샌다)
//   ④ 링크 주소 바탕 = HANJUL_BASE_URL(옛: 단축 주소 변수)
//   ⑤ 정지 기록의 번호 = 토큰에 실린 받은 번호(옛: 담당자 직접 입력) · 결과는 사실대로(이미 보내는 중인 건수를 센다)

import crypto from 'crypto';
import { query, pool } from '../config/database';
import { pauseJourneyLineage } from './journey-lineage';

export interface PauseTokenInput {
  stepId: string;
  executionId: string | null;
  companyId: string;
  journeyId: string;
  /** ★ 2026-10-18 이 링크를 받는 담당자 번호(정지 기록에 남는다) */
  phone?: string | null;
  /** ★ 2026-10-18 발송 날짜(KST 'YYYY-MM-DD') — [이 발송 정지]의 범위 */
  sendDate?: string | null;
}

export interface PauseTokenPayload {
  step_id: string;
  execution_id: string | null;
  company_id: string;
  journey_id: string;
  expires_at: number; // unix ms
  phone?: string;
  send_date?: string;
}

/** API 운반 헤더(★ 2026-10-18 · 주소에 싣지 않는다) */
export const JOURNEY_PAUSE_TOKEN_HEADER = 'x-journey-pause-token';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** 서명 키 — 기본값 없음(★ 2026-10-18). 없으면 발급 · 검증이 전부 닫힌다(fail-closed). 지연 판정이라 테스트는 env 주입으로 충분하다. */
function pauseSecret(): string | null {
  const s = String(process.env.JOURNEY_PAUSE_TOKEN_SECRET || '').trim();
  return s || null;
}

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

/**
 * 정지 token 발급 (24h TTL).
 * 옛 short-url 패턴 정합 (HMAC-SHA256 서명). 키가 없으면 던진다 — 부르는 쪽이 링크 줄만 빼고 안내는 보낸다.
 */
export async function generatePauseToken(input: PauseTokenInput): Promise<string> {
  const secret = pauseSecret();
  if (!secret) throw new Error('JOURNEY_PAUSE_TOKEN_SECRET 미설정: 여정 정지 링크를 발급할 수 없습니다.');
  const payload: PauseTokenPayload = {
    step_id: input.stepId,
    execution_id: input.executionId,
    company_id: input.companyId,
    journey_id: input.journeyId,
    expires_at: Date.now() + TOKEN_TTL_MS,
    ...(input.phone ? { phone: String(input.phone).replace(/\D/g, '').slice(0, 20) } : {}),
    ...(input.sendDate && /^\d{4}-\d{2}-\d{2}$/.test(input.sendDate) ? { send_date: input.sendDate } : {}),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

/**
 * Token 검증 + payload 반환. 만료/위조/키 없음 시 null.
 */
export async function verifyPauseToken(token: string): Promise<PauseTokenPayload | null> {
  const secret = pauseSecret();
  if (!secret) return null;
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(String(sig || ''));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PauseTokenPayload;
    if (!payload || !Number.isFinite(Number(payload.expires_at)) || payload.expires_at < Date.now()) return null;
    if (!payload.step_id || !payload.journey_id || !payload.company_id) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 담당자 문자에 싣는 정지 주소 — 토큰은 # 뒤(서버 접근 로그 · Referer 로 새지 않는다 · 대행 · 플래너와 같은 축). */
export function buildJourneyPauseUrl(token: string): string {
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  return `${base}/journey-pause#t=${token}`;
}

/** (순수) KST 오늘 'YYYY-MM-DD' */
function kstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 토큰의 정지 날짜 — 새 토큰은 실려 있다 · 옛 토큰(24시간 안에 이미 나간 것)은 대표 실행의 예정 날짜 · 그것도 없으면 오늘 */
async function resolvePauseDate(payload: PauseTokenPayload): Promise<string> {
  if (payload.send_date) return payload.send_date;
  if (payload.execution_id) {
    const r = await query(
      `SELECT (next_run_at AT TIME ZONE 'Asia/Seoul')::date::text AS d FROM journey_executions WHERE id = $1::uuid AND journey_id = $2::uuid`,
      [payload.execution_id, payload.journey_id],
    );
    if (r.rows[0]?.d) return String(r.rows[0].d);
  }
  return kstToday();
}

/** 그 여정 · 그 단계 · 그날 · active 실행을 고르는 조건(조회 · 잠금이 같은 문장 조각을 쓴다) */
const DUE_EXECUTIONS_SQL = `
  FROM journey_executions je
  JOIN LATERAL (
    SELECT s.id FROM journey_steps s
     WHERE s.journey_id = je.journey_id AND s.step_order > je.current_step_order
     ORDER BY s.step_order ASC LIMIT 1
  ) nx ON nx.id = $2::uuid
 WHERE je.journey_id = $1::uuid AND je.status = 'active'
   AND (je.next_run_at AT TIME ZONE 'Asia/Seoul')::date = $3::date`;

/** 그 단계 · 그날 이미 보내기 시작했거나(sending) 보낸(sent) 건수 — 정지가 막지 못한 몫을 사실대로 답한다(B9). */
async function countStartedSends(db: { query: (t: string, p?: any[]) => Promise<any> }, journeyId: string, stepId: string, date: string): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM journey_step_logs l
       JOIN journey_executions e ON e.id = l.execution_id
      WHERE e.journey_id = $1::uuid AND l.step_id = $2::uuid AND l.status IN ('sending', 'sent')
        AND (l.sent_at AT TIME ZONE 'Asia/Seoul')::date = $3::date`,
    [journeyId, stepId, date],
  );
  return Number(r.rows[0]?.n) || 0;
}

export interface PauseView {
  journeyName: string;
  journeyStatus: string;
  stepOrder: number;
  channel: string;
  messageSubject: string | null;
  messageBody: string;
  sendDate: string;
  /** 지금 멈출 수 있는 그날 실행 수(누르는 순간 다시 센다) */
  dueCount: number;
  /** 그날 이미 보내기 시작했거나 보낸 수 */
  startedCount: number;
}

/** 정지 화면 재료 — 토큰이 무효면 null(같은 404). 본문은 실발송이 쓰는 최신 스냅샷. */
export async function loadPauseView(token: string): Promise<PauseView | null> {
  const payload = await verifyPauseToken(token);
  if (!payload) return null;
  const snap = await query(
    `SELECT s.message_body, s.message_subject, s.channel, j.name AS journey_name, j.status AS journey_status, jstep.step_order
       FROM journey_step_snapshots s
       JOIN journeys j ON j.id = s.journey_id AND j.company_id = $3::uuid
       JOIN journey_steps jstep ON jstep.id = s.step_id
      WHERE s.step_id = $1::uuid AND s.journey_id = $2::uuid
      ORDER BY s.created_at DESC LIMIT 1`,
    [payload.step_id, payload.journey_id, payload.company_id],
  );
  const row = snap.rows[0];
  if (!row) return null;
  const sendDate = await resolvePauseDate(payload);
  const due = await query(`SELECT COUNT(*)::int AS n ${DUE_EXECUTIONS_SQL}`, [payload.journey_id, payload.step_id, sendDate]);
  return {
    journeyName: String(row.journey_name || '여정 자동 발송'),
    journeyStatus: String(row.journey_status || ''),
    stepOrder: Number(row.step_order) || 0,
    channel: String(row.channel || ''),
    messageSubject: row.message_subject ?? null,
    messageBody: String(row.message_body || ''),
    sendDate,
    dueCount: Number(due.rows[0]?.n) || 0,
    startedCount: await countStartedSends({ query }, payload.journey_id, payload.step_id, sendDate),
  };
}

export type PauseStepResult =
  | { ok: true; paused: number; startedCount: number | null; sendDate: string }
  | { ok: false; error: 'token_invalid_or_expired' };

/**
 * [이 발송 정지] — 누르는 순간 그 여정 · 그 단계 · 그날 · active 실행을 **다시 조회해** 한 트랜잭션에서 잠그고 멈춘다(M4).
 * 그 뒤 새로 들어온 실행은 이 정지로 막지 못한다(화면 결과 문장 · [여정 전체 일시정지] 안내).
 * 실행부는 발송 직전에 정지를 다시 본다(journey-executor 시점 2) — 이미 그 지점을 지난 건은 sending/sent 표식으로 세어 사실대로 답한다(B9).
 */
export async function pauseStepForDay(token: string, pauseTriggerSource = 'manager_link'): Promise<PauseStepResult> {
  const payload = await verifyPauseToken(token);
  if (!payload) return { ok: false, error: 'token_invalid_or_expired' };
  const sendDate = await resolvePauseDate(payload);
  const client = await pool.connect();
  let paused = 0;
  try {
    await client.query('BEGIN');
    const owner = await client.query(`SELECT 1 FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [payload.journey_id, payload.company_id]);
    if (!owner.rows[0]) { await client.query('ROLLBACK'); return { ok: false, error: 'token_invalid_or_expired' }; }
    const due = await client.query(`SELECT je.id ${DUE_EXECUTIONS_SQL} FOR UPDATE OF je`, [payload.journey_id, payload.step_id, sendDate]);
    const ids = (due.rows as any[]).map((r) => String(r.id));
    if (ids.length > 0) {
      // ★ 2026-10-25 여정 구조체크 2차 #4(R6) — 그날 정지 = 그 실행을 끝냄(ended). 다시 켜기가 되살리지 않는 멈춤이라
      //   옛 `paused` 는 영원히 「진행 중」으로 남아 칸 고치기를 잠그고 지도 숫자를 부풀렸다(닫는 자리가 없는 상태).
      const up = await client.query(
        `UPDATE journey_executions SET status = 'ended', completed_at = NOW() WHERE id = ANY($1::uuid[]) AND status = 'active' RETURNING id`,
        [ids],
      );
      paused = up.rows.length;
    }
    const snapRes = await client.query(
      `SELECT id, message_body FROM journey_step_snapshots
        WHERE step_id = $1 AND journey_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [payload.step_id, payload.journey_id],
    );
    const snapshot = snapRes.rows[0];
    // 영구 기록 1행 — 멈춘 수 = target_count_snapshot(옛: 늘 0) · 대표 실행 = 토큰의 실행
    await client.query(
      `INSERT INTO journey_step_pause_logs
         (company_id, journey_id, step_id, execution_id, snapshot_id,
          pause_reason, pause_trigger_source, paused_phone,
          message_body_snapshot, target_count_snapshot, execution_status_at_pause)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        payload.company_id, payload.journey_id, payload.step_id, payload.execution_id,
        snapshot?.id || null, 'manager_manual', pauseTriggerSource, payload.phone || null,
        snapshot?.message_body || null, paused, paused > 0 ? 'active' : null,
      ],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* 원 오류 우선 */ });
    throw err;
  } finally {
    client.release();
  }
  // ★ Codex C 1R — 정지는 위에서 커밋됐다. 이 집계가 실패해도 정지 실패가 아니다(못 센 수 = null · 화면이 「확인하지 못했어요」)
  const startedCount = await countStartedSends({ query }, payload.journey_id, payload.step_id, sendDate).catch((e: any) => {
    console.warn(`[journey-pause] 이미 시작 수 집계 실패(정지는 완료) journey=${payload.journey_id}:`, e?.message || e);
    return null;
  });
  console.log(`[journey-pause] 그날 정지 journey=${payload.journey_id} step=${payload.step_id} date=${sendDate} 멈춤 ${paused} · 이미 시작 ${startedCount ?? '모름'}`);
  return { ok: true, paused, startedCount, sendDate };
}

/** [여정 전체 일시정지] — 같은 토큰 · 기존 CT(pauseJourney) · 기록 1행. 반환 = 이번에 멈췄는가(이미 멈춘 여정이면 false). */
export async function pauseJourneyByToken(token: string): Promise<{ ok: true; changed: boolean } | { ok: false; error: 'token_invalid_or_expired' }> {
  const payload = await verifyPauseToken(token);
  if (!payload) return { ok: false, error: 'token_invalid_or_expired' };
  const before = await query(`SELECT status FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`, [payload.journey_id, payload.company_id]);
  if (!before.rows[0]) return { ok: false, error: 'token_invalid_or_expired' };
  const wasActive = String(before.rows[0].status) === 'active';
  // ★ 2026-10-20 여정 V.3 §6-5 — 사람 멈춤 = 같은 계보의 켜진 판 전부(옛 판 마무리분 포함).
  await pauseJourneyLineage(payload.company_id, payload.journey_id, '담당자가 안내 문자 링크에서 여정 전체를 일시정지했습니다.');
  // ★ Codex C 1R — 멈춤은 위 CT 가 끝냈다. 뒤 조회 · 기록이 실패해도 실패로 답하지 않는다(조회 실패 = 멈춘 CT 가 성공한 것으로 · 기록 실패 = 로그)
  const after = await query(`SELECT status FROM journeys WHERE id = $1::uuid`, [payload.journey_id]).catch(() => null);
  const changed = wasActive && (after ? String(after.rows[0]?.status) === 'paused' : true);
  await query(
    `INSERT INTO journey_step_pause_logs
       (company_id, journey_id, step_id, execution_id, pause_reason, pause_trigger_source, paused_phone, target_count_snapshot, execution_status_at_pause)
     VALUES ($1, $2, $3, $4, 'manager_manual', 'manager_link_journey', $5, 0, $6)`,
    [payload.company_id, payload.journey_id, payload.step_id, payload.execution_id, payload.phone || null, String(before.rows[0].status)],
  ).catch((e: any) => console.warn('[journey-pause] 전체 정지 기록 실패(정지는 유지):', e?.message || e));
  return { ok: true, changed };
}

/**
 * 여정 전체 정지 (status='active' → 'paused'). 스팸 끝까지 걸린 step·잔액 부족 등 그 step 본문 자체가 문제일 때
 *   모든 execution 발송을 한 번에 차단. 스캐너 등 외부 호출 공용 CT.
 *   (journey-executor.ts 안 file-local pauseJourney와 동일 UPDATE — 컬럼은 journeys 실재 확인.)
 */
export async function pauseJourney(journeyId: string, reason: string): Promise<void> {
  await query(
    `UPDATE journeys SET status = 'paused', paused_at = NOW(), pause_reason = $2, updated_at = NOW()
      WHERE id = $1::uuid AND status = 'active'`,
    [journeyId, reason.slice(0, 500)],
  );
}

/**
 * 자동 정지 (잔액 부족 / 통신사 fail 등 시스템 발화).
 * journey-executor.ts 안 실패 catch 영역에서 호출.
 */
export async function autoPauseExecution(params: {
  companyId: string;
  journeyId: string;
  stepId: string;
  executionId: string;
  // ★ 2026-10-25 #4 — 멈춤(paused)은 다시 켜기가 되살리는 사유만(journey-resume RESUME_REVIVE_REASONS · 짝 시험). 번호 오류는 끝냄(실행기).
  pauseReason: 'balance_insufficient' | 'carrier_temp_fail' | 'auto_retry_exhausted';
  pauseTriggerSource: string;
}): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // status UPDATE
    const execRes = await client.query(
      `SELECT status FROM journey_executions WHERE id = $1 FOR UPDATE`,
      [params.executionId],
    );
    const executionStatusAtPause = execRes.rows[0]?.status || null;
    await client.query(
      `UPDATE journey_executions SET status = 'paused' WHERE id = $1`,
      [params.executionId],
    );

    // snapshot 조회
    const snapRes = await client.query(
      `SELECT id, message_body FROM journey_step_snapshots
        WHERE step_id = $1 AND journey_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [params.stepId, params.journeyId],
    );
    const snapshot = snapRes.rows[0];

    // INSERT log
    await client.query(
      `INSERT INTO journey_step_pause_logs
         (company_id, journey_id, step_id, execution_id, snapshot_id,
          pause_reason, pause_trigger_source,
          message_body_snapshot, target_count_snapshot, execution_status_at_pause)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.companyId,
        params.journeyId,
        params.stepId,
        params.executionId,
        snapshot?.id || null,
        params.pauseReason,
        params.pauseTriggerSource,
        snapshot?.message_body || null,
        0,
        executionStatusAtPause,
      ],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 정지 이력 조회 (admin UI 활용).
 */
export async function getPauseLogs(
  companyId: string,
  journeyId?: string,
  limit: number = 50,
): Promise<any[]> {
  let sql = `
    SELECT l.*, j.name AS journey_name, s.step_order, s.channel
      FROM journey_step_pause_logs l
      LEFT JOIN journeys j ON j.id = l.journey_id
      LEFT JOIN journey_steps s ON s.id = l.step_id
     WHERE l.company_id = $1
  `;
  const params: any[] = [companyId];
  if (journeyId) {
    sql += ` AND l.journey_id = $2`;
    params.push(journeyId);
  }
  sql += ` ORDER BY l.paused_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const res = await query(sql, params);
  return res.rows;
}
