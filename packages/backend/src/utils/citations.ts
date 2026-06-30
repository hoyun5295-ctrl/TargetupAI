/**
 * ★ CT-39: Anthropic Citations 컨트롤타워 — D181 (2026-05-19)
 *
 * 🎯 목적
 *   D162-5 AI 4 결합 #2 박은 영역 — Anthropic Citations API 박음.
 *   AI 응답 박은 영역에 근거 박음 — 회사 데이터 / 30일 history / 박은 메모리 박은 영역 박음.
 *   사용자 신뢰 #4 영구 원칙 — "AI가 박은 근거 박음" = 신뢰 박음.
 *
 * 📋 Anthropic 표준
 *   - document content block 박음 (type: 'document' + citations.enabled: true)
 *   - response content blocks 박은 영역에 citations 배열 박음 (각 text block에 박음)
 *   - cited_text + document_index + start_char_index/end_char_index 박음
 *
 * 📊 사용 흐름
 *   1. buildCompanyDocuments(companyId): document blocks 배열 박음 (회사 정보 + 30일 history + 메모리)
 *   2. callAIWithCitations(model, system, user, documents): 응답 + citations 박음
 *   3. UI 박은 영역에서 응답 옆에 근거 박음 (사용자 신뢰 박음)
 *
 * ⛔ 영구 원칙 정합
 *   - 회사 격리 — 본 회사 데이터만 박음
 *   - 모델 분리 #3 — AI Operator 영역 (Opus 4.7)
 *   - 사용자 신뢰 #4 — 근거 박음 (회사 데이터 출처 + 박은 영역 박음)
 */

import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/database';
import { AI_MODELS, isAdaptiveOnlyModel } from '../config/defaults';
import { listMemories as listCompanyMemories } from './company-memory';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface CompanyDocument {
  title: string;
  data: string;
  context?: string;
}

export interface CitationSpan {
  citedText: string;
  documentIndex: number;
  documentTitle: string;
  startCharIndex?: number;
  endCharIndex?: number;
}

export interface CitedAnswer {
  text: string;
  citations: CitationSpan[];
  documents: CompanyDocument[];
}

// ════════════════════════════════════════════════════════════════════
// 회사 documents 박음 — Citations 박을 영역
// ════════════════════════════════════════════════════════════════════

/**
 * 회사 박은 영역 박은 documents 박음:
 *   1. 회사 정보 (브랜드/톤/업종)
 *   2. 30일 성공 캠페인 history
 *   3. 박은 메모리 (success_pattern + customer_insight + channel_performance)
 *   4. 고객 통계 (총 고객 수 + RFM)
 */
export async function buildCompanyDocuments(companyId: string): Promise<CompanyDocument[]> {
  const docs: CompanyDocument[] = [];

  // 1. 회사 정보
  const companyRes = await query(
    `SELECT company_name, business_type, brand_name, brand_slogan, brand_description, brand_tone, customer_schema
     FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  if (companyRes.rows.length > 0) {
    const c = companyRes.rows[0];
    const companyText = [
      `회사명: ${c.company_name || '(미설정)'}`,
      `브랜드: ${c.brand_name || '(미설정)'}`,
      `슬로건: ${c.brand_slogan || '(미설정)'}`,
      `업종: ${c.business_type || '(미설정)'}`,
      `톤앤매너: ${c.brand_tone || '친근함'}`,
      c.brand_description ? `브랜드 소개: ${c.brand_description}` : '',
    ].filter(Boolean).join('\n');
    docs.push({
      title: '회사 정보',
      data: companyText,
      context: '한줄로AI 등록된 회사 메타 데이터',
    });
  }

  // 2. 30일 성공 캠페인 history
  const campaignsRes = await query(
    `SELECT name, message_content, sent_at,
            (SELECT COUNT(*) FROM campaign_runs WHERE campaign_id = c.id AND status_code IN ('1000', '2000')) AS success_count
     FROM campaigns c
     WHERE company_id = $1::uuid AND status = 'completed'
       AND sent_at > NOW() - INTERVAL '30 days'
     ORDER BY sent_at DESC LIMIT 10`,
    [companyId]
  );
  if (campaignsRes.rows.length > 0) {
    const lines = campaignsRes.rows.map((r: any, i: number) =>
      `${i + 1}. ${r.name || '(이름 없음)'} (${new Date(r.sent_at).toLocaleDateString('ko-KR')}, 성공 ${r.success_count}건)\n   메시지: ${(r.message_content || '').slice(0, 200)}`
    );
    docs.push({
      title: '최근 30일 캠페인 history',
      data: lines.join('\n\n'),
      context: '한줄로AI 등록된 본 회사 발송 이력',
    });
  }

  // 3. 박은 메모리
  const memories = await listCompanyMemories(companyId, { limit: 30, minImportance: 5 });
  if (memories.length > 0) {
    const lines = memories.map((m, i) =>
      `${i + 1}. [${m.memoryType}/중요도 ${m.importance}] ${m.memoryKey} — ${m.memoryValue}`
    );
    docs.push({
      title: '회사별 학습 메모리',
      data: lines.join('\n'),
      context: 'AI가 누적한 본 회사 학습 결과',
    });
  }

  // 4. 고객 통계
  const statsRes = await query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE sms_opt_in = true) AS sms_opt_in,
            AVG((custom_fields->>'purchase_count')::numeric) AS avg_purchase,
            AVG((custom_fields->>'total_spent')::numeric) AS avg_spent
     FROM customers WHERE company_id = $1::uuid AND is_active = true`,
    [companyId]
  );
  if (statsRes.rows.length > 0) {
    const s = statsRes.rows[0];
    docs.push({
      title: '고객 통계',
      data: [
        `총 활성 고객: ${s.total || 0}명`,
        `SMS 수신 동의: ${s.sms_opt_in || 0}명`,
        `평균 구매 횟수: ${s.avg_purchase ? Number(s.avg_purchase).toFixed(1) : '(데이터 부족)'}`,
        `평균 구매 금액: ${s.avg_spent ? Number(s.avg_spent).toLocaleString() + '원' : '(데이터 부족)'}`,
      ].join('\n'),
      context: '한줄로AI 등록된 customers 테이블 영역',
    });
  }

  return docs;
}

