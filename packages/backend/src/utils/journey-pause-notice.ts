/**
 * journey-pause-notice.ts — 시스템이 멈춘 여정을 담당자에게 한 번 알린다(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-5 ① · D1).
 *
 * 왜 있나
 *   잔액 · 템플릿 · 상한 · 판정 불가 같은 시스템 멈춤이 화면에만 남고 사람에게 닿지 않아, 담당자가 모르는 채 여정이 며칠씩 멈춰 있었다.
 *   → 상태에서 고르는 패스 하나(5분 · 보내기 전 검사 워커와 같은 회차): 멈춘 여정 중 사람 멈춤 · 마침이 아니고 그 멈춤(paused_at)에 안내한 적 없는 것 = 담당자 1통.
 *   원장 = journeys.pause_notice_for(안내한 paused_at) · pause_notice_attempts(시도 · 3번) · 쓰기 = 한 번 안내 꼴(잡기 → 적재 → 성공 기록 · journey-notice-once).
 *   칸이 없으면(DDL-1 전 · 42703) 이 패스만 쉬고 운영 경보 한 통(발송 · 멈춤은 그대로).
 */
import { query } from '../config/database';
import { pauseReasonView } from './journey-pause-reason';
import { pickOwnerContact } from './owner-contact';
import { NOTICE_MAX_ATTEMPTS, sendNoticeOnce } from './journey-notice-once';
import { enqueueManagerNotice } from './journey-pretest-notifier';
import { generateManagerBoardToken, buildManagerBoardShortUrl } from './manager-board';
import { isDemoCompany } from './demo-company';
import { sendSystemAlert } from './system-alert';

/** 한 회차에 안내하는 멈춘 여정 수(오래 멈춘 것부터 · 다음 회차가 이어 본다) */
export const PAUSE_NOTICE_BATCH = 50;

/** 담당자 안내 본문(사람 말 · 원문 사유 노출 0 · 할 일 · 상황판 링크) */
export function buildPauseNoticeBody(p: { journeyName: string; reasonText: string; fixLabel: string | null; boardUrl: string | null }): string {
  return [
    '[여정 멈춤 안내]',
    `'${p.journeyName}' 여정이 멈췄어요.`,
    '',
    `이유: ${p.reasonText}`,
    ...(p.fixLabel ? [`할 일: ${p.fixLabel}`] : []),
    '',
    p.boardUrl ? `상황판: ${p.boardUrl}` : '한줄로 여정 화면에서 확인해 주세요.',
  ].join('\n');
}

/** 이 멈춤은 안내하지 않는가(사람 멈춤 · 날짜 기준 마침 = 사람이 안다 · 고장 아님) */
export function pauseNeedsNotice(pauseReason: string | null | undefined): boolean {
  const k = pauseReasonView(pauseReason).kind;
  return k !== 'manual' && k !== 'completed';
}

let missingColumnAlerted = false;

export async function notifyPausedJourneys(): Promise<{ sent: number; skipped: number }> {
  let rows: any[];
  try {
    rows = (await query(
      `SELECT j.id, j.company_id, j.created_by, j.name, j.pause_reason, j.paused_at::text AS paused_raw,
              CASE WHEN j.pause_notice_for IS DISTINCT FROM j.paused_at THEN 0 ELSE j.pause_notice_attempts END AS pause_notice_attempts   -- 시도 수 = 지금 멈춤의 것(★ Codex 구현 1R · 옛 멈춤 시도를 물려받지 않는다)
         FROM journeys j
        WHERE j.status = 'paused' AND j.paused_at IS NOT NULL
          AND (j.pause_notice_for IS DISTINCT FROM j.paused_at OR j.pause_notice_attempts > 0)   -- 새 멈춤 · 지금 멈춤 시도 중(마침 = 같은 paused_at + 시도 0)
        ORDER BY j.paused_at ASC
        LIMIT ${PAUSE_NOTICE_BATCH}`,
    )).rows;
  } catch (e: any) {
    if (e?.code !== '42703') throw e;
    if (!missingColumnAlerted) {
      missingColumnAlerted = true;
      console.warn('[journey-pause-notice] DB 마이그레이션 필요 — journeys pause_notice_for · pause_notice_attempts ALTER 실행 요청(안내 패스만 쉼)');
      void sendSystemAlert({ companyId: null, dedupKey: 'journey-pause-notice-ddl', message: '여정 멈춤 안내 패스가 쉬고 있습니다 — journeys.pause_notice_for · pause_notice_attempts 칸이 없습니다(DDL-1 실행 필요).' }).catch(() => undefined);
    }
    return { sent: 0, skipped: 0 };
  }
  let sent = 0;
  let skipped = 0;
  const close = (id: string, seen: string) => query(
    `UPDATE journeys SET pause_notice_for = paused_at, pause_notice_attempts = 0 WHERE id = $1::uuid AND paused_at = $2::timestamptz AND status = 'paused' RETURNING id`, [id, seen],
  );
  for (const r of rows) {
    const id = String(r.id);
    const companyId = String(r.company_id);
    const seen = String(r.paused_raw);
    if (!pauseNeedsNotice(r.pause_reason) || await isDemoCompany(companyId)) { await close(id, seen); skipped++; continue; }
    if (Number(r.pause_notice_attempts || 0) >= NOTICE_MAX_ATTEMPTS) {
      await close(id, seen);
      void sendSystemAlert({
        companyId, dedupKey: `journey-pause-notice:${id}:${seen}`,
        message: `여정 멈춤 안내를 ${NOTICE_MAX_ATTEMPTS}번 보내지 못했습니다(문자 큐 · 담당자 번호 확인 · 상황판에는 보입니다). journey=${id}`,
      }).catch(() => undefined);
      continue;
    }
    const view = pauseReasonView(r.pause_reason);
    const result = await sendNoticeOnce({
      claim: async () => (await query(
        `UPDATE journeys SET
            pause_notice_attempts = CASE WHEN pause_notice_for IS DISTINCT FROM paused_at THEN 1 ELSE pause_notice_attempts + 1 END,
            pause_notice_for = paused_at
          WHERE id = $1::uuid AND status = 'paused' AND paused_at = $2::timestamptz
            AND (pause_notice_for IS DISTINCT FROM paused_at OR (pause_notice_attempts > 0 AND pause_notice_attempts < $3))
          RETURNING id`,
        [id, seen, NOTICE_MAX_ATTEMPTS],
      )).rows.length > 0,
      enqueue: async () => {
        const contact = await pickOwnerContact(companyId, r.created_by ? String(r.created_by) : null);
        if (!contact) return true;   // 받을 담당자 없음 = 보낼 것 없음(마감 · 상황판에는 보인다)
        const token = generateManagerBoardToken(companyId, contact.userId);
        const boardUrl = token ? await buildManagerBoardShortUrl(companyId, token).catch(() => null) : null;
        return enqueueManagerNotice({
          phone: contact.phone,
          title: '여정 멈춤 안내',
          body: buildPauseNoticeBody({ journeyName: String(r.name || '여정'), reasonText: view.text, fixLabel: view.fix?.label ?? null, boardUrl }),
        }, companyId);
      },
      finalize: async () => (await close(id, seen)).rows.length > 0,
    });
    if (result === 'sent') sent++;
  }
  return { sent, skipped };
}
