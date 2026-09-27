/**
 * MakeInputs — 만들기 화면 재료 칸(★ 2026-09-27 만들기 개편 · 목업 (가)(나)(다) ②)
 *
 * 주소 칸(있으면) · 읽어 온 재료(행사 카드 배지 · 사진 사본 고지) · 사진·글 판(끌어놓기·붙여넣기 · 첫 사진 = 첫 화면) ·
 * 우리 몰 상품 줄(연동 = 후보 줄 · 누르면 담김) · 상품 글줄(미연동 = 붙여넣기) · 브랜드 칩.
 * 판정(첫 화면·면허·가격)은 서버가 한다 — 여기는 서버 결과를 배지로 보여 줄 뿐이다. AI 0 · 금액 0.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Globe, Image as ImageIcon, Plus, Check, X, Loader2, AlertCircle, ShoppingBag, Search, ShieldCheck, Sparkles, FolderOpen, ClipboardPaste } from 'lucide-react';
import { MK_CARD, MK_HINT, MK_INPUT, MK_LABEL, MK_TEXTAREA } from '../../utils/make-ui';
import { readCardUseNote } from '../../utils/make-flow';
import { parsePastedProducts } from '../../utils/product-paste';
import type { BuildImageRole, BuildImageValue, BuildProductValue } from '../../utils/ai-build';

export function Field({ icon, label, badge, hint, right, children, className = '' }: { icon: ReactNode; label: string; badge?: ReactNode; hint?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${MK_CARD} px-4 md:px-[18px] py-3.5 ${className}`}>
      <div className="flex items-center gap-2 mb-3 flex-wrap min-h-[28px]">
        <span className="text-violet-300">{icon}</span>
        <span className={MK_LABEL}>{label}</span>
        {badge}
        {hint && <span className={MK_HINT}>{hint}</span>}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </section>
  );
}

// ─────────────── 주소 칸 ───────────────

export type ReadState = { kind: 'idle' } | { kind: 'reading' } | { kind: 'done'; summary: string } | { kind: 'failed'; message: string };

export function AddressField({ value, onChange, onRead, state, disabled, label = '홈페이지·행사 페이지 주소' }: {
  value: string; onChange: (v: string) => void; onRead: (url: string) => void; state: ReadState; disabled?: boolean; label?: string;
}) {
  const looksUrl = (v: string) => /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(v.trim());
  const done = state.kind === 'done';
  return (
    <Field icon={<Globe className="w-4 h-4" />} label={label} badge={done ? undefined : <span className="text-[11px] font-semibold text-white/40 border border-white/10 rounded-md px-1.5 py-px">있으면</span>}>
      <div className="relative">
        <input
          value={value}
          disabled={disabled || state.kind === 'reading'}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => { const t = e.clipboardData.getData('text').trim(); if (looksUrl(t)) { e.preventDefault(); onChange(t); onRead(t); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && looksUrl(value)) onRead(value.trim()); }}
          onBlur={() => { if (looksUrl(value) && state.kind === 'idle') onRead(value.trim()); }}
          placeholder="주소를 붙여넣으면 사진·행사 내용을 알아서 읽어요"
          className={`${MK_INPUT} pr-28 ${done ? 'border-violet-400/60' : ''}`}
          inputMode="url"
          aria-label={label}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[12.5px] font-semibold">
          {state.kind === 'reading' && <span className="inline-flex items-center gap-1.5 text-violet-200"><Loader2 className="w-4 h-4 animate-spin" />읽는 중</span>}
          {done && <span className="inline-flex items-center gap-1 text-emerald-300"><Check className="w-4 h-4" />읽었어요</span>}
          {state.kind === 'idle' && looksUrl(value) && <button type="button" onClick={() => onRead(value.trim())} className="text-violet-300 hover:text-violet-200">읽기</button>}
        </div>
      </div>
      {done && <div className="text-[12px] text-white/55 mt-2">{state.summary}</div>}
      {state.kind === 'failed' && <div className="text-[12px] text-amber-300 mt-2 inline-flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" />{state.message}</div>}
    </Field>
  );
}

// ─────────────── 읽어 온 재료 ───────────────

export interface ReadCardView { id: string; title: string; text: string; periodRaw: string | null; included: boolean; licensed: boolean }

export function ReadMaterialsCard({ cards, images, heroUrl, host, onToggleCard, onLicensed, onRemoveImage, siteProducts, onRemoveProduct, disabled }: {
  cards: ReadCardView[];
  /** 카드마다 "이 문구 그대로 쓰기"(기본 꺼짐) — 켜야 할인율·기간이 실린다(면허 = 담당자 체크) */
  onLicensed: (id: string, v: boolean) => void;
  images: Array<{ url: string }>;
  heroUrl: string | null;
  host: string;
  onToggleCard: (id: string) => void;
  onRemoveImage: (url: string) => void;
  siteProducts: BuildProductValue[];
  onRemoveProduct: (key: string) => void;
  disabled?: boolean;
}) {
  const shown = cards.filter((c) => c.included);
  return (
    <Field icon={<Sparkles className="w-4 h-4" />} label="읽어 온 재료" hint="할인율·기간은 보고 켠 카드만 실려요">
      <div className="space-y-2">
        {shown.map((c) => {
          const note = readCardUseNote(c);
          return (
            <div key={c.id} className={`rounded-xl border px-3.5 py-3 ${c.licensed ? 'bg-violet-500/[0.07] border-violet-400/30' : 'bg-white/[0.04] border-white/10'}`}>
              <div className="flex items-center gap-2">
                <b className="text-[14px] text-white min-w-0 truncate">{c.title || '행사'}</b>
                <button type="button" disabled={disabled} onClick={() => onToggleCard(c.id)} className="ml-auto shrink-0 p-1 rounded text-white/50 hover:text-white hover:bg-white/10" aria-label={`${c.title} 빼기`}><X className="w-4 h-4" /></button>
              </div>
              {c.text && <div className="text-[12.5px] text-white/60 mt-1.5 line-clamp-2">{c.text}</div>}
              <div className="flex items-center gap-x-3 gap-y-1 mt-2.5 flex-wrap">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={c.licensed} disabled={disabled} onChange={(e) => onLicensed(c.id, e.target.checked)} className="w-[18px] h-[18px] accent-violet-600" />
                  <span className="text-[13px] font-semibold text-white">이 문구 그대로 쓰기</span>
                </label>
                <span className={`inline-flex items-center gap-1 text-[11.5px] ${note.tone === 'ok' ? 'text-emerald-300' : 'text-white/45'}`}>
                  {note.tone === 'ok' ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}{note.text}
                </span>
              </div>
            </div>
          );
        })}
        {cards.some((c) => !c.included) && (
          <div className="text-[12px] text-white/45">
            뺀 행사: {cards.filter((c) => !c.included).map((c) => (
              <button key={c.id} type="button" onClick={() => onToggleCard(c.id)} className="underline underline-offset-2 mr-2 hover:text-white">{c.title || '행사'} 다시 넣기</button>
            ))}
          </div>
        )}
      </div>
      {images.length > 0 && (
        <div className="flex gap-2.5 mt-3 flex-wrap">
          {images.map((im) => (
            <Thumb key={im.url} url={im.url} size={78} badge={im.url === heroUrl ? '첫 화면' : undefined} onRemove={disabled ? undefined : () => onRemoveImage(im.url)} />
          ))}
        </div>
      )}
      {siteProducts.length > 0 && (
        <div className="mt-3">
          <div className="text-[12px] text-white/55 mb-1.5">홈페이지 상품 {siteProducts.length} · 가격은 싣지 않아요</div>
          <div className="flex flex-wrap gap-1.5">
            {siteProducts.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-1.5 h-7 pl-1 pr-1.5 rounded-lg bg-white/[0.05] border border-white/10 text-[12px] text-white/80">
                {p.imageUrl && <img src={p.imageUrl} alt="" className="w-5 h-5 rounded object-cover" />}{p.name}
                <button type="button" disabled={disabled} onClick={() => onRemoveProduct(p.key)} className="text-white/45 hover:text-white" aria-label={`${p.name} 빼기`}><X className="w-3.5 h-3.5" /></button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="text-[11.5px] text-white/45 mt-3 inline-flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" />{host ? `${host} ` : '홈페이지 '}사진 {images.length}장은 우리 저장소에 사본으로 담아 씁니다</div>
    </Field>
  );
}

// ─────────────── 사진·글 판 ───────────────

export function Thumb({ url, size = 86, badge, onRemove, wide = false }: { url: string; size?: number; badge?: string; onRemove?: () => void; wide?: boolean }) {
  return (
    <span className="group relative rounded-xl overflow-hidden border border-white/10 bg-white/5 shrink-0" style={{ width: wide ? Math.round(size * 1.75) : size, height: size }}>
      <img src={url} alt="" className="w-full h-full object-cover" />
      {badge && <em className="absolute left-1.5 bottom-1.5 not-italic text-[10.5px] font-bold text-white bg-violet-600 rounded px-1.5 py-0.5">{badge}</em>}
      {onRemove && (
        <button type="button" onClick={onRemove} className="absolute right-1 top-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center justify-center" aria-label="사진 빼기"><X className="w-3.5 h-3.5" /></button>
      )}
    </span>
  );
}

const ROLE_BADGE: Partial<Record<BuildImageRole, string>> = { hero: '첫 화면', logo: '로고' };

export function PhotoTextBoard({ images, roles, onAddFiles, onRemoveImage, onOpenLibrary, text, onText, licensed, onLicensed, maxImages, disabled, uploading, compact = false }: {
  images: BuildImageValue[];
  roles: Map<string, BuildImageRole>;
  onAddFiles: (files: File[]) => void;
  onRemoveImage: (url: string) => void;
  onOpenLibrary: () => void;
  text: string;
  onText: (v: string) => void;
  licensed: boolean;
  onLicensed: (v: boolean) => void;
  maxImages: number;
  disabled?: boolean;
  uploading?: boolean;
  /** 몰 연동 화면(목업 다) — 사진 한 장 넓게 + 글 옆에 */
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const room = Math.max(0, maxImages - images.length);
  const take = (list: FileList | File[] | null) => {
    const files = Array.from(list || []).filter((f) => /^image\//.test(f.type));
    if (files.length > 0) onAddFiles(files.slice(0, room));
  };
  const badgeOf = (url: string, i: number) => ROLE_BADGE[roles.get(url) as BuildImageRole] || (i === 0 && roles.size === 0 ? '첫 화면' : undefined);
  return (
    <Field icon={<ImageIcon className="w-4 h-4" />} label="사진·글" hint={compact ? '첫 사진이 첫 화면이 돼요' : '끌어놓거나 붙여넣으세요 · 첫 사진이 첫 화면이 돼요'}>
      <div
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
        onPaste={(e) => { if (disabled) return; const files = Array.from(e.clipboardData.files || []); if (files.length > 0) { e.preventDefault(); take(files); } }}
        className={`rounded-xl transition-colors ${over ? 'bg-violet-500/10 ring-1 ring-violet-400/60' : ''}`}
      >
        <div className={compact ? 'flex gap-3 items-stretch' : ''}>
          <div className={`flex gap-2.5 flex-wrap ${compact ? 'shrink-0' : ''}`}>
            {images.map((im, i) => (
              <Thumb key={im.url} url={im.url} wide={compact && i === 0} badge={badgeOf(im.url, i)} onRemove={disabled ? undefined : () => onRemoveImage(im.url)} />
            ))}
            {room > 0 && (
              <button type="button" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}
                className="w-[86px] h-[86px] rounded-xl border border-dashed border-white/20 text-white/45 hover:text-white/80 hover:border-white/35 flex flex-col items-center justify-center gap-1 text-[11.5px] disabled:opacity-50">
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}사진
              </button>
            )}
          </div>
          <textarea
            value={text}
            disabled={disabled}
            onChange={(e) => onText(e.target.value)}
            rows={compact ? 3 : 4}
            placeholder={'행사 내용을 적어 주세요\n예) 가을 신상 3종 출시 기념 · 10월 1일부터 10일까지 전 품목 20% 할인'}
            className={`${MK_TEXTAREA} ${compact ? 'flex-1 min-w-0' : 'mt-2.5'}`}
            aria-label="행사 내용"
          />
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2.5 flex-wrap">
        <label className="inline-flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={licensed} disabled={disabled} onChange={(e) => onLicensed(e.target.checked)} className="w-[18px] h-[18px] accent-violet-600" />
          <span className="text-[13px] font-semibold text-white">이 문구 그대로 쓰기</span>
          {!compact && <span className="text-[12px] text-white/45">할인율·기간이 적은 그대로 실려요</span>}
        </label>
        <button type="button" disabled={disabled} onClick={onOpenLibrary} className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-white/50 hover:text-white/85"><FolderOpen className="w-3.5 h-3.5" />저장 소재에서</button>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => { take(e.target.files); e.currentTarget.value = ''; }} />
    </Field>
  );
}

// ─────────────── 우리 몰 상품 줄(연동) ───────────────

export interface MallCandidate { provider: string; code: string; name: string; price: number; salePrice: number; discountRate: number; imageUrl: string | null; productUrl: string | null }

export function MallStrip({ providerLabel, candidates, loading, error, selectedKeys, onToggle, query, onQuery, onSearch, count, disabled }: {
  providerLabel: string;
  candidates: MallCandidate[];
  loading: boolean;
  error: string | null;
  selectedKeys: Set<string>;
  onToggle: (c: MallCandidate) => void;
  query: string;
  onQuery: (v: string) => void;
  onSearch: () => void;
  count: number;
  disabled?: boolean;
}) {
  const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}원`;
  return (
    <Field
      icon={<ShoppingBag className="w-4 h-4" />}
      label="우리 몰 상품"
      badge={<span className="text-[11px] font-bold text-emerald-300 bg-emerald-500/15 rounded-md px-1.5 py-0.5">{providerLabel} 연동</span>}
      right={(
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-white/35" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) onSearch(); }} placeholder="상품 이름으로 찾기"
            className="h-8 w-[200px] md:w-[220px] pl-8 pr-3 rounded-[9px] bg-slate-950/50 border border-white/10 text-[12px] text-white placeholder-white/35 outline-none focus:border-violet-400/60" />
        </div>
      )}
    >
      {loading ? (
        <div className="h-[132px] flex items-center justify-center text-white/45"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : error ? (
        <div className="text-[12.5px] text-amber-300 inline-flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{error}</div>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto mk-scroll pb-1.5">
          {candidates.map((c) => {
            const key = `${c.provider}:${c.code}`;
            const on = selectedKeys.has(key);
            return (
              <button key={key} type="button" disabled={disabled} onClick={() => onToggle(c)}
                className={`shrink-0 w-[86px] text-left rounded-xl p-1.5 border transition-colors ${on ? 'border-violet-400/80 bg-violet-500/15' : 'border-transparent opacity-80 hover:opacity-100'}`}>
                <span className="relative block w-full aspect-square rounded-lg overflow-hidden bg-white/10">
                  {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" /> : null}
                  {on && <em className="absolute right-1 top-1 w-5 h-5 rounded-full bg-violet-600 text-white flex items-center justify-center"><Check className="w-3 h-3" /></em>}
                </span>
                <span className="block text-[11.5px] text-white/85 mt-1.5 leading-tight line-clamp-2 min-h-[28px]">{c.name}</span>
                <span className="block text-[12px] font-bold text-white mt-0.5">{won(c.salePrice || c.price)}</span>
              </button>
            );
          })}
          {candidates.length === 0 && <div className="text-[12.5px] text-white/45 py-6">찾은 상품이 없어요.</div>}
        </div>
      )}
      <div className="text-[12px] text-white/55 mt-2"><b className="text-white">{count}개 담음</b> · 누르면 담기고, 가격·링크는 만들 때 몰에서 다시 확인해요</div>
    </Field>
  );
}

// ─────────────── 상품 글줄(미연동) ───────────────

export function ManualProducts({ products, onChange, max, onNotice, onConnect, disabled }: {
  products: BuildProductValue[];
  onChange: (next: BuildProductValue[]) => void;
  max: number;
  onNotice: (m: string) => void;
  onConnect: () => void;
  disabled?: boolean;
}) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState('');
  const manual = products.filter((p) => p.source === 'manual');
  const won = (n: number | null) => (typeof n === 'number' ? `${Math.round(n).toLocaleString()}원` : '');
  const add = () => {
    const parsed = parsePastedProducts(paste, max);
    if (parsed.length === 0) { onNotice('상품명과 가격을 한 줄씩 붙여넣어 주세요. 예) 수분크림 38,000원'); return; }
    const keys = new Set(products.map((p) => p.key));
    const next = products.slice();
    for (const p of parsed) {
      const key = `manual:${p.name.toLowerCase().replace(/\s+/g, '')}`;
      if (keys.has(key)) continue;
      keys.add(key);
      next.push({ key, source: 'manual', provider: null, code: null, name: p.name, price: typeof p.price === 'number' ? p.price : null, salePrice: typeof p.discount_price === 'number' ? p.discount_price : null, discountRate: typeof p.discount_rate === 'number' ? p.discount_rate : null, url: p.link_url || null, imageUrl: null });
      if (next.length >= max) break;
    }
    onChange(next.slice(0, max));
    setPaste('');
    setPasteOpen(false);
  };
  return (
    <Field icon={<ShoppingBag className="w-4 h-4" />} label="상품" hint="몰을 연동하면 사진·가격·구매 버튼까지 붙어요 · 지금은 글로 실려요">
      {manual.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {manual.map((p) => (
            <div key={p.key} className="flex items-center gap-3 h-[34px] px-3 rounded-lg bg-white/[0.05]">
              <span className="text-[13px] text-white/90 flex-1 min-w-0 truncate">{p.name}</span>
              <b className="text-[13px] text-white">{won(p.salePrice ?? p.price)}</b>
              <button type="button" disabled={disabled} onClick={() => onChange(products.filter((x) => x.key !== p.key))} className="text-white/45 hover:text-white" aria-label={`${p.name} 빼기`}><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}
      {pasteOpen && (
        <div className="mb-2">
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder={'상품명 가격을 한 줄씩\n예) 어텀 리페어 세럼 50ml 30,400원'} className={MK_TEXTAREA} />
          <div className="flex justify-end gap-2 mt-1.5">
            <button type="button" onClick={() => setPasteOpen(false)} className="text-[12.5px] text-white/55 hover:text-white px-2">닫기</button>
            <button type="button" disabled={!paste.trim()} onClick={add} className="text-[12.5px] font-semibold text-violet-300 hover:text-violet-200 disabled:opacity-40 px-2">담기</button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between text-[12.5px] text-white/55">
        <button type="button" disabled={disabled} onClick={() => setPasteOpen(true)} className="inline-flex items-center gap-1.5 hover:text-white/85"><ClipboardPaste className="w-3.5 h-3.5" />상품 붙여넣기</button>
        <button type="button" onClick={onConnect} className="font-semibold text-violet-300 hover:text-violet-200">몰 연동하기</button>
      </div>
    </Field>
  );
}

// ─────────────── 브랜드 칩 ───────────────

export function BrandChip({ logoUrl, name, color, note }: { logoUrl?: string | null; name?: string | null; color?: string | null; note: string }) {
  if (!logoUrl && !name && !color) return null;
  return (
    <div className="flex items-center gap-2 text-[12px] text-white/55 px-1">
      {logoUrl ? <img src={logoUrl} alt="" className="h-6 max-w-[90px] object-contain rounded bg-white px-1.5" />
        : name ? <span className="h-6 px-2 rounded bg-white text-slate-900 text-[11px] font-extrabold tracking-[0.18em] inline-flex items-center">{name}</span> : null}
      {color && <span className="w-4 h-4 rounded border border-white/20" style={{ background: color }} />}
      <span>{note}</span>
    </div>
  );
}

/** 몰 후보 불러오기 — 첫 연동 몰 · 검색어 없이 상위 20(신규 경로 0 · GET /api/mall-products/search) */
export function useMallCandidates(enabled: boolean) {
  const [provider, setProvider] = useState<{ provider: string; label: string } | null>(null);
  const [candidates, setCandidates] = useState<MallCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const load = async (prov: string, q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/mall-products/search?provider=${encodeURIComponent(prov)}&limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.success === false) throw new Error(String(d?.error || '상품을 불러오지 못했어요.'));
      setCandidates(Array.isArray(d.products) ? d.products.map((p: any) => ({ ...p, provider: prov })) : []);
    } catch (e: any) {
      setError(e?.message || '상품을 불러오지 못했어요.');
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/mall-products/providers', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const d = await r.json().catch(() => ({}));
        const first = Array.isArray(d?.providers) && d.providers.length > 0 ? d.providers[0] : null;
        if (!alive) return;
        setProvider(first);
        setChecked(true);
        if (first) void load(first.provider);
      } catch { if (alive) setChecked(true); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  return { provider, candidates, loading, error, checked, search: (q: string) => { if (provider) void load(provider.provider, q.trim() || undefined); } };
}
