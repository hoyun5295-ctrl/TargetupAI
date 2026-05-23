import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Loader2, Mail, Plus, RefreshCw, Send } from 'lucide-react';

// ★ D180 (2026-05-19): Email 채널 (SendGrid Web API v3)
//   영구 원칙 — 발송 시점 안전장치 + Zero-Count + 광고성 (광고) prefix + 무료거부 자동 부착

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
    const recipientsRaw = prompt('수신자 이메일을 입력해주세요 (콤마 구분, 예: a@x.com, b@y.com)');
    if (!recipientsRaw) return;
    const recipients = recipientsRaw.split(',').map((e) => ({ email: e.trim() })).filter((r) => r.email.includes('@'));
    if (recipients.length === 0) {
      alert('유효한 이메일이 없습니다 — 발송 차단.');
      return;
    }
    if (!confirm(`${recipients.length}명에게 즉시 발송하시겠습니까? ${campaign.isAd ? '(광고성 이메일 — "(광고)" prefix + 무료거부 링크 자동 부착)' : ''}`)) return;

    setSendingId(campaign.id);
    try {
      const res = await fetch(`/api/email/campaigns/${campaign.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ recipients, immediate: true }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`발송 완료 — ${data.sentCount}건 처리됨.`);
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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="bg-slate-950/80 backdrop-blur-sm border-b border-white/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
            <Mail className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-semibold text-white">Email 캠페인</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">SendGrid 기반 transactional · marketing 자동 발송 + 오픈 / 클릭 트래킹</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={loadAll} className="text-xs text-white/70 hover:bg-white/10 px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
            <button
              onClick={() => setEditing({ name: '', subject: '', htmlBody: '<p>안녕하세요,</p>', fromName: '한줄로AI', isAd: false })}
              className="text-xs bg-gradient-to-r from-blue-500/40 to-sky-500/40 hover:from-blue-500/60 hover:to-sky-500/60 text-blue-50 px-3 py-2 rounded-lg flex items-center gap-1.5 font-medium transition-colors border border-blue-400/30"
            >
              <Plus className="w-3.5 h-3.5" />
              신규 캠페인
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        <div className="bg-amber-500/10 border border-amber-400/30 rounded-lg p-3 text-xs text-amber-100 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>영구 원칙:</strong> 광고성 캠페인은 "(광고)" prefix + 수신거부 링크가 자동 부착됩니다 (정보통신망법).
            수신자 0건이면 발송이 차단됩니다 (Zero-Count 영구 원칙). 발송 시점 안전장치 작동 — 즉시/예약 confirm.
          </div>
        </div>

        {status && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-white/70">
            SendGrid: {status.sendgrid_configured ? '✓ 환경변수 설정됨' : '✗ SENDGRID_API_KEY / SENDGRID_FROM_DOMAIN 미설정'}
            {status.from_domain && <span className="ml-3">발신 도메인: <span className="font-mono">{status.from_domain}</span></span>}
          </div>
        )}

        {error && (
          <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-300">{error}</div>
        )}

        {loading && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 flex justify-center text-white/50">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {!loading && campaigns.length === 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center text-sm text-white/50">
            아직 등록된 캠페인이 없습니다. "신규 캠페인" 버튼을 눌러 시작해주세요.
          </div>
        )}

        {!loading && campaigns.map((c) => (
          <div key={c.id} className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base font-bold text-white">{c.name}</span>
                  <StatusBadge status={c.status} />
                  {c.isAd && <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded-full font-medium">광고성</span>}
                </div>
                <div className="text-xs text-white/70 mb-2">제목: {c.subject}</div>
                <div className="flex flex-wrap gap-3 text-xs text-white/50">
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
                  <div className="text-xs text-white/40 mt-1">발송 일자: {new Date(c.sentAt).toLocaleString('ko-KR')}</div>
                )}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {(c.status === 'draft' || c.status === 'failed') && (
                  <button
                    onClick={() => handleSend(c)}
                    disabled={sendingId === c.id || !status?.sendgrid_configured}
                    className="text-xs bg-blue-500/30 hover:bg-blue-500/50 text-blue-100 px-3 py-1.5 rounded flex items-center gap-1 disabled:opacity-40"
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
          <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-white mb-4">신규 Email 캠페인</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/70 block mb-1">이름</label>
                <input type="text" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50" placeholder="VIP 5월 재구매 안내" maxLength={200} />
              </div>
              <div>
                <label className="text-xs text-white/70 block mb-1">제목 (subject)</label>
                <input type="text" value={editing.subject || ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50" placeholder="VIP 회원님께 드리는 5월 특별 혜택" maxLength={200} />
              </div>
              <div>
                <label className="text-xs text-white/70 block mb-1">발신자 이름 (from name)</label>
                <input type="text" value={editing.fromName || ''} onChange={(e) => setEditing({ ...editing, fromName: e.target.value })} className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50" placeholder="한줄로AI" maxLength={100} />
              </div>
              <div>
                <label className="text-xs text-white/70 block mb-1">HTML 본문</label>
                <textarea value={editing.htmlBody || ''} onChange={(e) => setEditing({ ...editing, htmlBody: e.target.value })} className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-xs font-mono resize-none h-40 text-white placeholder-white/30 focus:outline-none focus:border-blue-400/50" placeholder="<p>안녕하세요, {{name}}님</p>" />
                <div className="text-[10px] text-white/40 mt-1">{`{{name}}`} 등 substitution은 발송 시 recipients에 입력한 값으로 자동 치환됩니다.</div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="is_ad" checked={!!editing.isAd} onChange={(e) => setEditing({ ...editing, isAd: e.target.checked })} className="rounded" />
                <label htmlFor="is_ad" className="text-xs text-white/80">광고성 이메일 (체크 시 "(광고)" prefix + 수신거부 링크 자동 부착 — 정보통신망법 정합)</label>
              </div>
              {error && <div className="bg-rose-500/10 border border-rose-400/30 rounded-lg p-3 text-sm text-rose-300">{error}</div>}
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setEditing(null)} className="px-4 py-2 border rounded-lg text-sm text-white/80 hover:bg-white/5">취소</button>
                <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-500/30 hover:bg-blue-500/50 text-blue-100 text-sm rounded-lg disabled:opacity-40">
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
    draft: { label: '초안', cls: 'bg-white/10 text-white/70' },
    scheduled: { label: '예약됨', cls: 'bg-amber-500/20 text-amber-300' },
    sending: { label: '발송 중', cls: 'bg-blue-500/20 text-blue-300 border border-blue-400/30' },
    completed: { label: '완료', cls: 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' },
    failed: { label: '실패', cls: 'bg-rose-500/20 text-rose-300 border border-rose-400/30' },
  };
  const e = map[status] || { label: status, cls: 'bg-white/10 text-white/70' };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${e.cls}`}>{e.label}</span>;
}
