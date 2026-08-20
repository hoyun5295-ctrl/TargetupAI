/**
 * geo-access.ts — 국외 접근 통제 컨트롤타워 (★2026-08-19 전송자격인증 2.2)
 *
 * 인증기준이 요구하는 것
 *   "국외 IP 차단 · 화이트리스트 · VPN/프록시 통제 · 예외 승인 이력 · 모든 접근 경로(웹·관리자·API·모듈)"
 *
 * ⛔ 사람은 국가로, 기계는 등록 출발지로 판정한다
 *   `authenticate`(사람 JWT)와 SDK(`cdp_api_key`)·싱크에이전트(`api_key`)는 코드에서 이미 갈려 있다.
 *   국가 판정을 사람 로그인에만 걸면 **해외 본사를 둔 고객사의 몰 서버·사내 서버는 영향이 0**이다.
 *   기계 경로는 국가가 아니라 회사별 **등록 출발지 대역**(`access_origin_allowlist`)으로 통제하고,
 *   그 등록 행위 자체가 기준이 요구하는 "예외 승인 이력"이 된다.
 *
 * ⛔ 판정 지점은 로그인 하나다
 *   `authenticate`는 손대지 않는다 — 매 API 요청마다 판정하면 비용과 로그가 폭주하고,
 *   세션은 로그인에서 이미 걸러진다. 세션 이후 축은 접속 인계·유휴 30분·MFA가 덮는다.
 *
 * ⛔ 모르는 것을 차단으로 접지 않는다 (이 파일의 존재 이유)
 *   이 게이트는 **전 고객의 로그인을 막을 수 있다.** 대역 데이터가 비었거나, 사설 IP거나,
 *   조회가 실패하면 판정은 `unknown`이고 **통과**다. "모른다"를 차단으로 접는 순간 전 고객이 막힌다.
 *   (LESSONS_BACKEND "두 값으로 세 상태를 답하지 마라")
 *
 * ⛔ 배포만으로는 아무것도 바뀌지 않는다
 *   `GEO_BLOCK_ENFORCE_FROM` 미설정 = 미시행. 국외를 만나도 기록까지다.
 *   먼저 탐지 로그를 보고 "정상인데 걸리는 대역"을 걷어낸 뒤에 그 값을 넣는다. MFA와 같은 형태.
 */

import { query } from '../config/database';

export type OriginCountry = 'domestic' | 'foreign' | 'unknown';
export type OriginDecision = 'allow' | 'record' | 'block';

/**
 * 시행일 스위치.
 * ⚠ 미설정 = 미시행이 기본값이다. `GEO_BLOCK_ENFORCE_FROM=2026-10-01`을 넣는 순간 시행되고,
 *   되돌리려면 그 값을 지운다. 값이 날짜가 아니면 미시행이다 — 오타로 전 고객을 막지 않는다.
 */
export function isGeoBlockEnforced(now: Date = new Date()): boolean {
  const raw = String(process.env.GEO_BLOCK_ENFORCE_FROM || '').trim();
  if (!raw) return false;
  const from = new Date(raw);
  if (Number.isNaN(from.getTime())) return false;
  return now.getTime() >= from.getTime();
}

