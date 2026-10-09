/**
 * ★ CT: 공개 소개 페이지(/intro) 방문 · 시연 요청 (★2026-10-07 Harold 지시)
 *
 * 경위: 상세 소개(/about)가 바깥에 돌아 기능을 보고 따라 할 수 있다는 우려 → 상세 소개는 hoyun 전용으로 닫고,
 *   공개 소개는 공개 릴스 영상 + 기능 이름 · 한 줄만 싣는 /intro 로 바꿨다. 자세한 기능은 시연에서만 보여 준다.
 *   「누가 봤는지」를 보려고 방문(IP · 브라우저 · 들어온 곳)을 남기고, 그 IP 로 우리 서비스에 로그인한 계정을 대조한다.
 *   영상은 정보 입력 없이 바로 재생한다(Harold: 「시청하려면 정보 넣으세요 하지 말라」). 개인정보는 시연 요청 때만 받는다.
 *
 * 원천 = audit_logs(새 칸 · 새 테이블 0) — 방문 `intro_view` · 시연 요청 `intro_demo_request`(target_type 'intro').
 * 열람 = 슈퍼관리자 「소개 방문 · 시연 요청」 — INTRO_LEADS_VIEWER_IDS(기본 'ceo,suran') AND 등급표 introLeads.
 */
import { query } from '../config/database';
import { recordAuditLog } from './audit-log';

export const INTRO_ACTIONS = { view: 'intro_view', request: 'intro_demo_request' } as const;
export const INTRO_TARGET = 'intro';
export const INTRO_PAGE_SIZE = 20;
/** 공개 경로 호출 상한(IP당) — 방문 기록은 페이지를 사람이 여는 속도, 시연 요청은 문의 창과 같은 한도 */
export const INTRO_RATE = {
  view: { windowMs: 10 * 60 * 1000, max: 20 },
  request: { windowMs: 10 * 60 * 1000, max: 5 },
} as const;

export const DEMO_METHODS = { visit: '방문 시연', video: '화상 시연' } as const;
export type DemoMethod = keyof typeof DEMO_METHODS;

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** 방문 기록 — 들어온 곳(referrer)은 호스트만 남긴다(경로 · 검색어에 개인 정보가 실릴 수 있다). 실패해도 화면 영향 0 */
export async function recordIntroView(req: any, body: any): Promise<void> {
  let from = '';
  try { from = body?.referrer ? new URL(String(body.referrer)).host.slice(0, 100) : ''; } catch { from = ''; }
  await recordAuditLog({ action: INTRO_ACTIONS.view, targetType: INTRO_TARGET, details: { from }, req });
}

export interface DemoRequestInput {
  companyName: string;
  contactName: string;
  phone: string;
  method: DemoMethod;
  memo: string;
}

/** 시연 요청 정규화 — 틀리면 화면에 그대로 보여 줄 문장을 돌려준다 */
export function parseDemoRequest(body: any): { ok: true; value: DemoRequestInput } | { ok: false; error: string } {
  const companyName = clip(body?.companyName, 60);
  const contactName = clip(body?.contactName, 30);
  const phone = clip(body?.phone, 20).replace(/[^0-9]/g, '');
  const method = (Object.keys(DEMO_METHODS) as DemoMethod[]).find((m) => m === body?.method) ?? 'visit';
  const memo = clip(body?.memo, 500);
  if (!companyName) return { ok: false, error: '회사명을 입력해 주세요.' };
  if (!contactName) return { ok: false, error: '담당자 이름을 입력해 주세요.' };
  if (!/^0\d{8,10}$/.test(phone)) return { ok: false, error: '연락받으실 휴대폰 번호를 확인해 주세요.' };
  if (body?.consent !== true) return { ok: false, error: '개인정보 수집 · 이용에 동의해 주셔야 요청을 받을 수 있습니다.' };
  return { ok: true, value: { companyName, contactName, phone, method, memo } };
}

