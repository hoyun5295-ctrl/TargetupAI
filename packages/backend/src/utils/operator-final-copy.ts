/**
 * operator-final-copy.ts — 자동 마케팅 회차의 「나가는 문안」 한 곳(★ 2026-10-24 결함 1 · 설계서 docs/2026-10-24-automarketing-oneline-design.md §4)
 *
 * 왜 있나
 *   3사 검사 · 담당자 문자 · 승인 화면 · 발송이 문안을 각자 만들었다. 혜택은 발송 때만 치환돼, 검사한 글 · 알린 글 · 본 글 ≠ 나간 글이었다.
 *   → 순서 하나: 안 번호 → 사람 편집 → 이모지 안전화 → 혜택 치환 → 90바이트 넘으면 LMS → (광고) · 080 → 지문(회신번호 · 080 · 채널 · 제목 · 본문).
 *   지문은 URL 단축 **전** 글로 만든다(단축은 발송 직전 · 회의론자 §9-8).
 * 쓰는 곳 = 회차 3사 검사 · 시스템 재검사 · 담당자 문자 · 목록 응답 · 승인 지문 · 발송 관문 · 리마인드.
 * ⛔ 계산만 한다(DB 0). 저장하는 값은 검사 · 승인 때의 지문뿐이다.
 */
import { createHash } from 'crypto';
import { stripIncompatibleEmojis } from '../services/ai';
import { buildAdMessage, buildAdSubject } from './messageUtils';
import { applyBenefitToBody, hasUneditedBenefitPlaceholder } from './autosend-policy';
import { eucKrByteLength, SMS_MAX_BYTES } from './message-byte';
import { shortenedLengthBounds } from './short-url';   // ★ C143 — 주소 줄이기 두 갈래의 긴 쪽(SMS 고르기)
import { spamCheckPassedIndex, operatorCharsReason } from './continuous-operator-policy';
import { smsTextPlaces } from './message-sanitizer';   // ★ 2026-11-06 C109 P6 나가는 글 글자 판정

export interface OperatorFinalCopy {
  variantIndex: number;
  msgType: 'SMS' | 'LMS' | 'MMS';
  subject: string;
  /** 혜택을 넣은 본문(광고 표기 · 080 전) — 3사 검사 · 발송이 받는 글 */
  body: string;
  /** 받는 사람이 보는 모양((광고) · 무료거부까지) — 담당자 문자 · 화면 */
  sent: string;
  /** 받는 사람이 보는 제목(장문 · (광고)) — 화면 */
  sentSubject: string;
  /** 혜택 자리 · 직접 입력 안내가 남았다(보내지 않는다) */
  placeholderLeft: boolean;
  /**
   * ★ 2026-11-06 C109 P6 — 조립이 끝난 본문 · 제목(혜택 치환 뒤)의 보낼 수 없는 글자 위치(없으면 null).
   *   안 글은 이모지 안전화(글자 CT)를 지나지만 혜택 문구는 그 뒤에 들어온다 → 검사 입구가 반려할 글자는 여기서 미리 안다(승인 · 발송 관문 · 목록).
   */
  charIssue: string | null;
  fingerprint: string;
}

export interface OperatorCopyContext {
  benefit: string | null | undefined;
  opt080: string;
  /** 실제 회신번호(숫자) · 개별 회신이면 빈 글 */
  callback: string;
}

/**
 * 지문 한 함수 — 회신번호 · 080 · 채널 · 제목 · 본문(광고 표기 · 단축 전). 나가는 문안 · 검사한 문안이 같은 함수로 찍는다.
 *   ⛔ 통과 지문은 **실제로 검사한 모양**(검사 채널 · 검사 제목 · 검사 본문)으로 찍는다 — 다른 채널로 나가면 지문이 달라 관문이 멈춘다(Codex 1R).
 */
export function copyFingerprint(p: { callback: string; opt080: string; msgType: string; subject: string; body: string }): string {
  const subject = p.msgType === 'SMS' ? '' : String(p.subject || '');
  return createHash('sha256')
    .update([String(p.callback || '').replace(/\D/g, ''), String(p.opt080 || '').replace(/\D/g, ''), p.msgType, subject, String(p.body || '')].join('\n'))
    .digest('hex').slice(0, 24);
}

/** 보낼 안 번호 = 사람이 고른 안 → 스팸 검사 통과 안 → 만들 때 정한 추천 안 → 0(발송 자리 무작위 표집 0 · 결함 9) */
export function proposalSendIndex(pj: any): number {
  const msgs = Array.isArray(pj?.messages) ? pj.messages : [];
  const ok = (i: unknown): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && !!msgs[i];
  const u = pj?.userSelection?.variantIndex;
  if (ok(u)) return u;
  const passed = spamCheckPassedIndex(pj);
  if (passed != null) return passed;
  if (ok(pj?.recommendedIndex)) return pj.recommendedIndex;
  return 0;
}

