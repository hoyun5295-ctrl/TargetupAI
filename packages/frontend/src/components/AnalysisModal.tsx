import { useEffect, useRef, useState } from 'react';
import {
  BarChart3, Calendar, ChevronDown, ChevronUp, Crown, Download,
  FileText, Lock, Rocket, Sparkles, TrendingUp, Users, X,
  Activity, Target, ShieldAlert, PieChart, Zap, ArrowUpRight
} from 'lucide-react';

/* ─────────────────── Types ─────────────────── */

interface Props {
  show: boolean;
  onClose: () => void;
  analysisLevel: string; // 'none' | 'basic' | 'advanced'
}

interface TeaserData {
  totalCampaigns: number;
  totalSent: number;
  avgSuccessRate: number;
  totalCustomers: number;
  bestTimeSlot: string;
  bestDayOfWeek: string;
  topCampaignName: string;
  unsubscribeCount30d: number;
  churnRiskCount: number;
  segmentCount: number;
  estimatedROI: string;
}

interface InsightCard {
  id: string;
  category: string;
  title: string;
  summary: string;
  details: string;
  level: string;
  data: any;
}

interface AnalysisResult {
  analysisId: string;
  level: string;
  generatedAt: string;
  insights: InsightCard[];
}

/* ─────────────────── Constants ─────────────────── */

const LOADING_STEPS = [
  { icon: '📊', text: '데이터 수집 중...' },
  { icon: '🔍', text: '패턴 분석 중...' },
  { icon: '✨', text: '인사이트 생성 중...' },
  { icon: '📝', text: '보고서 작성 중...' },
];

const INSIGHT_ICONS: Record<string, React.ReactNode> = {
  'campaign': <BarChart3 size={18} />,
  'time': <Calendar size={18} />,
  'customer': <Users size={18} />,
  'unsubscribe': <ShieldAlert size={18} />,
  'summary': <FileText size={18} />,
  'segment': <PieChart size={18} />,
  'churn': <Activity size={18} />,
  'comparison': <TrendingUp size={18} />,
  'conversion': <Zap size={18} />,
  'action': <Target size={18} />,
};

const INSIGHT_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  'campaign': { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'text-blue-600' },
  'time': { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'text-amber-600' },
  'customer': { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-600' },
  'unsubscribe': { bg: 'bg-red-50', border: 'border-red-200', icon: 'text-red-600' },
  'summary': { bg: 'bg-purple-50', border: 'border-purple-200', icon: 'text-purple-600' },
  'segment': { bg: 'bg-indigo-50', border: 'border-indigo-200', icon: 'text-indigo-600' },
  'churn': { bg: 'bg-orange-50', border: 'border-orange-200', icon: 'text-orange-600' },
  'comparison': { bg: 'bg-cyan-50', border: 'border-cyan-200', icon: 'text-cyan-600' },
  'conversion': { bg: 'bg-teal-50', border: 'border-teal-200', icon: 'text-teal-600' },
  'action': { bg: 'bg-pink-50', border: 'border-pink-200', icon: 'text-pink-600' },
};

const DEFAULT_COLOR = { bg: 'bg-gray-50', border: 'border-gray-200', icon: 'text-gray-600' };

/* ─────────────────── Component ─────────────────── */