/** 시연 요청 저장 — 방문 기록과 달리 실패를 삼키지 않는다(저장 안 된 요청을 「접수됐다」고 하면 안 된다) */
export async function recordDemoRequest(req: any, v: DemoRequestInput): Promise<void> {
  await query(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address, user_agent)
     VALUES (NULL, $1, $2, NULL, $3, $4, $5)`,
    [INTRO_ACTIONS.request, INTRO_TARGET, JSON.stringify(v), req?.ip || null, req?.headers?.['user-agent'] || ''],
  );
}

export type IntroLeadKind = 'all' | 'request' | 'view';

export function parseIntroLeadsQuery(q: any): { kind: IntroLeadKind; page: number } {
  const kind = (['all', 'request', 'view'] as const).find((k) => k === q?.kind) ?? 'all';
  const page = Math.max(1, Math.min(10000, Math.floor(Number(q?.page)) || 1));
  return { kind, page };
}

/**
 * ★ 2026-10-09 검색 로봇 판정(Harold 「밤 12시 방문 수상하다」 → 실측 = AhrefsBot · bingbot 이 로그인 화면 「한줄로 AI 소개」 링크를 따라 /intro 를 연 것).
 * 브라우저 원문이 스스로 로봇이라고 밝힌 것만 센다(로봇 표시 없는 데이터센터 크롬은 방문으로 둔다 · IP 대역 판정은 하지 않는다).
 * 같은 글자를 PostgreSQL `~*` 와 JS `RegExp(…, 'i')` 가 함께 쓴다 — 두 문법에 공통인 `|` 묶음만 쓴다.
 * 기록은 그대로 남기고 읽을 때 가른다(이미 쌓인 행도 같이 분류된다).
 */
export const INTRO_BOT_UA_PATTERN = 'bot|crawl|spider|slurp|headless|yeti|daumoa'; // yeti = 네이버 · daumoa = 다음(이름에 bot 이 없다)
const BOT_RE = new RegExp(INTRO_BOT_UA_PATTERN, 'i');
export const isIntroBot = (userAgent: string | null | undefined): boolean => BOT_RE.test(String(userAgent || ''));

export interface IntroLeadRow {
  id: string;
  at: string;
  kind: 'request' | 'view';
  /** 브라우저 원문이 로봇이라고 밝힌 방문(검색 로봇) — 방문 숫자에서 뺀다 */
  isBot: boolean;
  ip: string;
  userAgent: string;
  from: string;
  request: DemoRequestInput | null;
  /** 같은 IP 로 우리 서비스에 로그인한 적 있는 계정(최근 순 · 고객사 · 슈퍼관리자 모두) */
  sameIpLogins: Array<{ loginId: string; companyName: string; lastAt: string }>;
}

export interface IntroLeadsData {
  /** 방문 숫자 = 검색 로봇 제외 · bots7d = 최근 7일에 뺀 로봇 방문 수 */
  summary: { viewsToday: number; views7d: number; bots7d: number; requests: number };
  total: number;
  page: number;
  rows: IntroLeadRow[];
}

const KIND_ACTIONS: Record<IntroLeadKind, string[]> = {
  all: [INTRO_ACTIONS.view, INTRO_ACTIONS.request],
  request: [INTRO_ACTIONS.request],
  view: [INTRO_ACTIONS.view],
};

/** 목록(20건씩) + 같은 IP 로그인 계정 대조 — 대조는 그 쪽에 나온 IP 만 본다 */
export async function loadIntroLeads(q: { kind: IntroLeadKind; page: number }): Promise<IntroLeadsData> {
  const actions = KIND_ACTIONS[q.kind];
  const offset = (q.page - 1) * INTRO_PAGE_SIZE;
  const [list, count, summary] = await Promise.all([
    query(
      `SELECT id::text AS id, action, details, host(ip_address) AS ip, COALESCE(user_agent, '') AS user_agent, created_at
         FROM audit_logs WHERE action = ANY($1::text[])
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [actions, INTRO_PAGE_SIZE, offset],
    ),
    query(`SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = ANY($1::text[])`, [actions]),
    query(
      `SELECT COUNT(*) FILTER (WHERE action = $1 AND NOT bot AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')::int AS today,
              COUNT(*) FILTER (WHERE action = $1 AND NOT bot AND created_at >= NOW() - INTERVAL '7 days')::int AS week,
              COUNT(*) FILTER (WHERE action = $1 AND bot AND created_at >= NOW() - INTERVAL '7 days')::int AS bots_week,
              COUNT(*) FILTER (WHERE action = $2)::int AS requests
         FROM (SELECT action, created_at, COALESCE(user_agent, '') ~* $3 AS bot
                 FROM audit_logs WHERE action IN ($1, $2)) t`,
      [INTRO_ACTIONS.view, INTRO_ACTIONS.request, INTRO_BOT_UA_PATTERN],
    ),
  ]);

  const ips = Array.from(new Set(list.rows.map((r: any) => String(r.ip || '')).filter(Boolean)));
  const loginsByIp = new Map<string, IntroLeadRow['sameIpLogins']>();
  if (ips.length > 0) {
    const logins = await query(
      `SELECT host(ip_address) AS ip, details->>'loginId' AS login_id, COALESCE(details->>'companyName', '') AS company_name,
              MAX(created_at) AS last_at
         FROM audit_logs
        WHERE action = 'login_success' AND ip_address = ANY($1::inet[])
        GROUP BY 1, 2, 3
        ORDER BY last_at DESC`,
      [ips],
    );
    for (const r of logins.rows) {
      if (!r.login_id) continue;
      const arr = loginsByIp.get(r.ip) ?? [];
      arr.push({ loginId: String(r.login_id), companyName: String(r.company_name), lastAt: new Date(r.last_at).toISOString() });
      loginsByIp.set(r.ip, arr);
    }
  }

  const rows: IntroLeadRow[] = list.rows.map((r: any) => {
    const d = r.details && typeof r.details === 'object' ? r.details : {};
    const isRequest = r.action === INTRO_ACTIONS.request;
    return {
      id: r.id,
      at: new Date(r.created_at).toISOString(),
      kind: isRequest ? 'request' : 'view',
      isBot: !isRequest && isIntroBot(r.user_agent),
      ip: String(r.ip || ''),
      userAgent: String(r.user_agent || ''),
      from: isRequest ? '' : String(d.from || ''),
      request: isRequest
        ? { companyName: String(d.companyName || ''), contactName: String(d.contactName || ''), phone: String(d.phone || ''),
            method: (d.method === 'video' ? 'video' : 'visit') as DemoMethod, memo: String(d.memo || '') }
        : null,
      sameIpLogins: loginsByIp.get(String(r.ip || '')) ?? [],
    };
  });

  const s = summary.rows[0] || {};
  return {
    summary: { viewsToday: Number(s.today) || 0, views7d: Number(s.week) || 0, bots7d: Number(s.bots_week) || 0, requests: Number(s.requests) || 0 },
    total: Number(count.rows[0]?.n) || 0,
    page: q.page,
    rows,
  };
}
