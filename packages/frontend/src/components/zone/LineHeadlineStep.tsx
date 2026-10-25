/**
 * LineHeadlineStep — 한 줄 창 「첫 화면」 단계 = 이미지 스튜디오 템플릿 헤드라인 (★ 2026-10-21 · 설계서 docs/2026-10-21-oneline-content-design.md §3-4)
 *
 * Harold 「이미지스튜디오에서 해당 업체와 가장 비슷하고 한줄입력에서 가장 어울리는 템플릿을 활용해서 그걸 전면 헤드라인에」.
 *   ① 서버가 업종 · 한 줄로 3안을 고른다(POST /api/line-templates/headline-picks · 0원) → 예시 그림 카드 3장(「예시 그림」)
 *   ② [만들기] = 서버 한 경로(POST /api/image-studio/line-headline · 누끼 → 생성 → 저장 → 2크레딧 · 입력 지문 멱등키)
 *   ③ 받은 주소 = 대표 사진 · poster 표식(표지가 글자를 덮지 않는다)
 * ⛔ 화면은 유료 단계를 이어 붙이지 않는다(Codex P2 R1 · R2 같은 뿌리) — 새로고침 · 응답 유실 · 다시 누름 = 같은 입력 = 서버가 같은 결과(다시 걷지 않음).
 * 그림 안 글자 = 숫자 · 혜택 낱말 0 — 화면은 고치지 않고 알려만 준다(서버가 생성 직전 다시 본다 · 고쳐 쓰면 「10만원 → 만원」 같은 변조가 생긴다).
 */
import { useEffect, useState } from 'react';
import { creditText } from '../../constants/credit';
import { Loader2, Sparkles, Check, LayoutTemplate } from 'lucide-react';
import { studioPost, studioFetch } from '../../lib/studio-api';
import TemplatePicker, { type StudioTemplatePublic } from '../studio/TemplatePicker';

export interface LineHeadlinePickView { id: string; name: string; kind: 'product' | 'event'; sub: string | null; useCase: string; sampleUrl: string }

/** 서버 headlineTextSafe 와 같은 금지(숫자 · 혜택 낱말) — 화면은 안내만 */
const BENEFIT_RE = /할인|세일|쿠폰|적립|무료|증정|사은품|경품|반값|특가|최저가|퍼센트|프로|[%％]|원(?![가-힣])/;
export function headlineTextOk(v: string): boolean {
  return !/[0-9０-９]/.test(v) && !BENEFIT_RE.test(v);
}

