/**
 * PosterEditor — 인앱 만들기 개편 편집기 부품(★ 2026-09-29 · 설계서 §2 · 목업 ② 편집기)
 *
 *   SlideRail      = 왼쪽 장 목록(썸네일 · 끌어 순서 · 장 추가 = 복제 · 사진 여러 장 끌어 놓기 = 장 자동 생성)
 *   PosterStage    = 가운데 휴대폰(·PC) 무대. 글자를 누르면 그 자리에서 고치는 떠 있는 입력 칸(한글 조합 Enter 무시 · Esc 취소)
 *   SlidePanel     = 오른쪽 — 고른 칸(글자 · 크기 · 색 · 넣을 수 있는 값 · 버튼 링크) 또는 지금 장(사진 · 맞춤 · 이동 · 바탕색)
 *   LayoutSwitcher = 모양 바꾸기(포스터 계열 3 · 기본 알림 · 작게 알리기)
 * 편집 상태는 편집기(InAppMessagesPage EditModal)가 쥔다 — 여기 부품은 값과 콜백만 받는다(강조만 · 동시 포커스 없음 · 회의론자 12).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, FolderOpen, ImagePlus, Loader2, Plus, ShoppingBag, Trash2, Upload, X, Layers, Check } from 'lucide-react';
import { BlockList } from '../make/EditShell';
import MallProductPickerModal, { type PickedMallProduct } from '../dm/MallProductPickerModal';
import AssetLibraryPickerModal, { type PickedAsset } from '../assets/AssetLibraryPickerModal';
import { INAPP_FONT_CATALOG } from './blockTheme';
import { PosterSheetPreview, POSTER_SHEET_DEFAULTS, hexOr, type PosterLayout, type SheetEditKey } from './PosterSheetPreview';
import { LAYOUT_INFO, MAX_SLIDES, layoutsFor, APP_SHEET_LAYOUTS_UNLOCKED, type LayoutKey, type WsSlide } from './inappSlides';

// ─────────────────────────────── 공용 ───────────────────────────────

export const FIELD_NAMES: Record<SheetEditKey, string> = { eyebrow: '라벨', subtitle: '윗줄', title: '제목', body: '본문', cta: '버튼 문구' };
/** 레이아웃마다 쓰는 칸(banner = 탭 칩 · 윗줄 · 큰 제목 · 아랫줄 · 버튼) */
export function fieldNamesFor(layout: PosterLayout): Record<SheetEditKey, string> {
  return layout === 'banner_sheet'
    ? { eyebrow: '탭 라벨', subtitle: '윗줄', title: '큰 제목', body: '아랫줄', cta: '버튼 문구' }
    : FIELD_NAMES;
}

/** 칸 길이 상한 — 제목 = DB title varchar(100)(첫 장 제목이 flat 제목이 된다) · 버튼 = 30 · 그 밖 = 300(옛 입력 칸과 같다) */
export const FIELD_MAX: Record<SheetEditKey, number> = { title: 100, cta: 30, eyebrow: 40, subtitle: 100, body: 300 };

export function readField(s: WsSlide | undefined, key: SheetEditKey): string {
  if (!s) return '';
  if (key === 'cta') return String(s.cta?.label || '');
  return String((s as any)[key] || '');
}
export function writeField(s: WsSlide, key: SheetEditKey, v: string): WsSlide {
  if (key === 'cta') return { ...s, cta: { ...(s.cta || {}), label: v } };
  return { ...s, [key]: v };
}

const SIZE_PRESETS: Record<PosterLayout, { title: [number, number, number]; body: [number, number, number] }> = {
  event_card: { title: [22, 26, 30], body: [13, 14, 16] },
  banner_sheet: { title: [22, 26, 30], body: [16, 19, 22] },
  overlay: { title: [17, 20, 24], body: [12, 14, 16] },
};
const COLOR_SUGGEST: Record<PosterLayout, { title: string[]; body: string[]; bg: string[] }> = {
  event_card: { title: ['#8a3b1f', '#1c1917', '#b45309'], body: ['#57534e', '#1c1917', '#78350f'], bg: ['#f7f1e3', '#fdf2f8', '#ecfeff', '#f1f5f9', '#fefce8'] },
  banner_sheet: { title: ['#fde047', '#ffffff', '#111827'], body: ['#ffffff', '#fde047', '#111827'], bg: ['#db2777', '#6d28d9', '#0f766e', '#ea580c', '#111827'] },
  overlay: { title: ['#ffffff', '#fde047', '#111827'], body: ['#ffffff', '#e5e7eb', '#fde047'], bg: [] },
};

const BTN_SEG = (on: boolean) => `px-3 h-8 rounded-lg border text-[12px] font-bold transition-colors ${on ? 'bg-violet-500/30 border-violet-400/60 text-white' : 'bg-white/[0.04] border-white/10 text-white/60 hover:bg-white/10'}`;
const LBL = 'block text-[12px] font-bold text-white/80 mb-1.5';
const INPUT = 'w-full h-10 px-3 rounded-xl bg-slate-950/60 border border-white/15 text-[13px] text-white placeholder-white/35 outline-none focus:border-violet-400/70';

