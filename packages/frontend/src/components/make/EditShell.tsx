/**
 * EditShell — 수정 화면 틀(★ 2026-09-27 만들기 개편 · 목업 (라) · 설계서 §1 불변 3)
 *
 * DM·이메일이 같은 칸 배치를 쓴다: 머리(뒤로 · 제목 · 저장 상태 · 채널 전환 · 되돌리기/다시 · [보내기]) /
 * 왼쪽 블록(또는 쪽) · 가운데 휴대폰+PC 미리보기 · 오른쪽 고른 블록 패널(없으면 전체 설정).
 * 좁은 화면은 칸을 위아래로 쌓는다(블록 → 미리보기 → 패널).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Check, Loader2, Pencil, Undo2, Redo2, Send, Smartphone, Mail, GripVertical, Plus, X, AlertCircle,
  Monitor, RectangleHorizontal, FileText, LayoutGrid, AlignJustify, Images, Ticket, Timer, Star, MapPin, Link2, Video, Tag, Square, Minus, Gift,
} from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MK_BACK, MK_BTN_PRIMARY, MK_HEADER } from '../../utils/make-ui';
import type { MakePaletteItem } from '../../utils/make-flow';
import '../../styles/make.css';

export type SaveTone = 'saved' | 'saving' | 'dirty' | 'error' | 'manual';

export default function EditShell({
  title, onTitle, save, channel, pair, onBack, onUndo, onRedo, canUndo, canRedo, onSend, sendLabel = '보내기', banner, left, center, right, extraHeader,
}: {
  title: string;
  onTitle: (v: string) => void;
  save: { tone: SaveTone; text: string; onSaveNow?: () => void };
  channel: 'dm' | 'email';
  /** 같은 재료로 만든 다른 채널(있으면 머리 전환) */
  pair?: { onSwitch: () => void } | null;
  onBack: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onSend: () => void;
  sendLabel?: string;
  banner?: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  extraHeader?: ReactNode;
}) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { if (!editingTitle) setDraft(title); }, [title, editingTitle]);
  useEffect(() => { if (editingTitle) inputRef.current?.select(); }, [editingTitle]);
  const commit = () => { setEditingTitle(false); const v = draft.trim(); if (v && v !== title) onTitle(v.slice(0, 200)); };

  return (
    <div className="relative min-h-screen lg:h-screen bg-slate-950 text-white flex flex-col lg:overflow-hidden">
      <header className={MK_HEADER}>
        <div className="h-[64px] md:h-[68px] flex items-center gap-3 px-3 md:px-5">
          <button type="button" onClick={onBack} className={MK_BACK} aria-label="뒤로"><ArrowLeft className="w-5 h-5" /></button>
          <div className="min-w-0 flex-1">
            {editingTitle ? (
              <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(); if (e.key === 'Escape') { setDraft(title); setEditingTitle(false); } }}
                className="w-full max-w-[420px] h-9 px-2 rounded-lg bg-slate-900 border border-violet-400/60 text-[17px] font-bold text-white outline-none" aria-label="제목" />
            ) : (
              <button type="button" onClick={() => setEditingTitle(true)} className="group inline-flex items-center gap-2 max-w-full text-left" aria-label="제목 고치기">
                <span className="text-[17px] md:text-[19px] font-bold tracking-tight truncate">{title || '제목 없음'}</span>
                <Pencil className="w-3.5 h-3.5 text-white/40 group-hover:text-white/80 shrink-0" />
              </button>
            )}
            <div className={`text-[11.5px] mt-0.5 inline-flex items-center gap-1 ${save.tone === 'error' ? 'text-rose-300' : save.tone === 'saved' ? 'text-emerald-300' : save.tone === 'manual' ? 'text-amber-300' : 'text-white/50'}`}>
              {save.tone === 'saved' ? <Check className="w-3 h-3" /> : save.tone === 'saving' ? <Loader2 className="w-3 h-3 animate-spin" /> : save.tone === 'error' || save.tone === 'manual' ? <AlertCircle className="w-3 h-3" /> : null}
              {save.text}
              {save.onSaveNow && <button type="button" onClick={save.onSaveNow} className="ml-1.5 font-bold text-violet-300 hover:text-violet-200">저장</button>}
            </div>
          </div>

          <div className="hidden md:inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-1 shrink-0" role="tablist" aria-label="채널">
            {(['dm', 'email'] as const).map((c) => {
              const on = channel === c;
              const can = on || !!pair;
              return (
                <button key={c} type="button" role="tab" aria-selected={on} disabled={!can} onClick={() => { if (!on && pair) pair.onSwitch(); }}
                  title={!can ? '같은 재료로 만든 짝이 없어요' : undefined}
                  className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-[13px] font-semibold ${on ? 'bg-violet-600 text-white' : can ? 'text-white/70 hover:text-white' : 'text-white/30 cursor-not-allowed'}`}>
                  {c === 'dm' ? <Smartphone className="w-4 h-4" /> : <Mail className="w-4 h-4" />}{c === 'dm' ? '모바일 DM' : '이메일'}
                </button>
              );
            })}
          </div>
          {extraHeader}
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={onUndo} disabled={!canUndo} className="w-10 h-10 rounded-xl border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/10 disabled:opacity-30 flex items-center justify-center" aria-label="되돌리기"><Undo2 className="w-4 h-4" /></button>
            <button type="button" onClick={onRedo} disabled={!canRedo} className="w-10 h-10 rounded-xl border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/10 disabled:opacity-30 flex items-center justify-center" aria-label="다시 하기"><Redo2 className="w-4 h-4" /></button>
          </div>
          <button type="button" onClick={onSend} className={`${MK_BTN_PRIMARY} h-10 shrink-0`}><Send className="w-4 h-4" />{sendLabel}</button>
        </div>
      </header>
      {banner}
      {/* ★ 2026-09-29 남지현 접수 — 넓은 화면(2xl · 1536+)은 왼쪽 블록 칸 320. xl(1280~)은 가운데 칸이 휴대폰+PC 미리보기(약 650)에 빠듯해 260 유지 */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-[250px_minmax(0,1fr)_370px] xl:grid-cols-[260px_minmax(0,1fr)_380px] 2xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <aside className="lg:min-h-0 lg:overflow-y-auto mk-scroll border-b lg:border-b-0 lg:border-r border-white/10 px-3.5 py-4">{left}</aside>
        <main className="min-h-[640px] lg:min-h-0 lg:overflow-hidden px-4 py-4 flex flex-col">{center}</main>
        <section className="lg:min-h-0 lg:overflow-y-auto mk-scroll border-t lg:border-t-0 lg:border-l border-white/10 px-5 py-4">{right}</section>
      </div>
    </div>
  );
}

// ─────────────────────────────── 왼쪽 블록 목록 ───────────────────────────────

const TYPE_ICON: Record<string, typeof Square> = {
  header: AlignJustify, hero: Monitor, cta: RectangleHorizontal, text_card: FileText, product_carousel: LayoutGrid, footer: Minus,
  gallery: Images, slideshow: Images, coupon: Ticket, instant_coupon: Ticket, countdown: Timer, reviews: Star, store_info: MapPin, map_store_locator: MapPin,
  sns: Link2, video: Video, youtube_embed: Video, promo_code: Tag, lucky_draw: Gift, roulette: Gift, poll: Gift, survey: Gift, email_capture: Mail,
};
export function BlockIcon({ type, className = 'w-4 h-4' }: { type: string; className?: string }) {
  const I = TYPE_ICON[type] || Square;
  return <I className={className} />;
}

export interface BlockRowItem { id: string; type: string; label: string; summary: string; auto?: boolean; thumb?: string | null; index?: number }

export function BlockList({ title, hint, items, selectedId, onSelect, onReorder, top, footer, emptyText }: {
  title: string;
  hint?: string;
  items: BlockRowItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  top?: ReactNode;
  footer?: ReactNode;
  emptyText?: string;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((i) => i.id === String(e.active.id));
    const to = items.findIndex((i) => i.id === String(e.over!.id));
    if (from >= 0 && to >= 0) onReorder(from, to);
  };
  return (
    <div>
      <div className="flex items-baseline gap-2 px-1 mb-3">
        <b className="text-[13.5px] text-white">{title}</b>
        {hint && <span className="text-[11px] text-white/45">{hint}</span>}
      </div>
      {top}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {items.map((it) => <Row key={it.id} item={it} selected={selectedId === it.id} onSelect={() => onSelect(it.id)} />)}
          </div>
        </SortableContext>
      </DndContext>
      {items.length === 0 && <div className="text-[12px] text-white/45 text-center py-6">{emptyText || '블록을 추가해 주세요'}</div>}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

function Row({ item, selected, onSelect }: { item: BlockRowItem; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1, zIndex: isDragging ? 10 : undefined }}
      onClick={onSelect}
      className={`group flex items-center gap-2.5 rounded-xl border px-2 py-2 cursor-pointer transition-colors ${selected ? 'border-violet-400/70 bg-violet-500/[0.14]' : 'border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.07]'}`}>
      <span {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} className="text-white/25 hover:text-white/70 cursor-grab active:cursor-grabbing touch-none" aria-label="끌어서 순서 바꾸기"><GripVertical className="w-4 h-4" /></span>
      {typeof item.index === 'number' && <span className="w-4 text-[11px] text-white/40 text-center shrink-0">{item.index}</span>}
      {item.thumb !== undefined ? (
        <span className="w-10 h-12 rounded-md overflow-hidden bg-white/10 shrink-0">{item.thumb ? <img src={item.thumb} alt="" className="w-full h-full object-cover" /> : null}</span>
      ) : (
        <span className="w-9 h-9 rounded-lg bg-white/[0.07] text-violet-200 flex items-center justify-center shrink-0"><BlockIcon type={item.type} /></span>
      )}
      <span className="min-w-0 flex-1">
        <b className="block text-[13px] text-white leading-tight truncate">{item.label}</b>
        <span className="block text-[11.5px] text-white/50 truncate mt-0.5">{item.summary}</span>
      </span>
      {item.auto && <span className="text-[10.5px] text-white/50 border border-white/15 rounded-md px-1.5 py-px shrink-0">자동</span>}
    </div>
  );
}

// ─────────────────────────────── 블록 추가 팔레트 ───────────────────────────────

export function AddBlockButton({ label = '블록 추가', open, onToggle, children }: { label?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="relative">
      <button type="button" onClick={onToggle} className={`w-full h-11 rounded-xl border border-dashed text-[13px] font-semibold inline-flex items-center justify-center gap-2 ${open ? 'border-violet-400/70 bg-violet-500/10 text-white' : 'border-white/20 text-white/75 hover:text-white hover:border-white/35'}`}>
        <Plus className="w-4 h-4" />{label}
      </button>
      {open && children}
    </div>
  );
}

export function PalettePopover({ items, interaction, onPick, onClose, note, feeTag }: {
  items: MakePaletteItem[];
  interaction?: MakePaletteItem[];
  onPick: (it: MakePaletteItem) => void;
  onClose: () => void;
  note?: string;
  feeTag?: string;
}) {
  const [showInteraction, setShowInteraction] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const list = showInteraction && interaction ? interaction : items;
  return (
    // ★ 2026-09-29 남지현 접수 — 버튼 바로 아래에 펼친다(떠 있는 창 아님). 옛: 왼쪽 칸 오른쪽 바깥(left-full · 위로 260)에 떠서
    //   세로 스크롤 칸(overflow-y auto = 가로도 auto)에 갇혀 좌우 스크롤이 생기고 윗부분이 화면 밖으로 잘렸다(휴대폰 폭은 위로 튀어나감).
    //   폭 = 왼쪽 칸 폭 · 칸이 좁은 PC 격자(lg+)는 타일 3줄.
    <div className="mt-2 rounded-2xl border border-violet-400/40 bg-slate-900 shadow-2xl p-3.5" role="dialog" aria-label="블록 추가">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-[14px] font-bold text-white">{showInteraction ? '참여 이벤트' : '블록 추가'}</div>
          <div className="text-[11.5px] text-white/50 leading-snug">누르면 고른 자리 아래에 들어가고, 필요한 것만 물어봐요</div>
        </div>
        <button type="button" onClick={showInteraction ? () => setShowInteraction(false) : onClose} className="p-1 rounded-lg text-white/50 hover:text-white hover:bg-white/10 shrink-0" aria-label={showInteraction ? '뒤로' : '닫기'}><X className="w-4 h-4" /></button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-3 gap-2">
        {list.map((it) => (
          <button key={it.key} type="button" onClick={() => onPick(it)} className="relative h-[66px] rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] hover:border-violet-400/50 flex flex-col items-center justify-center gap-1.5 px-1">
            <span className="text-violet-200"><BlockIcon type={it.section} /></span>
            <span className="text-[12px] font-semibold text-white/90 text-center leading-tight break-keep">{it.label}</span>
          </button>
        ))}
        {!showInteraction && interaction && interaction.length > 0 && (
          <button type="button" onClick={() => setShowInteraction(true)} className="relative h-[66px] rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] hover:border-violet-400/50 flex flex-col items-center justify-center gap-1.5 px-1">
            {feeTag && <em className="not-italic absolute -top-2 right-1 text-[10px] font-bold text-amber-950 bg-amber-400 rounded-md px-1.5 py-px">{feeTag}</em>}
            <span className="text-violet-200"><Gift className="w-4 h-4" /></span>
            <span className="text-[12px] font-semibold text-white/90 text-center leading-tight break-keep">참여 이벤트</span>
          </button>
        )}
      </div>
      {note && <div className="mt-3 text-[11.5px] text-amber-300 inline-flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{note}</div>}
    </div>
  );
}
