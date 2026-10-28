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
import { aiZonePlanBlocked } from '../utils/plan-guard';
import { callAIWithFallback } from '../services/ai';
import { buildMemoryPromptContext, listMemories, MemoryType, LEARNING_MEMORY_TYPES } from '../utils/company-memory';
import { fetchBrandGuideline, recordToneEvolution } from '../utils/brand-tone-evolution';
import { REPRESENTATIVE_KEEP, type BrandVoiceKind } from '../utils/brand-voice-prompt';
import { lockBrandVoiceState, writeBrandVoiceState, readBrandVoiceState, onMessageWrite, extractDoneFor, onExtractSuccess, onExtractError, onReview, canSample, onSample, onAdminEdit, onReset } from '../utils/brand-voice-state';
import { isSkeletonOfText, textHash } from '../utils/brand-voice-skeleton';
import { buildExtractionResult, buildVoiceExtractionPrompt, type RepresentativeMessageValue, type BrandGuidelineValue } from '../utils/brand-voice-extract';
import { COPY_CONTENT_TYPES, COPY_CONTENT_TYPE_LABEL, isCopyContentType, kindOfContentType, type CopyContentType } from '../utils/copy-content-type';
import { listHumanSentCandidates } from '../utils/human-sent-messages';
import { generateBrandVoiceSamples } from '../utils/brand-voice-sample';
import { readHabit, readVoiceEdit, decidePhraseCandidate, removeAcceptedPhrase } from '../utils/voice-habits';
import { isUuid } from '../utils/normalize';
import { extractJsonFromAiText, plainTextFromAi } from '../utils/ai-json';

import { publicErrorText, respondUserError } from '../utils/http-error';
import { runChargedAi, checkCredit, settleCreditInTx, InsufficientCreditError } from '../utils/ai-credit';
import { getCreditCost } from '../utils/ai-credit-calc';
import { randomUUID } from 'crypto';
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

    // ★ 2026-07-12 — 집계 전부 학습 5종 한정. 전 타입 COUNT는 브랜드 자산(가이드라인·대표문안·brand_link)
    //   등록 회사에서 "누적 학습 N건"이 과대되고 도넛 % 합이 100 미만이 되던 혼입 결함.
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
       WHERE company_id = $1::uuid
         AND memory_type = ANY($2::text[])`,
      [companyId, LEARNING_MEMORY_TYPES],
    );
    const row = overviewRes.rows[0] || {};

    // ★ 2026-07-12 — 제외 목록(NOT IN) → 학습 5종 화이트리스트. 옛 코드가 brand_link를 빠뜨려
    //   실제 주입된 적 없는 링크가 "AI가 가장 자주 참고한 학습"으로 노출될 수 있었다.
    const topImpactRes = await query(
      `SELECT id, memory_type, memory_key, memory_value, importance,
              COALESCE(usage_count, 0)::int AS usage_count
       FROM ai_company_memory
       WHERE company_id = $1::uuid
         AND memory_type = ANY($2::text[])
       ORDER BY COALESCE(usage_count, 0) DESC, importance DESC, last_accessed_at DESC
       LIMIT 1`,
      [companyId, LEARNING_MEMORY_TYPES],
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
        ? `AI가 가장 자주 참고한 학습: "${top.memory_key}": ${valueShort} (AI 활용 ${usage}회)`
        : `가장 중요도 높은 학습: "${top.memory_key}": ${valueShort} (중요도 ${top.importance})`;
    } else {
      topInsight = `누적 ${total}건 학습. ${topType ? TYPE_LABEL[topType] : '학습'} 중심으로 누적되는 중입니다.`;
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
        error: 'DB 마이그레이션 필요: 운영자에게 ai_company_memory ALTER (usage_count 컬럼) 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
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
    if (await aiZonePlanBlocked(req, res)) return;   // ★ 2026-10-24 R2 — AI 를 쓰는 주소 = 서버 요금제 문
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

    // ★ 2026-07-12 — 관련 학습 후보도 학습 5종 한정 (주입 컨텍스트와 동일 소스)
    const allMemories = await listMemories(companyId, { limit: 30, minImportance: 3, memoryTypes: LEARNING_MEMORY_TYPES });

    const systemPrompt = `당신은 한줄로 마케팅 자동화 SaaS의 AI 학습 메모리 분석 도우미입니다.

${memoryContext}

