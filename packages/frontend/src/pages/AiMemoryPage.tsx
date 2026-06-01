/**
 * AiMemoryPage.tsx — D217+ AI 학습 메모리 (Journey Builder 동급 8 화면)
 *
 * 설계서: docs/superpowers/specs/2026-05-25-ai-memory-usage-redesign-design.md § 2
 *
 * 8 화면:
 *   1. sticky 헤더 (Brain icon + BETA + 뒤로가기)
 *   2. AI 자율 진단 카드 (overview.top_insight 한 줄)
 *   3. 자연어 입력 + 빠른 시작 7 카드
 *   4. 5 메모리 타입 분포 도넛 차트
 *   5. 영향도 top 10 카드 view (TopImpactCard)
 *   6. 1-click 액션 3 카드 (정리 / 직접 추가 / 5 타입 가이드)
 *   7. 자세히 분석 토글 (4 차트 — 출처별 도넛 + 월별 누적 line + 중요도 분포 histogram + 누적 timeline)
 *   8. Source caption
 *
 * 영구 룰 정합:
 *   - native dialog 0건 — ConfirmModal + useToast 사용
 *   - 모델명 UI 노출 0건 — 추상 명칭 ("AI 모델" 등) 사용
 *   - 마케팅 담당자 UX — 한 클릭 = 즉시 AI 답변 모달
 *   - 박-단어 0건 자가 grep 의무
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Brain, BookOpen, ChevronDown, ChevronUp, Loader2, Plus, RefreshCw, Sparkles,
  Send, Trash2, TrendingUp, X, MessageSquare, Snowflake, Layers, Palette, ShieldCheck, Database,
  Activity, Clock, BarChart3, Info,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import TopImpactCard, { TopImpactMemory, MemoryType } from '../components/AiMemory/TopImpactCard';
import MemoryTypeGuideModal from '../components/AiMemory/MemoryTypeGuideModal';
import AddMemoryModal, { NewMemoryInput } from '../components/AiMemory/AddMemoryModal';
// ★ D225+ Brand Voice Learning (2026-05-28 Harold 명시)
import BrandVoiceCard from '../components/AiMemory/BrandVoiceCard';

// ════════════════════════════════════════════════════════════════════
// 타입
// ════════════════════════════════════════════════════════════════════

interface OverviewResponse {
  success: boolean;
  total_memories: number;
  last_learned_at: string | null;
  days_since_last_learning: number | null;
  avg_importance: number | null;
  top_impact: TopImpactMemory | null;
  type_distribution: Record<MemoryType, number>;
  top_type: MemoryType | null;
  recent_30d_added: number;
  top_insight: string;
}

interface DetailedMemory {
  id: string;
  memoryType: MemoryType;
  memoryKey: string;
  memoryValue: string;
  importance: number;
  source: string;
  usageCount?: number;
  lastAccessedAt: string;
  createdAt: string;
}

interface SearchResponse {
  success: boolean;
  answer: string;
  related_memories: DetailedMemory[];
  no_data: boolean;
}

// ════════════════════════════════════════════════════════════════════
// 상수 — 5 타입 메타
// ════════════════════════════════════════════════════════════════════

const TYPE_META: Record<string, { label: string; color: string; gradient: string }> = {
  success_pattern:      { label: '성공 패턴',         color: '#34d399', gradient: 'from-emerald-400 to-teal-500' },
  channel_performance:  { label: '채널 성과',         color: '#fbbf24', gradient: 'from-amber-400 to-orange-500' },
  customer_insight:     { label: '고객 인사이트',     color: '#38bdf8', gradient: 'from-sky-400 to-cyan-500' },
  brand_tone_evolution: { label: '브랜드 톤',         color: '#a78bfa', gradient: 'from-violet-400 to-purple-500' },
  compliance_learning:  { label: '컴플라이언스 학습', color: '#fb7185', gradient: 'from-rose-400 to-pink-500' },
};

// ★ D227+ defense-in-depth — 미지의 memory_type이 와도 전체 화면 blank(크래시) 차단
const FALLBACK_TYPE_META = { label: '학습', color: '#94a3b8', gradient: 'from-slate-400 to-slate-500' };

const TYPE_ORDER: MemoryType[] = [
  'success_pattern',
  'channel_performance',
  'customer_insight',
  'brand_tone_evolution',
  'compliance_learning',
];

// ════════════════════════════════════════════════════════════════════
// 상수 — 빠른 시작 7 카드
// ════════════════════════════════════════════════════════════════════

interface QuickStartCard {
  id: string;
  icon: typeof MessageSquare;
  label: string;
  hint: string;
  gradient: string;
  query?: string;            // 자연어 검색 자동 호출
  action?: 'add' | 'guide' | 'cleanup';  // 모달/액션 직접 호출
}

const QUICK_START_CARDS: QuickStartCard[] = [
  {
    id: 'vip',
    icon: TrendingUp,
    label: 'VIP 패턴 분석',
    hint: 'VIP 고객 가장 강한 채널·시점',
    gradient: 'from-violet-400 to-purple-500',
    query: 'VIP 등급 고객에게 가장 클릭률이 높았던 채널과 시점은 무엇인가요? 메모리에서 근거를 찾아 답변해주세요.',
  },
  {
    id: 'dormant',
    icon: Snowflake,
    label: '휴면 회수 인사이트',
    hint: '90일+ 휴면 고객 반응 톤',
    gradient: 'from-rose-400 to-pink-500',
    query: '90일 이상 휴면 고객에게 가장 응답률이 높았던 메시지 톤과 혜택 유형은 무엇인가요? 메모리 근거를 찾아 답변해주세요.',
  },
  {
    id: 'channel',
    icon: Layers,
    label: '채널 성과 비교',
    hint: 'SMS · LMS · 알림톡 전환율',
    gradient: 'from-sky-400 to-cyan-500',
    query: 'SMS, LMS, 알림톡 채널별 클릭률과 전환율 차이를 메모리에서 요약해주세요.',
  },
  {
    id: 'tone',
    icon: Palette,
    label: '브랜드 톤 진화',
    hint: '최근 6개월 톤 변화 트렌드',
    gradient: 'from-fuchsia-400 to-pink-500',
    query: '최근 6개월간 브랜드 톤이 어떻게 변화했는지 메모리에서 추출해 요약해주세요.',
  },
  {
    id: 'compliance',
    icon: ShieldCheck,
    label: '컴플라이언스 학습',
    hint: '광고 차단 단어 + 대체 매핑',
    gradient: 'from-amber-400 to-orange-500',
    query: '광고 차단 또는 카카오 반려된 단어와 안전한 대체 단어 매핑을 메모리에서 정리해주세요.',
  },
  {
    id: 'add',
    icon: Plus,
    label: '직접 학습 추가',
    hint: '회사 admin 직접 입력',
    gradient: 'from-emerald-400 to-teal-500',
    action: 'add',
  },
  {
    id: 'cleanup',
    icon: Trash2,
    label: '오래된 학습 정리',
    hint: '90일+ 미사용 자동 삭제',
    gradient: 'from-indigo-400 to-violet-500',
    action: 'cleanup',
  },
];

// ════════════════════════════════════════════════════════════════════
// 도넛 차트 SVG path 생성
// ════════════════════════════════════════════════════════════════════

interface DonutSegment {
  type: MemoryType;
  count: number;
  percent: number;
  pathD: string;
  color: string;
  label: string;
}

function buildDonut(distribution: Record<MemoryType, number>, total: number, radius = 70, inner = 45): DonutSegment[] {
  if (total === 0) return [];
  let startAngle = -Math.PI / 2;
  const segs: DonutSegment[] = [];
  for (const type of TYPE_ORDER) {
    const count = distribution[type] || 0;
    if (count === 0) continue;
    const percent = count / total;
    const angle = percent * Math.PI * 2;
    const endAngle = startAngle + angle;
    const largeArc = angle > Math.PI ? 1 : 0;
    const x1 = 100 + radius * Math.cos(startAngle);
    const y1 = 100 + radius * Math.sin(startAngle);
    const x2 = 100 + radius * Math.cos(endAngle);
    const y2 = 100 + radius * Math.sin(endAngle);
    const ix1 = 100 + inner * Math.cos(endAngle);
    const iy1 = 100 + inner * Math.sin(endAngle);
    const ix2 = 100 + inner * Math.cos(startAngle);
    const iy2 = 100 + inner * Math.sin(startAngle);
    const pathD = [
      `M ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${inner} ${inner} 0 ${largeArc} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ');
    segs.push({
      type,
      count,
      percent,
      pathD,
      color: TYPE_META[type].color,
      label: TYPE_META[type].label,
    });
    startAngle = endAngle;
  }
  return segs;
}

// ════════════════════════════════════════════════════════════════════
// 메인 페이지
// ════════════════════════════════════════════════════════════════════

export default function AiMemoryPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.userType === 'company_admin';
  const toast = useToast();

  // ── 데이터 state
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [topImpact, setTopImpact] = useState<TopImpactMemory[]>([]);
  const [allMemories, setAllMemories] = useState<DetailedMemory[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [topLoading, setTopLoading] = useState(true);
  const [allLoading, setAllLoading] = useState(false);
  const [migrationPending, setMigrationPending] = useState<string | null>(null);

  // ── 자연어 검색 state
  const [naturalQuery, setNaturalQuery] = useState('');
  const [naturalLoading, setNaturalLoading] = useState(false);
  const [naturalResult, setNaturalResult] = useState<{ query: string; answer: string; related: DetailedMemory[]; noData: boolean } | null>(null);

  // ── 모달 state
  const [showAddModal, setShowAddModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showDetailedAnalysis, setShowDetailedAnalysis] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const queryInputRef = useRef<HTMLInputElement>(null);

  const token = () => localStorage.getItem('token');
  const authHeader = () => ({ Authorization: `Bearer ${token()}` });

  // ── 데이터 로드
  const loadOverview = async () => {
    setOverviewLoading(true);
    try {
      const r = await fetch('/api/ai-memory/overview', { headers: authHeader() });
      const data = await r.json();
      if (data.success) {
        setOverview(data);
        setMigrationPending(null);
      } else if (data.code === 'DB_MIGRATION_PENDING') {
        setMigrationPending(data.error || 'DB 마이그레이션이 필요합니다.');
      } else {
        toast.error(`요약 조회 실패 — ${data.error || '알 수 없는 오류'}`);
      }
    } catch (e: any) {
      toast.error(`요약 조회 실패 — ${e?.message || '네트워크 오류'}`);
    } finally {
      setOverviewLoading(false);
    }
  };

  const loadTopImpact = async () => {
    setTopLoading(true);
    try {
      const r = await fetch('/api/ai-memory/top-impact?limit=10', { headers: authHeader() });
      const data = await r.json();
      if (data.success) {
        setTopImpact(data.memories || []);
      } else if (data.code === 'DB_MIGRATION_PENDING') {
        setMigrationPending(data.error || 'DB 마이그레이션이 필요합니다.');
      }
    } catch (e: any) {
      console.warn('top-impact 조회 실패:', e?.message);
    } finally {
      setTopLoading(false);
    }
  };

  const loadAllForAnalysis = async () => {
    if (allMemories.length > 0) return;
    setAllLoading(true);
    try {
      const r = await fetch('/api/ai/operator/memory?limit=200', { headers: authHeader() });
      const data = await r.json();
      if (data.success) {
        setAllMemories(data.memories || []);
      }
    } catch (e: any) {
      console.warn('전체 메모리 조회 실패:', e?.message);
    } finally {
      setAllLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
    loadTopImpact();
  }, []);

  useEffect(() => {
    if (showDetailedAnalysis) loadAllForAnalysis();
  }, [showDetailedAnalysis]);

  const reloadAll = async () => {
    setNaturalResult(null);
    setAllMemories([]);
    await Promise.all([loadOverview(), loadTopImpact()]);
    if (showDetailedAnalysis) await loadAllForAnalysis();
  };

  // ── 자연어 검색 호출
  const runNaturalSearch = async (q: string) => {
    const query = q.trim();
    if (query.length < 2) {
      toast.warning('질문을 2자 이상 입력해주세요.');
      return;
    }
    setNaturalLoading(true);
    setNaturalResult({ query, answer: '', related: [], noData: false });
    try {
      const r = await fetch('/api/ai-memory/search-natural', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ query }),
      });
      const data: SearchResponse & { error?: string; code?: string } = await r.json();
      if (data.success) {
        setNaturalResult({
          query,
          answer: data.answer,
          related: data.related_memories || [],
          noData: data.no_data,
        });
      } else if (data.code === 'AI_RATE_LIMIT') {
        toast.warning(`AI 호출 한도 초과 — ${data.error || '이번 달 한도를 초과했습니다.'}`);
        setNaturalResult(null);
      } else {
        toast.error(`검색 실패 — ${data.error || '알 수 없는 오류'}`);
        setNaturalResult(null);
      }
    } catch (e: any) {
      toast.error(`검색 실패 — ${e?.message || '네트워크 오류'}`);
      setNaturalResult(null);
    } finally {
      setNaturalLoading(false);
    }
  };

  // ── 빠른 시작 카드 클릭 — 1 단계 (즉시 AI 호출 / 즉시 모달 / 즉시 정리 확인)
  const handleQuickStart = (card: QuickStartCard) => {
    if (card.action === 'add') {
      if (!isAdmin) {
        toast.warning('직접 학습 추가는 회사 관리자만 가능합니다.');
        return;
      }
      setShowAddModal(true);
      return;
    }
    if (card.action === 'cleanup') {
      handleCleanupRequest();
      return;
    }
    if (card.action === 'guide') {
      setShowGuideModal(true);
      return;
    }
    if (card.query) {
      setNaturalQuery(card.query);
      void runNaturalSearch(card.query);
    }
  };

  // ── 직접 학습 저장
  const handleAddMemory = async (input: NewMemoryInput) => {
    const r = await fetch('/api/ai/operator/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        memory_type: input.memoryType,
        memory_key: input.memoryKey,
        memory_value: input.memoryValue,
        importance: input.importance,
        source: 'admin_input',
      }),
    });
    const data = await r.json();
    if (!data.success) {
      throw new Error(data.error || '저장 실패');
    }
    setShowAddModal(false);
    toast.success(`학습 추가 완료 — 중요도 ${input.importance}로 저장되었습니다. AI가 다음 호출부터 우선 참고합니다.`);
    await reloadAll();
  };

  // ── 정리 (90일+ 미사용 + 중요도 3 미만)
  const handleCleanupRequest = () => {
    if (!isAdmin) {
      toast.warning('학습 정리는 회사 관리자만 가능합니다.');
      return;
    }
    setConfirmState({
      mode: 'warning',
      title: '오래된 학습 자동 정리',
      description: '중요도 3 미만 + 90일 이상 미사용 학습을 일괄 삭제합니다.\n· 자동 누적된 저영향도 학습만 정리\n· 직접 입력 학습 + 중요도 3 이상 학습은 보존\n\n진행하시겠습니까?',
      confirmLabel: '정리 진행',
      cancelLabel: '취소',
      onConfirm: async () => {
        try {
          const r = await fetch('/api/ai/operator/memory/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader() },
            body: JSON.stringify({ olderThanDays: 90, minImportance: 3 }),
          });
          const data = await r.json();
          if (data.success) {
            toast.success(`정리 완료 — ${data.deletedCount}건이 삭제되었습니다.`);
            await reloadAll();
          } else {
            toast.error(`정리 실패 — ${data.error || '알 수 없는 오류'}`);
          }
        } catch (e: any) {
          toast.error(`정리 실패 — ${e?.message || '네트워크 오류'}`);
        }
        setConfirmState(null);
      },
    });
  };

  // ── top-impact 카드 삭제
  const handleDeleteTopImpact = (id: string) => {
    if (!isAdmin) {
      toast.warning('학습 삭제는 회사 관리자만 가능합니다.');
      return;
    }
    setConfirmState({
      mode: 'danger',
      title: '학습 메모리 삭제',
      description: '이 학습을 삭제하면 AI가 더 이상 이 패턴을 참고하지 않습니다. 진행하시겠습니까?',
      confirmLabel: '삭제',
      cancelLabel: '취소',
      onConfirm: async () => {
        try {
          const r = await fetch(`/api/ai/operator/memory/${id}`, { method: 'DELETE', headers: authHeader() });
          const data = await r.json();
          if (data.success) {
            toast.success('학습이 삭제되었습니다.');
            await reloadAll();
          } else {
            toast.error(`삭제 실패 — ${data.error || '알 수 없는 오류'}`);
          }
        } catch (e: any) {
          toast.error(`삭제 실패 — ${e?.message || '네트워크 오류'}`);
        }
        setConfirmState(null);
      },
    });
  };

  // ── 도넛 segments
  const donutSegments = useMemo(() => {
    if (!overview) return [];
    return buildDonut(overview.type_distribution, overview.total_memories);
  }, [overview]);

  // ── 자세히 분석 계산 (allMemories 기반)
  const detailedStats = useMemo(() => {
    if (allMemories.length === 0) return null;

    const sourceDist: Record<string, number> = {};
    const importanceHist: number[] = new Array(10).fill(0);
    const monthlyAdd: Record<string, number> = {};

    for (const m of allMemories) {
      sourceDist[m.source] = (sourceDist[m.source] || 0) + 1;
      const imp = Math.max(1, Math.min(10, m.importance));
      importanceHist[imp - 1] += 1;
      const created = new Date(m.createdAt);
      const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
      monthlyAdd[monthKey] = (monthlyAdd[monthKey] || 0) + 1;
    }

    const sourceArr = Object.entries(sourceDist)
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    const months = Object.keys(monthlyAdd).sort().slice(-6);
    const monthlyArr = months.map((m) => ({ month: m, count: monthlyAdd[m] }));

    const sourceTotal = sourceArr.reduce((s, x) => s + x.count, 0);
    const sourceColors: Record<string, string> = {
      campaign_result: '#34d399',
      ai_auto: '#a78bfa',
      admin_input: '#38bdf8',
      mysql_refund_sweeper: '#fbbf24',
    };
    let startAngle = -Math.PI / 2;
    const sourceSegs = sourceArr.map((s) => {
      const percent = s.count / sourceTotal;
      const angle = percent * Math.PI * 2;
      const endAngle = startAngle + angle;
      const largeArc = angle > Math.PI ? 1 : 0;
      const r = 60;
      const ir = 38;
      const x1 = 100 + r * Math.cos(startAngle);
      const y1 = 100 + r * Math.sin(startAngle);
      const x2 = 100 + r * Math.cos(endAngle);
      const y2 = 100 + r * Math.sin(endAngle);
      const ix1 = 100 + ir * Math.cos(endAngle);
      const iy1 = 100 + ir * Math.sin(endAngle);
      const ix2 = 100 + ir * Math.cos(startAngle);
      const iy2 = 100 + ir * Math.sin(startAngle);
      const pathD = [
        `M ${x1} ${y1}`,
        `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${ix1} ${iy1}`,
        `A ${ir} ${ir} 0 ${largeArc} 0 ${ix2} ${iy2}`,
        'Z',
      ].join(' ');
      startAngle = endAngle;
      return {
        source: s.source,
        count: s.count,
        percent,
        pathD,
        color: sourceColors[s.source] || '#94a3b8',
      };
    });

    const recentTimeline = [...allMemories]
      .sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime())
      .slice(0, 8);

    return {
      sourceSegs,
      sourceTotal,
      importanceHist,
      monthlyArr,
      recentTimeline,
    };
  }, [allMemories]);

  // ════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════

  return (
    // ★ D222+ Phase 3 (2026-05-27): 다크 → 보라 그라데이션 톤 다운
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      {/* ───────── 1. sticky 헤더 — D222+ Phase 3 보라 톤 다운 ───────── */}
      <div className="bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors" aria-label="AI Operator로 돌아가기">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/20">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">AI 학습 메모리</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5 hidden md:block">회사별 누적 학습 — 시간이 지날수록 AI 추천 정확도가 향상됩니다</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={reloadAll}
              className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
              aria-label="새로고침"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${overviewLoading || topLoading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">새로고침</span>
            </button>
            <button
              onClick={() => setShowGuideModal(true)}
              className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors"
              aria-label="가이드"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span className="hidden md:inline">가이드</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-6">
        {/* ───────── DB 마이그레이션 안내 ───────── */}
        {migrationPending && (
          <div className="p-4 bg-amber-500/10 border border-amber-400/30 rounded-xl flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-100 mb-1">DB 마이그레이션 대기 중</div>
              <div className="text-xs text-white/70 leading-relaxed">{migrationPending}</div>
            </div>
          </div>
        )}

        {/* ───────── ★ D225+ Brand Voice Learning — 회사별 LMS 대표 문안 5건 + AI 자동 가이드라인 ───────── */}
        <BrandVoiceCard
          apiBase=""
          token={token() || ''}
          onToast={(msg, type) => {
            if (type === 'success') toast.success(msg);
            else if (type === 'error') toast.error(msg);
            else toast.info(msg);
          }}
          onConfirm={(opts) => setConfirmState({
            title: opts.title,
            description: opts.description,
            confirmLabel: opts.confirmLabel,
            cancelLabel: opts.cancelLabel,
            onConfirm: opts.onConfirm,
          })}
        />

        {/* ───────── 2. AI 자율 진단 카드 ───────── */}
        <div className="p-5 bg-gradient-to-br from-violet-500/20 via-fuchsia-500/15 to-pink-500/20 border border-violet-400/30 rounded-2xl">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-400 to-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-500/30">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-base font-bold text-white">AI 자율 진단</h2>
                <span className="text-[10px] bg-violet-500/30 text-violet-100 px-2 py-0.5 rounded-full font-medium">실시간</span>
              </div>
              {overviewLoading ? (
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  학습 데이터 분석 중...
                </div>
              ) : overview ? (
                <p className="text-sm text-white/90 leading-relaxed">{overview.top_insight}</p>
              ) : (
                <p className="text-sm text-white/50">진단 정보를 불러올 수 없습니다.</p>
              )}
              {overview && overview.total_memories > 0 && (
                <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
                  <span className="text-white/60">
                    누적 학습 <strong className="text-white">{overview.total_memories.toLocaleString()}건</strong>
                  </span>
                  <span className="text-white/60">
                    최근 30일 <strong className="text-emerald-300">+{overview.recent_30d_added.toLocaleString()}건</strong>
                  </span>
                  {overview.days_since_last_learning !== null && (
                    <span className="text-white/60">
                      마지막 학습 <strong className="text-white">
                        {overview.days_since_last_learning === 0 ? '오늘' : `${overview.days_since_last_learning}일 전`}
                      </strong>
                    </span>
                  )}
                  {overview.avg_importance !== null && (
                    <span className="text-white/60">
                      평균 중요도 <strong className="text-white">{overview.avg_importance.toFixed(1)}/10</strong>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="text-[10px] text-white/30 italic mt-3 pl-15">
            Data source — ai_company_memory 5 타입 누적 + 자동 학습 (캠페인 종료 시) + 회사 admin 직접 입력
          </div>
        </div>

        {/* ───────── 3. 자연어 입력 + 빠른 시작 7 카드 ───────── */}
        <div className="space-y-3">
          <div className="p-4 bg-gradient-to-br from-fuchsia-500/15 via-purple-500/10 to-indigo-500/15 border border-fuchsia-400/30 rounded-2xl">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-fuchsia-300" />
              <span className="text-sm font-semibold text-white">자연어로 학습 메모리에 질문하기</span>
            </div>
            <p className="text-[11px] text-white/60 mb-3">예: "지난 30일 VIP 영역에서 AI가 발견한 가장 강한 패턴은?" — Enter 키로 즉시 검색</p>
            <div className="flex gap-2">
              <input
                ref={queryInputRef}
                type="text"
                value={naturalQuery}
                onChange={(e) => setNaturalQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !naturalLoading) {
                    void runNaturalSearch(naturalQuery);
                  }
                }}
                placeholder="질문을 입력하고 Enter 키를 눌러주세요 (2~500자)"
                maxLength={500}
                disabled={naturalLoading}
                className="flex-1 px-4 py-2.5 bg-violet-900/50 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50 focus:ring-1 focus:ring-fuchsia-400/30 disabled:opacity-40"
              />
              <button
                onClick={() => runNaturalSearch(naturalQuery)}
                disabled={naturalLoading || naturalQuery.trim().length < 2}
                className="px-4 py-2.5 bg-gradient-to-r from-fuchsia-500 to-purple-500 hover:from-fuchsia-400 hover:to-purple-400 text-white text-sm rounded-lg font-medium disabled:opacity-40 flex items-center gap-1.5"
              >
                {naturalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                질문
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
            {QUICK_START_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  onClick={() => handleQuickStart(card)}
                  disabled={naturalLoading && !!card.query}
                  className="p-3 bg-white/5 border border-white/10 hover:bg-white/[0.08] hover:border-white/20 rounded-xl text-left transition-all group disabled:opacity-50"
                >
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${card.gradient} flex items-center justify-center mb-2 shadow-md group-hover:scale-110 transition-transform`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <div className="text-xs font-semibold text-white mb-0.5 truncate">{card.label}</div>
                  <div className="text-[10px] text-white/50 leading-snug line-clamp-2">{card.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ───────── 자연어 검색 결과 ───────── */}
        {naturalResult && (
          <div className="p-5 bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-purple-500/15 border border-indigo-400/30 rounded-2xl space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] text-white/40 mb-1">질문</div>
                <div className="text-sm text-white/90 italic">"{naturalResult.query}"</div>
              </div>
              <button onClick={() => setNaturalResult(null)} className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/10" aria-label="결과 닫기">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="pt-3 border-t border-white/10">
              <div className="text-[10px] text-violet-300 mb-1.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                AI 답변
              </div>
              {naturalLoading ? (
                <div className="flex items-center gap-2 text-sm text-white/60">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  학습 메모리를 분석하여 답변 생성 중...
                </div>
              ) : (
                <div className="text-sm text-white whitespace-pre-wrap leading-relaxed">{naturalResult.answer}</div>
              )}
            </div>
            {!naturalLoading && naturalResult.related.length > 0 && (
              <div className="pt-3 border-t border-white/10">
                <div className="text-[10px] text-white/40 mb-2">관련 학습 {naturalResult.related.length}건</div>
                <div className="space-y-1.5">
                  {naturalResult.related.map((m) => {
                    const meta = TYPE_META[m.memoryType] || FALLBACK_TYPE_META;
                    return (
                      <div key={m.id} className="p-2 bg-white/5 border border-white/10 rounded-lg flex items-start gap-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-gradient-to-r ${meta.gradient} text-white flex-shrink-0`}>
                          {meta.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-white truncate">{m.memoryKey}</div>
                          <div className="text-[11px] text-white/60 line-clamp-2">{m.memoryValue}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="text-[10px] text-white/30 italic">
              Data source — buildMemoryPromptContext (중요도 3 이상 최대 30건 + 시스템 프롬프트 포함)
            </div>
          </div>
        )}

        {/* ───────── 4. 5 메모리 타입 분포 도넛 ───────── */}
        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-violet-300" />
              <h3 className="text-sm font-semibold text-white">5 학습 타입 분포</h3>
            </div>
            {overview && (
              <span className="text-[11px] text-white/50">
                전체 <strong className="text-white">{overview.total_memories.toLocaleString()}건</strong>
              </span>
            )}
          </div>
          {overviewLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-white/40" />
            </div>
          ) : !overview || overview.total_memories === 0 ? (
            <div className="text-center py-10 text-white/40 text-sm">
              아직 학습 데이터가 없습니다.
              <br />
              <span className="text-xs">캠페인을 발송하시면 성공 패턴과 채널 성과가 자동 누적됩니다.</span>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-6 items-center">
              <div className="flex justify-center">
                <svg viewBox="0 0 200 200" className="w-48 h-48">
                  {donutSegments.map((seg) => (
                    <path
                      key={seg.type}
                      d={seg.pathD}
                      fill={seg.color}
                      className="hover:opacity-80 transition-opacity"
                    >
                      <title>{seg.label} — {seg.count}건 ({(seg.percent * 100).toFixed(1)}%)</title>
                    </path>
                  ))}
                  <text x="100" y="95" textAnchor="middle" className="fill-white" style={{ fontSize: '22px', fontWeight: 700 }}>
                    {overview.total_memories.toLocaleString()}
                  </text>
                  <text x="100" y="115" textAnchor="middle" className="fill-white/50" style={{ fontSize: '11px' }}>
                    누적 학습
                  </text>
                </svg>
              </div>
              <div className="space-y-2">
                {TYPE_ORDER.map((type) => {
                  const count = overview.type_distribution[type] || 0;
                  const percent = overview.total_memories > 0 ? (count / overview.total_memories) * 100 : 0;
                  const meta = TYPE_META[type];
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: meta.color }} />
                      <span className="text-sm text-white flex-1">{meta.label}</span>
                      <span className="text-xs text-white/60 font-mono">{count.toLocaleString()}</span>
                      <span className="text-xs text-white/40 font-mono w-12 text-right">{percent.toFixed(1)}%</span>
                      <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full" style={{ width: `${percent}%`, background: meta.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="text-[10px] text-white/30 italic mt-4">Data source — ai_company_memory.memory_type 5 카테고리 집계</div>
        </div>

        {/* ───────── 5. 영향도 top 10 카드 ───────── */}
        <div className="p-5 bg-white/5 border border-white/10 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-300" />
              <h3 className="text-sm font-semibold text-white">AI 가장 자주 참고하는 학습 Top 10</h3>
            </div>
            <span className="text-[11px] text-white/40">활용 횟수 + 중요도 내림차순</span>
          </div>
          {topLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-white/40" />
            </div>
          ) : topImpact.length === 0 ? (
            <div className="text-center py-10 text-white/40 text-sm">
              학습 데이터가 충분히 누적되면 여기에 표시됩니다.
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {topImpact.map((m, i) => (
                <TopImpactCard
                  key={m.id}
                  memory={m}
                  rank={i + 1}
                  canDelete={isAdmin}
                  onDelete={handleDeleteTopImpact}
                />
              ))}
            </div>
          )}
          <div className="text-[10px] text-white/30 italic mt-4">Data source — ai_company_memory ORDER BY usage_count DESC, importance DESC LIMIT 10</div>
        </div>

        {/* ───────── 6. 1-click 액션 3 카드 ───────── */}
        <div className="grid md:grid-cols-3 gap-3">
          <button
            onClick={() => handleQuickStart({ id: 'cleanup', icon: Trash2, label: '', hint: '', gradient: '', action: 'cleanup' })}
            disabled={!isAdmin}
            className="p-4 bg-gradient-to-br from-rose-500/15 to-pink-500/15 border border-rose-400/30 hover:border-rose-400/50 rounded-xl text-left transition-all group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <Trash2 className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm font-semibold text-white mb-1">오래된 학습 정리</div>
            <div className="text-[11px] text-white/60 leading-relaxed">
              90일+ 미사용 + 중요도 3 미만 학습을 일괄 삭제합니다.
            </div>
            {!isAdmin && <div className="text-[10px] text-rose-300 mt-1">회사 관리자 전용</div>}
          </button>

          <button
            onClick={() => handleQuickStart({ id: 'add', icon: Plus, label: '', hint: '', gradient: '', action: 'add' })}
            disabled={!isAdmin}
            className="p-4 bg-gradient-to-br from-emerald-500/15 to-teal-500/15 border border-emerald-400/30 hover:border-emerald-400/50 rounded-xl text-left transition-all group disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <Plus className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm font-semibold text-white mb-1">직접 학습 추가</div>
            <div className="text-[11px] text-white/60 leading-relaxed">
              회사 정책·고객 인사이트·톤 가이드를 직접 입력하여 AI에게 우선 참고시킵니다.
            </div>
            {!isAdmin && <div className="text-[10px] text-emerald-300 mt-1">회사 관리자 전용</div>}
          </button>

          <button
            onClick={() => setShowGuideModal(true)}
            className="p-4 bg-gradient-to-br from-amber-500/15 to-orange-500/15 border border-amber-400/30 hover:border-amber-400/50 rounded-xl text-left transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div className="text-sm font-semibold text-white mb-1">5 타입 가이드</div>
            <div className="text-[11px] text-white/60 leading-relaxed">
              자동 누적되는 학습과 직접 입력해야 하는 학습 — 예시 + 흐름 안내.
            </div>
          </button>
        </div>

        {/* ───────── 7. 자세히 분석 토글 ───────── */}
        <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <button
            onClick={() => setShowDetailedAnalysis((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/[0.03] transition-colors"
          >
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-300" />
              <span className="text-sm font-semibold text-white">자세히 분석</span>
              <span className="text-[10px] text-white/40">출처별 분포 · 월별 누적 · 중요도 분포 · 최근 활용</span>
            </div>
            {showDetailedAnalysis ? <ChevronUp className="w-4 h-4 text-white/50" /> : <ChevronDown className="w-4 h-4 text-white/50" />}
          </button>

          {showDetailedAnalysis && (
            <div className="px-5 pb-5 space-y-5 border-t border-white/5 pt-5">
              {allLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-white/40" />
                </div>
              ) : !detailedStats ? (
                <div className="text-center py-8 text-white/40 text-sm">분석할 학습 데이터가 없습니다.</div>
              ) : (
                <div className="grid md:grid-cols-2 gap-5">
                  {/* a. 출처별 도넛 */}
                  <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                    <div className="text-xs font-semibold text-white mb-3">출처별 분포</div>
                    <div className="flex items-center gap-4">
                      <svg viewBox="0 0 200 200" className="w-32 h-32">
                        {detailedStats.sourceSegs.map((s) => (
                          <path key={s.source} d={s.pathD} fill={s.color}>
                            <title>{s.source} — {s.count}건 ({(s.percent * 100).toFixed(1)}%)</title>
                          </path>
                        ))}
                        <text x="100" y="100" textAnchor="middle" dominantBaseline="middle" className="fill-white" style={{ fontSize: '18px', fontWeight: 700 }}>
                          {detailedStats.sourceTotal}
                        </text>
                      </svg>
                      <div className="flex-1 space-y-1">
                        {detailedStats.sourceSegs.map((s) => (
                          <div key={s.source} className="flex items-center gap-2 text-[11px]">
                            <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: s.color }} />
                            <span className="text-white/80 flex-1 truncate" title={s.source}>{s.source}</span>
                            <span className="text-white/60 font-mono">{s.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="text-[10px] text-white/30 italic mt-2">Data source — ai_company_memory.source 집계</div>
                  </div>

                  {/* b. 월별 누적 line */}
                  <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                    <div className="text-xs font-semibold text-white mb-3">월별 신규 학습 (최근 6개월)</div>
                    {detailedStats.monthlyArr.length === 0 ? (
                      <div className="text-center py-6 text-white/40 text-xs">데이터 부족</div>
                    ) : (
                      <div className="flex items-end gap-2 h-32">
                        {detailedStats.monthlyArr.map((m) => {
                          const max = Math.max(...detailedStats.monthlyArr.map((x) => x.count), 1);
                          const heightPercent = (m.count / max) * 100;
                          return (
                            <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                              <div className="flex-1 w-full flex items-end">
                                <div
                                  className="w-full bg-gradient-to-t from-violet-500 to-fuchsia-400 rounded-t-md transition-all hover:opacity-80"
                                  style={{ height: `${heightPercent}%`, minHeight: m.count > 0 ? '4px' : '0' }}
                                  title={`${m.month}: ${m.count}건`}
                                />
                              </div>
                              <div className="text-[9px] text-white/40">{m.month.slice(5)}</div>
                              <div className="text-[10px] text-white/70 font-mono">{m.count}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="text-[10px] text-white/30 italic mt-2">Data source — ai_company_memory.created_at 월별 집계</div>
                  </div>

                  {/* c. 중요도 histogram */}
                  <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                    <div className="text-xs font-semibold text-white mb-3">중요도 분포</div>
                    <div className="flex items-end gap-1 h-32">
                      {detailedStats.importanceHist.map((count, idx) => {
                        const max = Math.max(...detailedStats.importanceHist, 1);
                        const heightPercent = (count / max) * 100;
                        const impVal = idx + 1;
                        const color = impVal >= 8 ? '#34d399' : impVal >= 5 ? '#fbbf24' : '#64748b';
                        return (
                          <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                            <div className="flex-1 w-full flex items-end">
                              <div
                                className="w-full rounded-t-md transition-all hover:opacity-80"
                                style={{ height: `${heightPercent}%`, minHeight: count > 0 ? '4px' : '0', background: color }}
                                title={`중요도 ${impVal}: ${count}건`}
                              />
                            </div>
                            <div className="text-[9px] text-white/40">{impVal}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[10px] text-white/30 italic mt-2">Data source — ai_company_memory.importance 1~10 분포</div>
                  </div>

                  {/* d. 최근 활용 timeline */}
                  <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
                    <div className="text-xs font-semibold text-white mb-3 flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-cyan-300" />
                      최근 AI 참고 학습 (Top 8)
                    </div>
                    <div className="space-y-1.5 max-h-44 overflow-y-auto">
                      {detailedStats.recentTimeline.map((m) => {
                        const meta = TYPE_META[m.memoryType] || FALLBACK_TYPE_META;
                        const last = new Date(m.lastAccessedAt);
                        const daysAgo = Math.max(0, Math.floor((Date.now() - last.getTime()) / 86_400_000));
                        return (
                          <div key={m.id} className="flex items-start gap-2 text-[11px]">
                            <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: meta.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="text-white truncate">{m.memoryKey}</div>
                              <div className="text-white/40 text-[10px]">
                                {meta.label} · {daysAgo === 0 ? '오늘' : `${daysAgo}일 전`}
                                {m.usageCount ? ` · AI 활용 ${m.usageCount}회` : ''}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[10px] text-white/30 italic mt-2">Data source — ai_company_memory.last_accessed_at 내림차순</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ───────── 8. Source caption ───────── */}
        <div className="text-center text-[10px] text-white/30 italic pt-4">
          Data source — ai_company_memory (자동 학습: 캠페인 종료 시 클릭률 10%+ 자동 누적 / 채널 성과 누적) + 회사 admin 직접 입력
          <br />
          AI는 시스템 프롬프트에 중요도 3 이상 학습 최대 30건을 자동 포함합니다 — 시간이 지날수록 추천 정확도가 향상됩니다
        </div>
      </div>

      {/* ───────── 모달 ───────── */}
      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
      <MemoryTypeGuideModal open={showGuideModal} onClose={() => setShowGuideModal(false)} />
      <AddMemoryModal open={showAddModal} onClose={() => setShowAddModal(false)} onSave={handleAddMemory} />
    </div>
  );
}
