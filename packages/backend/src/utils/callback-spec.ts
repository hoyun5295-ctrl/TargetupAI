/**
 * callback-spec.ts — 발신번호 규격(세칙) 검사 컨트롤타워 (★2026-10-05 특수한 유형의 부가통신사업 재등록 증빙 ⑥)
 *
 * 근거 = 「거짓으로 표시된 전화번호로 인한 이용자 피해 예방 등에 관한 세부지침」(한국인터넷진흥원 · 2015-05-01 시행)
 *   제16조(발신번호가 변작된 인터넷발송 문자메시지 차단)
 *     발신번호의 전체 번호수가 8~11자리인 경우에만 발송한다. 예외:
 *     1. 112 · 1335 등 특수번호 = 국가 · 지방자치단체 · 공공기관 이용자만
 *     2. 15YY · 16YY 등 대표번호 = 전체 8자리에 한해서
 *     3. 030 · 050 으로 시작 = 전체 12자리까지
 *   제13조제4항(등록 규칙)
 *     유선 = 지역번호 포함 · 이동 = 010-ABYY-YYYY · 대표번호(15YY · 16YY · 18YY) · 공통서비스식별번호(0N0) 앞에 지역번호 금지
 *
 * ⛔ 특수번호 예외(공공기관)는 두지 않는다 — 당사 이용자는 계약 법인이고 공공기관 판정 근거(컬럼)가 없다. 생기면 여기서만 연다.
 * ⛔ 같은 규칙이 비토 게이트웨이(엔진 Go · 관리 API JS)에도 있다. 하나를 바꾸면 셋을 같이 바꾸고, 시험 벡터도 같이 바꾼다.
 */

/** 지역번호(02 · 0NN) — 유선 번호의 앞자리 */
const AREA_CODES_3 = ['031', '032', '033', '041', '042', '043', '044', '051', '052', '053', '054', '055', '061', '062', '063', '064'];

export type CallbackSpecVerdict =
  | { ok: true; digits: string }
  | { ok: false; code: 'CALLBACK_SPEC_VIOLATION'; message: string };

const violation = (message: string): CallbackSpecVerdict => ({ ok: false, code: 'CALLBACK_SPEC_VIOLATION', message });

/** 번호 하나가 발신번호 규격에 맞는가. 숫자 · 하이픈 · 공백 · 점 · 괄호만 허용하고, 판정은 숫자만 남긴 값으로 한다 */
export function checkCallbackSpec(raw: unknown): CallbackSpecVerdict {
  const s = String(raw ?? '').trim();
  if (!s || /[^0-9\-\s.()]/.test(s)) return violation('발신번호는 숫자로만 입력할 수 있습니다.');
  const d = s.replace(/\D/g, '');
  if (!d) return violation('발신번호는 숫자로만 입력할 수 있습니다.');

  if (/^1[568]/.test(d)) {
    return d.length === 8 ? { ok: true, digits: d } : violation('대표번호(15YY · 16YY · 18YY)는 8자리만 발신번호로 쓸 수 있습니다.');
  }
  if (/^0[35]0/.test(d)) {
    return d.length >= 8 && d.length <= 12 ? { ok: true, digits: d } : violation('030 · 050 번호는 12자리까지만 발신번호로 쓸 수 있습니다.');
  }
  if (d.length < 8 || d.length > 11) {
    return violation('발신번호는 전체 8~11자리여야 합니다(특수번호는 공공기관만 사용할 수 있습니다).');
  }
  if (!d.startsWith('0')) return violation('유선번호는 지역번호를 포함해 입력해야 합니다.');
  if (d.startsWith('010') && d.length !== 11) return violation('010 번호는 11자리여야 합니다.');

  const area = d.startsWith('02') ? '02' : AREA_CODES_3.find((code) => d.startsWith(code));
  if (area && /^(0|1[568])/.test(d.slice(area.length))) {
    return violation('대표번호 · 공통서비스번호(0N0) 앞에는 지역번호를 붙일 수 없습니다.');
  }
  return { ok: true, digits: d };
}
