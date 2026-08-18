/**
 * privacy-audit.ts — 개인정보 처리 이력 컨트롤타워 (★2026-08-18 전송자격인증 4.2)
 *
 * 무엇을 남기나
 *   인증기준 4.2가 "개인정보 조회·수정·삭제·**다운로드** 이력을 행위별로 기록"하라고 요구한다.
 *   조회를 전부 남기면 로그가 폭발하므로, **개인정보가 시스템 밖으로 나가거나 사라지는 순간**을 남긴다
 *   — 파일 내려받기(export)와 대량 삭제(purge)다.
 *
 * ⛔ 원본 개인정보를 로그에 담지 마라
 *   남기는 것은 **누가·언제·무엇을·몇 건**이다. 전화번호·이름 자체를 details에 넣으면
 *   개인정보를 지키려고 만든 로그가 개인정보 사본이 된다.
 *
 * 저장 위치 = `audit_logs`(신규 테이블 없음). action = `privacy_export` / `privacy_purge`.
 */

import type { Request } from 'express';
import { query } from '../config/database';

/** 개인정보가 나가는 경로 식별자 — 화면·심사 자료에서 이 이름으로 구분한다 */
export type PrivacyExportKind =
  | 'customers'          // 고객 DB 엑셀
  | 'send_results'       // 발송 결과(수신번호 포함)
  | 'send_detail'        // 캠페인 발송내역 CSV
  | 'unsubscribes'       // 수신거부 목록
  | 'address_book'       // 주소록
  | 'agent_stats';       // 에이전트 발송통계

export type PrivacyPurgeKind =
  | 'customers'
  | 'unsubscribes';

/**
 * 개인정보 파일 내려받기 기록.
 * ⚠ 실패해도 본 기능을 막지 않는다(로그가 다운로드를 죽이면 안 된다) — 대신 콘솔에 남긴다.
 */
export async function logPrivacyExport(params: {
  req: Request;
  kind: PrivacyExportKind;
  /** 내보낸 행 수. 모르면 생략 */
  count?: number;
  /** 대상 식별자(캠페인 id·그룹명 등). 개인정보는 넣지 않는다 */
  targetId?: string | null;
  /** 적용된 필터 요약 — 값이 아니라 어떤 축을 걸었는지만 */
  filterKeys?: string[];
}): Promise<void> {
  const { req, kind, count, targetId, filterKeys } = params;
  const user = (req as any).user || {};
  try {
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'privacy_export', $2, $3, $4, $5, $6, NOW())`,
      [
        user.userId || null,
        kind,
        isUuid(targetId) ? targetId : null,
        JSON.stringify({
          kind,
          companyId: user.companyId || null,
          userType: user.userType || null,
          count: typeof count === 'number' ? count : null,
          targetRef: targetId && !isUuid(targetId) ? String(targetId).slice(0, 100) : undefined,
          filterKeys: filterKeys && filterKeys.length ? filterKeys : undefined,
        }),
        req.ip,
        req.headers['user-agent'] || '',
      ]
    );
  } catch (err: any) {
    console.error('[privacy-audit] export 기록 실패:', kind, err?.message || err);
  }
}

/** 개인정보 대량 삭제 기록 */
export async function logPrivacyPurge(params: {
  req: Request;
  kind: PrivacyPurgeKind;
  count?: number;
  targetId?: string | null;
  reason?: string;
}): Promise<void> {
  const { req, kind, count, targetId, reason } = params;
  const user = (req as any).user || {};
  try {
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'privacy_purge', $2, $3, $4, $5, $6, NOW())`,
      [
        user.userId || null,
        kind,
        isUuid(targetId) ? targetId : null,
        JSON.stringify({
          kind,
          companyId: user.companyId || null,
          userType: user.userType || null,
          count: typeof count === 'number' ? count : null,
          reason: reason ? String(reason).slice(0, 200) : undefined,
        }),
        req.ip,
        req.headers['user-agent'] || '',
      ]
    );
  } catch (err: any) {
    console.error('[privacy-audit] purge 기록 실패:', kind, err?.message || err);
  }
}

/** audit_logs.target_id는 uuid 컬럼이다 — uuid가 아닌 참조는 details로 보낸다(타입 오류로 로그가 죽지 않게) */
function isUuid(value: any): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
