/**
 * 알림톡 빠른답장 (quickReply) 에디터
 * - 최대 10개
 * - 타입 5종: WL/AL/BK/MD/BF
 */

export type QuickReplyType = 'WL' | 'AL' | 'BK' | 'MD' | 'BF';

export interface AlimtalkQuickReply {
  type: QuickReplyType;
  name: string;
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
  chatExtra?: string;
  chatEvent?: string;
  bizFormId?: number;
}

interface Props {
  replies: AlimtalkQuickReply[];
  onChange: (replies: AlimtalkQuickReply[]) => void;
  disabled?: boolean;
  max?: number;
}

const TYPES: { value: QuickReplyType; label: string }[] = [
  { value: 'WL', label: '웹링크' },
  { value: 'AL', label: '앱링크' },
  { value: 'BK', label: '봇키워드' },
  { value: 'MD', label: '메시지전달' },
  { value: 'BF', label: '비즈폼' },
];

export default function QuickReplyEditor({
  replies,
  onChange,
  disabled,
  max = 10,
}: Props) {
  const add = () => {
    if (replies.length >= max) return;
    onChange([...replies, { type: 'WL', name: '' }]);
  };

  const remove = (idx: number) =>
    onChange(replies.filter((_, i) => i !== idx));

  const update = (idx: number, patch: Partial<AlimtalkQuickReply>) => {
    const next = replies.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-600">
          빠른답장 <span className="text-gray-400">({replies.length}/{max})</span>
        </label>
        <button
          type="button"
          disabled={disabled || replies.length >= max}
          onClick={add}
          className="text-xs text-amber-600 hover:text-amber-700 disabled:text-gray-300"
        >
          + 빠른답장 추가
        </button>
      </div>

      {replies.length === 0 && (
        <p className="text-xs text-gray-400">추가된 빠른답장이 없습니다.</p>
      )}

      {replies.map((r, idx) => (
        <div key={idx} className="mb-2 bg-amber-50/50 p-2 rounded-lg space-y-1.5">
          <div className="flex gap-2 items-center">
            <span className="text-[11px] text-gray-400 w-6">{idx + 1}.</span>
            <select
              value={r.type}
              disabled={disabled}
              onChange={(e) =>
                update(idx, { type: e.target.value as QuickReplyType })
              }
              className="border border-gray-300 rounded px-2 py-1 text-xs w-24 disabled:bg-gray-200"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input
              value={r.name}
              disabled={disabled}
              onChange={(e) => update(idx, { name: e.target.value })}
              placeholder="답장명 (최대 14자)"
              maxLength={14}
              className="border border-gray-300 rounded px-2 py-1 text-xs flex-1 disabled:bg-gray-200"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              disabled={disabled}
              className="text-sm px-1 text-red-400 hover:text-red-600 disabled:text-gray-300"
            >
              &times;
            </button>
          </div>

          {r.type === 'WL' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={r.urlMobile || ''}
                onChange={(e) => update(idx, { urlMobile: e.target.value })}
                placeholder="모바일 URL"
                className="border border-gray-300 rounded px-2 py-1 text-xs"
              />
              <input
                value={r.urlPc || ''}
                onChange={(e) => update(idx, { urlPc: e.target.value })}
                placeholder="PC URL"
                className="border border-gray-300 rounded px-2 py-1 text-xs"
              />
            </div>
          )}

          {r.type === 'AL' && (
            <div className="grid grid-cols-2 gap-2">
              <input
                value={r.schemeAndroid || ''}
                onChange={(e) => update(idx, { schemeAndroid: e.target.value })}
                placeholder="Android scheme"
                className="border border-gray-300 rounded px-2 py-1 text-xs"
              />
              <input
                value={r.schemeIos || ''}
                onChange={(e) => update(idx, { schemeIos: e.target.value })}
                placeholder="iOS scheme"
                className="border border-gray-300 rounded px-2 py-1 text-xs"
              />
            </div>
          )}

          {r.type === 'MD' && (
            <input
              value={r.chatExtra || ''}
              onChange={(e) => update(idx, { chatExtra: e.target.value })}
              placeholder="chatExtra"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
            />
          )}

          {r.type === 'BK' && (
            <input
              value={r.chatEvent || ''}
              onChange={(e) => update(idx, { chatEvent: e.target.value })}
              placeholder="chatEvent"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
            />
          )}

          {r.type === 'BF' && (
            <input
              type="number"
              value={r.bizFormId ?? ''}
              onChange={(e) =>
                update(idx, {
                  bizFormId: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              placeholder="bizFormId"
              className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
            />
          )}
        </div>
      ))}
    </div>
  );
}