## 답변 원칙 (반드시 준수)
1. 위에 제공된 "회사 메모리" 안에 명시된 사실만 근거로 답변하세요.
2. 메모리에 없는 정보는 추측하거나 만들어내지 마세요. 근거가 부족하면 "아직 학습 데이터가 부족합니다"라고 솔직히 답변하세요.
3. **구체 혜택(%, 원, 무료, 쿠폰, 사은품, 할인, 적립)을 절대 임의로 생성하지 마세요.** 회사가 직접 설정한 정책만 인용 가능하며, 메모리에 없는 혜택은 추측하지 마세요.
4. 답변은 한국어 3~6문장으로 간결하게 작성하세요. 화면에 글자 그대로 보이므로 굵은 글씨(**) · 머리글(#) · 표 같은 마크다운 기호는 쓰지 않는다. 목록이 필요하면 줄마다 "· "로 시작한다.
5. 답변 마지막에 어떤 메모리를 참고했는지 한 줄 요약 (예: "참고: 성공 패턴 3건 / 채널 성과 2건").

## 답변 톤
- 마케팅 담당자가 바로 활용할 수 있는 실무적 답변
- "~인 것 같습니다" 같은 가설 표현 금지. 근거 명확하면 단언, 부족하면 "데이터 부족" 명시
- 전문 용어 풀어쓰기 (예: "RFM 분석" → "최근 구매 + 빈도 + 금액 기반 분석")`;

    // ★ 2026-10-25 원장 Z4 — 돈 = AI 결과 정산 한 곳(AI 메모리 검색 · 답이 비면 0원) · 쓸 결과가 아니면 0원 · 잔액 부족 402 · 원장 쓰기 실패 503
    const { result: answer } = await runChargedAi({
      companyId: companyId, cost: getCreditCost('ai-memory-search'), source: 'ai-memory-search', createdBy: req.user?.userId || null,
      run: () => callAIWithFallback({
        system: systemPrompt,
        userMessage: q,
        maxTokens: 1500,
        temperature: 0.3,
        model: 'opus',
        companyId,
        source: 'ai-memory-search',
      }),
      accept: (answer) => !!plainTextFromAi(answer).trim(),
    });

    const lowerQ = q.toLowerCase();
    // ★ 2026-09-27 한줄로 V2 R288 — 관련도 = 질문 단어(2자 이상) 단위 일치. 옛: 질문 앞 20자 전체가 그대로 들어 있어야 가점이라
    //   사실상 중요도 상위 5건이 나왔다.
    const queryTerms = Array.from(new Set(lowerQ.split(/[\s,.?!·~"'()]+/).filter((t) => t.length >= 2))).slice(0, 12);
    const related = allMemories
      // 조회가 이미 학습 5종 화이트리스트(옛 제외 방식은 brand_link를 빠뜨렸음) — 방어적 이중 필터만 유지
      .filter((m) => (LEARNING_MEMORY_TYPES as string[]).includes(m.memoryType))
      .map((m) => {
        const key = m.memoryKey.toLowerCase();
        const value = m.memoryValue.toLowerCase();
        const keyHits = queryTerms.filter((t) => key.includes(t)).length;
        const valueHits = queryTerms.filter((t) => value.includes(t)).length;
        return { memory: m, score: keyHits * 5 + valueHits * 3 + m.importance / 2 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => r.memory);

    return res.json({
      success: true,
      answer: plainTextFromAi(answer),   // ★ 2026-09-30 WP6 — 마크다운 기호 출구 정리(화면 = whitespace-pre-wrap 글자 그대로)
      related_memories: related,
      no_data: false,
    });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) return res.status(402).json({ success: false, error: 'AI 크레딧이 부족합니다. 크레딧을 충전해 주세요.', code: 'INSUFFICIENT_CREDIT' });
    if (respondUserError(res, err)) return;
    console.error('[AI Memory search-natural] 오류:', err);
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        error: 'DB 마이그레이션 필요: 운영자에게 ai_company_memory ALTER 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    if (err?.name === 'AiRateLimitExceeded') {
      return res.status(429).json({ success: false, error: err.message, code: 'AI_RATE_LIMIT' });
    }
    return res.status(500).json({ success: false, error: publicErrorText(err, '검색 실패') });
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

    // ★ 2026-07-12 — 제외 목록 → 학습 5종 화이트리스트 (옛 NOT IN은 brand_link 누락)
    const r = await query(
      `SELECT id, memory_type, memory_key, memory_value, importance, source, metadata,
              COALESCE(usage_count, 0)::int AS usage_count,
              last_accessed_at, created_at, updated_at
       FROM ai_company_memory
       WHERE company_id = $1::uuid
         AND memory_type = ANY($3::text[])
       ORDER BY COALESCE(usage_count, 0) DESC, importance DESC, last_accessed_at DESC
       LIMIT $2`,
      [companyId, limit, LEARNING_MEMORY_TYPES],
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
        error: 'DB 마이그레이션 필요: 운영자에게 ai_company_memory ALTER (usage_count 컬럼) 실행 요청',
        code: 'DB_MIGRATION_PENDING',
      });
    }
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
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




/**
 * 입력에서 브랜드 키트 필드만 정제 (update-guideline용) · 요청에 든 칸만 낸다(화면은 고친 칸만 보낸다 · 빠진 칸 = 그대로 · 빈 값 = 비움).
 *   ★ 2026-10-28 Codex 구현 1R — 빠진 칸을 [] 로 채워 병합하면 맺음말 한 칸 고침이 금지어 · 넣을 말 · 슬로건을 지웠다.
 */
function sanitizeBrandKit(input: any): Partial<Pick<BrandGuidelineValue,
  'signature_locked' | 'signature_mode' | 'slogans' | 'required_words' | 'banned_words'>> {
  const arr = (v: any, max: number): string[] => Array.isArray(v)
    ? v.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, max) : [];
  const has = (k: string) => !!input && typeof input === 'object' && k in input;
  return {
    ...(has('signature_locked') ? { signature_locked: String(input.signature_locked || '').trim().slice(0, 200) } : {}),
    ...(has('signature_mode') ? { signature_mode: input.signature_mode === 'ai_blend' ? 'ai_blend' as const : 'append' as const } : {}),
    ...(has('slogans') ? { slogans: arr(input.slogans, 10) } : {}),
    ...(has('required_words') ? { required_words: arr(input.required_words, 20) } : {}),
    ...(has('banned_words') ? { banned_words: arr(input.banned_words, 50) } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// ★ 2026-10-28 AI 메모리 설계(docs/2026-10-28-ai-memory-brand-voice-design.md) K5 · K7 · K8 · K9 — 브랜드 보이스 주소 묶음
//   권한(Harold 1028 ②) = 추가 · 고침 · 배우기 · 확인 · 견본 · 직접 정정 = 회사 관리자 + 담당자 · 대표 문안 삭제 · 초기화 = 회사 관리자.
//   세대값 = 상태 행(brand_voice_state) · 모든 쓰기 = 같은 상태 행을 잠근 트랜잭션 안(R12).
//   학습 = [저장하고 배우기 · 6](추출 1 + 견본 5) · 사람 클릭 없는 과금 0 · 실패 = 0 · 같은 세대 다시 = 0(I10).
// ─────────────────────────────────────────────────────────────

const BV_EXTRACT = 'brand-voice-extract';
const BV_SAMPLE = 'generate-messages';
const bvPrices = () => {
  const extract = getCreditCost(BV_EXTRACT);
  const sample = getCreditCost(BV_SAMPLE);
  return { extract, sample, learn: extract + sample };
};

function bvCanEdit(req: Request): boolean {
  const t = req.user?.userType;
  return t === 'company_admin' || t === 'company_user';
}
function bvIsAdmin(req: Request): boolean {
  return req.user?.userType === 'company_admin';
}

/** 대표 문안 한 건 입력 정제(채널 SMS 허용 · K7-6) · 오류 = 사람 문장 */
function sanitizeMessageInput(m: any, index: number): { ok: true; value: Omit<RepresentativeMessageValue, 'manual_priority' | 'created_by_admin'> } | { ok: false; error: string } {
  const ch = String(m?.channel || '').toUpperCase();
  const channel: 'SMS' | 'LMS' | 'MMS' = ch === 'SMS' ? 'SMS' : ch === 'MMS' ? 'MMS' : 'LMS';
  const text = String(m?.text || '').trim();
  const subject = String(m?.subject || '').trim().slice(0, 100);
  const label = index >= 0 ? `대표 문안 ${index + 1}번 ` : '';
  if (text.length < 10) return { ok: false, error: `${label}본문은 10자 이상 입력해주세요.` };
  if (text.length > 2000) return { ok: false, error: `${label}본문은 2000자 이내로 입력해주세요.` };
  const contentType = isCopyContentType(m?.contentType) ? m.contentType : null;
  const kind: BrandVoiceKind | null = contentType ? kindOfContentType(contentType) : (m?.kind === 'notice' || m?.kind === 'marketing' ? m.kind : null);
  return {
    ok: true,
    value: {
      channel,
      message_text: text,
      message_subject: channel === 'SMS' ? undefined : subject || undefined,
      image_url: m?.imageUrl ? String(m.imageUrl).trim() : null,
      ...(contentType ? { content_type: contentType, content_type_source: 'admin' as const } : {}),
      ...(kind ? { kind, kind_source: 'admin' as const } : {}),
      source: m?.source === 'sent_history' ? 'sent_history' : 'admin_input',
      ...(m?.source === 'sent_history' && m?.campaignId ? { source_campaign_id: String(m.campaignId).slice(0, 64) } : {}),
    },
  };
}

async function insertRepresentativeMessage(client: any, companyId: string, userId: string | null, value: RepresentativeMessageValue): Promise<string> {
  const r = await client.query(
    `INSERT INTO ai_company_memory (id, company_id, memory_type, memory_key, memory_value, importance, source, metadata, last_accessed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, 'representative_message', $2, $3, 8, 'admin_input', $4::jsonb, NOW(), NOW(), NOW())
     RETURNING id`,
    [companyId, `msg_${randomUUID()}`, JSON.stringify(value), JSON.stringify({ created_by: userId, updated_by: userId, source: value.source || 'admin_input' })],
  );
  return String(r.rows[0].id);
}

/** 같은 글의 대표 문안 id(같은 글 = 한 행 · 다시 누름 · 학습 실패 뒤 재시도가 행을 늘리지 않게 · 상태 행 잠금 안에서 부른다) */
async function findRepresentativeByText(client: any, companyId: string, text: string): Promise<string | null> {
  const r = await client.query(
    `SELECT id FROM ai_company_memory
      WHERE company_id = $1::uuid AND memory_type = 'representative_message' AND memory_value::jsonb->>'message_text' = $2
      LIMIT 1`,
    [companyId, text],
  );
  return r.rows[0] ? String(r.rows[0].id) : null;
}

async function bvInvalidate(companyId: string): Promise<void> {
  const { invalidateBrandVoiceCache } = await import('../utils/brand-voice-prompt');
  invalidateBrandVoiceCache(companyId);
}

// ─────────────────────────────────────────────────────────────
// 1. GET /api/ai-memory/brand-voice — 화면 한 번에(문안 · 가이드라인 · 사람 행 · 상태 · 단가 · 권한)
// ─────────────────────────────────────────────────────────────
router.get('/brand-voice', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    const [messagesRes, guidelineRes] = await Promise.all([
      query(
        `SELECT id, memory_value, metadata, created_at, updated_at
           FROM ai_company_memory
          WHERE company_id = $1::uuid AND memory_type = 'representative_message'
          ORDER BY created_at ASC, memory_key ASC`,
        [companyId],
      ),
      // ★ 2026-10-20 가이드라인 행 = main(마케팅) · notice(안부/알림) — 키를 지정해 읽는다
      query(
        `SELECT memory_key, memory_value, updated_at
           FROM ai_company_memory
          WHERE company_id = $1::uuid AND memory_type = 'brand_guideline' AND memory_key IN ('main', 'notice')`,
        [companyId],
      ),
    ]);
    const { getBrandVoiceSnapshot, resolveGuidelineFor, voiceLearnedOf, pendingPhrasesOf, voiceStatusOfSnapshot } = await import('../utils/brand-voice-prompt');
    const snap = await getBrandVoiceSnapshot(companyId);
    const state = snap.state;

    const messages = messagesRes.rows.map((row: any) => {
      let value: RepresentativeMessageValue | null = null;
      try { value = typeof row.memory_value === 'string' ? JSON.parse(row.memory_value) : row.memory_value; } catch { value = null; }
      const text = value?.message_text || '';
      const hash = textHash(text);
      const pending = value?.skeleton && value.skeleton.hash === hash ? value.skeleton : null;
      const reviewed = state.reviewed?.skeletons?.[String(row.id)];
      const contentType = isCopyContentType(value?.content_type) ? value!.content_type! : null;
      return {
        id: row.id,
        priority: value?.manual_priority || 0,
        channel: value?.channel || 'LMS',
        subject: value?.message_subject || '',
        text,
        imageUrl: value?.image_url || null,
        contentType,
        contentTypeSource: contentType ? (value?.content_type_source === 'admin' ? 'admin' : 'ai') : null,
        kind: contentType ? kindOfContentType(contentType) : value?.kind === 'notice' || value?.kind === 'marketing' ? value.kind : null,
        kindSource: value?.kind_source === 'admin' || value?.content_type_source === 'admin' ? 'admin' : value?.kind ? 'ai' : null,
        source: value?.source === 'sent_history' ? 'sent_history' : 'admin_input',
        pendingSkeleton: pending ? pending.text : null,
        pendingExtractGen: pending ? pending.extractGen : null,
        reviewedSkeleton: reviewed && reviewed.hash === hash ? reviewed.text : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }).sort((a: any, b: any) => a.priority - b.priority);

    let guideline: BrandGuidelineValue | null = null;
    let guidelineUpdatedAt: string | null = null;
    let noticeGuideline: BrandGuidelineValue | null = null;
    for (const row of guidelineRes.rows) {
      let parsed: BrandGuidelineValue | null = null;
      try { parsed = typeof row.memory_value === 'string' ? JSON.parse(row.memory_value) : row.memory_value; } catch { parsed = null; }
      if (row.memory_key === 'notice') noticeGuideline = parsed;
      else { guideline = parsed; guidelineUpdatedAt = parsed ? row.updated_at : null; }
    }
    // 상태 = CT 한 곳(AI 한줄로 확인 판 · 생성 화면 칩과 같은 판정)
    const status = voiceStatusOfSnapshot(snap);
    // ★ K8-3 다시 배우기 제안 = 마지막 학습 30일 경과 + 그 뒤 새로 보낸 문자 1건 이상(클릭할 때 걷는다)
    let relearnSuggestion: { newCount: number } | null = null;
    const lastLearnAt = state.extract?.at ? Date.parse(state.extract.at) : NaN;
    if (Number.isFinite(lastLearnAt) && Date.now() - lastLearnAt > 30 * 86400000 && bvCanEdit(req)) {
      const fresh = (await listHumanSentCandidates(companyId, { userId: req.user?.userId || null, userType: req.user?.userType || null }, { days: 180 }).catch(() => []))
        .filter((c) => c.sentAt && Date.parse(c.sentAt) > lastLearnAt);
      if (fresh.length > 0) relearnSuggestion = { newCount: fresh.length };
    }
    const pendingNotice = noticeGuideline || (guideline?.voice_kind === 'notice' ? guideline : null);
    const pendingMarketing = guideline?.voice_kind === 'notice' ? null : guideline;

    return res.json({
      success: true,
      messages,
      guideline,
      notice_guideline: noticeGuideline,
      guideline_updated_at: guidelineUpdatedAt,
      resolved: { marketing: resolveGuidelineFor(snap, 'marketing'), notice: resolveGuidelineFor(snap, 'notice') },
      admin: snap.admin,
      pending_phrases: { marketing: pendingPhrasesOf(pendingMarketing as any), notice: pendingPhrasesOf(pendingNotice as any) },
      state: {
        gen: state.gen,
        guidelineGen: state.guidelineGen,
        extractGen: state.extract?.gen ?? null,
        reviewedExtractGen: state.reviewed?.extractGen ?? null,
        extractError: state.extractError,
        sample: state.sample && state.sample.gen === state.gen ? state.sample.result : null,
      },
      status,
      relearn_suggestion: relearnSuggestion,
      voice_learned: voiceLearnedOf(snap),
      voice_learned_by_kind: { marketing: voiceLearnedOf(snap, 'marketing'), notice: voiceLearnedOf(snap, 'notice') },
      prices: bvPrices(),
      permissions: { canEdit: bvCanEdit(req), canDelete: bvIsAdmin(req) },
      content_types: COPY_CONTENT_TYPES.map((key) => ({ key, label: COPY_CONTENT_TYPE_LABEL[key], kind: kindOfContentType(key) })),
      keep_limit: REPRESENTATIVE_KEEP,
      registered: messages.length >= 1,
      guideline_extracted: guideline !== null,
    });
  } catch (err: any) {
    console.error('[Brand Voice GET] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

// ─────────────────────────────────────────────────────────────
// 2. POST /api/ai-memory/brand-voice/messages — 대표 문안 한 건 추가(세대 + 1 · K7-2)
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/messages', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '대표 문안은 회사 관리자와 담당자가 올릴 수 있어요.' });
    const input = sanitizeMessageInput(req.body || {}, -1);
    if (!input.ok) return res.status(400).json({ success: false, error: input.error });

    const client = await pool.connect();
    let id = '';
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      const existing = await findRepresentativeByText(client, companyId, input.value.message_text);
      if (existing) {
        await client.query('ROLLBACK');
        return res.json({ success: true, id: existing, duplicate: true });
      }
      const cnt = await client.query(`SELECT COUNT(*)::int AS n, COALESCE(MAX((memory_value::jsonb->>'manual_priority')::int), 0) AS p FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type = 'representative_message'`, [companyId]);
      if ((cnt.rows[0]?.n || 0) >= REPRESENTATIVE_KEEP) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: `대표 문안은 ${REPRESENTATIVE_KEEP}건까지 둘 수 있어요. 오래된 것을 빼고 올려 주세요.` });
      }
      id = await insertRepresentativeMessage(client, companyId, req.user?.userId || null, { ...input.value, manual_priority: (cnt.rows[0]?.p || 0) + 1, created_by_admin: true });
      await writeBrandVoiceState(client, companyId, onMessageWrite(state));
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await bvInvalidate(companyId);
    return res.json({ success: true, id });
  } catch (err: any) {
    console.error('[Brand Voice add-message] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '저장 실패') });
  }
});

// ─────────────────────────────────────────────────────────────
// 3. PUT /api/ai-memory/brand-voice/messages/:id — 한 건 고침(updated_at 대조 · 다르면 409 · 세대 + 1)
// ─────────────────────────────────────────────────────────────
router.put('/brand-voice/messages/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '대표 문안은 회사 관리자와 담당자가 고칠 수 있어요.' });
    const memoryId = String(req.params.id || '').trim();
    if (!isUuid(memoryId)) return res.status(400).json({ success: false, error: '대표 문안을 찾을 수 없어요.' });
    const input = sanitizeMessageInput(req.body || {}, -1);
    if (!input.ok) return res.status(400).json({ success: false, error: input.error });
    const seenUpdatedAt = String(req.body?.updatedAt || '');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      const cur = await client.query(
        `SELECT memory_value, metadata, updated_at FROM ai_company_memory
          WHERE id = $1::uuid AND company_id = $2::uuid AND memory_type = 'representative_message' FOR UPDATE`,
        [memoryId, companyId],
      );
      if (cur.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: '대표 문안을 찾을 수 없어요.' }); }
      const seenMs = Date.parse(seenUpdatedAt);
      if (!Number.isFinite(seenMs) || new Date(cur.rows[0].updated_at).getTime() !== seenMs) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: '다른 사람이 먼저 고쳤어요. 새로 불러온 뒤 다시 고쳐 주세요.', code: 'STALE' });
      }
      let prev: RepresentativeMessageValue | null = null;
      const raw = cur.rows[0].memory_value;
      try { prev = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { prev = null; }
      // 종류 · 성격을 사람이 고르지 않았으면 이전 판정을 둔다(글이 바뀌었으면 다음 학습이 다시 판정한다) · 뼈대는 글 해시가 달라져 자동으로 안 쓰인다
      const value: RepresentativeMessageValue = {
        ...(prev || {}),
        ...input.value,
        manual_priority: prev?.manual_priority || 1,
        created_by_admin: true,
        ...(input.value.content_type ? {} : prev?.content_type ? { content_type: prev.content_type, content_type_source: prev.content_type_source } : {}),
        ...(input.value.kind ? {} : prev?.kind ? { kind: prev.kind, kind_source: prev.kind_source } : {}),
        source: prev?.source || input.value.source,
      } as RepresentativeMessageValue;
      const meta = { ...(cur.rows[0].metadata || {}), updated_by: req.user?.userId || null };
      await client.query(
        `UPDATE ai_company_memory SET memory_value = $3, metadata = $4::jsonb, updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid AND memory_type = 'representative_message'`,
        [memoryId, companyId, JSON.stringify(value), JSON.stringify(meta)],
      );
      await writeBrandVoiceState(client, companyId, onMessageWrite(state));
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await bvInvalidate(companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Brand Voice update-message] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '저장 실패') });
  }
});

// ─────────────────────────────────────────────────────────────
// 4. GET /api/ai-memory/brand-voice/sent-candidates — 「사람이 보낸 발송」 후보(K8 · 보낸 문자 고르기 창)
// ─────────────────────────────────────────────────────────────
router.get('/brand-voice/sent-candidates', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '회사 관리자와 담당자만 볼 수 있어요.' });
    const candidates = await listHumanSentCandidates(companyId, { userId: req.user?.userId || null, userType: req.user?.userType || null }, { days: 180 });
    return res.json({ success: true, candidates, prices: bvPrices() });
  } catch (err: any) {
    console.error('[Brand Voice sent-candidates] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

// ─────────────────────────────────────────────────────────────
// 5. POST /api/ai-memory/brand-voice/extract-guideline — [저장하고 배우기 · 6] 의 추출 1(K7-4 · 옛 주소 이름 그대로 = 뿌리 대장 R13 분류 유지)
//    한 요청 = (새 문안 저장 + 세대 g) COMMIT → 추출 AI(잠금 밖) → 상태 행 잠금 · gen = g 일 때만 저장 + 1 걷기.
//    같은 세대에 이미 추출했으면 다시 걷지 않고 저장된 결과(0) · 견본 5 는 확인 뒤(K9).
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/extract-guideline', async (req: Request, res: Response) => {
  const companyId = req.user?.companyId;
  let g = -1;   // ① 에서 확정(바깥 catch 의 실패 표식도 이 세대에)
  try {
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (await aiZonePlanBlocked(req, res)) return;   // ★ 2026-10-24 R2 — AI 를 쓰는 주소 = 서버 요금제 문
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '목소리 학습은 회사 관리자와 담당자가 할 수 있어요.' });
    const userId = req.user?.userId || null;
    const incoming = Array.isArray(req.body?.messages) ? req.body.messages.slice(0, REPRESENTATIVE_KEEP) : [];
    const sanitized: Array<Omit<RepresentativeMessageValue, 'manual_priority' | 'created_by_admin'>> = [];
    for (let i = 0; i < incoming.length; i++) {
      const r = sanitizeMessageInput(incoming[i], i);
      if (!r.ok) return res.status(400).json({ success: false, error: r.error });
      sanitized.push(r.value);
    }
    const relearn = req.body?.relearn === true;

    // ① 새 문안 저장 · 세대 확정 · 이미 있는 글은 다시 넣지 않는다(학습 실패 뒤 같은 고르기로 다시 눌러도 행 · 세대가 늘지 않는다 · Codex 구현 1R)
    let alreadyExtracted = false;
    {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let state = await lockBrandVoiceState(client, companyId);
        const fresh: typeof sanitized = [];
        for (const v of sanitized) {
          if (fresh.some((f) => f.message_text === v.message_text)) continue;
          if (await findRepresentativeByText(client, companyId, v.message_text)) continue;
          fresh.push(v);
        }
        if (fresh.length > 0) {
          const cnt = await client.query(`SELECT COUNT(*)::int AS n, COALESCE(MAX((memory_value::jsonb->>'manual_priority')::int), 0) AS p FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type = 'representative_message'`, [companyId]);
          if ((cnt.rows[0]?.n || 0) + fresh.length > REPRESENTATIVE_KEEP) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: `대표 문안은 ${REPRESENTATIVE_KEEP}건까지 둘 수 있어요. 오래된 것을 빼고 다시 골라 주세요.` });
          }
          let p = cnt.rows[0]?.p || 0;
          for (const v of fresh) await insertRepresentativeMessage(client, companyId, userId, { ...v, manual_priority: ++p, created_by_admin: true });
          state = onMessageWrite(state);
        }
        if (relearn && fresh.length === 0) state = onMessageWrite(state);
        g = state.gen;
        alreadyExtracted = extractDoneFor(state, g);
        await writeBrandVoiceState(client, companyId, state);
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
      await bvInvalidate(companyId);
    }
    if (alreadyExtracted) return res.json({ success: true, gen: g, extractGen: g, charged: 0, reused: true });

    const messagesRes = await query(
      `SELECT id, memory_value FROM ai_company_memory
        WHERE company_id = $1::uuid AND memory_type = 'representative_message'
        ORDER BY created_at ASC, memory_key ASC`,
      [companyId],
    );
    const parsedRows: Array<{ id: string; value: RepresentativeMessageValue }> = [];
    for (const row of messagesRes.rows) {
      try {
        const value = typeof row.memory_value === 'string' ? JSON.parse(row.memory_value) : row.memory_value;
        if (value && typeof value.message_text === 'string') parsedRows.push({ id: String(row.id), value });
      } catch { /* 손상 행 = 건너뜀 */ }
    }
    if (parsedRows.length < 1) return res.status(400).json({ success: false, error: '대표 문안을 1건 이상 먼저 올려 주세요.' });

    const prices = bvPrices();
    try {
      await checkCredit(companyId, prices.extract);
    } catch (e) {
      if (e instanceof InsufficientCreditError) {
        await bvMarkExtractError(companyId, g, 'credit');
        return res.status(402).json({ success: false, error: '크레딧이 부족해 아직 못 배웠어요. 문안은 저장됐어요. 충전한 뒤 [다시 배우기]를 눌러 주세요.', code: 'INSUFFICIENT_CREDIT', saved: true });
      }
      throw e;
    }

    // ② 추출(잠금 밖 · 단가 0 · 저장까지 끝나야 걷는다)
    const adminTypes: Array<CopyContentType | null> = parsedRows.map((r) => (r.value.content_type_source === 'admin' && isCopyContentType(r.value.content_type) ? r.value.content_type : null));
    const adminKinds: Array<BrandVoiceKind | null> = parsedRows.map((r, i) => adminTypes[i] ? kindOfContentType(adminTypes[i]!) : (r.value.kind_source === 'admin' && (r.value.kind === 'marketing' || r.value.kind === 'notice') ? r.value.kind : null));
    const messagesText = parsedRows.map((r, i) =>
      `### 문안 ${i + 1} (채널: ${r.value.channel}${r.value.message_subject ? `, 제목: ${r.value.message_subject}` : ''}${adminTypes[i] ? `, 종류: ${adminTypes[i]}(사람이 정함)` : adminKinds[i] ? `, 성격: ${adminKinds[i]}(사람이 정함)` : ''})\n${r.value.message_text}`,
    ).join('\n\n');
    let rawResponse = '';
    try {
      rawResponse = await callAIWithFallback({
        system: buildVoiceExtractionPrompt(parsedRows.length),
        userMessage: messagesText,
        maxTokens: 4000,
        temperature: 0.2,
        model: 'sonnet',
        companyId,
        source: BV_EXTRACT,
        creditCost: 0,
        noCache: true,
      });
    } catch (aiErr: any) {
      await bvMarkExtractError(companyId, g, 'ai');
      if (aiErr?.name === 'AiRateLimitExceeded') return res.status(429).json({ success: false, error: aiErr.message, code: 'AI_RATE_LIMIT' });
      return res.status(503).json({ success: false, error: 'AI 응답이 늦어 아직 못 배웠어요. 크레딧은 빠지지 않았어요. 잠시 뒤 [다시 배우기]를 눌러 주세요.', code: 'AI_DELAYED' });
    }

    // ③ 응답 → 문안별 종류 · 뼈대 · 성격별 가이드라인(문구 칸 = 칸 친 뒤 · 모양 · 길이 · 링크 = 코드가 잰다)
    let built: ReturnType<typeof buildExtractionResult>;
    try {
      built = buildExtractionResult(extractJsonFromAiText(rawResponse), parsedRows, adminTypes, adminKinds, g);
    } catch (parseErr) {
      console.error('[Brand Voice learn] JSON parse 실패:', parseErr, rawResponse.slice(0, 500));
      built = { ok: false } as any;
    }
    if (!built.ok) {
      await bvMarkExtractError(companyId, g, 'parse');
      return res.status(502).json({ success: false, error: 'AI 가 말투를 읽어 내지 못했어요. 크레딧은 빠지지 않았어요. 다시 눌러 주세요.', code: 'AI_PARSE_FAILED' });
    }

    const prevGuideline = await fetchBrandGuideline(companyId);
    if (prevGuideline) {
      // 브랜드 키트(사람이 적은 칸)는 추출이 덮지 않는다 — 성격별 두 행 모두
      const prevKit = prevGuideline as unknown as Partial<BrandGuidelineValue>;
      for (const gl of [built.main, built.notice]) {
        if (!gl) continue;
        gl.signature_locked = prevKit.signature_locked;
        gl.signature_mode = prevKit.signature_mode;
        gl.slogans = prevKit.slogans;
        gl.required_words = prevKit.required_words;
        gl.banned_words = prevKit.banned_words;
      }
    }

    // ④ 저장 트랜잭션 = 상태 행 잠금 · gen = g 일 때만 · 걷기도 같은 트랜잭션(못 걷으면 함께 롤백)
    const unclassifiedCount = built.unclassified;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      const next = onExtractSuccess(state, g);
      if (!next.ok) {
        await client.query('ROLLBACK');
        // 같은 세대를 다른 요청이 먼저 배웠다 = 그 결과를 그대로 둔다(덮으면 화면이 본 적 없는 결과가 확인된다 · Codex 구현 1R)
        if (next.code === 'done') return res.json({ success: true, gen: g, extractGen: g, charged: 0, reused: true });
        return res.status(409).json({ success: false, error: '그 사이 새 문안이 들어왔어요. 다시 배우기를 눌러 주세요. 크레딧은 빠지지 않았어요.', code: 'STALE_GENERATION' });
      }
      await upsertGuidelineRow(client, companyId, 'main', built.main);
      if (built.notice) {
        await upsertGuidelineRow(client, companyId, 'notice', built.notice);
      // ★ R2 보호 — 종류 미정 문안이 남아 있으면 기존 안부 학습을 지우지 않는다(판정이 빠진 응답이 학습을 지우지 않게)
      } else if (unclassifiedCount === 0) {
        await client.query(`DELETE FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type = 'brand_guideline' AND memory_key = 'notice'`, [companyId]);
      }
      for (const m of built.messages) {
        await client.query(
          `UPDATE ai_company_memory SET memory_value = $3, updated_at = updated_at
            WHERE id = $1::uuid AND company_id = $2::uuid AND memory_type = 'representative_message'`,
          [m.id, companyId, JSON.stringify(m.value)],
        );
      }
      await settleCreditInTx(client, { companyId, cost: prices.extract, source: BV_EXTRACT, createdBy: userId, idempotencyKey: `brand-voice-extract:${companyId}:${g}` });
      await writeBrandVoiceState(client, companyId, next.state);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await recordToneEvolution(companyId, prevGuideline, built.main).catch((e: any) => console.log('[brand-tone-evolution] learn 기록 오류 —', e?.message || e));
    await bvInvalidate(companyId);
    return res.json({ success: true, gen: g, extractGen: g, charged: prices.extract, unclassified: built.unclassified });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      if (companyId && g >= 0) await bvMarkExtractError(companyId, g, 'credit').catch(() => {});
      return res.status(402).json({ success: false, error: '크레딧이 부족해 아직 못 배웠어요. 문안은 저장됐어요. 충전한 뒤 [다시 배우기]를 눌러 주세요.', code: 'INSUFFICIENT_CREDIT', saved: true });
    }
    if (respondUserError(res, err)) return;
    console.error('[Brand Voice learn] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '학습 실패') });
  }
});

