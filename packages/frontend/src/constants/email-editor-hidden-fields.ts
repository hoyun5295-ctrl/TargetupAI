/**
 * 이메일 편집기가 공용 속성 패널에서 감추는 필드 — **백엔드 원장의 사본이다.**
 *
 * 원본 = `packages/backend/src/utils/email/email-property-contract.ts` `EMAIL_HIDDEN_EDITOR_FIELDS`.
 * 감출 이유와 판정은 백엔드가 소유한다(그 렌더러가 읽느냐 마느냐가 기준이다).
 *
 * ⛔ 이 파일을 손으로 고치지 마라. 백엔드 원장을 고치고 다시 뽑아 넣는다.
 *    어긋나면 파리티가 먼저 깨진다(`email-editor-coverage.test.ts`).
 *
 * 감추는 필드는 두 부류다.
 *   ① 이메일 렌더러가 **안 읽는 것이 정답**인 값 — 스와이프 인디케이터·확대 보기처럼 이메일에 없는 동작,
 *     그리고 수신거부처럼 발송 엔진이 법에 따라 소유하는 값. 보여 두면 "눌러도 안 바뀌는 칸"이 된다.
 *   ② 이메일 전용 컨트롤과 **같은 값을 두 번** 내보내는 것 — 헤드라인 강조는 이메일 편집기 위쪽
 *     "블록 스타일"에 3버튼으로 이미 있어, 공용 패널 select까지 나오면 한 화면에 위·아래 두 번 나온다.
 */
export const EMAIL_HIDDEN_EDITOR_FIELDS: Record<string, readonly string[]> = {
  hero: ['headline_emphasis'],
  text_card: ['headline_emphasis'],
  product_carousel: ['show_indicator'],
  gallery: ['enable_zoom'],
  footer: ['show_unsubscribe_link'],
};

/** 선택된 블록이 감출 필드 목록(미등재 블록 = 감출 것 없음). */
export function emailHiddenFieldsFor(sectionType: string): readonly string[] {
  return EMAIL_HIDDEN_EDITOR_FIELDS[sectionType] || [];
}
