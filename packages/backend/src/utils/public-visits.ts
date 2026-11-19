/**
 * public-visits.ts — 공개 페이지 방문 기록 컨트롤타워(★ 2026-11-19 C145 · 설계서 docs/2026-11-19-c145-public-session-visits-design.md §3)
 *
 * 누가(신청 닉네임 · 로그인 흔적 · 그 밖 IP 와 기기) · 어떤 IP 가 · 얼마나(화면이 실제로 보이던 시간) 머물렀는지.
 * 등록된 페이지(PUBLIC_VISIT_PAGES)만 받는다 — 다른 공개 페이지는 여기 한 줄 + 그 화면에 usePublicVisit 한 줄(계약 K7).
 *
 * ⛔ 방문 행의 정체 = (id, browser_key, page) 셋 — 모든 쓰기는 셋이 다 맞는 행만 바꾼다(설계 2R 지적 3).
 * ⛔ 머문 시간은 서버가 본 흐른 시간을 넘지 못한다(신호를 몰아 보내도 · 설계 1R 지적 5).
 * ⛔ 방문 등록(start)과 신청 잇기는 도착 순서와 무관하게 한 행에 모인다(설계 1R 지적 6).
 * 보관 = 90일(처리방침 자동수집항목 IP · 접속 기록 3개월).
 */
import { query } from '../config/database';
import { recordAuditLog } from './audit-log';
import { parseQueryInt } from './normalize';

export const PUBLIC_VISIT_PAGES = ['jbn'] as const;
export type PublicVisitPage = typeof PUBLIC_VISIT_PAGES[number];

/** IP당 호출 상한(10분) — 남용 막기만(머문 시간 부풀리기는 서버 시간 상한이 막는다) · 같은 IP 동시 방문 100명 · 30초 신호 기준 */
export const PUBLIC_VISIT_RATE = {
  start: { windowMs: 10 * 60 * 1000, max: 300 },
  beat: { windowMs: 10 * 60 * 1000, max: 3000 },
} as const;

export const PUBLIC_VISIT_KEEP_DAYS = 90;
/** 한 방문의 머문 시간 상한(초) = 6시간 · 표 CHECK 와 같다 */
export const PUBLIC_VISIT_MAX_SECONDS = 21600;
/** 한 번의 신호가 더할 수 있는 최대(초) */
export const PUBLIC_VISIT_BEAT_MAX_SECONDS = 60;
/** 서버가 본 흐른 시간에 더해 주는 여유(초) — 신호가 늦게 닿은 몫 */
export const PUBLIC_VISIT_SLACK_SECONDS = 5;
/** 관리자 화면 한 번에 그리는 줄 상한 */
export const PUBLIC_VISIT_READ_LIMIT = 500;
export const PUBLIC_VISIT_DAY_CHOICES = [1, 7, 30, 90] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const isPage = (v: unknown): v is PublicVisitPage => (PUBLIC_VISIT_PAGES as readonly unknown[]).includes(v);

/** 주소의 ?src= = 영숫자 · - _ 만(그 밖이면 버림) */
const cleanSrc = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(v) ? v : null);
/** 들어온 곳 = 호스트만(경로 · 검색어 버림) */
const cleanHost = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const h = v.trim().toLowerCase();
  return /^[a-z0-9.-]{1,200}$/.test(h) && h.includes('.') ? h : null;
};

export interface VisitStartInput { id: string; page: PublicVisitPage; browserKey: string; src: string | null; referrerHost: string | null }
export interface VisitBeatInput { id: string; page: PublicVisitPage; browserKey: string; seconds: number }

export function parseVisitStart(body: any): VisitStartInput | null {
  if (!isUuid(body?.id) || !isUuid(body?.browserKey) || !isPage(body?.page)) return null;
  return { id: body.id.toLowerCase(), page: body.page, browserKey: body.browserKey.toLowerCase(), src: cleanSrc(body.src), referrerHost: cleanHost(body.referrerHost) };
}

export function parseVisitBeat(body: any): VisitBeatInput | null {
  if (!isUuid(body?.id) || !isUuid(body?.browserKey) || !isPage(body?.page)) return null;
  const n = Number(body?.seconds);
  if (!Number.isFinite(n)) return null;
  const seconds = Math.max(0, Math.min(PUBLIC_VISIT_BEAT_MAX_SECONDS, Math.floor(n)));
  return { id: body.id.toLowerCase(), page: body.page, browserKey: body.browserKey.toLowerCase(), seconds };
}

