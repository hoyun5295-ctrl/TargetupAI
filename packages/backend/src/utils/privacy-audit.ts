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
 * 저장 위치 = `audit_logs`(신규 테이블 없음). action = `privacy_export` / `privacy_purge`
 *   + ★2026-09-11 `privacy_view`(조회) / `privacy_edit`(등록·수정) — 아래 절.
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

// ============================================================
//  ★ 2026-09-11 조회·수정 이력 (전송자격인증 4.2 반려 대응)
// ============================================================
// 심사 반려 = "개인정보 조회·수정·삭제 이력을 보관하고 있는가". 그전에는 반출·삭제만 남겼다.
// 조회를 행 단위로 남기면 로그가 폭발하므로 **요청 단위**로 남긴다 — 누가·언제·어느 화면·몇 건.
// ⛔ 원문 값은 넣지 않는다(반출 기록과 같은 원칙). 필터는 값이 아니라 축 이름만.

/** 개인정보가 화면으로 나가는 경로(조회) — 화면·심사 자료에서 이 이름으로 구분한다 */
//   ⚠ 건수만 돌려주는 경로(조건 미리보기 `POST /filter`·`/filter-count`·통계)는 개인정보가 나가지 않아 대상이 아니다.
export type PrivacyViewKind =
  | 'customers'            // 고객 DB 목록·검색
  | 'customer_extract'     // 발송 대상 추출(수신번호)
  | 'customer_detail'      // 고객 상세
  | 'customer_purchases'   // 고객 한 명의 구매 이력
  | 'customer_timeline'    // 고객 한 명의 활동 기록
  | 'purchases_overview';  // 구매 통합조회(고객 이름·번호 포함)

/** 개인정보를 바꾸는 경로(등록·수정) */
export type PrivacyEditKind =
  | 'customer_single'      // 고객 1명 등록·수정
  | 'customer_bulk'        // 고객 일괄 등록·수정
  | 'customer_upload';     // 고객 파일 업로드(등록·수정)

interface PrivacyAccessParams<K extends string> {
  req: Request;
  kind: K;
  /** 보여준·바꾼 행 수. 모르면 생략 */
  count?: number;
  /** 대상 식별자(고객 id 등). uuid만 target_id로 간다 */
  targetId?: string | null;
  /** 적용된 필터 요약 — 값이 아니라 어떤 축을 걸었는지만 */
  filterKeys?: string[];
  /** 누구의 데이터인가 — 슈퍼관리자가 다른 회사를 볼 때 그 회사. 생략하면 요청자 회사 */
  companyId?: string | null;
}

/** 개인정보 조회 기록 — 실패해도 조회를 막지 않는다 */
export async function logPrivacyView(params: PrivacyAccessParams<PrivacyViewKind>): Promise<void> {
  await writePrivacyAccessLog('privacy_view', params);
}

/** 개인정보 등록·수정 기록 — 실패해도 저장을 막지 않는다 */
export async function logPrivacyEdit(params: PrivacyAccessParams<PrivacyEditKind>): Promise<void> {
  await writePrivacyAccessLog('privacy_edit', params);
}

async function writePrivacyAccessLog(
  action: 'privacy_view' | 'privacy_edit',
  params: PrivacyAccessParams<string>,
): Promise<void> {
  const { req, kind, count, targetId, filterKeys, companyId } = params;
  const user = (req as any).user || {};
  try {
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        user.userId || null,
        action,
        kind,
        isUuid(targetId) ? targetId : null,
        JSON.stringify({
          kind,
          companyId: companyId || user.companyId || null,
          userType: user.userType || null,
          count: typeof count === 'number' ? count : null,
          filterKeys: filterKeys && filterKeys.length ? filterKeys : undefined,
        }),
        req.ip,
        req.headers['user-agent'] || '',
      ]
    );
  } catch (err: any) {
    console.error(`[privacy-audit] ${action} 기록 실패:`, kind, err?.message || err);
  }
}

/** audit_logs.target_id는 uuid 컬럼이다 — uuid가 아닌 참조는 details로 보낸다(타입 오류로 로그가 죽지 않게) */
function isUuid(value: any): boolean {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
