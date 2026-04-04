import { Bookmark, Check, X } from 'lucide-react';
import { useState } from 'react';

interface CampaignSuccessModalProps {
  show: boolean;
  onClose: () => void;
  onShowCalendar: () => void;
  selectedChannel: string;
  aiResult: any;
  successSendInfo: string;
  overrideTargetCount?: number;
  overrideUnsubscribeCount?: number;
  onSaveSegment?: (name: string, emoji: string) => void;
  canSaveSegment?: boolean;
}

const EMOJI_OPTIONS = ['📋', '🎯', '🎂', '🛍️', '📢', '💎', '🏷️', '🔥', '💌', '🎁'];

export default function CampaignSuccessModal({ show, onClose, onShowCalendar, selectedChannel, aiResult, successSendInfo, overrideTargetCount, overrideUnsubscribeCount, onSaveSegment, canSaveSegment }: CampaignSuccessModalProps) {
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [segmentName, setSegmentName] = useState('');
  const [segmentEmoji, setSegmentEmoji] = useState('📋');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!show) return null;

  const displayCount = overrideTargetCount ?? aiResult?.target?.count ?? 0;
  const displayUnsub = overrideUnsubscribeCount ?? aiResult?.target?.unsubscribeCount ?? 0;

  const handleSave = async () => {
    if (!segmentName.trim() || !onSaveSegment) return;
    setSaving(true);
    try {
      await onSaveSegment(segmentName.trim(), segmentEmoji);
      setSaved(true);
      setTimeout(() => setShowSaveForm(false), 1500);
    } catch {
      // 에러는 Dashboard에서 토스트로 처리
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm text-center overflow-hidden animate-zoomIn">
        <div className="px-8 pt-8 pb-2">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🎉</span>
          </div>
          <h3 className="text-xl font-bold text-gray-800 mb-1">캠페인이 확정되었습니다!</h3>
          <p className="text-sm text-gray-500 mb-5">발송이 정상적으로 등록되었습니다</p>
        </div>
        <div className="mx-6 mb-4 bg-green-50 rounded-xl p-4 text-left">
          <div className="text-sm text-gray-600 space-y-2">
            <div className="flex items-center gap-2">
              <span>{selectedChannel === 'KAKAO' ? '💬' : '📱'}</span>
              <span>채널:</span>
              <span className="font-semibold text-gray-800">{selectedChannel === 'KAKAO' ? '카카오' : selectedChannel}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>👥</span>
              <span>대상:</span>
              <span className="font-semibold text-gray-800">{displayCount.toLocaleString()}명</span>
            </div>
            {displayUnsub > 0 && (
              <div className="flex items-center gap-2">
                <span>🚫</span>
                <span>수신거부 제외:</span>
                <span className="font-semibold text-rose-500">{displayUnsub.toLocaleString()}명</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span>⏰</span>
              <span>발송:</span>
              <span className="font-semibold text-gray-800">{successSendInfo}</span>
            </div>
          </div>
        </div>

        {/* 저장 세그먼트 영역 */}
        {canSaveSegment && onSaveSegment && !saved && (
          <div className="mx-6 mb-4">
            {!showSaveForm ? (
              <button
                onClick={() => setShowSaveForm(true)}
                className="w-full py-2.5 px-4 border border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-green-400 hover:text-green-700 hover:bg-green-50/50 transition-all flex items-center justify-center gap-2"
              >
                <Bookmark className="w-4 h-4" />
                이 설정을 저장하기
              </button>
            ) : (
              <div className="border border-green-200 rounded-xl p-3 bg-green-50/30 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex gap-2">
                  <div className="flex gap-1 flex-wrap">
                    {EMOJI_OPTIONS.map(e => (
                      <button
                        key={e}
                        onClick={() => setSegmentEmoji(e)}
                        className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all ${
                          segmentEmoji === e ? 'bg-green-200 ring-2 ring-green-400' : 'hover:bg-gray-100'
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={segmentName}
                    onChange={(e) => setSegmentName(e.target.value)}
                    placeholder="세그먼트 이름 (예: VIP 재구매)"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                    maxLength={50}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                    autoFocus
                  />
                  <button
                    onClick={handleSave}
                    disabled={!segmentName.trim() || saving}
                    className="px-4 py-2 bg-green-700 text-white text-sm rounded-lg hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {saving ? '...' : '저장'}
                  </button>
                  <button
                    onClick={() => setShowSaveForm(false)}
                    className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 저장 완료 표시 */}
        {saved && (
          <div className="mx-6 mb-4 flex items-center justify-center gap-2 text-sm text-green-600 bg-green-50 rounded-xl py-2.5">
            <Check className="w-4 h-4" />
            세그먼트가 저장되었습니다
          </div>
        )}

        <div className="flex border-t">
          <button
            onClick={onShowCalendar}
            className="flex-1 py-3.5 text-gray-600 hover:bg-gray-50 font-medium transition-colors"
          >
            📅 캘린더 확인
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3.5 bg-green-700 text-white font-medium hover:bg-green-800 transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
