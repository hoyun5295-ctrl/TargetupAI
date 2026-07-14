import type { ProductCarouselProps, ProductCarouselItem } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Toggle, ImageUploader } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';
import { useState } from 'react';
import MallProductPickerModal, { type PickedMallProduct } from '../../MallProductPickerModal';
// ★ 2026-07-14 Harold 지시 — 상품 정보 붙여넣기(이름/가격→할인/URL 블록) = 결정적 파서·크레딧 0 (이메일·DM 공용)
import { parsePastedProducts } from '../../../../utils/product-paste';

export default function ProductCarouselEditor({ props, onUpdate }: EditorProps<ProductCarouselProps>) {
  const products = props.products || [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [matchingIdx, setMatchingIdx] = useState<number | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  const applyPaste = () => {
    const parsed = parsePastedProducts(pasteText, 8);
    if (parsed.length === 0) {
      setPasteNote('상품을 찾지 못했어요 — "상품명 / 가격 / 링크"를 줄로 나눠 붙여넣어 주세요.');
      return;
    }
    const items: ProductCarouselItem[] = parsed.map((p) => ({
      image_url: '',
      name: p.name,
      price: p.price || 0,
      ...(p.discount_price ? { discount_price: p.discount_price } : {}),
      link_url: p.link_url || '',
    }));
    onUpdate({ products: [...products, ...items] });
    setPasteText('');
    setPasteOpen(false);
    setPasteNote(`상품 ${items.length}개를 추가했어요. 이미지는 각 상품의 [연동 몰 매칭]으로 채울 수 있어요.`);
  };
  // 연동 몰 상품 → 슬라이드 항목 매핑 (정가=price, 할인가는 판매가<정가일 때만)
  const applyPicked = (picked: PickedMallProduct[]) => {
    const items: ProductCarouselItem[] = picked.map((p) => ({
      image_url: p.imageUrl || '',
      name: p.name,
      price: p.price,
      discount_price: p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : undefined,
      link_url: p.productUrl || '',
    }));
    onUpdate({ products: [...products, ...items] });
  };
  const setItem = (i: number, patch: Partial<ProductCarouselItem>) =>
    onUpdate({ products: products.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const move = (from: number, to: number) => { const a = [...products]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ products: a }); };
  // 상품명 → 연동 몰 정확 일치 → 이미지·정가·할인가·링크 자동 채움(빈 값만). 일치 없으면 조용히 무변경.
  const matchOne = async (i: number) => {
    const nm = (products[i]?.name || '').trim();
    if (!nm || matchingIdx !== null) return;
    setMatchingIdx(i);
    try {
      const res = await fetch(`/api/mall-products/match?name=${encodeURIComponent(nm)}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      const p = data?.product;
      if (p) {
        const cur = products[i] || ({} as ProductCarouselItem);
        setItem(i, {
          image_url: p.imageUrl || cur.image_url || '',
          price: p.price > 0 ? p.price : cur.price,
          discount_price: (p.salePrice > 0 && p.salePrice < p.price) ? p.salePrice : cur.discount_price,
          link_url: p.productUrl || cur.link_url || '',
        });
      }
    } catch {
      // 조용히 무변경 (일치 없거나 오류)
    } finally {
      setMatchingIdx(null);
    }
  };
  return (
    <>
      <Field label="제목 (선택)"><TextInput value={props.title} onChange={(v) => onUpdate({ title: v })} placeholder="이번 주 추천 상품" /></Field>
      <Field label="상품 목록">
        {/* ★ 2026-07-14 — 명시 단색(emerald-600+white). 옛 text-emerald-100+워시 배경은 흰 패널(DM 우측/아이템 카드)
            위에서 글자가 사라짐(Harold 신고 — 이메일·DM 공용 컴포넌트라 두 채널 동시 결함). 테마 경계 안전색 의무. */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full mb-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500 bg-emerald-600 text-white text-[13px] font-semibold py-2 hover:bg-emerald-500 transition-colors"
        >
          연동 몰에서 상품 불러오기
        </button>
        {/* ★ 2026-07-14 Harold 지시 — 상품 정보 붙여넣기(크레딧 0, 붙여넣은 숫자·URL 그대로) */}
        <button
          type="button"
          onClick={() => { setPasteOpen((v) => !v); setPasteNote(null); }}
          className="w-full mb-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-sky-500 bg-sky-600 text-white text-[13px] font-semibold py-2 hover:bg-sky-500 transition-colors"
        >
          상품 정보 붙여넣기
        </button>
        {pasteOpen && (
          <div className="mb-2 space-y-1.5">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={'상품명·가격·링크를 줄로 나눠 붙여넣기\n예)\n글로우 파운데이션 30ml\n85,000원 → 15% 72,250원\nhttps://store.example.com/products/123\n\n(빈 줄로 상품 구분, 최대 8개)'}
              className="w-full text-[12px] border border-gray-300 rounded-lg px-2.5 py-2 leading-relaxed focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={applyPaste}
              disabled={!pasteText.trim()}
              className="w-full text-[12px] font-semibold text-white border border-sky-500 bg-sky-600 hover:bg-sky-500 rounded-lg py-1.5 disabled:opacity-40 transition-colors"
            >
              붙여넣은 상품 추가
            </button>
          </div>
        )}
        {pasteNote && <div className="mb-2 text-[11px] text-gray-500 leading-relaxed">{pasteNote}</div>}
        <RepeatableList
          items={products}
          addLabel="+ 상품 추가"
          onAdd={() => onUpdate({ products: [...products, { image_url: '', name: '', price: 0 }] })}
          onRemove={(i) => onUpdate({ products: products.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(it, i) => (
            <>
              <ImageUploader label="상품 이미지" value={it.image_url} onChange={(url) => setItem(i, { image_url: url })} />
              <div style={{ height: 6 }} />
              <TextInput value={it.name} onChange={(v) => setItem(i, { name: v })} placeholder="상품명" />
              <div style={{ height: 6 }} />
              <button
                type="button"
                onClick={() => matchOne(i)}
                disabled={matchingIdx !== null || !it.name?.trim()}
                className="w-full text-[12px] font-semibold text-white border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 rounded-lg py-1.5 disabled:opacity-40 transition-colors"
              >
                {matchingIdx === i ? '몰에서 찾는 중...' : '이 상품명으로 몰 이미지 자동 채우기'}
              </button>
              <div style={{ height: 6 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <TextInput type="number" value={it.price} onChange={(v) => setItem(i, { price: v ? Number(v) : 0 })} placeholder="정가" />
                <TextInput type="number" value={it.discount_price} onChange={(v) => setItem(i, { discount_price: v ? Number(v) : undefined })} placeholder="할인가" />
              </div>
              <div style={{ height: 6 }} />
              <TextInput type="url" value={it.link_url} onChange={(v) => setItem(i, { link_url: v })} placeholder="상품 링크 https://" />
            </>
          )}
        />
      </Field>
      <Field label="인디케이터"><Toggle value={props.show_indicator ?? true} onChange={(v) => onUpdate({ show_indicator: v })} /></Field>
      <Field label="자동 슬라이드"><Toggle value={props.auto_slide ?? false} onChange={(v) => onUpdate({ auto_slide: v })} /></Field>
      <MallProductPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={applyPicked} />
    </>
  );
}
