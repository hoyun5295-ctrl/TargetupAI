/**
 * dm-custom-short-link-core.ts — 고객사 자체 URL 단축(hlj.kr) 검증 순수 코어 (2026-07-10 박성용 신기능)
 *
 * 도메인 평판 보호 장치의 단일 진실 — 오픈 리다이렉터 악용(피싱 URL을 hlj.kr로 세탁 →
 * 통신사/브라우저 필터에 hlj.kr 오염 → 기존 DM 발송 링크 전체 도달률 훼손)을 입구에서 차단한다.
 * 순수 함수(DB import 0) — vitest 대상.
 */

/** 단축 대상 URL 상한 */
export const CUSTOM_LINK_URL_MAX = 2048;
/** 제목 상한 (DB varchar(100)) */
export const CUSTOM_LINK_TITLE_MAX = 100;
/** 회사당 일일 생성 상한 (남용 보조 안전망 — 크레딧 100/건이 1차 억제) */
export const CUSTOM_LINK_DAILY_LIMIT = 50;

/** 자기 도메인 재단축 금지 — 리다이렉트 루프·이중 단축 차단 */
const SELF_HOSTS = new Set([
  'hlj.kr',
  'hanjul.ai',
  'www.hanjul.ai',
  'app.hanjul.ai',
  'sys.hanjullo.com',
]);

/** 사설/내부 주소 세탁 차단 — 공개 웹 URL만 허용 */
function isPrivateOrLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  // IPv6 리터럴(URL hostname은 대괄호 제거된 형태) — 전부 차단
  if (h.includes(':')) return true;
  // IPv4 리터럴 — 전부 차단 (공개 IP여도 도메인 없는 대상은 세탁 위험 대비 미지원)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

export interface CustomLinkValidation {
  ok: boolean;
  /** 검증 통과 시 정규화된 URL (trim) */
  url?: string;
  reason?: string;
}

/** 단축 대상 URL 검증 — 실패 사유는 사용자 노출 문구 */
export function validateCustomShortLinkUrl(raw: unknown): CustomLinkValidation {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: '단축할 URL을 입력해주세요.' };
  }
  const url = raw.trim();
  if (url.length > CUSTOM_LINK_URL_MAX) {
    return { ok: false, reason: `URL이 너무 깁니다 (최대 ${CUSTOM_LINK_URL_MAX}자).` };
  }
  if (/\s/.test(url)) {
    return { ok: false, reason: 'URL에 공백을 포함할 수 없습니다.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: '올바른 URL 형식이 아닙니다. http:// 또는 https://로 시작하는 전체 주소를 입력해주세요.' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'http:// 또는 https:// 주소만 단축할 수 있습니다.' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: '인증 정보(@)가 포함된 URL은 단축할 수 없습니다.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (SELF_HOSTS.has(host)) {
    return { ok: false, reason: '한줄로 서비스 주소는 다시 단축할 수 없습니다.' };
  }
  if (isPrivateOrLocalHost(host)) {
    return { ok: false, reason: '내부망/IP 주소는 단축할 수 없습니다. 도메인 주소를 입력해주세요.' };
  }
  if (!host.includes('.')) {
    return { ok: false, reason: '올바른 도메인 주소가 아닙니다.' };
  }
  return { ok: true, url };
}

/** 제목 정규화 — 빈 값은 null, 초과분은 잘라냄 */
export function normalizeCustomLinkTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, CUSTOM_LINK_TITLE_MAX);
}
