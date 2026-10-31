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

/** 브랜드메시지 — 공백·쉼표·세미콜론·탭 · 숫자만 9~11자리(원래 BrandSendModal normalizePhones 규칙 그대로) */
export function checkBrandPaste(text: string): PasteCheck {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const token of String(text ?? '').split(/[\s,;\n\r\t]+/)) {
    if (!token) continue;
    const v = token.replace(/[^0-9]/g, '');
    if (v.length >= 9 && v.length <= 11) phones.push(v); else invalid.push(token);
  }
  return { phones, invalid };
}

/** 브랜드메시지 파일·직접입력 공용 — 유효한 번호만(원래 normalizePhones 와 같은 결과) */
export function normalizeBrandPhones(raw: string): string[] {
  return checkBrandPaste(raw).phones;
}

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
