// EmailAnalyticsModal — 이메일 성과 분석 대시보드(읽기 전용). 가로 큰 배너 X = 헤더 "분석" 버튼 → 이 모달.
// 요약 5지표(이전 동기간 대비) + AI 종합 진단(on-demand 5크레딧) + 일자별 추이 + 캠페인 비교(1클릭 액션).
// 데이터 적응(부족하면 숨김) · 모델명 UI 0 · native dialog 0 · Source caption · 모바일 반응형.
import { useEffect, useState } from 'react';
import {
  BarChart3, Loader2, Smartphone, Sparkles, TrendingDown, TrendingUp, X,
} from 'lucide-react';
import type { EmailCampaign } from './email-campaign-types';

interface PeriodSummary {
  campaigns: number; sent: number; open: number; click: number; bounce: number; unsub: number;
  openRate: number; clickRate: number; bounceRate: number; unsubRate: number;
}
interface Analytics {
  days: number;
  summary: {
    current: PeriodSummary;
    previous: PeriodSummary;
    deltas: { sent: number | null; openRate: number; clickRate: number; bounceRate: number; unsubRate: number };
  };
  trend: Array<{ date: string; sent: number; open: number; click: number }>;
}
interface AccountInsight { topInsight: string; suggestions: Array<{ title: string; description: string }>; }

const DAYS_OPTIONS = [7, 30, 90];

