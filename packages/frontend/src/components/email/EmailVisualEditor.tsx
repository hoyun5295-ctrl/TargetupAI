// components/email/EmailVisualEditor.tsx
// 이메일 비주얼 에디터 — 블록(Section[])을 비주얼로 편집 + 이미지 업로드 + 실시간 미리보기 + AI 생성 + 저장.
// DM 섹션 편집기(SectionPropsEditor)·이미지 업로더(ImageUploader 내장)·헬퍼를 차용(props 기반이라 스토어 불요).
// 렌더는 백엔드 단일 진실원(POST /api/email/render-preview). 다크 + violet 톤.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Eye, Loader2, Plus, Save, Sparkles, Trash2, Wand2, X,
} from 'lucide-react';
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

  const selected = useMemo(() => sections.find((s) => s.id === selectedId) || null, [sections, selectedId]);

  // ── 실시간 미리보기 (debounce 500ms, 백엔드 렌더러 단일 진실원) ──
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await fetch('/api/email/render-preview', {
          method: 'POST', headers: authHeaders(), body: JSON.stringify({ sections }),
        });
        const data = await res.json();
        if (data.success) setPreviewHtml(data.html || '');
      } catch { /* 미리보기 실패는 다음 변경 때 재시도 */ }
      finally { setPreviewLoading(false); }
    }, 500);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  // ── 블록 조작 ──
  const updateSelected = (patch: Record<string, any>) => {
    if (!selectedId) return;
    setSections((prev) => prev.map((s) => (s.id === selectedId ? { ...s, props: { ...(s.props as any), ...patch } } : s)));
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
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {ordered.map((s, i) => (
                <div key={s.id} onClick={() => setSelectedId(s.id)}
                  className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer border ${selectedId === s.id ? 'bg-violet-500/20 border-violet-400/50' : 'border-transparent hover:bg-white/5'}`}>
                  <span className="text-sm">{SECTION_META[s.type]?.icon || '▫️'}</span>
                  <span className="flex-1 text-xs text-white/80 truncate">{SECTION_META[s.type]?.label || s.type}</span>
                  <button onClick={(e) => { e.stopPropagation(); moveBlock(s.id, -1); }} disabled={i === 0} className="text-white/30 hover:text-white disabled:opacity-20 p-0.5"><ArrowUp className="w-3 h-3" /></button>
                  <button onClick={(e) => { e.stopPropagation(); moveBlock(s.id, 1); }} disabled={i === ordered.length - 1} className="text-white/30 hover:text-white disabled:opacity-20 p-0.5"><ArrowDown className="w-3 h-3" /></button>
                  <button onClick={(e) => { e.stopPropagation(); deleteBlock(s.id); }} className="text-white/30 hover:text-rose-400 p-0.5"><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
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
                <div className="text-white">
                  <SectionPropsEditor section={selected} onUpdate={updateSelected} />
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
            <div className="flex-1 overflow-hidden bg-white">
              <iframe title="이메일 미리보기" srcDoc={previewHtml} className="w-full h-full border-0" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
