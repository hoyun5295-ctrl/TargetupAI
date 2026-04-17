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
import { useNavigate } from 'react-router-dom';
import { useDmBuilderStore } from '../../stores/dmBuilderStore';

export type DmTopBarProps = {
  onTestSendClick?: () => void;
  onPublishClick?: () => void;
};

export default function DmTopBar({ onTestSendClick, onPublishClick }: DmTopBarProps) {
  const navigate = useNavigate();
  const title = useDmBuilderStore((s) => s.title);
  const setTitle = useDmBuilderStore((s) => s.setTitle);
  const isDirty = useDmBuilderStore((s) => s.isDirty);
  const isSaving = useDmBuilderStore((s) => s.isSaving);
  const lastSavedAt = useDmBuilderStore((s) => s.lastSavedAt);
  const save = useDmBuilderStore((s) => s.save);
  const validationResult = useDmBuilderStore((s) => s.validationResult);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);

  const canPublish = validationResult?.can_publish !== false;

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
        onClick={() => navigate('/dm-builder')}
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

      {/* AI 그룹 */}
      <ToolbarGroup>
        <IconButton onClick={() => setOpenModal('ai-prompt')} title="한 줄 프롬프트 → AI 초안" label="프롬프트" emoji="⚡" />
        <IconButton onClick={() => setOpenModal('ai-improve')} title="AI 문안 개선" label="AI개선" emoji="✨" />
      </ToolbarGroup>

      {/* 편집 도구 그룹 */}
      <ToolbarGroup>
        <IconButton onClick={() => setOpenModal('brand-kit')} title="브랜드 킷 + URL 자동추출" label="브랜드" emoji="🎨" />
        <IconButton onClick={() => setOpenModal('validation')} title="10영역 자동 검수" label="검수" emoji="🔍" />
        <IconButton onClick={() => setOpenModal('version-history')} title="버전 히스토리" label="버전" emoji="📜" />
      </ToolbarGroup>

      {/* 운영 그룹 */}
      <ToolbarGroup>
        <IconButton onClick={() => setOpenModal('ab-test')} title="A/B 테스트" label="A/B" emoji="🔬" />
        <IconButton onClick={onTestSendClick} title="담당자 번호로 테스트 발송" label="테스트" emoji="📤" />
      </ToolbarGroup>

      <button onClick={() => save()} disabled={isSaving} style={btnStyle('secondary')} title="저장 (Ctrl+S)">
        💾 저장
      </button>
      <button
        onClick={onPublishClick}
        disabled={!canPublish}
        style={btnStyle(canPublish ? 'primary' : 'disabled')}
        title={canPublish ? '발행' : '검수 통과 후 발행 가능'}
      >
        🚀 발행
      </button>
    </div>
  );
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        borderRadius: 8,
        background: 'var(--dm-neutral-50)',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

function IconButton({ onClick, title, label, emoji }: { onClick?: () => void; title: string; label: string; emoji: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        height: 32,
        padding: '0 10px',
        border: 'none',
        background: 'transparent',
        color: 'var(--dm-neutral-700)',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 6,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--dm-bg)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span>{emoji}</span>
      <span>{label}</span>
    </button>
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
