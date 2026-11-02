/**
 * manager-board.ts — 담당자 상황판 CT(★ 2026-11-02 엔진 재설계 E5 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 *
 * 매일 오던 「발송 전 안내」 문자 대신, 담당자가 한 화면에서 여정 · 자동마케팅 · 플래너의 상태와 할 일을 본다(읽기 전용).
 *   - 링크 = 서명 토큰(정지 링크와 같은 비밀 · 같은 꼴 · kind = manager-board · 회사 · 담당자 · 8일) · 주소는 # 뒤 · 담당자 링크(비추적)
 *   - 범위 = 관리자 = 회사 전체 · 담당자 = 자기가 만든 것(R3 · 사용자 범위 원칙)
 *   - 바꾸는 일(멈추기 · 승인 · 문안 고치기)은 여기서 하지 않는다 = 기존 링크 화면(되묻기 있음) 또는 로그인 화면으로 보낸다
 * ⛔ 모델명 0 · 출처 줄 0 · 줄표 0(고객 화면 문장).
 */
import { query } from '../config/database';
import { signLinkToken, readLinkToken, generatePauseToken, buildJourneyPauseUrl } from './journey-pause-handler';
import { createShortUrl } from './short-url';
import { latestDecisionLateralSql, pretestSnapshotColumnReady } from './journey-pretest-notifier';
import { latestSnapshotSql } from './journey-step-versions';   // ★ 2026-11-02 판 읽기 CT(설계서 3-0 CT-J1)
import { journeyStepCopyIssueNow } from './journey-message-render';   // ★ 2026-11-02 보낼 글 판정 CT(설계서 3-0 CT-J10)
import { readPassedCandidateForStep } from './journey-pretest-candidate';   // ★ 2026-11-02 수정안(CT-J12)
import { oneShotColumnsReady } from './journey-lineage';
import { pauseReasonView } from './journey-pause-reason';
import { getCompanySmsTablesWithLogs, smsCampaignCountsSafe, smsCampaignSpamCountsSafe } from './sms-queue';
import { isSpamBlockSurge } from './sms-result-map';

export const MANAGER_BOARD_TOKEN_HEADER = 'x-manager-board-token';
export const MANAGER_BOARD_TTL_MS = 8 * 24 * 60 * 60 * 1000;
const KIND = 'manager-board';

export function generateManagerBoardToken(companyId: string, userId: string): string | null {
  return signLinkToken({ kind: KIND, company_id: companyId, user_id: userId, expires_at: Date.now() + MANAGER_BOARD_TTL_MS });
}
export function verifyManagerBoardToken(token: string): { companyId: string; userId: string } | null {
  const p = readLinkToken(token);
  if (!p || p.kind !== KIND || !p.company_id || !p.user_id) return null;
  return { companyId: String(p.company_id), userId: String(p.user_id) };
}
export function buildManagerBoardUrl(token: string): string {
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  return `${base}/manager-board#t=${token}`;
}
/** 문자에 싣는 주소 = 단축(실패 = 원래 주소) · 만료 = 토큰과 같다 */
export async function buildManagerBoardShortUrl(companyId: string, token: string): Promise<string> {
  const full = buildManagerBoardUrl(token);
  try {
    const { shortUrl } = await createShortUrl({ companyId, fullUrl: full, expiresAt: new Date(Date.now() + MANAGER_BOARD_TTL_MS) });
    return shortUrl;
  } catch (err: any) {
    console.warn('[manager-board] 상황판 링크 단축 실패(원래 주소로 안내):', err?.message);
    return full;
  }
}

