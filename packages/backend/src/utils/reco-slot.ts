/**
 * reco-slot.ts — 여정 문자 본문 안의 추천 상품 자리 문법 (★ 2026-11-13 C133 F2 ① · 설계서 docs/2026-11-13-hanjul-v3-design.md §5-4)
 *
 * 순수 파일(DB · 네트워크 0) — 보낼 글 판정 CT(send-placeholder-gate journeyCopyIssue)와 렌더(journey-message-render)가 같이 읽는다.
 *   문법 = `<추천상품: 후보1 | 후보2 | 후보3 || 대체 문장>` · 본문에 한 번 · 후보 1 ~ 3개 · 대체 문장 필수.
 *   후보가 본문 글자 안에 있어 판(스냅숏) · 켠 뒤 고친 문안 · 재검사가 본문과 함께 옮긴다(새 칸 0).
 *   렌더의 두 걸음 = 맨 앞에서 자리를 영문 · 숫자 표식으로 바꿔 두고(maskRecoSlot) 기존 길이 끝난 뒤 고른 글자로 바꾼다(fillRecoSlot)
 *   → 고른 글자가 %변수% · Liquid 로 다시 읽히지 않는다. 자리가 없는 본문은 한 글자도 달라지지 않는다.
 *   고르기(어느 후보가 그 고객에게 나가나) = product-reco.ts.
 */
import { randomBytes } from 'crypto';
import { scanSmsText, sanitizeUnsendableForSms } from './message-sanitizer';
import { detectLiquidSyntax, liquidTokens } from './liquid-templating';
import { findVarTokens } from './var-tokens';
import { UserFacingError } from './http-error';

/** 자리 머리 글자 — 이 글자열이 본문에 있으면 「자리를 쓰려는 본문」이다(꼴이 틀려도) */
export const RECO_MARK = '<추천상품';
export const RECO_MAX_CANDIDATES = 3;
const RECO_TAG_RE = /<추천상품:([^<>\n]*)>/g;
/** 후보 이름 · 대체 문장에 쓸 수 없는 글자(다른 문법의 재료) — `< >` 와 줄바꿈은 자리 꼴이 먼저 거른다 */
const RECO_FORBIDDEN_RE = /[|%{}\[\]]/;

export interface RecoSlot {
  /** 본문에 적힌 자리 글자 그대로 */
  raw: string;
  names: string[];
  fallback: string;
}
export type RecoRead = { kind: 'none' } | { kind: 'ok'; slot: RecoSlot } | { kind: 'bad'; reason: string };

export function hasRecoMark(text: string | null | undefined): boolean {
  return String(text || '').includes(RECO_MARK);
}

/**
 * (순수) 후보 이름 · 대체 문장으로 쓸 수 있는 글자인가 — 쓸 수 있으면 null · 아니면 사유 문장(자리 판정 · 후보 제안이 같은 함수).
 *   다른 문법의 재료(`< > | % { } [ ]` · 줄바꿈)와 문자로 그대로 나가지 않는 글자(뺌 · 바꿈 · 막음 = 담당자가 본 글자 ≠ 나가는 글자)를 막는다.
 */
export function recoTextIssue(t: string): string | null {
  if (/[<>\r\n]/.test(t) || RECO_FORBIDDEN_RE.test(t)) return `추천 상품 후보와 대체 문장에는 < > | % { } [ ] 와 줄바꿈을 쓸 수 없어요(「${t}」).`;
  if (scanSmsText(t).findings.length > 0) return `문자로 보낼 수 없는 글자가 든 후보예요(「${t}」). 그 글자를 빼 주세요.`;
  return null;
}

