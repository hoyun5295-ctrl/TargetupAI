/**
 * dmBuilderStore.ts — DM 빌더 전역 상태 (Zustand)
 *
 * 역할:
 *  - DM 엔티티(제목/섹션/브랜드킷) 중앙 관리
 *  - UI 상태(선택/호버/dirty) 관리
 *  - 섹션 CRUD + 재정렬 + 복제
 *  - 자동 저장 (debounce 2초)
 *  - DM 로드/저장 (API 연동)
 *
 * 설계서: status/DM-PRO-DESIGN.md §6-3
 */
import { create } from 'zustand';
import axios from 'axios';
import type { Section, SectionType, SectionProps } from '../utils/dm-section-defaults';
import { createSection as newSection, normalizeOrder, isMaxCountExceeded, SECTION_META } from '../utils/dm-section-defaults';

// ────────────── 타입 ──────────────

export type DmBrandKit = {
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  neutral_color?: string;
  background_color?: string;
  font_family?: string;
  tone?: 'premium' | 'friendly' | 'urgent' | 'elegant' | 'playful';
  contact?: { phone?: string; email?: string; website?: string };
  sns?: { instagram?: string; youtube?: string; kakao?: string; naver?: string };
};

export type LayoutMode = 'scroll' | 'slides' | 'scroll_snap';
export type ApprovalStatus = 'draft' | 'review' | 'approved' | 'published';

/** 페이지 계층 — 1 페이지에 여러 섹션을 조립 (D128 V4) */
export type DmPage = {
  id: string;
  name?: string;
  sections: Section[];
};

export type ValidationItem = {
  area: string;
  severity: 'fatal' | 'recommend' | 'improve';
  section_id?: string;
  message: string;
  fix_suggestion?: string;
};

export type ValidationResult = {
  level: 'pass' | 'warning' | 'error';
  items: ValidationItem[];
  can_publish: boolean;
  checked_at: string;
};

export type ModalKey =
  | 'ai-prompt'
  | 'ai-improve'
  | 'validation'
  | 'version-history'
  | 'brand-kit'
  | 'ab-test'
  | null;

export type DmBuilderState = {
  // ── Entity ──
  dmId: string | null;
  title: string;
  storeName: string;
  /** D128 V4 — 페이지 계층 (pages[currentPageIndex].sections가 현재 편집 중인 섹션) */
  pages: DmPage[];
  currentPageIndex: number;
  /** pages[currentPageIndex].sections 동기 뷰 (기존 호출부 하위호환용) */
  sections: Section[];
  brandKit: DmBrandKit;
  layoutMode: LayoutMode;
  approvalStatus: ApprovalStatus;
  templateId: string | null;
  aiPrompt: string;

  // ── UI ──
  selectedSectionId: string | null;
  hoveredSectionId: string | null;
  isDirty: boolean;
  lastSavedAt: number | null;
  isSaving: boolean;
  loadError: string | null;

  // ── AI / 검수 ──
  aiGenerating: boolean;
  validationResult: ValidationResult | null;
  validationRunning: boolean;

  // ── Modal ──
  openModal: ModalKey;

  // ── Toast ──
  toast: { type: 'success' | 'error' | 'info'; message: string } | null;

  // ── Actions: Entity ──
  setTitle: (title: string) => void;
  setStoreName: (name: string) => void;
  applyBrandKit: (kit: DmBrandKit) => void;
  updateBrandKit: (patch: Partial<DmBrandKit>) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setAiPrompt: (prompt: string) => void;

  // ── Actions: Page CRUD (D128 V4) ──
  addPage: (name?: string) => void;
  removePage: (idx: number) => void;
  duplicatePage: (idx: number) => void;
  renamePage: (idx: number, name: string) => void;
  reorderPages: (fromIdx: number, toIdx: number) => void;
  selectPage: (idx: number) => void;

  // ── Actions: Section CRUD (현재 페이지 대상) ──
  setSections: (sections: Section[]) => void;
  addSection: (type: SectionType, afterId?: string) => void;
  removeSection: (id: string) => void;
  duplicateSection: (id: string) => void;
  reorderSections: (fromIdx: number, toIdx: number) => void;
  moveSection: (id: string, direction: 'up' | 'down') => void;
  updateSectionProps: (id: string, patch: Partial<SectionProps>) => void;
  setSectionVisible: (id: string, visible: boolean) => void;
  setSectionVariant: (id: string, variant: string) => void;
  toggleSectionLock: (id: string) => void;

  // ── Actions: UI ──
  selectSection: (id: string | null) => void;
  hoverSection: (id: string | null) => void;
  setToast: (toast: DmBuilderState['toast']) => void;
  setOpenModal: (key: ModalKey) => void;

  // ── Actions: AI 적용 ──
  applyAiGenerated: (sections: Section[], brandKit?: DmBrandKit, prompt?: string) => void;

  // ── Actions: Persistence ──
  loadDm: (id: string) => Promise<void>;
  save: (opts?: { silent?: boolean }) => Promise<void>;
  createNew: (opts?: { title?: string; storeName?: string; layoutMode?: LayoutMode }) => void;
  reset: () => void;

  // ── Actions: Validation ──
  runValidation: () => Promise<ValidationResult | null>;
};

