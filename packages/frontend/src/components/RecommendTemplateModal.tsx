import { Bookmark, ChevronLeft, ChevronRight, Pencil, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SavedSegment {
  id: string;
  name: string;
  emoji: string;
  segment_type: 'hanjullo' | 'custom';
  prompt: string | null;
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
  onSelectHanjullo: (prompt: string, autoRelax?: boolean) => void;
  onSelectCustom: (preloadData: CustomPreloadData) => void;
}

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

export default function RecommendTemplateModal({ show, onClose, onSelectHanjullo, onSelectCustom }: RecommendTemplateModalProps) {
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 수정/생성 모달
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
      onSelectHanjullo(seg.prompt || '', seg.auto_relax);
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

  // 검색 필터
  const filtered = segments.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.prompt || '').toLowerCase().includes(q) || (s.briefing || '').toLowerCase().includes(q);
  });

  // 예시 카드 포함: 세그먼트 0개이면 예시 1개 표시
  const displayList = segments.length === 0 && !search ? [DEFAULT_EXAMPLE] : filtered;
  const totalPages = Math.max(1, Math.ceil(displayList.length / CARDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = displayList.slice(currentPage * CARDS_PER_PAGE, (currentPage + 1) * CARDS_PER_PAGE);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[680px] max-h-[85vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-bold text-gray-800">AI 발송 템플릿</h3>
            <span className="text-xs text-gray-400">({segments.length}/20)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditModal({ mode: 'create' })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-medium rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              새로 만들기
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 검색 */}
        <div className="px-6 pt-4 pb-2 shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              placeholder="템플릿 검색..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent bg-gray-50"
            />
          </div>
          <p className="text-xs text-gray-400 mt-2">자주 사용하는 AI 발송 설정을 저장하고 클릭 한번으로 바로 실행하세요</p>
        </div>

        {/* 카드 리스트 */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-green-500 rounded-full" />
            </div>
          ) : displayList.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <div className="text-sm font-medium">"{search}"에 대한 결과가 없습니다</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {pageItems.map(seg => {
                const isExample = seg.id === '__example__';
                return (
                  <div
                    key={seg.id}
                    onClick={() => handleSelect(seg)}
                    className={`relative p-4 border rounded-xl cursor-pointer transition-all group ${
                      isExample
                        ? 'border-dashed border-gray-300 bg-gray-50/50 hover:border-green-300 hover:bg-green-50/30'
                        : 'border-gray-200 hover:border-green-400 hover:bg-green-50/30'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0">{seg.emoji}</span>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-gray-800 group-hover:text-green-700 transition-colors truncate">{seg.name}</div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            seg.segment_type === 'hanjullo' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'
                          }`}>
                            {seg.segment_type === 'hanjullo' ? 'AI 한줄로' : 'AI 맞춤한줄'}
                          </span>
                        </div>
                      </div>
                      {!isExample && (
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditModal({ mode: 'edit', segment: seg }); }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => handleDelete(e, seg.id)}
                            disabled={deletingId === seg.id}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 leading-relaxed line-clamp-2">
                      {seg.segment_type === 'hanjullo'
                        ? `"${seg.prompt}"`
                        : seg.briefing ? seg.briefing.slice(0, 80) : `필드: ${seg.selected_fields?.join(', ') || '-'}`
                      }
                    </div>
                    {isExample && (
                      <div className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-600 rounded font-medium">예시</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 페이징 */}
        {totalPages > 1 && (
          <div className="px-6 py-2 border-t flex items-center justify-center gap-3 shrink-0">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
              className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-500">{currentPage + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
              className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 하단 */}
        <div className="px-6 py-3 border-t bg-gray-50 shrink-0">
          <div className="flex items-start gap-2 text-xs text-gray-400">
            <span className="mt-0.5">💡</span>
            <span>클릭하면 AI가 바로 실행됩니다. 발송 성공 후에도 설정을 저장할 수 있습니다.</span>
          </div>
        </div>
      </div>

      {/* 수정/생성 모달 */}
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
   수정/생성 모달
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
  const [selectedFields, setSelectedFields] = useState<string>(segment?.selected_fields?.join(', ') || 'name');
  const [briefing, setBriefing] = useState(segment?.briefing || '');
  const [url, setUrl] = useState(segment?.url || '');
  const [channel, setChannel] = useState(segment?.channel || 'LMS');
  const [isAd, setIsAd] = useState(segment?.is_ad || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) { setError('템플릿 이름을 입력해주세요.'); return; }
    if (segmentType === 'hanjullo' && !prompt.trim()) { setError('프롬프트를 입력해주세요.'); return; }
    setSaving(true);
    setError('');
    const data: any = {
      name: name.trim(), emoji, segmentType,
      prompt: segmentType === 'hanjullo' ? prompt.trim() : null,
      selectedFields: segmentType === 'custom' ? selectedFields.split(',').map((s: string) => s.trim()).filter(Boolean) : null,
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] overflow-hidden animate-in fade-in zoom-in duration-150"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-green-600" />
            <h3 className="text-base font-bold text-gray-800">
              {mode === 'create' ? '새 템플릿 만들기' : '템플릿 편집'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 이모지 선택 */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">아이콘</label>
            <div className="flex gap-1.5 flex-wrap">
              {EMOJI_OPTIONS.map(e => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all ${
                    emoji === e ? 'bg-green-100 ring-2 ring-green-400 scale-110' : 'hover:bg-gray-100'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* 이름 */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">템플릿 이름 *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="예: VIP 재구매 유도"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400"
              maxLength={50}
            />
          </div>

          {/* 유형 선택 */}
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">발송 유형</label>
            <div className="flex gap-2">
              <button
                onClick={() => setSegmentType('hanjullo')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  segmentType === 'hanjullo'
                    ? 'bg-green-700 text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                AI 한줄로
              </button>
              <button
                onClick={() => setSegmentType('custom')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  segmentType === 'custom'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                AI 맞춤한줄
              </button>
            </div>
          </div>

          {/* AI 한줄로 설정 */}
          {segmentType === 'hanjullo' && (
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1.5 block">프롬프트 *</label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="예: 최근 3개월 미구매 VIP 고객에게 봄 신상품 할인 안내 보내줘"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
                rows={3}
              />
            </div>
          )}

          {/* AI 맞춤한줄 설정 */}
          {segmentType === 'custom' && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1.5 block">활용 필드 (쉼표 구분)</label>
                <input
                  type="text"
                  value={selectedFields}
                  onChange={e => setSelectedFields(e.target.value)}
                  placeholder="name, grade, points"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
                <p className="text-[10px] text-gray-400 mt-1">예: name, grade, points, birth_date</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1.5 block">프로모션 브리핑</label>
                <textarea
                  value={briefing}
                  onChange={e => setBriefing(e.target.value)}
                  placeholder="프로모션 내용을 상세히 입력하세요"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600 mb-1.5 block">채널</label>
                  <select
                    value={channel}
                    onChange={e => setChannel(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-400"
                  >
                    <option value="SMS">SMS</option>
                    <option value="LMS">LMS</option>
                    <option value="MMS">MMS</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-medium text-gray-600 mb-1.5 block">광고 여부</label>
                  <button
                    onClick={() => setIsAd(!isAd)}
                    className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all ${
                      isAd ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-gray-100 text-gray-500'
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
            <label className="text-xs font-medium text-gray-600 mb-1.5 block">URL (선택)</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400"
            />
          </div>

          {error && <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">취소</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-5 py-2 bg-green-700 hover:bg-green-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? '저장 중...' : mode === 'create' ? '만들기' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
