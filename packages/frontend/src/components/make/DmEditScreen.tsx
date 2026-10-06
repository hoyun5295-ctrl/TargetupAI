/**
 * DmEditScreen — 모바일 DM 수정 화면(★ 2026-09-27 만들기 개편 · 목업 (라) ①③④⑤⑥ · 설계서 §5 기능 이전표)
 *
 * 옛 편집기(DmTopBar·DmLeftPanel·DmCanvas·DmRightPanel·DmQuickBar)와 **같은 스토어(dmBuilderStore)·같은 모달**을 쓴다(저장 축 무변경).
 *   왼쪽 = 블록(옆으로 넘기기 = 장 고르기 · 카탈로그 = 쪽) · 가운데 = 휴대폰+PC(서버 뷰어 무저장 렌더) · 오른쪽 = 고른 블록 패널 / 전체 설정.
 * 보내기·발행 흐름은 부모(DmBuilderPage)가 가진다 — 여기서는 onSend 만 부른다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Palette, Sparkles, BookOpen, Upload, Wand2, FolderOpen, ChevronDown, ChevronRight, History, FlaskConical, ShieldCheck, Plus, X, Loader2, Image as ImageIcon, Link2, Trash2 } from 'lucide-react';
import { useDmBuilderStore, selectAllSectionsFlat } from '../../stores/dmBuilderStore';
import SectionPropsEditor from '../dm/panels/SectionPropsEditor';
import CatalogPageModal, { CATALOG_BLOCKS, type CatalogTemplateKey } from '../dm/build/CatalogPageModal';
import StudioInsertModal from '../dm/build/StudioInsertModal';
import AssetLibraryPickerModal, { type PickedAsset } from '../assets/AssetLibraryPickerModal';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import { uploadOne } from '../dm/panels/FormControls';
import EditShell, { BlockList, AddBlockButton, PalettePopover, BlockIcon, type BlockRowItem, type SaveTone } from './EditShell';
import PreviewPair from './PreviewPair';
import { useDmStorePreview } from './useDmStorePreview';
import {
  PanelBlock, TreatmentTiles, Swatches, Segmented, AlignControl, TEXT_SIZE_PRESETS, textSizeOf, DM_BACKGROUND_SWATCHES,
} from './StyleControls';
import { blockLabel, blockPanelSub, blockSummary, dmPaletteItems, isAutoBlock, INTERACTION_SECTION_TYPES, type MakePaletteItem } from '../../utils/make-flow';
import { DM_TREATMENTS } from '../../utils/dm-treatment';
import { DM_DESIGN_THEMES } from '../../utils/dm-themes';
import { DM_FONT_CATALOG } from '../../utils/dm-tokens';
import { SECTION_META, styleVariantLabel, type Section } from '../../utils/dm-section-defaults';
import { CONFIRM_CREDIT_COSTS } from '../../constants/credit';
import { useToast } from '../ToastProvider';

const authGet = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const authJson = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` });
const ACCENT_AWARE = new Set(['cta', 'coupon', 'promo_code', 'product_carousel', 'countdown', 'instant_coupon', 'text_card']);
const TEXT_SIZE_AWARE = true;

function relTime(ts: number | null): string {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}

export default function DmEditScreen({ onBack, onSend, pair, banner }: {
  onBack: () => void;
  onSend: () => void;
  pair?: { onSwitch: () => void } | null;
  banner?: React.ReactNode;
}) {
  const s = useDmBuilderStore();
  const flat = useDmBuilderStore(selectAllSectionsFlat);
  const preview = useDmStorePreview(!!s.dmId);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((v) => v + 1), 30000); return () => clearInterval(t); }, []);

  const isCatalog = s.layoutMode === 'slides' && s.catalogView;
  const isSlides = s.layoutMode === 'slides';
  const curSections = s.pages[s.currentPageIndex]?.sections || [];
  const selected = useMemo(() => flat.find((x) => x.id === s.selectedSectionId) || null, [flat, s.selectedSectionId]);

  /** 섹션을 고르면 그 섹션이 있는 장으로 먼저 간다(스토어 조작 = 현재 장 기준) */
  const focus = useCallback((id: string | null) => {
    const st = useDmBuilderStore.getState();
    if (!id) { st.selectSection(null); return; }
    const idx = st.pages.findIndex((p) => p.sections.some((x) => x.id === id));
    if (idx >= 0 && idx !== st.currentPageIndex) st.selectPage(idx);
    st.selectSection(id);
  }, []);

  const save: { tone: SaveTone; text: string; onSaveNow?: () => void } = s.isSaving
    ? { tone: 'saving', text: '저장하는 중' }
    : s.isPublished && s.isDirty
      ? { tone: 'manual', text: '보낸 DM이에요 · 고친 내용은 저장해야 받는 사람에게 반영돼요', onSaveNow: () => { void s.save(); } }
      : s.isDirty ? { tone: 'dirty', text: '고치는 중 · 곧 자동 저장돼요' }
        : { tone: 'saved', text: `${s.isPublished ? '저장됨' : '자동 저장됨'} · ${relTime(s.lastSavedAt) || '방금'}` };

  // ── 블록 추가(고른 블록 아래 · 팔레트 CT = DM_BLOCKS) ──
  const addBlock = (it: MakePaletteItem) => {
    setPaletteOpen(false);
    const st = useDmBuilderStore.getState();
    const after = st.selectedSectionId && curSections.some((x) => x.id === st.selectedSectionId) ? st.selectedSectionId : undefined;
    const before = new Set((st.pages[st.currentPageIndex]?.sections || []).map((x) => x.id));
    st.addSection(it.section, after);
    const now = useDmBuilderStore.getState();
    const created = (now.pages[now.currentPageIndex]?.sections || []).find((x) => !before.has(x.id));
    if (!created) return;
    if (it.defaults) now.updateSectionProps(created.id, it.defaults as any);
    now.selectSection(created.id);
  };
  const palette = useMemo(() => dmPaletteItems(), []);
  const hasInteraction = flat.some((x) => INTERACTION_SECTION_TYPES.includes(x.type));

  const removeWithConfirm = (id: string) => setConfirm({
    mode: 'danger', title: `${blockLabel(flat.find((x) => x.id === id) || { type: 'text_card', props: {} } as any)} 블록을 뺄까요?`,
    description: '빼도 위쪽 되돌리기로 다시 살릴 수 있어요.', confirmLabel: '빼기',
    onConfirm: () => { useDmBuilderStore.getState().removeSection(id); },
  });

  // ── 왼쪽 ──
  const listItems: BlockRowItem[] = curSections.map((x) => ({ id: x.id, type: x.type, label: blockLabel(x), summary: blockSummary(x), auto: isAutoBlock(x.type) }));
  const left = isCatalog ? (
    <CatalogLeft onRemove={(i) => setConfirm(pageRemoveConfirm(i, true, s.pages.length))} />
  ) : (
    <BlockList
      title="블록"
      hint={`${curSections.length}개 · 끌어서 순서 바꾸기`}
      items={listItems}
      selectedId={s.selectedSectionId}
      onSelect={(id) => focus(id)}
      onReorder={(from, to) => s.reorderSections(from, to)}
      top={isSlides ? <PageChips onRemove={(i) => setConfirm(pageRemoveConfirm(i, false, s.pages.length))} /> : undefined}
      footer={(
        <AddBlockButton open={paletteOpen} onToggle={() => setPaletteOpen((v) => !v)}>
          <PalettePopover
            items={palette.main}
            interaction={palette.interaction}
            onPick={addBlock}
            onClose={() => setPaletteOpen(false)}
            feeTag={`발행 ${CONFIRM_CREDIT_COSTS['dm-interaction-publish']}`}
            note={hasInteraction ? undefined : `참여 이벤트(추첨·투표·설문)를 넣으면 발행 크레딧이 ${CONFIRM_CREDIT_COSTS['dm-builder']}에서 ${CONFIRM_CREDIT_COSTS['dm-interaction-publish']}이 돼요`}
          />
        </AddBlockButton>
      )}
    />
  );

  // ── 가운데 ──
  const idxInPage = selected ? curSections.findIndex((x) => x.id === selected.id) : -1;
  const center = (
    <PreviewPair
      kind={preview.kind}
      html={preview.html}
      loading={preview.loading}
      error={preview.error}
      emptyText={!s.dmId ? '블록을 넣으면 여기에 받는 사람 화면이 보여요' : null}
      selectedId={s.selectedSectionId}
      onTap={(id) => focus(id)}
      phoneTop={isSlides ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-slate-500">넘김 효과</span>
          <Segmented value={s.pageEffect} onChange={(v) => s.setPageEffect(v)} options={[{ value: 'slide', label: '밀어내기' }, { value: 'flip', label: '책장 넘김' }, { value: 'fade', label: '페이드' }]} />
        </div>
      ) : undefined}
      blockTools={selected && !isCatalog ? {
        canUp: idxInPage > 0, canDown: idxInPage >= 0 && idxInPage < curSections.length - 1,
        onUp: () => s.moveSection(selected.id, 'up'), onDown: () => s.moveSection(selected.id, 'down'),
        onDuplicate: () => s.duplicateSection(selected.id), onDelete: () => removeWithConfirm(selected.id),
      } : null}
    />
  );

  // ── 오른쪽 ──
  const right = isCatalog && selected?.type === 'gallery'
    ? <CatalogPagePanel section={selected} />
    : selected ? <DmBlockPanel section={selected} /> : <DmGlobalPanel onValidate={async () => { const r = await s.runValidation(); if (r) s.setOpenModal('validation'); }} />;

  return (
    <>
      <EditShell
        title={s.title}
        onTitle={(v) => s.setTitle(v)}
        save={save}
        channel="dm"
        pair={pair}
        onBack={onBack}
        onUndo={() => s.undo()}
        onRedo={() => s.redo()}
        canUndo={s.canUndo()}
        canRedo={s.canRedo()}
        onSend={onSend}
        banner={banner}
        left={left}
        center={center}
        right={right}
      />
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

// ─────────────────────────────── 장 빼기(옆으로 넘기기 · 카탈로그 공통) ───────────────────────────────

/**
 * ★ 2026-10-06 임은지 접수 「옆으로 넘기기 · 책처럼에 장(쪽) 빼기가 없다」 — 0927 수정 화면이 장 추가만 옮겨 왔고,
 *   카탈로그 빼기는 사진 쪽을 골랐을 때 오른쪽 패널에만 있었다(사진 없는 쪽은 고를 수조차 없음 · 2쪽에서는 잠김).
 *   빼기는 이 한 곳 — 되돌리기로 살릴 수 있게 빼기 직전 모습을 남긴다 · 마지막 1장은 남긴다(저장소 규칙).
 *   카탈로그가 1쪽이 되면 뷰어는 책 대신 한 장으로 보인다(dm-viewer-catalog isCatalogDm = 2쪽 이상) — 확인 창에 그 조건을 적는다.
 */
function removePageAt(idx: number) {
  const st = useDmBuilderStore.getState();
  if (idx < 0 || idx >= st.pages.length || st.pages.length <= 1) return;
  st.pushHistory();
  st.removePage(idx);
  const after = useDmBuilderStore.getState();
  if (!after.catalogView) return;
  const g = galleryOf(after.pages[after.currentPageIndex] || { sections: [] });
  if (g) after.selectSection(g.id);
}

function pageRemoveConfirm(idx: number, catalog: boolean, total: number): ConfirmState {
  const what = catalog ? `${idx + 1}쪽` : `${idx + 1}장`;
  const note = catalog
    ? (total === 2 ? ' 1쪽만 남으면 책처럼 펼쳐지지 않고 한 장으로 보여요. 쪽을 다시 넣으면 책으로 돌아와요.' : '')
    : ' 이 장에 넣은 블록도 함께 빠져요.';
  return { mode: 'danger', title: `${what}을 뺄까요?`, description: `빼도 위쪽 되돌리기로 다시 살릴 수 있어요.${note}`, confirmLabel: '빼기', onConfirm: () => removePageAt(idx) };
}

// ─────────────────────────────── 장 고르기(옆으로 넘기기) ───────────────────────────────

function PageChips({ onRemove }: { onRemove: (idx: number) => void }) {
  const pages = useDmBuilderStore((s) => s.pages);
  const cur = useDmBuilderStore((s) => s.currentPageIndex);
  const selectPage = useDmBuilderStore((s) => s.selectPage);
  const addPage = useDmBuilderStore((s) => s.addPage);
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {pages.map((p, i) => (
        <button key={p.id} type="button" onClick={() => selectPage(i)} className={`h-7 px-2.5 rounded-lg text-[12px] font-semibold ${i === cur ? 'bg-violet-600 text-white' : 'bg-white text-slate-500 hover:text-slate-900'}`}>{i + 1}장</button>
      ))}
      <button type="button" onClick={() => addPage()} className="h-7 px-2.5 rounded-lg text-[12px] font-semibold border border-dashed border-slate-300 text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" />장 추가</button>
      {pages.length > 1 && (
        <button type="button" onClick={() => onRemove(cur)} className="h-7 px-2.5 rounded-lg text-[12px] font-semibold text-slate-500 hover:text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1" data-make="slides-remove-page"><Trash2 className="w-3.5 h-3.5" />{cur + 1}장 빼기</button>
      )}
    </div>
  );
}

