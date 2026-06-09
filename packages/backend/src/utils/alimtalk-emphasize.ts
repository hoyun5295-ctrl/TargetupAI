/**
 * alimtalk-emphasize.ts — 강조표기형 알림톡 k_etc_json({title}) 생성 (CT)
 *
 * ★ QTmsg 매뉴얼(qtmsg-manual.txt 228~239행): 알림톡 강조표기 k_etc_json = {"title":"강조내용"} (title만).
 *   - senderkey는 알림톡에선 k_template_code로 중계서버가 자동 처리(우선순위 최상위) → k_etc_json에 불필요.
 *   - k_etc_json의 senderkey는 친구톡(F/G) 전용. 알림톡에 senderkey를 섞으면 QTmsg 에이전트가
 *     etcJson을 규격대로 못 읽어 통째로 누락 → 강조 title 미전달 → 카카오 7300.
 *     (2026-06-09 직원 신고 근본원인 = 이전 CT가 {senderkey,title}을 넣어 강조 title이 deliver에서 빠졌음.)
 *
 * 강조 title은 본문과 똑같이 #{변수}를 치환해서 보낸다(raw 발송 시 카카오 검수 반려).
 *   치환 방식이 경로마다 달라(직접발송·staging·자동 = replaceVariables, 여정 = replaceAlimtalkVars)
 *   치환 함수를 주입받는다. 직접발송·staging·여정·자동 4경로가 같은 형태를 쓰도록 통일한다.
 *
 * DB import 0 (순수). insertAlimtalkQueue의 etcJson 인자로 그대로 전달한다.
 *   emphasizeTitle 없으면 undefined(etcJson 미전달 — 기본형/버튼형은 etcJson 자체가 불필요).
 */
export function buildAlimtalkEtcJson(params: {
  emphasizeTitle?: string | null;
  substitute?: (raw: string) => string;
}): string | undefined {
  if (!params.emphasizeTitle) return undefined;
  const raw = String(params.emphasizeTitle);
  const title = params.substitute ? String(params.substitute(raw)) : raw;
  return JSON.stringify({ title });
}