export default function LineHeadlineStep({ storeKey, lineFp, line, productImage, productNames, made, onMade, onBusy, blocked = false }: {
  /** 이 한 줄의 답 보존 키(결과를 돌려줄 곳) */
  storeKey: string;
  /** 한 줄 지문(서버 멱등키 입력) */
  lineFp: string;
  line: string;
  /** 누끼를 얹을 상품 사진(몰 · 직접 넣은 사진 · 없으면 행사 템플릿만) */
  productImage: string | null;
  productNames: string[];
  /** 이미 만든 헤드라인(대표 사진 주소) */
  made: string | null;
  onMade: (url: string, storeKey: string) => void;
  /** 만드는 동안 = 부모가 다음 · 건너뛰기 · 만들기 · 단계 이동 · 템플릿 바꾸기 · 닫기를 잠근다(작업이 끝날 때 푼다) */
  onBusy: (busy: boolean) => void;
  /** 내 사진을 올리는 중(만들기를 막는다 · 늦게 끝난 업로드가 그림을 덮지 않게) */
  blocked?: boolean;
}) {
  const [picks, setPicks] = useState<LineHeadlinePickView[] | 'loading' | 'failed'>('loading');
  const [source, setSource] = useState<'ai' | 'rule'>('ai');
  const [chosen, setChosen] = useState<LineHeadlinePickView | null>(null);
  const [title, setTitle] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  // 이 한 줄로 지난번에 만든 그림 · 만드는 중이던 그림(서버 파일 원장 · 새로고침 · 응답 유실 뒤 0크레딧으로 되찾기 · Codex R3 · R4)
  //   만드는 중이면 끝날 때까지 3초마다 다시 묻고, 그동안 새로 만들기를 막는다(다른 입력으로 다시 걷히지 않게)
  const [last, setLast] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!lineFp) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const ask = () => {
      void studioFetch(`/api/image-studio/line-headline/last?lineFp=${encodeURIComponent(lineFp)}`).then(({ ok, data }) => {
        if (!alive) return;
        if (ok && typeof data.url === 'string') { setLast(data.url); setWaiting(false); return; }
        if (ok && data.running === true && Date.now() - started < 6 * 60_000) { setWaiting(true); timer = setTimeout(ask, 3000); return; }
        setWaiting(false);
      });
    };
    ask();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [lineFp]);

  useEffect(() => {
    let alive = true;
    void studioPost('/api/line-templates/headline-picks', { line, has_photo: !!productImage, products: productNames }).then(({ ok, data }) => {
      if (!alive) return;
      if (!ok || !Array.isArray(data.picks) || data.picks.length === 0) { setPicks('failed'); setGallery(true); return; }
      setPicks(data.picks);
      setSource(data.source === 'rule' ? 'rule' : 'ai');
      setChosen(data.picks[0]);
      setTitle(typeof data.title === 'string' && headlineTextOk(data.title) ? data.title.slice(0, 16) : '');
      if (data.source === 'rule') setGallery(true);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, !!productImage]);

  useEffect(() => {
    if (!busy) return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const make = async () => {
    if (!chosen || busy || waiting || blocked) return;
    const t = title.replace(/\s+/g, ' ').trim();
    const l = label.replace(/\s+/g, ' ').trim();
    if (!t) { setErr('헤드라인 글을 적어 주세요'); return; }
    if (chosen.kind === 'product' && !productImage) { setErr('이 템플릿은 상품 사진이 있어야 해요. 행사 템플릿을 골라 주세요'); return; }
    if (!headlineTextOk(t) || (l && !headlineTextOk(l))) { setErr('그림 안 글자에는 숫자 · 할인 · 쿠폰 같은 혜택 말을 넣지 않아요. 값은 상품 카드에 정확히 들어가요'); return; }
    setErr(null);
    setBusy(true);
    onBusy(true);
    try {
      const r = await studioPost('/api/image-studio/line-headline', {
        templateId: chosen.id, title: t, ...(l ? { label: l } : {}),
        ...(productImage && chosen.kind === 'product' ? { productImage } : {}), lineFp,
      });
      if (r.status === 402) throw new Error('크레딧이 부족해요. 충전한 뒤 다시 만들어 주세요');
      if (!r.ok || typeof r.data.url !== 'string') throw new Error(r.data?.error || '첫 화면을 만들지 못했어요. 다시 눌러도 같은 그림이면 다시 걷지 않아요');
      onMade(r.data.url, storeKey);
    } catch (e: any) {
      setErr(e?.message || '첫 화면을 만들지 못했어요');
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  const fromGallery = (tp: StudioTemplatePublic) => {
    // 제품 템플릿 = 실사진이 있어야(사진 없는 제품 포스터 = 지어낸 상품 · 서버도 거절)
    if ((tp.kind || 'product') === 'product' && !productImage) { setErr('이 템플릿은 상품 사진이 있어야 해요. 「행사 포스터」 쪽에서 골라 주세요'); return; }
    const v: LineHeadlinePickView = { id: tp.id, name: tp.name, kind: (tp.kind || 'product') as 'product' | 'event', sub: tp.sub ?? null, useCase: tp.useCase || tp.desc, sampleUrl: tp.exampleUrl || `/api/image-studio/template-sample/${tp.id}` };
    setChosen(v);
    setPicks((p) => (Array.isArray(p) ? [v, ...p.filter((x) => x.id !== v.id)].slice(0, 3) : [v]));
    setGallery(false);
  };

  const titleBad = !!title && !headlineTextOk(title);
  const labelBad = !!label && !headlineTextOk(label);
  return (
    <div className="space-y-4">
      {waiting && !busy && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 flex items-center gap-2 text-[13px] text-amber-900">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />아까 만들던 첫 화면 그림을 마저 받는 중이에요. 다 되면 여기 나와요(새로 걷지 않아요)
        </div>
      )}
      {last && last !== made && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3 flex items-center gap-3">
          <img src={last} alt="지난번에 만든 첫 화면" className="w-16 h-[85px] rounded-lg object-cover border border-violet-200 shrink-0" />
          <p className="text-[13px] text-violet-900 flex-1 min-w-0">이 한 줄로 지난번에 만든 그림이 있어요</p>
          <button type="button" disabled={busy || blocked} onClick={() => { if (!busy && !blocked) onMade(last, storeKey); }} className="shrink-0 h-9 px-3 rounded-lg bg-violet-600 text-white text-[12.5px] font-bold hover:bg-violet-700 disabled:opacity-40 whitespace-nowrap">이 그림 쓰기 · 0크레딧</button>
        </div>
      )}
      {made && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 flex items-center gap-3">
          <img src={made} alt="만든 첫 화면" className="w-16 h-[85px] rounded-lg object-cover border border-emerald-200 shrink-0" />
          <p className="text-[13px] text-emerald-900 flex-1 min-w-0"><Check className="inline w-4 h-4 mr-1" />이 그림이 DM · 이메일 · 인앱의 맨 위에 크게 들어가요</p>
        </div>
      )}
      {picks === 'loading' ? (
        <div className="h-40 flex items-center justify-center gap-2 text-slate-500 text-[13px]"><Loader2 className="w-5 h-5 animate-spin" />우리 업종 · 이 한 줄에 맞는 템플릿을 고르는 중</div>
      ) : (
        <>
          {Array.isArray(picks) && (
            <div>
              <p className="text-[12.5px] text-slate-500 mb-2">{source === 'ai' ? '이 업체 · 이 한 줄에 어울리는 템플릿 세 가지예요' : '자동 추천을 받지 못해 우리 업종 템플릿을 순서대로 보여 드려요'}</p>
              <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-1">
                {picks.map((p) => (
                  <button key={p.id} type="button" onClick={() => setChosen(p)} aria-pressed={chosen?.id === p.id} disabled={busy}
                    className={`snap-start shrink-0 w-[46%] md:w-auto text-left rounded-2xl border-2 overflow-hidden bg-white transition-colors ${chosen?.id === p.id ? 'border-violet-500' : 'border-slate-200 hover:border-slate-300'}`}>
                    <div className="relative aspect-[3/4] bg-slate-100">
                      <img src={p.sampleUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                      <span className="absolute left-2 top-2 h-5 px-1.5 rounded bg-black/55 text-white text-[11px] font-semibold flex items-center">예시 그림</span>
                    </div>
                    <div className="p-2.5">
                      <p className="text-[13px] font-semibold text-slate-900 truncate">{p.name}</p>
                      <p className="text-[11.5px] text-slate-500 line-clamp-2">{p.useCase}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <button type="button" onClick={() => setGallery((v) => !v)} disabled={busy} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-violet-700 hover:text-violet-900 disabled:opacity-40">
            <LayoutTemplate className="w-4 h-4" />{gallery ? '다른 템플릿 닫기' : '다른 템플릿 더 보기'}
          </button>
          {gallery && !busy && (
            <div className="rounded-2xl border border-slate-200 p-3 max-h-[420px] overflow-y-auto">
              <TemplatePicker onPick={fromGallery} autoOpenIndustry gridClassName="grid grid-cols-2 sm:grid-cols-3 gap-3" />
            </div>
          )}
          {chosen && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[12.5px] font-semibold text-slate-700">헤드라인(그림에 크게 · 숫자 없이)</span>
                <input value={title} maxLength={16} disabled={busy} onChange={(e) => setTitle(e.target.value)} aria-invalid={titleBad}
                  className={`mt-1 w-full h-11 px-3 rounded-xl border text-[14px] focus:outline-none ${titleBad ? 'border-rose-400' : 'border-slate-300 focus:border-violet-500'}`} />
              </label>
              <label className="block">
                <span className="text-[12.5px] font-semibold text-slate-700">작은 말머리(선택 · 숫자 없이)</span>
                <input value={label} maxLength={12} disabled={busy} onChange={(e) => setLabel(e.target.value)} aria-invalid={labelBad}
                  className={`mt-1 w-full h-11 px-3 rounded-xl border text-[14px] focus:outline-none ${labelBad ? 'border-rose-400' : 'border-slate-300 focus:border-violet-500'}`} />
              </label>
            </div>
          )}
          {(titleBad || labelBad) && <p className="text-[12.5px] text-rose-600">숫자 · 할인 · 쿠폰 같은 혜택 말은 그림 대신 상품 카드 · 혜택 띠에 정확히 들어가요</p>}
          {err && <p className="text-[13px] text-rose-600">{err}</p>}
          {chosen && (
            <button type="button" onClick={() => void make()} disabled={busy || waiting || blocked || titleBad || labelBad}
              className="w-full h-12 rounded-xl bg-violet-600 text-white text-[14px] font-bold hover:bg-violet-700 disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {busy ? <><Loader2 className="w-5 h-5 animate-spin" />첫 화면 그림을 만드는 중 · {secs}초(보통 20~40초)</> : <><Sparkles className="w-5 h-5" />{made ? '이 템플릿으로 다시 만들기' : '이 템플릿으로 첫 화면 만들기'} · {creditText('image-studio-generate')}</>}
            </button>
          )}
          <p className="text-[12px] text-slate-500">가격 · 할인율은 그림이 아니라 상품 카드에 정확히 들어가요{productImage ? ' · 상품 사진은 배경만 지우고 그대로 써요' : ''}</p>
        </>
      )}
    </div>
  );
}
