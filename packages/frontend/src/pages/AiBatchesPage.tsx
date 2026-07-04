import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { AlertCircle, ArrowLeft, CheckCircle2, Layers, Loader2, RefreshCw, XCircle, Zap } from 'lucide-react';
import { useToast } from '../components/ToastProvider';

// ★ D181 (2026-05-19): Anthropic Batch API 모니터링 페이지
//   대량 발송 50% 비용 절감 — 24h SLA. 회사 admin이 진행 상태 확인 + manual poll

type BatchStatus = 'submitted' | 'processing' | 'completed' | 'failed' | 'expired';

interface BatchJob {
  id: string;
  batchId: string;
  model: string;
  totalRequests: number;
  status: BatchStatus;
  succeededCount: number;
  erroredCount: number;
  expiredCount: number;
  metadata: Record<string, unknown>;
  submittedAt: string;
  completedAt: string | null;
}

const STATUS_META: Record<BatchStatus, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  submitted: { label: '제출됨', cls: 'bg-gray-100 text-gray-600', icon: Loader2 },
  processing: { label: '처리 중', cls: 'bg-blue-100 text-blue-700', icon: Loader2 },
  completed: { label: '완료', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  failed: { label: '실패', cls: 'bg-rose-100 text-rose-700', icon: XCircle },
  expired: { label: '만료', cls: 'bg-amber-100 text-amber-700', icon: XCircle },
};

export default function AiBatchesPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [batches, setBatches] = useState<BatchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [pollingId, setPollingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = () => localStorage.getItem('token');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/operator/batches?limit=50', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        setBatches(data.batches || []);
      } else {
        setError(data.error || '조회 실패');
      }
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handlePoll = async (batchId: string) => {
    setPollingId(batchId);
    try {
      const res = await fetch(`/api/ai/operator/batches/${batchId}/poll`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) await load();
      else toast.error(data.error || 'poll 실패');
    } catch (e: any) {
      toast.error(e?.message || 'poll 중 오류');
    } finally {
      setPollingId(null);
    }
  };

  // 비용 절감 합계 (Anthropic Batch API = 50% 할인)
  const totalRequests = batches.reduce((sum, b) => sum + b.totalRequests, 0);
  const totalSucceeded = batches.reduce((sum, b) => sum + b.succeededCount, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-violet-50">
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className="text-gray-500 hover:text-gray-700 p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Layers className="w-5 h-5 text-violet-600" />
          <h1 className="text-lg font-bold text-gray-800">AI Batch (50% 비용 절감)</h1>
          <span className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded-full font-medium">BETA</span>
          <div className="ml-auto">
            <button onClick={load} className="text-xs text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>Batch 처리 모드:</strong> 대량 AI 호출(100~10만 요청)을 batch로 처리하면 표준 대비 <strong>50% 비용 절감</strong>됩니다.
            24시간 SLA (대부분 1시간 이내 완료). AI 자동 마케팅 실행 시 자동 사용됩니다.
          </div>
        </div>

        {/* 통계 카드 */}
        {!loading && batches.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">누적 batch</div>
              <div className="text-2xl font-bold text-gray-800">{batches.length}건</div>
            </div>
            <div className="bg-white border rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">누적 요청</div>
              <div className="text-2xl font-bold text-violet-600">{totalRequests.toLocaleString()}건</div>
            </div>
            <div className="bg-white border rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">성공률</div>
              <div className="text-2xl font-bold text-emerald-600">
                {totalRequests > 0 ? ((totalSucceeded / totalRequests) * 100).toFixed(1) : 0}%
              </div>
            </div>
          </div>
        )}

        {error && <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">{error}</div>}

        {loading && (
          <div className="bg-white border rounded-xl p-12 flex justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && batches.length === 0 && (
          <div className="bg-white border rounded-xl p-12 text-center text-sm text-gray-500">
            아직 처리된 batch가 없습니다.
            <br />
            <span className="text-xs text-gray-400 mt-2 block">AI 자동 마케팅 + 대량 캠페인 시 자동으로 batch 처리됩니다.</span>
          </div>
        )}

        {!loading && batches.map((b) => {
          const meta = STATUS_META[b.status];
          const Icon = meta.icon;
          const isInProgress = b.status === 'submitted' || b.status === 'processing';
          const successRate = b.totalRequests > 0 ? (b.succeededCount / b.totalRequests) * 100 : 0;
          return (
            <div key={b.id} className="bg-white border rounded-xl p-4">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Icon className={`w-4 h-4 ${isInProgress ? 'animate-spin text-blue-600' : 'text-gray-500'}`} />
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
                    <span className="text-xs font-mono text-gray-500">{b.batchId.slice(0, 20)}...</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                    <span>요청 <strong>{b.totalRequests.toLocaleString()}건</strong></span>
                    <span>·</span>
                    <span>제출 {new Date(b.submittedAt).toLocaleString('ko-KR')}</span>
                    {b.completedAt && (
                      <>
                        <span>·</span>
                        <span>완료 {new Date(b.completedAt).toLocaleString('ko-KR')}</span>
                      </>
                    )}
                  </div>
                </div>
                {isInProgress && (
                  <button
                    onClick={() => handlePoll(b.batchId)}
                    disabled={pollingId === b.batchId}
                    className="text-xs bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded flex items-center gap-1 disabled:opacity-40"
                  >
                    <Zap className="w-3 h-3" />
                    {pollingId === b.batchId ? 'poll 중...' : '상태 갱신'}
                  </button>
                )}
              </div>

              {/* 진행률 + 결과 분포 */}
              {b.totalRequests > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
                    <span className="text-emerald-700">성공 {b.succeededCount.toLocaleString()}</span>
                    {b.erroredCount > 0 && <span className="text-rose-700">· 에러 {b.erroredCount.toLocaleString()}</span>}
                    {b.expiredCount > 0 && <span className="text-amber-700">· 만료 {b.expiredCount.toLocaleString()}</span>}
                    <span className="ml-auto font-medium">{successRate.toFixed(1)}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden flex">
                    {b.succeededCount > 0 && (
                      <div className="bg-emerald-500 h-2" style={{ width: `${(b.succeededCount / b.totalRequests) * 100}%` }} />
                    )}
                    {b.erroredCount > 0 && (
                      <div className="bg-rose-400 h-2" style={{ width: `${(b.erroredCount / b.totalRequests) * 100}%` }} />
                    )}
                    {b.expiredCount > 0 && (
                      <div className="bg-amber-400 h-2" style={{ width: `${(b.expiredCount / b.totalRequests) * 100}%` }} />
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
