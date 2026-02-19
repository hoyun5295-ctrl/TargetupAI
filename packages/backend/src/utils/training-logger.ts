/**
 * training-logger.ts
 * ============================================================
 * AI 학습용 비식별 데이터 수집 유틸리티
 * ============================================================
 * 목적: 캠페인 발송 데이터를 비식별화하여 ai_training_logs 테이블에 적재
 *       → 향후 인비토AI (메시징 특화 모델) 학습 데이터셋으로 활용
 * 
 * 원칙:
 *   - 적재 실패해도 발송 플로우에 영향 없음 (try-catch 격리)
 *   - 고객사/수신자 역추적 불가 (HMAC 해시 + 텍스트 마스킹)
 *   - deterministic 메타는 코드로 계산, 애매한 분류만 model label
 * 
 * 설계: Claude + GPT + Gemini 3자 토론 → Harold 최종 확정 (2026-02-19)
 * ============================================================
 */

import pool from '../config/database';
import crypto from 'crypto';

// ============================================================
// HMAC 비밀키 (환경변수 또는 기본값)
// ============================================================
const HMAC_SECRET = process.env.TRAINING_HMAC_SECRET || 'invito-training-default-key-2026';

// ============================================================
// 현재 버전 상수 (변경 시 여기만 수정)
// ============================================================
export const TRAINING_VERSIONS = {
  prompt: 'v1',          // AI 프롬프트 버전
  persona: 'v1',         // 브랜드 페르소나 설정 버전
  policy: 'v1',          // 가드레일/정책 룰셋 버전
  redaction: 'v1_regex', // 마스킹 로직 버전
};

// ============================================================
// 타입 정의
// ============================================================
interface CandidateFeatures {
  emoji_count: number;
  sentence_count: number;
  char_length: number;
  has_link: boolean;
  has_phone_cta: boolean;
  cta_type: 'link' | 'phone' | 'visit' | 'none';
  first_sentence_pattern?: string; // model label (옵션)
}

interface Candidate {
  candidate_id: string;
  text: string;
  features: CandidateFeatures;
}

interface GuardrailActions {
  status: 'passed' | 'modified' | 'blocked';
  actions: string[];
  flags: string[];
}

interface TrainingLogParams {
  // 식별자 (HMAC 해시 대상)
  campaignRunId: string;
  companyId: string;

  // 비식별 컨텍스트
  industryCode?: string;
  brandTone?: string;
  companyName?: string; // 마스킹에 사용 후 저장하지 않음

  // 입력
  userPrompt?: string;
  targetFilter?: Record<string, any>;
  targetCount?: number;
  segmentKey?: string;

  // 메시지
  messageType: 'SMS' | 'LMS' | 'MMS' | 'KAKAO';
  isAd: boolean;
  aiMessages?: string[];           // AI 제안 메시지 원문 배열
  selectedIndex?: number;          // 사용자가 선택한 인덱스 (0-based)
  finalMessage: string;            // 최종 발송 메시지 원문
  finalSource: 'selected_as_is' | 'edited' | 'manual';

  // 발송 시점
  sendAt?: Date;

  // AI 모델 정보
  modelId?: string;
  modelParams?: Record<string, any>;

  // 가드레일
  guardrailActions?: GuardrailActions;
}

interface TrainingMetricsParams {
  sourceRef: string;
  sentCount: number;
  successCount: number;
  failCount: number;
  spamBlocked?: number;
}

// ============================================================
// 1) HMAC 해싱: 역추적 불가능한 안정키 생성
// ============================================================
function hmacHash(value: string): string {
  return crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(value)
    .digest('hex')
    .substring(0, 32); // 64자 중 32자만 사용 (충돌 확률 무시 가능)
}

