/**
 * ★ 2026-10-15 전체 고객 신호 (B-1015-1 · 남지현 접수 「AI 오퍼레이션 전체 고객 추출 불가」)
 *
 * 빈 조건 `{}` 는 두 가지 뜻을 가질 수 있다 — "조건을 못 옮겼다" 와 "전체 고객이 대상이다".
 * 08-18 에 앞쪽을 막으면서(「유호윤 고객에게만」이 조건 없이 전체 6명으로 잡힌 접수) 뒤쪽 신호를 만들지 않아
 * 허브의 전체 고객 발송이 끊겼다(제안 카드는 전원을 세고 리스트·발송은 거절). 이 파일이 그 신호 하나를 소유한다.
 *
 *  - `isPlainAllCustomersRequest` : 입력 문장 자체가 조건 없는 전체 요청인가(09-26 R1-21 허용 목록 · ai-segment-generator 에서 이동)
 *  - `isEmptyFilters` / `isUnresolvedEmptyTarget` : 빈 조건 판정 · 전체 선언이 없는 빈 조건 판정
 *  - `HUB_TARGET_EMPTY_MESSAGE` / `HubTargetEmptyError` : 허브(제안 카드 · 리스트 · 발송)가 같은 문장으로 멈춘다
 *
 * 전체 발송은 **명시 신호(`all_customers` → `allCustomers`)가 있을 때만** 열린다. 신호 없는 `{}` 는 어디서도 전원이 되지 않는다.
 * 자동 마케팅(계약 축)과 직접 타겟 AI 모드는 자기 판정을 쓰므로 이 파일의 소비처가 아니다.
 */

import { buildFilterWhereClauseCompat, buildFilterQueryCompat } from './customer-filter';

/** 전체를 뜻하는 말 */
const ALL_WORDS_RE = /(전체|모든|모두|전부)/g;
/**
 * 전체 요청 문장에 붙는 채움말(허용 목록). 이것과 전체를 뜻하는 말을 지우고 남는 것이 없어야 "조건 없는 전체 요청"이다.
 * 긴 말을 먼저 둔다(짧은 말이 긴 말의 일부를 먼저 지우지 않게).
 */
const ALL_FILLER_RE = /(보내주세요|보내줘요|보내줘|보내기|보내|해주세요|해줘요|해줘|하기|발송|대상으로|대상|타겟|타깃|등록된|가입한|가입된|우리|저희|고객님|고객|회원|에게|한테|으로|로|을|를|의|들|님|께)/g;

/**
 * ★ 2026-09-26 한줄로 V2 R1-21 — 입력이 **조건 없는 전체 요청**인가("전체 고객" · "모든 고객에게 보내줘" · "고객 전체").
 * 공백·문장부호를 지우고, 전체를 뜻하는 말과 채움말을 지운 뒤 남는 것이 없을 때만 참.
 * "서울 지역 모든 고객"처럼 조건이 섞이면 거짓(남는 말 = 조건). 거짓 쪽이 안전하다(되묻기).
 */
export function isPlainAllCustomersRequest(text: string): boolean {
  const t = String(text || '').replace(/[\s.,!?~·'"()\[\]]/g, '');
  if (!t || !new RegExp(ALL_WORDS_RE.source).test(t)) return false;
  return t.replace(ALL_WORDS_RE, '').replace(ALL_FILLER_RE, '').length === 0;
}

/** 보통 객체(배열 아님 · null 아님)인가 — 조건이 든 문자열·배열은 "빈 조건"으로도 "조건"으로도 치지 않는다(Codex 1R). */
function isPlainObject(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 조건이 하나도 없는가 = 키 자체가 없거나(null/undefined) **진짜 빈 객체**. 전체 선언은 이 형태에만 붙는다. 객체가 아닌 값은 빈 조건이 아니다. */
export function isEmptyFilters(filters: unknown): boolean {
  return filters == null || (isPlainObject(filters) && Object.keys(filters).length === 0);
}

/**
 * "조건을 못 옮긴" 결과인가 = 전원으로 세거나 보내면 안 되는 상태.
 *  - 전체 선언(`all_customers`)이 붙은 **진짜 빈 조건**만 전체다(선언 + 키 0개).
 *  - 그 밖은 **빌더가 만든 WHERE 가 비었는가**로 본다(08-18 원칙). 키 개수로 세면 `{grade: null}` · `{grade: {value: ''}}` 처럼
 *    키는 있는데 조건이 안 붙는 형태가 통과해 카드는 전원을 세고 리스트·발송은 거절하는 1015 접수와 같은 모양이 다시 난다.
 */
export function isUnresolvedEmptyTarget(target: { filters?: unknown; all_customers?: boolean } | null | undefined): boolean {
  const filters = target?.filters;
  if (target?.all_customers === true && isEmptyFilters(filters)) return false;
  // 객체가 아닌 값(조건이 든 문자열 등)은 {} 로 보고 빌더에 넘긴다 → WHERE 가 비어 "못 옮김". 위 줄의 isEmptyFilters 가 객체 아닌 값을 거르므로 전체로 새지 않는다.
  const safe = isPlainObject(filters) ? filters : {};
  return !buildFilterWhereClauseCompat(safe, 2).sql.trim();
}

/**
 * 자동발송(auto_campaigns)의 저장 조건이 WHERE 를 만들지 못하는가 — **실행 워커와 같은 빌더**(buildFilterQueryCompat · store_code = subquery)로 본다.
 * Codex 3R(1015): 허브용 판정(buildFilterWhereClauseCompat · store_code skip)으로 보면 브랜드 단독 조건 {store_code} 을 빈 조건으로 오판해 저장이 막힌다.
 * 저장 검증과 실행이 같은 판정을 써야 "저장은 되는데 실행 때 전원" 도 "실행은 되는데 저장이 거절" 도 없다.
 */
export function isEmptyAutoSendFilter(filters: unknown, companyId: string): boolean {
  if (!isPlainObject(filters)) return true;
  return !buildFilterQueryCompat(filters, companyId).where.trim();
}

/** 허브(제안 카드 · 리스트 · 발송)가 조건 없는 목표를 멈출 때 쓰는 한 문장. 세 곳이 같은 글자를 쓴다. */
export const HUB_TARGET_EMPTY_MESSAGE =
  'AI가 이 목표를 조건으로 옮기지 못했습니다. 조건을 더 구체적으로 적어주시거나, 특정 고객 몇 명에게만 보낼 때는 직접발송에서 고객을 직접 골라 보내주세요.';

export class HubTargetEmptyError extends Error {
  code = 'TARGET_FILTER_EMPTY';
  constructor() {
    super(HUB_TARGET_EMPTY_MESSAGE);
  }
}