// ─────────────────────────────── 오른쪽: 블록 패널 ───────────────────────────────

function PanelHead({ icon, title, sub, right }: { icon: React.ReactNode; title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
      <span className="w-10 h-10 rounded-xl bg-violet-100 text-violet-800 flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0 flex-1"><b className="block text-[15px] text-slate-900 truncate">{title}</b><span className="block text-[11.5px] text-slate-500 truncate">{sub}</span></div>
      {right}
    </div>
  );
}

function DmBlockPanel({ section }: { section: Section }) {
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const setSectionStyle = useDmBuilderStore((s) => s.setSectionStyle);
  const setSectionVariant = useDmBuilderStore((s) => s.setSectionVariant);
  const setSectionVisible = useDmBuilderStore((s) => s.setSectionVisible);
  const toggleSectionLock = useDmBuilderStore((s) => s.toggleSectionLock);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const brand = useDmBuilderStore((s) => s.brandKit.primary_color) || '#9a4f2c';
  const [advanced, setAdvanced] = useState(false);
  const treatments = DM_TREATMENTS[section.type];
  const meta = SECTION_META[section.type];
  const size = textSizeOf(section as any);
  return (
    <div>
      <PanelHead icon={<BlockIcon type={section.type} className="w-5 h-5" />} title={blockLabel(section)} sub={blockPanelSub(section.type)} />
      <PanelBlock title="내용" right={<button type="button" onClick={() => setOpenModal('ai-improve')} className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11.5px] font-semibold text-fuchsia-900 border border-fuchsia-300 bg-fuchsia-50 hover:bg-fuchsia-100"><Sparkles className="w-3.5 h-3.5" />다르게 쓰기</button>}>
        <div className="mk-editor">
          <SectionPropsEditor key={section.id} section={section} onUpdate={(patch) => updateSectionProps(section.id, patch)} />
        </div>
      </PanelBlock>
      {treatments && treatments.length > 1 && (
        <PanelBlock title={section.type === 'cta' ? '모양' : section.type === 'product_carousel' ? '배열' : '구도'} hint="누르면 가운데에 바로 보여요">
          <TreatmentTiles type={section.type} options={treatments.map((v) => ({ value: v }))} value={section.treatment || 'classic'} onChange={(v) => setSectionStyle(section.id, { treatment: v })} color={brand} />
        </PanelBlock>
      )}
      <PanelBlock title="배경">
        <Swatches options={DM_BACKGROUND_SWATCHES} value={section.background || ''} onChange={(v) => setSectionStyle(section.id, { background: (v || undefined) as any })} />
      </PanelBlock>
      {ACCENT_AWARE.has(section.type) && (
        <PanelBlock title="색" hint={section.accent_color ? undefined : '브랜드 색'}>
          <Swatches
            options={[{ value: '', color: brand, label: '브랜드 색' }, { value: '#2b2320', color: '#2b2320', label: '진한 갈색' }, { value: '#c9a86b', color: '#c9a86b', label: '금색' }, { value: '#0f766e', color: '#0f766e', label: '청록' }]}
            value={section.accent_color || ''}
            onChange={(v) => setSectionStyle(section.id, { accent_color: v || undefined })}
            custom={{ value: section.accent_color || brand, onChange: (hex) => setSectionStyle(section.id, { accent_color: hex }) }}
          />
        </PanelBlock>
      )}
      <div className="grid grid-cols-2 gap-4 py-4 border-t border-slate-200">
        {TEXT_SIZE_AWARE && (
          <div>
            <div className="text-[12.5px] font-bold text-slate-900 mb-2.5">글자 크기</div>
            <Segmented value={size} onChange={(v) => setSectionStyle(section.id, { title_size: TEXT_SIZE_PRESETS[v].title, text_size: TEXT_SIZE_PRESETS[v].text })} options={[{ value: 'sm', label: '작게' }, { value: 'md', label: '보통' }, { value: 'lg', label: '크게' }]} />
          </div>
        )}
        <div>
          <div className="text-[12.5px] font-bold text-slate-900 mb-2.5">정렬</div>
          <AlignControl value={(section.align as any) || 'center'} onChange={(v) => setSectionStyle(section.id, { align: v })} />
        </div>
      </div>
      <div className="border-t border-slate-200 pt-3">
        <button type="button" onClick={() => setAdvanced((v) => !v)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-900">
          {advanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}더 고치기(분위기 · 연결부 · 표시)
        </button>
        {advanced && (
          <div className="mt-3 space-y-3 text-[12.5px]">
            {meta.supportsStyleVariants.length > 1 && (
              <Row label="분위기">
                <select value={section.style_variant || 'default'} onChange={(e) => setSectionVariant(section.id, e.target.value)} className="h-8 px-2 rounded-lg bg-slate-100 border border-slate-300 text-slate-900">
                  {meta.supportsStyleVariants.map((v) => <option key={v} value={v}>{styleVariantLabel(v)}</option>)}
                </select>
              </Row>
            )}
            <Row label="아래 연결부">
              <Segmented value={(section.divider_shape as any) || ''} onChange={(v) => setSectionStyle(section.id, { divider_shape: (v || undefined) as any })} options={[{ value: '', label: '없음' }, { value: 'wave', label: '물결' }, { value: 'slant', label: '사선' }, { value: 'curve', label: '곡선' }]} />
            </Row>
            <Row label="배경 더 보기">
              <Segmented value={section.background === 'gradient' || section.background === 'glass' ? section.background : ''} onChange={(v) => setSectionStyle(section.id, { background: (v || undefined) as any })} options={[{ value: '', label: '위에서 고름' }, { value: 'gradient', label: '그라데이션' }, { value: 'glass', label: '유리' }]} />
            </Row>
            {section.background === 'gradient' && (
              <Row label="그라데이션 끝 색"><input type="color" value={section.accent_color_2 || '#a855f7'} onChange={(e) => setSectionStyle(section.id, { accent_color_2: e.target.value })} className="w-9 h-8 rounded-lg bg-transparent border border-slate-300" /></Row>
            )}
            <Row label="위 블록에 겹치기"><Toggle on={!!section.pull_up} onClick={() => setSectionStyle(section.id, { pull_up: !section.pull_up })} /></Row>
            <Row label="보이기"><Toggle on={section.visible !== false} onClick={() => setSectionVisible(section.id, section.visible === false)} /></Row>
            <Row label="AI가 다시 만들 때 그대로 두기"><Toggle on={!!section.ai_locked} onClick={() => toggleSectionLock(section.id)} /></Row>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{label}</span>{children}</div>;
}
function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`w-11 h-6 rounded-full p-0.5 transition-colors ${on ? 'bg-violet-600' : 'bg-slate-200'}`}>
      <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}

// ─────────────────────────────── 오른쪽: 전체 설정 ───────────────────────────────

interface VersionRow { id: string; label?: string | null; created_at?: string; note?: string | null }

function DmGlobalPanel({ onValidate }: { onValidate: () => void }) {
  const toast = useToast();
  const dmId = useDmBuilderStore((s) => s.dmId);
  const brandKit = useDmBuilderStore((s) => s.brandKit);
  const updateBrandKit = useDmBuilderStore((s) => s.updateBrandKit);
  const applyBrandKit = useDmBuilderStore((s) => s.applyBrandKit);
  const layoutMode = useDmBuilderStore((s) => s.layoutMode);
  const catalogView = useDmBuilderStore((s) => s.catalogView);
  const setLayoutMode = useDmBuilderStore((s) => s.setLayoutMode);
  const setCatalogView = useDmBuilderStore((s) => s.setCatalogView);
  const setOpenModal = useDmBuilderStore((s) => s.setOpenModal);
  const loadDm = useDmBuilderStore((s) => s.loadDm);
  const [companyKit, setCompanyKit] = useState<Record<string, any> | null>(null);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/dm/brand-kit', { headers: authGet() });
        const d = await r.json().catch(() => ({}));
        if (alive && d?.brand_kit) setCompanyKit(d.brand_kit);
      } catch { /* 브랜드 기본 칩만 숨는다 */ }
    })();
    return () => { alive = false; };
  }, []);
  const loadVersions = useCallback(async () => {
    if (!dmId) return;
    try {
      const r = await fetch(`/api/dm/${dmId}/versions`, { headers: authGet() });
      const d = await r.json().catch(() => ({}));
      setVersions(Array.isArray(d) ? d : Array.isArray(d?.versions) ? d.versions : []);
    } catch { setVersions([]); }
  }, [dmId]);
  useEffect(() => { void loadVersions(); }, [loadVersions]);

  const view: 'scroll' | 'slides' | 'catalog' = layoutMode === 'slides' ? (catalogView ? 'catalog' : 'slides') : 'scroll';
  const setView = (v: 'scroll' | 'slides' | 'catalog') => {
    if (v === 'scroll') setLayoutMode('scroll');
    else if (v === 'slides') { setLayoutMode('slides'); setCatalogView(false); }
    else setCatalogView(true);
  };
  const fontId = DM_FONT_CATALOG.find((f) => f.css === brandKit.font_family)?.id || 'pretendard';
  const fonts = [{ id: 'pretendard', label: '기본 고딕' }, { id: 'gowun-dodum', label: '부드러운' }, { id: 'noto-serif', label: '명조' }];
  const primary = brandKit.primary_color || '#9a4f2c';
  const themes = DM_DESIGN_THEMES.slice(0, 3);

  const snapshot = async () => {
    if (!dmId || busy) return;
    setBusy('snap');
    try {
      const st = useDmBuilderStore.getState();
      if (st.isDirty) await st.save({ silent: true });
      const r = await fetch(`/api/dm/${dmId}/versions`, { method: 'POST', headers: authJson(), body: JSON.stringify({ label: `${new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 모습`, note: null }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || '남기지 못했어요.');
      toast.success('지금 모습을 남겼어요.');
      await loadVersions();
    } catch (e: any) { toast.error(e?.message || '남기지 못했어요.'); } finally { setBusy(null); }
  };
  const restore = async (v: VersionRow) => {
    if (!dmId || busy) return;
    setBusy(v.id);
    try {
      const r = await fetch(`/api/dm/${dmId}/versions/${v.id}/restore`, { method: 'POST', headers: authJson() });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || '되돌리지 못했어요.');
      await loadDm(dmId);
      toast.success('그 모습으로 되돌렸어요.');
    } catch (e: any) { toast.error(e?.message || '되돌리지 못했어요.'); } finally { setBusy(null); }
  };

  return (
    <div className="flex flex-col min-h-full">
      <PanelHead icon={<Palette className="w-5 h-5" />} title="전체 설정" sub="블록을 고르지 않았을 때 · DM 전체에 적용" />
      <PanelBlock title="디자인 테마" hint="색·서체만 바뀌고 내용은 그대로" right={<button type="button" onClick={() => setOpenModal('design-theme')} className="text-[11.5px] font-semibold text-violet-700 hover:text-violet-800">더 보기</button>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {companyKit && (
            <ThemeTile name="브랜드 기본" swatches={[companyKit.primary_color || '#9a4f2c', companyKit.secondary_color || '#2b2320', '#ffffff']} onClick={() => applyBrandKit({ ...brandKit, ...companyKit })} />
          )}
          {themes.map((t) => <ThemeTile key={t.id} name={t.name} swatches={t.swatches} onClick={() => updateBrandKit(t.kit)} />)}
        </div>
      </PanelBlock>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4 border-t border-slate-200">
        <div>
          <div className="text-[12.5px] font-bold text-slate-900 mb-2.5">브랜드 색</div>
          <Swatches options={[{ value: primary, color: primary, label: '지금 색' }, { value: '#2b2320', color: '#2b2320', label: '진한 갈색' }, { value: '#0f766e', color: '#0f766e', label: '청록' }]} value={primary} onChange={(v) => updateBrandKit({ primary_color: v })} custom={{ value: primary, onChange: (hex) => updateBrandKit({ primary_color: hex }) }} />
        </div>
        <div>
          <div className="text-[12.5px] font-bold text-slate-900 mb-2.5 flex items-center justify-between">서체<button type="button" onClick={() => setOpenModal('font')} className="text-[11.5px] font-semibold text-violet-700">더 보기</button></div>
          <Segmented value={fonts.some((f) => f.id === fontId) ? fontId : 'pretendard'} onChange={(id) => { const f = DM_FONT_CATALOG.find((x) => x.id === id); if (f) updateBrandKit({ font_family: f.css, font_display: f.css }); }} options={fonts.map((f) => ({ value: f.id, label: f.label }))} />
        </div>
      </div>
      <PanelBlock title="보기 방식">
        <Segmented value={view} onChange={setView} options={[{ value: 'scroll', label: '세로로 길게' }, { value: 'slides', label: '옆으로 넘기기' }, { value: 'catalog', label: <span className="inline-flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />책처럼(카탈로그)</span> }]} />
      </PanelBlock>
      <PanelBlock title="버전 기록" hint="남긴 모습으로 되돌릴 수 있어요" right={<button type="button" onClick={() => { void snapshot(); }} disabled={busy === 'snap'} className="text-[11.5px] font-semibold text-violet-700 hover:text-violet-800 disabled:opacity-40">{busy === 'snap' ? '남기는 중' : '지금 모습 남기기'}</button>}>
        {versions === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : versions.length === 0 ? (
          <div className="text-[12px] text-slate-400">아직 남긴 모습이 없어요.</div>
        ) : (
          <div className="space-y-1.5">
            {versions.slice(0, 3).map((v) => (
              <div key={v.id} className="flex items-center gap-3 h-9 px-3 rounded-lg bg-white">
                <span className="text-[12px] text-slate-500 w-[64px] shrink-0">{v.created_at ? new Date(v.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : ''}</span>
                <span className="text-[12.5px] text-slate-700 flex-1 truncate">{v.label || v.note || '남긴 모습'}</span>
                <button type="button" onClick={() => { void restore(v); }} disabled={!!busy} className="text-[12px] font-semibold text-violet-700 hover:text-violet-800 disabled:opacity-40">{busy === v.id ? '되돌리는 중' : '되돌리기'}</button>
              </div>
            ))}
            {versions.length > 3 && <button type="button" onClick={() => setOpenModal('version-history')} className="text-[12px] text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"><History className="w-3.5 h-3.5" />전체 보기</button>}
          </div>
        )}
      </PanelBlock>
      <PanelBlock title="AI로 다시 구성" hint="한 줄로 방향을 주면 블록 구성을 새로 짜요">
        <button type="button" onClick={() => setOpenModal('ai-prompt')} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12.5px] font-semibold text-fuchsia-900 border border-fuchsia-300 bg-fuchsia-50 hover:bg-fuchsia-100"><Wand2 className="w-4 h-4" />AI로 다시 구성하기</button>
      </PanelBlock>
      <div className="mt-auto pt-6 flex items-center gap-5 text-[12.5px] text-slate-500">
        <button type="button" onClick={() => setOpenModal('ab-test')} className="inline-flex items-center gap-1.5 hover:text-slate-900"><FlaskConical className="w-4 h-4" />A/B 테스트</button>
        <button type="button" onClick={onValidate} className="inline-flex items-center gap-1.5 hover:text-slate-900"><ShieldCheck className="w-4 h-4" />보내기 전 점검 다시 하기</button>
      </div>
    </div>
  );
}

function ThemeTile({ name, swatches, onClick }: { name: string; swatches: [string, string, string] | string[]; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5 group">
      <span className="w-full h-12 rounded-lg p-2 bg-slate-100 group-hover:bg-slate-200 flex flex-col justify-center gap-1.5" style={{ background: swatches[2] }}>
        <span className="block h-1.5 w-3/4 rounded-full" style={{ background: swatches[0] }} />
        <span className="block h-2.5 w-1/2 rounded" style={{ background: swatches[1] }} />
      </span>
      <span className="text-[11.5px] text-slate-600">{name}</span>
    </button>
  );
}

// ─────────────────────────────── 카탈로그(쪽) ───────────────────────────────

function galleryOf(p: { sections: Section[] }): Section | null {
  return p.sections.find((x) => x.type === 'gallery') || null;
}
function pageImage(p: { sections: Section[] }): string | null {
  const g = galleryOf(p);
  const url = (g?.props as any)?.images?.[0]?.url;
  return typeof url === 'string' ? url : null;
}

function CatalogLeft({ onRemove }: { onRemove: (idx: number) => void }) {
  const toast = useToast();
  const pages = useDmBuilderStore((s) => s.pages);
  const selectedId = useDmBuilderStore((s) => s.selectedSectionId);
  const reorderPages = useDmBuilderStore((s) => s.reorderPages);
  const brandColor = useDmBuilderStore((s) => s.brandKit.primary_color);
  const [menu, setMenu] = useState(false);
  const [tpl, setTpl] = useState<CatalogTemplateKey | null>(null);
  const [studio, setStudio] = useState(false);
  const [lib, setLib] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const items: BlockRowItem[] = pages.map((p, i) => {
    const g = galleryOf(p);
    const chips = ((g?.props as any)?.chips || []).length;
    return { id: g?.id || p.id, type: 'gallery', label: i === 0 ? '표지' : i === pages.length - 1 && pages.length > 2 ? '마무리' : `${i + 1}쪽`, summary: `사진 ${((g?.props as any)?.images || []).length}${chips ? ` · 칩 ${chips}` : ''}`, thumb: pageImage(p), index: i + 1 };
  });
  // 줄 id = 그 쪽의 사진 블록 id(없으면 쪽 id)
  const pageIndexOf = (id: string) => useDmBuilderStore.getState().pages.findIndex((p) => p.sections.some((x) => x.id === id) || p.id === id);
  const select = (id: string) => {
    const st = useDmBuilderStore.getState();
    const idx = pageIndexOf(id);
    if (idx < 0) return;
    if (idx !== st.currentPageIndex) st.selectPage(idx);
    const g = galleryOf(useDmBuilderStore.getState().pages[idx]);
    if (g) useDmBuilderStore.getState().selectSection(g.id);
  };
  const addPageWith = (url: string, chips: Array<{ label: string; price?: string; url?: string }>) => {
    const st = useDmBuilderStore.getState();
    if (st.layoutMode !== 'slides') st.setLayoutMode('slides');
    st.setCatalogView(true);
    const cur = useDmBuilderStore.getState();
    const curSecs = cur.pages[cur.currentPageIndex]?.sections || [];
    if (curSecs.length > 0) cur.addPage();
    useDmBuilderStore.getState().addSection('gallery');
    const after = useDmBuilderStore.getState();
    const list = after.pages[after.currentPageIndex]?.sections || [];
    const created = list[list.length - 1];
    if (created) {
      after.updateSectionProps(created.id, { images: [{ url }], layout: 'list_1xN', full_bleed: true, ...(chips.length ? { chips } : {}) } as any);
      after.selectSection(created.id);
    }
  };
  const uploadFiles = async (files: FileList | null) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setUploading(true);
    try { for (const f of arr) addPageWith(await uploadOne(f), []); toast.success(`${arr.length}쪽을 넣었어요.`); }
    catch { toast.error('사진을 올리지 못했어요.'); }
    finally { setUploading(false); }
  };

  return (
    <div>
      <BlockList
        title="쪽"
        hint={`${pages.length}장 · 끌어서 순서 바꾸기`}
        items={items}
        selectedId={selectedId}
        onSelect={select}
        onReorder={(from, to) => reorderPages(from, to)}
        onRemove={pages.length > 1 ? (id) => { const idx = pageIndexOf(id); if (idx >= 0) onRemove(idx); } : undefined}
        footer={(
          <AddBlockButton label="쪽 추가" open={menu} onToggle={() => setMenu((v) => !v)}>
            {/* ★ 2026-09-29 — 블록 추가 창과 같은 규칙: 버튼 바로 아래에 펼친다(옛: 왼쪽 칸 오른쪽 바깥에 떠서 좌우 스크롤·위쪽 잘림) */}
            <div className="mt-2 rounded-2xl border border-violet-300 bg-white shadow-2xl p-3.5">
              <div className="flex items-center justify-between mb-3"><b className="text-[14px] text-slate-900">쪽 추가</b><button type="button" onClick={() => setMenu(false)} className="p-1 rounded-lg text-slate-500 hover:text-slate-900"><X className="w-4 h-4" /></button></div>
              <div className="grid grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2 gap-2">
                {CATALOG_BLOCKS.map((b) => (
                  <button key={b.key} type="button" onClick={() => { setMenu(false); setTpl(b.key); }} className="text-left rounded-xl border border-slate-200 bg-white hover:bg-slate-100 px-3 py-2.5">
                    <div className="text-[12.5px] font-bold text-slate-900">{b.label}</div><div className="text-[11px] text-slate-500">{b.desc}</div>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <button type="button" onClick={() => { setMenu(false); fileRef.current?.click(); }} className="h-16 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 flex flex-col items-center justify-center gap-1 px-1 text-[11.5px] text-slate-700 text-center leading-tight break-keep"><Upload className="w-4 h-4" />완성 이미지</button>
                <button type="button" onClick={() => { setMenu(false); setStudio(true); }} className="h-16 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 flex flex-col items-center justify-center gap-1 px-1 text-[11.5px] text-slate-700 text-center leading-tight break-keep"><Sparkles className="w-4 h-4" />이미지 스튜디오</button>
                <button type="button" onClick={() => { setMenu(false); setLib(true); }} className="h-16 rounded-xl border border-slate-200 bg-white hover:bg-slate-100 flex flex-col items-center justify-center gap-1 px-1 text-[11.5px] text-slate-700 text-center leading-tight break-keep"><FolderOpen className="w-4 h-4" />저장 소재</button>
              </div>
            </div>
          </AddBlockButton>
        )}
      />
      <p className="text-[11px] text-slate-400 mt-2.5 px-1 leading-relaxed">쪽 템플릿 4종 · 완성 이미지 올리기 · 이미지 스튜디오 · 저장 소재{uploading ? ' · 올리는 중' : ''}</p>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void uploadFiles(e.target.files); e.currentTarget.value = ''; }} />
      <CatalogPageModal templateKey={tpl} open={!!tpl} onClose={() => setTpl(null)} onMade={(url, chips) => { addPageWith(url, chips); setTpl(null); }} brandColor={brandColor || null} />
      <StudioInsertModal open={studio} onClose={() => setStudio(false)} onInserted={(url) => { addPageWith(url, []); setStudio(false); }} />
      <AssetLibraryPickerModal open={lib} onClose={() => setLib(false)} multiSelect onPick={(a) => { addPageWith(a.url, []); setLib(false); }} onPickMany={(list: PickedAsset[]) => { list.forEach((a) => a.url && addPageWith(a.url, [])); setLib(false); }} />
    </div>
  );
}

function CatalogPagePanel({ section }: { section: Section }) {
  const toast = useToast();
  const pages = useDmBuilderStore((s) => s.pages);
  const updateSectionProps = useDmBuilderStore((s) => s.updateSectionProps);
  const brandColor = useDmBuilderStore((s) => s.brandKit.primary_color);
  const [tpl, setTpl] = useState<CatalogTemplateKey | null>(null);
  const [studio, setStudio] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const props = (section.props || {}) as any;
  const url: string | null = props.images?.[0]?.url || null;
  const chips: Array<{ label: string; price?: string; url?: string }> = Array.isArray(props.chips) ? props.chips : [];
  const pageNo = pages.findIndex((p) => p.sections.some((x) => x.id === section.id)) + 1;
  const setImage = (u: string) => updateSectionProps(section.id, { images: [{ ...(props.images?.[0] || {}), url: u }], layout: 'list_1xN', full_bleed: true } as any);
  const setChips = (next: typeof chips) => updateSectionProps(section.id, { chips: next.length ? next : undefined } as any);
  // ★ 2026-10-01 쪽 빼기 · ★1006 왼쪽 쪽 목록과 같은 한 곳(removePageAt · 2쪽 잠금 해제 = 확인 창에 1쪽 조건을 적는다)

  return (
    <div className="flex flex-col min-h-full">
      <PanelHead icon={<BookOpen className="w-5 h-5" />} title={`${pageNo}쪽`} sub="사진 자리에 넣고 글자를 적으면 쪽 한 장으로 만들어요" />
      <PanelBlock title="쪽 모양" hint="고르면 이 쪽을 그 모양으로 다시 만들어요">
        <div className="grid grid-cols-4 gap-2">
          {CATALOG_BLOCKS.map((b) => (
            <button key={b.key} type="button" onClick={() => setTpl(b.key)} className="flex flex-col items-center gap-1.5 group">
              <span className="w-full aspect-[3/4] rounded-lg bg-slate-100 group-hover:bg-slate-200 flex items-center justify-center text-[20px]" aria-hidden>{b.photos === 0 ? '✎' : b.photos === 2 ? '▤' : '▣'}</span>
              <span className="text-[11px] text-slate-600 text-center leading-tight">{b.label.replace(' 쪽', '')}</span>
            </button>
          ))}
        </div>
      </PanelBlock>
      <PanelBlock title="사진">
        <div className="flex items-center gap-3">
          <span className="w-16 h-20 rounded-lg overflow-hidden bg-slate-100 shrink-0">{url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-5 h-5 m-auto text-slate-400" />}</span>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-300 bg-white text-[12px] text-slate-700 hover:bg-slate-100"><Upload className="w-3.5 h-3.5" />바꾸기</button>
            <button type="button" onClick={() => setStudio(true)} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-fuchsia-300 bg-fuchsia-50 text-[12px] text-fuchsia-900 hover:bg-fuchsia-100"><Sparkles className="w-3.5 h-3.5" />스튜디오</button>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.currentTarget.value = ''; if (!f) return; try { setImage(await uploadOne(f)); } catch { toast.error('사진을 올리지 못했어요.'); } }} />
      </PanelBlock>
      <PanelBlock title="상품 칩" hint="쪽 아래 알약 · 가격·링크는 여기서만" right={chips.length < 4 ? <button type="button" onClick={() => setChips([...chips, { label: '', price: '', url: '' }])} className="text-[11.5px] font-semibold text-violet-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" />넣기</button> : undefined}>
        {chips.length === 0 && <div className="text-[12px] text-slate-400">넣지 않아도 돼요. 넣으면 휴대폰에서 누를 수 있는 알약이 쪽 아래에 붙어요.</div>}
        <div className="space-y-2">
          {chips.map((c, i) => (
            <div key={i} className="rounded-xl bg-white border border-slate-200 p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <input value={c.label} placeholder="상품명" onChange={(e) => setChips(chips.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-slate-100 border border-slate-300 text-[12.5px] text-slate-900 outline-none" />
                <input value={c.price || ''} placeholder="가격" onChange={(e) => setChips(chips.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} className="w-24 h-8 px-2.5 rounded-lg bg-slate-100 border border-slate-300 text-[12.5px] text-amber-800 font-bold outline-none" />
                <button type="button" onClick={() => setChips(chips.filter((_, j) => j !== i))} className="w-8 h-8 rounded-lg text-slate-500 hover:text-rose-700 flex items-center justify-center" aria-label="칩 빼기"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5 text-slate-400" /><input value={c.url || ''} placeholder="상품 주소(선택)" onChange={(e) => setChips(chips.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))} className="flex-1 min-w-0 h-8 px-2.5 rounded-lg bg-slate-100 border border-slate-300 text-[12px] text-slate-700 outline-none" /></div>
            </div>
          ))}
        </div>
      </PanelBlock>
      <div className="mt-auto pt-6 flex items-center gap-3">
        <button type="button" onClick={() => setTpl('one')} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-[13px] font-bold text-white bg-violet-600 hover:bg-violet-500"><Wand2 className="w-4 h-4" />이 쪽 다시 만들기</button>
        <span className="text-[12px] text-slate-500">크레딧 0</span>
        {pages.length > 1 && pageNo > 0 && (
          <button
            type="button"
            onClick={() => setConfirm(pageRemoveConfirm(pageNo - 1, true, pages.length))}
            className="ml-auto inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-slate-300 bg-white text-[12.5px] text-slate-700 hover:text-rose-700 hover:border-rose-300"
            data-make="catalog-remove-page"
          ><Trash2 className="w-4 h-4" />이 쪽 빼기</button>
        )}
      </div>
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <CatalogPageModal templateKey={tpl} open={!!tpl} onClose={() => setTpl(null)} onMade={(u, c) => { setImage(u); if (c.length) setChips(c); setTpl(null); }} brandColor={brandColor || null} />
      <StudioInsertModal open={studio} onClose={() => setStudio(false)} onInserted={(u) => { setImage(u); setStudio(false); }} />
    </div>
  );
}
