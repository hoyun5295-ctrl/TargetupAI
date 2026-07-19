import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, X, Paperclip, Lock, Plus, Loader2, AlertTriangle, FolderOpen } from 'lucide-react';
import { getMmsImageDisplayName } from '../utils/mmsImage';
import AssetLibraryPickerModal from './assets/AssetLibraryPickerModal';

interface MmsUploadModalProps {
  show: boolean;
  onClose: () => void;
  mmsUploadedImages: { serverPath: string; url: string; filename: string; originalName?: string; size: number }[];
  mmsUploading: boolean;
  handleMmsSlotUpload: (file: File, slotIdx: number) => void;
  handleMmsMultiUpload: (files: FileList) => void;
  handleMmsImageRemove: (index: number) => void;
  /** 확인 클릭 시 콜백 — 첨부 장수 전달. 소비처가 채널 전환 등을 결정한다 (직접발송=MMS 3채널 동기화 / AI Operator=channelOverride). */
  onConfirm?: (imageCount: number) => void;
  /** 업로드 검증 실패 등 모달 내부에 표시할 안내 (선택) */
  errorMessage?: string | null;
  /** ★ 2026-07-19 P4: 라이브러리 소재 → MMS 자동 변환 첨부 (useMmsUpload.handleMmsFromAsset). 미전달 = 버튼 미노출(하위호환). */
  handleMmsFromAsset?: (assetId: string) => void;
}

/**
 * MMS 이미지 첨부 모달 — 다크 모던 (앱 표준: bg-slate-900 + border-white/10 + rounded-2xl + shadow-2xl).
 * 직접발송(Dashboard) + AI Operator 공용. 확인 콜백은 onConfirm(count) 하나로 일반화.
 */
