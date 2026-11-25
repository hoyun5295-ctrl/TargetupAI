/**
 * ★ 2026-11-25 대행 접수 「사람이 잡던 실수」 판정 CT(설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §3 · §4-1 · §8-3).
 *
 * 규칙 한 벌 · 순수 · AI 0 · 저장 0(같은 글 = 같은 결과). 부르는 곳 = 원스텝 · 메일 분석(analyzeOneStep) · 접수 알림(createRequestCore) ·
 * 화면 접수 무상태 판정(/blank-check) · 승인 요청 문자(worker) · 승인 판정(approveAgencyRequestTx) · 상세 · 링크 화면 조회.
 * ⛔ 직접발송 공통 관문(send-placeholder-gate)에 붙이지 않는다(직접발송 동작 변화 0 · §10).
 * ⛔ 고객 문장은 이 파일 한 곳에서 만든다(줄표 · 가운뎃점 0).
 */
import { findVarTokens } from './var-tokens';
import { extractAgencyVars, autoColumn, synonymColumns } from './agency-send-vars';
import { agencyColumnMostlyMobile } from './agency-send-form';

export interface AgencyBlank {
  start: number;
  /** text 끝(접미어 앞) */
  end: number;
  /** 자리 글(기호 꼴 = 「OOO」 · 괄호 꼴 = 「[매장명]」 괄호 포함) */
  text: string;
  kind: 'mark' | 'bracket';
  /** 기호 꼴 바로 뒤에 붙은 점 · 지점 · 매장 · 점포(없으면 '') · 채우기가 통째 · 앞부분만을 고른다 */
  suffix: string;
}

/** 화면 · 문장에 쓰는 자리 이름(기호 꼴 = 접미어 포함 「OOO점」) */
export function blankLabel(b: AgencyBlank): string {
  return b.kind === 'mark' ? b.text + b.suffix : b.text;
}

const MARK_CHARS = '○◯●ㅇ□■△▲';
const SUFFIXES = ['지점', '매장', '점포', '점'] as const;
/** 괄호 꼴 ① 낱말 표(공백 뺀 글과 정확히 같을 때만) */
const BRACKET_WORDS = new Set([
  '매장명', '지점명', '점포명', '고객명', '이름', '성함', '매장이름', '매장번호', '매장전화번호', '전화번호', '연락처',
  '날짜', '금액', '쿠폰번호', '링크', 'URL', 'url',
]);
/** 괄호 꼴 ② 낱말 조각 + 필드 끝말(문안만으로 판정 · 승인 단계에서도 같은 결과 · Codex 설계 1R) */
const FIELD_PARTS = ['고객', '성함', '이름', '매장', '지점', '점포', '전화', '연락처', '번호'];
const FIELD_ENDS = /(명|이름|번호|성함|연락처|주소|전화)$/;
/** 매장 이름 후보 열 낱말 · 사람 이름 후보 열 낱말 */
const STORE_WORDS = ['매장', '지점', '점포', '점명', '스토어', 'store', 'shop', 'branch', '가맹'];
const NAME_WORDS = ['고객', '이름', '성함', '성명'];
/** 이름 채우기 후보에서 빼는 열(번호 · 날짜 류) */
const NOT_NAME_COLUMN = /(번호|전화|연락처|휴대폰|핸드폰|코드|일자|날짜|phone|tel)/i;

const nk = (s: unknown) => String(s ?? '').replace(/\s+/g, '');
/** 느슨한 대조 키 = 공백 · 끝 「명」 · 「전화」 를 뺀다(소속매장명 ≈ 소속 매장 · 매장전화번호 ≈ 매장번호) */
const looseKey = (s: unknown) => nk(s).replace(/전화/g, '').replace(/명$/, '');

