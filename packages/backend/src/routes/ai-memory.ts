/**
 * D217+ AI 메모리 강화 — 신규 endpoint 3건 (2026-05-25)
 *
 * 옛 CRUD endpoint = routes/ai.ts:2020~2102 그대로 유지 (legacy 호환).
 * 본 파일 = Journey Builder 동급 8 화면 강화에 필요한 신규 endpoint 추가:
 *   - GET  /api/ai-memory/overview        — 5 metric + 자율 진단 한 줄
 *   - POST /api/ai-memory/search-natural  — 자연어 질문 → AI 답변 (회사 메모리 근거)
 *   - GET  /api/ai-memory/top-impact      — 영향도 top N (usageCount + importance DESC)
 *
 * DB 의존: ai_company_memory (CT-37) — usage_count 컬럼 503 안전망 의무.
 */

import { Request, Response, Router } from 'express';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import { callAIWithFallback } from '../services/ai';
import { buildMemoryPromptContext, listMemories, MemoryType } from '../utils/company-memory';

const router = Router();
router.use(authenticate);

const TYPE_LABEL: Record<MemoryType, string> = {
  success_pattern: '성공 패턴',
  customer_insight: '고객 인사이트',
  brand_tone_evolution: '브랜드 톤',
  channel_performance: '채널 성과',
  compliance_learning: '컴플라이언스 학습',
};

// ════════════════════════════════════════════════════════════════════
// 1. GET /api/ai-memory/overview — 5 metric + 자율 진단
// ════════════════════════════════════════════════════════════════════

