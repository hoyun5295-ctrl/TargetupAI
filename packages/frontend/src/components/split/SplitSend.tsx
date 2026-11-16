/**
 * 나눠 보내기(★ 2026-11-14 C133 F4) 화면 — AI 한줄로 결과 창의 토글 패널 · 확인 창 · 요약 창 · 대시보드 현황 줄
 *   (설계서 docs/2026-11-13-hanjul-v3-design.md §6 · §18 「배포 C-3」)
 *
 * 판정은 전부 서버가 한다(utils/campaign-split-rules · campaign-split). 화면은 서버의 답(잠금 이유 · 인원 · 시각 · 비용)을 그대로 보여 준다.
 *   · 열린 회사(단계 개방 split)에만 그린다. 닫힌 회사 = 아무것도 그리지 않는다.
 *   · 시작 = 요청 하나가 값 전부를 싣는다. 화면이 만든 id 가 나눠 보내기 id 라 두 번 눌러도 · 응답이 끊겨도 한 번이다.
 *     확인 창은 연 순간의 요청(id · 본문 · 그때 보여 준 것)을 묶어 두고 그것으로만 그린다.
 *   · 시작 요청의 주인 = 결과 창(useSplitStart) · 규칙 = utils/split-start: 서버에 보낸 요청은 서버의 답(시작됨 · 닫힘)으로만 떠난다.
 *     요청이 떠 있는 동안 확인 창이 떠 있고 · 시작했으면 창을 새로 열 때까지 문안 하나 발송(캠페인 확정)은 잠근다.
 *   · 미리 보기 불러오기 = 한 차례(끝난 차례의 응답은 아무것도 바꾸지 않는다).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fetchJson, sendJson } from '../../utils/dashboard-live';
import { useV3Feature } from '../../utils/v3-features';
import { oneTurn } from '../../utils/product-signal-text';
import { splitStartMachine, splitStartEmpty, splitStartLocked, type SplitStartState } from '../../utils/split-start';
import { calculateSmsBytes } from '../../utils/formatDate';

type GroupState = 'pending' | 'sending' | 'sent' | 'failed' | 'empty';
export interface SplitView {
  id: string; status: 'testing' | 'deciding' | 'done' | 'blocked' | 'cancelled';
  name: string; msgType: string; isAd: boolean; pct: number; wait: string;
  startAt: string; decideAt: string; createdAt: string; total: number; perVariant: number; rest: number;
  variants: Array<{ label: string; text: string; subject: string | null; state: GroupState; campaignId: string | null; total: number | null; sent: number | null; devices: number | null; rate: number | null }>;
  restGroup: { state: GroupState; campaignId: string | null; total: number | null };
  winnerIndex: number | null; verdict: 'winner' | 'no_difference' | 'not_ready' | null; blockReason: string | null;
}
interface Preview {
  total: number; perVariant: number; testTotal: number; rest: number; labels: string[];
  startAt: string; decideAt: string; scheduled: boolean; unitPrice: number; estimate: number; prepaid: boolean; balance: number | null;
}

const API = '/api/campaign-split';
const START_TIMEOUT_MS = 60_000;
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const pctText = (r: number | null) => (r === null ? '' : `${(r * 100).toFixed(1)}%`);
const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : '');

export function splitStatusText(s: SplitView): string {
  if (s.status === 'testing') return s.variants.every((v) => v.state === 'sent') ? `반응을 기다리는 중 · ${when(s.decideAt)}에 고른다` : '먼저 보낼 묶음을 보내는 중';
  if (s.status === 'deciding') return '고른 문안을 나머지에게 보내는 중';
  if (s.status === 'done') return '끝났어요';
  if (s.status === 'blocked') return '멈췄어요 · 확인이 필요해요';
  return '나머지를 보내지 않았어요';
}
function verdictText(s: SplitView): string | null {
  if (s.winnerIndex === null || !s.verdict) return null;
  const label = s.variants[s.winnerIndex]?.label || '문안 A';
  if (s.verdict === 'winner') return `${label}가 뚜렷이 많이 눌렸어요. 나머지에게 ${label}를 보냈어요.`;
  if (s.verdict === 'no_difference') return `차이가 뚜렷하지 않았어요. 맨 앞 문안(${label})을 보냈어요.`;
  return `발송 결과가 아직 모이지 않아 비교하지 못했어요. 맨 앞 문안(${label})을 보냈어요.`;
}
const STATE_KO: Record<GroupState, string> = { pending: '보내기 전', sending: '확인 중', sent: '접수됨', failed: '접수 안 됨', empty: '받을 사람 없음' };

// ─────────────────────────────────────────────────────────────────────────────
// 요약 창 — 먼저 보낸 결과 · 고른 문안 · 나머지 · 막힘이면 [이어 보내기] [여기서 그만]
// ─────────────────────────────────────────────────────────────────────────────

export function SplitSummaryModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: (split: SplitView) => void }) {
  const [split, setSplit] = useState<SplitView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const turn = useRef(oneTurn()).current;
  useLayoutEffect(() => () => turn.end(), [turn]);
  const load = async () => {
    const mine = turn.take();
    const r = await fetchJson(`${API}/${id}`);
    if (!mine()) return;
    if (r.ok && r.body?.split) { setSplit(r.body.split); setNote(null); } else setNote(r.status === 404 ? '나눠 보내기를 찾을 수 없어요.' : '불러오지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const act = async (path: 'stop' | 'resume') => {
    if (busy) return;
    setBusy(true);
    const mine = turn.take();
    const r = await sendJson(`${API}/${id}/${path}`, { method: 'POST' }, START_TIMEOUT_MS);
    if (!mine()) return;
    setBusy(false);
    if (r.ok && r.body?.split) { setSplit(r.body.split); setNote(null); onChanged?.(r.body.split as SplitView); } else { setNote(r.body?.error || '처리하지 못했어요. 잠시 뒤 다시 눌러 주세요.'); void load(); }
  };
  const verdict = split ? verdictText(split) : null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="나눠 보내기 진행 상황" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white text-gray-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-gray-500">나눠 보내기</div>
            <div className="truncate text-base font-bold">{split?.name || '불러오는 중...'}</div>
            {split && <div className={`mt-0.5 text-xs font-semibold ${split.status === 'blocked' ? 'text-rose-600' : 'text-gray-600'}`}>{splitStatusText(split)}</div>}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50">닫기</button>
        </div>
        {split && (
          <div className="space-y-4 px-5 py-4">
            {split.status === 'blocked' && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <div className="font-semibold">{split.blockReason || '확인이 필요해요.'}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => void act('resume')} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-40">이어 보내기</button>
                  <button type="button" disabled={busy} onClick={() => void act('stop')} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40">여기서 그만</button>
                </div>
                <div className="mt-1.5 text-[11px] text-rose-700/80">이미 나간 묶음은 발송결과에 그대로 있어요. 이어 보내면 못 나간 묶음부터 같은 분들에게 보내요.</div>
              </div>
            )}
            {split.status === 'cancelled' && split.blockReason && <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">{split.blockReason}</div>}
            {verdict && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{verdict}</div>}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <div className="text-sm font-bold">먼저 보낸 결과</div>
                <div className="text-[11px] text-gray-500">누른 기기 수 기준 · 대상 {split.total.toLocaleString()}명 중 {split.pct}%</div>
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-[460px] text-sm">
                  <thead className="bg-gray-50 text-[11px] text-gray-500">
                    <tr><th className="px-3 py-2 text-left font-semibold">문안</th><th className="px-3 py-2 text-right font-semibold">먼저 보낸 인원</th><th className="px-3 py-2 text-right font-semibold">발송 성공</th><th className="px-3 py-2 text-right font-semibold">누른 기기</th><th className="px-3 py-2 text-right font-semibold">비율</th></tr>
                  </thead>
                  <tbody>
                    {split.variants.map((v, i) => (
                      <tr key={v.label} className={`border-t border-gray-100 ${split.winnerIndex === i && split.verdict === 'winner' ? 'bg-emerald-50/60' : ''}`}>
                        <td className="px-3 py-2">
                          <div className="font-semibold">{v.label}{split.winnerIndex === i ? <span className="ml-1.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">나머지에 보냄</span> : null}</div>
                          <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[11px] text-gray-500">{v.text}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.total === null ? STATE_KO[v.state] : `${v.total.toLocaleString()}명`}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.sent === null ? '' : v.sent.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.devices === null ? '' : v.devices.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{pctText(v.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {split.winnerIndex === null && <div className="mt-1 text-[11px] text-gray-500">숫자는 {when(split.decideAt)}에 고를 때 채워져요.</div>}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2.5 text-sm">
              <div><span className="font-bold">나머지</span> <span className="text-gray-500">{split.rest.toLocaleString()}명</span></div>
              <div className="text-gray-700">{split.restGroup.total !== null ? `${split.restGroup.total.toLocaleString()}명 ${STATE_KO[split.restGroup.state]}` : STATE_KO[split.restGroup.state]}</div>
            </div>
            {split.status === 'testing' && (
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-gray-500">문안마다의 발송은 발송결과에서도 캠페인으로 볼 수 있어요.</div>
                <button type="button" disabled={busy} onClick={() => void act('stop')} className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">나머지 보내지 않기</button>
              </div>
            )}
          </div>
        )}
        {note && <div className="px-5 pb-4 text-sm text-rose-600">{note}</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 시작 요청 — 주인은 결과 창(useSplitStart) · 상태 규칙은 utils/split-start(보낸 요청은 서버의 답으로만 떠난다)
// ─────────────────────────────────────────────────────────────────────────────

/** 확인 창이 그릴 것 — 연 순간의 값(받는 글 · 바이트 · 인원 · 시각 · 비용)을 묶어 둔다(그 뒤의 편집 · 채널 변경과 무관) */
interface StartView {
  name: string;
  isAd: boolean;
  preview: Preview;
  shown: Array<{ label: string; sent: string; bytes: number; subject: string | null }>;
}

