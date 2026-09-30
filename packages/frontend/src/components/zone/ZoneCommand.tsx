/**
 * ZoneCommand.tsx — 명령 카드(★ 2026-09-30 AI 존 대개편 · ★ 같은 날 보정)
 *
 * 남색 띠 아래 경계에 걸친 흰 카드 하나가 모든 메뉴의 같은 자리에 있다.
 *   - 한 줄 입력형(자동화 7메뉴 · 원장 `oneLine`): 워드마크 + 밑줄 입력 + 오른쪽 끝 버튼(AI 생성 = 앰버). **입력 한 줄만.**
 *   - 일반형(나머지): [앞머리(기간·단계 등) · 설명] … [보조 외곽선 ≤2] [1차 버튼]
 * 보정(Harold 0930): 아랫줄(숫자·칩·기준 시각)을 없앴다 — 숫자는 머리 띠 오른쪽, 입구는 시작 카드, 기준 시각은 머리 띠 아래 한 줄.
 *
 * ⛔ className prop 없음.
 */
import { useRef, type ReactNode } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import type { ZoneAction } from './ZoneHeader';

export interface ZonePrimary extends ZoneAction {
  /** AI 생성·크레딧 = 앰버 / 그 밖 = 인디고 */
  tone?: 'amber' | 'indigo';
  /** 버튼 안 "· N크레딧" */
  credit?: string;
  busy?: boolean;
}

export interface ZoneLine {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** 버튼 글자(원장 oneLine.verb) */
  verb: string;
  icon?: LucideIcon;
  busy?: boolean;
  disabled?: boolean;
  credit?: string;
  /** 입력과 버튼 사이에 둘 것(예: [이미지] · 광고성 표기) */
  extra?: ReactNode;
  /** 입력이 비어 있어도 버튼을 누를 수 있는가(예: 만들기 = 판의 재료로 진행) */
  allowEmpty?: boolean;
  tone?: 'amber' | 'indigo';
}

export interface ZoneCommandProps {
  line?: ZoneLine;
  /** 일반형: 왼쪽 앞머리(기간 선택 · 단계 표시 등) */
  lead?: ReactNode;
  /** 일반형: 왼쪽 핵심 숫자(탭이 머리 오른쪽을 쓰는 메뉴 · 작은 이름표 + 굵은 숫자) */
  facts?: Array<{ label: string; value: ReactNode; tone?: 'emerald' | 'amber' | 'rose' }>;
  /** 일반형: 왼쪽 설명 한 줄(이 메뉴에서 지금 할 수 있는 일) */
  note?: ReactNode;
  /** 일반형: 1차 앞의 보조 외곽선 버튼(≤2) */
  actions?: [ZoneAction] | [ZoneAction, ZoneAction];
  primary?: ZonePrimary;
}

const TONE = {
  amber: 'bg-amber-500 hover:bg-amber-400 text-slate-900',
  indigo: 'bg-indigo-600 hover:bg-indigo-700 text-white',
} as const;

function PrimaryButton({ label, icon: Icon, onClick, disabled, busy, tone = 'indigo', credit }: ZonePrimary) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`h-10 px-4 rounded-[10px] ${TONE[tone]} text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto shrink-0`}
      data-zone="primary"
    >
      {busy ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : Icon ? <Icon className="w-[15px] h-[15px]" /> : null}
      {label}
      {credit && <span className="font-normal opacity-70 text-[12px]">· {credit}</span>}
    </button>
  );
}

const FACT_TONE = { emerald: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700' } as const;

export default function ZoneCommand({ line, lead, facts = [], note, actions = [] as unknown as [ZoneAction], primary }: ZoneCommandProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acts = (actions || []) as ZoneAction[];
  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.06),0_18px_36px_-16px_rgba(15,23,42,0.30)]" data-zone="command">
      {line ? (
        <form
          className="flex flex-wrap sm:flex-nowrap items-end gap-x-3 gap-y-2 px-4 md:px-5 pt-3.5 pb-3.5"
          onSubmit={(e) => { e.preventDefault(); if (!line.busy && !line.disabled && (line.allowEmpty || line.value.trim())) line.onSubmit(); }}
        >
          <img src="/brand/wordmark.png" alt="한줄로" className="h-[18px] md:h-5 mb-1.5 shrink-0 select-none" draggable={false} />
          <label className="flex-1 min-w-[200px] border-b-2 border-slate-900 focus-within:border-indigo-600 pb-1 transition-colors">
            <span className="sr-only">{line.verb}</span>
            <input
              ref={inputRef}
              value={line.value}
              onChange={(e) => line.onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.nativeEvent as KeyboardEvent).isComposing) e.preventDefault(); }}
              placeholder={line.placeholder}
              disabled={line.disabled}
              className="w-full bg-transparent text-[15px] font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
              data-zone="line"
            />
          </label>
          {line.extra}
          <button
            type="submit"
            disabled={line.busy || line.disabled || (!line.allowEmpty && !line.value.trim())}
            className={`h-10 px-4 rounded-[10px] ${TONE[line.tone || 'amber']} text-[13.5px] font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto shrink-0`}
            data-zone="primary"
          >
            {line.busy ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : line.icon ? <line.icon className="w-[15px] h-[15px]" /> : null}
            {line.verb}
            {line.credit && <span className="font-normal opacity-70 text-[12px]">· {line.credit}</span>}
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2.5 px-4 md:px-5 py-3 min-h-16">
          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {lead}
            {facts.map((f, i) => (
              <span key={f.label} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                {i > 0 && <span className="w-px h-3.5 bg-slate-200 self-center mr-2.5" aria-hidden="true" />}
                <span className="text-[12.5px] text-slate-500">{f.label}</span>
                <b className={`text-[17px] font-bold tabular-nums ${f.tone ? FACT_TONE[f.tone] : 'text-slate-900'}`}>{f.value}</b>
              </span>
            ))}
            {note && <span className="text-[13.5px] text-slate-600 leading-snug">{note}</span>}
          </div>
          {acts.map((a) => (
            <button key={a.label} type="button" onClick={a.onClick} disabled={a.disabled} className="h-10 px-3.5 rounded-[10px] border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-[13px] font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-40 w-full sm:w-auto shrink-0">
              {a.icon && <a.icon className="w-[15px] h-[15px] text-slate-500" />}
              {a.label}
            </button>
          ))}
          {primary && <PrimaryButton {...primary} />}
        </div>
      )}
    </div>
  );
}
