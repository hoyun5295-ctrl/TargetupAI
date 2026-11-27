// ============================================================
// bito-sync.ts — 비토엔진이 당겨 가는 발신번호 거울 입구(★ 2026-11-24 · B-1124-3 · 설계서 docs/2026-11-24-callback-bito-sync-design.md §3)
// ============================================================
// 호출자 = 비토 관리 API 의 동기화 작업자(60초마다 · 서버 58.227.193.65).
// 인증 = 전용 토큰(X-Bito-Sync-Token · ENV BITO_SENDER_SYNC_TOKEN) AND 출발지(ENV BITO_SENDER_SYNC_IPS) · 토큰 ENV 없음 = 503(꺼짐이 기본).
// 판정 · 목록 · 저장 = utils/bito-sender-sync.ts(이 파일은 부르기만).
// ============================================================

import { Router, Request, Response } from 'express';
import { checkBitoSyncCaller, listBitoSenderCompanies, parseBitoSyncResults, saveBitoSyncResults } from '../utils/bito-sender-sync';
import { listBitoTemplateCompanies, parseBitoTemplateResults, reportBitoTemplateResults } from '../utils/bito-template-sync';

const router = Router();

function denied(req: Request, res: Response): boolean {
  const gate = checkBitoSyncCaller(req.headers['x-bito-sync-token'], String(req.ip || ''));
  if (gate.ok) return false;
  if (gate.status !== 503) console.warn(`[bito-sync] 입구 거절 ${gate.status} ip=${req.ip}`);
  res.status(gate.status).json({ error: gate.status === 503 ? 'disabled' : 'forbidden' });
  return true;
}

// GET /api/bito-sync/sender-numbers — V 발송ID 회사마다 등록 번호(번호 0 인 회사도)
router.get('/sender-numbers', async (req: Request, res: Response) => {
  if (denied(req, res)) return;
  try {
    res.json({ companies: await listBitoSenderCompanies() });
  } catch (err: any) {
    console.error('[bito-sync] 목록 실패:', err?.message || err);
    res.status(500).json({ error: 'list failed' });
  }
});

// POST /api/bito-sync/sender-numbers/results — 번호마다 비토 결과(옛 회차 = 409 · 저장 0)
router.post('/sender-numbers/results', async (req: Request, res: Response) => {
  if (denied(req, res)) return;
  const parsed = parseBitoSyncResults(req.body);
  if (!parsed) return res.status(400).json({ error: 'bad body' });
  try {
    const saved = await saveBitoSyncResults(parsed.roundAt, parsed.results);
    if (saved === 'stale') return res.status(409).json({ error: 'stale round' });
    res.json({ saved: parsed.results.length });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('does not exist') && (msg.includes('relation') || msg.includes('column'))) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요: bito_sender_sync · bito_sender_sync_round CREATE 실행 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[bito-sync] 결과 저장 실패:', msg);
    res.status(500).json({ error: 'save failed' });
  }
});

// GET /api/bito-sync/kakao-templates — V 발송ID 회사마다 승인 알림톡 템플릿(★2026-11-27 · 설계서 docs/2026-11-27-bito-template-auto-link-design.md §3-1)
router.get('/kakao-templates', async (req: Request, res: Response) => {
  if (denied(req, res)) return;
  try {
    res.json({ companies: await listBitoTemplateCompanies() });
  } catch (err: any) {
    console.error('[bito-sync] 템플릿 목록 실패:', err?.message || err);
    res.status(500).json({ error: 'list failed' });
  }
});

// POST /api/bito-sync/kakao-templates/results — 비토 결과(저장 0 · 응답 뒤 경보)
router.post('/kakao-templates/results', (req: Request, res: Response) => {
  if (denied(req, res)) return;
  const parsed = parseBitoTemplateResults(req.body);
  if (!parsed) return res.status(400).json({ error: 'bad body' });
  res.json({ received: parsed.accounts.length + parsed.templates.length });
  reportBitoTemplateResults(parsed).catch((err: any) => console.error('[bito-sync] 템플릿 결과 경보 실패:', err?.message || err));
});

export default router;
