interface Props {
  alert: { show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' };
  onClose: () => void;
}

export default function AlertModal({ alert, onClose }: Props) {
  if (!alert.show) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
        <div className="text-center mb-4">
          <div className="text-3xl mb-2">{alert.type === 'success' ? '✅' : alert.type === 'error' ? '❌' : 'ℹ️'}</div>
          <h3 className="text-lg font-bold text-gray-800">{alert.title}</h3>
          <p className="text-sm text-gray-500 mt-1">{alert.message}</p>
        </div>
        <button onClick={onClose} className="w-full py-2.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors text-sm font-medium">확인</button>
      </div>
    </div>
  );
}
