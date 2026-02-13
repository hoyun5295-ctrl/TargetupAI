import { useEffect } from 'react';

interface ModalProps {
  show: boolean;
  title: string;
  message: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
  type?: 'alert' | 'confirm' | 'password';
  password?: string;
  smsSent?: boolean;
  phone?: string;
  copyText?: string;
  onClose: () => void;
  onConfirm?: () => void;
}

const ICONS: Record<string, string> = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
};

const COLORS: Record<string, { bg: string; btn: string }> = {
  success: { bg: 'bg-green-50', btn: 'bg-green-600 hover:bg-green-700' },
  error: { bg: 'bg-red-50', btn: 'bg-red-600 hover:bg-red-700' },
  warning: { bg: 'bg-amber-50', btn: 'bg-amber-600 hover:bg-amber-700' },
  info: { bg: 'bg-blue-50', btn: 'bg-blue-600 hover:bg-blue-700' },
};

export default function CustomModal({
  show, title, message, variant = 'info', type = 'alert',
  password, smsSent, phone, copyText,
  onClose, onConfirm,
}: ModalProps) {
  useEffect(() => {
    if (show) {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter' && type === 'alert') onClose();
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [show, type, onClose]);

  if (!show) return null;

  const colors = COLORS[variant] || COLORS.info;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-[fadeIn_0.15s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-[zoomIn_0.2s_ease-out]">
        {/* 아이콘 + 제목 */}
        <div className={`px-6 pt-6 pb-4 ${colors.bg}`}>
          <div className="text-center">
            <span className="text-3xl">{ICONS[variant]}</span>
            <h3 className="mt-2 text-lg font-bold text-gray-900">{title}</h3>
          </div>
        </div>

        {/* 내용 */}
        <div className="px-6 py-4">
          <p className="text-sm text-gray-600 text-center whitespace-pre-line">{message}</p>

          {/* 비밀번호 표시 */}
          {password && (
            <div className="mt-3 bg-gray-50 border rounded-lg p-3 flex items-center justify-between">
              <code className="text-lg font-mono font-bold text-blue-600">{password}</code>
              <button
                onClick={() => handleCopy(password)}
                className="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded"
              >
                복사
              </button>
            </div>
          )}

          {smsSent !== undefined && (
            <p className="mt-2 text-xs text-center text-gray-500">
              {smsSent ? `📱 ${phone || ''} SMS 발송 완료` : '📱 SMS 미발송 (번호 미등록)'}
            </p>
          )}
        </div>

        {/* 버튼 */}
        <div className="px-6 pb-6 flex gap-3">
          {type === 'confirm' && (
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
            >
              취소
            </button>
          )}
          <button
            onClick={type === 'confirm' ? onConfirm : onClose}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium text-white transition ${colors.btn}`}
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
