/**
 * agency-send-link.ts — 대행발송 링크 승인 토큰 CT (★ 2026-08-25 신설 · Harold "링크 승인부터 진행")
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §16. 담당자 안내 문자에 실리는 승인 주소의
 * 토큰 서명·검증·주소 조립과 **담당자 번호 목록 판정**을 여기 한 곳이 소유한다.
 *
 * 토큰 계약 (★Codex 적대 1R 정정 반영):
 *   - 서명 키 = 전역 JWT_SECRET에서 **이 용도로 파생한 전용 키**. 같은 비밀키로 서명된 다른 JWT
 *     (로그인·OTP 등록 등)와 키 자체가 달라, scope 검사 이전에 서명부터 갈린다.
 *   - 검증은 HS256 하나로 고정하고 **exp 없는 토큰은 거절**한다(무기한 토큰 차단).
 *   - payload = 접수 id + 담당자 번호 + **문안 버전(cv)**. 문안이 다듬어지면 버전이 올라 옛 링크는
 *     전부 죽고, 재승인 문자에 실린 새 링크만 산다(흘러나간 옛 링크가 새 문안의 승인권이 되지 않는다).
 *     시각만 바뀐 건 문안 버전이 그대로라 링크가 살고, 승인 자체는 화면과 같은 revision CAS를 지난다.
 *   - 만료 = 발송 시각 + 24시간과 7일 중 긴 쪽.
 *
 * ⛔ 이 토큰은 **승인 한 가지**에만 쓴다. 문안 수정·시각 변경·취소는 로그인 화면 소유.
 * ⛔ 토큰 소지 = 그 담당자 번호의 폰 소지로 간주한다(Harold 2026-08-25 수용한 위험 — 감사는
 *   승인 이력의 via·phone·ip가 진다). 국외 차단은 걸지 않는다(담당자 해외 출장 승인 허용).
 * ⛔ API 호출에 토큰을 URL로 싣지 않는다(요청 로그에 남는다) — 운반은 헤더(X-Agency-Approve-Token).
 *   랜딩 주소도 fragment(#t=)뿐이다(★0830 확정 · query ?t=는 JS 전에 접근 로그로 전송돼 페이지도 안 받는다).
 */
import jwt from 'jsonwebtoken';
import { query } from '../config/database';
import { normalizePhone } from './normalize-phone';
import { createShortUrl } from './short-url';

// ⛔ 폴백 키 금지(★2026-08-30 보안 보강 B3) — 저장소에 공개된 문자열로 서명하면 소스를 본 사람이
//   승인권을 위조한다. 미설정 = 서명 throw(발급 중단) · 검증 null(전부 404) = fail-closed.
//   auth.ts는 기동 자체를 차단하지만, 그 모듈을 안 지나는 별도 프로세스(워커·스크립트)가
//   이 CT만 import하는 경우를 여기서 막는다. 지연 판정이라 테스트는 호출 전 env 주입으로 충분하다.
if (!process.env.JWT_SECRET) {
  console.error('[agency-send-link] JWT_SECRET 미설정 — 대행발송 승인 링크 발급·검증이 전면 잠깁니다.');
}
function jwtKey(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET 미설정: 승인 토큰을 서명·검증할 수 없습니다.');
  return `agency-approve:${s}`;
}
const SCOPE = 'agency_approve';
const MIN_TTL_SECONDS = 7 * 24 * 3600;      // 최소 7일
const AFTER_SEND_MARGIN_SECONDS = 24 * 3600; // 발송 시각 + 24시간까지

export const AGENCY_APPROVE_TOKEN_HEADER = 'x-agency-approve-token';

export interface AgencyApproveTokenPayload {
  requestId: string;
  phone: string;
  /** 발급 시점의 문안 버전. 현재 행과 다르면 그 링크는 죽은 것이다 */
  contentVersion: number;
}

/** 만료 초 계산 = 발송 시각 + 24시간과 7일 중 긴 쪽. 토큰과 단축 URL이 **같은 값**을 쓴다 */
export function agencyApproveTtlSeconds(requestedAt: Date, now: Date = new Date()): number {
  const untilSend = Math.ceil((requestedAt.getTime() - now.getTime()) / 1000) + AFTER_SEND_MARGIN_SECONDS;
  return Math.max(MIN_TTL_SECONDS, untilSend);
}

/** 만료 = 발송 시각 + 24시간과 7일 중 긴 쪽. 발송이 먼 접수도 링크가 먼저 죽지 않는다 */
export function signAgencyApproveToken(p: {
  requestId: string; phone: string; contentVersion: number; requestedAt: Date; now?: Date;
}): string {
  const now = p.now ?? new Date();
  const expiresIn = agencyApproveTtlSeconds(p.requestedAt, now);
  return jwt.sign(
    { scope: SCOPE, r: p.requestId, p: p.phone, cv: Number(p.contentVersion) },
    jwtKey(),
    { algorithm: 'HS256', expiresIn },
  );
}

