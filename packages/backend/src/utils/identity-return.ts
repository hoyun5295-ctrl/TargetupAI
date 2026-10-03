/**
 * identity-return.ts — 본인확인 인증 창의 복귀 통로 (★2026-10-03 전송자격인증 · 한국모바일인증 연동 준비)
 *
 * 무엇을 하나
 *   본인확인기관의 인증 창은 팝업에서 열리고, 인증이 끝나면 **우리가 인증기관에 등록해 둔 주소**로 결과를 싣고 돌아온다.
 *   이 파일은 그 돌아오는 자리다. 결과를 열어 보지 않고, 인증을 시작한 화면(부모 창)에 **받은 그대로** 넘기고 창을 닫는다.
 *   부모 창은 그 값을 `/auth/identity/complete`(또는 `/auth/identity/change/complete`)로 보내고,
 *   진짜인지 확인하는 것은 서버의 인증기관 구현(`IdentityProvider.verify`)이다.
 *
 * ⛔ 이 통로는 아무것도 믿지 않는다
 *   누구나 이 주소로 아무 값이나 보낼 수 있다. 그래서 여기서는 DB를 건드리지 않고 세션도 만들지 않는다.
 *   위조된 결과 · **남의 인증 결과를 가져다 붙이는 것**을 막는 자리는 `IdentityProvider.verify` 하나다 —
 *   verify는 결과가 **이 `verificationId`의 요청에서 나온 것**인지까지 확인해야 한다(`identity-verify.ts`의 계약).
 *
 * ⛔ 받은 값을 화면에 그대로 찍지 않는다
 *   값은 스크립트 안의 JSON으로만 싣고, `<` · `>` · `&` · 줄 구분 문자를 유니코드 표기로 바꿔 스크립트 밖으로 못 나오게 한다.
 *   응답에는 이 스크립트 한 개만 실행을 허용하는 정책(nonce)을 건다.
 *
 * ⛔ 넘기는 대상은 **같은 출처의 부모 창**뿐이다(`'*'` 금지). 다른 사이트가 이 창을 열었으면 아무것도 전달되지 않는다.
 *
 * 인증기관 구현(buildStart)이 지켜야 할 것
 *   - 화면이 팝업으로 열 수 있게 `buildPopupFormStart`로 만든 값을 돌려준다(주소는 https).
 *   - 인증기관에 등록하는 결과 수신 주소 = `<서비스 주소>` + `IDENTITY_RETURN_PATH`.
 *
 * ⚠ 이 라우트는 app.ts 에서 helmet **앞**에 건다 — helmet 의 창 격리 정책(COOP)이 붙으면 부모 창과의 연결이 끊겨
 *   결과를 넘길 수 없다(SNS 승인 복귀 창과 같은 이유).
 */
import crypto from 'crypto';

/** 인증기관에 등록하는 결과 수신 경로(이 서버) */
export const IDENTITY_RETURN_PATH = '/api/auth/identity/return';
/** 복귀 창이 부모 창에 보내는 메시지 종류 — 화면(`frontend/src/utils/identityProvider.ts`)이 이 값으로 고른다 */
export const IDENTITY_RETURN_MESSAGE_TYPE = 'hanjullo:identity';

const MAX_FIELDS = 40;
const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 16_384;
const KEY_PATTERN = /^[A-Za-z0-9_.\-]+$/;

/**
 * 돌아온 요청에서 넘길 값을 고른다 — 문자열만, 이름이 평범한 것만, 길이 제한 안의 것만.
 * 본문(POST)이 주소 뒤 값(GET)보다 우선한다. 넘치거나 이상한 값은 버린다(오류로 만들지 않는다 —
 * 부족하면 인증기관 확인에서 어차피 거절된다).
 */
export function collectIdentityReturnFields(query: unknown, body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const source of [body, query]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (count >= MAX_FIELDS) return out;
      if (typeof value !== 'string') continue;
      if (!key || key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) continue;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (value.length > MAX_VALUE_LENGTH) continue;
      if (Object.prototype.hasOwnProperty.call(out, key)) continue;
      out[key] = value;
      count += 1;
    }
  }
  return out;
}

// 스크립트 안에서 줄바꿈으로 읽히는 두 글자(U+2028 · U+2029) — 소스에 글자 그대로 적으면 눈에 보이지 않으므로 코드 값으로 만든다
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), 'g');
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), 'g');

/** 스크립트 안에 넣어도 스크립트 밖으로 못 나오는 JSON */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LINE_SEPARATOR, '\\u2028')
    .replace(PARAGRAPH_SEPARATOR, '\\u2029');
}

/** 복귀 응답 한 건 — 본문과, 그 본문의 스크립트만 허용하는 정책 */
export interface IdentityReturnPage {
  html: string;
  contentSecurityPolicy: string;
}

/**
 * 복귀 창의 화면. 받은 값을 부모 창에 넘기고 닫는다.
 * 부모 창이 없으면(창을 직접 열었거나 연결이 끊겼으면) 다시 시도하라는 안내만 남긴다.
 */
export function renderIdentityReturnPage(fields: Record<string, string>): IdentityReturnPage {
  const nonce = crypto.randomBytes(16).toString('base64');
  const payload = scriptSafeJson({ type: IDENTITY_RETURN_MESSAGE_TYPE, fields });
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>한줄로 · 본인인증</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 56px 20px; }
  .card { max-width: 420px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 36px 32px; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06); text-align: center; }
  h1 { font-size: 19px; margin: 0 0 10px; color: #0f172a; }
  p { color: #475569; font-size: 14px; line-height: 1.65; margin: 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>본인인증 결과를 전달하고 있습니다</h1>
    <p id="msg">잠시만 기다려 주세요. 이 창은 자동으로 닫힙니다.</p>
  </div>
<script nonce="${nonce}">
  (function () {
    var delivered = false;
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(${payload}, window.location.origin);
        delivered = true;
      }
    } catch (e) {}
    if (delivered) {
      setTimeout(function () { window.close(); }, 400);
    } else {
      document.getElementById('msg').textContent = '인증을 시작한 화면을 찾지 못했습니다. 이 창을 닫고 한줄로 화면에서 다시 시도해 주세요.';
    }
  })();
</script>
</body>
</html>`;
  return {
    html,
    contentSecurityPolicy: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  };
}

/** 화면이 팝업에서 여는 인증 요청 — 인증기관 구현의 `buildStart`가 돌려주는 모양 */
export interface IdentityPopupFormStart {
  mode: 'popup_form';
  /** 인증기관의 요청 주소(https) */
  action: string;
  /** 그 주소로 보낼 값(전부 문자열) */
  fields: Record<string, string>;
  /** 인증기관이 요구하는 글자 인코딩(있으면) — 예: 'euc-kr' */
  charset?: string;
}

/**
 * 팝업 인증 요청을 만든다. 주소가 https 가 아니면 던진다 — 인증 요청이 평문으로 나가는 설정 실수를 여기서 막는다.
 */
export function buildPopupFormStart(
  action: string,
  fields: Record<string, string>,
  options: { charset?: string } = {}
): IdentityPopupFormStart {
  let url: URL;
  try {
    url = new URL(action);
  } catch {
    throw new Error('IDENTITY_START_INVALID_ACTION');
  }
  if (url.protocol !== 'https:') throw new Error('IDENTITY_START_INSECURE_ACTION');
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (typeof value !== 'string') throw new Error('IDENTITY_START_NON_STRING_FIELD');
    clean[key] = value;
  }
  const start: IdentityPopupFormStart = { mode: 'popup_form', action: url.toString(), fields: clean };
  if (options.charset) start.charset = options.charset;
  return start;
}
