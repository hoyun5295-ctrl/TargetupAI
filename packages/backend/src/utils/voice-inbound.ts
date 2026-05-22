/**
 * ★ CT-33: 인바운드 음성 AI 응답 컨트롤타워 — D178 (2026-05-19)
 *
 * 🎯 목적
 *   비전 v0.3 § 4-1 정합 — Phase 1 인바운드 음성 AI 응답.
 *   자사몰 SMS/카카오 받은 사용자가 "전화 문의" 클릭 → 한줄로 inbound 번호 →
 *   STT(Clova Speech) → Opus 4.7 + CDP 데이터 응답 → TTS(Clova Voice) → 응답.
 *
 * 📊 흐름
 *   1. 통신사/SIP gateway가 POST /api/voice/webhook 박음 (transcript + caller_phone + company_id)
 *   2. handleInboundCall: CDP에서 사용자 식별 (phone → customer) + 최근 주문/회원 정보 박음
 *   3. Opus 4.7 호출 (system 프롬프트 = 회사 톤 + CDP 데이터 + 응답 가이드)
 *   4. response 텍스트 박힌 후 TTS audio binary 생성
 *   5. voice_inbound_calls INSERT (transcript + ai_response + duration + status)
 *
 * ⛔ 영구 원칙 정합
 *   - 회사 admin이 활성/비활성 토글 (companies.voice_inbound_enabled, default OFF)
 *   - 트랜스크립트 사후 확인 박음 (사용자 신뢰 #4)
 *   - Opus 4.7 영역 (AI Operator 모델 분리 룰 #3 정합, Sonnet 4.6 흐름 영향 0건)
 *   - 응답 내용은 자사몰 CDP 데이터 기반 (추측 X, 사실 박음)
 *   - 발송/예약 등 외부 action은 박지 X (인바운드 응답 한정 — 음성 AI 단독 실행 X)
 */

import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { synthesizeSpeech, isClovaConfigured } from './naver-clova-client';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

export interface InboundCallInput {
  companyId: string;
  callerPhone: string;
  transcript: string;        // STT 박힌 텍스트
  sessionId?: string;        // 통신사 SIP session 식별자
  durationMs?: number;
}

export interface InboundCallResult {
  callId: string;
  responseText: string;
  responseAudio?: Buffer;    // TTS binary (caller에게 박을 영역)
  customerId: string | null;
  durationMs: number;
}

export interface CallRecord {
  id: string;
  companyId: string;
  callerPhone: string;
  customerId: string | null;
  transcript: string;
  aiResponse: string;
  durationMs: number;
  status: string;
  createdAt: Date;
}

// ════════════════════════════════════════════════════════════════════
// 인바운드 호출 처리
// ════════════════════════════════════════════════════════════════════

