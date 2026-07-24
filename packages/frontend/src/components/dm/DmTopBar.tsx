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
    // ★ 2026-07-14 발행 DM은 저장해야 URL 반영(임은지) — 미저장 상태를 명확히 안내
    ? (isPublished ? '변경사항 있음 — 저장해야 URL 반영' : '변경사항 있음')
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

      {/* ★ 2026-07-16 M4 (설계서 §1-1·§1-2) — [도구] 드롭다운 9종·정예 템플릿 폐기.
          AI 초안 = [⚡ AI로 만들기]로 승격 / 검수 = 발행에 내장 / AI개선 = 우패널 인라인 /
          브랜드킷·테마·서체 = 퀵바 / 버전·A/B = 후퇴(⋯ 더보기 2개만) / 저장 = 자동(수동 버튼 제거) */}
      <button
        onClick={() => setOpenModal('ai-prompt')}
        style={{ ...btnStyle('primary'), background: 'linear-gradient(135deg, #7c3aed, #db2777)' }}
        title="행사 내용을 붙여넣으면 완성된 DM을 만들어요"
      >
        ⚡ AI로 만들기
      </button>

      <MoreMenu
        items={[
          { emoji: '📜', label: '버전 히스토리', onClick: () => setOpenModal('version-history') },
          { emoji: '🔬', label: 'A/B 테스트', onClick: () => setOpenModal('ab-test') },
        ]}
      />

      {/* ★ 초안은 전역 자동저장 — 발행 DM만 명시 저장 유지(자동저장이 라이브 URL을 덮지 않게 차단돼 있어 저장 경로 필수) */}
      {isPublished && (
        <button onClick={() => save()} disabled={isSaving} style={btnStyle('secondary')} title="저장 — 라이브 URL에 반영">
          💾 저장
        </button>
      )}
      {/* ★ 2026-07-24 발행 후에만 테스트 발송 — 미발행 시 흐리게+안내(클릭 시 사유 토스트). 발행 전 확인은 캔버스 미리보기. */}
      <button
        onClick={() => onTestSendClick?.()}
        style={{ ...btnStyle('secondary'), ...(isPublished ? {} : { opacity: 0.5 }) }}
        title={isPublished ? '내 폰으로 테스트 발송' : '발행 후 테스트 발송이 가능해요'}
      >
        📤 테스트
      </button>
      {/* ★ Codex 1R — 검수가 발행 클릭에 내장되면서 버튼 잠금 해제 (옛 canPublish 잠금은 "문제 고친 뒤 재검수 불가" 교착 유발).
          클릭 흐름 자체가 게이트: 저장 배리어 → 자동 검수 → 실패 시 검수 모달. */}
      <button
        onClick={onPublishClick}
        style={btnStyle('primary')}
        title={isPublished ? '타겟 고객에게 발송 (발행 완료 — 추가 과금 없음)' : canPublish ? '발행 — 자동 검수 후 진행 (100크레딧, DM당 1회)' : '발행 — 자동 검수를 다시 실행합니다'}
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

/** ★ 2026-07-16 M4 — 후퇴 항목(버전·A/B) 전용 ⋯ 더보기 (옛 도구 드롭다운의 축소 대체 — 바깥 클릭 시 닫힘) */
function MoreMenu({ items }: { items: Array<{ emoji: string; label: string; onClick: () => void }> }) {
  const [open, setOpen] = useState(false);
  // ★ 2026-07-14 결함 수정 — 상단 바(overflow:hidden, 2026-04-17 V2부터)가 absolute 드롭다운을 56px에서
  //   잘라내던 잠복 결함. 메뉴를 fixed(버튼 실좌표 앵커)로 렌더해 클리핑 조상 밖으로 분리.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const toggle = () => {
    if (!open && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    // fixed 앵커는 스크롤·리사이즈에 안 따라가므로 열림 중 이동 신호 = 닫기 (짧은 수명 메뉴 — 재열기로 재계산)
    const onMove = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={toggle}
        title="더보기 — 버전 히스토리 · A/B 테스트"
        aria-label="더보기"
        style={{
          height: 32,
          width: 32,
          border: '1px solid var(--dm-neutral-200)',
          background: open ? 'var(--dm-neutral-100)' : 'var(--dm-neutral-50)',
          color: 'var(--dm-neutral-700)',
          fontSize: 16,
          fontWeight: 700,
          borderRadius: 8,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          lineHeight: 1,
        }}
      >
        ⋯
      </button>
      {open && menuPos && (
        <div
          style={{
            position: 'fixed',
            top: menuPos.top,
            right: menuPos.right,
            minWidth: 180,
            maxHeight: 'calc(100vh - 80px)',
            overflowY: 'auto',
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
