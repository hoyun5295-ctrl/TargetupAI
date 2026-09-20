/**
 * BrandImageSlot — 브랜드메시지 5종의 이미지 한 자리 (★ 2026-09-20 신설)
 *
 * 아이템·동영상 썸네일·캐러셀 카드·인트로처럼 **이미지 자리가 여러 개**인 유형을 위해,
 * 편집기 본문 이미지 패널의 입력 방식(라이브러리 선택 · 파일 업로드)을 한 자리 단위로 뽑았다.
 * 고른 값은 우리 자산 URL이다 — 카카오 콘텐츠 서버 등록은 발송 직전 서버가 한다(brand-image-resolver).
 *
 * `blockGenerated` — 이 자리는 AI로 만든 이미지를 받지 않는다(안내 문구를 자동으로 붙일 규칙이 없는 자리 ·
 *   서버도 같은 이유로 거절한다). 고르는 순간 사유를 보여 주고 담지 않는다.
 */
import { useRef, useState } from 'react';
import { FolderOpen, Upload, Loader2, ImageIcon } from 'lucide-react';
import AssetLibraryPickerModal, { type PickedAsset } from '../assets/AssetLibraryPickerModal';
import type { SlotImage } from './brandRich';

const toAbsoluteUrl = (u: string): string => {
  try { return new URL(u, window.location.origin).toString(); } catch { return u; }
};

interface BrandImageSlotProps {
  value: SlotImage | null;
  onChange: (next: SlotImage | null) => void;
  /** 자리 이름 — 빈 상태 안내에 쓴다 (예: "카드 이미지") */
  label: string;
  /** 규격 안내 한 줄 (예: "jpg·png · 2MB 이하") */
  hint?: string;
  blockGenerated?: boolean;
  /** 썸네일 폭(px). 와이드 리스트 첫 아이템처럼 자리마다 비율이 다르다 */
  thumbWidth?: number;
}

export default function BrandImageSlot({ value, onChange, label, hint, blockGenerated, thumbWidth = 72 }: BrandImageSlotProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  /** 업로드 중에 다른 이미지를 고르면 늦게 온 업로드 응답을 버린다(편집기 imageSeqRef와 같은 방식) */
  const seqRef = useRef(0);

  const applyPicked = (asset: PickedAsset) => {
    seqRef.current++;
    setUploading(false);
    if (blockGenerated && asset.kind === 'generated') {
      setError('AI로 만든 이미지는 이 자리에 쓸 수 없습니다. 직접 올린 이미지를 골라 주세요.');
      return;
    }
    setError('');
    onChange({ url: toAbsoluteUrl(asset.url), assetId: asset.id, kind: asset.kind, name: asset.filename || '라이브러리 이미지' });
  };

  const upload = async (file: File | null) => {
    if (!file) return;
    const seq = ++seqRef.current;
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/assets/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        body: fd,
      });
      const data = await res.json();
      if (seq !== seqRef.current) return;
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '업로드하지 못했습니다.'));
      onChange({
        url: toAbsoluteUrl(String(data.url || '')), assetId: String(data.assetId || ''),
        kind: 'uploaded', name: String(data.filename || file.name),
      });
    } catch (e: any) {
      if (seq === seqRef.current) setError(e?.message || '업로드하지 못했습니다.');
    } finally {
      if (seq === seqRef.current) setUploading(false);
    }
  };

  const clear = () => { seqRef.current++; setUploading(false); setError(''); onChange(null); };

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2.5 min-w-0 rounded-xl bg-white p-2 ring-1 ring-slate-900/5 shadow-sm">
        <div className="shrink-0 h-12 rounded-lg overflow-hidden bg-slate-100 ring-1 ring-slate-200 grid place-items-center" style={{ width: thumbWidth }}>
          {value
            ? <img src={value.url} alt="" className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            : <ImageIcon size={16} strokeWidth={1.7} className="text-slate-300" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold text-slate-800 truncate">{value ? value.name : label}</div>
          <div className="text-[11px] text-slate-500 truncate">{value ? (value.kind === 'uploaded' ? '직접 업로드' : '라이브러리') : (hint || '이미지를 넣어 주세요')}</div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button type="button" onClick={() => setPickerOpen(true)} title="라이브러리에서 선택"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 px-2 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-900/5 hover:bg-slate-100 transition">
            <FolderOpen size={13} strokeWidth={1.9} /> 라이브러리
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} title="파일 업로드"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 px-2 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-900/5 hover:bg-slate-100 transition disabled:opacity-50">
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} strokeWidth={1.9} />}
            {uploading ? '올리는 중' : '업로드'}
          </button>
          {value && (
            <button type="button" onClick={clear}
              className="text-[11.5px] font-semibold text-slate-500 hover:text-rose-600 px-2 py-1.5 rounded-lg hover:bg-rose-50 transition">
              제거
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
          onChange={(e) => { upload(e.target.files?.[0] || null); e.target.value = ''; }} />
      </div>
      {error && <p className="text-[11px] text-rose-500 mt-1.5 px-1">{error}</p>}
      {pickerOpen && (
        <AssetLibraryPickerModal open onClose={() => setPickerOpen(false)} onPick={applyPicked} showKindBadge />
      )}
    </div>
  );
}
