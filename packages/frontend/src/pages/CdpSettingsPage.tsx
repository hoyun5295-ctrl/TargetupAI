import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Check, Copy, Database, ExternalLink, KeyRound, Link2, RefreshCw, Store, Unlink } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

// ★ D172 (2026-05-19) — 한줄로 CDP 설정 페이지
//   회사 사용자가 자사몰 → 한줄로 sync API 키 발급 + 통합 가이드 확인 + 운영 모니터링 진입점.
//   BUSINESS+ 요금제만 진입 (백엔드 cdp_enabled 게이팅 + 사용자 UI 안내).

interface CdpUsage {
  cdp_enabled: boolean;
  plan_code: string;
  plan_name: string;
  has_key: boolean;
  issued_at: string | null;
  monthly_limit: number | null;
  used: number;
}

interface IssueKeyResponse {
  success: boolean;
  cdp_api_key: string;
  cdp_api_secret: string;
  issued_at: string;
  message: string;
}

interface RecentEvent {
  id: string;
  eventName: string;
  properties: Record<string, any>;
  source: string;
  customerId: string | null;
  externalId: string | null;
  occurredAt: string;
}

interface Cafe24Status {
  connected: boolean;
  mall_id?: string;
  status?: string;
  token_expires_at?: string;
  scope?: string;
}

interface ProviderInfo {
  provider: string;
  displayName: string;
  capabilities: {
    oauth: boolean;
    webhook: boolean;
    webhookSignatureVerification: boolean;
    adminApi: boolean;
  };
  status: 'available' | 'coming_soon';
}

