/**
 * RecoSlotControl — 여정 문자 칸의 「추천 상품」 줄 (★ 2026-11-13 C133 F2 ① · 설계서 §5-4)
 *
 * 받는 분마다 관심 상품 이름이 문안 한 자리에 들어간다. 나갈 수 있는 것은 담당자가 여기서 고른 후보(최대 3개)와 직접 쓴 대체 문장뿐이다.
 *   - 후보 = 서버 제안(최근 30일 판매 · 조회 위 순)을 전부 보여 주고 담당자가 고른다. 숫자는 보이지 않는다(회사 전체 값).
 *   - 넣으면 본문 커서 자리에 자리 글자가 들어간다(본문이 곧 진실 · 새 칸 없음). 고치기 · 빼기도 본문을 고치는 일이다.
 *   - 받는 모습 = 판을 골라 본다(고객에게 맞춘 글 · 후보마다 · 대체 문장). 휴대폰의 [받는 모습]이 그 판으로 서버에 묻는다.
 * ⛔ 열리지 않은 회사 = 이 줄을 그리지 않는다(서버 응답 live · 판정의 주인은 서버).
 */
import { useEffect, useMemo, useState } from 'react';
import { fetchJson } from '../../utils/dashboard-live';
import { buildRecoTag, readRecoSlot, recoTextForbidden, recoTexts, removeRecoSlot } from '../../utils/reco-slot';

interface Candidates { live: boolean; hasSignals: boolean; candidates: string[]; max: number }

/** 후보 제안 — 화면이 떠 있는 동안 한 번(닫힌 회사 · 실패 = 줄을 그리지 않는다) */
function useRecoCandidates(): Candidates | null {
  const [state, setState] = useState<Candidates | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchJson('/api/product-insight/reco-candidates').then((r) => {
      if (!alive || !r.ok || !r.body?.success) return;
      setState({
        live: r.body.live === true, hasSignals: r.body.hasSignals === true,
        candidates: Array.isArray(r.body.candidates) ? r.body.candidates.map(String) : [], max: Number(r.body.max) || 3,
      });
    });
    return () => { alive = false; };
  }, []);
  return state;
}

interface Props {
  body: string;
  /** 자리 글자를 넣는다(본문 커서 자리 · 작업 화면의 변수 넣기와 같은 길) */
  onInsert: (tag: string) => void;
  /** 본문을 통째로 바꾼다(고치기 · 빼기) */
  onBody: (next: string) => void;
  /** 받는 모습에서 볼 판 — undefined = 고객에게 맞춘 글 */
  viewIndex: number | undefined;
  onViewIndex: (i: number | undefined) => void;
  /** 줄 틀(이름 | 내용) — 열리지 않은 회사에는 줄 자체가 없다 */
  wrap: (children: React.ReactNode) => React.ReactNode;
}

const chipCls = (on: boolean, disabled = false) =>
  `h-8 max-w-full truncate rounded-full px-3 text-[12.5px] font-medium transition-colors ${
    on ? 'bg-indigo-50 text-indigo-800 ring-1 ring-indigo-300'
      : disabled ? 'bg-slate-50 text-slate-400 ring-1 ring-slate-200'
        : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300'}`;

