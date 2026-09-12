/**
 * kakao-sender-profile-admin.ts — 발신 프로필 관리(슈퍼관리자) 컨트롤타워 (★2026-09-12)
 *
 * 무엇을 하나
 *   고객사 요청으로 더 이상 쓰지 않는 카카오 발신 프로필을 **사용 중지**하고, 누가 했는지 남긴다.
 *
 * ⛔ 지우지 않는다 — 지울 수가 없다
 *   `campaigns.kakao_profile_id`가 ON DELETE 없이 이 표를 참조한다(0912 pg_constraint 실측).
 *   그 프로필로 발송한 캠페인이 하나라도 있으면 하드 삭제는 23503으로 막히고,
 *   억지로 뚫으려면 발송·정산 원장인 캠페인을 지워야 한다. `brand_message_templates`는
 *   CASCADE라 경고 없이 함께 사라진다. 그래서 상태만 내리고 원장은 전부 보존한다.
 *
 * ⛔ 중지가 화면에 반영되려면 목록 조회가 그것을 빼야 한다
 *   프로필 목록 조회에 조건이 없으면 중지해도 그대로 보인다 — 접수가 닫히지 않는다.
 *   단 **중복 연결 가드**(profile_key·yellow_id 조회)에는 넣지 않는다.
 *   중지된 프로필의 키를 다른 고객사가 다시 연결하면 안 되기 때문이다.
 */

import { query } from '../config/database';
import { recordAuditLog } from './audit-log';

/** 중지 상태 값 — `kakao_sender_profiles.status` 문서 집합의 DELETED를 쓴다(DDL 0) */
export const SENDER_PROFILE_DISABLED_STATUS = 'DELETED';

export interface DisabledProfile {
  id: string;
  companyName: string | null;
  profileName: string | null;
  yellowId: string | null;
  templateCount: number;
  brandTemplateCount: number;
}

export type DisableProfileResult =
  | { ok: true; profile: DisabledProfile }
  | { ok: false; reason: 'not_found' | 'already_disabled' };

/**
 * 발신 프로필 사용 중지 — 상태·활성 플래그를 함께 내리고 감사 기록을 남긴다.
 * 캠페인·알림톡 템플릿·브랜드 템플릿은 손대지 않는다(원장 보존).
 */
export async function disableSenderProfile(params: {
  profileId: string;
  actorUserId: string | null;
  req?: any;
}): Promise<DisableProfileResult> {
  const found = await query(
    `SELECT p.id, p.company_id, p.profile_name, p.yellow_id, p.status, p.is_active,
            c.company_name,
            (SELECT COUNT(*)::int FROM kakao_templates t WHERE t.profile_id = p.id) AS template_count,
            (SELECT COUNT(*)::int FROM brand_message_templates b WHERE b.profile_id = p.id) AS brand_template_count
       FROM kakao_sender_profiles p
       LEFT JOIN companies c ON c.id = p.company_id
      WHERE p.id = $1::uuid`,
    [params.profileId],
  );
  const row = found.rows[0];
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.is_active === false || row.status === SENDER_PROFILE_DISABLED_STATUS) {
    return { ok: false, reason: 'already_disabled' };
  }

  await query(
    `UPDATE kakao_sender_profiles
        SET status = $2, is_active = false, updated_at = now()
      WHERE id = $1::uuid`,
    [params.profileId, SENDER_PROFILE_DISABLED_STATUS],
  );

  const profile: DisabledProfile = {
    id: String(row.id),
    companyName: row.company_name ?? null,
    profileName: row.profile_name ?? null,
    yellowId: row.yellow_id ?? null,
    templateCount: Number(row.template_count || 0),
    brandTemplateCount: Number(row.brand_template_count || 0),
  };

  await recordAuditLog({
    actorUserId: params.actorUserId,
    action: 'kakao_profile_disabled',
    targetType: 'kakao_sender_profile',
    targetId: profile.id,
    details: {
      company_name: profile.companyName,
      profile_name: profile.profileName,
      yellow_id: profile.yellowId,
      template_count: profile.templateCount,
      brand_template_count: profile.brandTemplateCount,
    },
    req: params.req,
  });

  return { ok: true, profile };
}