// ─────────────────────────────── 사진 넣기(파일 · 라이브러리 · 몰 상품) ───────────────────────────────

export function useImageSources(opts: {
  uploadImage: (file: File) => Promise<string | null>;
  onImages: (urls: string[], meta?: { linkUrl?: string | null }) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  const [mallOpen, setMallOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => /^image\/(jpeg|png|gif|webp)$/.test(f.type)).slice(0, MAX_SLIDES);
    if (list.length === 0) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of list) {
        const u = await opts.uploadImage(f);
        if (u) urls.push(u);
      }
      if (urls.length > 0) opts.onImages(urls);
    } finally {
      setBusy(false);
    }
  };
  const node = (
    <>
      <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp" className="hidden"
        onChange={(e) => { const f = e.target.files; if (f && f.length) void uploadFiles(f); e.target.value = ''; }} />
      <AssetLibraryPickerModal open={libOpen} onClose={() => setLibOpen(false)} onPick={(a: PickedAsset) => { setLibOpen(false); opts.onImages([a.url]); }} />
      <MallProductPickerModal open={mallOpen} onClose={() => setMallOpen(false)}
        onPick={(ps: PickedMallProduct[]) => {
          setMallOpen(false);
          const p = ps[0];
          if (!p) return;
          if (p.imageUrl) opts.onImages([p.imageUrl], { linkUrl: p.productUrl });
        }} />
    </>
  );
  return {
    busy,
    node,
    pickFile: () => fileRef.current?.click(),
    pickLibrary: () => setLibOpen(true),
    pickMall: () => setMallOpen(true),
    uploadFiles,
  };
}

// ─────────────────────────────── 왼쪽 — 장 목록 ───────────────────────────────

export function SlideRail({ layout, slides, active, onActive, onReorder, onAdd, onDropFiles, busy, top }: {
  layout: PosterLayout;
  slides: WsSlide[];
  active: number;
  onActive: (i: number) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: () => void;
  onDropFiles: (files: FileList) => void;
  busy?: boolean;
  top?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const full = slides.length >= MAX_SLIDES;
  const summaryOf = (s: WsSlide) => (layout === 'banner_sheet' ? (s.title || s.subtitle) : s.title) || '글 없음';
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files?.length) onDropFiles(e.dataTransfer.files); }}
      className={`rounded-2xl transition-colors ${over ? 'bg-violet-500/10 ring-2 ring-violet-400/50' : ''}`}>
      {top}
      <BlockList
        title={`장 ${slides.length}/${MAX_SLIDES}`}
        hint="끌어서 순서 바꾸기"
        items={slides.map((s, i) => ({
          id: s._k,
          type: 'slideshow',
          index: i + 1,
          thumb: s.image_url ? String(s.image_url) : null,
          label: String(summaryOf(s)).replace(/%이름%/g, '(이름)'),
          summary: s.image_url ? '사진 있음' : '사진을 넣어 주세요',
        }))}
        selectedId={slides[active]?._k || null}
        onSelect={(id) => { const i = slides.findIndex((s) => s._k === id); if (i >= 0) onActive(i); }}
        onReorder={onReorder}
        footer={(
          <div className="space-y-2.5">
            <button type="button" onClick={onAdd} disabled={full || busy}
              className="w-full h-11 rounded-xl border border-dashed border-white/20 text-[13px] font-semibold text-white/80 hover:text-white hover:border-violet-400/60 disabled:opacity-40 inline-flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {full ? `최대 ${MAX_SLIDES}장까지` : '장 추가 (지금 장 모양 따라가기)'}
            </button>
            <p className="text-[11.5px] text-white/45 leading-relaxed px-1">
              사진 여러 장을 여기나 가운데 사진 칸에 한 번에 끌어 놓으면 <b className="text-white/80">장이 자동으로 늘어납니다</b>. 같은 모양 · 같은 버튼 설정을 따라갑니다.
            </p>
          </div>
        )}
      />
    </div>
  );
}

// ─────────────────────────────── 가운데 — 무대 + 떠 있는 입력 칸 ───────────────────────────────

/** 무대 아래 줄(장 넘김 버튼 · 안내 한두 줄)이 차지하는 높이 — 무대 맞춤 계산에서 뺀다 */
const STAGE_CHROME_H = 96;
/** 휴대폰 옆 편집 칸 폭(최소 · 최대)과 편집 칸 ↔ 휴대폰 사이(화살표 · 연결선) */
const DOCK_MIN_W = 240;
const DOCK_MAX_W = 360;
const DOCK_GAP = 28;

function FakeScreen({ app }: { app: boolean }) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: app ? '#f5f5f7' : '#f1f5f9', padding: app ? '38px 14px 0' : '12px 14px 0', fontSize: 12, color: '#334155' }}>
      <div style={{ fontWeight: 800, fontSize: 14 }}>샘플몰</div>
      <div style={{ height: 34, borderRadius: 999, background: '#fff', margin: '9px 0 12px', display: 'flex', alignItems: 'center', padding: '0 12px', color: '#94a3b8' }}>무엇을 찾으세요?</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 9 }}>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} style={{ height: 50, borderRadius: 12, background: '#e2e8f0' }} />)}
      </div>
      <div style={{ height: 110, borderRadius: 14, background: 'linear-gradient(135deg,#cbd5e1,#e2e8f0)', marginTop: 14 }} />
    </div>
  );
}

