/**
 * SpamBlockHintCard — 스팸 검사가 막혔을 때 「막혔을 수 있는 부분」 카드(★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §8-1 D1 · D2)
 *   목업 = docs/mockups/2026-11-24-spam-block-hint-mockup.html ①(Harold 「이대로 진행」).
 *
 * 서버 GET /api/spam-filter/tests/:id 의 hints(막힌 통신사마다 의심 조각 · 확인 판 상태 · 다음 판 자격)를 그대로 그린다.
 *   단추 = POST /tests/:id/diagnose { carrier, variant } — 그 통신사 하나로 한 통(요금 없음) · 결과는 창이 다시 읽어 바뀐다.
 * ⛔ 추정과 확인을 섞지 않는다 — 의심 = 「막혔을 수 있는 부분」 · 확인 판 도착 = 「빼니 도착했어요」 · 막힘 = 「빼도 막혔어요」(설계서 §8-3).
 * ⛔ 검사 방식 낱말 · 모델명 · 우리 쪽 원인 단정 0.
 */
import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { carrierLabel } from '../utils/send-checks';

export type DiagCheckState = 'queued' | 'checking' | 'arrived' | 'blocked' | 'unknown';
export interface SpamHintSuspect { token: string; kind: 'url' | 'new_vs_passed' | 'rule' | 'other'; line: number; demoted?: boolean; confirmedNotSole?: boolean }
export interface SpamHintCarrier {
  carrier: string;
  suspects: SpamHintSuspect[];
  baseline: { at: string } | null;
  checks: { v1?: DiagCheckState; v2?: DiagCheckState };
  next: 1 | 2 | null;
  nextBasis: 'url' | 'suspect' | 'digits' | null;
  nextLines: string[];
  eligible: boolean;
  reason: string | null;
  /** 자격이 안 될 때의 문장(서버 정본 문구 · 화면이 따로 쓰지 않는다) */
  reasonText: string;
}
export interface SpamBlockHints { sendable: boolean; carriers: SpamHintCarrier[] }

/** 확인 판 중 아직 결과를 기다리는 것이 있는가(창이 다시 읽기를 이어 간다) */
export function hasPendingDiag(h: SpamBlockHints | null | undefined): boolean {
  return !!h?.carriers?.some((c) => [c.checks?.v1, c.checks?.v2].some((s) => s === 'queued' || s === 'checking'));
}

/** 미리 보기 글에 칠할 조각 — 앞으로 둔 의심 조각(sus) · 뒤로 민 조각(dem) */
export function hintMarks(h: SpamBlockHints | null | undefined): { sus: string[]; dem: string[] } {
  const c = h?.carriers?.[0];
  if (!c) return { sus: [], dem: [] };
  const live = c.suspects.filter((s) => !s.demoted && s.kind !== 'other');
  return { sus: live.map((s) => s.token), dem: c.suspects.filter((s) => s.demoted).map((s) => s.token) };
}

