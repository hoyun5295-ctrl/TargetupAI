/**
 * qtmsg-type.ts — 발송 타입 → QTmsg msg_type 단일 변환 (순수 함수, DB import 0)
 *
 * 2026-06-25: 옛 sms-queue.ts inline 버전은 'SMS'/'LMS'만 명시하고 나머지를 전부 'M'(MMS)로 떨궜다.
 *   → DM 테스트발송이 단축코드 'L'을 넘기자 'M'으로 변환 → 이미지 없는 MMS → "MMS 이미지 첨부 필수" 실패.
 *   풀네임('SMS'/'LMS'/'MMS')과 단축코드('S'/'L'/'M') 둘 다 받고, 알 수 없는 값은 'M' 대신
 *   안전하게 'L'(LMS, 이미지 불필요)로 처리 — 잘못된 토큰이 다시는 이미지 필수 MMS로 둔갑하지 않게.
 *   (sms-queue.ts가 이 함수를 import + 재export 하므로 기존 `from './sms-queue'` 호출부는 그대로 동작.)
 */
export function toQtmsgType(msgType: string): string {
  const t = String(msgType ?? '').trim().toUpperCase();
  if (t === 'SMS' || t === 'S') return 'S';
  if (t === 'LMS' || t === 'L') return 'L';
  if (t === 'MMS' || t === 'M') return 'M';
  return 'L'; // 알 수 없는 값 = 이미지 불필요한 LMS로 안전 처리 (옛 'M' 기본이 본 사고 원인)
}

/**
 * 문자 제목은 LMS·MMS 에만 싣는다. 단문(msg_type 'S')이면 빈 값.
 * 2026-09-22 접수: 직접발송 화면이 LMS 에서 SMS 로 바꿔도 제목 값이 남아 넘어와 SMS 행 title_str 에 실렸다
 * (hanjul02 SMS 142,457건 중 7,974건). 판정은 toQtmsgType 과 같은 축 — 행의 msg_type 과 갈라지지 않는다.
 * 모르는 유형은 toQtmsgType 이 'L' 로 보내므로 제목을 그대로 둔다(지우면 제목 없는 LMS 가 된다).
 */
export function subjectForMsgType(msgType: string, subject: string | null | undefined): string {
  return toQtmsgType(msgType) === 'S' ? '' : (subject || '');
}
