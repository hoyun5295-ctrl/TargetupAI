import { Workflow } from 'lucide-react';
import { OUI_BACK, OUI_HEADER, OUI_HEADER_ROW, OUI_ICON_TILE, OUI_PAGE, OUI_PAGE_CENTER, OUI_SUBTITLE, OUI_TITLE, OUI_WRAP_WIDE } from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';
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
  active: 'bg-blue-500/20 text-blue-300',
  completed: 'bg-emerald-500/20 text-emerald-300',
  goal_met: 'bg-emerald-500/25 text-emerald-200',
  paused: 'bg-amber-500/20 text-amber-300',
  failed: 'bg-rose-500/20 text-rose-300',
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
    <div className={OUI_PAGE}>
      <OperatorAura />
      {/* 헤더: 오퍼레이터 표면 단계(OUI) 1규격 = 뒤로가기 · 타일 · 제목 · 부제 · 우측 액션 */}
      <div className={OUI_HEADER}>
        <div className={`${OUI_WRAP_WIDE} ${OUI_HEADER_ROW}`}>
          <button onClick={() => goBackOr(navigate, '/ai-journeys')} className={OUI_BACK} aria-label="여정 목록으로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className={`${OUI_ICON_TILE} bg-gradient-to-br from-fuchsia-400 to-purple-500`}>
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className={`${OUI_TITLE} flex items-center gap-2`}>
              {journey?.name || '여정 상세'}
              {journey?.status && (
                <span className={`px-2 py-0.5 rounded text-xs ${STATUS_BADGE[journey.status] || 'bg-slate-500/20 text-slate-300'}`}>
                  {journey.status}
                </span>
              )}
            </h1>
            <p className={OUI_SUBTITLE}>진입 사용자 + step별 진행 매트릭스</p>
          </div>
          <button
            onClick={() => navigate(`/ai-journeys/${id}/stats`)}
            className="px-3 py-2 bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 rounded-lg text-sm flex items-center gap-1.5"
          >
            <BarChart3 className="w-4 h-4" /> 통계 분석
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Overview 카드 — ★ 2026-07-10 목표 달성(진입 후 구매 확인 이탈) 추가 */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <OverviewCard icon={<Users className="w-4 h-4" />} label="총 진입" value={overview.totalEntered.toLocaleString()} color="text-blue-300" />
            <OverviewCard icon={<TrendingUp className="w-4 h-4" />} label="진행 중" value={overview.active.toLocaleString()} color="text-cyan-300" />
            <OverviewCard icon={<CheckCircle2 className="w-4 h-4" />} label="완료" value={overview.completed.toLocaleString()} color="text-emerald-300" />
            <OverviewCard icon={<Target className="w-4 h-4" />} label="목표 달성" value={Number(overview.goalMet || 0).toLocaleString()} color="text-emerald-300" />
            <OverviewCard icon={<Pause className="w-4 h-4" />} label="일시정지" value={overview.paused.toLocaleString()} color="text-amber-300" />
            <OverviewCard icon={<XCircle className="w-4 h-4" />} label="실패" value={overview.failed.toLocaleString()} color="text-rose-300" />
            <OverviewCard icon={<DollarSign className="w-4 h-4" />} label="총 발송 비용" value={formatCost(overview.totalCost)} color="text-fuchsia-300" />
          </div>
        )}

        {/* 보조 통계 */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 text-sm">
            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/40 text-xs mb-0.5">총 발송 건</div>
              <div className="font-mono">{overview.totalSent.toLocaleString()}건</div>
            </div>
            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/40 text-xs mb-0.5">완료율</div>
              <div className="font-mono">{(overview.completionRate * 100).toFixed(1)}%</div>
            </div>
            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/40 text-xs mb-0.5">평균 완료 시간</div>
              <div className="font-mono flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {overview.avgCompletionHours != null ? `${overview.avgCompletionHours.toFixed(1)}h` : '-'}
              </div>
            </div>
            <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
              <div className="text-white/40 text-xs mb-0.5">실패/Skip</div>
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
                  ? 'bg-violet-500/30 text-violet-200 border border-violet-400/50'
                  : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <div className="flex-1 text-right text-xs text-white/40">총 {total.toLocaleString()}명</div>
        </div>

        {/* 사용자 테이블 */}
        <div className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-white/40">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              불러오는 중...
            </div>
          ) : error ? (
            <div className="p-12 text-center text-rose-300">{error}</div>
          ) : customers.length === 0 ? (
            <div className="p-12 text-center text-white/40">진입한 사용자가 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr className="text-left text-white/60 text-xs">
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
                    <tr key={c.executionId} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-3 py-2.5">{c.customerName || '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{c.customerPhone || '-'}</td>
                      <td className="px-3 py-2.5">{c.customerGrade || '-'}</td>
                      <td className="px-3 py-2.5">{c.customerRegion || '-'}</td>
                      <td className="px-3 py-2.5 text-center">{c.currentStepOrder + 1}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${STATUS_BADGE[c.status] || 'bg-slate-500/20 text-slate-300'}`}>
                          {STATUS_OPTIONS.find((s) => s.value === c.status)?.label || c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-white/60">{formatDate(c.enteredAt)}</td>
                      <td className="px-3 py-2.5 text-xs text-white/60">{formatDate(c.completedAt)}</td>
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
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs"
            >
              이전
            </button>
            <span className="text-xs text-white/50 px-3">
              {offset + 1}~{Math.min(offset + limit, total)} / {total.toLocaleString()}
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed rounded text-xs"
            >
              다음
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
      <div className={`flex items-center gap-1.5 text-xs ${color} mb-1.5`}>
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg md:text-xl font-semibold font-mono">{value}</div>
    </div>
  );
}
