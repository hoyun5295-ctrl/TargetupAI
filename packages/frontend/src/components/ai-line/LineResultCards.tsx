/**
 * LineResultCards.tsx — AI 한줄로 결과 카드(★ 2026-10-18 · 설계서 docs/2026-10-18-ai-line-design.md §5-4 · §5-5 · §7)
 *
 * 고른 종류만 카드로 나란히 · 카드 머리 = 추천 배지 + 스팸 검사 칩 · 카드 아래 = 칼럼 더 넣기(1크레딧 · 이 문안 하나) · 직접 고치기 · 이 문안 고르기.
 * ★ 2026-10-19 카드는 본문을 그리지 않는다(Harold 「문안이 위에도 밑에도 이중으로 있을 필요가 있나」) — 본문은 아래 편집기 한 곳 · 카드를 고르면 아래가 그 문안.
 * 자동 검사: 추천 카드 → 고른 카드 → 나머지 순서로 하나씩(사용자당 줄 1건 · 서버가 busy 면 잠시 뒤 다시) · 카드당 자동 2번(첫 + 고친 뒤 1).
 *   칩은 실제로 나갈 글 · 제목 · 채널 · 광고 · 발신번호 지문에 묶여, 글이 바뀌면 「다시 검사」로 바뀐다. 발송은 막지 않는다.
 * 본문 읽기는 호출부가 넘긴 bodyAt 하나(다듬은 글 우선) · 쓰기는 onEdit / onDecorate 로 호출부가 한다.
 * ⛔ 모델명 0 · 줄표 0 · native dialog 0.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, PencilLine, ShieldCheck, ShieldAlert, Wand2, Clock3, RotateCw } from 'lucide-react';
import { AI_GENERATE_COSTS } from '../../constants/credit';
import {
  type AiLineRun, type AiLineType, type AiLineChannel, type AiLineSpamChip, type AiLineColumn,
  aiLineApi, spamFp, audienceOf, missingVarsIn,
} from '../../utils/ai-line';

const POLL_MS = 3000;
const BUSY_RETRY_MS = 5000;
const AUTO_LIMIT = 2;
const RUNNING: ReadonlyArray<AiLineSpamChip['state']> = ['queued', 'running'];
/** 검사를 다시 걸어도 결과가 같은 상태(사람이 고쳐야 바뀐다) — 지문이 바뀌기 전에는 자동으로 다시 걸지 않는다 */
const HOLD: ReadonlyArray<AiLineSpamChip['state']> = ['demo', 'unavailable', 'unregistered', 'no_balance', 'charset'];

export interface LineResultCardsProps {
  run: AiLineRun;
  pickedType: AiLineType | null;
  bodyAt: (t: AiLineType) => string;
  subjectAt: (t: AiLineType) => string;
  channel: AiLineChannel;
  isAd: boolean;
  /** 검사 발신번호(등록 번호 · 개별 회신이면 기본 번호) · 없으면 검사하지 않는다 */
  callback: string;
  columns: AiLineColumn[];
  onPick: (t: AiLineType) => void;
  onEdit: (t: AiLineType) => void;
  /** 칼럼 더 넣기(1크레딧) — 호출부가 서버를 부르고 다듬은 글을 쓴다 */
  onDecorate: (t: AiLineType, vars: string[]) => Promise<void>;
  onSpamPatch: (t: AiLineType, chip: AiLineSpamChip) => void;
}