// ============================================================
// 2) 텍스트 마스킹: 브랜드명/전화번호/금액/주소 → 변수 치환
// ============================================================
export function maskForTraining(text: string, companyName?: string): string {
  if (!text) return '';
  
  let masked = text;

  // 브랜드명 마스킹 (회사명이 있으면 치환)
  if (companyName) {
    // 회사명과 변형들을 마스킹 (대소문자 무시)
    const escapedName = companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(escapedName, 'gi');
    masked = masked.replace(nameRegex, '{brand}');
  }

  // 전화번호 마스킹 (010-1234-5678, 01012345678, 02-123-4567 등)
  masked = masked.replace(
    /(\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{4})/g, 
    '{phone}'
  );

  // 금액 마스킹 (₩1,000, 1000원, 10,000원, 50% 등)
  masked = masked.replace(
    /₩?\s?\d{1,3}(,\d{3})*\s?원/g, 
    '{amount}'
  );
  masked = masked.replace(
    /\d{1,3}(,\d{3})+/g, 
    '{amount}'
  );

  // URL 마스킹
  masked = masked.replace(
    /https?:\/\/[^\s)}\]]+/g, 
    '{url}'
  );

  // 이메일 마스킹
  masked = masked.replace(
    /[\w.-]+@[\w.-]+\.\w+/g, 
    '{email}'
  );

  return masked;
}

