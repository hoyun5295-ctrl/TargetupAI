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
  Check, Save, Maximize2, PenLine, ChevronLeft, Sparkles, FolderOpen,
  Layers, Smartphone, Mail, MessageSquareText, X, RefreshCw,
} from 'lucide-react';
import { goBackOr } from '../lib/scroll-restoration';
import { putStudioDraft, STUDIO_INAPP_DRAFT_KEY, STUDIO_DM_DRAFT_KEY, STUDIO_EMAIL_DRAFT_KEY } from '../lib/studio-draft';
import { useToast } from '../components/ToastProvider';
import { useAuthStore } from '../stores/authStore';
import MallProductPickerModal, { type PickedMallProduct } from '../components/dm/MallProductPickerModal';
import AssetLibraryPickerModal from '../components/assets/AssetLibraryPickerModal';

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
  /** 카드 목업 예시 카피(템플릿 무드별 실카피). */
  sample?: { title: string; subtitle?: string };
}
interface Candidate { tempId: string; url: string; blob?: string; presetKey: string; title?: string }

// 채널 사이즈 (백엔드 CHANNEL_PRESETS와 key 1:1)
// ★ MMS 전용 생성 없음(Harold 확정 2026-07-19) — 항상 고품질 생성·저장, MMS는 발송 시 라이브러리 소재 자동 변환.
const PRESETS = [
  { key: 'inapp-poster', label: '인앱 포스터', sub: '3:4' },
  { key: 'dm-card', label: '모바일 DM', sub: '1:1' },
  { key: 'email-hero', label: '이메일 히어로', sub: '16:9' },
];
const presetLabel = (key: string) => PRESETS.find((p) => p.key === key)?.label || key;
// 소재 channel_spec → 짧은 한글 라벨(용도 배지·캡션). 백엔드 channelLabelKo 미러.
const specKo = (s?: string | null) => (s === 'inapp-poster' ? '인앱' : s === 'dm' ? 'DM' : s === 'email' ? '이메일' : s === 'mms' ? 'MMS' : s === 'free' ? '자유' : '소재');

// ★ 2026-07-21 스크린샷 유출 억제 워터마크(CSS 오버레이) — 화면 표시본에만. 발송물 원본 무손(오버레이는 DOM).
//   대각선 반복 텍스트 = 회사명·사용자. 유출돼도 출처 추적. pointer-events:none·select-none로 조작·선택 차단.
function StudioWatermark({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div aria-hidden className="pointer-events-none select-none absolute inset-0 overflow-hidden z-10">
      <div className="absolute inset-[-60%] flex flex-wrap content-center justify-center gap-x-6 gap-y-5 -rotate-[28deg]">
        {Array.from({ length: 80 }).map((_, i) => (
          <span key={i} className="whitespace-nowrap text-white text-[11px] font-semibold" style={{ opacity: 0.16, textShadow: '0 1px 2px rgba(0,0,0,0.35)' }}>{text}</span>
        ))}
      </div>
    </div>
  );
}

type Stage = 'gallery' | 'setup' | 'result';

