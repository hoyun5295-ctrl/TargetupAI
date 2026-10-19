/**
 * LineStepsModal.tsx — 한 줄 → 단계별 모달(질문 · 재료) → 만들기 (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §3-15 · §5)
 *
 * "한 줄에 없는 사실과 재료만, 한 단계에 하나씩 여쭙니다."
 *   - 무엇을 물을지 = 서버 단계 목록(plan) 그대로 · 화면은 닫힌 키의 문구만 소유 · 건너뜀 조건은 서버가 실어 보낸 이름 하나만 해석.
 *   - 한 단계 = 단계 이름(막대) · 질문 · 이유 · 입력 하나 · 바닥 버튼 2개. 색 = 남색 지금 · 보라 고객이 준 것 · 초록 우리 데이터 · 회색 비움 · 앰버 유료 버튼만.
 *   - 마지막 「만들기」 단계가 금액 확인을 겸한다(줄을 누르면 그 단계로 · 잔액 부족 = 잠금).
 *   - 답은 sessionStorage 에 바로 남는다(닫았다 다시 열어도 이어서 · 성공했을 때만 호출부가 지운다 · 다른 날 답은 버린다).
 * ★ 2026-10-17 템플릿 캠페인(설계서 docs/2026-10-17-line-template-campaign-design.md §2-6 · §2-7) — `state.templates` 가 오면
 *   고르기 판(추천 템플릿 예시 · 배치 · 템플릿 줄) → 재료 판(고른 템플릿의 단계 + 예시) 두 판. 템플릿을 바꿔도 답은 그대로.
 * ⛔ 바깥 눌러 닫힘 없음 · 모델명 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, ChevronLeft, Camera, Check, Loader2, Gift, Link2, CalendarDays, ImageIcon, PencilLine, Plus, Coins, ShoppingBag, Search, Globe, LayoutTemplate, Eye } from 'lucide-react';
import JourneyModalShell from '../journey/JourneyModalShell';
import ZoneSegmented from './ZoneSegmented';
import LineTemplatePick, { LineTemplateExampleView } from './LineTemplatePick';
import { useBodyFlag } from '../../lib/surface-flags';
import { useAuthStore } from '../../stores/authStore';
import { LineReadToggle } from './LineFacts';
import {
  type LineStepsPlan, type LineStep, type LineStepsAnswers, type LineManualAnswer, type LineCandidatesResult, type LineMallCandidate, type LineStepsChannel,
  type LineTemplateRank, type LineTemplateInfo, type LineTemplateId, type LineLayout,
  emptyLineStepsAnswers, lineStepId, lineStepsProducts, lineStepsManual, lineStepSkipped, lineStepTerms, lineManualPrice, normalizeLineLink,
  buildLineStepsBody, fetchLineCandidates, uploadLineImage, lineStepsStoreKey, loadLineStepsAnswers, saveLineStepsAnswers, LINE_UPLOAD_MAX_MB,
  fetchLineTemplates, readLinePage, searchLineMall, buildLineTemplateBody, lineTemplateCount,
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
  /** ★ 템플릿 캠페인(서버 판정 · 템플릿 스위치 켠 회사만) — 한 줄 추천 · 템플릿마다 재료 단계 */
  templates?: { ranks: LineTemplateRank[] | null; plans: Record<string, LineStepsPlan> } | null;
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
/** 입력칸 — 휴대폰 16px(확대 방지) · 마우스 화면 14px */
const INPUT = 'w-full h-11 rounded-xl border bg-white text-[16px] [@media(pointer:fine)]:text-[14px] text-slate-900 placeholder-slate-400 outline-none focus:ring-4';
const INPUT_OK = 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100';
const INPUT_BAD = 'border-rose-400 focus:ring-rose-100';
const TEMPLATE_ORDER: readonly LineTemplateId[] = ['big-sale', 'new-launch', 'special-event', 'season'];

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
  // 올해가 아니면 연도까지(제안 칩이 내년 날짜일 때 알아보게)
  return `${y !== new Date().getFullYear() ? `${y}년 ` : ''}${m}월 ${d}일(${WEEK[new Date(y, m - 1, d).getDay()]})까지`;
}

function stepName(s: LineStep | typeof MAKE): string {
  if (s === MAKE) return '만들기';
  if (s.key === 'benefit') return '혜택';
  if (s.key === 'product') return s.item || '상품';
  if (s.key === 'products') return '상품';
  if (s.key === 'event_page') return '이벤트 페이지';
  if (s.key === 'hero_photo') return '대표 사진';
  if (s.key === 'link') return '버튼 주소';
  return '기간';
}

