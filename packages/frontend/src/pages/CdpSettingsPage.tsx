/**
 * CdpSettingsPage.tsx — D214+ (2026-05-24) 5번 메뉴 자사몰 연동 전면 재작성
 *
 * 기존 1059줄 → 신규 (Performance/Predictive 매트릭스 정합 12 화면)
 *
 * 영역:
 *   1. 상단 + 새로고침
 *   2. 요금제 게이팅 안내
 *   3. 데이터 부족 안내 카드 (CT-73 진단 매트릭스)
 *   4. AI 자율 진단 (비동기 로드 — 모델 영역 backend 분리 정합)
 *   5. 1-click 액션 3 카드 (자체 호스팅 / 카페24 / 네이버)
 *   6. 요약 5 metric (회사 customer / 매핑 / 매핑률 / 30일 이벤트 / 30일 매출)
 *   7. 자세히 분석 토글 (default 숨김)
 *   8. 자세히 6 차트 (funnel / timeline / Provider별 매핑률 / POS↔CDP / Webhook / 채널)
 *   9. AI 영향 요인 매트릭스
 *   10. 자사몰 활성 customer top 10
 *   11. Provider 매트릭스 (cafe24 + 자체 호스팅 + 네이버 + skeleton)
 *   12. CDP 키 발급 + 사용량 + 발급 안내
 *
 * ⛔ 영구 룰:
 *   - native dialog 영역 0건 의무 (ConfirmModal + useToast 활용 — feedback_no_native_browser_dialog)
 *   - 보라 톤 정합 (violet 그라데이션 + 액센트) — D222+ Phase 2 정정
 *   - Source caption 의무 (feedback_no_mock_data_in_production)
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  ArrowLeft, Database, Brain, Loader2, RefreshCw, Sparkles, Users, AlertTriangle,
  Activity, ChevronRight, ChevronLeft, Info, Link2, Store, Server,
  KeyRound, Copy, Check, Unlink, MousePointerClick, AlertCircle, ShoppingCart, Code2,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import ConfirmModal, { type ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';

// ════════════════════════════════════════════════════════════════════
// 타입 매트릭스
// ════════════════════════════════════════════════════════════════════

interface CdpUsage {
  cdp_enabled: boolean;
  plan_code: string;
  plan_name: string;
  has_key: boolean;
  public_key: string | null;
  issued_at: string | null;
  monthly_limit: number | null;
  used: number;
}

interface InstallStatus {
  keyIssuedAt: string | null;
  firstEventAt: string | null;
  total: number;
  count24h: number;
  signals: { pageview: boolean; identify: boolean; consent: boolean; click: boolean };
}

interface IssueKeyResponse {
  success: boolean;
  cdp_api_key: string;
  cdp_api_secret: string;
  issued_at: string;
  message: string;
}

interface Cafe24Status {
  connected: boolean;
  mall_id?: string;
  status?: string;
  token_expires_at?: string;
  scope?: string;
}

interface NaverCommerceStatus {
  connected: boolean;
  store_id?: string;
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

interface CustomWebhookInfo {
  hasSecret: boolean;
  webhookUrl: string;
  issuedAt: string | null;
  companyId: string;
}

interface CustomIssuedSecret {
  webhook_secret: string;
  webhook_url: string;
  company_id: string;
  issued_at: string;
  message: string;
}

interface CdpProviderStats {
  source: string;
  totalLinks: number;
  mappedLinks: number;
  mappingRate: number;
  events30d: number;
}

interface WebhookReliability {
  source: string;
  totalDeliveries: number;
  successCount: number;
  failedCount: number;
  duplicateCount: number;
  successRate: number;
}

interface SourceConflictBucket {
  activeSourceCount: number;
  customerCount: number;
}

interface CdpDiagnostics {
  totalCustomers: number;
  totalIdentityLinks: number;
  mappedLinks: number;
  overallMappingRate: number;
  events24h: number;
  events7d: number;
  events30d: number;
  posOnlyCustomers: number;
  cdpOnlyCustomers: number;
  fusedCustomers: number;
  byProvider: CdpProviderStats[];
  webhookReliability: WebhookReliability[];
  sourceConflicts: SourceConflictBucket[];
  computedAt: string;
  source: string;
}

interface CdpFunnel {
  pageViewCount: number;
  cartAddCount: number;
  checkoutStartCount: number;
  purchaseCount: number;
  cartConversionRate: number;
  checkoutConversionRate: number;
  purchaseConversionRate: number;
  cartToPurchaseRate: number;
  computedAt: string;
  source: string;
}

interface CdpTimelineBucket {
  hour: number;
  count: number;
  byEvent: Record<string, number>;
}

interface CdpActiveCustomer {
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  customerGrade: string | null;
  events30d: number;
  eventsByName: Record<string, number>;
  revenue30d: number;
  activeSources: string[];
  primarySource: string | null;
  preferredChannel: string | null;
  lastActivityAt: string | null;
}

interface CdpActiveCustomers {
  topCustomers: CdpActiveCustomer[];
  totalActiveCustomers: number;
  anonymousEventCount: number;
  computedAt: string;
  source: string;
}

interface ChannelGroup {
  channel: string;
  customerIds: string[];
  count: number;
}

interface ChannelDistribution {
  total: number;
  groups: ChannelGroup[];
  unreachable: number;
  computedAt: string;
}

interface ChannelCapabilities {
  smsLms: boolean;
  kakao: boolean;
  email: boolean;
  webPush: boolean;
  inApp: boolean;
  computedAt: string;
}

interface CdpExplainFactor {
  category: string;
  label: string;
  impactScore: number;
  direction: 'positive' | 'negative' | 'neutral';
  detail: string;
  sourceField: string;
}

interface CdpExplanation {
  overallHealthScore: number;
  topInsight: string;
  factors: CdpExplainFactor[];
  recommendations: string[];
  explainedAt: string;
}

const SOURCE_LABEL: Record<string, string> = {
  custom_sdk: '자체 SDK',
  cdp_self_hosted: '자체 호스팅',
  cafe24: '카페24',
  shopify: 'Shopify',
  makeshop: '메이크샵',
  imweb: 'imweb',
  sixshop: '식스샵',
  woocommerce: 'WooCommerce',
  naver: '네이버 스마트스토어',
  sync: '싱크에이전트',
  upload: '파일 업로드',
  manual: '수동 입력',
};

const CHANNEL_LABEL: Record<string, string> = {
  KAKAO: '알림톡',
  LMS: '장문 SMS',
  SMS: '단문 SMS',
  EMAIL: '이메일',
  WEB_PUSH: '웹 푸시',
  IN_APP: '인앱',
  NONE: '발송 불가',
};

const CHANNEL_COLOR: Record<string, string> = {
  KAKAO: '#fbbf24',
  LMS: '#a78bfa',
  SMS: '#60a5fa',
  EMAIL: '#34d399',
  WEB_PUSH: '#fb7185',
  IN_APP: '#22d3ee',
  NONE: '#64748b',
};

// ════════════════════════════════════════════════════════════════════
// 메인 컴포넌트
// ════════════════════════════════════════════════════════════════════

export default function CdpSettingsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const toast = useToast();

  // 진단 + 차트 영역
  const [diagnostics, setDiagnostics] = useState<CdpDiagnostics | null>(null);
  const [funnel, setFunnel] = useState<CdpFunnel | null>(null);
  const [timeline, setTimeline] = useState<CdpTimelineBucket[]>([]);
  const [activeCustomers, setActiveCustomers] = useState<CdpActiveCustomers | null>(null);
  const [channelDist, setChannelDist] = useState<ChannelDistribution | null>(null);
  const [channelCaps, setChannelCaps] = useState<ChannelCapabilities | null>(null);
  const [explanation, setExplanation] = useState<CdpExplanation | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  // 기존 (운영 유지)
  const [usage, setUsage] = useState<CdpUsage | null>(null);
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [allowedOrigins, setAllowedOrigins] = useState<string[]>([]);
  const [newOrigin, setNewOrigin] = useState('');
  const [issuedSecret, setIssuedSecret] = useState<IssueKeyResponse | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'key' | 'secret'>('idle');
  const [cafe24Status, setCafe24Status] = useState<Cafe24Status | null>(null);
  const [cafe24MallId, setCafe24MallId] = useState('');
  const [cafe24Connecting, setCafe24Connecting] = useState(false);
  const [naverStatus, setNaverStatus] = useState<NaverCommerceStatus | null>(null);
  const [naverStoreId, setNaverStoreId] = useState('');
  const [naverConnecting, setNaverConnecting] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [customInfo, setCustomInfo] = useState<CustomWebhookInfo | null>(null);
  const [customIssuedSecret, setCustomIssuedSecret] = useState<CustomIssuedSecret | null>(null);
  const [customIssuing, setCustomIssuing] = useState(false);
  const [copyStatusCustom, setCopyStatusCustom] = useState<'idle' | 'secret' | 'url' | 'companyId'>('idle');

  // UI 영역
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const token = () => localStorage.getItem('token');
  const isAdmin = user?.userType === 'company_admin';

  // first-event 설치 진단 — 키 발급 후 첫 이벤트 수신 전까지 10초 폴링 (수신되면 중단)
  useEffect(() => {
    if (!usage?.has_key) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await fetch('/api/cdp/install-status', { headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (!stopped && data.success) {
          setInstallStatus(data);
          if (data.firstEventAt) return; // 첫 이벤트 수신 → 폴링 종료
        }
      } catch { /* 네트워크 일시 오류 무시 */ }
      if (!stopped) timer = setTimeout(poll, 10000);
    };
    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [usage?.has_key]);

  // 수집 허용 도메인 로드 (브라우저 SDK Origin allowlist)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/cdp/allowed-origins', { headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (data.success) setAllowedOrigins(data.origins || []);
      } catch { /* 무시 */ }
    })();
  }, []);

  const addOrigin = async () => {
    const o = newOrigin.trim();
    if (!o) return;
    try {
      const res = await fetch('/api/cdp/allowed-origins', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: o }),
      });
      const data = await res.json();
      if (data.success) { setAllowedOrigins(data.origins || []); setNewOrigin(''); toast.success('도메인이 등록되었습니다.'); }
      else toast.error(data.error || '도메인 등록 실패');
    } catch { toast.error('도메인 등록 네트워크 오류'); }
  };

  const removeOrigin = async (o: string) => {
    try {
      const res = await fetch('/api/cdp/allowed-origins', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: o }),
      });
      const data = await res.json();
      if (data.success) { setAllowedOrigins(data.origins || []); toast.success('도메인이 삭제되었습니다.'); }
      else toast.error(data.error || '도메인 삭제 실패');
    } catch { toast.error('도메인 삭제 네트워크 오류'); }
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExplanation(null);
    try {
      const headers = { Authorization: `Bearer ${token()}` };
      const [
        usageRes, diagRes, funnelRes, timelineRes, activeRes, chDistRes,
        cafe24Res, naverRes, providersRes, customRes,
      ] = await Promise.all([
        fetch('/api/cdp/usage', { headers }),
        fetch('/api/cdp/diagnostics', { headers }),
        fetch('/api/cdp/funnel?days=30', { headers }),
        fetch('/api/cdp/timeline', { headers }),
        fetch('/api/cdp/active-customers?limit=10', { headers }),
        fetch('/api/cdp/channel-distribution', { headers }),
        fetch('/api/cafe24/status', { headers }),
        fetch('/api/naver-commerce/status', { headers }),
        fetch('/api/cdp/providers', { headers }),
        fetch('/api/cdp/custom/info', { headers }),
      ]);
      const usageData = await usageRes.json();
      const diagData = await diagRes.json();
      const funnelData = await funnelRes.json();
      const timelineData = await timelineRes.json();
      const activeData = await activeRes.json();
      const chDistData = await chDistRes.json();
      const cafe24Data = await cafe24Res.json();
      const naverData = await naverRes.json();
      const providersData = await providersRes.json();
      const customData = await customRes.json();

      if (usageData.success) setUsage(usageData);
      if (diagData.success) setDiagnostics(diagData.diagnostics);
      if (funnelData.success) setFunnel(funnelData.funnel);
      if (timelineData.success) setTimeline(timelineData.timeline || []);
      if (activeData.success) setActiveCustomers(activeData.activeCustomers);
      if (chDistData.success) {
        setChannelDist(chDistData.distribution);
        setChannelCaps(chDistData.capabilities);
      }
      if (cafe24Data.success) setCafe24Status(cafe24Data);
      if (naverData.success) setNaverStatus(naverData);
      if (providersData.success) setProviders(providersData.providers || []);
      if (customData.success) {
        setCustomInfo({
          hasSecret: customData.hasSecret,
          webhookUrl: customData.webhookUrl,
          issuedAt: customData.issuedAt,
          companyId: customData.companyId,
        });
      }
    } catch (e: any) {
      setError(e?.message || '네트워크 오류');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // AI 진단 (비동기 로드 — 모델 영역 backend 분리 정합)
  const loadExplanation = async () => {
    if (explanation || explainLoading) return;
    setExplainLoading(true);
    try {
      const res = await fetch('/api/cdp/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: '{}',
      });
      const data = await res.json();
      if (data.success) setExplanation(data.explanation);
      else toast.error(data.error || 'AI 진단 실패');
    } catch { toast.error('AI 진단 네트워크 오류'); }
    finally { setExplainLoading(false); }
  };

  // CDP 키 발급
  const handleIssueKey = async () => {
    if (usage?.has_key) {
      setConfirm({
        mode: 'danger',
        title: 'CDP 키 재발급',
        description: '기존 키는 즉시 폐기되며, 자사몰 코드의 키를 새 값으로 교체할 때까지 sync가 중단됩니다.',
        confirmLabel: '재발급 진행',
        onConfirm: async () => { await issueKey(); },
      });
    } else {
      await issueKey();
    }
  };
  const issueKey = async () => {
    setIssuing(true);
    try {
      const res = await fetch('/api/cdp/issue-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        setIssuedSecret(data);
        toast.success('CDP 키 발급 완료 — Secret을 즉시 저장해주세요.');
        await loadAll();
      } else { toast.error(data.error || '키 발급 실패'); }
    } catch (e: any) { toast.error(e?.message || '키 발급 처리 오류'); }
    finally { setIssuing(false); }
  };

  // 카페24
  const handleCafe24Connect = async () => {
    const trimmed = cafe24MallId.trim().toLowerCase();
    if (!trimmed || !/^[a-z0-9_-]+$/i.test(trimmed)) {
      toast.error('카페24 mall_id 형식이 올바르지 않습니다 (예: hanjullo-test)');
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
        toast.info('새 창에서 카페24 로그인 + 동의 완료 후 새로고침해주세요.');
      } else { toast.error(data.error || '카페24 연동 시작 실패'); }
    } catch (e: any) { toast.error(e?.message || '카페24 연동 처리 오류'); }
    finally { setCafe24Connecting(false); }
  };
  const handleCafe24Disconnect = () => {
    setConfirm({
      mode: 'danger',
      title: '카페24 연동 해제',
      description: '자사몰 → 한줄로 sync가 즉시 중단됩니다.',
      onConfirm: async () => {
        const res = await fetch('/api/cafe24/disconnect', { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (data.success) { await loadAll(); toast.success('카페24 연동 해제 완료'); }
        else { toast.error(data.error || '연동 해제 실패'); }
      },
    });
  };

  // 네이버 스마트스토어
  const handleNaverConnect = async () => {
    const trimmed = naverStoreId.trim();
    if (!trimmed) { toast.error('네이버 스마트스토어 store_id를 입력해주세요.'); return; }
    setNaverConnecting(true);
    try {
      const res = await fetch(`/api/naver-commerce/oauth/authorize?store_id=${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && data.authorize_url) {
        window.open(data.authorize_url, 'naver_oauth', 'width=720,height=820');
        toast.info('새 창에서 네이버 로그인 + 동의 완료 후 새로고침해주세요.');
      } else { toast.error(data.error || '네이버 스마트스토어 연동 시작 실패'); }
    } catch (e: any) { toast.error(e?.message || '네이버 스마트스토어 처리 오류'); }
    finally { setNaverConnecting(false); }
  };
  const handleNaverDisconnect = () => {
    setConfirm({
      mode: 'danger',
      title: '네이버 스마트스토어 연동 해제',
      description: '자사몰 → 한줄로 sync가 즉시 중단됩니다.',
      onConfirm: async () => {
        const res = await fetch('/api/naver-commerce/disconnect', { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (data.success) { await loadAll(); toast.success('네이버 스마트스토어 연동 해제 완료'); }
        else { toast.error(data.error || '연동 해제 실패'); }
      },
    });
  };

  // 자체 호스팅
  const handleCustomIssue = async () => {
    if (customInfo?.hasSecret) {
      setConfirm({
        mode: 'danger',
        title: 'Webhook Secret 재발급',
        description: '기존 secret이 즉시 폐기되며 자사몰 서버 환경변수 교체까지 webhook이 거부됩니다.',
        confirmLabel: '재발급 진행',
        onConfirm: async () => { await issueCustomSecret(); },
      });
    } else {
      await issueCustomSecret();
    }
  };
  const issueCustomSecret = async () => {
    setCustomIssuing(true);
    try {
      const res = await fetch('/api/cdp/custom/issue-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) {
        setCustomIssuedSecret(data);
        toast.success('Webhook Secret 발급 완료 — 즉시 저장해주세요.');
        await loadAll();
      } else { toast.error(data.error || 'webhook_secret 발급 실패'); }
    } catch (e: any) { toast.error(e?.message || 'webhook_secret 발급 오류'); }
    finally { setCustomIssuing(false); }
  };
  const handleCustomRevoke = () => {
    setConfirm({
      mode: 'danger',
      title: '자체 호스팅 연동 해제',
      description: '자사몰에서 보낸 webhook이 즉시 차단됩니다.',
      onConfirm: async () => {
        const res = await fetch('/api/cdp/custom/revoke', { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (data.success) { await loadAll(); toast.success('자체 호스팅 연동 해제 완료'); }
        else { toast.error(data.error || '연동 해제 실패'); }
      },
    });
  };

  // 1-click 액션 진입
  const handleQuickAction = (action: 'custom' | 'cafe24' | 'naver') => {
    if (action === 'custom') {
      document.getElementById('section-custom')?.scrollIntoView({ behavior: 'smooth' });
    } else if (action === 'cafe24') {
      document.getElementById('section-cafe24')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      document.getElementById('section-naver')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // 복사
  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} 복사 완료`);
    } catch { toast.error('복사 실패 — 브라우저 권한 확인 필요'); }
  };
  const copy = async (text: string, target: 'key' | 'secret') => {
    try { await navigator.clipboard.writeText(text); setCopyStatus(target); setTimeout(() => setCopyStatus('idle'), 1500); }
    catch { toast.error('복사 실패'); }
  };
  const copyCustom = async (text: string, target: 'secret' | 'url' | 'companyId') => {
    try { await navigator.clipboard.writeText(text); setCopyStatusCustom(target); setTimeout(() => setCopyStatusCustom('idle'), 1500); }
    catch { toast.error('복사 실패'); }
  };

  const formatPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const formatWon = (n: number) => `${Math.round(n).toLocaleString()}원`;

  // 데이터 부족 안내 카드 매트릭스
  const dataAvailabilityCards = useMemo(() => {
    if (!diagnostics) return [];
    const cards: Array<{ level: 'critical' | 'warning' | 'info' | 'good'; icon: typeof Database; title: string; message: string; actionLabel?: string; actionId?: string }> = [];

    const hasAnyProvider = diagnostics.byProvider.length > 0;
    if (!hasAnyProvider) {
      cards.push({
        level: 'warning',
        icon: Database,
        title: '자사몰 미연동',
        message: '자사몰 연동 시 funnel / 매출 / ROAS / 캠페인 반응 매트릭스 자동 활성. 자체 호스팅 / 카페24 / 네이버 영역 중 선택.',
        actionLabel: '자체 호스팅 연동',
        actionId: 'section-custom',
      });
    } else if (diagnostics.events30d === 0) {
      cards.push({
        level: 'warning',
        icon: Activity,
        title: '자사몰 이벤트 0건',
        message: '자사몰 연동되었으나 최근 30일 이벤트 0건 — SDK 설치 또는 webhook 동작 확인 필요.',
        actionLabel: 'SDK 가이드',
        actionId: 'section-custom',
      });
    } else if (diagnostics.events30d < 100) {
      cards.push({
        level: 'info',
        icon: Activity,
        title: 'CDP 이벤트 누적 부족',
        message: `최근 30일 ${diagnostics.events30d}건 — 100건+ 누적 시 funnel + attribution 정확도 향상.`,
      });
    }

    if (hasAnyProvider && diagnostics.overallMappingRate < 0.5 && diagnostics.totalIdentityLinks > 0) {
      cards.push({
        level: 'warning',
        icon: Users,
        title: `매핑률 ${formatPct(diagnostics.overallMappingRate)} — 회원 매칭 영역 약함`,
        message: '자사몰 회원 영역 안 phone/email 영역 있는지 확인 의무. 익명 이벤트 영역 = trigger 영역만 활용 가능.',
      });
    }

    const failedWebhooks = diagnostics.webhookReliability.filter((w) => w.failedCount > 0);
    if (failedWebhooks.length > 0) {
      cards.push({
        level: 'warning',
        icon: AlertTriangle,
        title: `Webhook 실패 ${failedWebhooks.reduce((s, w) => s + w.failedCount, 0)}건 (30일)`,
        message: `${failedWebhooks.map((w) => SOURCE_LABEL[w.source] || w.source).join(', ')} 영역 = 서명 검증 또는 endpoint 확인 의무.`,
      });
    }

    if (cards.length === 0 && hasAnyProvider) {
      cards.push({
        level: 'good',
        icon: Check,
        title: '자사몰 영역 정상 작동',
        message: `${diagnostics.byProvider.length}개 Provider 연동 / 30일 ${diagnostics.events30d.toLocaleString()}건 이벤트 / 매핑률 ${formatPct(diagnostics.overallMappingRate)} — 모든 매트릭스 활성.`,
      });
    }
    return cards;
  }, [diagnostics]);

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

  // ════════════════════════════════════════════════════════════════════
  // JSX
  // ════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white flex items-center justify-center">
        <div className="text-white/50 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
          자사몰 영역 진단 + 매트릭스 로드 중...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-900 via-fuchsia-900 to-violet-900 text-white">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      {/* 1. 상단 헤더 */}
      {/* ★ D222+ Phase 2 (2026-05-27): 다크 → 보라 톤 다운 sticky 헤더 */}
      <div className="bg-violet-800/50 backdrop-blur-md border-b border-violet-400/30 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 md:py-4 flex items-center gap-3 flex-wrap">
          <button onClick={() => navigate('/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/20">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold text-white">자사몰 연동 (CDP)</h1>
              <span className="text-[10px] bg-gradient-to-r from-amber-400 to-orange-500 text-white px-2 py-0.5 rounded-full font-bold tracking-wide">BETA</span>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">자체 호스팅 · 네이버 · 카페24 · 싱크에이전트 통합 — Unified Customer Profile 매트릭스</p>
          </div>
          <button onClick={loadAll} disabled={loading} className="p-2 rounded-lg hover:bg-white/10 transition-colors" title="새로고침">
            <RefreshCw className={`w-4 h-4 text-white/60 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 space-y-5">
        {error && (
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-6 text-amber-200">{error}</div>
        )}

        {/* 2. 요금제 게이팅 안내 */}
        {!usage?.cdp_enabled && (
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold text-amber-100 mb-1">현재 요금제: {usage?.plan_name || '미가입'} — CDP 사용 불가</div>
              <div className="text-sm text-amber-200">자사몰 회원 DB 영역 ↔ 한줄로AI 실시간 동기화 영역 = <strong>비즈니스 요금제</strong> 의무.</div>
            </div>
          </div>
        )}

        {/* 3. 데이터 부족 안내 카드 */}
        {dataAvailabilityCards.length > 0 && (
          <div className="space-y-2">
            {dataAvailabilityCards.map((card, i) => {
              const styleMap = {
                critical: 'bg-rose-500/10 border-rose-400/30 text-rose-100',
                warning: 'bg-amber-500/10 border-amber-400/30 text-amber-100',
                info: 'bg-cyan-500/10 border-cyan-400/30 text-cyan-100',
                good: 'bg-emerald-500/10 border-emerald-400/30 text-emerald-100',
              }[card.level];
              const iconColor = {
                critical: 'text-rose-300', warning: 'text-amber-300', info: 'text-cyan-300', good: 'text-emerald-300',
              }[card.level];
              const IconComp = card.icon;
              return (
                <div key={i} className={`p-4 border rounded-xl ${styleMap}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 ${iconColor}`}>
                      <IconComp className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold mb-0.5">{card.title}</div>
                      <div className="text-xs leading-relaxed opacity-90">{card.message}</div>
                      {card.actionLabel && card.actionId && (
                        <button
                          onClick={() => document.getElementById(card.actionId!)?.scrollIntoView({ behavior: 'smooth' })}
                          className="mt-2 px-2.5 py-1 bg-white/15 hover:bg-white/25 rounded text-[11px] font-medium transition-colors"
                        >
                          {card.actionLabel} →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 4. AI 자율 진단 */}
        {usage?.cdp_enabled && (
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
                  <button onClick={loadExplanation} className="text-xs text-violet-200 hover:text-violet-100 underline-offset-2 hover:underline">
                    AI 자율 진단 시작 →
                  </button>
                ) : (
                  <div className="text-xs text-white/50">AI 진단은 회사 관리자만 가능합니다.</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 5. 1-click 액션 3 카드 */}
        {usage?.cdp_enabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <QuickActionCard
              icon={<Server className="w-5 h-5" />}
              title="자체 호스팅 (권장)"
              desc="자체 서버 자사몰 — webhook_secret 발급 + 표준 endpoint"
              color="violet"
              onClick={() => handleQuickAction('custom')}
            />
            <QuickActionCard
              icon={<Store className="w-5 h-5" />}
              title="카페24"
              desc="OAuth 자동 연동 — 코딩 0건"
              color="amber"
              onClick={() => handleQuickAction('cafe24')}
            />
            <QuickActionCard
              icon={<ShoppingCart className="w-5 h-5" />}
              title="네이버 스마트스토어"
              desc="Naver Commerce OAuth — 주문 + 회원 sync"
              color="emerald"
              onClick={() => handleQuickAction('naver')}
            />
          </div>
        )}

        {/* 6. 요약 5 metric */}
        {diagnostics && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <MetricBlock label="회사 전체 customer" value={diagnostics.totalCustomers.toLocaleString()} color="text-blue-300" />
              <MetricBlock label="매핑 customer" value={diagnostics.mappedLinks.toLocaleString()} sub={`매핑률 ${formatPct(diagnostics.overallMappingRate)}`} color="text-cyan-300" />
              <MetricBlock label="30일 이벤트" value={diagnostics.events30d.toLocaleString()} sub={`24h ${diagnostics.events24h.toLocaleString()}`} color="text-violet-300" />
              <MetricBlock label="융합 customer" value={diagnostics.fusedCustomers.toLocaleString()} sub={`POS+CDP 양쪽`} color="text-emerald-300" />
              <MetricBlock label="자사몰만 customer" value={diagnostics.cdpOnlyCustomers.toLocaleString()} sub="(POS 영역 미존재)" color="text-amber-300" />
            </div>
            <div className="mt-2 text-[10px] text-white/40">{diagnostics.source}</div>
          </div>
        )}

        {/* 7. 자세히 분석 토글 */}
        {usage?.cdp_enabled && (
          <button
            onClick={() => setDetailsExpanded(!detailsExpanded)}
            className="w-full px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-white/60 flex items-center justify-center gap-1.5 transition-colors"
          >
            {detailsExpanded ? (
              <><ChevronLeft className="w-3 h-3 rotate-90" /> 간소 보기 — 자세한 차트 숨기기</>
            ) : (
              <><ChevronRight className="w-3 h-3 rotate-90" /> 자세한 분석 펼치기 (funnel / timeline / Provider / POS↔CDP / Webhook / 채널 분포)</>
            )}
          </button>
        )}

        {detailsExpanded && (
          <div className="space-y-4">
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
              <ChartCard title="Provider별 매핑률 매트릭스" source="cdp_identity_links group by source" icon={<Database className="w-4 h-4 text-violet-300" />}>
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
              <ChartCard title="Webhook 신뢰성 매트릭스 (30일)" source="cdp_webhook_deliveries status" icon={<AlertTriangle className="w-4 h-4 text-rose-300" />}>
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
              <ChartCard title="발송 채널 자동 분배 매트릭스" source="customers.preferred_channel (CT-71 unified profile)" icon={<MousePointerClick className="w-4 h-4 text-fuchsia-300" />}>
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
          </div>
        )}

        {/* 9. AI 영향 요인 매트릭스 */}
        {explanation && explanation.factors.length > 0 && (
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-semibold">AI 자사몰 영향 요인 매트릭스</h2>
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

        {/* 10. 자사몰 활성 customer top 10 */}
        {activeCustomers && activeCustomers.topCustomers.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <Users className="w-4 h-4 text-cyan-300" />
              <h2 className="text-sm font-semibold">자사몰 활성 Customer Top {activeCustomers.topCustomers.length}</h2>
              <span className="ml-auto text-[10px] text-white/40">
                30일 활성 전체 {activeCustomers.totalActiveCustomers.toLocaleString()}명 · 비회원 이벤트 {activeCustomers.anonymousEventCount.toLocaleString()}건
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr className="text-left text-white/60">
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium text-center">primary source</th>
                    <th className="px-3 py-2 font-medium text-center">채널</th>
                    <th className="px-3 py-2 font-medium text-right">30일 이벤트</th>
                    <th className="px-3 py-2 font-medium text-right">30일 매출</th>
                    <th className="px-3 py-2 font-medium text-right">최근 활동</th>
                  </tr>
                </thead>
                <tbody>
                  {activeCustomers.topCustomers.map((c) => (
                    <tr key={c.customerId} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2">
                        <div className="text-white/80">{c.customerName || '-'}</div>
                        <div className="text-[10px] text-white/40 font-mono">{c.customerPhone || ''} · {c.customerGrade || ''}</div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {c.primarySource ? (
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded">
                            {SOURCE_LABEL[c.primarySource] || c.primarySource}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {c.preferredChannel ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: `${CHANNEL_COLOR[c.preferredChannel]}30`, color: CHANNEL_COLOR[c.preferredChannel] }}>
                            {CHANNEL_LABEL[c.preferredChannel] || c.preferredChannel}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-cyan-300">{c.events30d.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-300">{c.revenue30d > 0 ? formatWon(c.revenue30d) : '-'}</td>
                      <td className="px-3 py-2 text-right text-[10px] text-white/50">{c.lastActivityAt ? new Date(c.lastActivityAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 11. Provider 매트릭스 — 자체 호스팅 */}
        {usage?.cdp_enabled && (
          <div id="section-custom" className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-1">
              <Server className="w-5 h-5 text-indigo-300" />
              <h2 className="text-base font-bold text-white">자체 호스팅 자사몰 (Webhook + SDK)</h2>
              <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-medium">권장</span>
            </div>
            <div className="text-xs text-white/50 mb-4">
              자체 서버 자사몰 (Next.js / Node / Django / PHP / Rails 등) → webhook_secret 발급 → 표준 endpoint → 한줄로AI 자동 동기화.
            </div>

            {customIssuedSecret && (
              <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-xl p-5 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <Check className="w-5 h-5 text-emerald-300" />
                  <h3 className="text-sm font-bold text-emerald-100">webhook_secret 발급 완료</h3>
                </div>
                <div className="text-xs text-emerald-200 mb-4 leading-relaxed">
                  ★ <strong>본 화면을 닫으면 webhook_secret을 다시 볼 수 없습니다.</strong> 자체 서버 환경변수에 즉시 저장 의무.
                </div>
                <div className="space-y-3">
                  <SecretRow label="Webhook Secret (X-Hanjullo-Signature) ★ 1회 노출" value={customIssuedSecret.webhook_secret} copied={copyStatusCustom === 'secret'} onCopy={() => copyCustom(customIssuedSecret.webhook_secret, 'secret')} danger />
                  <SecretRow label="Webhook URL" value={customIssuedSecret.webhook_url} copied={copyStatusCustom === 'url'} onCopy={() => copyCustom(customIssuedSecret.webhook_url, 'url')} />
                  <SecretRow label="Company ID" value={customIssuedSecret.company_id} copied={copyStatusCustom === 'companyId'} onCopy={() => copyCustom(customIssuedSecret.company_id, 'companyId')} />
                </div>
                <button onClick={() => setCustomIssuedSecret(null)} className="mt-4 px-4 py-2 bg-emerald-500/20 border border-emerald-400/40 hover:bg-emerald-500/30 text-emerald-200 text-sm font-medium rounded-lg">
                  확인 — secret 저장 완료
                </button>
              </div>
            )}

            {customInfo?.hasSecret && !customIssuedSecret ? (
              <div className="space-y-3">
                <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-3 text-sm text-emerald-100">
                  webhook_secret 발급됨 · 발급일 {customInfo.issuedAt ? new Date(customInfo.issuedAt).toLocaleString('ko-KR') : '-'}
                </div>
                <div className="text-xs text-white/50 leading-relaxed">
                  Webhook URL: <code className="text-white/70 font-mono">{customInfo.webhookUrl}</code>
                </div>
                {isAdmin && (
                  <div className="flex gap-2">
                    <button onClick={handleCustomIssue} disabled={customIssuing} className="px-4 py-2 bg-white/5 border border-white/10 hover:bg-white/10 text-white/80 text-sm font-medium rounded-lg disabled:opacity-40">
                      {customIssuing ? '재발급 중...' : 'Secret 재발급'}
                    </button>
                    <button onClick={handleCustomRevoke} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
                      <Unlink className="w-4 h-4" /> 연동 해제
                    </button>
                  </div>
                )}
              </div>
            ) : !customIssuedSecret && (
              <div className="space-y-3">
                <div className="text-sm text-white/70">webhook_secret이 아직 발급되지 않았습니다. 발급 시 secret + URL + company_id 한 쌍이 생성됩니다.</div>
                {isAdmin ? (
                  <button onClick={handleCustomIssue} disabled={customIssuing} className="px-4 py-2 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center gap-2">
                    <KeyRound className="w-4 h-4" /> {customIssuing ? '발급 중...' : 'webhook_secret 발급'}
                  </button>
                ) : <div className="text-xs text-white/50">발급은 회사 관리자만 가능합니다.</div>}
              </div>
            )}
          </div>
        )}

        {/* 11. Provider 매트릭스 — 카페24 */}
        {usage?.cdp_enabled && (
          <div id="section-cafe24" className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Store className="w-5 h-5 text-amber-300" />
              <h2 className="text-base font-bold text-white">카페24 연동</h2>
              <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-medium">OAuth — 코딩 0건</span>
            </div>

            {cafe24Status?.connected ? (
              <div className="space-y-3">
                <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4 flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-emerald-100">{cafe24Status.mall_id} 카페24 연동됨</div>
                    <div className="text-xs text-emerald-300 mt-1">
                      status: {cafe24Status.status} · 토큰 만료: {cafe24Status.token_expires_at ? new Date(cafe24Status.token_expires_at).toLocaleString('ko-KR') : '-'}
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={handleCafe24Disconnect} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
                    <Unlink className="w-4 h-4" /> 연동 해제
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-white/70">카페24 mall_id 입력 → OAuth 새 창 → 자동 회원/주문 sync.</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={cafe24MallId}
                    onChange={(e) => setCafe24MallId(e.target.value)}
                    placeholder="예: hanjullo-test"
                    className="flex-1 px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/50"
                  />
                  <button onClick={handleCafe24Connect} disabled={cafe24Connecting || !isAdmin || !cafe24MallId.trim()} className="px-4 py-2 bg-amber-500/30 hover:bg-amber-500/50 text-amber-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center gap-2">
                    <Link2 className="w-4 h-4" /> {cafe24Connecting ? '연동 중...' : '카페24 연동'}
                  </button>
                </div>
                <div className="text-xs text-white/40">★ admin URL <span className="font-mono">https://hanjullo-test.cafe24.com/admin</span> → mall_id = <span className="font-mono">hanjullo-test</span></div>
              </div>
            )}
          </div>
        )}

        {/* 11. Provider 매트릭스 — 네이버 스마트스토어 */}
        {usage?.cdp_enabled && (
          <div id="section-naver" className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShoppingCart className="w-5 h-5 text-emerald-300" />
              <h2 className="text-base font-bold text-white">네이버 스마트스토어 연동</h2>
              <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full font-medium">Naver Commerce OAuth</span>
            </div>

            {naverStatus?.connected ? (
              <div className="space-y-3">
                <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4 flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-emerald-100">{naverStatus.store_id} 네이버 스마트스토어 연동됨</div>
                    <div className="text-xs text-emerald-300 mt-1">status: {naverStatus.status} · 토큰 만료: {naverStatus.token_expires_at ? new Date(naverStatus.token_expires_at).toLocaleString('ko-KR') : '-'}</div>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={handleNaverDisconnect} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
                    <Unlink className="w-4 h-4" /> 연동 해제
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-white/70">네이버 스마트스토어 store_id 입력 → OAuth → 주문 + 회원 sync.</div>
                <div className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-400/30 rounded p-2">
                  ★ 네이버 정책 영역: 개인정보 영역 제한 — phone/email 영역 없을 가능. 매칭률 영역 약함 가능.
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={naverStoreId}
                    onChange={(e) => setNaverStoreId(e.target.value)}
                    placeholder="네이버 스마트스토어 store_id"
                    className="flex-1 px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50"
                  />
                  <button onClick={handleNaverConnect} disabled={naverConnecting || !isAdmin || !naverStoreId.trim()} className="px-4 py-2 bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center gap-2">
                    <Link2 className="w-4 h-4" /> {naverConnecting ? '연동 중...' : '네이버 연동'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 11. Provider 매트릭스 — skeleton (coming soon) */}
        {providers.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Database className="w-5 h-5 text-white/60" />
              <h2 className="text-base font-bold text-white">지원 자사몰 매트릭스</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {providers.map((p) => (
                <div key={p.provider} className={`p-3 rounded-lg border ${p.status === 'available' ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-white/5 border-white/10'}`}>
                  <div className="text-sm font-semibold text-white">{p.displayName}</div>
                  <div className="text-[10px] text-white/40 mt-0.5">
                    {p.capabilities.oauth && 'OAuth · '}
                    {p.capabilities.webhook && 'Webhook · '}
                    {p.capabilities.adminApi && 'Admin API'}
                  </div>
                  <div className={`mt-1 text-[10px] font-semibold ${p.status === 'available' ? 'text-emerald-300' : 'text-white/40'}`}>
                    {p.status === 'available' ? '지원' : 'Phase 2 예정'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 12. CDP 키 발급 + 사용량 */}
        {usage?.cdp_enabled && !customInfo?.hasSecret && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound className="w-5 h-5 text-indigo-300" />
              <h2 className="text-base font-bold text-white">CDP API 키 (legacy 자사몰 직접 호출용)</h2>
            </div>
            {issuedSecret ? (
              <div className="space-y-3">
                <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded p-2">
                  ★ Secret은 본 화면에서만 1회 노출됩니다. 자사몰에 즉시 저장 의무.
                </div>
                <SecretRow label="Public Key (X-Hanjullo-Key)" value={issuedSecret.cdp_api_key} copied={copyStatus === 'key'} onCopy={() => copy(issuedSecret.cdp_api_key, 'key')} />
                <SecretRow label="Secret Key (X-Hanjullo-Secret) ★ 1회 노출" value={issuedSecret.cdp_api_secret} copied={copyStatus === 'secret'} onCopy={() => copy(issuedSecret.cdp_api_secret, 'secret')} danger />
                <button onClick={() => setIssuedSecret(null)} className="px-4 py-2 bg-emerald-500/20 border border-emerald-400/40 hover:bg-emerald-500/30 text-emerald-200 text-sm font-medium rounded-lg">
                  확인 — 키 저장 완료
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-white/70">
                  {usage.has_key
                    ? `발급 일시: ${usage.issued_at ? new Date(usage.issued_at).toLocaleString('ko-KR') : '-'}`
                    : 'CDP 키 미발급. 발급 시 Public Key + Secret 한 쌍 생성.'}
                </div>
                {isAdmin && (
                  <button onClick={handleIssueKey} disabled={issuing} className="px-4 py-2 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 text-sm font-medium rounded-lg disabled:opacity-40">
                    {issuing ? '발급 중...' : (usage.has_key ? '재발급' : '키 발급')}
                  </button>
                )}
              </div>
            )}
            {usage.cdp_enabled && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="text-xs text-white/50 mb-1">이번 달 API 호출</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-indigo-300">{usage.used.toLocaleString()}</span>
                  <span className="text-xs text-white/50">/ {usage.monthly_limit === null ? '무제한' : `${usage.monthly_limit.toLocaleString()}건`}</span>
                </div>
                {usage.monthly_limit !== null && (
                  <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden mt-2">
                    <div className="bg-indigo-500 h-2 transition-all" style={{ width: `${Math.min((usage.used / usage.monthly_limit) * 100, 100)}%` }} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 12-0. 수집 허용 도메인 등록 (브라우저 SDK Origin allowlist) */}
        {usage?.cdp_enabled && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
                <Link2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">수집 허용 도메인</h2>
                <div className="text-xs text-white/50">자사몰 도메인을 등록해야 브라우저 SDK 수집이 허용됩니다. (예: https://www.example.com)</div>
              </div>
            </div>
            {isAdmin ? (
              <div className="flex gap-2 mb-3 flex-wrap">
                <input
                  value={newOrigin}
                  onChange={(e) => setNewOrigin(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addOrigin(); }}
                  placeholder="https://www.example.com"
                  className="flex-1 min-w-[200px] bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400"
                />
                <button onClick={addOrigin} className="px-4 py-2 bg-violet-500/40 hover:bg-violet-500/60 text-white rounded-lg text-sm font-medium">추가</button>
              </div>
            ) : (
              <div className="text-xs text-white/40 mb-3">도메인 등록은 회사 관리자만 가능합니다.</div>
            )}
            {allowedOrigins.length > 0 ? (
              <div className="space-y-1.5">
                {allowedOrigins.map((o) => (
                  <div key={o} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                    <span className="text-sm text-white/80 font-mono break-all">{o}</span>
                    {isAdmin && (
                      <button onClick={() => removeOrigin(o)} className="text-rose-300 hover:text-rose-200 text-xs shrink-0 ml-2">삭제</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-white/40">등록된 도메인이 없습니다. 자사몰 도메인을 추가해주세요.</div>
            )}
            <div className="text-[10px] text-white/30 italic mt-2">Data source — companies.cdp_allowed_origins</div>
          </div>
        )}

        {/* 12-1. SDK 설치 스크립트 스니펫 (public key 자동 주입 — v0.3.5-b) */}
        {usage?.cdp_enabled && usage?.public_key && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
                <Code2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">SDK 설치 스크립트</h2>
                <div className="text-xs text-white/50">자사몰 &lt;head&gt;에 붙여넣으면 고객 행동 수집이 시작됩니다.</div>
              </div>
            </div>
            {(() => {
              const snippet = `<script src="https://cdn.hanjul.ai/sdk/v0.3.5/hanjul.min.js" data-hjl-key="${usage.public_key}" async></script>`;
              return (
                <>
                  <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre-wrap break-all">{snippet}</pre>
                  <button
                    onClick={() => copyText(snippet, '설치 스크립트')}
                    className="mt-2 px-3 py-2 bg-violet-500/40 hover:bg-violet-500/60 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />복사
                  </button>
                </>
              );
            })()}
            <div className="text-[10px] text-white/30 italic mt-2">Data source — pinned CDN(cdn.hanjul.ai/sdk/v0.3.5)</div>
          </div>
        )}

        {/* 12-2. 설치 검증 — 첫 이벤트 진단 (v0.3.5-b, 서버 관측 신호) */}
        {usage?.cdp_enabled && usage?.public_key && installStatus && (() => {
          const issued = installStatus.keyIssuedAt ? new Date(installStatus.keyIssuedAt).getTime() : null;
          const mins = issued ? Math.floor((Date.now() - issued) / 60000) : 0;
          const received = !!installStatus.firstEventAt;
          const guide = received
            ? '첫 이벤트 수신 완료 — 설치가 정상 동작합니다.'
            : mins < 5 ? '설치 후 첫 이벤트 대기 중 — 자사몰 페이지를 한 번 열어보세요.'
            : mins < 10 ? '5분 경과 — 스크립트가 <head>에 들어갔는지, 자사몰을 방문했는지 확인하세요.'
            : mins < 30 ? '10분 경과 — 스크립트 경로/키 값과 광고/보안 차단을 점검하세요.'
            : '30분 경과 — 설치 점검이 필요합니다. 스크립트 로드 여부와 키 발급 상태를 확인하세요.';
          const steps = [
            { label: '첫 이벤트 수신', done: received },
            { label: '페이지뷰', done: installStatus.signals.pageview },
            { label: '회원 식별(data-hjl-user-id)', done: installStatus.signals.identify },
            { label: '마케팅 동의', done: installStatus.signals.consent },
          ];
          return (
            <div className={`border rounded-2xl p-6 ${received ? 'bg-emerald-500/10 border-emerald-400/30' : 'bg-white/5 border-white/10'}`}>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${received ? 'bg-emerald-500/30' : 'bg-gradient-to-br from-violet-500 to-fuchsia-600'}`}>
                  {received ? <Check className="w-5 h-5 text-emerald-200" /> : <Activity className="w-5 h-5 text-white" />}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-white">설치 검증 — 첫 이벤트</h2>
                  <div className="text-xs text-white/50">{guide}</div>
                </div>
                {received && (
                  <span className="ml-auto text-xs text-emerald-200 shrink-0">총 {installStatus.total.toLocaleString()}건 · 24h {installStatus.count24h.toLocaleString()}건</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {steps.map((s) => (
                  <div key={s.label} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${s.done ? 'bg-emerald-500/10 text-emerald-200' : 'bg-white/5 text-white/50'}`}>
                    {s.done ? <Check className="w-3.5 h-3.5 shrink-0" /> : <div className="w-3.5 h-3.5 rounded-full border border-white/30 shrink-0" />}
                    {s.label}
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-white/30 italic mt-2">Data source — cdp_events 수신 신호(서버 관측)</div>
            </div>
          );
        })()}

        {/* 13. 컴퓨팅 시점 */}
        {diagnostics && (
          <div className="text-center text-[11px] text-white/40 pt-2">
            마지막 진단: {new Date(diagnostics.computedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
            <br />
            Unified Customer Profile 영역 = 5분 cron 자동 재계산 (CT-71) · 이벤트 ingestion 즉시 union (CT-72)
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 컴포넌트 매트릭스
// ════════════════════════════════════════════════════════════════════

function MetricBlock({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="p-3 bg-white/5 rounded-lg">
      <div className="text-[10px] text-white/40 mb-1">{label}</div>
      <div className={`text-base md:text-lg font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

function QuickActionCard({ icon, title, desc, color, onClick }: { icon: React.ReactNode; title: string; desc: string; color: 'violet' | 'amber' | 'emerald'; onClick: () => void }) {
  const colorMap = {
    violet: { bg: 'bg-violet-500/10', border: 'border-violet-400/30', text: 'text-violet-100', iconBg: 'bg-violet-500/30', iconText: 'text-violet-200', btn: 'bg-violet-500/30 hover:bg-violet-500/50 text-violet-50' },
    amber: { bg: 'bg-amber-500/10', border: 'border-amber-400/30', text: 'text-amber-100', iconBg: 'bg-amber-500/30', iconText: 'text-amber-200', btn: 'bg-amber-500/30 hover:bg-amber-500/50 text-amber-50' },
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-400/30', text: 'text-emerald-100', iconBg: 'bg-emerald-500/30', iconText: 'text-emerald-200', btn: 'bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-50' },
  }[color];
  return (
    <div className={`p-4 ${colorMap.bg} border ${colorMap.border} rounded-xl`}>
      <div className="flex items-start gap-2.5 mb-2">
        <div className={`w-9 h-9 rounded-lg ${colorMap.iconBg} flex items-center justify-center flex-shrink-0`}>
          <span className={colorMap.iconText}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${colorMap.text}`}>{title}</div>
        </div>
      </div>
      <div className="text-[11px] text-white/60 leading-relaxed mb-2.5">{desc}</div>
      <button onClick={onClick} className={`w-full px-3 py-1.5 ${colorMap.btn} rounded text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors`}>
        <Link2 className="w-3 h-3" /> 연동 영역 진입
      </button>
    </div>
  );
}

function ChartCard({ title, source, icon, children }: { title: string; source?: string; icon: React.ReactNode; children: React.ReactNode }) {
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

function SecretRow({ label, value, copied, onCopy, danger }: { label: string; value: string; copied: boolean; onCopy: () => void; danger?: boolean }) {
  return (
    <div>
      <label className="text-xs font-medium text-white/80 block mb-1">{label}</label>
      <div className="flex gap-2">
        <input readOnly value={value} className={`flex-1 px-3 py-2 bg-violet-900/40 border rounded-lg text-xs font-mono text-white/80 ${danger ? 'border-rose-400/40 border-2' : 'border-white/10'}`} />
        <button onClick={onCopy} className={`px-3 py-2 ${danger ? 'bg-rose-500/40 hover:bg-rose-500/60' : 'bg-indigo-500/40 hover:bg-indigo-500/60'} text-white rounded-lg text-xs font-medium flex items-center gap-1.5`}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? '복사됨' : '복사'}
        </button>
      </div>
    </div>
  );
}
