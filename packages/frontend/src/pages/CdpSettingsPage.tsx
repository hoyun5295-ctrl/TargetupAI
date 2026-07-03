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
import { createPortal } from 'react-dom';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  ArrowLeft, Database, Brain, Loader2, RefreshCw, Sparkles, Users, AlertTriangle,
  Activity, Info, Link2, Store, Server,
  KeyRound, Copy, Check, Unlink, MousePointerClick, AlertCircle, ShoppingCart, Code2, X,
  Eye, EyeOff, ExternalLink, ChevronDown, ChevronUp,
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

interface GodoStatus {
  connected: boolean;
  status?: string;
  connectedAt?: string | null;
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

// 자사몰 선택 카드 — 카드 클릭 시 해당 업체 전용 연동 모달 (가로 2열 그리드)
type ProviderKey = 'cafe24' | 'naver' | 'godo' | 'gabia' | 'custom';

const PROVIDER_CARDS: Array<{ key: ProviderKey; name: string; desc: string; full?: boolean }> = [
  { key: 'cafe24', name: '카페24', desc: 'OAuth 자동 연동 — 코딩 없이 회원·주문 동기화' },
  { key: 'naver', name: '네이버 스마트스토어', desc: 'Commerce OAuth — 주문·회원 동기화' },
  { key: 'godo', name: '고도몰', desc: '쇼핑몰 인증키 입력 — 주문·고객 자동 동기화' },
  { key: 'gabia', name: '가비아', desc: 'webhook 방식 — Secret·SDK 설정으로 연동' },
  { key: 'custom', name: '자체 호스팅 / 그 외 자사몰', desc: '직접 개발했거나 목록에 없는 자사몰 — webhook 방식', full: true },
];

// 고객 self-app에 등록하는 한줄로 고정 콜백 (백엔드 CAFE24_CALLBACK_REDIRECT / NAVER_CALLBACK_REDIRECT 기본값과 동일)
const CAFE24_CALLBACK_URL = 'https://app.hanjul.ai/api/cafe24/oauth/callback';
const NAVER_CALLBACK_URL = 'https://app.hanjul.ai/api/naver-commerce/oauth/callback';
// 고객 self-app에 필요한 권한 (백엔드 DEFAULT_SCOPE와 동일)
const CAFE24_REQUIRED_SCOPES = ['mall.read_customer', 'mall.read_order', 'mall.read_product', 'mall.read_application'];
const NAVER_REQUIRED_SCOPES = ['commerce.product.read', 'commerce.order.read', 'commerce.customer.read'];

const PROVIDER_META: Record<ProviderKey, { title: string; note: string }> = {
  cafe24: { title: '카페24 연동', note: '쇼핑몰 ID만 입력하면 한줄로 공식 카페24 앱으로 연결됩니다. OAuth 동의 후 회원·주문이 자동 동기화됩니다.' },
  naver: { title: '네이버 스마트스토어 연동', note: '네이버 커머스 API센터에서 만든 애플리케이션의 Client ID·Secret을 입력하면, OAuth 인증 후 주문·회원이 동기화됩니다. (네이버 정책상 phone/email이 제한될 수 있어 매칭률이 낮을 수 있습니다.)' },
  godo: { title: '고도몰 연동', note: '고도몰 쇼핑몰 인증키(key)를 입력하면 주문·고객 데이터가 자동으로 동기화됩니다.' },
  gabia: { title: '가비아 연동', note: '가비아 쇼핑몰은 webhook 방식으로 연동합니다. 아래 Secret·도메인·SDK를 설정하세요.' },
  custom: { title: '자체 호스팅 / 그 외 자사몰 연동', note: '직접 개발했거나 목록에 없는 자사몰은 webhook 방식으로 연동합니다. 환경이 특수해 막히면 고객센터로 문의 주세요.' },
};

// ★ 2026-06-25 (gap 3): GET /api/cdp/providers 응답 — 백엔드 registry 단일 출처
type ProviderApiEntry = {
  provider: string;
  displayName: string;
  connectMethod: 'oauth' | 'webhook' | 'polling' | 'none';
  available: boolean;
  status: 'available' | 'coming_soon';
};
// 백엔드 provider 식별자 → 프론트 ProviderKey(전용 모달 보유분). 네이버는 식별자가 naver_smart_store라 매핑.
const BACKEND_ID_TO_KEY: Record<string, ProviderKey> = {
  cafe24: 'cafe24',
  naver_smart_store: 'naver',
  godo: 'godo',
  gabia: 'gabia',
  custom: 'custom',
};

// 카드 렌더 단일 모델 — 백엔드 로드 성공 시 available/스켈레톤을 반영, 실패 시 하드코딩 5종 폴백(빈 화면 방지).
type RenderProviderCard = { key: string; name: string; desc: string; full?: boolean; available: boolean; modalKey: ProviderKey | null };

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
  const [allowedAppIds, setAllowedAppIds] = useState<string[]>([]);
  const [newAppId, setNewAppId] = useState('');
  const [issuedSecret, setIssuedSecret] = useState<IssueKeyResponse | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'key' | 'secret'>('idle');
  const [cafe24Status, setCafe24Status] = useState<Cafe24Status | null>(null);
  const [cafe24MallId, setCafe24MallId] = useState('');
  const [cafe24Connecting, setCafe24Connecting] = useState(false);
  const [naverStatus, setNaverStatus] = useState<NaverCommerceStatus | null>(null);
  const [naverStoreId, setNaverStoreId] = useState('');
  const [naverConnecting, setNaverConnecting] = useState(false);
  // BYO self-app 자격 입력 (회사가 직접 발급한 Client ID/Secret) — 2026-07-03부터 고급 옵션(기본 = 한줄로 공식 앱)
  const [cafe24ClientId, setCafe24ClientId] = useState('');
  const [cafe24ClientSecret, setCafe24ClientSecret] = useState('');
  const [cafe24ShowByo, setCafe24ShowByo] = useState(false);
  const [showCafe24Secret, setShowCafe24Secret] = useState(false);
  const [naverClientId, setNaverClientId] = useState('');
  const [naverClientSecret, setNaverClientSecret] = useState('');
  const [showNaverSecret, setShowNaverSecret] = useState(false);
  const [godoStatus, setGodoStatus] = useState<GodoStatus | null>(null);
  const [godoKey, setGodoKey] = useState('');
  const [godoConnecting, setGodoConnecting] = useState(false);
  const [showGodoKey, setShowGodoKey] = useState(false);
  const [customInfo, setCustomInfo] = useState<CustomWebhookInfo | null>(null);
  const [customIssuedSecret, setCustomIssuedSecret] = useState<CustomIssuedSecret | null>(null);
  const [customIssuing, setCustomIssuing] = useState(false);
  const [copyStatusCustom, setCopyStatusCustom] = useState<'idle' | 'secret' | 'url' | 'companyId'>('idle');
  const [customDeliveries, setCustomDeliveries] = useState<Array<{ event: string; status: string; errorMessage: string | null; receivedAt: string | null }> | null>(null);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  // UI 영역
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  type CdpModalKey = null | 'analytics' | 'customers';
  const [activeModal, setActiveModal] = useState<CdpModalKey>(null);
  const [connectProvider, setConnectProvider] = useState<ProviderKey | null>(null);
  // ★ 2026-06-25 (gap 3): 백엔드 provider 목록(동적). null = 미로드(폴백).
  const [providerList, setProviderList] = useState<ProviderApiEntry[] | null>(null);
  const [customTab, setCustomTab] = useState<'connect' | 'web' | 'app' | 'verify'>('connect');
  const closeModal = () => { setActiveModal(null); setConnectProvider(null); setCustomTab('connect'); };
  const webhookProviderOpen = connectProvider === 'custom' || connectProvider === 'gabia';
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ★ 2026-06-25 (gap 3): 렌더 카드 = 백엔드 registry 단일 출처. 로드 성공 시 available/스켈레톤 반영, 실패 시 하드코딩 5종 폴백.
  const providerCards = useMemo<RenderProviderCard[]>(() => {
    const core: RenderProviderCard[] = PROVIDER_CARDS.map((p) => ({
      key: p.key, name: p.name, desc: p.desc, full: p.full, available: true, modalKey: p.key,
    }));
    if (!providerList) return core;
    // 백엔드 available 반영 (전용 모달 보유 5종)
    const byKey = new Map<string, ProviderApiEntry>();
    for (const e of providerList) byKey.set(BACKEND_ID_TO_KEY[e.provider] ?? e.provider, e);
    const merged = core.map((c) => {
      const e = byKey.get(c.key);
      return e ? { ...c, available: e.status === 'available' } : c;
    });
    // 전용 모달 없는 항목(스켈레톤 5종) = coming_soon 비활성 카드로 노출
    const extras: RenderProviderCard[] = providerList
      .filter((e) => !BACKEND_ID_TO_KEY[e.provider])
      .map((e) => ({
        key: e.provider,
        name: e.displayName,
        desc: '곧 출시 예정 — 현재는 자체 호스팅(webhook) 방식으로 연동할 수 있습니다.',
        available: e.status === 'available',
        modalKey: null,
      }));
    return [...merged, ...extras];
  }, [providerList]);

