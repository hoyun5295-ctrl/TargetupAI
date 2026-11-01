/**
 * CheckPanel — 점검 판 공용 부품(★ 2026-11-02 엔진 재설계 E7-2 · 여정 점검 판 JourneyCheckPanel 에서 옮김 · 화면 변화 0)
 *
 * 그리는 값 = 서버 점검 응답 그대로(화면은 판정하지 않는다). 여정 점검 판 · 자동마케팅 점검 판이 같이 쓴다.
 *   5어 = 검사 전 · 검사 중 · 확인 중 · 통과 · 고칠 것.
 */
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, ShieldCheck, Hourglass } from 'lucide-react';

export type CheckLevel = 'before' | 'running' | 'confirming' | 'pass' | 'fix';
export interface CheckItem { key: string; level: CheckLevel; title: string; detail: string }
export interface CheckVerdict { canActivate: boolean; sentence: string; fix: number; hold: number; before: number }

export const CHECK_LEVEL_WORD: Record<CheckLevel, string> = {
  before: '검사 전', running: '검사 중', confirming: '확인 중', pass: '통과', fix: '고칠 것',
};

const levelIcon = (l: CheckLevel) =>
  l === 'fix' ? <AlertTriangle className="h-4 w-4 text-rose-600" aria-hidden />
    : l === 'pass' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
      : l === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-amber-600" aria-hidden />
        : l === 'confirming' ? <Hourglass className="h-4 w-4 text-amber-600" aria-hidden />
          : <CircleDashed className="h-4 w-4 text-slate-400" aria-hidden />;

export function CheckItemRow({ it }: { it: CheckItem }) {
  return (
    <li className="flex gap-2.5 px-3.5 py-2.5">
      <span className="mt-0.5 shrink-0">{levelIcon(it.level)}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-slate-900">
          {it.title}
          <span className={`text-[11.5px] font-semibold ${it.level === 'fix' ? 'text-rose-700' : it.level === 'pass' ? 'text-emerald-700' : it.level === 'before' ? 'text-slate-500' : 'text-amber-700'}`}>{CHECK_LEVEL_WORD[it.level]}</span>
        </div>
        {it.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{it.detail}</p>}
      </div>
    </li>
  );
}

/** 판 머리 = 판정 문장(켜기 칩과 같은 값) · 보는 중 · 다시 보기 */
export function CheckHead({ verdict: v, loaded, loading, error, onRetry, children }: {
  verdict: CheckVerdict | undefined; loaded: boolean; loading: boolean; error: string | null; onRetry: () => void; children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-t-2xl px-4 py-3.5 ${!v ? 'bg-slate-50' : v.canActivate ? 'bg-emerald-50' : 'bg-rose-50'}`}>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500"><ShieldCheck className="h-4 w-4" aria-hidden />점검</div>
      {loading && !loaded ? (
        <div className="mt-1.5 flex items-center gap-2 text-[14px] text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />보는 중</div>
      ) : error && !loaded ? (
        <div className="mt-1.5 text-[13px] text-rose-700">{error} <button type="button" onClick={onRetry} className="ml-1 underline">다시</button></div>
      ) : v ? (
        <p className={`mt-1 text-[15px] font-semibold ${v.canActivate ? 'text-emerald-800' : 'text-rose-800'}`}>{v.sentence}</p>
      ) : null}
      {/* ★ Codex 구현 1R #3 — 이미 결과가 있어도 다시 보기 실패를 보이고 다시 누를 수 있게 */}
      {error && loaded && <p className="mt-1 text-[12px] text-rose-700">새 결과를 못 받았어요. <button type="button" onClick={onRetry} className="font-semibold underline">다시 보기</button></p>}
      {children}
    </div>
  );
}
