/**
 * ★ CT: 기능 관심 업체 (★2026-10-06 Harold 지시 · 슈퍼관리자 ceo 전용 · 읽기 전용 화면)
 *
 * 요금제 미가입 회사(와 아직 열리지 않은 기능을 누른 회사)가 AI Operator 기능 안내 창(예시 영상 · 상세 설명)을
 * 열었는지 · 거기서 「요금제 보기」를 눌렀는지를 본다. 설계 = docs/2026-10-06-plan-feature-video-modal-design.md §10.
 *
 * 원천 = audit_logs(새 칸 · 새 테이블 0) — 안내 창 열람 `plan_feature_open` · 「요금제 보기」 `plan_feature_pricing`.
 *   기록은 고객사 사용자가 안내 창을 열 때 PlanFeatureModal 한 곳에서 보낸다(창을 여는 입구 5곳이 모두 같은 창).
 *   기록 실패는 recordAuditLog 가 삼킨다(고객 화면 영향 0).
 * 게이트(ceo 전용)는 라우트가 `isFeatureInterestViewer`(audit-log.ts)로 건다.
 */
import { query } from '../config/database';
import { recordAuditLog } from './audit-log';
import { mapWithConcurrency } from './concurrency';
import { isActivePaidPlan, loadPlanContext } from './plan-guard';
import { precheckPeriodStartSql } from './precheck-usage';
import { loadStudioTrials } from './studio-trial';   // ★ 2026-11-15 C135 무료체험 신청 업체
import { loadIntroDismissals, type IntroDismissalRow } from './v3-intro';   // ★ 2026-11-16 C138 「다시 보지 않기」를 누른 계정
import { loadLineTrials, type LineTrialListRow, type LineTrialSource } from './line-trial';   // ★ 2026-11-17 C141 7일 무료체험(지급 원장)

// ★ 2026-10-06 go = 로그인 안내 창(featureId 'login-promo')의 「지금 바로가기」 — 요금제 보기와 다른 행동이라 다른 값으로 남긴다
export const FEATURE_INTEREST_ACTIONS = { open: 'plan_feature_open', pricing: 'plan_feature_pricing', go: 'plan_feature_go' } as const;
export type FeatureInterestEvent = keyof typeof FEATURE_INTEREST_ACTIONS;
export const FEATURE_INTEREST_TARGET = 'plan_feature';
/** 기록 경로 호출 상한 — 사용자당 1분 30회(안내 창을 사람이 여는 속도로는 닿지 않는다 · 넘으면 기록하지 않는다) */
export const FEATURE_SEEN_RATE = { windowMs: 60 * 1000, max: 30 } as const;
/** 업체별 시간순 기록 개수(상세 표시용 · 집계는 이 상한과 무관하게 전부 센다) */
const EVENTS_PER_COMPANY = 30;
/**
 * ★ 2026-11-17 C141 업체별 최근 누름 기록 개수 = 화면 「최근 일어난 일」 건수(FeatureInterestTab 의 recentActivity(…, 6)).
 *   열람을 빼고 상세 창의 30건과 따로 읽는다(상세 기록에서 고르면 누름 뒤 열람 30건에 밀린다 · Codex 구현 1R).
 *   체험 단추마다(7일 체험 배너 · 이미지 체험 안내) · 그 밖 누름을 따로 센다 — 화면은 결과(켬 · 신청)가 있는 회사의 그 단추 누름을 결과 한 줄로 대신하므로,
 *   묶음을 섞으면 가려질 누름이 상한을 차지해 남길 누름을 밀어낸다(Codex 구현 2R · 3R). 한 묶음 안의 누름은 다 보이거나 다 가려진다.
 *   묶음마다 이 수면 전체 최근 이 수만큼이 빠지지 않는다(한 회사의 한 묶음이 그보다 많이 들어갈 수 없다).
 */
