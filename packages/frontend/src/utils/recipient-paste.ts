/**
 * ★ 2026-09-25 직접입력 창(문자 발송 · 알림톡 · 브랜드메시지 공용) — 붙여넣은 번호 읽기 컨트롤타워.
 *
 * 세 창은 원래 번호를 읽는 규칙이 서로 달랐다(문자 = 줄마다 · 알림톡 = 줄바꿈·쉼표·세미콜론 · 브랜드 = 공백까지).
 * 그 규칙은 **그대로** 옮겨 여기 한 곳에 둔다 — 창이 입력하는 동안 보여 주는 검수(추가될 수 · 중복 · 형식 오류)와
 * 실제로 더하는 값이 같은 함수에서 나와야 "보인 수 = 더해진 수"가 어긋나지 않는다.
 */
import { normalizePhoneKr } from './formatDate';

export interface PasteCheck {
  /** 유효한 번호(각 창의 규칙으로 정규화 · 입력 순서 · 중복 포함) */
  phones: string[];
  /** 번호로 읽지 못한 줄·토막(원문) */
  invalid: string[];
}

/** 문자 발송(직접발송) — 한 줄에 하나 · normalizePhoneKr · 10자리 이상(원래 [등록] 규칙 그대로) */
export function checkDirectSendPaste(text: string): PasteCheck {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const phone = normalizePhoneKr(line);
    if (phone && phone.length >= 10) phones.push(phone); else invalid.push(line);
  }
  return { phones, invalid };
}

/**
 * 알림톡 — 줄바꿈·쉼표·세미콜론(원래 parseDirectInput 구분 규칙 그대로) · normalizePhoneKr · **10자리 이상**.
 * ★ 원래 규칙은 normalizePhoneKr 결과가 있기만 하면 받아 "010-12-34"(→ 0101234 · 7자리)도 번호로 셌다 —
 *   검수 칩이 잘못된 번호를 "추가"로 세는 결함이라 문자 발송과 같은 10자리 기준으로 좁혔다(0925 밤 폭별 실측에서 발견).
 */
export function checkAlimtalkPaste(text: string): PasteCheck {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const raw of String(text ?? '').split(/[\n\r,;]+/)) {
    const s = raw.trim();
    if (!s) continue;
    const phone = normalizePhoneKr(s);
    if (phone && phone.length >= 10) phones.push(phone); else invalid.push(s);
  }
  return { phones, invalid };
}

// ★ 2026-11-05 C107 D-16 — 옛 브랜드 규칙(checkBrandPaste · normalizeBrandPhones = 공백·쉼표 토막 중 숫자 9~11자리면 무엇이든 번호)을 지웠다.
//   파일의 매장 전화 · 회원번호 칸까지 번호로 읽혀 그 번호로도 발송됐다. 브랜드 붙여넣기 = 알림톡과 같은 checkAlimtalkPaste(10자리 이상)
//   · 파일 = 번호 칸 하나만(pickPhoneColumn).

const digitsOf = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/**
 * 지금 명단에 더할 번호를 정한다.
 * - dedup=true : 지금 명단에 있는 번호와 이번 입력 안에서 앞서 나온 번호는 뺀다(dup = 뺀 수).
 * - dedup=false: 전부 더한다(dup = 겹치는 수 · 알림용).
 * 비교는 숫자만으로 한다(표기 차이 010-… / 010… 를 같은 번호로 본다).
 */
export function planAppend(phones: readonly string[], existing: Iterable<unknown>, dedup: boolean): { add: string[]; dup: number } {
  return planAppendBy(phones, existing, dedup, (p) => p);
}

/**
 * ★ 2026-10-31 planAppend 의 줄 판(같은 판정 한 곳) — 줄 객체를 그대로 돌려준다(주소록 불러오기 · 접수 cmvuih2n · 뿌리 대장 R31).
 *   phoneOf = 줄에서 번호를 꺼내는 함수.
 */
export function planAppendBy<T>(items: readonly T[], existing: Iterable<unknown>, dedup: boolean, phoneOf: (item: T) => unknown): { add: T[]; dup: number } {
  const seen = new Set<string>();
  for (const e of existing) { const k = digitsOf(e); if (k) seen.add(k); }
  const add: T[] = [];
  let dup = 0;
  for (const it of items) {
    const k = digitsOf(phoneOf(it));
    if (seen.has(k)) {
      dup++;
      if (dedup) continue;
    } else {
      seen.add(k);
    }
    add.push(it);
  }
  return { add, dup };
}

/**
 * ★ 2026-10-31 더하기 갱신 함수(Codex C85 1R · 2R) — 판정은 이 갱신 함수 하나가 그 순간의 명단(prev)으로 한다.
 *   React 가 큐에 쌓인 앞 갱신(보내기 접수 뒤 비움 등)을 먼저 적용한 prev 로 부르므로 명단 · 더한 수가 같은 계산에서 나온다.
 *   onPlan = 그 판정을 부르는 쪽에 알린다(값만 담는다 · 알림 · 창 닫힘은 부르는 쪽이 반영 뒤 효과에서) · 0 = prev 그대로(같은 배열).
 *   옛 1R 처방(flushSync 로 바로 처리)은 React 18 동시 모드에서 기본 우선순위 갱신(비동기 뒤 비움)을 건너뛰고 계산해 알림이 옛 값을 따를 수 있었다.
 */
