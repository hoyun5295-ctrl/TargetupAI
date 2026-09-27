// components/email/EmailRecipientsModal.tsx
// ★ 2026-09-27 만들기 개편 — EmailCampaignsPage 의 발송 대상 창(RecipientsModal)을 원본 그대로 옮겼다.
//   결과 화면·보내기 창·이메일 첫 화면이 같은 창을 쓴다(고객DB·직접 입력·AI 정밀 타겟 · 즉시/예약 · 발송 전 AI 진단).
import { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Check, Clock, Loader2, PenLine, Send, Sparkles, Users, X } from 'lucide-react';
import { DateTimeField, isoToLocalInput, localInputToIso } from '../DateTimeField';
import TargetExtractModal, { type ExtractedTarget } from '../TargetExtractModal';
import type { EmailCampaign } from './email-campaign-types';

// ════════════════════════════════════════════════════════════════════
// 수신자 입력 모달 (발송 직전)
// ════════════════════════════════════════════════════════════════════

export interface RecipientsModalProps {
  campaign: EmailCampaign;
  authHeaders: () => Record<string, string>;
  onProceed: (payload: any, total: number) => void;
  onClose: () => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

interface PrecheckResult {
  codeChecks: Array<{ key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }>;
  spamRisk: { riskLevel: 'low' | 'medium' | 'high'; reasons: string[]; suggestions: string[] };
}

export default function EmailRecipientsModal({ campaign, authHeaders, onProceed, onClose, onToast }: RecipientsModalProps) {
  const [tab, setTab] = useState<'customers' | 'direct' | 'ai'>('customers');
  const [mode, setMode] = useState<'immediate' | 'scheduled'>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');
  // AI 정밀 타겟 — 타겟 추출로 확정한 filter를 발송 대상으로 held
  const [extractOpen, setExtractOpen] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedTarget | null>(null);

  // 고객DB 탭
  const [grades, setGrades] = useState<Array<{ grade: string; count: number }>>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ total: number; gradeBreakdown: Array<{ grade: string; count: number }> } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 직접 입력 탭
  const [recipientsText, setRecipientsText] = useState('');
  const directCount = recipientsText.split(/[,\n;]+/).filter((e) => e.trim().includes('@')).length;

