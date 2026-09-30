/**
 * ZoneCommand.tsx — 명령 카드(★ 2026-09-30 AI 존 대개편 · 설계서 §3-2 ②)
 *
 * 허브 명령 카드("한줄로 ___" 입력)를 줄인 모양. 남색 띠 아래 경계에 걸친 흰 카드 하나가 모든 메뉴의 같은 자리에 있다.
 *   - 한 줄 입력형(자동화 7메뉴 · 원장 `oneLine`): 워드마크 + 밑줄 입력 + 오른쪽 끝 버튼(AI 생성 = 앰버)
 *   - 일반형(나머지): 상태 숫자 + 오른쪽 끝 1차 버튼(인디고)
 *   아랫줄 = 상태 숫자 · 확인할 것 · 다른 방법(1클릭 칩) · 기준 시각 · 다시 읽기(새로고침은 전 메뉴 이 한 곳)
 *
 * ⛔ className prop 없음. 다른 방법은 최대 3개(튜플) — 넘치면 `more`(다른 방법 더보기)로.
 */
import { useRef, type ReactNode } from 'react';
import { CircleAlert, Loader2, RotateCw, type LucideIcon } from 'lucide-react';
import { ZoneMoreMenu, type ZoneAction, type ZoneMenuItem } from './ZoneHeader';

export interface ZoneStat {
  label: string;
  value: ReactNode;
  /** 숫자 옆 작은 글자 링크(예: "자세히" · "바꾸기") */
  action?: { label: string; onClick: () => void };
}

export interface ZoneCheck {
  label: string;
  onClick?: () => void;
}

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
  /** 입력과 버튼 사이에 둘 것(예: 허브 [이미지]) */
  extra?: ReactNode;
  /** 입력이 비어 있어도 버튼을 누를 수 있는가(예: 만들기 = 판의 재료로 진행) */
  allowEmpty?: boolean;
  tone?: 'amber' | 'indigo';
}

export interface ZoneCommandProps {
  stats?: ZoneStat[];
  checks?: ZoneCheck[];
  alts?: [ZoneAction] | [ZoneAction, ZoneAction] | [ZoneAction, ZoneAction, ZoneAction];
  more?: ZoneMenuItem[];
  stamp?: { text: string; onRefresh?: () => void; loading?: boolean };
  line?: ZoneLine;
  primary?: ZonePrimary;
  /** 아랫줄 맨 앞에 둘 것(예: 만들기 단계 표시) */
  lead?: ReactNode;
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

const Divider = () => <span className="w-px h-3 bg-slate-200 shrink-0" aria-hidden="true" />;

export default function ZoneCommand({ stats = [], checks = [], alts, more = [], stamp, line, primary, lead }: ZoneCommandProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const altList = (alts || []) as ZoneAction[];
  const statNodes = stats.map((s, i) => (
    <span key={`${s.label}-${i}`} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="text-[12.5px] text-slate-500">{s.label}</span>
      <b className="text-[13.5px] font-semibold tabular-nums text-slate-900">{s.value}</b>
      {s.action && <button type="button" onClick={s.action.onClick} className="text-[12px] text-indigo-600 hover:underline">{s.action.label}</button>}
    </span>
  ));
  const checkNodes = checks.map((c, i) => (
    c.onClick
      ? <button key={`${c.label}-${i}`} type="button" onClick={c.onClick} className="inline-flex items-center gap-1 text-[12.5px] text-amber-700 hover:underline whitespace-nowrap"><CircleAlert className="w-[13px] h-[13px]" />{c.label}</button>
      : <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1 text-[12.5px] text-amber-700 whitespace-nowrap"><CircleAlert className="w-[13px] h-[13px]" />{c.label}</span>
  ));
  const altNodes = altList.map((a) => (
    <button key={a.label} type="button" onClick={a.onClick} disabled={a.disabled} className="h-7 px-2.5 rounded-full border border-slate-200 bg-white text-[12.5px] text-slate-600 hover:border-indigo-200 hover:text-indigo-700 inline-flex items-center gap-1 whitespace-nowrap transition-colors disabled:opacity-40">
      {a.icon && <a.icon className="w-[13px] h-[13px]" />}
      {a.label}
    </button>
  ));
  const stampNode = stamp && (
    <button type="button" onClick={stamp.onRefresh} disabled={!stamp.onRefresh || stamp.loading} className="md:ml-auto inline-flex items-center gap-1 text-[12px] text-slate-400 hover:text-slate-600 whitespace-nowrap disabled:cursor-default" aria-label="다시 읽기">
      <RotateCw className={`w-3 h-3 ${stamp.loading ? 'animate-spin' : ''}`} />{stamp.text}
    </button>
  );
  const bottomLeft = [
    ...(lead ? [<span key="lead" className="inline-flex items-center">{lead}</span>] : []),
    ...statNodes,
  ];

  return (
    <div className="bg-white rounded-2xl shadow-[0_2px_4px_rgba(15,23,42,0.06),0_18px_36px_-16px_rgba(15,23,42,0.30)]" data-zone="command">
      {line ? (
        <form
          className="flex flex-wrap sm:flex-nowrap items-end gap-x-3 gap-y-2 px-4 md:px-5 pt-3.5 pb-3"
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
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 md:px-5 py-2.5 min-h-14">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0 flex-1">
            {bottomLeft.flatMap((n, i) => (i ? [<Divider key={`d${i}`} />, n] : [n]))}
            {checkNodes.length > 0 && <><Divider />{checkNodes}</>}
          </div>
          {primary && <PrimaryButton {...primary} />}
        </div>
      )}
      {(line || altNodes.length > 0 || more.length > 0 || stampNode) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 md:px-5 py-2 border-t border-slate-100">
          {line && bottomLeft.flatMap((n, i) => (i ? [<Divider key={`ld${i}`} />, n] : [n]))}
          {line && checkNodes.length > 0 && <><Divider />{checkNodes}</>}
          {(altNodes.length > 0 || more.length > 0) && (
            <>
              {line && (bottomLeft.length > 0 || checkNodes.length > 0) && <Divider />}
              <span className="text-[12px] text-slate-400">다른 방법</span>
              {altNodes}
              {more.length > 0 && <ZoneMoreMenu items={more} align="left" tone="light" />}
            </>
          )}
          {stampNode}
        </div>
      )}
    </div>
  );
}