const clipUa = (ua: unknown): string | null => (typeof ua === 'string' && ua ? ua.slice(0, 400) : null);

/** 방문 등록 — 비어 있는 칸만 채운다(신청 잇기가 먼저 만든 행 포함) · 셋이 다른 행은 그대로 */
export async function recordVisitStart(
  v: VisitStartInput,
  ctx: { ip: string | null; userAgent: unknown; loginId: string | null; userType: string | null },
): Promise<void> {
  await query(
    `INSERT INTO public_page_visits AS t (id, page, browser_key, ip_address, user_agent, referrer_host, src, login_id, user_type)
     VALUES ($1, $2, $3, $4::inet, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       ip_address = COALESCE(t.ip_address, EXCLUDED.ip_address),
       user_agent = COALESCE(t.user_agent, EXCLUDED.user_agent),
       referrer_host = COALESCE(t.referrer_host, EXCLUDED.referrer_host),
       src = COALESCE(t.src, EXCLUDED.src),
       login_id = COALESCE(t.login_id, EXCLUDED.login_id),
       user_type = COALESCE(t.user_type, EXCLUDED.user_type)
     WHERE t.browser_key = EXCLUDED.browser_key AND t.page = EXCLUDED.page`,
    [v.id, v.page, v.browserKey, ipOrNull(ctx.ip), clipUa(ctx.userAgent), v.referrerHost, v.src,
      ctx.loginId ? String(ctx.loginId).slice(0, 100) : null, ctx.userType ? String(ctx.userType).slice(0, 20) : null],
  );
}

/**
 * 머문 시간 신호 — 더하는 양 ≤ 지난 신호 뒤 흐른 시간 + 여유 · 합 ≤ 연 뒤 흐른 시간 + 여유 · 6시간.
 * 하루 지난 방문은 받지 않는다 · 셋이 다른 행은 그대로.
 */
export async function recordVisitBeat(v: VisitBeatInput): Promise<void> {
  await query(
    `UPDATE public_page_visits
        SET visible_seconds = LEAST(
              visible_seconds + LEAST($4::int, FLOOR(GREATEST(0, EXTRACT(EPOCH FROM (now() - last_seen_at)))) + $5::int),
              FLOOR(GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at)))) + $5::int,
              $6::int
            )::int,
            last_seen_at = now()
      WHERE id = $1 AND page = $2 AND browser_key = $3 AND started_at > now() - interval '1 day'`,
    [v.id, v.page, v.browserKey, v.seconds, PUBLIC_VISIT_SLACK_SECONDS, PUBLIC_VISIT_MAX_SECONDS],
  );
}

/**
 * 신청 잇기 — 신청을 받은 뒤 그 방문 행에 신청 id 를 적는다(행이 없으면 만든다 = start 보다 먼저 와도 한 행에 모인다).
 * 이미 이어진 신청은 바꾸지 않는다 · 셋이 다른 행은 그대로 · 값이 틀리면 아무것도 안 한다.
 */
export async function linkVisitApplication(input: {
  visitId: unknown; browserKey: unknown; applicationId: string; page: PublicVisitPage; ip: string | null; userAgent: unknown;
}): Promise<void> {
  if (!isUuid(input.visitId) || !isUuid(input.browserKey) || !isUuid(input.applicationId)) return;
  await query(
    `INSERT INTO public_page_visits AS t (id, page, browser_key, application_id, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::inet, $6)
     ON CONFLICT (id) DO UPDATE SET
       application_id = COALESCE(t.application_id, EXCLUDED.application_id),
       ip_address = COALESCE(t.ip_address, EXCLUDED.ip_address),
       user_agent = COALESCE(t.user_agent, EXCLUDED.user_agent)
     WHERE t.browser_key = EXCLUDED.browser_key AND t.page = EXCLUDED.page`,
    [input.visitId.toLowerCase(), input.page, input.browserKey.toLowerCase(), input.applicationId.toLowerCase(),
      ipOrNull(input.ip), clipUa(input.userAgent)],
  );
}

function ipOrNull(ip: string | null): string | null {
  if (!ip) return null;
  const v = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return /^[0-9a-fA-F:.]{3,45}$/.test(v) ? v : null;
}

