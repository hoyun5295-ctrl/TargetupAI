/**
 * JourneyCheckPanel — 여정 작업 화면 오른쪽 점검 판(★ 2026-11-01 여정 재발 방지 배포 2 C5 · C6)
 *
 * 그리는 값 = 서버 점검 응답(GET /api/ai/operator/journeys/:id/check) 그대로. 화면은 판정하지 않는다(판정 유틸 import 0).
 *   맨 위 = 판정 문장(켜기 칩 · 레일 점과 같은 값) · 이 칸 항목 · 여정 전체 항목 · 다른 칸에 남은 것(누르면 그 칸으로).
 *   5어 = 검사 전 · 검사 중 · 확인 중 · 통과 · 고칠 것.
 */
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, ShieldCheck, Hourglass, Beaker } from 'lucide-react';

export type JourneyCheckLevel = 'before' | 'running' | 'confirming' | 'pass' | 'fix';
export interface JourneyCheckItem {
  key: string;
  level: JourneyCheckLevel;
  title: string;
  detail: string;
  fixTarget: 'body' | 'subject' | 'alimtalk' | 'spam' | 'journey' | null;
  variantId: string | null;
}
export interface JourneyCheckData {
  verdict: { canActivate: boolean; sentence: string; fix: number; hold: number; before: number };
  steps: Record<string, JourneyCheckItem[]>;
  journey: JourneyCheckItem[];
}

export const CHECK_LEVEL_WORD: Record<JourneyCheckLevel, string> = {
  before: '검사 전', running: '검사 중', confirming: '확인 중', pass: '통과', fix: '고칠 것',
};

/** 칸 하나의 점 색(레일) — 고칠 것 = 빨강 · 검사 전 · 검사 중 · 확인 중 = 노랑 · 그 밖 = 없음 */
export function stepDotOf(items: readonly JourneyCheckItem[] | undefined): 'fix' | 'hold' | null {
  if (!items || items.length === 0) return null;
  if (items.some((i) => i.level === 'fix')) return 'fix';
  if (items.some((i) => i.level === 'before' || i.level === 'running' || i.level === 'confirming')) return 'hold';
  return null;
}

const levelIcon = (l: JourneyCheckLevel) =>
  l === 'fix' ? <AlertTriangle className="h-4 w-4 text-rose-600" aria-hidden />
    : l === 'pass' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
      : l === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-amber-600" aria-hidden />
        : l === 'confirming' ? <Hourglass className="h-4 w-4 text-amber-600" aria-hidden />
          : <CircleDashed className="h-4 w-4 text-slate-400" aria-hidden />;

function ItemRow({ it }: { it: JourneyCheckItem }) {
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

interface Props {
  check: JourneyCheckData | null;
  loading: boolean;
  error: string | null;
  /** 지금 고른 칸(문자 칸 id · 새 칸이면 null) */
  stepId: string | null;
  /** 칸 번호 · 이름(다른 칸 줄) */
  stepLabel: (id: string) => string;
  onPickStep: (id: string) => void;
  /** 지금 스팸 검사(이 칸 · 수동) — 없으면 버튼을 숨긴다 */
  onSpamTest?: () => void;
  /** 고친 곳이 저장 전이면 점검은 저장된 판 기준이라고 알린다 */
  unsaved: boolean;
  /** 이 칸 이탈 진단(있을 때만 · 점검 판정과 별개 글자) */
  dropNote?: string | null;
  onRetry: () => void;
}

export default function JourneyCheckPanel({ check, loading, error, stepId, stepLabel, onPickStep, onSpamTest, unsaved, dropNote, onRetry }: Props) {
  const mine = stepId && check ? check.steps[stepId] || [] : [];
  const others = check ? Object.entries(check.steps).filter(([id, its]) => id !== stepId && its.some((i) => i.level !== 'pass')) : [];
  const v = check?.verdict;
  return (
    <aside aria-label="점검" className="min-w-0 self-start rounded-2xl border border-slate-200 bg-white">
      <div className={`rounded-t-2xl px-4 py-3.5 ${!v ? 'bg-slate-50' : v.canActivate ? 'bg-emerald-50' : 'bg-rose-50'}`}>
        <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500"><ShieldCheck className="h-4 w-4" aria-hidden />점검</div>
        {loading && !check ? (
          <div className="mt-1.5 flex items-center gap-2 text-[14px] text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />보는 중</div>
        ) : error && !check ? (
          <div className="mt-1.5 text-[13px] text-rose-700">{error} <button type="button" onClick={onRetry} className="ml-1 underline">다시</button></div>
        ) : v ? (
          <p className={`mt-1 text-[15px] font-semibold ${v.canActivate ? 'text-emerald-800' : 'text-rose-800'}`}>{v.sentence}</p>
        ) : null}
        {/* ★ Codex 구현 1R #3 — 이미 결과가 있어도 다시 보기 실패를 보이고 다시 누를 수 있게 */}
        {error && check && <p className="mt-1 text-[12px] text-rose-700">새 결과를 못 받았어요. <button type="button" onClick={onRetry} className="font-semibold underline">다시 보기</button></p>}
        {unsaved && <p className="mt-1 text-[12px] text-slate-500">고친 곳은 저장한 뒤 점검해요.</p>}
      </div>

      {stepId && (
        <div className="border-t border-slate-100">
          <div className="flex items-center gap-2 px-3.5 pt-3 text-[12px] font-semibold text-slate-500">
            이 칸
            {onSpamTest && (
              <button type="button" onClick={onSpamTest} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12.5px] font-medium text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300">
                <Beaker className="h-3.5 w-3.5" aria-hidden />지금 스팸 검사
              </button>
            )}
          </div>
          {mine.length > 0 ? <ul className="divide-y divide-slate-100">{mine.map((it) => <ItemRow key={it.key} it={it} />)}</ul>
            : check ? <p className="px-3.5 pb-3 pt-1.5 text-[12.5px] text-slate-500">이 칸은 남은 것이 없어요.</p> : null}
          {dropNote && <p className="mx-3.5 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">{dropNote}</p>}
        </div>
      )}

      {check && check.journey.length > 0 && (
        <div className="border-t border-slate-100">
          <div className="px-3.5 pt-3 text-[12px] font-semibold text-slate-500">여정 전체</div>
          <ul className="divide-y divide-slate-100">{check.journey.map((it) => <ItemRow key={it.key} it={it} />)}</ul>
        </div>
      )}

      {others.length > 0 && (
        <div className="border-t border-slate-100 px-3.5 py-3">
          <div className="mb-1.5 text-[12px] font-semibold text-slate-500">다른 칸</div>
          <ul className="space-y-1">
            {others.map(([id, its]) => {
              const fix = its.filter((i) => i.level === 'fix').length;
              const hold = its.filter((i) => i.level !== 'fix' && i.level !== 'pass').length;
              return (
                <li key={id}>
                  <button type="button" onClick={() => onPickStep(id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-slate-700 hover:bg-slate-50">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${fix > 0 ? 'bg-rose-500' : 'bg-amber-400'}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{stepLabel(id)}</span>
                    <span className="shrink-0 text-slate-500">{[fix > 0 ? `고칠 것 ${fix}` : '', hold > 0 ? `확인 중 ${hold}` : ''].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
