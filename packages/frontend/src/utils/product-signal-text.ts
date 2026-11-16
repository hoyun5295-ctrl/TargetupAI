/**
 * product-signal-text.ts — 상품 카드의 반응 숫자 글자 · 화면 쪽 판정 (★ 2026-11-14 C133 F2 ②)
 *
 * 서버 짝 = packages/backend/src/utils/product-signal-text.ts(글자를 만드는 주인 · 발행 렌더 · 이메일 렌더가 같은 함수를 쓴다).
 *   편집 캔버스는 발행물과 같은 조건으로만 그 줄을 그린다(켜짐 · 서버가 만든 꼴 · 그 숫자를 센 이름 = 지금 이름) — 계약 시험이 두 판정을 견준다.
 */

/** 상품 이름 비교용 정리(서버 normProductName 과 같은 여섯 글자 · 같은 순서) */
export function normProductName(v: unknown): string | null {
  if (v === null || v === undefined || typeof v === 'object') return null;
  const s = String(v).replace(/[ \t\n\r\f\v]+/g, ' ').replace(/^ | $/g, '').toLowerCase();
  return s === '' ? null : s;
}

/** 서버가 만드는 글자의 꼴 */
export const SIGNAL_TEXT_RE = /^최근 [1-9]\d{0,2}일 조회 [1-9]\d{0,2}(,\d{3})*번$/;

/** 그 상품 카드에 그릴 반응 숫자 글자 — 그리지 않으면 null */
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

type Signaled<T> = T & { signal_text: string; signal_name: string };

/**
 * 불러온 글자를 상품 목록에 싣는다(입력은 바꾸지 않는다) — 글자가 온 이름 = 글자 + 그 숫자를 센 이름 · 오지 않은 이름 = 둘 다 비운다(옛 숫자가 남지 않는다).
 *   texts = 서버 응답(JSON 객체 · 열쇠 = 요청한 이름 그대로) — 글자인 값만 읽는다(이름이 constructor 인 상품이 객체의 기본 속성 = 함수를 집지 않는다).
 */
export function withSignalTexts<T extends { name?: string }>(products: readonly T[], texts: unknown): Array<Signaled<T>> {
  const textOf = (name: string): string => {
    const v = texts !== null && typeof texts === 'object' ? (texts as Record<string, unknown>)[name] : '';
    return typeof v === 'string' ? v : '';
  };
  return products.map((p) => {
    const name = p.name || '';
    const text = textOf(name);
    return text ? { ...p, signal_text: text, signal_name: name } : { ...p, signal_text: '', signal_name: '' };
  });
}

/**
 * 불러오기 한 차례의 차례표 — 비동기 불러오기는 첫 기다림 앞에서 차례를 받고, 돌아오면 아직 그 차례인지 본다.
 *   take() = 새 차례를 받는다(앞 차례는 끝난다) → 「아직 내 차례인가」 · end() = 지금 차례를 끝낸다(끄기 · 빼기 · 그 화면이 내려감).
 */
export function oneTurn(): { take: () => () => boolean; end: () => void } {
  let n = 0;
  return { take: () => { const mine = ++n; return () => mine === n; }, end: () => { n += 1; } };
}

export type SignalLoadResult = { kind: 'stale' } | { kind: 'failed'; status: number } | { kind: 'done'; count: number };

/**
 * 반응 숫자 불러오기 한 차례(★ 2026-11-14 C133 Codex 구현 C-2 1R) — 상품 묶음 편집기가 부르고, 행동 시험이 이 함수를 그대로 돌린다.
 *   ① 기다리기 전에 차례를 받는다 ② 돌아왔을 때 끝난 차례면 아무것도 쓰지 않는다('stale' = 부른 쪽도 안내 · 잠금을 건드리지 않는다)
 *   ③ 쓰는 곳 = 돌아온 순간의 판(now()) — 불러오는 동안 고친 상품 · 다른 칸을 요청 때의 옛 값으로 덮지 않는다.
 *   옛: 응답이 요청 때의 쓰는 함수와 그 뒤의 상품 목록을 섞어 써서, 다른 묶음의 상품이 실리거나 끈 표시 · 뺀 숫자가 되살아났다.
 */
export async function loadSignalTurn<T extends { name?: string }>(o: {
  turn: { take: () => () => boolean };
  fetchTexts: (names: string[]) => Promise<{ ok: boolean; status: number; texts: unknown }>;
  now: () => { products: readonly T[]; onUpdate: (patch: { show_signal: true; products: Array<Signaled<T>> }) => void };
}): Promise<SignalLoadResult> {
  const mine = o.turn.take();
  const r = await o.fetchTexts(o.now().products.map((p) => p.name || '')).catch(() => ({ ok: false, status: 0, texts: null }));
  if (!mine()) return { kind: 'stale' };
  if (!r.ok) return { kind: 'failed', status: r.status };
  const { products, onUpdate } = o.now();
  const withSignals = withSignalTexts(products, r.texts);
  onUpdate({ show_signal: true, products: withSignals });
  return { kind: 'done', count: withSignals.filter((p) => p.signal_text).length };
}