// ─────────────────────────────────────────────────────────────
// 6. POST /api/ai-memory/brand-voice/review — [확인] = 화면이 본 추출 세대만(K5-4 · 409)
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/review', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '회사 관리자와 담당자만 확인할 수 있어요.' });
    const seen = Number(req.body?.seenExtractGen);
    if (!Number.isInteger(seen) || seen < 0) return res.status(400).json({ success: false, error: '확인할 학습 결과를 다시 불러와 주세요.' });
    const edits: Record<string, string> = req.body?.skeletons && typeof req.body.skeletons === 'object' ? req.body.skeletons : {};

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      const rows = await client.query(
        `SELECT id, memory_value FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type = 'representative_message'`,
        [companyId],
      );
      const skeletons: Record<string, { hash: string; text: string }> = {};
      for (const row of rows.rows) {
        let v: RepresentativeMessageValue | null = null;
        try { v = typeof row.memory_value === 'string' ? JSON.parse(row.memory_value) : row.memory_value; } catch { v = null; }
        if (!v?.message_text) continue;
        const hash = textHash(v.message_text);
        const pending = v.skeleton && v.skeleton.hash === hash && v.skeleton.extractGen === seen ? v.skeleton.text : null;
        const edited = typeof edits[String(row.id)] === 'string' ? String(edits[String(row.id)]) : null;
        // 사람이 고친 뼈대 = 원문 글자 + 칸만(새 글 금지 · I16)
        if (edited != null) {
          if (!isSkeletonOfText(edited, v.message_text)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: '뼈대에는 원문 글자와 칸만 둘 수 있어요. 새 글은 대표 문안을 고쳐서 넣어 주세요.', code: 'SKELETON_NOT_SUBSET', id: row.id });
          }
          skeletons[String(row.id)] = { hash, text: edited };
        } else if (pending) {
          skeletons[String(row.id)] = { hash, text: pending };
        }
      }
      const gl = await client.query(
        `SELECT memory_key, memory_value FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type = 'brand_guideline' AND memory_key IN ('main', 'notice')`,
        [companyId],
      );
      const { pendingPhrasesOf } = await import('../utils/brand-voice-prompt');
      const byKey: Record<string, any> = {};
      for (const row of gl.rows) { try { byKey[row.memory_key] = typeof row.memory_value === 'string' ? JSON.parse(row.memory_value) : row.memory_value; } catch { /* skip */ } }
      const mainIsNotice = byKey.main?.voice_kind === 'notice';
      const phrases = {
        ...(byKey.main && !mainIsNotice ? { marketing: pendingPhrasesOf(byKey.main) } : {}),
        ...(byKey.notice || mainIsNotice ? { notice: pendingPhrasesOf(byKey.notice || byKey.main) } : {}),
      };
      const next = onReview(state, seen, { by: req.user?.userId || null, skeletons, phrases });
      if (!next.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: '그 사이 학습 결과가 바뀌었어요. 새로 불러온 뒤 다시 확인해 주세요.', code: 'STALE_EXTRACT', extractGen: state.extract?.gen ?? null });
      }
      // 사람이 고친 뼈대는 문안 행에도 남긴다(다음 화면 · 출처 = admin)
      for (const [id, sk] of Object.entries(skeletons)) {
        if (typeof edits[id] !== 'string') continue;
        await client.query(
          `UPDATE ai_company_memory SET memory_value = jsonb_set(memory_value::jsonb, '{skeleton}', $3::jsonb)::text, updated_at = updated_at
            WHERE id = $1::uuid AND company_id = $2::uuid AND memory_type = 'representative_message'`,
          [id, companyId, JSON.stringify({ text: sk.text, hash: sk.hash, extractGen: seen, source: 'admin' })],
        );
      }
      await writeBrandVoiceState(client, companyId, next.state);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await bvInvalidate(companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Brand Voice review] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '확인 실패') });
  }
});

