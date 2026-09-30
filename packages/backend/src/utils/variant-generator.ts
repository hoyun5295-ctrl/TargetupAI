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
import { extractJsonFromAiText } from './ai-json';
import { findInventedBenefits, findNewNumbers } from './copy-benefit-detector';

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
      warnings: ['기준 문안이 10자 이상이어야 변형을 만들 수 있어요.'],
    };
  }

  // 회사 정보 (브랜드 톤 + 업종)
  const companyRes = await query(
    `SELECT company_name, brand_name, business_type, brand_tone FROM companies WHERE id = $1::uuid`,
    [companyId],
  );
  const company = companyRes.rows[0] || {};

  // ★ 2026-09-30 프롬프트 점검 WP3 — 자연스러운 한국어로 다시 씀(옛 문장의 "영역" 반복이 결과 말투에 번질 수 있다) ·
  //   사실 보존 목록을 구체화 · 세 변형이 실제로 달라야 한다는 기준 · 출력 형식 통제(머리말 · 마크다운 금지).
  //   사실 보존은 서버가 다시 본다(새 숫자 · 근거 없는 혜택이 생긴 변형은 뺀다 · copy-benefit-detector).
  const system = `당신은 CRM 마케팅 문자 카피라이터입니다.
기준 문안 하나를 받아, 담긴 사실은 그대로 두고 말투만 다른 세 변형(감성적 · 실용적 · 캐주얼)을 씁니다.

지켜야 할 것:
- 사실은 한 글자도 바꾸지 않습니다: 상품명 · 혜택과 그 숫자(%, 원, 쿠폰, 적립, 무료 등) · 날짜와 기간 · 시간 · 장소 · 연락처 · 링크.
- 기준 문안에 없는 숫자 · 기간 · 수량 · 혜택을 새로 쓰지 않습니다("오늘 단 하루", "선착순 100명" 같은 조건도 새로 만들지 않습니다).
- %이름% 같은 변수와 [혜택 안내: 직접 수정해주세요] 같은 채울 자리는 글자 그대로 둡니다.
- 바꾸는 것은 인사 · 연결 문장 · 마무리 · 문장 리듬입니다. 세 변형은 도입과 마무리가 서로 확실히 달라야 합니다(같은 문장에 낱말만 바꾼 변형은 실패입니다).
- 길이: 문자(SMS) 90바이트 · 장문(LMS · MMS) 2000바이트 이내.
- 문자 채널에는 이모지를 쓰지 않습니다. 강조가 필요하면 ★ ▶ ※ 【】 같은 문자 호환 기호만 씁니다.
- (광고) 표기 · 무료수신거부 번호는 시스템이 붙이므로 쓰지 않습니다.

답은 요청한 JSON 하나만 냅니다. 머리말 · 설명 · 코드블록 · 굵은 글씨를 붙이지 않습니다.`;

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
1. 감성적: 따뜻하고 공감적인 톤
2. 실용적: 명확하고 정보 중심 톤
3. 캐주얼: 친근하고 가벼운 톤

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

    // ★ 2026-09-30 WP4 — 추출은 CT 하나(코드펜스 · 머리말 · 문자열 안 줄바꿈 제어문자까지 처리 · 0630 사고 부류).
    const parsed: any = extractJsonFromAiText(text);
    let droppedFabricated = 0;
    const variants: GeneratedVariant[] = (Array.isArray(parsed?.variants) ? parsed.variants : [])
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
      .filter((v: GeneratedVariant) => v.messageTemplate.length >= 10)
      // ★ 2026-09-30 WP2 — 변형은 톤만 바꾼다. 기준 문안에 없던 숫자(기간 · 수량 · 시간)나 혜택 값 · 낱말이 생긴 변형은 뺀다
      //   (프롬프트 "혜택 표현 유지"는 확률적 · 30%가 40%로 바뀐 변형이 A/B 로 발송되면 지어낸 혜택).
      .filter((v: GeneratedVariant) => {
        const bad = findNewNumbers(v.messageTemplate, baseMessage).length > 0 || findInventedBenefits(v.messageTemplate, baseMessage).length > 0;
        if (bad) droppedFabricated++;
        return !bad;
      });

    if (droppedFabricated > 0) {
      warnings.push(`기준 문안에 없던 숫자나 혜택이 생긴 변형 ${droppedFabricated}개는 뺐어요.`);
    }
    if (variants.length === 0) {
      warnings.push('만들어진 변형이 없어요. 잠시 뒤 다시 시도해 주세요.');
    }

    // SMS 영역 안 90바이트 초과 영역 경고
    if (channel === 'sms') {
      variants.forEach((v) => {
        if (v.byteCount > 90) {
          warnings.push(`${v.tone} 변형이 ${v.byteCount}바이트라 문자(SMS) 90바이트를 넘어요. 장문(LMS)으로 바꾸거나 본문을 줄여 주세요.`);
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
      // ★ 2026-09-30 — 내부 오류 문장(모델명 · 키 이름이 섞일 수 있다)을 화면에 싣지 않는다(서버 로그에만).
      warnings: ['변형을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.'],
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
