/**
 * feature-interest-view.ts — 슈퍼관리자 「기능 관심 업체」 탭의 표시 판정(순수) (★ 2026-11-16 C138)
 *   Harold 「다시보지않기 누른 회사도 체크할 수 있도록 · 전부 한눈에 · 기능별관심 필요없으니까 필터」
 *   서버(backend utils/feature-interest.ts)가 준 업체 줄을 화면에서 거른다: 보기(본 회사 · 무료체험 신청 · 다시 보지 않기) + 기능.
 *   기간 · 회사(요금제) 조건은 서버가 건다. 무료체험 신청과 「다시 보지 않기」는 기간과 무관한 지금 상태다.
 */
import { loginPopupOfIntroKey } from '../constants/login-popups';

export type InterestView = 'seen' | 'trial' | 'dismissed';

export interface InterestDismissal { introKey: string; at: string; userName: string; loginId: string }
export interface InterestRowLike {
  seen: boolean;
  trial: unknown | null;
  dismissed: readonly InterestDismissal[];
  features: ReadonlyArray<{ featureId: string; opens: number }>;
}

/**
 * 서버 답 → 화면 꼴(받는 자리 한 곳) — 없는 칸은 「모름」(목록을 읽었는가) · 빈 값(줄의 배열)으로 채운다.
 *   배포 중 옛 서버의 답(무료체험 · 숨김 칸 없음 · 본 회사만 옴)이 와도 그대로 그려지고, 그 두 칸은 「알 수 없음」으로 보인다(Codex 구현 1R).
 */
export function normalizeInterest<T = any>(raw: any): { companies: T[]; trialsKnown: boolean; dismissalsKnown: boolean } {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    trialsKnown: raw?.trialsKnown === true,
    dismissalsKnown: raw?.dismissalsKnown === true,
    companies: arr(raw?.companies).filter((c: any) => c && typeof c === 'object').map((c: any) => ({
      ...c, features: arr(c.features), users: arr(c.users), events: arr(c.events),
      seen: c.seen !== false, trial: c.trial ?? null, dismissed: arr(c.dismissed),
    })),
  };
}

/** 화면에 보일 줄 — 보기 조건과 기능 조건을 함께 건다(기능 = 그 기능 · 안내 창을 본 회사만) */
export function visibleInterestRows<T extends InterestRowLike>(rows: readonly T[], view: InterestView, featureId: string): T[] {
  return rows.filter((c) => (view === 'seen' ? c.seen : view === 'trial' ? c.trial != null : c.dismissed.length > 0)
    && (featureId === 'all' || c.features.some((f) => f.featureId === featureId)));
}

/** 기능 단추의 회사 수 — 지금 보기의 줄에서 센다(기능 조건을 걸기 전 · 많은 순 · 같으면 id 순) */
export function featureCounts(rows: readonly InterestRowLike[], view: InterestView): { featureId: string; companies: number }[] {
  const m = new Map<string, number>();
  for (const c of visibleInterestRows(rows, view, 'all')) for (const f of c.features) m.set(f.featureId, (m.get(f.featureId) || 0) + 1);
  return Array.from(m, ([featureId, companies]) => ({ featureId, companies })).sort((x, y) => y.companies - x.companies || (x.featureId < y.featureId ? -1 : 1));
}

/** 「다시 보지 않기」 기록의 창 이름 — 등록부(constants/login-popups.ts)의 판 열쇠로 찾는다(모르는 열쇠 = 열쇠 그대로) */
export const dismissedPopupName = (introKey: string): string => loginPopupOfIntroKey(introKey)?.name || introKey;

/** 「다시 보지 않기」를 창별로 묶는다 — 창 이름 · 누른 사람 수 · 가장 최근 시각(같은 창의 판 열쇠 둘은 한 줄로) */
export function groupDismissed(list: readonly InterestDismissal[]): { name: string; users: number; at: string }[] {
  const m = new Map<string, { name: string; people: Set<string>; at: string }>();
  for (const d of list) {
    const name = dismissedPopupName(d.introKey);
    const v = m.get(name) || { name, people: new Set<string>(), at: d.at };
    v.people.add(d.loginId);
    if (d.at > v.at) v.at = d.at;
    m.set(name, v);
  }
  return Array.from(m.values()).map((v) => ({ name: v.name, users: v.people.size, at: v.at }));
}
