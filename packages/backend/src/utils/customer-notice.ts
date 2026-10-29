/**
 * ★ CT: 고객 공지 · 확인 기록 (★2026-10-29 Harold 「확인한 업체가 누군지 보안인증 메뉴에서 체크」)
 *
 * 설계 = docs/2026-10-29-customer-security-notice-ack-design.md(Codex 설계 3R approve).
 * 화면 = B 카드(SecurityNoticeCard · App 전역) · C 점검 기록(/security-report) · D 공지 확인 현황(슈퍼관리자 보안 · 인증).
 *
 * 원천 = audit_logs(새 칸 · 새 테이블 0) · target_type `customer_notice` · details `{ noticeId, companyId, loginId }`(그 순간 값 · 서버가 채움).
 *   shown  = 카드가 떴다(계정 · 회사 · 공지마다 처음 한 번)
 *   report = 점검 기록을 열었다
 *   ack    = 「확인했습니다」(이미 있으면 새로 쓰지 않음)
 *   세 사건 모두 D 상태를 정하는 원장이라 실패를 던지는 쓰기 한 길(Codex 구현 1R · 저장이 확인돼야 204).
 * 읽는 범위는 언제나 공지 시작일(KST 0시) 뒤로 묶는다 → 판정은 idx_audit_logs_user(user_id, created_at DESC) 범위 읽기.
 * 동시 요청이 같은 사건 두 행을 만들 수 있으나 판정 · 집계가 EXISTS · MIN 만 써서 무해하다(Codex 설계 2R).
 */
import { query } from '../config/database';
import { recordAuditLogStrict } from './audit-log';
import { listInternalCompanyIds } from './internal-company';
import { todayKst } from './plan-change-log';

export interface CustomerNotice {
  id: string;
  title: string;
  /** 사건이 생길 수 있는 첫날(KST 날짜 글자) */
  startsAt: string;
  /** 카드를 띄우는 마지막 날(KST 날짜 글자 · 이날까지) */
  showUntil: string;
}

/** 공지 원장 — 새 공지는 여기에 한 줄 */
export const CUSTOMER_NOTICES: readonly CustomerNotice[] = [
  { id: '2026-10-security-check', title: '2026년 10월 보안 점검 공지', startsAt: '2026-10-29', showUntil: '2026-11-30' },
];

export const CUSTOMER_NOTICE_ACTIONS = {
  shown: 'customer_notice_shown',
  report: 'customer_notice_report',
  ack: 'customer_notice_ack',
} as const;
export type CustomerNoticeEvent = keyof typeof CUSTOMER_NOTICE_ACTIONS;
export const CUSTOMER_NOTICE_TARGET = 'customer_notice';
/** 기록 경로 호출 상한 — 사용자당 1분 30회(기능 관심 업체와 같은 값) */
export const CUSTOMER_NOTICE_RATE = { windowMs: 60 * 1000, max: 30 } as const;

export function findNotice(id: unknown): CustomerNotice | null {
  return CUSTOMER_NOTICES.find((n) => n.id === id) ?? null;
}

/** 카드를 띄울 수 있는 날인가(시작일 ~ 마지막 날 · KST 글자 비교 · R16) */
export function isNoticeShowing(n: CustomerNotice, today: string = todayKst()): boolean {
  return n.startsAt <= today && today <= n.showUntil;
}

/** 기록 요청 정규화 — 원장에 없는 id · 모르는 사건 = null */
export function parseNoticeEvent(body: any): { notice: CustomerNotice; event: CustomerNoticeEvent } | null {
  const notice = findNotice(body?.noticeId);
  const event = (['shown', 'report', 'ack'] as const).find((e) => e === body?.event) ?? null;
  return notice && event ? { notice, event } : null;
}

export interface NoticeActor { userId: string; companyId: string; loginId: string }

/** 기록 · 판정 대상 = 고객사 사람 계정만(슈퍼관리자 · 회사 없는 토큰 제외) */
export function noticeActor(user: any): NoticeActor | null {
  if (!user || user.userType === 'super_admin' || !user.userId || !user.companyId) return null;
  return { userId: String(user.userId), companyId: String(user.companyId), loginId: String(user.loginId || '') };
}

/** 공지 시작일(KST 0시) — 서버 시간대와 무관하게 SQL 안에서 바꾼다 */
const STARTS_AT_SQL = `($2::date::timestamp AT TIME ZONE 'Asia/Seoul')`;

