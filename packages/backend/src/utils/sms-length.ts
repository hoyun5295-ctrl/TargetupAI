/**
 * sms-length.ts — SMS 길이(90바이트) 판정 CT(★ 2026-11-18 C143 · 뿌리 R68 길이 축 · 설계서 docs/2026-11-18-c143-sms-length-admin-lists-design.md §2)
 *
 * 판정 한 줄 = message-byte `smsRowOverLimit`(큐 줄) · 이 파일 = 그 판정을 글이 생기는 자리에서 쓰는 두 가지.
 *   ① SmsTooLongError(정의 = message-byte · 적재 CT 가 무거운 조립 모듈 없이 쓴다) — 테스트 적재 CT 의 방어 · 쓰는 자리 400 의 같은 꼴.
 *   ② smsMinBytes — 고객 값을 넣기 전에 「이 글은 누구에게 보내도 이만큼은 된다」는 **증명되는 하한**.
 *      - Liquid 가 있으면 null(조건으로 고정 글이 빠질 수 있어 하한이 아니다 · 판정 생략 = 실행 판정이 맡는다).
 *      - 변수(%…%)가 하나도 없으면 = 실제 렌더와 같은 글(추천 자리 표식을 빼고 · sanitize · buildAdMessage)의 바이트.
 *        추천 상품 글은 광고 꼬리 판정 뒤에 들어가 더해질 뿐 줄지 않는다(journey-message-render 158-166).
 *      - 변수가 있으면 = 변수 · 추천 표식을 뺀 고정 글자의 바이트만(광고 머리 · 꼬리를 더하지 않는다).
 *      - 주소를 줄이는 길(여정)은 주소마다 원문 · 짧은 주소 중 짧은 쪽(shortenedLengthBounds.min) — 줄이기가 실패해 원문으로 나가도 하한.
 *        광고 꼬리는 치환 뒤 글에 무료수신거부 문구가 있으면 붙지 않아(messageUtils buildAdMessage) 변수 값이 꼬리를 없앨 수 있다
 *        → 머리 · 꼬리를 뺀 고정 글자는 어떤 값에도 줄지 않는다(Codex 설계 1R #3).
 */
import { buildAdMessage, findVarTokens } from './messageUtils';
import { sanitizeUnsendableForSms } from './message-sanitizer';
import { maskRecoSlot } from './reco-slot';
import { detectLiquidSyntax } from './liquid-templating';
import { eucKrByteLength, SMS_MAX_BYTES } from './message-byte';
import { shortenedLengthBounds } from './short-url';   // ★ C143 Codex 구현 1R #2 — 주소 줄이기 두 갈래의 짧은 쪽
export { SmsTooLongError } from './message-byte';

export interface SmsMinBytes {
  bytes: number;
  /** 변수 · 추천 자리 · 줄일 주소 없음 = 실제로 나갈 글 그대로(머리 · 꼬리 포함) */
  exact: boolean;
  /** 변수가 있어 고정 글자만 셌다(광고 머리 · 꼬리 뺌) */
  hasVars: boolean;
}

/** shortenUrls = 발송 길이 주소를 줄인다(여정) → 주소마다 원문 · 짧은 주소 중 짧은 쪽으로 센다(줄이기 성공 · 실패 어느 쪽에도 하한 · Codex 구현 1R #2) */
type SmsMinBytesInput = { template: string | null | undefined; isAd: boolean; opt080: string; sanitize: boolean; shortenUrls?: boolean };

export function smsMinBytes(input: SmsMinBytesInput): SmsMinBytes | null {
  const src = String(input.template ?? '');
  if (!src.trim()) return null;
  if (detectLiquidSyntax(src)) return null;
  const reco = maskRecoSlot(src);
  let text = reco ? reco.template.split(reco.token).join('') : src;
  const tokens = findVarTokens(text);
  // ★ 2026-11-22 C160 S1 ④ 변수 조각 + 인코딩 바이트(%XX)가 함께 든 글 = 하한을 내지 않는다(Liquid 생략과 같은 꼴) — 치환 값에 따라 인코딩 묶음이
  //   이어지거나 끊겨(`%X%EC%9D%B4%`) 길이가 값마다 달라 증명할 수 없다 · 받는 분마다의 실제 길이는 뒤 관문(큐 적재 CT · 예약 수정 큐 갈래 · 여정 실행기)이 잰다.
  if (tokens.length > 0 && /%[0-9A-Fa-f]{2}/.test(text)) return null;
  for (const t of [...tokens].reverse()) text = text.slice(0, t.start) + text.slice(t.end);
  const bounded = input.shortenUrls ? shortenedLengthBounds(text).min : text;
  const clean = input.sanitize ? sanitizeUnsendableForSms(bounded).sanitized : bounded;
  if (tokens.length > 0) return { bytes: eucKrByteLength(clean), exact: false, hasVars: true };
  return { bytes: eucKrByteLength(buildAdMessage(clean, 'SMS', input.isAd, input.opt080)), exact: !reco && bounded === text, hasVars: false };
}

/** 하한이 90 을 넘으면 고객 문장 · 아니면(판정 생략 포함) null */
export function smsMinBytesIssue(input: SmsMinBytesInput): string | null {
  const m = smsMinBytes(input);
  if (!m || m.bytes <= SMS_MAX_BYTES) return null;
  const what = m.hasVars
    ? `고객 정보를 넣기 전에도 ${m.bytes}바이트예요`
    : input.isAd ? `(광고) 표기와 무료수신거부 줄까지 ${m.bytes}바이트예요` : `${m.bytes}바이트예요`;
  return `SMS 글이 ${what}. SMS는 ${SMS_MAX_BYTES}바이트까지라 이대로는 보낼 수 없어요. 줄이거나 LMS로 바꿔 주세요.`;
}
