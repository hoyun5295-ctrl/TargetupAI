/**
 * TemplateSaveModal — 작성 중인 문자를 보관함에 저장 (★ 2026-08-21 Dashboard 인라인에서 분리)
 *
 * 이름 입력 + 저장될 내용 미리보기 + 취소/저장. 저장 요청(내용·유형·제목·MMS 이미지 묶기)은
 *   호출자(Dashboard)가 안다 → onSave()로 넘긴다. 이름 값은 호출자 state(templateSaveName)를 그대로 쓴다:
 *   열 때마다 비우는 쪽이 호출부(TargetSendModal·DirectSendPanel)라서다.
 */

import { Save } from 'lucide-react';
import { CUI_LABEL, CUI_BTN_OUTLINE } from '../../utils/console-ui';
import ConsoleDialog, { CONSOLE_ACCENT, CONSOLE_BTN_BASE, type ConsoleAccent } from './ConsoleDialog';

interface Props {
  show: boolean;
  accent: ConsoleAccent;
  name: string;
  onNameChange: (v: string) => void;
  /** 저장될 본문(미리보기) */
  preview: string;
  onSave: () => void;
  onClose: () => void;
}

export default function TemplateSaveModal({ show, accent, name, onNameChange, preview, onSave, onClose }: Props) {
  const tone = CONSOLE_ACCENT[accent];
  return (
    <ConsoleDialog
      show={show}
      accent={accent}
      icon={<Save className="w-4 h-4" strokeWidth={1.75} />}
      title="문자 저장"
      subtitle="보관함에서 언제든 다시 불러올 수 있습니다"
      onClose={onClose}
      footer={
        <div className="shrink-0 px-5 py-4 border-t border-neutral-200 bg-neutral-50 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={CUI_BTN_OUTLINE}>취소</button>
          <button type="button" onClick={onSave} disabled={!name.trim()} className={`${CONSOLE_BTN_BASE} ${tone.primary}`}>
            <Save className="w-[15px] h-[15px]" strokeWidth={1.75} />
            저장하기
          </button>
        </div>
      }
    >
      <form
        className="px-5 py-4 space-y-4"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(); }}
      >
        <div>
          <label htmlFor="template-save-name" className={CUI_LABEL}>저장할 이름</label>
          <input
            id="template-save-name"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="예: VIP 할인 안내, 봄 신상품 홍보"
            autoFocus
            className={`w-full h-9 px-3 rounded-lg bg-white border border-neutral-200 text-[13.5px] text-neutral-900 transition placeholder:text-neutral-400 hover:border-neutral-300 focus:outline-none focus:ring-4 ${tone.focusField}`}
          />
        </div>
        <div className="rounded-xl bg-neutral-50 ring-1 ring-neutral-200/70 px-3.5 py-3">
          <p className="text-[11.5px] font-medium text-neutral-500 mb-1">저장될 내용</p>
          <p className="text-[13px] leading-relaxed text-neutral-700 whitespace-pre-wrap break-words line-clamp-4">{preview}</p>
        </div>
      </form>
    </ConsoleDialog>
  );
}
