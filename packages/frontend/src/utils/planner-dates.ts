/**
 * ★ 2026-10-25 원장 #62 — 플래너 시점 하나의 발송일. 서버 utils/marketing-planner.ts computeTouchpointDate 와 같은 식이다.
 *   ⛔ import 0(순수) — 백엔드 계약 시험(root-ledger R1 「플래너 발송일 = 서버 식」)이 이 파일을 직접 불러 서버 식과 같은 입력으로 대조한다.
 *   옛: 화면 sendDateOf 가 「시작 전」 기본값을 3일로 셈(서버 = 0일).
 *   화면만 쓰는 차이 = 날짜 글자가 아니면 null(편집 중 빈 칸 · 서버는 저장된 값만 받는다).
 */
export interface PlannerTimingRule { anchor?: 'start' | 'end' | 'before_start' | string; offsetDays?: number; on?: string | null }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function plannerSendDateOf(timing: PlannerTimingRule, startsOn: string, endsOn: string): string | null {
  if (timing.on && DATE_RE.test(timing.on)) return timing.on;   // ★ 2026-10-18 미룬 날(서버만 쓴다)
  if (timing.anchor === 'end') return DATE_RE.test(endsOn) ? endsOn : null;
  if (timing.anchor === 'before_start') {
    if (!DATE_RE.test(startsOn)) return null;
    const d = new Date(`${startsOn}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (timing.offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }
  return DATE_RE.test(startsOn) ? startsOn : null;
}