function chipView(chip: AiLineSpamChip | undefined, stale: boolean): { tone: string; icon: 'ok' | 'bad' | 'wait' | 'none'; text: string } {
  if (stale && chip && !RUNNING.includes(chip.state)) return { tone: 'bg-amber-50 text-amber-800', icon: 'none', text: '글이 바뀌었어요 · 다시 검사' };
  if (!chip || chip.state === 'idle') return { tone: 'bg-slate-100 text-slate-600', icon: 'wait', text: '검사 전' };
  const carriersBy = (r: 'pass' | 'blocked') => (chip.carriers || []).filter((c) => c.result === r).map((c) => c.carrier);
  switch (chip.state) {
    case 'queued': return { tone: 'bg-slate-100 text-slate-700', icon: 'wait', text: chip.aheadCount ? `줄 대기 · 앞 ${chip.aheadCount}건` : '줄 대기' };
    case 'busy': return { tone: 'bg-slate-100 text-slate-700', icon: 'wait', text: '줄 대기' };
    case 'running': return { tone: 'bg-indigo-50 text-indigo-800', icon: 'wait', text: `확인 중${chip.elapsedSec ? ` · ${chip.elapsedSec}초` : ''}` };
    case 'pass': return { tone: 'bg-emerald-50 text-emerald-800', icon: 'ok', text: `스팸 통과${carriersBy('pass').length ? ` · ${carriersBy('pass').length}사` : ''}` };
    case 'blocked': return { tone: 'bg-rose-50 text-rose-800', icon: 'bad', text: `막힘 · ${carriersBy('blocked').join(' · ') || '통신사'}` };
    case 'warn': return { tone: 'bg-amber-50 text-amber-800', icon: 'none', text: '결과 없음 · 다시 검사' };
    case 'demo': return { tone: 'bg-slate-100 text-slate-600', icon: 'none', text: '시연 계정은 검사하지 않아요' };
    case 'unavailable': return { tone: 'bg-slate-100 text-slate-600', icon: 'none', text: '요금제에 스팸 검사가 없어요' };
    case 'unregistered': return { tone: 'bg-amber-50 text-amber-800', icon: 'none', text: '등록된 발신번호로만 검사해요' };
    case 'no_balance': return { tone: 'bg-amber-50 text-amber-800', icon: 'none', text: '잔액이 부족해 검사하지 못했어요' };
    case 'charset': return { tone: 'bg-amber-50 text-amber-800', icon: 'none', text: '보낼 수 없는 글자가 있어요' };
    default: return { tone: 'bg-slate-100 text-slate-600', icon: 'wait', text: '검사 전' };
  }
}

