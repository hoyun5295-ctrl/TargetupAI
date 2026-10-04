/**
 * PlannerEventModal — 행사 담기 창 + 재료 단계 (★ 2026-10-04 보강 · 설계서 §5-2 · 목업 v2 (나))
 *
 * 모바일 DM 또는 메일을 고르는 순간 같은 창이 재료 단계로 바뀐다 — PC = 창이 넓어지며 2단(왼쪽 행사·채널 · 오른쪽 재료) ·
 * 375 = 같은 시트 안 화면 전환([← 행사로]). 겹친 창 0(위에 뜨는 것은 소재 라이브러리 고르기 · 금액 확인 창뿐).
 * 재료 부품 = components/make/MakeInputs(PhotoTextBoard · MallStrip · ManualProducts) 그대로.
 *
 * 돈: 버튼 금액 = 서버 견적(담기 전 견적 `/build-quote`) · 저장 뒤 행사 견적이 그 금액과 다르거나 20크레딧 이상이면 금액 확인 창 1회
 * (CreditConfirmModal · 확인 창 기준 20 미만은 버튼에 금액이 있어 생략 · ★1004 개정). 생성은 채널마다 1요청(같은 시도 토큰 재시도 = 재차감 0).
 * 행사명 · 기간 · 혜택은 서버가 행사 행 원본으로 첫 카드에 "그대로" 싣는다(화면 미리보기는 표시용).
 * ⛔ native dialog 0 · 모델명 0 · 줄표 0.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CalendarClock, Check, CircleX, LoaderCircle, Lock, RotateCw, WandSparkles, X } from 'lucide-react';
import { ManualProducts, MallStrip, PhotoTextBoard, useMallCandidates, type MallCandidate } from '../make/MakeInputs';
import AssetLibraryPickerModal, { type PickedAsset } from '../assets/AssetLibraryPickerModal';
import CreditConfirmModal from '../credit/CreditConfirmModal';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import { BUILD_CARD_IMAGES_MAX } from '../ai-build/BuildCardsInput';
import { AI_BUILD_PRODUCTS_MAX } from '../ai-build/ProductPickList';
import { newAttemptToken, type BuildImageRole, type BuildImageValue, type BuildProductValue } from '../../utils/ai-build';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useToast } from '../ToastProvider';
import { PLANNER_CHANNEL, plannerDay } from '../../constants/planner-status';
import {
  plannerApi, plannerErrorText, won,
  type Anchor, type Availability, type BuildQuote, type CalendarEvent, type PlannerChannelKey, type PlannerMaterials, type TimingRule,
} from './planner-api';

/** 금액 확인 창 기준(크레딧 확인 모달 상시 기준 20 · 그 밑은 버튼 금액으로 갈음) */
const CREDIT_CONFIRM_MIN = 20;
const BUILD_CHANNELS: Array<'dm' | 'email'> = ['dm', 'email'];
const CHANNEL_ORDER: PlannerChannelKey[] = ['sms', 'dm', 'email'];

interface Tp { channel: PlannerChannelKey; timing: TimingRule }
type ChannelRun = 'wait' | 'busy' | 'done' | 'fail';
type Phase = { kind: 'idle' } | { kind: 'saving' } | { kind: 'building'; runs: Partial<Record<'dm' | 'email', ChannelRun>>; error: string | null };

const ANCHOR_LABEL: Record<Anchor, string> = { start: '행사 시작일', end: '마지막 날', before_start: '시작 전' };

