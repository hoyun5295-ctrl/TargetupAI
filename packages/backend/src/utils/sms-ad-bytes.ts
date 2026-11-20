/**
 * sms-ad-bytes.ts — ★ 2026-11-20 광고 SMS 합계 바이트 한 곳(설계서 docs/2026-11-20-staff-tickets-four-design.md P5 · Codex 설계 5R · 뿌리 R68 길이 축)
 *   = 실제 발송 합성 문자열(messageUtils buildAdMessage · 발송 길이 쓰는 그 함수 · 부르기만)의 문자 길이(message-byte eucKrByteLength).
 *   옛: 생성기가 「본문 + 6 + 1 + 8 + 번호 자리(없으면 10)」 손 계산 · 화면이 다른 꼴로 따로 셈 → 같은 글의 길이를 자리마다 다르게 셌다.
 *   쓰는 자리 = 문안 생성기 SMS 경고(services/ai generateMessages) · 자동마케팅 제안의 채운 뒤 다시 셈(services/ai-orchestrator).
 */
import { buildAdMessage } from './messageUtils';
import { eucKrByteLength } from './message-byte';

/** SMS 로 실제 나갈 글(광고면 (광고) · 무료거부 꼬리를 합친 글)의 바이트 */
export function smsAdTotalBytes(body: string, isAd: boolean, opt080Number: string | null | undefined): number {
  const text = String(body ?? '');
  return eucKrByteLength(isAd ? buildAdMessage(text, 'SMS', true, String(opt080Number ?? '')) : text);
}
