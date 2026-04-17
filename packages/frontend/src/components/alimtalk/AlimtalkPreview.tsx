/**
 * 알림톡 실시간 말풍선 미리보기
 *
 * 16조합(BA/EX/AD/MI × NONE/TEXT/IMAGE/ITEM_LIST) 전부 렌더링.
 * 카카오톡 말풍선 디자인 근사치.
 */

import type { AlimtalkButton } from './ButtonEditor';
import type { AlimtalkQuickReply } from './QuickReplyEditor';
import type { ItemHighlight, ItemListEntry, ItemSummary } from './ItemListEditor';

interface Props {
  messageType: 'BA' | 'EX' | 'AD' | 'MI';
  emphasizeType: 'NONE' | 'TEXT' | 'IMAGE' | 'ITEM_LIST';
  templateTitle?: string;
  templateSubtitle?: string;
  imageUrl?: string;
  content: string;
  extraContent?: string;
  adContent?: string;
  header?: string;
  highlight?: ItemHighlight | null;
  itemList?: ItemListEntry[];
  summary?: ItemSummary | null;
  buttons?: AlimtalkButton[];
  quickReplies?: AlimtalkQuickReply[];
  profileName?: string;
}

export default function AlimtalkPreview({
  messageType,
  emphasizeType,
  templateTitle,
  templateSubtitle,
  imageUrl,
  content,
  extraContent,
  adContent,
  header,
  highlight,
  itemList,
  summary,
  buttons,
  quickReplies,
  profileName,
}: Props) {
  const highlightVars = content
    ? content.split(/(#\{[^}]+\})/g).map((chunk, i) =>
        chunk.match(/^#\{[^}]+\}$/) ? (
          <span key={i} className="text-amber-700 bg-amber-100 px-1 rounded">
            {chunk}
          </span>
        ) : (
          <span key={i}>{chunk}</span>
        ),
      )
    : null;

  return (
    <div className="bg-gradient-to-b from-amber-50 to-amber-100/70 rounded-2xl p-4 max-w-sm mx-auto select-none">
      <p className="text-xs text-gray-500 mb-2">
        {profileName ? `@${profileName}` : '카카오톡 미리보기'}
      </p>

      <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-amber-200">
        {/* 알림톡 헤더 바 */}
        <div className="bg-amber-300 px-3 py-1.5 text-[11px] font-semibold text-amber-900">
          알림톡 도착
        </div>

        {/* 강조 TEXT */}
        {emphasizeType === 'TEXT' && templateTitle && (
          <div className="px-4 pt-3">
            {templateSubtitle && (
              <p className="text-[11px] text-gray-400">{templateSubtitle}</p>
            )}
            <p className="text-base font-bold text-gray-900 leading-tight">
              {templateTitle}
            </p>
          </div>
        )}

        {/* 강조 IMAGE */}
        {emphasizeType === 'IMAGE' && imageUrl && (
          <div className="w-full aspect-[2/1] bg-gray-100">
            <img src={imageUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        {/* ITEM_LIST */}
        {emphasizeType === 'ITEM_LIST' && (
          <div className="px-4 pt-3 space-y-2">
            {header && (
              <p className="text-[11px] font-semibold text-gray-500">{header}</p>
            )}
            {highlight && (
              <div className="flex items-center gap-3 bg-amber-50 rounded-lg p-2">
                {highlight.imageUrl && (
                  <img
                    src={highlight.imageUrl}
                    alt=""
                    className="w-12 h-12 rounded object-cover"
                  />
                )}
                <div className="flex-1">
                  <p className="text-[11px] text-gray-500">
                    {highlight.description}
                  </p>
                  <p className="text-sm font-bold text-gray-900">
                    {highlight.title}
                  </p>
                </div>
              </div>
            )}
            {itemList && itemList.length > 0 && (
              <div className="space-y-1 text-xs">
                {itemList.map((it, i) => (
                  <div key={i} className="flex justify-between py-1 border-b border-gray-100">
                    <span className="text-gray-500">{it.title}</span>
                    <span className="text-gray-900 font-medium">{it.description}</span>
                  </div>
                ))}
              </div>
            )}
            {summary && (
              <div className="flex justify-between pt-1 text-sm font-bold border-t border-gray-200">
                <span>{summary.title}</span>
                <span>{summary.description}</span>
              </div>
            )}
          </div>
        )}

        {/* 본문 */}
        <div className="px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
          {highlightVars || (
            <span className="text-gray-300">(본문이 비어있습니다)</span>
          )}
        </div>

        {/* 부가정보 (EX, MI) */}
        {['EX', 'MI'].includes(messageType) && extraContent && (
          <div className="px-4 pb-3 text-xs text-gray-500 whitespace-pre-wrap border-t border-dashed border-gray-200 pt-2">
            {extraContent}
          </div>
        )}

        {/* 버튼 */}
        {buttons && buttons.length > 0 && (
          <div className="px-2 pb-2 space-y-1">
            {buttons.map((b, i) => (
              <button
                key={i}
                type="button"
                className="w-full py-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
              >
                {b.name || '(버튼명 없음)'}
              </button>
            ))}
          </div>
        )}

        {/* 광고문구 (AD, MI) */}
        {['AD', 'MI'].includes(messageType) && adContent && (
          <div className="bg-gray-50 px-4 py-2 text-[11px] text-gray-400 border-t border-gray-200">
            {adContent}
          </div>
        )}
      </div>

      {/* 빠른답장 */}
      {quickReplies && quickReplies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {quickReplies.map((q, i) => (
            <span
              key={i}
              className="text-xs px-3 py-1 bg-white border border-amber-200 rounded-full text-amber-700"
            >
              {q.name || '(답장)'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
