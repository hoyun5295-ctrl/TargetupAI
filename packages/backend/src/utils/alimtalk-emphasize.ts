/**
 * alimtalk-emphasize.ts — 알림톡 k_etc_json 생성 (CT)
 *
 * ★ QTmsg/게이트웨이 규약 (qtmsg-manual ver4.0 + 게이트웨이 외주 명시 2026-06-16):
 *   - 강조표기: k_etc_json = {"title":"강조내용"} (title만).
 *   - senderkey: 표준 QTmsg 라인은 제외(템플릿코드로 중계서버 자동 처리) — builder는 senderkey를 만들지 않는다.
 *       비토 게이트웨이 라인(Agent v1.0.10+, 명시 요구·미동봉=9999)만 CT-04 insertAlimtalkQueue가
 *       발송 직전 withSenderKey로 SENDER_KEY를 병합 주입한다(2026-07-07, 비토 라인 한정 — 표준 라인 payload 불변).
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

/**
 * ★ 2026-07-07 비토 게이트웨이 라인 전용 — k_etc_json에 SENDER_KEY(발신프로필키) 병합.
 *   Agent v1.0.10이 kakao_payload(k_etc_json)의 SENDER_KEY/sender_key/senderKey/senderkey를
 *   kakao_sender_key 표준 필드로 승격한다(미동봉 = 필드매핑 실패 status_code 9999).
 *   기존 키(title/attachment_link)는 보존. etcJson이 없거나(기본형/버튼형) 깨진 JSON이면 SENDER_KEY만 생성.
 *   호출부 = CT-04 insertAlimtalkQueue(비토 라인 판정 후)만 — 표준 QTmsg 라인에는 절대 주입하지 않는다
 *   (표준 에이전트는 select_sql로 k_etc_json을 SQL 합성하므로 payload 불변이 안전 전제, D234+).
 */
export function withSenderKey(etcJson: string | null | undefined, senderKey: string): string {
  let base: Record<string, unknown> = {};
  if (etcJson) {
    try {
      const parsed = JSON.parse(etcJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed;
    } catch { /* 형식 오류 → SENDER_KEY만 (기존 파싱 실패 관용과 동일) */ }
  }
  base.SENDER_KEY = senderKey;
  return JSON.stringify(base);
}
