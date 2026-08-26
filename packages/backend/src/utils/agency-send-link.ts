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
 *   문자 속 랜딩 주소의 ?t= 는 유지한다(문자는 주소 하나만 실을 수 있고, 그 주소는 앱 로그를 지나지 않는다).
 */
import jwt from 'jsonwebtoken';
import { normalizePhone } from './normalize-phone';
import { createShortUrl } from './short-url';

// 전역 비밀키에서 파생한 승인 전용 키. 전역 키 미설정(폴백) 문제 자체는 전 인증 공통의 별건이다(BUGS 등재).
const RAW_SECRET = process.env.JWT_SECRET || 'targetup-jwt-secret-fallback';
if (!process.env.JWT_SECRET) {
  console.warn('[agency-send-link] JWT_SECRET 미설정 — 폴백 키로 동작 중입니다. 운영에서는 반드시 설정해야 합니다.');
}
const JWT_KEY = `agency-approve:${RAW_SECRET}`;
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
    JWT_KEY,
    { algorithm: 'HS256', expiresIn },
  );
}

export function verifyAgencyApproveToken(token: string): AgencyApproveTokenPayload | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_KEY, { algorithms: ['HS256'] }) as any;
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
