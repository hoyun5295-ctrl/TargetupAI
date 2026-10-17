/**
 * LineStepsModal.tsx — 한 줄 → 단계별 모달(질문 · 재료) → 만들기 (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §3-15 · §5)
 *
 * "한 줄에 없는 사실과 재료만, 한 단계에 하나씩 여쭙니다."
 *   - 무엇을 물을지 = 서버 단계 목록(plan) 그대로 · 화면은 닫힌 키의 문구만 소유 · 건너뜀 조건은 서버가 실어 보낸 이름 하나만 해석.
 *   - 한 단계 = 단계 이름(막대) · 질문 20px · 이유 14px · 입력 하나 · 바닥 버튼 2개. 색 = 남색 지금 · 보라 고객이 준 것 · 초록 우리 데이터 · 회색 비움 · 앰버 유료 버튼만.
 *   - 마지막 「만들기」 단계가 금액 확인을 겸한다(줄을 누르면 그 단계로 · 잔액 부족 = 잠금).
 *   - 답은 sessionStorage 에 바로 남는다(닫았다 다시 열어도 이어서 · 성공했을 때만 호출부가 지운다).
 * ⛔ 바깥 눌러 닫힘 없음 · 모델명 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, ChevronLeft, Camera, Check, Loader2, Gift, Link2, CalendarDays, ImageIcon, PencilLine, Plus, Coins, ShoppingBag } from 'lucide-react';
import JourneyModalShell from '../journey/JourneyModalShell';
import { useBodyFlag } from '../../lib/surface-flags';
import { useAuthStore } from '../../stores/authStore';
import { LineReadToggle } from './LineFacts';
import {
  type LineStepsPlan, type LineStep, type LineStepsAnswers, type LineManualAnswer, type LineCandidatesResult, type LineMallCandidate, type LineStepsChannel,
  emptyLineStepsAnswers, lineStepId, lineStepsProducts, lineStepsManual, lineStepSkipped, lineStepTerms, lineManualPrice, normalizeLineLink,
  buildLineStepsBody, fetchLineCandidates, uploadLineImage, lineStepsStoreKey, loadLineStepsAnswers, saveLineStepsAnswers, LINE_UPLOAD_MAX_MB,
} from '../../utils/one-line';

export interface LineStepsOpen {
  line: string;
  /** 한 줄에 그대로 남은 사진 글 조각(있으면 만들기 단계에 「숫자도 그대로 쓰기」) */
  reads: string[];
  plan: LineStepsPlan;
  /** plan 에 금액이 없을 때(원장 조회 실패) 쓰는 전체 금액 · 서버가 409 로 알려 준 새 금액 */
  fallbackCost: number | null;
  costOverride?: number | null;
  /** 다시 열 때(실패 뒤) 만들기 단계 위에 보이는 한 줄 */
  notice?: string | null;
  atMake?: boolean;
  /** 고른 몰 상품을 지금 쓸 수 없다고 돌아왔을 때 — 몰 상품 답을 비우고 연다 */
  dropPicks?: boolean;
}
export interface LineStepsMade {
  body: Record<string, unknown>;
  cost: number;
  storeKey: string;
  readLicensed: boolean;
}

const MAKE = 'make';
const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}원`;
const isComposing = (e: React.KeyboardEvent) => (e.nativeEvent as KeyboardEvent).isComposing;

/** 'YYYY-MM-DD'(지역 날짜) */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function periodChips(): Array<{ label: string; value: string }> {
  const now = new Date();
  const sunday = new Date(now); sunday.setDate(now.getDate() + ((7 - now.getDay()) % 7));
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const week = new Date(now); week.setDate(now.getDate() + 6);
  const out = [{ label: '이번 주 일요일까지', value: ymd(sunday) }, { label: '일주일 동안', value: ymd(week) }, { label: '이달 말까지', value: ymd(monthEnd) }];
  return out.filter((c, i) => out.findIndex((x) => x.value === c.value) === i);
}
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function periodLabel(v: string): string {
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) return v;
  return `${m}월 ${d}일(${WEEK[new Date(y, m - 1, d).getDay()]})까지`;
}

function stepName(s: LineStep | typeof MAKE): string {
  if (s === MAKE) return '만들기';
  if (s.key === 'benefit') return '혜택';
  if (s.key === 'product') return s.item || '상품';
  if (s.key === 'hero_photo') return '대표 사진';
  if (s.key === 'link') return '버튼 주소';
  return '기간';
}

/** 출처 표시(왜 묻는가) — 보라 = 한 줄 · 고객 · 초록 = 우리 데이터 */
function Why({ tone, children }: { tone: 'customer' | 'data'; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12.5px] font-semibold ${tone === 'data' ? 'bg-emerald-50 text-emerald-800' : 'bg-violet-50 text-violet-800'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tone === 'data' ? 'bg-emerald-500' : 'bg-violet-500'}`} />{children}
    </span>
  );
}

