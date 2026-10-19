/**
 * LineAnswer.tsx — 한 줄 묻기 답 카드(★ 2026-10-10 · 설계서 docs/2026-10-10-oneline-ask-design.md §5)
 *
 * 강조 카드 자리 1장(ZoneEmphasis kind=ai). 물으신 문장 · 「0크레딧 · 아무것도 만들지 않았어요」 · 답 머리 · 카드 ≤3 ·
 * 못 하는 것(사유 · 무엇을 주면 되는지) · 바닥 탈출구 [이 문장 그대로 만들기]. 숫자는 서버(DB) 값 그대로 그린다.
 * ⛔ 유료 AI 를 자동 호출하지 않는다 · 카드를 누를 때만 그 화면의 기존 만들기를 부른다.
 */
import { AlertCircle, ArrowRight, Loader2, Lock, X } from 'lucide-react';
import ZoneEmphasis from './ZoneEmphasis';
import type { LineAskCard } from '../../utils/one-line';
import type { LineAskState } from '../../hooks/useLineAsk';
import { formatKstClock } from '../../utils/formatDate';

export default function LineAnswer({ ask, onPick, onMakeAnyway, onClose, cardCost, makeCost, busy = false }: {
  ask: LineAskState;
  /** 카드 고르기 → 그 화면의 기존 함수 */
  onPick: (card: LineAskCard) => void;
  /** 질문이 아니었을 때 — 이 문장 그대로 지금처럼 만든다 */
  onMakeAnyway: () => void;
  onClose: () => void;
  /** 카드 버튼 옆 비용 글자(그 화면 단가표에서 읽는다 · 없으면 표시 안 함) */
  cardCost?: (card: LineAskCard) => string | undefined;
  /** 탈출구 버튼 옆 비용 글자 */
  makeCost?: string;
  busy?: boolean;
}) {
  const a = ask.answer;
  const at = a?.basis.at ? new Date(a.basis.at) : null;
  const scopeText = a ? (a.basis.scope === 'mine' ? '내 담당 고객 기준' : '회사 전체 기준') : '';
  return (
    <ZoneEmphasis
      kind="ai"
      title={<span className="break-keep">「{ask.line}」</span>}
      meta="0크레딧 · 아무것도 만들지 않았어요"
      right={
        <button type="button" onClick={onClose} className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 flex items-center justify-center" aria-label="답 닫기">
          <X className="w-4 h-4" />
        </button>
      }
    >
      <div aria-live="polite">
        {ask.loading && (
          <div className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 className="w-4 h-4 motion-safe:animate-spin" /> 우리 데이터를 읽고 있어요</div>
        )}
        {!ask.loading && ask.error && <p className="text-[13px] text-slate-600 break-keep">{ask.error}</p>}

        {!ask.loading && ask.help && (
          <div className="text-[13.5px] leading-relaxed text-slate-700 whitespace-pre-wrap">
            {ask.help.direct && ask.help.jobs[0] ? (
              <>
                <div className="font-semibold text-slate-900">{ask.help.jobs[0].title}</div>
                <ol className="mt-1.5 list-decimal pl-5 space-y-0.5">{ask.help.jobs[0].steps.map((s) => <li key={s}>{s}</li>)}</ol>
              </>
            ) : (ask.help.answered ? ask.help.answer : '이 질문은 아직 답을 찾지 못했어요.')}
          </div>
        )}

        {!ask.loading && a && (
          <>
            <p className="text-[13.5px] leading-relaxed text-slate-700 break-keep">{a.head}</p>
            {a.cards.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                {a.cards.map((c) => {
                  const cost = cardCost?.(c);
                  return (
                    <div key={c.key} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 flex flex-col">
                      <div className="text-sm font-semibold text-slate-900 break-keep">{c.title}</div>
                      {c.count != null && (
                        <div className="mt-1 text-lg font-bold text-slate-900 leading-tight tabular-nums">
                          {c.count.toLocaleString()}<span className="ml-0.5 text-xs font-medium text-slate-500">명</span>
                        </div>
                      )}
                      {c.countNote && <div className="text-[11.5px] text-slate-500 break-keep">{c.countNote}</div>}
                      <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-600 break-keep">{c.why}</p>
                      {(c.notices || []).length > 0 && (
                        <div className="mt-2 space-y-1">
                          {(c.notices || []).map((n) => (
                            <div key={n} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800"><AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /><span className="break-keep">{n}</span></div>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => onPick(c)}
                        disabled={busy}
                        className="mt-3 h-9 px-3 rounded-[10px] border border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 text-[13px] font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {c.action.kind === 'open' ? '행사 화면 열기' : c.action.kind === 'fill' ? '이 내용으로 만들기' : '이걸로 만들기'}
                        {cost ? <span className="font-medium text-indigo-500">· {cost}</span> : <ArrowRight className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {a.blocked.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {a.blocked.map((b) => (
                  <li key={b.title} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-slate-600">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="break-keep"><span className="font-semibold text-slate-700">{b.title}</span> · {b.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {a.failed.length > 0 && <p className="mt-2 text-[12px] text-amber-700 break-keep">읽지 못한 것: {a.failed.join(' · ')} · 잠시 뒤 다시 물어봐 주세요.</p>}
          </>
        )}

        {!ask.loading && (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-3">
            <span className="text-[12.5px] text-slate-500">질문이 아니었나요?</span>
            <button type="button" onClick={onMakeAnyway} disabled={busy} className="text-[12.5px] font-semibold text-indigo-700 hover:text-indigo-900 disabled:opacity-50">
              이 문장 그대로 만들기{makeCost ? ` · ${makeCost}` : ''}
            </button>
            {a && (
              <span className="ml-auto text-[10px] italic text-slate-400">{scopeText}{at && !Number.isNaN(at.getTime()) ? ` · ${formatKstClock(at)}` : ''}{a.basis.note ? ` · ${a.basis.note}` : ''}</span>
            )}
          </div>
        )}
      </div>
    </ZoneEmphasis>
  );
}
