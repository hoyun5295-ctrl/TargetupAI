/**
 * DmTopBar — 에디터 상단 바 (D126 V2 확장)
 *
 * 좌: 뒤로가기 + 제목 입력 + 저장 상태
 * 우: AI / 편집 도구 / 운영 그룹
 *
 * V2 추가:
 *  - 🎨 브랜드킷
 *  - 📜 버전
 *  - 🔬 A/B
 *
 * 모달은 store.openModal 상태로 관리 (DmBuilderPage에서 렌더링).
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDmBuilderStore, type LayoutMode } from '../../stores/dmBuilderStore';

export type DmTopBarProps = {
  onBack?: () => void;
  onTestSendClick?: () => void;
  onPublishClick?: () => void;
};

export default function DmTopBar({ onBack, onTestSendClick, onPublishClick }: DmTopBarProps) {
  const navigate = useNavigate();
  const title = useDmBuilderStore((s) => s.title);
  const setTitle = useDmBuilderStore((s) => s.setTitle);
  const isDirty = useDmBuilderStore((s) => s.isDirty);
  const isSaving = useDmBuilderStore((s) => s.isSaving);
  const lastSavedAt = useDmBuilderStore((s) => s.lastSavedAt);
  const save = useDmBuilderStore((s) => s.save);
  const validationResult = useDmBuilderStore((s) => s.validationResult);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const setLayoutMode = useDmBuilderStore((s) => s.setLayoutMode);
  // ★ D216+ undo/redo
  const undo = useDmBuilderStore((s) => s.undo);
  const redo = useDmBuilderStore((s) => s.redo);
  const canUndo = useDmBuilderStore((s) => s.canUndo);
  const canRedo = useDmBuilderStore((s) => s.canRedo);
  const undoEnabled = canUndo();
  const redoEnabled = canRedo();

  const canPublish = validationResult?.can_publish !== false;
  // ★ 2026-07-02(3) 발행(100크레딧) 완료 = 버튼 [발송] 전환 (재발행 크레딧 모달 오해 차단)
  const isPublished = useDmBuilderStore((s) => s.isPublished);

  const savedLabel = isSaving
    ? '저장 중...'
    : isDirty
    ? '변경사항 있음'
    : lastSavedAt
    ? `${new Date(lastSavedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 저장됨`
    : '';

  return (
    <div
      style={{
        height: 56,
        borderBottom: '1px solid var(--dm-neutral-200)',
        background: 'var(--dm-bg)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 8,
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => (onBack ? onBack() : navigate('/dm-builder'))}
        style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', padding: 8, borderRadius: 8, color: 'var(--dm-neutral-700)', flexShrink: 0 }}
        title="목록으로"
      >
        ←
      </button>

      <input
        type="text"
        placeholder="DM 제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{
          flex: '0 1 280px',
          minWidth: 120,
          padding: '8px 12px',
          border: '1px solid transparent',
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          background: 'transparent',
          outline: 'none',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--dm-neutral-200)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'transparent')}
      />

      <span style={{ fontSize: 11, color: isDirty ? 'var(--dm-warning)' : 'var(--dm-neutral-500)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {savedLabel}
      </span>

      <div style={{ flex: 1 }} />

      {/* ★ D216+ Undo / Redo 버튼 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => undo()}
          disabled={!undoEnabled}
          title="실행 취소 (Cmd+Z)"
          style={{
            background: 'transparent',
            border: '1px solid var(--dm-neutral-200)',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 13,
            cursor: undoEnabled ? 'pointer' : 'not-allowed',
            opacity: undoEnabled ? 1 : 0.3,
            color: 'var(--dm-neutral-700)',
          }}
        >
          ↶
        </button>
        <button
          onClick={() => redo()}
          disabled={!redoEnabled}
          title="다시 실행 (Cmd+Y)"
          style={{
            background: 'transparent',
            border: '1px solid var(--dm-neutral-200)',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 13,
            cursor: redoEnabled ? 'pointer' : 'not-allowed',
            opacity: redoEnabled ? 1 : 0.3,
            color: 'var(--dm-neutral-700)',
          }}
        >
          ↷
        </button>
      </div>

      {/* 레이아웃 모드 세그먼트 토글 */}
      <LayoutModeToggle value={layoutMode} onChange={setLayoutMode} />

      {/* ★ 2026-07-02(5) Harold 지시 — 버튼 7개(프롬프트·AI개선·브랜드·검수·버전·A/B·테스트)를
          [도구] 드롭다운 하나로 정리 (진입점 보존 + 상단 바 단순화) */}
      <ToolsMenu
        items={[
          { emoji: '⚡', label: '프롬프트로 AI 초안', onClick: () => setOpenModal('ai-prompt') },
          { emoji: '✨', label: 'AI 문안 개선', onClick: () => setOpenModal('ai-improve') },
          { emoji: '🎨', label: '브랜드 킷', onClick: () => setOpenModal('brand-kit') },
          { emoji: '🔍', label: '자동 검수', onClick: () => setOpenModal('validation') },
          { emoji: '📜', label: '버전 히스토리', onClick: () => setOpenModal('version-history') },
          { emoji: '🔬', label: 'A/B 테스트', onClick: () => setOpenModal('ab-test') },
          { emoji: '📤', label: '테스트 발송', onClick: () => onTestSendClick?.() },
        ]}
      />

      <button onClick={() => save()} disabled={isSaving} style={btnStyle('secondary')} title="저장 (Ctrl+S)">
        💾 저장
      </button>
      <button
        onClick={onPublishClick}
        disabled={!canPublish}
        style={btnStyle(canPublish ? 'primary' : 'disabled')}
        title={isPublished ? '타겟 고객에게 발송 (발행 완료 — 추가 과금 없음)' : canPublish ? '발행 (100크레딧, DM당 1회)' : '검수 통과 후 발행 가능'}
      >
        {isPublished ? '📨 발송' : '🚀 발행'}
      </button>
    </div>
  );
}

