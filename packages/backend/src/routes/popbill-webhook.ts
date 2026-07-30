/**
 * /api/popbill/webhook — 팝빌 세금계산서 상태 웹훅 수신 (2026-07-30)
 *
 * SoT = docs/2026-07-28-bulk-invoice-confirm-taxbill-design.md §7-0(SDK·웹훅 요지).
 * 판정은 utils/taxbill-popbill.ts `decideWebhookUpdate`(순수) — 라우트는 thin.
 *
 * ⛔ 응답 계약 = **무조건 HTTP 200 + "OK"** (매칭 실패·파싱 실패 포함).
 *    그 외 응답은 팝빌이 5분 간격 총 4회 재전송한다 — 실패를 실패로 돌려주면 폭주가 된다.
 *    매칭 실패는 로그로 남기고 사후 대사(팝빌 사이트·getInfo)로 잡는다.
 *
 * 인증: 팝빌 웹훅 인증 옵션(미사용/Basic/X-Api-Key) 중 X-Api-Key만 지원 —
 *    POPBILL_WEBHOOK_API_KEY가 설정돼 있을 때만 검증하고, 불일치는 401(재전송 4회 후 멈춤 — 오발신 차단이 목적).
 *    미설정이면 통과(팝빌 Source IP 고정 54.180.62.221·13.124.72.158 — 방화벽 화이트리스트가 1차 방어).
 */

import { Request, Response, Router } from 'express';
import pool from '../config/database';
import { decideWebhookUpdate } from '../utils/taxbill-popbill';

const router = Router();
const log = (msg: string) => console.log(`[팝빌웹훅] ${msg}`);

router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const apiKey = String(process.env.POPBILL_WEBHOOK_API_KEY || '').trim();
    if (apiKey && String(req.headers['x-api-key'] || '') !== apiKey) {
      log(`인증 실패 — x-api-key 불일치 (ip=${req.ip})`);
      return res.status(401).send('Unauthorized');
    }

    // 외부 API 응답 추측 금지 — raw를 항상 남긴다. 실측으로 필드 표기가 확정되면 이 로그가 근거다.
    log(`수신 raw — ${JSON.stringify(req.body).slice(0, 1500)}`);

    const decision = decideWebhookUpdate(req.body);
    if (!decision) {
      log('매칭 키(invoicerMgtKey) 없음 — 테스트 핑이거나 다른 이벤트. 기록만 하고 200.');
      return res.status(200).send('OK');
    }

    if (Object.keys(decision.set).length === 0) {
      log(`관측만 — key=${decision.mgtKey} stateCode=${req.body?.stateCode} (갱신 없음)`);
      return res.status(200).send('OK');
    }

    // error 규칙: issued 전이 = NULL(회복 명시) / failed 전이 = 사유 기록 / 그 외 = 기존 유지.
    // (무조건 $err로 덮으면 304가 기존 실패 사유를 지운다 — 0730 Codex 지적 ⑥ 수용)
    // 잔여 위험(수용): 재전송이 순서를 뒤집으면(실제 305 후 지연 304) 상태가 마지막 수신 기준이 된다.
    // raw 전량 로그가 대사 근거고, 이벤트 이력 테이블은 DDL이라 이월.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE taxbill_issues
            SET status = COALESCE($2, status),
                nts_confirm_num = COALESCE($3, nts_confirm_num),
                error = CASE WHEN $2 = 'issued' THEN NULL
                             WHEN $4::text IS NOT NULL THEN $4::text
                             ELSE error END,
                issued_at = CASE WHEN $2 = 'issued' THEN COALESCE(issued_at, NOW()) ELSE issued_at END
          WHERE invoicer_mgt_key = $1
          RETURNING confirmation_id`,
        [decision.mgtKey, decision.set.status ?? null, decision.set.ntsConfirmNum ?? null, decision.set.error ?? null],
      );
      // 발행 확정(304)은 공개 컨펌 축에도 동기화 — 장부만 알면 컨펌 페이지가 발행 후에도 이의신청을 받는다.
      const confirmationId = r.rows[0]?.confirmation_id ?? null;
      if (decision.set.status === 'issued' && confirmationId) {
        await client.query(
          `UPDATE invoice_confirmations
              SET taxbill_status = 'issued',
                  issued_at = COALESCE(issued_at, NOW()),
                  popbill_invoice_key = COALESCE(popbill_invoice_key, $2)
            WHERE id = $1`,
          [confirmationId, decision.mgtKey],
        );
      }
      await client.query('COMMIT');
      if ((r.rowCount || 0) === 0) {
        // 우리 행이 없다 — 그래도 200 (재전송 폭주 방지). 사후 대사는 팝빌 사이트 목록과 대조.
        log(`매칭 실패 — key=${decision.mgtKey} 행 없음 (사후 대사 대상)`);
      } else {
        log(`갱신 — key=${decision.mgtKey} ${JSON.stringify(decision.set)}`);
      }
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch { /* 아래 로그로 */ }
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: any) {
    // 어떤 실패도 응답 계약(200)을 깨지 않는다 — 원인은 로그로.
    console.error('[팝빌웹훅] 처리 실패:', err?.message ?? err);
  }
  return res.status(200).send('OK');
});

export default router;