export default function ImageStudioPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const authUser = useAuthStore((s) => s.user);
  // 워터마크 추적 텍스트 = 회사명 · 사용자(로그인ID). 유출 시 출처 식별.
  const wmText = useMemo(() => {
    const co = authUser?.company?.name || '';
    const who = authUser?.name || authUser?.loginId || '';
    return [co, who].filter(Boolean).join(' · ') || '한줄로';
  }, [authUser]);

  const [ready, setReady] = useState(true);
  const [stage, setStage] = useState<Stage>('gallery');
  const [busyMsg, setBusyMsg] = useState('');

  // 템플릿 — 카테고리 우선 탐색(카테고리 목록 → 템플릿 목록 2단)
  const [templates, setTemplates] = useState<StudioTemplatePublic[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [template, setTemplate] = useState<StudioTemplatePublic | null>(null);

  // 내 라이브러리(저장 소재) — 갤러리 상단 폴더. 소재 클릭 = 채널 발사대(인앱/DM/이메일/MMS 변환).
  const [assetAction, setAssetAction] = useState<{ id: string; url: string; filename: string | null; bytes: number; channelSpec?: string | null } | null>(null);
  const [converting, setConverting] = useState(false);
  const [libManageOpen, setLibManageOpen] = useState(false); // 전체 보기·관리(검색·삭제) — 픽커 재사용
  const [libAssets, setLibAssets] = useState<{ id: string; url: string; filename: string | null; bytes: number; channelSpec?: string | null }[]>([]);
  const [libUsage, setLibUsage] = useState<{ usedBytes: number; limitBytes: number } | null>(null);
  const loadLibrary = useCallback(async () => {
    try {
      const r = await authFetch('/api/assets');
      const d = await r.json();
      if (r.ok && d?.success) {
        setLibAssets(Array.isArray(d.assets) ? d.assets.map((a: any) => ({ id: a.id, url: a.url, filename: a.filename, bytes: a.bytes, channelSpec: a.channel_spec ?? null })) : []);
        setLibUsage(d.usage || null);
      }
    } catch { /* 표시 전용 — 실패 무시 */ }
  }, []);

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
    loadLibrary();
    return () => { objectUrls.current.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const map = new Map<string, { count: number; accents: string[] }>();
    for (const t of templates) {
      const e = map.get(t.category) || { count: 0, accents: [] };
      e.count++;
      if (e.accents.length < 3) e.accents.push(t.accent);
      map.set(t.category, e);
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
  }, [templates]);
  const visibleTemplates = useMemo(
    () => (category ? templates.filter((t) => t.category === category) : []),
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
      // ★ 2026-07-21 헤드라인을 candidate 스냅샷으로 — 저장 시 파일명(헤드라인_채널) 생성용(생성 시점 문구 고정)
      const imgs: Candidate[] = (d.images || []).map((im: any) => ({ ...im, presetKey: im.presetKey || useKey, title: texts.title }));
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
      setCandidates((prev) => [{ tempId: d.image.tempId, url: d.image.url, blob, presetKey: c.presetKey, title: c.title }, ...prev]);
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
      const { r, d } = await postJson('/api/image-studio/save', { tempId: c.tempId, title: c.title });
      if (r.status === 503 && d?.code === 'DB_MIGRATION_PENDING') { toast.error('라이브러리 준비 중 — 운영자에게 문의해주세요'); return; }
      if (r.status === 409) { toast.error(d?.error || '이미 저장됐어요'); return; }
      if (!r.ok || !d?.success) throw new Error(d?.error || '저장에 실패했어요');
      toast.success('라이브러리에 저장했어요 — MMS 발송 시엔 첨부 창에서 자동 변환돼요');
      setCandidates((prev) => prev.filter((x) => x.tempId !== c.tempId));
      loadLibrary(); // 상단 라이브러리 폴더 즉시 갱신
    } catch (e: any) {
      toast.error(e?.message || '저장에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  // ── 라이브러리 소재 발사대 — 채널 편집기 주입 / MMS 변환 ─────────
  const launchChannel = (draftKey: string, path: string) => {
    if (!assetAction) return;
    putStudioDraft(draftKey, { imageUrl: assetAction.url, name: assetAction.filename });
    navigate(path);
  };
  // ★ 2026-07-21 다운로드 제거(전 직원 요청 — 악용 소지). 소재는 한줄로 채널/발송으로만 활용, 파일 반출 차단.
  //   화면 표시본엔 워터마크 오버레이(스크린샷 유출 억제), 발송물은 원본 유지.

  const convertAssetToMms = async (assetId: string) => {
    setBusyMsg('MMS 규격으로 변환 중... (≤300KB 보장)');
    try {
      const { r, d } = await postJson('/api/image-studio/mms-from-asset', { assetId });
      if (!r.ok || !d?.success) throw new Error(d?.error || '변환에 실패했어요');
      toast.success(`MMS 변환 완료 — ${(Number(d.image?.size || 0) / 1024).toFixed(0)}KB. 발송 시 MMS 첨부 창의 '라이브러리에서 가져오기'로 첨부하세요`);
      setAssetAction(null);
    } catch (e: any) {
      toast.error(e?.message || '변환에 실패했어요');
    } finally {
      setBusyMsg('');
    }
  };

  // ★ 2026-07-21 채널 변환 — 완성 소재를 다른 채널 비율로 재생성(1크레딧) → 라이브러리 추가 → 발사대 모달을 새 소재로 갱신.
  //   DM용 소재를 인앱/이메일에 그대로 못 쓰는 문제(비율 상이) 해소. 생성 채널은 바로 사용, 그 외는 변환.
  const convertChannel = async (targetPreset: string) => {
    if (!assetAction || converting) return;
    setConverting(true);
    setBusyMsg('채널 비율에 맞추는 중...');
    try {
      const { r, d } = await postJson('/api/image-studio/convert-channel', { assetId: assetAction.id, targetPreset });
      if (r.status === 402) { toast.error('크레딧이 부족합니다 — 충전 후 다시 시도해주세요'); return; }
      if (r.status === 409) { toast.error(d?.error || '잠시 후 다시 시도해주세요'); return; }
      if (r.status === 503 && d?.code === 'DB_MIGRATION_PENDING') { toast.error('라이브러리 준비 중 — 운영자에게 문의해주세요'); return; }
      if (!r.ok || !d?.success) throw new Error(d?.error || '변환에 실패했어요');
      toast.success('변환해서 라이브러리에 저장했어요 (1크레딧) — 이제 이 채널로 만들 수 있어요');
      loadLibrary();
      setAssetAction({ id: d.asset.id, url: d.asset.url, filename: d.asset.filename, bytes: d.asset.bytes, channelSpec: d.asset.channelSpec });
    } catch (e: any) {
      toast.error(e?.message || '변환에 실패했어요');
    } finally {
      setConverting(false);
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

        {/* 0단계 — 내 라이브러리 폴더 (저장 소재 스트립) */}
        {stage === 'gallery' && !category && libAssets.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-violet-300" /> 내 라이브러리
                <span className="text-[11px] text-white/35 font-normal">
                  {libAssets.length}개{libUsage ? ` · ${(libUsage.usedBytes / 1048576).toFixed(1)}MB / ${(libUsage.limitBytes / 1073741824).toFixed(1)}GB` : ''}
                </span>
              </h2>
              <button onClick={() => setLibManageOpen(true)} className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/10">
                전체 보기·관리
              </button>
            </div>
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {libAssets.slice(0, 14).map((a) => (
                <button key={a.id} onClick={() => setAssetAction(a)} className="shrink-0 w-20 text-left group" title={a.filename || ''}>
                  <div className="relative rounded-lg overflow-hidden border border-white/10 group-hover:border-violet-400/60 transition">
                    <img src={a.url} alt={a.filename || ''} loading="lazy" draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-20 h-20 object-cover" />
                    {a.channelSpec && <span className="absolute top-1 left-1 text-[8px] px-1 py-px rounded bg-black/65 text-white/85 font-semibold">{specKo(a.channelSpec)}</span>}
                  </div>
                  {a.filename && <div className="mt-0.5 text-[9px] text-white/45 truncate">{a.filename.replace(/\.[^.]+$/, '')}</div>}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/30 italic mt-2">Data source — 소재를 클릭하면 인앱·DM·이메일로 바로 만들거나 MMS로 변환할 수 있어요.</p>
          </section>
        )}

        {/* 1단계-a — 카테고리 선택 */}
        {stage === 'gallery' && !category && (
          <section>
            <h2 className="text-sm font-bold text-white/90 mb-3">어떤 종류의 포스터인가요?</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {categories.map((c) => (
                <button key={c.name} onClick={() => setCategory(c.name)} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left hover:border-violet-400/40 hover:bg-white/10 transition">
                  <div className="flex gap-1.5 mb-3">
                    {c.accents.map((a, i) => (
                      <span key={i} className="w-6 h-6 rounded-lg border border-white/10" style={{ background: a }} />
                    ))}
                  </div>
                  <div className="text-sm font-semibold">{c.name}</div>
                  <div className="text-[10px] text-white/40 mt-0.5">템플릿 {c.count}종</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/30 italic mt-3">Data source — 카테고리를 고르면 템플릿 목록으로 이동합니다. 생성 1회 2크레딧(후보 2장).</p>
          </section>
        )}

        {/* 1단계-b — 템플릿 선택 (컴팩트 카드) */}
        {stage === 'gallery' && category && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <button onClick={() => setCategory(null)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-white/10">
                <ChevronLeft className="w-3.5 h-3.5" /> 카테고리
              </button>
              <h2 className="text-sm font-bold text-white/90">{category}</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {visibleTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setTemplate(t); setStage('setup'); }}
                  className="group rounded-xl border border-white/10 overflow-hidden text-left hover:border-violet-400/50 transition bg-slate-950/50"
                >
                  {t.exampleUrl ? (
                    <img src={t.exampleUrl} alt={t.name} loading="lazy" className="w-full aspect-[3/4] object-cover" />
                  ) : (
                    <div className="w-full aspect-[3/4] relative flex flex-col items-center justify-end p-2" style={{ background: `linear-gradient(160deg, ${t.accent}cc, ${t.accent}55 60%, #0f172a)` }}>
                      <div className="absolute top-2.5 left-0 right-0 text-center space-y-0.5 px-2">
                        {t.defaultTexts.label ? <div className="text-[7px] tracking-[0.18em] text-white/70 truncate">{t.defaultTexts.label.slice(0, 16)}</div> : null}
                        <div className="text-[11px] font-bold text-white leading-tight">{t.sample?.title || t.name}</div>
                        {t.sample?.subtitle ? <div className="text-[8px] text-white/60 truncate">{t.sample.subtitle}</div> : null}
                      </div>
                      <div className="w-7 h-10 rounded bg-white/15 border border-white/25 mb-3" title="상품 자리" />
                    </div>
                  )}
                  <div className="p-2">
                    <div className="text-[11px] font-semibold truncate">{t.name}</div>
                    <div className="text-[9px] text-white/40 truncate">{t.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-white/30 italic mt-3">Data source — 템플릿을 고르면 상품과 문구를 넣는 단계로 이동합니다.</p>
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
                <p className="text-[10px] text-amber-300/60 italic mt-1">의류는 모델 착용컷 대신 옷 단독컷을 권장해요 — 착용컷은 배경과 합성한 티가 나기 쉬워요.</p>
              </div>
            </div>

            {/* 우: 문구 + 채널 + 생성 */}
            <div className="lg:col-span-3 space-y-4">
              <div className="rounded-2xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/10 to-indigo-500/5 p-4 space-y-2.5">
                <h3 className="text-sm font-bold flex items-center gap-2"><PenLine className="w-4 h-4 text-fuchsia-300" /> 포스터에 들어갈 문구</h3>
                <input value={texts.label} onChange={(e) => setTexts({ ...texts, label: e.target.value })} placeholder="작은 라벨 (예: ONLINE EXCLUSIVE)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50" />
                <input value={texts.title} onChange={(e) => setTexts({ ...texts, title: e.target.value })} placeholder="헤드라인 (예: 제품명 30% 할인 · 2+1 이벤트)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-sm font-semibold text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50" />
                <input value={texts.subtitle} onChange={(e) => setTexts({ ...texts, subtitle: e.target.value })} placeholder="부제 (예: 한정 수량 특별 혜택)" className="w-full px-3 py-2 bg-slate-950/50 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50" />
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
                    {c.blob ? <img src={c.blob} alt="완성 포스터" draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-full object-contain max-h-[480px] bg-slate-950" /> : <div className="h-64 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-white/40" /></div>}
                    {c.blob && <StudioWatermark text={wmText} />}
                    <span className="absolute top-2 left-2 z-20 text-[10px] px-2 py-0.5 rounded-full bg-black/60 text-white/70 border border-white/15">{presetLabel(c.presetKey)}</span>
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

      {/* 라이브러리 소재 발사대 모달 — 이미지 크게(좌) + 채널 메뉴(우). 생성 채널은 바로, 그 외는 변환(1). */}
      {assetAction && (() => {
        const spec = assetAction.channelSpec || '';
        // 이 소재가 각 채널에서 "바로 사용" 가능한가(생성 채널 일치). 그 외는 변환.
        const nativeInapp = spec === 'inapp-poster';
        const nativeDm = spec === 'dm';
        const nativeEmail = spec === 'email';
        const specLabel = specKo(spec);
        return (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
          <div className="w-full max-w-3xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
              <h3 className="text-sm font-bold">이 소재로 바로 만들기</h3>
              <button onClick={() => setAssetAction(null)} className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/10" aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col md:flex-row">
              {/* 좌 — 이미지 크게·선명 + 워터마크 */}
              <div className="md:w-[58%] bg-slate-950 p-4 flex items-center justify-center">
                <div className="relative w-full max-h-[64vh] flex items-center justify-center">
                  <img src={assetAction.url} alt="" draggable={false} onContextMenu={(e) => e.preventDefault()} className="max-w-full max-h-[64vh] object-contain rounded-lg" />
                  <StudioWatermark text={wmText} />
                </div>
              </div>
              {/* 우 — 채널 메뉴 */}
              <div className="md:w-[42%] p-5 flex flex-col gap-2.5 border-t md:border-t-0 md:border-l border-white/10">
                <div className="text-[11px] text-white/45 mb-1">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-white/10 text-white/70 font-semibold">{specLabel}용</span>
                  {assetAction.filename && <div className="mt-1.5 text-white/75 font-medium break-all leading-snug">{assetAction.filename.replace(/\.[^.]+$/, '')}</div>}
                  <div className="mt-2 text-white/35 leading-relaxed">생성한 채널은 바로 사용할 수 있고, 다른 채널은 그 비율로 변환(1크레딧)한 뒤 사용해요.</div>
                </div>
                {/* 인앱 */}
                {nativeInapp ? (
                  <button onClick={() => launchChannel(STUDIO_INAPP_DRAFT_KEY, '/inapp-messages')} className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-rose-400/40 bg-rose-500/10 text-xs font-semibold text-white/90 hover:bg-rose-500/20 transition">
                    <Layers className="w-4 h-4 text-rose-300" /> 인앱메시지 만들기
                  </button>
                ) : (
                  <button onClick={() => convertChannel('inapp-poster')} disabled={busy || converting} className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white/70 hover:border-rose-400/40 hover:bg-rose-500/10 transition disabled:opacity-40">
                    <RefreshCw className="w-4 h-4 text-rose-300" /> 인앱용으로 변환 <span className="text-white/35 font-normal">1크레딧</span>
                  </button>
                )}
                {/* DM */}
                {nativeDm ? (
                  <button onClick={() => launchChannel(STUDIO_DM_DRAFT_KEY, '/dm-builder')} className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-amber-400/40 bg-amber-500/10 text-xs font-semibold text-white/90 hover:bg-amber-500/20 transition">
                    <Smartphone className="w-4 h-4 text-amber-300" /> 모바일 DM 만들기
                  </button>
                ) : (
                  <button onClick={() => convertChannel('dm-card')} disabled={busy || converting} className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white/70 hover:border-amber-400/40 hover:bg-amber-500/10 transition disabled:opacity-40">
                    <RefreshCw className="w-4 h-4 text-amber-300" /> 모바일 DM용으로 변환 <span className="text-white/35 font-normal">1크레딧</span>
                  </button>
                )}
                {/* 이메일 */}
                {nativeEmail ? (
                  <button onClick={() => launchChannel(STUDIO_EMAIL_DRAFT_KEY, '/email-campaigns')} className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-cyan-400/40 bg-cyan-500/10 text-xs font-semibold text-white/90 hover:bg-cyan-500/20 transition">
                    <Mail className="w-4 h-4 text-cyan-300" /> 이메일 만들기
                  </button>
                ) : (
                  <button onClick={() => convertChannel('email-hero')} disabled={busy || converting} className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white/70 hover:border-cyan-400/40 hover:bg-cyan-500/10 transition disabled:opacity-40">
                    <RefreshCw className="w-4 h-4 text-cyan-300" /> 이메일용으로 변환 <span className="text-white/35 font-normal">1크레딧</span>
                  </button>
                )}
                <div className="h-px bg-white/10 my-1" />
                <button onClick={() => convertAssetToMms(assetAction.id)} disabled={busy || converting} className="flex items-center gap-2 px-3.5 py-3 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-white/70 hover:border-emerald-400/40 hover:bg-emerald-500/10 transition disabled:opacity-40">
                  <MessageSquareText className="w-4 h-4 text-emerald-300" /> MMS 변환 <span className="text-white/35 font-normal">≤300KB</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}

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

      {/* 라이브러리 전체 보기·관리 — 검색·삭제(픽커 재사용), 소재 클릭 = 발사대 모달 */}
      <AssetLibraryPickerModal
        open={libManageOpen}
        onClose={() => { setLibManageOpen(false); loadLibrary(); }}
        onPick={(a) => setAssetAction({ id: a.id, url: a.url, filename: a.filename, bytes: a.bytes, channelSpec: (a as any).channel_spec ?? (a as any).channelSpec ?? null })}
      />
    </div>
  );
}