/** 사진 칸(누르거나 끌어 놓기) — 올리는 중 · 실패 문장을 칸 안에서 보인다 */
function PhotoDrop({ channel, value, onChange, size }: { channel: LineStepsChannel; value: string | null | undefined; onChange: (url: string | null) => void; size: 'hero' | 'tile' }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const take = async (file: File | undefined | null) => {
    if (!file || busy) return;
    setBusy(true);
    setErr(null);
    try { onChange(await uploadLineImage(file, channel)); } catch (e: any) { setErr(e?.message || '사진을 올리지 못했어요'); } finally { setBusy(false); }
  };
  const box = size === 'hero' ? 'w-full aspect-[16/9] rounded-2xl' : 'w-[104px] h-[104px] rounded-xl shrink-0';
  return (
    <div className={size === 'hero' ? 'w-full' : ''}>
      <input ref={ref} type="file" accept={channel === 'inapp' ? 'image/png,image/jpeg,image/gif,image/webp' : 'image/png,image/jpeg,image/webp'} className="hidden" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      {value ? (
        <div className={`relative ${box} overflow-hidden bg-slate-100 border border-slate-200`}>
          <img src={value} alt="올린 사진" className="w-full h-full object-cover" />
          <div className="absolute inset-x-0 bottom-0 flex gap-1.5 p-2 bg-gradient-to-t from-black/50 to-transparent">
            <button type="button" onClick={() => ref.current?.click()} className="h-8 px-3 rounded-lg bg-white/95 text-[12.5px] font-semibold text-slate-800 hover:bg-white">바꾸기</button>
            <button type="button" onClick={() => onChange(null)} className="h-8 px-3 rounded-lg bg-white/95 text-[12.5px] font-semibold text-slate-800 hover:bg-white">빼기</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void take(e.dataTransfer.files?.[0]); }}
          className={`${box} flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-indigo-400 hover:bg-indigo-50/40 hover:text-indigo-700 transition-colors`}
        >
          {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Camera className={size === 'hero' ? 'w-7 h-7' : 'w-5 h-5'} />}
          <span className={size === 'hero' ? 'text-[15px] font-semibold' : 'text-[12px] font-semibold'}>{busy ? '올리는 중' : '사진 올리기'}</span>
          {size === 'hero' && !busy && <span className="text-[12.5px] text-slate-400">눌러서 고르거나 끌어다 놓기 · {LINE_UPLOAD_MAX_MB[channel]}MB까지</span>}
        </button>
      )}
      {err && <p className="mt-2 text-[13px] text-rose-600" role="alert">{err}</p>}
    </div>
  );
}

/** 만들기 단계 한 줄 — 이름 · 점(보라 고객 · 초록 우리 데이터 · 회색 비움) · 값 · 오른쪽 버튼(선택) */
function Row({ label, children, tone, onClick, action }: { label: string; children: ReactNode; tone: 'customer' | 'data' | 'empty'; onClick?: () => void; action?: ReactNode }) {
  const dot = tone === 'customer' ? 'bg-violet-500' : tone === 'data' ? 'bg-emerald-500' : 'bg-slate-300';
  const inner = (
    <>
      <span className="w-[84px] shrink-0 text-[13px] font-semibold text-slate-500 pt-px truncate">{label}</span>
      <span className={`flex-1 min-w-0 flex items-start gap-2 text-[14.5px] ${tone === 'empty' ? 'text-slate-400' : 'text-slate-900'}`}>
        <span className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        <span className="min-w-0 break-words">{children}</span>
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-2">
      {onClick ? <button type="button" onClick={onClick} className="flex-1 min-w-0 flex items-start gap-3 text-left rounded-xl px-3 py-2.5 hover:bg-slate-50 transition-colors">{inner}</button>
        : <div className="flex-1 min-w-0 flex items-start gap-3 px-3 py-2.5">{inner}</div>}
      {action}
    </li>
  );
}

