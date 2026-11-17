/**
 * feature-interest-view.ts — 슈퍼관리자 「기능 관심 업체」 탭의 표시 판정(순수)
 *   ★ 2026-11-16 C138 = 받는 자리 정규화 · 「다시 보지 않기」 묶음
 *   ★ 2026-11-17 C141 통합안(Harold 「정신없다 · 무료체험이 누구인지도 모르겠다」 · 설계 docs/2026-11-17-c141-feature-interest-redesign-design.md)
 *     = 단계 넷(7일 무료체험 중 · 이미지 체험 신청 · 버튼만 누름 · 보기만 함) · 안내별 수(본 회사 → 누른 회사 → 결과) · 본 것 문장 · 최근 일어난 일.
 *   서버(backend utils/feature-interest.ts)가 준 업체 줄에서만 센다(서버는 요약 수를 내지 않는다 · 숫자가 한 벌).
 *   기간 · 회사(요금제) 조건은 서버가 건다. 체험 둘과 「다시 보지 않기」는 기간과 무관한 지금 상태다.
 */
import { LOGIN_POPUPS, LINE_TRIAL_BANNER_ID, STUDIO_TRIAL_POPUP_ID, loginPopupOf, loginPopupOfIntroKey } from '../constants/login-popups';

export interface InterestDismissal { introKey: string; at: string; userName: string; loginId: string }
export interface InterestFeature { featureId: string; opens: number; clicks: number }
export interface InterestStudioTrial { requestedBy: string; requestedAt: string; used: number; granted: number }
export interface InterestLineTrial { source: 'banner' | 'diagnosis' | 'admin'; grantedAt: string; grantedBy: string; alive: boolean; daysLeft: number | null; endsAt: string | null }
export interface InterestEvent { at: string; event: 'open' | 'pricing' | 'go'; featureId: string; userName: string }
export interface InterestRowLike {
  companyId: string;
  companyName: string;
  seen: boolean;
  lastAt: string;
  pricingClicks: number;
  goClicks: number;
  features: readonly InterestFeature[];
  trial: InterestStudioTrial | null;
  lineTrial: InterestLineTrial | null;
  dismissed: readonly InterestDismissal[];
  events: readonly InterestEvent[];
  /** 최근 누름(열람 제외 · 서버가 상세 기록과 따로 읽는다 · 「최근 일어난 일」의 원천) */
  recentClicks: readonly InterestEvent[];
}

/**
 * 서버 답 → 화면 꼴(받는 자리 한 곳) — 없는 칸은 「모름」(목록을 읽었는가) · 빈 값으로 채운다.
 *   배포 중 옛 서버의 답(체험 · 숨김 칸 없음 · 기능 줄에 누른 수 없음)이 와도 그대로 그려지고 모르는 단계는 「읽지 못했습니다」로 보인다.
 */
export function normalizeInterest<T = any>(raw: any): { companies: T[]; trialsKnown: boolean; dismissalsKnown: boolean; lineTrialsKnown: boolean } {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    trialsKnown: raw?.trialsKnown === true,
    dismissalsKnown: raw?.dismissalsKnown === true,
    lineTrialsKnown: raw?.lineTrialsKnown === true,
    companies: arr(raw?.companies).filter((c: any) => c && typeof c === 'object').map((c: any) => ({
      ...c,
      features: arr(c.features).filter((f: any) => f && typeof f === 'object').map((f: any) => ({ ...f, opens: num(f.opens), clicks: num(f.clicks) })),
      users: arr(c.users), events: arr(c.events),
      recentClicks: arr(c.recentClicks).filter((e: any) => e && (e.event === 'go' || e.event === 'pricing')),
      pricingClicks: num(c.pricingClicks), goClicks: num(c.goClicks),
      seen: c.seen !== false, trial: c.trial ?? null, lineTrial: c.lineTrial ?? null, dismissed: arr(c.dismissed),
    })),
  };
}

// ── 단계 ────────────────────────────────────────────────────────────────
export type InterestStage = 'line' | 'studio' | 'pressed' | 'seen';
export const STAGES: ReadonlyArray<{ key: InterestStage; name: string; order: string; note: string }> = [
  { key: 'line', name: '7일 무료체험 중', order: '곧 끝나는 순서', note: '대시보드 배너 · 진단 · 부여로 요금제를 7일 연 회사' },
  { key: 'studio', name: '이미지 체험 신청', order: '최근에 신청한 순서', note: '이미지 스튜디오 3장 체험을 신청한 회사' },
  { key: 'pressed', name: '버튼만 누름', order: '최근 순서', note: '안내에서 버튼을 눌렀지만 체험은 아닌 회사' },
  { key: 'seen', name: '보기만 함', order: '최근 순서', note: '안내를 봤지만 아무것도 누르지 않은 회사' },
];
const isLine = (c: InterestRowLike) => c.lineTrial?.alive === true;
const isStudio = (c: InterestRowLike) => c.trial != null;
const isPressed = (c: InterestRowLike) => c.pricingClicks + c.goClicks > 0;

