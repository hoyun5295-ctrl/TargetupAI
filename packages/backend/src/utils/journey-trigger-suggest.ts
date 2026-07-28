/**
 * 알림톡 템플릿 → 여정 트리거 제안 (2026-07-28)
 *
 * 왜 있나
 *   알림톡은 승인 템플릿이 본체라 AI가 문안을 지을 수 없다. 그래서 자연어로 "알림톡 보내줘"를
 *   시키면 AI가 자유 문안을 써버려 LMS가 됐다(2026-07-27 박성용 접수).
 *   방향을 뒤집는다 — **사용자가 승인 템플릿을 고르고, AI는 그 본문을 읽어 언제 보낼지만 고른다.**
 *
 * 안전 설계 (이 순서를 지킨다)
 *   1. 후보는 **호출자가 준 목록 안에서만** 고른다. 후보 밖 값이 오면 채택하지 않고 null을 돌려준다.
 *      (트리거 = 발송 대상이다. AI가 목록 밖을 지어내면 엉뚱한 사람에게 나간다)
 *   2. 후보는 이미 "템플릿 변수와 호환되는 것"만 걸러져 들어온다(journey-trigger-catalog).
 *      즉 AI가 무엇을 고르든 변수 치환은 깨지지 않는다.
 *   3. 제안일 뿐 저장이 아니다. 사용자가 검토 화면에서 확인한 뒤에야 여정이 만들어진다.
 *
 * 하는 일은 창작이 아니라 분류다 — 후보가 유한하고 근거가 템플릿 본문에 있어 환각 여지가 작다.
 */
import { callAIWithFallback } from '../services/ai';

export interface TriggerCandidate {
  /** 화면·응답에서 쓰는 식별자(카탈로그 key). 이 값 밖은 채택하지 않는다. */
  key: string;
  label: string;
  desc: string;
}

export interface TriggerSuggestion {
  key: string;
  /** 사용자에게 보여줄 한 줄 근거 — 왜 이 트리거인지. */
  reason: string;
  /** 트리거 발생 후 며칠 뒤 보낼지(0 = 즉시). 정보성 알림은 대개 0이다. */
  delayDays: number;
}

const MAX_CONTENT = 1200;

/**
 * 서버가 인정하는 트리거 key 화이트리스트 — 프론트 카탈로그(journey-trigger-catalog.ts)의 key와 동일.
 *
 * 후보 목록은 클라이언트가 보낸다. 그대로 믿으면 조작된 요청으로 금지 트리거까지 추천받을 수 있다
 * (Codex 1R 지적). 그래서 **받은 후보 ∩ 이 목록**만 AI에게 준다.
 * 저장 단계에서 백엔드 extractor가 한 번 더 거르지만, 신뢰 경계는 여기서도 세운다.
 */
const SERVER_TRIGGER_KEYS = new Set([
  'purchase', 'reservation', 'cart', 'shipped',
  'signup', 'dormant', 'birthday', 'points',
]);

/**
 * 템플릿 본문을 읽고 후보 중 하나를 고른다. 고르지 못하면 null(추측하지 않는다).
 */
export async function suggestJourneyTrigger(input: {
  companyId: string;
  templateName: string;
  templateContent: string;
  candidates: TriggerCandidate[];
}): Promise<TriggerSuggestion | null> {
  // 클라이언트가 보낸 후보 ∩ 서버 화이트리스트. 서버가 모르는 key는 여기서 사라진다.
  const candidates = (input.candidates || []).filter((c) => c && c.key && SERVER_TRIGGER_KEYS.has(c.key));
  if (candidates.length === 0) return null;
  const content = String(input.templateContent || '').trim().slice(0, MAX_CONTENT);
  if (!content) return null;

  const list = candidates.map((c) => `- ${c.key}: ${c.label} (${c.desc})`).join('\n');

  const system = [
    '너는 카카오 알림톡 운영 담당자다. 승인된 알림톡 템플릿 본문을 읽고,',
    '그 안내가 "고객에게 어떤 일이 생겼을 때" 나가야 하는지를 고른다.',
    '',
    '규칙:',
    '- 반드시 아래 후보 key 중 하나만 고른다. 후보에 없는 값을 지어내지 않는다.',
    '- 본문 내용으로 판단이 안 서면 key를 빈 문자열("")로 답한다. 억지로 고르지 않는다.',
    '- delayDays는 트리거 발생 후 며칠 뒤 보낼지다. 거래·가입 통지는 0(즉시)이 기본이다.',
    '  안내 성격상 시간을 두는 게 자연스러울 때만 1 이상을 쓴다.',
    '- reason은 담당자에게 보여줄 한 줄이다. 본문의 어떤 표현을 근거로 골랐는지 한국어로 쓴다.',
    '',
    'JSON만 출력한다: {"key":"...","delayDays":0,"reason":"..."}',
  ].join('\n');

  const userMessage = [
    `[템플릿 이름] ${String(input.templateName || '').slice(0, 100)}`,
    '[템플릿 본문]',
    content,
    '',
    '[고를 수 있는 후보]',
    list,
  ].join('\n');

  let text = '';
  try {
    text = await callAIWithFallback({
      system,
      userMessage,
      maxTokens: 500,
      temperature: 0.2,   // 분류 작업 — 흔들리지 않게 낮춘다
      model: 'sonnet',
      companyId: input.companyId,
      source: 'journey-trigger-suggest',
    });
  } catch {
    return null;   // AI 실패는 조용히 미제안 — 사용자는 직접 고르면 된다
  }

  const parsed = parseSuggestion(text);
  if (!parsed) return null;

  // ★ 후보 밖 값은 버린다. AI가 지어낸 트리거가 발송 대상이 되는 일은 없어야 한다.
  const matched = candidates.find((c) => c.key === parsed.key);
  if (!matched) return null;

  return {
    key: matched.key,
    reason: parsed.reason.slice(0, 200),
    delayDays: Math.max(0, Math.min(30, Math.floor(parsed.delayDays))),
  };
}

/** 코드펜스·잡소리가 섞여도 첫 JSON 객체만 뽑아 파싱한다. */
function parseSuggestion(text: string): { key: string; reason: string; delayDays: number } | null {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(raw.slice(start, end + 1));
    const key = String(o?.key || '').trim();
    if (!key) return null;
    return {
      key,
      reason: String(o?.reason || '').trim(),
      delayDays: Number.isFinite(Number(o?.delayDays)) ? Number(o.delayDays) : 0,
    };
  } catch {
    return null;
  }
}
