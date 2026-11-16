/**
 * v3-intro.ts — 로그인 직후 안내 창(「한줄로 V3」 장면 창 · 무료체험 창)의 서버 호출
 *   (★ 2026-11-13 C133 F7 · 설계서 docs/2026-11-13-hanjul-v3-design.md §2 → ★ 2026-11-16 C136 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §2-1)
 *
 * 띄울지 · 어느 판인지는 서버가 정한다(계정당 최대 3번 · 로그인당 1번 · 「다시 보지 않기」 = 영구 · backend utils/v3-intro.ts).
 * ★ C136 — 순서 = 준비(peek) → 그림 받기(utils/gated-content) → 선점(claim).
 *   준비는 노출을 쓰지 않는다. 선점이 노출 한 번을 쓴다 → 그림을 못 받은 로그인은 선점하지 않는다(노출 수를 태우지 않는다).
 *   선점은 준비한 판의 열쇠를 싣는다 — 그 사이 판이 바뀌었으면 서버가 선점하지 않는다.
 * 모르면 띄우지 않는다 — 응답 실패 · 시간 제한 · 표 없음(503) · 꼴이 다른 응답 = null · false.
 */
import { fetchJson, sendJson } from './dashboard-live';

export type V3IntroVariant = 'scenes' | 'trial';
/** 창의 글(그림 자리 = gated:파일이름) · sets = 움직임이 쓰는 업종 셋(꼴 확인은 v3-motion readMorphSets) */
export interface V3IntroContent { css: string; html: string; sets: unknown }
export interface V3IntroPeek { introKey: string; variant: V3IntroVariant; content: V3IntroContent }

/** 준비 — 이 로그인에 띄울 판과 그 판의 글(노출을 쓰지 않는다) · 띄울 것이 없으면 null */
export async function peekV3Intro(): Promise<V3IntroPeek | null> {
  if (!localStorage.getItem('token')) return null;
  const r = await fetchJson('/api/plans/v3-intro/peek');
  const d: any = r.body;
  if (!r.ok || d?.success !== true || typeof d.introKey !== 'string') return null;
  if (d.variant !== 'scenes' && d.variant !== 'trial') return null;
  const c = d.content;
  if (!c || typeof c.css !== 'string' || typeof c.html !== 'string' || !c.css || !c.html) return null;
  return { introKey: d.introKey, variant: d.variant, content: { css: c.css, html: c.html, sets: c.sets } };
}

/** 선점 — 준비한 판의 열쇠로. 서버가 그 판을 잡았다고 답했을 때만 true(이때 노출 한 번이 쓰였다) */
export async function claimV3Intro(introKey: string): Promise<boolean> {
  if (!localStorage.getItem('token')) return false;
  const r = await sendJson('/api/plans/v3-intro/claim', { method: 'POST', body: { introKey } });
  const d: any = r.body;
  return r.ok && d?.success === true && d.show === true && d.introKey === introKey;
}

/** 「다시 보지 않기」 — 저장됐으면 true. introKey = 숨길 창의 판 열쇠(언제나 싣는다 · 열쇠 없는 요청은 서버가 옛 판에 적는다) */
export async function dismissV3Intro(introKey: string): Promise<boolean> {
  if (!localStorage.getItem('token')) return false;
  const r = await sendJson('/api/plans/v3-intro/dismiss', { method: 'POST', body: { introKey } });
  return r.ok && (r.body as any)?.success === true;
}
