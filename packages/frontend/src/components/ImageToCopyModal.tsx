/**
 * ImageToCopyModal — 이미지로 문안 생성 공용 모달 (2026-07-08)
 *
 * 어떤 AI 문안·콘텐츠 생성 입력칸에서든 재사용. 이미지 최대 5장 → vision 판독(3크레딧, 성공 시만)
 * → "보이는 것만 그대로 전사"한 텍스트를 onExtracted(text)로 돌려준다. 호출한 화면이 자기 입력칸을 채운다.
 * (혜택 날조 방지 룰 양립 — 사용자가 채워진 텍스트를 눈으로 보고 고친 뒤 생성)
 *
 * z-[2000] 인터럽트 티어 — 다른 모달(예: 행사 캠페인 모달) 위에서도 위로 뜬다. 백드롭 클릭 닫힘 없음(X만).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { downscaleToJpeg } from '../utils/image-downscale';
import AssetLibraryPickerModal from './assets/AssetLibraryPickerModal';
import { assetsToFiles } from '../lib/asset-to-file';

const MAX_IMAGES = 5;
const IMAGE_EXTRACT_COST = 3;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function ImageToCopyModal({ open, onClose, onExtracted, onStructured }: {
  open: boolean;
  onClose: () => void;
  /** 판독 성공 시 추출된 행사/상품 내용 텍스트를 전달 */
  onExtracted: (text: string) => void;
  /** ★ 2026-07-19: 구조화 판독(events[]) 수신 — 전달 시 구조가 있으면 이쪽 우선(디터미니스틱 조립용). 미전달 = 기존 산문 흐름. */
  onStructured?: (payload: { events: Array<Record<string, any>>; text: string }) => void;
}) {
  const [images, setImages] = useState<File[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [libOpen, setLibOpen] = useState(false); // ★ P4: 라이브러리에서 선택 분기
  const fileRef = useRef<HTMLInputElement>(null);

  const token = () => localStorage.getItem('token');

  useEffect(() => {
    if (!open) return;
    setImages([]);
    setErr(null);
    setExtracting(false);
  }, [open]);

  const previews = useMemo(() => images.map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [images]);
  useEffect(() => () => { previews.forEach((p) => URL.revokeObjectURL(p.url)); }, [previews]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    const valid = picked.filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type) && f.size <= 5 * 1024 * 1024);
    setImages((prev) => [...prev, ...valid].slice(0, MAX_IMAGES));
    setErr(picked.length > valid.length ? '일부 파일은 형식·용량(5MB) 초과로 제외됐어요. JPG·PNG·WebP만 가능합니다.' : null);
    e.target.value = '';
  };

  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  const run = async () => {
    if (!images.length || extracting) return;
    setExtracting(true);
    setErr(null);
    try {
      const fd = new FormData();
      for (let i = 0; i < images.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const blob = await downscaleToJpeg(images[i]);
        fd.append('images', blob, `shot_${i + 1}.jpg`);
      }
      const res = await fetch('/api/event-campaigns/extract-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` }, // multipart — Content-Type 자동
        body: fd,
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '이미지 판독 실패'));
      // ★ 구조화 판독 우선 — events가 오면 호출부가 DM 섹션을 디터미니스틱 조립(70% 완성 흐름)
      const events = Array.isArray(data.events) ? data.events.filter((e: any) => e && (e.title || e.benefit || (e.products || []).length)) : [];
      if (events.length > 0 && onStructured) {
        onStructured({ events, text: String(data.event_text || '') });
        onClose();
        return;
      }
      onExtracted(String(data.event_text || ''));
      onClose();
    } catch (e: any) {
      setErr(e?.message || '이미지 판독 실패');
    } finally {
      setExtracting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-lg bg-slate-900 border border-white/10 rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/25">
              <ImagePlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">이미지로 문안 생성</h3>
              <p className="text-[11px] text-white/50">상품·행사 이미지를 올리면 AI가 내용을 읽어 문안 입력칸을 채워줍니다</p>
            </div>
          </div>
          <button onClick={onClose} disabled={extracting} className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-40" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-[11px] text-white/50">JPG·PNG·WebP · 한 장당 5MB 이하 · 최대 {MAX_IMAGES}장. 보이는 상품명·정가·할인·기간·혜택만 그대로 읽어옵니다(없는 값 생성 안 함).</p>

          {previews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {previews.map((p, i) => (
                <div key={p.url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10">
                  <img src={p.url} alt={`업로드 이미지 ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImage(i)}
                    disabled={extracting}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-rose-600 disabled:opacity-40"
                    aria-label="이미지 제거"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={onPick} />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={extracting || images.length >= MAX_IMAGES}
              className="rounded-xl border border-dashed border-violet-400/40 bg-violet-500/[0.06] hover:bg-violet-500/10 text-violet-100 text-sm font-medium py-4 disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-2"><ImagePlus className="w-4 h-4" /> 직접 업로드</span>
            </button>
            <button
              type="button"
              onClick={() => setLibOpen(true)}
              disabled={extracting || images.length >= MAX_IMAGES}
              className="rounded-xl border border-dashed border-emerald-400/40 bg-emerald-500/[0.06] hover:bg-emerald-500/10 text-emerald-100 text-sm font-medium py-4 disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-2"><FolderOpen className="w-4 h-4" /> 라이브러리에서 선택</span>
            </button>
          </div>
          <AssetLibraryPickerModal
            open={libOpen}
            onClose={() => setLibOpen(false)}
            multiSelect
            onPick={async (a) => {
              const fs = await assetsToFiles([a]);
              setImages((prev) => [...prev, ...fs].slice(0, MAX_IMAGES));
            }}
            onPickMany={async (assets) => {
              const fs = await assetsToFiles(assets);
              setImages((prev) => [...prev, ...fs].slice(0, MAX_IMAGES));
            }}
          />

          {err && <p className="text-[11px] text-rose-300">{err}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} disabled={extracting} className="text-[12px] text-white/50 hover:text-white/80 px-3 py-2 disabled:opacity-40">취소</button>
            <button
              onClick={() => run()}
              disabled={extracting || images.length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white text-sm font-bold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {extracting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {extracting ? '이미지 판독 중...' : `문안 불러오기 (예상 ${IMAGE_EXTRACT_COST} 크레딧)`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
