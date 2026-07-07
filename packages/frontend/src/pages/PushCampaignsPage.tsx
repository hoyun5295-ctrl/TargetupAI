import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Bell, Loader2, RefreshCw, Send } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';

// ★ D175-A (2026-05-19): Web Push 캠페인 발송 + 구독자 수 모니터링
//   BUSINESS+ 베타 게이팅 (백엔드 isCdpEnabledForPlan).

interface PushStats {
  active: number;
  revoked: number;
  expired: number;
}

interface PushCampaign {
  id: string;
  title: string;
  body: string;
  url: string | null;
  recipient_count: number;
  success_count: number;
  fail_count: number;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export default function PushCampaignsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PushStats | null>(null);
  const [campaigns, setCampaigns] = useState<PushCampaign[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ success: number; fail: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const toast = useToast();

  const token = () => localStorage.getItem('token');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cdp/push/stats', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setCampaigns(data.campaigns || []);
      } else {
        setError(data.error || 'Push 통계 조회 실패');
      }
    } catch (e: any) {
      setError(e?.message || 'Push 통계 호출 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const doSend = async () => {
    setSending(true);
    setError(null);
    setLastResult(null);
    try {
      const res = await fetch('/api/cdp/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), url: url.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setLastResult({ success: data.result.successCount, fail: data.result.failCount, total: data.result.recipientCount });
        setTitle(''); setBody(''); setUrl('');
        await load();
      } else {
        setError(data.error || 'Web Push 발송 실패');
      }
    } catch (e: any) {
      setError(e?.message || '발송 처리 중 오류가 발생했습니다.');
    } finally {
      setSending(false);
    }
  };

  const handleSend = () => {
    if (!title.trim() || !body.trim()) {
      toast.error('제목과 본문은 필수입니다.');
      return;
    }
    setConfirm({
      mode: 'default',
      title: 'Web Push 발송',
      description: `${stats?.active || 0}명의 구독자에게 Web Push를 발송하시겠습니까?`,
      confirmLabel: '발송',
      onConfirm: doSend,
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      <div className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="text-gray-500 hover:text-gray-700 p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Bell className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-bold text-gray-800">Web Push 캠페인</h1>
          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">실험실</span>
          <button onClick={load} className="ml-auto text-xs text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {loading && (
          <div className="bg-white border rounded-xl p-12 flex justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && stats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border rounded-xl p-5">
              <div className="text-xs text-gray-500 mb-1">활성 구독자</div>
              <div className="text-2xl font-bold text-emerald-600">{stats.active.toLocaleString()}</div>
            </div>
            <div className="bg-white border rounded-xl p-5">
              <div className="text-xs text-gray-500 mb-1">해제됨</div>
              <div className="text-2xl font-bold text-gray-500">{stats.revoked.toLocaleString()}</div>
            </div>
            <div className="bg-white border rounded-xl p-5">
              <div className="text-xs text-gray-500 mb-1">만료됨</div>
              <div className="text-2xl font-bold text-rose-500">{stats.expired.toLocaleString()}</div>
            </div>
          </div>
        )}

        {!loading && (
          <div className="bg-white border rounded-xl p-6">
            <h2 className="text-base font-bold text-gray-800 mb-4">새 Web Push 발송</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 block mb-1">제목 (최대 50자)</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 50))}
                  maxLength={50}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="VIP 회원님께만 드리는 특별 혜택"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">본문 (최대 200자)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value.slice(0, 200))}
                  maxLength={200}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none h-20"
                  placeholder="봄 신상 30% 할인 — 오늘 자정까지"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">클릭 시 이동 URL (선택)</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="https://example.com/promo"
                />
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {lastResult && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                  발송 완료 — 대상 {lastResult.total.toLocaleString()}명 / 성공 {lastResult.success.toLocaleString()} / 실패 {lastResult.fail.toLocaleString()}
                </div>
              )}

              <button
                onClick={handleSend}
                disabled={sending || !title.trim() || !body.trim() || !stats || stats.active === 0}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-40 flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                {sending ? '발송 중...' : `${stats?.active.toLocaleString() || 0}명에게 발송`}
              </button>
              {stats && stats.active === 0 && (
                <div className="text-xs text-gray-500">
                  활성 구독자가 0건입니다 — 자사몰에 @hanjullo/sdk push 모듈을 통합한 후 사용자 동의를 확보해주세요.
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && campaigns.length > 0 && (
          <div className="bg-white border rounded-xl p-6">
            <h2 className="text-base font-bold text-gray-800 mb-3">최근 발송 캠페인</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b text-xs text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">시각</th>
                    <th className="text-left px-3 py-2 font-medium">제목</th>
                    <th className="text-right px-3 py-2 font-medium">대상</th>
                    <th className="text-right px-3 py-2 font-medium">성공</th>
                    <th className="text-right px-3 py-2 font-medium">실패</th>
                    <th className="text-left px-3 py-2 font-medium">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-xs text-gray-500">{new Date(c.sent_at || c.created_at).toLocaleString('ko-KR')}</td>
                      <td className="px-3 py-2 text-xs">{c.title}</td>
                      <td className="px-3 py-2 text-xs text-right">{c.recipient_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-right text-emerald-600 font-medium">{c.success_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs text-right text-rose-500">{c.fail_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-xs">{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
