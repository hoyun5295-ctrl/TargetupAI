/**
 * sms-spell-check.ts — 문자(SMS·LMS·MMS) 맞춤법 검사 층 (2026-09-25)
 * 설계 SoT = docs/2026-09-25-agency-spell-check-design.md §2-6·§2-7 · docs/2026-09-25-direct-send-precheck-design.md
 *
 * 판정·AI 호출 = 채널 중립 엔진 `spell-check.ts`. 이 파일은 **문자 전용 보호 구간**과 문자 지시문, 단문 바이트 잠금만 얹는다.
 * 소비처 = 대행발송(워커 A · 접수 화면 검사) · 직접발송(보내기 전 점검).
 *
 * ⛔ 자동 교정 0 — 검사 결과로 문안을 바꾸는 코드는 없다. 고치기는 화면에서 사람이 누를 때만.
 * ⛔ 보호 구간을 건드리는 후보는 버린다: `%항목%` 변수 · `(광고)` · 수신거부 줄 · 전화번호 · 링크 ·
 *   문자용 기호(한글·영문·숫자·공백·ASCII 문장부호 밖의 글자 전부 · 목록을 따로 두지 않는다) · 금액·혜택 · 회사명·브랜드명.
 */

import { query } from '../config/database';
import { eucKrByteLength } from './message-byte';
import { findBenefitSpans } from './copy-benefit-detector';
import { findSnsLinkSpans } from './sns-caption-rules';
import {
  applySpellIssue, protectedWordSpans, runSpellCheck,
  type SpellIssue, type SpellTextSpan,
} from './spell-check';

/** 단문(SMS) 바이트 한도 — 고친 뒤 이 값을 넘는 교정은 [고치기]를 잠근다. */
export const SMS_SPELL_BYTE_LIMIT = 90;

