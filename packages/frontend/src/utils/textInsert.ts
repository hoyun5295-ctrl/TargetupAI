/**
 * textInsert.ts — textarea 커서 위치 텍스트 삽입 컨트롤타워
 *
 * ★ D124 N3: 동일 로직 4곳 산재(DirectSendPanel 자동입력 / TargetSendModal 변수삽입 /
 *   AutoSendFormModal 변수삽입 / Dashboard 특수문자 모달) → CLAUDE.md "2곳 이상 = 컨트롤타워" 원칙 적용.
 *
 * setter는 새 값을 받는 단순 형태 `(newValue: string) => void`로 통일.
 * React Dispatch<SetStateAction<string>>는 자연스럽게 호환되며,
 * props로 내려받은 `(msg: string) => void` 콜백도 문제없이 사용 가능.
 */

import type { Dispatch, SetStateAction } from 'react';

/**
 * textarea 커서 위치에 텍스트를 삽입하고, 커서를 삽입 후 위치로 이동.
 *
 * @param textarea - 대상 textarea 엘리먼트 (null이면 no-op, false 반환)
 * @param insertText - 삽입할 문자열
 * @param setValue - 새 전체 값을 받는 setter (React setter / 일반 콜백 모두 호환)
 * @returns 삽입 성공 여부 (textarea가 null이면 false)
 */
export function insertAtCursor(
  textarea: HTMLTextAreaElement | null,
  insertText: string,
  setValue: (newValue: string) => void,
): boolean {
  if (!textarea) return false;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const newValue = textarea.value.substring(0, start) + insertText + textarea.value.substring(end);
  setValue(newValue);
  const newPos = start + insertText.length;
  requestAnimationFrame(() => {
    textarea.focus();
    try {
      textarea.selectionStart = newPos;
      textarea.selectionEnd = newPos;
    } catch {
      /* 일부 브라우저에서 focus 직후 selection 설정 실패할 수 있음 — 무시 */
    }
  });
  return true;
}

/**
 * textarea를 찾지 못하면 끝에 append. React Dispatch 필수 (updater 패턴 사용).
 * 특수문자 모달처럼 "찾아서 커서, 못 찾으면 끝에" 패턴 전용.
 */
export function insertAtCursorOrAppend(
  textarea: HTMLTextAreaElement | null,
  insertText: string,
  setValue: Dispatch<SetStateAction<string>>,
): void {
  if (insertAtCursor(textarea, insertText, setValue)) return;
  // fallback: prev 기반 append (updater 형태 필요 → React Dispatch 요구)
  setValue(prev => prev + insertText);
}

/**
 * cursorPosRef 기반 삽입 — textarea의 selectionStart 대신 외부에서 관리하는 pos 사용.
 * React Dispatch로 prev 기반 삽입 (currentValue 몰라도 동작).
 *
 * @param cursorPos - 외부에서 관리 중인 커서 위치
 * @param insertText - 삽입할 문자열
 * @param setValue - React Dispatch (updater 기반)
 * @param textarea - 포커스/selection 갱신용 (optional)
 * @param cursorPosRef - 삽입 후 pos 갱신용 (optional — .current가 설정됨)
 */
export function insertAtCursorPos(
  cursorPos: number,
  insertText: string,
  setValue: Dispatch<SetStateAction<string>>,
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
