/**
 * one-line-ask.ts — 한 줄 묻기 답 조립 CT (★ 2026-10-10 · 설계서 docs/2026-10-10-oneline-ask-design.md §3-2 · §3-3)
 *
 * "물어보면 우리 회사 데이터로 답하고, 고르면 바로 만든다."
 *
 * ⛔ 불변
 *   - **AI 0 · 차감 0.** 이미 있는 집계(여정 기회 · AI 진단 · 오늘의 추천 · 시작 사건 가능 여부 · 플래너 행사)만 조립한다.
 *   - 숫자는 DB 값 그대로 · 혜택 문구 0(카드 동작의 목표 · 한 줄 뼈대에 혜택을 넣지 않는다 · AI 임의 혜택 금지).
 *   - 「효율」을 예측하지 않는다 — 순서 기준을 밝히고 효과는 켠 뒤 잰다고 적는다.
 *   - 출처마다 따로 받는다(allSettled) — 「없음」과 「못 읽음」을 구분한다(failed).
 *   - 문(권한)은 부르는 메뉴 라우트가 이미 지났다. 이 파일은 조립만 한다.
 */
import { query } from '../config/database';
import { buildJourneyOpportunities, buildJourneyDiagnosis, type JourneyOpportunity } from './journey-opportunities';
import { MARKETING_JOURNEY_SQL } from './journey-lifecycle-map';
import { getOwnerCustomerScopeSql } from './store-scope';
import { getCompanyJourneyFacts } from './company-data-profile';
import { resolveTriggerAvailability, toAvailabilityMap } from './journey-trigger-capability';
import { briefForViewer, type BriefRecommendation } from './daily-brief-policy';
import { findNewNumbers } from './copy-benefit-detector';
import { listPlannerEvents } from './planner-event';

export type LineAskAction =
  | { kind: 'journey'; objective: string; preferTriggerEvent: string }
  | { kind: 'auto'; brief: BriefRecommendation }
  | { kind: 'inapp'; objective: string }
  | { kind: 'fill'; line: string }
  | { kind: 'open'; path: string };

export interface LineAskCard {
  key: string;
  title: string;
  /** DB 실측 인원(없으면 null — 0명으로 그리지 않는다) */
  count: number | null;
  /** 인원 옆 설명(받는 사람 수가 아닐 때 등) */
  countNote?: string;
  why: string;
  notices?: string[];
  action: LineAskAction;
}

export interface LineAskAnswer {
  head: string;
  basis: { scope: 'mine' | 'company'; at: string; note?: string };
  cards: LineAskCard[];
  blocked: Array<{ title: string; reason: string }>;
  failed: string[];
}

export const LINE_ASK_CARDS_MAX = 3;

/** 요청 본문의 한 줄(2~2000자) · 아니면 null */
export function parseAskLine(body: any): string | null {
  const l = typeof body?.line === 'string' ? body.line.trim().slice(0, 2000) : '';
  return l.length >= 2 ? l : null;
}

/** 스위치 밖 회사 응답(메뉴 라우트 공통) */
export const LINE_ASK_DISABLED = { success: false, code: 'FEATURE_DISABLED', error: '이 회사는 한 줄 묻기가 아직 열리지 않았어요.' } as const;
/** 담당자 범위가 「배정 없음」이면 고객 조각이 이 값이다(store-scope · getOwnerCustomerScopeSql) */
const SCOPE_BLOCKED = ' AND FALSE';
const UNASSIGNED = { title: '담당 매장이 배정되지 않았어요', reason: '담당 매장이 정해지면 그 고객으로 권해 드려요. 관리자에게 배정을 요청해 주세요.' };

async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try { return { ok: true, value: await p }; } catch (e: any) {
    console.warn('[one-line-ask] 출처 읽기 실패:', e?.message || e);
    return { ok: false };
  }
}

