// components/email/EmailVisualEditor.tsx
// 이메일 비주얼 에디터 — 블록(Section[])을 비주얼로 편집 + 이미지 업로드 + 실시간 미리보기 + AI 생성 + 저장.
// DM 섹션 편집기(SectionPropsEditor)·이미지 업로더(ImageUploader 내장)·헬퍼를 차용(props 기반이라 스토어 불요).
// 렌더는 백엔드 단일 진실원(POST /api/email/render-preview). 다크 + violet 톤.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDown, ArrowUp, Copy, Eye, GripVertical, Loader2, Plus, Save, Sparkles, Trash2, Wand2, X,
} from 'lucide-react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import SectionPropsEditor from '../dm/panels/SectionPropsEditor';
import {
  createSection, normalizeOrder, SECTION_META, type Section,
} from '../../utils/dm-section-defaults';
import type { SectionType } from '../../utils/dm-section-defaults';

// 이메일에서 렌더 가능한 블록(백엔드 EMAIL_BLOCK_WHITELIST 미러 — 추가 메뉴용).
const EMAIL_BLOCK_TYPES: SectionType[] = [
  'header', 'hero', 'text_card', 'product_carousel', 'gallery',
  'coupon', 'promo_code', 'cta', 'store_info', 'sns', 'reviews', 'footer',
];

// 개인화 변수(Liquid 토큰) — 발송 시 수신자 데이터로 치환. inapp listAvailableVariables 미러(연락처 식별정보 제외).
const EMAIL_VARS: Array<{ token: string; label: string }> = [
  { token: '{{ customer.name }}', label: '회원명' },
  { token: '{{ customer.grade }}', label: '등급' },
  { token: '{{ customer.points }}', label: '포인트' },
  { token: '{{ customer.region }}', label: '지역' },
  { token: '{{ customer.recent_purchase_store }}', label: '최근 매장' },
  { token: '{{ customer.total_purchase_amount }}', label: 'LTV' },
  { token: '{{ customer.purchase_count }}', label: '구매 횟수' },
];
const CONDITION_FIELDS = ['grade', 'points', 'region', 'purchase_count', 'total_purchase_amount'];
const FIELD_LABELS: Record<string, string> = { grade: '등급', points: '포인트', region: '지역', purchase_count: '구매 횟수', total_purchase_amount: 'LTV' };

export interface EmailVisualEditorProps {
  initialSections: Section[];
  initialName?: string;
  initialSubject?: string;
  initialIsAd?: boolean;
  aiGenerated?: boolean;
  campaignId?: string;
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export default function EmailVisualEditor({
  initialSections, initialName, initialSubject, initialIsAd, aiGenerated,
  campaignId, authHeaders, onClose, onSaved, onToast,
}: EmailVisualEditorProps) {
  const [sections, setSections] = useState<Section[]>(() => normalizeOrder(initialSections || []));
  const [selectedId, setSelectedId] = useState<string | null>(initialSections?.[0]?.id || null);
  const [name, setName] = useState(initialName || 'AI 비주얼 이메일');
  const [subject, setSubject] = useState(initialSubject || '');
  const [isAd, setIsAd] = useState(initialIsAd ?? true);
  const [addOpen, setAddOpen] = useState(false);

  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [improving, setImproving] = useState(false);
  // 개인화 미리보기 — 샘플 고객(VIP/일반/신규) 토글
  const [previewSample, setPreviewSample] = useState<'none' | 'VIP' | '일반' | '신규'>('none');
  const [sampleCustomers, setSampleCustomers] = useState<Array<{ label: string; customer: Record<string, any> }>>([]);

  const selected = useMemo(() => sections.find((s) => s.id === selectedId) || null, [sections, selectedId]);

  // 변수 칩 삽입용 — 마지막으로 포커스된 입력칸 추적(공용 SectionPropsEditor 무수정).
  const lastFocusedField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const trackFieldFocus = (e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLTextAreaElement) lastFocusedField.current = t;
    else if (t instanceof HTMLInputElement && ['text', 'email', 'url', 'search', ''].includes(t.type)) lastFocusedField.current = t;
  };