export function appendUpdater<T>(
  rows: readonly T[],
  dedup: boolean,
  phoneOf: (item: T) => unknown,
  onPlan: (plan: { add: T[]; dup: number }) => void,
): (prev: T[]) => T[] {
  return (prev) => {
    const plan = planAppendBy(rows, prev.map(phoneOf), dedup, phoneOf);
    onPlan(plan);
    return plan.add.length === 0 ? prev : [...prev, ...plan.add];
  };
}

/**
 * ★ 2026-11-05 C107 Codex 구현 2R — 「이 칸이 휴대폰 번호 칸인가」 판정 = 백엔드 CT 의 **미러 하나**
 *   (backend utils/agency-send-form.ts looksMobile · scorePhoneColumns · pickPhoneColumnStrict · 0 유실 복원 = normalize-phone.ts restoreMobileLeadingZero).
 *   같은 사실을 화면이 따로 판정하면 갈린다(1R · 2R 에서 두 번 = 숫자만 판정이 엑셀 숫자형 번호의 앞 0 을 못 살려 다른 칸을 골랐다).
 *   두 판정이 같은 결과를 내는지 = 계약 시험 c107-brand-contract-1105 K4(표 대조).
 */
function restoreMobileLeadingZeroMirror(digits: string): string {
  return /^1[016789]\d{8}$/.test(digits) ? `0${digits}` : digits;
}
export function looksMobile(v: unknown): boolean {
  const d = restoreMobileLeadingZeroMirror(digitsOf(v));
  return (d.length === 10 || d.length === 11) && d.startsWith('01');
}
/** 칸마다 휴대폰 번호 비율(표본 최대 200행 · 분모 = 표본 행 수 · 빈 칸 · 글자 = 실패) · 비율 내림차순 */
export function scorePhoneColumns(headers: readonly string[], rows: readonly Record<string, unknown>[]): Array<{ column: string; ratio: number }> {
  if (headers.length === 0 || rows.length === 0) return [];
  const sample = rows.slice(0, 200);
  return headers
    .map((h) => ({ column: h, ratio: sample.filter((r) => looksMobile(r?.[h])).length / sample.length }))
    .sort((a, b) => b.ratio - a.ratio);
}

/**
 * ★ 2026-11-05 C107 D-08 · D-16 — 파일 표에서 받는 번호 칸을 고른다(순수).
 *   바로 담기(사람 확인 없이 명단에 더함) = 백엔드 엄격 규칙(pickPhoneColumnStrict): 1등 비율 0.9 이상 **이고** 2등과 0.3 이상 격차.
 *   아니면 null = 고르기 창(후보 = 비율 0.5 이상 칸 · 화면 규칙과 같은 임계). 머리 줄 이름은 보지 않는다(「전화」 칸이 매장 전화일 수 있다).
 *   지수 표기(1.01E+09)는 엑셀이 12자리 이상 숫자에만 쓰는 꼴이라 11자리 이하 휴대폰 번호에는 생기지 않는다.
 */
export function pickPhoneColumn(headers: readonly string[], rows: readonly Record<string, unknown>[]): { column: string | null; candidates: string[] } {
  const scores = scorePhoneColumns(headers, rows);
  const candidates = scores.filter((s) => s.ratio >= 0.5).map((s) => s.column);
  const strong = scores.length > 0 && scores[0].ratio >= 0.9 && (scores.length === 1 || scores[0].ratio - scores[1].ratio >= 0.3);
  return { column: strong ? scores[0].column : null, candidates };
}

/**
 * ★ 2026-11-05 C107 — 고른 칸의 번호(붙여넣기와 같은 읽기 = normalizePhoneKr · 10자리 이상 · 순서 · 중복 포함).
 *   머리가 없는 파일(첫 줄이 곧 번호 = 머리 이름이 휴대폰 꼴)이면 그 머리도 명단 첫 줄로 넣는다(업로드 분석이 첫 줄을 머리로 읽는다 · 판정 = looksMobile).
 */
export function phonesFromColumn(column: string, rows: readonly Record<string, unknown>[]): string[] {
  const out: string[] = [];
  const read = (v: unknown) => digitsOf(normalizePhoneKr(v));
  if (looksMobile(column)) out.push(read(column));
  for (const r of rows) {
    const p = read(r?.[column]);
    if (p.length >= 10) out.push(p);
  }
  return out;
}

/**
 * ★ 2026-11-08 C117 D8 — 받는 사람 명단의 보기용 이름(브랜드메시지 · 발송 글에 쓰지 않는다 · Harold H2).
 *   이름 칸 = 머리 이름이 표준 필드 name 의 이름 목록과 같은 칸(백엔드 standard-field-map FIELD_MAP name 의 displayName · aliases · fieldKey 미러 · 일치 = 계약 c117 B2-c).
 */
export const RECIPIENT_NAME_HEADERS: readonly string[] = ['고객명', '이름', '성함', 'name'];
export function pickNameColumn(headers: readonly string[]): string | null {
  const want = new Set(RECIPIENT_NAME_HEADERS.map((h) => h.toLowerCase()));
  return headers.find((h) => want.has(String(h ?? '').trim().toLowerCase())) ?? null;
}
/** 고른 번호 칸 · 이름 칸에서 번호(phonesFromColumn 과 같은 읽기) → 이름. 이름이 빈 줄은 넣지 않는다 */
export function namesByPhone(phoneColumn: string, nameColumn: string | null, rows: readonly Record<string, unknown>[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!nameColumn) return out;
  for (const r of rows) {
    const p = digitsOf(normalizePhoneKr(r?.[phoneColumn]));
    const n = String(r?.[nameColumn] ?? '').trim();
    if (p.length >= 10 && n) out[p] = n;
  }
  return out;
}
