/**
 * QuickCampaignPage — AI 자동제작(재료만 넣으면 모바일 DM·이메일 완성본까지) ★ 2026-09-14 T5 승격 · 설계서 docs/2026-09-14-ai-auto-build-design.md §4 · §5 · §13 T4 응답 계약
 *
 * 1열(OUI_WRAP_NARROW) · 시각 무게 4:2:2:1 = ① 행사 카드(≤3 · 이미지는 고르는 즉시 업로드해 url 만 · 서버 판정 배지 · 드래그 정렬) ② 상품(연동몰 불러오기 + 붙여넣기) ③ 기능 칩 4 + "AI가 알아서"
 * ④ 채널 세그먼트 [모바일 DM | 이메일](이메일 = 광고 여부 1행) · 하단 sticky 바 = 서버 견적 1줄 + [AI 자동제작] 1개 → CreditConfirmModal 1회 → 완성본 → 편집기 착지(DM /dm-builder?id= · 이메일 /email-campaigns?edit=).
 * 돈 단위 = attemptToken(누름마다 uuid · 같은 누름의 재시도는 같은 값 = 원장 duplicate 무료) · 금액은 서버 견적(POST /materials/quote)만 · 생성 중 차단(입력 disabled · 이탈 확인) · 진행 문구는 실제 단계만(타이머 연출 0).
 * 신규 ENV 미개방 회사 = 옛 화면(QuickCampaignLegacyPage · v0 그대로). native dialog 0 · 모델명 0 · 하드코딩 금액 0.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Sparkles, Wand2, Loader2, Lock, Check, Smartphone, Mail, RotateCcw, AlertTriangle } from 'lucide-react';
import { OUI_BACK, OUI_BADGE_NEW, OUI_CARD, OUI_HEADER, OUI_ICON_TILE, OUI_PAGE, OUI_PAGE_CENTER, OUI_SRC, OUI_SUBTITLE, OUI_TITLE, OUI_WRAP_NARROW } from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';
import BuildCardsInput, { BUILD_CARD_IMAGES_MAX } from '../components/ai-build/BuildCardsInput';
import FeatureChips from '../components/ai-build/FeatureChips';
import ProductPickList, { AI_BUILD_PRODUCTS_MAX } from '../components/ai-build/ProductPickList';
import MallProductPickerModal, { type PickedMallProduct } from '../components/dm/MallProductPickerModal';
import AssetLibraryPickerModal, { type PickedAsset } from '../components/assets/AssetLibraryPickerModal';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';
import QuickCampaignLegacyPage from './QuickCampaignLegacyPage';
// 옛 3채널 세트(DM·이메일·인앱 한 번에)와 임시 보관 재개는 입구 정리 2차(§9)까지 그대로 열린다 — 조용한 보조 줄 하나
import EventCampaignModal from '../components/EventCampaignModal';
import EventCampaignResumeBar from '../components/EventCampaignResumeBar';
import {
  buildErrorMessage, buildMaterialsPayload, cardIsFilled, clearBuildDraft, featureAvailability, loadBuildDraft, newAttemptToken, newBuildCard,
  saveBuildDraft, saveBuildResult,
  type BuildCardValue, type BuildChannel, type BuildImageRole, type BuildImageValue, type BuildProductValue,
} from '../utils/ai-build';

interface ServerQuote {
  total: number;
  parts: Array<{ key: string; label: string; cost: number }>;
  gate: { ok: boolean; missing?: string[] };
  imageRoles: Array<{ url: string; role: BuildImageRole }>;
  creditEnabled: boolean;
  smtpConfigured: boolean | null;
  planLocked: boolean;
  textChars: number;
  images: number;
}
type Phase = 'idle' | 'running' | 'done';

const token = () => localStorage.getItem('token');
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });

export default function QuickCampaignPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [entry] = useState(() => ({
    channel: (searchParams.get('channel') === 'email' ? 'email' : searchParams.get('channel') === 'dm' ? 'dm' : null) as BuildChannel | null,
    regen: searchParams.get('regen') === '1',
  }));

  // 노출 스위치(신규 ENV) — 서버가 정한다. 미개방 = 옛 화면 그대로.
  const [flag, setFlag] = useState<'loading' | 'on' | 'off'>('loading');
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch('/api/event-campaigns/materials/quote?images=0&has_text=1', { headers: jsonHeaders(), signal: ctrl.signal });
        const d = await r.json().catch(() => ({}));
        setFlag(r.ok && d?.auto_build_enabled === true ? 'on' : 'off');
      } catch { setFlag('off'); }
    })();
    return () => ctrl.abort();
  }, []);

  // 재료 상태(로컬 초안 복구 · 이미지는 url 만)
  const [restored] = useState(() => loadBuildDraft());
  const [channel, setChannel] = useState<BuildChannel>(entry.channel || restored?.channel || 'dm');
  const [isAd, setIsAd] = useState<boolean>(restored ? restored.isAd : true);
  const [cards, setCards] = useState<BuildCardValue[]>(restored?.cards?.length ? restored.cards : [newBuildCard()]);
  const [products, setProducts] = useState<BuildProductValue[]>(restored?.products || []);
  const [features, setFeatures] = useState<string[] | null>(restored?.features ?? null);
  const [mallAvailable, setMallAvailable] = useState(false);
  const [mallOpen, setMallOpen] = useState(false);
  const [libraryFor, setLibraryFor] = useState<string | null>(null);
  const [quote, setQuote] = useState<ServerQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [regenPending, setRegenPending] = useState(entry.regen && !!restored);
  const attemptRef = useRef<string | null>(null);
  const skipPersist = useRef(true);
  const [setOpen, setSetOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [resumeRefresh, setResumeRefresh] = useState(0);

  useEffect(() => { if (entry.channel || entry.regen) setSearchParams({}, { replace: true }); }, [entry.channel, entry.regen, setSearchParams]);

  const filledCards = useMemo(() => cards.filter(cardIsFilled), [cards]);
  const imageCount = useMemo(() => filledCards.reduce((a, c) => a + c.images.length, 0), [filledCards]);
  // 판독 여부는 서버 견적 부품이 정한다(캐시 적중이면 부품 자체가 빠진다 · 화면이 따로 셈하지 않는다)
  const reads = quote?.parts.some((p) => p.key === 'event-image-extract') ? 1 : 0;
  const availability = useMemo(() => featureAvailability({ cards: filledCards, products }, channel), [filledCards, products, channel]);
  const busy = phase !== 'idle';
  const planLocked = !!quote?.planLocked;
  const smtpMissing = channel === 'email' && quote?.smtpConfigured === false;
  const canRun = !!quote && quote.gate.ok && !planLocked && !smtpMissing && !busy;

  // 연동 몰 유무(피커 탭 구성과 같은 API)
  useEffect(() => {
    if (flag !== 'on') return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch('/api/mall-products/providers', { headers: jsonHeaders(), signal: ctrl.signal });
        const d = await r.json().catch(() => ({}));
        setMallAvailable(r.ok && Array.isArray(d?.providers) && d.providers.length > 0);
      } catch { setMallAvailable(false); }
    })();
    return () => ctrl.abort();
  }, [flag]);

  // 로컬 초안 보관(새로고침 복구 · 첫 렌더는 건너뛴다)
  useEffect(() => {
    if (flag !== 'on') return;
    if (skipPersist.current) { skipPersist.current = false; return; }
    // 재료가 바뀌면 다른 시도다 — 같은 토큰으로 다른 재료를 무료(duplicate)로 만들지 않는다. [다시 시도]는 재료가 그대로일 때만 같은 토큰.
    if (!busy) attemptRef.current = null;
    const t = setTimeout(() => saveBuildDraft({ channel, isAd, cards, products, features }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag, channel, isAd, cards, products, features]);

  // 서버 견적(단일 출처) — 재료가 바뀔 때마다 · 게이트·역할 배지·SMTP·요금제 잠금까지 한 번에
  const [quoteSeq, setQuoteSeq] = useState(0);
  useEffect(() => {
    if (flag !== 'on') return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const materials = buildMaterialsPayload({ channel, isAd, cards, products, features }, attemptRef.current || newAttemptToken(), 0);
        const r = await fetch('/api/event-campaigns/materials/quote', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ materials }), signal: ctrl.signal });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.success === false) {
          if (d?.code === 'FEATURE_DISABLED') { setFlag('off'); return; }
          setQuote(null);
          setQuoteError(buildErrorMessage(d?.code, d?.error, '견적을 계산하지 못했어요.'));
          return;
        }
        setQuoteError(null);
        setQuote({
          total: Number(d.total) || 0,
          parts: Array.isArray(d.parts) ? d.parts : [],
          gate: d.gate && typeof d.gate === 'object' ? { ok: d.gate.ok === true, missing: Array.isArray(d.gate.missing) ? d.gate.missing : [] } : { ok: false, missing: [] },
          imageRoles: Array.isArray(d.image_roles) ? d.image_roles : [],
          creditEnabled: d.credit_enabled !== false,
          smtpConfigured: typeof d.smtp_configured === 'boolean' ? d.smtp_configured : null,
          planLocked: !!d.plan_locked,
          textChars: Number(d.text_chars) || 0,
          images: Number(d.images) || 0,
        });
      } catch { /* 취소·네트워크 = 이전 견적 유지 */ }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [flag, channel, isAd, cards, products, features, quoteSeq]);

  // 서버 판정 배지(image_roles) → 카드 썸네일(읽기 전용)
  const cardsWithRoles = useMemo(() => {
    const roleOf = new Map<string, BuildImageRole>((quote?.imageRoles || []).map((r) => [r.url, r.role]));
    if (roleOf.size === 0) return cards;
    return cards.map((c) => ({ ...c, images: c.images.map((im) => ({ ...im, role: roleOf.get(im.url) })) }));
  }, [cards, quote?.imageRoles]);

  // 생성 중 = 경과 초(15초 넘으면 보조 문구 1줄) + 이탈 확인
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => { clearInterval(t); window.removeEventListener('beforeunload', onLeave); };
  }, [busy]);

  const upload = useCallback(async (files: File[]): Promise<BuildImageValue[]> => {
    const fd = new FormData();
    files.forEach((f, i) => fd.append('images', f, f.name || `image_${i + 1}`));
    fd.append('read', '0');
    const r = await fetch('/api/event-campaigns/materials', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.success === false) throw new Error(String(d?.error || '이미지를 올리지 못했습니다.'));
    return (Array.isArray(d.images) ? d.images : []).map((im: any) => ({ url: String(im.url), width: im.width ?? null, height: im.height ?? null }));
  }, []);

  const addLibraryImages = (assets: PickedAsset[]) => {
    if (!libraryFor) return;
    setCards((cur) => cur.map((c) => {
      if (c.id !== libraryFor) return c;
      const room = BUILD_CARD_IMAGES_MAX - c.images.length;
      const add = assets.filter((a) => a.url && !c.images.some((im) => im.url === a.url)).slice(0, Math.max(0, room)).map((a) => ({ url: a.url, width: null, height: null }));
      if (assets.length > add.length) toast.warning(`카드당 최대 ${BUILD_CARD_IMAGES_MAX}장이라 ${assets.length - add.length}장은 담지 않았어요.`);
      return { ...c, images: [...c.images, ...add] };
    }));
    setLibraryFor(null);
  };

  const addMallProducts = (picked: PickedMallProduct[]) => {
    setProducts((cur) => {
      const keys = new Set(cur.map((p) => p.key));
      const next = cur.slice();
      for (const p of picked) {
        const key = `${p.provider}:${p.code}`;
        if (keys.has(key)) continue;
        keys.add(key);
        next.push({ key, source: 'mall', provider: p.provider, code: p.code, name: p.name, price: p.price || null, salePrice: p.salePrice || null, discountRate: p.discountRate || null, url: p.productUrl, imageUrl: p.imageUrl });
        if (next.length >= AI_BUILD_PRODUCTS_MAX) break;
      }
      return next;
    });
  };

  const run = useCallback(async () => {
    setConfirmOpen(false);
    if (!quote) return;
    const attempt = attemptRef.current || newAttemptToken();
    attemptRef.current = attempt;
    setPhase('running');
    setError(null);
    try {
      const materials = buildMaterialsPayload({ channel, isAd, cards, products, features }, attempt, quote.total);
      const url = channel === 'dm' ? '/api/dm/ai/one-shot-generate' : '/api/email/ai/generate-sections';
      const r = await fetch(url, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ materials }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.success === false) {
        const code = String(d?.code || '');
        if (code === 'QUOTE_CHANGED') setQuoteSeq((v) => v + 1);
        throw Object.assign(new Error(buildErrorMessage(code, d?.error, '완성본을 만들지 못했어요. 잠시 후 다시 시도해 주세요.')), { code });
      }
      const data = d?.data || {};
      const draftId = String(data.draft_id || '');
      if (!draftId) throw new Error('완성본은 만들었지만 초안을 찾지 못했어요. 목록에서 확인해 주세요.');
      saveBuildResult({ channel, draftId, materials: data.materials || {}, quoteTotal: quote.total, heroFallback: data.heroFallback === true, benefitStripped: Number(data.benefitStripped) || 0, createdAt: Date.now() });
      attemptRef.current = null;
      setPhase('done');
      toast.success(channel === 'dm' ? '모바일 DM 완성본을 만들었어요. 편집기에서 이어서 다듬어 주세요.' : '이메일 완성본을 만들었어요. 편집기에서 이어서 다듬어 주세요.');
      navigate(channel === 'dm' ? `/dm-builder?id=${encodeURIComponent(draftId)}` : `/email-campaigns?edit=${encodeURIComponent(draftId)}`);
    } catch (e: any) {
      setError({ message: e?.message || '완성본을 만들지 못했어요. 잠시 후 다시 시도해 주세요.', code: String(e?.code || '') });
      setPhase('idle');
    }
  }, [quote, channel, isAd, cards, products, features, navigate, toast]);

  // 편집기 [다시 만들기] → 같은 재료 · 새 시도 토큰 · 확인은 편집기의 ConfirmModal 이 이미 받았다(1회)
  useEffect(() => {
    if (!regenPending || !quote || busy) return;
    if (!quote.gate.ok || planLocked || smtpMissing) { setRegenPending(false); return; }
    setRegenPending(false);
    attemptRef.current = newAttemptToken();
    void run();
  }, [regenPending, quote, busy, planLocked, smtpMissing, run]);

  const resetAll = () => {
    clearBuildDraft();
    attemptRef.current = null;
    setCards([newBuildCard()]); setProducts([]); setFeatures(null); setError(null);
  };

  if (flag === 'off') return <QuickCampaignLegacyPage />;
  if (flag === 'loading') {
    return <div className={OUI_PAGE_CENTER}><Loader2 className="w-6 h-6 animate-spin text-violet-300" /></div>;
  }

  const missing = new Set(quote?.gate.missing || []);
  const gateText = !quote ? null
    : quote.gate.ok ? null
      : missing.has('text') && missing.has('hero') ? '행사 내용 40자 이상 또는 첫 화면이 될 사진 1장이 필요해요'
        : missing.has('hero') ? '첫 화면이 될 사진 1장이 필요해요(로고·세로형은 첫 화면이 되지 않아요)' : '행사 내용을 40자 이상 적어 주세요';
  const readPart = quote?.parts.find((p) => p.key === 'event-image-extract') || null;
  const genPart = quote?.parts.find((p) => p.key !== 'event-image-extract') || null;
  const progressRows: Array<{ label: string; state: 'done' | 'now' | 'todo' }> = [
    { label: '재료 확인', state: 'done' },
    ...(reads ? [{ label: '이미지 글자 읽기', state: 'now' as const }] : []),
    { label: '구성과 문구 만들기', state: reads ? 'todo' : 'now' },
    { label: channel === 'dm' ? '초안 저장 · 편집기 열기' : '초안 저장 · 편집기 열기', state: phase === 'done' ? 'done' : 'todo' },
  ];

  return (
    <div className={OUI_PAGE}>
      <OperatorAura />
      <div className={OUI_HEADER}>
        <div className={`${OUI_WRAP_NARROW} py-3 md:py-4 flex items-center gap-3`}>
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className={OUI_BACK} aria-label="돌아가기"><ArrowLeft className="w-5 h-5" /></button>
          <div className={`${OUI_ICON_TILE} bg-gradient-to-br from-amber-400 to-fuchsia-500`}><Wand2 className="w-5 h-5 text-white" /></div>
          <div className="min-w-0">
            <h1 className={`${OUI_TITLE} flex items-center gap-2`}>AI 자동제작 <span className={OUI_BADGE_NEW}>NEW</span></h1>
            <p className={OUI_SUBTITLE}>재료만 넣으면 완성본까지. 버튼 하나로 편집기에 열립니다.</p>
          </div>
          <div className="ml-auto inline-flex rounded-xl border border-white/10 bg-white/5 p-0.5 shrink-0" role="tablist" aria-label="채널">
            {([['dm', '모바일 DM', Smartphone], ['email', '이메일', Mail]] as const).map(([key, label, Icon]) => {
              const on = channel === key;
              const emailBlocked = key === 'email' && quote?.smtpConfigured === false && channel !== 'email';
              return (
                <button key={key} type="button" role="tab" aria-selected={on} disabled={busy}
                  onClick={() => setChannel(key)}
                  title={emailBlocked ? '이메일 발신 설정이 먼저 필요해요' : undefined}
                  className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50 ${on ? 'bg-violet-600 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'} ${emailBlocked ? 'opacity-50' : ''}`}>
                  <Icon className="w-3.5 h-3.5" /><span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className={`${OUI_WRAP_NARROW} py-6 md:py-8 space-y-4 pb-28`}>
        {planLocked && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 px-4 py-3 text-[12px] text-amber-100 inline-flex items-center gap-2"><Lock className="w-4 h-4" /> {channel === 'dm' ? '모바일 DM 요금제에서 열립니다.' : '이메일 캠페인은 유료 요금제에서 열립니다.'}</div>
        )}
        {smtpMissing && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 px-4 py-3 text-[12px] text-amber-100 flex items-center gap-2 flex-wrap">
            <AlertTriangle className="w-4 h-4 shrink-0" /> 이메일 발신 설정이 먼저 필요해요.
            <button type="button" onClick={() => navigate('/email-campaigns')} className="underline underline-offset-2 hover:text-white">발신 설정으로</button>
          </div>
        )}

        {busy && (
          <div className={`${OUI_CARD} p-5 space-y-3 border-violet-400/30`} aria-live="polite">
            <div className="text-sm font-bold text-white flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-violet-300" /> 완성본을 만들고 있어요</div>
            <ul className="space-y-1.5">
              {progressRows.map((row) => (
                <li key={row.label} className="flex items-center gap-2 text-[13px]">
                  {row.state === 'done' ? <Check className="w-4 h-4 text-emerald-400" /> : row.state === 'now' ? <Loader2 className="w-4 h-4 animate-spin text-violet-300" /> : <span className="w-4 h-4 inline-flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-white/25" /></span>}
                  <span className={row.state === 'todo' ? 'text-white/40' : 'text-white/85'}>{row.label}</span>
                </li>
              ))}
            </ul>
            {elapsed >= 15 && <p className="text-[12px] text-white/50">보통 20~40초 걸려요. 창을 닫지 말고 잠시만 기다려 주세요.</p>}
          </div>
        )}

        {/* ① 행사 카드 */}
        <section className={`${OUI_CARD} p-5 md:p-6 space-y-4`}>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2"><Sparkles className="w-4 h-4 text-fuchsia-300" /> 행사 재료</div>
            <p className="text-[12px] text-white/50 mt-1">행사마다 카드 하나. 첫 카드의 첫 사진이 첫 화면이 되고, 다음 카드는 설명 카드와 버튼으로 이어져요. 필수는 하나: 행사 내용 또는 사진.</p>
          </div>
          <BuildCardsInput value={cardsWithRoles} onChange={setCards} disabled={busy || planLocked} onUpload={upload} onOpenLibrary={(id) => setLibraryFor(id)} onReject={(m) => toast.warning(m)} />
          <p className="text-[11px] text-white/40">쓸 사진이 없으면 <button type="button" onClick={() => navigate('/image-studio')} className="underline underline-offset-2 hover:text-white/80">이미지 스튜디오에서 만들기</button></p>
        </section>

        {/* ② 상품 */}
        <section className={`${OUI_CARD} p-5 md:p-6 space-y-3`}>
          <div>
            <div className="text-sm font-bold text-white">상품</div>
            <p className="text-[12px] text-white/50 mt-1">몰에서 불러온 상품은 사진·가격·바로가기 버튼이 있는 카드가 되고, 직접 적은 상품은 글로 실려요. 가격은 만들 때 몰에서 다시 확인해요.</p>
          </div>
          <ProductPickList value={products} onChange={setProducts} mallAvailable={mallAvailable} onOpenMall={() => setMallOpen(true)} disabled={busy || planLocked} onNotice={(m) => toast.warning(m)} />
        </section>

        {/* ③ 기능 칩 */}
        <section className={`${OUI_CARD} p-5 md:p-6 space-y-3`}>
          <div>
            <div className="text-sm font-bold text-white">넣고 싶은 기능</div>
            <p className="text-[12px] text-white/50 mt-1">고른 것은 꼭 넣고, 고르지 않은 것은 빼요. 재료가 없는 기능은 켜지지 않아요.</p>
          </div>
          <FeatureChips value={features} onChange={setFeatures} availability={availability} channel={channel} disabled={busy || planLocked} />
        </section>

        {/* ④ 채널 부가 1행(이메일만) */}
        {channel === 'email' && (
          <section className={`${OUI_CARD} px-5 py-3 md:px-6`}>
            <label className="inline-flex items-center gap-2 text-[12px] text-white/75 cursor-pointer">
              <input type="checkbox" className="accent-violet-500" checked={isAd} disabled={busy} onChange={(e) => setIsAd(e.target.checked)} />
              광고 메일로 보내기(발송 때 "(광고)" 표기와 수신거부가 자동으로 붙어요)
            </label>
          </section>
        )}

        {error && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 px-4 py-3 text-[13px] text-rose-100 flex items-start gap-2 flex-wrap">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1 min-w-[200px]">{error.message}</span>
            {error.code !== 'FEATURE_DISABLED' && error.code !== 'INSUFFICIENT_CREDIT' && (
              <button type="button" onClick={() => { if (canRun) void run(); }} disabled={!canRun}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[12px] font-semibold text-white bg-white/10 hover:bg-white/15 disabled:opacity-50"><RotateCcw className="w-3.5 h-3.5" /> 다시 시도</button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className={OUI_SRC}>Data source: 넣어 주신 재료 · 서버 견적 · 만든 초안은 {channel === 'dm' ? '모바일 DM' : '이메일 캠페인'} 목록에 저장됩니다</p>
          <button type="button" onClick={resetAll} disabled={busy} className="inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-white/80 disabled:opacity-50"><RotateCcw className="w-3 h-3" /> 새로 시작</button>
        </div>

        <EventCampaignResumeBar refreshKey={resumeRefresh} onResume={(id) => { setResumeDraftId(id); setSetOpen(true); }} />
        <p className="text-[11px] text-white/35">
          DM·이메일·인앱 세트를 한 번에 만드는 옛 방식은 <button type="button" disabled={busy} onClick={() => { setResumeDraftId(null); setSetOpen(true); }} className="underline underline-offset-2 hover:text-white/70 disabled:opacity-50">여기</button>에서 열려요.
        </p>
      </div>

      <EventCampaignModal open={setOpen} resumeDraftId={resumeDraftId || undefined} onClose={() => { setSetOpen(false); setResumeDraftId(null); setResumeRefresh((v) => v + 1); }} />

      {/* 하단 sticky 바 — 서버 견적 1줄 + 버튼 1개 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-slate-950/90 backdrop-blur">
        <div className={`${OUI_WRAP_NARROW} py-3 flex items-center justify-between gap-3 flex-wrap`}>
          <div className="text-[11px] text-white/55 min-w-0">
            {quote ? (
              <>
                <span className="text-white/85 font-medium">{genPart ? `${genPart.label} ${genPart.cost}` : ''}{readPart ? ` + ${readPart.label} ${readPart.cost}(지금 차감)` : ''} = {quote.total} 크레딧</span>
                <span> · 이미지 {imageCount}장 · 상품 {products.length}개 · 발행 시 별도</span>
                {!quote.creditEnabled && <span> · 요금제 포함(차감 없음)</span>}
                {gateText && <span className="block text-amber-200 mt-0.5">{gateText}</span>}
              </>
            ) : (quoteError || '견적을 계산하는 중이에요')}
          </div>
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canRun}
            className="inline-flex items-center gap-1.5 h-11 px-6 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-500 text-indigo-950 text-sm font-bold hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 transition-all shrink-0">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {busy ? '만드는 중' : 'AI 자동제작'}
          </button>
        </div>
      </div>

      <MallProductPickerModal open={mallOpen} onClose={() => setMallOpen(false)} onPick={addMallProducts} />
      <AssetLibraryPickerModal open={!!libraryFor} onClose={() => setLibraryFor(null)} onPick={(a) => addLibraryImages([a])} multiSelect onPickMany={addLibraryImages} />
      <CreditConfirmModal
        open={confirmOpen}
        source={channel === 'dm' ? 'dm-ai-generate' : 'email-ai-generate'}
        costOverride={quote ? quote.total : undefined}
        description={quote ? `${quote.parts.map((p) => `${p.label} ${p.cost}`).join(' + ')} · 행사 ${filledCards.length}건 · 이미지 ${imageCount}장 · 상품 ${products.length}개. 완성본은 ${channel === 'dm' ? '모바일 DM' : '이메일'} 편집기에 바로 열리고 목록에 저장돼요. 발행은 별도예요.` : undefined}
        onConfirm={run}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
