/**
 * DmTopBar — 에디터 상단 바
 * 좌: 뒤로가기 + 제목 입력
 * 우: AI 프롬프트 / AI 개선 / 검수 / 테스트 / 저장 / 발행
 */
import { useNavigate } from 'react-router-dom';
import { useDmBuilderStore } from '../../stores/dmBuilderStore';

export type DmTopBarProps = {
  onPromptClick?: () => void;
  onAiImproveClick?: () => void;
  onValidateClick?: () => void;
  onTestSendClick?: () => void;
  onPublishClick?: () => void;
};

export default function DmTopBar({
  onPromptClick, onAiImproveClick, onValidateClick, onTestSendClick, onPublishClick,
}: DmTopBarProps) {
  const navigate = useNavigate();
  const title = useDmBuilderStore((s) => s.title);
  const setTitle = useDmBuilderStore((s) => s.setTitle);
  const isDirty = useDmBuilderStore((s) => s.isDirty);
  const isSaving = useDmBuilderStore((s) => s.isSaving);
  const lastSavedAt = useDmBuilderStore((s) => s.lastSavedAt);
  const save = useDmBuilderStore((s) => s.save);
  const validationResult = useDmBuilderStore((s) => s.validationResult);

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
        gap: 12,
        flexShrink: 0,
      }}
    >
      <button
        onClick={() => navigate('/dm-builder')}
        style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', padding: 8, borderRadius: 8, color: 'var(--dm-neutral-700)' }}
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
          flex: 1,
          maxWidth: 400,
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

      <span style={{ fontSize: 12, color: isDirty ? 'var(--dm-warning)' : 'var(--dm-neutral-500)', whiteSpace: 'nowrap' }}>
        {savedLabel}
      </span>

      <div style={{ flex: 1 }} />

      <button onClick={onPromptClick} style={btnStyle('ghost')} title="한 줄 프롬프트 → AI 초안 생성">⚡ 프롬프트</button>
      <button onClick={onAiImproveClick} style={btnStyle('ghost')} title="AI 문안 개선">✨ AI 개선</button>
      <button onClick={onValidateClick} style={btnStyle('ghost')} title="10영역 자동 검수">🔍 검수</button>
      <button onClick={onTestSendClick} style={btnStyle('ghost')} title="담당자 번호로 테스트 발송">📤 테스트</button>
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
  };
  if (variant === 'primary') return { ...base, background: 'var(--dm-primary)', color: '#fff' };
  if (variant === 'secondary') return { ...base, background: 'var(--dm-neutral-100)', color: 'var(--dm-neutral-900)' };
  if (variant === 'ghost') return { ...base, background: 'transparent', color: 'var(--dm-neutral-700)' };
  return { ...base, background: 'var(--dm-neutral-100)', color: 'var(--dm-neutral-400)', opacity: 0.6 };
}