  // 발송 전 AI 진단
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null);
  const [prechecking, setPrechecking] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/email/recipients/grades', { headers: authHeaders() });
        const data = await res.json();
        if (data.success) setGrades(data.grades || []);
      } catch { /* 등급 조회 실패 = 전체 발송만 */ }
    })();
  }, []);

  // 고객DB 미리보기 (등급 선택 변경 시)
  useEffect(() => {
    if (tab !== 'customers') return;
    let alive = true;
    setPreviewLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/email/recipients/preview', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ grades: selectedGrades.length > 0 ? selectedGrades : undefined }),
        });
        const data = await res.json();
        if (alive && data.success) setPreview({ total: data.total, gradeBreakdown: data.gradeBreakdown || [] });
      } catch { /* 미리보기 실패 — 발송 시 재검증 */ }
      finally { if (alive) setPreviewLoading(false); }
    })();
    return () => { alive = false; };
  }, [tab, selectedGrades]);

  const total = tab === 'customers' ? (preview?.total || 0) : tab === 'ai' ? (extracted?.channelEligibleCount || 0) : directCount;

  const handlePrecheck = async () => {
    setPrechecking(true);
    try {
      const res = await fetch('/api/email/ai/precheck', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ campaign_id: campaign.id }),
      });
      const data = await res.json();
      if (data?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (data.success) { setPrecheck({ codeChecks: data.codeChecks, spamRisk: data.spamRisk }); onToast('발송 전 진단 완료 (1 크레딧)', 'success'); }
      else onToast(data.error || '진단 실패', 'error');
    } catch (e: any) {
      onToast(e?.message || '진단 중 오류', 'error');
    } finally {
      setPrechecking(false);
    }
  };

  const toggleGrade = (g: string) => {
    setSelectedGrades((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  };

  const handleProceed = () => {
    if (total === 0) { onToast('발송 대상이 0건입니다.', 'warning'); return; }
    if (mode === 'scheduled') {
      if (!scheduledAt) { onToast('예약 시각을 선택해주세요.', 'warning'); return; }
      if (new Date(scheduledAt).getTime() < Date.now() + 60 * 1000) { onToast('예약 시각은 현재보다 1분 이상 이후여야 합니다.', 'warning'); return; }
    }
    const payload: any = { mode };
    if (mode === 'scheduled') payload.scheduled_at = new Date(scheduledAt).toISOString();
    if (tab === 'customers') {
      payload.target = { type: 'customers', grades: selectedGrades.length > 0 ? selectedGrades : undefined };
    } else if (tab === 'ai') {
      if (!extracted) { onToast('먼저 타겟을 추출해주세요.', 'warning'); return; }
      payload.target = { type: 'filter', filter: extracted.filter };
    } else {
      payload.recipients = recipientsText.split(/[,\n;]+/).map((e) => ({ email: e.trim() })).filter((r) => r.email.includes('@'));
    }
    onProceed(payload, total);
  };

  const riskColor = { low: 'text-emerald-300', medium: 'text-amber-300', high: 'text-rose-300' };
  const riskLabel = { low: '낮음', medium: '주의', high: '높음' };
  const statusIcon = (s: string) => s === 'pass' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : s === 'warn' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> : <AlertCircle className="w-3.5 h-3.5 text-rose-400" />;

  return (
    <>
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-violet-900/40 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-violet-900/40 border-b border-white/10 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-300" /> 발송 대상 선택
          </h3>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="text-xs text-white/60">
            캠페인: <strong className="text-white">{campaign.name}</strong>
            {campaign.isAd && <span className="ml-2 text-amber-300">(광고성, "(광고)" + 수신거부 자동 부착)</span>}
          </div>

          {/* 탭 */}
          <div className="flex gap-1 bg-violet-950/40 rounded-lg p-1">
            <button onClick={() => setTab('customers')} className={`flex-1 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${tab === 'customers' ? 'bg-blue-500/40 text-white' : 'text-white/50 hover:text-white'}`}>
              <Users className="w-3.5 h-3.5" /> 고객DB에서 선택
            </button>
            <button onClick={() => setTab('direct')} className={`flex-1 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${tab === 'direct' ? 'bg-blue-500/40 text-white' : 'text-white/50 hover:text-white'}`}>
              <PenLine className="w-3.5 h-3.5" /> 직접 입력
            </button>
            <button onClick={() => setTab('ai')} className={`flex-1 py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${tab === 'ai' ? 'bg-blue-500/40 text-white' : 'text-white/50 hover:text-white'}`}>
              <Sparkles className="w-3.5 h-3.5" /> AI 정밀 타겟
            </button>
          </div>

          {tab === 'customers' ? (
            <div className="space-y-3">
              <div className="text-[11px] text-white/50">등급을 고르면 해당 등급만, 비우면 전체 고객에게 발송합니다. 이메일 없음·수신거부·무효 고객은 자동 제외됩니다.</div>
              {grades.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {grades.map((g) => (
                    <button
                      key={g.grade}
                      onClick={() => toggleGrade(g.grade)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${selectedGrades.includes(g.grade) ? 'bg-blue-500/30 border-blue-400/50 text-white' : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10'}`}
                    >
                      {g.grade} <span className="text-white/40">({g.count.toLocaleString()})</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="bg-cyan-500/10 border border-cyan-400/25 rounded-lg p-3 flex items-center justify-between">
                <span className="text-xs text-white/70">발송 대상 (수신 가능)</span>
                <span className="text-lg font-bold text-cyan-300">
                  {previewLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : `${total.toLocaleString()}명`}
                </span>
              </div>
            </div>
          ) : tab === 'ai' ? (
            <div className="space-y-3">
              <div className="text-[11px] text-white/50">자연어로 조건을 입력하면 이메일 보낼 대상을 정확히 추출합니다. 조건에 맞고 이메일 수신 가능한 고객만 발송됩니다.</div>
              {extracted ? (
                <div className="bg-emerald-500/10 border border-emerald-400/25 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/70">추출된 타겟 (이메일 발송 가능)</span>
                    <span className="text-lg font-bold text-emerald-300">{extracted.channelEligibleCount.toLocaleString()}명</span>
                  </div>
                  {extracted.explanation && <p className="text-[11px] text-white/50">{extracted.explanation}</p>}
                  <button onClick={() => setExtractOpen(true)} className="text-[11px] text-fuchsia-300 hover:text-fuchsia-200">조건 다시 추출</button>
                </div>
              ) : (
                <button onClick={() => setExtractOpen(true)} className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" /> AI 타겟 추출
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                placeholder="수신 이메일 (콤마/세미콜론/줄바꿈 구분)&#10;예: user1@example.com, user2@example.com"
                className="w-full px-3 py-2 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 resize-y h-28 focus:outline-none focus:border-blue-400/50"
              />
              <div className="text-xs text-cyan-300">유효 이메일: <strong>{directCount.toLocaleString()}건</strong></div>
            </div>
          )}

          {/* 즉시 / 예약 */}
          <div className="flex gap-2">
            <button onClick={() => setMode('immediate')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${mode === 'immediate' ? 'bg-blue-500/30 border-blue-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}>즉시 발송</button>
            <button onClick={() => setMode('scheduled')} className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 ${mode === 'scheduled' ? 'bg-blue-500/30 border-blue-400/50 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}><Clock className="w-3.5 h-3.5" /> 예약 발송</button>
          </div>
          {mode === 'scheduled' && (
            <DateTimeField
              value={localInputToIso(scheduledAt)}
              onChange={(iso) => setScheduledAt(isoToLocalInput(iso))}
              tone="dark"
            />
          )}

          {/* 발송 전 AI 진단 */}
          <div className="border-t border-white/10 pt-3">
            <button
              onClick={handlePrecheck}
              disabled={prechecking}
              className="text-xs text-fuchsia-300 hover:text-fuchsia-200 flex items-center gap-1.5 disabled:opacity-50"
            >
              {prechecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              발송 전 AI 진단 (스팸 위험 · 광고 표기 · 모바일 잘림 · 1 크레딧)
            </button>
            {precheck && (
              <div className="mt-3 space-y-2 bg-violet-950/40 rounded-lg p-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-white/60">스팸 위험</span>
                  <span className={`font-bold ${riskColor[precheck.spamRisk.riskLevel]}`}>{riskLabel[precheck.spamRisk.riskLevel]}</span>
                </div>
                {precheck.spamRisk.reasons.length > 0 && (
                  <ul className="text-[11px] text-white/60 list-disc list-inside space-y-0.5">
                    {precheck.spamRisk.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                )}
                {precheck.spamRisk.suggestions.length > 0 && (
                  <div className="text-[11px] text-emerald-300/80">
                    제안: {precheck.spamRisk.suggestions.join(' · ')}
                  </div>
                )}
                <div className="border-t border-white/10 pt-2 space-y-1">
                  {precheck.codeChecks.map((c) => (
                    <div key={c.key} className="flex items-start gap-1.5 text-[11px]">
                      {statusIcon(c.status)}
                      <span className="text-white/70">{c.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 bg-violet-900/40 border-t border-white/10 px-6 py-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/70 hover:bg-white/5 rounded-lg">취소</button>
          <button
            onClick={handleProceed}
            disabled={total === 0}
            className="px-5 py-2 bg-gradient-to-r from-blue-500 to-sky-500 hover:from-blue-600 hover:to-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            {mode === 'scheduled' ? '예약' : '발송'} ({total.toLocaleString()}명)
          </button>
        </div>
      </div>
    </div>
    <TargetExtractModal
      show={extractOpen}
      channel="email"
      onClose={() => setExtractOpen(false)}
      onApply={(t) => { setExtracted(t); setExtractOpen(false); }}
    />
    </>
  );
}