  // 변수 토큰을 커서 위치에 삽입(React onChange 발화 — 네이티브 setter + input 이벤트). 입력칸 없으면 클립보드 폴백.
  const insertVarToken = (token: string, label: string) => {
    const active = document.activeElement;
    let el: HTMLInputElement | HTMLTextAreaElement | null = null;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) el = active;
    else if (lastFocusedField.current && document.contains(lastFocusedField.current)) el = lastFocusedField.current;
    if (!el) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(token).then(
          () => onToast(`${label} 변수 복사됨 — 입력칸에 붙여넣으세요`, 'info'),
          () => onToast('직접 입력해주세요: ' + token, 'warning'),
        );
      } else onToast('직접 입력해주세요: ' + token, 'info');
      return;
    }
    const target = el;
    const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    const next = target.value.slice(0, start) + token + target.value.slice(end);
    if (setter) setter.call(target, next); else target.value = next;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    const caret = start + token.length;
    requestAnimationFrame(() => { try { target.focus(); target.setSelectionRange(caret, caret); } catch { /* 일부 input type은 캐럿 설정 미지원 */ } });
  };

  // ── 실시간 미리보기 (debounce 500ms, 백엔드 렌더러 단일 진실원) ──
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const sample = previewSample !== 'none' ? sampleCustomers.find((c) => c.label === previewSample)?.customer : null;
        const res = await fetch('/api/email/render-preview', {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ sections, sampleCustomer: sample || undefined }),
        });
        const data = await res.json();
        if (data.success) setPreviewHtml(data.html || '');
      } catch { /* 미리보기 실패는 다음 변경 때 재시도 */ }
      finally { setPreviewLoading(false); }
    }, 500);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, previewSample]);

  // 미리보기 샘플 고객 로드 (VIP/일반/신규) — 개인화 미리보기 토글용
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/email/preview-customers', { headers: authHeaders() });
        const data = await res.json();
        if (data.success && Array.isArray(data.customers)) {
          setSampleCustomers(data.customers.map((c: any) => ({ label: String(c.label), customer: c.customer || {} })));
        }
      } catch { /* 샘플 고객 실패는 '변수 그대로' 폴백 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 블록 조작 ──
  const updateSelected = (patch: Record<string, any>) => {
    if (!selectedId) return;
    setSections((prev) => prev.map((s) => (s.id === selectedId ? { ...s, props: { ...(s.props as any), ...patch } } : s)));
  };

  // 섹션 최상위 필드(display_condition 등) 갱신 — props가 아닌 Section 레벨
  const updateSelectedSection = (patch: Partial<Section>) => {
    if (!selectedId) return;
    setSections((prev) => prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));
  };

  const addBlock = (type: SectionType) => {
    setAddOpen(false);
    setSections((prev) => {
      const next = normalizeOrder([...prev, createSection(type, prev.length)]);
      const added = next[next.length - 1];
      setSelectedId(added.id);
      return next;
    });
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    setSections((prev) => {
      const arr = prev.slice().sort((a, b) => a.order - b.order);
      const i = arr.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return normalizeOrder(arr);
    });
  };

  const deleteBlock = (id: string) => {
    setSections((prev) => normalizeOrder(prev.filter((s) => s.id !== id)));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // 드래그앤드롭 순서 변경 (@dnd-kit — DM SectionList과 동일 패턴, 라이브러리 추가 0)
  const reorder = (from: number, to: number) => {
    setSections((prev) => {
      const arr = prev.slice().sort((a, b) => a.order - b.order);
      if (from < 0 || to < 0 || from >= arr.length || to >= arr.length || from === to) return prev;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return normalizeOrder(arr);
    });
  };

  const duplicateBlock = (id: string) => {
    setSections((prev) => {
      const arr = prev.slice().sort((a, b) => a.order - b.order);
      const i = arr.findIndex((s) => s.id === id);
      if (i < 0) return prev;
      const copy: Section = JSON.parse(JSON.stringify(arr[i]));
      copy.id = 'dup-' + Date.now() + '-' + copy.type;
      arr.splice(i + 1, 0, copy);
      const next = normalizeOrder(arr);
      setSelectedId(copy.id);
      return next;
    });
  };

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const arr = sections.slice().sort((a, b) => a.order - b.order);
    const from = arr.findIndex((s) => s.id === String(active.id));
    const to = arr.findIndex((s) => s.id === String(over.id));
    reorder(from, to);
  };

  // ── AI 생성 (전체 블록 교체) ──
  const handleAi = async () => {
    if (aiBusy || !aiPrompt.trim()) { if (!aiPrompt.trim()) onToast('만들고 싶은 이메일을 한 줄로 적어주세요.', 'warning'); return; }
    setAiBusy(true);
    try {
      const res = await fetch('/api/email/ai/generate-sections', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ prompt: aiPrompt.trim(), is_ad: isAd }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (data.success && data.data) {
        const g = data.data;
        setSections(normalizeOrder(g.sections || []));
        setSelectedId(g.sections?.[0]?.id || null);
        if (!name || name === 'AI 비주얼 이메일') setName(g.name || name);
        if (!subject) setSubject((g.subjects && g.subjects[0]) || '');
        setAiPrompt('');
        onToast('AI가 비주얼 이메일을 만들었어요. 이미지를 채우고 다듬어주세요. (3 크레딧)', 'success');
      } else {
        onToast(data.error || 'AI 생성 실패', 'error');
      }
    } catch (e: any) {
      onToast(e?.message || 'AI 생성 중 오류', 'error');
    } finally {
      setAiBusy(false);
    }
  };

  // ── 1클릭 AI 개선 (블록 카피만 다듬기, 1크레딧 — 사실·혜택·변수 보존) ──
  const handleImprove = async () => {
    if (improving) return;
    if (sections.length === 0) { onToast('먼저 블록을 추가하거나 AI로 만들어주세요.', 'warning'); return; }
    setImproving(true);
    try {
      const res = await fetch('/api/email/ai/refine-sections', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ sections }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (data.success && Array.isArray(data.data?.sections)) {
        setSections(normalizeOrder(data.data.sections));
        onToast(data.changed === false ? '다듬을 텍스트가 없어요.' : 'AI가 카피를 다듬었어요. (1 크레딧)', data.changed === false ? 'info' : 'success');
      } else {
        onToast(data.error || 'AI 개선 실패', 'error');
      }
    } catch (e: any) {
      onToast(e?.message || 'AI 개선 중 오류', 'error');
    } finally {
      setImproving(false);
    }
  };

  // ── 저장 (sections → 백엔드가 html_body 렌더) ──
  const handleSave = async () => {
    if (!name.trim() || !subject.trim()) { onToast('이름과 제목을 입력해주세요.', 'warning'); return; }
    if (sections.length === 0) { onToast('블록을 1개 이상 추가해주세요.', 'warning'); return; }
    setSaving(true);
    try {
      const isUpdate = !!campaignId;
      const url = isUpdate ? `/api/email/campaigns/${campaignId}` : '/api/email/campaigns';
      const body: any = { name: name.trim(), subject: subject.trim(), is_ad: isAd, sections };
      if (!isUpdate && aiGenerated) body.ai_generated = true;
      const res = await fetch(url, { method: isUpdate ? 'PATCH' : 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) { onToast(isUpdate ? '저장 완료' : '캠페인 생성 완료', 'success'); onSaved(); onClose(); }
      else onToast(data.error || '저장 실패', 'error');
    } catch (e: any) {
      onToast(e?.message || '저장 중 오류', 'error');
    } finally {
      setSaving(false);
    }
  };

  const ordered = useMemo(() => sections.slice().sort((a, b) => a.order - b.order), [sections]);

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 md:p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-white/10 bg-slate-900/80">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <input
            value={name} onChange={(e) => setName(e.target.value)} placeholder="캠페인 이름"
            className="bg-transparent text-sm font-semibold text-white border-b border-white/10 focus:border-violet-400 focus:outline-none px-1 py-0.5 w-40"
          />
          <input
            value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="이메일 제목"
            className="flex-1 bg-transparent text-sm text-white/90 border-b border-white/10 focus:border-violet-400 focus:outline-none px-1 py-0.5"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-white/60 cursor-pointer shrink-0">
            <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="rounded" />광고성
          </label>
          <button onClick={handleImprove} disabled={improving || sections.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/15 px-3 py-2 text-sm font-semibold text-fuchsia-100 hover:bg-fuchsia-500/25 disabled:opacity-40 shrink-0" title="AI가 블록 카피를 매끄럽게 다듬어요 (1 크레딧 · 사실·혜택 보존)">
            {improving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}<span className="hidden md:inline">AI로 개선</span>
          </button>
          <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 shrink-0">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}저장
          </button>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10 shrink-0" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 좌: 블록 리스트 + 추가 + AI */}
          <div className="w-60 shrink-0 border-r border-white/10 flex flex-col bg-slate-900/60">
            <div className="p-3 border-b border-white/10 space-y-2">
              <div className="text-[11px] font-semibold text-white/60">AI로 만들기</div>
              <textarea
                value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} rows={2}
                placeholder="예: 여름 신상 안내, VIP에게 정중한 톤"
                className="w-full text-xs bg-slate-950/60 border border-white/10 rounded-lg px-2 py-1.5 text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50 resize-none"
              />
              <button onClick={handleAi} disabled={aiBusy || !aiPrompt.trim()} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40">
                {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}{aiBusy ? '생성 중...' : 'AI 생성 (3크레딧)'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={ordered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {ordered.map((s, i) => (
                      <SortableBlockRow
                        key={s.id}
                        section={s}
                        selected={selectedId === s.id}
                        isFirst={i === 0}
                        isLast={i === ordered.length - 1}
                        onSelect={() => setSelectedId(s.id)}
                        onUp={() => moveBlock(s.id, -1)}
                        onDown={() => moveBlock(s.id, 1)}
                        onDuplicate={() => duplicateBlock(s.id)}
                        onDelete={() => deleteBlock(s.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
              {ordered.length === 0 && <div className="text-[11px] text-white/40 px-2 py-4 text-center">블록을 추가하거나 AI로 만들어보세요.</div>}
            </div>
            <div className="p-2 border-t border-white/10 relative">
              <button onClick={() => setAddOpen((v) => !v)} className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/80 hover:bg-white/5">
                <Plus className="w-3.5 h-3.5" />블록 추가
              </button>
              {addOpen && (
                <div className="absolute bottom-12 left-2 right-2 bg-slate-800 border border-white/15 rounded-xl shadow-2xl p-1.5 max-h-72 overflow-y-auto z-10">
                  {EMAIL_BLOCK_TYPES.map((t) => (
                    <button key={t} onClick={() => addBlock(t)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-white/80 hover:bg-violet-500/20 text-left">
                      <span>{SECTION_META[t]?.icon || '▫️'}</span><span>{SECTION_META[t]?.label || t}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 중: 선택 블록 속성 편집 (DM 섹션 편집기 차용) */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 bg-slate-950/40">
            {selected ? (
              <div className="max-w-md mx-auto">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">{SECTION_META[selected.type]?.icon}</span>
                  <span className="text-sm font-semibold text-white">{SECTION_META[selected.type]?.label} 편집</span>
                </div>
                <div className="text-white" onFocus={trackFieldFocus}>
                  <SectionPropsEditor section={selected} onUpdate={updateSelected} />
                </div>

                {/* 개인화 — 변수 칩(편리한 삽입) + 조건부 표시(수신자별 맞춤) */}
                <div className="mt-4 pt-4 border-t border-white/10 space-y-3">
                  <div className="text-[11px] font-semibold text-white/60">개인화</div>
                  <div>
                    <div className="text-[10px] text-white/40 mb-1.5">입력칸을 클릭한 뒤 변수를 누르면 커서 위치에 삽입됩니다. 발송 시 수신자 정보로 자동 치환돼요.</div>
                    <div className="flex flex-wrap gap-1">
                      {EMAIL_VARS.map((v) => (
                        <button
                          key={v.token}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertVarToken(v.token, v.label)}
                          className="text-[10px] px-2 py-1 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-violet-500/20 hover:border-violet-400/40"
                        >
                          {v.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        checked={!!selected.display_condition}
                        onChange={(e) => updateSelectedSection({ display_condition: e.target.checked ? { field: 'grade', op: 'eq', value: '' } : undefined })}
                        className="rounded"
                      />
                      특정 고객에게만 표시 (조건부)
                    </label>
                    {selected.display_condition && (
                      <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                        <select
                          value={selected.display_condition.field}
                          onChange={(e) => updateSelectedSection({ display_condition: { ...selected.display_condition!, field: e.target.value } })}
                          className="text-[11px] bg-slate-950/60 border border-white/10 rounded px-1.5 py-1 text-white"
                        >
                          {CONDITION_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f] || f}</option>)}
                        </select>
                        <select
                          value={selected.display_condition.op}
                          onChange={(e) => updateSelectedSection({ display_condition: { ...selected.display_condition!, op: e.target.value as 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' } })}
                          className="text-[11px] bg-slate-950/60 border border-white/10 rounded px-1.5 py-1 text-white"
                        >
                          <option value="eq">같음</option>
                          <option value="ne">다름</option>
                          <option value="gte">이상</option>
                          <option value="lte">이하</option>
                          <option value="gt">초과</option>
                          <option value="lt">미만</option>
                          <option value="contains">포함</option>
                        </select>
                        <input
                          value={selected.display_condition.value}
                          onChange={(e) => updateSelectedSection({ display_condition: { ...selected.display_condition!, value: e.target.value } })}
                          placeholder="값 (예: VIP)"
                          className="text-[11px] bg-slate-950/60 border border-white/10 rounded px-2 py-1 text-white placeholder-white/30 w-24"
                        />
                      </div>
                    )}
                    <div className="text-[10px] text-white/30 mt-1.5">미리보기 오른쪽에서 VIP/일반/신규로 결과를 확인하세요.</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-white/40">왼쪽에서 블록을 선택하면 여기서 편집합니다.</div>
            )}
          </div>

          {/* 우: 실시간 미리보기 (백엔드 렌더 = 실제 발송 HTML) */}
          <div className="w-[360px] shrink-0 border-l border-white/10 flex flex-col bg-slate-900/60">
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 text-[11px] text-white/60">
              <Eye className="w-3.5 h-3.5" />미리보기 (실제 발송 HTML)
              {previewLoading && <Loader2 className="w-3 h-3 animate-spin ml-auto" />}
            </div>
            {sampleCustomers.length > 0 && (
              <div className="px-2 py-2 border-b border-white/10 flex flex-wrap gap-1">
                <button onClick={() => setPreviewSample('none')} className={`flex-1 min-w-[60px] text-[10px] px-1.5 py-1 rounded ${previewSample === 'none' ? 'bg-violet-500/30 border border-violet-400/40 text-white' : 'bg-slate-900/60 border border-white/10 text-white/50'}`}>변수 그대로</button>
                {sampleCustomers.map((c) => (
                  <button key={c.label} onClick={() => setPreviewSample(c.label as 'VIP' | '일반' | '신규')} className={`flex-1 min-w-[44px] text-[10px] px-1.5 py-1 rounded ${previewSample === c.label ? 'bg-violet-500/30 border border-violet-400/40 text-white' : 'bg-slate-900/60 border border-white/10 text-white/50'}`}>{c.label}</button>
                ))}
              </div>
            )}
            <div className="flex-1 overflow-hidden bg-white">
              <iframe title="이메일 미리보기" srcDoc={previewHtml} className="w-full h-full border-0" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 좌측 블록 행 — @dnd-kit 드래그 핸들 + 위/아래(모바일 대비) + 복제 + 삭제
function SortableBlockRow({
  section, selected, isFirst, isLast, onSelect, onUp, onDown, onDuplicate, onDelete,
}: {
  section: Section;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onUp: () => void;
  onDown: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group flex items-center gap-1 rounded-lg px-1.5 py-1.5 cursor-pointer border ${selected ? 'bg-violet-500/20 border-violet-400/50' : 'border-transparent hover:bg-white/5'}`}
    >
      <span
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        title="드래그하여 순서 변경"
        aria-label="드래그 핸들"
        className="shrink-0 text-white/30 hover:text-white/70 cursor-grab active:cursor-grabbing touch-none px-0.5"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </span>
      <span className="text-sm shrink-0">{SECTION_META[section.type]?.icon || '▫️'}</span>
      <span className="flex-1 text-xs text-white/80 truncate">{SECTION_META[section.type]?.label || section.type}</span>
      <button onClick={(e) => { e.stopPropagation(); onUp(); }} disabled={isFirst} className="text-white/30 hover:text-white disabled:opacity-20 p-0.5" aria-label="위로"><ArrowUp className="w-3 h-3" /></button>
      <button onClick={(e) => { e.stopPropagation(); onDown(); }} disabled={isLast} className="text-white/30 hover:text-white disabled:opacity-20 p-0.5" aria-label="아래로"><ArrowDown className="w-3 h-3" /></button>
      <button onClick={(e) => { e.stopPropagation(); onDuplicate(); }} className="text-white/30 hover:text-violet-300 p-0.5" aria-label="복제"><Copy className="w-3 h-3" /></button>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-white/30 hover:text-rose-400 p-0.5" aria-label="삭제"><Trash2 className="w-3 h-3" /></button>
    </div>
  );
}