export default function LineStepsModal({ open, channel, state, onClose, onMake }: {
  open: boolean;
  channel: LineStepsChannel;
  state: LineStepsOpen | null;
  onClose: () => void;
  onMake: (made: LineStepsMade) => void;
}) {
  useBodyFlag('data-interrupt-open', open);
  const user = useAuthStore((s) => s.user);
  const plan = state?.plan ?? null;
  const storeKey = plan ? lineStepsStoreKey(user?.company?.id || '-', user?.id || '-', channel, plan.line_fp) : '';

  const [answers, setAnswers] = useState<LineStepsAnswers>(emptyLineStepsAnswers);
  const [cursor, setCursor] = useState<string>(MAKE);
  const [linkOpened, setLinkOpened] = useState(false);
  const [cands, setCands] = useState<LineCandidatesResult | 'loading' | 'failed'>('loading');
  const [balance, setBalance] = useState<{ total: number; enabled: boolean } | null>(null);
  // 복원을 마친 보존 키(복원 전 렌더의 옛 답을 새 키에 쓰지 않게)
  const [restored, setRestored] = useState('');
  // 지금 단계의 입력 초안(다음을 누를 때 답이 된다)
  const [draft, setDraft] = useState<{ text: string; manual: LineManualAnswer | null; err: string | null }>({ text: '', manual: null, err: null });
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const firstFocus = useRef(true);

  // 열 때: 보존한 답 복원 → 시작 단계 → 몰 후보 한 번
  useEffect(() => {
    if (!open || !plan) return;
    const saved = loadLineStepsAnswers(storeKey);
    let a = saved?.answers ?? emptyLineStepsAnswers();
    if (state?.dropPicks) {
      const products: LineStepsAnswers['products'] = {};
      for (const [k, v] of Object.entries(a.products)) products[k] = v.mode === 'pick' ? { mode: 'skip' } : v;
      a = { ...a, products, urlPicks: [] };
    }
    setAnswers(a);
    setRestored(storeKey);
    setLinkOpened(false);
    setBalance(null);
    firstFocus.current = true;
    const first = plan.steps.find((s) => !lineStepSkipped(s, a, channel, lineStepTerms(plan, a)));
    setCursor(state?.atMake || !first ? MAKE : lineStepId(first));
    // 몰이 없으면 후보를 부르지 않는다(상품 단계 = 직접 넣기 · 주소로 찾을 몰도 없다)
    if (!plan.mall) { setCands({ byTerm: {}, byUrl: [] }); return; }
    setCands('loading');
    const ctrl = new AbortController();
    void fetchLineCandidates(state?.line || '', channel, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setCands(r ?? 'failed');
      // H5 — 한 줄 속 우리 몰 주소로 찾은 상품은 미리 담는다(처음 한 번만 · 빼기 가능)
      if (r && r.byUrl.length > 0) setAnswers((prev) => (prev.urlPicks === undefined && !state?.dropPicks ? { ...prev, urlPicks: channel === 'inapp' ? r.byUrl.slice(0, 1) : r.byUrl } : prev));
    });
    return () => ctrl.abort();
    // 여는 사건에만 반응한다(답 · 커서는 안에서 바뀐다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeKey]);

  // 답이 바뀌면 바로 남긴다
  useEffect(() => { if (open && plan && restored === storeKey) saveLineStepsAnswers(storeKey, answers, new Date().toISOString()); }, [answers, open, plan, storeKey, restored]);

  const termOrder = useMemo(() => (plan ? lineStepTerms(plan, answers) : []), [plan, answers]);
  const allSteps: LineStep[] = useMemo(() => {
    if (!plan) return [];
    const extra: LineStep[] = answers.offersAdded
      .filter((t) => !plan.steps.some((s) => s.key === 'product' && s.item === t))
      .map((t) => { const o = plan.offers.find((x) => x.item === t); return { key: 'product', item: t, manual_ok: true, ...(o?.price ? { price: o.price } : {}), ...(o?.url ? { url: o.url } : {}) }; });
    const linkExtra: LineStep[] = linkOpened && !plan.steps.some((s) => s.key === 'link') ? [{ key: 'link' }] : [];
    return [...plan.steps, ...extra, ...linkExtra];
  }, [plan, answers.offersAdded, linkOpened]);
  const visible = useMemo(() => allSteps.filter((s) => !lineStepSkipped(s, answers, channel, termOrder)), [allSteps, answers, channel, termOrder]);
  // 커서 단계가 방금 답으로 건너뜀이 됐으면(예: 상품 사진을 넣어 대표 사진 단계가 빠짐) 그 뒤 첫 단계로 — 만들기로 튀지 않게
  const current: LineStep | typeof MAKE = (() => {
    if (cursor === MAKE) return MAKE;
    const hit = visible.find((s) => lineStepId(s) === cursor);
    if (hit) return hit;
    const at = allSteps.findIndex((s) => lineStepId(s) === cursor);
    return (at >= 0 ? allSteps.slice(at + 1).find((s) => visible.includes(s)) : undefined) ?? MAKE;
  })();
  const idx = current === MAKE ? visible.length : visible.indexOf(current);

  // 단계가 바뀌면 그 단계 입력 초안을 답에서 채우고, 입력칸(없으면 질문 제목)으로 포커스
  useEffect(() => {
    if (!open || !plan) return;
    if (current !== MAKE && current.key === 'product') {
      const term = current.item || '';
      const p = answers.products[term];
      const base: LineManualAnswer = p?.manual ?? { name: term, price: current.price ? current.price.toLocaleString() : '', image: null, ...(current.url ? { url: current.url } : {}) };
      setDraft({ text: '', manual: base, err: null });
    } else if (current !== MAKE) {
      const v = current.key === 'benefit' ? answers.benefit : current.key === 'link' ? answers.link : current.key === 'period' ? answers.period : null;
      setDraft({ text: typeof v === 'string' ? v : '', manual: null, err: null });
    }
    if (firstFocus.current) { firstFocus.current = false; return; }   // 처음 = 껍데기가 첫 입력칸을 잡는다
    requestAnimationFrame(() => (inputRef.current ?? titleRef.current)?.focus());
    // 커서가 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, open]);

  // 만들기 단계에서 잔액 한 번
  useEffect(() => {
    if (!open || current !== MAKE || balance) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/companies/my-credit', { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
        const d = await res.json().catch(() => null);
        if (alive && res.ok && d && d.success !== false) setBalance({ total: Number(d.total) || 0, enabled: d.creditEnabled !== false });
      } catch { /* 잔액 줄만 못 보인다 */ }
    })();
    return () => { alive = false; };
  }, [open, current, balance]);

  if (!open || !plan || !state) return null;

  const cost = state.costOverride ?? plan.cost?.total ?? state.fallbackCost;
  const generateCost = plan.cost?.generate ?? null;
  const go = (id: string) => setCursor(id);
  const next = () => { const n = visible[idx + 1]; setCursor(n ? lineStepId(n) : MAKE); };
  const prev = () => { const p = visible[idx - 1]; if (p) setCursor(lineStepId(p)); };
  const setA = (patch: Partial<LineStepsAnswers>) => setAnswers((a) => ({ ...a, ...patch }));
  const setProduct = (term: string, v: LineStepsAnswers['products'][string]) => setAnswers((a) => ({ ...a, products: { ...a.products, [term]: v } }));

  // ─── 지금 단계의 내용 · 다음 / 건너뛰기 동작 ───
  let eyebrow: ReactNode = null;
  let question = '';
  let reason = '';
  let body: ReactNode = null;
  let onNext: () => void = next;
  let onSkip: (() => void) | null = null;
  let nextLabel = '다음';
  let nextDisabled = false;

  if (current !== MAKE && current.key === 'benefit') {
    eyebrow = <Why tone="customer">한 줄에 혜택 숫자가 없어요</Why>;
    question = '어떤 혜택을 드리나요?';
    reason = '혜택 숫자는 AI가 지어내지 않아요. 적어 주시면 첫 줄에 그대로 실어요';
    body = (
      <input ref={inputRef} className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-[16px] text-slate-900 placeholder-slate-400 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
        aria-labelledby="line-steps-q" aria-describedby="line-steps-why" maxLength={300} placeholder="예: 전 상품 20% · 첫 구매 5천원 쿠폰" value={draft.text}
        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); onNext(); } }} />
    );
    onNext = () => { const t = draft.text.trim(); setA({ benefit: t ? t : null }); next(); };
    onSkip = () => { setA({ benefit: null }); next(); };
    nextLabel = draft.text.trim() ? '다음' : '혜택 없이 다음';
  } else if (current !== MAKE && current.key === 'product') {
    const term = current.item || '';
    const ans = answers.products[term];
    const res = cands === 'loading' || cands === 'failed' ? null : cands.byTerm[term];
    const loading = plan.mall && cands === 'loading';
    const manualView = ans?.mode === 'manual' || (!loading && !(res && res.status === 'ok') && (current.manual_ok || !plan.mall));
    if (manualView) {
      const m = draft.manual ?? { name: term, price: '', image: null };
      const priceBad = !!m.price.trim() && lineManualPrice(m.price) === null;
      eyebrow = plan.mall && !(res && res.status === 'ok')
        ? <Why tone="data">{res?.status === 'none' ? '우리 몰에서 찾지 못한 상품이에요' : '우리 몰 상품을 확인하지 못했어요'}</Why>
        : current.price ? <Why tone="customer">한 줄에 적은 가격을 넣어 뒀어요</Why> : <Why tone="customer">한 줄에 적은 상품이에요</Why>;
      question = `「${term}」 상품을 알려 주세요`;
      reason = '사진과 가격을 넣으면 상품 카드로 실어요. 가격만 넣으면 글로 소개해요';
      body = (
        <div className="flex gap-4 items-start">
          <PhotoDrop channel={channel} size="tile" value={m.image} onChange={(url) => setDraft({ ...draft, manual: { ...m, image: url } })} />
          <div className="flex-1 min-w-0 space-y-2.5">
            <label className="block">
              <span className="block text-[13px] font-semibold text-slate-600 mb-1">상품 이름</span>
              <input ref={inputRef} className="w-full h-12 px-3.5 rounded-xl border border-slate-300 bg-white text-[16px] text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                maxLength={60} value={m.name} onChange={(e) => setDraft({ ...draft, manual: { ...m, name: e.target.value } })} />
            </label>
            <label className="block">
              <span className="block text-[13px] font-semibold text-slate-600 mb-1">판매 가격</span>
              <span className="relative block">
                <input inputMode="numeric" className={`w-full h-12 pl-3.5 pr-10 rounded-xl border bg-white text-[16px] text-slate-900 placeholder-slate-400 outline-none focus:ring-4 ${priceBad ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'}`}
                  maxLength={12} placeholder="예: 39,000" value={m.price}
                  onChange={(e) => { const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 9); setDraft({ ...draft, manual: { ...m, price: digits ? Number(digits).toLocaleString() : '' } }); }} />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[14px] text-slate-400">원</span>
              </span>
              {priceBad && <span className="block mt-1 text-[12.5px] text-rose-600">1억 원 이하로 적어 주세요</span>}
            </label>
            {res && res.status === 'ok' && (
              <button type="button" onClick={() => setProduct(term, { mode: 'skip' })} className="inline-flex items-center gap-1.5 h-9 px-1 text-[14px] font-semibold text-indigo-700 hover:text-indigo-900">
                <ShoppingBag className="w-4 h-4" />우리 몰 상품에서 고르기
              </button>
            )}
          </div>
        </div>
      );
      nextDisabled = priceBad || !m.name.trim();
      onNext = () => { setProduct(term, { mode: 'manual', manual: { ...m, name: m.name.trim() } }); next(); };
      onSkip = () => { setProduct(term, { mode: 'skip' }); next(); };
    } else if (loading) {
      eyebrow = <Why tone="data">우리 몰에서 찾는 중</Why>;
      question = `「${term}」, 우리 몰의 어떤 상품인가요?`;
      reason = '몰에서 찾고 있어요. 기다리지 않고 다음으로 넘어가도 돼요';
      body = <div className="grid grid-cols-3 gap-2.5">{[0, 1, 2].map((i) => <div key={i} className="aspect-[3/4] rounded-xl bg-slate-100 animate-pulse" />)}</div>;
      onNext = next;
      onSkip = () => { setProduct(term, { mode: 'skip' }); next(); };
    } else if (res && res.status === 'ok') {
      const picked = ans?.mode === 'pick' ? ans.picked : null;
      eyebrow = <Why tone="data">우리 몰에서 찾았어요</Why>;
      question = `「${term}」, 우리 몰의 이 상품인가요?`;
      reason = '누른 상품만 담아요. 사진 · 가격 · 링크는 만들 때 몰에서 다시 확인해요';
      body = (
        <div>
          <div className="grid grid-cols-3 gap-2.5">
            {res.candidates.map((c) => {
              const on = !!picked && picked.provider === c.provider && picked.no === c.no;
              return (
                <button key={`${c.provider}:${c.no}`} type="button" aria-pressed={on} onClick={() => setProduct(term, on ? { mode: 'skip' } : { mode: 'pick', picked: c })}
                  className={`text-left rounded-xl p-2 border-2 transition-colors ${on ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <span className="relative block w-full aspect-square rounded-lg overflow-hidden bg-slate-100">
                    {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-slate-300 absolute inset-0 m-auto" />}
                    {on && <em className="absolute right-1.5 top-1.5 w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center"><Check className="w-3.5 h-3.5" /></em>}
                  </span>
                  <span className="block text-[13px] text-slate-800 mt-2 leading-snug line-clamp-2 min-h-[34px]">{c.name}</span>
                  <span className="block text-[14px] font-bold text-slate-900 mt-0.5">{won(c.salePrice || c.price)}</span>
                  {c.exact && <span className="block text-[11.5px] font-semibold text-emerald-700 mt-0.5">상품명이 같아요</span>}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setProduct(term, { mode: 'manual', manual: { name: term, price: current.price ? current.price.toLocaleString() : '', image: null, ...(current.url ? { url: current.url } : {}) } })}
            className="mt-3 inline-flex items-center gap-1.5 h-9 px-1 text-[14px] font-semibold text-indigo-700 hover:text-indigo-900">
            <PencilLine className="w-4 h-4" />몰에 없는 상품이에요 · 직접 넣기
          </button>
        </div>
      );
      onNext = next;
      onSkip = () => { setProduct(term, { mode: 'skip' }); next(); };
      nextLabel = picked ? '이 상품으로 다음' : '고르지 않고 다음';
    } else {
      eyebrow = <Why tone="data">{res?.status === 'none' ? '우리 몰에서 찾지 못했어요' : '우리 몰 상품을 확인하지 못했어요'}</Why>;
      question = `「${term}」 상품도 넣을까요?`;
      reason = '사진과 가격을 넣으면 상품 카드로 실어요. 건너뛰면 한 줄 그대로 소개해요';
      body = (
        <button type="button" onClick={() => setProduct(term, { mode: 'manual', manual: { name: term, price: current.price ? current.price.toLocaleString() : '', image: null, ...(current.url ? { url: current.url } : {}) } })}
          className="w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center gap-2 text-[15px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors">
          <Plus className="w-5 h-5" />사진과 가격 직접 넣기
        </button>
      );
      onNext = () => { setProduct(term, { mode: 'skip' }); next(); };
      nextLabel = '넣지 않고 다음';
    }
  } else if (current !== MAKE && current.key === 'hero_photo') {
    eyebrow = <Why tone="customer">한 줄에는 사진이 없어요</Why>;
    question = '맨 위에 크게 보일 사진이 있나요?';
    reason = channel === 'email' ? '행사 사진이나 대표 상품 사진 한 장이면 돼요. 메일을 열면 가장 먼저 보여요' : '행사 사진이나 대표 상품 사진 한 장이면 돼요. 없으면 사진 없이 만들어요';
    body = <PhotoDrop channel={channel} size="hero" value={answers.hero} onChange={(url) => setA({ hero: url })} />;
    onNext = next;
    onSkip = () => { setA({ hero: null }); next(); };
    nextLabel = answers.hero ? '이 사진으로 다음' : '사진 없이 다음';
  } else if (current !== MAKE && current.key === 'link') {
    const dflt = plan.filled.link || plan.link_default?.url || null;
    eyebrow = <Why tone="customer">{dflt ? '버튼 주소를 바꿔요' : '연결할 주소가 없어요'}</Why>;
    question = '버튼을 누르면 어디로 갈까요?';
    reason = dflt ? `비우면 ${dflt} 로 가요` : '행사 페이지나 상품 주소를 넣어 주세요. 비우면 편집 화면에서 채워요';
    body = (
      <div>
        <div className="relative">
          <Link2 className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input ref={inputRef} inputMode="url" className={`w-full h-12 pl-11 pr-4 rounded-xl border bg-white text-[16px] text-slate-900 placeholder-slate-400 outline-none focus:ring-4 ${draft.err ? 'border-rose-400 focus:ring-rose-100' : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'}`}
            aria-labelledby="line-steps-q" aria-describedby="line-steps-why" maxLength={500} placeholder="예: myshop.co.kr/event" value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value, err: null })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); onNext(); } }} />
        </div>
        {draft.err && <p className="mt-2 text-[13px] text-rose-600" role="alert">{draft.err}</p>}
      </div>
    );
    onNext = () => {
      if (!draft.text.trim()) { setA({ link: null }); next(); return; }
      const u = normalizeLineLink(draft.text);
      if (!u) { setDraft({ ...draft, err: 'http로 시작하는 주소를 넣어 주세요' }); return; }
      setA({ link: u }); next();
    };
    onSkip = () => { setA({ link: null }); next(); };
    nextLabel = draft.text.trim() ? '다음' : dflt ? '그대로 두고 다음' : '비워 두고 다음';
  } else if (current !== MAKE && current.key === 'period') {
    const today = ymd(new Date());
    const maxDay = ymd(new Date(Date.now() + 399 * 86_400_000));
    eyebrow = <Why tone="customer">한 줄에 기간이 없어요</Why>;
    question = '행사는 언제까지인가요?';
    reason = '날짜를 주시면 마감 안내가 함께 실려요. 비우면 기간 없이 만들어요';
    body = (
      <div>
        <div className="flex flex-wrap gap-2 mb-3">
          {periodChips().map((c) => (
            <button key={c.value} type="button" aria-pressed={draft.text === c.value} onClick={() => setDraft({ ...draft, text: c.value })}
              className={`h-10 px-3.5 rounded-xl border text-[14px] font-semibold transition-colors ${draft.text === c.value ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{c.label}</button>
          ))}
        </div>
        <div className="relative">
          <CalendarDays className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input ref={inputRef} type="date" min={today} max={maxDay} className="w-full h-12 pl-11 pr-4 rounded-xl border border-slate-300 bg-white text-[16px] text-slate-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            aria-labelledby="line-steps-q" aria-describedby="line-steps-why" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        </div>
        {draft.text && <p className="mt-2 text-[14px] font-semibold text-violet-800">{periodLabel(draft.text)}</p>}
      </div>
    );
    const valid = !draft.text || (draft.text >= today && draft.text <= maxDay);
    nextDisabled = !valid;
    onNext = () => { setA({ period: draft.text || null }); next(); };
    onSkip = () => { setA({ period: null }); next(); };
    nextLabel = draft.text ? '다음' : '기간 없이 다음';
  }

  // ─── 만들기 단계 ───
  const products = lineStepsProducts(answers, channel, termOrder);
  const manual = lineStepsManual(answers, termOrder);
  const short = balance?.enabled && cost !== null && balance.total < cost;
  const make = () => {
    if (cost === null || short) return;
    onMake({ body: buildLineStepsBody(plan, answers, visible, cost), cost, storeKey, readLicensed: answers.readLicensed === true });
  };

  const stepOf = (key: string, item?: string) => visible.find((s) => s.key === key && (item === undefined || s.item === item));
  const later = (key: string, item?: string) => plan.later.some((l) => l.key === key && (item === undefined || l.item === item));
  const heroStep = allSteps.find((s) => s.key === 'hero_photo');
  const heroVisible = stepOf('hero_photo');
  const linkVisible = stepOf('link');
  const linkStep = allSteps.find((s) => s.key === 'link');
  const pendingOffers = plan.offers.filter((o) => !answers.offersAdded.includes(o.item));

  const makeBody = (
    <div className="space-y-4">
      {state.notice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13.5px] text-amber-900" role="alert">{state.notice}</div>}
      <ul className="rounded-2xl border border-slate-200 divide-y divide-slate-100 py-1">
        <Row label="한 줄" tone="customer">{state.line}</Row>
        {plan.steps.some((s) => s.key === 'benefit') && (
          <Row label="혜택" tone={answers.benefit ? 'customer' : 'empty'} onClick={stepOf('benefit') ? () => go(lineStepId(stepOf('benefit')!)) : undefined}>{answers.benefit || '혜택 없이 만들어요'}</Row>
        )}
        {termOrder.map((t) => {
          const a = answers.products[t];
          const st = stepOf('product', t);
          const pick = a?.mode === 'pick' && a.picked && products.some((p) => p.provider === a.picked!.provider && p.no === a.picked!.no) ? a.picked : null;
          const m = a?.mode === 'manual' && a.manual?.name.trim() ? a.manual : null;
          return (
            <Row key={t} label={`상품 · ${t}`} tone={pick ? 'data' : m ? 'customer' : 'empty'} onClick={st ? () => go(lineStepId(st)) : undefined}>
              {pick ? <>{pick.name} · {won(pick.salePrice || pick.price)} <span className="text-emerald-700 text-[12.5px] font-semibold">우리 몰</span></>
                : m ? <>{m.name}{lineManualPrice(m.price) ? ` · ${won(lineManualPrice(m.price)!)}` : ''}{m.image ? ' · 사진 있음' : ''}</>
                  : '넣지 않아요'}
            </Row>
          );
        })}
        {(answers.urlPicks || []).filter((c) => products.some((p) => p.provider === c.provider && p.no === c.no) && !termOrder.some((t) => { const a = answers.products[t]; return a?.mode === 'pick' && a.picked?.provider === c.provider && a.picked?.no === c.no; })).map((c) => (
          <Row key={`url:${c.provider}:${c.no}`} label="주소로 찾은 상품" tone="data"
            action={<button type="button" onClick={() => setA({ urlPicks: (answers.urlPicks || []).filter((x) => !(x.provider === c.provider && x.no === c.no)) })} className="shrink-0 h-9 px-3 mr-2 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">빼기</button>}>
            {c.name} · {won(c.salePrice || c.price)}
          </Row>
        ))}
        {plan.later.filter((l) => l.key === 'product').map((l) => <Row key={`later:${l.item}`} label={`상품 · ${l.item}`} tone="empty">만든 뒤 편집 화면에서 넣어요</Row>)}
        {(heroStep || later('hero_photo')) && (
          <Row label="대표 사진" tone={heroVisible && answers.hero ? 'customer' : heroStep && !heroVisible ? 'data' : 'empty'} onClick={heroVisible ? () => go(lineStepId(heroVisible)) : undefined}>
            {heroVisible && answers.hero ? <span className="inline-flex items-center gap-2"><img src={answers.hero} alt="" className="w-10 h-7 rounded object-cover border border-slate-200" />올린 사진</span>
              : heroStep && !heroVisible ? '상품 사진을 써요' : later('hero_photo') ? '만든 뒤 편집 화면에서 넣어요' : '사진 없이 만들어요'}
          </Row>
        )}
        {(() => {
          const changeBtn = !linkVisible && !(linkStep && !linkVisible) ? (
            <button type="button" onClick={() => { setLinkOpened(true); setCursor('link:'); }} className="shrink-0 h-9 px-3 mr-2 rounded-lg border border-slate-200 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">바꾸기</button>
          ) : undefined;
          if (answers.link) return <Row label="버튼 주소" tone="customer" onClick={linkVisible ? () => go(lineStepId(linkVisible)) : undefined} action={changeBtn}>{answers.link}</Row>;
          if (plan.filled.link) return <Row label="버튼 주소" tone="customer" action={changeBtn}>{plan.filled.link} <span className="text-violet-700 text-[12.5px] font-semibold">한 줄 주소</span></Row>;
          if (linkStep && !linkVisible) return <Row label="버튼 주소" tone="data">상품 링크로 가요</Row>;
          if (plan.link_default) return <Row label="버튼 주소" tone="data" action={changeBtn}>{plan.link_default.url} <span className="text-emerald-700 text-[12.5px] font-semibold">{plan.link_default.kind === 'website' ? '회사 홈페이지' : '우리 몰 첫 화면'}</span></Row>;
          return <Row label="버튼 주소" tone="empty" onClick={linkVisible ? () => go(lineStepId(linkVisible)) : undefined}>만든 뒤 편집 화면에서 넣어요</Row>;
        })()}
        {(stepOf('period') || later('period')) && (
          <Row label="기간" tone={answers.period && stepOf('period') ? 'customer' : 'empty'} onClick={stepOf('period') ? () => go(lineStepId(stepOf('period')!)) : undefined}>
            {answers.period && stepOf('period') ? periodLabel(answers.period) : later('period') ? '만든 뒤 편집 화면에서 넣어요' : '기간 없이 만들어요'}
          </Row>
        )}
        {pendingOffers.map((o) => (
          <Row key={`offer:${o.item}`} label={`상품 · ${o.item}`} tone="empty"
            action={<button type="button" disabled={manual.length >= 3} onClick={() => { setA({ offersAdded: [...answers.offersAdded, o.item] }); setCursor(`product:${o.item}`); }} className="shrink-0 h-9 px-3 mr-2 rounded-lg border border-violet-300 bg-violet-50 text-[13px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-40">넣기</button>}>
            {`「${o.item}」 상품도 넣을까요?`}
          </Row>
        ))}
      </ul>
      {state.reads.length > 0 && <LineReadToggle read={{ checked: answers.readLicensed === true, onChange: (v) => setA({ readLicensed: v }) }} />}
      <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[15px] font-bold text-slate-900"><Coins className="w-4 h-4 text-amber-600" />{cost === null ? '금액을 확인하지 못했어요' : `${cost}크레딧`}</span>
          {balance?.enabled && cost !== null && <span className="text-[13.5px] text-slate-600 tabular-nums">잔액 {balance.total.toLocaleString()} → <b className={short ? 'text-rose-600' : 'text-slate-900'}>{(balance.total - cost).toLocaleString()}</b></span>}
        </div>
        <p className="text-[12.5px] text-slate-500 mt-1 leading-relaxed">
          {cost !== null && generateCost !== null && cost <= generateCost ? `오늘 같은 한 줄로 만든 적이 있어 생성비 ${cost}크레딧만 받아요` : cost !== null && generateCost !== null ? `생성 ${generateCost} + 한 줄 완성 ${cost - generateCost} · 묻기 · 몰 찾기 · 사진 올리기는 무료` : '묻기 · 몰 찾기 · 사진 올리기는 무료예요'}
        </p>
        {short && <p className="text-[13px] font-semibold text-rose-600 mt-1.5">크레딧이 부족해요. 충전한 뒤 만들 수 있어요</p>}
      </div>
      <p className="text-[10px] text-slate-400 italic">Data source: 입력한 한 줄 · 답한 내용 · 우리 몰 상품(만들 때 몰에서 다시 확인) · 회사 설정</p>
    </div>
  );

  const names = [...visible, MAKE as typeof MAKE];
  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="line-steps-q" disableDismiss zIndexClassName="z-[1500]"
      panelClassName="w-full md:max-w-[540px] md:min-h-[580px] md:!max-h-[min(740px,calc(100dvh_-_3rem))]">
      {/* 머리 — 진행 막대(칸 = 단계 · 이름만 · 숫자 없음) · 한 줄 · 닫기 */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 shrink-0">
        <div className="flex items-start gap-3">
          {idx > 0 ? (
            <button type="button" onClick={prev} aria-label="이전 단계" className="-ml-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 shrink-0"><ChevronLeft className="w-5 h-5" /></button>
          ) : <span className="w-0" />}
          <ol className="flex-1 min-w-0 flex gap-1.5" aria-label="진행">
            {names.map((s, i) => {
              const done = i < idx;
              const now = i === idx;
              return (
                <li key={s === MAKE ? MAKE : lineStepId(s)} className="flex-1 min-w-0" aria-current={now ? 'step' : undefined}>
                  <span className={`block h-1.5 rounded-full ${now || done ? 'bg-indigo-600' : 'bg-slate-200'} ${done ? 'opacity-50' : ''}`} />
                  <span className={`block mt-1.5 text-[12px] truncate ${now ? 'font-bold text-indigo-700' : done ? 'text-slate-500' : 'text-slate-400'}`}>{stepName(s)}</span>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <p className="mt-3 text-[13px] text-slate-500 truncate"><span className="font-semibold text-violet-700 mr-1.5">한 줄</span>{state.line}</p>
      </div>

      {/* 본문 — 질문 하나 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        {current === MAKE ? (
          <>
            <h2 id="line-steps-q" ref={titleRef} tabIndex={-1} className="text-[20px] font-bold text-slate-900 leading-snug outline-none">이렇게 만들어요</h2>
            <p id="line-steps-why" className="text-[14px] text-slate-500 mt-1.5 mb-5 leading-relaxed">한 줄과 답으로 완성본을 만들어요. 줄을 누르면 고칠 수 있어요</p>
            {makeBody}
          </>
        ) : (
          <>
            {eyebrow && <div className="mb-3">{eyebrow}</div>}
            <h2 id="line-steps-q" ref={titleRef} tabIndex={-1} className="text-[20px] font-bold text-slate-900 leading-snug outline-none">{question}</h2>
            <p id="line-steps-why" className="text-[14px] text-slate-500 mt-1.5 mb-5 leading-relaxed">{reason}</p>
            {body}
          </>
        )}
      </div>

      {/* 바닥 — 버튼 둘 */}
      <div className="px-6 py-4 border-t border-slate-100 flex gap-2.5 shrink-0">
        {current === MAKE ? (
          <>
            <button type="button" onClick={idx > 0 ? prev : onClose} className="h-12 px-5 rounded-xl border border-slate-200 bg-white text-[15px] font-semibold text-slate-700 hover:bg-slate-50">{idx > 0 ? '이전' : '취소'}</button>
            <button type="button" onClick={make} disabled={cost === null || !!short} className="flex-1 h-12 rounded-xl bg-amber-500 hover:bg-amber-400 text-[16px] font-bold text-slate-900 inline-flex items-center justify-center gap-2 disabled:opacity-40">
              <Gift className="w-5 h-5" />만들기{cost !== null ? ` · ${cost}크레딧` : ''}
            </button>
          </>
        ) : (
          <>
            {onSkip ? <button type="button" onClick={onSkip} className="h-12 px-5 rounded-xl border border-slate-200 bg-white text-[15px] font-semibold text-slate-600 hover:bg-slate-50">건너뛰기</button> : null}
            <button type="button" onClick={onNext} disabled={nextDisabled} className="flex-1 h-12 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-[16px] font-bold text-white disabled:opacity-40">{nextLabel}</button>
          </>
        )}
      </div>
    </JourneyModalShell>
  );
}

/** 만들기 실패 응답 → 다시 열 때 위에 보일 한 줄(서버 문장 우선) */
export function lineStepsFailNotice(code: string, error: string, excluded?: Array<{ name: string | null; reason: string }>): string {
  if (code === 'MALL_PRODUCTS_UNAVAILABLE') {
    const reasons = (excluded || []).map((e) => `${e.name ? `${e.name}: ` : ''}${e.reason}`).slice(0, 3).join(' · ');
    return `고른 몰 상품을 지금 쓸 수 없어 뺐어요${reasons ? `(${reasons})` : ''}. 크레딧은 쓰지 않았어요`;
  }
  if (code === 'PRICE_CHANGED') return `${error || '금액이 바뀌었어요.'} 크레딧은 쓰지 않았어요`;
  if (code === 'INSUFFICIENT_CREDIT') return '크레딧이 부족해 만들지 못했어요. 충전한 뒤 다시 만들어 주세요';
  return `${error || '만들지 못했어요.'} 답은 그대로 남아 있어요`;
}

