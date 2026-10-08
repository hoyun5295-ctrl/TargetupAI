/**
 * useEditorFill — 발송 창 본문 칸: 창 높이를 채우고, 넘치면 칸 안에서 스크롤
 * (★2026-10-08 "글이 길어 아래가 가려져 있어요 · 미리보기로 한 번에 보기" 줄 제거 — 편집 도구 줄의 「미리보기」와 이중(직원 접수))
 * (★2026-09-29 한줄로 V2 R112 · 직접발송 창 코드를 원본 그대로 옮김 · 원 설계 docs/2026-09-25-direct-send-precheck-design.md 불변 7)
 *
 * 글자 칸(textarea)은 글 길이만큼 자라고, 그것을 감싼 스크롤 칸(editorScrollRef)이 창 높이를 채운다.
 * 쓰는 곳 = 직접발송 창(DirectSendPanel) · 직접 타겟 발송 창(TargetSendModal).
 * @param deps 글자 칸 높이를 다시 재야 하는 값들(본문 · 종류 · 광고 표기 등 — 창마다 다르다)
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject, type MutableRefObject } from 'react';

export function useEditorFill(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  cursorPosRef: MutableRefObject<number> | null,
  deps: unknown[],
) {
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const syncEditorHeight = useCallback(() => {
    const ta = textareaRef.current;
    const box = editorScrollRef.current;
    if (ta) {
      const keep = box ? box.scrollTop : 0;
      ta.style.height = '0px';
      ta.style.height = `${ta.scrollHeight}px`;
      if (box) box.scrollTop = keep;
    }
  }, []);
  // 다시 잴 값은 창마다 다르다(호출부가 준다) — 원본 의존 목록과 같은 값을 넘긴다
  useLayoutEffect(() => { syncEditorHeight(); }, [...deps, syncEditorHeight]);
  useEffect(() => {
    window.addEventListener('resize', syncEditorHeight);
    return () => window.removeEventListener('resize', syncEditorHeight);
  }, [syncEditorHeight]);
  /** 글 아래 빈 곳을 눌러도 글 끝에서 이어 쓴다 */
  const focusEditorFromBlank = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const n = ta.value.length;
    ta.setSelectionRange(n, n);
    if (cursorPosRef) cursorPosRef.current = n;
  };

  return { editorScrollRef, focusEditorFromBlank };
}
