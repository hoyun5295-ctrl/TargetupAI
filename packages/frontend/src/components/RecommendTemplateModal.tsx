import { Bookmark, Rocket, Sparkles, Trash2, X } from 'lucide-react';
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

const DEFAULT_TEMPLATES = [
  { emoji: '🎯', name: 'VIP 재구매 유도', prompt: '최근 3개월 미구매 VIP 고객에게 봄 신상품 할인 안내 보내줘' },
  { emoji: '🎂', name: '생일 축하 발송', prompt: '이번 달 생일인 고객에게 생일 축하 쿠폰 발송해줘' },
  { emoji: '🛍️', name: '첫 구매 감사', prompt: '최근 1주일 내 첫 구매 고객에게 감사 메시지 + 재방문 쿠폰 보내줘' },
  { emoji: '📢', name: '전체 프로모션', prompt: '전체 고객 대상 주말 특가 세일 안내 보내줘' },
];

export default function RecommendTemplateModal({ show, onClose, onSelectHanjullo, onSelectCustom }: RecommendTemplateModalProps) {
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (show) loadSegments();
  }, [show]);

  const loadSegments = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/saved-segments', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (data.success) setSegments(data.segments || []);
    } catch (e) {
      console.error('세그먼트 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSegment = async (e: React.MouseEvent, segmentId: string) => {
    e.stopPropagation();
    setDeletingId(segmentId);
    try {
      const res = await fetch(`/api/saved-segments/${segmentId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (data.success) {
        setSegments(prev => prev.filter(s => s.id !== segmentId));
      }
    } catch (e) {
      console.error('세그먼트 삭제 실패:', e);
    } finally {
      setDeletingId(null);
    }
  };

  const touchSegment = (segmentId: string) => {
    fetch(`/api/saved-segments/${segmentId}/touch`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
    }).catch(() => {});
  };

  const handleSelectSegment = (segment: SavedSegment) => {
    touchSegment(segment.id);
    if (segment.segment_type === 'hanjullo') {
      onSelectHanjullo(segment.prompt || '', segment.auto_relax);
    } else {
      onSelectCustom({
        selectedFields: segment.selected_fields || ['name'],
        briefing: segment.briefing || '',
        url: segment.url || '',
        channel: segment.channel || 'LMS',
        isAd: segment.is_ad,
      });
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[620px] max-h-[85vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <Bookmark className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-bold text-gray-800">빠른 발송</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 space-y-6">
          {/* 기본 예시 섹션 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Rocket className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-500">기본 예시</span>
              <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">AI 한줄로</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {DEFAULT_TEMPLATES.map((t, idx) => (
                <div
                  key={idx}
                  onClick={() => onSelectHanjullo(t.prompt)}
                  className="p-3.5 border border-gray-200 rounded-xl hover:border-green-400 hover:bg-green-50/50 cursor-pointer transition-all group"
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <span className="text-lg">{t.emoji}</span>
                    <span className="font-semibold text-sm text-gray-800 group-hover:text-green-700 transition-colors">{t.name}</span>
                  </div>
                  <div className="text-xs text-gray-400 leading-relaxed line-clamp-2">"{t.prompt}"</div>
                </div>
              ))}
            </div>
          </div>

          {/* 내 저장 세그먼트 섹션 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-500">내 저장 세그먼트</span>
              <span className="text-xs text-gray-400">({segments.length}/20)</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8 text-gray-400">
                <div className="animate-spin w-5 h-5 border-2 border-gray-300 border-t-green-500 rounded-full" />
              </div>
            ) : segments.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <div className="text-sm">저장된 세그먼트가 없습니다</div>
                <div className="text-xs mt-1">발송 성공 후 설정을 저장하면 여기에 표시됩니다</div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {segments.map((seg) => (
                  <div
                    key={seg.id}
                    onClick={() => handleSelectSegment(seg)}
                    className="p-3.5 border border-gray-200 rounded-xl hover:border-green-400 hover:bg-green-50/30 cursor-pointer transition-all group relative"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-lg shrink-0">{seg.emoji}</span>
                        <span className="font-semibold text-sm text-gray-800 group-hover:text-green-700 transition-colors truncate">
                          {seg.name}
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                          seg.segment_type === 'hanjullo'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}>
                          {seg.segment_type === 'hanjullo' ? 'AI 한줄로' : 'AI 맞춤한줄'}
                        </span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteSegment(e, seg.id)}
                        disabled={deletingId === seg.id}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="text-xs text-gray-400 mt-1 pl-8 leading-relaxed line-clamp-1">
                      {seg.segment_type === 'hanjullo'
                        ? `"${seg.prompt}"`
                        : seg.briefing
                          ? `${seg.briefing.slice(0, 60)}${seg.briefing.length > 60 ? '...' : ''}`
                          : `필드: ${seg.selected_fields?.join(', ') || '-'}`
                      }
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 하단 안내 */}
        <div className="px-6 py-3 border-t bg-gray-50 shrink-0">
          <div className="flex items-start gap-2 text-xs text-gray-400">
            <span className="mt-0.5">💡</span>
            <span>예시를 선택하면 AI가 바로 실행됩니다. 저장 세그먼트는 발송 성공 후 저장할 수 있습니다.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