/** (순수) 첫 발송일 — 고른 시점 중 가장 이른 날(서버 computeTouchpointDate와 같은 규칙) */
function firstSendOf(tps: Tp[], startsOn: string, endsOn: string): string | null {
  const dates = tps.map((t) => {
    if (t.timing.anchor === 'end') return endsOn;
    if (t.timing.anchor === 'before_start') {
      const d = new Date(`${startsOn}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (t.timing.offsetDays || 3));
      return d.toISOString().slice(0, 10);
    }
    return startsOn;
  }).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  return dates[0] || null;
}

const productKey = (p: { source: string; provider: string | null; code: string | null; name: string }) =>
  p.source === 'mall' ? `${p.provider}:${p.code}` : `manual:${p.name.toLowerCase().replace(/\s+/g, '')}`;

function toMaterials(images: BuildImageValue[], text: string, licensed: boolean, products: BuildProductValue[]): PlannerMaterials {
  return {
    images: images.map((im) => ({ url: im.url, width: im.width ?? null, height: im.height ?? null })),
    text,
    licensed: licensed && text.trim().length > 0,
    products: products.filter((p) => p.source !== 'site').map((p) => ({
      source: p.source === 'mall' ? 'mall' : 'manual', provider: p.provider, code: p.code, name: p.name,
      price: p.price, salePrice: p.salePrice, discountRate: p.discountRate, url: p.url, imageUrl: p.imageUrl,
    })),
  };
}
const materialsKey = (m: PlannerMaterials | null) => JSON.stringify(m ? [m.images.map((i) => i.url), m.text, m.licensed, m.products.map((p) => [p.source, p.provider, p.code, p.name, p.price, p.salePrice])] : null);
const hasMaterial = (m: PlannerMaterials) => m.images.length > 0 || m.text.trim().length > 0 || m.products.length > 0;

export default function PlannerEventModal({ month, initialDate, editing, availability, balance, onClose, onSaved }: {
  month: string;
  initialDate?: string | null;
  editing: CalendarEvent | null;
  availability: Availability[];
  balance: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const phone = useMediaQuery('(max-width: 767px)');

  const [title, setTitle] = useState(editing?.title || '');
  const [startsOn, setStartsOn] = useState(editing?.startsOn || initialDate || `${month}-01`);
  const [endsOn, setEndsOn] = useState(editing?.endsOn || initialDate || `${month}-01`);
  const [benefit, setBenefit] = useState(editing?.benefitText || '');
  const [tps, setTps] = useState<Tp[]>(() => (editing?.touchpoints || [])
    .filter((t) => t.status !== 'skipped' && CHANNEL_ORDER.includes(t.channel))
    .map((t) => ({ channel: t.channel, timing: { anchor: t.timing.anchor, ...(t.timing.anchor === 'before_start' ? { offsetDays: t.timing.offsetDays || 3 } : {}) } })));

  const m0 = editing?.materials || null;
  const [images, setImages] = useState<BuildImageValue[]>(() => (m0?.images || []).map((i) => ({ url: i.url, width: i.width, height: i.height })));
  const [text, setText] = useState(m0?.text || '');
  const [licensed, setLicensed] = useState(!!m0?.licensed);
  const [products, setProducts] = useState<BuildProductValue[]>(() => (m0?.products || []).map((p) => ({ ...p, key: productKey(p) })));
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pane, setPane] = useState<'event' | 'materials'>('event');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [draftQuote, setDraftQuote] = useState<{ total: number; quotes: BuildQuote[] } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [creditAsk, setCreditAsk] = useState<{ eventId: string; quotes: BuildQuote[]; total: number; channels: Array<'dm' | 'email'> } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [savedId, setSavedId] = useState<string | null>(editing?.id || null);
  const tokens = useRef<Partial<Record<'dm' | 'email', string>>>({});

  const avail = (ch: PlannerChannelKey) => availability.find((a) => a.channel === ch);
  const picked = (ch: PlannerChannelKey) => tps.filter((t) => t.channel === ch);
  const buildPicked = BUILD_CHANNELS.filter((ch) => picked(ch).length > 0);
  const materialsOn = buildPicked.length > 0;
  const materials = useMemo(() => toMaterials(images, text, licensed, products), [images, text, licensed, products]);
  const materialsChanged = materialsKey(materials) !== materialsKey(m0);
  // 행사명 · 기간 · 혜택도 완성본 첫 화면에 그대로 실린다 — 바꾸면 이미 만든 완성본은 옛 내용(서버 완성본 지문과 같은 규칙)
  const factsChanged = !!editing && (title.trim() !== editing.title || startsOn !== editing.startsOn || endsOn !== editing.endsOn || benefit.trim() !== (editing.benefitText || ''));
  // 다시 만들어야 하는 채널 = 새로 고른 채널 · 완성본이 없거나 낡은 채널 · 재료나 행사 사실을 바꾼 경우 전부
  const needBuild = buildPicked.filter((ch) => !editing || materialsChanged || factsChanged || editing.staleChannels.includes(ch)
    || !editing.touchpoints.some((t) => t.channel === ch && t.status !== 'skipped'));
  const busy = phase.kind !== 'idle';
  const mall = useMallCandidates(materialsOn);
  const [mallQ, setMallQ] = useState('');
  const roles = useMemo(() => new Map<string, BuildImageRole>(), []);
  const firstSend = firstSendOf(tps, startsOn, endsOn);
  const mailPicked = picked('email').length > 0;

  // 담기 전 서버 견적(버튼 금액) — 재료·행사가 바뀌면 다시 묻는다
  useEffect(() => {
    if (!materialsOn || needBuild.length === 0 || !hasMaterial(materials)) { setDraftQuote(null); setQuoteError(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const r = await plannerApi<{ quotes: BuildQuote[]; total: number }>('/api/marketing-planner/build-quote', {
        body: { title, startsOn, endsOn, benefitText: benefit, materials, channels: needBuild },
      });
      if (!alive) return;
      if (r.ok) { setDraftQuote({ total: Number(r.data.total) || 0, quotes: r.data.quotes || [] }); setQuoteError(null); }
      else { setDraftQuote(null); setQuoteError(plannerErrorText(r, '견적을 계산하지 못했어요.')); }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materialsOn, needBuild.join(','), materialsKey(materials), title, startsOn, endsOn, benefit]);

  // 재료가 바뀌면 다른 시도(토큰 초기화 · 같은 재료 재시도만 같은 토큰)
  useEffect(() => { tokens.current = {}; }, [materialsKey(materials)]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 채널 · 시점 ─────────────────────────────────────────────────
  const toggleChannel = (ch: PlannerChannelKey) => {
    const a = avail(ch);
    if (busy || (a && !a.available)) return;
    const on = picked(ch).length > 0;
    if (on) {
      const built = !!editing && editing.touchpoints.some((t) => t.channel === ch) && !editing.staleChannels.includes(ch as 'dm' | 'email');
      const drop = () => setTps((prev) => prev.filter((t) => t.channel !== ch));
      if (built && (ch === 'dm' || ch === 'email')) {
        setConfirm({
          mode: 'warning', title: `${PLANNER_CHANNEL[ch].label}을 빼요`,
          description: '이미 만든 완성본의 생성비는 돌아가지 않아요. 저장하면 이 행사에서 빠져요.',
          confirmLabel: '빼기', cancelLabel: '그대로 두기',
          onConfirm: () => { setConfirm(null); drop(); },
        });
        return;
      }
      drop();
      return;
    }
    // 문자와 모바일 DM은 같은 날이면 문자 1통에 링크로 함께 나간다 — 한쪽을 켜면 다른 쪽 시점을 따른다
    const mirror = ch === 'dm' ? picked('sms') : ch === 'sms' ? picked('dm') : [];
    const add: Tp[] = mirror.length > 0
      ? mirror.map((t) => ({ channel: ch, timing: { ...t.timing } }))
      : [{ channel: ch, timing: ch === 'email' ? { anchor: 'before_start', offsetDays: 3 } : { anchor: 'start' } }];
    setTps((prev) => [...prev, ...(ch === 'email' ? add.slice(0, 1) : add)]);
    if ((ch === 'dm' || ch === 'email') && phone) setPane('materials');
  };
  const toggleTiming = (ch: PlannerChannelKey, anchor: Anchor) => {
    if (busy) return;
    setTps((prev) => {
      const mine = prev.filter((t) => t.channel === ch);
      const has = mine.some((t) => t.timing.anchor === anchor);
      // 메일은 한 행사에 한 번(재료 1벌 = 메일 1통) — 시점은 하나만 고른다
      if (ch === 'email') return [...prev.filter((t) => t.channel !== ch), { channel: ch, timing: anchor === 'before_start' ? { anchor, offsetDays: 3 } : { anchor } }];
      if (has) return mine.length <= 1 ? prev : prev.filter((t) => !(t.channel === ch && t.timing.anchor === anchor));
      return [...prev, { channel: ch, timing: anchor === 'before_start' ? { anchor, offsetDays: 3 } : { anchor } }];
    });
  };
  const setOffset = (ch: PlannerChannelKey, n: number) => setTps((prev) => prev.map((t) => (t.channel === ch && t.timing.anchor === 'before_start' ? { ...t, timing: { anchor: 'before_start', offsetDays: n } } : t)));

  // ── 재료 ────────────────────────────────────────────────────────
  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const fd = new FormData();
      files.forEach((f, i) => fd.append('images', f, f.name || `image_${i + 1}`));
      fd.append('read', '0');
      const r = await fetch('/api/event-campaigns/materials', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.success === false) throw new Error(String(d?.error || '사진을 올리지 못했어요.'));
      const got: BuildImageValue[] = (Array.isArray(d.images) ? d.images : []).map((im: any) => ({ url: String(im.url), width: im.width ?? null, height: im.height ?? null }));
      setImages((cur) => [...cur, ...got.filter((g) => !cur.some((x) => x.url === g.url))].slice(0, BUILD_CARD_IMAGES_MAX));
    } catch (e: any) {
      toast.error(e?.message || '사진을 올리지 못했어요.');
    } finally {
      setUploading(false);
    }
  };
  const addLibrary = (assets: PickedAsset[]) => {
    setImages((cur) => {
      const room = BUILD_CARD_IMAGES_MAX - cur.length;
      const add = assets.filter((a) => a.url && !cur.some((im) => im.url === a.url)).slice(0, Math.max(0, room)).map((a) => ({ url: a.url, width: null, height: null }));
      if (assets.length > add.length) toast.warning(`사진은 ${BUILD_CARD_IMAGES_MAX}장까지 넣을 수 있어요.`);
      return [...cur, ...add];
    });
    setLibraryOpen(false);
  };
  const toggleMall = (c: MallCandidate) => {
    const key = `${c.provider}:${c.code}`;
    setProducts((cur) => {
      if (cur.some((p) => p.key === key)) return cur.filter((p) => p.key !== key);
      if (cur.length >= AI_BUILD_PRODUCTS_MAX) { toast.warning(`상품은 ${AI_BUILD_PRODUCTS_MAX}개까지 담을 수 있어요.`); return cur; }
      return [...cur, { key, source: 'mall', provider: c.provider, code: c.code, name: c.name, price: c.price || null, salePrice: c.salePrice || null, discountRate: c.discountRate || null, url: c.productUrl, imageUrl: c.imageUrl }];
    });
  };

  // ── 저장 · 생성 ─────────────────────────────────────────────────
  const validate = (): string | null => {
    if (!title.trim()) return '행사명을 입력해 주세요.';
    if (!startsOn || !endsOn) return '행사 기간을 골라 주세요.';
    if (endsOn < startsOn) return '마지막 날이 시작일보다 빨라요.';
    if (tps.length === 0) return '보낼 채널을 하나 이상 골라 주세요.';
    return null;
  };
  const save = async (): Promise<string | null> => {
    const body = {
      title: title.trim(), startsOn, endsOn, benefitText: benefit.trim() || null,
      touchpoints: tps.map((t) => ({ channel: t.channel, timing: t.timing })),
      ...(materialsOn || hasMaterial(materials) ? { materials } : {}),
    };
    const id = savedId;
    const r = await plannerApi<{ id: string }>(id ? `/api/marketing-planner/events/${id}` : '/api/marketing-planner/events', { method: id ? 'PUT' : 'POST', body });
    if (!r.ok) { toast.error(plannerErrorText(r, '행사를 저장하지 못했어요.')); return null; }
    setSavedId(r.data.id);
    return r.data.id;
  };
  const runBuild = async (eventId: string, quotes: BuildQuote[], channels: Array<'dm' | 'email'>) => {
    const runs: Partial<Record<'dm' | 'email', ChannelRun>> = {};
    channels.forEach((c) => { runs[c] = 'wait'; });
    setPhase({ kind: 'building', runs: { ...runs }, error: null });
    let firstError: string | null = null;
    for (const ch of channels) {
      runs[ch] = 'busy';
      setPhase({ kind: 'building', runs: { ...runs }, error: firstError });
      const token = tokens.current[ch] || newAttemptToken();
      tokens.current[ch] = token;
      const q = quotes.find((x) => x.channel === ch);
      const r = await plannerApi(`/api/marketing-planner/events/${eventId}/build`, { body: { channel: ch, attemptToken: token, expectedTotal: q?.total ?? 0 } });
      if (r.ok) { runs[ch] = 'done'; delete tokens.current[ch]; }
      else { runs[ch] = 'fail'; firstError = firstError || plannerErrorText(r, `${PLANNER_CHANNEL[ch].label}을 만들지 못했어요.`); }
      setPhase({ kind: 'building', runs: { ...runs }, error: firstError });
    }
    if (!firstError) {
      toast.success('완성본을 만들었어요. 문자 문안까지 준비되면 확인 요청을 보내 드려요.');
      onSaved();
      onClose();
    }
  };
  const submit = async (withBuild: boolean) => {
    const err = validate();
    if (err) { toast.error(err); return; }
    if (withBuild && needBuild.length > 0 && !hasMaterial(materials)) { toast.error('사진·글·상품 중 하나는 넣어 주세요.'); return; }
    setPhase({ kind: 'saving' });
    const id = await save();
    if (!id) { setPhase({ kind: 'idle' }); return; }
    if (!withBuild || needBuild.length === 0) {
      toast.success(editing ? '고친 내용을 저장했어요.' : materialsOn ? '재료를 담았어요. 캘린더에서 [재료 넣기]로 이어서 만들 수 있어요.' : '행사를 담았어요. 문자 문안이 준비되면 확인 요청을 보내 드려요.');
      onSaved();
      onClose();
      return;
    }
    const q = await plannerApi<{ quotes: BuildQuote[]; total: number }>(`/api/marketing-planner/events/${id}/build-quote`, { body: { channels: needBuild } });
    if (!q.ok) { setPhase({ kind: 'idle' }); toast.error(plannerErrorText(q, '견적을 계산하지 못했어요.')); onSaved(); return; }
    const total = Number(q.data.total) || 0;
    if (total >= CREDIT_CONFIRM_MIN || total !== (draftQuote?.total ?? -1)) {
      setPhase({ kind: 'idle' });
      setCreditAsk({ eventId: id, quotes: q.data.quotes || [], total, channels: needBuild });
      return;
    }
    await runBuild(id, q.data.quotes || [], needBuild);
  };
  const retry = () => {
    if (phase.kind !== 'building' || !savedId) return;
    const failed = (Object.entries(phase.runs) as Array<['dm' | 'email', ChannelRun]>).filter(([, v]) => v === 'fail').map(([k]) => k);
    void (async () => {
      const q = await plannerApi<{ quotes: BuildQuote[]; total: number }>(`/api/marketing-planner/events/${savedId}/build-quote`, { body: { channels: failed } });
      if (!q.ok) { toast.error(plannerErrorText(q, '견적을 계산하지 못했어요.')); return; }
      await runBuild(savedId, q.data.quotes || [], failed);
    })();
  };
  const requestClose = () => {
    if (phase.kind === 'building' && Object.values(phase.runs).some((v) => v === 'busy' || v === 'wait')) { onSaved(); onClose(); return; }
    const dirty = !editing ? (title.trim() || hasMaterial(materials)) : materialsChanged;
    if (dirty && phase.kind === 'idle') {
      setConfirm({
        mode: 'warning', title: '담지 않고 닫을까요?', description: '입력한 행사와 재료는 저장되지 않아요.',
        confirmLabel: '닫기', cancelLabel: '계속 담기', onConfirm: () => { setConfirm(null); onClose(); },
      });
      return;
    }
    if (phase.kind === 'building') onSaved();
    onClose();
  };

  // ── 그리기 ──────────────────────────────────────────────────────
  const timingChip = (ch: PlannerChannelKey, anchor: Anchor) => {
    const on = picked(ch).some((t) => t.timing.anchor === anchor);
    const before = picked(ch).find((t) => t.timing.anchor === 'before_start');
    return (
      <span key={anchor} className="inline-flex items-center gap-1">
        <button type="button" role="checkbox" aria-checked={on} disabled={busy} onClick={() => toggleTiming(ch, anchor)}
          className={`inline-flex items-center gap-1 h-9 px-2.5 rounded-lg border text-[12.5px] font-semibold ${on ? 'border-indigo-300 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
          {on && <Check className="w-[13px] h-[13px]" />}{anchor === 'before_start' ? `시작 ${before?.timing.offsetDays || 3}일 전` : ANCHOR_LABEL[anchor]}
        </button>
        {anchor === 'before_start' && on && (
          <input type="number" min={1} max={30} value={before?.timing.offsetDays || 3} disabled={busy}
            onChange={(e) => setOffset(ch, Math.max(1, Math.min(30, Number(e.target.value) || 3)))}
            className="w-14 h-9 px-2 rounded-lg border border-slate-300 text-center text-[13px] tabular-nums" aria-label="시작 며칠 전" />
        )}
      </span>
    );
  };
  const channelRow = (ch: PlannerChannelKey) => {
    const a = avail(ch);
    const locked = !!a && !a.available;
    const on = picked(ch).length > 0;
    const dmShared = ch === 'dm' && picked('dm').some((d) => picked('sms').some((s) => s.timing.anchor === d.timing.anchor && (s.timing.offsetDays || 0) === (d.timing.offsetDays || 0)));
    return (
      <div key={ch} className={`px-3.5 py-3 ${locked ? 'bg-slate-50' : on && (ch === 'dm' || ch === 'email') ? 'bg-violet-50/70' : ''}`}>
        <button type="button" onClick={() => toggleChannel(ch)} disabled={locked || busy} className="w-full flex items-center gap-2.5 min-h-[32px] text-left disabled:cursor-not-allowed">
          <span className={`w-5 h-5 rounded-[6px] grid place-items-center shrink-0 ${locked ? 'bg-slate-100 border border-slate-300 text-slate-400' : on ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white'}`}>
            {locked ? <Lock className="w-[11px] h-[11px]" /> : on ? <Check className="w-[13px] h-[13px]" /> : null}
          </span>
          <span className={`text-[14px] font-semibold ${locked ? 'text-slate-500' : ''}`}>{PLANNER_CHANNEL[ch].label}</span>
          {ch === 'email' && !locked && <span className="text-[12px] text-slate-500">모바일 DM과 같은 재료로 만들어요</span>}
        </button>
        {locked && (
          <div className="mt-1.5 ml-[30px] text-[12.5px] text-slate-700">
            <p>{a?.reason}</p>
            {a?.settingsPath && (
              <button type="button" onClick={() => navigate(a.settingsPath!)} className="mt-1.5 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 inline-flex items-center gap-1">
                설정 열기<ArrowUpRight className="w-[13px] h-[13px]" />
              </button>
            )}
          </div>
        )}
        {on && !locked && (
          <div className="mt-2 ml-[30px] space-y-1.5">
            <div className="flex flex-wrap gap-1.5">{(['start', 'end', 'before_start'] as Anchor[]).map((an) => timingChip(ch, an))}</div>
            {ch === 'dm' && <p className="text-[12.5px] text-violet-900">{dmShared ? '문자와 같은 날이라 문자 1통에 링크로 함께 나가요' : picked('sms').length > 0 ? '문자와 다른 날이라 모바일 DM 링크를 실은 문자가 따로 나가요' : '모바일 DM 링크를 실은 문자로 나가요'}</p>}
            {ch === 'email' && <p className="text-[12px] text-slate-500">메일은 한 행사에 한 번 보내요</p>}
            {phone && (ch === 'dm' || ch === 'email') && (
              <button type="button" onClick={() => setPane('materials')} className="h-9 text-[12.5px] font-semibold text-violet-800 inline-flex items-center gap-1">재료 넣기<ArrowUpRight className="w-[13px] h-[13px]" /></button>
            )}
          </div>
        )}
      </div>
    );
  };

  const eventPane = (
    <div className={`space-y-4 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
      <label className="block">
        <span className="text-[12.5px] font-semibold text-slate-700">행사명</span>
        <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="예: 가을 신상 위크"
          className="mt-1.5 w-full h-11 px-3.5 rounded-xl bg-white border border-slate-300 text-[14px] outline-none focus:ring-2 focus:ring-indigo-500" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-[12.5px] font-semibold text-slate-700">시작일</span>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="mt-1.5 w-full h-11 px-3 rounded-xl bg-white border border-slate-300 text-[14px] tabular-nums" /></label>
        <label className="block"><span className="text-[12.5px] font-semibold text-slate-700">마지막 날</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="mt-1.5 w-full h-11 px-3 rounded-xl bg-white border border-slate-300 text-[14px] tabular-nums" /></label>
      </div>
      <div>
        <label className="block"><span className="text-[12.5px] font-semibold text-slate-700">혜택 문구</span>
          <textarea value={benefit} onChange={(e) => setBenefit(e.target.value.slice(0, 300))} rows={2} placeholder="예: 신상 3종 출시 기념, 전 품목 15% 할인"
            className="mt-1.5 w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-[14px] outline-none focus:ring-2 focus:ring-indigo-500 resize-none" /></label>
        <p className="text-[12px] text-slate-600 mt-1.5 inline-flex items-center gap-1"><Lock className="w-3 h-3 text-violet-600" />적은 글자 그대로 실려요 · AI가 바꾸거나 더하지 않아요</p>
      </div>
      <div>
        <p className="text-[12.5px] font-semibold text-slate-700 mb-1.5">채널과 보내는 날</p>
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-200 overflow-hidden">
          {availability.length === 0 ? <p className="px-3.5 py-4 text-[13px] text-slate-500">채널 상태를 불러오는 중이에요</p> : CHANNEL_ORDER.map(channelRow)}
        </div>
      </div>
      {firstSend && (
        <p className="text-[12.5px] text-slate-700 flex items-start gap-2 leading-snug">
          <CalendarClock className="w-[15px] h-[15px] text-slate-500 mt-0.5 shrink-0" />
          <span>첫 발송 <b className="tabular-nums">{plannerDay(firstSend)} 오전 8시</b> · 확인 요청은 <b className="tabular-nums">{reviewRequestDay(firstSend)}</b>쯤 휴대폰으로 가요</span>
        </p>
      )}
    </div>
  );

  const runs = phase.kind === 'building' ? phase.runs : {};
  const building = phase.kind === 'building' && Object.values(runs).some((v) => v === 'busy' || v === 'wait');
  const failed = phase.kind === 'building' && !building && Object.values(runs).some((v) => v === 'fail');
  const hero = images[0]?.url || null;

  const preview = (
    <div className="w-full">
      {phase.kind === 'building' && (
        <div className={`rounded-xl border px-3.5 py-3 mb-3 ${failed ? 'border-rose-200 bg-rose-50/60' : 'border-violet-200 bg-violet-50/70'}`} role="status" aria-live="polite">
          <p className={`text-[13px] font-semibold inline-flex items-center gap-1.5 ${failed ? 'text-rose-900' : 'text-violet-900'}`}>
            {failed ? <CircleX className="w-4 h-4 text-rose-600" /> : <LoaderCircle className="w-4 h-4 animate-spin text-violet-600" />}
            {failed ? '완성본을 다 만들지 못했어요' : '완성본을 만드는 중이에요'}
          </p>
          <ul className="text-[12.5px] space-y-1 mt-2">
            {(Object.keys(runs) as Array<'dm' | 'email'>).map((ch) => (
              <li key={ch} className="flex items-center justify-between">
                <span>{PLANNER_CHANNEL[ch].label}</span>
                <b className={runs[ch] === 'done' ? 'text-emerald-800' : runs[ch] === 'fail' ? 'text-rose-800' : runs[ch] === 'busy' ? 'text-violet-800' : 'text-slate-600 font-normal'}>
                  {runs[ch] === 'done' ? '만들어짐' : runs[ch] === 'fail' ? '다시 해 주세요' : runs[ch] === 'busy' ? '만드는 중 · 약 1분' : '차례 기다리는 중'}
                </b>
              </li>
            ))}
          </ul>
          {phase.error && <p className="text-[12.5px] text-rose-900 mt-2 leading-snug">{phase.error} 넣은 재료는 그대로 있어요.</p>}
          {building && <p className="text-[12px] text-slate-600 mt-2 leading-snug">창을 닫아도 계속 만들어요. 캘린더에 '제작 중'으로 보여요.</p>}
        </div>
      )}
      <p className="text-[13px] font-semibold">이렇게 시작해요</p>
      <p className="text-[12px] text-slate-500 mt-0.5">모바일 DM 첫 화면 미리보기</p>
      <div className="mt-2.5 rounded-[22px] border-[5px] border-slate-900 overflow-hidden bg-white">
        <div className="relative h-[172px] bg-slate-200">
          {hero && <img src={hero} alt="" className="absolute inset-0 w-full h-full object-cover" />}
          <div className="absolute inset-x-0 bottom-0 p-3 text-white bg-gradient-to-t from-black/60 to-transparent">
            <p className="text-[17px] font-bold leading-tight">{title || '행사명'}</p>
            <p className="text-[11.5px] tabular-nums opacity-90">{startsOn.replace(/-/g, '.').slice(5)} ~ {endsOn.replace(/-/g, '.').slice(5)}</p>
          </div>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[11px] font-semibold text-violet-700 inline-flex items-center gap-1"><Lock className="w-[11px] h-[11px]" />적은 그대로</p>
          <p className="text-[13px] font-semibold leading-snug mt-0.5">{benefit || '혜택 문구'}</p>
          {products.some((p) => p.imageUrl) && (
            <div className="grid grid-cols-3 gap-1.5 mt-2">
              {products.filter((p) => p.imageUrl).slice(0, 3).map((p) => <img key={p.key} src={p.imageUrl!} alt="" className="aspect-square w-full rounded-md object-cover" />)}
            </div>
          )}
        </div>
      </div>
      <p className="text-[12px] text-slate-600 mt-2.5 leading-snug">행사명·기간·혜택은 적은 글자 그대로 실려요. 나머지 쪽은 재료로 만들어요.</p>
    </div>
  );

  const materialsPane = (
    <div className={`space-y-4 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
      <PhotoTextBoard
        images={images} roles={roles} onAddFiles={(f) => { void addFiles(f); }} onRemoveImage={(url) => setImages((cur) => cur.filter((i) => i.url !== url))}
        onOpenLibrary={() => setLibraryOpen(true)} text={text} onText={(v) => setText(v.slice(0, 2000))} licensed={licensed} onLicensed={setLicensed}
        maxImages={BUILD_CARD_IMAGES_MAX} disabled={busy} uploading={uploading}
      />
      {mall.provider ? (
        <MallStrip providerLabel={mall.provider.label} candidates={mall.candidates} loading={mall.loading} error={mall.error}
          selectedKeys={new Set(products.map((p) => p.key))} onToggle={toggleMall} query={mallQ} onQuery={setMallQ} onSearch={() => mall.search(mallQ)}
          count={products.length} disabled={busy} />
      ) : mall.checked ? (
        <ManualProducts products={products} onChange={setProducts} max={AI_BUILD_PRODUCTS_MAX} onNotice={(m) => toast.warning(m)} onConnect={() => navigate('/cdp-settings')} disabled={busy} />
      ) : null}
      <p className="text-[10px] text-slate-500 italic">Data source: 상품 가격·링크는 만들 때 몰에서 다시 확인합니다. 금액은 서버 견적입니다.</p>
    </div>
  );

  const buildTotal = draftQuote?.total ?? null;
  const primaryLabel = needBuild.length > 0 && materialsOn
    ? (buildTotal !== null ? `담고 만들기 · ${won(buildTotal)}크레딧` : quoteError ? '담고 만들기' : '견적 계산 중')
    : editing ? '고친 내용 저장' : '캘린더에 담기';
  const primaryDisabled = busy || (needBuild.length > 0 && materialsOn && (!hasMaterial(materials) || buildTotal === null));

  const footer = (
    <div className={`${phone ? 'px-3 pt-2.5 pb-5' : 'px-6 py-3.5'} border-t border-slate-200 bg-white`}>
      {materialsOn && needBuild.length > 0 && (
        <p className={`text-[12.5px] text-slate-700 tabular-nums ${phone ? 'text-center mb-2' : 'mb-2.5'}`}>
          {buildTotal !== null
            ? <>누르면 <b className="text-slate-900">{won(buildTotal)}크레딧</b>이 빠져요{draftQuote && draftQuote.quotes.length > 0 ? ` (${draftQuote.quotes.map((q) => `${PLANNER_CHANNEL[q.channel].label} ${q.parts.map((p) => `${p.label} ${won(p.cost)}`).join(' · ')}`).join(' / ')})` : ''}</>
            : quoteError || '재료를 넣으면 만들 비용을 보여 드려요'}
          {balance !== null && <> · 보유 {won(balance)}</>}
          <span className="block text-slate-500">승인할 때 빠지는 금액은 확인 화면에서 보여 드려요</span>
        </p>
      )}
      <div className={`flex items-center gap-2 ${phone ? '' : 'justify-end'}`}>
        {failed ? (
          <button type="button" onClick={retry} className={`${phone ? 'flex-1 h-12' : 'h-11'} px-5 rounded-[10px] bg-amber-500 hover:bg-amber-400 text-amber-950 text-[14px] font-bold inline-flex items-center justify-center gap-2`}>
            <RotateCw className="w-4 h-4" />다시 만들기
          </button>
        ) : (
          <>
            {materialsOn && needBuild.length > 0 && !building && (
              <button type="button" disabled={busy} onClick={() => { void submit(false); }} className="h-12 md:h-11 px-3.5 rounded-[10px] border border-slate-300 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">재료만 담기</button>
            )}
            <button type="button" disabled={primaryDisabled} onClick={() => { void submit(true); }}
              className={`${phone ? 'flex-1 h-12' : 'h-11'} px-5 rounded-[10px] text-[14px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60 ${materialsOn && needBuild.length > 0 ? 'bg-amber-500 hover:bg-amber-400 text-amber-950' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
              {building || phase.kind === 'saving' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : materialsOn && needBuild.length > 0 ? <WandSparkles className="w-4 h-4" /> : <Check className="w-4 h-4" />}
              {building ? '만드는 중' : phase.kind === 'saving' ? '저장하는 중' : primaryLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );

  const headerTitle = editing ? '행사 고치기' : '행사 담기';
  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-[2px] flex items-end md:items-center justify-center md:p-6" role="dialog" aria-modal="true" aria-label={headerTitle}>
        <div className={`bg-white md:border md:border-slate-200 md:rounded-2xl shadow-2xl w-full flex flex-col overflow-hidden ${phone ? 'h-full' : materialsOn ? 'max-w-[1180px] max-h-[92vh]' : 'max-w-xl max-h-[92vh]'}`}>
          <div className="px-4 md:px-6 h-14 md:h-16 border-b border-slate-200 flex items-center gap-2 shrink-0">
            {phone && pane === 'materials' ? (
              <>
                <button type="button" onClick={() => setPane('event')} className="h-11 px-1 inline-flex items-center gap-1 text-[13.5px] font-semibold text-slate-700"><ArrowLeft className="w-[17px] h-[17px]" />행사로</button>
                <span className="text-[16px] font-bold ml-1">재료 넣기</span>
              </>
            ) : (
              <>
                <h3 className="text-[17px] font-bold tracking-[-0.01em]">{headerTitle}</h3>
                {!phone && <span className="text-[13px] text-slate-500">모바일 DM·메일은 재료를 넣으면 완성본을 만들어 드려요</span>}
              </>
            )}
            <button type="button" onClick={requestClose} aria-label="닫기" className="ml-auto w-10 h-10 rounded-lg text-slate-500 hover:bg-slate-100 grid place-items-center"><X className="w-[18px] h-[18px]" /></button>
          </div>
          {phone ? (
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {pane === 'event' ? eventPane : <div className="space-y-4">{phase.kind === 'building' && preview}{materialsPane}</div>}
            </div>
          ) : materialsOn ? (
            <div className="grid grid-cols-[384px_minmax(0,1fr)] min-h-0 flex-1">
              <div className="border-r border-slate-200 bg-slate-50 p-6 overflow-y-auto">{eventPane}</div>
              <div className="overflow-y-auto p-6 grid grid-cols-[minmax(0,1fr)_248px] gap-7 items-start">
                <div>
                  <div className="flex items-baseline gap-2 mb-4"><h4 className="text-[16px] font-bold inline-flex items-center gap-1.5"><WandSparkles className="w-4 h-4 text-violet-600" />재료</h4><span className="text-[12.5px] text-slate-500">{buildPicked.length > 1 ? '모바일 DM과 메일이 같은 재료로 만들어져요' : `${PLANNER_CHANNEL[buildPicked[0]].label}을 이 재료로 만들어요`}</span></div>
                  {materialsPane}
                </div>
                <div className="sticky top-0">{preview}</div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6">{eventPane}</div>
          )}
          {footer}
        </div>
      </div>
      <AssetLibraryPickerModal open={libraryOpen} onClose={() => setLibraryOpen(false)} onPick={(a) => addLibrary([a])} multiSelect onPickMany={addLibrary} />
      <CreditConfirmModal
        open={!!creditAsk}
        source="dm-ai-generate"
        costOverride={creditAsk?.total}
        description={creditAsk ? `${creditAsk.channels.map((c) => PLANNER_CHANNEL[c].label).join('·')} 완성본을 만들어요.${draftQuote && draftQuote.total !== creditAsk.total ? ' 저장한 내용으로 금액을 다시 계산했어요.' : ''}` : undefined}
        onConfirm={() => { const a = creditAsk; setCreditAsk(null); if (a) void runBuild(a.eventId, a.quotes, a.channels); }}
        onCancel={() => { setCreditAsk(null); toast.info('재료는 담아 뒀어요. 캘린더에서 [재료 넣기]로 이어서 만들 수 있어요.'); onSaved(); onClose(); }}
      />
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

/** 마감 표기용 — 확인 요청이 가는 날(첫 발송 3일 전) */
export function reviewRequestDay(firstSend: string): string {
  return plannerDay(new Date(Date.parse(`${firstSend}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10));
}
