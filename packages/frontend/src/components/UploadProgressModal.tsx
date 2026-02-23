import React from 'react';

interface UploadProgressModalProps {
  show: boolean;
  uploadProgress: {
    status: string;
    total: number;
    processed: number;
    percent: number;
    insertCount: number;
    duplicateCount: number;
    errorCount: number;
    message: string;
  };
  onClose: () => void;
}

export default function UploadProgressModal({
  show,
  uploadProgress,
  onClose,
}: UploadProgressModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-in zoom-in-95 duration-300">
        {/* 헤더 */}
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
              uploadProgress.status === 'completed' ? 'bg-green-100' :
              uploadProgress.status === 'failed' ? 'bg-red-100' : 'bg-blue-100'
            }`}>
              {uploadProgress.status === 'completed' ? '✅' : uploadProgress.status === 'failed' ? '❌' : '📤'}
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {uploadProgress.status === 'completed' ? '업로드 완료' :
                 uploadProgress.status === 'failed' ? '업로드 오류' : '고객 데이터 업로드 중'}
              </h3>
            </div>
          </div>
        </div>

        {/* 프로그레스바 */}
        <div className="px-6 py-3">
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                uploadProgress.status === 'completed' ? 'bg-green-500' :
                uploadProgress.status === 'failed' ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{ width: `${uploadProgress.percent || 0}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-sm text-gray-500">
            <span>{(uploadProgress.processed || 0).toLocaleString()} / {(uploadProgress.total || 0).toLocaleString()}건</span>
            <span className="font-semibold">{uploadProgress.percent || 0}%</span>
          </div>
        </div>

        {/* 상세 정보 */}
        <div className="px-6 py-3 space-y-2">
          {(uploadProgress.insertCount > 0 || uploadProgress.duplicateCount > 0 || uploadProgress.errorCount > 0) && (
            <div className="flex gap-4 text-sm">
              {uploadProgress.insertCount > 0 && (
                <span className="text-blue-600">✅ 신규 <strong>{(uploadProgress.insertCount || 0).toLocaleString()}</strong>건</span>
              )}
              {uploadProgress.duplicateCount > 0 && (
                <span className="text-green-600">🔄 중복(업데이트) <strong>{(uploadProgress.duplicateCount || 0).toLocaleString()}</strong>건</span>
              )}
              {uploadProgress.errorCount > 0 && (
                <span className="text-orange-500">⚠️ 오류 <strong>{(uploadProgress.errorCount || 0).toLocaleString()}</strong>건</span>
              )}
            </div>
          )}
          
          {uploadProgress.status === 'processing' && (
            <div className="flex items-center gap-2 text-sm text-gray-500 bg-blue-50 rounded-lg px-3 py-2">
              <span>💡</span>
              <span>브라우저를 닫아도 처리는 계속됩니다</span>
            </div>
          )}
          
          {uploadProgress.status === 'failed' && uploadProgress.message && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {uploadProgress.message}
            </div>
          )}

          {uploadProgress.status === 'completed' && uploadProgress.message && (
            <div className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
              {uploadProgress.message}
            </div>
          )}
        </div>

        {/* 버튼 */}
        {(uploadProgress.status === 'completed' || uploadProgress.status === 'failed') && (
          <div className="px-6 pb-6 pt-2">
            <button
              onClick={onClose}
              className={`w-full py-3 rounded-xl font-semibold text-white transition-colors ${
                uploadProgress.status === 'completed' ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-600 hover:bg-gray-700'
              }`}
            >
              확인
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