// ────────────── 기본값 ──────────────

const DEFAULT_BRAND_KIT: DmBrandKit = {
  primary_color: '#4f46e5',
  tone: 'friendly',
};

function newPageId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyPage(name?: string): DmPage {
  return { id: newPageId(), name, sections: [] };
}

const INITIAL_STATE: Pick<
  DmBuilderState,
  | 'dmId' | 'title' | 'storeName' | 'pages' | 'currentPageIndex' | 'sections' | 'brandKit' | 'layoutMode'
  | 'approvalStatus' | 'templateId' | 'aiPrompt'
  | 'selectedSectionId' | 'hoveredSectionId' | 'isDirty' | 'lastSavedAt'
  | 'isSaving' | 'loadError' | 'aiGenerating' | 'validationResult'
  | 'validationRunning' | 'openModal' | 'toast'
> = {
  dmId: null,
  title: '',
  storeName: '',
  pages: [emptyPage()],
  currentPageIndex: 0,
  sections: [],
  brandKit: { ...DEFAULT_BRAND_KIT },
  layoutMode: 'scroll',
  approvalStatus: 'draft',
  templateId: null,
  aiPrompt: '',
  selectedSectionId: null,
  hoveredSectionId: null,
  isDirty: false,
  lastSavedAt: null,
  isSaving: false,
  loadError: null,
  aiGenerating: false,
  validationResult: null,
  validationRunning: false,
  openModal: null,
  toast: null,
};

// ────────────── 유틸 ──────────────

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token');
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutosave(save: () => void) {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(save, 2000);
}

function markDirty<T extends Partial<DmBuilderState>>(patch: T): T & { isDirty: true } {
  return { ...patch, isDirty: true };
}

/**
 * 현재 페이지의 sections를 갱신 + top-level sections 동기 미러 유지.
 * 모든 섹션 CRUD 액션의 공통 진입점.
 */
function updateCurrentPageSections(
  state: DmBuilderState,
  updater: (sections: Section[]) => Section[],
): Pick<DmBuilderState, 'pages' | 'sections'> {
  const idx = state.currentPageIndex;
  const page = state.pages[idx];
  if (!page) return { pages: state.pages, sections: state.sections };
  const nextSections = normalizeOrder(updater(page.sections));
  const nextPages = state.pages.map((p, i) =>
    i === idx ? { ...p, sections: nextSections } : p,
  );
  return { pages: nextPages, sections: nextSections };
}

/**
 * API 응답 dm을 pages 계층 구조로 정규화.
 * - new: dm.pages = [{id, name?, sections}]           → 그대로 사용
 * - legacy D125~D127: dm.sections = Section[]         → [{id, sections}]로 감싸기
 * - legacy D119: dm.pages = [{imageUrl, ...}] (slides) → 변환기 통해 이미 sections로 이관됐음 가정
 * - 빈 DM                                              → [emptyPage()]
 */
function normalizePagesFromDm(dm: any): DmPage[] {
  // dm.pages가 새 구조인지 검사 (배열 원소에 sections 필드 존재)
  let rawPages = dm.pages;
  if (typeof rawPages === 'string') {
    try { rawPages = JSON.parse(rawPages); } catch { rawPages = null; }
  }
  if (Array.isArray(rawPages) && rawPages.length > 0 && rawPages[0] && Array.isArray(rawPages[0].sections)) {
    return rawPages.map((p: any): DmPage => ({
      id: p.id || newPageId(),
      name: p.name,
      sections: normalizeOrder(Array.isArray(p.sections) ? p.sections : []),
    }));
  }

  // sections 컬럼 폴백
  let rawSections = dm.sections;
  if (typeof rawSections === 'string') {
    try { rawSections = JSON.parse(rawSections); } catch { rawSections = null; }
  }
  if (Array.isArray(rawSections) && rawSections.length > 0) {
    return [{ id: newPageId(), sections: normalizeOrder(rawSections) }];
  }

  // 완전 빈 DM
  return [emptyPage()];
}