// ─────────────────────────────────────────────────────────────
// 7. POST /api/ai-memory/brand-voice/sample — 견본 두 장(K9 · 확인 뒤 · 성공 뒤 5 · 같은 세대 = 저장된 결과 0)
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/sample', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (await aiZonePlanBlocked(req, res)) return;
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '회사 관리자와 담당자만 견본을 만들 수 있어요.' });
    const g = Number(req.body?.gen);
    const before = await readBrandVoiceState(companyId);
    if (!Number.isInteger(g) || !canSample(before, g)) {
      return res.status(409).json({ success: false, error: '배운 내용을 확인한 뒤에 견본을 만들 수 있어요. 새로 불러와 주세요.', code: 'SAMPLE_NOT_READY' });
    }
    if (before.sample && before.sample.gen === g && before.sample.result) {
      return res.json({ success: true, gen: g, samples: before.sample.result, charged: 0, reused: true });
    }
    const cost = bvPrices().sample;
    await checkCredit(companyId, cost);
    const samples = await generateBrandVoiceSamples(companyId);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      const next = onSample(state, g, samples);
      if (!next.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, error: '그 사이 학습 내용이 바뀌어 견본을 버렸어요. 크레딧은 빠지지 않았어요.', code: 'STALE_GENERATION' });
      }
      await settleCreditInTx(client, { companyId, cost, source: 'brand-voice-sample', createdBy: req.user?.userId || null, idempotencyKey: `brand-voice-sample:${companyId}:${g}` });
      await writeBrandVoiceState(client, companyId, next.state);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await bvInvalidate(companyId);
    return res.json({ success: true, gen: g, samples, charged: cost });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) return res.status(402).json({ success: false, error: '크레딧이 부족해 견본을 못 만들었어요. 충전한 뒤 다시 눌러 주세요.', code: 'INSUFFICIENT_CREDIT' });
    if (respondUserError(res, err)) return;
    console.error('[Brand Voice sample] 오류:', err);
    return res.status(503).json({ success: false, error: '견본을 만들지 못했어요. 크레딧은 빠지지 않았어요. 잠시 뒤 다시 눌러 주세요.', code: 'SAMPLE_FAILED' });
  }
});

