import { OUI_BACK, OUI_CARD, OUI_HEADER, OUI_ICON_TILE, OUI_PAGE, OUI_SRC, OUI_SUBTITLE, OUI_TITLE } from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';
/**
 * QuickCampaignPage — 원클릭 캠페인 (2026-07-08 · ★ 2026-09-06 S5 재료 입구 인라인 · ★ v3 행사 카드 페이지 = 설계서 docs/2026-09-06-outreach-v3-brand-page-recomposition-design.md §10)
 *
 * SUB_MODULE_CARDS "원클릭 캠페인" 타일(/quick-campaign)의 집.
 * ★ v3: 첫 화면 = 브랜드 줄(브랜드명 · 주색 · 로고 · 서버 브랜드 킷 그대로) → 행사 카드 목록(최대 3 · 카드 = 제목 · 내용 · 이미지 ≤3 · 링크 · "그대로 씁니다") → [행사 추가] → 하단 바(견적 1줄 + [제작] 1개).
 *   클릭 즉시: ① 카드 이미지 전부 업로드(read=0 · 판독 0) ② 내용이 빈 카드가 있으면 그 카드들의 대표 이미지만 묶어 판독 1회(3크레딧 고정) ③ 아웃리치 엔진(같은 표준 · 행사 카드 → 첫 화면·설명 카드·버튼) → 초안 DM ④ 시안 렌더.
 *   결과는 같은 페이지 본문 2열(쓴 재료 · 판정 줄 / 다크 액자 시안 · 폭 토글 375·600) · [DM 편집으로]는 같은 초안 id 로 연다. 크레딧은 서버 견적(costOverride) 그대로.
 * 옛 3채널 흐름(EventCampaignModal)은 아래 카드의 버튼으로 그대로 열린다(무접촉). 임시 보관 세트 재개(EventCampaignResumeBar)도 그대로.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Sparkles, Wand2, Loader2, PencilLine, ImagePlus, RotateCcw, Lock, Smartphone, Monitor } from 'lucide-react';
import EventCampaignModal from '../components/EventCampaignModal';
import EventCampaignResumeBar from '../components/EventCampaignResumeBar';
import EventCardsInput, { newEventCard, type EventCardValue } from '../components/EventCardsInput';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';

interface Quote { enabled: boolean; plan_locked: boolean; total: number; parts: Array<{ key: string; label: string; cost: number }> }
interface QuickResult {
  draftId: string;
  html: string | null;
  cards: Array<{ title: string; images: Array<{ url: string }>; textChars: number; licensed: boolean; read: boolean }>;
  meta: { images: number; imagesUsed: number; textChars: number; origin: string; licensed: boolean; products: number; sections: number; ctaCount: number; eventCards?: number };
  benefitStripped: number;
  heroFallback: boolean;
  look: { treatments?: number; backgrounds?: number } | null;
}
interface BrandLine { name: string; primary: string | null; logo: string | null }
type Phase = 'idle' | 'materials' | 'read' | 'generate' | 'render';
const PHASE_TEXT: Record<Phase, string> = {
  idle: '',
  materials: '재료를 저장하고 있습니다',
  read: '비어 있는 행사 내용을 이미지에서 읽고 있습니다',
  generate: '구성과 문구를 만들고 있습니다',
  render: '시안을 그리고 있습니다',
};

const token = () => localStorage.getItem('token');
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });
// "내용이 있다" 판정은 카드 컴포넌트의 체크박스 활성 조건과 같은 하나(비어 있지 않음) — 짧은 문구를 빈 것으로 보고 판독으로 덮지 않는다(리뷰 #14)
const hasCardText = (c: EventCardValue) => c.text.trim().length > 0;
const cardIsFilled = (c: EventCardValue) => c.files.length > 0 || hasCardText(c) || c.title.trim().length > 0;

export default function QuickCampaignPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [resumeRefresh, setResumeRefresh] = useState(0);

  // ★ v3 행사 카드 재료 입구
  const [cards, setCards] = useState<EventCardValue[]>([newEventCard()]);
  const [brand, setBrand] = useState<BrandLine | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickResult | null>(null);
  const [previewWidth, setPreviewWidth] = useState<375 | 600>(375);
  const inputCardRef = useRef<HTMLDivElement>(null);

  const filled = cards.filter(cardIsFilled);
  const imageCount = filled.reduce((a, c) => a + c.files.length, 0);
  const anyText = filled.some(hasCardText);
  // 판독 = 이미지는 있는데 내용이 빈 카드가 하나라도 있으면 1회(대표 이미지 묶음 · 곱셈 0)
  const readsNeeded = filled.some((c) => c.files.length > 0 && !hasCardText(c)) ? 1 : 0;
  const canRun = filled.some((c) => c.files.length > 0 || hasCardText(c));
  const busy = phase !== 'idle';

  // 브랜드 줄 — 서버 브랜드 킷 그대로(표시만 · 편집은 DM 빌더 브랜드 킷)
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch('/api/dm/brand-kit', { headers: jsonHeaders(), signal: ctrl.signal });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return;
        const kit: any = d?.brand_kit || {};
        setBrand({ name: String(kit.brand_name || kit.store_name || ''), primary: typeof kit.primary_color === 'string' && /^#[0-9a-f]{6}$/i.test(kit.primary_color) ? kit.primary_color : null, logo: typeof kit.logo_url === 'string' && kit.logo_url ? kit.logo_url : null });
      } catch { /* 브랜드 줄은 표시만 · 실패 = 줄 생략 */ }
    })();
    return () => ctrl.abort();
  }, []);

  // 견적 — 입력이 바뀔 때마다(서버 견적 · 화면은 표시만)
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/event-campaigns/materials/quote?images=${imageCount}&has_text=${anyText ? 1 : 0}&reads=${readsNeeded}`, { headers: jsonHeaders(), signal: ctrl.signal });
        const d = await r.json();
        if (r.ok && d?.success) setQuote({ enabled: d.enabled !== false, plan_locked: !!d.plan_locked, total: Number(d.total) || 0, parts: Array.isArray(d.parts) ? d.parts : [] });
      } catch { /* 견적 실패 = 버튼에 금액을 표시하지 않는다(차감은 서버가 정한다) */ }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [imageCount, anyText, readsNeeded]);

  // 로딩 3층 — 경과 초(3초 스피너 · 이후 단계 텍스트 · 15초 넘으면 안심 문구)
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const run = useCallback(async () => {
    setConfirmOpen(false);
    setError(null);
    setResult(null);
    try {
      const use = cards.filter(cardIsFilled);
      // 1) 카드 이미지 업로드(read=0 · 판독 0) — **카드마다 요청 1개**(서버가 형식 판별로 한 장을 빼도 다른 카드로 밀리지 않는다 · 리뷰 #4)
      setPhase('materials');
      const cardImages: Array<Array<{ url: string; width?: number | null; height?: number | null }>> = [];
      let skipped = 0;
      for (const [ci, c] of use.entries()) {
        if (c.files.length === 0) { cardImages.push([]); continue; }
        const fd = new FormData();
        c.files.forEach((f, i) => fd.append('images', f, f.name || `card${ci + 1}_${i + 1}`));
        fd.append('read', '0');
        const mr = await fetch('/api/event-campaigns/materials', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
        const md = await mr.json().catch(() => ({}));
        if (!mr.ok || md?.success === false) throw new Error(String(md?.error || '재료를 저장하지 못했습니다.'));
        const imgs = Array.isArray(md.images) ? md.images : [];
        if (imgs.length < c.files.length) skipped += c.files.length - imgs.length;
        cardImages.push(imgs);
      }
      if (skipped > 0) toast.error(`${skipped}장은 이미지 형식을 확인하지 못해 제외했습니다.`);

      // 2) 내용이 빈 카드의 대표 이미지만 묶어 판독 1회(3크레딧 고정) — 읽은 글은 첫 빈 카드의 내용으로(면허 아님 · 확인 뒤 다시 만들면 면허)
      const texts = use.map((c) => c.text.trim());
      const readIdx = use.map((c, i) => (cardImages[i].length > 0 && !hasCardText(c) ? i : -1)).filter((i) => i >= 0);
      let readText = '';
      if (readIdx.length) {
        setPhase('read');
        const fd = new FormData();
        readIdx.forEach((i) => { const f = use[i].files[0]; if (f) fd.append('images', f, f.name || `card${i + 1}_1`); });
        const rr = await fetch('/api/event-campaigns/materials', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
        const rd = await rr.json().catch(() => ({}));
        if (rd?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
        if (!rr.ok || rd?.success === false) throw new Error(String(rd?.error || '이미지에서 내용을 읽지 못했습니다.'));
        readText = String(rd.event_text || '');
        if (readText) texts[readIdx[0]] = readText;
      }

      // 3) 엔진 조립 → 초안 DM(행사 카드 ≤3 · 카드당 이미지 ≤3 · 면허 = 체크한 카드만)
      setPhase('generate');
      const eventCards = use.map((c, i) => ({
        id: c.id, title: c.title.trim(), text: texts[i], licensed: c.licensed && hasCardText(c), link: c.link.trim() || null,
        images: cardImages[i].map((im) => ({ url: im.url, width: im.width ?? null, height: im.height ?? null })),
      }));
      const firstLink = use.find((c) => c.link.trim())?.link.trim() || null;
      const gr = await fetch('/api/dm/ai/one-shot-generate', {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ materials: { eventCards, images: [], event_text: '', extracted: false, events: null, link: firstLink } }),
      });
      const gd = await gr.json().catch(() => ({}));
      if (gd?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (!gr.ok || gd?.success === false || !gd?.data?.draft_id) throw new Error(String(gd?.error || '시안을 만들지 못했습니다.'));
      const data = gd.data;

      // 판독본은 카드 입력칸에 채워 보여준다(확인·수정하고 다시 만들면 면허로 승격)
      if (readText) setCards((cur) => cur.map((c) => (c.id === use[readIdx[0]].id ? { ...c, text: readText } : c)));

      // 4) 시안 렌더(샘플 고객 기준 · 같은 초안 id)
      setPhase('render');
      let html: string | null = null;
      try {
        const rr = await fetch(`/api/dm/${data.draft_id}/render-sample`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({}) });
        const rd = await rr.json().catch(() => ({}));
        if (rr.ok && rd?.html) html = String(rd.html);
      } catch { /* 렌더 실패 = 판정 줄만 · 편집으로는 열린다 */ }

      setResult({
        draftId: String(data.draft_id), html,
        cards: use.map((c, i) => ({ title: c.title.trim() || `행사 ${i + 1}`, images: cardImages[i], textChars: texts[i].length, licensed: c.licensed && hasCardText(c), read: readIdx.includes(i) })),
        meta: data.materials || { images: imageCount, imagesUsed: 0, textChars: texts.join('').length, origin: readText ? 'vision' : 'user', licensed: use.some((c) => c.licensed), products: 0, sections: Array.isArray(data.sections) ? data.sections.length : 0, ctaCount: 0, eventCards: use.length },
        benefitStripped: Number(data.benefitStripped) || 0,
        heroFallback: data.heroFallback === true,
        look: data.look || null,
      });
      toast.success('시안이 만들어졌습니다. 아래에서 확인하세요.');
      setResumeRefresh((v) => v + 1);
    } catch (e: any) {
      setError(e?.message || '시안을 만들지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setPhase('idle');
    }
  }, [cards, imageCount, toast]);

  const startNew = () => { setResumeDraftId(null); setOpen(true); };
  const backToInput = () => { inputCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const resetAll = () => { setResult(null); setError(null); setCards([newEventCard()]); backToInput(); };

  const enabled = quote ? quote.enabled : true;
  const planLocked = !!quote?.plan_locked;
  const verdicts = result ? [
    { label: '행사 카드', value: `${Number(result.meta.eventCards ?? result.cards.length)}건 반영`, ok: Number(result.meta.eventCards ?? result.cards.length) > 0 },
    { label: '올린 이미지', value: `${result.meta.imagesUsed}/${result.meta.images}장 배치`, ok: result.meta.images === 0 || result.meta.imagesUsed > 0 },
    { label: '구획', value: `${result.meta.sections}개`, ok: result.meta.sections >= 9 && result.meta.sections <= 13 },
    { label: '버튼', value: `${result.meta.ctaCount}개`, ok: result.meta.ctaCount >= 2 },
    { label: '혜택 수치', value: result.meta.licensed ? '체크한 문구 그대로 반영' : (result.benefitStripped > 0 ? `${result.benefitStripped}곳 비움(그대로 쓰려면 카드에서 체크)` : '해당 없음'), ok: result.meta.licensed || result.benefitStripped === 0 },
    { label: '헤드라인', value: result.heroFallback ? '브랜드명으로 대체(행사 제목을 쓰고 다시 만들면 나아집니다)' : '행사 제목 반영', ok: !result.heroFallback },
    { label: '구도', value: `${(Number(result.look?.treatments) || 0) + (Number(result.look?.backgrounds) || 0)}곳 배정`, ok: (Number(result.look?.treatments) || 0) + (Number(result.look?.backgrounds) || 0) > 0 },
  ] : [];

  return (
    <div className={OUI_PAGE}>
      <OperatorAura />
      {/* 헤더 (sticky) */}
      <div className={OUI_HEADER}>
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => goBackOr(navigate, '/ai-operator')}
            className={OUI_BACK}
            aria-label="AI Operator로 돌아가기"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className={`${OUI_ICON_TILE} bg-gradient-to-br from-amber-400 to-fuchsia-500`}>
            <Wand2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className={OUI_TITLE}>원클릭 캠페인</h1>
            <p className={OUI_SUBTITLE}>행사를 카드로 올려 두고 [제작] 하나로 모바일 DM 시안을 받습니다</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        {/* ★ v3 재료 페이지 — 브랜드 줄 · 행사 카드 목록 · 하단 바 */}
        {enabled && (
          <div ref={inputCardRef} className={`${OUI_CARD} p-5 md:p-6 space-y-4`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-fuchsia-300" /> 행사 재료로 시안 만들기
                </div>
                <p className="text-[12px] text-white/50 mt-1">행사마다 카드 하나(제목 · 내용 · 이미지 · 링크). 카드가 여러 개면 첫 카드가 첫 화면, 다음 카드는 설명 카드와 버튼으로 이어집니다. 설명 없는 이미지 블록은 만들지 않습니다.</p>
              </div>
              {planLocked && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-200 border border-amber-400/30"><Lock className="w-3 h-3" /> 모바일 DM 요금제에서 열립니다</span>
              )}
            </div>

            {/* 브랜드 줄 — 서버 브랜드 킷 그대로(표시만) */}
            {brand && (brand.name || brand.primary || brand.logo) && (
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2">
                {brand.logo ? <img src={brand.logo} alt="" className="h-6 max-w-[96px] object-contain" /> : null}
                <span className="text-sm text-white/85 font-medium">{brand.name || '우리 브랜드'}</span>
                {brand.primary ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-white/60"><span className="w-4 h-4 rounded-full border border-white/20" style={{ background: brand.primary }} /> 주색 {brand.primary}</span>
                ) : (
                  <span className="text-[11px] text-white/45">주색 미설정 · 무채색으로 만들고 DM 빌더의 브랜드 킷에서 바꿀 수 있습니다</span>
                )}
                <span className="ml-auto text-[11px] text-white/35">브랜드 킷 기준</span>
              </div>
            )}

            <EventCardsInput value={cards} onChange={setCards} disabled={busy || planLocked} onReject={(m) => toast.error(m)} />

            {/* 하단 바 — 견적 1줄 + [제작] 1개 */}
            <div className="sticky bottom-3 z-10 rounded-2xl bg-slate-950/90 backdrop-blur border border-white/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-white/55">
                {quote ? (
                  <>
                    {quote.parts.map((p) => `${p.label} ${p.cost}`).join(' + ')} = <span className="text-white/85 font-medium">{quote.total} 크레딧</span>
                    {readsNeeded ? ' · 내용이 빈 카드의 대표 이미지에서 내용을 먼저 읽습니다(1회)' : ''}
                    {` · 행사 ${filled.length}건 · 이미지 ${imageCount}장`}
                  </>
                ) : '크레딧 견적을 계산하는 중입니다'}
              </p>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={!canRun || busy || planLocked}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-500 text-indigo-950 text-sm font-bold hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 transition-all"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {busy ? '만드는 중' : '제작'}
              </button>
            </div>
            {busy && (
              <div className="rounded-xl bg-violet-500/10 border border-violet-400/20 px-4 py-3 text-sm text-violet-100 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                <span>
                  {elapsed < 3 ? '시작합니다' : PHASE_TEXT[phase]}
                  {elapsed >= 15 ? ' · 보통 20~40초 걸립니다. 창을 닫지 말고 잠시만 기다려 주세요.' : ''}
                </span>
              </div>
            )}
            {error && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 px-4 py-3 text-sm text-rose-100">{error}</div>
            )}
          </div>
        )}

        {/* 결과 2열 — 쓴 재료(카드별) · 판정 / 다크 액자 시안(폭 토글) */}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_420px] gap-4">
            <div className="space-y-4">
              <div className={`${OUI_CARD} p-5 space-y-3`}>
                <div className="text-sm font-bold text-white">쓴 재료</div>
                <ul className="space-y-2">
                  {result.cards.map((c, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-violet-500/30 text-violet-100 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-white/90 truncate">{c.title}</div>
                        <div className="text-[11px] text-white/50">
                          이미지 {c.images.length}장 · 내용 {c.textChars}자{c.licensed ? ' · 문구 그대로' : ''}{c.read ? ' · 이미지에서 읽음(확인 뒤 체크하면 그대로 반영)' : ''}
                        </div>
                        {c.images.length > 0 && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            {c.images.map((im) => <img key={im.url} src={im.url} alt="" className="w-12 h-12 rounded-md object-cover border border-white/10 bg-slate-900" />)}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={`${OUI_CARD} p-5 space-y-2`}>
                <div className="text-sm font-bold text-white">판정</div>
                <ul className="space-y-1.5">
                  {verdicts.map((v) => (
                    <li key={v.label} className="flex items-start gap-2 text-[12px]">
                      <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${v.ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className="text-white/50 w-20 shrink-0">{v.label}</span>
                      <span className="text-white/85">{v.value}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-2 flex-wrap pt-2">
                  <button onClick={() => navigate(`/dm-builder?id=${encodeURIComponent(result.draftId)}`)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold">
                    <PencilLine className="w-4 h-4" /> DM 편집으로
                  </button>
                  <button onClick={backToInput}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-violet-400/30 text-violet-100 text-sm hover:bg-violet-500/15">
                    <ImagePlus className="w-4 h-4" /> 카드 고치고 다시 만들기
                  </button>
                  <button onClick={resetAll} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-white/60 text-sm hover:bg-white/10">
                    <RotateCcw className="w-4 h-4" /> 새로 시작
                  </button>
                </div>
                <p className={OUI_SRC}>Data source: 올린 행사 카드 · 서버가 조립한 초안(초안은 모바일 DM 목록에 저장됩니다)</p>
              </div>
            </div>
            <div className="bg-slate-950 rounded-2xl border border-white/10 p-3 md:p-4 min-h-[560px]">
              <div className="mb-2 flex items-center justify-end gap-1">
                <button onClick={() => setPreviewWidth(600)} className={`p-1.5 rounded-lg ${previewWidth === 600 ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`} title="데스크탑 폭"><Monitor className="w-4 h-4" /></button>
                <button onClick={() => setPreviewWidth(375)} className={`p-1.5 rounded-lg ${previewWidth === 375 ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white'}`} title="모바일 폭"><Smartphone className="w-4 h-4" /></button>
              </div>
              {result.html ? (
                <iframe title="모바일 DM 시안" srcDoc={result.html} sandbox="allow-same-origin" className="mx-auto block max-w-full h-[720px] rounded-xl bg-white border border-white/10 transition-all" style={{ width: previewWidth }} />
              ) : (
                <div className="text-sm text-white/50 py-20 text-center">시안 미리보기를 그리지 못했습니다. [DM 편집으로]에서 확인할 수 있습니다.</div>
              )}
            </div>
          </div>
        )}

        <EventCampaignResumeBar
          refreshKey={resumeRefresh}
          onResume={(id) => { setResumeDraftId(id); setOpen(true); }}
        />

        {/* 3채널(DM·이메일·인앱) 세트 시작 카드 — 옛 흐름 그대로 */}
        <div className="rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 p-6 text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-fuchsia-500/25 mb-3">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div className="text-sm font-bold text-white">DM·이메일·인앱 한 번에</div>
          <p className="text-[12px] text-white/50 mt-1 mb-4">행사 내용을 붙여넣거나 이미지를 올리면, 고른 채널(DM·이메일·인앱) 초안을 한 번에 만들어 드려요.</p>
          <button
            onClick={startNew}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-violet-400/40 text-violet-100 text-sm font-semibold hover:bg-violet-500/15 transition-colors"
          >
            <Wand2 className="w-4 h-4" /> 3채널 세트 만들기
          </button>
        </div>
      </div>

      <EventCampaignModal
        open={open}
        resumeDraftId={resumeDraftId || undefined}
        onClose={() => { setOpen(false); setResumeDraftId(null); setResumeRefresh((v) => v + 1); }}
      />
      <CreditConfirmModal
        open={confirmOpen}
        source="dm-ai-generate"
        costOverride={quote ? quote.total : undefined}
        description={quote ? `${quote.parts.map((p) => p.label).join(' + ')} · 행사 ${filled.length}건 · 초안은 모바일 DM 목록에 저장되고 편집기에서 이어서 손볼 수 있습니다.` : undefined}
        onConfirm={run}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
