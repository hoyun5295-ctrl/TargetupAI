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
