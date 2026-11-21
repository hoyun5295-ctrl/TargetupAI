/**
 * AiAskPage.tsx — 한 줄로 묻기 (★ 2026-11-21 C151 · 설계서 docs/2026-11-21-c151-ask-entry-design.md §3 · 목업 docs/mockups/2026-11-21-ask-entry-flow-mockup.html)
 *
 * 처음 화면(한 줄 · 시작 줄 셋) → 1단계 누구에게(묶음 여섯 + 구매 기록 없음 · 격자) → 2단계 몇 명에게(모두 · 예산 · 순서)
 * → 3단계 무엇을(문안 한 안 · 세 통신사 도착 확인 자동) → 직접발송 창으로 가져가기(명단은 그때 서버가 다시 센다).
 * 전용 틀(Harold 1121 결정 D1 · AI 존 남색 머리 띠를 쓰지 않는다) · 숫자 = 서버 값만 · 크레딧이 나가는 자리는 단추에 값을 적는다.
 * ⛔ 모델명 0 · 검사 방식 낱말 0 · native dialog 0 · 줄표 0.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { creditCost } from '../constants/credit';
import { aiLineApi, AiLineApiError, spamFp, type AiLineSpamState, type AiLineSpamChip } from '../utils/ai-line';
import { newAttemptToken } from '../utils/one-line';
import { stashAiLineObjective } from '../lib/hub-recommend';
import { stashAudience } from '../utils/product-insight';
import {
  ASK_BUDGET_CHIPS, ASK_COL_LABELS, ASK_LINE_MIN, ASK_ROW_LABELS,
  askBenefitMode, askBudgetOf, askBudgetValid, askGroupSendable, askInputFp, askParts, askTakeBlock, fmtNum,
  type AskCard, type AskCount, type AskGroupKey, type AskOrder, type AskPlan, type AskSegments,
} from '../utils/ai-ask';

type Step = 0 | 1 | 2 | 3;
type Start = 'line' | 'coupon' | 'pick' | 'budget';
type SpamView = { state: AiLineSpamState | 'idle'; testId?: string; fp: string; carriers?: AiLineSpamChip['carriers']; message?: string };

const COMPOSE_COST = creditCost('ai-line-compose');
const CARRIERS: Array<{ key: string; label: string }> = [{ key: 'SKT', label: 'SKT' }, { key: 'KT', label: 'KT' }, { key: 'LGU', label: 'LG U+' }];
const carrierKey = (c: string) => (/^LG/i.test(c) ? 'LGU' : c.toUpperCase());
const LIVE: ReadonlyArray<SpamView['state']> = ['queued', 'running', 'checking'];
const SPAM_NOTE: Partial<Record<SpamView['state'], string>> = {
  demo: '시연 계정은 도착 확인을 하지 않아요.',
  unavailable: '지금 요금제에는 도착 확인이 없어요.',
  unregistered: '등록된 발신번호가 있어야 도착 확인을 해요.',
  no_balance: '잔액이 부족해 도착 확인을 하지 못했어요.',
  charset: '보낼 수 없는 글자가 있어 도착 확인을 하지 못했어요.',
  no_device: '지금은 도착 확인을 할 수 없어요.',
  warn: '확인 결과가 오지 않았어요.',
};
const errText = (e: unknown, fallback: string) => (e instanceof AiLineApiError || e instanceof Error ? e.message : fallback) || fallback;
const won = (n: number) => `${fmtNum(n)}원`;

function Chk({ on }: { on: boolean }) {
  return (
    <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 ${on ? 'border-[#F97316] bg-[#F97316]' : 'border-[#D1D6DB] bg-white'}`} aria-hidden="true">
      {on && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
    </span>
  );
}

function Pill({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on}
      className={`h-[34px] whitespace-nowrap rounded-full px-3.5 text-[13.5px] font-semibold disabled:opacity-50 ${on ? 'bg-[#191F28] text-white' : 'bg-[#F2F4F6] text-[#4E5968]'}`}>
      {children}
    </button>
  );
}

const Label = ({ children, first }: { children: ReactNode; first?: boolean }) => (
  <span className={`block text-[12.5px] font-semibold text-[#636D7A] ${first ? '' : 'mt-[18px]'}`}>{children}</span>
);

export default function AiAskPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [step, setStep] = useState<Step>(0);
  const [lineDraft, setLineDraft] = useState('');
  const [lineHint, setLineHint] = useState<string | null>(null);
  const [usedLine, setUsedLine] = useState<string | null>(null);
  const [start, setStart] = useState<Start>('pick');

  // 묶음 숫자(서버)
  const [seg, setSeg] = useState<AskSegments | null>(null);
  const [segState, setSegState] = useState<'loading' | 'ok' | 'error' | 'locked'>('loading');
  const [segError, setSegError] = useState('');
  const loadSegments = async () => {
    setSegState('loading');
    try {
      setSeg(await aiLineApi.askSegments());
      setSegState('ok');
    } catch (e) {
      if (e instanceof AiLineApiError && e.code === 'AI_OPERATOR_GATED') { setSegState('locked'); return; }
      setSegError(errText(e, '고객 묶음을 세지 못했어요.'));
      setSegState('error');
    }
  };
  useEffect(() => { void loadSegments(); }, []);

  // 고르기
  const [picked, setPicked] = useState<AskGroupKey[]>(['leave']);
  const [mode, setMode] = useState<'all' | 'budget'>('all');
  const [budget, setBudget] = useState(30_000);
  const [budgetText, setBudgetText] = useState('30,000');
  const [order, setOrder] = useState<AskOrder>('recent');
  const [mxOpen, setMxOpen] = useState(false);
  const groupsInOrder = useMemo(() => (seg ? seg.groups.map((g) => g.key).filter((k) => picked.includes(k)) : picked), [seg, picked]);
  const plan: AskPlan = useMemo(() => ({ groups: groupsInOrder, mode, budget: mode === 'budget' ? budget : null, order }), [groupsInOrder, mode, budget, order]);
  const planKey = JSON.stringify(plan);
  const toggle = (g: AskGroupKey) => setPicked((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));

  // 세기(서버 §2-1) — 고른 것이 바뀔 때마다 · 늦게 온 옛 응답은 버린다
  const [count, setCount] = useState<AskCount | null>(null);
  const [countBusy, setCountBusy] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const countSeq = useRef(0);
  const budgetOk = mode === 'all' || askBudgetValid(budget);
  useEffect(() => {
    const my = ++countSeq.current;
    if (step === 0 || plan.groups.length === 0 || !budgetOk || segState !== 'ok') { setCount(null); setCountBusy(false); setCountError(null); return; }
    setCountBusy(true);
    const t = setTimeout(async () => {
      try {
        const c = await aiLineApi.askCount(plan);
        if (countSeq.current === my) { setCount(c); setCountError(null); }
      } catch (e) {
        if (countSeq.current === my) {
          setCount(null);
          setCountError(errText(e, '인원을 세지 못했어요.'));
          // 단가가 정해지지 않은 회사 = 예산으로 고를 수 없다(그 사이 단가가 지워진 경우 · 1단계에서 갇히지 않게 모두로 되돌린다)
          if (e instanceof AiLineApiError && e.code === 'PRICE_UNSET') setMode('all');
        }
      } finally {
        if (countSeq.current === my) setCountBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, step === 0, budgetOk, segState]);

  // 문안(서버 · 2크레딧) — 만든 때의 입력 지문을 들고 있다
  const [benefit, setBenefit] = useState('');
  const [none, setNone] = useState(false);
  const benefitMode = askBenefitMode(none, benefit);
  const nowFp = askInputFp({ line: usedLine, groups: groupsInOrder, mode: benefitMode, benefit });
  const [card, setCard] = useState<{ card: AskCard; fp: string; hole: boolean } | null>(null);
  const [making, setMaking] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const attemptRef = useRef<{ key: string; token: string } | null>(null);
  const gen = useRef(0);

  // 도착 확인(서버 · 검사 문자 요금) — 문안이 뜨면 자동
  const [callback, setCallback] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/companies/callback-numbers', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const d = r.ok ? await r.json().catch(() => null) : null;
        const list = (Array.isArray(d?.numbers) ? d.numbers : []).filter((c: any) => c?.phone);
        setCallback(String((list.find((c: any) => c.is_default) || list[0])?.phone || '').replace(/\D/g, ''));
      } catch { setCallback(''); }
    })();
  }, []);
  const [spam, setSpam] = useState<SpamView | null>(null);
  const spamRef = useRef(spam);
  spamRef.current = spam;

  const startSpam = async (c: AskCard) => {
    const cb = callback || '';
    const fp = spamFp(c.body, c.subject, 'LMS', true, cb);
    if (!cb) { setSpam({ state: 'unregistered', fp }); return; }
    setSpam({ state: 'queued', fp });
    try {
      const out = await aiLineApi.spamStart({ body: c.body, subject: c.subject, channel: 'LMS', isAd: true, callback: cb, sampleCustomerId: null });
      if (spamRef.current?.fp !== fp) return;
      setSpam({ state: out.state, testId: out.state === 'busy' ? undefined : out.testId, fp, message: out.message });
    } catch (e) {
      if (spamRef.current?.fp === fp) setSpam({ state: 'warn', fp, message: errText(e, '') });
    }
  };
  // 발신번호를 늦게 읽었으면 그때 시작 · 줄이 차 있으면(busy) 5초 뒤 다시
  useEffect(() => {
    if (card && !spam && callback !== null) void startSpam(card.card);
    if (card && spam?.state === 'busy') {
      const t = setTimeout(() => { void startSpam(card.card); }, 5000);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, spam?.state, callback]);
  // 검사 읽기 — 검사 번호를 받으면 바로 읽고, 진행 중이거나 통신사 결과를 아직 못 얻었으면(같은 글 이어 보기 = 끝난 검사 · 읽기 실패) 3초(늦은 보고만 남으면 15초)마다 다시
  const hasCarriers = !!spam?.carriers;
  useEffect(() => {
    if (!spam?.testId) return undefined;
    const live = LIVE.includes(spam.state);
    if (!live && hasCarriers) return undefined;
    const { testId, fp } = spam;
    let inflight = false;
    const readOnce = () => {
      if (inflight) return;
      inflight = true;
      void aiLineApi.spamRead(testId, 'LMS').then((r) => {
        const cur = spamRef.current;
        if (!cur || cur.fp !== fp || cur.testId !== testId) return;
        setSpam({ ...cur, state: r.state, carriers: r.carriers });
      }).catch(() => { /* 다음 읽기에서 다시 */ }).finally(() => { inflight = false; });
    };
    readOnce();
    const timer = setInterval(readOnce, spam.state === 'checking' ? 15_000 : 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spam?.testId, spam?.state, spam?.fp, hasCarriers]);

  const compose = async (retry: boolean) => {
    if (making) return;
    const fp = nowFp;
    const key = `${fp}|${retry ? 1 : 0}`;
    // 응답을 못 받은 같은 시도 = 같은 토큰(서버가 같은 키로 0 · 기억한 결과) · 성공하면 다음은 새 토큰
    if (!attemptRef.current || attemptRef.current.key !== key) attemptRef.current = { key, token: newAttemptToken() };
    const my = ++gen.current;
    setMaking(true);
    setComposeError(null);
    try {
      const out = await aiLineApi.askCompose({
        line: usedLine, plan, benefitMode, benefit: benefitMode === 'custom' ? benefit.trim() : null, retryBlocked: retry, attemptToken: attemptRef.current.token,
      });
      if (gen.current !== my) return;
      attemptRef.current = null;
      setCard({ card: out.card, fp, hole: out.benefitHole });
      setSpam(null);
    } catch (e) {
      if (gen.current === my) setComposeError(errText(e, '문안을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.'));
    } finally {
      if (gen.current === my) setMaking(false);
    }
  };

  // ── 시작 ──
  const begin = (from: Start, groups: AskGroupKey[], opts: { line?: string | null; budget?: number | null } = {}) => {
    setStart(from);
    setUsedLine(opts.line ?? null);
    setPicked(groups);
    // 단가가 정해지지 않은 회사 = 예산으로 시작하지 않는다(서버가 예산 세기를 거절 · 2단계 예산 칸도 잠김)
    setMode((from === 'budget' || opts.budget) && !seg?.unitPrice.unset ? 'budget' : 'all');
    const b = opts.budget ?? 30_000;
    setBudget(b);
    setBudgetText(fmtNum(b));
    setOrder('recent');
    setBenefit('');
    setNone(false);
    gen.current++;
    setCard(null);
    setSpam(null);
    setMaking(false);
    setComposeError(null);
    attemptRef.current = null;
    setStep(1);
  };
  const [reading, setReading] = useState(false);
  // 한 줄 읽는 동안에는 다른 시작을 받지 않는다(늦게 온 읽기 응답이 새로 고른 흐름 · 만든 문안을 덮지 않게 · 시작 줄 · Enter · 단추 모두 잠김)
  const beginFromLine = async () => {
    if (reading) return;
    const t = lineDraft.trim();
    if (t.length < ASK_LINE_MIN) { setLineHint(`한 줄을 ${ASK_LINE_MIN}자 이상 적어 주세요.`); return; }
    setLineHint(null);
    setReading(true);
    try {
      const r = await aiLineApi.askRead(t);
      begin('line', r.groups, { line: t, budget: r.budget });
    } catch (e) {
      setLineHint(errText(e, '한 줄을 읽지 못했어요. 다시 눌러 주세요.'));
    } finally {
      setReading(false);
    }
  };

  const go = (s: Step) => { setStep(s); window.scrollTo(0, 0); };
  const toAiLine = () => {
    if (lineDraft.trim()) stashAiLineObjective(lineDraft.trim());
    navigate('/ai-line');
  };

  // ── 가져가기 ──
  const block = askTakeBlock({ making, cardFp: card?.fp ?? null, nowFp, benefitHole: !!card?.hole, planned: count?.planned ?? 0 });
  const ownerId = user?.id ? String(user.id) : '';
  const companyId = (user as any)?.company?.id ? String((user as any).company.id) : '';
  const take = () => {
    if (block || !card || !count || countBusy || !ownerId || !companyId) return;
    const names = (seg?.groups || []).filter((g) => groupsInOrder.includes(g.key)).map((g) => g.name).join(' · ');
    stashAudience({
      kind: 'ask', label: names, seen: count.planned,
      ask: { plan, message: { body: card.card.body, subject: card.card.subject, msgType: 'LMS' }, owner: { companyId, userId: ownerId }, at: Date.now() },
    });
    navigate('/dashboard?open=direct-send');
  };

  // ── 화면 값 ──
  const groupName = (k: AskGroupKey) => seg?.groups.find((g) => g.key === k)?.name || '';
  const sub1 = start === 'line'
    ? `한 줄에 적으신 대로 ${groupsInOrder.map(groupName).filter(Boolean).join(' · ') || '고객'}을 골라 두었어요. 더 넣거나 빼도 돼요.`
    : picked.length === 1 && picked[0] === 'nobuy' ? '구매 기록이 없는 분을 골라 두었어요. 더 넣거나 빼도 돼요.'
      : '먼저 챙길 떠나는 단골을 골라 두었어요. 더 넣거나 빼도 돼요.';
  const price = count?.unitPrice ?? seg?.unitPrice ?? null;
  const priceText = price && !price.unset ? `${price.lms.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원` : '';
  const excluded = count ? Math.max(0, count.inScope - count.sendable) : 0;
  const parts = count ? askParts(count, mode === 'budget' ? order : 'recent') : [];
  const stale = !!card && !making && card.fp !== nowFp;
  const blockedNames = (spam?.carriers || []).filter((c) => c.result === 'blocked').map((c) => CARRIERS.find((x) => x.key === carrierKey(c.carrier))?.label || c.carrier);
  const spamDone = spam?.state === 'pass';
  const ready = segState === 'ok';

  const chipOf = (key: string): 'wait' | 'run' | 'ok' | 'bad' | 'off' => {
    if (!spam || spam.state === 'idle' || spam.state === 'queued' || spam.state === 'busy') return 'wait';
    if (spam.state === 'running' || spam.state === 'pass' || spam.state === 'blocked' || spam.state === 'checking') {
      const r = (spam.carriers || []).find((c) => carrierKey(c.carrier) === key)?.result;
      return r === 'pass' ? 'ok' : r === 'blocked' ? 'bad' : spam.state === 'pass' ? 'ok' : 'run';
    }
    return 'off';
  };

  // 아래 줄 · 단추
  let sum: ReactNode = null;
  if (step === 0) sum = '한 줄을 적거나 오른쪽에서 골라 시작하세요';
  else if (picked.length === 0) sum = '보낼 분을 한 줄 이상 골라 주세요';
  else if (making && step === 3) sum = '문안을 만들고 있어요';
  else if (countBusy && !count) sum = '고객을 세고 있어요';
  else if (countError) sum = countError;
  else if (count) sum = step === 1
    ? <><b className="text-[15px] text-[#191F28] tabular-nums">{fmtNum(count.inScope)}명</b>을 골랐어요</>
    : <><b className="text-[15px] text-[#191F28] tabular-nums">{fmtNum(count.planned)}명</b>에게 {won(count.amount)}으로 보내요</>;
  const needCompose = step === 2 && (!card || card.fp !== nowFp);
  const nextDisabled = step === 0 ? reading || !ready
    : step === 3 ? !!block || countBusy
      : !ready || picked.length === 0 || countBusy || !count || (step === 2 && (count.planned === 0 || !budgetOk));
  const onNext = () => {
    if (step === 0) { void beginFromLine(); return; }
    if (step === 1) { go(2); return; }
    if (step === 2) { go(3); if (needCompose) void compose(false); return; }
    take();
  };
  const blockLine = block === 'zero' ? '보낼 분이 0명이에요. 2단계에서 다시 골라 주세요.' : '';

  return (
    <div className="min-h-screen bg-[#F2F4F6] text-[14px] leading-normal text-[#191F28] [overflow-wrap:anywhere] break-keep">
      <div className="relative mx-auto flex min-h-screen max-w-[960px] flex-col bg-white min-[900px]:mt-4 min-[900px]:min-h-0 min-[900px]:rounded-[20px]">
        <header className="flex h-12 items-center gap-0.5 px-2.5 min-[900px]:px-[18px]">
          <button type="button" onClick={() => (step === 0 ? navigate('/ai-line') : go((step - 1) as Step))}
            className="flex h-10 w-10 items-center justify-center rounded-[10px] hover:bg-[#F2F4F6]" aria-label={step === 0 ? 'AI 한줄로로 돌아가기' : '이전'}>
            <ChevronLeft className="h-[22px] w-[22px]" strokeWidth={2.2} />
          </button>
          <span className="flex-1 text-[14px] font-semibold text-[#4E5968]">한 줄로 묻기</span>
          {step > 0 && <span className="pr-2.5 text-[13px] font-semibold tabular-nums text-[#636D7A]">{step} / 3</span>}
        </header>
        {step > 0 && (
          <div className="flex gap-1.5 px-5 min-[900px]:px-7" aria-hidden="true">
            {[1, 2, 3].map((i) => <i key={i} className={`h-1 flex-1 rounded ${i <= step ? 'bg-[#F97316]' : 'bg-[#E5E8EB]'}`} />)}
          </div>
        )}

        <main className="relative px-5 pb-3 pt-5 min-[900px]:min-h-[432px] min-[900px]:px-7">
          {segState === 'locked' ? (
            <div className="max-w-[520px]">
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">요금제에 가입하면 쓸 수 있어요</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">한 줄로 묻기는 AI 요금제에서 열려요. 요금제를 고르면 바로 쓸 수 있어요.</p>
              <button type="button" onClick={() => navigate('/pricing')} className="mt-5 h-11 rounded-xl bg-[#191F28] px-5 text-[15px] font-bold text-white">요금제 보기</button>
            </div>
          ) : step === 0 ? (
            <div className="grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[900px]:items-start min-[900px]:gap-8">
              <div>
                <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">무엇을 보내고 싶으세요?<br />한 줄로 적어 주세요</h1>
                <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">누구에게, 몇 명에게, 무엇을 보낼지 차례로 골라 드려요.</p>
                <label className="mt-[22px] flex items-end gap-2.5 border-b-2 border-[#191F28] pb-[7px]">
                  <img src="/brand/wordmark.png" alt="한줄로" className="mb-1 h-[17px] shrink-0 select-none" draggable={false} />
                  <input value={lineDraft} onChange={(e) => { setLineDraft(e.target.value); setLineHint(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void beginFromLine(); } }}
                    maxLength={2000} placeholder="오래 안 온 단골에게 재구매 10% 쿠폰" aria-label="한 줄 입력"
                    className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-[#636D7A]" />
                </label>
                {lineHint && <p className="mt-2 text-[13px] text-[#B91C1C]">{lineHint}</p>}
                <button type="button" onClick={toAiLine} className="mt-3 inline-flex items-center gap-1 py-1.5 text-[13px] font-semibold text-[#636D7A] underline underline-offset-4">
                  다른 걸 물어보시려면 AI 한줄로
                </button>
              </div>
              <div>
                <Label first>이렇게 시작해도 돼요</Label>
                <ul className="-mx-2.5 mt-1.5 grid gap-px">
                  {([
                    ['coupon', '오래 안 온 단골에게 쿠폰 보내기', '떠나는 단골을 골라 두고, 혜택은 3단계에서 적어요', ['leave']],
                    ['pick', '고객 묶음부터 보기', '먼저 연락할 고객을 골라 두고 시작해요', ['leave']],
                    ['budget', '예산에 맞춰 보내기', '금액만 정하면 그만큼 골라 드려요', ['leave']],
                  ] as Array<[Start, string, string, AskGroupKey[]]>).map(([k, t, d, g]) => (
                    <li key={k}>
                      <button type="button" disabled={!ready || reading} onClick={() => begin(k, g)}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-[9px] text-left hover:bg-[#F9FAFB] disabled:opacity-50">
                        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                          <b className="text-[15px] font-bold">{t}</b>
                          <span className="text-[12.5px] text-[#636D7A]">{d}</span>
                        </span>
                        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#D1D6DB]" strokeWidth={2.4} />
                      </button>
                    </li>
                  ))}
                </ul>
                {segState === 'loading' && <p className="mt-3 text-[12.5px] text-[#636D7A]">고객 묶음을 세고 있어요</p>}
                {segState === 'error' && (
                  <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-[#4E5968]">
                    {segError}
                    <button type="button" onClick={() => void loadSegments()} className="h-8 rounded-lg bg-[#191F28] px-3 text-[13px] font-bold text-white">다시 읽기</button>
                  </p>
                )}
              </div>
            </div>
          ) : step === 1 && seg ? (
            <>
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">누구에게 보낼까요?</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">{sub1}</p>
              <div className="mt-4 grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[900px]:items-start min-[900px]:gap-8">
                <div>
                  <ul className="-mx-2.5 grid gap-px">
                    {seg.groups.filter((g) => g.key !== 'nobuy').map((g) => {
                      const on = picked.includes(g.key);
                      return (
                        <li key={g.key}>
                          <button type="button" aria-pressed={on} onClick={() => toggle(g.key)}
                            className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-[9px] text-left ${on ? 'bg-[#FFF7ED]' : 'hover:bg-[#F9FAFB]'}`}>
                            <Chk on={on} />
                            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                              <b className="inline-flex items-center gap-1.5 text-[15px] font-bold">
                                {g.name}{g.key === 'leave' && <span className="rounded-md bg-[#FFEDD5] px-[7px] py-0.5 text-[11.5px] font-bold text-[#C2410C]">먼저 챙길 분</span>}
                              </b>
                              <span className="text-[12.5px] text-[#636D7A]">{g.desc}</span>
                            </span>
                            <span className="shrink-0 text-[15px] font-bold tabular-nums">{fmtNum(askGroupSendable(seg, g.key))}명</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="my-1.5 h-px bg-[#E5E8EB]" />
                  {seg.groups.filter((g) => g.key === 'nobuy').map((g) => {
                    const on = picked.includes(g.key);
                    return (
                      <button key={g.key} type="button" aria-pressed={on} onClick={() => toggle(g.key)}
                        className={`-mx-2.5 flex w-[calc(100%+1.25rem)] items-center gap-3 rounded-xl px-2.5 py-[9px] text-left ${on ? 'bg-[#FFF7ED]' : 'hover:bg-[#F9FAFB]'}`}>
                        <Chk on={on} />
                        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                          <b className="text-[15px] font-bold">{g.name}</b>
                          <span className="text-[12.5px] text-[#636D7A]">{g.desc}</span>
                        </span>
                        <span className="shrink-0 text-[15px] font-bold tabular-nums">{fmtNum(askGroupSendable(seg, g.key))}명</span>
                      </button>
                    );
                  })}
                  <button type="button" onClick={() => setMxOpen((x) => !x)} aria-expanded={mxOpen}
                    className="mt-2 inline-flex items-center gap-1 py-1.5 text-[13.5px] font-semibold text-[#4E5968] underline underline-offset-4 min-[900px]:hidden">
                    {mxOpen ? '표 접기' : '표로 자세히 보기'}
                  </button>
                </div>
                <div className={mxOpen ? 'block' : 'hidden min-[900px]:block'}>
                  <Label first>표로 보기</Label>
                  <div className="mt-1.5 grid grid-cols-[62px_repeat(3,minmax(0,1fr))] gap-1 min-[400px]:grid-cols-[72px_repeat(3,minmax(0,1fr))] min-[400px]:gap-[5px]">
                    <div />
                    {ASK_COL_LABELS.map((c) => <div key={c} className="flex min-h-[26px] items-center justify-center text-center text-[12px] font-semibold text-[#636D7A]">{c}</div>)}
                    {ASK_ROW_LABELS.map((r, ri) => (
                      <div key={r} className="contents">
                        <div className="flex min-h-[26px] items-center text-[12px] font-semibold text-[#636D7A]">{r}</div>
                        {seg.cells.filter((c) => c.row === ri).map((c) => (
                          <button key={c.key} type="button" onClick={() => toggle(c.group)} aria-pressed={picked.includes(c.group)}
                            className={`flex min-h-[40px] items-center justify-center rounded-[10px] text-[14px] font-bold tabular-nums ${picked.includes(c.group) ? 'bg-[#FFEDD5] text-[#C2410C]' : 'bg-[#F2F4F6] text-[#4E5968] hover:bg-[#E5E8EB]'}`}>
                            {fmtNum(c.sendable)}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-[12.5px] leading-[1.55] text-[#636D7A]">세로는 마지막 구매, 가로는 구매 횟수예요. 칸을 누르면 그 묶음이 골라져요. 묶음을 겹쳐 고르면 같은 분은 한 번만 보내요.</p>
                </div>
              </div>
            </>
          ) : step === 2 ? (
            <>
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">{count ? `${fmtNum(count.sendable)}명에게 보낼 수 있어요` : '보낼 수 있는 분을 세고 있어요'}</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">
                {count && excluded > 0 ? `고른 ${fmtNum(count.inScope)}명 가운데 수신거부, 광고 수신 미동의, 번호 오류, 같은 번호인 ${fmtNum(excluded)}명은 뺐어요.` : count ? `고른 ${fmtNum(count.inScope)}명 모두 받을 수 있어요.` : ' '}
              </p>
              <div className="mt-4 grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[900px]:items-start min-[900px]:gap-8">
                <div>
                  <div className="grid gap-2">
                    {([['all', '모두에게 보내기', count && mode === 'all' ? `${fmtNum(count.planned)}명, ${won(count.amount)}` : '받을 수 있는 분 모두에게 보내요'],
                      ['budget', '예산에 맞춰 보내기', price?.unset ? '문자 단가가 정해지지 않아 고를 수 없어요' : '정한 금액 안에서 골라 보내요']] as Array<['all' | 'budget', string, string]>).map(([k, t, d]) => (
                      <button key={k} type="button" aria-pressed={mode === k} disabled={k === 'budget' && !!price?.unset} onClick={() => setMode(k)}
                        className={`flex w-full items-center gap-3 rounded-[14px] px-3.5 py-3 text-left disabled:opacity-50 ${mode === k ? 'bg-[#FFF7ED] shadow-[inset_0_0_0_2px_#F97316]' : 'bg-[#F9FAFB] shadow-[inset_0_0_0_1px_#E5E8EB]'}`}>
                        <Chk on={mode === k} />
                        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2.5">
                          <b className="text-[15px] font-bold">{t}</b>
                          <span className="text-[12.5px] text-[#636D7A]">{d}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {mode === 'budget' && (
                    <div>
                      <Label>예산</Label>
                      <div className="mt-1 flex items-baseline gap-1 border-b-2 border-[#191F28] pb-1">
                        <input value={budgetText} inputMode="numeric" aria-label="예산"
                          onChange={(e) => { const b = askBudgetOf(e.target.value); setBudget(b); setBudgetText(b ? fmtNum(b) : ''); }}
                          style={{ width: `${Math.max(2, budgetText.length) + 0.5}ch` }}
                          className="min-w-[2ch] max-w-full border-0 bg-transparent text-[22px] font-bold tabular-nums tracking-[-0.01em] outline-none" />
                        <span className="text-[17px] font-bold">원</span>
                      </div>
                      {!budgetOk && <p className="mt-1.5 text-[12.5px] text-[#B91C1C]">예산은 1,000원부터 1억 원까지 적을 수 있어요.</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {ASK_BUDGET_CHIPS.map((b) => <Pill key={b} on={budget === b} onClick={() => { setBudget(b); setBudgetText(fmtNum(b)); }}>{fmtNum(b / 10_000)}만 원</Pill>)}
                      </div>
                      <Label>누구부터 넣을까요?</Label>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Pill on={order === 'recent'} onClick={() => setOrder('recent')}>최근에 산 분부터</Pill>
                        <Pill on={order === 'count'} onClick={() => setOrder('count')}>많이 산 분부터</Pill>
                      </div>
                    </div>
                  )}
                </div>
                <div className={`rounded-2xl bg-[#F9FAFB] p-4 ${countBusy ? 'opacity-60' : ''}`}>
                  <Label first>이렇게 보내요</Label>
                  {count ? (
                    <>
                      <div className="mt-1.5 text-[20px] font-bold leading-[1.3] tracking-[-0.02em] tabular-nums">{fmtNum(count.planned)}명에게 {won(count.amount)}</div>
                      <div className="mt-0.5 text-[13px] text-[#4E5968]">
                        {mode === 'all' ? '받을 수 있는 분 모두에게 보내요' : count.planned < count.sendable ? `받을 수 있는 ${fmtNum(count.sendable)}명 가운데 골랐어요` : '예산 안에서 모두에게 보낼 수 있어요'}
                      </div>
                      {mode === 'budget' && (
                        <div className="mt-3 h-1.5 rounded-full bg-[#E5E8EB]"><i className="block h-full rounded-full bg-[#F97316]" style={{ width: `${count.sendable ? Math.min(100, (count.planned / count.sendable) * 100).toFixed(1) : 0}%` }} /></div>
                      )}
                      <ul className="mt-2.5">
                        {parts.map((p) => (
                          <li key={p.label} className="flex justify-between gap-3 py-[5px] text-[13.5px] text-[#4E5968]">
                            <span className="whitespace-nowrap">{p.label}</span>
                            <span className={`text-right tabular-nums ${p.taken === 0 ? 'font-medium text-[#636D7A]' : 'font-bold text-[#191F28]'}`}>
                              {p.taken === p.n ? `${fmtNum(p.n)}명 모두` : p.taken > 0 ? `${fmtNum(p.n)}명 중 ${fmtNum(p.taken)}명` : '이번에는 빠져요'}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {count.capped && <p className="mt-2 text-[12.5px] font-semibold text-[#C2410C]">한 번에 5만 명까지 가져가요.</p>}
                    </>
                  ) : (
                    <div className="mt-2 grid gap-2.5" aria-hidden="true"><i className="block h-5 w-3/4 rounded bg-[#E5E8EB]" /><i className="block h-3 w-1/2 rounded bg-[#E5E8EB]" /></div>
                  )}
                  <p className="mt-3 text-[12.5px] leading-[1.55] text-[#636D7A]">
                    {priceText ? `LMS 1통 ${priceText}으로 계산했어요. ` : ''}문안을 만들 때 {COMPOSE_COST}크레딧을 쓰고, 도착 확인에는 검사 문자 요금이 들어요.
                  </p>
                </div>
              </div>
            </>
          ) : step === 3 ? (
            <>
              <h1 className="text-[20px] font-bold leading-[1.35] tracking-[-0.02em]">이 문안으로 보낼까요?</h1>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-[#4E5968]">혜택은 적어 주신 것만 넣었어요.</p>
              <div className="mt-4 grid grid-cols-1 gap-5 min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[900px]:items-start min-[900px]:gap-8">
                <div>
                  <div className="rounded-2xl bg-[#F2F4F6] px-4 py-3.5">
                    <small className="mb-2 block text-[12.5px] font-semibold text-[#4E5968]">받는 분 화면</small>
                    {making ? (
                      <div>
                        <div className="mb-2.5 flex items-center gap-2 text-[13.5px] font-semibold text-[#4E5968]">
                          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[#D1D6DB] border-t-[#4E5968] motion-reduce:animate-none" />문안을 만들고 있어요
                        </div>
                        <div className="grid gap-[9px] pb-1 pt-0.5" aria-hidden="true"><i className="block h-3 rounded-md bg-[#D1D6DB]" /><i className="block h-3 w-[86%] rounded-md bg-[#D1D6DB]" /><i className="block h-3 w-[62%] rounded-md bg-[#D1D6DB]" /></div>
                      </div>
                    ) : card ? (
                      <div className={stale ? 'text-[#636D7A]' : ''}>
                        {card.card.subject && <p className="mb-1.5 text-[14.5px] font-bold">{card.card.subject}</p>}
                        <pre className="m-0 whitespace-pre-wrap font-[inherit] text-[14.5px] leading-[1.65]">{card.card.body}</pre>
                        <p className="mt-2.5 text-[12px] text-[#636D7A]">보낼 때 (광고) 표기와 수신거부 번호가 붙어요.</p>
                      </div>
                    ) : composeError ? (
                      <p className="text-[13.5px] text-[#B91C1C]">{composeError}</p>
                    ) : null}
                  </div>
                  {composeError && card && <p className="mt-2 text-[13px] text-[#B91C1C]">{composeError}</p>}
                  {(stale || (card && card.hole && !stale) || (!card && composeError && !making)) && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[#4E5968]">
                      <span>{stale ? '고른 것이나 혜택이 바뀌었어요. 문안에 넣으려면 다시 만들어 주세요.' : card?.hole ? '문안에 혜택 자리가 남았어요. 혜택 칸에 적거나 다시 만들어 주세요.' : '다시 눌러 주세요.'}</span>
                      <button type="button" disabled={making} onClick={() => void compose(false)} className="h-9 whitespace-nowrap rounded-[10px] bg-[#191F28] px-3.5 text-[13.5px] font-bold text-white disabled:opacity-50">
                        문안 다시 만들기 <span className="ml-1.5 text-[12.5px] font-semibold text-[#D1D6DB]">{COMPOSE_COST}크레딧</span>
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <Label first>혜택</Label>
                  <div className="mt-1 flex items-center gap-2.5 border-b-2 border-[#E5E8EB] pb-[5px] focus-within:border-[#191F28]">
                    <input value={benefit} onChange={(e) => setBenefit(e.target.value)} disabled={none || making} maxLength={40}
                      placeholder="예: 재구매 10% 쿠폰" aria-label="혜택"
                      className="min-w-0 flex-1 border-0 bg-transparent text-[16px] font-semibold outline-none placeholder:font-medium placeholder:text-[#636D7A] disabled:text-[#636D7A]" />
                    <Pill on={none} disabled={making} onClick={() => setNone((x) => !x)}>혜택 없이</Pill>
                  </div>
                  <Label>세 통신사 도착 확인</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {CARRIERS.map((c) => {
                      const s = chipOf(c.key);
                      return (
                        <span key={c.key} className={`inline-flex h-8 items-center gap-[5px] rounded-full px-3 text-[13px] font-bold ${s === 'ok' ? 'bg-[#ECFDF5] text-[#047857]' : s === 'bad' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#F2F4F6] text-[#4E5968]'}`}>
                          {s === 'ok' && <Check className="h-3.5 w-3.5" strokeWidth={2.6} />}
                          {s === 'bad' && <X className="h-3.5 w-3.5" strokeWidth={2.6} />}
                          {s === 'run' && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#D1D6DB] border-t-[#4E5968] motion-reduce:animate-none" />}
                          {c.label} {s === 'ok' ? '도착' : s === 'bad' ? '막힘' : s === 'run' ? '확인 중' : s === 'off' ? '확인 못 함' : '대기'}
                        </span>
                      );
                    })}
                  </div>
                  {spam?.state === 'blocked' && !stale && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[#4E5968]">
                      <span>{blockedNames.join(', ') || '한 통신사'}에서 스팸으로 막혔어요. 막힌 표현을 고쳐서 다시 확인할 수 있어요.</span>
                      <button type="button" disabled={making} onClick={() => void compose(true)} className="h-9 whitespace-nowrap rounded-[10px] bg-[#191F28] px-3.5 text-[13.5px] font-bold text-white disabled:opacity-50">
                        고쳐서 다시 확인 <span className="ml-1.5 text-[12.5px] font-semibold text-[#D1D6DB]">{COMPOSE_COST}크레딧</span>
                      </button>
                    </div>
                  )}
                  {spam && SPAM_NOTE[spam.state] && (
                    <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-[#4E5968]">
                      {SPAM_NOTE[spam.state]}
                      {spam.state === 'warn' && card && <button type="button" onClick={() => void startSpam(card.card)} className="h-8 rounded-lg bg-[#F2F4F6] px-3 text-[13px] font-semibold text-[#4E5968]">다시 확인</button>}
                    </p>
                  )}
                  <p className="mt-3 text-[12.5px] leading-[1.55] text-[#636D7A]">
                    {spamDone ? '보내기 전에 세 통신사에 잘 도착하는지 먼저 확인했어요.'
                      : spam?.state === 'blocked' ? '막힌 채로 보내면 그 통신사 고객에게는 도착하지 않을 수 있어요.'
                        : '보내기 전에 세 통신사에 잘 도착하는지 먼저 확인해요. 검사 문자 요금이 들어요. 확인이 끝나기 전에도 다음으로 갈 수 있어요.'}
                    {' '}돈이 나가는 일이라, 직접발송 창에서 한 번 더 확인하고 보내요.
                  </p>
                  {blockLine && <p className="mt-2 text-[13px] font-semibold text-[#C2410C]">{blockLine}</p>}
                </div>
              </div>
            </>
          ) : (
            <p className="text-[14px] text-[#4E5968]">고객 묶음을 세고 있어요</p>
          )}
        </main>

        {segState !== 'locked' && (
          <footer className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-x-3 gap-y-2.5 border-t border-[#E5E8EB] bg-white px-5 pb-4 pt-3 min-[900px]:static min-[900px]:flex-nowrap min-[900px]:rounded-b-[20px] min-[900px]:px-7 min-[900px]:pb-[18px] min-[900px]:pt-3.5">
            <div className="basis-full text-center text-[14px] text-[#4E5968] min-[900px]:flex-1 min-[900px]:basis-auto min-[900px]:text-left">{sum}</div>
            {step >= 2 && (
              <button type="button" onClick={() => go((step - 1) as Step)}
                className="h-[46px] shrink-0 rounded-xl bg-white px-[18px] text-[15px] font-semibold text-[#4E5968] shadow-[inset_0_0_0_1px_#D1D6DB] hover:bg-[#F9FAFB] min-[900px]:h-11">이전</button>
            )}
            <button type="button" onClick={onNext} disabled={nextDisabled}
              className="h-[46px] flex-1 rounded-xl bg-[#191F28] px-5 text-[15px] font-bold text-white hover:bg-[#333D4B] disabled:cursor-not-allowed disabled:bg-[#F2F4F6] disabled:text-[#4E5968] min-[900px]:h-11 min-[900px]:min-w-[176px] min-[900px]:flex-none">
              {step === 0 ? (reading ? '읽는 중' : '시작하기')
                : step === 3 ? '직접발송 창으로 가져가기'
                  : needCompose ? <>문안 만들기 <span className="ml-1.5 text-[12.5px] font-semibold text-[#D1D6DB]">{COMPOSE_COST}크레딧</span></>
                    : '다음'}
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
