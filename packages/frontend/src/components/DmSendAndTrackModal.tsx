/**
 * DmSendAndTrackModal — 모바일DM 타겟 발송 + 발송 추적 (sub-project A · P4)
 *
 *   타겟 추출(channel=dm) → 문안 작성(AI 생성 / 직접) → 핸드폰 편집기(꾸미기·다듬기·스팸테스트·예약시각)
 *   → 수신자별 개인화 링크(?r=token) 문자 발송. 발송 후 '발송 추적'에서 열람/완독 확인.
 *   발송은 검증된 /dm/:id/send-to-target(직접발송 파이프라인 재사용 — 안전망 보존).
 *   DM 링크는 %DM링크% 위치에 자동 삽입(수신자별). 없으면 문안 끝에 첨부.
 */

import { useState } from 'react';
import { Sparkles, Send, RefreshCw, Check, X, Wand2, ShieldCheck, Clock, Smartphone } from 'lucide-react';
import { useToast } from './ToastProvider';
import TargetExtractModal, { type ExtractedTarget } from './TargetExtractModal';
import AiRefineModal from './AiRefineModal';
import SpamFilterTestModal from './SpamFilterTestModal';

interface TrackRecipient {
  customerId: string;
  name: string | null;
  phone: string | null;
  viewed: boolean;
  pageReached: number;
  totalPages: number;
  completed: boolean;
}

interface Props {
  dmId: string;
  dmTitle?: string;
  show: boolean;
  onClose: () => void;
}

// 편집기 변수 칩 (본문 삽입). %DM링크% = 수신자별 개인화 링크(발송 시 자동 치환).
const VAR_CHIPS = ['%DM링크%', '%고객명%', '%등급%', '%지역%'];
const SAMPLE_VALUES: Record<string, string> = {
  '%고객명%': '김민수', '%등급%': 'VIP', '%지역%': '서울',
  '%DM링크%': 'https://hanjul.ai/dm(개인화)',
};

