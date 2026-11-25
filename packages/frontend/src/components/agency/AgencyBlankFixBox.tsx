/**
 * AgencyBlankFixBox — 요청서 원스텝 확인 화면의 「채우지 않은 자리」 상자(★ 2026-11-25 · 설계서 docs/2026-11-25-agency-intake-slip-multisheet-design.md §4).
 *
 * 서버가 찾은 빈 자리(위치 = 미리보기 baseContent)마다:
 *   - 명단에 맞는 열이 있으면 1클릭 채우기(「점」이 값마다 다르면 단추 둘 · 단추마다 실제로 나갈 모습과 어긋나는 사람 수 · 자동 교정 0)
 *   - 열이 없으면 두 길(한 매장 = 이름 적고 바꾸기 · 여러 매장 = 명단에 열을 넣어 다시 올리기)
 *   - [그대로 두기] = 이 화면에서 접기만(승인 때 한 번 더 확인한다)
 * 채우기는 조정값 slotFills 로 서버가 다시 분석한다(화면이 문안을 직접 바꾸지 않는다 = 미리보기 = 접수 같은 글).
 * ⛔ 문구에 줄표 0 · 가운뎃점 0 · native dialog 0.
 */
import { useState } from 'react';
import { AlertTriangle, Check, RotateCcw } from 'lucide-react';
import { CUI_BTN_GHOST, CUI_BTN_OUTLINE, CUI_BTN_PRIMARY, CUI_INPUT } from '../../utils/console-ui';
import type { AgencyBlankWithCandidates, AgencyBlankCandidate, AgencySlotFill } from './agency-send-api';

interface Props {
  blanks: AgencyBlankWithCandidates[];
  fills: AgencySlotFill[];
  onChange: (fills: AgencySlotFill[]) => void;
  /** 문안에 이미 쓴 항목 수(4개면 열로 채울 수 없다) */
  varCount: number;
  disabled?: boolean;
  /** [파일 다시 고르기] */
  onRedoFile: () => void;
}

interface FillOption { key: string; label: string; fill: AgencySlotFill; result: string; wrong: number; wrongNote: string }

/** 한 후보 열에서 낼 수 있는 채우기 단추들(점 케바케 · 설계서 §4-3) */
function optionsFor(b: AgencyBlankWithCandidates, c: AgencyBlankCandidate): FillOption[] {
  const whole: AgencySlotFill = { start: b.start, end: b.end + b.suffix.length, before: b.label, column: c.column };
  if (b.kind !== 'mark' || !b.suffix) {
    const ex = c.exampleWithSuffix || c.exampleWithoutSuffix;
    return [{ key: `${c.column}:all`, label: `「${c.column}」 열로 채우기`, fill: whole, result: ex, wrong: 0, wrongNote: '' }];
  }
  const head: AgencySlotFill = { start: b.start, end: b.end, before: b.text, column: c.column };
  const both: FillOption[] = [
    {
      key: `${c.column}:whole`, label: `${b.label} 통째로 「${c.column}」 값`, fill: whole,
      result: c.exampleWithSuffix || c.exampleWithoutSuffix, wrong: c.notSuffix,
      wrongNote: c.notSuffix > 0 ? `${c.notSuffix.toLocaleString()}명은 ${c.exampleWithoutSuffix}처럼 ${b.suffix} 없이 나갑니다` : '',
    },
    {
      key: `${c.column}:head`, label: `${b.text}만 「${c.column}」 값`, fill: head,
      result: (c.exampleWithoutSuffix || c.exampleWithSuffix) + b.suffix, wrong: c.endsWithSuffix,
      wrongNote: c.endsWithSuffix > 0 ? `${c.endsWithSuffix.toLocaleString()}명은 ${c.exampleWithSuffix}${b.suffix}처럼 나갑니다` : '',
    },
  ];
  if (c.notSuffix === 0) return [both[0]];
  if (c.endsWithSuffix === 0) return [both[1]];
  // 섞임 = 둘 다 · 틀리게 나갈 사람이 적은 쪽이 앞(주 단추)
  return both.sort((x, y) => x.wrong - y.wrong);
}

