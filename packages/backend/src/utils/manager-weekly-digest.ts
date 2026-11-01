/**
 * manager-weekly-digest.ts — 담당자 주간 요약(★ 2026-11-02 엔진 재설계 E4-2 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 월요일 09:00 KST 부터 담당자마다 1통(지난주 = 지난 월요일 00시 ~ 일요일 24시 KST): 여정 · 자동마케팅 수 · 보낸 수 · 성공률 · 확인할 일 · 상황판 링크.
 *   - 받는 사람 = pickOwnerContact(한 곳 · 만든 계정 → 회사 관리자) · 같은 번호는 한 통
 *   - 기록 = manager_weekly_digests(원장 C93-DDL-2) · 쓰기 = 안내 한 통 꼴(시도 잡기 → 적재 → 성공 기록 · 시도 상한 3 · journey-notice-once)
 *   - 무과금 인증 라인 · 시연 회사 = 0 · 표가 없으면(DDL 전) 건너뛰고 로그
 * ⛔ 모델명 0 · 줄표 0.
 */
import { query, withBoundedMysql } from '../config/database';
import { getAuthSmsTable, bulkInsertSmsQueue, getPlatformNoticeCallback } from './sms-queue';
import { pickOwnerContact } from './owner-contact';
import { isDemoCompany } from './demo-company';
import { NOTICE_ENQUEUE_TIMEOUT_MS, NOTICE_MAX_ATTEMPTS, sendNoticeOnce } from './journey-notice-once';
import { loadManagerBoardFor, generateManagerBoardToken, buildManagerBoardShortUrl } from './manager-board';
import { interleaveByCompany } from './concurrency';

/** 월요일 몇 시(KST)부터 보내는가 · 그날 정오까지만(늦은 요약은 보내지 않는다) */
export const DIGEST_HOUR_KST = 9;
export const DIGEST_LAST_HOUR_KST = 12;

/** (순수) 지금(KST)이 보낼 창인가 · 지난주 월요일(YYYY-MM-DD) */
export function digestWindow(now: Date): { open: boolean; weekStart: string } {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const dow = kst.getUTCDay();   // 0 = 일요일 · 1 = 월요일
  const hour = kst.getUTCHours();
  const thisMonday = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - ((dow + 6) % 7)));
  const lastMonday = new Date(thisMonday.getTime() - 7 * 86400_000);
  return { open: dow === 1 && hour >= DIGEST_HOUR_KST && hour < DIGEST_LAST_HOUR_KST, weekStart: lastMonday.toISOString().slice(0, 10) };
}

/** (순수) 본문 */
export function buildWeeklyDigestBody(p: { companyName: string; weekStart: string; journeys: number; operators: number; sent: number; successRate: number | null; todos: number; boardUrl: string }): string {
  const [, mm, dd] = p.weekStart.split('-');
  const end = new Date(Date.UTC(Number(p.weekStart.slice(0, 4)), Number(mm) - 1, Number(dd) + 6));
  return [
    '[한줄로 주간 요약]',
    '',
    `${Number(mm)}월 ${Number(dd)}일 ~ ${end.getUTCMonth() + 1}월 ${end.getUTCDate()}일`,
    `켜진 여정 ${p.journeys}개 · 자동마케팅 ${p.operators}개`,
    `보낸 수 ${p.sent.toLocaleString('ko-KR')}건${p.successRate != null ? ` · 성공률 ${p.successRate}%` : ''}`,
    p.todos > 0 ? `확인할 일 ${p.todos}건이 있어요.` : '확인할 일은 없어요.',
    '',
    `상황판: ${p.boardUrl}`,
  ].join('\n');
}

