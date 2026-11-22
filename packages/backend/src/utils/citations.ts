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
import { resolveConsentScope, consentJoinSql } from './mall-consent';
import { AI_MODELS, claudeRequestShape, resolveMaxTokens } from '../config/defaults';
import { listMemories as listCompanyMemories, LEARNING_MEMORY_TYPES } from './company-memory';

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
    // ★ 2026-09-27 한줄로 V2 R082 — 실존 칸(campaign_name · 캠페인 성공 수). 옛: campaigns.name · campaign_runs.status_code(없는 칸)라 늘 500.
    `SELECT campaign_name AS name, message_content, sent_at, COALESCE(success_count, 0) AS success_count
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
      title: '최근 30일 발송 이력',   // ★ 2026-11-21 C152 — 화면 「근거」 줄에 그대로 보이는 제목(옛: 캠페인 history)
      data: lines.join('\n\n'),
      context: '한줄로AI 등록된 본 회사 발송 이력',
    });
  }

  // 3. 박은 메모리
  // ★ 2026-07-12 — 학습 5종 한정 (무필터면 brand_guideline JSON 원문·대표문안·brand_link가 근거 문서 슬롯 잠식)
  const memories = await listCompanyMemories(companyId, { limit: 30, minImportance: 5, memoryTypes: LEARNING_MEMORY_TYPES });
  if (memories.length > 0) {
    const lines = memories.map((m, i) =>
      `${i + 1}. [${m.memoryType}/중요도 ${m.importance}] ${m.memoryKey}: ${m.memoryValue}`
    );
    docs.push({
      title: '회사별 학습 메모리',
      data: lines.join('\n'),
      context: 'AI가 누적한 본 회사 학습 결과',
    });
  }

  // 4. 고객 통계
  const statsConsent = consentJoinSql(await resolveConsentScope(companyId, null), '', 'customers.id');   // ★ 2026-10-02 수신동의 읽기 = CT
  const statsRes = await query(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE ${statsConsent.isTrue}) AS sms_opt_in,
            AVG(purchase_count) AS avg_purchase,
            AVG(total_purchase_amount) AS avg_spent
     FROM customers${statsConsent.join} WHERE company_id = $1::uuid AND is_active = true`,
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
/** 앞 문답 한 쌍(질문 · 그때 받은 답) — 대화 이어 가기의 맥락(★ 2026-11-22 C155) */
export interface CitedTurn { q: string; a: string }

/** 대화일 때만 시스템 글 끝에 붙는 한 줄 — 앞 답의 숫자가 굳지 않게(숫자의 근거는 매번 지금 받은 document) */
export const HISTORY_SYSTEM_LINE = '앞 문답은 맥락이다. 숫자와 사실은 이번에 받은 document 에서만 답한다. 앞 답의 숫자가 이번 document 와 다르면 이번 document 가 옳다.';

/**
 * (순수) 요청의 메시지 줄 — 앞 문답은 글만(질문 = user · 답 = assistant) 차례로 놓고, **document 는 이번 질문 메시지에만** 붙인다.
 *   앞 문답이 없으면 메시지 하나(document + 이번 질문) = 이 인자가 생기기 전과 글자 그대로 같은 요청.
 */
export function citationMessages(documentBlocks: any[], userMessage: string, history: readonly CitedTurn[] = []): Anthropic.MessageParam[] {
  const past: Anthropic.MessageParam[] = history.flatMap((t): Anthropic.MessageParam[] => [
    { role: 'user', content: t.q },
    { role: 'assistant', content: t.a },
  ]);
  return [...past, { role: 'user', content: [...documentBlocks, { type: 'text', text: userMessage }] }];
}

export async function callAIWithCitations(input: {
  model?: 'sonnet' | 'opus';
  system: string;
  userMessage: string;
  documents: CompanyDocument[];
  maxTokens?: number;
  /** ★ 2026-11-22 C155 — 앞 문답(맥락). 넘기지 않으면 지금과 같은 요청 */
  history?: readonly CitedTurn[];
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

  const history = input.history || [];
  // 모델별 생각 끄기 형태(claudeRequestShape) — 생략하면 adaptive 자동 ON 으로 max_tokens 잠식 · citations 누락
  const citationThinking: any = claudeRequestShape(modelId);
  const response = await (anthropic.messages as any).create({
    model: modelId,
    max_tokens: resolveMaxTokens(input.maxTokens || 2000, modelId),
    ...citationThinking,
    system: history.length > 0 ? `${input.system}\n${HISTORY_SYSTEM_LINE}` : input.system,
    messages: citationMessages(documentBlocks, input.userMessage, history),
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
