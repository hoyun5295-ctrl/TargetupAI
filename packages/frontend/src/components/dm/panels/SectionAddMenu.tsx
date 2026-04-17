/**
 * SectionAddMenu — 좌측 패널의 섹션 추가 메뉴 (11종)
 * 최대 개수 초과 시 비활성.
 */
import { useState } from 'react';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import { SECTION_META, SECTION_ADD_MENU_ORDER, isMaxCountExceeded, type SectionType } from '../../../utils/dm-section-defaults';

export default function SectionAddMenu() {
  const [expanded, setExpanded] = useState(false);
  const sections = useDmBuilderStore((s) => s.sections);
  const addSection = useDmBuilderStore((s) => s.addSection);

  return (
    <div style={{ borderTop: '1px solid var(--dm-neutral-200)', padding: '12px 8px' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%',
          height: 36,
          background: 'var(--dm-primary)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <span>+ 섹션 추가</span>
      </button>

      {expanded && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {SECTION_ADD_MENU_ORDER.map((type: SectionType) => {
            const meta = SECTION_META[type];
            const disabled = isMaxCountExceeded(sections, type);
            return (
              <button
                key={type}
                disabled={disabled}
                onClick={() => {
                  addSection(type);
                  setExpanded(false);
                }}
                title={disabled ? `최대 ${meta.maxCount}개까지 가능` : meta.description}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: disabled ? 'var(--dm-neutral-50)' : 'var(--dm-bg)',
                  color: disabled ? 'var(--dm-neutral-400)' : 'var(--dm-neutral-900)',
                  border: '1px solid var(--dm-neutral-200)',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                <span style={{ fontSize: 16 }}>{meta.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label}</div>
                  <div style={{ fontSize: 10, color: 'var(--dm-neutral-500)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {meta.description}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
