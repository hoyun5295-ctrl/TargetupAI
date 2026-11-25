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

import { findVarTokens, replaceVarTokens } from './var-tokens';
import { getFieldByKey } from './standard-field-map';
import { agencyCellIsMobile } from './agency-send-form';

/** 주소록 슬롯 순서. 직접발송이 쓰는 이름 그대로다(`messageUtils.replaceVariables` 0단계) */
export const SLOT_VARS = ['이름', '기타1', '기타2', '기타3'] as const;
export type SlotVar = (typeof SLOT_VARS)[number];

/** 한 접수가 쓸 수 있는 문안 변수 개수 */
export const MAX_AGENCY_VARS = SLOT_VARS.length;

/**
 * 문안에서 변수를 뽑는다. 판정은 `messageUtils.cleanLeftoverVars`와 **같아야 한다** —
 * 다르면 "여기서는 변수가 아닌데 발송 직전에 지워지는" 문자열이 생긴다.
 * ★ 2026-09-26 한줄로 V2 R269 — 그래서 두 곳 모두 조각 판정 CT(`var-tokens.ts findVarTokens`)를 부른다
 *   (숫자 바로 뒤 %는 퍼센트 기호: `30%할인+10%적립`이 변수 칸을 먹지 않는다).
 * 등장 순서를 지키고 중복은 한 번만 센다.
 */
export function extractAgencyVars(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of findVarTokens(String(content || ''))) {
    const name = t.name;
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

  const slotContent = replaceVarTokens(
    String(content || ''),
    (name) => (slots[name] ? `%${slots[name]}%` : undefined),
  );

  return { ok: true, slots, slotContent, order };
}

/**
 * 문안 항목 이름과 같은 이름의 명단 열을 찾는다(공백만 무시).
 * 화면 접수(AgencySendComposer)가 같은 규칙을 미러로 갖고 있다 — 규칙을 바꾸면 양쪽을 함께 바꾼다.
 * (같은 뜻 이름 synonymColumn 은 서버가 분석하는 입구(메일 · 원스텝)에만 있다 — 화면 접수는 사용자가 연결 표에서 열을 고른다)
 */
export function sameNameColumn(headers: string[], varName: string): string | null {
  const key = String(varName || '').replace(/\s+/g, '');
  return headers.find((h) => String(h || '').replace(/\s+/g, '') === key) || null;
}

/**
 * ★ 2026-11-25(2) 같은 뜻 이름의 열 — Harold 「이름 고객명정도는 붙여줘도 되는거아니냐? 원하는게 사람이 하는것과 같은 대행인데」.
 *   문안은 「[고객명]」 · 「%고객명%」인데 명단 열은 「이름」인 접수(실 접수 시험 파일)를 사람은 당연히 잇는다.
 *   기준 = 표준 필드 표(standard-field-map FIELD_MAP)의 **표시 이름 + 동의어** 한 벌(「고객명」 = 「이름」 = 「성함」) — 여기서 새 낱말을 적지 않는다.
 *   지금은 고객 이름 항목만 쓴다(요청 범위 · 등급 · 포인트 묶음도 같은 표에 있다). 받는 사람 번호 항목은 쓰지 않는다.
 *   ⛔ 같은 이름의 열이 없을 때만 · 같은 뜻 이름의 열이 **정확히 하나**일 때만 잇는다(「이름」 · 「성함」 둘 다 있으면 고르지 않는다 = 사람도 묻는다).
 */
const SYNONYM_FIELD_KEYS = ['name'];
const nameKey = (v: unknown) => String(v || '').replace(/\s+/g, '');

/** 같은 뜻 이름의 열 전부(명단 차례) — 화면의 고르기 후보에도 쓴다(둘 이상이면 사람이 고른다) */
export function synonymColumns(headers: string[], varName: string): string[] {
  const key = nameKey(varName);
  if (!key) return [];
  for (const fieldKey of SYNONYM_FIELD_KEYS) {
    const f = getFieldByKey(fieldKey);
    if (!f) continue;
    const group = [f.displayName, ...(f.aliases || [])].map(nameKey);
    if (group.includes(key)) return headers.filter((h) => group.includes(nameKey(h)));
  }
  return [];
}

/**
 * 그 열의 값이 사람 이름일 수 없는 모양인가 — 과반이 휴대폰 번호 · 또는 과반이 「점 · 지점 · 매장 · 점포」로 끝남(매장 이름).
 *   사람도 열 이름만 보지 않고 값을 본다(「이름」 열에 강남점 · 성수점이 들어 있으면 고객 이름으로 잇지 않는다 · Codex 같은 뜻 1R).
 */
