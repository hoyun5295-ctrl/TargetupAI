/**
 * 스팸 검사 확인 문자(★ 2026-11-01 여정 재발 방지 B1-4 · 설계서 docs/2026-11-01-journey-recurrence-prevention-design.md §2 B1-4 · §4 DDL-C · DDL-E)
 *
 * 「통신사 전달 성공 + 앱 보고 없음」은 차단이 아니라 확인 중(unconfirmed)이다(B-1101-3 · 실제로 받은 LG U+ 문자가 「차단」이었다).
 * 늦은 보고 창(10분)이 닫혀도 확인 중이면, 그 단말로 무해한 확인 문자 1통(nonce)을 보낸다.
 *   확인 문자가 5분 안에 보고되면 = 단말은 받는다 → 원 행 blocked 확정 · 안 오면 = 단말 장애 → error + 경보(정지 사유 아님).
 * 확인 문자는 본문 있는 보고를 보내는 단말(last_body_report_at 7일 안)에만 보낸다 — 그 밖은 확인 문자 없이 error + 경보.
 * 표 · 칸이 없으면(DDL 전) 확인 문자 0 · 창 닫힘에 error + 경보(멈춤 0).
 *
 * 닫히는 상태(R6): 확인 중 행은 창 10분 + 확인 문자 5분 + 재claim 2분 안에 pass · blocked · error 중 하나로 닫힌다.
 * 멱등 · 상한(R8): claim = 행당 하나(result_id UNIQUE) · 발송 전 죽은 claim 은 2분 뒤 한 번만 다시(attempts ≤ 2) · 그 뒤 expired → error.
 */
import { randomBytes } from 'crypto';
import pool, { query } from '../config/database';
import { DIAG_LOCK_SQL, diagLockKey, diagEnabledFor, isDiagTest, judgeDiagProbeSend, diagCallbackAllowed, type DiagGate } from './spam-diag-gate';   // ★ 1124 확인 판 발송 관문
import { insertTestSmsQueue } from './sms-queue';
import { sendSystemAlert } from './system-alert';
import { SPAM_RESULT } from './sms-result-map';
import { computeMessageHash, spamReportHash, decideUnconfirmed, spamStampReady, SPAM_LATE_REPORT_MINUTES, spamProbeAfterMinutesSql } from './spam-test-queue';
import { kstDateTag } from './ai-credit-calc';   // ★ C150 하루 측정 경보 키의 한국 날짜(R104)
import { spamCustomerTestSql } from './spam-trial';   // ★ 1124 확인 판 제외

export const PROBE_DEADLINE_MINUTES = 5;
export const PROBE_RECLAIM_MINUTES = 2;
export const PROBE_MAX_ATTEMPTS = 2;
/**
 * ★ 2026-11-24 확인 판 확인 문자 적재 상한(ms · Codex 구현 5R ~ 11R) — 관문 시각부터 이 안에서만 MySQL(적재 CT 의 mysqlDeadline · INSERT 문장만 withBoundedMysql · 대행 담당자 문자 적재 상한 NOTIFY_TIMEOUT_MS 와 같은 값).
 *   응답 기한은 관문 시각에 한 번만 정한다 = 관문 시각 + 이 상한 + PROBE_DEADLINE_MINUTES(적재가 상한 안에 끝나면 적재 뒤 최소 5분 · 기한을 다시 쓰는 일 0).
 */
export const DIAG_PROBE_LOAD_WAIT_MS = 60_000;
export const PROBE_DEVICE_FRESH_DAYS = 7;
const PROBE_BATCH = 20;
const PROBE_CYCLE_MS = 30_000;
const LOG = '[spam-probe]';

/**
 * 화면이 다시 읽기를 멈추는 때(순수) — 확인 중 행이 있는 닫힌 검사: 닫힌 때 + 늦은 보고 창 + 확인 문자 기한 + 다시 보내기 + 주기 여유 2분.
 *   ★ 1124 확인 중 행 없이 막힘 행이 있으면: 닫힌 때 + 늦은 보고 창(그 안이면 통과로 고쳐질 수 있다). 둘 다 없거나 아직 안 닫혔으면 null.
 */
