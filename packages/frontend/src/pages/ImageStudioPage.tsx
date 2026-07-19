/**
 * ImageStudioPage — P4 AI 이미지 스튜디오 (2026-07-19 v2 · 템플릿 갤러리 재정의)
 *
 * 흐름(Harold 확정): 템플릿(=서버 은닉 프롬프트) 선택 → 원본 이미지 넣기(누끼 자동) → 간단 문구 입력
 *   → 생성 AI가 [제품 + 어울리는 배경 + 지정 문구 타이포]를 한 장의 완성 포스터로 렌더
 *   → 인앱(3:4)·모바일DM(1:1)·이메일(16:9)·MMS(≤300KB 자동) 사이즈로 각각 제작 → 라이브러리 저장.
 *  - 문구 = 고객사가 직접 지정한 텍스트만 이미지에 새김(AI 임의 혜택 생성 없음).
 *  - temp 산출물 = fetch+blob 표시(인증 endpoint) · 7일 후 자동 삭제.
 *  - 모델명 UI 노출 금지 / native dialog 금지(useToast).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ImagePlus, Loader2, ShoppingBag, Upload, Wand2,
  Check, Save, Maximize2, PenLine, ChevronLeft, Sparkles,
} from 'lucide-react';
import { goBackOr } from '../lib/scroll-restoration';
import { useToast } from '../components/ToastProvider';
import MallProductPickerModal, { type PickedMallProduct } from '../components/dm/MallProductPickerModal';

const token = () => localStorage.getItem('token');
const authFetch = (url: string, opts: RequestInit = {}) =>
  fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token()}` } });
const postJson = async (url: string, body: any) => {
  const r = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { r, d };
};
const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}원`;

interface StudioTemplatePublic {
  id: string; name: string; category: string; desc: string; accent: string;
  exampleUrl: string | null;
  defaultTexts: { label?: string; title?: string; subtitle?: string };
}
interface Candidate { tempId: string; url: string; blob?: string; presetKey: string }

// 채널 사이즈 (백엔드 CHANNEL_PRESETS와 key 1:1)
// ★ MMS 전용 생성 없음(Harold 확정 2026-07-19) — 항상 고품질 생성·저장, MMS는 발송 시 라이브러리 소재 자동 변환.
const PRESETS = [
  { key: 'inapp-poster', label: '인앱 포스터', sub: '3:4' },
  { key: 'dm-card', label: '모바일 DM', sub: '1:1' },
  { key: 'email-hero', label: '이메일 히어로', sub: '16:9' },
];
const presetLabel = (key: string) => PRESETS.find((p) => p.key === key)?.label || key;

type Stage = 'gallery' | 'setup' | 'result';

export default function ImageStudioPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [ready, setReady] = useState(true);
  const [stage, setStage] = useState<Stage>('gallery');
  const [busyMsg, setBusyMsg] = useState('');

  // 템플릿
  const [templates, setTemplates] = useState<StudioTemplatePublic[]>([]);
  const [category, setCategory] = useState<string>('전체');
  const [template, setTemplate] = useState<StudioTemplatePublic | null>(null);

  // 상품·누끼
  const [product, setProduct] = useState<PickedMallProduct | null>(null);
  const [cutoutTempId, setCutoutTempId] = useState<string | null>(null);
  const [cutoutBlob, setCutoutBlob] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 문구·채널·힌트
  const [texts, setTexts] = useState({ label: '', title: '', subtitle: '' });
  const [presetKey, setPresetKey] = useState('inapp-poster');
  const [hint, setHint] = useState('');

  // 결과
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const objectUrls = useRef<string[]>([]);
  const loadBlob = useCallback(async (url: string): Promise<string> => {
    const r = await authFetch(url);
    const b = await r.blob();
    const u = URL.createObjectURL(b);
    objectUrls.current.push(u);
    return u;
  }, []);

  useEffect(() => {
    authFetch('/api/image-studio/status').then((r) => r.json()).then((d) => setReady(!!d?.ready)).catch(() => setReady(true));
    authFetch('/api/image-studio/templates').then((r) => r.json()).then((d) => setTemplates(Array.isArray(d?.templates) ? d.templates : [])).catch(() => setTemplates([]));
    return () => { objectUrls.current.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  const categories = useMemo(() => ['전체', ...Array.from(new Set(templates.map((t) => t.category)))], [templates]);
  const visibleTemplates = useMemo(
    () => (category === '전체' ? templates : templates.filter((t) => t.category === category)),
    [templates, category],
  );

  // 템플릿·상품 변경 시 문구 자동 채움 ({productName}/{salePrice} = 몰 실데이터 — 사용자 수정 가능)
  const fillTokens = useCallback((s?: string) => (s || '')
    .replace(/\{productName\}/g, product?.name || '')
    .replace(/\{salePrice\}/g, product?.salePrice ? won(product.salePrice) : ''), [product]);
  useEffect(() => {
    if (!template) return;
    setTexts({
      label: fillTokens(template.defaultTexts.label),
      title: fillTokens(template.defaultTexts.title),
      subtitle: fillTokens(template.defaultTexts.subtitle),
    });
  }, [template, product, fillTokens]);

  // ── 상품 준비: 인제스트/업로드 → 누끼 ─────────────────────────
  const prepareProduct = async (imageUrl: string | null, fromUpload?: File) => {
    setBusyMsg('상품 이미지 준비 중...');
    try {
      let sourceTempId: string | null = null;
      if (fromUpload) {
        const fd = new FormData();
        fd.append('image', fromUpload);
        const r = await authFetch('/api/image-studio/upload-product', { method: 'POST', body: fd });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d?.success) throw new Error(d?.error || '업로드 실패');
        sourceTempId = d.source.tempId;
      } else if (imageUrl) {
        const { r, d } = await postJson('/api/image-studio/ingest-product', { url: imageUrl });
        if (!r.ok || !d?.success) throw new Error(d?.error || '상품 이미지를 가져오지 못했어요');
        sourceTempId = d.source.tempId;
      }
      if (!sourceTempId) throw new Error('상품 이미지가 없습니다');

      setBusyMsg('제품 누끼 따는 중... (배경 자동 제거)');
      const { r: r2, d: d2 } = await postJson('/api/image-studio/remove-bg', { sourceTempId });
      if (!r2.ok || !d2?.success) throw new Error(d2?.error || '누끼에 실패했어요');
      setCutoutTempId(d2.cutout.tempId);
      setCutoutBlob(await loadBlob(`/api/image-studio/temp/${d2.cutout.tempId}`));
      toast.success('제품 준비 완료 — 원본 그대로 포스터에 들어갑니다');
    } catch (e: any) {
      toast.error(e?.message || '상품 준비에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  const onPickMall = (products: PickedMallProduct[]) => {
    const p = products[0];
    if (!p) return;
    setProduct(p);
    setCutoutTempId(null); setCutoutBlob(null);
    if (p.imageUrl) prepareProduct(p.imageUrl);
    else toast.error('이 상품은 이미지가 없어요 — 다른 상품을 선택해주세요');
  };
  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProduct(null);
    setCutoutTempId(null); setCutoutBlob(null);
    prepareProduct(null, f);
    e.target.value = '';
  };

  // ── 완성 포스터 생성 (템플릿 + 누끼 + 지정 문구, 2크레딧·후보 2장) ──
  const generate = async (overridePreset?: string) => {
    if (!template) { toast.error('템플릿을 먼저 골라주세요'); return; }
    if (!ready) { toast.error('이미지 스튜디오가 준비 중입니다'); return; }
    const useKey = overridePreset || presetKey;
    setBusyMsg('완성 포스터를 만드는 중... (약 20~30초)');
    try {
      const { r, d } = await postJson('/api/image-studio/generate', {
        templateId: template.id, presetKey: useKey,
        texts, userHint: hint || null, cutoutTempId,
      });
      if (r.status === 402) { toast.error('크레딧이 부족합니다 — 충전 후 다시 시도해주세요'); return; }
      if (r.status === 409) { toast.error(d?.error || '다른 생성이 진행 중입니다'); return; }
      if (!r.ok || !d?.success) throw new Error(d?.error || '생성에 실패했어요');
      if (d.benefitNotice) toast.success(d.benefitNotice);
      const imgs: Candidate[] = (d.images || []).map((im: any) => ({ ...im, presetKey: im.presetKey || useKey }));
      for (const im of imgs) im.blob = await loadBlob(im.url);
      setCandidates((prev) => [...imgs, ...prev]);
      setStage('result');
      if (d.partial) toast.success('1장만 생성됐어요 (1크레딧만 차감)');
    } catch (e: any) {
      toast.error(e?.message || '생성에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  // ── 4K 격상 / AI 수정 (멀티턴 보존) ──────────────────────────
  const editOrUpscale = async (c: Candidate, targetSize?: '4K', instruction?: string) => {
    setBusyMsg(targetSize === '4K' ? '같은 구도로 4K 격상 중... (약 30초)' : 'AI가 포스터를 수정하는 중...');
    try {
      const { r, d } = await postJson('/api/image-studio/edit', { tempId: c.tempId, targetSize, instruction });
      if (r.status === 402) { toast.error('크레딧이 부족합니다'); return; }
      if (!r.ok || !d?.success) throw new Error(d?.error || '수정에 실패했어요');
      const blob = await loadBlob(d.image.url);
      setCandidates((prev) => [{ tempId: d.image.tempId, url: d.image.url, blob, presetKey: c.presetKey }, ...prev]);
      toast.success(targetSize === '4K' ? '4K 격상 완료' : '수정 완료');
      setEditFor(null); setEditText('');
    } catch (e: any) {
      toast.error(e?.message || '수정에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  // ── 저장 (MMS 트랙 = 서버가 ≤300KB 자동 압축) ─────────────────
  const save = async (c: Candidate) => {
    setBusyMsg('라이브러리에 저장 중...');
    try {
      const { r, d } = await postJson('/api/image-studio/save', { tempId: c.tempId });
      if (r.status === 503 && d?.code === 'DB_MIGRATION_PENDING') { toast.error('라이브러리 준비 중 — 운영자에게 문의해주세요'); return; }
      if (r.status === 409) { toast.error(d?.error || '이미 저장됐어요'); return; }
      if (!r.ok || !d?.success) throw new Error(d?.error || '저장에 실패했어요');
      toast.success('라이브러리에 저장했어요 — MMS 발송 시엔 첨부 창에서 자동 변환돼요');
      setCandidates((prev) => prev.filter((x) => x.tempId !== c.tempId));
    } catch (e: any) {
      toast.error(e?.message || '저장에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  const busy = !!busyMsg;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white" aria-label="뒤로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/25 shrink-0">
            <ImagePlus className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-lg font-bold truncate">이미지 스튜디오</h1>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-400/30">NEW</span>
            </div>
            <p className="text-[11px] text-white/45 truncate">템플릿 고르고 상품·문구만 넣으면 완성 포스터가 나와요</p>
          </div>
          {stage !== 'gallery' && (
            <button onClick={() => { setStage('gallery'); }} className="ml-auto flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/10 shrink-0">
              <ChevronLeft className="w-3.5 h-3.5" /> 템플릿
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {!ready && (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-5 text-sm text-amber-200/80">
            이미지 스튜디오가 준비 중입니다. 잠시 후 다시 시도해주세요.
          </div>
        )}

        {/* 1단계 — 템플릿 갤러리 */}
        {stage === 'gallery' && (
          <section>
            <div className="flex flex-wrap gap-2 mb-4">
              {categories.map((c) => (
                <button key={c} onClick={() => setCategory(c)} className={`px-3 py-1.5 rounded-full text-xs font-medium border ${category === c ? 'bg-violet-500/20 border-violet-400/40 text-violet-200' : 'border-white/10 text-white/50 hover:bg-white/5'}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {visibleTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTemplate(t); setStage('setup'); }}
                  className="group rounded-2xl border border-white/10 overflow-hidden text-left hover:border-violet-400/50 transition bg-slate-950/50"
                >
                  {t.exampleUrl ? (
                    <img src={t.exampleUrl} alt={t.name} loading="lazy" className="w-full aspect-[3/4] object-cover" />
                  ) : (
                    <div className="w-full aspect-[3/4] relative flex flex-col items-center justify-end p-4" style={{ background: `linear-gradient(160deg, ${t.accent}cc, ${t.accent}55 60%, #0f172a)` }}>
                      <div className="absolute top-4 left-0 right-0 text-center space-y-1 px-3">
                        <div className="text-[9px] tracking-[0.2em] text-white/70">{(t.defaultTexts.label || 'LABEL').slice(0, 16)}</div>
                        <div className="text-sm font-bold text-white leading-tight">헤드라인 문구</div>
                        <div className="text-[10px] text-white/60">부제 문구</div>
                      </div>
                      <div className="w-12 h-16 rounded-md bg-white/15 border border-white/25 backdrop-blur-[1px] mb-5" title="상품 자리" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="text-sm font-semibold">{t.name}</div>
                    <div className="text-[10px] text-white/40 mt-0.5">{t.desc}</div>
                    <div className="text-[9px] text-violet-300/70 mt-1">{t.category}</div>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/30 italic mt-3">Data source — 템플릿을 고르면 상품과 문구를 넣는 단계로 이동합니다. 생성 1회 2크레딧(후보 2장).</p>
          </section>
        )}

        {/* 2단계 — 상품 + 문구 + 채널 */}
        {stage === 'setup' && template && (
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* 좌: 템플릿 요약 + 상품 */}
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-14 rounded-md shrink-0" style={{ background: `linear-gradient(160deg, ${template.accent}, #0f172a)` }} />
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{template.name}</div>
                    <div className="text-[11px] text-white/45">{template.desc}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-bold mb-1 flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-violet-300" /> 상품 이미지</h3>
                <p className="text-[11px] text-white/40 mb-3">제품 원본은 그대로 보존하고(누끼) 배경·문구만 새로 그립니다.</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setPickerOpen(true)} disabled={busy} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-xs font-semibold hover:opacity-90 disabled:opacity-40">
                    <ShoppingBag className="w-3.5 h-3.5" /> 연동 몰에서
                  </button>
                  <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-white/15 text-xs text-white/80 hover:bg-white/10 disabled:opacity-40">
                    <Upload className="w-3.5 h-3.5" /> 사진 업로드
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} className="hidden" />
                </div>
                {cutoutBlob && (
                  <div className="mt-3 flex items-center gap-3">
                    <img src={cutoutBlob} alt="누끼" className="w-20 h-20 object-contain rounded-lg border border-emerald-400/30 bg-slate-800/40" />
                    <div className="text-[11px] text-emerald-300/80 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 누끼 완료 — 원본 그대로 들어갑니다</div>
                  </div>
                )}
                {product && <div className="mt-2 text-[11px] text-white/50 truncate">{product.name}{product.salePrice ? ` · ${won(product.salePrice)}` : ''}</div>}
                <p className="text-[10px] text-white/30 italic mt-2">상품 없이도 생성할 수 있어요(문구 포스터). 단일 제품 사진에서 가장 잘 작동합니다.</p>
              </div>
            </div>

            {/* 우: 문구 + 채널 + 생성 */}
            <div className="lg:col-span-3 space-y-4">
              <div className="rounded-2xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/10 to-indigo-500/5 p-4 space-y-2.5">
                <h3 className="text-sm font-bold flex items-center gap-2"><PenLine className="w-4 h-4 text-fuchsia-300" /> 포스터에 들어갈 문구</h3>
                <input value={texts.label} onChange={(e) => setTexts({ ...texts, label: e.target.value })} placeholder="작은 라벨 (예: ONLINE EXCLUSIVE)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50" />
                <input value={texts.title} onChange={(e) => setTexts({ ...texts, title: e.target.value })} placeholder="헤드라인 (예: 얼티뮨 세트 30% 할인)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-sm font-semibold text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50" />
                <input value={texts.subtitle} onChange={(e) => setTexts({ ...texts, subtitle: e.target.value })} placeholder="부제 (예: 한정 300명 특별 혜택)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50" />
                <p className="text-[10px] text-white/35 italic">입력한 문구 그대로 이미지 안에 고급 타이포로 새겨집니다. 혜택·수치는 직접 입력해주세요.</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-bold mb-2.5">어떤 채널 사이즈로 만들까요?</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {PRESETS.map((p) => (
                    <button key={p.key} onClick={() => setPresetKey(p.key)} className={`px-3 py-2 rounded-lg text-xs border text-left ${presetKey === p.key ? 'bg-violet-500/15 border-violet-400/40 text-white' : 'border-white/10 text-white/60 hover:bg-white/5'}`}>
                      <div className="font-semibold">{p.label}</div>
                      <div className="text-[10px] text-white/40">{p.sub}</div>
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-white/30 italic mt-2">생성 후 다른 채널 사이즈도 각각 만들 수 있어요(사이즈당 생성 1회).</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <label className="text-xs font-semibold text-white/70 flex items-center gap-1.5 mb-2"><Wand2 className="w-3.5 h-3.5 text-fuchsia-300" /> 장면 힌트 (선택)</label>
                <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="예: 대리석 카운터, 은은한 램프 조명" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50" />
              </div>

              <button onClick={() => generate()} disabled={busy || !ready} className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-bold hover:opacity-90 disabled:opacity-40 shadow-lg shadow-violet-500/25">
                <Sparkles className="w-4 h-4" /> 완성 포스터 만들기 · 2크레딧 (후보 2장)
              </button>
            </div>
          </section>
        )}

        {/* 3단계 — 결과 */}
        {stage === 'result' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-white/90 mr-2">완성 포스터 — 다른 사이즈도 바로</h2>
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => generate(p.key)} disabled={busy} className="px-3 py-1.5 rounded-lg text-[11px] border border-white/10 text-white/60 hover:bg-white/10 disabled:opacity-40">
                  + {p.label} <span className="text-white/35">2크레딧</span>
                </button>
              ))}
              <button onClick={() => setStage('setup')} className="ml-auto text-xs text-white/40 hover:text-white/70">문구·상품 수정</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {candidates.map((c) => (
                <div key={c.tempId} className="rounded-2xl border border-white/10 overflow-hidden bg-slate-950/60">
                  <div className="relative">
                    {c.blob ? <img src={c.blob} alt="완성 포스터" className="w-full object-contain max-h-[480px] bg-slate-950" /> : <div className="h-64 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>}
                    <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white/70 border border-white/15">{presetLabel(c.presetKey)}</span>
                  </div>
                  <div className="p-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => save(c)} disabled={busy} className="flex-1 min-w-[8rem] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-xs font-semibold hover:opacity-90 disabled:opacity-40">
                        <Save className="w-3.5 h-3.5" /> 라이브러리에 저장
                      </button>
                      <button onClick={() => editOrUpscale(c, '4K')} disabled={busy} className="flex items-center gap-1 px-3 py-2 rounded-lg border border-white/10 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40" title="같은 구도로 4K 재출력">
                        <Maximize2 className="w-3.5 h-3.5" /> 4K <span className="text-white/40">+2</span>
                      </button>
                      <button onClick={() => { setEditFor(editFor === c.tempId ? null : c.tempId); setEditText(''); }} disabled={busy} className="flex items-center gap-1 px-3 py-2 rounded-lg border border-white/10 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40">
                        <Wand2 className="w-3.5 h-3.5" /> AI 수정 <span className="text-white/40">1</span>
                      </button>
                    </div>
                    {editFor === c.tempId && (
                      <div className="flex gap-2">
                        <input value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="배경·무드를 어떻게 바꿀까요? (예: 더 밝고 화사하게)" className="flex-1 px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-violet-400/50"
                          onKeyDown={(e) => { if (e.key === 'Enter' && editText.trim()) editOrUpscale(c, undefined, editText.trim()); }} />
                        <button onClick={() => editText.trim() && editOrUpscale(c, undefined, editText.trim())} disabled={busy || !editText.trim()} className="px-3 py-2 rounded-lg bg-violet-500/80 text-xs font-semibold hover:bg-violet-500 disabled:opacity-40">적용</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/30 italic">Data source — 2K 약 20초 · 4K 약 30초 · 저장 전 산출물은 7일 후 자동 삭제 · MMS는 발송 시 첨부 창에서 자동 변환</p>
          </section>
        )}
      </main>

      {/* 처리 오버레이 */}
      {busy && (
        <div className="fixed inset-0 z-[2500] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-violet-300 mx-auto mb-3" />
            <p className="text-sm text-white/80">{busyMsg}</p>
            <p className="text-[11px] text-white/40 mt-1">창을 닫지 마세요</p>
          </div>
        </div>
      )}

      <MallProductPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={onPickMall} />
    </div>
  );
}
