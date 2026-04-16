/**
 * textInsert.ts — textarea 커서 위치 텍스트 삽입 컨트롤타워
 *
 * ★ D124 N3: 동일 로직 4곳 산재(DirectSendPanel 자동입력 / TargetSendModal 변수삽입 /
 *   AutoSendFormModal 변수삽입 / Dashboard 특수문자 모달) → CLAUDE.md "2곳 이상 = 컨트롤타워" 원칙 적용.
 *
 * 하나의 진입점으로 통일하여 "끝에 붙는 버그"(append 누락) 재발 방지.
 */

/**
 * textarea 커서 위치에 텍스트를 삽입하고, 커서를 삽입 후 위치로 이동.
 *
 * @param textarea - 대상 textarea 엘리먼트 (null이면 no-op 반환 false)
 * @param insertText - 삽입할 문자열
 * @param setValue - React state setter (prev => new). 반드시 updater 형태로 전달
 * @returns 삽입 성공 여부 (textarea가 null이면 false)
 *
 * 사용 예:
 * ```tsx
 * const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-char-target="direct"]');
 * const ok = insertAtCursor(ta, '★', setDirectMessage);
 * if (!ok) setDirectMessage(prev => prev + '★'); // fallback: 끝에 붙이기
 * ```
 */
export function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  insertText: string,
  setValue: (updater: (prev: string) => string) => void,
): boolean {
  if (!textarea) return false;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  setValue(prev => prev.substring(0, start) + insertText + prev.substring(end));
  const newPos = start + insertText.length;
  requestAnimationFrame(() => {
    textarea.focus();
    try {
      textarea.selectionStart = newPos;
      textarea.selectionEnd = newPos;
    } catch {
      // 일부 브라우저에서 focus 직후 selection 설정 실패할 수 있음 — 무시
    }
  });
  return true;
}

/**
 * textarea를 찾지 못하면 끝에 append 하는 편의 함수.
 * 특수문자 모달처럼 "찾아서 커서, 못 찾으면 끝에" 패턴 전용.
 */
export function insertAtCursorOrAppend(
  textarea: HTMLTextAreaElement | null,
  insertText: string,
  setValue: (updater: (prev: string) => string) => void,
): void {
  const ok = insertAtCursor(textarea, insertText, setValue);
  if (!ok) setValue(prev => prev + insertText);
}

/**
 * cursorPosRef 기반 삽입 — textarea의 selectionStart 대신 외부에서 관리하는 pos 사용.
 * DirectSendPanel의 onChange/onSelect 핸들러가 cursorPosRef를 갱신해놓은 케이스.
 *
 * @param cursorPos - 외부에서 관리 중인 커서 위치
 * @param insertText - 삽입할 문자열
 * @param setValue - React state setter
 * @param textarea - 포커스/selection 갱신용 (optional)
 * @param cursorPosRef - 삽입 후 pos 갱신용 (optional — .current가 설정됨)
 */
export function insertAtCursorPos(
  cursorPos: number,
  insertText: string,
  setValue: (updater: (prev: string) => string) => void,
  textarea?: HTMLTextAreaElement | null,
  cursorPosRef?: { current: number },
): number {
  setValue(prev => prev.substring(0, cursorPos) + insertText + prev.substring(cursorPos));
  const newPos = cursorPos + insertText.length;
  if (cursorPosRef) cursorPosRef.current = newPos;
  if (textarea) {
    requestAnimationFrame(() => {
      textarea.focus();
      try {
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
      } catch {
        /* ignore */
      }
    });
  }
  return newPos;
}
