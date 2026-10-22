/**
 * PlannerEventModal — 행사 담기 창 (★ 2026-10-18 v2-1 개편 · 설계서 docs/2026-10-18-planner-v2-design.md §3-5 · 옛 = 2026-10-04 §5-2)
 *
 * 창 하나 판 둘: 판1 = 행사 이름 · 기간 · 템플릿 4종(서버가 진짜 조립으로 그린 예시) · 행사 페이지 주소 · 「템플릿 없이 담기」 /
 * 판2 = 혜택 · 고른 템플릿이 쓰는 재료만 · 보내는 순서 · 돈 3줄. PC 1200px 이상 = 두 판 나란히 · 그 밖 = 판1 → 판2 차례.
 * 템플릿을 고르면 보내는 순서가 기본값으로 채워진다(planner-preset · 채널이나 날을 손대면 그 뒤로는 그대로 둔다).
 * 틀 = 공용 JourneyModalShell(포커스 가둠 · Esc = 닫기 확인). 손그림 미리보기는 지웠다(예시 = 서버 렌더 · 결과 = 확인 화면 실물).
 * 재료 부품 = components/make/MakeInputs 그대로(1017 한 줄 단계 창 부품은 건드리지 않는다).
 *
 * 돈: 버튼 금액 = 서버 견적(`/build-quote`) · 템플릿의 빠진 재료도 그 견적의 관문(gate)이 정한다 ·
 * 저장 뒤 행사 견적이 그 금액과 다르거나 20크레딧 이상이면 금액 확인 창 1회(CreditConfirmModal) · 생성은 채널마다 1요청(같은 시도 토큰 재시도 = 재차감 0).
 * 행사명 · 기간 · 혜택은 서버가 행사 행 원본으로 싣는다(AI 가 바꾸지 않는다).
 * ★ 2026-10-18 입력 축(§3-6) — 한 줄을 읽은 값은 판1 「이렇게 알아들었어요」 줄마다 사람이 [맞아요]를 눌러야 칸에 들어간다(기본값 아님) ·
 *   받는 사람 = [상품을 산 고객][전체 고객] 미리 고르지 않음(스위치 열린 회사) · 판2 대상 상품 + 「언제 산」(PlannerAudiencePicker).
 * ⛔ native dialog 0 · 모델명 0 · 줄표 0.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarClock, Check, ChevronDown, CircleX, FolderOpen, ImageIcon, Layers, LoaderCircle, Lock, Plus, RotateCw, Rows3, ShoppingBag, WandSparkles, X } from 'lucide-react';
import { Field, ManualProducts, MallStrip, PhotoTextBoard, Thumb, useMallCandidates, type MallCandidate } from '../make/MakeInputs';
import AssetLibraryPickerModal, { type PickedAsset } from '../assets/AssetLibraryPickerModal';
import CreditConfirmModal from '../credit/CreditConfirmModal';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import JourneyModalShell from '../journey/JourneyModalShell';
import ZoneSegmented from '../zone/ZoneSegmented';
import { LineTemplateExampleView, LineTemplateZoom } from '../zone/LineTemplatePick';
import { BUILD_CARD_IMAGES_MAX } from '../ai-build/BuildCardsInput';
import { AI_BUILD_PRODUCTS_MAX } from '../ai-build/ProductPickList';
import { newAttemptToken, type BuildImageRole, type BuildImageValue, type BuildProductValue } from '../../utils/ai-build';
import { fetchLineTemplates, normalizeLineLink, type LineLayout, type LineTemplateId, type LineTemplateInfo, type LineCompositionId } from '../../utils/one-line';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useToast } from '../ToastProvider';
import { PLANNER_CHANNEL, PLANNER_SEND_KIND, plannerDay, type PlannerSendKind } from '../../constants/planner-status';
import { plannerMinSendDate, plannerPreset } from './planner-preset';
import PlannerAudiencePicker, { buyerAudienceOf, type BuyerDraft } from './PlannerAudiencePicker';
import {
  plannerApi, plannerErrorText, won,
  type Anchor, type Availability, type BuildQuote, type CalendarEvent, type PlannerAudience, type PlannerChannelKey, type PlannerLineRead, type PlannerMaterials, type TimingRule,
} from './planner-api';

/** 금액 확인 창 기준(크레딧 확인 모달 상시 기준 20 · 그 밑은 버튼 금액으로 갈음) */
const CREDIT_CONFIRM_MIN = 20;
const BUILD_CHANNELS: Array<'dm' | 'email'> = ['dm', 'email'];
const CHANNEL_ORDER: PlannerChannelKey[] = ['sms', 'dm', 'email'];
/** 서버 관문(plannerTemplateMissing)의 빠진 재료 키 → 화면 말 */
const MISSING_TEXT: Record<string, string> = { link: '행사 페이지 주소', products: '상품', benefit: '혜택 문구', product_photos: '사진 있는 몰 상품', photos: '사진(첫 화면 말고 더)' };

interface Tp { channel: PlannerChannelKey; timing: TimingRule }
type ChannelRun = 'wait' | 'busy' | 'done' | 'fail';
type Phase = { kind: 'idle' } | { kind: 'saving' } | { kind: 'building'; runs: Partial<Record<'dm' | 'email', ChannelRun>>; error: string | null };
/** ★ 2026-10-22 플래너 완성본 틀 = 한줄 CT 구성 5종(옛 4종 저장분도 그대로 읽는다) */
type Tpl = { id: LineTemplateId | LineCompositionId; layout: LineLayout };

const ANCHOR_LABEL: Record<Anchor, string> = { start: '행사 시작일', end: '마지막 날', before_start: '시작 전' };

