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
import { query, pool } from '../config/database';
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
  // ★ D225+ Brand Voice Learning
  representative_message: '대표 문안',
  brand_guideline: 'Brand Voice 가이드라인',
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
         AND memory_type NOT IN ('representative_message', 'brand_guideline')
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
      // ★ D227+ Brand Voice 2 타입은 학습 메모리 5종이 아니라 별도 데이터 — 관련 메모리 표시에서 제외 (프론트 TYPE_META 미존재 크래시 차단)
      .filter((m) => m.memoryType !== 'representative_message' && m.memoryType !== 'brand_guideline')
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
         AND memory_type NOT IN ('representative_message', 'brand_guideline')
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

// ════════════════════════════════════════════════════════════════════
// ★ D225+ Brand Voice Learning — 회사별 LMS 대표 문안 5건 + 자동 가이드라인 추출 (2026-05-28 Harold 명시)
//
//   1. GET    /api/ai-memory/brand-voice                  — 5 대표 문안 + 가이드라인 조회
//   2. POST   /api/ai-memory/brand-voice/save-messages    — 5 대표 문안 저장 (옛 5건 삭제 + 신규 5건 INSERT)
//   3. POST   /api/ai-memory/brand-voice/extract-guideline — Sonnet 4.6 자동 추출 + 1 row UPSERT
//   4. DELETE /api/ai-memory/brand-voice/message/:id      — 1건 삭제
//
//   본질: 회사별 마케팅 톤 100% 일치 — 일반 한국어 AI 생성 거부감 차단.
//   SMS 학습 제외 (33글자 한도 = 톤 분석 의미 X) — LMS 위주 학습.
// ════════════════════════════════════════════════════════════════════

interface RepresentativeMessageValue {
  channel: 'LMS' | 'MMS';
  message_text: string;
  message_subject?: string;
  image_url?: string | null;
  manual_priority: number;
  created_by_admin: boolean;
}

interface BrandGuidelineValue {
  tone_signature: string;
  avg_length_chars: number;
  avg_length_bytes: number;
  frequent_expressions: string[];
  ad_prefix_position: 'front' | 'back';
  greeting_pattern: string;
  cta_patterns: string[];
  signature: string;
  reject_position: 'front' | 'back';
  emoji_whitelist: string[];
  extracted_at: string;
  admin_edited: boolean;
}

// ─────────────────────────────────────────────────────────────
// 1. GET /api/ai-memory/brand-voice
// ─────────────────────────────────────────────────────────────
router.get('/brand-voice', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    const messagesRes = await query(
      `SELECT id, memory_key, memory_value, created_at, updated_at
       FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'representative_message'
       ORDER BY memory_key ASC`,
      [companyId],
    );

    const guidelineRes = await query(
      `SELECT memory_value, updated_at
       FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_guideline'
       LIMIT 1`,
      [companyId],
    );

    const messages = messagesRes.rows.map((row: any) => {
      let value: RepresentativeMessageValue | null = null;
      try {
        value = typeof row.memory_value === 'string' ? JSON.parse(row.memory_value) : row.memory_value;
      } catch {
        value = null;
      }
      return {
        id: row.id,
        priority: value?.manual_priority || 0,
        channel: value?.channel || 'LMS',
        subject: value?.message_subject || '',
        text: value?.message_text || '',
        imageUrl: value?.image_url || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }).sort((a: any, b: any) => a.priority - b.priority);

    let guideline: BrandGuidelineValue | null = null;
    let guidelineUpdatedAt: string | null = null;
    if (guidelineRes.rows[0]) {
      try {
        const raw = guidelineRes.rows[0].memory_value;
        guideline = typeof raw === 'string' ? JSON.parse(raw) : raw;
        guidelineUpdatedAt = guidelineRes.rows[0].updated_at;
      } catch {
        guideline = null;
      }
    }

    return res.json({
      success: true,
      messages,
      guideline,
      guideline_updated_at: guidelineUpdatedAt,
      registered: messages.length >= 1,
      guideline_extracted: guideline !== null,
    });
  } catch (err: any) {
    console.error('[Brand Voice GET] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '조회 실패' });
  }
});

