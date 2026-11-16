/**
 * gated-content.ts — 로그인 뒤에만 받는 소개 그림을 글에 끼워 넣는다 (★ 2026-11-16 C136 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2-1)
 *
 * 소개 글 · 그림은 번들 · public 폴더에 없다(로그인 없이 꺼낼 수 없게 · Harold 「서비스 내용만 가져가서 복제」).
 *   서버가 준 글의 그림 자리는 `gated:파일이름` 으로 적혀 있다. 여기서 그 그림들을 로그인 토큰으로 받아 blob 주소로 바꾼다.
 *   - 하나라도 못 받으면 null(받은 것은 버린다) = 부르는 쪽은 창을 띄우지 않는다(그림 빠진 창 · 깨진 그림 0).
 *   - 다 쓴 뒤(창이 닫힘 · 화면을 떠남)에는 release() 로 blob 주소를 버린다.
 * ⛔ 받은 글 · 그림을 localStorage · sessionStorage 에 두지 않는다(로그아웃 뒤에 남지 않게).
 */
export const GATED_IMAGE_PATH = '/api/plans/gated/img/';
export const GATED_IMAGE_WAIT_MS = 15_000;

const TOKEN_SOURCE = 'gated:([a-z0-9-]{1,60}\\.(?:jpg|webp))';

/** (순수) 글 안의 그림 이름들(중복 없이 · 나온 순서) */
export function gatedImageNames(...texts: string[]): string[] {
  const out: string[] = [];
  for (const t of texts) {
    for (const m of t.matchAll(new RegExp(TOKEN_SOURCE, 'g'))) if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** (순수) 그림 자리 바꾸기(이름 → 주소) — 주소를 모르는 이름이 하나라도 있으면 null */
export function fillGatedImages(text: string, urls: ReadonlyMap<string, string>): string | null {
  let missing = false;
  const out = text.replace(new RegExp(TOKEN_SOURCE, 'g'), (_all, name: string) => {
    const u = urls.get(name);
    if (!u) missing = true;
    return u || '';
  });
  return missing ? null : out;
}

export interface GatedText { css: string; html: string }
export interface ResolvedGated extends GatedText { release: () => void }

/** 그림을 전부 받아 blob 주소로 바꾼 글 — 하나라도 못 받으면 null */
export async function resolveGated(content: GatedText, timeoutMs: number = GATED_IMAGE_WAIT_MS): Promise<ResolvedGated | null> {
  let token: string | null = null;
  try {
    token = localStorage.getItem('token');
  } catch {
    token = null;
  }
  if (!token) return null;
  const made: string[] = [];
  const release = (): void => { for (const u of made.splice(0)) URL.revokeObjectURL(u); };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  // 하나가 실패해 접은 뒤에 늦게 끝난 요청이 그림 주소를 새로 만들면 버릴 자리가 없다 → 접은 뒤에 만든 주소는 그 자리에서 버린다
  let dead = false;
  try {
    const urls = new Map<string, string>();
    await Promise.all(gatedImageNames(content.css, content.html).map(async (name) => {
      const r = await fetch(GATED_IMAGE_PATH + name, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: ctl.signal });
      if (!r.ok) throw new Error('gated image');
      const blob = await r.blob();
      if (!blob.type.startsWith('image/')) throw new Error('gated image type');
      if (dead) return;
      const u = URL.createObjectURL(blob);
      made.push(u);
      urls.set(name, u);
    }));
    const css = fillGatedImages(content.css, urls);
    const html = fillGatedImages(content.html, urls);
    if (css === null || html === null) { release(); return null; }
    return { css, html, release };
  } catch {
    dead = true;
    ctl.abort();   // 하나가 실패하면 나머지 요청도 끊는다
    release();
    return null;
  } finally {
    clearTimeout(timer);
  }
}