export default function RecoSlotControl({ body, onInsert, onBody, viewIndex, onViewIndex, wrap }: Props) {
  const data = useRecoCandidates();
  const read = useMemo(() => readRecoSlot(body, data?.max ?? 3), [body, data?.max]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [fallback, setFallback] = useState('');

  // 본문의 자리가 사라지면(직접 지움 · 칸 이동) 골라 보던 판을 되돌린다
  useEffect(() => { if (read.kind !== 'ok' && viewIndex !== undefined) onViewIndex(undefined); }, [read.kind, viewIndex, onViewIndex]);

  if (!data || !data.live) return null;
  const max = data.max;

  const startEdit = () => {
    if (read.kind === 'ok') { setPicked(read.slot.names); setFallback(read.slot.fallback); } else { setPicked([]); setFallback(''); }
    setOpen(true);
  };
  const toggle = (name: string) => setPicked((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : prev.length >= max ? prev : [...prev, name]));
  const fallbackBad = recoTextForbidden(fallback);
  const canSave = picked.length >= 1 && fallback.trim().length > 0 && !fallbackBad;
  const save = () => {
    if (!canSave) return;
    const tag = buildRecoTag(picked, fallback);
    if (read.kind === 'ok') onBody(body.split(read.slot.raw).join(tag)); else onInsert(tag);
    onViewIndex(undefined);
    setOpen(false);
  };
  // 고치는 중인 자리의 후보가 제안 목록에 더는 없어도(끊긴 상품) 고른 채로 보이게 앞에 둔다
  const options = [...picked.filter((n) => !data.candidates.includes(n)), ...data.candidates];

  return <>{wrap(
    <div className="min-w-0">
      {read.kind === 'ok' && !open && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {read.slot.names.map((n, i) => (
              <span key={n} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full bg-indigo-50 px-3 text-[12.5px] font-medium text-indigo-800 ring-1 ring-indigo-200">
                <span className="tabular-nums text-indigo-500">{i + 1}</span><span className="truncate">{n}</span>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">
            관심 상품이 없는 분에게는 <span className="font-medium text-slate-900">{read.slot.fallback}</span> 로 나가요.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="받는 모습에서 볼 판">
            <span className="mr-0.5 text-[12px] text-slate-500">받는 모습</span>
            <button type="button" aria-pressed={viewIndex === undefined} onClick={() => onViewIndex(undefined)} className={chipCls(viewIndex === undefined)}>고객에게 맞춰</button>
            {recoTexts(read.slot).map((t, i) => (
              <button key={`${i}-${t}`} type="button" aria-pressed={viewIndex === i} onClick={() => onViewIndex(i)} className={chipCls(viewIndex === i)}>
                {i < read.slot.names.length ? t : '대체 문장'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
            판을 고르고 휴대폰의 받는 모습을 누르면 그 판으로 보여요. 바이트는 가장 긴 판 기준으로 세요. 켜기 전 점검이 후보마다 스팸 검사를 해요.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={startEdit} className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300">후보 고치기</button>
            <button type="button" onClick={() => { onBody(removeRecoSlot(body)); onViewIndex(undefined); }} className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-slate-500 hover:text-slate-800">문안에서 빼기</button>
          </div>
        </>
      )}

      {read.kind === 'bad' && !open && (
        <p className="pt-1 text-[12.5px] leading-relaxed text-rose-700">
          문안의 추천 상품 자리 꼴이 맞지 않아요. 문안에서 그 부분을 지우고 아래 단추로 다시 넣어 주세요.
        </p>
      )}

      {read.kind !== 'ok' && !open && (
        <div className={read.kind === 'bad' ? 'mt-2' : ''}>
          {data.hasSignals ? (
            <>
              <button type="button" onClick={startEdit} disabled={read.kind === 'bad'} className="h-8 rounded-lg bg-white px-3 text-[12.5px] font-medium text-indigo-800 ring-1 ring-indigo-300 hover:bg-indigo-50 disabled:opacity-40">추천 상품 넣기</button>
              <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
                받는 분이 최근에 본 상품 이름이 문안에 들어가요. 매장이나 자사몰에서 이미 산 상품은 권하지 않아요.
              </p>
            </>
          ) : (
            <p className="pt-1 text-[12.5px] leading-relaxed text-slate-500">최근 30일 상품 조회나 구매가 쌓이면 추천 상품을 넣을 수 있어요.</p>
          )}
        </div>
      )}

      {open && (
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[12.5px] font-semibold text-slate-800">후보 고르기</span>
            <span className="text-[12px] tabular-nums text-slate-500">{picked.length} / {max}</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">최근 30일 많이 팔리고 많이 본 순서예요. 고른 순서가 권하는 순서예요.</p>
          <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            {options.map((n) => {
              const on = picked.includes(n);
              const full = !on && picked.length >= max;
              return (
                <button key={n} type="button" aria-pressed={on} disabled={full} onClick={() => toggle(n)} className={chipCls(on, full)} title={n}>
                  {on && <span className="mr-1 tabular-nums text-indigo-500">{picked.indexOf(n) + 1}</span>}{n}
                </button>
              );
            })}
          </div>
          <label className="mt-3 block text-[12.5px] font-semibold text-slate-800" htmlFor="reco-fallback">대체 문장</label>
          <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">권할 상품이 없는 분에게 그 자리에 대신 들어갈 말이에요.</p>
          <input
            id="reco-fallback" value={fallback} onChange={(e) => setFallback(e.target.value)}
            placeholder="예: 요즘 많이 찾는 상품" aria-invalid={fallbackBad}
            className="mt-1.5 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-900 placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none"
          />
          {fallbackBad && <p className="mt-1 text-[12px] text-rose-700">대체 문장에는 {'< > | % { } [ ]'} 를 쓸 수 없어요.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={save} disabled={!canSave} className="h-9 rounded-lg bg-indigo-600 px-3.5 text-[12.5px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
              {read.kind === 'ok' ? '이대로 바꾸기' : '문안에 넣기'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg px-3 text-[12.5px] font-medium text-slate-600 hover:text-slate-900">취소</button>
            {!canSave && <span className="text-[12px] text-slate-500">{picked.length < 1 ? '후보를 하나 이상 골라 주세요.' : !fallback.trim() ? '대체 문장을 적어 주세요.' : ''}</span>}
          </div>
        </div>
      )}
    </div>,
  )}</>;
}