export function verifyAgencyApproveToken(token: string): AgencyApproveTokenPayload | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, jwtKey(), { algorithms: ['HS256'] }) as any;
    if (!decoded || decoded.scope !== SCOPE || !decoded.r || !decoded.p) return null;
    if (!Number.isFinite(Number(decoded.exp)) || !Number.isFinite(Number(decoded.cv))) return null;
    return { requestId: String(decoded.r), phone: String(decoded.p), contentVersion: Number(decoded.cv) };
  } catch {
    return null;
  }
}

/**
 * 담당자 문자에 싣는 승인 주소. 도메인 규약 = HANJUL_BASE_URL 폴백(dm.ts·billing.ts와 동일).
 * ⛔ 토큰은 **fragment(#t=)** 에 싣는다(★Codex 적대 2R) — fragment는 브라우저가 서버로 보내지
 *   않아 정적 서버·프록시 접근 로그와 Referer 어디에도 남지 않는다. 남는 곳은 그 폰의 브라우저
 *   기록뿐이고, 그것은 "폰 소지 = 권한" 전제 안이다.
 */
export function buildAgencyApproveUrl(
  requestId: string, phone: string, contentVersion: number, requestedAt: Date, now?: Date,
): string {
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  const token = signAgencyApproveToken({ requestId, phone, contentVersion, requestedAt, now });
  return `${base}/agency-approve#t=${encodeURIComponent(token)}`;
}

/**
 * 담당자 문자용 **단축** 승인 주소 (★2026-08-26(4) Harold "링크가 너무 길다 · 단축 URL로").
 * 기존 단축 CT(CT-40 · message_short_urls)를 그대로 쓴다. 리다이렉트는 저장된 full_url의
 * #fragment까지 Location에 실려 그대로 옮겨진다(fragment는 서버로 전송되지 않는 성질 유지).
 *
 * ⛔ 단축 URL 만료 = **토큰 만료와 같은 값**(agencyApproveTtlSeconds) — 토큰이 죽은 뒤에도
 *   리다이렉트만 살아 있는 반쪽 링크를 만들지 않는다.
 * ⛔ 단축 실패 시 원본 주소 그대로 돌려준다(CT-40 원칙 · 승인 안내가 단축 때문에 멈추면 안 된다).
 * 보안 노트: full_url에 토큰이 저장된다 — "폰 소지 = 권한" 전제와 같은 부류이고, 만료를 토큰과
 *   맞춰 두어 저장된 토큰이 죽은 뒤의 잔존 창을 없앤다(문안 버전이 바뀌면 그 전에도 서명 검증이 죽인다).
 */
export async function buildShortAgencyApproveUrl(
  companyId: string, requestId: string, phone: string, contentVersion: number, requestedAt: Date, now?: Date,
): Promise<string> {
  const fullUrl = buildAgencyApproveUrl(requestId, phone, contentVersion, requestedAt, now);
  try {
    const base = now ?? new Date();
    const expiresAt = new Date(base.getTime() + agencyApproveTtlSeconds(requestedAt, base) * 1000);
    const { shortUrl } = await createShortUrl({ companyId, fullUrl, expiresAt });
    return shortUrl;
  } catch (err: any) {
    console.warn('[agency-send-link] 승인 링크 단축 실패(원본 주소로 발송):', err?.message);
    return fullUrl;
  }
}

/**
 * 이 접수의 담당자 번호들(정규화 완료). **판정은 이 한 벌뿐이다** — 워커(문자 발송처)와
 * 링크 승인(권한 판정)이 같은 목록을 봐야, 접수에서 뺀 번호가 발송에서도 권한에서도 같이 빠진다.
 * 규약 = 새 컬럼(manager_phones 배열) 우선, **배열이 비어 있을 때만** 옛 컬럼(manager_phone) 폴백.
 * (★Codex 적대 1R: 공개 라우트가 둘을 항상 합쳐 읽어, 배열에서 뺀 옛 번호가 계속 승인권을 가졌다.)
 */
