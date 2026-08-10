/**
 * components/cdp/cdp-analytics-types.ts — 자사몰 진단·분석 응답 타입 (★2026-08-10 Phase 5)
 *
 * 페이지가 들고 있던 타입 중 **분석 패널·활성 고객 표가 쓰는 것만** 옮겼다.
 * 방향은 한쪽뿐이다 — 페이지가 여기서 import한다(컴포넌트가 페이지를 import하지 않는다).
 * 연결 폼·시크릿 등 연동 자체의 타입은 페이지에 그대로 둔다(분석과 수명이 다르다).
 */

export interface CdpProviderStats {
  source: string;
  totalLinks: number;
  mappedLinks: number;
  mappingRate: number;
  events30d: number;
}

export interface WebhookReliability {
  source: string;
  totalDeliveries: number;
  successCount: number;
  failedCount: number;
  duplicateCount: number;
  successRate: number;
}

export interface SourceConflictBucket {
  activeSourceCount: number;
  customerCount: number;
}

export interface CdpDiagnostics {
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

export interface CdpFunnel {
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

export interface CdpTimelineBucket {
  hour: number;
  count: number;
  byEvent: Record<string, number>;
}

export interface CdpActiveCustomer {
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

export interface CdpActiveCustomers {
  topCustomers: CdpActiveCustomer[];
  totalActiveCustomers: number;
  anonymousEventCount: number;
  computedAt: string;
  source: string;
}

export interface ChannelGroup {
  channel: string;
  customerIds: string[];
  count: number;
}

export interface ChannelDistribution {
  total: number;
  groups: ChannelGroup[];
  unreachable: number;
  computedAt: string;
}

export interface ChannelCapabilities {
  smsLms: boolean;
  kakao: boolean;
  email: boolean;
  webPush: boolean;
  inApp: boolean;
  computedAt: string;
}

export interface CdpExplainFactor {
  category: string;
  label: string;
  impactScore: number;
  direction: 'positive' | 'negative' | 'neutral';
  detail: string;
  sourceField: string;
}

export interface CdpExplanation {
  overallHealthScore: number;
  topInsight: string;
  factors: CdpExplainFactor[];
  recommendations: string[];
  explainedAt: string;
}
