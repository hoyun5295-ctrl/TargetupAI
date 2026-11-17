/**
 * utils/line-trial.ts — 대시보드 한 줄 배너(7일 무료체험)의 화면 쪽 순수 규칙 (★ 2026-11-17 C140 · 설계서 docs/2026-11-17-line-trial-banner-design.md §4-3)
 *
 * 배너에 적은 한 줄을 직접발송 창의 AI 다듬기로 넘기는 규칙을 한 곳에 둔다(배너 · 대시보드 · 점검 훅이 같이 쓴다).
 *   - 그릴지 말지 · 체험 지급 = 서버(GET /api/marketing-diagnosis/state 의 banner · POST /trial/start). 여기에는 판정이 없다.
 *   - 순수 함수만(backend vitest 가 직접 불러 시험한다).
 * ⛔ 줄표 0 · 모델명 0.
 */

/** 배너 입력칸 상한(글자) */
export const LINE_TRIAL_MAX = 80;

/** 입력 정리 — 앞뒤 빈칸을 뗀 값. 빈 값이면 체험 시작을 요청하지 않는다 */
export function normalizeLine(raw: string | null | undefined): string {
  return String(raw ?? '').trim().slice(0, LINE_TRIAL_MAX);
}

/**
 * 넘김 규칙 — 직접발송 창이 배너의 한 줄을 받았을 때.
 *   snapshot = 넘김의 AI 다듬기 창의 원문(그 창을 닫거나 안을 적용할 때까지 그대로 · 스냅샷이 있는 동안만 그 창이 놓인다)
 *   fillBody = 본문 칸이 비어 있을 때만 그 한 줄을 본문에도 넣는다(쓰던 글은 말없이 덮지 않는다)
 * 넘김 값이 없으면 null(아무 일도 하지 않는다 = 평소의 직접발송 창).
 */
export function planRefineHandoff(body: string, line: string | null | undefined): { snapshot: string; fillBody: boolean } | null {
  const snapshot = normalizeLine(line);
  if (!snapshot) return null;
  return { snapshot, fillBody: body.trim().length === 0 };
}

/** 체험 중 모양의 작은 글 — 날 수는 서버가 센 값(GET /state 의 bannerDaysLeft · 0 = 오늘이 마지막 날) */
export function trialLeftLabel(daysLeft: number | null | undefined): string {
  if (typeof daysLeft !== 'number' || !Number.isFinite(daysLeft) || daysLeft < 0) return '무료체험 진행 중';
  return daysLeft === 0 ? '무료체험 오늘까지' : `무료체험 ${Math.floor(daysLeft)}일 남음`;
}
