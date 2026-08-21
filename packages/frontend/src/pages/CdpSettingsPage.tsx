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
import { goBackOr } from '../lib/scroll-restoration';
import { createPortal } from 'react-dom';
// ★ 2026-08-10 Phase 5 — recharts는 차트를 그리는 CdpAnalyticsPanels로 함께 이동(정적 import라 청크 경계 무변경).
import {
  ArrowLeft, Database, Loader2, RefreshCw, Sparkles, Users,
  Activity, Info, Link2, Store, Server, ShoppingBag, Boxes, Cloud, Palette, LayoutTemplate, Package, Blocks,
  KeyRound, Copy, Check, Unlink, AlertCircle, ShoppingCart, Code2, X,
  Eye, EyeOff, ExternalLink, ChevronDown, ChevronUp, Smartphone,
} from 'lucide-react';
import { APP_INAPP_CONTRACT_SECTIONS } from '../components/inapp/AppIntegrationContract';
// ★ 2026-08-10 Phase 2 — 연동 현황판(1층). 판정은 훅, 매핑은 CT, 화면은 그리기만.
import CdpIntegrationDashboard from '../components/cdp/CdpIntegrationDashboard';
import CdpIntegrationStepper from '../components/cdp/CdpIntegrationStepper';
import { buildInstallGuideText } from '../utils/cdp-install-guide';
import CdpDeveloperDoc, { developerDocToText } from '../components/cdp/CdpDeveloperDoc';
import CdpSnippetBox from '../components/cdp/CdpSnippetBox';
// ★ 2026-08-10 Phase 5 — 표시 전용 블록 분리(상태 없음·정적 import). 라벨·포맷·타입은 각자 CT가 소유한다.
import CdpAnalyticsPanels from '../components/cdp/CdpAnalyticsPanels';
import CdpActiveCustomersTable from '../components/cdp/CdpActiveCustomersTable';
import { formatPct } from '../utils/cdp-display';
// ★ 2026-08-10 Phase 5-2 — SDK 설치 스크립트는 버전·경로 단일 출처에서 만든다(옛날엔 여섯 곳에 손으로 적혀 있었다).
import { buildSdkScriptTag, CDP_SDK_VERSION } from '../utils/cdp-sdk-script';
import { GuideStep } from '../components/cdp/CdpFormPrimitives';
// ★ 2026-08-10 Phase 5-5 — 자체 호스팅 개발자 안내·수신 검증(표시 전용). 시크릿 발급은 페이지 잔류.
import { CdpCustomWebhookGuide, CdpCustomDeliveries, CdpCustomAppGuide } from '../components/cdp/CdpCustomHostingDocs';
// ★ 2026-08-10 Phase 5-3 — 몰별 연결 폼 마크업 분리(상태·핸들러는 페이지 잔류 = 동작 무변경).
import {
  CdpCafe24ConnectForm, CdpNaverConnectForm, CdpMakeshopConnectForm, CdpImwebConnectForm, CdpGodoConnectForm,
  type Cafe24Status, type NaverCommerceStatus, type MakeshopStatus, type ImwebStatus, type GodoStatus,
} from '../components/cdp/CdpConnectForms';
import type {
  CdpDiagnostics, CdpFunnel, CdpTimelineBucket, CdpActiveCustomers,
  ChannelDistribution, ChannelCapabilities, CdpExplanation,
} from '../components/cdp/cdp-analytics-types';
import { useCdpIntegrationStatus, isIntegrationAuthBroken, type CdpInstallStatusBySource } from '../hooks/useCdpIntegrationStatus';
import type { CdpProviderKey } from '../utils/cdp-provider-keys';

// ★ Phase 2 병존 플래그 — false로 되돌리면 옛 카드 그리드만 남는다(설계서 §7 롤백).
const CDP_DASHBOARD_V2 = true;
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
  /** ★2026-08-10 Phase 0 — 자사몰(source)별 분리 집계. 옛 배포 응답엔 없으므로 optional. */
  bySource?: Record<string, CdpInstallStatusBySource>;
}

interface IssueKeyResponse {
  success: boolean;
  cdp_api_key: string;
  cdp_api_secret: string;
  issued_at: string;
  message: string;
}

// 몰별 status 타입 5종과 카페24 콜백 URL·scope, 네이버 API 그룹, 메이크샵 권한 목록은
// 그 폼을 그리는 components/cdp/CdpConnectForms가 소유한다(★2026-08-10 Phase 5-3·5-4).
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

// ★ 2026-08-10 Phase 5 — 진단·분석 응답 타입은 `components/cdp/cdp-analytics-types.ts`,
//   표시 라벨·포맷은 `utils/cdp-display.ts`가 소유한다. 여기 다시 선언하면 곧 한쪽만 고쳐진다.

// 자사몰 선택 카드 — 카드 클릭 시 해당 업체 전용 연동 모달 (가로 2열 그리드)
type ProviderKey = 'cafe24' | 'naver' | 'godo' | 'imweb' | 'makeshop' | 'custom';

