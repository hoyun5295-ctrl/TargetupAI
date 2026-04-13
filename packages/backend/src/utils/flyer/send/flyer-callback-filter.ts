/**
 * ★ CT-F06 — 전단AI 회신번호 해석/필터 컨트롤타워
 *
 * 한줄로 utils/callback-filter.ts와 완전 분리.
 * - 회사의 기본 회신번호 조회 (flyer_callback_numbers.is_default=true)
 * - 발송 시 callback 결정: 사용자 지정 → 기본 → 에러
 * - 개별 회신번호 기능은 Phase B 이후 (지금은 단일 기본값 사용)
 */

import { query } from '../../../config/database';

export interface CallbackResolveResult {
  callback: string | null;
  source: 'requested' | 'default' | 'none';
  error?: string;
}

/**
 * 회사의 모든 회신번호 조회.
 */
export async function getFlyerCallbackNumbers(companyId: string): Promise<Array<{
  id: string; phone: string; label: string | null; is_default: boolean;
}>> {
  const result = await query(
    `SELECT id, phone, label, is_default
     FROM flyer_callback_numbers
     WHERE company_id = $1 AND deleted_at IS NULL
     ORDER BY is_default DESC, created_at ASC`,
    [companyId]
  );
  return result.rows;
}

/**
 * 발송에 사용할 회신번호 결정.
 * requested가 있으면 해당 번호가 등록되어 있는지 검증.
 * 없으면 is_default=true 번호 사용.
 */
export async function resolveFlyerCallback(
  companyId: string,
  requested?: string | null
): Promise<CallbackResolveResult> {
  if (requested) {
    const result = await query(
      `SELECT phone FROM flyer_callback_numbers
       WHERE company_id = $1 AND phone = $2 AND deleted_at IS NULL`,
      [companyId, requested]
    );
    if (result.rows.length > 0) {
      return { callback: requested, source: 'requested' };
    }
    return { callback: null, source: 'none', error: '요청한 회신번호가 등록되어 있지 않습니다' };
  }

  const defaultResult = await query(
    `SELECT phone FROM flyer_callback_numbers
     WHERE company_id = $1 AND is_default = true AND deleted_at IS NULL
     LIMIT 1`,
    [companyId]
  );
  if (defaultResult.rows.length > 0) {
    return { callback: defaultResult.rows[0].phone, source: 'default' };
  }
  return { callback: null, source: 'none', error: '기본 회신번호가 설정되어 있지 않습니다' };
}
