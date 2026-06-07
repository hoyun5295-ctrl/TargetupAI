/**
 * alimtalk-emphasize.ts — 강조표기형 알림톡 k_etc_json({senderkey, title}) 생성 (CT)
 *
 * 강조표기 title은 본문과 똑같이 #{변수}를 치환해서 보내야 한다.
 *   raw #{변수}가 그대로 발송되면 카카오 검수에서 반려된다(버그1).
 * 치환 방식이 경로마다 달라서(직접발송·staging·자동 = replaceVariables, 여정 = replaceAlimtalkVars)
 * 치환 함수를 주입받는다. 직접발송·staging·여정·자동 4경로가 같은 형태를 쓰도록 통일한다.
 *
 * DB import 0 (순수). insertAlimtalkQueue의 etcJson 인자로 그대로 전달한다.
 *   senderkey·title 모두 없으면 undefined(etcJson 미전달).
 */
export function buildAlimtalkEtcJson(params: {
  senderKey?: string | null;
  emphasizeTitle?: string | null;
  substitute?: (raw: string) => string;
}): string | undefined {
  const etc: Record<string, string> = {};
  if (params.senderKey) etc.senderkey = String(params.senderKey);
  if (params.emphasizeTitle) {
    const raw = String(params.emphasizeTitle);
    etc.title = params.substitute ? String(params.substitute(raw)) : raw;
  }
  return Object.keys(etc).length > 0 ? JSON.stringify(etc) : undefined;
}