// ─────────────────────────────────────────────────────────────
// 2. POST /api/ai-memory/brand-voice/save-messages
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/save-messages', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '대표 문안 등록은 회사 관리자만 가능합니다.' });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (messages.length < 1 || messages.length > 5) {
      return res.status(400).json({ success: false, error: '대표 문안은 1~5건 등록 가능합니다.' });
    }

    const normalized: Array<{ priority: number; value: RepresentativeMessageValue }> = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] || {};
      const channel = m.channel === 'MMS' ? 'MMS' : 'LMS';
      const text = String(m.text || '').trim();
      const subject = String(m.subject || '').trim();
      const imageUrl = m.imageUrl ? String(m.imageUrl).trim() : null;
      const priority = Number(m.priority) || i + 1;

      if (text.length < 10) {
        return res.status(400).json({
          success: false,
          error: `대표 문안 ${i + 1}번 본문은 10자 이상 입력해주세요.`,
        });
      }
      if (text.length > 2000) {
        return res.status(400).json({
          success: false,
          error: `대표 문안 ${i + 1}번 본문은 2000자 이내로 입력해주세요.`,
        });
      }

      normalized.push({
        priority,
        value: {
          channel,
          message_text: text,
          message_subject: subject || undefined,
          image_url: imageUrl,
          manual_priority: priority,
          created_by_admin: true,
        },
      });
    }

    // ★ D225+ transaction 안전 영역 — 단일 client 활용 (pool.connect + finally release 의무)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `DELETE FROM ai_company_memory
         WHERE company_id = $1::uuid AND memory_type = 'representative_message'`,
        [companyId],
      );

      for (const item of normalized) {
        const memoryKey = `msg_${String(item.priority).padStart(2, '0')}`;
        await client.query(
          `INSERT INTO ai_company_memory (
            id, company_id, memory_type, memory_key, memory_value,
            importance, source, metadata, last_accessed_at, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1::uuid, 'representative_message', $2, $3,
            8, 'admin_input', '{}'::jsonb, NOW(), NOW(), NOW()
          )`,
          [companyId, memoryKey, JSON.stringify(item.value)],
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    const { invalidateBrandVoiceCache } = await import('../utils/brand-voice-prompt');
    invalidateBrandVoiceCache(companyId);

    return res.json({ success: true, saved_count: normalized.length });
  } catch (err: any) {
    console.error('[Brand Voice save-messages] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '저장 실패' });
  }
});

// ─────────────────────────────────────────────────────────────
// 3. POST /api/ai-memory/brand-voice/extract-guideline
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/extract-guideline', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '가이드라인 추출은 회사 관리자만 가능합니다.' });
    }

    const messagesRes = await query(
      `SELECT memory_value FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'representative_message'
       ORDER BY memory_key ASC`,
      [companyId],
    );
    if (messagesRes.rows.length < 1) {
      return res.status(400).json({
        success: false,
        error: '대표 문안을 1건 이상 먼저 등록해주세요.',
      });
    }

    const parsedMessages: RepresentativeMessageValue[] = [];
    for (const row of messagesRes.rows) {
      try {
        const value = typeof row.memory_value === 'string' ? JSON.parse(row.memory_value) : row.memory_value;
        if (value && typeof value.message_text === 'string') {
          parsedMessages.push(value);
        }
      } catch {
        // 잘못된 JSON 영역 = skip
      }
    }
    if (parsedMessages.length < 1) {
      return res.status(400).json({
        success: false,
        error: '대표 문안을 다시 등록해주세요. (JSON 영역 손상)',
      });
    }

    const messagesText = parsedMessages.map((m, i) =>
      `### 문안 ${i + 1} (채널: ${m.channel}${m.message_subject ? `, 제목: ${m.message_subject}` : ''})\n${m.message_text}`,
    ).join('\n\n');

    const systemPrompt = `당신은 회사 마케팅 메시지를 분석하여 회사별 brand voice 가이드라인을 JSON으로 자동 추출하는 전문가입니다.

분석 대상 = 동일 회사의 대표 LMS/MMS 문안 ${parsedMessages.length}건. 본 문안 = 회사 brand voice 자체.

## 추출 의무 9 항목 (JSON 응답 형식)

\`\`\`json
{
  "tone_signature": "친근/캐주얼 | 정중/격조 | 활기/감성 | 정보/실용 | 럭셔리/세련 중 1 선택",
  "avg_length_chars": 245,
  "avg_length_bytes": 380,
  "frequent_expressions": ["빈출 표현 1", "빈출 표현 2", "빈출 표현 3"],
  "ad_prefix_position": "front 또는 back",
  "greeting_pattern": "자주 활용 인사말 패턴 1건",
  "cta_patterns": ["CTA 패턴 1", "CTA 패턴 2", "CTA 패턴 3"],
  "signature": "회사 시그니처 (있을 시, 없으면 빈 문자열)",
  "reject_position": "front 또는 back",
  "emoji_whitelist": ["★", "♥", "▶"]
}
\`\`\`

## 분석 원칙

1. tone_signature — 5 분류 중 1 선택. 메시지 톤이 친근/격조 어느 영역인지 정확 판단.
2. avg_length_chars + avg_length_bytes — ${parsedMessages.length}건 본문 평균 길이 (한글 2바이트 기준).
3. frequent_expressions — 2건 이상 출현한 표현 3~5건 추출. 빈도 높은 영역 우선.
4. ad_prefix_position — "(광고)" 위치가 본문 앞이면 front, 뒤면 back.
5. greeting_pattern — "[브랜드명] OOO님께" 등 자주 활용한 인사말 1건. 없으면 빈 문자열.
6. cta_patterns — "지금 바로 ~", "5월이 끝나기 전 ~" 등 행동 유도 표현 3건. 다양성 우선.
7. signature — 회사 슬로건 또는 영문 시그니처. 없으면 빈 문자열.
8. reject_position — "무료수신거부 080..." 위치가 본문 앞이면 front, 뒤면 back.
9. emoji_whitelist — 실제 활용된 이모지/특수문자 배열 (★ ♥ ▶ 등). 활용 없으면 빈 배열.

## 응답 형식

JSON 단 1건만 출력. 다른 설명/주석/마크다운 코드블록 없음. 응답 시작 = "{" / 응답 끝 = "}".`;

    const { callAIWithFallback } = await import('../services/ai');
    let rawResponse: string;
    try {
      rawResponse = await callAIWithFallback({
        system: systemPrompt,
        userMessage: messagesText,
        maxTokens: 1500,
        temperature: 0.2,
        model: 'sonnet',
        companyId,
        source: 'brand-voice-extract',
      });
    } catch (aiErr: any) {
      if (aiErr?.name === 'AiRateLimitExceeded') {
        return res.status(429).json({ success: false, error: aiErr.message, code: 'AI_RATE_LIMIT' });
      }
      throw aiErr;
    }

    let guideline: BrandGuidelineValue | null = null;
    const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        guideline = {
          tone_signature: String(parsed.tone_signature || '정보/실용'),
          avg_length_chars: Number(parsed.avg_length_chars) || 0,
          avg_length_bytes: Number(parsed.avg_length_bytes) || 0,
          frequent_expressions: Array.isArray(parsed.frequent_expressions)
            ? parsed.frequent_expressions.map((s: any) => String(s)).slice(0, 5)
            : [],
          ad_prefix_position: parsed.ad_prefix_position === 'back' ? 'back' : 'front',
          greeting_pattern: String(parsed.greeting_pattern || ''),
          cta_patterns: Array.isArray(parsed.cta_patterns)
            ? parsed.cta_patterns.map((s: any) => String(s)).slice(0, 5)
            : [],
          signature: String(parsed.signature || ''),
          reject_position: parsed.reject_position === 'front' ? 'front' : 'back',
          emoji_whitelist: Array.isArray(parsed.emoji_whitelist)
            ? parsed.emoji_whitelist.map((s: any) => String(s)).slice(0, 20)
            : [],
          extracted_at: new Date().toISOString(),
          admin_edited: false,
        };
      } catch (parseErr) {
        console.error('[Brand Voice extract] JSON parse 실패:', parseErr, rawResponse.slice(0, 500));
      }
    }

    if (!guideline) {
      return res.status(500).json({
        success: false,
        error: 'AI 응답 JSON 형식 오류 — 재시도해주세요.',
      });
    }

    await query(
      `INSERT INTO ai_company_memory (
        id, company_id, memory_type, memory_key, memory_value,
        importance, source, metadata, last_accessed_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'brand_guideline', 'main', $2,
        10, 'ai_auto', '{}'::jsonb, NOW(), NOW(), NOW()
      )
      ON CONFLICT (company_id, memory_type, memory_key) DO UPDATE SET
        memory_value = EXCLUDED.memory_value,
        importance = 10,
        updated_at = NOW(),
        last_accessed_at = NOW()`,
      [companyId, JSON.stringify(guideline)],
    );

    const { invalidateBrandVoiceCache } = await import('../utils/brand-voice-prompt');
    invalidateBrandVoiceCache(companyId);

    return res.json({ success: true, guideline });
  } catch (err: any) {
    console.error('[Brand Voice extract-guideline] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '가이드라인 추출 실패' });
  }
});

