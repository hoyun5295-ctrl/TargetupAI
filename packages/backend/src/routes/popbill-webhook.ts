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

    // error 규칙: 재큐잉(아래 issued 번역) = 유지 / failed 전이 = 사유 기록 / 그 외 = 기존 유지.
    // (무조건 $err로 덮으면 304가 기존 실패 사유를 지운다 — 0730 Codex 지적 ⑥ 수용)
    // 잔여 위험(수용): 재전송이 순서를 뒤집으면(실제 305 후 지연 304) 상태가 마지막 수신 기준이 된다.
    // raw 전량 로그가 대사 근거고, 이벤트 이력 테이블은 DDL이라 이월.
    //
    // ★ 2026-07-31(2) Codex 4R — **issued 승격 단일 소유자 = 발행 패스(processOne)**.
    //   웹훅을 공동 확정자로 두면(3R안) 수신자 스냅샷 경합·롤백 후 재시도 부재·트랜잭션 안 풀 재진입이
    //   계속 파생됐다 — 웹훅은 순서 보장 없는 외부 신호라 내구 계약(참조 pending 기록)의 주체가 될 수 없다.
    //   그래서 304는 상태를 승격하지 않는다: ready/submitted/issued = 관측만(번호 기록), **failed만 submitted로
    //   재큐잉**해 워커에 위임한다 — 워커가 재수집 → registIssue 중복 → getInfo 3xx 자가치유로
    //   장부 확정·컨펌 동기화·참조 pending 기록을 **한 트랜잭션(단일 소유자)**에서 수행한다.
    //   (3R의 "failed→issued 직접 정정"은 "재큐잉을 통한 정정"으로 보존 — 확정 경로는 하나가 됐다.)
    // ★ Codex 5R — 304 관측은 상태 축에 내구로 남긴다: submitted/failed → **ready(재확인 필요)**.
    //   진행 중인 발행 패스가 registIssue 오류+getInfo 실패로 markFailed를 찍으려 해도, markFailed가
    //   조건부(WHERE status='submitted')라 이 관측 이후에는 거부된다 — 팝빌엔 발행된 문서가 내부에
    //   영구 failed로 남는 경합 차단. ready 행은 다음 tick이 재수집해 getInfo 자가치유로 확정한다.
    const r = await pool.query(
      `UPDATE taxbill_issues
          SET status = CASE
                WHEN $2 = 'issued' THEN CASE WHEN status IN ('failed', 'submitted') THEN 'ready' ELSE status END
                ELSE COALESCE($2, status)
              END,
              nts_confirm_num = COALESCE($3, nts_confirm_num),
              error = CASE WHEN $2 = 'issued' THEN error
                           WHEN $4::text IS NOT NULL THEN $4::text
                           ELSE error END
        WHERE invoicer_mgt_key = $1
        RETURNING status`,
      [decision.mgtKey, decision.set.status ?? null, decision.set.ntsConfirmNum ?? null, decision.set.error ?? null],
    );
    if ((r.rowCount || 0) === 0) {
      // 우리 행이 없다 — 그래도 200 (재전송 폭주 방지). 사후 대사는 팝빌 사이트 목록과 대조.
      log(`매칭 실패 — key=${decision.mgtKey} 행 없음 (사후 대사 대상)`);
    } else if (decision.set.status === 'issued') {
      log(`304 관측 — key=${decision.mgtKey} 행 상태=${r.rows[0]?.status} (승격은 발행 패스 소유 — submitted/failed였다면 ready 재확인 큐잉됨)`);
    } else {
      log(`갱신 — key=${decision.mgtKey} ${JSON.stringify(decision.set)}`);
    }
  } catch (err: any) {
    // 어떤 실패도 응답 계약(200)을 깨지 않는다 — 원인은 로그로.
    console.error('[팝빌웹훅] 처리 실패:', err?.message ?? err);
  }
  return res.status(200).send('OK');
});

export default router;
