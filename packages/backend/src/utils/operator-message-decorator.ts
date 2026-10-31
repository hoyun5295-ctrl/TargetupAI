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

import { UserFacingError } from './http-error';
import { callAIWithFallback } from '../services/ai';
import { runChargedAi } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { sanitizeForSms } from './message-sanitizer';
import { extractJsonFromAiText } from './ai-json';
// ★ 2026-09-30 WP2 — 꾸미기는 변수만 녹인다. 원문에 없던 사실이 생겼는가(지시는 확률적 · 서버가 다시 본다).
// ★ 2026-10-24 세 채널 구조체크 ② — 판정 = CT rewriteAddsFacts(숫자 ∥ 혜택 ∥ 효능 · 옛 손 판정 decoratedAddsFacts 삭제)
import { rewriteAddsFacts, EFFICACY_REWRITE_RULE } from './copy-benefit-detector';
import { rewriteDropsLinks } from './voice-form-slots';

export interface DecorateMessageInput {
  companyId: string;
  message: string;
  /** 녹여 넣을 개인화 변수 이름(표시명, 예: '고객명' '포인트') — % 없이 전달 */
  selectedVars: string[];
  channel: 'sms' | 'lms' | 'mms';
  isAd: boolean;
  userId?: string;
}

/**
 * 여러 변형(생성된 3개 문안)에 동일 컬럼 체크집합을 한 번의 AI 호출로 일괄 적용.
 *   - 꾸미기 1회(3개 처리) = 1 호출 = 3크레딧(액션 단위, 변형당 차감 X — source 'ai-operator-decorate' 단일 호출).
 *   - 체크된 변수는 각 문안에 모두 포함, 목록에 없는 변수는 제거(A7 정확 집합).
 *   - 파싱 실패·개수 불일치 시 해당 인덱스는 원문 유지(발송 영향 0).
 * ★ 2026-10-25 원장 #39 · Z4 — 돈 = AI 결과 정산 한 곳(runChargedAi): 바뀐 안이 하나라도 있을 때만 3크레딧 · 전부 원문 유지 = 0원.
 *   옛: 응답을 받는 순간 3크레딧 · 파싱 실패 · 사실 추가로 버린 안도 걷고 알리지 않았다. 원문으로 둔 안의 순번 = kept(화면이 알린다).
 *   바깥 묶음(AI 한줄로 만들기 · 꾸미기) 안에서 부르면 걷지 않는다(바깥이 자기 키로 걷는다).
 */
export async function decorateOperatorMessages(
  input: Omit<DecorateMessageInput, 'message'> & { messages: string[] },
): Promise<{ messages: string[]; kept: number[]; charged: boolean }> {
  const vars = (input.selectedVars || [])
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim().replace(/%/g, ''));
  if (vars.length === 0) throw new UserFacingError(400, 'DECORATE_INPUT', '활용할 고객 정보를 1개 이상 골라 주세요.');

  const msgs = (input.messages || []).map((m) => String(m || '').trim()).filter((m) => m.length >= 5);
  if (msgs.length === 0) throw new UserFacingError(400, 'DECORATE_INPUT', '꾸밀 문자가 너무 짧아요.');

  const channel = (['sms', 'lms', 'mms'] as const).includes(input.channel as any) ? input.channel : 'lms';
  const maxBytes = channel === 'sms' ? 90 : 2000;
  const varTokens = vars.map((v) => '%' + v + '%').join(', ');

  const system = [
    '당신은 한줄로의 메시지 개인화 편집기입니다. 여러 마케팅 문구 각각을 자연스럽게 다시 써서, 지정된 개인화 변수를 문맥에 녹여 넣습니다.',
    '',
    '규칙:',
    EFFICACY_REWRITE_RULE,
    '- 반드시 다음 변수만 사용한다(다른 변수를 새로 만들지 말 것): ' + varTokens,
    '- 위 변수는 각 문안에 모두 반드시 포함한다(누락 금지, 자연스러운 위치에 녹임). 목록에 없는 %변수%는 본문에서 제거한다.',
    '- 변수는 ' + '"%변수%"' + ' 형태 그대로 쓴다.',
    '- 원문의 의도·톤·핵심 메시지는 유지한다. 원문에 없는 사실/정보를 새로 만들지 않는다.',
    '- 구체 혜택(%·원·쿠폰·무료·할인·적립·사은품·무료배송)은 절대 임의로 쓰지 않는다. 원문에 있던 혜택 표현만 유지한다.',
    '- (광고) 접두사·무료수신거부 번호·제목은 시스템이 자동 합성하므로 본문에 직접 쓰지 않는다.',
    '- ' + channel.toUpperCase() + ' 분량(약 ' + maxBytes + ' bytes 이내)을 각 문안마다 지킨다.',
    '- 이모지와 통신사 미지원 특수문자는 쓰지 않는다.',
    '- 응답은 설명 없이 JSON 문자열 배열만 출력한다. 예: ["문안1", "문안2"] (입력과 같은 순서·개수).',
  ].join('\n');

  const userMessage = [
    '다음 ' + msgs.length + '개 문안 각각에 위 변수를 녹여 재작성하세요. 입력과 같은 순서·개수의 JSON 문자열 배열로만 출력하세요.',
    '',
    ...msgs.map((m, i) => '[' + (i + 1) + ']\n' + m),
  ].join('\n');

  const { result, charged } = await runChargedAi({
    companyId: input.companyId,
    cost: getCreditCost('ai-operator-decorate'),
    source: 'ai-operator-decorate',
    createdBy: input.userId || null,
    run: async () => {
      const text = await callAIWithFallback({
        system,
        userMessage,
        maxTokens: 2000,
        temperature: 0.5,
        model: 'sonnet',
        companyId: input.companyId,
        source: 'ai-operator-decorate',
        userId: input.userId,
      });
      let arr: unknown = null;
      try {
        arr = extractJsonFromAiText(String(text || ''));
      } catch {
        arr = null;
      }
      const kept: number[] = [];
      const messages = msgs.map((orig, i) => {
        const cand = Array.isArray(arr) ? arr[i] : undefined;
        // ★ 2026-09-30 WP2 — 원문에 없던 숫자 · 혜택 값이 생긴 문안은 원문 유지(파싱 실패와 같은 처리 · 발송 영향 0)
        const ok = typeof cand === 'string' && cand.trim().length >= 5 && !rewriteAddsFacts(cand.trim(), orig);
        const origOut = sanitizeForSms(orig.slice(0, 2000)).sanitized;
        const decorated = ok ? (cand as string).trim() : orig;
        const made = sanitizeForSms(decorated.slice(0, 2000)).sanitized;
        // ★ 2026-10-31 원문 주소가 빠진(잘리거나 바뀐) 안 = 원문 유지(설계서 docs/2026-10-31-ai-line-answer-link-design.md P6 · 판정 = 자르기 · 정제 뒤 최종 글)
        const linkKept = !ok || !rewriteDropsLinks(made, origOut);
        const out = linkKept ? made : origOut;
        // ★ 1026 Codex 1R — 원문과 같은 글이면 바뀐 안이 아니다(옛: 그대로 돌려준 안도 꾸민 안으로 세어 걷었다)
        if (!ok || !linkKept || out === origOut) kept.push(i);
        return out;
      });
      return { messages, kept };
    },
    accept: (r) => r.kept.length < msgs.length,
  });
  return { messages: result.messages, kept: result.kept, charged };
}