/** (순수) 본문의 추천 자리를 읽는다 — none = 자리 없음 · ok = 맞는 자리 하나 · bad = 꼴이 틀림(사유 문장) */
export function readRecoSlot(text: string | null | undefined): RecoRead {
  const s = String(text || '');
  if (!s.includes(RECO_MARK)) return { kind: 'none' };
  const bad = (reason: string): RecoRead => ({ kind: 'bad', reason });
  const tags = [...s.matchAll(RECO_TAG_RE)];
  if (tags.length !== s.split(RECO_MARK).length - 1) return bad('추천 상품 자리의 꼴이 맞지 않아요. 「추천 상품」 단추로 다시 넣어 주세요.');
  if (tags.length > 1) return bad('추천 상품 자리는 한 문안에 한 번만 넣을 수 있어요.');
  const parts = tags[0][1].split('||');
  if (parts.length !== 2) return bad('추천 상품 자리에는 대체 문장이 하나 있어야 해요.');
  const names = parts[0].split('|').map((x) => x.trim());
  const fallback = parts[1].trim();
  if (names.length < 1 || names.some((n) => !n)) return bad('추천 상품 후보가 비어 있어요.');
  if (names.length > RECO_MAX_CANDIDATES) return bad(`추천 상품 후보는 ${RECO_MAX_CANDIDATES}개까지 넣을 수 있어요.`);
  if (!fallback) return bad('추천할 상품이 없는 분에게 나갈 대체 문장을 적어 주세요.');
  if (new Set(names).size !== names.length) return bad('같은 추천 상품 후보가 두 번 들어 있어요.');
  for (const t of [...names, fallback]) {
    const why = recoTextIssue(t);
    if (why) return bad(why);
  }
  return { kind: 'ok', slot: { raw: tags[0][0], names, fallback } };
}

/** 그 자리가 낼 수 있는 글자 전부(검사 판 순서) — 후보들 · 맨 끝이 대체 문장 */
export function recoTexts(slot: RecoSlot): string[] {
  return [...slot.names, slot.fallback];
}

/** 검사 판 수 — 맞는 자리가 있으면 후보 수 + 1(대체 문장) · 없으면 0(펼치지 않는다) */
export function recoVersionCount(text: string | null | undefined): number {
  const r = readRecoSlot(text);
  return r.kind === 'ok' ? r.slot.names.length + 1 : 0;
}

/** 검사 판 이름표(담당자 안내) — 후보 이름 · 맨 끝 = 「대체 문장」 */
export function recoVersionLabel(text: string | null | undefined, index: number): string {
  const r = readRecoSlot(text);
  if (r.kind !== 'ok') return '';
  return index < r.slot.names.length ? r.slot.names[index] : '대체 문장';
}

/**
 * 영문 대문자 · 숫자로만 된 표식(다른 문법의 글자가 하나도 없다) — **부를 때마다 새로 뽑는 긴 무작위 글자열**.
 *   채우기는 렌더가 끝난 글 전체에서 표식을 찾는다. 그 글에는 본문뿐 아니라 고객 값 · 회사 값도 들어 있으므로, 미리 알 수 있는 고정 표식은
 *   그 값과 겹칠 수 있다(고객 이름이 표식과 같으면 이름까지 후보로 바뀐다 · Codex 구현 1R #2). 무작위 96비트는 저장된 값과 겹치지 않는다.
 */
function recoToken(text: string): string {
  for (;;) {
    const t = `HJRECO${randomBytes(12).toString('hex').toUpperCase()}`;
    if (!text.includes(t)) return t;
  }
}

/** 판정용 자리 표시 — 영문 대문자 · 숫자 7자 · 본문에 없는 것(글자 정리가 건드리지 않고 · 변수 이름의 첫 글자가 될 수 있다) */
function probeFor(text: string): string {
  for (;;) {
    const t = `Z${randomBytes(3).toString('hex').toUpperCase()}`;
    if (!text.includes(t)) return t;
  }
}

/** (순수) 렌더 첫 걸음 — 맞는 자리 하나를 표식으로 바꾼다. 자리가 없거나 꼴이 틀리면 null(본문을 한 글자도 건드리지 않는다) */
export function maskRecoSlot(template: string): { template: string; slot: RecoSlot; token: string } | null {
  const r = readRecoSlot(template);
  if (r.kind !== 'ok') return null;
  const token = recoToken(template);
  return { template: template.replace(r.slot.raw, () => token), slot: r.slot, token };
}

/**
 * (순수) 렌더 끝 걸음 — 표식을 고른 글자로(치환 문법 `$&` 가 끼어들지 않게 잘라 붙인다).
 *   **표식이 그 글에 정확히 한 번 있을 때만** 채운다. 아니면 null = 자리가 기존 길에서 사라졌거나(0번) 불어났다(2번 이상).
 *   렌더 길에는 고객 값에 따라 달라지는 단계(Liquid 평가 · 남은 태그 지우기)가 있어, 미리 읽는 판정(recoSlotIssue)만으로는
 *   「이 고객의 글에서 자리가 살아남는가」를 다 알 수 없다 — 그래서 채우는 이 자리가 마지막 판정이다(Codex 구현 1R #1 · 2R #1 #2 · 3R #1).
 */
