/**
 * ImageStudioPage — P4 AI 이미지 스튜디오 (2026-07-19)
 *
 * AI 오퍼레이터에 포함된 스튜디오. 1급 흐름 = 원본 제품 누끼(픽셀 보존) → AI 배경 생성 → 서버 합성(/compose) → 정제 타이포 3단.
 *  - 타이핑 0 기본: 상품 선택 + 용도 카드 클릭 = 생성 시작.
 *  - AI는 배경만, 제품 재생성 금지 → 브랜드 왜곡 구조적 차단.
 *  - temp 산출물은 fetch+blob 표시(인증 endpoint), 7일 후 자동 삭제.
 *  - 모델명 UI 노출 금지 / native dialog 금지(useToast) / 혜택 픽셀 금지.
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ImagePlus, Loader2, Sparkles, ShoppingBag, Upload, Wand2,
  Package, Gift, CalendarHeart, Palette, PenLine, Check, Type, Save, Maximize2, RefreshCw,
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

// 용도 카드 5종 (백엔드 PURPOSE_CARDS와 key 1:1)
const PURPOSES = [
  { key: 'new-product', label: '신상품 포스터', desc: '깔끔한 스테이징', icon: Package, grad: 'from-violet-400 to-fuchsia-500' },
  { key: 'season-promo', label: '시즌 프로모션', desc: '지금 계절 감성', icon: CalendarHeart, grad: 'from-rose-400 to-pink-500' },
  { key: 'event-notice', label: '이벤트 공지', desc: '행사 알림 배경', icon: Gift, grad: 'from-amber-400 to-orange-500' },
  { key: 'brand-mood', label: '브랜드 무드컷', desc: 'editorial 감성', icon: Palette, grad: 'from-indigo-400 to-violet-500' },
  { key: 'free-scene', label: '자유 생성', desc: '원하는 분위기로', icon: Sparkles, grad: 'from-emerald-400 to-teal-500' },
];

// 트랙·프리셋 (백엔드 CHANNEL_PRESETS와 key 1:1)
const QUALITY_PRESETS = [
  { key: 'inapp-poster', label: '인앱 포스터형', ratio: '3:4' },
  { key: 'dm-card', label: 'DM 카드', ratio: '1:1' },
  { key: 'email-hero', label: '이메일 히어로', ratio: '16:9' },
  { key: 'free', label: '자유', ratio: '3:4' },
];

type Stage = 'setup' | 'busy' | 'result' | 'compose';
interface TempImg { tempId: string; url: string; blob?: string }

const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}원`;

export default function ImageStudioPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [ready, setReady] = useState(true);
  const [stage, setStage] = useState<Stage>('setup');
  const [busyMsg, setBusyMsg] = useState('');

  // 상품·누끼
  const [product, setProduct] = useState<PickedMallProduct | null>(null);
  const [sourceBlob, setSourceBlob] = useState<string | null>(null);
  const [cutoutTempId, setCutoutTempId] = useState<string | null>(null);
  const [cutoutBlob, setCutoutBlob] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 채널·프리셋
  const [track, setTrack] = useState<'quality' | 'mms'>('quality');
  const [presetKey, setPresetKey] = useState('inapp-poster');
  const [hint, setHint] = useState('');

  // 결과
  const [candidates, setCandidates] = useState<TempImg[]>([]);
  const [selectedBg, setSelectedBg] = useState<string | null>(null);

  // 합성
  const [composite, setComposite] = useState<(TempImg & { bytes: number; width: number; height: number }) | null>(null);
  const [layout, setLayout] = useState({ x: 0.5, y: 0.74, scale: 0.46 });
  const [typo, setTypo] = useState({ label: '', title: '', subtitle: '', color: '#ffffff', zone: 'top' as 'top' | 'bottom' });

  const objectUrls = useRef<string[]>([]);
  const track_preset = track === 'mms' ? 'mms' : presetKey;

  const loadBlob = useCallback(async (url: string): Promise<string> => {
    const r = await authFetch(url);
    const b = await r.blob();
    const u = URL.createObjectURL(b);
    objectUrls.current.push(u);
    return u;
  }, []);

  useEffect(() => {
    authFetch('/api/image-studio/status')
      .then((r) => r.json())
      .then((d) => setReady(!!d?.ready))
      .catch(() => setReady(true));
    return () => { objectUrls.current.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);

  // ── 상품 선택 → 인제스트 → 누끼 ──────────────────────────────
  const ingestAndCutout = async (imageUrl: string | null, fromUpload?: File) => {
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
      const srcBlob = await loadBlob(`/api/image-studio/temp/${sourceTempId}`);
      setSourceBlob(srcBlob);

      setBusyMsg('제품 누끼 따는 중... (배경 자동 제거)');
      const { r: r2, d: d2 } = await postJson('/api/image-studio/remove-bg', { sourceTempId });
      if (!r2.ok || !d2?.success) throw new Error(d2?.error || '누끼에 실패했어요');
      setCutoutTempId(d2.cutout.tempId);
      const cb = await loadBlob(`/api/image-studio/temp/${d2.cutout.tempId}`);
      setCutoutBlob(cb);
      toast.success('제품 누끼 완료 — 배경을 만들어보세요');
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
    if (p.name) setTypo((t) => ({ ...t, title: p.name, subtitle: p.salePrice ? won(p.salePrice) : t.subtitle }));
    if (p.imageUrl) ingestAndCutout(p.imageUrl);
    else toast.error('이 상품은 이미지가 없어요 — 다른 상품을 선택해주세요');
  };

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProduct(null);
    setCutoutTempId(null); setCutoutBlob(null);
    ingestAndCutout(null, f);
    e.target.value = '';
  };

  // ── 생성 (용도 카드 클릭 = 즉시 생성) ─────────────────────────
  const generate = async (purposeKey: string) => {
    if (!ready) { toast.error('이미지 스튜디오가 준비 중입니다'); return; }
    setStage('busy');
    setBusyMsg('AI가 배경을 그리는 중... (약 20초)');
    try {
      const { r, d } = await postJson('/api/image-studio/generate', {
        purposeKey, presetKey: track_preset, userHint: hint || null,
      });
      if (r.status === 402) { toast.error('크레딧이 부족합니다 — 충전 후 다시 시도해주세요'); setStage('setup'); return; }
      if (r.status === 409) { toast.error(d?.error || '다른 생성이 진행 중입니다'); setStage('setup'); return; }
      if (!r.ok || !d?.success) throw new Error(d?.error || '생성에 실패했어요');
      if (d.benefitNotice) toast.success(d.benefitNotice);
      const imgs: TempImg[] = d.images || [];
      for (const im of imgs) im.blob = await loadBlob(im.url);
      setCandidates(imgs);
      setSelectedBg(null);
      setStage('result');
      if (d.partial) toast.success('1장만 생성됐어요 (1크레딧만 차감)');
    } catch (e: any) {
      toast.error(e?.message || '생성에 실패했어요');
      setStage('setup');
    } finally {
      setBusyMsg('');
    }
  };

  // ── 배경 선택 → 합성 or 저장 ─────────────────────────────────
  const composeWith = async (bgTempId: string) => {
    setBusyMsg('제품을 배경에 합성하는 중...');
    try {
      const typography = buildTypography(typo);
      const { r, d } = await postJson('/api/image-studio/compose', {
        bgTempId, cutoutTempId, presetKey: track_preset, layout, typography,
      });
      if (!r.ok || !d?.success) throw new Error(d?.error || '합성에 실패했어요');
      const blob = await loadBlob(d.composite.url);
      setComposite({ ...d.composite, blob });
      setStage('compose');
    } catch (e: any) {
      toast.error(e?.message || '합성에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  const selectBackground = (bgTempId: string) => {
    setSelectedBg(bgTempId);
    if (cutoutTempId || typo.title || typo.subtitle) composeWith(bgTempId);
    else toast.success('배경을 저장하거나, 상품·문구를 더해 합성할 수 있어요');
  };

  const recompose = () => { if (selectedBg) composeWith(selectedBg); };

  // ── 4K 격상 / AI 편집 ────────────────────────────────────────
  const editBg = async (bgTempId: string, targetSize?: '4K', instruction?: string) => {
    setBusyMsg(targetSize === '4K' ? '같은 구도로 4K 격상 중... (약 28초)' : 'AI가 배경을 수정하는 중...');
    try {
      const { r, d } = await postJson('/api/image-studio/edit', { tempId: bgTempId, targetSize, instruction });
      if (r.status === 402) { toast.error('크레딧이 부족합니다'); return; }
      if (!r.ok || !d?.success) throw new Error(d?.error || '수정에 실패했어요');
      const blob = await loadBlob(d.image.url);
      setCandidates((c) => [{ ...d.image, blob }, ...c]);
      setSelectedBg(d.image.tempId);
      toast.success(targetSize === '4K' ? '4K 격상 완료' : '배경 수정 완료');
    } catch (e: any) {
      toast.error(e?.message || '수정에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  // ── 저장 ─────────────────────────────────────────────────────
  const save = async (tempId: string) => {
    setBusyMsg('라이브러리에 저장 중...');
    try {
      const { r, d } = await postJson('/api/image-studio/save', { tempId, channelSpec: track === 'mms' ? 'mms' : undefined });
      if (r.status === 503 && d?.code === 'DB_MIGRATION_PENDING') { toast.error('라이브러리 준비 중 — 운영자에게 문의해주세요'); return; }
      if (r.status === 409) { toast.error(d?.error || '이미 저장됐어요'); return; }
      if (!r.ok || !d?.success) throw new Error(d?.error || '저장에 실패했어요');
      toast.success('라이브러리에 저장했어요');
    } catch (e: any) {
      toast.error(e?.message || '저장에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  const resetAll = () => {
    setStage('setup'); setCandidates([]); setSelectedBg(null); setComposite(null);
  };

  const busy = !!busyMsg;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* 헤더 */}
      <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
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
            <p className="text-[11px] text-white/45 truncate">AI 오퍼레이터에 포함된 스튜디오 — 상품을 올리면 배경부터 문구까지</p>
          </div>
          {stage !== 'setup' && (
            <button onClick={resetAll} className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/10 shrink-0">
              새로 시작
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {!ready && (
          <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-5 text-sm text-amber-200/80">
            이미지 스튜디오가 준비 중입니다. 잠시 후 다시 시도해주세요.
          </div>
        )}

        {stage === 'setup' && (
          <>
            {/* 1. 상품 선택 */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-bold text-white/90 mb-1 flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-violet-300" /> 상품 선택</h2>
              <p className="text-[11px] text-white/40 mb-4">연동 몰 상품을 고르거나 사진을 올리면 제품 원본은 그대로 두고 배경만 새로 만듭니다.</p>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => setPickerOpen(true)} disabled={busy} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold hover:opacity-90 disabled:opacity-40">
                  <ShoppingBag className="w-4 h-4" /> 연동 몰에서 상품
                </button>
                <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/15 text-sm font-medium text-white/80 hover:bg-white/10 disabled:opacity-40">
                  <Upload className="w-4 h-4" /> 사진 업로드
                </button>
                <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} className="hidden" />
              </div>
              {(sourceBlob || cutoutBlob) && (
                <div className="mt-4 flex items-center gap-4">
                  {sourceBlob && (
                    <figure className="text-center">
                      <img src={sourceBlob} alt="원본" className="w-24 h-24 object-contain rounded-lg border border-white/10 bg-slate-950/60" />
                      <figcaption className="text-[10px] text-white/40 mt-1">원본</figcaption>
                    </figure>
                  )}
                  {cutoutBlob && (
                    <figure className="text-center">
                      <img src={cutoutBlob} alt="누끼" className="w-24 h-24 object-contain rounded-lg border border-emerald-400/30 bg-slate-800/40" />
                      <figcaption className="text-[10px] text-emerald-300/70 mt-1 flex items-center gap-1 justify-center"><Check className="w-3 h-3" /> 누끼 완료</figcaption>
                    </figure>
                  )}
                  {product && <div className="text-xs text-white/60"><div className="font-semibold text-white/80">{product.name}</div>{product.salePrice ? <div>{won(product.salePrice)}</div> : null}</div>}
                </div>
              )}
              <p className="text-[10px] text-white/30 italic mt-3">단일 제품 사진에서 가장 잘 작동합니다. 인물이 포함되면 인물이 딸릴 수 있어요.</p>
            </section>

            {/* 2. 채널·프리셋 */}
            <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-bold text-white/90 mb-3">어디에 쓸 소재인가요?</h2>
              <div className="flex gap-2 mb-3">
                <button onClick={() => setTrack('quality')} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${track === 'quality' ? 'bg-violet-500/20 border-violet-400/40 text-violet-200' : 'border-white/10 text-white/50 hover:bg-white/5'}`}>고품질 (인앱·DM·이메일)</button>
                <button onClick={() => setTrack('mms')} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${track === 'mms' ? 'bg-amber-500/20 border-amber-400/40 text-amber-200' : 'border-white/10 text-white/50 hover:bg-white/5'}`}>MMS 전용 (≤300KB 자동)</button>
              </div>
              {track === 'quality' && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {QUALITY_PRESETS.map((p) => (
                    <button key={p.key} onClick={() => setPresetKey(p.key)} className={`px-3 py-2 rounded-lg text-xs border text-left ${presetKey === p.key ? 'bg-violet-500/15 border-violet-400/40 text-white' : 'border-white/10 text-white/60 hover:bg-white/5'}`}>
                      <div className="font-semibold">{p.label}</div>
                      <div className="text-[10px] text-white/40">{p.ratio}</div>
                    </button>
                  ))}
                </div>
              )}
              {track === 'mms' && <p className="text-[11px] text-amber-200/70">굵고 단순한 구성으로 만들고, 서버가 용량(≤300KB)·포맷(JPG)을 자동 보장합니다.</p>}
            </section>

            {/* 3. 자연어 보조(선택) */}
            <section className="rounded-2xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/10 to-indigo-500/5 p-5">
              <label className="text-sm font-bold text-white/90 mb-2 flex items-center gap-2"><Wand2 className="w-4 h-4 text-fuchsia-300" /> 원하는 느낌 한 줄 (선택)</label>
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="예: 따뜻한 우드톤, 미니멀한 스튜디오"
                className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50"
              />
              <p className="text-[10px] text-white/30 italic mt-2">할인·혜택 문구는 이미지에 새기지 않아요 — 아래 텍스트 편집에서 얹어주세요.</p>
            </section>

            {/* 4. 용도 카드 = 클릭 시 즉시 생성 */}
            <section>
              <h2 className="text-sm font-bold text-white/90 mb-1">용도를 고르면 바로 만들어요 <span className="text-white/40 font-normal">· 생성 1회 2크레딧 (후보 2장)</span></h2>
              <p className="text-[11px] text-white/40 mb-3">클릭하면 배경 후보 2장을 자동 생성합니다. 상품을 먼저 고르면 배경 위에 바로 합성돼요.</p>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {PURPOSES.map((p) => (
                  <button key={p.key} onClick={() => generate(p.key)} disabled={busy || !ready} className="group rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:border-violet-400/40 hover:bg-white/10 transition disabled:opacity-40">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${p.grad} flex items-center justify-center shadow-lg mb-2`}><p.icon className="w-5 h-5 text-white" /></div>
                    <div className="text-sm font-semibold">{p.label}</div>
                    <div className="text-[10px] text-white/40">{p.desc}</div>
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-white/30 italic mt-2">Data source — 생성물은 저장 전까지 7일 후 자동 삭제됩니다.</p>
            </section>
          </>
        )}

        {/* 결과: 후보 2장 */}
        {stage === 'result' && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold text-white/90">배경 후보 — 마음에 드는 걸 고르세요</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {candidates.map((c) => (
                <div key={c.tempId} className={`rounded-2xl border overflow-hidden bg-slate-950/60 ${selectedBg === c.tempId ? 'border-violet-400/60 ring-2 ring-violet-400/30' : 'border-white/10'}`}>
                  {c.blob ? <img src={c.blob} alt="배경 후보" className="w-full object-contain max-h-[420px]" /> : <div className="h-64 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>}
                  <div className="p-3 flex flex-wrap gap-2">
                    <button onClick={() => selectBackground(c.tempId)} disabled={busy} className="flex-1 min-w-[7rem] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-xs font-semibold hover:opacity-90 disabled:opacity-40">
                      <Type className="w-3.5 h-3.5" /> {cutoutTempId ? '합성 · 문구 얹기' : '문구 얹기'}
                    </button>
                    <button onClick={() => editBg(c.tempId, '4K')} disabled={busy} className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-white/10 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40" title="같은 구도로 4K">
                      <Maximize2 className="w-3.5 h-3.5" /> 4K <span className="text-white/40">+2</span>
                    </button>
                    <button onClick={() => save(c.tempId)} disabled={busy} className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg border border-white/10 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40">
                      <Save className="w-3.5 h-3.5" /> 저장
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-white/30 italic">2K 약 20초 · 4K 약 28초 · 저장 전까지 7일 후 자동 삭제</p>
          </section>
        )}

        {/* 합성 + 타이포 편집 */}
        {stage === 'compose' && composite && (
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-slate-950/60 overflow-hidden">
              {composite.blob && <img src={composite.blob} alt="합성 미리보기" className="w-full object-contain max-h-[70vh]" />}
              <div className="p-3 text-[10px] text-white/30 italic">Data source — 서버 합성 실측 {(composite.bytes / 1024).toFixed(0)}KB · {composite.width}×{composite.height}</div>
            </div>
            <div className="lg:col-span-2 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                <h3 className="text-sm font-bold flex items-center gap-2"><PenLine className="w-4 h-4 text-fuchsia-300" /> 정제 타이포 3단</h3>
                <input value={typo.label} onChange={(e) => setTypo({ ...typo, label: e.target.value })} placeholder="라벨 (예: NEW ARRIVAL)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30" />
                <input value={typo.title} onChange={(e) => setTypo({ ...typo, title: e.target.value })} placeholder="제목 (상품명)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30" />
                <input value={typo.subtitle} onChange={(e) => setTypo({ ...typo, subtitle: e.target.value })} placeholder="부제 (가격·한 줄 설명)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30" />
                <div className="flex items-center gap-3">
                  <label className="text-[11px] text-white/50 flex items-center gap-1.5">색 <input type="color" value={typo.color} onChange={(e) => setTypo({ ...typo, color: e.target.value })} className="w-7 h-7 rounded bg-transparent border border-white/10" /></label>
                  <div className="flex gap-1">
                    {(['top', 'bottom'] as const).map((z) => (
                      <button key={z} onClick={() => setTypo({ ...typo, zone: z })} className={`px-2.5 py-1 rounded text-[11px] border ${typo.zone === z ? 'bg-violet-500/20 border-violet-400/40 text-white' : 'border-white/10 text-white/50'}`}>{z === 'top' ? '상단' : '하단'}</button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-white/30 italic">할인·혜택 수치는 직접 입력해주세요 — AI가 임의로 만들지 않습니다.</p>
              </div>

              {cutoutTempId && (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
                  <h3 className="text-xs font-bold text-white/80">제품 위치·크기</h3>
                  <label className="text-[11px] text-white/50 block">크기 <input type="range" min={0.2} max={0.9} step={0.02} value={layout.scale} onChange={(e) => setLayout({ ...layout, scale: Number(e.target.value) })} className="w-full" /></label>
                  <label className="text-[11px] text-white/50 block">좌우 <input type="range" min={0.1} max={0.9} step={0.02} value={layout.x} onChange={(e) => setLayout({ ...layout, x: Number(e.target.value) })} className="w-full" /></label>
                  <label className="text-[11px] text-white/50 block">바닥선 <input type="range" min={0.5} max={0.95} step={0.02} value={layout.y} onChange={(e) => setLayout({ ...layout, y: Number(e.target.value) })} className="w-full" /></label>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <button onClick={recompose} disabled={busy} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/15 text-sm text-white/80 hover:bg-white/10 disabled:opacity-40"><RefreshCw className="w-4 h-4" /> 미리보기 갱신</button>
                <button onClick={() => save(composite.tempId)} disabled={busy} className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-sm font-semibold hover:opacity-90 disabled:opacity-40"><Save className="w-4 h-4" /> 라이브러리에 저장</button>
              </div>
              <button onClick={() => setStage('result')} className="text-xs text-white/40 hover:text-white/70">← 다른 배경 고르기</button>
            </div>
          </section>
        )}
      </main>

      {/* 생성/처리 오버레이 */}
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

// 타이포 3단 → 백엔드 compose typography 배열(위치·크기 자동 계산)
function buildTypography(t: { label: string; title: string; subtitle: string; color: string; zone: 'top' | 'bottom' }) {
  const items: any[] = [];
  const topY = t.zone === 'top';
  const yBase = topY ? 0.07 : 0.72;
  if (t.label.trim()) items.push({ text: t.label, size: 0.028, color: t.color, align: 'center', x: 0.5, y: yBase });
  if (t.title.trim()) items.push({ text: t.title, size: 0.072, color: t.color, align: 'center', x: 0.5, y: yBase + 0.05 });
  if (t.subtitle.trim()) items.push({ text: t.subtitle, size: 0.042, color: t.color, align: 'center', x: 0.5, y: yBase + 0.14 });
  return items;
}
