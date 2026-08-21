import {
  Bookmark, ChevronLeft, ChevronRight, Pencil, Plus, Search,
  Sparkles, Trash2, X, Loader2, Lightbulb, AlertTriangle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { FIELD_KEY_DISPLAY_MAP } from '../utils/formatDate';

interface SavedSegment {
  id: string;
  name: string;
  emoji: string;
  segment_type: 'hanjullo' | 'custom';
  prompt: string | null;
  // D171 영구 원칙: auto_relax DB 컬럼 보존 + 항상 false 고정 + frontend 무시
  auto_relax: boolean;
  selected_fields: string[] | null;
  briefing: string | null;
  url: string | null;
  channel: string | null;
  is_ad: boolean;
  last_used_at: string | null;
  created_at: string;
}

interface CustomPreloadData {
  selectedFields: string[];
  briefing: string;
  url: string;
  channel: string;
  isAd: boolean;
}

interface RecommendTemplateModalProps {
  show: boolean;
  onClose: () => void;
  // D171 영구 원칙: autoRelax 인자 사용 X
  onSelectHanjullo: (prompt: string) => void;
  onSelectCustom: (preloadData: CustomPreloadData) => void;
}

// 사용자 선택용 이모지 매트릭스 — 사용자 데이터 영역 (유지)
const EMOJI_OPTIONS = ['📋', '🎯', '🎂', '🛍️', '📢', '💎', '🏷️', '🔥', '💌', '🎁', '🎉', '🧧', '💰', '🌸', '☀️', '❄️'];
const CARDS_PER_PAGE = 8;
const DEFAULT_EXAMPLE: SavedSegment = {
  id: '__example__',
  name: 'VIP 재구매 유도 (예시)',
  emoji: '🎯',
  segment_type: 'hanjullo',
  prompt: '최근 3개월 미구매 VIP 고객에게 봄 신상품 할인 안내 보내줘',
  auto_relax: false,
  selected_fields: null,
  briefing: null,
  url: null,
  channel: null,
  is_ad: false,
  last_used_at: null,
  created_at: '',
};

export default function RecommendTemplateModal({
  show, onClose, onSelectHanjullo, onSelectCustom,
}: RecommendTemplateModalProps) {
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<{ mode: 'create' | 'edit'; segment?: SavedSegment } | null>(null);

  useEffect(() => {
    if (show) { loadSegments(); setSearch(''); setPage(0); }
  }, [show]);

  const token = () => localStorage.getItem('token');

  const loadSegments = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/saved-segments', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) setSegments(data.segments || []);
    } catch (e) { console.error('세그먼트 로드 실패:', e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      const res = await fetch(`/api/saved-segments/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) setSegments(prev => prev.filter(s => s.id !== id));
    } catch (e) { console.error('삭제 실패:', e); }
    finally { setDeletingId(null); }
  };

  const touchSegment = (id: string) => {
    fetch(`/api/saved-segments/${id}/touch`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } }).catch(() => {});
  };

  const handleSelect = (seg: SavedSegment) => {
    if (seg.id !== '__example__') touchSegment(seg.id);
    if (seg.segment_type === 'hanjullo') {
      onSelectHanjullo(seg.prompt || '');
    } else {
      onSelectCustom({
        selectedFields: seg.selected_fields || ['name'],
        briefing: seg.briefing || '',
        url: seg.url || '',
        channel: seg.channel || 'LMS',
        isAd: seg.is_ad,
      });
    }
  };

  const handleSaveEdit = async (data: any) => {
    try {
      const isEdit = editModal?.mode === 'edit' && editModal.segment;
      const url = isEdit ? `/api/saved-segments/${editModal.segment!.id}` : '/api/saved-segments';
      const method = isEdit ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (result.success) {
        await loadSegments();
        setEditModal(null);
      }
      return result;
    } catch (e) {
      console.error('저장 실패:', e);
      return { success: false };
    }
  };

  if (!show) return null;

  const filtered = segments.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.prompt || '').toLowerCase().includes(q) || (s.briefing || '').toLowerCase().includes(q);
  });

  const displayList = segments.length === 0 && !search ? [DEFAULT_EXAMPLE] : filtered;
  const totalPages = Math.max(1, Math.ceil(displayList.length / CARDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = displayList.slice(currentPage * CARDS_PER_PAGE, (currentPage + 1) * CARDS_PER_PAGE);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-[680px] max-h-[85vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-md:fixed max-md:inset-0 max-md:max-w-none max-md:max-h-none max-md:rounded-none">

        {/* sticky 헤더 */}
        <div className="sticky top-0 z-10 px-6 py-4 bg-gradient-to-r from-slate-950 via-violet-950/40 to-slate-950 backdrop-blur-sm border-b border-white/10 flex justify-between items-center shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30 shrink-0">
              <Bookmark className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-white font-bold text-lg">AI 발송 템플릿</h3>
                <span className="text-xs text-white/40">({segments.length}/20)</span>
              </div>
              <div className="text-xs text-white/50 mt-0.5">저장한 AI 발송 설정을 클릭 한번으로 실행</div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setEditModal({ mode: 'create' })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-xs font-medium rounded-lg transition-all shadow-md shadow-violet-500/30"
            >
              <Plus className="w-3.5 h-3.5" />
              새로 만들기
            </button>
            <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors" aria-label="닫기">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 검색 */}
        <div className="px-6 pt-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="템플릿 검색..."
              className="w-full pl-9 pr-4 py-2.5 text-sm bg-white/5 border border-white/15 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
            />
          </div>
          <p className="text-[11px] text-white/40 mt-2 flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3 text-amber-300 shrink-0" />
            자주 사용하는 AI 발송 설정을 저장하고 클릭 한번으로 바로 실행하세요
          </p>
        </div>

        {/* 카드 리스트 */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-violet-300 animate-spin" />
            </div>
          ) : displayList.length === 0 ? (
            <div className="text-center py-16 text-white/40">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <div className="text-sm font-medium">"{search}"에 대한 결과가 없습니다</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
              {pageItems.map(seg => {
                const isExample = seg.id === '__example__';
                return (
                  <div
                    key={seg.id}
                    onClick={() => handleSelect(seg)}
                    className={`relative p-4 border rounded-xl cursor-pointer transition-all group ${
                      isExample
                        ? 'border-dashed border-white/15 bg-white/5 hover:border-violet-400/40 hover:bg-violet-500/10'
                        : 'border-white/10 bg-white/5 hover:border-violet-400/40 hover:bg-violet-500/10'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0">{seg.emoji}</span>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-white group-hover:text-violet-200 transition-colors truncate">{seg.name}</div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border inline-block mt-0.5 ${
                            seg.segment_type === 'hanjullo'
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30'
                              : 'bg-violet-500/15 text-violet-300 border-violet-400/30'
                          }`}>
                            {seg.segment_type === 'hanjullo' ? 'AI 한줄로' : 'AI 맞춤한줄'}
                          </span>
                        </div>
                      </div>
                      {!isExample && (
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditModal({ mode: 'edit', segment: seg }); }}
                            className="p-1.5 text-white/40 hover:text-violet-300 hover:bg-violet-500/10 rounded-lg transition-colors"
                            aria-label="수정"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(e, seg.id)}
                            disabled={deletingId === seg.id}
                            className="p-1.5 text-white/40 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-colors disabled:opacity-50"
                            aria-label="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-white/50 leading-relaxed line-clamp-2">
                      {seg.segment_type === 'hanjullo'
                        ? `"${seg.prompt}"`
                        : seg.briefing ? seg.briefing.slice(0, 80) : `필드: ${seg.selected_fields?.map(k => FIELD_KEY_DISPLAY_MAP[k] || k).join(', ') || '-'}`
                      }
                    </div>
                    {isExample && (
                      <div className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded font-medium">예시</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 페이징 */}
        {totalPages > 1 && (
          <div className="px-6 py-2 border-t border-white/10 flex items-center justify-center gap-3 shrink-0">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-1.5 text-white/40 hover:text-white disabled:opacity-30 transition-colors"
              aria-label="이전 페이지"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-white/60">{currentPage + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="p-1.5 text-white/40 hover:text-white disabled:opacity-30 transition-colors"
              aria-label="다음 페이지"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 하단 안내 */}
        <div className="px-6 py-3 border-t border-white/10 bg-slate-950/50 shrink-0">
          <div className="flex items-start gap-2 text-xs text-white/40">
            <Lightbulb className="w-3 h-3 text-amber-300 mt-0.5 shrink-0" />
            <span>클릭하면 AI가 바로 실행됩니다. 발송 성공 후에도 설정을 저장할 수 있습니다.</span>
          </div>
          <div className="text-[10px] text-white/30 italic mt-2">
            Data source: AI 발송 템플릿 (saved-segments + customer-filter)
          </div>
        </div>
      </div>

      {/* 수정/생성 sub-modal */}
      {editModal && (
        <EditSegmentModal
          mode={editModal.mode}
          segment={editModal.segment}
          onClose={() => setEditModal(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   EditSegmentModal — 수정/생성 sub-modal (다크 톤 정정)
   ═══════════════════════════════════════ */

function EditSegmentModal({ mode, segment, onClose, onSave }: {
  mode: 'create' | 'edit';
  segment?: SavedSegment;
  onClose: () => void;
  onSave: (data: any) => Promise<any>;
}) {
  const [name, setName] = useState(segment?.name || '');
  const [emoji, setEmoji] = useState(segment?.emoji || '📋');
  const [segmentType, setSegmentType] = useState<'hanjullo' | 'custom'>(segment?.segment_type || 'hanjullo');
  const [prompt, setPrompt] = useState(segment?.prompt || '');
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>(segment?.selected_fields || ['name']);
  const [availableFields, setAvailableFields] = useState<any[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [briefing, setBriefing] = useState(segment?.briefing || '');
  const [url, setUrl] = useState(segment?.url || '');
  const [channel, setChannel] = useState(segment?.channel || 'LMS');
  const [isAd, setIsAd] = useState(segment?.is_ad || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (segmentType === 'custom' && availableFields.length === 0) loadFields();
  }, [segmentType]);

  const loadFields = async () => {
    setFieldsLoading(true);
    try {
      const res = await fetch('/api/customers/enabled-fields', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableFields(data.fields || []);
      }
    } catch (e) { console.error('필드 로드 실패:', e); }
    finally { setFieldsLoading(false); }
  };

  const toggleField = (key: string) => {
    setSelectedFieldKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { setError('템플릿 이름을 입력해주세요.'); return; }
    if (segmentType === 'hanjullo' && !prompt.trim()) { setError('프롬프트를 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    const data: any = {
      name: name.trim(), emoji, segmentType,
      prompt: segmentType === 'hanjullo' ? prompt.trim() : null,
      selectedFields: segmentType === 'custom' ? selectedFieldKeys : null,
      briefing: segmentType === 'custom' ? briefing.trim() || null : null,
      url: url.trim() || null,
      channel: segmentType === 'custom' ? channel : null,
      isAd,
    };
    const result = await onSave(data);
    setSaving(false);
    if (!result.success) setError(result.error || '저장에 실패했습니다.');
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-[520px] max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-150 flex flex-col max-md:fixed max-md:inset-0 max-md:max-w-none max-md:max-h-none max-md:rounded-none"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-6 py-4 bg-gradient-to-r from-slate-950 via-violet-950/40 to-slate-950 backdrop-blur-sm border-b border-white/10 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-md shadow-violet-500/30">
              <Bookmark className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-base font-bold text-white">
              {mode === 'create' ? '새 템플릿 만들기' : '템플릿 편집'}
            </h3>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 hover:bg-white/5 rounded transition-colors" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* 이모지 선택 — 사용자 데이터 영역 (유지) */}
          <div>
            <label className="text-xs font-medium text-white/70 mb-1.5 block">아이콘</label>
            <div className="flex gap-1.5 flex-wrap">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all ${
                    emoji === e
                      ? 'bg-violet-500/20 ring-2 ring-violet-400/50 scale-110'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* 이름 */}
          <div>
            <label className="text-xs font-medium text-white/70 mb-1.5 block">템플릿 이름 *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: VIP 재구매 유도"
              className="w-full px-3 py-2.5 text-sm bg-white/5 border border-white/15 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
              maxLength={50}
            />
          </div>

          {/* 유형 선택 */}
          <div>
            <label className="text-xs font-medium text-white/70 mb-1.5 block">발송 유형</label>
            <div className="flex gap-2">
              <button
                onClick={() => setSegmentType('hanjullo')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  segmentType === 'hanjullo'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-500/30'
                    : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                AI 한줄로
              </button>
              <button
                onClick={() => setSegmentType('custom')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  segmentType === 'custom'
                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/30'
                    : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                AI 맞춤한줄
              </button>
            </div>
          </div>

          {/* AI 한줄로 설정 */}
          {segmentType === 'hanjullo' && (
            <div>
              <label className="text-xs font-medium text-white/70 mb-1.5 block">프롬프트 *</label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="예: 최근 3개월 미구매 VIP 고객에게 봄 신상품 할인 안내 보내줘"
                className="w-full px-3 py-2.5 text-sm bg-white/5 border border-white/15 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-500/20 transition-all resize-none"
                rows={3}
              />
            </div>
          )}

          {/* AI 맞춤한줄 설정 */}
          {segmentType === 'custom' && (
            <>
              <div>
                <label className="text-xs font-medium text-white/70 mb-1.5 block">활용 필드 선택</label>
                {fieldsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 text-violet-300 animate-spin" />
                    <span className="ml-2 text-xs text-white/40">필드 불러오는 중...</span>
                  </div>
                ) : availableFields.length === 0 ? (
                  <p className="text-xs text-white/40 py-2">사용 가능한 필드가 없습니다. 고객 데이터를 먼저 업로드해주세요.</p>
                ) : (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3 max-h-[160px] overflow-y-auto space-y-1">
                    {availableFields.map((f: any) => (
                      <label
                        key={f.field_key}
                        className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                          selectedFieldKeys.includes(f.field_key) ? 'bg-violet-500/10' : 'hover:bg-white/5'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFieldKeys.includes(f.field_key)}
                          onChange={() => toggleField(f.field_key)}
                          className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-violet-500 focus:ring-violet-400/40"
                        />
                        <span className="text-sm text-white/80">{f.display_name || f.field_key}</span>
                        {f.category && <span className="text-[9px] text-white/40 ml-auto">{f.category}</span>}
                      </label>
                    ))}
                  </div>
                )}
                {selectedFieldKeys.length > 0 && (
                  <p className="text-[10px] text-white/40 mt-1.5">{selectedFieldKeys.length}개 선택됨</p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-white/70 mb-1.5 block">프로모션 브리핑</label>
                <textarea
                  value={briefing}
                  onChange={e => setBriefing(e.target.value)}
                  placeholder="프로모션 내용을 상세히 입력하세요"
                  className="w-full px-3 py-2.5 text-sm bg-white/5 border border-white/15 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all resize-none"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">채널</label>
                  <select
                    value={channel}
                    onChange={e => setChannel(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm bg-white/5 border border-white/15 rounded-xl text-white focus:outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
                  >
                    <option value="SMS" className="bg-slate-900">SMS</option>
                    <option value="LMS" className="bg-slate-900">LMS</option>
                    <option value="MMS" className="bg-slate-900">MMS</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-white/70 mb-1.5 block">광고 여부</label>
                  <button
                    onClick={() => setIsAd(!isAd)}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all border ${
                      isAd
                        ? 'bg-amber-500/15 text-amber-200 border-amber-400/30'
                        : 'bg-white/5 text-white/50 border-white/10'
                    }`}
                  >
                    {isAd ? '광고 (광고)+080 포함' : '비광고'}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* URL */}
          <div>
            <label className="text-xs font-medium text-white/70 mb-1.5 block">URL (선택)</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2.5 text-sm bg-white/5 border border-white/15 rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50 focus:ring-2 focus:ring-violet-500/20 transition-all"
            />
          </div>

          {error && (
            <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-lg px-3 py-2 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10 bg-slate-950/50 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white text-sm font-medium rounded-lg transition-all disabled:opacity-50 shadow-md shadow-violet-500/30 flex items-center gap-2"
          >
            {saving ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 저장 중...</>
            ) : (
              mode === 'create' ? '만들기' : '저장'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
