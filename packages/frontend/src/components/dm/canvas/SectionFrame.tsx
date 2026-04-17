/**
 * SectionFrame — 섹션 공통 래퍼 (선택/hover 상태 + 클릭 이벤트)
 * 에디터에서 섹션을 선택/드래그/편집할 때 시각적 경계를 제공.
 */
import type { ReactNode } from 'react';

export type SectionFrameProps = {
  id: string;
  type: string;
  variant?: string;
  selected?: boolean;
  hovered?: boolean;
  hidden?: boolean;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  children: ReactNode;
};

export default function SectionFrame({
  id, type, variant = 'default',
  selected = false, hovered = false, hidden = false,
  onSelect, onHover, children,
}: SectionFrameProps) {
  return (
    <div
      className="dm-section-wrap"
      data-section-id={id}
      data-section-type={type}
      data-variant={variant}
      data-selected={selected}
      data-hovered={hovered}
      data-hidden={hidden}
      onClick={(e) => { e.stopPropagation(); onSelect?.(id); }}
      onMouseEnter={() => onHover?.(id)}
      onMouseLeave={() => onHover?.(null)}
      style={{ position: 'relative', opacity: hidden ? 0.4 : 1, cursor: onSelect ? 'pointer' : 'default' }}
    >
      {children}
      {(selected || hovered) && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            outline: selected ? '2px solid var(--dm-primary)' : '2px dashed var(--dm-primary)',
            outlineOffset: '-2px',
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}