export default function AgencyBlankFixBox({ blanks, fills, onChange, varCount, disabled, onRedoFile }: Props) {
  const [names, setNames] = useState<Record<number, string>>({});
  const [kept, setKept] = useState<Set<number>>(new Set());
  if (blanks.length === 0) return null;
  const fillOf = (b: AgencyBlankWithCandidates) => fills.find((f) => f.start === b.start);
  const setFill = (b: AgencyBlankWithCandidates, f: AgencySlotFill | null) => {
    onChange([...fills.filter((x) => x.start !== b.start), ...(f ? [f] : [])]);
  };
  const open = blanks.filter((b) => !kept.has(b.start));
  if (open.length === 0) return null;
  const varsFull = varCount >= 4;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50/70 px-4 py-3 space-y-3 break-keep">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-amber-900">
        <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2} />
        문안에 채우지 않은 자리가 있습니다
      </p>
      {open.map((b) => {
        const filled = fillOf(b);
        const cands = b.candidates;
        return (
          <div key={b.start} className="rounded-lg bg-white ring-1 ring-amber-200 px-3 py-2.5 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center h-[26px] px-2 rounded-md bg-amber-100 text-amber-900 text-[12.5px] font-bold">{b.label}</span>
              {filled ? (
                <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-emerald-700">
                  <Check className="w-3.5 h-3.5" strokeWidth={2.25} />
                  {filled.column ? `「${filled.column}」 열 값으로 채웁니다` : `「${filled.text}」(으)로 바꿉니다`}
                </span>
              ) : (
                <span className="text-[12px] text-amber-800">이대로 접수하면 받는 분 모두에게 {b.label} 글자 그대로 나갑니다.</span>
              )}
            </div>

            {filled ? (
              <button type="button" disabled={disabled} onClick={() => setFill(b, null)} className={`${CUI_BTN_GHOST} h-8 text-[12.5px]`}>
                <RotateCcw className="w-3.5 h-3.5" />되돌리기
              </button>
            ) : (
              <>
                {cands.length > 0 && !varsFull && (
                  <div className="space-y-1.5">
                    {cands.flatMap((c) => optionsFor(b, c)).map((o, i) => (
                      <div key={o.key} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
                        <button type="button" disabled={disabled} onClick={() => setFill(b, o.fill)}
                          className={`${i === 0 ? CUI_BTN_PRIMARY : CUI_BTN_OUTLINE} h-9 text-[12.5px] justify-center sm:justify-start`}>
                          {o.label}
                        </button>
                        <span className="text-[12px] text-neutral-600">
                          {o.result ? `첫 고객은 ${o.result}(으)로 나갑니다.` : ''}{o.wrongNote ? ` ${o.wrongNote}.` : ''}
                        </span>
                      </div>
                    ))}
                    {cands.some((c) => c.notSuffix > 0 && c.endsWithSuffix > 0) && (
                      <p className="text-[12px] text-neutral-600">모두 맞게 보내려면 명단 값을 하나로 맞춰 다시 올려 주세요.</p>
                    )}
                  </div>
                )}
                {cands.length > 0 && varsFull && (
                  <p className="text-[12px] text-neutral-700">문안 항목은 4개까지라 열로 채울 수 없습니다. 아래에 이름을 적거나 항목 하나를 빼 주세요.</p>
                )}
                {cands.length === 0 && (
                  <p className="text-[12px] text-neutral-700">
                    명단에 이 자리를 채울 열이 없습니다. 한 매장에만 보내신다면 매장 이름을 적어 주세요. 매장마다 다르면 명단에 매장명 열을 넣고 다시 올려 주세요.
                  </p>
                )}
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={names[b.start] || ''}
                    onChange={(e) => setNames({ ...names, [b.start]: e.target.value })}
                    placeholder={b.kind === 'mark' && b.suffix ? `예: 강남${b.suffix}` : '넣을 이름'}
                    disabled={disabled}
                    className={`${CUI_INPUT} sm:max-w-[220px]`}
                    aria-label={`${b.label} 자리에 넣을 이름`}
                  />
                  <button type="button" disabled={disabled || !(names[b.start] || '').trim()}
                    onClick={() => setFill(b, { start: b.start, end: b.end + b.suffix.length, before: b.label, text: (names[b.start] || '').trim() })}
                    className={`${CUI_BTN_OUTLINE} h-9 text-[12.5px] justify-center`}>
                    이 이름으로 바꾸기
                  </button>
                  {cands.length === 0 && (
                    <button type="button" disabled={disabled} onClick={onRedoFile} className={`${CUI_BTN_GHOST} h-9 text-[12.5px] justify-center`}>
                      파일 다시 고르기
                    </button>
                  )}
                  <button type="button" disabled={disabled} onClick={() => setKept(new Set([...kept, b.start]))} className={`${CUI_BTN_GHOST} h-9 text-[12.5px] justify-center`}>
                    그대로 두기
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
