/**
 * ★ CT: 지정 계정 감시 알림 (★2026-10-07 Harold 「의심은 해야지」 · 설계 승인)
 *
 * 경위: 기능 소개 링크가 바깥에 돌았고, 감시 대상 계정은 로그인 인증번호를 남에게 불러 주면 그 사람이 통째로 들어올 수 있다.
 *   그때 남는 흔적은 「처음 보는 곳의 IP」와 「두 곳 동시 접속」뿐이다 → 그 두 순간에 대표에게 문자를 보낸다.
 *   외근 시연 · 집 테스트는 정상이라 막지 않는다. 대신 IP 주인(통신사 · 회선을 받은 회사)과 그 IP 를 몇 번째 보는지를 실어
 *   한눈에 「늘 쓰는 곳 / 낯선 곳」을 가르게 한다.
 *
 * 대상 = WATCH_LOGIN_IDS(기본 'psy5868') · 사무실 = WATCH_OFFICE_IPS(기본 '180.226.236.94') · 받는 번호 = 대표 번호만(watchAlertPhones).
 * 알림 ① 사무실 밖 IP 로그인(같은 IP 는 하루 1번) ② 두 곳 동시 접속(인계 · 충돌 · 양쪽 IP).
 * 기록 = audit_logs `watch_alert`(새 칸 · 새 표 0). 화면 = 슈퍼관리자 「감시 기록」(WATCH_VIEWER_IDS 기본 ceo).
 * ⛔ 로그인을 절대 막지 않는다 — 모든 실패는 여기서 삼킨다(본인은 감시 대상인지 알 수 없다).
 */
import net from 'net';
import { query } from '../config/database';
import { sendSystemAlert } from './system-alert';
import { recordAuditLog } from './audit-log';

export const WATCH_ALERT_ACTION = 'watch_alert';
const WHOIS_TIMEOUT_MS = 4000;
const OWNER_CACHE_MS = 24 * 3600 * 1000;

const list = (raw: string | undefined, fallback: string) =>
  String(raw ?? fallback).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export function isWatchedLoginId(loginId: string | null | undefined): boolean {
  if (!loginId) return false;
  return list(process.env.WATCH_LOGIN_IDS, 'psy5868').includes(String(loginId).trim().toLowerCase());
}

export function normalizeIp(raw: unknown): string {
  return String(raw || '').replace(/^::ffff:/, '').trim();
}

/**
 * 감시 알림 받는 번호 = 대표 번호 하나뿐(★2026-10-07 Harold 「오직 내 번호로만 · 서팀장까지 나가면 안 된다」).
 * ⛔ SYSTEM_ALERT_PHONES(운영자 공용)로 절대 넘어가지 않는다 — sendSystemAlert 에 phones 를 언제나 명시해서 넘긴다.
 */
export function watchAlertPhones(): string[] {
  return String(process.env.WATCH_ALERT_PHONES ?? '01052958517').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);
}

export function isOfficeIp(ip: string): boolean {
  return list(process.env.WATCH_OFFICE_IPS, '180.226.236.94').includes(normalizeIp(ip));
}

/** 업무 시간(평일 09~19시 · KST) 밖이면 true — 공휴일은 모른다(평일로 본다) */
export function isOffHours(at: Date = new Date()): boolean {
  const kst = new Date(at.getTime() + 9 * 3600 * 1000);
  const day = kst.getUTCDay();
  const h = kst.getUTCHours();
  return day === 0 || day === 6 || h < 9 || h >= 19;
}

