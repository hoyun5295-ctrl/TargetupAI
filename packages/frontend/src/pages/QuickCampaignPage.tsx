import { OUI_BACK, OUI_CARD, OUI_HEADER, OUI_ICON_TILE, OUI_PAGE, OUI_SRC, OUI_SUBTITLE, OUI_TITLE } from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';
/**
 * QuickCampaignPage — 원클릭 캠페인 (2026-07-08 · ★ 2026-09-06 S5 재료 입구 인라인)
 *
 * SUB_MODULE_CARDS "원클릭 캠페인" 타일(/quick-campaign)의 집.
 * ★ S5: 첫 화면 = 재료 입력(이미지 몇 장 + 행사 텍스트 + 링크) 한 칸 + 버튼 1개. 클릭 즉시 재료 저장(텍스트 비면 판독 자동 선행) → 아웃리치 엔진 조립 → 초안 DM 생성 →
 *   결과는 같은 페이지 본문 2열(재료 스트립 · 판정 줄 / 다크 액자 시안) · [DM 편집으로]는 같은 초안 id 로 연다. 크레딧은 서버 견적(costOverride) 그대로.
 * 옛 3채널 흐름(EventCampaignModal)은 아래 카드의 버튼으로 그대로 열린다(무접촉). 임시 보관 세트 재개(EventCampaignResumeBar)도 그대로.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Sparkles, Wand2, Loader2, PencilLine, ImagePlus, RotateCcw, Lock } from 'lucide-react';
import EventCampaignModal from '../components/EventCampaignModal';
import EventCampaignResumeBar from '../components/EventCampaignResumeBar';
import MaterialInput, { type MaterialValue } from '../components/MaterialInput';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';

interface Quote { enabled: boolean; plan_locked: boolean; total: number; parts: Array<{ key: string; label: string; cost: number }> }
interface QuickResult {
  draftId: string;
  html: string | null;
  images: Array<{ url: string }>;
  text: string;
  extracted: boolean;
  meta: { images: number; imagesUsed: number; textChars: number; origin: string; licensed: boolean; products: number; sections: number; ctaCount: number };
  benefitStripped: number;
  heroFallback: boolean;
  look: { treatments?: number; backgrounds?: number } | null;
}
type Phase = 'idle' | 'materials' | 'generate' | 'render';
const PHASE_TEXT: Record<Phase, string> = {
  idle: '',
  materials: '재료를 저장하고 있습니다',
  generate: '구성과 문구를 만들고 있습니다',
  render: '시안을 그리고 있습니다',
};

const token = () => localStorage.getItem('token');
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });

export default function QuickCampaignPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [resumeRefresh, setResumeRefresh] = useState(0);

  // ★ S5 재료 입구
  const [material, setMaterial] = useState<MaterialValue>({ files: [], text: '', link: '' });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuickResult | null>(null);
  const inputCardRef = useRef<HTMLDivElement>(null);

  const hasText = material.text.trim().length >= 10;
  const canRun = material.files.length > 0 || hasText;
  const busy = phase !== 'idle';

  // 견적 — 입력이 바뀔 때마다(서버 견적 · 화면은 표시만)
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/event-campaigns/materials/quote?images=${material.files.length}&has_text=${hasText ? 1 : 0}`, { headers: jsonHeaders(), signal: ctrl.signal });
        const d = await r.json();
        if (r.ok && d?.success) setQuote({ enabled: d.enabled !== false, plan_locked: !!d.plan_locked, total: Number(d.total) || 0, parts: Array.isArray(d.parts) ? d.parts : [] });
      } catch { /* 견적 실패 = 버튼에 금액을 표시하지 않는다(차감은 서버가 정한다) */ }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [material.files.length, hasText]);

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
      // 1) 재료 저장(+ 텍스트 비면 판독)
      setPhase('materials');
      const fd = new FormData();
      material.files.forEach((f, i) => fd.append('images', f, f.name || `material_${i + 1}`));
      if (hasText) fd.append('event_text', material.text.trim());
      const mr = await fetch('/api/event-campaigns/materials', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
      const md = await mr.json().catch(() => ({}));
      if (md?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (!mr.ok || md?.success === false) throw new Error(String(md?.error || '재료를 저장하지 못했습니다.'));
      const images: Array<{ url: string; width?: number | null; height?: number | null }> = Array.isArray(md.images) ? md.images : [];
      const text = String(md.event_text || '');
      const extracted = md.extracted === true;
      // 판독본은 입력칸에 채워 보여준다(사용자가 확인·수정하고 다시 만들면 면허로 승격)
      if (extracted && text) setMaterial((cur) => ({ ...cur, text }));

      // 2) 엔진 조립 → 초안 DM
      setPhase('generate');
      const gr = await fetch('/api/dm/ai/one-shot-generate', {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ materials: { images, event_text: text, extracted, events: md.events || null, link: material.link.trim() || null } }),
      });
      const gd = await gr.json().catch(() => ({}));
      if (gd?.code === 'INSUFFICIENT_CREDIT') throw new Error('크레딧이 부족합니다. 충전 후 이용해주세요.');
      if (!gr.ok || gd?.success === false || !gd?.data?.draft_id) throw new Error(String(gd?.error || '시안을 만들지 못했습니다.'));
      const data = gd.data;

      // 3) 시안 렌더(샘플 고객 기준 · 같은 초안 id)
      setPhase('render');
      let html: string | null = null;
      try {
        const rr = await fetch(`/api/dm/${data.draft_id}/render-sample`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({}) });
        const rd = await rr.json().catch(() => ({}));
        if (rr.ok && rd?.html) html = String(rd.html);
      } catch { /* 렌더 실패 = 판정 줄만 · 편집으로는 열린다 */ }

      setResult({
        draftId: String(data.draft_id), html, images, text, extracted,
        meta: data.materials || { images: images.length, imagesUsed: 0, textChars: text.length, origin: extracted ? 'vision' : (text ? 'user' : 'empty'), licensed: !extracted && !!text, products: 0, sections: Array.isArray(data.sections) ? data.sections.length : 0, ctaCount: 0 },
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
  }, [material, hasText, toast]);

  const startNew = () => { setResumeDraftId(null); setOpen(true); };
  const backToInput = () => { inputCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const resetAll = () => { setResult(null); setError(null); setMaterial({ files: [], text: '', link: '' }); backToInput(); };

  const enabled = quote ? quote.enabled : true;
  const planLocked = !!quote?.plan_locked;
  const verdicts = result ? [
    { label: '올린 이미지', value: `${result.meta.imagesUsed}/${result.meta.images}장 배치`, ok: result.meta.images === 0 || result.meta.imagesUsed > 0 },
    { label: '구획', value: `${result.meta.sections}개`, ok: result.meta.sections >= 7 },
    { label: '버튼', value: `${result.meta.ctaCount}개`, ok: result.meta.ctaCount >= 2 },
    { label: '혜택 수치', value: result.meta.licensed ? '입력하신 문구 그대로 반영' : (result.benefitStripped > 0 ? `${result.benefitStripped}곳 비움(판독본은 확인 뒤 반영)` : '해당 없음'), ok: result.meta.licensed || result.benefitStripped === 0 },
    { label: '헤드라인', value: result.heroFallback ? '브랜드명으로 대체(문구를 붙여 넣고 다시 만들면 나아집니다)' : '행사 문구 반영', ok: !result.heroFallback },
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
            <p className={OUI_SUBTITLE}>이미지 몇 장과 행사 내용만 올리면 모바일 DM 시안이 바로 나옵니다</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        {/* ★ S5 재료 입력 한 칸 + 버튼 1개 */}
        {enabled && (
          <div ref={inputCardRef} className={`${OUI_CARD} p-5 md:p-6 space-y-4`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-fuchsia-300" /> 재료로 바로 시안 만들기
                </div>
                <p className="text-[12px] text-white/50 mt-1">행사 이미지와 내용을 넣으면 첫 화면 · 상품 · 버튼 · 꼬리말까지 갖춘 모바일 DM 초안이 만들어지고, 편집기에서 바로 이어서 손볼 수 있습니다.</p>
              </div>
              {planLocked && (
                <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-200 border border-amber-400/30"><Lock className="w-3 h-3" /> 모바일 DM 요금제에서 열립니다</span>
              )}
            </div>
            <MaterialInput value={material} onChange={setMaterial} disabled={busy || planLocked} onReject={(m) => toast.error(m)} />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-white/45">
                {quote ? (
                  <>
                    {quote.parts.map((p) => `${p.label} ${p.cost}`).join(' + ')} = <span className="text-white/80 font-medium">{quote.total} 크레딧</span>
                    {!hasText && material.files.length > 0 ? ' · 텍스트가 비어 이미지에서 내용을 먼저 읽습니다' : ''}
                  </>
                ) : '크레딧 견적을 계산하는 중입니다'}
              </p>
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={!canRun || busy || planLocked}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-fuchsia-500 text-indigo-950 text-sm font-bold hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100 transition-all"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                {busy ? '만드는 중' : '모바일 DM 시안 만들기'}
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

        {/* ★ S5 결과 2열 — 재료 스트립 · 판정 / 다크 액자 시안 */}
        {result && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_400px] gap-4">
            <div className="space-y-4">
              <div className={`${OUI_CARD} p-5 space-y-3`}>
                <div className="text-sm font-bold text-white">쓴 재료</div>
                {result.images.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {result.images.map((im) => (
                      <img key={im.url} src={im.url} alt="재료 이미지" className="w-16 h-16 rounded-lg object-cover border border-white/10 bg-slate-900" />
                    ))}
                  </div>
                )}
                {result.text && (
                  <p className="text-[12px] text-white/60 whitespace-pre-wrap line-clamp-6">{result.text}</p>
                )}
                {result.extracted && (
                  <p className="text-[11px] text-amber-200/90">이미지에서 읽은 내용입니다. 위 입력칸에 채워 두었으니 확인·수정한 뒤 다시 만들면 혜택 수치가 그대로 반영됩니다.</p>
                )}
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
                    <ImagePlus className="w-4 h-4" /> 사진 더 올리고 다시 만들기
                  </button>
                  <button onClick={resetAll} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-white/60 text-sm hover:bg-white/10">
                    <RotateCcw className="w-4 h-4" /> 새로 시작
                  </button>
                </div>
                <p className={OUI_SRC}>Data source: 올린 재료 · 서버가 조립한 초안(초안은 모바일 DM 목록에 저장됩니다)</p>
              </div>
            </div>
            <div className="bg-slate-950 rounded-2xl border border-white/10 p-3 md:p-4 min-h-[560px] flex items-start justify-center">
              {result.html ? (
                <iframe title="모바일 DM 시안" srcDoc={result.html} sandbox="allow-same-origin" className="w-[375px] max-w-full h-[720px] rounded-xl bg-white border border-white/10" />
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
        description={quote ? `${quote.parts.map((p) => p.label).join(' + ')} · 초안은 모바일 DM 목록에 저장되고 편집기에서 이어서 손볼 수 있습니다.` : undefined}
        onConfirm={run}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