// ════════════════════════════════════════════════════════════════════
// AI 호출 박음 — Citations 박은 영역
// ════════════════════════════════════════════════════════════════════

/**
 * Anthropic Citations 박은 영역 박음 — Opus 4.7 박음 (AI Operator 모델 분리 정합).
 * - documents 박은 영역에 citations.enabled: true 박음
 * - 응답 박은 영역에 citations 배열 박음 (각 text block 박음)
 */
export async function callAIWithCitations(input: {
  model?: 'sonnet' | 'opus';
  system: string;
  userMessage: string;
  documents: CompanyDocument[];
  maxTokens?: number;
}): Promise<CitedAnswer> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.');
  }
  if (input.documents.length === 0) {
    throw new Error('Citations 사용할 documents 1건 이상 필요합니다.');
  }

  const modelKey = input.model || 'opus';
  const modelId = modelKey === 'opus' ? AI_MODELS.opus : AI_MODELS.claude;

  // document content blocks 박음 (citations.enabled: true)
  const documentBlocks = input.documents.map((doc) => ({
    type: 'document' as const,
    source: {
      type: 'text' as const,
      data: doc.data,
      media_type: 'text/plain' as const,
    },
    title: doc.title,
    ...(doc.context ? { context: doc.context } : {}),
    citations: { enabled: true },
  }));

  // Sonnet 5는 thinking 생략 시 adaptive 자동 ON → max_tokens 잠식·citations 누락 방지
  const citationThinking: any = isAdaptiveOnlyModel(modelId) ? { thinking: { type: 'disabled' } } : {};
  const response = await (anthropic.messages as any).create({
    model: modelId,
    max_tokens: input.maxTokens || 2000,
    ...citationThinking,
    system: input.system,
    messages: [
      {
        role: 'user',
        content: [
          ...documentBlocks,
          { type: 'text', text: input.userMessage },
        ],
      },
    ],
  });

  // 응답 박은 영역에서 text + citations 박음
  let text = '';
  const citations: CitationSpan[] = [];
  const contentBlocks: any[] = response.content || [];
  for (const block of contentBlocks) {
    if (block.type === 'text') {
      text += block.text || '';
      const blockCitations: any[] = block.citations || [];
      for (const c of blockCitations) {
        citations.push({
          citedText: c.cited_text || '',
          documentIndex: c.document_index ?? 0,
          documentTitle: c.document_title || input.documents[c.document_index ?? 0]?.title || '',
          startCharIndex: c.start_char_index,
          endCharIndex: c.end_char_index,
        });
      }
    }
  }

  return {
    text,
    citations,
    documents: input.documents,
  };
}