export function spamTestFinalBy(completedAt: string | Date | null | undefined, rows: ReadonlyArray<{ result?: string | null }>): string | null {
  if (!completedAt) return null;
  const at = new Date(completedAt).getTime();
  if (!Number.isFinite(at)) return null;
  if (rows.some((r) => r.result === SPAM_RESULT.UNCONFIRMED)) {
    return new Date(at + (SPAM_LATE_REPORT_MINUTES + PROBE_DEADLINE_MINUTES + PROBE_RECLAIM_MINUTES + 2) * 60_000).toISOString();
  }
  // ★ 2026-11-24 확인 문자 시작 1분(SPAM_PROBE_AFTER_MINUTES · 사람 검사 포함) — 막힘이 늦은 보고 창(닫힌 뒤 10분) 안에서 정해질 수 있어,
  //   그 창 안에 원 문자 보고가 닿으면 서버가 차단 줄을 통과로 고친다(spamRowLateMinutesSql · 막힘 줄 = 10분) → 열린 창은 창 끝까지 다시 읽는다(Codex 1R)
  if (rows.some((r) => r.result === SPAM_RESULT.BLOCKED)) return new Date(at + SPAM_LATE_REPORT_MINUTES * 60_000).toISOString();
  return null;
}

/** 확인 문자 본문 — 고정 무해 글 + nonce(해시가 확인 문자마다 유일하다) */
export function probeText(nonce: string): string {
  return `[한줄로 검사 확인] ${nonce}`;
}

// ── 표 · 칸 유무(DDL-C 표 · DDL-E 칸) — 참은 기억 · 거짓은 5분 뒤 다시 ──
let _probes = false;
let _body = false;
let _absentUntil = 0;
export async function spamProbeSchemaReady(): Promise<{ probes: boolean; body: boolean }> {
  if ((_probes && _body) || Date.now() < _absentUntil) return { probes: _probes, body: _body };
  const r = await query(
    `SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'spam_test_probes')::int AS probes,
            (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'spam_filter_devices' AND column_name = 'last_body_report_at')::int AS body`,
  );
  _probes = Number(r.rows[0]?.probes || 0) === 1;
  _body = Number(r.rows[0]?.body || 0) === 1;
  if (!(_probes && _body)) _absentUntil = Date.now() + 5 * 60_000;
  return { probes: _probes, body: _body };
}
/** 시험 전용 */
export function resetSpamProbeSchemaCache(probes?: boolean, body?: boolean): void {
  _probes = probes === true;
  _body = body === true;
  _absentUntil = probes === undefined && body === undefined ? 0 : Date.now() + 5 * 60_000;
}

function alertDevice(phone: string, carrier: string, why: string): void {
  void sendSystemAlert({
    companyId: null,   // 검사 단말 = 우리 장비(회사 일 아님)
    dedupKey: `spam-probe-device:${carrier}:${phone}`,
    message: `스팸 검사 단말 확인 필요(${carrier} ${phone}) — ${why}. 그 단말의 「확인 중」 결과를 「검사 장애」로 닫았습니다(차단으로 보지 않음 · 자동 발송은 다음 회차에 다시 검사).`,
  }).catch(() => undefined);
}

type ClosedProbe = { resultId: string; phone: string; carrier: string; closed: boolean };

/**
 * 확인 문자 한 줄 닫기 + 원 행 확정 = 한 문장(★ Codex 구현 1R #5 — 확인 문자만 닫히고 원 행이 확인 중으로 영영 남는 길 0).
 *   원 행은 아직 확인 중일 때만 바꾼다(늦은 보고가 먼저 통과로 고쳤으면 그대로) · closed = 이번에 원 행을 닫았는가.
 *   ★ 2026-11-24 oneRowWhere = 한 줄만 고르는 조건(id · 유일 키 message_hash · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md · 배포 2 Codex 5R · 6R 구조).
 *     한 문장이 쥐는 것 = 확인 문자 한 줄 + 그 결과 행 하나 → 진단 잠금을 쥐고 판의 확인 문자 → 결과 행을 여러 줄 잡는 쪽(spam-diag lockDiagResultRows)과 고리가 생기지 않는다.
 *     기한 같은 시각 조건도 고르기와 쓰기가 같은 문장(같은 NOW())이다.
 */