/** 그 단계의 회사인가 — 체험 둘은 겹칠 수 있다(두 칸에 다 센다) · 버튼만 누름 · 보기만 함은 체험이 아닌 회사를 나눈다 */
export function inStage(c: InterestRowLike, stage: InterestStage): boolean {
  if (stage === 'line') return isLine(c);
  if (stage === 'studio') return isStudio(c);
  if (isLine(c) || isStudio(c)) return false;
  return stage === 'pressed' ? isPressed(c) : !isPressed(c);
}

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
/** 그 단계의 줄(새 배열 · 7일 체험 = 남은 날 적은 순 → 최근에 켠 순 · 이미지 체험 = 최근 신청 순 · 그 밖 = 받은 순서 = 최근 일어난 순) */
export function stageRows<T extends InterestRowLike>(rows: readonly T[], stage: InterestStage): T[] {
  const list = rows.filter((c) => inStage(c, stage));
  if (stage === 'line') return list.sort((x, y) => (x.lineTrial!.daysLeft ?? 99) - (y.lineTrial!.daysLeft ?? 99) || desc(x.lineTrial!.grantedAt, y.lineTrial!.grantedAt));
  if (stage === 'studio') return list.sort((x, y) => desc(x.trial!.requestedAt, y.trial!.requestedAt));
  return list;
}

export function stageCounts(rows: readonly InterestRowLike[]): Record<InterestStage, number> {
  return { line: rows.filter(isLine).length, studio: rows.filter(isStudio).length, pressed: rows.filter((c) => inStage(c, 'pressed')).length, seen: rows.filter((c) => inStage(c, 'seen')).length };
}

// ── 안내 ────────────────────────────────────────────────────────────────
/** 등록부 밖의 안내(AI 오퍼레이터의 잠긴 기능 안내 창 전부)를 하나로 묶는 열쇠 */
export const FEATURE_GUIDE = 'feature-intros';
export const guideOf = (featureId: string): string => (loginPopupOf(featureId) ? featureId : FEATURE_GUIDE);
export const guideName = (key: string): string => (key === FEATURE_GUIDE ? '기능 안내 창' : loginPopupOf(key)?.name || key);
/** 그 안내를 본(또는 누른) 회사인가 */
export const sawGuide = (c: InterestRowLike, key: string): boolean => c.features.some((f) => guideOf(f.featureId) === key && f.opens + f.clicks > 0);
const pressedGuide = (c: InterestRowLike, key: string): boolean => c.features.some((f) => guideOf(f.featureId) === key && f.clicks > 0);

export interface GuideStat { key: string; name: string; seen: number; pressed: number; pressLabel: string; result: { label: string; n: number; unit: string } | null }
/** 안내별 수 — 등록부 차례 + 기능 안내 창 · 결과는 체험 둘에만(7일 체험 = 배너로 켜서 살아 있는 회사 · 이미지 체험 = 한 장이라도 만든 회사) */
export function guideStats(rows: readonly InterestRowLike[]): GuideStat[] {
  const keys = [...LOGIN_POPUPS.map((p) => p.id), FEATURE_GUIDE];
  return keys.map((key) => ({
    key,
    name: guideName(key),
    seen: rows.filter((c) => sawGuide(c, key)).length,
    pressed: rows.filter((c) => pressedGuide(c, key)).length,
    pressLabel: key === FEATURE_GUIDE ? '요금제 보기' : loginPopupOf(key)?.goLabel || '누름',
    result: key === LINE_TRIAL_BANNER_ID ? { label: '체험 중', n: rows.filter((c) => c.lineTrial?.alive === true && c.lineTrial.source === 'banner').length, unit: '곳' }
      : key === STUDIO_TRIAL_POPUP_ID ? { label: '써 봄', n: rows.filter((c) => (c.trial?.used ?? 0) > 0).length, unit: '곳' }
      : null,
  }));
}

