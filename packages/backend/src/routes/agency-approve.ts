/**
 * routes/agency-approve.ts — 대행발송 담당자 링크 승인 (★ 2026-08-25 신설 · 무인증)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §16. 담당자 안내 문자의 주소가 여는 공개 endpoint다
 * (선례 = journey-pause-public.ts: 토큰 검증 + 정보 GET + 실행 POST).
 *
 *   GET  /api/agency-approve/info    — 토큰 검증 + 승인 화면 재료 반환 (인증 X)
 *   POST /api/agency-approve/approve — 승인 실행 (인증 X · 효과는 승인 CT 하나가 소유)
 *
 * ⛔ 토큰은 **헤더**(X-Agency-Approve-Token)로만 받는다(★Codex 적대 1R) — URL에 실으면 morgan·
 *   느린 요청 로그에 bearer가 평문으로 남아, 로그를 본 사람이 승인권을 얻는다.
 * ⛔ 권한 = 서명 토큰(접수 id + 담당자 번호 + 문안 버전) 소지. 단 그 번호가 **지금도** 담당자
 *   목록에 있어야 하고(판정 = agencyManagerPhones 한 벌), 문안 버전이 지금 것과 같아야 한다.
 *   무효는 전부 같은 404로 답한다(무엇이 틀렸는지 알려주지 않는다). 최종 재검증은 승인 CT가
 *   잠금 아래에서 한 번 더 한다.
 * ⛔ 이 경로가 노출하는 것은 문안·시각·건수·발신번호뿐이다. 수신자 명단·변수 매핑·회사 내부
 *   식별자는 내보내지 않는다(링크가 흘러도 새는 것은 마케팅 문안뿐).
 * ⛔ 승인 외의 일(문안 수정·시각 변경·취소)은 로그인 화면 소유 — 이 경로에 만들지 않는다.
 */
import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import {
  AGENCY_APPROVE_TOKEN_HEADER, agencyManagerPhones, verifyAgencyApproveToken,
} from '../utils/agency-send-link';
import { approveAgencyRequestTx } from '../utils/agency-send-approve';
import { checkApproval } from '../utils/agency-send-state';

const router = Router();

const isMissingRelation = (err: any) => {
  const msg = String(err?.message || '');
  return msg.includes('relation') && msg.includes('does not exist');
};

/** 헤더 토큰을 검증하고 접수 행까지 찾아 돌려준다. 무효는 전부 null(같은 404) */
async function resolveToken(req: Request): Promise<{ row: any; phone: string; contentVersion: number } | null> {
  const token = String(req.headers[AGENCY_APPROVE_TOKEN_HEADER] || '');
  const payload = verifyAgencyApproveToken(token);
  if (!payload) return null;
  const r = await query(`SELECT * FROM agency_send_requests WHERE id = $1::uuid`, [payload.requestId]);
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (!agencyManagerPhones(row).includes(payload.phone)) return null;
  if (Number(row.content_version) !== Number(payload.contentVersion)) return null;
  return { row, phone: payload.phone, contentVersion: payload.contentVersion };
}

/** 승인 화면이 그릴 것만 내보낸다. toPublic(로그인 화면용)보다 좁다 */
function toApprovalView(row: any) {
  return {
    label: row.file_name || String(row.current_content || '').slice(0, 24),
    status: row.status,
    messageType: row.message_type,
    subject: row.subject,
    content: row.current_content,
    isAd: !!row.is_ad,
    callbackNumber: row.callback_number,
    requestedAt: row.requested_at,
    recipientCount: Number(row.recipient_count || 0),
    imageCount: Array.isArray(row.mms_image_paths) ? row.mms_image_paths.length : 0,
    revision: Number(row.revision),
    approvedAt: row.approved_at,
  };
}

router.get('/info', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });
    const { row } = resolved;
    const check = checkApproval(
      {
        status: row.status,
        revision: Number(row.revision),
        requestedAt: new Date(row.requested_at),
        finalTestedAt: row.final_test_at ? new Date(row.final_test_at) : null,
      },
      Number(row.revision),
      new Date(),
    );
    return res.json({
      success: true,
      request: toApprovalView(row),
      approvable: check.ok,
      blockReason: check.ok ? null : check.error,
    });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[agency-approve] 조회 실패:', err);
    return res.status(500).json({ success: false, error: '내용을 불러오지 못했습니다.' });
  }
});

router.post('/approve', async (req: Request, res: Response) => {
  try {
    const resolved = await resolveToken(req);
    if (!resolved) return res.status(404).json({ success: false, error: '유효하지 않거나 만료된 주소입니다.' });

    // 감사 재료(Harold 2026-08-25 "승인한 핸드폰번호로 감사로그"): 어느 번호의 링크가, 어디서 눌렀나.
    // 기록은 승인 CT가 승인과 **한 트랜잭션**으로 남긴다(이력이 못 적히면 승인도 없던 일).
    const outcome = await approveAgencyRequestTx({
      requestId: resolved.row.id,
      revision: Number(req.body?.revision),
      approvedBy: null,
      via: 'link',
      link: {
        phone: resolved.phone,
        contentVersion: resolved.contentVersion,
        ip: String(req.ip || ''),
        ua: String(req.headers['user-agent'] || ''),
      },
    });
    if (!outcome.ok) {
      return res.status(outcome.status).json({ success: false, error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) });
    }
    console.log(`[agency-approve] 링크 승인 request=${resolved.row.id} phone=${resolved.phone}`);
    return res.json({ success: true, request: toApprovalView(outcome.row) });
  } catch (err: any) {
    if (isMissingRelation(err)) return res.status(503).json({ success: false, error: '잠시 후 다시 시도해 주세요.' });
    console.error('[agency-approve] 승인 실패:', err);
    return res.status(500).json({ success: false, error: '승인하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
