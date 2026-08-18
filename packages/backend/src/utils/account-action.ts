/**
 * account-action.ts — 계정 제한 조치 컨트롤타워 (★2026-08-18 전송자격인증 5.1)
 *
 * 인증기준이 요구하는 것
 *   불법스팸 등으로 이용자를 정지·해지했으면 ①조치 이력을 남기고 ②**이용자에게 사유를 즉시 안내**해야 한다
 *   (가이드라인 5.1 — "이메일, 문자, 알림창 등을 통해 조치 사유를 명확히 안내").
 *
 * 왜 한 곳으로 모았나
 *   계정이 제한되는 길목이 여럿이었다 — 슈퍼관리자 상태 변경, MFA 실패 잠금, 앞으로 붙을 스팸 조치.
 *   각자 구현하면 **상태만 바뀌고 접속 중인 사람은 그대로 쓰는** 구멍이 경로마다 다시 생긴다.
 *   조치는 언제나 세 가지가 함께다 — 상태 변경 · 세션 끊기 · 고지.
 *
 * ⛔ 고지 실패가 조치를 되돌리지 않는다
 *   문자가 안 나갔다고 정지를 취소하면 위험한 계정이 살아난다. 고지 실패는 이력에 남기고 조치는 유지한다.
 */

import type { Request } from 'express';
import { query, mysqlQuery } from '../config/database';
import { invalidateUserSessions } from './session-manager';
import { getAuthSmsTable } from './sms-queue';

/** 제한 상태 — users.status가 쓰는 값 중 접근이 막히는 것들 */
export type RestrictedStatus = 'locked' | 'dormant' | 'suspended';

/** 조치 사유 → 이용자에게 보일 문구. 내부 코드명을 그대로 노출하지 않는다 */
const REASON_MESSAGE: Record<string, string> = {
  mfa_failure: '인증번호를 여러 번 잘못 입력해 계정이 잠겼습니다.',
  spam_report: '불법스팸 신고가 접수되어 서비스 이용이 제한되었습니다.',
  admin_action: '관리자 조치로 서비스 이용이 제한되었습니다.',
  contract_end: '계약 종료로 서비스 이용이 종료되었습니다.',
};

export interface RestrictionOutcome {
  status: RestrictedStatus;
  killedSessions: number;
  notified: boolean;
  notifyError?: string;
}

/**
 * 계정 제한 조치 — 상태 변경 + 세션 끊기 + 이용자 고지 + 이력.
 * `actorUserId`는 조치한 사람(자동 조치면 null).
 */
export async function restrictAccount(params: {
  userId: string;
  status: RestrictedStatus;
  reason: keyof typeof REASON_MESSAGE | string;
  actorUserId?: string | null;
  /** 이력에 남길 자유 메모(사용자에게는 안 보인다) */
  note?: string;
  req?: Request;
}): Promise<RestrictionOutcome> {
  const { userId, status, reason, actorUserId, note, req } = params;

  const target = await query(
    'SELECT id, login_id, name, phone, mfa_phone, status FROM users WHERE id = $1',
    [userId]
  );
  if (target.rows.length === 0) throw new Error('user not found');
  const user = target.rows[0];

  await query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', [status, userId]);
  const killedSessions = await invalidateUserSessions(userId);

  // 고지 — 등록된 인증번호를 우선 쓴다(계약 담당자 번호라 도달이 확실하다)
  const notifyPhone = String(user.mfa_phone || user.phone || '').replace(/\D/g, '');
  let notified = false;
  let notifyError: string | undefined;
  if (notifyPhone) {
    try {
      await sendRestrictionNotice(notifyPhone, REASON_MESSAGE[reason] || REASON_MESSAGE.admin_action);
      notified = true;
    } catch (err: any) {
      notifyError = String(err?.message || err).slice(0, 200);
      console.error('[account-action] 조치 고지 발송 실패:', userId, notifyError);
    }
  } else {
    notifyError = 'no_phone';
  }

  await query(
    `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
     VALUES (gen_random_uuid(), $1, 'account_restricted', 'user', $2, $3, $4, $5, NOW())`,
    [
      actorUserId || null,
      userId,
      JSON.stringify({
        targetLoginId: user.login_id,
        before: user.status,
        after: status,
        reason,
        note: note ? String(note).slice(0, 200) : undefined,
        killedSessions,
        notified,
        notifyError,
      }),
      req?.ip || null,
      req?.headers['user-agent'] || '',
    ]
  );

  return { status, killedSessions, notified, notifyError };
}

/** 조치 안내 문자 — 인증 라인(운영 발송 라인을 점유하지 않는다) */
async function sendRestrictionNotice(phone: string, reasonText: string): Promise<void> {
  const table = await getAuthSmsTable();
  const callback = process.env.SYSTEM_SMS_CALLBACK;
  if (!callback) throw new Error('SYSTEM_SMS_CALLBACK 환경변수가 설정되지 않았습니다');
  const message = `[한줄로] ${reasonText}\n문의는 담당자에게 연락해주세요.`;
  await mysqlQuery(
    `INSERT INTO ${table} (dest_no, call_back, msg_contents, msg_type, sendreq_time, status_code, rsv1) VALUES (?, ?, ?, 'S', NOW(), 100, '1')`,
    [phone, String(callback).replace(/\D/g, ''), message]
  );
}

/** 제한 상태인가 — 호출부가 "이 변경이 조치인가"를 판정할 때 쓴다 */
export function isRestrictedStatus(value: any): value is RestrictedStatus {
  return value === 'locked' || value === 'dormant' || value === 'suspended';
}
