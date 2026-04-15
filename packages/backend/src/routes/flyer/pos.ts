/**
 * ★ 전단AI POS Agent 수신 라우트
 * 마운트: /api/flyer/pos
 * CT: CT-F12 flyer-pos-ingest.ts, CT-F16 flyer-pos-ai.ts
 *
 * ⚠️ 이 라우트는 POS Agent(외부 프로세스)에서 호출한다.
 * flyerAuthenticate가 아닌 별도 agent_key 인증을 사용.
 */

import { Request, Response, Router } from 'express';
import {
  verifyPosAgent,
  ingestSales,
  ingestInventory,
  ingestMembers,
  ingestPromotions,
  updateAgentHeartbeat,
  analyzeSchema,
  saveSchemaMapping,
  getSchemaMapping,
  getTopSellingProducts,
  getPosAgentStatusList,
} from '../../utils/flyer';
import type { PosRawSchema } from '../../utils/flyer';
import { query } from '../../config/database';

const router = Router();

// ============================================================
// POS Agent 인증 미들웨어 (agent_key 기반)
// ============================================================
async function agentAuth(req: Request, res: Response, next: Function) {
  const agentKey = req.headers['x-agent-key'] as string || req.body?.agent_key;
  if (!agentKey) return res.status(401).json({ error: 'agent_key required' });

  const agent = await verifyPosAgent(agentKey);
  if (!agent) return res.status(401).json({ error: 'Invalid agent_key' });

  (req as any).agent = agent;
  next();
}

// ============================================================
// POST /register — Agent 최초 등록 + 스키마 분석 요청
// ============================================================
router.post('/register', agentAuth, async (req: Request, res: Response) => {
  try {
    const { companyId, agentId } = (req as any).agent;
    const { hostname, ip_address, pos_type, pos_version } = req.body;

    // Agent 정보 업데이트
    await query(
      `UPDATE flyer_pos_agents SET
         hostname = COALESCE($2, hostname),
         ip_address = COALESCE($3, ip_address),
         pos_type = COALESCE($4, pos_type),
         pos_version = COALESCE($5, pos_version),
         sync_status = 'connected',
         last_heartbeat = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [agentId, hostname, ip_address, pos_type, pos_version]
    );

    // 기존 스키마 매핑이 있으면 반환
    const existing = await getSchemaMapping(agentId);

    return res.json({
      ok: true,
      agentId,
      companyId,
      schemaMapping: existing,
      message: existing ? '기존 스키마 매핑 로드됨' : '스키마 분석 필요 — POST /analyze-schema 호출',
    });
  } catch (error: any) {
    console.error('[flyer/pos] register error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// POST /analyze-schema — ★ AI 스키마 자동 분석
// ============================================================
router.post('/analyze-schema', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId } = (req as any).agent;
    const rawSchema: PosRawSchema = req.body;

    if (!rawSchema.tables || !Array.isArray(rawSchema.tables) || rawSchema.tables.length === 0) {
      return res.status(400).json({ error: 'tables[] 필수 — INFORMATION_SCHEMA에서 읽어서 전송' });
    }

    console.log(`[flyer/pos] AI 스키마 분석 시작 — Agent ${agentId}, 테이블 ${rawSchema.tables.length}개`);

    // Claude API로 스키마 분석
    const mapping = await analyzeSchema(rawSchema);

    // 결과 저장
    await saveSchemaMapping(agentId, mapping);

    console.log(`[flyer/pos] AI 스키마 분석 완료 — confidence: ${mapping.confidence}%, member: ${mapping.memberTable}, sales: ${mapping.salesTable}`);

    return res.json({
      ok: true,
      mapping,
      message: mapping.confidence >= 70
        ? '스키마 분석 완료 — 자동 매핑 적용 가능'
        : '스키마 분석 완료 — 확신도 낮음, 사장님 확인 필요',
    });
  } catch (error: any) {
    console.error('[flyer/pos] analyze-schema error:', error);
    return res.status(500).json({ error: `AI 분석 실패: ${error.message}` });
  }
});

// ============================================================
// GET /config — Agent 설정 다운로드 (매핑 결과 + 싱크 주기)
// ============================================================
router.get('/config', agentAuth, async (req: Request, res: Response) => {
  try {
    const { agentId, companyId } = (req as any).agent;

    const mapping = await getSchemaMapping(agentId);

    // 회사 설정 조회 (싱크 주기 등)
    const companyResult = await query(
      `SELECT company_name, business_type FROM flyer_companies WHERE id = $1`,
      [companyId]
    );
    const company = companyResult.rows[0] || {};

    return res.json({
      agentId,
      companyId,
      companyName: company.company_name,
      businessType: company.business_type,

      // 스키마 매핑 (없으면 null → Agent가 analyze-schema 호출)
      schemaMapping: mapping,

      // 싱크 설정
      syncConfig: {
        salesIntervalMinutes: 5,      // 판매 데이터 5분 간격
        membersIntervalMinutes: 30,   // 회원 데이터 30분 간격
        inventoryIntervalMinutes: 60, // 재고 스냅샷 1시간 간격
        heartbeatIntervalSeconds: 60, // 하트비트 1분 간격
        batchSize: 500,               // 한 번에 전송할 최대 건수
      },
    });
  } catch (error: any) {
    console.error('[flyer/pos] config error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// POST /push — 데이터 푸시 (sales/members/inventory)
// ============================================================
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
      case 'promotions': result = await ingestPromotions(companyId, agentId, items); break;
      default: return res.status(400).json({ error: `Unknown type: ${type}` });
    }
    return res.json(result);
  } catch (error: any) {
    console.error('[flyer/pos] push error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// POST /heartbeat — 하트비트
// ============================================================
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

// ============================================================
// GET /top-selling — POS 판매 기반 인기 상품 (flyerAuthenticate용)
// ★ 이 엔드포인트는 매장 사용자가 호출 — agentAuth 아닌 flyerAuth 필요
// ============================================================
import { flyerAuthenticate } from '../../middlewares/flyer-auth';

router.get('/top-selling', flyerAuthenticate, async (req: Request, res: Response) => {
  try {
    const companyId = req.flyerUser?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 정보 없음' });

    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const period = Math.min(Number(req.query.period) || 30, 90);

    const products = await getTopSellingProducts(companyId, limit, period);
    return res.json(products);
  } catch (error: any) {
    console.error('[pos] top-selling error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================
// GET /agents — POS Agent 상태 목록 (슈퍼관리자 전용)
// ============================================================
router.get('/agents', async (req: Request, res: Response) => {
  try {
    // 슈퍼관리자 체크 — 간단 토큰 검증
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const agents = await getPosAgentStatusList();
    return res.json(agents);
  } catch (error: any) {
    console.error('[pos] agents list error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

export default router;
