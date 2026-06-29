/**
 * CT utils/operator-message-decorator.ts (2026-06-29 신설)
 *
 * AI 꾸미기 — AI Operator 추천 메시지에 사용자가 선택한 개인화 컬럼(%변수%)을 자연스럽게 녹여 재작성.
 *   회사가 실제 데이터를 가진 변수(data-profile 안전 변수)만 선택되므로, AI는 그 변수만 본문에 배치한다.
 *
 * 영구 룰 정합:
 *  - 원본에 없는 정보·구체 혜택(%·원·쿠폰·무료·할인·적립) 임의 생성 금지 (LESSONS_BACKEND 4-1, ai_no_arbitrary_benefit)
 *  - (광고)/무료수신거부/제목 = 시스템 자동 합성 → 본문 직접 작성 X
 *  - EUC-KR sanitize(이모지·미지원 특수문자 제거)
 *  - 컨트롤타워 단일 진입(라우트 인라인 금지)
 *  - 모델 = 'sonnet' (다듬기와 동급 경량 작업, 신규 격리 호출 — 기존 흐름 무영향)
 */

import { callAIWithFallback } from '../services/ai';
import { sanitizeForSms } from './message-sanitizer';

export interface DecorateMessageInput {
  companyId: string;
  message: string;
  /** 녹여 넣을 개인화 변수 이름(표시명, 예: '고객명' '포인트') — % 없이 전달 */
  selectedVars: string[];
  channel: 'sms' | 'lms' | 'mms';
  isAd: boolean;
  userId?: string;
}

export async function decorateOperatorMessage(input: DecorateMessageInput): Promise<string> {
  const vars = (input.selectedVars || [])
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim().replace(/%/g, ''));
  if (vars.length === 0) throw new Error('활용할 컬럼을 1개 이상 선택해주세요.');

  const message = String(input.message || '').trim();
  if (message.length < 5) throw new Error('꾸밀 메시지가 너무 짧습니다.');

  const channel = (['sms', 'lms', 'mms'] as const).includes(input.channel as any) ? input.channel : 'lms';
  const maxBytes = channel === 'sms' ? 90 : 2000;
  const varTokens = vars.map((v) => '%' + v + '%').join(', ');

  const system = [
    '당신은 한줄로의 메시지 개인화 편집기입니다. 주어진 마케팅 문구를 자연스럽게 다시 써서, 지정된 개인화 변수를 문맥에 녹여 넣습니다.',
    '',
    '규칙:',
    '- 반드시 다음 변수만 사용한다(다른 변수를 새로 만들지 말 것): ' + varTokens,
    '- 변수는 ' + '"%변수%"' + ' 형태 그대로 쓴다. 모든 변수를 억지로 넣지 말고, 문맥상 자연스러운 곳에만 녹인다.',
    '- 원문의 의도·톤·핵심 메시지는 유지한다. 원문에 없는 사실/정보를 새로 만들지 않는다.',
    '- 구체 혜택(%·원·쿠폰·무료·할인·적립·사은품·무료배송)은 절대 임의로 쓰지 않는다. 원문에 있던 혜택 표현만 유지한다.',
    '- (광고) 접두사·무료수신거부 번호·제목은 시스템이 자동 합성하므로 본문에 직접 쓰지 않는다.',
    '- ' + channel.toUpperCase() + ' 분량(약 ' + maxBytes + ' bytes 이내)을 지킨다.',
    '- 이모지와 통신사 미지원 특수문자는 쓰지 않는다.',
    '- 응답은 설명 없이 완성된 본문 텍스트만 출력한다.',
  ].join('\n');

  const userMessage = [
    '원문 메시지:',
    message,
    '',
    '녹여 넣을 개인화 변수: ' + varTokens,
    '',
    '위 변수를 자연스럽게 녹인 본문만 출력하세요.',
  ].join('\n');

  const text = await callAIWithFallback({
    system,
    userMessage,
    maxTokens: 1200,
    temperature: 0.5,
    model: 'sonnet',
    companyId: input.companyId,
    source: 'ai-operator-decorate',
    userId: input.userId,
  });

  const cleaned = String(text || '').trim();
  if (!cleaned) throw new Error('AI 꾸미기 결과가 비어 있습니다. 다시 시도해주세요.');
  return sanitizeForSms(cleaned.slice(0, 2000)).sanitized;
}