function LayoutModeToggle({ value, onChange }: { value: LayoutMode; onChange: (m: LayoutMode) => void }) {
  const MODES: Array<{ key: LayoutMode; icon: string; label: string; tooltip: string }> = [
    { key: 'scroll', icon: '📜', label: '스크롤',  tooltip: '긴 세로 스크롤' },
    { key: 'slides', icon: '🎴', label: '슬라이드', tooltip: '좌우 스와이프 슬라이드' },
  ];
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: 2,
        borderRadius: 8,
        background: 'var(--dm-neutral-50)',
        border: '1px solid var(--dm-neutral-200)',
        flexShrink: 0,
      }}
    >
      {MODES.map((m) => {
        const active = value === m.key;
        return (
          <button
            key={m.key}
            onClick={() => onChange(m.key)}
            title={m.tooltip}
            style={{
              height: 28,
              padding: '0 10px',
              border: 'none',
              background: active ? 'var(--dm-primary)' : 'transparent',
              color: active ? '#fff' : 'var(--dm-neutral-700)',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 6,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              whiteSpace: 'nowrap',
              transition: 'all 120ms',
            }}
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** ★ 2026-07-02(5) 상단 바 정리 — 도구 진입점을 드롭다운 하나로 (바깥 클릭 시 닫힘) */
function ToolsMenu({ items }: { items: Array<{ emoji: string; label: string; onClick: () => void }> }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="AI·검수·버전·A/B·테스트 발송"
        style={{
          height: 32,
          padding: '0 12px',
          border: '1px solid var(--dm-neutral-200)',
          background: open ? 'var(--dm-neutral-100)' : 'var(--dm-neutral-50)',
          color: 'var(--dm-neutral-700)',
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 8,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          whiteSpace: 'nowrap',
        }}
      >
        <span>🧰</span>
        <span>도구</span>
        <span style={{ fontSize: 9, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 38,
            right: 0,
            minWidth: 180,
            background: 'var(--dm-bg)',
            border: '1px solid var(--dm-neutral-200)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(15,23,42,0.14)',
            padding: 4,
            zIndex: 1300,
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              onClick={() => { setOpen(false); it.onClick(); }}
              style={{
                width: '100%',
                textAlign: 'left',
                border: 'none',
                background: 'transparent',
                color: 'var(--dm-neutral-700)',
                fontSize: 12,
                fontWeight: 600,
                padding: '8px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dm-neutral-50)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span>{it.emoji}</span>
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function btnStyle(variant: 'primary' | 'secondary' | 'ghost' | 'disabled'): React.CSSProperties {
  const base: React.CSSProperties = {
    height: 36,
    padding: '0 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    border: 'none',
    cursor: variant === 'disabled' ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    transition: 'background 150ms ease-out, opacity 150ms ease-out',
    flexShrink: 0,
  };
  if (variant === 'primary') return { ...base, background: 'var(--dm-primary)', color: '#fff' };
  if (variant === 'secondary') return { ...base, background: 'var(--dm-neutral-100)', color: 'var(--dm-neutral-900)' };
  if (variant === 'ghost') return { ...base, background: 'transparent', color: 'var(--dm-neutral-700)' };
  return { ...base, background: 'var(--dm-neutral-100)', color: 'var(--dm-neutral-400)', opacity: 0.6 };
}
