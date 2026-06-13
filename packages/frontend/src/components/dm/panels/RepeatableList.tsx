/**
 * RepeatableList — 반복 항목(상품/이미지/슬라이드/탭/옵션/질문/세그먼트/매장/리뷰) 공용 편집 리스트.
 * 추가·삭제·순서이동(↑↓). 각 항목 렌더는 호출부가 renderItem으로 주입.
 */
import type { ReactNode, CSSProperties } from 'react';

const miniBtn: CSSProperties = {
  width: 20, height: 20, borderRadius: 4, border: '1px solid var(--dm-neutral-200)',
  background: 'var(--dm-bg)', color: 'var(--dm-neutral-700)', fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: 0,
};
const addBtn: CSSProperties = {
  width: '100%', padding: 8, border: '1px dashed var(--dm-neutral-300)', borderRadius: 6,
  background: 'var(--dm-bg)', color: 'var(--dm-primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};

export function RepeatableList<T>({
  items, renderItem, onAdd, onRemove, onMove, addLabel = '+ 추가', max,
}: {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove?: (from: number, to: number) => void;
  addLabel?: string;
  max?: number;
}) {
  const list = Array.isArray(items) ? items : [];
  return (
    <div>
      {list.map((item, i) => (
        <div key={i} style={{ border: '1px solid var(--dm-neutral-200)', borderRadius: 6, padding: 8, marginBottom: 8, background: 'var(--dm-neutral-50)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--dm-neutral-500)' }}>#{i + 1}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {onMove && i > 0 && <button type="button" onClick={() => onMove(i, i - 1)} style={miniBtn}>↑</button>}
              {onMove && i < list.length - 1 && <button type="button" onClick={() => onMove(i, i + 1)} style={miniBtn}>↓</button>}
              <button type="button" onClick={() => onRemove(i)} style={{ ...miniBtn, color: '#dc2626' }}>✕</button>
            </div>
          </div>
          {renderItem(item, i)}
        </div>
      ))}
      {(max === undefined || list.length < max) && (
        <button type="button" onClick={onAdd} style={addBtn}>{addLabel}</button>
      )}
      {max !== undefined && list.length >= max && (
        <div style={{ fontSize: 10, color: 'var(--dm-neutral-500)', textAlign: 'center', marginTop: 4 }}>최대 {max}개</div>
      )}
    </div>
  );
}