async function viewerScope(companyId: string, userId: string | null | undefined): Promise<{ scope: 'mine' | 'company'; blocked: boolean }> {
  const sql = await getOwnerCustomerScopeSql(companyId, userId, 'c');
  return { scope: sql ? 'mine' : 'company', blocked: sql === SCOPE_BLOCKED };
}

/** 초안 · 멈춤만 있는 마케팅 여정의 시작 사건 — 다시 권하지 않는다(만든 초안을 또 만들어 또 과금하지 않게 · 진단과 같은 기준) */
async function nonActiveJourneyTriggers(companyId: string): Promise<Set<string>> {
  const r = await query(
    `SELECT DISTINCT j.trigger_event FROM journeys j
      WHERE j.company_id = $1 AND j.status IN ('paused', 'draft') AND j.archived_at IS NULL AND ${MARKETING_JOURNEY_SQL}`,
    [companyId],
  );
  return new Set<string>(r.rows.map((x: any) => String(x.trigger_event)));
}

// ─────────────── 여정 ───────────────

/** (순수) 여정 기회 → 답 카드: 시작 사건이 있고 초안 · 멈춤이 없는 것만 · 관련 매출 규모 순서 그대로 */
export function journeyCardsFrom(opps: JourneyOpportunity[], skipTriggers: Set<string>): LineAskCard[] {
  return opps
    .filter((o) => !!o.preferTriggerEvent && !skipTriggers.has(o.preferTriggerEvent))
    .slice(0, LINE_ASK_CARDS_MAX)
    .map((o) => ({
      key: `${o.type}:${o.preferTriggerEvent}`,
      title: o.title,
      count: o.count,
      why: o.description,
      notices: o.notices,
      action: { kind: 'journey', objective: o.suggestedObjective, preferTriggerEvent: o.preferTriggerEvent! },
    }));
}

export async function buildJourneyAsk(companyId: string, userId: string | null | undefined): Promise<LineAskAnswer> {
  const sc = await viewerScope(companyId, userId);
  const [opps, diag, skip] = await Promise.all([
    settle(buildJourneyOpportunities(companyId, userId)),
    settle(buildJourneyDiagnosis(companyId)),
    settle(nonActiveJourneyTriggers(companyId)),
  ]);
  const failed: string[] = [];
  if (!opps.ok) failed.push('여정 기회');
  if (!diag.ok) failed.push('AI 진단');
  // 만든 초안 · 멈춤 확인을 못 읽으면 카드를 내지 않는다 — 이미 있는 초안을 또 만들어 또 과금하게 권하지 않게
  if (!skip.ok) failed.push('만든 여정 초안');
  const cards = opps.ok && skip.ok && !sc.blocked ? journeyCardsFrom(opps.value, skip.value) : [];
  const blocked: LineAskAnswer['blocked'] = [];
  if (sc.blocked) blocked.push(UNASSIGNED);
  if (diag.ok) for (const p of diag.value.flowPlan) if (p.status === 'locked') blocked.push({ title: p.title, reason: p.reason });
  return {
    head: cards.length > 0
      ? `지금 데이터로 본 가장 큰 빈 구간은 「${cards[0].title}」이에요. 순서는 조건에 맞는 고객 수와 1회 구매액 합 기준이고, 효과는 켠 뒤 성과리포트에서 재요.`
      : '지금 데이터로는 새로 권할 여정을 찾지 못했어요.',
    basis: {
      scope: sc.scope,
      at: new Date().toISOString(),
      ...(diag.ok ? { note: `구매 간격은 회사 전체 구매 기록 기준(${diag.value.computedAt.slice(0, 10)})` } : {}),
    },
    cards,
    blocked,
    failed,
  };
}

// ─────────────── 자동 마케팅 ───────────────

