/**
 * MallProductPickerModal — 연동 몰에서 상품 불러오기 (2026-07-08)
 *
 * DM 상품 슬라이드(ProductCarousel)에서 "연동 몰에서 상품 불러오기" → 이 모달 → 몰 선택·검색·선택 →
 * onPick(선택 상품[])으로 돌려주면 편집기가 슬라이드 항목(이미지·상품명·정가·할인가·링크)에 자동 채운다.
 * 연동된 몰만 탭으로 노출(GET /providers). 카페24·네이버 지원(실측 확정). z-[2000] 인터럽트 티어.
 */
import { useEffect, useState } from 'react';
import { Check, Loader2, ShoppingBag, X } from 'lucide-react';

export interface PickedMallProduct {
  provider: string;
  code: string;
  name: string;
  price: number;        // 정가
  salePrice: number;    // 판매가
  discountRate: number; // %
  imageUrl: string | null;
  productUrl: string | null;
}

interface ProviderTab { provider: string; label: string; }

const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}원`;

export default function MallProductPickerModal({ open, onClose, onPick }: {
  open: boolean;
  onClose: () => void;
  onPick: (products: PickedMallProduct[]) => void;
}) {
  const [providers, setProviders] = useState<ProviderTab[]>([]);
  const [provider, setProvider] = useState<string>('');
  const [q, setQ] = useState('');
  const [products, setProducts] = useState<PickedMallProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Record<string, PickedMallProduct>>({});

  const token = () => localStorage.getItem('token');

  const load = async (prov: string, keyword?: string) => {
    if (!prov) { setProducts([]); return; }
    setLoading(true);
    setErr(null);
    setProducts([]);
    try {
      const url = `/api/mall-products/search?provider=${encodeURIComponent(prov)}${keyword ? `&q=${encodeURIComponent(keyword)}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || data?.success === false) throw new Error(String(data?.error || '상품을 불러오지 못했습니다.'));
      setProducts(Array.isArray(data.products) ? data.products : []);
    } catch (e: any) {
      setErr(e?.message || '상품을 불러오지 못했습니다.');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSel({});
    setQ('');
    setProducts([]);
    setErr(null);
    setLoading(true);
    fetch('/api/mall-products/providers', { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json())
      .then((data) => {
        const list: ProviderTab[] = Array.isArray(data?.providers) ? data.providers : [];
        setProviders(list);
        if (list.length > 0) {
          setProvider(list[0].provider);
          load(list[0].provider);
        } else {
          setProvider('');
          setLoading(false);
        }
      })
      .catch(() => { setProviders([]); setProvider(''); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const pickProvider = (p: string) => { setProvider(p); setSel({}); load(p, q.trim()); };
  const toggle = (p: PickedMallProduct) =>
    setSel((s) => {
      const n = { ...s };
      const key = `${p.provider}:${p.code}`;
      if (n[key]) delete n[key];
      else n[key] = p;
      return n;
    });
  const picked = Object.values(sel);

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <ShoppingBag className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">연동 몰에서 상품 불러오기</h3>
              <p className="text-[11px] text-white/50">상품을 골라 슬라이드에 자동으로 채웁니다 (이미지·정가·할인가·링크)</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded-lg hover:bg-white/10" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {providers.length > 0 && (
          <div className="px-6 pt-3 shrink-0">
            <div className="flex gap-1.5 flex-wrap">
              {providers.map((t) => (
                <button
                  key={t.provider}
                  type="button"
                  onClick={() => pickProvider(t.provider)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${provider === t.provider ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-100' : 'bg-slate-950/40 border-white/10 text-white/60 hover:border-white/25'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-6 py-3 border-b border-white/10 shrink-0">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') load(provider, q.trim()); }}
              placeholder="상품명 검색 (비우면 전체)"
              disabled={!provider}
              className="flex-1 px-3 py-2 bg-slate-950/60 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/40 disabled:opacity-40"
            />
            <button
              onClick={() => load(provider, q.trim())}
              disabled={loading || !provider}
              className="px-4 py-2 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 text-sm font-medium hover:bg-emerald-500/30 disabled:opacity-40"
            >
              검색
            </button>
          </div>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {providers.length === 0 && !loading ? (
            <div className="py-10 text-center text-sm text-white/40">연동된 쇼핑몰이 없습니다. 자사몰 연동 후 이용해주세요.</div>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-white/50 text-sm"><Loader2 className="w-5 h-5 animate-spin" /> 불러오는 중...</div>
          ) : err ? (
            <div className="py-10 text-center text-sm text-rose-300">{err}</div>
          ) : products.length === 0 ? (
            <div className="py-10 text-center text-sm text-white/40">표시할 상품이 없습니다.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {products.map((p) => {
                const key = `${p.provider}:${p.code}`;
                const on = !!sel[key];
                const hasDiscount = p.salePrice > 0 && p.salePrice < p.price;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggle(p)}
                    className={`text-left flex gap-3 p-2.5 rounded-xl border transition-colors ${on ? 'bg-emerald-500/15 border-emerald-400/50' : 'bg-slate-950/40 border-white/10 hover:border-white/25'}`}
                  >
                    <div className="w-14 h-14 rounded-lg bg-white/5 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                      {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" /> : <ShoppingBag className="w-5 h-5 text-white/20" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium text-white truncate">{p.name}</div>
                      <div className="mt-1 text-[11px]">
                        {hasDiscount ? (
                          <span>
                            {p.discountRate > 0 && <span className="text-rose-300 font-bold mr-1">{p.discountRate}%</span>}
                            <span className="text-white font-bold">{won(p.salePrice)}</span>
                            <span className="text-white/35 line-through ml-1">{won(p.price)}</span>
                          </span>
                        ) : (
                          <span className="text-white font-bold">{won(p.price)}</span>
                        )}
                      </div>
                    </div>
                    <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 self-center ${on ? 'bg-emerald-500 border-emerald-400 text-white' : 'border-white/25 text-transparent'}`}>
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-white/45">{picked.length > 0 ? `${picked.length}개 선택됨` : '슬라이드에 넣을 상품을 선택하세요'}</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-[12px] text-white/50 hover:text-white/80 px-3 py-2">취소</button>
            <button
              onClick={() => { onPick(picked); onClose(); }}
              disabled={picked.length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-bold hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              슬라이드에 추가 {picked.length > 0 ? `(${picked.length})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