// ─────────────────────────────────────────────────────────────
// 8. DELETE /api/ai-memory/brand-voice/message/:id — 대표 문안 삭제(관리자 · 세대 + 1)
// ─────────────────────────────────────────────────────────────
router.delete('/brand-voice/message/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    if (!bvIsAdmin(req)) {
      return res.status(403).json({ success: false, error: '대표 문안 삭제는 회사 관리자만 가능합니다.' });
    }
    const memoryId = String(req.params.id || '').trim();
    if (!isUuid(memoryId)) {
      return res.status(400).json({ success: false, error: 'memory id가 필요합니다.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      const result = await client.query(
        `DELETE FROM ai_company_memory
          WHERE id = $1::uuid AND company_id = $2::uuid AND memory_type = 'representative_message'
          RETURNING id`,
        [memoryId, companyId],
      );
      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: '대표 문안을 찾을 수 없습니다.' });
      }
      await writeBrandVoiceState(client, companyId, onMessageWrite(state));
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await bvInvalidate(companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Brand Voice delete-message] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '삭제 실패') });
  }
});

// ─────────────────────────────────────────────────────────────
// 9. DELETE /api/ai-memory/brand-voice/guideline — 초기화(관리자 · K5-4)
//    AI 가이드라인 · 사람 행 · 문안 행의 뼈대 · 대기 추출본 · 확인된 묶음 전부 비움 · 대표 문안은 남는다 · 세대 + 1(학습 미완)
// ─────────────────────────────────────────────────────────────
router.delete('/brand-voice/guideline', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    if (!bvIsAdmin(req)) {
      return res.status(403).json({ success: false, error: '가이드라인 초기화는 회사 관리자만 가능합니다.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      await client.query(
        `DELETE FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type IN ('brand_guideline', 'brand_voice_admin')`,
        [companyId],
      );
      await client.query(
        `UPDATE ai_company_memory SET memory_value = (memory_value::jsonb - 'skeleton')::text, updated_at = updated_at
          WHERE company_id = $1::uuid AND memory_type = 'representative_message' AND memory_value::jsonb ? 'skeleton'`,
        [companyId],
      );
      await writeBrandVoiceState(client, companyId, onReset(state));
      // 효과 검증 — 잔존 0 재확인 후에만 성공(6원칙 ②)
      const check = await client.query(
        `SELECT
           (SELECT COUNT(*) FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type IN ('brand_guideline', 'brand_voice_admin'))::int AS rows,
           (SELECT COUNT(*) FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type = 'representative_message' AND memory_value::jsonb ? 'skeleton')::int AS skel`,
        [companyId],
      );
      if ((check.rows[0]?.rows || 0) > 0 || (check.rows[0]?.skel || 0) > 0) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, error: '초기화가 완료되지 않았습니다. 다시 시도해 주세요.' });
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await bvInvalidate(companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Brand Voice reset-guideline] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '초기화 실패') });
  }
});

