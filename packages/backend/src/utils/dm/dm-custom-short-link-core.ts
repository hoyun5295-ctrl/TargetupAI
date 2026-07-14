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

// ════════════════════════════════════════════════════════════
// ★ 2026-07-15 한글 주소(사용자 지정 slug) — Harold 확정 (이새 vo.la/반짝이새_07 사례)
//   발행 DM 별칭(hlj.kr/반짝이새_07) 용도. 검증 규칙의 단일 진실 — 순수 함수(vitest 대상).
// ════════════════════════════════════════════════════════════

/** slug 길이 (문자 수 기준 — DB code varchar(20)와 동기) */
export const CUSTOM_SLUG_MIN = 2;
export const CUSTOM_SLUG_MAX = 20;

/** 허용 문자 = 한글(가-힣)·영문·숫자·하이픈·언더스코어 */
const SLUG_PATTERN = /^[0-9A-Za-z가-힣_-]+$/;

/** 내부 경로/프리픽스 예약어 — 뷰어·API 경로와 혼동 차단 */
const SLUG_RESERVED = new Set(['s', 'api', 'dm', 'admin', 'app', 'www', 'images', 'track']);

export interface SlugValidation {
  ok: boolean;
  /** 검증 통과 시 NFC 정규화된 slug */
  slug?: string;
  reason?: string;
}

/**
 * 한글 주소 slug 검증 — 실패 사유는 사용자 노출 문구.
 * NFC 정규화(iOS 자소 분리 대비)를 여기서 강제 — 쓰기/조회 양쪽이 이 함수 결과만 사용.
 */
export function validateCustomSlug(raw: unknown): SlugValidation {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: '주소로 쓸 문구를 입력해주세요. (예: 반짝세일_07)' };
  }
  const slug = raw.trim().normalize('NFC');
  if (/\s/.test(slug)) {
    return { ok: false, reason: '주소에 공백을 넣을 수 없습니다. 하이픈(-)이나 언더스코어(_)를 사용해주세요.' };
  }
  if (slug.length < CUSTOM_SLUG_MIN || slug.length > CUSTOM_SLUG_MAX) {
    return { ok: false, reason: `주소는 ${CUSTOM_SLUG_MIN}~${CUSTOM_SLUG_MAX}자로 입력해주세요.` };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return { ok: false, reason: '한글·영문·숫자·하이픈(-)·언더스코어(_)만 사용할 수 있습니다.' };
  }
  if (SLUG_RESERVED.has(slug.toLowerCase()) || /^dm-/i.test(slug)) {
    return { ok: false, reason: '사용할 수 없는 주소입니다. 다른 문구를 입력해주세요.' };
  }
  return { ok: true, slug };
}
