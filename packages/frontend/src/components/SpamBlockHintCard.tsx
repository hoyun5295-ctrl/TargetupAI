/**
 * SpamBlockHintCard — 스팸 검사가 막혔을 때 「막혔을 수 있는 부분」 + 「닿는 글 찾기」 카드
 *   (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §8-1 · ★2026-11-26 C164 재작성 · 설계서 docs/2026-11-25-spam-diag-rewrite-design.md §10-1)
 *
 * 서버 GET /api/spam-filter/tests/:id 의 hints 를 그대로 그린다 — 문장은 전부 서버가 만든다(화면이 따로 짓지 않는다).
 *   의심 부분(기록으로 좁힌 조각) · 찾기 단추 · 판마다 한 줄(이름 · 바꾼 곳 · 상태) · 주소 물음 · 찾은 글(바꿈 목록 + 받기) · 정직한 끝.
 *   주소와 혜택을 「빼라」고 하지 않는다 — 표현을 바꾼 글 · 같은 곳으로 가는 짧은 주소를 막힌 통신사로 보내 닿는지 확인하고, 닿은 글을 한 번에 받는다.
 * 단추 = POST /tests/:id/rewrite · /rewrite/next · /fix-apply. 찾기 · 받기는 검사 창을 연 화면이 원문(template)과 받기(onApply)를 넘길 때만 보인다.
 * ⛔ 추정과 확인을 섞지 않는다 — 의심 = 「막혔을 수 있는 부분」 · 확인 = 「닿았어요」 · 「막혔어요」.
 * ⛔ 검사 방식 낱말 · 모델명 · 우리 쪽 원인 단정 0 · 색 = 흰 바탕 · 검정 · 주황 하나.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { carrierLabel } from '../utils/send-checks';

export interface SpamHintSuspect { token: string; kind: 'url' | 'new_vs_passed' | 'rule' | 'other'; line: number; demoted?: boolean }
export interface SpamHintCarrier { carrier: string; suspects: SpamHintSuspect[]; baseline: { at: string } | null }
/** 찾기 카드(서버 spam-diag RewriteCard 와 같은 꼴) */
export interface SpamRewriteCard {
  state: 'hidden' | 'idle' | 'working' | 'ask_url' | 'found' | 'end';
  start: { label: string; note: string } | null;
  reasonText: string;
  plates: Array<{ name: string; change: string; stateText: string; tone: 'wait' | 'ok' | 'no' | 'unknown' }>;
  ask: { text: string; note: string; options: Array<{ choice: 'url' | 'rewrite'; label: string }> } | null;
  found: { title: string; note: string; keepLine: string; urlLine: string; fixes: Array<{ before: string; after: string }>; applyLabel: string } | null;
  endText: string;
}
export interface SpamBlockHints { sendable: boolean; carriers: SpamHintCarrier[]; rewrite?: SpamRewriteCard }

/** 찾는 중인가(서버가 이어 돌린다 · 창이 다시 읽기를 이어 간다) */
export function hasPendingDiag(h: SpamBlockHints | null | undefined): boolean {
  return h?.rewrite?.state === 'working';
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
const kstMonthDay = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;
};
const uniq = (list: string[]) => [...new Set(list)];

function Codes({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1 mt-1">
      {items.slice(0, 6).map((t) => (
        <code key={t} className="text-[11.5px] font-mono bg-stone-100 text-stone-800 ring-1 ring-inset ring-stone-200 rounded-[6px] px-1.5 py-0.5 break-all">{t}</code>
      ))}
    </span>
  );
}

interface Props {
  testId: string;
  token: string | null;
  hints: SpamBlockHints;
  /** 원문(변수 칸 그대로인 지금 작성 칸 글 · 제목) — 검사 창을 연 화면이 넘길 때만 찾기 · 받기 단추가 보인다 */
  template?: { body: string; subject: string } | null;
  /** 받기 — 바꾼 글을 작성 칸에 넣고 그 글로 다시 검사한다 · 못 넣으면 사유 문장을 돌려준다(없으면 null) */
  onApply?: (body: string, subject: string | null, smsTooLongText: string) => string | null;
  /** 판을 보냈다(창이 다시 읽기를 이어 간다) */
  onSent: () => void;
}

