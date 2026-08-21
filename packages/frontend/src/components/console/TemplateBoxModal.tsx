/**
 * TemplateBoxModal — 보관함(저장해 둔 문자 불러오기) (★ 2026-08-21 Dashboard 인라인에서 분리)
 *
 * 기능은 그대로다: 목록 · 긴 본문 전문 보기 토글(D182, 직원 신고: 두 줄로 잘려 전문 확인 불가) ·
 *   hover 때 나오는 삭제 · 적용하기. 적용 시 무엇을 어디에 복원할지(제목·유형·광고 체크·MMS 이미지)는
 *   호출자(Dashboard)가 안다 → onApply(template)로 돌려준다.
 *
 * 전문 보기 토글은 화면 상태라 여기가 갖는다(Dashboard의 expandedTemplateIds를 옮겨 왔다).
 */

import { useState } from 'react';
import { Archive, Trash2, ChevronDown, ChevronUp, Inbox } from 'lucide-react';
import { CUI_EMPTY_BADGE, CUI_EMPTY_DESC, CUI_EMPTY_TITLE } from '../../utils/console-ui';
import ConsoleDialog, { CONSOLE_ACCENT, CONSOLE_BTN_BASE, type ConsoleAccent } from './ConsoleDialog';

export interface SavedTemplate {
  id: string;
  template_name: string;
  content: string;
  message_type?: string;
  subject?: string | null;
  is_ad?: boolean | null;
  mms_image_paths?: unknown;
}

interface Props {
  show: boolean;
  accent: ConsoleAccent;
  templates: SavedTemplate[];
  onApply: (t: SavedTemplate) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function TemplateBoxModal({ show, accent, templates, onApply, onDelete, onClose }: Props) {
  const tone = CONSOLE_ACCENT[accent];
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpandedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <ConsoleDialog
      show={show}
      accent={accent}
      icon={<Archive className="w-4 h-4" strokeWidth={1.75} />}
      title="보관함"
      subtitle={templates.length > 0 ? `저장된 문자 ${templates.length}건` : undefined}
      maxW="max-w-[520px]"
      onClose={onClose}
    >
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {templates.length === 0 ? (
          <div className="py-12 grid place-items-center text-center">
            <div className={CUI_EMPTY_BADGE}>
              <Inbox className="w-5 h-5" strokeWidth={1.6} />
            </div>
            <p className={CUI_EMPTY_TITLE}>저장된 문자가 없습니다</p>
            <p className={CUI_EMPTY_DESC}>문자를 작성한 뒤 "문자 저장"을 누르면 여기에 쌓입니다</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {templates.map((t) => {
              const content = String(t.content || '');
              const isLong = content.length > 80 || content.split('\n').length > 2;
              const open = expandedIds.has(t.id);
              return (
                <li key={t.id} className="group rounded-xl bg-white ring-1 ring-neutral-200 p-4 transition hover:ring-neutral-300">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[13.5px] font-semibold text-neutral-900 truncate">{t.template_name}</p>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {t.message_type && (
                        <span className={`h-[22px] px-2 inline-flex items-center rounded-full text-[11.5px] font-semibold ${tone.pill}`}>{t.message_type}</span>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(t.id)}
                        aria-label="삭제"
                        title="삭제"
                        className="h-7 w-7 grid place-items-center rounded-md text-neutral-400 opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600/25"
                      >
                        <Trash2 className="w-[15px] h-[15px]" strokeWidth={1.75} />
                      </button>
                    </div>
                  </div>
                  <p
                    onClick={() => { if (isLong) toggle(t.id); }}
                    className={`mt-2 text-[12.5px] leading-relaxed text-neutral-600 whitespace-pre-wrap break-words ${open ? '' : 'line-clamp-2'} ${isLong ? 'cursor-pointer' : ''}`}
                  >
                    {content}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    {isLong ? (
                      <button type="button" onClick={() => toggle(t.id)} className={`inline-flex items-center gap-1 text-[12px] font-medium ${tone.link}`}>
                        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {open ? '접기' : '전문 보기'}
                      </button>
                    ) : <span />}
                    <button type="button" onClick={() => onApply(t)} className={`${CONSOLE_BTN_BASE} ${tone.primary}`}>
                      적용하기
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ConsoleDialog>
  );
}
