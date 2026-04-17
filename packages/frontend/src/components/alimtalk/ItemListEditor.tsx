/**
 * 알림톡 ITEM_LIST 강조 유형 에디터
 *
 * 구성:
 *   - templateHeader (최대 16자)
 *   - templateItemHighlight { title, description, imageUrl? }
 *   - templateItem.list [{ title, description }, ...]  (최대 10개)
 *   - templateItem.summary { title, description } (선택)
 */

import KakaoChannelImageUpload from './KakaoChannelImageUpload';

export interface ItemHighlight {
  title: string;
  description: string;
  imageUrl?: string;
  imageName?: string;
}

export interface ItemListEntry {
  title: string;
  description: string;
}

export interface ItemSummary {
  title: string;
  description: string;
}

interface Props {
  header: string;
  onHeaderChange: (v: string) => void;
  highlight: ItemHighlight | null;
  onHighlightChange: (v: ItemHighlight | null) => void;
  list: ItemListEntry[];
  onListChange: (v: ItemListEntry[]) => void;
  summary: ItemSummary | null;
  onSummaryChange: (v: ItemSummary | null) => void;
  disabled?: boolean;
}

export default function ItemListEditor({
  header, onHeaderChange,
  highlight, onHighlightChange,
  list, onListChange,
  summary, onSummaryChange,
  disabled,
}: Props) {
  const addRow = () => {
    if (list.length >= 10) return;
    onListChange([...list, { title: '', description: '' }]);
  };
  const removeRow = (i: number) => onListChange(list.filter((_, idx) => idx !== i));
  const patchRow = (i: number, p: Partial<ItemListEntry>) => {
    const next = list.slice();
    next[i] = { ...next[i], ...p };
    onListChange(next);
  };

  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
      <p className="text-xs font-semibold text-amber-700">아이템리스트 구성</p>

      {/* 헤더 */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          헤더 <span className="text-gray-400">(최대 16자, 선택)</span>
        </label>
        <input
          value={header}
          onChange={(e) => onHeaderChange(e.target.value)}
          maxLength={16}
          disabled={disabled}
          placeholder="예: 주문 내역"
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:bg-gray-100"
        />
      </div>

      {/* Highlight */}
      <div className="space-y-2 rounded-lg bg-white p-2 border border-gray-200">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-700">하이라이트 영역</label>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onHighlightChange(
                highlight
                  ? null
                  : { title: '', description: '' },
              )
            }
            className="text-xs text-amber-600 hover:text-amber-700"
          >
            {highlight ? '사용 안 함' : '+ 사용'}
          </button>
        </div>

        {highlight && (
          <>
            <input
              value={highlight.title}
              disabled={disabled}
              onChange={(e) =>
                onHighlightChange({ ...highlight, title: e.target.value })
              }
              placeholder="타이틀 (최대 30자)"
              maxLength={30}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
            />
            <input
              value={highlight.description}
              disabled={disabled}
              onChange={(e) =>
                onHighlightChange({ ...highlight, description: e.target.value })
              }
              placeholder="설명 (최대 19자)"
              maxLength={19}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
            />
            <KakaoChannelImageUpload
              uploadType="alimtalk_highlight"
              value={highlight.imageUrl || ''}
              onChange={(url, name) =>
                onHighlightChange({ ...highlight, imageUrl: url, imageName: name })
              }
              disabled={disabled}
            />
          </>
        )}
      </div>

      {/* List */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-gray-700">
            아이템 목록 <span className="text-gray-400">({list.length}/10)</span>
          </label>
          <button
            type="button"
            disabled={disabled || list.length >= 10}
            onClick={addRow}
            className="text-xs text-amber-600 hover:text-amber-700 disabled:text-gray-300"
          >
            + 아이템 추가
          </button>
        </div>
        {list.length === 0 && (
          <p className="text-xs text-gray-400">최소 1개 이상의 아이템을 추가하세요.</p>
        )}
        {list.map((item, i) => (
          <div key={i} className="mb-2 flex gap-2 items-center">
            <span className="text-[11px] text-gray-400 w-5">{i + 1}</span>
            <input
              value={item.title}
              disabled={disabled}
              onChange={(e) => patchRow(i, { title: e.target.value })}
              placeholder="제목 (최대 6자)"
              maxLength={6}
              className="border border-gray-300 rounded px-2 py-1 text-sm w-28 disabled:bg-gray-100"
            />
            <input
              value={item.description}
              disabled={disabled}
              onChange={(e) => patchRow(i, { description: e.target.value })}
              placeholder="설명 (최대 23자)"
              maxLength={23}
              className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 disabled:bg-gray-100"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={disabled}
              className="text-sm px-1 text-red-400 hover:text-red-600 disabled:text-gray-300"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="space-y-2 rounded-lg bg-white p-2 border border-gray-200">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-700">요약 영역</label>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onSummaryChange(summary ? null : { title: '', description: '' })
            }
            className="text-xs text-amber-600 hover:text-amber-700"
          >
            {summary ? '사용 안 함' : '+ 사용'}
          </button>
        </div>

        {summary && (
          <>
            <input
              value={summary.title}
              disabled={disabled}
              onChange={(e) => onSummaryChange({ ...summary, title: e.target.value })}
              placeholder="요약 제목 (최대 6자)"
              maxLength={6}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
            />
            <input
              value={summary.description}
              disabled={disabled}
              onChange={(e) =>
                onSummaryChange({ ...summary, description: e.target.value })
              }
              placeholder="요약 설명 (최대 23자)"
              maxLength={23}
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm disabled:bg-gray-100"
            />
          </>
        )}
      </div>
    </div>
  );
}
