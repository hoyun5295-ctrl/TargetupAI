import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, Mail, Plus, RefreshCw, Send } from 'lucide-react';

// ★ D180 (2026-05-19): Email 채널 (SendGrid Web API v3)
//   영구 원칙 — 발송 시점 안전장치 + Zero-Count + 광고성 (광고) prefix + 무료거부 박음

type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'completed' | 'failed';

interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  fromName: string;
  fromEmail: string;
  isAd: boolean;
  scheduledAt: string | null;
  sentAt: string | null;
  status: CampaignStatus;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  createdAt: string;
}

interface EmailStatus {
  sendgrid_configured: boolean;
  from_domain: string | null;
}

export default function EmailCampaignsPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<EmailCampaign> | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const token = () => localStorage.getItem('token');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [statusRes, listRes] = await Promise.all([
        fetch('/api/email/status', { headers: { Authorization: `Bearer ${token()}` } }),
        fetch('/api/email/campaigns?limit=50', { headers: { Authorization: `Bearer ${token()}` } }),
      ]);
      const statusData = await statusRes.json();
      const listData = await listRes.json();
      if (statusData.success) setStatus(statusData);
      if (listData.success) setCampaigns(listData.campaigns || []);
    } catch (e: any) {
      setError(e?.message || '조회 중 오류');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleSave = async () => {
    if (!editing?.name?.trim() || !editing?.subject?.trim() || !editing?.htmlBody?.trim()) {
      alert('이름 / 제목 / HTML 본문은 필수입니다.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/email/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          name: editing.name,
          subject: editing.subject,
          html_body: editing.htmlBody,
          from_name: editing.fromName,
          is_ad: !!editing.isAd,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditing(null);
        await loadAll();
      } else {
        setError(data.error || '저장 실패');
      }
    } catch (e: any) {
      setError(e?.message || '저장 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (campaign: EmailCampaign) => {
    const recipientsRaw = prompt('수신자 이메일을 박아주세요 (콤마 구분, 예: a@x.com, b@y.com)');
    if (!recipientsRaw) return;
    const recipients = recipientsRaw.split(',').map((e) => ({ email: e.trim() })).filter((r) => r.email.includes('@'));
    if (recipients.length === 0) {
      alert('유효한 이메일을 박지 X — 발송 차단.');
      return;
    }
    if (!confirm(`${recipients.length}명에게 즉시 발송하시겠습니까? ${campaign.isAd ? '(광고성 이메일 — "(광고)" prefix + 무료거부 링크 자동 박힘)' : ''}`)) return;

    setSendingId(campaign.id);
    try {
      const res = await fetch(`/api/email/campaigns/${campaign.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ recipients, immediate: true }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`발송 완료 — ${data.sentCount}건 박힘.`);
        await loadAll();
      } else {
        alert(data.error || '발송 실패');
      }
    } catch (e: any) {
      alert(e?.message || '발송 중 오류');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="text-gray-500 hover:text-gray-700 p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Mail className="w-5 h-5 text-blue-600" />
          <h1 className="text-lg font-bold text-gray-800">Email 캠페인</h1>
          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">BETA</span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={loadAll} className="text-xs text-gray-600 hover:bg-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              onClick={() => setEditing({ name: '', subject: '', htmlBody: '<p>안녕하세요,</p>', fromName: '한줄로AI', isAd: false })}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              신규 캠페인
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>영구 원칙:</strong> 광고성 캠페인은 "(광고)" prefix + 수신거부 링크가 자동 박힙니다 (정보통신망법).
            수신자 0건이면 발송이 차단됩니다 (Zero-Count 영구 원칙). 발송 시점 안전장치 박음 — 즉시/예약 confirm.
          </div>
        </div>

        {status && (
          <div className="bg-white border rounded-xl p-4 text-xs text-gray-600">
            SendGrid: {status.sendgrid_configured ? '✓ 환경변수 박힘' : '✗ SENDGRID_API_KEY / SENDGRID_FROM_DOMAIN 미박힘'}
            {status.from_domain && <span className="ml-3">발신 도메인: <span className="font-mono">{status.from_domain}</span></span>}
          </div>
        )}

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">{error}</div>
        )}

        {loading && (
          <div className="bg-white border rounded-xl p-12 flex justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && campaigns.length === 0 && (
          <div className="bg-white border rounded-xl p-12 text-center text-sm text-gray-500">
            아직 등록된 캠페인이 없습니다. "신규 캠페인" 박아 시작해주세요.
          </div>
        )}

        {!loading && campaigns.map((c) => (
          <div key={c.id} className="bg-white border rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base font-bold text-gray-800">{c.name}</span>
                  <StatusBadge status={c.status} />
                  {c.isAd && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">광고성</span>}
                </div>
                <div className="text-xs text-gray-600 mb-2">제목: {c.subject}</div>
                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  <span>발송 <strong>{c.sentCount.toLocaleString()}</strong></span>
                  <span>·</span>
                  <span>오픈 <strong>{c.openCount.toLocaleString()}</strong> ({c.sentCount > 0 ? ((c.openCount / c.sentCount) * 100).toFixed(1) : 0}%)</span>
                  <span>·</span>
                  <span>클릭 <strong>{c.clickCount.toLocaleString()}</strong> ({c.sentCount > 0 ? ((c.clickCount / c.sentCount) * 100).toFixed(1) : 0}%)</span>
                  <span>·</span>
                  <span>반송 <strong>{c.bounceCount.toLocaleString()}</strong></span>
                  <span>·</span>
                  <span>수신거부 <strong>{c.unsubscribeCount.toLocaleString()}</strong></span>
                </div>
                {c.sentAt && (
                  <div className="text-xs text-gray-400 mt-1">발송 일자: {new Date(c.sentAt).toLocaleString('ko-KR')}</div>
                )}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {(c.status === 'draft' || c.status === 'failed') && (
                  <button
                    onClick={() => handleSend(c)}
                    disabled={sendingId === c.id || !status?.sendgrid_configured}
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded flex items-center gap-1 disabled:opacity-40"
                  >
                    <Send className="w-3 h-3" />
                    {sendingId === c.id ? '발송 중...' : '발송'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 편집 모달 */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-800 mb-4">신규 Email 캠페인</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 block mb-1">이름</label>
                <input type="text" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="VIP 5월 재구매 안내" maxLength={200} />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">제목 (subject)</label>
                <input type="text" value={editing.subject || ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="VIP 회원님께 드리는 5월 특별 혜택" maxLength={200} />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">발신자 이름 (from name)</label>
                <input type="text" value={editing.fromName || ''} onChange={(e) => setEditing({ ...editing, fromName: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="한줄로AI" maxLength={100} />
              </div>
              <div>
                <label className="text-xs text-gray-600 block mb-1">HTML 본문</label>
                <textarea value={editing.htmlBody || ''} onChange={(e) => setEditing({ ...editing, htmlBody: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-xs font-mono resize-none h-40" placeholder="<p>안녕하세요, {{name}}님</p>" />
                <div className="text-[10px] text-gray-400 mt-1">{`{{name}}`} 등 substitution은 발송 시 recipients에 박은 값으로 자동 치환됩니다.</div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is_ad" checked={!!editing.isAd} onChange={(e) => setEditing({ ...editing, isAd: e.target.checked })} className="rounded" />
                <label htmlFor="is_ad" className="text-xs text-gray-700">광고성 이메일 (체크 시 "(광고)" prefix + 수신거부 링크 자동 박힘 — 정보통신망법 정합)</label>
              </div>
              {error && <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-700">{error}</div>}
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg disabled:opacity-40">
                  {saving ? '저장 중...' : 'draft로 저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const map: Record<CampaignStatus, { label: string; cls: string }> = {
    draft: { label: '초안', cls: 'bg-gray-100 text-gray-600' },
    scheduled: { label: '예약됨', cls: 'bg-amber-100 text-amber-700' },
    sending: { label: '발송 중', cls: 'bg-blue-100 text-blue-700' },
    completed: { label: '완료', cls: 'bg-emerald-100 text-emerald-700' },
    failed: { label: '실패', cls: 'bg-rose-100 text-rose-700' },
  };
  const e = map[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.cls}`}>{e.label}</span>;
}
