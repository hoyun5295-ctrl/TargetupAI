/**
 * BrandImageSlot — 브랜드메시지 5종의 이미지 한 자리 (★ 2026-09-20 신설)
 *
 * 아이템·동영상 썸네일·캐러셀 카드·인트로처럼 **이미지 자리가 여러 개**인 유형을 위해,
 * 편집기 본문 이미지 패널의 입력 방식(라이브러리 선택 · 파일 업로드)을 한 자리 단위로 뽑았다.
 * 고른 값은 우리 자산 URL이다 — 카카오 콘텐츠 서버 등록은 발송 직전 서버가 한다(brand-image-resolver).
 *
 * 규격(형식·용량·가로·비율)은 자리 아래에 **늘 보이고**, 고르는 순간 실제 크기를 재서 어긋나면
 * 경고 창이 뜬다 — 검사·업로드·자동 맞춤은 `useBrandImageGuard`가 소유한다(본문 이미지 패널과 같은 입구).
 *
 * `blockGenerated` — 이 자리는 AI로 만든 이미지를 받지 않는다(안내 문구를 자동으로 붙일 규칙이 없는 자리 ·
 *   서버도 같은 이유로 거절한다). 고르는 순간 사유를 보여 주고 담지 않는다.
 */
import { useRef, useState } from 'react';
import { FolderOpen, Upload, Loader2, ImageIcon } from 'lucide-react';
import AssetLibraryPickerModal from '../assets/AssetLibraryPickerModal';
import type { SlotImage } from './brandRich';
import { brandImageHint, type BrandImageSlotKind } from './brandImageSpec';
import { useBrandImageGuard } from './useBrandImageGuard';

interface BrandImageSlotProps {
  value: SlotImage | null;
  onChange: (next: SlotImage | null) => void;
  /** 자리 이름 — 빈 상태 안내·경고 창에 쓴다 (예: "카드 이미지") */
  label: string;
  /** 이 자리의 규격 종류 — 안내 문구와 검사가 여기서 갈린다 */
  kind: BrandImageSlotKind;
  /** 같은 비율이어야 하는 기준(가로÷세로) — 캐러셀의 첫 이미지 */
  matchRatio?: number | null;
  /** 규격 앞에 붙일 한 줄 (예: "비우면 동영상의 기본 썸네일이 보입니다") */
  note?: string;
  blockGenerated?: boolean;
  /** 썸네일 폭(px). 와이드 리스트 첫 아이템처럼 자리마다 비율이 다르다 */
  thumbWidth?: number;
}

export default function BrandImageSlot({ value, onChange, label, kind, matchRatio, note, blockGenerated, thumbWidth = 72 }: BrandImageSlotProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const guard = useBrandImageGuard({
    kind, label, matchRatio, blockGenerated,
    onAccept: (img) => onChange(img),
    onPickAnother: () => setPickerOpen(true),
  });

  const clear = () => { guard.reset(); onChange(null); };

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
          <div className="text-[11px] text-slate-500 truncate">
            {value
              ? `${value.kind === 'uploaded' ? '직접 업로드' : '라이브러리'}${value.w && value.h ? ` · ${value.w}×${value.h}` : ''}`
              : '이미지를 넣어 주세요'}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <button type="button" onClick={() => setPickerOpen(true)} disabled={guard.busy} title="라이브러리에서 선택"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 px-2 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-900/5 hover:bg-slate-100 transition disabled:opacity-50">
            <FolderOpen size={13} strokeWidth={1.9} /> 라이브러리
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={guard.busy} title="파일 업로드"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-600 px-2 py-1.5 rounded-lg bg-slate-50 ring-1 ring-slate-900/5 hover:bg-slate-100 transition disabled:opacity-50">
            {guard.busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} strokeWidth={1.9} />}
            {guard.busy ? '확인 중' : '업로드'}
          </button>
          {value && (
            <button type="button" onClick={clear}
              className="text-[11.5px] font-semibold text-slate-500 hover:text-rose-600 px-2 py-1.5 rounded-lg hover:bg-rose-50 transition">
              제거
            </button>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="hidden"
          onChange={(e) => { guard.pickFile(e.target.files?.[0] || null); e.target.value = ''; }} />
      </div>
      <p className="text-[11px] text-slate-400 mt-1.5 px-1 leading-relaxed">
        {note ? `${note} · ` : ''}{brandImageHint(kind, matchRatio)}
      </p>
      {guard.error && <p className="text-[11px] text-rose-500 mt-1 px-1">{guard.error}</p>}
      {pickerOpen && (
        <AssetLibraryPickerModal open onClose={() => setPickerOpen(false)} onPick={guard.pickAsset} showKindBadge />
      )}
      {guard.modal}
    </div>
  );
}
