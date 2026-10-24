/**
 * one-line-ct/questions.ts — 한 줄 입구의 질문 모양 한 곳(★ 2026-10-24 설계서 docs/2026-10-24-automarketing-oneline-design.md §1-2)
 *
 * 질문은 코드가 만든다(AI 0). 답은 서버가 보관한 질문표로만 검증한다(화면이 보낸 질문표를 믿지 않는다).
 * 여정 질문표(journey-interview) · 자동 마케팅 질문표(automarketing-interview)가 같은 모양이다.
 */

export interface LineQuestionOption {
  value: string;
  label: string;
  desc?: string;
  disabled?: boolean;
  reason?: string;
}

export interface LineQuestion {
  id: string;
  kind: 'choice' | 'text' | 'date';
  label: string;
  help?: string;
  options?: LineQuestionOption[];
  /** 미리 채워 둔 답(글 칸 = 사람이 한 줄에 쓴 글 조각) */
  recommended?: string;
  required: boolean;
  placeholder?: string;
  maxLength?: number;
  /** 글 칸의 「없이」 단추(혜택 없이 보내기) — 누르면 빈 글이 답이다 */
  noneLabel?: string;
}

export type LineAnswers = Record<string, string>;

/** (순수) 한 질문의 답 — 답이 없으면 채워 둔 답 · 선택지 밖 · 잠긴 값 · 길이 초과 = 거절 */
export function pickAnswer(q: LineQuestion, answers: LineAnswers): { ok: true; value: string } | { ok: false; error: string } {
  const has = !!answers && Object.prototype.hasOwnProperty.call(answers, q.id);
  const raw = has ? String(answers[q.id] ?? '').trim() : '';
  // 「없이」 단추가 있는 글 칸은 빈 답 자체가 답이다(채워 둔 글로 되돌리지 않는다)
  const value = raw || (has && q.noneLabel ? '' : String(q.recommended ?? '').trim());
  const ask = `「${q.label.replace(/[?？]\s*$/, '')}」에 답해 주세요.`;
  if (q.kind === 'choice') {
    if (!value) return q.required ? { ok: false, error: ask } : { ok: true, value: '' };
    const opt = q.options?.find((o) => o.value === value);
    if (!opt) return { ok: false, error: `${ask} 보기에서 골라 주세요.` };
    if (opt.disabled) return { ok: false, error: opt.reason || `${opt.label}은(는) 지금 고를 수 없어요.` };
    return { ok: true, value };
  }
  if (!value) return q.required && !(has && q.noneLabel) ? { ok: false, error: ask } : { ok: true, value: '' };
  if (q.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, error: `${ask} 날짜로 골라 주세요.` };
  if (q.maxLength && value.length > q.maxLength) return { ok: false, error: `${q.maxLength}자 안으로 적어 주세요.` };
  return { ok: true, value };
}
