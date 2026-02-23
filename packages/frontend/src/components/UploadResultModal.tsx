interface UploadResultModalProps {
  show: boolean;
  uploadResult: { insertCount: number; duplicateCount: number };
  onClose: () => void;
}

export default function UploadResultModal({ show, uploadResult, onClose }: UploadResultModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <div className="text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h3 className="text-2xl font-bold text-gray-800 mb-4">저장 완료!</h3>
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <div className="flex justify-between py-2 border-b border-gray-200">
              <span className="text-gray-600">신규 추가</span>
              <span className="font-bold text-blue-600">{uploadResult.insertCount.toLocaleString()}건</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-600">중복 (스킵)</span>
              <span className="font-bold text-orange-500">{uploadResult.duplicateCount.toLocaleString()}건</span>
            </div>
          </div>
          <button
            onClick={() => { onClose(); window.location.reload(); }}
            className="w-full py-3 bg-green-700 text-white rounded-xl font-medium hover:bg-green-800"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