// ────────────── 스토어 ──────────────

export const useDmBuilderStore = create<DmBuilderState>((set, get) => ({
  ...INITIAL_STATE,

  // ── Entity ──
  setTitle: (title) => {
    set(markDirty({ title }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },
  setStoreName: (storeName) => set(markDirty({ storeName })),
  applyBrandKit: (brandKit) => {
    set(markDirty({ brandKit }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },
  updateBrandKit: (patch) => {
    set((s) => markDirty({ brandKit: { ...s.brandKit, ...patch } }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },
  setLayoutMode: (layoutMode) => set(markDirty({ layoutMode })),
  setAiPrompt: (aiPrompt) => set(markDirty({ aiPrompt })),

  // ── Page CRUD (D128 V4) ──
  addPage: (name) => {
    set((s) => {
      const np = emptyPage(name);
      const nextPages = [...s.pages, np];
      return markDirty({
        pages: nextPages,
        currentPageIndex: nextPages.length - 1,
        sections: np.sections,
        selectedSectionId: null,
      });
    });
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  removePage: (idx) => {
    set((s) => {
      if (idx < 0 || idx >= s.pages.length) return s;
      if (s.pages.length <= 1) {
        return { toast: { type: 'error', message: '페이지는 최소 1개 이상 필요해요.' } } as Partial<DmBuilderState>;
      }
      const nextPages = s.pages.filter((_, i) => i !== idx);
      const newCurrent = Math.max(0, Math.min(s.currentPageIndex, nextPages.length - 1));
      return markDirty({
        pages: nextPages,
        currentPageIndex: newCurrent,
        sections: nextPages[newCurrent]?.sections || [],
        selectedSectionId: null,
      });
    });
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  duplicatePage: (idx) => {
    set((s) => {
      if (idx < 0 || idx >= s.pages.length) return s;
      const src = s.pages[idx];
      const clone: DmPage = {
        id: newPageId(),
        name: src.name ? `${src.name} 복사` : undefined,
        sections: src.sections.map((sec) => ({
          ...sec,
          id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${sec.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          props: JSON.parse(JSON.stringify(sec.props)),
          variable_fallbacks: sec.variable_fallbacks ? JSON.parse(JSON.stringify(sec.variable_fallbacks)) : [],
        })),
      };
      const nextPages = [...s.pages.slice(0, idx + 1), clone, ...s.pages.slice(idx + 1)];
      return markDirty({
        pages: nextPages,
        currentPageIndex: idx + 1,
        sections: clone.sections,
        selectedSectionId: null,
      });
    });
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  renamePage: (idx, name) => {
    set((s) => {
      if (idx < 0 || idx >= s.pages.length) return s;
      const nextPages = s.pages.map((p, i) => (i === idx ? { ...p, name } : p));
      return markDirty({ pages: nextPages });
    });
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  reorderPages: (fromIdx, toIdx) => {
    set((s) => {
      if (fromIdx < 0 || fromIdx >= s.pages.length || toIdx < 0 || toIdx >= s.pages.length) return s;
      if (fromIdx === toIdx) return s;
      const nextPages = s.pages.slice();
      const [moved] = nextPages.splice(fromIdx, 1);
      nextPages.splice(toIdx, 0, moved);
      // 현재 페이지 추적 갱신
      const currentId = s.pages[s.currentPageIndex]?.id;
      const newCurrent = currentId ? nextPages.findIndex((p) => p.id === currentId) : s.currentPageIndex;
      return markDirty({
        pages: nextPages,
        currentPageIndex: newCurrent >= 0 ? newCurrent : 0,
        sections: nextPages[newCurrent >= 0 ? newCurrent : 0]?.sections || [],
      });
    });
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  selectPage: (idx) => {
    set((s) => {
      if (idx < 0 || idx >= s.pages.length || idx === s.currentPageIndex) return s;
      return {
        currentPageIndex: idx,
        sections: s.pages[idx]?.sections || [],
        selectedSectionId: null,
      };
    });
  },

  // ── Section CRUD (현재 페이지 대상) ──
  setSections: (sections) => {
    set((s) => markDirty(updateCurrentPageSections(s, () => sections)));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  addSection: (type, afterId) => {
    const state = get();
    const cur = state.pages[state.currentPageIndex]?.sections || [];
    if (isMaxCountExceeded(cur, type)) {
      set({ toast: { type: 'error', message: `${SECTION_META[type].label}은(는) 이 페이지에 최대 ${SECTION_META[type].maxCount}개까지 추가할 수 있어요.` } });
      return;
    }
    const afterIdx = afterId ? cur.findIndex((s) => s.id === afterId) : cur.length - 1;
    const insertAt = afterIdx >= 0 ? afterIdx + 1 : cur.length;
    const created = newSection(type, insertAt);
    set((s) => markDirty({
      ...updateCurrentPageSections(s, (list) => {
        const next = list.slice();
        next.splice(insertAt, 0, created);
        return next;
      }),
      selectedSectionId: created.id,
    }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  removeSection: (id) => {
    set((s) => markDirty({
      ...updateCurrentPageSections(s, (list) => list.filter((sec) => sec.id !== id)),
      selectedSectionId: s.selectedSectionId === id ? null : s.selectedSectionId,
    }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  duplicateSection: (id) => {
    const state = get();
    const cur = state.pages[state.currentPageIndex]?.sections || [];
    const src = cur.find((s) => s.id === id);
    if (!src) return;
    if (isMaxCountExceeded(cur, src.type)) {
      set({ toast: { type: 'error', message: `${SECTION_META[src.type].label}은(는) 이 페이지에 최대 ${SECTION_META[src.type].maxCount}개까지 추가할 수 있어요.` } });
      return;
    }
    const idx = cur.findIndex((s) => s.id === id);
    const clone: Section = {
      ...src,
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${src.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      order: idx + 1,
      props: JSON.parse(JSON.stringify(src.props)),
      variable_fallbacks: src.variable_fallbacks ? JSON.parse(JSON.stringify(src.variable_fallbacks)) : [],
    };
    set((s) => markDirty({
      ...updateCurrentPageSections(s, (list) => {
        const next = list.slice();
        next.splice(idx + 1, 0, clone);
        return next;
      }),
      selectedSectionId: clone.id,
    }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  reorderSections: (fromIdx, toIdx) => {
    set((s) => {
      const cur = s.pages[s.currentPageIndex]?.sections || [];
      if (fromIdx < 0 || fromIdx >= cur.length || toIdx < 0 || toIdx >= cur.length) return s;
      if (fromIdx === toIdx) return s;
      return markDirty(updateCurrentPageSections(s, (list) => {
        const next = list.slice();
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      }));
    });
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  moveSection: (id, direction) => {
    const { sections, reorderSections } = get();
    const idx = sections.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= sections.length) return;
    reorderSections(idx, target);
  },

  updateSectionProps: (id, patch) => {
    set((s) => markDirty(updateCurrentPageSections(s, (list) =>
      list.map((sec) => sec.id === id ? { ...sec, props: { ...sec.props, ...patch } as SectionProps } : sec),
    )));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  setSectionVisible: (id, visible) => {
    set((s) => markDirty(updateCurrentPageSections(s, (list) =>
      list.map((sec) => sec.id === id ? { ...sec, visible } : sec),
    )));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  setSectionVariant: (id, style_variant) => {
    set((s) => markDirty(updateCurrentPageSections(s, (list) =>
      list.map((sec) => sec.id === id ? { ...sec, style_variant } : sec),
    )));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  toggleSectionLock: (id) => {
    set((s) => markDirty(updateCurrentPageSections(s, (list) =>
      list.map((sec) => sec.id === id ? { ...sec, ai_locked: !sec.ai_locked } : sec),
    )));
  },

  // ── UI ──
  selectSection: (id) => set({ selectedSectionId: id }),
  hoverSection: (id) => set({ hoveredSectionId: id }),
  setToast: (toast) => set({ toast }),
  setOpenModal: (openModal) => set({ openModal }),

  // ── AI 적용 (현재 페이지의 sections 교체) ──
  applyAiGenerated: (sections, brandKit, prompt) => {
    set((s) => markDirty({
      ...updateCurrentPageSections(s, () => sections),
      brandKit: brandKit ? { ...s.brandKit, ...brandKit } : s.brandKit,
      aiPrompt: prompt !== undefined ? prompt : s.aiPrompt,
      selectedSectionId: null,
      validationResult: null,
    }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  // ── Persistence ──
  loadDm: async (id) => {
    set({ loadError: null });
    try {
      const res = await api.get(`/dm/${id}`);
      const dm = res.data as any;
      const pages = normalizePagesFromDm(dm);
      const rawBrand = dm.brand_kit
        ? (typeof dm.brand_kit === 'string' ? (() => { try { return JSON.parse(dm.brand_kit); } catch { return {}; } })() : dm.brand_kit)
        : {};
      set({
        dmId: dm.id,
        title: dm.title || '',
        storeName: dm.store_name || '',
        pages,
        currentPageIndex: 0,
        sections: pages[0]?.sections || [],
        brandKit: { ...DEFAULT_BRAND_KIT, ...rawBrand },
        layoutMode: dm.layout_mode || 'scroll',
        approvalStatus: dm.approval_status || 'draft',
        templateId: dm.template_id || null,
        aiPrompt: dm.ai_prompt || '',
        isDirty: false,
        lastSavedAt: Date.now(),
        selectedSectionId: null,
        validationResult: dm.validation_result || null,
        loadError: null,
      });
    } catch (err: any) {
      set({ loadError: err?.response?.data?.error || err?.message || '불러오기 실패' });
    }
  },

  save: async (opts) => {
    const silent = !!opts?.silent;
    const s = get();
    if (s.isSaving) return;
    set({ isSaving: true });
    try {
      // pages 구조로 저장 + 하위호환을 위해 전체 섹션 flat도 동봉
      const flatSections = s.pages.flatMap((p) => p.sections);
      const body = {
        title: s.title,
        store_name: s.storeName,
        pages: s.pages,
        sections: flatSections,
        brand_kit: s.brandKit,
        layout_mode: s.layoutMode,
        template_id: s.templateId,
        ai_prompt: s.aiPrompt,
      };
      if (s.dmId) {
        await api.put(`/dm/${s.dmId}`, body);
      } else {
        const res = await api.post('/dm', body);
        const created = res.data as any;
        set({ dmId: created.id || created.dmId });
      }
      set({ isDirty: false, lastSavedAt: Date.now(), isSaving: false });
      if (!silent) set({ toast: { type: 'success', message: '저장했어요.' } });
    } catch (err: any) {
      set({ isSaving: false, toast: { type: 'error', message: err?.response?.data?.error || '저장 실패' } });
    }
  },

  createNew: (opts) => {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    const initialPage = emptyPage();
    set({
      ...INITIAL_STATE,
      title: opts?.title || '',
      storeName: opts?.storeName || '',
      layoutMode: opts?.layoutMode || 'scroll',
      pages: [initialPage],
      currentPageIndex: 0,
      sections: initialPage.sections,
      brandKit: { ...DEFAULT_BRAND_KIT },
    });
  },

  reset: () => {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    const initialPage = emptyPage();
    set({
      ...INITIAL_STATE,
      pages: [initialPage],
      currentPageIndex: 0,
      sections: initialPage.sections,
      brandKit: { ...DEFAULT_BRAND_KIT },
    });
  },

  // ── Validation ──
  runValidation: async () => {
    const s = get();
    if (!s.dmId) {
      set({ toast: { type: 'error', message: '먼저 저장 후 검수할 수 있어요.' } });
      return null;
    }
    set({ validationRunning: true });
    try {
      const res = await api.post(`/dm/${s.dmId}/validate`);
      const result = res.data as ValidationResult;
      set({ validationResult: result, validationRunning: false });
      return result;
    } catch (err: any) {
      set({ validationRunning: false, toast: { type: 'error', message: err?.response?.data?.error || '검수 실패' } });
      return null;
    }
  },
}));

// ────────────── 헬퍼 셀렉터 ──────────────

export const selectSelectedSection = (state: DmBuilderState): Section | null => {
  if (!state.selectedSectionId) return null;
  // 현재 페이지에서 먼저 찾고, 없으면 전체 페이지에서 찾기
  const cur = state.pages[state.currentPageIndex]?.sections || [];
  const inCur = cur.find((s) => s.id === state.selectedSectionId);
  if (inCur) return inCur;
  for (const p of state.pages) {
    const f = p.sections.find((s) => s.id === state.selectedSectionId);
    if (f) return f;
  }
  return null;
};

/** 전체 페이지의 섹션을 평평하게 반환 (검수/AI개선 등 전역 작업용) */
export const selectAllSectionsFlat = (state: DmBuilderState): Section[] =>
  state.pages.flatMap((p) => p.sections);

/** 현재 페이지 객체 */
export const selectCurrentPage = (state: DmBuilderState): DmPage | null =>
  state.pages[state.currentPageIndex] || null;
