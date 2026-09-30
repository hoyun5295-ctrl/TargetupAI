import { Workflow } from 'lucide-react';
import ZoneFrame from '../components/zone/ZoneFrame';
import { journeyItemTabs } from '../components/zone/zone-tabs';
import StatusPill from '../components/console/StatusPill';
import { JOURNEY_STATUS_LABEL } from '../utils/journey-row-actions';
/**
 * JourneyDetailPage.tsx — Journey 상세 (D192 2026-05-22)
 *
 * 진입 사용자 리스트 + step별 진행 매트릭스 + Overview 카드
 *
 * 기능:
 *  - 상단 6 Overview 카드 (총 진입/활성/완료/이탈/총 발송/총 비용)
 *  - 상태 필터 (전체/active/completed/paused/failed)
 *  - 진입 사용자 테이블 (페이지네이션 50건)
 *  - 통계 페이지 진입 버튼
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  ArrowLeft, BarChart3, Users, CheckCircle2, XCircle, Pause, Loader2,
  TrendingUp, DollarSign, Clock, Target,
} from 'lucide-react';

interface OverviewData {
  journeyId: string;
  totalEntered: number;
  active: number;
  completed: number;
  /** ★ 2026-07-10 목표 달성 종료(진입 이후 구매 확인 이탈) */
  goalMet?: number;
  paused: number;
  failed: number;
  totalCost: number;
  totalSent: number;
  totalFailed: number;
  totalSkipped: number;
  avgCompletionHours: number | null;
  completionRate: number;
}

interface CustomerRow {
  executionId: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerGrade: string | null;
  customerRegion: string | null;
  currentStepOrder: number;
  status: string;
  enteredAt: string;
  completedAt: string | null;
  totalCost: number;
}

interface JourneyMeta {
  id: string;
  name: string;
  status: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '진행 중' },
  { value: 'completed', label: '완료' },
  { value: 'goal_met', label: '목표 달성' },  // ★ 2026-07-10 진입 이후 구매 확인 이탈
  { value: 'paused', label: '일시정지' },
  { value: 'failed', label: '실패' },
];

const STATUS_BADGE: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  goal_met: 'bg-emerald-100 text-emerald-800',
  paused: 'bg-amber-100 text-amber-700',
  failed: 'bg-rose-100 text-rose-700',
};

