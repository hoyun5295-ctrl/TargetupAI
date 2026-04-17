/**
 * PageList — 좌측 패널 상단의 페이지 목록 (D128 V4)
 *
 * 기능:
 *  - 페이지 목록 (이름 인라인 편집)
 *  - 현재 페이지 선택 (클릭)
 *  - 페이지 추가 / 복제 / 삭제 / 위아래 이동
 *  - 각 페이지 섹션 개수 표시
 */
import { useState } from 'react';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';

export default function PageList() {
  const pages = useDmBuilderStore((s) => s.pages);
  const currentPageIndex = useDmBuilderStore((s) => s.currentPageIndex);
  const selectPage = useDmBuilderStore((s) => s.selectPage);
  const addPage = useDmBuilderStore((s) => s.addPage);
  const removePage = useDmBuilderStore((s) => s.removePage);
  const duplicatePage = useDmBuilderStore((s) => s.duplicatePage);
  const renamePage = useDmBuilderStore((s) => s.renamePage);
  const reorderPages = useDmBuilderStore((s) => s.reorderPages);

  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');

  const startRename = (idx: number) => {
    setEditingIdx(idx);
    setEditingName(pages[idx]?.name || `페이지 ${idx + 1}`);
  };

  const commitRename = () => {
    if (editingIdx !== null) {
      renamePage(editingIdx, editingName.trim() || `페이지 ${editingIdx + 1}`);
    }
    setEditingIdx(null);
    setEditingName('');
  };

  const cancelRename = () => {
    setEditingIdx(null);
    setEditingName('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: 8 }}>
      {pages.map((page, idx) => {
        const isActive = idx === currentPageIndex;
        const isEditing = editingIdx === idx;
        const displayName = page.name || `페이지 ${idx + 1}`;
        const sectionCount = page.sections.length;

        return (
          <div
            key={page.id}
            onClick={() => !isEditing && selectPage(idx)}
            onDoubleClick={() => startRename(idx)}
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              background: isActive ? 'var(--dm-primary)' : 'transparent',
              color: isActive ? '#fff' : 'var(--dm-neutral-900)',
              cursor: isEditing ? 'text' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              transition: 'background 120ms',
            }}
            onMouseEnter={(e) => { if (!isActive && !isEditing) e.currentTarget.style.background = 'var(--dm-neutral-50)'; }}
            onMouseLeave={(e) => { if (!isActive && !isEditing) e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ fontSize: 10, opacity: 0.7, minWidth: 16 }}>{idx + 1}</span>

            {isEditing ? (
              <input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  else if (e.key === 'Escape') cancelRename();
                }}
                autoFocus
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'rgba(255,255,255,0.95)',
                  color: '#111',
                  padding: '2px 6px',
                  borderRadius: 3,
                  fontSize: 12,
                  outline: 'none',
                  minWidth: 0,
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                style={{
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={`${displayName} (더블클릭하면 이름 수정)`}
              >
                {displayName}
              </span>
            )}

            {!isEditing && (
              <>
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--dm-neutral-100)',
                    color: isActive ? '#fff' : 'var(--dm-neutral-600)',
                    borderRadius: 3,
                    fontWeight: 700,
                  }}
                >
                  {sectionCount}
                </span>
                <PageActionsMenu
                  canMoveUp={idx > 0}
                  canMoveDown={idx < pages.length - 1}
                  canDelete={pages.length > 1}
                  isActive={isActive}
                  onMoveUp={() => reorderPages(idx, idx - 1)}
                  onMoveDown={() => reorderPages(idx, idx + 1)}
                  onDuplicate={() => duplicatePage(idx)}
                  onRename={() => startRename(idx)}
                  onDelete={() => {
                    if (window.confirm(`"${displayName}" 페이지를 삭제할까요? 안의 섹션이 모두 사라져요.`)) {
                      removePage(idx);
                    }
                  }}
                />
              </>
            )}
          </div>
        );
      })}

      <button
        onClick={() => addPage()}
        style={{
          height: 30,
          marginTop: 4,
          background: 'transparent',
          border: '1px dashed var(--dm-neutral-300)',
          color: 'var(--dm-neutral-600)',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        + 새 페이지
      </button>
    </div>
  );
}

function PageActionsMenu({
  canMoveUp, canMoveDown, canDelete, isActive,
  onMoveUp, onMoveDown, onDuplicate, onRename, onDelete,
}: {
  canMoveUp: boolean;
  canMoveDown: boolean;
  canDelete: boolean;
  isActive: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  const iconBtnStyle: React.CSSProperties = {
    width: 20, height: 20, padding: 0,
    border: 'none', background: 'transparent',
    borderRadius: 3,
    cursor: 'pointer',
    fontSize: 11,
    color: isActive ? '#fff' : 'var(--dm-neutral-500)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };

  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        style={iconBtnStyle}
        title="페이지 옵션"
      >
        ⋯
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 100 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: 22,
              right: 0,
              zIndex: 101,
              background: '#fff',
              border: '1px solid var(--dm-neutral-200)',
              borderRadius: 6,
              boxShadow: 'var(--dm-shadow-md)',
              minWidth: 130,
              padding: 4,
            }}
          >
            <MenuItem onClick={() => { onRename(); setOpen(false); }}>✎ 이름 수정</MenuItem>
            <MenuItem onClick={() => { onDuplicate(); setOpen(false); }}>⎘ 복제</MenuItem>
            <MenuItem onClick={() => { if (canMoveUp) { onMoveUp(); setOpen(false); } }} disabled={!canMoveUp}>↑ 위로 이동</MenuItem>
            <MenuItem onClick={() => { if (canMoveDown) { onMoveDown(); setOpen(false); } }} disabled={!canMoveDown}>↓ 아래로 이동</MenuItem>
            <div style={{ height: 1, background: 'var(--dm-neutral-200)', margin: '4px 0' }} />
            <MenuItem
              danger
              onClick={() => { if (canDelete) { onDelete(); setOpen(false); } }}
              disabled={!canDelete}
            >
              ✕ 삭제
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        fontSize: 12,
        color: disabled ? 'var(--dm-neutral-400)' : danger ? 'var(--dm-error)' : 'var(--dm-neutral-800)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--dm-neutral-50)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {children}
    </button>
  );
}
