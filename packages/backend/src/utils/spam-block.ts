/**
 * spam-block.ts — 금칙어 차단 체계 컨트롤타워 (★2026-08-18 전송자격인증 5.2)
 *
 * 인증기준이 요구하는 것
 *   "문자 내용 중 금칙어(키워드·URL·전화번호)가 포함되면 차단하는 체계"
 *   "외부기관(KISA 등)이 공유한 차단정보를 적용할 수 있을 것"
 *   "⇒ **다중 조합 필터링** — 문자 내용을 1개 이상(최대 5개)의 차단정보 조합으로 구성하여 탐지 및 차단"
 *
 * ⛔ 단일 키워드로 차단하지 않는다
 *   "대출" 하나로 막으면 금융 고객사가 발송을 못 한다. 기준이 말하는 것은 **조합**이다 —
 *   요소가 전부 맞을 때만 걸린다(`["무직자","당일","bit.ly"]`). 요소 1개짜리 규칙은 만들지 못하게 막는다.
 *
 * ⛔ 필터가 고장 나면 차단이 아니라 통과다 (fail-open — 여기서는 이것이 정답이다)
 *   이 게이트는 **모든 발송이 지나는 길목**에 있다. 규칙 조회가 실패했다고 발송을 막으면
 *   필터 오류 하나로 전 고객 발송이 멈춘다. 오탐보다 그쪽이 훨씬 큰 사고다.
 *   차단은 "확실할 때만 하는 부가 동작"이고 통과가 기본 동작이다. 실패는 로그로 남긴다.
 *
 * ⛔ ★2026-08-19 — 이 체계는 **탐지만 한다. 발송을 막지 않는다.**
 *   차단 판정을 차감 **뒤**(`bulkInsertSmsQueue` 적재 길목)에 뒀던 것이 뿌리였다. 돈이 이미 움직인 자리라
 *   무엇으로 막든 정합이 깨진다 — 행을 버리면 호출부 17곳이 줄어든 건수를 제각각 해석하고,
 *   throw로 바꾸면 환불 멱등이 캠페인 단위 누적이라 **같은 캠페인 재차단 시 환불 0**(실차감 잔존)이 된다.
 *   막는 동작을 없애면 그 결함은 성립 자체를 안 한다. 그래서 모드·차단 오류·강도 우열을 전부 지웠다.
 *   차단은 게이트를 차감 **앞** preflight로 옮기는 재설계 뒤에 연다(브랜드메시지 0818(6)과 같은 자리).
 *
 * ⛔ 차단은 데이터로 켤 수 없다
 *   `spam_block_rules.mode` 컬럼은 남아 있지만 **코드가 읽지 않는다.** DB를 직접 고쳐 'block'을 넣어도
 *   아무 일도 일어나지 않는다. 차단을 여는 유일한 길은 재설계된 코드다.
 */

import { query } from '../config/database';

/** 차단정보 요소 — 이 셋이 기준이 말하는 "키워드, URL, 전화번호" */
export type BlockElementType = 'keyword' | 'url' | 'phone';

export interface BlockElement {
  type: BlockElementType;
  value: string;
}

export interface BlockRule {
  id: string;
  name: string;
  elements: BlockElement[];
  source: string;
  exemptCompanyIds: string[];
}

/** 요소 개수 한계 — 기준 원문 "1개 이상(최대 5개)". 우리는 하한을 2로 올린다(단일 키워드 차단 금지) */
export const MIN_ELEMENTS = 2;
export const MAX_ELEMENTS = 5;

/**
 * 차단 시 발송자에게 나가는 안내 문구 — **이 상수가 유일한 원본이다.**
 * 관리자 화면의 「차단 안내」 미리보기와, 차단 승격(설계서 §4-H) 시 발송 경로가 같은 값을 쓴다.
 * ⛔ 화면에 문구를 복사해 두면 둘이 갈라지고, 심사에 내는 안내 화면이 실제와 달라진다.
 */