/** 본 것 한 줄 — 안내마다 「이름 n번」 · 기능 안내 창은 기능 이름 둘까지(titleOf = 기능 id → 이름) */
export function seenParts(c: InterestRowLike, titleOf: (featureId: string) => string): string[] {
  const out: string[] = [];
  for (const p of LOGIN_POPUPS) {
    const n = c.features.filter((f) => f.featureId === p.id).reduce((t, f) => t + f.opens, 0);
    if (n > 0) out.push(`${p.name} ${n}번`);
  }
  const feats = c.features.filter((f) => guideOf(f.featureId) === FEATURE_GUIDE && f.opens > 0);
  if (feats.length) {
    const n = feats.reduce((t, f) => t + f.opens, 0);
    const names = feats.slice(0, 2).map((f) => titleOf(f.featureId)).join(', ');
    out.push(`기능 안내 창 ${n}번(${names}${feats.length > 2 ? ` 외 ${feats.length - 2}` : ''})`);
  }
  return out;
}

/** 누른 것 한 줄 — 「로그인 안내 창에서 바로가기 2번」 · 「AI 현황판 안내 창에서 요금제 보기 1번」 */
export function pressedParts(c: InterestRowLike, titleOf: (featureId: string) => string): string[] {
  return c.features.filter((f) => f.clicks > 0).map((f) => {
    const p = loginPopupOf(f.featureId);
    return p ? `${p.name}에서 ${p.goLabel} ${f.clicks}번` : `${titleOf(f.featureId)} 안내 창에서 요금제 보기 ${f.clicks}번`;
  });
}

// ── 일어난 일 ────────────────────────────────────────────────────────────
export interface Activity { at: string; companyId: string; companyName: string; text: string; accent: boolean }
const SOURCE_TEXT: Record<InterestLineTrial['source'], string> = { banner: '배너로', diagnosis: '진단 설문으로', admin: '슈퍼관리자 부여로' };
/**
 * 최근 일어난 일(누른 것만 · 최근 순 · limit 건) — 7일 체험을 켬 · 이미지 체험 신청 · 안내에서 누름 · 「다시 보지 않기」.
 *   누름의 원천 = 서버의 최근 누름(recentClicks · 열람을 빼고 따로 읽음 · 체험 단추 누름과 그 밖을 회사마다 6건씩).
 *   두 체험 안내의 주 버튼 누름은 그 회사에 결과(켬 · 신청)가 있으면 결과 한 줄로 대신한다 — 그 단추는 결과가 생긴 뒤 다시 뜨지 않는다
 *   (배너 = 지급 행이 없을 때만 제안 · backend line-trial judgeLineBanner / 이미지 체험 안내 = 신청 행이 없을 때만 · backend v3-intro wantsStudioTrialIntro).
 *   결과가 없거나 결과 목록을 못 읽었으면 누름을 그대로 남긴다(Codex 구현 1R · 2R).
 */
export function recentActivity(rows: readonly InterestRowLike[], titleOf: (featureId: string) => string, limit = 6): Activity[] {
  const out: Activity[] = [];
  for (const c of rows) {
    const base = { companyId: c.companyId, companyName: c.companyName };
    if (c.lineTrial) out.push({ ...base, at: c.lineTrial.grantedAt, text: `${SOURCE_TEXT[c.lineTrial.source]} 7일 무료체험 켬`, accent: true });
    if (c.trial) out.push({ ...base, at: c.trial.requestedAt, text: '이미지 체험 신청', accent: false });
    for (const e of c.recentClicks) {
      if (e.event === 'go' && e.featureId === LINE_TRIAL_BANNER_ID && c.lineTrial) continue;
      if (e.event === 'go' && e.featureId === STUDIO_TRIAL_POPUP_ID && c.trial) continue;
      const p = loginPopupOf(e.featureId);
      out.push({ ...base, at: e.at, text: p ? `${p.name}에서 ${p.goLabel}` : `${titleOf(e.featureId)} 안내 창에서 요금제 보기`, accent: false });
    }
    for (const d of groupDismissed(c.dismissed)) out.push({ ...base, at: d.at, text: `${d.name} 다시 보지 않기`, accent: false });
  }
  return out.sort((x, y) => desc(x.at, y.at)).slice(0, limit);
}

/** 7일 체험의 남은 날(0 = 오늘이 마지막 날 · 모르면 빈 값) */
export const daysLeftText = (n: number | null | undefined): string => (typeof n !== 'number' || n < 0 ? '' : n === 0 ? '오늘까지' : `${n}일 남음`);
export const lineTrialSourceText = (t: InterestLineTrial): string => (t.source === 'banner' ? `배너, ${t.grantedBy || '이름 없음'}` : t.source === 'admin' ? '슈퍼관리자 부여' : '진단 설문');

// ── 다시 보지 않기 ─────────────────────────────────────────────────────────
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