export type StepCheck = 'passed' | 'unverified' | 'held' | 'waiting' | 'none';
/** (순수) 칸의 최근 검사 결과 한 단어 — 보류(지금 판) > 검사 기다림(표식 < 100) > 확인 못 함 > 통과 · 문자 칸이 아니면 검사 없음 */
export function stepCheckOf(s: { channel: string; confidence: number | null; decStatus: string | null; decCurrent: boolean }): StepCheck {
  if (!['sms', 'lms', 'mms'].includes(String(s.channel))) return 'none';
  if (s.decStatus === 'held' && s.decCurrent) return 'held';
  if (s.confidence != null && s.confidence < 100) return 'waiting';
  if (s.decStatus === 'unverified') return 'unverified';
  return 'passed';
}

export interface BoardTodo {
  kind: 'held_step' | 'spam_surge' | 'dispatch_pending' | 'paused_journey' | 'proposal_review' | 'planner_confirm'; title: string; reason: string; action: { label: string; href: string } | null;
  /** ★ 2026-11-02 설계서 3-9 — 걸린 원문 · 검사를 통과한 수정안(읽기만 · 바꾸기 = 로그인 화면 그 칸) */
  compare?: { original: string; candidate: string } | null;
  /** 둘째 행동([직접 고치기]) */
  altAction?: { label: string; href: string } | null;
}
/** (순수) 판정 문장 */
export function boardVerdict(todos: readonly BoardTodo[]): { tone: 'ok' | 'warn'; sentence: string } {
  const need = todos.filter((t) => t.action).length;
  if (todos.length === 0) return { tone: 'ok', sentence: '모두 정상이에요. 지금 확인할 일이 없어요.' };
  if (need === 0) return { tone: 'ok', sentence: `알려 드릴 일이 ${todos.length}건 있어요. 저절로 처리되는 일이라 따로 하실 일은 없어요.` };
  return { tone: 'warn', sentence: `확인할 일이 ${need}건 있어요. 아래에서 하나씩 볼 수 있어요.` };
}

export interface ManagerBoardView {
  companyName: string;
  scope: 'company' | 'mine';
  generatedAt: string;
  verdict: { tone: 'ok' | 'warn'; sentence: string };
  numbers: { activeJourneys: number; activeOperators: number; sent7d: number; successRate: number | null };
  todos: BoardTodo[];
  today: Array<{ journeyId: string; journeyName: string; stepOrder: number; channel: string; count: number; firstAt: string; pauseUrl: string | null }>;
  journeys: Array<{ id: string; name: string; status: string; pauseReason: string | null; sent7d: number; steps: Array<{ order: number; channel: string; check: StepCheck; checkedAt: string | null }> }>;
  operators: Array<{ id: string; name: string; status: string; nextRunAt: string | null; reviewCount: number; lastSentAt: string | null; lastRecipients: number | null }>;
  /** ★ Codex 구현 1R — 목록 표시는 앞 50개 · 나머지 수(할 일 · 숫자 · 오늘 나갈 칸은 범위 전체로 센다) */
  more: { journeys: number; operators: number };
  planner: Array<{ id: string; title: string; startsOn: string; endsOn: string }>;
}

const KST_TODAY = `(NOW() AT TIME ZONE 'Asia/Seoul')::date`;
/** 목록 표시 상한(할 일 · 숫자 · 오늘 나갈 칸 · 정지 링크는 범위 전체 · ★ Codex 구현 1R) */
export const BOARD_LIST_MAX = 50;

/** 상황판 한 장(토큰이 틀리면 null) */
export async function loadManagerBoard(token: string): Promise<ManagerBoardView | null> {
  const who = verifyManagerBoardToken(token);
  return who ? loadManagerBoardFor(who.companyId, who.userId) : null;
}

