/**
 * SectionList — 좌측 패널의 섹션 순서 목록 (DnD 가능)
 * @dnd-kit/sortable 기반 세로 드래그 재정렬.
 */
import {
  DndContext, closestCenter,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDmBuilderStore } from '../../../stores/dmBuilderStore';
import { SECTION_META, type Section } from '../../../utils/dm-section-defaults';

export default function SectionList() {
  const sections = useDmBuilderStore((s) => s.sections);
  const reorderSections = useDmBuilderStore((s) => s.reorderSections);

  const sorted = sections.slice().sort((a, b) => a.order - b.order);
  const ids = sorted.map((s) => s.id);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    reorderSections(from, to);
  };

  if (sorted.length === 0) {
    return (
      <div style={{ padding: '16px 12px', fontSize: 12, color: 'var(--dm-neutral-500)', textAlign: 'center' }}>
        아직 섹션이 없어요
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 8px' }}>
          {sorted.map((s) => (
            <SortableRow key={s.id} section={s} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ section }: { section: Section }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const selectedSectionId = useDmBuilderStore((s) => s.selectedSectionId);
  const selectSection = useDmBuilderStore((s) => s.selectSection);
  const removeSection = useDmBuilderStore((s) => s.removeSection);
  const duplicateSection = useDmBuilderStore((s) => s.duplicateSection);
  const setSectionVisible = useDmBuilderStore((s) => s.setSectionVisible);

  const meta = SECTION_META[section.type];
  const isSelected = selectedSectionId === section.id;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    padding: '8px 10px',
    borderRadius: 8,
    background: isSelected ? 'var(--dm-primary-light)' : isDragging ? 'var(--dm-bg)' : 'transparent',
    border: `1px solid ${isSelected ? 'var(--dm-primary)' : isDragging ? 'var(--dm-primary)' : 'transparent'}`,
    boxShadow: isDragging ? 'var(--dm-shadow-lg)' : 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    opacity: !section.visible ? 0.5 : isDragging ? 0.9 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => { if (!isDragging) selectSection(section.id); }}
    >
      <div
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title="드래그하여 순서 변경"
        aria-label="드래그 핸들"
        role="button"
        tabIndex={0}
        style={{
          width: 24,
          height: 32,
          padding: 0,
          border: 'none',
          background: 'transparent',
          cursor: isDragging ? 'grabbing' : 'grab',
          fontSize: 16,
          color: 'var(--dm-neutral-400)',
          lineHeight: 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'none',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        ⋮⋮
      </div>

      <span style={{ fontSize: 16 }}>{meta.icon}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--dm-neutral-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {meta.label}
        </div>
        <div style={{ fontSize: 10, color: 'var(--dm-neutral-500)', marginTop: 2 }}>
          {section.visible ? '표시' : '숨김'}
          {section.ai_locked ? ' · AI잠금' : ''}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
        <IconBtn onClick={() => setSectionVisible(section.id, !section.visible)} title={section.visible ? '숨기기' : '표시'}>
          {section.visible ? '👁' : '⊘'}
        </IconBtn>
        <IconBtn onClick={() => duplicateSection(section.id)} title="복제">⎘</IconBtn>
        <IconBtn
          onClick={() => { if (confirm('이 섹션을 삭제할까요?')) removeSection(section.id); }}
          title="삭제"
          danger
        >✕</IconBtn>
      </div>
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick?: () => void; title?: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 22, height: 22, padding: 0,
        border: 'none', background: 'transparent',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 11,
        color: danger ? 'var(--dm-error)' : 'var(--dm-neutral-600)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}
