import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Edit2, Layers, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';

// ★ D175-A (2026-05-19): In-app Message 관리 (회사 admin)
//   BUSINESS+ 베타 게이팅.

type Position = 'top_banner' | 'bottom_banner' | 'center_modal';
type Frequency = 'once_per_session' | 'once_per_day' | 'always';
type Status = 'active' | 'paused' | 'archived';

interface InAppMessage {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  actionLabel: string;
  position: Position;
  backgroundColor: string;
  textColor: string;
  triggerEvent: string;
  displayFrequency: Frequency;
  startAt: string | null;
  endAt: string | null;
  status: Status;
  stats?: { impressions: number; clicks: number; dismisses: number; ctr: number };
}

const EMPTY_FORM: Partial<InAppMessage> = {
  title: '',
  body: '',
  actionUrl: '',
  actionLabel: '자세히 보기',
  position: 'top_banner',
  backgroundColor: '#4f46e5',
  textColor: '#ffffff',
  triggerEvent: 'page_load',
  displayFrequency: 'once_per_session',
  status: 'active',
};

export default function InAppMessagesPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<InAppMessage[]>([]);
  const [editing, setEditing] = useState<Partial<InAppMessage> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = () => localStorage.getItem('token');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cdp/inapp', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) setMessages(data.messages || []);
      else setError(data.error || '조회 실패');
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!editing?.title?.trim() || !editing?.body?.trim()) {
      alert('제목과 본문은 필수입니다.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isUpdate = !!editing.id;
      const url = isUpdate ? `/api/cdp/inapp/${editing.id}` : '/api/cdp/inapp';
      const method = isUpdate ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (data.success) {
        setEditing(null);
        await load();
      } else {
        setError(data.error || '저장 실패');
      }
    } catch (e: any) {
      setError(e?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 메시지를 archive 처리하시겠습니까? (사용자 노출 즉시 중단)')) return;
    try {
      const res = await fetch(`/api/cdp/inapp/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) await load();
      else alert(data.error || '삭제 실패');
    } catch (e: any) {
      alert(e?.message || '삭제 중 오류');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="bg-slate-950/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/20">
            <Layers className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">인앱 메시지</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">자사몰 안 배너 / 모달 자동 표시 — SDK 통합 + 빈도 제어 + impression / click 트래킹</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={load} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              onClick={() => setEditing({ ...EMPTY_FORM })}
              className="text-xs bg-gradient-to-r from-rose-500/40 to-pink-500/40 hover:from-rose-500/60 hover:to-pink-500/60 text-rose-50 px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors border border-rose-400/30"
            >
              <Plus className="w-3.5 h-3.5" />
              신규 메시지
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {error && (
          <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {loading && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 flex justify-center text-white/50">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-white/50 text-sm">
            등록된 In-app 메시지가 없습니다. 신규 버튼을 눌러 첫 메시지를 만들어보세요.
          </div>
        )}

        {!loading && messages.map((m) => (
          <div key={m.id} className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div className="text-base font-bold text-white">{m.title}</div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    m.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' :
                    m.status === 'paused' ? 'bg-amber-500/20 text-amber-300' :
                    'bg-white/10 text-white/50'
                  }`}>{m.status}</span>
                </div>
                <div className="text-sm text-white/70 mb-2">{m.body}</div>
                <div className="flex flex-wrap gap-3 text-xs text-white/50">
                  <span>위치: {m.position}</span>
                  <span>·</span>
                  <span>트리거: {m.triggerEvent}</span>
                  <span>·</span>
                  <span>빈도: {m.displayFrequency}</span>
                  {m.actionUrl && (
                    <>
                      <span>·</span>
                      <span>CTA: {m.actionLabel} → {m.actionUrl}</span>
                    </>
                  )}
                </div>
                {m.stats && (
                  <div className="mt-3 flex gap-4 text-xs text-white/70 border-t pt-2">
                    <span>표시 <strong className="text-indigo-300">{m.stats.impressions.toLocaleString()}</strong></span>
                    <span>클릭 <strong className="text-emerald-300">{m.stats.clicks.toLocaleString()}</strong></span>
                    <span>닫힘 <strong className="text-white/50">{m.stats.dismisses.toLocaleString()}</strong></span>
                    <span>CTR <strong>{(m.stats.ctr * 100).toFixed(2)}%</strong></span>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <button onClick={() => setEditing(m)} className="text-xs text-indigo-300 hover:bg-indigo-500/10 px-2 py-1 rounded flex items-center gap-1">
                  <Edit2 className="w-3 h-3" /> 수정
                </button>
                <button onClick={() => handleDelete(m.id)} className="text-xs text-rose-300 hover:bg-rose-500/20 px-2 py-1 rounded flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> 삭제
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white mb-4">{editing.id ? '메시지 수정' : '신규 메시지'}</h3>
            <div className="space-y-3">
              <FormField label="제목">
                <input type="text" value={editing.title || ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" maxLength={100} />
              </FormField>
              <FormField label="본문">
                <textarea value={editing.body || ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm resize-none h-20" maxLength={500} />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="CTA 라벨">
                  <input type="text" value={editing.actionLabel || ''} onChange={(e) => setEditing({ ...editing, actionLabel: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </FormField>
                <FormField label="CTA URL">
                  <input type="url" value={editing.actionUrl || ''} onChange={(e) => setEditing({ ...editing, actionUrl: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </FormField>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FormField label="위치">
                  <select value={editing.position || 'top_banner'} onChange={(e) => setEditing({ ...editing, position: e.target.value as Position })} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="top_banner">상단 배너</option>
                    <option value="bottom_banner">하단 배너</option>
                    <option value="center_modal">가운데 모달</option>
                  </select>
                </FormField>
                <FormField label="트리거">
                  <select value={editing.triggerEvent || 'page_load'} onChange={(e) => setEditing({ ...editing, triggerEvent: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="page_load">페이지 로드</option>
                    <option value="cart_add">장바구니 담음</option>
                    <option value="cart_view">장바구니 페이지</option>
                    <option value="checkout_start">결제 시작</option>
                  </select>
                </FormField>
                <FormField label="빈도">
                  <select value={editing.displayFrequency || 'once_per_session'} onChange={(e) => setEditing({ ...editing, displayFrequency: e.target.value as Frequency })} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="once_per_session">세션당 1회</option>
                    <option value="once_per_day">하루 1회</option>
                    <option value="always">항상</option>
                  </select>
                </FormField>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <FormField label="배경색">
                  <input type="color" value={editing.backgroundColor || '#4f46e5'} onChange={(e) => setEditing({ ...editing, backgroundColor: e.target.value })} className="w-full h-10 border rounded-lg" />
                </FormField>
                <FormField label="글자색">
                  <input type="color" value={editing.textColor || '#ffffff'} onChange={(e) => setEditing({ ...editing, textColor: e.target.value })} className="w-full h-10 border rounded-lg" />
                </FormField>
                <FormField label="상태">
                  <select value={editing.status || 'active'} onChange={(e) => setEditing({ ...editing, status: e.target.value as Status })} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="active">활성</option>
                    <option value="paused">일시 중지</option>
                  </select>
                </FormField>
              </div>

              {/* 미리보기 */}
              <div className="border-t pt-4">
                <div className="text-xs text-white/50 mb-2">미리보기</div>
                <div
                  className="rounded-lg p-3 flex items-center gap-3"
                  style={{ background: editing.backgroundColor || '#4f46e5', color: editing.textColor || '#ffffff' }}
                >
                  <div className="flex-1">
                    <div className="font-bold text-sm">{editing.title || '제목'}</div>
                    <div className="text-xs opacity-90">{editing.body || '본문'}</div>
                  </div>
                  {editing.actionLabel && (
                    <button className="bg-white/20 border border-white/40 rounded px-3 py-1 text-xs">
                      {editing.actionLabel}
                    </button>
                  )}
                  <span className="opacity-70 text-sm">✕</span>
                </div>
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-300">
                  {error}
                </div>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm text-white/80 hover:bg-white/5">취소</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 text-sm rounded-lg disabled:opacity-40">
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-white/70 block mb-1">{label}</label>
      {children}
    </div>
  );
}