// ─────────────────────────────────────────────
// 기기 · 앱 판별(관리자 화면 · 순수)
// ─────────────────────────────────────────────

export interface VisitorAgent { device: '휴대폰' | '태블릿' | 'PC' | '알 수 없음'; app: string }

export function describeVisitorAgent(ua: unknown): VisitorAgent {
  const s = typeof ua === 'string' ? ua : '';
  const app = /KAKAOTALK/i.test(s) ? '카카오톡'
    : /NAVER\(inapp|NAVER\//.test(s) ? '네이버 앱'
      : /Instagram/i.test(s) ? '인스타그램'
        : /FBAN|FBAV|FB_IAB/.test(s) ? '페이스북'
          : /\bBAND\//.test(s) ? '밴드'
            : /\bLine\//.test(s) ? '라인'
              : s ? '브라우저' : '알 수 없음';
  const device = /iPad|Tablet/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s)) ? '태블릿'
    : /iPhone|iPod|Android|Mobile/i.test(s) ? '휴대폰'
      : /Windows|Macintosh|X11|CrOS|Linux/i.test(s) ? 'PC'
        : '알 수 없음';
  return { device, app };
}

// ─────────────────────────────────────────────
// 관리자 읽기
// ─────────────────────────────────────────────

export type VisitWho =
  | { kind: 'application'; applicationId: string; nickname: string | null; companyName: string | null }
  | { kind: 'login'; loginId: string; userType: string | null }
  | { kind: 'unknown' };

export interface PublicVisitRow {
  id: string; startedAt: string; seconds: number; ip: string | null; device: VisitorAgent['device']; app: string;
  who: VisitWho; browserVisits: number; referrerHost: string | null; src: string | null;
}
export interface PublicVisitOverview {
  days: number;
  summary: { visits: number; browsers: number; avgSeconds: number; appliedBrowsers: number };
  rows: PublicVisitRow[];
  truncated: boolean;
}

/** 기간 시작 = 한국 시간 오늘 0시에서 (days - 1)일 앞($2 = days) */
export const VISIT_PERIOD_START_SQL = `((date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') - make_interval(days => $2 - 1)) AT TIME ZONE 'Asia/Seoul')`;

/** 관리자 화면 기간(주소 ?days=) — 주소 숫자 값은 CT(parseQueryInt · R59)로 읽고 고를 수 있는 값만 */
export function parseVisitDays(v: unknown): number {
  const n = parseQueryInt(v, { fallback: 7, min: 1, max: 90 });
  return (PUBLIC_VISIT_DAY_CHOICES as readonly number[]).includes(n) ? n : 7;
}

/**
 * 방문 목록 · 요약. 누구 = 같은 브라우저의 어느 방문에서든 이어진 신청 → 로그인 흔적 → 알 수 없음.
 * 신청 이름은 페이지 주인이 준다(JBN = utils/jbn.ts loadJbnApplicationNames) — 이 파일은 신청 표를 모른다.
 */
