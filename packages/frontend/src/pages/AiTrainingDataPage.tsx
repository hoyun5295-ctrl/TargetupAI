/**
 * AiTrainingDataPage.tsx — 슈퍼관리자 전용(ceo) AI 학습 데이터 현황
 *
 * 인비토AI 파인튜닝용 ai_training_logs + operator_proposals 전사 비식별 집계 시각화.
 * 게이팅: backend AI_TRAINING_VIEWER_IDS(기본 ceo) — 메뉴/페이지/endpoint 전부 ceo 전용.
 * 모든 수치 실데이터(가짜 0% 0), 모델명 미노출.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  ArrowLeft, Database, RefreshCw, Loader2, TrendingUp, Layers, ThumbsUp, FileJson, Info, ShieldAlert,
} from 'lucide-react';
import { useToast } from '../components/ToastProvider';

interface Overview {
  summary: {
    total: number; companies: number; metricsFilled: number;
    last7d: number; last30d: number; target: number; progressPct: number;
  };
  channels: { key: string; count: number }[];
  sources: { key: string; count: number }[];
  trend: { day: string; count: number }[];
  preference: { accepted: number; rejected: number };
  spamFilter?: { block: number; pass: number };
  spamSamples?: { message: string; carriers: string[] }[];
  datasets: { generation: number; preference: number; spam: number };
}

const SOURCE_LABEL: Record<string, string> = {
  manual: '직접 작성', selected_as_is: 'AI 원안 발송', edited: 'AI 수정 발송', 기타: '기타',
};

export default function AiTrainingDataPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const authHeader = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/ai-training/overview', { headers: authHeader() });
      if (r.status === 403) { setDenied(true); return; }
      const j = await r.json();
      if (j.success) { setData(j); setDenied(false); }
      else toast.error(`조회 실패: ${j.error || '알 수 없는 오류'}`);
    } catch (e: any) {
      toast.error(`조회 실패: ${e?.message || '네트워크 오류'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const channelMax = useMemo(() => Math.max(1, ...(data?.channels.map((c) => c.count) || [1])), [data]);
  const sourceMax = useMemo(() => Math.max(1, ...(data?.sources.map((c) => c.count) || [1])), [data]);
  const trendMax = useMemo(() => Math.max(1, ...(data?.trend.map((c) => c.count) || [1])), [data]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 text-white">
      <div className="bg-slate-900/60 backdrop-blur-md border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/admin')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="슈퍼관리자로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold">AI 학습 데이터</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">CEO</span>
            </div>
            <p className="text-xs text-white/50 mt-0.5 hidden md:block">한줄로 발송·제안에서 쌓이는 자체 마케팅 AI 학습 데이터 (전사 비식별 집계)</p>
          </div>
          <button onClick={load} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5" aria-label="새로고침">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline">새로고침</span>
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {denied ? (
          <div className="p-6 bg-rose-500/10 border border-rose-400/30 rounded-2xl flex items-start gap-3">
            <Info className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-white/80">이 화면은 ceo 계정에서만 열람할 수 있습니다.</div>
          </div>
        ) : loading || !data ? (
          <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-white/40" /></div>
        ) : (
          <>
            {/* 1. 핵심 지표 + 목표 게이지 */}
            <div className="p-5 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-pink-500/15 border border-violet-400/30 rounded-2xl">
              <div className="flex flex-wrap gap-4 md:gap-8 items-end">
                <div>
                  <div className="text-3xl md:text-4xl font-bold">{data.summary.total.toLocaleString()}</div>
                  <div className="text-xs text-white/50 mt-1">총 학습 데이터 건수</div>
                </div>
                <div className="text-sm text-white/70 space-y-0.5">
                  <div>회사 <strong className="text-white">{data.summary.companies.toLocaleString()}</strong>곳</div>
                  <div>성과 채움 <strong className="text-white">{data.summary.total > 0 ? Math.round(data.summary.metricsFilled / data.summary.total * 100) : 0}%</strong></div>
                </div>
                <div className="text-sm text-white/70 space-y-0.5">
                  <div>최근 7일 <strong className="text-emerald-300">+{data.summary.last7d.toLocaleString()}</strong></div>
                  <div>최근 30일 <strong className="text-emerald-300">+{data.summary.last30d.toLocaleString()}</strong></div>
                </div>
              </div>
              <div className="mt-5">
                <div className="flex justify-between text-xs text-white/60 mb-1.5">
                  <span>파인튜닝 데이터 목표</span>
                  <span><strong className="text-white">{data.summary.total.toLocaleString()}</strong> / {data.summary.target.toLocaleString()} ({data.summary.progressPct}%)</span>
                </div>
                <div className="h-2.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-400" style={{ width: `${Math.min(100, data.summary.progressPct)}%` }} />
                </div>
              </div>
              <div className="text-[10px] text-white/30 italic mt-3">Data source: ai_training_logs 전수 집계 (HMAC 비식별 + 마스킹 후 적재)</div>
            </div>

            {/* 2. 채널 + 작성 유형 분포 */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
                <div className="flex items-center gap-2 mb-4"><Layers className="w-4 h-4 text-sky-300" /><h3 className="text-sm font-semibold">채널 분포</h3></div>
                <div className="space-y-2">
                  {data.channels.map((c) => (
                    <div key={c.key} className="flex items-center gap-3">
                      <span className="text-xs text-white/70 w-12">{c.key}</span>
                      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-sky-400 to-cyan-400" style={{ width: `${c.count / channelMax * 100}%` }} />
                      </div>
                      <span className="text-xs text-white/60 font-mono w-14 text-right">{c.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-white/30 italic mt-3">Data source: ai_training_logs.message_type</div>
              </div>
              <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
                <div className="flex items-center gap-2 mb-4"><FileJson className="w-4 h-4 text-violet-300" /><h3 className="text-sm font-semibold">작성 유형</h3></div>
                <div className="space-y-2">
                  {data.sources.map((c) => (
                    <div key={c.key} className="flex items-center gap-3">
                      <span className="text-xs text-white/70 w-24 truncate">{SOURCE_LABEL[c.key] || c.key}</span>
                      <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-violet-400 to-fuchsia-400" style={{ width: `${c.count / sourceMax * 100}%` }} />
                      </div>
                      <span className="text-xs text-white/60 font-mono w-14 text-right">{c.count.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-white/30 italic mt-3">Data source: ai_training_logs.final_source (AI 생성 vs 직접 작성)</div>
              </div>
            </div>

            {/* 3. Operator 선호 + 4. export 데이터셋 */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
                <div className="flex items-center gap-2 mb-4"><ThumbsUp className="w-4 h-4 text-emerald-300" /><h3 className="text-sm font-semibold">AI Operator 선호 (승인 vs 거부)</h3></div>
                <div className="flex items-end gap-6 h-28">
                  <div className="flex-1 flex flex-col items-center justify-end gap-1">
                    <div className="text-sm font-bold text-emerald-300">{data.preference.accepted.toLocaleString()}</div>
                    <div className="w-full bg-gradient-to-t from-emerald-500 to-teal-400 rounded-t-md" style={{ height: `${data.preference.accepted / Math.max(1, data.preference.accepted, data.preference.rejected) * 100}%`, minHeight: '4px' }} />
                    <div className="text-[10px] text-white/50">승인·자동실행</div>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-end gap-1">
                    <div className="text-sm font-bold text-rose-300">{data.preference.rejected.toLocaleString()}</div>
                    <div className="w-full bg-gradient-to-t from-rose-500 to-pink-400 rounded-t-md" style={{ height: `${data.preference.rejected / Math.max(1, data.preference.accepted, data.preference.rejected) * 100}%`, minHeight: '4px' }} />
                    <div className="text-[10px] text-white/50">거부</div>
                  </div>
                </div>
                <div className="text-[10px] text-white/30 italic mt-3">Data source: operator_proposals.status (선호 학습 신호)</div>
              </div>
              <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
                <div className="flex items-center gap-2 mb-4"><FileJson className="w-4 h-4 text-amber-300" /><h3 className="text-sm font-semibold">export 데이터셋 준비도</h3></div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { k: 'generation', label: '생성(입력→메시지)', v: data.datasets.generation, c: 'from-violet-400 to-fuchsia-500', sub: '' },
                    { k: 'preference', label: '선호(KTO)', v: data.datasets.preference, c: 'from-emerald-400 to-teal-500', sub: '' },
                    { k: 'spam', label: '스팸 분류', v: data.datasets.spam, c: 'from-amber-400 to-orange-500', sub: `차단 ${(data.spamFilter?.block ?? 0).toLocaleString()} 포함` },
                  ].map((d) => (
                    <div key={d.k} className="p-3 bg-white/5 border border-white/10 rounded-xl text-center">
                      <div className={`text-lg font-bold bg-gradient-to-r ${d.c} bg-clip-text text-transparent`}>{d.v.toLocaleString()}</div>
                      <div className="text-[10px] text-white/50 mt-1 leading-snug">{d.label}</div>
                      {d.sub && <div className="text-[10px] text-rose-300/80 mt-0.5 font-mono">{d.sub}</div>}
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-white/30 italic mt-3">Data source: export-training-data JSONL (발송 학습 + 스팸필터 판정 문안)</div>
              </div>
            </div>

            {/* 4b. 스팸 분류 학습 — 차단/통과 + 실제 차단된 문안 */}
            <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
              <div className="flex items-center gap-2 mb-4"><ShieldAlert className="w-4 h-4 text-amber-300" /><h3 className="text-sm font-semibold">스팸 분류 학습</h3></div>
              <div className="flex gap-3 mb-4">
                <div className="flex-1 p-3 bg-rose-500/10 border border-rose-400/20 rounded-xl text-center">
                  <div className="text-xl font-bold text-rose-300">{(data.spamFilter?.block ?? 0).toLocaleString()}</div>
                  <div className="text-[10px] text-white/50 mt-0.5">스팸 차단</div>
                </div>
                <div className="flex-1 p-3 bg-emerald-500/10 border border-emerald-400/20 rounded-xl text-center">
                  <div className="text-xl font-bold text-emerald-300">{(data.spamFilter?.pass ?? 0).toLocaleString()}</div>
                  <div className="text-[10px] text-white/50 mt-0.5">정상 통과</div>
                </div>
              </div>
              {(data.spamSamples?.length ?? 0) > 0 ? (
                <>
                  <div className="text-[11px] text-white/50 mb-2">차단된 문안: 어떤 문구가 스팸으로 처리됐는지</div>
                  <div className="space-y-1.5">
                    {(data.spamSamples ?? []).map((sp, i) => (
                      <div key={i} className="flex items-start gap-2 p-2.5 bg-white/5 border border-white/10 rounded-lg">
                        <span className="text-xs text-white/80 flex-1 leading-relaxed break-words">{sp.message}</span>
                        <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end max-w-[110px]">
                          {sp.carriers.map((c) => (
                            <span key={c} className="text-[9px] bg-rose-500/20 text-rose-200 px-1.5 py-0.5 rounded font-mono">{c}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-4 text-white/40 text-xs">차단된 문안이 아직 없습니다.</div>
              )}
              <div className="text-[10px] text-white/30 italic mt-3">Data source: spam_filter_test_results.result='blocked' 문안 (통신사 스팸 판정 실측)</div>
            </div>

            {/* 5. 일별 적재 추이 */}
            <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
              <div className="flex items-center gap-2 mb-4"><TrendingUp className="w-4 h-4 text-emerald-300" /><h3 className="text-sm font-semibold">일별 적재 추이 (최근 14일)</h3></div>
              {data.trend.length === 0 ? (
                <div className="text-center py-8 text-white/40 text-sm">최근 14일 적재 데이터가 없습니다.</div>
              ) : (
                <div className="flex items-end gap-1.5 h-36">
                  {data.trend.map((t) => (
                    <div key={t.day} className="flex-1 flex flex-col items-center gap-1">
                      <div className="flex-1 w-full flex items-end">
                        <div className="w-full bg-gradient-to-t from-violet-500 to-fuchsia-400 rounded-t-md hover:opacity-80 transition-opacity" style={{ height: `${t.count / trendMax * 100}%`, minHeight: t.count > 0 ? '4px' : '0' }} title={`${t.day}: ${t.count}건`} />
                      </div>
                      <div className="text-[9px] text-white/40">{t.day}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[10px] text-white/30 italic mt-3">Data source: ai_training_logs.send_at 일별(KST) 집계</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