/** 그 회사 · 그 담당자의 상황판(담당자가 없거나 꺼졌으면 null) · 주간 요약도 이것으로 센다 */
export async function loadManagerBoardFor(companyId: string, userId: string): Promise<ManagerBoardView | null> {
  const who = { companyId, userId };
  const u = await query(
    `SELECT u.user_type, u.phone, c.company_name FROM users u JOIN companies c ON c.id = u.company_id
      WHERE u.id = $1::uuid AND u.company_id = $2::uuid AND u.is_active = true`,
    [who.userId, who.companyId],
  );
  if (u.rows.length === 0) return null;
  const isAdmin = String(u.rows[0].user_type) === 'admin';
  const phone = String(u.rows[0].phone || '').replace(/\D/g, '');
  // 범위 조각(관리자 = 회사 전체 · 담당자 = 자기가 만든 것) · $1 = 회사 · $2 = 담당자
  const mine = (alias: string) => (isAdmin ? '' : ` AND ${alias}.created_by = $2::uuid`);
  const P = isAdmin ? [who.companyId] : [who.companyId, who.userId];   // 관리자 = $2 를 쓰지 않는다(넘기면 매개변수 수가 어긋난다)

  const oneShotTracked = await oneShotColumnsReady().catch(() => false);
  const jr = await query(
    `SELECT j.id, j.name, j.status, j.pause_reason, j.trigger_event,
            ${oneShotTracked ? `(j.start_kind = 'one_shot' AND j.status = 'active' AND j.one_shot_dispatch_pending_at IS NOT NULL AND j.one_shot_dispatched_at IS NULL)` : 'false'} AS dispatch_pending,
            COALESCE((SELECT SUM(c.sent_count) FROM journey_step_campaigns jsc JOIN campaigns c ON c.id = jsc.campaign_id
                       WHERE jsc.journey_id = j.id AND jsc.send_date >= ${KST_TODAY} - 6), 0)::int AS sent7d
       FROM journeys j
      WHERE j.company_id = $1::uuid AND j.status IN ('active', 'paused') AND j.archived_at IS NULL${mine('j')}
      ORDER BY (j.status = 'active') DESC, j.updated_at DESC NULLS LAST`,
    P,
  );
  const journeyIds = jr.rows.map((r: any) => String(r.id));

  const snapReady = await pretestSnapshotColumnReady().catch(() => false);
  const stepRes = journeyIds.length === 0 ? { rows: [] as any[] } : await query(
    `SELECT s.journey_id, s.id, s.step_order, s.channel, snap.confidence,
            dec.status AS dec_status, dec.notify_at AS dec_at,
            ${snapReady ? 'dec.snapshot_id IS NOT DISTINCT FROM snap.id' : 'true'} AS dec_current
       FROM journey_steps s
       LEFT JOIN LATERAL ${latestSnapshotSql('s.journey_id', 's.id')} snap ON TRUE
       LEFT JOIN LATERAL ${latestDecisionLateralSql('s.journey_id', 's.id', snapReady)} dec ON TRUE
      WHERE s.journey_id = ANY($1::uuid[]) AND COALESCE(s.step_type, 'message') = 'message'
      ORDER BY s.journey_id, s.step_order`,
    [journeyIds],
  );

  const todos: BoardTodo[] = [];
  const nameOf = new Map(jr.rows.map((r: any) => [String(r.id), String(r.name || '여정')]));
  const triggerOf = new Map<string, string | null>(jr.rows.map((r: any) => [String(r.id), r.trigger_event ?? null]));
  const journeys: ManagerBoardView['journeys'] = jr.rows.map((r: any) => ({
    id: String(r.id), name: String(r.name || '여정'), status: String(r.status),
    pauseReason: r.status === 'paused' ? pauseReasonView(r.pause_reason).text : null,
    sent7d: Number(r.sent7d || 0), steps: [],
  }));
  const byId = new Map(journeys.map((j) => [j.id, j]));
  for (const s of stepRes.rows as any[]) {
    const check = stepCheckOf({ channel: String(s.channel), confidence: s.confidence == null ? null : Number(s.confidence), decStatus: s.dec_status ?? null, decCurrent: s.dec_current === true });
    byId.get(String(s.journey_id))?.steps.push({ order: Number(s.step_order), channel: String(s.channel), check, checkedAt: s.dec_at ? new Date(s.dec_at).toISOString() : null });
    if (check === 'held') {
      // ★ 2026-11-02 보류 까닭 = 보낼 글 판정(CT-J10)이 걸리면 그 문장 · 아니면 스팸 검사(담당자 안내 문구와 같은 판정)
      const copy = await journeyStepCopyIssueNow(who.companyId, String(s.journey_id), String(s.id), triggerOf.get(String(s.journey_id)) ?? null);
      // ★ 2026-11-02 설계서 3-9 — 검사를 통과한 수정안이 있으면 원문 · 수정안 + [이 글로 보내기](로그인 화면 그 칸 · 한 번 누르면 바뀐다) · [직접 고치기]
      const cand = copy ? null : await readPassedCandidateForStep(who.companyId, String(s.journey_id), String(s.id)).catch(() => null);
      const stepHref = `/ai-journeys?journey=${encodeURIComponent(String(s.journey_id))}&step=${encodeURIComponent(String(s.id))}`;
      todos.push({
        kind: 'held_step',
        title: `${nameOf.get(String(s.journey_id))} ${s.step_order}번 칸이 잠시 멈췄어요`,
        reason: copy
          ? `보낼 글에 고칠 곳이 있어 이 칸만 보내지 않고 있어요. ${copy.message} 여정의 다른 칸은 그대로 나가요.`
          : cand
          ? '스팸 검사에 걸려 이 칸만 보내지 않고 있어요. 검사를 통과한 수정안을 준비했어요. [이 글로 보내기]를 누르면 이어서 보내요.'
          : '스팸 검사에 걸려 이 칸만 보내지 않고 있어요. 여정의 다른 칸은 그대로 나가요. 문안을 고치면 바로 다시 검사해요.',
        action: cand
          ? { label: '이 글로 보내기', href: `${stepHref}&candidate=${encodeURIComponent(cand.snapshotId)}` }
          : { label: '문안 고치러 가기', href: stepHref },
        compare: cand ? { original: cand.original, candidate: cand.body } : null,
        altAction: cand ? { label: '직접 고치기', href: stepHref } : null,
      });
    }
  }
  for (const r of jr.rows as any[]) {
    if (r.dispatch_pending) {
      todos.push({ kind: 'dispatch_pending', title: `${r.name} 받는 분을 넣는 중이에요`, reason: '잠깐 막혀 30분 안에 자동으로 다시 넣어요. 따로 하실 일은 없어요.', action: null });
    }
    if (r.status === 'paused') {
      const v = pauseReasonView(r.pause_reason);
      todos.push({ kind: 'paused_journey', title: `${r.name} 여정이 멈춰 있어요`, reason: v.text, action: { label: '여정 보러 가기', href: `/ai-journeys?journey=${encodeURIComponent(String(r.id))}` } });
    }
  }

  // 지난 7일 문자 칸 · 날짜마다 스팸 차단 몰림(실발송 결과 · E3-5) — 결과 조회가 실패하면 이 줄만 건너뛴다
  const camps = journeyIds.length === 0 ? { rows: [] as any[] } : await query(
    `SELECT jsc.journey_id, jsc.campaign_id, jsc.send_date::text AS send_day, s.step_order
       FROM journey_step_campaigns jsc JOIN journey_steps s ON s.id = jsc.step_id
      WHERE jsc.journey_id = ANY($1::uuid[]) AND jsc.send_date >= ${KST_TODAY} - 6`,
    [journeyIds],
  );
  if (camps.rows.length > 0) {
    try {
      const tables = await getCompanySmsTablesWithLogs(who.companyId);
      const ids = camps.rows.map((c: any) => String(c.campaign_id));
      const [counts, spam] = await Promise.all([smsCampaignCountsSafe(tables, ids), smsCampaignSpamCountsSafe(tables, ids)]);
      for (const c of camps.rows as any[]) {
        const n = counts.get(String(c.campaign_id));
        const sp = spam.get(String(c.campaign_id)) || 0;
        if (n && isSpamBlockSurge(sp, Number(n.success || 0) + Number(n.fail || 0))) {
          const [, mm, dd] = String(c.send_day).split('-');
          todos.push({
            kind: 'spam_surge',
            title: `${nameOf.get(String(c.journey_id))} ${c.step_order}번 칸 ${Number(mm)}월 ${Number(dd)}일 문자가 스팸으로 많이 막혔어요`,
            reason: `통신사가 ${sp}건을 스팸으로 막았어요. 문안을 확인해 주세요(여정은 그대로 나가요).`,
            action: { label: '문안 보러 가기', href: `/ai-journeys?journey=${encodeURIComponent(String(c.journey_id))}` },
          });
        }
      }
    } catch (err: any) {
      console.warn('[manager-board] 스팸 차단 결과 조회 실패(그 줄만 건너뜀):', err?.message || err);
    }
  }

  // 오늘 나갈 칸(여정 · 다음 칸 · 예정 수 · 가장 이른 시각) · [멈추기] = 기존 정지 화면(되묻기 있음 · E3-7)
  const todayRes = journeyIds.length === 0 ? { rows: [] as any[] } : await query(
    `SELECT e.journey_id, ns.id AS step_id, ns.step_order, ns.channel, COUNT(*)::int AS n, MIN(e.next_run_at) AS first_at, MIN(e.id::text) AS any_exec
       FROM journey_executions e
       JOIN journeys j ON j.id = e.journey_id AND j.status = 'active'
       JOIN LATERAL (SELECT id, step_order, channel FROM journey_steps
                      WHERE journey_id = e.journey_id AND step_order > e.current_step_order ORDER BY step_order ASC LIMIT 1) ns ON TRUE
      WHERE e.journey_id = ANY($1::uuid[]) AND e.status = 'active'
        AND (e.next_run_at AT TIME ZONE 'Asia/Seoul')::date = ${KST_TODAY}
      GROUP BY e.journey_id, ns.id, ns.step_order, ns.channel
      ORDER BY first_at ASC`,
    [journeyIds],
  );
  const todayDay = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const today: ManagerBoardView['today'] = [];
  for (const t of todayRes.rows as any[]) {
    let pauseUrl: string | null = null;
    try {
      pauseUrl = buildJourneyPauseUrl(await generatePauseToken({ stepId: String(t.step_id), executionId: String(t.any_exec), companyId: who.companyId, journeyId: String(t.journey_id), phone, sendDate: todayDay }));
    } catch {
      pauseUrl = null;   // 서명 키 없음 = 멈추기 링크만 뺀다
    }
    today.push({ journeyId: String(t.journey_id), journeyName: nameOf.get(String(t.journey_id)) || '여정', stepOrder: Number(t.step_order), channel: String(t.channel), count: Number(t.n), firstAt: new Date(t.first_at).toISOString(), pauseUrl });
  }

  const opRes = await query(
    `SELECT o.id, o.name, o.status, o.next_run_at,
            (SELECT COUNT(*)::int FROM operator_proposals p WHERE p.operator_id = o.id AND p.status IN ('pending', 'admin_review')) AS review_count,
            last.created_at AS last_sent_at, last.recipient_count AS last_recipients
       FROM continuous_operators o
       LEFT JOIN LATERAL (SELECT created_at, recipient_count FROM operator_proposals p
                           WHERE p.operator_id = o.id AND p.status = 'sent' ORDER BY created_at DESC LIMIT 1) last ON TRUE
      WHERE o.company_id = $1::uuid AND o.status <> 'archived'${mine('o')}
      ORDER BY (o.status = 'active') DESC, o.name ASC`,
    P,
  );
  const operators: ManagerBoardView['operators'] = opRes.rows.map((o: any) => ({
    id: String(o.id), name: String(o.name || '자동마케팅'), status: String(o.status),
    nextRunAt: o.next_run_at ? new Date(o.next_run_at).toISOString() : null,
    reviewCount: Number(o.review_count || 0),
    lastSentAt: o.last_sent_at ? new Date(o.last_sent_at).toISOString() : null,
    lastRecipients: o.last_recipients == null ? null : Number(o.last_recipients),
  }));
  for (const o of operators) {
    if (o.reviewCount > 0) {
      todos.push({ kind: 'proposal_review', title: `${o.name} 승인을 기다리는 제안 ${o.reviewCount}건`, reason: '자동으로 보내지 않고 담당자 확인을 기다리고 있어요.', action: { label: '제안 보러 가기', href: '/ai-operator' } });
    }
  }

  const plRes = await query(
    `SELECT e.id, e.title, e.starts_on::text AS starts_on, e.ends_on::text AS ends_on FROM planner_events e
      WHERE e.company_id = $1::uuid AND e.status = 'briefed' AND e.ends_on >= ${KST_TODAY}${mine('e')}
      ORDER BY e.starts_on ASC`,
    P,
  );
  const planner: ManagerBoardView['planner'] = plRes.rows.map((e: any) => ({ id: String(e.id), title: String(e.title || '행사'), startsOn: String(e.starts_on), endsOn: String(e.ends_on) }));
  for (const e of planner) {
    todos.push({ kind: 'planner_confirm', title: `${e.title} 확인을 기다려요`, reason: '마케팅 플래너가 만든 행사 문안을 확인하고 승인해야 나가요.', action: { label: '플래너 보러 가기', href: `/marketing-planner/events/${encodeURIComponent(e.id)}` } });
  }

  // 숫자 = 지난 7일(여정 칸 캠페인 + 자동마케팅 보낸 제안 캠페인 · 성공률 = 결과가 난 것 중)
  const num = await query(
    `SELECT COALESCE(SUM(c.sent_count), 0)::bigint AS sent, COALESCE(SUM(c.success_count), 0)::bigint AS ok, COALESCE(SUM(c.fail_count), 0)::bigint AS bad
       FROM campaigns c
      WHERE c.company_id = $1::uuid AND c.id IN (
              SELECT jsc.campaign_id FROM journey_step_campaigns jsc JOIN journeys j ON j.id = jsc.journey_id
               WHERE j.company_id = $1::uuid AND jsc.send_date >= ${KST_TODAY} - 6${mine('j')}
              UNION
              SELECT p.campaign_id FROM operator_proposals p JOIN continuous_operators o ON o.id = p.operator_id
               WHERE p.company_id = $1::uuid AND p.campaign_id IS NOT NULL AND COALESCE(p.auto_sent_at, p.created_at) >= NOW() - INTERVAL '7 days'${mine('o')})`,   // 보낸 시각(R18)
    P,
  );
  const ok = Number(num.rows[0]?.ok || 0);
  const bad = Number(num.rows[0]?.bad || 0);

  return {
    companyName: String(u.rows[0].company_name || ''),
    scope: isAdmin ? 'company' : 'mine',
    generatedAt: new Date().toISOString(),
    verdict: boardVerdict(todos),
    numbers: {
      activeJourneys: journeys.filter((j) => j.status === 'active').length,
      activeOperators: operators.filter((o) => o.status === 'active').length,
      sent7d: Number(num.rows[0]?.sent || 0),
      successRate: ok + bad > 0 ? Math.round((ok / (ok + bad)) * 1000) / 10 : null,
    },
    todos,
    today,
    journeys: journeys.slice(0, BOARD_LIST_MAX),
    operators: operators.slice(0, BOARD_LIST_MAX),
    planner,
    more: { journeys: Math.max(0, journeys.length - BOARD_LIST_MAX), operators: Math.max(0, operators.length - BOARD_LIST_MAX) },
  };
}
