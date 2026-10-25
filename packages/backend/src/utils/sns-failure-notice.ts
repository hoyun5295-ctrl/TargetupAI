/**
 * ★ 2026-10-25 원장 #96 — SNS 게시가 실패로 끝나면 담당자에게 알린다(옛: 화면 게시 이력뿐 · 예약 게시는 사람이 모르고 지나갔다).
 *   실패로 끝내는 자리(채널 거절 · 컨테이너 상한 · 예약 시각 지남 · 결과 모름)가 이 함수 하나를 부른다.
 *   받는 사람 = 게시물을 만든 계정 → 회사 대표 관리자(담당자 통지 공용 함수) · 같은 호출의 같은 게시물 = 한 통 · 통지 실패는 삼킨다(게시 상태에 영향 0).
 */
import { query } from '../config/database';
import { getSnsAdapter } from './sns';
import { isSnsPlatform } from './sns-constants';

export async function notifySnsTargetsFailed(targetIds: string[]): Promise<void> {
  const ids = targetIds.filter(Boolean);
  if (ids.length === 0) return;
  try {
    const r = await query(
      `SELECT t.id, t.platform, t.last_error, p.id AS post_id, p.company_id, p.created_by, p.body
         FROM sns_post_targets t JOIN sns_posts p ON p.id = t.post_id
        WHERE t.id = ANY($1::uuid[]) AND t.status = 'failed'`,
      [ids],
    );
    const byPost = new Map<string, any[]>();
    for (const row of r.rows) byPost.set(String(row.post_id), [...(byPost.get(String(row.post_id)) || []), row]);
    const { notifyOperatorAdmins } = await import('./continuous-operator');
    for (const rows of byPost.values()) {
      const head = rows[0];
      const channels = rows.map((x) => (isSnsPlatform(x.platform) && getSnsAdapter(x.platform)?.label) || '채널').join(' · ');
      const snippet = String(head.body || '').replace(/\s+/g, ' ').trim().slice(0, 20);
      const reason = String(head.last_error || '').trim().slice(0, 80);
      await notifyOperatorAdmins(
        { adminPhoneNumbers: [], backupAdminPhone: null, companyId: head.company_id, createdBy: head.created_by || null },
        '[SNS] 게시하지 못함',
        `${snippet ? `'${snippet}' ` : ''}게시물을 ${channels}에 올리지 못했어요.${reason ? ` ${reason}` : ''} 한줄로 SNS 화면의 게시 이력에서 확인해 주세요.`,
        { noticeHeader: '[한줄로 SNS 안내문자]' },
      );
    }
  } catch (e: any) {
    console.warn('[SNS] 게시 실패 통지 경고:', e?.message);
  }
}
