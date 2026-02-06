import { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error';
  onClose: () => void;
}

export default function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed top-6 right-6 z-50 animate-[slideIn_0.3s_ease-out]">
      <div className={`flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${
        type === 'success' ? 'bg-green-600' : 'bg-red-600'
      }`}>
        <span>{type === 'success' ? '✅' : '❌'}</span>
        <span>{message}</span>
      </div>
    </div>
  );
}