export default function CdpSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [usage, setUsage] = useState<CdpUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [issuedSecret, setIssuedSecret] = useState<IssueKeyResponse | null>(null);
  const [confirmReissue, setConfirmReissue] = useState(false);
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'key' | 'secret'>('idle');
  const [cafe24Status, setCafe24Status] = useState<Cafe24Status | null>(null);
  const [cafe24MallId, setCafe24MallId] = useState('');
  const [cafe24Connecting, setCafe24Connecting] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);

  const token = () => localStorage.getItem('token');

  const loadUsage = async () => {
    try {
      const res = await fetch('/api/cdp/usage', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) setUsage(data);
    } catch (e) {
      console.error('CDP usage 조회 실패:', e);
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async () => {
    setEventsLoading(true);
    try {
      const res = await fetch('/api/cdp/recent-events?limit=20', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) setEvents(data.events || []);
    } catch (e) {
      console.error('CDP recent-events 조회 실패:', e);
    } finally {
      setEventsLoading(false);
    }
  };

  const loadCafe24Status = async () => {
    try {
      const res = await fetch('/api/cafe24/status', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) setCafe24Status(data);
    } catch (e) {
      console.error('카페24 status 조회 실패:', e);
    }
  };

  const handleCafe24Connect = async () => {
    const trimmed = cafe24MallId.trim().toLowerCase();
    if (!trimmed || !/^[a-z0-9_-]+$/i.test(trimmed)) {
      alert('카페24 mall_id 형식이 올바르지 않습니다. (예: hanjullo-test)');
      return;
    }
    setCafe24Connecting(true);
    try {
      const res = await fetch(`/api/cafe24/oauth/authorize?mall_id=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && data.authorize_url) {
        window.open(data.authorize_url, 'cafe24_oauth', 'width=720,height=820');
        alert('새 창에서 카페24 로그인 + 동의를 완료한 후, 본 페이지로 돌아와 새로고침해주세요.');
      } else {
        alert(data.error || '카페24 연동 시작 실패');
      }
    } catch (e: any) {
      alert(e?.message || '카페24 연동 처리 중 오류가 발생했습니다.');
    } finally {
      setCafe24Connecting(false);
    }
  };

  const handleCafe24Disconnect = async () => {
    if (!confirm('카페24 연동을 해제하시겠습니까? 자사몰 → 한줄로 sync가 즉시 중단됩니다.')) return;
    try {
      const res = await fetch('/api/cafe24/disconnect', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        await loadCafe24Status();
        alert('카페24 연동이 해제되었습니다.');
      } else {
        alert(data.error || '연동 해제 실패');
      }
    } catch (e: any) {
      alert(e?.message || '연동 해제 처리 중 오류가 발생했습니다.');
    }
  };

  const loadProviders = async () => {
    try {
      const res = await fetch('/api/cdp/providers', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) setProviders(data.providers || []);
    } catch (e) {
      console.error('provider 매트릭스 조회 실패:', e);
    }
  };

  useEffect(() => {
    loadUsage();
    loadEvents();
    loadCafe24Status();
    loadProviders();
  }, []);

  const handleIssueKey = async () => {
    if (usage?.has_key && !confirmReissue) {
      setConfirmReissue(true);
      return;
    }
    setIssuing(true);
    setConfirmReissue(false);
    try {
      const res = await fetch('/api/cdp/issue-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`,
        },
      });
      const data = await res.json();
      if (data.success) {
        setIssuedSecret(data);
        await loadUsage();
      } else {
        alert(data.error || '키 발급 실패');
      }
    } catch (e: any) {
      alert(e?.message || '키 발급 처리 중 오류가 발생했습니다.');
    } finally {
      setIssuing(false);
    }
  };

  const copy = async (text: string, target: 'key' | 'secret') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(target);
      setTimeout(() => setCopyStatus('idle'), 1500);
    } catch {
      alert('복사 실패 — 브라우저 권한을 확인해주세요.');
    }
  };

  const isAdmin = user?.userType === 'company_admin';

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          CDP 정보를 불러오는 중입니다...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/ai-operator')}
            className="text-gray-500 hover:text-gray-700 p-1"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Database className="w-5 h-5 text-indigo-600" />
          <h1 className="text-lg font-bold text-gray-800">자사몰 연동 (CDP)</h1>
          <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-medium">BETA</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* 요금제 게이팅 안내 */}
        {!usage?.cdp_enabled && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold text-amber-900 mb-1">
                현재 요금제: {usage?.plan_name || '미가입'} — 자사몰 연동(CDP) 사용 불가
              </div>
              <div className="text-sm text-amber-800">
                자사몰 회원 DB와 한줄로AI를 실시간 동기화하려면 <strong>비즈니스 요금제</strong>가 필요합니다. 가입 또는 업그레이드 후 본 페이지에서 키를 발급받으실 수 있습니다.
              </div>
            </div>
          </div>
        )}

        {/* 발급된 key+secret (한 번만 노출) */}
        {issuedSecret && (
          <div className="bg-emerald-50 border-2 border-emerald-300 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Check className="w-5 h-5 text-emerald-600" />
              <h2 className="text-base font-bold text-emerald-900">CDP 키가 발급되었습니다</h2>
            </div>
            <div className="text-sm text-emerald-800 mb-5 leading-relaxed">
              ★ <strong>비밀 키(secret)는 본 화면을 닫으면 다시 볼 수 없습니다.</strong> 자사몰에 즉시 박아주세요. 재발급 시 기존 키는 즉시 폐기됩니다.
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-emerald-900 block mb-1">Public Key (X-Hanjullo-Key)</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={issuedSecret.cdp_api_key}
                    className="flex-1 px-3 py-2 bg-white border border-emerald-200 rounded-lg text-xs font-mono text-gray-700"
                  />
                  <button
                    onClick={() => copy(issuedSecret.cdp_api_key, 'key')}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                  >
                    {copyStatus === 'key' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copyStatus === 'key' ? '복사됨' : '복사'}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-emerald-900 block mb-1">Secret Key (X-Hanjullo-Secret) — ★ 1회 노출</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={issuedSecret.cdp_api_secret}
                    className="flex-1 px-3 py-2 bg-white border-2 border-rose-300 rounded-lg text-xs font-mono text-gray-700"
                  />
                  <button
                    onClick={() => copy(issuedSecret.cdp_api_secret, 'secret')}
                    className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                  >
                    {copyStatus === 'secret' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copyStatus === 'secret' ? '복사됨' : '복사'}
                  </button>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIssuedSecret(null)}
              className="mt-5 px-4 py-2 bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 text-sm font-medium rounded-lg"
            >
              확인 — 키를 안전한 곳에 박았습니다
            </button>
          </div>
        )}

        {/* 키 발급/재발급 카드 */}
        {usage?.cdp_enabled && !issuedSecret && (
          <div className="bg-white border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-gray-800">CDP API 키</h2>
            </div>

            {usage.has_key ? (
              <div className="space-y-3">
                <div className="text-sm text-gray-600">
                  발급 일시: <span className="font-medium">{usage.issued_at ? new Date(usage.issued_at).toLocaleString('ko-KR') : '-'}</span>
                </div>
                <div className="text-sm text-gray-600">
                  ★ Public Key + Secret은 발급 시점에 자사몰 측에 박혀있어야 합니다. 재발급 시 기존 키는 즉시 폐기되며, 자사몰 코드의 키를 새 값으로 교체해야 합니다.
                </div>
                {confirmReissue ? (
                  <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 space-y-3">
                    <div className="text-sm text-rose-900 font-medium">
                      정말로 재발급하시겠습니까? 기존 키는 즉시 폐기되며, 교체 전까지 자사몰 → 한줄로 sync가 중단됩니다.
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleIssueKey}
                        disabled={issuing || !isAdmin}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
                      >
                        {issuing ? '재발급 중...' : '확인 — 재발급 진행'}
                      </button>
                      <button
                        onClick={() => setConfirmReissue(false)}
                        className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleIssueKey}
                    disabled={!isAdmin}
                    className="px-4 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg disabled:opacity-40"
                  >
                    재발급
                  </button>
                )}
                {!isAdmin && (
                  <div className="text-xs text-gray-500">키 발급/재발급은 회사 관리자만 가능합니다.</div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-gray-600">
                  CDP 키가 아직 발급되지 않았습니다. 발급 시 Public Key + Secret 한 쌍이 박힙니다.
                  <br />Secret은 발급 시점에 한 번만 노출되니, 자사몰 측에 즉시 박아주세요.
                </div>
                <button
                  onClick={handleIssueKey}
                  disabled={issuing || !isAdmin}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg disabled:opacity-40"
                >
                  {issuing ? '발급 중...' : '키 발급'}
                </button>
                {!isAdmin && (
                  <div className="text-xs text-gray-500">키 발급/재발급은 회사 관리자만 가능합니다.</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 이번 달 사용량 */}
        {usage?.cdp_enabled && (
          <div className="bg-white border rounded-xl p-6">
            <h2 className="text-base font-bold text-gray-800 mb-3">이번 달 사용량</h2>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-3xl font-bold text-indigo-600">{usage.used.toLocaleString()}</span>
              <span className="text-sm text-gray-500">
                / {usage.monthly_limit === null ? '무제한' : `${usage.monthly_limit.toLocaleString()}건`}
              </span>
            </div>
            {usage.monthly_limit !== null && (
              <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-500 h-2 transition-all"
                  style={{ width: `${Math.min((usage.used / usage.monthly_limit) * 100, 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* 카페24 OAuth 연동 */}
        {usage?.cdp_enabled && (
          <div className="bg-white border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Store className="w-5 h-5 text-orange-500" />
              <h2 className="text-base font-bold text-gray-800">카페24 연동</h2>
              <span className="text-xs bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full font-medium">코딩 0건</span>
            </div>

            {cafe24Status?.connected ? (
              <div className="space-y-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-emerald-900">
                      {cafe24Status.mall_id} 카페24와 연동되었습니다
                    </div>
                    <div className="text-xs text-emerald-700 mt-1">
                      status: {cafe24Status.status} · 토큰 만료: {cafe24Status.token_expires_at ? new Date(cafe24Status.token_expires_at).toLocaleString('ko-KR') : '-'}
                      <br />scope: <span className="font-mono">{cafe24Status.scope || '-'}</span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  카페24가 보내는 webhook(회원 가입/주문 생성/주문 취소)은 자동으로 한줄로 customers + cdp_events에 박힙니다. 추가 코딩이 필요하지 않습니다.
                </div>
                {isAdmin && (
                  <button
                    onClick={handleCafe24Disconnect}
                    className="px-4 py-2 bg-white border border-rose-300 hover:bg-rose-50 text-rose-700 text-sm font-medium rounded-lg flex items-center gap-2"
                  >
                    <Unlink className="w-4 h-4" />
                    연동 해제
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-gray-600">
                  카페24 mall_id를 입력하시면 OAuth 새 창이 열립니다. 카페24 관리자로 로그인 + 동의 완료 시 자동으로 회원/주문 sync가 박힙니다.
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cafe24MallId}
                    onChange={(e) => setCafe24MallId(e.target.value)}
                    placeholder="예: hanjullo-test"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  />
                  <button
                    onClick={handleCafe24Connect}
                    disabled={cafe24Connecting || !isAdmin || !cafe24MallId.trim()}
                    className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg disabled:opacity-40 flex items-center gap-2"
                  >
                    <Link2 className="w-4 h-4" />
                    {cafe24Connecting ? '연동 중...' : '카페24 연동 시작'}
                  </button>
                </div>
                {!isAdmin && (
                  <div className="text-xs text-gray-500">카페24 연동은 회사 관리자만 가능합니다.</div>
                )}
                <div className="text-xs text-gray-400">
                  ★ 카페24 admin URL이 <span className="font-mono">https://hanjullo-test.cafe24.com/admin</span>이면 mall_id는 <span className="font-mono">hanjullo-test</span>입니다.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Provider 매트릭스 — 자사몰 종합 세트 (D173) */}
        {usage?.cdp_enabled && providers.length > 0 && (
          <div className="bg-white border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Store className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-gray-800">지원 자사몰 매트릭스</h2>
            </div>
            <div className="text-xs text-gray-500 mb-4">
              자체구축 자사몰(Next.js/Node/Django/PHP)은 본 wrapper 없이 SDK 또는 CDP API로 즉시 연동 가능합니다.
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {providers.map((p) => {
                const isAvailable = p.status === 'available';
                return (
                  <div
                    key={p.provider}
                    className={`p-4 rounded-xl border ${
                      isAvailable
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-bold text-gray-800">{p.displayName}</div>
                      {isAvailable ? (
                        <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-full font-medium">사용 가능</span>
                      ) : (
                        <span className="text-[10px] bg-gray-400 text-white px-1.5 py-0.5 rounded-full font-medium">곧 출시</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 space-y-0.5">
                      <div>OAuth: {p.capabilities.oauth ? '✓' : '—'}</div>
                      <div>Webhook: {p.capabilities.webhook ? '✓' : '—'}</div>
                      <div>Admin API: {p.capabilities.adminApi ? '✓' : '—'}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 통합 가이드 */}
        {usage?.cdp_enabled && (
          <div className="bg-white border rounded-xl p-6">
            <h2 className="text-base font-bold text-gray-800 mb-4">자사몰 통합 가이드</h2>
            <div className="space-y-4 text-sm text-gray-700">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="font-medium text-gray-800 mb-2">자사몰 종류별 진입 방식</div>
                <ul className="space-y-1.5 ml-4 list-disc text-gray-600">
                  <li><strong>카페24/Shopify/메이크샵/imweb</strong> — App Marketplace에서 "한줄로AI" 설치 (코딩 0건)</li>
                  <li><strong>자체구축 (Next.js/Node/Django)</strong> — JavaScript SDK 또는 server-side API 직접 호출</li>
                  <li><strong>WordPress/WooCommerce</strong> — 한줄로AI 플러그인 설치</li>
                </ul>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="font-medium text-gray-800 mb-2">표준 API 엔드포인트</div>
                <div className="space-y-1.5 font-mono text-xs text-gray-700 ml-4">
                  <div>POST https://app.hanjul.ai/api/cdp/identify   — 회원 식별/upsert</div>
                  <div>POST https://app.hanjul.ai/api/cdp/event      — 행동 이벤트 (장바구니/위시리스트 등)</div>
                  <div>POST https://app.hanjul.ai/api/cdp/order      — 주문 sync + RFM 갱신</div>
                  <div>POST https://app.hanjul.ai/api/cdp/bulk-import — 초기 마이그레이션 (최대 1,000건/요청)</div>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  헤더: <span className="font-mono">X-Hanjullo-Key</span>: public key / <span className="font-mono">X-Hanjullo-Secret</span>: secret key
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="font-medium text-gray-800 mb-2">샘플 — 회원 가입 시 호출 (JavaScript)</div>
                <pre className="text-xs font-mono bg-white border border-gray-200 rounded p-3 overflow-x-auto">{`fetch('https://app.hanjul.ai/api/cdp/identify', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Hanjullo-Key':    'hjl_xxxxxxxxxxxx',
    'X-Hanjullo-Secret': 'sk_xxxxxxxxxxxx'
  },
  body: JSON.stringify({
    external_id: '\${자사몰_회원ID}',
    email: 'user@example.com',
    phone: '01012345678',
    name: '홍길동',
    grade: 'VIP'
  })
})`}</pre>
              </div>

              <div className="text-xs text-gray-500">
                상세 가이드 + 전용 SDK + 카페24 App 설치 안내는 D172-B 진입 시 본 페이지에 추가됩니다.
              </div>
            </div>
          </div>
        )}

        {/* 최근 이벤트 (디버깅) */}
        {usage?.cdp_enabled && (
          <div className="bg-white border rounded-xl p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-gray-800">최근 이벤트 (디버깅)</h2>
              <button
                onClick={loadEvents}
                disabled={eventsLoading}
                className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${eventsLoading ? 'animate-spin' : ''}`} />
                새로고침
              </button>
            </div>
            {events.length === 0 ? (
              <div className="text-sm text-gray-500 py-8 text-center">
                아직 수신된 이벤트가 없습니다. 자사몰에서 API 호출이 진행되면 본 영역에 표시됩니다.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b text-xs text-gray-600">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">시각</th>
                      <th className="text-left px-3 py-2 font-medium">이벤트</th>
                      <th className="text-left px-3 py-2 font-medium">출처</th>
                      <th className="text-left px-3 py-2 font-medium">회원/외부ID</th>
                      <th className="text-left px-3 py-2 font-medium">속성 (요약)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id} className="border-b last:border-0">
                        <td className="px-3 py-2 text-xs text-gray-500">{new Date(ev.occurredAt).toLocaleString('ko-KR')}</td>
                        <td className="px-3 py-2 text-xs font-mono text-indigo-700">{ev.eventName}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">{ev.source}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {ev.customerId ? '회원' : ev.externalId || '-'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-xs">
                          {JSON.stringify(ev.properties).slice(0, 80)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-gray-400 text-center pt-4 flex items-center justify-center gap-1">
          <ExternalLink className="w-3 h-3" />
          본 기능은 베타 운영 중입니다. 사고 발견 시 즉시 신고 부탁드립니다 — D172-B에서 카페24/Shopify App + JavaScript SDK가 추가됩니다.
        </div>
      </div>
    </div>
  );
}
