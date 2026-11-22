/**
 * var-tokens.ts — 문안 안 `%변수%` 조각 판정 컨트롤타워 (★ 2026-09-26 한줄로 V2 R269 · 순수 함수)
 *
 * 소비처 = `messageUtils.cleanLeftoverVars`(모든 발송 경로의 잔여 변수 안전망) ·
 *          `agency-send-vars`(대행발송 변수 추출·슬롯 배정).
 * 화면 미러 = frontend `utils/formatDate.ts findVarTokens`(미리보기 = 발송 · 계약 테스트
 *          `__tests__/percent-text-not-variable-0926.test.ts`가 같은 값을 확인한다).
 *
 * - 이름 = 한글·영문·_ 로 시작, % 와 공백이 없는 20자 이내(종전 식 그대로).
 * - **숫자 바로 뒤의 % 는 퍼센트 기호다.** 그 자리에서 시작하는 조각은 변수가 아니다.
 *   `30%할인+10%적립`의 `%할인+10%`를 변수로 읽어 발송 문안이 `30적립`으로 나갔다(고객 문안 무단 변경).
 * - 건너뛸 때는 닫는 % 부터 다시 찾는다 — 그 % 가 다음 변수의 여는 % 일 수 있다(`10%할인%이름%`).
 */

import { detectLiquidSyntax } from './liquid-templating';

export interface VarToken {
  /** 여는 % 위치 */
  start: number;
  /** 닫는 % 다음 위치 */
  end: number;
  /** % 사이 이름 */
  name: string;
}

export function findVarTokens(text: string): VarToken[] {
  const out: VarToken[] = [];
  if (!text) return out;
  const re = /%([가-힣A-Za-z_][^%\s]{0,19})%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > 0 && /[0-9]/.test(text[start - 1])) {
      re.lastIndex = end - 1;
      continue;
    }
    out.push({ start, end, name: m[1] });
  }
  return out;
}

/**
 * ★ 2026-11-02 보내면 빈칸이 될 %변수% 이름 — 치환(messageUtils replaceVariables 2단계 = 매핑 이름마다 `%이름%` · 남은 조각 = cleanLeftoverVars 가 지움)과
 *   같은 쪼개기(findVarTokens) · 넘긴 이름 = 그 회사 매핑 이름(prepareFieldMappings 의 키 · 여정 렌더가 쓰는 것과 같은 값) · 설계서 3-13 · CT-J10.
 */
export function unknownVarNames(text: string | null | undefined, knownNames: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const t of findVarTokens(String(text || ''))) if (!knownNames.has(t.name) && !out.includes(t.name)) out.push(t.name);
  return out;
}

/** 조각마다 바꿀 값을 받아 문장을 다시 잇는다(값이 undefined면 그 조각은 원문 그대로) */
export function replaceVarTokens(text: string, fn: (name: string) => string | undefined): string {
  if (!text) return '';
  let out = '';
  let pos = 0;
  for (const t of findVarTokens(text)) {
    const v = fn(t.name);
    out += text.slice(pos, t.start) + (v === undefined ? text.slice(t.start, t.end) : v);
    pos = t.end;
  }
  return out + text.slice(pos);
}

// ── ★ 2026-11-22 C157 본문에 「발송 치환이 바꿀 것」이 있는가(설계서 docs/2026-11-22-c157-ask-send-options-design.md §2 S4-b) ──

/**
 * 치환 0단계(messageUtils.replaceVariables)가 **글자 그대로** 바꾸는 주소록 칸 이름 — 숫자 바로 뒤여도 바뀐다(`/%이름%/g` 꼴).
 *   ⛔ 이 목록 = 치환 코드의 0단계 리터럴과 같은 집합이어야 한다(계약 시험이 messageUtils 소스에서 리터럴을 뽑아 대조한다).
 */
export const STEP0_VAR_NAMES = ['기타1', '기타2', '기타3', '회신번호', '이름', '고객명', '성함'] as const;

/**
 * 본문에 발송 치환이 바꿀 변수가 있는가 — 치환의 단계마다 같은 방식으로 본다.
 *   0단계 = 주소록 칸 이름의 `%이름%` 글자 대조 · 2단계 = 그 회사 매핑 이름마다 `%이름%` 글자 대조(치환이 split 으로 바꾸는 것과 같은 방식 =
 *   숫자 뒤 여부를 보지 않는다) · 3단계 = 남은 조각(findVarTokens) · Liquid.
 *   any = 넷 가운데 하나라도 · needsCustomer = 고객 원장의 그 행을 찾아야 채워지는 것(0단계 이름이 아닌 매핑 이름 · Liquid — 이름 · 주소록 칸은 적재 줄에서 채워진다).
 *   매핑 이름들 = prepareFieldMappings(회사)의 키(확정 · 일꾼이 쓰는 같은 함수).
 */
export function sendBodyVars(text: string | null | undefined, mappingNames: Iterable<string>): { any: boolean; needsCustomer: boolean } {
  const t = String(text || '');
  if (!t) return { any: false, needsCustomer: false };
  const has = (name: string) => t.includes(`%${name}%`);
  const step0 = new Set<string>(STEP0_VAR_NAMES);
  let any = STEP0_VAR_NAMES.some(has);
  let needsCustomer = false;
  for (const name of mappingNames) {
    if (!name || !has(name)) continue;
    any = true;
    if (!step0.has(name)) needsCustomer = true;
  }
  const liquid = detectLiquidSyntax(t);
  return { any: any || liquid || findVarTokens(t).length > 0, needsCustomer: needsCustomer || liquid };
}
