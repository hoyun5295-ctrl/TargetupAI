/**
 * ★ 2026-10-25 원장 #96 — SNS 게시가 실패로 끝나면 담당자에게 알린다(옛: 화면 게시 이력뿐 · 예약 게시는 사람이 모르고 지나갔다).
 *   실패로 끝내는 자리(채널 거절 · 컨테이너 상한 · 예약 시각 지남 · 결과 모름)가 이 함수 하나를 부른다.
 *   받는 사람 = 게시물을 만든 계정 → 회사 대표 관리자(담당자 통지 공용 함수) · 같은 호출의 같은 게시물 = 한 통 · 통지 실패는 삼킨다(게시 상태에 영향 0).
 * ★ 2026-10-26 S21(R14) — 「올라갔는지 확인하지 못함」(확인 포기 · 확인 불가)도 같은 함수로 알린다(옛: 화면 띠뿐).
 *   사유 = last_error(발행 워커가 publicErrorText 로 고른 우리 문장 · 플랫폼 원문 0 · ★ S5).
 */
import { query } from '../config/database';
import { getSnsAdapter } from './sns';
import { isSnsPlatform } from './sns-constants';

export async function notifySnsTargetsFailed(targetIds: string[]): Promise<void> {
  const ids = targetIds.filter(Boolean);
  if (ids.length === 0) return;
  try {
    const r = await query(
      `SELECT t.id, t.platform, t.status, t.last_error, p.id AS post_id, p.company_id, p.created_by, p.body
         FROM sns_post_targets t JOIN sns_posts p ON p.id = t.post_id
        WHERE t.id = ANY($1::uuid[])
          AND (t.status = 'failed' OR (t.status = 'submitted' AND t.verify_gave_up_at IS NOT NULL))`,
      [ids],
    );
    const byPost = new Map<string, any[]>();
    for (const row of r.rows) byPost.set(String(row.post_id), [...(byPost.get(String(row.post_id)) || []), row]);
    const { notifyOperatorAdmins } = await import('./continuous-operator');
    for (const rows of byPost.values()) {
      const head = rows[0];
      const snippet = String(head.body || '').replace(/\s+/g, ' ').trim().slice(0, 20);
      const label = (xs: any[]) => xs.map((x) => (isSnsPlatform(x.platform) && getSnsAdapter(x.platform)?.label) || '채널').join(' · ');
      const failed = rows.filter((x) => x.status === 'failed');
      const unsure = rows.filter((x) => x.status !== 'failed');
      const what = snippet ? `'${snippet}' ` : '';
      const lines: string[] = [];
      if (failed.length) {
        const reason = String(failed[0].last_error || '').trim().slice(0, 80);
        lines.push(`${what}게시물을 ${label(failed)}에 올리지 못했어요.${reason ? ` ${reason}` : ''}`);
      }
      if (unsure.length) lines.push(`${what}게시물이 ${label(unsure)}에 올라갔는지 확인하지 못했어요. 채널에서 직접 확인해 주세요.`);
      await notifyOperatorAdmins(
        { adminPhoneNumbers: [], backupAdminPhone: null, companyId: head.company_id, createdBy: head.created_by || null },
        failed.length ? '[SNS] 게시하지 못함' : '[SNS] 게시 확인 필요',
        `${lines.join(' ')} 한줄로 SNS 화면의 게시 이력에서 확인해 주세요.`,
        { noticeHeader: '[한줄로 SNS 안내문자]' },
      );
    }
  } catch (e: any) {
    console.warn('[SNS] 게시 실패 통지 경고:', e?.message);
  }
}
