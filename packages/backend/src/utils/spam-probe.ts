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
import { query } from '../config/database';
import { insertTestSmsQueue } from './sms-queue';
import { sendSystemAlert } from './system-alert';
import { SPAM_RESULT } from './sms-result-map';
import { computeMessageHash, spamReportHash, decideUnconfirmed, spamStampReady, SPAM_LATE_REPORT_MINUTES } from './spam-test-queue';

export const PROBE_DEADLINE_MINUTES = 5;
export const PROBE_RECLAIM_MINUTES = 2;
export const PROBE_MAX_ATTEMPTS = 2;
export const PROBE_DEVICE_FRESH_DAYS = 7;
const PROBE_BATCH = 20;
const PROBE_CYCLE_MS = 30_000;
const LOG = '[spam-probe]';

/**
 * 화면이 다시 읽기를 멈추는 때(순수) — 확인 중 행이 있는 닫힌 검사만: 닫힌 때 + 늦은 보고 창 + 확인 문자 기한 + 다시 보내기 + 주기 여유 2분.
 *   확인 중 행이 없거나 아직 안 닫혔으면 null.
 */
export function spamTestFinalBy(completedAt: string | Date | null | undefined, rows: ReadonlyArray<{ result?: string | null }>): string | null {
  if (!completedAt || !rows.some((r) => r.result === SPAM_RESULT.UNCONFIRMED)) return null;
  const at = new Date(completedAt).getTime();
  if (!Number.isFinite(at)) return null;
  return new Date(at + (SPAM_LATE_REPORT_MINUTES + PROBE_DEADLINE_MINUTES + PROBE_RECLAIM_MINUTES + 2) * 60_000).toISOString();
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

/**
 * 확인 문자 닫기 + 원 행 확정 = 한 문장(★ Codex 구현 1R #5 — 확인 문자만 닫히고 원 행이 확인 중으로 영영 남는 길 0).
 *   원 행은 아직 확인 중일 때만 바꾼다(늦은 보고가 먼저 통과로 고쳤으면 그대로) · closed = 이번에 원 행을 닫았는가.
 */
async function closeProbes(probeWhere: string, params: any[], probeTo: 'received' | 'expired', resultTo: 'blocked' | 'error'): Promise<Array<{ resultId: string; phone: string; carrier: string; closed: boolean }>> {
  const stamped = await spamStampReady().catch(() => false);
  const r = await query(
    `WITH p AS (
       UPDATE spam_test_probes SET status = '${probeTo}', decided_at = NOW()
        WHERE ${probeWhere}
        RETURNING result_id, phone, carrier
     ), x AS (
       UPDATE spam_filter_test_results t SET result = $${params.length + 1}${stamped ? ', decided_at = NOW()' : ''}
         FROM p WHERE t.id = p.result_id AND t.result = '${SPAM_RESULT.UNCONFIRMED}'
        RETURNING t.id
     )
     SELECT p.result_id, p.phone, p.carrier, (p.result_id IN (SELECT id FROM x)) AS closed FROM p`,
    [...params, resultTo],
  );
  return (r.rows as any[]).map((x) => ({ resultId: String(x.result_id), phone: String(x.phone), carrier: String(x.carrier), closed: x.closed === true }));
}

/** 확인 문자 한 통을 보내고 sent 로 적는다(claim 을 가진 손만 부른다) */
async function sendProbe(p: { id: string; phone: string; nonce: string; callback: string }): Promise<void> {
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
  const ready = await spamProbeSchemaReady();

  if (ready.probes) {
    // ⓪ 닫힌 확인 문자인데 원 행이 아직 확인 중(옛 분리 쓰기 · 수동 정리 뒤) = 그 결과로 맞춘다(R6 · 대조 복구)
    const stamped = await spamStampReady().catch(() => false);
    await query(
      `UPDATE spam_filter_test_results t SET result = CASE p.status WHEN 'received' THEN $1 ELSE $2 END${stamped ? ', decided_at = NOW()' : ''}
         FROM spam_test_probes p
        WHERE p.result_id = t.id AND p.status IN ('received', 'expired') AND t.result = '${SPAM_RESULT.UNCONFIRMED}'`,
      ['blocked', 'error'],
    );

    // ① 기한 안에 보고가 안 온 확인 문자 = 단말 장애
    for (const r of await closeProbes(`status = 'sent' AND deadline_at < NOW()`, [], 'expired', 'error')) {
      out.expired++;
      if (r.closed) alertDevice(r.phone, r.carrier, `확인 문자를 ${PROBE_DEADLINE_MINUTES}분 안에 보고하지 않음`);
    }

    // ② 발송 전에 멈춘 claim — 상한 안이면 한 번 더 보내고, 넘었으면 expired → error
    const again = await query(
      `UPDATE spam_test_probes p SET attempts = p.attempts + 1, claimed_at = NOW()
         FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id
        WHERE p.result_id = r.id AND p.status = 'claimed' AND p.attempts < ${PROBE_MAX_ATTEMPTS}
          AND p.claimed_at < NOW() - INTERVAL '${PROBE_RECLAIM_MINUTES} minutes'
        RETURNING p.id, p.phone, p.nonce, t.callback_number`,
    );
    for (const r of again.rows as any[]) {
      await sendProbe({ id: String(r.id), phone: String(r.phone), nonce: String(r.nonce), callback: String(r.callback_number) })
        .catch((e) => console.warn(`${LOG} 확인 문자 다시 보내기 실패 probe=${r.id}:`, e?.message || e));
    }
    const dead = await closeProbes(
      `status = 'claimed' AND attempts >= ${PROBE_MAX_ATTEMPTS} AND claimed_at < NOW() - INTERVAL '${PROBE_RECLAIM_MINUTES} minutes'`,
      [], 'expired', 'error',
    );
    for (const r of dead) {
      out.expired++;
      if (r.closed) alertDevice(r.phone, r.carrier, '확인 문자를 보내지 못함');
    }
  }

  // ③ 늦은 보고 창(10분)이 닫혔는데 아직 확인 중인 행
  const open = await query(
    `SELECT r.id, r.phone, r.carrier, t.callback_number
       FROM spam_filter_test_results r JOIN spam_filter_tests t ON t.id = r.test_id
      WHERE r.result = '${SPAM_RESULT.UNCONFIRMED}' AND t.status = 'completed'
        AND t.completed_at < NOW() - INTERVAL '${SPAM_LATE_REPORT_MINUTES} minutes'
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

  if (out.claimed || out.errored || out.expired) console.log(`${LOG} 주기 — 보냄 ${out.claimed} · 단말 확인 불가 ${out.errored} · 기한 지남 ${out.expired}`);
  return out;
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
  const got = await closeProbes(
    `message_hash = $1 AND phone = $2 AND carrier = $3 AND status IN ('claimed', 'sent') AND (deadline_at IS NULL OR deadline_at >= NOW())`,
    [hash, o.devicePhone, o.carrier], 'received', 'blocked',
  );
  if (got.length > 0) return 'probe';
  const known = await query(`SELECT 1 FROM spam_test_probes WHERE message_hash = $1 LIMIT 1`, [hash]);
  return known.rows.length > 0 ? 'probe' : 'none';
}

// ── 하루 측정(R36) — 처음 확인 중이던 행의 최종 통과 비율(오탐률) · 확정 뒤 수신 건수(1건 이상 = 경보) ──
let _measuredDay = '';
export async function measureSpamVerdicts(): Promise<{ rows: Array<{ carrier: string; phone: string; unconfirmed: number; passed: number; afterDecided: number }> } | null> {
  if (!(await spamStampReady())) return null;
  const r = await query(
    `SELECT carrier, phone,
            COUNT(*) FILTER (WHERE first_result = '${SPAM_RESULT.UNCONFIRMED}')::int AS unconfirmed,
            COUNT(*) FILTER (WHERE first_result = '${SPAM_RESULT.UNCONFIRMED}' AND result = '${SPAM_RESULT.PASS}')::int AS passed,
            COUNT(*) FILTER (WHERE late_report_at >= NOW() - INTERVAL '24 hours')::int AS after_decided
       FROM spam_filter_test_results
      WHERE decided_at >= NOW() - INTERVAL '24 hours' OR late_report_at >= NOW() - INTERVAL '24 hours'
      GROUP BY carrier, phone`,
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
      dedupKey: 'spam-verdict-after-decided',
      message: `스팸 검사 판정이 굳은 뒤 문자 수신 보고가 닿았습니다(최근 24시간 · ${after.map((x) => `${x.carrier} ${x.afterDecided}건`).join(' · ')}). 차단 · 장애 판정 일부가 실제로는 받은 문자일 수 있습니다.`,
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
