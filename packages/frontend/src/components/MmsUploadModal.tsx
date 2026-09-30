import { useLightSurface } from './zone/surface-tone';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Image as ImageIcon, X, Paperclip, Lock, Plus, Loader2, AlertTriangle, FolderOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import { getMmsImageDisplayName } from '../utils/mmsImage';
import AssetLibraryPickerModal from './assets/AssetLibraryPickerModal';

interface MmsUploadModalProps {
  show: boolean;
  onClose: () => void;
  mmsUploadedImages: { serverPath: string; url: string; filename: string; originalName?: string; size: number; converted?: boolean }[];
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
  /**
   * ★2026-09-10 서버가 규격(JPG · 300KB)에 맞춰 받는 업로드(대행발송 · useMmsUpload autoFit과 짝).
   * 규격 안내·파일 선택 형식이 바뀌고, 서버가 바꾼 사진에 "자동 맞춤" 표시가 붙는다. 미전달 = 지금 그대로.
   */
  autoFit?: boolean;
  /**
   * ★2026-09-29 두 칸의 사진 자리 바꾸기(useMmsUpload.handleMmsImageSwap). 넘기면 사진을 끌어 다른 칸에 놓거나
   * ◀ ▶ 로 순서를 바꿀 수 있다(발송 순서 = 1번부터 칸 순서). 미전달 = 지금 그대로(선택 기능 · 지금 켠 곳 = 직접발송).
   */
  handleMmsImageSwap?: (from: number, to: number) => void;
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
  autoFit = false,
  handleMmsImageSwap,
}: MmsUploadModalProps) {
  const light = useLightSurface(); // ★ 2026-09-30 AI 존(밝은 작업대)에서 열리면 밝은 짝 · 그 밖은 원래 짙은 값
  // ★ 훅은 조기 return 위에 (조건부 렌더 컴포넌트 훅 개수 불일치 크래시 차단 — 2026-07-06 교훈)
  const [libOpen, setLibOpen] = useState(false);
  // 끌어서 순서 바꾸기 — 잡은 칸 · 놓을 칸(표시용)
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  if (!show) return null;

  const remaining = 3 - mmsUploadedImages.length;
  // 사진이 2장 이상이고 올리는 중이 아닐 때만 순서를 바꾼다(올리는 중에는 다른 첨부 버튼도 잠시 막는 것과 같은 규칙)
  const canReorder = !!handleMmsImageSwap && mmsUploadedImages.length > 1 && !mmsUploading;
  const endDrag = () => { setDragFrom(null); setDragOver(null); };
  // 자동 맞춤이면 사진 형식은 서버가 판정한다(브라우저 선택창은 사진 전체를 보여 준다)
  const accept = autoFit ? 'image/*' : '.jpg,.jpeg';

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={light ? "w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in duration-200" : "w-full max-w-[560px] max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 shadow-2xl animate-in fade-in zoom-in duration-200"}>
        {/* 헤더 */}
        <div className={light ? "sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white backdrop-blur-sm" : "sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-white/10 bg-slate-900/95 backdrop-blur-sm"}>
          <div className="flex items-center gap-2.5">
            <div className={light ? "w-9 h-9 rounded-xl bg-violet-100 ring-1 ring-inset ring-violet-200 flex items-center justify-center" : "w-9 h-9 rounded-xl bg-violet-500/15 ring-1 ring-inset ring-violet-400/30 flex items-center justify-center"}>
              <ImageIcon className={light ? "w-4.5 h-4.5 text-violet-700" : "w-4.5 h-4.5 text-violet-300"} />
            </div>
            <div>
              <h3 className={light ? "text-base font-bold text-slate-900" : "text-base font-bold text-white"}>MMS 이미지 첨부</h3>
              <p className={light ? "text-[11px] text-slate-400" : "text-[11px] text-white/45"}>이미지를 담아 비주얼 메시지로 발송</p>
            </div>
          </div>
          <button onClick={onClose} className={light ? "text-slate-400 hover:text-slate-900 transition-colors" : "text-white/40 hover:text-white transition-colors"}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 규격 안내 */}
        <div className={light ? "px-6 py-3 border-b border-slate-200 bg-white" : "px-6 py-3 border-b border-white/10 bg-white/[0.03]"}>
          {autoFit ? (
            <div className={light ? "grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-slate-500" : "grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-white/55"}>
              <div className="flex items-center gap-1.5"><span className={light ? "text-violet-700" : "text-violet-300"}>•</span> 형식 <span className={light ? "font-semibold text-slate-700" : "font-semibold text-white/85"}>JPG · PNG 등 사진</span></div>
              <div className="flex items-center gap-1.5"><span className={light ? "text-violet-700" : "text-violet-300"}>•</span> 용량 <span className={light ? "font-semibold text-slate-700" : "font-semibold text-white/85"}>큰 사진도 가능</span></div>
              <div className="flex items-center gap-1.5"><span className={light ? "text-violet-700" : "text-violet-300"}>•</span> 최대 <span className={light ? "font-semibold text-slate-700" : "font-semibold text-white/85"}>3장</span></div>
              <div className="flex items-center gap-1.5"><span className={light ? "text-violet-700" : "text-violet-300"}>•</span> <span className={light ? "text-slate-600" : "text-white/70"}>규격(JPG · 300KB)에 맞게 자동으로 줄입니다</span></div>
            </div>
          ) : (
            <div className={light ? "grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-slate-500" : "grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-white/55"}>
              <div className="flex items-center gap-1.5"><span className={light ? "text-violet-700" : "text-violet-300"}>•</span> 형식 <span className={light ? "font-semibold text-slate-700" : "font-semibold text-white/85"}>JPG/JPEG</span></div>
              <div className="flex items-center gap-1.5"><span className={light ? "text-violet-700" : "text-violet-300"}>•</span> 용량 <span className={light ? "font-semibold text-slate-700" : "font-semibold text-white/85"}>300KB 이하</span></div>
              <div className="flex items-center gap-1.5"><span className={light ? "text-violet-700" : "text-violet-300"}>•</span> 최대 <span className={light ? "font-semibold text-slate-700" : "font-semibold text-white/85"}>3장</span></div>
              <div className="flex items-center gap-1.5"><span className={light ? "text-slate-300" : "text-white/25"}>•</span> <span className={light ? "text-slate-400" : "text-white/40"}>PNG/GIF 미지원</span></div>
            </div>
          )}
        </div>

        {/* 슬롯 영역 */}
        <div className="p-6">
          {errorMessage && (
            <div className={light ? "mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-800" : "mb-4 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200"}>
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* ★ P4: 라이브러리 소재 자동 변환 첨부 — 고품질 소재를 서버가 ≤300KB JPG로 변환 */}
          {handleMmsFromAsset && mmsUploadedImages.length < 3 && (
            <button
              onClick={() => setLibOpen(true)}
              disabled={mmsUploading}
              className={light ? `w-full flex items-center justify-center gap-2 mb-3 py-3 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-50 hover:border-emerald-300 transition-colors ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}` : `w-full flex items-center justify-center gap-2 mb-3 py-3 rounded-xl border border-emerald-400/30 bg-emerald-500/[0.06] hover:bg-emerald-500/[0.12] hover:border-emerald-400/50 transition-colors ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <FolderOpen className={light ? "w-4 h-4 text-emerald-700" : "w-4 h-4 text-emerald-300"} />
              <span className={light ? "text-sm font-medium text-emerald-800" : "text-sm font-medium text-emerald-200"}>라이브러리에서 가져오기 <span className={light ? "text-emerald-700 text-xs" : "text-emerald-300/60 text-xs"}>(MMS 규격 자동 변환)</span></span>
            </button>
          )}

          {/* 다중 첨부 */}
          {mmsUploadedImages.length < 3 && (
            <label className={light ? `flex items-center justify-center gap-2 mb-4 py-3 rounded-xl border-2 border-dashed border-violet-300 bg-violet-50 cursor-pointer hover:bg-violet-50 hover:border-violet-300 transition-colors ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}` : `flex items-center justify-center gap-2 mb-4 py-3 rounded-xl border-2 border-dashed border-violet-400/40 bg-violet-500/[0.06] cursor-pointer hover:bg-violet-500/[0.12] hover:border-violet-400/60 transition-colors ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <Paperclip className={light ? "w-4 h-4 text-violet-700" : "w-4 h-4 text-violet-300"} />
              <span className={light ? "text-sm font-medium text-violet-800" : "text-sm font-medium text-violet-200"}>여러 장 한번에 첨부 (최대 {remaining}장)</span>
              <input
                type="file"
                accept={accept}
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
              const isDragSource = canReorder && dragFrom === slotIdx;
              const isDropTarget = canReorder && dragOver === slotIdx && dragFrom !== null && dragFrom !== slotIdx;
              return (
                <div key={slotIdx} className="flex flex-col">
                  <div
                    className="aspect-square relative"
                    onDragOver={img && canReorder && dragFrom !== null ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOver !== slotIdx) setDragOver(slotIdx); } : undefined}
                    onDragLeave={img && canReorder ? () => { if (dragOver === slotIdx) setDragOver(null); } : undefined}
                    onDrop={img && canReorder ? (e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== slotIdx) handleMmsImageSwap?.(dragFrom, slotIdx); endDrag(); } : undefined}
                  >
                    {img ? (
                      /* 업로드 완료 — 순서 바꾸기가 켜져 있으면 끌어서 다른 칸에 놓는다(두 사진이 자리를 바꾼다) */
                      <div
                        draggable={canReorder}
                        onDragStart={canReorder ? (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(slotIdx)); setDragFrom(slotIdx); } : undefined}
                        onDragEnd={canReorder ? endDrag : undefined}
                        className={light ? `w-full h-full rounded-xl border overflow-hidden relative group transition-all ${isDropTarget ? 'border-violet-400 ring-2 ring-violet-300 bg-violet-50' : 'border-emerald-300 bg-emerald-50'} ${isDragSource ? 'opacity-40' : ''} ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''}` : `w-full h-full rounded-xl border overflow-hidden relative group transition-all ${isDropTarget ? 'border-violet-400 ring-2 ring-violet-400/70 bg-violet-500/10' : 'border-emerald-400/40 bg-emerald-500/10'} ${isDragSource ? 'opacity-40' : ''} ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      >
                        <img src={img.url} alt={filenameDisplay} title={filenameDisplay} draggable={false} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <button
                            onClick={() => handleMmsImageRemove(slotIdx)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity bg-rose-500 hover:bg-rose-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-lg"
                          >×</button>
                        </div>
                        {/* ◀ ▶ = 이웃 칸과 자리 바꾸기(손가락 화면·키보드용 · 누를 수 없는 끝 쪽은 그리지 않는다) */}
                        {canReorder && (
                          <div className="absolute bottom-1 left-1 flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
                            {slotIdx > 0 && (
                              <button type="button" onClick={() => handleMmsImageSwap?.(slotIdx, slotIdx - 1)} className={light ? "w-6 h-6 rounded-md bg-slate-100 hover:bg-violet-600 text-slate-900 flex items-center justify-center" : "w-6 h-6 rounded-md bg-slate-950/75 hover:bg-violet-600 text-white flex items-center justify-center"} aria-label={`${slotIdx + 1}번 사진을 왼쪽 칸과 바꾸기`} title="왼쪽 칸과 바꾸기">
                                <ChevronLeft className="w-4 h-4" />
                              </button>
                            )}
                            {slotIdx < mmsUploadedImages.length - 1 && (
                              <button type="button" onClick={() => handleMmsImageSwap?.(slotIdx, slotIdx + 1)} className={light ? "w-6 h-6 rounded-md bg-slate-100 hover:bg-violet-600 text-slate-900 flex items-center justify-center" : "w-6 h-6 rounded-md bg-slate-950/75 hover:bg-violet-600 text-white flex items-center justify-center"} aria-label={`${slotIdx + 1}번 사진을 오른쪽 칸과 바꾸기`} title="오른쪽 칸과 바꾸기">
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                        <div className="absolute bottom-1 right-1 bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                          {(img.size / 1024).toFixed(0)}KB
                        </div>
                        <div className="absolute top-1 left-1 bg-emerald-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold">
                          {slotIdx + 1}
                        </div>
                        {img.converted && (
                          <div className="absolute top-1 right-1 bg-violet-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold" title="규격(JPG · 300KB)에 맞게 자동으로 줄인 사진입니다">
                            자동 맞춤
                          </div>
                        )}
                      </div>
                    ) : isLockedSlot ? (
                      /* 잠긴 슬롯 */
                      <div className={light ? "w-full h-full rounded-xl border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center cursor-not-allowed opacity-50" : "w-full h-full rounded-xl border-2 border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center cursor-not-allowed opacity-50"}>
                        <Lock className={light ? "w-6 h-6 text-slate-300 mb-2" : "w-6 h-6 text-white/25 mb-2"} />
                        <div className={light ? "text-xs text-slate-400 font-medium" : "text-xs text-white/40 font-medium"}>이미지 {slotIdx + 1}</div>
                        <div className={light ? "text-[10px] text-slate-300 mt-1 px-2 text-center leading-tight" : "text-[10px] text-white/25 mt-1 px-2 text-center leading-tight"}>이미지 {mmsUploadedImages.length + 1}부터<br />순서대로</div>
                      </div>
                    ) : (
                      /* 빈 슬롯 (등록 가능) */
                      <label className={light ? `w-full h-full rounded-xl border-2 border-dashed border-slate-300 bg-white flex flex-col items-center justify-center cursor-pointer hover:border-violet-300 hover:bg-violet-50 transition-all ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}` : `w-full h-full rounded-xl border-2 border-dashed border-white/15 bg-white/[0.03] flex flex-col items-center justify-center cursor-pointer hover:border-violet-400/50 hover:bg-violet-500/[0.06] transition-all ${mmsUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                        <Plus className={light ? "w-7 h-7 text-slate-400 mb-2" : "w-7 h-7 text-white/30 mb-2"} />
                        <div className={light ? "text-xs text-slate-400 font-medium" : "text-xs text-white/45 font-medium"}>이미지 {slotIdx + 1}</div>
                        <div className={light ? "text-[10px] text-slate-300 mt-1" : "text-[10px] text-white/25 mt-1"}>{autoFit ? '큰 사진도 가능' : 'JPG · 300KB'}</div>
                        <input
                          type="file"
                          accept={accept}
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
                  <div className={light ? "mt-1 text-[11px] text-slate-400 text-center truncate px-1 min-h-[18px]" : "mt-1 text-[11px] text-white/45 text-center truncate px-1 min-h-[18px]"} title={filenameDisplay}>
                    {filenameDisplay}
                  </div>
                </div>
              );
            })}
          </div>

          {canReorder && (
            <p className={light ? "mt-3 text-[11px] text-slate-500 text-center" : "mt-3 text-[11px] text-white/50 text-center"}>사진을 끌어 다른 칸에 놓으면 서로 자리가 바뀌어요. 1번부터 이 순서로 보내요.</p>
          )}

          {mmsUploading && (
            <div className={light ? "flex items-center justify-center gap-2 mt-4 text-sm text-violet-700" : "flex items-center justify-center gap-2 mt-4 text-sm text-violet-300"}>
              <Loader2 className="w-4 h-4 animate-spin" /> 이미지 업로드 중...
            </div>
          )}
        </div>

        {/* 안내 + 확인 */}
        <div className="px-6 pb-6 space-y-3">
          <div className={light ? "flex items-center justify-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-center" : "flex items-center justify-center gap-1.5 text-[11px] text-amber-300/90 bg-amber-500/[0.08] border border-amber-400/20 rounded-lg px-3 py-2.5 text-center"}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            실제 수신 화면은 이통사 및 휴대폰 기종에 따라 다르게 보일 수 있습니다
          </div>
          <button
            onClick={() => {
              onClose();
              onConfirm?.(mmsUploadedImages.length);
            }}
            className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors"
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