export async function loadPublicVisits(
  page: PublicVisitPage,
  days: number,
  applicationNames: (ids: string[]) => Promise<Map<string, { nickname: string; companyName: string }>>,
): Promise<PublicVisitOverview> {
  // 기간 = 한국 시간 날짜 기준(오늘 = 오늘 0시부터 · 7일 = 오늘 포함 7일) · 요약과 목록이 같은 시작점(Codex 구현 1R)
  const sum = await query(
    `WITH w AS (
       SELECT browser_key, visible_seconds FROM public_page_visits
        WHERE page = $1 AND started_at >= ${VISIT_PERIOD_START_SQL}
     )
     SELECT COUNT(*)::int AS visits,
            COUNT(DISTINCT browser_key)::int AS browsers,
            COALESCE(ROUND(AVG(visible_seconds)), 0)::int AS avg_seconds,
            (SELECT COUNT(DISTINCT p.browser_key)::int FROM public_page_visits p
              WHERE p.page = $1 AND p.application_id IS NOT NULL AND p.browser_key IN (SELECT browser_key FROM w)) AS applied_browsers
       FROM w`,
    [page, days],
  );
  const rowsRes = await query(
    `WITH w AS (
       SELECT * FROM public_page_visits
        WHERE page = $1 AND started_at >= ${VISIT_PERIOD_START_SQL}
        ORDER BY started_at DESC
        LIMIT $3
     ), b AS (
       SELECT browser_key,
              COUNT(*)::int AS visits,
              (array_agg(application_id::text ORDER BY started_at DESC) FILTER (WHERE application_id IS NOT NULL))[1] AS app_id,
              (array_agg(login_id ORDER BY started_at DESC) FILTER (WHERE login_id IS NOT NULL))[1] AS login_id,
              (array_agg(user_type ORDER BY started_at DESC) FILTER (WHERE login_id IS NOT NULL))[1] AS user_type
         FROM public_page_visits
        WHERE page = $1 AND browser_key IN (SELECT browser_key FROM w)
        GROUP BY browser_key
     )
     SELECT w.id, w.started_at, w.visible_seconds, host(w.ip_address) AS ip, w.user_agent, w.referrer_host, w.src,
            b.visits AS browser_visits, b.app_id, b.login_id, b.user_type
       FROM w JOIN b ON b.browser_key = w.browser_key
      ORDER BY w.started_at DESC`,
    [page, days, PUBLIC_VISIT_READ_LIMIT + 1],
  );
  const all = rowsRes.rows;
  const truncated = all.length > PUBLIC_VISIT_READ_LIMIT;
  const list = truncated ? all.slice(0, PUBLIC_VISIT_READ_LIMIT) : all;
  const appIds = [...new Set(list.map((x: any) => x.app_id).filter(Boolean))] as string[];
  const names = appIds.length ? await applicationNames(appIds) : new Map<string, { nickname: string; companyName: string }>();
  const s = sum.rows[0] || {};
  return {
    days,
    summary: {
      visits: Number(s.visits || 0), browsers: Number(s.browsers || 0),
      avgSeconds: Number(s.avg_seconds || 0), appliedBrowsers: Number(s.applied_browsers || 0),
    },
    rows: list.map((x: any): PublicVisitRow => {
      const agent = describeVisitorAgent(x.user_agent);
      const name = x.app_id ? names.get(x.app_id) : undefined;
      const who: VisitWho = x.app_id
        ? { kind: 'application', applicationId: x.app_id, nickname: name?.nickname ?? null, companyName: name?.companyName ?? null }
        : x.login_id ? { kind: 'login', loginId: x.login_id, userType: x.user_type ?? null } : { kind: 'unknown' };
      return {
        id: x.id, startedAt: new Date(x.started_at).toISOString(), seconds: Number(x.visible_seconds || 0),
        ip: x.ip ?? null, device: agent.device, app: agent.app, who,
        browserVisits: Number(x.browser_visits || 1), referrerHost: x.referrer_host ?? null, src: x.src ?? null,
      };
    }),
    truncated,
  };
}

// ─────────────────────────────────────────────
// 보관 기한
// ─────────────────────────────────────────────

/** 90일 지난 방문을 지운다 · 지운 수가 있으면 개인정보 파기 기록 한 줄 */
export async function purgePublicVisits(): Promise<number> {
  const r = await query(`DELETE FROM public_page_visits WHERE started_at < now() - make_interval(days => $1)`, [PUBLIC_VISIT_KEEP_DAYS]);
  const n = r.rowCount ?? 0;
  if (n > 0) await recordAuditLog({ action: 'privacy_purge', targetType: 'public_page_visits', details: { kind: 'public_page_visits', count: n } });
  return n;
}

const isSchemaMissing = (err: any): boolean => err?.code === '42P01' || err?.code === '42703';

let _retentionTimer: NodeJS.Timeout | null = null;
/** 기동 1분 뒤 + 24시간마다(표가 없으면 = DDL 전 = 조용히 넘김) */
export function startPublicVisitRetentionWorker(): void {
  if (_retentionTimer) return;
  const tick = () => {
    purgePublicVisits().catch((err) => {
      if (!isSchemaMissing(err)) console.error('[public-visits] 보관 기한 정리 실패', err?.message || err);
    });
  };
  setTimeout(tick, 60 * 1000).unref();
  _retentionTimer = setInterval(tick, 24 * 60 * 60 * 1000);
  _retentionTimer.unref();
  console.log('[public-visits] 보관 기한 워커 시작(1분 뒤 + 24시간)');
}