/** 직접 정정할 수 있는 목소리 칸(코드가 잰 칸 = 모양 · 길이 범위 · 링크 습관은 받지 않는다 · K5-2) */
const ADMIN_VOICE_FIELDS = [
  'tone_signature', 'frequent_expressions', 'greeting_pattern', 'cta_patterns', 'signature', 'emoji_whitelist',
  'hook_types', 'body_structure', 'sentence_ending_style', 'sentence_ending_examples', 'customer_address',
] as const;

function sanitizeAdminField(field: string, v: any): unknown {
  const arr = (x: any, max: number) => Array.isArray(x) ? x.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, max) : [];
  switch (field) {
    case 'frequent_expressions': case 'cta_patterns': return arr(v, 5);
    case 'emoji_whitelist': return arr(v, 20);
    case 'hook_types': return arr(v, 2);
    case 'body_structure': return arr(v, 7);
    case 'sentence_ending_examples': return arr(v, 3);
    case 'sentence_ending_style': return v === '해요체' || v === '합쇼체' || v === '혼합' ? v : undefined;
    default: return String(v ?? '').trim().slice(0, 200);
  }
}

// ─────────────────────────────────────────────────────────────
// 10. POST /api/ai-memory/brand-voice/update-guideline — 직접 정정(성격별 사람 행 · 고친 칸만 · 세대 + 1 · K5-4 · K7-1)
//     브랜드 키트 칸(서명 고정 · 슬로건 · 넣을 말 · 금지어)은 지금처럼 main 가이드라인 행(추출이 덮지 않는 사람 칸)
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/update-guideline', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    if (!bvCanEdit(req)) {
      return res.status(403).json({ success: false, error: '가이드라인은 회사 관리자와 담당자가 고칠 수 있어요.' });
    }
    const kind: BrandVoiceKind = req.body?.kind === 'notice' ? 'notice' : 'marketing';
    const input = req.body?.guideline || {};
    const { getBrandVoiceSnapshot, resolveGuidelineFor } = await import('../utils/brand-voice-prompt');
    const snap = await getBrandVoiceSnapshot(companyId);
    const current = resolveGuidelineFor(snap, kind) as any;
    const changed: Record<string, unknown> = {};
    for (const f of ADMIN_VOICE_FIELDS) {
      if (!(f in input)) continue;
      const v = sanitizeAdminField(f, input[f]);
      if (v === undefined) continue;
      if (JSON.stringify(v) !== JSON.stringify(current?.[f] ?? (Array.isArray(v) ? [] : ''))) changed[f] = v;
    }
    const kitIn = ['signature_locked', 'signature_mode', 'slogans', 'required_words', 'banned_words'].some((k) => k in input);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      if (Object.keys(changed).length > 0) {
        const cur = await client.query(
          `SELECT memory_value FROM ai_company_memory WHERE company_id = $1::uuid AND memory_type = 'brand_voice_admin' AND memory_key = $2 FOR UPDATE`,
          [companyId, kind],
        );
        let row: Record<string, unknown> = {};
        const raw = cur.rows[0]?.memory_value;
        try { row = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) || {} : {}; } catch { row = {}; }
        const at = new Date().toISOString();
        for (const [f, v] of Object.entries(changed)) row[f] = { value: v, at, by: req.user?.userId || null };
        await client.query(
          `INSERT INTO ai_company_memory (id, company_id, memory_type, memory_key, memory_value, importance, source, metadata, last_accessed_at, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, 'brand_voice_admin', $2, $3, 10, 'admin_input', '{}'::jsonb, NOW(), NOW(), NOW())
           ON CONFLICT (company_id, memory_type, memory_key) DO UPDATE SET memory_value = EXCLUDED.memory_value, updated_at = NOW()`,
          [companyId, kind, JSON.stringify(row)],
        );
      }
      if (kitIn) {
        const kit = sanitizeBrandKit(input);
        const k = await client.query(
          `UPDATE ai_company_memory SET memory_value = (memory_value::jsonb || $2::jsonb)::text, updated_at = NOW()
            WHERE company_id = $1::uuid AND memory_type = 'brand_guideline' AND memory_key = 'main'`,
          [companyId, JSON.stringify(kit)],
        );
        // 키트는 배운 가이드라인 행에 함께 둔다 · 행이 없으면 조용히 0행이 되지 않게 알린다(효과 확인 뒤 성공 · 6원칙 ②)
        if ((k.rowCount || 0) === 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, error: '먼저 목소리를 배운 뒤에 브랜드 키트를 저장할 수 있어요.', code: 'GUIDELINE_MISSING' });
        }
      }
      if (Object.keys(changed).length > 0) await writeBrandVoiceState(client, companyId, onAdminEdit(state));
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await bvInvalidate(companyId);
    return res.json({ success: true, changed: Object.keys(changed) });
  } catch (err: any) {
    console.error('[Brand Voice update-guideline] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '정정 실패') });
  }
});