export default function SpamBlockHintCard({ testId, token, hints, template, onApply, onSent }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  // 창이 닫힌 뒤(카드가 사라진 뒤) 늦게 온 응답은 버린다 — 닫고 나서 고친 작성 칸 글을 받기가 덮어쓰지 않게(★ Codex 구현 1R)
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  if (!hints?.carriers?.length) return null;
  const rw = hints.rewrite;
  const canAct = !!template && !!onApply;

  // 의심 부분(A) — 막힌 통신사 전부에서 모은다(같은 조각은 한 번)
  const live = hints.carriers.flatMap((c) => c.suspects.filter((s) => !s.demoted));
  const urls = uniq(live.filter((s) => s.kind === 'url').map((s) => showToken(s.token)));
  const fresh = uniq(live.filter((s) => s.kind === 'new_vs_passed').map((s) => s.token));
  const rules = uniq(live.filter((s) => s.kind === 'rule').map((s) => s.token));
  const base = hints.carriers.find((c) => c.baseline);
  const demoted = uniq(hints.carriers.flatMap((c) => c.suspects.filter((s) => s.demoted).map((s) => showToken(s.token))));
  const rows: Array<{ title: string; codes: string[] }> = [];
  if (urls.length) rows.push({ title: '글 속 주소예요', codes: urls });
  if (fresh.length && base?.baseline) rows.push({ title: `지난 ${kstMonthDay(base.baseline.at)} ${carrierLabel(base.carrier)}에 도착한 글에는 없던 부분이에요`, codes: fresh });
  if (rules.length) rows.push({ title: '등록된 차단정보와 같은 부분이에요', codes: rules });

  const post = async (path: string, payload: Record<string, unknown>, key: string): Promise<any | null> => {
    if (busy) return null;
    setBusy(key); setErr('');
    try {
      const res = await fetch(`/api/spam-filter/tests/${testId}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!alive.current) return null;
      if (!res.ok || !data?.ok) { setErr(data?.error || '지금은 다시 확인할 수 없어요.'); return null; }
      return data;
    } catch { if (alive.current) setErr('지금은 다시 확인할 수 없어요.'); return null; }
    finally { if (alive.current) setBusy(null); }
  };
  const start = async () => { if (template && await post('rewrite', { body: template.body, subject: template.subject }, 'start')) onSent(); };
  const answer = async (choice: 'url' | 'rewrite') => { if (await post('rewrite/next', { choice }, choice)) onSent(); };
  const apply = async () => {
    if (!template || !onApply) return;
    const data = await post('fix-apply', { body: template.body, subject: template.subject }, 'apply');
    if (!data) return;
    const failed = onApply(String(data.body ?? ''), typeof data.subject === 'string' ? data.subject : null, String(data.smsTooLongText || ''));
    if (failed) setErr(failed);
  };

  const state = rw?.state ?? 'hidden';
  const plates = rw?.plates ?? [];
  const ended = state === 'end';
  const btn = 'min-h-[40px] px-3.5 py-2 rounded-[10px] text-[12.5px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60 text-center';
  const primary = `${btn} bg-amber-500 hover:bg-amber-600 text-white`;
  const ghost = `${btn} border border-stone-300 bg-white hover:bg-stone-50 text-stone-800`;

  return (
    <div className="rounded-[14px] border border-stone-200 bg-white p-3.5 break-keep">
      <div className="flex items-center gap-1.5 flex-wrap">
        <b className="text-[13.5px] font-extrabold text-stone-900">막혔을 수 있는 부분</b>
        <span className="text-[10px] font-extrabold text-amber-700 bg-amber-50 ring-1 ring-inset ring-amber-200 rounded px-1.5 py-px">NEW</span>
        <span className="ml-auto flex flex-wrap gap-1">
          {hints.carriers.map((c) => (
            <span key={c.carrier} className="text-[11.5px] font-bold text-stone-800 bg-stone-100 ring-1 ring-inset ring-stone-200 rounded-full px-2 py-0.5">{carrierLabel(c.carrier)}</span>
          ))}
        </span>
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
              </div>
            </li>
          ))}
        </ol>
      )}
      {!base && <p className="text-[11.5px] text-stone-500 mt-2">견줄 만한 지난 글이 없어요.</p>}
      {demoted.length > 0 && (
        <p className="text-[11.5px] text-stone-500 mt-1 leading-relaxed">
          바꿔 봤는데도 막혔던 부분이에요: {demoted.slice(0, 6).map((t, i) => <span key={t}>{i > 0 && ', '}<s>{t}</s></span>)}
        </p>
      )}

      {/* 찾기 전 — 단추 + 설명(자격이 될 때 · 검사 창을 연 화면이 원문을 넘겼을 때만) */}
      {state === 'idle' && rw?.start && canAct && (
        <div className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 flex flex-col gap-2">
          <button type="button" onClick={start} disabled={!!busy} className={`${primary} w-full`}>
            {busy === 'start' && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}{rw.start.label}
          </button>
          <p className="text-[12px] text-stone-600 leading-relaxed">{rw.start.note}</p>
        </div>
      )}
      {state === 'idle' && rw?.reasonText && canAct && <p className="mt-3 text-[12px] text-stone-500">{rw.reasonText}</p>}

      {/* 진행 · 끝 — 판마다 한 줄(이름 · 바꾼 곳 · 상태) · 끝이면 해 본 것으로 줄을 긋는다 */}
      {plates.length > 0 && state !== 'found' && (
        <ul className="mt-3 flex flex-col gap-1.5">
          {plates.map((p, i) => (
            <li key={`${p.name}-${i}`} className="rounded-[10px] border border-stone-200 px-3 py-2 flex items-center gap-2 flex-wrap">
              {p.tone === 'wait' && <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />}
              <b className={`text-[12.5px] font-bold text-stone-900 ${ended ? 'line-through decoration-stone-400' : ''}`}>{p.name}</b>
              {p.change && <span className="text-[11.5px] text-stone-500">{p.change}</span>}
              <span className={`ml-auto text-[12px] font-semibold ${p.tone === 'ok' ? 'text-amber-700' : 'text-stone-700'}`}>{p.stateText}</span>
            </li>
          ))}
        </ul>
      )}
      {state === 'working' && <p className="mt-2 text-[12px] text-stone-500">창을 닫아도 계속 찾아요.</p>}

      {/* 주소 물음 — 주소 바꾸기는 고객이 누를 때만 */}
      {state === 'ask_url' && rw?.ask && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-3">
          <p className="text-[12.5px] text-stone-800 leading-relaxed break-words">{rw.ask.text}</p>
          {canAct && (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {rw.ask.options.map((o) => (
                <button key={o.choice} type="button" onClick={() => answer(o.choice)} disabled={!!busy} className={o.choice === 'url' ? primary : ghost}>
                  {busy === o.choice && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}{o.label}
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11.5px] text-stone-500 leading-relaxed">{rw.ask.note}</p>
        </div>
      )}

      {/* 찾음 — 바꿈 목록(원래 → 바꾼) + 받기 */}
      {state === 'found' && rw?.found && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-3">
          <b className="block text-[13.5px] font-extrabold text-stone-900">{rw.found.title}</b>
          <ul className="mt-2 flex flex-col gap-1.5">
            {rw.found.fixes.map((f, i) => (
              <li key={i} className="rounded-[10px] border border-stone-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed break-words">
                <s className="block text-stone-400 decoration-stone-300">{f.before}</s>
                <span className="block text-stone-900 font-semibold">{f.after}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-stone-700 leading-relaxed">{rw.found.keepLine}</p>
          {rw.found.urlLine && <p className="mt-1 text-[12px] text-stone-700 leading-relaxed">{rw.found.urlLine}</p>}
          {canAct && rw.found.applyLabel && (
            <button type="button" onClick={apply} disabled={!!busy} className={`${primary} w-full mt-2.5`}>
              {busy === 'apply' && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />}{rw.found.applyLabel}
            </button>
          )}
          <p className="mt-2 text-[11.5px] text-stone-500 leading-relaxed">{rw.found.note}</p>
        </div>
      )}

      {ended && rw?.endText && <p className="mt-2.5 text-[12.5px] font-semibold text-stone-800 leading-relaxed">{rw.endText}</p>}
      {err && <p className="mt-2 text-[12px] text-rose-600">{err}</p>}
    </div>
  );
}