export const SPAM_BLOCK_NOTICE =
  '등록된 차단정보에 걸려 발송이 중지되었습니다. 문안을 수정한 뒤 다시 시도해주세요. 정상 문안인데 걸렸다면 고객센터로 알려주세요.';

/** 규칙 캐시 유지(ms) — 대량 발송 중 매 건 조회를 피한다 */
const RULE_CACHE_TTL_MS = 60_000;
let ruleCache: { rules: BlockRule[]; expires: number } | null = null;

/**
 * ★0819 Codex 2R — **single-flight.** 캐시가 비었을 때 동시 발송이 겹치면
 *   발송마다 별도 SELECT가 시작돼 PG 풀(max 20)을 고갈시킬 수 있다(0814 실사고 축).
 *   진행 중인 로드가 있으면 그 promise를 공유한다.
 * `cacheGen` — 로드 중에 무효화가 들어오면 그 결과로 캐시를 채우지 않는다(낡은 값 고정 방지).
 */
interface RuleFlight { gen: number; promise: Promise<BlockRule[]> }
let inFlight: RuleFlight | null = null;
let cacheGen = 0;

export function invalidateSpamBlockCache(): void {
  ruleCache = null;
  cacheGen += 1;
}

/** 저장 전 검증 — 단일 요소 규칙은 만들 수 없다 */
export function validateElements(raw: any): { ok: true; elements: BlockElement[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: '차단정보 요소가 배열이 아닙니다.' };
  const elements: BlockElement[] = [];
  // ★ 0818 Codex F1 — 같은 값을 두 번 넣으면 조합 하한을 통과해 **사실상 단일 키워드 차단**이 된다
  //   (`["대출","대출"]`은 한 곳에서 둘 다 맞는다). 중복은 하나로 접은 뒤 하한을 판정한다.
  const seen = new Set<string>();
  for (const item of raw) {
    const type = String(item?.type || '').trim();
    const value = String(item?.value || '').trim();
    if (type !== 'keyword' && type !== 'url' && type !== 'phone') {
      return { ok: false, error: '요소 유형은 keyword · url · phone 중 하나여야 합니다.' };
    }
    if (!value) return { ok: false, error: '빈 요소는 넣을 수 없습니다.' };
    const key = `${type}:${value.toLowerCase().replace(/\s+/g, '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push({ type, value });
  }
  if (elements.length < MIN_ELEMENTS) {
    return {
      ok: false,
      error: `차단정보는 요소 ${MIN_ELEMENTS}개 이상의 조합이어야 합니다. 단일 키워드 차단은 정상 문자를 막습니다.`,
    };
  }
  if (elements.length > MAX_ELEMENTS) {
    return { ok: false, error: `요소는 최대 ${MAX_ELEMENTS}개까지입니다.` };
  }
  return { ok: true, elements };
}

/** 문자·기호 차이를 흡수한 비교용 문자열 */
function normalizeForMatch(text: string): string {
  return String(text || '').toLowerCase().replace(/\s+/g, '');
}

/** 전화번호 요소는 숫자만으로 비교한다(하이픈·공백 표기가 제각각이다) */
function digitsOnly(text: string): string {
  return String(text || '').replace(/\D/g, '');
}

/**
 * 본문을 **한 번만** 정규화해 둔 형태.
 * ★0819 Codex 2R — 종전에는 요소마다 본문 전체를 다시 정규화했다(규칙 10개 × 요소 3개면 본문을 30번 훑는다).
 *   개인화 문안 수천 건이 곱해지면 그대로 이벤트 루프 점유가 된다. 본문당 1회로 접는다.
 */
interface PreparedContent {
  text: string;
  digits: string;
}
function prepareContent(content: string): PreparedContent {
  return { text: normalizeForMatch(content), digits: digitsOnly(content) };
}

function matchesElementPrepared(element: BlockElement, prep: PreparedContent): boolean {
  const value = String(element.value || '').trim();
  if (!value) return false;
  if (element.type === 'phone') {
    const target = digitsOnly(value);
    return target.length > 0 && prep.digits.includes(target);
  }
  // keyword·url 모두 부분 문자열 — url은 도메인 조각(bit.ly 등)으로 들어온다
  return prep.text.includes(normalizeForMatch(value));
}

function matchesRulePrepared(rule: BlockRule, prep: PreparedContent): boolean {
  if (!rule.elements || rule.elements.length < MIN_ELEMENTS) return false; // 방어: 단일 요소 규칙은 절대 적용하지 않는다
  return rule.elements.every((el) => matchesElementPrepared(el, prep));
}

/** 요소 하나가 본문에 있는가 */
export function matchesElement(element: BlockElement, content: string): boolean {
  return matchesElementPrepared(element, prepareContent(content));
}

/** 규칙 하나가 걸리는가 — **요소가 전부** 맞아야 한다 */
export function matchesRule(rule: BlockRule, content: string): boolean {
  return matchesRulePrepared(rule, prepareContent(content));
}

/**
 * 판정 결과.
 * ⛔ **막는 값이 없다.** 걸린 규칙 목록뿐이라 소비처가 발송을 거부할 근거를 얻을 수 없다 —
 *   "실수로 막는" 경로를 타입에서 지웠다(파일 머리 참조).
 */
export interface SpamBlockVerdict {
  hits: Array<{ ruleId: string; ruleName: string }>;
}

/**
 * 본문 하나를 판정한다(순수 — DB를 보지 않는다).
 * `companyId`가 규칙의 예외 목록에 있으면 그 규칙은 건너뛴다.
 */
export function evaluateContent(content: string, rules: BlockRule[], companyId?: string | null): SpamBlockVerdict {
  const prep = prepareContent(content); // 본문 정규화는 규칙 수와 무관하게 1회
  const hits: SpamBlockVerdict['hits'] = [];
  for (const rule of rules) {
    if (companyId && rule.exemptCompanyIds?.includes(companyId)) continue;
    if (!matchesRulePrepared(rule, prep)) continue;
    hits.push({ ruleId: rule.id, ruleName: rule.name });
  }
  return { hits };
}

/**
 * 활성 규칙 로드(캐시).
 * ⚠ 실패하면 **빈 배열**을 돌려준다 — 조회 실패로 발송을 막지 않는다(fail-open 근거는 파일 머리).
 */
export async function loadActiveRules(): Promise<BlockRule[]> {
  if (ruleCache && ruleCache.expires > Date.now()) return ruleCache.rules;
  // 겹친 호출은 진행 중인 조회 하나를 함께 기다린다.
  // ★0819 Codex 2R — 단 **같은 세대일 때만**. 무효화 뒤에 들어온 호출에게 낡은 세대의 조회 결과를
  //   그대로 돌려주면, 캐시 기입만 막고 정작 호출자는 새 규칙이 빠진 목록을 받는다.
  if (inFlight && inFlight.gen === cacheGen) return inFlight.promise;
  const flight: RuleFlight = { gen: cacheGen, promise: null as any };
  // identity 확인 후에만 비운다 — 낡은 flight의 finally가 새 flight를 지우면 안 된다
  flight.promise = fetchActiveRules(flight.gen).finally(() => { if (inFlight === flight) inFlight = null; });
  inFlight = flight;
  return flight.promise;
}

async function fetchActiveRules(gen: number): Promise<BlockRule[]> {
  try {
    // ⛔ mode를 읽지 않는다 — DB 값으로 차단을 켤 수 없게 하는 불변식(파일 머리). 계약 테스트가 이 SQL을 검사한다
    const result = await query(
      `SELECT id, name, elements, source, exempt_company_ids
         FROM spam_block_rules
        WHERE is_active = true`
    );
    const rules: BlockRule[] = [];
    for (const row of result.rows) {
      const elements = Array.isArray(row.elements) ? row.elements : [];
      // 단일 요소 규칙은 적재돼 있어도 적용하지 않는다(저장 검증 + 여기 이중 방어)
      if (elements.length < MIN_ELEMENTS) continue;
      rules.push({
        id: row.id,
        name: row.name,
        elements,
        source: row.source || 'internal',
        exemptCompanyIds: Array.isArray(row.exempt_company_ids) ? row.exempt_company_ids : [],
      });
    }
    // 로드 중에 무효화가 들어왔으면 낡은 결과로 캐시를 채우지 않는다
    if (gen === cacheGen) ruleCache = { rules, expires: Date.now() + RULE_CACHE_TTL_MS };
    return rules;
  } catch (err: any) {
    // 테이블 미생성·DB 오류 — 발송은 그대로 나간다
    console.error('[spam-block] 규칙 조회 실패 — 검사를 건너뛰고 발송을 진행한다:', err?.message || err);
    return [];
  }
}

/** 로그에 남길 문안 표본 — 개인화된 본문이라 숫자열(번호·금액·주문번호)을 가린다 */
export function maskSample(text: string): string {
  return String(text || '').replace(/\d{4,}/g, (m) => `${m.slice(0, 2)}${'*'.repeat(Math.min(m.length - 2, 8))}`).slice(0, 200);
}

/** 문안 하나에 대한 판정 + 그 문안이 몇 건이었는지 */
export interface SpamBlockLogEntry {
  verdict: SpamBlockVerdict;
  affectedRows: number;
  contentSample: string;
}

/**
 * 탐지 이력 — 기준 5.2 "차단 체계 작동 여부 및 탐지 로그 확보"
 *
 * ★0819 정정 (0818 Codex critical 2) — **규칙별 1행으로 접어 단일 INSERT**를 한다.
 *   종전에는 문안마다 hit마다 `await` INSERT를 직렬로 돌렸다. 개인화 문안이 1만 건이면
 *   1만 번을 줄 세워 기다린 뒤에야 발송이 시작된다. 심사가 요구하는 것은 "규칙이 언제 몇 건에 걸렸나"이지
 *   개인화 변형 하나하나가 아니다 — 접으면 INSERT가 **활성 규칙 수**로 묶인다(보통 한 자릿수).
 *
 * 실패해도 던지지 않는다. 로그 때문에 발송이 죽으면 안 된다.
 */
export async function logSpamBlockHits(params: {
  entries: SpamBlockLogEntry[];
  companyId?: string | null;
  userId?: string | null;
  source?: string | null;
}): Promise<void> {
  const { entries, companyId, userId, source } = params;

  // 규칙별 집계 — 건수는 합산하고 표본은 첫 문안 하나만 남긴다
  const byRule = new Map<string, { rows: number; sample: string }>();
  for (const entry of entries || []) {
    for (const hit of entry.verdict?.hits || []) {
      const agg = byRule.get(hit.ruleId);
      if (agg) agg.rows += entry.affectedRows;
      else byRule.set(hit.ruleId, { rows: entry.affectedRows, sample: entry.contentSample });
    }
  }
  if (byRule.size === 0) return;

  try {
    const values: string[] = [];
    const args: any[] = [];
    let i = 1;
    for (const [ruleId, agg] of byRule) {
      // mode·action_taken은 'detect' 고정 — 이 체계는 막지 않는다(파일 머리)
      values.push(`(gen_random_uuid(), $${i++}, $${i++}, $${i++}, $${i++}, 'detect', 'detect', $${i++}, $${i++}, NOW())`);
      args.push(ruleId, companyId || null, userId || null, source || null, agg.rows, maskSample(agg.sample));
    }
    await query(
      `INSERT INTO spam_block_hits
         (id, rule_id, company_id, user_id, send_source, mode, action_taken, affected_rows, content_sample, created_at)
       VALUES ${values.join(', ')}`,
      args
    );
  } catch (err: any) {
    console.error('[spam-block] 탐지 로그 기록 실패:', err?.message || err);
  }
}