function valuesRuleOutPersonName(column: string, rows: Array<Record<string, any>>): boolean {
  // 명단 전체를 **한 번** 훑어 같이 센다(채워진 칸 · 매장 이름 꼴 · 휴대폰 번호 칸) · 같은 분석(같은 rows) 안에서는 열별 결과를 다시 쓴다
  //   (괄호 자리마다 이 판정을 부른다 · 앞쪽만 보면 뒤쪽 값이 다른 열을 놓친다 · Codex 같은 뜻 4R · 5R).
  //   기준 하나 = **이름일 수 없는 값(매장 이름 꼴 + 휴대폰 번호)이 채워진 값의 절반을 넘으면** 참. 둘을 따로 재면 반씩 섞인 열이 빠져나간다
  //   (경계 사례 세 라운드 = 기준을 하나로 · 6R). 「김순점」 · 「김민지」처럼 절반 이하면 이름 열이다.
  let byColumn = ruleOutCache.get(rows);
  if (!byColumn) { byColumn = new Map(); ruleOutCache.set(rows, byColumn); }
  const cached = byColumn.get(column);
  if (cached !== undefined) return cached;
  let filled = 0; let store = 0; let mobile = 0;
  for (const r of rows) {
    const v = String(r?.[column] ?? '').trim();
    if (!v) continue;
    filled++;
    if (/(점|지점|매장|점포)$/.test(v)) store++;
    else if (agencyCellIsMobile(v)) mobile++;
  }
  const out = filled > 0 && (store + mobile) * 2 > filled;
  byColumn.set(column, out);
  return out;
}
const ruleOutCache = new WeakMap<object, Map<string, boolean>>();

/** 같은 뜻 이름으로 **저절로** 이을 열 = 그런 열이 정확히 하나이고 값 모양이 어긋나지 않을 때만(rows 를 주면 값도 본다) */
export function synonymColumn(headers: string[], varName: string, rows?: Array<Record<string, any>> | null): string | null {
  const hits = synonymColumns(headers, varName);
  if (hits.length !== 1) return null;
  return rows && valuesRuleOutPersonName(hits[0], rows) ? null : hits[0];
}

/** 문안 항목에 저절로 이을 열 = 같은 이름 → 없으면 같은 뜻 이름(하나뿐 · 값 모양 맞음). 메일 · 원스텝 분석 · 괄호 자리 변환이 같이 쓴다 */
export function autoColumn(headers: string[], varName: string, rows?: Array<Record<string, any>> | null): string | null {
  return sameNameColumn(headers, varName) || synonymColumn(headers, varName, rows);
}

export interface VarColumnResolution {
  name: string;
  column: string | null;
  /** same = 같은 이름 자동 · override = 확인 화면에서 고른 열 · ai = AI 추천(라우트가 얹는다) */
  via: 'same' | 'override' | 'ai' | null;
}

/**
 * 문안 항목을 명단 열에 잇는다. 우선순위 = 확인 화면 조정값 > 같은 이름 > 같은 뜻 이름(하나뿐일 때 · ★1125(2)).
 * ⛔ 조정값이 명단에 없는 열이면 **폴백하지 않고** badOverrides로 돌려준다
 *   (사용자가 본 것과 다른 열로 접수되면 안 된다 · 원스텝 ★Codex 적대 2R 계약과 같은 선).
 */
export function resolveVarColumns(
  vars: string[], headers: string[], overrideMap?: Record<string, string> | null,
  /** ★(2) 명단 행 — 같은 뜻 이름으로 이을 때 값 모양도 본다(안 주면 이름만) */
  rows?: Array<Record<string, any>> | null,
): { resolved: VarColumnResolution[]; badOverrides: string[] } {
  const badOverrides: string[] = [];
  const resolved = vars.map((name): VarColumnResolution => {
    const pick = overrideMap && typeof overrideMap === 'object' ? overrideMap[name] : undefined;
    if (pick !== undefined && pick !== null && String(pick) !== '') {
      if (headers.includes(String(pick))) return { name, column: String(pick), via: 'override' };
      badOverrides.push(name);
      return { name, column: null, via: null };
    }
    const same = autoColumn(headers, name, rows);
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

/**
 * 수신자 값의 **저장형**(★2026-09-13 적대검토 등재분 ⑤). `agency_send_recipients.vars`에 넣기 직전에 거친다.
 * 이 컬럼은 두 경로가 읽는다: 미리보기·담당자 테스트 문자(`toSlotValues` = JS `String`)와 발송 적재(SQL `vars->>'키'`).
 * 엑셀 숫자 셀이 jsonb 숫자로 저장되면 둘이 갈린다(1e21 → JS "1e+21" · PostgreSQL numeric 출력은 지수 표기를 쓰지 않는다,
 * 운영 DB 미실측). 문자열로 저장하면 `->>`는 그 문자열을 그대로 돌려주므로 **미리보기 = 나가는 문장**이 유지된다(불변 4).
 * 엑셀 날짜 셀은 명단을 읽을 때 이미 벽시계 글자다(★2026-09-13(3) agency-send-form `sheetDatesToText`).
 * ⛔ Date 분기는 명단 파서 밖에서 Date가 들어올 때의 종전 저장값(`JSON.stringify` = ISO 문자열) 유지용이다. `String(date)`로 바꾸면 쓰던 표기가 달라진다.
 * ⛔ undefined 키는 싣지 않는다(종전 `JSON.stringify`와 같다). null은 null로 둔다(두 경로 모두 빈 문자열).
 */
export function toStoredVars(vars: unknown): Record<string, string | null> {
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return {};
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(vars as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (v === null) out[k] = null;
    else if (typeof v === 'string') out[k] = v;
    else if (v instanceof Date) out[k] = Number.isNaN(v.getTime()) ? null : v.toISOString();
    else if (typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = String(v);
  }
  return out;
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