const VARIABLE_RE = /%[^%\s]{1,30}%/g;
const AD_MARK_RE = /[(（]\s*광고\s*[)）]/g;
const OPT_OUT_LINE_RE = /^.*(?:무료\s*수신\s*거부|무료\s*거부|수신\s*거부|080).*$/gm;
const PHONE_RE = /(?:\+?82[-.\s]?)?0\d{1,2}[-.\s)]?\d{3,4}[-.\s]?\d{4}/g;
const REP_NUMBER_RE = /1[5-9]\d{2}[-.\s]?\d{4}/g;
/** 한글·영문·숫자·공백·ASCII 문장부호 밖의 글자 = 문자용 기호 */
const SYMBOL_RE = /[^\p{Script=Hangul}A-Za-z0-9\s!-\/:-@\[-`{-~]/gu;

function spansOf(text: string, re: RegExp): SpellTextSpan[] {
  const out: SpellTextSpan[] = [];
  for (const m of text.matchAll(re)) {
    if (m.index != null && m[0].length > 0) out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

/**
 * 링크는 앞뒤 한 칸씩 넓힌다 — 엔진은 구간 **안쪽** 끼워 넣기만 "건드림"으로 보므로, 링크 바로 끝(또는 앞)에
 * 글자를 붙이는 후보가 통과해 주소가 바뀐다(hanjul.ai/menu → hanjul.ai/menus). 주소는 한 글자도 바뀌면 안 된다.
 */
function padLinkSpans(spans: SpellTextSpan[]): SpellTextSpan[] {
  // ⛔ 문안 처음·끝에 붙은 링크도 막으려면 자르지 않는다(-1 · 길이+1). 엔진은 "구간 안쪽"만 보므로 자르면 끝 삽입이 통과한다.
  return spans.map((s) => ({ ...s, start: s.start - 1, end: s.end + 1 }));
}

/**
 * 링크 불변(순수) — 고친 뒤 글의 링크 목록이 원문과 **글자까지 같을 때만** 남긴다(경계 판정과 별개인 두 번째 그물).
 * Codex 1R: 문안 끝의 링크는 경계 넓힘을 잘라 두면 끝 삽입으로 주소가 바뀌었다.
 */
export function dropLinkChangingIssues(text: string, issues: readonly SpellIssue[]): SpellIssue[] {
  const key = (t: string) => findSnsLinkSpans(t).map((s) => s.text).sort().join('|');
  const before = key(text);
  return issues.filter((i) => key(applySpellIssue(text, i)) === before);
}

/** 문자 보호 구간 — 원문 기준 위치. */
export function smsSpellProtectedSpans(text: string, words: readonly string[] = []): SpellTextSpan[] {
  const src = String(text ?? '');
  return [
    ...padLinkSpans(findSnsLinkSpans(src)),
    ...spansOf(src, VARIABLE_RE),
    ...spansOf(src, AD_MARK_RE),
    ...spansOf(src, OPT_OUT_LINE_RE),
    ...spansOf(src, PHONE_RE),
    ...spansOf(src, REP_NUMBER_RE),
    ...spansOf(src, SYMBOL_RE),
    ...findBenefitSpans(src),
    ...protectedWordSpans(src, words),
  ];
}

/**
 * 단문 바이트 잠금(순수) — 고친 뒤 원문(변수 표기 그대로)이 한도를 넘는 항목에 `blocked='sms_bytes'`.
 * @param extraBytes 원문 밖에서 붙는 바이트(직접발송의 (광고)·수신거부 줄 등). 대행발송은 0(원문에 이미 들어 있다).
 */
export function markSmsByteBlocked(
  text: string,
  issues: readonly SpellIssue[],
  byteLimit: number | null,
  extraBytes = 0,
): SpellIssue[] {
  if (!byteLimit) return issues.map((i) => ({ ...i }));
  return issues.map((i) => {
    const fixed = applySpellIssue(text, i);
    return eucKrByteLength(fixed) + Math.max(0, extraBytes) > byteLimit ? { ...i, blocked: 'sms_bytes' as const } : { ...i };
  });
}

/** 회사 보호 낱말(회사명·브랜드명). SNS 검사와 같은 두 칸(`routes/sns.ts` /typo-check)을 읽는다. */
export async function loadSmsSpellProtectedWords(companyId: string): Promise<string[]> {
  const c = await query(`SELECT company_name, brand_name FROM companies WHERE id = $1::uuid`, [companyId]);
  return [c.rows[0]?.company_name, c.rows[0]?.brand_name].filter(Boolean).map(String);
}

const SYSTEM = [
  '너는 한국어 맞춤법 검사기다. 문자 메시지(광고 문자 포함)에서 맞춤법·띄어쓰기·오타만 찾는다.',
  '규칙:',
  '- 문체·표현·어순·말투는 고치지 않는다. 틀린 곳만 찾는다.',
  '- before 는 원문에서 **그대로 복사한** 짧은 구간(틀린 낱말과 앞뒤 한두 낱말)이다. 원문에 한 번만 나오는 구간으로 잡는다.',
  '- after 는 before 를 바로잡은 것이다.',
  '- 숫자·링크·가격·상호·전화번호·%이름% 같은 변수·(광고)·수신거부 문구·기호(★ ▶ 【】 같은 것)는 건드리지 않는다.',
  '- 상품명·외래어 표기·줄임말은 틀린 것으로 보지 않는다.',
  '- 틀린 곳이 없으면 빈 배열.',
  '출력 형식(JSON 하나만):',
  '{"issues":[{"before":"원문 구간","after":"고친 구간","reason":"한 줄 사유"}]}',
].join('\n');

/**
 * 문자 검사 실행.
 * @param source 원가 추적용 이름(대행 = 'agency-send-spell' · 직접발송 = 'direct-send-spell'). 단가표에 없으니 크레딧 0.
 * @param smsByteLimit 단문이면 90, 아니면 null
 */
export async function checkSmsSpelling(input: {
  companyId: string;
  userId?: string | null;
  text: string;
  protectedWords: string[];
  source: string;
  smsByteLimit: number | null;
  extraBytes?: number;
}): Promise<{ textHash: string; issues: SpellIssue[]; failed: boolean }> {
  const text = String(input.text ?? '');
  const r = await runSpellCheck({
    companyId: input.companyId,
    userId: input.userId,
    text,
    system: SYSTEM,
    userMessage: `검사할 문자:\n${text}`,
    source: input.source,
    protectedSpans: smsSpellProtectedSpans(text, input.protectedWords),
  });
  return { ...r, issues: markSmsByteBlocked(text, dropLinkChangingIssues(text, r.issues), input.smsByteLimit, input.extraBytes ?? 0) };
}
