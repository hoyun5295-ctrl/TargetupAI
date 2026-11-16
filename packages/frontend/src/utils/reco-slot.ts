/**
 * reco-slot.ts — 여정 문자 본문 안의 추천 상품 자리 · 화면 쪽 읽기 (★ 2026-11-13 C133 F2 ①)
 *
 * 서버 짝 = packages/backend/src/utils/reco-slot.ts(판정의 주인 · 저장 · 켜기 · 발송이 그 함수를 지난다).
 *   화면은 「지금 본문에 자리가 있는가 · 무엇이 들어 있는가」를 읽어 보여 주고, 자리 글자를 만들어 넣기만 한다.
 *   문법 = `<추천상품: 후보1 | 후보2 | 후보3 || 대체 문장>` · 본문에 한 번 · 후보 1 ~ 3개 · 대체 문장 필수.
 *   ⛔ 문자로 보낼 수 없는 글자(이모지 등) 판정은 서버만 한다 — 화면은 다른 문법의 글자만 미리 막는다(계약 시험이 그 차이를 적어 둔다).
 */
export const RECO_MARK = '<추천상품';
const RECO_TAG_RE = /<추천상품:([^<>\n]*)>/g;
/** 후보 이름 · 대체 문장에 쓸 수 없는 글자(다른 문법의 재료) */
const RECO_FORBIDDEN_RE = /[<>|%{}\[\]\r\n]/;

export interface RecoSlot { raw: string; names: string[]; fallback: string }
export type RecoRead = { kind: 'none' } | { kind: 'ok'; slot: RecoSlot } | { kind: 'bad' };

export function hasRecoMark(text: string | null | undefined): boolean {
  return String(text || '').includes(RECO_MARK);
}

/** 다른 문법의 글자가 들었는가(서버 recoTextIssue 의 첫 갈래와 같은 글자) */
export function recoTextForbidden(t: string): boolean {
  return RECO_FORBIDDEN_RE.test(t);
}

/** 본문의 추천 자리 — none = 없음 · ok = 맞는 자리 하나 · bad = 꼴이 틀림(사유 문장은 서버가 저장 · 켜기 때 준다) */
export function readRecoSlot(text: string | null | undefined, maxCandidates = 3): RecoRead {
  const s = String(text || '');
  if (!s.includes(RECO_MARK)) return { kind: 'none' };
  const tags = [...s.matchAll(RECO_TAG_RE)];
  if (tags.length !== 1 || s.split(RECO_MARK).length - 1 !== 1) return { kind: 'bad' };
  const parts = tags[0][1].split('||');
  if (parts.length !== 2) return { kind: 'bad' };
  const names = parts[0].split('|').map((x) => x.trim());
  const fallback = parts[1].trim();
  if (names.length < 1 || names.length > maxCandidates || names.some((n) => !n) || !fallback) return { kind: 'bad' };
  if (new Set(names).size !== names.length) return { kind: 'bad' };
  if ([...names, fallback].some(recoTextForbidden)) return { kind: 'bad' };
  return { kind: 'ok', slot: { raw: tags[0][0], names, fallback } };
}

/** 자리 글자를 만든다(넣기 · 고치기) */
export function buildRecoTag(names: readonly string[], fallback: string): string {
  return `<추천상품: ${names.map((n) => n.trim()).join(' | ')} || ${fallback.trim()}>`;
}

/** 그 자리가 낼 수 있는 글자(검사 판 순서) — 후보들 · 맨 끝이 대체 문장 */
export function recoTexts(slot: RecoSlot): string[] {
  return [...slot.names, slot.fallback];
}

/**
 * 그 글이 낼 수 있는 **완성된 판 전부**(검사 판 순서 = 후보들 · 맨 끝 대체 문장) — 자리가 없거나 꼴이 틀리면 null.
 *   서버 렌더와 같은 순서로 만든다: 자리를 표식으로 바꾸고 → compose(고객 값 · 광고 표기 합성) → 판마다 표식을 그 글자로.
 *   ⛔ 글자를 먼저 넣고 합성하지 않는다 — 광고 합성은 본문에 수신거부 문구가 있으면 꼬리 줄을 붙이지 않는다. 대체 문장에 그 문구가 있으면
 *     화면만 꼬리 줄을 뺀 바이트를 보였다(서버는 표식을 둔 채 합성해 꼬리 줄을 붙인다 · Codex 구현 2R #4).
 *   바이트 = 이 판들 가운데 가장 큰 것(편집기가 calculateSmsBytes 로 잰다 · 글자 수가 아니다).
 *   합성이 표식을 지우거나 불리면(초안의 화면 치환이 조건 갈래를 지움 등) null — 화면은 자리 글자가 든 원문 그대로 보인다(서버가 저장 · 켜기 때 막는다).
 */
export function recoComposedVersions(text: string, compose: (masked: string) => string): string[] | null {
  const r = readRecoSlot(text);
  if (r.kind !== 'ok') return null;
  // 표식 = 부를 때마다 새로 뽑는 긴 무작위 글자열(서버와 같다). compose 는 고객 값을 넣는다 — 고정 표식은 그 값과 겹칠 수 있다(Codex 구현 3R #2).
  const token = `HJRECO${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  // 합성 결과에 표식이 정확히 한 번 있을 때만 판을 만든다(서버 fillRecoSlot 과 같은 불변식) — 아니면 null(판을 지어내지 않는다)
  const parts = compose(text.split(r.slot.raw).join(token)).split(token);
  if (parts.length !== 2) return null;
  return recoTexts(r.slot).map((t) => parts.join(t));
}

/** 자리를 본문에서 뺀다(맞는 자리만 · 꼴이 틀린 자리는 담당자가 직접 지운다) */
export function removeRecoSlot(text: string): string {
  const r = readRecoSlot(text);
  return r.kind === 'ok' ? text.split(r.slot.raw).join('') : text;
}