export interface SplitStartCtl {
  state: SplitStartState<StartView, SplitView>;
  /** 요청이 떠 있거나 · 이미 시작했다 — 결과 창이 「캠페인 확정」(문안 하나 발송)을 잠근다 */
  locked: boolean;
  open: (req: { id: string; body: Record<string, unknown>; view: StartView }) => void;
  submit: () => void;
  leave: () => void;
  reopen: () => void;
  changed: (split: SplitView) => void;
}

/** 결과 창이 한 번 부른다 — 패널이 다시 만들어져도 · 채널을 바꿔도 · 창을 닫았다 열어도 요청이 남는다 */
export function useSplitStart(o: { onSenderAuth?: (data: any, retry: () => void) => boolean; onStarted?: () => void }): SplitStartCtl {
  const cur = useRef<SplitStartState<StartView, SplitView>>(splitStartEmpty());
  const [state, setState] = useState(cur.current);
  const opts = useRef(o);
  useLayoutEffect(() => { opts.current = o; });
  const [m] = useState(() => splitStartMachine<StartView, SplitView>(
    { get: () => cur.current, set: (s) => { cur.current = s; setState(s); } },
    {
      post: (body) => sendJson(API, { method: 'POST', body }, START_TIMEOUT_MS),
      read: (id) => fetchJson(`${API}/${id}`),
      discard: (id) => sendJson(`${API}/${id}/discard`, { method: 'POST' }),
      senderAuth: (body, retry) => !!opts.current.onSenderAuth?.(body, retry),
      onStarted: () => opts.current.onStarted?.(),
    },
  ));
  return {
    state, locked: splitStartLocked(state),
    open: m.open, submit: () => { void m.submit(); }, leave: () => { void m.leave(); }, reopen: m.reopen, changed: m.changed,
  };
}

