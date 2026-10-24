/**
 * ZoneQuestion — 질문 한 줄(★ 2026-10-24 · 설계서 docs/2026-10-24-automarketing-oneline-design.md §1-2)
 *   자동 마케팅 한 줄 창 · 여정 「문장으로 만들기」 창이 같이 쓴다(질문 모양 = 서버 one-line-ct/questions 와 같다).
 *   라벨 · 도움말 · 알약(고르기) · 자물쇠 + 사유 · 글 칸 · 날짜 칸 · 「없이」 단추.
 *   색 = 존 색 규칙(LineStepsModal 머리) — 고른 답 = 보라(고객이 준 것) · 잠김 = 회색. 알약 높이 = 휴대폰 40 · 넓은 화면 32.
 */
import { Lock } from 'lucide-react';

export interface ZoneQuestionOption { value: string; label: string; desc?: string; disabled?: boolean; reason?: string }
export interface ZoneQuestionModel {
  id: string;
  kind: 'choice' | 'text' | 'date';
  label: string;
  help?: string;
  options?: ZoneQuestionOption[];
  recommended?: string;
  placeholder?: string;
  maxLength?: number;
  /** 글 칸의 「없이」 단추(혜택 없이 보내기) — 누르면 빈 글이 답이다 */
  noneLabel?: string;
}

const pill = (selected: boolean, disabled?: boolean) => disabled
  ? 'h-10 md:h-8 px-3 rounded-lg text-[13px] md:text-xs border border-slate-200 text-slate-400 cursor-not-allowed inline-flex items-center gap-1'
  : selected
    ? 'h-10 md:h-8 px-3 rounded-lg text-[13px] md:text-xs font-semibold border border-violet-400 bg-violet-100 text-violet-950 inline-flex items-center gap-1.5'
    : 'h-10 md:h-8 px-3 rounded-lg text-[13px] md:text-xs border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 transition-colors inline-flex items-center gap-1.5';

export default function ZoneQuestion({ q, value, onChange, recommendedValue, none }: {
  q: ZoneQuestionModel;
  /** 지금 답(없으면 빈 글) */
  value: string;
  onChange: (v: string) => void;
  /** 고르기 질문의 추천 답(있으면 그 알약에 「추천」) */
  recommendedValue?: string;
  /** 「없이」를 눌렀는가(글 칸) */
  none?: { on: boolean; toggle: (on: boolean) => void };
}) {
  return (
    <div>
      <div className="text-[13px] md:text-xs font-semibold text-slate-800">{q.label}</div>
      {q.kind === 'choice' ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={q.label}>
          {(q.options || []).map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={value === o.value}
              disabled={o.disabled}
              title={o.disabled ? o.reason : o.desc}
              onClick={() => onChange(o.value)}
              className={pill(value === o.value, o.disabled)}
            >
              {o.disabled && <Lock className="w-3 h-3" />}
              {o.label}
              {!o.disabled && recommendedValue === o.value && <span className="text-[11px] text-violet-800">추천</span>}
            </button>
          ))}
        </div>
      ) : q.kind === 'date' ? (
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={q.label}
          className="mt-1.5 h-10 md:h-9 px-3 rounded-lg bg-white border border-slate-200 text-[13px] md:text-xs focus:outline-none focus:border-violet-400"
        />
      ) : (
        <div className="mt-1.5 flex flex-col sm:flex-row gap-1.5">
          <input
            value={none?.on ? '' : value}
            disabled={none?.on}
            onChange={(e) => onChange(e.target.value)}
            placeholder={q.placeholder}
            maxLength={q.maxLength}
            aria-label={q.label}
            className="w-full sm:flex-1 min-w-0 h-10 md:h-9 px-3 rounded-lg bg-white border border-slate-200 text-[13px] md:text-xs placeholder-slate-400 focus:outline-none focus:border-violet-400 disabled:bg-slate-50"
          />
          {q.noneLabel && none && (
            <button type="button" role="switch" aria-checked={none.on} onClick={() => none.toggle(!none.on)} className={pill(none.on)}>
              {q.noneLabel}
            </button>
          )}
        </div>
      )}
      {q.help && <p className="mt-1 text-[12px] md:text-[11px] text-slate-500">{q.help}</p>}
      {q.kind === 'choice' && (q.options || []).filter((o) => o.disabled).map((o) => (
        <p key={o.value} className="mt-1 flex items-start gap-1 text-[12px] md:text-[11px] text-slate-400">
          <Lock className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{o.label}: {o.reason || '지금은 고를 수 없어요.'}</span>
        </p>
      ))}
    </div>
  );
}