const PROVIDER_CARDS: Array<{ key: ProviderKey; name: string; desc: string; full?: boolean }> = [
  { key: 'cafe24', name: '카페24', desc: 'OAuth 자동 연동 — 코딩 없이 회원·주문 동기화' },
  { key: 'naver', name: '네이버 스마트스토어', desc: '커머스 API — 주문·구매고객 동기화' },
  { key: 'godo', name: '고도몰', desc: '쇼핑몰 인증키 입력 — 주문·고객 자동 동기화' },
  { key: 'imweb', name: '아임웹', desc: 'OAuth 자동 연동 — 회원·주문·수신동의 동기화' },
  { key: 'makeshop', name: '메이크샵', desc: '커머스 API — 회원·주문·SMS수신동의 동기화' },
  { key: 'custom', name: '자체 호스팅 / 그 외 자사몰', desc: '직접 개발했거나 목록에 없는 자사몰 — webhook 방식', full: true },
];

// 네이버 API 그룹·메이크샵 권한 목록은 그 폼과 함께 CdpConnectForms로 옮겼다(★2026-08-10 Phase 5-3).

const PROVIDER_META: Record<ProviderKey, { title: string; note: string }> = {
  cafe24: { title: '카페24 연동', note: '쇼핑몰 ID만 입력하면 한줄로 공식 카페24 앱으로 연결됩니다. OAuth 동의 후 회원·주문이 자동 동기화됩니다.' },
  naver: { title: '네이버 스마트스토어 연동', note: '네이버 커머스 API센터에서 만든 애플리케이션 자격을 입력하면 주문·회원이 동기화됩니다. 구매자 성명·휴대폰 번호는 주문 데이터로 제공되어 발송에 쓸 수 있습니다. 단 주문 안내 같은 정보성 메시지는 즉시 가능하지만, 광고성 메시지는 별도의 광고 수신동의가 필요합니다.' },
  godo: { title: '고도몰 연동', note: '고도몰 쇼핑몰 인증키(key)를 입력하면 주문·고객 데이터가 자동으로 동기화됩니다.' },
  imweb: { title: '아임웹 연동', note: '아임웹 사이트 코드(siteCode)를 입력하면 OAuth 인증 후 회원·주문·수신동의·장바구니가 동기화됩니다. 사이트 코드는 아임웹 앱스토어에서 한줄로를 추가할 때 전달됩니다.' },
  makeshop: { title: '메이크샵 연동', note: '메이크샵 파트너센터에서 만든 App의 Client ID·Secret과 상점 ID를 입력하면 회원·주문이 동기화됩니다. 회원 데이터에 SMS 수신동의 여부가 포함되어 광고 발송 대상을 정확히 가려낼 수 있습니다.' },
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
  imweb: 'imweb',
  makeshop: 'makeshop',
  custom: 'custom',
  // gabia는 2026-07-06 제거(퍼스트몰 개방 API 폐쇄형) — 자체호스팅으로 흡수.
};

// 카드 렌더 단일 모델 — 백엔드 로드 성공 시 available/스켈레톤을 반영, 실패 시 하드코딩 5종 폴백(빈 화면 방지).
type RenderProviderCard = { key: string; name: string; desc: string; full?: boolean; available: boolean; modalKey: ProviderKey | null };