export function agencyManagerPhones(row: any): string[] {
  const list: string[] = Array.isArray(row?.manager_phones) ? row.manager_phones : [];
  const merged = list.length > 0 ? list : [row?.manager_phone];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of merged) {
    const phone = normalizePhone(String(raw || ''));
    if (!phone || phone.length < 10 || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
}

/** 승인 계정 후보 한 행(users) — 판정에 쓰는 칸만 */
export interface LinkApproverCandidate { id: string; company_id?: string | null; user_type: string | null; mfa_phone: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ★2026-10-16 직원 회사 명단(ENV `AGENCY_STAFF_COMPANY_IDS` · 쉼표 구분 회사 id).
 * Harold 1016: 고객사에 넘기기 전 직원이 업체 접수에 자기 번호를 담당자로 넣어 승인·발송을 검증한다.
 * 그 직원 계정이 속한 회사를 여기 적는다. ⛔ 전 회사(`*`)는 받지 않는다 — 아무 회사 계정이나 남의 접수를 승인하게 된다.
 * 비면 직원 승인 없음(축 0 그대로).
 */
export function agencyStaffCompanyIds(env: string | undefined = process.env.AGENCY_STAFF_COMPANY_IDS): string[] {
  // 소문자로 맞춘다(★Codex 3R) — PG 는 uuid 를 소문자로 돌려주므로 대문자 ENV 면 직원 비교가 어긋난다
  return String(env || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => UUID_RE.test(s));
}

/**
 * ★2026-10-16 (순수) 담당자 번호 → 링크 승인 계정(설계서 docs/2026-10-16-agency-send-mobile-control-design.md §2 축 0).
 *
 * 승인 링크는 **계정 MFA 번호와 같은 담당자 번호에만** 간다. 승인할 때 그 계정으로 발신 인증(3.5) 인증번호를 받으므로,
 * 링크를 받는 번호와 인증번호를 받는 번호가 같은 계정에 속해야 한다. 링크 열기만으로는 소지 증명이 안 된다(카톡 전달).
 *   - 접수 계정(created_by)의 MFA 번호와 같으면 접수 계정
 *   - 아니면 접수 회사 관리자(DB 어휘 `admin` · JWT 어휘 company_admin 아님 · 불변 11) 중 **정확히 하나**일 때 그 관리자
 *   - 아니면 직원 회사(`agencyStaffCompanyIds`) 계정 중 정확히 하나(여럿이면 그중 관리자 정확히 하나)일 때 그 직원
 *     (★1016 Harold · 직원 검증 · 인증번호는 직원 자기 계정 MFA 번호로 · 고객사가 본인 번호를 등록하면 위 두 줄이 먼저다)
 *   - 그 밖(일반 사용자 · 둘 이상 · 없음 · 다른 고객사 계정)은 링크 없음
 * 후보는 이미 활성 · 비시스템으로 거른 목록이다(`resolveLinkApprovers`).
 */
export function pickLinkApprovers(
  phones: string[], createdBy: string | null | undefined, users: LinkApproverCandidate[],
  scope: { companyId: string; staffCompanyIds?: string[] },
): Map<string, string> {
  const out = new Map<string, string>();
  const staff = new Set(scope.staffCompanyIds || []);
  const isAdmin = (u: LinkApproverCandidate) => String(u.user_type || '') === 'admin';
  const onlyOne = (list: LinkApproverCandidate[]) => (list.length === 1 ? list[0] : undefined);
  const byPhone = new Map<string, LinkApproverCandidate[]>();
  for (const u of users || []) {
    const p = normalizePhone(String(u?.mfa_phone || ''));
    if (!p || p.length < 10) continue;
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p)!.push(u);
  }
  for (const raw of phones || []) {
    const phone = normalizePhone(String(raw || ''));
    const owners = byPhone.get(phone) || [];
    const creator = createdBy ? owners.find((u) => String(u.id) === String(createdBy)) : undefined;
    if (creator) { out.set(phone, String(creator.id)); continue; }
    const admin = onlyOne(owners.filter((u) => isAdmin(u) && String(u.company_id) === String(scope.companyId)));
    if (admin) { out.set(phone, String(admin.id)); continue; }
    const staffOwners = owners.filter((u) => staff.has(String(u.company_id)));
    const member = onlyOne(staffOwners) || onlyOne(staffOwners.filter(isAdmin));
    if (member) out.set(phone, String(member.id));
  }
  return out;
}

/**
 * ★2026-10-16 이 접수의 링크 승인 계정(담당자 번호 → 계정 id). **발급(워커) · 링크 열기 · 승인 잠금 구간** 세 곳이
 * 이 함수 하나를 부른다 — 강등·비활성·번호 변경 뒤에도 7일 링크가 살아 있지 않게 쓰는 순간마다 다시 본다.
 * `db` 를 넘기면 그 연결(트랜잭션)에서 읽는다.
 */
export async function resolveLinkApprovers(
  row: { company_id: string; created_by?: string | null; manager_phones?: any; manager_phone?: any },
  db: { query: (text: string, params?: any[]) => Promise<any> } = { query },
): Promise<Map<string, string>> {
  const phones = agencyManagerPhones(row);
  if (phones.length === 0 || !row?.company_id) return new Map();
  const staffCompanyIds = agencyStaffCompanyIds();
  const r = await db.query(
    `SELECT id, company_id, user_type, mfa_phone FROM users
      WHERE is_active = true AND COALESCE(is_system, false) = false AND mfa_phone IS NOT NULL
        AND ((company_id = $1::uuid AND (id = $2::uuid OR user_type = 'admin')) OR company_id = ANY($3::uuid[]))`,
    [row.company_id, row.created_by || null, staffCompanyIds],
  );
  return pickLinkApprovers(phones, row.created_by || null, r.rows as LinkApproverCandidate[], {
    companyId: String(row.company_id), staffCompanyIds,
  });
}