export function kstText(at: Date = new Date()): string {
  const k = new Date(at.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

/**
 * KISA 조회 응답에서 「누구에게 할당된 IP 인가」만 뽑는다 — 마지막(가장 좁은) 할당 블록의 기관명 · 구분 · 주소.
 * 통신사가 회사에 따로 내준 회선이면 그 회사 이름이 나온다(예: (주)한화63시티 · (주)플랜티넷).
 */
export function parseKisaWhois(text: string): { org: string; kind: string; address: string } | null {
  const blocks: Array<Record<string, string>> = [];
  let cur: Record<string, string> = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^(IPv4주소|기관명|네트워크 구분|주소)\s*:\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'IPv4주소' && Object.keys(cur).length > 0) { blocks.push(cur); cur = {}; }
    if (!(m[1] in cur)) cur[m[1]] = m[2].trim();
  }
  if (Object.keys(cur).length > 0) blocks.push(cur);
  const last = blocks.filter((b) => b['기관명']).pop();
  if (!last) return null;
  return { org: last['기관명'] || '', kind: last['네트워크 구분'] || '', address: last['주소'] || '' };
}

/**
 * ★ 2026-10-07 통신사 본사 주소는 위치가 아니다(Harold 실측: 거여동 집 회선이 「용산구 한강대로 32」 = LG U+ 본사로 나옴).
 *   통신사가 고객 위치를 따로 신고하지 않은 회선은 본사 주소가 찍힌다 → 「위치 모름」으로 그린다.
 */
const CARRIER_HQ_ADDRESS = ['불정로 90', '정자동 KT본사', '한강대로 32', '을지로 65', '을지로65', '퇴계로 24'];

export function formatIpOwner(p: { org: string; kind: string; address: string }): string {
  const compact = p.address.replace(/\s+/g, ' ');
  const hq = CARRIER_HQ_ADDRESS.some((a) => compact.includes(a));
  if (p.kind === 'INFRA') return `${p.org} · 휴대폰 등 통신사 공용 · 위치 모름`;
  if (hq) return `${p.org} · 통신사 본사 주소만 등록 · 위치 모름`;
  return `${p.org} · 회선 등록 주소 ${p.address}`;
}

const ownerCache = new Map<string, { at: number; text: string }>();

/** IP 주인 한 줄(예: 「LG유플러스 · 기업 회선 · 경기도 안양시 만안구 덕천로 37」) — 실패하면 「주인 조회 실패」 */
export async function describeIpOwner(ip: string): Promise<string> {
  const key = normalizeIp(ip);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(key)) return key ? '주인 조회 안 함(IPv4 아님)' : '알 수 없음';
  const hit = ownerCache.get(key);
  if (hit && Date.now() - hit.at < OWNER_CACHE_MS) return hit.text;
  const text = await new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    const sock = net.createConnection({ host: 'whois.kisa.or.kr', port: 43 });
    const done = (v: string) => { sock.destroy(); resolve(v); };
    sock.setTimeout(WHOIS_TIMEOUT_MS, () => done(''));
    sock.on('connect', () => sock.write(`${key}\r\n`));
    sock.on('data', (c) => chunks.push(c));
    sock.on('error', () => done(''));
    sock.on('end', () => {
      const buf = Buffer.concat(chunks);
      let s = '';
      try { s = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {
        try { s = new TextDecoder('euc-kr').decode(buf); } catch { s = buf.toString('latin1'); }
      }
      done(s);
    });
  });
  const parsed = parseKisaWhois(text);
  const out = parsed ? formatIpOwner(parsed) : '주인 조회 실패';
  if (parsed) ownerCache.set(key, { at: Date.now(), text: out });
  return out;
}

/** 이 계정이 이 IP 로 로그인한 횟수(이번 포함) · 직전 로그인 시각 */
async function ipHistory(userId: string, ip: string): Promise<{ count: number; prevAt: Date | null }> {
  const r = await query(
    `SELECT COUNT(*)::int AS n,
            (SELECT created_at FROM audit_logs WHERE user_id = $1 AND action = 'login_success' AND host(ip_address) = $2
              ORDER BY created_at DESC OFFSET 1 LIMIT 1) AS prev_at
       FROM audit_logs WHERE user_id = $1 AND action = 'login_success' AND host(ip_address) = $2`,
    [userId, ip],
  );
  return { count: Number(r.rows[0]?.n) || 0, prevAt: r.rows[0]?.prev_at ? new Date(r.rows[0].prev_at) : null };
}

export const WATCH_PAGE_SIZE = 20;