// 업체별 브랜드 아이콘 — 실제 로고(외부 이미지) 대신 lucide SVG 아이콘 + 브랜드색 그라데이션 배지로 구분.
function providerBrand(key: string, name: string): { Icon: typeof Store; badge: string } {
  const n = (name || '').toLowerCase();
  if (key === 'cafe24' || n.includes('카페24') || n.includes('cafe24')) return { Icon: Store, badge: 'from-blue-500 to-blue-600 shadow-blue-500/25' };
  if (key === 'naver' || n.includes('네이버') || n.includes('naver')) return { Icon: ShoppingBag, badge: 'from-green-500 to-emerald-600 shadow-green-500/25' };
  if (key === 'godo' || n.includes('고도몰')) return { Icon: Boxes, badge: 'from-sky-500 to-indigo-600 shadow-sky-500/25' };
  if (n.includes('shopify')) return { Icon: ShoppingCart, badge: 'from-lime-500 to-green-600 shadow-lime-500/25' };
  if (n.includes('메이크샵') || n.includes('makeshop')) return { Icon: Palette, badge: 'from-rose-500 to-red-600 shadow-rose-500/25' };
  if (n.includes('imweb') || n.includes('아임웹')) return { Icon: LayoutTemplate, badge: 'from-indigo-500 to-violet-600 shadow-indigo-500/25' };
  if (n.includes('식스샵') || n.includes('sixshop') || n.includes('six')) return { Icon: Package, badge: 'from-slate-500 to-slate-700 shadow-slate-500/25' };
  if (n.includes('woo')) return { Icon: Blocks, badge: 'from-purple-500 to-fuchsia-600 shadow-purple-500/25' };
  if (key === 'custom') return { Icon: Database, badge: 'from-violet-500 to-fuchsia-600 shadow-violet-500/25' };
  return { Icon: Database, badge: 'from-slate-500 to-slate-700 shadow-slate-500/25' };
}

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
  const [naverPreviewing, setNaverPreviewing] = useState(false);
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
  const [imwebStatus, setImwebStatus] = useState<ImwebStatus | null>(null);
  const [imwebSiteCode, setImwebSiteCode] = useState('');
  const [imwebConnecting, setImwebConnecting] = useState(false);
  const [makeshopStatus, setMakeshopStatus] = useState<MakeshopStatus | null>(null);
  const [makeshopShopUid, setMakeshopShopUid] = useState('');
  const [makeshopClientId, setMakeshopClientId] = useState('');
  const [makeshopClientSecret, setMakeshopClientSecret] = useState('');
  const [showMakeshopSecret, setShowMakeshopSecret] = useState(false);
  const [makeshopConnecting, setMakeshopConnecting] = useState(false);
  const [makeshopPreviewing, setMakeshopPreviewing] = useState(false);
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
  // ★ 2026-08-10 Phase 3 — 스테퍼 ①(연결) 펼침 상태. 연결이 끝나면 접히지만 해제·재설정을 위해 다시 펼 수 있다.
  //   내용물(몰별 폼)은 페이지가 그리므로 상태를 여기서 들고 스테퍼와 공유한다.
  const [connectStepOpen, setConnectStepOpen] = useState(false);
  // ★ 2026-06-25 (gap 3): 백엔드 provider 목록(동적). null = 미로드(폴백).
  const [providerList, setProviderList] = useState<ProviderApiEntry[] | null>(null);
  const [customTab, setCustomTab] = useState<'connect' | 'web' | 'app' | 'verify'>('connect');
  const closeModal = () => { setActiveModal(null); setConnectProvider(null); setCustomTab('connect'); setConnectStepOpen(false); };
  const webhookProviderOpen = connectProvider === 'custom';
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ★ 2026-06-25 (gap 3): 렌더 카드 = 백엔드 registry 단일 출처. 로드 성공 시 available/스켈레톤 반영, 실패 시 하드코딩 5종 폴백.
  // ★ 2026-08-10 Phase 2 — 몰별 상태 판정. 여기서 다시 계산하지 않고 훅 하나에 맡긴다(설계서 §6).
  //   needsAction(인증 만료)은 판정 근거 컬럼이 미확정이라 아직 넘기지 않는다(§9-6) — 넘기지 않으면 훅이 그 축을 켜지 않는다.
  const dashboardConnected = useMemo(() => ({
    cafe24: !!cafe24Status?.connected,
    naver: !!naverStatus?.connected,
    godo: !!godoStatus?.connected,
    imweb: !!imwebStatus?.connected,
    makeshop: !!makeshopStatus?.connected,
    custom: !!customInfo?.hasSecret,
  }), [cafe24Status?.connected, naverStatus?.connected, godoStatus?.connected, imwebStatus?.connected, makeshopStatus?.connected, customInfo?.hasSecret]);

  // ★ 2026-08-10 — 조치 필요(인증 끊김) 축. 판정 문자열은 훅의 CT가 소유하고 여기선 몰별로 모으기만 한다.
  //   고도몰은 토큰이 없는 키 방식이라 만료 개념이 없다 — 대신 주기 수집이 남긴 실패 사유가 그 신호다.
  const dashboardNeedsAction = useMemo(() => ({
    cafe24: isIntegrationAuthBroken(cafe24Status?.status),
    naver: isIntegrationAuthBroken(naverStatus?.status),
    godo: !!godoStatus?.syncError,
    imweb: isIntegrationAuthBroken(imwebStatus?.status),
    makeshop: isIntegrationAuthBroken(makeshopStatus?.status),
    custom: false,   // 자체 호스팅은 시크릿 방식이라 만료가 없다(재발급은 담당자 의사)
  }), [cafe24Status?.status, naverStatus?.status, godoStatus?.syncError, imwebStatus?.status, makeshopStatus?.status]);

  const integrationStatus = useCdpIntegrationStatus({
    connected: dashboardConnected,
    needsAction: dashboardNeedsAction,
    bySource: installStatus?.bySource,
  });

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
    if (imwebStatus?.connected) list.push('아임웹');
    if (makeshopStatus?.connected) list.push('메이크샵');
    return list;
  }, [customInfo?.hasSecret, cafe24Status?.connected, naverStatus?.connected, godoStatus?.connected, imwebStatus?.connected, makeshopStatus?.connected]);
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
        cafe24Res, naverRes, godoRes, imwebRes, makeshopRes, customRes, providersRes,
      ] = await Promise.all([
        fetch('/api/cdp/usage', { headers }),
        fetch('/api/cdp/diagnostics', { headers }),
        fetch('/api/cdp/funnel?days=30', { headers }),
        fetch('/api/cdp/timeline', { headers }),
        // ★ 2026-08-10 권한 점검 — 활성 고객은 이름·전화가 담긴 응답이라 관리자만 부른다(서버도 403으로 막는다).
        //   담당자일 때 호출 자체를 하지 않아야 화면에 403 오류가 뜨지 않는다.
        isAdmin ? fetch('/api/cdp/active-customers?limit=10', { headers }) : Promise.resolve(null),
        fetch('/api/cdp/channel-distribution', { headers }),
        fetch('/api/cafe24/status', { headers }),
        fetch('/api/naver-commerce/status', { headers }),
        fetch('/api/godo/status', { headers }),
        fetch('/api/imweb/status', { headers }),
        fetch('/api/makeshop/status', { headers }),
        fetch('/api/cdp/custom/info', { headers }),
        fetch('/api/cdp/providers', { headers }),
      ]);
      const usageData = await usageRes.json();
      const diagData = await diagRes.json();
      const funnelData = await funnelRes.json();
      const timelineData = await timelineRes.json();
      const activeData = activeRes ? await activeRes.json() : null;
      const chDistData = await chDistRes.json();
      const cafe24Data = await cafe24Res.json();
      const naverData = await naverRes.json();
      const godoData = await godoRes.json();
      const imwebData = await imwebRes.json();
      const makeshopData = await makeshopRes.json();
      const customData = await customRes.json();
      const providersData = await providersRes.json();

      if (usageData.success) setUsage(usageData);
      if (diagData.success) setDiagnostics(diagData.diagnostics);
      if (funnelData.success) setFunnel(funnelData.funnel);
      if (timelineData.success) setTimeline(timelineData.timeline || []);
      if (activeData?.success) setActiveCustomers(activeData.activeCustomers);
      if (chDistData.success) {
        setChannelDist(chDistData.distribution);
        setChannelCaps(chDistData.capabilities);
      }
      if (cafe24Data.success) setCafe24Status(cafe24Data);
      if (naverData.success) setNaverStatus(naverData);
      if (godoData.success) setGodoStatus(godoData);
      if (imwebData.success) setImwebStatus(imwebData);
      if (makeshopData.success) setMakeshopStatus(makeshopData);
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
  }, [isAdmin]);

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

  // 네이버 스마트스토어 — ★ 2026-07-06 커머스 API 실제 인증 = client_credentials(자격 입력).
  //   OAuth 팝업 폐기 — POST /connect 한 번으로 서버가 토큰 발급을 실제 검증한 뒤에만 연동 완료.
  const handleNaverConnect = async () => {
    const storeId = naverStoreId.trim();
    const clientId = naverClientId.trim();
    const clientSecret = naverClientSecret.trim();
    if (!storeId) { toast.error('네이버 스마트스토어 store_id를 입력해주세요.'); return; }
    if (!clientId || !clientSecret) {
      toast.error('애플리케이션 ID와 시크릿을 모두 입력해주세요.');
      return;
    }
    setNaverConnecting(true);
    try {
      const res = await fetch('/api/naver-commerce/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ store_id: storeId, client_id: clientId, client_secret: clientSecret }),
      });
      const data = await res.json();
      if (data.success) {
        await loadAll();
        toast.success('네이버 스마트스토어 연동이 완료되었습니다.');
      } else {
        toast.error(data.error || '네이버 스마트스토어 연동 검증에 실패했습니다.');
        if (data.hint) toast.info(data.hint);
      }
    } catch (e: any) { toast.error(e?.message || '네이버 스마트스토어 처리 오류'); }
    finally { setNaverConnecting(false); }
  };
  // 연동 검증 — 최근 24시간 변경 주문을 실제 API로 당겨 건수 확인 (스키마 raw는 서버 로그에 기록됨)
  const handleNaverPreview = async () => {
    setNaverPreviewing(true);
    try {
      const res = await fetch('/api/naver-commerce/orders/preview?hours=24', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) {
        toast.success(`최근 24시간 변경 주문 ${Number(data.idCount || 0).toLocaleString()}건 확인 — 연동 정상`);
      } else {
        toast.error(data.error || '주문 데이터 확인 실패');
      }
    } catch (e: any) { toast.error(e?.message || '주문 데이터 확인 오류'); }
    finally { setNaverPreviewing(false); }
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

  // 메이크샵 — ★ 2026-07-06 커머스 API client_credentials(자격 입력). POST /connect 한 번에 서버가 토큰 발급 실검증 후 연동.
  const handleMakeshopConnect = async () => {
    const shopUid = makeshopShopUid.trim();
    const clientId = makeshopClientId.trim();
    const clientSecret = makeshopClientSecret.trim();
    if (!shopUid) { toast.error('메이크샵 상점 ID(shop_uid)를 입력해주세요.'); return; }
    if (!clientId || !clientSecret) { toast.error('Client ID와 Client Secret을 모두 입력해주세요.'); return; }
    setMakeshopConnecting(true);
    try {
      const res = await fetch('/api/makeshop/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ shop_uid: shopUid, client_id: clientId, client_secret: clientSecret }),
      });
      const data = await res.json();
      if (data.success) {
        await loadAll();
        toast.success('메이크샵 연동이 완료되었습니다.');
      } else {
        toast.error(data.error || '메이크샵 연동 검증에 실패했습니다.');
        if (data.hint) toast.info(data.hint);
      }
    } catch (e: any) { toast.error(e?.message || '메이크샵 처리 오류'); }
    finally { setMakeshopConnecting(false); }
  };
  const handleMakeshopPreview = async () => {
    setMakeshopPreviewing(true);
    try {
      const res = await fetch('/api/makeshop/preview?days=30', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (data.success) toast.success('메이크샵 회원·주문 데이터 확인 완료 — 연동 정상');
      else toast.error(data.error || '데이터 확인 실패');
    } catch (e: any) { toast.error(e?.message || '데이터 확인 오류'); }
    finally { setMakeshopPreviewing(false); }
  };
  const handleMakeshopDisconnect = () => {
    setConfirm({
      mode: 'danger',
      title: '메이크샵 연동 해제',
      description: '자사몰 → 한줄로 sync가 즉시 중단됩니다.',
      onConfirm: async () => {
        const res = await fetch('/api/makeshop/disconnect', { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (data.success) { await loadAll(); toast.success('메이크샵 연동 해제 완료'); }
        else { toast.error(data.error || '연동 해제 실패'); }
      },
    });
  };

  // 아임웹 — siteCode 입력 → OAuth (단일 공식 앱, BYO 없음)
  const handleImwebConnect = async () => {
    const siteCode = imwebSiteCode.trim();
    if (!siteCode) { toast.error('아임웹 사이트 코드(siteCode)를 입력해주세요.'); return; }
    setImwebConnecting(true);
    try {
      const res = await fetch(`/api/imweb/oauth/authorize?site_code=${encodeURIComponent(siteCode)}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (data.success && data.authorize_url) {
        window.open(data.authorize_url, 'imweb_oauth', 'width=720,height=820');
        toast.info('새 창에서 아임웹 로그인 + 동의 완료 후 새로고침해주세요.');
      } else { toast.error(data.error || '아임웹 연동 시작 실패'); }
    } catch (e: any) { toast.error(e?.message || '아임웹 연동 처리 오류'); }
    finally { setImwebConnecting(false); }
  };
  const handleImwebDisconnect = () => {
    setConfirm({
      mode: 'danger',
      title: '아임웹 연동 해제',
      description: '자사몰 → 한줄로 sync가 즉시 중단됩니다.',
      onConfirm: async () => {
        const res = await fetch('/api/imweb/disconnect', { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } });
        const data = await res.json();
        if (data.success) { await loadAll(); toast.success('아임웹 연동 해제 완료'); }
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

  // ★ 2026-08-10 Phase 5 — 차트 파생 데이터(fusionPie·timelineChart·channelPie)는
  //   그것을 그리는 `CdpAnalyticsPanels`가 자기 안에서 계산한다. 페이지가 들고 있을 이유가 없다.

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
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/20">
            <Database className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-semibold text-white">자사몰 연동 (CDP)</h1>
            </div>
            <p className="text-xs md:text-sm text-white/50 mt-0.5">카페24 · 네이버 · 메이크샵 · 고도몰 · 아임웹 · 자체 호스팅 · 싱크에이전트 — 고객 데이터를 한 곳으로 모읍니다</p>
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

        {/* ★ 2026-08-10 Phase 2 — 연동 현황판(1층). 실측 상태 배지 + 요약 3지표.
            판정 근거 = install-status bySource(Phase 0) + 몰별 connected. 플래그 off면 아래 옛 그리드가 그대로 뜬다. */}
        {!cdpLocked && CDP_DASHBOARD_V2 && (
          <CdpIntegrationDashboard
            providers={providerCards
              .filter((p) => p.modalKey)
              .map((p) => ({ key: p.modalKey as CdpProviderKey, name: p.name, desc: p.desc }))}
            statuses={integrationStatus.byKey}
            summary={integrationStatus.summary}
            brand={providerBrand}
            onOpen={(key) => setConnectProvider(key)}
            onRefresh={loadAll}
            loading={loading}
          />
        )}

        {/* 자사몰 선택 — 좌측 대형 자체 호스팅(그 외 모든 몰 webhook 흡수) + 우측 2×3 그리드 */}
        {!cdpLocked && !CDP_DASHBOARD_V2 && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            {/* 좌측 대형 — 자체 호스팅: Shopify·WooCommerce·식스샵 등 목록에 없는 모든 몰 흡수 */}
            <button
              type="button"
              onClick={() => setConnectProvider('custom')}
              title="자체 호스팅 · 그 외 모든 자사몰"
              className={`lg:col-span-2 group flex flex-col justify-between p-5 rounded-2xl border text-left transition-all duration-200 ${customInfo?.hasSecret ? 'bg-emerald-500/[0.06] border-emerald-400/25' : 'bg-white/[0.04] border-white/10'} cursor-pointer hover:border-violet-400/40 hover:bg-white/[0.07] hover:-translate-y-0.5`}
            >
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 text-white shadow-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-violet-500/25">
                  <Database className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-semibold text-white">자체 호스팅 · 그 외 모든 몰</div>
                  <div className="text-[12px] text-white/55 mt-1 leading-relaxed">직접 개발한 자사몰은 물론 <span className="text-white/80">Shopify · WooCommerce · 식스샵</span> 등 목록에 없는 모든 몰을 webhook 한 줄로 연결합니다.</div>
                </div>
                {customInfo?.hasSecret
                  ? <span className="flex-shrink-0 text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-400/25 font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" />연동됨</span>
                  : <span className="flex-shrink-0 text-[10px] px-2 py-1 rounded-full bg-violet-500/15 text-violet-200 border border-violet-400/25 font-medium">연동하기</span>}
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-[11px] text-white/40">
                <Server className="w-3.5 h-3.5" /> Secret 발급 → SDK/webhook 설정 → 수신 검증
              </div>
            </button>

            {/* 우측 2×3 — 나머지 자사몰(전용 모달 보유분 + 곧 출시) */}
            <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {providerCards.filter((p) => p.key !== 'custom').map((p) => {
                const connected = p.modalKey === 'cafe24' ? !!cafe24Status?.connected
                  : p.modalKey === 'naver' ? !!naverStatus?.connected
                  : p.modalKey === 'godo' ? !!godoStatus?.connected
                  : p.modalKey === 'imweb' ? !!imwebStatus?.connected
                  : p.modalKey === 'makeshop' ? !!makeshopStatus?.connected
                  : false;
                const { Icon, badge } = providerBrand(p.key, p.name);
                const clickable = p.available && p.modalKey !== null;
                return (
                  <button
                    key={p.key}
                    type="button"
                    disabled={!clickable}
                    onClick={clickable ? () => setConnectProvider(p.modalKey as ProviderKey) : undefined}
                    title={p.name}
                    className={`group flex items-center gap-3.5 p-4 rounded-2xl border text-left transition-all duration-200 ${connected ? 'bg-emerald-500/[0.06] border-emerald-400/25' : 'bg-white/[0.04] border-white/10'} ${clickable ? 'cursor-pointer hover:border-violet-400/40 hover:bg-white/[0.07] hover:-translate-y-0.5' : 'opacity-45 cursor-default'}`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-lg bg-gradient-to-br ${badge}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{p.name}</div>
                      <div className="text-[11px] text-white/45 truncate mt-0.5">{p.desc}</div>
                    </div>
                    {!p.available
                      ? <span className="flex-shrink-0 text-[10px] px-2 py-1 rounded-full bg-white/5 text-white/40 border border-white/10 font-medium">곧 출시</span>
                      : connected
                        ? <span className="flex-shrink-0 text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-400/25 font-medium inline-flex items-center gap-1"><Check className="w-3 h-3" />연동됨</span>
                        : <span className="flex-shrink-0 text-[10px] px-2 py-1 rounded-full bg-violet-500/15 text-violet-200 border border-violet-400/25 font-medium">연동하기</span>}
                  </button>
                );
              })}
            </div>
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
            {/* 활성 고객 = 이름·전화가 보이는 목록이라 관리자에게만 진입점을 둔다(서버도 403). 담당자는 연동 상태까지만 본다. */}
            {isAdmin && (
              <button onClick={() => setActiveModal('customers')} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[12px] text-white/80 transition-colors">
                <Users className="w-3.5 h-3.5 text-violet-300" /> 활성 고객
              </button>
            )}
          </div>
        )}

        {/* 데이터 분석 · AI 진단 모달 (createPortal) */}
        <CdpModal open={activeModal === 'analytics'} onClose={closeModal} title="데이터 분석 · AI 진단" icon={<Sparkles className="w-4 h-4 text-violet-300" />}>
          {/* ★ 2026-08-10 Phase 5 — 차트·AI 진단 본문은 표시 전용이라 컴포넌트로 분리(상태는 props로만). */}
          <CdpAnalyticsPanels
            explanation={explanation}
            explainLoading={explainLoading}
            isAdmin={isAdmin}
            onStartExplain={loadExplanation}
            diagnostics={diagnostics}
            funnel={funnel}
            timeline={timeline}
            channelDist={channelDist}
            channelCaps={channelCaps}
          />
        </CdpModal>

        {/* 활성 고객 모달 (createPortal) */}
        <CdpModal open={activeModal === 'customers'} onClose={closeModal} title="자사몰 활성 고객" icon={<Users className="w-4 h-4 text-cyan-300" />}>
          <CdpActiveCustomersTable data={activeCustomers} />
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
        {/* ★ 2026-08-10 Phase 3 — 3단계 진행 패널. 옛 '검증' 탭이 ③단계로 흡수된다(설계서 §5-2).
            완료 판정은 실측값이 한다 — 사용자가 '다음'으로 자기 진도를 신고하지 않는다. */}
        {connectProvider && CDP_DASHBOARD_V2 && integrationStatus.byKey[connectProvider as CdpProviderKey] && (
          <CdpIntegrationStepper
            providerName={PROVIDER_META[connectProvider]?.title || connectProvider}
            status={integrationStatus.byKey[connectProvider as CdpProviderKey]}
            connectSlot={null}
            signals={installStatus?.signals ?? null}
            onDeveloperSend={() => copyText(
              buildInstallGuideText({
                providerName: PROVIDER_META[connectProvider]?.title || connectProvider,
                sdkKey: usage?.public_key || null,
                webhookUrl: connectProvider === 'custom' ? (customInfo?.webhookUrl || null) : null,
                allowedOrigins,
                includeSecretNotice: connectProvider === 'custom',
              }),
              '개발자 전달용 설치 안내',
            )}
            stalled={!!installStatus && installStatus.total === 0 && !!installStatus.keyIssuedAt
              && Date.now() - new Date(installStatus.keyIssuedAt).getTime() > 10 * 60 * 1000}
            onRetryCheck={loadAll}
            connectExpanded={connectStepOpen}
            onToggleConnect={() => setConnectStepOpen((v) => !v)}
          />
        )}

        {/* webhook 자사몰 — 탭. ★Phase 3: 검증 탭은 스테퍼 ③이 대신한다(플래그 on일 때 제외) */}
        {webhookProviderOpen && (
          <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            {(CDP_DASHBOARD_V2
              ? ([['connect', '연결'], ['web', '웹'], ['app', '앱']] as const)
              : ([['connect', '연결'], ['web', '웹'], ['app', '앱'], ['verify', '검증']] as const)
            ).map(([key, label]) => (
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

        {/* 자체 호스팅 — webhook 방식 (연결 탭) */}
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
          <CdpCustomWebhookGuide webhookUrl={customInfo.webhookUrl} />
        )}

        {/* 연결 검증 — 최근 webhook 수신 확인 (검증 탭) */}
        {webhookProviderOpen && customInfo?.hasSecret && customTab === 'verify' && (
          <CdpCustomDeliveries deliveries={customDeliveries} loading={loadingDeliveries} onLoad={handleLoadDeliveries} />
        )}

        {/* 네이티브 앱(REST 직접 호출) 안내 (앱 탭) */}
        {webhookProviderOpen && customInfo?.hasSecret && customTab === 'app' && (
          <CdpCustomAppGuide />
        )}

        {/* ★ 2026-07-17 인앱 메시지 앱(네이티브) 통합 계약 (앱 탭) — 앱이 구현해야 편집기 설정이 그대로 동작.
            단일 소스 = components/inapp/AppIntegrationContract.tsx (편집기 앱 채널 모달과 동일 내용) */}
        {webhookProviderOpen && customInfo?.hasSecret && customTab === 'app' && (
          <CdpDeveloperDoc
            title="인앱 메시지 — 앱이 구현해야 하는 계약"
            summary="네이티브 앱은 인앱 메시지를 앱이 직접 그립니다. 아래 내용을 앱 개발자에게 전달하면, 이후 편집기에서 만드는 메시지가 앱 수정 없이 동작합니다."
            sections={APP_INAPP_CONTRACT_SECTIONS}
            onCopyAll={() => copyText(
              developerDocToText('인앱 메시지 — 앱이 구현해야 하는 계약', APP_INAPP_CONTRACT_SECTIONS),
              '앱 인앱 메시지 계약',
            )}
          />
        )}
        {/* 몰별 연결 폼 = 스테퍼 ①단계의 내용물. **표시 조건은 여기가 통제**한다 —
            연결 전에는 항상 펼치고, 연결된 뒤에는 ①을 눌러 펼쳤을 때만 보여준다(해제·재설정이 거기 있다).
            ★ 2026-08-10 Phase 5-4: 폼 마크업은 components/cdp/CdpConnectForms로 옮겼고, 이 조건과 상태·핸들러는 페이지에 남는다. */}
        <div className={CDP_DASHBOARD_V2 && connectProvider
          && integrationStatus.byKey[connectProvider as CdpProviderKey]?.connected
          && !connectStepOpen ? 'hidden' : ''}>
        {connectProvider === 'cafe24' && (
          <CdpCafe24ConnectForm
            status={cafe24Status}
            isAdmin={isAdmin}
            connecting={cafe24Connecting}
            mallId={cafe24MallId}
            onMallIdChange={setCafe24MallId}
            showByo={cafe24ShowByo}
            onToggleByo={() => setCafe24ShowByo((v) => !v)}
            clientId={cafe24ClientId}
            onClientIdChange={setCafe24ClientId}
            clientSecret={cafe24ClientSecret}
            onClientSecretChange={setCafe24ClientSecret}
            showSecret={showCafe24Secret}
            onToggleSecret={() => setShowCafe24Secret((v) => !v)}
            onConnectOfficial={handleCafe24ConnectOfficial}
            onConnectByo={handleCafe24Connect}
            onDisconnect={handleCafe24Disconnect}
            onCopy={copyText}
          />
        )}

        {/* 네이버 스마트스토어 — 커머스 API 자격 입력형 (★ 2026-07-06 OAuth 폐기, client_credentials) */}
        {connectProvider === 'naver' && (
          <CdpNaverConnectForm
            status={naverStatus}
            isAdmin={isAdmin}
            connecting={naverConnecting}
            previewing={naverPreviewing}
            storeId={naverStoreId}
            onStoreIdChange={setNaverStoreId}
            clientId={naverClientId}
            onClientIdChange={setNaverClientId}
            clientSecret={naverClientSecret}
            onClientSecretChange={setNaverClientSecret}
            showSecret={showNaverSecret}
            onToggleSecret={() => setShowNaverSecret((v) => !v)}
            onConnect={handleNaverConnect}
            onPreview={handleNaverPreview}
            onDisconnect={handleNaverDisconnect}
          />
        )}

        {/* 메이크샵 — 커머스 API 자격 입력형 (★ 2026-07-06 client_credentials, polling) */}
        {connectProvider === 'makeshop' && (
          <CdpMakeshopConnectForm
            status={makeshopStatus}
            isAdmin={isAdmin}
            connecting={makeshopConnecting}
            previewing={makeshopPreviewing}
            shopUid={makeshopShopUid}
            onShopUidChange={setMakeshopShopUid}
            clientId={makeshopClientId}
            onClientIdChange={setMakeshopClientId}
            clientSecret={makeshopClientSecret}
            onClientSecretChange={setMakeshopClientSecret}
            showSecret={showMakeshopSecret}
            onToggleSecret={() => setShowMakeshopSecret((v) => !v)}
            onConnect={handleMakeshopConnect}
            onPreview={handleMakeshopPreview}
            onDisconnect={handleMakeshopDisconnect}
            publicKey={usage?.public_key}
            onCopy={copyText}
          />
        )}

        {/* 아임웹 — OAuth (siteCode) */}
        {connectProvider === 'imweb' && (
          <CdpImwebConnectForm
            status={imwebStatus}
            isAdmin={isAdmin}
            connecting={imwebConnecting}
            siteCode={imwebSiteCode}
            onSiteCodeChange={setImwebSiteCode}
            onConnect={handleImwebConnect}
            onDisconnect={handleImwebDisconnect}
            publicKey={usage?.public_key}
            onCopy={copyText}
          />
        )}

        {/* 고도몰 — BYO 쇼핑몰 인증키(key) */}
        {connectProvider === 'godo' && (
          <CdpGodoConnectForm
            status={godoStatus}
            isAdmin={isAdmin}
            connecting={godoConnecting}
            apiKey={godoKey}
            onApiKeyChange={setGodoKey}
            showKey={showGodoKey}
            onToggleKey={() => setShowGodoKey((v) => !v)}
            onConnect={handleGodoConnect}
            onDisconnect={handleGodoDisconnect}
            publicKey={usage?.public_key}
            onCopy={copyText}
          />
        )}


        </div>{/* ← 몰별 연결 폼 구간 끝(스테퍼 ① 내용물) */}

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
                <div className="text-xs text-white/50">자사몰 &lt;head&gt;에 붙여넣으면 고객 행동 수집이 시작됩니다.</div>
              </div>
            </div>
            {/* ★ 2026-08-10 §5-4 — 거의 같은 스크립트 2개를 나란히 쌓지 않는다. 토글 하나로 전환(코드 블록 동시 노출 1개). */}
            <CdpSnippetBox
              variants={[
                {
                  key: 'web',
                  label: '웹',
                  note: '쇼핑몰 모든 페이지의 <head> 안에 넣어주세요.',
                  code: buildSdkScriptTag(usage.public_key),
                },
                {
                  key: 'app',
                  label: '앱 웹뷰',
                  note: '앱 웹뷰 페이지에는 data-hjl-platform="app" 한 줄이 더 붙습니다.',
                  code: buildSdkScriptTag(usage.public_key, { platformApp: true }),
                },
              ]}
              onCopy={copyText}
            />
            <div className="text-[10px] text-white/30 italic mt-3">Data source — app.hanjul.ai/sdk/{CDP_SDK_VERSION}</div>
          </div>
        )}

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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-8 overflow-y-auto">
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

// ChartCard·FunnelBar·StatBox·CapBadge = 분석 패널 전용이라 CdpAnalyticsPanels로 함께 옮겼다(★2026-08-10 Phase 5).

// GuideStep = 몰별 연결 폼과 공용이라 components/cdp/CdpFormPrimitives로 옮겼다(★2026-08-10 Phase 5-3).

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
