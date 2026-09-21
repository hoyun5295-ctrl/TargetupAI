// SnsAssetPicker — 소재 라이브러리에서 사진 고르기 (2026-09-21 S2)
// 설계 SoT = docs/2026-09-17-sns-publish-design.md §4-2 1번("`소재 라이브러리` 픽커")
//
// 이미지 스튜디오에서 만든 소재와 올려 둔 소재를 그대로 쓴다. 다시 올릴 필요가 없다.
// ★ 여기서 고른 사진만 `asset_id` 를 갖고, 그것이 AI 표시 자동 부착의 근거가 된다(§3-9).
// 커스텀 모달 — native dialog 0.

import { useEffect, useState } from 'react';
import { X, Loader2, ImageOff, Check } from 'lucide-react';

interface Asset {
  id: string;
  url: string;
  kind: string;
  generated: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 고른 소재들을 SNS 미디어로 가져온다. 부모가 업로드 상태를 관리한다. */
  onPick: (assetIds: string[]) => Promise<void>;
}

export default function SnsAssetPicker({ open, onClose, onPick }: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setPicked([]);
    void (async () => {
      try {
        const res = await fetch('/api/sns/assets', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const data = await res.json();
        setAssets(data?.success && Array.isArray(data.assets) ? data.assets : []);
      } catch {
        setAssets([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  if (!open) return null;

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const confirm = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      await onPick(picked);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-3xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">소재에서 고르기</p>
            <p className="text-[11px] text-white/50 mt-0.5">이미지 스튜디오에서 만든 소재와 올려 둔 사진이 모두 있습니다.</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-violet-400" /></div>
          ) : assets.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 mx-auto flex items-center justify-center mb-3">
                <ImageOff className="w-5 h-5 text-white/40" />
              </div>
              <p className="text-sm font-semibold text-white/80">아직 소재가 없어요</p>
              <p className="text-xs text-white/50 mt-1.5">이미지 스튜디오에서 만들거나 직접 올려 주세요.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2.5">
              {assets.map((a) => {
                const on = picked.includes(a.id);
                const order = picked.indexOf(a.id) + 1;
                return (
                  <button key={a.id} onClick={() => toggle(a.id)}
                    className={`relative aspect-square rounded-xl overflow-hidden border transition-colors ${
                      on ? 'border-violet-400' : 'border-white/10 hover:border-white/25'
                    }`}>
                    <img src={a.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    {on && (
                      <span className="absolute inset-0 bg-violet-600/25 flex items-center justify-center">
                        <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-[11px] font-semibold flex items-center justify-center">
                          {picked.length > 1 ? order : <Check className="w-3.5 h-3.5" />}
                        </span>
                      </span>
                    )}
                    {a.generated && (
                      <span className="absolute left-1 bottom-1 text-[9px] px-1 py-0.5 rounded bg-slate-950/70 text-white/70">
                        AI 제작
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-white/10 flex items-center gap-2 justify-between">
          <span className="text-[11px] text-white/45">
            {picked.length > 0 ? `${picked.length}장 고름 · 누른 순서대로 들어갑니다` : '여러 장을 고르면 넘겨보는 게시물이 됩니다'}
          </span>
          <button onClick={() => void confirm()} disabled={picked.length === 0 || busy}
            className="h-9 px-3 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1.5 transition-colors disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            가져오기
          </button>
        </div>
      </div>
    </div>
  );
}
