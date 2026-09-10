/**
 * SmsCharsetNotice — 문자로 보낼 수 없는 글자 알림 + 한 번에 바꾸기 (2026-09-10 신설)
 *
 * 설계 = docs/2026-09-10-unsupported-char-substitution-design.md §4-1 (P2).
 * 판정·대체표는 `utils/smsSafeChars.ts`(CT)가 소유한다. 여기는 보여 주고, 고객이 누르면 바꾸는 화면만.
 * ⛔ 고객이 버튼을 눌렀을 때만 바꾼다(몰래 바꾸기 0 · 불변 1). 표에 없는 글자는 표시만 한다(불변 3).
 * ⛔ 작성 화면 전용이다. 발송 경로에서 문안을 바꾸는 데 쓰지 않는다(B-0910-4).
 * 화면은 `onApply(fix)`로 받은 함수를 자기 상태(본문·제목) 전부에 한 번에 적용한다.
 *   한 상태 객체에 본문·제목이 같이 있는 화면에서 두 번 나눠 쓰면 앞의 변경이 덮이기 때문이다.
 */
import type { MouseEvent } from 'react';
import { AlertTriangle, Wand2 } from 'lucide-react';
import { findUnsupportedSmsChars, substituteSmsChars } from '../utils/smsSafeChars';

interface SmsCharsetNoticeProps {
  /** 검사할 문장(본문·제목 등). 비어 있으면 건너뛴다. */
  texts: Array<string | null | undefined>;
  /** "비슷한 글자로 바꾸기"를 누르면 부른다. fix = 대체표로 바꾼 문장을 돌려주는 함수. */
  onApply: (fix: (text: string) => string) => void;
  tone?: 'light' | 'dark';
  className?: string;
}

const TONES = {
  light: {
    box: 'border-amber-200 bg-amber-50',
    icon: 'text-amber-500',
    title: 'text-amber-900',
    desc: 'text-amber-800/80',
    chip: 'bg-white border-amber-200 text-slate-700',
    arrow: 'text-amber-500',
    count: 'text-amber-600',
    button: 'bg-amber-500 hover:bg-amber-600 text-white',
    badChip: 'bg-white border-rose-200 text-rose-700',
    badText: 'text-rose-700',
  },
  dark: {
    box: 'border-amber-400/30 bg-amber-500/10',
    icon: 'text-amber-300',
    title: 'text-amber-100',
    desc: 'text-amber-200/70',
    chip: 'bg-white/5 border-white/10 text-white/85',
    arrow: 'text-amber-300',
    count: 'text-amber-300/80',
    button: 'bg-amber-400 hover:bg-amber-300 text-slate-950',
    badChip: 'bg-rose-500/10 border-rose-400/30 text-rose-200',
    badText: 'text-rose-200/90',
  },
} as const;

/** 눈에 안 보이는 글자는 이름으로 보여 준다. */
function charLabel(ch: string, code: string): string {
  if (ch === '\u00A0') return '특수 공백';
  if (ch === '\uFE0E' || ch === '\uFE0F') return '이모지 표시 기호';
  if (/^[\u200B-\u200F\uFEFF]$/.test(ch)) return '보이지 않는 글자';
  if (/[\p{C}\p{Z}\p{M}]/u.test(ch)) return code;
  return ch;
}

function replacementLabel(rep: string): string {
  if (rep === '') return '지움';
  if (rep === ' ') return '공백';
  return rep;
}

export default function SmsCharsetNotice({ texts, onApply, tone = 'light', className = '' }: SmsCharsetNoticeProps) {
  const found = findUnsupportedSmsChars(texts.filter(Boolean).join('\n'));
  if (found.length === 0) return null;

  const t = TONES[tone];
  // 같은 모양으로 보이는 행(보이지 않는 글자 여럿 등)은 한 칩으로 묶는다.
  const fixable = new Map<string, { from: string; to: string; count: number; title: string }>();
  for (const f of found) {
    if (f.replacement === null) continue;
    const from = charLabel(f.char, f.code);
    const to = replacementLabel(f.replacement);
    const key = `${from}>${to}`;
    const hit = fixable.get(key);
    if (hit) { hit.count += f.count; hit.title += ` ${f.code}`; }
    else fixable.set(key, { from, to, count: f.count, title: f.code });
  }
  const unfixable = found.filter((f) => f.replacement === null);

  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <div onClick={stop} className={`rounded-xl border px-3 py-2.5 ${t.box} ${className}`} role="status">
      <div className="flex items-start gap-2">
        <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${t.icon}`} />
        <div className="min-w-0 flex-1">
          <p className={`text-[12.5px] font-semibold ${t.title}`}>문자로 보낼 수 없는 글자가 있습니다</p>
          <p className={`text-[11.5px] mt-0.5 leading-relaxed ${t.desc}`}>
            이대로 보내면 받는 휴대폰에서 글자가 깨지거나 발송이 반려됩니다.
          </p>

          {fixable.size > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {Array.from(fixable.values()).map((f) => (
                <span key={`${f.from}>${f.to}`} title={f.title} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] ${t.chip}`}>
                  <span>{f.from}</span>
                  <span className={t.arrow}>→</span>
                  <span className="font-semibold">{f.to}</span>
                  {f.count > 1 && <span className={`text-[10.5px] ${t.count}`}>{f.count}곳</span>}
                </span>
              ))}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onApply(substituteSmsChars); }}
                className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[12px] font-semibold transition-colors ${t.button}`}
              >
                <Wand2 className="w-3.5 h-3.5" />
                비슷한 글자로 바꾸기
              </button>
            </div>
          )}

          {unfixable.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`text-[11.5px] ${t.badText}`}>바꿀 글자가 없어 직접 지워 주세요</span>
              {unfixable.map((f) => (
                <span key={f.code} title={f.code} className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[12px] ${t.badChip}`}>
                  {charLabel(f.char, f.code)}
                  {f.count > 1 && <span className="ml-1 text-[10.5px] opacity-80">{f.count}곳</span>}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
