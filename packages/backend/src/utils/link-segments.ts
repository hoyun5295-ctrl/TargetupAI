/**
 * link-segments.ts — ★ 2026-11-20 글 속 주소 조각 읽기(순수 · DB 무의존 · one-line-steps 에서 글자 그대로 옮김)
 *   옮긴 까닭 = 링크 구간 읽기(voice-form-slots linkSpans)와 AI 문자 꼴 정리(ai-sms-layout)가 DB 를 끌어오는 one-line-steps 없이 같은 규칙을 쓰게.
 *   one-line-steps 는 같은 이름으로 다시 내보낸다(옛 import 무변경).
 */

export const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/**
 * ★ 2026-10-31 (순수) 주소 끝 떼기 한 곳 — 끝 문장부호 · 닫는 따옴표 · 괄호(」』] 등)는 떼고, 닫는 소괄호 `)` 는 짝이 모자랄 때만 뗀다
 *   (경로 안 item(v2) 같은 괄호는 지킨다 · Codex 1031 · lineUrls · lineUrlSegments · 링크 구간 읽기(voice-form-slots linkSpans)가 같은 규칙).
 */
export function trimLinkTail(s: string): string {
  let t = String(s || '');
  for (;;) {
    const c = t.slice(-1);
    if (!c) break;
    if ('.,·!?~"\'」』]>'.includes(c)) { t = t.slice(0, -1); continue; }
    if (c === ')' && t.split(')').length > t.split('(').length) { t = t.slice(0, -1); continue; }
    break;
  }
  return t;
}

/** (순수) 한 줄 속 주소(앞에서부터 · 끝 문장부호 제거 = trimLinkTail) */
export function lineUrls(line: string): string[] {
  const out: string[] = [];
  for (const m of String(line || '').matchAll(URL_RE)) {
    const u = trimLinkTail(m[0]);
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * ★ 2026-10-31 (순수) 글을 주소 구간과 일반 글 구간으로 나눈다(lineUrls 와 같은 읽기 · 주소 구간 = 꺼낸 주소 url + 끝 문장부호 tail).
 *   주소가 같은가 = 꺼낸 주소가 글자 그대로 같은가 · 주소 구간은 통째로만 다룬다(설계서 docs/2026-10-31-ai-line-answer-link-design.md · Codex 구현 1R ②③ · 2R).
 */
export function lineUrlSegments(text: string): Array<{ url: string; tail: string } | { text: string }> {
  const src = String(text || '');
  const out: Array<{ url: string; tail: string } | { text: string }> = [];
  let at = 0;
  for (const m of src.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: src.slice(at, i) });
    const url = trimLinkTail(m[0]);
    out.push({ url, tail: m[0].slice(url.length) });
    at = i + m[0].length;
  }
  if (at < src.length) out.push({ text: src.slice(at) });
  return out;
}