  const token = () => localStorage.getItem('token');
  const isAdmin = user?.userType === 'company_admin';
  // CDP 진입 = FREE(미가입)만 차단 (백엔드 cdp-auth.isCdpEnabledForPlan = plan_code !== 'FREE'와 일치 — 전 유료 개방)
  const cdpLocked = !!usage && usage.plan_code === 'FREE';

  // 연동 상태 — 진입 카드 강조 + 요약 칩 노출 판정
  const connectedProviders = useMemo(() => {
    const list: string[] = [];
    if (customInfo?.hasSecret) list.push('자체 호스팅');
    if (cafe24Status?.connected) list.push('카페24');
    if (naverStatus?.connected) list.push('네이버 스마트스토어');
    if (godoStatus?.connected) list.push('고도몰');
    return list;
  }, [customInfo?.hasSecret, cafe24Status?.connected, naverStatus?.connected, godoStatus?.connected]);
  const isConnected = connectedProviders.length > 0 || !!usage?.has_key;
  const hasCdpData = isConnected || (diagnostics?.events30d ?? 0) > 0;

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

  // 네이티브 앱 등록 로드 (앱 SDK 키 인증 allowlist)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/cdp/allowed-app-ids', { headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (data.success) setAllowedAppIds(data.appIds || []);
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

