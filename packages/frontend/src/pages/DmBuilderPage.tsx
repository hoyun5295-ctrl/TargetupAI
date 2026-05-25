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
import { useDmKeyboardShortcuts } from '../hooks/useDmKeyboardShortcuts';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
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
  // ★ CT-17: 요금제 게이팅 (mobile_dm — PRO+)
  const [planLocked, setPlanLocked] = useState<{ msg: string } | null>(null);

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
  // ★ D216+ ConfirmModal generic (native confirm 영구 폐기)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ★ D216+ Journey 동급 디자인 — overview 5 metric + 자연어 입력
  const [overview, setOverview] = useState<{
    total_dm: number;
    published_dm: number;
    total_views_30d: number;
    unique_viewers_30d: number;
    total_responses_30d: number;
    avg_ctr_30d: number;
  } | null>(null);
  const [naturalLanguage, setNaturalLanguage] = useState('');
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);

  // ★ D216+ 키보드 단축키 활성 (편집 모드 한정)
  useDmKeyboardShortcuts({ enabled: mode === 'edit' });

  const refreshList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await api.get('/dm');
      const items = Array.isArray(res.data) ? res.data : res.data.items || [];
      setList(items);
      setPlanLocked(null);
    } catch (err: any) {
      // ★ CT-17: 403 PLAN_FEATURE_LOCKED → 요금제 가드 화면 표시
      if (err?.response?.status === 403 && err?.response?.data?.code === 'PLAN_FEATURE_LOCKED') {
        setPlanLocked({ msg: err.response.data.error || '모바일 DM은 프로 요금제 이상에서 이용 가능합니다.' });
      } else {
        setToast({ type: 'error', message: err?.response?.data?.error || '목록 로드 실패' });
      }
    } finally {
      setListLoading(false);
    }
  }, [setToast]);

  useEffect(() => {
    if (mode === 'list') refreshList();
  }, [mode, refreshList]);

  // ★ D216+ overview 5 metric 로드 (list 모드 진입 시)
  useEffect(() => {
    if (mode !== 'list') return;
    (async () => {
      try {
        const res = await api.get('/dm/overview');
        if (res.data?.success) setOverview(res.data.data);
      } catch {
        // overview 영역 X = silent fallback (옛 영역 영구 정합)
      }
    })();
  }, [mode]);

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
    setGenerating(false);
  };

  const [convertingId, setConvertingId] = useState<string | null>(null);

  const handleEdit = async (id: string, itemLayoutMode?: string) => {
    setLegacyDmError(null);
    if (itemLayoutMode === 'slides') {
      // ★ D216+ ConfirmModal (옛 native confirm 영구 폐기)
      setConfirm({
        mode: 'warning',
        title: '레거시 슬라이드 모드 DM 변환',
        description: '이 DM은 옛 슬라이드 모드입니다. 새 에디터로 변환하면 섹션 기반 구조로 바뀝니다.\n변환 후에는 새 에디터에서 편집 가능하며, 필요 시 백업에서 되돌릴 수 있어요.',
        confirmLabel: '변환하고 진입',
        cancelLabel: '취소',
        onConfirm: async () => {
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
        },
      });
      return;
    }
    await loadDm(id);
    setMode('edit');
  };

  const handleDelete = async (id: string) => {
    // ★ D216+ ConfirmModal (옛 native confirm 영구 폐기)
    setConfirm({
      mode: 'danger',
      title: 'DM 삭제',
      description: '이 DM을 삭제할까요? 되돌릴 수 없어요.',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      onConfirm: async () => {
        try {
          await api.delete(`/dm/${id}`);
          setToast({ type: 'success', message: '삭제했어요.' });
          refreshList();
        } catch (err: any) {
          setToast({ type: 'error', message: err?.response?.data?.error || '삭제 실패' });
        }
      },
    });
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
        <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
        {toast && <Toast toast={toast} />}
      </div>
    );
  }

  // ── 요금제 게이팅 (CT-17, mobile_dm) ──
  if (planLocked) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#020617,#0f172a,#020617)', fontFamily: 'var(--dm-font-primary)', color: '#fff', display: 'flex', flexDirection: 'column' }}>
        <header style={{ background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <button onClick={() => navigate('/ai-operator')} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', padding: 8, borderRadius: 8, color: '#fff' }} title="AI Operator로">←</button>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>모바일 DM 빌더</h1>
          <span style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(139,92,246,0.2)', color: '#c4b5fd', borderRadius: 12, fontWeight: 700 }}>PRO</span>
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{ maxWidth: 480, textAlign: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '40px 32px', boxShadow: '0 10px 30px rgba(0,0,0,0.4)' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, margin: '0 auto 20px', background: 'linear-gradient(135deg,#a78bfa,#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>📱</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800, color: '#fff' }}>프로 요금제 전용 기능</h2>
            <p style={{ margin: '0 0 24px', fontSize: 14, color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
              {planLocked.msg}<br />
              업그레이드하시면 AI 구조·카피 자동 생성, 검수 10종, A/B 테스트까지 바로 이용하실 수 있어요.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button
                onClick={() => navigate('/pricing')}
                style={{ height: 44, padding: '0 24px', background: 'rgba(139,92,246,0.3)', color: '#ddd6fe', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
              >
                요금제 안내 보기
              </button>
              <button
                onClick={() => navigate('/ai-operator')}
                style={{ height: 44, padding: '0 20px', background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                AI Operator로
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 목록 모드 ──
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#020617,#0f172a,#020617)', fontFamily: 'var(--dm-font-primary)', color: '#fff' }}>
      <header style={{ background: 'rgba(2,6,23,0.8)', backdropFilter: 'blur(8px)', borderBottom: '1px solid rgba(255,255,255,0.1)', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={() => navigate('/ai-operator')} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', padding: 8, borderRadius: 8, color: '#fff' }} title="AI Operator로">←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#fff', margin: 0 }}>모바일 DM 빌더</h1>
            <span style={{ fontSize: 11, padding: '3px 8px', background: 'rgba(139,92,246,0.2)', color: '#c4b5fd', borderRadius: 12, fontWeight: 700 }}>PRO</span>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', margin: '2px 0 0 0' }}>카드형 모바일 DM 빌더 — 미디어 메세지 디자인 + 카드 단위 편집</p>
        </div>
        <button
          onClick={handleCreateNew}
          style={{ height: 36, padding: '0 16px', background: 'rgba(139,92,246,0.3)', color: '#ddd6fe', border: '1px solid rgba(139,92,246,0.5)', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
        >
          + 새 DM 만들기
        </button>
      </header>

      {legacyDmError && (
        <div style={{ maxWidth: 1100, margin: '16px auto', padding: '12px 16px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#fde68a', fontSize: 13 }}>
          {legacyDmError}
        </div>
      )}
      {loadError && (
        <div style={{ maxWidth: 1100, margin: '16px auto', padding: '12px 16px', background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.3)', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
          {loadError}
        </div>
      )}

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>
        {/* ★ D216+ Journey 동급 디자인 — 자연어 입력 + 빠른 시작 7 카드 */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(217,70,239,0.10), rgba(168,85,247,0.08), rgba(99,102,241,0.10))',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          padding: 20,
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>✨</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>자연어 한 줄로 DM 자동 생성</span>
            <span style={{ fontSize: 10, padding: '2px 6px', background: 'rgba(217,70,239,0.3)', color: '#f5d0fe', borderRadius: 10, fontWeight: 700 }}>BETA</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={naturalLanguage}
              onChange={(e) => setNaturalLanguage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && naturalLanguage.trim() && !generating) {
                  setGenerating(true);
                  setLegacyDmError(null);
                  setLayoutPickerOpen(true);
                }
              }}
              placeholder='예: "봄 신상 프로모션, 30대 여성, 추첨 이벤트" — Enter로 자동 생성'
              style={{
                flex: 1, height: 44, padding: '0 14px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 10, fontSize: 13, color: '#fff', outline: 'none',
              }}
            />
            <button
              onClick={() => { if (naturalLanguage.trim()) { setLayoutPickerOpen(true); } }}
              disabled={!naturalLanguage.trim() || generating}
              style={{
                height: 44, padding: '0 20px',
                background: naturalLanguage.trim() ? 'linear-gradient(135deg, #a855f7, #d946ef)' : 'rgba(255,255,255,0.05)',
                color: '#fff', border: 'none', borderRadius: 10,
                fontSize: 13, fontWeight: 700,
                cursor: naturalLanguage.trim() ? 'pointer' : 'not-allowed',
                opacity: naturalLanguage.trim() ? 1 : 0.4,
              }}
            >
              {generating ? '생성 중...' : '자동 생성'}
            </button>
          </div>

          {/* 빠른 시작 7 시나리오 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginTop: 14 }}>
            {[
              { icon: '🛍️', label: '신상품 출시', hint: 'header + hero + product_carousel' },
              { icon: '🏷️', label: '시즌 세일', hint: 'header + countdown + coupon' },
              { icon: '🎁', label: '추첨 이벤트', hint: 'header + lucky_draw + cta' },
              { icon: '🗺️', label: '매장 안내', hint: 'header + map_store_locator' },
              { icon: '📝', label: '설문 + 보상', hint: 'header + survey + instant_coupon' },
              { icon: '✉️', label: '신규 환영', hint: 'header + email_capture' },
              { icon: '🎡', label: '룰렛 이벤트', hint: 'header + roulette + cta' },
            ].map((s) => (
              <button
                key={s.label}
                onClick={() => { setNaturalLanguage(s.label); setLayoutPickerOpen(true); }}
                style={{
                  padding: '10px 8px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 10, cursor: 'pointer',
                  textAlign: 'center', transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(217,70,239,0.15)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
              >
                <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{s.label}</div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{s.hint}</div>
              </button>
            ))}
          </div>
        </div>

        {/* ★ D216+ 5 metric 요약 (overview endpoint) */}
        {overview && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
            marginBottom: 20,
          }}>
            {[
              { label: '전체 DM', value: overview.total_dm, accent: '#a855f7' },
              { label: '발행', value: overview.published_dm, accent: '#10b981' },
              { label: '30일 열람', value: overview.total_views_30d.toLocaleString(), accent: '#06b6d4' },
              { label: '고유 시청자', value: overview.unique_viewers_30d.toLocaleString(), accent: '#f59e0b' },
              { label: '평균 CTR', value: `${overview.avg_ctr_30d}%`, accent: '#ec4899' },
            ].map((m) => (
              <div key={m.label} style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 12,
                padding: 14,
              }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: m.accent }}>{m.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* ★ D216+ 자세히 분석 토글 (Source caption 영구 룰 정합) */}
        {overview && (
          <div style={{ marginBottom: 20 }}>
            <button
              onClick={() => setDetailExpanded(!detailExpanded)}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.7)',
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: 12,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {detailExpanded ? '▲' : '▼'} 자세히 분석
            </button>
            {detailExpanded && (
              <div style={{
                marginTop: 12,
                padding: 14,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10,
              }}>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
                  총 응답 (30일): <strong style={{ color: '#fff' }}>{overview.total_responses_30d.toLocaleString()}건</strong>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
                  CTR = (이벤트 응답 / 열람) × 100. 응답 영역 = poll / survey / email_capture / lucky_draw 등 인터랙션 누적.
                </div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
                  Data source — dm_views (최근 30일) + dm_event_responses (CT-86~89 통합 매트릭스)
                </div>
              </div>
            )}
          </div>
        )}

        {listLoading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.5)' }}>불러오는 중...</div>
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
        onClose={() => { setLayoutPickerOpen(false); setGenerating(false); }}
        onSelect={handleLayoutPicked}
      />

      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

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