// ============================================================
// 3) Deterministic 메시지 피처 계산 (LLM에 맡기지 않음)
// ============================================================
export function computeMessageFeatures(text: string): CandidateFeatures {
  if (!text) {
    return {
      emoji_count: 0,
      sentence_count: 0,
      char_length: 0,
      has_link: false,
      has_phone_cta: false,
      cta_type: 'none',
    };
  }

  // 이모지 카운트 (유니코드 이모지 범위)
  const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu;
  const emojiMatches = text.match(emojiRegex);
  const emojiCount = emojiMatches ? emojiMatches.length : 0;

  // 문장 수 (마침표, 느낌표, 물음표, 개행 기준)
  const sentences = text.split(/[.!?\n]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length;

  // 문자 수
  const charLength = text.length;

  // 링크 존재 여부
  const hasLink = /https?:\/\/|{url}/i.test(text);

  // 전화번호 CTA 존재 여부
  const hasPhoneCta = /\d{2,4}[-.]?\d{3,4}[-.]?\d{4}|{phone}/g.test(text);

  // CTA 타입 결정 (우선순위: link > phone > none)
  let ctaType: 'link' | 'phone' | 'visit' | 'none' = 'none';
  if (hasLink) {
    ctaType = 'link';
  } else if (hasPhoneCta) {
    ctaType = 'phone';
  } else if (/방문|매장|오세요|오셔서|들러/i.test(text)) {
    ctaType = 'visit';
  }

  return {
    emoji_count: emojiCount,
    sentence_count: sentenceCount,
    char_length: charLength,
    has_link: hasLink,
    has_phone_cta: hasPhoneCta,
    cta_type: ctaType,
  };
}

// ============================================================
// 4) AI 제안 메시지 → candidates 배열 변환 (마스킹 + 피처 계산)
// ============================================================
function buildCandidates(aiMessages: string[], companyName?: string): Candidate[] {
  return aiMessages.map((msg, idx) => {
    const maskedText = maskForTraining(msg, companyName);
    return {
      candidate_id: `c${idx + 1}`,
      text: maskedText,
      features: computeMessageFeatures(maskedText),
    };
  });
}

// ============================================================
// 5) 학습 데이터 적재 (INSERT) — 발송 완료 시 호출
//    ⚠️ try-catch 격리: 실패해도 발송 플로우에 영향 없음
// ============================================================
export async function logTrainingData(params: TrainingLogParams): Promise<void> {
  try {
    // source_ref: campaign_run_id를 HMAC 해시 (중복 적재 방지)
    const sourceRef = hmacHash(params.campaignRunId);

    // tenant_ref: company_id를 HMAC 해시 (운영 디버깅용, 반출 시 제거)
    const tenantRef = hmacHash(params.companyId);

    // 사용자 프롬프트 마스킹
    const maskedPrompt = params.userPrompt 
      ? maskForTraining(params.userPrompt, params.companyName)
      : null;

    // 최종 메시지 마스킹
    const maskedFinalMessage = maskForTraining(params.finalMessage, params.companyName);

    // AI 제안 후보 빌드 (마스킹 + 피처 계산)
    const candidates = params.aiMessages 
      ? buildCandidates(params.aiMessages, params.companyName)
      : null;

    // 선택된 candidate_id
    const selectedCandidateId = (params.selectedIndex != null && candidates)
      ? candidates[params.selectedIndex]?.candidate_id || null
      : null;

    // 최종 메시지 피처 계산 (마스킹된 텍스트 기준)
    const messageFeatures = computeMessageFeatures(maskedFinalMessage);

    // final_source 판정: AI 메시지와 최종 메시지 비교
    let finalSource = params.finalSource;
    if (!finalSource && candidates && params.selectedIndex != null) {
      const selectedText = candidates[params.selectedIndex]?.text;
      if (selectedText === maskedFinalMessage) {
        finalSource = 'selected_as_is';
      } else {
        finalSource = 'edited';
      }
    }

    // 가드레일 액션 (없으면 기본값)
    const guardrailActions = params.guardrailActions || {
      status: 'passed',
      actions: [],
      flags: [],
    };

    const query = `
      INSERT INTO ai_training_logs (
        source_ref, tenant_ref, industry_code, brand_tone,
        user_prompt, target_filter, target_count, segment_key,
        message_type, is_ad, candidates, selected_candidate_id,
        final_message, final_source, message_features,
        send_at,
        prompt_version, persona_version, policy_version,
        model_id, model_params,
        guardrail_actions, redaction_version
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, $10, $11, $12,
        $13, $14, $15,
        $16,
        $17, $18, $19,
        $20, $21,
        $22, $23
      )
      ON CONFLICT (source_ref) DO NOTHING
    `;

    await pool.query(query, [
      sourceRef,
      tenantRef,
      params.industryCode || null,
      params.brandTone || null,
      maskedPrompt,
      params.targetFilter ? JSON.stringify(params.targetFilter) : null,
      params.targetCount || null,
      params.segmentKey || null,
      params.messageType,
      params.isAd,
      candidates ? JSON.stringify(candidates) : null,
      selectedCandidateId,
      maskedFinalMessage,
      finalSource || 'manual',
      JSON.stringify(messageFeatures),
      params.sendAt || new Date(),
      TRAINING_VERSIONS.prompt,
      TRAINING_VERSIONS.persona,
      TRAINING_VERSIONS.policy,
      params.modelId || 'claude-sonnet-4-20250514',
      params.modelParams ? JSON.stringify(params.modelParams) : null,
      JSON.stringify(guardrailActions),
      TRAINING_VERSIONS.redaction,
    ]);

    console.log(`[TrainingLog] 적재 완료: ${sourceRef.substring(0, 8)}...`);
  } catch (err) {
    // ⚠️ 적재 실패해도 발송 플로우에 영향 없음 — 로그만 남김
    console.error('[TrainingLog] 적재 실패 (발송에 영향 없음):', err);
  }
}

// ============================================================
// 6) 성과 데이터 업데이트 — 결과 동기화 완료 시 호출
//    ⚠️ try-catch 격리: 실패해도 동기화 플로우에 영향 없음
// ============================================================
export async function updateTrainingMetrics(params: TrainingMetricsParams): Promise<void> {
  try {
    const query = `
      UPDATE ai_training_logs
      SET sent_count = $2,
          success_count = $3,
          fail_count = $4,
          spam_blocked = $5,
          metrics_updated_at = NOW()
      WHERE source_ref = $1
    `;

    await pool.query(query, [
      params.sourceRef,
      params.sentCount,
      params.successCount,
      params.failCount,
      params.spamBlocked || 0,
    ]);

    console.log(`[TrainingLog] 성과 업데이트: ${params.sourceRef.substring(0, 8)}...`);
  } catch (err) {
    console.error('[TrainingLog] 성과 업데이트 실패 (동기화에 영향 없음):', err);
  }
}

// ============================================================
// 7) campaign_run_id → source_ref 변환 (외부에서 호출 가능)
//    결과 동기화 시 source_ref를 구하기 위해 사용
// ============================================================
export function getSourceRef(campaignRunId: string): string {
  return hmacHash(campaignRunId);
}