export default function JourneyDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [journey, setJourney] = useState<JourneyMeta | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('all');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  const token = () => localStorage.getItem('token');

  const loadOverview = async () => {
    try {
      const [statsRes, journeyRes] = await Promise.all([
        fetch(`/api/ai/operator/journeys/${id}/stats`, {
          headers: { Authorization: `Bearer ${token()}` },
        }),
        fetch(`/api/ai/operator/journeys/${id}`, {
          headers: { Authorization: `Bearer ${token()}` },
        }),
      ]);
      const statsData = await statsRes.json();
      const journeyData = await journeyRes.json();
      if (statsData.success) setOverview(statsData.stats.overview);
      if (journeyData.success && journeyData.detail?.journey) {
        setJourney({
          id: journeyData.detail.journey.id,
          name: journeyData.detail.journey.name,
          status: journeyData.detail.journey.status,
        });
      }
    } catch {
      setError('통계 조회 실패');
    }
  };

  const loadCustomers = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        ...(status !== 'all' ? { status } : {}),
      });
      const r = await fetch(`/api/ai/operator/journeys/${id}/executions?${params}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const d = await r.json();
      if (d.success) {
        setCustomers(d.executions || []);
        setTotal(d.total || 0);
      } else {
        setError(d.error || '사용자 리스트 조회 실패');
      }
    } catch {
      setError('네트워크 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOverview(); }, [id]);
  useEffect(() => { loadCustomers(); }, [id, status, offset]);

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso);
      return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' });
    } catch { return iso; }
  };

  const formatCost = (n: number) => `${n.toLocaleString('ko-KR')}원`;

  return (
    <ZoneFrame
      moduleId="journeys"
      sub={journey?.name || '여정'}
      backTo="/ai-journeys"
      backLabel="여정 목록으로"
      tabs={journeyItemTabs(id)}
      activeTab="entrants"
    >
      <div>
        {journey?.status && (
          <div className="mb-3 flex items-center gap-2 text-[13px] text-slate-500">
            <StatusPill label={JOURNEY_STATUS_LABEL[journey.status] || journey.status} tone={journey.status === 'active' ? 'green' : journey.status === 'paused' ? 'amber' : 'neutral'} />
            진입 사용자 + 단계별 진행
          </div>
        )}
        {/* Overview 카드 — ★ 2026-07-10 목표 달성(진입 후 구매 확인 이탈) 추가 */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <OverviewCard icon={<Users className="w-4 h-4" />} label="총 진입" value={overview.totalEntered.toLocaleString()} color="text-blue-700" />
            <OverviewCard icon={<TrendingUp className="w-4 h-4" />} label="진행 중" value={overview.active.toLocaleString()} color="text-cyan-700" />
            <OverviewCard icon={<CheckCircle2 className="w-4 h-4" />} label="완료" value={overview.completed.toLocaleString()} color="text-emerald-700" />
            <OverviewCard icon={<Target className="w-4 h-4" />} label="목표 달성" value={Number(overview.goalMet || 0).toLocaleString()} color="text-emerald-700" />
            <OverviewCard icon={<Pause className="w-4 h-4" />} label="일시정지" value={overview.paused.toLocaleString()} color="text-amber-700" />
            <OverviewCard icon={<XCircle className="w-4 h-4" />} label="실패" value={overview.failed.toLocaleString()} color="text-rose-700" />
            <OverviewCard icon={<DollarSign className="w-4 h-4" />} label="총 발송 비용" value={formatCost(overview.totalCost)} color="text-fuchsia-700" />
          </div>
        )}

        {/* 보조 통계 */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 text-sm">
            <div className="p-3 bg-white border border-slate-200 rounded-lg">
              <div className="text-slate-400 text-xs mb-0.5">총 발송 건</div>
              <div className="font-mono">{overview.totalSent.toLocaleString()}건</div>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-lg">
              <div className="text-slate-400 text-xs mb-0.5">완료율</div>
              <div className="font-mono">{(overview.completionRate * 100).toFixed(1)}%</div>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-lg">
              <div className="text-slate-400 text-xs mb-0.5">평균 완료 시간</div>
              <div className="font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {overview.avgCompletionHours != null ? `${overview.avgCompletionHours.toFixed(1)}h` : '-'}
              </div>
            </div>
            <div className="p-3 bg-white border border-slate-200 rounded-lg">
              <div className="text-slate-400 text-xs mb-0.5">실패/Skip</div>
              <div className="font-mono">{(overview.totalFailed + overview.totalSkipped).toLocaleString()}건</div>
            </div>
          </div>
        )}

        {/* 상태 필터 */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setStatus(opt.value); setOffset(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                status === opt.value
                  ? 'bg-violet-100 text-violet-800 border border-violet-300'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <div className="flex-1 text-right text-xs text-slate-400">총 {total.toLocaleString()}명</div>
        </div>

        {/* 사용자 테이블 */}
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              불러오는 중...
            </div>
          ) : error ? (
            <div className="p-12 text-center text-rose-700">{error}</div>
          ) : customers.length === 0 ? (
            <div className="p-12 text-center text-slate-400">진입한 사용자가 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white border-b border-slate-200">
                  <tr className="text-left text-slate-500 text-xs">
                    <th className="px-3 py-2.5 font-medium">고객명</th>
                    <th className="px-3 py-2.5 font-medium">연락처</th>
                    <th className="px-3 py-2.5 font-medium">등급</th>
                    <th className="px-3 py-2.5 font-medium">지역</th>
                    <th className="px-3 py-2.5 font-medium text-center">진행 step</th>
                    <th className="px-3 py-2.5 font-medium text-center">상태</th>
                    <th className="px-3 py-2.5 font-medium">진입 시간</th>
                    <th className="px-3 py-2.5 font-medium">완료 시간</th>
                    <th className="px-3 py-2.5 font-medium text-right">비용</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.executionId} className="border-b border-slate-100 hover:bg-white transition-colors">
                      <td className="px-3 py-2.5">{c.customerName || '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{c.customerPhone || '-'}</td>
                      <td className="px-3 py-2.5">{c.customerGrade || '-'}</td>
                      <td className="px-3 py-2.5">{c.customerRegion || '-'}</td>
                      <td className="px-3 py-2.5 text-center">{c.currentStepOrder + 1}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${STATUS_BADGE[c.status] || 'bg-slate-500/20 text-slate-600'}`}>
                          {STATUS_OPTIONS.find((s) => s.value === c.status)?.label || c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{formatDate(c.enteredAt)}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-500">{formatDate(c.completedAt)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{formatCost(c.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 페이지네이션 */}
        {total > limit && (
          <div className="flex items-center justify-center gap-2 mt-4">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs"
            >
              이전
            </button>
            <span className="text-xs text-slate-500 px-3">
              {offset + 1}~{Math.min(offset + limit, total)} / {total.toLocaleString()}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </ZoneFrame>
  );
}

function OverviewCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="p-3 bg-white border border-slate-200 rounded-lg">
      <div className={`flex items-center gap-1.5 text-xs ${color} mb-1.5`}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg md:text-xl font-semibold font-mono">{value}</div>
    </div>
  );
}
