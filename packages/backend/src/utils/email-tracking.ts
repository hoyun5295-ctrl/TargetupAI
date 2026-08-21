/**
 * ★ CT: Email 자체 트래킹 컨트롤타워 (2026-06-13 신설)
 *
 * 목적
 *   회사 SMTP relay 발송 메일의 오픈 픽셀 / 클릭 리다이렉트 / 개인 토큰 수신거부.
 *   외부 ESP webhook 의존 없이 자체 트래킹 — email_events 적재의 발신부.
 *
 * 토큰 형식
 *   token = base64url(payload JSON) + '.' + base64url(HMAC-SHA256(payloadB64, secret))
 *   payload = { c: campaignId, e: email, u?: 원본 URL }
 *   - 클릭 토큰은 원본 URL(u)까지 서명에 포함 → open redirect 변조 차단.
 *   - secret = EMAIL_TRACKING_SECRET || JWT_SECRET (JWT_SECRET은 부팅 시 fail-fast로 항상 존재).
 *
 * ⛔ 영구 원칙
 *   - 토큰 검증 실패 = 이벤트 기록 X (픽셀은 GIF만 응답, 클릭은 400)
 *   - 링크 래핑 제외: mailto:/tel:/# 앵커/{{변수}} 포함 href/이미 트래킹 URL
 *   - 모델명/내부 시스템명 노출 X
 */
import crypto from 'crypto';
// ★ 2026-07-02 스킴 없는 href(www.x.y) 발송 시점 치유 — 이미 저장된 캠페인 HTML도 발송 때 정상 링크+추적으로 복구
import { normalizeWebUrl } from './normalize';

export interface TrackingPayload {
  /** campaignId (uuid) */
  c: string;
  /** 수신자 email */
  e: string;
  /** 클릭 토큰 전용 — 원본 URL */
  u?: string;
}

function getTrackingSecret(): string {
  const secret = process.env.EMAIL_TRACKING_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    // JWT_SECRET 미설정 시 서버 자체가 기동 불가(auth fail-fast)라 실제 도달 불가 — 방어선만 유지
    throw new Error('EMAIL_TRACKING_SECRET / JWT_SECRET 미설정. 트래킹 토큰 생성 불가');
  }
  return secret;
}

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(payloadB64: string): string {
  return crypto.createHmac('sha256', getTrackingSecret()).update(payloadB64).digest('base64url');
}

/** 트래킹 토큰 생성 — payload 직렬화 + HMAC 서명 */
export function buildTrackingToken(payload: TrackingPayload): string {
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** 트래킹 토큰 검증 — 서명 불일치/형식 오류 시 null (timing-safe 비교) */
export function verifyTrackingToken(token: string): TrackingPayload | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(payloadB64);
  } catch {
    return null;
  }
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(payloadB64));
    if (!parsed || typeof parsed.c !== 'string' || typeof parsed.e !== 'string') return null;
    return parsed as TrackingPayload;
  } catch {
    return null;
  }
}

/** 트래킹 공개 base URL — 픽셀/클릭/수신거부 링크의 도메인 */
export function getPublicBaseUrl(): string {
  const raw = process.env.PUBLIC_BASE_URL || 'https://app.hanjul.ai';
  return raw.replace(/\/+$/, '');
}

export function buildOpenPixelUrl(campaignId: string, email: string): string {
  return `${getPublicBaseUrl()}/api/email/t/o/${buildTrackingToken({ c: campaignId, e: email })}`;
}

export function buildClickUrl(campaignId: string, email: string, url: string): string {
  return `${getPublicBaseUrl()}/api/email/t/c/${buildTrackingToken({ c: campaignId, e: email, u: url })}`;
}

export function buildUnsubscribeUrl(campaignId: string, email: string): string {
  return `${getPublicBaseUrl()}/api/email/u/${buildTrackingToken({ c: campaignId, e: email })}`;
}

/** 1x1 투명 GIF (오픈 픽셀 응답 본문) */
export const TRACKING_PIXEL_GIF: Buffer = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/** 발송 시점에 수신거부 URL로 치환되는 footer 마커 (sendEmailCampaign 전용) */
export const UNSUB_URL_MARKER = '{{__hanjul_unsub_url__}}';

/**
 * HTML 안 <a href="http(s)://..."> 링크를 클릭 트래킹 URL로 래핑.
 * 제외: mailto:/tel:/# 앵커, {{변수}} 포함 href, 이미 트래킹/수신거부 URL(이중 래핑 방지).
 * ★ 2026-07-13 디자인 3.0 — 불릿프루프 버튼의 MSO VML(<v:roundrect href>)도 동일 래핑
 *   (아웃룩 데스크탑은 VML href로 클릭 — <a>만 래핑하면 그 클라이언트 클릭이 통째 미집계, Codex 지적).
 */
export function wrapLinksForTracking(html: string, campaignId: string, email: string): string {
  if (!html) return html;
  return html.replace(
    /(<(?:a|v:roundrect)\b[^>]*?\bhref\s*=\s*")([^"]+)(")/gi,
    (whole, before: string, href: string, after: string) => {
      // ★ 2026-07-02 스킴 없는 도메인형(www.x.y)은 https:// 부착 후 래핑 — 저장된 구 캠페인 HTML도 발송 시점 치유.
      //   mailto:/tel:/#/상대경로/개인화 변수는 normalizeWebUrl이 그대로 보존하므로 아래 https 검사에서 제외됨.
      const trimmed = normalizeWebUrl(href);
      if (!/^https?:\/\//i.test(trimmed)) return whole;          // mailto:/tel:/#/상대경로 제외
      if (trimmed.includes('{{')) return whole;                   // 개인화 변수 URL 제외
      if (/\/api\/email\/(t|u)\//.test(trimmed)) return whole;    // 이미 트래킹/수신거부 URL
      if (trimmed.includes(UNSUB_URL_MARKER)) return whole;       // footer 마커
      return `${before}${buildClickUrl(campaignId, email, trimmed)}${after}`;
    },
  );
}

/** 오픈 픽셀 <img> 주입 — </body> 직전, 없으면 말미 append */
export function injectOpenPixel(html: string, campaignId: string, email: string): string {
  if (!html) return html;
  const pixelTag = `<img src="${buildOpenPixelUrl(campaignId, email)}" width="1" height="1" alt="" style="display:none;border:0;" />`;
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, `${pixelTag}</body>`);
  }
  return `${html}\n${pixelTag}`;
}

/**
 * 수신자별 트래킹 일괄 적용 — ① 수신거부 마커 → 개인 토큰 URL ② 링크 래핑 ③ 오픈 픽셀.
 * 순서 의무: 마커 치환을 래핑보다 먼저 하면 수신거부 URL이 클릭 트래킹에 이중 래핑되므로,
 * 래핑(트래킹/수신거부 URL 제외 규칙) → 마커 치환 → 픽셀 순서로 적용한다.
 */
export function applyTracking(html: string, campaignId: string, email: string): string {
  if (!html) return html;
  let out = wrapLinksForTracking(html, campaignId, email);
  out = out.split(UNSUB_URL_MARKER).join(buildUnsubscribeUrl(campaignId, email));
  return injectOpenPixel(out, campaignId, email);
}