let _tableReady = false;
async function digestTableReady(): Promise<boolean> {
  if (_tableReady) return true;
  const r = await query(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'manager_weekly_digests'`);
  _tableReady = Number(r.rows[0]?.n || 0) === 1;
  return _tableReady;
}
/** 시험 전용. */
export function resetDigestTableCache(): void { _tableReady = false; }

let running = false;
/** 한 회차 — 창 밖이면 0 · 회사 돌아가며 · 회사마다 담당자(번호) 한 통 */
export async function runWeeklyDigest(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  const out = { sent: 0, skipped: 0 };
  const win = digestWindow(now);
  if (!win.open || running) return out;
  running = true;
  try {
    if (!(await digestTableReady())) {
      console.warn('[weekly-digest] 주간 요약 기록 표(manager_weekly_digests)가 없어 건너뜁니다 · 원장 C93-DDL-2');
      return out;
    }
    // 켜진 여정 · 자동마케팅이 있는 회사의 만든 계정(담당자) · 아직 이번 주 요약을 안 받은 것
    const owners = await query(
      `SELECT DISTINCT x.company_id, x.created_by FROM (
         SELECT company_id, created_by FROM journeys WHERE status = 'active'
         UNION ALL
         SELECT company_id, created_by FROM continuous_operators WHERE status = 'active'
       ) x`,
    );
    const seen = new Set<string>();
    for (const o of interleaveByCompany(owners.rows as Array<{ company_id: string; created_by: string | null }>, (r) => String(r.company_id))) {
      try {
        const companyId = String(o.company_id);
        if (await isDemoCompany(companyId)) { out.skipped++; continue; }
        const contact = await pickOwnerContact(companyId, o.created_by ? String(o.created_by) : null);
        if (!contact) { out.skipped++; continue; }
        const key = `${companyId}:${contact.phone}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = await sendDigestTo(companyId, contact, win.weekStart);
        if (r === 'sent') out.sent++; else out.skipped++;
      } catch (err: any) {
        out.skipped++;
        console.warn(`[weekly-digest] 회사=${o.company_id} 요약 실패(다음 회차가 시도 상한 안에서 다시):`, err?.message || err);
      }
    }
    if (out.sent > 0) console.log(`[weekly-digest] 주간 요약 ${out.sent}통 · 건너뜀 ${out.skipped}`);
    return out;
  } finally {
    running = false;
  }
}

async function sendDigestTo(companyId: string, contact: { userId: string; phone: string }, weekStart: string): Promise<string> {
  const pk = [companyId, contact.phone, weekStart];
  // 시도를 먼저 잡고(상한 3) 그 안에서 상황판을 읽어 본문을 만든다 = 읽기 실패도 시도 상한 안에서만 다시 본다(R8)
  return sendNoticeOnce({
    claim: async () => (await query(
      `INSERT INTO manager_weekly_digests (company_id, owner_key, week_start, attempts) VALUES ($1::uuid, $2, $3::date, 1)
       ON CONFLICT (company_id, owner_key, week_start) DO UPDATE SET attempts = manager_weekly_digests.attempts + 1
        WHERE manager_weekly_digests.sent_at IS NULL AND manager_weekly_digests.attempts < $4
       RETURNING company_id`,
      [...pk, NOTICE_MAX_ATTEMPTS],
    )).rows.length > 0,
    enqueue: async () => {
      const board = await loadManagerBoardFor(companyId, contact.userId);
      const token = generateManagerBoardToken(companyId, contact.userId);
      if (!board || !token) return false;
      const body = buildWeeklyDigestBody({
        companyName: board.companyName, weekStart,
        journeys: board.numbers.activeJourneys, operators: board.numbers.activeOperators,
        sent: board.numbers.sent7d, successRate: board.numbers.successRate,
        todos: board.todos.filter((t) => t.action).length, boardUrl: await buildManagerBoardShortUrl(companyId, token),
      });
      const authTable = await getAuthSmsTable();
      const inserted = await withBoundedMysql(NOTICE_ENQUEUE_TIMEOUT_MS, (run) => bulkInsertSmsQueue(
        [authTable],
        [[contact.phone, getPlatformNoticeCallback(), body, 'L', '[한줄로 주간 요약]', null, '', companyId, '', '', '']],
        true,
        undefined,
        { run },
      ));
      return inserted === 1;
    },
    finalize: async () => (await query(
      `UPDATE manager_weekly_digests SET sent_at = NOW() WHERE company_id = $1::uuid AND owner_key = $2 AND week_start = $3::date AND sent_at IS NULL RETURNING company_id`,
      pk,
    )).rows.length > 0,
  });
}

export function startWeeklyDigestWorker(): void {
  setInterval(() => {
    runWeeklyDigest().catch((err) => console.error('[weekly-digest] 예외:', err?.message || err));
  }, 10 * 60 * 1000);
  console.log('[weekly-digest] 주간 요약 워커 시작(10분 주기 · 월요일 09~12시 KST)');
}
