/**
 * InlineEditable — contentEditable 기반 인라인 텍스트 편집 (D126 V2)
 *
 * 사용:
 *   <InlineEditable
 *     value={props.headline}
 *     placeholder="제목을 입력하세요"
 *     onChange={(v) => onEdit?.('headline', v)}
 *     multiline={false}
 *     disabled={readOnly}
 *   />
 *
 * 특징:
 *  - onBlur에서만 onChange 호출 (매 입력마다 zustand 업데이트 방지)
 *  - Enter로 저장(multiline=false 시), Shift+Enter로 줄바꿈(multiline=true 시)
 *  - Esc로 취소 (blur 없이 원복)
 *  - 빈 값일 때 placeholder를 CSS pseudo로 표시
 *
 * 스타일은 styles/dm-builder.css 의 [data-dm-editable="true"] 참조.
 */
import { useEffect, useRef, useState } from 'react';

export type InlineEditableProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  /** 부모 SectionFrame의 클릭 전파 차단 */
  stopPropagation?: boolean;
  /** 최대 글자수 (초과시 자름) */
  maxLength?: number;
};

export default function InlineEditable({
  value,
  onChange,
  placeholder,
  multiline = false,
  className = '',
  style,
  disabled = false,
  stopPropagation = true,
  maxLength,
}: InlineEditableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const initialValueRef = useRef(value);

  // 외부 value 변경 시 DOM 동기화 (편집 중이 아닐 때만)
  useEffect(() => {
    if (!focused && ref.current && ref.current.innerText !== value) {
      ref.current.innerText = value || '';
    }
  }, [value, focused]);

  // 초기 렌더에 value 주입
  useEffect(() => {
    if (ref.current && !focused) {
      ref.current.innerText = value || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    if (!ref.current) return;
    let next = ref.current.innerText;
    if (maxLength && next.length > maxLength) {
      next = next.slice(0, maxLength);
      ref.current.innerText = next;
    }
    if (next !== value) {
      onChange(next);
    }
  };

  const revert = () => {
    if (ref.current) {
      ref.current.innerText = initialValueRef.current;
    }
    ref.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      if (multiline && e.shiftKey) return; // Shift+Enter → 줄바꿈 허용
      if (!multiline) {
        e.preventDefault();
        ref.current?.blur();
      } else if (!e.shiftKey) {
        // multiline인데 Shift 없이 Enter 누르면 저장
        e.preventDefault();
        ref.current?.blur();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      revert();
    }
  };

  const handleFocus = () => {
    setFocused(true);
    initialValueRef.current = value;
  };

  const handleBlur = () => {
    setFocused(false);
    commit();
  };

  const handleClick = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
  };

  const isEmpty = !value || value.length === 0;

  return (
    <div
      ref={ref}
      contentEditable={!disabled}
      suppressContentEditableWarning
      className={className}
      data-dm-editable={disabled ? undefined : 'true'}
      data-dm-empty={isEmpty && !focused ? 'true' : undefined}
      data-dm-placeholder={placeholder}
      spellCheck={false}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onMouseDown={handleClick}
      style={{
        whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
        wordBreak: 'break-word',
        outline: 'none',
        ...style,
      }}
    />
  );
}