/** (순수) 시점 하나의 발송일(서버 computeTouchpointDate와 같은 규칙) */
function sendDateOf(timing: TimingRule, startsOn: string, endsOn: string): string | null {
  if (timing.on && /^\d{4}-\d{2}-\d{2}$/.test(timing.on)) return timing.on; // ★ 2026-10-18 미룬 날(서버만 쓴다)
  if (timing.anchor === 'end') return /^\d{4}-\d{2}-\d{2}$/.test(endsOn) ? endsOn : null;
  if (timing.anchor === 'before_start') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return null;
    const d = new Date(`${startsOn}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (timing.offsetDays || 3));
    return d.toISOString().slice(0, 10);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(startsOn) ? startsOn : null;
}

/** (순수) 보내는 순서 — 날짜별 한 덩어리(같은 날 문자+DM = 1통 · 메일은 따로) */
function sendDaysOf(tps: Tp[], startsOn: string, endsOn: string): Array<{ date: string; kinds: PlannerSendKind[] }> {
  const byDate = new Map<string, Set<PlannerChannelKey>>();
  for (const t of tps) {
    const d = sendDateOf(t.timing, startsOn, endsOn);
    if (!d) continue;
    byDate.set(d, (byDate.get(d) || new Set()).add(t.channel));
  }
  return Array.from(byDate.keys()).sort().map((date) => {
    const chs = byDate.get(date)!;
    const kinds: PlannerSendKind[] = [];
    if (chs.has('email')) kinds.push('email');
    if (chs.has('sms') || chs.has('dm')) kinds.push(chs.has('sms') && chs.has('dm') ? 'smsdm' : chs.has('sms') ? 'sms' : 'dm');
    return { date, kinds };
  });
}

const productKey = (p: { source: string; provider: string | null; code: string | null; name: string }) =>
  p.source === 'mall' ? `${p.provider}:${p.code}` : `manual:${p.name.toLowerCase().replace(/\s+/g, '')}`;

function toMaterials(images: BuildImageValue[], text: string, licensed: boolean, products: BuildProductValue[], tpl: Tpl | null, link: string | null): PlannerMaterials {
  return {
    images: images.map((im) => ({ url: im.url, width: im.width ?? null, height: im.height ?? null })),
    text,
    licensed: licensed && text.trim().length > 0,
    products: products.filter((p) => p.source !== 'site').map((p) => ({
      source: p.source === 'mall' ? 'mall' : 'manual', provider: p.provider, code: p.code, name: p.name,
      price: p.price, salePrice: p.salePrice, discountRate: p.discountRate, url: p.url, imageUrl: p.imageUrl,
    })),
    ...(tpl ? { template: tpl } : {}),
    ...(link ? { link } : {}),
  };
}
const materialsKey = (m: PlannerMaterials | null) => JSON.stringify(m ? [
  m.images.map((i) => i.url), m.text, m.licensed, m.products.map((p) => [p.source, p.provider, p.code, p.name, p.price, p.salePrice]),
  m.template?.id ?? null, m.template?.layout ?? null, m.link ?? null,
] : null);
const hasMaterial = (m: PlannerMaterials) => m.images.length > 0 || m.text.trim().length > 0 || m.products.length > 0;

/** 템플릿이 쓰는 재료 한 줄(서버 원장 needs 그대로 · 플래너 = 행사 페이지 주소 꼭 · 기간은 행사 기간) */
function needsChips(t: LineTemplateInfo): string[] {
  const out = ['행사 페이지 주소(꼭)'];
  if (t.needs.benefit === 'required') out.push('혜택(꼭)');
  else if (t.needs.benefit === 'optional') out.push('혜택(있으면)');
  out.push(t.needs.products.min > 0 ? `상품 ${t.needs.products.min}개 이상` : '상품(있으면)');
  if (t.needs.hero === 'ask') out.push('표지 사진(있으면)');
  return out;
}

const NeedBadge = ({ must }: { must: boolean }) => (
  <span className={`text-[11px] font-semibold rounded-md px-1.5 py-px border ${must ? 'text-amber-800 border-amber-200 bg-amber-50' : 'text-slate-400 border-slate-200'}`}>{must ? '꼭' : '있으면'}</span>
);

type ReadRow = 'title' | 'period' | 'benefit' | 'audience' | 'channels';

export default function PlannerEventModal({ month, initialDate, initialTemplate = null, lineEnabled = false, lineRead = null, editing, availability, balance, onClose, onSaved }: {
  month: string;
  /** ★ 2026-10-18 한 줄 입력 · 상품 구매자 대상이 열린 회사(서버 캘린더 lineEnabled) */
  lineEnabled?: boolean;
  /** ★ 2026-10-18 명령 카드 한 줄을 읽은 값(전부 제안 · 줄마다 확인) */
  lineRead?: PlannerLineRead | null;
  initialDate?: string | null;
  /** 캘린더 시작 카드에서 연 템플릿(판1 에 골라진 채로 연다) */
  initialTemplate?: LineTemplateId | LineCompositionId | null;
  editing: CalendarEvent | null;
  availability: Availability[];
  balance: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const phone = useMediaQuery('(max-width: 767px)');
  const wide = useMediaQuery('(min-width: 1200px)');

  const [title, setTitle] = useState(editing?.title || '');
  const [startsOn, setStartsOn] = useState(editing?.startsOn || initialDate || `${month}-01`);
  const [endsOn, setEndsOn] = useState(editing?.endsOn || initialDate || `${month}-01`);
  const [benefit, setBenefit] = useState(editing?.benefitText || '');
  const [tps, setTps] = useState<Tp[]>(() => (editing?.touchpoints || [])
    .filter((t) => t.status !== 'skipped' && CHANNEL_ORDER.includes(t.channel))
    .map((t) => ({ channel: t.channel, timing: { anchor: t.timing.anchor, ...(t.timing.anchor === 'before_start' ? { offsetDays: t.timing.offsetDays || 3 } : {}) } })));
  // 보내는 순서를 사람이 손댔는가 — 손대면 템플릿 · 기간이 바뀌어도 기본값으로 덮지 않는다(고치기 = 처음부터 손댄 것)
  const touched = useRef(!!editing);

  const m0 = editing?.materials || null;
  const [tpl, setTpl] = useState<Tpl | null>(() => (editing ? m0?.template ?? null : initialTemplate ? { id: initialTemplate, layout: 'slides' } : null));
  const choseTpl = useRef(!!editing || !!initialTemplate);
  const [templates, setTemplates] = useState<LineTemplateInfo[] | null | undefined>(undefined);
  const [link, setLink] = useState(m0?.link || '');
  const [exChannel, setExChannel] = useState<'dm' | 'email'>('dm');
  const [exampleOpen, setExampleOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
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
  const heroFileRef = useRef<HTMLInputElement | null>(null);
  const minDate = useMemo(() => plannerMinSendDate(new Date()), []);

  // ── ★ 2026-10-18 받는 사람 · 한 줄 확인 ──────────────────────────────
  const a0 = editing?.audience ?? null;
  const [audKind, setAudKind] = useState<'all' | 'product_buyers' | null>(() => (editing ? (a0?.kind ?? 'all') : lineEnabled ? null : 'all'));
  const [buyer, setBuyer] = useState<BuyerDraft>(() => (a0 && a0.kind === 'product_buyers'
    ? { door: a0.door, keys: a0.keys, names: a0.names, sinceDays: null, kept: { since: a0.since } }
    : { door: null, keys: [], names: [], sinceDays: null }));
  const readAud = lineRead?.audience ?? null;
  const buyerTerms = readAud && readAud.kind === 'product_buyers' ? readAud.terms : [];
  const readRows: ReadRow[] = lineRead ? ([
    lineRead.title ? 'title' : null,
    lineRead.period || lineRead.periodNote ? 'period' : null,
    lineRead.benefit ? 'benefit' : null,
    readAud ? 'audience' : null,
    lineRead.channels.length > 0 ? 'channels' : null,
  ].filter(Boolean) as ReadRow[]) : [];
  const [readDone, setReadDone] = useState<Partial<Record<ReadRow, 'ok' | 'edit'>>>({});
  const readPending = readRows.filter((r) => !readDone[r]);
  const audience: PlannerAudience | null = audKind === 'all' ? { kind: 'all' } : audKind === 'product_buyers' ? buyerAudienceOf(buyer) : null;

  // 템플릿 목록(서버 원장 · 회사 스위치 밖 = null → 옛 흐름 그대로) · 새 행사는 첫 템플릿이 골라진 채로 연다
  useEffect(() => {
    let alive = true;
    void fetchLineTemplates('compositions').then((list) => {
      if (!alive) return;
      setTemplates(list && list.length > 0 ? list : null);
      if (list && list.length > 0 && !choseTpl.current) setTpl({ id: list[0].id, layout: 'slides' });
    });
    return () => { alive = false; };
  }, []);

  const avail = (ch: PlannerChannelKey) => availability.find((a) => a.channel === ch);
  const picked = (ch: PlannerChannelKey) => tps.filter((t) => t.channel === ch);
  const buildPicked = BUILD_CHANNELS.filter((ch) => picked(ch).length > 0);
  const materialsOn = buildPicked.length > 0;
  const tplInfo = tpl ? templates?.find((x) => x.id === tpl.id) ?? null : null;
  const linkNorm = tpl ? normalizeLineLink(link) : null;
  const linkBad = !!tpl && link.trim() !== '' && !linkNorm;
  const imageMax = tpl ? 1 : BUILD_CARD_IMAGES_MAX;
  const productsMax = tplInfo && buildPicked.length > 0 ? Math.min(...buildPicked.map((ch) => tplInfo.needs.products.max[ch])) : AI_BUILD_PRODUCTS_MAX;
  const materials = useMemo(
    () => toMaterials(tpl ? images.slice(0, 1) : images, tpl ? '' : text, licensed, products, tpl, linkNorm),
    [images, text, licensed, products, tpl, linkNorm],
  );
  const materialsChanged = materialsKey(materials) !== materialsKey(m0);
  // 행사명 · 기간 · 혜택도 완성본에 그대로 실린다 — 바꾸면 이미 만든 완성본은 옛 내용(서버 완성본 지문과 같은 규칙)
  const factsChanged = !!editing && (title.trim() !== editing.title || startsOn !== editing.startsOn || endsOn !== editing.endsOn || benefit.trim() !== (editing.benefitText || ''));
  // 다시 만들어야 하는 채널 = 새로 고른 채널 · 완성본이 없거나 낡은 채널 · 재료 · 템플릿 · 행사 사실을 바꾼 경우 전부
  const needBuild = buildPicked.filter((ch) => !editing || materialsChanged || factsChanged || editing.staleChannels.includes(ch)
    || !editing.touchpoints.some((t) => t.channel === ch && t.status !== 'skipped'));
  const busy = phase.kind !== 'idle';
  const mall = useMallCandidates(materialsOn);
  const [mallQ, setMallQ] = useState('');
  const roles = useMemo(() => new Map<string, BuildImageRole>(), []);
  const sendDays = sendDaysOf(tps, startsOn, endsOn);
  const firstSend = sendDays[0]?.date || null;
  const sendCount = sendDays.reduce((n, d) => n + d.kinds.length, 0);

  // 템플릿 기본 순서 — 사람이 손대기 전까지는 템플릿 · 기간 · 채널 상태를 따라 다시 채운다
  useEffect(() => {
    if (touched.current || !tpl) return;
    setTps(plannerPreset(tpl.id, startsOn, endsOn, minDate, (ch) => { const a = availability.find((x) => x.channel === ch); return !a || a.available; }));
  }, [tpl?.id, startsOn, endsOn, availability, minDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // 담기 전 서버 견적(버튼 금액 · 템플릿이면 빠진 재료 관문까지) — 재료 · 행사가 바뀌면 다시 묻는다
  useEffect(() => {
    if (!materialsOn || needBuild.length === 0 || (!tpl && !hasMaterial(materials))) { setDraftQuote(null); setQuoteError(null); return; }
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

  const gateMissing = tpl && draftQuote
    ? Array.from(new Set(draftQuote.quotes.flatMap((q) => (q.gate.ok ? [] : q.gate.missing || []))))
    : [];

  // ── 템플릿 ───────────────────────────────────────────────────────
  const chooseTpl = (id: LineTemplateId | LineCompositionId | null) => {
    if (busy) return;
    choseTpl.current = true;
    setTpl((cur) => (id ? { id, layout: cur?.layout || 'slides' } : null));
  };

  // ── 채널 · 시점 ─────────────────────────────────────────────────
  const toggleChannel = (ch: PlannerChannelKey) => {
    const a = avail(ch);
    if (busy || (a && !a.available)) return;
    touched.current = true;
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
      : [{ channel: ch, timing: ch === 'email' && !tpl ? { anchor: 'before_start', offsetDays: 3 } : { anchor: 'start' } }];
    setTps((prev) => [...prev, ...(ch === 'email' ? add.slice(0, 1) : add)]);
  };
  const toggleTiming = (ch: PlannerChannelKey, anchor: Anchor) => {
    if (busy) return;
    touched.current = true;
    setTps((prev) => {
      const mine = prev.filter((t) => t.channel === ch);
      const has = mine.some((t) => t.timing.anchor === anchor);
      // 메일은 한 행사에 한 번(재료 1벌 = 메일 1통) — 시점은 하나만 고른다
      if (ch === 'email') return [...prev.filter((t) => t.channel !== ch), { channel: ch, timing: anchor === 'before_start' ? { anchor, offsetDays: 3 } : { anchor } }];
      if (has) return mine.length <= 1 ? prev : prev.filter((t) => !(t.channel === ch && t.timing.anchor === anchor));
      return [...prev, { channel: ch, timing: anchor === 'before_start' ? { anchor, offsetDays: 3 } : { anchor } }];
    });
  };
  const setOffset = (ch: PlannerChannelKey, n: number) => {
    touched.current = true;
    setTps((prev) => prev.map((t) => (t.channel === ch && t.timing.anchor === 'before_start' ? { ...t, timing: { anchor: 'before_start', offsetDays: n } } : t)));
  };

  // ── 재료 ────────────────────────────────────────────────────────
  // 템플릿 = 표지 1장(새로 고르면 바꾼다) · 템플릿 없이 = 여러 장 덧붙이기
  const putImages = (got: BuildImageValue[]) => setImages((cur) => (imageMax === 1
    ? (got.length > 0 ? got.slice(0, 1) : cur)
    : [...cur, ...got.filter((g) => !cur.some((x) => x.url === g.url))].slice(0, BUILD_CARD_IMAGES_MAX)));
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
      putImages((Array.isArray(d.images) ? d.images : []).map((im: any) => ({ url: String(im.url), width: im.width ?? null, height: im.height ?? null })));
    } catch (e: any) {
      toast.error(e?.message || '사진을 올리지 못했어요.');
    } finally {
      setUploading(false);
    }
  };
  const addLibrary = (assets: PickedAsset[]) => {
    const got = assets.filter((a) => a.url).map((a) => ({ url: a.url, width: null, height: null }));
    if (imageMax > 1 && images.length + got.length > BUILD_CARD_IMAGES_MAX) toast.warning(`사진은 ${BUILD_CARD_IMAGES_MAX}장까지 넣을 수 있어요.`);
    putImages(got);
    setLibraryOpen(false);
  };
  const toggleMall = (c: MallCandidate) => {
    const key = `${c.provider}:${c.code}`;
    setProducts((cur) => {
      if (cur.some((p) => p.key === key)) return cur.filter((p) => p.key !== key);
      if (cur.length >= productsMax) { toast.warning(`상품은 ${productsMax}개까지 담을 수 있어요.`); return cur; }
      return [...cur, { key, source: 'mall', provider: c.provider, code: c.code, name: c.name, price: c.price || null, salePrice: c.salePrice || null, discountRate: c.discountRate || null, url: c.productUrl, imageUrl: c.imageUrl }];
    });
  };

  // ── 저장 · 생성 ─────────────────────────────────────────────────
  const validateEvent = (): string | null => {
    if (readPending.length > 0) return '알아들은 내용을 줄마다 확인해 주세요.';
    if (!audKind) return '받는 사람을 골라 주세요.';
    if (!title.trim()) return '행사 이름을 입력해 주세요.';
    if (!startsOn || !endsOn) return '행사 기간을 골라 주세요.';
    if (endsOn < startsOn) return '마지막 날이 시작일보다 빨라요.';
    return null;
  };
  const validate = (): string | null => validateEvent()
    || (audKind === 'product_buyers' && !audience ? '대상 상품과 언제 산 고객인지 골라 주세요.' : null)
    || (tps.length === 0 ? '보낼 채널을 하나 이상 골라 주세요.' : null);
  const save = async (): Promise<string | null> => {
    const body = {
      title: title.trim(), startsOn, endsOn, benefitText: benefit.trim() || null,
      touchpoints: tps.map((t) => ({ channel: t.channel, timing: t.timing })),
      ...(materialsOn || hasMaterial(materials) ? { materials } : {}),
      audience: audience || { kind: 'all' },
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
    if (withBuild && needBuild.length > 0) {
      if (tpl && (linkBad || gateMissing.length > 0)) { toast.error(linkBad ? '행사 페이지 주소가 맞지 않아요. http로 시작하는 주소를 넣어 주세요.' : `${gateMissing.map((k) => MISSING_TEXT[k] || k).join(' · ')}을 넣어 주세요.`); return; }
      if (!tpl && !hasMaterial(materials)) { toast.error('사진·글·상품 중 하나는 넣어 주세요.'); return; }
    }
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
    // 위에 뜬 창(사진 고르기 · 금액 확인 · 확인 창 · 예시 크게 보기)이 있으면 그 창이 먼저다
    if (libraryOpen || creditAsk || confirm || zoom) return;
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
  const goNext = () => {
    const err = validateEvent();
    if (err) { toast.error(err); return; }
    setPane('materials');
  };

  // ── 판1 · 행사와 템플릿 ─────────────────────────────────────────
  const exampleW = wide ? 216 : Math.max(200, Math.min(260, (typeof window !== 'undefined' ? window.innerWidth : 375) - 120));
  const example = tpl && tplInfo ? (
    <div className="flex flex-col items-center gap-2.5">
      <LineTemplateExampleView id={tpl.id} channel={exChannel} layout={tpl.layout} width={exampleW} onZoom={() => setZoom(true)} />
      <ZoneSegmented<'dm' | 'email'> ariaLabel="예시 채널" value={exChannel} onChange={setExChannel}
        items={[{ id: 'dm', label: '모바일 DM' }, { id: 'email', label: '메일' }]} />
    </div>
  ) : null;

  const templateBlock = templates === undefined ? (
    <div className="h-[132px] rounded-xl bg-slate-100 animate-pulse" aria-hidden="true" />
  ) : templates === null ? (
    tpl ? (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12.5px] text-amber-900">
        <p>템플릿 목록을 불러오지 못했어요.</p>
        <button type="button" onClick={() => chooseTpl(null)} className="mt-2 h-9 px-3 rounded-lg border border-amber-300 bg-white text-[12.5px] font-semibold text-amber-900">템플릿 없이 담기</button>
      </div>
    ) : null
  ) : (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <p className="text-[12.5px] font-semibold text-slate-700">템플릿</p>
        <span className="text-[12px] text-slate-500">예시를 보고 골라요 · 우리 회사 재료로 채워요</span>
      </div>
      <div className={wide ? 'flex gap-5 items-start' : ''}>
        {wide && example}
        <div className="min-w-0 flex-1">
          <div className="grid grid-cols-2 gap-2">
            {templates.map((x) => {
              const on = tpl?.id === x.id;
              return (
                <button key={x.id} type="button" aria-pressed={on} disabled={busy} onClick={() => chooseTpl(x.id)}
                  className={`text-left rounded-xl p-3 border-2 transition-colors ${on ? 'border-violet-500 bg-violet-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded-full shrink-0" style={{ background: `linear-gradient(135deg, ${x.design.primary}, ${x.design.accent})` }} />
                    <span className="text-[13.5px] font-bold text-slate-900 truncate">{x.label}</span>
                    {on && <Check className="ml-auto w-4 h-4 text-violet-700 shrink-0" />}
                  </span>
                  <span className="block mt-1 text-[12px] text-slate-500 line-clamp-2 leading-snug">{x.desc}</span>
                </button>
              );
            })}
          </div>
          <button type="button" aria-pressed={!tpl} disabled={busy} onClick={() => chooseTpl(null)}
            className={`mt-2 w-full h-10 px-3 rounded-xl border text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5 ${!tpl ? 'border-slate-400 bg-slate-100 text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {!tpl && <Check className="w-3.5 h-3.5" />}템플릿 없이 담기<span className="font-normal text-slate-500">· 넣은 사진·글로 쪽을 짜요</span>
          </button>
          {tplInfo && (
            <>
              <div className="mt-3">
                <ZoneSegmented<LineLayout> ariaLabel="모바일 DM 배치" value={tpl!.layout} onChange={(l) => setTpl((cur) => (cur ? { ...cur, layout: l } : cur))}
                  items={[{ id: 'slides', label: '슬라이드형', icon: Layers }, { id: 'page', label: '한 페이지형', icon: Rows3 }]} />
                <p className="mt-1 text-[12px] text-slate-500">모바일 DM {tpl!.layout === 'slides' ? '넘겨 보는 장마다 화면을 꽉 채워요' : '한 장에 위에서 아래로 이어서 보여요'} · 메일은 한 페이지예요</p>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {needsChips(tplInfo).map((n) => <span key={n} className="h-7 px-2.5 rounded-lg bg-slate-100 text-[12px] text-slate-700 inline-flex items-center whitespace-nowrap">{n}</span>)}
              </div>
              {!wide && (
                <>
                  <button type="button" onClick={() => setExampleOpen((v) => !v)} className="mt-2 h-10 text-[12.5px] font-semibold text-violet-800 inline-flex items-center gap-1">
                    예시 {exampleOpen ? '접기' : '보기'}<ChevronDown className={`w-4 h-4 transition-transform ${exampleOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {exampleOpen && <div className="mt-1">{example}</div>}
                </>
              )}
              <p className="mt-2 text-[11.5px] text-slate-400">예시 · 가상 브랜드 「{tplInfo.example.company}」 · 실제 결과는 우리 회사 재료로 채워요</p>
            </>
          )}
        </div>
      </div>
    </section>
  );

  const orderPreview = sendDays.length > 0 ? (
    <ol className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
      {sendDays.map((d, i) => (
        <li key={d.date} className="px-3.5 py-2.5 flex items-center gap-2.5 text-[13px]">
          <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[12px] font-bold grid place-items-center shrink-0 tabular-nums">{i + 1}</span>
          <b className="tabular-nums">{plannerDay(d.date)}</b>
          <span className="text-slate-600">{d.kinds.map((k) => PLANNER_SEND_KIND[k].label).join(' · ')}</span>
        </li>
      ))}
    </ol>
  ) : null;

  const markRead = (row: ReadRow, how: 'ok' | 'edit') => {
    setReadDone((cur) => ({ ...cur, [row]: how }));
    if (how !== 'ok' || !lineRead) return;
    if (row === 'title' && lineRead.title) setTitle(lineRead.title);
    if (row === 'period' && lineRead.period) { setStartsOn(lineRead.period.startsOn); setEndsOn(lineRead.period.endsOn); }
    if (row === 'benefit' && lineRead.benefit) setBenefit(lineRead.benefit);
    if (row === 'audience' && readAud && readAud.kind !== 'unread') setAudKind(readAud.kind === 'all' ? 'all' : 'product_buyers');
    if (row === 'channels') {
      touched.current = true;
      const open = (ch: PlannerChannelKey) => { const a = avail(ch); return !a || a.available; };
      setTps(lineRead.channels.filter(open).map((ch) => ({ channel: ch, timing: { anchor: 'start' } })));
    }
  };
  const readValue = (row: ReadRow): { text: string; canOk: boolean } => {
    if (!lineRead) return { text: '', canOk: false };
    if (row === 'title') return { text: lineRead.title || '', canOk: true };
    if (row === 'period') return lineRead.period
      ? { text: `${plannerDay(lineRead.period.startsOn)} ~ ${plannerDay(lineRead.period.endsOn)}`, canOk: true }
      : { text: lineRead.periodNote || '', canOk: false };
    if (row === 'benefit') return { text: lineRead.benefit || '', canOk: true };
    if (row === 'audience') {
      if (!readAud) return { text: '', canOk: false };
      if (readAud.kind === 'all') return { text: '전체 고객', canOk: true };
      if (readAud.kind === 'product_buyers') return { text: `${readAud.terms.length > 0 ? readAud.terms.map((t) => `「${t}」`).join(' ') : '어떤 상품'}을 산 고객 · 상품은 다음 판에서 골라요`, canOk: lineEnabled };
      return { text: `「${readAud.raw}」은 아직 못 골라요. 아래에서 받는 사람을 골라 주세요`, canOk: false };
    }
    return { text: lineRead.channels.map((c) => PLANNER_CHANNEL[c].label).join(' · '), canOk: true };
  };
  const READ_LABEL: Record<ReadRow, string> = { title: '행사 이름', period: '기간', benefit: '혜택', audience: '받는 사람', channels: '채널' };
  const readBlock = lineRead && (readRows.length > 0 || lineRead.unsupported.length > 0) ? (
    <section className="rounded-xl border border-violet-200 bg-violet-50/50 px-3.5 py-3">
      <p className="text-[13px] font-semibold text-violet-900">이렇게 알아들었어요<span className="ml-1.5 font-normal text-violet-800">줄마다 확인해 주세요</span></p>
      <ul className="mt-2 space-y-2">
        {readRows.map((row) => {
          const v = readValue(row);
          const done = readDone[row];
          return (
            <li key={row} className="flex items-start gap-2 text-[13px]">
              <span className="w-[64px] shrink-0 text-slate-500">{READ_LABEL[row]}</span>
              <span className={`min-w-0 flex-1 ${v.canOk ? 'font-semibold text-violet-950' : 'text-slate-600'}`}>{v.text}</span>
              {done ? (
                <span className="shrink-0 text-[12px] font-semibold text-emerald-700 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" />{done === 'ok' ? '넣었어요' : '직접 고쳐요'}</span>
              ) : (
                <span className="shrink-0 flex gap-1">
                  {v.canOk && <button type="button" onClick={() => markRead(row, 'ok')} className="h-8 px-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-[12px] font-semibold">맞아요</button>}
                  <button type="button" onClick={() => markRead(row, 'edit')} className="h-8 px-2.5 rounded-lg border border-violet-300 bg-white text-violet-900 text-[12px] font-semibold">{v.canOk ? '고치기' : '확인'}</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {lineRead.unsupported.length > 0 && <p className="mt-2 text-[12px] text-slate-600">{lineRead.unsupported.join(' · ')}은 아직 플래너에서 보내지 못해요</p>}
    </section>
  ) : null;
  const audienceKindBlock = lineEnabled ? (
    <div>
      <p className="text-[12.5px] font-semibold text-slate-700 mb-1.5">받는 사람</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="받는 사람">
        {([['product_buyers', '상품을 산 고객', '고른 상품을 산 분에게'], ['all', '전체 고객', '수신거부를 뺀 모든 분에게']] as const).map(([k, label, desc]) => {
          const on = audKind === k;
          return (
            <button key={k} type="button" role="radio" aria-checked={on} disabled={busy} onClick={() => setAudKind(k)}
              className={`text-left rounded-xl p-3 border-2 transition-colors ${on ? 'border-indigo-500 bg-indigo-50/60' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
              <span className="flex items-center gap-1.5 text-[13.5px] font-bold text-slate-900">{on && <Check className="w-4 h-4 text-indigo-700" />}{label}</span>
              <span className="block mt-0.5 text-[12px] text-slate-500">{desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  const eventBoard = (
    <div className={`space-y-4 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
      {readBlock}
      <label className="block">
        <span className="text-[12.5px] font-semibold text-slate-700">행사 이름</span>
        <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="예: 가을 신상 위크"
          className="mt-1.5 w-full h-11 px-3.5 rounded-xl bg-white border border-slate-300 text-[14px] outline-none focus:ring-2 focus:ring-indigo-500" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="text-[12.5px] font-semibold text-slate-700">시작일</span>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} className="mt-1.5 w-full h-11 px-3 rounded-xl bg-white border border-slate-300 text-[14px] tabular-nums" /></label>
        <label className="block"><span className="text-[12.5px] font-semibold text-slate-700">마지막 날</span>
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="mt-1.5 w-full h-11 px-3 rounded-xl bg-white border border-slate-300 text-[14px] tabular-nums" /></label>
      </div>
      {audienceKindBlock}
      {tpl && (
        <label className="block">
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">행사 페이지 주소<NeedBadge must /></span>
          <input value={link} onChange={(e) => setLink(e.target.value.slice(0, 500))} placeholder="https:// 버튼을 누르면 갈 행사 페이지" inputMode="url"
            className={`mt-1.5 w-full h-11 px-3.5 rounded-xl bg-white border text-[14px] outline-none focus:ring-2 focus:ring-indigo-500 ${linkBad ? 'border-rose-300' : 'border-slate-300'}`} />
          <span className={`block mt-1 text-[12px] ${linkBad ? 'text-rose-700' : 'text-slate-500'}`}>{linkBad ? 'http로 시작하는 주소를 넣어 주세요' : '표지 사진을 안 넣으면 이 페이지의 표지 사진을 써요'}</span>
        </label>
      )}
      {templateBlock}
      {tpl && orderPreview && (
        <div>
          <p className="text-[12.5px] font-semibold text-slate-700 mb-1.5">이렇게 보내요<span className="ml-1.5 font-normal text-slate-500">{wide ? '오른쪽에서 바꿀 수 있어요' : '다음 판에서 바꿀 수 있어요'}</span></p>
          {orderPreview}
        </div>
      )}
    </div>
  );

  // ── 판2 · 혜택 · 재료 · 보내는 순서 ─────────────────────────────
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
      <div key={ch} className={`px-3.5 py-3 ${locked ? 'bg-slate-50' : ''}`}>
        <button type="button" role="switch" aria-checked={on} onClick={() => toggleChannel(ch)} disabled={locked || busy} className="w-full flex items-center gap-2.5 min-h-[32px] text-left disabled:cursor-not-allowed">
          <span className={`text-[14px] font-semibold ${locked ? 'text-slate-500' : ''}`}>{PLANNER_CHANNEL[ch].label}</span>
          {ch === 'email' && !locked && <span className="text-[12px] text-slate-500">모바일 DM과 같은 재료로 만들어요</span>}
          <span className={`ml-auto w-10 h-6 rounded-full p-0.5 shrink-0 transition-colors ${locked ? 'bg-slate-200' : on ? 'bg-indigo-600' : 'bg-slate-300'}`} aria-hidden="true">
            {locked ? <Lock className="w-3.5 h-3.5 m-[3px] text-slate-500" /> : <span className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />}
          </span>
        </button>
        {locked && (
          <div className="mt-1.5 text-[12.5px] text-slate-700">
            <p>{a?.reason}</p>
            {a?.settingsPath && (
              <button type="button" onClick={() => navigate(a.settingsPath!)} className="mt-1.5 h-9 px-2.5 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-700 inline-flex items-center gap-1">
                설정 열기<ArrowUpRight className="w-[13px] h-[13px]" />
              </button>
            )}
          </div>
        )}
        {on && !locked && (
          <div className="mt-2 space-y-1.5">
            <div className="flex flex-wrap gap-1.5">{(['start', 'end', 'before_start'] as Anchor[]).map((an) => timingChip(ch, an))}</div>
            {ch === 'dm' && <p className="text-[12.5px] text-violet-900">{dmShared ? '문자와 같은 날이라 문자 1통에 링크로 함께 나가요' : picked('sms').length > 0 ? '문자와 다른 날이라 모바일 DM 링크를 실은 문자가 따로 나가요' : '모바일 DM 링크를 실은 문자로 나가요'}</p>}
            {ch === 'email' && <p className="text-[12px] text-slate-500">메일은 한 행사에 한 번 보내요</p>}
          </div>
        )}
      </div>
    );
  };

  const runs = phase.kind === 'building' ? phase.runs : {};
  const building = phase.kind === 'building' && Object.values(runs).some((v) => v === 'busy' || v === 'wait');
  const failed = phase.kind === 'building' && !building && Object.values(runs).some((v) => v === 'fail');

  const runsBlock = phase.kind === 'building' ? (
    <div className={`rounded-xl border px-3.5 py-3 ${failed ? 'border-rose-200 bg-rose-50/60' : 'border-violet-200 bg-violet-50/70'}`} role="status" aria-live="polite">
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
  ) : null;

  const productsBlock = mall.provider ? (
    <MallStrip providerLabel={mall.provider.label} candidates={mall.candidates} loading={mall.loading} error={mall.error}
      selectedKeys={new Set(products.map((p) => p.key))} onToggle={toggleMall} query={mallQ} onQuery={setMallQ} onSearch={() => mall.search(mallQ)}
      count={products.length} disabled={busy} />
  ) : mall.checked ? (
    <ManualProducts products={products} onChange={(v) => setProducts(v.slice(0, productsMax))} max={productsMax} onNotice={(m) => toast.warning(m)} onConnect={() => navigate('/cdp-settings')} disabled={busy} />
  ) : null;

  const heroBlock = (
    <Field icon={<ImageIcon className="w-4 h-4" />} label="표지 사진" badge={<NeedBadge must={false} />} hint="없으면 행사 페이지의 표지 사진을 써요">
      <div className="flex items-center gap-2.5 flex-wrap">
        {images[0] ? <Thumb url={images[0].url} wide onRemove={busy ? undefined : () => setImages([])} /> : (
          <button type="button" disabled={busy || uploading} onClick={() => heroFileRef.current?.click()}
            className="w-[150px] h-[86px] rounded-xl border border-dashed border-slate-300 text-slate-400 hover:text-slate-700 flex flex-col items-center justify-center gap-1 text-[11.5px] disabled:opacity-50">
            {uploading ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}사진 올리기
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => setLibraryOpen(true)} className="inline-flex items-center gap-1.5 h-9 text-[12px] text-slate-500 hover:text-slate-700"><FolderOpen className="w-3.5 h-3.5" />저장 소재에서</button>
      </div>
      <input ref={heroFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { void addFiles(Array.from(e.target.files || []).slice(0, 1)); e.currentTarget.value = ''; }} />
    </Field>
  );

  const materialsBoard = (
    <div className={`space-y-4 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
      {audKind === 'product_buyers' && (
        <PlannerAudiencePicker value={buyer} onChange={setBuyer} terms={buyerTerms} allTimeHint={!!(readAud && readAud.kind === 'product_buyers' && readAud.allTime)} eventId={savedId} disabled={busy} />
      )}
      <div>
        <label className="block"><span className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">혜택 문구{tplInfo && tplInfo.needs.benefit !== 'none' && <NeedBadge must={tplInfo.needs.benefit === 'required'} />}</span>
          <textarea value={benefit} onChange={(e) => setBenefit(e.target.value.slice(0, 300))} rows={2} placeholder="예: 신상 3종 출시 기념, 전 품목 15% 할인"
            className="mt-1.5 w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-[14px] outline-none focus:ring-2 focus:ring-indigo-500 resize-none" /></label>
        <p className="text-[12px] text-slate-600 mt-1.5 inline-flex items-center gap-1"><Lock className="w-3 h-3 text-violet-600" />적은 글자 그대로 실려요 · AI가 바꾸거나 더하지 않아요</p>
      </div>
      {materialsOn && (tpl ? (
        <>
          {(!tplInfo || tplInfo.needs.hero === 'ask') && heroBlock}
          <div>
            <p className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700 mb-1.5"><ShoppingBag className="w-4 h-4 text-violet-700" />상품{tplInfo && <NeedBadge must={tplInfo.needs.products.min > 0} />}<span className="font-normal text-slate-500">{tplInfo && tplInfo.needs.products.min > 0 ? `${tplInfo.needs.products.min}개 이상 · ` : ''}최대 {productsMax}개</span></p>
            {productsBlock}
          </div>
        </>
      ) : (
        <>
          <PhotoTextBoard
            images={images} roles={roles} onAddFiles={(f) => { void addFiles(f); }} onRemoveImage={(url) => setImages((cur) => cur.filter((i) => i.url !== url))}
            onOpenLibrary={() => setLibraryOpen(true)} text={text} onText={(v) => setText(v.slice(0, 2000))} licensed={licensed} onLicensed={setLicensed}
            maxImages={BUILD_CARD_IMAGES_MAX} disabled={busy} uploading={uploading}
          />
          {productsBlock}
        </>
      ))}
      <div>
        <p className="text-[12.5px] font-semibold text-slate-700 mb-1.5">보내는 순서</p>
        <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-200 overflow-hidden">
          {availability.length === 0 ? <p className="px-3.5 py-4 text-[13px] text-slate-500">채널 상태를 불러오는 중이에요</p> : CHANNEL_ORDER.map(channelRow)}
        </div>
        {orderPreview && <div className="mt-2">{orderPreview}</div>}
        {firstSend && (
          <p className="mt-2 text-[12.5px] text-slate-700 flex items-start gap-2 leading-snug">
            <CalendarClock className="w-[15px] h-[15px] text-slate-500 mt-0.5 shrink-0" />
            <span>같은 고객에게 <b className="tabular-nums">{sendCount}번</b> · 첫 발송 <b className="tabular-nums">{plannerDay(firstSend)} 오전 8시</b> · 확인 요청은 <b className="tabular-nums">{reviewRequestDay(firstSend)}</b>쯤 휴대폰으로 가요 · 승인 마감 그날 20시</span>
          </p>
        )}
      </div>
      <p className="text-[10px] text-slate-500 italic">상품 가격·링크는 만들 때 몰에서 다시 확인합니다.</p>
    </div>
  );

  // ── 바닥 · 돈 3줄 + 버튼 ─────────────────────────────────────────
  const buildTotal = draftQuote?.total ?? null;
  const needsBuild = needBuild.length > 0 && materialsOn;
  const blocked = tpl ? linkBad || gateMissing.length > 0 : !hasMaterial(materials);
  const primaryLabel = needsBuild
    ? (buildTotal !== null ? `담고 만들기 · ${won(buildTotal)}크레딧` : quoteError ? '담고 만들기' : '견적 계산 중')
    : editing ? '고친 내용 저장' : '캘린더에 담기';
  const primaryDisabled = busy || (needsBuild && (blocked || buildTotal === null));
  const onEventPane = !wide && pane === 'event';

  const moneyRow = (label: string, value: ReactNode) => (
    <div className="flex gap-3"><dt className="w-[76px] shrink-0 text-slate-500">{label}</dt><dd className="min-w-0 text-slate-700">{value}</dd></div>
  );
  const footer = (
    <div className={`${phone ? 'px-3 pt-2.5 pb-5' : 'px-6 py-3.5'} border-t border-slate-200 bg-white shrink-0`}>
      {!onEventPane && tps.length > 0 && (
        <dl className="text-[12.5px] tabular-nums space-y-0.5 mb-2.5">
          {needsBuild && moneyRow('지금', buildTotal !== null
            ? <><b className="text-slate-900">{won(buildTotal)}크레딧</b>{draftQuote && draftQuote.quotes.length > 0 ? ` (${draftQuote.quotes.map((q) => q.parts.map((p) => `${p.label} ${won(p.cost)}`).join(' · ')).join(' · ')})` : ''}{balance !== null && <> · 보유 {won(balance)}</>}</>
            : quoteError || (tpl ? '견적을 계산하고 있어요' : '재료를 넣으면 만들 비용을 보여 드려요'))}
          {moneyRow('승인할 때', '발행비·대행료는 확인 화면에서 금액을 보여 드려요')}
          {moneyRow('발송일마다', '문자 문안비 + 보낸 건수만큼 발송비')}
        </dl>
      )}
      {!onEventPane && needsBuild && tpl && (linkBad || gateMissing.length > 0) && (
        <p className="text-[12.5px] font-semibold text-amber-800 mb-2">{linkBad ? '행사 페이지 주소가 맞지 않아요' : `${gateMissing.map((k) => MISSING_TEXT[k] || k).join(' · ')}을 넣어야 만들 수 있어요`}</p>
      )}
      <div className={`flex items-center gap-2 ${phone ? '' : 'justify-end'}`}>
        {onEventPane ? (
          <button type="button" onClick={goNext} disabled={busy}
            className={`${phone ? 'flex-1 h-12' : 'h-11'} px-5 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60`}>
            다음 · 혜택과 보내는 순서<ArrowRight className="w-4 h-4" />
          </button>
        ) : failed ? (
          <button type="button" onClick={retry} className={`${phone ? 'flex-1 h-12' : 'h-11'} px-5 rounded-[10px] bg-amber-500 hover:bg-amber-400 text-amber-950 text-[14px] font-bold inline-flex items-center justify-center gap-2`}>
            <RotateCw className="w-4 h-4" />다시 만들기
          </button>
        ) : (
          <>
            {needsBuild && !building && (
              <button type="button" disabled={busy} onClick={() => { void submit(false); }} className="h-12 md:h-11 px-3.5 rounded-[10px] border border-slate-300 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">재료만 담기</button>
            )}
            <button type="button" disabled={primaryDisabled} onClick={() => { void submit(true); }}
              className={`${phone ? 'flex-1 h-12' : 'h-11'} px-5 rounded-[10px] text-[14px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60 ${needsBuild ? 'bg-amber-500 hover:bg-amber-400 text-amber-950' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
              {building || phase.kind === 'saving' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : needsBuild ? <WandSparkles className="w-4 h-4" /> : <Check className="w-4 h-4" />}
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
      <JourneyModalShell open onClose={requestClose} labelledBy="planner-event-title"
        panelClassName={wide ? 'w-full max-w-[1180px] h-[92vh]' : 'w-full md:max-w-[680px] h-[92vh]'}>
        <div className="px-4 md:px-6 h-14 md:h-16 border-b border-slate-200 flex items-center gap-2 shrink-0">
          {!wide && pane === 'materials' ? (
            <>
              <button type="button" onClick={() => setPane('event')} className="h-11 px-1 inline-flex items-center gap-1 text-[13.5px] font-semibold text-slate-700"><ArrowLeft className="w-[17px] h-[17px]" />행사로</button>
              <h3 id="planner-event-title" className="text-[16px] font-bold ml-1">혜택 · 재료 · 보내는 순서</h3>
            </>
          ) : (
            <>
              <h3 id="planner-event-title" className="text-[17px] font-bold tracking-[-0.01em]">{headerTitle}</h3>
              {!phone && <span className="text-[13px] text-slate-500">템플릿을 고르면 모바일 DM·메일 완성본과 보내는 순서를 채워 드려요</span>}
            </>
          )}
          <button type="button" onClick={requestClose} aria-label="닫기" className="ml-auto w-10 h-10 rounded-lg text-slate-500 hover:bg-slate-100 grid place-items-center"><X className="w-[18px] h-[18px]" /></button>
        </div>
        {wide ? (
          <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] min-h-0 flex-1">
            <div className="border-r border-slate-200 bg-slate-50 p-6 overflow-y-auto">{eventBoard}</div>
            <div className="p-6 overflow-y-auto space-y-4">{runsBlock}{materialsBoard}</div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4">
            {pane === 'event' ? eventBoard : <div className="space-y-4">{runsBlock}{materialsBoard}</div>}
          </div>
        )}
        {footer}
      </JourneyModalShell>
      {tpl && tplInfo && <LineTemplateZoom open={zoom} onClose={() => setZoom(false)} id={tpl.id} channel={exChannel} layout={tpl.layout} label={tplInfo.label} />}
      <AssetLibraryPickerModal open={libraryOpen} onClose={() => setLibraryOpen(false)} onPick={(a) => addLibrary([a])} multiSelect={imageMax > 1} onPickMany={addLibrary} />
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
