import { useState } from 'react';

/**
 * MessageDetailModal — 메시지 전체 표시 + 복사 버튼 모달
 *
 * 용도: 슈퍼관리자 발송 상세 내역 모달의 메시지 셀 클릭 시 표시
 *       (예약관리 + 캠페인관리 [조회] 버튼이 모두 동일 발송 상세 내역 모달을 여니
 *        한 컴포넌트가 두 탭 모두 커버)
 *
 * Props:
 * - content: 표시할 메시지 본문. null이면 모달 비표시.
 * - onClose: 닫기 핸들러
 */
interface Props {
  content: string | null;
  onClose: () => void;
}

export default function MessageDetailModal({ content, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  if (content === null) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 폴백: deprecated API
      const ta = document.createElement('textarea');
      ta.value = content;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">📨 메시지 내용</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          <pre className="whitespace-pre-wrap break-words text-sm text-gray-800 font-sans bg-gray-50 rounded-lg p-4 border">
            {content}
          </pre>
        </div>

        <div className="px-5 py-3 border-t bg-gray-50 flex items-center justify-end gap-2">
          <span className="text-xs text-gray-500 mr-auto">
            {content.length.toLocaleString()}자
          </span>
          <button
            onClick={handleCopy}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              copied
                ? 'bg-green-600 text-white'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {copied ? '✓ 복사됨' : '복사'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
