/**
 * agency-send-vars.ts — 대행발송 문안 변수의 슬롯 배정 (★ 2026-08-23 신설 · 순수 함수)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §12 정정. 불변 4(치환 CT는 하나)를 지키기 위한 번역기다.
 *
 * **왜 필요한가.** 발송 경로의 유일한 치환 함수 `replaceVariables`는 수신자 데이터를
 * **DB 컬럼 이름**으로 찾는다(`customer[mapping.column]`). 그런데 대행발송 접수 화면은
 * 문안에서 뽑은 **변수 이름**(`이름`·`등급`·`쿠폰`)을 키로 수신자 값을 모은다.
 * 그래서 키가 서로 만나지 못하고, 치환은 전부 실패한 뒤 안전망이 `%...%`를 지워
 * **모든 변수가 빈 문자열로 발송되고 있었다**(`%이름%님` → `님`).
 *
 * 고치는 방향은 새 치환 함수가 아니라 **직접발송과 같은 자리에 값을 얹는 것**이다.
 * 직접발송은 업로드 명단의 값을 주소록 슬롯(`이름`·`기타1~3`)으로 넘긴다.
 * 여기서 문안 변수를 그 슬롯으로 번역해 두면, 검사·테스트 문자·본 발송이 전부 같은 CT를 지난다.
 *
 * ⛔ 슬롯은 네 칸뿐이다. 접수에서 그 이상을 막는다(발송 직전에 조용히 잘리면 안 된다).
 */

/** 주소록 슬롯 순서. 직접발송이 쓰는 이름 그대로다(`messageUtils.replaceVariables` 0단계) */
export const SLOT_VARS = ['이름', '기타1', '기타2', '기타3'] as const;
export type SlotVar = (typeof SLOT_VARS)[number];

/** 한 접수가 쓸 수 있는 문안 변수 개수 */
export const MAX_AGENCY_VARS = SLOT_VARS.length;

/**
 * 문안에서 변수를 뽑는다. 패턴은 `messageUtils.cleanLeftoverVars`와 **같아야 한다** —
 * 다르면 "여기서는 변수가 아닌데 발송 직전에 지워지는" 문자열이 생긴다.
 * 등장 순서를 지키고 중복은 한 번만 센다.
 */
const VAR_RE = /%([가-힣A-Za-z_][^%\s]{0,19})%/g;

export function extractAgencyVars(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(content || '').matchAll(VAR_RE)) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export interface SlotPlan {
  ok: boolean;
  error?: string;
  /** 문안 변수명 → 슬롯 이름 */
  slots: Record<string, SlotVar>;
  /** 슬롯 이름으로 바꾼 문안. 검사·테스트 문자·큐 적재가 이것을 쓴다 */
  slotContent: string;
  /** 슬롯 순서대로 나열한 원래 변수명. 수신자 값을 뽑을 때 쓴다 */
  order: string[];
}

/**
 * 문안 변수를 주소록 슬롯에 배정하고, 슬롯 이름으로 바꾼 문안을 함께 돌려준다.
 *
 * ⛔ 치환은 **한 번의 순회**로 한다. 순차로 돌리면 `%기타1%`을 `%이름%`으로 바꾼 결과를
 *   다음 회차가 다시 집어 서로를 덮어쓴다(변수 이름이 슬롯 이름과 겹칠 때 실제로 일어난다).
 */
export function buildSlotPlan(content: string): SlotPlan {
  const order = extractAgencyVars(content);
  if (order.length > MAX_AGENCY_VARS) {
    return {
      ok: false,
      error: `문안에 넣을 항목은 ${MAX_AGENCY_VARS}개까지입니다. 지금 ${order.length}개를 쓰고 있습니다.`,
      slots: {}, slotContent: String(content || ''), order,
    };
  }

  const slots: Record<string, SlotVar> = {};
  order.forEach((name, i) => { slots[name] = SLOT_VARS[i]; });

  const slotContent = String(content || '').replace(
    VAR_RE,
    (whole, name: string) => (slots[name] ? `%${slots[name]}%` : whole),
  );

  return { ok: true, slots, slotContent, order };
}

/**
 * 문안 항목 이름과 같은 이름의 명단 열을 찾는다(공백만 무시).
 * 화면 접수(AgencySendComposer)가 같은 규칙을 미러로 갖고 있다 — 규칙을 바꾸면 양쪽을 함께 바꾼다.
 */
export function sameNameColumn(headers: string[], varName: string): string | null {
  const key = String(varName || '').replace(/\s+/g, '');
  return headers.find((h) => String(h || '').replace(/\s+/g, '') === key) || null;
}

export interface VarColumnResolution {
  name: string;
  column: string | null;
  /** same = 같은 이름 자동 · override = 확인 화면에서 고른 열 · ai = AI 추천(라우트가 얹는다) */
  via: 'same' | 'override' | 'ai' | null;
}

/**
 * 문안 항목을 명단 열에 잇는다. 우선순위 = 확인 화면 조정값 > 같은 이름.
 * ⛔ 조정값이 명단에 없는 열이면 **폴백하지 않고** badOverrides로 돌려준다
 *   (사용자가 본 것과 다른 열로 접수되면 안 된다 · 원스텝 ★Codex 적대 2R 계약과 같은 선).
 */
export function resolveVarColumns(
  vars: string[], headers: string[], overrideMap?: Record<string, string> | null,
): { resolved: VarColumnResolution[]; badOverrides: string[] } {
  const badOverrides: string[] = [];
  const resolved = vars.map((name): VarColumnResolution => {
    const pick = overrideMap && typeof overrideMap === 'object' ? overrideMap[name] : undefined;
    if (pick !== undefined && pick !== null && String(pick) !== '') {
      if (headers.includes(String(pick))) return { name, column: String(pick), via: 'override' };
      badOverrides.push(name);
      return { name, column: null, via: null };
    }
    const same = sameNameColumn(headers, name);
    return same ? { name, column: same, via: 'same' } : { name, column: null, via: null };
  });
  return { resolved, badOverrides };
}

/** 수신자 한 명의 값(변수명 키)을 슬롯 자리로 옮긴다. 직접발송 staging의 컬럼 순서와 같다 */
export interface SlotValues {
  name: string;
  extra1: string;
  extra2: string;
  extra3: string;
}

export function toSlotValues(vars: Record<string, any> | null | undefined, order: string[]): SlotValues {
  const pick = (i: number): string => {
    const key = order[i];
    if (!key) return '';
    const v = (vars || {})[key];
    return v === null || v === undefined ? '' : String(v);
  };
  return { name: pick(0), extra1: pick(1), extra2: pick(2), extra3: pick(3) };
}
