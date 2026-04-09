/**
 * ★ 전단AI POS Agent 수신 라우트
 * 마운트: /api/flyer/pos
 * CT: CT-F12 flyer-pos-ingest.ts
 *
 * ⚠️ 이 라우트는 POS Agent(외부 프로세스)에서 호출한다.
 * flyerAuthenticate가 아닌 별도 agent_key 인증을 사용.
 * Phase B 구현 시 에러가 나지 않도록 스켈레톤 응답만 제공.
 */

import { Request, Response, Router } from 'express';
import {
  verifyPosAgent,
  ingestSales,
  ingestInventory,
  ingestMembers,
  updateAgentHeartbeat,
} from '../../utils/flyer';

const router = Router();

/**
 * POS Agent 인증 미들웨어 (agent_key 기반)
 */
async function agentAuth(req: Request, res: Response, next: Function) {
  const agentKey = req.headers['x-agent-key'] as string || req.body?.agent_key;
  if (!agentKey) return res.status(401).json({ error: 'agent_key required' });

  const agent = await verifyPosAgent(agentKey);
  if (!agent) return res.status(401).json({ error: 'Invalid agent_key' });

  (req as any).agent = agent;
  next();
}

router.post('/push', agentAuth, async (req: Request, res: Response) => {
  try {
    const { companyId, agentId } = (req as any).agent;
    const { type, items } = req.body;

    if (!type || !Array.isArray(items)) {
      return res.status(400).json({ error: 'type and items[] required' });
    }

    let result;
    switch (type) {
      case 'sales': result = await ingestSales(companyId, agentId, items); break;
      case 'inventory': result = await ingestInventory(companyId, agentId, items); break;
      case 'members': result = await ingestMembers(companyId, agentId, items); break;
      default: return res.status(400).json({ error: `Unknown type: ${type}` });
    }
    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/pos] push error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/heartbeat', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = (req as any).agent;
    const { last_sync_at, pending_count = 0, error_count_24h = 0 } = req.body;
    await updateAgentHeartbeat(agentId, last_sync_at || new Date().toISOString(), pending_count, error_count_24h);
    return res.json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
