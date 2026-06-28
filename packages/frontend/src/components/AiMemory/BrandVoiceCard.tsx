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
import {
  Sparkles, Plus, Trash2, Save, RefreshCw, ChevronDown, ChevronUp,
  Image, FileText, Loader2, CheckCircle2, AlertCircle, Smartphone, X, Pencil,
} from 'lucide-react';

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
  const [previewMsg, setPreviewMsg] = useState<RepresentativeMessage | null>(null);
  const [guideline, setGuideline] = useState<BrandGuideline | null>(null);
  const [guidelineUpdatedAt, setGuidelineUpdatedAt] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editingGuideline, setEditingGuideline] = useState(false);

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

  function addMessage() {
    if (messages.length >= 5) {
      onToast('대표 문안은 최대 5건까지 등록 가능합니다.', 'info');
      return;
    }
    setMessages([...messages, emptyMessage(messages.length + 1)]);
  }

  function removeMessage(index: number) {
    if (messages.length <= 1) {
      onToast('최소 1건은 유지해야 합니다.', 'info');
      return;
    }
    const next = messages.filter((_, i) => i !== index).map((m, i) => ({ ...m, priority: i + 1 }));
    setMessages(next);
  }

  function updateMessage(index: number, patch: Partial<RepresentativeMessage>) {
    const next = [...messages];
    next[index] = { ...next[index], ...patch };
    setMessages(next);
  }

  async function saveMessages() {
    const validMessages = messages.filter((m) => m.text.trim().length >= 10);
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
              {registered
                ? guideline
                  ? `${messages.length}건 학습 완료 — AI 문안 = 회사 톤 100% 일치 적용 중`
                  : `${messages.length}건 저장 완료 — 가이드라인 추출 대기`
                : 'LMS/MMS 대표 문안 1~5건 등록 시 = 다음 발송부터 회사 아이덴티티 100% 일치'}
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

      {/* 미등록 안내 (접힌 상태 + 미등록) */}
      {!expanded && !registered && (
        <div className="px-6 py-4 bg-violet-500/10 border-t border-violet-500/20">
          <div className="flex items-start gap-3 text-sm">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-violet-100">
              <strong className="text-amber-200">미등록 상태</strong> — AI 문안 = 일반 한국어 톤 출력 (회사 아이덴티티 X).
              <br />
              <span className="text-violet-200/70">대표 문안 등록 시 = AI 다듬기/자동 생성 시 회사 톤 자동 적용.</span>
            </div>
          </div>
        </div>
      )}

      {/* 본문 (펼친 상태) */}
      {expanded && (
        <div className="p-6 space-y-6">
          {/* 5 대표 문안 입력 영역 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                <FileText className="w-4 h-4 text-violet-300" />
                LMS/MMS 대표 문안 ({messages.length}/5)
              </h4>
              <button
                onClick={addMessage}
                disabled={messages.length >= 5}
                className="px-2 py-1 text-xs text-violet-200 hover:text-white rounded border border-violet-500/40 hover:bg-violet-500/20 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-3 h-3" />
                추가
              </button>
            </div>

            <div className="space-y-3">
              {messages.map((m, i) => (
                <div key={i} className="rounded-xl bg-slate-950/60 border border-white/5 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-violet-300">#{m.priority}</span>
                      <select
                        value={m.channel}
                        onChange={(e) => updateMessage(i, { channel: e.target.value as 'LMS' | 'MMS' })}
                        className="px-2 py-0.5 text-xs bg-slate-900 border border-white/10 rounded text-white focus:border-violet-500 focus:outline-none"
                      >
                        <option value="LMS">LMS</option>
                        <option value="MMS">MMS (이미지 첨부)</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.text.trim().length >= 10 && (
                        <button
                          onClick={() => setPreviewMsg(m)}
                          className="text-violet-300/70 hover:text-violet-300 transition-colors"
                          title="휴대폰 미리보기"
                        >
                          <Smartphone className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteMessage(m)}
                        className="text-rose-400/60 hover:text-rose-400 transition-colors"
                        title="삭제"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <input
                    type="text"
                    value={m.subject}
                    onChange={(e) => updateMessage(i, { subject: e.target.value })}
                    placeholder="제목 (옵션 — LMS/MMS 한정)"
                    className="w-full px-3 py-1.5 text-xs mb-2 bg-slate-900 border border-white/10 rounded text-white placeholder-white/30 focus:border-violet-500 focus:outline-none"
                  />

                  <textarea
                    value={m.text}
                    onChange={(e) => updateMessage(i, { text: e.target.value })}
                    placeholder="본문 입력 (10자 이상, 2000자 이내) — 회사 실제 발송 문안을 그대로 입력해주세요."
                    rows={3}
                    className="w-full px-3 py-2 text-xs bg-slate-900 border border-white/10 rounded text-white placeholder-white/30 focus:border-violet-500 focus:outline-none resize-none"
                  />

                  {m.channel === 'MMS' && (
                    <input
                      type="text"
                      value={m.imageUrl || ''}
                      onChange={(e) => updateMessage(i, { imageUrl: e.target.value || null })}
                      placeholder="이미지 URL (옵션)"
                      className="w-full px-3 py-1.5 text-xs mt-2 bg-slate-900 border border-white/10 rounded text-white placeholder-white/30 focus:border-violet-500 focus:outline-none"
                    />
                  )}

                  <div className="mt-2 flex items-center justify-between text-[10px] text-white/40">
                    <span>{m.text.length}자 / 2000자</span>
                    {m.imageUrl && <span className="flex items-center gap-1 text-violet-300"><Image className="w-3 h-3" />이미지 첨부</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <button
                onClick={saveMessages}
                disabled={saving}
                className="px-4 py-2 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                대표 문안 저장
              </button>

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

          {/* 가이드라인 표시 영역 */}
          {guideline && (
            <div className="rounded-xl bg-gradient-to-br from-violet-950/60 to-fuchsia-950/40 border border-violet-500/30 p-5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Brand Voice 가이드라인 (9 항목)
                  {guideline.admin_edited && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/20 text-emerald-200 border border-emerald-500/40">직접 정정됨</span>
                  )}
                </h4>
                <button
                  onClick={() => setEditingGuideline(!editingGuideline)}
                  className="text-xs text-violet-200 hover:text-white transition-colors"
                >
                  {editingGuideline ? '정정 취소' : '직접 정정'}
                </button>
              </div>

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

              {editingGuideline && (
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={saveGuideline}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded flex items-center gap-1 disabled:opacity-50 transition-colors font-semibold"
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    정정 저장
                  </button>
                </div>
              )}

              {guidelineUpdatedAt && (
                <div className="mt-3 text-[10px] text-white/40 italic">
                  Data source — 회사 대표 문안 {messages.length}건 + AI 자동 추출 · 마지막 갱신: {new Date(guidelineUpdatedAt).toLocaleString('ko-KR')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>

    {previewMsg && (
      <div
        className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={() => setPreviewMsg(null)}
      >
        <div className="relative w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
          <div className="rounded-[2.5rem] border-4 border-slate-700 bg-slate-950 p-3 shadow-2xl">
            <div className="rounded-[2rem] bg-slate-900 overflow-hidden">
              <div className="px-4 py-2 text-center text-[11px] text-white/40 border-b border-white/5">
                {previewMsg.channel} 미리보기
              </div>
              <div className="p-4 min-h-[280px]">
                {previewMsg.subject && (
                  <div className="text-xs font-semibold text-white/70 mb-1.5">{previewMsg.subject}</div>
                )}
                <div className="rounded-2xl rounded-tl-sm bg-violet-600/90 text-white text-sm px-4 py-3 whitespace-pre-wrap leading-relaxed max-w-[88%]">
                  {previewMsg.text || '(본문 없음)'}
                </div>
                {previewMsg.imageUrl && (
                  <img src={previewMsg.imageUrl} alt="첨부 이미지" className="mt-2 rounded-xl max-w-[88%] border border-white/10" />
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4 justify-center">
            <button
              onClick={() => setPreviewMsg(null)}
              className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg flex items-center gap-1.5 font-semibold transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" />
              수정하기
            </button>
            <button
              onClick={() => setPreviewMsg(null)}
              className="px-4 py-2 text-sm text-white/70 border border-white/15 rounded-lg hover:bg-white/10 flex items-center gap-1.5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              닫기
            </button>
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
          placeholder="슬래시(/)로 구분 — 예: 준비했어요 / 꼭 받아가세요"
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
