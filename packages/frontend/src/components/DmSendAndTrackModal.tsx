/**
 * DmSendAndTrackModal — 모바일DM 타겟 발송 + 발송 추적 (sub-project A · P4)
 *
 *   타겟 추출(channel=dm) → 문자 본문 작성 → 수신자별 개인화 링크(?r=token) 문자 발송.
 *   발송 후 '발송 추적' 탭에서 누가 열람/완독했는지 확인.
 *   발송은 검증된 /dm/:id/send-to-target(직접발송 파이프라인 재사용 — 안전망 보존).
 */

import { useState } from 'react';
import { Sparkles, Send, RefreshCw, Check, X } from 'lucide-react';
import { useToast } from './ToastProvider';
import TargetExtractModal, { type ExtractedTarget } from './TargetExtractModal';

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

export default function DmSendAndTrackModal({ dmId, dmTitle, show, onClose }: Props) {
  const toast = useToast();
  const [extractOpen, setExtractOpen] = useState(false);
  const [target, setTarget] = useState<ExtractedTarget | null>(null);
  const [messageText, setMessageText] = useState('');
  const [isAd, setIsAd] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState<number | null>(null);
  const [view, setView] = useState<'compose' | 'track'>('compose');
  const [tracking, setTracking] = useState<{ summary: { sent: number; viewed: number; completed: number }; recipients: TrackRecipient[] } | null>(null);
  const [loadingTrack, setLoadingTrack] = useState(false);

  if (!show) return null;
  const token = () => localStorage.getItem('token');

  const handleSend = async () => {
    if (!target || target.channelEligibleCount === 0) { toast.warning('먼저 타겟을 추출해주세요.'); return; }
    if (!messageText.trim()) { toast.warning('문자 본문을 입력해주세요.'); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/dm/${dmId}/send-to-target`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ filter: target.filter, messageText: messageText.trim(), isAd }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { toast.error(data?.error || '발송에 실패했습니다.'); return; }
      setSentCount(data.sent);
      toast.success(`${Number(data.sent).toLocaleString()}명에게 발송했습니다.`);
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
      <div className="w-full max-w-[600px] max-h-[92vh] overflow-hidden flex flex-col bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-white/10 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center flex-shrink-0">
              <Send className="w-4 h-4 text-white" />
            </div>
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

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {view === 'compose' ? (
            <>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                {target ? (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] text-white/40">발송 가능 대상</p>
                      <p className="text-2xl font-bold text-emerald-300">{target.channelEligibleCount.toLocaleString()}<span className="text-sm font-normal text-white/50 ml-1">명</span></p>
                      {target.explanation && <p className="text-[11px] text-white/50 mt-0.5">{target.explanation}</p>}
                    </div>
                    <button onClick={() => setExtractOpen(true)} className="text-[11px] text-fuchsia-300 hover:text-fuchsia-200">다시 추출</button>
                  </div>
                ) : (
                  <button onClick={() => setExtractOpen(true)} className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4" /> 타겟 추출
                  </button>
                )}
              </div>

              <div>
                <label className="text-[11px] text-white/60 mb-1.5 block">문자 본문 (수신자별 개인화 DM 링크가 자동 첨부됩니다)</label>
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  rows={4}
                  placeholder="예: %고객명%님을 위한 특별 소식이 도착했어요! 아래 링크에서 확인하세요."
                  className="w-full bg-slate-950/60 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-indigo-400/60 focus:ring-1 focus:ring-indigo-400/40 resize-none"
                />
                <label className="mt-2 flex items-center gap-2 text-[11px] text-white/60 cursor-pointer">
                  <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="rounded" />
                  광고성 메시지 (수신거부 080·(광고) 자동 표기)
                </label>
                <p className="text-[10px] text-white/30 mt-1">개인화 링크로 접속하면 그 고객 데이터로 렌더됩니다. 링크는 30일 후 만료됩니다.</p>
              </div>

              {sentCount !== null && (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-300 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-200">{sentCount.toLocaleString()}명에게 발송 완료. 상단 '발송 추적'에서 열람 현황을 볼 수 있어요.</p>
                </div>
              )}
            </>
          ) : (
            <>
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
                  <div className="rounded-xl border border-white/10 bg-white/5 divide-y divide-white/5 max-h-[46vh] overflow-y-auto">
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
            </>
          )}
        </div>

        {view === 'compose' && (
          <div className="px-5 py-3.5 border-t border-white/10 bg-slate-950/60 flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-white/70 hover:bg-white/5">닫기</button>
            <button
              onClick={handleSend}
              disabled={!target || target.channelEligibleCount === 0 || !messageText.trim() || sending}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {sending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? '발송 중...' : target ? `${target.channelEligibleCount.toLocaleString()}명에게 발송` : '발송'}
            </button>
          </div>
        )}

        <TargetExtractModal show={extractOpen} channel="dm" onClose={() => setExtractOpen(false)} onApply={(t) => { setTarget(t); setExtractOpen(false); }} />
      </div>
    </div>
  );
}
