/**
 * CT-61: A/B Variant Generator — D211+ Phase A 3번 (2026-05-23 Harold 명시)
 *
 * 본질: A/B variant 자동 생성 (AI 보조)
 *   - 옛 message_template 기준 톤 다양화 (감성/실용/캐주얼 3 영역)
 *   - 옛 winner 영역 기준 재생성 모드 (winner 메시지 패턴 학습)
 *   - 회사 admin 명시 적용 의무 (자동 적용 X — AI 영구 원칙)
 *
 * 영구 룰 정합:
 *   - feedback_ai_no_arbitrary_benefit: 구체 혜택 임의 작성 X — [혜택 안내 — 직접 수정해주세요] placeholder 보존
 *   - feedback_ai_operator_model_isolation: model:'sonnet' (D209+ 정합)
 *   - 회사 격리 (companyId 의무)
 *   - 변환 후 회사 admin 검토 + 명시 저장 의무 (자동 저장 X)
 *
 * 사용처:
 *   - POST /operator/journeys/steps/:stepId/variants/auto-generate
 *   - JourneyVariantsEditor 안 "AI 자동 생성" 버튼
 */

import { callAIWithFallback } from '../services/ai';
import { query } from '../config/database';
import { sanitizeForSms } from './message-sanitizer';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export type VariantTone = '감성적' | '실용적' | '캐주얼';

export interface GeneratedVariant {
  tone: VariantTone;
  messageTemplate: string;
  subject: string | null;
  byteCount: number;
  reasoning: string;
}

export interface VariantGenerationResult {
  stepId: string;
  baseMessage: string;
  channel: string;
  variants: GeneratedVariant[];
  generatedAt: Date;
  warnings: string[];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. generateVariantsFromMessage — base 메시지 기준 3 톤 자동 생성
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function generateVariantsFromMessage(input: {
  stepId: string;
  companyId: string;
  baseMessage: string;
  channel: 'sms' | 'lms' | 'mms' | 'kakao';
  subject?: string | null;
  isAd?: boolean;
}): Promise<VariantGenerationResult> {
  const { stepId, companyId, baseMessage, channel } = input;
  const warnings: string[] = [];

  if (!baseMessage || baseMessage.trim().length < 10) {
    return {
      stepId,
      baseMessage,
      channel,
      variants: [],
      generatedAt: new Date(),
      warnings: ['base 메시지 영역 10자 이상 의무 — variant 자동 생성 X.'],
    };
  }

  // 회사 정보 (브랜드 톤 + 업종)
  const companyRes = await query(
    `SELECT company_name, brand_name, business_type, brand_tone FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  const company = companyRes.rows[0] || {};

  const system = `당신은 CRM 마케팅 메시지 카피라이터입니다.
주어진 base 메시지를 3가지 톤(감성적/실용적/캐주얼)으로 자연스럽게 재작성합니다.

영구 원칙:
- 구체 혜택(% / 원 / 무료 / 쿠폰 / 사은품 / 적립 / 할인) 임의 생성 절대 금지. base 메시지 안 옛 혜택 표현 영역 그대로 유지 (수치 변경 X).
- base 메시지에 [혜택 안내 — 직접 수정해주세요] placeholder 영역 있으면 그대로 유지.
- 인사 + 안내 + 마무리 표현만 톤 다양화 (혜택 영역은 보존).
- 길이: SMS 90바이트 / LMS·MMS 2000바이트 이내.
- 이모지 / 특수문자 사용 자제 (이통사 EUC-KR 안전 영역).
- 광고 표기 (광고)+080+KISA 영역 시스템 자동 합성 — 본문에 광고 단어 작성 X.

JSON 형식으로만 응답하세요.`;

  const userMessage = `## 회사 정보
- 회사명: ${company.brand_name || company.company_name || '브랜드'}
- 업종: ${company.business_type || '기타'}
- 브랜드 톤: ${company.brand_tone || '친근함'}

## Base 메시지 (채널: ${channel.toUpperCase()})
\`\`\`
${baseMessage}
\`\`\`

## 요청
위 base 메시지를 3가지 톤으로 자연스럽게 재작성해주세요:
1. 감성적 — 따뜻하고 공감적인 톤
2. 실용적 — 명확하고 정보 중심 톤
3. 캐주얼 — 친근하고 가벼운 톤

각 variant는 base와 동일한 정보 + 동일한 혜택 표현을 유지하되 톤만 다르게 표현합니다.

## 출력 형식 (JSON만 응답)
{
  "variants": [
    { "tone": "감성적", "messageTemplate": "본문", "reasoning": "톤 차이 설명" },
    { "tone": "실용적", "messageTemplate": "본문", "reasoning": "톤 차이 설명" },
    { "tone": "캐주얼", "messageTemplate": "본문", "reasoning": "톤 차이 설명" }
  ]
}`;

  try {
    const text = await callAIWithFallback({
      system,
      userMessage,
      maxTokens: 2000,
      temperature: 0.7,
      model: 'sonnet',
      companyId,
      source: 'variant-generator',
    });

    let jsonStr = text;
    if (text.includes('```json')) {
      const start = text.indexOf('```json') + 7;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    } else if (text.includes('```')) {
      const start = text.indexOf('```') + 3;
      const end = text.indexOf('```', start);
      jsonStr = text.slice(start, end).trim();
    }

    const parsed = JSON.parse(jsonStr);
    const variants: GeneratedVariant[] = (Array.isArray(parsed.variants) ? parsed.variants : [])
      .slice(0, 3)
      .map((v: any) => {
        const tone: VariantTone =
          v?.tone === '감성적' || v?.tone === '실용적' || v?.tone === '캐주얼'
            ? v.tone
            : '실용적';
        const sanitized = sanitizeForSms(String(v?.messageTemplate || '')).sanitized.slice(0, 2000);
        const byteCount = computeByteCountSafe(sanitized);
        return {
          tone,
          messageTemplate: sanitized,
          subject: input.subject || null,
          byteCount,
          reasoning: typeof v?.reasoning === 'string' ? v.reasoning : '',
        };
      })
      .filter((v: GeneratedVariant) => v.messageTemplate.length >= 10);

    if (variants.length === 0) {
      warnings.push('AI 응답 영역 안 유효 variant 영역 0건 — 다시 시도해주세요.');
    }

    // SMS 영역 안 90바이트 초과 영역 경고
    if (channel === 'sms') {
      variants.forEach((v) => {
        if (v.byteCount > 90) {
          warnings.push(`${v.tone} variant ${v.byteCount}바이트 — SMS 90바이트 영역 초과. LMS 영역 전환 또는 본문 영역 축소 의무.`);
        }
      });
    }

    return {
      stepId,
      baseMessage,
      channel,
      variants,
      generatedAt: new Date(),
      warnings,
    };
  } catch (err: any) {
    console.error('[VariantGenerator] AI 호출 실패:', err?.message);
    return {
      stepId,
      baseMessage,
      channel,
      variants: [],
      generatedAt: new Date(),
      warnings: [`AI 호출 영역 일시 오류 — 잠시 후 다시 시도해주세요. (${err?.message || ''})`],
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. EUC-KR 바이트 계산 (옛 매트릭스 정합 — 한글 2바이트)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function computeByteCountSafe(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    bytes += code > 127 ? 2 : 1;
  }
  return bytes;
}
