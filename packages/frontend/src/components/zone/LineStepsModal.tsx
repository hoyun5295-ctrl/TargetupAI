/**
 * LineStepsModal.tsx — 한 줄 → 단계별 모달(질문 · 재료) → 만들기 (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §3-15 · §5)
 *
 * "한 줄에 없는 사실과 재료만, 한 단계에 하나씩 여쭙니다."
 *   - 무엇을 물을지 = 서버 단계 목록(plan) 그대로 · 화면은 닫힌 키의 문구만 소유 · 건너뜀 조건은 서버가 실어 보낸 이름 하나만 해석.
 *   - 한 단계 = 단계 이름(막대) · 질문 · 이유 · 입력 하나 · 바닥 버튼 2개. 색 = 남색 지금 · 보라 고객이 준 것 · 초록 우리 데이터 · 회색 비움 · 앰버 유료 버튼만.
 *   - 마지막 「만들기」 단계가 금액 확인을 겸한다(줄을 누르면 그 단계로 · 잔액 부족 = 잠금).
 *   - 답은 sessionStorage 에 바로 남는다(닫았다 다시 열어도 이어서 · 성공했을 때만 호출부가 지운다 · 다른 날 답은 버린다).
 * ★ 2026-10-22 한줄 CT 구성 5종 — `state.compositions` 가 오면 재료 판(판단 카드 · 칸 목록 · 미리보기) · 구성을 바꿔도 답은 그대로.
 *   ★ 2026-10-23 옛 템플릿 4종 고르기 판 삭제 · 구성 칸이 찼는가 = 서버 진단(미리보기 응답 slots · 화면은 판정하지 않는다 · 설계서 docs/2026-10-23-oneline-ct-complete-design.md A1).
 * ⛔ 바깥 눌러 닫힘 없음 · 모델명 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { creditCost, creditText } from '../../constants/credit';
import { X, ChevronLeft, Camera, Check, Loader2, Gift, Link2, CalendarDays, ImageIcon, PencilLine, Plus, Coins, ShoppingBag, Search, Globe, LayoutTemplate, Eye } from 'lucide-react';
import JourneyModalShell from '../journey/JourneyModalShell';
import ZoneSegmented from './ZoneSegmented';
import LineHeadlineStep from './LineHeadlineStep';
import LineCompositionPreview, { LineCompositionPick } from './LineCompositionBoard';
import { useBodyFlag } from '../../lib/surface-flags';
import { useAuthStore } from '../../stores/authStore';
import { LineReadToggle } from './LineFacts';
import {
  type LineStepsPlan, type LineStep, type LineStepsAnswers, type LineManualAnswer, type LineCandidatesResult, type LineMallCandidate, type LineStepsChannel,
  type LineLayout, type LineProofAnswer, type LineSlotVerdict,
  emptyLineStepsAnswers, lineStepId, lineStepsProducts, lineStepsManual, lineStepSkipped, lineStepTerms, lineManualPrice, normalizeLineLink,
  buildLineStepsBody, fetchLineCandidates, uploadLineImage, lineStepsStoreKey, loadLineStepsAnswers, saveLineStepsAnswers, LINE_UPLOAD_MAX_MB,
  readLinePage, searchLineMall, buildLineTemplateBody, lineTemplateCount, lineCompositionReady, lineProofRows, lineCompositionPreviewRequest,
  type LineCompositionOffer, type LineCompositionId, type LineRichPointAnswer, requestLineJudge, lineRichRows, lineStoreOf, LINE_COUPON_CODE_RE,
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
  /** ★ 2026-10-22 한줄 CT 구성 5종(있으면 재료 판 · 판단 카드 · 미리보기) */
  compositions?: LineCompositionOffer | null;
  /** ★ 2026-10-23 다시 열 때 데려갈 칸(서버 요리 관문이 막은 칸 · 단계 키) */
  focus?: string | null;
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
  if (s.key === 'hero_photo') return '첫 화면';
  if (s.key === 'proof') return '고객 후기';
  if (s.key === 'link') return '버튼 주소';
  if (s.key === 'points') return '특징';
  if (s.key === 'usage') return '사용 단계';
  if (s.key === 'mood') return '분위기 사진';
  if (s.key === 'coupon_code') return '할인 코드';
  if (s.key === 'store') return '매장 안내';
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
function PhotoDrop({ channel, value, onChange, size, disabled = false, onBusy }: { channel: LineStepsChannel; value: string | null | undefined; onChange: (url: string | null) => void; size: 'hero' | 'tile'; disabled?: boolean; onBusy?: (busy: boolean) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const take = async (file: File | undefined | null) => {
    if (!file || busy || disabled) return;
    setBusy(true);
    onBusy?.(true);
    setErr(null);
    try { onChange(await uploadLineImage(file, channel)); } catch (e: any) { setErr(e?.message || '사진을 올리지 못했어요'); } finally { setBusy(false); onBusy?.(false); }
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
  // ★ 2026-10-22 구성 5종이 오면 그것이 판(템플릿 판과 같은 틀 · 시작 = 재료 판 · 칸을 닫으면 판으로 돌아온다)
  const compOffer = state?.compositions ?? null;
  const compMode = !!compOffer;
  const tplOffer: { plans: Record<string, LineStepsPlan> } | null = compOffer ? { plans: compOffer.plans as Record<string, LineStepsPlan> } : null;
  const tplMode = !!tplOffer;
  // 보존 키 · 몰 여부는 한 줄 기준(템플릿마다 단계는 달라도 한 줄 지문 · 회사 사실은 같다)
  const basePlan = state?.plan ?? (tplOffer ? Object.values(tplOffer.plans)[0] ?? null : null);
  const storeKey = basePlan ? lineStepsStoreKey(user?.company?.id || '-', user?.id || '-', channel, basePlan.line_fp) : '';

  const [answers, setAnswers] = useState<LineStepsAnswers>(emptyLineStepsAnswers);
  // ★ 2026-10-29 목소리 꼴 칸 답(질문 id → 글 · null = 이 줄 없이 · 없음 = 아직) — 만들기 단계에서 답한다
  const [voiceAns, setVoiceAns] = useState<Record<string, string | null>>({});
  // ★ Codex 구현 1R — 다른 한 줄 · 다시 연 창 = 꼴 칸 답 처음부터(앞 요청의 링크 · 매장 · 생략이 새 요청에 실리지 않게)
  useEffect(() => { setVoiceAns({}); }, [storeKey, open]);
  const [cursor, setCursor] = useState<string>(MAKE);
  const [linkOpened, setLinkOpened] = useState(false);
  const [cands, setCands] = useState<LineCandidatesResult | 'loading' | 'failed'>('loading');
  const [balance, setBalance] = useState<{ total: number; enabled: boolean } | null>(null);
  // 복원을 마친 보존 키(복원 전 렌더의 옛 답을 새 키에 쓰지 않게)
  const [restored, setRestored] = useState('');
  // 지금 단계의 입력 초안(다음을 누를 때 답이 된다)
  const [draft, setDraft] = useState<{ text: string; manual: LineManualAnswer | null; err: string | null }>({ text: '', manual: null, err: null });
  // ★ 구성 — 판(고르기 / 재료) · 재료 판 미리보기 접기(휴대폰)
  const [pane, setPane] = useState<'pick' | 'steps'>('pick');
  // ★ 2026-10-23 서버 칸 판정(미리보기 응답 · 그 구성의 것만 · 모르면 null)
  const [serverSlots, setServerSlots] = useState<{ comp: string; filled: Record<string, boolean> } | null>(null);
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
  const chosenId: string | null = compOffer && tplOffer
    ? (answers.template?.id && tplOffer.plans[answers.template.id] ? answers.template.id
      : answers.judge?.pick && tplOffer.plans[answers.judge.pick] ? answers.judge.pick
        : compOffer.ranks.find((r) => r.recommended && tplOffer.plans[r.id])?.id ?? Object.keys(tplOffer.plans)[0] ?? null)
    : null;
  const compInfo = compOffer?.infos.find((c) => c.id === chosenId) ?? null;
  // 판단 중(AI · 2크레딧) · 판단 뒤 금액(이 한 줄 다음 결과물 값 · 판단을 냈으면 13)
  const [judging, setJudging] = useState(false);
  const [judgedCost, setJudgedCost] = useState<number | null>(null);
  // 이 한 줄로 판단 2크레딧을 실제로 냈는가(서버 원장 기준 · 크레딧제 미적용 회사 = 거짓)
  const [judgePaid, setJudgePaid] = useState(false);
  // ★ 2026-10-21 형태 기본 = 세로 스크롤(직원 실물 27/28 · 슬라이드는 사람이 고를 때만 · 설계서 docs/2026-10-21-oneline-content-design.md §3-3)
  const layout: LineLayout = channel === 'dm' ? (answers.template?.layout ?? 'page') : 'page';
  const plan: LineStepsPlan | null = tplOffer ? (chosenId ? tplOffer.plans[chosenId] ?? null : null) : (state?.plan ?? null);

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
    setJudgedCost(null);
    setJudgePaid(false);
    setServerSlots(null);
    if (compOffer) {
      // 재료 판에서 시작(판단 카드 · 빈 칸만 · 칸을 누르면 그 칸) · 서버 관문이 막은 칸으로 다시 열면 그 칸
      setPane('steps');
      setCursor(state?.focus ? `${state.focus}:` : MAKE);
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

  // ★ 2026-10-22 판단(AI 1회 · 2크레딧 · 한 줄당 오늘 · 어제 한 번) — 열 때 한 번 · 이미 판단한 한 줄(보존 답)이면 다시 묻지 않는다(금액만 다시)
  //   고른 구성 · 이유 · 구성별 초안을 답에 넣는다(사람이 고른 구성 · 이미 적은 칸은 덮지 않는다) · 실패 = 규칙 추천 그대로
  useEffect(() => {
    if (!open || !compOffer || !state || restored !== storeKey) return;
    let alive = true;
    const known = answers.judge;
    setJudging(!known);
    const names = [...(answers.picks || []).map((p) => p.name), ...(answers.manualList || []).map((m) => m.name)].filter(Boolean);
    void requestLineJudge(state.line, channel, state.reads, names).then((r) => {
      if (!alive) return;
      setJudging(false);
      if (!r) return;
      if (r.cost) { setJudgedCost(r.cost.total); setJudgePaid(r.cost.judged === true); }
      if (known) return;
      setAnswers((a) => {
        const d = r.drafts;
        const pickPts = (id: LineCompositionId) => d[id]?.points ?? [];
        // 초안 = 구성마다 다르다(특징 · 코디 · 꼬리표 · 참여 방법) → 고른 구성의 초안만 칸에 · 다른 구성으로 바꾸면 그 구성 초안으로
        const draftPoints = pickPts(r.pick);
        return {
          ...a,
          judge: { pick: r.pick, reason: r.reason, source: r.source, drafts: r.drafts },
          ...(a.template ? {} : { template: { id: r.pick, layout } }),
          ...(a.points && a.points.length > 0 ? {} : draftPoints.length > 0 ? { points: draftPoints } : {}),
          ...(a.usage && a.usage.length > 0 ? {} : (d.spotlight?.steps ?? []).length > 0 ? { usage: d.spotlight!.steps! } : {}),
        };
      });
    });
    return () => { alive = false; };
    // 여는 사건에만(보존 복원 뒤 한 번)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeKey, restored]);

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
  // ★ 2026-10-21 첫 화면(스튜디오 헤드라인) — 만드는 중엔 다음 · 건너뛰기 · 만들기를 잠근다 · 결과는 시작 때의 보존 키로(다른 한 줄을 덮지 않는다 · Codex P2 R1)
  const [headlineBusy, setHeadlineBusy] = useState(false);
  // 내 사진을 올리는 중(헤드라인 만들기를 막는다 · 서로 잠금)
  const [photoBusy, setPhotoBusy] = useState(false);
  // 지금 보고 있는 한 줄(ref · 콜백이 만들어질 때의 값이 아니라 끝났을 때의 값 · Codex P2 R2)
  const storeKeyRef = useRef(storeKey);
  storeKeyRef.current = storeKey;
  const onHeadlineMade = (url: string, key: string) => {
    if (key === storeKeyRef.current) {
      // 창이 닫혀 있어도(보존 효과가 안 도는 때) 낸 그림이 사라지지 않게 보존 답에도 바로 쓴다
      setAnswers((a) => { const n = { ...a, hero: url, heroPoster: true }; saveLineStepsAnswers(key, n, new Date().toISOString()); return n; });
    } else {
      // 다른 한 줄로 바뀐 뒤 끝났다 = 그 한 줄의 보존 답에만(지금 화면 답은 건드리지 않는다)
      const saved = loadLineStepsAnswers(key);
      if (saved) saveLineStepsAnswers(key, { ...saved.answers, hero: url, heroPoster: true }, saved.at);
    }
  };
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

  if (compMode && pane === 'pick') {
    return (
      <JourneyModalShell open={open} onClose={onClose} labelledBy="line-comp-q" disableDismiss zIndexClassName="z-[1500]"
        panelClassName="w-full md:w-[min(960px,calc(100vw-3rem))] md:max-w-none !max-h-[100dvh] md:!max-h-[min(820px,calc(100dvh-3rem))]">
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 shrink-0 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 id="line-comp-q" className="text-[16px] font-bold text-slate-900">어떤 구성으로 만들까요?</h2>
            <p className="mt-0.5 text-[12.5px] text-slate-500 truncate"><span className="font-semibold text-violet-700 mr-1.5">한 줄</span>{state.line}</p>
          </div>
          <button type="button" onClick={() => setPane('steps')} aria-label="닫기" className="-mr-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
          <LineCompositionPick infos={compOffer!.infos.filter((c) => tplOffer!.plans[c.id])} chosen={chosenId as LineCompositionId | null}
            recommended={answers.judge?.pick ?? compOffer!.ranks.find((r) => r.recommended)?.id ?? null} reason={answers.judge?.reason ?? null}
            layout={layout} channel={channel}
            onLayout={(l) => chosenId && setA({ template: { id: chosenId as LineCompositionId, layout: l } })}
            onChoose={(id) => {
              // 바꾸기 = 진단만 다시(AI 0 · 0원) · 손대지 않은 초안 칸은 그 구성의 초안으로
              setAnswers((a) => {
                const d = a.judge?.drafts?.[id]?.points ?? [];
                const prevDraft = a.judge?.drafts?.[(a.template?.id as LineCompositionId) ?? a.judge?.pick ?? 'spotlight']?.points ?? [];
                const untouched = !a.points || a.points.length === 0 || JSON.stringify(a.points) === JSON.stringify(prevDraft);
                return { ...a, template: { id, layout }, ...(untouched ? { points: d } : {}) };
              });
              setPane('steps');
              setCursor(MAKE);
            }} />
        </div>
      </JourneyModalShell>
    );
  }

  const cost = state.costOverride ?? (compMode ? judgedCost : null) ?? plan!.cost?.total ?? state.fallbackCost;
  const generateCost = plan!.cost?.generate ?? null;
  // 첫 화면 그림을 만드는 중엔 단계를 옮기지 않는다(그림 없는 본문이 먼저 나가지 않게 · 결과가 다른 단계에 떨어지지 않게)
  const go = (id: string) => { if (!headlineBusy) setCursor(id); };
  // 구성 판 = 칸 하나를 채우면 판으로 돌아온다(한 번에 하나씩 끌고 가지 않는다 · 설계서 §11-5)
  const next = () => { if (compMode) { setCursor(MAKE); return; } const n = visible[idx + 1]; setCursor(n ? lineStepId(n) : MAKE); };
  const prev = () => { if (headlineBusy) return; const p = visible[idx - 1]; if (p) setCursor(lineStepId(p)); };

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
        {compMode && (
          <label className="block mt-3">
            <span className="block text-[12px] font-semibold text-slate-600 mb-1">조건(선택)</span>
            <input className={`${INPUT} ${INPUT_OK} px-4`} maxLength={120} placeholder="예: 3만원 이상 구매 시 · 첫 구매 고객만" value={answers.benefitNote ?? ''}
              onChange={(e) => setA({ benefitNote: e.target.value })} />
          </label>
        )}
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
            {compMode && ((pg.products || []).length > 0 || (pg.images || []).length > 0) && (() => {
              // ★ 2026-10-22 비연동 회사 = 주소 하나로 상품 칸 · 분위기 사진 칸을 채운다(이 회사 사본 사진 · 가격은 읽지 않는다 · 담은 뒤 고칠 수 있다)
              const prodStep = plan!.steps.find((s) => s.key === 'products');
              const moodStep = plan!.steps.find((s) => s.key === 'mood');
              const have = new Set((answers.manualList || []).map((m) => m.image).filter(Boolean));
              const newProducts = (pg.products || []).filter((p) => !have.has(p.image));
              const room = Math.max(0, (prodStep?.max ?? 0) - lineTemplateCount(answers));
              const moodRoom = Math.max(0, (moodStep?.max ?? 0) - (answers.mood || []).length);
              const newMood = (pg.images || []).filter((u) => !(answers.mood || []).includes(u));
              return (
                <div className="mt-3 flex flex-wrap gap-2">
                  {prodStep && newProducts.length > 0 && room > 0 && (
                    <button type="button" onClick={() => setA({ manualList: [...(answers.manualList || []), ...newProducts.slice(0, room).map((p) => ({ name: p.name, price: '', image: p.image, ...(p.url ? { url: p.url } : {}) }))] })}
                      className="h-9 px-3 rounded-lg bg-violet-600 text-white text-[12.5px] font-bold hover:bg-violet-700 inline-flex items-center gap-1.5"><ShoppingBag className="w-4 h-4" />읽은 상품 {Math.min(room, newProducts.length)}개 담기</button>
                  )}
                  {moodStep && newMood.length > 0 && moodRoom > 0 && (
                    <button type="button" onClick={() => setA({ mood: [...(answers.mood || []), ...newMood.slice(0, moodRoom)] })}
                      className="h-9 px-3 rounded-lg border border-violet-300 bg-white text-violet-800 text-[12.5px] font-bold hover:bg-violet-50 inline-flex items-center gap-1.5"><ImageIcon className="w-4 h-4" />사진 {Math.min(moodRoom, newMood.length)}장을 분위기 사진으로</button>
                  )}
                  <p className="w-full text-[11.5px] text-slate-500">가격은 페이지에서 읽지 않아요. 담은 뒤 상품 칸에서 적어 주세요</p>
                </div>
              );
            })()}
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
    // ★ 2026-10-28 B-1028-2 — 구성 = 사진 있는 상품만 실린다(서버 진단과 같은 목록) · 칸 상한은 담은 수 전부가 차지한다
    const rd = compMode ? lineCompositionReady(answers, max) : null;
    const ready = rd ? rd.count : count;
    const noPhoto = rd ? rd.missingPhoto : 0;
    const overCap = rd ? rd.overCap : 0;
    const photoMissing = (img: string | null | undefined) => compMode && !img;
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
                {compMode && (
                  <input aria-label="상품 종류" className={`${INPUT} ${INPUT_OK} px-3`} maxLength={20} placeholder="종류(선택 · 예: 아우터 · 여성 · 음료)" value={editing.m.category ?? ''}
                    onChange={(e) => setManualEdit({ ...editing, m: { ...editing.m, category: e.target.value } })} />
                )}
                {(priceBad || linkBad) && <p className="text-[12px] text-rose-600">{priceBad ? '가격은 1억 원 이하로 적어 주세요' : 'http로 시작하는 주소를 넣어 주세요'}</p>}
              </div>
            </div>
            <div className="mt-3 flex gap-2 justify-end">
              <button type="button" onClick={() => setManualEdit(null)} className="h-9 px-3.5 rounded-lg border border-slate-200 bg-white text-[13px] font-semibold text-slate-600 hover:bg-slate-50">취소</button>
              <button type="button" disabled={!editing.m.name.trim() || priceBad || linkBad || photoMissing(editing.m.image) || (editing.at === null && full && max > 1)}
                onClick={saveManual}
                className="h-9 px-3.5 rounded-lg bg-indigo-600 text-white text-[13px] font-semibold disabled:opacity-40">{editing.at !== null ? '고치기' : '담기'}</button>
            </div>
            <p className={`mt-2 text-[11.5px] ${(editing.at === null && full && max > 1) || photoMissing(editing.m.image) ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
              {editing.at === null && full && max > 1 ? `이미 ${max}개를 담았어요. 하나를 빼면 담을 수 있어요`
                : photoMissing(editing.m.image) ? '이 구성은 상품을 사진 카드로 실어요. 상품 사진을 넣어 주세요'
                  : compMode ? '사진과 가격이 상품 카드로 실려요' : '사진과 가격이 있으면 카드로, 이름만 있으면 글로 소개해요'}
            </p>
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
            <span className={`text-[12px] font-bold tabular-nums ${ready < min ? 'text-rose-600' : 'text-slate-700'}`}>{ready} / 최대 {max}</span>
          </div>
          {noPhoto > 0 && (
            <p className="mt-1 text-[12px] font-semibold text-rose-600">사진이 없는 상품 {noPhoto}개는 실리지 않아요. 고치기를 눌러 사진을 넣어 주세요</p>
          )}
          {overCap > 0 && (
            <p className="mt-1 text-[12px] font-semibold text-rose-600">이 구성은 상품을 {max}개까지 실어요. {overCap}개는 빠지니 하나씩 빼 주세요</p>
          )}
          {count === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-slate-400">{min > 0 ? `이 템플릿은 상품이 ${min}개 이상 필요해요` : '담지 않으면 상품 없이 만들어요'}</p>
          ) : (
            <ul className="mt-1.5 rounded-xl border border-slate-200 divide-y divide-slate-100">
              {picks.map((c) => (
                <li key={candKey(c)} className="flex items-center gap-2.5 h-14 px-2.5">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" /> : <span className="w-10 h-10 rounded-lg bg-slate-100 shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-slate-900 truncate">{c.name}</span>
                    <span className="block text-[12px] text-slate-500">{won(c.salePrice || c.price)} · <span className="text-emerald-700 font-semibold">우리 몰</span>{photoMissing(c.imageUrl) && <span className="text-rose-600 font-semibold"> · 사진 없음 · 실리지 않아요</span>}</span>
                  </span>
                  <button type="button" onClick={() => togglePick(c)} aria-label={`${c.name} 빼기`} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
                </li>
              ))}
              {manualList.map((m, i) => (
                <li key={`m${i}`} className="flex items-center gap-2.5 h-14 px-2.5">
                  {m.image ? <img src={m.image} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200 shrink-0" /> : <span className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0"><ImageIcon className="w-4 h-4 text-slate-300" /></span>}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-slate-900 truncate">{m.name}</span>
                    <span className="block text-[12px] text-slate-500">{lineManualPrice(m.price) ? won(lineManualPrice(m.price)!) : '가격 없음'} · <span className="text-violet-700 font-semibold">직접</span>{m.url ? ' · 링크' : ''}{photoMissing(m.image) && <span className="text-rose-600 font-semibold"> · 사진 없음 · 실리지 않아요</span>}</span>
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
    nextDisabled = ready < min || !!editing;
    // ★ 2026-10-28 B-1028-2 — 꼭 필요한 칸이 모자라면 「없이」를 권하지 않는다(눌리지 않는 버튼이 못 하는 일을 말하던 것)
    nextLabel = ready < min ? `상품을 ${min}개 이상 담아 주세요` : ready > 0 ? `${ready}개 담고 다음` : '상품 없이 다음';
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
  } else if (current !== MAKE && current.key === 'proof') {
    // ★ 2026-10-21 ④ 신뢰 — 실제 후기만(지어내지 않는다 · 어느 연동에도 후기가 없어 붙여 넣는다) · 건너뛰면 후기 구역 없음
    const rows: LineProofAnswer[] = answers.proof && answers.proof.length > 0 ? answers.proof : [{ body: '', author: '', rating: 5 }];
    const setRow = (i: number, patch: Partial<LineProofAnswer>) => setA({ proof: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
    eyebrow = <Why tone="customer">믿을 만한 이유가 있으면 더 눌러요</Why>;
    question = '고객이 남긴 후기가 있나요?';
    reason = '상품 페이지 · 리뷰에서 실제 후기를 그대로 붙여 넣어 주세요. 별점과 함께 상품 아래에 보여요. 없으면 후기 칸 없이 만들어요';
    body = (
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 p-3 space-y-2">
            <div className="flex items-center gap-1" role="radiogroup" aria-label={`후기 ${i + 1} 별점`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={r.rating === n} onClick={() => setRow(i, { rating: n })}
                  className={`w-8 h-8 rounded-lg text-[18px] leading-none ${n <= r.rating ? 'text-amber-500' : 'text-slate-300'} hover:bg-slate-50`}>★</button>
              ))}
              <span className="ml-1 text-[12px] text-slate-500">별점 {r.rating}</span>
            </div>
            <textarea value={r.body} maxLength={300} rows={2} onChange={(e) => setRow(i, { body: e.target.value })} placeholder="예: 끈적임 없이 촉촉해서 매일 써요"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-[14px] focus:border-violet-500 focus:outline-none resize-none" />
            <input value={r.author} maxLength={20} onChange={(e) => setRow(i, { author: e.target.value })} placeholder="작성자(선택 · 예: 김**)"
              className="w-full h-10 px-3 rounded-xl border border-slate-300 text-[13px] focus:border-violet-500 focus:outline-none" />
          </div>
        ))}
        {rows.length < 3 && (
          <button type="button" onClick={() => setA({ proof: [...rows, { body: '', author: '', rating: 5 }] })} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-violet-700 hover:text-violet-900"><Plus className="w-4 h-4" />후기 하나 더</button>
        )}
      </div>
    );
    onNext = next;
    onSkip = () => { setA({ proof: null }); next(); };
    nextLabel = lineProofRows(answers).length > 0 ? `후기 ${lineProofRows(answers).length}건으로 다음` : '후기 없이 다음';
  } else if (current !== MAKE && current.key === 'hero_photo' && tplMode) {
    // ★ 2026-10-21 첫 화면 = 이미지 스튜디오 템플릿 헤드라인(업체 · 한 줄에 맞는 3안) · 내 사진으로 바꿀 수 있다 · 건너뛰면 템플릿 표지
    const pickImg = (answers.picks || []).find((p) => p.imageUrl)?.imageUrl || (answers.urlPicks || []).find((p) => p.imageUrl)?.imageUrl || (answers.manualList || []).find((m) => m.image)?.image || null;
    const names = [...(answers.picks || []).map((p) => p.name), ...(answers.manualList || []).map((m) => m.name)].filter(Boolean).slice(0, 6);
    eyebrow = <Why tone="customer">첫 화면이 결과를 좌우해요</Why>;
    question = '맨 위에 크게 세울 그림을 골라 주세요';
    reason = '우리 업종과 이 한 줄에 어울리는 이미지 스튜디오 템플릿으로 만들어요. 내 사진을 써도 돼요';
    body = (
      <div className="space-y-5">
        <LineHeadlineStep storeKey={storeKey} lineFp={basePlan?.line_fp || ''} line={state.line} productImage={pickImg} productNames={names}
          made={answers.heroPoster ? answers.hero ?? null : null} onMade={onHeadlineMade} onBusy={setHeadlineBusy} blocked={photoBusy} />
        <div className={headlineBusy ? 'pointer-events-none opacity-40' : ''} aria-disabled={headlineBusy}>
          <p className="text-[12.5px] font-semibold text-slate-600 mb-1.5">내 사진으로</p>
          <PhotoDrop channel={channel} size="hero" disabled={headlineBusy} onBusy={setPhotoBusy} value={answers.heroPoster ? null : answers.hero} onChange={(url) => setA({ hero: url, heroPoster: false })} />
        </div>
      </div>
    );
    onNext = next;
    onSkip = () => { setA({ hero: null, heroPoster: false }); next(); };
    nextLabel = answers.hero ? '이 그림으로 다음' : '그림 없이 다음';
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
  } else if (current !== MAKE && (current.key === 'points' || current.key === 'usage')) {
    // ★ 2026-10-22 특징 · 코디 · 꼬리표 · 참여 방법 · 사용 단계 — 두뇌 초안을 고치거나 새로 적는다(사진은 있으면 카드로)
    const key = current.key;
    const max = current.max ?? 3;
    const base: LineRichPointAnswer[] = (key === 'points' ? answers.points : answers.usage) ?? [];
    const rows: LineRichPointAnswer[] = base.length > 0 ? base : [{ title: '', body: '', image: null }];
    const put = (list: LineRichPointAnswer[]) => setA(key === 'points' ? { points: list } : { usage: list });
    const setRow = (i: number, patch: Partial<LineRichPointAnswer>) => put(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const tagOnly = compInfo?.id === 'menu' && key === 'points';
    eyebrow = <Why tone="customer">{answers.judge?.source === 'ai' && base.length > 0 ? 'AI 가 초안을 써 뒀어요 · 고쳐서 쓰세요' : current.why || '넣으면 더 풍성해져요'}</Why>;
    question = current.ask || (key === 'usage' ? '사용 순서를 알려 주세요' : '특징을 알려 주세요');
    reason = tagOnly ? '짧은 꼬리표로 실려요(예: 겨울 한정 · 국내산)' : '제목과 한 줄로 실려요. 사진이 있으면 사진 카드로 보여 줘요';
    body = (
      <div className="space-y-3">
        {rows.slice(0, max).map((r, i) => (
          <div key={i} className="rounded-2xl border border-slate-200 p-3 flex gap-3 items-start">
            {!tagOnly && <PhotoDrop channel={channel} size="tile" value={r.image} onChange={(url) => setRow(i, { image: url })} />}
            <div className="flex-1 min-w-0 space-y-2">
              <input aria-label={`${i + 1}번 제목`} className={`${INPUT} ${INPUT_OK} px-3`} maxLength={20} placeholder={tagOnly ? '예: 겨울 한정' : key === 'usage' ? `${i + 1}단계 이름` : '특징 이름'} value={r.title}
                onChange={(e) => setRow(i, { title: e.target.value })} />
              {!tagOnly && (
                <input aria-label={`${i + 1}번 한 줄`} className={`${INPUT} ${INPUT_OK} px-3`} maxLength={80} placeholder="한 줄 설명" value={r.body}
                  onChange={(e) => setRow(i, { body: e.target.value })} />
              )}
            </div>
            <button type="button" onClick={() => put(rows.filter((_, j) => j !== i))} aria-label={`${i + 1}번 빼기`} className="w-8 h-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600 flex items-center justify-center shrink-0"><X className="w-4 h-4" /></button>
          </div>
        ))}
        {rows.length < max && (
          <button type="button" onClick={() => put([...rows, { title: '', body: '', image: null }])} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-violet-700 hover:text-violet-900"><Plus className="w-4 h-4" />하나 더</button>
        )}
      </div>
    );
    onNext = next;
    onSkip = () => { put([]); next(); };
    nextLabel = lineRichRows(rows).length > 0 ? `${lineRichRows(rows).length}개로 완료` : '비워 두고 완료';
  } else if (current !== MAKE && current.key === 'mood') {
    const max = current.max ?? 3;
    const list = answers.mood ?? [];
    eyebrow = <Why tone="customer">{current.why || '사진이 첫인상이에요'}</Why>;
    question = current.ask || '분위기 사진을 올려 주세요';
    reason = '착용 · 매장 · 화보 · 대표 메뉴 사진이면 좋아요. 크게 실려요';
    body = (
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: Math.min(max, list.length + 1) }).map((_, i) => (
          <PhotoDrop key={i} channel={channel} size="tile" value={list[i] ?? null}
            onChange={(url) => { const n = [...list]; if (url) n[i] = url; else n.splice(i, 1); setA({ mood: n.filter(Boolean).slice(0, max) }); }} />
        ))}
      </div>
    );
    onNext = next;
    onSkip = () => { setA({ mood: [] }); next(); };
    nextLabel = list.length > 0 ? `${list.length}장으로 완료` : '비워 두고 완료';
  } else if (current !== MAKE && current.key === 'coupon_code') {
    const v = answers.couponCode ?? '';
    const bad = !!v && !LINE_COUPON_CODE_RE.test(v);
    eyebrow = <Why tone="customer">{current.why || '코드를 크게 보여 줘요'}</Why>;
    question = current.ask || '할인 코드가 있나요?';
    reason = '결제할 때 넣는 코드예요. 영문 · 숫자로 적어 주세요';
    body = (
      <div>
        <input ref={inputRef} className={`${INPUT} ${bad ? INPUT_BAD : INPUT_OK} px-4 font-mono tracking-widest uppercase`} maxLength={24} placeholder="예: WELCOME10" value={v}
          onChange={(e) => setA({ couponCode: e.target.value.replace(/\s/g, '').toUpperCase() || null })} />
        {bad && <p className="mt-2 text-[12.5px] text-rose-600">영문 · 숫자 · 하이픈으로 2~24자 적어 주세요</p>}
      </div>
    );
    onNext = next;
    onSkip = () => { setA({ couponCode: null }); next(); };
    nextDisabled = bad;
    nextLabel = v ? '완료' : '코드 없이 완료';
  } else if (current !== MAKE && current.key === 'store') {
    const st = answers.store ?? { address: '', business_hours: '', phone: '' };
    const setSt = (patch: Partial<typeof st>) => setA({ store: { ...st, ...patch } });
    eyebrow = <Why tone="customer">{current.why || '찾아오는 길을 보여 줘요'}</Why>;
    question = current.ask || '매장 정보를 알려 주세요';
    reason = '한 번 적으면 다음에도 그대로 써요';
    body = (
      <div className="space-y-2.5">
        <input ref={inputRef} aria-label="주소" className={`${INPUT} ${INPUT_OK} px-4`} maxLength={80} placeholder="주소" value={st.address} onChange={(e) => setSt({ address: e.target.value })} />
        <input aria-label="영업시간" className={`${INPUT} ${INPUT_OK} px-4`} maxLength={80} placeholder="영업시간(예: 매일 11:00 ~ 22:00)" value={st.business_hours} onChange={(e) => setSt({ business_hours: e.target.value })} />
        <input aria-label="전화" inputMode="tel" className={`${INPUT} ${INPUT_OK} px-4`} maxLength={80} placeholder="전화" value={st.phone} onChange={(e) => setSt({ phone: e.target.value })} />
      </div>
    );
    onNext = next;
    onSkip = () => { setA({ store: null }); next(); };
    nextLabel = lineStoreOf(answers) ? '완료' : '비워 두고 완료';
  }
  // 구성 판 = 「다음」이 아니라 「완료」(판으로 돌아온다)
  if (compMode && current !== MAKE && nextLabel.endsWith('다음')) nextLabel = nextLabel.replace(/\s*다음$/, '').trim() ? `${nextLabel.replace(/\s*다음$/, '')} 완료` : '완료';

  // ─── 만들기 단계 ───
  const products = lineStepsProducts(answers, channel, termOrder);
  const manual = lineStepsManual(answers, termOrder);
  const short = balance?.enabled && cost !== null && balance.total < cost;
  const voiceQs = plan?.voice || [];
  const voiceLeft = voiceQs.filter((q) => voiceAns[q.id] === undefined || (typeof voiceAns[q.id] === 'string' && !String(voiceAns[q.id]).trim())).length;
  const make = () => {
    if (cost === null || short || !plan || voiceLeft > 0) return;
    // 필수 칸이 비었다고 서버가 판정했으면 만들지 않고 그 칸으로(판정을 아직 모르면 보낸다 · 서버 요리 관문이 마지막으로 본다 · 0원)
    const missing = visible.find((s) => s.required && slotFilled(s) === false);
    if (missing) { setCursor(lineStepId(missing)); return; }
    const b = tplMode && chosenId
      ? buildLineTemplateBody(plan, answers, visible, cost, { id: chosenId as LineCompositionId, layout })
      : buildLineStepsBody(plan, answers, visible, cost);
    // ★ 2026-10-29 꼴 칸 답 = 본문 voice_form(빈 글 = 이 줄 없이 · 서버가 다시 계산한 질문으로 검증)
    const voiceForm = voiceQs.length > 0
      ? Object.fromEntries(voiceQs.map((q) => [q.id.replace(/^voice:/, ''), voiceAns[q.id] === null ? '' : String(voiceAns[q.id] || '').trim()]))
      : null;
    onMake({ body: voiceForm ? { ...b, voice_form: voiceForm } : b, cost, storeKey, readLicensed: answers.readLicensed === true });
  };

  const stepOf = (key: string, item?: string) => visible.find((s) => s.key === key && (item === undefined || s.item === item));
  /**
   * 칸이 찼는가(재료 판 칩 · 만들기 막기). 첫 화면 · 페이지 · 버튼 주소 = 답이 있는가.
   * ★ 2026-10-23 구성 칸 = 서버 진단 그대로(미리보기 응답 slots · A1 · 화면에 판정 사본 0) · 아직 모르면 null(막지 않는다).
   */
  function slotFilled(s: LineStep): boolean | null {
    if (s.key === 'hero_photo') return !!answers.hero;
    if (s.key === 'event_page') return !!answers.page;
    if (s.key === 'link') return !!answers.link;
    const v = serverSlots && serverSlots.comp === chosenId ? serverSlots.filled[s.key] : undefined;
    return v === undefined ? null : v;
  }
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

  // ★ 2026-10-22 구성 재료 판 — 칸마다 한 줄(단계 칩 · 지금 값 · 누르면 그 칸) · 막는 칸이 비면 붉은 점
  const LEVEL_CHIP: Record<string, { label: string; cls: string }> = {
    block: { label: '꼭 필요', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    suggest: { label: '넣으면 좋아요', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
    drop: { label: '있으면 생겨요', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  };
  const slotSummary = (s: LineStep): ReactNode => {
    if (s.key === 'hero_photo') return answers.hero ? <span className="inline-flex items-center gap-2"><img src={answers.hero} alt="" className="w-10 h-7 rounded object-cover border border-slate-200" />{answers.heroPoster ? '첫 화면 그림' : '올린 사진'}</span> : answers.page?.banner ? '페이지 사진을 써요' : '비어 있어요 · 눌러서 그림을 고르세요';
    if (s.key === 'event_page') return answers.page ? `${answers.page.host || answers.page.url}${answers.page.banner ? ' · 사진 읽음' : ''}` : '주소 하나면 사진과 문구를 읽어요';
    if (s.key === 'benefit') return answers.benefit ? `${answers.benefit}${answers.benefitNote ? ` · ${answers.benefitNote}` : ''}` : s.suggest ? `한 줄에서 찾았어요: ${s.suggest}` : '비어 있어요';
    if (s.key === 'period') return answers.period ? periodLabel(answers.period) : s.suggest ? `한 줄에서 찾았어요: ${periodLabel(s.suggest)}` : '비어 있어요';
    if (s.key === 'products') {
      // ★ 2026-10-28 B-1028-2 — 실리는 상품(사진 있는 것 · 서버 진단과 같은 목록)만 세고 사진 없는 것은 따로 알린다
      //   칩 · 만들기 막기는 그대로 서버 진단(slotFilled) · 여기는 글만
      const { names, missingPhoto, overCap } = lineCompositionReady(answers, s.max ?? lineTemplateCount(answers));
      const tail = `${missingPhoto > 0 ? ` · 사진 없는 상품 ${missingPhoto}개는 빠져요` : ''}${overCap > 0 ? ` · ${s.max}개 넘은 ${overCap}개는 빠져요` : ''}`;
      return names.length > 0 ? `${names.length}개 · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' 외' : ''}${tail}` : `비어 있어요${(s.min ?? 0) > 0 ? ` · ${s.min}개 이상` : ''}${tail}`;
    }
    if (s.key === 'points' || s.key === 'usage') { const r = lineRichRows(s.key === 'points' ? answers.points : answers.usage); return r.length > 0 ? r.map((x) => x.title).join(' · ') : '비어 있어요'; }
    if (s.key === 'mood') return (answers.mood || []).length > 0 ? <span className="inline-flex gap-1">{(answers.mood || []).map((u) => <img key={u} src={u} alt="" className="w-8 h-8 rounded object-cover border border-slate-200" />)}</span> : '비어 있어요';
    if (s.key === 'proof') return lineProofRows(answers).length > 0 ? `후기 ${lineProofRows(answers).length}건` : '비어 있어요 · 붙여 넣기';
    if (s.key === 'coupon_code') return answers.couponCode || '비어 있어요';
    if (s.key === 'store') { const st = lineStoreOf(answers); return st ? [st.address, st.business_hours, st.phone].filter(Boolean).join(' · ') : '비어 있어요'; }
    if (s.key === 'link') return answers.link || '비어 있어요';
    return '';
  };
  const compRows = compMode ? (
    <>
      {visible.map((s) => {
        const ok = slotFilled(s);
        const chip = LEVEL_CHIP[s.level || 'suggest'];
        return (
          <Row key={lineStepId(s)} label={stepName(s)} tone={ok ? 'customer' : 'empty'} onClick={() => go(lineStepId(s))}
            action={<span className={`shrink-0 mr-2 h-6 px-2 inline-flex items-center rounded-full border text-[11px] font-semibold whitespace-nowrap ${ok === false && s.level === 'block' ? 'bg-rose-600 text-white border-rose-600' : chip.cls}`}>{chip.label}</span>}>
            {slotSummary(s)}
          </Row>
        );
      })}
      {!visible.some((s) => s.key === 'link') && linkRow}
    </>
  ) : null;
  const blockedLeft = compMode ? visible.filter((s) => s.required && slotFilled(s) === false).length : 0;

  const makeBody = (
    <div className="space-y-4">
      {state.notice && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900" role="alert">{state.notice}</div>}
      <ul className="rounded-2xl border border-slate-200 divide-y divide-slate-100 py-1">
        <Row label="한 줄" tone="customer">{state.line}</Row>
        {compMode ? compRows : (
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
      {voiceQs.length > 0 && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/50 px-4 py-3 space-y-3">
          <p className="text-[13px] font-semibold text-slate-900">학습한 우리 회사 문자에 들어가는 칸이에요</p>
          {voiceQs.map((q) => {
            const v = voiceAns[q.id];
            const none = v === null;
            return (
              <div key={q.id} className="space-y-1.5">
                <label htmlFor={`lv-${q.id}`} className="block text-[13px] text-slate-800">{q.label}</label>
                {q.help && <p className="text-[12px] text-slate-500">{q.help}</p>}
                <div className="flex gap-2">
                  <input id={`lv-${q.id}`} value={typeof v === 'string' ? v : ''} disabled={none} maxLength={q.maxLength}
                    placeholder={q.placeholder} onChange={(e) => setVoiceAns({ ...voiceAns, [q.id]: e.target.value })}
                    className="flex-1 min-w-0 h-10 px-3 rounded-lg border border-slate-200 bg-white text-[13px] disabled:bg-slate-100 disabled:text-slate-400" />
                  <button type="button" onClick={() => setVoiceAns({ ...voiceAns, [q.id]: none ? '' : null })}
                    className={`shrink-0 h-10 px-3 rounded-lg border text-[12.5px] font-semibold ${none ? 'border-violet-600 bg-violet-50 text-violet-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                    {q.noneLabel || '이 줄 없이'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {state.reads.length > 0 && <LineReadToggle read={{ checked: answers.readLicensed === true, onChange: (v) => setA({ readLicensed: v }) }} />}
      <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[14px] font-bold text-slate-900"><Coins className="w-4 h-4 text-amber-600" />{cost === null ? '금액을 확인하지 못했어요' : `${cost}크레딧`}</span>
          {balance?.enabled && cost !== null && <span className="text-[13px] text-slate-600 tabular-nums">잔액 {balance.total.toLocaleString()} → <b className={short ? 'text-rose-600' : 'text-slate-900'}>{(balance.total - cost).toLocaleString()}</b></span>}
        </div>
        <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">
          {compMode ? (cost !== null && generateCost !== null && cost <= generateCost
            ? `오늘 같은 한 줄로 만든 적이 있어 다시 만들기 ${cost}크레딧만 받아요`
            : `${judgePaid || plan!.cost?.judged ? `판단 ${creditText('oneline-judge')}은 이미 냈어요 · ` : ''}칸 채우기 · 몰 찾기 · 사진 올리기 · 구성 바꾸기는 무료 · 같은 한 줄로 다시 만들면 ${generateCost ?? creditCost('oneline-recook')}크레딧`)
            : cost !== null && generateCost !== null && cost <= generateCost ? `오늘 같은 한 줄로 만든 적이 있어 생성비 ${cost}크레딧만 받아요` : cost !== null && generateCost !== null ? `생성 ${generateCost} + 한 줄 완성 ${cost - generateCost} · 묻기 · 몰 찾기 · 사진 올리기는 무료` : '묻기 · 몰 찾기 · 사진 올리기는 무료예요'}
        </p>
        {short && <p className="text-[12.5px] font-semibold text-rose-600 mt-1.5">크레딧이 부족해요. 충전한 뒤 만들 수 있어요</p>}
        {blockedLeft > 0 && <p className="text-[12.5px] font-semibold text-rose-600 mt-1.5">꼭 필요한 칸 {blockedLeft}개를 채우면 만들 수 있어요</p>}
        {voiceLeft > 0 && <p className="text-[12.5px] font-semibold text-rose-600 mt-1.5">우리 회사 문자 칸 {voiceLeft}개를 적거나 「이 줄 없이」를 눌러 주세요</p>}
      </div>
    </div>
  );

  // ★ 2026-10-23 미리보기 요청 = 만들기 본문 그대로(같은 칸 · 같은 상품 목록) · 응답 칸 판정 = 재료 판 칩 · 만들기 막기
  const previewReq = compMode && chosenId && plan
    ? lineCompositionPreviewRequest(buildLineTemplateBody(plan, answers, visible, cost ?? 0, { id: chosenId as LineCompositionId, layout }), answers, plan.steps.find((s) => s.key === 'products')?.max ?? 0)
    : null;
  const onSlots = (slots: LineSlotVerdict[] | null, comp: LineCompositionId) => setServerSlots(slots ? { comp, filled: Object.fromEntries(slots.map((x) => [x.step, x.filled])) } : null);
  const names = [...visible, MAKE as typeof MAKE];
  const stepsColumn = (
    <>
      {/* 본문 — 질문 하나 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
        {current === MAKE ? (
          <>
            {compMode ? (
              <div className="mb-4 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white" style={{ background: compInfo?.primary || '#4338ca' }}><LayoutTemplate className="w-4.5 h-4.5" /></span>
                  <div className="flex-1 min-w-0">
                    <h2 id="line-steps-q" ref={titleRef} tabIndex={-1} className="text-[16px] font-bold text-slate-900 leading-snug outline-none">
                      {judging ? '한 줄을 읽고 구성을 고르는 중이에요' : `${compInfo?.label ?? '구성'}으로 만들게요`}
                    </h2>
                    <p id="line-steps-why" className="text-[12.5px] text-slate-600 mt-0.5 leading-relaxed">
                      {judging ? '잠시만요. 업종과 한 줄에 맞는 구성과 초안을 준비해요' : (answers.judge?.reason || compInfo?.desc || '')}
                    </p>
                  </div>
                  <button type="button" disabled={judging || headlineBusy} onClick={() => setPane('pick')} className="shrink-0 h-8 px-3 rounded-lg border border-violet-300 bg-white text-[12.5px] font-semibold text-violet-800 hover:bg-violet-50 disabled:opacity-40 whitespace-nowrap">바꾸기</button>
                </div>
                {judging && <div className="mt-3 h-1.5 rounded-full bg-violet-100 overflow-hidden"><div className="h-full w-1/3 bg-violet-500 animate-pulse rounded-full" /></div>}
              </div>
            ) : (
              <>
                <h2 id="line-steps-q" ref={titleRef} tabIndex={-1} className="text-[17px] font-semibold text-slate-900 leading-snug outline-none">이렇게 만들어요</h2>
                <p id="line-steps-why" className="text-[13px] text-slate-500 mt-1 mb-4 leading-relaxed">한 줄과 답으로 완성본을 만들어요. 줄을 누르면 고칠 수 있어요</p>
              </>
            )}
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
            <button type="button" disabled={headlineBusy} onClick={compMode ? () => setPane('pick') : idx > 0 ? prev : onClose} className="disabled:opacity-40 h-11 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap">{compMode ? '구성' : idx > 0 ? '이전' : '취소'}</button>
            <button type="button" onClick={make} disabled={cost === null || !!short || headlineBusy || judging || voiceLeft > 0} className="flex-1 h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-[14px] font-bold text-slate-900 inline-flex items-center justify-center gap-2 disabled:opacity-40 whitespace-nowrap">
              <Gift className="w-4 h-4" />만들기{cost !== null ? ` · ${cost}크레딧` : ''}
            </button>
          </>
        ) : (
          <>
            {onSkip ? <button type="button" onClick={onSkip} disabled={headlineBusy} className="disabled:opacity-40 h-11 px-4 rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-600 hover:bg-slate-50 whitespace-nowrap">건너뛰기</button> : null}
            <button type="button" onClick={onNext} disabled={nextDisabled || headlineBusy} className="flex-1 h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-[14px] font-bold text-white disabled:opacity-40 whitespace-nowrap">{nextLabel}</button>
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
          {compMode ? (
            current !== MAKE ? (
              <button type="button" disabled={headlineBusy} onClick={() => setCursor(MAKE)} aria-label="재료 판으로" className="-ml-2 h-9 pl-1 pr-2.5 rounded-lg flex items-center gap-1 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 shrink-0 disabled:opacity-40"><ChevronLeft className="w-5 h-5" />재료 판</button>
            ) : <span className="w-0" />
          ) : idx > 0 ? (
            <button type="button" onClick={prev} aria-label="이전 단계" className="-ml-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 shrink-0"><ChevronLeft className="w-5 h-5" /></button>
          ) : <span className="w-0" />}
          {compMode ? <p className="flex-1 min-w-0 text-[15px] font-bold text-slate-900 truncate pt-1.5">{current === MAKE ? '재료 판' : stepName(current)}</p> : (
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
          )}
          <button type="button" onClick={onClose} disabled={headlineBusy} aria-label="닫기" className="disabled:opacity-40 -mr-2 w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 shrink-0"><X className="w-5 h-5" /></button>
        </div>
        <div className="mt-2.5 flex items-center gap-2 min-w-0">
          {tplMode && (
            <button type="button" disabled={headlineBusy || judging} onClick={() => setPane('pick')} className="disabled:opacity-40 shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-violet-50 text-violet-800 text-[12px] font-semibold hover:bg-violet-100 whitespace-nowrap">
              <LayoutTemplate className="w-3.5 h-3.5" />{compInfo?.label ?? '구성'} · 바꾸기
            </button>
          )}
          {tplMode && (
            <button type="button" onClick={() => setShowExample((v) => !v)} className="md:hidden shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-slate-100 text-slate-700 text-[12px] font-semibold whitespace-nowrap">
              <Eye className="w-3.5 h-3.5" />{showExample ? '미리보기 접기' : '미리보기'}
            </button>
          )}
          <p className="min-w-0 text-[12.5px] text-slate-500 truncate"><span className="font-semibold text-violet-700 mr-1.5">한 줄</span>{state.line}</p>
        </div>
      </div>

      {tplMode && chosenId ? (
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          {showExample && (
            <div className="md:hidden flex justify-center py-4 bg-slate-50 border-b border-slate-100 shrink-0">
              <LineCompositionPreview composition={chosenId as LineCompositionId} channel={channel} request={previewReq} paused={current !== MAKE} width={260} onSlots={onSlots} />
            </div>
          )}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col md:max-w-[600px]">{stepsColumn}</div>
          <aside className="hidden md:flex flex-1 min-w-0 flex-col items-center justify-center gap-2.5 bg-slate-50 border-l border-slate-100 px-5 py-5">
            <LineCompositionPreview composition={chosenId as LineCompositionId} channel={channel} request={previewReq} paused={current !== MAKE} width={300} onSlots={onSlots} />
            <p className="text-[11.5px] text-slate-500 text-center">우리 재료로 그린 미리보기 · 점선 칸은 채우면 생겨요 · 문구는 만들 때 AI 가 써요</p>
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