const CLICKS_PER_COMPANY = 6;
/** 체험 안내의 주 버튼(누르면 결과가 남는다 = 7일 체험 지급 · 이미지 체험 신청) — 화면 등록부 LINE_TRIAL_BANNER_ID · STUDIO_TRIAL_POPUP_ID 와 같은 값(시험이 대조) */
export const TRIAL_BUTTON_FEATURE_IDS = ['line-trial', 'studio-trial'] as const;
const PLAN_CONCURRENCY = 4;
/** 기능 id = 화면 원장(plan-feature-intros.ts)의 id 형식 */
const FEATURE_ID_RE = /^[a-z][a-z-]{1,39}$/;

/** 기록 요청 정규화 — 모르는 값이면 null(기록하지 않는다) */
export function parseFeatureSeen(body: any): { featureId: string; event: FeatureInterestEvent } | null {
  const featureId = typeof body?.featureId === 'string' ? body.featureId.trim() : '';
  const event = (['open', 'pricing', 'go'] as const).find((e) => e === body?.event) ?? null;
  if (!event || !FEATURE_ID_RE.test(featureId)) return null;
  return { featureId, event };
}

/** 안내 창 열람 · 「요금제 보기」 기록 — 고객사 사용자만(슈퍼관리자 · 회사 없는 토큰은 남기지 않는다) */
export async function recordFeatureSeen(req: any, input: { featureId: string; event: FeatureInterestEvent }): Promise<boolean> {
  const u = req?.user;
  if (!u || u.userType === 'super_admin' || !u.companyId || !u.userId) return false;
  await recordAuditLog({
    actorUserId: u.userId,
    action: FEATURE_INTEREST_ACTIONS[input.event],
    targetType: FEATURE_INTEREST_TARGET,
    details: { featureId: input.featureId, companyId: u.companyId },
    req,
  });
  return true;
}

export type FeatureInterestPeriod = 'today' | '7d' | 'month' | 'all';
export type FeatureInterestPlan = 'all' | 'unsubscribed' | 'subscribed';

export interface FeatureInterestQuery {
  period: FeatureInterestPeriod;
  plan: FeatureInterestPlan;
}

/** 조회 조건 정규화 — 모르는 값은 기본값(최근 7일 · 모든 회사) · ★ C138 기능 조건은 화면이 받아 둔 줄에서 건다(서버 조건 삭제) */
export function parseFeatureInterestQuery(q: any): FeatureInterestQuery {
  const period = (['today', '7d', 'month', 'all'] as const).find((p) => p === q?.period) ?? '7d';
  const plan = (['all', 'unsubscribed', 'subscribed'] as const).find((p) => p === q?.plan) ?? 'all';
  return { period, plan };
}

export interface FeatureInterestCompanyRow {
  companyId: string;
  companyName: string;
  planName: string;
  subscribed: boolean;
  /** 안내(기능)마다 본 수 · ★ 2026-11-17 C141 누른 수(그 안내의 주 버튼 · 요금제 보기 = 화면의 「안내별 누른 회사」) */
  features: Array<{ featureId: string; opens: number; clicks: number }>;
  pricingClicks: number;
  /** 로그인 안내 창 「지금 바로가기」 */
  goClicks: number;
  lastAt: string;
  users: Array<{ name: string; loginId: string }>;
  events: Array<{ at: string; event: FeatureInterestEvent; featureId: string; userName: string }>;
  /** ★ 2026-11-17 C141 최근 누름 기록(요금제 보기 · 주 버튼 · 열람 제외 · 회사당 최근 CLICKS_PER_COMPANY 건) */
  recentClicks: Array<{ at: string; event: Exclude<FeatureInterestEvent, 'open'>; featureId: string; userName: string }>;
  /** ★ 2026-11-16 C138 이 조회 기간에 본 기록이 있는가 — false = 무료체험 신청 · 「다시 보지 않기」 때문에 올라온 줄(본 수는 0) */
  seen: boolean;
  /** ★ C138 이미지 스튜디오 무료체험(신청한 사람 · 시각 · 만든 수 / 받은 수) · 신청하지 않았으면 null */
  trial: { requestedBy: string; requestedAt: string; used: number; granted: number } | null;
  /** ★ C138 「다시 보지 않기」를 누른 기록(어느 창 · 누가 · 언제) · 최근 순 */
  dismissed: Array<{ introKey: string; at: string; userName: string; loginId: string }>;
  /** ★ 2026-11-17 C141 7일 무료체험(지급 원장 한 줄 · 길 · 켠 시각 · 켠 사람 · 살아 있는가 · 남은 날) · 받은 적 없으면 null */
  lineTrial: { source: LineTrialSource; grantedAt: string; grantedBy: string; alive: boolean; daysLeft: number | null; endsAt: string | null } | null;
}

