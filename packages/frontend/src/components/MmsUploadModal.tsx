import React from 'react';

interface MmsUploadModalProps {
  show: boolean;
  onClose: () => void;
  mmsUploadedImages: {serverPath: string; url: string; filename: string; size: number}[];
  mmsUploading: boolean;
  handleMmsSlotUpload: (file: File, slotIdx: number) => void;
  handleMmsMultiUpload: (files: FileList) => void;
  handleMmsImageRemove: (index: number) => void;
  setTargetMsgType: (t: 'SMS' | 'LMS' | 'MMS') => void;
  setDirectMsgType: (t: 'SMS' | 'LMS' | 'MMS') => void;
  setSelectedChannel: (ch: string) => void;
}

export default function MmsUploadModal({
  show,
  onClose,
  mmsUploadedImages,
  mmsUploading,
  handleMmsSlotUpload,
  handleMmsMultiUpload,
  handleMmsImageRemove,
  setTargetMsgType,
  setDirectMsgType,
  setSelectedChannel,
}: MmsUploadModalProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]">
      <div className="bg-white rounded-2xl shadow-2xl w-[520px] overflow-hidden animate-in fade-in zoom-in">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-xl">🖼️</span>
            <h3 className="font-bold text-lg text-gray-800">MMS 이미지 첨부</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* 규격 안내 */}
        <div className="px-6 py-3 bg-blue-50 border-b">
          <div className="text-sm font-semibold text-blue-700 mb-1">📋 이미지 규격 안내</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-blue-600">
            <div>• 파일 형식: <span className="font-bold">JPG/JPEG만</span> 가능</div>
            <div>• 최대 용량: <span className="font-bold">300KB 이하</span> (이통사 권장)</div>
            <div>• 최대 장수: <span className="font-bold">3장</span> (이통사 보장)</div>
            <div>• PNG/GIF: 이통사 거절 가능 (미지원)</div>
          </div>
        </div>

        {/* 3칸 슬롯 */}
        <div className="p-6">
          {/* 다중 선택 버튼 */}
          {mmsUploadedImages.length < 3 && (
            <label className={`flex items-center justify-center gap-2 mb-4 py-3 border-2 border-dashed border-amber-300 rounded-xl bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <span className="text-lg">📎</span>
              <span className="text-sm font-medium text-amber-700">여러 장 한번에 첨부 (최대 {3 - mmsUploadedImages.length}장)</span>
              <input
                type="file"
                accept=".jpg,.jpeg"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) handleMmsMultiUpload(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map(slotIdx => {
              const img = mmsUploadedImages[slotIdx];
              // ★ B3(0417 PDF #3): 파일명 라벨 표시 — 통계(ResultsModal)와 동일한 원본 파일명
              const filenameDisplay = img ? (img.originalName || img.filename || `이미지 ${slotIdx + 1}`) : '';
              return (
                <div key={slotIdx} className="flex flex-col">
                  <div className="aspect-square relative">
                    {img ? (
                      /* 업로드 완료 슬롯 */
                      <div className="w-full h-full rounded-xl border-2 border-green-300 bg-green-50 overflow-hidden relative group">
                        <img
                          src={img.url}
                          alt={filenameDisplay}
                          title={filenameDisplay}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <button
                            onClick={() => handleMmsImageRemove(slotIdx)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-500 hover:bg-red-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-lg"
                          >×</button>
                        </div>
                        <div className="absolute bottom-1 right-1 bg-green-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                          {(img.size / 1024).toFixed(0)}KB
                        </div>
                        <div className="absolute top-1 left-1 bg-green-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                          {slotIdx + 1}
                        </div>
                      </div>
                    ) : (
                      /* 빈 슬롯 */
                      <label className={`w-full h-full rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center cursor-pointer hover:border-amber-400 hover:bg-amber-50 transition-all ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                        <div className="text-3xl text-gray-300 mb-2">+</div>
                        <div className="text-xs text-gray-400 font-medium">이미지 {slotIdx + 1}</div>
                        <div className="text-[10px] text-gray-300 mt-1">JPG · 300KB</div>
                        <input
                          type="file"
                          accept=".jpg,.jpeg"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleMmsSlotUpload(file, slotIdx);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                  {/* ★ B3: 이미지 하단 파일명 — 동일 이미지/변경 여부 식별용 */}
                  <div
                    className="mt-1 text-[11px] text-gray-600 text-center truncate px-1 min-h-[18px]"
                    title={filenameDisplay}
                  >
                    {filenameDisplay}
                  </div>
                </div>
              );
            })}
          </div>

          {mmsUploading && (
            <div className="flex items-center justify-center gap-2 mt-4 text-sm text-amber-600">
              <span className="animate-spin">⏳</span> 이미지 업로드 중...
            </div>
          )}
        </div>

        {/* 안내 + 확인 */}
        <div className="px-6 pb-6 space-y-3">
          <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3 text-center">
            ⚠️ 실제 수신 화면은 이통사 및 휴대폰 기종에 따라 다르게 보일 수 있습니다
          </div>
          <button
            onClick={() => {
              onClose();
              // 이미지가 있으면 자동 MMS 전환
              if (mmsUploadedImages.length > 0) {
                setTargetMsgType('MMS');
                setDirectMsgType('MMS');
                setSelectedChannel('MMS');
              }
            }}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors"
          >
            {mmsUploadedImages.length > 0 ? `✅ ${mmsUploadedImages.length}장 첨부 완료` : '확인'}
          </button>
        </div>
      </div>
    </div>
  );
}
