import { creditText } from '../constants/credit';

/**
 * ★ 2026-10-25 원장 #39 — 꾸미기(/api/ai/operator/decorate-message) 응답을 화면 한 줄로.
 *   서버는 바뀐 안이 있을 때만 차감하고(charged) 원문으로 둔 안의 순번(kept) · 알림(notes)을 준다.
 *   옛: 다섯 화면이 응답과 상관없이 「적용했습니다 (3크레딧)」이라 말했다.
 */
export function decorateOutcome(data: any): { changed: boolean; kept: number[]; text: string; tone: 'success' | 'info' } {
  const kept: number[] = Array.isArray(data?.kept) ? data.kept.filter((n: any) => Number.isInteger(n)) : [];
  const note = Array.isArray(data?.notes) && data.notes[0] ? String(data.notes[0]) : '';
  if (!data?.charged) {
    return { changed: false, kept, text: note || '바뀐 문안이 없어 원문 그대로 두었어요. 크레딧은 빠지지 않았어요.', tone: 'info' };
  }
  return { changed: true, kept, text: `꾸미기를 적용했어요 (${creditText('ai-operator-decorate')})${note ? ` · ${note}` : ''}`, tone: note ? 'info' : 'success' };
}