export default function LineResultCards(p: LineResultCardsProps) {
  const { run } = p;
  const types = run.cards.map((c) => c.type);
  const fpOf = (t: AiLineType) => spamFp(p.bodyAt(t), p.subjectAt(t), p.channel, p.isAd, p.callback);
  // 순서 = 추천 → 고른 카드 → 나머지
  const rec = run.intake?.recommend?.type ?? null;
  const order = [...types].sort((a, b) => (a === rec ? -2 : a === p.pickedType ? -1 : 0) - (b === rec ? -2 : b === p.pickedType ? -1 : 0));

  // ── 자동 검사: 줄에 하나만 · 끝나면 다음 ──
  const latest = useRef(p);
  latest.current = p;
  const startingRef = useRef(false);
  // ★ Codex C1 — 서버가 연달아 busy 면 칩 값이 그대로라 effect 가 다시 돌지 않았다(멈춤) → busy 마다 이 값을 올려 다음 재시도를 잡는다
  const [busyTick, setBusyTick] = useState(0);
  const start = async (t: AiLineType, manual: boolean) => {
    const cur = latest.current;
    const body = cur.bodyAt(t).trim();
    if (!cur.callback || body.length < 2 || startingRef.current) return;
    startingRef.current = true;
    const prev = cur.run.spam[t];
    const fp = spamFp(cur.bodyAt(t), cur.subjectAt(t), cur.channel, cur.isAd, cur.callback);
    try {
      const out = await aiLineApi.spamStart({
        body: cur.bodyAt(t), subject: cur.subjectAt(t), channel: cur.channel, isAd: cur.isAd, callback: cur.callback,
        sampleCustomerId: audienceOf(cur.run).top?.id ?? null,
      });
      if (latest.current.run.runId !== cur.run.runId) return;   // 그 사이 다른 진행 = 버린다
      if (out.state === 'busy') setBusyTick((x) => x + 1);
      cur.onSpamPatch(t, {
        state: out.state, testId: out.state === 'busy' ? prev?.testId : out.testId, fp, message: out.message,
        autoRuns: out.state === 'busy' ? (prev?.autoRuns || 0) : (prev?.autoRuns || 0) + (manual ? 0 : 1),
      });
    } catch (e) {
      if (latest.current.run.runId !== cur.run.runId) return;
      cur.onSpamPatch(t, { state: 'warn', fp, message: e instanceof Error ? e.message : '검사를 시작하지 못했어요', autoRuns: (prev?.autoRuns || 0) + 1 });
    } finally {
      startingRef.current = false;
    }
  };

  // 다음에 걸 카드 고르기(진행 중이 없을 때만)
  const spamKey = JSON.stringify(Object.fromEntries(types.map((t) => [t, [run.spam[t]?.state, run.spam[t]?.fp, run.spam[t]?.autoRuns]])));
  const fpKey = types.map(fpOf).join('|');
  useEffect(() => {
    if (!p.callback) return;
    const inflight = types.some((t) => RUNNING.includes(run.spam[t]?.state as any));
    if (inflight) return;
    const busyOne = types.find((t) => run.spam[t]?.state === 'busy');
    if (busyOne) {
      const timer = setTimeout(() => { void start(busyOne, false); }, BUSY_RETRY_MS);
      return () => clearTimeout(timer);
    }
    const next = order.find((t) => {
      const chip = run.spam[t];
      const body = p.bodyAt(t).trim();
      if (body.length < 2) return false;
      if ((chip?.autoRuns || 0) >= AUTO_LIMIT) return false;
      if (!chip || chip.state === 'idle') return true;
      return chip.fp !== fpOf(t);   // 같은 글은 다시 걸지 않는다(멈춤 상태 HOLD 도 글이 바뀌어야 다시)
    });
    if (next) void start(next, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spamKey, fpKey, p.callback, busyTick]);

  // 진행 중 칩 읽기(3초) — ★ Codex C1: 카드마다 한 번에 하나만 읽고, 응답은 그때의 진행 · 검사가 지금과 같을 때만 · 지금 칩에 결과 칸만 합친다
  // 카드마다 지금 읽는 요청의 표(자기 요청이 끝날 때만 지운다 · 늦게 끝난 옛 요청이 새 요청의 잠금을 풀지 않게)
  const pollingRef = useRef<Map<string, object>>(new Map());
  useEffect(() => {
    const live = types.filter((t) => RUNNING.includes(run.spam[t]?.state as any) && run.spam[t]?.testId);
    if (live.length === 0) return;
    const timer = setInterval(() => {
      for (const t of live) {
        const chip = latest.current.run.spam[t];
        if (!chip?.testId || pollingRef.current.has(t)) continue;
        const runId = latest.current.run.runId;
        const testId = chip.testId;
        const mark = {};
        pollingRef.current.set(t, mark);
        void aiLineApi.spamRead(testId, latest.current.channel).then((r) => {
          const cur = latest.current;
          const now = cur.run.spam[t];
          if (cur.run.runId !== runId || !now || now.testId !== testId) return;
          cur.onSpamPatch(t, { ...now, state: r.state, carriers: r.carriers, aheadCount: r.aheadCount, elapsedSec: r.elapsedSec });
        }).catch(() => { /* 다음 읽기에서 다시(제한 시간 10초) */ }).finally(() => { if (pollingRef.current.get(t) === mark) pollingRef.current.delete(t); });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spamKey]);

  // ── 칼럼 더 넣기 ──
  const [decoOpen, setDecoOpen] = useState<AiLineType | null>(null);
  const [decoVars, setDecoVars] = useState<string[]>([]);
  const [decoBusy, setDecoBusy] = useState(false);
  const [decoError, setDecoError] = useState<string | null>(null);
  const decoCost = AI_GENERATE_COSTS['ai-line-decorate'] ?? 1;

  const cols = types.length >= 3 ? 'lg:grid-cols-3' : types.length === 2 ? 'md:grid-cols-2' : '';
  return (
    <div className="mb-6 space-y-2">
      <div className={`grid grid-cols-1 ${cols} gap-3`}>
        {types.map((t) => {
          const card = run.cards.find((c) => c.type === t)!;
          const body = p.bodyAt(t);
          const chip = run.spam[t];
          const stale = !!chip?.fp && chip.fp !== fpOf(t);
          const view = chipView(chip, stale);
          const picked = p.pickedType === t;
          const isRec = rec === t;
          const unusedCols = p.columns.filter((c) => !c.locked && !body.includes(`%${c.token}%`));
          // ★ 2026-10-20 고른 칼럼 중 지금 본문에 없는 것(만들 때 넣지 못했거나 고치다 지운 것 · 지금 글로 바로 계산)
          const missingVars = t === 'direct' ? [] : missingVarsIn(body, run.vars);
          return (
            <div key={t} className={`rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)] space-y-2.5 ${picked ? 'border-2 border-violet-500' : 'border border-slate-200'}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[14px] font-bold text-slate-900 inline-flex items-center gap-1.5">
                  {card.label}
                  {isRec && <span className="rounded-full bg-violet-600 text-white text-[10.5px] font-bold px-1.5 leading-[18px]">추천</span>}
                </p>
                <button
                  type="button"
                  onClick={() => { if (!RUNNING.includes(chip?.state as any)) void start(t, true); }}
                  disabled={!p.callback || body.trim().length < 2}
                  title={!p.callback ? '등록된 회신번호가 있어야 검사해요' : '누르면 다시 검사해요(문자 요금)'}
                  className={`h-7 px-2 rounded-full text-[11.5px] font-semibold inline-flex items-center gap-1 shrink-0 ${view.tone} disabled:opacity-60`}
                >
                  {view.icon === 'ok' ? <ShieldCheck className="w-3.5 h-3.5" />
                    : view.icon === 'bad' ? <ShieldAlert className="w-3.5 h-3.5" />
                    : chip && RUNNING.includes(chip.state) ? <span className="w-1.5 h-1.5 rounded-full bg-current motion-safe:animate-pulse" />
                    : view.icon === 'wait' ? <Clock3 className="w-3.5 h-3.5" /> : <RotateCw className="w-3.5 h-3.5" />}
                  {view.text}
                </button>
              </div>
              {t === 'direct' && !body.trim() && (
                <button type="button" onClick={() => p.onEdit(t)} className="w-full h-11 rounded-xl border border-dashed border-slate-300 text-[13px] text-slate-500 hover:border-indigo-400 hover:text-indigo-700">
                  직접 쓰기 · 변수 · 특수문자 넣기
                </button>
              )}
              {missingVars.length > 0 && (
                <p className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-[12px] text-amber-900">
                  이 문안에 안 들어간 고른 칼럼 · {missingVars.map((v) => `%${v}%`).join(' · ')}. 칼럼 더 넣기나 직접 고치기로 넣을 수 있어요
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 text-[12px]">
                {t !== 'direct' && unusedCols.length > 0 && (
                  <button type="button" onClick={() => { setDecoOpen(decoOpen === t ? null : t); setDecoVars([]); setDecoError(null); }}
                    className="h-8 px-2.5 rounded-lg border border-slate-200 inline-flex items-center gap-1 hover:bg-slate-50">
                    <Wand2 className="w-3.5 h-3.5" />칼럼 더 넣기 · {decoCost}크레딧
                  </button>
                )}
                <button type="button" onClick={() => p.onEdit(t)} disabled={decoBusy && decoOpen === t} className="h-8 px-2.5 rounded-lg border border-slate-200 inline-flex items-center gap-1 hover:bg-slate-50 disabled:opacity-50">
                  <PencilLine className="w-3.5 h-3.5" />직접 고치기
                </button>
                {picked ? (
                  <span className="h-8 px-2.5 rounded-lg bg-violet-50 text-violet-800 font-semibold inline-flex items-center gap-1 ml-auto"><Check className="w-3.5 h-3.5" />보낼 문안</span>
                ) : (
                  <button type="button" onClick={() => p.onPick(t)} className="h-8 px-2.5 rounded-lg border border-violet-300 text-violet-800 font-semibold ml-auto hover:bg-violet-50">이 문안 보기 · 보내기</button>
                )}
              </div>
              {decoOpen === t && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <p className="text-[12px] text-slate-600">이 문안 하나에만 넣어요. 글이 실제로 바뀌었을 때만 크레딧이 빠져요.</p>
                  <div className="flex flex-wrap gap-1.5">
                    {unusedCols.map((c) => {
                      const on = decoVars.includes(c.token);
                      return (
                        <button key={c.token} type="button" onClick={() => setDecoVars(on ? decoVars.filter((x) => x !== c.token) : [...decoVars, c.token])}
                          className={`h-8 px-2.5 rounded-lg border text-[12px] ${on ? 'border-violet-500 bg-violet-50 text-violet-900 font-semibold' : 'border-slate-200 bg-white text-slate-600'}`}>
                          %{c.label}% <span className={on ? 'text-violet-700' : 'text-slate-500'}>{c.fill}%</span>
                        </button>
                      );
                    })}
                  </div>
                  {decoError && <p className="text-[12px] text-rose-700">{decoError}</p>}
                  <button type="button" disabled={decoVars.length === 0 || decoBusy}
                    onClick={async () => {
                      setDecoBusy(true); setDecoError(null);
                      try { await p.onDecorate(t, decoVars); setDecoOpen(null); } catch (e) { setDecoError(e instanceof Error ? e.message : '넣지 못했어요'); } finally { setDecoBusy(false); }
                    }}
                    className="h-9 px-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[13px] font-bold inline-flex items-center gap-1.5 disabled:opacity-40">
                    {decoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}넣기 · {decoCost}크레딧
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11.5px] text-slate-500">
        고른 문안은 아래에서 보고 고쳐요. 스팸 칩은 실제로 나가는 글(광고 표기 · 080 · 제목 포함)에 묶여 글이 바뀌면 「다시 검사」로 바뀝니다. 검사는 문자 요금(요금제 무료 문자 먼저) · 같은 글은 24시간 동안 다시 걷지 않아요.{p.channel === 'MMS' ? ' 사진 문자(MMS)는 글만 검사해요.' : ''}{!p.callback ? ' 등록된 회신번호가 있어야 검사해요.' : ''}
      </p>
    </div>
  );
}
