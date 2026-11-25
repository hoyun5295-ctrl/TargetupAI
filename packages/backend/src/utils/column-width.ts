/**
 * column-width.ts — DB 칸 폭 판정 한 곳(★ 2026-11-25 C163 · 뿌리 R108 · 설계서 docs/2026-11-25-phone-width-root-design.md)
 *
 * 옛: 받는 번호를 넣는 자리마다 「숫자 10자 이상」만 따로 적고 칸 폭(varchar(20))을 보지 않았다.
 *   명단 한 칸이 20자를 넘으면 PG 가 그 문장을 거절해(22001) 5만 건 묶음 전체가 실패했고, 화면은 이유 없는 오류만 보였다
 *   (1125 이에스페이먼트 · 9월부터 직접발송 적재 24회 · 주소록 12회).
 * 이 파일이 칸 폭과 판정을 소유한다. 하한(10자)은 그 자리의 옛 하한 그대로이고 이 파일은 상한(칸 폭)만 더한다.
 * ⛔ 판정 = 실제로 칸에 들어가는 값(Codex 설계 1R). 요청 본문을 그대로 묶어 보내는 자리(문자열이 아닐 수 있다)는
 *   SQL 판정식(varcharFitsSql)으로 PG 가 보는 글자를 판정하고, JS 판정(fitsVarchar)은 정리 함수를 지난 글자 값에만 쓴다.
 *   두 판정이 PG 와 같은지 = 실 PG 시험(phone-width-1125.pg)이 같은 글자를 실제 varchar 칸에 넣어 대조한다.
 * 계약 = root-ledger.test.ts R108.
 */

/** 번호 · 회신번호 칸 폭(운영 information_schema 1125 = campaign_send_staging · agency_send_recipients · address_books · customers · unsubscribes 전부 20) */
export const PHONE_COLUMN_WIDTH = 20;

/** 주소록 글자 칸 폭(address_books.group_name · name · extra1 ~ 3) */
export const ADDRESS_BOOK_WIDTH = { groupName: 100, name: 50, extra: 100 } as const;

/**
 * varchar(width) 칸에 이 글자가 들어가는가 — PG 대입 규칙 그대로(로컬 PG 15.15 실측).
 * 글자 수 = 코드 포인트 수 · 폭을 넘는 부분이 공백(' ')뿐이면 PG 가 잘라 받는다(그 값은 지금도 들어간다 = 받는 값) · 탭은 공백이 아니다.
 */
export function fitsVarchar(text: string | null | undefined, width: number): boolean {
  if (text === null || text === undefined || text.length <= width) return true;   // UTF-16 길이 ≥ 코드 포인트 수
  return Array.from(text.replace(/ +$/, '')).length <= width;
}

/** 번호 칸 폭 안인가(하한 없음 = 하한 판정이 없던 입구 · 브랜드 · 옛 동기 발송) */
export function fitsPhoneColumn(text: string | null | undefined): boolean {
  return fitsVarchar(text, PHONE_COLUMN_WIDTH);
}

/** 받는 사람 번호(숫자만)로 받는가 = 10자 이상 + 번호 칸 폭 */
export function isAcceptablePhoneDigits(digits: string | null | undefined): boolean {
  return !!digits && digits.length >= 10 && fitsPhoneColumn(digits);
}

/**
 * 한 행의 칸 값이 모두 한 글자 값(null · 글자 · 숫자 · 참거짓)인가 — 배열 · 객체 값은 node-pg 가 PG 배열로 보내
 * UNNEST 가 펼치므로 수신자 한 명이 여러 행이 되고 다른 칸과 어긋난다(★ Codex 설계 2R). 행 자체가 객체가 아니면 칸이 비어 있는 것으로 본다(지금 동작).
 */
export function hasOnlyScalarFields(row: unknown, keys: readonly string[]): boolean {
  if (row === null || typeof row !== 'object') return true;
  return keys.every((k) => {
    const v = (row as Record<string, unknown>)[k];
    return v === null || v === undefined || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  });
}

/**
 * 번호 목록 고르기(대행 담당자 · 테스트 명단 · 승인 대조 · ★ Codex 설계 2R) — 들어온 순서와 상한(max)을 그대로 둔다.
 *   10자 미만 = 건너뜀(옛 규칙 · 자리를 차지하지 않는다) · 폭 넘는 번호 = **자리는 차지하고** 빼서 센다
 *   (빼고 당기면 상한 밖 번호나 다른 명단이 승인권을 얻는다 · 부르는 쪽은 phones 가 비고 tooLong 이 있으면 반려한다).
 */
export function pickPhonesWithinWidth(
  digitsList: ReadonlyArray<string | null | undefined>, opts: { max: number; dedupe: boolean },
): { phones: string[]; tooLong: number } {
  const phones: string[] = [];
  const seen = new Set<string>();
  let tooLong = 0;
  for (const d of digitsList) {
    if (phones.length + tooLong >= opts.max) break;
    if (!d || d.length < 10) continue;
    if (opts.dedupe) { if (seen.has(d)) continue; seen.add(d); }
    if (fitsPhoneColumn(d)) phones.push(d); else tooLong++;
  }
  return { phones, tooLong };
}

/**
 * SQL 판정식 — 그 식의 값이 varchar(width) 칸에 들어가는가(NULL = 들어간다). PG 가 보는 글자로 판정하므로
 * node-pg 가 배열 · 객체 값을 어떻게 글자로 바꾸든 넣는 문장과 같은 값을 본다. expr = 코드가 쓴 열 이름만(사용자 값 0).
 */
export function varcharFitsSql(expr: string, width: number): string {
  if (!/^[a-z_][a-z0-9_.]*(::text)?$/i.test(expr) && !/^\$\d+::text$/.test(expr)) throw new Error(`varcharFitsSql: bad expr ${expr}`);
  if (!Number.isInteger(width) || width <= 0) throw new Error(`varcharFitsSql: bad width ${width}`);
  return `(${expr} IS NULL OR char_length(rtrim(${expr}, ' ')) <= ${width})`;
}