// ─────────────────────────────────────────────────────────────
// 4. DELETE /api/ai-memory/brand-voice/message/:id
// ─────────────────────────────────────────────────────────────
router.delete('/brand-voice/message/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '대표 문안 삭제는 회사 관리자만 가능합니다.' });
    }

    const memoryId = String(req.params.id || '').trim();
    if (!memoryId) {
      return res.status(400).json({ success: false, error: 'memory id가 필요합니다.' });
    }

    const result = await query(
      `DELETE FROM ai_company_memory
       WHERE id = $1::uuid AND company_id = $2::uuid AND memory_type = 'representative_message'
       RETURNING id`,
      [memoryId, companyId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '대표 문안을 찾을 수 없습니다.' });
    }

    const { invalidateBrandVoiceCache } = await import('../utils/brand-voice-prompt');
    invalidateBrandVoiceCache(companyId);

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Brand Voice delete-message] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '삭제 실패' });
  }
});

// ─────────────────────────────────────────────────────────────
// 5. POST /api/ai-memory/brand-voice/update-guideline (회사 admin 직접 정정)
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/update-guideline', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    if (userType !== 'company_admin') {
      return res.status(403).json({ success: false, error: '가이드라인 정정은 회사 관리자만 가능합니다.' });
    }

    const input = req.body?.guideline || {};
    const guideline: BrandGuidelineValue = {
      tone_signature: String(input.tone_signature || '정보/실용'),
      avg_length_chars: Number(input.avg_length_chars) || 0,
      avg_length_bytes: Number(input.avg_length_bytes) || 0,
      frequent_expressions: Array.isArray(input.frequent_expressions)
        ? input.frequent_expressions.map((s: any) => String(s)).slice(0, 5)
        : [],
      ad_prefix_position: input.ad_prefix_position === 'back' ? 'back' : 'front',
      greeting_pattern: String(input.greeting_pattern || ''),
      cta_patterns: Array.isArray(input.cta_patterns)
        ? input.cta_patterns.map((s: any) => String(s)).slice(0, 5)
        : [],
      signature: String(input.signature || ''),
      reject_position: input.reject_position === 'front' ? 'front' : 'back',
      emoji_whitelist: Array.isArray(input.emoji_whitelist)
        ? input.emoji_whitelist.map((s: any) => String(s)).slice(0, 20)
        : [],
      extracted_at: new Date().toISOString(),
      admin_edited: true,
    };

    await query(
      `INSERT INTO ai_company_memory (
        id, company_id, memory_type, memory_key, memory_value,
        importance, source, metadata, last_accessed_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'brand_guideline', 'main', $2,
        10, 'admin_input', '{}'::jsonb, NOW(), NOW(), NOW()
      )
      ON CONFLICT (company_id, memory_type, memory_key) DO UPDATE SET
        memory_value = EXCLUDED.memory_value,
        source = 'admin_input',
        updated_at = NOW(),
        last_accessed_at = NOW()`,
      [companyId, JSON.stringify(guideline)],
    );

    const { invalidateBrandVoiceCache } = await import('../utils/brand-voice-prompt');
    invalidateBrandVoiceCache(companyId);

    return res.json({ success: true, guideline });
  } catch (err: any) {
    console.error('[Brand Voice update-guideline] 오류:', err);
    return res.status(500).json({ success: false, error: err?.message || '정정 실패' });
  }
});

export default router;
