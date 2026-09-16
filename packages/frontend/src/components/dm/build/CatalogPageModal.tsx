/**
 * CatalogPageModal — 카탈로그 쪽 블록 창 (★ 2026-09-16 설계서 §5)
 *
 * 템플릿이 정한 자리에 사진을 넣고 글자를 적으면 서버가 쪽 이미지 1장(1200×1600)으로 합성한다.
 * 합성 결과는 갤러리 1장짜리 장이 되므로 카탈로그 책 자격(뷰어)을 그대로 통과한다.
 * 가격·할인율은 여기서 받지 않는다 — 이미지에 새기면 값이 바뀔 때 거짓말이 된다(상품 정보는 상품 블록 몫).
 */
import { useState } from 'react';
import ModalBase, { ModalButton } from '../modals/ModalBase';
import { uploadOne } from '../panels/FormControls';
import { useToast } from '../../ToastProvider';
import StudioInsertModal from './StudioInsertModal';

const token = () => localStorage.getItem('token');

export type CatalogTemplateKey = 'cover' | 'one' | 'duo' | 'end';
export const CATALOG_BLOCKS: Array<{ key: CatalogTemplateKey; label: string; icon: string; desc: string; photos: number; texts: Array<{ k: 'title' | 'desc' | 'label1' | 'label2'; l: string; ph: string }> }> = [
  { key: 'cover', label: '표지 쪽', icon: '📔', desc: '사진이 쪽 전체 · 아래 제목', photos: 1, texts: [{ k: 'title', l: '제목', ph: '2026 가을 카탈로그' }, { k: 'desc', l: '한 줄 설명', ph: '이번 시즌 신상' }] },
  { key: 'one', label: '상품 한 점 쪽', icon: '🧥', desc: '위 사진 · 아래 제목과 설명', photos: 1, texts: [{ k: 'title', l: '상품명', ph: '캐시미어 코트' }, { k: 'desc', l: '설명', ph: '가볍고 따뜻한 겨울 아우터' }] },
  { key: 'duo', label: '두 점 비교 쪽', icon: '🫱', desc: '사진 둘을 위아래로', photos: 2, texts: [{ k: 'label1', l: '위 사진 설명', ph: '데일리 머플러' }, { k: 'label2', l: '아래 사진 설명', ph: '겨울 니트' }] },
  { key: 'end', label: '마무리 쪽', icon: '🙏', desc: '사진 없이 안내 글만', photos: 0, texts: [{ k: 'title', l: '제목', ph: '매장에서 만나보세요' }, { k: 'desc', l: '안내', ph: '가까운 매장에서 착용해 보세요' }] },
];

