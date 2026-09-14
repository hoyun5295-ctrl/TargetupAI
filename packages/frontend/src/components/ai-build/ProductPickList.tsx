/**
 * ProductPickList — AI 자동제작 상품 칸(폼 전체 1칸 · 2026-09-14 T5 · 설계서 §3-5 · §4-2)
 *
 * [연동몰에서 불러오기](연동 시만 · MallProductPickerModal 은 호출부가 연다) + [직접 추가](붙여넣기 → parsePastedProducts · AI 0 · 원문 숫자만).
 * 표시 = 썸네일/칩 줄(56px · 가로 스크롤 · 상품명 · 판매가 · 출처). 가격·링크는 원문 그대로(계산 0) · 몰 상품은 생성 때 서버가 상품번호로 다시 읽는다(불변 3).
 * 미연동이고 0건이면 칸을 접고 [상품 붙여넣기] 한 줄만 둔다.
 */
import { useState } from 'react';
import { ShoppingBag, ClipboardPaste, X, Plus } from 'lucide-react';
import { parsePastedProducts } from '../../utils/product-paste';
import type { BuildProductValue } from '../../utils/ai-build';

const won = (n: number | null) => (typeof n === 'number' && n > 0 ? `${Math.round(n).toLocaleString('ko-KR')}원` : '');

export const AI_BUILD_PRODUCTS_MAX = 12;

export default function ProductPickList({ value, onChange, mallAvailable, onOpenMall, disabled, onNotice }: {
  value: BuildProductValue[];
  onChange: (next: BuildProductValue[]) => void;
  /** GET /api/mall-products/providers 결과가 1개 이상 */
  mallAvailable: boolean;
  onOpenMall: () => void;
  disabled?: boolean;
  onNotice?: (message: string) => void;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const collapsed = !mallAvailable && value.length === 0 && !pasteOpen;

  const addPasted = () => {
    const parsed = parsePastedProducts(pasteText, AI_BUILD_PRODUCTS_MAX);
    if (parsed.length === 0) { onNotice?.('상품명과 가격을 한 줄씩 붙여넣어 주세요. 예) 수분크림 38,000원'); return; }
    const existing = new Set(value.map((p) => p.key));
    const next = [...value];
    for (const p of parsed) {
      const key = `manual:${p.name.toLowerCase().replace(/\s+/g, '')}`;
      if (existing.has(key)) continue;
      existing.add(key);
      next.push({
        key, source: 'manual', provider: null, code: null, name: p.name,
        price: typeof p.price === 'number' ? p.price : null,
        salePrice: typeof p.discount_price === 'number' ? p.discount_price : null,
        discountRate: typeof p.discount_rate === 'number' ? p.discount_rate : null,
        url: p.link_url || null, imageUrl: null,
      });
      if (next.length >= AI_BUILD_PRODUCTS_MAX) break;
    }
    if (next.length === value.length) onNotice?.('이미 담긴 상품이거나 상한(12개)에 닿았어요.');
    onChange(next.slice(0, AI_BUILD_PRODUCTS_MAX));
    setPasteText('');
    setPasteOpen(false);
  };

  if (collapsed) {
    return (
      <button type="button" disabled={disabled} onClick={() => setPasteOpen(true)}
        className="inline-flex items-center gap-1.5 text-[12px] text-white/55 hover:text-white/85 disabled:opacity-50">
        <ClipboardPaste className="w-3.5 h-3.5" /> 상품 붙여넣기(선택)
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {mallAvailable && (
          <button type="button" disabled={disabled || value.length >= AI_BUILD_PRODUCTS_MAX} onClick={onOpenMall}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold bg-violet-600/80 hover:bg-violet-500 text-white disabled:opacity-50 transition-colors">
            <ShoppingBag className="w-3.5 h-3.5" /> 연동몰에서 불러오기
          </button>
        )}
        <button type="button" disabled={disabled || value.length >= AI_BUILD_PRODUCTS_MAX} onClick={() => setPasteOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-medium text-white/75 border border-white/15 hover:bg-white/10 disabled:opacity-50 transition-colors">
          <ClipboardPaste className="w-3.5 h-3.5" /> 직접 추가
        </button>
        <span className="text-[11px] text-white/40 ml-auto">{value.length}/{AI_BUILD_PRODUCTS_MAX} · 가격·링크는 적은 그대로 실려요</span>
      </div>
      {pasteOpen && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
          <textarea
            value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4} disabled={disabled}
            placeholder={'상품명 · 가격 · (링크)를 줄마다\n예)\n수분크림 50ml\n38,000원 → 30% 26,600원\nhttps://shop.example/products/123'}
            className="w-full rounded-lg bg-slate-950/60 border border-white/10 px-3 py-2 text-[13px] text-white placeholder:text-white/30 outline-none focus:border-violet-400/60 resize-none"
          />
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setPasteOpen(false); setPasteText(''); }} className="text-[12px] text-white/50 hover:text-white/80 px-2 py-1">취소</button>
            <button type="button" onClick={addPasted} disabled={disabled || !pasteText.trim()}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[12px] font-semibold bg-white/10 hover:bg-white/15 text-white disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" /> 담기
            </button>
          </div>
        </div>
      )}
      {value.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {value.map((p) => (
            <div key={p.key} className="relative shrink-0 w-[168px] rounded-xl border border-white/10 bg-white/[0.04] p-2 flex items-center gap-2">
              <div className="w-14 h-14 rounded-lg bg-slate-900 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                {p.imageUrl ? <img src={p.imageUrl} alt="" className="w-full h-full object-cover" /> : <ShoppingBag className="w-5 h-5 text-white/25" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] text-white/90 truncate" title={p.name}>{p.name}</div>
                <div className="text-[11px] text-white/60 truncate">{won(p.salePrice ?? p.price) || '가격 없음'}</div>
                <div className="text-[10px] text-white/35">{p.source === 'mall' ? `${p.provider === 'naver' ? '네이버' : p.provider?.startsWith('woocommerce') ? '우커머스' : '카페24'} 상품` : '직접 입력'}{p.source === 'manual' ? ' · 카드 대신 글로' : ''}</div>
              </div>
              {!disabled && (
                <button type="button" onClick={() => onChange(value.filter((x) => x.key !== p.key))} aria-label="이 상품 제외"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-800 border border-white/20 text-white/80 flex items-center justify-center hover:bg-rose-600"><X className="w-3 h-3" /></button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