router.get('/overview', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    const overviewRes = await query(
      `SELECT
         COUNT(*)::int AS total,
         MAX(updated_at) AS last_learned_at,
         COUNT(*) FILTER (WHERE memory_type = 'success_pattern')::int AS success_pattern,
         COUNT(*) FILTER (WHERE memory_type = 'customer_insight')::int AS customer_insight,
         COUNT(*) FILTER (WHERE memory_type = 'brand_tone_evolution')::int AS brand_tone_evolution,
         COUNT(*) FILTER (WHERE memory_type = 'channel_performance')::int AS channel_performance,
         COUNT(*) FILTER (WHERE memory_type = 'compliance_learning')::int AS compliance_learning,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS recent_30d_added,
         AVG(importance)::float AS avg_importance
       FROM ai_company_memory
       WHERE company_id = $1::uuid`,
      [companyId],
    );
    const row = overviewRes.rows[0] || {};

    const topImpactRes = await query(
      `SELECT id, memory_type, memory_key, memory_value, importance,
              COALESCE(usage_count, 0)::int AS usage_count
       FROM ai_company_memory
       WHERE company_id = $1::uuid
       ORDER BY COALESCE(usage_count, 0) DESC, importance DESC, last_accessed_at DESC
       LIMIT 1`,
      [companyId],
    );
    const top = topImpactRes.rows[0] || null;

    const total = Number(row.total) || 0;
    const lastLearned = row.last_learned_at ? new Date(row.last_learned_at) : null;
    const daysAgo = lastLearned
      ? Math.max(0, Math.floor((Date.now() - lastLearned.getTime()) / 86_400_000))
      : null;

    const typeDistribution = {
      success_pattern: Number(row.success_pattern) || 0,
      customer_insight: Number(row.customer_insight) || 0,
      brand_tone_evolution: Number(row.brand_tone_evolution) || 0,
      channel_performance: Number(row.channel_performance) || 0,
      compliance_learning: Number(row.compliance_learning) || 0,
    };
    let topType: MemoryType | null = null;
    let topTypeCount = 0;
    for (const [k, v] of Object.entries(typeDistribution)) {
      if (v > topTypeCount) {
        topType = k as MemoryType;
        topTypeCount = v;
      }
    }

    let topInsight = '';
    if (total === 0) {
      topInsight = '아직 학습된 메모리가 없습니다. 캠페인 발송 시 성공 패턴과 채널 성과가 자동으로 쌓입니다.';
    } else if (top) {
      const usage = Number(top.usage_count) || 0;
      const valueShort = String(top.memory_value || '').slice(0, 80);
      topInsight = usage > 0
        ? `AI가 가장 자주 참고한 학습: "${top.memory_key}" — ${valueShort} (AI 활용 ${usage}회)`
        : `가장 중요도 높은 학습: "${top.memory_key}" — ${valueShort} (중요도 ${top.importance})`;
    } else {
      topInsight = `누적 ${total}건 학습 — ${topType ? TYPE_LABEL[topType] : '학습'} 중심으로 누적되는 중입니다.`;
    }

    return res.json({
      success: true,
      total_memories: total,
      last_learned_at: row.last_learned_at,
      days_since_last_learning: daysAgo,
      avg_importance: row.avg_importance != null ? Number(row.avg_importance) : null,
      top_impact: top
        ? {
            id: top.id,
            memoryType: top.memory_type,
            memoryKey: top.memory_key,
            memoryValue: top.memory_value,
            importance: top.importance,
            usageCount: Number(top.usage_count) || 0,
          }
        : null,
      type_distribution: typeDistribution,
      top_type: topType,
      recent_30d_added: Number(row.recent_30d_added) || 0,
      top_insight: topInsight,
    });
  } catch (err: any) {
    console.error('[AI Memory overview] 오류:', err);
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ai_company_memory ALTER (usage_count 컬럼) 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 2. POST /api/ai-memory/search-natural — 자연어 질문 → AI 답변
// ════════════════════════════════════════════════════════════════════

router.post('/search-natural', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    const q = String(req.body?.query || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ success: false, error: '질문은 2자 이상 입력해주세요.' });
    }
    if (q.length > 500) {
      return res.status(400).json({ success: false, error: '질문은 500자 이내로 입력해주세요.' });
    }

    const memoryContext = await buildMemoryPromptContext(companyId, 30);

    if (!memoryContext) {
      return res.json({
        success: true,
        answer: '아직 학습된 회사 메모리가 없어서 답변할 근거가 없습니다. 캠페인을 1~2건 발송하시면 성공 패턴과 채널 성과가 자동으로 쌓입니다.',
        related_memories: [],
        no_data: true,
      });
    }

    const allMemories = await listMemories(companyId, { limit: 30, minImportance: 3 });

    const systemPrompt = `당신은 한줄로 마케팅 자동화 SaaS의 AI 학습 메모리 분석 도우미입니다.

${memoryContext}

## 답변 원칙 (반드시 준수)
1. 위에 제공된 "회사 메모리" 안에 명시된 사실만 근거로 답변하세요.
2. 메모리에 없는 정보는 추측하거나 만들어내지 마세요. 근거가 부족하면 "아직 학습 데이터가 부족합니다"라고 솔직히 답변하세요.
3. **구체 혜택(%, 원, 무료, 쿠폰, 사은품, 할인, 적립)을 절대 임의로 생성하지 마세요.** 회사가 직접 설정한 정책만 인용 가능하며, 메모리에 없는 혜택은 추측하지 마세요.
4. 답변은 한국어 3~6문장으로 간결하게 작성하세요. 불릿 리스트 사용 가능.
5. 답변 마지막에 어떤 메모리를 참고했는지 한 줄 요약 (예: "참고: 성공 패턴 3건 / 채널 성과 2건").

## 답변 톤
- 마케팅 담당자가 바로 활용할 수 있는 실무적 답변
- "~인 것 같습니다" 같은 가설 표현 금지 — 근거 명확하면 단언, 부족하면 "데이터 부족" 명시
- 전문 용어 풀어쓰기 (예: "RFM 분석" → "최근 구매 + 빈도 + 금액 기반 분석")`;

    const answer = await callAIWithFallback({
      system: systemPrompt,
      userMessage: q,
      maxTokens: 1500,
      temperature: 0.3,
      model: 'opus',
      companyId,
      source: 'ai-memory-search',
    });

    const lowerQ = q.toLowerCase();
    const related = allMemories
      .map((m) => {
        const keyMatch = m.memoryKey.toLowerCase().includes(lowerQ.slice(0, 20)) ? 5 : 0;
        const valueMatch = m.memoryValue.toLowerCase().includes(lowerQ.slice(0, 20)) ? 3 : 0;
        return { memory: m, score: keyMatch + valueMatch + m.importance / 2 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => r.memory);

    return res.json({
      success: true,
      answer,
      related_memories: related,
      no_data: false,
    });
  } catch (err: any) {
    console.error('[AI Memory search-natural] 오류:', err);
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ai_company_memory ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    if (err?.name === 'AiRateLimitExceeded') {
      return res.status(429).json({ success: false, error: err.message, code: 'AI_RATE_LIMIT' });
    }
    return res.status(500).json({ success: false, error: err?.message || '검색 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 3. GET /api/ai-memory/top-impact — 영향도 top N
// ════════════════════════════════════════════════════════════════════

router.get('/top-impact', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    const limit = Math.min(parseInt(String(req.query.limit || '10')) || 10, 50);

    const r = await query(
      `SELECT id, memory_type, memory_key, memory_value, importance, source, metadata,
              COALESCE(usage_count, 0)::int AS usage_count,
              last_accessed_at, created_at, updated_at
       FROM ai_company_memory
       WHERE company_id = $1::uuid
       ORDER BY COALESCE(usage_count, 0) DESC, importance DESC, last_accessed_at DESC
       LIMIT $2`,
      [companyId, limit],
    );

    const memories = r.rows.map((row: any) => ({
      id: row.id,
      memoryType: row.memory_type,
      memoryKey: row.memory_key,
      memoryValue: row.memory_value,
      importance: Number(row.importance) || 5,
      source: row.source || 'ai_auto',
      metadata: row.metadata || {},
      usageCount: Number(row.usage_count) || 0,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return res.json({ success: true, memories, count: memories.length });
  } catch (err: any) {
    console.error('[AI Memory top-impact] 오류:', err);
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요 — 운영자에게 ai_company_memory ALTER (usage_count 컬럼) 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

export default router;