/** 확인 창 — 요청이 떠 있는 동안 떠 있다. 결과 창이 그린다(패널이 없어도 · 어느 단계에서도 보인다) */
export function SplitStartDialog({ ctl }: { ctl: SplitStartCtl }) {
  const { pending, phase } = ctl.state;
  if (!pending) return null;
  const v = pending.view;
  const working = phase.kind === 'busy' || phase.kind === 'closing';
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="나눠 보내기 확인">
      <div className="w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-2xl bg-white text-gray-900 shadow-2xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <div className="text-base font-bold">이렇게 나눠 보낼게요</div>
          <div className="mt-0.5 text-xs text-gray-500">{v.name}</div>
        </div>
        <div className="space-y-3 px-5 py-4 text-sm">
          {v.shown.map((x) => (
            <div key={x.label} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold">{x.label}</span>
                <span className="text-gray-500">{v.preview.perVariant.toLocaleString()}명에게 먼저 · {x.bytes}바이트(링크는 짧은 주소로 바뀌어요)</span>
              </div>
              {x.subject && <div className="mt-1.5 text-xs font-semibold text-gray-700">{x.subject}</div>}
              <div className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-800">{x.sent}</div>
            </div>
          ))}
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 rounded-xl bg-gray-50 p-3 text-[13px]">
            <dt className="text-gray-500">먼저 보내기</dt><dd className="font-semibold">{v.preview.scheduled ? when(v.preview.startAt) : '지금'} · 문안마다 {v.preview.perVariant.toLocaleString()}명(모두 {v.preview.testTotal.toLocaleString()}명)</dd>
            <dt className="text-gray-500">나머지</dt><dd className="font-semibold">{when(v.preview.decideAt)} · {v.preview.rest.toLocaleString()}명{v.isAd ? ' · 광고는 밤 시간을 피해 다음 발송 시간대에 나가요' : ''}</dd>
            <dt className="text-gray-500">고르는 기준</dt><dd>링크를 누른 기기 수 기준 · 차이가 뚜렷하지 않으면 맨 앞 문안</dd>
            <dt className="text-gray-500">예상 비용</dt><dd className="font-semibold">{won(v.preview.estimate)}{v.preview.prepaid && v.preview.balance !== null ? ` · 지금 잔액 ${won(v.preview.balance)}` : ''}</dd>
          </dl>
          <div className="text-[11px] leading-relaxed text-gray-500">받는 분은 지금 고정돼요. 기다리는 동안 수신거부하신 분은 나머지 발송에서 빠져요. 피로도 · 대조군 설정에 따라 실제 인원은 줄 수 있어요.</div>
          {(phase.kind === 'error' || phase.kind === 'unknown') && <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[12px] font-semibold text-rose-700">{phase.message}</div>}
          {phase.kind === 'unknown' && <div className="text-[11px] leading-relaxed text-gray-500">시작하지 않으려면 [시작 안 하기]를 눌러 주세요. 이미 시작됐다면 시작된 것으로 알려 드려요.</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button type="button" disabled={working} onClick={ctl.leave} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            {phase.kind === 'closing' ? '확인하는 중...' : !pending.sent || phase.kind === 'error' ? '돌아가기' : '시작 안 하기'}
          </button>
          <button type="button" disabled={working} onClick={ctl.submit} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-40">
            {phase.kind === 'busy' ? '시작하는 중...' : phase.kind === 'unknown' ? '다시 확인' : phase.kind === 'error' ? '다시 시작' : '시작'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI 한줄로 결과 창의 패널 — 토글 · 문안 고르기 · 몫 · 기다릴 시간 · 이름 · 시각 · 회신번호 → 확인 창 → 시작
// ─────────────────────────────────────────────────────────────────────────────

export interface SplitSendPanelProps {
  messages: Array<{ message_text?: string; subject?: string }>;
  msgType: string;
  isAd: boolean;
  targetFilter: unknown;
  defaultName: string;
  defaultCallback: string;
  callbackNumbers: Array<{ id: string; phone: string; label: string; is_default: boolean }>;
  /** 받는 글 미리 보기(광고 표기 · 무료거부 꼬리를 붙인 글) — 결과 창이 쓰는 함수 그대로 */
  wrapAdText: (text: string) => string;
  /** 시작 요청 · 시작한 나눠 보내기 — 주인은 결과 창이다(useSplitStart). 패널은 요청을 열고(open) 시작한 것을 보여 주기만 한다 */
  start: SplitStartCtl;
  /** 켠 동안 true — 결과 창이 「캠페인 확정」을 잠근다 */
  onActiveChange?: (on: boolean) => void;
}

export function SplitSendPanel(p: SplitSendPanelProps) {
  const live = useV3Feature('split');
  const [on, setOn] = useState(false);
  const [options, setOptions] = useState<{ pcts: number[]; waits: Array<{ code: string; label: string }> } | null>(null);
  const [picked, setPicked] = useState<boolean[]>(() => p.messages.map((_, i) => i < 3));
  const [pct, setPct] = useState<number | null>(null);
  const [wait, setWait] = useState<string | null>(null);
  const [name, setName] = useState(p.defaultName || '');
  const [callback, setCallback] = useState(p.defaultCallback || p.callbackNumbers.find((c) => c.is_default)?.phone || p.callbackNumbers[0]?.phone || '');
  const [timeMode, setTimeMode] = useState<'now' | 'custom'>('now');
  const [customTime, setCustomTime] = useState('');
  const [preview, setPreview] = useState<{ kind: 'idle' | 'loading' } | { kind: 'ok'; data: Preview } | { kind: 'issue'; message: string }>({ kind: 'idle' });
  const [summaryOpen, setSummaryOpen] = useState(false);
  const previewTurn = useRef(oneTurn()).current;
  useLayoutEffect(() => () => previewTurn.end(), [previewTurn]);
  const { pending, started: done } = p.start.state;

  const variants = p.messages.map((m, i) => ({ i, text: String(m?.message_text ?? ''), subject: m?.subject ? String(m.subject) : null })).filter((v) => picked[v.i]);
  const scheduledAt = timeMode === 'custom' && customTime ? new Date(customTime).toISOString() : null;
  const ready = on && !done && variants.length >= 2 && pct !== null && wait !== null;
  const body = () => ({
    name: name.trim(), msgType: p.msgType, callback, isAd: p.isAd, scheduledAt, targetFilter: p.targetFilter ?? {},
    variants: variants.map((v) => ({ text: v.text, subject: v.subject })), pct, wait,
  });
  const bodyKey = JSON.stringify(ready ? body() : null);

  useEffect(() => { p.onActiveChange?.(on); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [on]);
  useEffect(() => {
    if (!on || options) return;
    let alive = true;
    void fetchJson(`${API}/status`).then((r) => { if (alive && r.ok && r.body?.live) setOptions({ pcts: r.body.pcts || [], waits: r.body.waits || [] }); });
    return () => { alive = false; };
  }, [on, options]);
  // 미리 보기 = 한 차례(값이 바뀌면 앞 차례는 끝난다 · 끝난 차례의 응답은 아무것도 바꾸지 않는다).
  //   확인 창을 연 요청(pending)이 있는 동안에는 돌지 않는다 = 시작 상태가 미리 보기를 지우거나 미리 보기가 확인 창을 닫지 않는다.
  const paused = !ready || !!pending;
  useEffect(() => {
    if (paused) { previewTurn.end(); return; }
    const mine = previewTurn.take();
    setPreview({ kind: 'loading' });
    const t = setTimeout(async () => {
      const r = await sendJson(`${API}/preview`, { method: 'POST', body: JSON.parse(bodyKey) });
      if (!mine()) return;
      if (r.ok && r.body?.success) setPreview({ kind: 'ok', data: r.body as Preview });
      else setPreview({ kind: 'issue', message: r.body?.error || '확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.' });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyKey, paused]);

  // 고칠 수 있는가(열린 회사 · 문안 2개 이상) — 이미 시작한 것은 그와 무관하게 보여 준다
  const canEdit = live && p.messages.length >= 2;
  if (!canEdit && !done) return null;

  /** 확인 창을 연다 — 이 순간의 값(id · 본문 · 받는 글 · 미리 보기)을 요청 하나로 묶어 결과 창에 넘긴다 */
  const openConfirm = () => {
    if (preview.kind !== 'ok') return;
    const id = newId();
    if (!id) return;
    p.start.open({
      id, body: { ...body(), id },
      view: {
        name: name.trim(), isAd: p.isAd, preview: preview.data,
        shown: variants.map((v, k) => {
          const sent = p.wrapAdText(v.text);
          return { label: preview.data.labels[k] || `문안 ${String.fromCharCode(65 + k)}`, sent, bytes: calculateSmsBytes(sent), subject: v.subject };
        }),
      },
    });
  };

  const chip = (active: boolean) => `rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${active ? 'border-violet-400 bg-violet-500/30 text-white' : 'border-white/15 bg-white/5 text-white/70 hover:bg-white/10'}`;
  const field = 'w-full rounded-lg border border-white/15 bg-slate-800 px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:border-violet-400 focus:outline-none';

  return (
    <div className="rounded-xl border border-violet-400/30 bg-violet-500/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-white">문안을 나눠 보내고 반응 좋은 쪽으로</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-white/55">일부에게 문안을 나눠 먼저 보내고, 링크를 누른 기기가 뚜렷이 많은 문안을 나머지 전원에게 보내요.</div>
        </div>
        {canEdit && !done && (
          <button
            type="button" role="switch" aria-checked={on} aria-label="나눠 보내기" onClick={() => setOn((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-violet-500' : 'bg-white/20'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        )}
      </div>

      {done && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3">
          <div className="text-sm text-emerald-200">
            <span className="font-bold">나눠 보내기를 시작했어요.</span> <span className="text-emerald-200/80">{splitStatusText(done)}</span>
            {done.status === 'blocked' && done.blockReason ? <div className="mt-0.5 text-rose-300">{done.blockReason}</div> : null}
            <div className="mt-0.5 text-[11px] text-emerald-200/70">이 창에서는 문안 하나만 따로 보낼 수 없어요. 다른 발송은 창을 닫고 새로 시작해 주세요.</div>
          </div>
          <button type="button" onClick={() => setSummaryOpen(true)} className="rounded-lg border border-emerald-400/40 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20">진행 상황 보기</button>
        </div>
      )}

      {canEdit && on && !done && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold text-white/60">보낼 문안(2 ~ 3개)</div>
            <div className="flex flex-wrap gap-1.5">
              {p.messages.map((_, i) => (
                <button key={i} type="button" aria-pressed={!!picked[i]} onClick={() => setPicked((prev) => prev.map((v, k) => (k === i ? !v : v)))} className={chip(!!picked[i])}>
                  {`문안 ${String.fromCharCode(65 + i)}`}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <div>
              <div className="mb-1 text-[11px] font-semibold text-white/60">먼저 보낼 몫</div>
              <div className="flex flex-wrap gap-1.5">
                {(options?.pcts || []).map((v) => <button key={v} type="button" aria-pressed={pct === v} onClick={() => setPct(v)} className={chip(pct === v)}>{v}%</button>)}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-white/60">기다릴 시간</div>
              <div className="flex flex-wrap gap-1.5">
                {(options?.waits || []).map((w) => <button key={w.code} type="button" aria-pressed={wait === w.code} onClick={() => setWait(w.code)} className={chip(wait === w.code)}>{w.label}</button>)}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <label className="block">
              <div className="mb-1 text-[11px] font-semibold text-white/60">캠페인 이름</div>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder="예) 가을 세일 안내" className={field} />
            </label>
            <label className="block">
              <div className="mb-1 text-[11px] font-semibold text-white/60">회신번호</div>
              <select value={callback} onChange={(e) => setCallback(e.target.value)} className={field}>
                {p.callbackNumbers.length === 0 && <option value="">등록된 번호가 없어요</option>}
                {p.callbackNumbers.map((c) => <option key={c.id} value={c.phone}>{c.label ? `${c.phone} (${c.label})` : c.phone}</option>)}
              </select>
            </label>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-white/60">먼저 보낼 시각</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" aria-pressed={timeMode === 'now'} onClick={() => setTimeMode('now')} className={chip(timeMode === 'now')}>지금</button>
              <button type="button" aria-pressed={timeMode === 'custom'} onClick={() => setTimeMode('custom')} className={chip(timeMode === 'custom')}>시각 정하기</button>
              {timeMode === 'custom' && <input type="datetime-local" value={customTime} onChange={(e) => setCustomTime(e.target.value)} className={`${field} w-auto`} aria-label="먼저 보낼 시각" />}
            </div>
          </div>

          {!ready && <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 text-[12px] text-white/60">문안 2개 이상 · 먼저 보낼 몫 · 기다릴 시간을 고르면 인원과 비용을 보여 드려요.</div>}
          {ready && preview.kind === 'loading' && <div className="rounded-lg border border-white/10 bg-white/5 p-2.5 text-[12px] text-white/60">인원과 비용을 확인하는 중...</div>}
          {ready && preview.kind === 'issue' && <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-2.5 text-[12px] font-semibold text-amber-200">{preview.message}</div>}
          {ready && preview.kind === 'ok' && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 p-2.5">
              <div className="text-[12px] leading-relaxed text-white/80">
                대상 {preview.data.total.toLocaleString()}명 중 <b className="text-white">문안마다 {preview.data.perVariant.toLocaleString()}명</b>에게 먼저 · 나머지 <b className="text-white">{preview.data.rest.toLocaleString()}명</b>은 {when(preview.data.decideAt)}에 · 예상 비용 {won(preview.data.estimate)}
              </div>
              <button type="button" onClick={openConfirm} className="rounded-lg bg-violet-500 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-violet-500/30 hover:bg-violet-400">나눠 보내기 시작</button>
            </div>
          )}
        </div>
      )}

      {summaryOpen && done && <SplitSummaryModal id={done.id} onClose={() => setSummaryOpen(false)} onChanged={p.start.changed} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 대시보드 현황 줄 — 진행 중 · 멈춘 것 · 방금 끝난 것(없으면 그리지 않는다)
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_MS = 48 * 3600 * 1000;

export function SplitStatusCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const live = useV3Feature('split');
  const [rows, setRows] = useState<SplitView[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    let alive = true;
    void fetchJson(API).then((r) => { if (alive && r.ok && Array.isArray(r.body?.splits)) setRows(r.body.splits); });
    return () => { alive = false; };
  }, [live, refreshKey, tick]);
  const shown = rows
    .filter((s) => s.status === 'blocked' || s.status === 'testing' || s.status === 'deciding' || Date.now() - new Date(s.createdAt).getTime() < RECENT_MS)
    .sort((a, b) => Number(b.status === 'blocked') - Number(a.status === 'blocked'))
    .slice(0, 3);
  if (!live || shown.length === 0) return null;
  return (
    <section className="mb-4 rounded-2xl border border-gray-200 bg-white p-4" aria-label="나눠 보내기 현황">
      <div className="mb-2 text-sm font-bold text-gray-900">나눠 보내기</div>
      <ul className="divide-y divide-gray-100">
        {shown.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => setOpenId(s.id)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-gray-50">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-gray-900">{s.name}</span>
                <span className={`block text-xs ${s.status === 'blocked' ? 'font-semibold text-rose-600' : 'text-gray-500'}`}>{splitStatusText(s)}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-violet-700">보기</span>
            </button>
          </li>
        ))}
      </ul>
      {openId && <SplitSummaryModal id={openId} onClose={() => { setOpenId(null); setTick((n) => n + 1); }} onChanged={() => setTick((n) => n + 1)} />}
    </section>
  );
}