export interface WatchIpRow {
  loginId: string;
  ip: string;
  owner: string;
  office: boolean;
  logins: number;
  firstAt: string;
  lastAt: string;
  /** 이 IP 가 낀 동시 접속(인계 · 충돌) 횟수 */
  concurrent: number;
  offHoursLogins: number;
}

/** 감시 기록 — 감시 대상 계정이 쓴 IP 목록(최근 순 · 20건씩) · 주인은 그 쪽에 나온 IP 만 조회 */
export async function loadWatchIps(page: number): Promise<{ watched: string[]; total: number; page: number; rows: WatchIpRow[] }> {
  const watched = list(process.env.WATCH_LOGIN_IDS, 'psy5868');
  const p = Math.max(1, Math.min(10000, Math.floor(page) || 1));
  const base = `FROM audit_logs al
     WHERE al.action IN ('login_success', 'login_takeover', 'login_session_conflict')
       AND LOWER(al.details->>'loginId') = ANY($1::text[]) AND al.ip_address IS NOT NULL`;
  const [rows, count] = await Promise.all([
    query(
      `SELECT LOWER(al.details->>'loginId') AS login_id, host(al.ip_address) AS ip,
              COUNT(*) FILTER (WHERE al.action = 'login_success')::int AS logins,
              COUNT(*) FILTER (WHERE al.action <> 'login_success')::int AS concurrent,
              COUNT(*) FILTER (WHERE al.action = 'login_success' AND (
                EXTRACT(ISODOW FROM al.created_at AT TIME ZONE 'Asia/Seoul') >= 6
                OR EXTRACT(HOUR FROM al.created_at AT TIME ZONE 'Asia/Seoul') NOT BETWEEN 9 AND 18))::int AS off_hours,
              MIN(al.created_at) AS first_at, MAX(al.created_at) AS last_at
         ${base}
        GROUP BY 1, 2 ORDER BY MAX(al.created_at) DESC
        LIMIT $2 OFFSET $3`,
      [watched, WATCH_PAGE_SIZE, (p - 1) * WATCH_PAGE_SIZE],
    ),
    query(`SELECT COUNT(*)::int AS n FROM (SELECT 1 ${base} GROUP BY LOWER(al.details->>'loginId'), host(al.ip_address)) t`, [watched]),
  ]);
  const owners = await Promise.all(rows.rows.map((r: any) => describeIpOwner(String(r.ip))));
  return {
    watched,
    total: Number(count.rows[0]?.n) || 0,
    page: p,
    rows: rows.rows.map((r: any, i: number) => ({
      loginId: String(r.login_id), ip: String(r.ip), owner: owners[i], office: isOfficeIp(String(r.ip)),
      logins: Number(r.logins) || 0, concurrent: Number(r.concurrent) || 0, offHoursLogins: Number(r.off_hours) || 0,
      firstAt: new Date(r.first_at).toISOString(), lastAt: new Date(r.last_at).toISOString(),
    })),
  };
}

/** 한 IP 에서 감시 대상이 한 일(최근 100건 · 로그인 · 동시 접속 · 연 화면) */
export async function loadWatchIpEvents(loginId: string, ip: string): Promise<Array<{ at: string; action: string; path: string; otherIp: string }>> {
  if (!isWatchedLoginId(loginId)) return [];
  const r = await query(
    `SELECT al.created_at, al.action, COALESCE(al.details->>'path', '') AS path,
            COALESCE(al.details->>'takenOverIp', al.details->>'liveIp', '') AS other_ip
       FROM audit_logs al
      WHERE host(al.ip_address) = $2
        AND (LOWER(al.details->>'loginId') = $1
             OR al.user_id IN (SELECT id FROM users WHERE LOWER(login_id) = $1))
        AND al.action IN ('login_success', 'login_takeover', 'login_session_conflict', 'page_view', 'logout', 'privacy_view')
      ORDER BY al.created_at DESC LIMIT 100`,
    [String(loginId).toLowerCase(), normalizeIp(ip)],
  );
  return r.rows.map((x: any) => ({ at: new Date(x.created_at).toISOString(), action: String(x.action), path: String(x.path), otherIp: String(x.other_ip) }));
}