export default function EmailAnalyticsModal({
  campaigns, authHeaders, onClose, onOpenInsight, onOpenNonOpener, onToast,
}: {
  campaigns: EmailCampaign[];
  authHeaders: () => Record<string, string>;
  onClose: () => void;
  onOpenInsight: (c: EmailCampaign) => void;
  onOpenNonOpener: (c: EmailCampaign) => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [insight, setInsight] = useState<AccountInsight | null>(null);
  const [insightMsg, setInsightMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/email/analytics?days=${days}`, { headers: authHeaders() });
        const json = await res.json();
        if (alive && json.success) setData(json);
      } catch { /* 조회 실패는 빈 상태로 둠 */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const runAiInsight = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setInsightMsg(null);
    try {
      const res = await fetch('/api/email/ai/account-insight', {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ days }),
      });
      const json = await res.json();
      if (json?.code === 'INSUFFICIENT_CREDIT') { onToast('크레딧이 부족합니다. 충전 후 이용해주세요.', 'warning'); return; }
      if (json.success && json.insufficientData) { setInsightMsg(json.message || '발송 데이터가 부족합니다.'); return; }
      if (json.success && json.insight) {
        setInsight(json.insight);
        onToast('AI 종합 진단 완료 (5 크레딧)', 'success');
      } else {
        onToast(json.error || 'AI 진단 실패', 'error');
      }
    } catch (e: any) {
      onToast(e?.message || 'AI 진단 중 오류', 'error');
    } finally {
      setAiBusy(false);
    }
  };

  // 캠페인 비교 — 발송된 것만, 오픈율 내림차순(페이지 campaigns로 클라이언트 계산)
  const compared = campaigns
    .filter((c) => c.sentCount > 0)
    .map((c) => ({ c, openRate: (c.openCount / c.sentCount) * 100, clickRate: (c.clickCount / c.sentCount) * 100 }))
    .sort((a, b) => b.openRate - a.openRate);

  const sm = data?.summary;
  const trend = data?.trend || [];
  const trendMax = Math.max(1, ...trend.map((t) => Math.max(t.open, t.click)));

  const metrics = sm ? [
    { label: '총 발송', value: sm.current.sent.toLocaleString(), delta: sm.deltas.sent, unit: '%', goodUp: true },
    { label: '오픈율', value: `${sm.current.openRate}%`, delta: sm.deltas.openRate, unit: 'p', goodUp: true },
    { label: '클릭률', value: `${sm.current.clickRate}%`, delta: sm.deltas.clickRate, unit: 'p', goodUp: true },
    { label: '반송률', value: `${sm.current.bounceRate}%`, delta: sm.deltas.bounceRate, unit: 'p', goodUp: false },
    { label: '수신거부율', value: `${sm.current.unsubRate}%`, delta: sm.deltas.unsubRate, unit: 'p', goodUp: false },
  ] : [];

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 md:p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 + 기간 토글 */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-white">성과 분석</h3>
            <p className="text-[11px] text-white/50">캠페인 오픈·클릭 추이와 AI 종합 진단</p>
          </div>
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-0.5">
            {DAYS_OPTIONS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`text-[11px] px-2.5 py-1 rounded-md ${days === d ? 'bg-indigo-500/40 text-white font-semibold' : 'text-white/50 hover:text-white'}`}>{d}일</button>
            ))}
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1.5 rounded hover:bg-white/10 shrink-0" aria-label="닫기"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-5">
          {loading ? (
            <div className="flex justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : !sm || sm.current.sent === 0 ? (
            <div className="text-center py-16 text-sm text-white/50">최근 {days}일 발송된 캠페인이 없습니다. 발송이 쌓이면 성과가 표시됩니다.</div>
          ) : (
            <>
              {/* 1. 요약 5지표 + 이전 동기간 대비 */}
              <div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                  {metrics.map((m) => {
                    const hasDelta = m.delta !== null && m.delta !== undefined;
                    const up = (m.delta ?? 0) > 0;
                    const flat = (m.delta ?? 0) === 0;
                    const good = up === m.goodUp;
                    const color = !hasDelta || flat ? 'text-white/40' : good ? 'text-emerald-300' : 'text-rose-300';
                    return (
                      <div key={m.label} className="bg-white/5 border border-white/10 rounded-xl p-3">
                        <div className="text-[10px] text-white/50 mb-1">{m.label}</div>
                        <div className="text-lg font-bold text-white tabular-nums">{m.value}</div>
                        <div className={`mt-1 flex items-center gap-1 text-[10px] ${color}`}>
                          {!hasDelta ? <span className="text-white/30">이전 데이터 없음</span> : flat ? <span>변화 없음</span> : (
                            <>
                              {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                              <span className="tabular-nums">{Math.abs(m.delta as number)}{m.unit}{m.unit === 'p' ? 'p' : ''} {m.label === '총 발송' ? '' : '(이전 대비)'}</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[10px] text-white/30 italic mt-2">Data source — email_campaigns 발송 기준 최근 {days}일 vs 직전 동기간</div>
              </div>

              {/* 2. AI 종합 진단 */}
              <div className="bg-gradient-to-br from-violet-600/15 via-fuchsia-600/10 to-indigo-600/15 border border-fuchsia-400/25 rounded-2xl p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-500 flex items-center justify-center"><Sparkles className="w-4 h-4 text-white" /></div>
                    <div>
                      <div className="text-sm font-bold text-white">AI 종합 진단</div>
                      <div className="text-[11px] text-white/50">실측 집계만 근거 — 다음 캠페인 개선점</div>
                    </div>
                  </div>
                  <button onClick={runAiInsight} disabled={aiBusy} className="px-3 py-1.5 bg-gradient-to-r from-fuchsia-500 to-purple-500 hover:opacity-90 disabled:opacity-40 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 whitespace-nowrap">
                    {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {insight ? '다시 진단' : 'AI 진단 받기 (5크레딧)'}
                  </button>
                </div>
                {insightMsg && <div className="text-xs text-white/50 mt-1">{insightMsg}</div>}
                {insight && (
                  <div className="mt-2 space-y-2">
                    <div className="text-sm text-white/90 bg-white/5 border border-white/10 rounded-lg p-3">{insight.topInsight}</div>
                    {insight.suggestions.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        {insight.suggestions.map((s, i) => (
                          <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-3">
                            <div className="text-xs font-semibold text-fuchsia-200 mb-1">{s.title}</div>
                            <div className="text-[11px] text-white/60 leading-relaxed">{s.description}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {!insight && !insightMsg && <div className="text-[11px] text-white/40 mt-1">버튼을 누르면 AI가 계정 전체 성과를 진단하고 개선점을 제안합니다.</div>}
              </div>

              {/* 3. 일자별 추이 (데이터 2일+ 일 때만) */}
              {trend.length >= 2 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-white/70">일자별 추이</div>
                    <div className="flex items-center gap-3 text-[10px] text-white/50">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-400/70" /> 오픈</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-cyan-400/70" /> 클릭</span>
                    </div>
                  </div>
                  <div className="flex items-end gap-1 overflow-x-auto pb-1 bg-white/5 border border-white/10 rounded-xl p-3">
                    {trend.map((t) => (
                      <div key={t.date} className="flex flex-col items-center gap-1 shrink-0" title={`${t.date} · 발송 ${t.sent} · 오픈 ${t.open} · 클릭 ${t.click}`}>
                        <div className="flex items-end gap-0.5 h-24">
                          <div className="w-1.5 bg-emerald-400/70 rounded-t" style={{ height: `${Math.max(2, (t.open / trendMax) * 100)}%` }} />
                          <div className="w-1.5 bg-cyan-400/70 rounded-t" style={{ height: `${Math.max(2, (t.click / trendMax) * 100)}%` }} />
                        </div>
                        <div className="text-[8px] text-white/30 tabular-nums">{t.date.slice(5)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[10px] text-white/30 italic mt-2">Data source — email_events 오픈·클릭 일자 집계 (KST)</div>
                </div>
              )}

              {/* 4. 캠페인 성과 비교 + 1클릭 액션 */}
              <div>
                <div className="text-xs font-semibold text-white/70 mb-2">캠페인 성과 비교 (오픈율 순)</div>
                {compared.length === 0 ? (
                  <div className="text-xs text-white/40 bg-white/5 border border-white/10 rounded-xl p-4 text-center">발송된 캠페인이 쌓이면 비교가 표시됩니다.</div>
                ) : (
                  <div className="space-y-1.5">
                    {compared.map(({ c, openRate, clickRate }) => (
                      <div key={c.id} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex-wrap">
                        <div className="flex-1 min-w-[140px]">
                          <div className="text-sm text-white font-medium truncate">{c.name}</div>
                          <div className="text-[11px] text-white/50 tabular-nums">발송 {c.sentCount.toLocaleString()} · 오픈 {openRate.toFixed(1)}% · 클릭 {clickRate.toFixed(1)}%</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button onClick={() => onOpenInsight(c)} className="text-[11px] text-fuchsia-300 hover:bg-fuchsia-500/10 px-2.5 py-1 rounded flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> AI 진단
                          </button>
                          <button onClick={() => onOpenNonOpener(c)} className="text-[11px] text-cyan-300 hover:bg-cyan-500/10 px-2.5 py-1 rounded flex items-center gap-1">
                            <Smartphone className="w-3 h-3" /> 미오픈 SMS
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-[10px] text-white/30 italic mt-2">Data source — 캠페인별 누적 오픈·클릭 (전 기간)</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
