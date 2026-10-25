/**
 * ★ 2026-10-25 원장 #66 — DM 알림 문자의 종류 = 실제로 나갈 문장의 바이트.
 *   옛: 발송 창이 「SMS 짧게 (90바이트·저단가)」를 고르게 하고 send-to-target 은 늘 LMS 로 적재했다(고객사는 LMS 요금).
 *
 * 단문(SMS)은 셋이 모두 맞을 때만이다.
 *   ① 고객이 짧게(단문)를 골랐다(preferSms) — 고르지 않은 발송은 지금처럼 장문(제목이 보이는 발송)이다.
 *   ② 수신자마다 바뀌는 값이 이름 · DM 링크뿐이다(다른 %항목% · Liquid 는 값 길이를 여기서 모르니 장문).
 *   ③ 가장 긴 이름 · 가장 긴 링크로 조립한 문장이 90바이트 안이다 — 조립은 발송과 같은 prepareSendMessage((광고) · 080 줄 포함).
 * 하나라도 아니면 장문이다(덜 걷는 쪽으로 틀리지 않는다).
 */
import { prepareSendMessage, prepareFieldMappings, getOpt080Number } from '../messageUtils';
import { eucKrByteLength, SMS_MAX_BYTES } from '../message-byte';

const PER_RECIPIENT_TOKENS = new Set(['%이름%', '%고객명%', '%성함%', '%기타1%']);

const longest = (vals: Array<string | null | undefined>): string =>
  vals.reduce<string>((best, v) => {
    const s = String(v ?? '');
    return eucKrByteLength(s) > eucKrByteLength(best) ? s : best;
  }, '');

export async function resolveDmAlertMsgType(input: {
  preferSms: boolean;
  /** %DM링크% 를 %기타1% 로 바꾼 본문(발송에 넘기는 그대로) */
  template: string;
  names: Array<string | null | undefined>;
  links: string[];
  isAd: boolean;
  companyId: string;
  userId: string | null;
}): Promise<'SMS' | 'LMS'> {
  if (!input.preferSms) return 'LMS';
  const tokens = input.template.match(/%[^%\s]{1,30}%/g) || [];
  if (tokens.some((t) => !PER_RECIPIENT_TOKENS.has(t)) || /\{\{|\{%/.test(input.template)) return 'LMS';
  const mappings = await prepareFieldMappings(input.companyId);
  const opt080 = input.isAd ? await getOpt080Number(input.userId, input.companyId) : '';
  const { message } = prepareSendMessage(input.template, null, mappings, {
    msgType: 'SMS',
    isAd: input.isAd,
    opt080Number: opt080,
    addressBookFields: { name: longest(input.names), extra1: longest(input.links) },
    subject: '',
    skipNumberFormatting: true,
  });
  return eucKrByteLength(message) <= SMS_MAX_BYTES ? 'SMS' : 'LMS';
}
