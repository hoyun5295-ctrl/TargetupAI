/**
 * alimtalk-emphasize.ts — 알림톡 k_etc_json 생성 (CT)
 *
 * ★ QTmsg/게이트웨이 규약 (qtmsg-manual ver4.0 + 게이트웨이 외주 명시 2026-06-16):
 *   - 강조표기: k_etc_json = {"title":"강조내용"} (title만). senderkey는 알림톡에서 제외(템플릿코드로 중계서버 자동 처리).
 *   - 대표링크: k_etc_json = {"attachment_link":{"url_mobile","url_pc","scheme_ios","scheme_android"}} — 값 있는 키만.
 *       ★ 변수명은 attachment_link (link 아님). 2026-06-11 link 키로 넣은 테스트가 전부 7300이었던 원인 = 변수명 불일치.
 *       kakao_templates.represent_link 저장값(camelCase)을 snake_case로 변환해 동봉.
 *   - title·attachment_link 둘 다 없으면 undefined (etcJson 미전달 — 기본형/버튼형은 etcJson 불필요).
 *
 * 강조 title은 본문과 똑같이 #{변수}를 치환해서 보낸다(raw 발송 시 카카오 검수 반려).
 *   치환 방식이 경로마다 달라(직접발송·staging·자동 = replaceVariables, 여정 = replaceAlimtalkVars) 치환 함수를 주입받는다.
 *
 * DB import 0 (순수). insertAlimtalkQueue의 etcJson 인자로 그대로 전달한다.
 */
export interface RepresentLink {
  urlMobile?: string | null;
  urlPc?: string | null;
  schemeIos?: string | null;
  schemeAndroid?: string | null;
}

/** kakao_templates.represent_link 저장값(camelCase) → QTmsg attachment_link(snake_case, 값 있는 키만). 값 0개면 undefined. */
export function toAttachmentLink(link?: RepresentLink | null): Record<string, string> | undefined {
  if (!link || typeof link !== 'object') return undefined;
  const out: Record<string, string> = {};
  if (link.urlMobile) out.url_mobile = String(link.urlMobile);
  if (link.urlPc) out.url_pc = String(link.urlPc);
  if (link.schemeIos) out.scheme_ios = String(link.schemeIos);
  if (link.schemeAndroid) out.scheme_android = String(link.schemeAndroid);
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildAlimtalkEtcJson(params: {
  emphasizeTitle?: string | null;
  substitute?: (raw: string) => string;
  representLink?: RepresentLink | null;
  /** staging 재파싱 경로 전용 — commit이 저장한 etcJson에서 꺼낸 attachment_link(이미 snake). representLink보다 우선. */
  attachmentLink?: Record<string, string> | null;
}): string | undefined {
  const etc: Record<string, unknown> = {};
  if (params.emphasizeTitle) {
    const raw = String(params.emphasizeTitle);
    etc.title = params.substitute ? String(params.substitute(raw)) : raw;
  }
  const link = (params.attachmentLink && Object.keys(params.attachmentLink).length > 0)
    ? params.attachmentLink
    : toAttachmentLink(params.representLink);
  if (link && Object.keys(link).length > 0) etc.attachment_link = link;
  if (Object.keys(etc).length === 0) return undefined;
  return JSON.stringify(etc);
}