export function PosterStage({
  layout, slides, design, badge, active, onActive, channel, pc, legacyApp, renderText, selected, onSelect, onChangeField,
  onImagePick, onImageDrop, variables, busyImage,
}: {
  layout: PosterLayout;
  slides: WsSlide[];
  design: Record<string, any> | null | undefined;
  badge?: string | null;
  active: number;
  onActive: (i: number) => void;
  channel: 'web' | 'app';
  pc: boolean;
  legacyApp: boolean;
  /** 「고객으로 보기」가 켜졌을 때만 치환 함수(꺼지면 원문 · 설계서 §2) */
  renderText?: (t: string) => string;
  selected: SheetEditKey | null;
  onSelect: (k: SheetEditKey | null) => void;
  onChangeField: (key: SheetEditKey, v: string) => void;
  onImagePick: () => void;
  onImageDrop: (files: FileList) => void;
  variables: Array<{ key: string; label: string }>;
  busyImage?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // ★ 2026-09-29 편집 칸 = 휴대폰 옆(Harold 0929 「사진을 가린다 · 왼쪽 빈 곳에」) — 글자를 누르면 휴대폰이 가운데 칸 오른쪽으로 비키고
  //   왼쪽에 편집 칸이 그 글자 높이에 맞춰 붙는다(화살표 + 연결선). 휴대폰·사진을 가리지 않고, 장 수와 무관하다(장 목록 칸이 아니라 가운데 칸).
  //   가운데 칸이 좁아 편집 칸이 들어가지 않으면(1024급 · 모바일) 떠 있는 칸 없이 오른쪽 패널 글자 칸으로 커서를 옮긴다.
  const [dock, setDock] = useState<{
    key: SheetEditKey; slideKey: string; original: string;
    /** 가운데 칸(root) 기준 */
    top: number; width: number; arrowY: number; gap: number; placed: boolean;
  } | null>(null);
  const cur = slides[active];
  const isPc = pc && channel === 'web';
  // 구버전 앱 = 새 모양을 모르는 빌드 → 지금 포스터 · 다시 보지 않기로 그린다(설계서 §1-1 · §1-3)
  const drawLayout: PosterLayout = legacyApp ? 'overlay' : layout;
  const drawDesign = legacyApp ? { ...(design || {}), dismiss_mode: undefined } : design;

  // ★ 2026-09-29 무대 맞춤(Harold 0929 「화면에서 잘려 밑에 글 쓰기가 힘들다」 · 1455×740 에서 휴대폰 43px 잘림 실측) —
  //   가운데 칸 높이를 재서 휴대폰(PC 틀)을 남는 높이에 맞게 줄인다. 원래 크기보다 키우지 않는다(DM·이메일 PreviewPair 와 같은 방식).
  //   좁은 화면(1024 미만)은 칸이 위아래로 쌓여 페이지가 스크롤되므로 폭만 맞춘다.
  const frameW = isPc ? 640 : 320;
  const frameH = isPc ? 430 : 650;
  const [fit, setFit] = useState(1);
  const [rootW, setRootW] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const wide = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;
      const availH = wide ? el.clientHeight - STAGE_CHROME_H : Number.POSITIVE_INFINITY;
      const availW = el.clientWidth - 8;
      const s = Math.min(1, availH / frameH, availW / frameW);
      setFit(Math.max(0.5, Math.floor(s * 1000) / 1000));
      setRootW(el.clientWidth);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [frameW, frameH]);
  const phoneW = Math.round(frameW * fit);
  const phoneH = Math.round(frameH * fit);
  /** 편집 칸이 휴대폰 옆에 들어가는가 — 휴대폰을 오른쪽 끝에 붙였을 때 왼쪽 폭이 편집 칸 최소 폭 + 연결선보다 넓어야 */
  const sideRoom = rootW - phoneW;
  const canDock = sideRoom >= DOCK_MIN_W + DOCK_GAP;
  const docked = !!dock && canDock;
  const phoneShift = docked ? Math.max(0, Math.floor(sideRoom / 2)) : 0;

  // 장이 바뀌거나 칸이 사라지면 편집 칸을 닫는다(다른 장 칸에 글이 들어가지 않게 · 장마다 고정 key)
  useEffect(() => { if (dock && dock.slideKey !== cur?._k) setDock(null); }, [cur?._k]); // eslint-disable-line react-hooks/exhaustive-deps
  // 화면이 좁아져 옆에 못 붙으면 닫는다(오른쪽 패널에서 이어 고친다)
  useEffect(() => { if (dock && !canDock) setDock(null); }, [canDock]); // eslint-disable-line react-hooks/exhaustive-deps
  // 열리면 커서를 글 끝에(옛: 맨 앞이라 입력이 글 앞에 붙었다 · 0929 브라우저 실측)
  useEffect(() => {
    if (!dock) return;
    setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      const n = ta.value.length;
      ta.setSelectionRange(n, n);
    }, 0);
  }, [dock?.key, dock?.slideKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 고른 글자 높이에 맞춰 편집 칸 자리를 잡는다(보이는 가운데 칸 안 · 화살표는 글자 가운데) */
  const place = (d: NonNullable<typeof dock>) => {
    const root = rootRef.current;
    const host = stageRef.current;
    if (!root || !host) return d;
    const field = host.querySelector(`[data-edit="${d.key}"]`) as HTMLElement | null;
    if (!field) return d;
    const rr = root.getBoundingClientRect();
    const fr = field.getBoundingClientRect();
    const h = dockRef.current ? dockRef.current.offsetHeight : 180;
    const fieldMid = (fr.top + fr.bottom) / 2 - rr.top;
    const visTop = Math.max(rr.top, 0) - rr.top + 4;
    const visBottom = Math.min(rr.bottom, window.innerHeight) - rr.top - 4;
    const top = Math.max(visTop, Math.min(fieldMid - h / 2, visBottom - h));
    const arrowY = Math.max(18, Math.min(h - 18, fieldMid - top));
    return { ...d, top, arrowY, placed: true };
  };

  const openAt = (key: SheetEditKey) => {
    if (!cur) return;
    onSelect(key);
    if (!canDock) {
      // 옆자리가 없는 화면 = 오른쪽 패널 글자 칸으로 커서를 옮긴다(패널이 그 칸 편집으로 바뀐 뒤)
      setDock(null);
      setTimeout(() => {
        const ta = document.querySelector('textarea[data-panel-text]') as HTMLTextAreaElement | null;
        if (ta) { ta.focus(); const n = ta.value.length; ta.setSelectionRange(n, n); }
      }, 30);
      return;
    }
    const width = Math.min(DOCK_MAX_W, sideRoom - DOCK_GAP);
    setDock({ key, slideKey: cur._k, original: readField(cur, key), top: 0, width, arrowY: 60, gap: sideRoom - width, placed: false });
  };
  // 그린 뒤 실제 높이로 자리 확정(칠하기 전에 옮겨 깜박임 없음) · 휴대폰 크기가 바뀌면 다시 잡는다
  useLayoutEffect(() => {
    if (!dock || dock.placed) return;
    setDock(place(dock));
  }, [dock]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!dock) return;
    const width = Math.min(DOCK_MAX_W, sideRoom - DOCK_GAP);
    setDock((d) => (d ? { ...d, width, gap: sideRoom - width, placed: false } : d));
  }, [fit, rootW]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setDock(null);
  const cancel = () => { if (dock) onChangeField(dock.key, dock.original); setDock(null); };
  const insertVar = (token: string) => {
    if (!dock) return;
    const ta = taRef.current;
    const v = readField(cur, dock.key);
    const at = ta ? ta.selectionStart ?? v.length : v.length;
    const next = (v.slice(0, at) + token + v.slice(ta?.selectionEnd ?? at)).slice(0, FIELD_MAX[dock.key]);
    onChangeField(dock.key, next);
    setTimeout(() => { if (ta) { ta.focus(); const p = at + token.length; ta.setSelectionRange(p, p); } }, 0);
  };
  const names = fieldNamesFor(layout);

  return (
    <div ref={rootRef} className="relative w-full flex-1 min-h-0 flex flex-col items-center" onClick={() => { if (dock) { close(); onSelect(null); } }}>
      <div ref={stageRef} className="relative shrink-0"
        style={{ width: phoneW, height: phoneH, transform: phoneShift ? `translateX(${phoneShift}px)` : undefined, transition: 'transform .22s cubic-bezier(.22,1,.36,1)' }}
        onClick={(e) => { e.stopPropagation(); if (dock) close(); onSelect(null); }}>
        <div style={{ width: frameW, height: frameH, transform: fit < 1 ? `scale(${fit})` : undefined, transformOrigin: 'top left' }}>
        <div className={`relative overflow-hidden bg-slate-800 shadow-[0_24px_60px_-20px_rgba(0,0,0,.8)] ${isPc ? 'rounded-xl' : 'rounded-[34px] border-[6px] border-slate-800'}`}
          style={{ width: frameW, height: frameH }}>
          {isPc && <div className="h-6 bg-slate-800 flex items-center gap-1.5 px-3"><i className="w-2 h-2 rounded-full bg-rose-400" /><i className="w-2 h-2 rounded-full bg-amber-300" /><i className="w-2 h-2 rounded-full bg-emerald-400" /></div>}
          <div className="relative w-full" style={{ height: isPc ? 406 : '100%' }}>
            <FakeScreen app={channel === 'app'} />
            <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,.45)' }} />
            <div className="absolute inset-x-0 bottom-0 flex justify-center" style={{ top: 0, alignItems: 'flex-end' }}>
              <div style={{ width: '100%', maxWidth: isPc ? 360 : undefined, maxHeight: '100%', display: 'flex' }}>
                <PosterSheetPreview
                  layout={drawLayout}
                  slides={slides}
                  design={drawDesign}
                  badge={badge}
                  replaceVars={renderText}
                  active={active}
                  onActiveChange={onActive}
                  scale={isPc ? 0.72 : 0.84}
                  radius={isPc ? '16px 16px 0 0' : '22px 22px 0 0'}
                  shadow="0 -10px 40px rgba(0,0,0,.25)"
                  arrows
                  editable={legacyApp ? undefined : {
                    selected,
                    onPick: (key) => openAt(key),
                    onImagePick,
                    onImageDrop,
                  }}
                />
              </div>
            </div>
            {busyImage && (
              <div className="absolute inset-0 bg-slate-950/50 flex items-center justify-center text-white text-[13px] font-semibold gap-2"><Loader2 className="w-4 h-4 animate-spin" />사진 올리는 중</div>
            )}
          </div>
        </div>
        </div>
      </div>

      {docked && dock && cur && (
        <>
          {/* 연결선 — 편집 칸 오른쪽 화살표에서 휴대폰 왼쪽 끝까지 */}
          <div aria-hidden className="absolute pointer-events-none" style={{ left: dock.width, top: dock.top + dock.arrowY - 1, width: Math.max(0, dock.gap), height: 2, background: 'rgba(139,92,246,.55)', visibility: dock.placed ? 'visible' : 'hidden' }} />
          <div ref={dockRef} data-stage-dock className="absolute left-0 z-20 rounded-2xl border border-violet-400/60 bg-slate-900 shadow-2xl p-3"
            style={{ top: dock.top, width: dock.width, visibility: dock.placed ? 'visible' : 'hidden' }}
            onClick={(e) => e.stopPropagation()}>
            {/* 화살표 — 고른 글자 쪽 */}
            <span aria-hidden className="absolute" style={{ right: -7, top: dock.arrowY - 7, width: 12, height: 12, background: '#0f172a', borderTop: '1px solid rgba(167,139,250,.6)', borderRight: '1px solid rgba(167,139,250,.6)', transform: 'rotate(45deg)' }} />
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <b className="text-[13px] text-white">{names[dock.key]}</b>
              <button type="button" onClick={cancel} className="text-[11px] text-white/45 hover:text-white">되돌리고 닫기</button>
            </div>
            <textarea ref={taRef} rows={dock.key === 'body' ? 5 : 3} maxLength={FIELD_MAX[dock.key]}
              value={readField(cur, dock.key)}
              onChange={(e) => onChangeField(dock.key, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); close(); }
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
              }}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950/70 border border-white/15 text-[13.5px] leading-relaxed text-white outline-none focus:border-violet-400/70 resize-none" />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10.5px] text-white/40">Enter 완료 · Shift+Enter 줄바꿈 · Esc 취소</span>
              <span className="text-[10.5px] text-white/35 tabular-nums">{readField(cur, dock.key).length}/{FIELD_MAX[dock.key]}</span>
            </div>
            {variables.length > 0 && dock.key !== 'cta' && (
              <div className="flex flex-wrap gap-1 mt-2">
                {variables.slice(0, 6).map((v) => (
                  <button key={v.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVar(v.key)}
                    className="h-7 px-2 rounded-md bg-violet-500/15 border border-violet-400/30 text-[11.5px] text-violet-100 hover:bg-violet-500/25">+ {v.label}</button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={(e) => { e.stopPropagation(); onActive((active - 1 + slides.length) % slides.length); }} disabled={slides.length < 2}
          className="w-9 h-9 rounded-full border border-white/15 bg-white/[0.05] text-white/80 hover:bg-white/10 disabled:opacity-30 flex items-center justify-center" aria-label="이전 장"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-[12.5px] text-white/60 tabular-nums">{active + 1} / {slides.length}장</span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onActive((active + 1) % slides.length); }} disabled={slides.length < 2}
          className="w-9 h-9 rounded-full border border-white/15 bg-white/[0.05] text-white/80 hover:bg-white/10 disabled:opacity-30 flex items-center justify-center" aria-label="다음 장"><ChevronRight className="w-4 h-4" /></button>
      </div>
      <p className="mt-2 text-[11.5px] text-white/40 text-center max-w-[420px]">
        {legacyApp ? '구버전 앱이 그리는 모습입니다. 편집하려면 「구버전 앱 모습」을 끄세요.' : `${canDock ? '글자를 누르면 휴대폰 옆에서 고칩니다' : '글자를 누르면 편집 칸으로 커서가 옮겨 갑니다'} · 사진 칸을 누르거나 사진을 끌어 놓으세요 · ←/→ 로 장을 넘깁니다`}
      </p>
    </div>
  );
}

// ─────────────────────────────── 오른쪽 — 칸 · 장 패널 ───────────────────────────────

export function SlidePanel({
  layout, slides, active, design, selected, onSelect, onPatchSlide, onRemoveSlide, onDesign, images, variables, onInsertVar,
}: {
  layout: PosterLayout;
  slides: WsSlide[];
  active: number;
  design: Record<string, any> | null | undefined;
  selected: SheetEditKey | null;
  onSelect: (k: SheetEditKey | null) => void;
  onPatchSlide: (patch: Partial<WsSlide>) => void;
  onRemoveSlide: () => void;
  onDesign: (patch: Record<string, any>) => void;
  images: ReturnType<typeof useImageSources>;
  variables: Array<{ key: string; label: string }>;
  onInsertVar: (key: SheetEditKey, token: string) => void;
}) {
  const s = slides[active];
  if (!s) return null;
  const names = fieldNamesFor(layout);
  const sizes = SIZE_PRESETS[layout];
  const colors = COLOR_SUGGEST[layout];
  const D = layout === 'overlay' ? null : POSTER_SHEET_DEFAULTS[layout];

  if (selected) {
    const isText = selected !== 'cta';
    const sizeKey = selected === 'title' ? 'title_size' : selected === 'body' ? 'body_size' : null;
    const colorKey = selected === 'title' || selected === 'eyebrow' ? 'title_color' : selected === 'body' || selected === 'subtitle' ? 'body_color' : null;
    const preset = selected === 'title' ? sizes.title : sizes.body;
    const curSize = sizeKey ? Number((s as any)[sizeKey]) || preset[1] : 0;
    const palette = colorKey === 'title_color' ? colors.title : colors.body;
    const curColor = colorKey ? hexOr((s as any)[colorKey], palette[0]) : '';
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[15px] font-bold text-white">{names[selected]}</p>
            <p className="text-[11.5px] text-white/45 mt-0.5">휴대폰 위에서 바로 고치고 있어요. 여기서 고쳐도 같습니다.</p>
          </div>
          <button type="button" onClick={() => onSelect(null)} className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10" aria-label="칸 선택 풀기"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className={LBL}>글자</label>
          <textarea data-panel-text rows={selected === 'body' ? 4 : 2} maxLength={FIELD_MAX[selected]} value={readField(s, selected)}
            onChange={(e) => onPatchSlide(selected === 'cta' ? { cta: { ...(s.cta || {}), label: e.target.value } } : { [selected]: e.target.value } as any)}
            className="w-full px-3 py-2.5 rounded-xl bg-slate-950/60 border border-white/15 text-[13px] leading-relaxed text-white outline-none focus:border-violet-400/70 resize-none" />
        </div>
        {sizeKey && (
          <div>
            <label className={LBL}>크기</label>
            <div className="flex gap-1.5">
              {(['작게', '보통', '크게'] as const).map((lb, i) => (
                <button key={lb} type="button" onClick={() => onPatchSlide({ [sizeKey]: preset[i] } as any)} className={BTN_SEG(curSize === preset[i])}>{lb}</button>
              ))}
            </div>
          </div>
        )}
        {colorKey && (
          <div>
            <label className={LBL}>색 <span className="font-normal text-white/40">이 칸에 어울리는 색</span></label>
            <div className="flex items-center gap-2">
              {palette.map((c) => (
                <button key={c} type="button" onClick={() => onPatchSlide({ [colorKey]: c } as any)}
                  className={`w-8 h-8 rounded-full border-2 ${curColor.toLowerCase() === c.toLowerCase() ? 'border-violet-300 ring-2 ring-violet-400/40' : 'border-white/20'}`} style={{ background: c }} aria-label={`색 ${c}`} />
              ))}
              <label className="relative w-8 h-8 rounded-full border-2 border-dashed border-white/25 flex items-center justify-center text-white/50 cursor-pointer overflow-hidden" title="직접 고르기">
                <Plus className="w-3.5 h-3.5" />
                <input type="color" value={curColor || '#ffffff'} onChange={(e) => onPatchSlide({ [colorKey]: e.target.value } as any)} className="absolute inset-0 opacity-0 cursor-pointer" />
              </label>
            </div>
          </div>
        )}
        {isText && variables.length > 0 && (
          <div>
            <label className={LBL}>넣을 수 있는 값 <span className="font-normal text-white/40">고객마다 바뀌어 들어갑니다</span></label>
            <div className="flex flex-wrap gap-1.5">
              {variables.slice(0, 8).map((v) => (
                <button key={v.key} type="button" onClick={() => onInsertVar(selected, v.key)} className="h-8 px-2.5 rounded-lg bg-violet-500/15 border border-violet-400/30 text-[12px] text-violet-100 hover:bg-violet-500/25">+ {v.label}</button>
              ))}
            </div>
          </div>
        )}
        {selected === 'cta' && (
          <>
            <div>
              <label className={LBL}>누르면 이동</label>
              <input value={String(s.cta?.action_url || '')} onChange={(e) => onPatchSlide({ cta: { ...(s.cta || {}), action_url: e.target.value } })}
                placeholder="https://… 또는 /event/…" className={INPUT} />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-[12px] text-white/60">버튼 바탕
                <input type="color" value={hexOr(s.cta?.background_color, layout === 'banner_sheet' ? '#ffffff' : '#4f46e5')} onChange={(e) => onPatchSlide({ cta: { ...(s.cta || {}), background_color: e.target.value } })} className="h-8 w-10 rounded bg-transparent border border-white/15 cursor-pointer" />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-white/60">버튼 글자
                <input type="color" value={hexOr(s.cta?.text_color, layout === 'banner_sheet' ? '#111827' : '#ffffff')} onChange={(e) => onPatchSlide({ cta: { ...(s.cta || {}), text_color: e.target.value } })} className="h-8 w-10 rounded bg-transparent border border-white/15 cursor-pointer" />
              </label>
            </div>
            {(s.cta?.label || s.cta?.action_url) && (
              <button type="button" onClick={() => onPatchSlide({ cta: null })} className="text-[12px] text-rose-300 hover:text-rose-200">이 장 버튼 없애기</button>
            )}
          </>
        )}
      </div>
    );
  }

  const noImg = !String(s.image_url || '').trim();
  const fit = s.image_fit === 'cover' || s.image_fit === 'contain' ? s.image_fit : (D ? D.fit : 'cover');
  const fontId = (() => { const fd = String(design?.font_display || ''); const hit = INAPP_FONT_CATALOG.find((c) => c.css === fd); return hit ? hit.id : 'default'; })();
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[15px] font-bold text-white">{active + 1}번째 장</p>
        <p className="text-[11.5px] text-white/45 mt-0.5">장마다 사진 · 글 · 버튼 · 이동 주소가 따로입니다. 글자는 휴대폰 위를 눌러 고치세요.</p>
      </div>
      {noImg && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-100 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />이 장에 사진이 없어요. 사진 없는 장은 발행할 수 없어요.
        </div>
      )}
      <div>
        <label className={LBL}>사진</label>
        <div className="grid grid-cols-3 gap-1.5">
          <button type="button" onClick={images.pickFile} className="h-16 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/10 text-[12px] text-white/85 flex flex-col items-center justify-center gap-1"><Upload className="w-4 h-4 text-violet-200" />내 파일</button>
          <button type="button" onClick={images.pickLibrary} className="h-16 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/10 text-[12px] text-white/85 flex flex-col items-center justify-center gap-1"><FolderOpen className="w-4 h-4 text-violet-200" />라이브러리</button>
          <button type="button" onClick={images.pickMall} className="h-16 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/10 text-[12px] text-white/85 flex flex-col items-center justify-center gap-1"><ShoppingBag className="w-4 h-4 text-violet-200" />몰 상품</button>
        </div>
        {layout === 'banner_sheet' && <p className="text-[11px] text-white/45 mt-1.5">상품 사진은 배경을 지운 사진(누끼)이 이 모양에 가장 잘 삽니다.</p>}
        {!noImg && (
          <button type="button" onClick={() => onPatchSlide({ image_url: '' })} className="mt-1.5 text-[11.5px] text-white/50 hover:text-white inline-flex items-center gap-1"><Trash2 className="w-3 h-3" />이 장 사진 빼기</button>
        )}
      </div>
      {layout !== 'overlay' && (
        <div>
          <label className={LBL}>사진 맞춤</label>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => onPatchSlide({ image_fit: 'cover' })} className={BTN_SEG(fit === 'cover')}>꽉 채우기</button>
            <button type="button" onClick={() => onPatchSlide({ image_fit: 'contain' })} className={BTN_SEG(fit === 'contain')}>잘리지 않게</button>
          </div>
        </div>
      )}
      <div>
        <label className={LBL}>사진을 누르면 이동 <span className="font-normal text-white/40">선택</span></label>
        <input value={String(s.link_url || '')} onChange={(e) => onPatchSlide({ link_url: e.target.value })} placeholder="/event/… 또는 https://…" className={INPUT} />
      </div>
      {layout !== 'overlay' && D && (
        <div>
          <label className={LBL}>{layout === 'event_card' ? '글 칸 바탕색' : '면 색'}</label>
          <div className="flex items-center gap-2 flex-wrap">
            {colors.bg.map((c) => (
              <button key={c} type="button" onClick={() => onPatchSlide({ bg_color: c })}
                className={`w-8 h-8 rounded-full border-2 ${hexOr(s.bg_color, D.bg).toLowerCase() === c.toLowerCase() ? 'border-violet-300 ring-2 ring-violet-400/40' : 'border-white/20'}`} style={{ background: c }} aria-label={`바탕 ${c}`} />
            ))}
            <label className="relative w-8 h-8 rounded-full border-2 border-dashed border-white/25 flex items-center justify-center text-white/50 cursor-pointer overflow-hidden" title="직접 고르기">
              <Plus className="w-3.5 h-3.5" />
              <input type="color" value={hexOr(s.bg_color, D.bg)} onChange={(e) => onPatchSlide({ bg_color: e.target.value })} className="absolute inset-0 opacity-0 cursor-pointer" />
            </label>
          </div>
        </div>
      )}
      {layout !== 'event_card' && !(s.cta?.label || s.cta?.action_url) && (
        <button type="button" onClick={() => { onPatchSlide({ cta: { label: '자세히 보기', action_url: '' } }); onSelect('cta'); }}
          className="w-full h-10 rounded-xl border border-dashed border-white/20 text-[12.5px] text-white/75 hover:text-white hover:border-violet-400/60 inline-flex items-center justify-center gap-1.5"><Plus className="w-3.5 h-3.5" />이 장에 버튼 넣기</button>
      )}
      <div className="h-px bg-white/10" />
      <div>
        <label className={LBL}>아래쪽 버튼</label>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" onClick={() => onDesign({ dismiss_mode: 'snooze_day' })} className={BTN_SEG(design?.dismiss_mode === 'snooze_day')}>오늘 하루 보지 않기 · 닫기</button>
          <button type="button" onClick={() => onDesign({ dismiss_mode: null })} className={BTN_SEG(design?.dismiss_mode !== 'snooze_day')}>다시 보지 않기 · 닫기</button>
        </div>
        <p className="text-[11px] text-white/40 mt-1.5">「오늘 하루 보지 않기」를 누른 고객에게는 24시간 동안 뜨지 않습니다.</p>
      </div>
      <div>
        <label className={LBL}>제목 서체</label>
        <select value={fontId} onChange={(e) => { const c = INAPP_FONT_CATALOG.find((x) => x.id === e.target.value); onDesign({ font_display: c ? c.css : null }); }}
          className="w-full h-10 px-3 rounded-xl bg-slate-950/60 border border-white/15 text-[13px] text-white">
          <option value="default">기본</option>
          {INAPP_FONT_CATALOG.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>
      {slides.length > 1 && (
        <button type="button" onClick={onRemoveSlide} className="w-full h-10 rounded-xl border border-rose-400/35 text-[12.5px] text-rose-200 hover:bg-rose-500/10 inline-flex items-center justify-center gap-1.5"><Trash2 className="w-3.5 h-3.5" />이 장 빼기</button>
      )}
    </div>
  );
}