/** KST 오늘(YYYY-MM-DD) */
function kstToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function dateText(v: unknown): string {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function buildAutoAsk(companyId: string, isAdmin: boolean, now = new Date()): Promise<LineAskAnswer> {
  const r = await settle(query(
    `SELECT brief_date, headline, recommendations, signals FROM company_daily_briefs
      WHERE company_id = $1::uuid ORDER BY brief_date DESC LIMIT 1`,
    [companyId],
  ));
  const failed = r.ok ? [] : ['오늘의 추천'];
  const view = r.ok ? briefForViewer(r.value.rows[0], { isAdmin }, findNewNumbers) : null;
  const date = view ? dateText(view.brief_date) : '';
  const cards: LineAskCard[] = (view?.recommendations || []).slice(0, LINE_ASK_CARDS_MAX).map((rec, i) => ({
    key: `brief:${i}`,
    title: rec.title,
    count: rec.targetCount,
    why: rec.reason || rec.objective,
    action: { kind: 'auto', brief: rec },
  }));
  const blocked: LineAskAnswer['blocked'] = [];
  if (r.ok && (!view || date !== kstToday(now))) {
    blocked.push({
      title: view ? `오늘의 추천이 아직 없어요(마지막 = ${date})` : '오늘의 추천이 아직 없어요',
      reason: '추천은 매일 아침 유료 요금제 · 고객이 있는 회사에 만들어져요. 크레딧이 부족한 날은 건너뛰어요.',
    });
  }
  return {
    head: cards.length > 0 ? '오늘의 추천에서 고르면 대상과 문안을 먼저 보여 드려요.' : '지금 권할 자동 마케팅을 찾지 못했어요.',
    basis: { scope: isAdmin ? 'company' : 'mine', at: new Date().toISOString(), ...(date ? { note: `오늘의 추천 ${date} 기준` } : {}) },
    cards,
    blocked,
    failed,
  };
}

// ─────────────── 인앱 ───────────────

const INAPP_IDEAS: Array<{ key: 'cart' | 'browse'; title: string; why: string; objective: string }> = [
  { key: 'cart', title: '장바구니에 담은 고객 붙잡기', why: '장바구니 담기 신호가 들어오고 있어요. 담고 머무는 순간에 띄울 수 있어요.', objective: '장바구니에 담고 머무는 고객에게 담은 상품을 다시 보여 주는 안내 띄우기' },
  { key: 'browse', title: '둘러보고 나가려는 고객 붙잡기', why: '상품 조회 신호가 들어오고 있어요. 보고 그냥 나가려는 순간에 띄울 수 있어요.', objective: '상품을 둘러보고 나가려는 고객에게 관심 상품 안내 띄우기' },
];

export async function buildInappAsk(companyId: string, userId: string | null | undefined): Promise<LineAskAnswer> {
  const [facts, opps] = await Promise.all([
    settle(getCompanyJourneyFacts(companyId)),
    settle(buildJourneyOpportunities(companyId, userId)),
  ]);
  const failed: string[] = [];
  if (!facts.ok) failed.push('자사몰 신호');
  const avail = facts.ok ? toAvailabilityMap(resolveTriggerAvailability(facts.value)) : {};
  const cartCount = opps.ok ? (opps.value.find((o) => o.type === 'cart_recovery')?.count ?? null) : null;
  const cards: LineAskCard[] = [];
  const blocked: LineAskAnswer['blocked'] = [];
  for (const idea of INAPP_IDEAS) {
    const a = avail[idea.key];
    if (!a) continue;
    if (a.available) {
      cards.push({
        key: `inapp:${idea.key}`,
        title: idea.title,
        count: idea.key === 'cart' ? cartCount : null,
        ...(idea.key === 'cart' && cartCount != null ? { countNote: '최근 14일 담고 안 산 고객' } : {}),
        why: idea.why,
        action: { kind: 'inapp', objective: idea.objective },
      });
    } else {
      blocked.push({ title: idea.title, reason: a.reason });
    }
  }
  return {
    head: cards.length > 0 ? '자사몰에서 들어오는 신호로 띄울 수 있는 메시지예요.' : '아직 띄울 근거가 되는 자사몰 신호가 없어요.',
    basis: { scope: 'company', at: new Date().toISOString() },
    cards,
    blocked,
    failed,
  };
}

// ─────────────── 모바일 DM · 이메일 · SNS ───────────────

/** 일회성 후보 → 한 줄 뼈대(혜택 없음 · 기존 만들기로 이어지면 혜택은 기존 확인 창이 묻는다) */
const CONTENT_LINES: Partial<Record<JourneyOpportunity['type'], string>> = {
  cart_recovery: '장바구니에 담고 아직 안 산 고객에게 담은 상품 다시 안내',
  dormant: '한동안 구매가 없는 고객에게 안부와 새 소식 전하기',
  birthday: '이번 주 생일인 고객에게 생일 축하 인사',
  repurchase_due: '다시 살 때가 된 고객에게 재구매 안내',
  onboarding: '이번 주 가입한 고객에게 환영 인사와 첫 구매 안내',
  wishlist: '찜한 상품을 아직 안 산 고객에게 찜한 상품 안내',
};

/** (순수) 일회성 후보 카드 */
export function contentCardsFrom(opps: JourneyOpportunity[]): LineAskCard[] {
  const out: LineAskCard[] = [];
  for (const o of opps) {
    const line = CONTENT_LINES[o.type];
    if (!line) continue;
    out.push({
      key: `content:${o.type}`,
      title: o.title,
      count: o.count,
      countNote: '지금 이런 고객 · 문안을 만들고 대상은 보낼 때 골라요',
      why: o.description,
      action: { kind: 'fill', line },
    });
  }
  return out;
}

export async function buildContentAsk(
  companyId: string,
  userId: string | null | undefined,
  channel: 'dm' | 'email' | 'sns',
  ownerId: string | null,
  now = new Date(),
): Promise<LineAskAnswer> {
  const today = kstToday(now);
  const month = today.slice(0, 7);
  const sc = await viewerScope(companyId, userId);
  const [events, opps] = await Promise.all([
    settle(listPlannerEvents(companyId, month, ownerId)),
    channel === 'sns' ? Promise.resolve({ ok: true as const, value: [] as JourneyOpportunity[] }) : settle(buildJourneyOpportunities(companyId, userId)),
  ]);
  const failed: string[] = [];
  if (!events.ok) failed.push('마케팅 플래너');
  if (!opps.ok) failed.push('고객 신호');
  const eventCards: LineAskCard[] = (events.ok ? events.value : [])
    .filter((e) => e.status !== 'cancelled' && e.endsOn >= today)
    .slice(0, 2)
    .map((e) => ({
      key: `event:${e.id}`,
      title: `이번 달 행사 「${e.title}」`,
      count: null,
      why: `${e.startsOn.slice(5).replace('-', '/')} ~ ${e.endsOn.slice(5).replace('-', '/')} · 플래너에 등록한 행사예요. 행사 화면에서 이 채널 소재를 만들어요.`,
      action: { kind: 'open', path: `/marketing-planner/events/${e.id}` },
    }));
  const oppCards = opps.ok && !sc.blocked ? contentCardsFrom(opps.value) : [];
  const cards = [...eventCards, ...oppCards].slice(0, LINE_ASK_CARDS_MAX);
  const blocked: LineAskAnswer['blocked'] = [];
  if (sc.blocked && channel !== 'sns') blocked.push(UNASSIGNED);
  if (channel === 'sns' && events.ok && eventCards.length === 0) {
    blocked.push({ title: '이번 달 등록된 행사가 없어요', reason: '마케팅 플래너에 행사를 넣으면 여기서 올릴 글을 권해요.' });
  }
  return {
    head: cards.length > 0
      ? (channel === 'sns' ? '이번 달 행사로 올릴 만한 글이에요.' : '지금 데이터로 보낼 만한 이야기예요. 고르면 한 줄을 채워 바로 만들어요.')
      : '지금 데이터로는 권할 근거를 찾지 못했어요.',
    basis: { scope: channel === 'sns' ? 'company' : sc.scope, at: new Date().toISOString() },
    cards,
    blocked,
    failed,
  };
}