/**
 * ★ 2026-11-18 C143 W4(뿌리 R68 길이 축) — 자동마케팅 단문이 넘치는가 = **나가는 글**((광고) · 무료거부 줄을 붙인 SMS 글)의 바이트가 90 을 넘는가.
 *   옛: (광고) · 무료거부 줄(약 25바이트)을 붙이기 전 본문을 재 본문 66 ~ 90바이트가 SMS 로 나가 통신사에서 통째로 실패했다(자동마케팅 = 늘 광고).
 *   판정 = 승인 창이 보여 주는 나가는 글과 같은 조립(buildAdMessage) · 회차 문안 · 리마인드가 이 함수 하나.
 */
export function operatorSmsOverflows(body: string, opt080: string): boolean {
  // ★ C143(Codex 구현 1R #2 같은 부류) — 발송은 주소를 줄여 보낸다(실패 = 원문 그대로 · continuous-operator 발송) → 두 갈래 중 긴 쪽으로 잰다
  //   = SMS 를 고르면 줄이기가 성공하든 실패하든 90 안이다(짧은 원문 주소가 더 긴 짧은 주소로 바뀌어 넘치는 갈래까지).
  return eucKrByteLength(buildAdMessage(shortenedLengthBounds(String(body ?? '')).max, 'SMS', true, opt080 || '')) > SMS_MAX_BYTES;
}

/** 이 안의 나가는 문안(없으면 null) — 사람 편집은 그 안을 고른 편집일 때만 */
export function operatorFinalCopyAt(pj: any, index: number, ctx: OperatorCopyContext): OperatorFinalCopy | null {
  const msg = Array.isArray(pj?.messages) ? pj.messages[index] : null;
  if (!msg) return null;
  const sel = pj?.userSelection && pj.userSelection.variantIndex === index ? pj.userSelection : null;
  const edited = !!sel && typeof sel.body === 'string' && sel.body.trim() !== '';
  const rawBody = edited ? String(sel.body) : String(msg.body || msg.message || '');
  const rawSubject = sel && typeof sel.subject === 'string' ? String(sel.subject) : String(msg.subject || '');
  const body = applyBenefitToBody(stripIncompatibleEmojis(rawBody), ctx.benefit);
  const subject = applyBenefitToBody(stripIncompatibleEmojis(rawSubject), ctx.benefit);
  const channel = String(pj?.channel?.recommended || 'SMS').toUpperCase();
  let msgType: 'SMS' | 'LMS' | 'MMS' = channel === 'LMS' || channel === 'MMS' ? channel : 'SMS';
  if (msgType === 'SMS' && operatorSmsOverflows(body, ctx.opt080 || '')) msgType = 'LMS';   // 잘림 방지(옛: 편집했을 때만 · 지금: 혜택이 늘린 글도 · ★ C143 = 나가는 글로)
  const sent = buildAdMessage(body, msgType, true, ctx.opt080 || '');   // 자동 마케팅 = 무조건 광고(Harold 0702)
  const fingerprint = copyFingerprint({ callback: ctx.callback, opt080: ctx.opt080, msgType, subject, body });
  return {
    variantIndex: index, msgType, subject: msgType === 'SMS' ? '' : subject, body, sent,
    sentSubject: msgType === 'SMS' || !subject ? '' : buildAdSubject(subject, msgType, true),
    placeholderLeft: hasUneditedBenefitPlaceholder(body) || hasUneditedBenefitPlaceholder(subject),
    charIssue: smsTextPlaces([{ label: '본문', text: body }, { label: '제목', text: msgType === 'SMS' ? '' : subject }]),
    fingerprint,
  };
}

/** 보낼 안의 나가는 문안 */
export function operatorFinalCopy(pj: any, ctx: OperatorCopyContext): OperatorFinalCopy | null {
  return operatorFinalCopyAt(pj, proposalSendIndex(pj), ctx);
}

/** 발송 관문(JS) — 검사 통과 지문 · 사람 승인 지문 중 하나가 지금 지문과 같아야 나간다(Q6 · 새 상태 0) */
export function finalCopyCleared(pj: any, final: OperatorFinalCopy): { ok: true } | { ok: false; reason: string } {
  // ★ 2026-11-06 C109 E5(Codex 설계 1R #2) — 나가는 글에 보낼 수 없는 글자 = 지문과 관계없이 멈춘다(옛 승인 지문 · 옛 행도)
  if (final.charIssue) return { ok: false, reason: operatorCharsReason(final.charIssue) };
  const passFp = typeof pj?.spamCheck?.fp === 'string' ? pj.spamCheck.fp : null;
  const humanFp = typeof pj?.approvedFp === 'string' ? pj.approvedFp : null;
  if (passFp === final.fingerprint || humanFp === final.fingerprint) return { ok: true };
  // 옛 행(배포 전 · 지문 없음) — 검사한 안에 혜택 자리가 없으면 치환이 바꾸는 글자가 0 이다(회의론자 §9-8 · 한 번 처리를 이 자리에서)
  if (!passFp && !humanFp) {
    const msg = Array.isArray(pj?.messages) ? pj.messages[final.variantIndex] : null;
    const raw = String(msg?.body || msg?.message || '') + '\n' + String(msg?.subject || '');
    if (!/\[혜택[^\]]*\]/.test(raw)) return { ok: true };
  }
  return { ok: false, reason: '스팸 검사를 한 뒤 혜택이나 번호가 바뀌어 이번 회차를 멈췄어요' };
}