/** 판정에서 빼는 구간(변수 조각 · 주소 · 수신거부 줄 · (광고)) */
function excludedRanges(content: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const t of findVarTokens(content)) out.push([t.start, t.end]);
  const url = /(https?:\/\/|www\.)\S+/gi;
  let m: RegExpExecArray | null;
  while ((m = url.exec(content)) !== null) out.push([m.index, m.index + m[0].length]);
  let lineStart = 0;
  for (const line of content.split('\n')) {
    // 수신거부 줄 = 「수신거부」 글이 있거나 080 전화번호 꼴(080-123-4567 · 0801234567)이 있는 줄만(가격 「1,080원」은 계속 본다 · Codex 구현 1R)
    if (/수신\s*거부/.test(line) || /(^|[^0-9,])080[-\s.]?\d{3,4}[-\s.]?\d{4}(?!\d)/.test(line)) out.push([lineStart, lineStart + line.length]);
    lineStart += line.length + 1;
  }
  const ad = /\(광고\)/g;
  while ((m = ad.exec(content)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

const inRanges = (ranges: Array<[number, number]>, s: number, e: number) => ranges.some(([a, b]) => s < b && e > a);
const isHangul = (ch: string | undefined) => !!ch && /[가-힣]/.test(ch);
const isLatinOrDigit = (ch: string | undefined) => !!ch && /[A-Za-z0-9]/.test(ch);

/** 괄호 안 글이 명단 열과 느슨히 맞는 열들(점수 높은 순 · 같으면 긴 열 이름) */
function looseColumns(inner: string, headers: string[]): string[] {
  const key = looseKey(inner);
  if (key.length < 2) return [];
  const scored: Array<{ h: string; score: number; len: number }> = [];
  for (const h of headers) {
    const hk = looseKey(h);
    if (hk.length < 2) continue;
    let score = 0;
    if (hk === key) score = 3;
    else if (key.endsWith(hk)) score = 2;
    else if (key.includes(hk) || hk.includes(key)) score = 1;
    if (score > 0) scored.push({ h, score, len: hk.length });
  }
  scored.sort((a, b) => b.score - a.score || b.len - a.len);
  return scored.map((x) => x.h);
}

/**
 * 문안의 빈 자리(§3-1). 문안만 본다(같은 글 = 같은 결과 · 접수 · 승인 단계가 같은 판정) · 위치 순.
 */
export function findAgencyBlanks(content: string | null | undefined): AgencyBlank[] {
  const text = String(content || '');
  if (!text) return [];
  const ex = excludedRanges(text);
  const out: AgencyBlank[] = [];

  // 기호 꼴 — 같은 글자 2~4개 연속
  const markRe = new RegExp(`([${MARK_CHARS}OoXx*_])\\1{1,3}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = markRe.exec(text)) !== null) {
    const ch = m[1];
    const start = m.index;
    const end = start + m[0].length;
    // 앞뒤로 같은 글자가 더 있으면(5개 이상) 장식으로 본다
    if (text[start - 1] === ch || text[end] === ch) {
      while (markRe.lastIndex < text.length && text[markRe.lastIndex] === ch) markRe.lastIndex++;
      continue;
    }
    if (/[OoXx]/.test(ch) && (isLatinOrDigit(text[start - 1]) || isLatinOrDigit(text[end]))) continue;
    if (inRanges(ex, start, end)) continue;
    const next = text[end];
    const afterSpace = next === ' ' ? text.slice(end + 1) : '';
    const followsHangul = isHangul(next);
    const followsWord = next === ' ' && /^(점|님|매장|지점)/.test(afterSpace);
    if (!followsHangul && !followsWord) continue;
    const suffix = followsHangul ? (SUFFIXES.find((s) => text.startsWith(s, end)) || '') : '';
    out.push({ start, end, text: m[0], kind: 'mark', suffix });
  }

  // 괄호 꼴
  const brRe = /\[([^\[\]\n]{1,30})\]|\(([^()\n]{1,30})\)|「([^「」\n]{1,30})」/g;
  while ((m = brRe.exec(text)) !== null) {
    const inner = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const key = nk(inner);
    if (key.length < 2 || key.length > 15) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (inRanges(ex, start, end)) continue;
    const exact = BRACKET_WORDS.has(key);
    // 숫자(전각 · 원문자 ⑩ 포함 = 유니코드 숫자 \p{N})가 든 괄호(「[매장 선착순 100명]」)는 행사 머리말이다(Codex 설계 2R · 3R)
    const fieldLike = !exact && !/\p{N}/u.test(key) && FIELD_PARTS.some((p) => key.includes(p)) && FIELD_ENDS.test(key);
    if (exact || fieldLike) out.push({ start, end, text: m[0], kind: 'bracket', suffix: '' });
  }

  return out.sort((a, b) => a.start - b.start);
}

export interface BlankColumnCandidate {
  column: string;
  /** 비지 않은 값 가운데 자리 접미어(기본 「점」)로 끝나는 수 · 아닌 수 · 빈 값 수 · 서로 다른 값 수 */
  endsWithSuffix: number;
  notSuffix: number;
  empty: number;
  distinct: number;
  /** 실제 행 예시(접미어로 끝나는 값 · 아닌 값 · 없으면 '') */
  exampleWithSuffix: string;
  exampleWithoutSuffix: string;
}

/**
 * 빈 자리를 채울 명단 열 후보(§3-2). 괄호 꼴 = 느슨한 이름 대조 · 기호 꼴 = 열 이름 낱말(매장 / 이름) + 값 모양(절반 이상 「점」 끝).
 * 세기는 넘겨받은 rows 전체로 한다(원스텝 = 명단 전체 · 화면 = 화면이 가진 행).
 */
export function matchBlankColumns(
  blank: AgencyBlank, headers: string[], rows: Array<Record<string, any>>,
): BlankColumnCandidate[] {
  const suffix = blank.suffix || '점';
  let cols: string[];
  if (blank.kind === 'bracket') {
    const inner = blank.text.slice(1, -1);
    // ★ 2026-11-25(2) 휴대폰 번호가 든 열(수신번호 열)은 느슨한 대조의 후보가 아니다 — 「[고객명]」에 「고객연락처 (수신번호)」를
    //   「가까운 열」로 권하면(글자 「고객」이 겹침) 그 열 이름을 고객명으로 바꿔 보내 이름 자리에 전화번호가 들어간다(1125 실 접수 파일로 확인).
    //   이름이 같은 열은 이 판정 앞에서 이미 변수로 바뀌었다(convertBracketVars) → 예외를 두지 않는다
    //   (느슨한 키로 예외를 두면 「[고객명]」 ↔ 「고객전화」가 같은 키 「고객」으로 되살아난다 · Codex 짝 2R).
    //   판정 = 비어 있지 않은 값의 과반이 휴대폰 번호(같은 뜻 이름 자동 연결과 같은 함수).
    // ★(2) 같은 뜻 이름의 열은 전부 후보다 — 「이름」 · 「성함」 둘 다 있어 저절로 잇지 않은 자리도 화면에서 고를 수 있게(Codex 같은 뜻 1R)
    //   번호 열 판정은 후보로 오른 열에만 돌린다(명단 전체를 훑으므로 모든 열에 돌리지 않는다).
    const syn = synonymColumns(headers, inner);
    cols = [...syn, ...looseColumns(inner, headers).filter((h) => !syn.includes(h))].filter((h) => !agencyColumnMostlyMobile(h, rows));
  } else {
    // 접미어(점 · 지점 · 매장 · 점포)가 붙은 자리 = 매장 이름 · 그 밖(「OOO님」 등) = 매장 · 사람 이름 둘 다 후보
    const words = blank.suffix ? STORE_WORDS : [...STORE_WORDS, ...NAME_WORDS];
    const byName = headers.filter((h) => !NOT_NAME_COLUMN.test(nk(h)) && words.some((w) => nk(h).toLowerCase().includes(w.toLowerCase())));
    const byShape = headers.filter((h) => {
      if (byName.includes(h) || NOT_NAME_COLUMN.test(nk(h))) return false;
      const vals = rows.map((r) => String(r?.[h] ?? '').trim()).filter(Boolean);
      return vals.length > 0 && vals.filter((v) => v.endsWith('점')).length * 2 >= vals.length;
    });
    cols = [...byName, ...byShape];
  }
  return cols.map((column) => {
    let endsWithSuffix = 0; let notSuffix = 0; let empty = 0;
    let exampleWithSuffix = ''; let exampleWithoutSuffix = '';
    const seen = new Set<string>();
    for (const r of rows) {
      const v = String(r?.[column] ?? '').trim();
      if (!v) { empty++; continue; }
      seen.add(v);
      if (v.endsWith(suffix)) { endsWithSuffix++; if (!exampleWithSuffix) exampleWithSuffix = v; } else { notSuffix++; if (!exampleWithoutSuffix) exampleWithoutSuffix = v; }
    }
    return { column, endsWithSuffix, notSuffix, empty, distinct: seen.size, exampleWithSuffix, exampleWithoutSuffix };
  });
}

/**
 * 명단 열과 같은 이름(공백 무시)의 `[X]` = 변수(§8-3). 바꾼 것은 화면 · 회신에 한 줄로 알린다.
 * ⛔ 대괄호만 본다(소괄호 · 낫표는 바꾸지 않는다) · 이미 변수 조각 · 주소 안은 그대로.
 */
export function convertBracketVars(
  content: string, headers: string[],
  /** ★(2) 명단 행 — 같은 뜻 이름으로 이을 때 값 모양도 본다(안 주면 이름만) */
  rows?: Array<Record<string, any>> | null,
): { content: string; converted: Array<{ from: string; column: string }> } {
  const text = String(content || '');
  if (!text.includes('[') || headers.length === 0) return { content: text, converted: [] };
  const ex = excludedRanges(text);
  const hits: Array<{ start: number; end: number; whole: string; name: string; column: string }> = [];
  const re = /\[([^\[\]\n]{1,30})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const whole = m[0];
    if (inRanges(ex, m.index, m.index + whole.length)) continue;
    const col = autoColumn(headers, m[1].trim(), rows);   // ★(2) 같은 이름 → 없으면 같은 뜻 이름(「[고객명]」 ↔ 「이름」 열 · 하나뿐 · 값 모양 맞을 때)
    const name = nk(m[1]);
    if (!col || !name || !/^[가-힣A-Za-z_]/.test(name) || name.length > 20 || name.includes('%')) continue;
    hits.push({ start: m.index, end: m.index + whole.length, whole, name, column: col });
  }
  // 뒤에서부터 바꾸고, 바꾼 자리가 변수 조각 하나로 읽힐 때만 남긴다(「11/25[매장명]」 = 숫자 뒤 % 는 퍼센트라 변수 아님 → 원래 괄호 그대로 · Codex 구현 1R)
  let out = text;
  const converted: Array<{ from: string; column: string }> = [];
  for (const h of [...hits].reverse()) {
    const next = out.slice(0, h.start) + `%${h.name}%` + out.slice(h.end);
    if (isVarTokenAt(next, h.start, h.name)) {
      out = next;
      converted.unshift({ from: h.whole, column: h.column });
    }
  }
  return { content: out, converted };
}

/** 글의 그 위치에서 시작하는 변수 조각이 그 이름 하나로 읽히는가(접수 · 발송이 쓰는 같은 조각 판정) */
export function isVarTokenAt(text: string, start: number, name: string): boolean {
  return findVarTokens(text).some((t) => t.start === start && t.name === name);
}

export interface SlotFill { start: number; end: number; before: string; column?: string; text?: string }

/**
 * 원스텝 채우기(§4-1). 위치 기준 = 채우기 전 글(baseContent). 큰 위치부터 적용 · 겹침 · 글 다름 · 없는 열 · 둘 다 빔 = 반려(대신 다른 값 0).
 * column = `%열 이름(공백 뺌)%`(같은 이름 열 자동 연결) · text = 직접 적은 이름.
 */
export function applySlotFills(
  base: string, fills: SlotFill[], headers: string[],
): { ok: true; content: string; mapping: Record<string, string> } | { ok: false; error: string } {
  const list = [...fills].sort((a, b) => b.start - a.start);
  // ⛔ 채우기 범위 = 서버가 이 글에서 다시 찾은 빈 자리 범위와 정확히 같을 때만(기호 꼴 = 접미어 뺀 범위 · 접미어 포함 범위 · Codex 설계 2R)
  const allowed = new Set<string>();
  for (const b of findAgencyBlanks(base)) {
    allowed.add(`${b.start}:${b.end}`);
    if (b.suffix) allowed.add(`${b.start}:${b.end + b.suffix.length}`);
  }
  const mapping: Record<string, string> = {};
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (!Number.isInteger(f.start) || !Number.isInteger(f.end) || f.start < 0 || f.end > base.length || f.end <= f.start) {
      return { ok: false, error: '채울 자리를 찾지 못했습니다. 파일을 다시 확인해 주세요.' };
    }
    if (base.slice(f.start, f.end) !== f.before) return { ok: false, error: `채울 자리 「${f.before}」가 문안에 그대로 있지 않습니다. 다시 확인해 주세요.` };
    if (i > 0 && f.end > list[i - 1].start) return { ok: false, error: '채울 자리가 겹칩니다. 하나씩 골라 주세요.' };
    const hasCol = typeof f.column === 'string' && f.column !== '';
    const hasText = typeof f.text === 'string' && f.text.trim() !== '';
    if (hasCol === hasText) return { ok: false, error: `「${f.before}」 자리에 넣을 열이나 이름을 하나만 골라 주세요.` };
    if (hasCol && !headers.includes(f.column!)) return { ok: false, error: `고르신 열 「${f.column}」이 명단에 없습니다. 다시 골라 주세요.` };
    if (hasText && f.text!.includes('%')) return { ok: false, error: '넣을 이름에 % 는 쓸 수 없습니다.' };
    if (hasCol) {
      const name = nk(f.column);
      if (!/^[가-힣A-Za-z_]/.test(name) || name.length > 20 || name.includes('%')) {
        return { ok: false, error: `열 이름 「${f.column}」은 문안 항목으로 쓸 수 없습니다. 열 이름을 한글이나 영문으로 시작하게 바꿔 주세요.` };
      }
      // 한 이름에 서로 다른 열(「소속 매장」 · 「소속매장」)을 고르면 반려(Codex 설계 2R)
      if (mapping[name] !== undefined && mapping[name] !== f.column) {
        return { ok: false, error: `「${f.column}」 열과 「${mapping[name]}」 열이 같은 항목 이름이 됩니다. 한 열만 골라 주세요.` };
      }
      mapping[name] = f.column!;
    }
    if (!allowed.has(`${f.start}:${f.end}`)) return { ok: false, error: `「${f.before}」는 채울 자리로 찾은 곳이 아닙니다. 다시 확인해 주세요.` };
  }
  const putOf = (f: SlotFill) => (f.column ? `%${nk(f.column)}%` : String(f.text).trim());
  let out = base;
  for (const f of list) out = out.slice(0, f.start) + putOf(f) + out.slice(f.end);
  // ⛔ 채운 뒤 최종 글의 변수 = 채우기 전 변수(앞 자리 길이 변화만큼 옮긴 위치) + 열로 채운 자리 — 정확히 이 집합으로 읽혀야 한다.
  //   숫자 바로 뒤 % 는 퍼센트(공용 판정)라 요청서 숫자 · 직접 적은 숫자가 열 채우기나 원래 있던 항목을 깨뜨릴 수 있다
  //   (「2%지점%」 · 「12/1%매장명%」 · 같은 부류 세 라운드 = 자리마다 덧댄 검사를 이 대조 하나로 바꿈 · Codex 구현 2R ~ 4R)
  const asc = [...list].sort((x, y) => x.start - y.start);
  const shiftAt = (pos: number) => asc.reduce((s, f) => (f.end <= pos ? s + putOf(f).length - (f.end - f.start) : s), 0);
  const typedEnds = new Set(asc.filter((f) => !f.column).map((f) => f.start + shiftAt(f.start) + putOf(f).length));
  const want = [
    ...findVarTokens(base).map((t) => ({ start: t.start + shiftAt(t.start), name: t.name, fill: null as SlotFill | null })),
    ...asc.filter((f) => f.column).map((f) => ({ start: f.start + shiftAt(f.start), name: nk(f.column), fill: f as SlotFill | null })),
  ];
  const got = findVarTokens(out);
  for (const w of want) {
    if (got.some((t) => t.start === w.start && t.name === w.name)) continue;
    const byTyped = typedEnds.has(w.start);
    if (w.fill) {
      return { ok: false, error: byTyped
        ? `「${w.fill.before}」 바로 앞에 직접 적은 이름이 숫자로 끝나 「${w.fill.column}」 열 값이 들어가지 않습니다. 숫자로 끝나지 않게 적거나, 요청서에서 두 자리 사이에 띄어쓰기를 넣어 다시 올려 주세요.`
        : `「${w.fill.before}」 바로 앞이 숫자라 명단 열 값이 들어가지 않습니다. 요청서에서 그 자리 앞에 띄어쓰기를 넣어 다시 올려 주세요.` };
    }
    return { ok: false, error: `직접 적은 이름이 숫자로 끝나 바로 뒤 %${w.name}% 항목에 값이 들어가지 않습니다. 숫자로 끝나지 않게 적거나, 요청서에서 그 자리 뒤에 띄어쓰기를 넣어 다시 올려 주세요.` };
  }
  if (got.length !== want.length) return { ok: false, error: '채운 글에서 문안 항목이 달라졌습니다. 넣은 값을 다시 확인해 주세요.' };
  return { ok: true, content: out, mapping };
}

export interface SuffixDup { name: string; suffix: string; count: number; example: string }

/** `%열%점` 인데 값도 점으로 끝나는 행(§3-3) · 한 글자 겹침 일반 규칙은 안 씀 */
export function findSuffixDup(content: string, recipients: Array<Record<string, any> | null | undefined>): SuffixDup[] {
  const text = String(content || '');
  const out: SuffixDup[] = [];
  const seen = new Set<string>();
  for (const t of findVarTokens(text)) {
    const suffix = SUFFIXES.find((s) => text.startsWith(s, t.end));
    if (!suffix || seen.has(`${t.name}|${suffix}`)) continue;
    seen.add(`${t.name}|${suffix}`);
    let count = 0; let example = '';
    for (const r of recipients) {
      const v = String(r?.[t.name] ?? '').trim();
      if (v && v.endsWith(suffix)) { count++; if (!example) example = v + suffix; }
    }
    if (count > 0) out.push({ name: t.name, suffix, count, example });
  }
  return out;
}

/** 문안에 쓴 항목마다 값이 빈 행 수(§3-4 · 공백만 = 빈 값 · 키 없음 = 빈 값) */
export function countEmptyVarRows(content: string, recipients: Array<Record<string, any> | null | undefined>): Array<{ name: string; count: number }> {
  return extractAgencyVars(String(content || '')).map((name) => ({
    name,
    count: recipients.filter((r) => String(r?.[name] ?? '').trim() === '').length,
  })).filter((x) => x.count > 0);
}

const listLabels = (blanks: AgencyBlank[]) => [...new Set(blanks.map(blankLabel))].join(', ');

/** 접수 알림 · 메일 회신 · 확인 화면 줄(§3-5) */
export function agencyBlankIntakeLines(input: {
  blanks: AgencyBlank[]; suffixDups: SuffixDup[]; emptyRows: Array<{ name: string; count: number }>;
}): string[] {
  const lines: string[] = [];
  if (input.blanks.length > 0) lines.push(`문안에 채우지 않은 자리가 있습니다: ${listLabels(input.blanks)}`);
  for (const d of input.suffixDups) lines.push(`${d.count.toLocaleString()}명은 「${d.name}」 값이 이미 ${d.suffix}${d.suffix === '점포' ? '로' : '으로'} 끝나 이렇게 나갑니다: ${d.example}`);
  for (const e of input.emptyRows) lines.push(`명단 ${e.count.toLocaleString()}명은 「${e.name}」 칸이 비어 있어 그 자리가 빈칸으로 나갑니다.`);
  return lines;
}

/** 열이 없을 때의 두 길(§3-5 · §4-2) */
export function agencyBlankNoColumnLine(blank: AgencyBlank): string {
  const label = blankLabel(blank);
  return `명단에 이 자리를 채울 열이 없습니다. 한 매장에만 보내신다면 매장 이름을 적어 주세요. 매장마다 다르면 명단에 매장명 열을 넣고 다시 올려 주세요. 이대로 접수하면 받는 분 모두에게 ${label} 글자 그대로 나갑니다.`;
}

/** 승인 요청 문자 한 줄(§5-4 · 없으면 '') */
export function agencyBlankApprovalLine(blanks: AgencyBlank[]): string {
  return blanks.length > 0 ? `문안에 채우지 않은 자리(${listLabels(blanks)})가 있습니다. 승인 전에 확인해 주세요.` : '';
}

/** 승인 판정 409 문장(§5-1 · 옛 화면은 서버 문장을 그대로 띄운다) */
export function agencyBlankAckError(blanks: AgencyBlank[]): string {
  return `채우지 않은 자리(${listLabels(blanks)})가 있습니다. 화면을 새로 고친 뒤 확인하고 승인해 주세요.`;
}