/** 미리 보기 글에서 칠할 조각을 <mark> 로 감싼다(대소문자 무시 · 긴 조각 먼저) */
export function markText(text: string, marks: { sus: string[]; dem: string[] }): ReactNode {
  const kind = new Map<string, 'sus' | 'dem'>();
  for (const t of marks.dem) kind.set(t.toLowerCase(), 'dem');
  for (const t of marks.sus) kind.set(t.toLowerCase(), 'sus');
  const keys = [...kind.keys()].filter((k) => k.length >= 2).sort((a, b) => b.length - a.length);
  if (!text || keys.length === 0) return text;
  const re = new RegExp(`(${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => {
    const k = kind.get(part.toLowerCase());
    if (!k) return part;
    return <mark key={i} className={k === 'sus' ? 'bg-rose-100 text-rose-800 rounded-[3px] px-0.5' : 'bg-stone-200 text-stone-600 rounded-[3px] px-0.5'}>{part}</mark>;
  });
}

const showToken = (t: string) => t.replace(/^https?:\/\//i, '');
const shortLine = (l: string) => { const t = l.replace(/^[\s■□●○◆◇▶▷►>※*·•\-]+/, '').trim(); return t.length > 24 ? `${t.slice(0, 24)}…` : t; };
const kstMonthDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};


function Codes({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1 mt-1">
      {items.slice(0, 6).map((t) => (
        <code key={t} className="text-[11.5px] font-mono bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 rounded-[6px] px-1.5 py-0.5 break-all">{t}</code>
      ))}
    </span>
  );
}

function CarrierHint({ testId, token, h, onSent }: { testId: string; token: string | null; h: SpamHintCarrier; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const c = carrierLabel(h.carrier);
  const live = h.suspects.filter((s) => !s.demoted);
  const urlSus = live.filter((s) => s.kind === 'url');
  const urls = urlSus.map((s) => showToken(s.token));
  // 확인 판으로 「빼도 막힘」이 확정된 조각(설계서 §5-2 첫 줄 · 추정과 확인을 섞지 않는다)
  const urlNotSole = urlSus.length > 0 && urlSus.every((s) => s.confirmedNotSole);
  const fresh = live.filter((s) => s.kind === 'new_vs_passed').map((s) => s.token);
  const rules = live.filter((s) => s.kind === 'rule').map((s) => s.token);
  const others = live.filter((s) => s.kind === 'other').length;
  const demoted = h.suspects.filter((s) => s.demoted).map((s) => showToken(s.token));
  const lineWord = h.nextBasis === 'digits' ? '혜택 줄' : '표시한 줄';
  const v2Lines = h.next === 2 ? h.nextLines.map(shortLine).filter(Boolean) : [];

  const rows: Array<{ title: string; codes: string[]; note?: string }> = [];
  if (urls.length) rows.push({ title: '글 속 주소예요', codes: urls, note: urlNotSole ? `주소를 빼도 ${c}에서 막혔어요. 주소만의 문제는 아니에요.` : '주소는 글을 다듬어도 그대로 남아요. 막힌 원인이 주소라면 주소를 바꿔야 해요.' });
  if (fresh.length && h.baseline) rows.push({ title: `지난 ${kstMonthDay(h.baseline.at)} ${c}에 도착한 글에는 없던 부분이에요`, codes: fresh });
  if (rules.length) rows.push({ title: '등록된 차단정보와 같은 부분이에요', codes: rules });
  if (v2Lines.length) rows.push({ title: lineWord, codes: v2Lines, note: h.checks.v1 === undefined && urls.length ? undefined : `이 줄을 빼고 ${c}로 다시 확인할 수 있어요.` });

  // 확인 판 상태 = 가장 최근 판(② 가 있으면 ②)
  const last = h.checks.v2 !== undefined ? { v: 2 as const, s: h.checks.v2 } : h.checks.v1 !== undefined ? { v: 1 as const, s: h.checks.v1 } : null;
  const pending = last && (last.s === 'queued' || last.s === 'checking');
  // 정본 문구(설계서 §8-4) — [굵게, 뒤 문장]
  const result: [string, string] | null = !last || pending ? null : last.s === 'unknown' ? ['확인을 마치지 못했어요.', '']
    : last.v === 1 ? (last.s === 'arrived' ? [`글 속 주소를 빼니 ${c}에 도착했어요.`, '주소를 바꿔 보세요.'] : [`글 속 주소를 빼도 ${c}에서 막혔어요.`, '주소만의 문제는 아니에요.'])
      : (last.s === 'arrived' ? [`표시한 줄을 빼니 ${c}에 도착했어요.`, '그 줄의 표현을 바꿔 보세요.'] : [`표시한 줄을 빼도 ${c}에서 막혔어요.`, '']);
  const tone = !last || pending ? 'idle' : last.s === 'arrived' ? 'ok' : last.s === 'blocked' ? 'no' : 'idle';
  const canSend = !pending && h.next !== null && h.eligible;
  const btnText = h.next === 1 ? `주소 빼고 ${c}로 다시 확인` : `${lineWord} 빼고 ${c}로 다시 확인`;
  const idleText = h.next === 1 ? <>주소만 뺀 글을 <b>{c}로만</b> 한 통 보내 도착하는지 확인해요. 요금은 없어요.</>
    : h.next === 2 ? <>{lineWord}을 뺀 글을 <b>{c}로만</b> 한 통 보내 도착하는지 확인해요. 요금은 없어요.</> : null;
  // ★ 2026-11-24 꺼진 회사(회사 스위치 · reason 'off') = 다시 확인 칸째 숨김(단추 · 사유 줄 0) · 이미 있는 판의 결과는 그대로 보인다
  const off = !h.eligible && h.reason === 'off';
  const reason = !h.eligible && !off && h.next !== null && !pending ? h.reasonText : '';

  const send = async () => {
    if (!canSend || busy) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch(`/api/spam-filter/tests/${testId}/diagnose`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier: h.carrier, variant: h.next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) setErr(data?.error || '지금은 다시 확인할 수 없어요.');
      else onSent();
    } catch { setErr('지금은 다시 확인할 수 없어요.'); }
    finally { setBusy(false); }
  };

  const box = tone === 'ok' ? 'border-emerald-200 bg-emerald-50' : tone === 'no' ? 'border-rose-200 bg-rose-50' : 'border-stone-200 bg-stone-50';
  return (
    <div className="rounded-[14px] border border-stone-200 bg-white p-3.5 break-keep">
      <div className="flex items-center gap-1.5 flex-wrap">
        <b className="text-[13.5px] font-extrabold text-stone-900">막혔을 수 있는 부분</b>
        <span className="text-[10px] font-extrabold text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded px-1.5 py-px">NEW</span>
        <span className="ml-auto text-[11.5px] font-bold text-rose-700 bg-rose-50 ring-1 ring-inset ring-rose-200 rounded-full px-2 py-0.5">{c}</span>
      </div>
      <p className="text-[12px] text-stone-500 mt-1 leading-relaxed">통신사는 막은 이유를 알려 주지 않아요. 한줄로가 기록으로 좁힌 부분이에요.</p>

      {rows.length > 0 && (
        <ol className="mt-2.5 flex flex-col gap-2">
          {rows.map((r, i) => (
            <li key={r.title} className="flex gap-2.5">
              <span className="w-5 h-5 rounded-full bg-stone-900 text-white text-[11px] font-bold grid place-items-center shrink-0 mt-px">{i + 1}</span>
              <div className="min-w-0">
                <b className="text-[12.5px] font-bold text-stone-800">{r.title}</b>
                <Codes items={r.codes} />
                {r.note && <small className="block text-[11.5px] text-stone-500 mt-1 leading-relaxed">{r.note}</small>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {others > 0 && <p className="text-[11.5px] text-stone-400 mt-1.5">그 밖 {others}곳</p>}
      {!h.baseline && <p className="text-[11.5px] text-stone-500 mt-2">견줄 만한 지난 글이 없어요.</p>}
      {demoted.length > 0 && (
        <p className="text-[11.5px] text-stone-500 mt-1 leading-relaxed">
          바꿔 봤는데도 막혔던 부분이에요: {demoted.slice(0, 6).map((t, i) => <span key={t}>{i > 0 && ', '}<s>{t}</s></span>)}
        </p>
      )}

      {(last || (idleText && !off)) && (
        <div className={`mt-3 rounded-xl border px-3 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2.5 ${box}`}>
          {pending && <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0" />}
          <p className="flex-1 min-w-0 text-[12.5px] text-stone-700 leading-relaxed">
            {pending ? <><b>{c}로 보내 확인하고 있어요.</b> 창을 닫아도 확인은 계속돼요.</>
              : result ? <><b>{result[0]}</b>{result[1] && ` ${result[1]}`}</>
                : reason ? null : idleText}
            {reason && <span className={`block text-stone-500 ${result ? 'mt-0.5' : ''}`}>{reason}</span>}
            {err && <span className="block text-rose-600 mt-0.5">{err}</span>}
          </p>
          {canSend && (
            <button type="button" onClick={send} disabled={busy}
              className="h-9 px-3.5 rounded-[10px] bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-[12.5px] font-bold whitespace-nowrap inline-flex items-center justify-center gap-1.5 shrink-0">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{btnText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SpamBlockHintCard({ testId, token, hints, onSent }: { testId: string; token: string | null; hints: SpamBlockHints; onSent: () => void }) {
  if (!hints?.carriers?.length) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {hints.carriers.map((h) => <CarrierHint key={h.carrier} testId={testId} token={token} h={h} onSent={onSent} />)}
    </div>
  );
}
