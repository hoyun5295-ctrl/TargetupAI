/**
 * components/cdp/CdpAnalyticsPanels.tsx — 자사몰 데이터 분석·AI 진단 패널 (★2026-08-10 Phase 5)
 *
 * `CdpSettingsPage`의 "데이터 분석 · AI 진단" 모달 내용물을 그대로 옮긴 것이다.
 *
 * ⛔ 분해 규약 (0718 사고 계열 회피)
 *   - **새 동적 import를 만들지 않는다.** 페이지가 정적으로 import하므로 라우트 청크 경계가 그대로다.
 *     0718 사고는 난독화가 *라우트 동적 import 경로 문자열*을 깨 청크가 아예 안 생긴 것이었고,
 *     정적 분리는 그 축을 만들지 않는다.
 *   - **상태를 갖지 않는다.** 이 컴포넌트는 props만 읽고 그린다. 로딩·조회·권한 판정은 페이지 몫이다.
 *   - 차트 보조 컴포넌트(ChartCard·FunnelBar·StatBox·CapBadge)는 이 패널에서만 쓰이므로 함께 옮겼다.
 *     페이지에 남은 MetricBlock·GuideStep·SecretRow는 연결 화면 쪽이라 건드리지 않는다.
 */

import { useMemo, type ReactNode } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import { Sparkles, Loader2, Activity, Database, Users, AlertTriangle, MousePointerClick, Brain } from 'lucide-react';
import { SOURCE_LABEL, CHANNEL_LABEL, CHANNEL_COLOR, formatPct } from '../../utils/cdp-display';
import type {
  CdpDiagnostics, CdpFunnel, CdpTimelineBucket, ChannelDistribution, ChannelCapabilities, CdpExplanation,
} from './cdp-analytics-types';

// ════════════════════════════════════════════════════════════════════
// 차트 보조 — 이 패널 전용
// ════════════════════════════════════════════════════════════════════

function ChartCard({ title, source, icon, children }: { title: string; source?: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/10 flex items-center gap-1.5">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <div className="p-4">
        {children}
        {source && (<div className="text-[10px] text-white/30 italic mt-2 truncate" title={source}>Data source — {source}</div>)}
      </div>
    </div>
  );
}

function FunnelBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-0.5">
        <span className="text-white/70 font-medium">{label}</span>
        <span className="text-white/60 font-mono">{count.toLocaleString()} ({pct.toFixed(1)}%)</span>
      </div>
      <div className="h-3 bg-white/10 rounded overflow-hidden">
        <div className="h-full transition-all" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-2 bg-white/5 rounded text-center">
      <div className="text-white/40">{label}</div>
      <div className={`font-mono font-bold ${color}`}>{value}</div>
    </div>
  );
}

function CapBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded font-medium ${active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-white/40'}`}>
      {label} {active ? '✓' : '·'}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// 패널 본체
// ════════════════════════════════════════════════════════════════════

export interface CdpAnalyticsPanelsProps {
  explanation: CdpExplanation | null;
  explainLoading: boolean;
  /** AI 진단은 회사 관리자만 실행한다 — 판정은 페이지가 하고 여기선 결과만 그린다. */
  isAdmin: boolean;
  onStartExplain: () => void;
  diagnostics: CdpDiagnostics | null;
  funnel: CdpFunnel | null;
  timeline: CdpTimelineBucket[];
  channelDist: ChannelDistribution | null;
  channelCaps: ChannelCapabilities | null;
}

export default function CdpAnalyticsPanels({
  explanation, explainLoading, isAdmin, onStartExplain,
  diagnostics, funnel, timeline, channelDist, channelCaps,
}: CdpAnalyticsPanelsProps) {
  // POS ↔ CDP 격차 도넛 데이터
  const fusionPieData = useMemo(() => {
    if (!diagnostics) return [];
    return [
      { name: 'POS only (싱크/업로드/수동)', value: diagnostics.posOnlyCustomers, color: '#64748b' },
      { name: 'CDP only (자사몰만)', value: diagnostics.cdpOnlyCustomers, color: '#06b6d4' },
      { name: '융합 (양쪽 source)', value: diagnostics.fusedCustomers, color: '#10b981' },
    ].filter((d) => d.value > 0);
  }, [diagnostics]);

  // 24h timeline 차트 데이터
  const timelineChartData = useMemo(() => {
    return timeline.map((b) => ({
      hour: `${b.hour}시`,
      total: b.count,
      purchase: b.byEvent['purchase'] || 0,
      cart: b.byEvent['cart_add'] || 0,
      view: b.byEvent['page_view'] || 0,
    }));
  }, [timeline]);

  // 채널 분포 PieChart
  const channelPieData = useMemo(() => {
    if (!channelDist) return [];
    return channelDist.groups.map((g) => ({
      name: CHANNEL_LABEL[g.channel] || g.channel,
      value: g.count,
      color: CHANNEL_COLOR[g.channel] || '#64748b',
    }));
  }, [channelDist]);

  return (
    <div className="space-y-4">
      {/* AI 자율 진단 — 모달 open 시 자동 로드 */}
      <div className="p-4 bg-gradient-to-br from-violet-500/15 via-fuchsia-500/10 to-indigo-500/15 border border-violet-400/30 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-violet-100 mb-1">AI 자율 진단</div>
            {explanation ? (
              <div className="text-xs text-white/80 leading-relaxed">{explanation.topInsight}</div>
            ) : explainLoading ? (
              <div className="text-xs text-white/60 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> AI 분석 중 (10~20초)
              </div>
            ) : isAdmin ? (
              <button onClick={onStartExplain} className="text-xs text-violet-200 hover:text-violet-100 underline-offset-2 hover:underline">
                AI 자율 진단 시작 →
              </button>
            ) : (
              <div className="text-xs text-white/50">AI 진단은 회사 관리자만 가능합니다.</div>
            )}
          </div>
        </div>
      </div>

      {/* 자사몰 funnel */}
      {funnel && funnel.pageViewCount > 0 ? (
        <ChartCard title="자사몰 이벤트 Funnel (30일)" source={funnel.source} icon={<Activity className="w-4 h-4 text-emerald-300" />}>
          <div className="space-y-2">
            <FunnelBar label="page_view" count={funnel.pageViewCount} max={funnel.pageViewCount} color="#6366f1" />
            <FunnelBar label="cart_add" count={funnel.cartAddCount} max={funnel.pageViewCount} color="#06b6d4" />
            <FunnelBar label="checkout_start" count={funnel.checkoutStartCount} max={funnel.pageViewCount} color="#a78bfa" />
            <FunnelBar label="purchase" count={funnel.purchaseCount} max={funnel.pageViewCount} color="#10b981" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
            <StatBox label="cart 전환율" value={formatPct(funnel.cartConversionRate)} color="text-cyan-300" />
            <StatBox label="구매 전환율" value={formatPct(funnel.purchaseConversionRate)} color="text-emerald-300" />
            <StatBox label="cart → 구매" value={formatPct(funnel.cartToPurchaseRate)} color="text-fuchsia-300" />
          </div>
        </ChartCard>
      ) : (
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl text-xs text-white/50">
          자사몰 이벤트 영역 0건 — SDK 설치 또는 webhook 영역 확인 의무.
        </div>
      )}

      {/* 24h timeline */}
      {timeline.length > 0 && timelineChartData.some((d) => d.total > 0) && (
        <ChartCard title="24시간 이벤트 timeline (KST)" source="cdp_events 24h hourly bucket" icon={<Activity className="w-4 h-4 text-cyan-300" />}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={timelineChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="hour" stroke="rgba(255,255,255,0.5)" fontSize={10} />
              <YAxis stroke="rgba(255,255,255,0.5)" fontSize={10} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="view" stackId="a" fill="#6366f1" name="page_view" />
              <Bar dataKey="cart" stackId="a" fill="#06b6d4" name="cart_add" />
              <Bar dataKey="purchase" stackId="a" fill="#10b981" name="purchase" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Provider별 매핑률 */}
      {diagnostics && diagnostics.byProvider.length > 0 && (
        <ChartCard title="자사몰별 고객 연결률" source="cdp_identity_links group by source" icon={<Database className="w-4 h-4 text-violet-300" />}>
          <div className="space-y-2">
            {diagnostics.byProvider.map((p) => (
              <div key={p.source} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-white/80 font-medium">{SOURCE_LABEL[p.source] || p.source}</span>
                  <span className="text-white/60 font-mono">
                    {p.mappedLinks.toLocaleString()} / {p.totalLinks.toLocaleString()} ({formatPct(p.mappingRate)}) · 30일 이벤트 {p.events30d.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${p.mappingRate > 0.7 ? 'bg-emerald-400' : p.mappingRate > 0.4 ? 'bg-amber-400' : 'bg-rose-400'}`}
                    style={{ width: `${Math.max(2, p.mappingRate * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {/* POS ↔ CDP 격차 도넛 */}
      {fusionPieData.length > 0 && (
        <ChartCard title="POS ↔ CDP 융합 격차 (Source overlap)" source="customers.active_sources jsonb 분류" icon={<Users className="w-4 h-4 text-amber-300" />}>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={fusionPieData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80} paddingAngle={2}>
                {fusionPieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Webhook 신뢰성 */}
      {diagnostics && diagnostics.webhookReliability.length > 0 && (
        <ChartCard title="Webhook 수신 신뢰성 (30일)" source="cdp_webhook_deliveries status" icon={<AlertTriangle className="w-4 h-4 text-rose-300" />}>
          <div className="space-y-1.5">
            {diagnostics.webhookReliability.map((w) => (
              <div key={w.source} className="grid grid-cols-12 gap-2 items-center text-[11px]">
                <div className="col-span-3 text-white/80 font-medium">{SOURCE_LABEL[w.source] || w.source}</div>
                <div className="col-span-2 text-white/60 font-mono text-right">{w.totalDeliveries.toLocaleString()}건</div>
                <div className="col-span-2 text-emerald-300 font-mono text-right">성공 {w.successCount}</div>
                <div className="col-span-2 text-rose-300 font-mono text-right">실패 {w.failedCount}</div>
                <div className="col-span-3 text-right font-mono">
                  <span className={w.successRate > 0.9 ? 'text-emerald-300' : w.successRate > 0.7 ? 'text-amber-300' : 'text-rose-300'}>
                    {formatPct(w.successRate)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      {/* 채널 분포 */}
      {channelDist && channelPieData.length > 0 && (
        <ChartCard title="발송 채널 자동 분배" source="customers.preferred_channel (CT-71 unified profile)" icon={<MousePointerClick className="w-4 h-4 text-fuchsia-300" />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={channelPieData} dataKey="value" nameKey="name" innerRadius={30} outerRadius={70} paddingAngle={2}>
                  {channelPieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5">
              {channelDist.groups.map((g) => (
                <div key={g.channel} className="flex items-center justify-between text-[11px]">
                  <span className="text-white/80 font-medium flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHANNEL_COLOR[g.channel] || '#64748b' }} />
                    {CHANNEL_LABEL[g.channel] || g.channel}
                  </span>
                  <span className="text-white/60 font-mono">{g.count.toLocaleString()}명</span>
                </div>
              ))}
              {channelDist.unreachable > 0 && (
                <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-white/10">
                  <span className="text-rose-300 font-medium">발송 불가</span>
                  <span className="text-rose-300 font-mono">{channelDist.unreachable.toLocaleString()}명</span>
                </div>
              )}
            </div>
          </div>
          {channelCaps && (
            <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap gap-2 text-[10px]">
              <CapBadge label="SMS/LMS" active={channelCaps.smsLms} />
              <CapBadge label="알림톡" active={channelCaps.kakao} />
              <CapBadge label="이메일" active={channelCaps.email} />
              <CapBadge label="웹 푸시" active={channelCaps.webPush} />
              <CapBadge label="인앱" active={channelCaps.inApp} />
            </div>
          )}
        </ChartCard>
      )}

      {/* AI 영향 요인 매트릭스 */}
      {explanation && explanation.factors.length > 0 && (
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="w-4 h-4 text-violet-300" />
            <h2 className="text-sm font-semibold">AI 자사몰 영향 요인 분석</h2>
            <span className="ml-auto text-[10px] text-white/40">건강도 스코어 <span className="text-violet-300 font-mono font-bold">{explanation.overallHealthScore}</span>/100</span>
          </div>
          <div className="space-y-1.5">
            {explanation.factors.map((f, i) => {
              const dirColor = f.direction === 'positive' ? 'bg-emerald-400' : f.direction === 'negative' ? 'bg-rose-400' : 'bg-amber-400';
              const dirTextColor = f.direction === 'positive' ? 'text-emerald-300' : f.direction === 'negative' ? 'text-rose-300' : 'text-amber-300';
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-center text-[11px]">
                  <div className="col-span-3 text-white/70 font-medium">{f.label}</div>
                  <div className="col-span-5">
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full ${dirColor}`} style={{ width: `${f.impactScore * 100}%` }} />
                    </div>
                  </div>
                  <div className={`col-span-1 text-right font-mono ${dirTextColor}`}>{(f.impactScore * 100).toFixed(0)}%</div>
                  <div className="col-span-3 text-[10px] text-white/50 truncate" title={f.detail}>{f.detail}</div>
                </div>
              );
            })}
          </div>
          {explanation.recommendations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {explanation.recommendations.map((r, i) => (
                <div key={i} className="p-2 bg-violet-500/10 border border-violet-400/30 rounded text-[11px] text-violet-100">
                  <strong>{i + 1}.</strong> {r}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 컴퓨팅 시점 */}
      {diagnostics && (
        <div className="text-center text-[11px] text-white/40 pt-2">
          마지막 진단: {new Date(diagnostics.computedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
          <br />
          고객 통합 프로필은 5분 주기로 자동 재계산되고, 주문·식별 이벤트는 수신 즉시 반영됩니다
        </div>
      )}
    </div>
  );
}
