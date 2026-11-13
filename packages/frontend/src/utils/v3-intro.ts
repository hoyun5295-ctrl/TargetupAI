/**
 * v3-intro.ts — 로그인 직후 「한줄로 V3」 소개 창의 서버 호출 (★ 2026-11-13 C133 F7 · 설계서 docs/2026-11-13-hanjul-v3-design.md §2)
 *
 * 띄울지는 서버가 정한다(계정당 최대 3번 · 로그인당 1번 · 「다시 보지 않기」 = 영구 · backend utils/v3-intro.ts).
 * 묻는 것이 곧 노출 한 번을 쓰는 것이므로, 이 로그인에서 기기 표식을 잡은 탭만 부른다(AiOperatorLoginPromo).
 * 모르면 띄우지 않는다 — 응답 실패 · 시간 제한 · 표 없음(503) · 꼴이 다른 응답 = null.
 */
import { sendJson } from './dashboard-live';

export interface V3IntroPoster { id: string; url: string }
export interface V3IntroChip { key: string; label: string; text: string }
export interface V3Intro { posters: V3IntroPoster[]; chips: V3IntroChip[] }

/** 서버 선점 — 띄우라는 답일 때만 포스터 · 칩을 돌려준다 */
export async function claimV3Intro(): Promise<V3Intro | null> {
  if (!localStorage.getItem('token')) return null;
  const r = await sendJson('/api/plans/v3-intro/claim', { method: 'POST' });
  const d: any = r.body;
  if (!r.ok || !d?.success || d.show !== true) return null;
  const posters: V3IntroPoster[] = Array.isArray(d.posters)
    ? d.posters.filter((p: any) => p && typeof p.id === 'string' && typeof p.url === 'string')
    : [];
  const chips: V3IntroChip[] = Array.isArray(d.chips)
    ? d.chips.filter((c: any) => c && typeof c.key === 'string' && typeof c.label === 'string' && typeof c.text === 'string')
    : [];
  if (posters.length === 0) return null;
  return { posters, chips };
}

/** 「이 소개 다시 보지 않기」 — 저장됐으면 true */
export async function dismissV3Intro(): Promise<boolean> {
  if (!localStorage.getItem('token')) return false;
  const r = await sendJson('/api/plans/v3-intro/dismiss', { method: 'POST' });
  return r.ok && (r.body as any)?.success === true;
}
