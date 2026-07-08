import type { ProductCarouselProps, ProductCarouselItem } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Toggle, ImageUploader } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';
import { useState } from 'react';
import MallProductPickerModal, { type PickedMallProduct } from '../../MallProductPickerModal';

export default function ProductCarouselEditor({ props, onUpdate }: EditorProps<ProductCarouselProps>) {
  const products = props.products || [];
  const [pickerOpen, setPickerOpen] = useState(false);
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
  return (
    <>
      <Field label="제목 (선택)"><TextInput value={props.title} onChange={(v) => onUpdate({ title: v })} placeholder="이번 주 추천 상품" /></Field>
      <Field label="상품 목록">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full mb-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 text-emerald-100 text-[13px] font-medium py-2 hover:bg-emerald-500/20 transition-colors"
        >
          연동 몰에서 상품 불러오기
        </button>
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