export default function AnalysisModal({ show, onClose, analysisLevel }: Props) {
  const [loading, setLoading] = useState(true);
  const [teaser, setTeaser] = useState<TeaserData | null>(null);
  const [period, setPeriod] = useState<'30d' | '90d' | 'custom'>('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [running, setRunning] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const stepInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // 모달 열릴 때 preview fetch
  useEffect(() => {
    if (show) {
      setResult(null);
      setError(null);
      setExpandedCard(null);
      setPeriod('30d');
      fetchPreview();
    }
    return () => {
      if (stepInterval.current) clearInterval(stepInterval.current);
    };
  }, [show]);

  const getToken = () => localStorage.getItem('token');

  const fetchPreview = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/analysis/preview', {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTeaser(data.teaser);
      }
    } catch (err) {
      console.error('Preview fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async () => {
    if (period === 'custom' && (!customStart || !customEnd)) {
      setError('분석 기간을 설정해주세요.');
      return;
    }
    setRunning(true);
    setLoadingStep(0);
    setError(null);
    setResult(null);

    stepInterval.current = setInterval(() => {
      setLoadingStep(prev => Math.min(prev + 1, 3));
    }, 2500);

    try {
      const body: any = { period };
      if (period === 'custom') {
        body.startDate = customStart;
        body.endDate = customEnd;
      }
      const res = await fetch('/api/analysis/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      } else if (res.status === 403) {
        setError('이 기능은 프로 요금제 이상에서 사용 가능합니다.');
      } else {
        const errData = await res.json().catch(() => null);
        setError(errData?.error || '분석 실행에 실패했습니다.');
      }
    } catch (err) {
      setError('분석 실행 중 오류가 발생했습니다.');
    } finally {
      if (stepInterval.current) clearInterval(stepInterval.current);
      stepInterval.current = null;
      setRunning(false);
    }
  };

  const downloadPdf = async () => {
    if (!result?.analysisId) return;
    setPdfLoading(true);
    try {
      const res = await fetch(`/api/analysis/pdf?analysisId=${result.analysisId}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `한줄로_AI분석_${new Date().toISOString().slice(0, 10)}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        setError('PDF 다운로드에 실패했습니다.');
      }
    } catch {
      setError('PDF 다운로드 중 오류가 발생했습니다.');
    } finally {
      setPdfLoading(false);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[70]" onClick={onClose}>
      <style>{`
        @keyframes analysisModalIn {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes analysisFadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes analysisPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes analysisShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      <div
        className="bg-white rounded-2xl shadow-2xl w-[900px] max-h-[85vh] overflow-hidden flex flex-col"
        style={{ animation: 'analysisModalIn 0.3s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ────── 헤더 ────── */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-900 to-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <Sparkles size={18} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">AI 마케팅 분석</h2>
              <p className="text-xs text-gray-400">
                {analysisLevel === 'none' ? '프로 요금제에서 AI 분석을 시작하세요' :
                 analysisLevel === 'basic' ? '프로 · AI 성과 분석' : '비즈니스 · AI 심층 분석'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition p-1 rounded-lg hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        {/* ────── 바디 ────── */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="w-10 h-10 border-3 border-gray-200 border-t-amber-500 rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-400">데이터를 불러오는 중...</p>
            </div>
          ) : analysisLevel === 'none' ? (
            <PreviewSection teaser={teaser} />
          ) : (
            <RunnerSection
              analysisLevel={analysisLevel}
              teaser={teaser}
              period={period}
              setPeriod={setPeriod}
              customStart={customStart}
              setCustomStart={setCustomStart}
              customEnd={customEnd}
              setCustomEnd={setCustomEnd}
              running={running}
              loadingStep={loadingStep}
              result={result}
              error={error}
              expandedCard={expandedCard}
              setExpandedCard={setExpandedCard}
              pdfLoading={pdfLoading}
              onRun={runAnalysis}
              onDownloadPdf={downloadPdf}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   베이직 프리뷰 (analysisLevel === 'none')
   ═══════════════════════════════════════════════════ */

function PreviewSection({ teaser }: { teaser: TeaserData | null }) {
  return (
    <div>
      {/* 섹션 1: 실제 데이터 요약 */}
      <div className="mb-8" style={{ animation: 'analysisFadeUp 0.4s ease-out' }}>
        <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
          <Rocket size={14} />
          내 데이터 요약
        </h3>
        <div className="grid grid-cols-4 gap-3">
          <StatCard icon={<BarChart3 size={16} />} label="지난 30일 캠페인" value={teaser?.totalCampaigns ?? 0} suffix="건" color="blue" />
          <StatCard icon={<ArrowUpRight size={16} />} label="총 발송" value={teaser?.totalSent ?? 0} suffix="건" color="emerald" />
          <StatCard icon={<TrendingUp size={16} />} label="평균 성공률" value={teaser?.avgSuccessRate ?? 0} suffix="%" color="amber" isPercent />
          <StatCard icon={<Users size={16} />} label="전체 고객" value={teaser?.totalCustomers ?? 0} suffix="명" color="purple" />
        </div>
        <p className="text-xs text-gray-400 mt-2 text-center">실제 데이터 기반으로 산출된 수치입니다</p>
      </div>

      {/* 섹션 2: 프로에서 확인 가능 (블러) */}
      <div className="mb-8" style={{ animation: 'analysisFadeUp 0.5s ease-out' }}>
        <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
          <Lock size={14} />
          프로에서 확인 가능
        </h3>
        <div className="relative rounded-xl border border-gray-200 bg-gray-50/50 p-5 overflow-hidden">
          {/* 블러 오버레이 */}
          <div className="absolute inset-0 bg-white/40 backdrop-blur-sm z-10 flex items-center justify-center">
            <div className="bg-white/90 rounded-xl px-5 py-3 shadow-lg flex items-center gap-2 border border-amber-200">
              <Lock size={14} className="text-amber-600" />
              <span className="text-sm font-medium text-gray-700">프로 요금제에서 확인 가능</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 select-none" style={{ filter: 'blur(6px)' }}>
            <BlurredItem label="최적 발송 시간대" value="화요일 오전 10시" />
            <BlurredItem label="최고 성과 요일" value="화요일" />
            <BlurredItem label="TOP 캠페인" value="봄 신상품 안내" />
            <BlurredItem label="수신거부 추이 (30일)" value="23건 (-12%)" />
          </div>
        </div>
      </div>

      {/* AI 분석 예시 텍스트 (페이드아웃) */}
      <div className="mb-8" style={{ animation: 'analysisFadeUp 0.6s ease-out' }}>
        <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
          <Sparkles size={14} />
          AI 인사이트 미리보기
        </h3>
        <div className="relative rounded-xl border border-gray-200 bg-gradient-to-b from-white to-gray-50 p-5 overflow-hidden">
          <div
            className="text-sm text-gray-600 leading-relaxed space-y-2 select-none"
            style={{
              WebkitMaskImage: 'linear-gradient(to bottom, black 30%, transparent 100%)',
              maskImage: 'linear-gradient(to bottom, black 30%, transparent 100%)',
            }}
          >
            <p>지난달 대비 성공률이 <span className="font-semibold text-emerald-600">+3.2%</span> 개선되었습니다.</p>
            <p>화요일 오전 10시 발송이 가장 효과적이며, 금요일 오후 발송은 성공률이 낮은 편입니다.</p>
            <p>VIP 고객 대상 캠페인의 반응률이 일반 고객 대비 2.4배 높으며, 특히 40대 여성 고객의 참여도가 두드러집니다. 맞춤형 세그먼트 전략을 통해...</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-gray-50 to-transparent z-10" />
        </div>
      </div>

      {/* 섹션 3: 비즈니스 전용 (강한 블러) */}
      <div className="mb-8" style={{ animation: 'analysisFadeUp 0.7s ease-out' }}>
        <h3 className="text-sm font-semibold text-gray-500 mb-3 flex items-center gap-2">
          <Crown size={14} />
          비즈니스에서 추가 제공
        </h3>
        <div className="relative rounded-xl border border-gray-200 bg-gray-50/50 p-5 overflow-hidden">
          <div className="absolute inset-0 bg-white/50 backdrop-blur-md z-10 flex items-center justify-center">
            <div className="bg-white/90 rounded-xl px-5 py-3 shadow-lg flex items-center gap-2 border border-purple-200">
              <Crown size={14} className="text-purple-600" />
              <span className="text-sm font-medium text-gray-700">비즈니스 요금제 전용</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 select-none" style={{ filter: 'blur(10px)' }}>
            <BlurredItem label="고객 세그먼트 자동 분류" value="4개 그룹" />
            <BlurredItem label="이탈 위험 고객" value="156명 탐지" />
            <BlurredItem label="캠페인별 ROI 추정" value="320%" />
            <BlurredItem label="맞춤 액션 플랜" value="3건 제안" />
          </div>
        </div>
      </div>

      {/* CTA */}
      <div
        className="rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 p-6 text-center"
        style={{ animation: 'analysisFadeUp 0.8s ease-out' }}
      >
        <div className="flex items-center justify-center gap-2 mb-2">
          <Crown size={20} className="text-amber-600" />
          <h3 className="text-lg font-bold text-gray-800">프로 요금제로 업그레이드</h3>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          월 100만원으로 AI가 분석하는 마케팅 인사이트를 받아보세요
        </p>
        <div className="flex items-center justify-center gap-3">
          <button className="px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-amber-200 transition-all duration-200 hover:shadow-xl hover:shadow-amber-300 hover:-translate-y-0.5">
            요금제 안내 보기
          </button>
          <button className="px-6 py-2.5 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-xl text-sm font-medium transition">
            업그레이드 신청
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   프로/비즈니스 분석 실행 (basic / advanced)
   ═══════════════════════════════════════════════════ */

interface RunnerProps {
  analysisLevel: string;
  teaser: TeaserData | null;
  period: '30d' | '90d' | 'custom';
  setPeriod: (p: '30d' | '90d' | 'custom') => void;
  customStart: string;
  setCustomStart: (v: string) => void;
  customEnd: string;
  setCustomEnd: (v: string) => void;
  running: boolean;
  loadingStep: number;
  result: AnalysisResult | null;
  error: string | null;
  expandedCard: string | null;
  setExpandedCard: (id: string | null) => void;
  pdfLoading: boolean;
  onRun: () => void;
  onDownloadPdf: () => void;
}

function RunnerSection({
  analysisLevel, teaser, period, setPeriod, customStart, setCustomStart,
  customEnd, setCustomEnd, running, loadingStep, result, error,
  expandedCard, setExpandedCard, pdfLoading, onRun, onDownloadPdf
}: RunnerProps) {
  const isAdvanced = analysisLevel === 'advanced';

  return (
    <div>
      {/* 상단 요약 */}
      {teaser && !result && (
        <div className="grid grid-cols-4 gap-3 mb-6" style={{ animation: 'analysisFadeUp 0.3s ease-out' }}>
          <MiniStat label="캠페인" value={teaser.totalCampaigns} suffix="건" />
          <MiniStat label="총 발송" value={teaser.totalSent} suffix="건" />
          <MiniStat label="성공률" value={teaser.avgSuccessRate} suffix="%" />
          <MiniStat label="고객 수" value={teaser.totalCustomers} suffix="명" />
        </div>
      )}

      {/* 기간 선택 + 분석 실행 */}
      {!result && !running && (
        <div className="mb-6" style={{ animation: 'analysisFadeUp 0.4s ease-out' }}>
          <h3 className="text-sm font-semibold text-gray-600 mb-3">분석 기간 선택</h3>
          <div className="flex items-center gap-2 mb-4">
            {(['30d', '90d', 'custom'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  period === p
                    ? 'bg-gray-900 text-white shadow-md'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {p === '30d' ? '최근 30일' : p === '90d' ? '최근 90일' : '직접 설정'}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="flex items-center gap-3 mb-4">
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
              <span className="text-gray-400">~</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
            </div>
          )}

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
              <ShieldAlert size={16} />
              {error}
            </div>
          )}

          <button
            onClick={onRun}
            className="w-full py-3 bg-gradient-to-r from-gray-900 to-gray-700 hover:from-gray-800 hover:to-gray-600 text-white rounded-xl text-sm font-semibold shadow-lg transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2"
          >
            <Sparkles size={16} />
            AI 분석 시작
          </button>
        </div>
      )}

      {/* 로딩 애니메이션 */}
      {running && (
        <div className="flex flex-col items-center justify-center py-16" style={{ animation: 'analysisFadeUp 0.3s ease-out' }}>
          <div className="relative mb-8">
            <div className="w-16 h-16 rounded-full border-4 border-gray-200 border-t-amber-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Sparkles size={20} className="text-amber-500" />
            </div>
          </div>
          <div className="space-y-3 w-full max-w-xs">
            {LOADING_STEPS.map((step, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-500 ${
                  idx === loadingStep
                    ? 'bg-amber-50 border border-amber-200'
                    : idx < loadingStep
                      ? 'bg-emerald-50 border border-emerald-200'
                      : 'bg-gray-50 border border-gray-100'
                }`}
                style={{ opacity: idx <= loadingStep ? 1 : 0.4 }}
              >
                <span className="text-base">{idx < loadingStep ? '✅' : step.icon}</span>
                <span className={`text-sm font-medium ${
                  idx === loadingStep ? 'text-amber-700' : idx < loadingStep ? 'text-emerald-700' : 'text-gray-400'
                }`}>
                  {step.text}
                </span>
                {idx === loadingStep && (
                  <div className="ml-auto flex gap-1">
                    {[0, 1, 2].map(d => (
                      <div
                        key={d}
                        className="w-1.5 h-1.5 rounded-full bg-amber-500"
                        style={{ animation: `analysisPulse 1.2s ease-in-out ${d * 0.2}s infinite` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 분석 결과 */}
      {result && (
        <div style={{ animation: 'analysisFadeUp 0.4s ease-out' }}>
          {/* 결과 헤더 */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-amber-500" />
              <h3 className="text-sm font-bold text-gray-800">분석 완료</h3>
              <span className="text-xs text-gray-400">
                {new Date(result.generatedAt).toLocaleString('ko-KR')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // 결과 초기화 → 재분석
                  // result를 null로 만들기 위해 부모에서 처리해야 하지만,
                  // 여기서는 새로고침 방식 대신 onRun 재호출
                  onRun();
                }}
                className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                다시 분석
              </button>
              <button
                onClick={onDownloadPdf}
                disabled={pdfLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-xs font-semibold shadow transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={14} />
                {pdfLoading ? 'PDF 생성 중...' : 'PDF 다운로드'}
              </button>
            </div>
          </div>

          {/* 인사이트 카드 목록 */}
          <div className="space-y-3">
            {result.insights.map((insight, idx) => {
              const isLocked = !isAdvanced && insight.level === 'advanced';
              const colors = INSIGHT_COLORS[insight.category] || DEFAULT_COLOR;
              const icon = INSIGHT_ICONS[insight.category] || <FileText size={18} />;
              const isExpanded = expandedCard === insight.id;

              if (isLocked) {
                return (
                  <div
                    key={insight.id}
                    className="relative rounded-xl border border-gray-200 bg-gray-50/50 p-4 overflow-hidden"
                    style={{ animation: `analysisFadeUp ${0.3 + idx * 0.05}s ease-out` }}
                  >
                    <div className="absolute inset-0 bg-white/50 backdrop-blur-sm z-10 flex items-center justify-center">
                      <div className="flex items-center gap-2 bg-white/90 rounded-lg px-4 py-2 shadow border border-purple-200">
                        <Crown size={14} className="text-purple-600" />
                        <span className="text-xs font-medium text-gray-600">비즈니스 요금제에서 확인 가능</span>
                      </div>
                    </div>
                    <div className="select-none" style={{ filter: 'blur(6px)' }}>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">{icon}</span>
                        <span className="font-medium text-gray-600">{insight.title}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{insight.summary}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={insight.id}
                  className={`rounded-xl border ${colors.border} ${colors.bg} overflow-hidden transition-all duration-300`}
                  style={{ animation: `analysisFadeUp ${0.3 + idx * 0.05}s ease-out` }}
                >
                  <button
                    onClick={() => setExpandedCard(isExpanded ? null : insight.id)}
                    className="w-full px-5 py-4 flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`${colors.icon}`}>{icon}</div>
                      <div>
                        <h4 className="font-semibold text-gray-800 text-sm">{insight.title}</h4>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{insight.summary}</p>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </button>
                  {isExpanded && (
                    <div className="px-5 pb-4 border-t border-white/50">
                      <p className="text-sm text-gray-700 leading-relaxed mt-3 whitespace-pre-line">
                        {insight.details}
                      </p>
                      {insight.data && typeof insight.data === 'object' && Object.keys(insight.data).length > 0 && (
                        <div className="mt-3 p-3 bg-white/60 rounded-lg">
                          <p className="text-xs font-medium text-gray-500 mb-2">상세 데이터</p>
                          <div className="grid grid-cols-2 gap-2">
                            {Object.entries(insight.data).map(([key, val]) => (
                              <div key={key} className="flex justify-between text-xs">
                                <span className="text-gray-500">{key}</span>
                                <span className="font-medium text-gray-700">{String(val)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 프로 사용자용 비즈니스 업셀 */}
          {!isAdvanced && (
            <div className="mt-6 rounded-xl bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 p-5 text-center">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Crown size={16} className="text-purple-600" />
                <span className="text-sm font-bold text-gray-800">더 깊은 분석이 필요하신가요?</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                비즈니스 요금제에서 고객 세그먼트, 이탈 예측, ROI 분석까지 확인하세요
              </p>
              <button className="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl text-xs font-semibold shadow-lg shadow-purple-200 transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5">
                비즈니스로 업그레이드
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   서브 컴포넌트
   ═══════════════════════════════════════════════════ */

function StatCard({ icon, label, value, suffix, color, isPercent }: {
  icon: React.ReactNode; label: string; value: number; suffix: string; color: string; isPercent?: boolean;
}) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500 to-blue-600',
    emerald: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    purple: 'from-purple-500 to-purple-600',
  };
  const bgMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    amber: 'bg-amber-50 border-amber-200',
    purple: 'bg-purple-50 border-purple-200',
  };
  const textMap: Record<string, string> = {
    blue: 'text-blue-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    purple: 'text-purple-600',
  };

  return (
    <div className={`rounded-xl border p-4 ${bgMap[color] || 'bg-gray-50 border-gray-200'}`}>
      <div className={`mb-2 ${textMap[color] || 'text-gray-600'}`}>{icon}</div>
      <div className="text-2xl font-bold text-gray-800">
        {isPercent ? value.toFixed(1) : value.toLocaleString()}
        <span className="text-sm font-normal text-gray-400 ml-0.5">{suffix}</span>
      </div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function MiniStat({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3 text-center border border-gray-100">
      <div className="text-lg font-bold text-gray-800">
        {suffix === '%' ? value.toFixed(1) : value.toLocaleString()}
        <span className="text-xs font-normal text-gray-400 ml-0.5">{suffix}</span>
      </div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function BlurredItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg p-3 border border-gray-100">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-sm font-semibold text-gray-700">{value}</div>
    </div>
  );
}