export async function handleInboundCall(input: InboundCallInput): Promise<InboundCallResult> {
  const { companyId, callerPhone, transcript, durationMs } = input;

  // 1. 회사 음성 AI 활성 확인 (영구 원칙 #4 사용자 신뢰 — 명시 활성만)
  const companyRes = await query(
    `SELECT
       COALESCE(voice_inbound_enabled, false) AS voice_inbound_enabled,
       company_name, business_type, brand_name, brand_slogan, brand_description, brand_tone
     FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  if (companyRes.rows.length === 0) {
    throw new Error('회사 정보를 찾을 수 없습니다.');
  }
  const company = companyRes.rows[0];
  if (!company.voice_inbound_enabled) {
    throw new Error('본 회사는 인바운드 음성 AI 응답 기능이 비활성 상태입니다.');
  }

  // 2. CDP에서 사용자 식별 (phone → customer)
  let customerId: string | null = null;
  let customerContext: any = null;
  const customerRes = await query(
    `SELECT id, name, grade, custom_fields,
            (SELECT COUNT(*) FROM cdp_events WHERE customer_id = customers.id AND occurred_at > NOW() - INTERVAL '90 days') AS recent_events,
            (SELECT MAX(occurred_at) FROM cdp_events WHERE customer_id = customers.id AND event_name = 'purchase') AS last_purchase
     FROM customers WHERE company_id = $1::uuid AND phone = $2 LIMIT 1`,
    [companyId, callerPhone.replace(/\D/g, '')]
  );
  if (customerRes.rows.length > 0) {
    customerId = customerRes.rows[0].id;
    customerContext = customerRes.rows[0];
  }

  // 3. 최근 주문 박음 (CDP 데이터 기반 응답 정합)
  let recentOrders: any[] = [];
  if (customerId) {
    const orderRes = await query(
      `SELECT properties, occurred_at FROM cdp_events
       WHERE customer_id = $1::uuid AND event_name IN ('purchase', 'custom_order_cancelled')
       ORDER BY occurred_at DESC LIMIT 5`,
      [customerId]
    );
    recentOrders = orderRes.rows;
  }

  // 4. system 프롬프트 구성 (영구 원칙 #3 모델 분리 + #4 사용자 신뢰 정합)
  const systemPrompt = buildSystemPrompt(company, customerContext, recentOrders);
  const userMessage = transcript || '(음성 인식 결과 없음)';

  console.log(`[VoiceInbound] ${company.company_name} 인바운드 응답 생성 중 (phone=${callerPhone.slice(-4)}, customer=${customerId ? 'matched' : 'unknown'})`);

  // ★ D209+ (Harold 명시 2026-05-22): Sonnet 4.6 전환 — 인바운드 단순 응답 영역. 비용 80% 절감.
  //   Phase D 통합: companyId + source 전달 → 회사별 월 한도 + cache + 통계 자동 활성.
  let responseText = '';
  try {
    const aiResult = await callAIWithFallback({
      model: 'sonnet',
      system: systemPrompt,
      userMessage,
      maxTokens: 500,
      temperature: 0,
      companyId: company.id,
      source: 'voice-inbound',
    });
    responseText = aiResult || '죄송합니다, 답변을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.';
  } catch (err: any) {
    console.error('[VoiceInbound] AI 호출 실패:', err?.message || err);
    responseText = '죄송합니다, 잠시 후 다시 문의해주시면 빠른 답변을 드리겠습니다.';
  }

  // 6. TTS 생성 (Clova Voice 통합 영역)
  let responseAudio: Buffer | undefined = undefined;
  const clovaCfg = isClovaConfigured();
  if (clovaCfg.tts) {
    try {
      responseAudio = await synthesizeSpeech(responseText, { speaker: 'nara', speed: 0, format: 'mp3' });
    } catch (err: any) {
      console.warn('[VoiceInbound] TTS 실패 (텍스트만 응답):', err?.message || err);
    }
  }

  // 7. DB INSERT
  const callRes = await query(
    `INSERT INTO voice_inbound_calls (
      id, company_id, caller_phone, customer_id, transcript, ai_response,
      duration_ms, status, created_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3::uuid, $4, $5,
      $6, 'completed', NOW()
    ) RETURNING id`,
    [companyId, callerPhone, customerId, transcript, responseText, durationMs || 0]
  );

  return {
    callId: callRes.rows[0].id,
    responseText,
    responseAudio,
    customerId,
    durationMs: durationMs || 0,
  };
}

function buildSystemPrompt(company: any, customer: any, recentOrders: any[]): string {
  const customerLine = customer
    ? `현재 통화 중인 고객 정보:
- 이름: ${customer.name || '미설정'}
- 등급: ${customer.grade || '일반'}
- 최근 90일 활동: ${customer.recent_events || 0}건
- 마지막 구매: ${customer.last_purchase ? new Date(customer.last_purchase).toLocaleDateString('ko-KR') : '없음'}`
    : '현재 통화 중인 고객은 CDP에 등록된 회원이 아닙니다 (비회원 또는 미식별).';

  const ordersLine = recentOrders.length > 0
    ? recentOrders.map((o, i) => `${i + 1}. ${new Date(o.occurred_at).toLocaleDateString('ko-KR')} — ${JSON.stringify(o.properties).slice(0, 100)}`).join('\n')
    : '최근 주문 이력 없음';

  return `당신은 ${company.company_name || '한줄로 고객사'}의 인바운드 음성 AI 응답 에이전트입니다.

회사 정보:
- 브랜드: ${company.brand_name || company.company_name}
- 슬로건: ${company.brand_slogan || '미설정'}
- 사업 영역: ${company.business_type || '미설정'}
- 톤: ${company.brand_tone || '친절하고 전문적'}

${customerLine}

최근 주문 이력:
${ordersLine}

응답 가이드 (영구 원칙):
1. 위 정합된 CDP 데이터에 근거한 사실만 응답 (추측/창작 X)
2. 발송/예약/결제 등 외부 action은 처리 안 함 — "담당자가 처리할 영역" 안내만
3. 본 통화는 인바운드 음성 응답이므로 60초 이내 응답 (3~5 문장)
4. 한국어 존댓말로 자연스럽게 응답 (~입니다 / ~해드리겠습니다)
5. 모르는 정보는 "정확한 답변은 담당자가 안내드릴 영역입니다" 안내
6. 광고/할인 정보는 제공 X (영구 원칙 — 음성 응답은 안내 한정)`;
}

// ════════════════════════════════════════════════════════════════════
// CRUD — 회사 admin 영역
// ════════════════════════════════════════════════════════════════════

export async function listCallsByCompany(companyId: string, limit: number = 50): Promise<CallRecord[]> {
  const result = await query(
    `SELECT id, company_id, caller_phone, customer_id, transcript, ai_response,
            duration_ms, status, created_at
     FROM voice_inbound_calls
     WHERE company_id = $1::uuid
     ORDER BY created_at DESC
     LIMIT $2`,
    [companyId, Math.min(limit, 200)]
  );
  return result.rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    callerPhone: r.caller_phone,
    customerId: r.customer_id,
    transcript: r.transcript,
    aiResponse: r.ai_response,
    durationMs: r.duration_ms || 0,
    status: r.status,
    createdAt: new Date(r.created_at),
  }));
}

export async function setVoiceInboundEnabled(companyId: string, enabled: boolean): Promise<void> {
  await query(
    `UPDATE companies SET voice_inbound_enabled = $2, updated_at = NOW() WHERE id = $1::uuid`,
    [companyId, enabled]
  );
}

export async function getVoiceInboundStatus(companyId: string): Promise<{ enabled: boolean; clovaConfigured: { stt: boolean; tts: boolean } }> {
  const result = await query(
    `SELECT COALESCE(voice_inbound_enabled, false) AS enabled FROM companies WHERE id = $1::uuid`,
    [companyId]
  );
  return {
    enabled: result.rows.length > 0 ? result.rows[0].enabled : false,
    clovaConfigured: isClovaConfigured(),
  };
}