// ─────────────────────────────── 모양 바꾸기 ───────────────────────────────

export function LayoutSwitcher({ channel, current, onPick }: {
  channel: 'web' | 'app';
  current: LayoutKey;
  onPick: (k: LayoutKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const keys = layoutsFor(channel);
  const groups: Array<{ t: string; ks: LayoutKey[] }> = [
    { t: '크게 보여 주기 · 좌우 슬라이드', ks: keys.filter((k) => LAYOUT_INFO[k].kind === 'big') },
    { t: '기본 알림', ks: keys.filter((k) => LAYOUT_INFO[k].kind === 'basic') },
    { t: '작게 알리기', ks: keys.filter((k) => LAYOUT_INFO[k].kind === 'small') },
  ].filter((g) => g.ks.length > 0);
  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
        <Layers className="w-4 h-4 text-violet-200 shrink-0" />
        <div className="min-w-0 flex-1">
          <b className="block text-[13px] text-white truncate">{LAYOUT_INFO[current].name}</b>
          <span className="block text-[11px] text-white/45 truncate">{LAYOUT_INFO[current].desc}</span>
        </div>
        <button type="button" onClick={() => setOpen((v) => !v)} className="h-8 px-2.5 rounded-lg border border-white/15 text-[12px] font-semibold text-white/80 hover:bg-white/10 shrink-0">모양 바꾸기</button>
      </div>
      {open && (
        <div className="mt-2 rounded-2xl border border-violet-400/40 bg-slate-900 shadow-2xl p-3 space-y-3" role="dialog" aria-label="모양 바꾸기">
          {groups.map((g) => (
            <div key={g.t}>
              <div className="text-[11.5px] font-bold text-white/55 mb-1.5">{g.t}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {g.ks.map((k) => {
                  const on = k === current;
                  const lock = channel === 'app' && !!LAYOUT_INFO[k].isNew && !APP_SHEET_LAYOUTS_UNLOCKED;
                  return (
                    <button key={k} type="button" onClick={() => { setOpen(false); if (!on) onPick(k); }}
                      className={`text-left rounded-xl border px-2.5 py-2 ${on ? 'border-violet-400/70 bg-violet-500/15' : 'border-white/10 bg-white/[0.04] hover:bg-white/10'}`}>
                      <span className="flex items-center gap-1 text-[12.5px] font-bold text-white">{on && <Check className="w-3 h-3 text-violet-200" />}{LAYOUT_INFO[k].name}</span>
                      <span className="block text-[10.5px] text-white/45 mt-0.5 leading-snug">{lock ? '앱 업데이트 필요' : LAYOUT_INFO[k].desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-white/40">글 · 사진은 그대로 두고 모양만 바꿉니다. 마음에 안 들면 되돌리기(Ctrl+Z).</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────── 사진 칸 메뉴(무대에서 사진 칸을 누를 때) ───────────────────────────────

export function ImageSourceMenu({ open, onClose, images }: { open: boolean; onClose: () => void; images: ReturnType<typeof useImageSources> }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  const item = (icon: ReactNode, label: string, run: () => void) => (
    <button type="button" onClick={() => { onClose(); run(); }} className="w-full h-12 rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/10 text-[13px] text-white/90 inline-flex items-center gap-2.5 px-3">{icon}{label}</button>
  );
  return (
    <div className="fixed inset-0 z-[1300] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl shadow-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <b className="text-[15px] text-white inline-flex items-center gap-2"><ImagePlus className="w-4 h-4 text-violet-200" />사진 넣기</b>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10" aria-label="닫기"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-2">
          {item(<Upload className="w-4 h-4 text-violet-200" />, '내 파일 (여러 장 고르면 장이 늘어납니다)', images.pickFile)}
          {item(<FolderOpen className="w-4 h-4 text-violet-200" />, '라이브러리', images.pickLibrary)}
          {item(<ShoppingBag className="w-4 h-4 text-violet-200" />, '몰 상품 (사진 + 상품 링크)', images.pickMall)}
        </div>
      </div>
    </div>
  );
}