export type WatchEventKind = 'login' | 'takeover' | 'conflict';

export interface WatchEventInput {
  kind: WatchEventKind;
  userId: string;
  loginId: string;
  /** 이번 요청 IP */
  ip: string;
  /** 밀려난(또는 지금 쓰고 있는) 쪽 세션 IP — 동시 접속일 때만 */
  otherIp?: string | null;
  userAgent?: string;
  req?: any;
}

/**
 * 감시 대상 로그인 사건 처리 — 판정 · 문자 · 기록. 호출부는 await 하지 않는다(`void handleWatchEvent(...)`).
 * 로그인 응답을 늦추거나 막지 않는다. 모든 오류를 삼킨다.
 */
export async function handleWatchEvent(e: WatchEventInput): Promise<void> {
  try {
    if (!isWatchedLoginId(e.loginId)) return;
    const ip = normalizeIp(e.ip);
    const otherIp = normalizeIp(e.otherIp);
    const at = new Date();
    const offHours = isOffHours(at);
    const concurrent = e.kind === 'takeover' || e.kind === 'conflict';
    // ① 사무실 밖 로그인만 · ② 동시 접속은 IP 와 상관없이(같은 사무실 안 두 자리도 계정 공유다)
    if (e.kind === 'login' && isOfficeIp(ip)) return;

    const [owner, otherOwner, hist] = await Promise.all([
      describeIpOwner(ip),
      otherIp ? describeIpOwner(otherIp) : Promise.resolve(''),
      e.kind === 'login' ? ipHistory(e.userId, ip) : Promise.resolve({ count: 0, prevAt: null as Date | null }),
    ]);
    const seen = e.kind !== 'login' ? ''
      : hist.count <= 1 ? '처음 보는 IP'
      : `이 IP ${hist.count}번째 · 지난 로그인 ${hist.prevAt ? kstText(hist.prevAt) : '-'}`;

    const head = `${offHours ? '[시간 외] ' : ''}${e.loginId} `;
    const title = e.kind === 'login' ? `${head}계정이 사무실 밖에서 로그인했습니다.`
      : e.kind === 'takeover' ? `${head}계정이 두 곳에서 쓰였습니다. 새 접속이 기존 접속을 밀어냈습니다.`
      : `${head}계정이 쓰이는 중에 다른 곳에서 로그인을 시도했습니다.`;
    const details = [
      `시각: ${kstText(at)}`,
      concurrent ? `새 접속: ${ip || '-'} (${owner}${isOfficeIp(ip) ? ' · 사무실' : ''})` : `IP: ${ip || '-'}`,
      ...(concurrent ? [`기존 접속: ${otherIp || '-'} (${otherOwner || '알 수 없음'}${otherIp && isOfficeIp(otherIp) ? ' · 사무실' : ''})`] : [`주인: ${owner}`, seen]),
    ];

    const phones = watchAlertPhones();
    const day = kstText(at).slice(0, 5);
    const sent = await sendSystemAlert({
      dedupKey: concurrent ? `watch:${e.loginId}:${e.kind}:${ip}:${otherIp}` : `watch:${e.loginId}:login:${ip}:${day}`,
      title,
      details,
      action: '슈퍼관리자 「감시 기록」에서 이 IP 가 연 화면을 볼 수 있습니다.',
      cooldownMs: concurrent ? 30 * 60 * 1000 : 24 * 3600 * 1000,
      phones,
    });
    await recordAuditLog({
      actorUserId: e.userId,
      action: WATCH_ALERT_ACTION,
      targetType: 'user',
      targetId: e.userId,
      details: { kind: e.kind, loginId: e.loginId, ip, otherIp: otherIp || null, owner, otherOwner: otherOwner || null, seenCount: hist.count, offHours, smsSent: sent > 0 },
      req: e.req,
    });
  } catch (err: any) {
    console.error('[watch-alert] 처리 실패(로그인 영향 없음):', err?.message || err);
  }
}