/** 출처 표시(왜 묻는가) — 보라 = 한 줄 · 고객 · 초록 = 우리 데이터 */
function Why({ tone, children }: { tone: 'customer' | 'data'; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-semibold ${tone === 'data' ? 'bg-emerald-50 text-emerald-800' : 'bg-violet-50 text-violet-800'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${tone === 'data' ? 'bg-emerald-500' : 'bg-violet-500'}`} />{children}
    </span>
  );
}

/**
 * 사진 칸(누르거나 끌어 놓기) — 올리는 중 · 실패 문장을 칸 안에서 보인다.
 * ★ 1017 실측 지적 — 작은 칸에 글자 버튼 둘(바꾸기 · 빼기)이 꺾였다 → 작은 칸 = 칸 전체가 바꾸기(카메라 배지) + 늘 보이는 28px 빼기 아이콘.
 */
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
  const box = size === 'hero' ? 'w-full aspect-[16/9] rounded-2xl' : 'w-[96px] h-[96px] rounded-xl shrink-0';
  return (
    <div className={size === 'hero' ? 'w-full' : ''}>
      <input ref={ref} type="file" accept={channel === 'inapp' ? 'image/png,image/jpeg,image/gif,image/webp' : 'image/png,image/jpeg,image/webp'} className="hidden" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      {value ? (
        size === 'hero' ? (
          <div className={`relative ${box} overflow-hidden bg-slate-100 border border-slate-200`}>
            <img src={value} alt="올린 사진" className="w-full h-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex gap-1.5 p-2 bg-gradient-to-t from-black/50 to-transparent">
              <button type="button" onClick={() => ref.current?.click()} className="h-8 px-3 rounded-lg bg-white/95 text-[12.5px] font-semibold text-slate-800 hover:bg-white whitespace-nowrap">바꾸기</button>
              <button type="button" onClick={() => onChange(null)} className="h-8 px-3 rounded-lg bg-white/95 text-[12.5px] font-semibold text-slate-800 hover:bg-white whitespace-nowrap">빼기</button>
            </div>
          </div>
        ) : (
          <div className={`relative ${box}`}>
            <button type="button" onClick={() => ref.current?.click()} aria-label="사진 바꾸기" className="block w-full h-full overflow-hidden rounded-xl bg-slate-100 border border-slate-200">
              <img src={value} alt="올린 사진" className="w-full h-full object-cover" />
              <span className="absolute left-1.5 bottom-1.5 w-6 h-6 rounded-full bg-black/55 text-white flex items-center justify-center"><Camera className="w-3.5 h-3.5" /></span>
            </button>
            <button type="button" onClick={() => onChange(null)} aria-label="사진 빼기" className="absolute -right-2 -top-2 w-7 h-7 rounded-full bg-white border border-slate-300 shadow text-slate-600 hover:text-rose-600 flex items-center justify-center"><X className="w-4 h-4" /></button>
          </div>
        )
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => ref.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void take(e.dataTransfer.files?.[0]); }}
          className={`${box} flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-indigo-400 hover:bg-indigo-50/40 hover:text-indigo-700 transition-colors`}
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className={size === 'hero' ? 'w-6 h-6' : 'w-5 h-5'} />}
          <span className={size === 'hero' ? 'text-[14px] font-semibold' : 'text-[12px] font-semibold whitespace-nowrap'}>{busy ? '올리는 중' : '사진 올리기'}</span>
          {size === 'hero' && !busy && <span className="text-[12px] text-slate-400">눌러서 고르거나 끌어다 놓기 · {LINE_UPLOAD_MAX_MB[channel]}MB까지</span>}
        </button>
      )}
      {err && <p className="mt-2 text-[12.5px] text-rose-600" role="alert">{err}</p>}
    </div>
  );
}

/** 만들기 단계 한 줄 — 이름 · 점(보라 고객 · 초록 우리 데이터 · 회색 비움) · 값 · 오른쪽 버튼(선택) */
function Row({ label, children, tone, onClick, action }: { label: string; children: ReactNode; tone: 'customer' | 'data' | 'empty'; onClick?: () => void; action?: ReactNode }) {
  const dot = tone === 'customer' ? 'bg-violet-500' : tone === 'data' ? 'bg-emerald-500' : 'bg-slate-300';
  const inner = (
    <>
      <span className="w-[84px] shrink-0 text-[12px] font-semibold text-slate-500 pt-px truncate">{label}</span>
      <span className={`flex-1 min-w-0 flex items-start gap-2 text-[13.5px] ${tone === 'empty' ? 'text-slate-400' : 'text-slate-900'}`}>
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

/** 몰 후보 한 칸(누르면 담기 · 다시 누르면 빼기) */
function CandTile({ c, on, onToggle, disabled }: { c: LineMallCandidate; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled && !on} onClick={onToggle}
      className={`text-left rounded-xl p-2 border-2 transition-colors disabled:opacity-40 ${on ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      <span className="relative block w-full aspect-square rounded-lg overflow-hidden bg-slate-100">
        {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-6 h-6 text-slate-300 absolute inset-0 m-auto" />}
        {on && <em className="absolute right-1.5 top-1.5 w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center"><Check className="w-3.5 h-3.5" /></em>}
      </span>
      <span className="block text-[12.5px] text-slate-800 mt-1.5 leading-snug line-clamp-2 min-h-[32px]">{c.name}</span>
      <span className="block text-[13px] font-bold text-slate-900 mt-0.5">{won(c.salePrice || c.price)}</span>
    </button>
  );
}

const candKey = (c: Pick<LineMallCandidate, 'provider' | 'no'>) => `${c.provider}:${c.no}`;

export default function LineStepsModal({ open, channel, state, onClose, onMake }: {
  open: boolean;
  channel: LineStepsChannel;
  state: LineStepsOpen | null;
  onClose: () => void;
  onMake: (made: LineStepsMade) => void;
}) {
  useBodyFlag('data-interrupt-open', open);
  const user = useAuthStore((s) => s.user);
  const tplOffer = state?.templates ?? null;
  const tplMode = !!tplOffer;
  // 보존 키 · 몰 여부는 한 줄 기준(템플릿마다 단계는 달라도 한 줄 지문 · 회사 사실은 같다)
  const basePlan = state?.plan ?? (tplOffer ? Object.values(tplOffer.plans)[0] ?? null : null);
  const storeKey = basePlan ? lineStepsStoreKey(user?.company?.id || '-', user?.id || '-', channel, basePlan.line_fp) : '';

  const [answers, setAnswers] = useState<LineStepsAnswers>(emptyLineStepsAnswers);
  const [cursor, setCursor] = useState<string>(MAKE);
  const [linkOpened, setLinkOpened] = useState(false);
  const [cands, setCands] = useState<LineCandidatesResult | 'loading' | 'failed'>('loading');
  const [balance, setBalance] = useState<{ total: number; enabled: boolean } | null>(null);
  // 복원을 마친 보존 키(복원 전 렌더의 옛 답을 새 키에 쓰지 않게)
  const [restored, setRestored] = useState('');
  // 지금 단계의 입력 초안(다음을 누를 때 답이 된다)
  const [draft, setDraft] = useState<{ text: string; manual: LineManualAnswer | null; err: string | null }>({ text: '', manual: null, err: null });
  // ★ 템플릿 — 목록 · 판(고르기 / 재료) · 재료 판 예시 접기(휴대폰)
  const [tplList, setTplList] = useState<LineTemplateInfo[] | null>(null);
  const [pane, setPane] = useState<'pick' | 'steps'>('pick');
  const [showExample, setShowExample] = useState(false);
  // ★ 템플릿 상품 단계 — 탭(낱말 · 찾기) · 더 보기 결과 · 찾기 · 직접 넣기 칸(고치는 중이면 그 순번)
  const [prodTab, setProdTab] = useState<string>('');
  const [more, setMore] = useState<Record<string, LineMallCandidate[] | 'loading'>>({});
  const [search, setSearch] = useState<{ q: string; res: LineMallCandidate[] | 'loading' | null }>({ q: '', res: null });
  const [manualEdit, setManualEdit] = useState<{ at: number | null; m: LineManualAnswer } | null>(null);
  // ★ 템플릿 이벤트 페이지 단계 — 읽는 중 · 실패 문장
  const [pageBusy, setPageBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const firstFocus = useRef(true);
  // 기다린 뒤 이어 가는 동작(페이지 읽기 → 다음)이 그 사이 바뀐 단계 · 템플릿 · 판에서 움직이지 않게 지금 값을 비춘다
  const liveRef = useRef<{ cursor: string; tpl: string | null; pane: string }>({ cursor: '', tpl: null, pane: '' });
  const pageReq = useRef(0);
  const autoRead = useRef('');

  // 고른 템플릿 = 답 → 추천 → 목록 첫 것 · 그 템플릿의 단계 목록이 이 모달의 plan
  const chosenId: LineTemplateId | null = tplOffer
    ? (answers.template?.id && tplOffer.plans[answers.template.id] ? answers.template.id
      : tplOffer.ranks?.find((r) => r.recommended && tplOffer.plans[r.id])?.id
        ?? TEMPLATE_ORDER.find((id) => tplOffer.plans[id]) ?? null)
    : null;
  const layout: LineLayout = channel === 'dm' ? (answers.template?.layout ?? 'slides') : 'page';
  const plan: LineStepsPlan | null = tplOffer ? (chosenId ? tplOffer.plans[chosenId] ?? null : null) : (state?.plan ?? null);
  const tplInfo = tplList?.find((t) => t.id === chosenId) ?? null;

  // 열 때: 보존한 답 복원 → 시작 단계 → 몰 후보 한 번
  useEffect(() => {
    if (!open || !basePlan) return;
    const saved = loadLineStepsAnswers(storeKey);
    let a = saved?.answers ?? emptyLineStepsAnswers();
    if (state?.dropPicks) {
      const products: LineStepsAnswers['products'] = {};
      for (const [k, v] of Object.entries(a.products)) products[k] = v.mode === 'pick' ? { mode: 'skip' } : v;
      a = { ...a, products, urlPicks: [], picks: [] };
    }
    setAnswers(a);
    setRestored(storeKey);
    setLinkOpened(false);
    setBalance(null);
    setShowExample(false);
    setMore({});
    setSearch({ q: '', res: null });
    setManualEdit(null);
    autoRead.current = '';
    firstFocus.current = true;
    if (tplOffer) {
      setPane(state?.atMake ? 'steps' : 'pick');
      setCursor(MAKE);
      void fetchLineTemplates().then((list) => setTplList(list ? [...list].sort((x, y) => TEMPLATE_ORDER.indexOf(x.id) - TEMPLATE_ORDER.indexOf(y.id)) : []));
    } else {
      const first = basePlan.steps.find((s) => !lineStepSkipped(s, a, channel, lineStepTerms(basePlan, a)));
      setCursor(state?.atMake || !first ? MAKE : lineStepId(first));
    }
    // 몰이 없으면 후보를 부르지 않는다(상품 단계 = 직접 넣기 · 주소로 찾을 몰도 없다)
    if (!basePlan.mall) { setCands({ byTerm: {}, byUrl: [] }); return; }
    setCands('loading');
    const ctrl = new AbortController();
    void fetchLineCandidates(state?.line || '', channel, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setCands(r ?? 'failed');
      // H5 — 한 줄 속 우리 몰 주소로 찾은 상품은 미리 담는다(처음 한 번만 · 빼기 가능) · 템플릿 = 담은 상품 목록에
      if (r && r.byUrl.length > 0) {
        setAnswers((prev) => {
          if (state?.dropPicks) return prev;
          if (tplOffer) return prev.picks === undefined ? { ...prev, picks: channel === 'inapp' ? r.byUrl.slice(0, 1) : r.byUrl } : prev;
          return prev.urlPicks === undefined ? { ...prev, urlPicks: channel === 'inapp' ? r.byUrl.slice(0, 1) : r.byUrl } : prev;
        });
      }
    });
    return () => ctrl.abort();
    // 여는 사건에만 반응한다(답 · 커서는 안에서 바뀐다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeKey]);

  // 답이 바뀌면 바로 남긴다
  useEffect(() => { if (open && basePlan && restored === storeKey) saveLineStepsAnswers(storeKey, answers, new Date().toISOString()); }, [answers, open, basePlan, storeKey, restored]);

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
    } else if (current !== MAKE && current.key === 'event_page') {
      setDraft({ text: answers.page?.url ?? current.url ?? '', manual: null, err: null });
    } else if (current !== MAKE && current.key === 'products') {
      setDraft({ text: '', manual: null, err: null });
      setProdTab((t) => t || current.terms?.[0]?.item || (basePlan?.mall ? '__search' : ''));
      setManualEdit(null);
    } else if (current !== MAKE) {
      const v = current.key === 'benefit' ? answers.benefit : current.key === 'link' ? answers.link : current.key === 'period' ? answers.period : null;
      // ★ 템플릿 — 한 줄에서 찾은 값은 칸에 넣지 않는다(제안 칩을 눌러야 채워진다 · Codex 5R)
      setDraft({ text: typeof v === 'string' ? v : '', manual: null, err: null });
    }
    if (firstFocus.current) { firstFocus.current = false; return; }   // 처음 = 껍데기가 첫 입력칸을 잡는다
    requestAnimationFrame(() => (inputRef.current ?? titleRef.current)?.focus());
    // 커서가 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, open, pane]);

  // 만들기 단계에서 잔액 한 번
  useEffect(() => {
    if (!open || current !== MAKE || balance || (tplMode && pane === 'pick')) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/companies/my-credit', { headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` } });
        const d = await res.json().catch(() => null);
        if (alive && res.ok && d && d.success !== false) setBalance({ total: Number(d.total) || 0, enabled: d.creditEnabled !== false });
      } catch { /* 잔액 줄만 못 보인다 */ }
    })();
    return () => { alive = false; };
  }, [open, current, balance, tplMode, pane]);

  const setA = (patch: Partial<LineStepsAnswers>) => setAnswers((a) => ({ ...a, ...patch }));
  const setProduct = (term: string, v: LineStepsAnswers['products'][string]) => setAnswers((a) => ({ ...a, products: { ...a.products, [term]: v } }));
  /** 이벤트 페이지 읽기(성공 = 답에 넣는다 · 실패 = 칸 아래 서버 문장) */
  /** 페이지 읽기 — 요청 번호가 그대로일 때만 답에 넣는다(읽는 사이 건너뛰거나 다시 읽으면 늦게 온 응답을 버린다 · Codex 7R) */
  const doReadPage = async (raw: string): Promise<boolean> => {
    const ticket = ++pageReq.current;
    setPageBusy(true);
    setDraft((d) => ({ ...d, err: null }));
    try {
      const page = await readLinePage(raw);
      if (ticket !== pageReq.current) return false;
      setA({ page });
      return true;
    } catch (e: any) {
      if (ticket === pageReq.current) setDraft((d) => ({ ...d, err: e?.message || '페이지를 읽지 못했어요' }));
      return false;
    } finally {
      if (ticket === pageReq.current) setPageBusy(false);
    }
  };
  /** 페이지 없이 — 읽는 중이던 요청도 무효(늦게 와도 넣지 않는다) */
  const dropPage = () => { pageReq.current++; setPageBusy(false); setA({ page: null }); };

  // 이벤트 페이지 단계 — 한 줄에 친 주소는 열자마자 읽는다(한 번만 · 재료 판에서만)
  useEffect(() => {
    if (!open || (tplMode && pane !== 'steps') || current === MAKE || current.key !== 'event_page' || !current.url || answers.page !== undefined || pageBusy) return;
    if (autoRead.current === current.url) return;
    autoRead.current = current.url;
    void doReadPage(current.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cursor, pane]);

  liveRef.current = { cursor, tpl: chosenId, pane };
  if (!open || !state || !basePlan) return null;
  if (tplMode && !plan) return null;

  // ─── 템플릿 고르기 판 ───
  const confirmTemplate = () => {
    if (!chosenId || !tplOffer) return;
    const p = tplOffer.plans[chosenId];
    setA({ template: { id: chosenId, layout } });
    setPane('steps');
    const first = p?.steps.find((s) => !lineStepSkipped(s, answers, channel, lineStepTerms(p, answers)));
    setCursor(first ? lineStepId(first) : MAKE);
  };

  if (tplMode && pane === 'pick') {
    return (
      <JourneyModalShell open={open} onClose={onClose} labelledBy="line-tpl-q" disableDismiss zIndexClassName="z-[1500]"
        panelClassName="w-full md:w-[min(1040px,calc(100vw-3rem))] md:max-w-none !max-h-[100dvh] md:!max-h-[min(860px,calc(100dvh-3rem))]">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 shrink-0 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 id="line-tpl-q" className="text-[16px] font-bold text-slate-900">어떤 모양으로 만들까요?</h2>
            <p className="mt-0.5 text-[12.5px] text-slate-500 truncate"><span className="font-semibold text-violet-700 mr-1.5">한 줄</span>{state.line}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          {tplList === null ? (
            <div className="h-64 flex items-center justify-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>
          ) : tplList.length === 0 || !chosenId ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-center">
              <p className="text-[14px] text-slate-600">템플릿을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요</p>
              <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl border border-slate-200 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">닫기</button>
            </div>
          ) : (
            <LineTemplatePick list={tplList.filter((t) => tplOffer!.plans[t.id])} ranks={tplOffer!.ranks} chosen={chosenId} layout={layout} channel={channel}
              onChoose={(id) => setA({ template: { id, layout } })}
              onLayout={(l) => setA({ template: { id: chosenId, layout: l } })}
              onConfirm={confirmTemplate} />
          )}
        </div>
      </JourneyModalShell>
    );
  }

  const cost = state.costOverride ?? plan!.cost?.total ?? state.fallbackCost;
  const generateCost = plan!.cost?.generate ?? null;
  const go = (id: string) => setCursor(id);
  const next = () => { const n = visible[idx + 1]; setCursor(n ? lineStepId(n) : MAKE); };
  const prev = () => { const p = visible[idx - 1]; if (p) setCursor(lineStepId(p)); };

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
    const required = current.required === true;
    const pageCards = answers.page?.cards ?? [];
    eyebrow = <Why tone="customer">{required ? '이 템플릿은 혜택을 표지에 크게 실어요' : '혜택이 있으면 크게 실어요'}</Why>;
    question = '어떤 혜택을 드리나요?';
    reason = '적은 그대로 크게 실려요. 조건이 있으면 함께 적어 주세요(예: 5만원 이상 구매 시 무료배송)';
    body = (
      <div>
        {current.suggest && (
          <div className="mb-3">
            <span className="block text-[12px] font-semibold text-slate-500 mb-1.5">한 줄에서 찾았어요 · 맞으면 눌러 주세요</span>
            <button type="button" aria-pressed={draft.text === current.suggest} onClick={() => setDraft({ ...draft, text: current.suggest! })}
              className={`h-9 px-3 rounded-xl border text-[13px] font-semibold whitespace-nowrap ${draft.text === current.suggest ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{current.suggest}</button>
          </div>
        )}
        <input ref={inputRef} className={`${INPUT} ${INPUT_OK} px-4`}
          aria-labelledby="line-steps-q" aria-describedby="line-steps-why" maxLength={300} placeholder="예: 전 상품 20% · 첫 구매 5천원 쿠폰" value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e) && (!required || draft.text.trim())) { e.preventDefault(); onNext(); } }} />
        {pageCards.length > 0 && (
          <div className="mt-3">
            <span className="block text-[12px] font-semibold text-slate-500 mb-1.5">페이지에서 읽은 문구로 채우기</span>
            <div className="flex flex-wrap gap-1.5">
              {pageCards.filter((c) => c.title).map((c) => (
                <button key={c.hash} type="button" onClick={() => setDraft({ ...draft, text: c.title.slice(0, 300) })}
                  className="h-8 px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-[12.5px] font-semibold text-emerald-800 hover:bg-emerald-100 max-w-full truncate">{c.title}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
    onNext = () => { const t = draft.text.trim(); setA({ benefit: t ? t : null }); next(); };
    onSkip = required ? null : () => { setA({ benefit: null }); next(); };
    nextDisabled = required && !draft.text.trim();
    nextLabel = draft.text.trim() || required ? '다음' : '혜택 없이 다음';
  } else if (current !== MAKE && current.key === 'event_page') {
    const pg = answers.page ?? null;
    eyebrow = <Why tone="customer">{current.url ? '한 줄에 적은 주소를 읽었어요' : '없어도 만들 수 있어요'}</Why>;
    question = '이벤트 페이지가 있나요?';
    reason = '주소를 넣으면 페이지를 읽어 표지 사진과 문구를 가져와요. 숫자가 든 문구는 켠 것만 그대로 실어요';
    const toggle = (h: string) => pg && setA({ page: { ...pg, licensed: pg.licensed.includes(h) ? pg.licensed.filter((x) => x !== h) : [...pg.licensed, h].slice(0, 3) } });
    body = (
      <div>
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Globe className="w-[18px] h-[18px] text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input ref={inputRef} inputMode="url" className={`${INPUT} ${draft.err ? INPUT_BAD : INPUT_OK} pl-10 pr-3`}
              aria-labelledby="line-steps-q" aria-describedby="line-steps-why" maxLength={500} placeholder="예: myshop.co.kr/event/autumn" value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value, err: null })}
              onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e) && draft.text.trim()) { e.preventDefault(); void doReadPage(draft.text); } }} />
          </div>
          <button type="button" disabled={!draft.text.trim() || pageBusy} onClick={() => void doReadPage(draft.text)}
            className="h-11 px-4 rounded-xl bg-slate-900 text-white text-[13.5px] font-semibold disabled:opacity-40 inline-flex items-center gap-1.5 whitespace-nowrap">
            {pageBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}{pageBusy ? '읽는 중' : '읽기'}
          </button>
        </div>
        {draft.err && <p className="mt-2 text-[12.5px] text-rose-600" role="alert">{draft.err} · 건너뛰고 계속해도 돼요</p>}
        {pg && (
          <div className="mt-4 rounded-2xl border border-slate-200 p-3.5">
            <div className="flex items-center gap-3">
              {pg.banner ? <img src={pg.banner} alt="" className="w-20 h-14 rounded-lg object-cover border border-slate-200 shrink-0" /> : <span className="w-20 h-14 rounded-lg bg-slate-100 flex items-center justify-center shrink-0"><ImageIcon className="w-5 h-5 text-slate-300" /></span>}
              <div className="min-w-0">
                <span className="block text-[13px] font-semibold text-slate-900 truncate">{pg.host || pg.url}</span>
                <span className="block text-[12px] text-slate-500">{pg.banner ? '이 사진을 표지로 써요' : '표지로 쓸 만큼 큰 사진은 없었어요'}</span>
              </div>
            </div>
            {pg.cards.length > 0 && (
              <ul className="mt-3 space-y-2">
                {pg.cards.map((c) => {
                  const on = pg.licensed.includes(c.hash);
                  return (
                    <li key={c.hash}>
                      <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer ${on ? 'border-violet-400 bg-violet-50/60' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(c.hash)} className="mt-0.5 w-4 h-4 accent-violet-600 shrink-0" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-slate-900 line-clamp-1">{c.title || '페이지 문구'}</span>
                          <span className="block text-[12px] text-slate-500 line-clamp-2 whitespace-pre-line">{c.text}</span>
                          <span className="block mt-0.5 text-[11.5px] font-semibold text-violet-700">{on ? '이 문구 그대로 쓰기 켬' : '이 문구 그대로 쓰기'}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    );
    onNext = async () => {
      const typed = draft.text.trim();
      if (typed && (!pg || normalizeLineLink(typed) !== pg.url)) {
        const at = { cursor, tpl: chosenId, pane };
        const ok = await doReadPage(typed);
        // 읽는 사이 템플릿 · 단계 · 판이 바뀌었으면 옛 순서로 넘기지 않는다(필수 단계를 건너뛰던 경합 · Codex 6R)
        const now = liveRef.current;
        if (ok && now.cursor === at.cursor && now.tpl === at.tpl && now.pane === at.pane) next();
        return;
      }
      if (!typed) dropPage();
      next();
    };
    onSkip = () => { dropPage(); next(); };
    nextDisabled = pageBusy;
    nextLabel = pg || draft.text.trim() ? '다음' : '페이지 없이 다음';
  } else if (current !== MAKE && current.key === 'products') {
    const max = current.max ?? 1;
    const min = current.min ?? 0;
    const picks = answers.picks || [];
    const manualList = answers.manualList || [];
    const count = lineTemplateCount(answers);
    const full = count >= max;
    const terms = current.terms || [];
    const onTerm = terms.find((t) => t.item === prodTab) ?? null;
    const isPicked = (c: LineMallCandidate) => picks.some((p) => candKey(p) === candKey(c));
    const togglePick = (c: LineMallCandidate) => {
      if (isPicked(c)) { setA({ picks: picks.filter((p) => candKey(p) !== candKey(c)) }); return; }
      if (max === 1) { setA({ picks: [c], manualList: [] }); return; }   // 인앱 = 하나(새로 고르면 바꿈)
      if (!full) setA({ picks: [...picks, c] });
    };
    const termRes = cands !== 'loading' && cands !== 'failed' && onTerm ? cands.byTerm[onTerm.item] : null;
    const moreRes = onTerm ? more[onTerm.item] : undefined;
    const shown: LineMallCandidate[] | 'loading' | null = !basePlan.mall ? null
      : prodTab === '__search' ? search.res
        : moreRes ?? (cands === 'loading' ? 'loading' : termRes?.candidates ?? []);
    const startManual = (at: number | null) => {
      const base = at !== null ? manualList[at] : { name: onTerm?.item ?? '', price: onTerm?.price ? onTerm.price.toLocaleString() : '', image: null, ...(onTerm?.url ? { url: onTerm.url } : {}) };
      setManualEdit({ at, m: { ...base } });
    };
    const saveManual = () => {
      if (!manualEdit) return;
      const u = manualEdit.m.url ? normalizeLineLink(manualEdit.m.url) : null;
      const { url: _drop, ...rest } = manualEdit.m;
      const m: LineManualAnswer = { ...rest, name: manualEdit.m.name.trim(), ...(u ? { url: u } : {}) };
      if (!m.name) return;
      const list = [...manualList];
      if (manualEdit.at !== null) list[manualEdit.at] = m;
      else if (max === 1) { setA({ picks: [], manualList: [m] }); setManualEdit(null); return; }
      else if (full) return;   // 칸을 연 사이 몰 상품으로 상한이 찼다(담기 버튼도 잠긴다)
      else list.push(m);
      setA({ manualList: list });
      setManualEdit(null);
    };
    eyebrow = <Why tone={basePlan.mall ? 'data' : 'customer'}>{basePlan.mall ? '우리 몰 상품에서 골라요' : '상품을 직접 넣어요'}</Why>;
    question = max === 1 ? '어떤 상품을 보여 줄까요?' : '어떤 상품을 담을까요?';
    reason = max === 1 ? '팝업에는 상품 하나가 들어가요' : `여러 개 담을 수 있어요. 템플릿이 담은 수에 맞춰 배치해요(최대 ${max}개)`;
    const editing = manualEdit;
    const priceBad = !!editing && !!editing.m.price.trim() && lineManualPrice(editing.m.price) === null;
    const linkBad = !!editing && !!editing.m.url && !normalizeLineLink(editing.m.url);
    body = (
      <div className="space-y-4">
        {basePlan.mall && (
          <div className="space-y-3">
            <ZoneSegmented<string> ariaLabel="상품 찾기" value={prodTab || '__search'} onChange={(id) => setProdTab(id)}
              items={[...terms.map((t) => ({ id: t.item, label: t.item })), { id: '__search', label: '찾기', icon: Search }]} />
            {prodTab === '__search' && (
              <div className="flex gap-2">
                <input className={`${INPUT} ${INPUT_OK} px-3.5`} placeholder="상품 이름으로 찾기" value={search.q} maxLength={40}
                  onChange={(e) => setSearch({ ...search, q: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e) && search.q.trim()) { e.preventDefault(); setSearch({ ...search, res: 'loading' }); void searchLineMall(search.q).then((r) => setSearch((s) => ({ ...s, res: r.candidates }))); } }} />
                <button type="button" disabled={!search.q.trim() || search.res === 'loading'} onClick={() => { setSearch({ ...search, res: 'loading' }); void searchLineMall(search.q).then((r) => setSearch((s) => ({ ...s, res: r.candidates }))); }}
                  className="h-11 px-4 rounded-xl bg-slate-900 text-white text-[13.5px] font-semibold disabled:opacity-40 whitespace-nowrap">찾기</button>
              </div>
            )}
            {shown === 'loading' ? (
              <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <div key={i} className="aspect-[3/4] rounded-xl bg-slate-100 animate-pulse" />)}</div>
            ) : shown && shown.length > 0 ? (
              <div>
                <div className="grid grid-cols-3 gap-2">{shown.map((c) => <CandTile key={candKey(c)} c={c} on={isPicked(c)} disabled={full && max > 1} onToggle={() => togglePick(c)} />)}</div>
                {onTerm && moreRes === undefined && (termRes?.candidates.length ?? 0) >= 3 && (
                  <button type="button" onClick={() => { setMore({ ...more, [onTerm.item]: 'loading' }); void searchLineMall(onTerm.item).then((r) => setMore((m) => ({ ...m, [onTerm.item]: r.candidates }))); }}
                    className="mt-2 h-8 px-1 text-[13px] font-semibold text-indigo-700 hover:text-indigo-900">더 보기</button>
                )}
              </div>
            ) : shown ? (
              <p className="text-[12.5px] text-slate-500">{cands === 'failed' && prodTab !== '__search' ? '우리 몰 상품을 확인하지 못했어요. 찾기나 직접 넣기로 담아 주세요' : '찾은 상품이 없어요. 다른 이름으로 찾거나 직접 넣어 주세요'}</p>
            ) : null}
          </div>
        )}

        {editing ? (
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/30 p-3.5">
            <div className="flex gap-3.5 items-start">
              <PhotoDrop channel={channel} size="tile" value={editing.m.image} onChange={(url) => setManualEdit({ ...editing, m: { ...editing.m, image: url } })} />
              <div className="flex-1 min-w-0 space-y-2">
                <input ref={inputRef} aria-label="상품 이름" className={`${INPUT} ${INPUT_OK} px-3`} maxLength={60} placeholder="상품 이름" value={editing.m.name}
                  onChange={(e) => setManualEdit({ ...editing, m: { ...editing.m, name: e.target.value } })} />
                <span className="relative block">
                  <input aria-label="판매 가격" inputMode="numeric" className={`${INPUT} ${priceBad ? INPUT_BAD : INPUT_OK} pl-3 pr-9`} maxLength={12} placeholder="판매 가격(선택)" value={editing.m.price}
                    onChange={(e) => { const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 9); setManualEdit({ ...editing, m: { ...editing.m, price: digits ? Number(digits).toLocaleString() : '' } }); }} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-slate-400">원</span>
                </span>
                <input aria-label="상품 링크" inputMode="url" className={`${INPUT} ${linkBad ? INPUT_BAD : INPUT_OK} px-3`} maxLength={500} placeholder="상품 링크(선택)" value={editing.m.url ?? ''}
                  onChange={(e) => setManualEdit({ ...editing, m: { ...editing.m, url: e.target.value } })} />
                {(priceBad || linkBad) && <p className="text-[12px] text-rose-600">{priceBad ? '가격은 1억 원 이하로 적어 주세요' : 'http로 시작하는 주소를 넣어 주세요'}</p>}
              </div>
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              <button type="button" onClick={() => setManualEdit(null)} className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-600 hover:bg-slate-50">취소</button>
              <button type="button" disabled={!editing.m.name.trim() || priceBad || linkBad || (editing.at === null && full && max > 1)}
                onClick={saveManual}
                className="h-9 px-3.5 rounded-lg bg-indigo-600 text-white text-[13px] font-semibold disabled:opacity-40">{editing.at !== null ? '고치기' : '담기'}</button>
            </div>
            <p className={`mt-2 text-[11.5px] ${editing.at === null && full && max > 1 ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>{editing.at === null && full && max > 1 ? `이미 ${max}개를 담았어요. 하나를 빼면 담을 수 있어요` : '사진과 가격이 있으면 카드로, 이름만 있으면 글로 소개해요'}</p>
          </div>
        ) : (
          <button type="button" disabled={full && max > 1} onClick={() => startManual(null)}
            className="w-full h-11 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 inline-flex items-center justify-center gap-1.5 text-[13.5px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-40">
            <Plus className="w-4 h-4" />상품 직접 넣기{onTerm ? ` · ${onTerm.item}` : ''}
          </button>
        )}

        <div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-slate-500">담은 상품</span>
            <span className={`text-[12px] font-bold tabular-nums ${count < min ? 'text-rose-600' : 'text-slate-700'}`}>{count} / 최대 {max}</span>
          </div>
          {count === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-slate-400">{min > 0 ? `이 템플릿은 상품이 ${min}개 이상 필요해요` : '담지 않으면 상품 없이 만들어요'}</p>
          ) : (
            <ul className="mt-1.5 rounded-xl border border-slate-200 divide-y divide-slate-100">
              {picks.map((c) => (
                <li key={candKey(c)} className="flex items-center gap-2.5 h-14 px-2.5">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" /> : <span className="w-10 h-10 rounded-lg bg-slate-100 shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-slate-900 truncate">{c.name}</span>
                    <span className="block text-[12px] text-slate-500">{won(c.salePrice || c.price)} · <span className="text-emerald-700 font-semibold">우리 몰</span></span>
                  </span>
                  <button type="button" onClick={() => togglePick(c)} aria-label={`${c.name} 빼기`} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
                </li>
              ))}
              {manualList.map((m, i) => (
                <li key={`m${i}`} className="flex items-center gap-2.5 h-14 px-2.5">
                  {m.image ? <img src={m.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" /> : <span className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0"><ImageIcon className="w-4 h-4 text-slate-300" /></span>}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-slate-900 truncate">{m.name}</span>
                    <span className="block text-[12px] text-slate-500">{lineManualPrice(m.price) ? won(lineManualPrice(m.price)!) : '가격 없음'} · <span className="text-violet-700 font-semibold">직접</span>{m.url ? ' · 링크' : ''}</span>
                  </span>
                  <button type="button" onClick={() => startManual(i)} aria-label={`${m.name} 고치기`} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-700 flex items-center justify-center shrink-0"><PencilLine className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setA({ manualList: manualList.filter((_, j) => j !== i) })} aria-label={`${m.name} 빼기`} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
    onNext = next;
    onSkip = current.required ? null : () => { setA({ picks: [], manualList: [] }); next(); };
    nextDisabled = count < min || !!editing;
    nextLabel = count > 0 ? `${count}개 담고 다음` : '상품 없이 다음';
  } else if (current !== MAKE && current.key === 'product') {
    const term = current.item || '';
    const ans = answers.products[term];
    const res = cands === 'loading' || cands === 'failed' ? null : cands.byTerm[term];
    const loading = basePlan.mall && cands === 'loading';
    const manualView = ans?.mode === 'manual' || (!loading && !(res && res.status === 'ok') && (current.manual_ok || !basePlan.mall));
    if (manualView) {
      const m = draft.manual ?? { name: term, price: '', image: null };
      const priceBad = !!m.price.trim() && lineManualPrice(m.price) === null;
      eyebrow = basePlan.mall && !(res && res.status === 'ok')
        ? <Why tone="data">{res?.status === 'none' ? '우리 몰에서 찾지 못한 상품이에요' : '우리 몰 상품을 확인하지 못했어요'}</Why>
        : current.price ? <Why tone="customer">한 줄에 적은 가격을 넣어 뒀어요</Why> : <Why tone="customer">한 줄에 적은 상품이에요</Why>;
      question = `「${term}」 상품을 알려 주세요`;
      reason = '사진과 가격을 넣으면 상품 카드로 실어요. 가격만 넣으면 글로 소개해요';
      body = (
        <div className="flex gap-4 items-start">
          <PhotoDrop channel={channel} size="tile" value={m.image} onChange={(url) => setDraft({ ...draft, manual: { ...m, image: url } })} />
          <div className="flex-1 min-w-0 space-y-2.5">
            <label className="block">
              <span className="block text-[12px] font-semibold text-slate-600 mb-1">상품 이름</span>
              <input ref={inputRef} className={`${INPUT} ${INPUT_OK} px-3.5`}
                maxLength={60} value={m.name} onChange={(e) => setDraft({ ...draft, manual: { ...m, name: e.target.value } })} />
            </label>
            <label className="block">
              <span className="block text-[12px] font-semibold text-slate-600 mb-1">판매 가격</span>
              <span className="relative block">
                <input inputMode="numeric" className={`${INPUT} ${priceBad ? INPUT_BAD : INPUT_OK} pl-3.5 pr-10`}
                  maxLength={12} placeholder="예: 39,000" value={m.price}
                  onChange={(e) => { const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 9); setDraft({ ...draft, manual: { ...m, price: digits ? Number(digits).toLocaleString() : '' } }); }} />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-slate-400">원</span>
              </span>
              {priceBad && <span className="block mt-1 text-[12px] text-rose-600">1억 원 이하로 적어 주세요</span>}
            </label>
            {res && res.status === 'ok' && (
              <button type="button" onClick={() => setProduct(term, { mode: 'skip' })} className="inline-flex items-center gap-1.5 h-9 px-1 text-[13px] font-semibold text-indigo-700 hover:text-indigo-900">
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
              return <CandTile key={candKey(c)} c={c} on={on} onToggle={() => setProduct(term, on ? { mode: 'skip' } : { mode: 'pick', picked: c })} />;
            })}
          </div>
          <button type="button" onClick={() => setProduct(term, { mode: 'manual', manual: { name: term, price: current.price ? current.price.toLocaleString() : '', image: null, ...(current.url ? { url: current.url } : {}) } })}
            className="mt-3 inline-flex items-center gap-1.5 h-9 px-1 text-[13px] font-semibold text-indigo-700 hover:text-indigo-900">
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
          className="w-full h-24 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center gap-2 text-[14px] font-semibold text-slate-600 hover:border-indigo-400 hover:text-indigo-700 hover:bg-indigo-50/40 transition-colors">
          <Plus className="w-5 h-5" />사진과 가격 직접 넣기
        </button>
      );
      onNext = () => { setProduct(term, { mode: 'skip' }); next(); };
      nextLabel = '넣지 않고 다음';
    }
  } else if (current !== MAKE && current.key === 'hero_photo') {
    eyebrow = <Why tone="customer">한 줄에는 사진이 없어요</Why>;
    question = '맨 위에 크게 보일 사진이 있나요?';
    reason = tplMode
      ? '표지에 크게 들어가요. 없으면 템플릿 색으로 표지를 만들어요'
      : channel === 'email' ? '행사 사진이나 대표 상품 사진 한 장이면 돼요. 메일을 열면 가장 먼저 보여요' : '행사 사진이나 대표 상품 사진 한 장이면 돼요. 없으면 사진 없이 만들어요';
    body = <PhotoDrop channel={channel} size="hero" value={answers.hero} onChange={(url) => setA({ hero: url })} />;
    onNext = next;
    onSkip = () => { setA({ hero: null }); next(); };
    nextLabel = answers.hero ? '이 사진으로 다음' : '사진 없이 다음';
  } else if (current !== MAKE && current.key === 'link') {
    const dflt = plan!.filled.link || plan!.link_default?.url || null;
    eyebrow = <Why tone="customer">{dflt ? '버튼 주소를 바꿔요' : '연결할 주소가 없어요'}</Why>;
    question = '버튼을 누르면 어디로 갈까요?';
    reason = dflt ? `비우면 ${dflt} 로 가요` : '행사 페이지나 상품 주소를 넣어 주세요. 비우면 편집 화면에서 채워요';
    body = (
      <div>
        <div className="relative">
          <Link2 className="w-[18px] h-[18px] text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input ref={inputRef} inputMode="url" className={`${INPUT} ${draft.err ? INPUT_BAD : INPUT_OK} pl-10 pr-4`}
            aria-labelledby="line-steps-q" aria-describedby="line-steps-why" maxLength={500} placeholder="예: myshop.co.kr/event" value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value, err: null })}
            onKeyDown={(e) => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); onNext(); } }} />
        </div>
        {draft.err && <p className="mt-2 text-[12.5px] text-rose-600" role="alert">{draft.err}</p>}
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
    const required = current.required === true;
    const today = ymd(new Date());
    const maxDay = ymd(new Date(Date.now() + 399 * 86_400_000));
    eyebrow = <Why tone="customer">{required ? '이 템플릿은 마감일로 마무리해요' : '한 줄에 기간이 없어요'}</Why>;
    question = '행사는 언제까지인가요?';
    reason = required ? '날짜를 주시면 마지막 장에 남은 시간이 함께 실려요' : '날짜를 주시면 마감 안내가 함께 실려요. 비우면 기간 없이 만들어요';
    body = (
      <div>
        <div className="flex flex-wrap gap-2 mb-3">
          {/* 한 줄에서 찾은 날짜 = 칩 하나(눌러야 채워짐 · 기본값 0) */}
          {[...(current.suggest && /^\d{4}-\d{2}-\d{2}$/.test(current.suggest) ? [{ label: `${periodLabel(current.suggest)} · 한 줄`, value: current.suggest }] : []), ...periodChips()].filter((c, i, all) => all.findIndex((x) => x.value === c.value) === i).map((c) => (
            <button key={c.value} type="button" aria-pressed={draft.text === c.value} onClick={() => setDraft({ ...draft, text: c.value })}
              className={`h-9 px-3 rounded-xl border text-[13px] font-semibold transition-colors whitespace-nowrap ${draft.text === c.value ? 'border-violet-500 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{c.label}</button>
          ))}
        </div>
        <div className="relative">
          <CalendarDays className="w-[18px] h-[18px] text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input ref={inputRef} type="date" min={today} max={maxDay} className={`${INPUT} ${INPUT_OK} pl-10 pr-4`}
            aria-labelledby="line-steps-q" aria-describedby="line-steps-why" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        </div>
        {draft.text && <p className="mt-2 text-[13px] font-semibold text-violet-800">{periodLabel(draft.text)}</p>}
      </div>
    );
    const valid = !draft.text || (draft.text >= today && draft.text <= maxDay);
    nextDisabled = !valid || (required && !draft.text);
    onNext = () => { setA({ period: draft.text || null }); next(); };
    onSkip = required ? null : () => { setA({ period: null }); next(); };
    nextLabel = draft.text || required ? '다음' : '기간 없이 다음';
  }

  // ─── 만들기 단계 ───
  const products = lineStepsProducts(answers, channel, termOrder);
  const manual = lineStepsManual(answers, termOrder);
  const short = balance?.enabled && cost !== null && balance.total < cost;
  const make = () => {
    if (cost === null || short || !plan) return;
    // 필수 단계가 비어 있으면 만들지 않고 그 단계로(어느 경로로 왔든 · 혜택 · 마감 · 상품 최소)
    const missing = visible.find((s) => s.required && (
      (s.key === 'benefit' && !(typeof answers.benefit === 'string' && answers.benefit.trim()))
      || (s.key === 'period' && !answers.period)
      || (s.key === 'products' && lineTemplateCount(answers) < (s.min ?? 0))));
    if (missing) { setCursor(lineStepId(missing)); return; }
    const b = tplMode && chosenId
      ? buildLineTemplateBody(plan, answers, visible, cost, { id: chosenId, layout })
      : buildLineStepsBody(plan, answers, visible, cost);
    onMake({ body: b, cost, storeKey, readLicensed: answers.readLicensed === true });
  };

  const stepOf = (key: string, item?: string) => visible.find((s) => s.key === key && (item === undefined || s.item === item));
  const later = (key: string, item?: string) => plan!.later.some((l) => l.key === key && (item === undefined || l.item === item));
  const heroStep = allSteps.find((s) => s.key === 'hero_photo');
  const heroVisible = stepOf('hero_photo');
  const linkVisible = stepOf('link');
  const linkStep = allSteps.find((s) => s.key === 'link');
  const pendingOffers = plan!.offers.filter((o) => !answers.offersAdded.includes(o.item));

  const linkRow = (() => {
    const changeBtn = !linkVisible && !(linkStep && !linkVisible) ? (
      <button type="button" onClick={() => { setLinkOpened(true); setCursor('link:'); }} className="shrink-0 h-8 px-3 mr-2 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 whitespace-nowrap">바꾸기</button>
    ) : undefined;
    if (answers.link) return <Row label="버튼 주소" tone="customer" onClick={linkVisible ? () => go(lineStepId(linkVisible)) : undefined} action={changeBtn}>{answers.link}</Row>;
    if (plan!.filled.link) return <Row label="버튼 주소" tone="customer" action={changeBtn}>{plan!.filled.link} <span className="text-violet-700 text-[12px] font-semibold">한 줄 주소</span></Row>;
    if (tplMode && answers.page?.url) return <Row label="버튼 주소" tone="customer" action={changeBtn}>{answers.page.url} <span className="text-violet-700 text-[12px] font-semibold">이벤트 페이지</span></Row>;
    if (linkStep && !linkVisible) return <Row label="버튼 주소" tone="data">상품 링크로 가요</Row>;
    if (plan!.link_default) return <Row label="버튼 주소" tone="data" action={changeBtn}>{plan!.link_default.url} <span className="text-emerald-700 text-[12px] font-semibold">{plan!.link_default.kind === 'website' ? '회사 홈페이지' : '우리 몰 첫 화면'}</span></Row>;
    return <Row label="버튼 주소" tone="empty" onClick={linkVisible ? () => go(lineStepId(linkVisible)) : undefined}>만든 뒤 편집 화면에서 넣어요</Row>;
  })();

  const tplRows = tplMode ? (() => {
    const count = lineTemplateCount(answers);
    const names = [...(answers.picks || []).map((c) => c.name), ...(answers.manualList || []).filter((m) => m.name.trim()).map((m) => m.name)];
    const prodStep = stepOf('products');
    const pageStep = stepOf('event_page');
    return (
      <>
        <Row label="템플릿" tone="customer" action={<button type="button" onClick={() => setPane('pick')} className="shrink-0 h-8 px-3 mr-2 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 whitespace-nowrap">바꾸기</button>}>
          {tplInfo?.label ?? '템플릿'}{channel === 'dm' ? ` · ${layout === 'slides' ? '슬라이드형' : '한 페이지형'}` : ''}
        </Row>
        {(pageStep || later('event_page')) && (
          <Row label="이벤트 페이지" tone={answers.page ? 'customer' : 'empty'} onClick={pageStep ? () => go(lineStepId(pageStep)) : undefined}>
            {answers.page ? `${answers.page.host || answers.page.url}${answers.page.licensed.length > 0 ? ` · 그대로 쓰기 ${answers.page.licensed.length}개` : ''}${answers.page.banner ? ' · 표지 사진' : ''}` : '페이지 없이 만들어요'}
          </Row>
        )}
        {plan!.steps.some((s) => s.key === 'benefit') && (
          <Row label="혜택" tone={answers.benefit ? 'customer' : 'empty'} onClick={stepOf('benefit') ? () => go(lineStepId(stepOf('benefit')!)) : undefined}>{answers.benefit || '혜택 없이 만들어요'}</Row>
        )}
        {(prodStep || later('products')) && (
          <Row label="상품" tone={count > 0 ? ((answers.picks || []).length > 0 ? 'data' : 'customer') : 'empty'} onClick={prodStep ? () => go(lineStepId(prodStep)) : undefined}>
            {count > 0 ? `${count}개 · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' 외' : ''}` : later('products') ? '만든 뒤 편집 화면에서 넣어요' : '상품 없이 만들어요'}
          </Row>
        )}
        {(heroStep || later('hero_photo')) && (
          <Row label="대표 사진" tone={answers.hero && heroVisible ? 'customer' : answers.page?.banner ? 'data' : 'empty'} onClick={heroVisible ? () => go(lineStepId(heroVisible)) : undefined}>
            {heroVisible && answers.hero ? <span className="inline-flex items-center gap-2"><img src={answers.hero} alt="" className="w-10 h-7 rounded object-cover border border-slate-200" />올린 사진</span>
              : answers.page?.banner ? '이벤트 페이지 사진을 써요' : '템플릿 색으로 표지를 만들어요'}
          </Row>
        )}
        {linkRow}
        {(stepOf('period') || later('period')) && (
          <Row label="마감" tone={answers.period && stepOf('period') ? 'customer' : 'empty'} onClick={stepOf('period') ? () => go(lineStepId(stepOf('period')!)) : undefined}>
            {answers.period && stepOf('period') ? periodLabel(answers.period) : '마감 없이 만들어요'}
          </Row>
        )}
      </>
    );
  })() : null;

  const makeBody = (
    <div className="space-y-4">
      {state.notice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900" role="alert">{state.notice}</div>}
      <ul className="rounded-2xl border border-slate-200 divide-y divide-slate-100 py-1">
        <Row label="한 줄" tone="customer">{state.line}</Row>
        {tplMode ? tplRows : (
          <>
            {plan!.steps.some((s) => s.key === 'benefit') && (
              <Row label="혜택" tone={answers.benefit ? 'customer' : 'empty'} onClick={stepOf('benefit') ? () => go(lineStepId(stepOf('benefit')!)) : undefined}>{answers.benefit || '혜택 없이 만들어요'}</Row>
            )}
            {termOrder.map((t) => {
              const a = answers.products[t];
              const st = stepOf('product', t);
              const pick = a?.mode === 'pick' && a.picked && products.some((p) => p.provider === a.picked!.provider && p.no === a.picked!.no) ? a.picked : null;
              const m = a?.mode === 'manual' && a.manual?.name.trim() ? a.manual : null;
              return (
                <Row key={t} label={`상품 · ${t}`} tone={pick ? 'data' : m ? 'customer' : 'empty'} onClick={st ? () => go(lineStepId(st)) : undefined}>
                  {pick ? <>{pick.name} · {won(pick.salePrice || pick.price)} <span className="text-emerald-700 text-[12px] font-semibold">우리 몰</span></>
                    : m ? <>{m.name}{lineManualPrice(m.price) ? ` · ${won(lineManualPrice(m.price)!)}` : ''}{m.image ? ' · 사진 있음' : ''}</>
                      : '넣지 않아요'}
                </Row>
              );
            })}
            {(answers.urlPicks || []).filter((c) => products.some((p) => p.provider === c.provider && p.no === c.no) && !termOrder.some((t) => { const a = answers.products[t]; return a?.mode === 'pick' && a.picked?.provider === c.provider && a.picked?.no === c.no; })).map((c) => (
              <Row key={`url:${c.provider}:${c.no}`} label="주소로 찾은 상품" tone="data"
                action={<button type="button" onClick={() => setA({ urlPicks: (answers.urlPicks || []).filter((x) => !(x.provider === c.provider && x.no === c.no)) })} className="shrink-0 h-8 px-3 mr-2 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 whitespace-nowrap">빼기</button>}>
                {c.name} · {won(c.salePrice || c.price)}
              </Row>
            ))}
            {plan!.later.filter((l) => l.key === 'product').map((l) => <Row key={`later:${l.item}`} label={`상품 · ${l.item}`} tone="empty">만든 뒤 편집 화면에서 넣어요</Row>)}
            {(heroStep || later('hero_photo')) && (
              <Row label="대표 사진" tone={heroVisible && answers.hero ? 'customer' : heroStep && !heroVisible ? 'data' : 'empty'} onClick={heroVisible ? () => go(lineStepId(heroVisible)) : undefined}>
                {heroVisible && answers.hero ? <span className="inline-flex items-center gap-2"><img src={answers.hero} alt="" className="w-10 h-7 rounded object-cover border border-slate-200" />올린 사진</span>
                  : heroStep && !heroVisible ? '상품 사진을 써요' : later('hero_photo') ? '만든 뒤 편집 화면에서 넣어요' : '사진 없이 만들어요'}
              </Row>
            )}
            {linkRow}
            {(stepOf('period') || later('period')) && (
              <Row label="기간" tone={answers.period && stepOf('period') ? 'customer' : 'empty'} onClick={stepOf('period') ? () => go(lineStepId(stepOf('period')!)) : undefined}>
                {answers.period && stepOf('period') ? periodLabel(answers.period) : later('period') ? '만든 뒤 편집 화면에서 넣어요' : '기간 없이 만들어요'}
              </Row>
            )}
            {pendingOffers.map((o) => (
              <Row key={`offer:${o.item}`} label={`상품 · ${o.item}`} tone="empty"
                action={<button type="button" disabled={manual.length >= 3} onClick={() => { setA({ offersAdded: [...answers.offersAdded, o.item] }); setCursor(`product:${o.item}`); }} className="shrink-0 h-8 px-3 mr-2 rounded-lg border border-violet-300 bg-violet-50 text-[12.5px] font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-40 whitespace-nowrap">넣기</button>}>
                {`「${o.item}」 상품도 넣을까요?`}
              </Row>
            ))}
          </>
        )}
      </ul>
      {state.reads.length > 0 && <LineReadToggle read={{ checked: answers.readLicensed === true, onChange: (v) => setA({ readLicensed: v }) }} />}
      <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[14px] font-bold text-slate-900"><Coins className="w-4 h-4 text-amber-600" />{cost === null ? '금액을 확인하지 못했어요' : `${cost}크레딧`}</span>
          {balance?.enabled && cost !== null && <span className="text-[13px] text-slate-600 tabular-nums">잔액 {balance.total.toLocaleString()} → <b className={short ? 'text-rose-600' : 'text-slate-900'}>{(balance.total - cost).toLocaleString()}</b></span>}
        </div>
        <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
          {cost !== null && generateCost !== null && cost <= generateCost ? `오늘 같은 한 줄로 만든 적이 있어 생성비 ${cost}크레딧만 받아요` : cost !== null && generateCost !== null ? `생성 ${generateCost} + 한 줄 완성 ${cost - generateCost} · ${tplMode ? '템플릿 고르기 · 페이지 읽기 · ' : '묻기 · '}몰 찾기 · 사진 올리기는 무료` : '묻기 · 몰 찾기 · 사진 올리기는 무료예요'}
        </p>
        {short && <p className="text-[12.5px] font-semibold text-rose-600 mt-1.5">크레딧이 부족해요. 충전한 뒤 만들 수 있어요</p>}
      </div>
    </div>
  );

  const names = [...visible, MAKE as typeof MAKE];
  const stepsColumn = (
    <>
      {/* 본문 — 질문 하나 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
        {current === MAKE ? (
          <>
            <h2 id="line-steps-q" ref={titleRef} tabIndex={-1} className="text-[17px] font-semibold text-slate-900 leading-snug outline-none">이렇게 만들어요</h2>
            <p id="line-steps-why" className="text-[13px] text-slate-500 mt-1 mb-4 leading-relaxed">한 줄과 답으로 완성본을 만들어요. 줄을 누르면 고칠 수 있어요</p>
            {makeBody}
          </>
        ) : (
          <>
            {eyebrow && <div className="mb-2.5">{eyebrow}</div>}
            <h2 id="line-steps-q" ref={titleRef} tabIndex={-1} className="text-[17px] font-semibold text-slate-900 leading-snug outline-none">{question}</h2>
            <p id="line-steps-why" className="text-[13px] text-slate-500 mt-1 mb-4 leading-relaxed">{reason}</p>
            {body}
          </>
        )}
      </div>

      {/* 바닥 — 버튼 둘 */}
      <div className="px-5 py-3.5 border-t border-slate-100 flex gap-2.5 shrink-0">
        {current === MAKE ? (
          <>
            <button type="button" onClick={idx > 0 ? prev : tplMode ? () => setPane('pick') : onClose} className="h-11 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap">{idx > 0 ? '이전' : tplMode ? '템플릿' : '취소'}</button>
            <button type="button" onClick={make} disabled={cost === null || !!short} className="flex-1 h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-[14px] font-bold text-slate-900 inline-flex items-center justify-center gap-2 disabled:opacity-40 whitespace-nowrap">
              <Gift className="w-4 h-4" />만들기{cost !== null ? ` · ${cost}크레딧` : ''}
            </button>
          </>
        ) : (
          <>
            {onSkip ? <button type="button" onClick={onSkip} className="h-11 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-600 hover:bg-slate-50 whitespace-nowrap">건너뛰기</button> : null}
            <button type="button" onClick={onNext} disabled={nextDisabled} className="flex-1 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-[14px] font-bold text-white disabled:opacity-40 whitespace-nowrap">{nextLabel}</button>
          </>
        )}
      </div>
    </>
  );

  return (
    <JourneyModalShell open={open} onClose={onClose} labelledBy="line-steps-q" disableDismiss zIndexClassName="z-[1500]"
      panelClassName={tplMode
        ? 'w-full md:w-[min(1040px,calc(100vw-3rem))] md:max-w-none !max-h-[100dvh] md:h-[min(820px,calc(100dvh-3rem))] md:!max-h-[min(820px,calc(100dvh-3rem))]'
        : 'w-full md:max-w-[540px] md:min-h-[560px] md:!max-h-[min(740px,calc(100dvh_-_3rem))]'}>
      {/* 머리 — 진행 막대(칸 = 단계 · 이름만 · 숫자 없음) · 한 줄 · 닫기 */}
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
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
                  <span className={`block mt-1.5 text-[11.5px] truncate ${now ? 'font-bold text-indigo-700' : done ? 'text-slate-500' : 'text-slate-400'}`}>{stepName(s)}</span>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={onClose} aria-label="닫기" className="-mr-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="mt-2.5 flex items-center gap-2 min-w-0">
          {tplMode && (
            <button type="button" onClick={() => setPane('pick')} className="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-violet-50 text-violet-800 text-[12px] font-semibold hover:bg-violet-100 whitespace-nowrap">
              <LayoutTemplate className="w-3.5 h-3.5" />{tplInfo?.label ?? '템플릿'} · 바꾸기
            </button>
          )}
          {tplMode && (
            <button type="button" onClick={() => setShowExample((v) => !v)} className="md:hidden shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-slate-100 text-slate-700 text-[12px] font-semibold whitespace-nowrap">
              <Eye className="w-3.5 h-3.5" />{showExample ? '예시 접기' : '예시 보기'}
            </button>
          )}
          <p className="min-w-0 text-[12.5px] text-slate-500 truncate"><span className="font-semibold text-violet-700 mr-1.5">한 줄</span>{state.line}</p>
        </div>
      </div>

      {tplMode && chosenId ? (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {showExample && (
            <div className="md:hidden flex justify-center py-4 bg-slate-50 border-b border-slate-100 shrink-0">
              <LineTemplateExampleView id={chosenId} channel={channel} layout={layout} width={220} />
            </div>
          )}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col md:max-w-[600px]">{stepsColumn}</div>
          <aside className="hidden md:flex flex-1 min-w-0 flex-col items-center justify-center gap-2.5 bg-slate-50 border-l border-slate-100 px-5 py-5">
            <LineTemplateExampleView id={chosenId} channel={channel} layout={layout} width={260} />
            <p className="text-[11.5px] text-slate-500 text-center">예시 · 가상 브랜드 · 우리 재료로 같은 배치를 채워요</p>
          </aside>
        </div>
      ) : stepsColumn}
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
  if (code === 'PAGE_CHANGED' || code === 'PAGE_UNREADABLE') return `${error || '이벤트 페이지를 다시 확인해 주세요.'} 크레딧은 쓰지 않았어요`;
  return `${error || '만들지 못했어요.'} 답은 그대로 남아 있어요`;
}
