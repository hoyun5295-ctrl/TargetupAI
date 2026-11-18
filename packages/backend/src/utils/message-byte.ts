import { UserFacingError } from './http-error';
// EUC-KR byte 길이 — 순수 코어(DB-free). 통신 규격: ASCII 1byte, 한글 등 비-ASCII 2byte.
// SMS 발송은 EUC-KR 기준이라 길이 판정도 byte 기준. journey-ai-generator/variant-generator 인라인 중복의 통합 토대.

/** SMS(단문) 통신 규격 상한(EUC-KR 바이트). ★ 2026-09-26 한줄로 V2 R1-08 — 대행 접수 판정이 이 값을 쓴다. */
export const SMS_MAX_BYTES = 90;
/** ★ 2026-11-05 C107 — LMS 통신 규격 상한(message-analysis 안에 숨어 있던 값을 이 CT 로 · 브랜드 대체 LMS 판정이 같이 쓴다) */
export const LMS_MAX_BYTES = 2000;

/** 문자열의 EUC-KR 근사 byte 길이. ASCII(<128) 1byte, 그 외(한글/특수) 2byte. */
export function eucKrByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    bytes += ch.charCodeAt(0) < 128 ? 1 : 2;
  }
  return bytes;
}

/**
 * ★ 2026-11-18 C143(뿌리 R68 길이 축 · R47 효과 자리 · 설계서 docs/2026-11-18-c143-sms-length-admin-lists-design.md) — 판정 한 줄.
 *   큐 줄의 유형 코드(QTmsg S · L · M · F · K)가 SMS(S)이고 글이 90바이트를 넘는가. 1118 실측 = 91바이트부터 통째로 실패(잘려 가지 않음).
 *   유형 이름(SMS · LMS)을 들고 있는 쪽은 toQtmsgType 으로 바꿔 넘긴다(판정은 이 함수 하나).
 */
export function smsRowOverLimit(msgTypeCode: unknown, text: unknown): boolean {
  return String(msgTypeCode ?? '') === 'S' && eucKrByteLength(String(text ?? '')) > SMS_MAX_BYTES;
}

/** ★ C143 — 고객에게 보이는 넘침 안내(테스트 발송 · 스팸 검사 · 예약 문안 수정이 같은 말) */
export function smsTooLongText(bytes: number): string {
  return `SMS는 ${SMS_MAX_BYTES}바이트까지 보낼 수 있어요. 이 문장은 ${bytes}바이트예요. ${SMS_MAX_BYTES}바이트 안으로 줄이거나 LMS로 바꿔 주세요.`;
}

/** ★ C143 — 90바이트를 넘는 SMS(상태 400 · 코드 SMS_TOO_LONG · 고객 문장 = smsTooLongText) · 테스트 적재 CT 의 방어와 쓰는 자리 400 이 같은 꼴 */
export class SmsTooLongError extends UserFacingError {
  constructor(public readonly bytes: number) {
    super(400, 'SMS_TOO_LONG', smsTooLongText(bytes), { bytes });
    this.name = 'SmsTooLongError';
  }
}
