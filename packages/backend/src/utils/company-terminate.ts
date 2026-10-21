/**
 * company-terminate.ts — 고객사 해지 컨트롤타워 (★2026-10-21 전송자격인증 현장 실사 준비 S3 · D-19)
 *
 * 왜 있나
 *   해지 길이 둘이었다 — 회사 목록의 해지 버튼(계정 잠금 · 세션 끊기 · 기록, 사유 · 고지 없음)과
 *   회사 수정의 상태 칸(상태만 바뀜 · 잠금 · 세션 · 기록 · 고지 전부 없음). 10-21 실측 = 해지 21곳 중 기록 2곳.
 *   인증 기준 5.1 은 정지 · 해지 때 이력과 이용자 사유 안내를, 3.3 은 말소의 일시 · 사유 · 처리자를 요구한다.
 *
 * 규칙
 *   - 해지는 이 함수 한 길이다. 회사 수정 라우트는 「해지로 바꾸기」를 거부한다.
 *   - 상태 해지 + 소속 계정 잠금 + 세션 끊기 + 해지 기록(company_terminated) = 한 트랜잭션.
 *     해지됐는데 기록이 없거나, 기록이 남았는데 접속이 살아 있는 일이 없다(Codex 1R high).
 *   - 고지는 커밋 뒤(외부 발송을 되돌릴 수 없어서). 결과는 해지 안내 문자 기록(company_termination_notice)으로 따로 남긴다.
 *   - 고지 문구 · 발송은 계정 조치 CT(`account-action.ts`)의 것을 쓴다(인증 라인 · 운영 발송 라인 점유 안 함).
 *   - 고지 실패는 해지를 되돌리지 않는다(같은 원칙 — 실패는 기록에 남긴다). 커밋 뒤에는 예외를 내지 않는다.
 *   - companies 에 해지 시각 칸이 없어 감사 기록(company_terminated)이 유일한 시점 근거다.
 */
import type { Request } from 'express';
import pool, { query } from '../config/database';
import { invalidateCompanySessions } from './session-manager';
import { restrictionReasonMessage, sendRestrictionNotice } from './account-action';
import { recordAuditLog } from './audit-log';

export const TERMINATE_REASONS = ['contract_end', 'spam_report', 'admin_action'] as const;
export type TerminateReason = typeof TERMINATE_REASONS[number];
export const isTerminateReason = (v: any): v is TerminateReason => (TERMINATE_REASONS as readonly string[]).includes(v);

export type TerminateOutcome =
  | { ok: true; companyName: string; lockedUsers: number; killedSessions: number; notified: number; notifyFailed: number }
  | { ok: false; status: number; error: string; code?: string };

export async function terminateCompany(p: {
  companyId: string;
  reason: any;
  note?: string | null;
  actorUserId?: string | null;
  req?: Request;
}): Promise<TerminateOutcome> {
  const { companyId: id, reason, actorUserId, req } = p;
  if (!isTerminateReason(reason)) {
    return { ok: false, status: 400, error: '해지 사유를 골라주세요.', code: 'TERMINATE_REASON_REQUIRED' };
  }
  const note = p.note ? String(p.note).trim().slice(0, 200) || null : null;

  const activeCampaigns = await query(
    "SELECT COUNT(*) FROM campaigns WHERE company_id = $1 AND status IN ('scheduled', 'sending')",
    [id]
  );
  if (parseInt(activeCampaigns.rows[0].count) > 0) {
    return { ok: false, status: 400, error: '진행 중이거나 예약된 캠페인이 있어 해지할 수 없습니다.' };
  }

  const client = await pool.connect();
  let companyName = '';
  let previousStatus: string | null = null;
  let locked: any[] = [];
  let killedSessions = 0;
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT company_name, status FROM companies WHERE id = $1 FOR UPDATE', [id]);
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: '회사를 찾을 수 없습니다.' };
    }
    if (before.rows[0].status === 'terminated') {
      await client.query('ROLLBACK');
      return { ok: false, status: 400, error: '이미 해지된 회사입니다.' };
    }
    companyName = before.rows[0].company_name;
    previousStatus = before.rows[0].status ?? null;
    await client.query(`UPDATE companies SET status = 'terminated', updated_at = NOW() WHERE id = $1`, [id]);
    const lockedRes = await client.query(
      `UPDATE users SET status = 'dormant', updated_at = NOW() WHERE company_id = $1
       RETURNING id, login_id, user_type, mfa_phone, phone`,
      [id]
    );
    locked = lockedRes.rows;
    // 상태만 바꾸면 이미 접속해 있는 사람은 남는다(로그인 게이트는 새 로그인만 막는다) — 같은 트랜잭션에서 끊는다
    killedSessions = await invalidateCompanySessions(id, client);
    await client.query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'company_terminated', 'company', $2, $3, $4, $5, NOW())`,
      [
        actorUserId || null,
        id,
        JSON.stringify({ companyName, before: previousStatus, reason, note: note ?? undefined, lockedUsers: locked.length, killedSessions }),
        req?.ip || null,
        req?.headers['user-agent'] || '',
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // 고지 — 고객사 관리자 계정의 인증 번호(없으면 연락처) · 같은 번호는 한 번
  const phones = [...new Set(
    locked.filter((u) => u.user_type === 'admin')
      .map((u) => String(u.mfa_phone || u.phone || '').replace(/\D/g, ''))
      .filter(Boolean)
  )];
  let notified = 0;
  const notifyErrors: string[] = [];
  for (const phone of phones) {
    try {
      await sendRestrictionNotice(phone, restrictionReasonMessage(reason));
      notified++;
    } catch (err: any) {
      notifyErrors.push(String(err?.message || err).slice(0, 200));
      console.error('[company-terminate] 해지 고지 발송 실패:', id, notifyErrors[notifyErrors.length - 1]);
    }
  }
  if (phones.length === 0) notifyErrors.push('no_phone');

  // 고지 결과 — 기록 CT 는 실패를 삼킨다(해지는 이미 커밋 · 해지 기록도 남았다)
  await recordAuditLog({
    actorUserId: actorUserId || null, action: 'company_termination_notice', targetType: 'company', targetId: id,
    details: {
      companyName, reason, notified, notifyFailed: phones.length - notified,
      notifyErrors: notifyErrors.length ? notifyErrors.slice(0, 5) : undefined,
    },
    req,
  });

  return { ok: true, companyName, lockedUsers: locked.length, killedSessions, notified, notifyFailed: phones.length - notified };
}