  const addAppId = async () => {
    const id = newAppId.trim().toLowerCase();
    if (!id) return;
    try {
      const res = await fetch('/api/cdp/allowed-app-ids', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: id }),
      });
      const data = await res.json();
      if (data.success) { setAllowedAppIds(data.appIds || []); setNewAppId(''); toast.success('앱이 등록되었습니다.'); }
      else toast.error(data.error || '앱 등록 실패');
    } catch { toast.error('앱 등록 네트워크 오류'); }
  };

  const removeAppId = async (id: string) => {
    try {
      const res = await fetch('/api/cdp/allowed-app-ids', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: id }),
      });
      const data = await res.json();
      if (data.success) { setAllowedAppIds(data.appIds || []); toast.success('앱이 삭제되었습니다.'); }
      else toast.error(data.error || '앱 삭제 실패');
    } catch { toast.error('앱 삭제 네트워크 오류'); }
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExplanation(null);
    try {
      const headers = { Authorization: `Bearer ${token()}` };
      const [
        usageRes, diagRes, funnelRes, timelineRes, activeRes, chDistRes,
        cafe24Res, naverRes, godoRes, customRes, providersRes,
      ] = await Promise.all([
        fetch('/api/cdp/usage', { headers }),
        fetch('/api/cdp/diagnostics', { headers }),
        fetch('/api/cdp/funnel?days=30', { headers }),
        fetch('/api/cdp/timeline', { headers }),
        fetch('/api/cdp/active-customers?limit=10', { headers }),
        fetch('/api/cdp/channel-distribution', { headers }),
        fetch('/api/cafe24/status', { headers }),
        fetch('/api/naver-commerce/status', { headers }),
        fetch('/api/godo/status', { headers }),
        fetch('/api/cdp/custom/info', { headers }),
        fetch('/api/cdp/providers', { headers }),
      ]);
      const usageData = await usageRes.json();
      const diagData = await diagRes.json();
      const funnelData = await funnelRes.json();
      const timelineData = await timelineRes.json();
      const activeData = await activeRes.json();
      const chDistData = await chDistRes.json();
      const cafe24Data = await cafe24Res.json();
      const naverData = await naverRes.json();
      const godoData = await godoRes.json();
      const customData = await customRes.json();
      const providersData = await providersRes.json();

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
      if (godoData.success) setGodoStatus(godoData);
      if (customData.success) {
        setCustomInfo({
          hasSecret: customData.hasSecret,
          webhookUrl: customData.webhookUrl,
          issuedAt: customData.issuedAt,
          companyId: customData.companyId,
        });
      }
      if (providersData.success && Array.isArray(providersData.providers)) {
        setProviderList(providersData.providers);
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

  // 데이터 분석 모달이 열릴 때 AI 진단 자동 로드 (회사 관리자)
  useEffect(() => {
    if (activeModal === 'analytics' && isAdmin) loadExplanation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal]);

  // 모달 ESC 닫기
  useEffect(() => {
    if (!activeModal && !connectProvider) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setActiveModal(null); setConnectProvider(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeModal, connectProvider]);

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

  // 카페24 — 한줄로 공식 앱으로 연결 (기본 흐름, 2026-07-03): mall_id만 입력 → OAuth.
  //   백엔드 /oauth/authorize가 자체앱(BYO) 자격 미저장 시 한줄로 공식 앱 키(.env)로 자동 fallback.
  const handleCafe24ConnectOfficial = async () => {
    const mallId = cafe24MallId.trim().toLowerCase();
    if (!mallId || !/^[a-z0-9_-]+$/i.test(mallId)) {
      toast.error('카페24 쇼핑몰 ID 형식이 올바르지 않습니다 (예: hanjullo-test)');
      return;
    }
    setCafe24Connecting(true);
    try {
      const res = await fetch(`/api/cafe24/oauth/authorize?mall_id=${encodeURIComponent(mallId)}`, {
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

  // 카페24 — self-app 자격 저장(POST /byo-credentials) 후 OAuth 연결 (BYO — 고급 옵션)
  const handleCafe24Connect = async () => {
    const mallId = cafe24MallId.trim().toLowerCase();
    const clientId = cafe24ClientId.trim();
    const clientSecret = cafe24ClientSecret.trim();
    if (!mallId || !/^[a-z0-9_-]+$/i.test(mallId)) {
      toast.error('카페24 mall_id 형식이 올바르지 않습니다 (예: hanjullo-test)');
      return;
    }
    if (!clientId || !clientSecret) {
      toast.error('자체앱 Client ID와 Client Secret을 모두 입력해주세요.');
      return;
    }
    setCafe24Connecting(true);
    try {
      const saveRes = await fetch('/api/cafe24/byo-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ mall_id: mallId, client_id: clientId, client_secret: clientSecret }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) { toast.error(saveData.error || '자체앱 자격 저장 실패'); return; }

      const res = await fetch(`/api/cafe24/oauth/authorize?mall_id=${encodeURIComponent(mallId)}`, {
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

  // 네이버 스마트스토어 — self-app 자격 저장(POST /byo-credentials) 후 OAuth 연결 (BYO)
  const handleNaverConnect = async () => {
    const storeId = naverStoreId.trim();
    const clientId = naverClientId.trim();
    const clientSecret = naverClientSecret.trim();
    if (!storeId) { toast.error('네이버 스마트스토어 store_id를 입력해주세요.'); return; }
    if (!clientId || !clientSecret) {
      toast.error('애플리케이션 Client ID와 Client Secret을 모두 입력해주세요.');
      return;
    }
    setNaverConnecting(true);
    try {
      const saveRes = await fetch('/api/naver-commerce/byo-credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ store_id: storeId, client_id: clientId, client_secret: clientSecret }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) { toast.error(saveData.error || '애플리케이션 자격 저장 실패'); return; }

      const res = await fetch(`/api/naver-commerce/oauth/authorize?store_id=${encodeURIComponent(storeId)}`, {
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

  // 고도몰 — 쇼핑몰 인증키 저장 후 연결 확인 + 백필 시작 (BYO)
  const handleGodoConnect = async () => {
    const key = godoKey.trim();
    if (!key) { toast.error('고도몰 쇼핑몰 인증키를 입력해주세요.'); return; }
    setGodoConnecting(true);
    try {
      const saveRes = await fetch('/api/godo/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ key }),
      });
      const saveData = await saveRes.json();
      if (!saveData.success) { toast.error(saveData.error || '인증키 저장 실패'); return; }

      const res = await fetch('/api/godo/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success) { toast.success(data.message || '고도몰 연동을 시작했습니다.'); await loadAll(); }
      else { toast.error(data.error || '고도몰 연동 실패'); }
    } catch (e: any) { toast.error(e?.message || '고도몰 연동 처리 오류'); }
    finally { setGodoConnecting(false); }
  };
  const handleGodoDisconnect = () => {
    setConfirm({
      mode: 'danger',
      title: '고도몰 연동 해제',
      description: '자사몰 → 한줄로 주문 동기화가 중단됩니다.',
      onConfirm: async () => {
        const res = await fetch('/api/godo/disconnect', { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (data.success) { await loadAll(); toast.success('고도몰 연동 해제 완료'); }
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

  // 복사
  // 자체 호스팅 — 최근 webhook 수신 로그 (연결 검증)
  const handleLoadDeliveries = async () => {
    setLoadingDeliveries(true);
    try {
      const res = await fetch('/api/cdp/custom/deliveries?limit=20', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) {
        setCustomDeliveries(data.deliveries || []);
        if ((data.deliveries || []).length === 0) toast.info('아직 수신된 webhook이 없습니다. 자사몰에서 테스트 이벤트를 보내보세요.');
      } else { toast.error(data.error || '수신 로그 조회 실패'); }
    } catch (e: any) { toast.error(e?.message || '수신 로그 조회 오류'); }
    finally { setLoadingDeliveries(false); }
  };

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
          자사몰 진단 데이터를 불러오는 중...
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
            <p className="text-xs md:text-sm text-white/50 mt-0.5">자체 호스팅 · 고도몰 · 가비아 · 카페24 · 네이버 · 싱크에이전트 — 고객 데이터를 한 곳으로 모읍니다</p>
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
        {cdpLocked && (
          <div className="bg-amber-500/10 border border-amber-400/30 rounded-xl p-5 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-300 mt-0.5 shrink-0" />
            <div>
              <div className="font-bold text-amber-100 mb-1">CDP는 유료 요금제부터 이용 가능합니다</div>
              <div className="text-sm text-amber-200">스타터 요금제 이상에서 자사몰 연동(SDK·webhook)이 모두 열립니다. 현재: {usage?.plan_name || '미가입'}.</div>
            </div>
          </div>
        )}

        {/* 자사몰 연동 상태 안내 */}
        {!cdpLocked && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/20">
              <Database className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white mb-1">{isConnected ? '자사몰이 연동되어 있습니다' : '어떤 자사몰이든 연동해 드립니다'}</div>
              <div className="text-sm text-white/70 leading-relaxed">
                {isConnected
                  ? <>연동됨: <span className="text-emerald-200">{connectedProviders.length > 0 ? connectedProviders.join(' · ') : 'CDP 키 발급'}</span>. 아래에서 자사몰을 선택해 연동을 추가하거나 관리할 수 있습니다.</>
                  : <>아래에서 사용 중인 자사몰을 선택하면 바로 연동을 시작합니다. 표준 SDK·webhook로 대부분 연결되고, 특수한 환경이면 <span className="text-violet-200">고객센터</span>로 문의 주세요.</>}
              </div>
            </div>
          </div>
        )}

        {/* 자사몰 선택 그리드 (가로 2열) — 카드 클릭 시 해당 업체 전용 연동 모달 */}
        {!cdpLocked && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providerCards.map((p) => {
              const connected = p.modalKey === 'cafe24' ? !!cafe24Status?.connected
                : p.modalKey === 'naver' ? !!naverStatus?.connected
                : p.modalKey === 'godo' ? !!godoStatus?.connected
                : (p.modalKey === 'custom' || p.modalKey === 'gabia') ? !!customInfo?.hasSecret
                : false;
              const Icon = p.modalKey === 'cafe24' ? Store : p.modalKey === 'naver' ? ShoppingCart : p.modalKey === 'custom' ? Database : Server;
              const accent = p.modalKey === 'cafe24' ? 'text-amber-300' : p.modalKey === 'naver' ? 'text-emerald-300' : p.modalKey === 'custom' ? 'text-violet-300' : 'text-indigo-300';
              const clickable = p.available && p.modalKey !== null;
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={!clickable}
                  onClick={clickable ? () => setConnectProvider(p.modalKey as ProviderKey) : undefined}
                  className={`text-left p-4 rounded-xl border bg-white/5 border-white/10 flex items-start gap-3 transition-colors ${p.full ? 'md:col-span-2' : ''} ${clickable ? 'hover:bg-white/10 hover:border-violet-400/40 cursor-pointer' : 'opacity-60 cursor-default'}`}
                >
                  <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <Icon className={`w-5 h-5 ${accent}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{p.name}</span>
                      {!p.available
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/40 font-medium">곧 출시</span>
                        : connected
                          ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">연동됨</span>
                          : <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-medium">연동하기</span>}
                    </div>
                    <div className="text-[11px] text-white/55 leading-relaxed mt-0.5">{p.desc}</div>
                  </div>
                  {clickable && <Link2 className="w-4 h-4 text-white/30 flex-shrink-0 mt-1" />}
                </button>
              );
            })}
          </div>
        )}

        {/* 6. 요약 5 metric */}
        {diagnostics && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <MetricBlock label="전체 고객" value={diagnostics.totalCustomers.toLocaleString()} color="text-blue-300" />
              <MetricBlock label="자사몰 연결 고객" value={diagnostics.mappedLinks.toLocaleString()} sub={`연결률 ${formatPct(diagnostics.overallMappingRate)}`} color="text-cyan-300" />
              <MetricBlock label="30일 이벤트" value={diagnostics.events30d.toLocaleString()} sub={`24h ${diagnostics.events24h.toLocaleString()}`} color="text-violet-300" />
              <MetricBlock label="통합 고객" value={diagnostics.fusedCustomers.toLocaleString()} sub="매장·자사몰 양쪽 보유" color="text-emerald-300" />
              <MetricBlock label="자사몰 전용 고객" value={diagnostics.cdpOnlyCustomers.toLocaleString()} sub="자사몰에서만 확인된 고객" color="text-amber-300" />
            </div>
            <div className="mt-2 text-[10px] text-white/40">{diagnostics.source}</div>
          </div>
        )}

        {/* 요약 칩 — 연동 데이터 있을 때만 노출 (미연동이면 숨김) */}
        {!cdpLocked && hasCdpData && (
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setActiveModal('analytics')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[12px] text-white/80 transition-colors">
              <Activity className="w-3.5 h-3.5 text-cyan-300" /> 데이터 분석 · AI 진단
            </button>
            <button onClick={() => setActiveModal('customers')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[12px] text-white/80 transition-colors">
              <Users className="w-3.5 h-3.5 text-violet-300" /> 활성 고객
            </button>
          </div>
        )}

        {/* 데이터 분석 · AI 진단 모달 (createPortal) */}
        <CdpModal open={activeModal === 'analytics'} onClose={closeModal} title="데이터 분석 · AI 진단" icon={<Sparkles className="w-4 h-4 text-violet-300" />}>
          <div className="space-y-4">
            {/* AI 자율 진단 — 모달 open 시 자동 로드 */}
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
              <ChartCard title="자사몰별 고객 연결률" source="cdp_identity_links group by source" icon={<Database className="w-4 h-4 text-violet-300" />}>
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
              <ChartCard title="Webhook 수신 신뢰성 (30일)" source="cdp_webhook_deliveries status" icon={<AlertTriangle className="w-4 h-4 text-rose-300" />}>
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
              <ChartCard title="발송 채널 자동 분배" source="customers.preferred_channel (CT-71 unified profile)" icon={<MousePointerClick className="w-4 h-4 text-fuchsia-300" />}>
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

        {/* 9. AI 영향 요인 매트릭스 */}
        {explanation && explanation.factors.length > 0 && (
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="w-4 h-4 text-violet-300" />
              <h2 className="text-sm font-semibold">AI 자사몰 영향 요인 분석</h2>
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
            {/* 컴퓨팅 시점 */}
            {diagnostics && (
              <div className="text-center text-[11px] text-white/40 pt-2">
                마지막 진단: {new Date(diagnostics.computedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}
                <br />
                고객 통합 프로필은 5분 주기로 자동 재계산되고, 주문·식별 이벤트는 수신 즉시 반영됩니다
              </div>
            )}
          </div>
        </CdpModal>

        {/* 활성 고객 모달 (createPortal) */}
        <CdpModal open={activeModal === 'customers'} onClose={closeModal} title="자사몰 활성 고객" icon={<Users className="w-4 h-4 text-cyan-300" />}>
          {activeCustomers && activeCustomers.topCustomers.length > 0 ? (
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
          ) : (
            <div className="text-sm text-white/50 py-10 text-center">아직 자사몰 활성 고객 데이터가 없습니다.</div>
          )}
        </CdpModal>

        {/* 연동 모달 (createPortal) — 자사몰 카드 선택 시 해당 업체 전용 모달 */}
        <CdpModal
          open={connectProvider !== null}
          onClose={closeModal}
          title={connectProvider ? PROVIDER_META[connectProvider].title : '자사몰 연동'}
          icon={connectProvider === 'cafe24' ? <Store className="w-4 h-4 text-amber-300" /> : connectProvider === 'naver' ? <ShoppingCart className="w-4 h-4 text-emerald-300" /> : connectProvider === 'custom' ? <Database className="w-4 h-4 text-violet-300" /> : <Server className="w-4 h-4 text-indigo-300" />}
        >
          <div className="space-y-4">
            {connectProvider && (
              <div className="text-xs text-white/70 leading-relaxed bg-white/5 border border-white/10 rounded-lg p-3">
                {PROVIDER_META[connectProvider].note}
              </div>
            )}
        {/* webhook 자사몰 — 탭 (연결 / 웹 / 앱 / 검증) */}
        {webhookProviderOpen && (
          <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            {([['connect', '연결'], ['web', '웹'], ['app', '앱'], ['verify', '검증']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setCustomTab(key)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${customTab === key ? 'bg-violet-500/40 text-white' : 'text-white/60 hover:bg-white/5'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* 자체 호스팅 / 고도몰 / 가비아 — webhook 방식 (연결 탭) */}
        {webhookProviderOpen && customTab === 'connect' && (
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
                  ★ <strong>이 화면을 닫으면 webhook_secret을 다시 볼 수 없습니다.</strong> 자사몰 서버 환경변수에 지금 바로 저장해 주세요.
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

        {/* 자체 호스팅 webhook 개발자 안내 — 이벤트 계약 + 서명 예제 (검증 탭) */}
        {webhookProviderOpen && customInfo?.hasSecret && customTab === 'verify' && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Code2 className="w-5 h-5 text-indigo-300" />
              <h2 className="text-base font-bold text-white">Webhook 개발 안내 (자사몰 개발자 전달용)</h2>
            </div>
            <div className="space-y-4 text-xs text-white/70 leading-relaxed">
              <div>
                <div className="font-semibold text-white/90 mb-1">1. 요청 형식</div>
                <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre">{`POST ${customInfo.webhookUrl}
Content-Type: application/json
X-Hanjullo-Company-Id: (이 화면의 Company ID)
X-Hanjullo-Event: order.created          ← 아래 이벤트명 중 하나
X-Hanjullo-Signature: (HMAC-SHA256 서명 — hex 또는 base64)

{"event":"order.created","resource":{ ...아래 필드 }}`}</pre>
              </div>
              <div>
                <div className="font-semibold text-white/90 mb-1">2. 이벤트와 resource 필드</div>
                <table className="w-full text-[11px]">
                  <thead><tr className="text-left text-white/50 border-b border-white/10"><th className="py-1 pr-2">이벤트</th><th className="py-1 pr-2">시점</th><th className="py-1">resource 필드</th></tr></thead>
                  <tbody className="text-white/70">
                    <tr className="border-b border-white/5"><td className="py-1 pr-2 font-mono">customer.created / customer.updated</td><td className="py-1 pr-2">회원 가입·정보 변경</td><td className="py-1">external_id(필수), phone(신규 필수), name, email, birth_date, gender, grade, address, sms_opt_in(수신동의 true/false)</td></tr>
                    <tr className="border-b border-white/5"><td className="py-1 pr-2 font-mono">order.created / order.updated</td><td className="py-1 pr-2">주문 생성·상태 변경</td><td className="py-1">order_id(필수), external_id(필수), status(pending/paid/completed/shipping), total_amount, ordered_at, items, phone, name</td></tr>
                    <tr><td className="py-1 pr-2 font-mono">order.cancelled / order.refunded</td><td className="py-1 pr-2">취소·환불</td><td className="py-1">order_id(필수), external_id(필수), total_amount, cancelled_at</td></tr>
                  </tbody>
                </table>
                <div className="text-[11px] text-amber-200/80 mt-1.5">★ 수신동의(sms_opt_in)를 보내지 않으면 신규 고객은 발송 제외로 저장됩니다. 동의받은 회원은 반드시 true로 보내주세요.</div>
              </div>
              <div>
                <div className="font-semibold text-white/90 mb-1">3. 서명 생성 — 전송하는 JSON 문자열 그대로(바이트 동일) 계산</div>
                <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre">{`// Node.js
const body = JSON.stringify({ event, resource });
const signature = require('crypto')
  .createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
// body 변수를 그대로 전송하세요 (다시 직렬화하면 서명이 어긋납니다)

// PHP
$body = json_encode(['event' => $event, 'resource' => $resource]);
$signature = hash_hmac('sha256', $body, $webhook_secret);
// $body를 그대로 전송하세요

# Python
import json, hmac, hashlib
body = json.dumps({"event": event, "resource": resource})
signature = hmac.new(WEBHOOK_SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
# body 변수를 그대로 전송하세요`}</pre>
              </div>
              <div>
                <div className="font-semibold text-white/90 mb-1">4. 응답 규칙</div>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                  <li>200 + success true (duplicate true 포함) = 정상 — 재전송 불필요</li>
                  <li>401 = 서명 또는 secret 불일치 — secret·서명 문자열 점검</li>
                  <li>429 = 이번 달 호출 한도 초과</li>
                  <li>5xx 또는 네트워크 오류 = 잠시 후 재전송 권장 (중복 전송은 자동 차단됩니다)</li>
                </ul>
              </div>
            </div>
            <div className="text-[10px] text-white/30 italic mt-3">Data source — POST /api/cdp/webhook/custom 계약</div>
          </div>
        )}

        {/* 연결 검증 — 최근 webhook 수신 확인 (검증 탭) */}
        {webhookProviderOpen && customInfo?.hasSecret && customTab === 'verify' && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-emerald-300" />
                <h2 className="text-base font-bold text-white">연결 검증 — 최근 수신</h2>
              </div>
              <button onClick={handleLoadDeliveries} disabled={loadingDeliveries} className="px-3.5 py-2 rounded-lg bg-emerald-500/20 border border-emerald-400/30 hover:bg-emerald-500/30 text-emerald-100 text-[12px] font-medium disabled:opacity-40 flex items-center gap-1.5">
                {loadingDeliveries ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 최근 수신 확인
              </button>
            </div>
            <div className="text-xs text-white/50 mb-3">자사몰에서 webhook을 보낸 뒤 눌러 도착·처리 결과를 확인하세요.</div>
            {customDeliveries === null ? (
              <div className="text-xs text-white/40">"최근 수신 확인"을 눌러 도착한 이벤트를 조회합니다.</div>
            ) : customDeliveries.length === 0 ? (
              <div className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-400/30 rounded p-3">아직 수신된 webhook이 없습니다. 자사몰 서버에서 테스트 이벤트를 보내보세요 (401이면 secret·서명 문자열 점검).</div>
            ) : (
              <div className="space-y-1.5">
                {customDeliveries.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-slate-950 border border-white/10 rounded-lg px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${d.status === 'processed' ? 'bg-emerald-500/20 text-emerald-300' : d.status === 'duplicate' ? 'bg-white/10 text-white/50' : d.status === 'failed' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>{d.status}</span>
                    <span className="font-mono text-white/80">{d.event}</span>
                    <span className="ml-auto text-white/40">{d.receivedAt ? new Date(d.receivedAt).toLocaleString('ko-KR') : '-'}</span>
                  </div>
                ))}
                {customDeliveries.some((d) => d.errorMessage) && (
                  <div className="text-[10px] text-rose-300/80 mt-1">failed 항목은 처리 오류 — 이벤트·resource 필드 점검</div>
                )}
              </div>
            )}
            <div className="text-[10px] text-white/30 italic mt-3">Data source — GET /api/cdp/custom/deliveries</div>
          </div>
        )}

        {/* 네이티브 앱(REST 직접 호출) 안내 (앱 탭) */}
        {webhookProviderOpen && customInfo?.hasSecret && customTab === 'app' && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <Code2 className="w-5 h-5 text-cyan-300" />
              <h2 className="text-base font-bold text-white">네이티브 앱 (REST 직접 호출)</h2>
            </div>
            <div className="text-xs text-white/60 leading-relaxed mb-3">
              웹뷰가 아닌 순수 네이티브 앱(iOS/Android)은 공개키(<span className="font-mono">hjl_</span>)로 이벤트·인앱을 직접 호출합니다. <strong className="text-white/90">secret(<span className="font-mono">sk_</span>)은 앱에 넣지 마세요</strong> — 회원/주문 적재는 고객사 서버에서 호출합니다(브라우저와 동일 원칙).
            </div>
            <div className="space-y-3 text-xs text-white/70">
              <div>
                <div className="font-semibold text-white/90 mb-1">이벤트 수집 (공개키)</div>
                <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-cyan-200 overflow-x-auto whitespace-pre">{`curl -X POST https://app.hanjul.ai/api/cdp/ingest \\
  -H "Content-Type: application/json" -H "X-Hanjullo-Key: hjl_..." \\
  -d '{"schema_version":"v1","anonymous_id":"DEVICE_UUID","events":[
        {"type":"track","event":"cart_add","properties":{"product_id":"P1","price":19000}}]}'`}</pre>
              </div>
              <div>
                <div className="font-semibold text-white/90 mb-1">인앱 메시지 조회 (공개키, 앱 채널)</div>
                <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-cyan-200 overflow-x-auto whitespace-pre">{`GET https://app.hanjul.ai/api/cdp/inapp/active?channel=app&anonymous_id=DEVICE_UUID
Header: X-Hanjullo-Key: hjl_...`}</pre>
              </div>
              <div>
                <div className="font-semibold text-white/90 mb-1">Swift / Kotlin</div>
                <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-cyan-200 overflow-x-auto whitespace-pre">{`// Swift (URLSession)
var req = URLRequest(url: URL(string: "https://app.hanjul.ai/api/cdp/ingest")!)
req.httpMethod = "POST"
req.setValue("hjl_...", forHTTPHeaderField: "X-Hanjullo-Key")
req.setValue("application/json", forHTTPHeaderField: "Content-Type")
req.httpBody = bodyData   // {"schema_version":"v1","anonymous_id":..,"events":[..]}
URLSession.shared.dataTask(with: req).resume()

// Kotlin (OkHttp)
val req = Request.Builder().url("https://app.hanjul.ai/api/cdp/ingest")
  .addHeader("X-Hanjullo-Key", "hjl_...")
  .post(bodyJson.toRequestBody("application/json".toMediaType())).build()
client.newCall(req).execute()`}</pre>
              </div>
            </div>
            <div className="text-[10px] text-white/30 italic mt-3">Data source — /api/cdp/ingest · /api/cdp/inapp/active (공개키)</div>
          </div>
        )}

        {/* 카페24 — OAuth */}
        {connectProvider === 'cafe24' && (
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
              <div className="space-y-4">
                {/* 기본 흐름 — 한줄로 공식 앱 (mall_id만 입력, 2026-07-03) */}
                <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4">
                  <div className="text-xs font-semibold text-violet-100 mb-1">쇼핑몰 ID만 입력하면 연결됩니다</div>
                  <div className="text-[11px] text-white/50">한줄로 공식 카페24 앱으로 연결되어 회원·주문·장바구니가 자동 동기화됩니다. 새 창에서 카페24 로그인 + 권한 동의만 하면 끝.</div>
                </div>

                <div>
                  <label className="block text-[11px] text-white/50 mb-1">쇼핑몰 ID (mall_id)</label>
                  <input
                    type="text"
                    value={cafe24MallId}
                    onChange={(e) => setCafe24MallId(e.target.value)}
                    placeholder="예: hanjullo-test"
                    className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/50"
                  />
                  <div className="text-[11px] text-white/40 mt-1">쇼핑몰 주소가 <span className="font-mono">hanjullo-test.cafe24.com</span>이면 → <span className="font-mono">hanjullo-test</span></div>
                </div>

                <button onClick={handleCafe24ConnectOfficial} disabled={cafe24Connecting || !isAdmin || !cafe24MallId.trim()} className="w-full px-4 py-2.5 bg-amber-500/30 hover:bg-amber-500/50 text-amber-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
                  {cafe24Connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 준비 중...</> : <><Link2 className="w-4 h-4" /> 카페24 연결</>}
                </button>
                {!isAdmin && <div className="text-[11px] text-white/50 text-center">연동은 회사 관리자만 가능합니다.</div>}

                {/* 고급 — 자체앱(직접 발급 키)으로 연결 (접이식) */}
                <div className="border border-white/10 rounded-xl overflow-hidden">
                  <button onClick={() => setCafe24ShowByo((v) => !v)} className="w-full px-4 py-2.5 flex items-center justify-between text-[11px] text-white/50 hover:bg-white/5">
                    <span>자체앱(직접 발급한 키)으로 연결 — 고급</span>
                    {cafe24ShowByo ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                  {cafe24ShowByo && (
                    <div className="p-4 pt-2 space-y-4 border-t border-white/10">
                      <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4 space-y-3">
                        <div className="text-xs font-semibold text-violet-100">자체앱 연결 — 4단계</div>
                        <GuideStep n={1}>
                          <a href="https://developers.cafe24.com" target="_blank" rel="noreferrer" className="text-violet-200 underline inline-flex items-center gap-1">카페24 개발자센터<ExternalLink className="w-3 h-3" /></a>에서 "앱 만들기"(자체앱)를 생성합니다.
                        </GuideStep>
                        <GuideStep n={2}>
                          앱의 <strong className="text-white/90">Redirect URI</strong>에 아래 주소를 그대로 등록합니다.
                          <div className="flex items-center gap-2 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 mt-1.5">
                            <code className="flex-1 text-[11px] text-emerald-200 font-mono break-all">{CAFE24_CALLBACK_URL}</code>
                            <button onClick={() => copyText(CAFE24_CALLBACK_URL, 'Redirect URI')} className="shrink-0 p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/60" title="복사"><Copy className="w-3.5 h-3.5" /></button>
                          </div>
                        </GuideStep>
                        <GuideStep n={3}>
                          다음 권한(scope)을 모두 선택합니다.
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {CAFE24_REQUIRED_SCOPES.map((s) => <span key={s} className="text-[10px] font-mono bg-white/5 border border-white/10 text-white/60 px-2 py-0.5 rounded-full">{s}</span>)}
                          </div>
                        </GuideStep>
                        <GuideStep n={4}>
                          발급된 <strong className="text-white/90">Client ID·Secret</strong>을 아래에 입력합니다.
                        </GuideStep>
                      </div>

                      <div className="space-y-2.5">
                        <div>
                          <label className="block text-[11px] text-white/50 mb-1">Client ID</label>
                          <input
                            type="text"
                            value={cafe24ClientId}
                            onChange={(e) => setCafe24ClientId(e.target.value)}
                            placeholder="자체앱 Client ID"
                            className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/50 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-white/50 mb-1">Client Secret</label>
                          <div className="relative">
                            <input
                              type={showCafe24Secret ? 'text' : 'password'}
                              value={cafe24ClientSecret}
                              onChange={(e) => setCafe24ClientSecret(e.target.value)}
                              placeholder="자체앱 Client Secret"
                              className="w-full px-3 py-2 pr-10 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-400/50 font-mono"
                            />
                            <button type="button" onClick={() => setShowCafe24Secret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70" title={showCafe24Secret ? '숨기기' : '보기'}>
                              {showCafe24Secret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      <button onClick={handleCafe24Connect} disabled={cafe24Connecting || !isAdmin || !cafe24MallId.trim() || !cafe24ClientId.trim() || !cafe24ClientSecret.trim()} className="w-full px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
                        {cafe24Connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 준비 중...</> : <><Link2 className="w-4 h-4" /> 자체앱 키 저장하고 연결</>}
                      </button>
                      <div className="text-[10px] text-white/30 italic">Client Secret은 한줄로 서버에 안전 보관되며 화면에 다시 표시되지 않습니다. 쇼핑몰 ID는 위 입력칸을 함께 사용합니다.</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 네이버 스마트스토어 — OAuth */}
        {connectProvider === 'naver' && (
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
              <div className="space-y-4">
                <div className="text-xs text-amber-200/80 bg-amber-500/10 border border-amber-400/30 rounded p-2">
                  ★ 네이버 정책상 휴대폰·이메일 등 개인정보 제공이 제한될 수 있어, 기존 고객과의 매칭률이 낮을 수 있습니다.
                </div>
                {/* 안내 — 애플리케이션 등록 4단계 */}
                <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-semibold text-violet-100">애플리케이션 연결 — 4단계</div>
                  <GuideStep n={1}>네이버 커머스 API센터에서 애플리케이션을 등록합니다.</GuideStep>
                  <GuideStep n={2}>
                    애플리케이션의 <strong className="text-white/90">Redirect URI</strong>(callback)에 아래 주소를 그대로 등록합니다.
                    <div className="flex items-center gap-2 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 mt-1.5">
                      <code className="flex-1 text-[11px] text-emerald-200 font-mono break-all">{NAVER_CALLBACK_URL}</code>
                      <button onClick={() => copyText(NAVER_CALLBACK_URL, 'Redirect URI')} className="shrink-0 p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/60" title="복사"><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                  </GuideStep>
                  <GuideStep n={3}>
                    다음 권한(scope)을 모두 선택합니다.
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {NAVER_REQUIRED_SCOPES.map((s) => <span key={s} className="text-[10px] font-mono bg-white/5 border border-white/10 text-white/60 px-2 py-0.5 rounded-full">{s}</span>)}
                    </div>
                  </GuideStep>
                  <GuideStep n={4}>
                    발급된 <strong className="text-white/90">Client ID·Secret(애플리케이션 ID·시크릿)</strong>을 아래에 입력합니다.
                  </GuideStep>
                </div>

                {/* 입력 — store_id + Client ID + Secret */}
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">store_id</label>
                    <input
                      type="text"
                      value={naverStoreId}
                      onChange={(e) => setNaverStoreId(e.target.value)}
                      placeholder="네이버 스마트스토어 store_id"
                      className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">Client ID</label>
                    <input
                      type="text"
                      value={naverClientId}
                      onChange={(e) => setNaverClientId(e.target.value)}
                      placeholder="애플리케이션 Client ID"
                      className="w-full px-3 py-2 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-white/50 mb-1">Client Secret</label>
                    <div className="relative">
                      <input
                        type={showNaverSecret ? 'text' : 'password'}
                        value={naverClientSecret}
                        onChange={(e) => setNaverClientSecret(e.target.value)}
                        placeholder="애플리케이션 Client Secret"
                        className="w-full px-3 py-2 pr-10 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-400/50 font-mono"
                      />
                      <button type="button" onClick={() => setShowNaverSecret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70" title={showNaverSecret ? '숨기기' : '보기'}>
                        {showNaverSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <button onClick={handleNaverConnect} disabled={naverConnecting || !isAdmin || !naverStoreId.trim() || !naverClientId.trim() || !naverClientSecret.trim()} className="w-full px-4 py-2.5 bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
                  {naverConnecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 준비 중...</> : <><Link2 className="w-4 h-4" /> 저장하고 네이버 연결</>}
                </button>
                {!isAdmin && <div className="text-[11px] text-white/50 text-center">연동은 회사 관리자만 가능합니다.</div>}
                <div className="text-[10px] text-white/30 italic">Client Secret은 한줄로 서버에 안전 보관되며 화면에 다시 표시되지 않습니다.</div>
              </div>
            )}
          </div>
        )}

        {/* 고도몰 — BYO 쇼핑몰 인증키(key) */}
        {connectProvider === 'godo' && (
          <div id="section-godo" className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <Server className="w-5 h-5 text-indigo-300" />
              <h2 className="text-base font-bold text-white">고도몰 연동</h2>
              <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-medium">쇼핑몰 인증키</span>
            </div>

            {godoStatus?.connected ? (
              <div className="space-y-3">
                <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4 flex items-start gap-3">
                  <Check className="w-5 h-5 text-emerald-300 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-emerald-100">고도몰 연동됨</div>
                    <div className="text-xs text-emerald-300 mt-1">
                      status: {godoStatus.status} · 연결: {godoStatus.connectedAt ? new Date(godoStatus.connectedAt).toLocaleString('ko-KR') : '-'}
                    </div>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={handleGodoDisconnect} className="px-4 py-2 bg-rose-500/15 border border-rose-400/40 hover:bg-rose-500/25 text-rose-200 text-sm font-medium rounded-lg flex items-center gap-2">
                    <Unlink className="w-4 h-4" /> 연동 해제
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-violet-500/10 border border-violet-400/30 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-semibold text-violet-100">쇼핑몰 인증키 연결 — 2단계</div>
                  <GuideStep n={1}>고도몰 쇼핑몰 관리자에서 한줄로 API 사용을 신청하고 <strong className="text-white/90">쇼핑몰 인증키(key)</strong>를 발급받습니다.</GuideStep>
                  <GuideStep n={2}>발급된 인증키를 아래에 입력하면, 최근 주문이 자동으로 들어옵니다.</GuideStep>
                </div>

                <div>
                  <label className="block text-[11px] text-white/50 mb-1">쇼핑몰 인증키(key)</label>
                  <div className="relative">
                    <input
                      type={showGodoKey ? 'text' : 'password'}
                      value={godoKey}
                      onChange={(e) => setGodoKey(e.target.value)}
                      placeholder="고도몰에서 발급받은 인증키"
                      className="w-full px-3 py-2 pr-10 bg-violet-900/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-400/50 font-mono"
                    />
                    <button type="button" onClick={() => setShowGodoKey((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70" title={showGodoKey ? '숨기기' : '보기'}>
                      {showGodoKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button onClick={handleGodoConnect} disabled={godoConnecting || !isAdmin || !godoKey.trim()} className="w-full px-4 py-2.5 bg-indigo-500/30 hover:bg-indigo-500/50 text-indigo-100 text-sm font-medium rounded-lg disabled:opacity-40 flex items-center justify-center gap-2">
                  {godoConnecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 확인 중...</> : <><Link2 className="w-4 h-4" /> 저장하고 고도몰 연동</>}
                </button>
                {!isAdmin && <div className="text-[11px] text-white/50 text-center">연동은 회사 관리자만 가능합니다.</div>}
                <div className="text-[10px] text-white/30 italic">인증키는 한줄로 서버에 안전 보관되며 화면에 다시 표시되지 않습니다.</div>
              </div>
            )}
          </div>
        )}


        {/* 12. CDP 키 발급 + 사용량 — SDK 설치(public key)와 서버 API 공용
            2026-06-10 정정: webhook secret 발급 후에도 표시 (이전에는 숨겨져 public key를 발급할 수 없어
            SDK 스니펫·설치검증까지 막히던 흐름 결함) */}
        {webhookProviderOpen && usage && customTab === 'connect' && (
          <div className="bg-white/5 border border-white/10 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound className="w-5 h-5 text-indigo-300" />
              <h2 className="text-base font-bold text-white">CDP 키 (SDK 설치 · 서버 API 공용)</h2>
            </div>
            {issuedSecret ? (
              <div className="space-y-3">
                <div className="text-xs text-amber-200 bg-amber-500/10 border border-amber-400/30 rounded p-2">
                  ★ Secret은 이 화면에서만 1회 노출됩니다. 자사몰 서버에 지금 바로 저장해 주세요.
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
            {!cdpLocked && usage && (
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

        {/* 12-0. 수집 허용 도메인 등록 (웹 탭) */}
        {webhookProviderOpen && customTab === 'web' && (
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

        {/* 12-0b. 네이티브 앱 등록 (cdp_allowed_app_ids) — 앱 SDK 키 인증 허용 번들ID (앱 탭) */}
        {webhookProviderOpen && customTab === 'app' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
                <Code2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">앱(네이티브) 등록</h2>
                <div className="text-xs text-white/50">iOS·안드로이드 앱에 인앱 메시지를 띄우려면 앱 번들ID(패키지명)를 등록하세요. 앱은 퍼블릭키 + 등록 번들ID로 인증하며 시크릿은 앱에 넣지 않습니다. (예: kr.poppon.app)</div>
              </div>
            </div>
            {isAdmin ? (
              <div className="flex gap-2 mb-3 flex-wrap">
                <input
                  value={newAppId}
                  onChange={(e) => setNewAppId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addAppId(); }}
                  placeholder="kr.poppon.app"
                  className="flex-1 min-w-[200px] bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-400"
                />
                <button onClick={addAppId} className="px-4 py-2 bg-violet-500/40 hover:bg-violet-500/60 text-white rounded-lg text-sm font-medium">추가</button>
              </div>
            ) : (
              <div className="text-xs text-white/40 mb-3">앱 등록은 회사 관리자만 가능합니다.</div>
            )}
            {allowedAppIds.length > 0 ? (
              <div className="space-y-1.5">
                {allowedAppIds.map((id) => (
                  <div key={id} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                    <span className="text-sm text-white/80 font-mono break-all">{id}</span>
                    {isAdmin && (
                      <button onClick={() => removeAppId(id)} className="text-rose-300 hover:text-rose-200 text-xs shrink-0 ml-2">삭제</button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-white/40">등록된 앱이 없습니다. 앱 번들ID를 추가해주세요.</div>
            )}
            <div className="text-[10px] text-white/30 italic mt-2">Data source — companies.cdp_allowed_app_ids</div>
          </div>
        )}

        {/* 12-1. SDK 설치 스크립트 스니펫 (웹 탭) */}
        {webhookProviderOpen && usage?.public_key && customTab === 'web' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center">
                <Code2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">SDK 설치 스크립트</h2>
                <div className="text-xs text-white/50">자사몰 &lt;head&gt;에 붙여넣으면 고객 행동 수집이 시작됩니다. (페이지뷰·클릭 + GA4 dataLayer 이커머스 자동 수집)</div>
              </div>
            </div>
            {(() => {
              const snippet = `<script src="https://app.hanjul.ai/sdk/v0.3.7/hanjul.min.js" data-hjl-key="${usage.public_key}" async></script>`;
              const appSnippet = `<script src="https://app.hanjul.ai/sdk/v0.3.7/hanjul.min.js" data-hjl-key="${usage.public_key}" data-hjl-platform="app" async></script>`;
              return (
                <>
                  <div className="text-xs font-medium text-white/70 mb-1.5">웹 자사몰 — &lt;head&gt;에 붙여넣기</div>
                  <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-emerald-200 overflow-x-auto whitespace-pre-wrap break-all">{snippet}</pre>
                  <button
                    onClick={() => copyText(snippet, '웹 설치 스크립트')}
                    className="mt-2 px-3 py-2 bg-violet-500/40 hover:bg-violet-500/60 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />복사
                  </button>
                  <div className="text-xs font-medium text-white/70 mb-1.5 mt-5">모바일 앱(웹뷰) — 앱 웹뷰 페이지에 붙여넣기 <span className="text-sky-300">(data-hjl-platform="app" 한 줄 추가)</span></div>
                  <pre className="bg-slate-950 border border-white/10 rounded-xl p-3 text-[11px] text-sky-200 overflow-x-auto whitespace-pre-wrap break-all">{appSnippet}</pre>
                  <button
                    onClick={() => copyText(appSnippet, '앱 설치 스크립트')}
                    className="mt-2 px-3 py-2 bg-sky-500/40 hover:bg-sky-500/60 text-white rounded-lg text-xs font-medium inline-flex items-center gap-1.5"
                  >
                    <Copy className="w-3.5 h-3.5" />복사
                  </button>
                </>
              );
            })()}
            <div className="text-[10px] text-white/30 italic mt-2">Data source — app.hanjul.ai/sdk/v0.3.7</div>
          </div>
        )}

        {/* 12-2. 설치 검증 — 첫 이벤트 진단 (웹 탭) */}
        {webhookProviderOpen && usage?.public_key && installStatus && customTab === 'web' && (() => {
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
          </div>
        </CdpModal>
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

function CdpModal({ open, onClose, title, icon, children }: { open: boolean; onClose: () => void; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-3xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10 sticky top-0 bg-slate-900 rounded-t-2xl z-10">
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">{icon}</div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <button onClick={onClose} className="ml-auto p-1 hover:bg-white/10 rounded-lg" aria-label="닫기"><X className="w-4 h-4 text-white/40" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
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

function GuideStep({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 w-4 h-4 mt-0.5 rounded-full bg-violet-500/30 text-violet-100 text-[10px] flex items-center justify-center font-bold">{n}</span>
      <div className="flex-1 text-xs text-white/70 leading-relaxed">{children}</div>
    </div>
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