async function closeProbeRow(oneRowWhere: string, params: any[], probeTo: 'received' | 'expired', resultTo: 'blocked' | 'error'): Promise<ClosedProbe | null> {
  const stamped = await spamStampReady().catch(() => false);
  const r = await query(
    `WITH p AS (
       UPDATE spam_test_probes SET status = '${probeTo}', decided_at = NOW()
        WHERE ${oneRowWhere}
        RETURNING result_id, phone, carrier
     ), x AS (
       UPDATE spam_filter_test_results t SET result = $${params.length + 1}${stamped ? ', decided_at = NOW()' : ''}
         FROM p WHERE t.id = p.result_id AND t.result = '${SPAM_RESULT.UNCONFIRMED}'
        RETURNING t.id
     )
     SELECT p.result_id, p.phone, p.carrier, (p.result_id IN (SELECT id FROM x)) AS closed FROM p`,
    [...params, resultTo],
  );
  const x = (r.rows as any[])[0];
  return x ? { resultId: String(x.result_id), phone: String(x.phone), carrier: String(x.carrier), closed: x.closed === true } : null;
}

/**
 * 정리 주기의 여러 줄 닫기 = 대상 id 를 먼저 읽고 한 줄씩 closeProbeRow(같은 조건을 다시 건다 · 겹쳐 돌아도 줄마다 한쪽만) ·
 *   줄이 커밋되면 바로 onClosed(셈 · 단말 경보) — 뒤 줄이 던져도 앞 줄의 경보는 이미 났다(★ 배포 2 Codex 6R).
 */
async function closeProbes(probeWhere: string, params: any[], probeTo: 'received' | 'expired', resultTo: 'blocked' | 'error', onClosed: (r: ClosedProbe) => void): Promise<void> {
  const ids = await query(`SELECT id FROM spam_test_probes WHERE ${probeWhere} ORDER BY id`, params);
  for (const { id } of ids.rows as Array<{ id: string }>) {
    const r = await closeProbeRow(`id = $${params.length + 1} AND ${probeWhere}`, [...params, id], probeTo, resultTo);
    if (r) onClosed(r);
  }
}

/**
 * ★ 2026-11-24 확인 판의 확인 문자 한 통 = 관문 아래 적재(설계서 docs/2026-11-23-spam-block-cause-hint-design.md §6-2-1).
 *   ★ Codex 구현 2R 구조 — 잠금 아래에서는 판정과 「보내기로 정함」 표시(sent · 기한)까지만 하고 커밋(잠금 풀림) → MySQL 적재는 잠금 밖.
 *     sent 를 먼저 적으므로 첫 선점 · 다시 보내기가 둘 다 와도 뒤에 온 쪽은 claimed 가 아니라 내 것 아님(한 통).
 *     ★ Codex 구현 3R ~ 7R 구조 — 기한은 이 표시 한 번에 정한다 = 관문 시각(gateAt) + 적재 상한(60초) + 5분 · 적재 상한도 같은 gateAt 부터.
 *     적재 = MySQL 절대 기한(gateAt + 60초 · INSERT 문장만 상한 있는 연결 · 넘기면 연결을 버리고 던짐) · 상한 안에 끝나면 적재 뒤 최소 5분이 보고 창 · 적재가 던지거나 기한을 넘기면 기한 처리가 닫는다 ·
 *     다시 보내지 않는다. 기한을 다시 쓰는 갱신 · 기한 빈 상태 · 그 정리가 없다(그 사이 경계가 없다).
 *   순서 = 도장 칸 값(잠금 앞) → BEGIN → 부모 진단 잠금 → 확인 문자 행 · 결과 행 FOR UPDATE → 저장점 → 권한(같은 연결 · 엄격) → 관문 → 표시 · 커밋 → 적재.
 *   내 것 아님(claimed 가 아님) = 아무것도 안 씀 · 거부 = 확인 문자 expired + 결과가 아직 unconfirmed 일 때만 error(정해진 결과는 둔다).
 */