// ─────────────────────────────────────────────────────────────
// 11. POST /api/ai-memory/brand-voice/admin-field/reset — 칸을 AI 에게 다시 맡기기(사람 행에서 지움 · 세대 + 1)
// ─────────────────────────────────────────────────────────────
router.post('/brand-voice/admin-field/reset', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '회사 관리자와 담당자만 바꿀 수 있어요.' });
    const kind: BrandVoiceKind = req.body?.kind === 'notice' ? 'notice' : 'marketing';
    const field = String(req.body?.field || '');
    if (!(ADMIN_VOICE_FIELDS as readonly string[]).includes(field)) return res.status(400).json({ success: false, error: '바꿀 수 없는 칸이에요.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const state = await lockBrandVoiceState(client, companyId);
      const r = await client.query(
        `UPDATE ai_company_memory SET memory_value = (memory_value::jsonb - $3::text)::text, updated_at = NOW()
          WHERE company_id = $1::uuid AND memory_type = 'brand_voice_admin' AND memory_key = $2 AND memory_value::jsonb ? $3::text
          RETURNING id`,
        [companyId, kind, field],
      );
      if (r.rows.length > 0) await writeBrandVoiceState(client, companyId, onAdminEdit(state));
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
    await bvInvalidate(companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Brand Voice admin-field reset] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '변경 실패') });
  }
});

/** 추출 실패 기록(그 세대일 때만 · 다음 성공 · 세대 변경 때 지워진다) */
async function bvMarkExtractError(companyId: string, g: number, code: 'credit' | 'ai' | 'parse'): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await lockBrandVoiceState(client, companyId);
    await writeBrandVoiceState(client, companyId, onExtractError(state, g < 0 ? state.gen : g, code));
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }
  await bvInvalidate(companyId);
}

async function upsertGuidelineRow(client: any, companyId: string, key: 'main' | 'notice', value: BrandGuidelineValue): Promise<void> {
  await client.query(
    `INSERT INTO ai_company_memory (id, company_id, memory_type, memory_key, memory_value, importance, source, metadata, last_accessed_at, created_at, updated_at)
     VALUES (gen_random_uuid(), $1::uuid, 'brand_guideline', $2, $3, 10, 'ai_auto', '{}'::jsonb, NOW(), NOW(), NOW())
     ON CONFLICT (company_id, memory_type, memory_key) DO UPDATE SET
       memory_value = EXCLUDED.memory_value, importance = 10, updated_at = NOW(), last_accessed_at = NOW()`,
    [companyId, key, JSON.stringify(value)],
  );
}



// ─────────────────────────────────────────────────────────────
// ★ 2026-10-28 AI 메모리 설계 K14 — 쓸수록(습관 조언 · 고친 차이 후보 칩)
//   조언 = 숫자로 만든 코드 문장(페이지를 열 때 AI 0) · 후보 = 서로 다른 발송 3건 이상 반복 · 사람이 받아들인 것만 「쓸 것 · 피할 것」.
// ─────────────────────────────────────────────────────────────
router.get('/voice-habits', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const [habit, edit] = await Promise.all([readHabit(companyId), readVoiceEdit(companyId)]);
    return res.json({
      success: true,
      habit: habit.profile,
      advice: habit.advice,
      computedAt: habit.computedAt,
      candidates: edit.candidates,
      accepted: { use: edit.accepted_use, avoid: edit.accepted_avoid },
      editSamples: edit.form?.samples ?? 0,
      canEdit: bvCanEdit(req),
    });
  } catch (err: any) {
    console.error('[Voice habits GET] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

router.post('/voice-habits/candidates/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '회사 관리자와 담당자만 정할 수 있어요.' });
    const action = req.body?.action === 'accept' ? 'accept' : req.body?.action === 'dismiss' ? 'dismiss' : null;
    const id = String(req.params.id || '');
    if (!action || !/^[0-9a-f]{16}$/.test(id)) return res.status(400).json({ success: false, error: '요청이 올바르지 않아요.' });
    const r = await decidePhraseCandidate(companyId, id, action, req.user?.userId || null);
    if (r === 'not_found') return res.status(404).json({ success: false, error: '이미 정한 후보예요. 새로 불러와 주세요.' });
    await bvInvalidate(companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Voice habits candidate] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '저장 실패') });
  }
});

