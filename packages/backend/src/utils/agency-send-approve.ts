/**
 * agency-send-approve.ts — 대행발송 승인 효과 CT (★ 2026-08-25 신설 · 링크 승인 축)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §16.
 * 승인이라는 효과(판정 → 전이 → 이력 → 워커 즉시 기동)를 만드는 곳은 **이 함수 하나**다.
 * 입구가 둘이어도(로그인 화면 · 담당자 링크) 판정과 쓰기는 같은 줄을 지난다
 * (0819 교훈: 게이트는 효과를 만드는 함수 안에 — 입구마다 두면 반드시 샌다).
 *
 * ★Codex 적대 1R 정정 — 승인은 **한 트랜잭션**이다:
 *   SELECT ... FOR UPDATE → 판정(상태·revision·링크면 담당자 권한과 문안 버전 재검증) → UPDATE →
 *   이력 INSERT → COMMIT. 이력이 못 적히면 승인도 없던 일이 된다 — 링크 승인은 approved_by가
 *   없어서(계정이 아니라 폰 소지가 근거) **이력이 유일한 행위자 귀속 근거**이기 때문이다
 *   (Harold 2026-08-25 "승인한 핸드폰번호로 감사로그를 기록해놔야 나중에 딴소리 못하지").
 *
 * ⛔ 승인의 기준은 행 수정 번호(revision) CAS다(★2026-08-23 Codex 2R high). 링크 경로도
 *   화면과 똑같이 "담당자가 본 revision"을 받아 CAS를 지난다.
 * ⛔ 화면 경로는 회사 범위(company_id)를 잠금 SELECT와 UPDATE 양쪽에 건다.
 */
import { pool } from '../config/database';
import { checkApproval } from './agency-send-state';
import { triggerAgencySendDispatch } from './agency-send-worker';
import { agencyManagerPhones } from './agency-send-link';

export type ApproveVia = 'screen' | 'link';

export type ApproveOutcome =
  | { ok: true; row: any }
  | { ok: false; status: number; error: string; code?: string };

export async function approveAgencyRequestTx(opts: {
  requestId: string;
  /** 승인자가 화면·링크에서 **보고 있던** 행 수정 번호. CAS의 기준 */
  revision: number;
  /** 화면 경로의 회사 범위. 링크 경로는 토큰이 접수를 지목한다 */
  companyId?: string | null;
  /** 로그인 승인 = 사용자 id. 링크 승인 = null */
  approvedBy: string | null;
  via: ApproveVia;
  /**
   * 링크 경로의 권한 재료. 잠금 아래에서 다시 검증한다:
   *   phone이 **지금도** 담당자 목록에 있어야 하고, contentVersion이 **지금 문안 버전**이어야 한다
   *   (라우트가 먼저 걸러도, 그 읽기와 이 쓰기 사이의 변경은 여기서만 막을 수 있다).
   */
  link?: { phone: string; contentVersion: number; ip?: string; ua?: string };
}): Promise<ApproveOutcome> {
  if (opts.via === 'link' && !opts.link) {
    return { ok: false, status: 400, error: '승인 정보가 올바르지 않습니다.' };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const scope = opts.companyId ? ' AND company_id = $2::uuid' : '';
    const params: any[] = opts.companyId ? [opts.requestId, opts.companyId] : [opts.requestId];
    const r = await client.query(`SELECT * FROM agency_send_requests WHERE id = $1::uuid${scope} FOR UPDATE`, params);
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 404, error: '접수를 찾을 수 없습니다.' };
    }
    const row = r.rows[0];

    // 링크 권한 재검증(잠금 아래) — 담당자에서 빠진 번호·다듬어진 문안의 옛 링크는 여기서 끝난다
    if (opts.link) {
      if (!agencyManagerPhones(row).includes(opts.link.phone)
        || Number(row.content_version) !== Number(opts.link.contentVersion)) {
        await client.query('ROLLBACK');
        return { ok: false, status: 404, error: '유효하지 않거나 만료된 주소입니다.' };
      }
    }

    // ⛔ `final_test_at`을 함께 넘긴다(★2026-08-23(2)) — 당일 접수 건은 접수 검사가 곧 당일 검사라
    //   재검사가 없다. 그런 건에 2시간을 요구하면 하지도 않을 검사를 이유로 승인을 막는다.
    const check = checkApproval(
      {
        status: row.status,
        revision: Number(row.revision),
        requestedAt: new Date(row.requested_at),
        finalTestedAt: row.final_test_at ? new Date(row.final_test_at) : null,
      },
      opts.revision,
      new Date(),
    );
    if (!check.ok) {
      await client.query('ROLLBACK');
      // ★Codex 적대 2R: FOR UPDATE 직렬화 뒤에는 "동시 승인의 패자"가 여기로 온다(이미 approved라
      //   상태 판정에서 걸린다). 그 경우는 종전 계약대로 409 CONFLICT로 답한다 — 중복 클릭·응답
      //   유실 재시도가 400(승인 불가 상태)과 409(이미 처리됨)를 다르게 읽는다.
      if (check.code === 'NOT_APPROVABLE' && ['approved', 'final_testing', 'queued'].includes(String(row.status))) {
        return { ok: false, status: 409, error: '이미 처리된 접수입니다. 화면을 새로 고쳐 주세요.', code: 'CONFLICT' };
      }
      return { ok: false, status: 400, error: check.error || '지금은 승인할 수 없습니다.', code: check.code };
    }

    const updated = await client.query(
      `UPDATE agency_send_requests
          SET status = 'approved', approved_at = NOW(), approved_by = $1::uuid,
              approval_version = content_version, revision = revision + 1, updated_at = NOW()
        WHERE id = $2::uuid${opts.companyId ? ' AND company_id = $4::uuid' : ''}
          AND status IN ('awaiting_approval','reapproval') AND revision = $3
        RETURNING *`,
      opts.companyId
        ? [opts.approvedBy, opts.requestId, opts.revision, opts.companyId]
        : [opts.approvedBy, opts.requestId, opts.revision],
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, status: 409, error: '이미 처리된 접수입니다. 화면을 새로 고쳐 주세요.', code: 'CONFLICT' };
    }

    // 이력은 승인과 한 몸이다 — 실패하면 트랜잭션째 되돌아가 승인 자체가 없던 일이 된다
    await client.query(
      `INSERT INTO agency_send_events (request_id, kind, payload) VALUES ($1::uuid, 'approved', $2::jsonb)`,
      [opts.requestId, JSON.stringify({
        revision: opts.revision,
        via: opts.via,
        ...(opts.approvedBy ? { by: opts.approvedBy } : {}),
        ...(opts.link?.phone ? { phone: opts.link.phone } : {}),
        ...(opts.link?.ip ? { ip: opts.link.ip } : {}),
        ...(opts.link?.ua ? { ua: String(opts.link.ua).slice(0, 200) } : {}),
      })],
    );

    await client.query('COMMIT');
    // 재승인은 남은 시간이 짧다. 다음 tick을 기다리면 그 사이에 만료 기준을 지나 승인이 헛돈다.
    // 워커 기동은 커밋 **뒤**다(커밋 전이면 워커가 옛 상태를 읽는다).
    triggerAgencySendDispatch(opts.requestId);
    return { ok: true, row: updated.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
