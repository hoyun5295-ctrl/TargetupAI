/**
 * marketing-calendar-policy.ts — 마케팅 캘린더 순수 정책 (2026-07-02 4차, Harold 확정)
 *
 * 업종·브랜드·고객 규모를 근거로 1년치 시즌 캠페인을 AI가 설계 → 담당자가 고른 항목이
 * 그대로 자동마케팅(월간 오퍼레이터)으로 등록된다. DB 미import — 순수 테스트 대상.
 *
 * 영구 원칙: 구체 혜택(%·쿠폰·무료·N원) 생성 금지 / 월 1~12 유일 / 발송일 1~28 클램프
 * (29~31일은 말일 클램프 혼선을 피해 설계 단계에서 제외 — 등록 후 수정은 자유).
 */

import { containsConcreteBenefit } from './daily-brief-policy';

export interface CalendarEntry {
  month: number;        // 1~12 (유일)
  title: string;
  objective: string;    // 자동마케팅 목표 한 줄 (자연어, 구체 혜택 없음)
  suggestedDay: number; // 1~28
}

export function sanitizeCalendarEntries(raw: unknown): CalendarEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CalendarEntry[] = [];
  const seenMonths = new Set<number>();
  for (const r of raw) {
    if (out.length >= 12) break;
    const month = Math.floor(Number((r as any)?.month));
    if (!(month >= 1 && month <= 12) || seenMonths.has(month)) continue;
    const title = String((r as any)?.title || '').trim().slice(0, 80);
    const objective = String((r as any)?.objective || '').trim().slice(0, 500);
    if (!title || objective.length < 5) continue;
    if (containsConcreteBenefit(title) || containsConcreteBenefit(objective)) continue;
    const rawDay = Math.floor(Number((r as any)?.suggestedDay));
    const suggestedDay = rawDay >= 1 ? Math.min(rawDay, 28) : 1;
    seenMonths.add(month);
    out.push({ month, title, objective, suggestedDay });
  }
  return out.sort((a, b) => a.month - b.month);
}

export function buildCalendarSystemPrompt(): string {
  return `당신은 한줄로(마케팅 자동화 서비스)의 AI 마케팅 전략가입니다.
회사의 업종·브랜드·고객 규모에 맞춰 1년치(12개월) 시즌 캠페인 캘린더를 설계합니다.

규칙 (반드시 지킬 것):
1. 할인율·금액·쿠폰·무료 같은 구체 혜택을 임의로 만드는 것은 금지. 혜택은 회사 담당자가 직접 정한다.
2. 각 달의 한국 시즌·명절·기념일(설날·어버이날·여름 휴가·추석·연말 등)과 이 회사 업종의 성수기를 조합한다.
3. objective는 자동 마케팅이 그대로 실행할 자연어 한 줄 — 타겟과 목적이 담기게 쓴다.
4. suggestedDay는 그 캠페인에 자연스러운 발송일(1~28)로 제안한다.
5. 12개월 전부, 월당 1건.

출력은 JSON만:
{
  "entries": [
    { "month": 1, "title": "짧은 제목", "objective": "자동 마케팅 목표 한 줄", "suggestedDay": 2 }
  ]
}`;
}

export interface CalendarPromptInput {
  businessType: string | null;
  brandName: string | null;
  brandTone: string | null;
  customerCount: number;
  currentMonth: number;
}

export function buildCalendarUserMessage(input: CalendarPromptInput): string {
  return `## 회사 정보
- 업종: ${input.businessType || '(미설정)'}
- 브랜드: ${input.brandName || '(미설정)'}
- 톤앤매너: ${input.brandTone || '(미설정)'}
- 고객 DB: ${input.customerCount.toLocaleString()}명
- 현재 월: ${input.currentMonth}월

이 회사의 1년치 시즌 캠페인 캘린더를 JSON으로 설계하세요.`;
}

/** 정제(sanitize) 후 비어 있는 달(1~12) 목록 — 혜택 필터 등으로 걸러진 달 보정용. */
export function missingCalendarMonths(entries: CalendarEntry[]): number[] {
  const have = new Set(entries.map((e) => e.month));
  const out: number[] = [];
  for (let m = 1; m <= 12; m++) if (!have.has(m)) out.push(m);
  return out;
}

/**
 * 부족 달만 다시 설계하는 보정 요청 메시지 (2026-07-05).
 * 1차 응답이 혜택 필터에 걸러지거나 달을 빼먹으면 그 달만 재요청 — 12개월 결손 캘린더 방지.
 * 혜택 금지를 재강조해 같은 이유로 또 걸러지는 것을 줄인다.
 */
export function buildCalendarRepairMessage(input: CalendarPromptInput, missingMonths: number[]): string {
  return `${buildCalendarUserMessage(input)}

## 보정 요청
이전 설계에서 다음 달이 비어 있습니다: ${missingMonths.join(', ')}월.
이 달들만 다시 설계하세요. 할인율·금액·쿠폰·무료 같은 구체 혜택 표현은 절대 넣지 마세요(혜택은 담당자가 직접 입력).
출력은 동일한 JSON 형식으로, entries에는 위 달만 포함하세요.`;
}