router.post('/voice-habits/accepted/remove', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (!bvCanEdit(req)) return res.status(403).json({ success: false, error: '회사 관리자와 담당자만 바꿀 수 있어요.' });
    const mode = req.body?.mode === 'avoid' ? 'avoid' : req.body?.mode === 'use' ? 'use' : null;
    const text = String(req.body?.text || '').slice(0, 60);
    if (!mode || !text) return res.status(400).json({ success: false, error: '요청이 올바르지 않아요.' });
    await removeAcceptedPhrase(companyId, mode, text);
    await bvInvalidate(companyId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Voice habits remove] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '저장 실패') });
  }
});

// ════════════════════════════════════════════════════════════════════
// ★ 2026-07-02 브랜드 링크 — 회사 URL 라이브러리 (라벨 + URL)
//
//   실제 URL은 고객사 소유 — AI는 {{LINK:라벨}} 토큰만 출력하고 시스템이 치환.
//   저장 = ai_company_memory memory_type='brand_link' (memory_key = 라벨, ALTER 0).
//   문안 생성 화면 칩 삽입용이라 회사 소속 사용자 전체 사용 가능 (admin 한정 X).
//
//   1. GET    /api/ai-memory/brand-links       — 목록
//   2. POST   /api/ai-memory/brand-links       — 등록/갱신 (라벨 동일 시 URL 갱신)
//   3. DELETE /api/ai-memory/brand-links/:id   — 삭제
// ════════════════════════════════════════════════════════════════════

const BRAND_LINK_MAX = 20;

/** URL에서 라벨 자동 부여 — 도메인(+경로). 이름 입력 없이 URL만 등록 (2026-07-02 Harold 지시). */
function deriveBrandLinkLabel(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
    const base = `${host}${path}`.replace(/[{}\r\n]/g, '').trim();
    return (base || '링크').slice(0, 40);
  } catch {
    const base = url.replace(/^https?:\/\//i, '').replace(/[{}\r\n]/g, '').trim();
    return (base || '링크').slice(0, 40);
  }
}

router.get('/brand-links', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    const r = await query(
      `SELECT id, memory_key, memory_value, created_at
       FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_link'
       ORDER BY created_at ASC
       LIMIT ${BRAND_LINK_MAX}`,
      [companyId],
    );
    const links = r.rows.map((row: any) => {
      let value: any = null;
      try {
        value = typeof row.memory_value === 'string' ? JSON.parse(row.memory_value) : row.memory_value;
      } catch {
        value = null;
      }
      return {
        id: row.id,
        label: String(value?.label || row.memory_key || ''),
        url: String(value?.url || ''),
        createdAt: row.created_at,
      };
    }).filter((l: any) => l.url);
    return res.json({ success: true, links });
  } catch (err: any) {
    console.error('[Brand Links GET] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '조회 실패') });
  }
});

router.post('/brand-links', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }

    const url = String(req.body?.url || '').trim();
    if (!/^https?:\/\/\S+\.\S+/.test(url) || url.length > 500) {
      return res.status(400).json({ success: false, error: '올바른 URL을 입력해주세요. (http:// 또는 https:// 로 시작, 500자 이내)' });
    }

    // 라벨 = 입력값(옵션) 또는 URL에서 자동 부여. 중괄호/개행 제거({{LINK:라벨}} 토큰 성립 보장).
    const explicitLabel = String(req.body?.label || '').replace(/[{}\r\n]/g, '').trim().slice(0, 40);
    const baseLabel = explicitLabel || deriveBrandLinkLabel(url);

    // 라벨 충돌 처리 — 같은 라벨 + 같은 URL = 그대로 갱신(멱등), 같은 라벨 + 다른 URL = 접미사로 분리
    // (UNIQUE(company_id, memory_type, memory_key) upsert가 다른 링크를 덮어쓰는 사고 차단)
    let label = baseLabel;
    let sameLabelSameUrl = false;
    // ★ 2026-09-27 한줄로 V2 R072 — 마지막 후보(-9)까지 확인하고, 다 차 있으면 거절한다(옛: -2~-8만 보고 -9를 확인 없이 써 기존 -9 링크를 덮었다).
    let labelResolved = false;
    for (let suffix = 2; suffix <= 10; suffix++) {
      const ex = await query(
        `SELECT memory_value FROM ai_company_memory
         WHERE company_id = $1::uuid AND memory_type = 'brand_link' AND memory_key = $2
         LIMIT 1`,
        [companyId, label],
      );
      if (ex.rows.length === 0) { labelResolved = true; break; }
      let exUrl = '';
      try {
        const v = typeof ex.rows[0].memory_value === 'string' ? JSON.parse(ex.rows[0].memory_value) : ex.rows[0].memory_value;
        exUrl = String(v?.url || '');
      } catch {
        exUrl = '';
      }
      if (exUrl === url) {
        sameLabelSameUrl = true;
        labelResolved = true;
        break;
      }
      if (suffix === 10) break;
      label = `${baseLabel.slice(0, 37)}-${suffix}`;
    }
    if (!labelResolved) {
      return res.status(400).json({ success: false, error: '같은 이름의 브랜드 링크가 너무 많습니다. 라벨을 다르게 입력해 주세요.' });
    }

    // 상한 확인 — 기존 행 갱신(같은 라벨·같은 URL)은 허용
    const countRes = await query(
      `SELECT COUNT(*)::int AS total
       FROM ai_company_memory
       WHERE company_id = $1::uuid AND memory_type = 'brand_link'`,
      [companyId],
    );
    const total = Number(countRes.rows[0]?.total) || 0;
    if (total >= BRAND_LINK_MAX && !sameLabelSameUrl) {
      return res.status(400).json({ success: false, error: `브랜드 링크는 최대 ${BRAND_LINK_MAX}건까지 등록 가능합니다.` });
    }

    const inserted = await query(
      `INSERT INTO ai_company_memory (
        id, company_id, memory_type, memory_key, memory_value,
        importance, source, metadata, last_accessed_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1::uuid, 'brand_link', $2, $3,
        7, 'admin_input', '{}'::jsonb, NOW(), NOW(), NOW()
      )
      ON CONFLICT (company_id, memory_type, memory_key) DO UPDATE SET
        memory_value = EXCLUDED.memory_value,
        updated_at = NOW(),
        last_accessed_at = NOW()
      RETURNING id`,
      [companyId, label, JSON.stringify({ label, url })],
    );

    const { invalidateBrandVoiceCache } = await import('../utils/brand-voice-prompt');
    invalidateBrandVoiceCache(companyId);

    return res.json({ success: true, id: inserted.rows[0]?.id, label, url, updated: sameLabelSameUrl });
  } catch (err: any) {
    console.error('[Brand Links POST] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '저장 실패') });
  }
});

router.delete('/brand-links/:id', async (req: Request, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    }
    const linkId = String(req.params.id || '').trim();
    if (!linkId) {
      return res.status(400).json({ success: false, error: 'link id가 필요합니다.' });
    }

    const result = await query(
      `DELETE FROM ai_company_memory
       WHERE id = $1::uuid AND company_id = $2::uuid AND memory_type = 'brand_link'
       RETURNING id`,
      [linkId, companyId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '브랜드 링크를 찾을 수 없습니다.' });
    }

    const { invalidateBrandVoiceCache } = await import('../utils/brand-voice-prompt');
    invalidateBrandVoiceCache(companyId);

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Brand Links DELETE] 오류:', err);
    return res.status(500).json({ success: false, error: publicErrorText(err, '삭제 실패') });
  }
});

export default router;
