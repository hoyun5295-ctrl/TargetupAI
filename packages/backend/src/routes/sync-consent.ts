/**
 * sync-consent.ts — 싱크 에이전트 1.7.6 같은 번호 수신동의 세대 주소(★ 2026-11-04 C101)
 *
 * 설계서 = docs/2026-11-03-sync-duplicate-phone-consent-design.md §3-2 ② · ③ · ④ · ⑨.
 * routes/sync.ts 가 인증(syncAuth) 뒤에 `/consent-pass` 로 붙인다 → req.companyId = 인증된 회사.
 * 판정 · 표 읽고 쓰기 = utils/same-phone-consent.ts 만(이 파일은 입력 검사 · 응답만).
 */
import { Router, Request, Response } from 'express';
import { withTransaction } from '../config/database';
import { isUuid } from '../utils/normalize';
import {
  startConsentPass, stageConsentVotes, finishConsentStage, publishConsentPass, consentFailureResponse, CONSENT_STAGE_MAX,
} from '../utils/same-phone-consent';

type SyncReq = Request & { companyId?: string };
const router = Router();

/** 실패 응답 = CT consentFailureResponse(상태 어긋남 · 표 없음) · 그 밖 = 500(에이전트 재시도) */
async function respond(res: Response, work: () => Promise<unknown>) {
  try {
    return res.json({ success: true, data: await work() });
  } catch (e) {
    const f = consentFailureResponse(e);
    if (f) return res.status(f.status).json(f.body);
    console.error('[SyncConsent] 실패:', e);
    return res.status(500).json({ success: false, error: '수신동의 세대 처리 실패' });
  }
}

const bad = (res: Response, what: string) => res.status(400).json({ success: false, error: `${what} 형식이 맞지 않습니다` });

router.post('/start', (req: SyncReq, res: Response) => {
  const { agentId } = req.body || {};
  if (!isUuid(agentId)) return bad(res, 'agentId');
  return respond(res, () => withTransaction((run) => startConsentPass(run, req.companyId!, agentId)));
});

router.post('/stage', (req: SyncReq, res: Response) => {
  const { agentId, passId, rows } = req.body || {};
  if (!isUuid(agentId) || !isUuid(passId)) return bad(res, 'agentId · passId');
  if (!Array.isArray(rows) || rows.length > CONSENT_STAGE_MAX) return bad(res, `rows(배열 · 최대 ${CONSENT_STAGE_MAX})`);
  return respond(res, async () => ({ phones: await withTransaction((run) => stageConsentVotes(run, req.companyId!, agentId, passId, rows)) }));
});

router.post('/stage-done', (req: SyncReq, res: Response) => {
  const { agentId, passId } = req.body || {};
  if (!isUuid(agentId) || !isUuid(passId)) return bad(res, 'agentId · passId');
  return respond(res, async () => { await withTransaction((run) => finishConsentStage(run, req.companyId!, agentId, passId)); return {}; });
});

router.post('/complete', (req: SyncReq, res: Response) => {
  const { agentId, passId, sentBatches } = req.body || {};
  if (!isUuid(agentId) || !isUuid(passId)) return bad(res, 'agentId · passId');
  if (!Number.isInteger(sentBatches) || sentBatches < 0) return bad(res, 'sentBatches');
  return respond(res, () => publishConsentPass(req.companyId!, agentId, passId, sentBatches));
});

export default router;