export interface FeatureInterestData {
  /**
   * 업체 줄 — 본 기록이 있는 회사(seen) + ★ C138 무료체험을 신청한 회사 · 「다시 보지 않기」를 누른 회사(기간과 무관하게 전부 · 본 기록이 없으면 seen = false).
   *   ★ C138 요약 수 · 기능별 수는 내지 않는다 — 화면이 이 줄에서 센다(utils/feature-interest-view · 걸러 보기와 숫자가 한 벌).
   */
  companies: FeatureInterestCompanyRow[];
  /**
   * ★ C138 무료체험 신청 목록 · 「다시 보지 않기」 목록을 읽었는가 — false = 표가 아직 없거나(DDL 앞) 못 읽음 → 화면은 그 칸을 「알 수 없음」으로(「없음」이라 쓰지 않는다).
   *   (C135 가 따로 내던 trials 목록은 업체 줄의 trial 칸으로 옮겼다 · 둘 다 기한 없는 지금 상태라 기간으로 거르지 않는다.)
   */
  trialsKnown: boolean;
  dismissalsKnown: boolean;
  /** ★ C141 7일 무료체험 목록을 읽었는가(false = 화면은 그 단계를 「읽지 못했습니다」로) */
  lineTrialsKnown: boolean;
}

/**
 * 기능 관심 업체 집계 — ★ Codex 1R: 원장 행을 읽어 JS 로 묶지 않는다(행 수 상한이 다른 업체 기록을 밀어내고,
 *   잘린 상세 기록에서 기능별 클릭을 세면 빠진다). 수는 SQL 묶음(회사 · 기능 · 종류)으로 전부 세고,
 *   시간순 기록만 회사당 최근 몇 건을 따로 읽는다.
 */
