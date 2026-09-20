/**
 * BrandPickMenu — 브랜드메시지 발송 창의 한 줄 선택 버튼 + 펼침 목록 (★ 2026-09-20 신설)
 *
 * 왜 만들었나:
 *   발신 프로필·타겟팅이 브라우저 기본 `<select>`였고 옵션에 「라벨: 설명」을 통째로 넣어,
 *   칸 폭보다 긴 글자가 잘렸다(Harold 접수). 기본 select는 닫힌 상태의 글자를 줄바꿈할 수 없다.
 *   그래서 버튼에는 **이름만** 두고, 설명은 펼친 목록의 각 줄에서 줄바꿈으로 다 보여준다.
 *
 * 동작:
 *   · 바깥 클릭·ESC로 닫힌다. ESC는 **캡처 단계에서 먼저 잡아** 뒤의 발송 창(SendWorkspaceShell의
 *     window keydown)까지 닫히지 않게 한다 — 목록만 닫으려다 작성 중인 창이 통째로 닫히면 작업 손실이다.
 *   · 위·아래 화살표로 이동, Enter·Space로 선택.
 *   · 목록은 버튼 아래 absolute다. 부모에 `overflow:hidden`이 있으면 잘리므로(LESSONS_FRONTEND 0714)
 *     이 컴포넌트를 넣는 자리의 조상에 overflow:hidden을 두지 않는다.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface BrandPickOption {
  value: string;
  title: string;
  /** 목록 줄에만 보이는 설명 — 버튼에는 싣지 않는다 */
  desc?: string;
  /** 목록 줄 앞의 짧은 표식(타겟팅 코드 등) */
  tag?: string;
}

export type BrandPickAccent = 'violet' | 'indigo';

const TONE = {
  violet: { open: 'ring-2 ring-violet-500/50', on: 'bg-violet-50', check: 'text-violet-600', tagOn: 'bg-white text-violet-700 ring-1 ring-violet-200' },
  indigo: { open: 'ring-2 ring-indigo-500/50', on: 'bg-indigo-50', check: 'text-indigo-600', tagOn: 'bg-white text-indigo-700 ring-1 ring-indigo-200' },
} as const;

interface BrandPickMenuProps {
  label: string;
  value: string;
  options: BrandPickOption[];
  onChange: (value: string) => void;
  /** 값이 비었을 때 버튼에 보일 문구 */
  placeholder?: string;
  /** 버튼 왼쪽 장식(아바타·아이콘) — 선택된 옵션을 받아 그린다 */
  leading?: (selected: BrandPickOption | undefined) => ReactNode;
  accent?: BrandPickAccent;
  /** 목록을 버튼 오른쪽 끝에 맞춘다(맨 오른쪽 칸에서 화면 밖으로 나가지 않게) */
  alignRight?: boolean;
}

export default function BrandPickMenu({
  label, value, options, onChange, placeholder = '선택하세요', leading, accent = 'violet', alignRight,
}: BrandPickMenuProps) {
  const tone = TONE[accent];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();   // 뒤의 발송 창까지 닫히지 않게(파일 머리 주석)
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toggle = () => {
    if (!open) setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(!open);
  };
  const pick = (v: string) => { onChange(v); setOpen(false); };

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); toggle(); }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const o = options[active];
      if (o) pick(o.value);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <span className="block text-[12px] font-semibold text-slate-600 mb-1.5">{label}</span>
      <button
        type="button"
        onClick={toggle}
        onKeyDown={onButtonKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full h-10 flex items-center gap-2 px-2.5 rounded-xl bg-white text-left shadow-sm transition ${
          open ? tone.open : 'ring-1 ring-slate-200 hover:ring-slate-300'
        }`}
      >
        {leading?.(selected)}
        <span className={`min-w-0 flex-1 truncate text-[13px] ${selected ? 'font-semibold text-slate-800' : 'text-slate-400'}`}>
          {selected ? selected.title : placeholder}
        </span>
        <ChevronDown size={14} strokeWidth={2} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={label}
          className={`absolute z-30 top-full mt-1.5 min-w-full w-max max-w-[min(360px,80vw)] max-h-[280px] overflow-y-auto rounded-xl bg-white p-1.5 ring-1 ring-slate-900/5 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.28)] ${
            alignRight ? 'right-0' : 'left-0'
          }`}
        >
          {options.length === 0 && (
            <p className="px-2.5 py-3 text-[12px] text-slate-400">선택할 항목이 없습니다.</p>
          )}
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => pick(o.value)}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg transition ${
                  on ? tone.on : i === active ? 'bg-slate-50' : ''
                }`}
              >
                {o.tag && (
                  <span className={`shrink-0 mt-px text-[10.5px] font-bold px-1.5 py-0.5 rounded-md ${on ? tone.tagOn : 'bg-slate-100 text-slate-500'}`}>
                    {o.tag}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-800 break-words">{o.title}</span>
                  {o.desc && <span className="block text-[11.5px] text-slate-500 leading-relaxed mt-0.5 break-words">{o.desc}</span>}
                </span>
                <Check size={15} strokeWidth={2.4} className={`shrink-0 mt-0.5 ${on ? tone.check : 'opacity-0'}`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
