/**
 * ★ CT: 행사 캠페인 이미지 판독 (2026-07-08)
 *
 * 업로드 이미지(상품 목록 스샷 등)를 vision AI로 "보이는 것만 그대로 전사"해
 * 행사 내용 자유 텍스트로 반환한다. 반환 텍스트는 사용자가 직접 입력한 것과 동일하게
 * 3채널 생성기(모바일DM one-shot / 이메일 generate-sections / 인앱 ai-generate)에 주입된다.
 *
 * ⛔ 혜택·가격 날조 금지 영구 룰 양립:
 *   - 전사 결과가 곧 "행사 원문"이 되어, 다운스트림 event-brief 검증
 *     (validateProductsAgainstEventText·benefitMatchesEventText)이 그대로 걸린다.
 *   - 전사 단계 자체도 "이미지에 없는 가격·혜택·기간을 지어내지 않는다"를 시스템 프롬프트로 강제.
 *   - 사용자가 반환 텍스트를 입력칸에서 눈으로 확인·보정 → 사람 검증 + 기계 검증 이중.
 *
 * 크레딧: source 'event-image-extract' = 3 (callAIWithFallback이 성공 시에만 차감). 이미지 있으면 cache 우회.
 */
import { callAIWithFallback } from '../services/ai';
import { normalizeEventText } from './event-brief';

export interface EventImageInput {
  media_type: string;
  data: string; // base64 (no data URL prefix)
}

/** vision 판독 허용 이미지 형식 (Anthropic image content 지원 + 안전 화이트리스트) */
export const ALLOWED_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** 한 번에 판독할 이미지 최대 장수 */
export const MAX_EVENT_IMAGES = 5;

const EXTRACT_SYSTEM_PROMPT = `당신은 쇼핑몰 행사/프로모션 이미지를 읽어 "행사 내용"을 그대로 옮겨 적는 전사 담당입니다.

[출력 목표]
- 사용자가 마케팅 문자·DM·이메일·인앱을 만들려고 행사 내용을 손으로 붙여넣는 것과 같은 자연스러운 한국어 텍스트를 만드세요.
- 여러 장의 이미지는 하나의 행사로 보고 합쳐서 정리하세요.

[반드시 이미지에 실제로 보이는 것만]
- 브랜드/쇼핑몰명, 행사명, 기간, 대상, 조건, 혜택(%·원·쿠폰·무료·사은품 등)은 이미지에 보이는 문구만 그대로 옮깁니다.
- 상품이 나열돼 있으면 각 상품을 한 줄로: 상품명 / 정가 / 할인율 / 판매가 중 이미지에 보이는 값만 적습니다.
- 가격 숫자는 이미지에 보이는 숫자를 그대로 적습니다(콤마 포함/미포함 무관, 임의 반올림 금지).

[절대 금지]
- 이미지에 없는 가격·할인율·기간·혜택·상품을 지어내지 마세요.
- 이미지에서 값이 안 보이면 그 항목은 비워 두세요(추정 금지). 없는 정보를 채우지 마세요.
- 광고 문구를 새로 창작하지 마세요. 당신은 "옮겨 적기"만 합니다.

[형식]
- 순수 텍스트만 출력하세요. JSON, 표, 마크다운, 코드 블록, 설명 문장("다음은..." 등)을 붙이지 마세요.
- 이모지를 넣지 마세요.
- 각 항목은 줄바꿈으로 구분하세요.`;

/** 코드펜스/설명 접두를 제거하고 순수 전사 텍스트만 남긴다 (AI가 규칙을 어기고 감쌀 때 방어) */
function stripWrapping(raw: string): string {
  let t = String(raw ?? '').trim();
  // 코드펜스 통째로 감싼 경우 내부만
  const fence = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
  if (fence) t = fence[1].trim();
  return t;
}

/**
 * 이미지 → 행사 내용 텍스트. 실패 시 throw(호출측이 사용자 안내).
 * @throws 유효 이미지 0장이면 에러 / AI 실패 시 callAIWithFallback 에러 전파
 */
export async function extractEventTextFromImages(params: {
  images: EventImageInput[];
  companyId: string;
  userId?: string;
}): Promise<string> {
  const images = (params.images || [])
    .filter((im) => im && typeof im.data === 'string' && im.data.length > 0 && ALLOWED_IMAGE_MEDIA_TYPES.has(im.media_type))
    .slice(0, MAX_EVENT_IMAGES);
  if (!images.length) {
    throw new Error('판독할 이미지가 없습니다. jpg/png/webp 이미지를 올려주세요.');
  }

  const raw = await callAIWithFallback({
    system: EXTRACT_SYSTEM_PROMPT,
    userMessage: '위 이미지에 실제로 보이는 행사 내용만 규칙대로 그대로 옮겨 적어줘. 보이지 않는 값은 지어내지 말고 비워 둬.',
    maxTokens: 1500,
    temperature: 0.2,
    companyId: params.companyId,
    userId: params.userId,
    source: 'event-image-extract',
    creditCost: 3,
    images,
  });

  const text = normalizeEventText(stripWrapping(raw));
  if (!text) {
    throw new Error('이미지에서 행사 내용을 읽지 못했습니다. 텍스트가 잘 보이는 이미지로 다시 시도해주세요.');
  }
  return text;
}