/** DDL 미적용 감지 — 호출부가 503 DB_MIGRATION_PENDING으로 돌려주기 위한 판정 */
export function isGeoSchemaMissing(err: any): boolean {
  const msg = String(err?.message || '');
  return (
    (msg.includes('column') && msg.includes('does not exist')) ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

/** Express가 주는 형태를 실제 IP 하나로 정리한다(`::ffff:1.2.3.4` 접두 포함) */
export function normalizeIp(raw: string | null | undefined): string | null {
  let ip = String(raw ?? '').trim();
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const isV4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every((o) => Number(o) <= 255);
  const isV6 = ip.includes(':') && /^[0-9a-fA-F:]+$/.test(ip);
  return isV4 || isV6 ? ip : null;
}

/** 사설·루프백·링크로컬 — 내부 호출과 프록시를 국외로 오판하지 않기 위한 사전 제외 */
export function isPrivateIp(raw: string | null | undefined): boolean {
  const ip = normalizeIp(raw);
  if (!ip) return false;
  if (ip === '::1' || ip.toLowerCase().startsWith('fe80:') || ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) return true;
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return false;
  if (p[0] === 10 || p[0] === 127) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  return false;
}

/** 대역 보유 여부 캐시 — 비어 있으면 판정 자체를 하지 않는다(매 로그인 COUNT를 피한다) */
const HAS_DATA_TTL_MS = 300_000;
let hasDataCache: { value: boolean; expires: number } | null = null;

export function invalidateGeoCache(): void {
  hasDataCache = null;
}

async function hasCidrData(): Promise<boolean> {
  if (hasDataCache && hasDataCache.expires > Date.now()) return hasDataCache.value;
  const r = await query(`SELECT COUNT(*)::int AS n FROM geo_allow_cidrs`);
  const value = Number(r.rows[0]?.n || 0) > 0;
  hasDataCache = { value, expires: Date.now() + HAS_DATA_TTL_MS };
  return value;
}

/**
 * 이 IP가 국내인가.
 * ⚠ 실패·미적재·사설 IP는 전부 `unknown`이다 — 통과시킨다.
 */
export async function classifyOrigin(ip: string | null | undefined): Promise<OriginCountry> {
  const addr = normalizeIp(ip);
  if (!addr) return 'unknown';
  if (isPrivateIp(addr)) return 'unknown';

  try {
    // 대역이 하나도 없으면 판정 근거가 없다 — 이때 foreign으로 단정하면 전 고객이 막힌다
    if (!(await hasCidrData())) return 'unknown';
    const r = await query(
      `SELECT 1 AS ok FROM geo_allow_cidrs WHERE $1::inet <<= cidr LIMIT 1`,
      [addr]
    );
    return r.rows.length > 0 ? 'domestic' : 'foreign';
  } catch (err: any) {
    console.error('[geo-access] 대역 조회 실패 — 판정을 포기하고 통과시킨다:', err?.message || err);
    return 'unknown';
  }
}

/**
 * 예외 승인 조회 — 세 값이다.
 *
 * ⛔ ★0819 Codex 정정 — 조회 실패를 `true`로 접으면 **승인 행이 없는데도 `exempted=true`로 기록**된다.
 *   감사 기록이 거짓이 되면 심사에 낼 근거가 무너진다. 실패는 `indeterminate`로 구분한다
 *   (통과는 시키되 "예외로 통과했다"고 적지 않는다).
 *
 * ⛔ scope와 대상 ID를 **함께** 건다 — 종전에는 OR로 흩어져 있어, `scope='user'` 행에 `company_id`가
 *   실려 있으면 그 회사 전원이 한 사람의 예외를 공유했다.
 */
export type ExceptionLookup = 'exempt' | 'none' | 'indeterminate';

export async function hasOriginException(params: {
  ip: string;
  userId?: string | null;
  companyId?: string | null;
  scopes?: string[];
}): Promise<ExceptionLookup> {
  const addr = normalizeIp(params.ip);
  if (!addr) return 'none';
  const scopes = params.scopes && params.scopes.length > 0 ? params.scopes : ['user', 'global'];
  try {
    const r = await query(
      `SELECT 1 AS ok
         FROM access_origin_allowlist
        WHERE is_active = true
          AND (expires_at IS NULL OR expires_at > NOW())
          AND scope = ANY($1::text[])
          AND $2::inet <<= cidr
          AND (
                (scope = 'global'      AND user_id IS NULL AND company_id IS NULL)
             OR (scope = 'user'        AND user_id    = $3::uuid)
             OR (scope IN ('company_api','company_agent') AND company_id = $4::uuid)
          )
        LIMIT 1`,
      [scopes, addr, params.userId || null, params.companyId || null]
    );
    return r.rows.length > 0 ? 'exempt' : 'none';
  } catch (err: any) {
    // 통과는 시키되 예외로 기록하지 않는다
    console.error('[geo-access] 예외 조회 실패 — 통과시키되 예외로 기록하지 않는다:', err?.message || err);
    return 'indeterminate';
  }
}

export interface OriginVerdict {
  country: OriginCountry;
  decision: OriginDecision;
  /** 예외 승인으로 통과했는가 — 감사 기록에 남긴다. 조회 실패는 여기 false다 */
  exempted: boolean;
  /** 예외 조회가 실패해 판정하지 못했는가 — 감사 기록에 구분해 남긴다 */
  exceptionUnknown: boolean;
  ip: string | null;
}

/**
 * 로그인 시 접근 출발지 판정.
 *
 * `block`은 **국외로 확정** + **예외 없음** + **시행일 이후**, 셋이 모두 참일 때만 나온다.
 * 그 밖은 전부 통과이고, 국외였다면 `record`로 흔적만 남긴다.
 */
export async function evaluateLoginOrigin(params: {
  ip: string | null | undefined;
  userId?: string | null;
  companyId?: string | null;
  now?: Date;
}): Promise<OriginVerdict> {
  const addr = normalizeIp(params.ip);
  const country = await classifyOrigin(addr);
  if (country !== 'foreign') {
    return { country, decision: 'allow', exempted: false, exceptionUnknown: false, ip: addr };
  }

  const lookup = await hasOriginException({
    ip: addr as string,
    userId: params.userId,
    companyId: params.companyId,
    scopes: ['user', 'global'],
  });
  if (lookup === 'exempt') {
    return { country, decision: 'allow', exempted: true, exceptionUnknown: false, ip: addr };
  }
  if (lookup === 'indeterminate') {
    // 판정하지 못한 것을 차단 근거로 쓰지 않는다. 다만 예외로 통과했다고 적지도 않는다
    return { country, decision: 'record', exempted: false, exceptionUnknown: true, ip: addr };
  }

  // 시행 전에는 기록까지다 — 먼저 무엇이 걸리는지 보고 대역을 다듬는다
  return {
    country,
    decision: isGeoBlockEnforced(params.now) ? 'block' : 'record',
    exempted: false,
    exceptionUnknown: false,
    ip: addr,
  };
}

/**
 * 기계 경로(SDK · 싱크에이전트) 출발지 판정.
 *
 * ⛔ 국가로 막지 않는다 — 해외에 본사를 둔 고객사의 연동 서버가 정상 업무다.
 *   회사별로 **등록된 출발지 대역**에 드는지만 본다.
 * ⛔ 시행 스위치가 사람 경로와 **다르다**(`ORIGIN_ALLOWLIST_ENFORCE_FROM`).
 *   같은 날 켜면 수집·발송이 함께 멈춘다. 등록 대역을 다 걷은 뒤에 따로 연다.
 */
export function isOriginAllowlistEnforced(now: Date = new Date()): boolean {
  const raw = String(process.env.ORIGIN_ALLOWLIST_ENFORCE_FROM || '').trim();
  if (!raw) return false;
  const from = new Date(raw);
  if (Number.isNaN(from.getTime())) return false;
  return now.getTime() >= from.getTime();
}

export async function evaluateMachineOrigin(params: {
  ip: string | null | undefined;
  companyId: string;
  scope: 'company_api' | 'company_agent';
  now?: Date;
}): Promise<{ decision: OriginDecision; registered: boolean; ip: string | null }> {
  const addr = normalizeIp(params.ip);
  // 판정할 수 없으면 통과 — 사설 IP·프록시 뒤 호출을 막지 않는다
  if (!addr || isPrivateIp(addr)) return { decision: 'allow', registered: false, ip: addr };

  const lookup = await hasOriginException({
    ip: addr,
    companyId: params.companyId,
    scopes: [params.scope, 'global'],
  });
  if (lookup === 'exempt') return { decision: 'allow', registered: true, ip: addr };
  if (lookup === 'indeterminate') return { decision: 'record', registered: false, ip: addr };

  return {
    decision: isOriginAllowlistEnforced(params.now) ? 'block' : 'record',
    registered: false,
    ip: addr,
  };
}

/**
 * 기계 경로 출발지 통제 (전송자격인증 2.2) — SDK · 싱크에이전트 공통.
 *
 * ⛔ 국가로 막지 않는다. 회사별로 **등록된 출발지 대역**에 드는지만 본다 —
 *   해외에 본사를 둔 고객사의 연동 서버가 정상 업무이기 때문이다.
 * ⛔ 시행 스위치가 사람 경로와 다르다(`ORIGIN_ALLOWLIST_ENFORCE_FROM`).
 *   미설정이면 **기록만** 한다. 사람 로그인과 같은 날 켜면 수집·발송이 함께 멈춘다.
 */
export async function guardMachineOrigin(
  req: any, res: any, companyId: string, scope: 'company_api' | 'company_agent',
): Promise<boolean> {
  try {
    const v = await evaluateMachineOrigin({ ip: req.ip, companyId, scope });
    if (v.decision === 'allow') return true;
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), NULL, $1, 'company', $2::uuid, $3, $4, $5, NOW())`,
      [
        v.decision === 'block' ? 'machine_origin_blocked' : 'machine_origin_detected',
        companyId,
        JSON.stringify({ scope, registered: v.registered }),
        req.ip, req.headers['user-agent'] || '',
      ]
    ).catch(() => {});
    if (v.decision === 'block') {
      res.status(403).json({
        error: '등록되지 않은 출발지입니다. 담당자에게 접근 출발지 등록을 요청해주세요.',
        code: 'ORIGIN_NOT_ALLOWED',
      });
      return false;
    }
    return true;
  } catch (err: any) {
    // 통제 장치 오류로 연동을 끊지 않는다
    console.error('[geo-access] 기계 경로 판정 실패 — 통과시킨다:', err?.message || err);
    return true;
  }
}

/**
 * 사람 경로 **선차단** — 인증 부작용(문자 발송·잠금·세션 폐기)이 일어나기 전에 막는다.
 *
 * ⛔ 왜 세션 게이트만으로 부족한가 (★0819 Codex 2R)
 *   비밀번호가 맞는 국외 호출자는 세션 게이트에 닿기 전에 이미 **MFA 문자를 받고**,
 *   오답 5회로 **계정을 잠그고 남의 세션을 무효화**할 수 있었다. 차단은 그 앞이어야 한다.
 *
 * ⛔ 막을 때만 기록한다 — 통과시키면 뒤의 세션 게이트가 기록하므로 여기서 적으면 두 줄이 된다.
 *
 * @returns 계속 진행해도 되면 true. false면 이미 403을 썼다.
 */
export async function guardHumanOriginEarly(
  req: any, res: any, userId: string, companyId?: string | null,
): Promise<boolean> {
  try {
    const v = await evaluateLoginOrigin({ ip: req.ip, userId, companyId: companyId ?? null });
    if (v.decision !== 'block') return true;
    await query(
      `INSERT INTO audit_logs (id, user_id, action, target_type, target_id, details, ip_address, user_agent, created_at)
       VALUES (gen_random_uuid(), $1, 'foreign_access_blocked', 'user', $1, $2, $3, $4, NOW())`,
      [userId, JSON.stringify({ stage: 'pre_auth_effect' }), req.ip, req.headers['user-agent'] || '']
    ).catch(() => {});
    res.status(403).json({
      error: '국내에서만 접속할 수 있습니다. 해외에서 사용해야 한다면 담당자에게 예외 등록을 요청해주세요.',
    });
    return false;
  } catch (err: any) {
    console.error('[geo-access] 선차단 판정 실패 — 통과시킨다:', err?.message || err);
    return true;
  }
}
