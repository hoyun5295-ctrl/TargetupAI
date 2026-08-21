/**
 * SpecialCharsModal — 문자에서 깨지지 않는 기호 고르기 (★ 2026-08-21 Dashboard 인라인에서 분리)
 *
 * 기호 목록은 `utils/smsSafeChars.ts`(CT)가 소유한다. 여기는 고르는 화면만.
 * 고른 뒤 어디에 넣을지는 호출자가 안다(직접발송·타겟 발송 textarea가 다르다) → onPick으로 돌려준다.
 */

import { Type, Info } from 'lucide-react';
import { SMS_SAFE_CHARS } from '../../utils/smsSafeChars';
import ConsoleDialog, { CONSOLE_ACCENT, type ConsoleAccent } from './ConsoleDialog';

interface Props {
  show: boolean;
  accent: ConsoleAccent;
  onPick: (char: string) => void;
  onClose: () => void;
}

export default function SpecialCharsModal({ show, accent, onPick, onClose }: Props) {
  const tone = CONSOLE_ACCENT[accent];
  return (
    <ConsoleDialog
      show={show}
      accent={accent}
      icon={<Type className="w-4 h-4" strokeWidth={1.75} />}
      title="특수문자"
      subtitle="누르면 커서 위치에 들어갑니다"
      onClose={onClose}
    >
      <div className="px-5 py-4">
        <div className="grid grid-cols-8 gap-1.5">
          {SMS_SAFE_CHARS.map((char, i) => (
            <button
              key={`${i}-${char}`}
              type="button"
              onClick={() => onPick(char)}
              className={`h-10 grid place-items-center rounded-lg bg-white ring-1 ring-neutral-200 text-[17px] text-neutral-800 transition ${tone.hoverCell} focus:outline-none focus-visible:ring-2`}
            >
              {char}
            </button>
          ))}
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-neutral-500">
          <Info className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
          문자 발송에서 깨지지 않는 기호만 모았습니다
        </p>
      </div>
    </ConsoleDialog>
  );
}
