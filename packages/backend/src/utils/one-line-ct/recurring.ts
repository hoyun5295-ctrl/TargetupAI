/**
 * one-line-ct/recurring.ts — 한 번 만들면 계속 나가는 입구(여정 · 자동마케팅)의 한 줄 점검(★ 2026-10-23 설계서 docs/2026-10-23-oneline-ct-complete-design.md C1)
 *
 * ③ 진단의 반복 발송 판. 막지 않는다(안내 문장만 · AI 0 · DB 0 · 0원). 한 줄 판정(gaps)이 menu = journeys(여정) · auto-send(자동발송 설정 창) 일 때 싣는다.
 *   ① 지나가는 날짜 말 — 다음 발송에도 같은 말이 나간다
 *   ② 행사 말인데 혜택 값 없음 — 자동마케팅은 AI 가 지어 쓴 혜택이 자리표시가 되고 채우지 않으면 그 회차가 멈춘다(auto-campaign-worker 발송 길목)
 *   ③ 혜택 값이 있음 — 그 혜택만 실린다(자동마케팅 발송 근거 = 컨셉 글 · 여정 근거 = 한 줄)
 */
import type { LineIntent } from './listen';

export type RecurringEntrance = 'journeys' | 'auto-send';
export interface RecurringNote { kind: 'passing_date' | 'benefit_missing' | 'benefit_fixed'; text: string }

/** (순수) 의도 → 안내 문장(없으면 빈 배열) */
export function checkRecurringLine(intent: LineIntent, entrance: RecurringEntrance): RecurringNote[] {
  const out: RecurringNote[] = [];
  if (!intent.typed.trim()) return out;
  const when = entrance === 'journeys' ? '여정은 조건이 맞을 때마다' : '자동 발송은 회차마다';
  if (intent.passingDates.length > 0) {
    out.push({ kind: 'passing_date', text: `${when} 나가요. 「${intent.passingDates[0]}」 같은 날짜 말은 다음 발송에도 그대로 나가니 빼 두세요` });
  }
  if (intent.gaps.benefit) {
    out.push({
      kind: 'benefit_missing',
      text: entrance === 'auto-send'
        ? '혜택 문구를 컨셉에 적어 두세요. AI 가 혜택을 지어 쓰면 그 자리는 비워지고, 채우지 않으면 그 회차는 나가지 않아요'
        : '혜택 문구가 없어요. 만든 뒤 혜택 칸에서 채워 주세요',
    });
  } else if (intent.benefit) {
    out.push({ kind: 'benefit_fixed', text: `적어 주신 혜택만 실어요: 「${intent.benefit}」` });
  }
  return out;
}