export async function sendDiagProbe(p: { id: string; phone: string; nonce: string; callback: string }, k: { parentTestId: string | null; testId: string; companyId: string; userId: string; createdAt: unknown }): Promise<void> {
  const stamped = await spamStampReady().catch(() => false);   // 잠금 안 거부 쓰기가 같은 풀을 다시 쓰지 않게 값으로 넘긴다
  const client = await pool.connect();
  const run = (sql: string, params?: any[]) => client.query(sql, params);
  let switchOn = false;   // ★ 2026-11-24 회사 스위치 = 잠금 아래 같은 연결로(저장점 안 · 조회 오류 = 꺼짐)
  let decided: DiagGate = 'reject';
  let gateAt = 0;
  try {
    await client.query('BEGIN');
    await client.query(DIAG_LOCK_SQL, [diagLockKey(k.parentTestId || k.testId)]);
    const cur = await client.query(
      `SELECT p.status AS probe_status, r.id AS result_id, r.result
         FROM spam_test_probes p JOIN spam_filter_test_results r ON r.id = p.result_id
        WHERE p.id = $1
        FOR UPDATE OF p, r`,
      [p.id],
    );
    const c = cur.rows[0];
    const mine = !!c && c.probe_status === 'claimed';
    let callbackAllowed = false;
    await client.query('SAVEPOINT diag_gate');
    if (mine && k.parentTestId) {
      try {
        switchOn = await diagEnabledFor(k.companyId, run);
        if (switchOn) callbackAllowed = await diagCallbackAllowed(k.companyId, k.userId, p.callback, run);
      } catch (err: any) {
        await client.query('ROLLBACK TO SAVEPOINT diag_gate');
        console.warn(`${LOG} 확인 판 권한 조회 실패 — 보내지 않고 닫는다 probe=${p.id}:`, err?.message || err);
      }
    }
    decided = judgeDiagProbeSend({
      switchOn, probeStatus: c ? String(c.probe_status) : '', result: c ? (c.result ?? null) : null,
      diagCreatedAtMs: new Date(k.createdAt as any).getTime(), nowMs: Date.now(), hasParent: !!k.parentTestId, callbackAllowed,
    });
    if (decided === 'pass') {
      // ★ Codex 구현 7R — 기한과 적재 상한을 같은 기준 시각(gateAt · 이 프로세스 시계 = PG 와 같은 장비)에서 잰다
      gateAt = Date.now();
      await client.query(
        `UPDATE spam_test_probes SET status = 'sent', sent_at = $2::timestamptz, deadline_at = $3::timestamptz
          WHERE id = $1 AND status = 'claimed'`,
        [p.id, new Date(gateAt), new Date(gateAt + DIAG_PROBE_LOAD_WAIT_MS + PROBE_DEADLINE_MINUTES * 60_000)],
      );
    } else if (decided === 'reject') {
      await client.query(`UPDATE spam_test_probes SET status = 'expired', decided_at = NOW() WHERE id = $1 AND status = 'claimed'`, [p.id]);
      if (c?.result_id) await decideUnconfirmed(String(c.result_id), 'error', run, stamped);   // 아직 unconfirmed 일 때만 바뀐다(CT 조건)
      console.log(`${LOG} 확인 판 확인 문자 관문 거부 — 보내지 않고 닫음 probe=${p.id} parent=${k.parentTestId || '-'}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  if (decided !== 'pass') return;
  // 잠금 밖 적재(위에서 sent · 기한으로 정한 한 통) — ★ Codex 구현 5R ~ 11R: MySQL 절대 기한 = gateAt + 60초. 적재 CT 가 준비(PG 조회 · 판정)를 연결 밖에서 하고
  //   INSERT 문장만 상한 있는 연결(withBoundedMysql)로 한다 · 넘기면 그 연결을 버리고 던진다(멈춘 적재가 공용 발송 풀을 쌓아 막지 않음 · 다음 확인 문자는 새 연결) ·
  //   남은 시간이 없으면 연결을 빌리지 않고 던진다. 던짐 = 위로(주기가 로그만 · 행은 sent 라 다시 보내지 않음 · 기한 처리가 닫는다).
  //   끊어도 서버 쪽 INSERT 는 끝날 수 있다 — 그 한 통의 보고도 기한 안이면 받는다(단말이 이 번호의 문자를 받는다는 사실 · 적재 시각과 무관).
  await insertTestSmsQueue(p.phone, p.callback, probeText(p.nonce), 'SMS', p.id, '', undefined, { mysqlDeadline: gateAt + DIAG_PROBE_LOAD_WAIT_MS });
}

/**
 * 확인 문자 한 통을 보내고 sent 로 적는다(claim 을 가진 손만 부른다).
 *   ★ 2026-11-24 — 부르는 자리(첫 선점 · 다시 보내기)에 기대지 않고 이 함수가 그 검사의 출처를 스스로 읽어, 확인 판이면 관문(sendDiagProbe)으로 간다.
 *   diag_of 는 to_jsonb 로만 읽는다(DDL 전에도 이 문장이 깨지지 않는다 · 확인 판 행은 DDL 뒤에만 생긴다).
 */
async function sendProbe(p: { id: string; phone: string; nonce: string; callback: string }): Promise<void> {
  const kind = await query(
    `SELECT t.id AS test_id, t.source, t.company_id, t.user_id, t.created_at, (to_jsonb(t) ->> 'diag_of') AS diag_of
       FROM spam_test_probes sp JOIN spam_filter_test_results r ON r.id = sp.result_id JOIN spam_filter_tests t ON t.id = r.test_id
      WHERE sp.id = $1`,
    [p.id],
  );
  const k = kind.rows[0];
  if (k && isDiagTest(k.source)) {
    await sendDiagProbe(p, { parentTestId: k.diag_of ? String(k.diag_of) : null, testId: String(k.test_id), companyId: String(k.company_id), userId: String(k.user_id), createdAt: k.created_at });
    return;
  }
  await insertTestSmsQueue(p.phone, p.callback, probeText(p.nonce), 'SMS', p.id, '');
  await query(
    `UPDATE spam_test_probes SET status = 'sent', sent_at = NOW(), deadline_at = NOW() + INTERVAL '${PROBE_DEADLINE_MINUTES} minutes'
      WHERE id = $1 AND status = 'claimed'`,
    [p.id],
  );
}

/**
 * 한 주기(30초) — ① 기한 지난 확인 문자 = error ② 발송 전에 멈춘 claim 다시(상한 뒤 error) ③ 창 닫힌 확인 중 행 claim · 발송.
 *   각 단계는 조건부 문장이라 겹쳐 돌아도 행마다 한쪽만 쓴다.
 */
export async function runSpamProbeCycle(): Promise<{ claimed: number; errored: number; expired: number }> {
  const out = { claimed: 0, errored: 0, expired: 0 };
  // ★ 2026-11-24 단계 중간에 한 줄이 던져도 이미 커밋된 줄의 셈은 주기 기록에 남긴다(줄마다 커밋 · 배포 2 Codex 7R) · 오류는 그대로 워커로
  try {
    await probeCycleSteps(out);
  } finally {
    if (out.claimed || out.errored || out.expired) console.log(`${LOG} 주기 — 보냄 ${out.claimed} · 단말 확인 불가 ${out.errored} · 기한 지남 ${out.expired}`);
  }
  return out;
}

async function probeCycleSteps(out: { claimed: number; errored: number; expired: number }): Promise<void> {
  const ready = await spamProbeSchemaReady();

  if (ready.probes) {
    // ⓪ 닫힌 확인 문자인데 원 행이 아직 확인 중(옛 분리 쓰기 · 수동 정리 뒤) = 그 결과로 맞춘다(R6 · 대조 복구)
    //   ★ 2026-11-24 한 문장 = 결과 행 한 줄(closeProbes 와 같은 이유 · 배포 2 Codex 5R 구조)
    const stamped = await spamStampReady().catch(() => false);
    const repair = await query(
      `SELECT t.id FROM spam_filter_test_results t JOIN spam_test_probes p ON p.result_id = t.id
        WHERE p.status IN ('received', 'expired') AND t.result = '${SPAM_RESULT.UNCONFIRMED}' ORDER BY t.id`,
    );
    for (const { id } of repair.rows as Array<{ id: string }>) {
      await query(
        `UPDATE spam_filter_test_results t SET result = CASE p.status WHEN 'received' THEN $1 ELSE $2 END${stamped ? ', decided_at = NOW()' : ''}
           FROM spam_test_probes p
          WHERE t.id = $3 AND p.result_id = t.id AND p.status IN ('received', 'expired') AND t.result = '${SPAM_RESULT.UNCONFIRMED}'`,
        ['blocked', 'error', id],
      );
    }

    // ① 기한 안에 보고가 안 온 확인 문자 = 단말 장애
    await closeProbes(`status = 'sent' AND deadline_at < NOW()`, [], 'expired', 'error', (r) => {
      out.expired++;
      if (r.closed) alertDevice(r.phone, r.carrier, `확인 문자를 ${PROBE_DEADLINE_MINUTES}분 안에 보고하지 않음`);
    });

    // ② 발송 전에 멈춘 claim — 상한 안이면 한 번 더 보내고, 넘었으면 expired → error
    //   ★ 2026-11-24 한 문장 = 확인 문자 한 줄(closeProbes 와 같은 이유 · 배포 2 Codex 5R 구조)
    const stuck = await query(
      `SELECT id FROM spam_test_probes
        WHERE status = 'claimed' AND attempts < ${PROBE_MAX_ATTEMPTS} AND claimed_at < NOW() - INTERVAL '${PROBE_RECLAIM_MINUTES} minutes' ORDER BY id`,
    );
    //   횟수를 올린 줄은 그 자리에서 바로 다시 보낸다(★ 배포 2 Codex 6R — 뒤 줄이 던져도 앞 줄의 마지막 기회가 보내기 없이 소진되지 않게)
    for (const { id } of stuck.rows as Array<{ id: string }>) {
      const one = await query(
        `UPDATE spam_test_probes p SET attempts = p.attempts + 1, claimed_at = NOW()
           FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id
          WHERE p.id = $1 AND p.result_id = r.id AND p.status = 'claimed' AND p.attempts < ${PROBE_MAX_ATTEMPTS}
            AND p.claimed_at < NOW() - INTERVAL '${PROBE_RECLAIM_MINUTES} minutes'
          RETURNING p.id, p.phone, p.nonce, t.callback_number`,
        [id],
      );
      for (const r of one.rows as any[]) {
        await sendProbe({ id: String(r.id), phone: String(r.phone), nonce: String(r.nonce), callback: String(r.callback_number) })
          .catch((e) => console.warn(`${LOG} 확인 문자 다시 보내기 실패 probe=${r.id}:`, e?.message || e));
      }
    }
    await closeProbes(
      `status = 'claimed' AND attempts >= ${PROBE_MAX_ATTEMPTS} AND claimed_at < NOW() - INTERVAL '${PROBE_RECLAIM_MINUTES} minutes'`,
      [], 'expired', 'error',
      (r) => {
        out.expired++;
        if (r.closed) alertDevice(r.phone, r.carrier, '확인 문자를 보내지 못함');
      },
    );
  }

  // ③ 확인 문자 시작 때가 지났는데 아직 확인 중인 행 — ★ 2026-11-21 C150 자동 검사 = 닫힌 뒤 1분(옛 = 늦은 보고 창 10분) · 사람 검사 = 10분 그대로
  //   확인 문자를 일찍 보내도 원 문자 늦은 보고는 늦은 보고 창(§10 · 그 줄 10분) 안이면 차단 줄을 통과로 고친다(라우트 갱신 조건)
  const open = await query(
    `SELECT r.id, r.phone, r.carrier, t.callback_number
       FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id
      WHERE r.result = '${SPAM_RESULT.UNCONFIRMED}' AND t.status = 'completed'
        AND t.completed_at < NOW() - ${spamProbeAfterMinutesSql('t')} * INTERVAL '1 minute'
        ${ready.probes ? 'AND NOT EXISTS (SELECT 1 FROM spam_test_probes p WHERE p.result_id = r.id)' : ''}
      ORDER BY t.completed_at ASC
      LIMIT ${PROBE_BATCH}`,
  );
  for (const r of open.rows as any[]) {
    const resultId = String(r.id);
    const phone = String(r.phone);
    const carrier = String(r.carrier);
    const fresh = ready.probes && ready.body && (await query(
      `SELECT 1 FROM spam_filter_devices
        WHERE phone = $1 AND carrier = $2 AND is_active = true
          AND last_body_report_at > NOW() - INTERVAL '${PROBE_DEVICE_FRESH_DAYS} days' LIMIT 1`,
      [phone, carrier],
    )).rows.length > 0;
    if (!fresh) {
      // 확인 문자로 가를 수 없는 단말(표 · 칸 없음 · 본문 보고 7일 없음 · 꺼진 단말) = 단말 확인 불가
      if (await decideUnconfirmed(resultId, 'error')) {
        out.errored++;
        alertDevice(phone, carrier, ready.probes && ready.body ? `본문 있는 보고가 ${PROBE_DEVICE_FRESH_DAYS}일 안에 없어 확인 문자를 보낼 수 없음` : '확인 문자 표가 아직 없음(DDL 전)');
      }
      continue;
    }
    const nonce = randomBytes(3).toString('hex').toUpperCase();
    const claim = await query(
      `INSERT INTO spam_test_probes (result_id, phone, carrier, nonce, message_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'claimed')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [resultId, phone, carrier, nonce, computeMessageHash(probeText(nonce))],
    );
    const id = claim.rows[0]?.id;
    if (!id) continue;   // 다른 손이 먼저 잡았거나 nonce 가 겹쳤다(다음 주기에 다시)
    out.claimed++;
    await sendProbe({ id: String(id), phone, nonce, callback: String(r.callback_number) })
      .catch((e) => console.warn(`${LOG} 확인 문자 보내기 실패 probe=${id}(2분 뒤 다시):`, e?.message || e));
  }
}

/**
 * 앱 보고가 확인 문자의 것인가(보고 라우트가 일반 짝짓기 **전에** 부른다).
 *   'probe'   = 확인 문자 보고(기한 안이면 원 행 blocked 확정 · 그 밖은 무시) — 일반 검사로 넘기지 않는다
 *   'ignored' = 본문 없는 보고 + 확인 문자를 쓰는 단말(어느 문자인지 가를 수 없다 · 무시)
 *   'none'    = 확인 문자와 무관(종전 짝짓기)
 */
export async function matchProbeReport(o: { devicePhone: string; carrier: string; messageContent: string }): Promise<'probe' | 'ignored' | 'none'> {
  if (!(await spamProbeSchemaReady().catch(() => ({ probes: false }))).probes) return 'none';
  const hash = spamReportHash(o.messageContent);
  if (!hash) {
    const used = await query(`SELECT 1 FROM spam_test_probes WHERE phone = $1 AND carrier = $2 LIMIT 1`, [o.devicePhone, o.carrier]);
    return used.rows.length > 0 ? 'ignored' : 'none';
  }
  // 단말은 받는다 → 원 문자를 못 받은 것은 통신사 차단이다(확인 문자 닫기와 원 행 확정 = 한 문장)
  //   ★ 2026-11-24 한 줄 = 유일 키 message_hash · 기한 조건과 쓰기가 같은 문장(같은 NOW() · 배포 2 Codex 6R)
  const got = await closeProbeRow(
    `message_hash = $1 AND phone = $2 AND carrier = $3 AND status IN ('claimed', 'sent') AND (deadline_at IS NULL OR deadline_at >= NOW())`,
    [hash, o.devicePhone, o.carrier], 'received', 'blocked',
  );
  if (got) return 'probe';
  const known = await query(`SELECT 1 FROM spam_test_probes WHERE message_hash = $1 LIMIT 1`, [hash]);
  return known.rows.length > 0 ? 'probe' : 'none';
}

// ── 하루 측정(R36) — 처음 확인 중이던 행의 최종 통과 비율(오탐률) · 확정 뒤 수신 건수(1건 이상 = 경보) ──
let _measuredDay = '';
/**
 * ★ 2026-11-21 C150(R104 · 배포 뒤 19:31 메일 = 옛 창이 「돌린 때부터 24시간」이라 늦게 돈 측정이 아침 건을 다시 셌다) —
 *   하루 측정의 자료 창 = 그 날짜 키의 창 하나 = [전날 09시, 그날 09시)(한국 시각). 몇 시에 돌든(재시작 · 늦은 시작) 같은 날 = 같은 창 = 같은 키.
 *   이웃한 날의 창은 겹치지도 비지도 않는다(그날 끝 = 다음 날 시작) → 사건 하나 = 경보 한 번. 한국 09시 = 같은 날짜 UTC 00시.
 */
export function spamMeasureWindow(now: Date): { day: string; start: Date; end: Date } {
  const kst = new Date(now.getTime() + 9 * 3_600_000);
  const end = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  return { day: kstDateTag(now), start: new Date(end.getTime() - 24 * 3_600_000), end };
}
export async function measureSpamVerdicts(now: Date = new Date()): Promise<{ rows: Array<{ carrier: string; phone: string; unconfirmed: number; passed: number; afterDecided: number }> } | null> {
  if (!(await spamStampReady())) return null;
  const w = spamMeasureWindow(now);
  const r = await query(
    `SELECT carrier, phone,
            COUNT(*) FILTER (WHERE first_result = '${SPAM_RESULT.UNCONFIRMED}')::int AS unconfirmed,
            COUNT(*) FILTER (WHERE first_result = '${SPAM_RESULT.UNCONFIRMED}' AND result = '${SPAM_RESULT.PASS}')::int AS passed,
            COUNT(*) FILTER (WHERE late_report_at >= $1 AND late_report_at < $2)::int AS after_decided
       FROM spam_filter_test_results
      WHERE ((decided_at >= $1 AND decided_at < $2) OR (late_report_at >= $1 AND late_report_at < $2))
        AND EXISTS (SELECT 1 FROM spam_filter_tests t WHERE t.id = spam_filter_test_results.test_id AND ${spamCustomerTestSql('t')})
      GROUP BY carrier, phone`,
    // ★ 2026-11-24 확인 판 제외(설계서 §10-1) — 일부러 막힐 만한 글을 보낸 판이라 오탐률을 흐린다
    [w.start, w.end],
  );
  const rows = (r.rows as any[]).map((x) => ({
    carrier: String(x.carrier), phone: String(x.phone),
    unconfirmed: Number(x.unconfirmed) || 0, passed: Number(x.passed) || 0, afterDecided: Number(x.after_decided) || 0,
  }));
  for (const x of rows) {
    if (x.unconfirmed) console.log(`${LOG} 하루 측정 ${x.carrier} ${x.phone} — 확인 중 ${x.unconfirmed} 중 최종 통과 ${x.passed}(${Math.round((x.passed / x.unconfirmed) * 100)}%) · 확정 뒤 수신 ${x.afterDecided}`);
  }
  const after = rows.filter((x) => x.afterDecided > 0);
  if (after.length > 0) {
    void sendSystemAlert({
      companyId: null,
      // ★ 2026-11-21 C150(R104) — 하루 한 통 = 그 창의 날짜 키 + 24시간 쿨다운(창 · 키가 같은 날짜 = spamMeasureWindow). 옛: 상수 키 + 6시간 쿨다운 ·
      //   「돌린 때부터 24시간」 창이라 배포 재시작으로 그날 측정이 다시 돌면 아침에 보낸 같은 건을 오후에 또 보냈다(1121 16:26).
      dedupKey: `spam-verdict-after-decided:${w.day}`,
      cooldownMs: 24 * 60 * 60 * 1000,
      message: `스팸 검사 판정이 굳은 뒤 문자 수신 보고가 닿았습니다(전날 09시 ~ 오늘 09시 · ${after.map((x) => `${x.carrier} ${x.afterDecided}건`).join(' · ')}). 차단 · 장애 판정 일부가 실제로는 받은 문자일 수 있습니다.`,
    }).catch(() => undefined);
  }
  return { rows };
}

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;
/** 큐 워커와 따로 도는 30초 주기(app.ts) — 확인 문자 주기 + 하루 한 번(한국 09시 뒤) 측정 */
export function startSpamProbeWorker(): void {
  if (_timer) return;
  _timer = setInterval(async () => {
    if (_running) return;
    _running = true;
    try {
      await runSpamProbeCycle();
      const kst = new Date(Date.now() + 9 * 3_600_000);
      const day = kst.toISOString().slice(0, 10);
      if (day !== _measuredDay && kst.getUTCHours() >= 9) {
        _measuredDay = day;
        await measureSpamVerdicts();
      }
    } catch (e: any) {
      console.error(`${LOG} 주기 오류:`, e?.message || e);
    } finally {
      _running = false;
    }
  }, PROBE_CYCLE_MS);
}
