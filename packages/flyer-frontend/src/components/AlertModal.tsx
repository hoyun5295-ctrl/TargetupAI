interface Props {
  alert: { show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' };
  onClose: () => void;
}

export default function AlertModal({ alert, onClose }: Props) {
  if (!alert.show) return null;

  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const btnColors = {
    success: 'bg-primary-600 hover:bg-primary-700',
    error: 'bg-error-600 hover:bg-error-500',
    info: 'bg-primary-600 hover:bg-primary-700',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-[2px]">
      <div className="bg-surface rounded-2xl shadow-modal max-w-sm w-full mx-4 p-6 animate-in zoom-in-95 duration-200">
        <div className="text-center mb-5">
          <div className="w-12 h-12 rounded-full bg-bg flex items-center justify-center text-2xl mx-auto mb-3">{icons[alert.type]}</div>
          <h3 className="text-base font-bold text-text">{alert.title}</h3>
          <p className="text-sm text-text-secondary mt-1.5 leading-relaxed whitespace-pre-wrap">{alert.message}</p>
        </div>
        <button onClick={onClose} className={`w-full py-2.5 text-white rounded-xl text-sm font-semibold transition-colors ${btnColors[alert.type]}`}>확인</button>
      </div>
    </div>
  );
}