export default function CatalogPageModal({
  templateKey, open, onClose, onMade, brandColor,
}: {
  templateKey: CatalogTemplateKey | null;
  open: boolean;
  onClose: () => void;
  /** 합성된 쪽 이미지 주소 */
  onMade: (url: string, chips: Array<{ label: string; price?: string; url?: string }>) => void;
  brandColor?: string | null;
}) {
  const toast = useToast();
  const [photos, setPhotos] = useState<string[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [studioAt, setStudioAt] = useState<number | null>(null);
  // ★ 상품 정보 = 쪽 이미지 밖 칩. 가격을 이미지에 새기지 않는 이유 = 값이 바뀌면 재합성 없이 못 고친다
  const [chips, setChips] = useState<Array<{ label: string; price: string; url: string }>>([]);

  const def = CATALOG_BLOCKS.find((b) => b.key === templateKey) || null;
  if (!def) return null;

  const setPhotoAt = (i: number, url: string) => setPhotos((prev) => { const n = prev.slice(); n[i] = url; return n; });

  const pickFile = async (i: number, file: File | null) => {
    if (!file) return;
    setBusy(true);
    try { setPhotoAt(i, await uploadOne(file)); } catch { toast.error('사진을 올리지 못했어요.'); } finally { setBusy(false); }
  };

  const make = async () => {
    const need = def.photos - photos.filter(Boolean).length;
    if (need > 0) { toast.error(`사진 ${need}장이 더 필요해요.`); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/dm/catalog/render-pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ pages: [{ template: def.key, photos: photos.filter(Boolean), texts }], brand_color: brandColor || null }),
      });
      const d = await r.json().catch(() => ({}));
      const url = d?.data?.pages?.[0]?.url;
      if (!r.ok || !d?.success || !url) { toast.error(d?.error || '쪽을 만들지 못했어요.'); return; }
      onMade(url, chips.filter((c) => c.label.trim()).map((c) => ({ label: c.label.trim(), price: c.price.trim() || undefined, url: c.url.trim() || undefined })));
      setPhotos([]); setTexts({}); setChips([]);
      toast.success('쪽을 만들어 넣었어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ModalBase
        open={open}
        onClose={onClose}
        title={`${def.icon} ${def.label}`}
        subtitle={`${def.desc} · 사진 ${def.photos}장`}
        size="md"
        footer={<ModalButton variant="primary" onClick={make} disabled={busy}>{busy ? '만드는 중...' : '쪽 만들어 넣기'}</ModalButton>}
      >
        <div className="space-y-3">
          {Array.from({ length: def.photos }, (_, i) => (
            <div key={i} className="rounded-xl border border-white/12 bg-white/[0.03] p-3">
              <div className="text-[11px] text-white/50 mb-2">사진 {def.photos > 1 ? i + 1 : ''}</div>
              {photos[i] ? (
                <div className="flex items-center gap-3">
                  <img src={photos[i]} alt="" className="w-16 h-20 object-cover rounded-lg border border-white/10" />
                  <button type="button" onClick={() => setPhotoAt(i, '')} className="h-8 px-3 rounded-lg border border-white/14 bg-white/5 text-[12px] font-bold">바꾸기</button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="block">
                    <span className="block text-center text-[12px] text-white/45 border border-dashed border-white/20 rounded-[10px] py-4 cursor-pointer hover:bg-white/[0.04]">
                      사진 고르기
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { void pickFile(i, e.target.files?.[0] || null); e.currentTarget.value = ''; }} />
                  </label>
                  <button type="button" onClick={() => setStudioAt(i)} className="h-9 rounded-[10px] border border-violet-400/45 bg-violet-500/12 text-[12px] font-bold">
                    ✨ 이미지 스튜디오에서 제작 후 삽입
                  </button>
                </div>
              )}
            </div>
          ))}

          {def.texts.map((t) => (
            <label key={t.k} className="block">
              <span className="block text-[11px] text-white/50 mb-1">{t.l}</span>
              <input
                value={texts[t.k] || ''}
                onChange={(e) => setTexts((p) => ({ ...p, [t.k]: e.target.value }))}
                placeholder={t.ph}
                className="w-full px-3 py-2 rounded-[10px] bg-slate-950/60 border border-white/15 text-[13px] outline-none"
              />
            </label>
          ))}

          <div className="rounded-xl border border-white/12 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] text-white/55">상품 정보 (쪽 아래 칩으로 붙어요)</span>
              {chips.length < 2 && (
                <button
                  type="button"
                  onClick={() => setChips((p2) => [...p2, { label: '', price: '', url: '' }])}
                  className="ml-auto h-7 px-2.5 rounded-lg border border-white/14 bg-white/5 text-[11.5px] font-bold"
                >
                  + 상품 넣기
                </button>
              )}
            </div>
            {chips.length === 0 && <div className="text-[11px] text-white/35">넣지 않아도 됩니다. 넣으면 누를 수 있는 알약 버튼이 쪽 아래에 붙어요.</div>}
            {chips.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_88px_28px] gap-1.5 mb-1.5">
                <input
                  value={c.label} placeholder="상품명"
                  onChange={(e) => setChips((p2) => p2.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  className="px-2.5 py-2 rounded-[9px] bg-slate-950/60 border border-white/15 text-[12.5px] outline-none"
                />
                <input
                  value={c.price} placeholder="가격"
                  onChange={(e) => setChips((p2) => p2.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                  className="px-2.5 py-2 rounded-[9px] bg-slate-950/60 border border-white/15 text-[12.5px] outline-none"
                />
                <button type="button" onClick={() => setChips((p2) => p2.filter((_, j) => j !== i))} className="rounded-[9px] border border-rose-400/30 bg-rose-500/10 text-rose-200 text-[12px]" aria-label="빼기">✕</button>
                <input
                  value={c.url} placeholder="상품 주소 (선택)"
                  onChange={(e) => setChips((p2) => p2.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                  className="col-span-3 px-2.5 py-2 rounded-[9px] bg-slate-950/60 border border-white/15 text-[12.5px] outline-none"
                />
              </div>
            ))}
          </div>

          <p className="text-[11px] text-white/35 leading-relaxed">
            가격·할인율은 쪽 이미지에 새기지 않아요. 값이 바뀌면 이미지가 거짓말을 하기 때문입니다. 칩은 글자라 나중에 고칠 수 있어요.
          </p>
        </div>
      </ModalBase>

      <StudioInsertModal
        open={studioAt !== null}
        onClose={() => setStudioAt(null)}
        defaultTitle={texts.title || ''}
        defaultSubtitle={texts.desc || ''}
        onInserted={(url) => { if (studioAt !== null) setPhotoAt(studioAt, url); setStudioAt(null); }}
      />
    </>
  );
}