export default function MmsUploadModal({
  show,
  onClose,
  mmsUploadedImages,
  mmsUploading,
  handleMmsSlotUpload,
  handleMmsMultiUpload,
  handleMmsImageRemove,
  onConfirm,
  errorMessage,
  handleMmsFromAsset,
}: MmsUploadModalProps) {
  // ★ 훅은 조기 return 위에 (조건부 렌더 컴포넌트 훅 개수 불일치 크래시 차단 — 2026-07-06 교훈)
  const [libOpen, setLibOpen] = useState(false);

  if (!show) return null;

  const remaining = 3 - mmsUploadedImages.length;

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 shadow-2xl animate-in fade-in zoom-in duration-200">
        {/* 헤더 */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/95 backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/20">
              <ImageIcon className="w-4.5 h-4.5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">MMS 이미지 첨부</h3>
              <p className="text-[11px] text-white/45">이미지를 담아 비주얼 메시지로 발송</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 규격 안내 */}
        <div className="px-6 py-3 border-b border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-white/55">
            <div className="flex items-center gap-1.5"><span className="text-violet-300">•</span> 형식 <span className="font-semibold text-white/85">JPG/JPEG</span></div>
            <div className="flex items-center gap-1.5"><span className="text-violet-300">•</span> 용량 <span className="font-semibold text-white/85">300KB 이하</span></div>
            <div className="flex items-center gap-1.5"><span className="text-violet-300">•</span> 최대 <span className="font-semibold text-white/85">3장</span></div>
            <div className="flex items-center gap-1.5"><span className="text-white/25">•</span> <span className="text-white/40">PNG/GIF 미지원</span></div>
          </div>
        </div>

        {/* 슬롯 영역 */}
        <div className="p-6">
          {errorMessage && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* ★ P4: 라이브러리 소재 자동 변환 첨부 — 고품질 소재를 서버가 ≤300KB JPG로 변환 */}
          {handleMmsFromAsset && mmsUploadedImages.length < 3 && (
            <button
              onClick={() => setLibOpen(true)}
              disabled={mmsUploading}
              className={`w-full flex items-center justify-center gap-2 mb-3 py-3 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12] hover:border-emerald-400/50 transition-colors ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <FolderOpen className="w-4 h-4 text-emerald-300" />
              <span className="text-sm font-medium text-emerald-200">라이브러리에서 가져오기 <span className="text-emerald-300/60 text-xs">(MMS 규격 자동 변환)</span></span>
            </button>
          )}

          {/* 다중 첨부 */}
          {mmsUploadedImages.length < 3 && (
            <label className={`flex items-center justify-center gap-2 mb-4 py-3 rounded-xl border-2 border-dashed border-violet-400/40 bg-violet-500/[0.06] cursor-pointer hover:bg-violet-500/[0.12] hover:border-violet-400/60 transition-colors ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <Paperclip className="w-4 h-4 text-violet-300" />
              <span className="text-sm font-medium text-violet-200">여러 장 한번에 첨부 (최대 {remaining}장)</span>
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

          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map(slotIdx => {
              const img = mmsUploadedImages[slotIdx];
              const filenameDisplay = img ? getMmsImageDisplayName(img, `이미지 ${slotIdx + 1}`) : '';
              // 빈 앞슬롯 존재 시 뒷슬롯 잠금 — "왼쪽부터 순서대로" 강제
              const isLockedSlot = !img && slotIdx > mmsUploadedImages.length;
              return (
                <div key={slotIdx} className="flex flex-col">
                  <div className="aspect-square relative">
                    {img ? (
                      /* 업로드 완료 */
                      <div className="w-full h-full rounded-xl border border-emerald-400/40 bg-emerald-500/10 overflow-hidden relative group">
                        <img src={img.url} alt={filenameDisplay} title={filenameDisplay} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <button
                            onClick={() => handleMmsImageRemove(slotIdx)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity bg-rose-500 hover:bg-rose-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-lg"
                          >×</button>
                        </div>
                        <div className="absolute bottom-1 right-1 bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                          {(img.size / 1024).toFixed(0)}KB
                        </div>
                        <div className="absolute top-1 left-1 bg-emerald-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                          {slotIdx + 1}
                        </div>
                      </div>
                    ) : isLockedSlot ? (
                      /* 잠긴 슬롯 */
                      <div className="w-full h-full rounded-xl border-2 border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center cursor-not-allowed opacity-50">
                        <Lock className="w-6 h-6 text-white/25 mb-2" />
                        <div className="text-xs text-white/40 font-medium">이미지 {slotIdx + 1}</div>
                        <div className="text-[10px] text-white/25 mt-1 px-2 text-center leading-tight">이미지 {mmsUploadedImages.length + 1}부터<br />순서대로</div>
                      </div>
                    ) : (
                      /* 빈 슬롯 (등록 가능) */
                      <label className={`w-full h-full rounded-xl border-2 border-dashed border-white/15 bg-white/[0.03] flex flex-col items-center justify-center cursor-pointer hover:border-violet-400/50 hover:bg-violet-500/[0.06] transition-all ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                        <Plus className="w-7 h-7 text-white/30 mb-2" />
                        <div className="text-xs text-white/45 font-medium">이미지 {slotIdx + 1}</div>
                        <div className="text-[10px] text-white/25 mt-1">JPG · 300KB</div>
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
                  {/* 파일명 — 동일 이미지/변경 여부 식별용 */}
                  <div className="mt-1 text-[11px] text-white/45 text-center truncate px-1 min-h-[18px]" title={filenameDisplay}>
                    {filenameDisplay}
                  </div>
                </div>
              );
            })}
          </div>

          {mmsUploading && (
            <div className="flex items-center justify-center gap-2 mt-4 text-sm text-violet-300">
              <Loader2 className="w-4 h-4 animate-spin" /> 이미지 업로드 중...
            </div>
          )}
        </div>

        {/* 안내 + 확인 */}
        <div className="px-6 pb-6 space-y-3">
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-amber-300/90 bg-amber-500/[0.08] border border-amber-400/20 rounded-lg px-3 py-2.5 text-center">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            실제 수신 화면은 이통사 및 휴대폰 기종에 따라 다르게 보일 수 있습니다
          </div>
          <button
            onClick={() => {
              onClose();
              onConfirm?.(mmsUploadedImages.length);
            }}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:brightness-110 text-white font-semibold text-sm shadow-lg shadow-fuchsia-500/20 transition-all"
          >
            {mmsUploadedImages.length > 0 ? `${mmsUploadedImages.length}장 첨부 완료` : '확인'}
          </button>
        </div>
      </div>

      {/* 라이브러리 픽커 — 선택 시 서버가 MMS 규격(≤300KB JPG)으로 자동 변환해 슬롯에 추가 */}
      {handleMmsFromAsset && (
        <AssetLibraryPickerModal
          open={libOpen}
          onClose={() => setLibOpen(false)}
          onPick={(asset) => handleMmsFromAsset(asset.id)}
        />
      )}
    </div>,
    document.body,
  );
}
