/**
 * BrandVoiceCard.tsx — D225+ Brand Voice Learning (2026-05-28 Harold 명시)
 *
 * 본질: 회사별 LMS 대표 문안 5건 등록 + AI 자동 가이드라인 추출 + 정정/삭제 통합 카드.
 *
 * 영구 룰 정합:
 *   - 다크 톤 + violet 액센트 (bg-slate-900 + border-violet-500/30)
 *   - rounded-2xl + shadow-2xl
 *   - 모바일 반응형
 *   - native dialog 0건 (ConfirmModal + useToast 활용)
 *   - 모델명 UI 노출 0건
 *   - 마케팅 담당자 UX — 1 클릭 = AI 자동 흐름
 *   - 박-단어 0건 자가 grep 의무
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles, Plus, Trash2, Save, RefreshCw, RotateCcw, ChevronDown, ChevronUp,
  Image, FileText, Loader2, CheckCircle2, AlertCircle, Smartphone, X, Pencil, Link2,
} from 'lucide-react';
// ★ 2026-07-02 브랜드 링크 — 관리 모드 (문안 편집기 칩과 같은 데이터)
import BrandLinkChips from '../BrandLinkChips';

interface RepresentativeMessage {
  id?: string;
  priority: number;
  channel: 'LMS' | 'MMS';
  subject: string;
  text: string;
  imageUrl: string | null;
}

interface BrandGuideline {
  tone_signature: string;
  avg_length_chars: number;
  avg_length_bytes: number;
  frequent_expressions: string[];
  ad_prefix_position: 'front' | 'back';
  greeting_pattern: string;
  cta_patterns: string[];
  signature: string;
  reject_position: 'front' | 'back';
  emoji_whitelist: string[];
  extracted_at: string;
  admin_edited: boolean;
  // ★ 브랜드 키트 (회사 admin 직접 등록 — 문안 생성 시 조합). 전부 optional.
  signature_locked?: string;
  signature_mode?: 'append' | 'ai_blend';
  slogans?: string[];
  required_words?: string[];
  banned_words?: string[];
  // ★ 2026-07-02 형태 명세 — 재추출 시 자동 갱신. length_range·link_habit = 코드 계산(읽기 전용).
  hook_types?: string[];
  body_structure?: string[];
  sentence_ending_style?: '해요체' | '합쇼체' | '혼합';
  sentence_ending_examples?: string[];
  customer_address?: string;
  symbol_style?: string;
  length_range?: { min_chars: number; max_chars: number };
  link_habit?: { uses_url: boolean; position: 'body_end' | 'mid' | 'none'; avg_urls_per_message: number };
}

interface BrandVoiceResponse {
  success: boolean;
  messages: RepresentativeMessage[];
  guideline: BrandGuideline | null;
  guideline_updated_at: string | null;
  registered: boolean;
  guideline_extracted: boolean;
}

interface BrandVoiceCardProps {
  apiBase: string;
  token: string;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  onConfirm: (opts: { title: string; description: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void }) => void;
}

const TONE_OPTIONS = ['친근/캐주얼', '정중/격조', '활기/감성', '정보/실용', '럭셔리/세련'];

function emptyMessage(priority: number): RepresentativeMessage {
  return { priority, channel: 'LMS', subject: '', text: '', imageUrl: null };
}

export default function BrandVoiceCard({ apiBase, token, onToast, onConfirm }: BrandVoiceCardProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [messages, setMessages] = useState<RepresentativeMessage[]>([emptyMessage(1)]);
  // 대표 문안 편집 = 휴대폰 모달. index null = 신규, 숫자 = 저장본 수정.
  const [editor, setEditor] = useState<{ index: number | null; draft: RepresentativeMessage } | null>(null);
  const [guideline, setGuideline] = useState<BrandGuideline | null>(null);
  const [guidelineUpdatedAt, setGuidelineUpdatedAt] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editingGuideline, setEditingGuideline] = useState(false);
  const [showGuidelineModal, setShowGuidelineModal] = useState(false);

  // ════════════════════════════════════════════════════════════════════
  // 초기 로드
  // ════════════════════════════════════════════════════════════════════
  useEffect(() => {
    loadBrandVoice();
  }, []);

  async function loadBrandVoice() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('조회 실패');
      const data: BrandVoiceResponse = await res.json();
      if (data.success) {
        if (data.messages.length > 0) {
          setMessages(data.messages);
        } else {
          setMessages([emptyMessage(1)]);
        }
        setGuideline(data.guideline);
        setGuidelineUpdatedAt(data.guideline_updated_at);
        setRegistered(data.registered);
        if (data.registered || data.guideline_extracted) {
          setExpanded(true);
        }
      }
    } catch (err: any) {
      onToast(err.message || '회사 brand voice 조회 실패', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 5 대표 문안 등록/정정
  // ════════════════════════════════════════════════════════════════════

  function removeMessage(index: number) {
    if (messages.length <= 1) {
      onToast('최소 1건은 유지해야 합니다.', 'info');
      return;
    }
    const next = messages.filter((_, i) => i !== index).map((m, i) => ({ ...m, priority: i + 1 }));
    setMessages(next);
  }

  // 실제 저장된(본문 있는) 대표 문안만 — 버튼 목록·저장 기준
  const savedList = () => messages.filter((m) => m.text.trim().length > 0);

  function openNewEditor() {
    if (savedList().length >= 10) { onToast('대표 문안은 최대 10건까지 등록 가능합니다.', 'info'); return; }
    setEditor({ index: null, draft: emptyMessage(savedList().length + 1) });
  }
  function openEditEditor(i: number) {
    const list = savedList();
    if (!list[i]) return;
    setEditor({ index: i, draft: { ...list[i] } });
  }
  function updateDraft(patch: Partial<RepresentativeMessage>) {
    setEditor((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));
  }
  async function saveFromEditor() {
    if (!editor) return;
    if (editor.draft.text.trim().length < 10) { onToast('본문을 10자 이상 입력해주세요.', 'error'); return; }
    const list = savedList();
    const next = (editor.index === null ? [...list, editor.draft] : list.map((m, i) => (i === editor.index ? editor.draft : m)))
      .slice(0, 10)
      .map((m, i) => ({ ...m, priority: i + 1 }));
    await saveMessages(next);
    setEditor(null);
  }
  function deleteFromEditor() {
    if (!editor) return;
    if (editor.draft.id) { deleteMessage(editor.draft); setEditor(null); }
    else setEditor(null);
  }

  async function saveMessages(override?: RepresentativeMessage[]) {
    const source = override ?? messages;
    const validMessages = source.filter((m) => m.text.trim().length >= 10);
    if (validMessages.length < 1) {
      onToast('대표 문안 1건 이상 입력해주세요 (본문 10자 이상).', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/save-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: validMessages }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '저장 실패');
      onToast(`대표 문안 ${data.saved_count}건 저장 완료. AI 가이드라인 자동 추출을 시작해주세요.`, 'success');
      setRegistered(true);
      await loadBrandVoice();
    } catch (err: any) {
      onToast(err.message || '저장 실패', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // AI 가이드라인 자동 추출
  // ════════════════════════════════════════════════════════════════════

  async function extractGuideline() {
    if (!registered) {
      onToast('대표 문안을 먼저 저장해주세요.', 'error');
      return;
    }
    setExtracting(true);
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/extract-guideline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '가이드라인 추출 실패');
      setGuideline(data.guideline);
      setGuidelineUpdatedAt(new Date().toISOString());
      onToast('회사 brand voice 가이드라인 추출 완료. 다음 발송부터 AI 문안에 자동 적용됩니다.', 'success');
    } catch (err: any) {
      onToast(err.message || '가이드라인 추출 실패', 'error');
    } finally {
      setExtracting(false);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // 가이드라인 직접 정정
  // ════════════════════════════════════════════════════════════════════

  async function saveGuideline() {
    if (!guideline) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/update-guideline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ guideline }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '정정 실패');
      setGuideline(data.guideline);
      setEditingGuideline(false);
      onToast('가이드라인 정정 완료. 다음 발송부터 적용됩니다.', 'success');
    } catch (err: any) {
      onToast(err.message || '정정 실패', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ★ 2026-07-09 (Harold): 가이드라인 초기화 — 학습된 가이드라인만 삭제(대표 문안 유지) → 재추출 가능. 파괴적이라 확인 모달.
  function resetGuideline() {
    if (!guideline) return;
    onConfirm({
      title: '가이드라인 초기화',
      description: '학습된 Brand Voice 가이드라인을 완전히 초기화합니다.\n대표 문안은 유지되며, 초기화 후 "AI 가이드라인 자동 추출"로 다시 생성할 수 있습니다.',
      confirmLabel: '초기화',
      cancelLabel: '취소',
      onConfirm: async () => {
        setSaving(true);
        try {
          const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/guideline`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || '초기화 실패');
          setGuideline(null);
          setEditingGuideline(false);
          setShowGuidelineModal(false);
          onToast('가이드라인을 초기화했습니다. AI 가이드라인 자동 추출로 다시 생성해 주세요.', 'success');
          await loadBrandVoice();
        } catch (err: any) {
          onToast(err.message || '초기화 실패', 'error');
        } finally {
          setSaving(false);
        }
      },
    });
  }

  function deleteMessage(message: RepresentativeMessage) {
    if (!message.id) {
      // 미저장 영역 — 단순 로컬 삭제
      removeMessage(messages.indexOf(message));
      return;
    }
    onConfirm({
      title: '대표 문안 삭제',
      description: `${message.priority}번 ${message.channel} 문안을 영구 삭제하시겠습니까?`,
      confirmLabel: '삭제',
      cancelLabel: '취소',
      onConfirm: async () => {
        try {
          const res = await fetch(`${apiBase}/api/ai-memory/brand-voice/message/${message.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (!data.success) throw new Error(data.error || '삭제 실패');
          onToast('대표 문안 삭제 완료.', 'success');
          await loadBrandVoice();
        } catch (err: any) {
          onToast(err.message || '삭제 실패', 'error');
        }
      },
    });
  }

  // ════════════════════════════════════════════════════════════════════
  // 렌더링
  // ════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="rounded-2xl border border-violet-500/30 bg-slate-900/60 backdrop-blur-md p-6 shadow-2xl">
        <div className="flex items-center gap-3 text-violet-200">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>회사 Brand Voice 로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-slate-900/80 via-violet-950/40 to-slate-900/80 backdrop-blur-md shadow-2xl overflow-hidden">
      {/* 헤더 */}
      <div className="px-6 py-5 border-b border-violet-500/20 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white">회사 Brand Voice 가이드라인</h3>
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-violet-500/20 text-violet-200 border border-violet-500/40 font-semibold">NEW</span>
            </div>
            <p className="text-xs text-violet-200/70 mt-0.5">
              {guideline
                ? `${messages.length}건 학습 완료. AI 문안이 회사 톤으로 자동 적용 중`
                : registered
                  ? `${messages.length}건 저장 완료. 가이드라인 추출을 눌러야 회사 톤이 적용됩니다`
                  : 'LMS/MMS 대표 문안 1~10건 등록 시 = 다음 발송부터 회사 아이덴티티 적용'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-3 py-1.5 text-xs text-violet-200 hover:text-white rounded-lg border border-violet-500/40 hover:bg-violet-500/20 flex items-center gap-1 transition-colors"
        >
          {expanded ? <><ChevronUp className="w-3 h-3" />접기</> : <><ChevronDown className="w-3 h-3" />열기</>}
        </button>
      </div>

      {/* 미적용 안내 (접힌 상태 + 가이드라인 없음 = 브랜드보이스 미적용) */}
      {!expanded && !guideline && (
        <div className="px-6 py-4 bg-amber-500/10 border-t border-amber-400/20">
          <div className="flex items-start gap-3 text-sm">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-violet-100">
              <strong className="text-amber-200">브랜드보이스 미적용</strong>. AI 문안이 일반 한국어 톤으로 생성됩니다.
              <br />
              <span className="text-violet-200/70">{registered ? '가이드라인 추출을 누르면' : '대표 문안을 등록하고 가이드라인을 추출하면'} 다음 발송부터 회사 톤으로 자동 작성됩니다.</span>
            </div>
          </div>
        </div>
      )}

      {/* 본문 (펼친 상태) */}
      {expanded && (
        <div className="p-6 space-y-6">
          {/* 대표 문안 — 버튼화 + 휴대폰 모달 (인라인 나열 X) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-violet-300" />
                LMS/MMS 대표 문안 ({savedList().length}/10)
              </h4>
              <button
                onClick={openNewEditor}
                disabled={savedList().length >= 10}
                className="px-2.5 py-1 text-xs text-violet-200 hover:text-white rounded border border-violet-500/40 hover:bg-violet-500/20 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-3 h-3" />
                신규 등록
              </button>
            </div>

            {savedList().length === 0 ? (
              <button
                onClick={openNewEditor}
                className="w-full rounded-xl bg-slate-950/40 border border-dashed border-white/10 hover:border-violet-400/40 hover:bg-violet-500/5 p-5 text-center text-xs text-white/40 transition-colors"
              >
                아직 등록된 대표 문안이 없습니다. <span className="text-violet-300">신규 등록</span>을 눌러 회사 실제 발송 문안을 넣어주세요.
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                {savedList().map((m, i) => (
                  <button
                    key={m.id || i}
                    onClick={() => openEditEditor(i)}
                    className="group text-left rounded-xl bg-slate-950/60 border border-white/10 hover:border-violet-400/40 hover:bg-violet-500/10 px-3 py-2 w-[calc(50%-0.25rem)] md:w-[220px] transition-colors"
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-mono text-violet-300">#{m.priority}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-200 border border-violet-400/20">{m.channel}</span>
                      {m.imageUrl && <Image className="w-3 h-3 text-violet-300" />}
                    </div>
                    <div className="text-xs text-white/80 leading-snug line-clamp-2">{m.text || '(본문 없음)'}</div>
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <button
                onClick={extractGuideline}
                disabled={extracting || !registered}
                className="px-4 py-2 text-xs bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:from-fuchsia-500 hover:to-violet-500 text-white rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold shadow-lg"
              >
                {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                AI 가이드라인 자동 추출
              </button>

              {guideline && (
                <button
                  onClick={extractGuideline}
                  disabled={extracting}
                  className="px-3 py-2 text-xs text-violet-200 hover:text-white rounded-lg border border-violet-500/40 hover:bg-violet-500/20 flex items-center gap-1 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  재추출
                </button>
              )}
            </div>
          </div>

          {/* 가이드라인 — 요약 카드 + 전체 보기·정정 모달 (길게 나열 대신 모달) */}
          {guideline && (
            <div className="rounded-xl bg-gradient-to-br from-violet-950/60 to-fuchsia-950/40 border border-violet-500/30 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <h4 className="text-sm font-semibold text-white">Brand Voice 가이드라인</h4>
                  {guideline.admin_edited && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">직접 정정됨</span>
                  )}
                </div>
                <button
                  onClick={() => { setEditingGuideline(false); setShowGuidelineModal(true); }}
                  className="text-xs text-violet-100 bg-violet-500/20 hover:bg-violet-500/30 border border-violet-400/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Pencil className="w-3 h-3" /> 전체 보기·정정
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                <SummaryChip label="톤" value={guideline.tone_signature || '—'} />
                <SummaryChip label="평균 길이" value={`${guideline.avg_length_chars}자`} />
                <SummaryChip label="빈출 표현" value={`${(guideline.frequent_expressions || []).length}건`} />
                <SummaryChip label="CTA 패턴" value={`${(guideline.cta_patterns || []).length}건`} />
              </div>

              {showGuidelineModal && createPortal(
                <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 md:p-4">
                  <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
                      <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        Brand Voice 가이드라인
                        {guideline.admin_edited && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">직접 정정됨</span>
                        )}
                      </h4>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingGuideline(!editingGuideline)}
                          className="text-xs text-violet-200 hover:text-white transition-colors"
                        >
                          {editingGuideline ? '정정 취소' : '직접 정정'}
                        </button>
                        <button onClick={() => setShowGuidelineModal(false)} className="text-white/50 hover:text-white p-1 rounded hover:bg-white/10" aria-label="닫기"><X className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-5">

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <GuidelineField label="톤 시그니처" value={guideline.tone_signature} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, tone_signature: v })}
                  select={TONE_OPTIONS} />
                <GuidelineField label="평균 길이" value={`${guideline.avg_length_chars}자 / ${guideline.avg_length_bytes}바이트`} editing={false} />
                <GuidelineField label="(광고) 위치" value={guideline.ad_prefix_position === 'front' ? '본문 앞' : '본문 뒤'} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, ad_prefix_position: v === '본문 앞' ? 'front' : 'back' })}
                  select={['본문 앞', '본문 뒤']} />
                <GuidelineField label="무료수신거부 위치" value={guideline.reject_position === 'front' ? '본문 앞' : '본문 뒤'} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, reject_position: v === '본문 앞' ? 'front' : 'back' })}
                  select={['본문 앞', '본문 뒤']} />
                <GuidelineField label="인사말 패턴" value={guideline.greeting_pattern} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, greeting_pattern: v })} fullWidth />
                <GuidelineField label="시그니처" value={guideline.signature} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, signature: v })} fullWidth />
                <GuidelineArrayField label="빈출 표현" values={guideline.frequent_expressions} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, frequent_expressions: v })} fullWidth />
                <GuidelineArrayField label="CTA 패턴" values={guideline.cta_patterns} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, cta_patterns: v })} fullWidth />
                <GuidelineArrayField label="이모지 화이트리스트" values={guideline.emoji_whitelist} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, emoji_whitelist: v })} fullWidth />
                {/* ★ 2026-07-02 형태 명세 — 후크/구조/종결어미/호칭/기호 + 코드 계산(길이 범위·링크 습관, 읽기 전용) */}
                <GuidelineArrayField label="후크 유형 (첫 줄)" values={guideline.hook_types || []} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, hook_types: v })} fullWidth />
                <GuidelineArrayField label="본문 구조 순서" values={guideline.body_structure || []} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, body_structure: v })} fullWidth />
                <GuidelineField label="종결어미 스타일" value={guideline.sentence_ending_style || ''} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, sentence_ending_style: (v === '해요체' || v === '합쇼체' || v === '혼합') ? v : undefined })}
                  select={['해요체', '합쇼체', '혼합']} />
                <GuidelineArrayField label="대표 종결어미" values={guideline.sentence_ending_examples || []} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, sentence_ending_examples: v })} />
                <GuidelineField label="고객 호칭" value={guideline.customer_address || ''} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, customer_address: v })} />
                <GuidelineField label="기호·구분선 스타일" value={guideline.symbol_style || ''} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, symbol_style: v })} />
                <GuidelineField label="본문 길이 범위 (자동 계산)" editing={false}
                  value={guideline.length_range ? `${guideline.length_range.min_chars}~${guideline.length_range.max_chars}자` : ''} />
                <GuidelineField label="링크 습관 (자동 계산)" editing={false}
                  value={guideline.link_habit?.uses_url
                    ? `있음: ${guideline.link_habit.position === 'body_end' ? '본문 끝' : '본문 중간'} · 문안당 ${guideline.link_habit.avg_urls_per_message}개`
                    : guideline.link_habit ? '없음' : ''} />
                {/* ★ 브랜드 키트 — 문안 생성 시 조합되는 회사 고정 자산 */}
                <GuidelineField label="고정 시그니처 (문안 끝에 조합)" value={guideline.signature_locked || ''} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, signature_locked: v })} fullWidth />
                <GuidelineField label="시그니처 방식" value={guideline.signature_mode === 'ai_blend' ? '톤에 녹임' : '끝에 부착'} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, signature_mode: v === '톤에 녹임' ? 'ai_blend' : 'append' })}
                  select={['끝에 부착', '톤에 녹임']} />
                <GuidelineArrayField label="슬로건 (문맥 맞을 때 활용)" values={guideline.slogans || []} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, slogans: v })} fullWidth />
                <GuidelineArrayField label="필수 표현 (가능하면 포함)" values={guideline.required_words || []} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, required_words: v })} fullWidth />
                <GuidelineArrayField label="금지 단어 (절대 사용 안 함)" values={guideline.banned_words || []} editing={editingGuideline}
                  onChange={(v) => setGuideline({ ...guideline, banned_words: v })} fullWidth />
              </div>

              {guidelineUpdatedAt && (
                <div className="mt-3 text-[10px] text-white/40 italic">
                  Data source: 회사 대표 문안 {messages.length}건 + AI 자동 추출 · 마지막 갱신: {new Date(guidelineUpdatedAt).toLocaleString('ko-KR')}
                </div>
              )}
                    </div>
                    {/* ★ 2026-07-09 (Harold): 초기화 + 저장 footer. 초기화=가이드라인 삭제(대표 문안 유지→재추출 가능). 저장='직접 정정' 편집분 반영. */}
                    <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/10">
                      <button
                        onClick={resetGuideline}
                        disabled={saving}
                        className="px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 border border-rose-400/30 rounded-lg flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> 초기화
                      </button>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowGuidelineModal(false)} className="px-4 py-2 text-xs text-white/70 border border-white/15 rounded-lg hover:bg-white/10 transition-colors">닫기</button>
                        <button
                          onClick={saveGuideline}
                          disabled={saving || !editingGuideline}
                          title={editingGuideline ? '' : "'직접 정정'을 켜면 편집 후 저장할 수 있습니다"}
                          className="px-5 py-2 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg flex items-center gap-1.5 font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 저장
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              , document.body)}
            </div>
          )}

          {/* ★ 2026-07-02 브랜드 링크 — 회사 URL 라이브러리 관리 (문안 편집기 칩 + AI 자동 배치와 같은 데이터) */}
          <div>
            <h4 className="text-sm font-semibold text-white flex items-center gap-2 mb-2">
              <Link2 className="w-4 h-4 text-violet-300" />
              브랜드 링크
            </h4>
            <p className="text-[11px] text-violet-200/60 mb-2">
              공식몰·이벤트관 등 회사 URL을 등록하면 문안 편집기에서 칩 클릭 한 번으로 삽입되고, AI가 문안을 만들 때도 등록된 링크만 자동 배치됩니다.
            </p>
            <BrandLinkChips tone="dark" onToast={onToast} />
          </div>
        </div>
      )}
    </div>

    {editor && (
      <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-3 md:p-4">
        <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-violet-300" />
              {editor.index === null ? '신규 대표 문안' : `대표 문안 #${editor.draft.priority} 수정`}
            </h4>
            <button onClick={() => setEditor(null)} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기"><X className="w-5 h-5" /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 md:p-6 flex flex-col md:flex-row gap-6 items-start">
            {/* 입력 */}
            <div className="flex-1 w-full space-y-3">
              <div>
                <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wide">채널</label>
                <select
                  value={editor.draft.channel}
                  onChange={(e) => updateDraft({ channel: e.target.value as 'LMS' | 'MMS' })}
                  className="w-full px-3 py-1.5 text-xs bg-slate-950 border border-white/10 rounded-lg text-white focus:border-violet-500 focus:outline-none"
                >
                  <option value="LMS">LMS</option>
                  <option value="MMS">MMS (이미지 첨부)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wide">제목 (옵션)</label>
                <input
                  type="text"
                  value={editor.draft.subject}
                  onChange={(e) => updateDraft({ subject: e.target.value })}
                  placeholder="제목 (LMS/MMS 한정)"
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wide">본문 (10자 이상, 2000자 이내)</label>
                <textarea
                  value={editor.draft.text}
                  onChange={(e) => updateDraft({ text: e.target.value })}
                  placeholder="회사 실제 발송 문안을 그대로 입력해주세요."
                  rows={11}
                  maxLength={2000}
                  className="w-full px-3 py-2 text-xs bg-slate-950 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-violet-500 focus:outline-none resize-none"
                />
                <div className="text-[10px] text-white/40 mt-1 text-right">{editor.draft.text.length}자 / 2000자</div>
              </div>
              {editor.draft.channel === 'MMS' && (
                <div>
                  <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wide">이미지 URL (옵션)</label>
                  <input
                    type="text"
                    value={editor.draft.imageUrl || ''}
                    onChange={(e) => updateDraft({ imageUrl: e.target.value || null })}
                    placeholder="https://..."
                    className="w-full px-3 py-2 text-xs bg-slate-950 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-violet-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* 휴대폰 미리보기 — 크게 + 데스크탑 sticky(입력 스크롤해도 따라옴) */}
            <div className="w-full md:w-[360px] shrink-0 flex justify-center md:sticky md:top-0 md:self-start">
              <div className="w-full max-w-[330px] rounded-[2.75rem] border-4 border-slate-700 bg-slate-950 p-3 shadow-2xl">
                <div className="rounded-[2.25rem] bg-slate-900 overflow-hidden">
                  <div className="px-4 py-2.5 text-center text-xs text-white/40 border-b border-white/5">{editor.draft.channel} 미리보기</div>
                  <div className="p-5 min-h-[460px]">
                    {editor.draft.subject && <div className="text-sm font-semibold text-white/70 mb-2">{editor.draft.subject}</div>}
                    <div className="rounded-2xl rounded-tl-sm bg-violet-600/90 text-white text-[15px] px-4 py-3 whitespace-pre-wrap leading-relaxed">{editor.draft.text || '(본문 없음)'}</div>
                    {editor.draft.imageUrl && <img src={editor.draft.imageUrl} alt="첨부 이미지" className="mt-2.5 rounded-xl max-w-full border border-white/10" />}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/10">
            <div>
              {editor.draft.id && (
                <button onClick={deleteFromEditor} className="px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 rounded-lg flex items-center gap-1.5 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" /> 삭제
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditor(null)} className="px-4 py-2 text-sm text-white/70 border border-white/15 rounded-lg hover:bg-white/10 transition-colors">닫기</button>
              <button onClick={saveFromEditor} disabled={saving} className="px-5 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg flex items-center gap-1.5 font-semibold disabled:opacity-50 transition-colors">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} 저장
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// 헬퍼 컴포넌트
// ════════════════════════════════════════════════════════════════════

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 border border-white/10 px-2.5 py-2 min-w-0">
      <div className="text-[10px] text-white/40">{label}</div>
      <div className="text-xs font-semibold text-white truncate mt-0.5">{value}</div>
    </div>
  );
}

function GuidelineField({
  label, value, editing, onChange, select,
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange?: (v: string) => void;
  select?: string[];
  fullWidth?: boolean;
}) {
  return (
    <div>
      <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wide">{label}</label>
      {editing && onChange ? (
        select ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1 bg-slate-900 border border-white/10 rounded text-white text-xs focus:border-violet-500 focus:outline-none"
          >
            {select.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-2 py-1 bg-slate-900 border border-white/10 rounded text-white text-xs focus:border-violet-500 focus:outline-none"
          />
        )
      ) : (
        <div className="px-2 py-1 bg-slate-950/40 rounded text-white/90 text-xs border border-white/5">{value || '(미설정)'}</div>
      )}
    </div>
  );
}

function GuidelineArrayField({
  label, values, editing, onChange,
}: {
  label: string;
  values: string[];
  editing: boolean;
  onChange: (v: string[]) => void;
  fullWidth?: boolean;
}) {
  const joined = values.join(' / ');
  return (
    <div>
      <label className="block text-[10px] text-white/50 mb-1 uppercase tracking-wide">{label} ({values.length})</label>
      {editing ? (
        <input
          type="text"
          value={joined}
          onChange={(e) => onChange(e.target.value.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean))}
          placeholder="슬래시(/)로 구분, 예: 준비했어요 / 꼭 받아가세요"
          className="w-full px-2 py-1 bg-slate-900 border border-white/10 rounded text-white text-xs placeholder-white/30 focus:border-violet-500 focus:outline-none"
        />
      ) : (
        <div className="px-2 py-1 bg-slate-950/40 rounded text-white/90 text-xs border border-white/5 min-h-[28px]">
          {values.length > 0 ? values.map((v, i) => (
            <span key={i} className="inline-block px-1.5 py-0.5 mr-1 mb-1 bg-violet-500/20 text-violet-200 rounded text-[10px]">{v}</span>
          )) : <span className="text-white/30">(없음)</span>}
        </div>
      )}
    </div>
  );
}