export default function DmSendAndTrackModal({ dmId, dmTitle, show, onClose }: Props) {
  const toast = useToast();
  const [view, setView] = useState<'compose' | 'track'>('compose');
  const [extractOpen, setExtractOpen] = useState(false);
  const [target, setTarget] = useState<ExtractedTarget | null>(null);

  // 문안 — 2모드
  const [mode, setMode] = useState<'ai' | 'direct'>('ai');
  const [prompt, setPrompt] = useState('');
  const [messageText, setMessageText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [decorating, setDecorating] = useState(false);

  const [isAd, setIsAd] = useState(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [spamOpen, setSpamOpen] = useState(false);
  const [spamCallback, setSpamCallback] = useState('');

  // 예약 시각
  const [scheduleMode, setScheduleMode] = useState<'immediate' | 'manual' | 'ai'>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');

  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);

  const [tracking, setTracking] = useState<{ summary: { sent: number; viewed: number; completed: number }; recipients: TrackRecipient[] } | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);

  if (!show) return null;
  const token = () => localStorage.getItem('token');

  const insertVar = (v: string) => setMessageText((prev) => (prev ? `${prev} ${v}` : v));

  const previewText = (() => {
    let out = messageText || '';
    for (const [k, val] of Object.entries(SAMPLE_VALUES)) out = out.split(k).join(val);
    if (!messageText.includes('%DM링크%') && messageText.trim()) out = `${out}\n${SAMPLE_VALUES['%DM링크%']}`;
    return out;
  })();

  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.warning('생성할 문안의 프롬프트를 입력해주세요.'); return; }
    setGenerating(true);
    try {
      const res = await fetch(`/api/dm/${dmId}/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { toast.error(data?.error || '문안 생성에 실패했습니다.'); return; }
      const text = String(data.message || '').trim();
      if (!text) { toast.error('생성된 문안이 비어 있습니다. 다시 시도해주세요.'); return; }
      setMessageText(text);
      toast.success('문안을 생성했습니다. (3크레딧) 핸드폰 미리보기에서 확인하세요.');
    } catch (e: any) {
      toast.error(e?.message || '문안 생성 중 오류가 발생했습니다.');
    } finally {
      setGenerating(false);
    }
  };

  const handleDecorate = async () => {
    if (!messageText.trim()) { toast.warning('먼저 문안을 작성해주세요.'); return; }
    setDecorating(true);
    try {
      const res = await fetch('/api/ai/operator/decorate-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ message: messageText, selectedVars: ['고객명', '등급', '지역'], channel: 'lms', isAd }),
      });
      const data = await res.json();
      if (data.success) { setMessageText(String(data.message || messageText)); toast.success('꾸미기를 적용했습니다. (3크레딧)'); }
      else toast.error(data.error || 'AI 꾸미기에 실패했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '꾸미기 중 오류가 발생했습니다.');
    } finally {
      setDecorating(false);
    }
  };

  const openSpamTest = async () => {
    if (!messageText.trim()) { toast.warning('먼저 문안을 작성해주세요.'); return; }
    try {
      const res = await fetch('/api/manage/callbacks', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      const list: any[] = data?.callbacks || data || [];
      const def = list.find((c: any) => c.is_default) || list[0];
      if (!def?.phone) { toast.error('등록된 발신번호가 없습니다. 발신번호 등록 후 이용해주세요.'); return; }
      setSpamCallback(String(def.phone));
      setSpamOpen(true);
    } catch (e: any) {
      toast.error(e?.message || '발신번호 조회 중 오류가 발생했습니다.');
    }
  };

  const applyAiTime = () => {
    // AI 추천 발송 시각 — 다음날 오전 10시(KST 근사, datetime-local 형식)
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setScheduledAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setScheduleMode('ai');
  };

  const handleSend = async () => {
    if (!target || target.channelEligibleCount === 0) { toast.warning('먼저 타겟을 추출해주세요.'); return; }
    if (!messageText.trim()) { toast.warning('문자 본문을 작성해주세요.'); return; }
    const scheduledAtVal = scheduleMode === 'immediate' ? null : scheduledAt;
    if (scheduleMode !== 'immediate' && !scheduledAtVal) { toast.warning('예약 시각을 선택해주세요.'); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/dm/${dmId}/send-to-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ filter: target.filter, messageText: messageText.trim(), isAd, scheduledAt: scheduledAtVal ? new Date(scheduledAtVal).toISOString() : null }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { toast.error(data?.error || '발송에 실패했습니다.'); return; }
      setSentCount(data.sent);
      toast.success(scheduledAtVal ? `${Number(data.sent).toLocaleString()}명 예약 완료.` : `${Number(data.sent).toLocaleString()}명에게 발송했습니다.`);
    } catch (e: any) {
      toast.error(e?.message || '발송 중 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  };

  const loadTracking = async () => {
    setView('track');
    setLoadingTrack(true);
    try {
      const res = await fetch(`/api/dm/${dmId}/recipients-tracking`, { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (res.ok && data.success) setTracking({ summary: data.summary, recipients: data.recipients });
      else toast.error(data?.error || '추적 조회에 실패했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '추적 조회 중 오류가 발생했습니다.');
    } finally {
      setLoadingTrack(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[1120px] max-h-[95vh] overflow-hidden flex flex-col bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-white/10 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center flex-shrink-0"><Send className="w-4 h-4 text-white" /></div>
            <div>
              <h3 className="text-base font-bold text-white">DM 타겟 발송{dmTitle ? ` · ${dmTitle}` : ''}</h3>
              <p className="text-[11px] text-white/50">추출한 타겟에게 수신자별 개인화 링크 문자를 보냅니다</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 pt-3 flex gap-1">
          <button onClick={() => setView('compose')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'compose' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}>발송</button>
          <button onClick={loadTracking} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${view === 'track' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}>발송 추적</button>
        </div>

        {view === 'compose' ? (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* 왼쪽 — 타겟 + 편집 */}
              <div className="space-y-4">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  {target ? (
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-[10px] text-white/40">발송 가능 대상</p>
                        <p className="text-2xl font-bold text-emerald-300">{target.channelEligibleCount.toLocaleString()}<span className="text-sm font-normal text-white/50 ml-1">명</span></p>
                      </div>
                      <button onClick={() => setExtractOpen(true)} className="text-[11px] text-fuchsia-300 hover:text-fuchsia-200">다시 추출</button>
                    </div>
                  ) : (
                    <button onClick={() => setExtractOpen(true)} className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 flex items-center justify-center gap-2"><Sparkles className="w-4 h-4" /> 1. 타겟 추출</button>
                  )}
                </div>

                {/* 문안 2모드 */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                  <div className="flex gap-1">
                    <button onClick={() => setMode('ai')} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === 'ai' ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white' : 'bg-white/5 text-white/50'}`}>AI 문안 생성</button>
                    <button onClick={() => setMode('direct')} className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${mode === 'direct' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/50'}`}>직접 입력</button>
                  </div>

                  {mode === 'ai' && (
                    <div>
                      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder="예: 재구매 유도 · 이번 주 신상 안내" className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/60 resize-none" />
                      <button onClick={handleGenerate} disabled={!prompt.trim() || generating} className="mt-2 w-full py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 disabled:opacity-30 flex items-center justify-center gap-1.5">
                        {generating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}{generating ? '생성 중...' : 'AI 문안 생성 (DM 링크 포함)'}
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-white/60 mb-1 block">문자 본문 {mode === 'ai' ? '(생성 후 편집 가능)' : ''}</label>
                    <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={5} placeholder="문안을 작성하거나 AI로 생성하세요. %DM링크% 위치에 수신자별 개인화 링크가 들어갑니다." className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-400/60 resize-none" />
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {VAR_CHIPS.map((v) => (
                        <button key={v} onClick={() => insertVar(v)} className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${v === '%DM링크%' ? 'border-fuchsia-400/40 text-fuchsia-200 bg-fuchsia-500/10' : 'border-white/10 text-white/60 bg-white/5 hover:bg-white/10'}`}>{v}</button>
                      ))}
                    </div>
                  </div>

                  {/* 툴바 */}
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={handleDecorate} disabled={decorating} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40"><Wand2 className="w-3.5 h-3.5" />{decorating ? '꾸미는 중...' : '꾸미기'}</button>
                    <button onClick={() => { if (!messageText.trim()) { toast.warning('먼저 문안을 작성해주세요.'); return; } setRefineOpen(true); }} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10"><Sparkles className="w-3.5 h-3.5" />다듬기</button>
                    <button onClick={openSpamTest} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10"><ShieldCheck className="w-3.5 h-3.5" />스팸테스트</button>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-white/60 cursor-pointer">
                    <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="rounded" /> 광고성 메시지 (수신거부 080·(광고) 자동 표기)
                  </label>
                </div>

                {/* 예약 시각 */}
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                  <p className="text-[11px] text-white/60 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> 발송 시각</p>
                  <div className="flex gap-1.5">
                    <button onClick={() => setScheduleMode('immediate')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold ${scheduleMode === 'immediate' ? 'bg-indigo-500/40 text-white' : 'bg-white/5 text-white/50'}`}>즉시</button>
                    <button onClick={() => setScheduleMode('manual')} className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold ${scheduleMode === 'manual' ? 'bg-indigo-500/40 text-white' : 'bg-white/5 text-white/50'}`}>직접 예약</button>
                    <button onClick={applyAiTime} className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold ${scheduleMode === 'ai' ? 'bg-violet-500/40 text-white' : 'bg-white/5 text-white/50'}`}>AI 추천</button>
                  </div>
                  {scheduleMode !== 'immediate' && (
                    <input type="datetime-local" value={scheduledAt} onChange={(e) => { setScheduledAt(e.target.value); setScheduleMode('manual'); }} className="w-full px-2.5 py-1.5 bg-slate-950/60 border border-white/10 rounded-lg text-xs text-white [color-scheme:dark]" />
                  )}
                  {scheduleMode === 'ai' && <p className="text-[10px] text-violet-300">AI 추천 — 내일 오전 10시</p>}
                </div>
              </div>

              {/* 오른쪽 — 핸드폰 미리보기 */}
              <div className="flex flex-col items-center">
                <p className="text-[11px] text-white/50 mb-2 flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" /> 핸드폰 미리보기</p>
                <div className="w-full max-w-[380px] rounded-[34px] border-4 border-slate-700 bg-slate-950 p-4 shadow-2xl">
                  <div className="h-6 flex items-center justify-center"><div className="w-20 h-1.5 rounded-full bg-slate-700" /></div>
                  <div className="mt-2 min-h-[500px] bg-slate-800/50 rounded-2xl p-4">
                    <div className="max-w-[92%] bg-white text-slate-900 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words shadow">
                      {previewText || <span className="text-slate-400">문안을 작성하면 여기에 미리보기가 나타납니다.</span>}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-white/30 italic mt-2 text-center">Data source — 샘플 고객 기준 미리보기 · 실제는 수신자별 개인화 링크</p>
                {sentCount !== null && (
                  <div className="mt-3 w-full rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-300 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-200">{sentCount.toLocaleString()}명 처리 완료. '발송 추적'에서 열람 현황을 볼 수 있어요.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {loadingTrack ? (
              <div className="py-12 flex justify-center text-white/50"><RefreshCw className="w-6 h-6 animate-spin" /></div>
            ) : tracking ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { l: '발송', v: tracking.summary.sent, c: 'text-white' },
                    { l: '열람', v: tracking.summary.viewed, c: 'text-cyan-300' },
                    { l: '완독', v: tracking.summary.completed, c: 'text-emerald-300' },
                  ].map((m) => (
                    <div key={m.l} className="rounded-xl border border-white/10 bg-white/5 p-3 text-center">
                      <p className="text-[10px] text-white/40">{m.l}</p>
                      <p className={`text-xl font-bold ${m.c}`}>{Number(m.v).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5 max-h-[52vh] overflow-y-auto">
                  {tracking.recipients.length === 0 ? (
                    <p className="text-xs text-white/40 p-4 text-center">아직 발송 이력이 없습니다.</p>
                  ) : tracking.recipients.map((r) => (
                    <div key={r.customerId} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                      <span className="text-white/80 w-20 truncate">{r.name || '-'}</span>
                      <span className="text-white/40 font-mono w-28 truncate">{r.phone || '-'}</span>
                      <span className={`ml-auto font-medium ${r.viewed ? (r.completed ? 'text-emerald-300' : 'text-cyan-300') : 'text-white/30'}`}>
                        {r.viewed ? (r.completed ? '완독' : `${r.pageReached}/${r.totalPages || '?'}p`) : '미열람'}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-white/30 italic text-center">Data source — dm_recipient_tokens × dm_views (열람 추적)</p>
              </>
            ) : (
              <p className="text-xs text-white/40 text-center py-8">추적 데이터를 불러오는 중입니다.</p>
            )}
          </div>
        )}

        {view === 'compose' && (
          <div className="px-5 py-3.5 border-t border-white/10 bg-slate-950/60 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-white/70 hover:bg-white/5">닫기</button>
            <button onClick={handleSend} disabled={!target || target.channelEligibleCount === 0 || !messageText.trim() || sending} className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5">
              {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? '처리 중...' : scheduleMode === 'immediate' ? (target ? `${target.channelEligibleCount.toLocaleString()}명 발송` : '발송') : '예약 발송'}
            </button>
          </div>
        )}

        <TargetExtractModal show={extractOpen} channel="dm" onClose={() => setExtractOpen(false)} onApply={(t) => { setTarget(t); setExtractOpen(false); }} />
        <AiRefineModal isOpen={refineOpen} originalMessage={messageText} onClose={() => setRefineOpen(false)} onApply={(text) => { setMessageText(text); setRefineOpen(false); }} />
        {spamOpen && (
          <SpamFilterTestModal onClose={() => setSpamOpen(false)} messageContentLms={messageText} callbackNumber={spamCallback} messageType="LMS" subject={dmTitle} isAd={isAd} />
        )}
      </div>
    </div>
  );
}
