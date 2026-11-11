/**
 * journey-ai-copy.ts — 여정 AI 글의 변수 꼴 CT(★ 2026-11-11 C126 D5 · 설계서 docs/2026-11-11-journey-recheck-design.md §4-5)
 *
 * 여정 문안 = %변수% 한 가지(★ 1110 C122 ④). 그때는 **새로 쓰는** 생산자 넷에만 변환을 넣었고, **고치는** 자리 넷(칸 다듬기 · 스팸 재작성 ·
 *   A/B 문안 · AI 수정)에는 관문이 없어 AI 가 낸 템플릿 문법이 그대로 응답 · 저장됐다(같은 여정 안에서 칸마다 변수 표기가 다른 접수의 다른 입구).
 *
 * 규칙 둘 — 생산자는 이 파일의 함수만 부른다(`liquidCopyToPercent` 직접 호출 0 · 계약 시험):
 *   · 쓰기  = journeyNewCopy(AI 글)                = C122 ④ 그대로(아는 고객 변수 → %변수% · 그 밖 템플릿 문법 = else 갈래만 평문 · 장바구니 문법 보존)
 *   · 고치기 = journeyRevisedCopy(AI 글, 원문)       = 원문 보존. 쓸 수 없는 안 = null(조건문을 평문으로 접지 않는다 — 접으면 원문 사실이 지워진 안이 통과한다)
 *     ① 둘 다 템플릿 문법 없음 → 글자 그대로
 *     ② 원문에 태그({% … %})가 하나라도 있으면 → 결과가 원문과 글자 그대로 같을 때만 통과 = **조건 태그가 든 글은 AI 가 고치지 않는다**
 *        (갈래마다 받는 사람이 다른 글 · 사실 CT 는 글 전체 단위라 숫자 · 혜택이 어느 갈래에 있는가를 못 지킨다 · Codex 설계 3R ~ 7R)
 *     ③ 원문에 없던 {{ customer.<아는 칸> … }} 출력 → %표시명%(1 대 1 · 원문에 글자 그대로 있던 출력은 둔다)
 *     ④ 남은 템플릿 토큰 = 전부 출력이어야 하고(태그 = 새 조건문 = null) 그 순서열이 원문의 출력 순서열과 글자 그대로 같아야 한다
 *     ⑤ 렌더 파서가 못 읽는 글 = null
 *   · 출구 직전 = journeyRevisedKept(최종 글, 원문) — 글자 정리 · 전송자 명칭 붙이기까지 끝난 실제 반환 글이 같은 규칙을 **바꿀 것 없이** 지나야 한다
 *     (정리가 조건식 안 공백을 접거나 `{` 와 `%` 사이 숨은 글자를 지워 새 태그를 만든다 · 회사 이름에 템플릿 문법이 들어 있을 수 있다 · Codex 설계 8R · 9R).
 * 토큰 = 발송 렌더가 쓰는 같은 파서(liquid-templating tokenize) — 정규식으로 따로 해석하지 않는다(1110 교훈).
 */
import { detectLiquidSyntax, liquidCopyToPercent, liquidTokens } from './liquid-templating';
import { CUSTOMER_LIQUID_TO_PERCENT } from './standard-field-map';

/** 조건 태그가 든 원문에 AI 고치기를 눌렀을 때의 안내(다듬기 · A/B · AI 수정 공용 문장) */
export const LIQUID_TAG_NOTICE = '조건문({% %})이 든 문안은 AI 가 고치지 않아요. 직접 고쳐 주세요.';

/** 새로 쓰는 여정 AI 글(만들기 · 기념일 칸 · 직접 만든 칸 · 다음 칸 추천) — C122 ④ 변환 그대로 */
export function journeyNewCopy(aiText: string): string {
  return liquidCopyToPercent(aiText, CUSTOMER_LIQUID_TO_PERCENT);
}

/** 그 글에 태그({% … %})가 있는가 — 렌더 파서가 못 읽는 글도 참(고치지 않는 쪽) */
export function hasLiquidTags(text: string | null | undefined): boolean {
  const t = String(text ?? '');
  if (!detectLiquidSyntax(t)) return false;
  try { return liquidTokens(t).some((k) => k.type === 'tag'); } catch { return true; }
}

/** 고치는 여정 AI 글 — 쓸 수 있으면 (필요한 바꿔 적기를 한) 글 · 쓸 수 없으면 null. 원문이 빈 글이어도 이 함수(빈 칸 다듬기). */
export function journeyRevisedCopy(aiText: string | null | undefined, before: string | null | undefined): string | null {
  const ai = String(aiText ?? '');
  const base = String(before ?? '');
  if (!detectLiquidSyntax(ai) && !detectLiquidSyntax(base)) return ai;
  if (hasLiquidTags(base)) return ai === base ? ai : null;
  let baseOutputs: string[];
  try { baseOutputs = liquidTokens(base).filter((k) => k.type === 'output').map((k) => k.value); } catch { return null; }
  const kept = new Set(baseOutputs);
  const swapped = ai.replace(/\{\{\s*customer\.([A-Za-z0-9_]+)\s*(?:\|[^}]*)?\}\}/g, (whole: string, key: string) => {
    if (kept.has(whole.slice(2, -2).trim())) return whole;
    const name = Object.prototype.hasOwnProperty.call(CUSTOMER_LIQUID_TO_PERCENT, key) ? CUSTOMER_LIQUID_TO_PERCENT[key] : '';
    return name ? `%${name}%` : whole;
  });
  let tokens: ReturnType<typeof liquidTokens>;
  try { tokens = liquidTokens(swapped); } catch { return null; }
  if (tokens.some((k) => k.type === 'tag')) return null;
  const outputs = tokens.filter((k) => k.type === 'output').map((k) => k.value);
  if (outputs.length !== baseOutputs.length || outputs.some((v, i) => v !== baseOutputs[i])) return null;
  return swapped;
}

/** 출구 직전 최종 대조 — 실제 반환 글이 같은 규칙을 바꿀 것 없이 지나는가 */
export function journeyRevisedKept(finalText: string | null | undefined, before: string | null | undefined): boolean {
  const t = String(finalText ?? '');
  return journeyRevisedCopy(t, before) === t;
}
