/**
 * product-signal-text.ts — 받는 사람에게 보이는 상품 반응 숫자의 글자 (★ 2026-11-14 C133 F2 ② · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-3 · §18)
 *
 * 순수 파일(DB · 네트워크 0) — DM 발행 렌더 · 이메일 렌더가 같이 읽는다(화면 짝 = frontend utils/product-signal-text.ts).
 *   글자 = 「최근 30일 조회 1,240번」 한 꼴. 서버가 만든다(signalTextOf) · 담당자가 「반응 숫자 표시」를 켤 때 받아 문서에 고정한다
 *   (보여 줄 때 다시 세지 않는다 = 저장한 글자가 그대로 나간다).
 *   그리는 조건(signalLineOf) — 셋 다 맞을 때만:
 *     ① 그 묶음이 켜져 있다(show_signal)
 *     ② 글자가 서버가 만드는 꼴 그대로다(그 자리에 다른 문구 = 순위 · 재고 약속 등을 실을 수 없다)
 *     ③ 그 숫자를 센 상품 이름(signal_name)이 지금 상품 이름과 같다(이름을 바꾼 상품에 옛 상품의 숫자가 붙지 않는다)
 */

/**
 * 상품 이름 비교용 정리 — 공백류 여섯 글자(공백 · 탭 · 줄바꿈 · CR · FF · VT)를 공백 하나로 접고 → 앞뒤 공백 하나를 뗀다 → 소문자 · 빈 값 = null.
 *   SQL 짝 = product-signal normNameSql(같은 글자 집합 · JS 의 \s · trim 을 쓰지 않는다 = PG 와 글자 집합이 다르다).
 */
export function normProductName(v: unknown): string | null {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ | $/g, '').toLowerCase();
  return s === '' ? null : s;
}

/** 서버가 만드는 글자의 꼴(이 꼴이 아니면 그리지 않는다) */
export const SIGNAL_TEXT_RE = /^최근 [1-9]\d{0,2}일 조회 [1-9]\d{0,2}(,\d{3})*번$/;

/** 조회 수 → 글자. 조회가 없으면(0 · 숫자 아님) null = 글자 없음(지어낸 숫자 0) */
export function signalTextOf(views: number, windowDays: number): string | null {
  const n = Math.floor(Number(views));
  const d = Math.floor(Number(windowDays));
  if (!Number.isFinite(n) || n < 1 || !Number.isFinite(d) || d < 1) return null;
  return `최근 ${d}일 조회 ${n.toLocaleString('ko-KR')}번`;
}

/** 그 상품 카드에 그릴 반응 숫자 글자 — 그리지 않으면 null(위 세 조건) */
export function signalLineOf(props: unknown, item: unknown): string | null {
  const p = props as { show_signal?: unknown } | null;
  const it = item as { signal_text?: unknown; signal_name?: unknown; name?: unknown } | null;
  if (p?.show_signal !== true) return null;
  const text = typeof it?.signal_text === 'string' ? it.signal_text : '';
  if (!SIGNAL_TEXT_RE.test(text)) return null;
  const name = normProductName(it?.name);
  if (!name || normProductName(it?.signal_name) !== name) return null;
  return text;
}

/** (순수) i번째를 맨 앞으로 — 나머지는 저장한 순서 그대로 · 범위 밖 · 0번 · 정수 아님 = 그대로 */
export function moveToFront<T>(items: readonly T[], i: unknown): T[] {
  if (typeof i !== 'number' || !Number.isInteger(i) || i <= 0 || i >= items.length) return [...items];
  return [items[i], ...items.slice(0, i), ...items.slice(i + 1)];
}

/**
 * ★ 2026-11-14 C133 F2 ① 「받는 분마다 관심 상품을 앞에」 — 그 묶음을 그릴 상품 순서(발행 렌더 · 이메일 렌더 공용).
 *   reco_order 가 켜져 있고 · 그 받는 사람에게 앞세울 자리(reco_front · 열람 · 발송 길이 그 사람 것으로 싣는다 = dm-reco-order)가 있으면 그 상품을 맨 앞으로.
 *   꺼져 있거나 자리가 없으면 저장한 순서 그대로(옛 출력 그대로). 상품이 늘거나 줄지 않는다(순서만).
 */
export function recoOrderedProducts<T>(props: { reco_order?: unknown; reco_front?: unknown; products?: readonly T[] | null } | null | undefined): T[] {
  const products = Array.isArray(props?.products) ? (props!.products as readonly T[]) : [];
  return props?.reco_order === true ? moveToFront(products, props.reco_front) : [...products];
}