export async function loadFeatureInterest(q: FeatureInterestQuery): Promise<FeatureInterestData> {
  const params: any[] = [FEATURE_INTEREST_ACTIONS.open, FEATURE_INTEREST_ACTIONS.pricing, FEATURE_INTEREST_ACTIONS.go];
  const companyExpr = `COALESCE(al.details->>'companyId', u.company_id::text)`;
  let where = `al.action IN ($1, $2, $3) AND ${companyExpr} IS NOT NULL`;
  if (q.period !== 'all') where += ` AND al.created_at >= ${precheckPeriodStartSql(q.period)}`;
  const from = `FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id WHERE ${where}`;

  /**
   * 회사마다 최근 limit 건 — 상세 창의 시간순 기록(열람 포함) · ★ C141 최근 누름(열람 제외 · 체험 단추마다 · 그 밖을 따로 센다 · $4 = 체험 단추 id).
   */
  const recentSql = (limit: number, onlyClicks: boolean) =>
    `SELECT company_id, action, created_at, feature_id, user_name FROM (
       SELECT ${companyExpr} AS company_id, al.action, al.created_at, al.details->>'featureId' AS feature_id,
              COALESCE(u.name, '') AS user_name,
              ROW_NUMBER() OVER (PARTITION BY ${companyExpr}${onlyClicks ? ", CASE WHEN al.action = $3 AND al.details->>'featureId' = ANY($4::text[]) THEN al.details->>'featureId' ELSE '' END" : ''} ORDER BY al.created_at DESC) AS rn
         ${from}${onlyClicks ? ' AND al.action IN ($2, $3)' : ''}
     ) t WHERE rn <= ${limit}
     ORDER BY created_at DESC`;
  const [agg, people, recent, clicks] = await Promise.all([
    query(
      `SELECT ${companyExpr} AS company_id, al.details->>'featureId' AS feature_id, al.action,
              COUNT(*)::int AS n, MAX(al.created_at) AS last_at
         ${from}
        GROUP BY 1, 2, 3`,
      params,
    ),
    query(`SELECT DISTINCT ${companyExpr} AS company_id, u.login_id, COALESCE(u.name, '') AS user_name ${from} AND u.id IS NOT NULL`, params),
    query(recentSql(EVENTS_PER_COMPANY, false), params),
    query(recentSql(CLICKS_PER_COMPANY, true), [...params, [...TRIAL_BUTTON_FEATURE_IDS]]),
  ]);
  const eventOf = (row: any) => ({
    at: new Date(row.created_at).toISOString(),
    event: row.action === FEATURE_INTEREST_ACTIONS.pricing ? 'pricing' as const : row.action === FEATURE_INTEREST_ACTIONS.go ? 'go' as const : 'open' as const,
    featureId: String(row.feature_id || ''),
    userName: String(row.user_name || ''),
  });

  type Acc = FeatureInterestCompanyRow & { featureMap: Map<string, { opens: number; clicks: number }>; sortAt: string };
  const byCompany = new Map<string, Acc>();
  const accOf = (companyId: string): Acc => {
    let a = byCompany.get(companyId);
    if (!a) {
      a = {
        companyId, companyName: '(회사 정보 없음)', planName: '', subscribed: false, features: [], pricingClicks: 0, goClicks: 0,
        lastAt: new Date(0).toISOString(), users: [], events: [], recentClicks: [], featureMap: new Map(),
        seen: false, trial: null, dismissed: [], lineTrial: null, sortAt: new Date(0).toISOString(),
      };
      byCompany.set(companyId, a);
    }
    return a;
  };
  for (const row of agg.rows) {
    const a = accOf(String(row.company_id));
    const featureId = String(row.feature_id || '');
    const n = Number(row.n) || 0;
    const f = a.featureMap.get(featureId) || { opens: 0, clicks: 0 };
    if (row.action === FEATURE_INTEREST_ACTIONS.pricing) {
      a.pricingClicks += n;
      f.clicks += n;
    } else if (row.action === FEATURE_INTEREST_ACTIONS.go) {
      a.goClicks += n;
      f.clicks += n;
    } else {
      f.opens += n;
    }
    a.featureMap.set(featureId, f);
    const at = new Date(row.last_at).toISOString();
    if (at > a.lastAt) a.lastAt = at;
    a.seen = true;
  }
  for (const row of people.rows) {
    const a = byCompany.get(String(row.company_id));
    if (a && row.login_id) a.users.push({ name: String(row.user_name || ''), loginId: String(row.login_id) });
  }
  for (const row of clicks.rows) {
    const a = byCompany.get(String(row.company_id));
    const e = eventOf(row);
    if (a && e.event !== 'open') a.recentClicks.push({ ...e, event: e.event });
  }
  for (const row of recent.rows) {
    const a = byCompany.get(String(row.company_id));
    if (!a) continue;
    a.events.push(eventOf(row));
  }

  // ★ C135 무료체험 신청 업체 · ★ C138 「다시 보지 않기」를 누른 계정 — 못 읽어도 탭의 나머지는 그대로(그 칸만 비운다).
  //   둘 다 기간과 무관한 지금 상태라 본 기록이 없는 회사도 줄을 만든다(회사 이름 · 요금제를 아래에서 같이 채운다).
  const trials = await loadStudioTrials().catch((err: any) => {
    console.error('[feature-interest] 무료체험 신청 업체 조회 실패:', err?.message || err);
    return null;
  });
  const dismissals: IntroDismissalRow[] | null = await loadIntroDismissals().catch((err: any) => {
    console.error('[feature-interest] 다시 보지 않기 목록 조회 실패:', err?.message || err);
    return null;
  });
  // ★ 2026-11-17 C141 7일 무료체험(지급 원장) — 같은 규약(기간과 무관한 지금 상태 · 못 읽으면 그 단계만 「모름」)
  const lineTrials: LineTrialListRow[] | null = await loadLineTrials().catch((err: any) => {
    console.error('[feature-interest] 7일 무료체험 목록 조회 실패:', err?.message || err);
    return null;
  });
  for (const t of trials || []) accOf(t.companyId).trial = { requestedBy: t.requestedBy, requestedAt: t.requestedAt, used: t.used, granted: t.granted };
  for (const d of dismissals || []) accOf(d.companyId).dismissed.push({ introKey: d.introKey, at: d.at, userName: d.userName, loginId: d.loginId });
  for (const t of lineTrials || []) accOf(t.companyId).lineTrial = { source: t.source, grantedAt: t.grantedAt, grantedBy: t.grantedBy, alive: t.alive, daysLeft: t.daysLeft, endsAt: t.endsAt };
  // 줄 순서 = 가장 최근에 일어난 일(본 시각 · 신청 시각 · 켠 시각 · 누른 시각) 순 — 본 기록이 없는 줄의 lastAt 은 처음 값(1970) 그대로다
  for (const a of byCompany.values()) {
    a.sortAt = [a.lastAt, a.trial?.requestedAt || '', a.lineTrial?.grantedAt || '', ...a.dismissed.map((d) => d.at)].reduce((m, x) => (x > m ? x : m));
  }

  const accs = Array.from(byCompany.values());
  if (accs.length > 0) {
    const names = await query(`SELECT id::text AS id, company_name FROM companies WHERE id::text = ANY($1::text[])`, [accs.map((a) => a.companyId)]);
    const nameOf = new Map(names.rows.map((r: any) => [String(r.id), String(r.company_name || '')]));
    for (const a of accs) a.companyName = nameOf.get(a.companyId) || '(회사 정보 없음)';
  }
  // 요금제 = 지금 기준(고객 화면 판정과 같은 함수)
  // ponytail: 회사마다 요금제를 한 번씩 읽는다(무료체험 · 숨김 회사가 더해져 줄 수 = 기간과 무관하게 는다) · 수백 곳을 넘어 느려지면 요금제를 한 SQL 로 묶는다
  await mapWithConcurrency(accs, PLAN_CONCURRENCY, async (a) => {
    const ctx = await loadPlanContext(a.companyId).catch(() => null);
    a.planName = ctx?.planName || '알 수 없음';
    a.subscribed = isActivePaidPlan(ctx);
  });

  const kept = accs
    .filter((a) => (q.plan === 'all' ? true : q.plan === 'subscribed' ? a.subscribed : !a.subscribed))
    .sort((x, y) => (x.sortAt < y.sortAt ? 1 : x.sortAt > y.sortAt ? -1 : 0));

  const companies: FeatureInterestCompanyRow[] = kept.map((a) => ({
    companyId: a.companyId, companyName: a.companyName, planName: a.planName, subscribed: a.subscribed,
    features: Array.from(a.featureMap.entries()).map(([featureId, f]) => ({ featureId, opens: f.opens, clicks: f.clicks }))
      .sort((x, y) => y.opens - x.opens || y.clicks - x.clicks || (x.featureId < y.featureId ? -1 : 1)),
    pricingClicks: a.pricingClicks, goClicks: a.goClicks, lastAt: a.lastAt, users: a.users, events: a.events, recentClicks: a.recentClicks,
    seen: a.seen, trial: a.trial, dismissed: a.dismissed, lineTrial: a.lineTrial,
  }));

  return { trialsKnown: trials !== null, dismissalsKnown: dismissals !== null, lineTrialsKnown: lineTrials !== null, companies };
}