export function fillRecoSlot(message: string, token: string, text: string): string | null {
  const parts = message.split(token);
  return parts.length === 2 ? parts.join(text) : null;
}

/**
 * 추천 자리가 받는 글에서 사라졌다(또는 불어났다) — 그 렌더는 쓸 수 없다.
 *   검사 = 통과가 아니다(고칠 글) · 발송 = 그 고객에게 보내지 않는다 · 미리보기 = 이 문장을 보인다. 조용히 자리 없는 글을 돌려주지 않는다.
 */
export class RecoSlotLostError extends UserFacingError {
  constructor() {
    super(400, 'RECO_SLOT_LOST', '추천 상품 자리가 받는 글에서 사라졌어요. 자리 앞뒤의 {{ }} 표기를 고친 뒤 다시 확인해 주세요.');
    this.name = 'RecoSlotLostError';
  }
}

/**
 * (순수) 보낼 글 판정(CT-J10)이 부르는 자리 판정 — 문제가 없으면 null · 있으면 담당자에게 보일 문장.
 *   자리가 없는 본문 = 늘 null(판정 결과가 종전과 같다).
 *   allowed = 그 회사에 추천 상품이 열려 있는가 · hasVariants = 그 칸이 문안 A/B 를 쓰는가.
 */
export function recoSlotIssue(body: string | null | undefined, o: { allowed: boolean; hasVariants: boolean }): string | null {
  const r = readRecoSlot(body);
  if (r.kind === 'none') return null;
  if (!o.allowed) return '이 회사에는 추천 상품이 열려 있지 않아요. 추천 상품 자리를 지워 주세요.';
  if (r.kind === 'bad') return r.reason;
  if (o.hasVariants) return '문안 A/B 를 쓰는 칸에는 추천 상품을 넣을 수 없어요.';
  // ★ Codex 구현 1R #1 · 2R #1 #2 — 판정은 **렌더가 읽는 그 글을 렌더와 같은 파서로** 읽는다(원문을 정규식으로 따로 읽지 않는다).
  //   옛: 원문에서 `{%` 글자와 `{{ … }}` 를 정규식으로 찾았다 → 렌더의 글자 정리가 숨은 글자를 지워 생기는 조건문 · 따옴표 안의 `}` 를 못 봤다.
  //   지금: 자리를 판정용 자리 표시로 바꾸고 → 렌더와 같은 글자 정리(sanitizeUnsendableForSms) → 렌더의 토큰 분해(liquidTokens).
  //   · 태그({% … %})가 하나라도 있으면 막는다 — 조건 갈래 안의 자리는 표본 고객의 조건이 거짓이면 렌더에서 사라져 모든 검사 판이
  //     「후보 없는 같은 글」이 되고, 조건이 참인 고객에게는 검사하지 않은 후보가 나간다. 태그가 없으면 글 조각은 렌더에서 사라지지 않는다.
  //   · 자리 표시는 글 조각 안에 정확히 한 번 있어야 한다(출력식 `{{ … }}` 안 = 막음 · 파서가 못 읽는 글 = 막음).
  //   · 그 글에서 자리 표시가 %변수% 조각 안이면 막는다. 자리 표시는 짧다(7자) — 렌더용 표식(30자)보다 짧아 변수 조각 판정이 더 넓게 잡는다.
  const text = String(body || '');
  const probe = probeFor(text);
  const seen = sanitizeUnsendableForSms(text.replace(r.slot.raw, () => probe)).sanitized;
  let tokens: Array<{ type: 'text' | 'output' | 'tag'; value: string }>;
  try { tokens = detectLiquidSyntax(seen) ? liquidTokens(seen) : [{ type: 'text', value: seen }]; }
  catch { return '문안의 {{ }} · {% %} 꼴이 닫히지 않았어요. 그 부분을 고친 뒤 추천 상품을 넣어 주세요.'; }
  if (tokens.some((t) => t.type === 'tag')) return '조건문({% %})이 든 문안에는 추천 상품을 넣을 수 없어요. 조건마다 받는 글이 달라 후보를 전부 검사할 수 없어요.';
  const inText = tokens.filter((t) => t.type === 'text').reduce((n, t) => n + (t.value.split(probe).length - 1), 0);
  const inVar = findVarTokens(seen).some((t) => t.name.includes(probe));
  if (inText !== 1 || inVar) return '추천 상품 자리는 %변수% 나 {{ }} 안에 넣을 수 없어요. 문장 안에 따로 넣어 주세요.';
  return null;
}