async function hasEvent(actor: NoticeActor, notice: CustomerNotice, event: CustomerNoticeEvent): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM audit_logs
      WHERE user_id = $1 AND created_at >= ${STARTS_AT_SQL}
        AND action = $3 AND details->>'companyId' = $4 AND details->>'noticeId' = $5
      LIMIT 1`,
    [actor.userId, notice.startsAt, CUSTOMER_NOTICE_ACTIONS[event], actor.companyId, notice.id],
  );
  return r.rows.length > 0;
}

/** 이 계정에 띄울 공지 — 기간 안 · 이 회사에서 아직 확인 안 함 · 모르면(조회 오류) 띄우지 않는다 */
export async function noticeForUser(user: any, today: string = todayKst()): Promise<CustomerNotice | null> {
  const actor = noticeActor(user);
  if (!actor) return null;
  for (const n of CUSTOMER_NOTICES) {
    if (!isNoticeShowing(n, today)) continue;
    try {
      if (!(await hasEvent(actor, n, 'ack'))) return n;
    } catch (err: any) {
      console.log('[customer-notice] 판정 실패(띄우지 않음):', err?.message);
      return null;
    }
  }
  return null;
}

export type NoticeEventResult = 'ok' | 'skipped' | 'closed';

/**
 * 사건 기록 — 저장이 확인돼야 'ok'(실패는 던진다 · 6원칙 ②) · ack 는 이미 있으면 그대로 · shown 은 처음 한 번.
 * 'skipped' = 기록 대상 아님 · 'closed' = 기간 밖 공지의 ack · shown(점검 기록 열람만 받는다).
 */
export async function recordNoticeEvent(
  req: any,
  input: { notice: CustomerNotice; event: CustomerNoticeEvent },
  today: string = todayKst(),
): Promise<NoticeEventResult> {
  const actor = noticeActor(req?.user);
  if (!actor) return 'skipped';
  const { notice, event } = input;
  if (today < notice.startsAt) return 'closed';
  if (event !== 'report' && !isNoticeShowing(notice, today)) return 'closed';
  const entry = {
    actorUserId: actor.userId,
    action: CUSTOMER_NOTICE_ACTIONS[event],
    targetType: CUSTOMER_NOTICE_TARGET,
    details: { noticeId: notice.id, companyId: actor.companyId, loginId: actor.loginId },
    req,
  };
  // 세 사건 모두 D 의 상태를 정하는 기록이다 → 같은 엄격 쓰기 한 길(저장이 확인돼야 'ok' · 실패는 던진다 · Codex 구현 1R)
  if (event === 'ack' && await hasEvent(actor, notice, 'ack')) return 'ok';
  if (event === 'shown') {
    try {
      if (await hasEvent(actor, notice, 'shown')) return 'ok';
    } catch {
      /* 확인 못 하면 남긴다(집계는 MIN 이라 중복 무해) */
    }
  }
  await recordAuditLogStrict(entry);
  return 'ok';
}

export type NoticeAckStatus = 'acked' | 'seen' | 'none';

export interface NoticeAckAccount {
  loginId: string;
  name: string;
  /** 지금 이 회사의 활성 사람 계정인가(지워졌거나 옮긴 계정의 기록 = false) */
  current: boolean;
  lastLoginAt: string | null;
  shownAt: string | null;
  reportAt: string | null;
  ackAt: string | null;
}

export interface NoticeAckCompany {
  companyId: string;
  companyName: string;
  status: NoticeAckStatus;
  firstShownAt: string | null;
  reportAt: string | null;
  ackAt: string | null;
  ackLoginId: string | null;
  people: number;
  lastLoginAt: string | null;
  accounts: NoticeAckAccount[];
}

export interface NoticeAckData {
  notice: CustomerNotice;
  notices: Array<{ id: string; title: string }>;
  summary: { companies: number; acked: number; seen: number; none: number };
  companies: NoticeAckCompany[];
}

const iso = (v: any): string | null => (v ? new Date(v).toISOString() : null);
const minIso = (a: string | null, b: string | null): string | null => (!a ? b : !b ? a : a < b ? a : b);
/** ★1029 Harold 「확인한 업체는 1페이지에 먼저」 = 확인함 → 보기만 함 → 아직 안 봄 · 안에서는 그 상태가 된 시각(또는 마지막 로그인) 최근 순 */
const STATUS_ORDER: Record<NoticeAckStatus, number> = { acked: 0, seen: 1, none: 2 };
const sortAt = (c: NoticeAckCompany): string =>
  (c.status === 'acked' ? c.ackAt : c.status === 'seen' ? (c.firstShownAt ?? c.reportAt) : c.lastLoginAt) || '';

/**
 * 공지 확인 현황(D) — 대상 회사 = 상태 활성(NULL · active) · 사내 회사 아님 · 활성 사람 계정(admin · user) 1개 이상.
 * 회사 귀속 = 사건의 details.companyId · 확인한 계정 = 그 사건의 details.loginId(R18 · 지워진 계정도 남는다).
 * 수는 SQL 묶음으로 센다(행을 읽어 JS 로 세지 않는다 · 기능 관심 업체 Codex 1R 교훈).
 */
export async function loadNoticeAck(noticeId: unknown): Promise<NoticeAckData | null> {
  const notice = findNotice(noticeId) ?? (noticeId ? null : CUSTOMER_NOTICES[0] ?? null);
  if (!notice) return null;
  const internalIds = await listInternalCompanyIds();

  const [companies, people, events] = await Promise.all([
    query(
      `SELECT c.id::text AS company_id, COALESCE(c.company_name, '') AS company_name
         FROM companies c
        WHERE (c.status IS NULL OR c.status = 'active')
          AND NOT (c.id = ANY($1::uuid[]))
          AND EXISTS (SELECT 1 FROM users u WHERE u.company_id = c.id AND u.user_type IN ('admin', 'user') AND u.is_active = true)`,
      [internalIds],
    ),
    query(
      `SELECT u.company_id::text AS company_id, u.id::text AS user_id, u.login_id, COALESCE(u.name, '') AS name,
              (u.last_login_at AT TIME ZONE current_setting('TimeZone')) AS last_login_at
         FROM users u
        WHERE u.user_type IN ('admin', 'user') AND u.is_active = true AND u.company_id IS NOT NULL`,
      [],
    ),
    query(
      `SELECT al.details->>'companyId' AS company_id, al.user_id::text AS user_id,
              COALESCE(al.details->>'loginId', '') AS login_id, al.action, MIN(al.created_at) AS first_at
         FROM audit_logs al
        WHERE al.created_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Seoul')
          AND al.action IN ($2, $3, $4) AND al.details->>'noticeId' = $5
        GROUP BY 1, 2, 3, 4`,
      [notice.startsAt, CUSTOMER_NOTICE_ACTIONS.shown, CUSTOMER_NOTICE_ACTIONS.report, CUSTOMER_NOTICE_ACTIONS.ack, notice.id],
    ),
  ]);

  type Acc = NoticeAckCompany & { byKey: Map<string, NoticeAckAccount> };
  const byCompany = new Map<string, Acc>();
  for (const r of companies.rows) {
    const id = String(r.company_id).toLowerCase();
    byCompany.set(id, {
      companyId: id, companyName: String(r.company_name || ''), status: 'none', firstShownAt: null, reportAt: null,
      ackAt: null, ackLoginId: null, people: 0, lastLoginAt: null, accounts: [], byKey: new Map(),
    });
  }
  for (const r of people.rows) {
    const a = byCompany.get(String(r.company_id).toLowerCase());
    if (!a) continue;
    const lastLoginAt = iso(r.last_login_at);
    a.people += 1;
    if (lastLoginAt && (!a.lastLoginAt || lastLoginAt > a.lastLoginAt)) a.lastLoginAt = lastLoginAt;
    a.byKey.set(`u:${r.user_id}`, {
      loginId: String(r.login_id || ''), name: String(r.name || ''), current: true, lastLoginAt,
      shownAt: null, reportAt: null, ackAt: null,
    });
  }
  for (const r of events.rows) {
    const a = byCompany.get(String(r.company_id || '').toLowerCase());
    if (!a) continue;
    const key = r.user_id ? `u:${r.user_id}` : `l:${r.login_id}`;
    let acct = a.byKey.get(key);
    if (!acct) {
      acct = { loginId: String(r.login_id || ''), name: '', current: false, lastLoginAt: null, shownAt: null, reportAt: null, ackAt: null };
      a.byKey.set(key, acct);
    }
    if (!acct.loginId && r.login_id) acct.loginId = String(r.login_id);
    const at = iso(r.first_at);
    if (r.action === CUSTOMER_NOTICE_ACTIONS.ack) {
      acct.ackAt = minIso(acct.ackAt, at);
      if (at && (!a.ackAt || at < a.ackAt)) { a.ackAt = at; a.ackLoginId = String(r.login_id || acct.loginId || ''); }
    } else if (r.action === CUSTOMER_NOTICE_ACTIONS.report) {
      acct.reportAt = minIso(acct.reportAt, at);
      a.reportAt = minIso(a.reportAt, at);
    } else {
      acct.shownAt = minIso(acct.shownAt, at);
      a.firstShownAt = minIso(a.firstShownAt, at);
    }
  }

  const list: NoticeAckCompany[] = [...byCompany.values()].map(({ byKey, ...a }) => {
    const status: NoticeAckStatus = a.ackAt ? 'acked' : a.firstShownAt || a.reportAt ? 'seen' : 'none';
    const accounts = [...byKey.values()].sort((x, y) => Number(!!y.ackAt) - Number(!!x.ackAt) || (y.lastLoginAt || '').localeCompare(x.lastLoginAt || ''));
    return { ...a, status, accounts };
  });
  list.sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || sortAt(y).localeCompare(sortAt(x)));

  return {
    notice,
    notices: CUSTOMER_NOTICES.map((n) => ({ id: n.id, title: n.title })),
    summary: {
      companies: list.length,
      acked: list.filter((c) => c.status === 'acked').length,
      seen: list.filter((c) => c.status === 'seen').length,
      none: list.filter((c) => c.status === 'none').length,
    },
    companies: list,
  };
}
