/**
 * utils/ai-credit-price.ts — 기능 금액 규칙 한 곳(★ 2026-11-01 크레딧 컨트롤타워 설계서 §16-3 · P3 · Harold 「여러곳에서 사용할 기능은 컨트롤타워화」)
 *
 * 기능(한 줄 · AI 한줄로 · 목소리 배우기 · 빠른 제작 · 플래너 견적)은 「무엇을 했나」(이미 낸 판단 · 완성 · 같은 날 같은 한 줄 · 채널 · 크레딧제 여부)만 넘기고,
 * 금액은 여기서 단가표(CREDIT_COST_MAP)로만 정한다(숫자 0 · 옛: 한 줄 단가 2 · 15 · 3 이 one-line-steps.ts 에 박혀 단가표와 두 벌이었다).
 */
import { getCreditCost } from './ai-credit-calc';

// ── 견적 · 청구 공통 ──
/** 이 일의 금액 — 크레딧제가 아닌 회사(applies false) · 이미 낸 일(paid) = 0 · 그 밖 = 원천 단가 */
export function duePrice(key: string, f: { applies?: boolean; paid?: boolean }): number {
  return f.applies === false || f.paid ? 0 : getCreditCost(key);
}

// ── 한 줄(문자 · DM · 이메일 · 인앱 · 입구 무관 · ★ 1022 Harold 확정 규칙) ──
const LINE = { judge: 'oneline-judge', complete: 'oneline-complete', recook: 'oneline-recook' } as const;

/** 한 줄 단가 묶음(판단 · 판단 + 첫 결과물 합계 · 다시 만들기) — 화면 · 견적 표시 */
export function linePriceTable(): { judge: number; total: number; again: number } {
  const judge = getCreditCost(LINE.judge);
  return { judge, total: judge + getCreditCost(LINE.complete), again: getCreditCost(LINE.recook) };
}

/** 이번 한 줄 생성의 금액 · 원천 — 오늘(또는 어제) 이 한 줄로 완성을 냈으면 다시 만들기 · 아니면 첫 결과물(판단을 이미 냈으면 그 몫은 빼고) */
export function lineStepsPrice(completionPaid: boolean, judgePaid: boolean): { cost: number; source: string; completionDue: boolean } {
  if (completionPaid) return { cost: getCreditCost(LINE.recook), source: LINE.recook, completionDue: false };
  return { cost: getCreditCost(LINE.complete) + (judgePaid ? 0 : getCreditCost(LINE.judge)), source: LINE.complete, completionDue: true };
}

// ── AI 한줄로 ──
/** 기본(대상 찾기) 금액 — 같은 날 같은 한 줄로 이미 냈으면 0 */
export function aiLineBasePrice(basePaid: boolean): number {
  return duePrice('ai-line-intake', { paid: basePaid });
}
/** 문안 금액 = 기본 + 문안 종류마다 단가 */
export function aiLineComposePrice(copyCount: number, basePaid: boolean): { base: number; copies: number; total: number } {
  const base = aiLineBasePrice(basePaid);
  const copies = Math.max(0, Math.floor(copyCount)) * getCreditCost('ai-line-compose');
  return { base, copies, total: base + copies };
}

// ── 목소리 배우기 ──
/** 배우기 = 추출 + 견본(견본 금액 = 문안 생성 단가) */
export function brandVoicePrices(): { extract: number; sample: number; learn: number } {
  const extract = getCreditCost('brand-voice-extract');
  const sample = getCreditCost('generate-messages');
  return { extract, sample, learn: extract + sample };
}

// ── 빠른 제작 · 플래너 ──
/** 생성 원천 — 카탈로그 = 카탈로그 DM 생성 · 이메일 = 이메일 생성 · 그 밖 = DM 생성 */
export function genSourceOf(channel: string): string {
  return channel === 'catalog' ? 'catalog-dm-build' : channel === 'email' ? 'email-ai-generate' : 'dm-ai-generate';
}
/** 생성 원천 · 금액 */
export function quickGenPrice(channel: string): { key: string; cost: number } {
  const key = genSourceOf(channel);
  return { key, cost: getCreditCost(key) };
}
/** 채널 소재 제작 견적(플래너 승인 화면 · 플래너 설계서 §3-2) — 이메일 = 완성 · DM = 생성 + 발행 한 세트 · 인앱 = 발행 · 그 밖(문자 · 알림톡) = 실행 때 따로(null · 0 과 다르다) */
export function channelMakePrice(channel: string): number | null {
  switch (channel) {
    case 'email': return getCreditCost('email-campaign-complete');
    case 'dm': return getCreditCost('dm-ai-generate') + getCreditCost('dm-builder');
    case 'inapp': return getCreditCost('inapp-publish');
    default: return null;
  }
}
