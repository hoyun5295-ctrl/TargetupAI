/**
 * DmBuilderPage — 모바일 DM 빌더 (D125 프로모델 v1)
 *
 * 목록 모드 ↔ 편집 모드 분기.
 * 편집 모드는 3분할 레이아웃 (좌측: 섹션 목록 / 중앙: 캔버스 / 우측: 속성 편집).
 *
 * 레거시(slides 모드) DM은 편집 불가 안내 + 새 에디터로 전환 버튼(15단계 구현 후 활성).
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useDmBuilderStore } from '../stores/dmBuilderStore';
import DmTopBar from '../components/dm/DmTopBar';
import DmLeftPanel from '../components/dm/DmLeftPanel';
import DmCanvas from '../components/dm/DmCanvas';
import DmRightPanel from '../components/dm/DmRightPanel';
import AiPromptModal from '../components/dm/modals/AiPromptModal';
import AiImproveModal from '../components/dm/modals/AiImproveModal';
import ValidationModal from '../components/dm/modals/ValidationModal';
import VersionHistoryModal from '../components/dm/modals/VersionHistoryModal';
import BrandKitModal from '../components/dm/modals/BrandKitModal';
import AbTestModal from '../components/dm/modals/AbTestModal';
import LayoutModePickerModal from '../components/dm/modals/LayoutModePickerModal';
import ModalBase, { ModalButton } from '../components/dm/modals/ModalBase';
import type { LayoutMode } from '../stores/dmBuilderStore';
import '../styles/dm-builder.css';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

type DmListItem = {
  id: string;
  title: string;
  store_name?: string;
  layout_mode?: string;
  approval_status?: string;
  short_code?: string | null;
  view_count?: number;
  updated_at?: string;
};

export default function DmBuilderPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'list' | 'edit'>('list');
  const [list, setList] = useState<DmListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [legacyDmError, setLegacyDmError] = useState<string | null>(null);

  const dmId = useDmBuilderStore((s) => s.dmId);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const loadError = useDmBuilderStore((s) => s.loadError);
  const loadDm = useDmBuilderStore((s) => s.loadDm);
  const createNew = useDmBuilderStore((s) => s.createNew);
  const reset = useDmBuilderStore((s) => s.reset);
  const toast = useDmBuilderStore((s) => s.toast);
  const setToast = useDmBuilderStore((s) => s.setToast);
  const isDirty = useDmBuilderStore((s) => s.isDirty);
  const [confirmBackOpen, setConfirmBackOpen] = useState(false);

  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await api.get('/dm');
      const items = Array.isArray(res.data) ? res.data : res.data.items || [];
      setList(items);
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '목록 로드 실패' });
    } finally {
      setListLoading(false);
    }
  }, [setToast]);

  useEffect(() => {
    if (mode === 'list') refreshList();
  }, [mode, refreshList]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);

  const handleCreateNew = () => {
    setLegacyDmError(null);
    setLayoutPickerOpen(true);
  };

  const handleLayoutPicked = (layoutMode: LayoutMode) => {
    createNew({ layoutMode });
    setMode('edit');
  };

  const [convertingId, setConvertingId] = useState<string | null>(null);

  const handleEdit = async (id: string, itemLayoutMode?: string) => {
    setLegacyDmError(null);
    if (itemLayoutMode === 'slides') {
      if (!confirm('이 DM은 레거시 슬라이드 모드예요.\n새 에디터로 변환하면 섹션 기반 구조로 바뀝니다. 계속할까요?\n(변환 후에는 새 에디터에서 편집 가능하며, 필요 시 백업에서 되돌릴 수 있어요.)')) return;
      setConvertingId(id);
      try {
        const res = await api.post(`/dm/${id}/convert-to-scroll`);
        setToast({ type: 'success', message: `변환 완료 (${res.data.converted_sections}개 섹션)` });
        await loadDm(id);
        setMode('edit');
      } catch (err: any) {
        setToast({ type: 'error', message: err?.response?.data?.error || '변환 실패' });
      } finally {
        setConvertingId(null);
      }
      return;
    }
    await loadDm(id);
    setMode('edit');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 DM을 삭제할까요? 되돌릴 수 없어요.')) return;
    try {
      await api.delete(`/dm/${id}`);
      setToast({ type: 'success', message: '삭제했어요.' });
      refreshList();
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '삭제 실패' });
    }
  };

  const handleBackToList = () => {
    reset();
    setMode('list');
  };

  // ← 상단바 뒤로가기: 변경사항 있으면 경고 모달, 없으면 즉시 목록으로
  const handleBackRequest = () => {
    if (isDirty) {
      setConfirmBackOpen(true);
    } else {
      handleBackToList();
    }
  };

  // ── 편집 모드 ──
  if (mode === 'edit') {
    return (
      <div className="dm-builder" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <TopBarWithBack onBack={handleBackRequest} onPublishDone={handleBackToList} />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <DmLeftPanel />
          <DmCanvas />
          <DmRightPanel />
        </div>
        <EditorModals />
        <ConfirmDiscardModal
          open={confirmBackOpen}
          onClose={() => setConfirmBackOpen(false)}
          onConfirm={() => {
            setConfirmBackOpen(false);
            handleBackToList();
          }}
        />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  // ── 목록 모드 ──
  return (
    <div style={{ minHeight: '100vh', background: 'var(--dm-neutral-100)', fontFamily: 'var(--dm-font-primary)' }}>
      <header style={{ background: 'var(--dm-bg)', borderBottom: '1px solid var(--dm-neutral-200)', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => navigate('/')} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', padding: 8, borderRadius: 8 }} title="대시보드로">←</button>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--dm-neutral-900)', margin: 0 }}>모바일 DM 빌더</h1>
        <span style={{ fontSize: 11, padding: '3px 8px', background: 'var(--dm-primary-light)', color: 'var(--dm-primary)', borderRadius: 12, fontWeight: 700 }}>PRO</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleCreateNew}
          style={{ height: 36, padding: '0 16px', background: 'var(--dm-primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + 새 DM 만들기
        </button>
      </header>

      {legacyDmError && (
        <div style={{ maxWidth: 1100, margin: '16px auto', padding: '12px 16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, color: '#9a3412', fontSize: 13 }}>
          {legacyDmError}
        </div>
      )}
      {loadError && (
        <div style={{ maxWidth: 1100, margin: '16px auto', padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>
        {listLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--dm-neutral-500)' }}>불러오는 중...</div>
        ) : list.length === 0 ? (
          <EmptyList onCreateNew={handleCreateNew} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {list.map((dm) => (
              <DmCard key={dm.id} dm={dm} onEdit={handleEdit} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </main>

      <LayoutModePickerModal
        open={layoutPickerOpen}
        onClose={() => setLayoutPickerOpen(false)}
        onSelect={handleLayoutPicked}
      />

      {toast && <Toast toast={toast} />}
    </div>
  );
}

function TopBarWithBack({ onBack, onPublishDone }: { onBack: () => void; onPublishDone: () => void }) {
  const saveStore = useDmBuilderStore((s) => s.save);
  const dmId = useDmBuilderStore((s) => s.dmId);
  const setToast = useDmBuilderStore((s) => s.setToast);

  const handleTestSend = async () => {
    if (!dmId) {
      setToast({ type: 'error', message: '먼저 저장 후 테스트 발송이 가능해요.' });
      return;
    }
    try {
      await api.post(`/dm/${dmId}/test-send`, { sample_key: 'vip' });
      setToast({ type: 'success', message: '테스트 발송 요청을 보냈어요.' });
    } catch (err: any) {
      setToast({ type: 'error', message: err?.response?.data?.error || '테스트 발송 실패' });
    }
  };

  return (
    <DmTopBar
      onBack={onBack}
      onTestSendClick={handleTestSend}
      onPublishClick={async () => {
        await saveStore();
        if (dmId) {
          try {
            await api.post(`/dm/${dmId}/publish`);
            setToast({ type: 'success', message: '발행했어요.' });
          } catch (err: any) {
            setToast({ type: 'error', message: err?.response?.data?.error || '발행 실패' });
            return;
          }
        }
        onPublishDone();
      }}
    />
  );
}

// ← 경고 모달: 편집 중 뒤로가기 시 확인
function ConfirmDiscardModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalBase
      open={open}
      onClose={onClose}
      title="편집을 취소하고 나가시겠어요?"
      subtitle="저장하지 않은 모든 변경사항이 사라집니다."
      size="sm"
      footer={
        <>
          <ModalButton variant="secondary" onClick={onClose}>계속 편집</ModalButton>
          <ModalButton variant="danger" onClick={onConfirm}>나가기</ModalButton>
        </>
      }
    >
      <div style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.6 }}>
        지금 나가면 이번 편집 세션의 변경 내용이 모두 사라지고 되돌릴 수 없어요.
        계속 편집하려면 <strong>"계속 편집"</strong>을, 나가려면 <strong>"나가기"</strong>를 선택하세요.
      </div>
    </ModalBase>
  );
}

function EditorModals() {
  const openModal = useDmBuilderStore((s) => s.openModal);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const close = () => setOpenModal(null);

  return (
    <>
      <AiPromptModal open={openModal === 'ai-prompt'} onClose={close} />
      <AiImproveModal open={openModal === 'ai-improve'} onClose={close} />
      <ValidationModal open={openModal === 'validation'} onClose={close} />
      <VersionHistoryModal open={openModal === 'version-history'} onClose={close} />
      <BrandKitModal open={openModal === 'brand-kit'} onClose={close} />
      <AbTestModal open={openModal === 'ab-test'} onClose={close} />
    </>
  );
}

function EmptyList({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, background: 'var(--dm-bg)', borderRadius: 16, border: '1px solid var(--dm-neutral-200)' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📱</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--dm-neutral-900)', marginBottom: 8 }}>아직 만든 DM이 없어요</div>
      <div style={{ fontSize: 13, color: 'var(--dm-neutral-600)', marginBottom: 24, lineHeight: 1.6 }}>
        한 줄 프롬프트로 AI가 구조·카피를 자동 생성해줘요.<br />
        "봄 신상 프로모션, 30대 여성, 20% 할인, 오늘 자정 마감"처럼 입력해 보세요.
      </div>
      <button
        onClick={onCreateNew}
        style={{ height: 44, padding: '0 24px', background: 'var(--dm-primary)', color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
      >
        + 첫 DM 만들기
      </button>
    </div>
  );
}

function DmCard({ dm, onEdit, onDelete }: { dm: DmListItem; onEdit: (id: string, mode?: string) => void; onDelete: (id: string) => void }) {
  const isLegacy = dm.layout_mode === 'slides';
  const statusLabel = (() => {
    switch (dm.approval_status) {
      case 'published': return { label: '발행됨', color: '#10b981' };
      case 'approved':  return { label: '승인됨', color: '#3b82f6' };
      case 'review':    return { label: '검수중', color: '#f59e0b' };
      default:          return { label: '임시저장', color: '#737373' };
    }
  })();

  return (
    <div
      style={{
        background: 'var(--dm-bg)',
        borderRadius: 12,
        border: '1px solid var(--dm-neutral-200)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        boxShadow: 'var(--dm-shadow-sm)',
        cursor: 'pointer',
        transition: 'box-shadow 150ms, transform 150ms',
      }}
      onClick={() => onEdit(dm.id, dm.layout_mode)}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--dm-shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--dm-shadow-sm)'; e.currentTarget.style.transform = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--dm-neutral-900)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dm.title || '(제목 없음)'}
        </div>
        {isLegacy && (
          <span style={{ fontSize: 10, padding: '2px 6px', background: 'var(--dm-neutral-100)', color: 'var(--dm-neutral-600)', borderRadius: 4, whiteSpace: 'nowrap' }}>레거시</span>
        )}
      </div>
      {dm.store_name && <div style={{ fontSize: 11, color: 'var(--dm-neutral-600)' }}>{dm.store_name}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 10, padding: '3px 8px', background: statusLabel.color + '22', color: statusLabel.color, borderRadius: 4, fontWeight: 700 }}>
          {statusLabel.label}
        </span>
        {typeof dm.view_count === 'number' && (
          <span style={{ fontSize: 11, color: 'var(--dm-neutral-500)' }}>조회 {dm.view_count}</span>
        )}
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => onEdit(dm.id, dm.layout_mode)}
          style={{ flex: 1, height: 28, background: 'var(--dm-primary)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          편집
        </button>
        <button
          onClick={() => onDelete(dm.id)}
          style={{ height: 28, padding: '0 10px', background: 'var(--dm-bg)', color: 'var(--dm-error)', border: '1px solid var(--dm-neutral-200)', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          삭제
        </button>
      </div>
    </div>
  );
}

function Toast({ toast }: { toast: NonNullable<ReturnType<typeof useDmBuilderStore.getState>['toast']> }) {
  const color = toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#3b82f6';
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 20px',
        background: color,
        color: '#fff',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        boxShadow: 'var(--dm-shadow-lg)',
        zIndex: 9999,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      {toast.message}
    </div>
  );
}
