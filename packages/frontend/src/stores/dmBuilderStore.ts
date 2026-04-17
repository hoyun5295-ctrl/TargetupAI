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

export type LayoutMode = 'scroll' | 'slides';
export type ApprovalStatus = 'draft' | 'review' | 'approved' | 'published';

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

export type DmBuilderState = {
  // ── Entity ──
  dmId: string | null;
  title: string;
  storeName: string;
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

  // ── Toast ──
  toast: { type: 'success' | 'error' | 'info'; message: string } | null;

  // ── Actions: Entity ──
  setTitle: (title: string) => void;
  setStoreName: (name: string) => void;
  applyBrandKit: (kit: DmBrandKit) => void;
  updateBrandKit: (patch: Partial<DmBrandKit>) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setAiPrompt: (prompt: string) => void;

  // ── Actions: Section CRUD ──
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

  // ── Actions: AI 적용 ──
  applyAiGenerated: (sections: Section[], brandKit?: DmBrandKit, prompt?: string) => void;

  // ── Actions: Persistence ──
  loadDm: (id: string) => Promise<void>;
  save: (opts?: { silent?: boolean }) => Promise<void>;
  createNew: (opts?: { title?: string; storeName?: string }) => void;
  reset: () => void;

  // ── Actions: Validation ──
  runValidation: () => Promise<ValidationResult | null>;
};

// ────────────── 기본값 ──────────────

const DEFAULT_BRAND_KIT: DmBrandKit = {
  primary_color: '#4f46e5',
  tone: 'friendly',
};

const INITIAL_STATE: Pick<
  DmBuilderState,
  | 'dmId' | 'title' | 'storeName' | 'sections' | 'brandKit' | 'layoutMode'
  | 'approvalStatus' | 'templateId' | 'aiPrompt'
  | 'selectedSectionId' | 'hoveredSectionId' | 'isDirty' | 'lastSavedAt'
  | 'isSaving' | 'loadError' | 'aiGenerating' | 'validationResult'
  | 'validationRunning' | 'toast'
> = {
  dmId: null,
  title: '',
  storeName: '',
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

  // ── Section CRUD ──
  setSections: (sections) => {
    set(markDirty({ sections: normalizeOrder(sections) }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  addSection: (type, afterId) => {
    const { sections } = get();
    if (isMaxCountExceeded(sections, type)) {
      set({ toast: { type: 'error', message: `${SECTION_META[type].label}은(는) 최대 ${SECTION_META[type].maxCount}개까지 추가할 수 있어요.` } });
      return;
    }
    const afterIdx = afterId ? sections.findIndex((s) => s.id === afterId) : sections.length - 1;
    const insertAt = afterIdx >= 0 ? afterIdx + 1 : sections.length;
    const next = sections.slice();
    const created = newSection(type, insertAt);
    next.splice(insertAt, 0, created);
    const normalized = normalizeOrder(next);
    set(markDirty({ sections: normalized, selectedSectionId: created.id }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  removeSection: (id) => {
    const next = get().sections.filter((s) => s.id !== id);
    const normalized = normalizeOrder(next);
    set((s) => markDirty({
      sections: normalized,
      selectedSectionId: s.selectedSectionId === id ? null : s.selectedSectionId,
    }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  duplicateSection: (id) => {
    const { sections } = get();
    const src = sections.find((s) => s.id === id);
    if (!src) return;
    if (isMaxCountExceeded(sections, src.type)) {
      set({ toast: { type: 'error', message: `${SECTION_META[src.type].label}은(는) 최대 ${SECTION_META[src.type].maxCount}개까지 추가할 수 있어요.` } });
      return;
    }
    const idx = sections.findIndex((s) => s.id === id);
    const clone: Section = {
      ...src,
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${src.type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      order: idx + 1,
      props: JSON.parse(JSON.stringify(src.props)),
      variable_fallbacks: src.variable_fallbacks ? JSON.parse(JSON.stringify(src.variable_fallbacks)) : [],
    };
    const next = sections.slice();
    next.splice(idx + 1, 0, clone);
    set(markDirty({ sections: normalizeOrder(next), selectedSectionId: clone.id }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  reorderSections: (fromIdx, toIdx) => {
    const { sections } = get();
    if (fromIdx < 0 || fromIdx >= sections.length || toIdx < 0 || toIdx >= sections.length) return;
    if (fromIdx === toIdx) return;
    const next = sections.slice();
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    set(markDirty({ sections: normalizeOrder(next) }));
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
    const next = get().sections.map((s) =>
      s.id === id ? { ...s, props: { ...s.props, ...patch } as SectionProps } : s
    );
    set(markDirty({ sections: next }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  setSectionVisible: (id, visible) => {
    const next = get().sections.map((s) => (s.id === id ? { ...s, visible } : s));
    set(markDirty({ sections: next }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  setSectionVariant: (id, style_variant) => {
    const next = get().sections.map((s) => (s.id === id ? { ...s, style_variant } : s));
    set(markDirty({ sections: next }));
    scheduleAutosave(() => { if (get().dmId) void get().save({ silent: true }); });
  },

  toggleSectionLock: (id) => {
    const next = get().sections.map((s) => (s.id === id ? { ...s, ai_locked: !s.ai_locked } : s));
    set(markDirty({ sections: next }));
  },

  // ── UI ──
  selectSection: (id) => set({ selectedSectionId: id }),
  hoverSection: (id) => set({ hoveredSectionId: id }),
  setToast: (toast) => set({ toast }),

  // ── AI 적용 ──
  applyAiGenerated: (sections, brandKit, prompt) => {
    set((s) => markDirty({
      sections: normalizeOrder(sections),
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
      const rawSections: Section[] = Array.isArray(dm.sections) ? dm.sections
        : (typeof dm.sections === 'string' ? (() => { try { return JSON.parse(dm.sections); } catch { return []; } })() : []);
      const rawBrand = dm.brand_kit
        ? (typeof dm.brand_kit === 'string' ? (() => { try { return JSON.parse(dm.brand_kit); } catch { return {}; } })() : dm.brand_kit)
        : {};
      set({
        dmId: dm.id,
        title: dm.title || '',
        storeName: dm.store_name || '',
        sections: normalizeOrder(rawSections),
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
      const body = {
        title: s.title,
        store_name: s.storeName,
        sections: s.sections,
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
    set({
      ...INITIAL_STATE,
      title: opts?.title || '',
      storeName: opts?.storeName || '',
      brandKit: { ...DEFAULT_BRAND_KIT },
    });
  },

  reset: () => {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    set({ ...INITIAL_STATE, brandKit: { ...DEFAULT_BRAND_KIT } });
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
  return state.sections.find((s) => s.id === state.selectedSectionId) || null;
};
